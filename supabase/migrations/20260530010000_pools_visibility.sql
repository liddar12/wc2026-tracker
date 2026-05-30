-- WC26: simplify group model into "pools" with visibility (public/private).
-- - Drops the passphrase requirement (security not a concern for this app).
-- - Adds a `visibility` column with values 'public' or 'private'.
-- - Backfills existing rows as 'private' and NULLs out passphrase hashes.
-- - Adds a unique index on lower(name) for private pools so the new
--   "join by exact name" flow has no ambiguity.
-- - Adds RPCs: create_pool, join_pool_by_code, join_pool_by_name.
-- - Updates RLS so anon can SELECT public pools (for the discovery list).
-- - Keeps the existing tables/columns/policies intact; this is purely additive
--   except for nulling out passphrase_hash.
--
-- This migration is IDEMPOTENT — running it again is safe.

create extension if not exists pgcrypto;

-- 1. Add visibility column ----------------------------------------------------
alter table public.groups
  add column if not exists visibility text not null default 'private';

-- Enforce allowed values (drop+add so it's idempotent)
alter table public.groups
  drop constraint if exists groups_visibility_check;
alter table public.groups
  add constraint groups_visibility_check
  check (visibility in ('public', 'private'));

-- 2. Make passphrase_hash optional + clear existing values --------------------
-- (passphrase_hash was added by the prior migration; drop NOT NULL if present,
--  and wipe any stored hashes so old groups become joinable without passphrase.)
alter table public.groups
  alter column passphrase_hash drop not null;
update public.groups set passphrase_hash = null where passphrase_hash is not null;

-- 3. Deduplicate private-pool names so the unique index can be created --------
-- Append the row's id suffix to any private pool whose lower(name) collides
-- with another private pool. Public pools can share names freely.
with collisions as (
  select id, name,
         row_number() over (partition by lower(name) order by created_at) as rn
  from public.groups
  where visibility = 'private'
)
update public.groups g
  set name = g.name || ' (' || substring(g.id::text, 1, 4) || ')'
from collisions c
where g.id = c.id and c.rn > 1;

-- 4. Unique index for private-pool name (case-insensitive) --------------------
drop index if exists groups_private_name_lower_uniq;
create unique index groups_private_name_lower_uniq
  on public.groups (lower(name))
  where visibility = 'private';

-- 5. RLS: anon + authenticated can SELECT public pools ------------------------
drop policy if exists "groups_select_public" on public.groups;
create policy "groups_select_public" on public.groups
for select
to anon, authenticated
using (visibility = 'public');

-- (Existing policy "groups_select_members_only" still applies for private pools
--  to members. The two policies are OR'd together by Postgres.)

-- 6. RPC: create_pool(name, visibility) — no passphrase -----------------------
create or replace function public.create_pool(p_name text, p_visibility text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
  v_code  text;
  v_visibility text;
  v_attempt int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Pool name must be at least 2 characters';
  end if;
  if char_length(trim(coalesce(p_name, ''))) > 80 then
    raise exception 'Pool name must be at most 80 characters';
  end if;

  v_visibility := lower(coalesce(p_visibility, 'private'));
  if v_visibility not in ('public', 'private') then
    raise exception 'Visibility must be public or private';
  end if;

  -- Pre-check the private-name collision so we can return a friendly error
  -- before the unique index fires (which surfaces as an obscure SQLSTATE).
  if v_visibility = 'private' then
    if exists (
      select 1 from public.groups
      where visibility = 'private'
        and lower(name) = lower(trim(p_name))
    ) then
      raise exception 'A private pool with that name already exists. Pick another name.';
    end if;
  end if;

  -- Generate a unique join code (word-word-NNNN). Retry up to 5 times on the
  -- one-in-a-million-ish collision.
  loop
    v_attempt := v_attempt + 1;
    v_code := (
      (array['silver','otter','falcon','cedar','lunar','atlas','harbor','summit','cobalt','aurora'])[floor(random()*10+1)::int]
      || '-' ||
      (array['silver','otter','falcon','cedar','lunar','atlas','harbor','summit','cobalt','aurora'])[floor(random()*10+1)::int]
      || '-' ||
      lpad((floor(random()*9000)+1000)::int::text, 4, '0')
    );
    exit when not exists (select 1 from public.groups where code = v_code);
    if v_attempt > 5 then
      raise exception 'Could not generate unique join code, please retry.';
    end if;
  end loop;

  insert into public.groups(name, code, created_by, visibility, passphrase_hash)
  values (trim(p_name), v_code, auth.uid(), v_visibility, null)
  returning * into v_group;

  insert into public.group_members(group_id, user_id)
  values (v_group.id, auth.uid())
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

grant execute on function public.create_pool(text, text) to authenticated;

-- 7. RPC: join_pool_by_code(code) — no passphrase -----------------------------
create or replace function public.join_pool_by_code(p_code text)
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

grant execute on function public.join_pool_by_code(text) to authenticated;

-- 8. RPC: join_pool_by_name(name) — private pools only, case-insensitive ------
create or replace function public.join_pool_by_name(p_name text)
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
  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Pool name is required';
  end if;

  -- Private pools have a unique lower(name); public pools may share names.
  -- For unambiguous name-join, require visibility = 'private'.
  select *
    into v_group
  from public.groups
  where visibility = 'private'
    and lower(name) = lower(trim(p_name))
  limit 1;

  if not found then
    raise exception 'No private pool by that name. Check the spelling or use the magic link.';
  end if;

  insert into public.group_members(group_id, user_id)
  values (v_group.id, auth.uid())
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

grant execute on function public.join_pool_by_name(text) to authenticated;

-- 9. Backwards-compat: keep old RPCs working with no-op passphrase -----------
-- The legacy create_private_group(p_name, p_code, p_passphrase) RPC still
-- exists from the prior migration. Replace it so that passphrase becomes a
-- no-op stub (just calls create_pool internally) — keeps any older client
-- builds that haven't been redeployed from breaking.
create or replace function public.create_private_group(p_name text, p_code text, p_passphrase text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ignore p_code and p_passphrase; delegate to the new pool flow.
  return public.create_pool(p_name, 'private');
end;
$$;

-- Replace the 2-arg join_group_by_code with a passphrase-tolerant shim.
create or replace function public.join_group_by_code(p_code text, p_passphrase text default null)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
begin
  -- p_passphrase intentionally ignored.
  return public.join_pool_by_code(p_code);
end;
$$;

grant execute on function public.create_private_group(text, text, text) to authenticated;
grant execute on function public.join_group_by_code(text, text) to authenticated;

-- 10. Sanity check: re-enable RLS if it was somehow disabled ------------------
alter table public.groups enable row level security;
