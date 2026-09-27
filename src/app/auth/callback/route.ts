import { NextResponse, type NextRequest } from "next/server";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const origin = getSiteOrigin();
  if (!origin || !getSupabaseConfig()) {
    return new Response("Authentication is not configured yet.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("recovery") === "1"
    ? "/auth/reset-password"
    : safeAuthRedirect(request.nextUrl.searchParams.get("next"));

  let success = false;
  if (code && code.length < 4096) {
    try {
      const client = await createClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      success = !error;
    } catch {
      // Expired/invalid links should offer a new login, not expose provider errors.
    }
  }
  const response = NextResponse.redirect(new URL(success ? next : "/login?notice=link-expired", origin));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
