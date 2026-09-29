import { safeAuthRedirect } from "./auth-redirect";

type GoogleSignInAuth = {
  signInWithOAuth: (credentials: {
    provider: "google";
    options: { redirectTo: string };
  }) => Promise<{ data: { url: string | null }; error: unknown }>;
};

type GoogleCodeAuth = {
  exchangeCodeForSession: (code: string) => Promise<{
    data: { user: { id: string } | null; session: { access_token: string; user: { id: string } } | null };
    error: unknown;
  }>;
};

/** Start the same cookie-backed PKCE flow used by the existing callback. */
export async function googleAuthorizationUrl(
  auth: GoogleSignInAuth,
  siteOrigin: string,
  supabaseOrigin: string,
  next: unknown,
): Promise<string | null> {
  const callback = new URL("/auth/callback", siteOrigin);
  callback.searchParams.set("provider", "google");
  callback.searchParams.set("next", safeAuthRedirect(next));

  const { data, error } = await auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });
  if (error || !data.url) return null;

  // An auth response must never become an arbitrary external redirect.
  try {
    const url = new URL(data.url);
    if (url.origin !== supabaseOrigin || url.pathname !== "/auth/v1/authorize" || url.searchParams.get("provider") !== "google") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** A successful exchange must yield the same authenticated user id used everywhere else. */
export async function exchangeGoogleCode(auth: GoogleCodeAuth, code: string): Promise<string | null> {
  const { data, error } = await auth.exchangeCodeForSession(code);
  return !error && data.user?.id && data.session?.access_token && data.session.user.id === data.user.id ? data.user.id : null;
}

/** Keep OAuth failures on the sign-in page, without showing provider details. */
export function authCallbackDestination(params: URLSearchParams, success: boolean): string {
  if (success) {
    return params.get("provider") !== "google" && params.get("recovery") === "1"
      ? "/auth/reset-password"
      : safeAuthRedirect(params.get("next"));
  }
  if (params.get("provider") !== "google") return "/login?notice=link-expired";

  const notice = params.get("error") === "access_denied" ? "google-cancelled" : "google-error";
  return `/login?notice=${notice}&next=${encodeURIComponent(safeAuthRedirect(params.get("next")))}`;
}
