# vendor/ — self-contained third-party bundles (R15b #40)

These files are **vendored** (committed) so the app never depends on a runtime
CDN (esm.sh) for code on its critical path. A CDN outage previously could dark
the entire data layer (auth, pools, leaderboard) and break the dynamic
drag-to-reorder on Play. Same-origin files are also cacheable by the service
worker for offline/PWA use, which cross-origin CDN modules were not.

| File | Source package | Version | Imported by |
|------|----------------|---------|-------------|
| `supabase-js.js` | `@supabase/supabase-js` | 2.107.0 | `app/competition.js` (static import — precached by sw.js) |
| `sortablejs.js` | `sortablejs` | 1.15.2 | `app/views/play-view.js` (dynamic import on Play Stage 2) |

## Regenerating / upgrading

Do **not** hand-edit these files. To bump a version, edit the pins in
`scripts/vendor-deps.mjs`, then:

```bash
npm i -D esbuild @supabase/supabase-js@2.107.0 sortablejs@1.15.2
node scripts/vendor-deps.mjs
git add vendor/ scripts/vendor-deps.mjs
```

Each bundle is produced with esbuild (`--bundle --format=esm
--platform=browser --target=es2020 --minify`) and is fully self-contained —
zero external/relative imports. The regression test
`tests/feature/r15b-no-cdn-imports.test.mjs` fails if a CDN JS import sneaks
back into `app/`.

## Not vendored (intentional)

- **flag-icons CSS** (`index.html`) stays on jsDelivr — vendoring it means
  shipping 200+ flag SVGs/fonts, and it is non-critical (the app falls back to
  emoji flags via `has-flag-emoji-only` if the CSS fails to load).
- **Google Fonts** stay on the Google CDN (preconnected in `index.html`).
