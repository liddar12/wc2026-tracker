/* active-model.js — R12b: shared model selection. The "active model"
   controls which forecast source is used by:
   - Play stage tiles (analytics chips, "Suggest from <model>" autofill)
   - Bracket Projected mode source switcher
   - My Brackets autofill (still exists for power users)

   Models:
     'j5l'       → user's composite power ranking (data/teams.json composite)
     'kalshi'    → Kalshi tournament-winner + per-match odds
     'hybrid'    → 50/50 average of j5l + kalshi
     'consensus' → most-picked across public-pool brackets
*/

export const MODELS = ['j5l', 'kalshi', 'hybrid', 'consensus'];

export const MODEL_LABELS = {
  j5l: 'J5L Model',
  kalshi: 'Kalshi Market',
  hybrid: 'Hybrid 50/50',
  consensus: 'Public Consensus',
};

export const MODEL_DESCRIPTIONS = {
  j5l: 'My composite power ranking: 0.15·mine + 0.10·elo + 0.45·TMV + 0.30·qual + host multiplier.',
  kalshi: 'Live tournament-winner odds from Kalshi prediction markets.',
  hybrid: '50/50 blend of the J5L model and Kalshi market. Tends to smooth out outliers in either source.',
  consensus: 'The most-picked team at each slot across every public-pool bracket.',
};

// The bracket-autofill.js module already uses single-token keys for the
// same models. Map J5L → 'model' there.
export const MODEL_TO_AUTOFILL_SOURCE = {
  j5l: 'model',
  kalshi: 'kalshi',
  hybrid: 'hybrid',
  consensus: 'consensus',
};

const LS_ACTIVE = 'wc26.activeModel';
const LS_DEFAULT = 'wc26.settings.defaultModel';

export function getDefaultModel(storage) {
  storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return 'j5l';
  try {
    const v = storage.getItem(LS_DEFAULT);
    if (v && MODELS.includes(v)) return v;
  } catch {}
  return 'j5l';
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
  if (!storage) return 'j5l';
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
