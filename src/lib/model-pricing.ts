/**
 * OpenAI list prices in USD per 1M tokens, from
 * https://developers.openai.com/api/docs/pricing (checked 2026-09-27).
 * "priority" is the service tier OpenAI renamed Fast mode on 2026-07-30; its
 * API value is still "priority". Update this table when prices change: every
 * recorded cost and both spend ceilings are computed from it.
 */
export type Rate = { input: number; cachedInput: number; output: number };

export const MODEL_RATES: Record<string, { default: Rate; priority?: Rate }> = {
  "gpt-5-mini": {
    default: { input: 0.25, cachedInput: 0.025, output: 2.0 },
    priority: { input: 0.45, cachedInput: 0.045, output: 3.6 },
  },
  "gpt-5": {
    default: { input: 1.25, cachedInput: 0.125, output: 10.0 },
    priority: { input: 2.5, cachedInput: 0.25, output: 20.0 },
  },
  "gpt-5-nano": {
    default: { input: 0.05, cachedInput: 0.005, output: 0.4 },
  },
};

/**
 * A model missing from the table is billed at the most expensive rate we
 * know, so an unpriced model can only make the ceilings trip early, never late.
 */
const UNKNOWN_MODEL_RATE: Rate = { input: 2.5, cachedInput: 0.25, output: 20.0 };

/** Token counts from a Responses API `usage` object. Reasoning tokens are part of output. */
export type Usage = {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export const NO_USAGE: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function usageFrom(raw: unknown): Usage {
  const usage = (raw ?? {}) as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
    output_tokens_details?: { reasoning_tokens?: unknown };
  };
  const inputTokens = count(usage.input_tokens);
  const outputTokens = count(usage.output_tokens);
  return {
    inputTokens,
    cachedTokens: Math.min(inputTokens, count(usage.input_tokens_details?.cached_tokens)),
    outputTokens,
    reasoningTokens: Math.min(outputTokens, count(usage.output_tokens_details?.reasoning_tokens)),
    totalTokens: count(usage.total_tokens) || inputTokens + outputTokens,
  };
}

/**
 * The rate for a model and the tier OpenAI reports it actually used. Dated
 * snapshots ("gpt-5-mini-2025-08-07") use their base model's price; the
 * longest matching base wins, so gpt-5-mini is never priced as gpt-5.
 */
export function rateFor(model: string, serviceTier: string | null | undefined): { rate: Rate; known: boolean } {
  const base = Object.keys(MODEL_RATES)
    .filter((name) => model === name || model.startsWith(`${name}-`))
    .sort((left, right) => right.length - left.length)[0];
  if (!base) return { rate: UNKNOWN_MODEL_RATE, known: false };
  const rates = MODEL_RATES[base];
  return { rate: serviceTier === "priority" && rates.priority ? rates.priority : rates.default, known: true };
}

/** USD for one call: uncached input, cached input, and output (reasoning included) at their own rates. */
export function costUsd(usage: Usage, rate: Rate): number {
  const uncached = usage.inputTokens - usage.cachedTokens;
  const dollars = (uncached * rate.input + usage.cachedTokens * rate.cachedInput + usage.outputTokens * rate.output) / 1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

/**
 * A call that timed out may still have run to completion and been billed,
 * but its usage never arrives. It is recorded at this deliberately high
 * estimate (a typical prompt plus the request's full output allowance), so
 * a timeout can only make the spend ceiling trip early.
 */
export function timeoutEstimate(call: "candidates" | "explanation" | "desmos_retry" | "tutor", maxOutputTokens: number): Usage {
  const inputTokens = call === "explanation" ? 1_500 : call === "tutor" ? 2_500 : 32_000;
  return { inputTokens, cachedTokens: 0, outputTokens: maxOutputTokens, reasoningTokens: 0, totalTokens: inputTokens + maxOutputTokens };
}
