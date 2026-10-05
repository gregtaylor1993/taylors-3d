// F16: real GLB AO/unlit/PBR textures, shadow policy and visual settings.
// The fixture is simulated, reuses MIT demo geometry, and uses one existing
// renderer/light pool. Run after building; supports --source-only/--bundle-only.
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { launch, newPage, root } from './lib/demo-browser.mjs';

const checks = [], errors = [];
let label = '', context = 'setup';
const check = (name, pass, detail) => {
  checks.push(!!pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tolerance = 3) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const luma = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
const lampEntity = 'light.shading_lamp';
const field = '[data-field="model-rendering-preset"]';
const presets = { normal: { shadows: 'realtime', lamps: 'inherit' }, 'no-shadows': { shadows: 'off', lamps: 'inherit' },
  authored: { shadows: 'off', lamps: 'off' } };

// Small lossless fixture textures, embedded in the GLB rather than fetched.
function png(width, height, pixel) {
  const chunk = (name, data) => {
    const nameBytes = Buffer.from(name), payload = Buffer.concat([nameBytes, data]);
    let crc = 0xffffffff;
    for (const value of payload) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, payload, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * (1 + width * 4) + 1 + x * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function fixtureGlb() {
  const source = fs.readFileSync(path.join(root, 'demo/house.glb')), jsonLength = source.readUInt32LE(12);
  const json = JSON.parse(source.toString('utf8', 20, 20 + jsonLength));
  const rest = source.subarray(20 + jsonLength), binary = rest.subarray(8, 8 + rest.readUInt32LE(0));
  const parts = [binary]; let offset = binary.length;
  const append = (bytes, target) => {
    const pad = Buffer.alloc((4 - offset % 4) % 4); parts.push(pad); offset += pad.length;
    const index = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) }) - 1;
    parts.push(bytes); offset += bytes.length; return index;
  };
  const accessor = (array, type, componentType, bounds) => json.accessors.push({ bufferView: append(Buffer.from(array.buffer), componentType === 5123 ? 34963 : 34962),
    componentType, count: array.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3 }[type]), type, ...bounds }) - 1;
  const position = accessor(new Float32Array([-1, 0, -1, -1, 0, 1, 1, 0, 1, 1, 0, -1]), 'VEC3', 5126, { min: [-1, 0, -1], max: [1, 0, 1] });
  const normal = accessor(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 'VEC3', 5126);
  const uv0 = accessor(new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]), 'VEC2', 5126);
  // AO has its own UV channel and intentionally reverses east/west from the base map.
  const uv1 = accessor(new Float32Array([1, 0, 1, 1, 0, 1, 0, 0]), 'VEC2', 5126);
  const indices = accessor(new Uint16Array([0, 1, 2, 0, 2, 3]), 'SCALAR', 5123);
  json.images ||= []; json.textures ||= []; json.samplers ||= [];
  const sampler = json.samplers.push({ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }) - 1;
  const texture = (name, bytes) => {
    const image = json.images.push({ name, bufferView: append(bytes), mimeType: 'image/png' }) - 1;
    return json.textures.push({ name, source: image, sampler }) - 1;
  };
  const diffuse = texture('shading_base_srgb', png(2, 2, () => [200, 200, 200, 255]));
  const ao = texture('shading_ao_linear', png(8, 8, (x) => x < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const baked = texture('shading_authored_colour', png(2, 2, () => [80, 160, 100, 255]));
  const material = (name, extra = {}) => json.materials.push({ name,
    pbrMetallicRoughness: { baseColorFactor: [.55, .55, .55, 1], baseColorTexture: { index: diffuse, texCoord: 0 }, metallicFactor: 0, roughnessFactor: 1 }, ...extra }) - 1;
  const aoMaterial = material('shading_real_ao', { occlusionTexture: { index: ao, texCoord: 1, strength: 1 } });
  const pbrMaterial = material('shading_real_pbr');
  const unlitMaterial = material('shading_real_unlit', { pbrMetallicRoughness: { baseColorTexture: { index: baked }, baseColorFactor: [1, 1, 1, 1] },
    extensions: { KHR_materials_unlit: {} } });
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'KHR_materials_unlit'])];
  const planeMesh = (name, material) => json.meshes.push({ name, primitives: [{ material, indices,
    attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv0, TEXCOORD_1: uv1 } }] }) - 1;
  const node = (value) => json.nodes.push(value) - 1;
  const aoFloor = node({ name: 'shading_ao_floor', mesh: planeMesh('ao_plane', aoMaterial), translation: [-1.8, 0, -.5] });
  const pbrFloor = node({ name: 'shading_pbr_floor', mesh: planeMesh('pbr_plane', pbrMaterial), translation: [1.5, 0, -.5] });
  const unlitFloor = node({ name: 'shading_unlit_floor', mesh: planeMesh('unlit_plane', unlitMaterial), translation: [0, 0, 1.6], scale: [.65, 1, .4] });
  const sourceLamp = json.nodes.find((n) => n.name === 'lamp_living');
  const glowMesh = json.nodes[sourceLamp.children.find((index) => json.nodes[index].name === 'glow')].mesh;
  const glow = node({ name: 'glow', mesh: glowMesh });
  const lamp = node({ name: 'shading_lamp', translation: [1.5, 2.2, -.5], children: [glow], extras: { fp: { kind: 'object', id: 'shading_lamp', type: 'light',
    label: 'Simulated shading lamp', glow: 'glow', hints: { beam: 'point', max: 20, distance: 8, decay: 2 }, suggest: { entity: lampEntity } } } });
  const boxMesh = json.nodes.find((n) => n.name === 'coffee_table_body').mesh;
  const leaf = node({ name: 'leaf', mesh: boxMesh, translation: [.6, 1, 0], scale: [1, 2 / .45, .1] });
  const door = node({ name: 'shading_door', translation: [-3.2, 0, -1.8], children: [leaf], extras: { fp: {
    kind: 'object', id: 'shading_door', type: 'door', label: 'Explicit simulated hinge' } } });
  const room = node({ name: 'shading_room', children: [aoFloor, pbrFloor, unlitFloor, lamp, door], extras: { fp: {
    kind: 'room', id: 'shading_room', outline: [[-3.5, -2.1], [3, -2.1], [3, 2.2], [-3.5, 2.2]], suggest: { area: 'living_room' } } } });
  const ground = node({ name: 'shading_ground', children: [room], extras: { fp: { kind: 'level', id: 'ground', role: 'storey', elevation: 0, height: 2.7, order: 0 } } });
  const bench = node({ name: 'shading_bench', children: [ground], extras: { fp: { north: 0, views: [{ id: 'ground', label: 'Simulated shading bench', show: ['level:ground'] }] } } });
  json.scenes = [{ nodes: [bench] }]; json.scene = 0;
  const binPad = Buffer.alloc((4 - offset % 4) % 4); parts.push(binPad); offset += binPad.length;
  json.buffers[0].byteLength = offset;
  const body = Buffer.from(JSON.stringify(json)), jsonPad = Buffer.alloc((4 - body.length % 4) % 4, 0x20), head = Buffer.alloc(20), binHead = Buffer.alloc(8);
  head.write('glTF'); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + body.length + jsonPad.length + offset, 8);
  head.writeUInt32LE(body.length + jsonPad.length, 12); head.write('JSON', 16); binHead.writeUInt32LE(offset); binHead.write('BIN\0', 4);
  return Buffer.concat([head, body, jsonPad, binHead, ...parts]);
}

const light = (state = 'on', rgb = [255, 255, 255]) => ({ state, attributes: { friendly_name: 'Simulated shading lamp',
  brightness: 255, supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: rgb } });
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function ready(page) {
  try { await page.waitForFunction(() => {
    const v = document.querySelector('taylors3d-card')._view, now = performance.now();
    if (v.dirty || v._tween || v._modelMotionMoving || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350) { window.shadingIdle = null; return false; }
    if (!window.shadingIdle || ['frames', 'shadow', 'shadowLights'].some((key) => window.shadingIdle[key] !== v.stats[key])) {
      window.shadingIdle = { ...v.stats, at: now }; return false;
    } return now - window.shadingIdle.at > 350;
  }, { timeout: 15000, polling: 50 }); } catch (error) {
    const state = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), v = c?._view;
      return { dirty: v?.dirty, tween: !!v?._tween, motion: v?._modelMotionMoving,
        occlusion: v?._occFull, timer: !!v?._occTimer, cameraAge: performance.now() - (v?._camMovedAt || 0),
        stats: v?.stats, idle: window.shadingIdle, raf: !!v?._raf, loading: c?._loading,
        capture: window.shadingFixture?.capture, visibility: document.visibilityState,
        frameSamples: window.shadingFixture?.frameSamples, lastFrame: window.shadingFixture?.lastFrame,
        camera: v?.getCamera(), size: v?.size, viewport: [innerWidth, innerHeight] };
    }).catch(() => null);
    error.message += `; ${context}; renderer readiness: ${JSON.stringify(state)}`;
    throw error;
  }
}
async function patch(page, states) {
  context = 'HA update ' + Object.keys(states).join(', ');
  await page.evaluate((states) => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, states: { ...c._hass.states, ...states } }; }, states);
  await settle(page); await ready(page);
}
async function policy(page, value) {
  context = 'layout shadow policy ' + JSON.stringify(value);
  await page.evaluate((value) => { const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ model_rendering: value }); }, value);
  await settle(page); await ready(page);
}
async function control(page, selector, action) {
  context = 'UI ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw new Error('Missing shading control: ' + selector);
    await element.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await action(element);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const selectPreset = (page, value) => control(page, field, (element) => element.select(value));
async function screenshot(page, name, options = {}) {
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ ...options, path: path.join(root, 'screenshots', name) });
}
async function restoreObservers(page) {
  return page.evaluate(() => {
    const view = document.querySelector('taylors3d-card')?._view, fixture = window.shadingFixture;
    if (!view || !fixture) return true;
    let restored = true;
    for (const [field, previous] of [['onRender', 'previousRender'], ['onFrame', 'previousFrame']]) {
      if (!Object.hasOwn(fixture, previous)) continue;
      const original = fixture[previous]; view[field] = original;
      restored = restored && view[field] === original; delete fixture[previous];
    }
    delete fixture.frameSamples; delete fixture.lastFrame;
    return restored;
  });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, layer = c._objects, fixture = window.shadingFixture;
    const pool = [...layer.pool.points, ...layer.pool.spots];
    const surfaces = ['shading_ao_floor', 'shading_pbr_floor', 'shading_unlit_floor'].map((name) => {
      const mesh = v.model.root.getObjectByName(name), m = mesh.material;
      return { name, mesh: mesh.uuid, geometry: mesh.geometry.uuid, material: m.uuid, version: m.version, type: m.type,
        map: m.map?.uuid, ao: m.aoMap?.uuid, channel: m.aoMap?.channel, strength: m.aoMapIntensity,
        uv0: mesh.geometry.attributes.uv?.count, uv1: mesh.geometry.attributes.uv1?.count };
    });
    return { pixels: fixture.capture, stats: { ...v.stats }, objects: { ...layer.stats }, surfaces,
      rendering: c._layout.model_rendering ?? c._config.model_rendering ?? { shadows: 'realtime', lamps: 'inherit' },
      saved: c._layout.model_rendering, shadowEnabled: v.renderer.shadowMap.enabled, shadowPending: v.renderer.shadowMap.needsUpdate,
      pending: [v.sun, ...pool].filter((l) => l.shadow?.needsUpdate).map((l) => l.uuid), sun: v.sun.intensity,
      pool: pool.map((l) => [l.uuid, l.intensity, l.color.toArray(), l.position.toArray(), l.castShadow, l.shadow?.intensity]),
      lit: pool.filter((l) => l.intensity > 0).length, groupVisible: layer.lights.visible, slots: [...layer._slots].map(([id, slot]) => [id, slot.light.uuid, slot.shadow]),
      memory: { ...v.renderer.info.memory }, programs: v.renderer.info.programs.map((program) => program.id),
      revision: v._modelMotionRevision, rotation: fixture.leaf.quaternion.toArray(), calls: fixture.services.length, commits: fixture.commits,
      sameRenderer: v.renderer === fixture.renderer, contexts: window.shadingContexts.size, backend: c._store.backend };
  });
}

async function prepare(page, mode, reset = true) {
  await page.evaluate(async ({ mode, reset, state }) => {
    const c = document.querySelector('taylors3d-card');
    window.shadingFixture = { services: [], commits: 0, renderer: c._view.renderer, capture: null };
    // Force real browser-storage fallback before changing the layout key, then
    // install fixture observations after that layout has actually loaded.
    c.hass = { ...c._hass, callWS: undefined };
    c.setConfig({ ...c._config, layout_key: `shading-browser-${mode}`, height: '700px', merge: false, model_opacity: 1,
      control_panel: 'right', lights: 'auto', sky_bodies: false });
    await c._layoutReady;
    c.hass = { ...c._hass, callWS: undefined, callService: (...args) => { window.shadingFixture.services.push(args); return Promise.resolve(); },
      config: { ...c._hass.config, latitude: null, longitude: null }, states: {
        'light.shading_lamp': state, 'sensor.shading_unrelated': { state: '0', attributes: { friendly_name: 'Known unrelated reading' } },
        'binary_sensor.shading_door': { state: 'off', attributes: { device_class: 'door' } },
        'sun.sun': { state: 'below_horizon', attributes: { elevation: -20, azimuth: 180 } } } };
    if (reset) c._commit({ ...c._layout, rooms: [], pins: {}, hidden: [], mower: {}, objects: {}, groups: {}, model: {}, views: {},
      model_rendering: undefined, room_overlays: { mode: 'off' }, alert_bindings: [], weather: { enabled: false },
      presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [], camera_coverage: { enabled: false },
      security_bindings: [{ id: 'shading_door', entity: 'binary_sensor.shading_door', object_id: 'shading_door', kind: 'door', open_states: ['on'], closed_states: ['off'],
        motion: { target: 'leaf', pivot: [0, 0, 0], axis: [0, 1, 0], closed_degrees: 0, open_degrees: 90, duration_ms: 0 } }] });
    const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (patch) => { window.shadingFixture.commits++; return commit(patch); };
    const v = c._view; v.stopCameraMotion(); c._skyMode = 'auto'; c._applySky(true);
    const previousFrame = v.onFrame; window.shadingFixture.previousFrame = previousFrame;
    window.shadingFixture.frameSamples = 0;
    v.onFrame = (now) => {
      const result = previousFrame?.(now);
      window.shadingFixture.frameSamples++;
      window.shadingFixture.lastFrame = { now, dirty: v.dirty, result };
      return result;
    };
    window.shadingFixture.leaf = v.model.manifest.objects.find((o) => o.id === 'shading_door').node.children.find((n) => (n.userData.name || n.name) === 'leaf');
    window.shadingFixture.authored = window.shadingFixture.leaf.quaternion.toArray();
    document.querySelector('section.theme h2').textContent = `Simulated AO / unlit / live-light bench · ${mode}`;
    c.resetHistory();
  }, { mode, reset, state: light('off') });
  // Observe the real settled layout before adding any synchronous GPU readback.
  // Interval polling only samples readiness; it cannot request a scene render.
  await ready(page);
  await page.evaluate(() => {
    const v = document.querySelector('taylors3d-card')._view;
    const previous = v.onRender; window.shadingFixture.previousRender = previous;
    v.onRender = () => {
      previous?.();
      const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const probes = { dark: { point: [-1.1, .001, -.55], mesh: 'shading_ao_floor' }, clear: { point: [-2.5, .001, -.55], mesh: 'shading_ao_floor' },
        unlit: { point: [0, .001, 1.6], mesh: 'shading_unlit_floor' }, pbr: { point: [1.5, .001, -.55], mesh: 'shading_pbr_floor' } };
      const capture = { frame: v.stats.frames };
      for (const [name, probe] of Object.entries(probes)) {
        const world = v.camera.position.clone().set(...probe.point), projected = world.clone().project(v.camera);
        const screen = v.projectWorld(world), hit = screen && v._modelHit(screen[0], screen[1]);
        const x = Math.round((projected.x + 1) * width / 2), y = Math.round((projected.y + 1) * height / 2);
        const valid = x >= 3 && y >= 3 && x < width - 3 && y < height - 3 && projected.z > -1 && projected.z < 1 && hit?.object.name === probe.mesh;
        const pixels = new Uint8Array(7 * 7 * 4); if (valid) gl.readPixels(x - 3, y - 3, 7, 7, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const rgb = [0, 1, 2].map((channel) => { const values = []; for (let i = channel; i < pixels.length; i += 4) values.push(pixels[i]); values.sort((a, b) => a - b); return values[24]; });
        capture[name] = { valid, rgb, mesh: hit?.object.name, point: probe.point };
      } window.shadingFixture.capture = capture;
    };
    v.stopCameraMotion(); v.setCamera({ position: [5, 6, 8], target: [0, .4, 0] }, { instant: true });
  });
  await ready(page);
}

async function open(mode) {
  const transport = await launch();
  let session;
  const pageErrors = [];
  try {
    session = await newPage(transport.browser, { width: 1280, height: 1000 });
    const { page } = session, requests = [], fixture = fixtureGlb();
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack, context: label + context }));
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8').replace(/<section class="theme dark">[\s\S]*?<\/section>/, '')
      .replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
    if (mode === 'source') html = html.replace('</head>', `<script type="importmap">${JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } })}</script></head>`)
      .replace('src="../dist/taylors3d-card.js"', 'src="../src/taylors3d-card.js"');
    await page.evaluateOnNewDocument(() => {
      window.__demoMowerPaused = true; window.__demoNow = Date.UTC(2026, 9, 5, 12); window.shadingContexts = new Set();
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const value = original.call(this, kind, ...args); if (value && /^webgl/.test(kind)) window.shadingContexts.add(this); return value; };
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
      else if (url.pathname === '/demo/shading-fixture.glb') request.respond({ status: 200, contentType: 'model/gltf-binary', body: fixture });
      else request.continue();
    });
    await page.goto(`${transport.base}/demo/index.html?model=/demo/shading-fixture.glb&merge=0&floor=ground&view=3d&height=700px`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('taylors3d-card')?._objects?.parts.has('shading_lamp'), { timeout: 30000 });
    await prepare(page, mode);
    return { ...transport, ...session, requests, pageErrors };
  } catch (error) {
    errors.push(...pageErrors, ...(session?.errors || []).filter((message) => !pageErrors.some((entry) => entry.message === message)));
    if (session) await restoreObservers(session.page).catch(() => {});
    await transport.close(); throw error;
  }
}

async function idleCheck(page, kind) {
  await ready(page); const before = await snapshot(page);
  const writes = await page.evaluate(async (kind) => {
    const c = document.querySelector('taylors3d-card'), pool = [...c._objects.pool.points, ...c._objects.pool.spots], restores = [];
    let count = 0;
    try {
      for (const light of pool) {
        const descriptor = Object.getOwnPropertyDescriptor(light, 'intensity'); let value = light.intensity;
        Object.defineProperty(light, 'intensity', { configurable: true, get: () => value, set: (next) => { count++; value = next; } });
        restores.push(() => Object.defineProperty(light, 'intensity', { ...descriptor, value }));
        for (const [object, method] of [[light.color, 'setRGB'], [light.position, 'copy'], [light.position, 'set']]) {
          const original = object[method], own = Object.hasOwn(object, method);
          object[method] = function (...args) { count++; return original.apply(this, args); };
          restores.push(() => { if (own) object[method] = original; else delete object[method]; });
        }
      }
      for (let i = 0; i < 10; i++) {
        const current = c._hass.states['light.shading_lamp'];
        const state = kind === 'equal' ? { ...current, attributes: { ...current.attributes, rgb_color: current.attributes.rgb_color.slice() } }
          : { state: String(i + 1), attributes: { friendly_name: 'Known unrelated reading' } };
        c.hass = { ...c._hass, states: { ...c._hass.states, [kind === 'equal' ? 'light.shading_lamp' : 'sensor.shading_unrelated']: state } };
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
      return count;
    } finally { for (const restore of restores.reverse()) restore(); }
  }, kind);
  const after = await snapshot(page);
  check(`ten ${kind} HA readings request zero frames/shadows/pool writes/resources/program changes`, writes === 0
    && ['frames', 'shadow', 'shadowLights'].every((key) => before.stats[key] === after.stats[key])
    && before.objects.shadowRequests === after.objects.shadowRequests && equal(before.pool, after.pool)
    && equal(before.memory, after.memory) && equal(before.programs, after.programs) && equal(before.surfaces, after.surfaces),
  { writes, before: before.stats, after: after.stats, shadowRequests: [before.objects.shadowRequests, after.objects.shadowRequests] });
}

async function pixelsScenario(page, mode) {
  const baseline = await snapshot(page), valid = (s) => s.pixels.frame === s.stats.frames
    && ['dark', 'clear', 'unlit', 'pbr'].every((name) => s.pixels[name].valid);
  check('default policy preserves realtime shadows with one actual existing renderer', equal(baseline.rendering, presets.normal)
    && baseline.shadowEnabled && baseline.sameRenderer && baseline.contexts === 1 && baseline.calls === 0, baseline.rendering);
  const ao = baseline.surfaces.find((s) => s.name === 'shading_ao_floor'), unlit = baseline.surfaces.find((s) => s.name === 'shading_unlit_floor');
  check('GLB loads actual AO on the independent second UV channel and genuine unlit base texture', ao.type === 'MeshStandardMaterial'
    && ao.channel === 1 && ao.strength === 1 && !!ao.ao && !!ao.map && ao.uv0 === 4 && ao.uv1 === 4
    && unlit.type === 'MeshBasicMaterial' && !!unlit.map && valid(baseline), baseline.surfaces);
  const contrast = (s) => luma(s.pixels.clear.rgb) - luma(s.pixels.dark.rgb);
  check('authored AO texture produces measurable actual ambient shading contrast', contrast(baseline) >= 6, baseline.pixels);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model_rendering: { shadows: 'off', lamps: 'inherit' } }); });
  await ready(page); const fallback = await snapshot(page);
  check('card config supplies the shadow policy when no layout override is saved', equal(fallback.rendering, presets['no-shadows']) && !fallback.shadowEnabled, fallback.rendering);
  await policy(page, presets.normal); const overridden = await snapshot(page);
  check('an explicit layout policy takes precedence over card config', equal(overridden.rendering, presets.normal) && overridden.shadowEnabled, overridden.rendering);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), config = { ...c._config }; delete config.model_rendering;
    c.setConfig(config); c._commit({ ...c._layout, model_rendering: undefined });
  }); await ready(page);
  await policy(page, presets['no-shadows']); const noShadows = await snapshot(page);
  check('shadow-off retains actual AO contrast and authored unlit pixels', !noShadows.shadowEnabled && !noShadows.shadowPending
    && noShadows.pending.length === 0 && valid(noShadows) && contrast(noShadows) >= 6 && contrast(noShadows) >= contrast(baseline) * .8
    && near(noShadows.pixels.unlit.rgb, baseline.pixels.unlit.rgb) && noShadows.lit === 0,
  { contrast: [contrast(baseline), contrast(noShadows)], pixels: noShadows.pixels });
  await patch(page, { [lampEntity]: light('on', [255, 0, 0]) }); const red = await snapshot(page);
  await patch(page, { [lampEntity]: light('on', [0, 0, 255]) }); const blue = await snapshot(page);
  check('PBR textured floor still receives real red and blue HA lamp light with shadows off', valid(red) && valid(blue)
    && red.pixels.pbr.rgb[0] - noShadows.pixels.pbr.rgb[0] >= 12 && blue.pixels.pbr.rgb[2] - noShadows.pixels.pbr.rgb[2] >= 12
    && red.pixels.pbr.rgb[0] > red.pixels.pbr.rgb[2] + 12 && blue.pixels.pbr.rgb[2] > blue.pixels.pbr.rgb[0] + 12
    && red.lit === 1 && blue.lit === 1 && !red.shadowEnabled && !blue.shadowEnabled, { red: red.pixels.pbr, blue: blue.pixels.pbr });
  check('genuine unlit texture colour stays invariant under lamp colour changes', near(red.pixels.unlit.rgb, baseline.pixels.unlit.rgb)
    && near(blue.pixels.unlit.rgb, baseline.pixels.unlit.rgb) && blue.pixels.unlit.rgb[1] > blue.pixels.unlit.rgb[0] + 10,
  { baseline: baseline.pixels.unlit.rgb, red: red.pixels.unlit.rgb, blue: blue.pixels.unlit.rgb });
  await screenshot(page, mode === 'source' ? 'shading-surfaces.png' : 'shading-surfaces-bundle.png');
  const before = await snapshot(page);
  await patch(page, { 'sun.sun': { state: 'above_horizon', attributes: { elevation: 35, azimuth: 180 } },
    [lampEntity]: light('on'), 'binary_sensor.shading_door': { state: 'on', attributes: { device_class: 'door' } } });
  const after = await snapshot(page);
  check('actual sun, HA light and rigid hinge changes request zero sun/pool shadows while disabled', after.sun > 0 && after.lit === 1
    && after.revision > before.revision && !near(after.rotation, before.rotation, 1e-5) && !after.shadowEnabled
    && !after.shadowPending && after.pending.length === 0 && after.stats.shadow === before.stats.shadow
    && after.stats.shadowLights === before.stats.shadowLights && after.objects.shadowRequests === before.objects.shadowRequests,
  { before: before.stats, after: after.stats, requests: [before.objects.shadowRequests, after.objects.shadowRequests], sun: after.sun, rotation: after.rotation });
  check('unlit authored colour also stays invariant under actual daytime lighting', near(after.pixels.unlit.rgb, baseline.pixels.unlit.rgb), after.pixels.unlit);
  await idleCheck(page, 'equal'); await idleCheck(page, 'unrelated');
  const beforeEnable = await snapshot(page); await policy(page, presets.normal); const enabled = await snapshot(page);
  check('re-enabling requests current sun and lamp shadow maps in one batch with existing pooled lights', enabled.shadowEnabled
    && enabled.stats.shadow === beforeEnable.stats.shadow + 1 && enabled.stats.shadowLights === beforeEnable.stats.shadowLights + 2
    && enabled.objects.shadowRequests === beforeEnable.objects.shadowRequests
    && enabled.pending.length === 0 && enabled.pool.every((p, i) => p[0] === beforeEnable.pool[i][0]) && enabled.calls === 0,
  { before: beforeEnable.stats, enabled: enabled.stats, requests: [beforeEnable.objects.shadowRequests, enabled.objects.shadowRequests] });
  await policy(page, presets.normal); const same = await snapshot(page);
  check('repeated identical realtime policy neither renders nor repeats shadow requests', equal(same.stats, enabled.stats)
    && same.objects.shadowRequests === enabled.objects.shadowRequests && equal(same.surfaces, enabled.surfaces), { enabled: enabled.stats, repeated: same.stats });
  await idleCheck(page, 'equal');
}

async function lifecycleScenario(page) {
  await policy(page, presets['no-shadows']); const before = await snapshot(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); window.shadingFixture.detached = c; c.remove();
  }); await settle(page);
  const stopped = await page.evaluate(() => { const c = window.shadingFixture.detached; return !c._view._raf && !c._trackingTimer && !c._securityLayer.moving; });
  check('disconnect ends rendering/motion/expiry work', stopped);
  await page.evaluate(() => document.querySelector('section.theme').append(window.shadingFixture.detached)); await settle(page); await ready(page);
  const reconnected = await snapshot(page);
  check('reconnect retains shadow-off, material textures and the same renderer/light pool', !reconnected.shadowEnabled && reconnected.pending.length === 0
    && reconnected.stats.shadow === before.stats.shadow && reconnected.stats.shadowLights === before.stats.shadowLights
    && reconnected.sameRenderer && equal(reconnected.surfaces, before.surfaces) && reconnected.pool.every((p, i) => p[0] === before.pool[i][0]), reconnected.stats);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view;
    window.shadingFixture.oldModel = v.model;
    window.shadingFixture.oldGlow = c._objects.objectAt('shading_lamp').part.glow.material;
    window.shadingFixture.glowDisposed = 0;
    window.shadingFixture.oldGlow.addEventListener('dispose', () => window.shadingFixture.glowDisposed++);
    c.setConfig({ ...c._config, model: '/demo/shading-fixture.glb?replacement=1' });
  });
  await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card'); return c._view.model && c._view.model !== window.shadingFixture.oldModel
      && c._objects.parts.has('shading_lamp') && !c._loading;
  }, { timeout: 30000 });
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    window.shadingFixture.leaf = c._view.model.manifest.objects.find((o) => o.id === 'shading_door').node.children.find((n) => (n.userData.name || n.name) === 'leaf');
    c._view.stopCameraMotion(); c._view.setCamera({ position: [5, 6, 8], target: [0, .4, 0] }, { instant: true });
  }); await ready(page); const replacement = await snapshot(page);
  check('actual GLB replacement keeps shadow-off and restores fresh AO/unlit assets without new lights', !replacement.shadowEnabled
    && !replacement.shadowPending && replacement.pending.length === 0 && replacement.stats.shadow === reconnected.stats.shadow
    && replacement.stats.shadowLights === reconnected.stats.shadowLights && replacement.sameRenderer
    && replacement.surfaces[0].channel === 1 && replacement.surfaces[2].type === 'MeshBasicMaterial'
    && replacement.pool.every((p, i) => p[0] === before.pool[i][0]) && await page.evaluate(() => window.shadingFixture.glowDisposed === 1), replacement.stats);
}

async function formState(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-model-rendering-editor]');
    const input = form?.querySelector('[data-field="model-rendering-preset"]');
    return { exists: !!form, value: input?.value, options: input ? [...input.options].map((o) => [o.value, o.textContent.trim()]) : [],
      report: form?.querySelector('[data-model-rendering-report]')?.textContent, rendering: c._layout.model_rendering,
      shadowEnabled: c._view.renderer.shadowMap.enabled, calls: window.shadingFixture.services.length, commits: window.shadingFixture.commits };
  });
}
async function readability(page) {
  return page.evaluate(() => {
    const form = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-model-rendering-editor]');
    const luminance = (colour) => {
      const channels = colour.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      return channels?.length === 3 ? channels.map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
        .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0) : NaN;
    };
    return [...form.querySelectorAll('button,select')].filter((el) => el.getClientRects().length && !el.matches(':disabled')).map((el) => {
      const css = getComputedStyle(el), a = luminance(css.color), b = luminance(css.backgroundColor);
      return { control: el.dataset.field || el.dataset.act, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
}

async function uiScenario(page, mode) {
  await policy(page, presets.normal);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.resetHistory(); window.shadingFixture.commits = 0; });
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="model"]');
  let f = await formState(page);
  check('Model editor offers explicit Normal / No realtime shadows / Authored shading choices and model evidence', f.exists
    && equal(f.options.filter(([key]) => key in { normal: 1, 'no-shadows': 1, authored: 1 }),
      [['normal', 'Normal'], ['no-shadows', 'No realtime shadows'], ['authored', 'Authored shading (lamps off)']])
    && f.report?.includes('Ambient occlusion (AO) textures: 1 materials') && f.report.includes('Unlit materials: 1')
    && f.report.includes('Light-map textures: 0 materials') && f.report.includes('uv1 (1 material uses)') && f.calls === 0, f);
  await selectPreset(page, 'no-shadows'); f = await formState(page);
  check('changing the native preset remains draft-only without rendering policy or service changes', equal(f.rendering, presets.normal)
    && f.shadowEnabled && f.value === 'no-shadows' && f.commits === 0 && f.calls === 0, f);
  await control(page, field, (element) => element.focus());
  await page.evaluate(() => { window.shadingFixture.focused = document.querySelector('taylors3d-card').shadowRoot.activeElement; });
  await patch(page, { 'sensor.shading_unrelated': { state: '100', attributes: { friendly_name: 'Known unrelated reading' } } });
  check('an unrelated HA reading preserves the exact focused unfinished preset', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector('[data-field="model-rendering-preset"]');
    return input === window.shadingFixture.focused && c.shadowRoot.activeElement === input && input.value === 'no-shadows';
  }));
  await click(page, '[data-act="model-rendering-cancel"]'); f = await formState(page);
  check('Cancel reloads current Normal settings without a commit or device action', f.value === 'normal' && equal(f.rendering, presets.normal) && f.commits === 0 && f.calls === 0, f);
  await selectPreset(page, 'no-shadows'); await click(page, '[data-act="model-rendering-save"]'); await ready(page); f = await formState(page);
  check('Save commits no-shadows exactly once with zero device actions', equal(f.rendering, presets['no-shadows']) && !f.shadowEnabled && f.commits === 1 && f.calls === 0, f);
  await click(page, '[data-act="history-undo"]'); f = await formState(page);
  check('one native Undo restores the previous Normal policy', equal(f.rendering, presets.normal) && f.shadowEnabled && f.calls === 0, f);
  await click(page, '[data-act="history-redo"]'); f = await formState(page);
  check('native Redo restores the exact no-shadow setting', equal(f.rendering, presets['no-shadows']) && !f.shadowEnabled && f.calls === 0, f);
  await selectPreset(page, 'authored'); await click(page, '[data-act="model-rendering-save"]'); await ready(page);
  const authored = await snapshot(page);
  const glow = await page.evaluate(() => document.querySelector('taylors3d-card')._objects.objectAt('shading_lamp').part.glow.material.emissiveIntensity);
  check('Authored shading disables realtime lamps and all shadows while retaining live bulb status', equal(authored.rendering, presets.authored)
    && !authored.shadowEnabled && authored.lit === 0 && !authored.groupVisible && authored.pending.length === 0 && glow > 0 && authored.calls === 0,
  { policy: authored.rendering, lit: authored.lit, visible: authored.groupVisible, glow });
  // A saved preset correctly disables its no-op Save. Use a deliberate draft to
  // measure all three enabled controls, then cancel without changing the policy.
  const savedForm = await formState(page);
  await selectPreset(page, 'normal');
  const expectedControls = ['model-rendering-cancel', 'model-rendering-preset', 'model-rendering-save'];
  const lightContrast = await readability(page);
  check('light-theme preset and enabled save/cancel controls have readable text contrast', equal(lightContrast.map((c) => c.control).sort(), expectedControls)
    && lightContrast.every((c) => c.ratio >= 4.5) && equal((await formState(page)).rendering, presets.authored), lightContrast);
  await screenshot(page, mode === 'source' ? 'shading-editor.png' : 'shading-editor-bundle.png');
  await page.setViewport({ width: 320, height: 1000, deviceScaleFactor: 1 }); await settle(page);
  const narrow = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-model-rendering-editor]');
    return { overflow: document.documentElement.scrollWidth > innerWidth, controls: [...form.querySelectorAll('button,select')]
      .filter((el) => el.getClientRects().length).map((el) => ({ control: el.dataset.field || el.dataset.act, height: el.getBoundingClientRect().height,
        width: el.getBoundingClientRect().width, inside: el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth + 1 })) };
  });
  check('320px Model presentation controls fit and preserve actual 44px touch targets', !narrow.overflow && narrow.controls.length >= 3
    && narrow.controls.every((el) => el.height >= 44 && el.inside), narrow);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), section = document.querySelector('section.theme'); section.classList.remove('light'); section.classList.add('dark');
    c.hass = { ...c._hass, themes: { darkMode: true } };
  }); await settle(page);
  const darkContrast = await readability(page);
  check('dark-theme enabled preset controls retain readable contrast and authored policy', equal(darkContrast.map((c) => c.control).sort(), expectedControls)
    && darkContrast.every((c) => c.ratio >= 4.5)
    && equal((await formState(page)).rendering, presets.authored), darkContrast);
  await screenshot(page, mode === 'source' ? 'shading-editor-narrow.png' : 'shading-editor-narrow-bundle.png', { fullPage: true });
  await click(page, '[data-act="model-rendering-cancel"]');
  const cancelledForm = await formState(page);
  check('Cancel after contrast checks restores saved authored choice without a commit or action', cancelledForm.value === 'authored'
    && equal(cancelledForm.rendering, presets.authored) && cancelledForm.commits === savedForm.commits && cancelledForm.calls === savedForm.calls, cancelledForm);
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 }); await settle(page); await click(page, 'button.edit'); await ready(page);
  await page.waitForFunction((mode) => {
    const stored = JSON.parse(localStorage.getItem(`taylors3d_shading-browser-${mode}`) || 'null');
    return stored?.model_rendering?.shadows === 'off' && stored.model_rendering.lamps === 'off';
  }, { timeout: 5000 }, mode);
  check('actual browser persistence stores the complete chosen presentation', (await snapshot(page)).backend === 'browser');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')?._objects?.parts.has('shading_lamp'), { timeout: 30000 });
  await prepare(page, mode, false); const restored = await snapshot(page);
  check('real document reload restores authored shading from saved layout with original AO/unlit assets', equal(restored.saved, presets.authored)
    && !restored.shadowEnabled && restored.lit === 0 && restored.pending.length === 0 && restored.contexts === 1
    && restored.surfaces[0].channel === 1 && restored.surfaces[2].type === 'MeshBasicMaterial' && restored.calls === 0, restored.rendering);
}

const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
for (const mode of modes) {
  label = `${mode}: `; context = 'fixture setup'; let session;
  try {
    session = await open(mode);
    check('loads only its selected source or bundled card implementation', mode === 'source'
      ? session.requests.includes('/src/taylors3d-card.js') && !session.requests.includes('/dist/taylors3d-card.js')
      : session.requests.includes('/dist/taylors3d-card.js') && !session.requests.some((url) => url.startsWith('/src/')));
    await pixelsScenario(session.page, mode); await lifecycleScenario(session.page); await uiScenario(session.page, mode);
  } catch (error) { check('shading scenario completes', false, error.stack || error.message); }
  finally {
    if (session) {
      const pending = [...session.pageErrors];
      errors.push(...session.errors.map((message) => { const i = pending.findIndex((entry) => entry.message === message); return i >= 0 ? pending.splice(i, 1)[0] : message; }));
      check('fixture restores the exact original scene render/frame callbacks', await restoreObservers(session.page));
      await session.close();
    }
  }
}
label = ''; check('no browser errors', errors.length === 0, errors);
if (checks.some((pass) => !pass)) process.exitCode = 1;
