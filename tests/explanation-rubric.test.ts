import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreExplanation, unexplainedJargon } from "../src/lib/explanation-rubric";
import type { Solution } from "../src/lib/solver-schema";

const question = "The system 3x + ky = 12 and 6x + 10y = 24 has infinitely many solutions. What is the value of k?";

function solution(overrides: Partial<Solution>): Solution {
  return {
    status: "solved",
    question,
    choices: null,
    structure: null,
    trick: "Slider until it fits",
    answer: "5",
    method: "desmos",
    why: "",
    steps: [],
    readAnswer: null,
    expressions: [],
    result: null,
    answerState: null,
    parameters: [],
    conditionType: null,
    distinguishes: null,
    graphBounds: null,
    clarification: null,
    ...overrides,
  };
}

const rows = [
  { latex: "k=1", purpose: "", slider: { min: 0, max: 10, step: 1 } },
  { latex: "3x+ky=12", purpose: "" },
  { latex: "6x+10y=24", purpose: "" },
];

test("a compressed, jargon-heavy explanation scores low and names what is missing", () => {
  const terse = scoreExplanation(
    solution({
      why: "The coefficients are proportional.",
      expressions: rows.map((row) => ({ ...row, purpose: "Graph the equation." })),
      readAnswer: "Read k.",
    }),
  );
  assert.ok(terse.score < 0.5, `score ${terse.score}`);
  assert.deepEqual(terse.unexplainedJargon, ["proportional", "coefficients"]);
  assert.deepEqual(terse.checks.filter((check) => !check.passed).map((check) => check.id), ["idea", "row-depth", "read-result", "jargon"]);
});

test("the explanation structure the product asks for scores full marks", () => {
  const full = scoreExplanation(
    solution({
      why:
        "Infinitely many solutions means both equations describe the exact same line. So every part of the second equation must be the first one multiplied by the same number. Desmos lets you see that directly: when the two lines lie on top of each other, you have the right k.",
      expressions: [
        { ...rows[0], purpose: "This makes a slider for k, the unknown from the question, so you can try values and watch the first line move." },
        { ...rows[1], purpose: "This graphs the first equation exactly as the question gives it, with k waiting to be set by the slider." },
        { ...rows[2], purpose: "This graphs the second equation from the question, which has no unknowns, so it stays fixed while you drag." },
      ],
      readAnswer: "Drag the slider on line 1 until the line from line 2 sits exactly on top of line 3; that happens at k = 5.",
    }),
  );
  assert.equal(full.score, 1, JSON.stringify(full.checks.filter((check) => !check.passed)));
});

test("jargon counts as explained once a sentence glosses it, and later uses are fine", () => {
  assert.deepEqual(unexplainedJargon(["A regression means Desmos adjusts the unknowns until both sides agree.", "The regression row shows a."]), []);
  assert.deepEqual(unexplainedJargon(["The discriminant is zero."]), ["discriminant"]);
});

test("a slider explanation may not claim Desmos found the slider's value", () => {
  const dishonest = scoreExplanation(
    solution({
      why: "Desmos found the parameter value that makes the lines overlap, because both equations are the same line when k is right.",
      expressions: rows.map((row) => ({ ...row, purpose: "This row puts one piece of the question into Desmos so the lines can be compared on the graph." })),
      readAnswer: "Read the slider on line 1: the lines overlap at k = 5.",
    }),
  );
  assert.equal(dishonest.checks.find((check) => check.id === "honest-slider")?.passed, false);
});
