/* qa-guest.spec.mjs — R6 UX audit, GUEST archetype.
   Audit only — does NOT fix code. Collects findings to a JSON file. */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FINDINGS_PATH = '/Users/jimmyliddar/.claude/jobs/baa1eabe/tmp/findings-guest.json';

/** @type {Array<{route:string, view:string, finding:string, severity:'high'|'med'|'low'|'info', suggestion:string}>} */
const findings = [];

function add(route, view, finding, severity, suggestion) {
  findings.push({ route, view, finding, severity, suggestion });
}

test.describe.configure({ mode: 'serial' });

test.describe('R6 UX audit — GUEST', () => {
  test.beforeEach(async ({ page, context }) => {
    // Set viewport explicitly (mobile)
    await page.setViewportSize({ width: 390, height: 844 });
    // Seed via addInitScript so localStorage is populated BEFORE the page's
    // competition.js module reads it on first import.
    await context.addInitScript(() => {
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k?.startsWith('wc26.')) localStorage.removeItem(k);
        }
        localStorage.setItem('wc26.competition.guestMode', '1');
        localStorage.setItem('wc26.competition.guestHandle', 'Jimmy');
        const allLetters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
        const groups = {};
        for (const l of allLetters.slice(0, 6)) groups[l] = [`${l}1`, `${l}2`, `${l}3`, `${l}4`];
        for (const l of allLetters.slice(6)) groups[l] = [];
        const best_thirds = ['A3', 'B3', 'C3', 'D3'];
        localStorage.setItem('wc26.grouppicks.local', JSON.stringify({ groups, best_thirds }));
        localStorage.setItem('wc26.mybrackets.local', JSON.stringify({
          picks: { '73': { team: 'A1' }, '74': { team: 'B1' } },
        }));
      } catch {}
    });
    // First load any URL so we can write to its localStorage
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      // Clear any prior state
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k?.startsWith('wc26.')) localStorage.removeItem(k);
        }
      } catch {}

      // Seed guest mode
      localStorage.setItem('wc26.competition.guestMode', '1');
      localStorage.setItem('wc26.competition.guestHandle', 'Jimmy');

      // Seed partial Stage 1 + 2: 6 groups fully ranked, 6 not; 4 best-thirds ranked
      const groups = {};
      const allLetters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
      // First 6 groups fully ranked
      for (const l of allLetters.slice(0, 6)) {
        groups[l] = [`${l}1`, `${l}2`, `${l}3`, `${l}4`];
      }
      // Remaining 6 groups: empty arrays (not started)
      for (const l of allLetters.slice(6)) {
        groups[l] = [];
      }
      const best_thirds = ['A3', 'B3', 'C3', 'D3']; // 4 of 8
      localStorage.setItem('wc26.grouppicks.local', JSON.stringify({ groups, best_thirds }));

      // Empty bracket draft (or a couple R32 picks)
      localStorage.setItem('wc26.mybrackets.local', JSON.stringify({
        picks: {
          '73': { team: 'A1' },
          '74': { team: 'B1' },
        },
      }));
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Helpers (run in-page via evaluate)
  // ─────────────────────────────────────────────────────────────
  async function commonAudit(page, route, viewLabel) {
    // 1) horizontal scroll at 390
    const hScroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
      body: document.body.scrollWidth,
    }));
    if (hScroll.doc - hScroll.win > 1 || hScroll.body - hScroll.win > 1) {
      add(route, viewLabel,
        `Horizontal scroll: doc=${hScroll.doc} body=${hScroll.body} > win=${hScroll.win}`,
        'high',
        'Find offending overflow element; add `overflow-x: hidden` to body or constrain child widths to 100%.');
    }

    // 2) Touch targets ≥44 and chip gaps ≥8
    const touch = await page.evaluate(() => {
      const out = { small: [], chipGapSmall: [] };
      const sel = 'a, button, [role="button"], [role="tab"], input[type="checkbox"], input[type="radio"], select';
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none';
      };
      document.querySelectorAll(sel).forEach((el) => {
        if (!isVisible(el)) return;
        // Skip elements inside hidden popovers
        const r = el.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) {
          // skip the skip-link (only visible on focus) — has class .skip-link
          if (el.classList?.contains('skip-link')) return;
          out.small.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 80),
            id: el.id || '',
            w: Math.round(r.width),
            h: Math.round(r.height),
            text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 40).replace(/\s+/g,' '),
          });
        }
      });

      // chip gap: look at common chip groups
      const groupSelectors = [
        '.pw-stage-strip',     // play stage chips
        '.pw-group-chips',     // group chips
        '.pw-bracket-mode',    // bracket toggle
        '[data-testid="tab-bar"]',
      ];
      for (const sg of groupSelectors) {
        const root = document.querySelector(sg);
        if (!root) continue;
        const kids = Array.from(root.children).filter((k) => k.getBoundingClientRect().width > 0);
        for (let i = 0; i < kids.length - 1; i++) {
          const a = kids[i].getBoundingClientRect();
          const b = kids[i + 1].getBoundingClientRect();
          const gap = b.left - a.right;
          if (gap >= 0 && gap < 8) {
            out.chipGapSmall.push({ group: sg, gapPx: Math.round(gap) });
          }
        }
      }
      return out;
    });
    for (const t of touch.small.slice(0, 6)) {
      add(route, viewLabel,
        `Touch target <44px: ${t.tag}.${t.cls} "${t.text}" (${t.w}×${t.h})`,
        'high',
        'Bump min-width/min-height to 44px or add padding so the hit area meets 44×44.');
    }
    if (touch.small.length > 6) {
      add(route, viewLabel,
        `…and ${touch.small.length - 6} more touch targets <44px`,
        'high',
        'Audit `.pick-btn`, `.pw-*-chip`, `.tab-btn` size rules.');
    }
    for (const cg of touch.chipGapSmall) {
      add(route, viewLabel,
        `Chip gap <8px in ${cg.group}: ${cg.gapPx}px`,
        'med',
        'Set gap:8px (or larger) on the chip container.');
    }

    // 3) Toolbar account chip data-state + label
    const tb = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="toolbar-account"]');
      const label = document.getElementById('auth-toolbar-label');
      return {
        present: !!btn,
        state: btn?.dataset?.state || null,
        label: label?.textContent || null,
        ariaLabel: btn?.getAttribute('aria-label') || null,
      };
    });
    if (!tb.present) {
      add(route, viewLabel, 'Toolbar account chip missing', 'high',
        'Ensure #auth-toolbar-btn renders on every route.');
    } else {
      if (tb.state !== 'guest') {
        add(route, viewLabel,
          `Toolbar account data-state="${tb.state}" (expected "guest")`,
          'high',
          'Trigger competition:state-change after guest seed; or syncLabel() reads guestMode from localStorage on load.');
      }
      if (tb.label !== 'Jimmy') {
        add(route, viewLabel,
          `Toolbar label="${tb.label}" (expected "Jimmy")`,
          'high',
          'Hydrate guestHandle from localStorage at boot before syncLabel().');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1) Home — /#/home (also default /)
  // ─────────────────────────────────────────────────────────────
  test('audit — Home', async ({ page }) => {
    await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await commonAudit(page, '/#/home', 'home');

    // home-card spacing rhythm
    const cards = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.home-card').forEach((el) => {
        const cs = getComputedStyle(el);
        out.push({
          padding: cs.padding,
          paddingLeft: cs.paddingLeft,
          paddingRight: cs.paddingRight,
          gap: cs.gap,
          textCls: (el.className || '').toString().slice(0, 60),
        });
      });
      return out;
    });
    if (cards.length === 0) {
      add('/#/home', 'home', 'No .home-card elements present on home', 'low', 'Confirm home view renders home-card sections.');
    } else {
      // Check left/right symmetry
      cards.forEach((c, i) => {
        if (c.paddingLeft !== c.paddingRight) {
          add('/#/home', 'home',
            `home-card[${i}] asymmetric L/R padding ${c.paddingLeft} vs ${c.paddingRight}`,
            'med',
            'Use symmetric horizontal padding (e.g. padding-inline) to keep cards visually centered.');
        }
        // 4/8 rhythm — left/right should be multiple of 4
        const lp = parseFloat(c.paddingLeft);
        if (!Number.isNaN(lp) && lp % 4 !== 0) {
          add('/#/home', 'home',
            `home-card[${i}] paddingLeft=${c.paddingLeft} breaks 4/8 rhythm`,
            'low',
            'Round to nearest 4px (e.g. 12px / 16px / 20px).');
        }
      });
    }

    // toolbar account menu interaction — verify popover shows handle + Sign up/Sign in
    await page.locator('[data-testid="toolbar-account"]').click();
    const menu = page.locator('#auth-toolbar-menu');
    await expect(menu).toBeVisible();
    const menuTxt = (await menu.innerText()).trim();
    if (!/Jimmy/.test(menuTxt)) {
      add('/#/home', 'toolbar-account-menu',
        `Account popover missing guest handle "Jimmy" — text: "${menuTxt.slice(0,120)}"`,
        'high',
        'Render the guest handle prominently in the popover head when in guest mode.');
    }
    if (!/Sign up|Sign in/i.test(menuTxt)) {
      add('/#/home', 'toolbar-account-menu',
        'Account popover missing "Sign up / Sign in" upgrade affordance',
        'high',
        'Guests should always see an upgrade-path button in the menu.');
    }
    // Esc closes
    await page.keyboard.press('Escape');
  });

  // ─────────────────────────────────────────────────────────────
  // 2) /#/play (lands on Stage 1 by default; partial Stage 1 still incomplete)
  // ─────────────────────────────────────────────────────────────
  test('audit — Play landing', async ({ page }) => {
    await page.goto('/#/play', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="play-submit-bar"]', { timeout: 8000 });
    await page.waitForTimeout(300);
    await commonAudit(page, '/#/play', 'play-landing');

    // Submit bar "what's left" — should mention Stage 1, Stage 2 and Stage 3
    const submit = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="play-submit-bar"]');
      if (!bar) return null;
      const checklist = bar.querySelector('.pw-submit-checklist');
      const btn = bar.querySelector('[data-testid="play-submit"]');
      const items = Array.from(checklist?.querySelectorAll('li') || []).map((li) => li.innerText.trim());
      // Overflow check: any li wider than its container?
      const overflow = [];
      let any = false;
      checklist?.querySelectorAll('li').forEach((li) => {
        if (li.scrollWidth - li.clientWidth > 1) overflow.push({ text: li.innerText.slice(0, 60), scroll: li.scrollWidth, client: li.clientWidth });
        if (li.getBoundingClientRect().right > window.innerWidth) any = true;
      });
      const barRect = bar.getBoundingClientRect();
      return {
        items,
        text: checklist?.innerText || '',
        btnDisabled: btn?.disabled,
        btnText: btn?.innerText,
        overflow,
        overflowsViewport: any || (barRect.right > window.innerWidth) || (barRect.left < 0),
        barWidth: Math.round(barRect.width),
        winWidth: window.innerWidth,
        styleOpacity: btn ? getComputedStyle(btn).opacity : null,
        cursor: btn ? getComputedStyle(btn).cursor : null,
      };
    });

    if (!submit) {
      add('/#/play', 'play-landing', 'play-submit-bar missing', 'high', 'Ensure renderSubmitBar() mounts on /#/play.');
    } else {
      const has1 = /Stage 1/i.test(submit.text);
      const has2 = /Stage 2/i.test(submit.text);
      const has3 = /Stage 3/i.test(submit.text);
      // With 6 of 12 groups + only 4 of 8 thirds + no bracket, all three should be missing
      if (!has1) add('/#/play', 'play-submit-bar', '"What\'s left" missing Stage 1 with 6/12 groups partial', 'high', 'stage1WhatsLeft() should detect <12 groups complete.');
      if (!has2) add('/#/play', 'play-submit-bar', '"What\'s left" missing Stage 2 with only 4/8 thirds set', 'high', 'stage2WhatsLeft() should detect <8 thirds.');
      if (!has3) add('/#/play', 'play-submit-bar', '"What\'s left" missing Stage 3 (no bracket picks)', 'high', 'knockoutWhatsLeft() should list missing rounds.');
      if (submit.btnDisabled !== true) {
        add('/#/play', 'play-submit-bar', 'Submit button NOT disabled even though stages incomplete', 'high', 'Compute canSubmit=false when left.length>0.');
      } else {
        const op = parseFloat(submit.styleOpacity);
        if (Number.isFinite(op) && op >= 0.95) {
          add('/#/play', 'play-submit-bar', `Disabled submit visually identical (opacity=${submit.styleOpacity})`, 'med', 'Drop to opacity ~0.5 for disabled.');
        }
        if (submit.cursor && submit.cursor !== 'not-allowed' && submit.cursor !== 'default') {
          add('/#/play', 'play-submit-bar', `Disabled submit cursor="${submit.cursor}" — expected not-allowed/default`, 'low', 'Add `button:disabled { cursor: not-allowed; }`');
        }
      }
      if (submit.overflow.length) {
        for (const o of submit.overflow.slice(0, 4)) {
          add('/#/play', 'play-submit-bar',
            `Checklist item overflows: "${o.text}" scroll=${o.scroll} client=${o.client}`,
            'high',
            'Allow text wrapping; remove white-space:nowrap; ensure word-wrap.');
        }
      }
      if (submit.overflowsViewport) {
        add('/#/play', 'play-submit-bar', `Submit bar wider than viewport (bar=${submit.barWidth} win=${submit.winWidth})`, 'high',
          'Constrain sticky bar to width:100%; avoid fixed widths.');
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 3) /#/play/stage/1
  // ─────────────────────────────────────────────────────────────
  test('audit — Play stage 1', async ({ page }) => {
    await page.goto('/#/play/stage/1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="play-stage-1"]', { timeout: 8000 });
    await page.waitForTimeout(200);
    await commonAudit(page, '/#/play/stage/1', 'play-stage-1');

    // pw-team-grid rhythm
    const grid = await page.evaluate(() => {
      const el = document.querySelector('.pw-team-grid');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        gap: cs.gap,
        rowGap: cs.rowGap,
        colGap: cs.columnGap,
        padding: cs.padding,
        paddingLeft: cs.paddingLeft,
        paddingTop: cs.paddingTop,
        gridTemplateColumns: cs.gridTemplateColumns,
      };
    });
    if (!grid) {
      add('/#/play/stage/1', 'play-stage-1', '.pw-team-grid not rendered', 'med', 'Confirm Stage 1 renders the current group card.');
    } else {
      const gpx = parseFloat(grid.gap);
      if (Number.isFinite(gpx) && gpx % 4 !== 0) {
        add('/#/play/stage/1', 'pw-team-grid',
          `Grid gap=${grid.gap} breaks 4/8 rhythm`,
          'low',
          'Round gap to 8px or 12px.');
      }
      add('/#/play/stage/1', 'pw-team-grid',
        `Grid info — gap=${grid.gap}, padding=${grid.padding}, cols=${grid.gridTemplateColumns}`,
        'info',
        'Spacing dump for review.');
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 4) /#/play/stage/2
  // ─────────────────────────────────────────────────────────────
  test('audit — Play stage 2', async ({ page }) => {
    await page.goto('/#/play/stage/2', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="play-stage-2"]', { timeout: 8000 });
    await page.waitForTimeout(200);
    await commonAudit(page, '/#/play/stage/2', 'play-stage-2');

    // Confirm Stage 2 reflects "4 of 8" partial
    const s2 = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="play-stage-2"]');
      return {
        text: root?.innerText?.slice(0, 240) || '',
        chipCount: document.querySelectorAll('[data-testid="play-stage-2"] .pw-third-chip, [data-testid="play-stage-2"] .pw-third-rank').length,
      };
    });
    if (!/4|partial|of 8|left/i.test(s2.text)) {
      add('/#/play/stage/2', 'play-stage-2',
        `Stage 2 progress copy unclear — first 240 chars: "${s2.text}"`,
        'low',
        'Surface "4 of 8 ranked" status near the top.');
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 5) /#/play/stage/3 — bracket tree horizontal scroll
  // ─────────────────────────────────────────────────────────────
  test('audit — Play stage 3', async ({ page }) => {
    await page.goto('/#/play/stage/3', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="play-stage-3"]', { timeout: 8000 });
    await page.waitForTimeout(300);
    // commonAudit but with caveat: bracket tree may legitimately scroll horizontally.
    await commonAudit(page, '/#/play/stage/3', 'play-stage-3');

    const tree = await page.evaluate(() => {
      const t = document.querySelector('.pw-bracket-tree');
      if (!t) return null;
      const cs = getComputedStyle(t);
      const docOverflow = (document.documentElement.scrollWidth - window.innerWidth) > 1;
      return {
        gap: cs.gap,
        padding: cs.padding,
        overflowX: cs.overflowX,
        scrollWidth: t.scrollWidth,
        clientWidth: t.clientWidth,
        scrollsHorizontally: t.scrollWidth > t.clientWidth + 1,
        docScrollsHorizontally: docOverflow,
      };
    });
    if (!tree) {
      add('/#/play/stage/3', 'pw-bracket-tree', '.pw-bracket-tree element missing', 'high', 'Confirm Stage 3 renders the tree.');
    } else {
      add('/#/play/stage/3', 'pw-bracket-tree',
        `Spacing — gap=${tree.gap}, padding=${tree.padding}, overflowX=${tree.overflowX}, scrollW=${tree.scrollWidth}, clientW=${tree.clientWidth}`,
        'info', 'Spacing dump for review.');
      if (!tree.scrollsHorizontally) {
        add('/#/play/stage/3', 'pw-bracket-tree', 'Tree does NOT scroll horizontally — content may be cramped or columns hidden', 'med',
          'Ensure 5 columns render with a min-width that exceeds 390px so tree scrolls.');
      }
      if (tree.docScrollsHorizontally) {
        add('/#/play/stage/3', 'pw-bracket-tree', 'PAGE scrolls horizontally (not just the tree) — viewport break', 'high',
          'Wrap tree in overflow-x:auto container; constrain wrapper to 100% width.');
      }
      const gpx = parseFloat(tree.gap);
      if (Number.isFinite(gpx) && gpx % 4 !== 0) {
        add('/#/play/stage/3', 'pw-bracket-tree', `Tree gap=${tree.gap} breaks 4/8 rhythm`, 'low', 'Round to 8/12/16.');
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 6) /#/bracket — read-only tree
  // ─────────────────────────────────────────────────────────────
  test('audit — Bracket', async ({ page }) => {
    await page.goto('/#/bracket', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700); // bracket data may need a tick
    await commonAudit(page, '/#/bracket', 'bracket');

    // help card collapse persists after revisit
    const helpKey = await page.evaluate(() => {
      const card = document.querySelector('[data-testid^="help-card-"]');
      if (!card) return null;
      const head = card.querySelector('.pw-help-head');
      head?.click();
      // grab persistKey via testid
      const m = (card.getAttribute('data-testid') || '').match(/^help-card-(.+)$/);
      return m ? m[1] : null;
    });
    if (helpKey) {
      // navigate away and back
      await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150);
      await page.goto('/#/bracket', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const persisted = await page.evaluate((key) => {
        const card = document.querySelector(`[data-testid="help-card-${key}"]`);
        if (!card) return { found: false };
        return {
          found: true,
          collapsed: card.classList.contains('is-collapsed'),
          ariaExpanded: card.querySelector('.pw-help-head')?.getAttribute('aria-expanded'),
        };
      }, helpKey);
      if (!persisted.found) {
        add('/#/bracket', 'help-card', `help-card-${helpKey} not re-rendered after revisit`, 'low', 'Confirm help-card mounts on each navigation.');
      } else if (!persisted.collapsed) {
        add('/#/bracket', 'help-card', `Help card collapse did NOT persist (ariaExpanded=${persisted.ariaExpanded})`, 'med',
          'Verify localStorage write/read of wc26.help.<key>.');
      } else {
        add('/#/bracket', 'help-card', `Help card collapse persisted (key=${helpKey})`, 'info', 'OK.');
      }
    } else {
      add('/#/bracket', 'help-card', 'No help-card found on bracket route', 'low', 'Expected one help-card per primary view.');
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 7) /#/pools
  // ─────────────────────────────────────────────────────────────
  test('audit — Pools', async ({ page }) => {
    await page.goto('/#/pools', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await commonAudit(page, '/#/pools', 'pools');
  });

  // ─────────────────────────────────────────────────────────────
  // 8) /#/my-brackets
  // ─────────────────────────────────────────────────────────────
  test('audit — My Brackets', async ({ page }) => {
    await page.goto('/#/my-brackets', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await commonAudit(page, '/#/my-brackets', 'my-brackets');

    // bracket-tree spacing dump (in editor)
    const tree = await page.evaluate(() => {
      const t = document.querySelector('.pw-bracket-tree');
      if (!t) return null;
      const cs = getComputedStyle(t);
      return { gap: cs.gap, padding: cs.padding, overflowX: cs.overflowX };
    });
    if (tree) {
      add('/#/my-brackets', 'pw-bracket-tree', `MyBrackets tree — gap=${tree.gap}, padding=${tree.padding}, overflowX=${tree.overflowX}`, 'info', 'Spacing dump for review.');
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 9) /#/my-picks
  // ─────────────────────────────────────────────────────────────
  test('audit — My Picks', async ({ page }) => {
    await page.goto('/#/my-picks', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await commonAudit(page, '/#/my-picks', 'my-picks');
  });

  // ─────────────────────────────────────────────────────────────
  // Final teardown: write findings
  // ─────────────────────────────────────────────────────────────
  test.afterAll(async () => {
    try {
      fs.mkdirSync(path.dirname(FINDINGS_PATH), { recursive: true });
      fs.writeFileSync(FINDINGS_PATH, JSON.stringify(findings, null, 2));
      // eslint-disable-next-line no-console
      console.log(`[qa-guest] wrote ${findings.length} findings → ${FINDINGS_PATH}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[qa-guest] failed to write findings:', e);
    }
  });
});
