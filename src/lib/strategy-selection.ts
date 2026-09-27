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
  totalCost,
  BADGES,
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
  findRegressionDeterminacyViolations,
} from "./solver-rules";
import { TECHNIQUE_IDS, techniqueName, type TechniqueId } from "./technique-vocabulary";

/** More than four makes the method dropdown noisy and grows output tokens. */
export const MAX_CANDIDATES = 4;

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

/** Call 1: transcription, recognized structure, and 1–4 named techniques. */
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
    !/\b(?:graph|table|scatter ?plot|figure|shown|equivalent)\b/i.test(text)
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

/**
 * Parameters the question itself restricts to integers ("where a is an
 * integer greater than 1", "b is a positive integer constant", "positive
 * integers n"). Rule 1 must apply even when a candidate did not declare them.
 */
export function questionIntegerParameters(question: string): Parameter[] {
  const names = new Set<string>();
  const kinds = String.raw`(?:positive |negative |nonnegative |nonzero )?(?:integers?|whole numbers?|counting numbers?)`;
  for (const match of question.matchAll(new RegExp(String.raw`\b([a-z])\s+(?:is|are)\s+(?:an?\s+)?${kinds}`, "gi"))) names.add(match[1]);
  for (const match of question.matchAll(new RegExp(String.raw`\b${kinds}\s+([a-z])\b`, "gi"))) names.add(match[1]);
  // x and y are graph coordinates, never parameters a row introduces.
  return [...names].filter((name) => !/^[xyt]$/i.test(name)).map((name) => ({ name, integer: true, min: -1000, max: 1000 }));
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
  const conditionType = candidate.conditionType ?? context.condition;
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
  const proseRows = findProseRows(rows);
  if (proseRows.length) {
    return reject("row-fails-to-insert", `Line ${proseRows.join(", ")} contains prose instead of a Desmos expression.`, "desmos_syntax");
  }
  if (hasUnnecessaryCoefficientLists(rows, question)) {
    return reject(
      "coefficient-lists",
      "Unnecessary coefficient lists for a small system. Use direct bracket regression [left side 1,left side 2]~[right side 1,right side 2], copying the original equations.",
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

  const ranked = [...eligible].sort(compareMethods);
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
