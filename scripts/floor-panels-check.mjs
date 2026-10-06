// Native source/bundle floor-pane proof using the original simulated GLB and HA
// entities. Read pixels after the real render; never move a product camera from
// evaluate(), manufacture input events, widen a phone or force a dirty frame.
// Evidence note: checker before the selected-floor keyboard proof was frozen at
// SHA256 6F992927BA95415F70F80D95940168AE6AFAF02032F26D33188E15C2810ED302.
// Before authored-light native coverage: SHA256
// F9D9858531184E2190F33717052408E13CAE2B4891A2F41087A6EDD166EACE71.
// Frozen first browser run (147/153): checker SHA256
// A87FFA19B39016A07E00A6A515054E503977D8BF18DC1AF7B09D01759C234E1A.
// Frozen route/keyboard run (232/237), before passive idle diagnostics:
// CEC331C52A80E2F58162379CD43B06EAAA39C23C0C3ADB16BABFA83ED68F4523.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { floorPresentationFixtureGlb, floorFixtureEntities as entities, floorFixtureIds as ids } from './lib/floor-presentation-fixture.mjs';

const checks = [], errors = [];
let label = '', context = 'setup';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, epsilon = 1e-6) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= epsilon;
const pointsNear = (a, b, epsilon = 1e-6) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => near(value, b[index], epsilon));
// Native settled OrbitControls produced only ~5e-14 derived camera residuals.
// Allow the same 1e-10 as ready() solely for these five camera fields; exact pane
// identity/order/rectangles and every saved source/resource comparison remain.
const sameIdlePanes = (before, after) => Array.isArray(before) && Array.isArray(after) && before.length === after.length
  && before.every((pane, index) => {
    const { position, quaternion, projection, up, zoom, ...exact } = pane;
    const { position: nextPosition, quaternion: nextQuaternion, projection: nextProjection, up: nextUp, zoom: nextZoom, ...nextExact } = after[index];
    return equal(exact, nextExact) && pointsNear(position, nextPosition, 1e-10) && pointsNear(quaternion, nextQuaternion, 1e-10)
      && pointsNear(projection, nextProjection, 1e-10) && pointsNear(up, nextUp, 1e-10) && near(zoom, nextZoom, 1e-10);
  });
// Exact leaf differences explain an unchanged-state failure without replacing
// any strict assertion with a tolerance or forcing another product render.
const differences = (before, after, field = '') => {
  if (equal(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .flatMap((key) => differences(before[key], after[key], field ? `${field}.${key}` : key));
  }
  return [{ field, before, after, ...(typeof before === 'number' && typeof after === 'number' ? { delta: after - before } : {}) }];
};
const check = (name, passed, detail) => { checks.push(!!passed); console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const field = (key) => `[data-field="floor-presentation-${key}"]`;
const action = (key) => `[data-act="floor-presentation-${key}"]`;
const flush = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function ready(page) {
  await page.evaluate(() => { window.floorPanelStable = null; });
  try { await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card'), v = c?._view, now = performance.now();
    if (!v || c._loading || v.dirty || v._tween || v._modelMotionMoving || v._wallPresentation?.moving
      || c._securityLayer?.moving || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350) { window.floorPanelStable = null; return false; }
    const rect = v.renderer.domElement.getBoundingClientRect();
    const signature = JSON.stringify([rect.x, rect.y, rect.width, rect.height, v.stats.frames, v.stats.shadow, v.stats.shadowLights,
      c._devicePopup?._session, c._editing, c._section, c.floorPresentationReport()?.panels]);
    const camera = [...v.camera.position.toArray(), ...v.controls.target.toArray(), ...v.camera.quaternion.toArray(),
      ...v.camera.up.toArray(), v.camera.zoom], previous = window.floorPanelStable;
    // OrbitControls can continue damping below its render threshold. Require
    // the actual primary pose to stay within 1e-10 of one anchored observation
    // for the same 350ms before taking strict unchanged-state snapshots.
    if (previous?.signature !== signature || previous.camera.length !== camera.length
      || camera.some((value, index) => Math.abs(value - previous.camera[index]) > 1e-10)) {
      window.floorPanelStable = { signature, camera, at: now }; return false;
    }
    return now - window.floorPanelStable.at > 350;
  }, { timeout: 15000, polling: 50 }); } catch (error) {
    error.message += `; ${label}${context}; ${JSON.stringify(await snapshot(page).catch(() => null))}`; throw error;
  }
}

async function control(page, selector, callback) {
  context = 'native ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw new Error('Missing control ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' })); await flush(page);
    const accessible = await element.evaluate((node) => { const r = node.getBoundingClientRect(), hit = node.getRootNode().elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { ok: !node.disabled && r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && (hit === node || node.contains(hit)),
        disabled: node.disabled === true, box: { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom },
        hit: hit && { tag: hit.tagName, classes: hit.getAttribute('class'), dataset: { ...hit.dataset } } }; });
    if (!accessible.ok) throw new Error('Native control is disabled, clipped or covered: ' + selector + '; ' + JSON.stringify(accessible));
    await callback(element);
  } finally { await handle.dispose(); }
  await flush(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const choose = (page, name, value) => control(page, field(name), (element) => element.select(value));
async function typeNumber(page, name, value) {
  await control(page, field(name), async (element) => {
    await element.focus(); await page.keyboard.down('Control');
    try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }
    await page.keyboard.press('Backspace'); await page.keyboard.type(String(value)); await page.keyboard.press('Tab');
  });
  const actual = await page.evaluate((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector)?.value, field(name));
  if (actual !== String(value)) throw new Error(`Native ${name} input is ${actual}, expected ${value}`);
}
async function shot(page, name) {
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'screenshots', name), fullPage: true });
}

async function open(mode) {
  let transport, session; const requests = [];
  context = `${mode} browser and owned HTTP server launch`;
  try {
    transport = await launch(); context = `${mode} native page creation`;
    session = await newPage(transport.browser, { width: 1280, height: 1080, hasTouch: true }); const { page } = session;
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
      .replace(/<section class="theme dark">[\s\S]*?<\/section>/, '')
      .replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
    const imports = JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } });
    html = html.replace('</head>', `<script type="importmap">${imports}</script></head>`);
    if (mode === 'source') html = html.replace('src="../dist/taylors3d-card.js"', 'src="../src/taylors3d-card.js"');
    await page.evaluateOnNewDocument(() => {
      window.__demoMowerPaused = true; window.floorPanelContexts = new Set();
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const result = original.call(this, kind, ...args);
        if (result && /^webgl/.test(kind)) window.floorPanelContexts.add(this); return result; };
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => { const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
      else if (url.pathname === '/demo/floor-panels.glb') request.respond({ status: 200, contentType: 'model/gltf-binary', body: floorPresentationFixtureGlb({ authoredLights: true }) });
      else request.continue();
    });
    context = `${mode} initial demo/model navigation`;
    await page.goto(`${transport.base}/demo/index.html?model=/demo/floor-panels.glb&merge=0&floor=all&view=3d&height=740px`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront(); context = `${mode} initial fp_lamp model-object readiness`;
    await page.waitForFunction(() => document.querySelector('taylors3d-card')?._objects?.parts.has('fp_lamp'), { timeout: 30000 });
    await page.evaluate(async ({ mode, entities, ids }) => {
      const c = document.querySelector('taylors3d-card');
      window.floorPanelBench = { services: [], commits: 0, renderer: c._view.renderer, scene: c._view.scene,
        labels: c._view.labelRenderer, pool: [...c._objects.pool.points, ...c._objects.pool.spots], capture: null };
      c.hass = { ...c._hass, callWS: undefined };
      c.setConfig({ ...c._config, layout_key: `floor-panels-native-${mode}`, height: '740px', merge: false, model_opacity: 1,
        lights: 'auto', sky_bodies: false, control_panel: 'right', device_tap_action: 'controls', mini_map: true,
        layout_style: 'house', house_colour_scheme: 'dark' }); await c._layoutReady;
      const registry = (entity_id, area_id) => ({ entity_id, area_id, device_id: null, hidden: false, disabled_by: null, entity_category: null });
      const state = (reported, attributes) => ({ state: reported, attributes });
      const areas = { floor_ground_area: { area_id: 'floor_ground_area', name: 'Simulated ground room', floor_id: 'ground' },
        floor_upper_area: { area_id: 'floor_upper_area', name: 'Simulated upper room', floor_id: 'upper' } };
      c.hass = { ...c._hass, callWS: undefined, callService: (...args) => { window.floorPanelBench.services.push(args); return Promise.resolve(); },
        config: { ...c._hass.config, latitude: null, longitude: null }, areas, devices: {},
        floors: { ground: { floor_id: 'ground', name: 'Simulated ground', level: 0 }, upper: { floor_id: 'upper', name: 'Simulated upper', level: 1 } },
        entities: Object.fromEntries(Object.entries(entities).map(([key, entity]) => [entity, registry(entity,
          ['door', 'mower'].includes(key) ? 'floor_ground_area' : ['weather', 'unrelated'].includes(key) ? null : 'floor_upper_area')])),
        states: { [entities.lamp]: state('on', { friendly_name: 'Simulated upper lamp', brightness: 180,
          supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: [255, 180, 90] }),
          [entities.switch]: state('on', { friendly_name: 'Simulated upper switch' }),
          [entities.camera]: state('idle', { friendly_name: 'Simulated upper camera' }),
          [entities.door]: state('off', { friendly_name: 'Simulated hinge contact', device_class: 'door' }),
          [entities.mower]: state('idle', { friendly_name: 'Simulated cross-floor mower' }),
          [entities.position]: state('current', { x: .9, y: -.6 }),
          [entities.temperature]: state('20', { friendly_name: 'Simulated upper temperature', device_class: 'temperature', unit_of_measurement: '°C' }),
          [entities.leak]: state('off', { friendly_name: 'Simulated upper leak', device_class: 'moisture' }),
          [entities.presence]: state('upstairs', { friendly_name: 'Simulated exact room report' }),
          [entities.weather]: state('sunny', { friendly_name: 'Simulated current weather' }),
          [entities.unrelated]: state('0', { friendly_name: 'Known unrelated sensor' }),
          'sun.sun': state('below_horizon', { elevation: -20, azimuth: 180 }) } };
      const objects = Object.fromEntries(['lamp', 'switch', 'camera', 'door', 'mower'].map((key) => [ids[key], { entity: entities[key], hidden: false }]));
      c._commit({ ...c._layout, floors: [{ id: 'ground', name: 'Simulated ground', elevation: 0, height: 3 },
        { id: 'upper', name: 'Simulated upper', elevation: 4, height: 3 }], rooms: [], pins: {}, hidden: [], mower: {}, objects, groups: {},
        model: { levels: { [ids.ground]: { floor: 'ground', auto: false }, [ids.upper]: { floor: 'upper', auto: false },
          [ids.background]: { floor: null, auto: false } },
          rooms: { [ids.groundRoom]: { area: 'floor_ground_area', auto: false }, [ids.upperRoom]: { area: 'floor_upper_area', auto: false } } },
        // A model-defined All view defaults to its highest visible storey's HA
        // floor. Declare both confirmed floors through the supported saved-view
        // override; the authored model-level show rules remain unchanged.
        floor_presentation: { mode: 'assembled' }, views: { all: { floors: ['ground', 'upper'] } }, room_overlays: { mode: 'off' }, alert_bindings: [],
        wall_presentation: undefined, model_rendering: { shadows: 'realtime', lamps: 'inherit' }, ambient_idle: { enabled: false },
        scene_previews: { enabled: false }, weather: { enabled: false }, security_bindings: [],
        // Reuse floors-check's explicit simulated room observation. The normal
        // tracking reader must resolve the current sensor into the actual room.
        presence_bindings: [{ id: 'upstairs', entity: entities.presence, kind: 'room_location',
          room_source: { entity: entities.presence, room_map: { upstairs: `m:${ids.upperRoom}` } } }],
        vehicle_bindings: [], vacuum_bindings: [], camera_coverage: {} });
      const commit = c.commitFeatureLayout.bind(c); c.commitFeatureLayout = (...args) => { window.floorPanelBench.commits++; return commit(...args); };
      c.resetHistory(); document.querySelector('section.theme h2').textContent = `Simulated separate-floor panel bench · ${mode}`;
    }, { mode, entities, ids });
    await ready(page); await observePixels(page);
    await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), f = window.floorPanelBench;
      f.originalRooms = structuredClone(c._layout.rooms); f.originalModel = structuredClone(c._layout.model); f.originalFloors = structuredClone(c._layout.floors);
      f.sourceLevels = Object.fromEntries(c._view.model.manifest.levels.map((level) => [level.id, level.node.position.toArray()]));
    });
    return { ...transport, ...session, requests };
  } catch (error) {
    // Preserve observations while the actual page is still open. A failed open
    // never reaches main's session variable, so it must carry its own evidence.
    error.actualErrors = session ? session.errors.slice() : [];
    error.openSnapshot = session ? await session.page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), v = c?._view;
      return { url: location.href, cardDefined: !!customElements.get('taylors3d-card'), cardPresent: !!c,
        cardConnected: c?.isConnected, shadowRoot: !!c?.shadowRoot, view: !!v, loading: c?._loading,
        model: !!v?.model, modelRoot: v?.model?.root?.name, modelError: c?._modelError,
        modelStatus: c?._modelStatus, requestedModel: c?._config?.model,
        modelObjects: (v?.model?.manifest?.objects || []).map((object) => ({ id: object.id, kind: object.kind, type: object.type })),
        objectParts: c?._objects?.parts ? [...c._objects.parts.keys()] : null,
        modelLevelIds: (v?.model?.manifest?.levels || []).map((level) => level.id),
        moduleScripts: [...document.querySelectorAll('script[type="module"]')].map((script) => ({ src: script.src, inline: script.textContent.slice(0, 160) })),
        bodyText: document.body?.textContent?.slice(0, 500), readyState: document.readyState };
    }).catch((failure) => ({ observationError: failure.message })) : undefined;
    if (error.openSnapshot) error.openSnapshot.requestPaths = requests.slice();
    error.resourceState = { transportReady: !!transport, sessionReady: !!session };
    errors.push(...error.actualErrors); if (transport) await transport.close(); throw error;
  }
}

async function observePixels(page) {
  await page.evaluate(() => {
    const v = document.querySelector('taylors3d-card')._view, f = window.floorPanelBench; f.previousRender = v.onRender;
    const allocation = (scene) => { const ids = []; scene.traverse((node) => { if (node.isLight) ids.push(node.uuid); }); return ids.sort(); };
    v.model.root.traverse((node) => { if (node.isDirectionalLight && node.name === 'simulated_upper_authored_light') f.authoredLight = node; });
    f.authoredModel = v.model.root;
    f.authoredInitial = f.authoredLight && { uuid: f.authoredLight.uuid, parentUuid: f.authoredLight.parent?.uuid,
      intensity: f.authoredLight.intensity, visible: f.authoredLight.visible, allocation: allocation(v.scene) };
    f.previousRendererRender = v.renderer.render;
    v.renderer.render = function (...args) {
      // Inspect the actual already-built pane camera, excluding the zero-size
      // shadow preparation pass. Reading a render must not recalculate cameras.
      const entry = v._floorPanels?._entries.find((pane) => pane.camera === args[1]);
      const viewport = this.getViewport({ copy: (value) => ({ x: value.x, y: value.y, width: value.z, height: value.w }) });
      const pane = v.model && args[0] === f.scene && entry && viewport.width > 0 && viewport.height > 0;
      const light = f.authoredLight, before = pane && light && { intensity: light.intensity, visible: light.visible };
      const result = f.previousRendererRender.apply(this, args);
      if (pane && light) {
        if (f.authoredPaneFrame?.frame !== v.stats.frames) f.authoredPaneFrame = { frame: v.stats.frames, rows: [] };
        f.authoredPaneFrame.rows.push({ floorId: entry.floorId, viewport, before, after: { intensity: light.intensity, visible: light.visible },
          uuid: light.uuid, parentUuid: light.parent?.uuid, sameNode: light === f.authoredLight, sameRenderer: this === f.renderer,
          sameModel: v.model.root === f.authoredModel, allocation: allocation(args[0]) });
      }
      return result;
    };
    v.onRender = (...args) => {
      // Forward the actual ephemeral pane frame unchanged, with View's normal
      // receiver. This passive readback must not alter the product label pass.
      f.previousRender?.apply(v, args); if (!v._floorPanels?.active) return;
      const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const canvas = v.renderer.domElement.getBoundingClientRect(), panes = v._floorPanels.entries();
      const sample = (screen) => {
        if (!screen) return null;
        const x = Math.round((screen[0] - canvas.left) / canvas.width * width), y = height - 1 - Math.round((screen[1] - canvas.top) / canvas.height * height);
        if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) return null;
        return [0, 1, 2, 3].map((channel) => { const values = [];
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) values.push(pixels[((y + dy) * width + x + dx) * 4 + channel]);
          values.sort((a, b) => a - b); return values[12]; });
      };
      const clearValue = Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)), clearRgba = clearValue.map((value) => Math.round(value * 255));
      const capture = { frame: v.stats.frames, drawingSize: [width, height], canvas: [canvas.left, canvas.top, canvas.width, canvas.height], floors: {},
        clearValue, clearRgba, rendererClearAlpha: v.renderer.getClearAlpha(),
        rendererClearHex: v.renderer.getClearColor(v.hemi.color.clone()).getHexString(), sceneBackground: v.scene.background?.isColor
          ? v.scene.background.getHexString() : v.scene.background ? 'texture' : null };
      for (const [floorId, source] of [['ground', [2.7, v.floorElevation('ground'), 1.3]], ['upper', [1.2, v.floorElevation('upper'), 1.1]]]) {
        const mapped = v.sourceWorldToDisplay(source, floorId), world = mapped.ok && v.camera.position.clone().fromArray(mapped.point);
        const screen = world && v._floorPanels.projectWorld(world, floorId);
        capture.floors[floorId] = { source, display: mapped.point, screen, rgba: sample(screen), pane: screen && v._floorPanels.paneAt(...screen)?.floorId };
      }
      if (panes.length === 2) {
        const [first, second] = panes.map((entry) => entry.rect), horizontal = second.x > first.x;
        const local = horizontal ? [(first.x + first.width + second.x) / 2, first.y + first.height / 2]
          : [first.x + first.width / 2, (first.y + first.height + second.y) / 2];
        capture.gap = [canvas.left + local[0] * canvas.width / v.size.w, canvas.top + local[1] * canvas.height / v.size.h];
        capture.gapRgba = sample(capture.gap);
      }
      f.capture = capture;
    };
  });
}

async function snapshot(page) {
  return page.evaluate((ids) => {
    const c = document.querySelector('taylors3d-card') || window.floorPanelBench?.detached, v = c?._view, f = window.floorPanelBench;
    if (!v) return null;
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const panes = (v._floorPanels?.entries() || []).map((entry) => ({ floorId: entry.floorId, rect: { ...entry.rect },
      position: entry.camera.position.toArray(), quaternion: entry.camera.quaternion.toArray(), zoom: entry.camera.zoom,
      projection: entry.camera.projectionMatrix.elements.slice(), uuid: entry.camera.uuid, up: entry.camera.up.toArray() }));
    const css = (v.cssObjects || []).filter((entry) => entry.kind === 'label' || entry.kind === 'marker').map((entry) => {
      const node = entry.obj.element, box = rect(node), style = getComputedStyle(node), parent = node.closest('[data-taylors3d-floor-pane]');
      return { floorId: entry.floorId, kind: entry.kind, text: node.textContent, parent: parent?.dataset.taylors3dFloorPane,
        shown: style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0, box };
    });
    const headers = [...v.labelRenderer.domElement.querySelectorAll('[data-taylors3d-floor-pane] > button')].map((node) => ({
      floorId: node.parentNode.dataset.taylors3dFloorPane, text: node.textContent, box: rect(node), pressed: node.getAttribute('aria-pressed'),
      pane: rect(node.parentNode), hit: (() => { const r = node.getBoundingClientRect(), hit = c.shadowRoot.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === node || node.contains(hit); })() }));
    const frame = v.captureCameraFrame?.();
    return { report: c.floorPresentationReport(), panes, css, headers, canvas: rect(v.renderer.domElement), stage: rect(c._stage),
      popup: c._devicePopup?.isOpen ? { selection: c._devicePopup._selection?.kind, entity: c._devicePopup._selection?.marker?.entityId,
        roomId: c._devicePopup._selection?.room?.id, areaId: c._devicePopup._selection?.room?.area_id,
        text: c._devicePopup.el.textContent, placement: c._devicePopup.el.dataset.placement,
        shellLayout: c._devicePopup.el.dataset.houseControlsLayout, box: rect(c._devicePopup.el),
        allControls: !!c._devicePopup.el.querySelector('[data-action="more-info"]') } : null,
      model: !!v.model, saved: structuredClone(c._layout.floor_presentation), rooms: structuredClone(c._layout.rooms), floors: structuredClone(c._layout.floors),
      modelSettings: structuredClone(c._layout.model), pins: structuredClone(c._layout.pins), positions: structuredClone([...(c._positions || [])]), sourceCamera: frame && { mode: frame.mode, position: frame.position,
        target: frame.target, quaternion: frame.quaternion, up: frame.up, zoom: frame.zoom, framing: frame.framing },
      levels: Object.fromEntries((v.model?.manifest.levels || []).map((level) => [level.id, level.node.position.toArray()])),
      pool: [...c._objects.pool.points, ...c._objects.pool.spots].map((light) => ({ uuid: light.uuid, castShadow: light.castShadow, intensity: light.intensity })),
      identity: { renderer: v.renderer === f.renderer, scene: v.scene === f.scene, labels: v.labelRenderer === f.labels,
        pool: f.pool.every((light, index) => light === [...c._objects.pool.points, ...c._objects.pool.spots][index]), contexts: window.floorPanelContexts.size },
      stats: { ...v.stats }, budget: c._objects.stats.budget, shadowRequests: c._objects.stats.shadowRequests, memory: { ...v.renderer.info.memory },
      programs: v.renderer.info.programs.map((program) => program.id), capture: f.capture, active: v._floorPanels?.active,
      authoredLight: (() => { const lights = []; v.scene.traverse((node) => { if (node.isLight) lights.push(node); });
        const current = lights.find((node) => node === f.authoredLight);
        return { initial: f.authoredInitial, frame: f.authoredPaneFrame, present: !!current, uuid: current?.uuid,
          intensity: current?.intensity, visible: current?.visible, parentUuid: current?.parent?.uuid,
          sameNode: current === f.authoredLight, sameModel: v.model?.root === f.authoredModel,
          oldModelDetached: f.authoredModel?.parent === null, allocation: lights.map((node) => node.uuid).sort() }; })(),
      panelState: { compiled: structuredClone(v._floorCompiled), enabled: v._floorOptions?.enabled, disposed: v._disposed,
        sectionClip: !!v.sectionClip, visibleFloor: v.visibleFloor, visibleSet: v._visibleSet && [...v._visibleSet],
        rows: (v._floorPanels?._rows() || []).map((row) => row.floor_id), size: { ...v.size },
        selectedView: c._viewId, selectedFloors: c._viewState?.floors, floorOnly: c._floorOnly },
      activeFloor: v._floorPanels?.activeFloorId, calls: f.services.length, commits: f.commits,
      editing: c._editing, section: c._section, raf: !!v._raf, overflow: document.documentElement.scrollWidth > innerWidth,
      sourceUpper: f.sourceLevels?.[ids.upper], history: { canUndo: c._history.canUndo, canRedo: c._history.canRedo } };
  }, ids);
}

async function miniMapState(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), map = c._miniMap, panels = c._view._floorPanels;
    return { exists: !!map && !map.disposed, cardVisible: c._miniMapVisible, visible: map?.visible, hidden: map?.el.hidden,
      display: map && getComputedStyle(map.el).display, toolbarPressed: c._miniMapBtn?.getAttribute('aria-pressed'),
      floorId: map?.scene?.floorId, activeFloor: panels.activeFloorId, focus: map?._camera?.focus, camera: panels.cameraSnapshot(),
      cameraIndicator: map?.cameraLayer.getAttribute('transform'), calls: window.floorPanelBench.services.length };
  });
}

async function miniMapFocus(page) {
  context = 'native SVG background focus';
  if ((await miniMapState(page)).hidden) { await click(page, '.toolbar .minimap-toggle'); await ready(page); }
  // Use the upper pane's real header: its nonzero horizontal DISPLAY offset
  // makes a repeated conversion visible, unlike a ground-only focus test.
  await click(page, '[data-taylors3d-floor-pane="upper"] > button'); await ready(page);
  const before = await snapshot(page), beforeMap = await miniMapState(page);
  const candidate = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), map = c._miniMap;
    if (!map || map.disposed || map.el.hidden || !map.scene?.transform) return { reason: 'Actual mini-map has no visible plan' };
    const box = map.svg.getBoundingClientRect(), vb = map.svg.viewBox.baseVal, rejected = [];
    if (!(box.width > 0 && box.height > 0 && vb.width > 0 && vb.height > 0)) return { reason: 'Actual SVG/viewBox has no size' };
    for (const fy of [.04, .96, .1, .9, .5]) for (const fx of [.04, .96, .1, .9, .5]) {
      const client = [Math.round(box.left + box.width * fx), Math.round(box.top + box.height * fy)];
      const hit = c.shadowRoot.elementFromPoint(...client), svg = [vb.x + (client[0] - box.left) / box.width * vb.width,
        vb.y + (client[1] - box.top) / box.height * vb.height];
      const inViewport = client[0] >= 0 && client[0] < innerWidth && client[1] >= 0 && client[1] < innerHeight;
      if (hit === map.ground && inViewport && !hit.closest('[data-room],[data-marker]')) {
        return { client, svg, source: map.scene.transform.toPlan(svg), floorId: map.scene.floorId,
          svgBox: { x: box.x, y: box.y, width: box.width, height: box.height }, viewBox: [vb.x, vb.y, vb.width, vb.height],
          background: hit.classList.contains('map-ground') };
      }
      rejected.push({ client, svg, inViewport, hit: hit && { tag: hit.tagName, classes: hit.getAttribute('class'), dataset: { ...hit.dataset } } });
    }
    return { reason: 'No uncovered actual SVG background point', floorId: map.scene.floorId, rejected };
  });
  if (!candidate.client) throw new Error(`Native SVG background is unavailable: ${JSON.stringify(candidate)}`);
  await page.mouse.click(...candidate.client); await ready(page);
  const after = await snapshot(page), afterMap = await miniMapState(page), paneIdentity = (s) => s.panes.map(({ floorId, uuid }) => ({ floorId, uuid }));
  check('native SVG background click retains both exact panes and the active upper floor', candidate.background && candidate.floorId === 'upper'
    && before.panes.length === 2 && equal(paneIdentity(before), paneIdentity(after)) && before.activeFloor === 'upper'
    && after.activeFloor === before.activeFloor && beforeMap.floorId === 'upper' && afterMap.floorId === 'upper', { input: candidate, before: beforeMap, after: afterMap });
  const target = afterMap.camera?.camera?.target, ownSource = target && [target[0], -target[2]];
  check('native SVG focus and live mini-map focus use the same SOURCE point without a doubled offset', pointsNear(ownSource, candidate.source)
    && pointsNear(afterMap.focus, candidate.source) && afterMap.calls === 0, { expectedSource: candidate.source, paneSourceTarget: ownSource, liveMapFocus: afterMap.focus });
  check('native mini-map focus sends no HA action and preserves exact saved floors, rooms, pins and model source coordinates', after.calls === 0
    && equal(before.floors, after.floors) && equal(before.rooms, after.rooms) && equal(before.pins, after.pins)
    && equal(before.positions, after.positions) && equal(before.modelSettings, after.modelSettings) && equal(before.levels, after.levels)
    && equal(before.saved, after.saved), { calls: after.calls, savedFloors: after.floors, modelLevels: after.levels });
}

async function devicePoint(page) {
  return page.evaluate(({ ids, entities }) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, rejected = [];
    const info = (node) => node && { tag: node.tagName, classes: node.getAttribute('class'), dataset: { ...node.dataset } };
    const inViewport = (screen) => screen[0] >= 0 && screen[0] < innerWidth && screen[1] >= 0 && screen[1] < innerHeight;
    if (!v.model) {
      const marker = c._markers.find((item) => item.entityId === entities.lamp && c._positions.get(item.id)?.floorId === 'upper');
      const node = marker && c._markerEls.get(marker.id), source = marker && c._positions.get(marker.id);
      if (!node || node.hidden) return { entity: entities.lamp, reason: 'Actual current Upper lamp marker is absent' };
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || node.getAttribute('aria-disabled') === 'true') {
        return { entity: entities.lamp, source, reason: 'Actual lamp marker is hidden or disabled' };
      }
      // Use the actual current marker's own DOM, not its projected physical
      // centre, which another real control can cover on a compact panel.
      for (const part of [node.querySelector('.fp-dot'), node.querySelector('.fp-val'), node].filter(Boolean)) {
        const box = part.getBoundingClientRect(); if (!(box.width > 0 && box.height > 0)) continue;
        for (const [x, y] of [[.5, .5], [.2, .2], [.8, .2], [.2, .8], [.8, .8]]) {
          const screen = [Math.round(box.x + box.width * x), Math.round(box.y + box.height * y)];
          const hit = c.shadowRoot.elementFromPoint(...screen), pane = v._floorPanels.paneAt(...screen), objectHit = c._objectHit(...screen, 30);
          const evidence = { route: 'actual marker DOM', screen, source: { ...source }, markerId: marker.id,
            pane: pane?.floorId, uiHit: info(hit), ownMarkerHit: hit?.closest('.fp-marker') === node, objectHit };
          if (inViewport(screen) && pane?.floorId === 'upper' && evidence.ownMarkerHit && !objectHit) {
            return { ...evidence, entity: entities.lamp, validated: true, rejected };
          }
          rejected.push(evidence);
        }
      }
      return { entity: entities.lamp, source, rejected, reason: 'Every actual Upper lamp marker point is obstructed' };
    }
    const bound = c._objects.objectAt(ids.switch), node = bound?.obj?.node;
    const source = c._objects.anchors().find((entry) => entry.id === ids.switch);
    const displayed = c._objects.displayAnchors().find((entry) => entry.id === ids.switch);
    if (!node || bound.binding?.entity !== entities.switch || !source || !displayed || v.floorForModelNode(node) !== 'upper') {
      return { entity: entities.switch, reason: 'Actual bound Upper switch/source anchor is absent or inconsistent' };
    }
    const candidates = [], addWorld = (world, route, detail) => {
      const projected = v._floorPanels.projectWorld(world, 'upper');
      if (projected) candidates.push({ screen: projected.map(Math.round), route, display: world.toArray(),
        source: v.displayWorldToSource(world.toArray(), 'upper'), ...detail });
    };
    addWorld(displayed.world, 'actual bound anchor', {});
    // Project existing authored triangles without recomputing geometry bounds,
    // moving nodes, changing sources or manufacturing a different device.
    node.traverse((mesh) => {
      const positions = mesh.isMesh && mesh.geometry?.attributes.position, indices = mesh.geometry?.index;
      if (!positions) return;
      for (let face = 0; face + 2 < (indices?.count || positions.count); face += 3) {
        const ids = [0, 1, 2].map((offset) => indices ? indices.getX(face + offset) : face + offset);
        for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.7, .15, .15], [.15, .7, .15], [.15, .15, .7]]) {
          const local = v.camera.position.clone().set(0, 0, 0);
          ids.forEach((index, corner) => local.addScaledVector(v.camera.position.clone().fromBufferAttribute(positions, index), weights[corner]));
          const authored = local.toArray(); addWorld(local.applyMatrix4(mesh.matrixWorld), 'actual authored switch body', { mesh: mesh.name, local: authored, face });
        }
      }
    });
    const anchor = v._floorPanels.projectWorld(displayed.world, 'upper');
    if (anchor) for (const radius of [8, 16, 24, 29]) for (let angle = 0; angle < 16; angle++) {
      const radians = angle * Math.PI / 8, offset = [radius * Math.cos(radians), radius * Math.sin(radians)];
      candidates.push({ route: 'actual 30px mouse object-hit policy', screen: anchor.map((value, axis) => Math.round(value + offset[axis])),
        source: source.world.toArray(), display: displayed.world.toArray(), offset });
    }
    for (const candidate of candidates) {
      const { screen } = candidate, uiHit = c.shadowRoot.elementFromPoint(...screen), pane = v._floorPanels.paneAt(...screen);
      const objectHit = c._objectHit(...screen, 30), hit = v.pickModel(...screen);
      const expectedSurface = hit?.kind === 'object' && hit.id === ids.switch || hit?.kind === 'room' && hit.id === ids.upperRoom;
      const evidence = { ...candidate, pane: pane?.floorId, uiHit: info(uiHit), canvasHit: uiHit === v.renderer.domElement,
        objectHit, modelHit: hit && { kind: hit.kind, id: hit.id, point: hit.hit?.point, mesh: hit.hit?.object?.name } };
      if (inViewport(screen) && evidence.canvasHit && pane?.floorId === 'upper' && objectHit === ids.switch && expectedSurface) {
        return { ...evidence, entity: entities.switch, validated: true, boundObjectId: ids.switch, rejected };
      }
      rejected.push(evidence);
    }
    return { entity: entities.switch, boundObjectId: ids.switch, source: source.world.toArray(), display: displayed.world.toArray(), rejected,
      reason: 'No actual current switch body/30px hit route is uncovered; UI priority remains intact' };
  }, { ids, entities });
}

async function currentKeyboardTarget(page, kind) {
  return page.evaluate(({ kind, entities }) => {
      const c = document.querySelector('taylors3d-card');
      const describe = (node, entity, floorId, record) => {
        if (!node) return { exists: false, kind, record, floorId, entity };
        const selector = kind === 'tracked actor' ? '[data-taylors3d-floor-pane="upper"] [data-tracking-id="presence:upstairs"]'
          : '[data-taylors3d-floor-pane="upper"] .fp-marker[aria-label=' + JSON.stringify(node.getAttribute('aria-label')) + ']';
        const box = node.getBoundingClientRect(), style = getComputedStyle(node), client = [box.x + box.width / 2, box.y + box.height / 2];
        const hit = c.shadowRoot.elementFromPoint(...client);
        return { exists: c.shadowRoot.querySelector(selector) === node, kind, record, floorId, entity, selector,
          tag: node.tagName, role: node.getAttribute('role'), disabled: node.disabled === true || node.getAttribute('aria-disabled') === 'true',
          shown: !node.hidden && style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0,
          reachable: box.top >= 0 && box.bottom <= innerHeight && (hit === node || node.contains(hit)),
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          blockedByMiniMap: !!hit?.closest('.taylors3d-minimap'),
          hit: hit && { tag: hit.tagName, classes: hit.getAttribute('class'), dataset: { ...hit.dataset } } };
      };
      if (kind === 'tracked actor') {
        const current = c._trackingData.records.find((item) => item.id === 'presence:upstairs');
        const part = current && c._trackingLayer.parts.get(current.id);
        const node = part?.label?.element, record = current && { id: current.id, shown: current.shown, status: current.status, entity: current.entity,
          location: { ...current.location }, bindingId: current.bindingId, currentPart: part?.label?.element === node };
        return describe(node, current?.entity, current?.location?.floorId, record);
      }
      const priority = (item) => item.entityId === entities.temperature ? 0 : item.entityId === entities.lamp ? 1 : 2;
      const candidates = c._markers.filter((item) => c._positions.get(item.id)?.floorId === 'upper').sort((a, b) => priority(a) - priority(b));
      const rejected = [];
      for (const current of candidates) {
        const target = describe(c._markerEls.get(current.id), current.entityId, c._positions.get(current.id).floorId,
          { id: current.id, entity: current.entityId, position: { ...c._positions.get(current.id) } });
        if (target.exists && target.shown && target.reachable && !target.disabled) return { ...target, rejected };
        rejected.push(target);
      }
      return { exists: false, kind, rejected, blockedByMiniMap: rejected.some((target) => target.blockedByMiniMap), reason: 'No current Upper ordinary marker is exposed' };
  }, { kind, entities });
}

async function keyboardSelections(page) {
  for (const kind of ['tracked actor', 'ordinary marker']) {
    context = `native ${kind} keyboard activation`;
    await click(page, '[data-taylors3d-floor-pane="ground"] > button'); await ready(page);
    const before = await snapshot(page), beforeMap = await miniMapState(page);
    let target = await currentKeyboardTarget(page, kind), closedMap = false;
    if ((!target.exists || !target.reachable) && target.blockedByMiniMap && (await miniMapState(page)).hidden === false) {
      const blocked = target; await click(page, '.taylors3d-minimap .map-close'); await ready(page);
      const map = await miniMapState(page), hidden = map.exists && map.cardVisible === false && map.visible === false && map.hidden === true
        && map.display === 'none' && map.toolbarPressed === 'false' && map.activeFloor === 'ground' && map.calls === 0;
      check(`${kind}: native map Close removes its real blocker without a HA action`, hidden, { blocked, map });
      if (!hidden) throw new Error('The actual mini-map blocker could not be closed');
      closedMap = true; target = await currentKeyboardTarget(page, kind);
    }
    const resolved = target.exists && target.floorId === 'upper' && target.shown && target.reachable && !target.disabled
      && (kind !== 'tracked actor' || target.tag === 'BUTTON' && target.entity === entities.presence && target.record?.shown);
    if (!resolved) throw new Error(`No actual current Upper ${kind} control: ${JSON.stringify(target)}`);
    // The existing helper proves the real control is visible, enabled, in the
    // viewport and uncovered. Focus is allowed; Enter itself is genuine input.
    await control(page, target.selector, async (element) => { await element.focus(); });
    const focused = await page.evaluate((selector) => { const c = document.querySelector('taylors3d-card');
      return c.shadowRoot.activeElement === c.shadowRoot.querySelector(selector); }, target.selector);
    check(`${kind}: current Upper control is reachable and focused while Ground is active`, resolved && focused
      && before.activeFloor === 'ground' && beforeMap.floorId === 'ground' && before.calls === 0, { target, map: beforeMap });
    await page.keyboard.press('Enter'); await ready(page);
    const after = await snapshot(page), afterMap = await miniMapState(page), identity = (s) => s.panes.map(({ floorId, uuid }) => ({ floorId, uuid }));
    check(`${kind}: genuine Enter selects Upper and opens its exact source entity controls`, after.popup?.selection === 'marker'
      && after.popup.entity === target.entity && after.popup.allControls && after.activeFloor === 'upper' && afterMap.floorId === 'upper'
      && before.panes.length === 2 && equal(identity(before), identity(after)), { target, popup: after.popup, map: afterMap });
    check(`${kind}: keyboard selection sends no HA action and preserves exact saved source coordinates`, after.calls === 0
      && equal(before.floors, after.floors) && equal(before.rooms, after.rooms) && equal(before.pins, after.pins)
      && equal(before.positions, after.positions) && equal(before.levels, after.levels) && equal(before.modelSettings, after.modelSettings)
      && equal(before.saved, after.saved), { calls: after.calls, floors: after.floors, levels: after.levels });
    await click(page, '.t3d-popup-close'); await ready(page);
    if (closedMap) {
      await click(page, '.toolbar .minimap-toggle'); await ready(page); const map = await miniMapState(page);
      const shown = map.exists && map.cardVisible === true && map.visible === true && map.hidden === false && map.toolbarPressed === 'true'
        && map.activeFloor === 'upper' && map.floorId === 'upper' && map.calls === 0;
      check(`${kind}: native toolbar restores the exact Upper mini-map without a HA action`, shown, map);
      if (!shown) throw new Error('Actual mini-map could not be restored after keyboard activation');
    }
  }
}

async function editorProof(page) {
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="model"]');
  await choose(page, 'mode', 'horizontal'); await typeNumber(page, 'gap_m', 3); await click(page, field('panels'));
  const draft = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector('[data-field="floor-presentation-panels"]');
    return { value: c._edit._floorPresentationEditor.draft.panels, raw: c._layout.floor_presentation,
      editor: c._editing, report: c.floorPresentationReport(), width: input.getBoundingClientRect().width, height: input.getBoundingClientRect().height }; });
  check('native separate-panels checkbox makes only a draft and has a 44px touch target', draft.value === true && draft.raw.mode === 'assembled'
    && draft.editor && draft.report.mode === 'assembled' && draft.width >= 44 && draft.height >= 44, draft);
  const before = await snapshot(page); await click(page, action('save')); const saved = await snapshot(page);
  check('native Save creates one history edit and retains assembled geometry during Edit', saved.saved.mode === 'horizontal' && saved.saved.panels === true && saved.saved.gap_m === 3
    && saved.commits === before.commits + 1 && saved.report.mode === 'assembled' && saved.calls === 0, saved.saved);
  await click(page, '[data-act="history-undo"]'); const undo = await snapshot(page);
  check('native Undo restores the original assembled policy', undo.saved.mode === 'assembled' && undo.saved.panels !== true && undo.history.canRedo, undo.saved);
  await click(page, '[data-act="history-redo"]'); const redo = await snapshot(page);
  check('native Redo restores the separate-panels preference', redo.saved.mode === 'horizontal' && redo.saved.panels === true, redo.saved);
  await click(page, field('panels')); await click(page, action('cancel'));
  check('native Cancel discards the checkbox change without another commit', await page.evaluate((commits) => { const c = document.querySelector('taylors3d-card');
    return c._layout.floor_presentation.panels === true && c.shadowRoot.querySelector('[data-field="floor-presentation-panels"]').checked
      && window.floorPanelBench.commits === commits; }, redo.commits));
  await control(page, field('panels'), async (element) => { await element.focus(); });
  const focus = await page.evaluate((entity) => { const c = document.querySelector('taylors3d-card'), input = c.shadowRoot.querySelector('[data-field="floor-presentation-panels"]');
    window.floorPanelBench.checkbox = input;
    c.hass = { ...c._hass, states: { ...c._hass.states, [entity]: { ...c._hass.states[entity], state: '1' } } };
    return { focusedBefore: c.shadowRoot.activeElement === input, checked: input.checked }; }, entities.unrelated); await ready(page);
  check('native checkbox focus survives an unrelated actual HA state push', focus.focusedBefore && focus.checked && await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); return c.shadowRoot.activeElement === window.floorPanelBench.checkbox
      && c.shadowRoot.querySelector('[data-field="floor-presentation-panels"]') === window.floorPanelBench.checkbox;
  }));
  await click(page, 'button.edit'); await ready(page);
}

async function roomPoint(page, floorId) {
  return page.evaluate((floorId) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, rejected = [];
    window.floorPanelBench.roomPointDiagnostics = null;
    const nodeInfo = (node) => node && { tag: node.tagName, id: node.id, classes: String(node.className || ''), dataset: { ...node.dataset } };
    const candidates = floorId === 'upper' ? [[1.2, -1.1], [-1.6, -1.1], [1.6, 1.1], [-1.6, 1.1], [0, 1.1]]
      : [[2.7, -1.3], [-2.7, -1.3], [2.7, 1.3], [-2.7, 1.3], [0, 1.6]];
    for (const source of candidates) {
      const mapped = v.sourceWorldToDisplay([source[0], v.floorElevation(floorId), -source[1]], floorId);
      const screen = mapped.ok && v._floorPanels.projectWorld(v.camera.position.clone().fromArray(mapped.point), floorId);
      const uiHit = screen && c.shadowRoot.elementFromPoint(...screen), objectHit = screen && c._objectHit(...screen, 30);
      const hit = screen && v.pickModel(...screen), pane = screen && v._floorPanels.paneAt(...screen), back = screen && v.displayPlanPoint(...screen, floorId);
      const modelFloor = hit?.hit?.object && v.floorForModelNode(hit.hit.object);
      rejected.push({ source, mapped, screen, uiHit: nodeInfo(uiHit), uiParent: nodeInfo(uiHit?.parentElement),
        canvasHit: uiHit === v.renderer.domElement, objectHitId: objectHit, pickModel: hit && { kind: hit.kind, id: hit.id,
          objectName: hit.hit?.object?.name, point: hit.hit?.point, floorId: modelFloor }, pane: pane?.floorId, back });
      if (screen && uiHit === v.renderer.domElement && !objectHit && pane?.floorId === floorId
        && (!v.model || hit?.kind === 'room' && modelFloor === floorId))
        return { source, screen, floorId: pane.floorId, back, hit: hit && { kind: hit.kind, id: hit.id } };
    }
    // Only record actual rejected candidates and live cameras. No click, camera
    // move, fallback coordinate or successful point is manufactured here.
    const box = v.renderer.domElement.getBoundingClientRect();
    window.floorPanelBench.roomPointDiagnostics = { floorId, rejected,
      canvas: { x: box.x, y: box.y, width: box.width, height: box.height }, size: { ...v.size },
      primaryCamera: { position: v.camera.position.toArray(), target: v.controls.target.toArray(),
        quaternion: v.camera.quaternion.toArray(), zoom: v.camera.zoom, near: v.camera.near, far: v.camera.far },
      baseline: v._floorPanels._base && { target: v._floorPanels._base.target.toArray(), zoom: v._floorPanels._base.zoom, distance: v._floorPanels._base.distance },
      panes: v._floorPanels.entries().map((entry) => ({ floorId: entry.floorId, rect: { ...entry.rect }, target: entry.target?.toArray(),
        position: entry.camera.position.toArray(), quaternion: entry.camera.quaternion.toArray(), zoom: entry.camera.zoom,
        projection: entry.camera.projectionMatrix.elements.slice(), near: entry.camera.near, far: entry.camera.far })) };
    return null;
  }, floorId);
}

async function unrelated(page) {
  // Observe existing requests only: no extra controls.update(), render, clock
  // changes or dirty assignments. Restore the exact data descriptor and its
  // latest value even when a native wait or snapshot fails.
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, descriptor = Object.getOwnPropertyDescriptor(v, 'dirty');
    if (!descriptor?.configurable || !descriptor.writable || !Object.hasOwn(descriptor, 'value')) throw new Error('Idle observer needs the existing writable dirty data property');
    let value = descriptor.value, total = 0; const assignments = [];
    const state = () => ({ time: performance.now(), stats: { ...v.stats }, pending: !!c._pending, cameraMovedAt: v._camMovedAt,
      occlusion: { full: v._occFull, timer: !!v._occTimer, generation: v._occGen },
      camera: { position: v.camera.position.toArray(), target: v.controls.target.toArray(), quaternion: v.camera.quaternion.toArray(), zoom: v.camera.zoom },
      pivot: v.pivotMarker ? { visible: v.pivotMarker.visible, position: v.pivotMarker.position.toArray(), target: v.controls.target.toArray() } : null,
      controls: { state: v.controls.state, autoRotate: v.controls.autoRotate, scale: v.controls._scale, cursorZoom: v.controls._performCursorZoom,
        panOffset: v.controls._panOffset.toArray(), sphericalDelta: { theta: v.controls._sphericalDelta.theta, phi: v.controls._sphericalDelta.phi } } });
    const entry = state();
    Object.defineProperty(v, 'dirty', { configurable: descriptor.configurable, enumerable: descriptor.enumerable,
      get: () => value, set: (next) => { value = next; if (next === true) {
        total++; if (assignments.length < 256) assignments.push({ ...state(), stack: new Error('Actual dirty assignment').stack });
      } } });
    window.floorPanelIdleDiagnostic = { finish: () => {
      const exit = state(); Object.defineProperty(v, 'dirty', { ...descriptor, value });
      return { entry, exit, total, omitted: Math.max(0, total - assignments.length), assignments };
    } };
  });
  let before, after, diagnostic;
  try {
    before = await snapshot(page);
    await page.evaluate(async (entity) => { const c = document.querySelector('taylors3d-card');
      for (let index = 0; index < 10; index++) {
        c.hass = { ...c._hass, states: { ...c._hass.states, [entity]: { ...c._hass.states[entity], state: String(100 + index) } } };
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }, entities.unrelated); await ready(page); after = await snapshot(page);
  } finally {
    diagnostic = await page.evaluate(() => {
      try { return window.floorPanelIdleDiagnostic.finish(); } finally { delete window.floorPanelIdleDiagnostic; }
    });
  }
  check('ten unrelated state readings add zero render frames or shadow passes', equal(before.stats, after.stats)
    && before.budget === after.budget && before.shadowRequests === after.shadowRequests, { before: before.stats, after: after.stats,
    ...(before.stats.frames !== after.stats.frames ? { diagnostic } : {}) });
  check('idle readings allocate nothing and keep scene, pane cameras, pool and coordinates unchanged', equal(before.memory, after.memory)
    && equal(before.programs, after.programs) && sameIdlePanes(before.panes, after.panes) && equal(before.levels, after.levels)
    && equal(before.rooms, after.rooms) && after.identity.pool && after.calls === 0, { before: before.memory, after: after.memory,
    differences: Object.fromEntries(['memory', 'programs', 'panes', 'levels', 'rooms', 'sourceCamera'].map((key) => [key, differences(before[key], after[key], key)])),
    poolIdentity: after.identity.pool, calls: after.calls });
}

async function gesturePoint(page, floorId, displacement) {
  const route = await page.evaluate(({ floorId, displacement }) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, pane = v._floorPanels.entries().find((entry) => entry.floorId === floorId);
    if (!pane) return { rejected: [], reason: 'Requested gesture pane is absent', floorId };
    const box = v.renderer.domElement.getBoundingClientRect(), rejected = [];
    // Probe the actual full path in the current viewport. Header, labels,
    // mini-map and any other controls keep their normal hit-test priority.
    for (const y of [.35, .5, .7, .85]) for (const x of [.15, .3, .5, .7, .85]) {
      const point = [box.x + (pane.rect.x + pane.rect.width * x) * box.width / v.size.w,
        box.y + (pane.rect.y + pane.rect.height * y) * box.height / v.size.h];
      const samples = Array.from({ length: 9 }, (_, index) => {
        const client = point.map((value, axis) => value + displacement[axis] * index / 8), hit = c.shadowRoot.elementFromPoint(...client);
        return { client, canvasHit: hit === v.renderer.domElement, pane: v._floorPanels.paneAt(...client)?.floorId,
          inViewport: client[0] >= 0 && client[0] < innerWidth && client[1] >= 0 && client[1] < innerHeight,
          uiHit: hit && { tag: hit.tagName, classes: String(hit.className || ''), dataset: { ...hit.dataset } } };
      });
      if (samples.every((sample) => sample.canvasHit && sample.pane === floorId && sample.inViewport)) return { point, floorId, displacement, samples };
      rejected.push({ point, blocked: samples.filter((sample) => !sample.canvasHit || sample.pane !== floorId || !sample.inViewport) });
    }
    return { floorId, displacement, rejected, reason: 'No uncovered native canvas path exists' };
  }, { floorId, displacement });
  if (!route.point) throw new Error(`No genuine canvas input route: ${JSON.stringify(route)}`);
  return route;
}

async function gestures(page) {
  const before = await snapshot(page), floorId = before.panes[0]?.floorId;
  context = 'native pane orbit'; const orbitInput = await gesturePoint(page, floorId, [-24, -16]);
  await page.mouse.move(...orbitInput.point); await page.mouse.down();
  await page.mouse.move(orbitInput.point[0] - 24, orbitInput.point[1] - 16, { steps: 8 }); await page.mouse.up(); await ready(page); const orbit = await snapshot(page);
  check('native orbit changes the real pane camera direction and links both floor views', !pointsNear(before.panes[0].quaternion, orbit.panes[0].quaternion)
    && pointsNear(orbit.panes[0].quaternion, orbit.panes[1].quaternion) && equal(before.levels, orbit.levels)
    && equal(before.rooms, orbit.rooms) && orbit.calls === 0, { input: orbitInput, before: before.panes, after: orbit.panes });
  context = 'native pane pan'; const panInput = await gesturePoint(page, floorId, [-18, 12]);
  await page.mouse.move(...panInput.point); await page.mouse.down({ button: 'right' });
  await page.mouse.move(panInput.point[0] - 18, panInput.point[1] + 12, { steps: 8 }); await page.mouse.up({ button: 'right' }); await ready(page); const pan = await snapshot(page);
  const delta = (a, b) => b.position.map((value, index) => value - a.position[index]);
  check('native pan translates both pane cameras by the same displacement without changing saved positions', !pointsNear(delta(orbit.panes[0], pan.panes[0]), [0, 0, 0])
    && pointsNear(delta(orbit.panes[0], pan.panes[0]), delta(orbit.panes[1], pan.panes[1])) && equal(pan.rooms, before.rooms)
    && equal(pan.pins, before.pins) && pan.calls === 0, { input: panInput, first: delta(orbit.panes[0], pan.panes[0]), second: delta(orbit.panes[1], pan.panes[1]) });
  context = 'native pane zoom'; const zoomInput = await gesturePoint(page, floorId, [0, 0]);
  await page.mouse.move(...zoomInput.point); await page.mouse.wheel({ deltaY: -120 }); await ready(page); const zoom = await snapshot(page);
  check('native zoom changes both pane views while preserving their linked orientation and exact floor offsets', zoom.panes.every((entry, index) =>
    !pointsNear(entry.position, pan.panes[index].position) || !near(entry.zoom, pan.panes[index].zoom))
    && pointsNear(zoom.panes[0].quaternion, zoom.panes[1].quaternion) && equal(zoom.report.rows, before.report.rows)
    && equal(zoom.modelSettings, before.modelSettings) && zoom.calls === 0, { input: zoomInput, before: pan.panes, after: zoom.panes });
}

async function matrix(page, mode, kind, width) {
  label = `${mode}/${kind}/${width}px: `; context = 'responsive pane matrix';
  await page.setViewport({ width, height: 1080, deviceScaleFactor: 1, hasTouch: true }); await ready(page);
  // The immutable 17/25 cleanup run kept Upper selected after native Edit.
  // Reset correctly retains that choice. Choose the real All chip explicitly
  // before proving simultaneous panes; never change product selection in JS.
  await click(page, '[data-view="all"]'); await ready(page);
  const chosen = await page.evaluate(() => { const c = document.querySelector('taylors3d-card');
    return { view: c._viewId, floorOnly: c._floorOnly,
      pressed: c.shadowRoot.querySelector('[data-view="all"]')?.getAttribute('aria-pressed'),
      floors: c._viewState?.floors, calls: window.floorPanelBench.services.length };
  });
  check('native All chip selects both floors before reset and pane checks', chosen.view === 'all' && !chosen.floorOnly
    && chosen.pressed === 'true' && equal(chosen.floors, ['ground', 'upper']) && chosen.calls === 0, chosen);
  if (chosen.view !== 'all' || chosen.floorOnly || chosen.pressed !== 'true' || !equal(chosen.floors, ['ground', 'upper'])) {
    throw new Error('The real All floor chip did not select both confirmed floors');
  }
  await click(page, 'button.reset'); await ready(page); await miniMapFocus(page);
  await click(page, 'button.reset'); await ready(page); const state = await snapshot(page), panes = state.panes;
  check('valid saved horizontal policy opens exactly the requested two floor panels', state.report.valid && state.report.mode === 'horizontal'
    && state.report.panels === true && state.saved.panels === true && equal(panes.map((entry) => entry.floorId), ['ground', 'upper']),
    { report: state.report, panelState: state.panelState });
  check('two distinct cameras reuse one genuine renderer, scene, label renderer and 12-light pool', panes.length === 2 && panes[0].uuid !== panes[1].uuid
    && state.identity.renderer && state.identity.scene && state.identity.labels && state.identity.pool && state.identity.contexts === 1
    && state.pool.length === 12 && state.pool.filter((light) => light.castShadow).length === 4, state.identity);
  check('wide panes sit side by side, phone panes stack, and both remain inside the real canvas', panes.length === 2 && !state.overflow
    && panes.every((entry) => entry.rect.x >= 0 && entry.rect.y >= 0 && entry.rect.width >= 44 && entry.rect.height >= 44)
    && (width === 320 ? panes[1].rect.y > panes[0].rect.y && near(panes[0].rect.x, panes[1].rect.x)
      : panes[1].rect.x > panes[0].rect.x && near(panes[0].rect.y, panes[1].rect.y)), { panes, canvas: state.canvas });
  check('source floor elevations and explicit HA/model links remain unchanged while displayed floors separate', state.floors[1].elevation === 4
    && state.report.rows.every((row) => row.offset.length === 3) && state.calls === 0
    && (!state.model || state.modelSettings.levels.fp_upper.floor === 'upper'), { floors: state.floors, rows: state.report.rows });
  if (panes.length !== 2) throw new Error('Two actual floor panes were not created');
  if (kind === 'glb') {
    const light = state.authoredLight, rows = light.frame?.rows || [], initial = light.initial;
    check('actual imported upper directional light contributes zero to Ground and its authored intensity to Upper', initial?.intensity === 2.35
      && light.frame?.frame === state.stats.frames && equal(rows.map((row) => row.floorId), ['ground', 'upper'])
      && rows.every((row) => row.before.intensity === (row.floorId === 'ground' ? 0 : 2.35)
        && row.after.intensity === row.before.intensity && row.before.visible === initial.visible && row.after.visible === initial.visible), light);
    check('authored light restores exactly outside the real pane frame and retains node, renderer and allocated light identities', light.present
      && light.sameNode && light.sameModel && light.intensity === initial?.intensity && light.visible === initial?.visible
      && light.uuid === initial?.uuid && light.parentUuid === initial?.parentUuid && equal(light.allocation, initial?.allocation)
      && rows.length === 2 && rows.every((row) => row.sameNode && row.sameRenderer && row.sameModel
        && row.uuid === initial.uuid && row.parentUuid === initial.parentUuid && equal(row.allocation, initial.allocation))
      && state.identity.renderer && state.identity.pool && state.pool.length === 12, light);
  }
  for (const floorId of ['ground', 'upper']) {
    const sample = state.capture?.floors[floorId], header = state.headers.find((entry) => entry.floorId === floorId);
    check(`${floorId}: actual framebuffer contains an opaque floor sample in its own viewport`, sample?.pane === floorId
      && sample.rgba?.length === 4 && sample.rgba[3] > 200 && sample.rgba.slice(0, 3).some((value) => value > 12), sample);
    check(`${floorId}: GLB slab colour or drawn geometry verifies the correct floor`, kind === 'glb'
      ? sample?.rgba && (floorId === 'ground' ? sample.rgba[2] > sample.rgba[0] * 2 : sample.rgba[0] > sample.rgba[2] * 2)
      : state.rooms.some((room) => room.floor_id === floorId && room.polygon.length === 4) && sample?.pane === floorId, sample);
    const labels = state.css.filter((entry) => entry.floorId === floorId && entry.kind === 'label' && entry.shown);
    check(`${floorId}: real room labels remain visible only inside the correct pane`, labels.length > 0 && labels.every((entry) => entry.parent === floorId)
      && state.css.filter((entry) => entry.shown && entry.parent === floorId).every((entry) => entry.floorId === floorId), labels);
    check(`${floorId}: native pane header is readable, reachable and at least 44px square`, header && header.text.includes('Simulated')
      && header.box.width >= 44 && header.box.height >= 44 && header.hit && header.box.x >= header.pane.x && header.box.y >= header.pane.y
      && header.box.right <= header.pane.right + 1 && header.box.bottom <= header.pane.bottom + 1, header);
    await click(page, `[data-taylors3d-floor-pane="${floorId}"] > button`); await ready(page);
    const active = await snapshot(page);
    check(`${floorId}: clicking its actual header selects that pane without a Home Assistant action`, active.activeFloor === floorId
      && active.headers.find((entry) => entry.floorId === floorId)?.pressed === 'true' && active.calls === 0, active.headers);
    let point = await roomPoint(page, floorId), closedMap = false;
    if (!point && (await miniMapState(page)).hidden === false) {
      const rejected = await page.evaluate(() => window.floorPanelBench.roomPointDiagnostics);
      // Deliberately close the real overlay, exactly as a user can. Retry the
      // identical authored SOURCE candidates and canvas/object/room guards.
      await click(page, '.taylors3d-minimap .map-close'); await ready(page); const hiddenMap = await miniMapState(page);
      const hidden = hiddenMap.exists && hiddenMap.cardVisible === false && hiddenMap.visible === false && hiddenMap.hidden === true
        && hiddenMap.display === 'none' && hiddenMap.toolbarPressed === 'false' && hiddenMap.activeFloor === floorId && hiddenMap.calls === 0;
      check(`${floorId}: native mini-map close exposes the scene with zero HA actions and correct toolbar state`, hidden, { rejected, map: hiddenMap });
      if (!hidden) throw new Error('Actual mini-map close did not hide the overlay');
      closedMap = true; point = await roomPoint(page, floorId);
    }
    const pointDetail = point || await page.evaluate(() => window.floorPanelBench.roomPointDiagnostics);
    check(`${floorId}: actual pane ray returns the authored source room coordinates`, point && pointsNear(point.source, point.back)
      && point.floorId === floorId, pointDetail);
    if (!point) throw new Error(`No real ${floorId} room point is exposed`);
    await page.mouse.click(...point.screen); await ready(page); const room = await snapshot(page);
    check(`${floorId}: native floor tap opens its correct room controls beside or below the real scene`, room.popup?.selection === 'room'
      && room.popup.areaId === (floorId === 'ground' ? 'floor_ground_area' : 'floor_upper_area')
      && room.popup.text.includes(floorId === 'ground' ? 'Simulated ground room' : 'Simulated upper room')
      && (width === 320 ? room.popup.shellLayout === 'sheet' && room.popup.box.y >= room.canvas.bottom
        : room.popup.shellLayout === 'right' && room.canvas.right <= room.popup.box.x)
      && room.popup.box.x >= room.stage.x && room.popup.box.right <= room.stage.right
      && room.popup.box.y >= room.stage.y && room.popup.box.bottom <= room.stage.bottom
      && room.calls === 0, { popup: room.popup, canvas: room.canvas, stage: room.stage });
    await click(page, '.t3d-popup-close'); await ready(page);
    if (closedMap) {
      await click(page, '.toolbar .minimap-toggle'); await ready(page); const reopenedMap = await miniMapState(page);
      const shown = reopenedMap.exists && reopenedMap.cardVisible === true && reopenedMap.visible === true && reopenedMap.hidden === false
        && reopenedMap.display !== 'none' && reopenedMap.toolbarPressed === 'true' && reopenedMap.activeFloor === floorId
        && reopenedMap.floorId === floorId && reopenedMap.calls === 0;
      check(`${floorId}: native toolbar reopens the exact floor mini-map without a HA action`, shown, reopenedMap);
      if (!shown) throw new Error('Actual mini-map toolbar could not reopen the exact floor plan');
    }
  }
  const gap = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), v = c._view, point = window.floorPanelBench.capture?.gap;
    const capture = window.floorPanelBench.capture;
    return point && { point, pixel: window.floorPanelBench.capture.gapRgba, pane: v._floorPanels.paneAt(...point)?.floorId,
      ray: !!v._floorPanels.rayAt(...point), hit: !!v.pickModel(...point), object: c._objectHit(...point, 30),
      clearValue: capture.clearValue, clearRgba: capture.clearRgba, rendererClearAlpha: capture.rendererClearAlpha,
      rendererClearHex: capture.rendererClearHex, sceneBackground: capture.sceneBackground,
      gapMatchesClear: capture.gapRgba?.every((value, index) => value === capture.clearRgba[index]) }; });
  // A GLB's current sky intentionally clears to an opaque colour; exact four-
  // channel equality proves a blank gap without assuming transparent black.
  check('the real gap has no pane ray, model hit, device hit or copied floor pixels', gap && !gap.pane && !gap.ray && !gap.hit
    && !gap.object && gap.pixel?.length === 4 && gap.gapMatchesClear === true, gap);
  if (!gap) throw new Error('No actual inter-pane gap'); await page.mouse.click(...gap.point); await ready(page);
  check('native gap click opens no room or device controls and sends no service', !(await snapshot(page)).popup && (await snapshot(page)).calls === 0);
  const device = await devicePoint(page);
  check('an actual source-derived Upper device hit route respects current UI priority and the exact entity', device.validated && device.pane === 'upper'
    && device.entity === (kind === 'glb' ? entities.switch : entities.lamp), device);
  if (!device.screen || !device.validated || device.pane !== 'upper') throw new Error(`Actual Upper device is unreachable: ${JSON.stringify(device)}`);
  await page.mouse.click(...device.screen); await ready(page); const opened = await snapshot(page);
  check('native upper device tap opens the exact entity with all-controls fallback and no toggle', opened.popup?.selection === 'marker'
    && opened.popup.entity === device.entity
    && opened.popup.text.includes(kind === 'glb' ? 'Simulated upper switch' : 'Simulated upper lamp') && opened.popup.allControls
    && opened.calls === 0, { anchor: device, popup: opened.popup });
  await shot(page, `floor-panels-${mode}-${kind}-${width}.png`); await click(page, '.t3d-popup-close'); await ready(page);
  await keyboardSelections(page); await gestures(page); await unrelated(page);
}

async function suspendAndRestore(page) {
  label = label.split('/')[0] + ': ';
  const before = await snapshot(page);
  await click(page, 'button.section'); await ready(page); const section = await snapshot(page);
  check('native Section temporarily removes panes and restores the assembled source model', section.section && section.report.mode === 'assembled'
    && section.report.panels !== true && section.panes.length === 0 && section.saved.panels === true
    && pointsNear(section.levels.fp_upper, section.sourceUpper), section.report);
  await click(page, 'button.section'); await ready(page); const restored = await snapshot(page);
  check('closing Section restores the same separate floor policy and original 12 lamp objects', restored.report.panels === true
    && restored.panes.length === 2 && restored.identity.pool && equal(restored.modelSettings, before.modelSettings), restored.report);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="model"]'); await ready(page); const editing = await snapshot(page);
  check('native Edit assembles floors, removes pane headers and preserves the saved preference', editing.editing && editing.report.mode === 'assembled'
    && editing.panes.length === 0 && editing.headers.length === 0 && editing.saved.panels === true, editing.report);
  await click(page, 'button.edit'); await ready(page);
  check('leaving Edit restores separate panels without changing saved room or entity links', (await snapshot(page)).report.panels === true
    && equal((await snapshot(page)).modelSettings, before.modelSettings));
  const preOff = await snapshot(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ floor_presentation: { ...c._layout.floor_presentation, panels: false } }); });
  await ready(page); const off = await snapshot(page);
  check('turning panels off removes only the extra views and preserves the exact primary camera', off.report.mode === 'horizontal' && off.report.panels === false
    && off.panes.length === 0 && ['position', 'target', 'quaternion', 'up'].every((key) => pointsNear(off.sourceCamera[key], preOff.sourceCamera[key], 1e-9))
    && near(off.sourceCamera.zoom, preOff.sourceCamera.zoom, 1e-9) && equal(off.levels, preOff.levels), { before: preOff.sourceCamera, after: off.sourceCamera });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ floor_presentation: { mode: 'assembled', panels: true } }); });
  await ready(page); const assembled = await snapshot(page);
  check('assembled mode retains the preference while restoring original source level transforms', assembled.report.mode === 'assembled'
    && assembled.report.panels === false && assembled.saved.panels === true && pointsNear(assembled.levels.fp_upper, assembled.sourceUpper)
    && assembled.levels.fp_ground.every((value) => value === 0) && assembled.calls === 0, assembled.levels);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.commitFeatureLayout({ floor_presentation: {
    mode: 'horizontal', panels: true, floors: ['ground', 'upper'], gap_m: 3 } }); }); await ready(page);
}

async function drawn(page) {
  context = 'same renderer receives actual drawn room polygons';
  await page.evaluate((entities) => {
    const c = document.querySelector('taylors3d-card'); c.setConfig({ ...c._config, model: undefined });
    c.commitFeatureLayout({ model: {}, objects: {}, mower: {}, rooms: [
      { id: 'drawn-ground', floor_id: 'ground', area_id: 'floor_ground_area', name: 'Simulated ground room', polygon: [[-3, -2], [3, -2], [3, 2], [-3, 2]], doors: [] },
      { id: 'drawn-upper', floor_id: 'upper', area_id: 'floor_upper_area', name: 'Simulated upper room', polygon: [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]], doors: [] } ],
      pins: { [`entity:${entities.lamp}`]: { x: -.8, y: .5, z: .12, floor_id: 'upper', auto: false } },
      presence_bindings: [{ id: 'upstairs', entity: entities.presence, kind: 'room_location',
        room_source: { entity: entities.presence, room_map: { upstairs: 'drawn-upper' } } }],
      floor_presentation: { mode: 'horizontal', panels: true, floors: ['ground', 'upper'], gap_m: 3 }, views: {} });
  }, entities); await ready(page);
  const state = await snapshot(page);
  check('the normal drawn-plan transition removes the old imported model/light while retaining the renderer and 12-light pool', !state.model
    && !state.authoredLight.present && state.authoredLight.oldModelDetached && state.authoredLight.initial?.uuid
    && !state.authoredLight.allocation.includes(state.authoredLight.initial.uuid) && state.identity.renderer
    && state.identity.pool && state.pool.length === 12, state.authoredLight);
}

async function disconnect(page) {
  const before = await snapshot(page);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.floorPanelBench.detached = c; c.remove(); }); await flush(page);
  const after = await snapshot(page);
  check('disconnect stops the existing RAF, releases pane DOM and keeps the saved floor policy', !after.raf && !after.active && after.headers.length === 0
    && after.panes.length === 0 && after.saved.panels === true && after.identity.renderer && after.identity.pool, after);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 450))); const later = await snapshot(page);
  check('a detached card renders zero additional frames or shadows', equal(after.stats, later.stats) && after.shadowRequests === later.shadowRequests
    && equal(before.rooms, later.rooms) && later.calls === 0, { before: after.stats, after: later.stats });
  await page.evaluate(() => document.querySelector('section.theme').append(window.floorPanelBench.detached)); await page.bringToFront(); await ready(page);
  check('reconnection uses the same scene and restores current separate-floor settings', (await snapshot(page)).report.panels === true
    && (await snapshot(page)).identity.contexts === 1 && (await snapshot(page)).identity.scene);
}

async function main() {
  const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
  for (const mode of modes) {
    let session; label = `${mode}: `;
    try {
      session = await open(mode);
      check('loads the requested source or built card with one real synthetic GLB', session.requests.includes(mode === 'source' ? '/src/taylors3d-card.js' : '/dist/taylors3d-card.js')
        && !session.requests.includes(mode === 'source' ? '/dist/taylors3d-card.js' : '/src/taylors3d-card.js'));
      await editorProof(session.page);
      for (const width of [1280, 320]) await matrix(session.page, mode, 'glb', width);
      await pageWide(session.page); await suspendAndRestore(session.page); await drawn(session.page);
      for (const width of [1280, 320]) await matrix(session.page, mode, 'drawn', width);
      await disconnect(session.page);
    } catch (error) { check('scenario completes', false, { message: error.message, stack: error.stack, context,
      actualErrors: error.actualErrors, openSnapshot: error.openSnapshot, resourceState: error.resourceState }); }
    finally {
      if (session) {
        errors.push(...session.errors);
        await session.page.evaluate(() => { const c = document.querySelector('taylors3d-card') || window.floorPanelBench?.detached;
          if (c?._view && window.floorPanelBench) { c._view.onRender = window.floorPanelBench.previousRender;
            c._view.renderer.render = window.floorPanelBench.previousRendererRender; } }).catch(() => {});
        await session.close();
      }
    }
  }
  label = ''; check('no browser errors or unexplained warnings', errors.length === 0, errors);
  console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`); if (checks.some((passed) => !passed)) process.exitCode = 1;
}
async function pageWide(page) { await page.setViewport({ width: 1280, height: 1080, deviceScaleFactor: 1, hasTouch: true }); await ready(page); }
await main();
