/* pull-to-refresh.js — overscroll-top refresh for iOS Safari. */
import { refreshData } from './data-loader.js';
import { setData } from './state.js';

const THRESHOLD = 70;
let startY = 0;
let pulling = false;
let indicator = null;

export function initPullToRefresh(onSuccess) {
  const view = document.getElementById('view');
  if (!view) return;

  indicator = document.createElement('div');
  indicator.className = 'ptr-indicator';
  indicator.textContent = 'Pull to refresh';
  view.parentElement?.insertBefore(indicator, view);

  view.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0 || view.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  view.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) {
      indicator.classList.remove('ptr-visible', 'ptr-ready');
      return;
    }
    indicator.classList.add('ptr-visible');
    indicator.style.transform = `translateY(${Math.min(dy * 0.4, 48)}px)`;
    if (dy >= THRESHOLD) {
      indicator.classList.add('ptr-ready');
      indicator.textContent = 'Release to refresh';
    } else {
      indicator.classList.remove('ptr-ready');
      indicator.textContent = 'Pull to refresh';
    }
  }, { passive: true });

  view.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    const ready = indicator.classList.contains('ptr-ready');
    indicator.classList.remove('ptr-visible', 'ptr-ready');
    indicator.style.transform = '';
    if (!ready) return;

    indicator.textContent = 'Refreshing…';
    indicator.classList.add('ptr-visible');
    try {
      const data = await refreshData();
      setData(data);
      if (onSuccess) onSuccess();
    } catch {
      indicator.textContent = 'Refresh failed';
    } finally {
      setTimeout(() => {
        indicator.classList.remove('ptr-visible');
        indicator.textContent = 'Pull to refresh';
      }, 600);
    }
  }, { passive: true });
}

export function pulseFooterUpdated() {
  const el = document.getElementById('data-version');
  if (!el) return;
  el.classList.add('pulse');
  setTimeout(() => el.classList.remove('pulse'), 1200);
}
