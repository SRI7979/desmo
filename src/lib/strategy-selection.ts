import { z } from "zod";
import { hasUnnecessaryCoefficientLists } from "./regression-workflow";

import {
  answerChoiceSchema,
  DEFAULT_SOLVE_MODE,
  solutionSchema,
  type Solution,
  type SolveMode,
} from "./solver-schema";
import {
  findDerivedConstants,
  findDerivedDefinitions,
  findProseRows,
  findUndefinedVariables,
  normalizeDesmosExpressions,
  unwrapSyntheticResultAlias,
} from "./desmos-latex";
import {
  checkConditionCompleteness,
  findIntegerParameterViolations,
  findRegressionDeterminacyViolations,
} from "./solver-rules";
import {
  AnswerConsistencyError,
  deriveConsistentSolution,
  normalizeChoices,
  ProseLatexError,
  sanitizeSolutionProse,
  validateAnswerState,
} from "./answer-consistency";

const scoreSchema = z.number().int().min(0).max(5);

const candidateAuditSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  // The reusable pattern name the student should learn ("Intersection trick").
  trick: z.string().min(1).max(80),
  // True when the method also solves the question without answer choices.
  reusable: z.boolean(),
  techniques: z
    .array(
      z.enum([
        "regression",
        "parameter_regression",
        "derivative_regression",
        "lists",
        "tables",
        "intersections",
        "zeros",
        "answer_choice_testing",
        "implicit_graphing",
        "restrictions",
        "function_evaluation",
        "numeric_evaluation",
        "algebra",
        "conceptual",
      ]),
    )
    .min(1)
    .max(14),
  scores: z.object({
    correctness: scoreSchema,
    // How closely the plan matches what an elite tutor would type: few rows,
    // nothing derived off-screen, an obvious readout. Hidden derivation caps it.
    simplicity: scoreSchema,
    // Everything the student does: recall, algebra, arithmetic, typing, reading.
    student_effort: scoreSchema,
    manual_math_knowledge: scoreSchema,
    manual_algebra: scoreSchema,
    manual_calculation: scoreSchema,
    desmos_outsourcing: scoreSchema,
    reliability: scoreSchema,
    steps_time: scoreSchema,
  }),
  humanWork: z.string().min(1).max(500),
  desmosWork: z.string().min(1).max(500),
  validityNote: z.string().min(1).max(500),
});

// Choices belong to the transcribed question, so they live beside it.
// structure and trick come from the portfolio and the winning candidate.
const candidateSolutionSchema = solutionSchema.omit({
  status: true,
  question: true,
  choices: true,
  structure: true,
  trick: true,
  clarification: true,
});

const candidateSchema = candidateAuditSchema.extend({
  solution: candidateSolutionSchema,
});

// The solved-only minimum is enforced below so clarification can have no candidates.
export const strategyPortfolioSchema = z.object({
  status: z.enum(["solved", "needs_clarification"]),
  question: z.string().max(8000),
  choices: z.array(answerChoiceSchema).max(8).nullable().default(null),
  clarification: z.string().max(1000).nullable(),
  // Recognized first, before any method exists: the problem's structure and
  // which library patterns match it. Empty for clarification.
  structure: z.string().max(240).default(""),
  candidates: z.array(candidateSchema).max(6),
});

// Only the winning candidate needs a full walkthrough in the model's response.
// All candidates retain their scorecards so the server can verify the selection.
export const compactStrategyPortfolioSchema = strategyPortfolioSchema.extend({
  candidates: z.array(candidateAuditSchema).max(6),
  selectedCandidateId: z.string().min(1).max(60).nullable(),
  solution: candidateSolutionSchema.nullable(),
});

// Input types: fields with schema defaults (choices, result, slider) stay optional.
export type StrategyPortfolio = z.input<typeof strategyPortfolioSchema>;
export type CompactStrategyPortfolio = z.input<
  typeof compactStrategyPortfolioSchema
>;
export type StrategyCandidate = z.input<typeof candidateSchema>;
export type StrategyScores = StrategyCandidate["scores"];
export type StrategySelection = {
  selectedCandidateId: string;
  candidates: Omit<StrategyCandidate, "solution">[];
  mode: SolveMode;
  priority: string[];
  /** Server-side fixes applied so the answer matches the calculator readout. */
  repairs: string[];
};
export type SelectionOptions = { mode?: SolveMode };
export type StrategySelectionResult = {
  solution: Solution;
  strategySelection: StrategySelection | null;
};

export class StrategySelectionError extends Error {
  constructor(message: string, readonly stage = "strategy_selection") {
    super(message);
    this.name = "StrategySelectionError";
  }
}

/**
 * Each mode's lexicographic priority; each entry is compared before the next.
 * Reusability (the method works without answer choices) breaks ties so a
 * generalizable trick beats an answer-choice-only hack of similar simplicity.
 */
export const STRATEGY_PRIORITIES: Record<SolveMode, readonly string[]> = {
  weaponized: [
    "correctness",
    "simplicity",
    "reusable",
    "student_effort",
    "manual_math_knowledge + manual_algebra + manual_calculation",
    "steps_time",
    "desmos_outsourcing",
    "reliability",
  ],
  desmos_first: [
    "correctness",
    "simplicity",
    "student_effort",
    "reusable",
    "manual_math_knowledge + manual_algebra + manual_calculation",
    "steps_time",
    "desmos_outsourcing",
    "reliability",
  ],
  fastest: [
    "correctness",
    "student_effort",
    "steps_time",
    "reliability",
    "simplicity",
    "manual_math_knowledge + manual_algebra + manual_calculation",
    "reusable",
    "desmos_outsourcing",
  ],
};
export const STRATEGY_PRIORITY = STRATEGY_PRIORITIES[DEFAULT_SOLVE_MODE];

/**
 * A written (no-calculator) plan is for interpretation, not for algebra the
 * student would do by hand. Each mode tolerates a different amount of manual
 * math before a written plan becomes ineligible, and only while a reasonably
 * simple calculator plan exists: if every Desmos route is convoluted, the
 * basic-math step is acceptable (PHILOSOPHY.md, "What least effort means").
 */
const WRITTEN_MANUAL_MATH_LIMIT: Record<SolveMode, number> = {
  weaponized: 1,
  desmos_first: 3,
  fastest: Number.POSITIVE_INFINITY,
};

type CandidateAudit = Omit<StrategyCandidate, "solution">;

function manualMath(scores: StrategyScores): number {
  return scores.manual_math_knowledge + scores.manual_algebra + scores.manual_calculation;
}

/** A correct calculator plan an elite tutor would not call convoluted. */
function hasSimpleCalculatorPlan(candidates: readonly CandidateAudit[]): boolean {
  return candidates.some(
    (candidate) =>
      candidate.scores.correctness === 5 &&
      candidate.scores.desmos_outsourcing > 0 &&
      candidate.scores.simplicity >= 3,
  );
}

/** Answer-choice testing alone never generalizes, whatever the model claimed. */
function isReusable(candidate: Pick<CandidateAudit, "techniques" | "reusable">): boolean {
  const solving = candidate.techniques.filter((technique) => technique !== "answer_choice_testing");
  return candidate.reusable && solving.length > 0;
}

function hasCompleteAudit(candidate: Omit<StrategyCandidate, "solution">): boolean {
  return Boolean(
    candidate.name.trim() &&
      candidate.humanWork.trim() &&
      candidate.desmosWork.trim() &&
      candidate.validityNote.trim(),
  );
}

type NormalizedCandidate =
  | { solution: Solution; repairs: string[] }
  | { error: string; stage?: string };

type NormalizeContext = {
  question: string;
  choices: Solution["choices"];
  structure: string;
  mode: SolveMode;
  simpleCalculatorPlan: boolean;
};

function normalizeCandidate(
  candidate: StrategyCandidate,
  context: NormalizeContext,
): NormalizedCandidate {
  const { question, choices } = context;
  const named = {
    structure: context.structure.trim() || null,
    trick: candidate.trick.trim() || null,
  };
  const value = {
    ...candidate.solution,
    expressions: normalizeDesmosExpressions(candidate.solution.expressions).map(
      ({ slider, ...expression }) => (slider ? { ...expression, slider } : expression),
    ),
    parameters: candidate.solution.parameters ?? [],
    conditionType: candidate.solution.conditionType ?? null,
    distinguishes: candidate.solution.distinguishes ?? null,
  };
  const policyRepairs: string[] = [];

  if (!hasCompleteAudit(candidate) || !value.answer.trim()) {
    return { error: "The candidate needs a complete audit and a nonblank answer." };
  }
  if (!value.why.trim()) {
    return {
      stage: "explanation_quality",
      error: "Explain the selected method in plain language: what to notice, why the approach works, and which manual work Desmos takes over.",
    };
  }

  if (value.expressions.length) {
    if (
      value.expressions.some(
        (expression) => !expression.latex.trim() || !expression.purpose.trim(),
      )
    ) {
      return { error: "Calculator rows need LaTeX and a purpose." };
    }

    const proseRows = findProseRows(value.expressions);
    if (proseRows.length) {
      return { error: `Line ${proseRows.join(", ")} contains prose instead of a Desmos expression`, stage: "desmos_syntax" };
    }
    if (hasUnnecessaryCoefficientLists(value.expressions, question)) {
      return { error: "Unnecessary coefficient lists for a small system. Use direct bracket regression [left side 1,left side 2]~[right side 1,right side 2], copying the original equations and substituting only supplied values. Keep any needed setup and requested readout, and regenerate matching line explanations. Do not split the equations into disposable coefficient lists." };
    }
    // Constants the question never states mean the plan was derived off-screen.
    const derived = findDerivedConstants(value.expressions, question, choices);
    if (derived.length) {
      return {
        stage: "strategy_policy",
        error: `Line ${derived.map((item) => `${item.row} uses ${item.constants.join(", ")}`).join("; ")}: those numbers are not in the question, so the plan was derived by hand (hidden derivation). Build rows from the givens, or use a slider, list, or regression on the original equation instead.`,
      };
    }
    let derivedDefinitions = findDerivedDefinitions(value.expressions, question);
    const resultRow = value.result?.row ?? null;
    if (
      resultRow !== null &&
      value.result?.answerFrom === "value" &&
      derivedDefinitions.some(({ row }) => row === resultRow)
    ) {
      const expression = value.expressions[resultRow - 1];
      const readout = expression
        ? unwrapSyntheticResultAlias(expression.latex, question)
        : null;
      if (expression && readout) {
        value.expressions[resultRow - 1] = { ...expression, latex: readout };
        policyRepairs.push(
          `Removed the synthetic result alias on line ${resultRow}; Desmos evaluates ${readout} directly.`,
        );
        derivedDefinitions = findDerivedDefinitions(value.expressions, question);
      }
    }
    if (derivedDefinitions.length) {
      return {
        stage: "strategy_policy",
        error: `Line ${derivedDefinitions.map((item) => `${item.row} defines a value by a formula in the fitted parameter ${item.parameters.join(", ")}`).join("; ")}: that formula was derived by hand (hidden derivation). Graph or fit the ORIGINAL equation with the unknown as a slider or regression parameter, or evaluate the fitted model directly.`,
      };
    }
    // Desmos cannot graph or evaluate a row whose letters have no value.
    const undefinedVariables = findUndefinedVariables(value.expressions);
    if (undefinedVariables.length) {
      return {
        stage: "desmos_syntax",
        error: undefinedVariables
          .map(({ row, variables }) => `Line ${row} uses undefined ${variables.join(", ")}`)
          .join("; "),
      };
    }

    // An inequality restriction alone ({a>1}) does not tell Desmos a fitted
    // parameter must be a whole number; it happily returns a=2.37.
    const integerViolations = findIntegerParameterViolations(value.expressions, value.parameters);
    if (integerViolations.length) {
      return {
        stage: "strategy_policy",
        error: integerViolations
          .map(
            ({ row, param }) =>
              `Line ${row} constrains ${param} with only an inequality, but the problem requires ${param} to be an ` +
              `integer; Desmos can satisfy an inequality with a non-integer fit. Use an integer list ${param}=[...] ` +
              `or an integer-step slider (step 1, integer min/max) instead.`,
          )
          .join("; "),
      };
    }

    // A regression with more free parameters than data constraints has
    // infinitely many exact fits; Desmos lands on one of them arbitrarily.
    const determinacyViolations = findRegressionDeterminacyViolations(value.expressions);
    if (determinacyViolations.length) {
      return {
        stage: "strategy_policy",
        error: determinacyViolations
          .map((violation) =>
            violation.kind === "underdetermined"
              ? `Line ${violation.row} is an underdetermined regression: ${violation.freeParams} free parameters ` +
                `(${violation.params.join(", ")}) but only ${violation.constraints} data constraints. Add another ` +
                "data point/equation or reduce the free parameters so the fit is unique."
              : `Line ${violation.row} fits lists of mismatched length (` +
                `${Object.entries(violation.lengths).map(([name, length]) => `${name}: ${length}`).join(", ")}` +
                "); Desmos pairs list entries positionally, so every fitted list needs the same length.",
          )
          .join("; "),
      };
    }

    if (value.answerState) {
      try {
        validateAnswerState(value.expressions, value.answerState);
      } catch (error) {
        if (error instanceof AnswerConsistencyError) return { error: error.message, stage: error.stage };
        throw error;
      }
    }

    const bounds = value.graphBounds;
    const validBounds =
      bounds &&
      bounds.left < bounds.right &&
      bounds.bottom < bounds.top;

    // The displayed answer and read instruction derive from the result row.
    let consistent;
    try {
      consistent = deriveConsistentSolution({
        choices,
        result: value.result,
        answer: value.answer,
        readAnswer: value.readAnswer ?? "",
        expressionCount: value.expressions.length,
      });
    } catch (error) {
      if (error instanceof AnswerConsistencyError) return { error: error.message, stage: error.stage };
      throw error;
    }

    const desmosSolution: Solution = {
      ...value,
      ...named,
      status: "solved",
      question,
      choices: consistent.choices,
      answer: consistent.answer,
      readAnswer: consistent.readAnswer,
      result: consistent.result,
      answerState: value.answerState ?? null,
      clarification: null,
      method: "desmos",
      steps: [],
      graphBounds: validBounds ? bounds : null,
    };

    // "No solution" and "infinitely many" share the same coefficient-matching
    // setup; a method that checks only the coefficients has verified a
    // necessary but not sufficient condition. Repair by augmentation: if the
    // plan already graphs both original equations at the answer value, the
    // distinction is visible and this passes unchanged.
    const conditionCheck = checkConditionCompleteness({
      conditionType: desmosSolution.conditionType,
      distinguishes: desmosSolution.distinguishes,
      result: desmosSolution.result,
      answerState: desmosSolution.answerState,
      expressions: desmosSolution.expressions,
    });
    if (conditionCheck && "error" in conditionCheck) {
      return { stage: "strategy_policy", error: conditionCheck.error };
    }
    if (conditionCheck) desmosSolution.distinguishes = conditionCheck.distinguishes;

    try {
      return {
        solution: sanitizeSolutionProse(desmosSolution),
        repairs: [...policyRepairs, ...consistent.repairs],
      };
    } catch (error) {
      if (error instanceof ProseLatexError) return { error: error.message, stage: "prose_text" };
      throw error;
    }
  }

  if (
    value.method === "desmos" ||
    candidate.scores.desmos_outsourcing > 0 ||
    !value.why.trim() ||
    !value.steps.length ||
    value.steps.some((step) => !step.trim())
  ) {
    return { error: "A written solution needs a reason and actionable steps." };
  }
  // The gate applies only while a reasonably simple calculator plan exists;
  // otherwise the basic-math step is the honest answer.
  const manual = manualMath(candidate.scores);
  if (manual >= WRITTEN_MANUAL_MATH_LIMIT[context.mode] && context.simpleCalculatorPlan) {
    return {
      error: `A written solution with ${manual} points of manual math cannot beat a calculator method in ${context.mode} mode.`,
    };
  }

  let normalizedChoices: Solution["choices"];
  let writtenResult: Solution["result"] = null;
  let writtenReadAnswer: string | null = null;
  const writtenRepairs: string[] = [];
  try {
    normalizedChoices =
      normalizeChoices(choices)?.map(({ label, text }) => ({ label, text })) ?? null;
    if (value.result && "type" in value.result) {
      if (value.result.type !== "written") return {error:"A solution without calculator rows must use the written result type.",stage:"result_contract"};
      const consistent = deriveConsistentSolution({choices,result:value.result,answer:value.answer,readAnswer:value.readAnswer ?? "",expressionCount:0});
      writtenResult=consistent.result;
      writtenReadAnswer=consistent.readAnswer;
      value.answer=consistent.answer;
      writtenRepairs.push(...consistent.repairs);
    }
  } catch (error) {
    if (error instanceof AnswerConsistencyError) return { error: error.message, stage:error.stage };
    throw error;
  }

  const writtenSolution: Solution = {
    ...value,
    ...named,
    status: "solved",
    question,
    choices: normalizedChoices,
    clarification: null,
    readAnswer: writtenReadAnswer,
    result: writtenResult,
    // A written plan has no calculator row for a slider to depend on.
    answerState: null,
    graphBounds: null,
  };

  // A written plan has no graph rows to augment; it passes only when the
  // model already declared how the distinction was checked in prose.
  const writtenConditionCheck = checkConditionCompleteness({
    conditionType: writtenSolution.conditionType,
    distinguishes: writtenSolution.distinguishes,
    result: writtenSolution.result,
    answerState: writtenSolution.answerState,
    expressions: [],
  });
  if (writtenConditionCheck && "error" in writtenConditionCheck) {
    return { stage: "strategy_policy", error: writtenConditionCheck.error };
  }
  if (writtenConditionCheck) writtenSolution.distinguishes = writtenConditionCheck.distinguishes;

  try {
    return {
      solution: sanitizeSolutionProse(writtenSolution),
      repairs: writtenRepairs,
    };
  } catch (error) {
    if (error instanceof ProseLatexError) return { error: error.message, stage: "prose_text" };
    throw error;
  }
}

function rank(candidate: CandidateAudit, mode: SolveMode): number[] {
  const scores = candidate.scores;
  const value: Record<string, number> = {
    simplicity: -scores.simplicity,
    reusable: isReusable(candidate) ? 0 : 1,
    student_effort: scores.student_effort,
    "manual_math_knowledge + manual_algebra + manual_calculation": manualMath(scores),
    steps_time: scores.steps_time,
    desmos_outsourcing: -scores.desmos_outsourcing,
    reliability: -scores.reliability,
  };
  return STRATEGY_PRIORITIES[mode]
    .filter((key) => key !== "correctness")
    .map((key) => value[key]);
}

function outranks(left: CandidateAudit, right: CandidateAudit, mode: SolveMode): boolean {
  const leftRank = rank(left, mode);
  const rightRank = rank(right, mode);

  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) {
      return leftRank[index] < rightRank[index];
    }
  }

  return false;
}

function clarificationResult(
  portfolio: Pick<StrategyPortfolio, "question" | "clarification">,
): StrategySelectionResult {
  return {
    solution: {
      status: "needs_clarification",
      question: portfolio.question,
      choices: null,
      clarification: portfolio.clarification,
      answer: "",
      method: "shortcut",
      why: "",
      steps: [],
      readAnswer: null,
      expressions: [],
      result: null,
      answerState: null,
      parameters: [],
      conditionType: null,
      distinguishes: null,
      graphBounds: null,
      structure: null,
      trick: null,
    },
    strategySelection: null,
  };
}

function validateSolvedPortfolio(
  portfolio: Pick<CompactStrategyPortfolio, "question" | "candidates">,
) {
  if (!portfolio.question.trim() || portfolio.candidates.length < 3) {
    throw new StrategySelectionError(
      "A solved portfolio needs a question and three to six candidates.",
    );
  }

  const ids = portfolio.candidates.map((candidate) => candidate.id.trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new StrategySelectionError("Candidate IDs must be nonempty and unique.");
  }
}

/**
 * Selects one complete plan without regenerating its explanation or expressions.
 * Correctness scores are model assessments, not an independent math proof.
 */
export function selectStrategy(
  input: StrategyPortfolio,
  options: SelectionOptions = {},
): StrategySelectionResult {
  const mode = options.mode ?? DEFAULT_SOLVE_MODE;
  const parsed = strategyPortfolioSchema.safeParse(input);
  if (!parsed.success) {
    throw new StrategySelectionError("The strategy portfolio is malformed.");
  }
  const portfolio = parsed.data;

  if (portfolio.status === "needs_clarification") {
    return clarificationResult(portfolio);
  }

  validateSolvedPortfolio(portfolio);
  const context: NormalizeContext = {
    question: portfolio.question,
    choices: portfolio.choices,
    structure: portfolio.structure,
    mode,
    simpleCalculatorPlan: hasSimpleCalculatorPlan(portfolio.candidates),
  };

  let selected:
    | { candidate: StrategyCandidate; solution: Solution; repairs: string[] }
    | null = null;

  for (const candidate of portfolio.candidates) {
    // An attractive effort score must never rescue a known-incorrect plan.
    if (candidate.scores.correctness !== 5) continue;
    const normalized = normalizeCandidate(candidate, context);
    if ("error" in normalized) continue;

    if (!selected || outranks(candidate, selected.candidate, mode)) {
      selected = { candidate, ...normalized };
    }
  }

  if (!selected) {
    throw new StrategySelectionError(
      "No complete candidate passed the correctness and calculator checks.",
    );
  }

  return {
    solution: selected.solution,
    strategySelection: {
      selectedCandidateId: selected.candidate.id,
      candidates: portfolio.candidates.map(({ solution: _solution, ...audit }) => {
        // Candidate plans stay server-side; only their concise scorecards are returned.
        void _solution;
        return audit;
      }),
      mode,
      priority: [...STRATEGY_PRIORITIES[mode]],
      repairs: selected.repairs,
    },
  };
}

/** Verifies the scorecard winner before using its single canonical walkthrough. */
export function selectCompactStrategy(
  input: CompactStrategyPortfolio,
  options: SelectionOptions = {},
): StrategySelectionResult {
  const mode = options.mode ?? DEFAULT_SOLVE_MODE;
  const parsed = compactStrategyPortfolioSchema.safeParse(input);
  if (!parsed.success) {
    throw new StrategySelectionError("The strategy portfolio is malformed.");
  }
  const portfolio = parsed.data;

  if (portfolio.status === "needs_clarification") {
    return clarificationResult(portfolio);
  }

  validateSolvedPortfolio(portfolio);
  if (portfolio.candidates.some((candidate) => !hasCompleteAudit(candidate))) {
    throw new StrategySelectionError("Candidate scorecards must be complete.");
  }
  if (!portfolio.selectedCandidateId?.trim() || !portfolio.solution) {
    throw new StrategySelectionError("A solved portfolio needs a selected solution.");
  }

  let selected: (typeof portfolio.candidates)[number] | null = null;
  for (const candidate of portfolio.candidates) {
    if (candidate.scores.correctness !== 5) continue;
    if (!selected || outranks(candidate, selected, mode)) {
      selected = candidate;
    }
  }

  if (!selected) {
    throw new StrategySelectionError("No candidate passed the correctness check.");
  }
  if (portfolio.selectedCandidateId !== selected.id) {
    throw new StrategySelectionError(
      `The selected strategy does not match the ${mode} ranking (${STRATEGY_PRIORITIES[mode].join(" > ")}); the winner is ${selected.id}.`,
    );
  }

  const normalized = normalizeCandidate(
    { ...selected, solution: portfolio.solution },
    {
      question: portfolio.question,
      choices: portfolio.choices,
      structure: portfolio.structure,
      mode,
      simpleCalculatorPlan: hasSimpleCalculatorPlan(portfolio.candidates),
    },
  );
  if ("error" in normalized) {
    throw new StrategySelectionError(
      `The selected candidate failed the calculator and explanation checks: ${normalized.error}`,
      normalized.stage,
    );
  }

  return {
    solution: normalized.solution,
    strategySelection: {
      selectedCandidateId: selected.id,
      candidates: portfolio.candidates,
      mode,
      priority: [...STRATEGY_PRIORITIES[mode]],
      repairs: normalized.repairs,
    },
  };
}
