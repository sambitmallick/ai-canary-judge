// The no-AI baseline. node judge/stats.js <A|B|C|D>
// Two rules, written down, the same every time:
//   errors : per endpoint, is the canary's error rate higher than stable's? Fisher's exact test, one-sided, p < 0.01
//   latency: per endpoint, after a 60 s bake-in, is canary p99 more than 1.5x stable p99 (and at least 50 ms worse)?
// Any failure -> ROLLBACK. Otherwise PROMOTE.
const fs = require("fs");
const X = process.argv[2];
const rows = fs.readFileSync(`metrics/canary-${X}.jsonl`, "utf8").trim().split("\n").map(JSON.parse);
const BAKE_IN = Number(process.env.BAKE_IN ?? 60);
const lf = [0]; for (let i = 1; i <= 20000; i++) lf[i] = lf[i - 1] + Math.log(i);
const hyper = (a, b, c, d) => Math.exp(lf[a + b] + lf[c + d] + lf[a + c] + lf[b + d] - lf[a] - lf[b] - lf[c] - lf[d] - lf[a + b + c + d]);
function fisherGreater(a, b, c, d) { // P(canary errors >= a) given margins; a,b = canary err/ok; c,d = stable err/ok
  let p = 0; const r1 = a + b, c1 = a + c, n = a + b + c + d;
  for (let x = a; x <= Math.min(r1, c1); x++) p += hyper(x, r1 - x, c1 - x, n - r1 - c1 + x);
  return Math.min(1, p);
}
const pct = (xs, p) => { const s = [...xs].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const isErr = (r) => r.status >= 500 || r.status === 0;
const fails = [];
console.log(`CANARY ${X}  (bake-in ${BAKE_IN}s)`);
for (const path of ["/browse", "/search", "/checkout"]) {
  const c = rows.filter((r) => r.version === "1.1" && r.path === path), s = rows.filter((r) => r.version === "1.0" && r.path === path);
  const ce = c.filter(isErr).length, se = s.filter(isErr).length;
  const p = fisherGreater(ce, c.length - ce, se, s.length - se);
  const cs = c.filter((r) => r.t >= BAKE_IN).map((r) => r.ms), ss = s.filter((r) => r.t >= BAKE_IN).map((r) => r.ms);
  const c99 = pct(cs, 0.99), s99 = pct(ss, 0.99);
  const errFail = ce > 0 && p < 0.01, latFail = cs.length >= 50 && c99 > 1.5 * s99 && c99 - s99 >= 50;
  console.log(`  ${path.padEnd(10)} errors canary ${ce}/${c.length} vs stable ${se}/${s.length}  p=${p.toFixed(4)} ${errFail ? "FAIL" : "ok  "} | p99 after bake-in canary ${c99}ms vs stable ${s99}ms ${latFail ? "FAIL" : "ok"}`);
  if (errFail) fails.push(`${path} error rate`);
  if (latFail) fails.push(`${path} p99 latency`);
}
console.log(fails.length ? `VERDICT: ROLLBACK (${fails.join(", ")})` : "VERDICT: PROMOTE");
