import { costUsd, rateFor, usageFrom, type Usage } from "./model-pricing";

/**
 * Spend protection, in three independent layers:
 *   1. every OpenAI call's actual usage is recorded with its model, tier, and
 *      USD cost (the input to the other two, and the record of what Desmo costs);
 *   2. each user gets FREE_SOLVES_PER_DAY new solves per rolling 24 hours
 *      (and, separately, TUTOR_QUESTIONS_PER_DAY tutor answers);
 *   3. all users together stop at DAILY_SPEND_CEILING_USD per UTC day.
 * Layers 2 and 3 gate only NEW model work on a new problem. A cached solve,
 * history, and switching methods on a problem already solved keep working,
 * so reaching a limit never locks a student out of work they already have.
 */

/** "tutor": an answer about a verified selection in a solution the student already has. */
export type ModelCall = "candidates" | "explanation" | "desmos_retry" | "tutor";

export type UsageRecord = {
  solveId: string;
  userId: string | null;
  cacheKey: string | null;
  call: ModelCall;
  model: string;
  serviceTier: string | null;
  status: "completed" | "timeout" | "failed";
  usage: Usage;
  costUsd: number;
  /** The usage is an estimate (a timed-out call's never arrives), or the model is unpriced. */
  estimated: boolean;
};

export type DailyReservation = { allowed: boolean; used: number; resetsAt: string | null };

export interface UsageStore {
  record(record: UsageRecord): Promise<void>;
  /** Counts one new solve for the user unless they are at `limit` within the last 24 hours. */
  reserveDailySolve(userId: string, limit: number): Promise<DailyReservation>;
  /** Counts one tutor question for the user unless they are at `limit` within the last 24 hours (separate from solves). */
  reserveDailyTutor(userId: string, limit: number): Promise<DailyReservation>;
  /** Recorded cost across all users since midnight UTC. */
  spentTodayUsd(): Promise<number>;
}

export type Limits = { freeSolvesPerDay: number; dailySpendCeilingUsd: number };

function envNumber(value: string | undefined, fallback: number, integer: boolean): number {
  const parsed = Number(value?.trim());
  if (!value?.trim() || !Number.isFinite(parsed) || parsed < 0) return fallback;
  return integer ? Math.floor(parsed) : parsed;
}

/**
 * Read on every request, never cached at module load, so a changed value
 * applies to the next solve wherever the host updates env without a restart.
 */
export function limitsFromEnv(env: Record<string, string | undefined> = process.env): Limits {
  return {
    freeSolvesPerDay: envNumber(env.FREE_SOLVES_PER_DAY, 15, true),
    dailySpendCeilingUsd: envNumber(env.DAILY_SPEND_CEILING_USD, 5, false),
  };
}

export class DailyCapError extends Error {
  constructor(readonly limit: number, readonly resetsAt: string | null) {
    super(`Daily solve limit of ${limit} reached.`);
    this.name = "DailyCapError";
  }
}

/** The student's own tutor allowance for the rolling 24 hours is used up; their solves are untouched. */
export class TutorCapError extends Error {
  constructor(readonly limit: number, readonly resetsAt: string | null) {
    super(`Daily tutor limit of ${limit} reached.`);
    this.name = "TutorCapError";
  }
}

export class SpendCeilingError extends Error {
  constructor(readonly spentUsd: number, readonly ceilingUsd: number) {
    super(`Daily spend ceiling reached: $${spentUsd.toFixed(4)} of $${ceilingUsd.toFixed(2)}.`);
    this.name = "SpendCeilingError";
  }
}

/** The usage store could not answer; new model work is refused rather than left unmetered. */
export class UsageUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super("Usage limits could not be checked.");
    this.name = "UsageUnavailableError";
  }
}

export type CallOutcome =
  | { status: "completed"; model: string; serviceTier: string | null; usage: unknown }
  | { status: "timeout" | "failed"; model: string; serviceTier: string | null; usage: Usage; estimated: boolean };

/** What one request's model calls are checked against and recorded under. */
export type Meter = {
  /** Before the first model call of a NEW problem: the global ceiling, then the user's daily slot. */
  authorizeSolve(): Promise<void>;
  /** Before extra model work on an existing problem (the Desmos retry): the global ceiling only. */
  authorizeRetry(): Promise<void>;
  /**
   * Before a tutor answer: the global ceiling, then the user's own tutor
   * allowance (never their daily solves), so no single account can spend
   * the ceiling everyone shares.
   */
  authorizeTutor(limit: number): Promise<void>;
  record(call: ModelCall, outcome: CallOutcome): Promise<UsageRecord>;
  setCacheKey(cacheKey: string): void;
  /** Which call is in flight or last ran, for error reports. */
  lastCall(): ModelCall | null;
  /** The problem this request's calls were recorded under, once known. */
  cacheKey(): string | null;
  /** What this request's calls cost, as recorded. */
  costUsd(): number;
};

export function createMeter(options: {
  store: UsageStore;
  userId: string | null;
  solveId: string;
  limits: Limits;
  onRecordError?: (error: unknown) => void;
  onCeiling?: (error: SpendCeilingError) => void;
  onCap?: (error: DailyCapError) => void;
}): Meter {
  let cacheKey: string | null = null;
  let last: ModelCall | null = null;
  let spent = 0;
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw new UsageUnavailableError(error);
    }
  };
  async function checkCeiling() {
    const spent = await guard(() => options.store.spentTodayUsd());
    if (spent >= options.limits.dailySpendCeilingUsd) {
      const error = new SpendCeilingError(spent, options.limits.dailySpendCeilingUsd);
      options.onCeiling?.(error);
      throw error;
    }
  }
  return {
    async authorizeSolve() {
      await checkCeiling();
      if (!options.userId) return;
      const reservation = await guard(() => options.store.reserveDailySolve(options.userId!, options.limits.freeSolvesPerDay));
      if (!reservation.allowed) {
        const error = new DailyCapError(options.limits.freeSolvesPerDay, reservation.resetsAt);
        options.onCap?.(error);
        throw error;
      }
    },
    authorizeRetry: checkCeiling,
    async authorizeTutor(limit) {
      await checkCeiling();
      if (!options.userId) throw new TutorCapError(limit, null);
      const reservation = await guard(() => options.store.reserveDailyTutor(options.userId!, limit));
      if (!reservation.allowed) throw new TutorCapError(limit, reservation.resetsAt);
    },
    async record(call, outcome) {
      last = call;
      const usage = outcome.status === "completed" ? usageFrom(outcome.usage) : outcome.usage;
      const { rate, known } = rateFor(outcome.model, outcome.serviceTier);
      const record: UsageRecord = {
        solveId: options.solveId,
        userId: options.userId,
        cacheKey,
        call,
        model: outcome.model,
        serviceTier: outcome.serviceTier,
        status: outcome.status,
        usage,
        costUsd: costUsd(usage, rate),
        estimated: !known || (outcome.status !== "completed" && outcome.estimated),
      };
      spent += record.costUsd;
      try {
        await options.store.record(record);
      } catch (error) {
        // A lost usage row must not fail a solve the student already paid
        // the latency for; it is reported so the gap is visible.
        options.onRecordError?.(error);
      }
      return record;
    },
    setCacheKey(key) {
      cacheKey = key;
    },
    lastCall: () => last,
    cacheKey: () => cacheKey,
    costUsd: () => Math.round(spent * 1_000_000) / 1_000_000,
  };
}


/** Process-local store for tests and scripts. */
export function createMemoryUsageStore(now: () => number = Date.now): UsageStore & {
  records: UsageRecord[];
  solves: { userId: string; at: number }[];
  tutorQuestions: { userId: string; at: number }[];
} {
  const records: UsageRecord[] = [];
  const solves: { userId: string; at: number }[] = [];
  const tutorQuestions: { userId: string; at: number }[] = [];
  const day = 24 * 60 * 60 * 1000;
  const recordedAt = new WeakMap<UsageRecord, number>();
  const reserve = (log: { userId: string; at: number }[], userId: string, limit: number): DailyReservation => {
    const windowStart = now() - day;
    const inWindow = log.filter((item) => item.userId === userId && item.at > windowStart).sort((a, b) => a.at - b.at);
    const oldest = inWindow[0]?.at ?? now();
    if (inWindow.length < limit) {
      log.push({ userId, at: now() });
      return { allowed: true, used: inWindow.length + 1, resetsAt: new Date(oldest + day).toISOString() };
    }
    return { allowed: false, used: inWindow.length, resetsAt: new Date(oldest + day).toISOString() };
  };
  return {
    records,
    solves,
    tutorQuestions,
    async record(record) {
      records.push(record);
      recordedAt.set(record, now());
    },
    async reserveDailySolve(userId, limit) {
      return reserve(solves, userId, limit);
    },
    async reserveDailyTutor(userId, limit) {
      return reserve(tutorQuestions, userId, limit);
    },
    async spentTodayUsd() {
      const midnight = new Date(now());
      midnight.setUTCHours(0, 0, 0, 0);
      return records.filter((record) => (recordedAt.get(record) ?? 0) >= midnight.getTime()).reduce((sum, record) => sum + record.costUsd, 0);
    },
  };
}

type SupabaseLike = {
  from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

/** Backed by the model_usage and daily_solves tables (service role only); see the usage migration. */
export function createSupabaseUsageStore(client: unknown): UsageStore {
  const db = client as SupabaseLike;
  const cause = (error: unknown) => {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
    return [code, message].filter((part) => typeof part === "string" && part).join(" ");
  };
  async function reservation(fn: string, label: string, userId: string, limit: number): Promise<DailyReservation> {
    const { data, error } = await db.rpc(fn, { p_user_id: userId, p_limit: limit });
    const row = Array.isArray(data) ? (data[0] as { allowed?: unknown; used?: unknown; resets_at?: unknown }) : null;
    if (error || !row || typeof row.allowed !== "boolean") throw new Error(`${label} reservation failed: ${cause(error)}`);
    return { allowed: row.allowed, used: Number(row.used) || 0, resetsAt: typeof row.resets_at === "string" ? row.resets_at : null };
  }
  return {
    async record(record) {
      const { error } = await db.from("model_usage").insert({
        solve_id: record.solveId,
        user_id: record.userId,
        cache_key: record.cacheKey,
        call: record.call,
        model: record.model,
        service_tier: record.serviceTier,
        status: record.status,
        input_tokens: record.usage.inputTokens,
        cached_tokens: record.usage.cachedTokens,
        output_tokens: record.usage.outputTokens,
        reasoning_tokens: record.usage.reasoningTokens,
        total_tokens: record.usage.totalTokens,
        cost_usd: record.costUsd,
        estimated: record.estimated,
      });
      if (error) throw new Error(`usage record failed: ${cause(error)}`);
    },
    async reserveDailySolve(userId, limit) {
      return reservation("reserve_daily_solve", "daily solve", userId, limit);
    },
    async reserveDailyTutor(userId, limit) {
      return reservation("reserve_daily_tutor", "daily tutor", userId, limit);
    },
    async spentTodayUsd() {
      const { data, error } = await db.rpc("daily_model_spend");
      const value = Number(data);
      if (error || !Number.isFinite(value)) throw new Error(`daily spend read failed: ${cause(error)}`);
      return value;
    },
  };
}
