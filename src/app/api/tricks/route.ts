import { getCurrentUser } from "@/lib/auth";
import { getProblem } from "@/lib/problem-history";
import { listTricks, removeTrick, saveTrick } from "@/lib/saved-tricks";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeSolveCache } from "@/lib/solve-cache";
import { createTricksHandler } from "@/lib/tutor-handler";

export const runtime = "nodejs";

const handlers = createTricksHandler({
  getCurrentUser: async () => {
    if (!getSupabaseConfig()) throw new Error("Supabase is not configured");
    return getCurrentUser();
  },
  getCache: () => routeSolveCache(createAdminClient()),
  getProblem,
  saveTrick,
  listTricks,
  removeTrick,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
