#!/bin/bash
# run-canary.sh <FAULT> <LABEL>: deploy a canary with FAULT, load-test stable + canary together for 120 s,
# and save every request to metrics/canary-<LABEL>.jsonl. Each line: {t, path, version, status, ms}.
set -e
FAULT="$1"; LABEL="$2"
echo "### 1. replace the canary (VERSION=1.1, FAULT=$FAULT)"
kubectl delete deployment shop-canary --ignore-not-found --wait=true
sed "s/\${FAULT}/$FAULT/" k8s/canary.yaml | kubectl apply -f -
kubectl rollout status deployment/shop-canary --timeout=120s
kubectl get pods -l app=shop -L track
echo "### 2. load test: 80 requests/s for 120 s, from inside the cluster"
kubectl delete job loadgen --ignore-not-found --wait=true
kubectl apply -f k8s/loadgen.yaml
kubectl wait --for=condition=complete job/loadgen --timeout=300s
echo "### 3. collect every request"
kubectl logs job/loadgen | grep "^{" > metrics/canary-$LABEL.jsonl   # JSON lines only: loadgen also prints "done: N"
wc -l < metrics/canary-$LABEL.jsonl | xargs echo "requests recorded:"
node -e '
const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
const by = {}; for (const r of rows) (by[r.version] ||= []).push(r);
for (const [v, rs] of Object.entries(by)) console.log(`  version ${v}: ${rs.length} requests (${(100 * rs.length / rows.length).toFixed(1)}%)`);
' metrics/canary-$LABEL.jsonl
