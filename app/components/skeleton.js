/* skeleton.js — placeholder loaders for first paint. */

export function viewSkeleton() {
  const wrap = document.createElement('div');
  wrap.className = 'skeleton-wrap';
  wrap.innerHTML = `
    <div class="skeleton skeleton-bar"></div>
    <div class="skeleton skeleton-card"></div>
    <div class="skeleton skeleton-card"></div>
    <div class="skeleton skeleton-card"></div>
    <div class="skeleton skeleton-card"></div>
  `;
  return wrap;
}
