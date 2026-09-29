import assert from "node:assert/strict";
import { test } from "node:test";
import { createServerClient } from "@supabase/ssr";

import { authCallbackDestination, exchangeGoogleCode, googleAuthorizationUrl } from "../src/lib/google-oauth";
import { createMemoryUsageStore, createMeter, DailyCapError } from "../src/lib/spend";

const supabaseOrigin = "https://auth.example.test";
const siteOrigin = "https://desmo-one.vercel.app";

function mockedAuth(userId: string, providers = ["google"], email = "student@example.com") {
  const user = {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { provider: providers.at(-1), providers },
    user_metadata: {},
    created_at: "2026-09-27T00:00:00Z",
  };
  const session = {
    access_token: "mock-access-token",
    refresh_token: "mock-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
  const cookies = new Map<string, string>();
  const requests: string[] = [];
  const client = createServerClient(supabaseOrigin, "sb_publishable_test", {
    global: {
      fetch: async (input) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        assert.equal(url.origin, supabaseOrigin, "auth must use only the mocked Supabase endpoint");
        requests.push(`${url.pathname}${url.search}`);
        if (url.pathname === "/auth/v1/token" && ["pkce", "password"].includes(url.searchParams.get("grant_type") ?? "")) {
          return Response.json(session);
        }
        if (url.pathname === "/auth/v1/user") return Response.json(user);
        throw new Error(`Unexpected mocked auth request: ${url.pathname}${url.search}`);
      },
    },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const { name, value } of items) {
          if (value) cookies.set(name, value);
          else cookies.delete(name);
        }
      },
    },
  });
  return { client, cookies, requests };
}

test("Google OAuth creates or links the Supabase user and persists a valid SSR session", async () => {
  for (const userId of ["new-google-user", "existing-verified-email-user"]) {
    const providers = userId === "new-google-user" ? ["google"] : ["email", "google"];
    const { client, cookies, requests } = mockedAuth(userId, providers);
    const authorize = await googleAuthorizationUrl(client.auth, siteOrigin, supabaseOrigin, "/history");
    assert.ok(authorize);
    const url = new URL(authorize);
    assert.equal(url.searchParams.get("provider"), "google");
    assert.equal(url.searchParams.get("redirect_to"), `${siteOrigin}/auth/callback?provider=google&next=%2Fhistory`);
    assert.ok(cookies.size > 0, "PKCE verifier is saved before leaving the app");

    const exchangedUserId = await exchangeGoogleCode(client.auth, "mock-google-code");
    assert.equal(exchangedUserId, userId, "new and linked identities keep the user id returned by Supabase");
    assert.ok(requests.some((path) => path.startsWith("/auth/v1/token?grant_type=pkce")));
    assert.equal((await client.auth.getUser()).data.user?.id, userId);
    assert.ok(cookies.size > 0, "the authenticated session is stored in cookies");
    assert.equal(authCallbackDestination(new URLSearchParams("provider=google&next=%2Fhistory"), true), "/history");
  }
});

test("the existing email-password Supabase session flow still signs in", async () => {
  const { client, cookies, requests } = mockedAuth("existing-email-user", ["email"]);
  const { data, error } = await client.auth.signInWithPassword({ email: "student@example.com", password: "existing-password" });
  assert.equal(error, null);
  assert.equal(data.user?.id, "existing-email-user");
  assert.equal((await client.auth.getUser()).data.user?.id, "existing-email-user");
  assert.ok(cookies.size > 0);
  assert.ok(requests.some((path) => path.startsWith("/auth/v1/token?grant_type=password")));
});

test("cancelled and failed Google flows return to sign-in with a plain notice", async () => {
  const cancelled = authCallbackDestination(new URLSearchParams("provider=google&error=access_denied&next=%2Fhistory"), false);
  const failed = authCallbackDestination(new URLSearchParams("provider=google&error=server_error&next=https%3A%2F%2Fevil.test"), false);
  assert.equal(cancelled, "/login?notice=google-cancelled&next=%2Fhistory");
  assert.equal(failed, "/login?notice=google-error&next=%2Fsolve");
  assert.equal(authCallbackDestination(new URLSearchParams("next=%2Fhistory"), false), "/login?notice=link-expired");
  assert.equal(authCallbackDestination(new URLSearchParams("provider=google&recovery=1&next=%2Fhistory"), true), "/history");

  const rejected = await googleAuthorizationUrl({ signInWithOAuth: async () => ({ data: { url: null }, error: new Error("provider disabled") }) }, siteOrigin, supabaseOrigin, "/solve");
  assert.equal(rejected, null);
  const unsafe = await googleAuthorizationUrl({ signInWithOAuth: async () => ({ data: { url: "https://evil.test/authorize?provider=google" }, error: null }) }, siteOrigin, supabaseOrigin, "/solve");
  assert.equal(unsafe, null);
  assert.equal(await exchangeGoogleCode({ exchangeCodeForSession: async () => ({ data: { user: { id: "u1" }, session: null }, error: null }) }, "incomplete"), null);
});

test("a Google user is counted by the same rolling solve cap as any other user", async () => {
  const { client } = mockedAuth("google-student");
  await googleAuthorizationUrl(client.auth, siteOrigin, supabaseOrigin, "/solve");
  const userId = await exchangeGoogleCode(client.auth, "mock-google-code");
  assert.equal(userId, "google-student");
  const store = createMemoryUsageStore();
  for (const solveId of ["first", "second"]) {
    const meter = createMeter({ store, userId, solveId, limits: { freeSolvesPerDay: 2, dailySpendCeilingUsd: 5 } });
    await meter.authorizeSolve();
  }
  const third = createMeter({ store, userId, solveId: "third", limits: { freeSolvesPerDay: 2, dailySpendCeilingUsd: 5 } });
  await assert.rejects(third.authorizeSolve(), DailyCapError);
  assert.equal(store.solves.filter((solve) => solve.userId === userId).length, 2);
});
