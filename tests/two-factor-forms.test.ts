import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { twoFactorFormsPlan, repairTwoFactorForms } from "../src/lib/two-factor-forms";
import { candidatesResponseSchema, selectMethods } from "../src/lib/strategy-selection";
import { createMemorySolveCache, type CacheEntry } from "../src/lib/solve-cache";
import { createPreflightHandler } from "../src/lib/solve-handler";
import { createMemoryUsageStore } from "../src/lib/spend";
import { resolveEntry, explainMethod, type PipelineDeps } from "../src/lib/solve-pipeline";
import { validateExplanationQuality } from "../src/lib/method-presentation";
import { candidatesResponse, graphCandidate, paperCandidate } from "./method-fixtures";

const question = "The polynomial 10x^4+23x^2+12 can be written both as (5x^2+j)(2x^2+k), where j and k are positive integers, or as (5x^2+l)(2x^2+m), where l and m are positive numbers that are not integers. What is the value of k+l?";

function response() {
  return candidatesResponseSchema.parse(candidatesResponse([
    graphCandidate({ techniqueId: "identity-regression", rows: [
      { latex: "x_{1}=[1...5]", slider: null, copiesRow: null },
      { latex: "10x_{1}^2+23x_{1}+12~(5x_{1}+j)(2x_{1}+k)", slider: null, copiesRow: null },
      { latex: "10x_{1}^2+23x_{1}+12~(5x_{1}+l)(2x_{1}+m)", slider: null, copiesRow: null },
      { latex: "k+l", slider: null, copiesRow: null },
    ], answer: "9.1", result: { type: "numeric", row: 4, relatedRows: [], value: 9.1, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "one arbitrary pair of fits" } }),
    paperCandidate({ answer: "21/2", result: { type: "written", row: null, relatedRows: [], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "the sum after comparing both factorizations" } }),
  ], { question, preferredTechniqueId: "identity-regression" }));
}

test("both factor pairs replace independent fits, with the correct coordinate sum and a paper alternative", () => {
  const selected = selectMethods(repairTwoFactorForms(response()));
  const winner = selected.methods.find(method => method.id === selected.winnerId)!;
  assert.equal(winner.techniqueId, "graph-both-sides");
  assert.equal(winner.answer, "10.5");
  assert.deepEqual(winner.rows.map(row => row.latex), ["xy=12", "(5+x)(2+y)=10+23+12"]);
  assert.deepEqual(winner.result.relatedRows, [2]);
  assert.equal(winner.result.answerFrom, "reasoning");
  assert.equal(selected.methods.some(method => method.techniqueId === "factoring" && !method.rejected), true);
  const explanation = twoFactorFormsPlan(question)!.explanation;
  assert.doesNotThrow(() => validateExplanationQuality(winner, explanation));
  assert.match(explanation.readAnswer!, /\(4, 3\)/);
  assert.match(explanation.readAnswer!, /\(7\.5, 1\.6\)/);
  assert.match(explanation.handMath!, /k=3.*l=7\.5/);
});

test("recognition follows coefficients and exponents rather than a memorized answer", () => {
  const variant = question.replace("10x^4", "6x^4").replace("+12", "+20").replaceAll("5x^2", "3x^2");
  assert.equal(twoFactorFormsPlan(variant)?.candidate.answer, "12.5");
  assert.equal(twoFactorFormsPlan(question.replaceAll("^4", "^{4}").replaceAll("^2", "^{2}"))?.candidate.answer, "10.5");
  assert.equal(twoFactorFormsPlan(question.replaceAll("^4", "⁴").replaceAll("^2", "²"))?.candidate.answer, "10.5");
  assert.equal(twoFactorFormsPlan(question.replace("j and k are positive integers", "j and k are positive real numbers")), null);
  assert.equal(twoFactorFormsPlan(question.replace("+23x^2", "+24x^2")), null);
  assert.equal(twoFactorFormsPlan(question.replace("k+l?", "j+k?")), null);
  assert.equal(twoFactorFormsPlan(question.replace("(5x^2+l)", "(3x^2+l)")), null);
});

test("previously cached bad fits are repaired without a model call or invalidating other entries", async () => {
  const cache = createMemorySolveCache();
  const selected = selectMethods(response());
  const entry: CacheEntry = { version: 1, cacheKey: "test-factor-forms", promptConfigVersion: "test", question, choices: null, structure: null, methods: selected.methods, winnerId: selected.winnerId, modelPreference: "identity-regression", retryOf: null, createdAt: new Date().toISOString() };
  await cache.putEntry(entry);
  const resolved = await resolveEntry(cache, entry);
  assert.equal(resolved.status, "ready");
  if (resolved.status !== "ready") return;
  assert.equal(resolved.winner.answer, "10.5");
  assert.equal(resolved.entry.cacheKey, entry.cacheKey);
  let fetches = 0;
  const deps: PipelineDeps = {
    cache, context: { model: "test-model", candidateInstructions: "", version: "test" },
    diagnosticId: "offline-factor-test", tier: { priorityUnavailable: false },
    client: new OpenAI({ apiKey: "unit-test-key", maxRetries: 0, fetch: async () => {
      fetches += 1;
      throw new Error("A model call is forbidden in this regression test");
    } }),
  };
  const calls = { candidates: 0, explanation: 0 };
  const explained = await explainMethod(deps, resolved.entry, resolved.winner, calls);
  assert.equal(explained.solution.answer, "10.5");
  assert.equal(explained.source, "cache");
  assert.equal(fetches, 0);
  assert.deepEqual(calls, { candidates: 0, explanation: 0 });
  assert.ok(await cache.getExplanation(entry.cacheKey, resolved.winner.id));
  const preflight = createPreflightHandler({
    getCurrentUser: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
    getCache: () => cache,
    getUsage: () => createMemoryUsageStore(),
    maxDurationSeconds: 180,
  });
  const report = await preflight(new Request("http://localhost/api/solve/preflight", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cacheKey: entry.cacheKey, verdicts: [{ methodId: resolved.winner.id, status: "error", errors: [{ row: 1, message: "test browser rejection" }] }] }),
  }));
  assert.equal(report.status, 200);
  assert.equal((await report.json()).selectedMethodId, "factoring");
  assert.equal((await cache.getPreflight(entry.cacheKey))[resolved.winner.id].status, "error");
  const unrelated = { ...entry, question: "What is the positive solution of x^2=9?" };
  assert.strictEqual((await resolveEntry(cache, unrelated)).entry, unrelated);
});
