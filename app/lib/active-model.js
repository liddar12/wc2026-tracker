/* active-model.js — R12b: shared model selection. The "active model"
   controls which forecast source is used by:
   - Play stage tiles (analytics chips, "Suggest from <model>" autofill)
   - Bracket Projected mode source switcher
   - My Brackets autofill (still exists for power users)

   Models:
     'j5l'    → user's composite power ranking (data/teams.json composite)
     'kalshi' → Kalshi tournament-winner + per-match odds
     'hybrid' → ⅓ J5L + ⅓ DT + ⅓ Markets (forecast hybrid strength)
     'stack'  → "J5L AI Enhanced": ML-calibrated J5L+DT blend whose weight is
                re-fit from this tournament's played results (data/stacker.json)
*/

export const MODELS = ['j5l', 'dt', 'kalshi', 'hybrid', 'stack'];

export const MODEL_LABELS = {
  j5l: 'J5L Model',
  dt: 'DT Model',
  kalshi: 'Markets',
  hybrid: 'Hybrid (⅓·⅓·⅓)',
  stack: 'J5L AI Enhanced',
};

export const MODEL_DESCRIPTIONS = {
  j5l: 'My composite power ranking: 0.15·mine + 0.10·elo + 0.45·TMV + 0.30·qual + host multiplier.',
  // R16: DT sits under the J5L family. Honest framing — it is Elo-anchored
  // today (the player-talent + coaching layer is pending the FBref scrape per
  // the DT pipeline README), Monte-Carlo'd into title odds.
  dt: 'Elo + squad market value blend (0.6/0.4), bivariate-Poisson Monte-Carlo title odds (20k sims).',
  kalshi: 'Live tournament-winner odds from prediction markets.',
  hybrid: 'Equal ⅓ blend of J5L + DT + Markets, run through the Poisson Monte-Carlo bracket.',
  // R17: "J5L AI Enhanced" — an ML-calibrated blend of J5L + DT whose weight is
  // re-fit from this tournament's played results every data refresh (data/stacker.json).
  // Now the DEFAULT forecast across the app.
  stack: 'The default forecast: an ML-calibrated blend of J5L + DT, learning from this World Cup — the J5L/DT weight is re-fit from played results each update.',
};

// The bracket-autofill.js module already uses single-token keys for the
// same models. Map J5L → 'model' there.
export const MODEL_TO_AUTOFILL_SOURCE = {
  j5l: 'model',
  dt: 'dt',
  kalshi: 'kalshi',
  hybrid: 'hybrid',
  stack: 'stack',
};

const LS_ACTIVE = 'wc26.activeModel';
const LS_DEFAULT = 'wc26.settings.defaultModel';

export function getDefaultModel(storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return 'stack';
  try {
    const v = storage.getItem(LS_DEFAULT);
    if (v && MODELS.includes(v)) return v;
  } catch {}
  return 'stack';
}

export function setDefaultModel(model, storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage || !MODELS.includes(model)) return;
  try {
    storage.setItem(LS_DEFAULT, model);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('model:default-change', { detail: { model } }));
    }
  } catch {}
}

export function getActiveModel(storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return 'stack';
  try {
    const v = storage.getItem(LS_ACTIVE);
    if (v && MODELS.includes(v)) return v;
  } catch {}
  return getDefaultModel(storage);
}

export function setActiveModel(model, storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage || !MODELS.includes(model)) return;
  try {
    storage.setItem(LS_ACTIVE, model);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('model:change', { detail: { model } }));
    }
  } catch {}
}

export function modelToAutofillSource(model) {
  return MODEL_TO_AUTOFILL_SOURCE[model] || 'model';
}
