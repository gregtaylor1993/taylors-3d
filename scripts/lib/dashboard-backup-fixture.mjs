// Labelled transport stand-in for the real browser card/clients. This is NOT
// Home Assistant middleware, ZIP validation, persistence or Linux server proof.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => Buffer.from(JSON.stringify(value));
const clone = (value) => structuredClone(value);
const sourcePath = 'dashboard-native-source';
const resources = { mode: 'storage', items: [{ id: 'unchanged-resource', type: 'module',
  url: 'https://unfetched.example.invalid/other-card.js', extension: { exact: true } }] };

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A real small, stored ZIP gives uploadFile and the binary transport real bytes.
// The simulated inspect reply below is deliberately not a server validator.
function storedZip(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name), body = Buffer.isBuffer(content) ? content : json(content), crc = crc32(body);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, body);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42); central.push(entry, filename); offset += header.length + filename.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function dashboardBackupFixture() {
  const dashboard = { title: 'Simulated complete selected dashboard', extension: { untouched: ['α', 0, false, null] }, views: [
    { title: 'Original mixed view', path: 'original-view', cards: [
      { type: 'custom:taylors3d-card', layout_key: 'home', original_entity: 'light.exact_original' },
      { type: 'custom:untrusted-backup-native', content: '<img src="/fixture-unexpected-fetch" onerror="window.backupInjected=1"><script>window.backupInjected=1</script>',
        unknown: { do_not_normalise: true, entity: 'sensor.original_missing_id' } },
      { type: 'entities', entities: ['person.original_exact', { entity: 'sensor.original_exact', name: 'My own saved name' }] } ] },
    { title: 'Original sections view', type: 'sections', sections: [{ type: 'grid', cards: [
      { type: 'conditional', conditions: [{ entity: 'input_boolean.original_condition', state: 'on' }],
        card: { type: 'custom:taylors3d-card', layout_key: 'home', unknown_card_property: [1, 2] } },
      { type: 'markdown', content: 'Other cards remain raw and are never instantiated by inspection.' } ] }] } ] };
  const layout = { version: 1, floors: [{ id: 'ground', name: 'Source ground', elevation: 0, height: 3 }],
    rooms: [{ id: 'room', floor_id: 'ground', name: 'Source room', polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] }],
    pins: {}, hidden: [], extension: { original: 'Raw Taylor layout', untouched: [false, null, 'é'] } };
  const pointers = ['/views/0/cards/0', '/views/1/sections/0/cards/0/card'];
  const diagnostic = { code: 'external_dependency', path: '/resources/items/0', severity: 'dependency',
    message: 'This simulated archive declares an external custom-card script. It has not been fetched or installed.' };
  const layoutMember = 'layouts/' + sha256(Buffer.from('home')) + '.json';
  const layoutBytes = json({ backend: 'shared', metadata: { source: 'simulated exact shared key', normalized: false }, layout });
  const dashboardBytes = json(dashboard);
  const manifest = { format: 'taylors3d-dashboard-backup', version: 1, complete: false,
    source: { url_path: sourcePath, mode: 'storage', provenance: 'simulated official selected source' }, resources: clone(resources),
    cards: pointers.map((pointer) => ({ pointer, layout_key: 'home' })),
    layouts: [{ key: 'home', member: layoutMember, sha256: sha256(layoutBytes) }], models: [], furniture: [] };
  const archive = storedZip({ 'manifest.json': manifest, 'dashboard.json': dashboardBytes, [layoutMember]: layoutBytes });
  const inspection = { manifest, report: { complete: false, dependencyFree: false, diagnostics: [diagnostic],
    counts: { cards: 2, layouts: 1, models: 0, furniture_packs: 0, members: 3 }, expanded_bytes: archive.length,
    nested_expanded_bytes: 0, verified_expanded_bytes: archive.length },
    preview: { dashboard: clone(dashboard), layouts: { home: { backend: 'shared', metadata: { source: 'simulated shared' }, layout: clone(layout) } } }, restoreAvailable: false };
  return { sourcePath, dashboard, layout, resources: clone(resources), pointers, archive, archiveSha256: sha256(archive), inspection };
}

// A second scenario keeps archive assets complete while the target home has
// missing IDs. Completeness is supplied by the simulated server, never inferred
// from current HA readings or silently changed by the reference report.
export function dashboardBackupEnvironmentFixture() {
  const dashboard = { title: 'Simulated complete archive with target reference warnings', views: [
    { title: 'Known saved references', cards: [
      { type: 'custom:taylors3d-card', layout_key: 'home' },
      { type: 'entities', entities: ['novel_native.current', 'sensor.environment_unavailable', 'scene.environment_existing'] },
      { type: 'button', entity: 'scene.environment_missing', tap_action: { action: 'perform-action', perform_action: 'scene.turn_on',
        target: { entity_id: 'scene.environment_missing', area_id: 'area_environment_missing', floor_id: 'floor_environment_missing' } } },
      { type: 'custom:opaque-backup-reference', unknown: { entity: 'sensor.opaque_not_inferred', exact: ['α', false, null] } } ] },
    { title: 'Second Taylor card', cards: [{ type: 'custom:taylors3d-card', layout_key: 'home' }] } ] };
  const layout = { version: 1, floors: [{ id: 'ground', name: 'Saved ground', elevation: 0, height: 3 }],
    rooms: [{ id: 'room', floor_id: 'ground', name: 'Saved room', polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] }], pins: {}, hidden: [],
    room_actions: { version: 1, rooms: [{ room_id: 'room', actions: [{ id: 'missing-scene', entity: 'scene.environment_missing' },
      { id: 'existing-scene', entity: 'scene.environment_existing' }] }] } };
  const pointers = ['/views/0/cards/0', '/views/1/cards/0'], declaredResources = { mode: 'storage', items: [] };
  const layoutMember = 'layouts/' + sha256(Buffer.from('home')) + '.json';
  const layoutBytes = json({ backend: 'shared', metadata: { source: 'simulated exact shared key', normalized: false }, layout });
  const manifest = { format: 'taylors3d-dashboard-backup', version: 1, complete: true,
    source: { url_path: sourcePath, mode: 'storage', provenance: 'simulated official selected source' }, resources: clone(declaredResources),
    cards: pointers.map((pointer) => ({ pointer, layout_key: 'home' })),
    layouts: [{ key: 'home', member: layoutMember, sha256: sha256(layoutBytes) }], models: [], furniture: [] };
  const archive = storedZip({ 'manifest.json': manifest, 'dashboard.json': dashboard, [layoutMember]: layoutBytes });
  const inspection = { manifest, report: { complete: true, dependencyFree: true, diagnostics: [],
    counts: { cards: 2, layouts: 1, models: 0, furniture_packs: 0, members: 3 }, expanded_bytes: archive.length,
    nested_expanded_bytes: 0, verified_expanded_bytes: archive.length },
    preview: { dashboard: clone(dashboard), layouts: { home: { backend: 'shared', metadata: { source: 'simulated shared' }, layout: clone(layout) } } }, restoreAvailable: false };
  const target = { states: { 'novel_native.current': { state: 'ready', attributes: { friendly_name: 'Actual simulated new domain' } },
    'sensor.environment_unavailable': { state: 'unavailable', attributes: {} }, 'scene.environment_existing': { state: 'unknown', attributes: {} } },
    entities: { 'novel_native.current': { entity_id: 'novel_native.current' },
      'sensor.environment_unavailable': { entity_id: 'sensor.environment_unavailable', hidden_by: 'user' },
      'scene.environment_existing': { entity_id: 'scene.environment_existing' } },
    areas: {}, floors: { ground: { floor_id: 'ground', name: 'Current ground', level: 0 } }, devices: {} };
  return { sourcePath, dashboard, layout, resources: declaredResources, pointers, archive, archiveSha256: sha256(archive), inspection, target };
}

export function stagedDashboardBackup(fixture, namespace, allowIncomplete = false) {
  const prefix = `restore_${namespace}_`, newKey = prefix + 'f'.repeat(64 - prefix.length), urlPath = `taylors3d-restore-${namespace}`;
  const config = clone(fixture.dashboard);
  for (const pointer of fixture.pointers) {
    const keys = pointer.split('/').slice(1); let card = config;
    for (const key of keys) card = card[key]; card.layout_key = newKey;
  }
  const hash = sha256(json(fixture.layout));
  return { ok: true, namespace, restore_id: 'b'.repeat(32), target_dashboard: { url_path: urlPath, mode: 'storage', title: `Simulated copy ${namespace}` },
    save_message: { id: 1, type: 'lovelace/config/save', url_path: urlPath, config }, resources: clone(fixture.resources),
    report: { valid: true, complete: fixture.inspection.report.complete, archive_complete: fixture.inspection.report.complete, allow_incomplete: allowIncomplete, publication_available: false,
      resources_installed: false, requires_current_admin_at_publication: true, requires_shared_integration: true,
      diagnostics: clone(fixture.inspection.report.diagnostics), collision_checked: { internal: true, external: false },
      counts: { cards: 2, layouts: 1, models: 0, furniture_packs: 0 }, collision_targets: { dashboard_url_path: urlPath,
        layout_keys: [newKey], model_keys: [], legacy_fallback_keys: ['taylors3d_' + newKey] } },
    staging: { models: [], layouts: [{ target_key: newKey, original_sha256: hash, staged_json_sha256: hash, persistence: 'scheduled_not_durable' }],
      furniture: [], unavailable: [], integrity_verified: true, integrity_scope: 'present_assets_and_populated_shared_layouts',
      layouts_persistence: 'scheduled_not_durable', dashboard_created: false, resources_installed: false,
      collision_evidence: { dashboard: 'absent_at_check', user_fallbacks: 'all_current_users_absent_at_check',
        browser: 'not_read;unchanged_and_shadowed_by_populated_shared_layouts', transaction: false } }, orphans: [] };
}

function fixtureHtml(mode) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Simulated whole dashboard backup browser proof</title><link rel="icon" href="data:,">
  <script type="importmap">${JSON.stringify({ imports: { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' } })}</script>
  <style>body{margin:0;padding:12px;font:14px system-ui;background:#e9eef2;color:#172833}main{width:100%;max-width:1200px}
  .notice{margin:0 0 12px;max-width:1200px}taylors3d-card{display:block;width:100%;--card-background-color:#fff;--secondary-background-color:#f4f4f4;
  --primary-text-color:#212121;--secondary-text-color:#595959;--primary-color:#007c70;--divider-color:#777;--text-primary-color:#fff}</style></head><body>
  <p class="notice">SIMULATED Home Assistant WS/HTTP replies · actual card, native file controls and clients · no real home, server archive validation or saved dashboard proof</p>
  <main><taylors3d-card></taylors3d-card></main><script type="module">
  import '/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js';
  class FixtureIcon extends HTMLElement{static get observedAttributes(){return ['icon'];}attributeChangedCallback(){this.textContent='';}}
  if(!customElements.get('ha-icon'))customElements.define('ha-icon',FixtureIcon);
  class UntrustedCard extends HTMLElement{constructor(){super();window.backupUntrustedConstructed=(window.backupUntrustedConstructed||0)+1;}}
  customElements.define('untrusted-backup-native',UntrustedCard);window.backupModuleReady=true;
  </script></body></html>`;
}

const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export async function serveDashboardBackupFixture(root, mode, { environment = false } = {}) {
  if (!['source', 'bundle'].includes(mode)) throw new Error('Unknown fixture source mode');
  const fixture = environment ? dashboardBackupEnvironmentFixture() : dashboardBackupFixture(), requests = [], pending = new Set();
  const state = { exports: [], inspections: [], stages: [], headerLimit: false, malformedInspection: false, holdStage: false, unexpected: [] };
  const send = (response, status, type, bytes, headers = {}) => { response.writeHead(status, { 'content-type': type,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...headers }); response.end(bytes); };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture'), pathname = url.pathname;
    const row = { pathname, method: request.method, authorization: request.headers.authorization ?? null }; requests.push(row);
    if (pathname.startsWith('/api/taylors3d/dashboard_backup/')) {
      if (request.method !== 'POST' || request.headers.authorization !== 'Bearer simulated-dashboard-backup') { send(response, 401, 'application/json', '{}'); return; }
      const parts = []; let size = 0;
      try { for await (const part of request) { size += part.length; if (size > 4 * 1024 * 1024) throw new Error('Fixture body limit'); parts.push(part); } }
      catch { if (!response.destroyed) send(response, 400, 'application/json', '{}'); return; }
      const body = Buffer.concat(parts); row.bytes = size; row.sha256 = sha256(body);
      if (pathname.endsWith('/export')) {
        let payload; try { payload = JSON.parse(body); } catch { send(response, 400, 'application/json', '{}'); return; }
        state.exports.push(payload); send(response, 200, 'application/zip', fixture.archive,
          { 'content-length': String(state.headerLimit ? 512 * 1024 * 1024 + 1 : fixture.archive.length), 'x-taylors3d-complete': String(fixture.inspection.report.complete) }); return;
      }
      const exact = body.equals(fixture.archive);
      if (pathname.endsWith('/inspect')) {
        state.inspections.push({ exact, bytes: size, sha256: sha256(body) });
        if (!exact) { send(response, 400, 'application/json', json({ diagnostics: [{ code: 'zip', path: '', message: 'Simulated fixture ZIP rejected', severity: 'missing' }] })); return; }
        send(response, 200, 'application/json', json(state.malformedInspection ? { ...fixture.inspection, report: null } : fixture.inspection)); return;
      }
      if (pathname.startsWith('/api/taylors3d/dashboard_backup/stage/')) {
        const namespace = pathname.split('/').at(-1), allow = url.searchParams.get('allow_incomplete');
        if (!exact || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(namespace) || !['0', '1'].includes(allow)) { send(response, 400, 'application/json', '{}'); return; }
        state.stages.push({ namespace, allow, exact, sha256: sha256(body) });
        if (state.holdStage) await new Promise((resolve) => { pending.add(resolve); response.once('close', () => { pending.delete(resolve); resolve(); }); });
        if (!response.destroyed) send(response, 200, 'application/json', json(stagedDashboardBackup(fixture, namespace, allow === '1'))); return;
      }
      state.unexpected.push(row); send(response, 404, 'application/json', '{}'); return;
    }
    if (pathname === '/demo/dashboard-backup-fixture.html') { send(response, 200, 'text/html', fixtureHtml(mode)); return; }
    if (pathname === '/fixture-unexpected-fetch') { state.unexpected.push(row); send(response, 404, 'text/plain', 'Must never be requested by static preview'); return; }
    const absolute = path.resolve(root, '.' + pathname);
    if (absolute !== root && !absolute.startsWith(root + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) { send(response, 404, 'text/plain', 'Not found'); return; }
    response.writeHead(200, { 'content-type': types[path.extname(absolute)] ?? 'application/octet-stream' }); fs.createReadStream(absolute).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const release = () => { state.holdStage = false; for (const resolve of pending) resolve(); pending.clear(); };
  return { fixture, state, requests, release, base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { release(); await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }); } };
}
