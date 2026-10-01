// Headless check of the demo page: serves the repo, opens demo/index.html in Chrome,
// fails on page errors, writes screenshots/demo-<view>.png.
//   node scripts/screenshot.mjs [--view=3d|top] [--floor=id|all] [--out=file]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const view = args.view || '3d';
const root = path.resolve(import.meta.dirname, '..');
const chrome = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));
if (!chrome) throw new Error('Chrome not found, set CHROME_PATH');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: chrome, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.location().url?.endsWith('favicon.ico')) errors.push(m.type() + ': ' + m.text()); });
  await page.setViewport({ width: 1400, height: 560, deviceScaleFactor: 1 });
  const q = new URLSearchParams({ view, ...(args.floor ? { floor: args.floor } : {}) });
  await page.goto(`http://localhost:${port}/demo/index.html?${q}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => {
    const c = document.querySelector('floorplan3d-card');
    return c && c.shadowRoot && c.shadowRoot.querySelectorAll('.fp-marker').length > 0;
  }, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  const stats = await page.evaluate(() => [...document.querySelectorAll('floorplan3d-card')].map((c) => ({
    markers: c.shadowRoot.querySelectorAll('.fp-marker').length,
    visible: [...c.shadowRoot.querySelectorAll('.fp-marker')].filter((m) => m.style.display !== 'none').length,
    labels: c.shadowRoot.querySelectorAll('.fp-room-label').length,
    chips: [...c.shadowRoot.querySelectorAll('.chip')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')),
  })));
  console.log(JSON.stringify(stats));
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  const out = args.out || path.join(root, 'screenshots', `demo-${view}${args.floor ? '-' + args.floor : ''}.png`);
  await page.screenshot({ path: out });
  console.log('saved', out);
} catch (e) {
  errors.push(String(e));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exit(1);
}
