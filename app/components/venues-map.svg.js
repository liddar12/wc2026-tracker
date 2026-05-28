/* venues-map.svg.js — vendored simplified SVG basemap of USA, Mexico and Canada.
 *
 * Exports:
 *   BASEMAP_SVG        : raw inner SVG string (no <svg> wrapper) covering the
 *                        three host countries as filled <path> outlines.
 *   VIEWBOX            : "minX minY width height" string matching BASEMAP_SVG.
 *   project(lat, lon)  : returns { x, y } in viewBox units for a (lat, lon).
 *
 * The projection is a simple equirectangular Mercator-ish mapping calibrated
 * empirically against the host-cities so pins land on the right cities. It
 * is intentionally rough — pretty enough for a list-of-venues teaser map,
 * not a navigation aid.
 *
 * The outline shapes are deliberately low-res to keep the bundle small and
 * to avoid baked-in political claims. They are NOT to-scale or production
 * geography.
 */

export const VIEWBOX = '0 0 1000 700';
export const VIEW_W = 1000;
export const VIEW_H = 700;

// Projection: linear lon -> x, mercator-ish lat -> y.
// Calibrated empirically so SoFi (LA), Azteca (CDMX), BC Place (Vancouver),
// and MetLife (NJ) all land near their expected pins.
const LON_MIN = -135;
const LON_MAX = -65;
const LAT_MIN = 15;
const LAT_MAX = 62;

export function project(lat, lon) {
  const xFrac = (lon - LON_MIN) / (LON_MAX - LON_MIN);
  // Mercator y: ln(tan(45+lat/2))
  const mercY = (l) => Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360));
  const yFrac = 1 - (mercY(lat) - mercY(LAT_MIN)) / (mercY(LAT_MAX) - mercY(LAT_MIN));
  return {
    x: xFrac * VIEW_W,
    y: yFrac * VIEW_H
  };
}

// Lightweight country outlines — these are deliberately stylized.
// Built from a hand-picked set of (lat,lon) corner points and projected.
function poly(points) {
  return points.map(([lat, lon], i) => {
    const p = project(lat, lon);
    return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

const CANADA = poly([
  [60, -141], [60, -130], [60, -123], [60, -110], [60, -95],
  [60, -82], [60, -68], [58, -64], [55, -62], [50, -60],
  [49, -67], [49, -75], [49, -84], [49, -89], [49, -95],
  [49, -110], [49, -123], [49, -131], [56, -135], [60, -141]
]);

const USA = poly([
  [49, -123], [49, -110], [49, -95], [49, -89], [49, -84], [49, -75], [49, -67],
  [44, -67], [42, -71], [39, -74], [35, -76], [32, -80], [29, -81], [26, -80],
  [25, -82], [27, -83], [29, -85], [30, -88], [29, -90], [29, -94],
  [27, -97], [26, -98], [26, -100], [29, -104], [31, -108], [32, -114],
  [33, -117], [34, -119], [37, -122], [40, -124], [44, -124], [46, -124],
  [48, -124], [49, -123]
]);

const MEXICO = poly([
  [32, -117], [32, -114], [31, -110], [31, -106], [29, -103],
  [29, -101], [26, -99], [25, -97], [22, -97], [20, -96],
  [18, -94], [16, -93], [15, -92], [15, -91], [16, -88],
  [18, -87], [21, -87], [20, -90], [19, -95], [17, -100],
  [16, -98], [16, -102], [18, -104], [21, -106], [23, -109],
  [27, -114], [30, -116], [32, -117]
]);

export const BASEMAP_SVG = `
  <g class="basemap">
    <path class="country canada" d="${CANADA}" />
    <path class="country usa" d="${USA}" />
    <path class="country mexico" d="${MEXICO}" />
  </g>
`;
