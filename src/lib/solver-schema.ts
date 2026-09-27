import { z } from "zod";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const MAX_EXPRESSIONS = 16;

/**
 * How aggressively Desmos replaces manual math (see PHILOSOPHY.md).
 * weaponized: replace as much math as reasonably possible; reusable tricks first.
 * desmos_first: strongly prefer Desmos; basic math when it clearly simplifies.
 * fastest: assume strong math skills; pick the fastest reliable method.
 */
export const SOLVE_MODES = ["weaponized", "desmos_first", "fastest"] as const;
export type SolveMode = (typeof SOLVE_MODES)[number];
export const DEFAULT_SOLVE_MODE: SolveMode = "desmos_first";
export const SOLVE_MODE_LABELS: Record<SolveMode, string> = {
  weaponized: "Weaponized Desmos",
  desmos_first: "Desmos First",
  fastest: "Fastest SAT Method",
};

/** Answer choices transcribed from the question, in their original order. */
export const answerChoiceSchema = z.object({
  label: z.string().min(1).max(4),
  text: z.string().min(1).max(200),
});

/**
 * One canonical result describes how to obtain the answer. Numeric readouts
 * drive answer consistency; graphical and written results retain their own
 * evidence without fabricating a numeric calculator evaluation.
 */
const legacyResultSchema = z.object({
  row: z.number().int().min(1).max(MAX_EXPRESSIONS),
  value: z.number().nullable(),
  listIndex: z.number().int().min(1).max(64).nullable(),
  answerFrom: z.enum(["value", "choice_position", "reasoning"]),
  choiceLabel: z.string().max(4).nullable(),
  detail: z.string().min(1).max(200),
}).strict();

export const RESULT_TYPES = ["numeric", "list_entry", "intersection", "x_intercept", "y_intercept", "vertex", "graph_overlap", "slider_condition", "visual_choice", "written"] as const;
const typedResultSchema = legacyResultSchema.extend({
  type: z.enum(RESULT_TYPES),
  // Written results have no calculator row. Graphical results identify their
  // graph row(s), not an invented numeric evaluation row.
  row: z.number().int().min(1).max(MAX_EXPRESSIONS).nullable(),
  relatedRows: z.array(z.number().int().min(1).max(MAX_EXPRESSIONS)).max(MAX_EXPRESSIONS),
}).strict();
// The legacy branch keeps already-saved solutions readable. Strict branches
// prevent an invalid typed result from silently becoming a legacy result.
export const resultSchema = z.union([typedResultSchema, legacyResultSchema]);

/**
 * Names the parameter value at which a slider-dependent answer occurs, e.g.
 * {param: "k", value: 3} for a plan whose row 1 is a slider "k=2" and whose
 * reported result only reads correctly once k is set to 3. Null for methods
 * that do not depend on a slider. See PHILOSOPHY.md / A1 in the task history:
 * without this, the app has no way to know the calculator must be moved off
 * whatever value the slider's own row happened to start at before the answer
 * row is read or verified.
 */
export const answerStateSchema = z
  .object({
    param: z.string().min(1).max(40),
    value: z.number(),
  })
  .nullable();

/**
 * A parameter the plan fits or defines, declared so the server can verify an
 * integer-constrained parameter is actually encoded as an integer (a list or
 * an integer-step slider), not merely bounded by an inequality restriction
 * that Desmos would happily satisfy with a fraction.
 */
export const parameterSchema = z
  .object({
    name: z.string().min(1).max(20),
    integer: z.boolean(),
    min: z.number(),
    max: z.number(),
  })
  .strict();
export type Parameter = z.infer<typeof parameterSchema>;

/**
 * "No solution" and "infinitely many solutions" are the same proportionality
 * setup, differing only in whether the constants scale along with the
 * coefficients. A method that only checks the coefficients (matching slopes)
 * answers a necessary but not sufficient condition, so the server requires a
 * declared, checkable distinction whenever a question asks for one of these.
 */
export const CONDITION_TYPES = ["no-solution", "infinitely-many"] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];
export const DISTINGUISH_METHODS = [
  "visual-parallel-vs-overlap",
  "constant-ratio-checked",
] as const;
export type DistinguishMethod = (typeof DISTINGUISH_METHODS)[number];

// `choices` and `result` default to null so solutions saved before they
// existed still load; OpenAI's strict schema still lists both as required.
export const solutionSchema = z.object({
  status: z.enum(["solved", "needs_clarification"]),
  question: z.string().max(8000),
  choices: z.array(answerChoiceSchema).max(8).nullable().default(null),
  // What the student should notice ("two equations, asked where they meet")
  // and the named reusable pattern that solves it ("Intersection trick").
  structure: z.string().max(240).nullable().default(null),
  trick: z.string().max(80).nullable().default(null),
  answer: z.string().max(500),
  method: z.enum([
    "desmos",
    "mental_math",
    "plug_in_answers",
    "shortcut",
    "algebra",
  ]),
  why: z.string().max(1200),
  steps: z.array(z.string().max(800)).max(5),
  readAnswer: z.string().max(1000).nullable(),
  expressions: z
    .array(
      z.object({
        latex: z.string().min(1).max(1000),
        purpose: z.string().max(600),
        // A definition row such as b=1 becomes a slider the student drags;
        // bounds keep the search reasonable (step 1 for integer parameters).
        slider: z
          .object({ min: z.number(), max: z.number(), step: z.number() })
          .nullable()
          .default(null),
      }),
    )
    .max(MAX_EXPRESSIONS),
  result: resultSchema.nullable().default(null),
  answerState: answerStateSchema.default(null),
  parameters: z.array(parameterSchema).max(6).default([]),
  conditionType: z.enum(CONDITION_TYPES).nullable().default(null),
  distinguishes: z.enum(DISTINGUISH_METHODS).nullable().default(null),
  graphBounds: z
    .object({
      left: z.number(),
      right: z.number(),
      bottom: z.number(),
      top: z.number(),
    })
    .nullable(),
  clarification: z.string().max(1000).nullable(),
});

type ParsedSolution = z.infer<typeof solutionSchema>;
export type SliderBounds = { min: number; max: number; step: number };
export type DesmosExpression = {
  latex: string;
  purpose: string;
  slider?: SliderBounds | null;
};
// The server drops a null slider so plain rows stay {latex, purpose}.
export type Solution = Omit<ParsedSolution, "expressions"> & {
  expressions: DesmosExpression[];
};
export type AnswerChoice = z.infer<typeof answerChoiceSchema>;
export type SolutionResult = z.infer<typeof resultSchema>;
export type AnswerState = NonNullable<z.infer<typeof answerStateSchema>>;
