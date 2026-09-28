import { getCurrentUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { reserveSolve } from "@/lib/rate-limit";
import { saveProblem } from "@/lib/problem-history";
import { routeSolveCache } from "@/lib/solve-cache";
import { createSupabaseUsageStore } from "@/lib/spend";
import { routeTelemetry } from "@/lib/route-telemetry";
import { createSolveHandler } from "@/lib/solve-handler";

export const runtime = "nodejs";
// Worst case at the default timeouts: a candidates call and its one guided
// retry (2 x 20 s) plus the explanation and its retry (2 x 30 s), about 100 s.
// Every call also stops at this limit minus 5 s (see deadlineFor), whatever
// the env timeouts are. Vercel allows up to 300 s on Hobby, 800 s on Pro.
export const maxDuration = 180;

export const POST = createSolveHandler({
  getCurrentUser: async () => {
    if (!getSupabaseConfig()) throw new Error("Supabase is not configured");
    return getCurrentUser();
  },
  reserveSolve,
  saveProblem,
  getCache: () => routeSolveCache(createAdminClient()),
  getUsage: () => createSupabaseUsageStore(createAdminClient()),
  maxDurationSeconds: maxDuration,
  telemetry: routeTelemetry,
});
