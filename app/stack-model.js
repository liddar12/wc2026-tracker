/* stack-model.js — PROTOTYPE (not yet wired into the app).
 *
 * Pure client-side application of the learned logistic stacker fitted by
 * scripts/proto/build_stacker.py (data/proto/stacker.json). Given the three
 * models' W/D/L probability vectors it returns the blended [a, d, b].
 *
 * Wiring this as a live model source is a Gate-4 step (add to active-model.js +
 * model-picker + a cron that refreshes stacker.json). Kept standalone and
 * unimported so it has zero runtime effect until that step is taken; a feature
 * test (tests/feature/proto-stacker.test.mjs) locks the math against sklearn.
 */

// Build the 12-feature row: each model's [a,d,b] followed by its favourite
// confidence (max prob). Order MUST match stacker.json feature_order.
export function stackerFeatures(j5l, dt, market) {
  const tri = (v) => [v[0], v[1], v[2], Math.max(v[0], v[1], v[2])];
  return [...tri(j5l), ...tri(dt), ...tri(market)];
}

/** Apply the fitted multinomial-logistic stacker.
 *  @param {number[]} feats  12-length row from stackerFeatures()
 *  @param {{coef:number[][],intercept:number[]}} artifact  data/proto/stacker.json
 *  @returns {{a:number,d:number,b:number}} blended probabilities (sum 1)
 */
export function applyStacker(feats, artifact) {
  const { coef, intercept } = artifact;
  const logits = coef.map((row, k) =>
    intercept[k] + row.reduce((s, w, i) => s + w * feats[i], 0));
  const m = Math.max(...logits);
  const exp = logits.map((l) => Math.exp(l - m));
  const z = exp.reduce((s, e) => s + e, 0) || 1;
  const [a, d, b] = exp.map((e) => e / z);
  return { a, d, b };
}

/** Convenience: blend directly from the three model triplets. */
export function stackerBlend(j5l, dt, market, artifact) {
  return applyStacker(stackerFeatures(j5l, dt, market), artifact);
}
