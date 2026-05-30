# Apply the Pools Migration — Step-by-Step

This is the one piece of work you have to do by hand. Takes about **30 seconds**.

## What this does

- Drops the passphrase requirement on groups (no more 8-character passphrases).
- Adds a `visibility` column so pools can be **public** or **private**.
- Adds new RPC functions the new app uses: `create_pool`, `join_pool_by_code`, `join_pool_by_name`.
- Backfills your existing groups as **private** (and clears their old passphrase hashes so they're still joinable by code).
- Keeps the legacy `create_private_group` / `join_group_by_code(p_code, p_passphrase)` RPCs alive as no-op shims, so any older client builds still work.

It is **idempotent** — safe to run more than once.

---

## Step 1 — Open the Supabase SQL editor

Open this URL in your browser (it's pre-filled to your project's SQL editor):

> **https://supabase.com/dashboard/project/vodjwymxquuertmhtvuw/sql/new**

If you're not already signed into Supabase, sign in with the account that owns the `vodjwymxquuertmhtvuw` project. You'll land on a blank query window titled **"New SQL Editor"**.

## Step 2 — Open the migration file on your machine

The SQL file is at:

```
/Users/jimmyliddar/Downloads/wc2026-tracker-main/supabase/migrations/20260530_pools_visibility.sql
```

You can either:

- Open it in your editor (`open -t supabase/migrations/20260530_pools_visibility.sql` from the repo root), **or**
- Copy it to the clipboard in one shot:
  ```bash
  pbcopy < /Users/jimmyliddar/Downloads/wc2026-tracker-main/supabase/migrations/20260530_pools_visibility.sql
  ```
  After this command finishes (no output is expected), the entire file is on your clipboard.

## Step 3 — Paste + run

1. Click anywhere in the Supabase SQL editor's text area.
2. Paste (⌘V on Mac).
3. Click the green **Run** button in the top-right of the editor (or press ⌘↵ / Ctrl+Enter).

You should see a success bar at the bottom that reads **"Success. No rows returned."** (the migration is all DDL — it creates/alters structures, it doesn't return rows).

## Step 4 — Verify (optional but recommended)

Paste this single verification query into a new SQL editor tab and Run:

```sql
select
  (select count(*) from public.groups where visibility = 'public')  as public_pools,
  (select count(*) from public.groups where visibility = 'private') as private_pools,
  (select count(*) from public.groups where passphrase_hash is not null) as still_has_passphrase,
  (select count(*) from pg_proc where proname = 'create_pool')      as has_create_pool_rpc,
  (select count(*) from pg_proc where proname = 'join_pool_by_code') as has_join_by_code_rpc,
  (select count(*) from pg_proc where proname = 'join_pool_by_name') as has_join_by_name_rpc;
```

Expected result:

| public_pools | private_pools | still_has_passphrase | has_create_pool_rpc | has_join_by_code_rpc | has_join_by_name_rpc |
|--:|--:|--:|--:|--:|--:|
| 0 | N (your existing group count) | 0 | 1 | 1 | 1 |

If any of the `has_*_rpc` columns shows `0`, the migration didn't run — try again.

## Step 5 — Tell me you're done

Reply "migration applied" (or paste the verification table above if you ran step 4). I'll re-run automated tests + deploy preview against the new schema.

---

## Rollback (if anything looks wrong)

The migration is purely additive except for clearing passphrase hashes. If you need to undo:

```sql
drop function if exists public.create_pool(text, text);
drop function if exists public.join_pool_by_code(text);
drop function if exists public.join_pool_by_name(text);
drop index if exists public.groups_private_name_lower_uniq;
alter table public.groups drop constraint if exists groups_visibility_check;
alter table public.groups drop column if exists visibility;
```

That returns the schema to its pre-migration state (minus the cleared passphrase hashes, which can be re-set on the old RPC).
