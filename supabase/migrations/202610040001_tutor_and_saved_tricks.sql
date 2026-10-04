-- AI tutor metering and saved tricks. Apply once in the Supabase SQL editor,
-- or with `supabase db push`, after the usage and limits migration, and
-- BEFORE deploying the tutor: without reserve_daily_tutor the server refuses
-- tutor questions (it fails closed, like the solve limits).
begin;

-- The tutor's "Explain this" calls are metered like every other OpenAI call.
-- The original column check was declared inline, so PostgreSQL named it
-- <table>_<column>_check: model_usage_call_check.
alter table public.model_usage drop constraint model_usage_call_check;
alter table public.model_usage add constraint model_usage_call_check
  check (call in ('candidates', 'explanation', 'desmos_retry', 'tutor'));

-- Tutor answers per user over a rolling 24 hours (TUTOR_QUESTIONS_PER_DAY),
-- counted apart from daily_solves so a question never uses up a solve, and
-- so one account cannot spend the global ceiling that every student shares.
create table public.daily_tutor_questions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index daily_tutor_questions_user_time on public.daily_tutor_questions(user_id, created_at);

-- Atomic check-and-count, like reserve_daily_solve (its own lock key).
create function public.reserve_daily_tutor(p_user_id uuid, p_limit integer)
returns table(allowed boolean, used integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  window_start timestamptz := now() - interval '24 hours';
  current_used integer;
  oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));
  delete from public.daily_tutor_questions where user_id = p_user_id and created_at <= window_start;
  select count(*), min(created_at) into current_used, oldest
    from public.daily_tutor_questions where user_id = p_user_id;
  if current_used < p_limit then
    insert into public.daily_tutor_questions(user_id) values (p_user_id);
    return query select true, current_used + 1, coalesce(oldest, now()) + interval '24 hours';
  else
    return query select false, current_used, oldest + interval '24 hours';
  end if;
end;
$$;

alter table public.daily_tutor_questions enable row level security;
revoke all on public.daily_tutor_questions from anon, authenticated;
grant all on public.daily_tutor_questions to service_role;
revoke all on function public.reserve_daily_tutor(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_daily_tutor(uuid, integer) to service_role;

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
-- A saved problem it links to must be the student's own (problems' own
-- row-level security limits the subquery to their rows).
create policy "Save own tricks" on public.saved_tricks for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (problem_id is null or exists (
      select 1 from public.problems where problems.id = saved_tricks.problem_id and problems.user_id = (select auth.uid())
    ))
  );
create policy "Remove own saved tricks" on public.saved_tricks for delete to authenticated
  using ((select auth.uid()) = user_id);

commit;
