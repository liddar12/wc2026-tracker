/* watchlist-star.js — star toggle for matches. */
import { isWatchlisted, toggleWatchlist } from '../state.js';

export function watchlistStar(match) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'watch-star';
  btn.setAttribute('aria-label', 'Toggle watchlist');
  const sync = () => {
    const on = isWatchlisted(match);
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? '★' : '☆';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  sync();
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWatchlist(match);
    sync();
  });
  return btn;
}
