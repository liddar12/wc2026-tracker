/* results-health.mjs — R15b (#44) DRAFT.
   Two roles in one function:
     1. On-demand HTTP endpoint:  GET /.netlify/functions/results-health
        → JSON health report (200 when ok, 503 when degraded). Point any uptime
          monitor (UptimeRobot, BetterStack, Pingdom) at it for free alerting.
     2. Scheduled run (Netlify cron, hourly): logs a warning when degraded so it
        shows up in the function log / Netlify notifications.

   No secrets needed — it reads the public data files off the deployed site. */

import { computeResultsHealth } from './_lib/results-health-core.mjs';

export const config = {
  // Netlify scheduled function — runs hourly. Remove this block to make the
  // function HTTP-only. https://docs.netlify.com/functions/scheduled-functions/
  schedule: '@hourly',
};

async function fetchJson(base, path) {
  const res = await fetch(`${base}${path}`, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

export default async (req, context) => {
  // Resolve the site origin: explicit env wins, else derive from the request.
  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    (req?.url ? new URL(req.url).origin : 'https://wc2026-tracker.netlify.app');

  let report;
  try {
    const [meta, results] = await Promise.all([
      fetchJson(base, '/data/meta.json'),
      fetchJson(base, '/data/actual_results.json'),
    ]);
    report = computeResultsHealth(meta, results, Date.now());
  } catch (err) {
    report = {
      ok: false,
      phase: 'unknown',
      reasons: [`Failed to fetch data files: ${err.message}`],
      checkedAt: new Date().toISOString(),
    };
  }

  // Scheduled invocation (no normal HTTP request): log + return, don't 503.
  const isScheduled = !!context?.nextRun || req?.headers?.get?.('x-nf-event') === 'schedule';
  if (!report.ok) {
    console.warn('[results-health] DEGRADED:', JSON.stringify(report));
  } else {
    console.log('[results-health] ok:', report.phase, `age=${report.ageHours}h`);
  }
  if (isScheduled) return new Response('scheduled-check-complete', { status: 200 });

  return new Response(JSON.stringify(report, null, 2), {
    status: report.ok ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
