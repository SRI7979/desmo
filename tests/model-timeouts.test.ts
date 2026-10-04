import assert from "node:assert/strict";
import { test } from "node:test";

import { modelTimeouts } from "../src/lib/solve-pipeline";

test("hard candidate generation gets a useful default budget while overrides remain bounded by the route", () => {
  assert.deepEqual(modelTimeouts({}), { candidatesMs: 60_000, explanationMs: 30_000 });
  assert.deepEqual(modelTimeouts({ NODE_ENV: "production", CANDIDATES_TIMEOUT_MS: "20000" }), {
    candidatesMs: 60_000,
    explanationMs: 30_000,
  });
  assert.deepEqual(modelTimeouts({ NODE_ENV: "test", CANDIDATES_TIMEOUT_MS: "80" }), {
    candidatesMs: 80,
    explanationMs: 30_000,
  });
  assert.deepEqual(modelTimeouts({ CANDIDATES_TIMEOUT_MS: "75000", EXPLANATION_TIMEOUT_MS: "45000" }), {
    candidatesMs: 75_000,
    explanationMs: 45_000,
  });
  assert.deepEqual(modelTimeouts({ CANDIDATES_TIMEOUT_MS: "invalid", EXPLANATION_TIMEOUT_MS: "0" }), {
    candidatesMs: 60_000,
    explanationMs: 30_000,
  });
});

test("a truncated response is retried with twice the output cap at the configured effort, not more reasoning", async () => {
  const { outputTokenLimit, wasTruncated } = await import("../src/lib/solve-pipeline");
  const truncated = { stage: "model_output", reason: 'Response status incomplete; incomplete_details={"reason":"max_output_tokens"}', previous: "" };
  const rejected = { stage: "zod", reason: "candidates.0.rows: Required", previous: "" };
  assert.equal(wasTruncated(truncated), true);
  assert.equal(wasTruncated(rejected), false);
  assert.equal(outputTokenLimit(8000, truncated), 16000);
  assert.equal(outputTokenLimit(8000, rejected), 8000);
  assert.equal(outputTokenLimit(8000, undefined), 8000);
});
