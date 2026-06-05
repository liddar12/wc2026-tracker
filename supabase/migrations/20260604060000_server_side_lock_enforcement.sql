-- R15b (#21): SERVER-SIDE LOCK ENFORCEMENT  ·  DRAFT — review before applying.
--
-- Today the only thing stopping a user from editing picks after kickoff is the
-- client (`deriveLockState` in app/competition-rules.js). A user with the
-- network tab open could POST to group_predictions / group_brackets after the
-- group stage or knockout lock and overwrite their picks. This migration adds
-- a server-side gate as DEFENSE IN DEPTH — the client lock UI stays exactly as
-- is; this just makes the database refuse out-of-window writes.
--
-- The DB has no schedule table, so the three phase boundaries are stored in a
-- single-row config table (seeded below with the real WC26 kickoff times pulled
-- from data/schedule_full.json). `lock_state_now()` mirrors deriveLockState()
-- 1:1 so client and server agree on the phase.
--
-- Idempotent. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Config: the three boundaries deriveLockState() needs.
-- ---------------------------------------------------------------------------
create table if not exists public.tournament_config (
  id                  boolean primary key default true check (id),  -- single-row guard
  first_group_kickoff timestamptz not null,
  last_group_kickoff  timestamptz not null,
  first_r32_kickoff   timestamptz not null,
  -- group stage is considered "live" until 2h after the last group kickoff,
  -- matching deriveLockState's `groupEnds = groupLastKickoff + 2h`.
  group_end_grace     interval not null default interval '2 hours',
  updated_at          timestamptz not null default now()
);

-- Seed (or refresh) the single row with the real WC26 boundaries.
-- firstGroup 2026-06-11T19:00Z · lastGroup 2026-06-28T02:00Z · firstR32 2026-06-28T19:00Z
insert into public.tournament_config
  (id, first_group_kickoff, last_group_kickoff, first_r32_kickoff)
values
  (true, '2026-06-11T19:00:00Z', '2026-06-28T02:00:00Z', '2026-06-28T19:00:00Z')
on conflict (id) do update set
  first_group_kickoff = excluded.first_group_kickoff,
  last_group_kickoff  = excluded.last_group_kickoff,
  first_r32_kickoff   = excluded.first_r32_kickoff,
  updated_at          = now();

-- Config is server-only; clients derive their own lock from the schedule JSON.
revoke all on table public.tournament_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. lock_state_now(): the single source of truth, mirroring deriveLockState.
-- ---------------------------------------------------------------------------
-- Returns one row: (groups_locked, bracket_locked, phase).
-- Phases match the client exactly:
--   pre-tournament          → nothing locked
--   group-stage-live        → groups + bracket locked
--   between-group-and-r32   → groups locked, bracket OPEN (the 15h gap window)
--   r32-live                → groups + bracket locked
create or replace function public.lock_state_now(p_now timestamptz default now())
returns table (groups_locked boolean, bracket_locked boolean, phase text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.tournament_config%rowtype;
  v_group_end timestamptz;
begin
  select * into c from public.tournament_config where id limit 1;
  if not found then
    -- No config → fail OPEN (never block writes on a misconfigured DB).
    return query select false, false, 'pre-tournament'::text;
    return;
  end if;

  v_group_end := c.last_group_kickoff + c.group_end_grace;

  if p_now < c.first_group_kickoff then
    return query select false, false, 'pre-tournament'::text;
  elsif p_now >= c.first_group_kickoff and p_now <= v_group_end then
    return query select true, true, 'group-stage-live'::text;
  elsif p_now > v_group_end and p_now < c.first_r32_kickoff then
    return query select true, false, 'between-group-and-r32'::text;
  else -- p_now >= first_r32_kickoff
    return query select true, true, 'r32-live'::text;
  end if;
end;
$$;

grant execute on function public.lock_state_now(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Triggers that reject writes during the relevant lock window.
-- ---------------------------------------------------------------------------
-- group_predictions: blocked whenever groups are locked.
create or replace function public.enforce_group_predictions_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_groups_locked boolean;
  v_phase text;
begin
  select groups_locked, phase into v_groups_locked, v_phase from public.lock_state_now();
  if v_groups_locked then
    raise exception 'Group picks are locked (%). Predictions cannot be changed in this phase.', v_phase
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_group_predictions_lock on public.group_predictions;
create trigger trg_group_predictions_lock
  before insert or update on public.group_predictions
  for each row execute function public.enforce_group_predictions_lock();

-- group_brackets: blocked whenever the bracket is locked.
create or replace function public.enforce_group_brackets_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bracket_locked boolean;
  v_phase text;
begin
  select bracket_locked, phase into v_bracket_locked, v_phase from public.lock_state_now();
  if v_bracket_locked then
    raise exception 'Bracket is locked (%). Knockout picks cannot be changed in this phase.', v_phase
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_group_brackets_lock on public.group_brackets;
create trigger trg_group_brackets_lock
  before insert or update on public.group_brackets
  for each row execute function public.enforce_group_brackets_lock();

-- ---------------------------------------------------------------------------
-- Notes for review:
--   * Defense in depth: the client still owns the UX (disabled buttons, lock
--     banners). This only matters for a hand-crafted request.
--   * Fails OPEN if tournament_config is missing — never bricks writes.
--   * `score` is also written to these tables by the scoring job. If a future
--     server-side scorer needs to update `score` AFTER lock, give it a
--     SECURITY DEFINER function that sets a session flag the trigger checks, or
--     scope the trigger to skip when `OLD.picks IS NOT DISTINCT FROM NEW.picks`.
--     (Left strict here so the review can decide the scorer's write path.)
