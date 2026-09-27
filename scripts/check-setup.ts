import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { getSiteOrigin, getSupabaseConfig } from "../src/lib/supabase/config";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function main() {
  let failures = 0;
  function check(label: string, passed: boolean, help: string) {
    console.log(`${passed ? "OK" : "FIX"}  ${label}${passed ? "" : ` — ${help}`}`);
    if (!passed) failures++;
  }
  const config = getSupabaseConfig();
  check("Supabase public configuration", Boolean(config), "Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.");
  check("Site URL", Boolean(getSiteOrigin()), "Set NEXT_PUBLIC_SITE_URL to http://localhost:3000 locally or your HTTPS origin when deployed.");
  check("OpenAI key present", Boolean(process.env.OPENAI_API_KEY?.trim()), "Fill OPENAI_API_KEY.");
  check("Desmos key present", Boolean(process.env.NEXT_PUBLIC_DESMOS_API_KEY?.trim()), "Fill NEXT_PUBLIC_DESMOS_API_KEY.");
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  check("Supabase server key present", Boolean(secret), "Fill SUPABASE_SECRET_KEY; never use a NEXT_PUBLIC_ name for it.");

  if (config) {
    try {
      const settings = await fetch(`${config.url}/auth/v1/settings`, {
        headers: { apikey: config.key }, signal: AbortSignal.timeout(10_000),
      });
      check("Supabase Auth connection", settings.ok, `The project rejected the public configuration (HTTP ${settings.status}). Check the URL and publishable key belong to the same project.`);
      if (settings.ok) {
        const body = await settings.json();
        check("Email sign-in enabled", body.external?.email === true, "Enable Email under Authentication → Providers.");
        check("New accounts enabled", body.disable_signup !== true, "Enable new user signups under Authentication settings.");
      }
    } catch {
      check("Supabase Auth connection", false, "The project is unreachable. Check its URL, network connection, and whether the project is paused.");
    }
  }

  if (config && secret) {
    const admin = createClient(config.url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
    });
    const [history, images, limiter] = await Promise.all([
      admin.from("problems").select("id").limit(0),
      admin.storage.getBucket("problem-images"),
      // A null account violates NOT NULL before any write can occur. This checks
      // RPC presence/permissions without creating a user or consuming a slot.
      admin.rpc("reserve_solve", { p_user_id: null }),
    ]);
    const migrationHelp = "Run supabase/migrations/202609210001_accounts_history_limits.sql in SQL Editor; verify the server key if it is already applied.";
    check("History table", !history.error, migrationHelp);
    check("Private screenshot bucket", !images.error && images.data?.public === false, migrationHelp);
    check("Rate-limit function", limiter.error?.code === "23502", migrationHelp);
    const host = new URL(config.url).hostname;
    if (failures && /^[a-z0-9]+\.supabase\.co$/.test(host)) {
      console.log(`SQL Editor: https://supabase.com/dashboard/project/${host.split(".")[0]}/sql/new`);
    }
  }
  console.log(failures ? `\n${failures} setup check(s) need attention. No credentials were printed.` : "\nSetup checks passed. Email delivery and your account can now be tested in the app.");
  if (failures) process.exitCode = 1;
}

main().catch(() => {
  console.error("Setup check could not complete. Verify the Supabase URL and keys, then try again.");
  process.exitCode = 1;
});
