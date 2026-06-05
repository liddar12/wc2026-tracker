# WC26 Tracker — PWA (Direction A: “The Goal”)

An installable, iOS-ready Progressive Web App shell implementing the **“The Goal”** navigation:
the menu button is a goal frame; tapping it turns the screen into a pitch where the nav lines up
in front of the net. Mobile-first, with a desktop inline-nav layout, a bottom tab bar (“the near
goal”), offline support, and Add-to-Home-Screen install.

---

## Run it

It’s plain HTML/CSS/JS — no build step. Serve the `pwa/` folder over **HTTPS** (required for the
service worker + install):

```bash
cd pwa
npx serve .          # or: python3 -m http.server 8080
```

Open the URL on desktop and on an iPhone (Safari). On iOS: **Share → Add to Home Screen** →
it launches full-screen with the splash and dark status bar.

> Localhost works for testing the SW; production needs HTTPS.

---

## File structure

```
pwa/
├── index.html              # app entry + all PWA / iOS meta tags
├── styles.css              # design system + app shell + “The Goal” menu
├── ui.js                   # SVG marks: ball logo, goal icon, big net, nav icons
├── screens.js              # the 6 screens (sample data — swap for your API)
├── app.js                  # routing, menu, tab bar, install flow, SW registration
├── manifest.webmanifest    # name, theme color, icons, standalone display
├── sw.js                   # service worker (offline app-shell cache)
├── icons/                  # 512 / 192 / maskable / apple-touch / favicon
└── splash/                 # iOS launch images
```

---

## Design tokens (edit in `styles.css` `:root`)

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0D1117` | base / theme color |
| `--pitch-deep` → `--pitch` → `--pitch-lt` | `#0A5C32 #108A4A #16A35A` | pitch greens |
| `--lime` | `#39D479` | accent, active state, CTAs |
| `--chalk` | `#FFFFFF` | line markings, ball |

Type is the system stack at **400 / 700** only — no web fonts to load.

---

## Customize

- **Navigation items** — edit the `NAV` array in `app.js` (label, sub-text, `icon`). The full
  menu, tab bar and desktop nav all derive from it. `TABS` controls which 5 appear in the bottom bar.
- **Screens / content** — `screens.js` builds each screen’s HTML from sample data. Replace the
  arrays (`fixtures`, leaderboard, etc.) with your real data, or swap the function bodies to render
  from your API/framework. Each screen is just a function returning an HTML string.
- **Icons** — regenerate from the ball mark at any size; the source drawing routine lives in the
  project’s icon-generation script. Keep `icons/` filenames in sync with `manifest.webmanifest`
  and `index.html`.
- **iOS splash** — `index.html` includes two device sizes. Add more `apple-touch-startup-image`
  `<link>` tags (one per device width/height/DPR) for pixel-perfect splashes across all iPhones.

---

## Adopting this into your existing site

You have two clean paths:

1. **Use it as the new front-end shell.** Keep `index.html` + `styles.css` + `app.js` and route
   your existing pages through the `Screens` functions (return your markup instead of the samples).
2. **Lift just the navigation system.** Copy the `.topbar`, `.tabbar`, `.goalmenu` markup (built in
   `app.js`’s `shell()`), the matching CSS blocks in `styles.css`, and `ui.js`. Wire the
   `openMenu()/closeMenu()` + `go()` functions into your router. The menu is framework-agnostic —
   it only toggles `body.menu-open` and reads `data-go` attributes.

The whole nav is driven by two things: the `menu-open` class on `<body>` and `data-go="<screen>"`
attributes on clickable elements — easy to port to React/Vue/Svelte.

---

## PWA checklist (already wired)

- ✅ `manifest.webmanifest` — standalone display, `theme_color`, any + maskable icons
- ✅ iOS meta: `apple-mobile-web-app-capable`, status-bar style, `apple-touch-icon`, splash links
- ✅ `viewport-fit=cover` + `env(safe-area-inset-*)` so it respects the notch / home indicator
- ✅ Service worker: network-first for pages, cache-first for assets, offline fallback
- ✅ Install flow: Chrome/Android `beforeinstallprompt` toast; iOS gets a guided “how to install” sheet

Bump `CACHE = 'wc26-v1'` in `sw.js` whenever you ship asset changes, so clients update.
