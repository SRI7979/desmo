import { getCurrentUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseSolveCache, withCacheFallback } from "@/lib/solve-cache";
import { createMethodHandler } from "@/lib/solve-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = createMethodHandler({
  getCurrentUser: async () => {
    if (!getSupabaseConfig()) throw new Error("Supabase is not configured");
    return getCurrentUser();
  },
  getCache: () =>
    withCacheFallback(createSupabaseSolveCache(createAdminClient()), (operation) =>
      console.warn(`[desmo:cache] ${operation} failed; solving without the cache.`),
    ),
});
