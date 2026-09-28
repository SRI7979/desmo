import { getCurrentUser } from "@/lib/auth";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { reserveSolve } from "@/lib/rate-limit";
import { saveProblem } from "@/lib/problem-history";
import { routeSolveCache } from "@/lib/solve-cache";
import { createSolveHandler } from "@/lib/solve-handler";

export const runtime = "nodejs";
export const maxDuration = 180;

export const POST = createSolveHandler({
  getCurrentUser: async () => {
    if (!getSupabaseConfig()) throw new Error("Supabase is not configured");
    return getCurrentUser();
  },
  reserveSolve,
  saveProblem,
  getCache: () => routeSolveCache(createAdminClient()),
});
