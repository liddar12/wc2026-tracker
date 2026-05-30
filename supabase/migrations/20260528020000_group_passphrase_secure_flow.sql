-- Add secure passphrase handling for private groups.
-- Preview-safe migration: keeps old groups joinable after backfill.

create extension if not exists pgcrypto;

alter table public.groups
  add column if not exists passphrase_hash text,
  add column if not exists passphrase_hint text;

create or replace function public.create_private_group(p_name text, p_code text, p_passphrase text)
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
    raise exception 'Group name is required';
  end if;
  if char_length(trim(coalesce(p_passphrase, ''))) < 8 then
    raise exception 'Passphrase must be at least 8 characters';
  end if;

  insert into public.groups(name, code, created_by, passphrase_hash, passphrase_hint)
  values (
    trim(p_name),
    lower(trim(p_code)),
    auth.uid(),
    crypt(trim(p_passphrase), gen_salt('bf')),
    'set'
  )
  returning * into v_group;

  insert into public.group_members(group_id, user_id)
  values (v_group.id, auth.uid())
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

grant execute on function public.create_private_group(text, text, text) to authenticated;

create or replace function public.join_group_by_code(p_code text, p_passphrase text default null)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
  v_requires_passphrase boolean;
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

  v_requires_passphrase := coalesce(v_group.passphrase_hash, '') <> '';
  if v_requires_passphrase then
    if coalesce(trim(p_passphrase), '') = '' then
      raise exception 'Passphrase required';
    end if;
    if crypt(trim(p_passphrase), v_group.passphrase_hash) <> v_group.passphrase_hash then
      raise exception 'Invalid passphrase';
    end if;
  end if;

  insert into public.group_members(group_id, user_id)
  values (v_group.id, auth.uid())
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

grant execute on function public.join_group_by_code(text, text) to authenticated;
