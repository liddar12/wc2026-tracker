/* qa-signed-in.spec.mjs — R6 UX audit for the SIGNED-IN archetype.
   Mocks competition state (user + active group), seeds incomplete bracket
   data, walks every key route at mobile + desktop, in dark + light theme,
   and captures findings to tmp/findings-signed-in.json.

   This spec audits only — it does NOT fix code.
*/
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT_PATH = '/Users/jimmyliddar/.claude/jobs/baa1eabe/tmp/findings-signed-in.json';
const findings = [];

function push(route, view, finding, severity, suggestion) {
  findings.push({ route, view, finding, severity, suggestion });
}

const ROUTES = [
  { hash: '#/home', label: 'home' },
  { hash: '#/play', label: 'play' },
  { hash: '#/play/stage/1', label: 'play-stage-1' },
  { hash: '#/play/stage/2', label: 'play-stage-2' },
  { hash: '#/play/stage/3', label: 'play-stage-3' },
  { hash: '#/pools', label: 'pools' },
  { hash: '#/my-brackets', label: 'my-brackets' },
  { hash: '#/my-picks', label: 'my-picks' },
  { hash: '#/bracket', label: 'bracket' },
];

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1024, height: 768 },
];
const THEMES = ['dark', 'light'];

// Synthesize a half-complete group-picks payload (8 of 12 groups have a top-2).
function buildIncompleteGroupPicks() {
  const groups = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const out = {};
  groups.slice(0, 8).forEach((g, i) => {
    out[g] = { first: `team-${g}-1`, second: `team-${g}-2`, third: `team-${g}-3`, fourth: `team-${g}-4` };
  });
  return out;
}

// Synthesize a half-complete bracket draft (some R16 picks, no semis/final).
function buildIncompleteBracketDraft() {
  return {
    poolId: 'pool-qa',
    updatedAt: Date.now(),
    picks: {
      '49': { team: 'team-A-1' },
      '50': { team: 'team-B-1' },
      '51': { team: 'team-C-1' },
      '52': { team: 'team-D-1' },
      // No 103 (3rd place), no 104 (final) — so isCompleteBracketFor() returns false.
    },
  };
}

test.describe('QA SIGNED-IN archetype', () => {
  test.beforeAll(() => {
    try { mkdirSync(dirname(OUT_PATH), { recursive: true }); } catch {}
  });

  test.afterAll(() => {
    writeFileSync(OUT_PATH, JSON.stringify(findings, null, 2));
  });

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`audit ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        // Inject before any page script runs.
        await page.addInitScript(({ vp, theme, gp, draft }) => {
          // Pre-seed localStorage
          localStorage.setItem('wc26.competition.guestMode', '0');
          localStorage.setItem('wc26.competition.guestHandle', 'QA');
          // Fake supabase config so isSupabaseConfigured() returns true.
          localStorage.setItem('wc26.supabase.url', 'https://example.invalid');
          localStorage.setItem('wc26.supabase.anonKey', 'fake-anon-key');
          // Persisted incomplete pool data.
          localStorage.setItem('wc26.grouppicks.pool-qa', JSON.stringify(gp));
          localStorage.setItem('wc26.mybrackets.pool-qa', JSON.stringify(draft));
          localStorage.setItem('wc26.competition.group', 'pool-qa');
          // Theme: set immediately to prevent FOUC swap mid-audit.
          try { document.documentElement.setAttribute('data-theme', theme); } catch {}

          // Stub fetch so supabase calls fail fast instead of hanging.
          const origFetch = window.fetch;
          window.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : (input?.url || '');
            if (url.includes('example.invalid') || url.includes('/auth/v1') || url.includes('/rest/v1')) {
              return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
            }
            return origFetch(input, init);
          };

          // After dom load, inject the mocked competition state and broadcast.
          window.__wc26MockApply = async () => {
            try {
              const mod = await import('/app/competition.js');
              const state = mod.getCompetitionState();
              state.user = { id: 'mock-user-1', email: 'qa@example.com' };
              state.profile = { username: 'QA', favorite_team: null, user_id: 'mock-user-1' };
              state.activeGroup = { id: 'pool-qa', name: 'QA Pool', code: 'silver-otter-4821', visibility: 'public' };
              state.groups = [state.activeGroup, { id: 'pool-qb', name: 'QA Pool B', code: 'cedar-lunar-1212', visibility: 'public' }];
              state.guestMode = false;
              window.dispatchEvent(new CustomEvent('competition:state-change'));
            } catch (e) { console.warn('mock apply failed', e?.message); }
          };
        }, { vp, theme, gp: buildIncompleteGroupPicks(), draft: buildIncompleteBracketDraft() });

        // Initial visit + apply mock.
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__wc26MockApply, null, { timeout: 5_000 }).catch(() => {});
        await page.evaluate(() => window.__wc26MockApply && window.__wc26MockApply());
        await page.waitForTimeout(300);

        for (const r of ROUTES) {
          await page.evaluate((hash) => { location.hash = hash; }, r.hash);
          // Re-apply mock in case route change races init.
          await page.evaluate(() => window.__wc26MockApply && window.__wc26MockApply());
          await page.waitForTimeout(450);

          const ctx = { route: r.label, view: `${vp.name}-${theme}` };

          // --- Horizontal scroll check
          const docOverflow = await page.evaluate(() => {
            const body = document.documentElement;
            return body.scrollWidth - body.clientWidth;
          });
          if (docOverflow > 1) {
            push(r.label, ctx.view, `Horizontal overflow ${docOverflow}px`, 'high',
              'Constrain children to viewport; check long strings and grid widths.');
          }

          // --- Container max-width centering (desktop only)
          if (vp.name === 'desktop') {
            const main = await page.evaluate(() => {
              const el = document.querySelector('#view') || document.querySelector('main');
              if (!el) return null;
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return { w: r.width, leftMargin: r.left, rightMargin: window.innerWidth - r.right,
                maxWidth: cs.maxWidth, mlAuto: cs.marginLeft === 'auto', mrAuto: cs.marginRight === 'auto' };
            });
            if (main) {
              const looksFullBleed = main.w >= 1000 && (main.maxWidth === 'none' || main.maxWidth === '');
              const offCenter = Math.abs(main.leftMargin - main.rightMargin) > 8 && main.w < 1000;
              if (looksFullBleed) {
                push(r.label, ctx.view, `Content area is full-bleed at ${vp.width}px (no max-width on #view); width=${Math.round(main.w)}px`, 'high',
                  'Apply a max-width (~960–1100px) with margin-inline: auto on the #view container so content stays centered on desktop.');
              }
              if (offCenter) {
                push(r.label, ctx.view, `#view not centered (leftMargin=${Math.round(main.leftMargin)} rightMargin=${Math.round(main.rightMargin)})`, 'med',
                  'Center #view with margin-inline: auto.');
              }
            }
          }

          // --- Touch-target audit (interactive elements ≥44×44)
          const tinyButtons = await page.evaluate(() => {
            const sel = 'button, a[href], [role="button"], input[type="button"], input[type="submit"], [data-testid^="tab-"]';
            const out = [];
            document.querySelectorAll(sel).forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return; // hidden
              if (el.closest('[hidden]')) return;
              if (r.width < 44 || r.height < 44) {
                out.push({
                  tag: el.tagName.toLowerCase(),
                  cls: (el.className || '').toString().slice(0, 60),
                  text: (el.textContent || '').trim().slice(0, 40),
                  w: Math.round(r.width), h: Math.round(r.height),
                  testid: el.getAttribute('data-testid') || ''
                });
              }
            });
            return out.slice(0, 12);
          });
          if (tinyButtons.length) {
            push(r.label, ctx.view, `${tinyButtons.length} interactive elements below 44×44px (sample: ${JSON.stringify(tinyButtons.slice(0, 3))})`, 'high',
              'Increase min-height/min-width to 44px on touch affordances; add padding instead of shrinking font.');
          }

          // --- Icon-only buttons missing aria-label
          const unlabeled = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('button, a[role="button"]').forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return;
              const txt = (el.textContent || '').trim();
              const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
              const title = el.getAttribute('title');
              if (!txt && !aria && !title) {
                out.push({ id: el.id || '', cls: (el.className || '').toString().slice(0, 60) });
              }
            });
            return out.slice(0, 10);
          });
          if (unlabeled.length) {
            push(r.label, ctx.view, `${unlabeled.length} icon-only buttons missing aria-label (sample: ${JSON.stringify(unlabeled.slice(0,3))})`, 'high',
              'Add aria-label describing the action.');
          }

          // --- Adjacent touch-target spacing (chip rows)
          const tightRows = await page.evaluate(() => {
            const sel = '.pools-tabs, .stage-strip, .play-stage-strip, .tab-bar, [data-testid="tab-bar"]';
            const out = [];
            document.querySelectorAll(sel).forEach((row) => {
              const kids = Array.from(row.querySelectorAll('button, a'));
              for (let i = 1; i < kids.length; i++) {
                const a = kids[i-1].getBoundingClientRect();
                const b = kids[i].getBoundingClientRect();
                const gap = b.left - a.right;
                if (gap < 8 && gap > -1) {
                  out.push({ container: row.className || row.dataset.testid || '', gap: Math.round(gap) });
                  break;
                }
              }
            });
            return out;
          });
          if (tightRows.length) {
            push(r.label, ctx.view, `Adjacent touch targets <8px apart: ${JSON.stringify(tightRows)}`, 'med',
              'Increase gap to ≥8px between adjacent chips/tabs.');
          }

          // --- Heading hierarchy: should have one h1
          const headingState = await page.evaluate(() => {
            const h1s = document.querySelectorAll('main h1, #view h1');
            const top = document.querySelector('h1');
            return { h1Count: h1s.length, topH1: top?.textContent?.trim().slice(0,50) || '' };
          });
          if (headingState.h1Count > 1) {
            push(r.label, ctx.view, `Multiple <h1> inside main (${headingState.h1Count})`, 'med',
              'Use a single h1 per route and demote subsequent headings to h2/h3.');
          }

          // --- Route-specific audits
          if (r.label === 'pools') {
            const banner = await page.evaluate(() => {
              const b = document.querySelector('[data-testid="pools-finish-banner"]');
              if (!b) return { present: false };
              const list = b.querySelector('.pw-pool-owed-list');
              const items = list ? Array.from(list.querySelectorAll('li')) : [];
              const sample = items.slice(0, 3).map((li) => {
                const r = li.getBoundingClientRect();
                const btn = li.querySelector('button');
                const span = li.querySelector('span');
                const br = btn?.getBoundingClientRect();
                const sr = span?.getBoundingClientRect();
                return {
                  rowH: Math.round(r.height),
                  btnW: br ? Math.round(br.width) : 0,
                  btnH: br ? Math.round(br.height) : 0,
                  gap: (br && sr) ? Math.round(br.left - sr.right) : null,
                };
              });
              return { present: true, count: items.length, sample };
            });
            if (!banner.present) {
              push(r.label, ctx.view, '"Brackets owed" banner not visible (mock fidelity insufficient or no incomplete pools)', 'low',
                'Verify that pools with incomplete brackets render the banner; this run may be flagged because mock state did not survive init.');
            } else {
              const smallBtns = banner.sample.filter((s) => s.btnH < 44 || s.btnW < 44);
              if (smallBtns.length) {
                push(r.label, ctx.view, `"Brackets owed" CTA buttons under 44px: ${JSON.stringify(smallBtns)}`, 'high',
                  'Apply min-height: 44px and adequate horizontal padding to .pick-btn-secondary inside .pw-pool-owed-list li.');
              }
              const tightGap = banner.sample.filter((s) => s.gap !== null && s.gap < 8);
              if (tightGap.length) {
                push(r.label, ctx.view, `Banner row text/button gap <8px: ${JSON.stringify(tightGap)}`, 'med',
                  'Add gap/column-gap on the li flex container so the label and CTA do not touch.');
              }
            }
          }

          if (r.label === 'my-brackets') {
            const mbState = await page.evaluate(() => {
              const help = document.querySelector('.help-card, [data-help-card]');
              const grid = document.querySelector('.bb-grid, .bb-bracket, .my-brackets-grid, [data-testid^="bracket-"]');
              const tiles = grid ? Array.from(grid.querySelectorAll('button, [role="button"]')) : [];
              const tinyTiles = tiles.filter((t) => {
                const r = t.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44);
              }).slice(0, 6).map((t) => {
                const r = t.getBoundingClientRect();
                return { w: Math.round(r.width), h: Math.round(r.height), txt: (t.textContent||'').trim().slice(0,30) };
              });
              return { helpPresent: !!help, gridPresent: !!grid, tinyTiles };
            });
            if (!mbState.helpPresent) {
              push(r.label, ctx.view, 'Help card missing on My Brackets', 'low',
                'Confirm helpCard mount; may be expected when collapsed.');
            }
            if (!mbState.gridPresent) {
              push(r.label, ctx.view, 'Bracket grid container not detected on My Brackets', 'med',
                'Verify selectors / render path when signed in with an active pool.');
            }
            if (mbState.tinyTiles.length) {
              push(r.label, ctx.view, `Bracket tiles under 44×44: ${JSON.stringify(mbState.tinyTiles)}`, 'high',
                'Use min-height:44px on bracket pick tiles for thumb usability.');
            }
          }

          if (r.label === 'my-picks') {
            const lbState = await page.evaluate(() => {
              const rows = Array.from(document.querySelectorAll('.my-picks-leaderboard li, [data-testid="leaderboard-row"]'));
              const sample = rows.slice(0, 6).map((row) => {
                const r = row.getBoundingClientRect();
                const cs = getComputedStyle(row);
                return { h: Math.round(r.height), borderBottom: cs.borderBottomColor, borderTop: cs.borderTopColor };
              });
              return { count: rows.length, sample };
            });
            if (lbState.count > 0) {
              const tooShort = lbState.sample.filter((s) => s.h < 44);
              if (tooShort.length) {
                push(r.label, ctx.view, `Leaderboard rows under 44px tall: ${JSON.stringify(tooShort)}`, 'high',
                  'Apply min-height:44px to .my-picks-leaderboard li.');
              }
              if (theme === 'dark') {
                const invisDivider = lbState.sample.filter((s) => /rgba\(.*0\)/.test(s.borderBottom) || s.borderBottom === 'rgba(0, 0, 0, 0)');
                if (invisDivider.length === lbState.sample.length && lbState.sample.length > 1) {
                  push(r.label, ctx.view, 'Leaderboard row dividers invisible in dark mode', 'med',
                    'Use a token-based border-color with adequate contrast in dark theme.');
                }
              }
            }
          }

          // --- Body text + muted contrast sample
          const contrast = await page.evaluate(() => {
            function rel(c) {
              const a = c.match(/[\d.]+/g)?.map(Number) || [];
              const [R,G,B] = [a[0]||0, a[1]||0, a[2]||0].map((v) => {
                const s = v/255;
                return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4);
              });
              return 0.2126*R + 0.7152*G + 0.0722*B;
            }
            function ratio(a, b) {
              const L1 = rel(a), L2 = rel(b);
              const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
              return (hi + 0.05) / (lo + 0.05);
            }
            function bg(el) {
              let n = el;
              while (n) {
                const cs = getComputedStyle(n);
                if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') return cs.backgroundColor;
                n = n.parentElement;
              }
              return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';
            }
            const out = [];
            const body = document.querySelector('p, li, span');
            const muted = document.querySelector('.muted');
            [body, muted].forEach((el, i) => {
              if (!el) return;
              const cs = getComputedStyle(el);
              const fz = parseFloat(cs.fontSize);
              const r = ratio(cs.color, bg(el));
              out.push({ kind: i === 0 ? 'body' : 'muted', fz, ratio: Math.round(r*100)/100, color: cs.color, bg: bg(el) });
            });
            return out;
          });
          for (const c of contrast) {
            if (c.kind === 'body' && c.fz < 14) {
              push(r.label, ctx.view, `Body font ${c.fz}px (<16px)`, 'med',
                'Bump default body text to ≥16px on mobile to meet readability.');
            }
            if (c.kind === 'body' && c.ratio < 4.5) {
              push(r.label, ctx.view, `Body contrast ${c.ratio}:1 (<4.5) in ${theme} mode`, 'high',
                'Increase foreground/background contrast to meet WCAG AA.');
            }
            if (c.kind === 'muted' && c.ratio < 3) {
              push(r.label, ctx.view, `Muted text contrast ${c.ratio}:1 (<3) in ${theme} mode`, 'med',
                'Pick a muted token with ≥3:1 in this theme.');
            }
          }

          // --- Skip link + focusable nav
          if (r.label === 'home') {
            const skipState = await page.evaluate(() => {
              const skip = document.querySelector('a.skip-link, [data-testid="skip-link"], a[href="#view"], a[href="#main"]');
              return skip ? { present: true, txt: skip.textContent?.trim() } : { present: false };
            });
            if (!skipState.present) {
              push(r.label, ctx.view, 'No skip-link detected on home', 'med',
                'Add a visible-on-focus skip-link as first focusable element.');
            }
          }

          // --- aria-current on active tab
          const navState = await page.evaluate(() => {
            const bar = document.querySelector('[data-testid="tab-bar"]');
            if (!bar) return { hasBar: false };
            const active = bar.querySelector('[aria-current="page"], .is-active');
            return { hasBar: true, hasAriaCurrent: !!bar.querySelector('[aria-current="page"]') };
          });
          if (navState.hasBar && !navState.hasAriaCurrent) {
            push(r.label, ctx.view, 'Active nav tab missing aria-current="page"', 'med',
              'Set aria-current="page" on the matching tab when route changes.');
          }
        }
      });
    }
  }
});
