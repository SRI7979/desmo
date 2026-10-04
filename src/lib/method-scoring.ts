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

export const BADGES = ["Recommended", "Least math", "Most Desmos", "Fewest steps", "Most algebra"] as const;
export type Badge = (typeof BADGES)[number];

/** What the student physically does: rows typed, written steps, slider drags or re-edits. */
export function studentSteps(cost: Pick<Cost, "rows" | "derivationSteps" | "manualIterations">): number {
  return cost.rows + cost.derivationSteps + cost.manualIterations;
}

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

/**
 * The kind of thinking a technique teaches, for grouping alternatives and for
 * measuring whether the listed methods are genuinely different. Derived from
 * the technique and its rows, never reported by the model.
 */
export const METHOD_FAMILIES = ["visual", "regression", "list-slider", "answer-choices", "calculator", "traditional", "translation"] as const;
export type MethodFamily = (typeof METHOD_FAMILIES)[number];

const ANSWER_CHOICE_TECHNIQUES: ReadonlySet<TechniqueId> = new Set<TechniqueId>(["answer-choice-list", "strategic-value-test", "graph-each-choice", "choice-window", "plug-in-choices"]);

export function methodFamily(techniqueId: TechniqueId, rows: readonly Row[]): MethodFamily {
  if (techniqueId === "translate-the-words") return "translation";
  if (rows.length === 0) return "traditional";
  if (ANSWER_CHOICE_TECHNIQUES.has(techniqueId)) return "answer-choices";
  const primitive = primaryPrimitive(rows);
  if (primitive === "regression" || primitive === "derivative regression") return "regression";
  if (primitive === "list filter" || primitive === "list" || primitive === "slider") return "list-slider";
  if (primitive === "graph" || primitive === "restriction" || primitive === "derivative") return "visual";
  return "calculator";
}

/** The rows a student would type, whitespace-insensitive: two methods with the same signature are one method. */
export function rowSignature(rows: readonly Row[]): string {
  return rows.map((row) => row.latex.replace(/\\left|\\right|\s+/g, "")).join("\n");
}

export type Rankable = {
  id: string;
  techniqueId: TechniqueId;
  rung: number;
  cost: Cost;
  total: number;
  mathScore: number;
  rows?: readonly Row[];
};

/** The technique a distinctive primitive teaches by name; generic graphs and lists name none. */
const PRIMITIVE_TECHNIQUE: Readonly<Record<string, TechniqueId>> = {
  "derivative regression": "derivative-regression",
  statistics: "statistics-builtin",
  "distance()": "distance-builtin",
  "midpoint()": "midpoint-builtin",
  "polygon()": "polygon-area",
  "repeat()": "frequency-repeat",
  "mod()": "number-theory-builtin",
  "gcd()": "number-theory-builtin",
  "lcm()": "number-theory-builtin",
  "ceil()": "ceil-floor",
  "floor()": "ceil-floor",
};

/** 0 when the rows' most distinctive primitive is the one the technique is named for, else 1. */
function nameMismatch(method: Rankable): number {
  if (!method.rows) return 1;
  const primitive = primaryPrimitive(method.rows);
  return primitive !== null && PRIMITIVE_TECHNIQUE[primitive] === method.techniqueId ? 0 : 1;
}

/**
 * Deterministic order: cheapest total first, then least math, then a method
 * that works without the answer choices (PHILOSOPHY.md: at equal effort the
 * generalizable method transfers to the next problem), then the lower
 * simplicity-ladder rung, then fewer rows, then the technique its rows
 * visibly use (mean(L) - median(L) is the statistics built-in, not "evaluate
 * over a list"), then the technique id. The same candidate set always sorts
 * the same way regardless of emission order.
 */
export function compareMethods(left: Rankable, right: Rankable): number {
  return (
    left.total - right.total ||
    left.mathScore - right.mathScore ||
    Number(ANSWER_CHOICE_TECHNIQUES.has(left.techniqueId)) - Number(ANSWER_CHOICE_TECHNIQUES.has(right.techniqueId)) ||
    left.rung - right.rung ||
    left.cost.rows - right.cost.rows ||
    nameMismatch(left) - nameMismatch(right) ||
    (left.techniqueId < right.techniqueId ? -1 : left.techniqueId > right.techniqueId ? 1 : 0)
  );
}

type BadgeDimension = {
  badge: Exclude<Badge, "Recommended">;
  /** null: the method does not compete on this dimension. */
  value: (method: Rankable) => number | null;
  best: "min" | "max";
};

/**
 * In precedence order: a method that leads several dimensions shows only the
 * first. "Most Desmos" is the highest simplicity-ladder rung among calculator
 * methods (sliders, lists, regressions, derivatives); "Most algebra" is the
 * most written steps among methods that have any.
 */
const BADGE_DIMENSIONS: readonly BadgeDimension[] = [
  { badge: "Least math", value: (method) => method.mathScore, best: "min" },
  { badge: "Most Desmos", value: (method) => (method.cost.rows > 0 ? method.rung : null), best: "max" },
  { badge: "Fewest steps", value: (method) => studentSteps(method.cost), best: "min" },
  { badge: "Most algebra", value: (method) => (method.cost.derivationSteps > 0 ? method.cost.derivationSteps : null), best: "max" },
];

/** The unique best method on one dimension; a tie goes to the lower total, and a tie there to no one. */
function strictLeader<T extends Rankable>(methods: readonly T[], dimension: BadgeDimension): T | null {
  const scored = methods.flatMap((method) => {
    const value = dimension.value(method);
    return value === null ? [] : [{ method, score: dimension.best === "min" ? value : -value }];
  });
  if (scored.length === 0) return null;
  const best = Math.min(...scored.map((item) => item.score));
  const leaders = scored.filter((item) => item.score === best).map((item) => item.method);
  if (leaders.length === 1) return leaders[0];
  const cheapest = Math.min(...leaders.map((method) => method.total));
  const cheapestLeaders = leaders.filter((method) => method.total === cheapest);
  return cheapestLeaders.length === 1 ? cheapestLeaders[0] : null;
}

/**
 * Badges over the methods the student can pick, already sorted by
 * compareMethods (winner first). Badges must discriminate:
 *   - "Recommended" is the argmin winner's, and only the winner's.
 *   - Every other badge goes to exactly one method, the strict leader on its
 *     dimension, or to none on an unbreakable tie.
 *   - A badge that would land on the winner is suppressed: winning already
 *     says it, and repeating it is noise.
 *   - A method that leads several dimensions shows only the first.
 * So the winner shows exactly one badge, and every other method zero or one.
 */
export function assignBadges<T extends Rankable>(ranked: readonly T[]): Map<string, Badge[]> {
  const badges = new Map<string, Badge[]>(ranked.map((method) => [method.id, []]));
  if (ranked.length === 0) return badges;
  const winner = ranked[0];
  badges.get(winner.id)!.push("Recommended");
  for (const dimension of BADGE_DIMENSIONS) {
    const leader = strictLeader(ranked, dimension);
    if (!leader || leader.id === winner.id) continue;
    const held = badges.get(leader.id)!;
    if (held.length === 0) held.push(dimension.badge);
  }
  return badges;
}
