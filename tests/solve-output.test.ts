import assert from "node:assert/strict";
import { test } from "node:test";

import { SolveValidationError, validateCandidatesResponse, validateExplanationResponse } from "../src/lib/solve-output";
import { candidatesResponse, explanation, graphCandidate, providerBody } from "./method-fixtures";

function stage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof SolveValidationError) return error.stage;
    throw error;
  }
  return "accepted";
}

test("provider truncation and JSON syntax errors are distinguished from schema errors", () => {
  assert.equal(stage(() => validateCandidatesResponse({ ...providerBody(candidatesResponse()), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })), "model_output");
  assert.equal(stage(() => validateCandidatesResponse(providerBody("{ not json"))), "json");
  assert.equal(stage(() => validateCandidatesResponse(providerBody({ status: "solved" }))), "zod");
  assert.equal(stage(() => validateExplanationResponse({ ...providerBody(explanation()), status: "incomplete" })), "model_output");
  assert.equal(stage(() => validateExplanationResponse(providerBody("[]"))), "zod");
});

test("a valid candidates response is parsed unchanged and reports no repairs", () => {
  const { parsed, repairs } = validateCandidatesResponse(providerBody(candidatesResponse()));
  assert.deepEqual(repairs, []);
  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.candidates[0].techniqueId, "intercept-read");
});

test("only metadata that follows from a candidate's own plan is repaired", () => {
  const candidate = graphCandidate({ answer: "" }) as Record<string, unknown>;
  const result = { ...(candidate.result as Record<string, unknown>) };
  delete result.listIndex;
  delete result.choiceLabel;
  delete result.relatedRows;
  candidate.result = result;
  delete candidate.graphBounds;
  const { parsed, repairs } = validateCandidatesResponse(providerBody(candidatesResponse([candidate as ReturnType<typeof graphCandidate>])));
  const [repaired] = parsed.candidates;
  assert.equal(repaired.answer, "3", "the answer follows from result.value");
  assert.equal(repaired.graphBounds, null);
  assert.deepEqual(repaired.result.relatedRows, []);
  assert.deepEqual(repaired.rows, graphCandidate().rows, "no mathematical row is touched");
  assert.equal(repairs.length, 5);
});

test("a free-form technique name, a missing cost, or a legacy result fails at the schema layer", () => {
  for (const broken of [
    { ...graphCandidate(), techniqueId: "Graph both sides" },
    { ...graphCandidate(), cost: undefined },
    { ...graphCandidate(), result: { row: 1, value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "x" } },
  ]) {
    assert.equal(stage(() => validateCandidatesResponse(providerBody(candidatesResponse([broken as ReturnType<typeof graphCandidate>])))), "zod");
  }
});

test("an explanation must be the exact explanation fields, no extras", () => {
  assert.equal(stage(() => validateExplanationResponse(providerBody(explanation(2)))), "accepted");
  assert.equal(stage(() => validateExplanationResponse(providerBody({ ...explanation(), rows: [] }))), "zod");
  assert.equal(stage(() => validateExplanationResponse(providerBody({ ...explanation(), why: "" }))), "zod");
});
