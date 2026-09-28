import { getCurrentUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeSolveCache } from "@/lib/solve-cache";
import { createSupabaseUsageStore } from "@/lib/spend";
import { routeTelemetry } from "@/lib/route-telemetry";
import { createMethodHandler } from "@/lib/solve-handler";

export const runtime = "nodejs";
// One explanation and its retry (2 x 30 s at the default) is cut off at this
// limit minus 5 s, so the second attempt gets whatever time remains.
export const maxDuration = 60;

export const POST = createMethodHandler({
  getCurrentUser: async () => {
    if (!getSupabaseConfig()) throw new Error("Supabase is not configured");
    return getCurrentUser();
  },
  getCache: () => routeSolveCache(createAdminClient()),
  getUsage: () => createSupabaseUsageStore(createAdminClient()),
  maxDurationSeconds: maxDuration,
  telemetry: routeTelemetry,
});
