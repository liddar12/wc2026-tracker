import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = String(process.env.WC26_SUPABASE_URL || '').trim();
const anonKey = String(process.env.WC26_SUPABASE_ANON_KEY || '').trim();

const outPath = join(process.cwd(), 'app', 'preview-config.js');
const banner = '/* Auto-generated at build time. Do not edit by hand. */\n';

if (url && anonKey) {
  const body = `${banner}window.__WC26_CONFIG__ = Object.assign({}, window.__WC26_CONFIG__ || {}, {\n  supabaseUrl: ${JSON.stringify(url)},\n  supabaseAnonKey: ${JSON.stringify(anonKey)}\n});\n`;
  writeFileSync(outPath, body, 'utf8');
  console.log('Wrote app/preview-config.js with Supabase preview config');
} else {
  const body = `${banner}window.__WC26_CONFIG__ = Object.assign({}, window.__WC26_CONFIG__ || {}, window.__WC26_PREVIEW_CONFIG__ || {});\n`;
  writeFileSync(outPath, body, 'utf8');
  console.log('Wrote app/preview-config.js with empty preview config (missing WC26_SUPABASE_URL / WC26_SUPABASE_ANON_KEY)');
}
