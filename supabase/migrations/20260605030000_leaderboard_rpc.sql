-- R16 Phase 4 (#3): paginated, server-ranked leaderboard RPC.
--
-- The client fetchLeaderboard pulls every row and recomputes per-device — fine
-- for small pools, fatal for "Everyone". This RPC ranks server-side by the
-- stored combined score (group_predictions.score + group_brackets.score, kept
-- fresh by the scorer) and paginates, so the client fetches one bounded page.
--
-- Membership-guarded: only members of the pool can read its leaderboard
-- (matches the existing RLS posture; SECURITY DEFINER bypasses RLS so we guard
-- explicitly).
--
-- Idempotent. Safe to re-run.

create or replace function public.leaderboard(
  p_group_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  group_score int,
  knockout_score int,
  total int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'Not a member of this pool' using errcode = 'insufficient_privilege';
  end if;

  return query
  with members as (
    select gp.user_id from public.group_predictions gp where gp.group_id = p_group_id
    union
    select gb.user_id from public.group_brackets gb where gb.group_id = p_group_id
  ),
  scored as (
    select
      m.user_id,
      coalesce(gp.score, 0) as group_score,
      coalesce(gb.score, 0) as knockout_score,
      coalesce(gp.score, 0) + coalesce(gb.score, 0) as total
    from members m
    left join public.group_predictions gp
      on gp.group_id = p_group_id and gp.user_id = m.user_id
    left join public.group_brackets gb
      on gb.group_id = p_group_id and gb.user_id = m.user_id
  )
  select
    row_number() over (order by s.total desc, s.knockout_score desc) as rank,
    s.user_id,
    coalesce(p.username, 'Player') as username,
    s.group_score,
    s.knockout_score,
    s.total
  from scored s
  left join public.profiles p on p.user_id = s.user_id
  order by s.total desc, s.knockout_score desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

grant execute on function public.leaderboard(uuid, int, int) to authenticated;

-- Indexes that keep the join + ranking cheap at Everyone-pool scale.
create index if not exists idx_group_predictions_group_user on public.group_predictions(group_id, user_id);
create index if not exists idx_group_brackets_group_user on public.group_brackets(group_id, user_id);
