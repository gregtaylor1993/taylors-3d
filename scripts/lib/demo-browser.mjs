// Shared by the headless checks: a static server for the repo and a Chrome page on the demo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export const root = path.resolve(import.meta.dirname, '../..');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };

function findChrome() {
  const chrome = process.env.CHROME_PATH || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found, set CHROME_PATH');
  return chrome;
}

// Opens demo/index.html?query and waits for markers. Returns { page, errors, close }.
export async function openDemo(query = {}, viewport = { width: 1400, height: 560 }) {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  const browser = await puppeteer.launch({
    executablePath: findChrome(), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const close = async () => { await browser.close(); server.close(); };
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !m.location().url?.endsWith('favicon.ico')) errors.push(m.type() + ': ' + m.text());
    });
    await page.setViewport({ deviceScaleFactor: 1, ...viewport });
    const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined));
    await page.goto(`http://localhost:${server.address().port}/demo/index.html?${q}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => {
      const c = document.querySelector('floorplan3d-card');
      return c && c.shadowRoot && c.shadowRoot.querySelectorAll('.fp-marker').length > 0;
    }, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 500));
    return { page, errors, close };
  } catch (e) {
    await close();
    throw e;
  }
}
