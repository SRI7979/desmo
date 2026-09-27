import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Execute the real migration with PostgreSQL, including RLS and RPC privileges.
// Only Supabase's managed auth/storage schemas are minimal local fixtures.
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const saved = { answer: "3", expressions: [{ latex: "y=x^2-9", purpose: "Find the positive zero." }] };

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
  await db.exec(await readFile(new URL("../supabase/migrations/202609210001_accounts_history_limits.sql", import.meta.url), "utf8"));
  await db.query("insert into auth.users(id) values ($1),($2)", [alice, bob]);
  for (const owner of [alice, bob]) {
    await db.query(`insert into public.problems(user_id, question, answer, method, status, solution, image_path)
      values ($1, 'What is the positive zero?', '3', 'desmos', 'solved', $2, $3)`, [owner, JSON.stringify(saved), `${owner}/question.png`]);
    await db.query("insert into storage.objects(bucket_id,name) values ('problem-images',$1)", [`${owner}/question.png`]);
  }
});
after(async () => { await db.close(); });

async function asUser(id: string, work: () => Promise<void>) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  try { await work(); } finally { await db.exec("reset role"); }
}

test("history and image policies isolate accounts and preserve canonical expressions", async () => {
  await asUser(alice, async () => {
    const history = await db.query<{ user_id: string; solution: typeof saved }>("select user_id,solution from public.problems");
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].user_id, alice);
    assert.deepEqual(history.rows[0].solution, saved);
    assert.equal((await db.query("select id from public.problems where user_id=$1", [bob])).rows.length, 0);
    const images = await db.query<{ name: string }>("select name from storage.objects");
    assert.deepEqual(images.rows.map(row => row.name), [`${alice}/question.png`]);
  });
});

test("anonymous users cannot read history; clients cannot forge saves or reset quotas", async () => {
  await db.exec("set role anon");
  try { await assert.rejects(db.query("select * from public.problems"), /permission denied/); }
  finally { await db.exec("reset role"); }
  await asUser(alice, async () => {
    await assert.rejects(db.query("select * from public.solve_rate_limits"), /permission denied/);
    await assert.rejects(db.query("select * from public.reserve_solve($1)", [alice]), /permission denied/);
    await assert.rejects(db.query("update public.problems set answer='forged'"), /permission denied/);
    await assert.rejects(db.query("delete from public.solve_rate_limits"), /permission denied/);
  });
});

test("three attempts in a rolling minute; fourth is denied and another account is independent", async () => {
  await db.exec("set role service_role");
  try {
    const attempts = await Promise.all(Array.from({ length: 8 }, () =>
      db.query<{ allowed: boolean; retry_after: number }>("select * from public.reserve_solve($1)", [alice])));
    assert.equal(attempts.filter(result => result.rows[0].allowed).length, 3);
    for (const result of attempts.filter(result => !result.rows[0].allowed)) {
      assert.ok(result.rows[0].retry_after >= 1 && result.rows[0].retry_after <= 60);
    }
    assert.equal((await db.query<{ allowed: boolean }>("select * from public.reserve_solve($1)", [bob])).rows[0].allowed, true);
  } finally { await db.exec("reset role"); }
});

test("expired attempts are pruned, there is no daily cap, and the row stays bounded", async () => {
  await db.query(`update public.solve_rate_limits set admitted_at = array[
    clock_timestamp()-interval '61 seconds', clock_timestamp()-interval '30 seconds', clock_timestamp()-interval '20 seconds'
  ] where user_id=$1`, [alice]);
  assert.equal((await db.query<{ allowed: boolean }>("select * from public.reserve_solve($1)", [alice])).rows[0].allowed, true);
  assert.equal((await db.query<{ allowed: boolean }>("select * from public.reserve_solve($1)", [alice])).rows[0].allowed, false);
  await db.query("update public.solve_rate_limits set admitted_at=array[clock_timestamp()-interval '2 minutes'] where user_id=$1", [alice]);
  assert.equal((await db.query<{ allowed: boolean }>("select * from public.reserve_solve($1)", [alice])).rows[0].allowed, true);
  assert.equal((await db.query<{ size: number }>("select cardinality(admitted_at) as size from public.solve_rate_limits where user_id=$1", [alice])).rows[0].size, 1);
});

test("image bucket is private and constrained to supported screenshot formats", async () => {
  const result = await db.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>("select * from storage.buckets where id='problem-images'");
  assert.equal(result.rows[0].public, false);
  assert.equal(Number(result.rows[0].file_size_limit), 8 * 1024 * 1024);
  assert.deepEqual(result.rows[0].allowed_mime_types, ["image/png", "image/jpeg", "image/webp"]);
});
