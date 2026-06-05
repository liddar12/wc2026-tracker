-- R15: create_share_token was unresolvable via PostgREST (error 42883) even
-- after 20260604010000 applied, while get_shared_bracket (same migration)
-- resolved fine. Cause: a leftover create_share_token overload (likely from
-- the pre-migration loose supabase/sql/ era) made PostgREST's named-arg bind
-- ambiguous. Drop EVERY overload by name, recreate one clean jsonb version,
-- and force a PostgREST schema reload.

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
set search_path = public
as $$
declare
  v_token text;
begin
  v_token := translate(encode(gen_random_bytes(8), 'base64'), '+/=', '-_');
  v_token := substring(v_token from 1 for 10);
  insert into shared_brackets(token, payload) values (v_token, p_payload);
  return jsonb_build_object('token', v_token);
end;
$$;

revoke all on function public.create_share_token(jsonb) from public;
grant execute on function public.create_share_token(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
