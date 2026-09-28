import { getCurrentUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeSolveCache } from "@/lib/solve-cache";
import { createPreflightHandler } from "@/lib/solve-handler";

export const runtime = "nodejs";
// The one Desmos retry is a full candidates call (a guided retry runs at
// medium reasoning effort and has taken up to about 50 s).
export const maxDuration = 120;

export const POST = createPreflightHandler({
  getCurrentUser: async () => {
    if (!getSupabaseConfig()) throw new Error("Supabase is not configured");
    return getCurrentUser();
  },
  getCache: () => routeSolveCache(createAdminClient()),
});
