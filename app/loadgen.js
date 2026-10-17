// loadgen: runs INSIDE the cluster as a Job. Fires requests at a fixed rate at the shop Service,
// a fresh connection per request (so kube-proxy spreads them across stable and canary pods),
// and prints one JSON line per request: when, which endpoint, which version answered, status, latency.
const http = require("http");
const RATE = Number(process.env.RATE || 80), SECONDS = Number(process.env.SECONDS || 120);
const MIX = [["/browse", 0.5], ["/search", 0.3], ["/checkout", 0.2]];
const pick = () => { let r = Math.random(); for (const [p, w] of MIX) { if ((r -= w) < 0) return p; } return MIX[0][0]; };
const t0 = Date.now();
let pending = 0, sent = 0;
function fire() {
  const path = pick(), start = Date.now();
  pending++;
  const req = http.get({ host: "shop", port: 80, path, agent: false, timeout: 5000 }, (res) => {
    res.resume();
    res.on("end", () => {
      pending--;
      console.log(JSON.stringify({ t: +((start - t0) / 1000).toFixed(2), path, version: res.headers["x-version"] || "?", status: res.statusCode, ms: Date.now() - start }));
    });
  });
  req.on("error", () => { pending--; console.log(JSON.stringify({ t: +((start - t0) / 1000).toFixed(2), path, version: "?", status: 0, ms: Date.now() - start })); });
}
const timer = setInterval(() => {
  if (Date.now() - t0 >= SECONDS * 1000) { clearInterval(timer); const w = setInterval(() => { if (!pending) { clearInterval(w); console.error(`done: ${sent} requests`); } }, 100); return; }
  fire(); sent++;
}, 1000 / RATE);
