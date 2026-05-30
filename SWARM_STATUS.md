# SWARM Status Board

- Branch: `feature/auth-private-groups-brackets`
- Updated: `2026-05-27` (resume after pipeline abort)

| Swarm name | Iteration | % Complete | % Passed | Current focus | Last updated |
|---|---:|---:|---:|---|---|
| Auth + private groups + brackets | 2 | 92% | 85% | Supabase migration apply (manual/MCP auth) | 2026-05-27 |
| Preview deploy (golden-kheer) | 2 | 100% | 100% | Draft URL verified | 2026-05-27 |
| Tests (competition + smoke) | 2 | 100% | 100% | Green locally | 2026-05-27 |

## Deliverables

| Item | Status | URL / note |
|---|---|---|
| Draft preview | Done | https://6a17cd6eea9c5c5d01b87153--golden-kheer-bc4402.netlify.app |
| Join route smoke | Done | `/join/silver-otter-4821` → picks + auth card |
| `preview-config.js` on draft | Done | `vodjwymxquuertmhtvuw` + publishable key |
| Migration `20260527_auth_groups_brackets.sql` | **Blocked** | MCP/CLI lack auth; REST 404 on `profiles` |
| Production domain | **Untouched** | `worldcup2026.j5lagenticstrategy.com` — draft deploy only |

## QA

- Email: `liddar@gmail.com` / `<redacted — store QA password in a password manager, not in git>` (after migration + confirm-email OFF)
- Netlify env: `WC26_SUPABASE_URL`, `WC26_SUPABASE_ANON_KEY` set on site `golden-kheer-bc4402`

## Blockers

1. Apply `supabase/migrations/20260527_auth_groups_brackets.sql` (and `20260528_fix_group_members_rls.sql` if needed) via Supabase dashboard SQL editor or `supabase login && supabase link && supabase db push`.
2. Disable **Confirm email** in Supabase Auth for preview QA.
