import { NextResponse, type NextRequest } from "next/server";
import { authCallbackDestination, exchangeGoogleCode } from "@/lib/google-oauth";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const origin = getSiteOrigin();
  if (!origin || !getSupabaseConfig()) {
    return new Response("Authentication is not configured yet.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const code = request.nextUrl.searchParams.get("code");
  const google = request.nextUrl.searchParams.get("provider") === "google";

  let success = false;
  if (!request.nextUrl.searchParams.has("error") && code && code.length < 4096) {
    try {
      const client = await createClient();
      if (google) {
        success = Boolean(await exchangeGoogleCode(client.auth, code));
      } else {
        const { error } = await client.auth.exchangeCodeForSession(code);
        success = !error;
      }
    } catch {
      // Expired/invalid links should offer a new login, not expose provider errors.
    }
  }
  const response = NextResponse.redirect(new URL(authCallbackDestination(request.nextUrl.searchParams, success), origin));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
