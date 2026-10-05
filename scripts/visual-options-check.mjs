// F02 native advanced options proof: actual source/bundle editors and renderer.
// HA source/storage/form replies are explicitly simulated; no HA durability proof.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { serveVisualOptionsFixture, visualEntities as entities, visualIds as ids, visualLayoutKey } from './lib/visual-options-fixture.mjs';

const checks = [], browserErrors = [];
let mode = '', context = 'setup';
const check = (name, pass, detail) => { checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${mode} ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tolerance = 1e-6) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;
const field = (name) => `[data-field="${name}"]`;
const action = (name) => `[data-act="${name}"]`;
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function ready(page) {
  await settle(page); // Apply actual card scheduling before inspecting a load.
  try { await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card');
    const source = c?._config?.model || c?._layout?.model?.version;
    const expected = c?._config?.merge === false ? `${source}#nomerge` : source;
    return c?._layout && c._view?.model?.id === expected && !c._loading && c._objects?.parts.has('fp_camera');
  }, { timeout: 30000, polling: 50 }); } catch (error) {
    error.message += `; ${context}; ${JSON.stringify(await page.evaluate(() => { const c = document.querySelector('taylors3d-card');
      return { loading: c?._loading, model: c?._view?.model?.id, error: c?._modelError, tab: c?._edit?.tab, layout: !!c?._layout };
    }).catch(() => null))}`; throw error;
  }
  await settle(page);
}
async function control(page, selector, callback, form = false) {
  context = (form ? 'simulated HA host: ' : 'actual card native control: ') + selector;
  const handle = await page.evaluateHandle((selector, form) => (form ? document.querySelector('#form-host') : document.querySelector('taylors3d-card').shadowRoot).querySelector(selector), selector, form);
  try { const element = handle.asElement(); if (!element) throw new Error('Missing native control ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(element);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector, form = false) => control(page, selector, (element) => element.click(), form);
const select = (page, name, value) => control(page, field(name), (element) => element.select(value));
async function focusSvg(element) {
  // Puppeteer's ElementHandle.focus() accepts only HTML elements. Use the real
  // browser SVG focus API, then send the same native keyboard input as before.
  await element.evaluate((node) => {
    if (!(node instanceof SVGElement) || typeof node.focus !== 'function') throw new Error('Expected a focusable actual SVG control');
    node.focus();
    if (node.getRootNode().activeElement !== node) throw new Error('Actual SVG control did not receive keyboard focus');
  });
}
async function type(page, name, value, { form = false, blur = false } = {}) {
  const selector = form ? `[data-ha-field="${name}"]` : field(name);
  await control(page, selector, async (element) => { await element.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA');
    await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.type(String(value));
    if (blur) await page.keyboard.press('Tab');
  }, form);
}
async function tab(page, value) { await click(page, `[data-act="tab"][data-id="${value}"]`); }
async function editing(page, enabled) {
  if (await page.evaluate(() => document.querySelector('taylors3d-card')._editing) !== enabled) await click(page, '[data-bubble="edit"]');
}
const state = (page) => page.evaluate(() => { const c = document.querySelector('taylors3d-card'), f = window.visualFixture;
  return { layout: structuredClone(c._layout), config: structuredClone(c._config), commits: f.commits, calls: f.services,
    records: c._trackingData?.records.map(({ id, active, shown, measured, status, positionStatus, location, color, size, heading, transitionMs, label }) => ({ id, active, shown, measured, status, positionStatus, location, color, size, heading, transitionMs, label })),
    parts: [...(c._trackingLayer?.parts || [])].map(([id, p]) => ({ id, point: p.group.position.toArray(), size: p.mesh.scale.x, heading: p.group.rotation.y,
      moving: p.moving && { duration: p.moving.duration, from: p.moving.from.toArray(), target: p.moving.target.toArray() }, color: p.material.color.getHexString() })),
    sectors: [...(c._cameraCoverage?.sectors || [])].map(([id, p]) => ({ id, geometryKey: p.geometryKey, vertices: p.fill.geometry.attributes.position.count })),
    alerts: c._alertData?.alerts.map(({ id, location, shown, diagnostics }) => ({ id, location, shown, diagnostics })),
    shadows: c._view.shadowsEnabled, lampSlots: c._objects._slots?.size, modelOpacity: c._view.model?.opacity,
    rootPoint: c._view.modelGroup.position.toArray(), contextCount: window.visualContexts.size,
    sameRenderer: f.renderer === c._view.renderer, configEvents: f.configEvents, tab: c._edit?.tab };
});
async function patch(page, entity, reported, attributes = {}) {
  await page.evaluate(({ entity, reported, attributes }) => window.visualFixture.patch(entity, reported, attributes), { entity, reported, attributes }); await settle(page);
}
async function freshness(page, target, seconds = '3600') {
  await select(page, `trk-freshness-${target}-mode`, 'timestamp');
  await select(page, `trk-freshness-${target}-timestamp-mode`, 'attribute');
  await type(page, `trk-freshness-${target}-attribute`, 'observed_ms');
  await select(page, `trk-freshness-${target}-format`, 'milliseconds');
  await type(page, `trk-freshness-${target}-age`, seconds);
}

async function prepare(page, fixture) {
  await page.evaluate(async ({ layout, entities, ids, key }) => {
    const c = document.querySelector('taylors3d-card'), connection = new EventTarget(); connection.connected = true; connection.options = { auth: {} };
    const user = { id: 'simulated-visual-user', is_admin: true, is_active: true, name: 'Simulated admin' }, auth = {};
    const f = window.visualFixture = { services: [], ws: [], commits: 0, configEvents: [], saved: structuredClone(layout), user, connection, auth };
    const reading = (entity_id, state, attributes = {}) => ({ entity_id, state, last_changed: '2026-01-01T00:00:00Z', last_updated: new Date().toISOString(), attributes });
    const states = Object.fromEntries(Object.values(entities).map((entity) => [entity, reading(entity, 'off', { friendly_name: 'Simulated ' + entity, observed_ms: Date.now() })]));
    Object.assign(states, { [entities.motion]: reading(entities.motion, 'on', { friendly_name: 'Simulated anonymous activity', device_class: 'motion', observed_ms: Date.now() }),
      [entities.parking]: reading(entities.parking, 'on', { friendly_name: 'Simulated maintained vehicle occupancy', observed_ms: Date.now() }),
      [entities.event]: reading(entities.event, new Date().toISOString(), { friendly_name: 'Simulated vehicle event', event_type: 'vehicle', observed_ms: Date.now() }),
      [entities.vacuum]: reading(entities.vacuum, 'cleaning', { friendly_name: 'Simulated measured vacuum', observed_ms: Date.now() }),
      [entities.xy]: reading(entities.xy, 'ready', { friendly_name: 'Simulated atomic XY source', x: -.5, y: .25, observed_ms: Date.now() }),
      [entities.camera]: reading(entities.camera, 'idle', { friendly_name: 'Simulated upper camera' }),
      [entities.lamp]: reading(entities.lamp, 'on', { brightness: 180, color_mode: 'rgb', supported_color_modes: ['rgb'], rgb_color: [255, 180, 90] }),
      [entities.leak]: reading(entities.leak, 'off', { friendly_name: 'Simulated leak', device_class: 'moisture' }),
      'sun.sun': reading('sun.sun', 'below_horizon', { elevation: -20, azimuth: 180 }) });
    const callWS = async (message) => { f.ws.push(structuredClone(message));
      if (message.type === 'taylors3d/layout/get') return { layout: structuredClone(f.saved) };
      if (message.type === 'taylors3d/layout/set') { f.saved = structuredClone(message.layout); return { success: true }; }
      if (message.type === 'frontend/get_user_data') return { value: null };
      if (message.type === 'config/entity_registry/list') return Object.values(c._hass.entities);
      if (message.type === 'config/device_registry/list') return [];
      if (message.type === 'config/area_registry/list') return Object.values(c._hass.areas);
      if (message.type === 'config/floor_registry/list') return Object.values(c._hass.floors);
      throw new Error('Explicitly unimplemented simulated WS: ' + message.type);
    };
    const hass = { user, auth, connection, language: 'en', locale: { language: 'en', number_format: 'language', time_format: '24', first_weekday: 'monday' },
      config: { location_name: 'Simulated visual bench', time_zone: 'Europe/London', latitude: null, longitude: null }, callWS,
      callService: async (...args) => { f.services.push(args); }, services: { light: { turn_on: {}, turn_off: {} } },
      fetchWithAuth: (url, options) => fetch(url, { ...options, headers: { ...options?.headers, authorization: 'Bearer simulated-visual-options' } }),
      states, floors: { ground: { floor_id: 'ground', name: 'Simulated ground', level: 0 }, upper: { floor_id: 'upper', name: 'Simulated upper', level: 1 } },
      areas: { 'visual-ground': { area_id: 'visual-ground', name: 'Simulated ground area', floor_id: 'ground' },
        'visual-upper': { area_id: 'visual-upper', name: 'Simulated upper area', floor_id: 'upper' } }, devices: {},
      entities: Object.fromEntries(Object.values(entities).map((entity) => [entity, { entity_id: entity, hidden: false, disabled_by: null,
        entity_category: null, device_id: null, area_id: [entities.camera, entities.lamp, entities.switch].includes(entity) ? 'visual-upper' : 'visual-ground' }])) };
    c.setConfig({ type: 'custom:taylors3d-card', layout_key: key, height: '780px', merge: false, view: '3d', sky_bodies: false,
      mini_map: false, show_bubble_bar: true, control_panel: 'right', lights: 'auto', ambient_idle: { enabled: false } });
    c.hass = hass; await c._layoutReady; await c._loadModel(); c._setView('all', { instant: true }); c.resetHistory();
    f.renderer = c._view.renderer; f.original = structuredClone(c._layout);
    const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (...args) => { f.commits++; return commit(...args); };
    f.patch = (entity, reported, attributes = {}) => { const old = c._hass.states[entity]; c.hass = { ...c._hass,
      states: { ...c._hass.states, [entity]: { ...old, state: reported, attributes: { ...old.attributes, ...attributes } } } }; if (f.editor) f.editor.hass = c._hass; };
    f.unrelated = () => f.patch(entities.unrelated, String(Number(c._hass.states[entities.unrelated].state) + 1 || 1));
    f.pulse = (kind) => {
      if (kind === 'alert-source') { const original = c._hass.states[entities.leak];
        c.hass = { ...c._hass, states: { ...c._hass.states, [entities.leak]: { ...original, state: 'unavailable' } } };
        c.hass = { ...c._hass, states: { ...c._hass.states, [entities.leak]: original } }; return;
      }
      if (kind === 'source') { const old = f.editor?._config; if (f.editor && old) { f.editor.setConfig({ ...old, model: '/demo/visual-options-url.glb?changed' }); f.editor.setConfig(old); } return; }
      if (kind === 'role') { c.hass = { ...c._hass, user: { ...user, is_admin: false } }; if (f.editor) f.editor.hass = c._hass;
        c.hass = { ...c._hass, user }; if (f.editor) f.editor.hass = c._hass; }
      if (kind === 'connection') { connection.connected = false; c.hass = { ...c._hass }; if (f.editor) f.editor.hass = c._hass;
        connection.connected = true; c.hass = { ...c._hass }; if (f.editor) f.editor.hass = c._hass; }
    };
    f.ids = ids;
  }, { layout: fixture.layout, entities, ids, key: visualLayoutKey });
  await ready(page);
  check('overview deliberately links both exact HA floors before measuring ground actors', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    return c._viewId === 'all' && JSON.stringify(c._navigationFloors()) === JSON.stringify(['ground', 'upper'])
      && c._navigationRooms().some((entry) => entry.room.id === 'visual-room' && entry.floorId === 'ground');
  }));
}

async function tracking(page) {
  context = 'Tracking native advanced appearance/freshness'; await editing(page, true); await tab(page, 'tracking');
  await click(page, '[data-act="trk-edit"][data-index="0"]');
  await select(page, 'trk-area-filter', 'unassigned');
  check('Tracking area filter keeps the exact selected out-of-filter source visible', await page.evaluate((entity) => {
    const input = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="trk-entity"]');
    return input.value === entity && [...input.options].some((option) => option.value === entity);
  }, entities.motion));
  await select(page, 'trk-area-filter', 'all');
  await type(page, 'trk-color', '#123456'); await type(page, 'trk-size', '1.20');
  const focus = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector('[data-field="trk-size"]');
    window.visualFocus = input; for (let i = 0; i < 3; i++) window.visualFixture.unrelated();
    return { same: c.shadowRoot.querySelector('[data-field="trk-size"]') === input, focused: c.shadowRoot.activeElement === input, value: input.value };
  }); check('HA pushes retain exact Tracking native input/focus and in-progress decimal', focus.same && focus.focused && focus.value === '1.20', focus);
  await type(page, 'trk-heading', '725'); await click(page, field('trk-show-inactive')); await freshness(page, 'status');
  let before = await state(page); await click(page, action('trk-save')); let after = await state(page), saved = after.layout.presence_bindings[0];
  check('one Save preserves extensions and exact colour/size/heading/inactive/freshness settings', after.commits === before.commits + 1
    && saved.color === '#123456' && saved.size === 1.2 && saved.heading === 725 && saved.show_inactive === true
    && saved.freshness?.timestamp_attr === 'observed_ms' && saved.freshness?.max_age_seconds === 3600
    && same(saved.extension, before.layout.presence_bindings[0].extension), saved);
  await click(page, action('history-undo')); after = await state(page);
  check('Undo restores original raw binding, then Redo restores advanced settings', same(after.layout.presence_bindings[0], before.layout.presence_bindings[0]));
  await click(page, action('history-redo')); await editing(page, false); after = await state(page);
  const part = after.parts.find((item) => item.id === 'activity:activity'), record = after.records.find((item) => item.id === 'activity:activity');
  check('actual tracked geometry consumes selected appearance and wraps heading', part?.color === '123456' && near(part.size, 1.2)
    && near(part.heading, -5 * Math.PI / 180) && record?.heading === 5, { part, record });
  await patch(page, entities.motion, 'off'); after = await state(page);
  check('show_inactive keeps an honest inactive activity record, without person identity', after.records.find((item) => item.id === 'activity:activity')?.active === false
    && after.parts.some((item) => item.id === 'activity:activity') && !after.records.find((item) => item.id === 'activity:activity')?.label.includes('person'));
  await patch(page, entities.motion, 'on', { observed_ms: Date.now() - 7200000 }); after = await state(page);
  check('explicit old source timestamp is stale, not renewed by dashboard refresh', after.records.find((item) => item.id === 'activity:activity')?.status === 'stale', after.records);
  await patch(page, entities.motion, 'on', { observed_ms: Date.now() }); await editing(page, true); await tab(page, 'tracking');
  await click(page, '[data-act="trk-edit"][data-index="1"]'); await type(page, 'trk-label', 'Retained imported appearance');
  before = await state(page); await click(page, action('trk-save')); after = await state(page); saved = after.layout.presence_bindings[1];
  check('label-only edit preserves raw malformed imported appearance and unknown extension', after.commits === before.commits + 1
    && saved.color === 'imported-malformed-colour' && saved.size === 99 && saved.heading === 'raw-angle' && saved.extension === 'retain me');
  await click(page, '[data-act="trk-edit"][data-index="0"]'); await type(page, 'trk-size', '6'); before = await state(page);
  await click(page, action('trk-save')); after = await state(page);
  check('deliberately edited out-of-range size is rejected without a history save', after.commits === before.commits && same(after.layout, before.layout));
  await click(page, action('trk-cancel'));
  await click(page, '[data-act="trk-section"][data-section="vehicles"]'); await click(page, '[data-act="trk-edit"][data-index="0"]');
  await freshness(page, 'status'); await click(page, field('trk-show-inactive')); await click(page, action('trk-save')); after = await state(page);
  check('maintained vehicle source exposes actual timestamp freshness without invented identity', after.layout.vehicle_bindings[0].freshness?.max_age_seconds === 3600
    && after.layout.vehicle_bindings[0].show_inactive === true && !after.layout.vehicle_bindings[0].identity_entity);
  await click(page, '[data-act="trk-edit"][data-index="1"]'); await freshness(page, 'status', '60'); await click(page, action('trk-save')); after = await state(page);
  check('event freshness leaves the original explicit sighting TTL/type unchanged', after.layout.vehicle_bindings[1].freshness?.max_age_seconds === 60
    && after.layout.vehicle_bindings[1].expires_seconds === 300 && same(after.layout.vehicle_bindings[1].event_types, ['vehicle']));
  await click(page, '[data-act="trk-section"][data-section="vacuums"]'); await click(page, '[data-act="trk-edit"][data-index="0"]');
  await type(page, 'trk-color', '#abc123'); await type(page, 'trk-size', '.5'); await type(page, 'trk-heading', '45'); await type(page, 'trk-interpolate-ms', '2000');
  await freshness(page, 'position'); await click(page, action('trk-save')); after = await state(page); saved = after.layout.vacuum_bindings[0];
  check('measured vacuum Save keeps smoothing bounded and position freshness independent of status', saved.interpolate_ms === 2000
    && saved.position_source?.freshness?.max_age_seconds === 3600 && saved.freshness === undefined && saved.color === '#abc123', saved);
  await editing(page, false); await patch(page, entities.xy, 'ready', { x: -.5, y: .25, observed_ms: Date.now() });
  const motion = await page.evaluate(async (entity) => { const c = document.querySelector('taylors3d-card'); window.visualFixture.patch(entity, 'ready', { x: 1, y: .25, observed_ms: Date.now() });
    await Promise.resolve(); // Observe the actual Root update queued by its hass setter.
    const p = c._trackingLayer.parts.get('vacuum:measured'), record = c._trackingData.records.find((entry) => entry.id === 'vacuum:measured');
    return { moving: p?.moving?.duration, point: p?.group.position.toArray(), target: p?.moving?.target.toArray(),
      current: { measured: record?.measured, active: record?.active, status: record?.positionStatus, location: record?.location } }; }, entities.xy);
  check('only consecutive current measured samples start the actual smoothing transition', motion.moving === 2000 && motion.point?.[0] !== motion.target?.[0]
    && motion.current.measured === true && motion.current.active === true && motion.current.status === 'ready'
    && motion.current.location?.x === 1 && motion.current.location?.y === .25 && same(motion.target, [1, .05, -.25]), motion);
  await patch(page, entities.xy, 'unavailable'); after = await state(page);
  check('unavailable XY cancels smoothing and labels the fixed fallback instead of inventing a route', after.records.find((item) => item.id === 'vacuum:measured')?.measured === false
    && after.parts.find((item) => item.id === 'vacuum:measured')?.moving === null
    && after.records.find((item) => item.id === 'vacuum:measured')?.label.includes('position unavailable'), after.parts);
  await patch(page, entities.xy, 'ready', { x: -.5, y: .25, observed_ms: Date.now() });
}

async function cameras(page) {
  context = 'Camera curve detail native bounds'; await editing(page, true); await tab(page, 'cameras');
  await select(page, 'cov-anchor', `object:${ids.camera}`);
  for (const segments of [2, 64]) {
    await type(page, 'cov-segments', segments); const before = await state(page); await click(page, action('cov-save')); const after = await state(page);
    // One real anchor is saved under its camera entity; the legacy object key
    // must migrate without changing any other coverage setting or extension.
    const expected = { ...before.layout.camera_coverage, [entities.camera]: {
      ...(before.layout.camera_coverage[entities.camera] ?? before.layout.camera_coverage[`object:${ids.camera}`]), segments } };
    delete expected[`object:${ids.camera}`];
    const sector = after.sectors.find((item) => item.id === `object:${ids.camera}`);
    check(`camera native Save accepts ${segments} actual curve segments`, after.commits === before.commits + 1
      && same(after.layout.camera_coverage, expected)
      && after.layout.camera_coverage[entities.camera]?.segments === segments
      && !Object.hasOwn(after.layout.camera_coverage, `object:${ids.camera}`)
      && after.layout.camera_coverage[entities.camera]?.extension === 'retain camera extra'
      && same(JSON.parse(sector?.geometryKey || '[]'), [70, 8, segments]) && sector.vertices === segments + 2, sector);
  }
  await type(page, 'cov-segments', '65'); let before = await state(page); await click(page, action('cov-save')); let after = await state(page);
  check('camera curve detail above64 is rejected without changing saved coverage', after.commits === before.commits && same(after.layout.camera_coverage, before.layout.camera_coverage));
  await click(page, action('cov-cancel')); before = await state(page); await type(page, 'cov-segments', '2'); await click(page, action('cov-cancel')); after = await state(page);
  check('Cancel removes camera preview and retains saved64/unknown fields', same(after.layout.camera_coverage, before.layout.camera_coverage)
    && after.layout.camera_coverage[entities.camera]?.segments === 64
    && after.layout.camera_coverage[entities.camera]?.extension === 'retain camera extra');
  await select(page, 'cov-area-filter', 'area:visual-ground');
  check('camera area filter retains current selected out-of-filter exact camera', await page.evaluate((entity) => {
    const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector('[data-field="cov-camera"]'); return input.value === entity && !![...input.options].find((option) => option.value === entity);
  }, entities.camera));
  await select(page, 'cov-area-filter', 'all');
}

async function alerts(page) {
  context = 'Explicit canonical alert location native routes'; await tab(page, 'overlays');
  await click(page, '[data-act="ovr-edit-alert"][data-id="location"]'); await select(page, 'ovr-alert-location', 'room'); await select(page, 'ovr-alert-room', 'visual-room');
  await click(page, action('ovr-save-alert')); let after = await state(page), saved = after.layout.alert_bindings[0];
  check('explicit Room removes previous fixed overrides and uses the chosen exact room', saved.location_mode === 'room' && saved.roomId === 'visual-room'
    && !Object.hasOwn(saved, 'x') && !Object.hasOwn(saved, 'floorId') && after.alerts.find((item) => item.id === 'location')?.location?.floorId === 'ground', saved);
  await click(page, '[data-act="ovr-edit-alert"][data-id="location"]'); await select(page, 'ovr-alert-location', 'marker');
  await select(page, 'ovr-alert-position-key', `object:${ids.camera}`); await click(page, action('ovr-save-alert')); after = await state(page);
  const anchor = await page.evaluate((id) => document.querySelector('taylors3d-card').trackingAnchors().find((item) => item.id === id)?.position, `object:${ids.camera}`);
  const location = after.alerts.find((item) => item.id === 'location')?.location;
  check('explicit Marker uses the exact current SOURCE anchor without a second floor offset', after.layout.alert_bindings[0].position_key === `object:${ids.camera}`
    && near(location?.x, anchor?.x) && near(location?.y, anchor?.y) && near(location?.z, anchor?.z) && location?.floorId === anchor?.floorId, { anchor, location });
  await click(page, '[data-act="ovr-edit-alert"][data-id="location"]'); await select(page, 'ovr-alert-location', 'coordinates');
  await type(page, 'ovr-alert-x', '1.20'); const focus = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector('[data-field="ovr-alert-x"]');
    window.visualFixture.unrelated(); return { same: input === c.shadowRoot.querySelector('[data-field="ovr-alert-x"]'), focused: c.shadowRoot.activeElement === input, value: input.value }; });
  check('alert native source-coordinate decimal/focus survives an unrelated HA push', focus.same && focus.focused && focus.value === '1.20', focus);
  await type(page, 'ovr-alert-y', '-.75'); await type(page, 'ovr-alert-z', '.4'); await select(page, 'ovr-alert-floor', 'upper');
  const beforeHeldSave = await state(page);
  await control(page, action('ovr-save-alert'), async (button) => { const box = await button.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.evaluate(() => window.visualFixture.pulse('alert-source')); await page.mouse.up(); }); after = await state(page);
  check('held native Alert Save is cancelled through actual source loss/recovery', after.commits === beforeHeldSave.commits
    && same(after.layout.alert_bindings, beforeHeldSave.layout.alert_bindings));
  await click(page, action('ovr-save-alert')); after = await state(page);
  saved = after.layout.alert_bindings[0]; const fixed = after.alerts.find((item) => item.id === 'location')?.location;
  check('explicit Coordinates saves exact finite source metres/floor and preserves unknown fields', saved.location_mode === 'coordinates' && !saved.roomId
    && !saved.position_key && fixed?.x === 1.2 && fixed?.y === -.75 && fixed?.z === .4 && fixed?.floorId === 'upper' && saved.extension.untouched, { saved, fixed });
  // Separate genuinely roomless source: no fallback to current/previous room.
  await page.evaluate(async () => { const c = document.querySelector('taylors3d-card'); window.visualFixture.withRooms = structuredClone(c._layout);
    c._commit({ ...c._layout, rooms: [], model: { ...c._layout.model, version: 2, rooms: {} } }); await c._loadModel(); c._edit.render();
  }); await ready(page);
  const count = await page.evaluate(() => document.querySelector('taylors3d-card')._edit._overlayEditor.rooms.length);
  check('roomless coordinate fixture truly has no selectable rooms', count === 0, count);
  await click(page, action('ovr-add-alert')); await select(page, 'ovr-alert-type', 'leak'); await select(page, 'ovr-alert-entity', entities.leak);
  await select(page, 'ovr-alert-location', 'coordinates'); await type(page, 'ovr-alert-x', '0'); await type(page, 'ovr-alert-y', '0'); await type(page, 'ovr-alert-z', '.12'); await select(page, 'ovr-alert-floor', 'ground');
  const before = await state(page); await click(page, action('ovr-save-alert')); after = await state(page);
  check('a finite exact floor permits native coordinate alert Save with no room', after.commits === before.commits + 1 && after.layout.alert_bindings.length === before.layout.alert_bindings.length + 1);
  await page.evaluate(async () => { const c = document.querySelector('taylors3d-card');
    c._commit({ ...window.visualFixture.withRooms, alert_bindings: c._layout.alert_bindings }); await c._loadModel(); c._edit.render(); }); await ready(page);
}

async function model(page) {
  context = 'Fourth shading policy and exact uploaded model inputs'; await tab(page, 'model');
  let before = await state(page); await select(page, 'model-rendering-preset', 'shadows-only'); let after = await state(page);
  check('fourth shading option remains a draft until Save', same(after.layout.model_rendering, before.layout.model_rendering) && after.commits === before.commits);
  await click(page, action('model-rendering-save')); after = await state(page);
  check('fourth option saves realtime shadows/lamps off while preserving imported extras', after.layout.model_rendering.shadows === 'realtime'
    && after.layout.model_rendering.lamps === 'off' && after.shadows && after.layout.model_rendering.extension === 'retain rendering extra' && after.lampSlots === 0, after.layout.model_rendering);
  await click(page, action('history-undo')); after = await state(page);
  check('shading Undo restores actual lamp policy without changing source states', after.layout.model_rendering.lamps === 'inherit' && after.calls.length === 0);
  await click(page, action('history-redo'));
  await click(page, 'details.advanced:has([data-field="md-position-x"]) summary');
  await type(page, 'md-position-x', '120.25', { blur: true }); await type(page, 'md-position-y', '-75.5', { blur: true }); await type(page, 'md-position-z', '18', { blur: true });
  await ready(page); after = await state(page);
  check('native exact uploaded positions exceed slider ranges without clamping', same(after.layout.model.position, [120.25, -75.5, 18])
    && same(after.rootPoint, [120.25, 18, 75.5]), { saved: after.layout.model.position, actual: after.rootPoint });
  await control(page, field('md-opacity'), async (element) => { await element.focus(); await element.press('Home'); }); after = await state(page);
  check('native uploaded opacity can deliberately reach exactly zero', after.layout.model.opacity === 0 && after.modelOpacity === 0, { saved: after.layout.model.opacity, actual: after.modelOpacity });
  await type(page, 'md-position-x', '1.20'); const savedBeforeLoss = (await state(page)).layout.model.position;
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.visualFixture.heldModelInput = c.shadowRoot.querySelector('[data-field="md-position-x"]'); });
  await page.evaluate(() => window.visualFixture.pulse('role')); await page.keyboard.press('Tab'); after = await state(page);
  check('observed role loss/recovery blocks old exact-position input or removes its owned node', same(after.layout.model.position, savedBeforeLoss)
    && await page.evaluate(() => { const input = window.visualFixture.heldModelInput; return input.disabled || !input.isConnected; }));
  await tab(page, 'rooms'); await tab(page, 'model'); await click(page, 'details.advanced:has([data-field="md-position-x"]) summary');
  await type(page, 'md-position-x', '200'); await page.evaluate(() => window.visualFixture.pulse('connection')); await page.keyboard.press('Tab'); after = await state(page);
  check('coalesced disconnect/reconnect cannot apply a retained unfinished model position', same(after.layout.model.position, savedBeforeLoss)
    && await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="md-position-x"]')?.disabled === true));
  await tab(page, 'rooms'); await tab(page, 'model'); await click(page, 'details.advanced:has([data-field="md-position-x"]) summary');
  await type(page, 'md-position-x', '0', { blur: true }); await type(page, 'md-position-y', '0', { blur: true }); await type(page, 'md-position-z', '0', { blur: true });
  await control(page, field('md-opacity'), async (element) => { await element.focus(); await element.press('End'); }); await ready(page);
  // Force only a real model reload, never an artificial renderer or passive service.
  const preserved = (await state(page)).layout;
  await page.evaluate(async () => { const c = document.querySelector('taylors3d-card'); await c._loadModel(true); }); await ready(page); after = await state(page);
  check('real uploaded-model reload retains saved advanced bindings and fourth policy', same(after.layout, preserved) && after.sameRenderer && after.contextCount === 1);
}

async function alertMap(page) {
  context = 'Canonical alerts through the actual mini-map'; await editing(page, false);
  await page.evaluate((entity) => {
    const c = document.querySelector('taylors3d-card'), f = window.visualFixture;
    f.moreInfo = []; c.addEventListener('hass-more-info', (event) => f.moreInfo.push(event.detail.entityId));
    const frame = c._view.captureCameraFrame();
    f.mapCamera = { mode: frame.mode, position: frame.position, quaternion: frame.quaternion, up: frame.up, zoom: frame.zoom, target: frame.target };
    c.setConfig({ ...c._config, mini_map: true }); f.patch(entity, 'on');
  }, entities.leak); await ready(page);
  await control(page, '.map-floor', (element) => element.select('upper'));
  const mapState = () => page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.visualFixture;
    const frame = c._view.captureCameraFrame();
    return { markers: c._miniMap.scene.markers.map(({ id, alert, x, y, floorId, active, unavailable, name }) => ({ id, alert, x, y, floorId, active, unavailable, name })),
      details: f.moreInfo.slice(), services: f.services.length,
      camera: { mode: frame.mode, position: frame.position, quaternion: frame.quaternion, up: frame.up, zoom: frame.zoom, target: frame.target }, shown: !c._miniMap.el.hidden,
      rendererSame: c._view.renderer === f.renderer, canvases: c.shadowRoot.querySelectorAll('canvas').length };
  });
  const selector = '.map-marker.alert[data-marker^="alert:location:"]';
  let result = await mapState(), marker = result.markers.find((item) => item.id.startsWith('alert:location:'));
  check('mini-map shows exact SOURCE coordinates on the configured upper floor', result.shown && marker?.alert
    && marker.x === 1.2 && marker.y === -.75 && marker.floorId === 'upper' && marker.active, result);
  await control(page, selector, async (element) => { await focusSvg(element); await page.keyboard.press('Enter'); }); result = await mapState();
  check('native alert Enter opens exact entity details without device commands or camera motion', same(result.details, [entities.leak])
    && result.services === 0 && same(result.camera, await page.evaluate(() => window.visualFixture.mapCamera)), result);
  const retained = await page.evaluate((selector) => {
    const c = document.querySelector('taylors3d-card'), node = c.shadowRoot.querySelector(selector); window.visualFixture.mapAlert = node;
    c.hass = { ...c._hass, locale: { ...c._hass.locale, language: 'de' } }; window.visualFixture.unrelated(); return !!node;
  }, selector); await settle(page);
  check('locale and unrelated readings preserve the focused actual SVG alert', retained && await page.evaluate((selector) => {
    const c = document.querySelector('taylors3d-card'), node = c.shadowRoot.querySelector(selector);
    return node === window.visualFixture.mapAlert && c.shadowRoot.activeElement === node && node.getAttribute('aria-label').includes('Bedienelemente');
  }, selector));
  const loss = (kind) => page.evaluate(({ kind, entity }) => {
    const c = document.querySelector('taylors3d-card'), f = window.visualFixture;
    if (kind === 'source') {
      const original = c._hass.states[entity], states = { ...c._hass.states }; delete states[entity]; c.hass = { ...c._hass, states };
      c.hass = { ...c._hass, states: { ...c._hass.states, [entity]: original } };
    } else f.pulse(kind);
  }, { kind, entity: entities.leak });
  for (const [gesture, kind] of [['pointer', 'source'], ['Space', 'connection'], ['Enter', 'role']]) {
    const before = await mapState();
    await control(page, selector, async (element) => {
      if (gesture === 'pointer') {
        const box = await element.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await loss(kind); await page.mouse.up();
      } else {
        await focusSvg(element); await page.keyboard.down(gesture); await loss(kind); await page.keyboard.up(gesture);
      }
    }); result = await mapState();
    check(`held alert ${gesture} cannot reopen details after ${kind} loss and recovery`, result.details.length === before.details.length
      && result.services === 0 && same(result.camera, before.camera), result);
    await control(page, selector, async (element) => { await focusSvg(element); await page.keyboard.press('Space'); });
    result = await mapState(); check(`fresh alert gesture still works after ${kind} recovery`, result.details.length === before.details.length + 1
      && result.details.at(-1) === entities.leak && result.services === 0);
  }
  await patch(page, entities.leak, 'on', { restored: true }); result = await mapState(); marker = result.markers.find((item) => item.id.startsWith('alert:location:'));
  check('restored alert reading stays labelled uncertain at its saved location', marker?.unavailable && !marker.active
    && marker.x === 1.2 && marker.y === -.75, marker);
  await patch(page, entities.leak, 'off', { restored: false }); result = await mapState();
  check('a confirmed clear removes only the alert while preserving the renderer and existing map symbols', !result.markers.some((item) => item.id.startsWith('alert:location:'))
    && result.rendererSame && result.canvases === 1 && result.services === 0, result);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, locale: { ...c._hass.locale, language: 'en' } };
    c.setConfig({ ...c._config, mini_map: false }); }); await ready(page); await editing(page, true);
}

async function mowerImage(page) {
  context = 'Native mower image threshold'; await tab(page, 'mower');
  await page.evaluate((entity) => {
    const c = document.querySelector('taylors3d-card'), f = window.visualFixture;
    f.beforeMower = structuredClone(c._layout.mower);
    const current = c._hass.states[entity], metadata = c._hass.entities[entity];
    if (entity !== 'vacuum.visual_cleaner' || current?.entity_id !== entity || current?.state !== 'cleaning'
        || !metadata || metadata.entity_id !== entity || metadata.hidden || metadata.disabled_by || metadata.entity_category) {
      throw new Error('Mower threshold fixture requires its exact current eligible simulated entity');
    }
    c._commit({ ...c._layout, mower: { entity, source: 'image', image: { entity: '', tolerance: 7, future: 'keep image extra' }, future: 'keep mower extra' } });
    c._edit.render();
  }, entities.vacuum); await settle(page);
  let before = await state(page);
  await type(page, 'mower-img-min-pixels', '3', { blur: true }); let after = await state(page);
  check('native minimum matching pixels saves one exact field without changing other image settings', after.layout.mower.image.min_pixels === 3
    && after.layout.mower.entity === entities.vacuum && after.layout.mower.source === 'image' && after.layout.mower.image.entity === ''
    && after.layout.mower.image.tolerance === 7 && after.layout.mower.image.future === 'keep image extra' && after.layout.mower.future === 'keep mower extra'
    && after.calls.length === 0 && !Object.hasOwn(before.layout.mower.image, 'min_pixels'));
  await click(page, action('history-undo')); after = await state(page);
  check('image threshold joins actual Undo', !Object.hasOwn(after.layout.mower.image, 'min_pixels') && after.layout.mower.image.future === 'keep image extra');
  await click(page, action('history-redo')); after = await state(page); check('image threshold joins actual Redo', after.layout.mower.image.min_pixels === 3);
  for (const kind of ['role', 'connection']) {
    before = await state(page); await type(page, 'mower-img-min-pixels', '8');
    await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.visualFixture.mowerInput = c.shadowRoot.querySelector('[data-field="mower-img-min-pixels"]'); });
    await page.evaluate((kind) => window.visualFixture.pulse(kind), kind); await page.keyboard.press('Tab'); after = await state(page);
    check(`unfinished mower threshold cannot save after ${kind} loss and recovery`, after.layout.mower.image.min_pixels === before.layout.mower.image.min_pixels
      && await page.evaluate(() => { const input = window.visualFixture.mowerInput; return input.disabled || !input.isConnected; }));
    await tab(page, 'rooms'); await tab(page, 'mower');
  }
  await type(page, 'mower-img-min-pixels', '0', { blur: true }); after = await state(page);
  check('a fresh native image threshold deliberately accepts zero', after.layout.mower.image.min_pixels === 0 && after.calls.length === 0);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._commit({ ...c._layout, mower: window.visualFixture.beforeMower }); c._edit.render(); }); await settle(page);
}

async function cardForm(page) {
  context = 'Actual card editor through explicitly simulated HA form host';
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), f = window.visualFixture;
    const host = document.querySelector('#form-host'); host.hidden = false;
    const editor = c.constructor.getConfigElement(); f.editor = editor; host.append(editor);
    editor.setConfig({ ...c._config, model: '/demo/visual-options-url.glb', model_position: [1, 2, 3], model_opacity: .4,
      views: { 'all': { label: 'My original view name', extension: [false, null, 'é'] } }, arbitrary_option: { untouched: true } }); editor.hass = c._hass;
    editor.addEventListener('config-changed', (event) => { f.configEvents.push(structuredClone(event.detail.config)); c.setConfig(event.detail.config); });
  });
  await type(page, 'model_opacity', '0', { form: true, blur: true }); await ready(page);
  let after = await state(page); check('actual native ha-form value-changed emits config-changed preserving zero opacity/position/extras', after.config.model_opacity === 0
    && same(after.config.model_position, [1, 2, 3]) && after.config.arbitrary_option?.untouched && after.configEvents.length === 1, after.config);
  await click(page, 'details:has([data-source-action="uploaded-model"]) summary', true);
  const selector = '[data-source-action="uploaded-model"]';
  for (const [gesture, loss] of [['pointer', 'role'], ['Space', 'connection'], ['Enter', 'source']]) {
    const before = await state(page);
    await control(page, selector, async (element) => {
      if (gesture === 'pointer') { const box = await element.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await page.evaluate((loss) => window.visualFixture.pulse(loss), loss); await page.mouse.up();
      } else { await element.focus(); if (gesture === 'Enter') await element.evaluate((button, loss) => { button.addEventListener('keydown', () => window.visualFixture.pulse(loss), { once: true }); }, loss);
        await page.keyboard.down(gesture); if (gesture !== 'Enter') await page.evaluate((loss) => window.visualFixture.pulse(loss), loss); await page.keyboard.up(gesture); }
    }, true);
    after = await state(page); check(`held ${gesture} source-clear loses ${loss} and cannot act after recovery`, after.configEvents.length === before.configEvents.length
      && after.config.model === before.config.model && same(after.layout.model, before.layout.model));
  }
  await click(page, selector, true); await ready(page); after = await state(page);
  check('fresh deliberate source-clear emits one native config and restores uploaded source only', !Object.hasOwn(after.config, 'model')
    && !Object.hasOwn(after.config, 'model_position') && !Object.hasOwn(after.config, 'model_opacity') && after.config.arbitrary_option?.untouched
    && after.config.model_rendering === undefined && after.layout.model.version === 1 && after.layout.model.opacity === 1);
  check('source-clear retains exact user-defined view label and unknown imported values', after.config.views?.all?.label === 'My original view name'
    && same(after.config.views?.all?.extension, [false, null, 'é']));
}

async function narrow(page) {
  context = '320px native controls/touch'; await page.setViewport({ width: 320, height: 900, deviceScaleFactor: 1, hasTouch: true });
  await editing(page, true); await tab(page, 'tracking'); await click(page, '[data-act="trk-edit"][data-index="0"]'); await settle(page);
  const bounds = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), controls = [...c.shadowRoot.querySelectorAll('[data-trk-editor] input:not([type="checkbox"]),[data-trk-editor] select,[data-trk-editor] button')];
    return { width: c.getBoundingClientRect().width, viewport: innerWidth, bad: controls.filter((node) => !node.hidden && node.getClientRects().length)
      .map((node) => ({ name: node.dataset.field || node.dataset.act, rect: node.getBoundingClientRect().toJSON() })).filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1 || rect.width < 44 || rect.height < 43) };
  }); check('320px Tracking controls remain within the actual card and have44px native targets', bounds.width <= bounds.viewport && bounds.bad.length === 0, bounds);
  await control(page, action('trk-cancel'), async (element) => { const box = await element.boundingBox(); await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); });
  check('native touch Cancel clears only the draft and sends no device action', await page.evaluate(() => !document.querySelector('taylors3d-card')._edit._trackingEditor.draft && window.visualFixture.services.length === 0));
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots', `visual-options-${mode}-320.png`), fullPage: true });
}

console.log('Scope: actual source/bundle/native controls; explicitly simulated HA WS/model/form transport; no real HA middleware/durable dashboard proof.');
console.log('Bundle SHA256: ' + createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/taylors3d-card.js'))).digest('hex'));
let running = null, fixture = null;
try {
  for (mode of ['source', 'bundle']) {
    fixture = await serveVisualOptionsFixture(root, mode); running = await launch(); const { page, errors } = await newPage(running.browser, { width: 1320, height: 1100, hasTouch: true });
    await page.evaluateOnNewDocument(() => { window.visualContexts = new Set(); const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const value = original.call(this, kind, ...args);
        if (value && /^webgl/.test(kind)) window.visualContexts.add(this); return value;
      }; });
    const external = []; page.on('request', (request) => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') external.push(url.href); });
    await page.goto(fixture.base + '/demo/visual-options-fixture.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.visualModuleReady === true); await page.bringToFront(); await prepare(page, fixture);
    let snapshot = await state(page); check('uploaded baseline uses one actual renderer/current auth and no device action', snapshot.contextCount === 1 && snapshot.sameRenderer && snapshot.calls.length === 0
      && fixture.requests.some((request) => request.path === `/api/taylors3d/model/${visualLayoutKey}`));
    await tracking(page); await cameras(page); await alerts(page); await alertMap(page); await mowerImage(page); await model(page); await cardForm(page); await narrow(page);
    snapshot = await state(page); check('all visual/source operations leave device services untouched and renderer owned once', snapshot.calls.length === 0 && snapshot.contextCount === 1 && snapshot.sameRenderer);
    check('no external URL was fetched by visual-options proof', external.length === 0 && fixture.unexpected.length === 0, { external, unexpected: fixture.unexpected });
    check('no unexpected browser errors', errors.length === 0, errors); browserErrors.push(...errors);
    await running.close(); running = null; await fixture.close(); fixture = null;
  }
} catch (error) { console.error('Browser proof stopped: ' + context + ': ' + error.stack); checks.push(false); }
finally { if (running) await running.close(); if (fixture) await fixture.close(); }
console.log(`${checks.filter(Boolean).length}/${checks.length} native visual-options checks passed; ${browserErrors.length} browser errors.`);
if (checks.some((pass) => !pass) || browserErrors.length) process.exitCode = 1;
