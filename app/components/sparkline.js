/* sparkline.js — tiny SVG sparkline (30×8 default). */

export function sparklineSvg(values, { width = 30, height = 8, className = 'sparkline' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');

  const nums = (values || []).map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length < 2) {
    const y = height / 2;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', String(y));
    line.setAttribute('x2', String(width));
    line.setAttribute('y2', String(y));
    line.setAttribute('class', 'sparkline-flat');
    svg.appendChild(line);
    return svg;
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 0.01;
  const step = width / (nums.length - 1);
  const pts = nums.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 1) - 0.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', pts);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('class', 'sparkline-line');
  svg.appendChild(poly);
  return svg;
}
