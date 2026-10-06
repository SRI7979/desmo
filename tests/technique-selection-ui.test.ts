import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { MethodSummary } from "../src/lib/method-summary";
import type { Solution } from "../src/lib/solver-schema";
import {
  explanationFromEvents,
  navigate,
  parseNdjsonLines,
  provisionalSolution,
  readNdjsonEvents,
  selectorMode,
  type NavState,
} from "../src/lib/technique-selection-ui";

function method(overrides: Partial<MethodSummary> = {}): MethodSummary {
  return {
    id: "intercept-read",
    techniqueId: "intercept-read",
    name: "Read the intercepts",
    rung: 1,
    rows: [{ latex: "y=x^2-9", slider: null }],
    answer: "3",
    result: {
      type: "x_intercept",
      row: 1,
      relatedRows: [],
      value: 3,
      listIndex: null,
      answerFrom: "value",
      choiceLabel: null,
      detail: "the positive x-intercept",
    },
    answerState: null,
    parameters: [],
    conditionType: null,
    distinguishes: null,
    graphBounds: { left: -5, right: 5, bottom: -12, top: 12 },
    cost: { rows: 1, derivationSteps: 0, newPrimitives: 0, oneOffFacts: 0, setupConstructions: 0, manualIterations: 0 },
    total: 1,
    mathScore: 0,
    mathLevel: "low",
    shape: "1 row · graph · no algebra",
    badges: ["Recommended"],
    verified: false,
    ...overrides,
  };
}

const baseSolution: Solution = {
  status: "solved",
  question: "What is the positive solution to x² = 9?",
  choices: null,
  structure: "One equation, asked for its positive solution.",
  trick: "Read the intercepts",
  answer: "3",
  method: "desmos",
  why: "Graphing the equation shows its solutions as x-intercepts.",
  handMath: null,
  steps: [],
  readAnswer: "Click the positive x-intercept of line 1 and read x = 3.",
  expressions: [{ latex: "y=x^2-9", purpose: "Graphs the equation so its solutions are x-intercepts." }],
  result: method().result,
  answerState: null,
  parameters: [],
  conditionType: null,
  distinguishes: null,
  graphBounds: { left: -5, right: 5, bottom: -12, top: 12 },
  clarification: null,
};

// ---- regression test 3: single-candidate problem renders sensibly ----

test("selectorMode: a lone technique is 'single', two or more is 'multi'", () => {
  assert.equal(selectorMode([]), "single");
  assert.equal(selectorMode([method()]), "single");
  assert.equal(selectorMode([method(), method({ id: "factoring" })]), "multi");
});

// ---- regression test 4/5: selecting swaps rows instantly; explanation is blank until it streams in ----

test("provisionalSolution: rows, readout, and answer come from the method; prose is blank until the explanation resolves", () => {
  const slider = method({
    id: "shared-zero",
    techniqueId: "shared-zero",
    name: "Shared zero",
    rung: 3,
    rows: [
      { latex: "b=1", slider: { min: 1, max: 10, step: 1 } },
      { latex: "y=x+2b", slider: null },
      { latex: "y=3x^2+25x+14b", slider: null },
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
      detail: "b where the graphs share an x-intercept",
    },
    answerState: { param: "b", value: 3 },
    parameters: [{ name: "b", integer: true, min: -1000, max: 1000 }],
    graphBounds: { left: -10, right: 10, bottom: -10, top: 10 },
    badges: [],
  });
  const next = provisionalSolution(baseSolution, slider);

  // Carried over unchanged: shared across every technique for this problem.
  assert.equal(next.question, baseSolution.question);
  assert.equal(next.choices, baseSolution.choices);
  assert.equal(next.structure, baseSolution.structure);
  assert.equal(next.status, "solved");

  // Swapped from the method: instant, no network round trip needed.
  assert.equal(next.trick, "Shared zero");
  assert.equal(next.answer, "3");
  assert.deepEqual(next.answerState, { param: "b", value: 3 });
  assert.deepEqual(next.graphBounds, { left: -10, right: 10, bottom: -10, top: 10 });
  assert.deepEqual(next.parameters, [{ name: "b", integer: true, min: -1000, max: 1000 }]);
  assert.deepEqual(next.expressions, [
    { latex: "b=1", purpose: "", slider: { min: 1, max: 10, step: 1 } },
    { latex: "y=x+2b", purpose: "" },
    { latex: "y=3x^2+25x+14b", purpose: "" },
  ]);
  assert.equal(next.result?.detail, "b where the graphs share an x-intercept");

  // Blank until the explanation call resolves.
  assert.equal(next.why, "");
  assert.deepEqual(next.steps, []);
  assert.equal(next.readAnswer, null);
});

test("provisionalSolution: a paper technique (no rows) is method 'algebra' with no slider key on any row", () => {
  const paper = method({ id: "factoring", techniqueId: "factoring", name: "Factoring", rung: 2, rows: [] });
  const next = provisionalSolution(baseSolution, paper);
  assert.equal(next.method, "algebra");
  assert.deepEqual(next.expressions, []);
});

// ---- keyboard state machine (no jsdom/RTL in this project; tested at this level) ----

test("navigate: closed → ArrowDown/ArrowUp/Enter/Space open at the selected index; other keys are ignored", () => {
  const closed: NavState = { open: false, activeIndex: 0 };
  for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
    assert.deepEqual(navigate(closed, key, 4, 2), { open: true, activeIndex: 2 });
  }
  assert.equal(navigate(closed, "a", 4, 2), closed, "an unhandled key returns the same reference");
});

test("navigate: open — arrows move and clamp, Home/End jump, Enter selects, Escape closes", () => {
  const open = (activeIndex: number): NavState => ({ open: true, activeIndex });
  assert.deepEqual(navigate(open(1), "ArrowDown", 4, 0), { open: true, activeIndex: 2 });
  assert.deepEqual(navigate(open(3), "ArrowDown", 4, 0), { open: true, activeIndex: 3 }, "clamped at the last index");
  assert.deepEqual(navigate(open(1), "ArrowUp", 4, 0), { open: true, activeIndex: 0 });
  assert.deepEqual(navigate(open(0), "ArrowUp", 4, 0), { open: true, activeIndex: 0 }, "clamped at the first index");
  assert.deepEqual(navigate(open(1), "Home", 4, 0), { open: true, activeIndex: 0 });
  assert.deepEqual(navigate(open(1), "End", 4, 0), { open: true, activeIndex: 3 });
  assert.deepEqual(navigate(open(2), "Enter", 4, 0), { open: false, activeIndex: 2, action: "select" });
  assert.deepEqual(navigate(open(2), " ", 4, 0), { open: false, activeIndex: 2, action: "select" });
  assert.deepEqual(navigate(open(2), "Escape", 4, 0), { open: false, activeIndex: 2, action: "close" });
  const state = open(2);
  assert.equal(navigate(state, "a", 4, 0), state, "an unhandled key while open returns the same reference");
});

test("navigate: zero techniques never opens (defensive; the component renders 'single' before this is called)", () => {
  const closed: NavState = { open: false, activeIndex: 0 };
  assert.equal(navigate(closed, "ArrowDown", 0, 0), closed);
});

// ---- NDJSON stream parsing ----

test("parseNdjsonLines: splits complete lines from an incomplete trailing remainder", () => {
  assert.deepEqual(parseNdjsonLines('{"a":1}\n{"b":2}\n{"c"'), { events: [{ a: 1 }, { b: 2 }], rest: '{"c"' });
  assert.deepEqual(parseNdjsonLines("no newline yet"), { events: [], rest: "no newline yet" });
  assert.deepEqual(parseNdjsonLines('{"a":1}\n\n{"b":2}\n'), { events: [{ a: 1 }, { b: 2 }], rest: "" }, "blank lines are skipped");
});

async function* chunks(...values: string[]): AsyncGenerator<string> {
  for (const value of values) yield value;
}

test("readNdjsonEvents: reassembles events split across arbitrary chunk boundaries", async () => {
  const events = [];
  for await (const event of readNdjsonEvents(chunks('{"type":"meth', 'ods","id":1}\n{"type"', ':"solution"}'))) {
    events.push(event);
  }
  assert.deepEqual(events, [{ type: "methods", id: 1 }, { type: "solution" }], "a final line with no trailing newline is still yielded");
});

test("readNdjsonEvents: an empty stream yields nothing", async () => {
  const events = [];
  for await (const event of readNdjsonEvents(chunks())) events.push(event);
  assert.deepEqual(events, []);
});

// ---- lazy explanations -----------------------------------------------------

test("explanationFromEvents: a real explanation is accepted; an error, a missing solution, or the fallback summary is a failure", () => {
  const events = [{ type: "methods" }, { type: "solution", explanation: "model", solution: baseSolution }];
  assert.equal(explanationFromEvents(events)?.why, baseSolution.why);
  assert.equal(explanationFromEvents(events)?.readAnswer, baseSolution.readAnswer);
  assert.equal(explanationFromEvents([{ type: "solution", explanation: "cache", solution: baseSolution }])?.why, baseSolution.why);
  assert.equal(explanationFromEvents([{ type: "methods" }]), null, "the stream ended before the explanation");
  assert.equal(explanationFromEvents([{ type: "methods" }, { type: "error", error: "x" }]), null);
  assert.equal(explanationFromEvents([{ type: "solution", explanation: "fallback", solution: baseSolution }]), null, "a one-line fallback is not an explanation");
  assert.equal(explanationFromEvents([{ type: "solution", solution: { status: "solved" } }]), null, "a malformed solution");
  assert.equal(explanationFromEvents([]), null);
});

test("selecting a technique with no rows clears the calculator and never shows another technique's idea", () => {
  const paper = method({ id: "discriminant", techniqueId: "discriminant", name: "Discriminant", rows: [], answer: "25/12" });
  const next = provisionalSolution(baseSolution, paper);
  assert.deepEqual(next.expressions, [], "no rows: the calculator is cleared, not left on the previous rows");
  assert.equal(next.why, "", "no idea until this technique's own explanation arrives");
  assert.deepEqual(next.steps, []);
  assert.equal(next.answer, "25/12", "the answer is on screen at once");

  const explanationSource = readFileSync("src/components/solution-explanation.tsx", "utf8");
  assert.doesNotMatch(explanationSource, /why \|\| solution\.structure/, "the problem-level structure line is never shown as The idea");
  assert.match(explanationSource, /data-testid="explanation-skeleton"/);
  assert.match(explanationSource, /data-testid="explanation-retry"/);

  // The calculator resets before deciding whether there is anything to insert.
  const calculator = readFileSync("src/components/desmos-calculator.tsx", "utf8");
  const reset = calculator.indexOf("calculator.setBlank();");
  const empty = calculator.indexOf("if (!insertable || payload.items.length === 0) return;");
  assert.ok(reset > 0 && empty > reset);
});
