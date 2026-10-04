/**
 * The product's core lessons as selection regression tests: given a
 * realistic candidate set, with the algebra-first method's cost reported
 * honestly, the server's validation and cost argmin must make the
 * Desmos-native method the default. Lessons already covered elsewhere:
 * representation questions (strategy-selection "regression test 7"),
 * infinitely-many ratios ("a stated infinite-solutions premise..."),
 * continuous domains ("sampling a continuous domain..."), and the factor
 * rescue (desmos-rescue.test.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { candidatesResponseSchema, selectMethods, type CandidatesResponseInput } from "../src/lib/strategy-selection";
import { candidatesResponse, graphCandidate, paperCandidate, zeroCost } from "./method-fixtures";

type Candidate = CandidatesResponseInput["candidates"][number];
const row = (latex: string, slider: Candidate["rows"][number]["slider"] = null) => ({ latex, slider, copiesRow: null });
const numeric = (rowNumber: number, value: number, detail: string): Candidate["result"] => ({
  type: "numeric", row: rowNumber, relatedRows: [], value, listIndex: null, answerFrom: "value", choiceLabel: null, detail,
});
const written = (detail: string): Candidate["result"] => ({
  type: "written", row: null, relatedRows: [], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail,
});

function select(question: string, candidates: Candidate[], choices: CandidatesResponseInput["choices"] = null) {
  const selection = selectMethods(candidatesResponseSchema.parse(candidatesResponse(candidates, { question, choices })));
  const eligible = selection.methods.filter((method) => !method.rejected);
  return { winner: eligible[0], eligible, rejected: selection.methods.filter((method) => method.rejected) };
}

test("lesson 1: three points determine a quadratic — list regression beats a hand-solved 3×3 system", () => {
  const { winner, eligible } = select(
    "A quadratic function is defined by f(x) = ax^2 + bx + c. The graph of y = f(x) passes through (1, 7), (2, 15), and (4, 43). What is the value of b?",
    [
      graphCandidate({
        techniqueId: "three-point-regression",
        rung: 4,
        rows: [row("x_{1}=[1,2,4]"), row("y_{1}=[7,15,43]"), row("y_{1}\\sim ax_{1}^{2}+bx_{1}+c"), row("b")],
        answer: "2",
        result: numeric(4, 2, "the fitted value of b"),
        graphBounds: null,
      }),
      paperCandidate({ techniqueId: "elimination", answer: "2", result: written("b from the eliminated system"), cost: { ...zeroCost, derivationSteps: 4 } }),
    ],
  );
  assert.equal(winner.techniqueId, "three-point-regression");
  assert.equal(winner.mathLevel, "low");
  assert.equal(eligible.at(-1)?.techniqueId, "elimination", "the paper method stays listed as an alternative");
});

test("lesson 2: integer inequality counting — a filtered integer list beats factoring the quadratic by hand", () => {
  const { winner } = select("How many integers n satisfy n^2 - 17n + 60 < 0?", [
    graphCandidate({
      techniqueId: "integer-list-filter",
      rung: 4,
      rows: [row("N=[1...20]"), row("\\operatorname{count}(N[N^{2}-17N+60<0])")],
      answer: "6",
      result: numeric(2, 6, "how many integers satisfy the inequality"),
      graphBounds: null,
    }),
    paperCandidate({ techniqueId: "factoring", answer: "6", result: written("the integers strictly between 5 and 12"), cost: { ...zeroCost, derivationSteps: 2 } }),
  ]);
  assert.equal(winner.techniqueId, "integer-list-filter");
});

test("lesson 4: factor x + 2b — a typed hand-derived value is rejected as hidden derivation; the shared-zero slider wins", () => {
  const question = "x + 2b is a factor of 3x^2 + 25x + 14b, where b is a positive integer constant. What is the value of b?";
  const { winner, rejected } = select(question, [
    // 12b^2 - 36b = 0 solved off-screen, then typed in: 36 and 12 appear nowhere in the question.
    graphCandidate({ techniqueId: "function-evaluation", rung: 2, rows: [row("36/12")], answer: "3", result: numeric(1, 3, "b"), graphBounds: null }),
    graphCandidate({
      techniqueId: "shared-zero",
      rung: 3,
      rows: [row("b=1", { min: 1, max: 10, step: 1 }), row("y=x+2b"), row("y=3x^{2}+25x+14b")],
      answer: "3",
      result: { type: "slider_condition", row: 1, relatedRows: [2, 3], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "b where the line and parabola share an x-intercept" },
      answerState: { param: "b", value: 3 },
      parameters: [{ name: "b", integer: true, min: 1, max: 10 }],
      cost: { ...zeroCost, manualIterations: 1 },
    }),
    paperCandidate({ techniqueId: "substitution", answer: "3", result: written("b from 12b^2 - 36b = 0"), cost: { ...zeroCost, derivationSteps: 2 } }),
  ]);
  assert.equal(winner.techniqueId, "shared-zero");
  // Scalar rows with no function are calculator arithmetic, and still hidden derivation.
  assert.equal(rejected.find((method) => method.techniqueId === "calculator-arithmetic")?.rejected?.rule, "hidden-derivation");
});

test("lesson 5: several unknown constants — one bracket regression on the original equations beats elimination", () => {
  const { winner, eligible } = select(
    "In the system 7rx + 12sy = 3 and 3rx + 4sy = 5, the solution has x = 2. If r and s are constants, what is the value of r?",
    [
      graphCandidate({
        techniqueId: "bracket-regression",
        rung: 4,
        rows: [row("x_{1}=2"), row("[7rx_{1}+12sy_{1},3rx_{1}+4sy_{1}]\\sim[3,5]"), row("r")],
        answer: "3",
        result: numeric(3, 3, "the fitted value of r"),
        graphBounds: null,
      }),
      paperCandidate({ techniqueId: "elimination", answer: "3", result: written("r after eliminating sy"), cost: { ...zeroCost, derivationSteps: 3 } }),
    ],
  );
  assert.equal(winner.techniqueId, "bracket-regression");
  assert.ok(eligible.some((method) => method.techniqueId === "elimination"));
});

test("lesson 8: a visual ending is complete — clicking the intersection beats a list test and written substitution", () => {
  const { winner } = select(
    "The graphs of y = x^2 - 4x + 1 and y = 2x + 8 intersect at two points. What is the x-coordinate of the intersection point with the greater x-coordinate?",
    [
      graphCandidate({
        techniqueId: "graph-both-sides",
        rung: 1,
        rows: [row("y=x^{2}-4x+1"), row("y=2x+8")],
        answer: "7",
        result: { type: "intersection", row: 1, relatedRows: [2], value: 7, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the x-coordinate of the right intersection" },
        graphBounds: { left: -5, right: 10, bottom: -10, top: 30 },
      }),
      graphCandidate({
        techniqueId: "answer-choice-list",
        rung: 4,
        rows: [row("A=[5,6,7,8]"), row("f(x)=x^{2}-4x+1"), row("g(x)=2x+8"), row("f(A)-g(A)")],
        answer: "C) 7",
        result: { type: "list_entry", row: 4, relatedRows: [], value: 0, listIndex: 3, answerFrom: "choice_position", choiceLabel: "C", detail: "the entry that is zero" },
        graphBounds: null,
      }),
      paperCandidate({ techniqueId: "substitution", answer: "C) 7", result: { ...written("x from x^2 - 6x - 7 = 0"), choiceLabel: "C" }, cost: { ...zeroCost, derivationSteps: 3 } }),
    ],
    [{ label: "A", text: "5" }, { label: "B", text: "6" }, { label: "C", text: "7" }, { label: "D", text: "8" }],
  );
  assert.equal(winner.techniqueId, "graph-both-sides");
  assert.equal(winner.result.type, "intersection");
  assert.equal(winner.answer, "C) 7");
});
