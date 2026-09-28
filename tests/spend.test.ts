import assert from "node:assert/strict";
import { test } from "node:test";

import { costUsd, MODEL_RATES, rateFor, timeoutEstimate, usageFrom } from "../src/lib/model-pricing";
import { createMemoryUsageStore, createMeter, DailyCapError, limitsFromEnv, SpendCeilingError, UsageUnavailableError } from "../src/lib/spend";

test("regression test 3 (math): cost = uncached input + cached input + output (reasoning included), at the tier OpenAI billed", () => {
  // A real candidates call from the dev log: 28,763 input (28,672 cached), 1,351 output (832 reasoning).
  const usage = usageFrom({
    input_tokens: 28763,
    input_tokens_details: { cached_tokens: 28672 },
    output_tokens: 1351,
    output_tokens_details: { reasoning_tokens: 832 },
    total_tokens: 30114,
  });
  assert.deepEqual(usage, { inputTokens: 28763, cachedTokens: 28672, outputTokens: 1351, reasoningTokens: 832, totalTokens: 30114 });
  const priority = rateFor("gpt-5-mini", "priority");
  assert.deepEqual(priority, { rate: { input: 0.45, cachedInput: 0.045, output: 3.6 }, known: true });
  assert.equal(costUsd(usage, priority.rate), 0.006195, "91 × $0.45 + 28,672 × $0.045 + 1,351 × $3.60, per 1M");
  assert.equal(costUsd(usage, rateFor("gpt-5-mini", "default").rate), 0.003442, "the same call on the default tier: 91 × $0.25 + 28,672 × $0.025 + 1,351 × $2.00");
  assert.equal(costUsd(usageFrom({ input_tokens: 1_000_000, output_tokens: 1_000_000 }), MODEL_RATES["gpt-5"].default), 11.25);
});

test("dated snapshots use their base model's price; unknown models are priced high, never free", () => {
  assert.equal(rateFor("gpt-5-mini-2025-08-07", "default").rate.input, 0.25, "not priced as gpt-5");
  assert.equal(rateFor("gpt-5-2025-08-07", "priority").rate.output, 20);
  assert.equal(rateFor("gpt-5-nano", "priority").rate.output, 0.4, "no priority rate: the default rate applies");
  const unknown = rateFor("some-new-model", "default");
  assert.equal(unknown.known, false);
  assert.ok(unknown.rate.output >= Math.max(...Object.values(MODEL_RATES).map((rates) => (rates.priority ?? rates.default).output)));
  assert.deepEqual(usageFrom(undefined), { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 });
  assert.ok(timeoutEstimate("candidates", 8000).outputTokens === 8000, "a timeout is estimated at the full output allowance");
});

test("limits come from env on every call, with the documented defaults", () => {
  assert.deepEqual(limitsFromEnv({}), { freeSolvesPerDay: 15, dailySpendCeilingUsd: 5 });
  assert.deepEqual(limitsFromEnv({ FREE_SOLVES_PER_DAY: "3", DAILY_SPEND_CEILING_USD: "12.5" }), { freeSolvesPerDay: 3, dailySpendCeilingUsd: 12.5 });
  assert.deepEqual(limitsFromEnv({ FREE_SOLVES_PER_DAY: "lots", DAILY_SPEND_CEILING_USD: "-1" }), { freeSolvesPerDay: 15, dailySpendCeilingUsd: 5 }, "invalid values fall back");
});

test("the meter checks the ceiling before the user's slot, and fails closed when usage cannot be read", async () => {
  const store = createMemoryUsageStore();
  const meter = createMeter({ store, userId: "u1", solveId: "s1", limits: { freeSolvesPerDay: 1, dailySpendCeilingUsd: 1 } });
  await meter.authorizeSolve();
  await assert.rejects(meter.authorizeSolve(), DailyCapError);
  await store.record({ ...(await meter.record("candidates", { status: "completed", model: "gpt-5", serviceTier: "default", usage: { input_tokens: 0, output_tokens: 100_000 } })) });
  const other = createMeter({ store, userId: "u2", solveId: "s2", limits: { freeSolvesPerDay: 5, dailySpendCeilingUsd: 1 } });
  await assert.rejects(other.authorizeSolve(), SpendCeilingError, "over $1 today: nobody starts a new solve");
  assert.equal(store.solves.filter((solve) => solve.userId === "u2").length, 0, "a refused solve does not use up the user's quota");
  const broken = createMeter({
    store: { ...store, spentTodayUsd: async () => { throw new Error("relation does not exist"); } },
    userId: "u3",
    solveId: "s3",
    limits: { freeSolvesPerDay: 5, dailySpendCeilingUsd: 5 },
  });
  await assert.rejects(broken.authorizeSolve(), UsageUnavailableError);
});
