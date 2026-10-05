// F24 native source/bundle proof. Original simulated floor geometry, real GLB
// loader, existing renderer/readback and native form/pointer actions. SOURCE
// coordinates remain saved; the DISPLAY arrangement is independently measured.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { floorPresentationFixtureGlb, floorFixtureEntities as entities, floorFixtureIds as ids } from './lib/floor-presentation-fixture.mjs';

const checks = [], errors = [];
const exporterDiagnostic = 'WARNING: Multiple instances of Three.js being imported.';
let label = '', context = 'setup';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, epsilon = 1e-6) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= epsilon;
const pointsNear = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((number, index) => near(number, b[index]));
const check = (name, pass, detail) => { checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const field = (name) => `[data-field="floor-presentation-${name}"]`;
const action = (name) => `[data-act="floor-presentation-${name}"]`;
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function ready(page, { model = true } = {}) {
  try { await page.waitForFunction((model) => {
    const c = document.querySelector('taylors3d-card'), v = c?._view, now = performance.now();
    if (!v || model && !v.model || !model && v.model || c._loading || v.dirty || v._tween || v._modelMotionMoving
      || v._wallPresentation?.moving || c._securityLayer?.moving || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350) {
      window.floorsIdle = null; return false;
    }
    if (!window.floorsIdle || ['frames', 'shadow', 'shadowLights'].some((key) => window.floorsIdle[key] !== v.stats[key])) {
      window.floorsIdle = { ...v.stats, at: now }; return false;
    }
    return now - window.floorsIdle.at > 350;
  }, { timeout: 15000, polling: 50 }, model); } catch (error) {
    error.message += `; ${context}; ${JSON.stringify(await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), v = c?._view;
      return { loaded: !!v?.model, loading: c?._loading, dirty: v?.dirty, tween: !!v?._tween, occlusion: v?._occFull, timer: !!v?._occTimer,
        motion: v?._modelMotionMoving, sky: c?._skyMode, mode: c?._mode, editing: c?._editing, view: c?._viewId,
        visibility: document.visibilityState, stats: v?.stats, report: c?.floorPresentationReport?.(), policy: c?._layout?.floor_presentation,
        source: c?._config?.model, capture: window.floorsFixture?.capture };
    }).catch(() => null))}`; throw error;
  }
}
async function control(page, selector, callback) {
  context = 'native control ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try { const element = handle.asElement(); if (!element) throw new Error('Missing floor control ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(element);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const select = (page, name, value) => control(page, field(name), (element) => element.select(value));
async function type(page, name, value) {
  await control(page, field(name), async (element) => {
    await element.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace'); await page.keyboard.type(String(value));
  });
  const actual = await page.evaluate((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector)?.value, field(name));
  if (actual !== String(value)) throw new Error(`Native input ${name} is ${actual}, expected ${value}`);
}
async function screenshot(page, filename, fullPage = false) {
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots', filename), fullPage });
}

async function open(mode) {
  const transport = await launch(); let session; const requests = [], pageErrors = [], toolDiagnostics = [];
  try {
    // Changing hasTouch during setViewport reloads a Puppeteer page. Keep the
    // same native touch capability while resizing so this is a layout test.
    session = await newPage(transport.browser, { width: 1280, height: 1080, hasTouch: true }); const { page } = session;
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack, context }));
    page.on('console', (message) => {
      // The bundle contains Three internally; the read-only real exporter tool
      // imports the local ES-module copy. Keep this one diagnostic explicit.
      if (mode === 'bundle' && message.type() === 'warn' && message.text() === exporterDiagnostic
        && context === 'read-only real GLTFExporter source adapter proof'
        && message.location().url
        && new URL(message.location().url).pathname === '/node_modules/three/build/three.module.js') {
        toolDiagnostics.push({ text: message.text(), source: message.location(), context });
      }
    });
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
      .replace(/<section class="theme dark">[\s\S]*?<\/section>/, '')
      .replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
    const imports = JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } });
    html = html.replace('</head>', `<script type="importmap">${imports}</script></head>`);
    if (mode === 'source') html = html.replace('src="../dist/taylors3d-card.js"', 'src="../src/taylors3d-card.js"');
    const fixtures = { '/demo/floor-presentation.glb': floorPresentationFixtureGlb(),
      '/demo/floor-presentation-nested.glb': floorPresentationFixtureGlb({ nested: true }),
      '/demo/floor-presentation-unclassified.glb': floorPresentationFixtureGlb({ unclassified: true }) };
    await page.evaluateOnNewDocument(() => { window.__demoMowerPaused = true; window.floorContexts = new Set();
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const value = original.call(this, kind, ...args);
        if (value && /^webgl/.test(kind)) window.floorContexts.add(this); return value;
      };
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => { const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
      else if (fixtures[url.pathname]) request.respond({ status: 200, contentType: 'model/gltf-binary', body: fixtures[url.pathname] });
      else request.continue();
    });
    await page.goto(`${transport.base}/demo/index.html?model=/demo/floor-presentation.glb&merge=0&floor=all&view=3d&height=740px`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront(); await page.waitForFunction(() => document.querySelector('taylors3d-card')?._objects?.parts.has('fp_lamp'), { timeout: 30000 });
    await page.evaluate(async ({ mode, entities, ids }) => {
      const c = document.querySelector('taylors3d-card'); window.floorsFixture = { services: [], commits: 0, captureRequested: false, captures: [],
        renderer: c._view.renderer, levels: null, originals: null, observers: [] };
      c.hass = { ...c._hass, callWS: undefined };
      c.setConfig({ ...c._config, layout_key: `floors-browser-${mode}`, height: '740px', merge: false, model_opacity: 1,
        lights: 'auto', sky_bodies: false, control_panel: 'right', device_tap_action: 'controls', mini_map: true });
      await c._layoutReady;
      const state = (reported, attributes) => ({ state: reported, attributes });
      const registry = (entity, area) => ({ entity_id: entity, area_id: area, device_id: null, hidden: false, disabled_by: null, entity_category: null });
      c.hass = { ...c._hass, callWS: undefined, callService: (...args) => { window.floorsFixture.services.push(args); return Promise.resolve(); },
        config: { ...c._hass.config, latitude: null, longitude: null },
        floors: { ground: { floor_id: 'ground', name: 'Simulated ground', level: 0 }, upper: { floor_id: 'upper', name: 'Simulated upper', level: 1 } },
        areas: { floor_ground_area: { area_id: 'floor_ground_area', name: 'Simulated ground room', floor_id: 'ground' },
          floor_upper_area: { area_id: 'floor_upper_area', name: 'Simulated upper room', floor_id: 'upper' } }, devices: {},
        entities: { [entities.lamp]: registry(entities.lamp, 'floor_upper_area'), [entities.switch]: registry(entities.switch, 'floor_upper_area'),
          [entities.camera]: registry(entities.camera, 'floor_upper_area'), [entities.door]: registry(entities.door, 'floor_ground_area'),
          [entities.mower]: registry(entities.mower, 'floor_ground_area'), [entities.position]: registry(entities.position, 'floor_upper_area'),
          [entities.temperature]: registry(entities.temperature, 'floor_upper_area'), [entities.leak]: registry(entities.leak, 'floor_upper_area'),
          [entities.presence]: registry(entities.presence, 'floor_upper_area'), [entities.weather]: registry(entities.weather, null),
          [entities.unrelated]: registry(entities.unrelated, null) },
        states: { [entities.lamp]: state('on', { friendly_name: 'Simulated upper lamp', brightness: 180, supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: [255, 180, 90] }),
          [entities.switch]: state('on', { friendly_name: 'Simulated upper switch' }), [entities.camera]: state('idle', { friendly_name: 'Simulated upper camera' }),
          [entities.door]: state('off', { friendly_name: 'Simulated hinge contact', device_class: 'door' }),
          [entities.mower]: state('mowing', { friendly_name: 'Simulated cross-floor mower' }), [entities.position]: state('current', { x: .9, y: -.6 }),
          [entities.temperature]: state('20', { friendly_name: 'Simulated upper temperature', device_class: 'temperature', unit_of_measurement: '°C' }),
          [entities.leak]: state('off', { friendly_name: 'Simulated upper leak', device_class: 'moisture' }), [entities.presence]: state('upstairs', { friendly_name: 'Simulated exact room report' }),
          [entities.weather]: state('rainy', { friendly_name: 'Simulated current weather' }), [entities.unrelated]: state('0', { friendly_name: 'Known unrelated sensor' }),
          'sun.sun': state('below_horizon', { elevation: -20, azimuth: 180 }) } };
      const bindings = Object.fromEntries(['lamp', 'switch', 'camera', 'door', 'mower'].map((key) => [ids[key], { entity: entities[key], hidden: false }]));
      c._commit({ ...c._layout, floors: [{ id: 'ground', name: 'Simulated ground', elevation: 0, height: 3 }, { id: 'upper', name: 'Simulated upper', elevation: 4, height: 3 }],
        rooms: [{ id: 'outdoor-ground', floor_id: 'ground', polygon: [[-4, -1], [-3.2, -1], [-3.2, 1], [-4, 1]], outdoor: true, doors: [] },
          { id: 'outdoor-upper', floor_id: 'upper', polygon: [[2.4, -1], [3.2, -1], [3.2, 1], [2.4, 1]], outdoor: true, doors: [] }], pins: {}, hidden: [],
        mower: { entity: entities.position, source: 'xy', x_attr: 'x', y_attr: 'y', floor_id: 'upper', calibration: [], trail: false, overlay: null },
        // No saved assignments: these links really are suggestions. resolveLevels
        // correctly treats any saved exact floor choice as deliberate confirmation.
        objects: bindings, groups: {}, model: { levels: {},
          rooms: { [ids.groundRoom]: { area: 'floor_ground_area', auto: false }, [ids.upperRoom]: { area: 'floor_upper_area', auto: false } } },
        views: {}, floor_presentation: undefined, wall_presentation: undefined, model_rendering: { shadows: 'realtime', lamps: 'inherit' },
        ambient_idle: { enabled: false }, scene_previews: { enabled: false }, room_overlays: { mode: 'off' }, alert_bindings: [], weather: { enabled: false },
        security_bindings: [], presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [], camera_coverage: {} });
      const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (...args) => { window.floorsFixture.commits++; return commit(...args); };
      c._skyMode = 'auto'; c._applySky(true); c._setView('all', { instant: true }); c.resetHistory();
      document.querySelector('section.theme h2').textContent = `Simulated independent two-floor bench · ${mode}`;
    }, { mode, entities, ids });
    await ready(page); await captureOriginals(page); return { ...transport, ...session, requests, pageErrors, toolDiagnostics };
  } catch (error) { errors.push(...pageErrors, ...(session?.errors || [])); if (session) await restoreObservers(session.page).catch(() => {}); await transport.close(); throw error; }
}

async function captureOriginals(page) {
  await page.evaluate((ids) => { const c = document.querySelector('taylors3d-card'), v = c._view, f = window.floorsFixture;
    f.levels = Object.fromEntries(v.model.manifest.levels.map((level) => [level.id, level.node]));
    f.nodes = {}; f.originals = new Map();
    v.model.root.traverse((node) => { if (node.userData.floorsTestRole) f.nodes[node.userData.floorsTestRole] = node;
      if (node.isMesh && !node.userData.helper) f.originals.set(node, { geometry: node.geometry, material: node.material });
    });
    if (!f.levels[ids.ground] || !f.levels[ids.upper] || !f.levels[ids.background]) throw new Error('Fixture level groups missing');
    f.sourcePositions = Object.fromEntries(Object.entries(f.levels).map(([id, node]) => [id, node.position.toArray()]));
    f.root = v.model.root;
  }, ids);
}
async function installPixels(page) {
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), v = c._view, f = window.floorsFixture;
    f.previousRender = v.onRender;
    v.onRender = (...args) => { f.previousRender?.(...args); if (!f.captureRequested) return;
      f.captureRequested = false;
      const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, buffer = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
      const capture = { frame: v.stats.frames };
      for (const [name, source, floor] of [['ground', [2.7, 0, 1.3], 'ground'], ['upper', [1.2, 4, 1.1], 'upper']]) {
        const actual = v.sourceWorldToDisplay(source, floor); if (!actual.ok) { capture[name] = { valid: false, diagnostics: actual.diagnostics }; continue; }
        const world = v.camera.position.clone().set(...actual.point), projected = world.clone().project(v.camera), screen = v.projectWorld(world);
        const x = Math.round((projected.x + 1) * width / 2), y = Math.round((projected.y + 1) * height / 2);
        const valid = x >= 3 && y >= 3 && x < width - 3 && y < height - 3 && projected.z > -1 && projected.z < 1;
        const rgb = [0, 1, 2].map((channel) => { const samples = [];
          if (valid) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) samples.push(buffer[((y + dy) * width + x + dx) * 4 + channel]);
          samples.sort((a, b) => a - b); return samples[24];
        });
        const hit = screen && v._modelHit(screen[0], screen[1]);
        capture[name] = { valid, rgb, source, display: actual.point, screen, role: hit?.object?.userData.floorsTestRole,
          floor: hit && v.floorForModelNode(hit.object), sourceRoundTrip: v.displayWorldToSource(actual.point, floor) };
      }
      f.capture = capture; f.captures.push(capture);
    };
  });
}
async function restoreObservers(page) {
  return page.evaluate(() => { const c = document.querySelector('taylors3d-card') || window.floorsFixture?.detached, f = window.floorsFixture;
    if (!f) return true;
    if (Object.hasOwn(f, 'hiddenDescriptor')) { if (f.hiddenDescriptor) Object.defineProperty(document, 'hidden', f.hiddenDescriptor); else delete document.hidden; delete f.hiddenDescriptor; }
    if (Object.hasOwn(f, 'previousRender') && c?._view) { c._view.onRender = f.previousRender; return c._view.onRender === f.previousRender; }
    return true;
  });
}
async function camera(page, position = [15, 17, 19], target = [3, 1.6, 0]) {
  context = 'actual floor camera'; await page.evaluate(({ position, target }) => {
    const c = document.querySelector('taylors3d-card'); window.floorsFixture.captureRequested = true;
    c._view.stopCameraMotion(); c._view.setCamera({ position, target }, { instant: true });
  }, { position, target }); await ready(page);
}
async function policy(page, value) {
  context = 'saved floor policy ' + JSON.stringify(value); await page.evaluate((value) => {
    const c = document.querySelector('taylors3d-card'); window.floorsFixture.captureRequested = true;
    c.commitFeatureLayout({ floor_presentation: value });
  }, value); await ready(page, { model: await page.evaluate(() => !!document.querySelector('taylors3d-card')._config.model) });
}
async function snapshot(page) {
  return page.evaluate((ids) => { const c = document.querySelector('taylors3d-card'), v = c._view, f = window.floorsFixture;
    const encode = (value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
    const frame = v.captureCameraFrame?.();
    return { report: c.floorPresentationReport(), saved: c._layout.floor_presentation, revision: v.floorPresentationRevision,
      stats: { ...v.stats }, objectStats: { budget: c._objects.stats.budget, shadowRequests: c._objects.stats.shadowRequests }, resources: { ...v.renderer.info.memory }, programs: v.renderer.info.programs.map((program) => program.id),
      levels: Object.fromEntries((v.model?.manifest.levels || []).map((level) => [level.id, { position: level.node.position.toArray(), world: level.node.getWorldPosition(v.camera.position.clone()).toArray(),
        floor: v.floorForModelNode(level.node), shown: level.node.visible }])),
      anchors: (c._objects.anchors() || []).map((anchor) => ({ id: anchor.id, world: anchor.world.toArray() })),
      displayAnchors: (c._objects.displayAnchors() || []).map((anchor) => ({ id: anchor.id, world: anchor.world.toArray() })),
      light: (() => { const slot = c._objects._slots.get(ids.lamp); return slot && { world: slot.light.position.toArray(), intensity: slot.light.intensity, uuid: slot.light.uuid }; })(),
      pool: [...c._objects.pool.points, ...c._objects.pool.spots].map((light) => ({ uuid: light.uuid, type: light.type, castShadow: light.castShadow })),
      gpu: { lamps: [...c._objects.pool.points, ...c._objects.pool.spots].map((light) => [light.uuid, light.position.toArray(), light.color.toArray(), light.intensity, light.shadow?.needsUpdate]),
        materials: [...(f.originals?.keys() || [])].filter((node) => v.model && node.isMesh).map((node) => {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          return [node.uuid, node.geometry.uuid, ...materials.map((material) => [material.uuid, material.version, material.opacity,
            material.color?.toArray(), material.emissive?.toArray(), material.emissiveIntensity])];
        }) },
      unchangedResources: !v.model || [...(f.originals?.entries() || [])].every(([node, original]) => node.geometry === original.geometry && node.material === original.material),
      contexts: window.floorContexts.size, rendererSame: f.renderer === v.renderer, calls: f.services.length, capture: f.capture,
      camera: frame && JSON.parse(JSON.stringify({ position: frame.position, target: frame.target, quaternion: frame.quaternion, up: frame.up,
        zoom: frame.zoom, framing: frame.framing, mode: frame.mode }, (_key, value) => encode(value))), editing: c._editing, view: c._viewId, mode: c._mode,
      selectedRoom: c._selectedRoomId, popup: c._devicePopup.el?.textContent, savedModel: structuredClone(c._layout.model),
      resolvedLevels: structuredClone(c._mb?.levels), commits: f.commits };
  }, ids);
}
async function unrelated(page, model = true) {
  const before = await snapshot(page);
  await page.evaluate(async (entity) => { const c = document.querySelector('taylors3d-card');
    for (let index = 1; index <= 10; index++) { c.hass = { ...c._hass, states: { ...c._hass.states,
      [entity]: { state: String(index), attributes: { friendly_name: 'Known unrelated sensor' } } } };
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }, entities.unrelated); await ready(page, { model }); const after = await snapshot(page);
  check('ten unrelated readings add zero frames, shadows, budget writes, allocations and coordinate shifts', equal(before.stats, after.stats)
    && equal(before.objectStats, after.objectStats) && equal(before.resources, after.resources) && equal(before.programs, after.programs)
    && equal(before.gpu, after.gpu) && equal(before.levels, after.levels) && before.revision === after.revision && after.unchangedResources && after.calls === 0,
  { before: { stats: before.stats, objects: before.objectStats, resources: before.resources, revision: before.revision },
    after: { stats: after.stats, objects: after.objectStats, resources: after.resources, revision: after.revision }, gpuUnchanged: equal(before.gpu, after.gpu) });
}

async function defaultAndEditor(page, mode) {
  const initial = await snapshot(page);
  check('unconfigured floor presentation preserves the assembled source hierarchy and default work', initial.report.mode === 'assembled'
    && initial.levels.fp_ground.position[1] === 0 && initial.levels.fp_upper.position[1] === 4 && initial.revision === 0
    && initial.contexts === 1 && initial.rendererSame, initial);
  await unrelated(page); await policy(page, { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2, axis: 'east', base_elevation_m: 0 });
  const unconfirmed = await snapshot(page);
  check('suggested floor links do not authorize moving geometry', unconfirmed.report.mode === 'assembled' && !unconfirmed.report.valid
    && unconfirmed.report.diagnostics.some((issue) => issue.code === 'confirm_floor_link') && equal(unconfirmed.levels, initial.levels), unconfirmed.report);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="model"]');
  for (const [id, value] of [[ids.ground, 'floor:ground'], [ids.upper, 'floor:upper'], [ids.background, 'none']]) {
    await control(page, `[data-field="md-level"][data-id="${id}"]`, (element) => element.select(value));
  }
  const editing = await snapshot(page);
  check('native level choices save exact confirmed floors and explicit background while Edit remains assembled', editing.resolvedLevels.fp_ground.auto === false
    && editing.savedModel.levels.fp_ground.floor === 'ground' && editing.savedModel.levels.fp_upper.floor === 'upper'
    && editing.resolvedLevels.fp_upper.auto === false && editing.savedModel.levels.fp_site.floor === null && editing.resolvedLevels.fp_site.auto === false
    && editing.report.mode === 'assembled' && editing.calls === 0, editing);
  await select(page, 'mode', 'vertical'); await type(page, 'gap_m', 2.25);
  const focus = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector('[data-field="floor-presentation-gap_m"]');
    window.floorsFixture.focusedGap = input; c.hass = { ...c._hass, states: { ...c._hass.states } }; c._edit.afterUpdate();
    return { same: input === c.shadowRoot.querySelector('[data-field="floor-presentation-gap_m"]'), focused: c.shadowRoot.activeElement === input,
      value: input.value, draft: c._edit._floorPresentationEditor.draft, saved: c._layout.floor_presentation };
  });
  check('numeric draft focus/value survives real HA update and parent refresh without applying geometry', focus.same && focus.focused && focus.value === '2.25'
    && focus.draft.mode === 'vertical' && focus.saved.mode === 'horizontal', focus);
  const beforeSave = await snapshot(page); await click(page, action('save')); await settle(page);
  const saved = await snapshot(page);
  check('native Save records the explicit floor policy once without HA actions or live Edit shifts', saved.saved.mode === 'vertical'
    && saved.saved.gap_m === 2.25 && saved.commits === beforeSave.commits + 1 && saved.report.mode === 'assembled' && saved.calls === 0, saved);
  await click(page, '[data-act="history-undo"]'); const undone = await snapshot(page);
  check('Undo restores exact previous floor choice', undone.saved.mode === 'horizontal' && undone.saved.gap_m === 2, undone.saved);
  await click(page, '[data-act="history-redo"]'); const redone = await snapshot(page);
  check('Redo restores exact saved spacing/order', redone.saved.mode === 'vertical' && redone.saved.gap_m === 2.25, redone.saved);
  await type(page, 'gap_m', 9); await click(page, action('cancel'));
  check('Cancel keeps the saved setting and resets the typed draft', await page.evaluate(() => { const c = document.querySelector('taylors3d-card');
    return c._layout.floor_presentation.gap_m === 2.25 && c.shadowRoot.querySelector('[data-field="floor-presentation-gap_m"]').value === '2.25';
  }));
  await screenshot(page, `floors-editor${mode === 'bundle' ? '-bundle' : ''}.png`);
  await click(page, 'button.edit'); await ready(page); await installPixels(page); await policy(page, { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2, axis: 'east', base_elevation_m: 0 });
}

async function measuredVisuals(page, mode) {
  await camera(page); let current = await snapshot(page);
  const rows = current.report.rows, ground = rows.find((row) => row.floor_id === 'ground'), upper = rows.find((row) => row.floor_id === 'upper');
  check('horizontal separation uses actual measured footprint edge plus two metres', current.report.valid && current.report.mode === 'horizontal'
    && near(upper.bounds.min[0] + upper.offset[0] - ground.bounds.max[0] - ground.offset[0], 2)
    && near(current.levels.fp_ground.world[1], 0) && near(current.levels.fp_upper.world[1], 0), { rows, levels: current.levels });
  check('real GPU pixels expose the actual blue ground and orange upper surfaces at DISPLAY positions', current.capture.ground.valid && current.capture.upper.valid
    && current.capture.ground.role === 'ground-floor' && current.capture.upper.role === 'upper-floor'
    && current.capture.ground.rgb[2] > current.capture.ground.rgb[0] * 1.8 && current.capture.upper.rgb[0] > current.capture.upper.rgb[2] * 1.8,
  current.capture);
  check('probed coordinates round-trip exactly to their real saved floors', pointsNear(current.capture.ground.sourceRoundTrip.point, current.capture.ground.source)
    && pointsNear(current.capture.upper.sourceRoundTrip.point, current.capture.upper.source), current.capture);
  const source = current.anchors.find((anchor) => anchor.id === ids.lamp), display = current.displayAnchors.find((anchor) => anchor.id === ids.lamp);
  check('physical lamp pool follows DISPLAY while public SOURCE anchor stays canonical', source && display
    && pointsNear(display.world, source.world.map((value, index) => value + upper.offset[index]))
    && pointsNear(current.light.world, display.world) && current.light.intensity > 0 && current.pool.length === 12
    && current.pool.filter((lamp) => lamp.castShadow).length === 4 && current.unchangedResources, { source, display, light: current.light, pool: current.pool });
  await screenshot(page, `floors-horizontal${mode === 'bundle' ? '-bundle' : ''}.png`);
  await unrelated(page);
  const before = await snapshot(page); await policy(page, structuredClone(before.saved)); const equalPolicy = await snapshot(page);
  check('equal cloned active settings add zero frames/resources/revisions or accumulated shifts', equal(before.stats, equalPolicy.stats)
    && equal(before.resources, equalPolicy.resources) && equal(before.gpu, equalPolicy.gpu) && before.revision === equalPolicy.revision && equal(before.levels, equalPolicy.levels), { before: before.stats, after: equalPolicy.stats });
  await policy(page, { ...before.saved, axis: 'north', base_elevation_m: 1 }); await camera(page, [14, 16, 18], [0, 1, -3]); current = await snapshot(page);
  const northGround = current.report.rows.find((row) => row.floor_id === 'ground'), northUpper = current.report.rows.find((row) => row.floor_id === 'upper');
  check('north split moves toward negative world Z and keeps the measured two-metre gap', near(northGround.bounds.min[2] + northGround.offset[2]
    - northUpper.bounds.max[2] - northUpper.offset[2], 2) && near(current.levels.fp_ground.world[1], 1) && near(current.levels.fp_upper.world[1], 1), current.report);
  await policy(page, { mode: 'vertical', floors: ['ground', 'upper'], gap_m: 2.5, axis: 'east', base_elevation_m: 0 });
  await camera(page, [14, 17, 18], [0, 3, 0]); current = await snapshot(page);
  check('vertical layers preserve saved elevation plus explicit extra spacing', near(current.levels.fp_ground.world[1], 0)
    && near(current.levels.fp_upper.world[1], 6.5) && near(current.report.rows.find((row) => row.floor_id === 'upper').offset[1], 2.5), current.report);
  await screenshot(page, `floors-vertical${mode === 'bundle' ? '-bundle' : ''}.png`);
  for (let index = 0; index < 3; index++) { await policy(page, { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2 }); await policy(page, { mode: 'assembled' }); }
  current = await snapshot(page);
  check('repeated separation/restore returns exact authored level poses and shared resources', near(current.levels.fp_upper.position[1], 4)
    && near(current.levels.fp_upper.position[0], 0) && current.unchangedResources && current.rendererSame && current.contexts === 1, current.levels);
  await policy(page, { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2 }); await camera(page);
}

async function picking(page) {
  const point = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), v = c._view, f = window.floorsFixture;
    const probe = f.capture.upper, hit = v.pickModel(...probe.screen); return { screen: probe.screen, kind: hit?.kind, id: hit?.id,
      floor: v.floorForModelNode(hit?.hit?.object), source: v.displayPlanPoint(...probe.screen, 'upper'), object: c._objectHit(...probe.screen, 30),
      target: (() => { const el = c.shadowRoot.elementFromPoint(...probe.screen); return el && { tag: el.tagName, class: el.className, marker: el.dataset?.id }; })(),
      visiblePopup: !!c._devicePopup.el && !c._devicePopup.el.hidden, room: c._roomList.find((entry) => entry.room.modelId === 'fp_room_upper') };
  });
  check('actual upper-floor triangle resolves its room and canonical SOURCE coordinates', point.kind === 'room' && point.id === ids.upperRoom
    && point.floor === 'upper' && pointsNear(point.source, [1.2, -1.1]), point);
  if (point.kind !== 'room' || point.id !== ids.upperRoom) throw new Error('Room fixture surface not exposed');
  // The colour probe remains fixed. A room tap deliberately avoids the real
  // object's anchor-radius priority, using only these authored floor points.
  const roomTap = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view;
    const authoredPoints = [[1.2, -1.1], [-1.6, -1.1], [1.6, -1.1], [-1.6, 1.1], [1.6, 1.1], [0, 1.1], [0, -1.1], [-1.6, 0], [1.6, 0]];
    const candidates = authoredPoints.map(([x, y]) => {
      const mapped = v.sourceWorldToDisplay([x, 4, -y], 'upper'), screen = mapped.ok && v.projectWorld(v.camera.position.clone().fromArray(mapped.point));
      if (!screen) return { source: [x, y], screen: null };
      const hit = v.pickModel(...screen), target = c.shadowRoot.elementFromPoint(...screen);
      return { source: [x, y], screen, kind: hit?.kind, id: hit?.id, floor: v.floorForModelNode(hit?.hit?.object),
        roundTrip: v.displayPlanPoint(...screen, 'upper'), object: c._objectHit(...screen, 30), canvas: target === v.renderer.domElement };
    });
    return { chosen: candidates.find((entry) => entry.kind === 'room' && entry.id === 'fp_room_upper'
      && entry.floor === 'upper' && entry.object === null && entry.canvas), candidates };
  });
  check('native room tap uses an exposed authored floor point outside the actual device targets', roomTap.chosen
    && pointsNear(roomTap.chosen.roundTrip, roomTap.chosen.source) && !roomTap.chosen.object && roomTap.chosen.canvas, roomTap);
  if (!roomTap.chosen) throw new Error('No authored room tap point is clear of actual device targets');
  await page.mouse.click(...roomTap.chosen.screen); await settle(page);
  const selected = await snapshot(page);
  check('native room-floor tap opens that floor’s real linked area panel', selected.popup?.includes('Simulated upper room') && selected.calls === 0,
    { selected: selected.selectedRoom, popup: selected.popup, precondition: roomTap.chosen, pixelProbe: point });
  await click(page, '.t3d-popup-close'); await ready(page); await camera(page);
  const object = await page.evaluate((id) => { const c = document.querySelector('taylors3d-card'), v = c._view;
    const anchor = c._objects.displayAnchors().find((anchor) => anchor.id === id), screen = anchor && v.projectWorld(anchor.world), hit = screen && c._objectHit(...screen, 24);
    return { screen, id: hit, hidden: anchor && v.pointHidden(anchor.world, c._objects.objectAt(id).obj.node) };
  }, ids.switch);
  check('physical object click precondition uses its actual translated anchor', object.id === ids.switch && !object.hidden, object);
  if (object.id !== ids.switch || object.hidden) throw new Error('Translated switch anchor is not clickable');
  await page.mouse.click(...object.screen); await settle(page); const popup = await snapshot(page);
  check('native translated device tap opens the actual entity controls without toggling it', popup.popup?.includes('Simulated upper switch') && popup.calls === 0, popup.popup);
  await click(page, '.t3d-popup-close'); await ready(page);
}

async function featureSnapshot(page) {
  return page.evaluate((ids) => {
    const c = document.querySelector('taylors3d-card'), v = c._view;
    const world = (node) => node?.getWorldPosition(v.camera.position.clone()).toArray();
    return { rows: c.floorPresentationReport().rows,
      tracking: c._trackingData.records.map((record) => ({ id: record.id, shown: record.shown, location: record.location })),
      displayedTracking: [...c._trackingLayer.parts].map(([id, part]) => ({ id, world: world(part.group) })),
      map: { data: [...c._miniMap._data.positions], tracked: c._miniMap._data.trackedMarkers,
        floor: c._miniMap.scene.floorId, scene: c._miniMap.scene.markers, camera: c._miniMap._camera },
      room: (() => { const part = c._statusOverlays.rooms.get(`upper:m:${ids.upperRoom}`); return part && {
        height: part.mesh.position.y, vertices: Array.from(part.mesh.geometry.attributes.position.array), color: part.mesh.material.color.getHexString() }; })(),
      alert: (() => { const part = c._statusOverlays.alerts.get('upper-leak'); return part && { world: world(part.mesh), active: part.active,
        source: c._alertData.alerts.find((entry) => entry.id === 'upper-leak')?.location }; })(),
      cone: (() => { const part = c._cameraCoverage.sectors.get(`object:${ids.camera}`); return part && { world: world(part.group), floor: part.group.userData.floorId }; })(),
      cameraSource: c.cameraAnchors().find((anchor) => anchor.id === `object:${ids.camera}`),
      weather: { samples: structuredClone(c._weatherLayer._samples.rain), source: c.weatherFootprints(), visible: c._weatherLayer.group.visible },
      mower: { live: c._mowerLive, source: c._objects.anchorOf(ids.mower)?.toArray(), display: c._objects.displayAnchorOf(ids.mower)?.toArray(),
        floor: c._objects.objectAt(ids.mower)?.part.displayFloorId },
      contact: { part: c._securityLayer.parts.get('hinge')?.reading, quaternion: window.floorsFixture.nodes['door-leaf'].quaternion.toArray() },
      transforms: { levels: Object.fromEntries(Object.entries(window.floorsFixture.levels).map(([id, node]) => [id, node.position.toArray()])),
        mowerLocal: window.floorsFixture.nodes.fp_mower.position.toArray(), mowerWorld: world(window.floorsFixture.nodes.fp_mower),
        authoredMower: c._objects.objectAt(ids.mower)?.part.origin?.position.toArray() },
      calls: window.floorsFixture.services.length };
  }, ids);
}

async function featuresAndExport(page) {
  context = 'saved evidence layers follow separated floors';
  // Static weather and the genuine reduced-motion preference remove ongoing
  // decorative frames, so strict unrelated-update idle checks remain meaningful.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const beforeFeatures = await snapshot(page);
  await page.evaluate(({ entities, ids }) => {
    const c = document.querySelector('taylors3d-card');
    c.commitFeatureLayout({ room_overlays: { mode: 'temperature', bindings: { [`m:${ids.upperRoom}`]: { entities: [entities.temperature] } } },
      alert_bindings: [{ id: 'upper-leak', entity: entities.leak, type: 'leak', roomId: `m:${ids.upperRoom}` }],
      presence_bindings: [{ id: 'upstairs', entity: entities.presence, kind: 'room_location',
        room_source: { entity: entities.presence, room_map: { upstairs: `m:${ids.upperRoom}` } } }],
      camera_coverage: { [`object:${ids.camera}`]: { enabled: true, heading: 0, fov: 60, range: 2, color: '#4ba3ff', opacity: .12 } },
      weather: { enabled: true, entity: entities.weather, quality: 'static', intensity: .4, effects: ['rain'] },
      security_bindings: [{ id: 'hinge', entity: entities.door, object_id: ids.door, kind: 'door', contact_source_confirmed: true,
        open_states: ['on'], closed_states: ['off'], highlight: { closed: '#66bb6a' },
        motion: { target: 'leaf', pivot: [0, 0, 0], axis: [0, 1, 0], closed_degrees: 0, open_degrees: 90, duration_ms: 0 } }] });
    c.hass = { ...c._hass, states: { ...c._hass.states,
      [entities.leak]: { state: 'on', attributes: { friendly_name: 'Simulated upper leak', device_class: 'moisture' } },
      [entities.door]: { state: 'on', attributes: { friendly_name: 'Simulated hinge contact', device_class: 'door' } } } };
  }, { entities, ids }); await ready(page); let features = await featureSnapshot(page);
  const upper = features.rows.find((row) => row.floor_id === 'upper'), record = features.tracking.find((entry) => entry.id === 'presence:upstairs');
  const ground = features.rows.find((row) => row.floor_id === 'ground');
  check('adding a real hinge writer and cross-floor mower preserves measured SOURCE footprints and split spacing',
    near(ground?.bounds.max[0], 3) && near(upper?.offset[0], 7)
    && equal(features.rows.map(({ floor_id, bounds, offset }) => ({ floor_id, bounds, offset })),
      beforeFeatures.report.rows.map(({ floor_id, bounds, offset }) => ({ floor_id, bounds, offset }))),
    { before: beforeFeatures.report.rows, after: features.rows, transforms: features.transforms });
  const displayed = features.displayedTracking.find((entry) => entry.id === 'presence:upstairs');
  check('presence uses canonical exact-room evidence while its actual 3D symbol follows that displayed floor', record?.shown && record.location.floorId === 'upper'
    && near(record.location.x, 0) && near(record.location.y, 0) && displayed
    && pointsNear(displayed.world, [upper.offset[0], 4 + record.location.z + upper.offset[1], upper.offset[2]]),
  { source: features.tracking, displayed: features.displayedTracking, rows: features.rows, transforms: features.transforms,
    previousRows: beforeFeatures.report.rows, sourceMower: features.mower.source, displayMower: features.mower.display });
  const alertSource = features.alert?.source;
  check('temperature polygon and leak location receive the same floor offset without changing real HA readings', features.room
    && near(features.room.height, 4 + upper.offset[1] + .018) && features.room.vertices.some((number) => number > upper.offset[0] - 2.001)
    && features.alert?.active && alertSource && pointsNear(features.alert.world,
      [alertSource.x + upper.offset[0], alertSource.elevation + alertSource.z + upper.offset[1], -alertSource.y + upper.offset[2]]), { room: features.room, alert: features.alert });
  const anchor = features.cameraSource?.position;
  check('explicit approximate camera sector follows DISPLAY but its source anchor remains unchanged', anchor && features.cone?.floor === 'upper'
    && pointsNear(features.cone.world, [anchor.x + upper.offset[0], anchor.elevation + upper.offset[1] + .035, -anchor.y + upper.offset[2]]), { cone: features.cone, source: anchor });
  const rain = features.weather.samples.filter((sample) => sample.floorId === 'upper');
  check('static real-weather particles use only the shifted explicit upper outdoor polygon', features.weather.visible && rain.length > 0
    && rain.every((sample) => sample.x >= 2.4 + upper.offset[0] && sample.x <= 3.2 + upper.offset[0]
      && sample.y >= -1 - upper.offset[2] && sample.y <= 1 - upper.offset[2] && near(sample.elevation, 4 + upper.offset[1]))
    && features.weather.source.outdoors.find((region) => region.id === 'outdoor-upper').polygon[0][0] === 2.4, features.weather);
  const mowerMap = features.map.data.find(([id]) => id === `object:${ids.mower}`)?.[1];
  check('measured mower on another floor keeps its actual SOURCE location and correct mini-map floor', features.mower.live?.floorId === 'upper'
    && features.mower.floor === 'upper' && near(features.mower.source[0], .9) && near(features.mower.source[2], .6)
    && pointsNear(features.mower.display, features.mower.source.map((number, index) => number + upper.offset[index]))
    && mowerMap?.floorId === 'upper' && near(mowerMap.x, .9) && near(mowerMap.y, -.6), { mower: features.mower, map: mowerMap });
  await control(page, '.map-floor', (element) => element.select('upper')); features = await featureSnapshot(page);
  check('north-up mini-map stays in SOURCE coordinates instead of spreading its room outlines', features.map.floor === 'upper'
    && features.map.scene.some((marker) => marker.id === 'presence:upstairs' && near(marker.x, 0) && near(marker.y, 0))
    && features.map.scene.some((marker) => marker.id === `object:${ids.mower}` && near(marker.x, .9)), features.map);
  const focused = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), node = c._miniMap.el.querySelector('[data-marker="presence:upstairs"]');
    return node && { x: node.getBoundingClientRect().x + node.getBoundingClientRect().width / 2,
      y: node.getBoundingClientRect().y + node.getBoundingClientRect().height / 2 }; });
  if (!focused) throw new Error('Explicit upper presence dot missing from mini-map');
  await page.mouse.click(focused.x, focused.y); await settle(page);
  const popup = await snapshot(page); check('native mini-map tracking tap opens the actual observation source without HA actions', popup.popup?.includes('Simulated exact room report') && popup.calls === 0, popup.popup);
  await click(page, '.t3d-popup-close'); await ready(page);

  context = 'read-only real GLTFExporter source adapter proof';
  const exported = await page.evaluate(async (ids) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, f = window.floorsFixture, adapted = v.sourceModelRootForExport();
    if (!adapted.ok) return { ok: false, diagnostics: adapted.diagnostics };
    const sourceNodes = {}, displayedNodes = {};
    adapted.root.updateWorldMatrix(true, true);
    adapted.root.traverse((node) => { if (node.userData.floorsTestRole) sourceNodes[node.userData.floorsTestRole] = node; });
    for (const [id, node] of Object.entries(f.nodes)) displayedNodes[id] = node.getWorldPosition(v.camera.position.clone()).toArray();
    const refs = [];
    adapted.root.traverse((node) => { if (node.isMesh) {
      const original = f.nodes[node.userData.floorsTestRole]; if (original) refs.push(node.geometry === original.geometry && node.material === original.material);
    } });
    // Transient security outlines are editor/rendering helpers, not authored
    // model geometry. Remove helpers only on this detached export clone.
    const helpers = []; adapted.root.traverse((node) => { if (node.userData.helper) helpers.push(node); });
    for (const node of helpers) node.removeFromParent();
    const before = JSON.stringify(displayedNodes), { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    // An export-adapter test only. The app does not expose an export button.
    const json = await new GLTFExporter().parseAsync(adapted.root, { binary: false, onlyVisible: false });
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'), decoded = await new GLTFLoader().parseAsync(JSON.stringify(json), location.href);
    const decodedNodes = {}; decoded.scene.updateWorldMatrix(true, true);
    decoded.scene.traverse((node) => { if (node.userData.floorsTestRole) decodedNodes[node.userData.floorsTestRole] = {
      world: node.getWorldPosition(v.camera.position.clone()).toArray(), quaternion: node.quaternion.toArray() }; });
    const actual = {}; for (const [id, node] of Object.entries(f.nodes)) actual[id] = node.getWorldPosition(v.camera.position.clone()).toArray();
    return { ok: true, distinct: adapted.root !== v.model.root, refs: refs.every(Boolean), noMutation: before === JSON.stringify(actual),
      decoded: decodedNodes, sourceMower: sourceNodes[ids.mower]?.getWorldPosition(v.camera.position.clone()).toArray(),
      sourceLeaf: sourceNodes['door-leaf']?.quaternion.toArray(), actualLeaf: f.nodes['door-leaf'].quaternion.toArray(),
      calls: f.services.length, meshes: json.meshes.length };
  }, ids);
  check('real exporter serializes authored floor locations while current displayed house stays untouched', exported.ok && exported.distinct && exported.refs && exported.noMutation
    && near(exported.decoded.fp_ground.world[1], 0) && near(exported.decoded.fp_upper.world[1], 4) && exported.calls === 0 && exported.meshes > 0, exported);
  check('source export retains real upper-floor mower measurements and current authored hinge child motion', exported.ok
    && near(exported.sourceMower[0], .9) && near(exported.sourceMower[2], .6) && exported.sourceMower[1] >= 4
    && pointsNear(exported.decoded.fp_mower.world, exported.sourceMower) && pointsNear(exported.sourceLeaf, exported.actualLeaf)
    && pointsNear(exported.decoded['door-leaf'].quaternion, exported.actualLeaf) && Math.abs(exported.actualLeaf[1]) > .7, exported);
  await unrelated(page);
  await page.evaluate(() => document.querySelector('taylors3d-card').commitFeatureLayout({
    room_overlays: { mode: 'off' }, alert_bindings: [], presence_bindings: [], camera_coverage: {}, weather: { enabled: false }, security_bindings: [] }));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); await ready(page);
}

async function lifecycleAndCamera(page) {
  context = 'native Section suspends only floor display arrangement';
  await click(page, 'button.section'); await ready(page); const section = await snapshot(page);
  check('native Section restores assembled geometry and retains the saved split choice', section.report.mode === 'assembled'
    && section.saved.mode === 'horizontal' && near(section.levels.fp_upper.position[1], 4) && section.report.diagnostics.some((entry) => entry.code === 'presentation_suspended'), section.report);
  await click(page, 'button.section'); await ready(page); const restored = await snapshot(page);
  check('closing Section reapplies split with identical original materials and fixed lamp pool', restored.report.mode === 'horizontal'
    && restored.unchangedResources && equal(restored.pool, section.pool) && restored.calls === 0, restored.report);
  await policy(page, { mode: 'assembled' }); await page.evaluate(() => document.querySelector('taylors3d-card')._setView('upper', { instant: true })); await ready(page);
  await camera(page, [5.123456789, 9.432109876, 8.678901234], [.123456789, 4.234567891, -.345678912]);
  const source = await snapshot(page);
  await policy(page, { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2 }); let split = await snapshot(page);
  const offset = split.report.rows.find((row) => row.floor_id === 'upper').offset;
  check('single-floor camera and orbit target translate by the same measured display offset', pointsNear(split.camera.position, source.camera.position.map((number, index) => number + offset[index]))
    && pointsNear(split.camera.target, source.camera.target.map((number, index) => number + offset[index]))
    && pointsNear(split.camera.quaternion, source.camera.quaternion), { source: source.camera, split: split.camera, offset });
  await policy(page, { mode: 'assembled' }); const back = await snapshot(page);
  check('closing split restores unrounded camera within double precision and exact framing limits',
    ['position', 'target', 'quaternion'].every((key) => back.camera[key].every((number, index) => near(number, source.camera[key][index], 1e-12)))
    && equal(back.camera.up, source.camera.up) && back.camera.zoom === source.camera.zoom && back.camera.mode === source.camera.mode
    && equal(back.camera.framing, source.camera.framing), { source: source.camera, restored: back.camera });
  await policy(page, { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2 });
  const preset = { position: [6.5, 10, 7.5], target: [.25, 4, -.25] };
  await page.evaluate((preset) => { const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ views: { ...c._layout.views,
    upper: { ...c._layout.views.upper, camera: preset } } }); }, preset); await ready(page);
  // Native named preset, not a direct camera shortcut.
  await click(page, '[data-view="upper"]'); await ready(page); split = await snapshot(page);
  const presetOffset = split.report.rows.find((row) => row.floor_id === 'upper').offset;
  check('native saved upper view uses translated camera without mutating its canonical preset', pointsNear(split.camera.position, preset.position.map((number, index) => number + presetOffset[index]))
    && pointsNear(split.camera.target, preset.target.map((number, index) => number + presetOffset[index]))
    && await page.evaluate((preset) => JSON.stringify(document.querySelector('taylors3d-card')._layout.views.upper.camera) === JSON.stringify(preset), preset), split.camera);
  await page.evaluate(() => document.querySelector('taylors3d-card')._setView('all', { instant: true })); await ready(page); await camera(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.floorsFixture.detached = c; c.remove(); }); await settle(page);
  const detached = await page.evaluate((ids) => { const c = window.floorsFixture.detached, f = window.floorsFixture;
    return { upper: f.levels[ids.upper].position.toArray(), raf: !!c._view._raf, active: c._view.floorPresentationActive,
      saved: c._layout.floor_presentation, renderer: c._view.renderer === f.renderer }; }, ids);
  check('disconnect restores source hierarchy and stops the existing renderer while retaining policy/resources', !detached.raf && !detached.active
    && near(detached.upper[1], 4) && near(detached.upper[0], 0) && detached.saved.mode === 'horizontal' && detached.renderer, detached);
  await page.evaluate(() => document.querySelector('section.theme').append(window.floorsFixture.detached)); await page.bringToFront(); await ready(page);
  check('reconnection reapplies current saved separation using the same renderer and authored resources', (await snapshot(page)).report.mode === 'horizontal'
    && (await snapshot(page)).unchangedResources && (await snapshot(page)).contexts === 1);
}

async function floorContrast(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-floor-presentation-editor]');
    const luma = (colour) => { const channels = colour.match(/[\d.]+/g)?.slice(0, 3).map(Number); if (channels?.length !== 3) return NaN;
      return channels.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0); };
    return [...form.querySelectorAll('input,select,button')].filter((element) => !element.disabled && element.getClientRects().length).map((element) => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect(), a = luma(style.color), b = luma(style.backgroundColor);
      return { id: element.dataset.field || element.dataset.act, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
        height: rect.height, left: rect.left, right: rect.right, viewport: innerWidth };
    });
  });
}

async function replaceModel(page, filename) {
  context = 'actual GLB replacement ' + filename;
  await page.evaluate((filename) => { const c = document.querySelector('taylors3d-card'); window.floorsFixture.replacedRoot = c._view.model?.root;
    c.setConfig({ ...c._config, model: '/demo/' + filename, merge: false }); }, filename);
  await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return !!c._view.model && !c._loading
    && c._view.model.root !== window.floorsFixture.replacedRoot && c._objects.parts.has('fp_lamp'); }, { timeout: 30000 });
  await ready(page); await captureOriginals(page);
}

async function malformedAndNarrow(page, mode) {
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="model"]'); await type(page, 'gap_m', 3);
  const light = await floorContrast(page);
  check('real floor controls, explicit floor list and Save/Cancel have AA light-theme text and 44px targets', light.some((entry) => entry.id === 'floor-presentation-save')
    && light.some((entry) => entry.id === 'floor-presentation-floor') && light.every((entry) => entry.ratio >= 4.5 && entry.height >= 44), light);
  await page.evaluate(() => { const section = document.querySelector('section.theme'); section.classList.replace('light', 'dark'); });
  const dark = await floorContrast(page);
  check('the same real native controls retain AA dark-theme text', dark.length === light.length && dark.every((entry) => entry.ratio >= 4.5 && entry.height >= 44), dark);
  await page.setViewport({ width: 320, height: 1100, deviceScaleFactor: 1, hasTouch: true }); await settle(page); const narrow = await floorContrast(page);
  check('320px floor editor retains all 44px native controls without page overflow', narrow.length === dark.length
    && narrow.every((entry) => entry.ratio >= 4.5 && entry.height >= 44 && entry.left >= -1 && entry.right <= entry.viewport + 1)
    && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), narrow);
  await control(page, field('mode'), (element) => element.focus());
  await screenshot(page, `floors-editor-narrow${mode === 'bundle' ? '-bundle' : ''}.png`, true);
  await click(page, action('cancel')); await type(page, 'gap_m', 3.5);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.floorsFixture.admin = c._hass.user;
    c.hass = { ...c._hass, user: { ...c._hass.user, is_admin: false } }; }); await settle(page);
  const denied = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return { editing: c._editing,
    saved: c._layout.floor_presentation, form: !!c.shadowRoot.querySelector('[data-floor-presentation-editor]'), calls: window.floorsFixture.services.length }; });
  check('revoked actual administrator permission cannot publish a typed floor draft', denied.saved.gap_m === 2 && denied.calls === 0
    && (!denied.editing || !denied.form || await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-act="floor-presentation-save"]')?.disabled)), denied);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, user: window.floorsFixture.admin }; });
  if (!await page.evaluate(() => document.querySelector('taylors3d-card')._editing)) await click(page, 'button.edit');
  await click(page, '[data-act="tab"][data-id="model"]'); await click(page, action('cancel'));
  await type(page, 'gap_m', 4.5);
  context = 'a genuine model source replacement invalidates an unfinished floor draft';
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.floorsFixture.replacedRoot = c._view.model.root;
    c.setConfig({ ...c._config, model: '/demo/floor-presentation.glb?editor-context=1', merge: false }); });
  await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return !!c._view.model && !c._loading
    && c._view.model.root !== window.floorsFixture.replacedRoot && c._objects.parts.has('fp_lamp'); }, { timeout: 30000 }); await ready(page);
  const staleDraft = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return {
    value: c.shadowRoot.querySelector('[data-field="floor-presentation-gap_m"]').value,
    disabled: c.shadowRoot.querySelector('[data-act="floor-presentation-save"]').disabled,
    status: c.shadowRoot.querySelector('[data-floor-presentation-status]').textContent, saved: c._layout.floor_presentation }; });
  check('new model source retains typed draft but blocks Save until deliberate Cancel', staleDraft.value === '4.5' && staleDraft.disabled
    && staleDraft.saved.gap_m === 2 && /changed|Cancel/.test(staleDraft.status), staleDraft);
  await click(page, action('cancel')); await captureOriginals(page);
  await page.evaluate(() => document.querySelector('taylors3d-card').commitFeatureLayout({ floor_presentation: {
    mode: 'horizontal', floors: ['ground', 'missing-exact-floor'], gap_m: 2, retained: 'unchanged-import' } })); await settle(page);
  const imported = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return {
    text: c.shadowRoot.querySelector('[data-floor-presentation-editor]').textContent, saved: c._layout.floor_presentation }; });
  check('missing exact imported floor is visible and retained with no automatic replacement', imported.text.includes('missing-exact-floor')
    && imported.saved.floors[1] === 'missing-exact-floor' && imported.saved.retained === 'unchanged-import', imported);
  await type(page, 'gap_m', 4);
  check('missing imported floor blocks new separation until the user deliberately resolves it', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); return c.shadowRoot.querySelector('[data-act="floor-presentation-save"]').disabled
      && c._layout.floor_presentation.gap_m === 2 && c._layout.floor_presentation.floors[1] === 'missing-exact-floor';
  }));
  await select(page, 'mode', 'assembled'); await click(page, action('save')); const missingSaved = await snapshot(page);
  check('deliberate Normal keeps exact missing reference and unknown metadata safely inactive', missingSaved.saved.gap_m === 4
    && missingSaved.saved.mode === 'assembled' && missingSaved.saved.floors[1] === 'missing-exact-floor' && missingSaved.saved.retained === 'unchanged-import', missingSaved.saved);
  await page.evaluate(() => document.querySelector('taylors3d-card').commitFeatureLayout({ floor_presentation: { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: '2' } })); await settle(page);
  const malformed = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return {
    disabled: c.shadowRoot.querySelector('[data-act="floor-presentation-save"]').disabled, saved: c._layout.floor_presentation }; });
  check('malformed imported numeric spacing remains raw and cannot be silently activated', malformed.disabled && malformed.saved.gap_m === '2', malformed);
  await click(page, action('repair')); await click(page, action('save')); await click(page, 'button.edit'); await ready(page);
  await page.setViewport({ width: 1280, height: 1080, deviceScaleFactor: 1, hasTouch: true }); await page.evaluate(() => document.querySelector('section.theme').classList.replace('dark', 'light')); await ready(page);
  await policy(page, { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2 });
  await replaceModel(page, 'floor-presentation-nested.glb'); let bad = await snapshot(page);
  check('nested tagged levels stay assembled with useful geometry diagnostics', bad.report.mode === 'assembled' && !bad.report.valid
    && bad.report.diagnostics.some((entry) => /nested|overlap/i.test(entry.code + entry.message)) && near(bad.levels.fp_upper.position[1], 4), bad.report);
  await replaceModel(page, 'floor-presentation-unclassified.glb'); bad = await snapshot(page);
  check('unclassified geometry stays assembled instead of guessing its floor', bad.report.mode === 'assembled' && !bad.report.valid
    && bad.report.diagnostics.some((entry) => /unclassified|unassigned|coverage/i.test(entry.code + entry.message)), bad.report);
  await replaceModel(page, 'floor-presentation.glb'); await policy(page, { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2 });
  const baseline = await snapshot(page);
  await page.evaluate((ids) => { const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ model: { ...c._layout.model,
    levels: { ...c._layout.model.levels, [ids.upper]: { ...c._layout.model.levels[ids.upper], floor: 'removed-floor', auto: false } } } }); }, ids); await ready(page);
  const stale = await snapshot(page);
  check('stale explicit model floor links suspend separation without expanding to a similar floor', stale.report.mode === 'assembled' && !stale.report.valid
    && stale.savedModel.levels.fp_upper.floor === 'removed-floor' && near(stale.levels.fp_upper.position[1], 4), stale.report);
  await page.evaluate((model) => document.querySelector('taylors3d-card').commitFeatureLayout({ model }), baseline.savedModel); await ready(page);
  await policy(page, { mode: 'assembled' });
  context = 'actual merge-enabled reload keeps explicitly confirmed level groups';
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.floorsFixture.replacedRoot = c._view.model.root;
    c.setConfig({ ...c._config, model: '/demo/floor-presentation.glb?merge-proof=1', merge: true }); });
  await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return !!c._view.model && !c._loading
    && c._view.model.root !== window.floorsFixture.replacedRoot && c._objects.parts.has('fp_lamp'); }, { timeout: 30000 });
  await ready(page); await captureOriginals(page);
  await policy(page, { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2 }); await camera(page);
  const merged = await snapshot(page), merge = await page.evaluate(() => document.querySelector('taylors3d-card')._view.mergeStats);
  const mergedUpper = merged.report.rows.find((row) => row.floor_id === 'upper'), mergedLamp = merged.displayAnchors.find((anchor) => anchor.id === ids.lamp);
  check('real merge-enabled reload retains independent exact groups and working physical anchors', merge.enabled && merged.report.valid && merged.report.mode === 'horizontal'
    && !!merged.levels.fp_ground && !!merged.levels.fp_upper && merged.unchangedResources && mergedLamp
    && pointsNear(mergedLamp.world, merged.anchors.find((anchor) => anchor.id === ids.lamp).world.map((number, index) => number + mergedUpper.offset[index]))
    && pointsNear(merged.light.world, mergedLamp.world) && merged.capture.upper.floor === 'upper' && merged.contexts === 1 && merged.calls === 0, { merge, report: merged.report, light: merged.light });
  await unrelated(page); await policy(page, { mode: 'assembled' });
}

async function drawnPlan(page, mode) {
  context = 'same renderer transitions from GLB to actual drawn floor plan';
  await page.evaluate((entities) => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model: undefined, view: '3d' });
    c.commitFeatureLayout({ model: {}, mower: {}, objects: {}, rooms: [
      { id: 'drawn-ground', floor_id: 'ground', area_id: 'floor_ground_area', name: 'Simulated drawn ground', polygon: [[-3, -2], [3, -2], [3, 2], [-3, 2]], doors: [] },
      { id: 'drawn-upper', floor_id: 'upper', area_id: 'floor_upper_area', name: 'Simulated drawn upper', polygon: [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]], doors: [] } ],
      pins: { [`entity:${entities.lamp}`]: { x: -.8, y: .5, z: .12, floor_id: 'upper', auto: false } },
      floor_presentation: { mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2, axis: 'east' }, views: {},
      room_overlays: { mode: 'off' }, alert_bindings: [], weather: { enabled: false }, presence_bindings: [], camera_coverage: {}, security_bindings: [] });
    c._setView('all', { instant: true }); c._view.stopCameraMotion();
  }, entities); await ready(page, { model: false });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._view.setCamera({ position: [15, 16, 18], target: [3, 1, 0] }, { instant: true }); }); await ready(page, { model: false });
  const drawn = await page.evaluate((entity) => { const c = document.querySelector('taylors3d-card'), v = c._view;
    const marker = [...v.markerObjects].find(([id]) => id === `entity:${entity}`), source = c._positions.get(`entity:${entity}`);
    const room = c._roomList.find((entry) => entry.room.id === 'drawn-upper'), screen = v.screenPoint(1.2, -1.1, 0, 'upper');
    return { report: c.floorPresentationReport(), source, marker: marker?.[1].obj.position.toArray(),
      mapped: source && v.sourceWorldToDisplay([source.x, v.floorElevation('upper') + source.z, -source.y], 'upper'),
      room, screen, roundTrip: screen && v.displayPlanPoint(...screen, 'upper'), resources: { ...v.renderer.info.memory },
      contexts: window.floorContexts.size, renderer: v.renderer === window.floorsFixture.renderer, calls: window.floorsFixture.services.length };
  }, entities.lamp);
  check('drawn floors use real polygon footprints and reuse the existing renderer', drawn.report.valid && drawn.report.mode === 'horizontal'
    && drawn.report.rows.every((row) => row.bounds) && drawn.contexts === 1 && drawn.renderer && drawn.calls === 0, drawn.report);
  check('drawn marker maps SOURCE exactly once to DISPLAY and retains its saved upper-floor coordinates', drawn.source?.floorId === 'upper'
    && near(drawn.source.x, -.8) && drawn.mapped?.ok && pointsNear(drawn.marker, drawn.mapped.point), { source: drawn.source, marker: drawn.marker, mapped: drawn.mapped });
  check('drawn displayed room ray maps back to canonical source coordinates', pointsNear(drawn.roundTrip, [1.2, -1.1]), drawn);
  await page.mouse.click(...drawn.screen); await settle(page);
  check('native drawn upper-room tap opens its real area while viewing sends no HA actions', (await snapshot(page)).popup?.includes('Simulated upper room')
    && (await snapshot(page)).calls === 0);
  await click(page, '.t3d-popup-close'); await ready(page, { model: false });
  await screenshot(page, `floors-drawn${mode === 'bundle' ? '-bundle' : ''}.png`); await unrelated(page, false);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ floor_presentation: { mode: 'vertical', floors: ['ground', 'upper'], gap_m: 2 } }); }); await ready(page, { model: false });
  const vertical = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return { elevation: c._view.displayFloorElevation('upper'), source: c._view.floorElevation('upper'),
    saved: c._layout.rooms, report: c.floorPresentationReport(), renderer: c._view.renderer === window.floorsFixture.renderer }; });
  check('drawn vertical layers add display spacing without changing room elevations or polygons', vertical.report.valid && near(vertical.elevation, vertical.source + 2)
    && equal(vertical.saved[1].polygon, [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]]) && vertical.renderer, vertical);
}

async function main() {
  const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
  for (const mode of modes) { let session; label = mode + ': ';
    try { session = await open(mode);
      check('loads the requested source/bundle with one genuine GLB fixture', session.requests.includes(mode === 'source' ? '/src/taylors3d-card.js' : '/dist/taylors3d-card.js')
        && !session.requests.includes(mode === 'source' ? '/dist/taylors3d-card.js' : '/src/taylors3d-card.js'));
      await defaultAndEditor(session.page, mode); await measuredVisuals(session.page, mode); await picking(session.page);
      await featuresAndExport(session.page); await lifecycleAndCamera(session.page); await malformedAndNarrow(session.page, mode); await drawnPlan(session.page, mode);
      check('only intentional bundle exporter tooling reports its documented second Three instance', session.toolDiagnostics.length === (mode === 'bundle' ? 1 : 0), session.toolDiagnostics);
      check('restores the exact passive renderer observer before teardown', await restoreObservers(session.page));
    } catch (error) { check('scenario completes', false, { message: error.message, stack: error.stack, context }); }
    finally { if (session) { let usedToolDiagnostic = 0;
      errors.push(...session.pageErrors, ...session.errors.filter((message) => {
        if (message === 'warn: ' + exporterDiagnostic && usedToolDiagnostic < session.toolDiagnostics.length) { usedToolDiagnostic++; return false; }
        return !session.pageErrors.some((entry) => entry.message === message);
      }));
      await restoreObservers(session.page).catch(() => {}); await session.close();
    } }
  }
  label = ''; check('no-browser-errors', errors.length === 0, errors); console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`);
  if (checks.some((passed) => !passed)) process.exitCode = 1;
}
await main();
