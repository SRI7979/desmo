import type { PreflightVerdict } from "./desmos-preflight";
import { assignBadges } from "./method-scoring";
import type { MethodSummary } from "./method-summary";
import { solutionSchema, type AnswerChoice, type Solution } from "./solver-schema";

/**
 * Framework-independent logic behind the technique selector: which display
 * mode it's in, what to render the instant a technique is chosen, its
 * keyboard state machine, and how it reads the method-switch response
 * stream. Kept separate from the component (technique-selector.tsx) so it is
 * directly testable without a DOM (this project has no jsdom/RTL; component
 * logic is tested at this level).
 */

export type SelectorMode = "single" | "multi";

/** A lone technique opens its details; multiple techniques open details and a switcher. */
export function selectorMode(methods: readonly MethodSummary[]): SelectorMode {
  return methods.length <= 1 ? "single" : "multi";
}

/**
 * The solution shown the instant a technique is chosen, before its
 * explanation is generated. Everything that does not depend on prose (rows,
 * slider position, graph bounds, the readout, the answer) comes straight
 * from the already-scored, already-cached method, so the calculator and the
 * answer box update with no network round trip and no loading state.
 * why/steps/readAnswer/purposes are blank until the explanation resolves;
 * question/choices/structure/status are shared across every technique for
 * one problem and carry over from the solution already on screen.
 */
export function provisionalSolution(base: Solution, method: MethodSummary): Solution {
  return {
    ...base,
    trick: method.name,
    answer: method.answer,
    method: method.rows.length > 0 ? "desmos" : "algebra",
    why: "",
    handMath: null,
    steps: [],
    readAnswer: null,
    expressions: method.rows.map((row) => ({
      latex: row.latex,
      purpose: "",
      ...(row.slider ? { slider: row.slider } : {}),
    })),
    result: method.result,
    answerState: method.answerState,
    parameters: method.parameters,
    conditionType: method.conditionType,
    distinguishes: method.distinguishes,
    graphBounds: method.graphBounds,
  };
}

/** What a "methods" event (or a pre-flight report response) carries. */
export type MethodsPayload = {
  cacheKey: string;
  selectedMethodId: string;
  question: string;
  choices: AnswerChoice[] | null;
  structure: string | null;
  methods: MethodSummary[];
};

/** Loose shape check for a methods payload from the server; null when it is not one. */
export function parseMethodsPayload(value: unknown): MethodsPayload | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.cacheKey !== "string" || typeof data.selectedMethodId !== "string" || !Array.isArray(data.methods)) return null;
  if (typeof data.question !== "string") return null;
  return {
    cacheKey: data.cacheKey,
    selectedMethodId: data.selectedMethodId,
    question: data.question,
    choices: Array.isArray(data.choices) ? (data.choices as AnswerChoice[]) : null,
    structure: typeof data.structure === "string" ? data.structure : null,
    methods: data.methods as MethodSummary[],
  };
}

/** The problem-level fields every technique shares, for building a provisional solution. */
export function baseSolution(payload: Pick<MethodsPayload, "question" | "choices" | "structure">): Solution {
  return {
    status: "solved",
    question: payload.question,
    choices: payload.choices,
    structure: payload.structure,
    clarification: null,
    trick: null,
    answer: "",
    method: "desmos",
    why: "",
    handMath: null,
    steps: [],
    readAnswer: null,
    expressions: [],
    result: null,
    answerState: null,
    parameters: [],
    conditionType: null,
    distinguishes: null,
    graphBounds: null,
  };
}

export type VerdictStatus = PreflightVerdict["status"];

/**
 * The selector's list: only techniques whose rows ran cleanly in the hidden
 * Desmos instance, in rank order. Badges are recomputed over every technique
 * not known to error, so a technique that failed pre-flight neither appears
 * nor keeps a badge another technique now leads.
 */
export function selectorMethods(methods: readonly MethodSummary[], verdicts: Readonly<Record<string, VerdictStatus>>): MethodSummary[] {
  const surviving = methods.filter((method) => verdicts[method.id] !== "error");
  const badges = assignBadges(surviving);
  return surviving
    .filter((method) => verdicts[method.id] === "clean")
    .map((method) => ({ ...method, badges: badges.get(method.id) ?? [] }));
}

/**
 * Where the selected technique's explanation stands. "pending": its rows and
 * answer are shown and the explanation panel shows a skeleton while the
 * explanation is generated. "failed": the call failed; rows and answer stay,
 * and the panel offers a retry. Nothing else on the page changes.
 */
export type ExplanationStatus = "ready" | "pending" | "failed";

/**
 * The explanation a stream delivered for one technique, or null when it did
 * not: an error event, no solution event, a malformed solution, or the
 * generated fallback summary. The fallback is a failure, not an explanation:
 * for a technique with no calculator rows it would be the whole panel, one
 * generic line. It is never cached, so a retry can still generate the real one.
 */
export function explanationFromEvents(events: readonly unknown[]): Solution | null {
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const { type, explanation, solution } = event as Record<string, unknown>;
    if (type === "error") return null;
    if (type !== "solution") continue;
    if (explanation === "fallback") return null;
    const parsed = solutionSchema.safeParse(solution);
    return parsed.success && parsed.data.status === "solved" ? parsed.data : null;
  }
  return null;
}

export type NavState = { open: boolean; activeIndex: number };
export type NavResult = NavState & { action?: "select" | "close" };

/**
 * Keyboard behavior for the trigger button. DOM focus never leaves the
 * button (aria-activedescendant identifies the highlighted option instead),
 * so this reducer is the entire "is the list open, which option is
 * highlighted" state machine. `count` is the number of listed techniques;
 * `selectedIndex` is the technique already selected, used as the position
 * the list opens at. Returns the same `state` reference for an unhandled key
 * so callers can tell whether to preventDefault.
 */
export function navigate(state: NavState, key: string, count: number, selectedIndex: number): NavResult {
  if (count <= 0) return state;
  const last = count - 1;
  const clamp = (index: number) => Math.max(0, Math.min(last, index));

  if (!state.open) {
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
      return { open: true, activeIndex: clamp(selectedIndex) };
    }
    return state;
  }

  switch (key) {
    case "ArrowDown":
      return { open: true, activeIndex: clamp(state.activeIndex + 1) };
    case "ArrowUp":
      return { open: true, activeIndex: clamp(state.activeIndex - 1) };
    case "Home":
      return { open: true, activeIndex: 0 };
    case "End":
      return { open: true, activeIndex: last };
    case "Enter":
    case " ":
      return { open: false, activeIndex: state.activeIndex, action: "select" };
    case "Escape":
      return { open: false, activeIndex: state.activeIndex, action: "close" };
    default:
      return state;
  }
}

/** Splits a growing text buffer into complete JSON lines and the remainder. */
export function parseNdjsonLines(buffer: string): { events: unknown[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events = lines.filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as unknown);
  return { events, rest };
}

/**
 * Reads a method-switch (or solve) response body as a sequence of NDJSON
 * events, decoupled from `fetch`/`ReadableStream` so it can be tested with a
 * plain async generator of string chunks instead of a real network response.
 */
export async function* readNdjsonEvents(chunks: AsyncIterable<string>): AsyncGenerator<unknown> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    const { events, rest } = parseNdjsonLines(buffer);
    buffer = rest;
    for (const event of events) yield event;
  }
  const trimmed = buffer.trim();
  if (trimmed) yield JSON.parse(trimmed) as unknown;
}
