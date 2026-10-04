/**
 * The benchmark case contract (evals/problems/*.json, and the gitignored
 * evals/private/*.json for licensed material such as Bedrock Prep problems
 * that must not be committed).
 *
 * Gold, acceptable, and bad strategies are named with the solver's own
 * technique vocabulary, so a run is scored by the techniqueId the server
 * actually selected, not by regexes over its rows. The legacy free-form fields
 * (intendedMethod, acceptableMethods, forbiddenMethods, notes) stay for the
 * structural classifiers in evals/classifiers.ts.
 */
import { z } from "zod";

import { RESULT_TYPES } from "../../src/lib/solver-schema";
import { TECHNIQUE_IDS } from "../../src/lib/technique-vocabulary";

export const SAT_DOMAINS = [
  "Algebra",
  "Advanced Math",
  "Problem-Solving and Data Analysis",
  "Geometry and Trigonometry",
] as const;

export const CASE_GROUPS = ["representative", "hard"] as const;
export type CaseGroup = (typeof CASE_GROUPS)[number];

export const CASE_SOURCES = ["original", "bedrock-paraphrase", "user-screenshot", "bedrock-private"] as const;

const techniqueId = z.enum(TECHNIQUE_IDS);
/** 0 none, 1 one trivial Algebra-1 step, 2 a few steps or one formula, 3 multi-step derivation. */
const burdenScale = z.number().int().min(0).max(3);

export const routingSchema = z
  .object({
    /** "Which equation represents..." — translate, never graph or solve. */
    representation: z.boolean(),
    /** The question asks for the value that makes a system have no / infinitely many solutions. */
    condition: z.enum(["no-solution", "infinitely-many"]).nullable(),
    /** Parameter names the question restricts to integers. */
    integerParameters: z.array(z.string().min(1).max(4)),
    /** A stated continuous domain (a <= x <= b) that must not be sampled at integers. */
    continuousInterval: z.boolean(),
    /** Greatest/least coefficient over integer factorizations. */
    integerFactorExtremum: z.boolean(),
  })
  .strict();
export type Routing = z.infer<typeof routingSchema>;

export const benchmarkCaseSchema = z
  .object({
    group: z.enum(CASE_GROUPS),
    source: z.enum(CASE_SOURCES),
    domain: z.enum(SAT_DOMAINS),
    topic: z.string().min(3).max(80),
    problem: z.string().min(10).max(4000),
    choices: z.array(z.string().min(1).max(200)).min(2).max(6).nullable(),
    correctAnswer: z.string().min(1).max(200),
    /** How the best method ends: a number, a clicked point, a slider position, a written choice... */
    expectedResultType: z.enum(RESULT_TYPES),
    /** Best-known strategies (usually one; two when they are genuinely tied). */
    gold: z.array(techniqueId).min(1).max(3),
    /** Valid strategies that are fine as the default, just not the best. */
    acceptable: z.array(techniqueId).max(8),
    /** Strategies that are wrong, math-heavy, or student-hostile as the DEFAULT for this problem. */
    bad: z.array(z.object({ technique: techniqueId, why: z.string().min(5).max(300) }).strict()).max(8),
    /** Reference rows for the gold strategy, in Desmos LaTeX ([] for a written method). */
    goldRows: z.array(z.string().min(1).max(400)).max(16),
    burden: z
      .object({
        /** The gold method's burden. */
        gold: z.object({ manualMath: burdenScale, hiddenDerivation: burdenScale }).strict(),
        /** The burden of the usual algebra-first route a generic model takes. */
        algebraFirst: z.object({ manualMath: burdenScale, hiddenDerivation: burdenScale, description: z.string().min(5).max(300) }).strict(),
      })
      .strict(),
    routing: routingSchema,
    explanationNotes: z.string().min(5).max(800),
    // Legacy fields used by evals/classifiers.ts; optional on new cases.
    intendedMethod: z.string().max(120).optional(),
    acceptableMethods: z.array(z.string().max(120)).optional(),
    forbiddenMethods: z.array(z.string().max(120)).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const named = new Set<string>();
    for (const id of [...value.gold, ...value.acceptable, ...value.bad.map((item) => item.technique)]) {
      if (named.has(id)) context.addIssue({ code: "custom", message: `${id} is listed in more than one of gold/acceptable/bad` });
      named.add(id);
    }
    if (value.choices && value.choices.length > 0) {
      const normalized = value.choices.map((choice) => choice.replace(/\s+/g, "").toLowerCase());
      if (!normalized.includes(value.correctAnswer.replace(/\s+/g, "").toLowerCase())) {
        context.addIssue({ code: "custom", message: "correctAnswer must equal one of the choices' text exactly (ignoring whitespace)" });
      }
    }
    if (value.expectedResultType === "written" && value.goldRows.length > 0) {
      context.addIssue({ code: "custom", message: "a written gold method has no goldRows" });
    }
    if (value.expectedResultType !== "written" && value.goldRows.length === 0) {
      context.addIssue({ code: "custom", message: "a calculator gold method needs goldRows" });
    }
  });

export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>;
export type LoadedCase = BenchmarkCase & { id: string; private: boolean };
