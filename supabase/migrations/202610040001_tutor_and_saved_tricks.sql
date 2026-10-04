-- AI tutor metering and saved tricks. Apply once in the Supabase SQL editor,
-- or with `supabase db push`, after the usage and limits migration.
begin;

-- The tutor's "Explain this" calls are metered like every other OpenAI call.
-- The original column check was declared inline, so PostgreSQL named it
-- <table>_<column>_check: model_usage_call_check.
alter table public.model_usage drop constraint model_usage_call_check;
alter table public.model_usage add constraint model_usage_call_check
  check (call in ('candidates', 'explanation', 'desmos_retry', 'tutor'));

-- A technique a student bookmarked, with enough of the problem to recognize
-- it later. Every field is resolved by the server from the solve cache or the
-- student's own saved problem, never from client text.
create table public.saved_tricks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  technique_id text,
  technique_name text not null,
  structure text,
  topic text,
  question text not null,
  answer text not null,
  expressions jsonb not null default '[]'::jsonb check (jsonb_typeof(expressions) = 'array'),
  selection text,
  problem_id uuid references public.problems(id) on delete set null,
  cache_key text,
  constraint saved_tricks_once_per_solve unique (user_id, cache_key, technique_id)
);
-- A trick saved from a history page has no cache key; it is unique per saved problem instead.
create unique index saved_tricks_once_per_problem on public.saved_tricks(user_id, problem_id, coalesce(technique_id, ''))
  where problem_id is not null and cache_key is null;
create index saved_tricks_user_created on public.saved_tricks(user_id, created_at desc, id desc);

alter table public.saved_tricks enable row level security;
revoke all on public.saved_tricks from anon, authenticated;
grant select, insert, delete on public.saved_tricks to authenticated;
grant all on public.saved_tricks to service_role;
create policy "Read own saved tricks" on public.saved_tricks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Save own tricks" on public.saved_tricks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Remove own saved tricks" on public.saved_tricks for delete to authenticated
  using ((select auth.uid()) = user_id);

commit;
