-- Pre-flight verdicts: whether each cached method's calculator rows ran
-- cleanly in a real Desmos instance. Cached with the entry so a cache hit
-- never re-runs candidate pre-flight, re-selection, or the Desmos retry.
-- First writer wins, like explanations. Apply once in the Supabase SQL
-- editor, or with `supabase db push`. Only the server (service role) reads
-- or writes it. Until it is applied, solves still work: every browser runs
-- pre-flight itself and nothing unverified is shown.
begin;

create table public.solve_cache_preflight (
  cache_key text not null references public.solve_cache(cache_key) on delete cascade,
  method_id text not null,
  verdict jsonb not null check (jsonb_typeof(verdict) = 'object'),
  created_at timestamptz not null default now(),
  primary key (cache_key, method_id)
);

alter table public.solve_cache_preflight enable row level security;
revoke all on public.solve_cache_preflight from anon, authenticated;
grant all on public.solve_cache_preflight to service_role;

commit;
