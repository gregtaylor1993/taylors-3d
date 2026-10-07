import { revealEditorTab } from './lib/editor-tab-navigation.mjs';
// Real Chrome controls and pointer gestures against both unbundled source and the release bundle.
// All robot observations are labelled fixtures; this never contacts HA or invents a route.
// Run only after the current source has been built. CHROME_PATH may be required.
// Optional: --source-only / --bundle-only and --plain-only / --model-only.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';

const failures = [], errors = [], shots = path.join(root, 'screenshots');
let scenario = '';
const check = (name, pass, detail) => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${scenario}: ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
  if (!pass) failures.push(`${scenario}: ${name}`);
};
const closeTo = (a, b, tolerance = 1e-6) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function cameraSettled(page) {
  await page.waitForFunction(async () => {
    const v = document.querySelector('taylors3d-card')?._view;
    if (!v || v._tween) return false;
    const sample = () => [...v.camera.position.toArray(), ...v.controls.target.toArray(), v.camera.zoom || 1, v.size.w, v.size.h];
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const a = sample(); await frame(); const b = sample(); await frame();
    const c = sample(); return !v._tween && a.every((value, i) => Number.isFinite(value) && Math.abs(value - b[i]) < 1e-5 && Math.abs(b[i] - c[i]) < 1e-5);
  }, { timeout: 10000, polling: 'raf' }).catch(async (error) => {
    const diagnostic = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), v = c?._view;
      return { floor: c?._floor, mode: c?._mode, tween: !!v?._tween, raf: v?._raf, size: v?.size, stats: v?.stats,
        target: v?.controls.target.toArray(), position: v?.camera.position.toArray(), hidden: document.hidden };
    });
    throw new Error(`${error.message}; camera ${JSON.stringify(diagnostic)}`, { cause: error });
  });
}
async function control(page, selector, action) {
  await revealEditorTab(page, selector);
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement();
    if (!element) throw new Error('Missing calibration control: ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await action(element);
  } finally { await handle.dispose(); }
  await frames(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const select = (page, field, value) => control(page, `[data-field="${field}"]`, (element) => element.select(value));
const type = (page, field, value, { index, blur = true } = {}) => control(page, `[data-field="${field}"]${index === undefined ? '' : `[data-index="${index}"]`}`, async (element) => {
  await element.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  if (value) await page.keyboard.type(value); else await page.keyboard.press('Backspace');
  if (blur) await page.keyboard.press('Tab');
});
async function patch(page, changes) {
  await page.evaluate((changes) => {
    const card = document.querySelector('taylors3d-card'); card.hass = { ...card._hass, states: { ...card._hass.states, ...changes } };
  }, changes);
  await frames(page);
}
async function position(page, raw, extra = {}) {
  await patch(page, { 'sensor.calibration_xy': { state: 'ready', last_updated: new Date().toISOString(),
    attributes: { friendly_name: 'Simulated robot map coordinates', location: { east: raw[0], north: raw[1] }, ...extra } } });
}
const snapshot = (page) => page.evaluate(() => {
  const card = document.querySelector('taylors3d-card'), editor = card._edit?._trackingEditor;
  return { draft: editor?.draft, pending: editor?.pendingPlanPick, saved: card._layout?.vacuum_bindings || [],
    // Inspect the cached preview without calling calibrationOverlay(), whose context
    // synchronization could otherwise mask a missing production invalidation hook.
    overlay: editor?.calibrationPreview, history: card._history.size, calls: window.calibrationFixture.services.length,
    commits: window.calibrationFixture.commits.length, floor: card._floor, mode: card._mode, drawing: card._stage.classList.contains('drawing'),
    selectedRoom: card._edit?.selectedRoom, record: card._trackingData?.records.find((record) => record.entity === 'vacuum.calibration_robot'),
    handles: [...card.shadowRoot.querySelectorAll('.fp-handle')].map((element) => ({ text: element.textContent, aria: element.getAttribute('aria-label') })) };
});
async function readableControls(page) {
  return page.evaluate(() => {
    const form = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-trk-editor]');
    const luminance = (colour) => {
      const channels = colour.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      return channels?.length === 3 ? channels.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0) : NaN;
    };
    return [...form.querySelectorAll('button,input,select')].filter((element) => element.getClientRects().length && !element.matches(':disabled') && element.type !== 'checkbox').map((element) => {
      const style = getComputedStyle(element), a = luminance(style.color), b = luminance(style.backgroundColor);
      return { field: element.dataset.field || element.dataset.act, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
}

async function open(mode) {
  const transport = await launch();
  try {
    const session = await newPage(transport.browser, { width: 1280, height: 1000 });
    const { page } = session, requests = [];
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8');
    // One renderer per fixture avoids sharing SwiftShader with an unused second GLB card.
    html = html.replace(/<section class="theme dark">[\s\S]*?<\/section>/, '');
    html = html.replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
    if (mode === 'source') {
      const importMap = JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } });
      html = html.replace('</head>', `<script type="importmap">${importMap}</script></head>`)
        .replace('src="../dist/taylors3d-card.js"', 'src="../src/taylors3d-card.js"');
    }
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
      else request.continue();
    });
    await page.goto(`${transport.base}/demo/index.html?view=top&floor=ground&height=700px`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('taylors3d-card')?.shadowRoot?.querySelector('.fp-marker'), { timeout: 15000 });
    check('fixture loads only its chosen card implementation', mode === 'source'
      ? requests.includes('/src/tracking-editor.js') && requests.includes('/src/tracking-calibration.js') && !requests.includes('/dist/taylors3d-card.js')
      : requests.includes('/dist/taylors3d-card.js') && !requests.some((url) => url.startsWith('/src/')));
    return { ...transport, ...session };
  } catch (error) { await transport.close(); throw error; }
}
async function prepare(page, mode, model = false) {
  await page.evaluate(async ({ mode }) => {
    window.__demoMowerPaused = true;
    const card = document.querySelector('taylors3d-card');
    card.setConfig({ ...card._config, layout_key: `calibration-${mode}`, height: '700px', view: 'top', floor: 'ground' });
    await card._layoutReady;
    window.calibrationFixture = { services: [], commits: [], pointerUps: [] };
    const now = new Date().toISOString();
    card.hass = { ...card._hass, callService: (...args) => { window.calibrationFixture.services.push(args); return Promise.resolve(); },
      states: { ...card._hass.states,
        'vacuum.calibration_robot': { state: 'cleaning', last_updated: now, attributes: { friendly_name: 'Simulated calibration robot' } },
        'sensor.calibration_xy': { state: 'ready', last_updated: now, attributes: { friendly_name: 'Simulated robot map coordinates', location: { east: 10, north: 20 } } },
        'sensor.calibration_replacement': { state: 'ready', last_updated: now, attributes: { friendly_name: 'Deliberate replacement source', location: { east: 10, north: 20 } } } } };
    card._commit({ ...card._layout, mower: {}, presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [] });
    card.resetHistory();
    const commit = card.commitFeatureLayout.bind(card);
    card.commitFeatureLayout = (patch) => { window.calibrationFixture.commits.push(JSON.parse(JSON.stringify(patch))); return commit(patch); };
    const canvas = card._view.renderer.domElement;
    canvas.addEventListener('pointerup', (event) => {
      const pick = card._edit?._trackingEditor.pendingPlanPick;
      if (pick) window.calibrationFixture.pointerUps.push({ x: event.clientX, y: event.clientY, button: event.button,
        plan: card._view.planPoint(event.clientX, event.clientY, card._view.floorElevation(pick.floorId)), token: pick.token });
    }, true);
  }, { mode });
  await frames(page);
  if (model) {
    await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); window.calibrationModelFrames = card._view.stats.frames;
      card.setConfig({ ...card._config, model: '/demo/house.glb', model_opacity: .95 }); });
    await page.waitForFunction(() => {
      const view = document.querySelector('taylors3d-card')._view;
      return !!view.model && view.stats.frames > window.calibrationModelFrames && view.renderer.info.render.calls > 0 && view.renderer.info.render.triangles > 0;
    }, { timeout: 30000 });
  }
  await cameraSettled(page);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="tracking"]');
  await click(page, '[data-act="trk-section"][data-section="vacuums"]');
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._edit?._trackingEditor?.calibrationOverlay instanceof Function);
}
async function newXY(page, floorId = 'ground') {
  await click(page, '[data-act="trk-add"]'); await select(page, 'trk-kind', 'xy'); await select(page, 'trk-entity', 'vacuum.calibration_robot');
  await select(page, 'trk-location-mode', 'position'); await type(page, 'trk-x', '1'); await type(page, 'trk-y', '1'); await type(page, 'trk-z', '.05'); await select(page, 'trk-floor', floorId);
  await select(page, 'trk-cal-entity', 'sensor.calibration_xy'); await type(page, 'trk-cal-x_attr', 'location.east'); await type(page, 'trk-cal-y_attr', 'location.north');
  await select(page, 'trk-cal-floorId', floorId); await select(page, 'trk-cal-units', 'raw'); await select(page, 'trk-cal-frame', 'calibrated');
  await type(page, 'trk-label', 'My calibrated robot');
}
async function canvasPoint(page, variant = 0) {
  await cameraSettled(page);
  const point = await page.evaluate((variant) => {
    const card = document.querySelector('taylors3d-card'), view = card._view, canvas = view.renderer.domElement;
    const floorId = card._edit._trackingEditor.pendingPlanPick?.floorId || card._floor, rect = canvas.getBoundingClientRect();
    const rooms = card._roomList.filter((entry) => entry.floorId === floorId && entry.room.polygon?.length >= 3);
    const candidates = rooms.map((entry) => {
      const polygon = entry.room.polygon, x = polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length;
      const y = polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length;
      return [x + .123456 + variant * .617, y + .234567 - variant * .337];
    });
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) candidates.push([1.123456 + x * 1.217 + variant * .217, 1.234567 + y * 1.337]);
    for (const plan of candidates) {
      const pixel = view.screenPoint(...plan, 0, floorId);
      if (pixel[0] <= rect.left + 35 || pixel[0] >= rect.right - 100 || pixel[1] <= rect.top + 35 || pixel[1] >= rect.bottom - 35) continue;
      const hit = card.shadowRoot.elementFromPoint(...pixel);
      if (hit !== canvas) continue;
      const actual = view.planPoint(...pixel, view.floorElevation(floorId));
      if (actual?.length === 2 && actual.every(Number.isFinite)) return { pixel, plan: actual, floorId };
    }
    return null;
  }, variant);
  if (!point) throw new Error('No exposed plan canvas point on the captured floor.');
  return point;
}
async function captureOnCanvas(page, raw, variant) {
  await position(page, raw); await click(page, '[data-act="trk-cal-capture"]');
  const before = await snapshot(page), point = await canvasPoint(page, variant);
  await position(page, [raw[0] + 999, raw[1] + 888]); // later evidence must not replace the frozen capture
  await cameraSettled(page); await page.mouse.click(...point.pixel); await frames(page);
  const after = await snapshot(page), observed = await page.evaluate(() => window.calibrationFixture.pointerUps.at(-1));
  const pair = after.draft?.position_source?.calibration?.at(-1);
  check('canvas click accepts the frozen raw reading and exact unsnapped plan point', closeTo(pair?.src, raw)
    && closeTo(pair?.plan, observed?.plan) && observed?.token === before.pending?.token
    && pair.plan.some((value) => Math.abs(value / .05 - Math.round(value / .05)) > 1e-3) && !after.pending && after.calls === 0,
  { pair, observed, captured: before.pending?.raw });
  return pair;
}

async function mainScenario(page, mode) {
  await newXY(page); let state = await snapshot(page);
  check('visual source/attribute/unit/floor choices stay draft-only', state.draft?.position_source?.entity === 'sensor.calibration_xy'
    && state.draft.position_source.x_attr === 'location.east' && state.draft.position_source.y_attr === 'location.north'
    && state.draft.position_source.floorId === 'ground' && state.draft.position_source.units === undefined && state.draft.position_source.plan_meters === false
    && state.saved.length === 0 && state.commits === 0 && state.calls === 0);
  await captureOnCanvas(page, [10, 20], 0); await captureOnCanvas(page, [110, 20], 1); state = await snapshot(page);
  const savedPairs = state.draft.position_source.calibration;
  check('two numbered draft points render without selecting or changing a room', state.handles.filter((handle) => handle.aria?.startsWith('Draft calibration point')).length === 2 && !state.selectedRoom && state.commits === 0);
  const layering = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), view = card._view, pairs = card._edit._trackingEditor.draft.position_source.calibration;
    const markers = [...card.shadowRoot.querySelectorAll('.fp-marker,.taylors3d-tracked-label')].filter((element) => element.getClientRects().length && getComputedStyle(element).display !== 'none');
    return view.cssObjects.filter(({ kind, obj }) => kind === 'handle' && obj.element.classList.contains('calibration')).map(({ obj }) => {
      const element = obj.element, rect = element.getBoundingClientRect(), index = Number(element.textContent) - 1;
      const overlapping = markers.filter((marker) => {
        const other = marker.getBoundingClientRect();
        return rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top;
      });
      return { label: element.textContent, index, plan: [obj.position.x, -obj.position.z], expected: pairs[index]?.plan,
        zIndex: Number(getComputedStyle(element).zIndex), noninteractive: getComputedStyle(element).pointerEvents === 'none',
        overlapping: overlapping.map((marker) => ({ label: marker.getAttribute('aria-label') || marker.title || marker.textContent.trim(), zIndex: Number(getComputedStyle(marker).zIndex) })) };
    });
  });
  check('overlapping numbered calibration handles stay above device labels without moving or taking input', layering.length === 2
    && layering.some((handle) => handle.overlapping.length > 0) && layering.every((handle) => handle.noninteractive && closeTo(handle.plan, handle.expected)
      && Number.isFinite(handle.zIndex) && handle.overlapping.every((marker) => Number.isFinite(marker.zIndex) && handle.zIndex > marker.zIndex)), layering);
  const lightControls = await readableControls(page);
  check('enabled light-theme calibration controls have readable normal-text contrast', lightControls.length > 10 && lightControls.every((control) => control.ratio >= 4.5), lightControls.filter((control) => !(control.ratio >= 4.5)));
  await page.screenshot({ path: path.join(shots, `calibration-${mode}-pairs.png`) });
  await type(page, 'trk-cal-plan-x', '', { index: 0 }); await click(page, '[data-act="trk-save"]'); state = await snapshot(page);
  check('a blank plan edit blocks Save and keeps that blank field visible', state.commits === 0 && state.saved.length === 0 && await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'); return card.shadowRoot.querySelector('[data-field="trk-cal-plan-x"][data-index="0"]').value === ''
      && card._edit.panel.textContent.includes('Complete the edited plan coordinates');
  }));
  await type(page, 'trk-cal-plan-x', String(savedPairs[0].plan[0]), { index: 0 });
  await type(page, 'trk-label', 'My calibrated robot', { blur: false });
  await page.evaluate(() => { window.calibrationFocused = document.querySelector('taylors3d-card').shadowRoot.activeElement; });
  await patch(page, { 'sensor.calibration_unrelated': { state: '42', attributes: {} } });
  check('unrelated HA updates retain the exact focused input and typed label', await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'); return card.shadowRoot.activeElement === window.calibrationFocused && window.calibrationFocused.value === 'My calibrated robot';
  }));
  await click(page, '[data-act="trk-save"]'); state = await snapshot(page);
  check('Save commits once with one Undo step and zero vacuum services', state.commits === 1 && state.history === 1 && state.saved.length === 1 && state.calls === 0
    && JSON.stringify(state.saved[0].position_source.calibration) === JSON.stringify(savedPairs), state.saved[0]);
  await click(page, '[data-act="history-undo"]'); state = await snapshot(page);
  check('Undo removes only the saved calibration binding', state.saved.length === 0 && state.calls === 0);
  await click(page, '[data-act="history-redo"]'); state = await snapshot(page);
  check('Redo restores the exact coordinate source and pairs', state.saved.length === 1 && JSON.stringify(state.saved[0].position_source.calibration) === JSON.stringify(savedPairs));
  await click(page, '[data-act="trk-edit"][data-index="0"]'); await click(page, '[data-act="trk-cal-capture"]');
  const pending = (await snapshot(page)).pending, point = await canvasPoint(page, 2);
  await page.mouse.move(...point.pixel); await page.mouse.down(); await page.mouse.move(point.pixel[0] + 60, point.pixel[1] + 35, { steps: 8 }); await page.mouse.up(); await frames(page);
  state = await snapshot(page);
  check('a real drag never becomes a calibration click', state.pending?.token === pending.token && state.draft.position_source.calibration.length === 2 && state.commits === 1);
  await page.keyboard.press('Escape'); await frames(page); state = await snapshot(page);
  check('Escape clears pending capture, cursor and drawing state', !state.pending && !state.drawing && state.draft.position_source.calibration.length === 2);
  await type(page, 'trk-cal-plan-y', '9.98765', { index: 0 }); await click(page, '[data-act="trk-cancel"]'); state = await snapshot(page);
  check('Cancel restores the exact saved pairs without another commit', !state.draft && state.commits === 1 && JSON.stringify(state.saved[0].position_source.calibration) === JSON.stringify(savedPairs));
  await click(page, '[data-act="trk-edit"][data-index="0"]'); await click(page, '[data-act="trk-cal-capture"]');
  await click(page, '.chip[data-view="first"]'); state = await snapshot(page);
  check('changing the displayed floor immediately clears the stale capture and cursor', !state.pending && !state.drawing && state.floor === 'first'
    && JSON.stringify(state.draft.position_source.calibration) === JSON.stringify(savedPairs),
  { floor: state.floor, pending: state.pending?.token, drawing: state.drawing, pairs: state.draft.position_source.calibration.length });
  // Independently exercise the real canvas boundary: the new floor must never
  // accept a plan point for the captured source's old floor or select a room.
  const staleFloorPoint = await canvasPoint(page, 3);
  await page.mouse.click(...staleFloorPoint.pixel); await frames(page); state = await snapshot(page);
  check('changing the displayed floor rejects a real pending source-floor canvas click', !state.pending && state.floor === 'first'
    && JSON.stringify(state.draft.position_source.calibration) === JSON.stringify(savedPairs) && state.commits === 1,
  { floor: state.floor, pending: state.pending?.token, pairs: state.draft.position_source.calibration.length, commits: state.commits });
  await click(page, '[data-act="trk-cancel"]'); await click(page, '[data-act="trk-edit"][data-index="0"]');
  await click(page, '[data-act="trk-cal-capture"]'); await click(page, '[data-act="trk-edit"][data-index="0"]'); state = await snapshot(page);
  check('replacing a binding draft clears its prior pending token', !state.pending && state.commits === 1 && state.draft.position_source.calibration.length === 2);
  await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), states = { ...card._hass.states }; delete states['sensor.calibration_xy']; card.hass = { ...card._hass, states };
  }); await frames(page); state = await snapshot(page);
  check('missing selected source is retained as a disabled exact-ID warning', state.draft.position_source.entity === 'sensor.calibration_xy'
    && await page.evaluate(() => { const root = document.querySelector('taylors3d-card').shadowRoot;
      return root.querySelector('[data-trk-cal-fieldset]').disabled && root.querySelector('[data-field="trk-cal-entity"]').value === 'sensor.calibration_xy'
        && root.querySelector('[data-field="trk-cal-entity"]').matches(':disabled')
        && root.querySelector('[data-trk-preview]').textContent.includes('Position source sensor.calibration_xy is missing'); }));
  await click(page, '[data-act="trk-relink"]'); await select(page, 'trk-cal-entity', 'sensor.calibration_replacement'); state = await snapshot(page);
  check('deliberate relink preserves pairs and requests actual same-frame confirmation', state.draft.position_source.calibration.length === 2 && await page.evaluate(() => document.querySelector('taylors3d-card')._edit.panel.textContent.includes('The source frame changed')));
  await click(page, '[data-act="trk-cal-confirm"]'); await click(page, '[data-act="trk-cancel"]');
  await position(page, [10, 20]); await click(page, '[data-act="trk-edit"][data-index="0"]');
  await page.evaluate(() => document.querySelector('section.theme').classList.replace('light', 'dark'));
  await page.setViewport({ width: 320, height: 1000, deviceScaleFactor: 1 }); await frames(page);
  const narrow = await page.evaluate(() => {
    const form = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-trk-editor]');
    return { overflow: document.documentElement.scrollWidth > innerWidth, targets: [...form.querySelectorAll('input,select,button')]
      .filter((element) => element.getClientRects().length).every((element) => element.getBoundingClientRect().height >= 44) };
  });
  check('the narrow dark calibration form fits with 44px touch controls', !narrow.overflow && narrow.targets, narrow);
  const darkControls = await readableControls(page);
  check('enabled dark-theme calibration controls have readable normal-text contrast', darkControls.length > 10 && darkControls.every((control) => control.ratio >= 4.5), darkControls.filter((control) => !(control.ratio >= 4.5)));
  await page.screenshot({ path: path.join(shots, `calibration-${mode}-dark-narrow.png`), fullPage: true });
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 }); await page.evaluate(() => document.querySelector('section.theme').classList.replace('dark', 'light'));
  await frames(page); await click(page, '[data-act="trk-cancel"]');
}

async function freshnessScenario(page, mode) {
  await click(page, '[data-act="trk-edit"][data-index="0"]');
  for (const [target, age] of [['status', 3], ['position', 8]]) {
    await select(page, `trk-freshness-${target}-mode`, 'timestamp'); await select(page, `trk-freshness-${target}-timestamp-mode`, 'last_updated');
    await type(page, `trk-freshness-${target}-age`, String(age));
  }
  const observedAt = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), time = new Date().toISOString(), states = { ...card._hass.states };
    for (const entity of ['vacuum.calibration_robot', 'sensor.calibration_xy']) states[entity] = { ...states[entity], last_updated: time };
    card.hass = { ...card._hass, states }; return Date.parse(time);
  }); await frames(page); await click(page, '[data-act="trk-save"]'); let state = await snapshot(page);
  check('visual freshness controls save separate real timestamp age rules', state.saved[0]?.freshness?.max_age_seconds === 3
    && state.saved[0].position_source.freshness?.max_age_seconds === 8 && state.record?.active && state.record.measured && state.commits === 2 && state.calls === 0);
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._trackingData?.records.find((record) => record.entity === 'vacuum.calibration_robot')?.status === 'stale', { timeout: 5000 }); state = await snapshot(page);
  check('status expires without HA updates while independent measured location remains valid', state.record?.status === 'stale' && !state.record.active && state.record.measured && Date.now() >= observedAt + 3000, state.record?.label);
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._trackingData?.records.find((record) => record.entity === 'vacuum.calibration_robot')?.positionStatus === 'stale', { timeout: 6500 }); state = await snapshot(page);
  check('the position expires at its own source deadline and shows the explicit fallback', !state.record.measured && state.record.location?.x === 1 && state.record.location?.y === 1 && state.record.label.includes('status at chosen anchor; position stale') && state.calls === 0);
  await click(page, '[data-act="trk-edit"][data-index="0"]'); await type(page, 'trk-freshness-status-age', '0'); await click(page, '[data-act="trk-save"]'); state = await snapshot(page);
  check('a malformed explicit age cannot overwrite a saved valid rule', state.commits === 2 && state.saved[0].freshness.max_age_seconds === 3 && await page.evaluate(() => document.querySelector('taylors3d-card')._edit.panel.textContent.includes('positive finite number of seconds')));
  await page.screenshot({ path: path.join(shots, `calibration-${mode}-freshness.png`) });
  await click(page, '[data-act="trk-cancel"]'); await click(page, '[data-act="history-undo"]'); state = await snapshot(page);
  check('Undo removes only the freshness change and keeps calibrated coordinates', state.saved.length === 1 && state.saved[0].freshness === undefined && state.saved[0].position_source.freshness === undefined && state.saved[0].position_source.calibration.length === 2);
  await click(page, '[data-act="history-redo"]'); state = await snapshot(page);
  check('Redo restores both independent rules without issuing a device service', state.saved[0].freshness.max_age_seconds === 3 && state.saved[0].position_source.freshness.max_age_seconds === 8 && state.calls === 0);
}

async function modelScenario(page, mode) {
  await newXY(page, 'first'); await captureOnCanvas(page, [10, 20], 0); await captureOnCanvas(page, [110, 20], 1);
  let state = await snapshot(page);
  check('model calibration uses the explicitly selected upper floor and its real elevation', state.floor === 'first' && state.mode === 'top' && state.overlay?.floorId === 'first'
    && await page.evaluate(() => document.querySelector('taylors3d-card')._view.floorElevation('first') > 0));
  await click(page, '[data-act="trk-cal-capture"]'); const oldToken = (await snapshot(page)).pending.token;
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card.setConfig({ ...card._config, model_rotation: .05 }); });
  await cameraSettled(page); state = await snapshot(page);
  check('changing actual model alignment cancels the old capture before another canvas tap', !state.pending && state.draft.position_source.calibration.length === 2 && state.commits === 0, oldToken);
  await click(page, '[data-act="trk-cal-capture"]');
  await page.evaluate((mode) => {
    const card = document.querySelector('taylors3d-card'); window.calibrationOldModel = card._view.model;
    card.setConfig({ ...card._config, model: `/demo/house.glb?calibration-replacement=${mode}` });
  }, mode);
  await page.waitForFunction(() => { const card = document.querySelector('taylors3d-card'); return !!card._view.model && card._view.model !== window.calibrationOldModel; }, { timeout: 30000 });
  await cameraSettled(page); state = await snapshot(page);
  check('actual GLB replacement rejects captured points from the old model', !state.pending && state.commits === 0 && state.calls === 0);
  await page.screenshot({ path: path.join(shots, `calibration-${mode}-model.png`) });
  if (state.draft) await click(page, '[data-act="trk-cancel"]'); state = await snapshot(page);
  check('Cancel leaves no calibration binding after model context changes', !state.draft && state.saved.length === 0 && state.commits === 0 && state.calls === 0);
}

fs.mkdirSync(shots, { recursive: true });
const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
const fixtures = process.argv.includes('--plain-only') ? ['plain'] : process.argv.includes('--model-only') ? ['model'] : ['plain', 'model'];
for (const mode of modes) for (const fixture of fixtures) {
  scenario = `${mode}/${fixture}`; let session;
  try {
    session = await open(mode); await prepare(session.page, mode, fixture === 'model');
    if (fixture === 'plain') { await mainScenario(session.page, mode); await freshnessScenario(session.page, mode); }
    else await modelScenario(session.page, mode);
  } catch (error) { check('browser scenario completes', false, error.message); }
  finally {
    if (session) {
      errors.push(...session.errors.map((error) => `${scenario}: ${error}`));
      await session.page.evaluate(() => { window.__demoMowerPaused = true; document.querySelectorAll('taylors3d-card').forEach((card) => card.remove()); }).catch(() => {});
      await session.close();
    }
  }
}
scenario = 'all fixtures'; check('no browser errors', errors.length === 0, errors);
if (failures.length) process.exitCode = 1;
