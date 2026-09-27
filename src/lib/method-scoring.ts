/**
 * Server-side arithmetic for candidate methods. The model reports judgment
 * (how many derivation steps, which one-off facts); the server derives
 * everything it can measure itself (row count), then does all the arithmetic,
 * labeling, and selection. Nothing here asks the model for a total, a math
 * level, a shape, or a badge.
 */
import type { TechniqueId } from "./technique-vocabulary";
import { getTechnique } from "./technique-vocabulary";

export const COST_WEIGHTS = {
  rows: 1,
  derivationSteps: 3,
  newPrimitives: 2,
  oneOffFacts: 4,
  setupConstructions: 1,
  manualIterations: 1,
} as const;

/**
 * What the model reports; rows is never trusted from the model. Whitelisted
 * primitives (graphing, sliders, lists, regression, restrictions, derivatives,
 * statistics) cost 0 and are not counted; newPrimitives counts Desmos features
 * outside that whitelist. This is the reading under which the spec's own
 * sanity check holds exactly: the slider-until-parallel method totals 4 and the
 * slope-only derivative regression totals 10.
 */
export type ReportedCost = {
  derivationSteps: number;
  newPrimitives: number;
  oneOffFacts: number;
  setupConstructions: number;
  manualIterations: number;
};

export type Cost = ReportedCost & { rows: number };

/** total = rows + 3·derivation + 2·primitives + 4·one-off facts + setup + iterations */
export function totalCost(cost: Cost): number {
  return (Object.keys(COST_WEIGHTS) as (keyof Cost)[]).reduce(
    (sum, key) => sum + COST_WEIGHTS[key] * cost[key],
    0,
  );
}

/**
 * Floors the server can justify from the technique's definition, since models
 * under-count their own paper work: a paper technique needs at least its
 * defining written steps (elimination: scale, then combine), a method with no
 * calculator rows at least one step (unless the task is the translation
 * itself), and a technique defined by a memorized fact uses that fact.
 */
export function deriveCost(
  reported: ReportedCost,
  rowCount: number,
  techniqueId: TechniqueId,
): Cost {
  const technique = getTechnique(techniqueId);
  const handWork = rowCount === 0 && techniqueId !== "translate-the-words" ? 1 : 0;
  const derivationFloor = Math.max(handWork, technique.minSteps ?? 0);
  const factFloor = technique.fact ? 1 : 0;
  return {
    rows: rowCount,
    ...reported,
    derivationSteps: Math.max(reported.derivationSteps, derivationFloor),
    oneOffFacts: Math.max(reported.oneOffFacts, factFloor),
  };
}

export function mathScore(cost: Pick<Cost, "derivationSteps" | "oneOffFacts">): number {
  return cost.derivationSteps + cost.oneOffFacts;
}

export type MathLevel = "low" | "medium" | "high";

export function mathLevel(score: number): MathLevel {
  if (score <= 0) return "low";
  if (score <= 2) return "medium";
  return "high";
}

export const BADGES = ["Recommended", "Least math", "Most Desmos", "Fewest steps"] as const;
export type Badge = (typeof BADGES)[number];

type Row = { latex: string; slider?: unknown };

/** The single most distinctive Desmos primitive a plan uses, for the shape line. */
export function primaryPrimitive(rows: readonly Row[]): string | null {
  const latex = rows.map((row) => row.latex);
  const any = (pattern: RegExp) => latex.some((text) => pattern.test(text));
  const regression = any(/\\sim(?![A-Za-z])|~/);
  if (regression && any(/'/)) return "derivative regression";
  if (regression) return "regression";
  if (any(/\\operatorname\{count\}|\]\s*\[|[A-Za-z](?:_\{[^{}]*\})?\s*\[[^\]]*[<>=]/)) return "list filter";
  if (rows.some((row) => row.slider)) return "slider";
  if (any(/\\left\\?\{|\{[^{}]*[<>≤≥][^{}]*\}\s*$/)) return "restriction";
  if (any(/'/)) return "derivative";
  if (any(/\\operatorname\{(?:mean|median|stdev|stdevp|total|quartile|var|varp)\}/)) return "statistics";
  const builtin = latex.join(" ").match(/\\operatorname\{(distance|midpoint|polygon|repeat|mod|gcd|lcm|ceil|floor)\}/);
  if (builtin) return `${builtin[1]}()`;
  if (any(/\[/)) return "list";
  if (any(/(?<![A-Za-z\\])y(?![A-Za-z0-9])|(?<![A-Za-z\\])x(?![A-Za-z0-9])/)) return "graph";
  return null;
}

/** "3 rows · slider · no algebra", "1 row · quadratic formula · no algebra". */
export function describeShape(input: {
  techniqueId: TechniqueId;
  rows: readonly Row[];
  cost: Cost;
}): string {
  const technique = getTechnique(input.techniqueId);
  const rowCount = input.rows.length;
  const rowsLabel = rowCount === 0 ? "no calculator" : `${rowCount} row${rowCount === 1 ? "" : "s"}`;
  const tool =
    technique.fact && input.cost.oneOffFacts > 0
      ? technique.fact
      : (technique.source === "standard" || rowCount === 0
          ? technique.name.toLowerCase()
          : primaryPrimitive(input.rows) ?? technique.name.toLowerCase());
  const steps = input.cost.derivationSteps;
  const algebra = steps === 0 ? "no algebra" : `${steps} algebra step${steps === 1 ? "" : "s"}`;
  return [rowsLabel, tool, algebra].join(" · ");
}

export type Rankable = {
  id: string;
  techniqueId: TechniqueId;
  rung: number;
  cost: Cost;
  total: number;
  mathScore: number;
};

/**
 * Deterministic order: cheapest total first, then least math, then the lower
 * simplicity-ladder rung, then fewer rows, then the technique id. The same
 * candidate set always sorts the same way regardless of emission order.
 */
export function compareMethods(left: Rankable, right: Rankable): number {
  return (
    left.total - right.total ||
    left.mathScore - right.mathScore ||
    left.rung - right.rung ||
    left.cost.rows - right.cost.rows ||
    (left.techniqueId < right.techniqueId ? -1 : left.techniqueId > right.techniqueId ? 1 : 0)
  );
}

/**
 * Badges over methods already sorted by compareMethods (winner first). Each
 * badge has exactly one holder: the best-ranked method achieving the minimum.
 * "Fewest steps" is defined as lowest total cost, so it always coincides with
 * "Recommended" (the argmin winner).
 */
export function assignBadges<T extends Rankable>(ranked: readonly T[]): Map<string, Badge[]> {
  const badges = new Map<string, Badge[]>(ranked.map((method) => [method.id, []]));
  if (ranked.length === 0) return badges;
  const holder = (value: (method: T) => number) =>
    ranked.reduce((best, method) => (value(method) < value(best) ? method : best), ranked[0]);
  const award = (method: T, badge: Badge) => badges.get(method.id)!.push(badge);
  award(ranked[0], "Recommended");
  award(holder((method) => method.mathScore), "Least math");
  award(holder((method) => method.cost.derivationSteps), "Most Desmos");
  award(holder((method) => method.total), "Fewest steps");
  return badges;
}
