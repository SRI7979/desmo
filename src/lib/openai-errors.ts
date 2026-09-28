import OpenAI from "openai";

/**
 * OpenAI answers HTTP 429 for two unrelated things, and only one of them
 * gets better with time:
 *   rate_limit_exceeded: too many requests or tokens this minute. Waiting helps.
 *   insufficient_quota (and billing stops): out of credit. Waiting never helps.
 * The status alone cannot tell them apart; the error body's code and type can.
 */
export type OpenAIFailure =
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "quota" }
  | { kind: "other" };

const QUOTA_CODES = new Set(["insufficient_quota", "billing_hard_limit_reached", "billing_not_active", "access_terminated"]);
const RATE_LIMIT_TYPES = new Set(["requests", "tokens"]);
const DEFAULT_RETRY_SECONDS = 20;
const MAX_RETRY_SECONDS = 120;

function retryAfterSeconds(headers: Headers | undefined): number {
  const milliseconds = Number(headers?.get("retry-after-ms"));
  if (Number.isFinite(milliseconds) && milliseconds > 0) return Math.min(MAX_RETRY_SECONDS, Math.ceil(milliseconds / 1000));
  const header = headers?.get("retry-after");
  const seconds = header && /^\d+(\.\d+)?$/.test(header.trim()) ? Math.ceil(Number(header)) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(MAX_RETRY_SECONDS, seconds) : DEFAULT_RETRY_SECONDS;
}

export function classifyOpenAIError(error: unknown): OpenAIFailure {
  if (!(error instanceof OpenAI.APIError) || error.status !== 429) return { kind: "other" };
  const body = (error.error ?? {}) as { code?: unknown; type?: unknown; message?: unknown };
  const code = String(error.code ?? body.code ?? "");
  const type = String(error.type ?? body.type ?? "");
  const message = `${error.message} ${typeof body.message === "string" ? body.message : ""}`;
  const rateLimited = (): OpenAIFailure => ({ kind: "rate_limited", retryAfterSeconds: retryAfterSeconds(error.headers as Headers | undefined) });
  // Explicit codes decide first: a rate-limit message can itself mention the
  // billing page ("add a payment method ... /account/billing").
  if (code === "rate_limit_exceeded") return rateLimited();
  if (QUOTA_CODES.has(code) || QUOTA_CODES.has(type)) return { kind: "quota" };
  if (RATE_LIMIT_TYPES.has(type)) return rateLimited();
  // No usable code: OpenAI's own wording ("You have no credits remaining",
  // "You exceeded your current quota", "Rate limit reached for ...").
  if (/no credits remaining|exceeded your current quota|insufficient[_ ]quota|hard limit/i.test(message)) return { kind: "quota" };
  if (/rate limit/i.test(message)) return rateLimited();
  // A 429 that is neither is not known to clear by waiting: no countdown.
  return { kind: "other" };
}

/** The real cause, for server logs only: status, code, type, request id, and OpenAI's message. */
export function describeOpenAIError(error: unknown): string {
  if (!(error instanceof OpenAI.APIError)) return error instanceof Error ? error.message : String(error);
  const body = (error.error ?? {}) as { code?: unknown; type?: unknown };
  return JSON.stringify({
    status: error.status,
    code: error.code ?? body.code ?? null,
    type: error.type ?? body.type ?? null,
    requestId: error.requestID ?? null,
    message: error.message,
  });
}
