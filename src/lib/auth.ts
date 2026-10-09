import "server-only";

import { redirect } from "next/navigation";
import { safeAuthRedirect } from "./auth-redirect";
import { getSupabaseConfig } from "./supabase/config";
import { createClient } from "./supabase/server";

export async function getCurrentUser(): Promise<{ id: string; email?: string; avatarUrl?: string; name?: string } | null> {
  if (!getSupabaseConfig()) return null;
  try {
    const client = await createClient();
    // Authoritative server verification, including revoked/deleted accounts.
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    const rawName = data.user.user_metadata?.full_name ?? data.user.user_metadata?.name;
    const name = typeof rawName === "string" ? rawName.trim().slice(0, 80) || undefined : undefined;
    const rawAvatar = data.user.user_metadata?.avatar_url ?? data.user.user_metadata?.picture;
    let avatarUrl: string | undefined;
    if (typeof rawAvatar === "string") {
      try {
        const url = new URL(rawAvatar);
        if (url.protocol === "https:" && !url.username && !url.password && (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"))) {
          avatarUrl = url.toString();
        }
      } catch {
        // Ignore malformed profile photo metadata and show the initial instead.
      }
    }
    return { id: data.user.id, email: data.user.email, avatarUrl, name };
  } catch {
    return null;
  }
}

export async function requireUser(next = "/solve") {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeAuthRedirect(next))}`);
  return user;
}
