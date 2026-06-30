import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = String(process.env.WC26_SUPABASE_URL || '').trim();
const anonKey = String(process.env.WC26_SUPABASE_ANON_KEY || '').trim();
// RJ30-3: the VAPID PUBLIC key is safe to ship to the client (it's the
// applicationServerKey browsers subscribe with). The PRIVATE key NEVER touches
// this file — it lives only in the Netlify function env (WC26_VAPID_PRIVATE_KEY).
const vapidPublicKey = String(process.env.WC26_VAPID_PUBLIC_KEY || '').trim();

const outPath = join(process.cwd(), 'app', 'preview-config.js');
const banner = '/* Auto-generated at build time. Do not edit by hand. */\n';

function configAssign(fields) {
  const body = Object.entries(fields)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join(',\n');
  return `${banner}window.__WC26_CONFIG__ = Object.assign({}, window.__WC26_CONFIG__ || {}, {\n${body}\n});\n`;
}

if (url && anonKey) {
  const fields = { supabaseUrl: url, supabaseAnonKey: anonKey };
  if (vapidPublicKey) fields.vapidPublicKey = vapidPublicKey;
  writeFileSync(outPath, configAssign(fields), 'utf8');
  console.log(`Wrote app/preview-config.js with Supabase preview config${vapidPublicKey ? ' + VAPID public key' : ''}`);
} else if (vapidPublicKey) {
  // No Supabase preview config, but a VAPID key is set — still expose it (merged
  // over any inline __WC26_PREVIEW_CONFIG__).
  const body = `${banner}window.__WC26_CONFIG__ = Object.assign({}, window.__WC26_CONFIG__ || {}, window.__WC26_PREVIEW_CONFIG__ || {}, {\n  vapidPublicKey: ${JSON.stringify(vapidPublicKey)}\n});\n`;
  writeFileSync(outPath, body, 'utf8');
  console.log('Wrote app/preview-config.js with VAPID public key (no Supabase preview config)');
} else {
  const body = `${banner}window.__WC26_CONFIG__ = Object.assign({}, window.__WC26_CONFIG__ || {}, window.__WC26_PREVIEW_CONFIG__ || {});\n`;
  writeFileSync(outPath, body, 'utf8');
  console.log('Wrote app/preview-config.js with empty preview config (missing WC26_SUPABASE_URL / WC26_SUPABASE_ANON_KEY)');
}
