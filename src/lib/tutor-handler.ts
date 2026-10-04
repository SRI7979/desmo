import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { classifyOpenAIError } from "@/lib/openai-errors";
import type { SolveCache } from "@/lib/solve-cache";
import { ModelTimeoutError, RefusalError, type ServiceTierState } from "@/lib/solve-pipeline";
import type { Solution } from "@/lib/solver-schema";
import { createMeter, limitsFromEnv, SpendCeilingError, TutorCapError, UsageUnavailableError, type Limits, type Meter, type UsageStore } from "@/lib/spend";
import { consoleSink, createTelemetry, type Telemetry } from "@/lib/telemetry";
import {
  callTutorModel,
  contextFromSolution,
  contextFromSolve,
  parseTutorResponse,
  savedTrickFrom,
  tutorInput,
  tutorRequest,
  tutorQuestionsPerDay,
  tutorRequestSchema,
  tutorSelectionSchema,
  tutorSourceSchema,
  TutorOutputError,
  verifySelection,
  type SavedTrick,
  type SavedTrickInput,
  type TutorContext,
  type TutorSource,
} from "@/lib/tutor";

type CurrentUser = () => Promise<{ id: string } | null>;
/** The signed-in student's own saved problem, read through their session (RLS); null when it is not theirs. */
type GetProblem = (userId: string, problemId: string) => Promise<{ solution: Solution } | null>;

export type TutorDependencies = {
  getCurrentUser: CurrentUser;
  getCache: () => SolveCache;
  getProblem: GetProblem;
  /** Where the tutor call's usage and cost is recorded, and the spend ceiling is checked. */
  getUsage: () => UsageStore;
  limits?: () => Limits;
  /** Tutor answers per account per rolling 24 hours (TUTOR_QUESTIONS_PER_DAY by default). */
  tutorLimit?: () => number;
  /** The route's maxDuration: the model call must finish inside it. */
  maxDurationSeconds: number;
  telemetry?: Telemetry;
};

const consoleTelemetry = createTelemetry([consoleSink()]);
const DEADLINE_MARGIN_MS = 3_000;

function errorResponse(message: string, status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return Response.json({ error: message, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function unavailable() {
  return errorResponse("The tutor is temporarily unavailable. Please try again later.", 503, { kind: "unavailable" });
}

function crossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") === "cross-site" || Boolean(origin && origin !== new URL(request.url).origin);
}

async function signedIn(getCurrentUser: CurrentUser): Promise<{ user: { id: string } | null; failure: Response | null }> {
  try {
    const user = await getCurrentUser();
    return { user, failure: user ? null : errorResponse("Sign in to use the tutor.", 401) };
  } catch {
    return { user: null, failure: errorResponse("Sign-in is temporarily unavailable. Please try again shortly.", 503) };
  }
}

/** Resolves a source to the server's own context; a load failure is a 503, a missing problem or method a 404. */
async function resolveContext(
  source: TutorSource,
  userId: string,
  dependencies: Pick<TutorDependencies, "getCache" | "getProblem">,
): Promise<{ context: TutorContext | null; failure: Response | null }> {
  try {
    if (source.kind === "solve") {
      const context = await contextFromSolve(dependencies.getCache(), source.cacheKey, source.methodId);
      return { context, failure: context ? null : errorResponse("That method is not available for this problem. Solve it again.", 404) };
    }
    const problem = await dependencies.getProblem(userId, source.problemId);
    const context = problem ? contextFromSolution(problem.solution, source.problemId) : null;
    return { context, failure: context ? null : errorResponse("That saved problem was not found.", 404) };
  } catch {
    return { context: null, failure: errorResponse("This solution could not be loaded. Please try again shortly.", 503) };
  }
}

/** Worded like the solver's daily-cap message. */
function describeReset(resetsAt: string | null): string {
  const remaining = resetsAt ? Date.parse(resetsAt) - Date.now() : NaN;
  if (!Number.isFinite(remaining) || remaining <= 0) return "shortly";
  const hours = Math.ceil(remaining / 3_600_000);
  return hours <= 1 ? "within the hour" : `in about ${hours} hours`;
}

/** Mapped like the solver's errors, in the tutor's own words. */
function tutorErrorFor(error: unknown): Response {
  if (error instanceof TutorCapError) {
    return errorResponse(
      `You've asked the tutor ${error.limit} questions today. It opens again ${describeReset(error.resetsAt)}. Your solutions and solves are not affected.`,
      429,
      { kind: "tutor_cap", resetsAt: error.resetsAt },
    );
  }
  if (error instanceof SpendCeilingError) {
    return errorResponse("Desmo is at capacity today. The tutor opens again after midnight UTC. Your solutions stay available.", 503, { kind: "at_capacity" });
  }
  if (error instanceof UsageUnavailableError) {
    console.error("[desmo:ALERT] usage limits unavailable; refusing tutor model work", error.cause instanceof Error ? error.cause.message : error.cause);
    return unavailable();
  }
  if (error instanceof ModelTimeoutError || error instanceof OpenAI.APIConnectionTimeoutError) {
    return errorResponse("The tutor took too long to answer. Please try again.", 504, { kind: "timeout" });
  }
  if (error instanceof OpenAI.APIUserAbortError) return errorResponse("The question was canceled.", 408);
  if (error instanceof RefusalError) return errorResponse("The tutor could not answer that. Try selecting a different part of the solution.", 422);
  if (error instanceof TutorOutputError) return errorResponse("The tutor's answer could not be shown. Please try again.", 502);
  if (error instanceof OpenAI.APIError) {
    const failure = classifyOpenAIError(error);
    if (failure.kind === "rate_limited") {
      const seconds = failure.retryAfterSeconds;
      return errorResponse(`The AI service is busy right now. Try again in ${seconds} seconds.`, 429, { kind: "rate_limited", retryAfter: seconds }, { "Retry-After": String(seconds) });
    }
    if (failure.kind === "quota") return unavailable();
    const development = process.env.NODE_ENV === "development";
    if (error.status === 401 || error.status === 403) {
      return development ? errorResponse("OpenAI rejected the API key or project access. Check OPENAI_API_KEY in .env.local and restart the server.", 503) : unavailable();
    }
    if (error.status === 404 || error.code === "model_not_found") {
      return development ? errorResponse("The configured AI model is unavailable. Check OPENAI_MODEL in .env.local and your project's model access.", 503) : unavailable();
    }
    return errorResponse("Could not reach the AI service. Please try again.", 502);
  }
  return errorResponse("The tutor could not answer. Please try again.", 500);
}

function failureKind(error: unknown): string {
  if (error instanceof ModelTimeoutError) return "timeout_tutor";
  if (error instanceof TutorOutputError) return "tutor_output";
  if (error instanceof RefusalError) return "refusal";
  if (error instanceof OpenAI.APIError) return `openai_${classifyOpenAIError(error).kind}_${error.status ?? "none"}`;
  return error instanceof Error ? error.name : "unknown";
}

/**
 * POST /api/tutor: { source, selection, practice } → { title, meaning,
 * whyHere, example, practice }. The model sees only the server-resolved
 * context and the verified selection. The call is metered as "tutor" and
 * checked against the global spend ceiling and the student's own tutor
 * allowance (TUTOR_QUESTIONS_PER_DAY), never the daily solve cap.
 */
export function createTutorHandler(dependencies: TutorDependencies) {
  const tier: ServiceTierState = { priorityUnavailable: false };
  return async function POST(request: Request) {
    const startedAt = Date.now();
    const diagnosticId = randomUUID();
    const telemetry = dependencies.telemetry ?? consoleTelemetry;
    let meter: Meter | null = null;
    let userId: string | null = null;
    let techniqueId: string | null = null;
    try {
      if (crossSite(request)) return errorResponse("Send requests from the Desmo website.", 403);
      const auth = await signedIn(dependencies.getCurrentUser);
      if (!auth.user) return auth.failure!;
      userId = auth.user.id;
      const body = tutorRequestSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return errorResponse("Choose a line or highlight part of this solution to ask about.", 400);
      const { source, selection, practice } = body.data;
      const resolved = await resolveContext(source, auth.user.id, dependencies);
      if (!resolved.context) return resolved.failure!;
      const context = resolved.context;
      techniqueId = context.techniqueId;
      const verified = verifySelection(context, selection);
      if (!verified) {
        return errorResponse(
          selection.kind === "row" ? "That line is not part of this solution." : "Highlight text from one part of this solution (the question, the answer, a line, or its explanation).",
          400,
        );
      }
      if (!process.env.OPENAI_API_KEY?.trim()) return errorResponse("Add OPENAI_API_KEY to .env.local and restart the development server.", 503);
      meter = createMeter({
        store: dependencies.getUsage(),
        userId: auth.user.id,
        solveId: diagnosticId,
        limits: (dependencies.limits ?? limitsFromEnv)(),
        onRecordError: (error) => telemetry.error(error, { userId, solveId: diagnosticId, stage: "usage_record", call: "tutor" }),
        onCeiling: (error) => telemetry.event("ceiling_hit", { userId, solveId: diagnosticId, call: "tutor", spentUsd: error.spentUsd, ceilingUsd: error.ceilingUsd }),
      });
      if (context.cacheKey) meter.setCacheKey(context.cacheKey);
      // Extra model work on a problem the student already has: the global
      // spend ceiling and the student's own tutor allowance apply, the daily
      // solve cap does not.
      await meter.authorizeTutor((dependencies.tutorLimit ?? tutorQuestionsPerDay)());
      const response = await callTutorModel(
        {
          client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 0 }),
          tier,
          diagnosticId,
          meter,
          signal: request.signal,
          deadline: startedAt + dependencies.maxDurationSeconds * 1000 - DEADLINE_MARGIN_MS,
        },
        tutorRequest(tutorInput(context, verified, practice), practice),
      );
      const answer = parseTutorResponse(response, practice);
      // Ids and counts only: never the question, the selection, or the answer.
      telemetry.event("tutor_explained", {
        userId,
        solveId: diagnosticId,
        cacheKey: context.cacheKey,
        techniqueId,
        call: "tutor",
        source: source.kind,
        selection: selection.kind,
        practice,
        practiceReturned: answer.practice !== null,
        exampleRows: answer.example?.rows.length ?? 0,
        costUsd: meter.costUsd(),
        durationMs: Date.now() - startedAt,
      });
      return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof TutorCapError) {
        telemetry.event("cap_hit", { userId, solveId: diagnosticId, call: "tutor", limit: error.limit, resetsAt: error.resetsAt });
      } else if (!(error instanceof SpendCeilingError)) {
        telemetry.error(error, { userId, solveId: diagnosticId, cacheKey: meter?.cacheKey() ?? null, techniqueId, call: "tutor", stage: "tutor", reason: failureKind(error) });
      }
      return tutorErrorFor(error);
    } finally {
      await telemetry.flush();
    }
  };
}

export type TricksDependencies = {
  getCurrentUser: CurrentUser;
  getCache: () => SolveCache;
  getProblem: GetProblem;
  saveTrick: (userId: string, trick: SavedTrickInput) => Promise<SavedTrick>;
  listTricks: (userId: string) => Promise<SavedTrick[]>;
  removeTrick: (userId: string, id: string) => Promise<boolean>;
};

const saveRequestSchema = z.object({ source: tutorSourceSchema, selection: tutorSelectionSchema.optional() }).strict();
const removeRequestSchema = z.object({ id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) }).strict();

/**
 * /api/tricks: POST saves the technique of a solve or saved problem (the
 * server resolves the technique, structure, question, and rows itself), GET
 * lists the student's saved tricks, DELETE { id } removes one. Every read and
 * write goes through the student's own session, so ownership is enforced by
 * row-level security as well as by the explicit user filter.
 */
export function createTricksHandler(dependencies: TricksDependencies) {
  const noStore = { headers: { "Cache-Control": "no-store" } };
  return {
    async GET() {
      const auth = await signedIn(dependencies.getCurrentUser);
      if (!auth.user) return auth.failure!;
      try {
        return Response.json({ tricks: await dependencies.listTricks(auth.user.id) }, noStore);
      } catch {
        return errorResponse("Your saved tricks could not be loaded. Please try again.", 503);
      }
    },
    async POST(request: Request) {
      if (crossSite(request)) return errorResponse("Send requests from the Desmo website.", 403);
      const auth = await signedIn(dependencies.getCurrentUser);
      if (!auth.user) return auth.failure!;
      const body = saveRequestSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return errorResponse("Choose a solved problem to save its trick.", 400);
      const resolved = await resolveContext(body.data.source, auth.user.id, dependencies);
      if (!resolved.context) return resolved.failure!;
      const selection = body.data.selection ? verifySelection(resolved.context, body.data.selection) : null;
      if (body.data.selection && !selection) return errorResponse("Highlight text from this solution to save it with the trick.", 400);
      try {
        const trick = await dependencies.saveTrick(auth.user.id, savedTrickFrom(resolved.context, selection));
        return Response.json({ trick }, noStore);
      } catch {
        return errorResponse("This trick could not be saved. Please try again.", 503);
      }
    },
    async DELETE(request: Request) {
      if (crossSite(request)) return errorResponse("Send requests from the Desmo website.", 403);
      const auth = await signedIn(dependencies.getCurrentUser);
      if (!auth.user) return auth.failure!;
      const body = removeRequestSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return errorResponse("Choose a saved trick to remove.", 400);
      try {
        const removed = await dependencies.removeTrick(auth.user.id, body.data.id);
        return removed ? Response.json({ removed: true }, noStore) : errorResponse("That saved trick was not found.", 404);
      } catch {
        return errorResponse("This trick could not be removed. Please try again.", 503);
      }
    },
  };
}
