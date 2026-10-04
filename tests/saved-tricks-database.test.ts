import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Execute every migration in order with PostgreSQL, ending with the tutor and
// saved-tricks migration: row-level security, uniqueness, and the widened
// model_usage call check. Only Supabase's managed auth/storage schemas are
// minimal local fixtures (as in account-database.test.ts).
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const aliceProblem = "33333333-3333-4333-8333-333333333333";
const migrations = new URL("../supabase/migrations/", import.meta.url);

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1]
    $$;
  `);
  const files = (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(files.at(-1), "202610040001_tutor_and_saved_tricks.sql", "the tutor migration runs after every earlier migration");
  for (const file of files) await db.exec(await readFile(new URL(file, migrations), "utf8"));
  await db.query("insert into auth.users(id) values ($1),($2)", [alice, bob]);
  await db.query(
    `insert into public.problems(id, user_id, question, answer, method, status, solution, image_path)
     values ($1, $2, 'What is the positive zero?', '3', 'desmos', 'solved', '{}', $3)`,
    [aliceProblem, alice, `${alice}/question.png`],
  );
});
after(async () => {
  await db.close();
});

async function asUser<T>(id: string, work: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  try {
    return await work();
  } finally {
    await db.exec("reset role");
  }
}

const rows = JSON.stringify([{ latex: "y=x^2-9", purpose: "Graph the equation and read its positive x-intercept." }]);

function saveTrick(owner: string, overrides: { cacheKey?: string | null; techniqueId?: string | null; problemId?: string | null } = {}) {
  const { cacheKey = "key.v1", techniqueId = "intercept-read", problemId = null } = overrides;
  return db.query<{ id: string }>(
    `insert into public.saved_tricks(user_id, technique_id, technique_name, structure, question, answer, expressions, cache_key, problem_id)
     values ($1, $2, 'Read the intercepts', 'One equation, asked for its positive solution.', 'What is the positive solution to x^2 = 9?', '3', $3, $4, $5)
     returning id`,
    [owner, techniqueId, rows, cacheKey, problemId],
  );
}

test("students save, read, and remove only their own tricks", async () => {
  const saved = await asUser(alice, async () => {
    const inserted = await saveTrick(alice);
    const visible = await db.query<{ user_id: string; expressions: unknown; topic: string | null }>("select user_id, expressions, topic from public.saved_tricks");
    assert.equal(visible.rows.length, 1);
    assert.equal(visible.rows[0].user_id, alice);
    assert.deepEqual(visible.rows[0].expressions, JSON.parse(rows), "the rows are stored as JSON");
    assert.equal(visible.rows[0].topic, null);
    return inserted.rows[0].id;
  });
  await asUser(bob, async () => {
    assert.equal((await db.query("select id from public.saved_tricks")).rows.length, 0, "another student sees none of them");
    await assert.rejects(saveTrick(alice), /row-level security/, "a student cannot save a trick as someone else");
    const removed = await db.query("delete from public.saved_tricks where id = $1 returning id", [saved]);
    assert.equal(removed.rows.length, 0, "nor remove one");
    await assert.rejects(db.query("update public.saved_tricks set answer = 'forged'"), /permission denied/, "saved tricks are never edited in place");
  });
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select * from public.saved_tricks"), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
  await asUser(alice, async () => {
    assert.equal((await db.query("delete from public.saved_tricks where id = $1 returning id", [saved])).rows.length, 1);
    assert.equal((await db.query("select id from public.saved_tricks")).rows.length, 0);
  });
});

test("a technique is saved once per solve, and once per saved problem", async () => {
  await asUser(alice, async () => {
    await saveTrick(alice, { cacheKey: "unique.v1" });
    await assert.rejects(saveTrick(alice, { cacheKey: "unique.v1" }), /saved_tricks_once_per_solve/);
    await saveTrick(alice, { cacheKey: "unique.v1", techniqueId: "graph-both-sides" });

    await saveTrick(alice, { cacheKey: null, problemId: aliceProblem });
    await assert.rejects(saveTrick(alice, { cacheKey: null, problemId: aliceProblem }), /saved_tricks_once_per_problem/);
    await saveTrick(alice, { cacheKey: null, problemId: aliceProblem, techniqueId: null });
    await assert.rejects(saveTrick(alice, { cacheKey: null, problemId: aliceProblem, techniqueId: null }), /saved_tricks_once_per_problem/, "a legacy problem without a technique id is still saved once");
  });
  await asUser(bob, async () => {
    await saveTrick(bob, { cacheKey: "unique.v1" });
  });
  const counts = await db.query<{ user_id: string; count: number }>("select user_id, count(*)::int as count from public.saved_tricks group by user_id order by user_id");
  assert.deepEqual(counts.rows.map((row) => [row.user_id, row.count]), [[alice, 4], [bob, 1]]);
});

test("a deleted account takes its saved tricks with it", async () => {
  const carol = "44444444-4444-4444-8444-444444444444";
  await db.query("insert into auth.users(id) values ($1)", [carol]);
  await asUser(carol, async () => {
    await saveTrick(carol, { cacheKey: "carol.v1" });
  });
  await db.query("delete from auth.users where id = $1", [carol]);
  assert.equal((await db.query("select id from public.saved_tricks where user_id = $1", [carol])).rows.length, 0);
});

test("model_usage accepts the tutor call and still rejects unknown calls", async () => {
  const constraint = await db.query<{ definition: string }>(
    "select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'model_usage_call_check' and conrelid = 'public.model_usage'::regclass",
  );
  assert.equal(constraint.rows.length, 1, "the original inline check was replaced under the same name, not added alongside it");
  assert.match(constraint.rows[0].definition, /tutor/);
  const insert = (call: string) =>
    db.query(
      `insert into public.model_usage(solve_id, user_id, call, model, status, input_tokens, output_tokens, total_tokens, cost_usd)
       values ('tutor-1', $1, $2, 'gpt-5-mini', 'completed', 100, 10, 110, 0.001)`,
      [alice, call],
    );
  for (const call of ["candidates", "explanation", "desmos_retry", "tutor"]) await insert(call);
  await assert.rejects(insert("chat"), /model_usage_call_check/);
  const spend = Number((await db.query<{ spend: string }>("select public.daily_model_spend() as spend")).rows[0].spend);
  assert.ok(Math.abs(spend - 0.004) < 1e-9, "tutor calls count toward the global spend ceiling");
});

test("a saved trick can link only the student's own saved problem", async () => {
  await asUser(bob, async () => {
    await assert.rejects(
      saveTrick(bob, { cacheKey: null, problemId: aliceProblem, techniqueId: "linked" }),
      /row-level security/,
      "another student's problem id is refused, so it cannot be linked or probed",
    );
  });
  await asUser(alice, async () => {
    await saveTrick(alice, { cacheKey: null, problemId: aliceProblem, techniqueId: "linked" });
  });
});

type Reservation = { allowed: boolean; used: number; resets_at: Date };

test("reserve_daily_tutor counts tutor questions per user, apart from solves, for the server only", async () => {
  const reserve = async (user: string, limit: number) =>
    (await db.query<Reservation>("select * from public.reserve_daily_tutor($1, $2)", [user, limit])).rows[0];
  assert.deepEqual([(await reserve(alice, 2)).allowed, (await reserve(alice, 2)).allowed], [true, true]);
  const blocked = await reserve(alice, 2);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.used, 2);
  assert.equal((await reserve(bob, 2)).allowed, true, "one student's allowance never limits another");
  assert.equal((await db.query("select id from public.daily_solves")).rows.length, 0, "tutor questions are not solves");

  await db.query("update public.daily_tutor_questions set created_at = now() - interval '25 hours' where user_id = $1", [alice]);
  const reopened = await reserve(alice, 2);
  assert.equal(reopened.allowed, true);
  assert.equal(reopened.used, 1, "questions older than 24 hours no longer count");

  await asUser(alice, async () => {
    await assert.rejects(db.query("select * from public.reserve_daily_tutor($1, 999)", [alice]), /permission denied/);
    await assert.rejects(db.query("select * from public.daily_tutor_questions"), /permission denied/);
  });
});
