import {
  AnswerConsistencyError,
  deriveConsistentSolution,
  formatChoice,
  isApproximationQuestion,
  isWholeNumberQuestion,
  ProseLatexError,
  sanitizeSolutionProse,
} from "./answer-consistency";
import { methodApproach } from "./method-scoring";
import type { CacheEntry, Explanation } from "./solve-cache";
import type { Solution, SolutionMethod } from "./solver-schema";
import type { Method } from "./strategy-selection";

export class ExplanationError extends Error {
  constructor(message: string, readonly stage = "explanation") {
    super(message);
    this.name = "ExplanationError";
  }
}

/** The legacy method field the UI and history still label. */
export function solutionMethodFor(method: Method): SolutionMethod {
  if (method.rows.length > 0) return "desmos";
  if (method.techniqueId === "translate-the-words") return "shortcut";
  if (method.techniqueId === "plug-in-choices") return "plug_in_answers";
  if (method.techniqueId === "direct-arithmetic") return "mental_math";
  return "algebra";
}

/** The per-request input for the explanation call: facts only, all already verified. */
/**
 * A calculator method that still asks for hand work names it: the student
 * should always know exactly which part is math and which part is Desmos. A
 * paper method's written steps already are the math.
 */
export function needsHandMath(method: Pick<Method, "rows" | "cost">): boolean {
  return method.rows.length > 0 && (method.cost.derivationSteps > 0 || method.cost.oneOffFacts > 0);
}

/**
 * Decimals a row types that the question never states, after an earlier row
 * graphs something: the student clicked that point (5.20526, the x-intercept
 * of 3x^2-16x+2) and typed what Desmos showed. Telling the explanation call
 * keeps it from describing a click as a hand computation.
 */
export function clickedValues(question: string, rows: readonly { latex: string }[]): { row: number; value: string }[] {
  const stated = new Set((question.replace(/[\u2212\u2013]/g, "-").match(/\d+(?:\.\d+)?/g) ?? []).map((value) => Number(value)));
  const graphs = (latex: string) => /[xy]/.test(latex.replace(/_\{[^{}]*\}/g, "")) && !/\\sim(?![A-Za-z])|~|\[/.test(latex);
  const found: { row: number; value: string }[] = [];
  rows.forEach((row, index) => {
    if (!rows.slice(0, index).some((earlier) => graphs(earlier.latex))) return;
    for (const value of row.latex.match(/\d+\.\d+/g) ?? []) {
      if (!stated.has(Number(value))) found.push({ row: index + 1, value });
    }
  });
  return found;
}

/** The hand-math line as shown: null when it is empty or only says there is none. */
function handMathLine(text: string | null | undefined): string | null {
  const line = text?.trim() ?? "";
  return !line || /^(?:none|nothing|n\/a|null|no hand (?:math|steps?))\.?$/i.test(line) ? null : line;
}

export function explanationInput(entry: CacheEntry, method: Method): string {
  const choices = entry.choices?.length
    ? entry.choices.map(formatChoice).join("; ")
    : "none (student-produced response)";
  const rows = method.rows.length
    ? method.rows
        .map((row, index) => {
          const slider = row.slider ? `   [slider: min ${row.slider.min}, max ${row.slider.max}, step ${row.slider.step}]` : "";
          return `${index + 1}. ${row.latex}${slider}`;
        })
        .join("\n")
    : "(none: this is a paper technique)";
  const result = method.result;
  const readout = [
    `type ${result.type}`,
    result.row !== null ? `line ${result.row}` : null,
    result.relatedRows.length ? `with line${result.relatedRows.length > 1 ? "s" : ""} ${result.relatedRows.join(", ")}` : null,
    result.listIndex !== null ? `entry ${result.listIndex}` : null,
    result.value !== null ? `value ${result.value}` : null,
    `shows ${result.detail}`,
  ]
    .filter(Boolean)
    .join(", ");
  const lines = [
    `Question: ${entry.question}`,
    `Answer choices: ${choices}`,
    entry.structure ? `Structure the student should recognize: ${entry.structure}` : null,
    `Technique: ${method.name}`,
    `Answer: ${method.answer}`,
    `Readout: ${readout}`,
    `Calculator rows:\n${rows}`,
    method.answerState ? `The calculator opens with ${method.answerState.param} = ${method.answerState.value}.` : null,
    ...clickedValues(entry.question, method.rows).map(({ row, value }) =>
      `Line ${row} types ${value}, a number the question does not state: the student reads it by clicking the matching point (an intercept, intersection, or vertex) on the graph of an earlier line. Say that in line ${row}'s purpose; it is never a hand computation.`),
    method.conditionType ? `The question asks when the system has ${method.conditionType === "no-solution" ? "no solution" : "infinitely many solutions"}; explain how this method tells that case apart from the opposite one.` : null,
    needsHandMath(method)
      ? `Besides typing the rows, this method asks the student for ${method.cost.derivationSteps} hand step(s) and ${method.cost.oneOffFacts} memorized fact(s). Return handMath naming each one in plain words and why it is needed.`
      : method.rows.length
        ? "If the student must decide or know anything beyond typing these rows and reading the result (which given number to type for a constant, a fact the setup relies on), name it in handMath; otherwise handMath is null."
        : "Return handMath: null; the written steps already are the math.",
    method.rows.length
      ? `Return why, readAnswer, an empty steps list, and exactly ${method.rows.length} purposes: one plain explanation per calculator row, in row order. Trace every number in a row that was calculated from the givens or an earlier row; say what operation produces it. For a regression, explain what Desmos adjusts and which supplied conditions it makes agree.`
      : `Return why, readAnswer, 1–4 written steps that reach the answer, and an empty purposes list. ${method.cost.derivationSteps >= 3 ? "Show the intermediate equation or calculation for each nontrivial change; do not compress the work into one 'solve to get the answer' sentence." : "Show any non-obvious calculation instead of skipping to the answer."}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Catch only clear explanation omissions. A broad natural-language grader here
 * would reject valid concise teaching and turn hard solves into extra model
 * calls. These checks target known placeholder prose and multi-step paper work
 * compressed into a single unsupported assertion. The ordinary one-retry path
 * receives the exact reason when a model response fails.
 */
const PAPER_ALGEBRA = /quadratic formula|discriminant|completing the square|b\s*\^?\s*2\s*-\s*4\s*ac|matching coefficients|factor theorem/gi;
const CONTRAST = /\b(?:without|instead of|no|never|not|skip|skips|avoid|avoids|rather than|replaces?|in place of)\b[^.;]*$/i;

/**
 * THE IDEA of a Desmos way that leans on paper algebra ("the quadratic formula
 * gives (16 ± √D)/6, so a is 16") teaches the math way with Desmos attached.
 * Naming it as what the method avoids ("instead of the quadratic formula") is fine.
 */
export function leansOnPaperAlgebra(method: Pick<Method, "techniqueId" | "rows" | "approach">, why: string): string | null {
  if (method.rows.length === 0 || methodApproach(method) === "math") return null;
  for (const match of why.matchAll(PAPER_ALGEBRA)) {
    const before = why.slice(Math.max(0, match.index - 60), match.index);
    if (!CONTRAST.test(before)) return match[0];
  }
  return null;
}

export function validateExplanationQuality(method: Method, explanation: Explanation): void {
  const why = explanation.why.trim();
  const paper = leansOnPaperAlgebra(method, why);
  if (paper) {
    throw new ExplanationError(
      `The idea explains this Desmos way through paper algebra (${paper}). Explain the Desmos trick itself: what the student recognizes, what the graph, regression, slider, or list does, and why that answers the question. Mention ${paper} only as what this method avoids.`,
      "explanation_quality",
    );
  }
  if (needsHandMath(method) && !explanation.handMath?.trim()) {
    throw new ExplanationError(
      `This method asks the student for ${method.cost.derivationSteps} hand step(s) and ${method.cost.oneOffFacts} memorized fact(s) besides typing the rows. handMath must name each one and why it is needed.`,
      "explanation_quality",
    );
  }
  if (/^(?:use|apply|try)\s+(?:desmos|regression|graphing|this (?:method|technique))\s*(?:to solve(?: the problem)?)?[.!]?$/i.test(why)) {
    throw new ExplanationError("The idea only names a tool. Explain why this method answers the question.", "explanation_quality");
  }
  for (const [index, purpose] of explanation.purposes.entries()) {
    const text = purpose.trim();
    if (
      /^(?:enter|type|copy|write|plot|graph|evaluate|calculate|read|use|apply|define|show|check|solve)\s+(?:this|the)\s+(?:row|line|equation|expression|function|list|graph|regression)(?:\s+(?:in|with)\s+desmos)?[.!]?$/i.test(text) ||
      /^explains? what line \d+ makes desmos do[.!]?$/i.test(text) ||
      /^(?:apply|run|use) regression[.!]?$/i.test(text)
    ) {
      throw new ExplanationError(`Line ${index + 1} needs the given information it uses, what Desmos does with it, and why that helps.`, "explanation_quality");
    }
  }
  const prose = [why, ...explanation.purposes, explanation.readAnswer ?? "", ...explanation.steps].join(" ");
  const hasSlider = method.rows.some((row) => row.slider !== null);
  const hasRegression = method.rows.some((row) => /\\sim(?![A-Za-z])|~/.test(row.latex));
  if (
    hasSlider && !hasRegression &&
    (/\b(?:value|parameter|answer)\s+(?:that\s+)?Desmos\s+(?:found|solved|computed|calculated|returned|fit)\b/i.test(prose) ||
      /\bDesmos\s+(?:found|solved|computed|calculated|returned|fit)\s+(?:the\s+)?(?:slider|parameter|answer|least|greatest)\b/i.test(prose))
  ) {
    throw new ExplanationError(
      "A slider does not solve for its own value. Explain what the student changes and observes instead of saying Desmos found the parameter.",
      "explanation_quality",
    );
  }
  const extremum = /\b(?:least|smallest|greatest|largest)\s+(?:(?:possible|allowed)\s+)?integer\b/i.exec(method.result.detail);
  const state = method.answerState;
  const slider = method.rows.find((row) => row.slider && row.latex.replace(/\s+/g, "").startsWith(`${state?.param}=`))?.slider;
  if (extremum && state && slider && Number.isInteger(slider.step)) {
    const lower = /least|smallest/i.test(extremum[0]);
    const adjacent = state.value + (lower ? -slider.step : slider.step);
    const readout = explanation.readAnswer ?? "";
    const param = state.param.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nearbyValue = new RegExp(`(?:^|[^A-Za-z0-9_])${param}\\s*=\\s*${adjacent}(?![\\d.])`, "i").test(readout);
    const nearbyStep = /\b(?:one|1|single)\s+(?:slider\s+)?(?:step|integer)\s+(?:below|above|lower|higher|smaller|larger)\b|\b(?:previous|next)\s+integer\b/i.test(readout);
    const failure = /\b(?:fails?|violates?|doesn't|does\s+not|no\s+longer|touches|crosses|intersects|below|above)\b/i.test(readout);
    if (adjacent >= slider.min && adjacent <= slider.max && (!(nearbyValue || nearbyStep) || !failure)) {
      throw new ExplanationError(
        `The slider claims the ${lower ? "least" : "greatest"} integer ${state.param}. Show why the adjacent allowed integer fails the condition, so the boundary is justified.`,
        "explanation_quality",
      );
    }
  }
  if (method.rows.length === 0 && method.cost.derivationSteps >= 3 && explanation.steps.length === 1) {
    const equations = explanation.steps[0].match(/=/g)?.length ?? 0;
    if (equations < 2) {
      throw new ExplanationError(
        "This written method has several derivation steps, but only one step with no intermediate equation chain was supplied. Show the steps that lead to the answer.",
        "explanation_quality",
      );
    }
  }
}

/**
 * Merges a method with its explanation into the solution shape the calculator
 * and history render. Rows, readout, and answer come from the verified method;
 * only prose comes from the explanation. Throws ExplanationError on a mismatch.
 */
export function presentMethod(entry: CacheEntry, method: Method, explanation: Explanation): Solution {
  if (method.rows.length > 0 && explanation.purposes.length !== method.rows.length) {
    throw new ExplanationError(
      `purposes must have exactly one entry per calculator row: expected ${method.rows.length}, got ${explanation.purposes.length}.`,
    );
  }
  if (method.rows.length === 0 && explanation.steps.length === 0) {
    throw new ExplanationError("A technique without calculator rows needs 1–4 written steps.");
  }
  let consistent;
  try {
    consistent = deriveConsistentSolution({
      choices: entry.choices,
      result: method.result,
      answer: method.answer,
      readAnswer: explanation.readAnswer ?? "",
      expressionCount: method.rows.length,
      approximate: isApproximationQuestion(entry.question),
      wholeNumber: isWholeNumberQuestion(entry.question),
    });
  } catch (error) {
    if (error instanceof AnswerConsistencyError) throw new ExplanationError(error.message, error.stage);
    throw error;
  }
  const solution: Solution = {
    status: "solved",
    question: entry.question,
    choices: consistent.choices,
    structure: entry.structure,
    trick: method.name,
    answer: consistent.answer,
    method: solutionMethodFor(method),
    why: explanation.why.trim(),
    handMath: method.rows.length ? handMathLine(explanation.handMath) : null,
    steps: method.rows.length ? [] : explanation.steps.map((step) => step.trim()),
    readAnswer: consistent.readAnswer,
    expressions: method.rows.map((row, index) => ({
      latex: row.latex,
      purpose: explanation.purposes[index].trim(),
      ...(row.slider ? { slider: row.slider } : {}),
    })),
    result: consistent.result,
    answerState: method.answerState,
    parameters: method.parameters,
    conditionType: method.conditionType,
    distinguishes: method.distinguishes,
    graphBounds: method.graphBounds,
    clarification: null,
  };
  try {
    return sanitizeSolutionProse(solution);
  } catch (error) {
    if (error instanceof ProseLatexError) throw new ExplanationError(error.message, "prose_text");
    throw error;
  }
}

function describeRow(latex: string, slider: boolean): string {
  if (slider) return `This creates a slider for ${latex.split("=")[0].trim()}. Move it until the graph meets the condition in the question; then read the slider's value.`;
  if (/\\sim(?![A-Za-z])|~/.test(latex)) return "Desmos adjusts the unknown values so the expressions on both sides agree for the listed inputs. The fitted values appear under Regression Parameters.";
  if (/^\s*[A-Za-z](?:_\{[^{}]*\})?\s*=\s*(?:\\left)?\[/.test(latex)) return "This stores the displayed inputs as a list so the following row can test them together.";
  if (/^\s*[A-Za-z](?:_\{[^{}]*\})?\s*\([^()]*\)\s*=/.test(latex)) return "This names a function so a later row can evaluate or graph it without retyping the expression.";
  if (/^\s*[xy]\s*=/.test(latex)) return "This draws the equation on the graph. Inspect the feature named under Read the result.";
  if (/^\s*[A-Za-z](?:_\{[^{}]*\})?\s*\([^()]*\)\s*$/.test(latex)) return "This evaluates a function defined above at the input shown here, so Desmos displays its value.";
  return "This row is part of the calculator setup. Its detailed role could not be loaded; retry the explanation for the full walkthrough.";
}

/**
 * When the explanation call fails or times out, the calculator and answer are
 * still shown with a minimal generated summary instead of failing the solve.
 * Never cached, so a later request can still generate the real explanation.
 */
export function fallbackExplanation(method: Method): Explanation {
  return {
    why: `The detailed explanation for ${method.name} did not load. Retry the explanation to see how the given information leads to the answer.`,
    handMath: needsHandMath(method) ? `Besides typing the rows, this method needs ${method.cost.derivationSteps + method.cost.oneOffFacts} short step(s) done by hand; retry the explanation to see them.` : null,
    purposes: method.rows.map((row) => describeRow(row.latex, Boolean(row.slider))),
    readAnswer: null,
    steps: method.rows.length ? [] : ["The written steps did not load. Retry the explanation to see the calculation that produces the answer."],
  };
}
