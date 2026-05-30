-- Fix infinite recursion in group_members RLS (self-referential EXISTS).

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.group_members
    where group_id = p_group_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_group_member(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;

drop policy if exists "groups_select_members_only" on public.groups;
create policy "groups_select_members_only" on public.groups
for select using (public.is_group_member(id));

drop policy if exists "group_members_select_group_members" on public.group_members;
create policy "group_members_select_group_members" on public.group_members
for select using (public.is_group_member(group_id));

drop policy if exists "group_brackets_select_group_members" on public.group_brackets;
create policy "group_brackets_select_group_members" on public.group_brackets
for select using (public.is_group_member(group_id));

drop policy if exists "group_brackets_insert_self" on public.group_brackets;
create policy "group_brackets_insert_self" on public.group_brackets
for insert with check (
  auth.uid() = user_id
  and public.is_group_member(group_id)
);

drop policy if exists "group_brackets_update_self" on public.group_brackets;
create policy "group_brackets_update_self" on public.group_brackets
for update using (
  auth.uid() = user_id
  and public.is_group_member(group_id)
)
with check (
  auth.uid() = user_id
  and public.is_group_member(group_id)
);
