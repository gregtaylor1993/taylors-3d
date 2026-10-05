// F12: saved visual light targets, real GLB pixels, separate deliberate HA actions.
// The house/light observations are simulated. All GPU samples come from the card's
// existing renderer and fixed lamp pool, with no injected lights or fake app clock.
// Run after building: node scripts/scenes-check.mjs [--source-only|--bundle-only].
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
// Editing a field can reinsert its property later. Compare exact keys/values and
// array order, not the irrelevant insertion order of object properties.
const equal = isDeepStrictEqual;
const near = (a, b, tolerance = 3) => a?.length === b?.length && a.every((n, i) => Math.abs(n - b[i]) <= tolerance);
const entity = 'light.scenes_probe';
const points = Array.from({ length: 12 }, (_, i) => `scenes_point_${String(i + 1).padStart(2, '0')}`);
const spots = Array.from({ length: 6 }, (_, i) => `scenes_spot_${String(i + 1).padStart(2, '0')}`);
const bar = '[data-scene-preview-bar]';
const action = (kind, id) => `${bar} [data-scene-action="${kind}"]${id ? `[data-scene-id="${id}"]` : ''}`;
const editor = '[data-scene-preview-editor]';
const field = (name) => `${editor} [data-field="scene-preview-${name}"]`;
const editAction = (name) => `${editor} [data-act="scene-preview-${name}"]`;
const target = (rgb, brightness = 255, source = entity) => ({ entity: source, state: 'on', brightness, color: { mode: 'rgb', rgb } });
const settings = () => ({ enabled: true, retained: 'fixture extension', items: [
  { id: 'movie', label: 'Movie', scene_entity: 'scene.scenes_movie', lights: [target([0, 0, 255])] },
  { id: 'reading', label: 'Reading', scene_entity: 'scene.scenes_reading', lights: [target([255, 0, 0])] },
  { id: 'many', label: 'Whole bench', scene_entity: 'scene.scenes_many', lights: [target([0, 0, 255]),
    ...[...points, ...spots, 'scenes_strip'].map((id) => target([0, 0, 255], 255, `light.${id}`))] },
  { id: 'incomplete', label: 'Other devices', scene_entity: 'scene.scenes_incomplete', lights: [] },
] });
const light = (state = 'off', rgb = [255, 0, 0], brightness = 255) => ({ entity_id: entity, state, attributes: {
  friendly_name: 'Simulated scene test lamp', brightness, rgb_color: rgb, color_mode: 'rgb',
  supported_color_modes: ['rgb', 'color_temp'], min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500,
} });
const scene = (id, state = 'unknown') => ({ entity_id: id, state, attributes: { friendly_name: id.replace('scene.scenes_', '') } });

// Reuse the MIT demo's actual mesh accessors/BIN chunk, but author a neutral,
// exposed floor/wall bench. Lamp hints are explicit fixture settings, not guesses
// about the user's home. Remote overflow lamps cannot light the sampled surfaces.
function fixtureGlb() {
  const original = fs.readFileSync(path.join(root, 'demo/house.glb')), length = original.readUInt32LE(12);
  const gltf = JSON.parse(original.toString('utf8', 20, 20 + length));
  const sourceBox = gltf.nodes.find((n) => n.name === 'coffee_table_body').mesh;
  const sourceLamp = gltf.nodes.find((n) => n.name === 'lamp_living');
  const sourceGlow = gltf.nodes[sourceLamp.children.find((i) => gltf.nodes[i].name === 'glow')].mesh;
  const gray = gltf.materials.push({ name: 'scenes_neutral_standard', pbrMetallicRoughness: {
    baseColorFactor: [.32, .32, .32, 1], metallicFactor: 0, roughnessFactor: 1 }, emissiveFactor: [0, 0, 0] }) - 1;
  const bulb = gltf.materials.push({ name: 'scenes_bulb_standard', pbrMetallicRoughness: {
    baseColorFactor: [.9, .9, .9, 1], metallicFactor: 0, roughnessFactor: .8 }, emissiveFactor: [0, 0, 0] }) - 1;
  const mesh = (source, material) => gltf.meshes.push({ ...gltf.meshes[source], primitives: gltf.meshes[source].primitives.map((p) => ({ ...p, material })) }) - 1;
  const box = mesh(sourceBox, gray), glow = mesh(sourceGlow, bulb), node = (value) => gltf.nodes.push(value) - 1;
  const floor = node({ name: 'scenes_floor', mesh: box, translation: [0, -.05, 0], scale: [4 / 1.2, .1 / .45, 4 / .7] });
  const wall = node({ name: 'scenes_wall', mesh: box, translation: [0, 1.35, -2.06], scale: [4 / 1.2, 2.7 / .45, .12 / .7] });
  const lamp = (id, position, hints, extra = {}) => node({ name: id, translation: position,
    children: [node({ name: `${id}_glow`, mesh: glow })], extras: { fp: { kind: 'object', id, type: 'light', label: id,
      glow: `${id}_glow`, hints, suggest: { entity: `light.${id}` }, ...extra } } });
  const probe = lamp('scenes_probe', [0, 2.2, 0], { beam: 'point', max: 20, distance: 8, decay: 2 }, { group: 'relay' });
  const overflowPoints = points.map((id, i) => lamp(id, [8 + i * .25, 2.2, 0], { beam: 'point', max: i === 0 ? 1000 : 20 + i, distance: 1, decay: 2 }));
  const overflowSpots = spots.map((id, i) => lamp(id, [8 + i * .25, 2.2, -1], { beam: 'spot', max: i === 0 ? 1000 : 15 + i, distance: 1, decay: 2, target: [8 + i * .25, 0, -1] }));
  const strip = lamp('scenes_strip', [9, 2.2, 1], { beam: 'point', max: 25, distance: 1, decay: 2 }, { type: 'light_strip' });
  const unmapped = lamp('scenes_unmapped', [10, 2.2, 2], { beam: 'point', max: 10, distance: 1, decay: 2 });
  const relayOnly = lamp('scenes_switch', [10, 2.2, 3], { beam: 'point', max: 10, distance: 1, decay: 2 }, { suggest: { entity: 'switch.scenes_switch' } });
  const room = node({ name: 'scenes_room', children: [floor, wall, probe], extras: { fp: {
    kind: 'room', id: 'scenes_room', outline: [[-2, -2], [2, -2], [2, 2], [-2, 2]], suggest: { area: 'living_room' } } } });
  const ground = node({ name: 'scenes_ground', children: [room, ...overflowPoints, ...overflowSpots, strip, unmapped, relayOnly], extras: { fp: {
    kind: 'level', id: 'ground', role: 'storey', order: 0, elevation: 0, height: 2.7 } } });
  const house = node({ name: 'scenes_bench', children: [ground], extras: { fp: { views: [
    { id: 'ground', label: 'Simulated scene bench', show: ['level:ground'] } ] } } });
  gltf.scenes = [{ nodes: [house] }]; gltf.scene = 0;
  const body = Buffer.from(JSON.stringify(gltf)), padding = Buffer.alloc((4 - body.length % 4) % 4, 0x20);
  const rest = original.subarray(20 + length), head = Buffer.alloc(20);
  head.write('glTF'); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + body.length + padding.length + rest.length, 8);
  head.writeUInt32LE(body.length + padding.length, 12); head.write('JSON', 16);
  return Buffer.concat([head, body, padding, rest]);
}

async function ready(page) {
  try { await page.waitForFunction(() => {
    const v = document.querySelector('taylors3d-card')?._view, now = performance.now();
    if (!v || v.dirty || v._tween || v._modelMotionMoving || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350) { window.scenesIdle = null; return false; }
    if (!window.scenesIdle || ['frames', 'shadow', 'shadowLights'].some((k) => window.scenesIdle[k] !== v.stats[k])) {
      window.scenesIdle = { ...v.stats, at: now }; return false;
    } return now - window.scenesIdle.at > 350;
  }, { timeout: 15000, polling: 50 }); } catch (error) {
    error.message += `; ${context}; ${JSON.stringify(await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), v = c?._view;
      return { dirty: v?.dirty, tween: !!v?._tween, motion: v?._modelMotionMoving, occlusion: v?._occFull, timer: !!v?._occTimer,
        stats: v?.stats, cameraAge: performance.now() - (v?._camMovedAt || 0), loading: c?._loading,
        visible: document.visibilityState, inView: c?._weatherInView, preview: c?._scenePreviewController.active,
        capture: window.scenesFixture?.capture, camera: v?.getCamera(), size: v?.size };
    }).catch(() => null))}`;
    throw error;
  }
}
async function patch(page, states = {}, extra = {}) {
  context = `HA update ${Object.keys(states).join(', ') || Object.keys(extra).join(', ')}`;
  await page.evaluate(({ states, extra }) => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, ...extra, states: { ...c._hass.states, ...states } }; }, { states, extra });
  await ready(page);
}
async function control(page, selector, callback) {
  context = 'UI ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw new Error('Missing scene control: ' + selector);
    await element.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(element);
  } finally { await handle.dispose(); }
}
const click = (page, selector) => control(page, selector, (el) => el.click());
const choose = (page, selector, value) => control(page, selector, (el) => el.select(value));
const type = (page, selector, value) => control(page, selector, async (el) => {
  // Triple-click does not reliably select all text in Chromium number inputs.
  // Use the same deliberate select-all/edit gesture as a keyboard user.
  await el.click(); await page.keyboard.down('Control');
  try { await page.keyboard.press('a'); } finally { await page.keyboard.up('Control'); }
  await el.press('Backspace'); await el.type(value);
  const actual = await el.evaluate((input) => input.value);
  if (actual !== value) throw new Error(`Native scene field edit ${selector} produced ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
});
async function hover(page, id) { await control(page, action('preview', id), (el) => el.hover()); await ready(page); }
async function screenshot(page, name, fullPage = false) { fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots', name), fullPage }); }
async function calls(page) { return page.evaluate(() => window.scenesFixture.services); }
async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, layer = c._objects, f = window.scenesFixture;
    const object = layer.objectAt('scenes_probe'), glow = object?.part.glow.material, pool = [...layer.pool.points, ...layer.pool.spots];
    const material = Array.isArray(glow) ? glow[0] : glow;
    return { pixels: f.capture, stats: { ...v.stats }, objects: { ...layer.stats }, memory: { ...v.renderer.info.memory },
      programs: v.renderer.info.programs.map((p) => p.id), pool: pool.map((l) => l.uuid), points: layer.pool.points.filter((l) => l.intensity > 0).length,
      spots: layer.pool.spots.filter((l) => l.intensity > 0).length, physicalShadows: pool.filter((l) => l.castShadow).length,
      allocated: [...layer._slots].map(([id, slot]) => [id, slot.light.uuid, slot.shadow]),
      pending: [v.sun, ...pool].filter((l) => l.shadow?.needsUpdate).map((l) => l.uuid), shadowEnabled: v.renderer.shadowMap.enabled,
      sameRenderer: v.renderer === f.renderer, contexts: window.scenesContexts.size,
      actual: { state: c._hass.states['light.scenes_probe'].state, rgb: c._hass.states['light.scenes_probe'].attributes.rgb_color,
        level: object?.part.level, output: object?.part.output, appearance: object?.part.appearance, result: object?.result, chain: object?.chain?.lit },
      glow: material && { uuid: material.uuid, version: material.version, intensity: material.emissiveIntensity, rgb: material.emissive.toArray() },
      map: c._lightPreview ? [...c._lightPreview.keys()] : [], owner: c._lightPreviewOwner, active: c._scenePreviewController.active,
      status: c.shadowRoot.querySelector('[data-scene-preview-bar] [data-scene-preview-status]')?.textContent,
      services: f.services.length, commits: f.commits, backend: c._store.backend,
      editing: c._editing, tab: c._edit?.tab, mode: c._mode, saved: c._layout.scene_previews };
  });
}
async function restoreObservers(page) {
  return page.evaluate(() => {
    const v = document.querySelector('taylors3d-card')?._view, f = window.scenesFixture;
    if (!v || !f || !Object.hasOwn(f, 'previousRender')) return true;
    v.onRender = f.previousRender; const restored = v.onRender === f.previousRender; delete f.previousRender; return restored;
  });
}

async function prepare(page, mode, reset = true) {
  await page.evaluate(async ({ mode, reset, settings, points, spots, light, scene }) => {
    const c = document.querySelector('taylors3d-card');
    window.scenesFixture = { services: [], commits: 0, renderer: c._view.renderer, capture: null, pending: null, nextResult: 'success' };
    // Load the real fallback layout before installing observations. The unrelated
    // reading already exists before idle baselines, so membership changes are excluded.
    c.hass = { ...c._hass, callWS: undefined };
    c.setConfig({ ...c._config, layout_key: `scenes-browser-${mode}`, height: '600px', merge: false, model_opacity: 1,
      control_panel: 'right', device_tap_action: 'popup', lights: 'auto', sky_bodies: false, mini_map: false });
    await c._layoutReady;
    const connection = new EventTarget(); connection.connected = true;
    const states = { 'light.scenes_probe': light, 'sensor.scenes_unrelated': { state: '0', attributes: { friendly_name: 'Known unrelated reading' } },
      'switch.scenes_relay': { state: 'on', attributes: { friendly_name: 'Actual relay' } },
      'switch.scenes_switch': { state: 'off', attributes: { friendly_name: 'Unmapped relay' } },
      'sun.sun': { state: 'below_horizon', attributes: { elevation: -20, azimuth: 180 } } };
    for (const id of [...points, ...spots, 'scenes_strip', 'scenes_unmapped']) states[`light.${id}`] = { ...light, entity_id: `light.${id}`, attributes: { ...light.attributes, friendly_name: id } };
    for (const id of ['movie', 'reading', 'many', 'incomplete', 'bedtime']) states[`scene.scenes_${id}`] = { ...scene, entity_id: `scene.scenes_${id}`, attributes: { friendly_name: id } };
    c.hass = { ...c._hass, connection, user: { id: 'scene-fixture-admin', is_admin: true, is_active: true },
      config: { ...c._hass.config, latitude: null, longitude: null }, services: { scene: { turn_on: {} }, light: { turn_on: {}, turn_off: {} } }, states,
      callWS: undefined, callService: (...args) => {
        const f = window.scenesFixture; f.services.push(args);
        if (f.nextResult === 'pending') return new Promise((resolve, reject) => { f.pending = { resolve, reject }; });
        if (f.nextResult === 'error') return Promise.reject(new Error('Simulated scene rejected <b>literally</b>'));
        return Promise.resolve();
      } };
    if (reset) c._commit({ ...c._layout, rooms: [], pins: {}, hidden: [], mower: {}, objects: {}, groups: { relay: { entity: 'switch.scenes_relay' } }, model: {}, views: {},
      scene_previews: settings, model_rendering: { shadows: 'off', lamps: 'inherit' }, room_overlays: { mode: 'off' }, alert_bindings: [], security_bindings: [],
      weather: { enabled: false }, presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [], camera_coverage: { enabled: false } });
    const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (patch) => { window.scenesFixture.commits++; return commit(patch); };
    c._skyMode = 'auto'; c._applySky(true); c._view.stopCameraMotion(); c.resetHistory();
    document.querySelector('section.theme h2').textContent = `Simulated saved scene previews · ${mode}`;
  }, { mode, reset, settings: settings(), points, spots, light: light(), scene: scene('scene.scenes_movie') });
  await ready(page);
  // Readbacks begin only after actual model/layout initialization. The deliberate
  // camera change requests a normal app frame; no renderer.render calls are made.
  await page.evaluate(() => {
    const v = document.querySelector('taylors3d-card')._view, f = window.scenesFixture;
    f.previousRender = v.onRender;
    v.onRender = () => {
      f.previousRender?.();
      const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, capture = { frame: v.stats.frames };
      for (const [name, position] of Object.entries({ floor: [.6, .01, .2], wall: [.6, 1, -1.999] })) {
        const world = v.camera.position.clone().set(...position), p = world.clone().project(v.camera), screen = v.projectWorld(world);
        const hit = screen && v._modelHit(screen[0], screen[1]), x = Math.round((p.x + 1) * width / 2), y = Math.round((p.y + 1) * height / 2);
        const valid = Number.isFinite(x) && Number.isFinite(y) && x >= 3 && y >= 3 && x < width - 3 && y < height - 3
          && p.z > -1 && p.z < 1 && hit?.object.name === `scenes_${name}`;
        const bytes = new Uint8Array(7 * 7 * 4); if (valid) gl.readPixels(x - 3, y - 3, 7, 7, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        const rgb = [0, 1, 2].map((channel) => { const values = []; for (let i = channel; i < bytes.length; i += 4) values.push(bytes[i]); values.sort((a, b) => a - b); return values[24]; });
        capture[name] = { valid, rgb, mesh: hit?.object.name, point: position };
      } f.capture = capture;
    };
    v.stopCameraMotion(); v.setCamera({ position: [6, 5, 7], target: [0, 1, 0] }, { instant: true });
  }); await ready(page);
}
async function open(mode) {
  const transport = await launch(); let session; const pageErrors = [];
  try {
    session = await newPage(transport.browser, { width: 1280, height: 1100, hasTouch: true });
    const { page } = session, requests = [], fixture = fixtureGlb();
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack, context: label + context }));
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8').replace(/<section class="theme dark">[\s\S]*?<\/section>/, '')
      .replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
    if (mode === 'source') html = html.replace('</head>', `<script type="importmap">${JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } })}</script></head>`)
      .replace('src="../dist/taylors3d-card.js"', 'src="../src/taylors3d-card.js"');
    await page.evaluateOnNewDocument(() => {
      window.__demoMowerPaused = true; window.scenesContexts = new Set();
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const value = original.call(this, kind, ...args); if (value && /^webgl/.test(kind)) window.scenesContexts.add(this); return value; };
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
      else if (url.pathname === '/demo/scenes-fixture.glb') request.respond({ status: 200, contentType: 'model/gltf-binary', body: fixture });
      else request.continue();
    });
    await page.goto(`${transport.base}/demo/index.html?model=/demo/scenes-fixture.glb&merge=0&floor=ground&view=3d&height=600px`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('taylors3d-card')?._objects?.parts.has('scenes_probe'), { timeout: 30000 });
    await prepare(page, mode); return { ...transport, ...session, requests, pageErrors };
  } catch (error) {
    errors.push(...pageErrors, ...(session?.errors || []).filter((message) => !pageErrors.some((e) => e.message === message)));
    if (session) await restoreObservers(session.page).catch(() => {}); await transport.close(); throw error;
  }
}

async function idleCheck(page, kind) {
  await ready(page); const before = await snapshot(page);
  const writes = await page.evaluate(async (kind) => {
    const c = document.querySelector('taylors3d-card'), lights = [...c._objects.pool.points, ...c._objects.pool.spots], restores = []; let writes = 0;
    try {
      for (const lamp of lights) {
        const descriptor = Object.getOwnPropertyDescriptor(lamp, 'intensity'); let value = lamp.intensity;
        Object.defineProperty(lamp, 'intensity', { configurable: true, get: () => value, set: (next) => { writes++; value = next; } });
        restores.push(() => Object.defineProperty(lamp, 'intensity', { ...descriptor, value }));
        for (const [object, method] of [[lamp.color, 'setRGB'], [lamp.position, 'copy'], [lamp.position, 'set']]) {
          const original = object[method], own = Object.hasOwn(object, method);
          object[method] = function (...args) { writes++; return original.apply(this, args); };
          restores.push(() => { if (own) object[method] = original; else delete object[method]; });
        }
      }
      for (let i = 0; i < 10; i++) {
        const states = { ...c._hass.states };
        if (kind === 'equal') for (const [id, state] of Object.entries(states)) states[id] = structuredClone(state);
        else states['sensor.scenes_unrelated'] = { ...states['sensor.scenes_unrelated'], state: String(i + 1) };
        c.hass = { ...c._hass, states }; await new Promise((resolve) => setTimeout(resolve, 40));
      } await new Promise((resolve) => setTimeout(resolve, 350)); return writes;
    } finally { for (const restore of restores.reverse()) restore(); }
  }, kind);
  const after = await snapshot(page);
  check(`${kind} HA updates preserve strict GPU idle, materials, shaders and fixed-pool writes`, writes === 0
    && ['frames', 'shadow', 'shadowLights'].every((k) => before.stats[k] === after.stats[k]) && equal(before.memory, after.memory)
    && equal(before.programs, after.programs) && equal(before.pool, after.pool) && equal(before.allocated, after.allocated)
    && equal(before.glow, after.glow) && before.objects.budget === after.objects.budget && before.objects.shadowRequests === after.objects.shadowRequests,
  { writes, before: before.stats, after: after.stats, resources: after.memory });
}

async function previewScenario(page, mode) {
  let s = await snapshot(page); const off = s.pixels, fixed = s;
  check('one existing renderer samples real standard-material GLB floor and wall', s.contexts === 1 && s.sameRenderer
    && off.floor.valid && off.wall.valid && off.frame === s.stats.frames && s.points + s.spots === 0 && !s.shadowEnabled && !s.map.length, off);
  await control(page, action('preview', 'movie'), (el) => el.focus());
  check('keyboard focus alone neither previews nor calls HA', !(await snapshot(page)).map.length && !(await calls(page)).length);
  await hover(page, 'movie'); s = await snapshot(page);
  check('native mouse hover shows blue on BOTH actual GLB surfaces while real readings stay off', ['floor', 'wall'].every((n) => {
    const d = s.pixels[n].rgb.map((v, i) => v - off[n].rgb[i]); return s.pixels[n].valid && d[2] > 20 && d[2] > d[0] + 12 && d[2] > d[1] + 12;
  }) && s.active?.itemId === 'movie' && s.actual.state === 'off' && s.actual.level === 0 && s.actual.output === 0 && !s.actual.result.lit
    && !s.actual.chain && s.glow.intensity > 0 && s.services === 0, { pixels: s.pixels, actual: s.actual, active: s.active });
  await page.mouse.move(1, 1); await ready(page); s = await snapshot(page);
  check('native mouse leave returns to current actual off with zero HA commands', !s.map.length && !s.active && s.points + s.spots === 0
    && ['floor', 'wall'].every((n) => near(s.pixels[n].rgb, off[n].rgb)) && !s.services);
  await control(page, action('preview', 'movie'), async (el) => { const r = await el.boundingBox(); await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); });
  await ready(page); s = await snapshot(page);
  check('actual touch tap explicitly pins a visual preview without activating HA', s.active?.itemId === 'movie' && s.map.length === 1 && !s.services);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); window.scenesFixture.pinnedToken = c._scenePreviewController.active.token;
    window.scenesFixture.pinnedMap = c._lightPreview;
  });
  await page.mouse.move(1, 1); await ready(page);
  check('moving the mouse away cannot stop a pinned touch preview', equal((await snapshot(page)).active?.token, s.active.token)
    && await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return c._scenePreviewController.active?.token === window.scenesFixture.pinnedToken && c._lightPreview === window.scenesFixture.pinnedMap; }));
  await click(page, action('stop')); await ready(page);
  await control(page, action('preview', 'reading'), async (el) => { await el.focus(); await el.press('Enter'); }); await ready(page); s = await snapshot(page);
  check('native Enter Preview pins red without any scene command', s.active?.itemId === 'reading' && ['floor', 'wall'].every((n) =>
    s.pixels[n].valid && s.pixels[n].rgb[0] > s.pixels[n].rgb[2] + 12) && !s.services, s.pixels);
  await click(page, action('preview', 'movie')); await ready(page); s = await snapshot(page); const preview = s;
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.scenesFixture.previewToken = c._scenePreviewController.active.token; window.scenesFixture.previewMap = c._lightPreview; });
  await patch(page, { [entity]: light('on', [0, 255, 0], 64) }); s = await snapshot(page);
  check('real HA readings update independently while the explicit visual target stays blue and idle', s.actual.state === 'on' && s.actual.level === 64 / 255
    && equal(s.actual.rgb, [0, 255, 0]) && equal(s.active?.token, preview.active.token)
    && await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return c._scenePreviewController.active?.token === window.scenesFixture.previewToken && c._lightPreview === window.scenesFixture.previewMap; })
    && ['floor', 'wall'].every((n) => near(s.pixels[n].rgb, preview.pixels[n].rgb))
    && s.stats.frames === preview.stats.frames && s.stats.shadow === preview.stats.shadow && s.objects.budget === preview.objects.budget, { before: preview.stats, after: s.stats, actual: s.actual });
  // Open the actual action route without a user outside gesture. The resulting
  // popup is authoritative and deliberately ends the preview; its readings must
  // never show a made-up preview state.
  await page.evaluate(() => document.querySelector('taylors3d-card')._runObjectAction('scenes_probe', 'tap'));
  await page.waitForFunction(() => !!document.querySelector('taylors3d-card').shadowRoot.querySelector('.taylors3d-device-popup'), { timeout: 5000 });
  const actualPanel = await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('.taylors3d-device-popup').textContent);
  check('real device popup reports latest real green light rather than blue preview', actualPanel.includes('#00ff00') && !actualPanel.includes('Current colour #0000ff'), actualPanel);
  await page.keyboard.press('Escape'); await ready(page);
  await click(page, action('preview', 'movie')); await ready(page); await click(page, action('stop')); await ready(page); s = await snapshot(page);
  check('Stop restores LATEST real green rather than the pre-preview snapshot', !s.map.length && s.actual.level === 64 / 255
    && ['floor', 'wall'].every((n) => s.pixels[n].valid && s.pixels[n].rgb[1] > s.pixels[n].rgb[0] + 10 && s.pixels[n].rgb[1] > s.pixels[n].rgb[2] + 10)
    && !s.services, { off, latest: s.pixels });
  await patch(page, { [entity]: light('off') }); await click(page, action('preview', 'movie')); await ready(page);
  await patch(page, { 'switch.scenes_relay': { state: 'off', attributes: { friendly_name: 'Actual relay' } } }); s = await snapshot(page);
  check('real non-light relay off still blocks a mapped light preview', s.active?.itemId === 'movie' && !s.actual.chain && s.points + s.spots === 0
    && ['floor', 'wall'].every((n) => near(s.pixels[n].rgb, off[n].rgb)), s.allocated);
  await patch(page, { 'switch.scenes_relay': { state: 'on', attributes: { friendly_name: 'Actual relay' } } });
  await screenshot(page, mode === 'source' ? 'scenes-preview.png' : 'scenes-preview-bundle.png');
  await click(page, action('preview', 'many')); await ready(page); s = await snapshot(page);
  check('whole-house preview respects fixed 8 point / 4 spot / 4 physical shadow budget', s.points === 8 && s.spots === 4 && s.physicalShadows === 4
    && equal(s.pool, fixed.pool) && s.contexts === 1 && s.sameRenderer && !s.shadowEnabled && !s.pending.length
    && s.stats.shadow === fixed.stats.shadow && s.stats.shadowLights === fixed.stats.shadowLights && s.objects.shadowRequests === fixed.objects.shadowRequests,
  { points: s.points, spots: s.spots, physicalShadows: s.physicalShadows, stats: s.stats });
  check('unmapped real-off lights and non-light relays receive no invented visual state', !s.allocated.some(([id]) => id === 'scenes_unmapped' || id === 'scenes_switch')
    && await page.evaluate(() => document.querySelector('taylors3d-card')._objects.objectAt('scenes_strip').part.output === 0));
  await idleCheck(page, 'equal'); await idleCheck(page, 'unrelated');
  await click(page, action('stop')); await ready(page);
  check('all preview / hover / Stop / state / budget tests sent zero services', !(await calls(page)).length);
}

async function actionScenario(page) {
  const initial = await page.evaluate(() => structuredClone(document.querySelector('taylors3d-card')._hass.states));
  const incomplete = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), preview = c.shadowRoot.querySelector('[data-scene-action="preview"][data-scene-id="incomplete"]');
    return { disabled: preview.disabled, activate: c.shadowRoot.querySelector('[data-scene-action="activate"][data-scene-id="incomplete"]').disabled };
  });
  check('an incomplete light preview leaves the independent real scene Activate available', incomplete.disabled && !incomplete.activate, incomplete);
  await page.evaluate(() => { window.scenesFixture.nextResult = 'pending'; }); await click(page, action('activate', 'incomplete'));
  let sent = await calls(page);
  check('native Activate sends exactly one actual scene.turn_on and advertises pending', equal(sent, [['scene', 'turn_on', { entity_id: 'scene.scenes_incomplete' }]])
    && await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-scene-preview-bar] [data-scene-preview-status]').textContent.includes('Activating')),
  sent);
  await click(page, action('activate', 'incomplete'));
  check('pending repeated click cannot send a second command or alter real HA states', (await calls(page)).length === 1
    && await page.evaluate((initial) => JSON.stringify(document.querySelector('taylors3d-card')._hass.states) === JSON.stringify(initial), initial));
  await page.evaluate(() => { window.scenesFixture.pending.resolve(); window.scenesFixture.nextResult = 'success'; });
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._scenePreviewBar._pending, { timeout: 5000 });
  check('acknowledgement shows accepted action without optimistic light readings', (await snapshot(page)).status.includes('Activated')
    && await page.evaluate((initial) => JSON.stringify(document.querySelector('taylors3d-card')._hass.states) === JSON.stringify(initial), initial));
  // Press/revoke/recover/release uses real browser mouse events. The source is
  // restored before release, so a stale click must remain poisoned through recovery.
  await control(page, action('activate', 'movie'), async (el) => {
    const r = await el.boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
    await patch(page, { 'scene.scenes_movie': scene('scene.scenes_movie', 'unavailable') });
    await patch(page, { 'scene.scenes_movie': scene('scene.scenes_movie') }); await page.mouse.up();
  });
  check('native pointer press revoked then recovered cannot activate on stale release', (await calls(page)).length === 1);
  await click(page, action('activate', 'movie'));
  check('a fresh deliberate pointer gesture after recovery activates exact current scene once', equal((await calls(page)).at(-1), ['scene', 'turn_on', { entity_id: 'scene.scenes_movie' }]) && (await calls(page)).length === 2);
  await control(page, action('activate', 'reading'), async (el) => {
    await el.focus(); await page.keyboard.down('Space');
    await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = false; c.hass = { ...c._hass }; });
    await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._hass.connection.connected = true; c.hass = { ...c._hass }; });
    await page.keyboard.up('Space');
  });
  check('native held Space cannot activate after connection revocation and recovery', (await calls(page)).length === 2);
  await control(page, action('activate', 'reading'), async (el) => { await el.focus(); await el.press('Enter'); });
  check('fresh native Enter runs the saved scene exactly once', (await calls(page)).length === 3
    && equal((await calls(page)).at(-1), ['scene', 'turn_on', { entity_id: 'scene.scenes_reading' }]));
  await page.evaluate(() => { window.scenesFixture.nextResult = 'error'; }); await click(page, action('activate', 'incomplete'));
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._scenePreviewBar._pending, { timeout: 5000 });
  check('HA rejection stays literal readable text with no injected markup or auto retry', (await calls(page)).length === 4 && await page.evaluate(() => {
    const status = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-scene-preview-bar] [data-scene-preview-status]');
    return status.textContent.includes('<b>literally</b>') && !status.querySelector('b');
  }));
  await page.evaluate(() => { window.scenesFixture.nextResult = 'success'; });
  await patch(page, {}, { user: { id: 'scene-fixture-ordinary', is_admin: false, is_active: true } });
  await click(page, action('activate', 'incomplete'));
  check('authenticated ordinary users can deliberately activate an actual unknown stateless scene', (await calls(page)).length === 5
    && equal((await calls(page)).at(-1), ['scene', 'turn_on', { entity_id: 'scene.scenes_incomplete' }]));
  await patch(page, {}, { user: { id: 'scene-fixture-admin', is_admin: true, is_active: true } });
}

async function lifecycleScenario(page) {
  const commands = (await calls(page)).length;
  await click(page, action('preview', 'movie')); await ready(page);
  await patch(page, { 'scene.scenes_movie': { ...scene('scene.scenes_movie'), attributes: { friendly_name: 'movie', restored: true } } });
  check('restored scene evidence stops preview immediately and rejects both actions', !(await snapshot(page)).map.length && await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); return [...c.shadowRoot.querySelectorAll('[data-scene-id="movie"]')].every((el) => el.disabled);
  }));
  await patch(page, { 'scene.scenes_movie': scene('scene.scenes_movie') });
  check('evidence recovery does not silently resume an old visual preview', !(await snapshot(page)).map.length);
  await click(page, action('preview', 'movie')); await ready(page);
  await patch(page, { [entity]: light('unavailable') });
  check('unavailable selected light clears all visual targets without changing real scene definitions', !(await snapshot(page)).map.length);
  await patch(page, { [entity]: light() });
  await click(page, action('preview', 'movie')); await ready(page); await click(page, 'button[data-mode="top"]'); await ready(page);
  check('real viewing-mode interaction stops a saved preview', !(await snapshot(page)).map.length);
  await click(page, 'button[data-mode="3d"]'); await ready(page);
  await page.evaluate(() => { const v = document.querySelector('taylors3d-card')._view; v.stopCameraMotion(); v.setCamera({ position: [6, 5, 7], target: [0, 1, 0] }, { instant: true }); }); await ready(page);
  await control(page, action('preview', 'movie'), (el) => el.focus());
  await page.evaluate(() => { window.scenesFixture.focused = document.querySelector('taylors3d-card').shadowRoot.activeElement; });
  await patch(page, { 'sensor.scenes_unrelated': { state: 'focus-preserved', attributes: { friendly_name: 'Known unrelated reading' } } });
  check('unrelated HA updates retain the exact focused saved Preview button', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); return c.shadowRoot.activeElement === window.scenesFixture.focused
      && c.shadowRoot.querySelector('[data-scene-action="preview"][data-scene-id="movie"]') === window.scenesFixture.focused;
  }));
  await click(page, action('preview', 'movie')); await page.mouse.move(1, 1); await ready(page); const before = await snapshot(page);
  // Leave the pinned preview active, but move away before detaching. Re-inserting
  // a Preview button under the stationary mouse creates a new native hover; that
  // is a new user cue, not automatic recovery of the disconnected old token.
  check('pinned preview remains active with pointer outside before disconnect', before.active?.itemId === 'movie' && before.map.includes(entity));
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.scenesFixture.detached = c; c.remove(); });
  check('real card disconnect clears preview and stops its rendering loop', await page.evaluate(() => {
    const c = window.scenesFixture.detached; return !c._lightPreview && !c._view._raf && !c._scenePreviewController.active;
  }));
  await page.evaluate(() => document.querySelector('section.theme').append(window.scenesFixture.detached)); await ready(page); const after = await snapshot(page);
  check('reconnect follows real state with same renderer/pool and no automatic preview or shadow maps', !after.map.length && !after.active && after.sameRenderer
    && equal(after.pool, before.pool) && !after.shadowEnabled && !after.pending.length && after.services === commands,
  { before: { active: before.active, pool: before.pool, services: before.services }, after: { active: after.active, map: after.map, sameRenderer: after.sameRenderer, pool: after.pool, services: after.services, shadowEnabled: after.shadowEnabled, pending: after.pending } });
  await click(page, action('preview', 'movie')); await ready(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.scenesFixture;
    f.oldModel = c._view.model; f.glowDisposed = 0;
    const material = c._objects.objectAt('scenes_probe').part.glow.material;
    (Array.isArray(material) ? material[0] : material).addEventListener('dispose', () => f.glowDisposed++);
    c.setConfig({ ...c._config, model: '/demo/scenes-fixture.glb?replacement=1' });
  });
  await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card'); return c._view.model && c._view.model !== window.scenesFixture.oldModel
      && c._objects.parts.has('scenes_probe') && !c._loading;
  }, { timeout: 30000 });
  await page.evaluate(() => { const v = document.querySelector('taylors3d-card')._view; v.stopCameraMotion(); v.setCamera({ position: [6, 5, 7], target: [0, 1, 0] }, { instant: true }); });
  await ready(page); const replaced = await snapshot(page);
  check('actual GLB replacement cancels preview and disposes old owned glow exactly once', !replaced.map.length && !replaced.active && replaced.sameRenderer
    && equal(replaced.pool, before.pool) && !replaced.shadowEnabled && !replaced.pending.length && replaced.services === commands
    && await page.evaluate(() => window.scenesFixture.glowDisposed === 1));
}

async function editorState(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-scene-preview-editor]'), e = c._edit._scenePreviewEditor;
    return { exists: !!form, tab: c._edit.tab, selected: e.selected, dirty: e.dirty, preview: e.previewToken, saved: c._layout.scene_previews,
      saveDisabled: form?.querySelector('[data-act="scene-preview-save"]')?.disabled,
      previewDisabled: form?.querySelector('[data-act="scene-preview-preview"]')?.disabled,
      commits: window.scenesFixture.commits, services: window.scenesFixture.services.length, status: form?.querySelector('[data-scene-preview-status]')?.textContent };
  });
}
async function contrast(page, scope) {
  return page.evaluate((scope) => {
    const host = document.querySelector('taylors3d-card').shadowRoot.querySelector(scope);
    const lum = (colour) => colour.match(/[\d.]+/g)?.slice(0, 3).map(Number).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
      .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    return [...host.querySelectorAll('button,input:not([type=checkbox]):not([type=color]),select')].filter((el) => !el.disabled && el.getClientRects().length).map((el) => {
      const css = getComputedStyle(el), a = lum(css.color), b = lum(css.backgroundColor), r = el.getBoundingClientRect();
      return { id: el.dataset.sceneAction ? `${el.dataset.sceneAction}${el.dataset.sceneId ? ':' + el.dataset.sceneId : ''}` : el.dataset.act || el.dataset.field,
        ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), height: r.height,
        left: r.left, right: r.right, viewport: innerWidth };
    });
  }, scope);
}
async function editorScenario(page, mode) {
  let services = (await calls(page)).length;
  await patch(page, { [entity]: light('on', [0, 255, 0], 64) });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.resetHistory(); window.scenesFixture.commits = 0; });
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="scenes"]'); let f = await editorState(page);
  check('native Edit → Scenes opens honest preview controls and stops the saved bar', f.exists && f.tab === 'scenes' && !(await snapshot(page)).map.length && f.services === services);
  await click(page, editAction('add')); await type(page, field('label'), 'Bedtime sample');
  await choose(page, field('scene-entity'), 'scene.scenes_bedtime'); await choose(page, field('new-light'), entity); await click(page, editAction('add-light'));
  await click(page, editAction('capture')); f = await editorState(page);
  check('Capture stores selected CURRENT actual lights, with timestamp and zero service commands', equal(f.selected.lights, [target([0, 255, 0], 64)])
    && Number.isFinite(f.selected.captured_at) && f.selected.captured_at <= Date.now() && f.commits === 0 && f.services === services, f.selected);
  await choose(page, field('light-color-mode'), 'rgb'); f = await editorState(page);
  check('RGB mode starts incomplete; the white native picker alone cannot save or preview', equal(f.selected.lights[0].color, { mode: 'rgb', rgb: [] })
    && f.saveDisabled && f.previewDisabled && f.services === services);
  await choose(page, field('light-color-mode'), 'kelvin'); f = await editorState(page);
  check('Kelvin target starts blank and uses actual reported limits without invented colour', f.saveDisabled && f.previewDisabled && f.selected.lights[0].color.kelvin === ''
    && await page.evaluate(() => {
      const input = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="scene-preview-light-kelvin"]'); return input.min === '2000' && input.max === '6500';
    }));
  await type(page, field('light-kelvin'), '2400'); await type(page, field('light-brightness'), '255');
  await click(page, editAction('preview')); await ready(page); const warm = await snapshot(page);
  check('explicit Kelvin draft warms actual floor/wall without altering current green HA state', ['floor', 'wall'].every((n) => warm.pixels[n].valid
    && warm.pixels[n].rgb[0] > warm.pixels[n].rgb[2] + 12) && equal(warm.actual.rgb, [0, 255, 0]) && warm.services === services,
  { pixels: warm.pixels, editor: await editorState(page) });
  await click(page, editAction('stop')); await choose(page, field('light-color-mode'), 'rgb');
  // OS colour dialogs differ across platforms. This specifically exercises the
  // real native input's input/change handlers, without claiming a simulated OS picker.
  await control(page, field('light-rgb'), (el) => el.evaluate((input) => {
    const f = window.scenesFixture, form = input.closest('[data-scene-preview-editor]'); input.focus();
    f.rgbControl = input; f.rgbHint = form.querySelector('[data-scene-preview-rgb-hint="0"]');
    input.value = '#0000ff'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }));
  check('explicit native RGB input refreshes its truthful hint without replacing focused controls', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.scenesFixture;
    const input = c.shadowRoot.querySelector('[data-field="scene-preview-light-rgb"]'), hint = c.shadowRoot.querySelector('[data-scene-preview-rgb-hint="0"]');
    return input === f.rgbControl && hint === f.rgbHint && c.shadowRoot.activeElement === input
      && hint.textContent === 'This is your chosen visual target, not a current light reading.';
  }));
  await type(page, field('light-brightness'), '255'); await click(page, editAction('preview')); await ready(page); f = await editorState(page);
  check('explicit draft RGB input previews real blue pixels while HA remains green', f.preview !== null && equal(f.selected.lights, [target([0, 0, 255])])
    && (await snapshot(page)).actual.state === 'on' && equal((await snapshot(page)).actual.rgb, [0, 255, 0]) && f.services === services, f);
  // Use a fresh actual camera after editor's intentional viewport resize. The
  // probe guard rejects occluded or offscreen samples instead of counting UI pixels.
  await page.evaluate(() => { const v = document.querySelector('taylors3d-card')._view; v.stopCameraMotion(); v.setCamera({ position: [6, 5, 7], target: [0, 1, 0] }, { instant: true }); }); await ready(page);
  let s = await snapshot(page);
  check('draft preview also reaches actual visible floor AND wall after editor resize', ['floor', 'wall'].every((n) => s.pixels[n].valid && s.pixels[n].rgb[2] > s.pixels[n].rgb[0] + 12 && s.pixels[n].rgb[2] > s.pixels[n].rgb[1] + 12), s.pixels);
  await page.evaluate(() => { document.querySelector('taylors3d-card').shadowRoot.querySelector('.panel .tab-body').scrollTop = 0; });
  await screenshot(page, mode === 'source' ? 'scenes-editor.png' : 'scenes-editor-bundle.png');
  await control(page, field('light-rgb'), (el) => el.evaluate((input) => input.scrollIntoView({ block: 'center' })));
  await screenshot(page, mode === 'source' ? 'scenes-colour-targets.png' : 'scenes-colour-targets-bundle.png');
  await control(page, field('label'), (el) => el.focus()); await page.keyboard.press('Escape'); await ready(page);
  check('Escape from a focused Scenes field ends only the draft preview', !(await snapshot(page)).map.length && (await editorState(page)).tab === 'scenes');
  await page.evaluate(() => { window.scenesFixture.focused = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="scene-preview-label"]'); window.scenesFixture.focused.focus(); });
  await patch(page, { 'sensor.scenes_unrelated': { state: 'unfinished-draft', attributes: { friendly_name: 'Known unrelated reading' } } });
  check('unrelated HA reading keeps exact focused unfinished editor input and draft', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); return c.shadowRoot.activeElement === window.scenesFixture.focused
      && c.shadowRoot.querySelector('[data-field="scene-preview-label"]') === window.scenesFixture.focused && window.scenesFixture.focused.value === 'Bedtime sample';
  }));
  await click(page, editAction('save')); await ready(page); f = await editorState(page);
  const saved = f.saved;
  check('Save commits exact full scene preview list once, preserves extension and clears draft token', f.commits === 1 && f.services === services && saved.retained === 'fixture extension'
    && saved.items.length === 5 && saved.items.at(-1).id === 'preview-1' && equal(saved.items.at(-1).lights, [target([0, 0, 255])]) && !(await snapshot(page)).map.length, saved);
  await click(page, '[data-act="history-undo"]'); await ready(page); f = await editorState(page);
  check('one native Undo removes the whole added preview and restores original settings', equal(f.saved, settings()) && f.services === services);
  await click(page, '[data-act="history-redo"]'); await ready(page); f = await editorState(page);
  check('native Redo restores exact saved targets and no preview silently resumes', equal(f.saved, saved) && !(await snapshot(page)).map.length && f.services === services);
  await choose(page, field('binding'), '4'); await type(page, field('label'), 'Unfinished rename'); await click(page, editAction('cancel')); f = await editorState(page);
  check('Cancel abandons unsaved scene changes without another commit or action', equal(f.saved, saved) && !f.dirty && f.commits === 1 && f.services === services);
  await control(page, editAction('activate'), async (el) => {
    const r = await el.boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
    await patch(page, { 'scene.scenes_bedtime': scene('scene.scenes_bedtime', 'unavailable') });
    await patch(page, { 'scene.scenes_bedtime': scene('scene.scenes_bedtime') }); await page.mouse.up();
  });
  check('editor native held pointer is poisoned through scene revocation and recovery', (await calls(page)).length === services);
  await click(page, editAction('activate'));
  check('editor fresh Activate after recovery runs the exact saved scene once', (await calls(page)).length === services + 1
    && equal((await calls(page)).at(-1), ['scene', 'turn_on', { entity_id: 'scene.scenes_bedtime' }]));
  services++;
  await control(page, editAction('activate'), async (el) => {
    await el.focus(); await page.keyboard.down('Space');
    await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'); window.scenesFixture.savedServices = c._hass.services;
      c.hass = { ...c._hass, services: { light: c._hass.services.light } };
    });
    await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, services: window.scenesFixture.savedServices };
    });
    await page.keyboard.up('Space');
  });
  check('editor native held Space stays poisoned through service revocation and recovery', (await calls(page)).length === services);
  await control(page, editAction('activate'), async (el) => { await el.focus(); await el.press('Enter'); });
  check('editor fresh native Enter activates exact saved scene once', (await calls(page)).length === services + 1
    && equal((await calls(page)).at(-1), ['scene', 'turn_on', { entity_id: 'scene.scenes_bedtime' }]));
  services++;
  const lightContrast = await contrast(page, editor);
  check('light-theme editor controls are readable and at least 44px high', lightContrast.length >= 8 && lightContrast.every((c) => c.ratio >= 4.5 && c.height >= 44), lightContrast);
  await page.setViewport({ width: 320, height: 1100, deviceScaleFactor: 1, hasTouch: true }); await ready(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), section = document.querySelector('section.theme'); section.classList.remove('light'); section.classList.add('dark');
    c.hass = { ...c._hass, themes: { darkMode: true } };
  }); await ready(page);
  const darkContrast = await contrast(page, editor);
  check('320px dark-theme Scenes editor wraps controls without horizontal clipping', darkContrast.length >= 8 && darkContrast.every((c) => c.ratio >= 4.5 && c.height >= 44 && c.left >= 0 && c.right <= c.viewport + 1), darkContrast);
  await page.evaluate(() => { document.querySelector('taylors3d-card').shadowRoot.querySelector('.panel .tab-body').scrollTop = 0; });
  await screenshot(page, mode === 'source' ? 'scenes-narrow.png' : 'scenes-narrow-bundle.png', true);
  await click(page, 'button.edit'); await ready(page);
  let barContrast = await contrast(page, bar);
  const expectedButtons = ['preview:movie', 'activate:movie', 'preview:reading', 'activate:reading', 'preview:many', 'activate:many',
    'activate:incomplete', 'preview:preview-1', 'activate:preview-1'].sort();
  check('320px dark saved-scene buttons keep 44px targets and readable selected/default text', equal(barContrast.map((c) => c.id).sort(), expectedButtons)
    && await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'); return c.shadowRoot.querySelector('[data-scene-action="stop"]').disabled
        && c.shadowRoot.querySelector('[data-scene-action="preview"][data-scene-id="incomplete"]').disabled;
    })
    && barContrast.every((c) => c.ratio >= 4.5 && c.height >= 44 && c.left >= 0 && c.right <= c.viewport + 1), barContrast);
  await click(page, action('preview', 'movie')); await ready(page); barContrast = await contrast(page, bar);
  check('selected preview uses readable HA theme text, with zero Activate commands', equal(barContrast.map((c) => c.id).sort(), [...expectedButtons, 'stop'].sort())
    && barContrast.every((c) => c.ratio >= 4.5 && c.height >= 44 && c.left >= 0 && c.right <= c.viewport + 1)
    && (await calls(page)).length === services, barContrast);
  await control(page, action('preview', 'movie'), (el) => el.focus());
  const beforeScroll = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.scenesFixture, host = c.shadowRoot.querySelector('[data-scene-preview-bar]');
    const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
    f.scrollingToken = c._scenePreviewController.active.token; f.scrollingMap = c._lightPreview;
    return { heading: rect(host.querySelector('.scene-preview-heading')), stop: rect(host.querySelector('[data-scene-action="stop"]')),
      stats: { ...c._view.stats }, calls: f.services.length };
  });
  // Starting at Movie Preview, actual native Tab visits eight enabled buttons;
  // the incomplete preview is disabled and must be skipped. Native focus itself
  // scrolls the bounded list to reach the last configured Activate button.
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  await ready(page);
  const afterScroll = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.scenesFixture, host = c.shadowRoot.querySelector('[data-scene-preview-bar]');
    const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
    const list = host.querySelector('.scene-preview-items'), button = host.querySelector('[data-scene-action="activate"][data-scene-id="preview-1"]');
    const a = list.getBoundingClientRect(), b = button.getBoundingClientRect();
    return { lastFocused: c.shadowRoot.activeElement === button, scrollTop: list.scrollTop,
      inside: b.top >= a.top - 1 && b.bottom <= a.bottom + 1 && b.left >= a.left - 1 && b.right <= a.right + 1,
      heading: rect(host.querySelector('.scene-preview-heading')), stop: rect(host.querySelector('[data-scene-action="stop"]')),
      sameOwner: c._scenePreviewController.active?.token === f.scrollingToken && c._lightPreview === f.scrollingMap,
      stats: { ...c._view.stats }, calls: f.services.length };
  });
  check('native Tab reaches the last saved row inside the bounded list while heading and Stop stay fixed', afterScroll.lastFocused && afterScroll.scrollTop > 0
    && afterScroll.inside && equal(beforeScroll.heading, afterScroll.heading) && equal(beforeScroll.stop, afterScroll.stop), afterScroll);
  check('native list scrolling preserves preview ownership and causes zero HA actions or scene frames', afterScroll.sameOwner
    && equal(beforeScroll.stats, afterScroll.stats) && beforeScroll.calls === afterScroll.calls, { before: beforeScroll.stats, after: afterScroll.stats });
  const narrowScene = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), scene = c._scene.getBoundingClientRect(), toolbar = c._toolbar.getBoundingClientRect();
    return { width: scene.width, height: scene.height, toolbarHeight: toolbar.height, stageHeight: c._stage.getBoundingClientRect().height };
  });
  check('narrow saved scene controls leave a usable visible model viewport', narrowScene.width >= 200 && narrowScene.height >= 120, narrowScene);
  await screenshot(page, mode === 'source' ? 'scenes-bar-narrow.png' : 'scenes-bar-narrow-bundle.png', true);
  await click(page, action('stop')); await ready(page);
  await page.setViewport({ width: 1280, height: 1100, deviceScaleFactor: 1, hasTouch: true }); await ready(page);
  await page.waitForFunction((mode) => JSON.parse(localStorage.getItem(`taylors3d_scenes-browser-${mode}`) || 'null')?.scene_previews?.items.length === 5, { timeout: 5000 }, mode);
  check('actual browser storage persists complete explicit previews', (await snapshot(page)).backend === 'browser');
  check('fixture restores its render callback before real reload', await restoreObservers(page));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.querySelector('taylors3d-card')?._objects?.parts.has('scenes_probe'), { timeout: 30000 });
  await prepare(page, mode, false); s = await snapshot(page);
  check('real reload restores exact saved previews with current HA readings and no auto preview/actions', equal(s.saved, saved) && !s.map.length && !s.active
    && s.contexts === 1 && s.actual.state === 'off' && s.services === 0 && !s.shadowEnabled, s.saved);
}

async function drawnScenario(page) {
  await restoreObservers(page);
  await page.evaluate(({ entity }) => {
    const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model: null });
    c.hass = { ...c._hass, entities: { ...c._hass.entities, [entity]: { entity_id: entity, area_id: 'living_room' } } };
    c._commit({ ...c._layout, rooms: [{ id: 'scenes_drawn_room', area_id: 'living_room', floor_id: 'ground', polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]] }],
      pins: { [`entity:${entity}`]: { x: .6, y: .2, z: 2.2, floor_id: 'ground' } } });
    c._setFloor('ground'); c._setMode('top');
  }, { entity });
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._view.model, { timeout: 30000 }); await ready(page);
  const plan = () => page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, blob = v.glows.get('entity:light.scenes_probe'), marker = c._markerEls.get('entity:light.scenes_probe');
    return { actual: c._hass.states['light.scenes_probe'].state, css: marker?.style.getPropertyValue('--fp-light'), active: marker?.classList.contains('active'),
      colour: blob?.mesh.material.color.getHexString(), visible: blob?.mesh.visible, material: blob?.mesh.material.uuid, geometry: blob?.mesh.geometry.uuid,
      stats: { frames: v.stats.frames, shadow: v.stats.shadow, shadowLights: v.stats.shadowLights }, memory: { ...v.renderer.info.memory },
      programs: v.renderer.info.programs.map((p) => p.id), contexts: window.scenesContexts.size, sameRenderer: v.renderer === window.scenesFixture.renderer,
      services: window.scenesFixture.services.length, preview: c._lightPreview ? [...c._lightPreview.keys()] : [] };
  });
  let s = await plan();
  check('drawn-plan actual off starts without an active marker or decorative glow', !s.active && !s.colour && s.actual === 'off' && s.sameRenderer && s.contexts === 1, s);
  await click(page, action('preview', 'movie')); await ready(page); s = await plan();
  check('drawn-plan preview shows blue floor glow while marker and public HA reading stay actual off', s.colour === '0000ff' && s.visible && s.actual === 'off'
    && !s.active && s.css === '' && s.preview.includes(entity) && !s.services, s);
  const before = s;
  for (let i = 0; i < 10; i++) await patch(page, { [entity]: light() });
  s = await plan();
  check('equal fresh drawn-plan snapshots keep preview, renderer and material strictly idle', equal(before.stats, s.stats) && equal(before.memory, s.memory)
    && equal(before.programs, s.programs) && before.material === s.material && before.geometry === s.geometry && s.sameRenderer, { before, after: s });
  await patch(page, { [entity]: light('on', [0, 255, 0], 64) }); s = await plan();
  check('drawn-plan actual green reading changes marker while explicit preview stays blue', s.actual === 'on' && s.active && s.css === 'rgb(0,255,0)'
    && s.colour === '0000ff' && before.stats.frames === s.stats.frames && !s.services, s);
  await click(page, action('stop')); await ready(page); s = await plan();
  check('drawn-plan Stop restores latest real green with no old snapshot or service action', s.colour === '00ff00' && s.visible && s.active
    && s.css === 'rgb(0,255,0)' && !s.preview.length && !s.services, s);
  await click(page, action('preview', 'movie')); await ready(page);
  const restored = light('on'); restored.attributes.restored = true; await patch(page, { [entity]: restored }); s = await plan();
  check('restored drawn light stops preview and removes stale glow/active styling', !s.preview.length && !s.colour && !s.active && s.css === '' && !s.services, s);
}

const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
for (const mode of modes) {
  label = `${mode}: `; context = 'fixture setup'; let session;
  try {
    session = await open(mode);
    check('loads exactly its selected source or bundle implementation', mode === 'source'
      ? session.requests.includes('/src/taylors3d-card.js') && !session.requests.includes('/dist/taylors3d-card.js')
      : session.requests.includes('/dist/taylors3d-card.js') && !session.requests.some((url) => url.startsWith('/src/')));
    await previewScenario(session.page, mode); await actionScenario(session.page); await lifecycleScenario(session.page); await editorScenario(session.page, mode);
    await drawnScenario(session.page);
  } catch (error) { check('scene preview scenario completes', false, error.stack || error.message); }
  finally {
    if (session) {
      const pending = [...session.pageErrors];
      errors.push(...session.errors.map((message) => { const i = pending.findIndex((entry) => entry.message === message); return i >= 0 ? pending.splice(i, 1)[0] : message; }));
      check('fixture restores the original app render callback', await restoreObservers(session.page)); await session.close();
    }
  }
}
label = ''; check('no browser errors', errors.length === 0, errors);
if (checks.some((pass) => !pass)) process.exitCode = 1;
