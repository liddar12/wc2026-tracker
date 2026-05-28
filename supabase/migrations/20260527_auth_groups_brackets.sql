-- WC26 auth + private groups + per-group brackets
-- Run in Supabase SQL editor or via supabase migration tooling.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 32),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  code text not null unique check (code ~ '^[a-z]+-[a-z]+-[0-9]{4}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  lock_groups_at timestamptz,
  unlock_bracket_at timestamptz,
  lock_r32_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_brackets (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  picks jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create or replace function public.join_group_by_code(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select *
    into v_group
  from public.groups
  where code = lower(trim(p_code))
  limit 1;

  if not found then
    raise exception 'Invalid code';
  end if;

  insert into public.group_members(group_id, user_id)
  values (v_group.id, auth.uid())
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

grant execute on function public.join_group_by_code(text) to authenticated;

create index if not exists idx_group_members_user_id on public.group_members(user_id);
create index if not exists idx_group_brackets_group_id on public.group_brackets(group_id);

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_brackets enable row level security;

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
for select using (auth.uid() = user_id);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
for insert with check (auth.uid() = user_id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "groups_select_members_only" on public.groups;
create policy "groups_select_members_only" on public.groups
for select using (
  exists (
    select 1 from public.group_members gm
    where gm.group_id = groups.id and gm.user_id = auth.uid()
  )
);

drop policy if exists "groups_insert_authenticated" on public.groups;
create policy "groups_insert_authenticated" on public.groups
for insert with check (auth.uid() = created_by);

drop policy if exists "groups_update_creator_only" on public.groups;
create policy "groups_update_creator_only" on public.groups
for update using (auth.uid() = created_by)
with check (auth.uid() = created_by);

drop policy if exists "group_members_select_group_members" on public.group_members;
create policy "group_members_select_group_members" on public.group_members
for select using (
  exists (
    select 1 from public.group_members gm
    where gm.group_id = group_members.group_id and gm.user_id = auth.uid()
  )
);

drop policy if exists "group_members_insert_self" on public.group_members;
create policy "group_members_insert_self" on public.group_members
for insert with check (auth.uid() = user_id);

drop policy if exists "group_members_delete_none" on public.group_members;
create policy "group_members_delete_none" on public.group_members
for delete using (false);

drop policy if exists "group_brackets_select_group_members" on public.group_brackets;
create policy "group_brackets_select_group_members" on public.group_brackets
for select using (
  exists (
    select 1 from public.group_members gm
    where gm.group_id = group_brackets.group_id and gm.user_id = auth.uid()
  )
);

drop policy if exists "group_brackets_insert_self" on public.group_brackets;
create policy "group_brackets_insert_self" on public.group_brackets
for insert with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.group_members gm
    where gm.group_id = group_brackets.group_id and gm.user_id = auth.uid()
  )
);

drop policy if exists "group_brackets_update_self" on public.group_brackets;
create policy "group_brackets_update_self" on public.group_brackets
for update using (
  auth.uid() = user_id
  and exists (
    select 1 from public.group_members gm
    where gm.group_id = group_brackets.group_id and gm.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.group_members gm
    where gm.group_id = group_brackets.group_id and gm.user_id = auth.uid()
  )
);

grant usage on schema public to anon, authenticated, service_role;
grant all on public.profiles to authenticated;
grant all on public.groups to authenticated;
grant all on public.group_members to authenticated;
grant all on public.group_brackets to authenticated;
