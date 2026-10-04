import { getCurrentUser } from "@/lib/auth";
import { getProblem } from "@/lib/problem-history";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeSolveCache } from "@/lib/solve-cache";
import { createSupabaseUsageStore } from "@/lib/spend";
import { routeTelemetry } from "@/lib/route-telemetry";
import { createTutorHandler } from "@/lib/tutor-handler";

export const runtime = "nodejs";
// One tutor call, aborted at TUTOR_TIMEOUT_MS (default 25 s) or this limit minus 3 s.
export const maxDuration = 40;

export const POST = createTutorHandler({
  getCurrentUser: async () => {
    if (!getSupabaseConfig()) throw new Error("Supabase is not configured");
    return getCurrentUser();
  },
  getCache: () => routeSolveCache(createAdminClient()),
  // The student's own saved problem, read through their session (RLS).
  getProblem,
  getUsage: () => createSupabaseUsageStore(createAdminClient()),
  maxDurationSeconds: maxDuration,
  telemetry: routeTelemetry,
});
