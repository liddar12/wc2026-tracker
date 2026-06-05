-- R16 hotfix: Everyone-pool visibility + reconcile the duplicate.
--
-- Bug: the seeded Everyone pool (20260605020000) was inserted without a
-- `visibility` value, so it took the column default 'private' → it was NOT
-- discoverable/joinable, while the auto-join trigger still added every new user
-- to it. Meanwhile an older, manually-created public "Everyone" (otter-otter-7670)
-- existed, so there were two competing pools.
--
-- Fix (a): make the seeded Everyone PUBLIC (the canonical one; the client's
--          EVERYONE_GROUP_ID + auto-join trigger already target it).
-- Fix (b): retire the legacy manual Everyone — rename + make private so it is no
--          longer a competing public default. NON-destructive (its members/data
--          are preserved; it was not created by this project's migrations).
--
-- Idempotent. Safe to re-run. Also makes a fresh apply correct (runs after the
-- seed and flips it public).

-- (a) Canonical Everyone → public.
update public.groups
  set visibility = 'public'
  where id = '00000000-0000-0000-0000-0000000e1e7e';

-- (b) Retire the legacy manual Everyone (guarded by BOTH id and code so we only
--     ever touch that exact pre-existing pool; no-op if it isn't present).
update public.groups
  set visibility = 'private',
      name = 'Everyone (legacy)'
  where id = '2e664920-a132-493e-9c7f-d4d0d665c2a9'
    and code = 'otter-otter-7670';
