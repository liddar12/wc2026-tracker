-- WC26: group_predictions table for per-pool group-finish picks.
-- Idempotent. Safe to re-run.

create table if not exists public.group_predictions (
  group_id   uuid not null references public.groups(id)   on delete cascade,
  user_id    uuid not null references auth.users(id)      on delete cascade,
  -- JSON shape:
  --   { "A": ["Mexico","Czechia","Korea Republic","South Africa"],
  --     "B": ["...","...","...","..."],
  --     ...
  --     "best_thirds": ["Korea Republic","Canada","Morocco", ...8 names] }
  picks      jsonb not null default '{}'::jsonb,
  score      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists idx_group_predictions_group_id
  on public.group_predictions(group_id);

alter table public.group_predictions enable row level security;

drop policy if exists "gp_select_pool_members" on public.group_predictions;
create policy "gp_select_pool_members" on public.group_predictions
for select
to authenticated
using (public.is_group_member(group_id));

drop policy if exists "gp_insert_self" on public.group_predictions;
create policy "gp_insert_self" on public.group_predictions
for insert
to authenticated
with check (
  auth.uid() = user_id
  and public.is_group_member(group_id)
);

drop policy if exists "gp_update_self" on public.group_predictions;
create policy "gp_update_self" on public.group_predictions
for update
to authenticated
using (
  auth.uid() = user_id
  and public.is_group_member(group_id)
)
with check (
  auth.uid() = user_id
  and public.is_group_member(group_id)
);

grant all on public.group_predictions to authenticated;
