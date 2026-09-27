import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compactStrategyPortfolioSchema,
  selectCompactStrategy,
  selectStrategy,
  StrategySelectionError,
  strategyPortfolioSchema,
  type StrategyCandidate,
  type StrategyPortfolio,
  type StrategyScores,
  type CompactStrategyPortfolio,
} from "../src/lib/strategy-selection";

function candidate(
  id: string,
  scores: Partial<StrategyScores> = {},
): StrategyCandidate {
  return {
    id,
    name: id,
    trick: "Derivative regression for parallel lines",
    reusable: true,
    techniques: ["regression", "derivative_regression", "answer_choice_testing"],
    scores: {
      correctness: 5,
      simplicity: 4,
      student_effort: 2,
      manual_math_knowledge: 2,
      manual_algebra: 2,
      manual_calculation: 2,
      desmos_outsourcing: 3,
      reliability: 4,
      steps_time: 3,
      ...scores,
    },
    humanWork: "Copy the two graph points and the answer choices.",
    desmosWork: "Fit the line, match its slope, and test each choice.",
    validityNote: "The overlapping choice is excluded by the no-solution condition.",
    solution: {
      answer: "A. −432",
      method: "desmos",
      why: "Desmos fits the given points and compares the answer choices.",
      steps: [],
      expressions: [
        { latex: "x_{1}=[-6,0]", purpose: "Copies the x-coordinates." },
        { latex: "y_{1}=[0,-9]", purpose: "Copies the matching y-coordinates." },
        { latex: "y_{1}\\sim mx_{1}+b", purpose: "Fits the given line." },
        {
          latex: "f(x)=-1.5x-9",
          purpose: "Copies the numeric equation displayed by the regression in line 3.",
        },
        { latex: "t=[-432,-9,72,288]", purpose: "Tests all four choices." },
        { latex: "g(x)=(-sx+t)/48", purpose: "Graphs each proposed line." },
        { latex: "g'(0)\\sim f'(0)", purpose: "Matches the slopes automatically." },
        { latex: "g(0)-f(0)", purpose: "Finds the choice that overlaps the given line." },
      ],
      readAnswer: "The first difference is zero, so the overlapping choice A, −432, is excluded.",
      result: {
        row: 8,
        value: 0,
        listIndex: 1,
        answerFrom: "choice_position",
        choiceLabel: "A",
        detail: "g(0) − f(0)",
      },
      graphBounds: { left: -12, right: 6, bottom: -12, top: 8 },
    },
  };
}

const choices = [
  { label: "A", text: "−432" },
  { label: "B", text: "−9" },
  { label: "C", text: "72" },
  { label: "D", text: "288" },
];

function portfolio(candidates: StrategyCandidate[]): StrategyPortfolio {
  return {
    status: "solved",
    question: "Line h passes through (−6, 0) and (0, −9). Line k is sx + 48y = t. The system has no solution. Which value of t is NOT possible?",
    choices,
    clarification: null,
    structure: "A line through two points and a second line with unknown coefficients that must be parallel.",
    candidates,
  };
}

function withThird(
  first: StrategyCandidate,
  second: StrategyCandidate,
): StrategyPortfolio {
  return portfolio([
    first,
    second,
    candidate("uncertain", { correctness: 4, manual_math_knowledge: 0 }),
  ]);
}

function selectedId(value: StrategyPortfolio) {
  return selectStrategy(value).strategySelection?.selectedCandidateId;
}

function compactPortfolio(
  value: StrategyPortfolio,
  selectedCandidateId: string | null,
): CompactStrategyPortfolio {
  return {
    ...value,
    candidates: value.candidates.map(({ solution: _solution, ...audit }) => {
      void _solution;
      return audit;
    }),
    selectedCandidateId,
    solution:
      value.candidates.find((candidate) => candidate.id === selectedCandidateId)
        ?.solution ?? null,
  };
}

test("all modes reject the reported coefficient-list detour and accept matching bracket rows", () => {
  const selected = candidate("system", {simplicity: 5, manual_math_knowledge: 0, manual_algebra: 0, manual_calculation: 0});
  selected.solution = {
    ...selected.solution, answer: "3", graphBounds: null,
    expressions: [
      {latex: "a_{1}=[7,3]", purpose: "Collect coefficients."},
      {latex: "b_{1}=[12,4]", purpose: "Collect coefficients."},
      {latex: "c_{1}=[3,5]", purpose: "Collect constants."},
      {latex: "c_{1}\\sim2a_{1}r+b_{1}p", purpose: "Fit the system."},
      {latex: "r", purpose: "Read the requested parameter."},
    ],
    readAnswer: "Line 5 shows r=3.",
    result: {row:5, value:3, listIndex:null, answerFrom:"value", choiceLabel:null, detail:"r"},
  };
  const input = compactPortfolio({
    ...portfolio([selected, candidate("other", {correctness:4}), candidate("uncertain", {correctness:4})]),
    question: "7rx+12sy=3 and 3rx+4sy=5. The solution is (2,y). What is r?", choices:null,
  }, selected.id);
  for (const mode of ["weaponized", "desmos_first", "fastest"] as const) {
    assert.throws(() => selectCompactStrategy(input, {mode}), /Unnecessary coefficient lists.*direct bracket regression/);
    const direct = structuredClone(input);
    direct.solution!.expressions = [
      {latex:"x_{1}=2", purpose:"Set the given x-coordinate."},
      {latex:"[7rx_{1}+12p,3rx_{1}+4p]\\sim[3,5]", purpose:"Fit the two original equations together; p stands for the product sy."},
      {latex:"r", purpose:"Display the requested parameter."},
    ];
    direct.solution!.readAnswer = "Line 3 shows r=3; the separate value of p (representing sy) is not unique.";
    direct.solution!.result!.row = 3;
    const result = selectCompactStrategy(direct, {mode});
    assert.equal(result.solution.answer, "3");
    assert.deepEqual(result.solution.expressions, direct.solution!.expressions);
    assert.equal(result.solution.readAnswer, direct.solution!.readAnswer);
  }
});

test("eight calculator rows with less human math beat three formula rows", () => {
  const regression = candidate("regression", {
    simplicity: 3,
    student_effort: 2,
    manual_math_knowledge: 1,
    manual_algebra: 0,
    manual_calculation: 0,
    desmos_outsourcing: 5,
    steps_time: 5,
  });
  // One row per formula, but each formula was derived off-screen.
  const formulas = candidate("formulas", {
    simplicity: 2,
    student_effort: 3,
    manual_math_knowledge: 3,
    manual_algebra: 2,
    manual_calculation: 0,
    desmos_outsourcing: 2,
    steps_time: 1,
  });
  formulas.solution.expressions = [
    { latex: "m=(-9-0)/(0-(-6))", purpose: "Calculate the slope." },
    { latex: "s=-48m", purpose: "Rearrange the coefficient to match the slope." },
    { latex: "t=s(-6)+48(0)", purpose: "Substitute the point into the equation." },
  ];
  formulas.solution.result = {
    row: 3, value: -432, listIndex: null, answerFrom: "value", choiceLabel: "A", detail: "t",
  };
  const result = selectStrategy(withThird(formulas, regression));
  assert.equal(result.strategySelection?.selectedCandidateId, "regression");
  assert.equal(result.solution.expressions.length, 8);
  assert.deepEqual(
    selectCompactStrategy(compactPortfolio(withThird(formulas, regression), "regression")),
    result,
  );
});

test("each effort priority wins before all lower priorities", async (context) => {
  const cases: {
    name: string;
    better: Partial<StrategyScores>;
    worse: Partial<StrategyScores>;
  }[] = [
    {
      name: "simplicity before effort, math, rows, calculator work, and reliability",
      better: { simplicity: 5, student_effort: 5, manual_math_knowledge: 5, manual_algebra: 5, manual_calculation: 5, steps_time: 5, desmos_outsourcing: 0, reliability: 0 },
      worse: { simplicity: 4, student_effort: 0, manual_math_knowledge: 0, manual_algebra: 0, manual_calculation: 0, steps_time: 0, desmos_outsourcing: 5, reliability: 5 },
    },
    {
      name: "total effort before manual math, rows, calculator work, and reliability",
      better: { student_effort: 1, manual_math_knowledge: 5, manual_algebra: 5, manual_calculation: 5, steps_time: 5, desmos_outsourcing: 0, reliability: 0 },
      worse: { student_effort: 2, manual_math_knowledge: 0, manual_algebra: 0, manual_calculation: 0, steps_time: 0, desmos_outsourcing: 5, reliability: 5 },
    },
    {
      name: "combined manual math before rows, calculator work, and reliability",
      better: { manual_math_knowledge: 0, manual_algebra: 0, manual_calculation: 3, steps_time: 5, desmos_outsourcing: 0, reliability: 0 },
      worse: { manual_math_knowledge: 2, manual_algebra: 2, manual_calculation: 0, steps_time: 0, desmos_outsourcing: 5, reliability: 5 },
    },
    {
      name: "fewer rows before calculator work and reliability",
      better: { steps_time: 1, desmos_outsourcing: 0, reliability: 0 },
      worse: { steps_time: 2, desmos_outsourcing: 5, reliability: 5 },
    },
    {
      name: "calculator work before reliability",
      better: { desmos_outsourcing: 5, reliability: 0 },
      worse: { desmos_outsourcing: 4, reliability: 5 },
    },
    {
      name: "reliability only breaks the remaining tie",
      better: { reliability: 5 },
      worse: { reliability: 4 },
    },
  ];

  for (const item of cases) {
    await context.test(item.name, () => {
      const value = withThird(candidate("worse", item.worse), candidate("better", item.better));
      assert.equal(
        selectedId(value),
        "better",
      );
      assert.equal(
        selectCompactStrategy(compactPortfolio(value, "better"))
          .strategySelection?.selectedCandidateId,
        "better",
      );
      assert.throws(
        () => selectCompactStrategy(compactPortfolio(value, "worse")),
        /does not match the \w+ ranking/,
      );
    });
  }
});

test("incorrect or uncertain candidates cannot win on effort", () => {
  const unchecked = candidate("unchecked", {
    correctness: 4,
    manual_math_knowledge: 0,
    manual_algebra: 0,
    manual_calculation: 0,
  });
  assert.equal(selectedId(withThird(unchecked, candidate("checked"))), "checked");
});

test("a written solution can win when it requires less human math", () => {
  const written = candidate("direct-observation", {
    manual_math_knowledge: 0,
    manual_algebra: 0,
    manual_calculation: 0,
    desmos_outsourcing: 0,
  });
  written.techniques = ["conceptual"];
  written.solution.method = "shortcut";
  written.solution.expressions = [];
  written.solution.why = "The question labels the requested quantity directly; no computation is needed.";
  written.solution.steps = ["Read the labeled value in the question."];
  const result = selectStrategy(withThird(candidate("graph"), written));
  assert.equal(result.strategySelection?.selectedCandidateId, written.id);
  assert.equal(result.solution.readAnswer, null);
  assert.equal(result.solution.graphBounds, null);
  assert.deepEqual(result.solution.steps, written.solution.steps);
});

test("ties preserve generation order and do not compare individual algebra or row count", () => {
  const first = candidate("first", { manual_algebra: 1, manual_calculation: 3 });
  const second = candidate("second", { manual_algebra: 3, manual_calculation: 1 });
  second.solution.expressions = second.solution.expressions.slice(0, 1);
  second.solution.result = { ...second.solution.result!, row: 1 };
  assert.equal(selectedId(withThird(first, second)), "first");
});

test("solved portfolios require three to six candidates and a transcribed question", () => {
  for (const count of [0, 1, 2, 7]) {
    assert.throws(
      () => selectStrategy(portfolio(Array.from({ length: count }, (_, index) => candidate(String(index))))),
      StrategySelectionError,
    );
  }
  assert.equal(selectedId(portfolio(Array.from({ length: 6 }, (_, index) => candidate(String(index))))), "0");
  const blankQuestion = withThird(candidate("a"), candidate("b"));
  blankQuestion.question = " \n ";
  assert.throws(() => selectStrategy(blankQuestion), StrategySelectionError);
});

test("candidate IDs are nonblank and unique even with surrounding whitespace", () => {
  for (const ids of [["same", "same"], ["same", " same "], ["valid", "  "]]) {
    assert.throws(
      () => selectStrategy(withThird(candidate(ids[0]), candidate(ids[1]))),
      StrategySelectionError,
    );
  }
});

test("scores must be bounded integers and at least one candidate must be correct", () => {
  for (const invalid of [-1, 6, 2.5]) {
    const value = withThird(candidate("a", { reliability: invalid }), candidate("b"));
    assert.equal(strategyPortfolioSchema.safeParse(value).success, false);
  }
  assert.throws(
    () => selectStrategy(portfolio([candidate("a", { correctness: 3 }), candidate("b", { correctness: 4 }), candidate("c", { correctness: 0 })])),
    StrategySelectionError,
  );
});

test("selected expressions, purposes, and answer instruction come from one canonical plan", () => {
  const canonical = candidate("canonical", { manual_math_knowledge: 0 });
  canonical.solution.method = "algebra";
  canonical.solution.steps = ["An unrelated conventional derivation must not be displayed."];
  const result = selectStrategy(withThird(candidate("other"), canonical));
  assert.deepEqual(result.solution.expressions, canonical.solution.expressions);
  assert.equal(result.solution.readAnswer, canonical.solution.readAnswer);
  assert.equal(result.solution.answer, "A) −432");
  assert.deepEqual(result.solution.choices, choices);
  assert.deepEqual(result.strategySelection?.repairs, [
    'The displayed answer was changed from "A. −432" to "A) −432".',
  ]);
  assert.equal(result.solution.method, "desmos");
  assert.deepEqual(result.solution.steps, []);
  assert.equal(result.strategySelection?.candidates.length, 3);
  assert.equal(Object.hasOwn(result.strategySelection!.candidates[0], "solution"), false);
});

test("invalid calculator plans are ineligible instead of hiding missing instructions", () => {
  const cases: ((value: StrategyCandidate) => void)[] = [
    (value) => { value.solution.answer = " "; },
    (value) => { value.solution.why = " "; },
    (value) => { value.solution.expressions[0].latex = " "; },
    (value) => { value.solution.expressions[0].purpose = " "; },
    (value) => { value.solution.expressions = []; },
    (value) => { value.humanWork = " "; },
  ];
  for (const invalidate of cases) {
    const broken = candidate("broken", { manual_math_knowledge: 0 });
    invalidate(broken);
    assert.equal(selectedId(withThird(broken, candidate("valid"))), "valid");
  }
});

test("written candidates cannot claim calculator work and require a reason and steps", () => {
  for (const defect of ["outsourcing", "why", "steps"]) {
    const written = candidate("written", {
      manual_math_knowledge: 0, manual_algebra: 0, manual_calculation: 0, desmos_outsourcing: 0,
    });
    written.solution.method = "algebra";
    written.solution.expressions = [];
    written.solution.steps = ["Use the given relationship."];
    if (defect === "outsourcing") written.scores.desmos_outsourcing = 1;
    if (defect === "why") written.solution.why = " ";
    if (defect === "steps") written.solution.steps = [];
    assert.equal(selectedId(withThird(written, candidate("valid"))), "valid");
  }
});

test("inverted graph bounds are discarded without changing the chosen plan", () => {
  const value = candidate("chosen", { manual_math_knowledge: 0 });
  value.solution.graphBounds = { left: 5, right: -5, bottom: -10, top: 10 };
  assert.equal(selectStrategy(withThird(value, candidate("other"))).solution.graphBounds, null);
});

test("clarification never executes a candidate or displays its answer", () => {
  const value = portfolio([candidate("must-not-run")]);
  value.status = "needs_clarification";
  value.question = "";
  value.clarification = "Please include the graph's axis labels.";
  const result = selectStrategy(value);
  assert.deepEqual(result, {
    solution: {
      status: "needs_clarification",
      question: "",
      choices: null,
      structure: null,
      trick: null,
      answerState: null,
      parameters: [],
      conditionType: null,
      distinguishes: null,
      clarification: value.clarification,
      answer: "",
      method: "shortcut",
      why: "",
      steps: [],
      readAnswer: null,
      expressions: [],
      result: null,
      graphBounds: null,
    },
    strategySelection: null,
  });
  value.candidates = [];
  assert.equal(selectStrategy(value).solution.status, "needs_clarification");
});

test("selection and returned audits do not mutate or retain mutable input references", () => {
  const value = withThird(candidate("winner", { manual_math_knowledge: 0 }), candidate("other"));
  value.candidates[0].solution.steps = ["Unused algebra explanation."];
  const original = structuredClone(value);
  const result = selectStrategy(value);
  assert.deepEqual(value, original);
  result.solution.expressions[0].purpose = "Changed after selection.";
  result.strategySelection!.candidates[0].scores.manual_algebra = 5;
  assert.deepEqual(value, original);
});

test("compact selection rejects an incorrect winner and preserves stable score ties", () => {
  const value = portfolio([
    candidate("uncertain", { correctness: 4, manual_math_knowledge: 0 }),
    candidate("first", { manual_algebra: 1, manual_calculation: 3 }),
    candidate("second", { manual_algebra: 3, manual_calculation: 1 }),
  ]);
  assert.equal(
    selectCompactStrategy(compactPortfolio(value, "first"))
      .strategySelection?.selectedCandidateId,
    "first",
  );
  for (const id of ["uncertain", "second"]) {
    assert.throws(
      () => selectCompactStrategy(compactPortfolio(value, id)),
      /does not match the \w+ ranking/,
    );
  }
  value.candidates.forEach((item) => { item.scores.correctness = 4; });
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(value, "first")),
    /No candidate passed the correctness check/,
  );
});

test("compact walkthrough preserves canonical expressions and repairs indexed list notation", () => {
  const canonical = candidate("canonical", { manual_math_knowledge: 0 });
  canonical.solution.expressions = [
    { latex: "x1=[-6,0]", purpose: "Copy the x-coordinates." },
    { latex: "y1=[0,-9]", purpose: "Copy the matching y-coordinates." },
    { latex: "y1~mx1+b", purpose: "Fit the line through the points." },
  ];
  canonical.solution.method = "algebra";
  canonical.solution.steps = ["A separate derivation should never be shown."];
  canonical.solution.result = {
    row: 3, value: -432, listIndex: null, answerFrom: "value", choiceLabel: "A", detail: "the fitted t",
  };
  const input = compactPortfolio(withThird(candidate("other"), canonical), "canonical");
  const original = structuredClone(input);
  const result = selectCompactStrategy(input);
  assert.deepEqual(result.solution.expressions, [
    { latex: "x_{1}=[-6,0]", purpose: "Copy the x-coordinates." },
    { latex: "y_{1}=[0,-9]", purpose: "Copy the matching y-coordinates." },
    { latex: "y_{1}~mx_{1}+b", purpose: "Fit the line through the points." },
  ]);
  assert.equal(result.solution.readAnswer, canonical.solution.readAnswer);
  assert.equal(result.solution.answer, "A) −432");
  assert.equal(result.solution.method, "desmos");
  assert.deepEqual(result.solution.steps, []);
  assert.equal(Object.hasOwn(result.strategySelection!.candidates[0], "solution"), false);
  result.solution.expressions[0].purpose = "Changed after selection.";
  result.strategySelection!.candidates[0].scores.manual_algebra = 5;
  assert.deepEqual(input, original);
});

test("compact portfolios require valid scorecards and a populated selected solution", () => {
  const valid = compactPortfolio(withThird(candidate("winner"), candidate("other")), "winner");
  const defects: ((value: CompactStrategyPortfolio) => void)[] = [
    (value) => { value.selectedCandidateId = null; },
    (value) => { value.selectedCandidateId = " "; },
    (value) => { value.selectedCandidateId = "missing"; },
    (value) => { value.solution = null; },
    (value) => { value.question = " "; },
    (value) => { value.candidates = []; },
    (value) => { value.candidates = value.candidates.slice(0, 2); },
    (value) => { value.candidates = [...value.candidates, ...value.candidates, candidate("seventh")]; },
    (value) => { value.candidates[1].id = " winner "; },
    (value) => { value.candidates[1].id = " "; },
    (value) => { value.candidates[1].validityNote = " "; },
    (value) => { value.candidates[1].scores.correctness = 6; },
    (value) => { value.candidates[1].scores.reliability = 2.5; },
  ];
  assert.equal(compactStrategyPortfolioSchema.safeParse(valid).success, true);
  for (const invalidate of defects) {
    const input = structuredClone(valid);
    invalidate(input);
    assert.throws(() => selectCompactStrategy(input), StrategySelectionError);
  }
});

test("compact selection rejects an incomplete winner instead of falling back to another plan", () => {
  const valid = compactPortfolio(
    withThird(candidate("winner", { manual_math_knowledge: 0 }), candidate("other")),
    "winner",
  );
  const defects: ((value: NonNullable<CompactStrategyPortfolio["solution"]>) => void)[] = [
    (value) => { value.answer = " "; },
    (value) => { value.why = " "; },
    (value) => { value.expressions[0].latex = " "; },
    (value) => { value.expressions[0].purpose = " "; },
    (value) => { value.expressions = []; },
  ];
  for (const invalidate of defects) {
    const input = structuredClone(valid);
    invalidate(input.solution!);
    assert.throws(
      () => selectCompactStrategy(input),
      /failed the calculator and explanation checks/,
    );
  }
});

test("compact written solutions retain the same usability checks", () => {
  const written = candidate("written", {
    manual_math_knowledge: 0,
    manual_algebra: 0,
    manual_calculation: 0,
    desmos_outsourcing: 0,
  });
  written.techniques = ["conceptual"];
  written.solution.method = "shortcut";
  written.solution.expressions = [];
  written.solution.why = "Read the requested value directly from its label.";
  written.solution.steps = ["The labeled value is the answer."];
  const input = compactPortfolio(withThird(candidate("graph"), written), "written");
  const result = selectCompactStrategy(input);
  assert.deepEqual(result.solution.steps, written.solution.steps);
  assert.equal(result.solution.readAnswer, null);
  assert.equal(result.solution.graphBounds, null);
  input.candidates[1].scores.desmos_outsourcing = 1;
  assert.throws(() => selectCompactStrategy(input), StrategySelectionError);
});

test("compact clarification does not execute a plan or require candidates", () => {
  const input = compactPortfolio(portfolio([candidate("must-not-run")]), "must-not-run");
  input.status = "needs_clarification";
  input.question = "";
  input.clarification = "Please include the graph's axis labels.";
  const result = selectCompactStrategy(input);
  assert.deepEqual(result, selectStrategy({ ...portfolio([]), ...input, candidates: [] }));
  assert.equal(result.solution.answer, "");
  assert.deepEqual(result.solution.expressions, []);
  assert.equal(result.strategySelection, null);
  input.candidates = [];
  input.selectedCandidateId = null;
  input.solution = null;
  assert.deepEqual(selectCompactStrategy(input), result);
});

test("the displayed answer is derived from the result row, not the model's answer text", () => {
  // r=3, s=403 from the regression; the final row computes r+s=406, but the
  // model wrote the intermediate parameter as its answer and read instruction.
  const plan = candidate("identity-regression", { manual_math_knowledge: 0 });
  plan.solution.expressions = [
    { latex: "x_{1}=[1...5]", purpose: "Sample x-values for the identity." },
    {
      latex: "\\frac{12x_{1}+28}{4}-\\frac{s}{13}\\sim r(x_{1}-8)",
      purpose: "Fit r and s so the identity holds at every sample.",
    },
    { latex: "r+s", purpose: "Add the fitted parameters." },
  ];
  plan.solution.answer = "403 (B)";
  plan.solution.readAnswer = "Line 2 gives s = 403 and r = 3, so line 3 shows 403, choice B.";
  plan.solution.result = {
    row: 3, value: 406, listIndex: null, answerFrom: "value", choiceLabel: "B", detail: "r + s",
  };
  const value = withThird(plan, candidate("other"));
  value.question = "For all real values of x, (12x+28)/4 − s/13 = r(x − 8), where r and s are positive constants. What is the value of r + s?";
  value.choices = [
    { label: "A", text: "390" },
    { label: "B", text: "403" },
    { label: "C", text: "406" },
    { label: "D", text: "416" },
  ];
  const result = selectCompactStrategy(compactPortfolio(value, plan.id));
  assert.equal(result.solution.answer, "C) 406");
  assert.equal(result.solution.result?.choiceLabel, "C");
  assert.equal(
    result.solution.readAnswer,
    "Line 3 shows r + s = 406, which matches choice C) 406.",
  );
  assert.doesNotMatch(result.solution.readAnswer ?? "", /403|choice B/);
  assert.deepEqual(result.strategySelection?.repairs, [
    "The value on line 3, 406 matches choice C, not B.",
    'The displayed answer was changed from "403 (B)" to "C) 406".',
    "The read instruction named a different answer choice and was rewritten.",
  ]);
  assert.deepEqual(selectStrategy(value).solution, result.solution);
});

test("a consistent read instruction is kept and a silent one gains the derived summary", () => {
  const plan = candidate("consistent", { manual_math_knowledge: 0 });
  plan.solution.expressions = [
    { latex: "x_{1}=[1...5]", purpose: "Sample inputs." },
    { latex: "\\frac{12x_{1}+28}{4}-\\frac{s}{13}\\sim r(x_{1}-8)", purpose: "Fit r and s." },
    { latex: "r+s", purpose: "Add the parameters." },
  ];
  plan.solution.answer = "C) 406";
  plan.solution.readAnswer = "Line 2 shows s = 403 and r = 3; line 3 displays r + s = 406, choice C.";
  plan.solution.result = {
    row: 3, value: 406, listIndex: null, answerFrom: "value", choiceLabel: "C", detail: "r + s",
  };
  const value = withThird(plan, candidate("other"));
  value.question = "For all real values of x, (12x+28)/4 − s/13 = r(x − 8), where r and s are positive constants. What is the value of r + s?";
  value.choices = [
    { label: "A", text: "390" }, { label: "B", text: "403" },
    { label: "C", text: "406" }, { label: "D", text: "416" },
  ];
  const kept = selectCompactStrategy(compactPortfolio(value, plan.id));
  assert.equal(kept.solution.readAnswer, plan.solution.readAnswer);
  assert.deepEqual(kept.strategySelection?.repairs, []);

  plan.solution.readAnswer = "Read the parameters under line 2, then the sum on line 3.";
  const appended = selectCompactStrategy(compactPortfolio(value, plan.id));
  assert.equal(
    appended.solution.readAnswer,
    "Read the parameters under line 2, then the sum on line 3. Line 3 shows r + s = 406, which matches choice C) 406.",
  );
});

test("a result value that matches no answer choice rejects the solve instead of guessing", () => {
  const plan = candidate("wrong-row", { manual_math_knowledge: 0 });
  plan.solution.expressions = [
    { latex: "x_{1}=[1...5]", purpose: "Sample inputs." },
    { latex: "\\frac{12x_{1}+28}{4}-\\frac{s}{13}\\sim r(x_{1}-8)", purpose: "Fit r and s." },
    { latex: "r+s", purpose: "Add the parameters." },
  ];
  plan.solution.answer = "C) 406";
  plan.solution.result = {
    row: 3, value: 3, listIndex: null, answerFrom: "value", choiceLabel: "C", detail: "r",
  };
  const value = withThird(plan, candidate("other"));
  value.question = "For all real values of x, (12x+28)/4 − s/13 = r(x − 8), where r and s are positive constants. What is the value of r + s?";
  value.choices = [
    { label: "A", text: "390" }, { label: "B", text: "403" },
    { label: "C", text: "406" }, { label: "D", text: "416" },
  ];
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(value, plan.id)),
    /does not match any answer choice/,
  );
  for (const broken of [
    { ...plan.solution.result, row: 4 },
    { ...plan.solution.result, value: null, choiceLabel: null },
    { ...plan.solution.result, value: null, choiceLabel: "E" },
    null,
  ]) {
    plan.solution.result = broken;
    assert.throws(() => selectCompactStrategy(compactPortfolio(value, plan.id)), StrategySelectionError);
  }
  // Without a number to check, a valid letter is accepted as stated.
  plan.solution.result = {
    row: 3, value: null, listIndex: null, answerFrom: "value", choiceLabel: "C", detail: "r + s",
  };
  assert.equal(selectCompactStrategy(compactPortfolio(value, plan.id)).solution.answer, "C) 406");
});

test("student-produced responses keep an exact answer that agrees with the computed value", () => {
  const plan = candidate("fraction", { manual_math_knowledge: 0 });
  plan.solution.expressions = [
    { latex: "f(x)=3(kx+13)", purpose: "Left side." },
    { latex: "g(x)=\\frac{48}{17}x+36", purpose: "Right side." },
    { latex: "f'(x)\\sim g'(x)", purpose: "Match the slopes to fit k." },
  ];
  plan.solution.answer = "16/17";
  plan.solution.readAnswer = "Read k under line 3: 0.941176, which is 16/17.";
  plan.solution.result = {
    row: 3, value: 0.941176, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the fitted k",
  };
  const value = withThird(plan, candidate("other"));
  value.question = "3(kx + 13) = (48/17)x + 36. In the given equation, k is a constant. The equation has no solution. What is the value of k?";
  value.choices = null;
  const result = selectCompactStrategy(compactPortfolio(value, plan.id));
  assert.equal(result.solution.answer, "16/17");
  assert.equal(result.solution.readAnswer, plan.solution.readAnswer);
  assert.equal(result.solution.choices, null);

  plan.solution.answer = "0.9";
  const repaired = selectCompactStrategy(compactPortfolio(value, plan.id));
  assert.equal(repaired.solution.answer, "0.941176");
  assert.match(repaired.strategySelection?.repairs.join(" ") ?? "", /did not match/);
});

test("rows that use variables Desmos cannot resolve are rejected", () => {
  const plan = candidate("graphed-unknowns", { manual_math_knowledge: 0 });
  plan.solution.expressions = [
    { latex: "-q-19w=-337", purpose: "First equation at y = 19." },
    { latex: "2q-19w=47", purpose: "Second equation at y = 19." },
  ];
  plan.solution.answer = "11";
  plan.solution.readAnswer = "Click the intersection and read w.";
  plan.solution.result = {
    row: 2, value: 11, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "w",
  };
  const value = withThird(plan, candidate("other"));
  value.question = "-x - wy = -337 and 2x - wy = 47. The graphs intersect at (q, 19). What is the value of w?";
  value.choices = null;
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(value, plan.id)),
    /Line 1 uses undefined q, w; Line 2 uses undefined q, w/,
  );

  plan.solution.expressions = [
    { latex: "[-q-19w,2q-19w]\\sim[-337,47]", purpose: "Both equations copied with y = 19, fitted together." },
    { latex: "w", purpose: "Display the fitted w." },
  ];
  plan.solution.result = { ...plan.solution.result, row: 2 };
  assert.equal(selectCompactStrategy(compactPortfolio(value, plan.id)).solution.answer, "11");
});

test("a slider or shared-zero graph beats a one-row formula that was derived off-screen", () => {
  const derived = candidate("derived-formula", {
    simplicity: 2, student_effort: 3, manual_math_knowledge: 3, manual_algebra: 2,
    manual_calculation: 0, steps_time: 0, desmos_outsourcing: 2, reliability: 5,
  });
  derived.solution.expressions = [{ latex: "B=(M-7)/6", purpose: "The formula for b." }];
  derived.solution.result = { row: 1, value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "b" };
  const slider = candidate("shared-zero-slider", {
    simplicity: 5, student_effort: 2, manual_math_knowledge: 1, manual_algebra: 0,
    manual_calculation: 0, steps_time: 2, desmos_outsourcing: 2, reliability: 4,
  });
  slider.solution.expressions = [
    { latex: "b=1", purpose: "Integer slider for b.", slider: { min: 1, max: 10, step: 1 } },
    { latex: "y=x+2b", purpose: "The factor." },
    { latex: "y=3x^2+25x+14b", purpose: "The polynomial." },
  ];
  slider.solution.result = { row: 1, value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "the slider value where the graphs share an x-intercept" };
  const value = portfolio([derived, slider, candidate("uncertain", { correctness: 4 })]);
  value.question = "x + 2b is a factor of 3x^2 + 25x + 14b, where b is a positive integer constant. What is the value of b?";
  value.choices = null;
  derived.solution.answer = "3";
  slider.solution.answer = "3";
  assert.equal(selectedId(value), slider.id);
  assert.equal(selectCompactStrategy(compactPortfolio(value, slider.id)).solution.expressions[0].slider?.step, 1);
});

test("a direct intersection beats a list construction of the same comparison", () => {
  const intersection = candidate("intersection", {
    simplicity: 5, student_effort: 1, manual_math_knowledge: 0, manual_algebra: 0,
    manual_calculation: 0, steps_time: 1, desmos_outsourcing: 3, reliability: 5,
  });
  const lists = candidate("choice-list", {
    simplicity: 3, student_effort: 2, manual_math_knowledge: 1, manual_algebra: 0,
    manual_calculation: 0, steps_time: 3, desmos_outsourcing: 5, reliability: 5,
  });
  assert.equal(selectedId(withThird(lists, intersection)), intersection.id);
});

test("a restricted graph's extremum beats sampling values into a list", () => {
  const visual = candidate("restricted-graph", {
    simplicity: 5, student_effort: 1, manual_math_knowledge: 0, manual_algebra: 0,
    manual_calculation: 0, steps_time: 1, desmos_outsourcing: 3, reliability: 5,
  });
  const sampled = candidate("sampled-list", {
    simplicity: 3, student_effort: 2, manual_math_knowledge: 1, manual_algebra: 0,
    manual_calculation: 0, steps_time: 3, desmos_outsourcing: 4, reliability: 3,
  });
  assert.equal(selectedId(withThird(sampled, visual)), visual.id);
});

test("a written plan that admits real manual math is ineligible while a simple calculator plan exists", () => {
  const written = candidate("slope-by-hand", {
    simplicity: 5, student_effort: 1, manual_math_knowledge: 2, manual_algebra: 1,
    manual_calculation: 0, desmos_outsourcing: 0,
  });
  written.techniques = ["algebra"];
  written.solution.method = "algebra";
  written.solution.expressions = [];
  written.solution.why = "The slope of 6x-ay=15 is 6/a and must equal 3/2.";
  written.solution.steps = ["Find the slope 9/6.", "Set 6/a=3/2 and solve for a."];
  const value = withThird(written, candidate("slider"));
  assert.equal(selectedId(value), "slider");
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(value, written.id)),
    /cannot beat a calculator method in desmos_first mode/,
  );
  // Interpretation-only written plans (translate the words, stop) remain eligible.
  written.scores.manual_math_knowledge = 1;
  written.scores.manual_algebra = 0;
  assert.equal(selectedId(value), written.id);
});

test("basic math is acceptable when every Desmos route is convoluted (the escape hatch)", () => {
  const written = candidate("one-trivial-step", {
    simplicity: 4, student_effort: 1, manual_math_knowledge: 1, manual_algebra: 2,
    manual_calculation: 0, desmos_outsourcing: 0,
  });
  written.techniques = ["algebra"];
  written.solution.method = "algebra";
  written.solution.expressions = [];
  written.solution.why = "One Algebra 1 step answers it; every calculator setup needs seven rows.";
  written.solution.steps = ["Divide both sides by 4."];
  // Both calculator plans are convoluted: simplicity 2.
  const value = portfolio([
    written,
    candidate("seven-row-regression", { simplicity: 2, student_effort: 3 }),
    candidate("nested-lists", { simplicity: 1, student_effort: 4 }),
  ]);
  assert.equal(selectedId(value), written.id);
  assert.equal(selectCompactStrategy(compactPortfolio(value, written.id)).solution.trick, "Derivative regression for parallel lines");
  // Weaponized mode tolerates no manual math at all when any simple calculator plan exists...
  value.candidates[1].scores.simplicity = 3;
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(value, written.id), { mode: "weaponized" }),
    /cannot beat a calculator method in weaponized mode/,
  );
  // ...while Fastest SAT Method never gates a written plan.
  assert.equal(selectStrategy(value, { mode: "fastest" }).strategySelection?.selectedCandidateId, written.id);
});

test("a reusable trick beats an answer-choice-only hack of equal simplicity and effort", () => {
  const hack = candidate("plug-the-choices", { simplicity: 5, student_effort: 1, manual_math_knowledge: 0, manual_algebra: 0, manual_calculation: 0 });
  hack.techniques = ["answer_choice_testing"];
  hack.reusable = true; // the model's claim is overridden: choice testing alone never generalizes
  const general = candidate("intersection", { simplicity: 5, student_effort: 1, manual_math_knowledge: 0, manual_algebra: 0, manual_calculation: 1 });
  general.techniques = ["intersections"];
  general.trick = "Intersection trick";
  const value = withThird(hack, general);
  assert.equal(selectedId(value), general.id, "desmos_first breaks the tie toward the reusable trick");
  assert.equal(selectStrategy(value, { mode: "weaponized" }).strategySelection?.selectedCandidateId, general.id);
  // Fastest mode ranks effort and rows first; here they tie, then reliability, then simplicity... the hack's lower manual math wins.
  assert.equal(selectStrategy(value, { mode: "fastest" }).strategySelection?.selectedCandidateId, hack.id);
  // In Weaponized mode a reusable trick wins even when the hack needs slightly less effort.
  hack.scores.student_effort = 0;
  assert.equal(selectStrategy(value, { mode: "weaponized" }).strategySelection?.selectedCandidateId, general.id);
  assert.equal(selectStrategy(value).strategySelection?.selectedCandidateId, hack.id, "desmos_first keeps effort ahead of reusability");
});

test("the winning candidate's trick and the recognized structure are surfaced on the solution", () => {
  const value = withThird(candidate("winner", { manual_math_knowledge: 0 }), candidate("other"));
  value.candidates[0].trick = "Shared-zero slider";
  const result = selectCompactStrategy(compactPortfolio(value, "winner"));
  assert.equal(result.solution.trick, "Shared-zero slider");
  assert.match(result.solution.structure ?? "", /^A line through two points/);
  assert.equal(result.strategySelection?.mode, "desmos_first");
});

test("a mode-specific ranking mismatch names the mode and the winner", () => {
  const value = withThird(candidate("worse", { student_effort: 3 }), candidate("better", { student_effort: 1 }));
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(value, "worse"), { mode: "fastest" }),
    /does not match the fastest ranking .*the winner is better/,
  );
});

test("a reverse-engineered plan is rejected with the derived constants named", () => {
  const plan = candidate("hidden-completing-the-square", { manual_math_knowledge: 0, simplicity: 5, student_effort: 0 });
  plan.solution.expressions = [{ latex: "52\\sim4\\left(41-14n\\right)", purpose: "Fit n from the radius relation." }];
  plan.solution.answer = "2";
  plan.solution.readAnswer = "Read n from the regression.";
  plan.solution.result = { row: 1, value: 2, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "n" };
  const slider = candidate("slider", { simplicity: 4, student_effort: 2 });
  slider.solution.expressions = [
    { latex: "n=1", purpose: "Slider for n.", slider: { min: -10, max: 10, step: 1 } },
    { latex: "x^2+y^2-10x-8y-14n=0", purpose: "Circle A as given." },
    { latex: "\\operatorname{midpoint}((5,4),(11,8))", purpose: "The point halfway to the center must lie on A." },
  ];
  slider.solution.result = { row: 1, value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "n where the circle passes through the midpoint" };
  slider.solution.answer = "-2";
  const value = withThird(plan, slider);
  value.question = "x^2 + y^2 - 10x - 8y - 14n = 0 represents circle A. (11, 8) lies on circle B with the same center and twice the diameter. What is n?";
  value.choices = null;
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(value, plan.id)),
    /Line 1 uses 41, 52: those numbers are not in the question, so the plan was derived by hand/,
  );
  assert.equal(selectedId(value), "slider");
});

test("a rearranged-slope formula after a regression is rejected as hidden derivation", () => {
  const plan = candidate("fit-then-solve", { simplicity: 5, student_effort: 1, manual_math_knowledge: 0 });
  plan.solution.expressions = [
    { latex: "x_{1}=[-4,2]", purpose: "x-coordinates." },
    { latex: "y_{1}=[2,11]", purpose: "y-coordinates." },
    { latex: "y_{1}\\sim m x_{1}+b", purpose: "Fit the line." },
    { latex: "a=6/m", purpose: "The slope of 6x-ay=15 is 6/a, so a=6/m." },
  ];
  plan.solution.answer = "B) 4";
  plan.solution.result = { row: 4, value: 4, listIndex: null, answerFrom: "value", choiceLabel: "B", detail: "a" };
  const value = withThird(plan, candidate("slider"));
  value.question = "Line ℓ passes through (−4, 2) and (2, 11). Line m is 6x − ay = 15. If the lines are parallel, what is a?";
  value.choices = [{ label: "A", text: "2" }, { label: "B", text: "4" }, { label: "C", text: "6" }, { label: "D", text: "9" }];
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(value, plan.id)),
    /Line 4 defines a value by a formula in the fitted parameter m: that formula was derived by hand/,
  );
});

test("coefficient-list bookkeeping for a small system is rejected in favor of bracket regression", () => {
  const lists = candidate("coefficient-lists", { simplicity: 5, student_effort: 1, manual_math_knowledge: 0 });
  lists.solution.expressions = [
    { latex: "a_{1}=[7,3]", purpose: "x-coefficients." },
    { latex: "b_{1}=[12,4]", purpose: "y-coefficients." },
    { latex: "c_{1}=[3,5]", purpose: "Constants." },
    { latex: "c_{1}\\sim 2a_{1}r+b_{1}p", purpose: "Fit r and the product sy." },
    { latex: "r", purpose: "Read r." },
  ];
  lists.solution.answer = "3";
  lists.solution.result = { row: 5, value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "r" };
  const bracket = candidate("bracket", { simplicity: 4, student_effort: 1, manual_math_knowledge: 0 });
  bracket.trick = "Bracket regression";
  bracket.solution.expressions = [
    { latex: "x_{1}=2", purpose: "The given x-coordinate." },
    { latex: "[7rx_{1}+12p,3rx_{1}+4p]\\sim[3,5]", purpose: "Both equations copied as printed; p stands for the product sy." },
  ];
  bracket.solution.answer = "3";
  bracket.solution.result = { row: 2, value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the fitted r" };
  const value = withThird(lists, bracket);
  value.question = "7rx + 12sy = 3 and 3rx + 4sy = 5. r and s are constants. The system has a solution of (2, y). What is the value of r?";
  value.choices = null;
  assert.throws(() => selectCompactStrategy(compactPortfolio(value, lists.id)), /Unnecessary coefficient lists for a small system.*bracket regression/);
  const result = selectStrategy(value);
  assert.equal(result.strategySelection?.selectedCandidateId, bracket.id);
  assert.equal(result.solution.trick, "Bracket regression");
});

test("an integer-constrained parameter restricted only by an inequality is rejected end to end", () => {
  const plan = candidate("inequality-only", { manual_math_knowledge: 0, simplicity: 5, student_effort: 0 });
  plan.solution.expressions = [
    { latex: "x_{1}=[1,2]", purpose: "Sample inputs." },
    { latex: "y_{1}=[3,6]", purpose: "Matching outputs." },
    { latex: "y_{1}\\sim k x_{1}+b\\left\\{k>1\\right\\}", purpose: "Fit the line, restricting k above 1." },
    { latex: "b", purpose: "Read the fitted intercept." },
  ];
  plan.solution.parameters = [{ name: "k", integer: true, min: 2, max: 10 }];
  plan.solution.answer = "5";
  plan.solution.readAnswer = "Line 4 shows b = 5.";
  plan.solution.result = { row: 4, value: 5, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "b" };
  const value = withThird(plan, candidate("other"));
  value.question = "k is an integer greater than 1. Given the points (1, 3) and (2, 6) on a line with slope k, what is b?";
  value.choices = null;
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(value, plan.id)),
    /constrains k with only an inequality.*integer/,
  );
});

test("a no-solution question answered by slope-matching alone is rejected until both lines are graphed", () => {
  const question = "6+7r=pw and 7r-5w=5w+11. p is a constant. If the system has no solution, what is the value of p?";

  const slopeOnly = candidate("slope-only", { manual_math_knowledge: 0, simplicity: 5, student_effort: 0 });
  slopeOnly.solution.expressions = [
    { latex: "f(x)=(6+7x)/10", purpose: "The first equation solved for w, as a function of r treated as x." },
    { latex: "p=1", purpose: "Slider for p.", slider: { min: 1, max: 20, step: 1 } },
    { latex: "g(x)=(7x-11)/(10-p)", purpose: "The second equation solved for w." },
    { latex: "g'(0)\\sim f'(0)", purpose: "Match the slopes to fit p." },
  ];
  slopeOnly.solution.conditionType = "no-solution";
  slopeOnly.solution.answerState = { param: "p", value: 10 };
  slopeOnly.solution.answer = "10";
  slopeOnly.solution.readAnswer = "Line 4 fits p = 10 so the slopes match.";
  slopeOnly.solution.result = { row: 4, value: 10, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "the fitted p" };
  const rejecting = withThird(slopeOnly, candidate("other-a"));
  rejecting.question = question;
  rejecting.choices = null;
  assert.throws(
    () => selectCompactStrategy(compactPortfolio(rejecting, slopeOnly.id)),
    /no solution.*coincident|opposite/i,
  );

  const graphed = candidate("graphed", { manual_math_knowledge: 0, simplicity: 5, student_effort: 0 });
  graphed.solution.expressions = [
    { latex: "p=1", purpose: "Slider for p.", slider: { min: 1, max: 20, step: 1 } },
    { latex: "y=(6+7x)/10", purpose: "The first equation, graphed as given." },
    { latex: "y=(7x-11)/(10-p)", purpose: "The second equation, graphed as given." },
  ];
  graphed.solution.conditionType = "no-solution";
  graphed.solution.answerState = { param: "p", value: 10 };
  graphed.solution.answer = "10";
  graphed.solution.readAnswer = "The two lines are parallel and distinct at p = 10.";
  graphed.solution.result = {
    type: "graph_overlap", row: 2, relatedRows: [3], value: null, listIndex: null,
    answerFrom: "reasoning", choiceLabel: null, detail: "the two lines",
  };
  const accepting = withThird(graphed, candidate("other-b"));
  accepting.question = question;
  accepting.choices = null;
  const result = selectCompactStrategy(compactPortfolio(accepting, graphed.id));
  assert.equal(result.solution.distinguishes, "visual-parallel-vs-overlap");
  const resultType = result.solution.result && "type" in result.solution.result ? result.solution.result.type : null;
  assert.equal(resultType, "graph_overlap");
});
