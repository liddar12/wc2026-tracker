/* escape.js — R14: single canonical HTML escaper. Before R14 this function
   was copy-pasted into ~45 modules with subtly different implementations
   (some not null-safe). Import from here so the behavior is consistent and
   testable. */

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* For values interpolated into a double-quoted HTML attribute. escapeHtml
   already neutralizes the dangerous chars; this alias documents intent. */
export const escapeAttr = escapeHtml;
