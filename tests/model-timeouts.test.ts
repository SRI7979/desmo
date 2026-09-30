import assert from "node:assert/strict";
import { test } from "node:test";

import { modelTimeouts } from "../src/lib/solve-pipeline";

test("hard candidate generation gets a useful default budget while overrides remain bounded by the route", () => {
  assert.deepEqual(modelTimeouts({}), { candidatesMs: 60_000, explanationMs: 30_000 });
  assert.deepEqual(modelTimeouts({ CANDIDATES_TIMEOUT_MS: "75000", EXPLANATION_TIMEOUT_MS: "45000" }), {
    candidatesMs: 75_000,
    explanationMs: 45_000,
  });
  assert.deepEqual(modelTimeouts({ CANDIDATES_TIMEOUT_MS: "invalid", EXPLANATION_TIMEOUT_MS: "0" }), {
    candidatesMs: 60_000,
    explanationMs: 30_000,
  });
});
