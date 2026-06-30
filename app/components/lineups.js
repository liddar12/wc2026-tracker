import { formationPitch } from './formation-pitch.js';
import { emptyState } from '../lib/empty-state.js';
/* lineups.js — collapsible Lineups section. Open if data present, TBA otherwise.
 *
 * RJ30.1 Item 1: the two numbered-XI columns are replaced by a one-team-at-a-time
 * formation PITCH with a segmented A/B toggle. Unknown/invalid formations fall back
 * to the numbered list inside formationPitch(); an absent side renders emptyState. */

export function lineupsSection(match, lineups) {
  const sec = document.createElement('details');
  sec.className = 'section lineups-section';
  const key = `${match.team_a}__vs__${match.team_b}`;
  const altKey = `${match.team_b}__vs__${match.team_a}`;
  const data = (lineups || {})[key] || (lineups || {})[altKey] || null;

  sec.open = !!data;
  const summary = document.createElement('summary');
  summary.innerHTML = `<h2>Lineups${data ? '' : ' <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:normal;">— TBA</span>'}</h2>`;
  sec.appendChild(summary);

  if (!data) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Starting elevens are typically posted ~75 minutes before kickoff.';
    sec.appendChild(p);
    return sec;
  }

  // Segmented A/B toggle (one pitch visible at a time so each fits 390px).
  const toggle = document.createElement('div');
  toggle.className = 'fp-toggle';
  toggle.setAttribute('role', 'tablist');
  toggle.setAttribute('aria-label', 'Choose team lineup');

  const panelA = sidePanel(match.team_a, data.team_a, 'a');
  const panelB = sidePanel(match.team_b, data.team_b, 'b');
  panelB.hidden = true;

  const btnA = toggleButton(match.team_a, 'a', true);
  const btnB = toggleButton(match.team_b, 'b', false);
  btnA.setAttribute('aria-controls', panelA.id);
  btnB.setAttribute('aria-controls', panelB.id);
  toggle.appendChild(btnA);
  toggle.appendChild(btnB);

  const select = (which) => {
    const isA = which === 'a';
    btnA.setAttribute('aria-selected', String(isA));
    btnB.setAttribute('aria-selected', String(!isA));
    btnA.classList.toggle('is-active', isA);
    btnB.classList.toggle('is-active', !isA);
    panelA.hidden = !isA;
    panelB.hidden = isA;
  };
  btnA.addEventListener('click', () => select('a'));
  btnB.addEventListener('click', () => select('b'));

  sec.appendChild(toggle);
  const pitches = document.createElement('div');
  pitches.className = 'fp-pitches';
  pitches.appendChild(panelA);
  pitches.appendChild(panelB);
  sec.appendChild(pitches);

  if (data.updated_at) {
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.style.fontSize = '11px';
    meta.textContent = `Lineups updated ${data.updated_at}`;
    sec.appendChild(meta);
  }
  return sec;
}

function toggleButton(teamName, which, selected) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'tab');
  b.setAttribute('aria-selected', String(selected));
  b.setAttribute('data-testid', `fp-toggle-${which}`);
  b.className = 'fp-toggle-btn' + (selected ? ' is-active' : '');
  b.textContent = teamName;
  return b;
}

function sidePanel(teamName, side, which) {
  const panel = document.createElement('div');
  panel.className = 'fp-panel';
  panel.id = `fp-panel-${which}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-label', `${teamName} lineup`);

  const h = document.createElement('h3');
  h.className = 'fp-team';
  h.textContent = teamName;
  panel.appendChild(h);

  if (!side) {
    panel.appendChild(
      emptyState('Lineup not posted', {
        detail: 'Starting XI usually drops ~75 min before kickoff',
        testid: 'fp-empty',
      })
    );
    return panel;
  }
  panel.appendChild(formationPitch(teamName, side));
  return panel;
}
