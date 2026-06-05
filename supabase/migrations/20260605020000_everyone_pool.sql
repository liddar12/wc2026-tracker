-- R16 Phase 4 (#2): the "Everyone" global pool.
--
-- A single public group that every user belongs to automatically, so there is
-- always a default competitive context. groups.created_by is NOT NULL → we seed
-- a dedicated SYSTEM auth user to own it (never deleted).
--
-- Privacy note (accepted): with everyone co-membered, profiles_select_comembers
-- makes all usernames + favorite_team globally readable. profiles holds no PII
-- beyond the public display handle. See docs/48h-readiness/02-ARCHITECTURE.md.
--
-- Idempotent. Safe to re-run.

-- Fixed UUIDs so re-runs and references are stable.
--   system user : 00000000-0000-0000-0000-0000000005ec
--   everyone grp: 00000000-0000-0000-0000-0000000e1e7e

-- 1) System owner in auth.users. GoTrue has several NOT-NULL text columns that
-- default to '' in most versions but not all; set them explicitly so the insert
-- is robust across Supabase versions.
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000005ec',
  'authenticated', 'authenticated', 'system+everyone@wc26.invalid',
  crypt(gen_random_uuid()::text, gen_salt('bf')), now(), now(), now(),
  '{"provider":"system","providers":["system"]}', '{}', false,
  '', '', '', ''
)
on conflict (id) do nothing;

-- 2) A profile for the system user (so FKs / joins are clean). Username must be
--    3-32 chars and unique.
insert into public.profiles (user_id, username)
values ('00000000-0000-0000-0000-0000000005ec', 'WC26')
on conflict (user_id) do nothing;

-- 3) The Everyone group. code matches the ^[a-z]+-[a-z]+-[0-9]{4}$ check.
insert into public.groups (id, name, code, created_by)
values (
  '00000000-0000-0000-0000-0000000e1e7e',
  'Everyone',
  'everyone-public-0000',
  '00000000-0000-0000-0000-0000000005ec'
)
on conflict (id) do nothing;

-- 4) Auto-join: when a profile row is created (the app upserts it right after
--    sign-up), add the user to Everyone. SECURITY DEFINER bypasses the
--    self-insert RLS on group_members cleanly.
create or replace function public.join_everyone_pool()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- CRITICAL: this trigger runs inside the signup → profile-insert path. It must
  -- NEVER be able to block profile creation. Swallow any error so a failed
  -- auto-join can't break sign-up.
  begin
    insert into public.group_members (group_id, user_id)
    values ('00000000-0000-0000-0000-0000000e1e7e', new.user_id)
    on conflict do nothing;
  exception when others then
    null; -- auto-join is best-effort; signup must always succeed
  end;
  return new;
end;
$$;

drop trigger if exists trg_join_everyone on public.profiles;
create trigger trg_join_everyone
  after insert on public.profiles
  for each row execute function public.join_everyone_pool();

-- 5) Backfill every existing user into Everyone (except the system user, which
--    can join too — harmless, but skip to keep the member list clean).
insert into public.group_members (group_id, user_id)
select '00000000-0000-0000-0000-0000000e1e7e', p.user_id
from public.profiles p
where p.user_id <> '00000000-0000-0000-0000-0000000005ec'
on conflict do nothing;
