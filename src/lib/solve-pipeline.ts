import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeChoices } from "./answer-consistency";
import {
  ExplanationError,
  explanationInput,
  fallbackExplanation,
  presentMethod,
} from "./method-presentation";
import { COST_WEIGHTS } from "./method-scoring";
import {
  CACHE_ENTRY_VERSION,
  cacheKeyFor,
  eligibleMethods,
  explanationSchema,
  findMethod,
  inputHash,
  problemKey,
  promptConfigVersion,
  type CacheEntry,
  type SolveCache,
} from "./solve-cache";
import {
  logSelectionDisagreement,
  logSolveRejection,
  modelOutputText,
  SolveValidationError,
  validateCandidatesResponse,
  validateExplanationResponse,
} from "./solve-output";
import {
  buildCandidatePrompt,
  CANDIDATE_INSTRUCTIONS,
  EXPLANATION_INSTRUCTIONS,
  TRAINING_EXAMPLE_INSTRUCTIONS,
} from "./solver-instructions";
import type { AnswerChoice, Solution } from "./solver-schema";
import {
  candidatesResponseSchema,
  selectMethods,
  StrategySelectionError,
  type CandidatesResponse,
  type Method,
} from "./strategy-selection";
import { TECHNIQUES } from "./technique-vocabulary";
import { loadTrainingExamples } from "./training-examples";

/** One guided correction per call, shared by both calls. */
export const MAX_ATTEMPTS = 2;
/** Past this, the rows are shown with a generated summary instead of waiting. */
export const EXPLANATION_TIMEOUT_MS = 30_000;
/**
 * Healthy candidate calls take 8–15 s (a guided retry at medium effort up to
 * about 50 s); a provider stall was observed to hang for 170 s+. A stalled
 * attempt is abandoned and counts as the one retry instead of failing.
 */
export const CANDIDATE_TIMEOUT_MS = 60_000;
export const CANDIDATE_CACHE_KEY = "desmo-candidates-v1";
export const EXPLANATION_CACHE_KEY = "desmo-explanation-v1";

const candidateFormat = zodTextFormat(candidatesResponseSchema, "desmo_candidates");
const explanationFormat = zodTextFormat(explanationSchema, "desmo_explanation");

const reasoningEfforts = ["minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
const serviceTiers = ["priority", "default"] as const;

export function configuredReasoningEffort(): ReasoningEffort {
  const configured = process.env.OPENAI_REASONING_EFFORT?.trim();
  return reasoningEfforts.find((effort) => effort === configured) ?? "low";
}

/** Remembered once OpenAI rejects priority processing, so later calls skip it. */
export type ServiceTierState = { priorityUnavailable: boolean };

/**
 * Priority processing roughly halves solve time at the same reasoning effort
 * for about 1.8× the token price. It is the default; OPENAI_SERVICE_TIER=default
 * opts out.
 */
export function configuredServiceTier(state: ServiceTierState): (typeof serviceTiers)[number] {
  const configured = process.env.OPENAI_SERVICE_TIER?.trim();
  const tier = serviceTiers.find((item) => item === configured) ?? "priority";
  return tier === "priority" && state.priorityUnavailable ? "default" : tier;
}

function rejectsServiceTier(error: unknown): boolean {
  return error instanceof OpenAI.APIError && error.status === 400 && /service[_ ]tier|priority/i.test(error.message);
}

export class RefusalError extends Error {}

export type Rejection = { stage: string; reason: string; previous: string };

/** Correct the rejected contract without discarding otherwise valid work. */
export function retryPrompt(rejection: Rejection): string {
  return `Your previous response was REJECTED by the server at ${rejection.stage}: ${rejection.reason}\nReturn only one corrected response complying with the supplied JSON schema and validation rules. Keep correct candidates; fix or drop the rejected ones, and never replace a real technique with filler. Use the correct result type; a graphical or written result does not need a fabricated numeric row.\nPrevious response to correct:\n${rejection.previous}`;
}

export type SolveContext = {
  model: string;
  candidateInstructions: string;
  version: string;
};

/** Reads the library and training examples and fixes the prompt configuration version. */
export async function loadSolveContext(): Promise<SolveContext> {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
  const [library, training] = await Promise.all([
    readFile(path.join(process.cwd(), "src/content/desmos-tricks.md"), "utf8"),
    loadTrainingExamples(),
  ]);
  const candidateInstructions = `${CANDIDATE_INSTRUCTIONS}\n\n<strategy_library>\n${library}\n</strategy_library>\n\n${TRAINING_EXAMPLE_INSTRUCTIONS}\n\n<training_examples>\n${training.prompt}\n</training_examples>`;
  const version = promptConfigVersion({
    candidateInstructions: `${CANDIDATE_INSTRUCTIONS}\n${TRAINING_EXAMPLE_INSTRUCTIONS}`,
    explanationInstructions: EXPLANATION_INSTRUCTIONS,
    strategyLibrary: library,
    trainingExamples: training.prompt,
    candidatePrompt: buildCandidatePrompt(),
    costWeights: COST_WEIGHTS,
    vocabulary: TECHNIQUES,
    schemas: [candidateFormat, explanationFormat],
    model,
  });
  return { model, candidateInstructions, version };
}

export type SolveInput =
  | { kind: "image"; bytes: Buffer; mime: string }
  | { kind: "text"; problem: string; choices: string[] | null };

export type PipelineDeps = {
  client: OpenAI;
  cache: SolveCache;
  context: SolveContext;
  tier: ServiceTierState;
  diagnosticId: string;
  signal?: AbortSignal;
};

export type CallCounts = { candidates: number; explanation: number };

export type MethodsReady = {
  entry: CacheEntry;
  method: Method;
  /** True when the entry came from the cache (an input or problem hit). */
  cached: boolean;
};

export type SolvedResult = {
  kind: "solved";
  entry: CacheEntry;
  method: Method;
  solution: Solution;
  cached: boolean;
  hit: "input" | "problem" | null;
  explanation: "cache" | "model" | "fallback";
  calls: CallCounts;
  timings: { methodsMs: number; completeMs: number };
  repairs: string[];
};

export type SolveResult =
  | { kind: "clarification"; solution: Solution; calls: CallCounts; timings: { methodsMs: number; completeMs: number } }
  | SolvedResult;

function isGpt5(model: string) {
  return model.startsWith("gpt-5");
}

async function callModel(
  deps: PipelineDeps,
  body: Record<string, unknown>,
  timeout?: number,
): Promise<OpenAI.Responses.Response> {
  const send = (tier: (typeof serviceTiers)[number]) =>
    deps.client.responses.create(
      { ...(body as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming), ...(tier === "priority" ? { service_tier: "priority" as const } : {}) },
      { signal: deps.signal, ...(timeout ? { timeout } : {}) },
    );
  const tier = configuredServiceTier(deps.tier);
  const started = performance.now();
  let response: OpenAI.Responses.Response;
  try {
    response = await send(tier);
  } catch (error) {
    if (tier !== "priority" || !rejectsServiceTier(error)) throw error;
    deps.tier.priorityUnavailable = true;
    response = await send("default");
  }
  if (process.env.NODE_ENV === "development" || process.env.DESMO_DIAGNOSTICS === "1") {
    const usage = response.usage;
    console.info(
      "[desmo:call]",
      JSON.stringify({
        id: deps.diagnosticId,
        format: (body.text as { format?: { name?: string } } | undefined)?.format?.name,
        ms: Math.round(performance.now() - started),
        status: response.status,
        output: usage?.output_tokens,
        reasoning: usage?.output_tokens_details?.reasoning_tokens,
        cached: usage?.input_tokens_details?.cached_tokens,
        input: usage?.input_tokens,
      }),
    );
  }
  const refused = response.output.some(
    (item) => item.type === "message" && item.content.some((content) => content.type === "refusal"),
  );
  if (refused) throw new RefusalError("The model refused the request.");
  return response;
}

function effortFor(retrying: boolean): ReasoningEffort {
  const effort = configuredReasoningEffort();
  return retrying && (effort === "minimal" || effort === "low") ? "medium" : effort;
}

function textProblem(input: Extract<SolveInput, { kind: "text" }>): string {
  const choices = input.choices
    ? `\nAnswer choices: ${input.choices.map((choice, index) => `${String.fromCharCode(65 + index)}) ${choice}`).join(", ")}`
    : "\n(Student-produced response; no answer choices.)";
  return `No image is attached for this request. The text below is the complete, already-transcribed question; solve it directly, exactly as if it had been read from a screenshot.\n\nProblem: ${input.problem}${choices}`;
}

function candidateRequest(deps: PipelineDeps, input: SolveInput, rejection?: Rejection): Record<string, unknown> {
  const { model } = deps.context;
  return {
    model,
    prompt_cache_key: CANDIDATE_CACHE_KEY,
    instructions: deps.context.candidateInstructions,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildCandidatePrompt() },
          input.kind === "image"
            ? { type: "input_image", image_url: `data:${input.mime};base64,${input.bytes.toString("base64")}`, detail: "high" }
            : { type: "input_text", text: textProblem(input) },
          ...(rejection ? [{ type: "input_text", text: retryPrompt(rejection) }] : []),
        ],
      },
    ],
    text: { format: candidateFormat, ...(isGpt5(model) ? { verbosity: "low" } : {}) },
    ...(isGpt5(model) ? { reasoning: { effort: effortFor(Boolean(rejection)) } } : {}),
    max_output_tokens: 8000,
    store: false,
  };
}

function explanationRequest(deps: PipelineDeps, entry: CacheEntry, method: Method, rejection?: Rejection): Record<string, unknown> {
  const { model } = deps.context;
  return {
    model,
    prompt_cache_key: EXPLANATION_CACHE_KEY,
    instructions: EXPLANATION_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: explanationInput(entry, method) },
          ...(rejection ? [{ type: "input_text", text: retryPrompt(rejection) }] : []),
        ],
      },
    ],
    text: { format: explanationFormat, ...(isGpt5(model) ? { verbosity: "low" } : {}) },
    ...(isGpt5(model) ? { reasoning: { effort: effortFor(Boolean(rejection)) } } : {}),
    max_output_tokens: 4000,
    store: false,
  };
}

function clarificationSolution(parsed: CandidatesResponse): Solution {
  return {
    status: "needs_clarification",
    question: parsed.question,
    choices: null,
    clarification: parsed.clarification,
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
  };
}

/** Choice labels and "A)" prefixes normalized before hashing, so transcription noise does not split keys. */
function stableChoices(choices: CandidatesResponse["choices"]): AnswerChoice[] | null {
  try {
    return normalizeChoices(choices)?.map(({ label, text }) => ({ label, text })) ?? null;
  } catch {
    return choices;
  }
}

/**
 * Explanation for one method: cached, else generated (call 2) and cached,
 * else — on failure or timeout — a minimal generated summary that is not
 * cached, so the rows and answer are never withheld.
 */
export async function explainMethod(
  deps: PipelineDeps,
  entry: CacheEntry,
  method: Method,
  calls: CallCounts = { candidates: 0, explanation: 0 },
): Promise<{ solution: Solution; source: "cache" | "model" | "fallback" }> {
  const cached = await deps.cache.getExplanation(entry.cacheKey, method.id);
  if (cached) {
    try {
      return { solution: presentMethod(entry, method, cached), source: "cache" };
    } catch {
      // A cached explanation that no longer matches its method is regenerated.
    }
  }
  let rejection: Rejection | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: OpenAI.Responses.Response;
    try {
      response = await callModel(deps, explanationRequest(deps, entry, method, rejection), EXPLANATION_TIMEOUT_MS);
      calls.explanation += 1;
    } catch (error) {
      if (deps.signal?.aborted) throw error;
      break;
    }
    try {
      const explanation = validateExplanationResponse(response);
      presentMethod(entry, method, explanation);
      const stored = await deps.cache.putExplanation(entry.cacheKey, method.id, explanation);
      return { solution: presentMethod(entry, method, stored), source: "model" };
    } catch (error) {
      const failure = error instanceof ExplanationError ? new SolveValidationError(error.stage, error.message) : error;
      if (!(failure instanceof SolveValidationError)) throw error;
      await logSolveRejection(`${deps.diagnosticId}-explanation`, attempt, response, failure);
      rejection = { stage: failure.stage, reason: failure.message, previous: modelOutputText(response) };
    }
  }
  return { solution: presentMethod(entry, method, fallbackExplanation(method)), source: "fallback" };
}

/**
 * The whole solve: cache lookup, candidate generation (call 1) with one guided
 * retry, server-side selection, a first-render notification, then the
 * winner's explanation (call 2). An identical input makes no model call; the
 * same problem in a different screenshot makes only the extraction call and
 * returns the cached, identical result.
 */
export async function solveProblem(
  deps: PipelineDeps,
  input: SolveInput,
  onMethods?: (ready: MethodsReady) => void | Promise<void>,
): Promise<SolveResult> {
  const started = performance.now();
  const calls: CallCounts = { candidates: 0, explanation: 0 };
  const version = deps.context.version;
  const hash = inputHash(input.kind === "image" ? input.bytes : { problem: input.problem, choices: input.choices });
  let entry: CacheEntry | null = null;
  let hit: SolvedResult["hit"] = null;
  let repairs: string[] = [];

  const known = await deps.cache.lookupInput(hash, version);
  entry = known ? await deps.cache.getEntry(known) : null;
  if (entry) hit = "input";

  if (!entry) {
    let rejection: Rejection | undefined;
    for (let attempt = 1; !entry; attempt += 1) {
      let response: OpenAI.Responses.Response;
      try {
        response = await callModel(deps, candidateRequest(deps, input, rejection), CANDIDATE_TIMEOUT_MS);
      } catch (error) {
        const stalled = error instanceof OpenAI.APIConnectionTimeoutError;
        if (!stalled || attempt >= MAX_ATTEMPTS || deps.signal?.aborted) throw error;
        calls.candidates += 1;
        continue;
      }
      calls.candidates += 1;
      try {
        const { parsed, repairs: metadataRepairs } = validateCandidatesResponse(response);
        if (parsed.status === "needs_clarification") {
          const elapsed = performance.now() - started;
          return { kind: "clarification", solution: clarificationSolution(parsed), calls, timings: { methodsMs: elapsed, completeMs: elapsed } };
        }
        const key = cacheKeyFor(problemKey(parsed.question, stableChoices(parsed.choices)), version);
        const existing = await deps.cache.getEntry(key);
        if (existing) {
          entry = existing;
          hit = "problem";
          break;
        }
        const selection = selectMethods(parsed);
        repairs = metadataRepairs;
        entry = await deps.cache.putEntry({
          version: CACHE_ENTRY_VERSION,
          cacheKey: key,
          promptConfigVersion: version,
          question: selection.question,
          choices: selection.choices,
          structure: selection.structure,
          methods: selection.methods,
          winnerId: selection.winnerId,
          modelPreference: selection.modelPreference,
          createdAt: new Date().toISOString(),
        });
        const winner = findMethod(entry, entry.winnerId);
        if (selection.modelPreference && winner && selection.modelPreference !== winner.techniqueId) {
          logSelectionDisagreement(deps.diagnosticId, selection.modelPreference, winner.techniqueId);
        }
      } catch (error) {
        const failure = error instanceof StrategySelectionError ? new SolveValidationError(error.stage, error.message) : error;
        if (!(failure instanceof SolveValidationError)) throw error;
        await logSolveRejection(deps.diagnosticId, attempt, response, failure);
        if (attempt >= MAX_ATTEMPTS || deps.signal?.aborted) throw failure;
        rejection = { stage: failure.stage, reason: failure.message, previous: modelOutputText(response) };
      }
    }
  }

  const solved = entry!;
  const method = findMethod(solved, solved.winnerId) ?? eligibleMethods(solved)[0];
  const methodsMs = performance.now() - started;
  await onMethods?.({ entry: solved, method, cached: hit !== null });
  const [explained] = await Promise.all([
    explainMethod(deps, solved, method, calls),
    hit !== "input" ? deps.cache.rememberInput(hash, version, solved.cacheKey) : undefined,
  ]);
  return {
    kind: "solved",
    entry: solved,
    method,
    solution: explained.solution,
    cached: hit !== null,
    hit,
    explanation: explained.source,
    calls,
    timings: { methodsMs, completeMs: performance.now() - started },
    repairs,
  };
}

/** The method list a client shows in its dropdown: eligible methods only, in rank order. */
export function methodSummaries(entry: CacheEntry) {
  return eligibleMethods(entry).map((method) => ({
    id: method.id,
    techniqueId: method.techniqueId,
    name: method.name,
    rung: method.rung,
    rows: method.rows,
    answer: method.answer,
    cost: method.cost,
    total: method.total,
    mathScore: method.mathScore,
    mathLevel: method.mathLevel,
    shape: method.shape,
    badges: method.badges,
  }));
}
