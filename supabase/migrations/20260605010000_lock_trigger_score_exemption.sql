-- R16 Phase 4 (#1): allow score-only updates during lock.
--
-- The R16a lock triggers (20260604060000) reject ALL inserts/updates to
-- group_predictions / group_brackets while a phase is locked. But the
-- authoritative scorer must update the `score` column AFTER picks lock, as real
-- results arrive. Rather than a security-sensitive bypass flag, we exempt
-- updates that DON'T change `picks` — the scorer only ever writes `score`, so
-- its writes pass; a user trying to change picks during lock is still blocked.
--
-- Idempotent. Safe to re-run.

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
  -- Score-only update (picks unchanged) is always allowed — this is the scorer.
  if tg_op = 'UPDATE' and new.picks is not distinct from old.picks then
    return new;
  end if;
  select groups_locked, phase into v_groups_locked, v_phase from public.lock_state_now();
  if v_groups_locked then
    raise exception 'Group picks are locked (%). Predictions cannot be changed in this phase.', v_phase
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

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
  -- Score-only update (picks unchanged) is always allowed — this is the scorer.
  if tg_op = 'UPDATE' and new.picks is not distinct from old.picks then
    return new;
  end if;
  select bracket_locked, phase into v_bracket_locked, v_phase from public.lock_state_now();
  if v_bracket_locked then
    raise exception 'Bracket is locked (%). Knockout picks cannot be changed in this phase.', v_phase
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Triggers themselves are unchanged (still BEFORE INSERT OR UPDATE from the
-- 20260604060000 migration); only the function bodies gain the score-only skip.
