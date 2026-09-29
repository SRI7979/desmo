import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAuthRedirect } from "../src/lib/auth-redirect";
import { getSiteOrigin, getSupabaseConfig } from "../src/lib/supabase/config";

test("auth redirects allow only known local destinations", () => {
  const history = "/history/11111111-1111-4111-8111-111111111111";
  for (const path of ["/solve", "/history", history]) assert.equal(safeAuthRedirect(path), path);
  for (const path of [null, ["/history"], "https://evil.test", "//evil.test", "/\\evil.test", "/history/../auth/reset-password", "/history?next=https://evil.test", "/api/solve", "/auth/reset-password", "%2F%2Fevil.test"]) {
    assert.equal(safeAuthRedirect(path), "/solve");
  }
});

test("email callback origins reject credential-bearing and insecure remote URLs", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  try {
    delete process.env.VERCEL_ENV;
    for (const url of ["http://evil.test", "javascript:alert(1)", "https://user:pass@example.com", ""]) {
      process.env.NEXT_PUBLIC_SITE_URL = url;
      assert.equal(getSiteOrigin(), null);
    }
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000/path";
    assert.equal(getSiteOrigin(), "http://localhost:3000");
    process.env.NEXT_PUBLIC_SITE_URL = "https://desmo.example.com/path";
    assert.equal(getSiteOrigin(), "https://desmo.example.com");
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  }
});

test("Vercel production auth callbacks use the public origin when configured for localhost", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      process.env.NEXT_PUBLIC_SITE_URL = url;
      assert.equal(getSiteOrigin(), "https://desmo-one.vercel.app");
    }

    process.env.NEXT_PUBLIC_SITE_URL = "https://custom.example.com/path";
    assert.equal(getSiteOrigin(), "https://custom.example.com");

    process.env.NEXT_PUBLIC_SITE_URL = "http://evil.test";
    assert.equal(getSiteOrigin(), null);
    process.env.NEXT_PUBLIC_SITE_URL = "";
    assert.equal(getSiteOrigin(), null);

    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    process.env.VERCEL_ENV = "preview";
    assert.equal(getSiteOrigin(), "http://localhost:3000");
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  }
});

test("public Supabase configuration rejects accidental service secrets", () => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    for (const key of ["", "sb_secret_do-not-expose", `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`]) {
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
      assert.equal(getSupabaseConfig(), null);
    }
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_public-test-key";
    assert.equal(getSupabaseConfig()?.url, "https://example.supabase.co");
  } finally {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
