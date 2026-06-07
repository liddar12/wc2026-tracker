/* beta-nav.js — "The Goal" navigation for the Beta theme.
 *
 * Additive + theme-gated: a goal-FAB + a full-screen pitch menu are injected
 * only while html[data-theme='beta'] is active, and removed otherwise. Nav
 * chips drive the real router (setRoute), so Beta navigation stays in lockstep
 * with the rest of the app. Light/Dark never see any of this.
 *
 * See docs/BETA-DESIGN-SYSTEM.md ("The Goal navigation — spec").
 */
import { setRoute, getState } from './state.js';

const NS = 'http://www.w3.org/2000/svg';

// Minimal icon set (paths lifted from the handoff ui.js icon set).
const ICONS = {
  home: '<path d="M3 11.5l9-7.5 9 7.5"/><path d="M5.5 10v10h13V10"/>',
  field: '<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="12" y1="5" x2="12" y2="19"/><circle cx="12" cy="12" r="2.6"/>',
  bracket: '<path d="M5 4v16"/><path d="M5 8h5v8H5"/><path d="M10 12h4"/><path d="M14 7v10"/><path d="M14 12h5"/>',
  picks: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 3.5h6v2.5H9z"/><path d="M8.5 13l2.2 2.2L16 10"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3"/><path d="M17 6h3v1a3 3 0 0 1-3 3"/><path d="M12 13v4"/><path d="M8.5 20h7"/><path d="M10 17h4v3h-4z"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  flag: '<path d="M5 21V4"/><path d="M5 5h11l-2 3 2 3H5"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

function svg(name, sw = 2) {
  return `<svg viewBox="0 0 24 24" xmlns="${NS}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

// goal-frame mark for the FAB (uprights + crossbar + net).
function goalFrameSvg() {
  const net = 'rgba(6,53,28,0.45)';
  let l = '';
  [28, 44, 60, 76].forEach((x) => (l += `<line x1="${x}" y1="20" x2="${x}" y2="74" stroke="${net}" stroke-width="2"/>`));
  [38, 56].forEach((y) => (l += `<line x1="14" y1="${y}" x2="90" y2="${y}" stroke="${net}" stroke-width="2"/>`));
  return `<svg viewBox="0 0 104 84" xmlns="${NS}">${l}<line x1="14" y1="20" x2="14" y2="74" stroke="currentColor" stroke-width="5.5" stroke-linecap="round"/><line x1="90" y1="20" x2="90" y2="74" stroke="currentColor" stroke-width="5.5" stroke-linecap="round"/><line x1="11" y1="20" x2="93" y2="20" stroke="currentColor" stroke-width="5.5" stroke-linecap="round"/></svg>`;
}

// simple soccer-ball mark for the footer button.
function ballSvg() {
  return `<svg viewBox="0 0 100 100" xmlns="${NS}"><circle cx="50" cy="50" r="45" fill="#fff"/><polygon points="50,38 62,47 57,61 43,61 38,47" fill="#0A5C32"/><circle cx="50" cy="50" r="45" fill="none" stroke="rgba(10,92,50,.5)" stroke-width="3"/></svg>`;
}

// Nav model: route → label/sublabel/icon. Routes match the app router (main.js).
const NAV = [
  { route: 'home', label: 'Home', sub: "Today's matches & your standings", icon: 'home' },
  { route: 'matches', label: 'Matches', sub: 'Fixtures, predictions, live', icon: 'field' },
  { route: 'play', label: 'Play', sub: 'Make your picks', icon: 'picks' },
  { route: 'bracket', label: 'Bracket', sub: 'Knockout projections', icon: 'bracket' },
  { route: 'my-picks', label: 'My Picks', sub: 'Your predictions & points', icon: 'picks' },
  { route: 'pools', label: 'Pools', sub: 'Leagues with friends', icon: 'trophy' },
  { route: 'my-brackets', label: 'My Brackets', sub: 'Your knockout bracket', icon: 'bracket' },
  { route: 'golden-boot', label: 'Golden Boot', sub: 'Top-scorer race & odds', icon: 'trophy' },
  { route: 'schedule', label: 'Schedule', sub: 'Full match calendar', icon: 'clock' },
  { route: 'leaderboard', label: 'Leaderboard', sub: 'Global accuracy board', icon: 'trophy' },
  { route: 'venues', label: 'Venues', sub: 'Stadiums & host cities', icon: 'flag' },
  { route: 'settings', label: 'Settings', sub: 'Account, theme & prefs', icon: 'user' },
];

// route aliases so the active chip lights up regardless of which alias is set.
const ALIAS = {
  matchups: 'matches', picks: 'my-picks', brackets: 'bracket',
  groups: 'group', '': 'home',
};
const norm = (v) => ALIAS[v] || v || 'home';

let fab = null;
let menu = null;
let lastFocus = null;

function isBeta() {
  return document.documentElement.getAttribute('data-theme') === 'beta';
}

function syncActiveChip() {
  if (!menu) return;
  const current = norm(getState().route?.view);
  menu.querySelectorAll('.navchip').forEach((c) => {
    c.classList.toggle('active', norm(c.dataset.route) === current);
  });
}

function openMenu() {
  if (!menu) return;
  lastFocus = document.activeElement;
  syncActiveChip();
  document.body.classList.add('menu-open');
  menu.setAttribute('aria-hidden', 'false');
  // focus the close button so Escape/Tab land inside the dialog.
  setTimeout(() => menu.querySelector('.closebtn')?.focus(), 0);
}

function closeMenu() {
  if (!menu) return;
  document.body.classList.remove('menu-open');
  menu.setAttribute('aria-hidden', 'true');
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  else fab?.focus();
}

function buildFab() {
  if (fab) return;
  fab = document.createElement('button');
  fab.className = 'beta-goal-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open The Goal menu');
  fab.setAttribute('data-testid', 'beta-goal-fab');
  fab.innerHTML = goalFrameSvg();
  fab.addEventListener('click', openMenu);
  document.body.appendChild(fab);
}

function buildMenu() {
  if (menu) return;
  menu = document.createElement('div');
  menu.className = 'goalmenu';
  menu.id = 'beta-goalmenu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-modal', 'true');
  menu.setAttribute('aria-label', 'The Goal — navigation');
  menu.setAttribute('aria-hidden', 'true');
  menu.setAttribute('data-testid', 'beta-goalmenu');
  const chips = NAV.map((n, i) => `
    <button class="navchip" type="button" data-route="${n.route}" style="transition-delay:${40 + i * 28}ms">
      <span class="ni">${svg(n.icon)}</span>
      <span class="nt"><b>${n.label}</b><span>${n.sub}</span></span>
      <span class="ch">${svg('chev')}</span>
    </button>`).join('');
  menu.innerHTML = `
    <div class="field"></div>
    <div class="stripeov"></div>
    <div class="mtop">
      <span class="lbl">The Goal</span>
      <button class="closebtn" type="button" aria-label="Close menu" data-testid="beta-goalmenu-close">${svg('close')}</button>
    </div>
    <nav class="navlist" aria-label="Primary">${chips}</nav>
    <div class="mfoot">
      <button class="ballbtn" type="button" aria-label="Close menu">${ballSvg()}</button>
      <small>Tap a destination</small>
    </div>`;

  // backdrop (the pitch field) closes the menu.
  menu.querySelector('.field')?.addEventListener('click', closeMenu);
  menu.querySelector('.closebtn')?.addEventListener('click', closeMenu);
  menu.querySelector('.ballbtn')?.addEventListener('click', closeMenu);
  menu.querySelectorAll('.navchip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const route = chip.dataset.route;
      closeMenu();
      // navigate after the close paints so the transition reads cleanly.
      setTimeout(() => setRoute(route, {}), 0);
    });
  });
  document.body.appendChild(menu);
}

function activate() {
  buildFab();
  buildMenu();
  fab.style.display = '';
  syncActiveChip();
}

function deactivate() {
  closeMenu();
  if (fab) fab.style.display = 'none';
}

export function initBetaNav() {
  // Escape closes the menu (only relevant when open).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) closeMenu();
  });
  // keep the active chip in sync with route changes.
  window.addEventListener('state:change', syncActiveChip);

  // react to theme switches (Settings sets html[data-theme]).
  const apply = () => (isBeta() ? activate() : deactivate());
  const obs = new MutationObserver((muts) => {
    if (muts.some((m) => m.attributeName === 'data-theme')) apply();
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  apply();
}
