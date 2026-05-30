-- Fix: anon users hit "permission denied for function is_group_member" when
-- selecting public pools, because Postgres evaluates ALL applicable USING
-- policies for each row visibility check. The existing members-only policy
-- calls is_group_member() which is not granted to anon.
--
-- Fix by restricting the members-only policy to authenticated users only —
-- anon users now only see the public-pool policy.

drop policy if exists "groups_select_members_only" on public.groups;
create policy "groups_select_members_only" on public.groups
for select
to authenticated
using (public.is_group_member(id));

-- (groups_select_public from the prior migration already covers anon + auth.)
