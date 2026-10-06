import assert from "node:assert/strict";
import { test } from "node:test";

import {
  candidatesResponseSchema,
  continuousInterval,
  isRepresentationQuestion,
  questionCondition,
  questionIntegerParameters,
  samplesInterval,
  selectMethods,
  StrategySelectionError,
  type CandidatesResponseInput,
} from "../src/lib/strategy-selection";
import { candidatesResponse, graphCandidate, paperCandidate, zeroCost } from "./method-fixtures";

function select(input: CandidatesResponseInput) {
  return selectMethods(candidatesResponseSchema.parse(input));
}

function eligible(input: CandidatesResponseInput) {
  return select(input).methods.filter((method) => method.rejected === null);
}

function rejectedRule(input: CandidatesResponseInput, techniqueId: string) {
  return select(input).methods.find((method) => method.techniqueId === techniqueId && method.rejected)?.rejected?.rule;
}

test("the default is the argmin of server-computed total cost, never the model's preference", () => {
  const selection = select(
    candidatesResponse(
      [paperCandidate({ cost: { ...zeroCost, derivationSteps: 2, oneOffFacts: 1 } }), graphCandidate()],
      { preferredTechniqueId: "factoring" },
    ),
  );
  assert.equal(selection.winnerId, "intercept-read");
  assert.equal(selection.modelPreference, "factoring", "the disagreement is kept for logging, never obeyed");
  const [winner, paper] = selection.methods;
  assert.equal(winner.total, 1);
  assert.equal(paper.total, 3 * 2 + 4 * 1);
  assert.deepEqual(winner.badges, ["Recommended"]);
  assert.deepEqual(paper.badges, ["Most algebra"]);
  assert.equal(winner.mathLevel, "low");
  assert.equal(paper.mathLevel, "high");
  assert.equal(winner.shape, "1 row · graph · no algebra");
  assert.equal(paper.shape, "no calculator · factoring · 2 algebra steps");
  assert.equal(winner.name, "Read the intercepts");
});

test("the model's own row count and totals are never trusted", () => {
  const candidate = graphCandidate({ rows: [{ latex: "y=x^2", slider: null, copiesRow: null }, { latex: "y=9", slider: null, copiesRow: null }] });
  candidate.result = { ...candidate.result, type: "intersection", row: 1, relatedRows: [2], detail: "the right intersection's x-coordinate" };
  const [method] = eligible(candidatesResponse([candidate]));
  assert.equal(method.cost.rows, 2);
  assert.equal(method.total, 2);
  assert.equal(candidatesResponseSchema.safeParse({ ...candidatesResponse(), candidates: [{ ...graphCandidate(), cost: { ...zeroCost, rows: 1 } }] }).success, false, "rows is not a reportable cost");
});

test("selection is identical whatever order the candidates arrive in", () => {
  const slider = graphCandidate({
    techniqueId: "slider-condition",
    rung: 3,
    rows: [
      { latex: "k=1", slider: { min: 0, max: 5, step: 1 }, copiesRow: null },
      { latex: "y=x^2-k^2", slider: null, copiesRow: null },
    ],
    result: { type: "slider_condition", row: 1, relatedRows: [2], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "k where a root sits at 3" },
    answerState: { param: "k", value: 3 },
    cost: { ...zeroCost, manualIterations: 1 },
  });
  const forward = select(candidatesResponse([graphCandidate(), paperCandidate(), slider]));
  const backward = select(candidatesResponse([slider, paperCandidate(), graphCandidate()]));
  assert.deepEqual(forward.methods.map((method) => method.id), backward.methods.map((method) => method.id));
  assert.equal(forward.winnerId, backward.winnerId);
});

test("regression test 5: two candidates with the same techniqueId → the costlier one is rejected", () => {
  const twoRows = graphCandidate({ rows: [{ latex: "y=x^2", slider: null, copiesRow: null }, { latex: "y=9", slider: null, copiesRow: null }], result: { ...graphCandidate().result, type: "intersection", relatedRows: [2] } });
  const selection = select(candidatesResponse([graphCandidate(), twoRows]));
  const eligibleIds = selection.methods.filter((method) => !method.rejected).map((method) => method.id);
  assert.deepEqual(eligibleIds, ["intercept-read"]);
  const duplicate = selection.methods.find((method) => method.rejected);
  assert.equal(duplicate?.rejected?.rule, "duplicate-technique");
  assert.equal(duplicate?.id, "intercept-read#2");
  // Emission order does not decide: the cheaper listing is kept even when it comes second.
  const reversed = select(candidatesResponse([twoRows, graphCandidate()]));
  const kept = reversed.methods.filter((method) => !method.rejected);
  assert.deepEqual(kept.map((method) => method.rows.length), [1]);
  assert.equal(kept[0].id, "intercept-read");
  assert.equal(reversed.methods.find((method) => method.rejected)?.id, "intercept-read#1");
});

test("regression test 6: a problem with only one real technique returns one method, not padded to two", () => {
  const selection = select(candidatesResponse([graphCandidate()]));
  assert.equal(selection.methods.length, 1);
  assert.equal(selection.winnerId, "intercept-read");
});

const representation = {
  question:
    "At a certain school, there are n ninth graders and (2n + 18) tenth graders taking Algebra 2. If the total number of ninth and tenth graders taking Algebra 2 is 162, which equation represents this situation?",
  choices: [
    { label: "A", text: "n + (2n + 18) = 162" },
    { label: "B", text: "2n + 18 = 162" },
    { label: "C", text: "n(2n + 18) = 162" },
    { label: "D", text: "n - (2n + 18) = 162" },
  ],
};

test("regression test 7: a 'which equation represents this situation' question gets no fabricated Desmos technique", () => {
  const translate = paperCandidate({
    techniqueId: "translate-the-words",
    answer: "A) n + (2n + 18) = 162",
    result: { ...paperCandidate().result, choiceLabel: "A", detail: "the ninth graders plus the tenth graders total 162" },
    cost: { ...zeroCost },
  });
  const solving = graphCandidate({
    techniqueId: "graph-both-sides",
    rows: [{ latex: "y=x+(2x+18)", slider: null, copiesRow: null }, { latex: "y=162", slider: null, copiesRow: null }],
    answer: "A) n + (2n + 18) = 162",
    result: { type: "intersection", row: 1, relatedRows: [2], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: "A", detail: "where the total reaches 162" },
  });
  const input = candidatesResponse([solving, translate], representation);
  const selection = select(input);
  assert.equal(selection.winnerId, "translate-the-words");
  assert.deepEqual(selection.methods.filter((method) => !method.rejected).map((method) => method.techniqueId), ["translate-the-words"]);
  assert.equal(rejectedRule(input, "graph-both-sides"), "answers-different-question");
  assert.equal(selection.methods[0].total, 0, "the translation is the whole task, so it costs nothing extra");
  assert.throws(() => select(candidatesResponse([solving], representation)), /answers-different-question/);
});

const noSolution = "6 + 7r = pw and 7r - 5w = 5w + 11. In this system of equations, p is a constant. If the system has no solution, what is the value of p?";

test("Rule 3 applies to every candidate of a no-solution question, even one that left conditionType null", () => {
  const slopeOnlyPaper = paperCandidate({
    techniqueId: "direct-arithmetic",
    answer: "10",
    result: { ...paperCandidate().result, detail: "equate the slopes to get p = 10" },
    cost: { ...zeroCost, derivationSteps: 1 },
  });
  const derivative = graphCandidate({
    techniqueId: "derivative-regression",
    rung: 4,
    rows: [
      { latex: "f(x)=(6+7x)/p", slider: null, copiesRow: null },
      { latex: "g(x)=(7/10)x-11/10", slider: null, copiesRow: null },
      { latex: "f'(0)\\sim g'(0)", slider: null, copiesRow: null },
    ],
    answer: "10",
    result: { type: "numeric", row: 3, relatedRows: [], value: 10, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the fitted p" },
    // A derivative match compares slopes only; claiming the constants were checked is not credible.
    distinguishes: "constant-ratio-checked",
  });
  const slider = graphCandidate({
    techniqueId: "slider-parallel",
    rung: 3,
    rows: [
      { latex: "p=1", slider: { min: 1, max: 20, step: 1 }, copiesRow: null },
      { latex: "6+7x=py", slider: null, copiesRow: null },
      { latex: "7x-5y=5y+11", slider: null, copiesRow: null },
    ],
    answer: "10",
    result: { type: "graph_overlap", row: 2, relatedRows: [3], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "the two lines at p = 10" },
    answerState: { param: "p", value: 10 },
    conditionType: "no-solution",
    cost: { ...zeroCost, manualIterations: 1 },
  });
  const input = candidatesResponse([slopeOnlyPaper, derivative, slider], { question: noSolution });
  const selection = select(input);
  assert.equal(selection.winnerId, "slider-parallel");
  assert.equal(rejectedRule(input, "direct-arithmetic"), "condition-incomplete");
  assert.equal(rejectedRule(input, "derivative-regression"), "condition-incomplete");
  const winner = selection.methods[0];
  assert.equal(winner.distinguishes, "visual-parallel-vs-overlap");
  assert.equal(winner.total, 4, "3 rows + 1 slider drag, as in the spec's sanity check");

  // A paper method that genuinely compares the constants may say so.
  const ratioChecked = { ...slopeOnlyPaper, conditionType: "no-solution" as const, distinguishes: "constant-ratio-checked" as const };
  assert.equal(select(candidatesResponse([ratioChecked], { question: noSolution })).winnerId, "direct-arithmetic");
});

test("a stated infinite-solutions premise permits direct arithmetic for the requested coefficient ratio", () => {
  const question = "(1/3)x + ay = b and 2x + cy = 5d. If the system has infinitely many solutions, what is the value of b/d?";
  const ratio = paperCandidate({
    techniqueId: "direct-arithmetic",
    answer: "5/6",
    result: { ...paperCandidate().result, detail: "The second equation is six times the first, so 5d=6b and b/d=5/6." },
    conditionType: "infinitely-many",
    distinguishes: null,
    cost: { ...zeroCost, derivationSteps: 2 },
  });
  const method = select(candidatesResponse([ratio], { question })).methods[0];
  assert.equal(method.rejected, null);
  assert.equal(method.answer, "5/6");
  assert.equal(method.conditionType, null, "the stated premise is not another condition the method must establish");

  const parameterQuestion = "If the system has infinitely many solutions, what is the value of p?";
  assert.throws(() => select(candidatesResponse([ratio], { question: parameterQuestion })), /condition-incomplete/);
});

test("a disposable scalar list cannot outrank direct arithmetic for one probability ratio", () => {
  const question = "A survey of 200 students found 120 prefer math. Of those, 45 are freshmen; 80 of all 200 are freshmen. What is the probability that a non-freshman prefers math?";
  const paper = paperCandidate({
    techniqueId: "direct-arithmetic",
    answer: "5/8",
    result: { ...paperCandidate().result, detail: "(120-45)/(200-80)=5/8" },
    cost: { ...zeroCost, derivationSteps: 3 },
  });
  for (const name of ["A", "counts"]) {
    const list = graphCandidate({
      techniqueId: "list-evaluation",
      rows: [
        { latex: `${name}=[200,120,45,80]`, slider: null, copiesRow: null },
        { latex: `(${name}[2]-${name}[3])/(${name}[1]-${name}[4])`, slider: null, copiesRow: null },
      ],
      answer: "5/8",
      result: { type: "numeric", row: 2, relatedRows: [1], value: 0.625, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the probability" },
    });
    const input = candidatesResponse([list, paper], { question });
    assert.equal(select(input).winnerId, "direct-arithmetic", name);
    assert.equal(rejectedRule(input, "list-evaluation"), "disposable-scalar-list", name);
  }
});

test("one arbitrary constrained x,y pair cannot establish an invariant expression", () => {
  const question = "If 2x+y=20, what is the value of 8x^2+18x+8xy+9y+2y^2?";
  const rows = [
    { latex: "v(x)=20-2x", slider: null, copiesRow: null },
    { latex: "E(x)=8x^2+18x+8xv(x)+9v(x)+2v(x)^2", slider: null, copiesRow: null },
    { latex: "E(0)", slider: null, copiesRow: null },
  ];
  const candidate = graphCandidate({
    techniqueId: "function-evaluation",
    rows,
    answer: "980",
    result: { type: "numeric", row: 3, relatedRows: [1, 2], value: 980, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the value of E at zero" },
  });
  const fallback = paperCandidate({
    techniqueId: "substitution",
    answer: "980",
    result: { type: "written", row: null, relatedRows: [], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "the expression equals 2(2x+y)^2+9(2x+y)=980" },
  });
  const input = candidatesResponse([candidate, fallback], { question });
  assert.equal(rejectedRule(input, "function-evaluation"), "unproven-invariance");

  const proven = graphCandidate({
    ...candidate,
    rows: [...rows.slice(0, 2), { latex: "E(x)-E(0)", slider: null, copiesRow: null }, rows[2]],
    result: { ...candidate.result, row: 4, relatedRows: [2, 3] },
  });
  assert.equal(rejectedRule(candidatesResponse([proven, fallback], { question }), "function-evaluation"), undefined);
});

test("Rule 1 applies to a parameter the question calls an integer, even when no candidate declared it", () => {
  const question =
    "A quadratic function f is defined by f(x) = ax^2 + bx + c, where a is an integer greater than 1. The graph of y = f(x) has x-intercepts at (-2, 0) and (8, 0). Which of the following could be the value of a + b?";
  const choices = [{ label: "A", text: "-11" }, { label: "B", text: "-12" }, { label: "C", text: "-13" }, { label: "D", text: "-15" }];
  const unencoded = graphCandidate({
    techniqueId: "identity-regression",
    rung: 4,
    rows: [
      { latex: "x_{1}=[0,1,2]", slider: null, copiesRow: null },
      { latex: "a(x_{1}+2)(x_{1}-8)\\sim ax_{1}^2+bx_{1}+c", slider: null, copiesRow: null },
      { latex: "a+b", slider: null, copiesRow: null },
    ],
    answer: "D) -15",
    result: { type: "numeric", row: 3, relatedRows: [], value: -15, listIndex: null, answerFrom: "value", choiceLabel: "D", detail: "a + b" },
  });
  const list = graphCandidate({
    techniqueId: "answer-choice-list",
    rung: 4,
    rows: [
      { latex: "a=[2...10]", slider: null, copiesRow: null },
      { latex: "-5a", slider: null, copiesRow: null },
    ],
    answer: "D) -15",
    result: { type: "list_entry", row: 2, relatedRows: [], value: -15, listIndex: 2, answerFrom: "value", choiceLabel: "D", detail: "a + b = -5a for integer a" },
  });
  const input = candidatesResponse([unencoded, list], { question, choices });
  assert.equal(rejectedRule(input, "identity-regression"), "integer-not-encoded");
  assert.equal(select(input).winnerId, "answer-choice-list");
});

test("sampling a continuous domain with an integer list is rejected; the restricted graph survives", () => {
  const question = "For 2 <= x <= 8, the function f is defined by f(x) = (x - 1)^2 + 4. What is the minimum value of f on this interval?";
  const sampled = graphCandidate({
    techniqueId: "list-evaluation",
    rung: 4,
    rows: [
      { latex: "f(x)=(x-1)^2+4", slider: null, copiesRow: null },
      { latex: "X=[2...8]", slider: null, copiesRow: null },
      { latex: "\\min(f(X))", slider: null, copiesRow: null },
    ],
    answer: "5",
    result: { type: "numeric", row: 3, relatedRows: [], value: 5, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the smallest sampled value" },
  });
  const restricted = graphCandidate({
    techniqueId: "restricted-extremum",
    rows: [{ latex: "y=(x-1)^2+4\\left\\{2\\le x\\le 8\\right\\}", slider: null, copiesRow: null }],
    answer: "5",
    result: { type: "vertex", row: 1, relatedRows: [], value: 5, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the lowest point of the restricted graph" },
  });
  const input = candidatesResponse([sampled, restricted], { question });
  assert.equal(rejectedRule(input, "list-evaluation"), "discrete-sampling");
  assert.equal(select(input).winnerId, "restricted-extremum");
});

test("existing hard rejections still apply to every candidate before scoring", async (t) => {
  await t.test("disposable coefficient lists for a small system", () => {
    const lists = graphCandidate({
      techniqueId: "parameter-regression",
      rows: [
        { latex: "a_{1}=[7,3]", slider: null, copiesRow: null },
        { latex: "b_{1}=[12,4]", slider: null, copiesRow: null },
        { latex: "c_{1}=[3,5]", slider: null, copiesRow: null },
        { latex: "c_{1}\\sim 2a_{1}r+b_{1}p", slider: null, copiesRow: null },
        { latex: "r", slider: null, copiesRow: null },
      ],
      answer: "3",
      result: { type: "numeric", row: 5, relatedRows: [], value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "r" },
    });
    const input = candidatesResponse([lists], { question: "7rx + 12sy = 3 and 3rx + 4sy = 5. The system has a solution of (2, y). What is the value of r?" });
    assert.throws(() => select(input), /coefficient-lists/);
  });
  await t.test("constants the question never states (hidden derivation)", () => {
    const derived = graphCandidate({
      techniqueId: "parameter-regression",
      rows: [{ latex: "52\\sim4\\left(41-14n\\right)", slider: null, copiesRow: null }],
      answer: "2",
      result: { type: "numeric", row: 1, relatedRows: [], value: 2, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "n" },
    });
    const input = candidatesResponse([derived], { question: "x^2 + y^2 - 10x - 8y - 14n = 0 is circle A. (11, 8) lies on circle B with the same center and twice the diameter. What is n?" });
    assert.throws(() => select(input), /hidden-derivation[\s\S]*41, 52/);
  });
  await t.test("a value defined by a formula in a fitted parameter, while a synthetic readout alias is repaired", () => {
    const rearranged = graphCandidate({
      techniqueId: "linear-regression",
      rows: [
        { latex: "x_{1}=[-4,2]", slider: null, copiesRow: null },
        { latex: "y_{1}=[2,11]", slider: null, copiesRow: null },
        { latex: "y_{1}\\sim mx_{1}+b", slider: null, copiesRow: null },
        { latex: "a=6/m", slider: null, copiesRow: null },
      ],
      answer: "B) 4",
      result: { type: "numeric", row: 4, relatedRows: [], value: 4, listIndex: null, answerFrom: "value", choiceLabel: "B", detail: "a" },
    });
    const question = "Line ℓ passes through (−4, 2) and (2, 11). Line m is 6x − ay = 15. If the lines are parallel, what is a?";
    const choices = [{ label: "A", text: "2" }, { label: "B", text: "4" }, { label: "C", text: "6" }, { label: "D", text: "9" }];
    assert.throws(() => select(candidatesResponse([rearranged], { question, choices })), /hidden-derivation[\s\S]*fitted parameter m/);

    const alias = graphCandidate({
      techniqueId: "parameter-regression",
      rows: [
        { latex: "x_{1}=[1,2]", slider: null, copiesRow: null },
        { latex: "y_{1}=[3,6]", slider: null, copiesRow: null },
        { latex: "y_{1}\\sim kx_{1}", slider: null, copiesRow: null },
        { latex: "R=3k", slider: null, copiesRow: null },
      ],
      answer: "9",
      result: { type: "numeric", row: 4, relatedRows: [], value: 9, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "3k" },
    });
    const [method] = eligible(candidatesResponse([alias], { question: "y is proportional to x through (1, 3) and (2, 6). What is 3k?" }));
    assert.equal(method.rows[3].latex, "3k");
    assert.match(method.repairs.join(" "), /synthetic result alias/);
  });
  await t.test("rows Desmos cannot insert (letters that are not coordinates)", () => {
    const graphed = graphCandidate({
      techniqueId: "graph-both-sides",
      rows: [
        { latex: "-q-19w=-337", slider: null, copiesRow: null },
        { latex: "2q-19w=47", slider: null, copiesRow: null },
      ],
      answer: "11",
      result: { type: "numeric", row: 2, relatedRows: [], value: 11, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "w" },
    });
    const bracket = graphCandidate({
      techniqueId: "bracket-regression",
      rows: [
        { latex: "[-q-19w,2q-19w]\\sim[-337,47]", slider: null, copiesRow: null },
        { latex: "w", slider: null, copiesRow: null },
      ],
      answer: "11",
      result: { type: "numeric", row: 2, relatedRows: [], value: 11, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the fitted w" },
    });
    const input = candidatesResponse([graphed, bracket], { question: "-x - wy = -337 and 2x - wy = 47. The graphs intersect at (q, 19). What is w?" });
    assert.equal(rejectedRule(input, "graph-both-sides"), "row-fails-to-insert");
    assert.equal(select(input).winnerId, "bracket-regression");
  });
});

test("the displayed answer is derived from the readout: r+s = 406 is C, not the intermediate 403", () => {
  const identity = graphCandidate({
    techniqueId: "identity-regression",
    rung: 4,
    rows: [
      { latex: "x_{1}=[1...5]", slider: null, copiesRow: null },
      { latex: "\\frac{12x_{1}+28}{4}-\\frac{s}{13}\\sim r(x_{1}-8)", slider: null, copiesRow: null },
      { latex: "r+s", slider: null, copiesRow: null },
    ],
    answer: "403 (B)",
    result: { type: "numeric", row: 3, relatedRows: [], value: 406, listIndex: null, answerFrom: "value", choiceLabel: "B", detail: "r + s" },
  });
  const input = candidatesResponse([identity], {
    question: "For all real values of x, (12x+28)/4 − s/13 = r(x − 8), where r and s are positive constants. What is the value of r + s?",
    choices: [{ label: "A", text: "390" }, { label: "B", text: "403" }, { label: "C", text: "406" }, { label: "D", text: "416" }],
  });
  const [method] = eligible(input);
  assert.equal(method.answer, "C) 406");
  assert.equal(method.result.choiceLabel, "C");
  assert.match(method.repairs.join(" "), /matches choice C, not B/);

  // A value that matches no choice cannot be listed at all.
  const wrong = { ...identity, result: { ...identity.result, value: 3 } };
  assert.throws(() => select({ ...input, candidates: [wrong] }), /answer-consistency[\s\S]*does not match any answer choice/);
});

test("every candidate rejected → a selection error naming each rule; malformed responses are refused", () => {
  const broken = graphCandidate({ rows: [{ latex: "y=x^2-9\\text{ graph it}", slider: null, copiesRow: null }] });
  assert.throws(
    () => select(candidatesResponse([broken])),
    (error: unknown) => error instanceof StrategySelectionError && /Every candidate was rejected: Read the intercepts \(row-fails-to-insert\)/.test(error.message),
  );
  assert.throws(() => select(candidatesResponse([])), /at least one candidate technique/);
  assert.throws(() => select(candidatesResponse([graphCandidate()], { question: "  " })), /transcribed question/);
  assert.equal(candidatesResponseSchema.safeParse(candidatesResponse(Array.from({ length: 6 }, () => graphCandidate()))).success, true, "up to six candidates");
  assert.equal(candidatesResponseSchema.safeParse(candidatesResponse(Array.from({ length: 7 }, () => graphCandidate()))).success, false, "at most six candidates");
});

test("slider bounds, answer state, and the rejected candidates themselves are all kept", () => {
  const slider = graphCandidate({
    techniqueId: "shared-zero",
    rung: 3,
    rows: [
      { latex: "b=1", slider: { min: 1, max: 10, step: 1 }, copiesRow: null },
      { latex: "y=x+2b", slider: null, copiesRow: null },
      { latex: "y=3x^2+25x+14b", slider: null, copiesRow: null },
    ],
    answer: "3",
    result: { type: "slider_condition", row: 1, relatedRows: [2, 3], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "b where the graphs share an x-intercept" },
    answerState: { param: "b", value: 3 },
    cost: { ...zeroCost, manualIterations: 1 },
  });
  const broken = graphCandidate({ techniqueId: "graph-raw", rows: [{ latex: "y=x+2b", slider: null, copiesRow: null }] });
  const selection = select(candidatesResponse([slider, broken], { question: "x + 2b is a factor of 3x^2 + 25x + 14b, where b is a positive integer constant. What is the value of b?" }));
  const [winner, rejected] = selection.methods;
  assert.deepEqual(winner.rows[0].slider, { min: 1, max: 10, step: 1 });
  assert.deepEqual(winner.answerState, { param: "b", value: 3 });
  assert.equal(rejected.rejected?.rule, "row-fails-to-insert", "the rejection is stored for the cache, never selectable");
});

test("question detectors: representation, continuous interval, condition, and integer parameters", () => {
  assert.equal(isRepresentationQuestion(representation.question), true);
  assert.equal(isRepresentationQuestion("Which equation could represent the graph shown?"), false, "a supplied graph is a different task");
  assert.equal(isRepresentationQuestion("Which expression is equivalent to (x+2)(x-8)?"), false);
  assert.deepEqual(continuousInterval("For 2 ≤ x ≤ 8, f(x) = (x-1)^2 + 4."), { low: 2, high: 8 });
  assert.equal(continuousInterval("For integers 2 <= n <= 8, how many values..."), null);
  assert.equal(samplesInterval([{ latex: "X=[2,3,4,5,6,7,8]" }], { low: 2, high: 8 }), true);
  assert.equal(samplesInterval([{ latex: "A=[5,6,7,8]" }], { low: 2, high: 8 }), false);
  assert.equal(questionCondition(noSolution), "no-solution");
  assert.equal(questionCondition("If the system has infinitely many solutions, what is the value of b/d?"), null, "left to the model: the ratio itself is the answer");
  assert.equal(questionCondition("How many solutions does the system have?"), null);
  assert.deepEqual(questionIntegerParameters("where a is an integer greater than 1").map((p) => p.name), ["a"]);
  assert.deepEqual(questionIntegerParameters("How many positive integers n satisfy it?").map((p) => p.name), ["n"]);
  assert.deepEqual(questionIntegerParameters("where a, b, c, and d are all integer constants").map((p) => p.name), ["a", "b", "c", "d"]);
  assert.deepEqual(questionIntegerParameters("where a, b, c and d are all integer constants").map((p) => p.name), ["a", "b", "c", "d"]);
  assert.deepEqual(questionIntegerParameters("If x is an integer, which is true?"), [], "coordinates are never parameters");
});

test("one identity-regression factorization cannot establish a maximum over integer factors", () => {
  const question = "12x^18+kx^9+35 has factors ax^9+b and cx^9+d, where a, b, c, and d are all integer constants. What is the maximum value of k?";
  const fit = graphCandidate({
    techniqueId: "identity-regression",
    rows: [
      { latex: "u=[1...5]", slider: null, copiesRow: null },
      { latex: "(au+b)(cu+d)\\sim12u^2+ku+35", slider: null, copiesRow: null },
      { latex: "k", slider: null, copiesRow: null },
    ],
    answer: "47",
    result: { type: "numeric", row: 3, relatedRows: [], value: 47, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "one fitted k" },
  });
  assert.throws(() => select(candidatesResponse([fit], { question, choices: null })), /unproven-extremum/);
});

test("a LaTeX square-root readout label is repaired to readable prose", () => {
  const candidate = graphCandidate({ result: { ...graphCandidate().result, detail: "\\sqrt{9} as the positive x-intercept" } });
  const [method] = eligible(candidatesResponse([candidate]));
  assert.equal(method.result.detail, "sqrt(9) as the positive x-intercept");
  const written = paperCandidate({ result: { ...paperCandidate().result, detail: "\\sqrt{9}" } });
  assert.equal(eligible(candidatesResponse([written]))[0].result.detail, "sqrt(9)");
});

test("the same rows under a second technique name are one method: only the cheaper listing stays", () => {
  // Recorded eval run: y=x^2-17x+60 listed as both "Graph both sides" and "Read the intercepts".
  const input = candidatesResponse([
    graphCandidate({ techniqueId: "graph-both-sides", rung: 1, cost: { ...zeroCost, manualIterations: 1 } }),
    graphCandidate({ techniqueId: "intercept-read", rung: 1, rows: [{ latex: "y = x^2 - 9", slider: null, copiesRow: null }] }),
    paperCandidate(),
  ]);
  const methods = eligible(input);
  assert.deepEqual(methods.map((method) => method.techniqueId), ["intercept-read", "factoring"]);
  assert.equal(rejectedRule(input, "graph-both-sides"), "duplicate-rows");
  assert.deepEqual(methods[0].badges, ["Recommended"]);
});

test("every method carries a family derived from its technique and rows", () => {
  const methods = eligible(
    candidatesResponse([
      graphCandidate(),
      graphCandidate({
        techniqueId: "three-point-regression",
        rung: 4,
        rows: [
          { latex: "x_{1}=[1,2,4]", slider: null, copiesRow: null },
          { latex: "y_{1}=[-8,-5,7]", slider: null, copiesRow: null },
          { latex: "y_{1}\\sim ax_{1}^{2}+bx_{1}+c", slider: null, copiesRow: null },
        ],
        result: { type: "x_intercept", row: 3, relatedRows: [], value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the positive zero of the fitted parabola" },
      }),
      paperCandidate(),
    // A data list must hold the question's numbers, so the points are in the question.
    ], { question: "A parabola passes through (1, -8), (2, -5), and (4, 7). What is its positive x-intercept?" }),
  );
  assert.deepEqual(
    Object.fromEntries(methods.map((method) => [method.techniqueId, method.family])),
    { "intercept-read": "visual", "three-point-regression": "regression", factoring: "traditional" },
  );
});

test("routing detectors on held-out phrasings (not the benchmark's wording)", async () => {
  const { isIntegerFactorExtremumQuestion } = await import("../src/lib/strategy-selection");
  // A solution expressed in a parameter is not a model of a situation.
  assert.equal(isRepresentationQuestion("Which expression represents the solutions to x^2 = 9m^2, where m > 0?"), false);
  assert.equal(isRepresentationQuestion("Which of the following represents a possible value of x in terms of p?"), false);
  assert.equal(isRepresentationQuestion("Which equation represents the total cost c of renting a kayak for h hours?"), true);
  // Every letter of a listed integer group, never a word that starts the next phrase.
  assert.deepEqual(questionIntegerParameters("If p, q, and r are positive integers with p < q < r, what is p + q + r?").map((p) => p.name).sort(), ["p", "q", "r"]);
  assert.deepEqual(questionIntegerParameters("For positive integers m and n, 2^m + 3^n = 17. What is mn?").map((p) => p.name).sort(), ["m", "n"]);
  assert.deepEqual(questionIntegerParameters("where k is an integer constant greater than 2").map((p) => p.name), ["k"]);
  assert.deepEqual(questionIntegerParameters("for some positive integer value of t").map((p) => p.name), []);
  // An integer factorization can be written without the word "factor".
  assert.equal(isIntegerFactorExtremumQuestion("For integers a and b, x^2 + kx + 6 = (x + a)(x + b). What is the greatest possible value of k?"), true);
  assert.equal(isIntegerFactorExtremumQuestion("What is the greatest possible value of k if (x + 2)(x + 3) = x^2 + kx + 6?"), false, "no integer restriction");
});
