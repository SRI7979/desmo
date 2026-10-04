import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import OpenAI from "openai";

import { createMemorySolveCache } from "../src/lib/solve-cache";
import { createTrace, solveProblem, type PipelineDeps } from "../src/lib/solve-pipeline";
import { desmosRescueTarget, mergeSelections, selectMethods, type CandidatesResponse } from "../src/lib/strategy-selection";
import { candidatesResponse, graphCandidate, mockModel, paperCandidate, zeroCost } from "./method-fixtures";

const FACTOR_QUESTION = "x + 2b is a factor of 3x^2 + 25x + 14b, where b is a positive integer constant. What is the value of b?";

/** The shared-zero slider exactly as the recorded runs proposed it. */
function sharedZero(result: Record<string, unknown> = {}) {
  return graphCandidate({
    techniqueId: "shared-zero",
    rung: 3,
    rows: [
      { latex: "b=1", slider: { min: 1, max: 10, step: 1 }, copiesRow: null },
      { latex: "y=x+2b", slider: null, copiesRow: null },
      { latex: "y=3x^2+25x+14b", slider: null, copiesRow: null },
    ],
    answer: "3",
    result: {
      type: "slider_condition",
      row: 1,
      relatedRows: [2, 3],
      value: null,
      listIndex: null,
      answerFrom: "reasoning",
      choiceLabel: null,
      detail: "the value of b at which the line and the parabola share an x-intercept",
      ...result,
    },
    answerState: { param: "b", value: 3 },
    parameters: [{ name: "b", integer: true, min: 1, max: 10 }],
    graphBounds: { left: -10, right: 4, bottom: -20, top: 20 },
    cost: { ...zeroCost, manualIterations: 1 },
  });
}

/** Written substitution: two honest derivation steps, so a math-heavy default. */
const substitution = () =>
  paperCandidate({ techniqueId: "substitution", answer: "3", cost: { ...zeroCost, derivationSteps: 2 }, result: { type: "written", row: null, relatedRows: [], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "b from 12b^2 - 36b = 0" } });

/** The slip: a slider readout labeled as an intersection of one row, which the result contract rejects. */
const slipped = () => sharedZero({ type: "intersection", relatedRows: [] });

const factorResponse = (candidates: ReturnType<typeof graphCandidate>[]) => candidatesResponse(candidates, { question: FACTOR_QUESTION });

function deps(): PipelineDeps {
  return {
    client: new OpenAI({ apiKey: "unit-test-key", maxRetries: 0 }),
    cache: createMemorySolveCache(),
    context: { model: "gpt-5-mini", candidateInstructions: "test", version: "test-version" },
    tier: { priorityUnavailable: false },
    diagnosticId: "rescue-test",
    trace: createTrace(),
  };
}

const savedRescue = process.env.DESMO_DESMOS_RESCUE;
beforeEach(() => {
  delete process.env.DESMO_DESMOS_RESCUE;
});
afterEach(() => {
  mock.restoreAll();
  if (savedRescue === undefined) delete process.env.DESMO_DESMOS_RESCUE;
  else process.env.DESMO_DESMOS_RESCUE = savedRescue;
});

test("a math-heavy default that stands only because a Desmos candidate slipped triggers one rescue", () => {
  const selection = selectMethods(factorResponse([slipped(), substitution()]) as CandidatesResponse);
  assert.equal(selection.winnerId, "substitution");
  const target = desmosRescueTarget(selection);
  assert.ok(target);
  assert.deepEqual(target.candidates.map((method) => method.techniqueId), ["shared-zero"]);
  assert.equal(target.candidates[0].rejected?.rule, "answer-consistency");
});

test("no rescue when the default already asks little math, or the rejected technique answered a different question", () => {
  // A low-math default (one written step) is not worth a model call.
  const light = selectMethods(factorResponse([slipped(), paperCandidate({ techniqueId: "direct-arithmetic", answer: "3", cost: { ...zeroCost, derivationSteps: 1 } })]) as CandidatesResponse);
  assert.equal(desmosRescueTarget(light), null);
  // Representation questions reject every calculator technique by design.
  const representation = selectMethods(
    candidatesResponse(
      [
        graphCandidate({ techniqueId: "graph-raw" }),
        paperCandidate({ techniqueId: "factoring", cost: { ...zeroCost, derivationSteps: 3 } }),
      ],
      { question: "Which equation represents the total cost c, in dollars, of x pounds of apples at 3 dollars per pound plus a 2 dollar bag fee?" },
    ) as CandidatesResponse,
  );
  assert.equal(desmosRescueTarget(representation), null);
});

test("the rescue corrects the slipped Desmos technique, which becomes the default; the paper method stays listed", async () => {
  const { requests } = mockModel({
    candidates: (_body: Record<string, unknown>, call: number) => (call === 1 ? factorResponse([slipped(), substitution()]) : factorResponse([sharedZero(), substitution()])),
  });
  const pipeline = deps();
  const result = await solveProblem(pipeline, { kind: "text", problem: FACTOR_QUESTION, choices: null });
  assert.equal(result.kind, "solved");
  if (result.kind !== "solved") return;
  assert.equal(result.rescue, "applied");
  assert.equal(result.method.techniqueId, "shared-zero");
  assert.deepEqual(result.resolved.methods.map((method) => method.techniqueId), ["shared-zero", "substitution"]);
  assert.equal(result.calls.candidates, 2);
  assert.equal(requests.candidates.length, 2);
  assert.match(JSON.stringify(requests.candidates[1].input), /desmos_rescue/);
  assert.match(JSON.stringify(requests.candidates[1].input), /shared-zero \(Shared zero\) was rejected \[answer-consistency\]/);
  assert.ok(pipeline.trace!.stages.some((stage) => stage.stage === "desmos_rescue"));
  assert.equal(pipeline.trace!.candidateOutputs.length, 2);
});

test("a correction that still fails keeps the original selection: the rescue never makes a solve worse", async () => {
  mockModel({
    candidates: (_body: Record<string, unknown>, call: number) => (call === 1 ? factorResponse([slipped(), substitution()]) : factorResponse([slipped()])),
  });
  const result = await solveProblem(deps(), { kind: "text", problem: FACTOR_QUESTION, choices: null });
  assert.equal(result.kind, "solved");
  if (result.kind !== "solved") return;
  assert.equal(result.rescue, "failed");
  assert.equal(result.method.techniqueId, "substitution");
  assert.equal(result.solution.answer, "3");
});

test("a provider failure during the rescue keeps the original selection", async () => {
  mockModel({
    candidates: (_body: Record<string, unknown>, call: number) =>
      call === 1 ? factorResponse([slipped(), substitution()]) : Response.json({ error: { message: "upstream unavailable" } }, { status: 500 }),
  });
  const result = await solveProblem(deps(), { kind: "text", problem: FACTOR_QUESTION, choices: null });
  assert.equal(result.kind, "solved");
  if (result.kind !== "solved") return;
  assert.equal(result.rescue, "failed");
  assert.equal(result.method.techniqueId, "substitution");
});

test("DESMO_DESMOS_RESCUE=off disables the extra call", async () => {
  process.env.DESMO_DESMOS_RESCUE = "off";
  const { requests } = mockModel({ candidates: factorResponse([slipped(), substitution()]) });
  const result = await solveProblem(deps(), { kind: "text", problem: FACTOR_QUESTION, choices: null });
  assert.equal(result.kind, "solved");
  if (result.kind !== "solved") return;
  assert.equal(result.rescue, null);
  assert.equal(requests.candidates.length, 1);
});

test("merging keeps every method that already passed and re-ranks by cost", () => {
  const original = selectMethods(factorResponse([slipped(), substitution()]) as CandidatesResponse);
  const corrected = selectMethods(factorResponse([sharedZero()]) as CandidatesResponse);
  const merged = mergeSelections(original, corrected);
  assert.equal(merged.winnerId, "shared-zero");
  assert.deepEqual(merged.methods.filter((method) => !method.rejected).map((method) => method.techniqueId), ["shared-zero", "substitution"]);
  assert.deepEqual(merged.methods[0].badges, ["Recommended"]);
  assert.equal(merged.methods.filter((method) => method.rejected).length, 0, "a rejection the correction fixed is not kept");
});
