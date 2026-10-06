import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { goldCase, loadGoldCases } from "../evals/benchmark/load-cases";
import gold from "../src/content/gold-solutions/desmo_gold_solutions.json" with { type: "json" };
import { findUndefinedVariables, normalizeDesmosExpressions } from "../src/lib/desmos-latex";
import { GoldSolutionError, loadGoldSolutions, type GoldSolution } from "../src/lib/gold-solutions";

const solution: GoldSolution = {
  id: "test-001",
  question: "If x is 3, what is x + 2?",
  answer_choices: { A: "4", B: "5" },
  correct_answer: "B",
  strategy_name: "Direct evaluation",
  techniqueId: "function-evaluation",
  trigger_pattern: "A value is supplied and an expression must be evaluated.",
  desmos_steps: ["x_1=[3]", "x_1+2", "Read 5"],
  why_preferred: "Desmos evaluates the original expression directly.",
  needs_review: false,
};

test("the gold solutions load from their own folder: the original 14 plus the quadratic root", async () => {
  const loaded = await loadGoldSolutions();
  assert.deepEqual(loaded.files, ["desmo_gold_solutions.json"]);
  assert.equal(loaded.solutionCount, 15);
  assert.equal(loaded.skippedReviewCount, 0);
  assert.equal(loaded.solutions.length, 15);
  assert.match(loaded.prompt, /Parameter regression using multiple x-values/);
  assert.match(loaded.prompt, /Direct bracket regression for a small system/);
  assert.match(loaded.prompt, /\[-q-19w,2q-19w\] ~ \[-337,47\]/);
  assert.match(loaded.prompt, /x_\{1\}=\[1\.\.\.5\]/);
  assert.doesNotMatch(loaded.prompt, /\bx_1\b/);
  assert.match(loaded.prompt, /"techniqueId": "bracket-regression"/);
  assert.doesNotMatch(loaded.prompt, /provenance|silver/, "everything here is gold; there is no second tier");
});

test("a gold solution with a free-form technique name fails the schema", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "desmo-gold-"));
  try {
    await writeFile(path.join(directory, "gold.json"), JSON.stringify([{ ...solution, techniqueId: "My clever trick" }]));
    await assert.rejects(loadGoldSolutions(directory), GoldSolutionError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("files are read in order; a draft marked needs_review stays out of the prompt and the benchmark", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "desmo-gold-"));
  try {
    await Promise.all([
      writeFile(path.join(directory, "b.json"), JSON.stringify([{ ...solution, id: "draft", needs_review: true }])),
      writeFile(path.join(directory, "a.json"), JSON.stringify([{ ...solution, id: "ready" }])),
      writeFile(path.join(directory, "README.md"), "# not a solution file"),
    ]);
    const loaded = await loadGoldSolutions(directory);
    assert.deepEqual(loaded.files, ["a.json", "b.json"]);
    assert.equal(loaded.solutionCount, 2);
    assert.equal(loaded.skippedReviewCount, 1);
    assert.deepEqual(loaded.solutions.map((item) => item.id), ["ready"]);
    assert.doesNotMatch(loaded.prompt, /"id": "draft"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects duplicate ids across gold files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "desmo-gold-"));
  try {
    await Promise.all([
      writeFile(path.join(directory, "one.json"), JSON.stringify([solution])),
      writeFile(path.join(directory, "two.json"), JSON.stringify([solution])),
    ]);
    await assert.rejects(
      loadGoldSolutions(directory),
      (error: unknown) => error instanceof GoldSolutionError && /appears in both one\.json and two\.json/.test(error.message),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("every gold solution's calculator rows are executable under the syntax-safety scan", () => {
  // Instructions ("Click both x-intercepts: ...") start with a capital letter; rows do not.
  const looksLikeRow = (step: string) =>
    /[=~]/.test(step) && !/:/.test(step) && !/\s(?:is|are|so|the|and|then)\s/i.test(step) && !/^[A-Z][a-z]+ /.test(step);
  for (const example of gold as GoldSolution[]) {
    const rows = example.desmos_steps
      .filter(looksLikeRow)
      .map((latex) => ({ latex: latex.replace(/\b([A-Za-z])_(\d+)\b/g, "$1_{$2}"), purpose: "" }));
    if (!rows.length) continue;
    assert.deepEqual(findUndefinedVariables(normalizeDesmosExpressions(rows)), [], `${example.id}: ${rows.map((row) => row.latex).join(" | ")}`);
  }
});

test("the quadratic-root gold solution is the clicked root, a slider for a, and a regression for b", () => {
  const quadratic = (gold as GoldSolution[]).find((item) => item.id === "015")!;
  assert.match(quadratic.question, /where a and b are integers/, "the real wording, which the integer rule must allow");
  assert.equal(quadratic.answer_choices[quadratic.correct_answer], "248");
  assert.equal(quadratic.techniqueId, "parameter-regression");
  assert.deepEqual(quadratic.desmos_steps.filter((step) => !/^[A-Z]/.test(step)), ["3x^2-16x+2", "(a+\\sqrt{b})/6~5.20526", "a=16", "a+b"]);
  assert.doesNotMatch(quadratic.desmos_steps.join(" "), /4\(3\)\(2\)|b\^2-4ac|quadratic formula/i, "no formula in the Desmos way");
  // The rows reproduce the answer: the clicked root is the larger one, and the fitted b rounds to 232.
  assert.equal(((16 + Math.sqrt(232)) / 6).toFixed(5), "5.20526");
  assert.equal(Math.round(16 + (6 * 5.20526 - 16) ** 2), 248);
});

test("gold solutions become their own benchmark group, scored on the choice text, and only on request", async () => {
  const cases = await loadGoldCases();
  assert.equal(cases.length, 15);
  assert.ok(cases.every((item) => item.group === "gold" && item.labelProvenance === "human_verified_gold" && item.id.startsWith("gold/")));
  const quadratic = goldCase((gold as GoldSolution[]).find((item) => item.id === "015")!);
  assert.equal(quadratic.correctAnswer, "248", "a lettered answer is scored as the choice's text");
  assert.deepEqual(quadratic.choices, ["66", "132", "248", "296"]);
  assert.deepEqual(quadratic.gold, ["parameter-regression"]);
  assert.deepEqual((await loadGoldCases(["015"])).map((item) => item.id), ["gold/015"]);
});
