import {
  AnswerConsistencyError,
  deriveConsistentSolution,
  formatChoice,
  ProseLatexError,
  sanitizeSolutionProse,
} from "./answer-consistency";
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
    `Technique: ${method.name}`,
    `Answer: ${method.answer}`,
    `Readout: ${readout}`,
    `Calculator rows:\n${rows}`,
    method.answerState ? `The calculator opens with ${method.answerState.param} = ${method.answerState.value}.` : null,
    method.conditionType ? `The question asks when the system has ${method.conditionType === "no-solution" ? "no solution" : "infinitely many solutions"}; explain how this method tells that case apart from the opposite one.` : null,
    method.rows.length
      ? `Return why, readAnswer, an empty steps list, and exactly ${method.rows.length} purposes: one plain explanation per calculator row, in row order.`
      : "Return why, readAnswer, 1–4 written steps that reach the answer, and an empty purposes list.",
  ];
  return lines.filter(Boolean).join("\n");
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
  if (slider) return `Slider for ${latex.split("=")[0].trim()}: drag it until the condition in the question appears.`;
  if (/\\sim(?![A-Za-z])|~/.test(latex)) return "Desmos fits the unknown values in this row from the conditions it lists.";
  if (/^\s*[A-Za-z](?:_\{[^{}]*\})?\s*=\s*(?:\\left)?\[/.test(latex)) return "A list of values taken from the question.";
  if (/^\s*[A-Za-z](?:_\{[^{}]*\})?\s*\([^()]*\)\s*=/.test(latex)) return "Defines the function exactly as the question gives it.";
  return "Enter this row exactly as shown.";
}

/**
 * When the explanation call fails or times out, the calculator and answer are
 * still shown with a minimal generated summary instead of failing the solve.
 * Never cached, so a later request can still generate the real explanation.
 */
export function fallbackExplanation(method: Method): Explanation {
  return {
    why: `${method.name}: ${method.shape}.`,
    purposes: method.rows.map((row) => describeRow(row.latex, Boolean(row.slider))),
    readAnswer: null,
    steps: method.rows.length ? [] : [`Apply ${method.name.toLowerCase()} to the givens; the answer is ${method.answer}.`],
  };
}
