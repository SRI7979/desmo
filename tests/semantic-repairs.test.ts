import assert from "node:assert/strict";
import test from "node:test";

import { expectedIntegerFactorExtremumAnswer, repairIntegerFactorExtremum, repairQuadraticRationalIntercept } from "../src/lib/semantic-repairs";
import { selectMethods, type Candidate, type CandidatesResponse } from "../src/lib/strategy-selection";

const question =
  "The function g is a rational function defined by g(x) = f(x)/(x + 2), where f is a quadratic function. " +
  "The y-intercept of the graph of f is (0,10), and g passes through the points shown in the table below: " +
  "x = 1, 4 and g(x) = 5, 7. What is the value of g(3)?";

function candidate(xList: string, yList: string) {
  return {
    techniqueId: "parameter-regression" as const,
    strategy: null,
    rung: 0,
    rows: [
      { latex: `x_{1}=[${xList}]`, slider: null, copiesRow: null },
      { latex: `y_{1}=[${yList}]`, slider: null, copiesRow: null },
      { latex: "y_{1}~(a x_{1}^2+b x_{1}+c)/(x_{1}+2)", slider: null, copiesRow: null },
    ],
    answer: "5.2",
    result: {
      type: "numeric" as const,
      row: 3,
      value: 5.2,
      listIndex: null,
      answerFrom: "value" as const,
      choiceLabel: null,
      detail: "the computed value",
      relatedRows: [],
    },
    answerState: null,
    parameters: [],
    conditionType: null,
    distinguishes: null,
    graphBounds: null,
    cost: { derivationSteps: 0, newPrimitives: 0, oneOffFacts: 0, setupConstructions: 0, manualIterations: 0 },
  };
}

function response(rows: Candidate[], text = question): CandidatesResponse {
  return {
    status: "solved",
    question: text,
    choices: null,
    clarification: null,
    structure: "quadratic rational function",
    library: { matched: [], skipped: [] },
    candidates: rows,
    preferredTechniqueId: "parameter-regression",
  };
}

test("keeps f's y-intercept out of g's table and repairs the exact rational-function answer", () => {
  // Models commonly turn f(0)=10 into an extra (0,10) data point for g.
  const badResponse = response([candidate("1,4,0", "5,7,10")]);
  const repaired = repairQuadraticRationalIntercept(badResponse);
  const selected = selectMethods(repaired);

  assert.deepEqual(selected.methods.map((method) => method.techniqueId), ["parameter-regression", "substitution"]);
  assert.equal(selected.methods[0].answer, "6.2");
  assert.equal(selected.methods[0].result.value, 6.2);
  assert.deepEqual(selected.methods[0].rows.map(({ latex }) => latex), [
    "f(x)=a x^{2}+b x+10",
    "x_{1}=[1,4]",
    "y_{1}=[5,7]",
    "y_{1}\\sim\\frac{f(x_{1})}{x_{1}+2}",
    "g(x)=\\frac{f(x)}{x+2}",
    "g(3)",
  ]);
});

test("recovers the same correction when the model puts g(0) in the first list slot", () => {
  const repaired = repairQuadraticRationalIntercept(response([candidate("0,1,4", "10,5,7")]));
  assert.equal(selectMethods(repaired).methods[0].answer, "6.2");
});

test("adds Desmos regression to an algebra-only reply and keeps substitution available", () => {
  const algebra: Candidate = {
    ...candidate("1,4", "5,7"),
    techniqueId: "substitution",
    rung: 2,
    rows: [],
    answer: "31/5",
    result: {
      type: "written", row: null, relatedRows: [], value: null, listIndex: null,
      answerFrom: "reasoning", choiceLabel: null, detail: "the result after solving for a and b",
    },
    cost: { derivationSteps: 4, newPrimitives: 0, oneOffFacts: 0, setupConstructions: 0, manualIterations: 0 },
  };
  const selected = selectMethods(repairQuadraticRationalIntercept(response([algebra])));
  assert.deepEqual(selected.methods.map((method) => method.techniqueId), ["parameter-regression", "substitution"]);
  assert.equal(selected.winnerId, "parameter-regression");
});

test("keeps a second method available when the model proposes regression alone", () => {
  const selected = selectMethods(repairQuadraticRationalIntercept(response([candidate("1,4", "5,7")])));
  assert.deepEqual(selected.methods.map((method) => method.techniqueId), ["parameter-regression", "substitution"]);
});

test("reads paired g values from the transcription when no model candidate has calculator rows", () => {
  const text = question.replace("x = 1, 4 and g(x) = 5, 7", "g(1)=5 and g(4)=7");
  const algebra = {
    ...candidate("1,4", "5,7"),
    techniqueId: "substitution" as const,
    rows: [],
    answer: "31/5",
    result: {
      type: "written" as const, row: null, relatedRows: [], value: null, listIndex: null,
      answerFrom: "reasoning" as const, choiceLabel: null, detail: "the solved value",
    },
  };
  const selected = selectMethods(repairQuadraticRationalIntercept(response([algebra], text)));
  assert.equal(selected.winnerId, "parameter-regression");
  assert.equal(selected.methods[0].result.value, 6.2);
});

test("asks for missing table rows instead of trusting an algebra-only guess", () => {
  const algebra = { ...candidate("1,4", "5,7"), rows: [] };
  const withoutTable = question.replace("x = 1, 4 and g(x) = 5, 7. ", "");
  assert.throws(() => repairQuadraticRationalIntercept(response([algebra], withoutTable)), /paired x and g\(x\) values/);
});

const factorQuestion =
  "12x^18 + kx^9 + 35. The expression has factors ax^9 + b and cx^9 + d, " +
  "where a, b, c, and d are all integer constants. What is the maximum value of k?";

test("integer-factor maximum searches every signed factor pair instead of trusting one exact regression", () => {
  const wrong: Candidate = {
    ...candidate("1,2,3,4,5", "1,2,3,4,5"),
    techniqueId: "identity-regression",
    rows: [
      { latex: "u=[1...5]", slider: null, copiesRow: null },
      { latex: "(au+b)(cu+d)\\sim12u^2+ku+35", slider: null, copiesRow: null },
      { latex: "k", slider: null, copiesRow: null },
    ],
    answer: "47",
    result: { type: "numeric", row: 3, relatedRows: [], value: 47, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "one fitted k" },
  };
  const repaired = repairIntegerFactorExtremum(response([wrong], factorQuestion));
  const selected = selectMethods(repaired);
  assert.equal(selected.winnerId, "integer-list-filter");
  assert.equal(selected.methods[0].answer, "421");
  assert.equal(selected.methods[0].result.value, 421);
  assert.equal(selected.methods[0].rows.length, 6);
  assert.match(selected.methods[0].rows[4].latex, /\\operatorname\{for\}p=a_\{2\},q=b_\{2\}/);
  assert.equal(selected.methods[0].rows[5].latex, "\\operatorname{max}(k_{1})");
  assert.deepEqual(selected.methods.filter((method) => !method.rejected).map((method) => method.answer), ["421"]);
});

test("integer-factor search handles another coefficient pair and ignores unrelated factor questions", () => {
  const variant = factorQuestion.replace(/12/g, "6").replace(/35/g, "10").replace(/18/g, "14").replace(/9/g, "7");
  const repaired = repairIntegerFactorExtremum(response([candidate("1,4", "5,7")], variant));
  assert.equal(selectMethods(repaired).methods[0].answer, "61");
  const latex = factorQuestion.replace(/\^18/g, "^{18}").replace(/\^9/g, "^{9}");
  assert.equal(selectMethods(repairIntegerFactorExtremum(response([candidate("1,4", "5,7")], latex))).methods[0].answer, "421");
  assert.equal(expectedIntegerFactorExtremumAnswer(factorQuestion.replace("maximum", "minimum")), -421);
  assert.equal(repairIntegerFactorExtremum(response([candidate("1,4", "5,7")], question)).candidates[0].answer, "5.2");
});
