import { scoreExplanation } from "../../src/lib/explanation-rubric";
import { eligibleMethods } from "../../src/lib/solve-cache";
import type { SolveResult, SolveTrace } from "../../src/lib/solve-pipeline";
import { methodApproach } from "../../src/lib/method-scoring";
import type { Method } from "../../src/lib/strategy-selection";
import { answerMatches, CLASSIFIERS } from "../classifiers";
import type { ScorableCase } from "./case-schema";
import { classifyStrategy, isInfraFailure, type MethodRecord, type RunRecord } from "./score";

export function methodRecord(method: Pick<Method, "techniqueId" | "rows" | "cost" | "mathScore" | "total" | "mathLevel" | "family" | "approach">): MethodRecord {
  return {
    techniqueId: method.techniqueId,
    rows: method.rows.length,
    derivationSteps: method.cost.derivationSteps,
    oneOffFacts: method.cost.oneOffFacts,
    mathScore: method.mathScore,
    total: method.total,
    mathLevel: method.mathLevel,
    family: method.family,
    approach: methodApproach(method),
  };
}

/** Everything the report needs from one solve, scored against the case's labels. */
export function recordRun(item: ScorableCase, runIndex: number, outcome: { result?: SolveResult; error?: unknown; ms: number }, trace?: SolveTrace): RunRecord {
  const base: RunRecord = {
    caseId: item.id,
    group: item.group,
    labelProvenance: item.labelProvenance,
    runIndex,
    ok: false,
    completeMs: outcome.ms,
    stages: trace?.stages,
    candidateOutputs: trace?.candidateOutputs,
    library: trace?.library,
  };
  if (outcome.error !== undefined || !outcome.result) {
    const message = outcome.error instanceof Error ? `${outcome.error.name}: ${outcome.error.message}` : String(outcome.error);
    return { ...base, error: message.slice(0, 400), ...(isInfraFailure(message) ? { infraFailure: message.slice(0, 120) } : {}) };
  }
  const result = outcome.result;
  if (result.kind !== "solved") {
    return { ...base, ok: true, clarification: true, answer: "", answerCorrect: false, error: `needs_clarification: ${result.solution.clarification}` };
  }
  const methods = result.resolved.methods.map(methodRecord);
  const winner = methodRecord(result.method);
  const legacy = CLASSIFIERS[item.id];
  const verdict = legacy ? legacy(result.solution) : null;
  const rubric = scoreExplanation(result.solution, item.problem);
  return {
    ...base,
    ok: true,
    answer: result.solution.answer,
    answerCorrect: answerMatches(result.solution.answer, item.correctAnswer, item.choices),
    winner,
    strategyClass: classifyStrategy(result.method.techniqueId, item),
    methods,
    goldListed: methods.some((method) => (item.gold as string[]).includes(method.techniqueId)),
    rejections: result.entry.methods.filter((method) => method.rejected).map((method) => ({ technique: method.techniqueId, rule: method.rejected!.rule })),
    candidateCalls: result.calls.candidates,
    desmosRetry: result.entry.retryOf !== null,
    explanationSource: result.explanation,
    explanationScore: Number(rubric.score.toFixed(3)),
    unexplainedJargon: rubric.unexplainedJargon,
    structural: verdict ? { acceptable: verdict.intendedOrAcceptable, forbidden: verdict.forbidden, reason: verdict.forbidden ? verdict.forbiddenReason : undefined } : undefined,
    methodsMs: Math.round(result.timings.methodsMs),
    completeMs: Math.round(result.timings.completeMs),
    rescue: result.rescue ?? null,
  };
}

/** The eligible methods of an entry as records, default first. */
export function entryMethods(entry: Parameters<typeof eligibleMethods>[0]): MethodRecord[] {
  return eligibleMethods(entry).map(methodRecord);
}
