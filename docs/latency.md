# Latency: where a solve's time goes

Everything here was measured, and every number says what it was measured on.
Live model latency could not be re-measured in the session that wrote this
(no `OPENAI_API_KEY` in that environment), so model-side numbers come from
the live runs recorded in `evals/results/` by the previous harness, and the
new instrumentation is in place for the next live run.

## Time to first useful result (recorded live runs)

"First useful result" is the `methods` event: the calculator rows, answer,
and every technique, before the explanation. It is what the student sees
first (`timings.methodsMs` in the pipeline). These runs are in-process, so
they exclude auth, upload, and database round-trips.

| Run (prompt version) | Runs | First useful p50 / p75 / p95 (ms) | Complete p50 / p95 (ms) | Explanation after first result, p50 |
|---|---|---|---|---|
| post (73f0990e) | 74 | 8,747 / 10,442 / 21,404 | 11,612 / 26,111 | 2,806 |
| post-v2 (73f0990e) | 75 | 8,969 / 10,713 / 24,426 | 12,286 / 27,226 | 3,011 |
| before-enum (73f0990e) | 80 | 10,290 / 12,993 / 24,939 | 13,731 / 27,562 | 3,352 |
| after-enum (bb3e99e8, newest recorded) | 55* | 14,917 / 16,938 / 25,919 | 18,253 / 28,712 | 3,365 |

\* 25 of its 80 runs failed on an exhausted OpenAI balance; those are excluded.

Findings:

1. **Model generation of call 1 is the bottleneck.** The first useful result
   is almost entirely the candidates call (transcription + every technique's
   rows, readout, and cost). The explanation is already deferred (PASS 2): it
   adds about 3 s after the student has the calculator, and alternate methods'
   explanations are generated only when opened.
2. **The tail is validation retries.** Runs that needed a guided correction
   reached their first result at a median 22–31 s, against 9–15 s for runs
   without one; 4–20% of runs retried. Every false rejection removed is a
   p95 improvement. This branch removes several: readout-type slips are
   repaired instead of rejected, the prompt's own small-system regression is
   no longer rejected as underdetermined, and a truncated response is retried
   with twice the output cap instead of more reasoning under the same cap.
3. **The technique-enum change made solves ~45% slower at the median**
   (10.3 s → 14.9 s on the same day's problems). The prompt has grown since.
   This is the first thing to re-measure with `npm run bench:solver`.
4. **The Desmos rescue trades latency for strategy quality on a minority of
   solves.** It adds one candidates call (~9–15 s) only when a math-heavy
   default stands because a cheaper Desmos technique was rejected for a slip:
   5–10% of recorded runs. `DESMO_DESMOS_RESCUE=off` turns it off for A/B.

## Input size (measured, `npm run bench:prompt`)

Call 1 is about **30,000 input tokens before the image** (o200k tokenizer):
rules and cost model 8.7K, strategy library 14.7K (policy 1.9K + strategies
12.8K), training examples 4.7K, output schema 1.5K. The README's "17K" was
stale. The prefix is identical on every request and sent with a stable
`prompt_cache_key`; organizations without zero-data retention get 24-hour
prompt-cache retention by default (OpenAI SDK docs), so after the first
request it is mostly cached. The new stage trace records `cached` tokens per
call, so the next live run shows the real hit rate.

Selective strategy retrieval (sending only the strategies relevant to the
problem) would cut call-1 input by roughly 40%, but the problem text is not
known until call 1 has read the image, so it needs an extra sequential call
or a text-first input. With a warm cache, input tokens are cheap and fast
compared with generating 1,600–3,200 output tokens; retrieval is not worth
its quality risk unless the trace shows frequent cache misses.

## Server and browser overhead (measured here)

| Stage | Measured | Where |
|---|---|---|
| Image validation (decode, limits) | 8–25 ms | 1000×620 to 1290×2796 PNGs |
| Image downscale for the model | 1–95 ms | resize to ≤1600 px |
| Desmos API script parse + eval | 628 ms | served locally (network excluded); loads at page load, before the student uploads |
| Visible calculator creation | 135 ms | once per page |
| Hidden pre-flight engine creation | 18–61 ms | once per page |
| Pre-flight check of one method | p50 80 ms, p95 88 ms (includes the 60 ms quiet window) | 57 recorded calculator plans |

Browser-side work after the rows arrive is about 0.1–0.2 s against 9–15 s of
model time: not worth optimizing. Image handling is under 1%.

Streaming change: the `solution` event (the explanation) used to wait for
the history save (an image upload and a row insert) before it was sent. It
is now sent first, and a separate `saved` event follows, so the explanation
never waits on storage.

## Instrumentation added

- **Server-Timing** on every solve: request stages (`auth`, `upload`,
  `image_validate`, `reserve`, `image_prepare`, `context`) and pipeline
  stages (`cache_lookup`, `model_candidates` with token usage,
  `validate_select`, `cache_write`, `desmos_rescue`, `resolve`,
  `explanation`). The streamed response's headers time everything up to the
  calculator rows.
- **Browser timing** (`src/lib/client-timing.ts`): per solve, ms to response
  headers, `methods`, rows shown after pre-flight, and the explanation, plus
  the server stages, on `window.__desmoTimings` (logged in development).
- **Benchmark** (`npm run bench:solver`): first-useful and complete p50/p75/p95,
  per-stage p50/p95, and mean input/cached/output/reasoning tokens per solve.

## Recommended experiments (run with the benchmark; adopt only if accuracy and strategy quality hold)

1. Re-measure the current prompt (`npm run bench:solver -- current`), then
   `DESMO_DESMOS_RESCUE=off` to price the rescue.
2. Output tokens drive latency: compare `OPENAI_MODEL` candidates the account
   can use, at the same reasoning effort, on accuracy and gold-strategy rate.
   README notes `minimal` effort was ~2× faster but answered r+s wrongly, so
   effort changes must be judged on the hard group.
3. If the trace shows cache misses on most solves (low-traffic hours), test
   trimming the duplicated policy text shared by the rules and the library
   preamble before considering retrieval.
4. A "fast first candidate" architecture (a short call for the default
   technique in parallel with the full candidate call) could cut time to first
   result substantially but doubles call-1 cost and can change the default
   after it is shown; only worth building if experiments 1–3 fall short.
