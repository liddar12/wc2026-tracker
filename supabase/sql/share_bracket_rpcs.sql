-- A8 shareable bracket RPCs.
-- Run these on the Supabase project to enable token-backed share links.
-- The table is public-readable via the RPC only — no direct SELECT grant.

create extension if not exists pgcrypto;

create table if not exists shared_brackets (
  token text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  -- soft expiry: 90 days; cron can purge older rows if desired
  expires_at timestamptz default (now() + interval '90 days')
);

revoke all on table shared_brackets from anon, authenticated;

-- Generate a short token + insert a snapshot. Returns the token as JSON.
create or replace function public.create_share_token(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  -- 10-char base64url token; collision-resistant enough for this volume.
  v_token := translate(encode(gen_random_bytes(8), 'base64'), '+/=', '-_');
  v_token := substring(v_token from 1 for 10);
  insert into shared_brackets(token, payload) values (v_token, p_payload);
  return jsonb_build_object('token', v_token);
end;
$$;

grant execute on function public.create_share_token(jsonb) to anon, authenticated;

-- Read snapshot by token.
create or replace function public.get_shared_bracket(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row shared_brackets%rowtype;
begin
  select * into v_row from shared_brackets
    where token = p_token and (expires_at is null or expires_at > now())
    limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'payload', v_row.payload,
    'created_at', v_row.created_at
  );
end;
$$;

grant execute on function public.get_shared_bracket(text) to anon, authenticated;
