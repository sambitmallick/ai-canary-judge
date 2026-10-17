#!/usr/bin/env python3
"""Score every blind judgement against the answer key (kept outside the repo until the runs finished).
Usage: python judge/score.py   (the answer key was kept outside the repo until every judgement was in)"""
import json, re, subprocess, sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
repo = Path(__file__).resolve().parent.parent; key = json.loads((repo / "results" / "answer-key.json").read_text(encoding="utf-8"))
short = {"PROMOTE": "PROMOTE", "ROLLBACK": "ROLLBK", None: "-"}


def decision(canary, mode, n):
    p = repo / "review" / f"{canary}-{mode}-{n}" / "decision.harness.json"
    return json.loads(p.read_text(encoding="utf-8"))["decision"] if p.exists() else None


def code_verdict(canary):
    out = subprocess.run(["node", "judge/stats.js", canary], cwd=repo, capture_output=True, text=True).stdout
    return "PROMOTE" if "VERDICT: PROMOTE" in out else "ROLLBACK"


print(f"{'canary':8} {'truth':10} {'no-AI code':11} {'dashboard (5 runs)':40} {'evidence (5 runs)':40}")
score = {"code": [0, 0], "dashboard": [0, 0], "evidence": [0, 0]}
for c in "ABCD":
    truth = key[c]["correct"]
    code = code_verdict(c)
    score["code"][0] += code == truth; score["code"][1] += 1
    cells = []
    for mode in ("dashboard", "evidence"):
        ds = [decision(c, mode, n) for n in range(1, 6)]
        right = sum(d == truth for d in ds)
        score[mode][0] += right; score[mode][1] += sum(d is not None for d in ds)
        cells.append(" ".join(f"{short[d]:7}" for d in ds) + f" {right}/5")
    print(f"{c} ({key[c]['fault']})".ljust(8)[:8], f"{truth:10} {code + (' ok' if code == truth else ' WRONG'):11} {cells[0]:40} {cells[1]:40}")
print()
for k, (r, t) in score.items():
    print(f"{k:10} correct {r} of {t}")
