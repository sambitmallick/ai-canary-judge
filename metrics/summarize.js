// The dashboard: what an on-call engineer would look at for a canary. node metrics/summarize.js <A|B|C|D>
// Reads metrics/canary-<X>.jsonl (one line per request) and prints per-version, per-endpoint and per-30s numbers.
const fs = require("fs");
const X = process.argv[2];
const rows = fs.readFileSync(`metrics/canary-${X}.jsonl`, "utf8").trim().split("\n").map(JSON.parse);
const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stat = (rs) => {
  const ms = rs.map((r) => r.ms), err = rs.filter((r) => r.status >= 500 || r.status === 0).length;
  return { n: rs.length, err, rate: rs.length ? (100 * err) / rs.length : 0, p50: pct(ms, 0.5), p95: pct(ms, 0.95), p99: pct(ms, 0.99) };
};
const V = { stable: "1.0", canary: "1.1" };
const line = (label, s) => `${label.padEnd(22)} ${String(s.n).padStart(6)} ${String(s.err).padStart(5)} ${s.rate.toFixed(2).padStart(6)}% ${String(s.p50).padStart(6)} ${String(s.p95).padStart(6)} ${String(s.p99).padStart(6)}`;
const head = `${"".padEnd(22)} ${"reqs".padStart(6)} ${"5xx".padStart(5)} ${"err%".padStart(7)} ${"p50ms".padStart(6)} ${"p95ms".padStart(6)} ${"p99ms".padStart(6)}`;
const out = [`CANARY ${X}: stable = version 1.0 (3 pods), canary = version 1.1 (1 pod). 120 s load test, 80 req/s, ${rows.length} requests.`, "", head];
for (const [k, v] of Object.entries(V)) out.push(line(`${k} (all)`, stat(rows.filter((r) => r.version === v))));
for (const path of ["/browse", "/search", "/checkout"]) {
  out.push("");
  for (const [k, v] of Object.entries(V)) out.push(line(`${k} ${path}`, stat(rows.filter((r) => r.version === v && r.path === path))));
}
out.push("", "over time (canary vs stable):", `${"window".padEnd(10)} ${"canary p95".padStart(11)} ${"stable p95".padStart(11)} ${"canary 5xx".padStart(11)} ${"stable 5xx".padStart(11)}`);
for (let w = 0; w < 120; w += 30) {
  const inW = rows.filter((r) => r.t >= w && r.t < w + 30), c = stat(inW.filter((r) => r.version === V.canary)), s = stat(inW.filter((r) => r.version === V.stable));
  out.push(`${`${w}-${w + 30}s`.padEnd(10)} ${String(c.p95).padStart(11)} ${String(s.p95).padStart(11)} ${String(c.err).padStart(11)} ${String(s.err).padStart(11)}`);
}
console.log(out.join("\n"));
