/* qa-pwa-ios.spec.mjs — R6 UX audit, iOS Safari STANDALONE PWA archetype.
 *
 * Simulates an iPhone 14 Pro launched from the home screen (no Safari chrome,
 * notch 44px on top, home-indicator 34px on bottom). Audits each route for
 * safe-area handling, sticky-bar overlap with the gesture zone, modal coverage,
 * and viewport-fit meta. Findings are written to:
 *   /Users/jimmyliddar/.claude/jobs/baa1eabe/tmp/findings-pwa-ios.json
 *
 * Audit only — does NOT fix code.
 */
import { test, devices } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FINDINGS_PATH = '/Users/jimmyliddar/.claude/jobs/baa1eabe/tmp/findings-pwa-ios.json';
const findings = [];
function add(route, finding, severity, suggestion, extra = {}) {
  findings.push({ route, view: 'pwa-ios-standalone', finding, severity, suggestion, ...extra });
}

// Brief: use Chromium devices['iPhone 14 Pro']. The packaged profile defaults
// to webkit, which isn't installed in this environment, so we copy the metric
// fields onto a Chromium-backed run instead (manual emulation per the brief).
const iphone14 = devices['iPhone 14 Pro'] || {};

test.use({
  browserName: 'chromium',
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: iphone14.deviceScaleFactor ?? 3,
  isMobile: iphone14.isMobile ?? true,
  hasTouch: iphone14.hasTouch ?? true,
  userAgent: iphone14.userAgent
    || 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});

const NOTCH_TOP = 44;
const HOME_INDICATOR = 34;
const VIEWPORT_W = 393;
const VIEWPORT_H = 852;

const ROUTES = [
  { hash: '/', label: '/' },
  { hash: '/#/home', label: '/#/home' },
  { hash: '/#/play', label: '/#/play' },
  { hash: '/#/play/stage/3', label: '/#/play/stage/3' },
  { hash: '/#/bracket', label: '/#/bracket' },
  { hash: '/#/pools', label: '/#/pools' },
  { hash: '/#/my-brackets', label: '/#/my-brackets' },
  { hash: '/#/my-picks', label: '/#/my-picks' },
];

async function seedCompleteBracket(page) {
  await page.evaluate(() => {
    const letters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const groups = {}, thirds = [];
    for (const l of letters) {
      groups[l] = [`${l}1`, `${l}2`, `${l}3`, `${l}4`];
      thirds.push(`${l}3`);
    }
    localStorage.setItem('wc26.grouppicks.local', JSON.stringify({ groups, best_thirds: thirds.slice(0, 8) }));
    const bracket = { picks: {} };
    for (let mn = 73; mn <= 88; mn++) bracket.picks[String(mn)] = { team: `R32_${mn}` };
    for (let mn = 89; mn <= 96; mn++) bracket.picks[String(mn)] = { team: `R16_${mn}` };
    for (let mn = 97; mn <= 100; mn++) bracket.picks[String(mn)] = { team: `QF_${mn}` };
    for (let mn = 101; mn <= 102; mn++) bracket.picks[String(mn)] = { team: `SF_${mn}` };
    bracket.picks['103'] = { team: 'Third' };
    bracket.picks['104'] = { team: 'Champion' };
    localStorage.setItem('wc26.mybrackets.local', JSON.stringify(bracket));
  });
}

async function injectStandalone(page) {
  // Mark display-mode standalone and simulate iOS safe-area insets via CSS variables
  // because Chromium doesn't fire env(safe-area-inset-*) on emulated iPhones.
  await page.addInitScript(({ topPx, botPx }) => {
    // Force standalone matchMedia
    const realMatchMedia = window.matchMedia.bind(window);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q) => {
        if (typeof q === 'string' && q.includes('display-mode: standalone')) {
          return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; }, onchange: null };
        }
        return realMatchMedia(q);
      },
    });
    document.documentElement.classList.add('wc-standalone');

    // Inject simulated safe-area insets. env(safe-area-inset-*) won't resolve
    // in Chromium emulation, but the app reads them via CSS vars on :root.
    // We override those vars directly.
    const style = document.createElement('style');
    style.id = 'pwa-ios-sim-safe-area';
    style.textContent = `
      :root {
        --safe-top: ${topPx}px !important;
        --safe-bottom: ${botPx}px !important;
        --safe-left: 0px !important;
        --safe-right: 0px !important;
      }
      /* Visualise the notch + gesture zone as overlays (transparent — for audit only) */
      html::before {
        content: '';
        position: fixed;
        inset: 0 0 auto 0;
        height: ${topPx}px;
        pointer-events: none;
        background: transparent;
        z-index: 99999;
      }
      html::after {
        content: '';
        position: fixed;
        inset: auto 0 0 0;
        height: ${botPx}px;
        pointer-events: none;
        background: transparent;
        z-index: 99999;
      }
    `;
    const apply = () => { if (document.head && !document.getElementById('pwa-ios-sim-safe-area')) document.head.appendChild(style); };
    if (document.head) apply(); else document.addEventListener('DOMContentLoaded', apply);
  }, { topPx: NOTCH_TOP, botPx: HOME_INDICATOR });
}

test.describe('PWA iOS standalone — UX audit', () => {
  test.beforeEach(async ({ page }) => {
    await injectStandalone(page);
  });

  test('Audit each route for safe-area + sticky-bar overlap', async ({ page }) => {
    // 1. Confirm meta viewport carries viewport-fit=cover (once)
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
    if (!viewportMeta || !/viewport-fit\s*=\s*cover/i.test(viewportMeta)) {
      add('global', `meta viewport missing viewport-fit=cover (got "${viewportMeta}")`, 'high',
        'Add viewport-fit=cover to the meta viewport so env(safe-area-inset-*) resolves on notched iPhones.');
    }

    // Walk routes
    for (const r of ROUTES) {
      await page.goto(r.hash === '/' ? '/' : `/${r.hash.startsWith('#') ? r.hash : '#' + r.hash}`, { waitUntil: 'domcontentloaded' });
      // Force the safe-area CSS variables AFTER all stylesheets load so our
      // !important wins over the original :root { --safe-top: env(...); } rule.
      await page.addStyleTag({
        content: `:root { --safe-top: ${NOTCH_TOP}px !important; --safe-bottom: ${HOME_INDICATOR}px !important; --safe-left: 0px !important; --safe-right: 0px !important; }`,
      });
      await page.waitForTimeout(400);

      // --- Header: padding-top should account for the simulated notch (>= NOTCH_TOP + small gap) ---
      const headerInfo = await page.evaluate(() => {
        const h = document.querySelector('#app-header, .app-header');
        if (!h) return null;
        const cs = getComputedStyle(h);
        const root = getComputedStyle(document.documentElement);
        const rect = h.getBoundingClientRect();
        const title = h.querySelector('.app-title, #app-title');
        const back = h.querySelector('#back-btn, .back-btn');
        return {
          paddingTop: parseFloat(cs.paddingTop) || 0,
          paddingBottom: parseFloat(cs.paddingBottom) || 0,
          position: cs.position,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          safeTopVar: (root.getPropertyValue('--safe-top') || '').trim(),
          backVisible: !!(back && !back.hidden && back.getAttribute('aria-hidden') !== 'true' && back.offsetParent !== null),
          titleTop: title ? title.getBoundingClientRect().top : null,
        };
      });
      if (!headerInfo) {
        add(r.label, 'No #app-header found — cannot audit notch clearance.', 'high',
          'Render the sticky header on every route so the notch (44px) is not painted over content.');
      } else {
        if (headerInfo.paddingTop < NOTCH_TOP + 4) {
          add(r.label,
            `Header padding-top is ${headerInfo.paddingTop}px (root --safe-top resolved to "${headerInfo.safeTopVar}") — should be >= ${NOTCH_TOP + 8}px once the 44px notch is factored in.`,
            'high',
            'CSS rule is padding-top: max(8px, var(--safe-top)) — when env(safe-area-inset-top) is 0 (browser does not honor viewport-fit=cover in standalone here) the header collapses to 8px and the title baseline lands behind the Dynamic Island.',
            { safeTopVar: headerInfo.safeTopVar });
        }
        if (headerInfo.titleTop !== null && headerInfo.titleTop < NOTCH_TOP) {
          add(r.label,
            `App title baseline is at y=${Math.round(headerInfo.titleTop)}px (under the ${NOTCH_TOP}px notch).`,
            'high',
            'Move .app-title-text below env(safe-area-inset-top) — currently overlaps the Dynamic Island region.');
        }
      }

      // --- Sticky submit bar bottom vs home-indicator ---
      const stickyInfo = await page.evaluate((HI) => {
        const bar = document.querySelector('.pw-submit-bar, [data-testid="play-submit-bar"]');
        if (!bar) return null;
        const cs = getComputedStyle(bar);
        const rect = bar.getBoundingClientRect();
        return {
          position: cs.position,
          bottomCss: cs.bottom,
          rectBottom: rect.bottom,
          rectTop: rect.top,
          intoGestureZone: rect.bottom > (window.innerHeight - HI),
          gapFromBottom: window.innerHeight - rect.bottom,
        };
      }, HOME_INDICATOR);
      if (stickyInfo) {
        if (stickyInfo.intoGestureZone) {
          add(r.label,
            `Sticky submit bar bottom (y=${Math.round(stickyInfo.rectBottom)}) intrudes into the ${HOME_INDICATOR}px gesture zone (viewport ${VIEWPORT_H}px).`,
            'high',
            'Add bottom: calc(var(--safe-bottom) + 8px) and ensure the inner card padding-bottom respects the home-indicator height.');
        } else if (stickyInfo.gapFromBottom < HOME_INDICATOR) {
          add(r.label,
            `Submit bar leaves only ${Math.round(stickyInfo.gapFromBottom)}px from viewport bottom — gesture handle will be drawn over the action button.`,
            'high',
            'Increase --safe-bottom offset; target gapFromBottom >= 34px on standalone PWA.');
        }
      }

      // --- Tappable elements overlapping gesture-bar zone (last 34px) ---
      // Scroll to the bottom of the page FIRST so we measure the visible state
      // a user reaches at scroll-end (not below-the-fold static DOM positions).
      // The iOS gesture-zone risk only applies to elements actually rendered
      // within the visible viewport at the bottom of the scroll range.
      await page.evaluate(() => {
        const main = document.querySelector('.view, main, #app');
        if (main && main.scrollHeight > main.clientHeight) {
          main.scrollTop = main.scrollHeight;
        }
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(150);
      const tapOverlap = await page.evaluate((HI) => {
        const gestureY = window.innerHeight - HI;
        // True interactive targets only — not <main> / scroll containers that
        // happen to carry a data-testid for routing assertions.
        const sels = 'button, a[href], [role="button"], [role="tab"], [role="link"], [role="menuitem"], input[type="button"], input[type="submit"], summary';
        const nodes = Array.from(document.querySelectorAll(sels));
        const hits = [];
        for (const el of nodes) {
          if (el.disabled) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // Only flag if the element is BOTH inside the visible viewport AND
          // its visible portion intrudes into the bottom HI px gesture strip.
          // r.bottom > gestureY means it extends into the strip; r.top < innerHeight
          // ensures it's still on-screen (not below the fold).
          // Additionally require r.top < gestureY so that a control whose top
          // is above the strip but whose bottom extends into it gets flagged,
          // while purely below-the-fold items (top >= innerHeight) are excluded.
          if (r.bottom > gestureY && r.top < window.innerHeight && r.bottom <= window.innerHeight + 1) {
            hits.push({
              tag: el.tagName,
              cls: (el.className || '').toString().slice(0, 80),
              tid: el.getAttribute('data-testid') || '',
              label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
            });
          }
        }
        return hits.slice(0, 6);
      }, HOME_INDICATOR);
      if (tapOverlap.length > 0) {
        add(r.label,
          `${tapOverlap.length} tappable element(s) overlap the bottom ${HOME_INDICATOR}px gesture zone at scroll-end: ${tapOverlap.map(h => h.tid || h.label || h.cls).filter(Boolean).slice(0,4).join(' | ')}`,
          'high',
          'Push interactive elements above env(safe-area-inset-bottom) — iOS gesture-handle steals taps in this strip.',
          { samples: tapOverlap });
      }

      // --- Tab bar (if any) clearance from bottom safe area ---
      const tabBarInfo = await page.evaluate((HI) => {
        const bar = document.querySelector('.tab-bar, .tab-bar-wrap');
        if (!bar) return null;
        const r = bar.getBoundingClientRect();
        const cs = getComputedStyle(bar);
        return {
          position: cs.position,
          rectBottom: r.bottom,
          rectTop: r.top,
          gapFromBottom: window.innerHeight - r.bottom,
          isBottomPinned: cs.position === 'fixed' || cs.position === 'sticky',
        };
      }, HOME_INDICATOR);
      if (tabBarInfo && tabBarInfo.isBottomPinned && tabBarInfo.gapFromBottom < HOME_INDICATOR) {
        add(r.label,
          `Tab bar pinned to bottom with only ${Math.round(tabBarInfo.gapFromBottom)}px below — overlaps home-indicator.`,
          'high',
          'Add padding-bottom: env(safe-area-inset-bottom) to the tab bar wrap.');
      }

      // --- Horizontal scroll at 393 ---
      const horizScroll = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      if (horizScroll.scrollW > horizScroll.clientW + 1) {
        add(r.label,
          `Document scrollWidth (${horizScroll.scrollW}px) exceeds clientWidth (${horizScroll.clientW}px) — horizontal scroll on 393-wide iPhone.`,
          'med',
          'Find the overflowing element (likely a wide table or flag strip) and constrain it with max-width: 100% / overflow-x: auto on a wrapper.');
      }
    }

    // --- Open Podium modal via Play submit ---
    // Seed BEFORE navigating to /#/play so the initial paint sees a complete bracket.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await seedCompleteBracket(page);
    await page.goto('/#/play', { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({
      content: `:root { --safe-top: ${NOTCH_TOP}px !important; --safe-bottom: ${HOME_INDICATOR}px !important; }`,
    });
    await page.waitForSelector('[data-testid="play-submit-bar"]', { timeout: 10_000 });
    const submitBtn = page.locator('[data-testid="play-submit"]');
    try {
      await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
      // Wait until enabled (paint() re-runs on play:picks-changed)
      const enabled = await page.waitForFunction(() => {
        const b = document.querySelector('[data-testid="play-submit"]');
        return b && !b.disabled ? true : false;
      }, null, { timeout: 8000 }).then(() => true).catch(() => false);
      if (!enabled) {
        const checklistText = await page.locator('.pw-submit-checklist').innerText().catch(() => '(no checklist)');
        add('podium-modal',
          `Submit button never enabled with seeded bracket. Checklist says: ${checklistText.slice(0, 200)}`,
          'high',
          'Investigate whether seeded localStorage picks resolve through buildR32Seeding to a complete knockout tree — may need real team IDs from data/.');
        throw new Error('submit-not-enabled');
      }
      // Direct DOM click to bypass any gesture-zone interception (we're auditing,
      // not testing the click itself — the click path is exercised by play-funnel).
      await page.evaluate(() => {
        const b = document.querySelector('[data-testid="play-submit"]');
        b?.click();
      });
      const modal = page.locator('[data-testid="podium-modal"]');
      await modal.waitFor({ state: 'visible', timeout: 5000 });

      // Modal covers full viewport — no transparent strip top/bottom
      const modalAudit = await page.evaluate(() => {
        const m = document.querySelector('[data-testid="podium-modal"]');
        if (!m) return null;
        const cs = getComputedStyle(m);
        const r = m.getBoundingClientRect();
        return {
          position: cs.position,
          inset: { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
          fullCoverage: r.top <= 0 && r.left <= 0 && r.right >= window.innerWidth - 0.5 && r.bottom >= window.innerHeight - 0.5,
          zIndex: cs.zIndex,
          role: m.getAttribute('role'),
          ariaModal: m.getAttribute('aria-modal'),
          ariaLabelledby: m.getAttribute('aria-labelledby'),
          background: cs.backgroundColor,
        };
      });
      if (!modalAudit?.fullCoverage) {
        add('podium-modal',
          `Podium overlay does not fully cover viewport — inset rect ${JSON.stringify(modalAudit?.inset)} vs viewport ${VIEWPORT_W}x${VIEWPORT_H}.`,
          'high',
          'Use position:fixed; inset:0 on .pw-podium-overlay so notch + home-indicator strips remain scrimmed.');
      }
      if (!modalAudit?.role || modalAudit.role !== 'dialog') {
        add('podium-modal', `Podium overlay role is "${modalAudit?.role}" (expected "dialog").`, 'med',
          'Set role="dialog" + aria-modal="true" on the overlay container for screen-reader trap.');
      }
      if (modalAudit?.ariaModal !== 'true') {
        add('podium-modal', `aria-modal="${modalAudit?.ariaModal}" missing/incorrect on podium overlay.`, 'med',
          'Add aria-modal="true" alongside role="dialog".');
      }

      // Focus trap: focused element should be inside the modal after open
      const trapAudit = await page.evaluate(() => {
        const m = document.querySelector('[data-testid="podium-modal"]');
        const active = document.activeElement;
        const inside = m && active && m.contains(active);
        const btns = m ? Array.from(m.querySelectorAll('button')) : [];
        return {
          activeTag: active?.tagName,
          activeInside: !!inside,
          buttonCount: btns.length,
          buttonSizes: btns.map((b) => {
            const r = b.getBoundingClientRect();
            return {
              label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30),
              w: Math.round(r.width),
              h: Math.round(r.height),
              testid: b.getAttribute('data-testid') || '',
            };
          }),
        };
      });
      if (!trapAudit.activeInside) {
        add('podium-modal', `Initial focus is on <${trapAudit.activeTag}> outside the dialog — focus not trapped on open.`, 'high',
          'Auto-focus the first button when the podium opens, and trap Tab/Shift+Tab within it.');
      }
      for (const b of trapAudit.buttonSizes) {
        if (b.w < 44 || b.h < 44) {
          add('podium-modal',
            `Modal button "${b.label || b.testid}" is ${b.w}x${b.h}px — under 44x44 minimum tap target.`,
            'high',
            'Bump padding/min-height on .pick-btn variants used in .pw-podium-actions to >= 44px square.');
        }
      }

      // Labels on share/close
      const labelAudit = await page.evaluate(() => {
        const share = document.querySelector('[data-testid="podium-share"]');
        const close = document.querySelector('[data-testid="podium-close"]');
        const submit = document.querySelector('[data-testid="podium-submit"]');
        const txt = (el) => el ? ((el.getAttribute('aria-label') || el.textContent || '').trim()) : null;
        return { share: txt(share), close: txt(close), submit: txt(submit) };
      });
      if (!labelAudit.share) add('podium-modal', 'Podium share button has no accessible name.', 'med', 'Add aria-label="Share" to the share action.');
      if (!labelAudit.close) add('podium-modal', 'Podium close button has no accessible name.', 'med', 'Add aria-label="Close" to the Done/close button.');

      // Escape closes
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const stillOpen = await page.locator('[data-testid="podium-modal"]').count();
      if (stillOpen > 0) {
        add('podium-modal', 'Escape key does not dismiss the podium modal.', 'high',
          'Bind keydown Esc to close() on the overlay (and document) so iOS keyboard users can dismiss.');
      }
    } catch (err) {
      add('podium-modal',
        `Could not open podium modal: ${String(err.message || err).slice(0, 140)}`,
        'high',
        'Investigate the play submit flow — could not advance from a fully-seeded localStorage state in the test harness.');
    }

    // Persist findings
    try { mkdirSync(dirname(FINDINGS_PATH), { recursive: true }); } catch {}
    writeFileSync(FINDINGS_PATH, JSON.stringify(findings, null, 2), 'utf8');
    console.log(`[qa-pwa-ios] wrote ${findings.length} findings -> ${FINDINGS_PATH}`);
  });
});
