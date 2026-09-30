import assert from "node:assert/strict";
import test from "node:test";

import { ExplanationError, validateExplanationQuality } from "../src/lib/method-presentation";
import { candidatesResponse, graphCandidate, zeroCost } from "./method-fixtures";
import { candidatesResponseSchema, selectMethods } from "../src/lib/strategy-selection";

const candidate = graphCandidate({
  techniqueId: "slider-condition",
  rows: [
    { latex: "q=0", slider: { min: -50, max: 50, step: 1 }, copiesRow: null },
    { latex: "y=x^2+x+(q-10)", slider: null, copiesRow: null },
  ],
  answer: "11",
  result: {
    type: "vertex",
    row: 2,
    relatedRows: [1],
    value: null,
    listIndex: null,
    answerFrom: "reasoning",
    choiceLabel: null,
    detail: "least integer q whose parabola vertex is above the x-axis",
  },
  answerState: { param: "q", value: 11 },
  parameters: [{ name: "q", integer: true, min: -50, max: 50 }],
  cost: { ...zeroCost, manualIterations: 2 },
});

const method = selectMethods(candidatesResponseSchema.parse(candidatesResponse([candidate], {
  question: "What is the least integer q for which y=x^2+x+(q-10) has no x-intercepts?",
}))).methods[0];

const good = {
  why: "The graph has no x-intercepts only when its lowest point is above the x-axis. Use the slider to find the first whole-number q that achieves this.",
  purposes: [
    "The first row makes q a whole-number slider so you can compare neighboring values.",
    "The second row draws the given parabola, making its lowest point and x-intercepts visible at each q.",
  ],
  readAnswer: "At q=11 the lowest point is above the x-axis. Check q=10: it is below the axis, so the graph crosses it and fails. Thus 11 is the least integer.",
  steps: [],
};

test("a slider explanation cannot pretend Desmos solved for the parameter", () => {
  assert.throws(
    () => validateExplanationQuality(method, {
      ...good,
      purposes: ["The slider opens at 11, the value Desmos found as the least integer.", good.purposes[1]],
    }),
    (error) => error instanceof ExplanationError && error.stage === "explanation_quality" && /slider does not solve/i.test(error.message),
  );
});

test("an integer-extremum slider explanation must justify the adjacent boundary", () => {
  assert.throws(
    () => validateExplanationQuality(method, {
      ...good,
      why: `${good.why} The nearby value q=10 fails.`,
      readAnswer: "At q=11 the lowest point is above the x-axis. The answer is 11.",
    }),
    (error) => error instanceof ExplanationError && error.stage === "explanation_quality" && /adjacent allowed integer/i.test(error.message),
  );
  assert.doesNotThrow(() => validateExplanationQuality(method, good));
});
