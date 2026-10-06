// Shared by the headless checks: a static server for the repo and a Chrome page on the demo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export const root = path.resolve(import.meta.dirname, '../..');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png' };

function findChrome() {
  const chrome = process.env.CHROME_PATH || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found, set CHROME_PATH');
  return chrome;
}

// Static server + headless Chrome. Returns { browser, base, close }.
export async function launch() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findChrome(), headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
  } catch (error) {
    // The server already owns a listening handle even when Chrome fails before
    // a transport can be returned. Await its release and retain the real error.
    await new Promise((resolve) => server.close(() => resolve()));
    throw error;
  }
  const close = async () => { await browser.close(); server.close(); };
  return { browser, base: `http://localhost:${server.address().port}`, close };
}

// A page that records errors and console warnings (GPU driver chatter excluded).
export async function newPage(browser, viewport = { width: 1400, height: 560 }) {
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (['error', 'warn', 'warning'].includes(m.type()) && !m.location().url?.endsWith('favicon.ico') && !m.text().includes('GL Driver Message')) errors.push(m.type() + ': ' + m.text());
  });
  await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  return { page, errors };
}

// Opens demo/index.html?query and waits for markers. Returns { page, errors, close }.
export async function openDemo(query = {}, viewport = { width: 1400, height: 560 }) {
  const { browser, base, close } = await launch();
  try {
    const { page, errors } = await newPage(browser, viewport);
    const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined));
    // The live preview refreshes images/state. Wait for the document and the actual card
    // below, rather than requiring every network request to stay idle together.
    // Model checks add their own readiness predicates (including expected load errors).
    await page.goto(`${base}/demo/index.html?${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const c = document.querySelector('taylors3d-card');
      return c && c.shadowRoot && c.shadowRoot.querySelectorAll('.fp-marker').length > 0;
    }, { timeout: query.model ? 30000 : 10000 }); // model parsing may finish after DOMContentLoaded
    await new Promise((r) => setTimeout(r, 500));
    return { page, errors, close, browser, base };
  } catch (e) {
    await close();
    throw e;
  }
}
