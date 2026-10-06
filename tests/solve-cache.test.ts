import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cacheEntrySchema,
  preflightRecordSchema,
  cacheKeyFor,
  CACHE_ENTRY_VERSION,
  createMemorySolveCache,
  inputHash,
  normalizeProblemText,
  problemKey,
  promptConfigVersion,
  withCacheFallback,
  type CacheEntry,
} from "../src/lib/solve-cache";
import { candidatesResponseSchema, selectMethods } from "../src/lib/strategy-selection";
import { candidatesResponse, explanation } from "./method-fixtures";

test("transcription noise normalizes away; content does not", () => {
  const variants = [
    "What is the positive solution to x² = 9?",
    "What is the positive solution to x^2 = 9?",
    "What is the positive solution to x^{2}=9?",
    "  what is the POSITIVE solution to  x^2=9? ",
  ];
  const normalized = new Set(variants.map(normalizeProblemText));
  assert.equal(normalized.size, 1);
  assert.equal(normalizeProblemText("7r − 5w = 11"), normalizeProblemText("7r - 5w = 11"));
  assert.equal(normalizeProblemText("2 ≤ x ≤ 8"), normalizeProblemText("2 <= x <= 8"));
  assert.notEqual(normalizeProblemText("x^2 = 9"), normalizeProblemText("x^2 = 16"));
  assert.notEqual(normalizeProblemText("2.5"), normalizeProblemText("25"));
});

test("the problem key comes from extracted text and choices, never image bytes", () => {
  const choices = [{ label: "A", text: "−432" }, { label: "B", text: "−9" }];
  const same = problemKey("Line k is sx + 48y = t. Which t is NOT possible?", choices);
  assert.equal(problemKey("Line k is sx+48y=t. Which t is NOT possible?", [{ label: "a", text: "-432" }, { label: "B", text: "-9" }]), same);
  assert.notEqual(problemKey("Line k is sx+48y=t. Which t is NOT possible?", [{ label: "A", text: "-432" }, { label: "B", text: "-8" }]), same);
  assert.notEqual(problemKey("Line k is sx+48y=t. Which t is NOT possible?", null), same);
  assert.equal(cacheKeyFor(same, "v1"), `${same}.v1`);
  // Two different screenshots are two different inputs but one problem.
  assert.notEqual(inputHash(new Uint8Array([1, 2, 3])), inputHash(new Uint8Array([1, 2, 4])));
  assert.notEqual(inputHash(new Uint8Array([1])), inputHash({ problem: "\u0001", choices: null }));
});

const configuration = {
  candidateInstructions: "candidates",
  explanationInstructions: "explanation",
  strategyLibrary: "library",
  goldSolutions: "examples",
  candidatePrompt: "prompt",
  costWeights: { rows: 1, derivationSteps: 3 },
  vocabulary: [{ id: "graph-both-sides" }],
  schemas: ["schema"],
  model: "gpt-5-mini",
};

test("regression test 3 (unit): every part of the prompt configuration changes promptConfigVersion", () => {
  const base = promptConfigVersion(configuration);
  assert.equal(promptConfigVersion({ ...configuration }), base, "stable for identical configuration");
  for (const [key, changed] of Object.entries({
    candidateInstructions: "candidates v2",
    explanationInstructions: "explanation v2",
    strategyLibrary: "library v2",
    goldSolutions: "examples v2",
    candidatePrompt: "prompt v2",
    costWeights: { rows: 1, derivationSteps: 4 },
    vocabulary: [{ id: "graph-both-sides" }, { id: "slider-parallel" }],
    schemas: ["schema v2"],
    model: "gpt-5",
  })) {
    assert.notEqual(promptConfigVersion({ ...configuration, [key]: changed }), base, `${key} is part of the version`);
  }
});

function entry(cacheKey: string): CacheEntry {
  const selection = selectMethods(candidatesResponseSchema.parse(candidatesResponse()));
  return {
    version: CACHE_ENTRY_VERSION,
    cacheKey,
    promptConfigVersion: "v1",
    question: selection.question,
    choices: selection.choices,
    structure: selection.structure,
    methods: selection.methods,
    winnerId: selection.winnerId,
    modelPreference: selection.modelPreference,
    retryOf: null,
    createdAt: "2026-09-27T00:00:00.000Z",
  };
}

test("a selected method set is a valid cache entry, rejections included", () => {
  const value = entry("key.v1");
  assert.equal(cacheEntrySchema.safeParse(value).success, true);
  assert.equal(cacheEntrySchema.safeParse({ ...value, version: 2 }).success, false, "an old entry shape is a miss, not a crash");
});

test("the memory cache is first-writer-wins for entries, explanations, and input mappings", async () => {
  const cache = createMemorySolveCache();
  const first = entry("key.v1");
  const second = { ...entry("key.v1"), winnerId: "factoring" };
  assert.deepEqual(await cache.putEntry(first), first);
  assert.equal((await cache.putEntry(second)).winnerId, first.winnerId, "a concurrent writer gets the stored entry back");
  assert.deepEqual(await cache.getEntry("key.v1"), first);
  assert.equal(await cache.getEntry("missing"), null);

  const one = explanation(1);
  const two = explanation(1, { why: "A different explanation." });
  assert.deepEqual(await cache.putExplanation("key.v1", "intercept-read", one), one);
  assert.deepEqual(await cache.putExplanation("key.v1", "intercept-read", two), one);
  assert.equal(await cache.getExplanation("key.v1", "factoring"), null);

  await cache.rememberInput("hash", "v1", "key.v1");
  await cache.rememberInput("hash", "v1", "other.v1");
  assert.equal(await cache.lookupInput("hash", "v1"), "key.v1");
  assert.equal(await cache.lookupInput("hash", "v2"), null, "a new configuration version never reuses an old mapping");

  const stored = await cache.getEntry("key.v1");
  stored!.methods[0].rows[0].latex = "mutated";
  assert.notEqual((await cache.getEntry("key.v1"))!.methods[0].rows[0].latex, "mutated", "callers cannot mutate the cache");

  // Pre-flight verdicts: first writer wins per method, like explanations.
  const error = { status: "error" as const, errors: [{ row: 1, message: "Cannot store a list of numbers in a list." }] };
  assert.deepEqual(await cache.putPreflight("key.v1", "intercept-read", error), error);
  assert.deepEqual(await cache.putPreflight("key.v1", "intercept-read", { status: "clean" }), error, "a later report never overwrites a stored verdict");
  assert.deepEqual(await cache.getPreflight("key.v1"), { "intercept-read": error });
  assert.deepEqual(await cache.getPreflight("other.v1"), {});
});

test("a pre-flight verdict must be a clean result or name the erroring rows", () => {
  assert.equal(preflightRecordSchema.safeParse({ status: "clean" }).success, true);
  assert.equal(preflightRecordSchema.safeParse({ status: "error", errors: [] }).success, false, "an error names at least one row");
  assert.equal(preflightRecordSchema.safeParse({ status: "error", errors: [{ row: 0, message: "x" }] }).success, false);
  assert.equal(preflightRecordSchema.safeParse({ status: "timeout" }).success, false, "a timeout is not evidence and is never stored");
});

test("a cache outage degrades to an uncached solve instead of failing it", async () => {
  const failures: string[] = [];
  const broken = withCacheFallback(
    {
      lookupInput: async () => { throw new Error("relation does not exist"); },
      rememberInput: async () => { throw new Error("down"); },
      getEntry: async () => { throw new Error("down"); },
      putEntry: async () => { throw new Error("down"); },
      getExplanation: async () => { throw new Error("down"); },
      putExplanation: async () => { throw new Error("down"); },
      getPreflight: async () => { throw new Error("relation does not exist"); },
      putPreflight: async () => { throw new Error("down"); },
    },
    (operation) => failures.push(operation),
  );
  const value = entry("key.v1");
  assert.equal(await broken.lookupInput("hash", "v1"), null);
  assert.equal(await broken.getEntry("key.v1"), null);
  assert.deepEqual(await broken.putEntry(value), value, "a write returns what it was given");
  assert.deepEqual(await broken.putExplanation("key.v1", "intercept-read", explanation()), explanation());
  await broken.rememberInput("hash", "v1", "key.v1");
  // Without the pre-flight table, verdicts are just not cached: every browser checks for itself.
  assert.deepEqual(await broken.getPreflight("key.v1"), {});
  assert.deepEqual(await broken.putPreflight("key.v1", "intercept-read", { status: "clean" }), { status: "clean" });
  assert.deepEqual(failures, ["lookupInput", "getEntry", "putEntry", "putExplanation", "rememberInput", "getPreflight", "putPreflight"]);
});
