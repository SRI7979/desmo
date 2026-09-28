import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, type Solution } from "@/lib/solver-schema";
import { eligibleMethods, preflightRecordSchema, type SolveCache } from "@/lib/solve-cache";
import { SolveValidationError } from "@/lib/solve-output";
import {
  explainMethod,
  HONEST_FAILURE,
  loadSolveContext,
  methodSummaries,
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
import { MAX_CANDIDATES } from "@/lib/strategy-selection";
import { TrainingBatchError } from "@/lib/training-examples";
import { validateImage, InvalidImageError } from "@/lib/upload-validation";

export type SolveDependencies = {
  getCurrentUser: () => Promise<{ id: string } | null>;
  reserveSolve: (userId: string) => Promise<{ allowed: boolean; retryAfter: number }>;
  saveProblem: (input: { userId: string; bytes: Buffer; mime: string; solution: Solution }) => Promise<string>;
  getCache: () => SolveCache;
};

export type MethodDependencies = Pick<SolveDependencies, "getCurrentUser" | "getCache">;

// Leave room for multipart headers while bounding uploads, including chunked ones.
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
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

function crossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") === "cross-site" || Boolean(origin && origin !== new URL(request.url).origin);
}

/** Clients that can render the calculator before the explanation opt in with Accept. */
function wantsStream(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes(NDJSON);
}

async function readUpload(request: Request): Promise<File> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new UploadError("Upload a screenshot as PNG, JPG, or WebP.", 400);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new UploadError("That screenshot is too large. Use an image under 8 MB.", 413);
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
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new UploadError("That screenshot is too large. Use an image under 8 MB.", 413);
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
  if (image.size > MAX_IMAGE_BYTES) {
    throw new UploadError("That screenshot is too large. Use an image under 8 MB.", 413);
  }
  if (!ACCEPTED_IMAGE_TYPES.some((type) => type === image.type)) {
    throw new UploadError("Use a PNG, JPG, or WebP screenshot.", 415);
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
  if (error instanceof PreflightFailedError) {
    return Response.json({ status: "failed", error: HONEST_FAILURE }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof RefusalError) {
    return errorResponse("The AI could not process that image. Try a clear crop of just the math question.", 422);
  }
  if (error instanceof TrainingBatchError) {
    return errorResponse("The strategy training data is invalid. Check the JSON batches and try again.", 500);
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) return errorResponse("The AI took too long to respond. Please try again.", 504);
  if (error instanceof OpenAI.APIUserAbortError) {
    return errorResponse("The solve was canceled. Upload the screenshot again to retry.", 408);
  }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) {
      return errorResponse("OpenAI rejected the API key or project access. Check OPENAI_API_KEY in .env.local and restart the server.", 503);
    }
    if (error.status === 429) {
      return error.code === "insufficient_quota"
        ? errorResponse("The OpenAI project has no available API credits. Check its billing and usage limits, then try again.", 503)
        : errorResponse("OpenAI is receiving too many requests. Wait a moment and try again.", 429);
    }
    if (error.status === 404 || error.code === "model_not_found") {
      return errorResponse("The configured AI model is unavailable. Check OPENAI_MODEL in .env.local and your project's model access.", 503);
    }
    if (error.status === 400) {
      if (error.code?.includes("image")) return errorResponse("OpenAI could not read that image. Try a new PNG or JPG screenshot.", 400);
      return errorResponse("OpenAI could not use the current model settings. Check OPENAI_MODEL supports images and structured outputs.", 502);
    }
    return errorResponse("Could not reach the AI service. Check your connection and try again.", 502);
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

function pipelineFor(cache: SolveCache, tier: ServiceTierState, diagnosticId: string, signal: AbortSignal, context: PipelineDeps["context"]): PipelineDeps {
  return {
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 150_000, maxRetries: 0 }),
    cache,
    context,
    tier,
    diagnosticId,
    signal,
  };
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
    const diagnosticId = randomUUID();
    try {
      if (crossSite(request)) return errorResponse("Send uploads from the Desmo website.", 403);
      let user: { id: string } | null;
      try {
        user = await dependencies.getCurrentUser();
      } catch {
        return errorResponse("Sign-in is temporarily unavailable. Please try again shortly.", 503);
      }
      if (!user) return errorResponse("Sign in to solve and save your problems.", 401);
      const image = await readUpload(request);
      const bytes = Buffer.from(await image.arrayBuffer());
      if (!matchesImageSignature(bytes, image.type)) {
        return errorResponse("This file is not a valid PNG, JPG, or WebP image. Export the screenshot again.", 415);
      }
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
          { error: `You can solve 3 problems per minute. Try again in ${retryAfter} seconds.`, retryAfter },
          { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } },
        );
      }
      await validateImage(bytes, image.type);

      const pipeline: PipelineDeps = {
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 150_000, maxRetries: 0 }),
        cache: dependencies.getCache(),
        context: await loadSolveContext(),
        tier,
        diagnosticId,
        signal: request.signal,
      };
      const input = { kind: "image" as const, bytes, mime: image.type };
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
        send({ type: "solution", ...(await finish(result)) });
        controller.close();
      } else {
        void run
          .then(async (result) => {
            send({ type: "solution", ...(await finish(result)) });
          })
          .catch(() => send({ type: "error", error: "The explanation could not be loaded. The calculator steps above are complete." }))
          .finally(() => controller.close());
      }
      return new Response(stream, { headers: { "Content-Type": NDJSON, "Cache-Control": "no-store" } });
    } catch (error) {
      return errorFor(error, diagnosticId);
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
    const diagnosticId = randomUUID();
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
      const pipeline = pipelineFor(cache, tier, diagnosticId, request.signal, await loadSolveContext());
      const payload = methodsPayload(resolved, true, method.id);
      const summary = { ...payload, method: payload.methods.find((item) => item.id === method.id) };
      if (!wantsStream(request)) {
        const explained = await explainMethod(pipeline, resolved.entry, method);
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
            send({ type: "solution", solution: explained.solution, explanation: explained.source });
          } catch {
            send({ type: "error", error: "The explanation could not be loaded. The calculator steps above are complete." });
          }
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": NDJSON, "Cache-Control": "no-store" } });
    } catch (error) {
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
    const diagnosticId = randomUUID();
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
          ? await resolveOrRetry(pipelineFor(cache, tier, diagnosticId, request.signal, await loadSolveContext()), entry)
          : current;
      if (resolved.status !== "ready") throw new PreflightFailedError();
      return Response.json(
        { status: resolved.entry.cacheKey === entry.cacheKey ? "ready" : "retry", ...methodsPayload(resolved, true) },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return errorFor(error, diagnosticId);
    }
  };
}
