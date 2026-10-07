import { revealEditorTab } from './lib/editor-tab-navigation.mjs';
// Photo-inspired layout proof against the selected real source or built card.
// Synthetic HA observations and native camera-card stand-in are clearly labelled;
// actual card geometry, WebGL sizing, focus and service intent are exercised.
// Run after building: node scripts/house-check.mjs [--source-only|--bundle-only].
// --glb-only isolates the real model case; --rail-only limits the drawn fixture
// to initial desktop; --trace-popup is passive.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual as equal } from 'node:util';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { houseEntities as entities, houseFixtureHtml, houseModelGlb, houseModelIds } from './lib/house-fixture.mjs';

const checks = [], errors = [], shots = path.join(root, 'screenshots');
let label = '', context = 'fixture';
const check = (name, pass, detail) => { checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const near = (a, b, epsilon = 1) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= epsilon;
// OrbitControls repeatedly reconstructs spherical coordinates: the real browser
// showed ~8e-13m numerical drift without movement. A nanometre bound still
// rejects any meaningful automatic pan/orbit while accepting that roundoff.
const samePose = (a, b) => a?.mode === b?.mode && ['position', 'target'].every((key) => a?.[key]?.length === 3 && b?.[key]?.length === 3
  && a[key].every((value, index) => near(value, b[key][index], 1e-9)));
const nav = '[data-house-navigation]';
const navButton = (id) => `${nav} [data-house-navigation-id="${id}"]`;
const popup = '.taylors3d-device-popup';
const field = (name) => `[data-field="house-summary-${name}"]`;
const action = (name) => `[data-act="house-summary-${name}"]`;
const flush = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function ready(page) {
  // A previous settled scene cannot certify a newly queued popup/frame. Start
  // every observation afresh and allow the application's own rAF/RO to finish.
  await page.evaluate(() => { window.houseStable = null; });
  try { await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card'), v = c?._view, now = performance.now();
    if (!v || c._loading || v.dirty || v._tween || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350) {
      window.houseStable = null; return false;
    }
    const rect = c._scene.getBoundingClientRect(), popup = c._devicePopup?.el, popupRect = popup?.getBoundingClientRect();
    const signature = JSON.stringify([rect.x, rect.y, rect.width, rect.height, v.stats.frames,
      c._devicePopup?._session, popup?.getAttribute('data-house-controls-layout'), popupRect?.x, popupRect?.y, popupRect?.width, popupRect?.height]);
    if (window.houseStable?.signature !== signature) { window.houseStable = { signature, at: now }; return false; }
    return now - window.houseStable.at > 350;
  }, { timeout: 15000, polling: 50 }); } catch (error) {
    error.message += `; ${label}${context}; ${JSON.stringify(await snapshot(page).catch(() => null))}`; throw error;
  }
}
async function control(page, selector, callback) {
  await revealEditorTab(page, selector);
  context = `native control ${selector}`;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try { const element = handle.asElement(); if (!element) throw new Error(`Missing house control ${selector}`);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(element);
  } finally { await handle.dispose(); }
  await flush(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const select = (page, selector, value) => control(page, selector, (element) => element.select(value));
const type = async (page, selector, value) => {
  await control(page, selector, async (element) => {
    await element.focus(); await page.keyboard.down('Control');
    try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }
    await page.keyboard.press('Backspace'); await page.keyboard.type(value);
  });
  const actual = await page.evaluate((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector)?.value, selector);
  if (actual !== value) throw new Error(`Native house text replacement produced ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
};
async function screenshot(page, name) {
  fs.mkdirSync(shots, { recursive: true }); const main = await page.$('main');
  try { await main.screenshot({ path: path.join(shots, name) }); } finally { await main.dispose(); }
}

async function open(mode) {
  const transport = await launch(); let session; const pageErrors = [], requests = [];
  try {
    session = await newPage(transport.browser, { width: 1440, height: 1100 }); const { page } = session;
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack, context: label + context }));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/house-layout-fixture.html')
        request.respond({ status: 200, contentType: 'text/html', body: houseFixtureHtml(mode) });
      else if (url.pathname === '/demo/house-bench.glb')
        request.respond({ status: 200, contentType: 'model/gltf-binary', body: houseModelGlb() });
      else request.continue();
    });
    await page.goto(`${transport.base}/demo/house-layout-fixture.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.houseModuleReady, { timeout: 15000 }); await page.bringToFront();
    await page.evaluate(async ({ mode, entities }) => {
      const c = document.querySelector('taylors3d-card'), f = window.houseFixture = { services: [], websocket: [], moreInfo: [], commits: 0,
        resizeCalls: 0, sizeWrites: 0, cameraCreated: 0, cameraDisconnected: 0, cameraConfigs: [] };
      const connection = new EventTarget(); connection.connected = true;
      const state = (entity_id, value, attributes = {}) => ({ entity_id, state: value, attributes });
      const registry = (entity_id, device_id = null, area_id = null, extra = {}) => ({ entity_id, device_id, area_id, hidden_by: null, disabled_by: null, entity_category: null, ...extra });
      const states = {
        [entities.lamp]: state(entities.lamp, 'on', { friendly_name: 'Simulated room lamp', supported_color_modes: ['rgb', 'color_temp'],
          color_mode: 'rgb', brightness: 180, rgb_color: [255, 185, 80], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 }),
        [entities.temperature]: state(entities.temperature, '20.5', { friendly_name: 'Simulated room temperature', device_class: 'temperature', unit_of_measurement: '°C' }),
        [entities.camera]: state(entities.camera, 'idle', { friendly_name: 'Simulated room camera' }),
        [entities.door]: state(entities.door, 'off', { friendly_name: 'Simulated window', device_class: 'window' }),
        [entities.player]: state(entities.player, 'idle', { friendly_name: 'Simulated media player' }),
        [entities.climate]: state(entities.climate, 'heat', { friendly_name: 'Simulated climate', current_temperature: 20.5, temperature: 21 }),
        [entities.parked]: state(entities.parked, 'on', { friendly_name: 'Simulated sustained parking source', device_class: 'occupancy' }),
        [entities.motion]: state(entities.motion, 'on', { friendly_name: 'Simulated drive motion', device_class: 'motion' }),
        [entities.weather]: state(entities.weather, 'cloudy', { friendly_name: 'Simulated weather source', temperature: 12, temperature_unit: '°C' }),
        [entities.person]: state(entities.person, 'home', { friendly_name: 'Simulated selected person' }),
        [entities.alarm]: state(entities.alarm, 'disarmed', { friendly_name: 'Simulated alarm source' }),
        'sensor.house_hidden': state('sensor.house_hidden', '4', { friendly_name: 'Simulated hidden source' }),
        'sun.sun': state('sun.sun', 'below_horizon', { elevation: -18, azimuth: 180 }),
      };
      const registries = Object.fromEntries(Object.keys(states).map((id) => [id, registry(id, null, 'house_room')]));
      registries[entities.lamp] = registry(entities.lamp, 'house_lamp'); registries[entities.temperature] = registry(entities.temperature, 'house_lamp');
      registries['sensor.house_hidden'] = registry('sensor.house_hidden', null, 'house_room', { hidden_by: 'user' });
      const hass = { user: { id: 'house-fixture-admin', is_admin: true, is_active: true }, connection,
        config: { location_name: 'Simulated local house', time_zone: 'Europe/London', latitude: null, longitude: null },
        themes: { darkMode: true }, locale: { language: 'en', number_format: 'language' }, language: 'en',
        states, entities: registries, devices: { house_lamp: { id: 'house_lamp', name: 'Simulated room light and readings', area_id: 'house_room' } },
        areas: { house_room: { area_id: 'house_room', name: 'Simulated living room', floor_id: 'ground' },
          house_upper: { area_id: 'house_upper', name: 'Simulated upper room', floor_id: 'first' } },
        floors: { ground: { floor_id: 'ground', name: 'Simulated ground', level: 0 }, first: { floor_id: 'first', name: 'Simulated upper', level: 1 } },
        services: { light: { turn_on: {}, turn_off: {} }, homeassistant: { toggle: {} }, alarm_control_panel: { alarm_arm_away: {} } },
        callService: (...args) => { f.services.push(args); return Promise.resolve(); } };
      c.setConfig({ height: '640px', layout_key: `house-browser-${mode}`, layout_style: 'original', house_colour_scheme: 'dark',
        view: 'top', floor: 'ground', control_panel: 'popup', device_tap_action: 'controls', mini_map: true });
      c.hass = hass; await c._layoutReady;
      c._commit({ ...c._layout, rooms: [
        { id: 'house_room', area_id: 'house_room', floor_id: 'ground', polygon: [[-4, -3], [4, -3], [4, 3], [-4, 3]], doors: [] },
        { id: 'house_upper', area_id: 'house_upper', floor_id: 'first', polygon: [[-3, -2], [3, -2], [3, 2], [-3, 2]], doors: [] } ],
        floors: [{ id: 'ground', elevation: 0, height: 3 }, { id: 'first', elevation: 3, height: 3 }],
        pins: { 'device:house_lamp': { x: -2, y: 0, z: 0, floor_id: 'ground' }, [`entity:${entities.camera}`]: { x: 2, y: 0, z: 0, floor_id: 'ground' } },
        hidden: [], mower: {}, model: {}, objects: {}, groups: {}, views: {}, room_overlays: { mode: 'off' }, camera_coverage: {},
        alert_bindings: [], security_bindings: [], presence_bindings: [], vacuum_bindings: [],
        vehicle_bindings: [{ id: 'house-parking', entity: entities.parked, kind: 'occupancy', vehicle_source_confirmed: true,
          active_states: ['on'], clear_states: ['off'], roomId: 'house_room', enabled: true }],
        ambient_idle: { enabled: false }, weather: { enabled: false }, scene_previews: { enabled: false },
        house_summary: { title: 'Simulated house layout', weather_entity: entities.weather, person_entities: [entities.person],
          alarm_entity: entities.alarm, fixture_extension: { keep: true } } });
      c.resetHistory();
      const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (...args) => { f.commits++; return commit(...args); };
      window.addEventListener('hass-more-info', (event) => f.moreInfo.push(event.detail.entityId));
      // A real custom-element lifecycle, labelled stand-in. This tests popup
      // sizing/removal, never claims a live HA camera or native middleware proof.
      class SimulatedCamera extends HTMLElement {
        connectedCallback() { this.style.cssText = 'display:block;min-height:168px;background:#253340;color:#f2f5f7;padding:14px;box-sizing:border-box';
          this.textContent = 'SIMULATED native camera-card container · no video connection'; }
        disconnectedCallback() { f.cameraDisconnected++; }
        set hass(value) { this.currentHass = value; }
      }
      customElements.define('house-simulated-native-camera', SimulatedCamera);
      window.loadCardHelpers = async () => ({ createCardElement: (config) => { f.cameraConfigs.push(config); f.cameraCreated++; return document.createElement('house-simulated-native-camera'); } });
      f.originalConfig = { ...c._config }; f.initialHostWidth = c.style.width; f.originalScene = c._scene; f.originalRenderer = c._view.renderer;
      f.previousResize = c._view.resize; c._view.resize = function (...args) { f.resizeCalls++; return f.previousResize.apply(this, args); };
      f.previousSetSize = c._view.renderer.setSize; c._view.renderer.setSize = function (...args) { f.sizeWrites++; return f.previousSetSize.apply(this, args); };
      f.services.length = 0;
    }, { mode, entities });
    await ready(page); return { ...transport, ...session, pageErrors, requests };
  } catch (error) {
    errors.push(...pageErrors, ...(session?.errors || [])); await transport.close(); throw error;
  }
}
async function patch(page, changes = {}, extra = {}) {
  await page.evaluate(({ changes, extra }) => { const c = document.querySelector('taylors3d-card');
    const states = { ...c._hass.states }; for (const [entity, change] of Object.entries(changes)) {
      if (change === null) delete states[entity]; else states[entity] = { ...states[entity], ...change,
        attributes: { ...states[entity]?.attributes, ...change.attributes } };
    } c.hass = { ...c._hass, ...extra, states };
  }, { changes, extra }); await flush(page);
}
async function configure(page, changes) {
  await page.evaluate((changes) => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, ...changes }); }, changes); await ready(page);
}
async function width(page, pixels) {
  context = `actual stage width ${pixels}`;
  await page.evaluate((pixels) => { const c = document.querySelector('taylors3d-card'), delta = c.getBoundingClientRect().width - c._stage.getBoundingClientRect().width;
    c.style.width = `${pixels + delta}px`; }, pixels);
  await ready(page); const actual = (await snapshot(page)).stage.w;
  check(`actual ${pixels}px stage inside a 1440px browser`, near(actual, pixels, .1), actual);
}
async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), s = c.shadowRoot, v = c._view, f = window.houseFixture;
    const rect = (node) => { if (!node || node.hidden || getComputedStyle(node).display === 'none') return null;
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const controls = [...s.querySelectorAll('[data-house-navigation] button,.toolbar button,.taylors3d-device-popup button')]
      .filter((node) => { const box = rect(node); return box && box.w > 0 && box.h > 0; });
    return { stage: rect(c._stage), scene: rect(c._scene), canvas: rect(v.renderer.domElement), header: rect(s.querySelector('[data-taylors3d-summary]')),
      navigation: rect(s.querySelector('[data-house-navigation]')), toolbar: rect(c._toolbar), popup: rect(c._devicePopup.el),
      popupMode: c._devicePopup.el?.dataset.houseControlsLayout, popupTitle: c._devicePopup.el?.querySelector('h3')?.textContent,
      roomSummary: (() => { const node = c._devicePopup.el?.querySelector('.t3d-room-summary'); return node ? { hidden: node.hidden, text: node.textContent } : null; })(),
      rows: [...s.querySelectorAll('.t3d-entity')].map((row) => ({ id: row.dataset.entity, value: row.querySelector('.t3d-entity-value')?.textContent,
        name: row.querySelector('.t3d-entity-name')?.textContent })), mode: c._mode, floor: c._floor, editing: c._editing, tab: c._edit?.tab,
      shellMode: c._stage.dataset.taylors3dShellMode, controls: controls.map((node) => ({ name: node.getAttribute('aria-label') || node.textContent, ...rect(node) })),
      headerText: s.querySelector('[data-taylors3d-summary]')?.textContent, summaryTitle: s.querySelector('[data-taylors3d-summary-title]')?.textContent,
      summaryStates: Object.fromEntries([...s.querySelectorAll('[data-taylors3d-summary-item]')].map((node) => [node.dataset.taylors3dSummaryItem, { hidden: node.hidden, status: node.dataset.status, text: node.textContent }])),
      size: { ...v.size }, buffer: { w: v.renderer.domElement.width, h: v.renderer.domElement.height }, dpr: v.renderer.getPixelRatio(), stats: { ...v.stats },
      gpu: { memory: { ...v.renderer.info.memory }, programs: v.renderer.info.programs.map((program) => program.id) },
      camera: { position: v.camera.position.toArray(), target: v.controls.target.toArray(), mode: v.mode },
      sceneSame: c._scene === f.originalScene, rendererSame: v.renderer === f.originalRenderer, saved: c._layout.house_summary,
      selection: c._houseSelection, navIds: [...s.querySelectorAll('[data-house-navigation-id]')].map((node) => node.dataset.houseNavigationId),
      calls: f.services, websocket: f.websocket, commits: f.commits, resizeCalls: f.resizeCalls, sizeWrites: f.sizeWrites,
      documentOverflow: document.documentElement.scrollWidth > innerWidth, stageOverflow: c._stage.scrollWidth > c._stage.clientWidth,
      headerOverflow: (() => { const node = s.querySelector('[data-taylors3d-summary]'); return !!node && node.scrollWidth > node.clientWidth; })(),
      cameraCreated: f.cameraCreated, cameraDisconnected: f.cameraDisconnected, nativeCamera: !!c._devicePopup.cameraFeed.nativeCard,
      props: Object.fromEntries(['summary-height', 'bar-height', 'navigation-height', 'sheet-height', 'rail-width', 'controls-width'].map((key) => [key, c._stage.style.getPropertyValue(`--taylors3d-${key}`)])),
      popupTrace: f.popupTrace,
    };
  });
}
const overlap = (a, b) => !!a && !!b && a.x < b.r - .5 && b.x < a.r - .5 && a.y < b.b - .5 && b.y < a.b - .5;
async function geometry(page, name, expectedPopup) {
  await ready(page); const s = await snapshot(page), size = near(s.scene.w, s.size.w, .1) && near(s.scene.h, s.size.h, .1)
    && near(s.scene.w, s.canvas.w, .1) && near(s.scene.h, s.canvas.h, .1)
    && near(Math.floor(s.size.w * s.dpr), s.buffer.w, 1) && near(Math.floor(s.size.h * s.dpr), s.buffer.h, 1);
  const protectedBoxes = [s.header, s.navigation, s.toolbar, s.popup].filter(Boolean);
  check(`${name}: renderer is the exact reserved scene and retains 240px height`, size && s.scene.h >= 239.9, { scene: s.scene, canvas: s.canvas, size: s.size, buffer: s.buffer });
  check(`${name}: scene avoids header/navigation/toolbar/popup`, protectedBoxes.every((box) => !overlap(box, s.scene)), { stage: s.stage, scene: s.scene, protectedBoxes });
  check(`${name}: popup avoids header and both bottom rows`, !s.popup || ![s.header, s.navigation, s.toolbar].some((box) => overlap(box, s.popup)), { popup: s.popup, header: s.header, navigation: s.navigation, toolbar: s.toolbar });
  check(`${name}: no stage/header/page horizontal overflow`, !s.stageOverflow && !s.headerOverflow && !s.documentOverflow, s);
  check(`${name}: visible native controls have 44px touch targets`, s.controls.every((box) => box.w >= 43.9 && box.h >= 43.9), s.controls.filter((box) => box.w < 43.9 || box.h < 43.9));
  if (expectedPopup) check(`${name}: actual popup uses ${expectedPopup}`, !!s.popup && s.popupMode === expectedPopup, { mode: s.popupMode, popup: s.popup });
  return s;
}
async function contrast(page, editor = false) {
  return page.evaluate((editor) => {
    const c = document.querySelector('taylors3d-card'), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((v) => v / 255); };
    const blend = (front, back) => [...front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3])), 1];
    const background = (node) => { const chain = []; for (let current = node; current; current = current.parentElement || current.getRootNode()?.host) chain.push(current);
      return chain.reverse().reduce((color, current) => blend(rgba(getComputedStyle(current).backgroundColor), color), [1, 1, 1, 1]); };
    const lum = (values) => values.slice(0, 3).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const runtime = '[data-house-navigation] button,.toolbar button,.taylors3d-device-popup button,[data-taylors3d-summary-title],[data-taylors3d-summary-meta],[data-taylors3d-summary-item]';
    const panel = '.panel p,.panel label,.panel h3,.panel h4,.panel .hint,.panel .dim,.panel [role="status"] li,.panel button,.panel input:not([type="checkbox"]):not([type="range"]):not([type="color"]),.panel select';
    return [...c.shadowRoot.querySelectorAll(editor ? `${runtime},${panel}` : runtime)]
      .filter((node) => !node.disabled && !node.hidden && !node.closest('[hidden]') && node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== 'none')
      .map((node) => { const bg = background(node), fg = blend(rgba(getComputedStyle(node).color), bg), a = lum(bg), b = lum(fg);
        return { name: node.getAttribute('aria-label') || node.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), fg, bg }; });
  }, editor);
}
async function haPalette(page, dark) {
  await page.evaluate((dark) => { const c = document.querySelector('taylors3d-card');
    for (const [key, value] of Object.entries(dark ? { 'card-background-color': '#1d2933', 'primary-text-color': '#f2f5f7', 'secondary-text-color': '#c6d4df', 'divider-color': '#81909c' }
      : { 'card-background-color': '#fff', 'primary-text-color': '#212121', 'secondary-text-color': '#595959', 'divider-color': '#777' })) c.style.setProperty(`--${key}`, value);
    c.hass = { ...c._hass, themes: { ...c._hass.themes, darkMode: dark } };
  }, dark); await ready(page);
}

async function editorVisuals(page, name, narrow = false) {
  const s = await geometry(page, name), ratios = await contrast(page, true);
  check(`${name}: actual panel paragraphs, help/status, labels, fields and tabs reach AA normal-text contrast`, ratios.every((row) => row.ratio >= 4.5), ratios.filter((row) => row.ratio < 4.5));
  const panel = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), root = c._edit.panel;
    const bounds = (node) => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, r: box.right, b: box.bottom, w: box.width, h: box.height }; };
    const visible = (node) => !node.hidden && !node.closest('[hidden]') && node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== 'none';
    return { rect: bounds(root), card: bounds(c), paragraphs: [...root.querySelectorAll('p')].filter(visible).length,
      labels: [...root.querySelectorAll('label')].filter(visible).length, horizontalOverflow: root.scrollWidth > root.clientWidth,
      tabs: [...root.querySelectorAll('.tabs button')].filter((node) => node.getClientRects().length && !node.closest('[hidden],details:not([open])')).map((node) => { const range = document.createRange(); range.selectNodeContents(node); const text = range.getBoundingClientRect(), box = node.getBoundingClientRect();
        return { name: node.textContent, box: bounds(node), text: { x: text.x, r: text.right, h: text.height }, fits: node.scrollWidth <= node.clientWidth && text.x >= box.left && text.right <= box.right }; }),
      fields: [...root.querySelectorAll('input,select,button')].filter(visible).map((node) => ({ name: node.getAttribute('aria-label') || node.textContent || node.dataset.field, disabled: node.disabled, ...bounds(node) })),
      currentHA: { text: getComputedStyle(c).getPropertyValue('--primary-text-color').trim(), surface: getComputedStyle(c).getPropertyValue('--card-background-color').trim() },
    };
  });
  check(`${name}: proof includes actual help paragraphs and native labels`, panel.paragraphs >= 4 && panel.labels >= 4, { paragraphs: panel.paragraphs, labels: panel.labels, currentHA: panel.currentHA });
  check(`${name}: every native tab label fits without clipping`, panel.tabs.every((tab) => tab.fits), panel.tabs);
  check(`${name}: enabled panel controls retain 44px touch targets`, panel.fields.filter((row) => !row.disabled).every((row) => row.w >= 43.9 && row.h >= 43.9), panel.fields.filter((row) => !row.disabled && (row.w < 43.9 || row.h < 43.9)));
  check(`${name}: actual editor panel fits and avoids scene with no horizontal overflow`, !panel.horizontalOverflow && !overlap(panel.rect, s.scene)
    && panel.rect.w > 239.9 && (!narrow || near(s.stage.w, 320, .1) && panel.card.w <= 322.1 && panel.rect.y >= s.stage.b - .1), { panel, scene: s.scene, stage: s.stage });
}
async function marker(page, entityId) {
  context = `native marker ${entityId}`;
  const point = await page.evaluate((entityId) => { const c = document.querySelector('taylors3d-card'), marker = c._markers.find((m) => m.entities.some((entry) => entry.eid === entityId));
    // Titles legitimately include the primary entity's friendly name; use exact
    // current marker membership only to choose its real pointer coordinates.
    const element = marker && c._markerEls.get(marker.id);
    if (!element) return null; element.focus({ preventScroll: true }); const r = element.querySelector('.fp-dot').getBoundingClientRect();
    const p = [r.x + r.width / 2, r.y + r.height / 2]; return c.shadowRoot.elementFromPoint(...p)?.closest('.fp-marker') === element ? p : null;
  }, entityId);
  if (!point) throw new Error(`Actual ${entityId} marker is not reachable`); await page.mouse.click(...point); await ready(page);
}
async function roomTap(page) {
  context = 'stationary actual room-floor tap';
  const chosen = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), room = c._roomList.find((r) => r.room.id === 'house_room');
    const canvas = c._view.renderer.domElement, rect = canvas.getBoundingClientRect();
    for (const x of [-1, 0, 1, -3, 3]) for (const y of [-2, 2, -1, 1]) {
      const p = c._view.screenPoint(x, y, .02, room.floorId); if (!p || p[0] < rect.left + 8 || p[0] > rect.right - 8 || p[1] < rect.top + 8 || p[1] > rect.bottom - 8) continue;
      if (c.shadowRoot.elementFromPoint(...p) === canvas) return { point: p, roomId: room.room.id, name: room.name };
    } return null;
  });
  if (!chosen) throw new Error('No genuine exposed room-floor point is reachable'); await page.mouse.click(...chosen.point); await ready(page); return chosen;
}
async function escape(page) { await page.keyboard.press('Escape'); await ready(page); }

async function tracePopup(page) {
  // Passive producer tracing only: no extra resize, measure, style read or frame.
  // Attributes/identities expose late restoration/replacement without changing
  // pointer timing or manually driving the app's layout.
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.houseFixture;
    if (f.traceOriginals) return;
    f.popupTrace = []; f.traceOriginals = []; const identities = new WeakMap(); let sequence = 0;
    const identity = (node) => { if (!node || typeof node !== 'object') return null; if (!identities.has(node)) identities.set(node, ++sequence); return identities.get(node); };
    const entry = (method, phase, args) => {
      const el = c._devicePopup.el, owned = c._houseShell._popup;
      f.popupTrace.push({ method, phase, at: Math.round(performance.now()), argument: identity(args[0]),
        element: identity(el), owner: identity(owned), connected: el?.isConnected, enabled: c._houseShell.enabled,
        placement: c._devicePopup.placement, session: c._devicePopup._session, editing: c._editing,
        attribute: el?.getAttribute('data-house-controls-layout'), ownerAttribute: owned?.getAttribute('data-house-controls-layout'),
        title: el?.getAttribute('aria-label'), stack: method === '_restore' || method === '_disable' ? new Error().stack : undefined });
      if (f.popupTrace.length > 180) f.popupTrace.shift();
    };
    for (const [object, methods] of [[c._houseShell, ['measure', '_restore', '_disable']], [c._devicePopup, ['_show', 'close', 'setPlacement']]]) {
      for (const method of methods) { const original = object[method]; f.traceOriginals.push({ object, method, original });
        object[method] = function (...args) { entry(method, 'before', args); try { return original.apply(this, args); } finally { entry(method, 'after', args); } };
      }
    }
  });
}

async function stopPopupTrace(page) {
  await page.evaluate(() => {
    const f = window.houseFixture;
    for (const { object, method, original } of f.traceOriginals || []) object[method] = original;
    f.traceOriginals = null; f.popupTrace = null;
  });
}

async function layoutScenario(page, mode) {
  // mini_map defaults visible; use its real toggle to begin with an unobscured
  // scene, then exercise showing/resizing it deliberately in mapAndCamera.
  await click(page, '.toolbar .minimap-toggle'); await ready(page);
  context = 'original geometry snapshot'; const original = await snapshot(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.houseFixture.legacy = {
    attrs: { theme: c.getAttribute('data-taylors3d-theme'), scheme: c.getAttribute('data-taylors3d-scheme'), shell: c._stage.getAttribute('data-taylors3d-shell') },
    minHeight: c._stage.style.getPropertyValue('min-height'), props: Object.fromEntries(['summary-height', 'navigation-height', 'sheet-height', 'rail-width', 'controls-width'].map((key) => [key, c._stage.style.getPropertyValue(`--taylors3d-${key}`)])) };
  });
  await configure(page, { layout_style: 'house', house_colour_scheme: 'dark' }); await width(page, 1280);
  let s = await geometry(page, 'dark desktop'); check('new layout starts in already-Top without replacing renderer or scene', s.mode === 'top' && s.sceneSame && s.rendererSame && s.calls.length === 0, s.camera);
  const railLabels = await page.evaluate(() => [...document.querySelector('taylors3d-card').shadowRoot.querySelectorAll('[data-house-navigation-label]')]
    .map((node) => { const button = node.closest('button'), bs = getComputedStyle(button), ls = getComputedStyle(node), label = node.getBoundingClientRect();
      return { text: node.textContent, height: label.height, width: label.width, lineHeight: Number.parseFloat(ls.lineHeight),
        label: { display: ls.display, whiteSpace: ls.whiteSpace, overflowWrap: ls.overflowWrap, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth },
        button: { width: button.getBoundingClientRect().width, padding: bs.padding, font: bs.font, fontSize: bs.fontSize, lineHeight: bs.lineHeight } }; }));
  check('desktop rail labels stay readable in at most two lines instead of letter-by-letter wrapping', railLabels.every((row) => row.height <= row.lineHeight * 2 + 1), railLabels);
  check('desktop rail keeps every single-word label unbroken', railLabels.every((row) => /\s/.test(row.text.trim()) || row.height <= row.lineHeight + 1), railLabels);
  const railPaint = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), current = c.shadowRoot.querySelector('[data-house-navigation] button[aria-pressed="true"]');
    if (!current) return null; const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true }), rgba = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    return { current: current.getAttribute('aria-label'), actual: rgba(getComputedStyle(current).backgroundColor), expected: rgba(getComputedStyle(c).getPropertyValue('--taylors3d-ui-teal').trim()) };
  });
  check('actual selected navigation uses the current teal theme token', !!railPaint && equal(railPaint.actual, railPaint.expected), railPaint);
  const ratios = await contrast(page); check('dark native header and control text reaches AA normal-text contrast', ratios.every((row) => row.ratio >= 4.5), ratios.filter((row) => row.ratio < 4.5));
  await screenshot(page, `house-${mode}-desktop-dark.png`);
  if (process.argv.includes('--rail-only')) return;
  const cameraBefore = s.camera; await marker(page, entities.lamp); s = await geometry(page, 'desktop device', 'right');
  check('actual grouped device includes its secondary reading with zero unsolicited service calls', s.rows.some((row) => row.id === entities.lamp)
    && s.rows.some((row) => row.id === entities.temperature && row.value.includes('20.5')) && s.calls.length === 0, s.rows);
  check('opening right controls preserves camera position/target/mode', samePose(s.camera, cameraBefore), { before: cameraBefore, after: s.camera });
  await patch(page, { [entities.temperature]: { state: '21.75' } }); s = await snapshot(page);
  check('open grouped device uses actual later state values', s.rows.find((row) => row.id === entities.temperature)?.value.includes('21.75'), s.rows);
  await screenshot(page, `house-${mode}-device-dark.png`); await escape(page);
  const markerFocus = await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.activeElement?.classList.contains('fp-marker'));
  check('Escape closes device controls and returns focus to the real marker opener', !(await snapshot(page)).popup && markerFocus);
  const chosen = await roomTap(page); s = await geometry(page, 'desktop room', 'right');
  check('stationary actual room tap opens correct grouped current entities with no action', s.popupTitle === chosen.name && s.rows.some((row) => row.id === entities.temperature)
    && !s.rows.some((row) => row.id === 'sensor.house_hidden') && s.calls.length === 0, { chosen, title: s.popupTitle, rows: s.rows });
  check('House room summary uses actual selected room light/media IDs without physical bulb claims', s.roomSummary?.hidden === false
    && s.roomSummary.text === '1 light entity on · 0 media players playing'
    && s.rows.some((row) => row.id === entities.player), { summary: s.roomSummary, ids: s.rows.map((row) => row.id) });
  await screenshot(page, `house-${mode}-room-dark.png`);
  await patch(page, { [entities.lamp]: { state: 'off' }, [entities.player]: { state: 'playing' } }); await ready(page); s = await snapshot(page);
  check('already-open real room summary follows later light/media readings without actions', s.roomSummary?.hidden === false
    && s.roomSummary.text === '0 light entities on · 1 media player playing' && s.calls.length === 0, { summary: s.roomSummary, rows: s.rows });
  await patch(page, { [entities.lamp]: { state: 'on' }, [entities.player]: { state: 'idle' } }); await ready(page); await escape(page);
  await click(page, navButton('house')); await ready(page); s = await snapshot(page);
  check('House / 3D button from already-Top selects a valid nonzero-distance 3D camera', s.mode === '3d'
    && Math.hypot(...s.camera.position.map((n, i) => n - s.camera.target[i])) > .1 && s.calls.length === 0, s.camera);
  await click(page, '.toolbar [data-mode="top"]'); await ready(page);
  for (const widthPx of [740, 320]) {
    await width(page, widthPx);
    if (widthPx === 320) {
      await marker(page, entities.lamp); s = await geometry(page, '320px actual device tap', 'sheet');
      check('narrow real device tap preserves grouped readings with no unsolicited action', s.rows.some((row) => row.id === entities.temperature) && s.calls.length === 0, s.rows);
      await escape(page); if (process.argv.includes('--trace-popup')) await tracePopup(page);
      const room = await roomTap(page); s = await geometry(page, '320px actual stationary room tap', 'sheet');
      const measuredPopup = !!s.popupMode && await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return c._houseShell._popup === c._devicePopup.el; });
      check('320px native room popup keeps the exact measured HouseShell-owned element', measuredPopup, measuredPopup ? undefined : s.popupTrace);
      check('narrow actual room floor still opens correct room and current grouped entities', s.popupTitle === room.name
        && s.rows.some((row) => row.id === entities.temperature) && s.calls.length === 0, { room, rows: s.rows });
      await stopPopupTrace(page); await screenshot(page, `house-${mode}-320-room-dark.png`); await escape(page);
    }
    await click(page, navButton('lights')); s = await geometry(page, `${widthPx}px lights`, widthPx < 740 ? 'sheet' : 'right');
    check(`${widthPx}px category lists only real eligible light sources`, s.rows.length === 1 && s.rows[0].id === entities.lamp && s.calls.length === 0, s.rows);
    const names = await page.evaluate(() => { const s = document.querySelector('taylors3d-card').shadowRoot;
      return [...s.querySelectorAll('[data-house-navigation-id]')].map((node) => ({ id: node.dataset.houseNavigationId, label: node.getAttribute('aria-label') })); });
    for (const row of names) {
      const reachable = await page.evaluate((id) => { const c = document.querySelector('taylors3d-card'), node = c.shadowRoot.querySelector(`[data-house-navigation-id="${id}"]`);
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = node.getBoundingClientRect(), nav = node.closest('[data-house-navigation]').getBoundingClientRect();
        return r.width >= 44 && r.height >= 44 && r.left >= nav.left && r.right <= nav.right + 1 && c.shadowRoot.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === node;
      }, row.id);
      check(`${widthPx}px ${row.label} remains reachable by native navigation scroll`, reachable);
    }
    await screenshot(page, `house-${mode}-${widthPx}-dark.png`); await escape(page);
  }
  await haPalette(page, true); await configure(page, { house_colour_scheme: 'light' }); await click(page, navButton('lights')); await geometry(page, '320px light controls on dark HA', 'sheet');
  const lightRatios = await contrast(page); check('light native controls and header text reach AA', lightRatios.every((row) => row.ratio >= 4.5), lightRatios.filter((row) => row.ratio < 4.5));
  await screenshot(page, `house-${mode}-320-light.png`); await escape(page);
  await haPalette(page, false); await configure(page, { house_colour_scheme: 'ha' }); await geometry(page, '320px HA scheme');
  check('HA scheme uses current HA text/surface variables', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), style = getComputedStyle(c.shadowRoot.querySelector('[data-taylors3d-summary]'));
    return !c.hasAttribute('data-taylors3d-scheme') && style.color === 'rgb(33, 33, 33)' && style.backgroundColor === 'rgb(255, 255, 255)';
  }));
  await width(page, 1280); await configure(page, { house_colour_scheme: 'light' }); await screenshot(page, `house-${mode}-desktop-light.png`);
  // The fixture explicitly sized the adaptive stage; its extra2px theme border
  // changed the external host width. Put that authored fixture width back before
  // asking the application to restore the original style and comparing geometry.
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.style.width = window.houseFixture.initialHostWidth; });
  await configure(page, { layout_style: 'original' }); s = await snapshot(page);
  const restored = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), legacy = window.houseFixture.legacy;
    return { attrs: { theme: c.getAttribute('data-taylors3d-theme'), scheme: c.getAttribute('data-taylors3d-scheme'), shell: c._stage.getAttribute('data-taylors3d-shell') },
      minHeight: c._stage.style.getPropertyValue('min-height'), props: Object.fromEntries(Object.keys(legacy.props).map((key) => [key, c._stage.style.getPropertyValue(`--taylors3d-${key}`)])), legacy };
  });
  check('turning style off restores owned attributes/CSS and exact original scene geometry', equal(restored.attrs, restored.legacy.attrs)
    && equal(restored.props, restored.legacy.props) && restored.minHeight === restored.legacy.minHeight
    && near(s.scene.w, original.scene.w, .1) && near(s.scene.h, original.scene.h, .1) && s.sceneSame && s.rendererSame, { restored, original: original.scene, actual: s.scene });
  await roomTap(page); s = await snapshot(page);
  check('original-style room controls omit the opt-in House summary', !s.roomSummary || s.roomSummary.hidden, s.roomSummary); await escape(page);
  await configure(page, { layout_style: 'house', house_colour_scheme: 'dark' }); await geometry(page, 'restored dark desktop');
}

async function categoriesAndSession(page) {
  await click(page, navButton('cars')); await ready(page); let s = await snapshot(page);
  check('Cars lists the explicit saved sustained source and never guesses a car from motion', s.popupTitle === 'Cars' && s.rows.some((row) => row.id === entities.parked)
    && !s.rows.some((row) => row.id === entities.motion) && s.calls.length === 0, s.rows); await escape(page);
  await click(page, navButton('media')); await ready(page); s = await snapshot(page);
  check('Media category contains real media entity only and no action', s.rows.length === 1 && s.rows[0].id === entities.player && s.calls.length === 0, s.rows); await escape(page);
  await click(page, navButton('lights')); await ready(page);
  await page.evaluate((entity) => { const c = document.querySelector('taylors3d-card'); window.houseFixture.savedLampRegistry = c._hass.entities[entity];
    c.hass = { ...c._hass, entities: { ...c._hass.entities, [entity]: { ...c._hass.entities[entity], hidden_by: 'user' } } };
  }, entities.lamp); await ready(page); s = await snapshot(page);
  check('already-open category resolves current metadata and removes a newly hidden entity honestly', s.popupTitle === 'Lights' && s.rows.length === 0 && s.calls.length === 0, s.rows);
  await page.evaluate((entity) => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass,
    entities: { ...c._hass.entities, [entity]: window.houseFixture.savedLampRegistry } };
  }, entities.lamp); await ready(page); s = await snapshot(page);
  check('deliberately restored eligible source reappears in the open category', s.rows.length === 1 && s.rows[0].id === entities.lamp, s.rows); await escape(page);
  const point = await page.evaluate((selector) => { const node = document.querySelector('taylors3d-card').shadowRoot.querySelector(selector);
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); node.focus(); const r = node.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, navButton('security'));
  await page.mouse.move(...point); await page.mouse.down();
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = false; c.hass = { ...c._hass }; }); await flush(page);
  s = await snapshot(page); check('lost current HA session clears current header readings and suspends native navigation', s.headerText.includes('unavailable') || s.headerText.includes('Waiting'), s.headerText);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = true; c.hass = { ...c._hass }; }); await flush(page); await page.mouse.up(); await ready(page);
  check('old held navigation release stays cancelled after session recovery', !(await snapshot(page)).popup && (await snapshot(page)).calls.length === 0);
  await click(page, navButton('security')); await ready(page); s = await snapshot(page);
  check('fresh deliberate security selection works after recovery with no command', s.popupTitle === 'Security' && s.rows.some((row) => row.id === entities.door) && s.calls.length === 0, s.rows);
  await page.keyboard.press('Escape'); await ready(page);
  check('category Escape returns keyboard focus to its navigation opener', await page.evaluate((selector) => {
    const c = document.querySelector('taylors3d-card'); return c.shadowRoot.activeElement === c.shadowRoot.querySelector(selector);
  }, navButton('security')));
  await control(page, navButton('climate'), (element) => element.focus()); await page.keyboard.down('Space');
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, user: { ...c._hass.user, is_active: false } }; }); await flush(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, user: { ...c._hass.user, is_active: true } }; }); await flush(page);
  await page.keyboard.up('Space'); await ready(page);
  check('held native Space navigation remains cancelled after active-user loss/recovery', !(await snapshot(page)).popup);
  await control(page, navButton('climate'), (element) => element.focus()); await page.keyboard.press('Enter'); await ready(page); s = await snapshot(page);
  check('fresh native Enter opens the actual Climate category once without commands', s.popupTitle === 'Climate'
    && s.rows.some((row) => row.id === entities.climate) && s.calls.length === 0, s.rows); await escape(page);
  await patch(page, { [entities.weather]: null, [entities.person]: { state: 'unknown' }, [entities.alarm]: { state: 'unavailable' } }); await ready(page); s = await snapshot(page);
  check('saved missing/unknown header sources are visible honest statuses, never fabricated readings', s.summaryStates.weather.status !== 'ready'
    && s.summaryStates.people.status !== 'ready' && s.summaryStates.alarm.status !== 'ready' && !s.summaryStates.weather.hidden, s.summaryStates);
  await patch(page, { [entities.weather]: { entity_id: entities.weather, state: 'rainy', attributes: { friendly_name: 'Simulated renamed weather', temperature: 10, temperature_unit: '°C' } },
    [entities.person]: { state: 'not_home' }, [entities.alarm]: { state: 'disarmed' } }); await ready(page);
  check('restored genuine later header readings and names replace missing diagnostics', (await snapshot(page)).summaryStates.weather.status === 'ready', (await snapshot(page)).summaryStates);
}

async function editorScenario(page, mode) {
  await control(page, navButton('settings'), (element) => element.focus()); await page.keyboard.press('Enter'); await ready(page); let s = await snapshot(page);
  check('actual Settings enters optional House form with palette but hides runtime header/navigation', s.editing && s.tab === 'house' && !s.header && !s.navigation && s.shellMode === 'editor', s);
  await haPalette(page, false); await editorVisuals(page, 'dark Settings on light HA');
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.houseEditorHostWidth = c.style.width; c.style.width = '322px'; });
  await ready(page); await editorVisuals(page, '320px dark Settings on light HA', true);
  await screenshot(page, `house-${mode}-settings-320-dark.png`);
  await haPalette(page, true); await configure(page, { house_colour_scheme: 'light' });
  await editorVisuals(page, '320px light Settings on dark HA', true); await screenshot(page, `house-${mode}-settings-320-light.png`);
  await page.evaluate(() => { document.querySelector('taylors3d-card').style.width = window.houseEditorHostWidth; });
  await ready(page); await editorVisuals(page, 'desktop light Settings on dark HA');
  await screenshot(page, `house-${mode}-settings-light.png`);
  await haPalette(page, false); await configure(page, { house_colour_scheme: 'dark' });
  await type(page, field('title'), 'Simulated edited header'); await select(page, field('weather_entity'), '');
  await select(page, field('new-person'), entities.person);
  const focused = await page.evaluate((selector) => { const c = document.querySelector('taylors3d-card'), node = c.shadowRoot.querySelector(selector); node.focus(); window.houseFocused = node; return node.value; }, field('title'));
  await patch(page, { [entities.temperature]: { state: '22' } });
  check('native typed House draft and exact focused node survive ordinary state update', await page.evaluate((selector, value) => {
    const c = document.querySelector('taylors3d-card'), node = c.shadowRoot.querySelector(selector); return node === window.houseFocused && c.shadowRoot.activeElement === node && node.value === value;
  }, field('title'), focused));
  check('editing header remains draft-only and sends no physical command', (await snapshot(page)).commits === 0 && (await snapshot(page)).calls.length === 0);
  await click(page, action('save')); await ready(page); s = await snapshot(page);
  check('native Save applies one exact shared edit and preserves unknown extras', s.commits === 1 && s.saved.title === 'Simulated edited header'
    && !Object.hasOwn(s.saved, 'weather_entity') && s.saved.fixture_extension.keep === true && s.calls.length === 0, s.saved);
  await click(page, '[data-act="history-undo"]'); await ready(page); s = await snapshot(page);
  check('native Undo restores exact original header choices', s.saved.title === 'Simulated house layout' && s.saved.weather_entity === entities.weather && s.saved.fixture_extension.keep, s.saved);
  await click(page, '[data-act="history-redo"]'); await ready(page); s = await snapshot(page);
  check('native Redo restores saved editor header without extra commits', s.saved.title === 'Simulated edited header' && s.commits === 1, s.saved);
  await screenshot(page, `house-${mode}-settings.png`); await click(page, '.toolbar .edit'); await ready(page); s = await geometry(page, 'Done restores house layout');
  check('Done restores adaptive header/navigation with the actually saved title', !s.editing && !!s.header && !!s.navigation && s.summaryTitle === 'Simulated edited header', s.summaryTitle);
}

async function mapAndCamera(page) {
  await width(page, 320); await click(page, '.toolbar [data-mode="top"]'); await ready(page);
  const before = (await snapshot(page)).camera; await click(page, '.toolbar .minimap-toggle'); await ready(page);
  let map = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), node = c._miniMap.el;
    const r = node.getBoundingClientRect(), scene = c._scene.getBoundingClientRect(); return { visible: !node.hidden, rect: { x: r.x, y: r.y, r: r.right, b: r.bottom },
      scene: { x: scene.x, y: scene.y, r: scene.right, b: scene.bottom } }; });
  check('mini-map remains within the current reserved scene after narrow resize', map.visible && map.rect.x >= map.scene.x && map.rect.r <= map.scene.r + 1
    && map.rect.y >= map.scene.y && map.rect.b <= map.scene.b + 1, map);
  await click(page, '.toolbar .minimap-toggle'); await ready(page);
  check('show/hide mini-map does not move camera automatically', samePose((await snapshot(page)).camera, before), { before, after: (await snapshot(page)).camera });
  await click(page, navButton('security')); await ready(page);
  await click(page, `${popup} .t3d-entity[data-entity="${entities.camera}"] [data-action="camera-view"]`);
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._devicePopup.cameraFeed.nativeCard, { timeout: 5000 });
  let s = await geometry(page, '320px deliberate simulated native camera', 'sheet');
  check('deliberately opened camera mounts native-card configuration without HA service or camera motion', s.nativeCamera && s.cameraCreated === 1 && s.calls.length === 0 && samePose(s.camera, before), s);
  await width(page, 1280); s = await geometry(page, 'desktop existing camera resize', 'right');
  check('resizing keeps the same mounted native camera card and real view', s.cameraCreated === 1 && s.nativeCamera && s.rendererSame && s.sceneSame, s);
  await escape(page); s = await snapshot(page);
  check('closing camera popup actually disconnects the native card and restores full scene', !s.nativeCamera && s.cameraDisconnected === 1 && !s.popup, s);
}

async function idleScenario(page) {
  await ready(page); const before = await snapshot(page);
  for (let i = 0; i < 8; i++) await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, states: { ...c._hass.states } }; });
  await ready(page); const after = await snapshot(page);
  check('unchanged HA observations produce no GPU frames/resources/size writes or resize calls', equal(before.stats, after.stats) && equal(before.gpu, after.gpu)
    && before.resizeCalls === after.resizeCalls && before.sizeWrites === after.sizeWrites, { before: { stats: before.stats, gpu: before.gpu, resize: before.resizeCalls, size: before.sizeWrites },
      after: { stats: after.stats, gpu: after.gpu, resize: after.resizeCalls, size: after.sizeWrites } });
  check('all non-control layout interactions produced zero unsolicited HA service calls', after.calls.length === 0, after.calls);
}

async function loadHouseModel(page) {
  context = 'actual embedded GLB load and explicit saved floor/area links';
  await page.evaluate(({ entities, ids }) => {
    const c = document.querySelector('taylors3d-card'), hass = c._hass;
    const upper = new Set([entities.camera, entities.player, entities.climate]);
    c.hass = { ...hass, devices: { ...hass.devices, house_lamp: { ...hass.devices.house_lamp, area_id: 'house_upper' } },
      entities: Object.fromEntries(Object.entries(hass.entities).map(([id, row]) => [id, upper.has(id) ? { ...row, area_id: 'house_upper' } : row])) };
    c._commit({ ...c._layout, rooms: [], pins: {}, vehicle_bindings: [],
      floors: [{ id: 'ground', elevation: 0, height: 3 }, { id: 'first', elevation: 4, height: 3 }],
      model: { levels: { [ids.ground]: { floor: 'ground', auto: false }, [ids.upper]: { floor: 'first', auto: false }, [ids.background]: { floor: null, auto: false } },
        rooms: { [ids.groundRoom]: { area: 'house_room', auto: false }, [ids.upperRoom]: { area: 'house_upper', auto: false } } },
      objects: { [ids.lamp]: { entity: entities.lamp, hidden: false }, [ids.camera]: { entity: entities.camera, hidden: false },
        [ids.door]: { entity: entities.door, hidden: false } },
      views: { upper: { camera: { position: [8, 10, 10], target: [0, 5, 0] } } },
      floor_presentation: { mode: 'assembled' }, wall_presentation: { enabled: false }, model_rendering: { shadows: 'realtime', lamps: 'inherit' },
      house_summary: { ...c._layout.house_summary, title: 'Simulated two-storey GLB house' } });
    c.setConfig({ ...c._config, model: '/demo/house-bench.glb', merge: false, view: '3d', floor: 'first',
      model_opacity: 1, lights: 'auto', sky_bodies: false });
  }, { entities, ids: houseModelIds });
  await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return c?._view?.model && c._objects?.parts.has('fp_lamp')
    && c._roomList?.some((entry) => entry.room.modelId === 'fp_room_upper'); }, { timeout: 30000 });
  await ready(page);
  await click(page, '.chip[data-view="upper"]'); await ready(page);
  if (await page.evaluate(() => !document.querySelector('taylors3d-card')._miniMap.el.hidden)) await click(page, '.toolbar .minimap-toggle');
  await ready(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.houseFixture, root = c._view.model.root;
    root.updateWorldMatrix(true, true); f.modelRoot = root; f.modelOriginals = new Map();
    root.traverse((node) => { f.modelOriginals.set(node, { position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(),
      geometry: node.geometry, material: node.material }); });
    f.originalAnchors = c._objects.anchors().map((anchor) => ({ id: anchor.id, world: anchor.world.toArray() }));
    f.originalPool = [...c._objects.pool.points, ...c._objects.pool.spots].map((light) => light.uuid);
    f.services.length = 0; f.commits = 0; c.resetHistory();
  });
}

async function modelSnapshot(page) {
  return page.evaluate((ids) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, f = window.houseFixture;
    const pool = [...c._objects.pool.points, ...c._objects.pool.spots];
    const anchors = c._objects.anchors().map((anchor) => ({ id: anchor.id, world: anchor.world.toArray() }));
    let transformsSame = true, resourcesSame = true, meshes = 0;
    for (const [node, saved] of f.modelOriginals || []) {
      transformsSame &&= JSON.stringify([node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()]) === JSON.stringify([saved.position, saved.quaternion, saved.scale]);
      if (node.isMesh) { meshes++; resourcesSame &&= node.geometry === saved.geometry && node.material === saved.material; }
    }
    return { loaded: !!v.model && v.model.root === f.modelRoot, rootSame: v.model?.root === f.modelRoot,
      rendererSame: v.renderer === f.originalRenderer, sceneSame: c._scene === f.originalScene, transformsSame, resourcesSame, meshes,
      anchors, originalAnchors: f.originalAnchors, levels: v.model?.manifest.levels.map((level) => ({ id: level.id, elevation: level.elevation,
        floor: c._mb?.levels[level.id]?.floor, stale: c._mb?.levels[level.id]?.stale === true, visible: level.node.visible })),
      rooms: c._roomList.map((entry) => ({ id: entry.room.id, modelId: entry.room.modelId, name: entry.name, floorId: entry.floorId })),
      selectedRoom: c._selectedRoomId, view: c._viewId, mode: c._mode, triangles: v.renderer.info.render.triangles,
      pool: pool.map((light) => light.uuid), originalPool: f.originalPool, activeLights: pool.filter((light) => light.intensity > 0).length,
      lamp: (() => { const slot = c._objects._slots.get(ids.lamp); return slot && { intensity: slot.light.intensity, color: slot.light.color.toArray(), uuid: slot.light.uuid }; })(),
      calls: f.services, camera: { position: v.camera.position.toArray(), target: v.controls.target.toArray(), mode: v.mode },
    };
  }, houseModelIds);
}
const stableModel = (s) => s.loaded && s.rootSame && s.rendererSame && s.sceneSame && s.transformsSame && s.resourcesSame
  && equal(s.anchors, s.originalAnchors) && equal(s.pool, s.originalPool) && s.pool.length === 12 && s.activeLights <= 12;

async function modelObjectTap(page, id) {
  context = `native bound GLB object ${id}`;
  const point = await page.evaluate((id) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, object = c._objects.objectAt(id);
    const anchor = c._objects.displayAnchors().find((anchor) => anchor.id === id), screen = anchor && v.projectWorld(anchor.world), rect = v.renderer.domElement.getBoundingClientRect();
    const hit = screen && c._objectHit(...screen, 30, false), target = screen && c.shadowRoot.elementFromPoint(...screen);
    return { screen, id: hit, hidden: !!anchor && v.pointHidden(anchor.world, object.obj.node), canvas: target === v.renderer.domElement,
      inScene: screen && screen[0] > rect.left + 4 && screen[0] < rect.right - 4 && screen[1] > rect.top + 4 && screen[1] < rect.bottom - 4,
      actualTarget: target && { tag: target.tagName, class: target.className }, world: anchor?.world.toArray() };
  }, id);
  check('bound GLB tap uses the visible current model anchor and real mouse hit priority', point.id === id && !point.hidden && point.canvas && point.inScene, point);
  if (point.id !== id || point.hidden || !point.canvas || !point.inScene) throw new Error('Actual bound GLB object is not exposed to a native canvas click');
  await page.mouse.click(...point.screen); await ready(page); return point;
}

async function modelRoomTap(page) {
  context = 'native actual tagged GLB upper-room floor triangle';
  const result = await page.evaluate((id) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, rect = v.renderer.domElement.getBoundingClientRect();
    const points = [[1.2, -1.1], [-1.6, -1.1], [1.6, -1.1], [-1.6, 1.1], [1.6, 1.1], [0, 1.1], [0, -1.1], [-1.6, 0], [1.6, 0]];
    const room = c._roomList.find((entry) => entry.room.modelId === id);
    const candidates = points.map(([x, y]) => {
      // .02 is ABOVE the explicitly saved 4m floor, not world Y. The real
      // source-to-display adapter and model triangle ray choose a native point.
      const screen = v.screenPoint(x, y, .02, 'first');
      const hit = screen && v.pickModel(...screen), object = screen && c._objectHit(...screen, 30, false);
      return { source: [x, y], screen, kind: hit?.kind, id: hit?.id, up: hit?.hit?.up, worldY: hit?.hit?.point[1],
        floor: hit?.id === room?.room.modelId ? room.floorId : null, object, canvas: screen && c.shadowRoot.elementFromPoint(...screen) === v.renderer.domElement,
        inScene: screen && screen[0] > rect.left + 8 && screen[0] < rect.right - 8 && screen[1] > rect.top + 8 && screen[1] < rect.bottom - 8 };
    });
    // The assembled hierarchy has no split target adapter. Its exact tagged-room
    // mapping and actual 4m triangle determine the source floor, without a guess.
    return { chosen: candidates.find((p) => p.kind === 'room' && p.id === id && p.up && p.floor === 'first' && Math.abs(p.worldY - 4) < 1e-5 && p.object === null && p.canvas && p.inScene),
      candidates, room: room && { id: room.room.id, name: room.name, floorId: room.floorId } };
  }, houseModelIds.upperRoom);
  check('tagged GLB room floor is an exposed real triangle outside bound device targets', !!result.chosen && result.room?.floorId === 'first', result);
  if (!result.chosen) throw new Error('No actual tagged GLB room floor is clear of real model/device targets');
  await page.mouse.click(...result.chosen.screen); await ready(page); return result;
}

async function modelScenario(page, mode, requests) {
  await loadHouseModel(page);
  let model = await modelSnapshot(page);
  check('actual GLTFLoader renders original embedded GLB with deliberate exact floor/area links', requests.includes('/demo/house-bench.glb')
    && model.loaded && model.meshes >= 8 && model.triangles > 0 && model.mode === '3d' && model.view === 'upper'
    && model.levels.some((row) => row.id === houseModelIds.upper && row.elevation === 4 && row.floor === 'first')
    && model.rooms.some((row) => row.modelId === houseModelIds.upperRoom && row.floorId === 'first'), model);
  check('real authored lamp has source position and an active bounded 12-slot pool', model.anchors.some((a) => a.id === houseModelIds.lamp
    && a.world.every((value, index) => near(value, [-1, 6.4, -.5][index], 1e-6))) && model.lamp?.intensity > 0 && stableModel(model), model);
  const originalCamera = model.camera;
  await configure(page, { layout_style: 'house', house_colour_scheme: 'dark' }); await width(page, 1280);
  await geometry(page, 'real GLB dark desktop'); model = await modelSnapshot(page);
  check('House styling retains loaded model, source coordinates, active view, pool and exact camera', stableModel(model) && model.view === 'upper'
    && model.mode === '3d' && samePose(model.camera, originalCamera), model);
  await screenshot(page, `house-${mode}-glb-desktop-dark.png`);
  await modelObjectTap(page, houseModelIds.lamp); let s = await geometry(page, 'real GLB desktop lamp', 'right');
  check('native GLB lamp opens actual bound entity without any service or model/camera change', s.rows.some((row) => row.id === entities.lamp)
    && s.calls.length === 0 && samePose(s.camera, originalCamera) && stableModel(await modelSnapshot(page)), { title: s.popupTitle, rows: s.rows, camera: s.camera });
  await patch(page, { [entities.lamp]: { attributes: { brightness: 128, rgb_color: [60, 120, 255] } } }); await ready(page); s = await snapshot(page); model = await modelSnapshot(page);
  const reading = await page.evaluate((entity) => { const row = document.querySelector('taylors3d-card').shadowRoot.querySelector(`.t3d-entity[data-entity="${entity}"]`);
    return { brightness: row.querySelector('[data-light-control="brightness"]')?.value, text: row.textContent }; }, entities.lamp);
  check('real GLB lighting and open device reading follow current HA observation with no command or rebuild', reading.brightness === '50' && reading.text.includes('Brightness: 50%')
    && model.lamp?.intensity > 0 && model.lamp.color[2] > model.lamp.color[0] && stableModel(model) && s.calls.length === 0 && samePose(s.camera, originalCamera), { reading, lamp: model.lamp, model });
  await screenshot(page, `house-${mode}-glb-device-dark.png`); await escape(page);
  let chosen = await modelRoomTap(page); s = await geometry(page, 'real GLB desktop room', 'right');
  check('native tagged GLB room opens its exact HA area and current grouped secondary entities', s.popupTitle === chosen.room.name
    && (await modelSnapshot(page)).selectedRoom === chosen.room.id && s.rows.some((row) => row.id === entities.lamp)
    && s.rows.some((row) => row.id === entities.temperature) && s.rows.some((row) => row.id === entities.player) && s.calls.length === 0, { chosen, title: s.popupTitle, rows: s.rows });
  check('real GLB room summary follows its current linked light/media sources', s.roomSummary?.hidden === false && s.roomSummary.text === '1 light entity on · 0 media players playing', s.roomSummary);
  await patch(page, { [entities.temperature]: { state: '22.25' }, [entities.player]: { state: 'playing' } }); await ready(page); s = await snapshot(page);
  check('already-open GLB room shows later grouped observations and genuine current summary', s.rows.find((row) => row.id === entities.temperature)?.value.includes('22.25')
    && s.roomSummary?.text === '1 light entity on · 1 media player playing' && s.calls.length === 0 && stableModel(await modelSnapshot(page)), { rows: s.rows, summary: s.roomSummary });
  await escape(page); await width(page, 320);
  await modelObjectTap(page, houseModelIds.lamp); s = await geometry(page, 'real GLB 320px lamp', 'sheet');
  check('320px native GLB device tap preserves source model/view/camera and actual entity', s.rows.some((row) => row.id === entities.lamp)
    && stableModel(await modelSnapshot(page)) && samePose(s.camera, originalCamera), { rows: s.rows, camera: s.camera });
  await escape(page); chosen = await modelRoomTap(page); s = await geometry(page, 'real GLB 320px room', 'sheet');
  check('320px native tagged GLB room uses current area entities and readable live summary', s.popupTitle === chosen.room.name
    && s.rows.some((row) => row.id === entities.temperature) && s.roomSummary?.text === '1 light entity on · 1 media player playing' && s.calls.length === 0, { title: s.popupTitle, rows: s.rows, summary: s.roomSummary });
  const ratios = await contrast(page);
  check('real GLB narrow popup/header/navigation retains AA text contrast', ratios.every((row) => row.ratio >= 4.5), ratios.filter((row) => row.ratio < 4.5));
  await screenshot(page, `house-${mode}-glb-320-room-dark.png`); await escape(page);
  const beforeMap = (await modelSnapshot(page)).camera;
  await click(page, '.toolbar .minimap-toggle'); await ready(page);
  const map = await page.evaluate((id) => {
    const c = document.querySelector('taylors3d-card'), map = c._miniMap, r = map.el.getBoundingClientRect(), s = c._scene.getBoundingClientRect();
    return { visible: !map.el.hidden, rect: { x: r.x, y: r.y, r: r.right, b: r.bottom }, scene: { x: s.x, y: s.y, r: s.right, b: s.bottom },
      floor: map.scene.floorId, markerIds: map.scene.markers.map((marker) => marker.id), boundAnchor: c.cameraAnchors().find((anchor) => anchor.id === `object:${id}`) };
  }, houseModelIds.camera);
  check('real GLB mini-map fits reserved viewport and includes exact bound object source', map.visible && map.rect.x >= map.scene.x && map.rect.r <= map.scene.r + 1
    && map.rect.y >= map.scene.y && map.rect.b <= map.scene.b + 1 && map.markerIds.includes(`object:${houseModelIds.lamp}`) && !!map.boundAnchor, map);
  await click(page, '.toolbar .minimap-toggle'); await ready(page);
  check('real GLB mini-map show/hide preserves model source and camera', stableModel(await modelSnapshot(page)) && samePose((await modelSnapshot(page)).camera, beforeMap));
  await click(page, navButton('security')); await ready(page);
  await click(page, `${popup} .t3d-entity[data-entity="${entities.camera}"] [data-action="camera-view"]`);
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._devicePopup.cameraFeed.nativeCard, { timeout: 5000 });
  await page.evaluate(() => { window.houseFixture.modelNativeCamera = document.querySelector('taylors3d-card')._devicePopup.cameraFeed.nativeCard; });
  s = await geometry(page, 'real GLB 320px simulated camera-card viewport', 'sheet');
  const cameraConfigs = await page.evaluate(() => window.houseFixture.cameraConfigs), cameraConfig = cameraConfigs[0];
  check('GLB camera controls deliberately mount the configured simulated native container without model motion/service', s.nativeCamera && s.cameraCreated === 1
    && cameraConfig?.entity === entities.camera && cameraConfig.type === 'picture-entity' && cameraConfig.camera_view === 'live'
    && s.calls.length === 0 && samePose(s.camera, beforeMap) && stableModel(await modelSnapshot(page)), { cameraConfigs, camera: s.camera });
  await width(page, 1280); s = await geometry(page, 'real GLB desktop existing camera viewport', 'right');
  check('model resize preserves same native camera element and original GLB resources', await page.evaluate(() => document.querySelector('taylors3d-card')._devicePopup.cameraFeed.nativeCard === window.houseFixture.modelNativeCamera)
    && s.cameraCreated === 1 && stableModel(await modelSnapshot(page)) && samePose(s.camera, beforeMap));
  await escape(page);
  check('closing GLB camera controls disconnects native element with no service', (await snapshot(page)).cameraDisconnected === 1 && !(await snapshot(page)).nativeCamera && (await snapshot(page)).calls.length === 0);
  await configure(page, { layout_style: 'original' }); await geometry(page, 'real GLB original style restored'); model = await modelSnapshot(page);
  check('turning House style off restores original geometry without reloading/transforming GLB', stableModel(model) && model.view === 'upper' && samePose(model.camera, originalCamera), model);
  await configure(page, { layout_style: 'house' }); await width(page, 1280); await geometry(page, 'real GLB House style restored'); model = await modelSnapshot(page);
  check('turning House style back on preserves exact GLB/source/light pool and active view', stableModel(model) && model.view === 'upper' && samePose(model.camera, originalCamera), model);
  await idleScenario(page);
}

async function restore(page) {
  return page.evaluate(() => { const c = document.querySelector('taylors3d-card'), f = window.houseFixture;
    if (!c || !f) return true; c._view.resize = f.previousResize; c._view.renderer.setSize = f.previousSetSize;
    for (const { object, method, original } of f.traceOriginals || []) object[method] = original;
    c._devicePopup.close(); c.remove(); return c._view.resize === f.previousResize && c._view.renderer.setSize === f.previousSetSize;
  });
}

const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
const fixtures = process.argv.includes('--glb-only') ? ['glb'] : process.argv.includes('--rail-only') ? ['drawn'] : ['drawn', 'glb'];
for (const mode of modes) for (const fixture of fixtures) {
  label = `${mode}${fixture === 'glb' ? ' real GLB' : ''}: `; let session;
  try {
    session = await open(mode);
    check('loads exactly selected source or built card path', mode === 'source' ? session.requests.includes('/src/taylors3d-card.js')
      && !session.requests.includes('/dist/taylors3d-card.js') : session.requests.includes('/dist/taylors3d-card.js') && !session.requests.some((url) => url.startsWith('/src/')));
    if (fixture === 'glb') await modelScenario(session.page, mode, session.requests);
    else await layoutScenario(session.page, mode);
    if (fixture === 'drawn' && !process.argv.includes('--rail-only')) {
      await categoriesAndSession(session.page); await editorScenario(session.page, mode);
      await mapAndCamera(session.page); await idleScenario(session.page);
    }
  } catch (error) { check('browser scenario completed', false, { context, message: error.message, stack: error.stack }); }
  finally { if (session) {
    check('fixture restores its observers and disposes the real card before browser close', await restore(session.page).catch(() => false));
    await flush(session.page).catch(() => {});
    errors.push(...session.pageErrors, ...session.errors.filter((message) => !session.pageErrors.some((error) => error.message === message)));
    await session.close();
  } }
}
check('no application browser errors or warnings', errors.length === 0, errors);
console.log(`\n${checks.filter(Boolean).length}/${checks.length} house layout checks passed.`);
if (checks.some((ok) => !ok)) process.exitCode = 1;
