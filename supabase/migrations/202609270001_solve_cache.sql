-- Determinism cache for solves: the same problem returns the same methods,
-- order, and default every time. Apply once in the Supabase SQL editor, or
-- with `supabase db push`. Only the server (service role) reads or writes it.
begin;

-- One entry per normalized problem + prompt configuration version. The entry
-- holds every candidate (rows, costs, badges, math level, rejections) and the
-- winner id. cache_key embeds prompt_config_version, so a prompt, library,
-- weight, or vocabulary change is a new key and the problem regenerates.
create table public.solve_cache (
  cache_key text primary key,
  prompt_config_version text not null,
  entry jsonb not null check (jsonb_typeof(entry) = 'object'),
  created_at timestamptz not null default now()
);
create index solve_cache_version on public.solve_cache(prompt_config_version);

-- An identical re-submission (same image bytes or same problem text) maps
-- straight to its entry without an extraction call.
create table public.solve_cache_inputs (
  input_hash text not null,
  prompt_config_version text not null,
  cache_key text not null references public.solve_cache(cache_key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (input_hash, prompt_config_version)
);

-- Explanations are generated on demand per method and cached; first writer wins.
create table public.solve_cache_explanations (
  cache_key text not null references public.solve_cache(cache_key) on delete cascade,
  method_id text not null,
  explanation jsonb not null check (jsonb_typeof(explanation) = 'object'),
  created_at timestamptz not null default now(),
  primary key (cache_key, method_id)
);

alter table public.solve_cache enable row level security;
alter table public.solve_cache_inputs enable row level security;
alter table public.solve_cache_explanations enable row level security;
revoke all on public.solve_cache, public.solve_cache_inputs, public.solve_cache_explanations
  from anon, authenticated;
grant all on public.solve_cache, public.solve_cache_inputs, public.solve_cache_explanations
  to service_role;

commit;
