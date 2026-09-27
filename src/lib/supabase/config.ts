export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !key || key.startsWith("sb_secret_")) return null;

  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    // A legacy service-role JWT must never be used as the public key.
    if (key.split(".").length === 3) {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
      if (payload.role === "service_role") return null;
    }
    return { url: parsed.origin, key };
  } catch {
    return null;
  }
}

/** Email callbacks use a configured origin, never a request's Host header. */
export function getSiteOrigin(): string | null {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) return null;

  try {
    const url = new URL(siteUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
