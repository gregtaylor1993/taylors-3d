// F14 native source/bundle checks against an explicitly authored simulated GLB.
// One existing renderer, actual GPU pixels and native wall selection. No fake
// application clock, forced render, injected light or guessed wall-name mapping.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { wallsFixtureGlb, wallsLampEntity, wallsRelayEntity, wallsProbes } from './lib/walls-fixture.mjs';

const checks = [], errors = [];
let label = '', context = 'setup';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, epsilon = 1e-7) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= epsilon;
const check = (name, pass, detail) => {
  checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
};
const field = (name) => `[data-field="wall-presentation-${name}"]`;
const action = (name) => `[data-act="wall-presentation-${name}"]`;
const lightState = { state: 'on', attributes: { friendly_name: 'Simulated inside lamp', brightness: 200,
  supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: [255, 210, 160] } };
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function ready(page) {
  try { await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card'), v = c?._view, now = performance.now();
    if (!v?.model || c._loading || v.dirty || v._tween || v._modelMotionMoving || v._wallPresentation?.moving
      || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350) { window.wallsIdle = null; return false; }
    if (!window.wallsIdle || ['frames', 'shadow', 'shadowLights'].some((key) => window.wallsIdle[key] !== v.stats[key])) {
      window.wallsIdle = { ...v.stats, at: now }; return false;
    } return now - window.wallsIdle.at > 350;
  }, { timeout: 15000, polling: 50 }); } catch (error) {
    const state = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), v = c?._view;
      return { context: window.wallsFixture?.lastContext, loaded: !!v?.model, loading: c?._loading,
        dirty: v?.dirty, tween: !!v?._tween, moving: v?._wallPresentation?.moving,
        motion: v?._modelMotionMoving, occlusion: v?._occFull, timer: !!v?._occTimer,
        cameraAge: performance.now() - (v?._camMovedAt || 0), frames: v?.stats, idle: window.wallsIdle,
        policy: c?._layout?.wall_presentation, report: v?.wallPresentationReport?.()?.diagnostics,
        visibility: document.visibilityState, camera: v?.getCamera(), captured: window.wallsFixture?.capture };
    }).catch(() => null);
    error.message += `; ${context}; readiness: ${JSON.stringify(state)}`; throw error;
  }
}
async function control(page, selector, run) {
  context = 'native ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw new Error('Missing wall control ' + selector);
    await element.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await run(element);
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
  if (actual !== String(value)) throw new Error(`Native ${name} value ${actual} does not equal intended ${value}`);
}
async function screenshot(page, filename, fullPage = false) {
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots', filename), fullPage });
}

async function captureOriginals(page) {
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, f = window.wallsFixture;
    f.originals = new Map(); f.nodes = {};
    v.model.root.traverse((node) => {
      const role = node.userData.wallsTestRole; if (!node.isMesh || !role) return;
      f.nodes[role] = node;
      f.originals.set(role, { node, geometry: node.geometry, material: node.material,
        materials: (Array.isArray(node.material) ? node.material : [node.material]).map((material) => ({ material,
          map: material.map, clip: material.clippingPlanes, side: material.side, cast: node.castShadow, receive: node.receiveShadow })) });
    });
    f.root = v.model.root;
    if (['front', 'back', 'floor', 'furniture', 'panel', 'authored-glass'].some((role) => !f.nodes[role])) throw new Error('Fixture lost an explicit original test node');
    const selector = (node) => 'node:' + c._index.nodes.find((entry) => entry.node === node).path;
    f.rows = c._layout.wall_presentation?.walls?.length === 2 && c._layout.wall_presentation.walls.every((row) => c._index.nodes.some((entry) => 'node:' + entry.path === row.selector))
      ? structuredClone(c._layout.wall_presentation.walls) : [
      { id: 'front', label: 'Explicit simulated front wall', selector: selector(f.nodes.front), enabled: true, floor_id: 'ground',
        face: { space: 'node-local', point: [0, 0, .5], normal: [0, 0, 1] } },
      { id: 'back', label: 'Explicit simulated back wall', selector: selector(f.nodes.back), enabled: true, floor_id: 'ground',
        face: { space: 'node-local', point: [0, 0, -.5], normal: [0, 0, -1] } },
    ];
  });
}
async function installPixels(page) {
  await page.evaluate((probes) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, f = window.wallsFixture;
    const previous = v.onRender; f.previousRender = previous;
    v.onRender = (...args) => {
      previous?.(...args);
      f.frames.push({ frame: v.stats.frames, time: performance.now(), opacity: f.nodes.front?.material?.opacity,
        shadow: v.stats.shadow, shadowLights: v.stats.shadowLights, requests: c._objects.stats.shadowRequests });
      if (!f.captureRequested) return;
      f.captureRequested = false;
      const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const buffer = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
      const capture = { frame: v.stats.frames };
      for (const [name, coordinates] of Object.entries(probes)) {
        const world = v.camera.position.clone().set(...coordinates), projected = world.clone().project(v.camera), screen = v.projectWorld(world);
        const x = Math.round((projected.x + 1) * width / 2), y = Math.round((projected.y + 1) * height / 2);
        const valid = x >= 3 && y >= 3 && x < width - 3 && y < height - 3 && projected.z > -1 && projected.z < 1;
        const rgb = [0, 1, 2].map((channel) => {
          const values = []; if (valid) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) values.push(buffer[((y + dy) * width + x + dx) * 4 + channel]);
          values.sort((a, b) => a - b); return values[24];
        });
        const hit = screen && v._modelHit(screen[0], screen[1]);
        capture[name] = { valid, rgb, role: hit?.object.userData.wallsTestRole, name: hit?.object.name,
          hit: hit?.point.toArray(), screen, world: coordinates };
      } f.capture = capture;
    };
  }, wallsProbes);
}
async function restoreObservers(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card') || window.wallsFixture?.detached, f = window.wallsFixture, v = c?._view;
    if (!f) return true;
    if (Object.hasOwn(f, 'hiddenDescriptor')) {
      if (f.hiddenDescriptor) Object.defineProperty(document, 'hidden', f.hiddenDescriptor); else delete document.hidden;
      delete f.hiddenDescriptor;
    }
    f.scrollFixture?.remove(); delete f.scrollFixture;
    if (!v || !Object.hasOwn(f, 'previousRender')) return true;
    v.onRender = f.previousRender; const restored = v.onRender === f.previousRender; delete f.previousRender; return restored;
  });
}
async function camera(page, position = [0, 3.5, 9], target = [0, 3.5, 0]) {
  context = 'actual camera ' + JSON.stringify(position);
  await page.evaluate(({ position, target }) => {
    const c = document.querySelector('taylors3d-card'), f = window.wallsFixture; f.captureRequested = true;
    c._view.stopCameraMotion(); c._view.setCamera({ position, target }, { instant: true });
  }, { position, target }); await ready(page);
}
async function setPolicy(page, patch = {}) {
  context = 'wall policy ' + JSON.stringify(patch);
  await page.evaluate((patch) => {
    const c = document.querySelector('taylors3d-card'), f = window.wallsFixture; f.captureRequested = true;
    c.commitFeatureLayout({ wall_presentation: { enabled: true, mode: 'fade', scope: 'camera_side', opacity: .2,
      transition_ms: 0, cut_height_m: 1, walls: f.rows.map((row) => ({ ...row, face: { ...row.face } })), ...patch } });
  }, patch); await ready(page);
}
async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, f = window.wallsFixture, layer = c._objects;
    const pool = [...layer.pool.points, ...layer.pool.spots];
    return { pixels: f.capture, stats: { ...v.stats }, objectStats: { ...layer.stats }, saved: c._layout.wall_presentation,
      report: v.wallPresentationReport?.()?.diagnostics, moving: !!v._wallPresentation?.moving,
      surfaces: Object.fromEntries([...f.originals].map(([role, original]) => {
        const node = original.node, materials = Array.isArray(node.material) ? node.material : [node.material];
        return [role, { uuid: node.uuid, material: materials.map((material) => material.uuid), version: materials.map((material) => material.version),
          opacity: materials.map((material) => material.opacity), transparent: materials.map((material) => material.transparent),
          depthWrite: materials.map((material) => material.depthWrite), side: materials.map((material) => material.side),
          clip: materials.map((material) => (material.clippingPlanes || []).map((plane) => [...plane.normal.toArray(), plane.constant])),
          clipShadows: materials.map((material) => material.clipShadows), transmission: materials.map((material) => material.transmission ?? 0),
          originalPlanesKept: materials.every((material, index) => (original.materials[index].clip || []).every((plane) => material.clippingPlanes?.includes(plane))),
          sameOriginal: node.material === original.material, geometrySame: node.geometry === original.geometry,
          textureSame: materials.every((material, index) => material.map === original.materials[index].map),
          cast: node.castShadow, receive: node.receiveShadow, authoredCast: original.materials[0].cast }];
      })),
      sharedOriginal: f.originals.get('front').material === f.originals.get('back').material
        && f.originals.get('front').material === f.originals.get('furniture').material && f.originals.get('front').material === f.originals.get('floor').material,
      frames: f.frames.slice(), resources: { ...v.renderer.info.memory }, programs: v.renderer.info.programs.map((program) => program.id),
      pool: pool.map((light) => [light.uuid, light.castShadow, light.intensity]), rendererSame: f.renderer === v.renderer, contexts: window.wallsContexts.size,
      calls: f.services.length, commits: f.commits, root: v.model?.root.uuid, merge: v.mergeStats,
      section: v.sectionClip && [...v.sectionClip.normal.toArray(), v.sectionClip.constant], sectionPlanes: v.renderer.clippingPlanes.length,
      modelOpacity: v.model?.opacity, mode: c._mode, edit: c._editing, camera: v.camera.position.toArray() };
  });
}

async function open(mode) {
  const transport = await launch(); let session; const pageErrors = [];
  try {
    session = await newPage(transport.browser, { width: 1280, height: 1100, hasTouch: true }); const { page } = session, requests = [], glb = wallsFixtureGlb(), legacyGlb = wallsFixtureGlb({ legacyFloor: true });
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack, context: label + context }));
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8').replace(/<section class="theme dark">[\s\S]*?<\/section>/, '')
      .replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
    if (mode === 'source') html = html.replace('</head>', `<script type="importmap">${JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } })}</script></head>`)
      .replace('src="../dist/taylors3d-card.js"', 'src="../src/taylors3d-card.js"');
    await page.evaluateOnNewDocument(() => {
      window.__demoMowerPaused = true; window.wallsContexts = new Set();
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const value = original.call(this, kind, ...args); if (value && /^webgl/.test(kind)) window.wallsContexts.add(this); return value; };
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
      else if (url.pathname === '/demo/walls-fixture.glb') request.respond({ status: 200, contentType: 'model/gltf-binary', body: glb });
      else if (url.pathname === '/demo/walls-legacy-fixture.glb') request.respond({ status: 200, contentType: 'model/gltf-binary', body: legacyGlb }); else request.continue();
    });
    await page.goto(`${transport.base}/demo/index.html?model=/demo/walls-fixture.glb&merge=1&floor=ground&view=3d&height=700px`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront(); await page.waitForFunction(() => document.querySelector('taylors3d-card')?._objects?.parts.has('walls_lamp'), { timeout: 30000 });
    await page.evaluate(async ({ mode, lamp, relay, lightState }) => {
      const c = document.querySelector('taylors3d-card');
      window.wallsFixture = { services: [], commits: 0, frames: [], captureRequested: false, capture: null, renderer: c._view.renderer };
      c.hass = { ...c._hass, callWS: undefined };
      c.setConfig({ ...c._config, layout_key: `walls-browser-${mode}`, height: '700px', merge: true, model_opacity: 1,
        control_panel: 'right', lights: 'auto', sky_bodies: false, device_tap_action: 'controls' });
      await c._layoutReady;
      c.hass = { ...c._hass, callWS: undefined, callService: (...args) => { window.wallsFixture.services.push(args); return Promise.resolve(); },
        config: { ...c._hass.config, latitude: null, longitude: null },
        states: { [lamp]: lightState, [relay]: { state: 'on', attributes: { friendly_name: 'Simulated inside switch' } },
          'sensor.walls_unrelated': { state: '0', attributes: { friendly_name: 'Known unrelated reading' } },
          'sensor.living_temperature': { state: '21.2', attributes: { friendly_name: 'Living temperature', device_class: 'temperature', unit_of_measurement: '°C' } },
          'sun.sun': { state: 'below_horizon', attributes: { elevation: -20, azimuth: 180 } } } };
      c._commit({ ...c._layout, floors: [{ id: 'ground', name: 'Explicit elevated test floor', elevation: 2, height: 3 }],
        rooms: [], pins: {}, hidden: [], mower: {}, objects: {}, groups: {}, model: {}, views: {}, wall_presentation: undefined,
        model_rendering: { shadows: 'realtime', lamps: 'inherit' }, ambient_idle: { enabled: false }, scene_previews: { enabled: false },
        room_overlays: { mode: 'off' }, alert_bindings: [], weather: { enabled: false }, security_bindings: [],
        presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [], camera_coverage: { enabled: false } });
      const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (patch) => { window.wallsFixture.commits++; return commit(patch); };
      c._skyMode = 'auto'; c._applySky(true); c._view.stopCameraMotion(); c.resetHistory();
      document.querySelector('section.theme h2').textContent = `Simulated exact wall-selection bench · ${mode}`;
    }, { mode, lamp: wallsLampEntity, relay: wallsRelayEntity, lightState });
    await ready(page); return { ...transport, ...session, requests, pageErrors };
  } catch (error) { errors.push(...pageErrors, ...(session?.errors || [])); if (session) await restoreObservers(session.page).catch(() => {}); await transport.close(); throw error; }
}

async function formState(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-wall-presentation-editor]'), editor = c._edit?._wallPresentationEditor;
    return { exists: !!form, saved: c._layout.wall_presentation, draft: editor?.draft, pending: !!editor?.pendingSurfacePick,
      saveDisabled: form?.querySelector('[data-act="wall-presentation-save"]')?.disabled,
      status: form?.querySelector('[data-wall-presentation-status]')?.textContent,
      rowStatus: form?.querySelector('[data-wall-presentation-row-status]')?.textContent,
      report: form?.querySelector('[data-wall-presentation-report]')?.textContent,
      floor: form?.querySelector('[data-field="wall-presentation-wall.floor_id"]')?.value,
      calls: window.wallsFixture.services.length, commits: window.wallsFixture.commits,
      mode: c._mode, tab: c._edit?.tab, prepared: c._view.wallPresentationCandidates().prepared };
  });
}
async function defaultScenario(page) {
  const before = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view;
    window.wallsFixture.defaultMaterials = new Map(); v.model.root.traverse((node) => {
      if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) window.wallsFixture.defaultMaterials.set(material.uuid, [material, material.version, material.opacity]);
    });
    return { stats: { ...v.stats }, resources: { ...v.renderer.info.memory }, programs: v.renderer.info.programs.map((program) => program.id), merge: v.mergeStats };
  });
  await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card');
    for (let i = 1; i <= 10; i++) {
      c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.walls_unrelated': { state: String(i), attributes: { friendly_name: 'Known unrelated reading' } } } };
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }); await ready(page);
  const after = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view;
    return { stats: { ...v.stats }, resources: { ...v.renderer.info.memory }, programs: v.renderer.info.programs.map((program) => program.id),
      materialsStable: [...window.wallsFixture.defaultMaterials.values()].every(([material, version, opacity]) => material.version === version && material.opacity === opacity),
      layerAbsent: !v._wallPresentation, calls: window.wallsFixture.services.length };
  });
  check('default unconfigured walls add no frames, shadow work, material writes, resources or services', equal(after.stats, before.stats)
    && equal(after.resources, before.resources) && equal(after.programs, before.programs) && after.materialsStable && after.layerAbsent && after.calls === 0, { before, after });
  check('fixture starts with genuinely merged wall geometry requiring explicit preparation', before.merge.enabled && before.merge.merged >= 2, before.merge);
}
async function facePick(page, role, position, point) {
  await camera(page, position); await click(page, action('pick'));
  const target = await page.evaluate(({ role, point }) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, world = v.camera.position.clone().set(...point), screen = v.projectWorld(world);
    const actual = screen && v.captureWallSurfacePick(screen[0], screen[1]), node = window.wallsFixture.nodes[role];
    return { screen, expected: 'node:' + c._index.nodes.find((entry) => entry.node === node)?.path,
      selector: actual?.selector, face: actual?.face, pending: !!c._edit._wallPresentationEditor.pendingSurfacePick,
      exactRoot: actual?.modelRoot === v.model.root, stage: c._stage.classList.contains('wall-picking') };
  }, { role, point });
  check(`native ${role} wall picker targets one actual node-local triangle`, target.pending && target.stage && target.exactRoot
    && target.selector === target.expected && target.face?.space === 'node-local'
    && target.face.point.every(Number.isFinite) && target.face.normal.every(Number.isFinite), target);
  if (!target.screen || target.selector !== target.expected) throw new Error('Wall triangle fixture is not exposed: ' + JSON.stringify(target));
  await page.mouse.click(target.screen[0], target.screen[1]); await settle(page);
  const form = await formState(page), row = form.draft?.walls?.at(-1);
  check(`actual ${role} surface click captures only its exact face and explicitly chosen floor`, !form.pending && row?.selector === target.expected
    && row.floor_id === 'ground' && row.face.space === 'node-local' && row.face.point.every((value) => Math.abs(value) <= .501)
    && near(row.face.normal[2], role === 'front' ? 1 : -1) && form.calls === 0, form);
}
async function editorScenario(page, mode) {
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="model"]');
  const initial = await formState(page);
  check('native Model wall editor begins Normal with no inferred wall selection', initial.exists && !initial.prepared && !initial.saved
    && !initial.draft?.walls?.length && initial.saveDisabled && initial.report?.includes('preparation'), initial);
  const rootBefore = await page.evaluate(() => document.querySelector('taylors3d-card')._view.model.root.uuid);
  await click(page, action('prepare'));
  await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card'); return !c._loading && !!c._view.model && c._view.wallPresentationCandidates().prepared;
  }, { timeout: 30000 }); await ready(page); await captureOriginals(page);
  const prepared = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.wallsFixture, candidates = c._view.wallPresentationCandidates();
    const duplicates = ['front', 'back'].map((role) => candidates.rows.find((row) => row.node === f.nodes[role]));
    const primitives = candidates.rows.filter((row) => row.node.parent?.userData.wallsTestRole === 'multi');
    return { prepared: candidates.prepared, root: c._view.model.root.uuid, merge: c._config.merge, saved: c._layout.wall_presentation,
      duplicates: duplicates.map((row) => ({ selector: row?.selector, selectable: row?.selectable })),
      primitives: primitives.map((row) => ({ selector: row.selector, selectable: row.selectable })), commits: f.commits, calls: f.services.length };
  });
  check('Prepare explicitly reloads original meshes without saving or changing configured merging', prepared.prepared && prepared.root !== rootBefore
    && prepared.merge === true && !prepared.saved && prepared.commits === 0 && prepared.calls === 0, prepared);
  check('escaped duplicate names remain distinct exact choices and actual multi-primitive leaves stay separate', prepared.duplicates.length === 2
    && prepared.duplicates.every((row) => row.selectable && row.selector.includes('\\*') && row.selector.includes('\\/') && row.selector.includes('\\#'))
    && prepared.duplicates[0].selector !== prepared.duplicates[1].selector && prepared.primitives.length === 2
    && prepared.primitives.every((row) => row.selectable) && prepared.primitives[0].selector !== prepared.primitives[1].selector, prepared);
  await click(page, field('enabled')); await select(page, 'mode', 'fade'); await type(page, 'opacity', 20); await type(page, 'transition_ms', 0);
  await click(page, action('add')); await select(page, 'wall.floor_id', 'ground'); await facePick(page, 'front', [0, 3.5, 9], [-1.4, 4.1, 2.061]);
  await click(page, action('add')); await select(page, 'wall.floor_id', 'ground'); await facePick(page, 'back', [0, 3.5, -9], [-1.4, 4.1, -2.061]);
  const draft = await formState(page);
  check('two deliberate wall choices remain draft-only with no device actions', !draft.saved && !draft.saveDisabled && draft.draft.walls.length === 2
    && draft.commits === 0 && draft.calls === 0, draft);
  await click(page, action('save')); await ready(page); const saved = await formState(page);
  check('one native Save records both captured exact walls as one undoable layout edit', saved.saved?.walls?.length === 2 && saved.saved.enabled === true
    && saved.saved.mode === 'fade' && saved.saved.opacity === .2 && saved.saved.transition_ms === 0
    && saved.commits === 1 && saved.calls === 0, saved);
  await click(page, '[data-act="history-undo"]'); await ready(page); const undone = await formState(page);
  check('native Undo restores the previous unconfigured wall policy', !undone.saved && undone.calls === 0, undone);
  await click(page, '[data-act="history-redo"]'); await ready(page); const redone = await formState(page);
  check('native Redo restores the exact captured selectors, faces and floors', equal(redone.saved, saved.saved) && redone.calls === 0, redone);
  await type(page, 'opacity', 37);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.wallsFixture.focused = c.shadowRoot.activeElement; });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass, states: { ...c._hass.states,
    'sensor.walls_unrelated': { state: '100', attributes: { friendly_name: 'Known unrelated reading' } } } }; }); await settle(page);
  check('live HA updates preserve the exact focused native unfinished opacity field', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector('[data-field="wall-presentation-opacity"]');
    return input === window.wallsFixture.focused && c.shadowRoot.activeElement === input && input.value === '37'
      && c._layout.wall_presentation.opacity === .2;
  }));
  await screenshot(page, mode === 'source' ? 'walls-editor.png' : 'walls-editor-bundle.png');
  await click(page, action('cancel')); const cancelled = await formState(page);
  check('Cancel discards unfinished opacity and keeps the exact saved walls', equal(cancelled.saved, saved.saved) && cancelled.draft.opacity === .2
    && cancelled.commits === 1 && cancelled.calls === 0, cancelled);
  // Edit intentionally restores the authored materials. Capture references
  // from the current reloaded model before leaving; afterward selected meshes
  // hold owned fade copies and cannot serve as an authored-reference baseline.
  await ready(page); await captureOriginals(page);
  await click(page, 'button.edit'); await ready(page); await installPixels(page); await camera(page);
  const view = await snapshot(page);
  check('prepared exact saved walls survive configured remerging and use the real fixed light pool', view.merge.enabled && view.surfaces.front.uuid !== view.surfaces.back.uuid
    && view.sharedOriginal && view.rendererSame && view.contexts === 1 && view.pool.length === 12 && view.pool.filter((entry) => entry[1]).length === 4, view.merge);
}

async function idleCheck(page, kind = 'unrelated') {
  await ready(page); const before = await snapshot(page);
  const writes = await page.evaluate(async (kind) => {
    const c = document.querySelector('taylors3d-card'), f = window.wallsFixture, restores = []; let opacityWrites = 0, poolWrites = 0;
    const materials = new Set([...f.originals.values()].flatMap(({ node }) => Array.isArray(node.material) ? node.material : [node.material]));
    try {
      for (const material of materials) {
        const descriptor = Object.getOwnPropertyDescriptor(material, 'opacity'); let value = material.opacity;
        Object.defineProperty(material, 'opacity', { configurable: true, get: () => value, set: (next) => { opacityWrites++; value = next; } });
        restores.push(() => Object.defineProperty(material, 'opacity', { ...descriptor, value }));
      }
      for (const light of [...c._objects.pool.points, ...c._objects.pool.spots]) {
        const descriptor = Object.getOwnPropertyDescriptor(light, 'intensity'); let value = light.intensity;
        Object.defineProperty(light, 'intensity', { configurable: true, get: () => value, set: (next) => { poolWrites++; value = next; } });
        restores.push(() => Object.defineProperty(light, 'intensity', { ...descriptor, value }));
      }
      for (let i = 1; i <= 10; i++) {
        if (kind === 'policy') c.commitFeatureLayout({ wall_presentation: structuredClone(c._layout.wall_presentation) });
        else if (kind === 'equal') {
          const current = c._hass.states['light.walls_lamp']; c.hass = { ...c._hass, states: { ...c._hass.states,
            'light.walls_lamp': { ...current, attributes: { ...current.attributes, rgb_color: current.attributes.rgb_color.slice() } } } };
        } else c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.walls_unrelated': { state: String(i + 100), attributes: { friendly_name: 'Known unrelated reading' } } } };
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    } finally { for (const restore of restores.reverse()) restore(); }
    return { opacityWrites, poolWrites };
  }, kind); await ready(page); const after = await snapshot(page);
  check(`${kind} updates leave settled walls idle with zero opacity/pool/shadow/resource work`, equal(before.stats, after.stats)
    && before.objectStats.budget === after.objectStats.budget && before.objectStats.shadowRequests === after.objectStats.shadowRequests
    && equal(before.resources, after.resources) && equal(before.programs, after.programs)
    && equal(before.surfaces, after.surfaces) && writes.opacityWrites === 0 && writes.poolWrites === 0, { writes, before: before.stats, after: after.stats });
}

async function pinMarker(page, height = 2.2) {
  await page.evaluate((height) => {
    const c = document.querySelector('taylors3d-card'), marker = c._markers.find((entry) => entry.entityId === 'sensor.living_temperature');
    if (!marker) throw new Error('Missing actual room sensor fixture');
    window.wallsFixture.markerId = marker.id;
    c._commit({ ...c._layout, pins: { ...c._layout.pins, [marker.id]: { x: 1, y: 0, z: height, floor_id: 'ground' } } });
  }, height); await ready(page);
}
async function markerState(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), id = window.wallsFixture.markerId, marker = c._view.markerObjects.get(id);
    const position = marker?.obj.getWorldPosition(c._view.camera.position.clone());
    return { exists: !!marker, world: position?.toArray(), occluded: marker?.obj.element.classList.contains('fp-occluded'),
      hidden: position && c._view.pointHidden(position), text: marker?.obj.element.textContent };
  });
}
const revealedGreen = (pixel) => pixel?.valid && pixel.role === 'panel' && pixel.rgb[1] > pixel.rgb[0] * 1.3 && pixel.rgb[1] > pixel.rgb[2] * 1.3;
async function visualsScenario(page, mode) {
  await pinMarker(page); await setPolicy(page, { mode: 'normal' }); await camera(page);
  const normal = await snapshot(page), normalMarker = await markerState(page);
  check('Normal shows the authored opaque front wall in actual pixels and blocks inside picking', normal.pixels.upper.valid
    && normal.pixels.upper.role === 'front' && normal.pixels.lower.role === 'front'
    && normal.surfaces.front.sameOriginal && normal.surfaces.back.sameOriginal
    && normalMarker.occluded && normalMarker.hidden && near(normalMarker.world[1], 4.2), { pixels: normal.pixels, marker: normalMarker });
  await setPolicy(page); const fade = await snapshot(page), fadeMarker = await markerState(page);
  check('explicit camera-side Fade reveals the interior in real pixels and lets picking pass through', revealedGreen(fade.pixels.upper)
    && revealedGreen(fade.pixels.lower) && near(fade.surfaces.front.opacity[0], .2) && near(fade.surfaces.back.opacity[0], 1)
    && !fade.surfaces.front.sameOriginal && !fade.surfaces.back.sameOriginal
    && fade.pixels.upper.rgb[1] > normal.pixels.upper.rgb[1] + 25, { normal: normal.pixels.upper, fade: fade.pixels.upper, surfaces: fade.surfaces });
  check('fade respects real room-marker occlusion and shared original floor/furniture textures', fadeMarker.exists && !fadeMarker.occluded && !fadeMarker.hidden
    && fade.surfaces.floor.sameOriginal && fade.surfaces.furniture.sameOriginal && fade.surfaces['authored-glass'].sameOriginal
    && near(fade.surfaces['authored-glass'].opacity[0], .4)
    && Object.values(fade.surfaces).every((surface) => surface.textureSame && surface.geometrySame && surface.cast === surface.authoredCast), fadeMarker);
  // Existing device interaction uses the authored object's anchor radius,
  // rather than arbitrary visible triangles higher up on the same mesh.
  const target = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), a = c._objects.anchors().find((entry) => entry.id === 'walls_panel');
    const object = c._objects.objectAt('walls_panel'), point = a && c._view.projectWorld(a.world);
    return { point, world: a?.world.toArray(), picked: point && c._objectHit(point[0], point[1], 18),
      hidden: a && c._view.pointHidden(a.world, object.obj.node) };
  });
  check('the actual inside device anchor is reachable through the faded authored wall', target.point && target.picked === 'walls_panel' && !target.hidden, target);
  if (!target.point || target.picked !== 'walls_panel' || target.hidden) throw new Error('Inside device anchor is not reachable: ' + JSON.stringify(target));
  await page.mouse.click(target.point[0], target.point[1]); await settle(page);
  const panel = await page.evaluate((entity) => {
    const c = document.querySelector('taylors3d-card'), row = c.shadowRoot.querySelector(`.taylors3d-device-popup .t3d-entity[data-entity="${entity}"]`);
    return { exists: !!row, text: row?.textContent, calls: window.wallsFixture.services.length };
  }, wallsRelayEntity);
  check('a real native inside-object tap opens its actual right-hand controls without a service action', panel.exists && panel.text.includes('Simulated inside switch') && panel.calls === 0, panel);
  await click(page, '.t3d-popup-close'); await ready(page); await camera(page);
  await camera(page, [0, 3.5, -9]); const reverse = await snapshot(page);
  check('the opposite actual camera fades only the explicitly captured back face', near(reverse.surfaces.front.opacity[0], 1)
    && near(reverse.surfaces.back.opacity[0], .2) && revealedGreen(reverse.pixels.upper), reverse.pixels);
  await setPolicy(page, { scope: 'all_selected' }); const all = await snapshot(page);
  check('All selected walls is static and affects both exact choices regardless of camera side', near(all.surfaces.front.opacity[0], .2)
    && near(all.surfaces.back.opacity[0], .2) && all.surfaces.furniture.sameOriginal, all.surfaces);
  await camera(page); await setPolicy(page, { mode: 'glass', opacity: .35 }); const glass = await snapshot(page);
  check('Glass look is measured alpha-only transparency with no heavy transmission or material replacement outside selected walls', revealedGreen(glass.pixels.upper)
    && near(glass.surfaces.front.opacity[0], .35) && glass.surfaces.front.transparent[0] && !glass.surfaces.front.depthWrite[0]
    && glass.surfaces.front.transmission[0] === 0 && glass.surfaces['authored-glass'].sameOriginal
    && glass.surfaces.front.material[0] === all.surfaces.front.material[0], glass.pixels);
  await screenshot(page, mode === 'source' ? 'walls-fade.png' : 'walls-fade-bundle.png');
  await setPolicy(page, { mode: 'cutaway', scope: 'all_selected', cut_height_m: 1 }); const cut = await snapshot(page), upperMarker = await markerState(page);
  check('real Cut-away uses explicit world floor elevation plus metres and leaves the lower wall intact', revealedGreen(cut.pixels.upper)
    && cut.pixels.lower.valid && cut.pixels.lower.role === 'front' && cut.surfaces.front.clip.flat().some((plane) => equal(plane, [0, -1, 0, 3]))
    && near(cut.surfaces.front.opacity[0], 1) && cut.surfaces.front.cast === normal.surfaces.front.cast
    && cut.surfaces.front.clipShadows[0] === normal.surfaces.front.clipShadows[0], cut.pixels);
  check('upper room marker becomes reachable through cut faces while real lower geometry still occludes', !upperMarker.occluded && !upperMarker.hidden, upperMarker);
  await pinMarker(page, .5); const lowerMarker = await markerState(page);
  check('a marker below the saved cut height remains blocked by the actual lower wall', lowerMarker.occluded && lowerMarker.hidden
    && near(lowerMarker.world[1], 2.5), lowerMarker);
  await pinMarker(page); await screenshot(page, mode === 'source' ? 'walls-cutaway.png' : 'walls-cutaway-bundle.png');
  await idleCheck(page); await idleCheck(page, 'equal'); await idleCheck(page, 'policy');
}

async function transitionScenario(page) {
  await setPolicy(page, { mode: 'normal' }); await camera(page);
  const before = await snapshot(page);
  await page.evaluate(() => { window.wallsFixture.frames = []; });
  await setPolicy(page, { mode: 'fade', scope: 'all_selected', opacity: .2, transition_ms: 400 });
  const after = await snapshot(page), samples = after.frames.map((frame) => frame.opacity).filter((value) => typeof value === 'number');
  check('existing RAF makes a real bounded fade without per-opacity shadow requests or new lights', samples.length >= 3
    && samples.some((value) => value > .2 && value < 1) && samples.every((value, index) => index === 0 || value <= samples[index - 1] + 1e-9)
    && near(after.surfaces.front.opacity[0], .2) && !after.moving
    && after.stats.shadow === before.stats.shadow && after.stats.shadowLights === before.stats.shadowLights
    && after.objectStats.shadowRequests === before.objectStats.shadowRequests && equal(after.pool.map((entry) => entry[0]), before.pool.map((entry) => entry[0])),
  { samples, before: before.stats, after: after.stats });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await setPolicy(page, { mode: 'fade', opacity: .4, transition_ms: 1000 }); const reduced = await snapshot(page);
  check('actual reduced-motion preference applies a static immediate fade without a running transition', near(reduced.surfaces.front.opacity[0], .4) && !reduced.moving, reduced.surfaces.front);
  await camera(page, [0, 3.5, -9]); const reducedBack = await snapshot(page);
  check('reduced motion still responds immediately to deliberate camera-side changes', near(reducedBack.surfaces.front.opacity[0], 1)
    && near(reducedBack.surfaces.back.opacity[0], .4) && !reducedBack.moving, reducedBack.surfaces);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await setPolicy(page); await camera(page, [8, 3.5, 2.12]); const outside = await snapshot(page);
  await camera(page, [8, 3.5, 2.08]); const boundary = await snapshot(page);
  await camera(page, [8, 3.5, 2]); const inside = await snapshot(page);
  check('camera-side hysteresis is in real world metres across a thin nonuniformly scaled wall', near(outside.surfaces.front.opacity[0], .2)
    && near(boundary.surfaces.front.opacity[0], .2) && near(inside.surfaces.front.opacity[0], 1),
  { outside: outside.surfaces.front.opacity, boundary: boundary.surfaces.front.opacity, inside: inside.surfaces.front.opacity });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model_position: [1, -2, .4], model_rotation: 37, model_scale: 1.4 }); });
  await ready(page);
  const transformed = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), node = window.wallsFixture.nodes.front, face = window.wallsFixture.rows[0].face;
    node.updateWorldMatrix(true, false);
    const point = node.localToWorld(c._view.camera.position.clone().set(...face.point));
    const normal = c._view.camera.position.clone().set(...face.normal).transformDirection(node.matrixWorld);
    // A lower target keeps the real OrbitControls polar limit from moving a
    // requested horizontal camera into the hysteresis band.
    const target = point.clone().addScaledVector(normal, -3); target.y -= 1;
    return { point: point.toArray(), normal: normal.toArray(), outside: point.clone().addScaledVector(normal, .06).toArray(),
      boundary: point.clone().addScaledVector(normal, .02).toArray(), inside: point.clone().addScaledVector(normal, -.06).toArray(), target: target.toArray() };
  });
  // These actual camera positions intentionally test the transformed authored
  // plane, rather than assuming the node-local normal is a world-space normal.
  await camera(page, transformed.outside, transformed.target); const a = await snapshot(page);
  await camera(page, transformed.boundary, transformed.target); const b = await snapshot(page);
  await camera(page, transformed.inside, transformed.target); const d = await snapshot(page);
  const distances = [a, b, d].map((value) => value.camera.reduce((sum, coordinate, index) => sum
    + (coordinate - transformed.point[index]) * transformed.normal[index], 0));
  check('rotated/translated/scaled authored wall faces retain world-distance hysteresis', near(a.surfaces.front.opacity[0], .2)
    && near(b.surfaces.front.opacity[0], .2) && near(d.surfaces.front.opacity[0], 1)
    && distances[0] > .05 && distances[1] > -.05 && distances[1] < .05 && distances[2] < -.05,
  { transformed, distances, opacity: [a, b, d].map((value) => value.surfaces.front.opacity) });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model_position: [0, 0, 0], model_rotation: 0, model_scale: 1 }); });
  await ready(page); await camera(page);
}

async function compositionScenario(page) {
  await setPolicy(page, { scope: 'all_selected' });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model_opacity: .6 }); }); await ready(page);
  const ghost = await snapshot(page);
  check('wall opacity multiplies current global ghost opacity while floor and furniture keep the global baseline', near(ghost.modelOpacity, .6)
    && near(ghost.surfaces.front.opacity[0], .12) && near(ghost.surfaces.back.opacity[0], .12)
    && near(ghost.surfaces.floor.opacity[0], .6) && near(ghost.surfaces.furniture.opacity[0], .6) && ghost.surfaces.floor.sameOriginal, ghost.surfaces);
  await page.evaluate(() => {
    const f = window.wallsFixture; f.cloneDisposals = 0; f.textureDisposals = 0;
    const clones = new Set(['front', 'back'].flatMap((role) => Array.isArray(f.nodes[role].material) ? f.nodes[role].material : [f.nodes[role].material]));
    for (const material of clones) material.addEventListener('dispose', () => f.cloneDisposals++);
    const textures = new Set([...f.originals.values()].flatMap((original) => original.materials.map(({ map }) => map).filter(Boolean)));
    for (const texture of textures) texture.addEventListener('dispose', () => f.textureDisposals++);
    f.expectedCloneDisposals = clones.size;
  });
  await setPolicy(page, { enabled: false }); const restored = await snapshot(page);
  const disposed = await page.evaluate(() => ({ clones: window.wallsFixture.cloneDisposals, expected: window.wallsFixture.expectedCloneDisposals, textures: window.wallsFixture.textureDisposals }));
  check('turning effects off restores exact shared authored material references at the latest global opacity and disposes only clones', restored.surfaces.front.sameOriginal
    && restored.surfaces.back.sameOriginal && near(restored.surfaces.front.opacity[0], .6) && restored.sharedOriginal
    && Object.values(restored.surfaces).every((surface) => surface.textureSame && surface.geometrySame)
    && disposed.clones === disposed.expected && disposed.textures === 0, { disposed, surfaces: restored.surfaces });
  await setPolicy(page, { mode: 'cutaway', scope: 'all_selected' }); await click(page, 'button.section'); await ready(page); const section = await snapshot(page);
  check('native Section composes its global clipping plane and DoubleSide with the explicit wall cut', !!section.section && section.sectionPlanes === 1
    && section.surfaces.front.clip.flat().some((plane) => equal(plane, [0, -1, 0, 3]))
    && section.surfaces.front.side.every((side) => side === 2) && !section.surfaces.front.sameOriginal, section);
  await setPolicy(page, { enabled: false }); const sectionNormal = await snapshot(page);
  check('restoring authored references during Section preserves current DoubleSide/global clipping and ghost baseline', sectionNormal.surfaces.front.sameOriginal
    && sectionNormal.surfaces.back.sameOriginal && sectionNormal.surfaces.front.side[0] === 2
    && sectionNormal.sectionPlanes === 1 && near(sectionNormal.surfaces.front.opacity[0], .6), sectionNormal.surfaces.front);
  await click(page, 'button.section'); await ready(page);
  const noSection = await snapshot(page);
  check('leaving Section restores authored sidedness without removing shared textures', noSection.surfaces.front.side[0] === 0 && noSection.surfaces.front.textureSame
    && noSection.sectionPlanes === 0 && noSection.surfaces.front.sameOriginal, noSection.surfaces.front);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model_opacity: 1 }); });
  await ready(page); await setPolicy(page); await camera(page);
}

async function ambientScenario(page) {
  await setPolicy(page); await camera(page, [-8, 3.5, 2.12]);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ ambient_idle: { enabled: true, idle_seconds: 1,
      rotate: true, rotation_degrees_per_second: 6, dim: { enabled: false } } });
  });
  await page.mouse.click(20, 8); await page.mouse.move(15, 5);
  context = 'real ambient orbit crosses the authored wall face';
  await page.waitForFunction(() => {
    const v = document.querySelector('taylors3d-card')._view; return !!v._ambientCamera && v.camera.position.z < 2;
  }, { timeout: 10000, polling: 50 });
  const orbit = await snapshot(page);
  check('real idle orbit freezes camera-side selection despite crossing the captured face plane', before.camera[2] > 2.11 && orbit.camera[2] < 2
    && near(before.surfaces.front.opacity[0], .2) && near(orbit.surfaces.front.opacity[0], .2)
    && orbit.stats.shadow === before.stats.shadow && orbit.objectStats.shadowRequests === before.objectStats.shadowRequests,
  { camera: [before.camera, orbit.camera], opacity: orbit.surfaces.front.opacity, stats: orbit.stats });
  const wake = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), r = c._scene.getBoundingClientRect(), x = r.left + 8, y = r.top + 8;
    return { x, y, inside: c._scene.contains(c.shadowRoot.elementFromPoint(x, y)),
      empty: !c._objectHit(x, y, 30) && !c._view._modelHit(x, y) };
  });
  if (!wake.inside || !wake.empty) throw new Error('Native wake point must be an empty part of this card scene: ' + JSON.stringify(wake));
  context = 'native pointer inside the card wakes its real idle orbit';
  await page.mouse.move(wake.x, wake.y); await page.waitForFunction(() => !document.querySelector('taylors3d-card')._view._ambientCamera, { timeout: 5000, polling: 50 });
  await page.evaluate(() => document.querySelector('taylors3d-card').commitFeatureLayout({ ambient_idle: { enabled: false } })); await ready(page);
  const awake = await snapshot(page);
  check('wake restores the actual pre-idle camera and keeps the authored-side decision stable', awake.camera.every((value, index) => near(value, before.camera[index]))
    && near(awake.surfaces.front.opacity[0], .2), { wake, before: before.camera, after: awake.camera });
  await camera(page);
}

async function lifecycleScenario(page) {
  await setPolicy(page, { scope: 'all_selected' }); const visible = await snapshot(page);
  await click(page, '[data-mode="top"]'); await ready(page); const top = await snapshot(page);
  check('native Top suspends wall effects and restores exact authored references', top.mode === 'top' && top.surfaces.front.sameOriginal
    && top.surfaces.back.sameOriginal && top.rendererSame, top.surfaces.front);
  await click(page, '[data-mode="3d"]'); await ready(page); await camera(page); const resumed = await snapshot(page);
  check('returning to 3D reapplies saved exact walls with the same model geometry/textures/pool', !resumed.surfaces.front.sameOriginal && near(resumed.surfaces.front.opacity[0], .2)
    && resumed.surfaces.front.geometrySame && resumed.surfaces.front.textureSame && equal(resumed.pool.map((entry) => entry[0]), visible.pool.map((entry) => entry[0])), resumed.surfaces.front);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="model"]'); await ready(page); const editing = await snapshot(page);
  check('Edit restores author materials while native face capture can still repair an affected wall', editing.edit && editing.surfaces.front.sameOriginal
    && editing.surfaces.back.sameOriginal, editing.surfaces);
  await click(page, 'button.edit'); await ready(page);
  // A reversible fixture-only document lifecycle signal; it does not alter an
  // app clock, timer, source reader or wall update method.
  await page.evaluate(() => {
    const f = window.wallsFixture; f.hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
  }); await settle(page); const hidden = await snapshot(page);
  check('simulated document hiding releases wall-owned materials immediately', hidden.surfaces.front.sameOriginal && hidden.surfaces.back.sameOriginal, hidden.surfaces.front);
  await page.evaluate(() => {
    const f = window.wallsFixture; if (f.hiddenDescriptor) Object.defineProperty(document, 'hidden', f.hiddenDescriptor); else delete document.hidden;
    delete f.hiddenDescriptor; document.dispatchEvent(new Event('visibilitychange'));
  }); await page.bringToFront(); await ready(page); const shown = await snapshot(page);
  check('returning visibility reapplies current saved materials without adding a renderer or light', !shown.surfaces.front.sameOriginal
    && near(shown.surfaces.front.opacity[0], .2) && shown.rendererSame && shown.contexts === 1 && shown.pool.length === 12, shown.surfaces.front);
  await page.evaluate(() => {
    const spacer = document.createElement('div'); spacer.style.height = '1800px'; spacer.textContent = 'Simulated scroll distance for native offscreen lifecycle check';
    document.body.append(spacer); window.wallsFixture.scrollFixture = spacer;
  }); await page.mouse.move(12, 800); await page.mouse.wheel({ deltaY: 2000 });
  context = 'real scroll puts the card outside the viewport';
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherInView === false, { timeout: 5000, polling: 50 });
  const offscreen = await snapshot(page);
  check('genuine IntersectionObserver offscreen state restores exact authored wall references', offscreen.surfaces.front.sameOriginal
    && offscreen.surfaces.back.sameOriginal, offscreen.surfaces.front);
  await page.mouse.wheel({ deltaY: -2000 });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherInView === true, { timeout: 5000, polling: 50 });
  await page.evaluate(() => { window.wallsFixture.scrollFixture.remove(); delete window.wallsFixture.scrollFixture; }); await ready(page);
  const onscreen = await snapshot(page);
  check('genuine onscreen return restores the current saved effect without replacing authored geometry/textures', near(onscreen.surfaces.front.opacity[0], .2)
    && !onscreen.surfaces.front.sameOriginal && onscreen.surfaces.front.geometrySame && onscreen.surfaces.front.textureSame, onscreen.surfaces.front);
  await page.evaluate(() => { window.wallsFixture.detached = document.querySelector('taylors3d-card'); window.wallsFixture.detached.remove(); }); await settle(page);
  const disconnected = await page.evaluate(() => {
    const c = window.wallsFixture.detached, f = window.wallsFixture;
    return { stopped: !c._view._raf, original: f.nodes.front.material === f.originals.get('front').material && f.nodes.back.material === f.originals.get('back').material };
  });
  check('disconnect releases owned wall materials and stops the existing RAF', disconnected.stopped && disconnected.original, disconnected);
  await page.evaluate(() => document.querySelector('section.theme').append(window.wallsFixture.detached)); await ready(page);
  const reconnected = await snapshot(page);
  check('reconnect reapplies current settings using the same renderer and fixed pool', near(reconnected.surfaces.front.opacity[0], .2) && reconnected.rendererSame
    && equal(reconnected.pool.map((entry) => entry[0]), visible.pool.map((entry) => entry[0])) && reconnected.contexts === 1, reconnected.surfaces.front);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.wallsFixture; f.oldRoot = c._view.model.root; f.oldClonesDisposed = 0;
    f.oldOriginalAtTeardown = []; const clones = new Set(['front', 'back'].flatMap((role) => Array.isArray(f.nodes[role].material) ? f.nodes[role].material : [f.nodes[role].material]));
    f.oldCloneCount = clones.size; for (const material of clones) material.addEventListener('dispose', () => f.oldClonesDisposed++);
    const originalMaterials = new Set(['front', 'back'].map((role) => f.originals.get(role).material));
    for (const material of originalMaterials) material.addEventListener('dispose', () => f.oldOriginalAtTeardown.push(['front', 'back'].every((role) => f.nodes[role].material === f.originals.get(role).material)));
    c.setConfig({ ...c._config, model: '/demo/walls-fixture.glb?replacement=1' });
  });
  context = 'real authored GLB source replacement';
  await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card'); return !!c._view.model && !c._loading && c._view.model.root !== window.wallsFixture.oldRoot && c._objects.parts.has('walls_lamp');
  }, { timeout: 30000 }); await ready(page);
  const teardown = await page.evaluate(() => ({ clones: window.wallsFixture.oldClonesDisposed, expected: window.wallsFixture.oldCloneCount,
    originalAtTeardown: window.wallsFixture.oldOriginalAtTeardown }));
  check('real model replacement releases every owned clone once before authored material teardown', teardown.clones === teardown.expected
    && teardown.originalAtTeardown.length > 0 && teardown.originalAtTeardown.every(Boolean), teardown);
  // The replacement immediately applies saved effects. Turn them off through
  // the real layout path before capturing its fresh authored references.
  await setPolicy(page, { enabled: false }); await captureOriginals(page); await setPolicy(page, { scope: 'all_selected' }); await camera(page);
  const replacement = await snapshot(page);
  check('fresh model selectors resolve exactly after replacement with current pixels and no new lights', revealedGreen(replacement.pixels.upper)
    && replacement.report.length === 0 && replacement.contexts === 1 && replacement.rendererSame
    && equal(replacement.pool.map((entry) => entry[0]), visible.pool.map((entry) => entry[0])), replacement.pixels);
  await idleCheck(page);
}

async function contrast(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-wall-presentation-editor]');
    const luma = (colour) => {
      const values = colour.match(/[\d.]+/g)?.slice(0, 3).map(Number); if (values?.length !== 3) return NaN;
      return values.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    };
    return [...form.querySelectorAll('input,select,button')].filter((element) => element.getClientRects().length && !element.disabled).map((element) => {
      const css = getComputedStyle(element), r = element.getBoundingClientRect(), a = luma(css.color), b = luma(css.backgroundColor);
      return { id: element.dataset.field || element.dataset.act, checkbox: element.type === 'checkbox', ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
        height: r.height, width: r.width, left: r.left, right: r.right, viewport: innerWidth };
    });
  });
}

async function legacyClippingScenario(page) {
  await setPolicy(page, { enabled: false });
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); window.wallsFixture.replacedRoot = c._view.model.root;
    c.setConfig({ ...c._config, model: '/demo/walls-legacy-fixture.glb', merge: false });
  });
  context = 'real legacy-level fixture adds the existing model floor clip';
  await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card'); return !!c._view.model && !c._loading
      && c._view.model.root !== window.wallsFixture.replacedRoot && c._objects.parts.has('walls_lamp');
  }, { timeout: 30000 }); await ready(page); await captureOriginals(page); await camera(page);
  const base = await snapshot(page);
  check('authored legacy GLB uses the genuine existing model floor clip and shadow-clipping baseline', base.surfaces.front.clip[0].length === 1
    && base.surfaces.front.clipShadows[0] === true && base.surfaces.front.sameOriginal, base.surfaces.front);
  await setPolicy(page, { mode: 'cutaway', scope: 'all_selected', cut_height_m: 1 }); const cut = await snapshot(page);
  check('wall Cut-away retains the exact existing model clip plane and requests one real shadow batch when clipShadows is true', cut.surfaces.front.clip[0].length === 2
    && cut.surfaces.front.originalPlanesKept && cut.surfaces.front.clip[0].some((plane) => equal(plane, [0, -1, 0, 3]))
    && cut.stats.shadow === base.stats.shadow + 1 && cut.stats.shadowLights === base.stats.shadowLights + 1
    && cut.objectStats.shadowRequests === base.objectStats.shadowRequests && revealedGreen(cut.pixels.upper), { before: base.stats, after: cut.stats, surface: cut.surfaces.front });
  await setPolicy(page, { mode: 'cutaway', scope: 'all_selected', cut_height_m: 1.2 }); const height = await snapshot(page);
  check('changing a world cut height updates its owned plane and one current shadow batch without reallocating geometry/materials/programs', height.surfaces.front.clip[0].some((plane) => equal(plane, [0, -1, 0, 3.2]))
    && height.stats.shadow === cut.stats.shadow + 1 && height.stats.shadowLights === cut.stats.shadowLights + 1
    && equal(height.surfaces.front.material, cut.surfaces.front.material) && equal(height.programs, cut.programs)
    && equal(height.resources, cut.resources), { before: cut.stats, after: height.stats, programs: height.programs });
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ views: { ...c._layout.views, ground: { ...c._layout.views.ground,
      section: { normal: [1, 0, 0], constant: 0 } } } });
  }); await ready(page); await click(page, 'button.section'); await ready(page); await camera(page); const section = await snapshot(page);
  check('actual pixels compose model-floor/wall/Section clips: right upper interior survives and the left half is clipped', section.sectionPlanes === 1
    && section.surfaces.front.clip[0].length === 2 && section.surfaces.front.originalPlanesKept && section.surfaces.front.side[0] === 2
    && revealedGreen(section.pixels.right) && section.pixels.left.valid && !section.pixels.left.role
    && section.pixels.left.rgb.some((value, index) => Math.abs(value - section.pixels.right.rgb[index]) > 30), section.pixels);
  await click(page, 'button.section'); await ready(page);
  await page.evaluate(() => document.querySelector('taylors3d-card').commitFeatureLayout({ model_rendering: { shadows: 'off', lamps: 'inherit' } })); await ready(page);
  const off = await snapshot(page);
  await setPolicy(page, { mode: 'cutaway', scope: 'all_selected', cut_height_m: 1.5 }); const offChanged = await snapshot(page);
  const pending = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view;
    return { enabled: v.renderer.shadowMap.enabled, global: v.renderer.shadowMap.needsUpdate,
      pool: [v.sun, ...c._objects.pool.points, ...c._objects.pool.spots].some((light) => light.shadow?.needsUpdate) };
  });
  check('global shadow-off guards true wall shadow-clipping changes and leaves every pending map clear', !pending.enabled && !pending.global && !pending.pool
    && offChanged.stats.shadow === off.stats.shadow && offChanged.stats.shadowLights === off.stats.shadowLights
    && offChanged.objectStats.shadowRequests === off.objectStats.shadowRequests, { pending, before: off.stats, after: offChanged.stats });
  await idleCheck(page, 'policy');
  await setPolicy(page, { mode: 'normal' }); const restored = await snapshot(page);
  check('Normal restores the exact authored reference and only its existing model clip', restored.surfaces.front.sameOriginal
    && restored.surfaces.front.clip[0].length === 1 && restored.surfaces.front.originalPlanesKept
    && restored.surfaces.front.cast === base.surfaces.front.cast, restored.surfaces.front);
}
async function importsAndNarrowScenario(page, mode) {
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="model"]');
  await type(page, 'opacity', 25);
  const light = await contrast(page);
  check('native wall draft controls retain readable light-theme text and 44px touch targets', light.some((entry) => entry.id === 'wall-presentation-save')
    && light.some((entry) => entry.id === 'wall-presentation-opacity') && light.every((entry) => entry.height >= 44 && (entry.checkbox || entry.ratio >= 4.5)), light);
  await page.evaluate(() => { const section = document.querySelector('section.theme'); section.classList.remove('light'); section.classList.add('dark'); });
  const dark = await contrast(page);
  check('native wall choices and Save/Cancel remain readable in dark theme', dark.length === light.length && dark.every((entry) => entry.height >= 44 && (entry.checkbox || entry.ratio >= 4.5)), dark);
  await page.setViewport({ width: 320, height: 1100, deviceScaleFactor: 1, hasTouch: true }); await settle(page);
  const narrow = await contrast(page);
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('320px wall editor fits every actual control without losing 44px touch targets or contrast', noOverflow && narrow.length === dark.length
    && narrow.every((entry) => entry.left >= -1 && entry.right <= entry.viewport + 1 && entry.height >= 44 && (!entry.checkbox || entry.width >= 44)
      && (entry.checkbox || entry.ratio >= 4.5)), narrow);
  await screenshot(page, mode === 'source' ? 'walls-editor-narrow.png' : 'walls-editor-narrow-bundle.png', true);
  await click(page, action('cancel'));
  // Imported missing links are intentional fixtures, not silently repaired or
  // broadly matched against similarly named model nodes.
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), row = window.wallsFixture.rows[0];
    c.commitFeatureLayout({ wall_presentation: { enabled: true, mode: 'fade', scope: 'all_selected', opacity: .2, retained: { imported: true },
      walls: [{ ...row, selector: 'node:missing\\*exact', floor_id: 'removed-floor', retained: 'missing-link' }] } });
  }); await settle(page);
  let imported = await formState(page);
  check('missing imported mesh/floor references remain visible with no broad name expansion', imported.rowStatus?.includes('unavailable')
    && imported.saved.walls[0].selector === 'node:missing\\*exact' && imported.saved.walls[0].floor_id === 'removed-floor'
    && imported.saved.walls[0].retained === 'missing-link' && imported.calls === 0, imported);
  await type(page, 'opacity', 28); await click(page, action('save')); await ready(page); imported = await formState(page);
  check('changing a display value preserves unavailable imported references and extensions exactly', imported.saved.opacity === .28
    && imported.saved.walls[0].selector === 'node:missing\\*exact' && imported.saved.walls[0].floor_id === 'removed-floor'
    && imported.saved.retained.imported && imported.saved.walls[0].retained === 'missing-link' && imported.calls === 0, imported);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ wall_presentation: {
      enabled: true, mode: 'fade', scope: 'all_selected', opacity: '0.2', retained: true, walls: [] } });
  }); await settle(page); await type(page, 'transition_ms', 100);
  const malformed = await formState(page);
  check('malformed imported numeric settings remain invalid and cannot be activated by an unrelated edit', malformed.saveDisabled
    && malformed.draft.opacity === '0.2' && malformed.saved.opacity === '0.2' && malformed.status?.includes('Invalid settings'), malformed);
  await click(page, action('cancel')); await click(page, 'button.edit'); await page.setViewport({ width: 1280, height: 1100, deviceScaleFactor: 1, hasTouch: true });
  await setPolicy(page, { mode: 'normal' }); await ready(page);
  check('all visual/editor/import checks send zero Home Assistant service commands', (await snapshot(page)).calls === 0);
}

async function main() {
  const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
  for (const mode of modes) {
    label = `${mode}: `; let session;
    try {
      session = await open(mode);
      check('loads the requested implementation with a single explicitly authored model fixture', session.requests.includes(mode === 'source' ? '/src/taylors3d-card.js' : '/dist/taylors3d-card.js')
        && !session.requests.includes(mode === 'source' ? '/dist/taylors3d-card.js' : '/src/taylors3d-card.js')
        && session.requests.filter((request) => request === '/demo/walls-fixture.glb').length === 1);
      await defaultScenario(session.page); await editorScenario(session.page, mode); await visualsScenario(session.page, mode);
      await transitionScenario(session.page); await compositionScenario(session.page); await ambientScenario(session.page);
      await lifecycleScenario(session.page); await legacyClippingScenario(session.page); await importsAndNarrowScenario(session.page, mode);
      check('restores exact passive pixel observer identity before teardown', await restoreObservers(session.page));
    } catch (error) { check('scenario completes', false, { message: error.message, stack: error.stack, context }); }
    finally {
      if (session) {
        errors.push(...session.pageErrors, ...session.errors.filter((message) => !session.pageErrors.some((entry) => entry.message === message)));
        await restoreObservers(session.page).catch(() => {}); await session.close();
      }
    }
  }
  label = ''; check('no-browser-errors', errors.length === 0, errors); console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`);
  if (checks.some((passed) => !passed)) process.exitCode = 1;
}
await main();
