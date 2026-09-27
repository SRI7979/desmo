import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  loadTrainingExamples,
  TrainingBatchError,
  type TrainingExample,
} from "../src/lib/training-examples";
import { findUndefinedVariables, normalizeDesmosExpressions } from "../src/lib/desmos-latex";
import batch from "../src/content/training-batches/desmo_training_batch_001.json" with { type: "json" };

const example: TrainingExample = {
  id: "test-001",
  question: "If x is 3, what is x + 2?",
  answer_choices: { A: "4", B: "5" },
  correct_answer: "B",
  strategy_name: "Direct evaluation",
  trick: "Evaluate the expression",
  trigger_pattern: "A value is supplied and an expression must be evaluated.",
  desmos_steps: ["x_1=[3]", "x_1+2", "Read 5"],
  why_preferred: "Desmos evaluates the original expression directly.",
  needs_review: false,
};

test("loads batch 001 as reviewed method-selection examples", async () => {
  const loaded = await loadTrainingExamples();

  assert.equal(loaded.exampleCount, 14);
  assert.equal(loaded.skippedReviewCount, 0);
  assert.deepEqual(loaded.files, ["desmo_training_batch_001.json"]);
  assert.match(loaded.prompt, /Parameter regression using multiple x-values/);
  assert.match(loaded.prompt, /Derivative regression to force equal slopes/);
  assert.match(
    loaded.prompt,
    /Direct conceptual translation - stop at the requested model/,
  );
  assert.match(loaded.prompt, /provides no useful Desmos outsourcing/);
  assert.match(loaded.prompt, /x_\{1\}=\[1\.\.\.5\]/);
  assert.match(loaded.prompt, /Direct bracket regression for a small system/);
  assert.match(loaded.prompt, /\[-q-19w,2q-19w\] ~ \[-337,47\]/);
  assert.match(loaded.prompt, /\[7rx_(?:\{1\}|1)\+12sy_(?:\{1\}|1),3rx_(?:\{1\}|1)\+4sy_(?:\{1\}|1)\] ~ \[3,5\]/);
  assert.doesNotMatch(loaded.prompt, /a_\{1\}=\[7,3\]/, "coefficient-list bookkeeping is no longer taught");
  assert.doesNotMatch(loaded.prompt, /a_\{1\}=\[7,3\]/);
  assert.doesNotMatch(loaded.prompt, /\bx_1\b/);
});

test("sorts batches and excludes examples waiting for review", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "desmo-training-"));
  try {
    await Promise.all([
      writeFile(
        path.join(directory, "batch-b.json"),
        JSON.stringify([{ ...example, id: "b", needs_review: true }]),
      ),
      writeFile(
        path.join(directory, "batch-a.json"),
        JSON.stringify([{ ...example, id: "a" }]),
      ),
    ]);

    const loaded = await loadTrainingExamples(directory);
    assert.deepEqual(loaded.files, ["batch-a.json", "batch-b.json"]);
    assert.equal(loaded.exampleCount, 2);
    assert.equal(loaded.skippedReviewCount, 1);
    assert.match(loaded.prompt, /"id": "a"/);
    assert.doesNotMatch(loaded.prompt, /"id": "b"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects duplicate IDs across training batches", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "desmo-training-"));
  try {
    await Promise.all([
      writeFile(path.join(directory, "one.json"), JSON.stringify([example])),
      writeFile(path.join(directory, "two.json"), JSON.stringify([example])),
    ]);

    await assert.rejects(
      loadTrainingExamples(directory),
      (error: unknown) =>
        error instanceof TrainingBatchError &&
        /appears in both one\.json and two\.json/.test(error.message),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("calculator rows in the reviewed training batch are executable under the syntax-safety scan", () => {
  // Prose steps ("Read r=3 ...") are instructions, not rows; only expression-like steps are checked.
  const looksLikeRow = (step: string) =>
    /[=~]/.test(step) && !/:/.test(step) && !/\s(?:is|are|so|the|and|then)\s/i.test(step) && !/^[A-Z][a-z]+ /.test(step);
  for (const example of batch as TrainingExample[]) {
    const rows = example.desmos_steps
      .filter(looksLikeRow)
      .map((latex) => ({ latex: latex.replace(/\b([A-Za-z])_(\d+)\b/g, "$1_{$2}"), purpose: "" }));
    if (!rows.length) continue;
    assert.deepEqual(
      findUndefinedVariables(normalizeDesmosExpressions(rows)),
      [],
      `${example.id}: ${rows.map((row) => row.latex).join(" | ")}`,
    );
  }
});
