#!/usr/bin/env python3
"""No model, no API call: the canary judge's harness, tested.  python agent/test_judge.py"""
import json, shutil, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import judge as J  # noqa: E402

ok = n = 0


def check(name, cond):
    global ok, n
    n += 1; ok += bool(cond)
    print(f"{'PASS' if cond else 'FAIL'}  {name}")


# blind: the judge has no way to read code, scripts or other canaries
check("dashboard mode: only write_file + done (no file reading at all)", J.tools_for("dashboard") == ["write_file", "done"])
check("evidence mode: adds run_query, still no file reading", J.tools_for("evidence") == ["run_query", "write_file", "done"])

# the query sandbox
out = J.run_query('print(canary.length > 0, stable.length > canary.length, rows.length === stable.length + canary.length)', "B")
check("a query sees this canary's raw log, split by version", out == "true true true")
check("a query can't require anything", "require is not defined" in J.run_query('require("fs")', "B"))
check("a query can't loop forever", "timed out" in J.run_query("while(true){}", "B"))
check("pct() is available", J.run_query("print(pct([1,2,3,4],0.5))", "B") == "3")

# the decision gate
J.REPORT = "review/_test/decision.json"
p = J.PROJECT / J.REPORT
p.parent.mkdir(parents=True, exist_ok=True)
true_claim = {"claim": "the canary has 5xx errors on /checkout", "query": 'print(canary.filter(r=>r.path==="/checkout"&&r.status>=500).length > 0)', "expect": "true"}
false_claim = {"claim": "the canary has no errors at all", "query": 'print(canary.filter(r=>r.status>=500).length === 0)', "expect": "true"}
try:
    p.write_text(json.dumps({"decision": "ROLLBACK", "why": "x", "claims": [true_claim, true_claim]}), encoding="utf-8")
    check("evidence mode: verified claims pass the gate", J.check_decision("evidence", "B")[0])
    p.write_text(json.dumps({"decision": "PROMOTE", "why": "x", "claims": [true_claim, false_claim]}), encoding="utf-8")
    good, msg, _ = J.check_decision("evidence", "B")
    check("evidence mode: a claim the data contradicts is refused", not good and "NOT VERIFIED" in msg)
    p.write_text(json.dumps({"decision": "PROMOTE", "why": "x"}), encoding="utf-8")
    check("evidence mode: a decision without claims is refused", not J.check_decision("evidence", "B")[0])
    check("dashboard mode: the same file is accepted", J.check_decision("dashboard", "B")[0])
    p.write_text(json.dumps({"decision": "MAYBE", "why": "x"}), encoding="utf-8")
    check("only PROMOTE or ROLLBACK", not J.check_decision("dashboard", "B")[0])
finally:
    shutil.rmtree(p.parent, ignore_errors=True)

print(f"\n{ok}/{n} checks passed -- no model, no API call.")
sys.exit(0 if ok == n else 1)
