import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Execute the real usage migration with PostgreSQL: the atomic daily
// reservation, the UTC-day spend total, the per-solve view, and privileges.
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/202609290001_usage_and_limits.sql", import.meta.url), "utf8"));
  await db.query("insert into auth.users(id) values ($1),($2)", [alice, bob]);
});
after(async () => {
  await db.close();
});

type Reservation = { allowed: boolean; used: number; resets_at: Date };
const reserve = async (user: string, limit: number) =>
  (await db.query<Reservation>("select * from public.reserve_daily_solve($1, $2)", [user, limit])).rows[0];

test("reserve_daily_solve counts new solves per user over a rolling 24 hours and says when the cap lifts", async () => {
  assert.deepEqual([(await reserve(alice, 2)).allowed, (await reserve(alice, 2)).allowed], [true, true]);
  const blocked = await reserve(alice, 2);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.used, 2);
  const oldest = (await db.query<{ created_at: Date }>("select min(created_at) as created_at from public.daily_solves where user_id=$1", [alice])).rows[0].created_at;
  assert.equal(new Date(blocked.resets_at).getTime(), oldest.getTime() + 24 * 3600 * 1000, "it lifts when the oldest solve leaves the window");
  assert.equal((await reserve(bob, 2)).allowed, true, "one user's cap never limits another");

  // Solves older than 24 hours no longer count, and are pruned.
  await db.query("update public.daily_solves set created_at = now() - interval '25 hours' where user_id=$1", [alice]);
  const reopened = await reserve(alice, 2);
  assert.equal(reopened.allowed, true);
  assert.equal(reopened.used, 1);
  assert.equal((await db.query("select * from public.daily_solves where user_id=$1", [alice])).rows.length, 1);
});

test("daily_model_spend sums only today's recorded cost (UTC), and solve_costs sums one solve's calls", async () => {
  const insert = (solveId: string, cost: number, age: string, call = "candidates") =>
    db.query(
      `insert into public.model_usage(solve_id, user_id, call, model, status, input_tokens, output_tokens, total_tokens, cost_usd, created_at)
       values ($1, $2, $3, 'gpt-5-mini', 'completed', 100, 10, 110, $4, now() - $5::interval)`,
      [solveId, alice, call, cost, age],
    );
  await insert("solve-1", 0.0062, "0 seconds");
  await insert("solve-1", 0.0024, "0 seconds", "explanation");
  await insert("old", 3, "2 days");
  const spend = Number((await db.query<{ spend: string }>("select public.daily_model_spend() as spend")).rows[0].spend);
  assert.ok(Math.abs(spend - 0.0086) < 1e-9, `today's spend is 0.0086, got ${spend}`);
  const solve = (await db.query<{ calls: number; cost_usd: string }>("select calls, cost_usd from public.solve_costs where solve_id='solve-1'")).rows[0];
  assert.equal(Number(solve.calls), 2);
  assert.equal(Number(solve.cost_usd), 0.0086);
});

test("only the server can read usage or call the limit functions", async () => {
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.query("select * from public.model_usage"), /permission denied/);
    await assert.rejects(db.query("select * from public.solve_costs"), /permission denied/);
    await assert.rejects(db.query("select * from public.reserve_daily_solve($1, 99)", [alice]), /permission denied/);
    await assert.rejects(db.query("select public.daily_model_spend()"), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});

test("app_events stores events and errors for the server only", async () => {
  await db.exec(await readFile(new URL("../supabase/migrations/202609290002_app_events.sql", import.meta.url), "utf8"));
  await db.query(
    `insert into public.app_events(type, name, user_id, solve_id, cache_key, technique_id, call, context, error_name, error_message, error_stack)
     values ('error', 'ModelTimeoutError', $1, 'solve-9', 'key.v1', 'discriminant', 'explanation', '{"stage":"method_switch"}', 'ModelTimeoutError', 'aborted', 'at callModel')`,
    [alice],
  );
  const row = (await db.query<{ call: string; context: { stage: string } }>("select call, context from public.app_events where solve_id='solve-9'")).rows[0];
  assert.equal(row.call, "explanation");
  assert.equal(row.context.stage, "method_switch");
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.query("select * from public.app_events"), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});
