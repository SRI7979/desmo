import type { Solution } from "./solver-schema";
import { isRequestedModelEvaluation } from "./model-evaluation";

type DesmosExpression = Solution["expressions"][number];

const indexedVariablePattern = String.raw`([xy])(?:_\{(\d+)\}|_(\d+)|(\d+)|([₀-₉]+))`;
const listDeclaration = new RegExp(
  String.raw`^\s*${indexedVariablePattern}\s*=\s*(?:\\left\s*)?\[`,
);
const indexedVariable = new RegExp(String.raw`^${indexedVariablePattern}$`);
const unicodeDigits = "₀₁₂₃₄₅₆₇₈₉";
const namedBuiltins = [
  "abs",
  "ceil",
  "corr",
  "count",
  "cov",
  "distance",
  "floor",
  "gcd",
  "join",
  "lcm",
  "length",
  "max",
  "mean",
  "median",
  "midpoint",
  "min",
  "mod",
  "nCr",
  "nPr",
  "polygon",
  "quantile",
  "quartile",
  "random",
  "repeat",
  "round",
  "shuffle",
  "sign",
  "sort",
  "stdev",
  "stdevp",
  "total",
  "unique",
  "var",
  "varp",
] as const;
// Words that may legitimately appear as bare letters inside LaTeX.
const reservedWords = new Set([...namedBuiltins, "for", "with", "sin", "cos", "tan", "ln", "log", "exp"]);
// diff=... or r2=...: names longer than one letter (r2 means r·2 to Desmos).
const multiLetterDefinition = /^\s*([A-Za-z][A-Za-z0-9]+)\s*(?:\([^()]*\))?\s*=(?!=)/;
const namedBuiltinPattern = new RegExp(
  String.raw`\\operatorname\{[A-Za-z]+\}|\\[A-Za-z]+|(^|[^\\A-Za-z])(${namedBuiltins.join("|")})(?=\s*\()`,
  "g",
);

/**
 * Desmos names are one letter plus an optional subscript, so a model-written
 * `diff=...` is the product d·i·f·f. When a row defines such a name, rename it
 * to the valid subscript form d_{iff} everywhere it is referenced.
 */
function normalizeMultiLetterNames(latexRows: readonly string[]): string[] {
  const renames = new Map<string, string>();
  for (const latex of latexRows) {
    const name = latex.match(multiLetterDefinition)?.[1];
    if (name && !reservedWords.has(name as (typeof namedBuiltins)[number])) {
      renames.set(name, `${name[0]}_{${name.slice(1)}}`);
    }
  }
  if (renames.size === 0) return [...latexRows];
  const pattern = new RegExp(
    String.raw`\\operatorname\{[A-Za-z]+\}|\\[A-Za-z]+|(?<![A-Za-z\\])(${[...renames.keys()].join("|")})(?![A-Za-z0-9{])`,
    "g",
  );
  return latexRows.map((latex) =>
    latex.replace(pattern, (token, name?: string) => (name ? renames.get(name)! : token)),
  );
}

/**
 * |2x-5| as written by hand is not calculator LaTeX: Desmos reports "I don't
 * understand the '|' symbol" (checked against v1.11). Bare bars are paired in
 * order and become \left|...\right|; rows that already use \left| or \mid,
 * or have an odd number of bars, are left alone.
 */
function normalizeAbsoluteBars(latex: string): string {
  if (/\\(?:left|right|mid|vert)/.test(latex)) return latex;
  const bars = [...latex.matchAll(/\|/g)].map((match) => match.index!);
  if (bars.length === 0 || bars.length % 2 !== 0) return latex;
  let result = "";
  let cursor = 0;
  bars.forEach((at, index) => {
    result += latex.slice(cursor, at) + (index % 2 === 0 ? String.raw`\left|` : String.raw`\right|`);
    cursor = at + 1;
  });
  return result + latex.slice(cursor);
}

/**
 * A list comprehension only runs as [expression \operatorname{for} p=L]:
 * plain "for", or a comprehension outside brackets, errors ("I don't
 * understand the way that '=' is used here"; checked against v1.11).
 */
function normalizeComprehension(latex: string): string {
  const withOperator = latex.replace(/(?<!\\operatorname\{)(?<![A-Za-z\\])for(?=\s*[A-Za-z](?:_\{[^{}]*\}|_[A-Za-z0-9])?\s*=)/g, String.raw`\operatorname{for}`);
  if (!withOperator.includes(String.raw`\operatorname{for}`)) return withOperator;
  const unbracketed = /^(\s*[A-Za-z](?:_\{[^{}]*\}|_[A-Za-z0-9])?\s*=\s*)(?!\[|\\left\[)(.+?)\s*\\operatorname\{for\}\s*(.+?)\s*$/.exec(withOperator);
  return unbracketed ? `${unbracketed[1]}[${unbracketed[2]}\\operatorname{for}${unbracketed[3]}]` : withOperator;
}

function normalizeNamedBuiltins(latex: string): string {
  // Desmos compares with a single = inside list filters; == does not parse.
  return normalizeComprehension(normalizeAbsoluteBars(latex))
    // b^x_{1} errors ("Only functions and variables may have subscripts");
    // a subscripted exponent needs braces: b^{x_{1}}.
    .replace(/\^([A-Za-z])(_\{[^{}]+\}|_[A-Za-z0-9])/g, (_match, name: string, subscript: string) => `^{${name}${subscript}}`)
    // "pi" typed as a word is p·i through the API; the calculator UI would have turned it into π.
    .replace(/(?<![A-Za-z\\])pi(?![A-Za-z_])/g, String.raw`\pi `)
    // These characters look correct in KaTeX but are not valid calculator
    // LaTeX when passed through setExpressions. Normalize them before every
    // syntax/variable check so displayed and executed rows are identical.
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅∙]/g, String.raw`\cdot `)
    .replace(/÷/g, "/")
    .replace(/[∼≈]/g, String.raw`\sim `)
    .replace(/≤/g, String.raw`\le `)
    .replace(/≥/g, String.raw`\ge `)
    .replace(/≠/g, String.raw`\ne `)
    .replace(/π/g, String.raw`\pi `)
    .replace(/²/g, "^{2}")
    .replace(/³/g, "^{3}")
    // KaTeX accepts these display-size fractions, but Desmos only evaluates
    // the ordinary fraction command when rows are inserted through its API.
    .replace(/\\(?:tfrac|dfrac)(?![A-Za-z])/g, String.raw`\frac`)
    .replace(/==/g, "=")
    .replace(
    namedBuiltinPattern,
    (token, prefix: string | undefined, name: string | undefined) =>
      name ? `${prefix ?? ""}\\operatorname{${name}}` : token,
    );
}

function variableName(match: RegExpMatchArray): string {
  const digits =
    match[2] ??
    match[3] ??
    match[4] ??
    Array.from(match[5], (digit) => unicodeDigits.indexOf(digit)).join("");

  return `${match[1]}_{${digits}}`;
}

/**
 * Plain x1 means multiplication to Desmos, not the list identifier x_{1}.
 * Only repair identifiers explicitly introduced as x/y lists in this plan;
 * without that declaration, a numeric suffix may be intentional multiplication.
 */
// "b=1 \left(\text{slider: min }1,\ \text{max }10,\ \text{step }1\right)":
// a slider annotation the model wrote as prose instead of the slider field.
const sliderAnnotation =
  /\s*(?:\\\s*)?(?:\\left)?\(\s*\\text\{\s*slider[^)]*\)\s*$/i;

function extractSliderAnnotation(latex: string): {
  latex: string;
  slider: DesmosExpression["slider"];
} {
  const match = latex.match(sliderAnnotation);
  if (!match) return { latex, slider: undefined };
  const note = match[0];
  const bound = (name: string) =>
    Number(note.match(new RegExp(`${name}[^0-9-]*(-?\\d+(?:\\.\\d+)?)`, "i"))?.[1]);
  const [min, max, step] = [bound("min"), bound("max"), bound("step")];
  const bare = latex.slice(0, latex.length - note.length).trim();
  return {
    latex: bare,
    slider:
      Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(step) && min < max && step > 0
        ? { min, max, step }
        : undefined,
  };
}

/*
 * Desmos multiplies by juxtaposition, so A*(1+2)*(1-8) is the same row as
 * A(1+2)(1-8) with less visual noise. The star is only removable when the
 * right side starts with a bracket, a letter, or a TeX command: 2*3 must stay
 * (23 is a different number), x*-3 must stay (x-3 is a subtraction), and
 * f*(3) must stay when f is a function in this plan (f(3) would call it).
 */
const multiplicationOperator = /\*|\\cdot(?![A-Za-z])|\\times(?![A-Za-z])/g;
const functionDefinition = /^\s*([A-Za-z](?:_\{[^{}]*\}|_[A-Za-z0-9])?)\s*\([^()]*\)\s*=(?!=)/;
const trailingIdentifier = /([A-Za-z])(?:_\{[^{}]*\}|_[A-Za-z0-9])?$/;

function removeRedundantMultiplication(
  latex: string,
  functionNames: ReadonlySet<string>,
): string {
  let result = "";
  let cursor = 0;
  for (const match of latex.matchAll(multiplicationOperator)) {
    const at = match.index ?? 0;
    const left = latex.slice(cursor, at).replace(/\s+$/, "");
    const right = latex.slice(at + match[0].length).replace(/^\s+/, "");
    const opensGroup = right.startsWith("(") || right.startsWith("\\left(");
    const implicitIsSafe =
      /[0-9A-Za-z}\)\]]$/.test(left) &&
      (/^[A-Za-z(\[]/.test(right) || /^\\[A-Za-z]/.test(right)) &&
      // f(3) would call the function f; \operatorname{mean}(L) likewise.
      !(opensGroup && (left.endsWith("}") || functionNames.has(left.match(trailingIdentifier)?.[0] ?? "")));
    result += left + (implicitIsSafe ? "" : match[0]);
    cursor = at + match[0].length;
    if (implicitIsSafe) cursor += latex.slice(cursor).length - right.length;
  }
  return result + latex.slice(cursor);
}

export function normalizeDesmosExpressions(
  expressions: readonly DesmosExpression[],
): DesmosExpression[] {
  const declaredLists = new Set<string>();
  const annotated = expressions.map((expression) => {
    const extracted = extractSliderAnnotation(expression.latex);
    return {
      ...expression,
      latex: extracted.latex,
      ...(extracted.slider && !expression.slider ? { slider: extracted.slider } : {}),
    };
  });
  const renamed = normalizeMultiLetterNames(annotated.map((expression) => expression.latex));

  for (const latex of renamed) {
    const declaration = latex.match(listDeclaration);
    if (declaration) declaredLists.add(variableName(declaration));
  }

  // Consume entire TeX command names before looking for list references.
  // For example, the x in \max must not be treated as a variable.
  const references = new RegExp(
    String.raw`\\[A-Za-z]+|${indexedVariablePattern}`,
    "g",
  );

  const functionNames = new Set(
    renamed.flatMap((latex) => latex.match(functionDefinition)?.[1] ?? []),
  );

  return annotated.map((expression, index) => ({
    ...expression,
    latex: removeRedundantMultiplication(
      normalizeNamedBuiltins(renamed[index]),
      functionNames,
    ).replace(references, (token) => {
      const match = token.match(indexedVariable);
      if (!match) return token;

      const canonicalName = variableName(match);
      return declaredLists.has(canonicalName) ? canonicalName : token;
    }),
  }));
}

/*
 * Static variable-role check for a plan's rows.
 *
 * In the 2D calculator only x and y are coordinates. Every other letter must be
 * defined by a row, bound locally (function argument, sum index), or left free
 * on purpose inside a regression so Desmos fits it. An ordinary equation such as
 * -q-19w=-337 has nothing Desmos can graph or evaluate, so the plan is unusable.
 */

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
  "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "rho",
  "sigma", "upsilon", "phi", "varphi", "chi", "psi", "omega", "Gamma", "Delta",
  "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega",
]);
const CONSTANTS = new Set(["e", "\\pi", "\\tau", "\\infty"]);
const COORDINATES = new Set(["x", "y", "t"]);
const IDENTIFIER = String.raw`(?:\\[A-Za-z]+|[A-Za-z])(?:_\{[^{}]*\}|_[A-Za-z0-9])?`;
const identifierPattern = new RegExp(IDENTIFIER, "g");
const binderPattern = new RegExp(
  String.raw`(?:\\(?:sum|prod)_\{?\s*|\\operatorname\{(?:for|with)\}\s*|\bfor\s+|\bwith\s+)(${IDENTIFIER})\s*=`,
  "g",
);
const definitionPattern = new RegExp(
  String.raw`^\s*(${IDENTIFIER})\s*(?:\(\s*((?:${IDENTIFIER}\s*,\s*)*${IDENTIFIER})\s*\))?\s*=(?!=)`,
);

function canonicalIdentifier(token: string): string {
  const match = token.match(/^(\\?[A-Za-z]+)(?:_\{([^{}]*)\}|_([A-Za-z0-9]))?$/);
  if (!match) return token;
  const subscript = match[2] ?? match[3];
  return subscript === undefined ? match[1] : `${match[1]}_{${subscript}}`;
}

function isVariable(token: string): boolean {
  if (token.startsWith("\\")) {
    const name = token.slice(1).replace(/_.*$/, "");
    return GREEK.has(name);
  }
  return true;
}

/** Identifiers referenced by a row, with locally bound names removed. */
function rowIdentifiers(latex: string): { names: Set<string>; bound: Set<string> } {
  const bound = new Set<string>();
  let text = latex
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\frac\{d\}\{d[A-Za-z]\}/g, "")
    .replace(/\\(?:text|mathrm)\{[^{}]*\}/g, "");
  // The differential of an integral is notation, not a product d·x.
  if (/\\int(?![A-Za-z])/.test(text)) text = text.replace(/\bd([A-Za-z])(?![A-Za-z])/g, " ");
  text = text.replace(binderPattern, (_match, name: string) => {
    bound.add(canonicalIdentifier(name));
    return "=";
  });
  // A Desmos list comprehension may bind several variables:
  // expression \operatorname{for}p=A,q=B. The first binder is consumed above;
  // subsequent comma-separated binders have the same local scope.
  if (/\\operatorname\{for\}|\bfor\s+[A-Za-z]/.test(latex)) {
    text = text.replace(new RegExp(String.raw`,\s*(${IDENTIFIER})\s*=`, "g"), (_match, name: string) => {
      bound.add(canonicalIdentifier(name));
      return ",=";
    });
  }
  text = text
    .replace(/\\operatorname\{[A-Za-z]+\}/g, " ")
    .replace(/\b[A-Za-z]{2,}(?=\s*\()/g, " "); // bare function names such as abs(
  const names = new Set<string>();
  for (const match of text.matchAll(identifierPattern)) {
    if (isVariable(match[0])) names.add(canonicalIdentifier(match[0]));
  }
  for (const name of bound) names.delete(name);
  return { names, bound };
}

export type UndefinedVariableReport = { row: number; variables: string[] };

type AnalyzedRow = {
  latex: string;
  isRegression: boolean;
  isDefinition: boolean;
  isFunction: boolean;
  head: string | null;
  args: Set<string>;
  names: Set<string>;
};

export function analyzePlan(expressions: ReadonlyArray<{ latex: string }>) {
  const defined = new Map<string, { free: Set<string> }>();
  const rows: AnalyzedRow[] = expressions.map(({ latex }) => {
    const isRegression = /\\sim(?![A-Za-z])|~/.test(latex);
    const definition = isRegression ? null : latex.match(definitionPattern);
    const head = definition ? canonicalIdentifier(definition[1]) : null;
    const isDefinition = head !== null && !(["x", "y"].includes(head) && !definition?.[2]);
    const args = new Set(
      definition?.[2]
        ? definition[2].split(",").map((arg) => canonicalIdentifier(arg.trim()))
        : [],
    );
    const { names } = rowIdentifiers(latex);
    return { latex, isRegression, isDefinition, isFunction: Boolean(definition?.[2]), head, args, names };
  });

  const isKnown = (name: string) => COORDINATES.has(name) || CONSTANTS.has(name);
  for (const row of rows) {
    if (row.isDefinition && row.head) {
      const free = new Set(
        [...row.names].filter((name) => !isKnown(name) && !row.args.has(name)),
      );
      free.delete(row.head);
      defined.set(row.head, { free });
    }
  }

  // Letters a regression leaves undefined are parameters Desmos will fit,
  // including free letters inside functions the regression references.
  const fitted = new Set<string>();
  const collectFitted = (names: Iterable<string>, seen: Set<string>) => {
    for (const name of names) {
      if (isKnown(name) || seen.has(name)) continue;
      seen.add(name);
      const definition = defined.get(name);
      if (definition) collectFitted(definition.free, seen);
      else fitted.add(name);
    }
  };
  for (const row of rows) {
    if (row.isRegression) collectFitted(row.names, new Set());
  }
  return { rows, defined, fitted, isKnown };
}

export function findUndefinedVariables(
  expressions: ReadonlyArray<{ latex: string }>,
): UndefinedVariableReport[] {
  const { rows, defined, fitted, isKnown } = analyzePlan(expressions);
  const reports: UndefinedVariableReport[] = [];
  rows.forEach((row, index) => {
    if (row.isRegression) return;
    const variables = [...row.names].filter(
      (name) =>
        !isKnown(name) &&
        !defined.has(name) &&
        !fitted.has(name) &&
        !row.args.has(name),
    );
    if (variables.length) reports.push({ row: index + 1, variables: variables.sort() });
  });
  return reports;
}

export type DerivedDefinitionReport = { row: number; parameters: string[] };

/**
 * A final numeric row needs no throwaway display name. Models sometimes emit
 * `R=3k` even though the result contract already identifies that row. Remove
 * the alias only when it is a new name absent from the question. Definitions
 * of actual problem variables (`a=6/m`) remain subject to the hidden-
 * derivation check below.
 */
export function unwrapSyntheticResultAlias(
  latex: string,
  question: string,
): string | null {
  const match = latex.match(
    /^\s*([A-Za-z](?:_\{[^{}]*\}|_[A-Za-z0-9])?)\s*=\s*([\s\S]+?)\s*$/,
  );
  if (!match?.[2]?.trim()) return null;
  const name = match[1];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameInQuestion = new RegExp(
    `(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`,
  ).test(question);
  return nameInQuestion ? null : match[2].trim();
}

/**
 * a=6/m after fitting m: the requested value defined by a formula in a fitted
 * parameter. That formula (a rearranged slope, a doubled radius) was derived
 * off-screen; the philosophy wants the original equation graphed or fitted
 * instead. Function definitions (f(x)=mx+b) evaluate the fitted model and are
 * fine; bare expressions (2r) are evaluations, not definitions.
 */
export function findDerivedDefinitions(
  expressions: ReadonlyArray<{ latex: string }>,
  question = "",
): DerivedDefinitionReport[] {
  const { rows, fitted } = analyzePlan(expressions);
  const reports: DerivedDefinitionReport[] = [];
  rows.forEach((row, index) => {
    if (!row.isDefinition || row.isFunction || row.isRegression) return;
    if (isRequestedModelEvaluation(expressions[index].latex, expressions, question)) return;
    const parameters = [...row.names].filter((name) => fitted.has(name) && name !== row.head);
    if (parameters.length) reports.push({ row: index + 1, parameters: parameters.sort() });
  });
  return reports;
}

/** Rows that embed prose (\\text{...}) cannot be entered into Desmos. */
export function findProseRows(
  expressions: ReadonlyArray<{ latex: string }>,
): number[] {
  return expressions.flatMap(({ latex }, index) =>
    /\\(?:text|mathrm|textrm)\{/.test(latex) ? [index + 1] : [],
  );
}

/*
 * Reverse-engineered plans leave fingerprints: constants the student never
 * saw. A row built from the givens uses the question's numbers, small
 * integers, standard constants, or divisors of a given; 41 and 52 in a plan
 * for "x^2+y^2-10x-8y-14n=0 ... (11,8)" came from completing the square
 * off-screen, which is hidden derivation (PHILOSOPHY.md).
 */
const STANDARD_CONSTANTS = new Set([100, 180, 360, 1000, 1000000]);
const numberToken = /-?\d+(?:\.\d+)?/g;

// Commas are thousands separators in prose ("24,000") but list separators in LaTeX.
function numbersIn(text: string, prose: boolean): number[] {
  const cleaned = text.replace(/[\u2212\u2013]/g, "-");
  const source = prose ? cleaned.replace(/(\d),(?=\d{3}\b)/g, "$1") : cleaned;
  return [...source.matchAll(numberToken)].map((match) => Number(match[0]));
}

export type DerivedConstantReport = { row: number; constants: number[] };

export function findDerivedConstants(
  expressions: ReadonlyArray<{ latex: string; purpose: string }>,
  question: string,
  choices: ReadonlyArray<{ label?: string; text: string }> | null | undefined,
): DerivedConstantReport[] {
  const given = new Set(
    [question, ...(choices ?? []).map((choice) => choice.text)]
      .flatMap((text) => numbersIn(text, true))
      .map(Math.abs),
  );
  const isDivisorOfGiven = (value: number) =>
    Number.isInteger(value) && [...given].some((g) => g !== 0 && Number.isInteger(g) && g % value === 0);
  const reports: DerivedConstantReport[] = [];
  expressions.forEach((expression, index) => {
    // Copying a displayed regression result is an allowed, explained step.
    if (/\b(copy|copied|displayed|fitted equation|freeze)/i.test(expression.purpose)) return;
    const latex = expression.latex
      .replace(/_\{[^{}]*\}/g, "")           // subscripts name lists, not values
      .replace(/\\operatorname\{[^{}]*\}/g, "")
      .replace(/\.\.\./g, " ");
    const constants = [...new Set(numbersIn(latex, false).map(Math.abs))].filter(
      (value) =>
        value > 12 &&
        !given.has(value) &&
        !STANDARD_CONSTANTS.has(value) &&
        !isDivisorOfGiven(value),
    );
    if (constants.length) reports.push({ row: index + 1, constants: constants.sort((a, b) => a - b) });
  });
  return reports;
}
