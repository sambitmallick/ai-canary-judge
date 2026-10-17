#!/bin/bash
# re-run only the evidence mode (its first attempt crashed before any model call: a brace in the tool docs)
one() { set -- $1; python -u agent/judge.py --canary "$1" --mode "$2" --run "$3" > "review/$1-$2-$3.console.txt" 2>&1; echo "$1 $2 $3 exit=$?"; }
export -f one
for x in A B C D; do for n in 1 2 3 4 5; do echo "$x evidence $n"; done; done | xargs -P 8 -I{} bash -c 'one "{}"'
