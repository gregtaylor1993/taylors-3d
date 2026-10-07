import { revealEditorTab } from './lib/editor-tab-navigation.mjs';
// F11: actual pixels on an authored GLB floor AND wall, plus intentional HA controls.
// Each source/bundle scenario creates one card/renderer. No lights are injected into
// the scene: every fixture is a tagged GLB object using the existing fixed light pool.
// Run after building: node scripts/lighting-check.mjs [--source-only|--bundle-only].
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';

const checks = [], errors = [];
const pageErrorContexts = new WeakMap();
let label = '', activeContext = 'fixture setup';
const check = (name, pass, detail) => {
  checks.push(!!pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tolerance = 3) => a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
const luma = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
const delta = (a, b) => a.map((value, index) => value - b[index]);
const entity = 'light.lighting_probe';
const pointIds = Array.from({ length: 12 }, (_, index) => `lighting_point_${String(index + 1).padStart(2, '0')}`);
const spotIds = Array.from({ length: 6 }, (_, index) => `lighting_spot_${String(index + 1).padStart(2, '0')}`);
const rowSelector = `.taylors3d-device-popup .t3d-entity[data-entity="${entity}"]`;
const inputSelector = (kind) => `${rowSelector} [data-light-control="${kind}"]`;

// Reuse the repository's real exported mesh accessors/BIN chunk, while authoring a
// deliberately neutral, exposed lighting bench. The 4×4 m floor top is y=0; the
// north wall's inner face is z=-2. Only the normal object layer can light them.
function lightingGlb() {
  const original = fs.readFileSync(path.join(root, 'demo/house.glb'));
  const originalLength = original.readUInt32LE(12);
  const json = JSON.parse(original.toString('utf8', 20, 20 + originalLength));
  const sourceBox = json.nodes.find((node) => node.name === 'coffee_table_body').mesh;
  const sourceLamp = json.nodes.find((node) => node.name === 'lamp_living');
  const sourceGlow = json.nodes[sourceLamp.children.find((index) => json.nodes[index].name === 'glow')].mesh;
  const gray = json.materials.push({ name: 'lighting_neutral_standard',
    pbrMetallicRoughness: { baseColorFactor: [.32, .32, .32, 1], metallicFactor: 0, roughnessFactor: 1 }, emissiveFactor: [0, 0, 0] }) - 1;
  const bulb = json.materials.push({ name: 'lighting_bulb_standard',
    pbrMetallicRoughness: { baseColorFactor: [.9, .9, .9, 1], metallicFactor: 0, roughnessFactor: .8 }, emissiveFactor: [0, 0, 0] }) - 1;
  const mesh = (source, material, name) => json.meshes.push({ ...json.meshes[source], name,
    primitives: json.meshes[source].primitives.map((primitive) => ({ ...primitive, material })) }) - 1;
  const box = mesh(sourceBox, gray, 'lighting_box_mesh'), glowMesh = mesh(sourceGlow, bulb, 'lighting_glow_mesh');
  const node = (value) => json.nodes.push(value) - 1;
  const floor = node({ name: 'lighting_floor', mesh: box, translation: [0, -.05, 0], scale: [4 / 1.2, .1 / .45, 4 / .7] });
  const wall = node({ name: 'lighting_wall', mesh: box, translation: [0, 1.35, -2.06], scale: [4 / 1.2, 2.7 / .45, .12 / .7] });
  const lamp = (id, position, hints) => node({ name: id, translation: position,
    children: [node({ name: `${id}_glow`, mesh: glowMesh })], extras: { fp: {
      kind: 'object', id, type: 'light', label: id === 'lighting_probe' ? 'Lighting test lamp' : id,
      glow: `${id}_glow`, hints, suggest: { entity: `light.${id}` },
    } } });
  const probe = lamp('lighting_probe', [0, 2.2, 0], { beam: 'point', max: 20, distance: 8, decay: 2 });
  const points = pointIds.map((id, index) => lamp(id, [8 + index * .25, 2.2, 0],
    { beam: 'point', max: index === 0 ? 1000 : 20 + index, distance: 1, decay: 2 }));
  const spots = spotIds.map((id, index) => lamp(id, [8 + index * .25, 2.2, -1],
    { beam: 'spot', max: index === 0 ? 1000 : 15 + index, distance: 1, decay: 2, target: [8 + index * .25, 0, -1] }));
  const room = node({ name: 'lighting_room', children: [floor, wall, probe], extras: { fp: {
    kind: 'room', id: 'lighting_room', outline: [[-2, -2], [2, -2], [2, 2], [-2, 2]], suggest: { area: 'living_room' },
  } } });
  const ground = node({ name: 'lighting_ground', children: [room, ...points, ...spots], extras: { fp: {
    kind: 'level', id: 'ground', role: 'storey', order: 0, elevation: 0, height: 2.7,
  } } });
  const upperSlab = node({ name: 'lighting_upper_floor', mesh: box, translation: [0, 2.95, 0], scale: [4 / 1.2, .1 / .45, 4 / .7] });
  const first = node({ name: 'lighting_first', children: [upperSlab], extras: { fp: {
    kind: 'level', id: 'first', role: 'storey', order: 1, elevation: 3, height: 2.7,
  } } });
  const house = node({ name: 'lighting_bench', children: [ground, first], extras: { fp: { views: [
    { id: 'ground', label: 'Lighting bench', show: ['level:ground'], hide: ['level:first'] },
    { id: 'first', label: 'Upper test floor', show: ['level:first'], hide: ['level:ground'] },
  ] } } });
  json.scenes = [{ nodes: [house] }]; json.scene = 0;
  const text = Buffer.from(JSON.stringify(json));
  const padding = Buffer.alloc((4 - text.length % 4) % 4, 0x20), rest = original.subarray(20 + originalLength), head = Buffer.alloc(20);
  head.write('glTF'); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + padding.length + rest.length, 8);
  head.writeUInt32LE(text.length + padding.length, 12); head.write('JSON', 16);
  return Buffer.concat([head, text, padding, rest]);
}

function light(state = 'on', attributes = {}) {
  return { entity_id: entity, state, attributes: { friendly_name: 'Lighting test lamp',
    supported_color_modes: ['rgb', 'color_temp'], color_mode: 'rgb', brightness: 255,
    rgb_color: [255, 255, 255], min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, ...attributes } };
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function ready(page) {
  await page.waitForFunction(() => {
    const v = document.querySelector('taylors3d-card')._view, now = performance.now();
    if (v.dirty || v._tween || v._occFull || v._occTimer || v._modelMotionMoving || now - (v._camMovedAt || 0) < 350) {
      window.lightingIdle = null; return false;
    }
    if (!window.lightingIdle || ['frames', 'shadow', 'shadowLights'].some((key) => window.lightingIdle[key] !== v.stats[key])) {
      window.lightingIdle = { ...v.stats, at: now }; return false;
    }
    return now - window.lightingIdle.at > 350;
  }, { timeout: 15000 });
}
async function patch(page, states, extra = {}) {
  activeContext = `HA update: ${Object.keys(states).join(', ') || Object.keys(extra).join(', ')}`;
  await page.evaluate(({ states, extra }) => {
    const c = document.querySelector('taylors3d-card');
    c.hass = { ...c._hass, ...extra, states: { ...c._hass.states, ...states } };
  }, { states, extra });
  await settle(page);
}
async function lampState(page, state) { await patch(page, { [entity]: state }); }
async function control(page, selector, action) {
  await revealEditorTab(page, selector);
  activeContext = `control: ${selector}`;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const el = handle.asElement(); if (!el) throw new Error('Missing light control: ' + selector);
    await el.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await action(el);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (el) => el.click());
async function openPopup(page) {
  await page.evaluate(() => document.querySelector('taylors3d-card')._runObjectAction('lighting_probe', 'tap'));
  await page.waitForFunction((selector) => !!document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), {}, rowSelector);
  await settle(page);
}
async function calls(page) { return page.evaluate(() => window.lightingFixture.services); }
async function screenshot(page, name) {
  const directory = path.join(root, 'screenshots'); fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name) });
}
async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, layer = c._objects;
    const part = layer.objectAt('lighting_probe'), glow = part?.part.glow;
    const material = Array.isArray(glow?.material) ? glow.material[0] : glow?.material;
    const pool = [...layer.pool.points, ...layer.pool.spots];
    return { pixels: window.lightingFixture.capture, stats: { ...v.stats }, objects: { ...layer.stats },
      programs: v.renderer.info.programs.map((program) => program.id), memory: { ...v.renderer.info.memory },
      pool: pool.map((light) => light.uuid), lit: pool.filter((light) => light.intensity > 0).length,
      points: layer.pool.points.filter((light) => light.intensity > 0).length,
      spots: layer.pool.spots.filter((light) => light.intensity > 0).length,
      shadows: pool.filter((light) => light.intensity > 0 && light.castShadow && (light.shadow?.intensity ?? 1) > 0).length,
      slots: [...layer._slots].map(([id, slot]) => [id, slot.light.uuid, slot.shadow]),
      result: part?.part.appearance || part?.result,
      glow: material ? { uuid: material.uuid, version: material.version, intensity: material.emissiveIntensity, color: material.emissive.toArray() } : null,
      sameRenderer: v.renderer === window.lightingFixture.renderer, calls: window.lightingFixture.services.length,
      canvas: document.querySelectorAll('taylors3d-card').length,
    };
  });
}

async function open(mode) {
  const transport = await launch();
  try {
    const context = await newPage(transport.browser, { width: 1280, height: 1000 });
    const { page } = context, requests = [], fixture = lightingGlb(), pageErrorDetails = [];
    pageErrorContexts.set(page, pageErrorDetails);
    page.on('pageerror', (error) => pageErrorDetails.push({ message: error.message, stack: error.stack,
      context: `${label}${activeContext}`, url: page.url() }));
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
      .replace(/<section class="theme dark">[\s\S]*?<\/section>/, '')
      .replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
    if (mode === 'source') {
      const map = JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } });
      html = html.replace('</head>', `<script type="importmap">${map}</script></head>`)
        .replace('src="../dist/taylors3d-card.js"', 'src="../src/taylors3d-card.js"');
    }
    await page.evaluateOnNewDocument(() => {
      window.__demoMowerPaused = true; window.__demoNow = Date.UTC(2026, 9, 5, 12);
      window.lightingContexts = new Set(); const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        const context = original.call(this, kind, ...args);
        if (context && /^webgl/.test(kind)) window.lightingContexts.add(this);
        return context;
      };
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
      else if (url.pathname === '/demo/lighting-fixture.glb') request.respond({ status: 200, contentType: 'model/gltf-binary', body: fixture });
      else request.continue();
    });
    await page.goto(`${transport.base}/demo/index.html?model=/demo/lighting-fixture.glb&merge=0&floor=ground&view=3d&height=700px`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('taylors3d-card')?._objects?.parts.has('lighting_probe'), { timeout: 30000 });
    await page.evaluate(async ({ entity, pointIds, spotIds, state }) => {
      const c = document.querySelector('taylors3d-card');
      c.setConfig({ ...c._config, layout_key: 'lighting-browser-fixture', height: '700px', merge: false, model_opacity: 1,
        control_panel: 'right', device_tap_action: 'popup', sky_bodies: false });
      await c._layoutReady;
      const states = { [entity]: state, 'sensor.lighting_unrelated': { state: '0', attributes: { friendly_name: 'Unrelated fixture reading' } } };
      for (const id of [...pointIds, ...spotIds]) states[`light.${id}`] = { ...state, entity_id: `light.${id}`, attributes: { ...state.attributes, friendly_name: id } };
      window.lightingFixture = { services: [], renderer: c._view.renderer, capture: null, info: [] };
      c.hass = { ...c._hass, services: { light: { turn_on: {}, turn_off: {}, toggle: {} } }, states,
        callService: (...args) => { window.lightingFixture.services.push(args); return Promise.resolve(); } };
      c._commit({ ...c._layout, rooms: [], pins: {}, hidden: [], mower: {}, objects: {}, groups: {}, model: {}, views: {},
        room_overlays: { mode: 'off' }, alert_bindings: [], security_bindings: [], weather: { enabled: false },
        presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [], camera_coverage: { enabled: false } });
      c._skyMode = 'night'; c._applySky(true); c._view.stopCameraMotion();
      c._view.setCamera({ position: [6, 5, 7], target: [0, 1, 0] }, { instant: true });
      c.resetHistory();
      const v = c._view, previous = v.onRender;
      window.lightingFixture.previousRender = previous;
      v.onRender = () => {
        previous?.();
        const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        const probes = { floor: [.6, .01, .2], wall: [.6, 1, -1.999] }, capture = { frame: v.stats.frames };
        for (const [name, position] of Object.entries(probes)) {
          const world = v.camera.position.clone().set(...position), p = world.clone().project(v.camera);
          const screen = v.projectWorld(world), hit = screen && v._modelHit(screen[0], screen[1]);
          const x = Math.round((p.x + 1) * width / 2), y = Math.round((p.y + 1) * height / 2);
          const valid = Number.isFinite(x) && Number.isFinite(y) && x >= 3 && y >= 3 && x < width - 3 && y < height - 3
            && p.z > -1 && p.z < 1 && hit?.object.name === `lighting_${name}`;
          const rgba = new Uint8Array(7 * 7 * 4); if (valid) gl.readPixels(x - 3, y - 3, 7, 7, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          const mean = [0, 1, 2].map((channel) => {
            const values = []; for (let index = channel; index < rgba.length; index += 4) values.push(rgba[index]);
            values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)];
          });
          capture[name] = { rgb: mean, valid, name: hit?.object.name, point: position, size: [width, height] };
        }
        window.lightingFixture.capture = capture;
      };
      v.markDirty();
      window.addEventListener('hass-more-info', (event) => window.lightingFixture.info.push(event.detail.entityId));
    }, { entity, pointIds, spotIds, state: light('off') });
    await page.evaluate((mode) => { document.querySelector('section.theme h2').textContent = `Simulated lighting bench · ${mode}`; }, mode);
    await ready(page);
    // The layout-key rebuild can choose its initial camera asynchronously. Set the
    // deliberate probe camera only after that real structure/load work has settled.
    await page.evaluate(() => {
      const v = document.querySelector('taylors3d-card')._view; v.stopCameraMotion();
      v.setCamera({ position: [6, 5, 7], target: [0, 1, 0] }, { instant: true });
    });
    await ready(page);
    return { ...transport, ...context, requests, pageErrorDetails };
  } catch (error) { await transport.close(); throw error; }
}

async function idleCheck(page, kind) {
  await ready(page); const before = await snapshot(page);
  await page.evaluate(async ({ kind }) => {
    const c = document.querySelector('taylors3d-card');
    for (let index = 0; index < 10; index++) {
      const states = { ...c._hass.states };
      if (kind === 'equal') for (const id of Object.keys(states)) { if (id.startsWith('light.')) states[id] = structuredClone(states[id]); }
      else states['sensor.lighting_unrelated'] = { ...states['sensor.lighting_unrelated'], state: String(index + 1) };
      c.hass = { ...c._hass, states }; await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }, { kind });
  const after = await snapshot(page);
  const keys = ['frames', 'shadow', 'shadowLights'];
  check(`${kind === 'equal' ? 'equal fresh light snapshots' : 'unrelated existing readings'} stay strictly idle without GPU/resource/shadow changes`,
    keys.every((key) => before.stats[key] === after.stats[key]) && equal(before.memory, after.memory)
      && equal(before.programs, after.programs) && equal(before.pool, after.pool) && equal(before.slots, after.slots)
      && equal(before.glow, after.glow) && before.objects.budget === after.objects.budget && after.sameRenderer,
    { before: before.stats, after: after.stats, memory: after.memory, budget: [before.objects.budget, after.objects.budget] });
}

async function pixelsScenario(page, mode) {
  let s = await snapshot(page); const off = s.pixels;
  check('single renderer samples exposed neutral standard-material GLB floor and wall', s.canvas === 1 && s.sameRenderer
    && await page.evaluate(() => window.lightingContexts.size === 1)
    && off.floor.valid && off.wall.valid && s.lit === 0, off);
  await lampState(page, light('on', { rgb_color: [255, 0, 0] })); await ready(page); s = await snapshot(page); const red = s.pixels;
  check('actual red HA light reaches BOTH floor and wall pixels', ['floor', 'wall'].every((name) => {
    const d = delta(red[name].rgb, off[name].rgb); return red[name].valid && d[0] > 20 && d[0] > d[2] + 12 && d[0] > d[1] + 12;
  }), { off, red });
  await screenshot(page, `lighting-red-${mode}.png`);
  const fixed = s;
  await lampState(page, light('on', { rgb_color: [0, 0, 255] })); await ready(page); s = await snapshot(page); const blue = s.pixels;
  check('actual blue HA light reaches BOTH floor and wall pixels', ['floor', 'wall'].every((name) => {
    const d = delta(blue[name].rgb, off[name].rgb); return blue[name].valid && d[2] > 20 && d[2] > d[0] + 12 && d[2] > d[1] + 12;
  }), { off, blue });
  await screenshot(page, `lighting-blue-${mode}.png`);
  check('actual colour changes reuse shaders, materials, pool and shadows', equal(fixed.pool, s.pool) && equal(fixed.memory, s.memory)
    && equal(fixed.programs, s.programs) && fixed.glow.uuid === s.glow.uuid && fixed.glow.version === s.glow.version
    && fixed.stats.shadow === s.stats.shadow && fixed.stats.shadowLights === s.stats.shadowLights && fixed.objects.budget === s.objects.budget);
  const warmState = light('on', { color_mode: 'color_temp', color_temp_kelvin: 2200 }); delete warmState.attributes.rgb_color;
  await lampState(page, warmState); await ready(page); const warm = (await snapshot(page)).pixels;
  const coldState = light('on', { color_mode: 'color_temp', color_temp_kelvin: 6500 }); delete coldState.attributes.rgb_color;
  await lampState(page, coldState); await ready(page); const cold = (await snapshot(page)).pixels;
  check('reported warm/cool kelvin changes real reflected light on BOTH surfaces', ['floor', 'wall'].every((name) =>
    warm[name].valid && cold[name].valid && (warm[name].rgb[0] + 1) / (warm[name].rgb[2] + 1) > (cold[name].rgb[0] + 1) / (cold[name].rgb[2] + 1) + .15
    && cold[name].rgb[2] > warm[name].rgb[2] + 12), { warm, cold });
  await lampState(page, light('on', { brightness: 51 })); await ready(page); const dim = (await snapshot(page)).pixels;
  await lampState(page, light('on')); await ready(page); const full = (await snapshot(page)).pixels;
  check('reported brightness 51→255 brightens BOTH actual standard-material surfaces', ['floor', 'wall'].every((name) =>
    luma(full[name].rgb) > luma(dim[name].rgb) + 8 && luma(dim[name].rgb) > luma(off[name].rgb) + 8), { off, dim, full });
  for (const [name, state] of [['off', light('off')], ['zero brightness', light('on', { brightness: 0 })],
    ['black RGB', light('on', { rgb_color: [0, 0, 0] })], ['unavailable', light('unavailable')],
    ['restored', light('on', { restored: true })], ['malformed active colour', light('on', { rgb_color: [255, '0', 0] })]]) {
    await lampState(page, state); await ready(page); s = await snapshot(page);
    check(`${name} removes real illumination without retaining a stale lamp glow`, s.lit === 0 && s.glow.intensity === 0
      && ['floor', 'wall'].every((surface) => near(s.pixels[surface].rgb, off[surface].rgb)), { pixels: s.pixels, lit: s.lit, glow: s.glow.intensity });
  }
  await lampState(page, light('on', { rgb_color: [255, 0, 0] })); await ready(page);
  await idleCheck(page, 'equal'); await idleCheck(page, 'unrelated');
}

async function uiScenario(page, mode) {
  await lampState(page, light('on', { rgb_color: [0, 0, 255], brightness: 128 })); await openPopup(page);
  await screenshot(page, mode === 'source' ? 'lighting-colour.png' : 'lighting-colour-bundle.png');
  let before = (await calls(page)).length;
  await click(page, `${rowSelector} [data-action="color-swatch"][data-color-name="Red"]`);
  let after = await calls(page);
  check('real Red swatch click sends exactly one intentional RGB service payload', after.length === before + 1
    && equal(after.at(-1), ['light', 'turn_on', { entity_id: entity, rgb_color: [255, 59, 48] }]), after.at(-1));
  check('a command does not pretend HA already changed its reported colour', await page.evaluate((selector) => {
    const c = document.querySelector('taylors3d-card'); return c._hass.states['light.lighting_probe'].attributes.rgb_color.join() === '0,0,255'
      && c.shadowRoot.querySelector(selector).textContent.includes('#0000ff');
  }, `${rowSelector} .t3d-light-reading`));
  // Headless Chrome cannot drive the OS colour-picker dialog. This explicitly
  // verifies native input/change events, without claiming an OS picker was used.
  before = after.length;
  await control(page, inputSelector('color'), (el) => el.evaluate((input) => { input.focus(); input.value = '#123456'; input.dispatchEvent(new Event('input', { bubbles: true })); }));
  check('native colour input event keeps the choice local without a service', (await calls(page)).length === before);
  await control(page, inputSelector('color'), (el) => el.evaluate((input) => input.dispatchEvent(new Event('change', { bubbles: true }))));
  after = await calls(page);
  check('native colour change event submits the exact selected RGB once', after.length === before + 1
    && equal(after.at(-1), ['light', 'turn_on', { entity_id: entity, rgb_color: [18, 52, 86] }]), after.at(-1));
  before = after.length;
  await control(page, inputSelector('kelvin'), async (el) => { await el.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); });
  after = await calls(page);
  check('real Kelvin keyboard action sends exactly its chosen2001K within actual HA-reported bounds', after.length === before + 1
    && equal(after.at(-1), ['light', 'turn_on', { entity_id: entity, color_temp_kelvin: 2001 }]), after.slice(before));
  before = after.length;
  await control(page, inputSelector('brightness'), async (el) => { await el.focus(); await page.keyboard.press('End'); });
  after = await calls(page);
  check('real brightness keyboard action sends reported-scale brightness255 once', after.length === before + 1
    && equal(after.at(-1), ['light', 'turn_on', { entity_id: entity, brightness: 255 }]), after.at(-1));
  before = after.length;
  await control(page, inputSelector('brightness'), async (el) => { await el.focus(); await page.keyboard.press('Home'); });
  after = await calls(page);
  check('real zero-brightness keyboard action deliberately sends turn_off once', after.length === before + 1
    && equal(after.at(-1), ['light', 'turn_off', { entity_id: entity }]), after.at(-1));
  before = after.length;
  await control(page, inputSelector('color'), (el) => el.evaluate((input) => {
    window.lightingFixture.focusedColor = input; input.focus(); input.value = '#abcdef'; input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  await patch(page, { 'sensor.lighting_unrelated': { state: '100', attributes: { friendly_name: 'Unrelated fixture reading' } } });
  check('live HA readings preserve the exact focused unfinished colour choice without submitting it', await page.evaluate((selector) => {
    const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector(selector);
    return input === window.lightingFixture.focusedColor && c.shadowRoot.activeElement === input && input.value === '#abcdef';
  }, inputSelector('color')) && (await calls(page)).length === before);
  await control(page, inputSelector('kelvin'), (el) => el.evaluate((input) => {
    window.lightingFixture.oldKelvin = input; input.focus(); input.value = '5000'; input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  await lampState(page, light('on', { rgb_color: [0, 0, 255], brightness: 128, max_color_temp_kelvin: 3000 }));
  await page.evaluate(() => window.lightingFixture.oldKelvin.dispatchEvent(new Event('change', { bubbles: true })));
  check('live Kelvin-bound revocation rejects an unfinished command from the old range', (await calls(page)).length === before
    && await page.evaluate((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector).max === '3000', inputSelector('kelvin')));
  await control(page, inputSelector('kelvin'), async (el) => { await el.focus(); await page.keyboard.press('End'); });
  after = await calls(page);
  check('a deliberate current-range keyboard action sends exactly the new maximum3000K', after.length === before + 1
    && equal(after.at(-1), ['light', 'turn_on', { entity_id: entity, color_temp_kelvin: 3000 }]), after.at(-1));
  before = after.length;
  await lampState(page, light('on', { rgb_color: [0, 0, 255], brightness: 128 }));
  const capabilityErrorCount = pageErrorContexts.get(page).length;
  await control(page, inputSelector('color'), (el) => el.evaluate((input) => {
    window.lightingFixture.revokedColor = input; input.focus(); input.value = '#ff0000'; input.dispatchEvent(new Event('input', { bubbles: true }));
    window.lightingFixture.capabilityWasFocused = input.getRootNode().activeElement === input;
  }));
  const dimmerOnly = light('on', { supported_color_modes: ['brightness'], color_mode: 'brightness', brightness: 128 });
  delete dimmerOnly.attributes.rgb_color;
  await lampState(page, dimmerOnly);
  await page.evaluate(() => window.lightingFixture.revokedColor.dispatchEvent(new Event('change', { bubbles: true })));
  check('revoking RGB capability removes its controls and ignores their detached old events', (await calls(page)).length === before
    && await page.evaluate((selector) => !document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), inputSelector('color')));
  check('actual focused RGB capability revocation replaces controls without a browser exception', pageErrorContexts.get(page).length === capabilityErrorCount
    && await page.evaluate((selector) => window.lightingFixture.capabilityWasFocused
      && !!document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), inputSelector('brightness')),
  pageErrorContexts.get(page).slice(capabilityErrorCount));
  for (const [name, state] of [['unavailable', light('unavailable')], ['unknown', light('unknown')], ['restored', light('on', { restored: true })]]) {
    await lampState(page, light('on')); await openPopup(page);
    await control(page, inputSelector('color'), (el) => el.evaluate((input) => {
      window.lightingFixture.revokedColor = input; input.value = '#ff0000'; input.dispatchEvent(new Event('input', { bubbles: true }));
    }));
    await lampState(page, state);
    await page.evaluate(() => window.lightingFixture.revokedColor.dispatchEvent(new Event('change', { bubbles: true })));
    check(`${name} actual HA evidence revokes pending light commands`, (await calls(page)).length === before);
  }
  await lampState(page, light('on')); await openPopup(page);
  await control(page, inputSelector('color'), (el) => el.evaluate((input) => {
    window.lightingFixture.revokedColor = input; input.focus(); input.value = '#ff0000'; input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  await patch(page, {}, { connected: false });
  await page.evaluate(() => window.lightingFixture.revokedColor.dispatchEvent(new Event('change', { bubbles: true })));
  await patch(page, {}, { connected: true });
  await page.evaluate(() => window.lightingFixture.revokedColor.dispatchEvent(new Event('change', { bubbles: true })));
  check('connection loss cancels an unfinished colour command through recovery', (await calls(page)).length === before);
  await control(page, inputSelector('color'), (el) => el.evaluate((input) => {
    input.value = '#001122'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }));
  after = await calls(page);
  check('a fresh deliberate choice after recovery can submit its exact RGB again', after.length === before + 1
    && equal(after.at(-1), ['light', 'turn_on', { entity_id: entity, rgb_color: [0, 17, 34] }]), after.at(-1));
  before = after.length;
  await lampState(page, light('on')); await openPopup(page);
  await control(page, inputSelector('color'), (el) => el.evaluate((input) => { window.lightingFixture.revokedColor = input; }));
  await page.evaluate(({ entity }) => {
    const c = document.querySelector('taylors3d-card'), states = { ...c._hass.states }; delete states[entity]; c.hass = { ...c._hass, states };
  }, { entity }); await settle(page);
  await page.evaluate(() => window.lightingFixture.revokedColor.dispatchEvent(new Event('change', { bubbles: true })));
  check('removing the selected source rejects detached commands without inventing a replacement', (await calls(page)).length === before);
  await lampState(page, light('on')); await openPopup(page);
  await click(page, `${rowSelector} [data-action="more-info"]`);
  check('All controls opens actual HA more-info rather than a light service', await page.evaluate((entity) => window.lightingFixture.info.at(-1) === entity, entity)
    && (await calls(page)).length === before);
  await page.keyboard.press('Escape');
}

async function visibilityScenario(page) {
  await lampState(page, light('off')); await ready(page); const off = await snapshot(page);
  await lampState(page, light('on')); await ready(page); const initial = await snapshot(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, lights: 'off' });
  }); await ready(page); let s = await snapshot(page);
  check('Model lamps off removes real floor/wall illumination while an actual on bulb still glows', s.lit === 0 && s.glow.intensity > 0
    && equal(initial.pool, s.pool) && ['floor', 'wall'].every((name) => near(off.pixels[name].rgb, s.pixels[name].rgb)), { pixels: s.pixels, lit: s.lit, glow: s.glow.intensity });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, lights: 'auto' }); });
  await ready(page); s = await snapshot(page);
  check('restoring Model lamps auto reuses the same fixed pool and real illumination', s.lit === 1 && equal(initial.pool, s.pool)
    && ['floor', 'wall'].every((name) => near(initial.pixels[name].rgb, s.pixels[name].rgb)));
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._commit({ ...c._layout, objects: { lighting_probe: { entity: 'light.lighting_probe', hidden: true } } });
  }); await ready(page); s = await snapshot(page);
  check('an explicitly hidden fixture contributes no real light or authored bulb glow', s.lit === 0 && s.glow.intensity === 0
    && ['floor', 'wall'].every((name) => near(off.pixels[name].rgb, s.pixels[name].rgb)));
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._commit({ ...c._layout, objects: {} });
  }); await ready(page);
  await click(page, '.chip[data-view="first"]'); await ready(page); s = await snapshot(page);
  check('an actual view hiding the fixture floor releases every pooled light', s.lit === 0 && equal(initial.pool, s.pool));
  await click(page, '.chip[data-view="ground"]'); await ready(page); s = await snapshot(page);
  check('returning to the fixture floor restores the source using the same pool', s.lit === 1 && equal(initial.pool, s.pool));
}

async function budgetScenario(page) {
  const states = { [entity]: light('on') };
  for (const [index, id] of [...pointIds, ...spotIds].entries()) {
    const local = index < pointIds.length ? index : index - pointIds.length;
    states[`light.${id}`] = { ...light('on', { brightness: local === 0 ? 1 : 255 }), entity_id: `light.${id}`,
      attributes: { ...light('on', { brightness: local === 0 ? 1 : 255 }).attributes, friendly_name: id } };
  }
  await patch(page, states); await ready(page); const initial = await snapshot(page);
  const ids = initial.slots.map(([id]) => id);
  check('nineteen current fixtures obey eight point/four spot/four shadow caps in the existing renderer', initial.points === 8
    && initial.spots === 4 && initial.lit === 12 && initial.shadows <= 4 && initial.pool.length === 12 && initial.sameRenderer, { slots: ids, lit: initial.lit, shadows: initial.shadows });
  check('CURRENT emitted output wins over a large configured maximum on dim fixtures', !ids.includes(pointIds[0]) && !ids.includes(spotIds[0])
    && pointIds.slice(4).every((id) => ids.includes(id)) && spotIds.slice(2).every((id) => ids.includes(id)), ids);
  const raised = {};
  for (const id of [pointIds[0], spotIds[0]]) raised[`light.${id}`] = { ...states[`light.${id}`], attributes: { ...states[`light.${id}`].attributes, brightness: 255 } };
  await patch(page, raised); await ready(page); const next = await snapshot(page), nextSlots = new Map(next.slots);
  const nextRoles = new Map(next.slots.map(([id, , shadow]) => [id, shadow]));
  check('actual brightness can change winners while compatible surviving slots remain stable', nextSlots.has(pointIds[0]) && nextSlots.has(spotIds[0])
    && !nextSlots.has(pointIds[4]) && !nextSlots.has(spotIds[2]) && equal(initial.pool, next.pool)
    // Strongest-four shadow roles can change; a role change needs a compatible slot.
    && initial.slots.filter(([id, , shadow]) => nextSlots.has(id) && nextRoles.get(id) === shadow)
      .every(([id, uuid]) => nextSlots.get(id) === uuid), next.slots);
  const dimmed = states[`light.${pointIds.at(-1)}`];
  await patch(page, { [`light.${pointIds.at(-1)}`]: { ...dimmed, attributes: { ...dimmed.attributes, brightness: 1 } } });
  await ready(page); const low = await snapshot(page), lowIds = low.slots.map(([id]) => id);
  check('lower actual output yields its slot to the next currently brighter fixture', !lowIds.includes(pointIds.at(-1))
    && lowIds.includes(pointIds[4]) && low.lit === 12 && equal(initial.pool, low.pool), lowIds);
  await idleCheck(page, 'equal'); await idleCheck(page, 'unrelated');
  const dark = {};
  for (const id of [...pointIds, ...spotIds]) dark[`light.${id}`] = { ...states[`light.${id}`], state: 'off' };
  await patch(page, dark); await lampState(page, light('on')); await ready(page);
}

async function lifecycleScenario(page) {
  await ready(page); const before = await snapshot(page);
  const detached = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'); window.lightingFixture.detached = c; c.remove();
    const frames = c._view.stats.frames;
    c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.lighting_unrelated': { state: '200', attributes: { friendly_name: 'Unrelated fixture reading' } } } };
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { frames: [frames, c._view.stats.frames], raf: !!c._view._raf,
      pool: [...c._objects.pool.points, ...c._objects.pool.spots].map((light) => light.uuid), calls: window.lightingFixture.services.length };
  });
  check('disconnect stops rendering without allocating/replacing lights or sending a command', detached.frames[0] === detached.frames[1]
    && !detached.raf && equal(before.pool, detached.pool) && detached.calls === before.calls, detached);
  await page.evaluate(() => document.querySelector('section.theme').append(window.lightingFixture.detached));
  await ready(page); const after = await snapshot(page);
  check('reconnect resumes the real source with the same renderer, materials and fixed pool', after.sameRenderer
    && after.lit === 1 && equal(before.pool, after.pool) && before.glow.uuid === after.glow.uuid && after.calls === before.calls);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), glow = c._objects.objectAt('lighting_probe').part.glow;
    window.lightingFixture.oldGlow = glow; window.lightingFixture.oldClone = glow.material; window.lightingFixture.cloneDisposals = 0;
    const dispose = glow.material.dispose.bind(glow.material);
    glow.material.dispose = () => { window.lightingFixture.cloneDisposals++; return dispose(); };
    c.setConfig({ ...c._config, model: null });
  });
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._view.model);
  await settle(page);
  check('model removal restores authored materials and releases the owned glow clone exactly once', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.lightingFixture;
    return c._objects.parts.size === 0 && f.oldGlow.material !== f.oldClone && f.cloneDisposals === 1
      && [...c._objects.pool.points, ...c._objects.pool.spots].every((light) => light.intensity === 0);
  }));
}

async function drawnPlanScenario(page) {
  const xy = light('on', { supported_color_modes: ['xy'], color_mode: 'xy', xy_color: [.2, .3], rgb_color: [30, 120, 250], brightness: 128 });
  await lampState(page, xy);
  await page.evaluate(({ entity }) => {
    const c = document.querySelector('taylors3d-card');
    c.hass = { ...c._hass, entities: { ...c._hass.entities, [entity]: { entity_id: entity, area_id: 'living_room' } } };
    c._commit({ ...c._layout,
      rooms: [{ id: 'lighting_drawn_room', area_id: 'living_room', floor_id: 'ground', polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]] }],
      pins: { [`entity:${entity}`]: { x: .6, y: .2, z: 2.2, floor_id: 'ground' } } });
    c._setFloor('ground'); c._setMode('top');
  }, { entity });
  await ready(page);
  const plan = () => page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, g = v.glows.get('entity:light.lighting_probe');
    const marker = c._markerEls.get('entity:light.lighting_probe');
    return { color: g?.mesh.material.color.getHexString(), material: g?.mesh.material.uuid, geometry: g?.mesh.geometry.uuid,
      css: marker?.style.getPropertyValue('--fp-light'), title: marker?.title, visible: g?.mesh.visible,
      active: !!marker?.classList.contains('active'),
      aria: marker?.getAttribute('aria-label'), sameMarker: !window.lightingFixture.planMarker || marker === window.lightingFixture.planMarker,
      stats: { frames: v.stats.frames, shadow: v.stats.shadow, shadowLights: v.stats.shadowLights }, memory: { ...v.renderer.info.memory },
      programs: v.renderer.info.programs.map((program) => program.id), contexts: window.lightingContexts.size,
      sameRenderer: v.renderer === window.lightingFixture.renderer };
  });
  let s = await plan();
  check('same renderer draws an XY light using the actual HA-derived RGB and matching marker colour', s.color === '1e78fa'
    && s.css === 'rgb(30,120,250)' && s.visible && s.active && s.contexts === 1 && s.sameRenderer, s);
  const kelvin = light('on', { color_mode: 'color_temp', color_temp_kelvin: 3000, brightness: 128 }); delete kelvin.attributes.rgb_color;
  const existing = s;
  await lampState(page, kelvin); await ready(page); s = await plan();
  check('drawn-plan Kelvin uses the same converted RGB and reuses its blob material/geometry', s.color === 'ffb16e'
    && s.css === 'rgb(255,177,110)' && s.active && s.material === existing.material && s.geometry === existing.geometry, s);
  const before = s;
  for (let index = 0; index < 10; index++) { await lampState(page, structuredClone(kelvin)); }
  await ready(page); s = await plan();
  check('equal fresh drawn-plan light states stay idle and keep material/geometry/shaders', equal(before.stats, s.stats)
    && before.material === s.material && before.geometry === s.geometry && equal(before.memory, s.memory) && equal(before.programs, s.programs), { before, after: s });
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card');
    window.lightingFixture.planMarker = c._markerEls.get('entity:light.lighting_probe');
    window.lightingFixture.namePanelWasClosed = !c._devicePopup.isOpen;
  });
  const renamed = structuredClone(kelvin); renamed.attributes.friendly_name = 'Renamed lighting test lamp';
  const prior = s; await lampState(page, renamed); await ready(page); s = await plan();
  check('a name-only HA update refreshes accessible metadata while the same light appearance stays idle', equal(prior.stats, s.stats)
    && prior.material === s.material && prior.geometry === s.geometry && s.sameMarker
    && s.title.includes('Renamed lighting test lamp') && s.aria.includes('Renamed lighting test lamp')
    && await page.evaluate(() => window.lightingFixture.namePanelWasClosed), { before: prior, after: s });
  const services = (await calls(page)).length;
  const markerHandle = await page.evaluateHandle(() => document.querySelector('taylors3d-card')._markerEls.get('entity:light.lighting_probe'));
  try { await markerHandle.asElement().click(); } finally { await markerHandle.dispose(); }
  await settle(page);
  check('real retained-marker click opens the updated name and actual supported light controls', await page.evaluate((selector) => {
    const c = document.querySelector('taylors3d-card'), popup = c.shadowRoot.querySelector('.taylors3d-device-popup');
    return popup?.querySelector('h3').textContent === 'Renamed lighting test lamp'
      && !!c.shadowRoot.querySelector(selector);
  }, inputSelector('kelvin')) && (await calls(page)).length === services);
  await page.keyboard.press('Escape');
  for (const [name, state] of [['zero brightness', light('on', { brightness: 0 })], ['restored', light('on', { restored: true })],
    ['invalid active RGB', light('on', { rgb_color: [255, null, 0] })]]) {
    await lampState(page, state); await ready(page); s = await plan();
    check(`drawn-plan ${name} removes its decorative glow, stale colour and active marker`, !s.material && s.css === '' && !s.active, s);
  }
}

const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
for (const mode of modes) {
  label = `${mode}: `; activeContext = 'fixture setup'; let session;
  try {
    session = await open(mode);
    check('loads only the chosen implementation', mode === 'source'
      ? session.requests.includes('/src/light-state.js') && !session.requests.includes('/dist/taylors3d-card.js')
      : session.requests.includes('/dist/taylors3d-card.js') && !session.requests.some((url) => url.startsWith('/src/')));
    await pixelsScenario(session.page, mode); await visibilityScenario(session.page); await budgetScenario(session.page);
    await uiScenario(session.page, mode); await lifecycleScenario(session.page); await drawnPlanScenario(session.page);
  } catch (error) { check('lighting scenario completes', false, error.message); }
  finally {
    if (session) {
      // Preserve the helper's warnings/error count while enriching actual page
      // exceptions with their real remote stack and the last fixture action.
      const unmatched = [...session.pageErrorDetails];
      errors.push(...session.errors.map((message) => {
        const index = unmatched.findIndex((error) => error.message === message);
        return index >= 0 ? unmatched.splice(index, 1)[0] : message;
      }));
      await session.page.evaluate(() => { const c = document.querySelector('taylors3d-card'); if (c?._view && window.lightingFixture) c._view.onRender = window.lightingFixture.previousRender; }).catch(() => {});
      await session.close();
    }
  }
}
label = ''; check('no browser errors', errors.length === 0, errors);
if (checks.some((pass) => !pass)) process.exitCode = 1;
