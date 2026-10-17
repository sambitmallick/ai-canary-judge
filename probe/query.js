// HARNESS-OWNED. Runs ONE agent-written query over ONE canary's raw request log, in its own process,
// under Node's permission model (read-only files, no child processes). Usage: node probe/query.js <A|B|C|D>
// The query (stdin) gets these names and nothing else:
//   rows     every request: {t (s since start), path, version ("1.0" stable / "1.1" canary), status, ms}
//   stable   rows with version 1.0        canary   rows with version 1.1
//   pct(xs, p)   percentile of an array of numbers, p in 0..1
//   print(...)   output: this is what the harness compares against the claim
const fs = require("fs"), path = require("path");
const X = process.argv[2];
const rows = fs.readFileSync(path.join(__dirname, "..", "metrics", `canary-${X}.jsonl`), "utf8").trim().split("\n").map(JSON.parse);
const stable = rows.filter((r) => r.version === "1.0"), canary = rows.filter((r) => r.version === "1.1");
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
let out = "";
const print = (...a) => { out += a.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" ") + "\n"; };
let src = "";
process.stdin.on("data", (c) => (src += c));
process.stdin.on("end", () => {
  try { new Function("rows", "stable", "canary", "pct", "print", src)(rows, stable, canary, pct, print); }
  catch (e) { out += `QUERY ERROR: ${e && e.message}\n`; }
  process.stdout.write(out.slice(0, 4000));
});
