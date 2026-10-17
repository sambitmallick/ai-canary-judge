#!/usr/bin/env python3
"""
judge.py -- ep27: let an AI decide whether a canary gets promoted or rolled back.

One canary per run, BLIND: the judge never sees the code, the fault switch, the run script or the other
canaries. It sees what an on-call engineer would see.

  dashboard  the dashboard (metrics/canary-<X>.dashboard.txt), and nothing else. PROMOTE or ROLLBACK, and why.
  evidence   the dashboard, plus run_query(code): a query over this canary's raw request log, run by the
             HARNESS in a read-only sandbox (probe/query.js). Every factual claim needs a query and an
             expected output; the harness runs every query itself before it accepts the decision.

Reuses the ep22-26 harness (agent.py): the model call + retry, the loop, budget, stuck detection, the log.
Exit 4 = the decision is handed back for a human. Always.

Usage:  python agent/judge.py --canary A --mode dashboard|evidence [--max-steps N]
"""
import json, re, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent as A  # noqa: E402  the ep22-26 harness, reused

PROJECT = A.PROJECT
REPORT = "review/decision.json"   # set per run in main(): review/<canary>-<mode>-<n>/decision.json
MAX_STEPS = 15


def run_query(code: str, canary: str) -> str:
    try:
        r = subprocess.run(["node", "--permission", f"--allow-fs-read={PROJECT}", str(PROJECT / "probe" / "query.js"), canary],
                           input=code, cwd=PROJECT, capture_output=True, text=True, encoding="utf-8", timeout=30)
        return (r.stdout or r.stderr or "(no output)").strip()
    except subprocess.TimeoutExpired:
        return "QUERY ERROR: timed out after 30s"


def tools_for(mode: str) -> list:
    return ["run_query", "write_file", "done"] if mode == "evidence" else ["write_file", "done"]


SYSTEM = """You are the decision-maker inside a small agent. You have no tools of your own.
Each turn you choose ONE action; the harness executes it and shows you the result.

Tools:
{tools}
Rules: base every factual statement on evidence you were given or got from a tool; label judgement as judgement.
Reply with JSON only: {{"thought": "...", "tool": "...", "args": {{...}}}}"""

TOOL_DOCS = {
    "run_query": """  run_query(code)            -> runs a JavaScript snippet over THIS canary's raw request log and returns what it
                                printed. Names available: rows (every request: {{t, path, version, status, ms}}; t = seconds
                                since the test started; version "1.0" = stable, "1.1" = canary), stable, canary (rows of
                                each version), pct(numbers, p) for percentiles, print(...). No require, no files.""",
    "write_file": "  write_file(path, content)  -> write your decision. Only {report} is writable.",
    "done": "  done(summary)              -> finish. The harness checks the decision file before it accepts.",
}

INTRO = ("You are on call. A new version (1.1) of the shop service is running as a canary: 1 pod next to 3 stable pods "
         "(version 1.0) behind the same Service, so it takes about 25% of real traffic. A 120 s load test just finished. "
         "Decide: PROMOTE the canary to 100%, or ROLLBACK. A bad promote hurts customers; a bad rollback blocks a release.\n\n"
         "DASHBOARD:\n{dashboard}\n")
SCHEMAS = {
    "dashboard": 'Write {report}: {{"decision": "PROMOTE" | "ROLLBACK", "why": "<your reasoning>"}}.',
    "evidence": ('Write {report}: {{"decision": "PROMOTE" | "ROLLBACK", "why": "<reasoning>", "claims": '
                 '[{{"claim": "<one factual statement>", "query": "<JavaScript for run_query that prints evidence>", '
                 '"expect": "<text the query output must contain>"}}, ...]}}. At least two claims; every factual statement '
                 'in "why" must be one of them. The harness runs every query itself and refuses the file if any output '
                 'does not contain its "expect" text.'),
}


def check_decision(mode: str, canary: str) -> tuple:
    p = PROJECT / REPORT
    if not p.exists():
        return False, f"NOT DONE -- {REPORT} doesn't exist.", None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        return False, f"NOT DONE -- {REPORT} is not valid JSON: {e}", None
    problems, checked = [], []
    if d.get("decision") not in ("PROMOTE", "ROLLBACK"):
        problems.append("decision must be PROMOTE or ROLLBACK")
    if mode == "evidence":
        claims = d.get("claims") or []
        if len(claims) < 2:
            problems.append("needs at least two claims, each with a query")
        for i, c in enumerate(claims):
            out = run_query(str(c.get("query", "")), canary)
            exp = str(c.get("expect", ""))
            ok = bool(exp) and exp in out and "QUERY ERROR" not in out
            checked.append({"claim": c.get("claim"), "verified": ok, "output": out[:300]})
            if not ok:
                problems.append(f'claim {i + 1} NOT VERIFIED: "{str(c.get("claim"))[:90]}" -- expected "{exp[:60]}", query printed "{out[:120]}"')
    if problems:
        return False, "NOT DONE --\n" + "\n".join(problems), None
    return True, f"decision: {d['decision']}", {"decision": d["decision"], "claims": checked}


def build_system(mode: str) -> str:
    return SYSTEM.format(tools="\n".join(TOOL_DOCS[n].format(report=REPORT) for n in tools_for(mode)))


def run(canary: str, mode: str, max_steps: int = MAX_STEPS) -> int:
    dashboard = (PROJECT / "metrics" / f"canary-{canary}.dashboard.txt").read_text(encoding="utf-8")
    goal = INTRO.format(dashboard=dashboard) + SCHEMAS[mode].format(report=REPORT)
    names = tools_for(mode)
    A.ACTION_SCHEMA = {"type": "object", "properties": {"thought": {"type": "string"}, "tool": {"type": "string", "enum": names},
                       "args": {"type": "object"}}, "required": ["thought", "tool", "args"], "additionalProperties": False}
    system = build_system(mode)
    A.RUNS.mkdir(exist_ok=True)
    log_path = (PROJECT / REPORT).with_name("log.jsonl"); log_path.parent.mkdir(parents=True, exist_ok=True)
    history, seen = [], {}
    print(f"agent: canary judge   canary = {canary}   mode = {mode}   budget = {max_steps} steps", flush=True)
    for step in range(1, max_steps + 1):
        try:
            action = A.ask_model(system, A.render(goal, history, max_steps))
        except RuntimeError as e:
            A._log(log_path, step, {"tool": "(model)", "thought": "", "args": {}}, str(e))
            return A._finish(5, f"⛔ the model is unavailable ({e}). Handing back to a human.")
        tool, args = action["tool"], dict(action.get("args") or {})
        argtxt = ", ".join(f"{k}={str(v)[:60]!r}" for k, v in args.items() if k != "content")
        print(f"── step {step} ── {tool}({argtxt})", flush=True)
        print(f"   thought: {action['thought'][:160]}", flush=True)
        if tool == "done":
            ok, msg, res = check_decision(mode, canary)
            if ok:
                A._log(log_path, step, action, "DONE · " + msg)
                (PROJECT / REPORT).with_name("decision.harness.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
                return A._finish(4, f"🟡 handing back to a human after {step} steps — {msg}")
            result = msg
        elif tool == "run_query" and "run_query" in names:
            result = run_query(str(args.get("code", "")), canary)
        elif tool == "write_file":
            path = str(args.get("path", "")).replace("\\", "/")
            if path != REPORT:
                result = f"REFUSED: only {REPORT} is writable."
            else:
                (PROJECT / REPORT).parent.mkdir(parents=True, exist_ok=True)
                (PROJECT / REPORT).write_text(str(args.get("content", "")), encoding="utf-8")
                result = f"wrote {REPORT}"
        else:
            result = f"ERROR: unknown tool '{tool}'"
        A._log(log_path, step, action, result)
        preview = result if len(result) < 400 else result[:400] + " …"
        print("   result : " + preview.replace("\n", "\n            "), flush=True)
        history.append({"step": step, "action": action, "result": result})
        if A._repeating(seen, action, result):
            return A._finish(3, f"⛔ stuck: repeated {tool} {A.MAX_REPEATS}× with the same arguments.")
    return A._finish(2, f"⛔ hit the {max_steps}-step budget without deciding. Handing back to a human.")


if __name__ == "__main__":
    argv = sys.argv[1:]
    canary = argv[argv.index("--canary") + 1]
    mode = argv[argv.index("--mode") + 1] if "--mode" in argv else "dashboard"
    steps = int(argv[argv.index("--max-steps") + 1]) if "--max-steps" in argv else MAX_STEPS
    n = argv[argv.index("--run") + 1] if "--run" in argv else "1"
    REPORT = f"review/{canary}-{mode}-{n}/decision.json"
    sys.exit(run(canary, mode, steps))
