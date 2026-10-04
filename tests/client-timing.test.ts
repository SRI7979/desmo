import assert from "node:assert/strict";
import { test } from "node:test";

import { parseServerTiming, startSolveTiming } from "../src/lib/client-timing";

test("Server-Timing durations are parsed by stage; descriptions without a duration are skipped", () => {
  assert.deepEqual(
    parseServerTiming('methods;dur=812.4, cache;desc="miss", model_candidates;dur=790, auth;dur=12, calls;desc="1+0"'),
    { methods: 812.4, model_candidates: 790, auth: 12 },
  );
  assert.deepEqual(parseServerTiming(null), {});
});

test("a solve timer keeps the first occurrence of each mark, relative to its start", () => {
  let clock = 1000;
  const timer = startSolveTiming(() => clock);
  clock = 1200;
  timer.mark("response");
  clock = 1500;
  timer.mark("rows_shown");
  clock = 1900;
  timer.mark("rows_shown");
  timer.serverTiming("methods;dur=150");
  const timing = timer.finish();
  assert.deepEqual(timing.marks, { response: 200, rows_shown: 500 });
  assert.deepEqual(timing.server, { methods: 150 });
});
