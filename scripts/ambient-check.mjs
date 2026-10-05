// F13: simulated wall-panel idle mode on the actual card and its one renderer.
// Browser time, native RAF and HA observations stay real. The isolated cadence
// proof instantiates only the pure policy controller; it never alters app time.
// Run after building: node scripts/ambient-check.mjs [--source-only|--bundle-only].
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { launch, newPage, root } from './lib/demo-browser.mjs';

const checks = [], errors = [];
let label = '', context = 'fixture setup';
const check = (name, pass, detail) => {
  checks.push(!!pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
};
const equal = isDeepStrictEqual;
const near = (a, b, tolerance = 1e-9) => a?.length === b?.length && a.every((n, i) => Math.abs(n - b[i]) <= tolerance);
const entity = 'light.ambient_lamp', editor = '[data-ambient-idle-editor]';
const field = (name) => `${editor} [data-field="ambient-idle-${name}"]`;
const editAction = (name) => `${editor} [data-act="ambient-idle-${name}"]`;
const policy = (extra = {}) => ({ enabled: true, idle_seconds: 1, rotate: true,
  rotation_degrees_per_second: 6, dim: { enabled: false, brightness: .5, when: 'sun', start: '22:00', end: '07:00' }, ...extra });

// MIT demo mesh/BIN accessors with explicit asymmetric authoring. The floor,
// wall and coloured blocks make camera rotation visible; lamp hints and all
// entity/floor associations are simulated fixture data, never household guesses.
function fixtureGlb() {
  const original = fs.readFileSync(path.join(root, 'demo/house.glb')), length = original.readUInt32LE(12);
  const gltf = JSON.parse(original.toString('utf8', 20, 20 + length));
  const sourceBox = gltf.nodes.find((n) => n.name === 'coffee_table_body').mesh;
  const sourceLamp = gltf.nodes.find((n) => n.name === 'lamp_living');
  const sourceGlow = gltf.nodes[sourceLamp.children.find((i) => gltf.nodes[i].name === 'glow')].mesh;
  const material = (name, rgb) => gltf.materials.push({ name, pbrMetallicRoughness: {
    baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 1 }, emissiveFactor: [0, 0, 0] }) - 1;
  const gray = material('ambient_neutral', [.4, .4, .4]), red = material('ambient_red', [.9, .06, .02]), blue = material('ambient_blue', [.02, .08, .9]);
  const mesh = (source, mat) => gltf.meshes.push({ ...gltf.meshes[source], primitives: gltf.meshes[source].primitives.map((p) => ({ ...p, material: mat })) }) - 1;
  const box = mesh(sourceBox, gray), redBox = mesh(sourceBox, red), blueBox = mesh(sourceBox, blue), glow = mesh(sourceGlow, gray);
  const node = (value) => gltf.nodes.push(value) - 1;
  const floor = node({ name: 'ambient_floor', mesh: box, translation: [0, -.05, 0], scale: [4 / 1.2, .1 / .45, 4 / .7] });
  const wall = node({ name: 'ambient_wall', mesh: box, translation: [0, 1.35, -2.06], scale: [4 / 1.2, 2.7 / .45, .12 / .7] });
  const redShape = node({ name: 'ambient_red_block', mesh: redBox, translation: [-1.1, .3, -.9], scale: [.7 / 1.2, .6 / .45, .9 / .7] });
  const blueShape = node({ name: 'ambient_blue_block', mesh: blueBox, translation: [1.2, .7, .7], scale: [.4 / 1.2, 1.4 / .45, .5 / .7] });
  const lamp = node({ name: 'ambient_lamp', translation: [-.8, 1.6, .5], children: [node({ name: 'ambient_lamp_glow', mesh: glow })],
    extras: { fp: { kind: 'object', id: 'ambient_lamp', type: 'light', label: 'Simulated test lamp',
      glow: 'ambient_lamp_glow', suggest: { entity }, hints: { max: 20, distance: 8, decay: 2 } } } });
  const room = node({ name: 'ambient_room', children: [floor, wall, redShape, blueShape, lamp], extras: { fp: {
    kind: 'room', id: 'ambient_room', outline: [[-2, -2], [2, -2], [2, 2], [-2, 2]], suggest: { area: 'living_room' } } } });
  const ground = node({ name: 'ambient_ground', children: [room], extras: { fp: { kind: 'level', id: 'ground', role: 'storey', order: 0, elevation: 0, height: 2.7 } } });
  const house = node({ name: 'ambient_bench', children: [ground], extras: { fp: { views: [{ id: 'ground', label: 'Simulated idle bench', show: ['level:ground'] }] } } });
  gltf.scenes = [{ nodes: [house] }]; gltf.scene = 0;
  const body = Buffer.from(JSON.stringify(gltf)), padding = Buffer.alloc((4 - body.length % 4) % 4, 0x20), rest = original.subarray(20 + length), head = Buffer.alloc(20);
  head.write('glTF'); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + body.length + padding.length + rest.length, 8);
  head.writeUInt32LE(body.length + padding.length, 12); head.write('JSON', 16);
  return Buffer.concat([head, body, padding, rest]);
}

async function ready(page) {
  try { await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card'), v = c?._view, now = performance.now();
    if (!v || v._ambientCamera || v.dirty || v._tween || v._modelMotionMoving || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350) {
      window.ambientIdleSample = null; return false;
    }
    if (!window.ambientIdleSample || ['frames', 'shadow', 'shadowLights'].some((k) => window.ambientIdleSample[k] !== v.stats[k])) {
      window.ambientIdleSample = { ...v.stats, at: now }; return false;
    } return now - window.ambientIdleSample.at > 350;
  }, { timeout: 15000, polling: 50 }); } catch (error) {
    error.message += `; ${context}; ${JSON.stringify(await snapshot(page).catch(() => null))}`; throw error;
  }
}
async function control(page, selector, callback) {
  context = 'UI ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const el = handle.asElement(); if (!el) throw new Error('Missing idle control: ' + selector);
    await el.evaluate((element) => element.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(el);
  } finally { await handle.dispose(); }
}
const click = (page, selector) => control(page, selector, (el) => el.click());
const choose = (page, selector, value) => control(page, selector, (el) => el.select(value));
const type = (page, selector, value) => control(page, selector, async (el) => {
  await el.click(); await page.keyboard.down('Control');
  try { await page.keyboard.press('a'); } finally { await page.keyboard.up('Control'); }
  await el.press('Backspace'); await el.type(value);
  const actual = await el.evaluate((input) => input.value);
  if (actual !== value) throw new Error(`Native idle input ${selector}: ${JSON.stringify(actual)} instead of ${JSON.stringify(value)}`);
});
async function screenshot(page, name, fullPage = false) {
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots', name), fullPage });
}
async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, f = window.ambientFixture, layer = c._objects;
    const pose = () => ({ position: v.camera.position.toArray(), quaternion: v.camera.quaternion.toArray(), up: v.camera.up.toArray(), zoom: v.camera.zoom,
      target: v.controls.target.toArray(), autoRotate: v.controls.autoRotate, autoRotateSpeed: v.controls.autoRotateSpeed,
      damping: v.controls.enableDamping, enabled: v.controls.enabled, labels: v.labelRenderer.domElement.style.display,
      flags: Object.fromEntries(['enableRotate', 'enablePan', 'enableZoom', 'dampingFactor', 'screenSpacePanning', 'zoomToCursor',
        'minDistance', 'maxDistance', 'minZoom', 'maxZoom', 'minPolarAngle', 'maxPolarAngle', 'minAzimuthAngle', 'maxAzimuthAngle', 'minTargetRadius', 'maxTargetRadius']
        .filter((key) => key in v.controls).map((key) => [key, typeof v.controls[key] === 'number' && !Number.isFinite(v.controls[key]) ? String(v.controls[key]) : v.controls[key]])) });
    const pool = [...layer.pool.points, ...layer.pool.spots], glow = layer.objectAt('ambient_lamp')?.part.glow.material;
    return { pose: pose(), active: !!v._ambientCamera, stats: { ...v.stats }, objects: { ...layer.stats }, memory: { ...v.renderer.info.memory },
      programs: v.renderer.info.programs.map((program) => program.id), pool: pool.map((lamp) => lamp.uuid), physicalShadows: pool.filter((lamp) => lamp.castShadow).length,
      pending: [v.sun, ...pool].filter((lamp) => lamp.shadow?.needsUpdate).map((lamp) => lamp.uuid), shadowEnabled: v.renderer.shadowMap.enabled,
      materials: [...new Set([...layer.parts.values()].flatMap((entry) => entry.part.glow ? [entry.part.glow.material] : []))].map((mat) => ({ uuid: mat.uuid, version: mat.version, rgb: mat.emissive?.toArray(), intensity: mat.emissiveIntensity })),
      lamp: glow && { uuid: glow.uuid, version: glow.version, rgb: glow.emissive.toArray(), intensity: glow.emissiveIntensity },
      renderer: v.renderer === f.renderer, contexts: window.ambientContexts.size,
      capture: f.capture && { frame: f.capture.frame, width: f.capture.width, height: f.capture.height, lit: f.capture.lit }, services: f.services.length, commits: f.commits,
      saved: c._layout.ambient_idle, editing: c._editing, tab: c._edit?.tab, mode: c._mode, section: v.section?.enabled,
      popup: !!c._devicePopup?.isOpen, scenePreview: !!c._lightPreview, controller: c._ambientController.state,
      filter: c._scene.style.getPropertyValue('filter'), filterPriority: c._scene.style.getPropertyPriority('filter'),
      eligible: c._ambientContext().eligible, reducedMotion: !!c._reducedMotion?.matches, lightingWrites: f.lightingWrites, labelRenders: f.labelRenders,
      dirty: v.dirty, tween: !!v._tween, occTimer: !!v._occTimer,
      loading: c._loading, visible: document.visibilityState, inView: c._weatherInView, raf: !!v._raf, cameraAge: performance.now() - (v._camMovedAt || 0),
      advances: f.advances.slice(-10), begins: f.begins.slice(-3), ends: f.ends.slice(-3), gets: f.gets.slice(-3), size: v.size };
  });
}
async function setPolicy(page, settings) {
  context = 'saved ambient policy'; await page.evaluate((settings) => { const c = document.querySelector('taylors3d-card'); c._commit({ ...c._layout, ambient_idle: settings }); }, settings);
}
async function patch(page, states = {}, extra = {}) {
  context = 'HA update ' + Object.keys(states).join(', ');
  await page.evaluate(({ states, extra }) => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, ...extra, states: { ...c._hass.states, ...states } }; }, { states, extra });
}
async function waitAmbient(page, active = true) {
  context = active ? 'actual idle RAF begins' : 'actual idle guard restores';
  await page.waitForFunction((active) => !!document.querySelector('taylors3d-card')._view._ambientCamera === active, { timeout: 7000, polling: 50 }, active);
}
async function captureNext(page) {
  const old = await page.evaluate(() => { const f = window.ambientFixture; f.captureRequested = true; return f.capture?.frame ?? -1; });
  await page.waitForFunction((old) => window.ambientFixture.capture?.frame > old, { timeout: 7000, polling: 50 }, old);
  return page.evaluate(() => window.ambientFixture.capture);
}

async function installObservers(page) {
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, f = window.ambientFixture;
    const pose = () => ({ position: v.camera.position.toArray(), quaternion: v.camera.quaternion.toArray(), up: v.camera.up.toArray(), zoom: v.camera.zoom,
      target: v.controls.target.toArray(), autoRotate: v.controls.autoRotate, autoRotateSpeed: v.controls.autoRotateSpeed,
      damping: v.controls.enableDamping, enabled: v.controls.enabled, labels: v.labelRenderer.domElement.style.display,
      flags: Object.fromEntries(['enableRotate', 'enablePan', 'enableZoom', 'dampingFactor', 'screenSpacePanning', 'zoomToCursor',
        'minDistance', 'maxDistance', 'minZoom', 'maxZoom', 'minPolarAngle', 'maxPolarAngle', 'minAzimuthAngle', 'maxAzimuthAngle', 'minTargetRadius', 'maxTargetRadius']
        .filter((key) => key in v.controls).map((key) => [key, typeof v.controls[key] === 'number' && !Number.isFinite(v.controls[key]) ? String(v.controls[key]) : v.controls[key]])) });
    f.restores = []; f.lightingWrites = 0; f.labelRenders = 0;
    const wrap = (object, name, observe) => {
      const original = object[name], own = Object.hasOwn(object, name);
      if (typeof original !== 'function') throw new Error('Missing ambient runtime API: ' + name);
      object[name] = function (...args) { return observe.call(this, original, args); };
      f.restores.push(() => { if (own) object[name] = original; else delete object[name]; return object[name] === original; });
    };
    wrap(v, 'beginAmbientCamera', function (original, args) {
      const before = pose(), result = original.apply(this, args); f.begins.push({ at: performance.now(), reading: { ...args[0], token: args[0]?.token?.id }, before, result }); return result;
    });
    wrap(v, 'advanceAmbientCamera', function (original, args) {
      const before = pose(), at = performance.now(), result = original.apply(this, args);
      f.advances.push({ at, delta: args[0]?.deltaSeconds, before, after: pose(), result }); if (f.advances.length > 1000) f.advances.shift(); return result;
    });
    wrap(v, 'endAmbientCamera', function (original, args) {
      const before = pose(), result = original.apply(this, args); f.ends.push({ at: performance.now(), reading: { ...args[0], token: args[0]?.token?.id }, before, after: pose(), result }); return result;
    });
    wrap(v, 'getCamera', function (original, args) {
      const raw = pose(), result = original.apply(this, args); f.gets.push({ raw, active: !!v._ambientCamera, at: performance.now() }); if (f.gets.length > 200) f.gets.shift(); return result;
    });
    f.labelSnapshots = [];
    wrap(v.labelRenderer, 'render', function (original, args) {
      f.labelRenders++; const result = original.apply(this, args);
      const marker = c._markers?.find((entry) => entry.entityId === 'sensor.living_temperature');
      f.labelSnapshots.push({ count: f.labelRenders, value: marker && c._markerEls.get(marker.id)?.querySelector('.fp-val')?.textContent });
      if (f.labelSnapshots.length > 100) f.labelSnapshots.shift(); return result;
    });
    for (const lamp of [...c._objects.pool.points, ...c._objects.pool.spots]) {
      const descriptor = Object.getOwnPropertyDescriptor(lamp, 'intensity'); let value = lamp.intensity;
      Object.defineProperty(lamp, 'intensity', { configurable: true, get: () => value, set: (next) => { f.lightingWrites++; value = next; } });
      f.restores.push(() => { Object.defineProperty(lamp, 'intensity', { ...descriptor, value }); return Object.getOwnPropertyDescriptor(lamp, 'intensity').value === value; });
      for (const [object, name] of [[lamp.color, 'setRGB'], [lamp.position, 'copy'], [lamp.position, 'set']]) {
        const original = object[name], own = Object.hasOwn(object, name);
        object[name] = function (...args) { f.lightingWrites++; return original.apply(this, args); };
        f.restores.push(() => { if (own) object[name] = original; else delete object[name]; return object[name] === original; });
      }
    }
    f.previousRender = v.onRender;
    v.onRender = () => {
      f.previousRender?.(); if (!f.captureRequested) return; f.captureRequested = false;
      const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, bytes = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      const samples = []; let lit = 0;
      // A fixed screen grid is intentionally different from a moving world probe:
      // it demonstrates that the already-rendered picture really moves.
      for (let y = 1; y < 32; y++) for (let x = 1; x < 32; x++) {
        const offset = (Math.floor(y * height / 32) * width + Math.floor(x * width / 32)) * 4;
        samples.push(...bytes.subarray(offset, offset + 3)); if (bytes[offset] + bytes[offset + 1] + bytes[offset + 2] > 24) lit++;
      } f.capture = { frame: v.stats.frames, width, height, samples, lit, pose: pose() };
    };
  });
}
async function restoreObservers(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.ambientFixture; if (!f) return true;
    let okay = true;
    if (Object.hasOwn(f, 'previousRender') && c?._view) { c._view.onRender = f.previousRender; okay = c._view.onRender === f.previousRender; delete f.previousRender; }
    for (const restore of (f.restores || []).reverse()) okay = restore() && okay; f.restores = [];
    if (Object.hasOwn(f, 'hiddenDescriptor')) {
      if (f.hiddenDescriptor) Object.defineProperty(document, 'hidden', f.hiddenDescriptor); else delete document.hidden;
      delete f.hiddenDescriptor; document.dispatchEvent(new Event('visibilitychange'));
    } return okay;
  });
}

async function prepare(page, mode) {
  await page.evaluate(async ({ mode, entity }) => {
    const c = document.querySelector('taylors3d-card');
    window.ambientFixture = { services: [], commits: 0, renderer: c._view.renderer, begins: [], advances: [], ends: [], gets: [], capture: null,
      captureRequested: false, subscriptions: new Map(), replies: [], sequence: 0 };
    const f = window.ambientFixture;
    c.hass = { ...c._hass, callWS: undefined };
    c.setConfig({ ...c._config, layout_key: `ambient-browser-${mode}`, height: '600px', merge: false, model_opacity: 1,
      control_panel: 'right', device_tap_action: 'toggle', lights: 'auto', sky_bodies: false, mini_map: false,
      automation_panel: 'ambient-fixture', automation_card_id: 'ambient-card' });
    await c._layoutReady;
    const connection = new EventTarget(); connection.connected = true;
    connection.subscribeMessage = async (callback, address) => {
      if (address.type !== 'taylors3d/preset/subscribe') throw new Error('Unexpected idle fixture subscription');
      const id = 'target-' + ++f.sequence; f.subscriptions.set(id, { callback, address }); return async () => f.subscriptions.delete(id);
    };
    const states = {
      [entity]: { entity_id: entity, state: 'on', attributes: { friendly_name: 'Simulated idle test lamp', brightness: 255, rgb_color: [255, 255, 255], color_mode: 'rgb', supported_color_modes: ['rgb'] } },
      'sensor.ambient_unrelated': { state: '0', attributes: { friendly_name: 'Known unrelated reading' } },
      'sensor.living_temperature': { state: '21.4', attributes: { friendly_name: 'Living temperature', device_class: 'temperature', unit_of_measurement: '°C' } },
      'binary_sensor.ambient_smoke': { state: 'off', attributes: { friendly_name: 'Simulated smoke', device_class: 'smoke' } },
      'scene.ambient_movie': { state: 'unknown', attributes: { friendly_name: 'Simulated Movie' } },
      'sun.sun': { state: 'below_horizon', attributes: { elevation: -20, azimuth: 180 } },
    };
    c.hass = { ...c._hass, connection, user: { id: 'ambient-fixture-admin', is_admin: true, is_active: true }, config: { ...c._hass.config, latitude: null, longitude: null, time_zone: 'Europe/London' },
      services: { light: { toggle: {}, turn_on: {}, turn_off: {} }, scene: { turn_on: {} } }, states,
      callService: (...args) => { f.services.push(args); return Promise.resolve(); },
      callWS: async (message) => {
        if (message.type === 'taylors3d/preset/result') { f.replies.push(message); return {}; }
        if (message.type === 'taylors3d/layout/get') return { layout: c._layout }; return {};
      } };
    c._commit({ ...c._layout, rooms: [], pins: {}, hidden: [], mower: {}, objects: {}, model: {}, views: {},
      ambient_idle: { enabled: false }, model_rendering: { shadows: 'off', lamps: 'inherit' }, room_overlays: { mode: 'off' }, alert_bindings: [], security_bindings: [], weather: { enabled: false },
      presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [], camera_coverage: { enabled: false },
      scene_previews: { enabled: true, items: [{ id: 'movie', label: 'Movie', scene_entity: 'scene.ambient_movie', lights: [{ entity, state: 'on', brightness: 255, color: { mode: 'rgb', rgb: [0, 0, 255] } }] }] } });
    const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (patch) => { f.commits++; return commit(patch); };
    c._skyMode = 'auto'; c._applySky(true); c._view.stopCameraMotion(); c.resetHistory();
    document.querySelector('section.theme h2').textContent = `Simulated wall-panel idle mode · ${mode}`;
  }, { mode, entity });
  await ready(page); await installObservers(page);
  await page.evaluate(() => { const v = document.querySelector('taylors3d-card')._view; window.ambientFixture.captureRequested = true;
    // Deliberately keep more precision than getCamera's saved-view rounding, so
    // restoration through that rounded API would fail the exact raw-pose proof.
    v.setCamera({ position: [6.0123456789, 5.0456789123, 7.0789123456], target: [.023456789, 1.03456789, -.0123456789] }, { instant: true }); });
  await ready(page);
}
async function open(mode) {
  const transport = await launch(); let session; const pageErrors = [];
  try {
    session = await newPage(transport.browser, { width: 1280, height: 1100, hasTouch: true }); const { page } = session, requests = [], glb = fixtureGlb();
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack, context: label + context }));
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8').replace(/<section class="theme dark">[\s\S]*?<\/section>/, '')
      .replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
    if (mode === 'source') html = html.replace('</head>', `<script type="importmap">${JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } })}</script></head>`)
      .replace('src="../dist/taylors3d-card.js"', 'src="../src/taylors3d-card.js"');
    await page.evaluateOnNewDocument(() => {
      window.__demoMowerPaused = true; window.ambientContexts = new Set();
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const value = original.call(this, kind, ...args); if (value && /^webgl/.test(kind)) window.ambientContexts.add(this); return value; };
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
      else if (url.pathname === '/demo/ambient-fixture.glb') request.respond({ status: 200, contentType: 'model/gltf-binary', body: glb }); else request.continue();
    });
    await page.goto(`${transport.base}/demo/index.html?model=/demo/ambient-fixture.glb&merge=0&floor=ground&view=3d&height=600px`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront(); await page.waitForFunction(() => document.querySelector('taylors3d-card')?._objects?.parts.has('ambient_lamp'), { timeout: 30000 });
    await prepare(page, mode); return { ...transport, ...session, requests, pageErrors };
  } catch (error) { errors.push(...pageErrors, ...(session?.errors || [])); if (session) await restoreObservers(session.page).catch(() => {}); await transport.close(); throw error; }
}

// During real rotation frames are expected. Only resources/light writes/shadows
// must remain unchanged; after suspension the usual strict idle check also applies.
function sameLighting(before, after) {
  return equal(before.pool, after.pool) && equal(before.memory, after.memory) && equal(before.programs, after.programs)
    && equal(before.materials, after.materials) && equal(before.lamp, after.lamp)
    && before.objects.budget === after.objects.budget && before.objects.shadowRequests === after.objects.shadowRequests
    && before.stats.shadow === after.stats.shadow && before.stats.shadowLights === after.stats.shadowLights
    && before.lightingWrites === after.lightingWrites;
}

async function waitController(page, active = true) {
  await page.waitForFunction((active) => document.querySelector('taylors3d-card')._ambientController.state.active === active, { timeout: 7000, polling: 50 }, active);
}
async function observedRestoration(page) {
  return page.evaluate(() => {
    const f = window.ambientFixture, end = f.ends.at(-1), begin = f.begins.findLast((entry) => entry.reading.token === end?.reading.token);
    return { exact: !!begin && !!end && JSON.stringify(begin.before) === JSON.stringify(end.after), before: begin?.before, after: end?.after, restore: end?.reading.restore };
  });
}
async function holdObservation(page, milliseconds = 1250) {
  // A test observer's real wait never advances/coerces application time.
  await page.evaluate((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), milliseconds);
}
async function lampPoint(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), anchor = c._objects.anchors().find((entry) => entry.id === 'ambient_lamp');
    const point = anchor && c._view.projectWorld(anchor.world);
    return point && { x: point[0], y: point[1], picked: c._objectHit(point[0], point[1], 32), width: innerWidth, height: innerHeight };
  });
}
async function cadenceScenario(page) {
  const cadence = await page.evaluate(() => {
    const Controller = document.querySelector('taylors3d-card')._ambientController.constructor;
    const run = (fps, gap = false) => {
      let degrees = 0, advances = 0, begins = 0, ends = 0; const deltas = [];
      const controller = new Controller({ getContext: () => ({ policy: { enabled: true, idle_seconds: 1, rotation_degrees_per_second: 6 }, eligible: true, generation: 'isolated-cadence' }),
        onBegin: () => { begins++; }, onAdvance: (reading) => { degrees += reading.degrees; advances++; deltas.push(reading.deltaSeconds); }, onEnd: () => { ends++; } });
      controller.tick(0); controller.tick(1000);
      if (gap) controller.tick(6000); else for (let i = 1; i <= fps; i++) controller.tick(1000 + i * 1000 / fps);
      controller.dispose(); return { degrees, advances, begins, ends, maxDelta: Math.max(...deltas) };
    }; return { thirty: run(30), sixty: run(60), gap: run(60, true), appActive: !!document.querySelector('taylors3d-card')._view._ambientCamera };
  });
  check('isolated pure policy gives equal 30/60 cadence speed and caps a long resume gap', Math.abs(cadence.thirty.degrees - 6) < 1e-9 && Math.abs(cadence.sixty.degrees - 6) < 1e-9
    && cadence.thirty.advances === 30 && cadence.sixty.advances === 60 && cadence.thirty.begins === 1 && cadence.sixty.ends === 1
    && Math.abs(cadence.gap.degrees - .3) < 1e-9 && cadence.gap.maxDelta === .05 && cadence.appActive, cadence);
}

async function wakeScenario(page) {
  await waitAmbient(page); const point = await lampPoint(page), before = await snapshot(page);
  if (!point || point.picked !== 'ambient_lamp' || point.x < 0 || point.x > point.width || point.y < 0 || point.y > point.height) throw new Error('Real lamp target is not tappable: ' + JSON.stringify(point));
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.ambientFixture, marker = c._markers.find((entry) => entry.entityId === 'sensor.living_temperature');
    if (!marker || !c._markerEls.has(marker.id)) throw new Error('Missing real temperature label fixture');
    f.markerBeforeWake = c._markerEls.get(marker.id); f.labelsBeforeWake = f.labelRenders;
    c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.living_temperature': { state: '32.1', attributes: { friendly_name: 'Living temperature', device_class: 'temperature', unit_of_measurement: '°C' } } } };
  });
  // touchStart supplies a native pointerdown without a preceding mousemove that
  // would already wake the camera before the deliberately tested first tap.
  await page.touchscreen.tap(point.x, point.y); await waitAmbient(page, false);
  const awake = await snapshot(page), restoration = await observedRestoration(page);
  check('first native touch restores exact raw pose/flags/labels and only wakes', restoration.exact && restoration.restore && !awake.active
    && awake.services === before.services && !awake.popup && awake.filter === '' && !awake.pose.autoRotate, restoration);
  await page.waitForFunction(() => window.ambientFixture.labelRenders > window.ambientFixture.labelsBeforeWake, { timeout: 7000, polling: 50 });
  const labels = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.ambientFixture, first = f.labelSnapshots.find((entry) => entry.count > f.labelsBeforeWake);
    const marker = c._markers.find((entry) => entry.entityId === 'sensor.living_temperature');
    return { first, before: f.labelsBeforeWake, retained: c._markerEls.get(marker.id) === f.markerBeforeWake, current: c._markerEls.get(marker.id).querySelector('.fp-val').textContent };
  });
  check('first actual wake label render shows latest HA reading with retained marker DOM', labels.first.count === labels.before + 1 && labels.retained
    && labels.first.value?.includes('32.1') && labels.current.includes('32.1'), labels);
  const fresh = await lampPoint(page); await page.touchscreen.tap(fresh.x, fresh.y);
  const services = await page.evaluate(() => window.ambientFixture.services);
  check('a fresh deliberate tap keeps the normal exact lamp action', services.length === before.services + 1 && equal(services.at(-1), ['light', 'toggle', { entity_id: entity }]), services.at(-1));
  await ready(page); await waitAmbient(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._scene.tabIndex = -1;
    // Focus before arming so the later actual key itself is the wake gesture.
    c._scene.focus();
  }); await waitAmbient(page); const keyBefore = await snapshot(page);
  await page.keyboard.down('Shift'); await waitAmbient(page, false); await holdObservation(page);
  const heldKey = await snapshot(page), keyRestore = await observedRestoration(page);
  check('native held key restores before interaction and cannot rearm while held', keyRestore.exact && !heldKey.controller.active && !heldKey.eligible && heldKey.services === keyBefore.services, keyRestore);
  await page.keyboard.up('Shift'); await waitAmbient(page);
  // Wheel is normal user navigation. Only the synchronous end snapshot is exact;
  // the real wheel may then legitimately move the camera.
  const rect = await page.evaluate(() => { const r = document.querySelector('taylors3d-card')._scene.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 20 }; });
  await page.mouse.move(rect.x, rect.y); await waitAmbient(page); await page.mouse.wheel({ deltaY: 20 });
  const wheelRestore = await observedRestoration(page);
  check('native wheel restores idle baseline before ordinary zoom work', wheelRestore.exact && wheelRestore.restore);
  await waitAmbient(page); await page.mouse.down(); await waitAmbient(page, false); await holdObservation(page);
  const heldPointer = await snapshot(page), pointerRestore = await observedRestoration(page);
  check('a native held pointer cannot restart idle under the user’s hand', pointerRestore.exact && !heldPointer.active && !heldPointer.controller.active && !heldPointer.eligible
    && heldPointer.services === keyBefore.services, pointerRestore);
  await page.mouse.up();
  await setPolicy(page, { enabled: false }); await ready(page);
}

async function guardScenario(page) {
  await setPolicy(page, policy()); await waitAmbient(page);
  await click(page, 'button[data-mode="top"]'); await ready(page); await holdObservation(page);
  let data = await snapshot(page);
  check('Top view blocks idle camera and dimming', data.mode === 'top' && !data.active && !data.controller.active && !data.eligible && data.filter === '');
  await click(page, 'button[data-mode="3d"]'); await waitAmbient(page);
  await click(page, 'button.section'); await ready(page); await holdObservation(page); data = await snapshot(page);
  check('native Section stops and blocks the idle orbit', !data.active && !data.controller.active && !data.eligible && await page.evaluate(() => document.querySelector('taylors3d-card')._section));
  await click(page, 'button.section'); await waitAmbient(page);
  await click(page, '[data-scene-action="preview"][data-scene-id="movie"]'); await ready(page); await holdObservation(page); data = await snapshot(page);
  check('pinned saved scene preview blocks ambient effects and keeps its private lights', !data.active && !data.controller.active && !data.eligible && data.scenePreview && data.services === 1);
  await click(page, '[data-scene-action="stop"]'); await waitAmbient(page);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await ready(page); await holdObservation(page); data = await snapshot(page);
  check('actual reduced-motion preference restores pose and blocks both idle effects', data.reducedMotion && !data.active && !data.controller.active && data.filter === '' && (await observedRestoration(page)).exact);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); await waitAmbient(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = false; c._hass.connection.dispatchEvent(new Event('disconnected'));
  }); await waitAmbient(page, false); await holdObservation(page); data = await snapshot(page);
  check('actual disconnected HA transport blocks idle rather than using stale session evidence', !data.active && !data.controller.active && !data.eligible && (await observedRestoration(page)).exact);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = true; c._hass.connection.dispatchEvent(new Event('ready')); c.hass = { ...c._hass };
  }); await waitAmbient(page);
  await page.evaluate(() => {
    const f = window.ambientFixture; f.hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
  }); await waitAmbient(page, false); data = await snapshot(page);
  check('simulated document-hidden lifecycle immediately restores and blocks idle', !data.controller.active && !data.eligible && data.filter === '' && (await observedRestoration(page)).exact);
  await page.evaluate(() => {
    const f = window.ambientFixture;
    if (f.hiddenDescriptor) Object.defineProperty(document, 'hidden', f.hiddenDescriptor); else delete document.hidden;
    delete f.hiddenDescriptor; document.dispatchEvent(new Event('visibilitychange'));
  }); await waitAmbient(page);
  await page.evaluate(() => {
    const spacer = document.createElement('div'); spacer.id = 'ambient-scroll-space'; spacer.style.height = '2200px'; document.body.append(spacer); window.scrollTo(0, 1600);
  }); await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherInView === false, { timeout: 7000, polling: 50 });
  await waitAmbient(page, false); data = await snapshot(page);
  check('native offscreen IntersectionObserver restores the camera and blocks idle', !data.inView && !data.controller.active && !data.eligible && (await observedRestoration(page)).exact);
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#ambient-scroll-space')?.remove(); }); await waitAmbient(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._commit({ ...c._layout, alert_bindings: [{ id: 'ambient-smoke', entity: 'binary_sensor.ambient_smoke', type: 'smoke', x: 0, y: 0, z: 1.2, floorId: 'ground' }] });
    c.hass = { ...c._hass, states: { ...c._hass.states, 'binary_sensor.ambient_smoke': { state: 'on', attributes: { friendly_name: 'Simulated smoke', device_class: 'smoke' } } } };
  }); await waitAmbient(page, false); await holdObservation(page); data = await snapshot(page);
  check('actual active located alert prevents decorative idle orbit', !data.active && !data.controller.active && !data.eligible
    && await page.evaluate(() => document.querySelector('taylors3d-card')._alertData.stats.active === 1));
  await patch(page, { 'binary_sensor.ambient_smoke': { state: 'off', attributes: { friendly_name: 'Simulated smoke', device_class: 'smoke' } } }); await waitAmbient(page);
  await click(page, 'button.edit'); await ready(page); await holdObservation(page); data = await snapshot(page);
  check('native Edit blocks idle until explicitly leaving the editor', data.editing && !data.active && !data.controller.active && !data.eligible);
  await click(page, 'button.edit'); await waitAmbient(page);
  // Change the tap preference explicitly, then the next real device tap opens
  // its ordinary panel. Open panels are a persistent idle guard.
  await setPolicy(page, policy({ idle_seconds: 2 }));
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, device_tap_action: 'popup' }); }); await ready(page);
  const point = await lampPoint(page); await page.touchscreen.tap(point.x, point.y); await ready(page); await holdObservation(page); data = await snapshot(page);
  check('actual open device panel blocks idle, leaving its source readings usable', data.popup && !data.active && !data.controller.active && !data.eligible && data.services === 1);
  await click(page, '.taylors3d-device-popup button[aria-label="Close controls"]'); await setPolicy(page, { enabled: false }); await ready(page);
}

async function dimScenario(page, mode) {
  await setPolicy(page, { enabled: false }); await ready(page);
  await page.evaluate(() => document.querySelector('taylors3d-card')._scene.style.setProperty('filter', 'contrast(1.1)', 'important'));
  const before = await snapshot(page);
  await setPolicy(page, policy({ rotate: false, dim: { enabled: true, brightness: .5, when: 'sun', start: '22:00', end: '07:00' } }));
  await waitController(page); let dimmed = await snapshot(page);
  check('actual below-horizon sun dims only the card picture with owned CSS', dimmed.controller.brightness === .5 && dimmed.filter === 'contrast(1.1) brightness(0.5)'
    && dimmed.filterPriority === 'important' && !dimmed.active && equal(before.pose, dimmed.pose) && before.stats.frames === dimmed.stats.frames
    && sameLighting(before, dimmed) && dimmed.services === before.services, { filter: dimmed.filter, before: before.stats, after: dimmed.stats });
  await screenshot(page, mode === 'source' ? 'ambient-dim.png' : 'ambient-dim-bundle.png');
  await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card');
    for (let i = 0; i < 10; i++) { c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.ambient_unrelated': { state: String(20 + i), attributes: { friendly_name: 'Known unrelated reading' } } } }; await new Promise((resolve) => setTimeout(resolve, 40)); }
  }); dimmed = await snapshot(page);
  check('dim-only plus unrelated HA updates stays strict GPU/pool/material idle', dimmed.stats.frames === before.stats.frames && sameLighting(before, dimmed) && dimmed.filter.endsWith('brightness(0.5)'));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._scene.style.filter === 'contrast(1.1)', { timeout: 7000, polling: 50 });
  const reduced = await snapshot(page);
  check('reduced-motion removes dim effect without a WebGL frame or losing prior inline CSS', reduced.filter === before.filter && reduced.filterPriority === before.filterPriority
    && reduced.stats.frames === before.stats.frames && sameLighting(before, reduced) && !reduced.controller.active);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); await waitController(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._skyMode = 'day'; c._applySky(false); }); await ready(page);
  check('manual Day is separate from actual sun-based idle dim condition', (await snapshot(page)).controller.brightness === .5);
  await patch(page, { 'sun.sun': { state: 'unavailable', attributes: {} } });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._ambientController.state.brightness === 1, { timeout: 7000, polling: 50 });
  check('unavailable actual sun removes night dim without inventing a condition', (await snapshot(page)).filter === 'contrast(1.1)');
  await patch(page, { 'sun.sun': { state: 'below_horizon', attributes: { elevation: -20, azimuth: 180, restored: true } } });
  await holdObservation(page, 300);
  check('restored sun snapshot stays untrusted for current night dim', (await snapshot(page)).controller.brightness === 1);
  await patch(page, { 'sun.sun': { state: 'below_horizon', attributes: { elevation: -20, azimuth: 180 } } });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._ambientController.state.brightness === .5, { timeout: 7000, polling: 50 });
  await setPolicy(page, { enabled: false }); await ready(page);
  const hours = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), zone = c._hass.config.time_zone;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const minute = Number(parts.find((entry) => entry.type === 'hour').value) * 60 + Number(parts.find((entry) => entry.type === 'minute').value);
    const format = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    return { zone, start: format((minute + 1380) % 1440), end: format((minute + 60) % 1440) };
  });
  await patch(page, { 'sun.sun': { state: 'unavailable', attributes: {} } });
  await setPolicy(page, policy({ rotate: false, dim: { enabled: true, brightness: .5, when: 'quiet_hours', start: hours.start, end: hours.end } }));
  await waitController(page); const quiet = await snapshot(page);
  check('quiet hours use actual HA local time and work independently of unavailable sun', quiet.controller.brightness === .5 && quiet.filter === 'contrast(1.1) brightness(0.5)'
    && !quiet.active && await page.evaluate(() => document.querySelector('taylors3d-card')._hass.config.time_zone === 'Europe/London'), hours);
  await patch(page, {}, { config: { time_zone: 'invalid/zone', latitude: null, longitude: null } });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._ambientController.state.brightness === 1, { timeout: 7000, polling: 50 });
  check('invalid HA time zone fails open to readable brightness without a guessed zone', (await snapshot(page)).filter === 'contrast(1.1)');
  await patch(page, { 'sun.sun': { state: 'below_horizon', attributes: { elevation: -20, azimuth: 180 } } }, { config: { time_zone: 'Europe/London', latitude: null, longitude: null } });
  await setPolicy(page, { enabled: false }); await ready(page); const stopped = await snapshot(page);
  check('disabling idle restores exact owned filter and physical light state', stopped.filter === before.filter && stopped.filterPriority === before.filterPriority && !stopped.active && !stopped.controller.active
    && await page.evaluate(() => document.querySelector('taylors3d-card')._hass.states['light.ambient_lamp'].state === 'on'));
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._scene.style.removeProperty('filter'); c._skyMode = 'auto'; c._applySky(false); }); await ready(page);
}

async function automationScenario(page) {
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), ground = c._views.find((view) => view.id === 'ground');
    c._commit({ ...c._layout, views: { ...c._layout.views, door: { added: true, label: 'Front door', camera_mode: '3d', floors: ['ground'], rules: ground.rules,
      camera: { position: [8, 6, 2], target: [0, 1, 0] } } } });
  }); await ready(page); await setPolicy(page, policy({ idle_seconds: 2 })); await waitAmbient(page);
  const before = await snapshot(page);
  const id = await page.evaluate(() => {
    const f = window.ambientFixture, entries = [...f.subscriptions];
    if (entries.length !== 1) throw new Error('Expected one actual authenticated preset subscription, got ' + entries.length);
    f.gets = []; const [targetId, subscription] = entries[0], id = 'request-' + ++f.sequence;
    const request = { ...Object.fromEntries(['layout_key', 'panel', 'card_id'].map((key) => [key, subscription.address[key]])),
      request_id: id, target_id: targetId, preset: 'door', return_after: .8 };
    subscription.callback({ event_type: 'taylors3d_select_view', data: request }); return id;
  });
  await page.waitForFunction((id) => window.ambientFixture.replies.some((reply) => reply.request_id === id), { timeout: 7000, polling: 50 }, id);
  const received = await page.evaluate((id) => {
    const c = document.querySelector('taylors3d-card'), f = window.ambientFixture;
    return { reply: f.replies.find((reply) => reply.request_id === id), first: f.gets[0], id: c._viewId, active: c._ambientController.state.active,
      tween: !!c._view._tween, services: f.services.length, begin: f.begins.at(-1) };
  }, id);
  check('real preset event restores raw idle baseline BEFORE its return-camera getCurrent', received.reply.status === 'selected' && received.id === 'door'
    && !received.active && !received.first.active && equal(received.first.raw, received.begin.before) && received.services === before.services,
  { reply: received.reply, first: received.first, tween: received.tween });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._viewId === 'ground', { timeout: 7000, polling: 50 }); await ready(page);
  const returned = await snapshot(page), baseline = received.begin.before;
  check('automation return uses the actual pre-idle saved camera rather than its rotating pose', near(returned.pose.position, baseline.position, .011)
    && near(returned.pose.target, baseline.target, .011) && !returned.active && returned.services === before.services, { returned: returned.pose.position, baseline: baseline.position });
  await setPolicy(page, { enabled: false }); await ready(page);
}

async function lifecycleScenario(page) {
  await setPolicy(page, policy()); await waitAmbient(page);
  const removed = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'), v = c._view, f = window.ambientFixture;
    f.card = c; f.parent = c.parentElement; f.nextSibling = c.nextSibling;
    const token = c._ambientController.state.token, renderer = v.renderer, pool = [...c._objects.pool.points, ...c._objects.pool.spots].map((lamp) => lamp.uuid);
    c.remove(); const before = { ...v.stats }; await new Promise((resolve) => setTimeout(resolve, 350));
    const end = f.ends.at(-1), begin = f.begins.findLast((entry) => entry.reading.token === end?.reading.token);
    const result = { active: c._ambientController.state.active, cameraActive: !!v._ambientCamera, raf: !!v._raf, filter: c._scene.style.filter,
      exact: !!begin && JSON.stringify(begin.before) === JSON.stringify(end.after), stable: ['frames', 'shadow', 'shadowLights'].every((key) => before[key] === v.stats[key]), subscriptions: f.subscriptions.size };
    f.parent.insertBefore(c, f.nextSibling);
    result.immediate = { active: c._ambientController.state.active, oldToken: c._ambientController.state.token === token, sameRenderer: renderer === c._view.renderer,
      samePool: JSON.stringify(pool) === JSON.stringify([...c._objects.pool.points, ...c._objects.pool.spots].map((lamp) => lamp.uuid)) };
    return result;
  });
  check('disconnect restores pose/releases native RAF and authenticated subscription with no late frames', !removed.active && !removed.cameraActive && !removed.raf && removed.exact && removed.stable && removed.subscriptions === 0 && removed.filter === '', removed);
  check('reconnect keeps one renderer/pool and waits for fresh idle instead of replaying the old token', !removed.immediate.active && !removed.immediate.oldToken
    && removed.immediate.sameRenderer && removed.immediate.samePool, removed.immediate);
  await waitAmbient(page); await page.waitForFunction(() => window.ambientFixture.subscriptions.size === 1, { timeout: 7000, polling: 50 });
  const previousRoot = await page.evaluate(() => document.querySelector('taylors3d-card')._view.model.root.uuid);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model: '/demo/ambient-fixture.glb?replacement=1', ambient_idle: { enabled: false } });
  });
  context = 'actual GLB replacement releases old model and finishes loading';
  try { await page.waitForFunction((previousRoot) => {
    // Model teardown legitimately makes model null until the actual GLB loads.
    // Throwing inside Puppeteer's poller would stop observing that later load.
    const c = document.querySelector('taylors3d-card'); return !c._loading && !!c._view.model && c._view.model.root.uuid !== previousRoot;
  }, { timeout: 30000, polling: 50 }, previousRoot); } catch (error) {
    error.message += '; model replacement evidence: ' + JSON.stringify(await page.evaluate((previousRoot) => {
      const c = document.querySelector('taylors3d-card'), v = c._view, context = c._ambientContext();
      return { previousRoot, actualRoot: v.model?.root.uuid, modelId: v.model?.id, requestedModel: v._modelId, configModel: c._config.model, error: c._modelError,
        loading: c._loading, connected: c.isConnected, transport: c._hass.connection.connected, documentHidden: document.hidden, documentFocus: document.hasFocus(),
        windowActive: c._ambientWindowActive, inView: c._weatherInView, editing: c._editing, mode: c._mode, viewMode: v.mode, section: c._section,
        sectionClip: !!v.sectionClip, motion: v._modelMotionMoving, tween: !!v._tween, gesture: !!c._gesture, controlsGesture: c._ambientControlsGesture,
        pointers: [...c._ambientPointers], keys: [...c._ambientKeys], preview: !!c._lightPreview, panel: c._devicePopup.isOpen,
        popup: c._popup.isOpen, alerts: c._alertData?.stats?.active, eligible: context.eligible, controller: c._ambientController.state,
        generationMatches: c._ambientCameraOwner?.generation === context.generation, raf: !!v._raf, size: v.size, stats: v.stats };
    }, previousRoot).catch(() => null)); throw error;
  }
  // Saved policy has precedence; explicitly turn it off after model replacement
  // so readiness cannot be mistaken for an ongoing new valid idle session.
  await setPolicy(page, { enabled: false }); await ready(page); const after = await snapshot(page);
  check('actual model replacement releases old camera ownership and remains usable', !after.active && !after.controller.active && !after.pose.autoRotate
    && after.renderer && after.contexts === 1 && after.pool.length === 12 && !after.pending.length && after.pose.labels !== 'none');
}

async function rotationScenario(page, mode) {
  const initial = await snapshot(page);
  check('opt-in default stays idle with one actual renderer and fixed lamp pool', !initial.active && initial.renderer && initial.contexts === 1
    && initial.pool.length === 12 && initial.physicalShadows === 4 && !initial.shadowEnabled && !initial.pending.length && initial.capture.lit > 20, { stats: initial.stats, lit: initial.capture.lit });
  for (const kind of ['equal', 'unrelated']) {
    const before = await snapshot(page);
    await page.evaluate(async (kind) => {
      const c = document.querySelector('taylors3d-card');
      for (let i = 0; i < 10; i++) {
        const states = kind === 'equal' ? structuredClone(c._hass.states) : { ...c._hass.states,
          'sensor.ambient_unrelated': { state: String(100 + i), attributes: { friendly_name: 'Known unrelated reading' } } };
        c.hass = { ...c._hass, states }; await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }, kind);
    const after = await snapshot(page);
    check(`disabled idle: 10 ${kind} HA updates add zero frames/materials/pool writes/shadows`, before.stats.frames === after.stats.frames && sameLighting(before, after) && !after.active && !after.controller.active,
      { before: before.stats, after: after.stats, writes: after.lightingWrites - before.lightingWrites });
  }
  await setPolicy(page, policy()); await waitAmbient(page); const first = await captureNext(page), before = await snapshot(page);
  await page.waitForFunction(() => {
    const f = window.ambientFixture, samples = f.advances.filter((entry) => entry.result); return samples.length > 4 && samples.at(-1).at - samples[0].at >= 1200;
  }, { timeout: 7000, polling: 50 });
  const last = await captureNext(page), after = await snapshot(page);
  const changedPixels = last.samples.reduce((n, value, i) => n + Number(Math.abs(value - first.samples[i]) >= 8), 0);
  check('actual no-interaction RAF rotates the asymmetric rendered GLB picture', first.width === last.width && first.height === last.height
    && last.frame > first.frame && changedPixels > 30 && !near(first.pose.quaternion, last.pose.quaternion) && last.lit > 20,
  { frames: last.frame - first.frame, changedPixels, first: first.pose.position, last: last.pose.position });
  check('rotation uses existing pool/materials/programs and requests zero new shadows', sameLighting(before, after) && !after.pending.length && after.renderer && after.contexts === 1, { before: before.stats, after: after.stats, resources: after.memory });
  const timing = await page.evaluate(() => {
    const f = window.ambientFixture, samples = f.advances.filter((entry) => entry.result), first = samples[0], last = samples.at(-1);
    const angle = (p) => Math.atan2(p.position[0] - p.target[0], p.position[2] - p.target[2]);
    const observed = Math.abs(Math.atan2(Math.sin(angle(last.after) - angle(first.before)), Math.cos(angle(last.after) - angle(first.before))));
    const seconds = samples.reduce((sum, entry) => sum + entry.delta, 0);
    return { samples: samples.length, min: Math.min(...samples.map((entry) => entry.delta)), max: Math.max(...samples.map((entry) => entry.delta)), seconds,
      wallSeconds: (last.at - first.at) / 1000, degrees: observed * 180 / Math.PI, expected: seconds * 6 };
  });
  check('real frame timing applies measured capped deltas rather than promising a tablet FPS', timing.samples > 4 && timing.min > 0 && timing.max <= .05
    && timing.seconds <= timing.wallSeconds + .051 && Math.abs(timing.degrees - timing.expected) < .03, timing);
  check('rotating labels cannot intercept device taps', after.pose.labels === 'none' && after.pose.autoRotate && !after.pose.damping);
  check('hidden label renderer does zero frame work during actual orbit', before.labelRenders === after.labelRenders && after.stats.frames > before.stats.frames,
    { before: before.labelRenders, after: after.labelRenders, frames: after.stats.frames - before.stats.frames });
  await screenshot(page, mode === 'source' ? 'ambient-rotation.png' : 'ambient-rotation-bundle.png');
}

async function contrast(page) {
  return page.evaluate(() => {
    const host = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-ambient-idle-editor]');
    const lum = (colour) => colour.match(/[\d.]+/g)?.slice(0, 3).map(Number).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
      .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    return [...host.querySelectorAll('button,input:not([type=checkbox]),select')].filter((el) => !el.disabled && el.getClientRects().length).map((el) => {
      const css = getComputedStyle(el), a = lum(css.color), b = lum(css.backgroundColor), r = el.getBoundingClientRect();
      return { id: el.dataset.act || el.dataset.field, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), height: r.height, left: r.left, right: r.right, viewport: innerWidth };
    });
  });
}

async function editorScenario(page, mode) {
  await setPolicy(page, { enabled: false }); await ready(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.resetHistory(); window.ambientFixture.commits = 0; });
  const baseline = await snapshot(page);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="idle"]');
  check('native Edit → Idle opens opt-in controls with no live draft effect', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-ambient-idle-editor]');
    return !!form && c._edit.tab === 'idle' && !c._view._ambientCamera && !form.querySelector('[data-field="ambient-idle-enabled"]').checked
      && form.querySelector('[data-field="ambient-idle-idle_seconds"]').value === '120' && /not your tablet backlight or real lights/.test(form.textContent);
  }));
  await click(page, field('enabled')); await type(page, field('idle_seconds'), '2'); await type(page, field('rotation_degrees_per_second'), '2');
  await click(page, field('dim.enabled')); await type(page, field('dim.brightness'), '50'); await choose(page, field('dim.when'), 'sun');
  await control(page, field('idle_seconds'), (el) => el.focus());
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.ambientFixture.focused = c.shadowRoot.activeElement; });
  await patch(page, { 'sensor.ambient_unrelated': { state: '10', attributes: { friendly_name: 'Known unrelated reading' } } });
  check('focused native draft survives unrelated HA updates and remains unsaved', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.ambientFixture, input = c.shadowRoot.querySelector('[data-field="ambient-idle-idle_seconds"]');
    return input === f.focused && c.shadowRoot.activeElement === input && input.value === '2' && f.commits === 0 && c._layout.ambient_idle.enabled === false && !c._view._ambientCamera;
  }));
  const light = await contrast(page);
  check('all deliberate Idle controls have readable light-theme text and 44px targets', light.length >= 9 && light.every((entry) => entry.ratio >= 4.5 && entry.height >= 44), light);
  await click(page, editAction('save')); await ready(page); let saved = await snapshot(page);
  check('Save applies one explicit policy/history commit without HA commands', saved.commits === 1 && saved.services === baseline.services && !saved.active
    && saved.saved.enabled && saved.saved.idle_seconds === 2 && saved.saved.rotation_degrees_per_second === 2 && saved.saved.dim.enabled && saved.saved.dim.brightness === .5);
  await click(page, '[data-act="history-undo"]'); await ready(page); saved = await snapshot(page);
  check('native Undo restores previous idle settings without real device actions', equal(saved.saved, { enabled: false }) && saved.services === baseline.services);
  await click(page, '[data-act="history-redo"]'); await ready(page); saved = await snapshot(page);
  check('native Redo restores saved policy and refreshes the Idle form', saved.saved.enabled && saved.saved.idle_seconds === 2 && await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="ambient-idle-idle_seconds"]').value === '2'));
  await type(page, field('idle_seconds'), '8'); await click(page, editAction('cancel')); saved = await snapshot(page);
  check('Cancel discards raw draft and keeps the exact saved policy', saved.saved.idle_seconds === 2 && saved.commits === 1 && await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="ambient-idle-idle_seconds"]').value === '2'));
  await type(page, field('idle_seconds'), '0');
  check('out-of-range delay blocks native Save rather than silently coercing it', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); return c.shadowRoot.querySelector('[data-act="ambient-idle-save"]').disabled && c._layout.ambient_idle.idle_seconds === 2;
  })); await click(page, editAction('cancel'));
  await type(page, field('idle_seconds'), '3');
  await page.evaluate(() => document.querySelector('section.theme').classList.add('dark'));
  const dark = await contrast(page);
  check('enabled native Idle controls preserve AA contrast in dark theme', dark.length >= 9 && dark.every((entry) => entry.ratio >= 4.5 && entry.height >= 44), dark);
  await screenshot(page, mode === 'source' ? 'ambient-editor.png' : 'ambient-editor-bundle.png');
  await page.setViewport({ width: 320, height: 1100, deviceScaleFactor: 1, hasTouch: true });
  const narrow = await contrast(page);
  check('320px Idle form keeps native controls within viewport and 44px touch size', narrow.length >= 9 && narrow.every((entry) => entry.left >= -1 && entry.right <= entry.viewport + 1 && entry.height >= 44 && entry.ratio >= 4.5), narrow);
  const checkboxes = await page.evaluate(() => [...document.querySelector('taylors3d-card').shadowRoot.querySelectorAll('[data-ambient-idle-editor] input[type=checkbox]')]
    .map((input) => { const r = input.getBoundingClientRect(); return { id: input.dataset.field, width: r.width, height: r.height, left: r.left, right: r.right }; }));
  check('all three native Idle checkboxes keep 44px tap targets at 320px', checkboxes.length === 3 && checkboxes.every((entry) => entry.width >= 44 && entry.height >= 44 && entry.left >= -1 && entry.right <= 321), checkboxes);
  await screenshot(page, mode === 'source' ? 'ambient-narrow.png' : 'ambient-narrow-bundle.png', true);
  await click(page, editAction('cancel')); await click(page, 'button.edit'); await setPolicy(page, { enabled: false }); await ready(page);
}

async function main() {
  const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
  for (const mode of modes) {
    label = `${mode}: `; let session;
    try {
      session = await open(mode);
      check('loads the requested implementation and exactly one model fixture', session.requests.includes(mode === 'source' ? '/src/taylors3d-card.js' : '/dist/taylors3d-card.js')
        && !session.requests.includes(mode === 'source' ? '/dist/taylors3d-card.js' : '/src/taylors3d-card.js') && session.requests.filter((request) => request === '/demo/ambient-fixture.glb').length === 1);
      await rotationScenario(session.page, mode); await cadenceScenario(session.page); await wakeScenario(session.page);
      await guardScenario(session.page); await dimScenario(session.page, mode); await automationScenario(session.page);
      await lifecycleScenario(session.page); await editorScenario(session.page, mode);
      check('restores exact passive observer identities before teardown', await restoreObservers(session.page));
    } catch (error) { check('scenario completes', false, { message: error.message, stack: error.stack, context }); }
    finally {
      if (session) { errors.push(...session.pageErrors, ...session.errors.filter((message) => !session.pageErrors.some((error) => error.message === message))); await restoreObservers(session.page).catch(() => {}); await session.close(); }
    }
  }
  label = ''; check('no-browser-errors', errors.length === 0, errors); console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`);
  if (checks.some((passed) => !passed)) process.exitCode = 1;
}
await main();
