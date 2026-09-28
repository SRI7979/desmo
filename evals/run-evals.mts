/**
 * Method-quality eval harness for the Desmo solver.
 *
 * Runs each problem in evals/problems/*.json N times through the SAME solve
 * pipeline the app uses (src/lib/solve-pipeline.ts: candidates call, server
 * selection, explanation call), bypassing only HTTP/auth/rate limiting, and
 * scores METHOD quality, not just answer correctness. A single run per problem
 * measures nothing for a solver whose output varies run to run.
 *
 * Every run gets a fresh, empty cache so it is an independent generation; a
 * shared cache would make runs 2..N trivially identical and hide variance.
 * Cache-hit latency is measured separately by re-solving each problem's first
 * input against that run's cache (no model call).
 *
 * Spends real OpenAI credits.
 *
 *   npm run eval -- <label> [--runs=5] [--concurrency=4] [--problems=001,009]
 *
 * Results: evals/results/<label>.json (per-run detail for later comparison).
 */
import OpenAI from "openai";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { findProseRows, findUndefinedVariables } from "../src/lib/desmos-latex";
import { createMemorySolveCache, eligibleMethods } from "../src/lib/solve-cache";
import { loadSolveContext, MAX_ATTEMPTS, solveProblem, type SolveContext, type SolveInput } from "../src/lib/solve-pipeline";
import { classify, answerMatches } from "./classifiers";

type Problem = {
  domain?: string;
  problem: string;
  choices: string[] | null;
  correctAnswer: string;
  intendedMethod: string;
  acceptableMethods: string[];
  forbiddenMethods: string[];
  notes: string;
};

type RunResult = {
  ok: boolean;
  ms: number;
  methodsMs?: number;
  cacheHitMs?: number;
  cacheHitCalls?: number;
  attempts: number;
  error?: string;
  answer?: string;
  trick?: string | null;
  techniqueId?: string;
  methodCount?: number;
  techniques?: string[];
  /** Every listed method's rows as the calculator would receive them, for the Desmos pre-flight audit. */
  methods?: { techniqueId: string; rows: { latex: string; slider: { min: number; max: number; step: number } | null }[]; answerState: unknown; badges: string[]; shape: string }[];
  rejected?: { technique: string; rule: string }[];
  explanation?: string;
  answerCorrect?: boolean;
  intendedOrAcceptable?: boolean;
  forbidden?: boolean;
  forbiddenReason?: string;
  failedToInsert?: boolean;
  solution?: unknown;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const label = args.find((a) => !a.startsWith("--")) ?? "run";
  const flag = (name: string, fallback: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
  return {
    label,
    runs: Number(flag("runs", "5")),
    concurrency: Number(flag("concurrency", "4")),
    only: flag("problems", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

async function loadProblems(only: string[]): Promise<{ id: string; problem: Problem }[]> {
  const dir = path.join(process.cwd(), "evals/problems");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const loaded = await Promise.all(
    files.map(async (file) => ({
      id: file.replace(/\.json$/, ""),
      problem: JSON.parse(await readFile(path.join(dir, file), "utf8")) as Problem,
    })),
  );
  return only.length ? loaded.filter(({ id }) => only.some((o) => id.startsWith(o))) : loaded;
}

async function runOnce(client: OpenAI, context: SolveContext, id: string, problem: Problem, measureCacheHit: boolean): Promise<RunResult> {
  const started = performance.now();
  const cache = createMemorySolveCache();
  const deps = { client, cache, context, tier: { priorityUnavailable: false }, diagnosticId: randomUUID() };
  const input: SolveInput = { kind: "text", problem: problem.problem, choices: problem.choices };
  try {
    const result = await solveProblem(deps, input);
    const ms = Math.round(performance.now() - started);
    if (result.kind !== "solved") {
      return { ok: false, ms, attempts: result.calls.candidates, error: `needs_clarification: ${result.solution.clarification}` };
    }
    const solution = result.solution;
    let cacheHitMs: number | undefined;
    let cacheHitCalls: number | undefined;
    if (measureCacheHit) {
      const hitStarted = performance.now();
      const hit = await solveProblem(deps, input);
      cacheHitMs = Math.round(performance.now() - hitStarted);
      cacheHitCalls = hit.calls.candidates + hit.calls.explanation;
    }
    const failedToInsert = findProseRows(solution.expressions).length > 0 || findUndefinedVariables(solution.expressions).length > 0;
    const verdict = classify(id, solution);
    return {
      ok: true,
      ms,
      methodsMs: Math.round(result.timings.methodsMs),
      cacheHitMs,
      cacheHitCalls,
      attempts: result.calls.candidates,
      answer: solution.answer,
      trick: solution.trick,
      techniqueId: result.method.techniqueId,
      methodCount: eligibleMethods(result.entry).length,
      techniques: eligibleMethods(result.entry).map((method) => method.techniqueId),
      methods: result.resolved.methods.map((method) => ({
        techniqueId: method.techniqueId,
        rows: method.rows,
        answerState: method.answerState,
        badges: method.badges,
        shape: method.shape,
      })),
      rejected: result.entry.methods
        .filter((method) => method.rejected)
        .map((method) => ({ technique: method.techniqueId, rule: method.rejected!.rule })),
      explanation: result.explanation,
      answerCorrect: answerMatches(solution.answer, problem.correctAnswer),
      intendedOrAcceptable: verdict.intendedOrAcceptable,
      forbidden: verdict.forbidden || failedToInsert,
      forbiddenReason: failedToInsert ? "rows failed the insertability check (undefined symbol or prose row)" : verdict.forbiddenReason,
      failedToInsert,
      solution: {
        expressions: solution.expressions,
        parameters: solution.parameters,
        result: solution.result,
        conditionType: solution.conditionType,
        distinguishes: solution.distinguishes,
        answerState: solution.answerState,
        method: solution.method,
        structure: solution.structure,
      },
    };
  } catch (error) {
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      attempts: MAX_ATTEMPTS,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}

async function pooled<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const { label, runs, concurrency, only } = parseArgs();
  const env = await readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  const apiKey = process.env.OPENAI_API_KEY?.trim() || /^OPENAI_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing from the environment or .env.local");

  const problems = await loadProblems(only);
  if (!problems.length) throw new Error("No problems matched.");
  const context = await loadSolveContext();
  const client = new OpenAI({ apiKey, timeout: 170_000, maxRetries: 0 });
  console.log(`Running ${problems.length} problems x ${runs} runs, concurrency=${concurrency}, promptConfigVersion=${context.version}`);

  type Job = { id: string; problem: Problem; runIndex: number };
  const jobs: Job[] = problems.flatMap(({ id, problem }) => Array.from({ length: runs }, (_, runIndex) => ({ id, problem, runIndex })));
  let completed = 0;
  const jobResults = await pooled(jobs, concurrency, async (job) => {
    const result = await runOnce(client, context, job.id, job.problem, job.runIndex === 0);
    completed += 1;
    console.log(
      `[${completed}/${jobs.length}] ${job.id} run ${job.runIndex + 1}: ` +
        (result.ok
          ? `${result.answerCorrect ? "correct" : "WRONG"} answer=${result.answer} technique=${result.techniqueId} methods=${result.methodCount} ${result.forbidden ? `FORBIDDEN(${result.forbiddenReason})` : "ok"} first=${result.methodsMs}ms total=${result.ms}ms${result.cacheHitMs !== undefined ? ` hit=${result.cacheHitMs}ms/${result.cacheHitCalls}calls` : ""}`
          : `FAILED: ${result.error} ${result.ms}ms`),
    );
    return { ...job, result };
  });

  const byProblem = new Map<string, { problem: Problem; results: RunResult[] }>();
  for (const { id, problem, result } of jobResults) {
    if (!byProblem.has(id)) byProblem.set(id, { problem, results: [] });
    byProblem.get(id)!.results.push(result);
  }
  const all = jobResults.map((j) => j.result);
  const ok = all.filter((r) => r.ok);
  const total = all.length;
  const perProblem = [...byProblem.entries()].map(([id, { problem, results }]) => ({
    id,
    domain: problem.domain,
    distinctMethods: new Set(results.filter((r) => r.ok).map((r) => r.techniqueId)).size,
    worstCaseHit: results.some((r) => !r.ok || r.forbidden),
    answerCorrectCount: results.filter((r) => r.ok && r.answerCorrect).length,
    forbiddenCount: results.filter((r) => !r.ok || r.forbidden).length,
    techniques: results.map((r) => (r.ok ? r.techniqueId : `FAILED: ${r.error}`)),
  }));
  const summary = {
    label,
    runs,
    problemCount: problems.length,
    totalRuns: total,
    promptConfigVersion: context.version,
    metrics: {
      answerMatch: Number(((ok.filter((r) => r.answerCorrect).length / total) * 100).toFixed(1)),
      methodMatch: Number(((ok.filter((r) => r.intendedOrAcceptable).length / total) * 100).toFixed(1)),
      forbiddenHit: Number(((all.filter((r) => !r.ok || r.forbidden).length / total) * 100).toFixed(1)),
      methodVariance: Number((perProblem.reduce((sum, p) => sum + p.distinctMethods, 0) / perProblem.length).toFixed(2)),
      worstCase: Number(((perProblem.filter((p) => p.worstCaseHit).length / perProblem.length) * 100).toFixed(1)),
    },
    latencyMs: {
      firstUsefulRender: { p50: percentile(ok.map((r) => r.methodsMs!), 50), p95: percentile(ok.map((r) => r.methodsMs!), 95) },
      complete: { p50: percentile(ok.map((r) => r.ms), 50), p95: percentile(ok.map((r) => r.ms), 95) },
      cacheHit: {
        p50: percentile(ok.flatMap((r) => (r.cacheHitMs !== undefined ? [r.cacheHitMs] : [])), 50),
        p95: percentile(ok.flatMap((r) => (r.cacheHitMs !== undefined ? [r.cacheHitMs] : [])), 95),
        modelCallsOnHit: ok.reduce((sum, r) => sum + (r.cacheHitCalls ?? 0), 0),
        note: "In-process, in-memory cache: excludes the Supabase round-trips the production cache adds.",
      },
    },
    methods: {
      meanEligiblePerSolve: Number((ok.reduce((sum, r) => sum + (r.methodCount ?? 0), 0) / Math.max(1, ok.length)).toFixed(2)),
      rejectionsByRule: ok
        .flatMap((r) => r.rejected ?? [])
        .reduce<Record<string, number>>((counts, { rule }) => ({ ...counts, [rule]: (counts[rule] ?? 0) + 1 }), {}),
      explanationFallbacks: ok.filter((r) => r.explanation === "fallback").length,
      candidateRetries: ok.filter((r) => r.attempts > 1).length,
    },
    perProblem,
    fullResults: jobResults,
  };

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ metrics: summary.metrics, latencyMs: summary.latencyMs, methods: summary.methods }, null, 2));
  console.log("\nPer-problem worst-case hits:");
  for (const p of perProblem) {
    if (!p.worstCaseHit) continue;
    const reasons = byProblem.get(p.id)!.results.filter((r) => !r.ok || r.forbidden).map((r) => r.forbiddenReason ?? r.error);
    console.log(`  ${p.id}: ${reasons.join(" | ")}`);
  }
  const resultsDir = path.join(process.cwd(), "evals/results");
  await mkdir(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `${label}.json`);
  await writeFile(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
