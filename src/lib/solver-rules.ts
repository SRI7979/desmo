import { analyzePlan } from "./desmos-latex";
import type { ConditionType, DistinguishMethod, Parameter, Solution } from "./solver-schema";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REGRESSION_OP = /\\sim(?![A-Za-z])|~/;

function mentionsIdentifier(text: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z\\\\])${escapeRegExp(name)}(?![A-Za-z0-9{])`).test(text);
}

/** The `{condition}` (or `\left\{condition\right\}`) restriction at the end of a row, if any. */
function trailingRestriction(latex: string): string | null {
  const match = latex.match(/\\left\\?\{([^{}]*)\\right\\?\}\s*$/) ?? latex.match(/\{([^{}]*)\}\s*$/);
  return match ? match[1] : null;
}

/*
 * ================================================================================
 * RULE 1 — integer conditions must be encoded as integers
 * ================================================================================
 * `{a > 1}` bounds the feasible region a regression searches; it does not tell
 * Desmos the fitted value must be a whole number, so the optimizer can (and
 * does) land on a=2.37. A parameter the problem declares integer must instead
 * be introduced as an integer list or an integer-step slider (PHILOSOPHY.md
 * task spec, "three solver validation rules").
 */

const INEQUALITY_ONLY =
  /^\s*[A-Za-z](?:_\{[^{}]*\}|_[A-Za-z0-9])?\s*(?:>=|<=|>|<|\\ge|\\le)\s*-?\d+(?:\.\d+)?\s*$/;

export type IntegerParameterViolation = { row: number; param: string };

export function findIntegerParameterViolations(
  expressions: ReadonlyArray<{
    latex: string;
    slider?: { min: number; max: number; step: number } | null;
  }>,
  parameters: readonly Parameter[],
): IntegerParameterViolation[] {
  const violations: IntegerParameterViolation[] = [];
  for (const param of parameters) {
    if (!param.integer) continue;
    const sliderDefinition = new RegExp(`^\\s*${escapeRegExp(param.name)}\\s*=\\s*-?\\d+(?:\\.\\d+)?\\s*$`);
    const listDefinition = new RegExp(`^\\s*${escapeRegExp(param.name)}\\s*=\\s*(?:\\\\left\\s*)?\\[`);
    let encoded = false;
    let offendingRow: number | null = null;

    expressions.forEach((expression, index) => {
      if (encoded) return;
      const { latex, slider } = expression;
      if (sliderDefinition.test(latex)) {
        const validSlider =
          Boolean(slider) && slider!.step === 1 && Number.isInteger(slider!.min) && Number.isInteger(slider!.max);
        if (validSlider) encoded = true;
        else offendingRow ??= index + 1;
        return;
      }
      if (listDefinition.test(latex)) {
        encoded = true;
        return;
      }
      if (REGRESSION_OP.test(latex)) {
        const restriction = trailingRestriction(latex);
        if (restriction && mentionsIdentifier(restriction, param.name) && INEQUALITY_ONLY.test(restriction)) {
          offendingRow ??= index + 1;
        }
      }
    });

    if (!encoded && offendingRow !== null) violations.push({ row: offendingRow, param: param.name });
  }
  return violations;
}

/*
 * ================================================================================
 * RULE 2 — regressions must be determined
 * ================================================================================
 * A regression with more free parameters than data constraints has infinitely
 * many exact fits; Desmos's optimizer stops on one of them arbitrarily. Count
 * each row's free (fitted) symbols against the length of the list(s) it fits.
 * Inequality restrictions bound the search; they never pin a value, so they
 * do not count as constraints.
 */

function balancedSplit(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** name=[...] declarations anywhere in the plan, with their element counts. */
function declaredListLengths(expressions: ReadonlyArray<{ latex: string }>): Map<string, number> {
  const lengths = new Map<string, number>();
  const declaration = /^\s*([A-Za-z](?:_\{[^{}]*\}|_[A-Za-z0-9])?)\s*=\s*(?:\\left\s*)?\[([\s\S]*)\]\s*$/;
  for (const { latex } of expressions) {
    const match = latex.replace(/\\right\s*$/, "").match(declaration);
    if (!match || /\.\.\./.test(match[2])) continue; // an open-ended range is not a fixed-length fit target
    const count = balancedSplit(match[2], ",").filter((part) => part.trim()).length;
    if (count > 0) lengths.set(match[1], count);
  }
  return lengths;
}

/** The number of residual equations a `~` side supplies: its own literal bracket length, or a referenced declared list's length. */
function sideConstraintCount(side: string, declaredLengths: ReadonlyMap<string, number>): number | null {
  const trimmed = side.trim().replace(/^\\left\s*/, "").replace(/\\right\s*$/, "");
  const bareList = trimmed.match(/^\[([\s\S]*)\]$/);
  if (bareList) {
    if (/\.\.\./.test(bareList[1])) return null;
    return balancedSplit(bareList[1], ",").filter((part) => part.trim()).length;
  }
  for (const [name, length] of declaredLengths) {
    if (mentionsIdentifier(side, name)) return length;
  }
  return null;
}

export type RegressionDeterminacyViolation =
  | { row: number; kind: "underdetermined"; freeParams: number; constraints: number; params: string[] }
  | { row: number; kind: "mismatched_lists"; lengths: Record<string, number> };

export function findRegressionDeterminacyViolations(
  expressions: ReadonlyArray<{ latex: string }>,
): RegressionDeterminacyViolation[] {
  const { rows, defined, isKnown } = analyzePlan(expressions);
  const declaredLengths = declaredListLengths(expressions);
  const violations: RegressionDeterminacyViolation[] = [];

  rows.forEach((row, index) => {
    if (!row.isRegression) return;
    const withoutRestriction = row.latex
      .replace(/\\left\\?\{[^{}]*\\right\\?\}\s*$/, "")
      .replace(/\{[^{}]*\}\s*$/, "");
    const sides = withoutRestriction.split(REGRESSION_OP);
    if (sides.length !== 2) return; // malformed; other checks handle syntax errors
    const [left, right] = sides;

    const referencedLists = new Map<string, number>();
    for (const [name, length] of declaredLengths) {
      if (mentionsIdentifier(left, name) || mentionsIdentifier(right, name)) referencedLists.set(name, length);
    }
    if (new Set(referencedLists.values()).size > 1) {
      violations.push({ row: index + 1, kind: "mismatched_lists", lengths: Object.fromEntries(referencedLists) });
      return;
    }

    // The free parameters this row's regression introduces: names it uses
    // that are not coordinates/constants and not resolved by an earlier
    // definition (a declared data list resolves to its own, typically empty,
    // free set, so data columns are correctly excluded here).
    const free = new Set<string>();
    const seen = new Set<string>();
    const walk = (names: Iterable<string>) => {
      for (const name of names) {
        if (isKnown(name) || seen.has(name)) continue;
        seen.add(name);
        const definition = defined.get(name);
        if (definition) walk(definition.free);
        else free.add(name);
      }
    };
    walk(row.names);
    if (free.size === 0) return;

    const constraintCandidates = [left, right]
      .map((side) => sideConstraintCount(side, declaredLengths))
      .filter((count): count is number => count !== null);
    if (constraintCandidates.length === 0) return; // no evidence either way; do not false-positive
    const constraints = Math.max(...constraintCandidates);

    if (free.size > constraints) {
      violations.push({
        row: index + 1,
        kind: "underdetermined",
        freeParams: free.size,
        constraints,
        params: [...free].sort(),
      });
    }
  });

  return violations;
}

/*
 * ================================================================================
 * RULE 3 — condition completeness for conditional-system questions
 * ================================================================================
 * "No solution" and "infinitely many solutions" share the same proportionality
 * setup (matching coefficients/slopes); they differ only in whether the
 * constants scale along too. A method that checks only the coefficients has
 * verified a necessary but not sufficient condition. Repair by augmentation:
 * if the plan already graphs both original equations at the answer value, the
 * distinction is visible and passes; otherwise it must be added.
 */

function isGraphableEquation(latex: string): boolean {
  const bare = latex.replace(/\\(?:left|right)/g, "");
  // \b treats a digit and a following letter as one word ("7x" has no
  // boundary before x), so a coefficient like 7x would otherwise be missed.
  const hasX = /(?<![A-Za-z])x(?![A-Za-z0-9])/.test(bare);
  const hasY = /(?<![A-Za-z])y(?![A-Za-z0-9])/.test(bare);
  return hasX && hasY && !REGRESSION_OP.test(bare);
}

export function checkConditionCompleteness(input: {
  conditionType: ConditionType | null;
  distinguishes: DistinguishMethod | null;
  result: Solution["result"];
  answerState: Solution["answerState"];
  expressions: ReadonlyArray<{ latex: string }>;
}): { distinguishes: DistinguishMethod } | { error: string } | null {
  if (input.conditionType === null) return null;
  if (input.distinguishes !== null) return { distinguishes: input.distinguishes };

  const result = input.result;
  const graphRows =
    result && "type" in result && (result.type === "graph_overlap" || result.type === "intersection")
      ? [result.row, ...result.relatedRows].filter((row): row is number => row !== null)
      : [];
  const distinctGraphRows = [...new Set(graphRows)];
  const bothEquationsGraphed =
    distinctGraphRows.length >= 2 &&
    input.answerState !== null &&
    distinctGraphRows.every((row) => isGraphableEquation(input.expressions[row - 1]?.latex ?? ""));

  if (bothEquationsGraphed) return { distinguishes: "visual-parallel-vs-overlap" };

  const conditionLabel = input.conditionType === "no-solution" ? "no solution" : "infinitely many solutions";
  return {
    error:
      `This question asks for a parameter value that makes the system have ${conditionLabel}. Matching slopes ` +
      "or coefficient ratios alone is necessary but not sufficient: it is equally satisfied by the OPPOSITE " +
      "condition (two coincident lines vs. two distinct parallel lines). Make the distinction observable: graph " +
      "BOTH original equations with the parameter set to the answer value (set answerState so the slider opens " +
      "there) and set result.type to graph_overlap naming both rows, so a parallel-but-distinct pair looks " +
      'visibly different from one line drawn twice, then set distinguishes to "visual-parallel-vs-overlap". ' +
      "Alternatively, if the method checks in the write-up that the constants do not scale by the same factor " +
      'as the coefficients, set distinguishes to "constant-ratio-checked".',
  };
}
