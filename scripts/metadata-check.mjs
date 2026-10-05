// F17 native source/bundle regression. All registry names and readings here are
// simulated; controls, GLB parsing, root action guards and rendering are real.
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { metadataFixtureGlb, metadataScenario, metadataIds as ids, metadataEntities as entities,
  metadataExcluded as excluded } from './lib/metadata-fixture.mjs';

const checks = [], errors = [];
let mode = '', context;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const check = (name, pass, detail) => {
  checks.push(!!pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${mode}: ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
};
const field = (name) => `[data-field="${name}"]`;
const action = (name, id) => `[data-act="${name}"]${id === undefined ? '' : `[data-id="${id}"]`}`;
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function ready(page) {
  await page.waitForFunction(() => {
    const c = document.querySelector('taylors3d-card');
    return c?._layout && c._view?.model && c._objects?.parts.has('fp_lamp') && !c._loading && !c._view._tween;
  }, { timeout: 30000 });
  await settle(page);
}
async function control(page, selector, callback) {
  context = 'native control ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const node = handle.asElement();
    if (!node) throw new Error('Missing metadata control ' + selector);
    await node.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await callback(node);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (node) => node.click());
const select = (page, name, value) => control(page, field(name), (node) => node.select(value));
async function type(page, name, value, selector = field(name)) {
  await control(page, selector, async (node) => {
    await node.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace'); await page.keyboard.type(String(value));
  });
  const actual = await page.evaluate((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector)?.value, selector);
  if (actual !== String(value)) throw new Error(`Native ${name} value ${actual}, expected ${value}`);
}
async function blur(page) { await page.keyboard.press('Tab'); await settle(page); }
async function options(page, selector) {
  return page.evaluate((selector) => {
    const node = document.querySelector('taylors3d-card').shadowRoot.querySelector(selector);
    return node ? [...node.querySelectorAll('option')].map((option) => ({ id: option.value, text: option.textContent,
      disabled: option.disabled, selected: option.selected })) : null;
  }, selector);
}
async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), f = window.metadataFixture;
    return { saves: f.saves.length, services: f.services, saved: c._layout,
      warning: c._edit?.panel.textContent, editing: c._editing, tab: c._edit?.tab };
  });
}
async function screenshot(page, filename) {
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'screenshots', filename), fullPage: true });
}

async function open(currentMode) {
  const transport = await launch(); let session;
  try {
    session = await newPage(transport.browser, { width: 1280, height: 1080 });
    const { page } = session;
    let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
      .replace(/<section class="theme dark">[\s\S]*?<\/section>/, '')
      .replace('display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));', 'display: block;');
    if (currentMode === 'source') html = html.replace('src="../dist/taylors3d-card.js"', 'src="../src/taylors3d-card.js"');
    const imports = { imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } };
    html = html.replace('</head>', `<script type="importmap">${JSON.stringify(imports)}</script></head>`);
    const glb = metadataFixtureGlb(), requests = [];
    await page.evaluateOnNewDocument(() => { window.__demoMowerPaused = true; });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/index.html') request.respond({ status: 200, contentType: 'text/html', body: html });
      else if (url.pathname === '/demo/metadata-simulated.glb') request.respond({ status: 200, contentType: 'model/gltf-binary', body: glb });
      else request.continue();
    });
    await page.goto(`${transport.base}/demo/index.html?model=/demo/metadata-simulated.glb&merge=0&floor=all&view=3d&height=760px`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront(); await ready(page);
    await page.evaluate(async ({ fixture, ids, entities, currentMode }) => {
      const c = document.querySelector('taylors3d-card');
      c.hass = { ...c._hass, callWS: undefined };
      c.setConfig({ ...c._config, layout_key: `metadata-native-${currentMode}`, height: '760px', merge: false,
        group_by: 'entity', control_panel: 'right', device_tap_action: 'controls', model_opacity: 1,
        sky_bodies: false, lights: 'auto', mini_map: true });
      await c._layoutReady;
      const f = window.metadataFixture = { services: [], saves: [], baseline: null, ids, entities, fixture };
      c._hass.connection.connected = true;
      c.hass = { ...c._hass, callWS: undefined, user: { id: 'metadata-simulated-admin', is_admin: true, is_active: true },
        callService: (...args) => { f.services.push(args); return Promise.resolve(); },
        services: { light: { toggle: {}, turn_on: {}, turn_off: {} }, homeassistant: { toggle: {} }, switch: { toggle: {} } },
        states: fixture.states, entities: fixture.entities, areas: fixture.areas, floors: fixture.floors, devices: fixture.devices,
        locale: { language: 'en', number_format: 'none' }, language: 'en',
        config: { ...c._hass.config, latitude: null, longitude: null } };
      c._commit({ ...c._layout, ...fixture.layout });
      c._skyMode = 'night'; c._applySky(true); c._setView('all', { instant: true });
      c._view.stopCameraMotion(); c._view.setCamera({ position: [8, 12, 10], target: [0, 3, 0] }, { instant: true });
      c.resetHistory();
      const commit = c._commit.bind(c); c._commit = (...args) => { f.saves.push(args[0]); return commit(...args); };
      f.baseline = JSON.stringify(c._layout);
      document.querySelector('section.theme h2').textContent = `Simulated metadata repair bench · ${currentMode}`;
    }, { fixture: metadataScenario(), ids, entities, currentMode });
    await ready(page);
    return { ...transport, ...session, requests };
  } catch (error) {
    errors.push(...(session?.errors || [])); await transport.close(); throw error;
  }
}

async function missingFloors(page) {
  context = 'initial exact missing-floor geometry';
  const s = await page.evaluate(({ ids, entities }) => {
    const c = document.querySelector('taylors3d-card'), v = c._view;
    const drawn = []; v.staticGroup.traverse((node) => { if (node.userData.roomId) drawn.push(node.userData.roomId); });
    const staleMarker = c._markers.find((marker) => marker.entityId === entities.stalePin);
    const room = c._roomList.find((entry) => entry.room.id === ids.room);
    const retained = c._roomList.find((entry) => entry.room.id === ids.staleRoom);
    return { exactRoom: c._roomList.find((entry) => entry.room.id === ids.staleRoom)?.floorId,
      drawnArea: room?.room.area_id, drawnFloor: room?.floorId, drawnPolygon: room?.room.polygon,
      staleArea: retained?.room.area_id, modelAreas: (c._modelRooms || []).map((entry) => entry.area_id),
      drawn, pinPosition: staleMarker && c._positions.get(staleMarker.id), pinRendered: !!(staleMarker && v.markerObjects.has(staleMarker.id)),
      mowerLive: c._mowerLive, mowerFloor: c._mowerFloor(), mowerRendered: !!(c._mowerMarkerId && v.markerObjects.has(c._mowerMarkerId)),
      map: !!v.mapPlane, allFloors: c._floors.map((floor) => floor.id), unchanged: JSON.stringify(c._layout) === window.metadataFixture.baseline,
      services: window.metadataFixture.services.length, writes: window.metadataFixture.saves.length };
  }, { ids, entities });
  check('drawn overlay and retained outlines have explicit HA areas distinct from the tagged model rooms', s.drawnArea === ids.drawnArea
    && s.staleArea === ids.staleArea && s.drawnFloor === 'ground' && same(s.drawnPolygon, [[-8, -2], [-5, -2], [-5, 2], [-8, 2]])
    && !s.modelAreas.includes(ids.drawnArea) && !s.modelAreas.includes(ids.staleArea), s);
  check('missing exact room floor remains saved and has no substitute ground geometry', s.exactRoom === ids.goneFloor && !s.drawn.includes(ids.staleRoom), s);
  check('a pin with a missing exact floor has no position or drawn marker on another floor', !s.pinPosition && !s.pinRendered, s);
  check('missing mower floor prevents live position, marker and image overlay', s.mowerFloor === ids.goneFloor
    && s.mowerLive === null && !s.mowerRendered && !s.map && !s.allFloors.includes(ids.goneFloor), s);
  check('loading and rendering preserve all saved raw links with no user writes or services', s.unchanged && s.writes === 0 && s.services === 0);
}

async function mowerAndRooms(page) {
  await click(page, 'button.edit'); await click(page, action('tab', 'mower'));
  let o = await options(page, '#fp-pos-ents');
  check('real Mower suggestions use registry name and current eligible source', o.some((item) => item.id === entities.position && item.text === 'HA position source' && !item.disabled), o);
  check('Mower suggestions exclude hidden, disabled, diagnostic and device-disabled sensors', excluded.every((kind) => !o.some((item) => item.id === `sensor.metadata_${kind}`)), o);
  check('saved missing mower entity stays a warning datalist row', o.some((item) => item.id === entities.missingPosition && item.disabled && item.text.includes('Missing entity')), o);
  let pictures = await options(page, '#fp-pic-ents');
  check('image choices use registry names and exclude all filtered camera/image sources', pictures.some((item) => item.id === entities.map && item.text === 'HA image source')
    && excluded.every((kind) => !pictures.some((item) => item.id === `camera.metadata_${kind}` || item.id === `image.metadata_${kind}`)), pictures);
  check('saved missing map image is retained as a disabled warning choice', pictures.some((item) => item.id === entities.missingImage && item.disabled && item.text.includes('Missing entity')), pictures);
  let floors = await options(page, field('mower-floor'));
  check('Mower native floor select displays the saved missing ID explicitly', floors.some((item) => item.id === ids.goneFloor && item.selected && item.text.includes('Missing floor')), floors);
  const before = await snapshot(page);
  await select(page, 'mower-picker-area', 'area:metadata-upper-area'); o = await options(page, '#fp-pos-ents'); pictures = await options(page, '#fp-pic-ents');
  check('temporary Mower area filter narrows choices without removing saved missing IDs', o.some((item) => item.id === entities.upper)
    && !o.some((item) => item.id === entities.position) && o.some((item) => item.id === entities.missingPosition && item.disabled)
    && pictures.some((item) => item.id === entities.missingImage && item.disabled), { o, pictures });
  await select(page, 'mower-picker-area', 'unassigned'); o = await options(page, '#fp-pos-ents');
  check('Unassigned filter excludes an entity inheriting its device area', o.some((item) => item.id === entities.unassigned)
    && !o.some((item) => item.id === entities.position) && !o.some((item) => item.id === entities.upper), o);
  await select(page, 'mower-picker-area', 'all');
  check('Mower area filters make no layout write or service', (await snapshot(page)).saves === before.saves && (await snapshot(page)).services.length === 0);
  await type(page, 'mower-entity', 'sensor.metadata_disabled'); await blur(page);
  let s = await snapshot(page);
  check('typing an excluded new Mower source is rejected by the actual form commit path', s.saved.mower.entity === entities.missingPosition
    && s.saves === before.saves && s.warning.includes('Choose a current entity'), s.saved.mower);
  await type(page, 'ov-entity', 'camera.metadata_hidden'); await blur(page); s = await snapshot(page);
  check('typing an excluded new map image is rejected and saved map link is unchanged', s.saved.mower.overlay.entity === entities.missingImage && s.saves === before.saves);
  await click(page, action('tab', 'rooms')); await click(page, action('select-room', ids.staleRoom));
  floors = await options(page, field('room-floor')); s = await snapshot(page);
  check('native room editor shows exact missing floor instead of Ground and keeps its outline', floors.some((item) => item.id === ids.goneFloor && item.selected && item.text.includes('Missing floor'))
    && s.warning.includes('no current floor location') && s.saved.rooms.find((room) => room.id === ids.staleRoom)?.polygon.length === 4, floors);
  check('visiting missing-link editors makes no automatic repair or service', s.saves === 0 && s.services.length === 0);
  await screenshot(page, `metadata-${mode}-missing-links.png`);
}

async function overlays(page) {
  await click(page, action('tab', 'overlays')); await select(page, 'ovr-room', ids.room);
  const rooms = await options(page, field('ovr-room'));
  check('native overlay selector retains the exact distinct drawn room and its saved sensor binding', rooms.some((item) => item.id === ids.room && item.selected), rooms);
  let o = await options(page, field('ovr-add-source'));
  check('real overlay picker uses registry names and excludes filtered normal source options', o.some((item) => item.id === entities.upper && item.text === 'HA upper source')
    && excluded.every((kind) => !o.some((item) => item.id === `sensor.metadata_${kind}`)), o);
  let s = await page.evaluate(() => { const panel = document.querySelector('taylors3d-card')._edit.panel;
    return { warnings: [...panel.querySelectorAll('[data-ovr-source-warning]')].map((node) => node.textContent),
      readings: [...panel.querySelectorAll('[data-ovr-source-reading]')].map((node) => node.textContent),
      aggregate: panel.querySelector('[data-ovr-preview="measure"]')?.textContent }; });
  check('saved hidden/missing sources remain visibly warned and individual precision is HA-formatted', s.warnings.some((text) => text.includes('Hidden'))
    && s.warnings.some((text) => text.includes('Missing entity')) && s.readings.includes('18.9 °C'), s);
  check('combined room value is labelled Aggregate separately from reported source values', s.aggregate.includes('Aggregate preview') && s.aggregate.includes('18.88 °C'), s.aggregate);
  const before = await snapshot(page);
  await select(page, 'ovr-picker-area', 'area:metadata-ground-area'); o = await options(page, field('ovr-add-source'));
  check('temporary overlay area filter excludes a real upper source without moving it between rooms', !o.some((item) => item.id === entities.upper)
    && !o.some((item) => item.id === entities.unassigned), o);
  await select(page, 'ovr-picker-area', 'unassigned'); o = await options(page, field('ovr-add-source'));
  check('overlay Unassigned filter offers only explicitly unassigned eligible measurements', o.some((item) => item.id === entities.unassigned)
    && !o.some((item) => item.id === entities.upper || item.id === entities.position), o);
  await select(page, 'ovr-picker-area', 'all');
  await control(page, field('ovr-min'), (node) => node.focus());
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.metadataFixture.focused = c.shadowRoot.activeElement;
    c.hass = { ...c._hass, states: { ...c._hass.states, [window.metadataFixture.entities.savedHidden]: {
      ...c._hass.states[window.metadataFixture.entities.savedHidden], state: '21.87654' } } }; });
  await settle(page);
  s = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return {
    focus: c.shadowRoot.activeElement === window.metadataFixture.focused,
    same: c._edit.panel.querySelector('[data-field="ovr-min"]') === window.metadataFixture.focused,
    reading: c._edit.panel.querySelector('[data-ovr-source-reading]')?.textContent }; });
  check('ordinary actual HA reading update preserves exact focused native input and updates source value', s.focus && s.same && s.reading === '21.9 °C', s);
  await click(page, action('ovr-edit-alert', ids.alert)); o = await options(page, field('ovr-alert-entity'));
  check('saved missing alert remains selected as a disabled warning, without guessed replacement', o.some((item) => item.id === entities.missingContact && item.selected && item.disabled && item.text.includes('Missing entity')), o);
  check('smoke picker recognises registry original device class and its HA name', o.some((item) => item.id === entities.smoke && item.text === 'HA smoke contact' && !item.disabled), o);
  check('alert picker excludes all filtered contact suggestions', excluded.every((kind) => !o.some((item) => item.id === `binary_sensor.metadata_${kind}`)), o);
  await type(page, 'ovr-alert-label', 'Simulated retained alert'); await blur(page);
  const unsaved = await snapshot(page);
  check('opening, filtering and typing an alert draft sends no device action or layout write', unsaved.saves === before.saves && unsaved.services.length === 0);
  await click(page, action('ovr-save-alert')); let saved = await snapshot(page);
  check('intentional alert Save makes exactly one commit while preserving unavailable exact link and extras', saved.saves === before.saves + 1
    && saved.saved.alert_bindings[0].entity === entities.missingContact && saved.saved.alert_bindings[0].alert_extra === 'keep'
    && saved.saved.alert_bindings[0].label === 'Simulated retained alert' && saved.services.length === 0, saved.saved.alert_bindings);
  await click(page, action('ovr-add-alert')); await select(page, 'ovr-alert-entity', entities.smoke);
  await page.evaluate((entity) => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass,
    entities: { ...c._hass.entities, [entity]: { ...c._hass.entities[entity], disabled_by: 'user' } } }; }, entities.smoke);
  await settle(page); await click(page, action('ovr-save-alert')); saved = await snapshot(page);
  check('newly selected alert cannot be saved after current registry eligibility is revoked', saved.saved.alert_bindings.length === 1
    && saved.saves === before.saves + 1 && saved.warning.includes('Choose a current'), saved.saved.alert_bindings);
  await click(page, action('ovr-cancel-alert'));
  await screenshot(page, `metadata-${mode}-overlay-warnings.png`);
}

async function views(page) {
  await click(page, action('tab', 'views')); await select(page, 'vw-view', 'all');
  let s = await snapshot(page);
  check('Views exposes missing saved floor as a checked deliberate-removal control', s.warning.includes('Missing floor: ' + ids.goneFloor));
  const before = s.saves;
  await click(page, `${field('vw-floor')}[data-id="upper"]`); s = await snapshot(page);
  check('checking a valid new view floor preserves every other saved exact floor ID and extras', same(s.saved.views.all.floors, [ids.goneFloor, 'ground', 'upper'])
    && s.saved.views.all.view_extra === 'keep' && s.saves === before + 1, s.saved.views.all);
  await click(page, `${field('vw-floor')}[data-id="${ids.goneFloor}"]`); s = await snapshot(page);
  check('only deliberate uncheck removes the exact missing view floor', same(s.saved.views.all.floors, ['ground', 'upper']) && s.saves === before + 2, s.saved.views.all);
  await click(page, action('history-undo')); s = await snapshot(page);
  check('Undo restores the exact missing floor reference', s.saved.views.all.floors.includes(ids.goneFloor));
  await click(page, action('history-redo')); s = await snapshot(page);
  check('Redo restores the deliberate removal without any device action', same(s.saved.views.all.floors, ['ground', 'upper']) && s.services.length === 0);
}

async function objectTest(page) {
  await click(page, action('tab', 'objects'));
  const roomKey = `${ids.upper}/${ids.upperRoom}`;
  const expanded = await page.evaluate((id) => !!document.querySelector('taylors3d-card').shadowRoot.querySelector(`[data-act="obj-test"][data-id="${id}"]`), ids.lamp);
  if (!expanded) await click(page, `[data-act="obj-expand"][data-key="${roomKey}"]`);
  await click(page, action('obj-test', ids.lamp));
  let s = await snapshot(page);
  check('one intentional native Objects Test sends exactly the real bound light toggle', same(s.services, [['light', 'toggle', { entity_id: entities.lamp }]]), s.services);
  const beforeSaved = JSON.stringify(s.saved), beforeWrites = s.saves;
  const probes = await page.evaluate(({ id, entity }) => {
    const c = document.querySelector('taylors3d-card'), f = window.metadataFixture, h = c._hass;
    const registration = h.entities[entity], source = h.states[entity], service = h.services.light.toggle;
    const cases = [];
    const probe = (label, patch, restore) => {
      c.hass = { ...c._hass, ...patch }; const before = f.services.length;
      const accepted = c.testObject(id); cases.push({ label, accepted, calls: f.services.length - before });
      c.hass = { ...c._hass, ...restore };
    };
    for (const [label, flag] of [['hidden', { hidden_by: 'user' }], ['disabled', { disabled_by: 'user' }],
      ['diagnostic', { entity_category: 'diagnostic' }], ['device disabled', { device_id: 'metadata-disabled-device' }]]) {
      probe(label, { entities: { ...h.entities, [entity]: { ...registration, ...flag } } }, { entities: h.entities });
    }
    probe('service removed', { services: { ...h.services, light: { ...h.services.light, toggle: undefined } } }, { services: { ...h.services, light: { ...h.services.light, toggle: service } } });
    h.connection.connected = false; const before = f.services.length;
    cases.push({ label: 'connection lost', accepted: c.testObject(id), calls: f.services.length - before });
    h.connection.connected = true;
    probe('unavailable', { states: { ...h.states, [entity]: { ...source, state: 'unavailable' } } }, { states: h.states });
    return cases;
  }, { id: ids.lamp, entity: entities.lamp });
  await settle(page);
  for (const probe of probes) check(`actual root Test rejects ${probe.label} using latest HA evidence`, probe.accepted === false && probe.calls === 0, probe);
  s = await snapshot(page); check('all revoked Test attempts preserve exact layout and the one intentional service count', s.services.length === 1
    && s.saves === beforeWrites && JSON.stringify(s.saved) === beforeSaved);
}

async function objectPoint(page, id) {
  return page.evaluate((id) => {
    const c = document.querySelector('taylors3d-card'), v = c._view;
    const anchor = c._objects.displayAnchors().find((entry) => entry.id === id);
    const point = anchor && v.projectWorld(anchor.world); if (!point) return null;
    const scene = v.container.getBoundingClientRect();
    // Match real mouse priority (root OBJECT_HIT_PX.mouse=30), and require the
    // actual canvas hit. A model/popup must never be opened by direct test calls.
    for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 4], [-8, -4]]) {
      const x = point[0] + dx, y = point[1] + dy, hit = c.shadowRoot.elementFromPoint(x, y);
      if (x > scene.left && x < scene.right && y > scene.top && y < scene.bottom
        && c._objectHit(x, y, 30, false) === id && hit === v.renderer.domElement) return { x, y, hit: id };
    }
    return null;
  }, id);
}
async function precisionPopup(page) {
  await click(page, 'button.edit'); // Done: return to normal model interaction.
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._setView('upper', { instant: true });
    c._view.stopCameraMotion(); c._view.setCamera({ position: [-4, 9, 4], target: [-1, 5.8, -.8] }, { instant: true });
  }); await ready(page);
  const point = await objectPoint(page, ids.camera);
  check('precision fixture has an exposed real tagged-object native canvas target', !!point, point);
  if (!point) throw new Error('No exposed precision object pointer target');
  context = 'real tagged precision object hold';
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await new Promise((resolve) => setTimeout(resolve, 650)); await page.mouse.up(); await settle(page);
  let s = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); return {
    id: c._popup.objectId, values: [...c.shadowRoot.querySelectorAll('.fp-popup .fp-pop-value')].map((node) => node.textContent),
    services: window.metadataFixture.services.length }; });
  check('actual ObjectPopup hold reads HA display precision rather than raw decimal noise', s.id === ids.camera && s.values.includes('19.9 °C') && s.services === 1, s);
  await page.evaluate((entity) => { const c = document.querySelector('taylors3d-card'); c.hass = { ...c._hass,
    states: { ...c._hass.states, [entity]: { ...c._hass.states[entity], state: '22.34567' } } }; }, entities.precise);
  await settle(page);
  s = await page.evaluate(() => [...document.querySelector('taylors3d-card').shadowRoot.querySelectorAll('.fp-popup .fp-pop-value')].map((node) => node.textContent));
  check('the same real popup updates to the latest HA-formatted reading with no service', s.includes('22.3 °C'), s);
  await screenshot(page, `metadata-${mode}-reported-precision.png`);
  await page.keyboard.press('Escape'); await settle(page);
}

const requestedModes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
for (const currentMode of requestedModes) {
  let session; mode = currentMode; context = 'setup';
  try {
    session = await open(mode); const { page } = session;
    const isolation = session.requests;
    check('mode imports the intended card source without a second Three/exporter adapter', mode === 'source'
      ? isolation.includes('/src/taylors3d-card.js') && !isolation.includes('/dist/taylors3d-card.js')
      : isolation.includes('/dist/taylors3d-card.js') && !isolation.includes('/src/taylors3d-card.js'), isolation.filter((name) => name.endsWith('taylors3d-card.js')));
    await missingFloors(page); await mowerAndRooms(page); await overlays(page); await views(page);
    await objectTest(page); await precisionPopup(page);
    const final = await snapshot(page);
    check('only the intentional native Test sent a service during the entire metadata repair workflow', same(final.services, [['light', 'toggle', { entity_id: entities.lamp }]]), final.services);
  } catch (error) {
    check('native metadata workflow completes without exceptions', false, { context, message: error.message, stack: error.stack });
    if (session) await screenshot(session.page, `metadata-${mode}-failure.png`).catch(() => {});
  } finally {
    if (session) { errors.push(...session.errors.map((error) => ({ mode, error }))); await session.close(); }
  }
}
check('strict browser console errors and warnings are empty', errors.length === 0, errors);
console.log(`\n${checks.filter(Boolean).length}/${checks.length} metadata browser assertions passed`);
if (checks.some((pass) => !pass)) process.exitCode = 1;
