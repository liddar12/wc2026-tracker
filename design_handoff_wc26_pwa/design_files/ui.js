/* WC26 Tracker PWA — UI primitives: SVG marks, pitch motifs, icon set */
window.UI = (function () {
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  function pent(cx, cy, r, rot = 0) {
    const o = [];
    for (let i = 0; i < 5; i++) { const a = ((-90 + i * 72 + rot) * Math.PI) / 180; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return o;
  }
  const P = (p) => p.map((q) => q.map((n) => n.toFixed(2)).join(',')).join(' ');

  function ball(o = {}) {
    const disc = o.disc || '#FFFFFF', panel = o.panel || '#0A5C32', line = o.line || panel, R = 45;
    const cp = pent(50, 50, 15, 0);
    let seams = '';
    cp.forEach(([x, y]) => { const dx = x - 50, dy = y - 50, L = Math.hypot(dx, dy); seams += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(50 + dx / L * R).toFixed(1)}" y2="${(50 + dy / L * R).toFixed(1)}" stroke="${line}" stroke-width="3.2"/>`; });
    let rim = '';
    for (let i = 0; i < 5; i++) { const ang = -90 + 36 + i * 72, a = ang * Math.PI / 180, rx = 50 + Math.cos(a) * (R - 4), ry = 50 + Math.sin(a) * (R - 4); rim += `<polygon points="${P(pent(rx, ry, 7.5, ang + 180))}" fill="${panel}"/>`; }
    return `<svg viewBox="0 0 100 100" ${NS}><circle cx="50" cy="50" r="${R}" fill="${disc}"/><polygon points="${P(cp)}" fill="${panel}"/>${seams}${rim}<circle cx="50" cy="50" r="${R}" fill="none" stroke="${line}" stroke-width="2.4" opacity="0.4"/></svg>`;
  }

  function goalIcon(o = {}) {
    const c = o.color || '#FFFFFF', net = o.net || 'rgba(255,255,255,0.4)';
    let l = '';
    [28, 44, 60, 76].forEach((x) => (l += `<line x1="${x}" y1="20" x2="${x}" y2="74" stroke="${net}" stroke-width="2"/>`));
    [38, 56].forEach((y) => (l += `<line x1="14" y1="${y}" x2="90" y2="${y}" stroke="${net}" stroke-width="2"/>`));
    return `<svg viewBox="0 0 104 84" ${NS}>${l}<line x1="14" y1="20" x2="14" y2="74" stroke="${c}" stroke-width="5.5" stroke-linecap="round"/><line x1="90" y1="20" x2="90" y2="74" stroke="${c}" stroke-width="5.5" stroke-linecap="round"/><line x1="11" y1="20" x2="93" y2="20" stroke="${c}" stroke-width="5.5" stroke-linecap="round"/></svg>`;
  }

  function bigGoal(W, H, o = {}) {
    const c = o.color || 'rgba(255,255,255,0.9)', net = o.net || 'rgba(255,255,255,0.2)', m = W * 0.1, top = 14, postH = H - top;
    let g = ''; const cols = 9;
    for (let i = 1; i < cols; i++) { const x = m + ((W - 2 * m) / cols) * i; g += `<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${top + postH}" stroke="${net}" stroke-width="1"/>`; }
    for (let i = 1; i <= 5; i++) { const y = top + (postH / 6) * i; g += `<line x1="${m}" y1="${y.toFixed(1)}" x2="${W - m}" y2="${y.toFixed(1)}" stroke="${net}" stroke-width="1"/>`; }
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${NS}>${g}<line x1="${m}" y1="${top}" x2="${m}" y2="${top + postH}" stroke="${c}" stroke-width="4" stroke-linecap="round"/><line x1="${W - m}" y1="${top}" x2="${W - m}" y2="${top + postH}" stroke="${c}" stroke-width="4" stroke-linecap="round"/><line x1="${m - 2}" y1="${top}" x2="${W - m + 2}" y2="${top}" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`;
  }

  const ic = (name, sw = 2) => {
    const A = `fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
    const p = {
      home: `<path ${A} d="M3 11.5l9-7.5 9 7.5"/><path ${A} d="M5.5 10v10h13V10"/>`,
      field: `<rect ${A} x="3" y="5" width="18" height="14" rx="2"/><line ${A} x1="12" y1="5" x2="12" y2="19"/><circle ${A} cx="12" cy="12" r="2.6"/>`,
      bracket: `<path ${A} d="M5 4v16"/><path ${A} d="M5 8h5v8H5"/><path ${A} d="M10 12h4"/><path ${A} d="M14 7v10"/><path ${A} d="M14 12h5"/>`,
      picks: `<rect ${A} x="5" y="4" width="14" height="17" rx="2.5"/><path ${A} d="M9 3.5h6v2.5H9z"/><path ${A} d="M8.5 13l2.2 2.2L16 10"/>`,
      trophy: `<path ${A} d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path ${A} d="M7 6H4v1a3 3 0 0 0 3 3"/><path ${A} d="M17 6h3v1a3 3 0 0 1-3 3"/><path ${A} d="M12 13v4"/><path ${A} d="M8.5 20h7"/><path ${A} d="M10 17h4v3h-4z"/>`,
      user: `<circle ${A} cx="12" cy="8" r="3.5"/><path ${A} d="M5.5 20a6.5 6.5 0 0 1 13 0"/>`,
      bell: `<path ${A} d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path ${A} d="M10 19a2 2 0 0 0 4 0"/>`,
      search: `<circle ${A} cx="11" cy="11" r="6"/><path ${A} d="M16 16l4 4"/>`,
      chev: `<path ${A} d="M9 6l6 6-6 6"/>`,
      close: `<path ${A} d="M6 6l12 12M18 6L6 18"/>`,
      share: `<path ${A} d="M12 15V4"/><path ${A} d="M8 8l4-4 4 4"/><path ${A} d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>`,
      plus: `<path ${A} d="M12 5v14M5 12h14"/>`,
      flag: `<path ${A} d="M5 21V4"/><path ${A} d="M5 5h11l-2 3 2 3H5"/>`,
      clock: `<circle ${A} cx="12" cy="12" r="8"/><path ${A} d="M12 8v4l3 2"/>`,
    };
    return `<svg viewBox="0 0 24 24" ${NS}>${p[name] || ''}</svg>`;
  };

  return { ball, goalIcon, bigGoal, ic };
})();
