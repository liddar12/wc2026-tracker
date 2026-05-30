# Plan: Group Finish Order Picker for Pools

Source: Q11–Q14 answers, 2026-05-30.

## Scope

Per FIFA group (A–L), the user predicts:
- **1st place** (group winner)
- **2nd place** (runner-up)
- (3rd and 4th are not individually ranked)

Then across the 12 groups, the user picks the **8 best 3rd-place qualifiers** that advance to R32 (FIFA selects 8 of 12 third-place teams).

Total picks: `12 × 2 + 8 = 32` slots.

## UX flow

### Per-group ordering (drag-to-reorder)

For each of the 12 groups, render a vertical list of the 4 teams in their current predicted order. The user long-presses any row and drags it up or down to repostion. Default order on first visit: composite ranking (already in `data.groupMatchups[X].teams` order, descending by `expected_points`).

```
GROUP A                           [1st, 2nd, 3rd, 4th badges]
┌─────────────────────────────┐
│ 1  🇲🇽 Mexico        ⋮⋮ │ ← drag handle
├─────────────────────────────┤
│ 2  🇨🇿 Czechia       ⋮⋮ │
├─────────────────────────────┤
│ 3  🇰🇷 Korea Rep.    ⋮⋮ │
├─────────────────────────────┤
│ 4  🇿🇦 South Africa  ⋮⋮ │
└─────────────────────────────┘
```

- Slots 1 + 2 are visually accented (gold + silver border).
- Slot 3 has a "Mark as best 3rd?" checkbox once the 4-team order is locked.
- Slot 4 is muted.

### Cross-group "best 3rds" picker

Once all 12 groups are ordered, a second section shows the 12 teams currently slotted as 3rd in their group. The user picks the **8 to advance**:

```
PICK 8 BEST 3RD-PLACE TEAMS                       (6 / 8)

🇰🇷 Korea Rep. (A)    [✓]
🇨🇦 Canada (B)        [✓]
🇲🇦 Morocco (C)       [ ]
... etc 12 rows
```

Checkbox toggles inclusion. Counter shows N/8. Submit disabled until exactly 8 are checked.

### Touch interaction details

- **iOS**: native HTML5 drag-and-drop is unreliable on touch. Use the `Sortable.js` library (small, MIT, ~15KB gz) for cross-platform touch drag. Loaded from esm.sh CDN to keep no-build-step.
- Long-press threshold: 200ms to start drag (avoids accidental drags during scroll).
- Auto-scroll the page when dragging near top/bottom edge.

## Scoring (Q13 answer)

| Outcome | Points |
|---|---|
| Correct 1st place in a group | **3** |
| Correct 2nd place in a group | **2** |
| Correct 3rd-place qualifier in your "best 8" list | **1** |
| **Max total** | **12×3 + 12×2 + 8×1 = 84** |

Combined with weighted bracket scoring (max 96): **180 max total**.

Tie-breakers (in order):
1. Higher group-stage subtotal
2. Higher bracket subtotal
3. Existing bracket tie-breakers (deepest round → champion correct → earliest submit → username)

## Integration with R32 (Q14 answer)

User's group picks **auto-seed their R32**.

```
R32 match 73 (FIFA bracket position):
  Slot "2A" → user's 2nd-place pick from group A
  Slot "2B" → user's 2nd-place pick from group B

R32 match 74:
  Slot "1E" → user's 1st-place pick from group E
  Slot "3 ABCDF" → highest-projected of user's "best 8" picks from {A,B,C,D,F}
```

Implementation:
- `app/views/my-brackets-view.js`'s `buildR32Seeding()` already pulls slot placeholders from `schedule_full.json`. New step: resolve each slot from `userGroupPredictions` instead of accepting placeholder strings.
- If user hasn't completed group predictions, fall back to FIFA default seeding (current behavior) per slot.

## Lock window

Group picks lock at first kickoff of the tournament (same as existing `bracketLocked` window). After lock, picks are read-only. Scoring continues to update as group-stage matches complete.

## Schema (Supabase)

New table `group_predictions`:

```sql
create table public.group_predictions (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- One row per (pool, user). JSON shape:
  --   { "A": ["Mexico","Czechia","Korea Republic","South Africa"],
  --     "B": [...],
  --     ...
  --     "best_thirds": ["Korea Republic","Canada","Morocco", ...8 names] }
  picks       jsonb not null default '{}'::jsonb,
  score       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.group_predictions enable row level security;

create policy "gp_select_pool_members" on public.group_predictions
for select using (public.is_group_member(group_id));

create policy "gp_upsert_self" on public.group_predictions
for insert with check (
  auth.uid() = user_id and public.is_group_member(group_id)
);

create policy "gp_update_self" on public.group_predictions
for update using (auth.uid() = user_id and public.is_group_member(group_id))
with check (auth.uid() = user_id and public.is_group_member(group_id));
```

## Client-side files

- `app/views/group-picker-view.js` (new) — the drag-to-reorder UI
- `app/group-scoring.js` (new) — `scoreGroupPredictions(picks, actualResults)`
- Update `app/views/my-brackets-view.js` — pull from user's group predictions when seeding R32; show submission state of group picks alongside bracket
- Update `app/views/pools-view.js` — `My pools` rows show "Group picks: 24/32 submitted" badge

## Phases

1. **Phase 1 — UI scaffolding** (1 session)
   - Add `/#/group-picks` route
   - Drag-to-reorder list for one group (test with Sortable.js)
   - Best-thirds selector

2. **Phase 2 — Scoring + submission** (1 session)
   - Migration: `group_predictions` table
   - `scoreGroupPredictions()` + tests
   - Submit/upsert flow
   - Leaderboard combines group + bracket scores

3. **Phase 3 — R32 auto-seeding** (1 session)
   - `buildR32Seeding()` reads from group_predictions
   - Cascade: changing a group pick clears the impacted R32 picks
   - UX warning before clearing

## Total LOC estimate
~600 new lines (300 UI, 150 scoring, 50 schema, 100 integration).
