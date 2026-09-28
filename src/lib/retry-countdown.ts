/**
 * Seconds the solve button should count down before the student may try
 * again, or null when waiting would not help. Only a response the server
 * marked `kind: "rate_limited"` (Desmo's per-minute limit, or OpenAI's) earns
 * a countdown. A daily cap, a full day's capacity, an exhausted OpenAI
 * credit, or any other failure never does, even when its status is 429.
 */
export function retryCountdown(status: number, body: unknown, retryAfterHeader: string | null, now = Date.now()): number | null {
  if (status !== 429 || (body as { kind?: unknown } | null)?.kind !== "rate_limited") return null;
  const header = retryAfterHeader?.trim();
  const fromHeader = header
    ? /^\d+$/.test(header)
      ? Number(header)
      : Math.ceil((Date.parse(header) - now) / 1000)
    : NaN;
  const fromBody = Number((body as { retryAfter?: unknown }).retryAfter);
  const seconds = Number.isFinite(fromHeader) ? fromHeader : Number.isFinite(fromBody) ? fromBody : 20;
  return Math.min(3_600, Math.max(1, Math.ceil(seconds)));
}
