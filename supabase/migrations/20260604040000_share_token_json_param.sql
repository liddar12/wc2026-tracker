-- R15: create_share_token(p_payload jsonb) was unresolvable via PostgREST
-- (42883) while get_shared_bracket(text) worked — PostgREST binds an inbound
-- JSON object as `json`, and json->jsonb is NOT an implicit cast in function
-- overload resolution, so create_share_token(jsonb) never matched. Declare the
-- param as `json` and cast to jsonb inside.

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

create function public.create_share_token(p_payload json)
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
  insert into shared_brackets(token, payload) values (v_token, p_payload::jsonb);
  return jsonb_build_object('token', v_token);
end;
$$;

revoke all on function public.create_share_token(json) from public;
grant execute on function public.create_share_token(json) to anon, authenticated;

notify pgrst, 'reload schema';
