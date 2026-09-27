import { mock } from "node:test";

import type { Explanation } from "../src/lib/solve-cache";
import type { CandidatesResponseInput } from "../src/lib/strategy-selection";

type CandidateInput = CandidatesResponseInput["candidates"][number];

export const zeroCost = {
  derivationSteps: 0,
  newPrimitives: 0,
  oneOffFacts: 0,
  setupConstructions: 0,
  manualIterations: 0,
};

/** A valid calculator candidate for "What is the positive solution to x² = 9?". */
export function graphCandidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    techniqueId: "intercept-read",
    rung: 1,
    rows: [{ latex: "y=x^2-9", slider: null, copiesRow: null }],
    answer: "3",
    result: {
      type: "x_intercept",
      row: 1,
      relatedRows: [],
      value: 3,
      listIndex: null,
      answerFrom: "value",
      choiceLabel: null,
      detail: "the positive x-intercept",
    },
    answerState: null,
    parameters: [],
    conditionType: null,
    distinguishes: null,
    graphBounds: { left: -5, right: 5, bottom: -12, top: 12 },
    cost: { ...zeroCost },
    ...overrides,
  };
}

/** A valid paper candidate (no calculator rows, a written result). */
export function paperCandidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    techniqueId: "factoring",
    rung: 2,
    rows: [],
    answer: "3",
    result: {
      type: "written",
      row: null,
      relatedRows: [],
      value: null,
      listIndex: null,
      answerFrom: "reasoning",
      choiceLabel: null,
      detail: "the positive root of (x-3)(x+3)=0",
    },
    answerState: null,
    parameters: [],
    conditionType: null,
    distinguishes: null,
    graphBounds: null,
    cost: { ...zeroCost, derivationSteps: 1 },
    ...overrides,
  };
}

export function candidatesResponse(
  candidates: CandidateInput[] = [graphCandidate(), paperCandidate()],
  overrides: Partial<CandidatesResponseInput> = {},
): CandidatesResponseInput {
  return {
    status: "solved",
    question: "What is the positive solution to x² = 9?",
    choices: null,
    clarification: null,
    structure: "One equation, asked for its positive solution.",
    candidates,
    preferredTechniqueId: null,
    ...overrides,
  };
}

export function explanation(rowCount = 1, overrides: Partial<Explanation> = {}): Explanation {
  return {
    why: "Graphing the equation shows its solutions as x-intercepts, so no rearranging is needed.",
    readAnswer: "Click the positive x-intercept of line 1 and read x = 3.",
    steps: rowCount === 0 ? ["Factor x² − 9 as (x − 3)(x + 3) and take the positive root, 3."] : [],
    purposes: Array.from({ length: rowCount }, (_, index) => `Explains what line ${index + 1} makes Desmos do.`),
    ...overrides,
  };
}

/** A Responses API body whose only output is the given JSON text. */
export function providerBody(value: unknown, status = "completed") {
  return {
    id: "resp_test",
    object: "response",
    status,
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value), annotations: [] }],
      },
    ],
  };
}

type Reply = unknown | ((body: Record<string, unknown>, call: number) => unknown);

/**
 * Answers the candidates call and the explanation call separately, keyed by
 * the structured-output schema name, and records every request body.
 */
export function mockModel(replies: { candidates: Reply; explanation?: Reply }) {
  const requests = { candidates: [] as Record<string, unknown>[], explanation: [] as Record<string, unknown>[] };
  const fetchMock = mock.method(globalThis, "fetch", async (_input: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    const name = (body.text as { format: { name: string } }).format.name;
    const kind = name === "desmo_explanation" ? "explanation" : "candidates";
    requests[kind].push(body);
    const reply = kind === "explanation" ? (replies.explanation ?? explanation()) : replies.candidates;
    const value = typeof reply === "function" ? (reply as (b: Record<string, unknown>, n: number) => unknown)(body, requests[kind].length) : reply;
    if (value instanceof Response) return value;
    return Response.json(providerBody(value));
  });
  return { requests, fetchMock };
}
