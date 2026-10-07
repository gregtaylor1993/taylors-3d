// Real card and native browser input; all HA data, services and model storage
// are simulated. This cannot certify physical device responses or HA internals.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { prepareRoomActionsFixture, serveRoomActionsFixture, roomActionEntities as entities,
  roomActionLayoutKey, roomActionRoomId } from './lib/room-actions-fixture.mjs';

const requested = process.env.GLOBAL_SEARCH_MODE;
if (requested !== undefined && !['source', 'bundle'].includes(requested)) throw Error('GLOBAL_SEARCH_MODE must be source or bundle');
const output = path.join(root, 'screenshots'); fs.mkdirSync(output, { recursive: true });
const checks = [], artifacts = [], errors = [];
let mode = '', scenario = 'initialization';
const check = (name, pass, detail) => {
  checks.push({ mode, scenario, name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${mode} ${scenario}: ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
};
const hash = (name) => createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const runtime = () => Object.fromEntries(['src/taylors3d-card.js', 'src/house-search-data.js', 'src/global-search.js',
  'src/translations/global-search.js', 'dist/taylors3d-card.js'].map((name) => [name, hash(name)]));
const initialRuntime = runtime();
const settle = async (page) => {
  await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return c?._view && !c._loading && !c._view._tween; }, { timeout: 15000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
async function control(page, selector, action) {
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw Error('Missing native control: ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await action(element);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (node) => node.click());
const result = (id) => `[data-global-search] [data-search-id="${id}"]`;
const open = async (page) => {
  await click(page, '.house-search-toggle');
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._search?.isOpen, { timeout: 5000 });
};
const type = (page, value) => control(page, '[data-global-search] input', async (node) => {
  await node.focus(); await page.keyboard.down('Control');
  try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }
  await page.keyboard.press('Backspace'); await page.keyboard.type(value);
});
const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-8;
const sameCamera = (a, b) => ['position', 'target'].every((key) => a?.[key]?.length === b?.[key]?.length && a[key].every((value, index) => near(value, b[key][index])));
const sameRect = (a, b) => ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) < .75);
const snapshot = (page) => page.evaluate(() => {
  const c = document.querySelector('taylors3d-card'), s = c.shadowRoot, search = s.querySelector('[data-global-search]');
  const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const panel = c._devicePopup?._selection;
  const controls = search ? [...search.querySelectorAll('button,input')].map((node) => ({ label: node.textContent || node.getAttribute('aria-label'), ...box(node), fits: node.scrollWidth <= node.clientWidth + 1 })) : [];
  const dialog = search?.querySelector('.search-dialog');
  return { open: !!c._search?.isOpen, mode: c._mode, view: c._viewId, camera: c._view.getCamera(), scene: box(c._scene), stage: box(c._stage),
    popup: panel ? { kind: panel.kind, room: panel.room?.id, entity: panel.marker?.entityId } : null,
    editing: !!c._editing, tab: c._edit?.tab, calls: window.roomActionsFixture.calls.length, commits: window.roomActionsFixture.commits,
    results: search ? [...search.querySelectorAll('[data-search-id]')].map((node) => node.dataset.searchId) : [],
    groups: search ? [...search.querySelectorAll('.search-group h3')].map((node) => node.textContent) : [],
    status: search?.querySelector('.search-status').textContent, controls, dialog: box(dialog), search: box(search),
    surface: dialog && getComputedStyle(dialog).backgroundColor, overflow: document.documentElement.scrollWidth > innerWidth + 1,
    focused: s.activeElement?.dataset.searchId || s.activeElement?.className || s.activeElement?.tagName,
    admin: c._hass.user.is_admin, connected: c._hass.connection.connected, triggerDisabled: c._searchButton.disabled };
});
const shot = async (page, name) => {
  const file = path.join(output, `global-search-${mode}-${name}.png`);
  const card = await page.$('taylors3d-card'); try { await card.screenshot({ path: file }); } finally { await card.dispose(); }
  artifacts.push(file);
};
async function configure(page, width, scheme, style = 'house', height = width < 600 ? '700px' : '900px') {
  await page.setViewport({ width, height: 1120, deviceScaleFactor: 1 });
  await page.evaluate(({ width, scheme, style, height }) => {
    const c = document.querySelector('taylors3d-card'); c._search?.close({ restoreFocus: false }); c._devicePopup.close();
    if (c._editing) c._toggleEdit();
    c.setConfig({ ...c._config, layout_style: style, house_colour_scheme: scheme, height, device_tap_action: 'toggle' });
    c.hass = { ...c._hass, themes: { darkMode: scheme === 'dark' } };
    c._setView('upper', { instant: true }); c._setMode('3d');
    document.body.style.background = scheme === 'dark' ? '#101012' : '#f5f5f7';
    document.body.style.color = scheme === 'dark' ? '#f5f5f7' : '#1d1d1f';
    document.querySelector('main').style.width = `${width - 16}px`;
  }, { width, scheme, style, height });
  await settle(page);
}

const session = await launch();
try {
  for (mode of requested ? [requested] : ['source', 'bundle']) {
    const fixture = await serveRoomActionsFixture(root, mode), { page, errors: pageErrors } = await newPage(session.browser, { width: 1400, height: 1120 });
    try {
      const readings = structuredClone(fixture.readings), layout = structuredClone(fixture.layout);
      readings.states[entities.lamp].attributes.friendly_name = 'Lounge reading lamp';
      readings.states[entities.scene].attributes.friendly_name = 'Bedtime';
      layout.views = { front: { added: true, label: 'Front door', floors: ['upper'], camera_mode: '3d',
        camera: { position: [8, 12, 8], target: [0, 0, 0] }, camera_top: { center: [0, 0], zoom: 1.3 } } };
      for (let n = 0; n < 40; n++) readings.states[`sensor.search_simulated_${n}`] = { entity_id: `sensor.search_simulated_${n}`, state: '1', attributes: { friendly_name: `Simulated searchable device ${n}` } };
      await page.goto(`${fixture.base}/demo/room-actions-fixture.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.roomActionsModuleReady);
      await page.evaluate(prepareRoomActionsFixture, { layout, readings, entities, key: roomActionLayoutKey });
      await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass,
        areas: { ...c._hass.areas, 'simulated-upper': { ...c._hass.areas['simulated-upper'], name: 'Lounge' } } }; });
      await settle(page);
      for (const width of [1400, 390, 320]) for (const scheme of ['dark', 'light']) {
        scenario = `${width}-${scheme}`; await configure(page, width, scheme); const before = await snapshot(page);
        await open(page); let data = await snapshot(page);
        check('actual Search trigger opens grouped controls over the same house', data.open && sameRect(before.scene, data.scene) && sameCamera(before.camera, data.camera), data.groups);
        check('many devices leave room, view, scene and settings groups available', ['Rooms', 'Devices', 'Saved views', 'Scenes', 'Settings'].every((name) => data.groups.includes(name)) && data.status.includes('Showing'), data.status);
        check('search surfaces stay in the stage without horizontal overflow', !data.overflow && data.dialog.x >= data.stage.x && data.dialog.x + data.dialog.width <= data.stage.x + data.stage.width + 1 && data.dialog.height <= data.stage.height, { stage: data.stage, dialog: data.dialog });
        check('native targets remain at least 44px and labels fit', data.controls.every((node) => node.height >= 43.9 && node.width >= 43.9 && node.fits));
        await type(page, 'Lounge'); await shot(page, scenario);
        await type(page, 'no matching item xyz'); data = await snapshot(page);
        check('no-match feedback leaves an editable search open', data.open && data.results.length === 0 && data.status.includes('No matches'));
        await page.keyboard.press('Escape'); data = await snapshot(page);
        check('Escape closes locally and restores Search-button focus', !data.open && data.focused === 'house-search-toggle');
        await open(page); await type(page, 'Lounge reading lamp'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await settle(page); data = await snapshot(page);
        check('friendly device keyboard selection opens controls even with Toggle taps configured', !data.open && data.popup?.entity === entities.lamp && data.calls === before.calls, data.popup);
        await open(page); await type(page, 'Bedtime'); await click(page, result(`scene:${entities.scene}`)); data = await snapshot(page);
        check('scene selection opens controls without activating the scene', !data.open && data.popup?.entity === entities.scene && data.calls === before.calls);
        await open(page); await type(page, 'Lounge'); const roomBefore = await snapshot(page);
        await click(page, result(`room:${roomActionRoomId}`)); data = await snapshot(page);
        check('room selection opens the current room without moving or shrinking the house', data.popup?.room === roomActionRoomId && sameRect(roomBefore.scene, data.scene) && sameCamera(roomBefore.camera, data.camera), data.popup);
        await open(page); await type(page, 'Front door'); await click(page, result('view:front')); data = await snapshot(page);
        check('saved-view result deliberately uses the current saved camera route', data.view === 'front' && data.mode === '3d'
          && sameCamera(data.camera, layout.views.front.camera) && data.calls === before.calls, { view: data.view, mode: data.mode, camera: data.camera });
        await open(page); await type(page, 'Buttons'); await click(page, result('setting:controls')); data = await snapshot(page);
        check('settings search opens the actual grouped button editor', data.editing && data.tab === 'controls' && !data.open && data.calls === before.calls);
        await page.evaluate(() => document.querySelector('taylors3d-card')._toggleEdit()); await settle(page);
        await open(page); await type(page, 'Lounge reading lamp');
        await control(page, result(`device:${entities.lamp}`), (node) => node.focus()); await page.keyboard.press('Tab'); data = await snapshot(page);
        check('Tab at the last result cycles to the close button', data.focused === 'search-close', data.focused);
        await click(page, '.search-close');
        check('search and navigation send no passive HA service or layout save', (await snapshot(page)).calls === before.calls && (await snapshot(page)).commits === before.commits);
      }
      scenario = 'lifecycle'; await configure(page, 390, 'dark'); await open(page);
      await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.searchAdminHass = c._hass; c.hass = { ...c._hass, user: { ...c._hass.user, is_admin: false } }; }); await settle(page);
      check('admin loss closes the old search immediately', !(await snapshot(page)).open);
      await open(page); let data = await snapshot(page); check('read-only search keeps rooms/devices but offers no settings', !data.groups.includes('Settings') && data.groups.includes('Rooms'));
      await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = window.searchAdminHass; }); await settle(page); await open(page);
      await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = false; c.hass = { ...c._hass }; }); await settle(page);
      data = await snapshot(page);
      check('disconnect closes search and disables its trigger', !data.open && data.triggerDisabled, { open: data.open, disabled: data.triggerDisabled, connected: data.connected });
      await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = true; c.hass = { ...c._hass }; }); await settle(page);
      scenario = 'standard-short'; await configure(page, 320, 'light', 'original', '360px'); await open(page); await type(page, 'Lounge');
      data = await snapshot(page); check('short standard card retains scrollable results and a reachable close target', data.open && data.controls.every((node) => node.height >= 43.9) && !data.overflow);
      await shot(page, scenario); await click(page, '.search-close');
      check('short standard overlay closes without changing the selected house view', !(await snapshot(page)).open);
      check('all fixture service calls and layout commits remain zero', (await snapshot(page)).calls === 0 && (await snapshot(page)).commits === 0);
      await open(page); await type(page, 'Lounge reading lamp'); await click(page, result(`device:${entities.lamp}`));
      await click(page, `.taylors3d-device-popup [data-action="toggle"][data-entity="${entities.lamp}"]`);
      const calls = await page.evaluate(() => window.roomActionsFixture.calls);
      check('an explicit device control after search sends exactly one intended simulated request', calls.length === 1
        && calls[0][0] === 'light' && calls[0][1] === 'toggle' && calls[0][2].entity_id === entities.lamp, calls);
      check('fixture made no unexpected HTTP requests', fixture.unexpected.length === 0, fixture.unexpected);
      errors.push(...pageErrors.map((message) => ({ mode, message })));
      check('no browser errors', pageErrors.length === 0, pageErrors);
    } catch (error) { check('exception', false, error.stack || String(error)); errors.push(...pageErrors.map((message) => ({ mode, message }))); }
    finally { await page.close(); await fixture.close(); }
  }
} finally { await session.close(); }
const finalRuntime = runtime();
check('runtime files were unchanged during the native run', JSON.stringify(initialRuntime) === JSON.stringify(finalRuntime));
const receipt = { created: new Date().toISOString(), modes: requested ? [requested] : ['source', 'bundle'], checks, errors, artifacts, runtime: finalRuntime,
  passed: checks.filter((value) => value.pass).length, total: checks.length };
const receiptPath = path.join(output, `global-search-${requested || 'all'}-receipt.json`); fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
console.log(`Search native check: ${receipt.passed}/${receipt.total}; ${receiptPath}`);
if (receipt.passed !== receipt.total || errors.length) process.exitCode = 1;
