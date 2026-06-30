-- DRAFT — review, then apply to prod (vodjwymxquuertmhtvuw) via SQL editor.
-- RJ30-3 (RJ30-B): Web Push subscriptions + per-team prefs, and a
-- service-role-only send-state ledger for goal/kickoff de-duplication.
-- NOT auto-applied. Matches the convention of 20260611120000_protect_score_columns.sql.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  -- prefs: what to notify on. favorite_team is read from profiles at send time,
  -- but we snapshot the followed teams here so a guest-then-signin or
  -- multi-device case stays sane.
  notify_goals     boolean not null default true,
  notify_kickoffs  boolean not null default true,
  -- canonical team names; empty/null => fall back to profiles.favorite_team
  teams       jsonb not null default '[]'::jsonb,
  quiet_start smallint,   -- local hour 0-23 (nullable = no quiet hours)
  quiet_end   smallint,
  tz_offset   smallint default 0,  -- minutes east of UTC, for quiet-hours math
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy "own_subscriptions_select" on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy "own_subscriptions_insert" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "own_subscriptions_update" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_subscriptions_delete" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions(user_id);

-- Service-role-only de-dup ledger: which (match_id, kind) we've already pushed,
-- and how many goals (seq) for that match. No RLS policies for normal users =>
-- only the service key (which bypasses RLS) can touch it.
create table if not exists public.push_notify_state (
  match_id   text not null,
  kind       text not null,              -- 'goal' | 'kickoff'
  seq        integer not null default 0, -- goal count already sent (goals); 0 for kickoff
  sent_at    timestamptz not null default now(),
  primary key (match_id, kind)
);
alter table public.push_notify_state enable row level security;
-- intentionally NO policies: authenticated/anon get zero access; service_role bypasses RLS.
