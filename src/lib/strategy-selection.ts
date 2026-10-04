import { z } from "zod";

import {
  AnswerConsistencyError,
  deriveConsistentSolution,
  normalizeChoices,
  ProseLatexError,
  sanitizeProse,
  validateAnswerState,
} from "./answer-consistency";
import {
  findDerivedConstants,
  findDerivedDefinitions,
  findProseRows,
  findUndefinedVariables,
  normalizeDesmosExpressions,
  unwrapSyntheticResultAlias,
} from "./desmos-latex";
import {
  assignBadges,
  compareMethods,
  deriveCost,
  describeShape,
  mathLevel,
  mathScore,
  methodFamily,
  rowSignature,
  totalCost,
  BADGES,
  METHOD_FAMILIES,
} from "./method-scoring";
import { hasUnnecessaryCoefficientLists } from "./regression-workflow";
import {
  answerChoiceSchema,
  answerStateSchema,
  CONDITION_TYPES,
  DISTINGUISH_METHODS,
  graphBoundsSchema,
  MAX_EXPRESSIONS,
  parameterSchema,
  sliderSchema,
  typedResultSchema,
  type AnswerChoice,
  type ConditionType,
  type Parameter,
} from "./solver-schema";
import {
  checkConditionCompleteness,
  findIntegerParameterViolations,
  findListShapeViolations,
  findRegressionDeterminacyViolations,
} from "./solver-rules";
import { getTechnique, TECHNIQUE_IDS, techniqueName, type TechniqueId } from "./technique-vocabulary";

/**
 * Every technique that validly solves the problem, up to six: the dropdown is
 * for picking a technique the student already knows, so it lists all real
 * options, not just the best two. More than six grows output tokens for
 * options no student scrolls to.
 */
export const MAX_CANDIDATES = 6;

const count = z.number().int().min(0).max(20);

/** Model-reported judgment. Row count is measured by the server, never reported. */
export const reportedCostSchema = z
  .object({
    derivationSteps: count,
    newPrimitives: count,
    oneOffFacts: count,
    setupConstructions: count,
    manualIterations: count,
  })
  .strict();

const candidateRowSchema = z
  .object({
    latex: z.string().min(1).max(1000),
    slider: sliderSchema.nullable().default(null),
    // The earlier row whose displayed fitted result this row copies (freezing
    // a regression before a chained fit); those constants are not derived.
    copiesRow: z.number().int().min(1).max(MAX_EXPRESSIONS).nullable().default(null),
  })
  .strict();

/** One terse candidate technique: rows, readout, and cost components. No prose. */
export const candidateSchema = z
  .object({
    techniqueId: z.enum(TECHNIQUE_IDS),
    rung: z.number().int().min(0).max(4),
    rows: z.array(candidateRowSchema).max(MAX_EXPRESSIONS),
    answer: z.string().max(500),
    result: typedResultSchema,
    answerState: answerStateSchema.default(null),
    parameters: z.array(parameterSchema).max(6).default([]),
    conditionType: z.enum(CONDITION_TYPES).nullable().default(null),
    distinguishes: z.enum(DISTINGUISH_METHODS).nullable().default(null),
    graphBounds: graphBoundsSchema.nullable(),
    cost: reportedCostSchema,
  })
  .strict();

/** Call 1: transcription, recognized structure, and 1–6 named techniques. */
export const candidatesResponseSchema = z.object({
  status: z.enum(["solved", "needs_clarification"]),
  question: z.string().max(8000),
  choices: z.array(answerChoiceSchema).max(8).nullable().default(null),
  clarification: z.string().max(1000).nullable(),
  structure: z.string().max(240).default(""),
  candidates: z.array(candidateSchema).max(MAX_CANDIDATES),
  // Logged when it disagrees with the server's argmin; never used to select.
  preferredTechniqueId: z.enum(TECHNIQUE_IDS).nullable(),
});

export type Candidate = z.infer<typeof candidateSchema>;
export type CandidatesResponse = z.infer<typeof candidatesResponseSchema>;
export type CandidatesResponseInput = z.input<typeof candidatesResponseSchema>;

const costSchema = reportedCostSchema.extend({ rows: z.number().int().min(0) });

/** A scored candidate as cached and returned. */
export const methodSchema = z.object({
  id: z.string().min(1),
  techniqueId: z.enum(TECHNIQUE_IDS),
  name: z.string().min(1),
  rung: z.number().int().min(0).max(4),
  rows: z.array(z.object({ latex: z.string(), slider: sliderSchema.nullable() })),
  answer: z.string(),
  result: typedResultSchema,
  answerState: answerStateSchema,
  parameters: z.array(parameterSchema),
  conditionType: z.enum(CONDITION_TYPES).nullable(),
  distinguishes: z.enum(DISTINGUISH_METHODS).nullable(),
  graphBounds: graphBoundsSchema.nullable(),
  cost: costSchema,
  total: z.number(),
  mathScore: z.number(),
  mathLevel: z.enum(["low", "medium", "high"]),
  shape: z.string(),
  // Optional: entries cached before families existed still load.
  family: z.enum(METHOD_FAMILIES).optional(),
  badges: z.array(z.enum(BADGES)),
  rejected: z.object({ rule: z.string(), reason: z.string() }).nullable(),
  repairs: z.array(z.string()),
});
export type Method = z.infer<typeof methodSchema>;

export type MethodSelection = {
  question: string;
  choices: AnswerChoice[] | null;
  structure: string | null;
  /** Eligible methods in rank order (winner first), then rejected ones. */
  methods: Method[];
  winnerId: string;
  modelPreference: TechniqueId | null;
};

export class StrategySelectionError extends Error {
  constructor(message: string, readonly stage = "strategy_selection") {
    super(message);
    this.name = "StrategySelectionError";
  }
}

type Rejection = { rule: string; reason: string; stage: string };

/**
 * "Which equation represents this situation?" asks for the model, not its
 * solution. Matching an equation to a supplied graph or table is different:
 * graphing can legitimately distinguish those choices.
 */
export function isRepresentationQuestion(question: string): boolean {
  const text = question.replace(/\s+/g, " ");
  return (
    /\bwhich\b[^?]{0,120}?\b(?:equations?|expressions?|inequalit(?:y|ies)|systems?|functions?|models?)\b[^?]{0,120}?\b(?:represents?|models?|could be used|can be used|describes?)\b/i.test(text) &&
    !/\b(?:graph|table|scatter ?plot|figure|shown|equivalent)\b/i.test(text) &&
    // "Which expression represents a solution to <equation>" asks for a solution, not a model.
    !/\brepresents?\s+(?:(?:one|a|the|all|each)\s+)?(?:possible\s+)?(?:solutions?|roots?|zeros?|values?\s+of)\b/i.test(text)
  );
}

/**
 * A question asking for a value that makes a system have no solution. Rule 3
 * must apply to every candidate for such a question, including one whose
 * model output left conditionType null: a paper "equate the slopes" method is
 * exactly the half-condition it catches, and cost selection would otherwise
 * make it the default. Infinitely-many questions are left to the model's own
 * conditionType: there the requested value (b/d, g/k) usually comes from the
 * constants' ratio itself, so a ratio computation is already complete.
 */
export function questionCondition(question: string): ConditionType | null {
  const text = question.replace(/\s+/g, " ");
  if (!/\bvalues?\b|\bconstant\b|\bwhat is [a-z]\b/i.test(text)) return null;
  if (/\binfinitely many solutions\b|\binfinite (?:number of )?solutions\b/i.test(text)) return null;
  if (/\bno solutions?\b|\bno real solutions?\b/i.test(text)) return "no-solution";
  return null;
}

/** The condition is given; a ratio of coefficients follows from the common scale factor. */
function isGivenInfiniteSolutionRatioQuestion(question: string): boolean {
  const text = question.replace(/\s+/g, " ");
  return /\binfinitely many solutions\b|\binfinite (?:number of )?solutions\b/i.test(text) &&
    /\bwhat is (?:the value of )?[a-z]\s*\/\s*[a-z]\s*\?/i.test(text);
}

/** A short literal list used only as numbered storage adds work to scalar arithmetic. */
function hasDisposableScalarList(rows: ReadonlyArray<{ latex: string }>): boolean {
  for (const [index, { latex }] of rows.entries()) {
    const declaration = latex.match(/^\s*([A-Za-z](?:_\{[A-Za-z0-9]+\}|_[A-Za-z0-9])?)\s*=\s*\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){1,3}\s*\]\s*$/);
    if (!declaration) continue;
    const name = declaration[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const indexed = new RegExp(`(?<![A-Za-z\\\\])${name}\\s*\\[\\s*\\d+\\s*\\]`, "g");
    const bare = new RegExp(`(?<![A-Za-z\\\\])${name}(?![A-Za-z0-9_{])`);
    let references = 0;
    let onlyIndexed = true;
    rows.forEach((row, rowIndex) => {
      if (rowIndex === index) return;
      const withoutIndices = row.latex.replace(indexed, () => {
        references += 1;
        return "";
      });
      if (bare.test(withoutIndices)) onlyIndexed = false;
    });
    if (references > 0 && onlyIndexed) return true;
  }
  return false;
}

/**
 * One constraint on x and y usually leaves infinitely many possible pairs.
 * Evaluating the target at one convenient pair is only enough if the plan
 * first shows the target does not change as the pair moves along that line.
 */
function hasUnprovenSingleSample(question: string, rows: ReadonlyArray<{ latex: string }>, resultRow: number | null): boolean {
  const premise = question.match(/\b(?:if|given(?: that)?)\s+([^,?]{1,100}),\s*what is (?:the )?value of\b/i)?.[1];
  if (!premise || !premise.includes("x") || !premise.includes("y") || !premise.includes("=")) return false;
  const target = question.split(/\bwhat is (?:the )?value of\b/i)[1] ?? "";
  if (!target.includes("x") || !target.includes("y") || resultRow === null) return false;
  const evaluated = rows[resultRow - 1]?.latex.replace(/\s+/g, "").match(/^([A-Za-z](?:_\{[^{}]+\})?)\((-?\d+(?:\.\d+)?)\)$/);
  if (!evaluated) return false;
  const [, name, input] = evaluated;
  const definition = rows.some(({ latex }) => latex.replace(/\s+/g, "").startsWith(`${name}(x)=`));
  if (!definition) return false;
  const difference = `${name}(x)-${name}(${input})`;
  return !rows.some(({ latex }) => latex.replace(/\s+/g, "").includes(difference));
}

/**
 * Parameters the question itself restricts to integers ("where a is an
 * integer greater than 1", "b is a positive integer constant", "positive
 * integers n"). Rule 1 must apply even when a candidate did not declare them.
 */
export function questionIntegerParameters(question: string): Parameter[] {
  const names = new Set<string>();
  const kinds = String.raw`(?:positive |negative |nonnegative |nonzero )?(?:integers?|whole numbers?|counting numbers?)`;
  for (const match of question.matchAll(new RegExp(String.raw`\b([a-z])\s+(?:is|are)\s+(?:an?\s+)?${kinds}`, "gi"))) names.add(match[1]);
  // "positive integer j and k", "positive integers k, a, b, c, and d"
  for (const match of question.matchAll(new RegExp(String.raw`\b${kinds}\s+([a-z]\b(?:\s*,\s*[a-z]\b)*(?:\s*,?\s*and\s+[a-z]\b)?)`, "gi"))) {
    for (const name of match[1].match(/\b[a-z]\b/gi) ?? []) if (name.toLowerCase() !== "and") names.add(name);
  }
  // "a, b, c, and d are all integer constants" applies to every named
  // coefficient, not just the final d. Continuous regression cannot enforce it.
  const group = /((?:\b[a-z]\b\s*,\s*)+\b[a-z]\b)\s+are\s+(?:all\s+)?(?:positive\s+|negative\s+|nonnegative\s+|nonzero\s+)?(?:integers?\b|whole numbers?\b|counting numbers?\b)/gi;
  const groupedText = question.replace(/,?\s+and\s+(?=[a-z]\b\s+are\b)/gi, ", ");
  for (const match of groupedText.matchAll(group)) {
    for (const name of match[1].match(/\b[a-z]\b/gi) ?? []) names.add(name.toLowerCase());
  }
  // x and y are graph coordinates, never parameters a row introduces.
  return [...names].filter((name) => !/^[xyt]$/i.test(name)).map((name) => ({ name, integer: true, min: -1000, max: 1000 }));
}

/** A single fitted factorization cannot establish an extremum over integer factorizations. */
export function isIntegerFactorExtremumQuestion(question: string): boolean {
  // A factorization may be named ("factor") or just written: k(ax^2+b)(cx^2+d).
  const factorization = /\bfactor(?:s|ed|ization)?\b/i.test(question) ||
    /\([^()]*[a-z][^()]*[+-][^()]*\)\s*\([^()]*[a-z][^()]*[+-][^()]*\)/i.test(question.replace(/\s+/g, ""));
  return /\b(?:maximum|minimum|greatest|least)\b/i.test(question) &&
    factorization &&
    /\bintegers?\b/i.test(question);
}

type Interval = { low: number; high: number };

/** A stated continuous domain such as 2 <= x <= 8 (not one restricted to integers). */
export function continuousInterval(question: string): Interval | null {
  if (/\b(?:integers?|whole numbers?|counting numbers?)\b/i.test(question)) return null;
  const text = question.replace(/≤/g, "<=").replace(/[−–]/g, "-");
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*<=?\s*[a-z]\s*<=?\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const [low, high] = [Number(match[1]), Number(match[2])];
  return low < high ? { low, high } : null;
}

/** An integer list that walks the interval one unit at a time, e.g. [2...8] for 2 <= x <= 8. */
export function samplesInterval(rows: readonly { latex: string }[], interval: Interval): boolean {
  const start = Math.ceil(interval.low);
  const end = Math.floor(interval.high);
  if (end - start < 2) return false;
  for (const { latex } of rows) {
    for (const [, body] of latex.replace(/\\left|\\right/g, "").matchAll(/\[([^\[\]]*)\]/g)) {
      const range = body.match(/^\s*(-?\d+)\s*\.\.\.\s*(-?\d+)\s*$/);
      if (range && Number(range[1]) <= start && Number(range[2]) >= end) return true;
      const values = body.split(",").map((part) => Number(part.trim()));
      const consecutive =
        values.length >= 3 &&
        values.every((value, index) => Number.isInteger(value) && (index === 0 || value === values[index - 1] + 1));
      if (consecutive && values[0] <= start && values[values.length - 1] >= end) return true;
    }
  }
  return false;
}

type CandidateContext = {
  question: string;
  choices: AnswerChoice[] | null;
  representation: boolean;
  interval: Interval | null;
  condition: ConditionType | null;
  integers: Parameter[];
  integerFactorExtremum: boolean;
};

type Validated = Omit<Method, "id" | "badges" | "rejected" | "total" | "mathScore" | "mathLevel" | "shape" | "cost" | "name"> & {
  rawCost: Candidate["cost"];
};

function reject(rule: string, reason: string, stage = "strategy_policy"): Rejection {
  return { rule, reason, stage };
}

/** Every hard rejection, applied before scoring. Never priced, never selectable. */
function validateCandidate(candidate: Candidate, context: CandidateContext): Validated | Rejection {
  const { question, choices } = context;
  const repairs: string[] = [];
  // For a stated infinitely-many condition, b/d-style ratio questions ask
  // for the common scale factor itself. A direct computation need not prove
  // that a separate parameter makes two graphed lines coincide.
  const conditionType = candidate.techniqueId === "direct-arithmetic" && isGivenInfiniteSolutionRatioQuestion(question)
    ? null
    : candidate.conditionType ?? context.condition;
  const declared = new Set(candidate.parameters.map((parameter) => parameter.name));
  const parameters = [...candidate.parameters, ...context.integers.filter((parameter) => !declared.has(parameter.name))];
  const rows = normalizeDesmosExpressions(
    candidate.rows.map((row) => ({
      latex: row.latex,
      purpose: row.copiesRow ? `Copies the displayed fitted equation from line ${row.copiesRow}.` : "",
      slider: row.slider,
    })),
  );

  if (rows.some((row) => !row.latex.trim())) {
    return reject("row-fails-to-insert", "A calculator row normalizes to empty.", "desmos_syntax");
  }
  if (context.representation && rows.length > 0) {
    return reject(
      "answers-different-question",
      "The question asks which equation or expression represents the situation; calculator rows solve or graph it instead of identifying the model.",
    );
  }
  if (context.integerFactorExtremum &&
      rows.some((row) => /\\sim(?![A-Za-z])|~/.test(row.latex)) &&
      !rows.some((row) => /\\operatorname\{(?:max|min)\}|\\(?:max|min)\b/.test(row.latex))) {
    return reject(
      "unproven-extremum",
      "A regression gives one factorization, not the greatest or least value. Enumerate the allowed integer factors and take max or min of every resulting coefficient.",
    );
  }
  const proseRows = findProseRows(rows);
  if (proseRows.length) {
    return reject("row-fails-to-insert", `Line ${proseRows.join(", ")} contains prose instead of a Desmos expression.`, "desmos_syntax");
  }
  const listShapes = findListShapeViolations(rows);
  if (listShapes.length) {
    return reject(
      "list-shape",
      listShapes
        .map((violation) =>
          violation.kind === "singleton"
            ? `Line ${violation.row} (${violation.latex}) wraps a single value in a one-element list, so every expression using ${violation.name} becomes a list; write an unknown as a bare letter the regression leaves undefined, and a single sample input as a plain number (an identity needs degree+1 inputs anyway)`
            : `Line ${violation.row} puts a list inside a list (${violation.element}); Desmos has no nested lists, so the row errors and every row that depends on it errors too`,
        )
        .join("; "),
      "desmos_syntax",
    );
  }
  if (hasUnnecessaryCoefficientLists(rows, question)) {
    return reject(
      "coefficient-lists",
      "Unnecessary coefficient lists for a small system. Use direct bracket regression [left side 1,left side 2]~[right side 1,right side 2], copying the original equations.",
    );
  }
  if (candidate.techniqueId === "list-evaluation" && hasDisposableScalarList(rows)) {
    return reject(
      "disposable-scalar-list",
      "A short list stores given numbers only to read them back by fixed index. Enter the arithmetic directly.",
    );
  }
  if (hasUnprovenSingleSample(question, rows, candidate.result.row)) {
    return reject(
      "unproven-invariance",
      "The given equation permits many x,y pairs. Evaluating the requested expression at one convenient x does not show every pair gives the same value. Add a row such as E(x)-E(0) that visibly stays at zero, or show an exact identity in a written method.",
    );
  }
  const derived = findDerivedConstants(rows, question, choices);
  if (derived.length) {
    return reject(
      "hidden-derivation",
      `Line ${derived.map((item) => `${item.row} uses ${item.constants.join(", ")}`).join("; ")}: those numbers are not in the question, so the plan was derived by hand.`,
    );
  }
  let derivedDefinitions = findDerivedDefinitions(rows, question);
  const resultRow = candidate.result.row;
  if (resultRow !== null && candidate.result.answerFrom === "value" && derivedDefinitions.some(({ row }) => row === resultRow)) {
    const readout = rows[resultRow - 1] ? unwrapSyntheticResultAlias(rows[resultRow - 1].latex, question) : null;
    if (readout) {
      rows[resultRow - 1] = { ...rows[resultRow - 1], latex: readout };
      repairs.push(`Removed the synthetic result alias on line ${resultRow}; Desmos evaluates ${readout} directly.`);
      derivedDefinitions = findDerivedDefinitions(rows, question);
    }
  }
  if (derivedDefinitions.length) {
    return reject(
      "hidden-derivation",
      `Line ${derivedDefinitions.map((item) => `${item.row} defines a value by a formula in the fitted parameter ${item.parameters.join(", ")}`).join("; ")}: that formula was derived by hand.`,
    );
  }
  const undefinedVariables = findUndefinedVariables(rows);
  if (undefinedVariables.length) {
    return reject(
      "row-fails-to-insert",
      undefinedVariables.map(({ row, variables }) => `Line ${row} uses undefined ${variables.join(", ")}`).join("; "),
      "desmos_syntax",
    );
  }
  const integerViolations = findIntegerParameterViolations(rows, parameters);
  if (integerViolations.length) {
    return reject(
      "integer-not-encoded",
      integerViolations
        .map(({ row, param }) => `Line ${row} constrains ${param} with only an inequality, but ${param} must be an integer; use an integer list or an integer-step slider.`)
        .join("; "),
    );
  }
  const determinacy = findRegressionDeterminacyViolations(rows);
  if (determinacy.length) {
    return reject(
      "underdetermined-regression",
      determinacy
        .map((violation) =>
          violation.kind === "underdetermined"
            ? `Line ${violation.row} is an underdetermined regression: ${violation.freeParams} free parameters (${violation.params.join(", ")}) but only ${violation.constraints} data constraints.`
            : `Line ${violation.row} fits lists of mismatched length (${Object.entries(violation.lengths).map(([name, length]) => `${name}: ${length}`).join(", ")}).`,
        )
        .join("; "),
    );
  }
  if (context.interval && samplesInterval(rows, context.interval)) {
    return reject(
      "discrete-sampling",
      `The domain ${context.interval.low} to ${context.interval.high} is continuous; sampling only integer inputs can miss the true value. Graph the function with the restriction instead.`,
    );
  }
  // result.detail is a short readout label; LaTeX there (\sqrt{...}) is a
  // formatting slip, not a method defect, so it gets a neutral label instead
  // of costing the student a valid technique. No LaTeX reaches the student.
  let result = candidate.result;
  try {
    sanitizeProse(result.detail, "result.detail");
  } catch (error) {
    if (!(error instanceof ProseLatexError)) throw error;
    const label = result.row !== null ? `the output on line ${result.row}` : "the answer";
    repairs.push(`The readout label was LaTeX and was replaced with "${label}".`);
    result = { ...result, detail: label };
  }
  if (candidate.answerState) {
    try {
      validateAnswerState(rows, candidate.answerState);
    } catch (error) {
      if (error instanceof AnswerConsistencyError) return reject("answer-state", error.message, error.stage);
      throw error;
    }
  }
  let consistent;
  try {
    consistent = deriveConsistentSolution({
      choices,
      result,
      answer: candidate.answer,
      readAnswer: "",
      expressionCount: rows.length,
    });
  } catch (error) {
    if (error instanceof AnswerConsistencyError) return reject("answer-consistency", error.message, error.stage);
    throw error;
  }
  if (rows.length === 0 && "type" in consistent.result && consistent.result.type !== "written") {
    return reject("answer-consistency", "A technique without calculator rows must use the written result type.", "result_contract");
  }
  const condition = checkConditionCompleteness({
    conditionType,
    distinguishes: candidate.distinguishes,
    result: consistent.result,
    answerState: candidate.answerState,
    expressions: rows,
  });
  if (condition && "error" in condition) return reject("condition-incomplete", condition.error);
  let answer: string;
  try {
    answer = sanitizeProse(consistent.answer, "answer");
  } catch (error) {
    if (error instanceof ProseLatexError) return reject("prose-latex", error.message, "prose_text");
    throw error;
  }
  const bounds = candidate.graphBounds;
  const validBounds = bounds && bounds.left < bounds.right && bounds.bottom < bounds.top;
  return {
    techniqueId: candidate.techniqueId,
    rung: candidate.rung,
    rows: rows.map(({ latex, slider }) => ({ latex, slider: slider ?? null })),
    answer,
    result: consistent.result as Method["result"],
    answerState: candidate.answerState,
    parameters,
    conditionType,
    distinguishes: condition ? condition.distinguishes : candidate.distinguishes,
    graphBounds: validBounds ? bounds : null,
    rawCost: candidate.cost,
    // The generated read instruction is replaced by the explanation call.
    repairs: [...repairs, ...consistent.repairs.filter((repair) => !repair.startsWith("The read instruction was missing"))],
  };
}

function scored(id: string, validated: Validated): Omit<Method, "badges" | "rejected"> {
  const cost = deriveCost(validated.rawCost, validated.rows.length, validated.techniqueId);
  const score = mathScore(cost);
  const { rawCost, ...rest } = validated;
  void rawCost;
  return {
    ...rest,
    id,
    name: techniqueName(validated.techniqueId),
    cost,
    total: totalCost(cost),
    mathScore: score,
    mathLevel: mathLevel(score),
    shape: describeShape({ techniqueId: validated.techniqueId, rows: validated.rows, cost }),
    family: methodFamily(validated.techniqueId, validated.rows),
  };
}

function rejectedMethod(id: string, candidate: Candidate, rejection: Rejection): Method {
  const rows = candidate.rows.map(({ latex, slider }) => ({ latex, slider }));
  const cost = deriveCost(candidate.cost, rows.length, candidate.techniqueId);
  const score = mathScore(cost);
  return {
    id,
    techniqueId: candidate.techniqueId,
    name: techniqueName(candidate.techniqueId),
    rung: candidate.rung,
    rows,
    answer: candidate.answer,
    result: candidate.result,
    answerState: candidate.answerState,
    parameters: candidate.parameters,
    conditionType: candidate.conditionType,
    distinguishes: candidate.distinguishes,
    graphBounds: candidate.graphBounds,
    cost,
    total: totalCost(cost),
    mathScore: score,
    mathLevel: mathLevel(score),
    shape: describeShape({ techniqueId: candidate.techniqueId, rows, cost }),
    family: methodFamily(candidate.techniqueId, rows),
    badges: [],
    rejected: { rule: rejection.rule, reason: rejection.reason },
    repairs: [],
  };
}

/**
 * Applies every hard rejection, scores the survivors, and takes the argmin of
 * total cost. The model's stated preference never selects; it is only kept so
 * a disagreement can be logged. Throws when no candidate survives.
 */
export function selectMethods(response: CandidatesResponse): MethodSelection {
  if (response.status !== "solved") {
    throw new StrategySelectionError("Only a solved response has methods to select.");
  }
  if (!response.question.trim()) {
    throw new StrategySelectionError("A solved response needs the transcribed question.");
  }
  if (response.candidates.length === 0) {
    throw new StrategySelectionError("A solved response needs at least one candidate technique.");
  }
  let choices: AnswerChoice[] | null;
  try {
    choices = normalizeChoices(response.choices)?.map(({ label, text }) => ({ label, text })) ?? null;
  } catch (error) {
    if (error instanceof AnswerConsistencyError) throw new StrategySelectionError(error.message, error.stage);
    throw error;
  }
  const context: CandidateContext = {
    question: response.question,
    choices,
    representation: isRepresentationQuestion(response.question),
    interval: continuousInterval(response.question),
    condition: questionCondition(response.question),
    integers: questionIntegerParameters(response.question),
    integerFactorExtremum: isIntegerFactorExtremumQuestion(response.question),
  };

  const seen = new Set<TechniqueId>();
  const eligible: Omit<Method, "badges" | "rejected">[] = [];
  const rejected: (Method & { stage: string })[] = [];
  response.candidates.forEach((candidate, index) => {
    if (seen.has(candidate.techniqueId)) {
      const rejection = reject("duplicate-technique", `${techniqueName(candidate.techniqueId)} is already listed; each candidate must be a distinct technique.`);
      rejected.push({ ...rejectedMethod(`${candidate.techniqueId}#${index + 1}`, candidate, rejection), stage: rejection.stage });
      return;
    }
    seen.add(candidate.techniqueId);
    const outcome = validateCandidate(candidate, context);
    if ("rule" in outcome) rejected.push({ ...rejectedMethod(candidate.techniqueId, candidate, outcome), stage: outcome.stage });
    else eligible.push(scored(candidate.techniqueId, outcome));
  });

  if (eligible.length === 0) {
    throw new StrategySelectionError(
      `Every candidate was rejected: ${rejected.map((method) => `${method.name} (${method.rejected!.rule}): ${method.rejected!.reason}`).join(" | ")}`,
      rejected[0]?.stage ?? "strategy_policy",
    );
  }

  // The same rows under a second technique name teach nothing new (a graph
  // of y=x^2-17x+60 listed as both "Graph both sides" and "Read the
  // intercepts"): only the cheaper listing stays.
  const ranked: typeof eligible = [];
  const signatures = new Map<string, string>();
  for (const method of [...eligible].sort(compareMethods)) {
    const signature = method.rows.length ? rowSignature(method.rows) : null;
    const first = signature ? signatures.get(signature) : undefined;
    if (first) {
      const rejection = reject("duplicate-rows", `${method.name} uses exactly the same calculator rows as ${first}; listing it again teaches nothing new.`);
      rejected.push({ ...method, badges: [], rejected: { rule: rejection.rule, reason: rejection.reason }, stage: rejection.stage });
      continue;
    }
    if (signature) signatures.set(signature, method.name);
    ranked.push(method);
  }
  const badges = assignBadges(ranked);
  return {
    question: response.question,
    choices,
    structure: response.structure.trim() || null,
    methods: [
      ...ranked.map((method) => ({ ...method, badges: badges.get(method.id) ?? [], rejected: null })),
      ...rejected.map(({ stage, ...method }) => {
        void stage;
        return method;
      }),
    ],
    winnerId: ranked[0].id,
    modelPreference: response.preferredTechniqueId,
  };
}

/**
 * Rejections that are contract slips in an otherwise sound Desmos technique:
 * a mislabeled readout, a row that will not insert, a list shape Desmos
 * refuses, a missing distinct-lines check. Answering a different question
 * (a representation question) and duplicates are not slips.
 */
export const RESCUABLE_RULES: ReadonlySet<string> = new Set([
  "answer-consistency",
  "answer-state",
  "row-fails-to-insert",
  "list-shape",
  "prose-latex",
  "condition-incomplete",
  "integer-not-encoded",
  "hidden-derivation",
  "underdetermined-regression",
  "coefficient-lists",
  "discrete-sampling",
  "unproven-extremum",
  "unproven-invariance",
]);

/** A default at or above this math score asks real algebra or memorization of the student. */
export const MATH_HEAVY_SCORE = 2;

export type RescueTarget = {
  /** The math-heavy method that would be the default as things stand. */
  winner: Method;
  /** Rejected Desmos techniques that, had they passed, would ask less of the student. */
  candidates: Method[];
};

/**
 * Whether one guided correction is worth a model call: the default asks real
 * algebra (math score ≥ 2) only because a Desmos technique the model DID
 * propose, with less student math and a lower total by its own reported cost,
 * was rejected for a fixable slip. Recorded eval runs show this in 5–10% of
 * solves (the shared-zero slider on a factor question losing to written
 * substitution, an expanded-circle fit losing to completing the square).
 */
export function desmosRescueTarget(selection: MethodSelection): RescueTarget | null {
  const winner = selection.methods.find((method) => method.id === selection.winnerId);
  if (!winner || winner.mathScore < MATH_HEAVY_SCORE) return null;
  const candidates = selection.methods.filter(
    (method) =>
      method.rejected !== null &&
      RESCUABLE_RULES.has(method.rejected.rule) &&
      method.rows.length > 0 &&
      getTechnique(method.techniqueId).source === "library" &&
      method.mathScore < winner.mathScore &&
      method.total < winner.total,
  );
  return candidates.length ? { winner, candidates } : null;
}

/** The guided-correction text for a rescue: fix the named Desmos candidates, keep the rest. */
export function rescueReason(target: RescueTarget): string {
  const fixes = target.candidates
    .map((method) => `${method.techniqueId} (${method.name}) was rejected [${method.rejected!.rule}]: ${method.rejected!.reason}`)
    .join(" | ");
  return (
    `the Desmos technique(s) you proposed were rejected, so the default would be ${target.winner.techniqueId} (${target.winner.name}), ` +
    `which asks the student for ${target.winner.cost.derivationSteps} hand derivation step(s) and ${target.winner.cost.oneOffFacts} memorized fact(s). ${fixes}. ` +
    "Correct those Desmos candidates so every rule passes (same technique, fixed rows or readout), and keep every candidate that already passed unchanged. " +
    "If a rejected technique genuinely cannot solve this problem, drop it instead; never invent filler."
  );
}

/**
 * Combines the original selection with a corrected one: every eligible
 * technique from either (the cheaper version when both have it), re-ranked
 * and re-badged, so a correction can only add or improve methods, never
 * lose one that already passed.
 */
export function mergeSelections(primary: MethodSelection, secondary: MethodSelection): MethodSelection {
  const eligible = new Map<string, Method>();
  for (const method of [...primary.methods, ...secondary.methods]) {
    if (method.rejected) continue;
    const current = eligible.get(method.techniqueId);
    if (!current || compareMethods(method, current) < 0) eligible.set(method.techniqueId, method);
  }
  const ranked = [...eligible.values()].sort(compareMethods).slice(0, MAX_CANDIDATES);
  const badges = assignBadges(ranked);
  const rejected = new Map<string, Method>();
  for (const method of [...primary.methods, ...secondary.methods]) {
    if (method.rejected && !eligible.has(method.techniqueId)) rejected.set(method.id, method);
  }
  return {
    ...primary,
    methods: [...ranked.map((method) => ({ ...method, badges: badges.get(method.id) ?? [] })), ...rejected.values()],
    winnerId: ranked[0]?.id ?? primary.winnerId,
  };
}
