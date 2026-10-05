// Real browser UI + native custom-element lifecycle. The player is a labelled fixture,
// so this verifies our HA-player boundary, not a household camera's video connection.
import fs from 'node:fs';
import path from 'node:path';
import { openDemo, root } from './lib/demo-browser.mjs';

const { page, errors, close } = await openDemo({}, { width: 1280, height: 920 });
const checks = [];
const check = (name, pass, detail) => {
  checks.push(pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ' – ' + JSON.stringify(detail) : ''}`);
};
const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const ready = () => page.waitForFunction(() => document.querySelector('taylors3d-card')._devicePopup.cameraFeed.status === 'ready');
async function click(selector) {
  const button = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = button.asElement();
    if (!element) throw new Error('Missing camera control: ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await element.click();
  } finally { await button.dispose(); }
  await settle();
}
async function statePatch(changes) {
  await page.evaluate((changes) => {
    const c = document.querySelector('taylors3d-card');
    c.hass = { ...c._hass, states: { ...c._hass.states, ...changes } };
  }, changes);
  await settle();
}
async function snapshot() {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), feed = c._devicePopup.cameraFeed;
    return { open: c._devicePopup.isOpen, feed: feed.isOpen, status: feed.status, entity: feed.entityId,
      active: window.cameraFixture.active.size, mounted: window.cameraFixture.cards.length,
      detached: window.cameraFixture.cards.filter((card) => !card.isConnected).map((card) => card.disconnections),
      calls: window.cameraFixture.services.length, infos: window.cameraFixture.infos,
      label: feed.el?.querySelector('.t3d-camera-status')?.textContent,
      configs: window.cameraFixture.cards.map((card) => card.config),
      panelMarker: c._devicePopup._selection?.marker?.id, panelTitle: c._devicePopup.el?.getAttribute('aria-label'),
      rows: [...c._devicePopup.el?.querySelectorAll('.t3d-entity') || []].map((el) => el.dataset.entity),
      sectorIds: [...c._cameraCoverage.sectors.keys()], draft: c._cameraCoveragePreview };
  });
}

try {
  await page.evaluate(() => {
    window.__demoMowerPaused = true;
    document.querySelectorAll('section.theme')[1].remove();
    document.querySelector('main').style.display = 'block';
    const c = document.querySelector('taylors3d-card'), ws = c._hass.callWS;
    window.cameraFixture = { cards: [], active: new Set(), services: [], infos: [], mode: 'stream', resolve: null };
    class CameraFixture extends HTMLElement {
      constructor() {
        super(); this.attachShadow({ mode: 'open' }); this.connections = 0; this.disconnections = 0;
        this.shadowRoot.innerHTML = '<div style="height:145px;background:#173347;color:white;display:grid;place-items:center">Test camera · simulated picture</div>';
      }
      connectedCallback() { this.connections++; window.cameraFixture.active.add(this); }
      disconnectedCallback() { this.disconnections++; window.cameraFixture.active.delete(this); }
      set hass(value) { this.lastHass = value; }
    }
    customElements.define('taylors3d-camera-fixture', CameraFixture);
    window.loadCardHelpers = async () => ({ createCardElement(config) {
      const card = document.createElement('taylors3d-camera-fixture'); card.config = config;
      window.cameraFixture.cards.push(card); return card;
    } });
    window.addEventListener('hass-more-info', (event) => window.cameraFixture.infos.push(event.detail.entityId));
    const fixtureWS = async (message) => {
      if (message.type !== 'camera/capabilities') return ws(message);
      const mode = window.cameraFixture.mode;
      if (mode === 'denied') throw { code: 'unauthorized' };
      if (mode === 'unknown') throw { code: 'unknown_command' };
      if (mode === 'deferred') return new Promise((resolve) => { window.cameraFixture.resolve = resolve; });
      return { frontend_stream_types: mode === 'stream' ? ['hls', 'web_rtc'] : [] };
    };
    c.hass = { ...c._hass, callWS: fixtureWS, connection: { connected: true },
      callService: (...args) => { window.cameraFixture.services.push(args); return Promise.resolve(); },
      devices: { ...c._hass.devices, doorbell: { id: 'doorbell', name: 'Front doorbell', area_id: 'hall' } },
      entities: { ...c._hass.entities,
        'light.doorbell': { entity_id: 'light.doorbell', device_id: 'doorbell' },
        'camera.front': { entity_id: 'camera.front', device_id: 'doorbell' } },
      states: { ...c._hass.states,
        'light.doorbell': { entity_id: 'light.doorbell', state: 'off', attributes: { friendly_name: 'Front light' } },
        'camera.front': { entity_id: 'camera.front', state: 'idle', attributes: { friendly_name: 'Front camera' } } } };
    c.setConfig({ ...c._config, height: '700px', view: 'top', control_panel: 'right' });
    c._commit({ ...c._layout, pins: { ...c._layout.pins,
      'device:garden_cam': { x: 17, y: 3, z: 2, floor_id: 'ground' },
      'device:doorbell': { x: 6, y: -2, z: 2, floor_id: 'ground' } } });
  });
  await settle();
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._markers.some((m) => m.id === 'device:doorbell'));
  await page.evaluate(() => document.querySelector('taylors3d-card')._view.stopCameraMotion());
  await settle();
  const markerPosition = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), element = c._markerEls.get('device:doorbell').querySelector('.fp-dot');
    const b = element.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2];
  });
  await page.mouse.click(...markerPosition);
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._devicePopup.isOpen);
  let s = await snapshot();
  check('tapping grouped doorbell opens its controls without starting a camera or a service', s.open && s.panelMarker === 'device:doorbell' && !s.feed && s.calls === 0, s);
  await click('[data-action="camera-view"][data-entity="camera.front"]');
  await ready(); s = await snapshot();
  check('explicit grouped camera action mounts one muted native HA card for the correct entity', s.active === 1 && s.entity === 'camera.front'
    && s.configs[0]?.type === 'picture-entity' && s.configs[0]?.camera_view === 'live' && s.configs[0]?.tap_action?.action === 'none'
    && s.label === 'Camera stream · muted' && s.calls === 0 && s.infos.length === 0, s);
  const continuity = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'), original = c._devicePopup.cameraFeed.nativeCard;
    const next = { ...c._hass, states: { ...c._hass.states, 'camera.front': { ...c._hass.states['camera.front'], state: 'recording' } } };
    c.hass = next;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return original === c._devicePopup.cameraFeed.nativeCard && original.lastHass === next && original.connections === 1 && original.disconnections === 0;
  });
  check('ordinary HA reading updates retain the same connected viewer and supply fresh state', continuity);
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'screenshots', 'camera-panel.png') });
  await click('[data-action="close-camera"]'); s = await snapshot();
  check('Close view removes the player once and leaves device controls open', s.open && !s.feed && s.active === 0 && s.detached.every((count) => count === 1));
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    c._devicePopup.showRoom({ id: 'hall', area_id: 'hall' }, c._markers);
  });
  s = await snapshot(); check('opening a room does not start its cameras', !s.feed && s.active === 0);
  await click('[data-action="camera-view"][data-entity="camera.front"]'); await ready();
  await page.keyboard.press('Escape'); s = await snapshot();
  check('Escape closes room controls and disconnects the actual native element', !s.open && !s.feed && s.active === 0 && s.detached.every((count) => count === 1));
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    c._tap(c._markers.find((m) => m.id === 'device:garden_cam'));
  });
  await ready(); s = await snapshot();
  check('primary camera selection opens its own camera without service calls', s.entity === 'camera.garden' && s.active === 1 && s.calls === 0);
  await click('[data-action="camera-more-info"]'); s = await snapshot();
  check('All controls removes the player before sending HA more-info', !s.open && s.active === 0 && s.infos.join(',') === 'camera.garden');
  for (const mode of ['preview', 'unknown', 'denied']) {
    await page.evaluate((mode) => {
      window.cameraFixture.mode = mode;
      const c = document.querySelector('taylors3d-card'); c._tap(c._markers.find((m) => m.id === 'device:garden_cam'));
    }, mode);
    await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('taylors3d-card')._devicePopup.cameraFeed.status));
    s = await snapshot();
    check(`${mode} capability response is handled honestly`, mode === 'denied' ? s.active === 0 && s.status === 'error' && s.label?.includes('did not allow access')
      : s.active === 1 && s.label === 'Camera view / preview · muted', s.label);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => {
    window.cameraFixture.mode = 'deferred';
    const c = document.querySelector('taylors3d-card'); c._tap(c._markers.find((m) => m.id === 'device:garden_cam'));
  });
  await page.waitForFunction(() => !!window.cameraFixture.resolve);
  const beforeLate = (await snapshot()).mounted;
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.cameraFixture.resolve({ frontend_stream_types: ['hls'] }));
  await settle(); s = await snapshot();
  check('a late response cannot revive a closed camera panel', s.active === 0 && !s.open && s.mounted === beforeLate);
  await page.evaluate(() => { window.cameraFixture.mode = 'stream'; const c = document.querySelector('taylors3d-card'); c._tap(c._markers.find((m) => m.id === 'device:garden_cam')); });
  await ready();
  await statePatch({ 'camera.garden': { entity_id: 'camera.garden', state: 'unavailable', attributes: { friendly_name: 'Garden camera' } } });
  s = await snapshot();
  check('an unavailable camera removes playback and offers a clearly labelled Retry', s.active === 0 && s.status === 'unavailable');
  await statePatch({ 'camera.garden': { entity_id: 'camera.garden', state: 'idle', attributes: { friendly_name: 'Garden camera' } } });
  s = await snapshot(); check('recovery waits for deliberate Retry', s.active === 0 && s.status === 'error' && s.label?.includes('Choose Retry'));
  await click('[data-action="retry-camera"]'); await ready();
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._toggleEdit(); });
  s = await snapshot(); check('entering edit mode removes the native camera element', s.active === 0 && !s.open);
  await click('[data-act="tab"][data-id="cameras"]');
  await page.select('taylors3d-card >>> [data-field="cov-camera"]', 'camera.garden');
  await settle();
  const blank = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), input = (field) => c.shadowRoot.querySelector(`[data-field="${field}"]`).value;
    return ['cov-heading', 'cov-fov', 'cov-range'].every((field) => input(field) === '') && c._cameraCoverage.sectors.size === 0;
  });
  check('new coverage has no invented camera direction, viewing angle or range', blank);
  await click('[data-field="cov-enabled"]');
  for (const [field, value] of [['cov-heading', '90'], ['cov-fov', '70'], ['cov-range', '6']]) {
    await page.evaluate((field) => { const input = document.querySelector('taylors3d-card').shadowRoot.querySelector(`[data-field="${field}"]`); input.focus(); input.select(); }, field);
    await page.keyboard.type(value);
  }
  s = await snapshot();
  check('valid unsaved form previews one cone from the mapped garden position', s.sectorIds.length === 1 && s.draft !== null && s.calls === 0);
  const focused = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector('[data-field="cov-range"]');
    c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.household_other': { state: '14', attributes: {} } } };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return input === c.shadowRoot.querySelector('[data-field="cov-range"]') && c.shadowRoot.activeElement === input && input.value === '6';
  });
  check('HA updates keep a focused unfinished coverage field intact', focused);
  await click('[data-act="cov-save"]');
  const saved = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return c._layout.camera_coverage?.['camera.garden']; });
  s = await snapshot(); check('Save records the explicit cone and clears its temporary draft', saved?.heading === 90 && saved?.fov === 70 && saved?.range === 6 && s.draft === null, saved);
  await page.screenshot({ path: path.join(root, 'screenshots', 'camera-editor.png') });
  await page.evaluate(() => {
    const input = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="cov-range"]');
    input.value = '12'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  s = await snapshot(); check('a later unsaved draft is visibly previewed before history replay', s.draft?.['camera.garden']?.range === 12);
  await click('[data-act="history-undo"]'); s = await snapshot();
  check('Undo removes saved coverage instead of keeping a draft visible', s.sectorIds.length === 0 && s.draft === null);
  await click('[data-act="history-redo"]'); s = await snapshot();
  check('Redo restores the saved coverage', s.sectorIds.length === 1 && s.draft === null);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._toggleEdit(); });
  await settle();
  await page.screenshot({ path: path.join(root, 'screenshots', 'camera-coverage.png') });
  const idle = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'); c._view.stopCameraMotion();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const frames = c._view.renderer.info.render.frame, sectors = [...c._cameraCoverage.sectors.values()].map((p) => p.fill.geometry);
    for (let i = 0; i < 5; i++) { c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.household_other': { state: String(i), attributes: {} } } }; await new Promise((resolve) => requestAnimationFrame(resolve)); }
    return { before: frames, after: c._view.renderer.info.render.frame, same: sectors.every((g, i) => g === [...c._cameraCoverage.sectors.values()][i]?.fill.geometry) };
  });
  check('unrelated readings keep coverage geometry and the idle renderer unchanged', idle.same && idle.before === idle.after, idle);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._setFloor('first'); });
  await settle(); s = await snapshot(); check('switching floors hides ground-floor coverage', s.sectorIds.length === 0);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._setFloor('ground'); c._tap(c._markers.find((m) => m.id === 'device:garden_cam')); }); await ready();
  await page.setViewport({ width: 320, height: 920, deviceScaleFactor: 1 }); await settle();
  const narrow = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), popup = c._devicePopup.el.getBoundingClientRect(), bar = c._toolbar.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth, bottom: popup.bottom, bar: bar.top,
      width: popup.width, targets: [...c._devicePopup.el.querySelectorAll('button')].filter((button) => button.getClientRects().length > 0)
        .every((button) => button.getBoundingClientRect().height >= 44) };
  });
  check('320px camera panel stays within the screen, scrolls above the bar and keeps touch targets', !narrow.overflow && narrow.width <= 320 && narrow.bottom < narrow.bar && narrow.targets, narrow);
  await page.screenshot({ path: path.join(root, 'screenshots', 'camera-panel-narrow.png') });
  await page.evaluate(() => document.querySelector('taylors3d-card').remove()); await settle(); s = await page.evaluate(() => ({ active: window.cameraFixture.active.size, calls: window.cameraFixture.services.length, detached: window.cameraFixture.cards.filter((c) => !c.isConnected).map((c) => c.disconnections) }));
  check('removing the whole card disconnects every viewer once and sends no services', s.active === 0 && s.calls === 0 && s.detached.every((count) => count === 1), s);
  check('no browser errors', errors.length === 0, errors);
} finally { await close(); }
if (checks.some((pass) => !pass)) process.exitCode = 1;
