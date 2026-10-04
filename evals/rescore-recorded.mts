/**
 * Re-scores live runs recorded by the old harness (evals/run-evals.mts,
 * format 1) with the benchmark's technique-based labels, so historical runs
 * and new ones share one scale. Infrastructure failures are separated. The
 * old files keep no cost components, so derivation steps are read back from
 * each method's shape line ("2 algebra steps") and a one-off fact from the
 * technique's own fact. Free.
 *
 *   npm run bench:rescore -- <label>... [--out=<label>]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { answerMatches } from "./classifiers";
import { loadCases } from "./benchmark/load-cases";
import { metricsTable, perCaseTable } from "./benchmark/report";
import { classifyStrategy, isInfraFailure, summarizeByGroup, type MethodRecord, type RunRecord } from "./benchmark/score";
import { mathLevel } from "../src/lib/method-scoring";
import { getTechnique, isTechniqueId } from "../src/lib/technique-vocabulary";

type OldMethod = { techniqueId: string; rows: unknown[]; shape?: string };
type OldResult = {
  ok: boolean;
  ms: number;
  methodsMs?: number;
  attempts?: number;
  error?: string;
  answer?: string;
  techniqueId?: string;
  methods?: OldMethod[];
  rejected?: { technique: string; rule: string }[];
  explanation?: "cache" | "model" | "fallback";
};

function fromShape(method: OldMethod): MethodRecord {
  const shape = method.shape ?? "";
  const steps = /(\d+) algebra steps?/.exec(shape);
  const derivationSteps = steps ? Number(steps[1]) : 0;
  const technique = isTechniqueId(method.techniqueId) ? getTechnique(method.techniqueId) : null;
  const oneOffFacts = technique?.fact && shape.includes(technique.fact) ? 1 : 0;
  const mathScore = derivationSteps + oneOffFacts;
  return { techniqueId: method.techniqueId, rows: method.rows.length, derivationSteps, oneOffFacts, mathScore, total: null, mathLevel: mathLevel(mathScore) };
}

const args = process.argv.slice(2);
const labels = args.filter((arg) => !arg.startsWith("--"));
if (!labels.length) throw new Error("Pass one or more recorded labels from evals/results.");
const outLabel = args.find((arg) => arg.startsWith("--out="))?.slice(6) ?? `rescored-${labels.join("+")}`;
const cases = new Map((await loadCases({ includePrivate: false })).map((item) => [item.id, item]));

const records: RunRecord[] = [];
const notes: string[] = [];
for (const label of labels) {
  const data = JSON.parse(await readFile(path.join(process.cwd(), "evals/results", `${label}.json`), "utf8"));
  let skipped = 0;
  for (const job of data.fullResults as { id: string; runIndex: number; result: OldResult }[]) {
    const item = cases.get(job.id);
    const result = job.result;
    if (!item || (result.ok && !result.techniqueId)) {
      skipped += 1;
      continue;
    }
    const base = { caseId: `${job.id}`, group: item.group, runIndex: job.runIndex, completeMs: result.ms } as RunRecord;
    if (!result.ok) {
      const message = result.error ?? "unknown";
      records.push({ ...base, ok: false, error: message, ...(isInfraFailure(message) ? { infraFailure: message.slice(0, 120) } : {}), ...(message.startsWith("needs_clarification") ? { ok: true, clarification: true } : {}) });
      continue;
    }
    const methods = (result.methods ?? []).map(fromShape);
    const winner = methods.find((method) => method.techniqueId === result.techniqueId) ?? methods[0];
    records.push({
      ...base,
      ok: true,
      answer: result.answer,
      answerCorrect: answerMatches(result.answer ?? "", item.correctAnswer, item.choices),
      winner,
      strategyClass: classifyStrategy(result.techniqueId!, item),
      methods,
      goldListed: methods.some((method) => (item.gold as string[]).includes(method.techniqueId)),
      rejections: result.rejected ?? [],
      candidateCalls: result.attempts,
      explanationSource: result.explanation,
      methodsMs: result.methodsMs,
    });
  }
  notes.push(`${label}: ${data.fullResults.length} runs, prompt ${data.promptConfigVersion ?? "unknown"}${skipped ? `, ${skipped} skipped (no technique id or unknown case)` : ""}`);
}

const metrics = summarizeByGroup(records);
const report = [
  `# Recorded runs re-scored: ${labels.join(", ")}`,
  "",
  "These runs were recorded by the previous harness on older prompt versions; they cover only the cases that existed then. Latency is in-process (no auth, upload, or database time).",
  "",
  ...notes.map((note) => `- ${note}`),
  "",
  metricsTable(metrics),
  "",
  perCaseTable(records),
  "",
].join("\n");
await mkdir(path.join(process.cwd(), "evals/reports"), { recursive: true });
await writeFile(path.join(process.cwd(), "evals/reports", `${outLabel}.md`), report);
await writeFile(path.join(process.cwd(), "evals/results", `${outLabel}.json`), JSON.stringify({ label: outLabel, format: 2, source: labels, metrics, records }, null, 2));
console.log(report);
