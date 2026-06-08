/* tooltip.js — (?) popover explainers. */

const TIPS = {
  composite: 'Composite blends squad value, Elo, qualifying form, and power rankings into one team strength score.',
  upset: 'Upset risk signals flag structural reasons the underdog could outperform (close gap, host advantage, momentum). Severity colors show risk level — not a win/loss prediction.',
  xg: 'Expected goals (xG) estimates scoring chances from shot quality — higher xG usually means more dangerous attack.',
  confidence: 'Model confidence is how strongly the prediction favors one outcome based on composite ratings and match context.',
  market: 'Market odds reflect real-money prices on tournament and match outcomes — implied probability from yes-contract prices.',
};

let openTip = null;

export function tipButton(key, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tip-btn';
  btn.setAttribute('aria-label', `Explain ${label}`);
  btn.textContent = '?';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleTip(btn, TIPS[key] || label);
  });
  return btn;
}

function toggleTip(anchor, text) {
  if (openTip) {
    openTip.remove();
    openTip = null;
  }
  const pop = document.createElement('div');
  pop.className = 'tip-popover';
  pop.textContent = text;
  anchor.parentElement?.appendChild(pop);
  openTip = pop;

  const close = (ev) => {
    if (pop.contains(ev.target) || anchor.contains(ev.target)) return;
    pop.remove();
    openTip = null;
    document.removeEventListener('click', close, true);
  };
  setTimeout(() => document.addEventListener('click', close, true), 0);
}

export function sectionHeading(label, tipKey) {
  const h = document.createElement('h2');
  h.className = 'section-heading-with-tip';
  h.append(document.createTextNode(label + ' '));
  if (tipKey) h.appendChild(tipButton(tipKey, label));
  return h;
}
