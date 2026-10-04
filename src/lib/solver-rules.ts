import { analyzePlan } from "./desmos-latex";
import type { ConditionType, DistinguishMethod, Parameter, Solution } from "./solver-schema";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REGRESSION_OP = /\\sim(?![A-Za-z])|~/;

function mentionsIdentifier(text: string, name: string): boolean {
  // a_{1} is a different identifier from a.
  return new RegExp(`(?<![A-Za-z\\\\])${escapeRegExp(name)}(?![A-Za-z0-9{_])`).test(text);
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

const TRAILING_RESTRICTION_TEXT = /\\left\\?\{[^{}]*\\right\\?\}\s*$|\{[^{}]*\}\s*$/;

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
      // A regression that fits the parameter introduces it as a continuous
      // unknown: with only an inequality restriction, or with none at all,
      // nothing makes Desmos return a whole number.
      if (REGRESSION_OP.test(latex) && mentionsIdentifier(latex.replace(TRAILING_RESTRICTION_TEXT, ""), param.name)) {
        offendingRow ??= index + 1;
      } else if (REGRESSION_OP.test(latex)) {
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

/** \left and \right only size delimiters; list and call structure is identical without them. */
function stripDelimiters(latex: string): string {
  return latex.replace(/\\(?:left|right)\s*/g, "");
}

/** The index of the ] that closes the [ at `open`, or -1. */
function bracketEnd(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) {
      depth--;
      if (depth === 0) return char === "]" ? index : -1;
    }
  }
  return -1;
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

/** The element count of a `~` side that is a bare, fixed-length list literal ([a,b]), else null. */
function literalSideLength(side: string): number | null {
  const trimmed = stripDelimiters(side).trim();
  const bareList = trimmed.match(/^\[([\s\S]*)\]$/);
  if (!bareList || /\.\.\.|\bfor\b/.test(bareList[1])) return null;
  if (bracketEnd(trimmed, 0) !== trimmed.length - 1) return null; // [a][b], not one literal
  return balancedSplit(bareList[1], ",").filter((part) => part.trim()).length;
}

export type RegressionDeterminacyViolation =
  | { row: number; kind: "underdetermined"; freeParams: number; constraints: number; params: string[] }
  | { row: number; kind: "mismatched_lists"; lengths: Record<string, number> };

/** Identifier tokens (a, y_{1}, x_1) with their positions, outside \operatorname{...} and other commands. */
function identifierTokens(latex: string): { name: string; start: number; end: number }[] {
  const tokens: { name: string; start: number; end: number }[] = [];
  const pattern = /\\[A-Za-z]+(?:\{[^{}]*\})?|([A-Za-z](?:_\{[A-Za-z0-9]+\}|_[A-Za-z0-9])?)/g;
  for (const match of latex.matchAll(pattern)) {
    if (!match[1]) continue;
    tokens.push({ name: match[1].replace(/_([A-Za-z0-9])$/, "_{$1}"), start: match.index!, end: match.index! + match[0].length });
  }
  return tokens;
}

/** Maximal runs of juxtaposed identifiers ("sy_{1}" is [s, y_{1}]); a run touching ^, (, or a command is not a plain product. */
function productRuns(latex: string): string[][] {
  const tokens = identifierTokens(latex);
  const runs: { names: string[]; start: number; end: number }[] = [];
  for (const token of tokens) {
    const last = runs.at(-1);
    if (last && last.end === token.start) {
      last.names.push(token.name);
      last.end = token.end;
    } else runs.push({ names: [token.name], start: token.start, end: token.end });
  }
  return runs.map((run) => (/^[\^(\\]/.test(latex.slice(run.end)) || /\\[A-Za-z]*$/.test(latex.slice(0, run.start)) ? [...run.names, "\u0000"] : run.names));
}

/**
 * Free parameters that only ever appear multiplied together, in every row of
 * the plan (s and y_{1} in 7rx_{1}+12sy_{1}): the data can only fix their
 * product, so they are one degree of freedom, and the requested parameter
 * (r) can still be identified. Never merged when any row uses one of them
 * on its own (a readout of s would show an arbitrary split of the product).
 */
function productMerges(rows: readonly string[], free: ReadonlySet<string>): number {
  const runs = rows.flatMap(productRuns);
  const partners = new Map<string, Set<string>>();
  for (const name of free) {
    const containing = runs.filter((run) => run.includes(name));
    if (!containing.length) continue;
    // The free parameters beside this one in EVERY run that contains it.
    const together = containing.some((run) => run.includes("\u0000"))
      ? new Set<string>()
      : containing
          .map((run) => new Set(run.filter((other) => other !== name && free.has(other))))
          .reduce((common, others) => new Set([...common].filter((other) => others.has(other))));
    if (together.size) partners.set(name, together);
  }
  // Merge mutually inseparable parameters into groups; each group of k counts once.
  const seen = new Set<string>();
  let merges = 0;
  for (const [name, group] of partners) {
    if (seen.has(name)) continue;
    const members = [name, ...[...group].filter((other) => partners.get(other)?.has(name))];
    members.forEach((member) => seen.add(member));
    merges += members.length - 1;
  }
  return merges;
}

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
    // [a+b,c]~[1,2,3]: Desmos silently fits it (verified against v1.11), so
    // the extra entry is dropped and the answer is whatever the fit lands on.
    const [leftLength, rightLength] = [literalSideLength(left), literalSideLength(right)];
    if (leftLength !== null && rightLength !== null && leftLength !== rightLength) {
      violations.push({ row: index + 1, kind: "mismatched_lists", lengths: { "left side": leftLength, "right side": rightLength } });
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

    const effective = free.size - productMerges(expressions.map((expression) => expression.latex), free);
    if (effective > constraints) {
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
 * RULE 4 — list shapes Desmos can store
 * ================================================================================
 * Desmos has no nested lists. x_{1}=[1] makes every expression that uses x_{1}
 * a list, so [6x_{1}-k,6] asks for a list inside a list: the regression fails
 * ("Cannot store a list of numbers in a list.") and every row that depends on
 * its parameters errors. A single unknown is a bare letter the regression
 * leaves undefined, never a one-element list. This static check catches the
 * pattern before any model output is priced; the pre-flight run in a real
 * Desmos instance is what guarantees nothing that errors is ever shown.
 */

// These reduce a list to one number, so mean(L) inside [ ] is not nesting.
const AGGREGATE_CALL = /\\operatorname\{(?:mean|median|total|length|count|stdev|stdevp|var|varp|mad|min|max|quartile|quantile|corr|cov)\}\s*\(/g;

function stripAggregateArguments(text: string): string {
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(AGGREGATE_CALL)) {
    const start = match.index ?? 0;
    if (start < cursor) continue;
    const open = start + match[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let index = open; index < text.length; index++) {
      if ("([{".includes(text[index])) depth++;
      else if (")]}".includes(text[index]) && --depth === 0) {
        close = index;
        break;
      }
    }
    if (close === -1) break;
    result += `${text.slice(cursor, start)}0`;
    cursor = close + 1;
  }
  return result + text.slice(cursor);
}

/** x_1 and x_{1} are the same identifier; compare them in one spelling. */
function canonicalSubscripts(latex: string): string {
  return latex.replace(/_([A-Za-z0-9])/g, "_{$1}");
}

/** [ opens a list literal unless it indexes or filters the value before it (L[2], x_{1}[x_{1}>0]). */
function isListLiteralAt(text: string, open: number): boolean {
  const before = text.slice(0, open).replace(/\s+$/, "");
  return !/[A-Za-z}\])]$/.test(before);
}

type ListLiteral = { start: number; end: number; body: string };

function listLiterals(text: string): ListLiteral[] {
  const literals: ListLiteral[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "[" || !isListLiteralAt(text, index)) continue;
    const end = bracketEnd(text, index);
    if (end !== -1) literals.push({ start: index, end, body: text.slice(index + 1, end) });
  }
  return literals;
}

/** A range [1...5] or a comprehension [f(n) for n=...] is not an element-by-element literal. */
function isGeneratedList(body: string): boolean {
  return /\.\.\.|\\operatorname\{for\}|\bfor\b/.test(body);
}

const DEFINITION = /^\s*([A-Za-z](?:_\{[^{}]*\})?)\s*=(?!=)([\s\S]*)$/;
// y=[1,2] graphs horizontal lines; x and y are coordinates, not stored lists.
const COORDINATE_HEAD = /^[xy]$/;

function referencesName(text: string, name: string): boolean {
  // An indexed or filtered use (L[2]) is a single value or a list the filter
  // returns; only a bare reference carries the whole list into an element.
  return new RegExp(`(?<![A-Za-z\\\\])${escapeRegExp(name)}(?![A-Za-z0-9{_])(?!\\s*\\[)`).test(text);
}

/** Names that hold lists: declared list literals, plus plain definitions computed from them. */
function listValuedNames(rows: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const latex of rows) {
    const definition = latex.match(DEFINITION);
    if (!definition || REGRESSION_OP.test(latex) || COORDINATE_HEAD.test(definition[1])) continue;
    const value = definition[2].trim();
    if (value.startsWith("[") && isListLiteralAt(value, 0) && bracketEnd(value, 0) === value.length - 1) names.add(definition[1]);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const latex of rows) {
      const definition = latex.match(DEFINITION);
      if (!definition || REGRESSION_OP.test(latex) || COORDINATE_HEAD.test(definition[1]) || names.has(definition[1])) continue;
      const value = stripAggregateArguments(definition[2]);
      if ([...names].some((name) => referencesName(value, name))) {
        names.add(definition[1]);
        changed = true;
      }
    }
  }
  return names;
}

export type ListShapeViolation =
  | { row: number; kind: "singleton"; name: string; latex: string }
  | { row: number; kind: "nested"; element: string };

export function findListShapeViolations(expressions: ReadonlyArray<{ latex: string }>): ListShapeViolation[] {
  const rows = expressions.map(({ latex }) => canonicalSubscripts(stripDelimiters(latex)));
  const lists = listValuedNames(rows);
  const violations: ListShapeViolation[] = [];
  rows.forEach((latex, index) => {
    const definition = latex.match(DEFINITION);
    const value = definition?.[2].trim() ?? "";
    if (definition && !REGRESSION_OP.test(latex) && value.startsWith("[") && bracketEnd(value, 0) === value.length - 1) {
      const body = value.slice(1, -1);
      if (!isGeneratedList(body) && balancedSplit(body, ",").filter((part) => part.trim()).length === 1) {
        violations.push({ row: index + 1, kind: "singleton", name: definition[1], latex: expressions[index].latex });
        return;
      }
    }
    for (const literal of listLiterals(latex)) {
      if (isGeneratedList(literal.body)) continue;
      const nested = balancedSplit(literal.body, ",")
        .map((element) => element.trim())
        .find((element) => {
          if (element.startsWith("[")) return true;
          const scalar = stripAggregateArguments(element);
          return [...lists].some((name) => referencesName(scalar, name));
        });
      if (nested) {
        violations.push({ row: index + 1, kind: "nested", element: nested });
        return;
      }
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
  // Once TeX commands (\max) and subscripted list names (x_{1}) are removed,
  // every remaining x or y is a coordinate, including a juxtaposed one such
  // as the y in "7x=py" or the x in "7x".
  const bare = latex
    .replace(/\\[A-Za-z]+/g, " ")
    .replace(/[xy]_(?:\{[^{}]*\}|[A-Za-z0-9])/g, " ");
  return /x/.test(bare) && /y/.test(bare) && !REGRESSION_OP.test(latex);
}

export function checkConditionCompleteness(input: {
  conditionType: ConditionType | null;
  distinguishes: DistinguishMethod | null;
  result: Solution["result"];
  answerState: Solution["answerState"];
  expressions: ReadonlyArray<{ latex: string }>;
}): { distinguishes: DistinguishMethod } | { error: string } | null {
  if (input.conditionType === null) return null;

  const result = input.result;
  const graphRows =
    result && "type" in result && (result.type === "graph_overlap" || result.type === "intersection")
      ? [result.row, ...result.relatedRows].filter((row): row is number => row !== null)
      : [];
  const distinctGraphRows = [...new Set(graphRows)];
  // The graphs show the answer value when a slider opens there (answerState)
  // or when the parameter is one a regression row fits: Desmos then draws
  // every row that uses it at the fitted value, with no slider to position.
  // (analyzePlan splits juxtaposed letters, so the p in "6+7x=py" counts.)
  const plan = analyzePlan(input.expressions);
  const drawnAtFittedValue = distinctGraphRows.some((row) =>
    [...(plan.rows[row - 1]?.names ?? [])].some((name) => plan.fitted.has(name)),
  );
  const bothEquationsGraphed =
    distinctGraphRows.length >= 2 &&
    (input.answerState !== null || drawnAtFittedValue) &&
    distinctGraphRows.every((row) => isGraphableEquation(input.expressions[row - 1]?.latex ?? ""));

  if (bothEquationsGraphed) return { distinguishes: "visual-parallel-vs-overlap" };
  // A declared distinction is verified, not trusted. A visual claim needs the
  // graph evidence above. A constant-ratio claim is credible for a paper method
  // (its written steps compare the constants) or calculator rows that compute
  // ratios, but never for a derivative match, which compares slopes only.
  const slopeMatchOnly = input.expressions.some((expression) => /'/.test(expression.latex) && REGRESSION_OP.test(expression.latex));
  if (input.distinguishes === "constant-ratio-checked" && !slopeMatchOnly) return { distinguishes: "constant-ratio-checked" };

  const conditionLabel = input.conditionType === "no-solution" ? "no solution" : "infinitely many solutions";
  return {
    error:
      `This question asks for a parameter value that makes the system have ${conditionLabel}. Matching slopes ` +
      "or coefficient ratios alone is necessary but not sufficient: it is equally satisfied by the OPPOSITE " +
      "condition (two coincident lines vs. two distinct parallel lines). Make the distinction observable: graph " +
      "BOTH original equations with the parameter set to the answer value (set answerState so the slider opens " +
      "there, or let a regression row fit the parameter so both graphs use its fitted value) and set result.type " +
      "to graph_overlap naming both rows, so a parallel-but-distinct pair looks " +
      'visibly different from one line drawn twice, then set distinguishes to "visual-parallel-vs-overlap". ' +
      "Alternatively, if the method checks in the write-up that the constants do not scale by the same factor " +
      'as the coefficients, set distinguishes to "constant-ratio-checked".',
  };
}
