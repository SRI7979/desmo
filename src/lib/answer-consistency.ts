import type { AnswerChoice, AnswerState, Solution, SolutionResult } from "./solver-schema";
import { isNumericResult, validateResultContract, ResultContractError } from "./result-contract";

/**
 * Keeps the calculator rows, the read-result instruction, the displayed
 * answer, and the answer-choice letter mutually consistent.
 *
 * Numeric and list results identify a value and row that the browser can
 * verify against Desmos. Graphical and written results identify their evidence
 * explicitly; they do not require a scalar calculator evaluation.
 * This module has no server-only imports so both sides share one rule set.
 */

export class AnswerConsistencyError extends Error {
  constructor(message: string, readonly stage = "answer_consistency") {
    super(message);
    this.name = "AnswerConsistencyError";
  }
}

/**
 * One clean line through the schema: `expressions[].latex` is LaTeX and
 * required — Desmos consumes it, never touch it. Every other field a human
 * reads is plain text, never LaTeX. ASCII-style math (g''(0)/2 + g'(0)) is
 * fine and expected; a LaTeX control sequence or a brace superscript/
 * subscript is not. See PHILOSOPHY.md / A3 in the task history.
 */
export class ProseLatexError extends Error {
  constructor(message: string, readonly field: string) {
    super(message);
    this.name = "ProseLatexError";
  }
}

const latexSignature = /\\[a-zA-Z]+|\^\{|_\{/;

/** True when text still contains a LaTeX control sequence or brace script. */
export function containsLatex(text: string): boolean {
  return latexSignature.test(text);
}

/**
 * Symbol commands with one exact plain-text character, which MathText renders
 * as math (π, θ, ≤, ≥, ≠, ≈, ×, ÷) or shows as the symbol itself. A model
 * transcribing "10π" or "x ≤ 5" often writes \pi or \le; that is the problem's
 * own math, not a formatting slip. Structural commands (\overline, \int,
 * \begin, ...) have no such equivalent and are still rejected.
 */
const PLAIN_SYMBOLS: Readonly<Record<string, string>> = {
  pi: "π",
  theta: "θ",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  times: "×",
  cdot: "*",
  div: "÷",
  pm: "±",
  infty: "∞",
  degree: "°",
  circ: "∘",
};

function needsGrouping(expression: string): boolean {
  let depth = 0;
  for (const char of expression) {
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (depth === 0 && (char === "+" || char === "-")) return true;
  }
  return false;
}

function group(expression: string): string {
  const trimmed = expression.trim();
  return needsGrouping(trimmed) ? `(${trimmed})` : trimmed;
}

/**
 * Converts the LaTeX a model tends to write in a prose field into the plain
 * ASCII-style math this app asks for: \frac{a}{b} → a/b (grouping only the
 * side that actually needs it), \left(/\right) → (/), ^{\prime} (however
 * many, however malformed the stacking) → the matching number of quotes,
 * \sqrt{a} → sqrt(a), including nested square roots,
 * \text{...}/\operatorname{...} → their own contents, symbol commands such as
 * \pi, \le, ^\circ → π, ≤, °, and a lone \{ \} or ^{...}/_{...} → the bare
 * braces/marker. Idempotent and safe on clean text.
 */
export function repairProseText(text: string): string {
  let result = text;
  result = result.replace(/\\left\s*([([|])/g, "$1").replace(/\\right\s*([)\]|])/g, "$1");
  // Any run of two or more primes (bare ' or \prime, in any \^{...} dress) is
  // a stacked derivative order; g^{\prime}^{\prime} is invalid TeX for g''.
  result = result.replace(
    /(?:\^\{\\prime\}|\\prime|')(?:\s*(?:\^\{\\prime\}|\\prime|')){1,}/g,
    (match) => "'".repeat((match.match(/\\prime|'/g) ?? []).length),
  );
  result = result.replace(/\^\{\\prime\}/g, "'").replace(/\\prime/g, "'");
  const balancedBraces = "(?:[^{}]|\\{[^{}]*\\})*";
  result = result.replace(
    new RegExp(`\\\\frac\\{(${balancedBraces})\\}\\{(${balancedBraces})\\}`, "g"),
    (_match, numerator: string, denominator: string) => `${group(numerator)}/${group(denominator)}`,
  );
  // Innermost-first replacement preserves the radicand and lets MathText
  // render sqrt(...) as math. Unsupported TeX remains visible to the validator.
  for (let depth = 0; depth < 12 && /\\sqrt\{[^{}]*\}/.test(result); depth++) {
    result = result.replace(/\\sqrt\{([^{}]*)\}/g, (_match, radicand: string) => `sqrt(${radicand})`);
  }
  result = result.replace(/\\text\{([^{}]*)\}/g, "$1");
  result = result.replace(/\\operatorname\{([^{}]*)\}/g, "$1");
  // A degree mark before the generic ^{...} step, so 30^{\circ} is 30°, not 30^∘.
  result = result.replace(/\^\s*(?:\{\s*\\circ\s*\}|\\circ(?![a-zA-Z]))/g, "°");
  result = result.replace(/\\([a-zA-Z]+)/g, (match, name: string) => PLAIN_SYMBOLS[name] ?? match);
  result = result.replace(/\\%/g, "%");
  result = result.replace(/\^\{([^{}]*)\}/g, "^$1").replace(/_\{([^{}]*)\}/g, "_$1");
  result = result.replace(/\\\{/g, "{").replace(/\\\}/g, "}");
  // A tidy-up, not a correctness step: "g'' (0)" reads more naturally as "g''(0)".
  result = result.replace(/('+)\s+\(/g, "$1(");
  return result;
}

/** Repairs common LaTeX shapes, then rejects whatever still looks like LaTeX. */
export function sanitizeProse(text: string, field: string): string {
  if (!containsLatex(text)) return text;
  const repaired = repairProseText(text);
  if (containsLatex(repaired)) {
    throw new ProseLatexError(
      `${field} must be plain text, not LaTeX (write g''(0)/2 + g'(0), not \\frac{g''(0)}{2}+g'(0)). ` +
        `After repair it still contains a LaTeX control sequence: "${repaired}"`,
      field,
    );
  }
  return repaired;
}

/**
 * Client-side last line of defense for text interpolated into a message the
 * student reads: repair on the spot, and if that still leaves LaTeX behind
 * (rather than ever showing a raw backslash), fall back to a safe phrase.
 * Independent of whether the server-side validator already ran.
 */
export function displayProse(text: string, fallback = "the requested value"): string {
  if (!containsLatex(text)) return text;
  const repaired = repairProseText(text);
  return containsLatex(repaired) ? fallback : repaired;
}

/**
 * Every field on a fully-assembled solution that a human reads, sanitized in
 * one pass. `expressions[].latex` is deliberately excluded: that field is
 * Desmos LaTeX, required and untouched. Throws ProseLatexError naming the
 * first field that still contains LaTeX after the repair pass.
 */
export function sanitizeSolutionProse(solution: Solution): Solution {
  return {
    ...solution,
    question: sanitizeProse(solution.question, "question"),
    answer: sanitizeProse(solution.answer, "answer"),
    why: sanitizeProse(solution.why, "why"),
    readAnswer: solution.readAnswer !== null ? sanitizeProse(solution.readAnswer, "readAnswer") : null,
    structure: solution.structure !== null ? sanitizeProse(solution.structure, "structure") : null,
    trick: solution.trick !== null ? sanitizeProse(solution.trick, "trick") : null,
    clarification:
      solution.clarification !== null ? sanitizeProse(solution.clarification, "clarification") : null,
    steps: solution.steps.map((step, index) => sanitizeProse(step, `steps[${index}]`)),
    choices:
      solution.choices?.map((choice, index) => ({
        ...choice,
        text: sanitizeProse(choice.text, `choices[${index}].text`),
      })) ?? null,
    expressions: solution.expressions.map((expression, index) => ({
      ...expression,
      purpose: sanitizeProse(expression.purpose, `expressions[${index}].purpose`),
    })),
    result: solution.result
      ? { ...solution.result, detail: sanitizeProse(solution.result.detail, "result.detail") }
      : null,
  };
}

export type NormalizedChoice = AnswerChoice & {
  value: number | null;
  /** "25%" may be displayed by Desmos as 25 or as 0.25. */
  percent: boolean;
};

export type ConsistentSolution = {
  choices: AnswerChoice[] | null;
  result: SolutionResult;
  answer: string;
  readAnswer: string;
  repairs: string[];
};

export type RowEvaluation =
  | { type: "Number"; value: number }
  | { type: "ListOfNumber"; value: number[] };

/**
 * Three states only (see PHILOSOPHY.md / A2 in the task history):
 * - verified: the calculator's own value matches the claimed answer.
 * - unverified: verification could not run cleanly — a non-numeric or
 *   graphical result, a missing/unevaluable row, NaN, an edited expression,
 *   or a computed value that matches no answer choice at all (ambiguous, not
 *   a confident contradiction). Absence of proof is not an error: this state
 *   renders nothing.
 * - contradicted: the row evaluated cleanly to a DIFFERENT value that is
 *   itself a valid answer choice. This is the only state worth a banner, and
 *   the banner must state facts plainly, never alarm, and never tell the
 *   student to spend another solve on an internal mismatch.
 */
export type CalculatorCheck =
  | { status: "unverified" }
  | { status: "verified"; observed: number; message: string }
  | {
      status: "contradicted";
      observed: number;
      answer: string;
      readAnswer: string;
      message: string;
    };

const UNICODE_MINUS = /[−–]/g;

/** "3π", "2√3", "√2", "π/4", "5√2/2": products of a coefficient with π or a square root. */
function parseSymbolic(candidate: string): number | null {
  const term = (text: string): number | null => {
    const match = text.match(/^(-?)(\d+(?:\.\d+)?)?\s*(π|pi|√\s*(\d+(?:\.\d+)?))?$/i);
    if (!match || (!match[2] && !match[3])) return null;
    const coefficient = match[2] ? Number(match[2]) : 1;
    const symbol = !match[3] ? 1 : match[4] ? Math.sqrt(Number(match[4])) : Math.PI;
    const magnitude = coefficient * symbol;
    return match[1] ? -magnitude : magnitude;
  };
  const parts = candidate.split("/");
  if (parts.length > 2) return null;
  const numerator = term(parts[0].trim());
  if (numerator === null) return null;
  if (parts.length === 1) return numerator;
  const denominator = term(parts[1].trim());
  return denominator === null || denominator === 0 ? null : numerator / denominator;
}

/** Parses "−432", "$1,200", "16/17", "2 1/2", "x = 7", "45%", "12 hours", "2√3". */
export function parseNumber(text: string): number | null {
  let value = text.trim().replace(UNICODE_MINUS, "-");
  if (!value) return null;
  value = value
    .replace(/^[a-zA-Z]\s*=\s*/, "")
    .replace(/[$€£¥,]/g, "")
    .replace(/\s*(%|percent|°|degrees)\s*$/i, "")
    .trim();
  const numeric = (candidate: string): number | null => {
    const mixed = candidate.match(/^(-?)(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) {
      const denominator = Number(mixed[4]);
      if (denominator === 0) return null;
      const magnitude = Number(mixed[2]) + Number(mixed[3]) / denominator;
      return mixed[1] ? -magnitude : magnitude;
    }
    const fraction = candidate.match(
      /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/,
    );
    if (fraction) {
      const denominator = Number(fraction[2]);
      return denominator === 0 ? null : Number(fraction[1]) / denominator;
    }
    if (/^[+-]?(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(candidate)) {
      return Number(candidate);
    }
    return parseSymbolic(candidate);
  };
  // Strip trailing unit words ("12 square feet") until a number remains.
  let candidate = value;
  while (candidate) {
    const parsed = numeric(candidate);
    if (parsed !== null && Number.isFinite(parsed)) return parsed;
    const shorter = candidate.replace(/\s+[^\s\d/.]+$/, "");
    if (shorter === candidate) break;
    candidate = shorter.trim();
  }
  return null;
}

/** Equal up to display rounding: 0.941176 matches 16/17, 403 never matches 406. */
export function numbersMatch(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(1e-6, 1e-4 * scale);
}

/**
 * "0.667" is an acceptable statement of 2/3: the text rounds to the value and
 * carries at least three significant digits, the precision an SAT grid needs.
 */
export function roundsTo(text: string, value: number): boolean {
  const stated = parseNumber(text);
  if (stated === null) return false;
  if (numbersMatch(stated, value)) return true;
  const decimal = text.trim().match(/^-?(\d*)\.(\d+)\s*[^\d]*$/);
  if (!decimal) return false;
  const significant = `${decimal[1]}${decimal[2]}`.replace(/^0+/, "").length;
  if (significant < 3) return false;
  return Math.abs(stated - value) <= 0.5 * 10 ** -decimal[2].length + 1e-12;
}

export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(6)).toString();
}

export function formatChoice(choice: AnswerChoice): string {
  return `${choice.label}) ${choice.text}`;
}

const labelPattern = /^\(?([A-Za-z]|\d{1,2})[).:]?$/;

/** Canonical labels ("A"), no duplicated label inside the text, unique labels. */
export function normalizeChoices(
  choices: readonly AnswerChoice[] | null | undefined,
): NormalizedChoice[] | null {
  if (!choices || choices.length === 0) return null;
  const normalized = choices.map((choice) => {
    const label = (choice.label.trim().match(labelPattern)?.[1] ?? choice.label.trim())
      .toUpperCase();
    const text = choice.text
      .trim()
      .replace(new RegExp(String.raw`^\(?${label}\)?[).:]\s*`, "i"), "")
      .trim();
    return { label, text, value: parseNumber(text), percent: /%|percent/i.test(text) };
  });
  if (normalized.some((choice) => !choice.label || !choice.text)) {
    throw new AnswerConsistencyError("Answer choices need a label and text.");
  }
  if (new Set(normalized.map((choice) => choice.label)).size !== normalized.length) {
    throw new AnswerConsistencyError("Answer-choice labels must be unique.");
  }
  return normalized;
}

function choiceNoiseTolerance(value: number): number {
  // A relative tolerance alone grows far too wide for large SAT answers:
  // 999,950 must not count as 1,000,000. Keep room for calculator float noise.
  return Math.min(1e-4, Math.max(1e-8, 1e-7 * Math.abs(value)));
}

function decimalRoundingTolerance(text: string): number | null {
  const numeric = text.trim().replace(/^[A-Za-z]\s*=\s*/, "").replace(/[$€£¥,]/g, "");
  const match = numeric.match(
    /^[+-]?(?:\d+)?\.(\d+)(?:e([+-]?\d+))?(?:\s*(?:%|percent|°|degrees|[A-Za-z][A-Za-z\s]*))?$/i,
  );
  if (!match) return null;
  const significant = numeric.split(/[eE]/, 1)[0].replace(/[^\d]/g, "").replace(/^0+/, "").length;
  if (significant < 3) return null;
  const exponent = match[2] ? Number(match[2]) : 0;
  const tolerance = 0.5 * 10 ** (exponent - match[1].length);
  return Number.isFinite(tolerance) ? tolerance : null;
}

function choiceWithinNoise(target: number, choice: NormalizedChoice & { value: number }): boolean {
  const distance = Math.abs(target - choice.value);
  return distance <= choiceNoiseTolerance(Math.max(Math.abs(target), Math.abs(choice.value)));
}

function choiceMatchesRoundedDecimal(target: number, choice: NormalizedChoice & { value: number }): boolean {
  const distance = Math.abs(target - choice.value);
  const observedRounding = decimalRoundingTolerance(String(target));
  const choiceRounding = decimalRoundingTolerance(choice.text);
  return (observedRounding !== null && distance <= observedRounding) ||
    (choiceRounding !== null && distance <= choiceRounding);
}

/**
 * Maps a computed number to the unique answer choice with that value.
 * Rounded displays still match ("2.33" → 7/3) as long as no other choice is
 * nearly as close; an ambiguous or absent match returns null.
 */
export function matchChoice(
  value: number,
  choices: readonly NormalizedChoice[],
  approximate = false,
): NormalizedChoice | null {
  const numeric = choices.filter(
    (choice): choice is NormalizedChoice & { value: number } => choice.value !== null,
  );
  if (numeric.length === 0 || !Number.isFinite(value)) return null;
  const rank = (target: number) =>
    numeric
      .map((choice) => ({ choice, target, distance: Math.abs(choice.value - target) }))
      .sort((left, right) => left.distance - right.distance);
  const attempts = [rank(value)];
  // Desmos shows 0.25 where the choices say 25%.
  if (numeric.some((choice) => choice.percent)) {
    attempts.push(rank(value * 100).filter(({ choice }) => choice.percent));
  }
  for (const ranked of attempts) {
    if (ranked.length === 0) continue;
    const [nearest, runnerUp] = ranked;
    const target = nearest.target;
    if (choiceWithinNoise(target, nearest.choice)) {
      return runnerUp && choiceWithinNoise(target, runnerUp.choice) ? null : nearest.choice;
    }
    if (!choiceMatchesRoundedDecimal(target, nearest.choice)) continue;
    if (runnerUp && choiceMatchesRoundedDecimal(target, runnerUp.choice)) continue;
    if (runnerUp && runnerUp.distance < nearest.distance * 10) continue;
    return nearest.choice;
  }
  // "Approximately how many minutes...": the choices are rounded on purpose,
  // so 19.05 from a fitted line is choice 19, provided no other choice is close.
  if (approximate) {
    const [nearest, runnerUp] = attempts[0];
    if (nearest && (!runnerUp || runnerUp.distance >= nearest.distance * 4)) return nearest.choice;
  }
  return null;
}

/** The question asks for an estimate, so its numeric choices are rounded on purpose. */
export function isApproximationQuestion(question: string): boolean {
  return /\b(?:approximately|approximate(?:ly)?|closest to|nearest to|best approximat\w*|estimated?|about how (?:many|much))\b/i.test(question);
}

function findChoice(
  label: string | null | undefined,
  choices: readonly NormalizedChoice[],
): NormalizedChoice | null {
  const wanted = label?.trim().match(labelPattern)?.[1]?.toUpperCase() ?? label?.trim().toUpperCase();
  return wanted ? choices.find((choice) => choice.label === wanted) ?? null : null;
}

function mentionsLabel(text: string, label: string): boolean {
  return new RegExp(
    String.raw`(?:choice|option|answer|letter)\s*\(?${label}\b|\(${label}\)|(?:^|[\s,;:])${label}[).:](?=\s|$)`,
    "i",
  ).test(text);
}

function mentionsNumber(text: string, value: number): boolean {
  return extractNumbers(text).some((found) => numbersMatch(found, value));
}

/** Numbers asserted in prose, ignoring row/entry/choice references. */
export function extractNumbers(text: string): number[] {
  return extractNumberTexts(text)
    .map((item) => parseNumber(item))
    .filter((item): item is number => item !== null);
}

function extractNumberTexts(text: string): string[] {
  const prose = text
    .replace(UNICODE_MINUS, "-")
    .replace(
      /\b(?:line|row|entry|position|index|item|step)s?\s*#?\s*\d+(?:\s*(?:,|and|&|through|to|-)\s*\d+)*/gi,
      " ",
    )
    .replace(/\b(?:choice|option|answer|letter)\s*\(?[A-Za-z]\)?/gi, " ")
    .replace(/[$€£¥,]/g, "");
  return [...prose.matchAll(/-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?/g)].map(
    (match) => match[0],
  );
}

function describeReadout(
  result: SolutionResult,
  value: number | null,
  answer: string,
  choice: NormalizedChoice | null,
): string {
  const detail = displayProse(result.detail);
  if ("type" in result && result.type === "written") return `${detail}; the answer is ${answer}.`;
  const where = result.listIndex
    ? `Entry ${result.listIndex} of line ${result.row}`
    : `Line ${result.row}`;
  const shows = value === null
    ? `${where} shows ${detail}`
    : `${where} shows ${detail} = ${formatNumber(value)}`;
  return choice
    ? `${shows}, which matches choice ${formatChoice(choice)}.`
    : `${shows}; the answer is ${answer}.`;
}

/** The choice or value the readout selects. Throws when nothing matches. */
function deriveAnswer(
  result: SolutionResult,
  choices: NormalizedChoice[] | null,
  modelAnswer: string,
  observed: number | null,
  repairs: string[],
  source: string,
  approximate = false,
): { answer: string; choice: NormalizedChoice | null } {
  const claimed = findChoice(result.choiceLabel, choices ?? []);

  if (result.answerFrom === "value" && observed !== null) {
    if (choices) {
      const matched = matchChoice(observed, choices, approximate);
      if (matched) {
        if (claimed && claimed.label !== matched.label) {
          repairs.push(
            `${source} ${formatNumber(observed)} matches choice ${matched.label}, not ${claimed.label}.`,
          );
        }
        return { answer: formatChoice(matched), choice: matched };
      }
      if (claimed && claimed.value === null) {
        // A symbolic choice such as 2√3 cannot be checked numerically; a
        // numeric one that disagrees with the calculator is rejected below.
        return { answer: formatChoice(claimed), choice: claimed };
      }
      throw new AnswerConsistencyError(
        `${source} ${formatNumber(observed)} does not match any answer choice.`,
      );
    }
    if (roundsTo(modelAnswer, observed) || modelAnswer.includes(formatNumber(observed))) {
      return { answer: modelAnswer.trim(), choice: null };
    }
    repairs.push(
      `The answer "${modelAnswer.trim()}" did not match ${source.toLowerCase()} ${formatNumber(observed)}.`,
    );
    return { answer: formatNumber(observed), choice: null };
  }

  if (result.answerFrom === "choice_position") {
    if (!choices) {
      throw new AnswerConsistencyError(
        "A choice-position result needs transcribed answer choices.",
      );
    }
    const index = result.listIndex ?? (claimed ? choices.indexOf(claimed) + 1 : 0);
    if (!index || index > choices.length) {
      throw new AnswerConsistencyError(
        "The list entry must correspond to one of the answer choices.",
      );
    }
    const selected = choices[index - 1];
    if (claimed && claimed.label !== selected.label) {
      repairs.push(
        `Entry ${index} of line ${result.row} is choice ${selected.label}, not ${claimed.label}.`,
      );
    }
    return { answer: formatChoice(selected), choice: selected };
  }

  // "reasoning", or a value-based readout the model could not reduce to one
  // number (an intersection it reads by clicking): the letter must be valid.
  if (choices) {
    if (!claimed) {
      throw new AnswerConsistencyError(
        "The selected answer choice must be one of the transcribed choices.",
      );
    }
    return { answer: formatChoice(claimed), choice: claimed };
  }
  return { answer: modelAnswer.trim(), choice: null };
}

/**
 * Server-side derivation for a calculator solution. Returns the consistent
 * answer/readAnswer plus a list of repairs; throws when the readout cannot
 * justify any answer (the caller rejects the solve).
 */
export function deriveConsistentSolution(input: {
  choices: readonly AnswerChoice[] | null | undefined;
  result: SolutionResult | null | undefined;
  answer: string;
  readAnswer: string;
  expressionCount: number;
  /** The question asks for an estimate (isApproximationQuestion): the nearest clear choice is its answer. */
  approximate?: boolean;
}): ConsistentSolution {
  const repairs: string[] = [];
  const choices = normalizeChoices(input.choices);
  let result = input.result;
  if (!result) {
    throw new AnswerConsistencyError(
      "A solution must identify how to read the answer (numeric, graphical, or written).", "result_contract",
    );
  }
  try { validateResultContract(result, input.expressionCount); }
  catch (error) { if (error instanceof ResultContractError) throw new AnswerConsistencyError(error.message, "result_contract"); throw error; }
  // detail is prose the student reads ("r + s", "a + b"); it is never LaTeX.
  try { result = { ...result, detail: sanitizeProse(result.detail.trim(), "result.detail") }; }
  catch (error) { if (error instanceof ProseLatexError) throw new AnswerConsistencyError(error.message, "prose_text"); throw error; }
  // "Entry 3 of the list is 0" names a position, not a value, even when the
  // model labels it answerFrom "value": the zero selects choice 3.
  if (
    result.answerFrom === "value" &&
    result.listIndex !== null &&
    result.value !== null &&
    choices &&
    result.listIndex <= choices.length &&
    !matchChoice(result.value, choices)
  ) {
    result = { ...result, answerFrom: "choice_position" };
    repairs.push(
      `Entry ${result.listIndex} of line ${result.row} selects the answer by position, so the result was read as a choice position.`,
    );
  } else if (
    // The reverse slip: a filter such as A[c=A] shows only the matching
    // choices, so its entry 1 is not choice A. When the displayed value is the
    // claimed choice's own value, the entry shows that value, not a position.
    result.answerFrom === "choice_position" &&
    result.listIndex !== null &&
    result.value !== null &&
    choices
  ) {
    const byValue = matchChoice(result.value, choices);
    const atPosition = choices[result.listIndex - 1];
    const claimed = findChoice(result.choiceLabel, choices);
    if (byValue && claimed?.label === byValue.label && atPosition?.label !== byValue.label &&
        (atPosition?.value === null || atPosition?.value === undefined || !numbersMatch(atPosition.value, result.value))) {
      result = { ...result, answerFrom: "value" };
      repairs.push(
        `Entry ${result.listIndex} of line ${result.row} shows ${formatNumber(result.value!)}, choice ${byValue.label}'s own value, so it was read as a value, not a choice position.`,
      );
    }
  }
  if (!("type" in result) && result.row === input.expressionCount + 1 && input.expressionCount > 0) {
    // A one-past-the-end reference is the model miscounting its own rows.
    result = { ...result, row: input.expressionCount };
    repairs.push(`The result row was corrected from ${result.row + 1} to the last line, ${result.row}.`);
  }
  if (result.row !== null && result.row > input.expressionCount) {
    throw new AnswerConsistencyError(
      `The result points at line ${result.row}, but only ${input.expressionCount} lines were provided.`,
    );
  }
  if (result.value !== null && !Number.isFinite(result.value)) {
    throw new AnswerConsistencyError("The result value must be a finite number.");
  }

  const { answer, choice } = deriveAnswer(
    result,
    choices,
    input.answer,
    result.value,
    repairs,
    `The value on line ${result.row},`,
    input.approximate ?? false,
  );
  const normalizedResult: SolutionResult = {
    ...result,
    detail: result.detail,
    listIndex:
      result.answerFrom === "choice_position" && choice && choices
        ? choices.indexOf(choice) + 1
        : result.listIndex,
    choiceLabel: choice?.label ?? null,
  };
  if (input.answer.trim() !== answer) {
    repairs.push(`The displayed answer was changed from "${input.answer.trim()}" to "${answer}".`);
  }

  // The read instruction may not assert a different choice's value.
  const summary = describeReadout(normalizedResult, result.value, answer, choice);
  let readAnswer = input.readAnswer.trim();
  if (!readAnswer) {
    repairs.push("The read instruction was missing and was generated from the result row.");
    readAnswer = summary;
  }
  const writtenAnswer = "type" in result && result.type === "written" ? parseNumber(answer) : null;
  const mentionsAnswer =
    (choice ? mentionsLabel(readAnswer, choice.label) : false) ||
    (writtenAnswer !== null && mentionsNumber(readAnswer, writtenAnswer)) ||
    (result.value !== null &&
      (mentionsNumber(readAnswer, result.value) ||
        extractNumberTexts(readAnswer).some((text) => roundsTo(text, result.value as number)))) ||
    (choice?.value !== null && choice?.value !== undefined && mentionsNumber(readAnswer, choice.value));
  const contradicts =
    !!choices &&
    extractNumbers(readAnswer).some((found) =>
      choices.some(
        (other) =>
          other.value !== null &&
          other.label !== choice?.label &&
          numbersMatch(other.value, found) &&
          (result.value === null || !numbersMatch(found, result.value)),
      ),
    );
  if (contradicts && !mentionsAnswer) {
    repairs.push("The read instruction named a different answer choice and was rewritten.");
    readAnswer = summary;
  } else if (!mentionsAnswer) {
    readAnswer = `${readAnswer} ${summary}`;
  }

  return {
    choices: choices?.map(({ label, text }) => ({ label, text })) ?? null,
    result: normalizedResult,
    answer,
    readAnswer,
    repairs,
  };
}

const sliderDefinitionPattern =
  /^\s*(?![xy]\s*=)([A-Za-z](?:_\{[^{}]*\}|_[A-Za-z0-9])?)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/;

/** b=1 or k_{1}=-2: a constant assigned a plain number (y=7 is a line, not a slider). */
export function isSliderDefinition(latex: string): boolean {
  return sliderDefinitionPattern.test(latex);
}

/** The variable a slider-shaped row assigns ("k" from "k=2"), or null. */
export function sliderVariableName(latex: string): string | null {
  return latex.match(sliderDefinitionPattern)?.[1] ?? null;
}

/** The expression (and its index) whose slider row assigns answerState.param. */
export function findAnswerStateRow(
  expressions: ReadonlyArray<{ latex: string; slider?: Solution["expressions"][number]["slider"] }>,
  param: string,
): { index: number; slider: NonNullable<Solution["expressions"][number]["slider"]> } | null {
  for (let index = 0; index < expressions.length; index += 1) {
    if (sliderVariableName(expressions[index].latex) === param) {
      const slider = expressions[index].slider;
      return slider ? { index, slider } : null;
    }
  }
  return null;
}

/**
 * A slider-dependent answer must name a real slider row with real bounds, sit
 * inside those bounds, and be an integer whenever the slider is int-stepped
 * (the model's own step=1 is the signal that this parameter is integer-only).
 */
export function validateAnswerState(
  expressions: ReadonlyArray<{ latex: string; slider?: Solution["expressions"][number]["slider"] }>,
  answerState: AnswerState,
): void {
  const row = findAnswerStateRow(expressions, answerState.param);
  if (!row) {
    throw new AnswerConsistencyError(
      `answerState.param "${answerState.param}" must name a slider row (a bare "letter=number" row with slider bounds) in the plan.`,
      "answer_state",
    );
  }
  const { slider } = row;
  if (answerState.value < slider.min || answerState.value > slider.max) {
    throw new AnswerConsistencyError(
      `answerState.value ${answerState.value} for ${answerState.param} is outside its slider range [${slider.min}, ${slider.max}].`,
      "answer_state",
    );
  }
  if (slider.step === 1 && !Number.isInteger(answerState.value)) {
    throw new AnswerConsistencyError(
      `${answerState.param} is an integer slider (step 1), so answerState.value must be an integer, not ${answerState.value}.`,
      "answer_state",
    );
  }
  // A slider only stops at min + n*step: an answer between grid points can
  // never be shown by dragging (the student would read the nearest stop).
  const steps = slider.step > 0 ? (answerState.value - slider.min) / slider.step : 0;
  if (slider.step > 0 && Math.abs(steps - Math.round(steps)) > 1e-6) {
    throw new AnswerConsistencyError(
      `${answerState.param}=${answerState.value} is not a stop of its slider (min ${slider.min}, step ${slider.step}); dragging can never land on it. Use a step that reaches the answer, or a regression or one row per choice.`,
      "answer_state",
    );
  }
}

/**
 * Overrides the slider row's own written value with the answer's value, so
 * the calculator opens already at the answer instead of at whatever
 * non-answer starting point the row's own latex declared. Every other row is
 * untouched; the model's original latex is kept for the written explanation.
 */
export function applyAnswerState<T extends { latex: string }>(
  expressions: readonly T[],
  answerState: AnswerState | null | undefined,
): T[] {
  if (!answerState) return [...expressions];
  const name = answerState.param;
  const value = Number.isInteger(answerState.value)
    ? String(answerState.value)
    : String(answerState.value).slice(0, 20);
  return expressions.map((expression) =>
    sliderVariableName(expression.latex) === name
      ? { ...expression, latex: `${name}=${value}` }
      : expression,
  );
}

function observedValue(
  result: SolutionResult,
  evaluation: RowEvaluation,
): number | null {
  if (evaluation.type === "Number") return evaluation.value;
  const index = result.listIndex ?? (evaluation.value.length === 1 ? 1 : null);
  if (index === null || index > evaluation.value.length) return null;
  return evaluation.value[index - 1];
}

/**
 * Browser-side check against what Desmos actually computed on the result row.
 * When the calculator disagrees with the claimed value, the answer is re-derived
 * from the calculator's number so the student never sees a stale letter.
 */
export function reconcileWithCalculator(
  solution: Pick<Solution, "choices" | "result" | "answer" | "expressions">,
  evaluation: RowEvaluation | null | undefined,
): CalculatorCheck {
  const result = solution.result;
  if (!result || !evaluation || !isNumericResult(result) || result.row === null || result.answerFrom === "reasoning" || result.value === null) {
    return { status: "unverified" };
  }
  // A slider row (b=1) shows wherever the student dragged it, not the answer.
  const row = solution.expressions[result.row - 1];
  if (row && (row.slider || isSliderDefinition(row.latex))) return { status: "unverified" };
  let choices: NormalizedChoice[] | null;
  try {
    choices = normalizeChoices(solution.choices);
  } catch {
    return { status: "unverified" };
  }

  if (result.answerFrom === "choice_position") {
    if (evaluation.type !== "ListOfNumber" || result.value === null || !choices) {
      return { status: "unverified" };
    }
    const matches = evaluation.value
      .map((entry, index) => ({ entry, index: index + 1 }))
      .filter(({ entry }) => numbersMatch(entry, result.value as number));
    // An ambiguous or absent match cannot be stated as a specific contradiction.
    if (matches.length !== 1 || matches[0].index > choices.length) {
      return { status: "unverified" };
    }
    const selected = choices[matches[0].index - 1];
    const answer = formatChoice(selected);
    if (matches[0].index === result.listIndex && answer === solution.answer) {
      return {
        status: "verified",
        observed: matches[0].entry,
        message: `Desmos confirms entry ${matches[0].index} of line ${result.row} is ${formatNumber(matches[0].entry)}.`,
      };
    }
    const corrected = { ...result, listIndex: matches[0].index, choiceLabel: selected.label };
    return {
      status: "contradicted",
      observed: matches[0].entry,
      answer,
      readAnswer: describeReadout(corrected, matches[0].entry, answer, selected),
      message: `Desmos shows ${formatNumber(result.value)} at entry ${matches[0].index} of line ${result.row}. That is choice ${answer}, not the stated ${solution.answer}.`,
    };
  }

  const observed = observedValue(result, evaluation);
  if (observed === null || !Number.isFinite(observed)) return { status: "unverified" };
  const where = result.listIndex
    ? `entry ${result.listIndex} of line ${result.row}`
    : `line ${result.row}`;
  let derived: { answer: string; choice: NormalizedChoice | null };
  try {
    derived = deriveAnswer(result, choices, solution.answer, observed, [], "Desmos's value");
  } catch {
    // Computed but matches no answer choice: inconclusive, not a confident
    // contradiction, so nothing is shown rather than an alarming guess.
    return { status: "unverified" };
  }
  if (derived.answer === solution.answer) {
    return {
      status: "verified",
      observed,
      message: `Desmos confirms ${where} shows ${displayProse(result.detail)} = ${formatNumber(observed)}.`,
    };
  }
  const corrected = { ...result, value: observed, choiceLabel: derived.choice?.label ?? null };
  return {
    status: "contradicted",
    observed,
    answer: derived.answer,
    readAnswer: describeReadout(corrected, observed, derived.answer, derived.choice),
    message: `Desmos shows ${displayProse(result.detail)} = ${formatNumber(observed)} on ${where}. That is choice ${derived.answer}, not the stated ${solution.answer}.`,
  };
}
