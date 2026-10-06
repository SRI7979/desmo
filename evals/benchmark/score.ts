/**
 * Scoring for benchmark runs. A run is judged by the technique the server
 * actually made the default, against the case's gold / acceptable / bad
 * labels, plus the measurable burden of that default (rows, derivation steps,
 * one-off facts). Infrastructure failures (no credit, rate limits, network,
 * timeouts) are counted separately: they say nothing about solver quality,
 * and mixing them in hid a credit outage as a 31-point accuracy drop in an
 * earlier recorded run.
 */
import type { LibraryTrace } from "../../src/lib/library-trace";
import { getTechnique, type TechniqueId } from "../../src/lib/technique-vocabulary";
import type { LoadedCase, ScorableCase } from "./case-schema";

export type StrategyClass = "gold" | "acceptable" | "bad" | "unlisted";

export type MethodRecord = {
  techniqueId: string;
  rows: number;
  derivationSteps: number;
  oneOffFacts: number;
  mathScore: number;
  total: number | null;
  mathLevel: "low" | "medium" | "high" | null;
  family?: string;
  /** Desmos way or math way; absent on records written before it existed. */
  approach?: "desmos" | "math";
};

export type StageRecord = { stage: string; ms: number; usage?: { input: number; cached: number; output: number; reasoning: number } };

export type RunRecord = {
  caseId: string;
  group: LoadedCase["group"];
  /** Absent on records written before cases carried provenance: those are silver. */
  labelProvenance?: LoadedCase["labelProvenance"];
  runIndex: number;
  ok: boolean;
  /** Set when the failure was the provider or network, not the solver. */
  infraFailure?: string;
  error?: string;
  clarification?: boolean;
  answer?: string;
  answerCorrect?: boolean;
  winner?: MethodRecord;
  strategyClass?: StrategyClass;
  /** Every eligible method, default first. */
  methods?: MethodRecord[];
  /** The gold technique appears among the eligible methods (as an alternative if not the default). */
  goldListed?: boolean;
  rejections?: { technique: string; rule: string }[];
  /** Call-1 attempts (a guided correction or timeout recovery makes 2). */
  candidateCalls?: number;
  desmosRetry?: boolean;
  explanationSource?: "cache" | "model" | "fallback";
  explanationScore?: number;
  unexplainedJargon?: string[];
  /** Legacy structural classifier verdict (cases 001–031), when one exists. */
  structural?: { acceptable: boolean; forbidden: boolean; reason?: string };
  methodsMs?: number;
  completeMs?: number;
  stages?: StageRecord[];
  /** Raw call-1 outputs, so selection can be replayed offline (evals/replay.mts). */
  candidateOutputs?: unknown[];
  rescue?: string | null;
  /** Which library strategies the solve matched and used (fresh solves only). */
  library?: LibraryTrace;
};

const INFRA = /\b429\b|credits?|quota|rate.?limit|timed? ?out|timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|50[234]\b|overloaded|APIConnection/i;

export function isInfraFailure(message: string): boolean {
  return INFRA.test(message);
}

export function classifyStrategy(techniqueId: string, item: Pick<ScorableCase, "gold" | "acceptable" | "bad">): StrategyClass {
  if ((item.gold as string[]).includes(techniqueId)) return "gold";
  if ((item.acceptable as string[]).includes(techniqueId)) return "acceptable";
  if (item.bad.some((bad) => bad.technique === techniqueId)) return "bad";
  return "unlisted";
}

/** A default that asks real algebra or memorization of the student. */
export function isMathHeavy(method: MethodRecord): boolean {
  return method.mathScore >= 2 || method.mathLevel === "high";
}

export function isPaper(techniqueId: string): boolean {
  try {
    return getTechnique(techniqueId as TechniqueId).source === "standard";
  } catch {
    return false;
  }
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: the smallest value with at least p% of values at or below it.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

const pct = (part: number, whole: number) => (whole ? Number(((part / whole) * 100).toFixed(1)) : null);
const mean = (values: number[]) => (values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null);

export type Metrics = {
  runs: number;
  /** Runs that reached the solver's own verdict (infrastructure failures excluded). */
  scoredRuns: number;
  infraFailureRate: number | null;
  answerAccuracy: number | null;
  goldRate: number | null;
  acceptableRate: number | null;
  badRate: number | null;
  unlistedRate: number | null;
  mathHeavyRate: number | null;
  goldListedRate: number | null;
  /** Default is a Desmos way (records that carry the approach only). */
  desmosDefaultRate: number | null;
  /** Only one method listed. */
  singleMethodRate: number | null;
  /** The list offers both a Desmos way and a math way (records that carry the approach only). */
  bothWaysRate: number | null;
  /** Default is a standard paper technique: the solve fell back to generic math. */
  genericFallbackRate: number | null;
  /** Default cites the numbered library strategy it applies (traced runs only). */
  libraryDefaultRate: number | null;
  /** A structure detector pointed at a library technique the solve never tried or matched (traced runs only). */
  libraryMissRate: number | null;
  failureRate: number | null;
  clarificationRate: number | null;
  validationRetryRate: number | null;
  desmosRetryRate: number | null;
  explanationFallbackRate: number | null;
  avgRows: number | null;
  avgManualMath: number | null;
  avgHiddenDerivation: number | null;
  hiddenDerivationRejectionsPerRun: number | null;
  avgMethodsPerSolve: number | null;
  /** Distinct method families listed per solve: alternatives that teach something different. */
  avgFamiliesPerSolve: number | null;
  avgExplanationScore: number | null;
  latencyMs: {
    firstUseful: { p50: number | null; p75: number | null; p95: number | null };
    complete: { p50: number | null; p75: number | null; p95: number | null };
  };
  /** Mean model tokens per solve, from the stage trace. */
  tokens: { input: number | null; cached: number | null; output: number | null; reasoning: number | null };
};

export function summarize(records: RunRecord[]): Metrics {
  const scored = records.filter((record) => !record.infraFailure);
  const solved = scored.filter((record) => record.ok && !record.clarification);
  const winners = solved.flatMap((record) => (record.winner ? [record.winner] : []));
  const traced = solved.filter((record) => record.library);
  const withApproach = solved.filter((record) => record.methods?.length && record.methods.every((method) => method.approach));
  const classes = solved.map((record) => record.strategyClass);
  const firstUseful = solved.flatMap((record) => (record.methodsMs !== undefined ? [record.methodsMs] : []));
  const complete = solved.flatMap((record) => (record.completeMs !== undefined ? [record.completeMs] : []));
  const usage = (key: "input" | "cached" | "output" | "reasoning") =>
    mean(solved.filter((record) => record.stages?.some((stage) => stage.usage)).map((record) =>
      (record.stages ?? []).reduce((sum, stage) => sum + (stage.usage?.[key] ?? 0), 0)));
  return {
    runs: records.length,
    scoredRuns: scored.length,
    infraFailureRate: pct(records.length - scored.length, records.length),
    answerAccuracy: pct(solved.filter((record) => record.answerCorrect).length, scored.length),
    goldRate: pct(classes.filter((value) => value === "gold").length, solved.length),
    acceptableRate: pct(classes.filter((value) => value === "gold" || value === "acceptable").length, solved.length),
    badRate: pct(classes.filter((value) => value === "bad").length, solved.length),
    unlistedRate: pct(classes.filter((value) => value === "unlisted").length, solved.length),
    mathHeavyRate: pct(winners.filter(isMathHeavy).length, winners.length),
    goldListedRate: pct(solved.filter((record) => record.goldListed).length, solved.length),
    desmosDefaultRate: pct(winners.filter((winner) => winner.approach === "desmos").length, winners.filter((winner) => winner.approach).length),
    singleMethodRate: pct(solved.filter((record) => record.methods?.length === 1).length, solved.length),
    bothWaysRate: pct(withApproach.filter((record) => new Set(record.methods!.map((method) => method.approach)).size === 2).length, withApproach.length),
    genericFallbackRate: pct(winners.filter((winner) => isPaper(winner.techniqueId)).length, winners.length),
    libraryDefaultRate: pct(traced.filter((record) => record.library!.winner?.strategy != null).length, traced.length),
    libraryMissRate: pct(traced.filter((record) => record.library!.missed.length > 0).length, traced.length),
    failureRate: pct(scored.filter((record) => !record.ok).length, scored.length),
    clarificationRate: pct(scored.filter((record) => record.clarification).length, scored.length),
    validationRetryRate: pct(solved.filter((record) => (record.candidateCalls ?? 1) > 1).length, solved.length),
    desmosRetryRate: pct(solved.filter((record) => record.desmosRetry).length, solved.length),
    explanationFallbackRate: pct(solved.filter((record) => record.explanationSource === "fallback").length, solved.length),
    avgRows: mean(winners.map((winner) => winner.rows)),
    avgManualMath: mean(winners.map((winner) => winner.mathScore)),
    // Derivation the student does before typing a calculator plan: the
    // algebra a short Desmos row can hide.
    avgHiddenDerivation: mean(winners.filter((winner) => winner.rows > 0).map((winner) => winner.derivationSteps)),
    hiddenDerivationRejectionsPerRun: mean(solved.map((record) => (record.rejections ?? []).filter((rejection) => rejection.rule === "hidden-derivation").length)),
    avgMethodsPerSolve: mean(solved.map((record) => record.methods?.length ?? 0)),
    avgFamiliesPerSolve: mean(solved.filter((record) => record.methods?.every((method) => method.family)).map((record) => new Set(record.methods!.map((method) => method.family)).size)),
    avgExplanationScore: mean(solved.flatMap((record) => (record.explanationScore !== undefined ? [record.explanationScore] : []))),
    latencyMs: {
      firstUseful: { p50: percentile(firstUseful, 50), p75: percentile(firstUseful, 75), p95: percentile(firstUseful, 95) },
      complete: { p50: percentile(complete, 50), p75: percentile(complete, 75), p95: percentile(complete, 95) },
    },
    tokens: { input: usage("input"), cached: usage("cached"), output: usage("output"), reasoning: usage("reasoning") },
  };
}

export const METRIC_GROUPS = ["all", "representative", "hard", "gold"] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];

/**
 * Metrics for the whole run and per group, so hard cases cannot mask
 * representative regressions and the gold solutions (human-verified, and seen
 * in the prompt) are never averaged into the agent-labeled cases.
 */
export function summarizeByGroup(records: RunRecord[]): Record<MetricGroup, Metrics> {
  return {
    all: summarize(records),
    representative: summarize(records.filter((record) => record.group === "representative")),
    hard: summarize(records.filter((record) => record.group === "hard")),
    gold: summarize(records.filter((record) => record.group === "gold")),
  };
}
