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
    purposes: Array.from({ length: rowCount }, (_, index) =>
      `Line ${index + 1} puts this part of the question into Desmos so the next row or graph can expose the requested value.`),
    ...overrides,
  };
}

/** A Responses API body whose only output is the given JSON text. */
export function providerBody(value: unknown, status = "completed", extra: Record<string, unknown> = {}) {
  return {
    id: "resp_test",
    object: "response",
    status,
    ...extra,
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

type Reply = unknown | ((body: Record<string, unknown>, call: number, signal?: AbortSignal) => unknown);

/** A provider that never answers: the request settles only when it is aborted. */
export function hang(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () => reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Answers the candidates call and the explanation call separately, keyed by
 * the structured-output schema name, and records every request body.
 */
export function mockModel(replies: {
  candidates: Reply;
  explanation?: Reply;
  /** Extra response fields per call, such as a real `usage` object, `model`, and `service_tier`. */
  extra?: Partial<Record<"candidates" | "explanation", Record<string, unknown>>>;
}) {
  const requests = { candidates: [] as Record<string, unknown>[], explanation: [] as Record<string, unknown>[] };
  const fetchMock = mock.method(globalThis, "fetch", async (_input: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    const name = (body.text as { format: { name: string } }).format.name;
    const kind = name === "desmo_explanation" ? "explanation" : "candidates";
    requests[kind].push(body);
    const reply = kind === "explanation" ? (replies.explanation ?? explanation()) : replies.candidates;
    const value = await (typeof reply === "function"
      ? (reply as (b: Record<string, unknown>, n: number, signal?: AbortSignal) => unknown)(body, requests[kind].length, options?.signal ?? undefined)
      : reply);
    if (value instanceof Response) return value;
    return Response.json(providerBody(value, "completed", replies.extra?.[kind] ?? {}));
  });
  return { requests, fetchMock };
}

const written = (detail: string) => ({
  type: "written" as const,
  row: null,
  relatedRows: [],
  value: null,
  listIndex: null,
  answerFrom: "reasoning" as const,
  choiceLabel: null,
  detail,
});

/** The production tangent problem (k = 25/12). */
export const TANGENT_QUESTION =
  "In the xy-plane, the line y = 6x - k and the parabola y = 3x^2 + 13x + 2 intersect at exactly one point, where k is a constant. What is the value of k?";

/** The derivative regression exactly as it shipped: x_1=[1] wraps the unknown in a list. */
export const NESTED_LIST_ROWS = ["x_1 = [1]", "[6x_1 - k, 6] ~ [3x_1^2 + 13x_1 + 2, 6x_1 + 13]", "k"];
/** The same method encoded correctly: a and k are bare unknowns, two constraints. */
export const CORRECTED_ROWS = ["[6a - k, 6] ~ [3a^2 + 13a + 2, 6a + 13]", "k"];

const readK = (row: number) => ({
  type: "numeric" as const,
  row,
  relatedRows: [],
  value: 25 / 12,
  listIndex: null,
  answerFrom: "value" as const,
  choiceLabel: null,
  detail: "the fitted k",
});

export function tangentDerivativeRegression(rows: readonly string[]): CandidateInput {
  return graphCandidate({
    techniqueId: "derivative-regression",
    rung: 4,
    rows: rows.map((latex) => ({ latex, slider: null, copiesRow: null })),
    answer: "25/12",
    result: readK(rows.length),
    graphBounds: null,
    cost: { ...zeroCost, derivationSteps: 1 },
  });
}

/** Every technique that validly solves the tangent problem, with honest costs. */
export function tangentCandidates(): CandidateInput[] {
  return [
    graphCandidate({
      techniqueId: "vertex-of-difference",
      rung: 1,
      rows: [{ latex: "y=(3x^2+13x+2)-6x", slider: null, copiesRow: null }],
      answer: "25/12",
      result: { type: "vertex", row: 1, relatedRows: [], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "the vertex's y-value, -25/12, with its sign flipped" },
      graphBounds: { left: -4, right: 2, bottom: -4, top: 4 },
      cost: { ...zeroCost },
    }),
    graphCandidate({
      techniqueId: "slider-condition",
      rung: 3,
      rows: [
        { latex: "k=0", slider: { min: 0, max: 5, step: 0.01 }, copiesRow: null },
        { latex: "y=6x-k", slider: null, copiesRow: null },
        { latex: "y=3x^2+13x+2", slider: null, copiesRow: null },
      ],
      answer: "25/12",
      result: { type: "slider_condition", row: 1, relatedRows: [2, 3], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "k where the line touches the parabola once" },
      answerState: { param: "k", value: 2.08 },
      graphBounds: { left: -4, right: 2, bottom: -8, top: 8 },
      cost: { ...zeroCost, manualIterations: 2 },
    }),
    graphCandidate({
      techniqueId: "derivative-regression",
      rung: 4,
      rows: [
        { latex: "f(x)=3x^2+13x+2", slider: null, copiesRow: null },
        { latex: "[6a-k,6]\\sim[f(a),f'(a)]", slider: null, copiesRow: null },
        { latex: "k", slider: null, copiesRow: null },
      ],
      answer: "25/12",
      result: readK(3),
      graphBounds: null,
      cost: { ...zeroCost, oneOffFacts: 1 },
    }),
    paperCandidate({ techniqueId: "discriminant", answer: "25/12", result: written("set the two sides equal and require b^2-4ac = 0"), cost: { ...zeroCost, derivationSteps: 3, oneOffFacts: 1 } }),
    paperCandidate({ techniqueId: "quadratic-formula", answer: "25/12", result: written("the quadratic formula has one root when its radical is 0"), cost: { ...zeroCost, derivationSteps: 4, oneOffFacts: 1 } }),
  ];
}

/** The production no-solution system (p = 10). */
export const NO_SOLUTION_QUESTION =
  "6 + 7r = pw and 7r - 5w = 5w + 11. In this system of equations, p is a constant. If the system has no solution, what is the value of p?";

const bothLines = (row: number) => ({
  type: "graph_overlap" as const,
  row,
  relatedRows: [row + 1],
  value: null,
  listIndex: null,
  answerFrom: "reasoning" as const,
  choiceLabel: null,
  detail: "p = 10, where the lines are parallel and distinct",
});

export function noSolutionCandidates(): CandidateInput[] {
  const graphs = [
    { latex: "6+7x=py", slider: null, copiesRow: null },
    { latex: "7x-5y=5y+11", slider: null, copiesRow: null },
  ];
  return [
    graphCandidate({
      techniqueId: "slider-condition",
      rung: 3,
      rows: [{ latex: "p=1", slider: { min: 1, max: 20, step: 1 }, copiesRow: null }, ...graphs],
      answer: "10",
      result: bothLines(2),
      answerState: { param: "p", value: 10 },
      conditionType: "no-solution",
      distinguishes: "visual-parallel-vs-overlap",
      graphBounds: { left: -10, right: 10, bottom: -10, top: 10 },
      cost: { ...zeroCost, manualIterations: 1 },
    }),
    paperCandidate({
      techniqueId: "elimination",
      answer: "10",
      result: written("equal slopes 7/p = 7/10 with constants that do not scale"),
      conditionType: "no-solution",
      distinguishes: "constant-ratio-checked",
      cost: { ...zeroCost, derivationSteps: 3 },
    }),
    // Equal slopes IS a derivative statement; graphing both lines at the
    // fitted p shows they are parallel and distinct, not coincident.
    graphCandidate({
      techniqueId: "derivative-regression",
      rung: 4,
      rows: [
        { latex: "f(x)=(6+7x)/p", slider: null, copiesRow: null },
        { latex: "g(x)=(7x-11)/10", slider: null, copiesRow: null },
        { latex: "f'(0)\\sim g'(0)", slider: null, copiesRow: null },
        ...graphs,
      ],
      answer: "10",
      result: bothLines(4),
      conditionType: "no-solution",
      graphBounds: { left: -10, right: 10, bottom: -10, top: 10 },
      cost: { ...zeroCost, derivationSteps: 2 },
    }),
  ];
}

/** Distinct, technique-specific explanations for the tangent problem, keyed by the technique named in the request. */
export function tangentExplanations(): Record<string, Explanation> {
  return {
    "Vertex of the difference": explanation(1, { why: "Where the line touches the parabola, the parabola minus the line has a double root, so k cancels that difference's lowest value." }),
    "Slider until it fits": explanation(3, { why: "Dragging k slides the line up and down until it just touches the parabola." }),
    "Derivative regression": explanation(3, { why: "Touching means the line and the parabola share both a value and a slope at one point, so Desmos fits both at once." }),
    Discriminant: explanation(0, {
      why: "A quadratic has exactly one solution when its discriminant is zero, so set the two equations equal and make b^2 - 4ac vanish.",
      steps: ["Set 3x^2 + 13x + 2 = 6x - k and collect terms: 3x^2 + 7x + (2 + k) = 0.", "Exactly one solution means 49 - 12(2 + k) = 0.", "So 12k = 25 and k = 25/12."],
    }),
    "Quadratic formula": explanation(0, {
      why: "The quadratic formula gives one repeated root only when the square root in it is zero.",
      steps: ["Write 3x^2 + 7x + (2 + k) = 0.", "Its roots are (-7 ± sqrt(49 - 12(2 + k)))/6.", "One root requires 49 - 12(2 + k) = 0, so k = 25/12."],
    }),
  };
}
