/**
 * Method-quality eval harness for the Desmo solver (VARIANCE task, Phase 1).
 *
 * Runs each problem in evals/problems/*.json N times against the CURRENT
 * production prompt/schema/validation (built identically to
 * src/lib/solve-handler.ts, bypassing HTTP/auth/rate-limiting) and reports
 * method-quality metrics, not just answer correctness. A single run per
 * problem measures nothing for a solver whose output varies run to run.
 *
 * Spends real OpenAI credits — each run is a full priced solve.
 *
 *   npx tsx evals/run-evals.mts <label> [--runs=5] [--concurrency=4] [--mode=desmos_first] [--problems=001,009]
 *
 * <label> names the results file: evals/results/<label>.json (e.g. "baseline", "post").
 * Console output is a summary table; the JSON file has full per-run detail
 * for later baseline-vs-post comparison.
 */
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  buildUserPrompt,
  STRATEGY_INSTRUCTIONS,
  TRAINING_EXAMPLE_INSTRUCTIONS,
} from "../src/lib/solver-instructions";
import { DEFAULT_SOLVE_MODE, SOLVE_MODES, type Solution, type SolveMode } from "../src/lib/solver-schema";
import {
  compactStrategyPortfolioSchema,
  selectCompactStrategy,
  StrategySelectionError,
  type CompactStrategyPortfolio,
} from "../src/lib/strategy-selection";
import { loadTrainingExamples } from "../src/lib/training-examples";
import { retryPrompt, MAX_ATTEMPTS, type Rejection } from "../src/lib/solve-handler";
import { findProseRows, findUndefinedVariables } from "../src/lib/desmos-latex";
import { classify, methodTagOf, answerMatches } from "./classifiers";

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
  attempts: number;
  error?: string;
  answer?: string;
  trick?: string | null;
  answerCorrect?: boolean;
  intendedOrAcceptable?: boolean;
  forbidden?: boolean;
  forbiddenReason?: string;
  failedToInsert?: boolean;
  // Kept for offline re-classification/audit without spending more API calls.
  solution?: Pick<Solution, "expressions" | "parameters" | "result" | "conditionType" | "distinguishes" | "answerState" | "method" | "structure">;
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
    mode: (SOLVE_MODES.find((m) => m === flag("mode", DEFAULT_SOLVE_MODE)) ?? DEFAULT_SOLVE_MODE) as SolveMode,
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
    files.map(async (file) => {
      const id = file.replace(/\.json$/, "");
      const problem = JSON.parse(await readFile(path.join(dir, file), "utf8")) as Problem;
      return { id, problem };
    }),
  );
  return only.length ? loaded.filter(({ id }) => only.some((o) => id.startsWith(o))) : loaded;
}

function userText(mode: SolveMode, problem: Problem): string {
  const choiceText = problem.choices
    ? `\nAnswer choices: ${problem.choices.map((c, i) => `${String.fromCharCode(65 + i)}) ${c}`).join(", ")}`
    : "\n(Student-produced response; no answer choices.)";
  return `${buildUserPrompt(mode)}\n\nNo image is attached for this request. The text below is the complete, already-transcribed question; solve it directly, exactly as if it had been read from a screenshot.\n\nProblem: ${problem.problem}${choiceText}`;
}

async function runOnce(
  client: OpenAI,
  instructions: string,
  mode: SolveMode,
  id: string,
  problem: Problem,
  reasoningEffort: "minimal" | "low" | "medium" | "high",
): Promise<RunResult> {
  const started = performance.now();
  const format = zodTextFormat(compactStrategyPortfolioSchema, "sat_math_strategy_selection");
  const attempt = (rejection?: Rejection) =>
    client.responses.parse({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
      prompt_cache_key: "desmo-eval-v1",
      service_tier: "priority",
      instructions,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: userText(mode, problem) },
            ...(rejection ? [{ type: "input_text" as const, text: retryPrompt(rejection) }] : []),
          ],
        },
      ],
      text: { format, verbosity: "low" },
      reasoning: { effort: rejection && ["minimal", "low"].includes(reasoningEffort) ? "medium" : reasoningEffort },
      max_output_tokens: 8000,
      store: false,
    });

  try {
    let response = await attempt();
    let attempts = 1;
    let selected: ReturnType<typeof selectCompactStrategy> | null = null;
    while (!selected) {
      const parsed = response.output_parsed as CompactStrategyPortfolio | null;
      if (!parsed) throw new Error("No parsed output (refusal or schema failure).");
      try {
        selected = selectCompactStrategy(parsed, { mode });
      } catch (error) {
        if (!(error instanceof StrategySelectionError) || attempts >= MAX_ATTEMPTS) throw error;
        const rejection: Rejection = { stage: error.stage, reason: error.message, previous: JSON.stringify(parsed) };
        attempts += 1;
        response = await attempt(rejection);
      }
    }
    const ms = Math.round(performance.now() - started);
    const solution: Solution = selected.solution;
    if (solution.status !== "solved") {
      return { ok: false, ms, attempts, error: `needs_clarification: ${solution.clarification}` };
    }
    const failedToInsert =
      findProseRows(solution.expressions).length > 0 || findUndefinedVariables(solution.expressions).length > 0;
    const verdict = classify(id, solution);
    return {
      ok: true,
      ms,
      attempts,
      answer: solution.answer,
      trick: methodTagOf(solution),
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
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function main() {
  const { label, runs, concurrency, mode, only } = parseArgs();
  const env = await readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  const apiKey = process.env.OPENAI_API_KEY?.trim() || /^OPENAI_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing from the environment or .env.local");
  const reasoningEffort = (["minimal", "low", "medium", "high"] as const).find(
    (e) => e === process.env.OPENAI_REASONING_EFFORT?.trim(),
  ) ?? "low";

  const problems = await loadProblems(only);
  if (!problems.length) throw new Error("No problems matched.");
  const [library, training] = await Promise.all([
    readFile(path.join(process.cwd(), "src/content/desmos-tricks.md"), "utf8"),
    loadTrainingExamples(),
  ]);
  const instructions = `${STRATEGY_INSTRUCTIONS}\n\n<strategy_library>\n${library}\n</strategy_library>\n\n${TRAINING_EXAMPLE_INSTRUCTIONS}\n\n<training_examples>\n${training.prompt}\n</training_examples>`;
  const client = new OpenAI({ apiKey, timeout: 170_000, maxRetries: 0 });

  console.log(`Running ${problems.length} problems x ${runs} runs, mode=${mode}, concurrency=${concurrency}, effort=${reasoningEffort}`);

  type Job = { id: string; problem: Problem; runIndex: number };
  const jobs: Job[] = problems.flatMap(({ id, problem }) =>
    Array.from({ length: runs }, (_, runIndex) => ({ id, problem, runIndex })),
  );

  let completed = 0;
  const jobResults = await pooled(jobs, concurrency, async (job) => {
    const result = await runOnce(client, instructions, mode, job.id, job.problem, reasoningEffort);
    completed += 1;
    console.log(
      `[${completed}/${jobs.length}] ${job.id} run ${job.runIndex + 1}: ` +
        (result.ok
          ? `${result.answerCorrect ? "correct" : "WRONG"} answer=${result.answer} trick="${result.trick}" ${result.forbidden ? `FORBIDDEN(${result.forbiddenReason})` : "ok"} ${result.ms}ms`
          : `FAILED: ${result.error} ${result.ms}ms`),
    );
    return { ...job, result };
  });

  const byProblem = new Map<string, { problem: Problem; results: RunResult[] }>();
  for (const { id, problem, result } of jobResults) {
    if (!byProblem.has(id)) byProblem.set(id, { problem, results: [] });
    byProblem.get(id)!.results.push(result);
  }

  const allResults = jobResults.map((j) => j.result);
  const totalRuns = allResults.length;
  const answerMatch = (allResults.filter((r) => r.ok && r.answerCorrect).length / totalRuns) * 100;
  const methodMatch = (allResults.filter((r) => r.ok && r.intendedOrAcceptable).length / totalRuns) * 100;
  const forbiddenHit = (allResults.filter((r) => !r.ok || r.forbidden).length / totalRuns) * 100;
  const latencies = allResults.map((r) => r.ms);

  const perProblem = [...byProblem.entries()].map(([id, { problem, results }]) => {
    const distinctMethods = new Set(results.filter((r) => r.ok).map((r) => r.trick ?? "(none)")).size;
    const worstCaseHit = results.some((r) => !r.ok || r.forbidden);
    return { id, domain: problem.domain, distinctMethods, worstCaseHit, results };
  });
  const methodVariance = perProblem.reduce((sum, p) => sum + p.distinctMethods, 0) / perProblem.length;
  const worstCase = (perProblem.filter((p) => p.worstCaseHit).length / perProblem.length) * 100;

  const summary = {
    label,
    mode,
    runs,
    problemCount: problems.length,
    totalRuns,
    metrics: {
      answerMatch: Number(answerMatch.toFixed(1)),
      methodMatch: Number(methodMatch.toFixed(1)),
      forbiddenHit: Number(forbiddenHit.toFixed(1)),
      methodVariance: Number(methodVariance.toFixed(2)),
      worstCase: Number(worstCase.toFixed(1)),
    },
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      note: "Phase 1 is a single-call architecture: time-to-first-useful-render and time-to-complete are identical (no progressive rendering exists yet).",
    },
    perProblem: perProblem.map((p) => ({
      id: p.id,
      domain: p.domain,
      distinctMethods: p.distinctMethods,
      worstCaseHit: p.worstCaseHit,
      answerCorrectCount: p.results.filter((r) => r.ok && r.answerCorrect).length,
      forbiddenCount: p.results.filter((r) => !r.ok || r.forbidden).length,
      tricks: p.results.map((r) => (r.ok ? r.trick : `FAILED: ${r.error}`)),
    })),
    fullResults: jobResults,
  };

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary.metrics, null, 2));
  console.log(`latency p50=${summary.latencyMs.p50}ms p95=${summary.latencyMs.p95}ms`);
  console.log("\nPer-problem worst-case hits:");
  for (const p of perProblem) {
    if (p.worstCaseHit) console.log(`  ${p.id}: ${p.results.filter((r) => !r.ok || r.forbidden).map((r) => r.forbiddenReason ?? r.error).join(" | ")}`);
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
