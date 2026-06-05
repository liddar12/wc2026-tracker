/* vendor-deps.mjs — R15b (#40): regenerate the self-contained vendor bundles.
 *
 * The app has no build step at runtime, but third-party ESM deps were loaded
 * from esm.sh at runtime — a CDN dependency on the critical path. This script
 * bundles them into single self-contained files under vendor/ that the app
 * imports directly. Pinned versions; bump here + re-run to update.
 *
 * Usage (one-off, not part of the Netlify build):
 *   npm i -D esbuild @supabase/supabase-js@2.107.0 sortablejs@1.15.2
 *   node scripts/vendor-deps.mjs
 *
 * Then commit the changed files in vendor/.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PINS = {
  'supabase-js': { pkg: '@supabase/supabase-js', version: '2.107.0', entry: "export * from '@supabase/supabase-js';" },
  'sortablejs': { pkg: 'sortablejs', version: '1.15.2', entry: "export { default } from 'sortablejs';" },
};

const outDir = join(process.cwd(), 'vendor');
mkdirSync(outDir, { recursive: true });
const work = join(tmpdir(), 'wc26-vendor-build');
mkdirSync(work, { recursive: true });

for (const [name, spec] of Object.entries(PINS)) {
  const entryFile = join(work, `entry-${name}.js`);
  writeFileSync(entryFile, spec.entry, 'utf8');
  const outfile = join(outDir, `${name}.js`);
  await build({
    entryPoints: [entryFile],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    outfile,
    banner: { js: `/* vendored ${spec.pkg}@${spec.version} — regenerate with scripts/vendor-deps.mjs. DO NOT EDIT. */` },
  });
  console.log(`✓ vendored ${spec.pkg}@${spec.version} → vendor/${name}.js`);
}

rmSync(work, { recursive: true, force: true });
console.log('Done. Commit the files under vendor/.');
