import type { Metrics, RunRecord } from "./score";

type Grouped = Record<"all" | "representative" | "hard", Metrics>;

const ROWS: { key: string; label: string; get: (metrics: Metrics) => number | null; better: "up" | "down"; unit?: string }[] = [
  { key: "answerAccuracy", label: "Answer accuracy", get: (m) => m.answerAccuracy, better: "up", unit: "%" },
  { key: "goldRate", label: "Recommended = gold strategy", get: (m) => m.goldRate, better: "up", unit: "%" },
  { key: "acceptableRate", label: "Recommended = gold or acceptable", get: (m) => m.acceptableRate, better: "up", unit: "%" },
  { key: "badRate", label: "Recommended = bad strategy", get: (m) => m.badRate, better: "down", unit: "%" },
  { key: "unlistedRate", label: "Recommended = unlabeled strategy", get: (m) => m.unlistedRate, better: "down", unit: "%" },
  { key: "mathHeavyRate", label: "Math-heavy default (math score ≥ 2)", get: (m) => m.mathHeavyRate, better: "down", unit: "%" },
  { key: "goldListedRate", label: "Gold strategy listed (default or alternative)", get: (m) => m.goldListedRate, better: "up", unit: "%" },
  { key: "avgRows", label: "Avg Desmos rows (default)", get: (m) => m.avgRows, better: "down" },
  { key: "avgManualMath", label: "Avg manual-math score (default)", get: (m) => m.avgManualMath, better: "down" },
  { key: "avgHiddenDerivation", label: "Avg hidden derivation (calculator defaults)", get: (m) => m.avgHiddenDerivation, better: "down" },
  { key: "avgMethodsPerSolve", label: "Avg methods listed", get: (m) => m.avgMethodsPerSolve, better: "up" },
  { key: "avgFamiliesPerSolve", label: "Avg distinct method families listed", get: (m) => m.avgFamiliesPerSolve, better: "up" },
  { key: "avgExplanationScore", label: "Explanation rubric score (0–1)", get: (m) => m.avgExplanationScore, better: "up" },
  { key: "failureRate", label: "Solver failure rate", get: (m) => m.failureRate, better: "down", unit: "%" },
  { key: "clarificationRate", label: "Clarification rate", get: (m) => m.clarificationRate, better: "down", unit: "%" },
  { key: "validationRetryRate", label: "Validation retry rate", get: (m) => m.validationRetryRate, better: "down", unit: "%" },
  { key: "desmosRetryRate", label: "Desmos retry rate", get: (m) => m.desmosRetryRate, better: "down", unit: "%" },
  { key: "explanationFallbackRate", label: "Explanation fallback rate", get: (m) => m.explanationFallbackRate, better: "down", unit: "%" },
  { key: "infraFailureRate", label: "Infrastructure failures (excluded)", get: (m) => m.infraFailureRate, better: "down", unit: "%" },
  { key: "firstP50", label: "Time to first useful result p50 (ms)", get: (m) => m.latencyMs.firstUseful.p50, better: "down" },
  { key: "firstP75", label: "Time to first useful result p75 (ms)", get: (m) => m.latencyMs.firstUseful.p75, better: "down" },
  { key: "firstP95", label: "Time to first useful result p95 (ms)", get: (m) => m.latencyMs.firstUseful.p95, better: "down" },
  { key: "completeP50", label: "Complete p50 (ms)", get: (m) => m.latencyMs.complete.p50, better: "down" },
  { key: "completeP95", label: "Complete p95 (ms)", get: (m) => m.latencyMs.complete.p95, better: "down" },
  { key: "outputTokens", label: "Output tokens per solve", get: (m) => m.tokens.output, better: "down" },
];

const show = (value: number | null, unit = "") => (value === null ? "—" : `${value}${unit}`);

export function metricsTable(grouped: Grouped, baseline?: Grouped): string {
  const header = baseline
    ? "| Metric | All | Δ all | Representative | Δ rep | Hard | Δ hard |\n|---|---|---|---|---|---|---|"
    : "| Metric | All | Representative | Hard |\n|---|---|---|---|";
  const delta = (now: number | null, before: number | null, better: "up" | "down") => {
    if (now === null || before === null) return "—";
    const change = Number((now - before).toFixed(2));
    if (change === 0) return "0";
    const good = better === "up" ? change > 0 : change < 0;
    return `${change > 0 ? "+" : ""}${change} ${good ? "✓" : "✗"}`;
  };
  const lines = ROWS.map(({ label, get, better, unit }) => {
    const cells = (["all", "representative", "hard"] as const).flatMap((group) => {
      const now = get(grouped[group]);
      return baseline ? [show(now, unit), delta(now, get(baseline[group]), better)] : [show(now, unit)];
    });
    return `| ${label} | ${cells.join(" | ")} |`;
  });
  const runs = `Runs: ${grouped.all.runs} (${grouped.all.scoredRuns} scored; representative ${grouped.representative.runs}, hard ${grouped.hard.runs}).`;
  return `${runs}\n\n${header}\n${lines.join("\n")}`;
}

/** One line per case: how often each technique won, and every non-gold or wrong run. */
export function perCaseTable(records: RunRecord[]): string {
  const byCase = new Map<string, RunRecord[]>();
  for (const record of records) byCase.set(record.caseId, [...(byCase.get(record.caseId) ?? []), record]);
  const lines = [...byCase].map(([id, runs]) => {
    const scored = runs.filter((run) => !run.infraFailure);
    const correct = scored.filter((run) => run.answerCorrect).length;
    const winners = scored.map((run) => (run.ok ? (run.winner ? `${run.winner.techniqueId}(${run.strategyClass})` : "clarification") : "FAILED"));
    const tally = Object.entries(winners.reduce<Record<string, number>>((counts, winner) => ({ ...counts, [winner]: (counts[winner] ?? 0) + 1 }), {}))
      .map(([winner, count]) => `${winner}×${count}`)
      .join(", ");
    return `| ${id} | ${runs[0].group} | ${correct}/${scored.length} | ${tally || "—"} | ${runs.length - scored.length} |`;
  });
  return `| Case | Group | Correct | Default technique (class) × runs | Infra fails |\n|---|---|---|---|---|\n${lines.join("\n")}`;
}

export function stageTable(records: RunRecord[]): string {
  const byStage = new Map<string, number[]>();
  for (const record of records) {
    if (record.infraFailure) continue;
    const totals = new Map<string, number>();
    for (const stage of record.stages ?? []) totals.set(stage.stage, (totals.get(stage.stage) ?? 0) + stage.ms);
    for (const [stage, ms] of totals) byStage.set(stage, [...(byStage.get(stage) ?? []), ms]);
  }
  if (byStage.size === 0) return "_No stage traces recorded._";
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];
  const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)];
  const lines = [...byStage].map(([stage, values]) => `| ${stage} | ${values.length} | ${median(values)} | ${p95(values)} |`);
  return `| Stage | Runs | p50 ms | p95 ms |\n|---|---|---|---|\n${lines.join("\n")}`;
}
