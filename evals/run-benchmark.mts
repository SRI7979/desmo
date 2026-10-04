/**
 * The Desmo benchmark: every case in evals/problems (and the gitignored
 * evals/private, for licensed problems) through the SAME pipeline the app
 * uses, scored for answer accuracy, strategy quality against gold labels,
 * student burden, explanation quality, reliability, and latency. Spends real
 * OpenAI credits.
 *
 *   npm run bench:solver -- <label> [--runs=3] [--concurrency=4]
 *       [--group=representative|hard|all] [--cases=001,032] [--compare=<label>]
 *       [--no-private]
 *
 * Each run gets a fresh, empty cache so it is an independent generation. The
 * raw call-1 output of every run is saved, so `npm run bench:replay` can
 * re-score a later scoring or validation change without new model calls.
 *
 * Results: evals/results/<label>.json; report: evals/reports/<label>.md.
 */
import OpenAI from "openai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createMemorySolveCache } from "../src/lib/solve-cache";
import { configuredReasoningEffort, createTrace, loadSolveContext, solveProblem, type SolveContext } from "../src/lib/solve-pipeline";
import type { LoadedCase } from "./benchmark/case-schema";
import { loadCases } from "./benchmark/load-cases";
import { recordRun } from "./benchmark/record";
import { metricsTable, perCaseTable, stageTable } from "./benchmark/report";
import { summarizeByGroup, type RunRecord } from "./benchmark/score";

function parseArgs() {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
  return {
    label: args.find((arg) => !arg.startsWith("--")) ?? "run",
    runs: Number(flag("runs", "3")),
    concurrency: Number(flag("concurrency", "4")),
    group: flag("group", "all") as "all" | "representative" | "hard",
    only: flag("cases", "").split(",").map((value) => value.trim()).filter(Boolean),
    compare: flag("compare", ""),
    includePrivate: !args.includes("--no-private"),
  };
}

async function apiKey(): Promise<string> {
  const env = await readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  const key = process.env.OPENAI_API_KEY?.trim() || /^OPENAI_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
  if (!key) throw new Error("OPENAI_API_KEY missing from the environment or .env.local");
  return key;
}

async function pooled<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function runOnce(client: OpenAI, context: SolveContext, item: LoadedCase, runIndex: number): Promise<RunRecord> {
  const trace = createTrace();
  const deps = { client, cache: createMemorySolveCache(), context, tier: { priorityUnavailable: false }, diagnosticId: randomUUID(), trace };
  const started = performance.now();
  try {
    const result = await solveProblem(deps, { kind: "text", problem: item.problem, choices: item.choices });
    return recordRun(item, runIndex, { result, ms: Math.round(performance.now() - started) }, trace);
  } catch (error) {
    return recordRun(item, runIndex, { error, ms: Math.round(performance.now() - started) }, trace);
  }
}

async function main() {
  const options = parseArgs();
  const cases = await loadCases({ only: options.only, group: options.group, includePrivate: options.includePrivate });
  if (!cases.length) throw new Error("No cases matched.");
  const context = await loadSolveContext();
  const client = new OpenAI({ apiKey: await apiKey(), timeout: 170_000, maxRetries: 0 });
  const configuration = {
    model: context.model,
    reasoningEffort: configuredReasoningEffort(),
    serviceTier: process.env.OPENAI_SERVICE_TIER?.trim() || "priority",
    promptConfigVersion: context.version,
  };
  console.log(`Benchmark ${options.label}: ${cases.length} cases × ${options.runs} runs, concurrency ${options.concurrency}, ${JSON.stringify(configuration)}`);

  const jobs = cases.flatMap((item) => Array.from({ length: options.runs }, (_, runIndex) => ({ item, runIndex })));
  let done = 0;
  const records = await pooled(jobs, options.concurrency, async ({ item, runIndex }) => {
    const record = await runOnce(client, context, item, runIndex);
    done += 1;
    const status = record.infraFailure
      ? `INFRA ${record.infraFailure}`
      : !record.ok
        ? `FAILED ${record.error}`
        : record.clarification
          ? "CLARIFICATION"
          : `${record.answerCorrect ? "correct" : "WRONG"} ${record.winner?.techniqueId}(${record.strategyClass}) first=${record.methodsMs}ms total=${record.completeMs}ms`;
    console.log(`[${done}/${jobs.length}] ${item.id}#${runIndex + 1} ${status}`);
    return record;
  });

  const metrics = summarizeByGroup(records);
  const baselinePath = options.compare ? path.join(process.cwd(), "evals/results", `${options.compare}.json`) : null;
  const baseline = baselinePath ? JSON.parse(await readFile(baselinePath, "utf8")) : null;
  const report = [
    `# Benchmark: ${options.label}`,
    "",
    `Configuration: \`${JSON.stringify(configuration)}\`. ${cases.length} cases × ${options.runs} runs.`,
    baseline ? `Compared with \`${options.compare}\` (prompt ${baseline.configuration?.promptConfigVersion ?? "unknown"}).` : "",
    "",
    "## Metrics",
    "",
    metricsTable(metrics, baseline?.metrics),
    "",
    "## Where the time goes (per solve)",
    "",
    stageTable(records),
    "",
    "## Per case",
    "",
    perCaseTable(records),
    "",
  ].join("\n");

  const resultsDir = path.join(process.cwd(), "evals/results");
  const reportsDir = path.join(process.cwd(), "evals/reports");
  await mkdir(resultsDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  await writeFile(path.join(resultsDir, `${options.label}.json`), JSON.stringify({ label: options.label, format: 2, configuration, runs: options.runs, caseIds: cases.map((item) => item.id), metrics, records }, null, 2));
  await writeFile(path.join(reportsDir, `${options.label}.md`), report);
  console.log(`\n${metricsTable(metrics, baseline?.metrics)}\n\nWrote evals/results/${options.label}.json and evals/reports/${options.label}.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
