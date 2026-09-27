import "server-only";

import { redirect } from "next/navigation";
import { safeAuthRedirect } from "./auth-redirect";
import { getSupabaseConfig } from "./supabase/config";
import { createClient } from "./supabase/server";

export async function getCurrentUser(): Promise<{ id: string; email?: string } | null> {
  if (!getSupabaseConfig()) return null;
  try {
    const client = await createClient();
    // Authoritative server verification, including revoked/deleted accounts.
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}

export async function requireUser(next = "/solve") {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeAuthRedirect(next))}`);
  return user;
}
