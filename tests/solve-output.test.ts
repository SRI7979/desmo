import assert from "node:assert/strict";
import { test } from "node:test";

import { SolveValidationError, validateCandidatesResponse, validateExplanationResponse } from "../src/lib/solve-output";
import { selectMethods } from "../src/lib/strategy-selection";
import { candidatesResponse, explanation, graphCandidate, paperCandidate, providerBody } from "./method-fixtures";

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

test("Bedrock radical model: a matching value on a written result is redundant, not a failed solve", () => {
  const written = paperCandidate({
    techniqueId: "direct-arithmetic",
    answer: "122",
    result: {
      type: "written", row: null, relatedRows: [], value: 122, listIndex: null,
      answerFrom: "reasoning", choiceLabel: null,
      detail: "Use h(0) to obtain c=366, then h(3)=0 to find b and the other root.",
    },
  });
  const question = "Let h(x)=-\\sqrt{x^2+bx+c}. The graph passes through (3,0) and (0,-\\sqrt{366}). What is the greatest possible value of its other x-intercept m?";
  const { parsed, repairs } = validateCandidatesResponse(providerBody(candidatesResponse([written], { question })));
  assert.equal(parsed.candidates[0].result.value, null);
  assert.match(repairs.join(" "), /redundant numeric value/);
  const selection = selectMethods(parsed);
  assert.equal(selection.methods[0].answer, "122");
  assert.equal(selection.methods[0].rejected, null);

  const contradictory = { ...written, answer: "121" };
  const conflicting = validateCandidatesResponse(providerBody(candidatesResponse([contradictory], { question })));
  assert.equal(conflicting.parsed.candidates[0].result.value, 122);
  assert.throws(() => selectMethods(conflicting.parsed), /written result requires null row\/value\/listIndex/i);
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

test("readout-type slips with one possible meaning are repaired, and a graph with two rows names the other", () => {
  const listed = graphCandidate({
    techniqueId: "answer-choice-list",
    rows: [{ latex: "A=[2,3,4,5]", slider: null, copiesRow: null }, { latex: "A^2-9", slider: null, copiesRow: null }],
    answer: "B) 3",
    result: { type: "numeric", row: 2, relatedRows: [], value: 0, listIndex: 2, answerFrom: "choice_position", choiceLabel: "B", detail: "the entry that equals zero" },
  });
  const crossing = graphCandidate({
    techniqueId: "graph-both-sides",
    rows: [{ latex: "y=x^2", slider: null, copiesRow: null }, { latex: "y=9", slider: null, copiesRow: null }],
    result: { type: "intersection", row: 1, relatedRows: [], value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the right intersection" },
  });
  const { parsed, repairs } = validateCandidatesResponse(providerBody(candidatesResponse([listed, crossing])));
  assert.equal(parsed.candidates[0].result.type, "list_entry");
  assert.deepEqual(parsed.candidates[1].result.relatedRows, [2]);
  assert.equal(repairs.length, 2);
  // A list row is not a graph: a one-row "intersection" next to it is left for the result contract to reject.
  const notGraphs = graphCandidate({
    techniqueId: "graph-both-sides",
    rows: [{ latex: "y=x^2", slider: null, copiesRow: null }, { latex: "y_{1}=[1,2]", slider: null, copiesRow: null }],
    result: { type: "intersection", row: 1, relatedRows: [], value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the right intersection" },
  });
  assert.deepEqual(validateCandidatesResponse(providerBody(candidatesResponse([notGraphs]))).parsed.candidates[0].result.relatedRows, []);
});

test("a graphical readout that names a choice by list position reads it by reasoning instead", () => {
  const choices = [{ label: "A", text: "1" }, { label: "B", text: "3" }];
  const slider = graphCandidate({
    techniqueId: "slider-condition",
    rows: [{ latex: "k=1", slider: { min: 0, max: 5, step: 1 }, copiesRow: null }, { latex: "y=x^2-k^2", slider: null, copiesRow: null }],
    answer: "B) 3",
    result: { type: "slider_condition", row: 1, relatedRows: [2], value: null, listIndex: null, answerFrom: "choice_position", choiceLabel: "B", detail: "k where the graph passes through (3, 0)" },
  });
  const { parsed } = validateCandidatesResponse(providerBody(candidatesResponse([slider], { choices })));
  assert.equal(parsed.candidates[0].result.answerFrom, "reasoning");
});
