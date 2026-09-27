import { NextResponse, type NextRequest } from "next/server";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const origin = getSiteOrigin();
  if (!origin || !getSupabaseConfig()) {
    return new Response("Authentication is not configured yet.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const next = type === "recovery" ? "/auth/reset-password" : safeAuthRedirect(request.nextUrl.searchParams.get("next"));

  let success = false;
  if (tokenHash && tokenHash.length < 4096 && (type === "email" || type === "signup" || type === "recovery")) {
    try {
      const client = await createClient();
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      success = !error;
    } catch {
      // Do not expose auth tokens or provider details in the error page.
    }
  }
  const response = NextResponse.redirect(new URL(success ? next : "/login?notice=link-expired", origin));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
