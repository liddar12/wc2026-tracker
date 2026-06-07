/* theme.js — light/dark/beta with system fallback.
 * Stores user choice in localStorage under wc26.theme: 'light' | 'dark' | 'beta' | 'auto'.
 */
const LS_KEY = 'wc26.theme';

function effective(pref) {
  if (pref === 'light' || pref === 'dark' || pref === 'beta') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(pref) {
  document.documentElement.dataset.theme = effective(pref);
}

export function initTheme(btn) {
  const pref = localStorage.getItem(LS_KEY) || 'auto';
  apply(pref);

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    const p = localStorage.getItem(LS_KEY) || 'auto';
    if (p === 'auto') apply(p);
  });

  if (btn) {
    btn.addEventListener('click', () => {
      const current = localStorage.getItem(LS_KEY) || 'auto';
      const next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
      localStorage.setItem(LS_KEY, next);
      apply(next);
      btn.setAttribute('aria-label', `Theme: ${next}`);
    });
  }
}
