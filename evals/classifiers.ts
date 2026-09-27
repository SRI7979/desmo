/**
 * Method-quality classifiers for the eval harness (evals/run-evals.mts).
 *
 * There is no machine-readable method taxonomy in the current (Phase 1)
 * solver output, so these are structural heuristics over the returned
 * Solution (expressions, trick name, result type, parameters). They are
 * deliberately generous rather than exact-match: a false "acceptable" is
 * cheaper than a false "forbidden", since forbiddenHit is the metric meant
 * to catch real regressions. Read the per-problem notes field for the
 * reasoning a human should apply when auditing borderline runs by hand.
 */
import { findRegressionDeterminacyViolations, checkConditionCompleteness } from "../src/lib/solver-rules";
import type { Solution } from "../src/lib/solver-schema";

const REGRESSION_OP = /\\sim(?![A-Za-z])|~/;

function hasRegression(solution: Solution): boolean {
  return solution.expressions.some((e) => REGRESSION_OP.test(e.latex));
}

function hasRestriction(solution: Solution): boolean {
  return solution.expressions.some((e) => /\\left\\?\{[^{}]*\\right\\?\}|(?<!\\left)\{[^{}]*\}\s*$/.test(e.latex));
}

function hasIntegerParameterEncoded(solution: Solution): boolean {
  const integerNames = (solution.parameters ?? []).filter((p) => p.integer).map((p) => p.name);
  if (integerNames.length === 0) return false;
  return integerNames.every((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const listPattern = new RegExp(`^\\s*${escaped}\\s*=\\s*(?:\\\\left\\s*)?\\[`);
    const slidered = solution.expressions.some((e) => {
      if (!new RegExp(`^\\s*${escaped}\\s*=\\s*-?\\d+(?:\\.\\d+)?\\s*$`).test(e.latex)) return false;
      const slider = "slider" in e ? e.slider : null;
      return Boolean(slider && slider.step === 1 && Number.isInteger(slider.min) && Number.isInteger(slider.max));
    });
    const listed = solution.expressions.some((e) => listPattern.test(e.latex));
    return slidered || listed;
  });
}

function isConceptual(solution: Solution): boolean {
  return solution.expressions.length === 0 && solution.method !== "desmos";
}

function isUnderdetermined(solution: Solution): boolean {
  return findRegressionDeterminacyViolations(solution.expressions).length > 0;
}

function isSlopeMatchOnlyViolation(solution: Solution): boolean {
  const check = checkConditionCompleteness({
    conditionType: solution.conditionType,
    distinguishes: solution.distinguishes,
    result: solution.result,
    answerState: solution.answerState,
    expressions: solution.expressions,
  });
  return Boolean(check && "error" in check);
}

function hasGraphOverlapOfBoth(solution: Solution): boolean {
  const result = solution.result;
  if (!result || !("type" in result)) return false;
  if (result.type !== "graph_overlap" && result.type !== "intersection") return false;
  return new Set([result.row, ...result.relatedRows].filter((r): r is number => r !== null)).size >= 2;
}

function usesArithmeticOnly(solution: Solution): boolean {
  return solution.expressions.length > 0 && !hasRegression(solution) && solution.expressions.every((e) => !/=\s*(?:\\left\s*)?\[/.test(e.latex));
}

/** Any bare "name=[...]" declaration, regardless of whether `parameters` was populated. */
function hasDeclaredList(solution: Solution): boolean {
  return solution.expressions.some((e) => /^\s*[A-Za-z](?:_\{[^{}]*\})?\s*=\s*(?:\\left\s*)?\[/.test(e.latex));
}

/** A written (no-calculator) plan that isn't claiming to be a Desmos method. */
function isWrittenPlan(solution: Solution): boolean {
  return solution.expressions.length === 0;
}

export type Verdict = { intendedOrAcceptable: boolean; forbidden: boolean; forbiddenReason?: string };

export type Classifier = (solution: Solution) => Verdict;

function verdict(intendedOrAcceptable: boolean, forbidden: boolean, forbiddenReason?: string): Verdict {
  return { intendedOrAcceptable, forbidden, forbiddenReason };
}

export const CLASSIFIERS: Record<string, Classifier> = {
  "001-quadratic-three-points": (s) => {
    const forbidden = isUnderdetermined(s);
    return verdict(hasRegression(s) && !forbidden, forbidden, "underdetermined regression");
  },

  "002-quadratic-inequality-integer-count": (s) => {
    const listOrRestriction = s.expressions.some((e) => /=\s*(?:\\left\s*)?\[/.test(e.latex)) || hasRestriction(s);
    return verdict(listOrRestriction, false);
  },

  "003-representation-linear-model": (s) => {
    const forbidden = !isConceptual(s);
    return verdict(isConceptual(s), forbidden, "solved/graphed instead of just selecting the model");
  },

  "004-factor-shared-zero-integer-slider": (s) => {
    const sharedZero = s.expressions.some((e) => /^\s*y\s*=/.test(e.latex)) || hasIntegerParameterEncoded(s) ||
      s.expressions.some((e) => e.slider) || hasDeclaredList(s);
    // A bare "b=<number>" definition with no slider/list at all is the forbidden derived-formula shape.
    const derivedFormula = s.expressions.some((e) => /^\s*b\s*=\s*-?\d+(?:\.\d+)?\s*\/?/.test(e.latex) && !e.slider) &&
      !s.expressions.some((e) => e.slider) && !hasDeclaredList(s);
    return verdict(sharedZero && !derivedFormula, derivedFormula, "derived b by a formula instead of a slider/list shared zero");
  },

  "005-constraint-regression-intersection": (s) => {
    const graphsNonCoordinateUnknowns = s.expressions.some((e) => /^\s*(?:q|w)\s*=/.test(e.latex.replace(/\\left|\\right/g, "")) === false &&
      /\by\b\s*=/.test(e.latex) && /\bq\b/.test(e.latex));
    const forbidden = graphsNonCoordinateUnknowns;
    return verdict(hasRegression(s) && !forbidden, forbidden, "graphed q/w as if they were coordinates");
  },

  "006-identity-regression-r-plus-s": (s) => {
    const answer = s.answer.replace(/^[A-H][).:]\s*/, "").trim();
    const forbidden = /^403(?:\.0+)?$/.test(answer);
    return verdict(hasRegression(s) && !forbidden, forbidden, "reported the intermediate parameter 403 instead of r+s=406");
  },

  "007-infinitely-many-ratio": (s) => {
    const forbidden = hasRegression(s);
    // A written proportional-ratio explanation needs no calculator at all;
    // that is the intended "two arithmetic rows or less" shape taken to its
    // logical extreme, not a different, worse method.
    return verdict((usesArithmeticOnly(s) || isWrittenPlan(s)) && !forbidden, forbidden, "used a regression where arithmetic (or a written ratio) suffices");
  },

  "008-restricted-domain-minimum": (s) => {
    const sampledIntegers = s.expressions.some((e) => /=\s*(?:\\left\s*)?\[\s*2\s*,\s*3/.test(e.latex));
    const forbidden = sampledIntegers && !hasRestriction(s);
    // Evaluating f at the domain endpoint directly is an equally valid,
    // simpler route than graphing a restriction, as long as it isn't
    // discretely sampling a continuous domain.
    const validReadout = s.result !== null && "type" in s.result && ["vertex", "numeric", "x_intercept"].includes(s.result.type);
    return verdict((hasRestriction(s) || validReadout) && !forbidden, forbidden, "discretely sampled the continuous domain instead of graphing it restricted");
  },

  "009-integer-list-coefficient-read": (s) => {
    const forbidden = isUnderdetermined(s);
    // The problem's own acceptableMethods are broad (derivative read,
    // evaluate-at-1-minus-0, answer-choice testing); the only real defect
    // this problem cares about is an underdetermined regression reaching output.
    return verdict(!forbidden, forbidden, "underdetermined regression on the integer-constrained parameter a");
  },

  "010-infinite-solutions-gk-ratio": (s) => {
    const forbidden = hasRegression(s) && isUnderdetermined(s);
    return verdict((usesArithmeticOnly(s) || hasRegression(s) || isWrittenPlan(s)) && !forbidden, forbidden);
  },

  "011-no-solution-slider-both-graphed": (s) => {
    const forbidden = isSlopeMatchOnlyViolation(s);
    return verdict(hasGraphOverlapOfBoth(s) && !forbidden, forbidden, "matched slopes only, without graphing both original equations to rule out the coincident case");
  },

  "012-circle-radius": (s) => {
    const original = s.expressions.some((e) => /x\^2.*y\^2.*-6.*x.*4.*y.*-12/.test(e.latex.replace(/\s/g, "")) || /x\^\{?2\}?\+y\^\{?2\}?/.test(e.latex.replace(/\s/g, "")));
    const forbidden = s.expressions.some((e) => /\(x-3\)/.test(e.latex) || /\(y\+2\)/.test(e.latex)) && !original;
    return verdict(original || hasRegression(s), forbidden, "hand-completed the square instead of graphing/fitting the original equation");
  },

  "013-trig-intersection": (s) => {
    const bothGraphed = s.expressions.filter((e) => /^\s*y\s*=/.test(e.latex)).length >= 2;
    // Graphing the difference (y=sin(x)-cos(2x), or a named h(x)=...) and
    // reading its root is the same technique as graphing both sides and
    // reading the intersection — just one row instead of two.
    const differenceRoot =
      s.expressions.some((e) => /(?:sin|cos)[\s\S]*(?:sin|cos)/i.test(e.latex) && /=/.test(e.latex)) &&
      s.result !== null &&
      "type" in s.result &&
      (s.result.type === "x_intercept" || s.result.type === "numeric");
    const forbidden = !bothGraphed && !differenceRoot && s.method !== "desmos";
    return verdict(bothGraphed || differenceRoot, forbidden, "solved the double-angle identity by hand instead of graphing");
  },

  "014-stdev-list": (s) => {
    const usesStdev = s.expressions.some((e) => /\\operatorname\{stdev/.test(e.latex));
    const forbidden = s.method !== "desmos" || (!usesStdev && s.expressions.length > 0 === false);
    return verdict(usesStdev, forbidden && !usesStdev, "computed the standard deviation by hand instead of a list stdev call");
  },

  "015-two-way-table-probability": (s) => {
    const forbidden = hasRegression(s) || s.expressions.some((e) => /=\s*(?:\\left\s*)?\[/.test(e.latex));
    return verdict(usesArithmeticOnly(s) || s.expressions.length === 0, forbidden, "used an unnecessary list/regression for a single ratio");
  },
};

export function classify(problemId: string, solution: Solution): Verdict {
  const classifier = CLASSIFIERS[problemId];
  if (!classifier) throw new Error(`No classifier registered for problem ${problemId}`);
  return classifier(solution);
}

export function methodTagOf(solution: Solution): string {
  return solution.trick?.trim() || "(no trick name)";
}

// ---- Answer comparison -------------------------------------------------

function normalizeAnswerText(raw: string): string {
  return raw.replace(/^[A-H][).:]\s*/, "").trim();
}

function parseNumeric(text: string): number | null {
  const fraction = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * A model sometimes writes both forms of a grid-in answer, e.g. "5/8 (0.625)"
 * or "5/8 or 0.625" — mathematically one correct value, not two candidates.
 * Extract every fraction/decimal token so either notation is recognized.
 */
function extractNumericCandidates(text: string): number[] {
  const pattern = /-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?/g;
  const values: number[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = parseNumeric(match[0].trim());
    if (value !== null) values.push(value);
  }
  return values;
}

export function answerMatches(returned: string, correct: string): boolean {
  const a = normalizeAnswerText(returned);
  const b = normalizeAnswerText(correct);
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const target = parseNumeric(b);
  if (target === null) return false;
  return extractNumericCandidates(a).some((value) => Math.abs(value - target) < 0.02);
}
