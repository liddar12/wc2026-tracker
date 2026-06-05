-- R15 (definitive): create_share_token returned 42883 — NOT a resolution or
-- param-type issue. The error is raised INSIDE the body: Supabase installs
-- pgcrypto in the `extensions` schema, but the function set search_path=public,
-- so gen_random_bytes() was undefined. get_shared_bracket worked because it
-- never calls pgcrypto. Fix: restore the correct jsonb param and include
-- `extensions` on the search_path. Also harden the token to gen_random_uuid()
-- (pg_catalog, always available) so it can't regress on pgcrypto placement.

do $$
declare r record;
begin
  for r in
    select oid::regprocedure as sig
    from pg_proc
    where proname = 'create_share_token'
      and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;

create function public.create_share_token(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  -- gen_random_uuid() is in pg_catalog (always on the path); take a 10-char
  -- base32-ish slice for a short, URL-safe token.
  v_token := replace(substring(gen_random_uuid()::text from 1 for 13), '-', '');
  insert into shared_brackets(token, payload) values (v_token, p_payload);
  return jsonb_build_object('token', v_token);
end;
$$;

revoke all on function public.create_share_token(jsonb) from public;
grant execute on function public.create_share_token(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
