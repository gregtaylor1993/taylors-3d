import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const builds = [
  // the card itself, a single ES module for /config/www
  { entryPoints: ['src/floorplan3d-card.js'], outfile: 'dist/floorplan3d-card.js', minify: !watch },
  // demo-only helpers (mock hass, ha-icon stand-in)
  { entryPoints: ['demo/demo.js'], outfile: 'dist/demo.js' },
];

for (const b of builds) {
  const opts = { bundle: true, format: 'esm', target: 'es2020', sourcemap: watch, logLevel: 'info', ...b };
  if (watch) await (await esbuild.context(opts)).watch();
  else await esbuild.build(opts);
}
