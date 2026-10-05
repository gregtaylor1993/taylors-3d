// Browser proof of the saved editing tools, using their visible controls.
// Run after npm run build: node scripts/history-check.mjs (set CHROME_PATH when needed).
import fs from 'node:fs';
import path from 'node:path';
import { openDemo, root } from './lib/demo-browser.mjs';

const failures = [], shots = path.join(root, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const check = (name, passed) => {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}`);
  if (!passed) failures.push(name);
};
const selectorFor = (field) => `[data-field="${field}"]`;

async function control(page, selector, index = 0) {
  const handle = await page.evaluateHandle((selector, index) => document.querySelectorAll('taylors3d-card')[index].shadowRoot.querySelector(selector), selector, index);
  const element = handle.asElement();
  if (!element) throw new Error(`Missing control: ${selector}`);
  await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  return element;
}
async function click(page, selector, index = 0) {
  const element = await control(page, selector, index);
  try { await element.click(); } finally { await element.dispose(); }
}
async function select(page, field, value, index = 0) {
  const element = await control(page, selectorFor(field), index);
  try { await element.select(value); } finally { await element.dispose(); }
}
async function text(page, field, value) {
  const element = await control(page, selectorFor(field));
  try {
    await element.click(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.type(value);
  } finally { await element.dispose(); }
}
async function state(page, index = 0) {
  return page.evaluate((index) => {
    const c = document.querySelectorAll('taylors3d-card')[index], s = c.shadowRoot;
    return {
      layout: c._layout, historySize: c._history.size, grouping: c._history.grouping,
      undo: !s.querySelector('[data-act="history-undo"]')?.disabled,
      redo: !s.querySelector('[data-act="history-redo"]')?.disabled,
      preview: s.querySelector('[data-ovr-preview="measure"]')?.textContent || '',
      alerts: c._alertData?.alerts || [], panel: c._panelName, localPanel: localStorage.getItem('taylors3d.panel'),
      calls: (window.__serviceCalls || []).length, currentView: c.currentView(), viewState: c._viewState,
    };
  }, index);
}
async function key(page, key, shift = false) {
  await page.keyboard.down('Control');
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
}

let session;
try {
  session = await openDemo({ height: '620px', view: 'top', floor: 'ground' }, { width: 1500, height: 760 });
  const { page } = session;
  await page.evaluate(() => { window.__demoMowerPaused = true; window.__serviceCalls = []; });
  await click(page, 'button.edit');
  await click(page, '[data-act="tab"][data-id="overlays"]');
  let data = await state(page);
  check('opening the editor creates no saved edit', !data.undo && !data.redo);

  await select(page, 'ovr-mode', 'temperature');
  await select(page, 'ovr-room', 'r-living');
  await select(page, 'ovr-add-source', 'sensor.living_temperature');
  data = await state(page);
  check('visual room/sensor selections save the actual room ID and explicit average',
    data.layout.room_overlays.bindings['r-living']?.aggregation === 'mean'
    && data.layout.room_overlays.bindings['r-living'].entities[0]?.entity === 'sensor.living_temperature');
  check('the visual preview displays the real sensor reading and units', data.preview.includes('21.4 °C'));
  check('saved changes enable the visible Undo button', data.undo && !data.redo);

  await click(page, '[data-act="history-undo"]');
  data = await state(page);
  check('Undo removes the selected source and offers Redo', !data.layout.room_overlays.bindings['r-living'] && data.redo);
  await click(page, '[data-act="history-redo"]');
  data = await state(page);
  check('Redo restores the sensor and preview', data.layout.room_overlays.bindings['r-living']?.entities[0]?.entity === 'sensor.living_temperature' && data.preview.includes('21.4 °C'));

  // Focus a button so the global shortcut acts on layout history, outside native inputs.
  let button = await control(page, '[data-act="history-undo"]'); await button.focus(); await button.dispose();
  await key(page, 'KeyZ');
  check('Ctrl+Z changes the saved layout through the real keyboard handler', !(await state(page)).layout.room_overlays.bindings['r-living']);
  await key(page, 'KeyZ', true);
  check('Ctrl+Shift+Z restores it', !!(await state(page)).layout.room_overlays.bindings['r-living']);

  // A live sensor update must not take the current field away or become a saved edit.
  const focusResult = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    const input = c.shadowRoot.querySelector('[data-field="ovr-min"]'); input.focus();
    const size = c._history.size;
    c.hass = { ...c.hass, states: { ...c.hass.states, 'sensor.living_temperature': {
      ...c.hass.states['sensor.living_temperature'], state: 'unavailable',
    } } };
    return { same: c.shadowRoot.querySelector('[data-field="ovr-min"]') === input,
      focused: c.shadowRoot.activeElement === input, sameHistory: c._history.size === size };
  });
  data = await state(page);
  check('live updates preserve focused form controls and do not enter Undo history', focusResult.same && focusResult.focused && focusResult.sameHistory);
  check('unavailable readings explain their condition in the visual preview', data.preview.includes('Reading is unavailable'));

  await click(page, '[data-act="ovr-add-alert"]');
  await select(page, 'ovr-alert-entity', 'binary_sensor.smoke_hall');
  await select(page, 'ovr-alert-room', 'r-hall');
  await click(page, '[data-act="ovr-save-alert"]');
  data = await state(page);
  check('the visible alert form saves a located smoke binding', data.layout.alert_bindings[0]?.entity === 'binary_sensor.smoke_hall' && data.layout.alert_bindings[0]?.roomId === 'r-hall');
  const beforeLive = data.historySize;
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    c.hass = { ...c.hass, states: { ...c.hass.states, 'binary_sensor.smoke_hall': {
      ...c.hass.states['binary_sensor.smoke_hall'], state: 'on',
    } } };
  });
  data = await state(page);
  check('live smoke triggers a located alert without creating a saved edit', data.alerts.some((a) => a.active && a.location) && data.historySize === beforeLive);
  await page.screenshot({ path: path.join(shots, 'history-overlay-editor.png'), fullPage: true });

  await click(page, '[data-act="tab"][data-id="mower"]');
  data = await state(page);
  const beforeSlider = data.layout.mower.overlay.opacity, sliderSize = data.historySize;
  const range = await control(page, selectorFor('ov-opacity'));
  const points = await range.evaluate((node) => {
    const r = node.getBoundingClientRect(), fraction = (Number(node.value) - Number(node.min)) / (Number(node.max) - Number(node.min));
    const width = r.width - 16;
    return { x: r.left + 8 + width * fraction, y: r.top + r.height / 2, end: r.left + 8 + width * .25 };
  });
  await range.dispose();
  await page.mouse.move(points.x, points.y); await page.mouse.down();
  await page.mouse.move(points.end, points.y, { steps: 12 }); await page.mouse.up();
  data = await state(page);
  check('one continuous slider drag is one undoable edit', data.layout.mower.overlay.opacity !== beforeSlider && data.historySize === sliderSize + 1 && !data.grouping);
  await click(page, '[data-act="history-undo"]');
  check('Undo restores the full previous slider setting', (await state(page)).layout.mower.overlay.opacity === beforeSlider);

  await click(page, '[data-act="tab"][data-id="views"]');
  const beforeScreen = (await state(page)).historySize;
  await text(page, 'screen-name', 'kitchen-wall');
  await key(page, 'KeyZ');
  check('native text Undo does not change the layout history', (await state(page)).historySize === beforeScreen);
  await text(page, 'screen-name', 'kitchen-wall');
  await click(page, '[data-act="save-screen-name"]');
  data = await state(page);
  check('the screen name saves only to this browser and stays outside layout history', data.panel === 'kitchen-wall' && data.localPanel === 'kitchen-wall' && data.historySize === beforeScreen);
  check('configuration editing and Undo/Redo never send a device service', data.calls === 0);
  await page.screenshot({ path: path.join(shots, 'history-screen-name.png'), fullPage: true });

  // Add view copies the visible Ground floor rather than expanding it to every floor.
  await click(page, '[data-act="vw-add"]');
  await page.waitForFunction(() => document.querySelector('taylors3d-card').currentView()?.source === 'added', { timeout: 5000 });
  data = await state(page);
  check('Add view keeps the current floor selection and saved camera mode', data.currentView.floors?.join(',') === 'ground'
    && data.currentView.camera_mode === 'top' && data.viewState.floors.join(',') === 'ground' && !data.viewState.allFloors);

  // Both editors are attached to window. A real key event from the second card's
  // focused control must be ignored by the first card's earlier window listener.
  const firstBefore = JSON.stringify(data.layout), firstHistorySize = data.historySize;
  await click(page, 'button.edit', 1);
  await click(page, '[data-act="tab"][data-id="overlays"]', 1);
  await select(page, 'ovr-mode', 'temperature', 1);
  await select(page, 'ovr-room', 'r-living', 1);
  await select(page, 'ovr-add-source', 'sensor.living_temperature', 1);
  button = await control(page, '[data-act="history-undo"]', 1); await button.focus(); await button.dispose();
  await key(page, 'KeyZ');
  const secondUndone = await state(page, 1);
  data = await state(page);
  check('with two open editors, Ctrl+Z undoes only the focused second card', !secondUndone.layout.room_overlays.bindings['r-living']
    && JSON.stringify(data.layout) === firstBefore && data.historySize === firstHistorySize);
  await key(page, 'KeyZ', true);
  const secondRedone = await state(page, 1);
  data = await state(page);
  check('two-card keyboard Redo also stays with the focused second editor', secondRedone.layout.room_overlays.bindings['r-living']?.entities[0]?.entity === 'sensor.living_temperature'
    && JSON.stringify(data.layout) === firstBefore && data.historySize === firstHistorySize);
  check('two-card editing still sends no device service', data.calls === 0);
  await page.screenshot({ path: path.join(shots, 'history-two-cards.png'), fullPage: true });
  check('no browser errors', session.errors.length === 0);
  if (session.errors.length) console.error(session.errors.join('\n'));
} finally {
  if (session) await session.close();
}
if (failures.length) throw new Error(`${failures.length} history/editing checks failed: ${failures.join(', ')}`);
console.log('All history and visual editing checks passed.');
