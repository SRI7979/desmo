import { applyAnswerState, type RowEvaluation } from "./answer-consistency";
import { normalizeDesmosExpressions } from "./desmos-latex";
import type { AnswerState } from "./solver-schema";

/**
 * Pre-flight: before any row reaches the student, the exact batch the visible
 * calculator would receive is inserted into a hidden Desmos instance and its
 * per-expression analysis is read back. Static checks (desmos-latex,
 * solver-rules) catch known patterns cheaply; only the engine itself can say
 * "this row errors", so only a batch the engine reports fully clean is shown.
 *
 * This module is the environment-independent part: the payload both
 * calculators receive, how an analysis becomes a verdict, and the rank-order
 * promotion rule. desmos-engine.ts runs it against a real calculator.
 */

export const ROW_ID_PREFIX = "desmo_";
const EXPRESSION_COLORS = ["#169ed5", "#8a5ce6", "#e78a29", "#229b6b"];

type SliderBounds = { min: number; max: number; step: number };

export type CalculatorItem = {
  id: string;
  latex: string;
  color: string;
  sliderBounds?: SliderBounds;
};

/** A setExpressions batch plus a key identifying its content (not its colors). */
export type CalculatorPayload = { key: string; items: CalculatorItem[] };

type RowInput = { latex: string; slider?: SliderBounds | null };

/**
 * Exactly what the visible calculator inserts: normalized LaTeX, the slider
 * moved to the answer state, and valid slider bounds. The hidden pre-flight
 * instance and the visible calculator both build their batch here, so what
 * was checked is, by construction, what is shown.
 */
export function calculatorPayload(rows: readonly RowInput[], answerState: AnswerState | null | undefined): CalculatorPayload {
  const normalized = normalizeDesmosExpressions(rows.map(({ latex, slider }) => ({ latex, purpose: "", ...(slider ? { slider } : {}) })));
  const loaded = applyAnswerState(normalized, answerState);
  const items = loaded.map((row, index) => ({
    id: `${ROW_ID_PREFIX}${index + 1}`,
    latex: row.latex,
    color: EXPRESSION_COLORS[index % EXPRESSION_COLORS.length],
    ...(row.slider && row.slider.min < row.slider.max && row.slider.step > 0 ? { sliderBounds: row.slider } : {}),
  }));
  return {
    key: JSON.stringify(items.map(({ latex, sliderBounds }) => [latex, sliderBounds ?? null])),
    items,
  };
}

export type RowError = { row: number; message: string };

export type PreflightVerdict =
  | { status: "clean"; rows: number; evaluations: Record<number, RowEvaluation | null> }
  | { status: "error"; rows: number; errors: RowError[] }
  /** The engine never settled; not evidence either way, so never cached or reported. */
  | { status: "timeout"; rows: number };

/** The per-expression analysis Desmos exposes (verified against API v1.11.4). */
export type DesmosAnalysis = Record<
  string,
  { isError?: boolean; errorMessage?: string; evaluation?: { type?: string; value?: unknown } } | undefined
>;

function evaluationOf(entry: NonNullable<DesmosAnalysis[string]>): RowEvaluation | null {
  const evaluation = entry.evaluation;
  if (evaluation?.type === "Number" && typeof evaluation.value === "number" && Number.isFinite(evaluation.value)) {
    return { type: "Number", value: evaluation.value };
  }
  if (evaluation?.type === "ListOfNumber" && Array.isArray(evaluation.value) && evaluation.value.every((value) => typeof value === "number")) {
    return { type: "ListOfNumber", value: [...(evaluation.value as number[])] };
  }
  return null;
}

/**
 * The verdict for a batch whose rows were inserted under `ids` (row n is
 * ids[n-1]), or null while any row has not been analyzed yet.
 */
export function verdictFromAnalysis(analysis: DesmosAnalysis, ids: readonly string[]): PreflightVerdict | null {
  const errors: RowError[] = [];
  const evaluations: Record<number, RowEvaluation | null> = {};
  for (const [index, id] of ids.entries()) {
    const entry = analysis[id];
    if (!entry) return null;
    if (entry.isError) {
      errors.push({ row: index + 1, message: (entry.errorMessage || "Desmos reports an error on this line.").slice(0, 300) });
    } else {
      evaluations[index + 1] = evaluationOf(entry);
    }
  }
  return errors.length > 0 ? { status: "error", rows: ids.length, errors } : { status: "clean", rows: ids.length, evaluations };
}

/** A technique with no calculator rows has nothing that can error in Desmos. */
export function emptyVerdict(): PreflightVerdict {
  return { status: "clean", rows: 0, evaluations: {} };
}

export type Checkable = {
  id: string;
  rows: ReadonlyArray<{ latex: string; slider: SliderBounds | null }>;
  answerState: AnswerState | null;
};

export type PreflightRun<M> = {
  verdicts: Map<string, PreflightVerdict>;
  /** The first method in rank order the engine reported clean, or null when none was. */
  promoted: M | null;
};

/**
 * Checks methods in rank order (winner first) and promotes the first one the
 * engine reports fully clean; a method with any erroring row, or one the
 * engine never settled on (a timeout), is never promoted. Every other method
 * is still checked afterwards, so the selector lists only clean ones and
 * every error is reported. `onPromote` fires as soon as the winner is known,
 * typically after a single check. `trusted` methods (a clean verdict cached
 * by the server) are not re-checked here; the rendering gate still verifies
 * whatever is shown.
 */
export async function preflightInRankOrder<M extends Checkable>(
  methods: readonly M[],
  check: (payload: CalculatorPayload) => Promise<PreflightVerdict>,
  options: {
    trusted?: (method: M) => boolean;
    onVerdict?: (method: M, verdict: PreflightVerdict, checked: boolean) => void;
    onPromote?: (method: M) => void;
    isCancelled?: () => boolean;
  } = {},
): Promise<PreflightRun<M>> {
  const verdicts = new Map<string, PreflightVerdict>();
  let promoted: M | null = null;
  for (const method of methods) {
    if (options.isCancelled?.()) break;
    const trusted = method.rows.length === 0 || Boolean(options.trusted?.(method));
    const verdict = method.rows.length === 0
      ? emptyVerdict()
      : trusted
        ? ({ status: "clean", rows: method.rows.length, evaluations: {} } as const)
        : await check(calculatorPayload(method.rows, method.answerState));
    if (options.isCancelled?.()) break;
    verdicts.set(method.id, verdict);
    options.onVerdict?.(method, verdict, !trusted);
    if (!promoted && verdict.status === "clean") {
      promoted = method;
      options.onPromote?.(method);
    }
  }
  return { verdicts, promoted };
}

/** The selector's list: only methods the engine reported clean, in rank order. */
export function cleanMethods<M extends { id: string }>(methods: readonly M[], verdicts: ReadonlyMap<string, PreflightVerdict>): M[] {
  return methods.filter((method) => verdicts.get(method.id)?.status === "clean");
}

/** Every method not known to error, in rank order: what ranking and badges are computed over. */
export function survivingMethods<M extends { id: string }>(methods: readonly M[], verdicts: ReadonlyMap<string, PreflightVerdict>): M[] {
  return methods.filter((method) => verdicts.get(method.id)?.status !== "error");
}

/** The verdicts worth sending to the server: engine results, never timeouts or trusted skips. */
export type ReportedVerdict = { methodId: string; status: "clean" } | { methodId: string; status: "error"; errors: RowError[] };

export function reportable(methodId: string, verdict: PreflightVerdict): ReportedVerdict | null {
  if (verdict.status === "clean") return { methodId, status: "clean" };
  if (verdict.status === "error") return { methodId, status: "error", errors: verdict.errors };
  return null;
}
