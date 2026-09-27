import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { validateModelResponse, modelOutputText, logSolveRejection, SolveValidationError } from "./solve-output";
import { zodTextFormat } from "openai/helpers/zod";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ACCEPTED_IMAGE_TYPES,
  DEFAULT_SOLVE_MODE,
  MAX_IMAGE_BYTES,
  SOLVE_MODES,
  type SolveMode,
} from "@/lib/solver-schema";
import {
  buildUserPrompt,
  STRATEGY_INSTRUCTIONS,
  TRAINING_EXAMPLE_INSTRUCTIONS,
} from "@/lib/solver-instructions";
import {
  selectCompactStrategy,
  compactStrategyPortfolioSchema,
} from "@/lib/strategy-selection";
import {
  loadTrainingExamples,
  TrainingBatchError,
} from "@/lib/training-examples";

import { validateImage, InvalidImageError } from "@/lib/upload-validation";
import type { Solution } from "@/lib/solver-schema";

export type SolveDependencies = {
  getCurrentUser: () => Promise<{ id: string } | null>;
  reserveSolve: (userId: string) => Promise<{ allowed: boolean; retryAfter: number }>;
  saveProblem: (input: { userId: string; bytes: Buffer; mime: string; solution: Solution }) => Promise<string>;
};

// Leave room for multipart headers while bounding uploads, including chunked ones.
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
// Reuse the schema and prompt prefix across questions; the image stays last.
const responseFormat = zodTextFormat(
  compactStrategyPortfolioSchema,
  "sat_math_strategy_selection",
);
const reasoningEfforts = ["minimal", "low", "medium", "high"] as const;
const serviceTiers = ["priority", "default"] as const;

function configuredReasoningEffort() {
  const configured = process.env.OPENAI_REASONING_EFFORT?.trim();
  return reasoningEfforts.find((effort) => effort === configured) ?? "low";
}

/**
 * Priority processing roughly halves solve time at the same reasoning effort
 * (measured 13.5s vs 26.5s mean for gpt-5-mini) for about 1.8× the token
 * price. It is the default; OPENAI_SERVICE_TIER=default opts out.
 */
function configuredServiceTier(priorityUnavailable: boolean): (typeof serviceTiers)[number] {
  const configured = process.env.OPENAI_SERVICE_TIER?.trim();
  const tier = serviceTiers.find((item) => item === configured) ?? "priority";
  return tier === "priority" && priorityUnavailable ? "default" : tier;
}

export type Rejection = { stage: string; reason: string; previous: string };
// One correction retry, shared by all modes and all response-validation layers.
export const MAX_ATTEMPTS = 2;

/** Correct the rejected contract without discarding an otherwise valid plan. */
export function retryPrompt(rejection: Rejection): string {
  return `Your previous response was REJECTED by the server at ${rejection.stage}: ${rejection.reason}\nReturn only one corrected response complying with the supplied JSON schema and validation rules. Preserve correct equations, data, and explanations; fix the specific error. Do not change methods merely to rename or avoid valid rows. For a policy or mathematical error, revise the offending method and its scorecard consistently. Use the correct result type; a graphical or written result does not need a fabricated numeric row.\nPrevious response to correct:\n${rejection.previous}`;
}

function rejectsServiceTier(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIError &&
    error.status === 400 &&
    /service[_ ]tier|priority/i.test(error.message)
  );
}

class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function errorResponse(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

type Upload = { image: File; mode: SolveMode };

async function readUpload(request: Request): Promise<Upload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new UploadError("Upload a screenshot as PNG, JPG, or WebP.", 400);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new UploadError(
      "That screenshot is too large. Use an image under 8 MB.",
      413,
    );
  }
  if (!request.body) {
    throw new UploadError("Choose a screenshot first.", 400);
  }

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
        throw new UploadError(
          "That screenshot is too large. Use an image under 8 MB.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new UploadError(
      "The upload could not be read. Choose the screenshot again.",
      400,
    );
  }

  const images = form.getAll("image");
  const files = Array.from(form.values()).filter((value) => value instanceof File);
  if (files.length !== 1 || images.length !== 1 || !(images[0] instanceof File)) {
    throw new UploadError("Upload one screenshot at a time.", 400);
  }
  const image = images[0];
  const requestedMode = form.get("mode");
  const mode =
    requestedMode === null
      ? DEFAULT_SOLVE_MODE
      : SOLVE_MODES.find((item) => item === requestedMode);
  if (!mode) throw new UploadError("Choose Weaponized Desmos, Desmos First, or Fastest SAT Method.", 400);
  if (image.size === 0) {
    throw new UploadError(
      "That image is empty. Choose another screenshot.",
      400,
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    throw new UploadError(
      "That screenshot is too large. Use an image under 8 MB.",
      413,
    );
  }
  if (!ACCEPTED_IMAGE_TYPES.some((type) => type === image.type)) {
    throw new UploadError("Use a PNG, JPG, or WebP screenshot.", 415);
  }
  return { image, mode };
}

function matchesImageSignature(bytes: Buffer, mime: string) {
  if (mime === "image/png") {
    return (
      bytes.length >= 24 &&
      bytes
        .subarray(0, 8)
        .equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ) &&
      bytes.toString("ascii", 12, 16) === "IHDR"
    );
  }
  if (mime === "image/jpeg") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  return (
    mime === "image/webp" &&
    bytes.length >= 16 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16))
  );
}

export function createSolveHandler(dependencies: SolveDependencies) {
// Remembered once OpenAI rejects priority processing for this project, so
// every later solve skips the failed attempt instead of paying for it again.
let priorityUnavailable = false;
return async function POST(request: Request) {
  const startedAt = performance.now();
  const diagnosticId = randomUUID();
  try {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" ||
        (origin && origin !== new URL(request.url).origin)) {
      return errorResponse("Send uploads from the Desmo website.", 403);
    }
    let user: { id: string } | null;
    try {
      user = await dependencies.getCurrentUser();
    } catch {
      return errorResponse("Sign-in is temporarily unavailable. Please try again shortly.", 503);
    }
    if (!user) return errorResponse("Sign in to solve and save your problems.", 401);
    const { image, mode } = await readUpload(request);
    const bytes = Buffer.from(await image.arrayBuffer());
    if (!matchesImageSignature(bytes, image.type)) {
      return errorResponse(
        "This file is not a valid PNG, JPG, or WebP image. Export the screenshot again.",
        415,
      );
    }
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return errorResponse(
        "Add OPENAI_API_KEY to .env.local and restart the development server.",
        503,
      );
    }

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

    const model = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
    const contextStartedAt = performance.now();
    const [strategyLibrary, trainingExamples] = await Promise.all([
      readFile(
        path.join(process.cwd(), "src/content/desmos-tricks.md"),
        "utf8",
      ),
      loadTrainingExamples(),
    ]);
    const contextDuration = performance.now() - contextStartedAt;
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 150_000,
      maxRetries: 0,
    });
    const aiStartedAt = performance.now();
    // A rejected plan is retried (up to MAX_ATTEMPTS) with the rejection reason
    // appended after the image, so the cached instruction prefix is reused and
    // the model can repair the specific failure without losing valid work.
    const solve = (serviceTier: (typeof serviceTiers)[number], rejection?: Rejection) => client.responses.create(
      {
        model,
        prompt_cache_key: "desmo-strategy-selection-v17",
        ...(serviceTier === "priority" ? { service_tier: "priority" as const } : {}),
        instructions: `${STRATEGY_INSTRUCTIONS}

<strategy_library>
${strategyLibrary}
</strategy_library>

${TRAINING_EXAMPLE_INSTRUCTIONS}

<training_examples>
${trainingExamples.prompt}
</training_examples>`,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildUserPrompt(mode),
              },
              {
                type: "input_image",
                image_url: `data:${image.type};base64,${bytes.toString("base64")}`,
                detail: "high",
              },
              ...(rejection
                ? [{ type: "input_text" as const, text: retryPrompt(rejection) }]
                : []),
            ],
          },
        ],
        text: {
          format: responseFormat,
          ...(model.startsWith("gpt-5")
            ? { verbosity: "low" as const }
            : {}),
        },
        ...(model.startsWith("gpt-5")
          ? { reasoning: { effort: rejection && ["minimal", "low"].includes(configuredReasoningEffort()) ? "medium" : configuredReasoningEffort() } }
          : {}),
        max_output_tokens: 8000,
        store: false,
      },
      { signal: request.signal },
    );
    let serviceTier = configuredServiceTier(priorityUnavailable);
    let result: ReturnType<typeof selectCompactStrategy> | null = null;
    let rejection: Rejection | undefined;
    let attempts = 0;
    while (!result) {
      attempts += 1;
      let response: Awaited<ReturnType<typeof solve>>;
      try {
        response = await solve(serviceTier, rejection);
      } catch (error) {
        if (serviceTier !== "priority" || !rejectsServiceTier(error)) throw error;
        // The project cannot use priority processing; fall back for good.
        priorityUnavailable = true;
        serviceTier = "default";
        response = await solve(serviceTier, rejection);
      }

      const refused = response.output.some(
        (item) =>
          item.type === "message" &&
          item.content.some((content) => content.type === "refusal"),
      );
      if (refused) {
        return errorResponse(
          "The AI could not process that image. Try a clear crop of just the math question.",
          422,
        );
      }
      try {
        result = validateModelResponse(response, mode);
      } catch (error) {
        if (!(error instanceof SolveValidationError)) throw error;
        await logSolveRejection(diagnosticId, mode, attempts, response, error);
        if (attempts >= MAX_ATTEMPTS || request.signal.aborted) throw error;
        rejection = {
          stage: error.stage, reason: error.message, previous: modelOutputText(response),
        };
      }
    }
    const aiDuration = performance.now() - aiStartedAt;
    let problemId: string | null = null;
    let historyWarning: string | undefined;
    try {
      problemId = await dependencies.saveProblem({ userId: user.id, bytes, mime: image.type, solution: result.solution });
    } catch {
      // Keep a usable answer even when storage is temporarily unavailable.
      historyWarning = "Your result is ready, but it could not be saved to history. Keep this page open to view it.";
    }
    return Response.json({ ...result, problemId, ...(historyWarning ? { historyWarning } : {}) }, {
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": [
          `context;dur=${contextDuration.toFixed(1)}`,
          `ai;dur=${aiDuration.toFixed(1)};desc="${serviceTier}${attempts > 1 ? " retry" : ""}"`,
          `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
        ].join(", "),
      },
    });
  } catch (error) {
    if (error instanceof SolveValidationError) {
      return Response.json({
        error: process.env.NODE_ENV === "development"
          ? `Solution validation failed [${error.stage}]: ${error.message}`
          : "The solver could not produce a valid solution after one correction. Please try again.",
        diagnosticId,
        ...(process.env.NODE_ENV === "development" ? {validation:{stage:error.stage,message:error.message,issues:error.issues}} : {}),
      }, {status:502,headers:{"Cache-Control":"no-store"}});
    }
    if (error instanceof UploadError || error instanceof InvalidImageError)
      return errorResponse(error.message, error.status);
    if (error instanceof TrainingBatchError) {
      return errorResponse(
        "The strategy training data is invalid. Check the JSON batches and try again.",
        500,
      );
    }
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return errorResponse(
        "The AI took too long to respond. Please try again.",
        504,
      );
    }
    if (error instanceof OpenAI.APIUserAbortError) {
      return errorResponse(
        "The solve was canceled. Upload the screenshot again to retry.",
        408,
      );
    }
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401 || error.status === 403) {
        return errorResponse(
          "OpenAI rejected the API key or project access. Check OPENAI_API_KEY in .env.local and restart the server.",
          503,
        );
      }
      if (error.status === 429) {
        return error.code === "insufficient_quota"
          ? errorResponse(
              "The OpenAI project has no available API credits. Check its billing and usage limits, then try again.",
              503,
            )
          : errorResponse(
              "OpenAI is receiving too many requests. Wait a moment and try again.",
              429,
            );
      }
      if (error.status === 404 || error.code === "model_not_found") {
        return errorResponse(
          "The configured AI model is unavailable. Check OPENAI_MODEL in .env.local and your project's model access.",
          503,
        );
      }
      if (error.status === 400) {
        if (error.code?.includes("image")) {
          return errorResponse(
            "OpenAI could not read that image. Try a new PNG or JPG screenshot.",
            400,
          );
        }
        return errorResponse(
          "OpenAI could not use the current model settings. Check OPENAI_MODEL supports images and structured outputs.",
          502,
        );
      }
      return errorResponse(
        "Could not reach the AI service. Check your connection and try again.",
        502,
      );
    }
    return errorResponse(
      "The screenshot could not be solved. Please try again.",
      500,
    );
  }
}

}
