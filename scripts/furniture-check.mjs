// F15 native source/bundle proof: original licensed ZIP, actual embedded PNG
// decoding/GLTFLoader, actual editor and canvas dragging in the existing renderer.
// HTTP authentication/HA observations are simulated; no live HA claim is made.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { serveFurnitureFixture } from './lib/furniture-fixture.mjs';

const checks = [], errors = [], shots = path.join(root, 'screenshots');
const toolWarning = 'WARNING: Multiple instances of Three.js being imported.';
let label = '', context = 'fixture';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tolerance = 1e-6) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;
const pointsNear = (a, b, tolerance = 1e-6) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((n, i) => near(n, b[i], tolerance));
const check = (name, pass, detail) => { checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const field = (name) => `[data-field="furniture-${name}"]`;
const action = (name) => `[data-act="furniture-${name}"]`;
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function ready(page, { furniture = false } = {}) {
  try { await page.waitForFunction((furniture) => {
    const c = document.querySelector('taylors3d-card'), v = c?._view, now = performance.now(), report = c?.furnitureRenderingReport?.();
    if (!v?.model || c._loading || v.dirty || v._tween || v._modelMotionMoving || v._wallPresentation?.moving || c._securityLayer?.moving
      || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350 || furniture && (!report?.ready || report.pending)) {
      window.furnitureIdle = null; return false;
    }
    if (!window.furnitureIdle || ['frames', 'shadow', 'shadowLights'].some((key) => window.furnitureIdle[key] !== v.stats[key])) {
      window.furnitureIdle = { ...v.stats, at: now }; return false;
    }
    return now - window.furnitureIdle.at > 350;
  }, { polling: 50, timeout: 15000 }, furniture); } catch (error) {
    error.message += `; ${context}; ${JSON.stringify(await snapshot(page).catch(() => null))}`; throw error;
  }
}
async function control(page, selector, callback) {
  context = 'native furniture control ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try { const element = handle.asElement(); if (!element) throw new Error('Missing native furniture control ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(element);
  } finally { await handle.dispose(); } await settle(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const select = (page, name, value) => control(page, field(name), (element) => element.select(value));
async function type(page, name, value) {
  await control(page, field(name), async (element) => { await element.focus(); await page.keyboard.down('Control');
    try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }
    await page.keyboard.press('Backspace'); await page.keyboard.type(String(value));
  });
  const actual = await page.evaluate((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector)?.value, field(name));
  if (actual !== String(value)) throw new Error(`Native input ${name} is ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
}
async function screenshot(page, filename, fullPage = false) {
  fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, filename), fullPage });
}

async function open(mode) {
  const transport = await launch(), server = await serveFurnitureFixture(root, mode); let session; const pageErrors = [], toolDiagnostics = [];
  try {
    session = await newPage(transport.browser, { width: 1320, height: 1100 }); const { page } = session;
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack, context }));
    page.on('console', (message) => {
      if (mode === 'bundle' && message.type() === 'warn' && message.text() === toolWarning
        && context === 'read-only actual GLTFExporter house source proof'
        && new URL(message.location().url).pathname === '/node_modules/three/build/three.module.js') toolDiagnostics.push({ text: message.text(), location: message.location() });
    });
    await page.evaluateOnNewDocument(() => { window.furnitureContexts = new Set(); const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const result = original.call(this, kind, ...args);
        if (result && /^webgl/.test(kind)) window.furnitureContexts.add(this); return result;
      }; window.furnitureContextOriginal = original;
    });
    await page.goto(`${server.base}/demo/furniture-fixture.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.furnitureModuleReady, { timeout: 15000 }); await page.bringToFront();
    await page.evaluate(async ({ mode, entities, ids }) => {
      const c = document.querySelector('taylors3d-card'), f = window.furnitureFixture = { services: [], commits: 0, callbacks: [], captures: [], resources: new Map() };
      const connection = Object.assign(new EventTarget(), { connected: true });
      const state = (value, attributes = {}) => ({ state: value, attributes });
      const registry = (entity, area) => ({ entity_id: entity, area_id: area, device_id: null, hidden_by: null, disabled_by: null, entity_category: null });
      const states = { [entities.lamp]: state('on', { friendly_name: 'Simulated upper lamp', brightness: 180,
        supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: [255, 180, 90] }),
        [entities.switch]: state('on', { friendly_name: 'Simulated upper switch' }),
        [entities.unrelated]: state('0', { friendly_name: 'Known unrelated sensor' }),
        'sun.sun': state('below_horizon', { elevation: -20, azimuth: 180 }) };
      const hass = { user: { id: 'furniture-simulated-admin', is_active: true, is_admin: true }, auth: {}, connection,
        config: { location_name: 'Simulated furniture bench', time_zone: 'Europe/London', latitude: null, longitude: null },
        locale: { language: 'en', number_format: 'language' }, language: 'en', themes: { darkMode: false },
        floors: { ground: { floor_id: 'ground', name: 'Simulated ground', level: 0 }, upper: { floor_id: 'upper', name: 'Simulated upper', level: 1 } },
        areas: { floor_ground_area: { area_id: 'floor_ground_area', name: 'Simulated lower room', floor_id: 'ground' },
          floor_upper_area: { area_id: 'floor_upper_area', name: 'Simulated upper room', floor_id: 'upper' } }, devices: {},
        entities: Object.fromEntries(Object.keys(states).map((id) => [id, registry(id, id === entities.unrelated ? null : 'floor_upper_area')])), states,
        services: { light: { turn_on: {}, turn_off: {} }, homeassistant: { toggle: {} } },
        callService: (...args) => { f.services.push(args); return Promise.resolve(); },
        fetchWithAuth: (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, authorization: 'Bearer furniture-simulated-admin' } }) };
      c.setConfig({ height: '740px', layout_key: `furniture-browser-${mode}`, layout_style: 'house', house_colour_scheme: 'light',
        model: '/demo/furniture-house.glb', merge: false, model_opacity: 1, floor: 'all', view: '3d', mini_map: true,
        lights: 'auto', sky_bodies: false, control_panel: 'right', device_tap_action: 'controls' });
      c.hass = hass; await c._layoutReady;
      await new Promise((resolve, reject) => { const end = performance.now() + 30000; const inspect = () => {
        if (c._view?.model && c._objects?.parts.has(ids.lamp)) resolve(); else if (performance.now() > end) reject(new Error('Actual furniture house GLB did not load'));
        else setTimeout(inspect, 50); }; inspect(); });
      c._commit({ ...c._layout, floors: [{ id: 'ground', name: 'Simulated ground', elevation: 0, height: 3 }, { id: 'upper', name: 'Simulated upper', elevation: 4, height: 3 }],
        rooms: [], pins: {}, hidden: [], mower: {}, objects: { [ids.lamp]: { entity: entities.lamp, hidden: false }, [ids.switch]: { entity: entities.switch, hidden: false } },
        groups: {}, model: { levels: { [ids.ground]: { floor: 'ground' }, [ids.upper]: { floor: 'upper' }, [ids.background]: { floor: null } },
          rooms: { [ids.groundRoom]: { area: 'floor_ground_area', auto: false }, [ids.upperRoom]: { area: 'floor_upper_area', auto: false } } },
        views: { all: { section: { normal: [-1, 0, 0], constant: -.25 } } }, room_overlays: { mode: 'off' }, alert_bindings: [], camera_coverage: {},
        security_bindings: [], presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [], ambient_idle: { enabled: false },
        weather: { enabled: false }, scene_previews: { enabled: false }, floor_presentation: { mode: 'assembled' }, furniture: undefined });
      c.resetHistory(); const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (...args) => { f.commits++; return commit(...args); };
      f.renderer = c._view.renderer; f.houseRoot = c._view.model.root; f.onFrame = c._view.onFrame; f.onRender = c._view.onRender;
      f.house = new Map(); f.houseRoot.traverse((node) => { if (node.isMesh) f.house.set(node, { geometry: node.geometry, material: node.material }); });
      f.pool = [...c._objects.pool.points, ...c._objects.pool.spots]; f.services.length = 0;
    }, { mode, entities: server.fixture.entities, ids: server.fixture.ids });
    await ready(page); return { ...transport, ...session, server, pageErrors, toolDiagnostics, close: async () => { await transport.close(); await server.close(); } };
  } catch (error) { errors.push(...pageErrors, ...(session?.errors || [])); await transport.close(); await server.close(); throw error; }
}

async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c?._view, f = window.furnitureFixture;
    const editor = c?._edit?._furnitureEditor, layer = c?._furnitureLayer;
    return { loaded: !!v?.model, loading: c?._loading, dirty: v?.dirty, tween: !!v?._tween, occ: v?._occFull, occTimer: !!v?._occTimer,
      saved: structuredClone(c?._layout?.furniture ?? null), draft: structuredClone(editor?.draft ?? null), stale: editor?.stale, editorDirty: editor?.dirty,
      floorReport: c?.floorPresentationReport?.(),
      mode: c?._mode, editing: c?._editing, tab: c?._edit?.tab, report: c?.furnitureRenderingReport?.(), catalogue: c?.furnitureCatalogue?.(),
      parts: layer ? [...layer.parts].map(([id, part]) => ({ id, position: part.group.position.toArray(), quaternion: part.group.quaternion.toArray(),
        scale: part.group.scale.toArray(), visible: part.group.visible, source: layer.anchorOf(id)?.toArray(), display: layer.displayAnchorOf(id)?.toArray(),
        materials: (() => { const rows = []; part.model.traverse((node) => { if (node.isMesh) rows.push([node.geometry.uuid, node.material.uuid, node.material.version, node.material.map?.uuid]); }); return rows; })() })) : [],
      commits: f?.commits, calls: f?.services.length, stats: { ...v?.stats }, objectStats: { ...c?._objects?.stats },
      memory: { ...v?.renderer?.info.memory }, programs: v?.renderer?.info.programs.map((p) => p.id), contexts: window.furnitureContexts?.size,
      pool: c?._objects?.pool ? [...c._objects.pool.points, ...c._objects.pool.spots].map((light) => [light.uuid, light.type, light.castShadow]) : [],
      sameRenderer: v?.renderer === f?.renderer, houseSame: v?.model?.root === f?.houseRoot,
      houseResources: !!f?.house && [...f.house].every(([node, original]) => node.geometry === original.geometry && node.material === original.material),
      separate: !layer || !layer.group.parent || layer.group.parent === v.scene && !f.houseRoot.getObjectById(layer.group.id),
      viewRAF: !!v?._raf, callbackSame: v?.onFrame === f?.onFrame, capture: f?.capture,
      drag: { active: c?._edit?._furnitureDrag?.active, moved: c?._edit?._furnitureDrag?.moved, controlsEnabled: v?.controls?.enabled },
      resourceDisposals: f?.resources ? [...f.resources.values()].map((row) => ({ kind: row.kind, id: row.id, count: row.count })) : [] };
  });
}
async function editor(page) {
  if (!await page.evaluate(() => document.querySelector('taylors3d-card')._editing)) await click(page, 'button.edit');
  // Recovery can retain the selected tab while a fresh catalogue replaces its
  // native controls. Re-enter only when necessary, then observe the current
  // catalogue before Cancel; do not keep an old tab handle across that redraw.
  if (!await page.evaluate(() => document.querySelector('taylors3d-card')._edit?.tab === 'furniture')) {
    await click(page, '[data-act="tab"][data-id="furniture"]');
  }
  await page.waitForFunction(() => document.querySelector('taylors3d-card').furnitureCatalogue().status === 'ready', { timeout: 15000 });
  await click(page, action('cancel')); await ready(page);
}
async function camera(page, floor = 'ground') {
  context = 'authored simulated furniture camera';
  await page.evaluate((floor) => { const c = document.querySelector('taylors3d-card'), v = c._view, y = floor === 'upper' ? 4 : 0;
    v.setCamera({ position: [6, y + 7, 8], target: [.5, y + .4, .5] }, { instant: true });
  }, floor); await ready(page, { furniture: true });
}
async function observeResources(page) {
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), f = window.furnitureFixture;
    for (const part of c._furnitureLayer?.parts.values() || []) part.model.traverse((node) => {
      for (const [kind, object] of [['geometry', node.geometry], ['material', node.material], ['texture', node.material?.map]]) {
        if (!object || f.resources.has(object)) continue; const row = { kind, id: object.uuid, count: 0 };
        const handler = () => row.count++; object.addEventListener('dispose', handler); row.handler = handler; f.resources.set(object, row);
      }
    });
  });
}
async function pixels(page) {
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), v = c._view, f = window.furnitureFixture;
    if (!f.pixelHook) { f.pixelHook = (...args) => { f.onRender?.(...args); if (!f.captureRequested) return; f.captureRequested = false;
      const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, buffer = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
      const part = c._furnitureLayer?.parts.get('furniture_1'), mesh = part?.model.getObjectByName('tabletop'), readings = [];
      if (mesh) for (const localX of [-.25, .25]) {
        const world = mesh.localToWorld(v.camera.position.clone().set(localX, .501, 0)), projected = world.clone().project(v.camera), screen = v.projectWorld(world);
        const x = Math.round((projected.x + 1) * width / 2), y = Math.round((projected.y + 1) * height / 2), rgb = [];
        const inFrame = x >= 2 && y >= 2 && x < width - 2 && y < height - 2;
        if (inFrame) for (let channel = 0; channel < 3; channel++) { const values = [];
          for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) values.push(buffer[((y + dy) * width + x + dx) * 4 + channel]);
          values.sort((a, b) => a - b); rgb.push(values[12]); }
        readings.push({ rgb, inFrame, screen, hit: screen && c._furnitureLayer.hitTest(...screen)?.id });
      }
      f.capture = { frame: v.stats.frames, readings }; f.captures.push(f.capture);
    }; v.onRender = f.pixelHook; }
    f.captureRequested = true;
  });
}

async function libraryAndAdd(session, mode) {
  const { page, server } = session, f = server.fixture, before = await snapshot(page);
  check('unconfigured furniture adds no library traffic/layer/resources/renderer', !server.requests.some((r) => r.pathname.startsWith('/api/'))
    && before.parts.length === 0 && before.contexts === 1 && before.sameRenderer && before.pool.length === 12 && before.pool.filter((p) => p[2]).length === 4, before);
  await click(page, '[data-view="ground"]'); await editor(page);
  check('native Furniture tab reads an empty authenticated catalogue without saving/actions', server.requests.filter((r) => r.pathname === '/api/taylors3d/furniture').length === 1
    && (await snapshot(page)).catalogue.catalogue.packs.length === 0 && (await snapshot(page)).commits === 0 && (await snapshot(page)).calls === 0);
  fs.mkdirSync(shots, { recursive: true }); const filename = path.join(shots, `furniture-original-${mode}.zip`); fs.writeFileSync(filename, f.archive);
  await control(page, field('import-file'), (element) => element.uploadFile(filename)); await click(page, action('import'));
  await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return !c._edit._furnitureEditor._importPending
    && c.furnitureCatalogue().status === 'ready' && c.furnitureCatalogue().catalogue.packs.length === 1; }, { timeout: 15000 });
  const imported = await snapshot(page), pack = imported.catalogue.catalogue.packs[0];
  check('actual native File/multipart POST preserves original ZIP identity before refreshed publication', server.state.imports === 1
    && server.state.uploads.length === 1 && server.state.uploads[0].exact && server.state.uploads[0].sha256 === f.packId
    && pack.pack_id === f.packId && pack.manifest.id === f.pack.manifest.id && imported.saved === null && imported.commits === 0, server.state.uploads);
  check('shared GLB retains separate complete per-item licence and author metadata', equal(pack.manifest, f.pack.manifest)
    && equal(pack.licenses, f.pack.licenses) && pack.items[0].sha256 === pack.items[1].sha256
    && pack.items[0].license.sha256 !== pack.items[1].license.sha256 && equal(pack.items.map((item) => item.metadata), f.pack.manifest.items));
  await select(page, 'new-pack', f.packId); await select(page, 'new-item', 'table'); await select(page, 'new-floor', 'ground'); await click(page, action('add'));
  await type(page, 'x', 1.2); await type(page, 'y', -.9); await type(page, 'z', .1); await ready(page, { furniture: true });
  const added = await snapshot(page);
  check('native Add/move fields load the real textured GLB as a draft only', added.draft.instances.length === 1 && added.saved === null && added.commits === 0
    && added.report.rows[0].ready && added.report.rows[0].shown && pointsNear(added.parts[0].source, [1.2, .1, .9]) && added.separate
    && added.report.budgets.cachedAssets === 1 && added.report.budgets.texturePixels === 256 && added.report.budgets.triangles === 60, added.report);
  await observeResources(page); await pixels(page); await camera(page);
  const captured = (await snapshot(page)).capture;
  check('actual existing-renderer pixels show BOTH decoded PNG colours on the authored tabletop', captured?.readings.length === 2
    && captured.readings.every((r) => r.inFrame && r.hit === 'furniture_1')
    && captured.readings.some((r) => r.rgb[0] > r.rgb[1] + 70 && r.rgb[2] > r.rgb[1] + 50)
    && captured.readings.some((r) => r.rgb[1] > r.rgb[0] + 70 && r.rgb[2] > r.rgb[0] + 70), captured);
  check('native GLB loader decoded an actual image/UV texture rather than a coloured placeholder', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), mesh = c._furnitureLayer.parts.get('furniture_1').model.getObjectByName('tabletop');
    return mesh.material.map?.image?.width === 16 && mesh.material.map.image.height === 16 && mesh.geometry.attributes.uv.count === 24;
  }));
  await screenshot(page, `furniture-textured-draft${mode === 'bundle' ? '-bundle' : ''}.png`);
}

async function nativeDrag(page, mode, cameraMode) {
  context = `native actual ${cameraMode} furniture mesh drag`;
  const before = await snapshot(page);
  const pointer = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, layer = c._furnitureLayer, part = layer.parts.get('furniture_1');
    const mesh = part.model.getObjectByName('tabletop'), world = mesh.localToWorld(v.camera.position.clone().set(.1, .501, .1)), start = v.projectWorld(world);
    const plan = start && v.displayPlanPoint(...start, part.row.floorId); if (!plan) return { valid: false, start };
    const target = v.sourceWorldToDisplay([plan[0] + .65, v.floorElevation(part.row.floorId), -(plan[1] + .35)], part.row.floorId);
    const end = target.ok && v.projectWorld(v.camera.position.clone().fromArray(target.point)), endPlan = end && v.displayPlanPoint(...end, part.row.floorId);
    const hit = start && layer.hitTest(...start), canvas = v.renderer.domElement;
    const top = start && c.shadowRoot.elementFromPoint(...start);
    return { valid: hit?.id === 'furniture_1' && !!endPlan && top === canvas, start, end, plan, endPlan, hit, camera: v.camera.type,
      floor: part.row.floorId, expected: [part.row.instance.x + endPlan?.[0] - plan[0], part.row.instance.y + endPlan?.[1] - plan[1]] };
  });
  check(`${cameraMode} gesture starts on real visible mesh/active camera and canonical floor plane`, pointer.valid
    && (cameraMode === 'top' ? pointer.camera === 'OrthographicCamera' : pointer.camera === 'PerspectiveCamera'), pointer);
  if (!pointer.valid) throw new Error('Actual mesh drag precondition failed');
  await page.mouse.move(...pointer.start); await page.mouse.down();
  const held = await snapshot(page); check(`${cameraMode} native pointer capture disables only current OrbitControls`, held.drag.active && !held.drag.controlsEnabled && held.commits === before.commits, held.drag);
  await page.mouse.move(...pointer.end, { steps: 12 }); const moving = await snapshot(page);
  check(`${cameraMode} move is draft-only, preserves height and exact pointer offset`, moving.drag.active && moving.drag.moved && equal(moving.saved, before.saved)
    && pointsNear([moving.draft.instances[0].x, moving.draft.instances[0].y], pointer.expected) && moving.draft.instances[0].z === before.draft.instances[0].z
    && moving.commits === before.commits && moving.calls === 0, { expected: pointer.expected, draft: moving.draft, drag: moving.drag });
  await page.mouse.up(); await ready(page, { furniture: true }); const released = await snapshot(page);
  check(`${cameraMode} release restores controls, uses SOURCE metres once and does not save/fall through`, !released.drag.active && released.drag.controlsEnabled
    && pointsNear(released.parts[0].source, [pointer.expected[0], (pointer.floor === 'upper' ? 4 : 0) + released.draft.instances[0].z, -pointer.expected[1]])
    && released.commits === before.commits && released.calls === 0 && released.tab === 'furniture', released.parts[0]);
  check(`${cameraMode} transform-only drag reuses materials/textures/pool and requests zero shadows`, equal(before.pool, released.pool)
    && equal(before.parts[0].materials, released.parts[0].materials) && before.stats.shadow === released.stats.shadow
    && before.stats.shadowLights === released.stats.shadowLights && before.objectStats.shadowRequests === released.objectStats.shadowRequests
    && equal(before.memory, released.memory) && equal(before.programs, released.programs), { before: before.stats, after: released.stats });
  await screenshot(page, `furniture-drag-${cameraMode}${mode === 'bundle' ? '-bundle' : ''}.png`);
}

async function editingAndHistory(session, mode) {
  const { page } = session;
  await nativeDrag(page, mode, 'perspective');
  await type(page, 'rotation_degrees', 90); await type(page, 'scale', 1.25); await ready(page, { furniture: true });
  const draft = await snapshot(page); check('native rotate/scale affect the genuine draft wrapper without altering saved house geometry', draft.saved === null
    && pointsNear(draft.parts[0].scale, [1.25, 1.25, 1.25]) && near(draft.parts[0].quaternion[1], Math.SQRT1_2)
    && draft.houseResources && draft.houseSame && draft.commits === 0, draft.parts[0]);
  await control(page, field('x'), (element) => element.focus());
  const focus = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), node = c.shadowRoot.querySelector('[data-field="furniture-x"]');
    window.furnitureFixture.focus = node; c.hass = { ...c._hass, states: { ...c._hass.states } };
    return { same: node === c.shadowRoot.querySelector('[data-field="furniture-x"]'), focused: c.shadowRoot.activeElement === node, value: node.value };
  });
  check('current HA snapshots preserve the exact focused native draft control/value', focus.same && focus.focused && Number(focus.value) === draft.draft.instances[0].x, focus);
  await click(page, action('save')); await ready(page, { furniture: true }); const saved = await snapshot(page);
  check('native Save commits one placement history step and clears the temporary preview', saved.commits === 1 && equal(saved.saved, draft.draft)
    && saved.catalogue.status === 'ready' && saved.calls === 0 && await page.evaluate(() => document.querySelector('taylors3d-card')._furnitureCoordinator.preview === null), saved.saved);
  await click(page, '[data-act="history-undo"]'); await ready(page); const undone = await snapshot(page);
  check('Undo removes placement but keeps immutable original library/asset cache and house refs', undone.saved === null && undone.parts.length === 0
    && undone.catalogue.catalogue.packs.length === 1 && undone.houseResources && undone.calls === 0, undone.report);
  await click(page, '[data-act="history-redo"]'); await ready(page, { furniture: true }); const redone = await snapshot(page);
  check('Redo restores the exact raw placement and cached asset, not a newly imported pack', equal(redone.saved, saved.saved)
    && redone.report.budgets.cachedAssets === 1 && redone.resourceDisposals.every((r) => r.count === 0), redone.report);
  await type(page, 'x', 9); await click(page, action('cancel')); await ready(page, { furniture: true });
  check('Cancel restores latest saved placement without a history/service action', equal((await snapshot(page)).saved, saved.saved)
    && equal((await snapshot(page)).draft, saved.saved) && near((await snapshot(page)).parts[0].source[0], saved.saved.instances[0].x));
  await click(page, '[data-mode="top"]'); await click(page, action('cancel')); await ready(page, { furniture: true });
  await nativeDrag(page, mode, 'top'); await click(page, action('save')); await ready(page, { furniture: true });
  await click(page, action('copy')); await type(page, 'x', -.8); await type(page, 'y', 1.0); await click(page, action('save')); await ready(page, { furniture: true });
  const copied = await snapshot(page);
  check('native Copy keeps independent saved transforms while sharing one real texture/geometry/material cache', copied.saved.instances.length === 2
    && copied.report.budgets.cachedAssets === 1 && copied.report.budgets.triangles === 120 && copied.parts[0].materials.every((row, index) => equal(row, copied.parts[1].materials[index]))
    && copied.parts[0].position[0] !== copied.parts[1].position[0] && copied.resourceDisposals.every((r) => r.count === 0), copied.report);
  await select(page, 'selected', '0'); await select(page, 'floor_id', 'upper'); await type(page, 'x', .7); await type(page, 'y', -.9); await type(page, 'z', .2);
  await type(page, 'scale', .8); await click(page, action('save')); await ready(page, { furniture: true });
  const moved = await snapshot(page);
  check('native exact floor choice stores SOURCE height above that floor without rewriting house source data', moved.saved.instances[0].floor_id === 'upper'
    && pointsNear(moved.parts.find((p) => p.id === 'furniture_1').source, [.7, 4.2, .9]) && moved.houseResources && moved.houseSame && moved.calls === 0, moved.saved);
  await click(page, 'button.edit'); await ready(page, { furniture: true }); await click(page, '[data-mode="3d"]'); await click(page, '[data-view="all"]');
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ floor_presentation: {
    mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2, axis: 'east', base_elevation_m: 0 } }); }); await ready(page, { furniture: true });
  const split = await snapshot(page), upper = await page.evaluate(() => document.querySelector('taylors3d-card').floorPresentationReport().rows.find((row) => row.floor_id === 'upper'));
  const physical = split.parts.find((part) => part.id === 'furniture_1');
  check('real split engine applies its display offset exactly once to the separate furniture group', pointsNear(physical.source, [.7, 4.2, .9])
    && pointsNear(physical.display, physical.source.map((n, i) => n + upper.offset[i])) && pointsNear(physical.position, physical.display)
    && split.saved.instances[0].x === .7 && split.houseResources && split.pool.length === 12 && split.contexts === 1, { physical, floor: upper });
  await click(page, '[data-view="ground"]'); await ready(page, { furniture: true });
  const offFloor = await snapshot(page); check('actual floor filtering hides only the off-floor instance with no invisible furniture hit', !offFloor.report.rows.find((row) => row.id === 'furniture_1').shown
    && offFloor.report.rows.find((row) => row.id === 'furniture_2').shown && await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), anchor = c._furnitureLayer.displayAnchorOf('furniture_1'), screen = anchor && c._view.projectWorld(anchor);
      return !screen || c._furnitureLayer.hitTest(...screen)?.id !== 'furniture_1';
    }), offFloor.report);
  await click(page, '[data-view="all"]'); await ready(page, { furniture: true }); await sourceExport(session);
}

async function sourceExport(session) {
  const { page } = session; context = 'read-only actual GLTFExporter house source proof';
  const report = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'), v = c._view, adapted = v.sourceModelRootForExport(); if (!adapted.ok) return adapted;
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js'), result = await new GLTFExporter().parseAsync(adapted.root, { binary: false });
    return { ok: true, distinct: adapted.root !== v.model.root, nodes: result.nodes.map((node) => ({ name: node.name, translation: node.translation })),
      furniturePresent: result.nodes.some((node) => node.name?.includes('simulated furniture') || node.name === 'tabletop'),
      sourceLevels: Object.fromEntries(['fp_ground', 'fp_upper'].map((id) => [id, adapted.root.getObjectByName(id)?.position.toArray()])),
      liveLevels: Object.fromEntries(['fp_ground', 'fp_upper'].map((id) => [id, v.model.root.getObjectByName(id)?.position.toArray()])) };
  });
  check('actual source export seam/GLTFExporter excludes separate furniture and preserves canonical house levels', report.ok && report.distinct && !report.furniturePresent
    && pointsNear(report.sourceLevels.fp_ground, [0, 0, 0]) && pointsNear(report.sourceLevels.fp_upper, [0, 4, 0])
    && !pointsNear(report.sourceLevels.fp_upper, report.liveLevels.fp_upper), report);
}

async function idleAndLicences(session, mode) {
  const { page, server } = session;
  await ready(page, { furniture: true }); const before = await snapshot(page), assetReads = server.state.assetReads;
  await page.evaluate(async (entity) => { const c = document.querySelector('taylors3d-card'); for (let index = 1; index <= 10; index++) {
    c.hass = { ...c._hass, states: { ...c._hass.states, [entity]: { ...c._hass.states[entity], state: String(index) } } };
    await new Promise((resolve) => setTimeout(resolve, 40)); }
  }, server.fixture.entities.unrelated); await ready(page, { furniture: true }); const after = await snapshot(page);
  // ObjectLayer.updates counts checking an incoming snapshot, even when its
  // unchanged-input fast path performs no evaluation or rendering work.
  check('ten unrelated HA readings add zero evaluations/frames/shadows/pool or material writes/resources/downloads', equal(before.stats, after.stats)
    && after.objectStats.updates === before.objectStats.updates + 10
    && ['evaluated', 'budget', 'shadowRequests'].every((key) => before.objectStats[key] === after.objectStats[key])
    && equal(before.memory, after.memory) && equal(before.programs, after.programs)
    && equal(before.pool, after.pool) && equal(before.parts, after.parts) && before.report.budgets.cachedAssets === after.report.budgets.cachedAssets
    && server.state.assetReads === assetReads && after.callbackSame && after.calls === 0, {
      stats: { before: before.stats, after: after.stats }, objectStats: { before: before.objectStats, after: after.objectStats },
      same: Object.fromEntries(['memory', 'programs', 'pool', 'parts'].map((key) => [key, equal(before[key], after[key])])),
      assets: { before: assetReads, after: server.state.assetReads }, callbackSame: after.callbackSame, calls: after.calls,
    });
  await click(page, '[data-view="all"]'); await click(page, 'button.section'); await ready(page, { furniture: true });
  const clipped = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), layer = c._furnitureLayer, v = c._view;
    const part = layer.parts.get('furniture_1'), mesh = part.model.getObjectByName('tabletop'), point = mesh.localToWorld(v.camera.position.clone().set(.1, .501, .1));
    const screen = v.projectWorld(point); return { section: !!v.sectionClip, cut: v._cutAway(point), hit: screen && layer.hitTest(...screen), source: part.row.sourceWorld };
  });
  check('native Section clips real furniture and rejects invisible triangle picking without source edits', clipped.section && clipped.cut && !clipped.hit, clipped);
  await click(page, 'button.section'); await ready(page, { furniture: true }); await editor(page);
  const assembled = await snapshot(page);
  check('Furniture editing deliberately assembles floors and uses canonical SOURCE placement without changing saved split policy', assembled.floorReport.mode === 'assembled'
    && assembled.parts.every((part) => pointsNear(part.position, part.source))
    && await page.evaluate(() => document.querySelector('taylors3d-card')._layout.floor_presentation.mode === 'horizontal'), assembled.parts);
  await control(page, '[data-furniture-licences] summary', (element) => element.click());
  const credits = await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-furniture-licences]').textContent);
  check('real published-pack details show actual supplied author/licence and original ZIP action', credits.includes(server.fixture.pack.manifest.author)
    && credits.includes('MIT') && credits.includes('LICENSE.txt') && credits.includes('Download original licensed ZIP'), credits);
  const directory = path.join(shots, `furniture-download-${mode}`); fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `taylors3d-furniture-${server.fixture.packId}.zip`); if (fs.existsSync(filename)) fs.unlinkSync(filename);
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
    await click(page, `[data-act="library-export"][data-pack="${server.fixture.packId}"]`);
    const deadline = Date.now() + 10000; while (!fs.existsSync(filename) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    const bytes = fs.existsSync(filename) ? fs.readFileSync(filename) : null;
    check('native original-ZIP download retains exact bytes/immutable hash and both complete credits', !!bytes && bytes.equals(server.fixture.archive)
      && createHash('sha256').update(bytes).digest('hex') === server.fixture.packId && server.state.archiveReads === 1, { downloaded: bytes?.length, archiveReads: server.state.archiveReads });
  } finally { await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {}); await cdp.detach(); }
  await screenshot(page, `furniture-editor-licences${mode === 'bundle' ? '-bundle' : ''}.png`, true);
}

async function staleAndReload(session) {
  const { page } = session; await click(page, action('cancel')); await type(page, 'x', 2.1);
  const saved = (await snapshot(page)).saved, commits = (await snapshot(page)).commits;
  await control(page, action('save'), async (element) => { const box = await element.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), f = window.furnitureFixture; f.user = c._hass.user;
    c.hass = { ...c._hass, user: { ...f.user, is_active: false } }; c.hass = { ...c._hass, user: f.user };
  }); await page.mouse.up(); await settle(page);
  check('native held Save is poisoned by observed account loss even after recovery', equal((await snapshot(page)).saved, saved)
    && (await snapshot(page)).commits === commits && (await snapshot(page)).calls === 0);
  await editor(page); await select(page, 'selected', '0'); await control(page, action('copy'), (element) => element.focus()); await page.keyboard.down('Space');
  await click(page, '[data-act="tab"][data-id="model"]'); await page.keyboard.up('Space'); await settle(page);
  check('native held keyboard Copy cannot survive an actual editor tab departure', equal((await snapshot(page)).saved, saved)
    && (await snapshot(page)).commits === commits && (await snapshot(page)).tab === 'model');
  await editor(page); await type(page, 'x', 2.2);
  await control(page, action('save'), async (element) => { const box = await element.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, layout_key: c._config.layout_key + '-other' }); });
  await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return !c._loading && !!c._layout; }, { timeout: 15000 });
  await page.mouse.up(); await settle(page);
  check('a native old Save cannot write furniture into a newly loaded layout key', (await snapshot(page)).saved === null && (await snapshot(page)).commits === commits);
  await page.evaluate(async () => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, layout_key: c._config.layout_key.replace(/-other$/, '') }); await c._layoutReady; });
  await ready(page, { furniture: true });
  check('real layout storage reload restores exact saved immutable references/placements', equal((await snapshot(page)).saved, saved) && (await snapshot(page)).report.rows.length === 2);
  await editor(page); await click(page, action('cancel')); await type(page, 'x', 1.1); await click(page, action('save')); await ready(page, { furniture: true });
  check('a fresh deliberate gesture after recovery remains usable', (await snapshot(page)).saved.instances[0].x === 1.1 && (await snapshot(page)).commits === commits + 1);
}

async function unavailableAndPending(session) {
  const { page, server } = session; await click(page, action('cancel')); const original = (await snapshot(page)).saved;
  // A genuinely missing immutable catalogue identity must remain missing. The
  // fixture never substitutes a different item/hash or a generated placeholder.
  server.state.catalogueMissing = true; await click(page, '[data-act="library-refresh"]');
  await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return c.furnitureCatalogue().status === 'ready'
    && c.furnitureCatalogue().catalogue.packs.length === 0; }, { timeout: 15000 }); await ready(page);
  const missing = await snapshot(page);
  check('current missing pack leaves saved identities/credits intact and removes invisible placeholder/pick resources', equal(missing.saved, original)
    && missing.report.rows.length === 2 && missing.report.rows.every((row) => !row.ready && !row.shown && row.diagnostics.some((d) => d.code === 'pack_unavailable'))
    && missing.parts.length === 0 && missing.report.budgets.cachedAssets === 0 && missing.calls === 0, missing.report);
  check('actual missing-source form is read-only with a repair explanation instead of automatic replacement', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); return c.shadowRoot.querySelector('[data-field="furniture-x"]')?.disabled
      && c.shadowRoot.querySelector('[data-furniture-status]').textContent.includes('exact');
  }));
  server.state.catalogueMissing = false; server.state.holdAssets = true; const previousReads = server.state.assetReads;
  await click(page, '[data-act="library-refresh"]');
  await page.waitForFunction(() => document.querySelector('taylors3d-card').furnitureRenderingReport().pending > 0, { timeout: 15000 });
  const requestDeadline = Date.now() + 15000;
  while (server.state.assetReads === previousReads && Date.now() < requestDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (server.state.assetReads === previousReads) throw new Error('The real pending GLB HTTP request was not observed before the cancellation test');
  const pending = await snapshot(page); check('restored real pack waits for actual authenticated GLB bytes without fake geometry', pending.parts.length === 0
    && pending.report.pending === 1 && equal(pending.saved, original), pending.report);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), f = window.furnitureFixture;
    f.assetOwner = c._furnitureLayer._generation; f.connection = c._hass.connection;
    f.connection.connected = false; f.connection.dispatchEvent(new Event('disconnected')); c.hass = { ...c._hass };
  }); await settle(page);
  const revoked = await snapshot(page); check('actual session loss cancels pending asset ownership without publishing old geometry', revoked.parts.length === 0
    && revoked.report.budgets.cachedAssets === 0 && equal(revoked.saved, original), revoked.report);
  server.release();
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.furnitureFixture.connection.connected = true;
    c.hass = { ...c._hass, connection: window.furnitureFixture.connection }; });
  await editor(page); await ready(page, { furniture: true }); const current = await snapshot(page);
  check('fresh restored catalogue/session loads real assets under a new owner without reviving the old request', current.parts.length === 2
    && current.report.budgets.cachedAssets === 1 && equal(current.saved, original) && current.calls === 0 && server.state.assetReads > previousReads
    && await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return c._furnitureLayer._generation > window.furnitureFixture.assetOwner
      && c._furnitureLayer._sessionGeneration === c._furnitureCoordinator.client.generation; }), current.report);
}

async function narrowAndLifecycle(session, mode) {
  const { page, server } = session;
  await editor(page); await type(page, 'x', 1.3);
  const contrast = () => page.evaluate(() => { const form = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-furniture-editor]');
    const luma = (value) => { const c = value.match(/[\d.]+/g)?.slice(0, 3).map(Number); if (c?.length !== 3) return NaN;
      return c.map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); };
    return [...form.querySelectorAll('input,select,button')].filter((node) => !node.disabled && node.getClientRects().length).map((node) => {
      const style = getComputedStyle(node), r = node.getBoundingClientRect(), a = luma(style.color), b = luma(style.backgroundColor);
      return { id: node.dataset.field || node.dataset.act, height: r.height, left: r.left, right: r.right,
        ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }; });
  });
  const light = await contrast(); check('real furniture form has readable AA light-theme text and 44px native controls', light.length >= 10
    && light.some((row) => row.id === 'furniture-save') && light.every((row) => row.ratio >= 4.5 && row.height >= 44), light);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, house_colour_scheme: 'dark' }); }); await settle(page);
  await click(page, action('cancel')); await type(page, 'x', 1.3); const dark = await contrast();
  check('same furniture controls retain AA readable dark-theme text', dark.length === light.length && dark.every((row) => row.ratio >= 4.5 && row.height >= 44), dark);
  await page.setViewport({ width: 320, height: 1200, deviceScaleFactor: 1 });
  await page.evaluate(() => { document.querySelector('taylors3d-card').style.width = '296px'; }); await settle(page);
  const narrow = await contrast(); check('actual 320px viewport retains reachable 44px controls without horizontal overflow', narrow.length === dark.length
    && narrow.every((row) => row.height >= 44 && row.left >= -1 && row.right <= 321 && row.ratio >= 4.5)
    && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), narrow);
  await control(page, field('x'), (element) => element.focus()); await screenshot(page, `furniture-editor-narrow${mode === 'bundle' ? '-bundle' : ''}.png`, true);
  await click(page, action('cancel')); await page.setViewport({ width: 1320, height: 1100, deviceScaleFactor: 1 });
  await page.evaluate(() => document.querySelector('taylors3d-card').style.width = '1200px'); await settle(page);
  await observeResources(page); const before = await snapshot(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), f = window.furnitureFixture; f.detached = c; c.remove(); }); await settle(page);
  const detached = await page.evaluate(() => { const c = window.furnitureFixture.detached, f = window.furnitureFixture;
    return { raf: !!c._view._raf, parts: c._furnitureLayer?.parts.size || 0, budgets: c.furnitureRenderingReport().budgets, calls: f.services.length,
      sameRenderer: c._view.renderer === f.renderer, disposals: [...f.resources.values()].map((r) => ({ kind: r.kind, count: r.count })) };
  });
  check('disconnect stops existing RAF and releases each shared furniture resource exactly once', !detached.raf && detached.parts === 0 && detached.budgets?.cachedAssets === 0
    && detached.disposals.length >= 3 && detached.disposals.every((r) => r.count === 1) && detached.sameRenderer && detached.calls === 0, detached);
  await page.evaluate(() => document.querySelector('main').append(window.furnitureFixture.detached)); await page.bringToFront(); await ready(page, { furniture: true });
  const resumed = await snapshot(page);
  check('reconnect reloads current saved furniture with the same house/renderer/fixed pool', equal(resumed.saved, before.saved) && resumed.report.rows.length === 2
    && resumed.report.budgets.cachedAssets === 1 && resumed.sameRenderer && resumed.houseResources && resumed.contexts === 1 && equal(resumed.pool, before.pool)
    && server.requests.filter((r) => r.pathname.startsWith('/api/')).every((r) => r.authorization === 'Bearer furniture-simulated-admin'), resumed.report);
}

async function restore(page) {
  return page.evaluate(() => { const c = document.querySelector('taylors3d-card') || window.furnitureFixture?.detached, f = window.furnitureFixture;
    if (!c || !f) return false; const v = c._view; v.onRender = f.onRender;
    for (const [object, row] of f.resources) object.removeEventListener('dispose', row.handler);
    HTMLCanvasElement.prototype.getContext = window.furnitureContextOriginal;
    const restored = v.onRender === f.onRender && v.onFrame === f.onFrame && HTMLCanvasElement.prototype.getContext === window.furnitureContextOriginal;
    c.remove(); return restored;
  });
}

const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
for (const mode of modes) {
  label = `${mode}: `; let session;
  try {
    session = await open(mode);
    check('loads exactly the selected source or built card entry', mode === 'source'
      ? session.server.requests.some((r) => r.pathname === '/src/taylors3d-card.js') && !session.server.requests.some((r) => r.pathname === '/dist/taylors3d-card.js')
      : session.server.requests.some((r) => r.pathname === '/dist/taylors3d-card.js') && !session.server.requests.some((r) => r.pathname.startsWith('/src/')));
    await libraryAndAdd(session, mode); await editingAndHistory(session, mode); await idleAndLicences(session, mode);
    await unavailableAndPending(session); await staleAndReload(session); await narrowAndLifecycle(session, mode);
    const final = await snapshot(session.page);
    check('all furniture viewing/import/export/edit actions send zero HA services', final.calls === 0);
    check('only expected local source/assets/catalogue routes were requested', session.server.requests.every((r) => !r.pathname.startsWith('/api/taylors3d/furniture')
      || r.pathname === '/api/taylors3d/furniture' || r.pathname === session.server.fixture.pack.download_url || r.pathname === session.server.fixture.pack.items[0].asset_url));
    check('external exporter diagnostic is explicit and confined to the bundle test tool', session.toolDiagnostics.length === (mode === 'bundle' ? 1 : 0), session.toolDiagnostics);
  } catch (error) { check('browser scenario completed', false, { context, message: error.message, stack: error.stack }); }
  finally { if (session) {
    check('all passive pixel/resource/context observers are restored before teardown', await restore(session.page).catch(() => false));
    await settle(session.page).catch(() => {});
    errors.push(...session.pageErrors, ...session.errors.filter((message) => !session.pageErrors.some((error) => error.message === message)
      && !(message === 'warn: ' + toolWarning && session.toolDiagnostics.length === 1)));
    await session.close();
  } }
}
check('no actual application browser errors or unexpected warnings', errors.length === 0, errors);
console.log(`\n${checks.filter(Boolean).length}/${checks.length} furniture checks passed.`);
if (checks.some((pass) => !pass)) process.exitCode = 1;
