// Anonymous HA boundaries and the existing authored two-storey GLB. The actual
// Root, ObjectPopup, TrackingEditor, TrackingCalibration and renderer are used.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { floorPresentationFixtureGlb, floorFixtureEntities, floorFixtureIds } from './floor-presentation-fixture.mjs';
import { roomActionsLayout } from './room-actions-fixture.mjs';
import { gpsCalibrationHtml, gpsCalibrationLayout, gpsCalibrationReadings, gpsEntities } from './gps-calibration-fixture.mjs';

export const runtimeLocalizationKey = 'runtime-localization-native';
export const runtimeLocalizationEntities = Object.freeze({ ...floorFixtureEntities, ...gpsEntities, xy: 'sensor.runtime_xy' });
export const runtimeLocalizationIds = floorFixtureIds;
export const runtimeLocalizationNames = Object.freeze({ object: 'User_<b>Object_été', lamp: 'User_<b>Lamp_été',
  source: 'User_<b>Coordinate_été', floor: 'User_<b>Ground_été', binding: 'User_<b>Calibration_été', error: 'External_<b>Error_été' });

export function runtimeLocalizationGlb() {
  const original = floorPresentationFixtureGlb(), length = original.readUInt32LE(12);
  const json = JSON.parse(original.toString('utf8', 20, 20 + length));
  const lamp = json.nodes.find((node) => node.extras?.fp?.id === floorFixtureIds.lamp);
  lamp.extras.fp.label = runtimeLocalizationNames.object;
  lamp.extras.fp.ui = { tap: 'popup', hold: 'popup', popup: ['toggle', 'brightness', 'color', 'state'] };
  const raw = Buffer.from(JSON.stringify(json)), text = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const header = Buffer.from(original.subarray(0, 20)), binary = original.subarray(20 + length);
  header.writeUInt32LE(20 + text.length + binary.length, 8); header.writeUInt32LE(text.length, 12);
  return Buffer.concat([header, text, binary]);
}
export function runtimeLocalizationLayout(bytes = runtimeLocalizationGlb().length) {
  const layout = roomActionsLayout(bytes), gps = gpsCalibrationLayout();
  layout.room_actions = { version: 1, rooms: [] };
  layout.vacuum_bindings = [...gps.vacuum_bindings, { id: 'runtime-xy', entity: gpsEntities.robot, kind: 'xy',
    label: runtimeLocalizationNames.binding, position: { x: 0, y: 0, z: .05, floorId: 'ground' },
    position_source: { source: 'xy', entity: runtimeLocalizationEntities.xy, x_attr: 'measured.east', y_attr: 'measured.north',
      units: 'm', floorId: 'ground', calibration: [{ src: [10, 20], plan: [-2, 1], annotation: { retain: 'User_raw_pair' } },
        { src: [11, 20], plan: [-1, 1] }], extension: { retain: 'User_raw_source' } }, extension: { retain: ['User_extra', false, null] } }];
  layout.model.name = 'Explicit simulated runtime bench.glb';
  return layout;
}
export function runtimeLocalizationReadings() {
  const readings = gpsCalibrationReadings(), read = (entity_id, state, attributes) => ({ entity_id, state, attributes });
  for (const entity of Object.values(floorFixtureEntities)) if (!readings[entity]) readings[entity] = read(entity,
    entity.startsWith('light.') || entity.startsWith('switch.') ? 'on' : entity.startsWith('lawn_mower.') ? 'mowing' : 'off', { friendly_name: `User_${entity}` });
  readings[runtimeLocalizationEntities.lamp] = read(runtimeLocalizationEntities.lamp, 'on', { friendly_name: runtimeLocalizationNames.lamp,
    brightness: 128, rgb_color: [12, 34, 56], color_mode: 'rgb', supported_color_modes: ['rgb', 'color_temp'],
    min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500 });
  readings[runtimeLocalizationEntities.xy] = read(runtimeLocalizationEntities.xy, 'ready', { friendly_name: runtimeLocalizationNames.source,
    measured: { east: 10, north: 20 }, external: 'User_raw_attribute' });
  return readings;
}
export function runtimeLocalizationHtml(mode) {
  return gpsCalibrationHtml(mode).replace('Simulated native GPS calibration proof', 'Simulated runtime localization proof')
    .replace('SIMULATED GPS readings, drawn plan and HA storage', 'SIMULATED object controls, coordinates, authored GLB and HA storage');
}

// Standalone page.evaluate extension of the existing genuine GPS Root fixture.
// Service deferral/rejection is only a simulated HA boundary; no app handler,
// validation, editor method, popup, geometry, or renderer is replaced.
export async function prepareRuntimeLocalizationFixture({ entities, ids, names }) {
  const c = document.querySelector('taylors3d-card'), f = window.gpsFixture;
  const runtime = window.runtimeLocalizationFixture = { f, entities, ids, names, pending: [], replies: [], info: [] };
  const callService = (...args) => { f.services.push(structuredClone(args));
    if (runtime.replies.shift() === 'defer') return new Promise((resolve, reject) => runtime.pending.push({ resolve, reject }));
    return Promise.resolve(); };
  c.hass = { ...c._hass, callService,
    services: { ...c._hass.services, light: { toggle: {}, turn_on: {}, turn_off: {} }, homeassistant: { toggle: {} } },
    formatEntityState: (state) => `HA_STATE:${state.state}`,
    formatEntityName: (state) => state.attributes.friendly_name,
    floors: { ...c._hass.floors, ground: { ...c._hass.floors.ground, name: names.floor } } };
  c.setConfig({ ...c._config, model: '/demo/runtime-localization.glb', merge: false, view: '3d', device_tap_action: 'toggle',
    lights: 'off', height: '900px', layout_style: 'house', house_colour_scheme: 'dark' });
  await c._loadModel(); c._setView('upper', { instant: true }); c._setMode('3d'); c.resetHistory();
  // The GPS host starts in Top mode. Returning to 3D legitimately restores its
  // earlier origin-centred camera; changing a model storey preserves that view.
  // Use the actual Reset view route to frame the authored current upper storey.
  c._resetCamera();
  runtime.renderer = c._view.renderer; runtime.original = structuredClone(c._layout);
  runtime.baseCommits = f.commits.length; runtime.baseWrites = f.ws.filter((message) => message.type === 'taylors3d/layout/set').length;
  runtime.baseServices = f.services.length;
  runtime.locale = (language) => { c.hass = { ...c._hass, language, locale: { ...c._hass.locale, language } }; };
  runtime.viewer = () => { c.hass = { ...c._hass, user: { id: 'simulated-runtime-viewer', is_admin: false,
    is_active: true, name: 'Simulated viewer', permissions: { control: 'all' } } }; };
  runtime.lampReading = (brightness, rgb) => {
    const old = c._hass.states[entities.lamp];
    c.hass = { ...c._hass, states: { ...c._hass.states, [entities.lamp]: { ...old,
      attributes: { ...old.attributes, brightness, rgb_color: [...rgb] } } } };
  };
  runtime.pulse = (kind, entity = entities.lamp) => {
    const old = c._hass;
    if (kind === 'connection') { old.connection.connected = false; c.hass = { ...old }; old.connection.connected = true; c.hass = { ...old }; }
    if (kind === 'account') { c.hass = { ...old, user: { ...old.user, id: 'simulated-runtime-other' } }; c.hass = { ...old }; }
    if (kind === 'permission') { c.hass = { ...old, user: { ...old.user, permissions: { runtime_control: false } } }; c.hass = { ...old }; }
    if (kind === 'active') { old.user.is_active = false; c.hass = { ...old }; old.user.is_active = true; c.hass = { ...old }; }
    if (kind === 'role') { old.user.is_admin = false; c.hass = { ...old }; old.user.is_admin = true; c.hass = { ...old }; }
    if (kind === 'source') { c.hass = { ...old, states: { ...old.states, [entity]: { ...old.states[entity], state: 'unavailable' } } }; c.hass = { ...old }; }
    if (kind === 'service') { c.hass = { ...old, services: { ...old.services, [entity.split('.')[0]]: {} } }; c.hass = { ...old }; }
  };
  runtime.finish = (error) => { const pending = runtime.pending.shift(); if (!pending) throw new Error('No explicit deferred simulated runtime command');
    if (error) pending.reject(new Error(error)); else pending.resolve(); };
  window.addEventListener('hass-more-info', (event) => runtime.info.push(event.detail.entityId));
}

export async function serveRuntimeLocalizationFixture(root, mode) {
  const model = runtimeLocalizationGlb(), layout = runtimeLocalizationLayout(model.length), readings = runtimeLocalizationReadings();
  const page = runtimeLocalizationHtml(mode), requests = [], unexpected = [];
  const types = { '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary' };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture'); requests.push({ method: request.method, path: url.pathname });
    const send = (status, type, body) => { response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); response.end(body); };
    if (request.method !== 'GET') { unexpected.push(request.method + ' ' + url.pathname); return send(405, 'text/plain', 'Read-only anonymous fixture'); }
    if (url.pathname === '/demo/runtime-localization.html') return send(200, 'text/html', page);
    if (url.pathname === '/demo/runtime-localization.glb') return send(200, 'model/gltf-binary', model);
    if (url.pathname === '/api/taylors3d/furniture') return send(200, 'application/json', JSON.stringify({ version: 1, packs: [] }));
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      unexpected.push(url.pathname); return send(404, 'text/plain', 'Unregistered anonymous fixture route');
    }
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { model, layout, readings, requests, unexpected, base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }) };
}
