-- Apply once in the Supabase SQL editor, or with `supabase db push`.
begin;

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer text not null,
  method text not null,
  status text not null check (status in ('solved', 'needs_clarification')),
  solution jsonb not null check (jsonb_typeof(solution) = 'object'),
  image_path text not null unique,
  created_at timestamptz not null default now(),
  constraint image_belongs_to_user check (split_part(image_path, '/', 1) = user_id::text)
);
create index problems_user_created on public.problems(user_id, created_at desc, id desc);
alter table public.problems enable row level security;
revoke all on public.problems from anon, authenticated;
grant select on public.problems to authenticated;
grant all on public.problems to service_role;
create policy "Read own problems" on public.problems for select to authenticated
  using ((select auth.uid()) = user_id);

-- A bounded row per account; no growing request log and no daily cap.
create table public.solve_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  admitted_at timestamptz[] not null default '{}'
);
alter table public.solve_rate_limits enable row level security;
revoke all on public.solve_rate_limits from anon, authenticated;
grant all on public.solve_rate_limits to service_role;

create function public.reserve_solve(p_user_id uuid)
returns table(allowed boolean, retry_after integer)
language plpgsql security definer set search_path = ''
as $$
declare
  attempts timestamptz[];
  current_time_utc timestamptz;
begin
  insert into public.solve_rate_limits(user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  -- Row locking makes this limit atomic across tabs and server instances.
  select admitted_at into attempts from public.solve_rate_limits
    where user_id = p_user_id for update;
  current_time_utc := clock_timestamp();
  select coalesce(array_agg(t order by t), '{}'::timestamptz[]) into attempts
    from unnest(attempts) as t where t > current_time_utc - interval '60 seconds';
  if cardinality(attempts) >= 3 then
    return query select false, greatest(1, ceil(extract(epoch from
      (attempts[1] + interval '60 seconds' - current_time_utc)))::integer);
    return;
  end if;
  update public.solve_rate_limits
    set admitted_at = array_append(attempts, current_time_utc)
    where user_id = p_user_id;
  return query select true, 0;
end;
$$;
revoke all on function public.reserve_solve(uuid) from public, anon, authenticated;
grant execute on function public.reserve_solve(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('problem-images', 'problem-images', false, 8388608,
  array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 8388608,
  allowed_mime_types = excluded.allowed_mime_types;
-- Only the server uploads. Signed image URLs can only be created by the owner.
create policy "Read own problem images" on storage.objects for select to authenticated
  using (bucket_id = 'problem-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
