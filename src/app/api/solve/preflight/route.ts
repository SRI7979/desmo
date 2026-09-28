import { getCurrentUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeSolveCache } from "@/lib/solve-cache";
import { createSupabaseUsageStore } from "@/lib/spend";
import { routeTelemetry } from "@/lib/route-telemetry";
import { createPreflightHandler } from "@/lib/solve-handler";

export const runtime = "nodejs";
// The one Desmos retry is a full candidates call at medium reasoning effort,
// bounded by CANDIDATES_TIMEOUT_MS and by this limit minus 5 s.
export const maxDuration = 120;

export const POST = createPreflightHandler({
  getCurrentUser: async () => {
    if (!getSupabaseConfig()) throw new Error("Supabase is not configured");
    return getCurrentUser();
  },
  getCache: () => routeSolveCache(createAdminClient()),
  getUsage: () => createSupabaseUsageStore(createAdminClient()),
  maxDurationSeconds: maxDuration,
  telemetry: routeTelemetry,
});
