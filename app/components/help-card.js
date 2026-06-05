/* help-card.js — R6 T10: collapsible "How it works" card used at the top of
   every primary section. State persists in localStorage so repeat visits are
   quiet, but a fresh device sees the help expanded on first view. */

const LS_PREFIX = 'wc26.help.';

export function helpCard({ title, intro, points, persistKey }) {
  const wrap = document.createElement('section');
  wrap.className = 'home-card pw-help-card';
  wrap.dataset.testid = `help-card-${persistKey}`;

  const startCollapsed = readCollapsed(persistKey);
  wrap.classList.toggle('is-collapsed', startCollapsed);

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'pw-help-head';
  head.setAttribute('aria-expanded', startCollapsed ? 'false' : 'true');
  head.innerHTML = `
    <span class="pw-help-title"><span class="pw-help-icon" aria-hidden="true">i</span>${escapeHtml(title)}</span>
    <span class="pw-help-chevron" aria-hidden="true">${startCollapsed ? '▾' : '▴'}</span>
  `;
  head.addEventListener('click', () => {
    const collapsed = !wrap.classList.contains('is-collapsed');
    wrap.classList.toggle('is-collapsed', collapsed);
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    head.querySelector('.pw-help-chevron').textContent = collapsed ? '▾' : '▴';
    writeCollapsed(persistKey, collapsed);
  });
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'pw-help-body';
  body.innerHTML = `
    <p class="pw-help-intro">${escapeHtml(intro)}</p>
    <ul class="pw-help-points">
      ${(points || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}
    </ul>
  `;
  wrap.appendChild(body);
  return wrap;
}

function readCollapsed(key) {
  try { return localStorage.getItem(LS_PREFIX + key) === '1'; } catch { return false; }
}
function writeCollapsed(key, collapsed) {
  try { localStorage.setItem(LS_PREFIX + key, collapsed ? '1' : '0'); } catch {}
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* -- Pre-baked help copy from spec §4 (verbatim) --------------------------- */

export const HELP_COPY = {
  play: {
    title: 'Make your prediction',
    intro: 'Three stages, one bracket. Set your groups, pick the qualifiers, then play it out to a champion — all in one pass. Submit as a guest or signed in.',
    points: [
      "Stage 1 — set each group's finishing order, 1st to 4th.",
      'Stage 2 — rank the 8 best third-place teams. Order sets your Round of 32.',
      'Stage 3 — tap winners through to the Final and the 3rd-place game.',
      'Scoring — group picks: 1st +3, 2nd +2, each correct best-third +1. Knockout: R32 +1, R16 +2, QF +4, SF +8, Final +16, plus +16 if you nail the champion.',
      'Once the group stage finishes you can start straight at the knockouts — your Round of 32 fills in from the real results.',
    ],
  },
  bracket: {
    title: 'How the Bracket tab works',
    intro: 'The tournament as it stands — and how the models see it. This is read-only; make your own picks in Play.',
    points: [
      'Live shows the real bracket and group standings as results come in.',
      'Projected compares Live against the model, a hybrid, market odds, and public consensus.',
      'Switch the projection source to see where the forecasts disagree.',
      'Tap any matchup for the head-to-head detail.',
    ],
  },
  pools: {
    title: 'How Pools work',
    intro: 'Pools are competitions — like a March Madness office bracket, for the World Cup.',
    points: [
      'Create a pool and share its join code (word-word-1234), or join one by code or name.',
      "Pool names are made unique automatically if one's already taken.",
      'Each member submits one bracket as their entry; entries lock at kickoff.',
      "If a pool still needs your bracket, it'll say so — tap to finish in Play.",
    ],
  },
  myBrackets: {
    title: 'How My Brackets work',
    intro: "Your entry in every pool you've joined, and where you stand.",
    points: [
      'Tap a pool to see the bracket you submitted there.',
      'See your rank versus everyone else in that pool.',
      'Score combines your group picks and your weighted knockout bracket.',
      "Haven't submitted yet? Finish it in Play.",
    ],
  },
  myPicks: {
    title: 'How My Picks work',
    intro: 'The leaderboard — where every player stands in your pool.',
    points: [
      'Pick a pool to see its full standings.',
      'Total score = group picks (1st +3, 2nd +2, best-third +1) plus your weighted knockout bracket (R32 +1 → Final +16, champion +16).',
      'Ties break by deepest correct round, then a correct champion, then who submitted first.',
    ],
  },
  matches: {
    title: 'Matches (optional)',
    intro: "Predict individual games if you want to. It's optional and doesn't affect your bracket submission.",
    points: [
      'See how well you call every game, group stage and beyond.',
      'Used for your all-games accuracy and as a possible pool tiebreaker.',
    ],
  },
};
