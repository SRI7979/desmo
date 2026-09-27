import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, type Solution } from "@/lib/solver-schema";
import { findMethod, type CacheEntry, type SolveCache } from "@/lib/solve-cache";
import { SolveValidationError } from "@/lib/solve-output";
import {
  explainMethod,
  loadSolveContext,
  methodSummaries,
  RefusalError,
  solveProblem,
  type MethodsReady,
  type PipelineDeps,
  type ServiceTierState,
  type SolveResult,
} from "@/lib/solve-pipeline";
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

function methodsPayload(entry: CacheEntry, selectedMethodId: string, cached: boolean) {
  return {
    cacheKey: entry.cacheKey,
    selectedMethodId,
    cached,
    question: entry.question,
    choices: entry.choices,
    structure: entry.structure,
    methods: methodSummaries(entry),
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

      const finish = async (result: SolveResult) => {
        let problemId: string | null = null;
        let historyWarning: string | undefined;
        try {
          problemId = await dependencies.saveProblem({ userId, bytes, mime: image.type, solution: result.solution });
        } catch {
          // Keep a usable answer even when storage is temporarily unavailable.
          historyWarning = "Your result is ready, but it could not be saved to history. Keep this page open to view it.";
        }
        return { problemId, ...(historyWarning ? { historyWarning } : {}) };
      };

      if (!wantsStream(request)) {
        const result = await solveProblem(pipeline, input);
        const saved = await finish(result);
        const body =
          result.kind === "solved"
            ? { solution: result.solution, ...methodsPayload(result.entry, result.method.id, result.cached), ...saved }
            : { solution: result.solution, cacheKey: null, selectedMethodId: null, cached: false, methods: [], ...saved };
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
        send({ type: "methods", ...methodsPayload(ready.entry, ready.method.id, ready.cached) });
        announce();
      });
      const first = await Promise.race([announced, run.then(() => "done" as const, (error: unknown) => ({ error }))]);
      if (typeof first === "object") throw first.error;
      if (first === "done") {
        const result = await run;
        const saved = await finish(result);
        send({ type: "solution", solution: result.solution, ...saved });
        controller.close();
      } else {
        void run
          .then(async (result) => {
            send({ type: "solution", solution: result.solution, ...(await finish(result)) });
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
      const method = entry ? findMethod(entry, body.data.methodId) : null;
      if (!entry || !method) return errorResponse("That method is not available for this problem. Solve it again.", 404);
      if (!process.env.OPENAI_API_KEY?.trim()) return missingKey();
      const pipeline: PipelineDeps = {
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 150_000, maxRetries: 0 }),
        cache,
        context: await loadSolveContext(),
        tier,
        diagnosticId,
        signal: request.signal,
      };
      const summary = { ...methodsPayload(entry, method.id, true), method: methodSummaries(entry).find((item) => item.id === method.id) };
      if (!wantsStream(request)) {
        const explained = await explainMethod(pipeline, entry, method);
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
            const explained = await explainMethod(pipeline, entry, method);
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
