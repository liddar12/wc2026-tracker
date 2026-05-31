-- WC26: persist favorite team server-side on profiles
-- Idempotent. Safe to re-run.

alter table public.profiles
  add column if not exists favorite_team text;

-- Length cap to match data/teams.json team names (USA up to longest known).
alter table public.profiles
  drop constraint if exists profiles_favorite_team_check;
alter table public.profiles
  add constraint profiles_favorite_team_check
  check (favorite_team is null or char_length(favorite_team) between 2 and 40);

-- RLS: users can read + update only their own row (already covered by
-- existing profiles_select_self / profiles_update_self policies).
