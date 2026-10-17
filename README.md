# ai-canary-judge: I let AI decide my canary rollbacks

Companion repo to a [DevOps Autopilot](https://www.youtube.com/@DevOpsAutopilot) episode. Every command in the
video was run for real; its full output is in [`commands/`](commands).

A small shop service (three endpoints) runs in a local [kind](https://kind.sigs.k8s.io) cluster: 3 stable pods
and 1 canary pod behind one Service, so the canary takes ~25% of traffic. A load test runs **inside** the cluster
(80 requests/s for 120 s) and records every request. Then a judge decides: **PROMOTE** or **ROLLBACK**.

Each canary has a known right answer, because the problem is injected with an environment variable
([`app/server.js`](app/server.js)). The judges never see which.

| canary | what's wrong | right call |
|---|---|---|
| A | slow for the first minute (cold cache), then identical | PROMOTE |
| B | 2% of `/checkout` requests fail | ROLLBACK |
| C | nothing | PROMOTE |
| D | 2% of `/search` requests take an extra 600 ms: the tail only | ROLLBACK |

Three judges:

| judge | sees | decides |
|---|---|---|
| **code v1** ([`judge/stats.js`](judge/stats.js)) | the raw requests | errors: Fisher's exact test. latency: canary p99 > 1.5x stable p99 after a 60 s bake-in |
| **AI, dashboard** | the dashboard only ([`metrics/canary-*.dashboard.txt`](metrics)): per-endpoint p50/p95/p99, errors, 30 s windows | PROMOTE or ROLLBACK, and why |
| **AI, evidence** | the dashboard + `run_query`: JavaScript over that canary's raw log, run by the harness in a read-only sandbox ([`probe/query.js`](probe/query.js)) | the same, but every factual claim needs a query, and the harness runs every query before it accepts |

The AI judges are blind: no file access at all. 5 runs per canary per mode = 40 judgements. $0: a local model call.

```bash
kind create cluster --name canary
podman build -t localhost/shop:1.0 app/ && podman save -o shop.tar localhost/shop:1.0
kind load image-archive shop.tar --name canary
kubectl apply -f k8s/stable.yaml
bash run-canary.sh slow D                          # deploy a canary, load-test, collect metrics/canary-D.jsonl
node metrics/summarize.js D                        # the dashboard
node judge/stats.js D                              # no-AI check v1
python agent/judge.py --canary D --mode evidence   # the AI judge
python agent/test_judge.py                         # 13 checks, no model
python judge/score.py                              # the scoreboard
```

## Results ([`commands/24_scoreboard.txt`](commands/24_scoreboard.txt))

| canary | right call | code v1 | AI, dashboard | AI, evidence |
|---|---|---|---|---|
| A warm-up | PROMOTE | **ROLLBACK** (wrong) | 5/5 | 5/5 |
| B errors | ROLLBACK | ok | 5/5 | 5/5 |
| C clean | PROMOTE | ok | 5/5 | 5/5 |
| D slow tail | ROLLBACK | ok | **1/5** | 5/5 |

**The dashboard AI promoted the tail regression 4 times out of 5.** It saw `/search` p99 at 652 ms against 61 ms,
and explained it away: "p99 over 729 requests is set by the 7 slowest, p50 and p95 are identical, so it's
noise, probably a cold start". That's exactly the reasoning that was **right** for canary A, where code v1 failed
a good canary on a p99 of 180 ms set by 5 unlucky requests out of 400.

**The evidence AI was right 20 of 20.** It didn't read percentiles; it counted. On D: *18 of 729 canary searches
took more than 200 ms, 0 of 2,273 stable searches did, spread across the whole run (3.2 s to 113.3 s)*. On A: *272
slow canary requests in the first 30 s, 6 after 60 s; after 60 s, p95 and p99 match stable.* It cost 8 steps on
average, against 2.9 for the dashboard.

## The AI found the measurement. Then the measurement went into code.

[`judge/stats2.js`](judge/stats2.js) does what the evidence runs did: per endpoint, after the bake-in, **count**
requests slower than 2x stable's p99, and ask with Fisher's exact test whether the canary has more of them than its
share of traffic. It's right on A-D. But it was written **after** seeing A-D, so it got a fair test: four fresh
load tests, E-H, that neither check was tuned on ([`commands/23_holdout-check.txt`](commands/23_holdout-check.txt)):

| | E slow | F clean | G errors | H warm-up | total (A-H) |
|---|---|---|---|---|---|
| right call | ROLLBACK | PROMOTE | ROLLBACK | PROMOTE | |
| code v1 (p99 ratio) | ok | **ROLLBACK** (wrong, p99 noise) | ok | ok | 6 of 8 |
| code v2 (count slow requests) | ok | ok | ok | ok | **8 of 8** |

One second, the same answer every time, no model.

## The rules

1. **Don't let anyone judge a canary from percentiles alone.** p99 over a few hundred samples is a few requests.
2. **Count, then test.** "How many requests were slow, compared with its share of traffic?" is the real question.
3. **Give the AI the raw data, and make it prove what it says.** Dashboard-only: 16 of 20. Evidence: 20 of 20.
4. **Use the AI to find the measurement, then put the measurement in code.** Deterministic, cheap, reviewable.
5. **Validate on data you didn't tune on.** v1 failed a clean canary there too.

---
🎬 Full walkthrough: **[the video](https://youtu.be/BZKz2WRTyFg)** · channel: **[DevOps Autopilot](https://www.youtube.com/@DevOpsAutopilot)**
