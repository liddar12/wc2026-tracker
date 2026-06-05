-- R15: leaderboard opponents rendered as the literal "Player" because the
-- only profiles SELECT policy was self-only (profiles_select_self:
-- auth.uid() = user_id). The leaderboard fetches opponents' usernames via
-- .in('user_id', ids) and RLS filtered them all out.
--
-- Fix: a SECURITY DEFINER helper (mirrors is_group_member) lets us check
-- "does the requester share any pool with this user" WITHOUT recursing into
-- group_members RLS, then a read policy exposes username + favorite_team of
-- pool co-members. Usernames are public display handles by design.

create or replace function public.shares_group_with(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.group_members gm_self
    join public.group_members gm_other
      on gm_other.group_id = gm_self.group_id
    where gm_self.user_id = auth.uid()
      and gm_other.user_id = p_user
  );
$$;

revoke all on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.shares_group_with(uuid) to authenticated;

drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_select_comembers" on public.profiles;
create policy "profiles_select_comembers" on public.profiles
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or public.shares_group_with(user_id)
);
