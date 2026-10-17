#!/bin/bash
# run-judges.sh: every canary (A-D) x both modes x 5 runs = 40 blind judgements, 8 at a time.
# Each run: review/<canary>-<mode>-<n>/{decision.json, decision.harness.json, log.jsonl, console.txt}
one() { set -- $1; python -u agent/judge.py --canary "$1" --mode "$2" --run "$3" > "review/$1-$2-$3.console.txt" 2>&1; echo "$1 $2 $3 exit=$?"; }
export -f one
for m in dashboard evidence; do for x in A B C D; do for n in 1 2 3 4 5; do echo "$x $m $n"; done; done; done | xargs -P 8 -I{} bash -c 'one "{}"'
