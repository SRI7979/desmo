import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeChoices, parseNumber } from "./answer-consistency";
import {
  ExplanationError,
  explanationInput,
  fallbackExplanation,
  presentMethod,
  validateExplanationQuality,
} from "./method-presentation";
import { assignBadges, COST_WEIGHTS } from "./method-scoring";
import type { MethodSummary } from "./method-summary";
import {
  CACHE_ENTRY_VERSION,
  cacheKeyFor,
  eligibleMethods,
  explanationSchema,
  inputHash,
  problemKey,
  promptConfigVersion,
  retryCacheKey,
  type CacheEntry,
  type PreflightRecord,
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
  desmosRescueTarget,
  mergeSelections,
  rescueReason,
  selectMethods,
  StrategySelectionError,
  type CandidatesResponse,
  type Method,
  type MethodSelection,
} from "./strategy-selection";
import { NO_USAGE, timeoutEstimate } from "./model-pricing";
import { classifyOpenAIError, describeOpenAIError } from "./openai-errors";
import type { Meter, ModelCall } from "./spend";
import { TECHNIQUES } from "./technique-vocabulary";
import { loadTrainingExamples } from "./training-examples";
import { expectedIntegerFactorExtremumAnswer, repairIntegerFactorExtremum, repairQuadraticRationalIntercept } from "./semantic-repairs";

/** One guided correction per call, shared by both calls. */
export const MAX_ATTEMPTS = 2;

export type ModelTimeouts = { candidatesMs: number; explanationMs: number };

/**
 * How long one OpenAI call may run before it is aborted: CANDIDATES_TIMEOUT_MS
 * (default 60 s; the Desmos retry uses it too) and EXPLANATION_TIMEOUT_MS
 * (default 30 s). Read per call. Even a correct hard question can spend over
 * 20 s in candidate generation; the former 20 s default aborted it before
 * validation or Desmos could run. The route deadline still bounds every call.
 */
export function modelTimeouts(env: Record<string, string | undefined> = process.env): ModelTimeouts {
  const read = (value: string | undefined, fallback: number) => {
    const parsed = Number(value?.trim());
    return value?.trim() && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };
  const configuredCandidates = read(env.CANDIDATES_TIMEOUT_MS, 60_000);
  // Earlier deployments used 20 s. A stale production setting must not keep
  // aborting the same hard questions after the code's default was raised.
  const candidatesMs = env.NODE_ENV === "production" ? Math.max(configuredCandidates, 60_000) : configuredCandidates;
  return { candidatesMs, explanationMs: read(env.EXPLANATION_TIMEOUT_MS, 30_000) };
}

/** A call is not started with less time than this left before the request's deadline. */
const MIN_CALL_MS = 1_000;

/** An OpenAI call ran past its timeout (or the request's deadline) and was aborted. */
export class ModelTimeoutError extends Error {
  constructor(readonly call: ModelCall, readonly timeoutMs: number) {
    super(`The ${call} call was aborted after ${timeoutMs} ms.`);
    this.name = "ModelTimeoutError";
  }
}
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
  /** bytes: the upload as received (hashed for the cache); modelBytes: what is sent, when downscaled. */
  | { kind: "image"; bytes: Buffer; mime: string; modelBytes?: Buffer }
  | { kind: "text"; problem: string; choices: string[] | null };

export type PipelineDeps = {
  client: OpenAI;
  cache: SolveCache;
  context: SolveContext;
  tier: ServiceTierState;
  diagnosticId: string;
  signal?: AbortSignal;
  /** Records every call's usage and enforces the spend limits; absent in evals and scripts. */
  meter?: Meter;
  /**
   * Epoch ms by which every model call must have finished: the route's
   * execution limit minus a margin. No call's timeout may run past it, so
   * the host never kills the function mid-call, whatever the env timeouts.
   */
  deadline?: number;
  /** Stage timings and raw model outputs, for latency profiling and offline replay. */
  trace?: SolveTrace;
};

export type CallCounts = { candidates: number; explanation: number };

export type TokenUsage = { input: number; cached: number; output: number; reasoning: number };

/** Wall-clock time of one pipeline stage; model stages carry their token usage. */
export type StageTiming = { stage: string; ms: number; usage?: TokenUsage };

/** One call-1 output as the model returned it, before validation, and what rejected it. */
export type CandidateOutput = {
  call: "candidates" | "desmos_retry";
  attempt: number;
  output: unknown;
  rejection: { stage: string; reason: string } | null;
};

/**
 * Optional instrumentation. Stage timings show where a solve's time goes
 * (model generation versus validation, cache, and Desmos-retry work); the raw
 * candidate outputs let the eval harness replay server-side selection after a
 * scoring or validation change without paying for new model calls.
 */
export type SolveTrace = { stages: StageTiming[]; candidateOutputs: CandidateOutput[] };

export function createTrace(): SolveTrace {
  return { stages: [], candidateOutputs: [] };
}

async function timed<T>(trace: SolveTrace | undefined, stage: string, work: () => Promise<T>): Promise<T> {
  if (!trace) return work();
  const started = performance.now();
  try {
    return await work();
  } finally {
    trace.stages.push({ stage, ms: Math.round(performance.now() - started) });
  }
}

function usageOf(response: OpenAI.Responses.Response): TokenUsage | undefined {
  const usage = response.usage;
  if (!usage) return undefined;
  return {
    input: usage.input_tokens ?? 0,
    cached: usage.input_tokens_details?.cached_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    reasoning: usage.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

function recordCandidateOutput(
  deps: PipelineDeps,
  call: CandidateOutput["call"],
  attempt: number,
  response: OpenAI.Responses.Response,
  rejection: SolveValidationError | null,
) {
  if (!deps.trace) return;
  let output: unknown = modelOutputText(response);
  try {
    output = JSON.parse(output as string);
  } catch {
    // Kept as text: the harness reports it as a JSON failure.
  }
  deps.trace.candidateOutputs.push({
    call,
    attempt,
    output,
    rejection: rejection ? { stage: rejection.stage, reason: rejection.message } : null,
  });
}

/**
 * An entry with its cached pre-flight verdicts applied. "ready": the methods
 * not known to error in Desmos, in rank order and re-badged over that set
 * (winner first). "needs-retry": every method errored and the one Desmos
 * retry has not run. "failed": the retry ran and its methods all errored too
 * (or it produced none), so there is nothing that can honestly be shown.
 */
export type ResolvedEntry =
  | { status: "ready"; entry: CacheEntry; verdicts: Record<string, PreflightRecord>; methods: Method[]; winner: Method }
  | { status: "needs-retry" | "failed"; entry: CacheEntry; verdicts: Record<string, PreflightRecord> };
export type ReadyEntry = Extract<ResolvedEntry, { status: "ready" }>;

export const HONEST_FAILURE =
  "Every method found for this problem has a Desmos line that errors, even after one corrected attempt, so none is shown. Try a tighter crop of just this question.";

/** No method survived pre-flight, even after the one retry: an honest failure, never erroring rows. */
export class PreflightFailedError extends Error {
  constructor() {
    super(HONEST_FAILURE);
    this.name = "PreflightFailedError";
  }
}

/**
 * Applies the cached pre-flight verdicts: a method any browser's hidden
 * Desmos instance reported erroring is dropped, the cheapest survivor becomes
 * the default, and badges are recomputed over the survivors. When every
 * method errored, the entry's Desmos retry (if it ran) takes its place.
 */
export async function resolveEntry(cache: SolveCache, entry: CacheEntry, options: { fresh?: boolean } = {}): Promise<ResolvedEntry> {
  const verdicts = options.fresh ? {} : await cache.getPreflight(entry.cacheKey);
  const surviving = eligibleMethods(entry).filter((method) => verdicts[method.id]?.status !== "error");
  if (surviving.length > 0) {
    const badges = assignBadges(surviving);
    const methods = surviving.map((method) => ({ ...method, badges: badges.get(method.id) ?? [] }));
    return { status: "ready", entry, verdicts, methods, winner: methods[0] };
  }
  if (entry.retryOf !== null) return { status: "failed", entry, verdicts };
  const retry = await cache.getEntry(retryCacheKey(entry.cacheKey));
  return retry ? resolveEntry(cache, retry) : { status: "needs-retry", entry, verdicts };
}

/** The Desmos errors, row by row, as a guided-retry rejection for call 1. */
function desmosRejection(entry: CacheEntry, verdicts: Record<string, PreflightRecord>): Rejection {
  const methods = eligibleMethods(entry);
  const failures = methods.map((method) => {
    const verdict = verdicts[method.id];
    const errors = verdict?.status === "error"
      ? verdict.errors.map((error) => `line ${error.row} ${JSON.stringify(method.rows[error.row - 1]?.latex ?? "")}: ${error.message}`).join("; ")
      : "not run";
    return `${method.techniqueId}: ${errors}`;
  });
  return {
    stage: "desmos_preflight",
    reason:
      "every candidate's calculator rows were inserted into a real Desmos instance (API v1.11) and at least one row of each ERRORED, " +
      `so no candidate can be shown. Desmos reported: ${failures.join(" | ")}. ` +
      "Correct each technique so every row runs, or replace it with a technique whose rows run; never pad. A single unknown is a bare " +
      "letter the regression leaves undefined, never a one-element list, and Desmos has no nested lists.",
    previous: JSON.stringify({
      question: entry.question,
      candidates: methods.map((method) => ({ techniqueId: method.techniqueId, rows: method.rows.map((row) => row.latex) })),
    }),
  };
}

/**
 * The one retry after every candidate errored in Desmos: call 1 again, on the
 * already-transcribed question, with each row's Desmos error attached. The
 * result is stored under the entry's retry key (first writer wins), including
 * a retry that produced no usable method, so it never runs twice.
 */
export async function retryAfterDesmosErrors(
  deps: PipelineDeps,
  entry: CacheEntry,
  verdicts: Record<string, PreflightRecord>,
  calls: CallCounts = { candidates: 0, explanation: 0 },
): Promise<CacheEntry> {
  const input: SolveInput = { kind: "text", problem: entry.question, choices: entry.choices?.map((choice) => choice.text) ?? null };
  // Extra model work on an existing problem: only the global ceiling applies.
  await deps.meter?.authorizeRetry();
  deps.meter?.setCacheKey(entry.cacheKey);
  const response = await callModel(deps, candidateRequest(deps, input, desmosRejection(entry, verdicts)), "desmos_retry");
  calls.candidates += 1;
  const base = {
    version: CACHE_ENTRY_VERSION,
    cacheKey: retryCacheKey(entry.cacheKey),
    promptConfigVersion: entry.promptConfigVersion,
    question: entry.question,
    choices: entry.choices,
    structure: entry.structure,
    retryOf: entry.cacheKey,
    createdAt: new Date().toISOString(),
  } as const;
  try {
    const { parsed } = validateCandidatesResponse(response);
    if (parsed.status !== "solved") throw new StrategySelectionError("The retry asked for clarification instead of candidates.");
    const repaired = repairQuadraticRationalIntercept({ ...parsed, question: entry.question, choices: entry.choices });
    const selection = selectMethods(repaired);
    const knownExtremum = expectedIntegerFactorExtremumAnswer(entry.question);
    if (knownExtremum !== null && selection.methods.some((method) =>
      method.rejected === null &&
      (parseNumber(method.answer) !== knownExtremum ||
        (method.result.value !== null && method.result.value !== knownExtremum))
    )) {
      throw new StrategySelectionError(
        `A retry candidate does not reach the checked integer-factor extremum ${knownExtremum}.`,
        "answer_consistency",
      );
    }
    recordCandidateOutput(deps, "desmos_retry", 1, response, null);
    return await deps.cache.putEntry({
      ...base,
      methods: selection.methods,
      winnerId: selection.winnerId,
      modelPreference: selection.modelPreference,
    });
  } catch (error) {
    const failure = error instanceof StrategySelectionError ? new SolveValidationError(error.stage, error.message) : error;
    if (!(failure instanceof SolveValidationError)) throw error;
    recordCandidateOutput(deps, "desmos_retry", 1, response, failure);
    await logSolveRejection(`${deps.diagnosticId}-desmos-retry`, 1, response, failure);
    return deps.cache.putEntry({ ...base, methods: [], winnerId: "", modelPreference: null });
  }
}

/** Resolves an entry, running its one Desmos retry if every method errored and it has not run yet. */
export async function resolveOrRetry(deps: PipelineDeps, entry: CacheEntry, calls?: CallCounts, options: { fresh?: boolean } = {}): Promise<ReadyEntry> {
  let resolved = await resolveEntry(deps.cache, entry, options);
  if (resolved.status === "needs-retry") {
    await retryAfterDesmosErrors(deps, resolved.entry, resolved.verdicts, calls);
    resolved = await resolveEntry(deps.cache, entry);
  }
  if (resolved.status !== "ready") throw new PreflightFailedError();
  return resolved;
}

export type MethodsReady = {
  resolved: ReadyEntry;
  /** True when the entry came from the cache (an input or problem hit). */
  cached: boolean;
};

export type SolvedResult = {
  kind: "solved";
  /** The entry the methods come from: the problem's entry, or its Desmos retry. */
  entry: CacheEntry;
  resolved: ReadyEntry;
  method: Method;
  solution: Solution;
  cached: boolean;
  hit: "input" | "problem" | null;
  explanation: "cache" | "model" | "fallback";
  /** Why the default's explanation fell back, when it did: for error reports. */
  explanationFailure?: unknown;
  calls: CallCounts;
  timings: { methodsMs: number; completeMs: number };
  repairs: string[];
  /**
   * The Desmos rescue for this solve: "applied" when a corrected Desmos
   * technique became the default, "kept" when the correction ran but the
   * original default stood, "failed" when the correction call or its
   * validation failed (the original selection is used), null when none ran.
   */
  rescue: RescueOutcome;
};

export type RescueOutcome = "applied" | "kept" | "failed" | null;

export type SolveResult =
  | { kind: "clarification"; solution: Solution; calls: CallCounts; timings: { methodsMs: number; completeMs: number } }
  | SolvedResult;

function isGpt5(model: string) {
  return model.startsWith("gpt-5");
}

/**
 * One OpenAI call, aborted by its own AbortController at the configured
 * timeout or the request's deadline, whichever comes first (and by the
 * client disconnecting). The SDK's retries are off; the solve pipeline alone
 * may make one separately metered, deadline-gated candidate timeout recovery.
 * Rate limits and explanation timeouts are never retried here.
 */
async function callModel(
  deps: PipelineDeps,
  body: Record<string, unknown>,
  call: ModelCall,
): Promise<OpenAI.Responses.Response> {
  const configured = call === "explanation" ? modelTimeouts().explanationMs : modelTimeouts().candidatesMs;
  const remaining = deps.deadline ? deps.deadline - Date.now() : Infinity;
  // Not enough time left before the deadline to be worth a paid request: fail now, before sending.
  if (remaining < MIN_CALL_MS) throw new ModelTimeoutError(call, Math.max(0, Math.round(remaining)));
  const timeoutMs = Math.min(configured, remaining);
  const model = String(body.model);
  let tier = configuredServiceTier(deps.tier);
  let priorityFallback = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = deps.signal ? AbortSignal.any([deps.signal, controller.signal]) : controller.signal;
  const send = (serviceTier: (typeof serviceTiers)[number]) =>
    deps.client.responses.create(
      { ...(body as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming), ...(serviceTier === "priority" ? { service_tier: "priority" as const } : {}) },
      { signal },
    );
  const started = performance.now();
  let response: OpenAI.Responses.Response;
  try {
    try {
      response = await send(tier);
    } catch (error) {
      if (tier !== "priority" || !rejectsServiceTier(error)) throw error;
      deps.tier.priorityUnavailable = true;
      tier = "default";
      priorityFallback = true;
      response = await send(tier);
    }
  } catch (error) {
    if (controller.signal.aborted && !deps.signal?.aborted) {
      console.warn("[desmo:call-timeout]", JSON.stringify({
        id: deps.diagnosticId,
        call,
        elapsedMs: Math.round(performance.now() - started),
        configuredMs: configured,
        limitMs: Math.round(timeoutMs),
        deadlineBound: remaining < configured,
        serviceTier: tier,
        priorityFallback,
      }));
      // OpenAI may still have finished (and billed) the call; its usage never
      // arrives, so it is recorded at a deliberately high estimate.
      const maxOutput = typeof body.max_output_tokens === "number" ? body.max_output_tokens : 8_000;
      await deps.meter?.record(call, { status: "timeout", model, serviceTier: tier, usage: timeoutEstimate(call, maxOutput), estimated: true });
      throw new ModelTimeoutError(call, Math.round(timeoutMs));
    }
    // A rejected or failed request is not billed; it is still recorded, so
    // failures show up next to what the successful calls cost.
    await deps.meter?.record(call, { status: "failed", model, serviceTier: tier, usage: NO_USAGE, estimated: false });
    // Out of credit or locked out: every later call fails too, and students
    // only see "temporarily unavailable", so the real cause is logged loudly here.
    if (classifyOpenAIError(error).kind === "quota" || (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403))) {
      console.error(`[desmo:ALERT] OpenAI refused the ${call} call; new solves will fail until this is fixed: ${describeOpenAIError(error)}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    deps.trace?.stages.push({ stage: `model_${call}`, ms: Math.round(performance.now() - started) });
  }
  const stage = deps.trace?.stages.at(-1);
  if (stage) stage.usage = usageOf(response);
  // The tier OpenAI reports actually applied is what it bills.
  await deps.meter?.record(call, { status: "completed", model: response.model || model, serviceTier: response.service_tier ?? tier, usage: response.usage });
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
        serviceTier: response.service_tier ?? tier,
        priorityFallback,
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
            ? { type: "input_image", image_url: `data:${input.mime};base64,${(input.modelBytes ?? input.bytes).toString("base64")}`, detail: "high" }
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
): Promise<{ solution: Solution; source: "cache" | "model" | "fallback"; failure?: unknown }> {
  deps.meter?.setCacheKey(entry.cacheKey);
  const cached = await deps.cache.getExplanation(entry.cacheKey, method.id);
  if (cached) {
    try {
      validateExplanationQuality(method, cached);
      return { solution: presentMethod(entry, method, cached), source: "cache" };
    } catch {
      // A cached explanation that no longer matches its method is regenerated.
    }
  }
  let rejection: Rejection | undefined;
  // Why the fallback was needed, so the caller can report it with context.
  let failure: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: OpenAI.Responses.Response;
    try {
      response = await callModel(deps, explanationRequest(deps, entry, method, rejection), "explanation");
      calls.explanation += 1;
    } catch (error) {
      if (deps.signal?.aborted) throw error;
      failure = error;
      break;
    }
    try {
      const explanation = validateExplanationResponse(response);
      validateExplanationQuality(method, explanation);
      presentMethod(entry, method, explanation);
      const stored = await deps.cache.putExplanation(entry.cacheKey, method.id, explanation);
      return { solution: presentMethod(entry, method, stored), source: "model" };
    } catch (error) {
      const rejected = error instanceof ExplanationError ? new SolveValidationError(error.stage, error.message) : error;
      if (!(rejected instanceof SolveValidationError)) throw error;
      await logSolveRejection(`${deps.diagnosticId}-explanation`, attempt, response, rejected);
      rejection = { stage: rejected.stage, reason: rejected.message, previous: modelOutputText(response) };
    }
  }
  return {
    solution: presentMethod(entry, method, fallbackExplanation(method)),
    source: "fallback",
    failure: failure ?? new ExplanationError(`The explanation was rejected twice: ${rejection?.reason ?? "unknown"}`, rejection?.stage),
  };
}

/** DESMO_DESMOS_RESCUE=off disables the rescue (for A/B benchmarking); it is on by default. */
export function rescueEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DESMO_DESMOS_RESCUE?.trim().toLowerCase() !== "off";
}

/**
 * One guided correction when a math-heavy default stands only because a
 * cheaper Desmos technique was rejected for a fixable slip (see
 * desmosRescueTarget). The corrected candidates are merged with the original
 * selection, so the result is never worse than without the rescue: a failed
 * call, a clarification, or a correction that is still rejected keeps the
 * original selection. Only runs on a first attempt with time left for a
 * full candidates call and the explanation.
 */
async function rescueDesmosCandidate(
  deps: PipelineDeps,
  input: SolveInput,
  response: OpenAI.Responses.Response,
  selection: MethodSelection,
  calls: CallCounts,
): Promise<{ selection: MethodSelection; outcome: RescueOutcome }> {
  const target = desmosRescueTarget(selection);
  if (!target || !rescueEnabled()) return { selection, outcome: null };
  const { candidatesMs, explanationMs } = modelTimeouts();
  const remaining = deps.deadline ? deps.deadline - Date.now() : Infinity;
  if (deps.signal?.aborted || remaining < candidatesMs + explanationMs) return { selection, outcome: null };
  const rejection: Rejection = { stage: "desmos_rescue", reason: rescueReason(target), previous: modelOutputText(response) };
  let retried: OpenAI.Responses.Response;
  try {
    await deps.meter?.authorizeRetry();
    calls.candidates += 1;
    retried = await callModel(deps, candidateRequest(deps, input, rejection), "candidates");
  } catch (error) {
    // Out of budget, a timeout, or a provider error: the original selection stands.
    if (deps.signal?.aborted) throw error;
    console.warn("[desmo:rescue]", JSON.stringify({ id: deps.diagnosticId, outcome: "failed", error: error instanceof Error ? error.name : String(error) }));
    return { selection, outcome: "failed" };
  }
  try {
    const { parsed } = validateCandidatesResponse(retried);
    if (parsed.status !== "solved") throw new StrategySelectionError("The rescue asked for clarification instead of candidates.");
    const corrected = selectMethods(repairIntegerFactorExtremum(repairQuadraticRationalIntercept({ ...parsed, question: selection.question, choices: selection.choices })));
    recordCandidateOutput(deps, "candidates", 2, retried, null);
    const merged = mergeSelections(selection, corrected);
    const outcome = merged.winnerId !== selection.winnerId ? "applied" : "kept";
    console.info("[desmo:rescue]", JSON.stringify({ id: deps.diagnosticId, outcome, from: target.winner.techniqueId, to: merged.winnerId }));
    return { selection: merged, outcome };
  } catch (error) {
    const failure = error instanceof StrategySelectionError ? new SolveValidationError(error.stage, error.message) : error;
    if (!(failure instanceof SolveValidationError)) throw error;
    recordCandidateOutput(deps, "candidates", 2, retried, failure);
    await logSolveRejection(`${deps.diagnosticId}-rescue`, 2, retried, failure);
    return { selection, outcome: "failed" };
  }
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
  let timeoutRetryUsed = false;
  let rescue: RescueOutcome = null;

  entry = await timed(deps.trace, "cache_lookup", async () => {
    const known = await deps.cache.lookupInput(hash, version);
    return known ? deps.cache.getEntry(known) : null;
  });
  if (entry) {
    hit = "input";
    deps.meter?.setCacheKey(entry.cacheKey);
  }

  if (!entry) {
    let rejection: Rejection | undefined;
    for (let attempt = 1; !entry; attempt += 1) {
      // A new problem: checked against the daily cap and the spend ceiling
      // once, before its first model call. A cached input never gets here.
      if (attempt === 1) await deps.meter?.authorizeSolve();
      const request = candidateRequest(deps, input, rejection);
      const send = () => {
        calls.candidates += 1;
        return callModel(deps, request, "candidates");
      };
      let response: OpenAI.Responses.Response;
      try {
        response = await send();
      } catch (error) {
        // Concurrent provider load can make an otherwise 15–25 s candidate
        // generation exceed its 60 s cap. Recover once only when the route
        // still has a full candidate and explanation budget. A deadline-bound
        // abort or a disconnected client must never start another paid call.
        const { candidatesMs, explanationMs } = modelTimeouts();
        const remaining = deps.deadline ? deps.deadline - Date.now() : Infinity;
        if (!(error instanceof ModelTimeoutError) || timeoutRetryUsed || deps.signal?.aborted || remaining < candidatesMs + explanationMs) throw error;
        timeoutRetryUsed = true;
        await deps.meter?.authorizeRetry();
        console.warn("[desmo:timeout-retry]", JSON.stringify({ id: deps.diagnosticId, remainingMs: Number.isFinite(remaining) ? Math.round(remaining) : null }));
        response = await send();
      }
      try {
        const selectStarted = performance.now();
        const { parsed: rawParsed, repairs: metadataRepairs } = validateCandidatesResponse(response);
        const parsed = repairIntegerFactorExtremum(repairQuadraticRationalIntercept(rawParsed));
        if (parsed.status === "needs_clarification") {
          recordCandidateOutput(deps, "candidates", attempt, response, null);
          const elapsed = performance.now() - started;
          return { kind: "clarification", solution: clarificationSolution(parsed), calls, timings: { methodsMs: elapsed, completeMs: elapsed } };
        }
        const key = cacheKeyFor(problemKey(parsed.question, stableChoices(parsed.choices)), version);
        deps.meter?.setCacheKey(key);
        const existing = await timed(deps.trace, "cache_lookup_problem", () => deps.cache.getEntry(key));
        if (existing) {
          recordCandidateOutput(deps, "candidates", attempt, response, null);
          entry = existing;
          hit = "problem";
          break;
        }
        let selection = selectMethods(parsed);
        deps.trace?.stages.push({ stage: "validate_select", ms: Math.round(performance.now() - selectStarted) });
        recordCandidateOutput(deps, "candidates", attempt, response, null);
        if (attempt === 1 && desmosRescueTarget(selection)) {
          ({ selection, outcome: rescue } = await timed(deps.trace, "desmos_rescue", () => rescueDesmosCandidate(deps, input, response, selection, calls)));
        }
        repairs = metadataRepairs;
        entry = await timed(deps.trace, "cache_write", () => deps.cache.putEntry({
          version: CACHE_ENTRY_VERSION,
          cacheKey: key,
          promptConfigVersion: version,
          question: selection.question,
          choices: selection.choices,
          structure: selection.structure,
          methods: selection.methods,
          winnerId: selection.winnerId,
          modelPreference: selection.modelPreference,
          retryOf: null,
          createdAt: new Date().toISOString(),
        }));
        const winner = eligibleMethods(entry).find((method) => method.id === entry!.winnerId);
        if (selection.modelPreference && winner && selection.modelPreference !== winner.techniqueId) {
          logSelectionDisagreement(deps.diagnosticId, selection.modelPreference, winner.techniqueId);
        }
      } catch (error) {
        const failure = error instanceof StrategySelectionError ? new SolveValidationError(error.stage, error.message) : error;
        if (!(failure instanceof SolveValidationError)) throw error;
        recordCandidateOutput(deps, "candidates", attempt, response, failure);
        await logSolveRejection(deps.diagnosticId, attempt, response, failure);
        if (attempt >= MAX_ATTEMPTS || deps.signal?.aborted) throw failure;
        rejection = { stage: failure.stage, reason: failure.message, previous: modelOutputText(response) };
      }
    }
  }

  // A fresh entry has no verdicts yet; a cached one may: an erroring winner
  // is replaced, and a problem whose every method errored uses its retry.
  const resolved = await timed(deps.trace, "resolve", () => resolveOrRetry(deps, entry!, calls, { fresh: hit === null }));
  const method = resolved.winner;
  const methodsMs = performance.now() - started;
  await onMethods?.({ resolved, cached: hit !== null });
  const [explained] = await Promise.all([
    timed(deps.trace, "explanation", () => explainMethod(deps, resolved.entry, method, calls)),
    hit !== "input" ? deps.cache.rememberInput(hash, version, entry!.cacheKey) : undefined,
  ]);
  return {
    kind: "solved",
    entry: resolved.entry,
    resolved,
    method,
    solution: explained.solution,
    cached: hit !== null,
    hit,
    explanation: explained.source,
    explanationFailure: explained.failure,
    calls,
    timings: { methodsMs, completeMs: performance.now() - started },
    repairs,
    rescue,
  };
}

/**
 * The method list a client shows in its selector: methods that passed every
 * rule and are not known to error in Desmos, in rank order, with everything
 * needed to render a technique the instant it is chosen (rows, graph bounds,
 * slider position, readout) — not a hand-picked subset, since a field left
 * out here is a field the UI cannot show without another round trip.
 * `verified` marks a method whose rows a browser already ran cleanly, so
 * this client skips re-checking it before choosing a default.
 */
export function methodSummaries(resolved: ReadyEntry): MethodSummary[] {
  return resolved.methods.map(({ rejected: _rejected, repairs: _repairs, ...summary }) => {
    void _rejected;
    void _repairs;
    return { ...summary, verified: summary.rows.length === 0 || resolved.verdicts[summary.id]?.status === "clean" };
  });
}
