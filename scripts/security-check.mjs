// Real Security form + a deliberately authored rigid-door GLB fixture. Binary
// contacts and angles are explicit; viewing/editing never calls a device service.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';

const checks = [], browserErrors = [];
const check = (name, pass, detail) => {
  checks.push(!!pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
};
const near = (a, b, epsilon = 1e-5) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= epsilon);
const changed = (a, b) => !near(a, b);

function fixtureGlb() {
  const source = fs.readFileSync(path.join(root, 'demo/house.glb')), length = source.readUInt32LE(12);
  const json = JSON.parse(source.toString('utf8', 20, 20 + length)), nodes = json.nodes;
  const append = (node) => { nodes.push(node); return nodes.length - 1; };
  const boxMesh = nodes.find((node) => node.name === 'coffee_table_body').mesh;
  const lamp = nodes.find((node) => node.name === 'lamp_living');
  const lampBody = nodes.find((node) => node.name === 'lamp_living_body').mesh;
  const lampGlow = nodes[lamp.children.find((index) => nodes[index].name === 'glow')].mesh;
  // The existing 1.2 × .45 × .7 m box becomes a 1.2 × 2 × .07 m leaf.
  // Its parent-local pivot is authored at [0,0,0], never inferred from a name.
  const panel = append({ name: 'panel', mesh: boxMesh, scale: [1, 2 / .45, .1] });
  const lightBody = append({ name: 'body', mesh: lampBody });
  const glow = append({ name: 'glow', mesh: lampGlow, translation: [0, -.06, 0] });
  const mounted = append({ name: 'security_mounted', translation: [-.25, .65, .15], children: [lightBody, glow],
    extras: { fp: { kind: 'object', id: 'security_mounted', type: 'light', label: 'Door-mounted test light', glow: 'glow',
      hints: { beam: 'point', max: 40, distance: 6, decay: 2 }, suggest: { entity: 'light.security_mounted' } } } });
  const leaf = append({ name: 'leaf', translation: [.6, 1, 0], children: [panel, mounted] });
  const door = append({ name: 'security_door', translation: [3.2, 0, -1.8], children: [leaf],
    extras: { fp: { kind: 'object', id: 'security_door', type: 'door', label: 'Explicit test door' } } });
  nodes.find((node) => node.extras?.fp?.id === 'living_room').children.push(door);
  const pane = nodes.find((node) => node.name === 'window_pane_living');
  const window = append({ name: 'security_window', mesh: pane.mesh, translation: [4.4, 1.4, -1.2],
    extras: { fp: { kind: 'object', id: 'security_window', type: 'window', label: 'Explicit test window', layer: 'glass' } } });
  nodes.find((node) => node.extras?.fp?.id === 'level0').children.push(window);
  const body = Buffer.from(JSON.stringify(json)), padding = Buffer.alloc((4 - body.length % 4) % 4, 0x20);
  const rest = source.subarray(20 + length), head = Buffer.alloc(20);
  head.write('glTF'); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + body.length + padding.length + rest.length, 8);
  head.writeUInt32LE(body.length + padding.length, 12); head.write('JSON', 16);
  return Buffer.concat([head, body, padding, rest]);
}

let session;
async function settle(page) { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function control(page, selector, action) {
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw new Error('Missing Security control: ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await action(element);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const select = (page, field, value) => control(page, `[data-field="sec-${field}"]`, (element) => element.select(value));
async function type(page, field, value) {
  await control(page, `[data-field="sec-${field}"]`, async (element) => {
    await element.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.type(value);
  });
}
async function contact(page, value, extra = {}) {
  await page.evaluate(({ value, extra }) => {
    const c = document.querySelector('taylors3d-card');
    c.hass = { ...c._hass, states: { ...c._hass.states,
      'binary_sensor.security_door': { state: value, last_updated: new Date().toISOString(),
        attributes: { friendly_name: 'Simulated door contact', device_class: 'door', ...extra } } } };
  }, { value, extra });
  await settle(page);
}
async function still(page) {
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._securityLayer?.moving, { timeout: 6500 });
  await settle(page);
}
async function idle(page) {
  await page.waitForFunction(() => {
    const v = document.querySelector('taylors3d-card')._view, now = performance.now();
    if (v.dirty || v._tween || v._modelMotionMoving || v._occFull || v._occTimer || now - (v._camMovedAt || 0) < 350) { window.securityIdle = null; return false; }
    if (!window.securityIdle || window.securityIdle.frames !== v.stats.frames || window.securityIdle.shadow !== v.stats.shadow) {
      window.securityIdle = { ...v.stats, at: now }; return false;
    } return now - window.securityIdle.at > 350;
  }, { timeout: 12000 });
}
async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, layer = c._securityLayer, objects = c._objects;
    const part = layer.parts.get('security_1'), object = objects.parts.get('security_mounted'), slot = objects._slots.get('security_mounted');
    const leaf = v.model.manifest.objects.find((obj) => obj.id === 'security_door')?.node.children.find((node) => (node.userData.name || node.name) === 'leaf');
    return { bindings: c._layout.security_bindings, commits: window.securityFixture.commits.length, services: window.securityFixture.services.length,
      status: part?.reading.status, open: part?.reading.open, color: part?.color, shown: part?.shown, moving: layer.moving,
      degrees: part?.degrees, leaf: leaf?.position.toArray(), rotation: leaf?.quaternion.toArray(), authored: window.securityFixture.authored,
      lines: part?.lines.length, visibleLines: part?.lines.filter((line) => line.visible).length, planes: part?.material.clippingPlanes?.length,
      diagnostics: layer.diagnostics, anchor: objects.anchorOf('security_mounted')?.toArray(), light: slot?.light.position.toArray(),
      slot: slot?.light.uuid, mounted: object?.obj.node.uuid,
      attached: c._positions.get('entity:sensor.security_attached'),
      marker: v.markerObjects.get('entity:sensor.security_attached')?.obj.position.toArray(),
      stats: { ...v.stats }, objectStats: { ...objects.stats }, memory: { ...v.renderer.info.memory },
      programs: v.renderer.info.programs.length, lights: [...objects.pool.points, ...objects.pool.spots].map((light) => light.uuid),
      revision: v._modelMotionRevision, deadline: c._trackingDeadline, timer: !!c._trackingTimer, model: v.model.id };
  });
}

try {
  const transport = await launch(); session = transport;
  const context = await newPage(transport.browser, { width: 1280, height: 1000 }); session = { ...transport, ...context };
  const { page } = session, fixture = fixtureGlb();
  let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8');
  html = html.replace(/<section class="theme dark">[\s\S]*?<\/section>/, '').replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
    else if (url.pathname === '/demo/security-fixture.glb') request.respond({ status: 200, contentType: 'model/gltf-binary', body: fixture });
    else request.continue();
  });
  await page.goto(`${transport.base}/demo/index.html?model=/demo/security-fixture.glb&view=3d&floor=ground&height=700px`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')?._view?.model?.manifest?.objects.some((obj) => obj.id === 'security_door'), { timeout: 30000 });
  await page.evaluate(async () => {
    window.__demoMowerPaused = true;
    const c = document.querySelector('taylors3d-card');
    c.setConfig({ ...c._config, layout_key: 'security-browser-fixture', height: '700px', view: '3d', control_panel: 'right' });
    await c._layoutReady;
    window.securityFixture = { services: [], commits: [] };
    const now = new Date().toISOString();
    c.hass = { ...c._hass, callService: (...args) => { window.securityFixture.services.push(args); return Promise.resolve(); },
      states: { ...c._hass.states,
        'binary_sensor.security_door': { state: 'off', last_updated: now, attributes: { friendly_name: 'Simulated door contact', device_class: 'door' } },
        'binary_sensor.security_window': { state: 'on', last_updated: now, attributes: { friendly_name: 'Simulated window contact', device_class: 'window' } },
        'light.security_mounted': { state: 'on', attributes: { friendly_name: 'Door-mounted test light', brightness: 255 } },
        'sensor.security_attached': { state: '21', attributes: { friendly_name: 'Door-mounted test reading', device_class: 'temperature', unit_of_measurement: '°C' } } } };
    c._commit({ ...c._layout, mower: {}, presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [], security_bindings: [],
      objects: { ...c._layout.objects, security_mounted: { entity: 'light.security_mounted' } },
      pins: { ...c._layout.pins, 'entity:sensor.security_attached': { x: 3.2, y: 1.8, z: 1, floor_id: 'ground', attach: 'security_mounted', offset: [0, 0, 0] } } });
    c.resetHistory();
    const commit = c.commitFeatureLayout.bind(c);
    c.commitFeatureLayout = (patch) => { window.securityFixture.commits.push(JSON.parse(JSON.stringify(patch))); return commit(patch); };
    c._view.stopCameraMotion();
    const door = c._view.model.manifest.objects.find((obj) => obj.id === 'security_door').node;
    const leaf = door.children.find((node) => (node.userData.name || node.name) === 'leaf');
    window.securityFixture.authored = { position: leaf.position.toArray(), quaternion: leaf.quaternion.toArray(), scale: leaf.scale.toArray(), matrix: leaf.matrix.toArray() };
    window.securityFixture.leaf = leaf;
    window.securityFixture.materials = [];
    leaf.traverse((node) => { if (node.isMesh) window.securityFixture.materials.push({ node, material: node.material, geometry: node.geometry }); });
  });
  await settle(page);
  let s = await snapshot(page);
  check('fixture uses one real GLB renderer and starts with Security opt-in', s.bindings.length === 0 && !s.lines && s.services === 0 && s.anchor && s.attached?.attached === 'security_mounted', s);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="security"]'); await click(page, '[data-act="sec-add"]');
  const blank = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), value = (name) => c.shadowRoot.querySelector(`[data-field="sec-${name}"]`).value;
    return ['entity', 'object', 'open-states', 'closed-states'].every((name) => value(name) === '') && c._layout.security_bindings.length === 0;
  });
  check('new Security draft chooses no contact, object, opening states or hinge', blank);
  await select(page, 'entity', 'binary_sensor.security_door'); await select(page, 'object', 'security_door');
  await click(page, '[data-act="sec-contact-preset"]'); await click(page, '[data-field="sec-motion"]');
  const hingeBlank = await page.evaluate(() => ['target', 'pivot-0', 'axis-1', 'closed-degrees', 'open-degrees', 'duration']
    .every((name) => document.querySelector('taylors3d-card').shadowRoot.querySelector(`[data-field="sec-${name}"]`).value === ''));
  check('enabling door motion requires explicitly supplied parent-local hinge settings', hingeBlank);
  await select(page, 'target', 'leaf');
  for (const [field, value] of [['pivot-0', '0'], ['pivot-1', '0'], ['pivot-2', '0'], ['axis-0', '0'], ['axis-1', '1'], ['axis-2', '0'],
    ['closed-degrees', '0'], ['open-degrees', '90'], ['duration', '400'], ['label', 'Explicit front door']]) await type(page, field, value);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.securityDraftInput = c.shadowRoot.activeElement; window.securityDraftSelection = [window.securityDraftInput.selectionStart, window.securityDraftInput.selectionEnd]; });
  await contact(page, 'on');
  const draft = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), el = c.shadowRoot.activeElement, leaf = window.securityFixture.leaf;
    return { same: el === window.securityDraftInput, value: el?.value, selection: [el?.selectionStart, el?.selectionEnd],
      previous: window.securityDraftSelection, bindings: c._layout.security_bindings.length, neutral: leaf.quaternion.toArray(), authored: window.securityFixture.authored.quaternion };
  });
  check('live HA updates retain exact focused native draft input and do not move the unsaved door', draft.same && draft.value === 'Explicit front door'
    && near(draft.selection, draft.previous, 0) && draft.bindings === 0 && near(draft.neutral, draft.authored), draft);
  await click(page, '[data-act="sec-save"]'); s = await snapshot(page);
  check('real Save makes one explicit undoable security binding without a device service', s.commits === 1 && s.bindings[0]?.object_id === 'security_door'
    && s.bindings[0]?.motion.target === 'leaf' && s.bindings[0]?.motion.open_degrees === 90 && s.services === 0, s.bindings);
  await click(page, '[data-act="history-undo"]'); s = await snapshot(page);
  check('Undo removes the binding and its owned helpers and restores authored leaf pose', s.bindings.length === 0 && !s.lines && near(s.rotation, s.authored.quaternion));
  await click(page, '[data-act="history-redo"]'); s = await snapshot(page);
  check('Redo restores the exact contact and supplied hinge once', s.bindings.length === 1 && s.bindings[0].entity === 'binary_sensor.security_door' && s.commits === 1);
  await click(page, '[data-act="sec-edit"][data-index="0"]'); await type(page, 'label', 'Never save this'); await click(page, '[data-act="sec-cancel"]');
  s = await snapshot(page); check('Cancel preserves the saved label and makes no extra layout change', s.bindings[0].label === 'Explicit front door' && s.commits === 1);
  await click(page, '[data-act="sec-edit"][data-index="0"]'); await type(page, 'label', 'Discard on tab change');
  await click(page, '[data-act="tab"][data-id="devices"]'); await click(page, '[data-act="tab"][data-id="security"]');
  const abandoned = await page.evaluate(() => document.querySelector('taylors3d-card')._edit._securityEditor.draft === null);
  check('leaving Security discards its unsaved draft', abandoned && (await snapshot(page)).bindings[0].label === 'Explicit front door');
  await click(page, '[data-act="sec-add"]'); await select(page, 'kind', 'window');
  await select(page, 'entity', 'binary_sensor.security_window'); await select(page, 'object', 'security_window');
  await click(page, '[data-act="sec-contact-preset"]'); await type(page, 'label', 'Explicit test window');
  await click(page, '[data-field="sec-show-closed"]'); await click(page, '[data-act="sec-save"]'); s = await snapshot(page);
  check('window highlighting saves its explicit separate contact/object and no motion settings', s.bindings.length === 2
    && s.bindings[1].kind === 'window' && s.bindings[1].object_id === 'security_window' && s.bindings[1].motion === undefined
    && s.bindings[1].highlight.closed === '#66bb6a' && s.commits === 2 && s.services === 0, s.bindings[1]);
  await page.setViewport({ width: 320, height: 1000, deviceScaleFactor: 1 }); await settle(page); await click(page, '[data-act="sec-edit"][data-index="0"]');
  const narrow = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), form = c.shadowRoot.querySelector('[data-security-editor]');
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      targets: [...form.querySelectorAll('button,input,select')].filter((el) => el.getClientRects().length).every((el) => el.getBoundingClientRect().height >= 44),
      hinge: !!form.querySelector('[data-field="sec-target"]'), tabs: [...c._edit.panel.querySelectorAll('.tabs button')].every((el) => {
        const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(); return r.height >= 44 && r.left >= p.left - 1 && r.right <= p.right + 1;
      }) };
  });
  check('320px Security form preserves all explicit controls with 44px targets and fitting tabs', !narrow.overflow && narrow.targets && narrow.hinge && narrow.tabs, narrow);
  // The panel scrolls independently: show the actual hinge fields in this proof.
  await control(page, '[data-field="sec-target"]', async () => {});
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots/security-editor-narrow.png'), fullPage: true });
  await click(page, '[data-act="sec-cancel"]'); await click(page, 'button.edit');
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 }); await settle(page); await still(page);
  s = await snapshot(page);
  check('saved open contact outlines and rotates the exact actual leaf', s.status === 'open' && s.open === true && s.color === '#ef5350' && s.visibleLines > 0 && Math.abs(s.degrees - 90) < 1e-5, s);
  const authoredIntegrity = await page.evaluate(() => window.securityFixture.materials.every(({ node, material, geometry }) => node.material === material && node.geometry === geometry));
  check('owned outlines preserve every original material and source geometry identity', authoredIntegrity);
  const opened = s;
  await contact(page, 'off'); await still(page); const closed = await snapshot(page);
  check('closing refreshes mounted object/light/attached marker with the same pooled light identities', changed(opened.anchor, closed.anchor) && near(closed.anchor, closed.light)
    && changed(opened.marker, closed.marker) && opened.slot === closed.slot && near(closed.rotation, closed.authored.quaternion)
    && JSON.stringify(opened.lights) === JSON.stringify(closed.lights) && closed.stats.shadow > opened.stats.shadow, { opened: opened.anchor, closed: closed.anchor, light: closed.light, marker: closed.marker });
  const windowPaint = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'), before = c._view._modelMotionRevision, part = c._securityLayer.parts.get('security_2');
    const open = { color: part.color, shown: part.lines.some((line) => line.visible), status: part.reading.status };
    c.hass = { ...c._hass, states: { ...c._hass.states, 'binary_sensor.security_window': { state: 'off', attributes: { device_class: 'window' } } } };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { open, closed: { color: part.color, shown: part.lines.some((line) => line.visible), status: part.reading.status },
      unchanged: c._view._modelMotionRevision === before, same: c._securityLayer.parts.get('security_2') === part, target: part.target };
  });
  check('real window contact changes its owned red/green outline without moving geometry or replacing helpers', windowPaint.open.status === 'open'
    && windowPaint.open.color === '#ef5350' && windowPaint.open.shown && windowPaint.closed.status === 'closed'
    && windowPaint.closed.color === '#66bb6a' && windowPaint.closed.shown && windowPaint.unchanged && windowPaint.same && !windowPaint.target, windowPaint);
  // Probe a short ray inside the lounge through the closed leaf. Opening it must
  // invalidate the cached box, then actual raycasting must see the clear doorway.
  const probe = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view, door = v.model.manifest.objects.find((obj) => obj.id === 'security_door').node;
    const p = door.position.clone().set(.6, 1, -.4), eye = door.position.clone().set(.6, 1, .45);
    door.localToWorld(p); door.localToWorld(eye); v.setCamera({ position: eye.toArray(), target: p.toArray() }, { instant: true });
    window.securityFixture.probe = p; window.securityFixture.closedBoxes = v._occluders();
    return { hidden: v.pointHidden(p), count: v._occBoxes.length, revision: v._modelMotionRevision };
  });
  await contact(page, 'on'); await still(page);
  const clear = await page.evaluate(() => { const v = document.querySelector('taylors3d-card')._view; return { hidden: v.pointHidden(window.securityFixture.probe),
    newBoxes: v._occBoxes !== window.securityFixture.closedBoxes, revision: v._modelMotionRevision, gate: v._modelMotionMoving }; });
  check('actual moving geometry replaces cached occlusion boxes and exposes the opened doorway', probe.hidden && !clear.hidden && clear.newBoxes && clear.revision > probe.revision && !clear.gate, { probe, clear });
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._view.fit({ model: true, instant: true }); c._view.stopCameraMotion(); }); await settle(page);
  for (const [value, extra, expected, label] of [['unknown', {}, 'unknown', 'unknown'], ['on', { restored: true }, 'unavailable', 'restored'], ['unavailable', {}, 'unavailable', 'unavailable']]) {
    await contact(page, value, extra); await still(page); s = await snapshot(page);
    check(`${label} evidence shows grey unknown and restores authored neutral without claiming closed`, s.status === expected && s.open === null
      && s.color === '#8d9199' && near(s.rotation, s.authored.quaternion) && near(s.leaf, s.authored.position) && !s.moving, s.status);
  }
  await contact(page, 'on'); await still(page);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await settle(page);
  await contact(page, 'off'); s = await snapshot(page);
  check('reduced-motion preference snaps the actual configured target without a remaining flight', !s.moving && Math.abs(s.degrees) < 1e-5 && near(s.rotation, s.authored.quaternion));
  await contact(page, 'on'); s = await snapshot(page); check('reduced motion retains contact evidence and explicit open angle', !s.moving && s.open === true && s.degrees === 90);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c.setSection(true); }); await settle(page); s = await snapshot(page);
  check('owned outlines receive both actual model and side-section clipping planes', s.planes === 2, s.planes);
  await page.evaluate(() => document.querySelector('taylors3d-card').setSection(false)); await settle(page);
  let expiry, expiryCleanup;
  try {
    await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), now = new Date().toISOString(); window.securityFixture.eventTime = now;
      const contactSource = { state: 'on', last_updated: now, attributes: { device_class: 'door' } };
      const eventSource = { state: now, attributes: { event_type: 'vehicle' } };
      const original = c._syncMiniMap, trace = { observedAt: Date.parse(now) };
      // SwiftShader can spend longer than the two-second heartbeat in two RAFs.
      // Observe normal updates before rendering, retaining real timers and deadlines.
      const observer = function (...args) {
        const result = original.apply(this, args);
        const part = c._securityLayer.parts.get('security_1');
        const sample = () => ({ status: part?.reading.status, open: part?.reading.open, color: part?.color,
          rotation: window.securityFixture.leaf.quaternion.toArray(), authored: window.securityFixture.authored.quaternion.slice(),
          deadline: c._trackingDeadline, timer: !!c._trackingTimer, services: window.securityFixture.services.length,
          elapsed: Date.now() - trace.observedAt, sameEvidence: c._hass.states['binary_sensor.security_door'] === contactSource
            && c._hass.states['event.security_vehicle'] === eventSource });
        if (!trace.initial) trace.initial = sample();
        if (!trace.stale && part?.reading.status === 'stale') trace.stale = sample();
        if (!trace.expired && trace.stale && !c._trackingLayer.parts.has('vehicle:late')) trace.expired = sample();
        return result;
      };
      window.securityFixture.expiryObserver = { card: c, original, observer, trace };
      c._syncMiniMap = observer;
      c.hass = { ...c._hass, states: { ...c._hass.states,
        'binary_sensor.security_door': contactSource, 'event.security_vehicle': eventSource } };
      c._commit({ ...c._layout, security_bindings: c._layout.security_bindings.map((binding) => ({ ...binding,
        freshness: { timestamp_mode: 'last_updated', timestamp_format: 'iso', max_age_seconds: 2 } })),
        vehicle_bindings: [{ id: 'late', entity: 'event.security_vehicle', kind: 'event', vehicle_source_confirmed: true,
          timestamp_mode: 'state', timestamp_format: 'iso', event_types: ['vehicle'], expires_seconds: 4,
          position: { x: 17, y: -2, z: .05, floorId: 'ground' } }] });
    });
    await page.waitForFunction(() => !!window.securityFixture.expiryObserver.trace.expired, { timeout: 9000 });
    expiry = await page.evaluate(() => window.securityFixture.expiryObserver.trace);
  } finally {
    expiryCleanup = await page.evaluate(() => {
      const observation = window.securityFixture.expiryObserver;
      if (!observation) return { attached: false, restored: false, released: true };
      const { card, original, observer } = observation, attached = card._syncMiniMap === observer;
      if (attached) card._syncMiniMap = original;
      const restored = card._syncMiniMap === original;
      delete window.securityFixture.expiryObserver;
      return { attached, restored, released: !window.securityFixture.expiryObserver };
    });
  }
  const firstDeadline = expiry.initial.deadline;
  check('security heartbeat and event sighting use one nearest absolute expiry timer', expiry.initial.timer && Number.isFinite(firstDeadline)
    && expiry.initial.sameEvidence && Math.abs(firstDeadline - expiry.observedAt - 2000) < 5, expiry.initial);
  s = expiry.stale; check('without another HA update stale contact becomes neutral grey and the shared timer advances to the later event', s.status === 'stale'
    && s.open === null && s.color === '#8d9199' && near(s.rotation, s.authored) && s.sameEvidence && s.timer && s.deadline === firstDeadline + 2000, s);
  s = expiry.expired; check('later sighting expires independently and the shared timer clears', !s.timer && s.deadline === null && s.sameEvidence && s.services === 0, s);
  check('passive expiry observer restores the exact original method and releases its references', expiryCleanup.attached && expiryCleanup.restored && expiryCleanup.released, expiryCleanup);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._commit({ ...c._layout, vehicle_bindings: [],
      security_bindings: c._layout.security_bindings.map(({ freshness: _freshness, ...binding }) => binding) });
  }); await contact(page, 'on'); await still(page); await idle(page);
  const before = await snapshot(page);
  const idleResult = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'), v = c._view, part = c._securityLayer.parts.get('security_1');
    // Diagnostic observation only: retain every real invalidation and renderer
    // frame, while identifying the origin if the strict idle assertion fails.
    const requests = [], origins = [], wrappers = [], active = [], originalDirty = Object.getOwnPropertyDescriptor(v, 'dirty');
    let dirty = v.dirty, update = -1;
    Object.defineProperty(v, 'dirty', { configurable: true, enumerable: true, get: () => dirty, set: (value) => {
      if (value && !dirty) origins.push({ update, active: active.slice(), stack: new Error().stack.split('\n').slice(1, 7) }); dirty = value;
    } });
    const wrap = (object, name, label) => {
      if (typeof object[name] !== 'function') return;
      const method = object[name]; wrappers.push(() => { object[name] = method; });
      object[name] = function (...args) {
        const wasDirty = v.dirty; active.push(label + '.' + name);
        try { const result = method.apply(this, args);
          if (!wasDirty && v.dirty || name === '_animateFeatures' && result) requests.push({ update, method: label + '.' + name, result: typeof result === 'boolean' ? result : undefined });
          return result;
        } finally { active.pop(); }
      };
    };
    for (const method of ['markDirty', 'setOverlay', 'setTrail', 'setMapOverlay', 'moveMarker', 'setGlows', 'setMarkerStates', 'setSky', 'setSkyBodies', 'setVisibleFloors']) wrap(v, method, 'view');
    for (const method of ['_syncSecurity', '_syncTracking', '_syncWeather', '_syncStatus', '_refreshStates', '_updateObjects', '_refreshMower', '_applySky', '_animateFeatures']) wrap(c, method, 'card');
    for (let i = 0; i < 10; i++) { c.hass = { ...c._hass, states: { ...c._hass.states, 'sensor.security_unrelated': { state: String(i), attributes: {} } } };
      update = i; await new Promise((resolve) => setTimeout(resolve, 40)); }
    await new Promise((resolve) => setTimeout(resolve, 350));
    for (const restore of wrappers.reverse()) restore(); Object.defineProperty(v, 'dirty', { ...originalDirty, value: dirty });
    return { same: part === c._securityLayer.parts.get('security_1'), requests, origins };
  }); s = await snapshot(page);
  check('ten unrelated HA updates reuse owned outlines and request zero frames, shadows, new programs/resources/lights or timers', idleResult.same && !s.timer
    && ['frames', 'shadow', 'shadowLights'].every((key) => before.stats[key] === s.stats[key]) && JSON.stringify(before.memory) === JSON.stringify(s.memory)
    && before.programs === s.programs && JSON.stringify(before.lights) === JSON.stringify(s.lights) && before.revision === s.revision && s.services === 0,
  { before: { stats: before.stats, memory: before.memory, programs: before.programs }, after: { stats: s.stats, memory: s.memory, programs: s.programs },
    invalidations: idleResult.requests, dirtyOrigins: idleResult.origins });
  await page.screenshot({ path: path.join(root, 'screenshots/security-model.png') });
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), v = c._view;
    const door = v.model.manifest.objects.find((object) => object.id === 'security_door').node;
    window.securityFixture.overviewCamera = v.getCamera();
    const eye = door.position.clone().set(2, 3.5, 2), target = door.position.clone().set(.2, 1, -.5);
    door.localToWorld(eye); door.localToWorld(target);
    v.setCamera({ position: eye.toArray(), target: target.toArray() }, { instant: true });
  }); await settle(page);
  await page.screenshot({ path: path.join(root, 'screenshots/security-hinge.png') });
  await page.evaluate(() => document.querySelector('taylors3d-card')._view.setCamera(window.securityFixture.overviewCamera, { instant: true })); await settle(page);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); window.securityFixture.oldLeaf = window.securityFixture.leaf;
    window.securityFixture.oldPart = c._securityLayer.parts.get('security_1'); window.securityFixture.oldModel = c._view.model;
    window.securityFixture.oldDisposed = { material: 0, geometries: 0 };
    window.securityFixture.oldPart.material.addEventListener('dispose', () => window.securityFixture.oldDisposed.material++);
    for (const line of window.securityFixture.oldPart.lines) line.geometry.addEventListener('dispose', () => window.securityFixture.oldDisposed.geometries++);
    c.setConfig({ ...c._config, model: '/demo/security-fixture.glb?replacement=1' });
  });
  await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return c._view.model && c._view.model !== window.securityFixture.oldModel
    && c._securityLayer.parts.get('security_1')?.target !== window.securityFixture.oldLeaf && !c._loading; }, { timeout: 30000 }); await still(page);
  const replacement = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), old = window.securityFixture.oldLeaf, part = c._securityLayer.parts.get('security_1');
    return { oldNeutral: old.quaternion.toArray(), authored: window.securityFixture.authored.quaternion,
      oldHelpers: window.securityFixture.oldPart.lines.every((line) => !line.parent), disposed: window.securityFixture.oldDisposed,
      expectedGeometries: window.securityFixture.oldPart.lines.length, targetNew: part.target !== old, degrees: part.degrees,
      services: window.securityFixture.services.length, parts: c._securityLayer.parts.size };
  });
  check('real GLB replacement restores old authored pose, disposes each owned resource once and binds only fresh targets', near(replacement.oldNeutral, replacement.authored)
    && replacement.oldHelpers && replacement.disposed.material === 1 && replacement.disposed.geometries === replacement.expectedGeometries
    && replacement.targetNew && replacement.degrees === 90 && replacement.parts === 2 && replacement.services === 0, replacement);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.securityFixture.detached = c; c.remove(); }); await settle(page);
  const detached = await page.evaluate(() => { const c = window.securityFixture.detached; return { timer: !!c._trackingTimer, raf: !!c._view._raf,
    moving: c._securityLayer.moving, visible: [...c._securityLayer.parts.values()].some((part) => part.lines.some((line) => line.visible)) }; });
  check('card disconnect ends motion/render/expiry work and hides owned outlines', !detached.timer && !detached.raf && !detached.moving && !detached.visible, detached);
  await page.evaluate(() => document.querySelector('section.theme').append(window.securityFixture.detached)); await settle(page); await still(page);
  s = await snapshot(page); check('reconnect retains one helper set and current explicit evidence with zero device actions', s.status === 'open' && s.degrees === 90 && s.services === 0);
} catch (error) { check('security UI and explicit GLB scenario completes', false, error.stack || error.message); }
finally { if (session) { browserErrors.push(...(session.errors || [])); await session.close(); } }
check('no browser errors', browserErrors.length === 0, browserErrors);
if (checks.some((pass) => !pass)) process.exitCode = 1;
