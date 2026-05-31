/* Generate WC26 asset size variants from originals.
 * Reads assets/wc26/fifa-wc26-logo.jpg + assets/wc26/trionda-ball.webp
 * Writes logo-{32,100,300}.webp and trionda-{32,128}.webp into same folder.
 *
 * Uses `sharp` from npm. Install: `npm install sharp` (or run via `npx sharp-cli`).
 * No system tooling required. Pure JS. Runs in CI.
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets', 'wc26');

const TARGETS = [
  { src: 'fifa-wc26-logo.jpg',  out: 'logo-32.webp',     width: 64,  height: 32 },
  { src: 'fifa-wc26-logo.jpg',  out: 'logo-100.webp',    width: 200, height: null },
  { src: 'fifa-wc26-logo.jpg',  out: 'logo-300.webp',    width: 600, height: null },
  { src: 'trionda-ball.webp',   out: 'trionda-32.webp',  width: 64,  height: 64 },
  { src: 'trionda-ball.webp',   out: 'trionda-128.webp', width: 256, height: 256 },
];

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch (err) {
    console.error('sharp not installed. Run: npm install sharp');
    process.exitCode = 1;
    return;
  }
  for (const t of TARGETS) {
    const srcPath = join(ASSETS, t.src);
    const outPath = join(ASSETS, t.out);
    try {
      const srcBytes = await readFile(srcPath);
      const pipeline = sharp(srcBytes).resize({
        width: t.width,
        height: t.height,
        fit: t.height ? 'cover' : 'inside',
        withoutEnlargement: false,
      }).webp({ quality: 85 });
      const buf = await pipeline.toBuffer();
      await writeFile(outPath, buf);
      const { size } = await stat(outPath);
      console.log(`  ${t.out.padEnd(22)} ${(size / 1024).toFixed(1).padStart(6)} KB`);
    } catch (err) {
      console.error(`  ${t.out}: FAIL — ${err.message}`);
    }
  }
}

main();
