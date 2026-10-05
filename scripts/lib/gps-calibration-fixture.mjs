// Explicit simulated readings and storage, with a drawn plan. The production
// Root, EditMode, TrackingEditor, GPS reader and existing renderer are unchanged.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const gpsLayoutKey = 'gps-calibration-native';
export const gpsEntities = Object.freeze({ robot: 'vacuum.gps_new', imported: 'vacuum.gps_imported', repair: 'vacuum.gps_repair',
  position: 'sensor.gps_reported', replacement: 'sensor.gps_replacement', unrelated: 'sensor.gps_unrelated' });
export const gpsSamples = Object.freeze([[51.5, -.1], [51.50001, -.1], [51.500005, -.1]].map(Object.freeze));
export function gpsCalibrationReadings() {
  const read = (entity_id, state, attributes) => ({ entity_id, state, last_updated: '2026-10-05T10:00:00Z',
    last_changed: '2026-10-05T10:00:00Z', attributes });
  return Object.fromEntries(Object.entries(gpsEntities).map(([key, id]) => [id, read(id,
    key === 'unrelated' ? '1' : id.startsWith('vacuum.') ? 'cleaning' : 'ready',
    id.startsWith('sensor.gps_') && key !== 'unrelated'
      ? { friendly_name: 'Explicitly simulated GPS source', latitude: 51.5, longitude: -.1,
        measured: { latitude: 51.5, longitude: -.1 }, numeric_extra: 50, fake_latitude: true, latitude_hint: 'unreported' }
      : { friendly_name: 'User_Robot_<b>été' })]));
}
export function gpsCalibrationLayout() {
  const position = { x: 0, y: 0, z: .05, floorId: 'ground' };
  return { version: 1, floors: [{ id: 'ground', name: 'Simulated ground', elevation: 0, height: 3 },
    { id: 'upper', name: 'Simulated upper', elevation: 3, height: 3 }],
  rooms: [{ id: 'gps-ground', name: 'Drawn simulated plan', floor_id: 'ground',
    polygon: [[-5, -4], [5, -4], [5, 4], [-5, 4]], doors: [] },
    { id: 'gps-upper', name: 'Drawn simulated upper', floor_id: 'upper',
      polygon: [[-5, -4], [5, -4], [5, 4], [-5, 4]], doors: [] }],
  pins: {}, hidden: [], objects: {}, groups: {}, mower: {}, presence_bindings: [], vehicle_bindings: [],
  vacuum_bindings: [{ id: 'imported-north-up', entity: gpsEntities.imported, kind: 'xy', label: 'Imported explicit north-up', position,
    position_source: { source: 'gps', entity: gpsEntities.position, floorId: 'ground', north_up: true,
      units: 'legacy-imported-unit', plan_meters: true, calibration: [{ src: [51.5, -.1], plan: [-2, 1], annotation: { keep: 'raw pair' } }],
      future_source: { retain: ['α', null, false] } }, future_binding: 'retain imported binding' },
    { id: 'repair-exact', entity: gpsEntities.repair, kind: 'xy', label: 'Exact missing links', position,
      position_source: { source: 'gps', entity: 'sensor.gps_removed', floorId: 'removed-floor',
        latitude_attr: 'measured.latitude', longitude_attr: 'measured.longitude',
        calibration: [{ src: [51.5, -.1], plan: [1, -1], annotation: { keep: true } },
          { src: [51.50001, -.1], plan: [1, 0] }], future_source: { retain: true } }, future_binding: ['raw', false] }],
  alert_bindings: [], security_bindings: [], furniture: { instances: [] }, ambient_idle: { enabled: false },
  weather: { enabled: false }, scene_previews: { enabled: false }, room_overlays: { mode: 'off' },
  extension: { fixture: 'Explicit simulation; no household GPS or persistence certification' } };
}

// Standalone page.evaluate function. Only the HA boundary and diagnostics below
// are fixtures. No editor method or plan acceptance handler is substituted.
export async function prepareGPSCalibrationFixture({ layout, readings, entities, key }) {
  const c = document.querySelector('taylors3d-card'), connection = new EventTarget();
  connection.connected = true; connection.options = { auth: {} };
  const auth = {}, user = { id: 'simulated-gps-admin', is_admin: true, is_active: true, name: 'Simulated administrator' };
  const f = window.gpsFixture = { saved: structuredClone(layout), services: [], ws: [], commits: [], pointerUps: [], entities };
  const callWS = async (message) => {
    f.ws.push(structuredClone(message));
    if (message.type === 'taylors3d/layout/get') return { layout: structuredClone(f.saved) };
    if (message.type === 'taylors3d/layout/set') { f.saved = structuredClone(message.layout); return { success: true }; }
    if (message.type === 'frontend/get_user_data') return { value: null };
    if (message.type === 'config/entity_registry/list') return Object.values(c._hass.entities);
    if (message.type === 'config/device_registry/list') return [];
    if (message.type === 'config/area_registry/list') return Object.values(c._hass.areas);
    if (message.type === 'config/floor_registry/list') return Object.values(c._hass.floors);
    throw new Error('Explicitly unimplemented simulated GPS WS: ' + message.type);
  };
  c.setConfig({ type: 'custom:taylors3d-card', layout_key: key, height: '900px', view: 'top', floor: 'ground',
    sky_bodies: false, mini_map: false, lights: 'off', ambient_idle: { enabled: false },
    layout_style: 'house', house_colour_scheme: 'dark', control_panel: 'right' });
  c.hass = { user, auth, connection, language: 'en', locale: { language: 'en', number_format: 'language', time_format: '24' },
    config: { location_name: 'Explicit simulated GPS bench', time_zone: 'Europe/London', latitude: null, longitude: null },
    callService: (...args) => { f.services.push(structuredClone(args)); return Promise.resolve(); }, callWS,
    states: structuredClone(readings), services: { vacuum: { start: {}, pause: {}, stop: {}, return_to_base: {} } },
    floors: { ground: { floor_id: 'ground', name: 'Simulated ground', level: 0 }, upper: { floor_id: 'upper', name: 'Simulated upper', level: 1 } },
    areas: {}, devices: {}, entities: Object.fromEntries(Object.values(entities).map((id) => [id,
      { entity_id: id, hidden: false, disabled_by: null, entity_category: null, device_id: null, area_id: null }])) };
  await c._layoutReady; c._setView('ground', { instant: true }); c._setMode('top'); c.resetHistory();
  f.renderer = c._view.renderer; f.initialTrackingTimer = c._trackingTimer; f.original = structuredClone(c._layout);
  const commit = c.commitFeatureLayout.bind(c);
  c.commitFeatureLayout = (patch) => { f.commits.push(structuredClone(patch)); return commit(patch); };
  f.reading = (raw, entity = entities.position) => {
    const old = c._hass.states[entity]; c.hass = { ...c._hass, states: { ...c._hass.states, [entity]: { ...old,
      last_updated: new Date().toISOString(), attributes: { ...old.attributes, latitude: raw[0], longitude: raw[1],
        measured: { latitude: raw[0], longitude: raw[1] } } } } };
  };
  f.locale = (language) => { c.hass = { ...c._hass, language, locale: { ...c._hass.locale, language } }; };
  // Real Root setter sees both the loss and recovery, including in-place loss.
  f.pulse = (kind) => {
    const old = c._hass, entity = c._edit?._trackingEditor?.draft?.position_source?.entity || entities.position;
    if (kind === 'connection') { connection.connected = false; c.hass = { ...old }; connection.connected = true; c.hass = { ...old }; }
    if (kind === 'role') { old.user.is_admin = false; c.hass = { ...old }; old.user.is_admin = true; c.hass = { ...old }; }
    if (kind === 'session') { c.hass = { ...old, auth: {}, connection: Object.assign(new EventTarget(), { connected: true, options: { auth: {} } }) }; c.hass = { ...old }; }
    if (kind === 'source') { c.hass = { ...old, states: { ...old.states, [entity]: { ...old.states[entity], state: 'unavailable' } } }; c.hass = { ...old }; }
    if (kind === 'floor') {
      const before = structuredClone(c._layout), floorId = c._edit?._trackingEditor?.draft?.position_source?.floorId;
      c.hass = { ...old, floors: Object.fromEntries(Object.entries(old.floors).filter(([id]) => id !== floorId)) };
      c._commit({ ...c._layout, floors: c._layout.floors.filter((floor) => floor.id !== floorId) });
      c.hass = { ...old }; c._commit(before);
    }
  };
  c._view.renderer.domElement.addEventListener('pointerup', (event) => {
    const pending = c._edit?._trackingEditor?.pendingPlanPick;
    f.pointerUps.push({ token: pending?.token || null, plan: pending
      ? c._view.planPoint(event.clientX, event.clientY, c._view.floorElevation(pending.floorId)) : null });
  }, true);
}

export function gpsCalibrationHtml(mode) {
  if (!['source', 'bundle'].includes(mode)) throw new Error('Unknown GPS fixture mode');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Simulated native GPS calibration proof</title><link rel="icon" href="data:,">
  <script type="importmap">${JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } })}</script>
  <style>body{margin:0;padding:8px;font:14px system-ui;background:#dde5ec;color:#162833}main{max-width:1400px;width:100%}p{overflow-wrap:anywhere}
  taylors3d-card{display:block;width:100%;--card-background-color:#fff;--secondary-background-color:#f4f4f4;--primary-text-color:#212121;
  --secondary-text-color:#595959;--primary-color:#007c70;--divider-color:#777;--text-primary-color:#fff}</style></head>
  <body><p>SIMULATED GPS readings, drawn plan and HA storage · actual card, editor and renderer · no household or server persistence certification</p>
  <main><taylors3d-card></taylors3d-card></main><script type="module">
  class FixtureIcon extends HTMLElement{}if(!customElements.get('ha-icon'))customElements.define('ha-icon',FixtureIcon);
  await import('/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js');window.gpsModuleReady=true;
  </script></body></html>`;
}

export async function serveGPSCalibrationFixture(root, mode) {
  const layout = gpsCalibrationLayout(), readings = gpsCalibrationReadings(), requests = [], unexpected = [];
  const page = gpsCalibrationHtml(mode), types = { '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture'); requests.push({ path: url.pathname, method: request.method });
    const send = (status, type, bytes) => { response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); response.end(bytes); };
    if (request.method !== 'GET') { unexpected.push(request.method + ' ' + url.pathname); return send(405, 'text/plain', 'Read-only simulated fixture server'); }
    if (url.pathname === '/demo/gps-calibration-fixture.html') return send(200, 'text/html', page);
    if (url.pathname === '/api/taylors3d/furniture') return send(200, 'application/json', JSON.stringify({ version: 1, packs: [] }));
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      unexpected.push(url.pathname); return send(404, 'text/plain', 'Unregistered fixture route');
    }
    response.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' }); fs.createReadStream(filename).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { layout, readings, requests, unexpected, base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }) };
}
