import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  const settings = getSupabaseConfig();
  if (!settings) return response;

  const client = createServerClient(settings.url, settings.key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: getSiteOrigin()?.startsWith("https://") ?? false,
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });

  try {
    await client.auth.getClaims();
  } catch {
    // Protected pages and APIs perform their own authoritative user check.
  }
  return response;
}

export const config = {
  matcher: ["/login", "/auth/:path*", "/solve/:path*", "/history/:path*", "/api/solve", "/api/history/:path*"],
};
