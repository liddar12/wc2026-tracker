# WC26 Tracker — Supabase wire-up

**WC26 backend project:** Vora (`wstbfwluaiheumntrrwa`) · https://wstbfwluaiheumntrrwa.supabase.co

Migration applied via MCP: `auth_groups_brackets` (tables: `profiles`, `groups`, `group_members`, `group_brackets`, RPC `join_group_by_code`).

## 1. Auth dashboard (manual)

In [Authentication → Providers → Email](https://supabase.com/dashboard/project/wstbfwluaiheumntrrwa/auth/providers):

1. **Confirm email**: **OFF** for MVP (currently **ON** — sign-in returns `invalid_credentials` until the user confirms).
2. Synthetic username accounts use `{username}@wc26.app` (Supabase rejects `.local` domains).

## 2. Preview / Netlify (`golden-kheer-bc4402`)

| Variable | Value |
|----------|--------|
| `WC26_SUPABASE_URL` | `https://wstbfwluaiheumntrrwa.supabase.co` |
| `WC26_SUPABASE_ANON_KEY` | Legacy **anon** JWT or `sb_publishable_…` from **Project Settings → API** |

Build runs `node scripts/write-runtime-config.mjs` → `app/preview-config.js` (anon/publishable key only; never service role).

Draft deploy (no commit required):

```bash
export WC26_SUPABASE_URL=https://wstbfwluaiheumntrrwa.supabase.co
export WC26_SUPABASE_ANON_KEY='<anon-or-publishable-key>'
node scripts/write-runtime-config.mjs
npx netlify-cli@17 deploy -d . -s 95125f03-776f-4227-8528-98cc2dc67b9d
```

## 3. Org project limits

Free tier allows two active projects. For this preview, **J5L Agentic Strategy Invoicing** was paused so **Vora** could be restored. Unpause invoicing in the [Supabase dashboard](https://supabase.com/dashboard) when finished.
