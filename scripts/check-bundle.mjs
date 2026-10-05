// Fail if either distributed copy is missing or no longer matches the current source.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';

const output = 'dist/taylors3d-card.js';
const integration = 'custom_components/taylors3d/frontend/taylors3d-card.js';
const built = await esbuild.build({ entryPoints: ['src/taylors3d-card.js'], outfile: output,
  bundle: true, format: 'esm', target: 'es2020', minify: true, sourcemap: false, write: false, logLevel: 'silent' });
const expected = Buffer.from(built.outputFiles[0].contents);
let failed = false;
for (const file of [output, integration]) {
  const actual = await fs.readFile(file).catch(() => null);
  if (!actual || !actual.equals(expected)) {
    console.error(`${file} is missing or stale. Run npm run build before distributing this card.`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log(`Both card bundles match the current source. SHA-256: ${crypto.createHash('sha256').update(expected).digest('hex')}`);
