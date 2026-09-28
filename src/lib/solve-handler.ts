import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ACCEPTED_IMAGE_TYPES, type Solution } from "@/lib/solver-schema";
import { classifyOpenAIError } from "@/lib/openai-errors";
import { eligibleMethods, preflightRecordSchema, type SolveCache } from "@/lib/solve-cache";
import { SolveValidationError } from "@/lib/solve-output";
import {
  explainMethod,
  HONEST_FAILURE,
  loadSolveContext,
  methodSummaries,
  ModelTimeoutError,
  PreflightFailedError,
  RefusalError,
  resolveEntry,
  resolveOrRetry,
  solveProblem,
  type MethodsReady,
  type PipelineDeps,
  type ReadyEntry,
  type ServiceTierState,
  type SolveResult,
} from "@/lib/solve-pipeline";
import {
  createMeter,
  DailyCapError,
  type Meter,
  limitsFromEnv,
  SpendCeilingError,
  UsageUnavailableError,
  type Limits,
  type UsageStore,
} from "@/lib/spend";
import { MAX_CANDIDATES } from "@/lib/strategy-selection";
import { consoleSink, createTelemetry, type Telemetry, type TelemetryContext } from "@/lib/telemetry";
import { TrainingBatchError } from "@/lib/training-examples";
import {
  InvalidImageError,
  maxImageBytes,
  prepareModelImage,
  tooLargeMessage,
  unsupportedTypeMessage,
  validateImage,
} from "@/lib/upload-validation";

export type SolveDependencies = {
  getCurrentUser: () => Promise<{ id: string } | null>;
  reserveSolve: (userId: string) => Promise<{ allowed: boolean; retryAfter: number }>;
  saveProblem: (input: { userId: string; bytes: Buffer; mime: string; solution: Solution }) => Promise<string>;
  getCache: () => SolveCache;
  /** Where every OpenAI call's usage and cost is recorded, and the limits are checked. */
  getUsage: () => UsageStore;
  /** Defaults to FREE_SOLVES_PER_DAY and DAILY_SPEND_CEILING_USD, read per request. */
  limits?: () => Limits;
  /** The route's maxDuration: every model call must finish inside it. */
  maxDurationSeconds: number;
  /** Error capture and product events; defaults to structured console logs. */
  telemetry?: Telemetry;
};

export type MethodDependencies = Pick<SolveDependencies, "getCurrentUser" | "getCache" | "getUsage" | "limits" | "maxDurationSeconds" | "telemetry">;

const consoleTelemetry = createTelemetry([consoleSink()]);

function telemetryFor(dependencies: MethodDependencies): Telemetry {
  return dependencies.telemetry ?? consoleTelemetry;
}

/** Limits, refusals, and rejected uploads are answered, not failures to investigate. */
function isExpected(error: unknown): boolean {
  return error instanceof UploadError || error instanceof InvalidImageError || error instanceof DailyCapError || error instanceof SpendCeilingError;
}

/** A short, stable label for why a request failed, for events and dashboards. */
function failureKind(error: unknown): string {
  if (error instanceof ModelTimeoutError) return `timeout_${error.call}`;
  if (error instanceof PreflightFailedError) return "desmos_preflight";
  if (error instanceof UsageUnavailableError) return "usage_unavailable";
  if (error instanceof SolveValidationError) return `validation_${error.stage}`;
  if (error instanceof RefusalError) return "refusal";
  if (error instanceof OpenAI.APIError) return `openai_${classifyOpenAIError(error).kind}_${error.status ?? "none"}`;
  return error instanceof Error ? error.name : "unknown";
}

/** Room left after the last model call for cache writes, saving history, and the response. */
const DEADLINE_MARGIN_MS = 5_000;

function deadlineFor(dependencies: MethodDependencies, startedAt: number): number {
  return startedAt + dependencies.maxDurationSeconds * 1000 - DEADLINE_MARGIN_MS;
}

/** A meter for one request: usage recorded under this user and request id. */
function meterFor(dependencies: MethodDependencies, userId: string, solveId: string) {
  const telemetry = telemetryFor(dependencies);
  return createMeter({
    store: dependencies.getUsage(),
    userId,
    solveId,
    limits: (dependencies.limits ?? limitsFromEnv)(),
    onRecordError: (error) => telemetry.error(error, { userId, solveId, stage: "usage_record" }),
    onCeiling: (error) => {
      console.error(`[desmo:ALERT] ceiling_hit: ${error.message} New solves are refused until midnight UTC. Raise DAILY_SPEND_CEILING_USD to reopen.`);
      telemetry.event("ceiling_hit", { userId, solveId, spentUsd: error.spentUsd, ceilingUsd: error.ceilingUsd });
    },
    onCap: (error) => telemetry.event("cap_hit", { userId, solveId, limit: error.limit, resetsAt: error.resetsAt }),
  });
}

function describeReset(resetsAt: string | null): string {
  const remaining = resetsAt ? Date.parse(resetsAt) - Date.now() : NaN;
  if (!Number.isFinite(remaining) || remaining <= 0) return "shortly";
  const hours = Math.ceil(remaining / 3_600_000);
  return hours <= 1 ? "within the hour" : `in about ${hours} hours`;
}

// Leave room for multipart headers while bounding uploads, including chunked ones.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const NDJSON = "application/x-ndjson";

class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** A failure waiting will not fix (no credit, a configuration problem): no countdown, no internals. */
function unavailable() {
  return Response.json(
    { kind: "unavailable", error: "Service temporarily unavailable. Please try again later." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function crossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") === "cross-site" || Boolean(origin && origin !== new URL(request.url).origin);
}

/** Clients that can render the calculator before the explanation opt in with Accept. */
function wantsStream(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes(NDJSON);
}

/**
 * Reads the one uploaded image, refusing an oversized or wrongly typed file
 * from its headers and size alone: nothing is decoded, reserved, or sent to
 * OpenAI for a file that fails here.
 */
async function readUpload(request: Request): Promise<File> {
  const limit = maxImageBytes();
  const maxRequestBytes = limit + MULTIPART_OVERHEAD_BYTES;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new UploadError("Upload a screenshot as PNG, JPG, or WebP.", 400);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > maxRequestBytes) {
    throw new UploadError(tooLargeMessage(contentLength - MULTIPART_OVERHEAD_BYTES, limit), 413);
  }
  if (!request.body) throw new UploadError("Choose a screenshot first.", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestBytes) {
        await reader.cancel();
        throw new UploadError(tooLargeMessage(null, limit), 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new UploadError("The upload could not be read. Choose the screenshot again.", 400);
  }

  // The request shape is exactly one image field; nothing else is accepted.
  if ([...form.keys()].some((key) => key !== "image")) {
    throw new UploadError("Send only the screenshot.", 400);
  }
  const images = form.getAll("image");
  if (images.length !== 1 || !(images[0] instanceof File)) {
    throw new UploadError("Upload one screenshot at a time.", 400);
  }
  const image = images[0];
  if (image.size === 0) throw new UploadError("That image is empty. Choose another screenshot.", 400);
  if (image.size > limit) {
    throw new UploadError(tooLargeMessage(image.size, limit), 413);
  }
  if (!ACCEPTED_IMAGE_TYPES.some((type) => type === image.type)) {
    throw new UploadError(unsupportedTypeMessage(image.type), 415);
  }
  return image;
}

function matchesImageSignature(bytes: Buffer, mime: string) {
  if (mime === "image/png") {
    return (
      bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
      bytes.toString("ascii", 12, 16) === "IHDR"
    );
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    mime === "image/webp" &&
    bytes.length >= 16 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16))
  );
}

function errorFor(error: unknown, diagnosticId: string): Response {
  if (error instanceof SolveValidationError) {
    const development = process.env.NODE_ENV === "development";
    return Response.json(
      {
        error: development
          ? `Solution validation failed [${error.stage}]: ${error.message}`
          : "The solver could not produce a valid solution after one correction. Please try again.",
        diagnosticId,
        ...(development ? { validation: { stage: error.stage, message: error.message, issues: error.issues } } : {}),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof UploadError || error instanceof InvalidImageError) return errorResponse(error.message, error.status);
  // Limits are not failures: a clear message, no countdown, and existing work stays readable.
  if (error instanceof DailyCapError) {
    return Response.json(
      {
        kind: "daily_cap",
        error: `You've used today's ${error.limit} solves. New solves open again ${describeReset(error.resetsAt)}. Your history and the problems you've already solved stay available.`,
        resetsAt: error.resetsAt,
      },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof SpendCeilingError) {
    return Response.json(
      {
        kind: "at_capacity",
        error: "Desmo is at capacity today. New solves open again after midnight UTC. Your history and the problems you've already solved stay available.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof UsageUnavailableError) {
    console.error("[desmo:ALERT] usage limits unavailable; refusing new model work", error.cause instanceof Error ? error.cause.message : error.cause);
    return Response.json(
      { kind: "unavailable", error: "The solver is temporarily unavailable. Please try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof PreflightFailedError) {
    return Response.json({ status: "failed", error: HONEST_FAILURE }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof RefusalError) {
    return errorResponse("The AI could not process that image. Try a clear crop of just the math question.", 422);
  }
  if (error instanceof TrainingBatchError) {
    return errorResponse("The strategy training data is invalid. Check the JSON batches and try again.", 500);
  }
  if (error instanceof ModelTimeoutError || error instanceof OpenAI.APIConnectionTimeoutError) {
    return Response.json(
      { kind: "timeout", error: "The AI took too long to respond, so this solve was stopped. Please try again." },
      { status: 504, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof OpenAI.APIUserAbortError) {
    return errorResponse("The solve was canceled. Upload the screenshot again to retry.", 408);
  }
  if (error instanceof OpenAI.APIError) {
    const failure = classifyOpenAIError(error);
    // Only a real rate limit clears by waiting, so only it gets a countdown.
    if (failure.kind === "rate_limited") {
      const seconds = failure.retryAfterSeconds;
      return Response.json(
        { kind: "rate_limited", error: `The AI service is busy right now. Try again in ${seconds} seconds.`, retryAfter: seconds },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(seconds) } },
      );
    }
    // Out of credit: waiting never helps, so no countdown (and no billing
    // details for students). callModel has already logged the real cause.
    if (failure.kind === "quota") return unavailable();
    const development = process.env.NODE_ENV === "development";
    if (error.status === 401 || error.status === 403) {
      return development
        ? errorResponse("OpenAI rejected the API key or project access. Check OPENAI_API_KEY in .env.local and restart the server.", 503)
        : unavailable();
    }
    if (error.status === 404 || error.code === "model_not_found") {
      return development
        ? errorResponse("The configured AI model is unavailable. Check OPENAI_MODEL in .env.local and your project's model access.", 503)
        : unavailable();
    }
    if (error.status === 400) {
      if (error.code?.includes("image")) return errorResponse("OpenAI could not read that image. Try a new PNG or JPG screenshot.", 400);
      return development
        ? errorResponse("OpenAI could not use the current model settings. Check OPENAI_MODEL supports images and structured outputs.", 502)
        : errorResponse("The solver could not finish. Please try again.", 502);
    }
    return errorResponse("Could not reach the AI service. Please try again.", 502);
  }
  return errorResponse("The screenshot could not be solved. Please try again.", 500);
}

function methodsPayload(resolved: ReadyEntry, cached: boolean, selectedMethodId = resolved.winner.id) {
  return {
    cacheKey: resolved.entry.cacheKey,
    selectedMethodId,
    cached,
    question: resolved.entry.question,
    choices: resolved.entry.choices,
    structure: resolved.entry.structure,
    methods: methodSummaries(resolved),
  };
}

/**
 * maxRetries 0: the SDK would otherwise retry 429s and 5xx on its own, and a
 * retried rate limit only deepens it. Each call's own AbortController (see
 * callModel) enforces the real timeouts; the client timeout is a backstop.
 */
function openAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 150_000, maxRetries: 0 });
}

function pipelineFor(
  cache: SolveCache,
  tier: ServiceTierState,
  diagnosticId: string,
  signal: AbortSignal,
  context: PipelineDeps["context"],
  meter: PipelineDeps["meter"],
  deadline: number,
): PipelineDeps {
  return { client: openAIClient(), cache, context, tier, diagnosticId, signal, meter, deadline };
}

function serverTiming(result: SolveResult, startedAt: number): string {
  const parts = [`methods;dur=${result.timings.methodsMs.toFixed(1)}`, `complete;dur=${result.timings.completeMs.toFixed(1)}`];
  if (result.kind === "solved") {
    parts.push(`cache;desc="${result.hit ?? "miss"}"`, `explanation;desc="${result.explanation}"`);
  }
  parts.push(`calls;desc="${result.calls.candidates}+${result.calls.explanation}"`, `total;dur=${(performance.now() - startedAt).toFixed(1)}`);
  return parts.join(", ");
}

function missingKey() {
  return errorResponse("Add OPENAI_API_KEY to .env.local and restart the development server.", 503);
}

export function createSolveHandler(dependencies: SolveDependencies) {
  // Remembered once OpenAI rejects priority processing for this project, so
  // every later solve skips the failed attempt instead of paying for it again.
  const tier: ServiceTierState = { priorityUnavailable: false };
  return async function POST(request: Request) {
    const startedAt = performance.now();
    const requestStarted = Date.now();
    const diagnosticId = randomUUID();
    const telemetry = telemetryFor(dependencies);
    let currentUserId: string | null = null;
    let meter: Meter | null = null;
    let techniqueId: string | null = null;
    const context = (details: TelemetryContext = {}): TelemetryContext => ({
      userId: currentUserId,
      solveId: diagnosticId,
      cacheKey: meter?.cacheKey() ?? null,
      techniqueId,
      call: meter?.lastCall() ?? null,
      ...details,
    });
    const succeeded = (result: SolveResult, explanation: string | null) => {
      if (result.kind === "solved") techniqueId = result.method.techniqueId;
      // The rows reached the student, but the explanation fell back: report why.
      if (result.kind === "solved" && result.explanationFailure) {
        telemetry.error(result.explanationFailure, context({ stage: "explanation", call: "explanation" }));
      }
      telemetry.event(
        "solve_succeeded",
        context({
          outcome: result.kind,
          cached: result.kind === "solved" ? result.cached : false,
          hit: result.kind === "solved" ? result.hit : null,
          explanation,
          modelCalls: result.calls.candidates + result.calls.explanation,
          costUsd: meter?.costUsd() ?? 0,
          durationMs: Math.round(performance.now() - startedAt),
        }),
      );
    };
    const failed = (error: unknown, stage: string) => {
      telemetry.error(error, context({ stage }));
      telemetry.event("solve_failed", context({ stage, reason: failureKind(error), durationMs: Math.round(performance.now() - startedAt) }));
    };
    try {
      if (crossSite(request)) return errorResponse("Send uploads from the Desmo website.", 403);
      let user: { id: string } | null;
      try {
        user = await dependencies.getCurrentUser();
      } catch {
        return errorResponse("Sign-in is temporarily unavailable. Please try again shortly.", 503);
      }
      if (!user) return errorResponse("Sign in to solve and save your problems.", 401);
      currentUserId = user.id;
      const image = await readUpload(request);
      const bytes = Buffer.from(await image.arrayBuffer());
      if (!matchesImageSignature(bytes, image.type)) {
        telemetry.event("upload_rejected", context({ reason: "signature_mismatch", status: 415, mime: image.type, bytes: bytes.length }));
        return errorResponse("This file is not a valid PNG, JPG, or WebP image. Export the screenshot again.", 415);
      }
      // Fully decode before anything else is spent on it: a damaged or
      // oversized image costs neither a rate-limit slot nor an OpenAI call.
      await validateImage(bytes, image.type);
      if (!process.env.OPENAI_API_KEY?.trim()) return missingKey();
      if (request.signal.aborted) return errorResponse("The solve was canceled.", 408);
      let reservation: { allowed: boolean; retryAfter: number };
      try {
        reservation = await dependencies.reserveSolve(user.id);
      } catch {
        return errorResponse("The solver is temporarily unavailable. Please try again shortly.", 503);
      }
      if (!reservation.allowed) {
        const retryAfter = Math.max(1, reservation.retryAfter);
        return Response.json(
          { kind: "rate_limited", error: `You can solve 3 problems per minute. Try again in ${retryAfter} seconds.`, retryAfter },
          { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } },
        );
      }
      // What OpenAI sees: at most 1600 px on the long edge. History keeps the original.
      const modelImage = await prepareModelImage(bytes, image.type);
      meter = meterFor(dependencies, user.id, diagnosticId);
      telemetry.event("solve_started", context({ mime: image.type, bytes: bytes.length, width: modelImage.width, height: modelImage.height, downscaled: modelImage.resized }));

      const pipeline = pipelineFor(
        dependencies.getCache(),
        tier,
        diagnosticId,
        request.signal,
        await loadSolveContext(),
        meter,
        deadlineFor(dependencies, requestStarted),
      );
      const input = { kind: "image" as const, bytes, mime: image.type, modelBytes: modelImage.bytes };
      const userId = user.id;

      // History keeps the method the student actually sees. The browser runs
      // pre-flight while the explanation is generated, so by the time it is
      // saved, a winner that errored in Desmos has usually been reported: the
      // entry is resolved again and the surviving winner is saved instead.
      // While the Desmos retry is still running, or after it failed, nothing
      // that could error is saved.
      // `explanation` says where the prose came from; "fallback" is the
      // generated one-line summary, which the client treats as a failed
      // explanation (with a retry), never as the explanation itself.
      const finish = async (result: SolveResult) => {
        let solution = result.solution;
        let methodId: string | null = null;
        let explanation: "cache" | "model" | "fallback" | null = null;
        if (result.kind === "solved") {
          methodId = result.method.id;
          explanation = result.explanation;
          const latest = await resolveEntry(pipeline.cache, result.entry);
          if (latest.status !== "ready") return { solution, methodId, explanation, problemId: null };
          if (latest.winner.id !== result.method.id || latest.entry.cacheKey !== result.entry.cacheKey) {
            const explained = await explainMethod(pipeline, latest.entry, latest.winner);
            solution = explained.solution;
            explanation = explained.source;
            methodId = latest.winner.id;
          }
        }
        let problemId: string | null = null;
        let historyWarning: string | undefined;
        try {
          problemId = await dependencies.saveProblem({ userId, bytes, mime: image.type, solution });
        } catch {
          // Keep a usable answer even when storage is temporarily unavailable.
          historyWarning = "Your result is ready, but it could not be saved to history. Keep this page open to view it.";
        }
        return { solution, methodId, explanation, problemId, ...(historyWarning ? { historyWarning } : {}) };
      };

      if (!wantsStream(request)) {
        const result = await solveProblem(pipeline, input);
        const saved = await finish(result);
        succeeded(result, saved.explanation);
        const body =
          result.kind === "solved"
            ? { ...methodsPayload(result.resolved, result.cached, saved.methodId ?? result.method.id), ...saved }
            : { cacheKey: null, selectedMethodId: null, cached: false, methods: [], ...saved };
        return Response.json(body, {
          headers: { "Cache-Control": "no-store", "Server-Timing": serverTiming(result, startedAt) },
        });
      }

      // Streaming: the calculator rows and answer are sent the moment selection
      // finishes; the explanation follows. Failures before the first event
      // still produce an ordinary error response with the right status.
      const encoder = new TextEncoder();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({ start: (value) => void (controller = value) });
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let announce!: () => void;
      const announced = new Promise<"methods">((resolve) => (announce = () => resolve("methods")));
      const run = solveProblem(pipeline, input, (ready: MethodsReady) => {
        send({ type: "methods", ...methodsPayload(ready.resolved, ready.cached) });
        announce();
      });
      const first = await Promise.race([announced, run.then(() => "done" as const, (error: unknown) => ({ error }))]);
      if (typeof first === "object") throw first.error;
      if (first === "done") {
        const result = await run;
        const saved = await finish(result);
        succeeded(result, saved.explanation);
        send({ type: "solution", ...saved });
        controller.close();
      } else {
        void run
          .then(async (result) => {
            const saved = await finish(result);
            succeeded(result, saved.explanation);
            send({ type: "solution", ...saved });
          })
          .catch((error: unknown) => {
            failed(error, "explanation");
            send({ type: "error", error: "The explanation could not be loaded. The calculator steps above are complete." });
          })
          .finally(() => {
            controller.close();
            void telemetry.flush();
          });
      }
      return new Response(stream, { headers: { "Content-Type": NDJSON, "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof UploadError || error instanceof InvalidImageError) {
        telemetry.event("upload_rejected", context({ reason: error.message, status: error.status }));
      } else if (!isExpected(error)) {
        failed(error, meter ? "solve" : "request");
      }
      return errorFor(error, diagnosticId);
    } finally {
      await telemetry.flush();
    }
  };
}

const methodRequestSchema = z.object({ cacheKey: z.string().min(1).max(200), methodId: z.string().min(1).max(80) }).strict();

/**
 * Method switch: the chosen technique's rows come straight from the cache;
 * its explanation is cached too, or generated once (call 2) and then cached.
 */
export function createMethodHandler(dependencies: MethodDependencies) {
  const tier: ServiceTierState = { priorityUnavailable: false };
  return async function POST(request: Request) {
    const requestStarted = Date.now();
    const diagnosticId = randomUUID();
    const telemetry = telemetryFor(dependencies);
    try {
      if (crossSite(request)) return errorResponse("Send requests from the Desmo website.", 403);
      let user: { id: string } | null;
      try {
        user = await dependencies.getCurrentUser();
      } catch {
        return errorResponse("Sign-in is temporarily unavailable. Please try again shortly.", 503);
      }
      if (!user) return errorResponse("Sign in to switch methods.", 401);
      const body = methodRequestSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return errorResponse("Choose a method from this solve.", 400);
      const cache = dependencies.getCache();
      const entry = await cache.getEntry(body.data.cacheKey);
      // A method a browser reported erroring in Desmos is no longer offered.
      const resolved = entry ? await resolveEntry(cache, entry) : null;
      const method =
        resolved?.status === "ready" && resolved.entry.cacheKey === body.data.cacheKey
          ? resolved.methods.find((item) => item.id === body.data.methodId) ?? null
          : null;
      if (resolved?.status !== "ready" || !method) return errorResponse("That method is not available for this problem. Solve it again.", 404);
      if (!process.env.OPENAI_API_KEY?.trim()) return missingKey();
      // Switching methods on a problem already solved is never limited:
      // at most one explanation per method, cached, and still recorded.
      const pipeline = pipelineFor(cache, tier, diagnosticId, request.signal, await loadSolveContext(), meterFor(dependencies, user.id, diagnosticId), deadlineFor(dependencies, requestStarted));
      const payload = methodsPayload(resolved, true, method.id);
      const summary = { ...payload, method: payload.methods.find((item) => item.id === method.id) };
      const switched = (source: string, failure?: unknown) => {
        if (failure) telemetry.error(failure, { userId: user.id, solveId: diagnosticId, cacheKey: resolved.entry.cacheKey, techniqueId: method.techniqueId, call: "explanation", stage: "method_switch" });
        telemetry.event("method_switched", {
          userId: user.id,
          solveId: diagnosticId,
          cacheKey: resolved.entry.cacheKey,
          techniqueId: method.techniqueId,
          explanation: source,
          costUsd: pipeline.meter?.costUsd() ?? 0,
        });
      };
      const switchFailed = (error: unknown) =>
        telemetry.error(error, { userId: user.id, solveId: diagnosticId, cacheKey: resolved.entry.cacheKey, techniqueId: method.techniqueId, call: "explanation" });
      if (!wantsStream(request)) {
        const explained = await explainMethod(pipeline, resolved.entry, method);
        switched(explained.source, explained.failure);
        return Response.json(
          { ...summary, solution: explained.solution, explanation: explained.source },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          send({ type: "methods", ...summary });
          try {
            const explained = await explainMethod(pipeline, resolved.entry, method);
            switched(explained.source, explained.failure);
            send({ type: "solution", solution: explained.solution, explanation: explained.source });
          } catch (error) {
            switchFailed(error);
            send({ type: "error", error: "The explanation could not be loaded. The calculator steps above are complete." });
          }
          await telemetry.flush();
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": NDJSON, "Cache-Control": "no-store" } });
    } catch (error) {
      if (!isExpected(error)) telemetry.error(error, { solveId: diagnosticId, stage: "method_switch" });
      await telemetry.flush();
      return errorFor(error, diagnosticId);
    }
  };
}

const rowErrorsSchema = preflightRecordSchema.options[1].shape.errors;
const preflightRequestSchema = z
  .object({
    cacheKey: z.string().min(1).max(240),
    verdicts: z
      .array(
        z.union([
          z.object({ methodId: z.string().min(1).max(80), status: z.literal("clean") }).strict(),
          z.object({ methodId: z.string().min(1).max(80), status: z.literal("error"), errors: rowErrorsSchema }).strict(),
        ]),
      )
      .max(MAX_CANDIDATES),
  })
  .strict();

/**
 * Pre-flight report: the verdicts a browser's hidden Desmos instance reached
 * for this entry's methods. They are cached per method (first writer wins),
 * so later solves of the problem neither re-check nor offer an erroring
 * method. When every method errored, this runs the one retry of call 1 with
 * the Desmos errors attached and returns its methods ("retry"); when the
 * retry's methods error too, the result is an honest failure ("failed").
 */
export function createPreflightHandler(dependencies: MethodDependencies) {
  const tier: ServiceTierState = { priorityUnavailable: false };
  return async function POST(request: Request) {
    const requestStarted = Date.now();
    const diagnosticId = randomUUID();
    const telemetry = telemetryFor(dependencies);
    try {
      if (crossSite(request)) return errorResponse("Send requests from the Desmo website.", 403);
      let user: { id: string } | null;
      try {
        user = await dependencies.getCurrentUser();
      } catch {
        return errorResponse("Sign-in is temporarily unavailable. Please try again shortly.", 503);
      }
      if (!user) return errorResponse("Sign in to solve and save your problems.", 401);
      const body = preflightRequestSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return errorResponse("Send the Desmos check for a method from this solve.", 400);
      const cache = dependencies.getCache();
      const entry = await cache.getEntry(body.data.cacheKey);
      if (!entry) return errorResponse("This solve is no longer available. Solve it again.", 404);
      const rowCounts = new Map(eligibleMethods(entry).map((method) => [method.id, method.rows.length]));
      await Promise.all(
        body.data.verdicts.map((verdict) => {
          const rows = rowCounts.get(verdict.methodId);
          // A method with no rows cannot error, and a row number past the end is not a real report.
          if (!rows || (verdict.status === "error" && verdict.errors.some((error) => error.row > rows))) return undefined;
          return cache.putPreflight(entry.cacheKey, verdict.methodId, verdict.status === "clean" ? { status: "clean" } : { status: "error", errors: verdict.errors });
        }),
      );
      const current = await resolveEntry(cache, entry);
      if (current.status === "needs-retry" && !process.env.OPENAI_API_KEY?.trim()) return missingKey();
      const resolved =
        current.status === "needs-retry"
          ? await resolveOrRetry(
              pipelineFor(cache, tier, diagnosticId, request.signal, await loadSolveContext(), meterFor(dependencies, user.id, diagnosticId), deadlineFor(dependencies, requestStarted)),
              entry,
            )
          : current;
      if (resolved.status !== "ready") throw new PreflightFailedError();
      return Response.json(
        { status: resolved.entry.cacheKey === entry.cacheKey ? "ready" : "retry", ...methodsPayload(resolved, true) },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (!isExpected(error)) telemetry.error(error, { solveId: diagnosticId, stage: "preflight" });
      await telemetry.flush();
      return errorFor(error, diagnosticId);
    }
  };
}
