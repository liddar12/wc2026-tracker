-- QA advisor fixes for the auth/private-groups/brackets feature.
-- Addresses Supabase advisor findings introduced by:
--   20260527_auth_groups_brackets.sql
--   20260528_fix_group_members_rls.sql
-- Idempotent and forward-only (does not rewrite migration history).

-- 1) Performance: add covering indexes for foreign keys flagged by
--    lint 0001_unindexed_foreign_keys.
create index if not exists idx_groups_created_by on public.groups(created_by);
create index if not exists idx_group_brackets_user_id on public.group_brackets(user_id);

-- 2) Security: keep the SECURITY DEFINER helpers callable only by signed-in
--    users (lint 0028). Execute for `authenticated` is intentional: is_group_member
--    is used inside RLS policies and join_group_by_code is the join RPC.
revoke execute on function public.is_group_member(uuid) from anon, public;
revoke execute on function public.join_group_by_code(text) from anon, public;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;

-- 3) Performance: wrap auth.uid() in a scalar subselect so it is evaluated once
--    per query instead of once per row (lint 0003_auth_rls_initplan).
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
for select using ((select auth.uid()) = user_id);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
for insert with check ((select auth.uid()) = user_id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
for update using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "groups_insert_authenticated" on public.groups;
create policy "groups_insert_authenticated" on public.groups
for insert with check ((select auth.uid()) = created_by);

drop policy if exists "groups_update_creator_only" on public.groups;
create policy "groups_update_creator_only" on public.groups
for update using ((select auth.uid()) = created_by)
with check ((select auth.uid()) = created_by);

drop policy if exists "group_members_insert_self" on public.group_members;
create policy "group_members_insert_self" on public.group_members
for insert with check ((select auth.uid()) = user_id);

drop policy if exists "group_brackets_insert_self" on public.group_brackets;
create policy "group_brackets_insert_self" on public.group_brackets
for insert with check (
  (select auth.uid()) = user_id
  and public.is_group_member(group_id)
);

drop policy if exists "group_brackets_update_self" on public.group_brackets;
create policy "group_brackets_update_self" on public.group_brackets
for update using (
  (select auth.uid()) = user_id
  and public.is_group_member(group_id)
)
with check (
  (select auth.uid()) = user_id
  and public.is_group_member(group_id)
);
