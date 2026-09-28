import { getCurrentUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeSolveCache } from "@/lib/solve-cache";
import { createSupabaseUsageStore } from "@/lib/spend";
import { createMethodHandler } from "@/lib/solve-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = createMethodHandler({
  getCurrentUser: async () => {
    if (!getSupabaseConfig()) throw new Error("Supabase is not configured");
    return getCurrentUser();
  },
  getCache: () => routeSolveCache(createAdminClient()),
  getUsage: () => createSupabaseUsageStore(createAdminClient()),
});
