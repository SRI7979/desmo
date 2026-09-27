import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export class RateLimitUnavailableError extends Error {}

export type SolveReservation = { allowed: boolean; retryAfter: number };

export async function reserveSolve(userId: string): Promise<SolveReservation> {
  try {
    const { data, error } = await createAdminClient().rpc("reserve_solve", {
      p_user_id: userId,
    });
    const result = Array.isArray(data) ? data[0] : null;
    if (
      error || !result || typeof result.allowed !== "boolean" ||
      !Number.isInteger(result.retry_after) || result.retry_after < 0
    ) throw new Error("Invalid rate limit response");
    return { allowed: result.allowed, retryAfter: result.retry_after };
  } catch {
    // A database outage must not turn the expensive API into an unlimited one.
    throw new RateLimitUnavailableError("The solver is temporarily unavailable. Please try again shortly.");
  }
}
