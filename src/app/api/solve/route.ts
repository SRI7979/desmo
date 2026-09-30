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
// Candidate generation may use one guided correction or one timeout recovery,
// followed by the explanation and its guided correction. Every call stops at
// this limit minus 5 s (see deadlineFor), whatever
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
