-- Spend protection. Apply once in the Supabase SQL editor, or with
-- `supabase db push`, BEFORE deploying the code that uses it: without these
-- tables the server refuses new model work (it fails closed, like the
-- per-minute limiter), while cached solves and history keep working.
-- Only the server (service role) reads or writes any of it.
begin;

-- Every OpenAI call: actual token usage, the tier OpenAI billed, and the USD
-- cost from the rate table in src/lib/model-pricing.ts. A timed-out call is
-- recorded at a deliberately high estimate (estimated = true).
create table public.model_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  solve_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  cache_key text,
  call text not null check (call in ('candidates', 'explanation', 'desmos_retry')),
  model text not null,
  service_tier text,
  status text not null check (status in ('completed', 'timeout', 'failed')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_tokens integer not null default 0 check (cached_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  estimated boolean not null default false
);
create index model_usage_created_at on public.model_usage(created_at);
create index model_usage_solve on public.model_usage(solve_id);

-- What one solve cost: every call made for one request, summed.
create view public.solve_costs with (security_invoker = true) as
  select
    solve_id,
    max(user_id::text)::uuid as user_id,
    max(cache_key) as cache_key,
    min(created_at) as started_at,
    count(*) as calls,
    sum(input_tokens) as input_tokens,
    sum(cached_tokens) as cached_tokens,
    sum(output_tokens) as output_tokens,
    sum(cost_usd) as cost_usd,
    bool_or(estimated) as estimated
  from public.model_usage
  group by solve_id;

-- New solves per user (a solve that needs a model call; cached solves are not
-- counted), over a rolling 24 hours.
create table public.daily_solves (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index daily_solves_user_time on public.daily_solves(user_id, created_at);

-- Atomic check-and-count: a per-user advisory lock makes concurrent solves
-- from one account see each other, so the cap cannot be raced past.
create function public.reserve_daily_solve(p_user_id uuid, p_limit integer)
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
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from public.daily_solves where user_id = p_user_id and created_at <= window_start;
  select count(*), min(created_at) into current_used, oldest
    from public.daily_solves where user_id = p_user_id;
  if current_used < p_limit then
    insert into public.daily_solves(user_id) values (p_user_id);
    return query select true, current_used + 1, coalesce(oldest, now()) + interval '24 hours';
  else
    -- The cap lifts when the oldest counted solve leaves the 24-hour window.
    return query select false, current_used, oldest + interval '24 hours';
  end if;
end;
$$;

-- Recorded cost across all users since midnight UTC.
create function public.daily_model_spend()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)
  from public.model_usage
  where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');
$$;

alter table public.model_usage enable row level security;
alter table public.daily_solves enable row level security;
revoke all on public.model_usage, public.daily_solves, public.solve_costs from anon, authenticated;
grant all on public.model_usage, public.daily_solves to service_role;
grant select on public.solve_costs to service_role;
revoke all on function public.reserve_daily_solve(uuid, integer) from public, anon, authenticated;
revoke all on function public.daily_model_spend() from public, anon, authenticated;
grant execute on function public.reserve_daily_solve(uuid, integer) to service_role;
grant execute on function public.daily_model_spend() to service_role;

commit;
