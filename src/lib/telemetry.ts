/**
 * Error capture and product events, deliberately minimal: one module, used
 * only by the API handlers. Every record is a structured JSON log line (what
 * any host's log drain collects) and, in production, a row in app_events in
 * the Supabase project Desmo already uses. No image bytes and no problem
 * text are ever recorded: ids, statuses, counts, and error stacks only.
 * Telemetry never fails or slows a request beyond a short flush.
 */

export type EventName =
  | "solve_started"
  | "solve_succeeded"
  | "solve_failed"
  | "method_switched"
  | "cap_hit"
  | "ceiling_hit"
  | "upload_rejected";

/** What a failed solve needs to be debugged: which problem, whose, which technique, which call. */
export type TelemetryContext = {
  userId?: string | null;
  solveId?: string | null;
  cacheKey?: string | null;
  techniqueId?: string | null;
  call?: string | null;
  [detail: string]: string | number | boolean | null | undefined;
};

export type TelemetryRecord = {
  type: "event" | "error";
  name: string;
  at: string;
  context: TelemetryContext;
  error?: { name: string; message: string; stack: string | null };
};

export type TelemetrySink = (record: TelemetryRecord) => void | Promise<void>;

export type Telemetry = {
  event(name: EventName, context?: TelemetryContext): void;
  /** An unexpected failure, with its stack and the solve's context. */
  error(error: unknown, context?: TelemetryContext): void;
  /** Waits (briefly) for records still being written; call before a response ends. */
  flush(): Promise<void>;
};

const FLUSH_LIMIT_MS = 2_000;

export function createTelemetry(sinks: TelemetrySink[]): Telemetry {
  const pending = new Set<Promise<void>>();
  const emit = (record: TelemetryRecord) => {
    for (const sink of sinks) {
      try {
        const written = Promise.resolve(sink(record)).catch(() => undefined);
        pending.add(written);
        void written.finally(() => pending.delete(written));
      } catch {
        // A broken sink never breaks the request it is observing.
      }
    }
  };
  return {
    event(name, context = {}) {
      emit({ type: "event", name, at: new Date().toISOString(), context });
    },
    error(error, context = {}) {
      const failure = error instanceof Error ? error : new Error(String(error));
      emit({
        type: "error",
        name: failure.name || "Error",
        at: new Date().toISOString(),
        context,
        error: { name: failure.name || "Error", message: failure.message.slice(0, 2_000), stack: failure.stack?.slice(0, 8_000) ?? null },
      });
    },
    async flush() {
      if (pending.size === 0) return;
      await Promise.race([Promise.allSettled([...pending]), new Promise((resolve) => setTimeout(resolve, FLUSH_LIMIT_MS))]);
    },
  };
}

/** One JSON line per record: `[desmo:event] {...}` or `[desmo:error] {...}` (with the stack). */
export function consoleSink(): TelemetrySink {
  return (record) => {
    const line = JSON.stringify(record);
    if (record.type === "error") console.error("[desmo:error]", line);
    else console.info("[desmo:event]", line);
  };
}

type SupabaseInsert = { from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }> } };

/** Rows in app_events (service role only; see the app_events migration). A failed write is dropped. */
export function supabaseSink(client: () => unknown): TelemetrySink {
  let warned = false;
  let db: SupabaseInsert | null = null;
  return async (record) => {
    const { userId, solveId, cacheKey, techniqueId, call, ...details } = record.context;
    db ??= client() as SupabaseInsert;
    const { error } = await db.from("app_events").insert({
      type: record.type,
      name: record.name,
      created_at: record.at,
      user_id: userId ?? null,
      solve_id: solveId ?? null,
      cache_key: cacheKey ?? null,
      technique_id: techniqueId ?? null,
      call: call ?? null,
      context: details,
      error_name: record.error?.name ?? null,
      error_message: record.error?.message ?? null,
      error_stack: record.error?.stack ?? null,
    });
    if (error && !warned) {
      warned = true;
      console.warn("[desmo:telemetry] app_events write failed; events are still logged.", (error as { message?: string }).message ?? "");
    }
  };
}

/** Records into an array: for tests. */
export function memorySink(records: TelemetryRecord[]): TelemetrySink {
  return (record) => {
    records.push(record);
  };
}
