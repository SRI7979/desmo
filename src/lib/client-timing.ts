/**
 * Browser-side timing of one solve, so time to the first useful result is
 * measured where the student sees it: request sent → response headers (the
 * upload plus everything the server did before the calculator rows) →
 * "methods" event → rows shown in the calculator (after the Desmos
 * pre-flight) → explanation. The server's own stages arrive in the
 * Server-Timing header. Results collect on window.__desmoTimings (read by
 * benchmark scripts) and are logged in development. Nothing is sent anywhere.
 */
export type SolveTiming = {
  /** Milliseconds since the solve started, by mark name (first occurrence wins). */
  marks: Record<string, number>;
  /** Server-Timing durations by stage name, from the solve response. */
  server: Record<string, number>;
};

declare global {
  interface Window {
    __desmoTimings?: SolveTiming[];
  }
}

/** "methods;dur=812.4, cache;desc=\"miss\", model_candidates;dur=790" → { methods: 812.4, model_candidates: 790 } */
export function parseServerTiming(header: string | null | undefined): Record<string, number> {
  const durations: Record<string, number> = {};
  for (const entry of (header ?? "").split(",")) {
    const [name, ...params] = entry.trim().split(";");
    const duration = params.map((param) => /^\s*dur=([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean);
    if (name && duration !== undefined) durations[name.trim()] = Number(duration);
  }
  return durations;
}

export type SolveTimer = {
  mark: (name: string) => void;
  serverTiming: (header: string | null) => void;
  finish: () => SolveTiming;
};

export function startSolveTiming(now: () => number = () => performance.now()): SolveTimer {
  const started = now();
  const timing: SolveTiming = { marks: {}, server: {} };
  let finished = false;
  return {
    mark(name) {
      if (!(name in timing.marks)) timing.marks[name] = Math.round(now() - started);
    },
    serverTiming(header) {
      Object.assign(timing.server, parseServerTiming(header));
    },
    finish() {
      if (finished || typeof window === "undefined") return timing;
      finished = true;
      (window.__desmoTimings ??= []).push(timing);
      if (process.env.NODE_ENV === "development") console.info("[desmo:timing]", JSON.stringify(timing));
      return timing;
    },
  };
}
