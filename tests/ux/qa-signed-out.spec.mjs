import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SIGNED-OUT first-time visitor UX audit.
 * Walks key routes, runs per-route DOM/CSS audits in the page context,
 * and writes findings to /Users/jimmyliddar/.claude/jobs/baa1eabe/tmp/findings-signed-out.json
 *
 * NOTE: We DO NOT fix code here. We only collect observations.
 */

const FINDINGS_PATH =
  '/Users/jimmyliddar/.claude/jobs/baa1eabe/tmp/findings-signed-out.json';

const ROUTES = [
  { route: '/',                          view: 'home' },
  { route: '/#/play',                    view: 'play' },
  { route: '/#/play/stage/1',            view: 'play-stage-1' },
  { route: '/#/play/stage/2',            view: 'play-stage-2' },
  { route: '/#/play/stage/3',            view: 'play-stage-3' },
  { route: '/#/bracket',                 view: 'bracket' },
  { route: '/#/bracket?mode=projected',  view: 'bracket-projected' },
  { route: '/#/pools',                   view: 'pools' },
  { route: '/#/my-brackets',             view: 'my-brackets' },
  { route: '/#/my-picks',                view: 'my-picks' },
  { route: '/#/matches',                 view: 'matches' },
  { route: '/#/schedule',                view: 'schedule' },
  { route: '/#/venues',                  view: 'venues' },
];

/** @type {Array<{route:string,view:string,finding:string,severity:string,suggestion:string}>} */
const allFindings = [];

/**
 * In-page audit. Returns a list of finding objects.
 * Must be self-contained: no imports, no closures over outer scope.
 */
function runAuditInPage() {
  const findings = [];
  const MIN_TOUCH = 44;
  const MIN_GAP = 8;
  const MIN_FONT = 16;

  function add(finding, severity, suggestion, extra) {
    findings.push({ finding, severity, suggestion, extra: extra || null });
  }

  // ---------- Horizontal scroll ----------
  try {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    if (overflow > 1) {
      add(
        `Horizontal overflow detected: scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth} (Δ ${overflow}px) at 390×844`,
        'high',
        'Find offending child via outerWidth audit; cap with overflow-x:hidden on body or fix wide child',
        { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth }
      );
    }
  } catch {}

  // ---------- Safe-area top on header ----------
  try {
    const hdr =
      document.querySelector('header') ||
      document.querySelector('.app-toolbar') ||
      document.querySelector('[role="banner"]');
    if (hdr) {
      const cs = getComputedStyle(hdr);
      const pt = parseFloat(cs.paddingTop) || 0;
      // env(safe-area-inset-top) on iOS Safari = 0 in non-iOS but should still
      // resolve to something; check the inline/computed style mentions env().
      const styleAttr = hdr.getAttribute('style') || '';
      const usesEnvTop =
        styleAttr.includes('safe-area-inset-top') ||
        // computed value will resolve env() to a number, so check class/styles
        // via document.styleSheets — too heavy; we accept either presence-by-attr
        // or padding-top >= 8 as evidence of intent.
        pt >= 8;
      if (!usesEnvTop) {
        add(
          `Header padding-top ${pt}px — no obvious safe-area-inset-top accommodation`,
          'med',
          'Use padding-top: calc(env(safe-area-inset-top) + 8px) on the global header'
        );
      }
    } else {
      add('No <header> / .app-toolbar / [role=banner] found at this route',
          'low',
          'Confirm global header mounts at this route');
    }
  } catch {}

  // ---------- Interactive element touch targets ----------
  const interactiveSel =
    'a[href], button, [role="button"], [role="tab"], input:not([type=hidden]), select, textarea, summary, [data-testid], [tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  const interactives = Array.from(document.querySelectorAll(interactiveSel))
    .filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      // Must be visible-ish
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      // Skip hidden ancestors
      if (el.closest('[hidden]')) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      return true;
    });

  // Touch target size check
  let smallCount = 0;
  const smallSamples = [];
  for (const el of interactives) {
    const r = el.getBoundingClientRect();
    // Many `<a>` inside flowing text count as interactive; we want primary
    // affordances. Heuristic: only consider elements whose role is button/tab/
    // link AND who are not inside <p>/<li> body text, OR which have data-testid,
    // OR which are <button>.
    const isStandalone =
      el.tagName === 'BUTTON' ||
      el.getAttribute('role') === 'button' ||
      el.getAttribute('role') === 'tab' ||
      el.hasAttribute('data-testid') ||
      (el.tagName === 'A' && !el.closest('p,li,figcaption,blockquote'));
    if (!isStandalone) continue;
    if (r.width < MIN_TOUCH || r.height < MIN_TOUCH) {
      smallCount++;
      if (smallSamples.length < 5) {
        smallSamples.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          cls: el.className && typeof el.className === 'string'
            ? el.className.slice(0, 80)
            : null,
          testid: el.getAttribute('data-testid') || null,
          text: (el.textContent || '').trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
  }
  if (smallCount > 0) {
    add(
      `${smallCount} interactive element(s) below 44×44 CSS px`,
      'high',
      'Ensure min-width:44px;min-height:44px (or padding to that effect) for buttons, tabs, chips',
      { samples: smallSamples }
    );
  }

  // ---------- Icon-only buttons missing aria-label ----------
  const iconBtnSel =
    'button:not([aria-label]):not([aria-labelledby])';
  const iconButtons = Array.from(document.querySelectorAll(iconBtnSel))
    .filter((b) => {
      const txt = (b.textContent || '').replace(/\s+/g, '').trim();
      // No visible text => probably icon-only
      return txt.length === 0;
    });
  if (iconButtons.length > 0) {
    add(
      `${iconButtons.length} icon-only button(s) missing aria-label`,
      'high',
      'Add aria-label to icon-only buttons (gear, close, theme, search, ×)',
      {
        samples: iconButtons.slice(0, 5).map((b) => ({
          id: b.id || null,
          cls: typeof b.className === 'string' ? b.className.slice(0, 80) : null,
          testid: b.getAttribute('data-testid') || null,
        })),
      }
    );
  }

  // ---------- Chip / tab gap audit ----------
  function auditGapInContainer(container, label) {
    if (!container) return;
    const children = Array.from(container.children).filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (children.length < 2) return;
    // Check adjacent pairs on the same row
    let tightCount = 0;
    const tightSamples = [];
    for (let i = 1; i < children.length; i++) {
      const a = children[i - 1].getBoundingClientRect();
      const b = children[i].getBoundingClientRect();
      const sameRow = Math.abs(a.top - b.top) < 4;
      if (!sameRow) continue;
      const gap = b.left - a.right;
      if (gap >= 0 && gap < MIN_GAP) {
        tightCount++;
        if (tightSamples.length < 3) {
          tightSamples.push({ gap: Math.round(gap), idx: i });
        }
      }
    }
    if (tightCount > 0) {
      add(
        `${label}: ${tightCount} adjacent chip pair(s) with gap < ${MIN_GAP}px`,
        'med',
        `Increase gap to ≥${MIN_GAP}px on ${label} container`,
        { samples: tightSamples }
      );
    }
  }
  auditGapInContainer(document.querySelector('[data-testid="tab-bar"]'), 'tab-bar');
  auditGapInContainer(document.querySelector('.pw-stage-strip, .play-stage-strip'), 'play-stage-strip');
  document.querySelectorAll('.pw-group-strip').forEach((el, i) =>
    auditGapInContainer(el, `pw-group-strip[${i}]`)
  );

  // ---------- Help-card aria-expanded ----------
  const helpHeads = document.querySelectorAll('.help-card, [data-help-card], .help-card__head, .help-card-head');
  let helpMissingExpanded = 0;
  helpHeads.forEach((h) => {
    // The head is usually a button-like element. Look for aria-expanded.
    const head = h.matches('.help-card__head, .help-card-head')
      ? h
      : (h.querySelector('.help-card__head, .help-card-head, button') || h);
    if (!head) return;
    if (!head.hasAttribute('aria-expanded')) {
      helpMissingExpanded++;
    }
  });
  if (helpMissingExpanded > 0) {
    add(
      `${helpMissingExpanded} help-card head(s) missing aria-expanded`,
      'med',
      'Toggle aria-expanded=true|false on the help-card head element when expanded state changes'
    );
  }

  // ---------- Body font-size ----------
  try {
    const bodyFS = parseFloat(getComputedStyle(document.body).fontSize) || 0;
    if (bodyFS < MIN_FONT) {
      add(
        `Body font-size ${bodyFS}px < ${MIN_FONT}px`,
        'med',
        `Set body { font-size: ≥${MIN_FONT}px } on mobile`
      );
    }
  } catch {}

  // ---------- Heading hierarchy ----------
  const h1s = document.querySelectorAll('h1');
  if (h1s.length === 0) {
    add('No <h1> on this route', 'med', 'Each route should have exactly one h1');
  } else if (h1s.length > 1) {
    add(
      `Multiple <h1> (${h1s.length}) on this route`,
      'low',
      'Use one h1 per route; demote others to h2'
    );
  }

  // ---------- aria-current on active tab ----------
  const tabBar = document.querySelector('[data-testid="tab-bar"]');
  if (tabBar) {
    const tabs = tabBar.querySelectorAll('a, [role="tab"], button');
    const anyActiveAria = Array.from(tabs).some(
      (t) => t.getAttribute('aria-current') === 'page'
    );
    const anyActiveClass = Array.from(tabs).some(
      (t) =>
        t.classList.contains('is-active') ||
        t.classList.contains('active') ||
        t.getAttribute('aria-selected') === 'true'
    );
    if (!anyActiveAria && anyActiveClass) {
      add(
        'Active tab is marked via class only, not aria-current="page"',
        'med',
        'Add aria-current="page" to the active nav link'
      );
    }
    if (!anyActiveAria && !anyActiveClass) {
      add(
        'No active state on any tab bar item',
        'low',
        'Add active state + aria-current="page" to the currently routed tab'
      );
    }
  }

  // ---------- Contrast sample (body text) ----------
  function srgbToLin(c) {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function relLum(rgb) {
    return (
      0.2126 * srgbToLin(rgb[0]) +
      0.7152 * srgbToLin(rgb[1]) +
      0.0722 * srgbToLin(rgb[2])
    );
  }
  function parseRGB(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : parts[3]];
  }
  function contrast(a, b) {
    const la = relLum(a),
      lb = relLum(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }
  function effectiveBg(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      const rgb = parseRGB(cs.backgroundColor || '');
      if (rgb && rgb[3] > 0.1) return rgb;
      cur = cur.parentElement;
    }
    const root = parseRGB(getComputedStyle(document.documentElement).backgroundColor);
    return root || [0, 0, 0, 1];
  }

  try {
    const sampleSel = 'p, li, .muted, .body, .home-card p, .help-card, .help-card__body';
    const samples = Array.from(document.querySelectorAll(sampleSel))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.textContent || '').trim().length > 4;
      })
      .slice(0, 12);
    let lowContrastCount = 0;
    const lowSamples = [];
    for (const el of samples) {
      const cs = getComputedStyle(el);
      const fg = parseRGB(cs.color);
      if (!fg) continue;
      const bg = effectiveBg(el);
      const c = contrast(fg, bg);
      const sz = parseFloat(cs.fontSize) || 0;
      const bold = parseInt(cs.fontWeight || '400', 10) >= 600;
      const isLarge = sz >= 18.66 || (sz >= 14 && bold);
      const min = isLarge ? 3.0 : 4.5;
      if (c < min) {
        lowContrastCount++;
        if (lowSamples.length < 3) {
          lowSamples.push({
            text: (el.textContent || '').trim().slice(0, 40),
            ratio: c.toFixed(2),
            fg: fg.slice(0, 3),
            bg: bg.slice(0, 3),
            min,
          });
        }
      }
    }
    if (lowContrastCount > 0) {
      add(
        `${lowContrastCount} text sample(s) below WCAG AA contrast`,
        'med',
        'Raise foreground or darken background; use design tokens (--text, --muted) tuned for dark theme',
        { samples: lowSamples }
      );
    }
  } catch (e) {
    add('Contrast sampling failed: ' + (e && e.message), 'info', 'inspect manually');
  }

  // ---------- Skip-link presence/behavior ----------
  const skip = document.querySelector('.skip-link, a[href="#view"], a[href="#main"]');
  if (!skip) {
    add('No skip-link found', 'med', 'Add a visible-on-focus skip-to-main link as first focusable element');
  }

  // ---------- [hidden] elements that are still tab-reachable ----------
  const hiddenButReachable = Array.from(
    document.querySelectorAll('[hidden] a, [hidden] button, [hidden] [tabindex]')
  ).filter((el) => {
    const ti = el.getAttribute('tabindex');
    return ti !== '-1';
  });
  if (hiddenButReachable.length > 0) {
    add(
      `${hiddenButReachable.length} focusable element(s) live inside [hidden] container(s)`,
      'low',
      'Set tabindex="-1" on focusables inside [hidden] or remove from DOM until needed'
    );
  }

  return findings;
}

test.describe('UX audit — SIGNED-OUT first-time visitor', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('wc26.')) keys.push(k);
        }
        keys.forEach((k) => localStorage.removeItem(k));
      } catch {}
    });
  });

  for (const { route, view } of ROUTES) {
    test(`audit ${view}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      // Allow client-side routing + render
      await page.waitForTimeout(700);
      // Best-effort: wait for any data-testid on the main view
      try {
        await page.waitForSelector('main, #view, [data-testid]', { timeout: 4000 });
      } catch {}

      const findings = await page.evaluate(runAuditInPage);
      for (const f of findings) {
        allFindings.push({
          route,
          view,
          finding: f.finding,
          severity: f.severity,
          suggestion: f.suggestion,
          extra: f.extra,
        });
      }
    });
  }

  test('audit toolbar account menu overlay', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    // Open the account menu
    const btn = page.locator('[data-testid="toolbar-account"]');
    await expect(btn).toBeVisible({ timeout: 5000 });
    // Visible label should read "Sign in" for signed-out archetype
    const labelText = await page.locator('#auth-toolbar-label').textContent().catch(() => null);
    if (labelText && labelText.trim() !== 'Sign in') {
      allFindings.push({
        route: '/',
        view: 'toolbar-account-label',
        finding: `Account chip label is "${labelText.trim()}", expected "Sign in" for signed-out user`,
        severity: 'info',
        suggestion: 'Verify offline/guest fallbacks vs signed-out default; may indicate Supabase not configured',
        extra: null,
      });
    }
    await btn.click();
    await page.waitForTimeout(250);

    const menuFindings = await page.evaluate(() => {
      const out = [];
      const menu = document.getElementById('auth-toolbar-menu');
      if (!menu) {
        out.push({
          finding: 'auth-toolbar-menu element missing from DOM',
          severity: 'high',
          suggestion: 'Ensure #auth-toolbar-menu is mounted by initToolbarAuth',
          extra: null,
        });
        return out;
      }
      if (menu.hidden) {
        out.push({
          finding: 'Account menu did not open after tapping toolbar account button',
          severity: 'high',
          suggestion: 'Verify click handler in toolbar-auth.js fires for signed-out state',
          extra: null,
        });
        return out;
      }
      const r = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (r.right > vw + 1 || r.left < -1) {
        out.push({
          finding: `Account menu horizontally clipped at viewport (left ${Math.round(r.left)}, right ${Math.round(r.right)}, vw ${vw})`,
          severity: 'med',
          suggestion: 'Constrain menu max-width and clamp right/left to viewport with safe-area insets',
          extra: null,
        });
      }
      if (r.bottom > vh + 1) {
        out.push({
          finding: `Account menu bottom (${Math.round(r.bottom)}) exceeds viewport height (${vh})`,
          severity: 'med',
          suggestion: 'Cap menu max-height; allow internal scrolling',
          extra: null,
        });
      }
      if (!menu.getAttribute('role')) {
        out.push({
          finding: 'Account menu missing role attribute',
          severity: 'low',
          suggestion: 'role="dialog" or role="menu" with aria-label',
          extra: null,
        });
      }
      // Buttons inside the menu touch targets
      const btns = menu.querySelectorAll('button, a, [role="button"]');
      const small = [];
      btns.forEach((b) => {
        const br = b.getBoundingClientRect();
        if (br.width > 0 && br.height > 0 && (br.width < 44 || br.height < 44)) {
          small.push({
            text: (b.textContent || '').trim().slice(0, 30),
            w: Math.round(br.width),
            h: Math.round(br.height),
          });
        }
      });
      if (small.length > 0) {
        out.push({
          finding: `${small.length} button(s) inside account menu below 44×44`,
          severity: 'med',
          suggestion: 'Increase min-height on menu actions',
          extra: { samples: small },
        });
      }
      // Escape behavior is async, just record that it's wired by checking listener
      return out;
    });
    for (const f of menuFindings) {
      allFindings.push({
        route: '/',
        view: 'toolbar-account-menu',
        finding: f.finding,
        severity: f.severity,
        suggestion: f.suggestion,
        extra: f.extra,
      });
    }

    // Esc dismiss
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const stillOpen = await page.evaluate(() => {
      const m = document.getElementById('auth-toolbar-menu');
      return m ? !m.hidden : false;
    });
    if (stillOpen) {
      allFindings.push({
        route: '/',
        view: 'toolbar-account-menu',
        finding: 'Esc key does not dismiss the account menu',
        severity: 'med',
        suggestion: 'Wire keydown Escape to close menu and restore focus to the trigger',
        extra: null,
      });
    }
  });

  test('audit handle prompt overlay', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    // Open account menu first
    await page.locator('[data-testid="toolbar-account"]').click();
    await page.waitForTimeout(200);
    // Try to find a "Continue as guest" or similar button that opens handle prompt
    const guestBtn = page.locator(
      '#auth-toolbar-menu button:has-text("guest"), #auth-toolbar-menu button:has-text("Guest"), #auth-toolbar-menu button:has-text("Continue")'
    );
    const count = await guestBtn.count().catch(() => 0);
    if (count === 0) {
      allFindings.push({
        route: '/',
        view: 'handle-prompt',
        finding: 'No "Continue as guest" entry found in account menu (signed-out)',
        severity: 'info',
        suggestion: 'Confirm guest flow CTA is reachable for signed-out users',
        extra: null,
      });
      return;
    }
    await guestBtn.first().click().catch(() => {});
    await page.waitForTimeout(300);

    const overlayFindings = await page.evaluate(() => {
      const out = [];
      const ov = document.querySelector('.auth-handle-overlay');
      if (!ov) {
        out.push({
          finding: 'Handle prompt overlay did not appear after triggering guest flow',
          severity: 'info',
          suggestion: 'May be a no-op if Supabase not configured; verify guest entrypoint UX',
          extra: null,
        });
        return out;
      }
      const r = ov.getBoundingClientRect();
      const cs = getComputedStyle(ov);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') {
        out.push({
          finding: `Handle overlay position is ${cs.position}; expected fixed for modal scrim`,
          severity: 'med',
          suggestion: 'Use position: fixed; inset: 0 with backdrop',
          extra: null,
        });
      }
      const dialog =
        ov.querySelector('[role="dialog"]') ||
        ov.querySelector('form') ||
        ov.firstElementChild;
      if (dialog) {
        const dr = dialog.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const cx = dr.left + dr.width / 2;
        const cy = dr.top + dr.height / 2;
        if (Math.abs(cx - vw / 2) > 24) {
          out.push({
            finding: `Handle dialog not horizontally centered (cx ${Math.round(cx)} vs vw/2 ${Math.round(vw / 2)})`,
            severity: 'low',
            suggestion: 'Use flex centering on overlay (display:flex; align-items:center; justify-content:center)',
            extra: null,
          });
        }
        if (Math.abs(cy - vh / 2) > 80) {
          out.push({
            finding: `Handle dialog not vertically centered (cy ${Math.round(cy)} vs vh/2 ${Math.round(vh / 2)})`,
            severity: 'low',
            suggestion: 'Center vertically with flex or grid place-items',
            extra: null,
          });
        }
      }
      // Input must have an associated label / placeholder
      const input = ov.querySelector('input');
      if (input && !input.getAttribute('aria-label') && !ov.querySelector('label')) {
        out.push({
          finding: 'Handle prompt input has no label and no aria-label',
          severity: 'med',
          suggestion: 'Add <label for> or aria-label to the handle input',
          extra: null,
        });
      }
      // Touch targets inside overlay
      const btns = ov.querySelectorAll('button, [role="button"]');
      const small = [];
      btns.forEach((b) => {
        const br = b.getBoundingClientRect();
        if (br.width > 0 && br.height > 0 && (br.width < 44 || br.height < 44)) {
          small.push({
            text: (b.textContent || '').trim().slice(0, 30),
            w: Math.round(br.width),
            h: Math.round(br.height),
          });
        }
      });
      if (small.length > 0) {
        out.push({
          finding: `${small.length} button(s) inside handle overlay below 44×44`,
          severity: 'med',
          suggestion: 'Increase min-height on overlay action buttons',
          extra: { samples: small },
        });
      }
      return out;
    });
    for (const f of overlayFindings) {
      allFindings.push({
        route: '/',
        view: 'handle-prompt',
        finding: f.finding,
        severity: f.severity,
        suggestion: f.suggestion,
        extra: f.extra,
      });
    }
  });

  test.afterAll(async () => {
    try {
      const dir = path.dirname(FINDINGS_PATH);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(FINDINGS_PATH, JSON.stringify(allFindings, null, 2));
      // Also emit a quick log line so it shows in the test output
      // eslint-disable-next-line no-console
      console.log(`[qa-signed-out] wrote ${allFindings.length} finding(s) → ${FINDINGS_PATH}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[qa-signed-out] failed to write findings:', e);
    }
  });
});
