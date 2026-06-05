/* score-brackets.mjs — R16 Phase 4: authoritative server-side scorer.
 *
 * Recomputes every pool entry's score from real results and writes the stored
 * group_predictions.score / group_brackets.score so the paginated leaderboard
 * RPC (which ranks by stored score) stays correct at Everyone-pool scale.
 *
 * KEY DESIGN: it reuses the EXACT same JS scorers the client uses
 * (scoreGroupPredictions, scoreBracketWeighted) — no SQL re-port, no drift. It
 * writes score-ONLY updates (picks unchanged), which the lock triggers allow
 * via the 20260605010000 score-exemption.
 *
 * SECRETS: needs WC26_SUPABASE_SERVICE_KEY (service role) as a Netlify env var.
 * Until that is set, the function is DORMANT (no-op) — safe to deploy now;
 * scores are all 0 pre-tournament anyway. Set the key + keep the @hourly
 * schedule to activate it once results start (2026-06-11).
 */

import { createClient } from '../../vendor/supabase-js.js';
import { scoreGroupPredictions } from '../../app/group-scoring.js';
import { scoreBracketWeighted } from '../../app/competition-scoring.js';

export const config = { schedule: '@hourly' };

const URL_BASE = (process.env.WC26_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.WC26_SUPABASE_SERVICE_KEY || '').trim();

async function fetchJson(siteBase, path) {
  const res = await fetch(`${siteBase}${path}`, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

export default async (req, context) => {
  const isScheduled = !!context?.nextRun;
  // Dormant until the service key is provided.
  if (!URL_BASE || !SERVICE_KEY) {
    const msg = 'score-brackets dormant: set WC26_SUPABASE_SERVICE_KEY to activate.';
    console.log(`[score-brackets] ${msg}`);
    return new Response(JSON.stringify({ ok: false, dormant: true, msg }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  const siteBase = process.env.URL || process.env.DEPLOY_PRIME_URL ||
    (req?.url ? new URL(req.url).origin : 'https://worldcup2026.j5lagenticstrategy.com');

  // Assemble the same `data` shape the scorers read.
  const [actualResults, groupMatchups] = await Promise.all([
    fetchJson(siteBase, '/data/actual_results.json'),
    fetchJson(siteBase, '/data/group_matchups.json'),
  ]);
  const data = { actualResults, groupMatchups };

  const sb = createClient(URL_BASE, SERVICE_KEY, { auth: { persistSession: false } });

  const summary = { groupRows: 0, groupUpdated: 0, bracketRows: 0, bracketUpdated: 0, errors: [] };

  // --- group_predictions ---
  {
    const { data: rows, error } = await sb.from('group_predictions').select('group_id,user_id,picks,score');
    if (error) summary.errors.push(`read group_predictions: ${error.message}`);
    for (const r of rows || []) {
      summary.groupRows++;
      let next = 0;
      try { next = scoreGroupPredictions(r.picks, data).score || 0; } catch (e) { summary.errors.push(`score gp ${r.user_id}: ${e.message}`); continue; }
      if (next === (r.score || 0)) continue;
      const { error: upErr } = await sb.from('group_predictions')
        .update({ score: next }).eq('group_id', r.group_id).eq('user_id', r.user_id);
      if (upErr) summary.errors.push(`update gp ${r.user_id}: ${upErr.message}`);
      else summary.groupUpdated++;
    }
  }

  // --- group_brackets ---
  {
    const { data: rows, error } = await sb.from('group_brackets').select('group_id,user_id,picks,score');
    if (error) summary.errors.push(`read group_brackets: ${error.message}`);
    for (const r of rows || []) {
      summary.bracketRows++;
      let next = 0;
      try { next = scoreBracketWeighted(r.picks || [], data).score || 0; } catch (e) { summary.errors.push(`score gb ${r.user_id}: ${e.message}`); continue; }
      if (next === (r.score || 0)) continue;
      const { error: upErr } = await sb.from('group_brackets')
        .update({ score: next }).eq('group_id', r.group_id).eq('user_id', r.user_id);
      if (upErr) summary.errors.push(`update gb ${r.user_id}: ${upErr.message}`);
      else summary.bracketUpdated++;
    }
  }

  console.log('[score-brackets]', JSON.stringify(summary));
  return new Response(JSON.stringify({ ok: summary.errors.length === 0, ...summary }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};
