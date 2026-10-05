// Real pointer checks for the right-hand room/device panel and its reserved scene space.
import fs from 'node:fs';
import path from 'node:path';
import { openDemo, root } from './lib/demo-browser.mjs';

const { page, errors, close } = await openDemo({}, { width: 1280, height: 820 });
const checks = [];
const check = (name, pass, detail) => {
  checks.push(pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ' – ' + JSON.stringify(detail) : ''}`);
};
const waitLayout = async () => {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
async function openDevice() {
  const position = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card');
    const marker = [...card.shadowRoot.querySelectorAll('.fp-marker')].find((el) => el.title.startsWith('Kettle plug'));
    const box = marker.querySelector('.fp-dot').getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  });
  await page.mouse.click(...position);
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._devicePopup.isOpen);
  await waitLayout();
}
async function geometry() {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), popup = c._devicePopup.el;
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
    return { stage: rect(c._stage), scene: rect(c._scene), popup: rect(popup), bar: rect(c._toolbar), map: rect(c._miniMap.el),
      placement: popup.dataset.placement, overflow: document.documentElement.scrollWidth > innerWidth,
      targets: [...popup.querySelectorAll('button')].every((button) => button.getBoundingClientRect().height >= 44),
      calls: window.panelCalls.length };
  });
}

try {
  await page.evaluate(() => {
    document.querySelectorAll('section.theme')[1].remove();
    document.querySelector('main').style.display = 'block';
    const c = document.querySelector('taylors3d-card');
    window.panelCalls = [];
    c._hass.callService = (...args) => { window.panelCalls.push(args); return Promise.resolve(); };
    c.setConfig({ ...c._config, height: '620px', view: 'top', control_panel: 'right' });
  });
  await waitLayout();
  await openDevice();
  let g = await geometry();
  check('wide panel docks right and leaves a separate visible house scene', g.placement === 'right'
    && Math.abs(g.stage.right - g.popup.right - 8) < 1 && g.scene.right <= g.popup.left && g.popup.bottom < g.bar.top, g);
  check('mini-map stays beside the panel and opening sends no device commands', g.map.right <= g.scene.right && g.calls === 0 && g.targets, g);
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'screenshots', 'panel-wide.png') });
  await page.keyboard.press('Escape');
  await waitLayout();
  const closed = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    return { open: c._devicePopup.isOpen, full: Math.abs(c._scene.getBoundingClientRect().width - c._stage.getBoundingClientRect().width) < 1 };
  });
  check('Escape closes controls and restores the full canvas width', !closed.open && closed.full, closed);
  for (const width of [320, 480]) {
    await page.setViewport({ width, height: 820, deviceScaleFactor: 1 });
    await waitLayout();
    await openDevice();
    g = await geometry();
    check(`${width}px panel keeps controls reachable above the bubble bar`, !g.overflow && g.popup.left >= g.stage.left
      && g.popup.right <= g.stage.right && g.popup.bottom < g.bar.top && g.targets && g.calls === 0, g);
    await page.keyboard.press('Escape');
    await waitLayout();
  }
  check('no browser errors', errors.length === 0, errors);
} finally { await close(); }
if (checks.some((pass) => !pass)) process.exitCode = 1;
