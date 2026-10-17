// The no-AI check, version 2: what the evidence-mode judges actually measured, written down as code.
// node judge/stats2.js <A|B|C|D>
//   errors : per endpoint, canary error rate higher than stable's? Fisher's exact test, one-sided, p < 0.01   (unchanged)
//   latency: per endpoint, after a 60 s bake-in, COUNT the slow requests -- slower than 2x stable's p99 --
//            and ask whether the canary has more of them than its share of traffic: Fisher's exact test, p < 0.01.
// Version 1 compared two p99 values. With ~400 canary samples, p99 is set by 4 requests: one unlucky draw
// fails a good canary (A). Counting asks the real question: does the canary make slow requests MORE OFTEN?
const fs = require("fs");
const X = process.argv[2];
const rows = fs.readFileSync(`metrics/canary-${X}.jsonl`, "utf8").trim().split("\n").map(JSON.parse);
const BAKE_IN = 60;
const lf = [0]; for (let i = 1; i <= 20000; i++) lf[i] = lf[i - 1] + Math.log(i);
const hyper = (a, b, c, d) => Math.exp(lf[a + b] + lf[c + d] + lf[a + c] + lf[b + d] - lf[a] - lf[b] - lf[c] - lf[d] - lf[a + b + c + d]);
function fisherGreater(a, b, c, d) {
  let p = 0; const r1 = a + b, c1 = a + c, n = a + b + c + d;
  for (let x = a; x <= Math.min(r1, c1); x++) p += hyper(x, r1 - x, c1 - x, n - r1 - c1 + x);
  return Math.min(1, p);
}
const pct = (xs, p) => { const s = [...xs].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const isErr = (r) => r.status >= 500 || r.status === 0;
const fails = [];
console.log(`CANARY ${X}  (bake-in ${BAKE_IN}s, slow = slower than 2x stable p99)`);
for (const path of ["/browse", "/search", "/checkout"]) {
  const c = rows.filter((r) => r.version === "1.1" && r.path === path), s = rows.filter((r) => r.version === "1.0" && r.path === path);
  const ce = c.filter(isErr).length, se = s.filter(isErr).length;
  const pe = fisherGreater(ce, c.length - ce, se, s.length - se);
  const cb = c.filter((r) => r.t >= BAKE_IN), sb = s.filter((r) => r.t >= BAKE_IN);
  const limit = 2 * pct(sb.map((r) => r.ms), 0.99);
  const cs = cb.filter((r) => r.ms > limit).length, ss = sb.filter((r) => r.ms > limit).length;
  const pl = fisherGreater(cs, cb.length - cs, ss, sb.length - ss);
  const errFail = ce > 0 && pe < 0.01, latFail = pl < 0.01;
  console.log(`  ${path.padEnd(10)} errors ${ce}/${c.length} vs ${se}/${s.length} p=${pe.toFixed(4)} ${errFail ? "FAIL" : "ok  "} | slow (>${limit}ms) canary ${cs}/${cb.length} vs stable ${ss}/${sb.length} p=${pl.toFixed(4)} ${latFail ? "FAIL" : "ok"}`);
  if (errFail) fails.push(`${path} error rate`);
  if (latFail) fails.push(`${path} slow requests`);
}
console.log(fails.length ? `VERDICT: ROLLBACK (${fails.join(", ")})` : "VERDICT: PROMOTE");
