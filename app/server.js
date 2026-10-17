// shop: a tiny HTTP service with three endpoints. The SAME image runs as stable and as canary.
// FAULT lets us inject a known problem into the canary, so every scenario has a ground truth:
//   none     identical behaviour                                   -> should PROMOTE
//   errors   2% of /checkout requests fail with a 500              -> should ROLL BACK
//   slow     2% of /search requests take an extra 600 ms (tail)    -> should ROLL BACK
//   warmup   slower for the first 60 s (cold cache), then normal   -> should PROMOTE
const http = require("http");
const VERSION = process.env.VERSION || "1.0";
const FAULT = process.env.FAULT || "none";
const started = Date.now();
const BASE = { "/browse": 20, "/search": 45, "/checkout": 80 };      // typical cost in ms
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

http.createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  if (path === "/healthz") return res.end("ok");
  if (!BASE[path]) { res.writeHead(404); return res.end(); }
  let ms = BASE[path] * (0.7 + Math.random() * 0.6);                    // normal jitter
  if (Math.random() < 0.005) ms += BASE[path] * 3;                      // the odd slow request, everywhere
  let status = 200;
  if (FAULT === "errors" && path === "/checkout" && Math.random() < 0.02) status = 500;
  if (FAULT === "slow" && path === "/search" && Math.random() < 0.02) ms += 600;
  const age = Date.now() - started;
  if (FAULT === "warmup" && age < 60000) ms += 150 * (1 - age / 60000);  // cold cache, fades over a minute
  await sleep(ms);
  res.writeHead(status, { "x-version": VERSION, "content-type": "application/json" });
  res.end(JSON.stringify({ ok: status === 200, version: VERSION }));
}).listen(8080, () => console.log(`shop ${VERSION} (fault=${FAULT}) listening on 8080`));
