-- Error capture and product events (src/lib/telemetry.ts). Apply once in the
-- Supabase SQL editor, or with `supabase db push`. Until it is applied the
-- server still logs every event and error as a JSON line; only these rows
-- are missing. Service role only. No image bytes or problem text are stored.
begin;

create table public.app_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  type text not null check (type in ('event', 'error')),
  name text not null,
  user_id uuid references auth.users(id) on delete set null,
  solve_id text,
  cache_key text,
  technique_id text,
  call text,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  error_name text,
  error_message text,
  error_stack text
);
create index app_events_created_at on public.app_events(created_at);
create index app_events_name_time on public.app_events(name, created_at);
create index app_events_solve on public.app_events(solve_id);

alter table public.app_events enable row level security;
revoke all on public.app_events from anon, authenticated;
grant all on public.app_events to service_role;

commit;
