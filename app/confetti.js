/* confetti.js — H5: pure-canvas confetti burst.
   No deps. Honors prefers-reduced-motion + the in-app reduce-motion class. */

export function showConfetti(opts = {}) {
  if (typeof document === 'undefined') return;
  const rm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.classList.contains('wc-reduce-motion');
  if (rm) return;

  const colors = opts.colors || ['#F43F5E', '#FBBF24', '#22D3EE', '#86EFAC', '#A78BFA', '#FFFFFF'];
  const count = opts.count || 100;
  const duration = opts.duration || 2400;

  const canvas = document.createElement('canvas');
  canvas.className = 'wc-confetti';
  canvas.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    pointer-events: none; width: 100%; height: 100%;
  `;
  document.body.appendChild(canvas);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  // Two burst origins (left + right) for spread
  const particles = [];
  for (let i = 0; i < count; i++) {
    const origin = i % 2 === 0 ? { x: 0, ang: -0.4 } : { x: W, ang: -Math.PI + 0.4 };
    particles.push({
      x: origin.x,
      y: H,
      vx: Math.cos(origin.ang + (Math.random() - 0.5) * 0.6) * (8 + Math.random() * 8),
      vy: Math.sin(origin.ang + (Math.random() - 0.5) * 0.6) * (8 + Math.random() * 8),
      g: 0.18 + Math.random() * 0.06,
      drag: 0.992,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      size: 6 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: Math.random() < 0.5 ? 'rect' : 'circle',
    });
  }

  let raf, start = performance.now();
  const step = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.vy += p.g;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (t < duration) {
      raf = requestAnimationFrame(step);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(step);
}
