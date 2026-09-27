import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AnswerConsistencyError,
  applyAnswerState,
  deriveConsistentSolution,
  extractNumbers,
  findAnswerStateRow,
  formatNumber,
  matchChoice,
  normalizeChoices,
  parseNumber,
  reconcileWithCalculator,
  roundsTo,
  validateAnswerState,
} from "../src/lib/answer-consistency";
import { solutionSchema, type Solution } from "../src/lib/solver-schema";

const choices = [
  { label: "A", text: "390" },
  { label: "B", text: "403" },
  { label: "C", text: "406" },
  { label: "D", text: "416" },
];

function desmosSolution(overrides: Partial<Solution> = {}): Solution {
  return solutionSchema.parse({
    status: "solved",
    question: "What is the value of r + s?",
    choices,
    answer: "C) 406",
    method: "desmos",
    why: "",
    steps: [],
    readAnswer: "Line 3 shows r + s = 406, which matches choice C) 406.",
    expressions: [
      { latex: "x_{1}=[1...5]", purpose: "Sample inputs." },
      { latex: "\\frac{12x_{1}+28}{4}-\\frac{s}{13}\\sim r(x_{1}-8)", purpose: "Fit r and s." },
      { latex: "r+s", purpose: "Add the parameters." },
    ],
    result: { row: 3, value: 406, listIndex: null, answerFrom: "value", choiceLabel: "C", detail: "r + s" },
    graphBounds: null,
    clarification: null,
    ...overrides,
  });
}

test("parses the number formats that appear in SAT answer choices", () => {
  const cases: [string, number | null][] = [
    ["406", 406],
    ["−432", -432],
    ["$1,200", 1200],
    ["16/17", 16 / 17],
    ["-3/4", -0.75],
    ["2 1/2", 2.5],
    ["x = 7", 7],
    ["45%", 45],
    ["12 hours", 12],
    ["12 square feet", 12],
    ["0.75", 0.75],
    [".5", 0.5],
    ["2√3", 2 * Math.sqrt(3)],
    ["3π", 3 * Math.PI],
    ["π/4", Math.PI / 4],
    ["-5√2/2", -5 * Math.SQRT2 / 2],
    ["3 and 4", null],
    ["(7, 22)", null],
    ["", null],
    ["1/0", null],
  ];
  for (const [text, expected] of cases) {
    const parsed = parseNumber(text);
    if (expected === null) assert.equal(parsed, null, text);
    else assert.ok(parsed !== null && Math.abs(parsed - expected) < 1e-9, `${text} -> ${parsed}`);
  }
});

test("matches a computed value to exactly one choice, tolerating display rounding", () => {
  const normalized = normalizeChoices(choices)!;
  assert.equal(matchChoice(406, normalized)?.label, "C");
  assert.equal(matchChoice(405.99999, normalized)?.label, "C");
  assert.equal(matchChoice(403, normalized)?.label, "B");
  assert.equal(matchChoice(3, normalized), null);
  assert.equal(matchChoice(404.5, normalized), null, "halfway between two choices is ambiguous");
  const fractions = normalizeChoices([
    { label: "A", text: "7/3" }, { label: "B", text: "5/2" }, { label: "C", text: "3" }, { label: "D", text: "2" },
  ])!;
  assert.equal(matchChoice(2.33, fractions)?.label, "A", "a rounded display still maps to 7/3");
  const close = normalizeChoices([{ label: "A", text: "1.41" }, { label: "B", text: "1.414" }])!;
  assert.equal(matchChoice(1.414, close)?.label, "B");
  assert.equal(matchChoice(1.412, close), null);
  assert.equal(matchChoice(5, normalizeChoices([{ label: "A", text: "2√3" }])!), null);
  assert.equal(matchChoice(3.4641, normalizeChoices([{ label: "A", text: "√3" }, { label: "B", text: "2√3" }])!)?.label, "B");
  const percents = normalizeChoices([{ label: "A", text: "12.5%" }, { label: "B", text: "25%" }, { label: "C", text: "50%" }])!;
  assert.equal(matchChoice(25, percents)?.label, "B");
  assert.equal(matchChoice(0.25, percents)?.label, "B", "Desmos shows the decimal form of a percent");
  assert.equal(roundsTo("0.667", 2 / 3), true);
  assert.equal(roundsTo("0.66", 2 / 3), false);
  assert.equal(roundsTo("0.9", 16 / 17), false, "one significant digit is not an SAT answer");
  assert.equal(roundsTo("0.941", 16 / 17), true);
  assert.equal(roundsTo("2/3", 2 / 3), true);
  assert.equal(formatNumber(2 / 3), "0.666667");
  assert.equal(formatNumber(-432), "-432");
});

test("normalizes choice labels and rejects duplicates", () => {
  assert.deepEqual(
    normalizeChoices([{ label: "(a)", text: "A) 390" }, { label: "B.", text: "403" }])?.map((c) => [c.label, c.text, c.value]),
    [["A", "390", 390], ["B", "403", 403]],
  );
  assert.equal(normalizeChoices([]), null);
  assert.throws(() => normalizeChoices([{ label: "A", text: "1" }, { label: "a", text: "2" }]), AnswerConsistencyError);
});

test("prose numbers ignore row, entry, and choice references", () => {
  assert.deepEqual(extractNumbers("Click the right intersection of lines 1 and 2 and read x = 3."), [3]);
  assert.deepEqual(extractNumbers("Entry 1 of line 8 is 0, so choice A, −432, is excluded."), [0, -432]);
  assert.deepEqual(extractNumbers("Read k under line 3: 0.941176, which is 16/17."), [0.941176, 16 / 17]);
});

test("derives the answer and rewrites a contradictory read instruction", () => {
  const derived = deriveConsistentSolution({
    choices,
    result: { row: 3, value: 406, listIndex: null, answerFrom: "value", choiceLabel: "B", detail: "r + s" },
    answer: "403 (B)",
    readAnswer: "Line 2 gives s = 403, so the computed row is 403 (B).",
    expressionCount: 3,
  });
  assert.equal(derived.answer, "C) 406");
  assert.equal(derived.result.choiceLabel, "C");
  assert.equal(derived.readAnswer, "Line 3 shows r + s = 406, which matches choice C) 406.");
  assert.equal(derived.repairs.length, 3);
});

test("choice-position results select the aligned choice and validate the index", () => {
  const lines = [{ label: "A", text: "−432" }, { label: "B", text: "−9" }, { label: "C", text: "72" }, { label: "D", text: "288" }];
  const derived = deriveConsistentSolution({
    choices: lines,
    result: { row: 8, value: 0, listIndex: 1, answerFrom: "choice_position", choiceLabel: "B", detail: "g(0) − f(0)" },
    answer: "B",
    readAnswer: "The zero entry marks the coincident line.",
    expressionCount: 8,
  });
  assert.equal(derived.answer, "A) −432");
  assert.equal(derived.readAnswer, "The zero entry marks the coincident line. Entry 1 of line 8 shows g(0) − f(0) = 0, which matches choice A) −432.");
  assert.throws(
    () => deriveConsistentSolution({
      choices: lines,
      result: { row: 8, value: 0, listIndex: 5, answerFrom: "choice_position", choiceLabel: "A", detail: "d" },
      answer: "A", readAnswer: "x", expressionCount: 8,
    }),
    /correspond to one of the answer choices/,
  );
  assert.throws(
    () => deriveConsistentSolution({
      choices: null,
      result: { row: 8, value: 0, listIndex: 1, answerFrom: "choice_position", choiceLabel: null, detail: "d" },
      answer: "A", readAnswer: "x", expressionCount: 8,
    }),
    /needs transcribed answer choices/,
  );
});

test("reasoning results require a valid choice letter and keep symbolic choices", () => {
  const graphs = [{ label: "A", text: "Graph A" }, { label: "B", text: "Graph B" }];
  const derived = deriveConsistentSolution({
    choices: graphs,
    result: { row: 1, value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: "b", detail: "the parabola's shape" },
    answer: "Graph B opens upward",
    readAnswer: "Compare line 1 with the pictured graphs.",
    expressionCount: 1,
  });
  assert.equal(derived.answer, "B) Graph B");
  assert.match(derived.readAnswer, /matches choice B\) Graph B\.$/);
  assert.throws(
    () => deriveConsistentSolution({
      choices: graphs,
      result: { row: 1, value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: "E", detail: "d" },
      answer: "E", readAnswer: "x", expressionCount: 1,
    }),
    /must be one of the transcribed choices/,
  );
  const radicals = deriveConsistentSolution({
    choices: [{ label: "A", text: "2√3" }, { label: "B", text: "3√2" }],
    result: { row: 1, value: 3.4641, listIndex: null, answerFrom: "value", choiceLabel: "A", detail: "the distance" },
    answer: "A) 2√3",
    readAnswer: "Line 1 shows 3.4641, which equals 2√3, choice A.",
    expressionCount: 1,
  });
  assert.equal(radicals.answer, "A) 2√3");
});

test("the browser confirms a matching calculator value and flags a clean contradiction", () => {
  const solution = desmosSolution({ answer: "B) 403", result: { ...desmosSolution().result!, value: 403, choiceLabel: "B" } });
  const contradicted = reconcileWithCalculator(solution, { type: "Number", value: 406 });
  assert.equal(contradicted.status, "contradicted");
  if (contradicted.status === "contradicted") {
    assert.equal(contradicted.answer, "C) 406");
    assert.equal(contradicted.readAnswer, "Line 3 shows r + s = 406, which matches choice C) 406.");
    assert.match(contradicted.message, /shows r \+ s = 406 on line 3\. That is choice C\) 406, not the stated B\) 403/);
    assert.doesNotMatch(contradicted.message, /solve again/i);
  }
  const verified = reconcileWithCalculator(desmosSolution(), { type: "Number", value: 405.9999999 });
  assert.equal(verified.status, "verified");
  // A value that matches no choice at all is inconclusive, not a confident
  // contradiction: it renders nothing rather than an alarming guess.
  const inconclusive = reconcileWithCalculator(desmosSolution(), { type: "Number", value: 3 });
  assert.deepEqual(inconclusive, { status: "unverified" });
  assert.equal(reconcileWithCalculator(desmosSolution(), null).status, "unverified");
  assert.equal(reconcileWithCalculator(desmosSolution({ result: null }), { type: "Number", value: 406 }).status, "unverified");
});

test("the browser re-reads a choice list by position", () => {
  const lines = [{ label: "A", text: "−432" }, { label: "B", text: "−9" }, { label: "C", text: "72" }, { label: "D", text: "288" }];
  const base = desmosSolution({
    choices: lines,
    answer: "A) −432",
    expressions: Array.from({ length: 8 }, (_, index) => ({ latex: `y=${index}`, purpose: "row" })),
    result: { row: 8, value: 0, listIndex: 1, answerFrom: "choice_position", choiceLabel: "A", detail: "g(0) − f(0)" },
  });
  assert.equal(reconcileWithCalculator(base, { type: "ListOfNumber", value: [0, 423, 504, 720] }).status, "verified");
  const moved = reconcileWithCalculator(base, { type: "ListOfNumber", value: [423, 0, 504, 720] });
  assert.equal(moved.status, "contradicted");
  if (moved.status === "contradicted") {
    assert.equal(moved.answer, "B) −9");
    assert.doesNotMatch(moved.message, /solve again/i);
  }
  // Ambiguous (matches more than one entry) or absent matches are inconclusive.
  assert.deepEqual(reconcileWithCalculator(base, { type: "ListOfNumber", value: [1, 2, 3, 4] }), { status: "unverified" });
  assert.deepEqual(reconcileWithCalculator(base, { type: "ListOfNumber", value: [0, 0, 3, 4] }), { status: "unverified" });
});

test("student-produced fractions verify against the calculator's decimal", () => {
  const spr = desmosSolution({
    choices: null,
    answer: "16/17",
    result: { row: 3, value: 0.941176, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the fitted k" },
  });
  assert.equal(reconcileWithCalculator(spr, { type: "Number", value: 16 / 17 }).status, "verified");
  const wrong = reconcileWithCalculator(spr, { type: "Number", value: 0.5 });
  assert.equal(wrong.status, "contradicted");
  if (wrong.status === "contradicted") assert.equal(wrong.answer, "0.5");
});

test("solutions saved before choices, result, and answerState existed still load", () => {
  const legacy = solutionSchema.parse({
    status: "solved", question: "q", answer: "3", method: "desmos", why: "", steps: [],
    readAnswer: "Read 3.", expressions: [{ latex: "y=x^2-9", purpose: "p" }], graphBounds: null, clarification: null,
  });
  assert.equal(legacy.choices, null);
  assert.equal(legacy.result, null);
  assert.equal(legacy.answerState, null);
  assert.equal(reconcileWithCalculator(legacy, { type: "Number", value: 3 }).status, "unverified");
});

test("realistic model outputs are accepted rather than rejected", () => {
  const value = (row: number, v: number | null, label: string | null) =>
    ({ row, value: v, listIndex: null, answerFrom: "value" as const, choiceLabel: label, detail: "the result" });
  // A rounded student-produced answer is a correct statement of the value.
  const rounded = deriveConsistentSolution({
    choices: null, result: value(1, 2 / 3, null), answer: "0.667", readAnswer: "Read 0.667 on line 1.", expressionCount: 1,
  });
  assert.equal(rounded.answer, "0.667");
  assert.deepEqual(rounded.repairs, []);
  // Mixed symbolic and numeric choices map through π and √ forms.
  assert.equal(
    deriveConsistentSolution({
      choices: [{ label: "A", text: "π" }, { label: "B", text: "2" }, { label: "C", text: "4" }, { label: "D", text: "2π" }],
      result: value(1, 6.2832, "A"), answer: "A) π", readAnswer: "Line 1 shows 6.28.", expressionCount: 1,
    }).answer,
    "D) 2π",
  );
  // A clicked intersection the model could not reduce to a number keeps its letter.
  assert.equal(
    deriveConsistentSolution({
      choices: [{ label: "A", text: "5" }, { label: "B", text: "6" }, { label: "C", text: "7" }, { label: "D", text: "8" }],
      result: value(1, null, "C"), answer: "C) 7", readAnswer: "Click the right intersection and read x = 7.", expressionCount: 2,
    }).answer,
    "C) 7",
  );
  // Percent choices match the decimal Desmos displays.
  assert.equal(
    deriveConsistentSolution({
      choices: [{ label: "A", text: "12.5%" }, { label: "B", text: "25%" }, { label: "C", text: "50%" }],
      result: value(1, 0.25, "B"), answer: "B) 25%", readAnswer: "Line 1 shows 0.25.", expressionCount: 1,
    }).answer,
    "B) 25%",
  );
  // A missing list index is recovered from the stated letter.
  const positioned = deriveConsistentSolution({
    choices: [{ label: "A", text: "1" }, { label: "B", text: "2" }],
    result: { row: 3, value: 0, listIndex: null, answerFrom: "choice_position", choiceLabel: "B", detail: "the difference" },
    answer: "B", readAnswer: "The second entry is zero.", expressionCount: 3,
  });
  assert.equal(positioned.answer, "B) 2");
  assert.equal(positioned.result.listIndex, 2);
  // A numeric letter that disagrees with the calculator is still rejected.
  assert.throws(
    () => deriveConsistentSolution({
      choices: [{ label: "A", text: "390" }, { label: "B", text: "403" }, { label: "C", text: "406" }],
      result: value(3, 3, "B"), answer: "B) 403", readAnswer: "x", expressionCount: 3,
    }),
    /does not match any answer choice/,
  );
});

test("a list entry reported as a value is read as the choice position it selects", () => {
  // Observed in production: f(A)-g(A) over the choice list, entry 3 is zero.
  const derived = deriveConsistentSolution({
    choices: [{ label: "A", text: "5" }, { label: "B", text: "6" }, { label: "C", text: "7" }, { label: "D", text: "8" }],
    result: { row: 4, value: 0, listIndex: 3, answerFrom: "value", choiceLabel: "C", detail: "f(A) − g(A)" },
    answer: "C) 7",
    readAnswer: "Read row 4, list entry 3 (value 0) which corresponds to choice C) 7.",
    expressionCount: 4,
  });
  assert.equal(derived.answer, "C) 7");
  assert.equal(derived.result.answerFrom, "choice_position");
  assert.equal(derived.result.listIndex, 3);
  assert.match(derived.repairs.join(" "), /read as a choice position/);
  // The browser then verifies by position too.
  const check = reconcileWithCalculator(
    { choices: derived.choices, answer: derived.answer, result: derived.result, expressions: [] },
    { type: "ListOfNumber", value: [-4, -3, 0, 5] },
  );
  assert.equal(check.status, "verified");
});

test("a slider row is never used to confirm or contradict the answer", () => {
  const slider = desmosSolution({
    choices: null,
    answer: "2",
    expressions: [
      { latex: "k=0", purpose: "slider", slider: { min: -5, max: 5, step: 1 } },
      { latex: "y=\\left|x-3\\right|+k", purpose: "graph" },
      { latex: "y=2", purpose: "line" },
    ],
    result: { row: 1, value: 2, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "k" },
  });
  // Desmos reports the slider's current position (0), which must not become a "contradiction".
  assert.equal(reconcileWithCalculator(slider, { type: "Number", value: 0 }).status, "unverified");
  const bare = { ...slider, expressions: [{ latex: "k=0", purpose: "slider" }, ...slider.expressions.slice(1)] };
  assert.equal(reconcileWithCalculator(bare, { type: "Number", value: 0 }).status, "unverified");
  // A horizontal line y=7 is a graph row, not a slider, so a numeric row after it still verifies.
  const line = desmosSolution({ expressions: [{ latex: "y=7", purpose: "line" }, { latex: "r+s", purpose: "sum" }], result: { ...desmosSolution().result!, row: 2 } });
  assert.equal(reconcileWithCalculator(line, { type: "Number", value: 406 }).status, "verified");
});

test("a non-numeric (graphical/written) result type is unverified, never a banner", () => {
  const intersection = desmosSolution({
    result: {
      type: "intersection", row: 1, relatedRows: [2], value: null, listIndex: null,
      answerFrom: "reasoning", choiceLabel: null, detail: "where the graphs intersect here",
    },
  });
  assert.deepEqual(reconcileWithCalculator(intersection, { type: "Number", value: 406 }), { status: "unverified" });
  const written = desmosSolution({
    expressions: [],
    result: { type: "written", row: null, relatedRows: [], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "read from the story" },
  });
  assert.deepEqual(reconcileWithCalculator(written, { type: "Number", value: 406 }), { status: "unverified" });
});

// --- A1: answerState (slider-dependent answers) -----------------------------

test("applyAnswerState overrides only the matching slider row's value", () => {
  // The reported reproduction: k=2 was a non-answer starting value; the
  // answer occurs at k=3, and row 3 depends on k but is not the slider row.
  const rows = [
    { latex: "k=2", purpose: "Slider for the unknown coefficient." },
    { latex: "g(x)=k(x+2)(x-8)", purpose: "The parabola through the given roots, scaled by k." },
    { latex: "g''(0)/2+g'(0)", purpose: "Evaluate a+b for the expanded parabola." },
  ];
  const applied = applyAnswerState(rows, { param: "k", value: 3 });
  assert.deepEqual(applied.map((row) => row.latex), [
    "k=3",
    "g(x)=k(x+2)(x-8)",
    "g''(0)/2+g'(0)",
  ]);
  // Purposes and every other row are untouched; a new array is returned.
  assert.equal(applied[0].purpose, rows[0].purpose);
  assert.notEqual(applied, rows);
  assert.equal(rows[0].latex, "k=2", "the original plan is not mutated");
  // A null/undefined answerState is a no-op (identical behavior to today).
  assert.deepEqual(applyAnswerState(rows, null).map((r) => r.latex), rows.map((r) => r.latex));
  assert.deepEqual(applyAnswerState(rows, undefined).map((r) => r.latex), rows.map((r) => r.latex));
  // A non-integer value is formatted plainly.
  assert.equal(applyAnswerState(rows, { param: "k", value: 2.5 })[0].latex, "k=2.5");
});

test("findAnswerStateRow locates the slider row by its assigned variable", () => {
  const rows = [
    { latex: "k=2", purpose: "", slider: { min: 1, max: 5, step: 1 } },
    { latex: "g(x)=k(x+2)(x-8)", purpose: "" },
  ];
  const found = findAnswerStateRow(rows, "k");
  assert.equal(found?.index, 0);
  assert.deepEqual(found?.slider, { min: 1, max: 5, step: 1 });
  assert.equal(findAnswerStateRow(rows, "m"), null, "no row assigns m");
  const noBounds = [{ latex: "k=2", purpose: "" }];
  assert.equal(findAnswerStateRow(noBounds, "k"), null, "a slider-shaped row without slider bounds cannot host answerState");
});

test("validateAnswerState rejects a param with no matching slider row", () => {
  const rows = [{ latex: "g(x)=k(x+2)(x-8)", purpose: "" }];
  assert.throws(
    () => validateAnswerState(rows, { param: "k", value: 3 }),
    (error: unknown) => error instanceof AnswerConsistencyError && error.stage === "answer_state" && /must name a slider row/.test(error.message),
  );
});

test("validateAnswerState rejects a value outside the slider's own range", () => {
  const rows = [{ latex: "k=2", purpose: "", slider: { min: 1, max: 5, step: 1 } }];
  assert.throws(
    () => validateAnswerState(rows, { param: "k", value: 9 }),
    /outside its slider range \[1, 5\]/,
  );
  assert.doesNotThrow(() => validateAnswerState(rows, { param: "k", value: 5 }), "the range is inclusive");
});

test("validateAnswerState requires an integer when the slider is integer-stepped", () => {
  const integerSlider = [{ latex: "k=2", purpose: "", slider: { min: 1, max: 10, step: 1 } }];
  assert.throws(
    () => validateAnswerState(integerSlider, { param: "k", value: 3.5 }),
    /integer slider \(step 1\).*must be an integer, not 3\.5/,
  );
  assert.doesNotThrow(() => validateAnswerState(integerSlider, { param: "k", value: 3 }));
  const continuousSlider = [{ latex: "k=2", purpose: "", slider: { min: 0, max: 5, step: 0.1 } }];
  assert.doesNotThrow(
    () => validateAnswerState(continuousSlider, { param: "k", value: 2.5 }),
    "a non-integer step imposes no integer requirement",
  );
});

test("REGRESSION 1: the reported reproduction — slider set to k=3 verifies -15 with no banner", () => {
  // f(x)=ax^2+bx+c through (-2,0) and (8,0), a>1 integer, asked for a+b.
  // g(x)=k(x+2)(x-8): at k=3, g(x)=3(x+2)(x-8)=3x^2-18x-48, so a=3, b=-18.
  // g'(x)=6x-18, g''(x)=6 (constant), so g''(0)/2+g'(0) = 3 + (-18) = -15 = choice D.
  const rows = [
    { latex: "k=2", purpose: "Slider for the leading coefficient.", slider: { min: 2, max: 10, step: 1 } },
    { latex: "g(x)=k(x+2)(x-8)", purpose: "The parabola through the given roots, scaled by k." },
    { latex: "g''(0)/2+g'(0)", purpose: "a + b for the expanded parabola." },
  ];
  const answerState = { param: "k", value: 3 };
  // 1) Validation accepts the slider-dependent answer (server-side gate).
  assert.doesNotThrow(() => validateAnswerState(rows, answerState));
  // 2) The loader opens the calculator with k already at 3, not at the row's
  //    own written starting value (2) and not at the slider's minimum.
  const loaded = applyAnswerState(rows, answerState);
  assert.equal(loaded[0].latex, "k=3");
  // 3) With the calculator actually sitting at k=3 (as the loader guarantees),
  //    Desmos reports -15 for row 3, matching choice D exactly, so the
  //    verifier confirms it — no banner, only the quiet confirmation.
  const solution = desmosSolution({
    choices: [
      { label: "A", text: "-5" }, { label: "B", text: "-8" },
      { label: "C", text: "-12" }, { label: "D", text: "-15" },
    ],
    answer: "D) -15",
    expressions: loaded,
    answerState,
    result: { row: 3, value: -15, listIndex: null, answerFrom: "value", choiceLabel: "D", detail: "a + b" },
  });
  const check = reconcileWithCalculator(solution, { type: "Number", value: -15 });
  assert.deepEqual(check, {
    status: "verified",
    observed: -15,
    message: "Desmos confirms line 3 shows a + b = -15.",
  });
});

test("REGRESSION 1b: before the fix, an unmoved slider is what produced the false failure", () => {
  // Same plan, but the calculator is read at the slider's OWN starting value
  // (k=2) instead of answerState's k=3: g(x)=2(x+2)(x-8), g'(x)=4x-12,
  // g''(x)=4, so g''(0)/2+g'(0) = 2 + (-12) = -10, which matches no choice.
  // This must be reported as inconclusive (unverified), never as a hard
  // "does not match any answer choice" alarm.
  const solution = desmosSolution({
    choices: [
      { label: "A", text: "-5" }, { label: "B", text: "-8" },
      { label: "C", text: "-12" }, { label: "D", text: "-15" },
    ],
    answer: "D) -15",
    expressions: [
      { latex: "k=2", purpose: "Slider.", slider: { min: 2, max: 10, step: 1 } },
      { latex: "g(x)=k(x+2)(x-8)", purpose: "The parabola." },
      { latex: "g''(0)/2+g'(0)", purpose: "a + b." },
    ],
    answerState: { param: "k", value: 3 },
    result: { row: 3, value: -15, listIndex: null, answerFrom: "value", choiceLabel: "D", detail: "a + b" },
  });
  assert.deepEqual(reconcileWithCalculator(solution, { type: "Number", value: -10 }), { status: "unverified" });
});

test("REGRESSION 2: answerState null with a static method verifies exactly as before", () => {
  // No slider anywhere in the plan; answerState stays null (the schema
  // default), and the existing numeric verification path is unaffected.
  const solution = desmosSolution();
  assert.equal(solution.answerState, null);
  assert.deepEqual(reconcileWithCalculator(solution, { type: "Number", value: 406 }), {
    status: "verified",
    observed: 406,
    message: "Desmos confirms line 3 shows r + s = 406.",
  });
});
