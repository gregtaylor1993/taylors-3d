import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { FurnitureCoordinator } from '../src/furniture-coordinator.js';
import { FurnitureLibraryClient } from '../src/furniture-library.js';
import { FurnitureEditor } from '../src/furniture-editor.js';

// The real library client, native File/Response streams, original ZIP/GLB bytes
// and hashing are used. Only the HA HTTP transport is simulated. Backend archive
// validation and renderer decoding have their own independent suites.
const BASE = '/api/taylors3d/furniture', utf8 = (value) => new TextEncoder().encode(value), owners = [];
const hash = (value) => createHash('sha256').update(value).digest('hex'), copy = (value) => structuredClone(value);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function zip(files) {
  const chunks = [], directory = []; let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    let crc = 0xffffffff; for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const path = utf8(name), local = new Uint8Array(30 + path.length), central = new Uint8Array(46 + path.length), a = new DataView(local.buffer), b = new DataView(central.buffer);
    a.setUint32(0, 0x04034b50, true); a.setUint16(4, 20, true); a.setUint16(6, 0x800, true); a.setUint32(14, crc, true);
    a.setUint32(18, body.length, true); a.setUint32(22, body.length, true); a.setUint16(26, path.length, true); local.set(path, 30);
    b.setUint32(0, 0x02014b50, true); b.setUint16(4, 20, true); b.setUint16(6, 20, true); b.setUint16(8, 0x800, true); b.setUint32(16, crc, true);
    b.setUint32(20, body.length, true); b.setUint32(24, body.length, true); b.setUint16(28, path.length, true); b.setUint32(42, offset, true); central.set(path, 46);
    chunks.push(local, body); directory.push(central); offset += local.length + body.length;
  }
  const length = directory.reduce((total, item) => total + item.length, 0), end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, directory.length, true); view.setUint16(10, directory.length, true);
  view.setUint32(12, length, true); view.setUint32(16, offset, true); const result = new Uint8Array(offset + length + 22); let position = 0;
  for (const bytes of [...chunks, ...directory, end]) { result.set(bytes, position); position += bytes.length; } return result;
}
function fixture() {
  const definition = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] };
  const encoded = utf8(JSON.stringify(definition)), padded = new Uint8Array(Math.ceil(encoded.length / 4) * 4); padded.fill(32); padded.set(encoded);
  const glb = new Uint8Array(28 + padded.length + 36), header = new DataView(glb.buffer); header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true);
  header.setUint32(8, glb.length, true); header.setUint32(12, padded.length, true); header.setUint32(16, 0x4e4f534a, true); glb.set(padded, 20);
  const start = 20 + padded.length; header.setUint32(start, 36, true); header.setUint32(start + 4, 0x004e4942, true);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => header.setFloat32(start + 8 + index * 4, value, true));
  const license = { id: 'MIT', file: 'LICENSE.txt', text: 'MIT original test furniture credit.\n', sha256: hash(utf8('MIT original test furniture credit.\n')) };
  const manifest = { version: 1, id: 'original-coordinator-fixture', name: 'Original coordinator furniture', author: 'Test author', license: { id: 'MIT', file: 'LICENSE.txt' },
    items: [{ id: 'triangle', name: 'Original triangle', file: 'triangle.glb', unit: 'm', anchor: [0, 0, 0], preserved: { credit: 'Author' } }] };
  const files = { 'pack.json': utf8(JSON.stringify(manifest)), 'triangle.glb': glb, 'LICENSE.txt': utf8(license.text) }, archive = zip(files), packId = hash(archive);
  const stats = { nodes: 1, meshes: 1, mesh_uses: 1, primitives: 1, triangles: 1, source_triangles: 1, materials: 0, textures: 0, images: [], texture_pixels: 0 };
  const pack = { pack_id: packId, logical_sha256: hash(utf8(JSON.stringify(manifest))), archive_bytes: archive.length, manifest,
    license: copy(license), licenses: { 'LICENSE.txt': license }, download_url: `${BASE}/packs/${packId}.zip`,
    items: [{ ...copy(manifest.items[0]), metadata: copy(manifest.items[0]), sha256: hash(glb), pack_id: packId, asset_url: `${BASE}/assets/${hash(glb)}.glb`, stats, license: copy(license) }],
    stats: { archive_bytes: archive.length, expanded_bytes: Object.values(files).reduce((total, body) => total + body.length, 0), members: 3,
      items: 1, unique_assets: 1, asset_bytes: glb.length, triangles: 1, texture_pixels: 0 } };
  return { pack, archive, glb, file: new File([archive], 'original.zip', { type: 'application/zip' }), catalogue: { version: 1, packs: [pack], future: { retained: true } } };
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };
function setup({ empty = false } = {}) {
  const f = fixture(), connection = Object.assign(new EventTarget(), { connected: true }), onChange = vi.fn(), h = { f, catalogue: empty ? { version: 1, packs: [] } : f.catalogue };
  h.transport = async (url, options) => json(options?.method === 'POST' ? { imported: true, pack: f.pack } : h.catalogue);
  const fetch = vi.fn((...args) => h.transport(...args)), card = { isConnected: true, _loading: false, _layout: {}, _config: { layout_key: 'house' }, _editing: true,
    _edit: { tab: 'furniture' }, _hass: { user: { id: 'taylor', is_admin: true, is_active: true }, auth: {}, connection, fetchWithAuth: fetch,
      callService: vi.fn(), callWS: vi.fn() }, furnitureEditorAvailable: () => true, furnitureImportAvailable: () => !h.dirty };
  const coordinator = new FurnitureCoordinator(card, { onChange }); owners.push(coordinator);
  const raw = () => ({ version: 1, instances: [{ id: 'one', pack_id: f.pack.pack_id, item_id: f.pack.items[0].id, asset_sha256: f.pack.items[0].sha256,
    floor_id: 'ground', x: 1, y: 2, z: 0.5, preserved: { credit: 'Author' } }] });
  Object.assign(h, { card, coordinator, connection, fetch, onChange, raw }); onChange.mockClear(); return h;
}
afterEach(() => { owners.splice(0).forEach((coordinator) => coordinator.dispose()); vi.restoreAllMocks(); });

describe('explicit current catalogue composition', () => {
  it('owns the real stable client but never fetches on construction, sync, snapshots or unrelated updates', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout'), interval = vi.spyOn(globalThis, 'setInterval');
    const h = setup(), client = h.coordinator.client, generation = h.coordinator.generation;
    expect(client).toBeInstanceOf(FurnitureLibraryClient); expect(h.coordinator.catalogueSnapshot()).toMatchObject({ status: 'unavailable', catalogue: null });
    for (let i = 0; i < 20; i++) { h.card._hass = { ...h.card._hass, states: { 'sensor.other': { state: String(i) } } }; h.coordinator.sync(); h.coordinator.catalogueSnapshot(); }
    expect(h.coordinator.client).toBe(client); expect(h.coordinator.generation).toBe(generation); expect(h.fetch).not.toHaveBeenCalled();
    expect(h.onChange).not.toHaveBeenCalled(); expect(h.card._hass.callService).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled(); expect(interval).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent refresh and publishes only the actual validated defensive metadata', async () => {
    const h = setup(), gate = deferred(); h.transport = () => gate.promise;
    const first = h.coordinator.refresh(), second = h.coordinator.refresh(); expect(second).toBe(first);
    expect(h.coordinator.catalogueSnapshot().status).toBe('loading'); await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1)); gate.resolve(json(h.catalogue));
    const result = await first; expect(result.ok).toBe(true); expect(h.coordinator.catalogueSnapshot()).toMatchObject({ status: 'ready', catalogue: h.catalogue, refreshing: false });
    const snapshot = h.coordinator.catalogueSnapshot(); snapshot.catalogue.packs[0].license.text = 'caller change'; result.catalogue.packs.splice(0);
    expect(h.coordinator.catalogueSnapshot().catalogue).toEqual(h.catalogue); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('permits actual nonadministrator catalogue reading, but denies import and draft previews', async () => {
    const h = setup(); h.card._hass.user.is_admin = false; h.coordinator.sync(); expect((await h.coordinator.refresh()).ok).toBe(true);
    expect((await h.coordinator.importPack(h.f.file)).ok).toBe(false); expect(h.coordinator.previewDraft(h.raw())).toBe(false); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('reports a fixed refresh error without automatic retries; a deliberate new refresh can recover', async () => {
    const h = setup(); h.transport = () => json({ secret: 'never print server content' }, 500);
    expect((await h.coordinator.refresh()).ok).toBe(false); expect(h.coordinator.catalogueSnapshot()).toMatchObject({ status: 'error', catalogue: null });
    expect(JSON.stringify(h.coordinator.catalogueSnapshot())).not.toContain('secret'); for (let i = 0; i < 10; i++) h.coordinator.sync(); expect(h.fetch).toHaveBeenCalledTimes(1);
    h.transport = () => json(h.catalogue); expect((await h.coordinator.refresh()).ok).toBe(true); expect(h.fetch).toHaveBeenCalledTimes(2);
  });
  it('retains an existing current catalogue during explicit refresh and a same-key raw layout Save, while poisoning the old operation', async () => {
    const h = setup(); await h.coordinator.refresh(); const client = h.coordinator.client, generation = client.generation, gate = deferred(); h.transport = () => gate.promise;
    const old = h.coordinator.refresh(); await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2)); expect(h.coordinator.catalogueSnapshot().status).toBe('ready');
    h.card._layout = { retained: 'new saved layout' }; h.coordinator.sync(); expect(h.coordinator.client).toBe(client); expect(client.generation).toBe(generation);
    expect(h.coordinator.catalogueSnapshot().catalogue).toEqual(h.catalogue); gate.resolve(json({ version: 1, packs: [] })); expect((await old).ok).toBe(false);
    expect(h.coordinator.catalogueSnapshot().catalogue).toEqual(h.catalogue);
  });
});

describe('scope poisoning and current preview ownership', () => {
  const changes = [
    ['disconnect', (h) => { h.card.isConnected = false; }], ['connection loss', (h) => { h.connection.connected = false; }],
    ['new connection', (h) => { h.card._hass.connection = Object.assign(new EventTarget(), { connected: true }); }],
    ['new auth object', (h) => { h.card._hass.auth = {}; }], ['new account', (h) => { h.card._hass.user = { ...h.card._hass.user }; }],
    ['inactive account', (h) => { h.card._hass.user.is_active = false; }], ['permission revision', (h) => { h.card._hass.user.permissions = { control: false }; }],
    ['layout loading', (h) => { h.card._loading = true; }], ['absent layout', (h) => { h.card._layout = null; }],
    ['layout key', (h) => { h.card._config.layout_key = 'another'; }],
  ];
  it.each(changes)('prevents an old %s catalogue result or preview from entering the new scope', async (name, change) => {
    const h = setup(), gate = deferred(); h.transport = () => gate.promise; const pending = h.coordinator.refresh();
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1)); expect(h.coordinator.previewDraft(h.raw())).toBe(true);
    const client = h.coordinator.client, before = client.generation; change(h); h.coordinator.sync();
    expect(h.coordinator.preview).toBeNull(); expect(h.coordinator.client).toBe(client); expect(client.generation).toBeGreaterThan(before);
    gate.resolve(json(h.catalogue)); expect((await pending).ok).toBe(false); expect(h.coordinator.catalogueSnapshot().catalogue).toBeNull();
  });
  it('latches observed connection loss through recovery and allows only a new deliberate refresh', async () => {
    const h = setup(), old = deferred(); h.transport = () => old.promise; const pending = h.coordinator.refresh();
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1)); h.connection.connected = false; h.coordinator.sync(); h.connection.connected = true; h.coordinator.sync();
    old.resolve(json(h.catalogue)); expect((await pending).ok).toBe(false); expect(h.coordinator.catalogueSnapshot().catalogue).toBeNull();
    h.transport = () => json(h.catalogue); expect((await h.coordinator.refresh()).ok).toBe(true); expect(h.fetch).toHaveBeenCalledTimes(2);
  });
  it('observes the real client disconnected event even before card fields catch up', async () => {
    const h = setup(); await h.coordinator.refresh(); const generation = h.coordinator.generation;
    expect(h.coordinator.previewDraft(h.raw())).toBe(true); h.connection.dispatchEvent(new Event('disconnected')); h.coordinator.sync();
    expect(h.coordinator.generation).toBeGreaterThan(generation); expect(h.coordinator.preview).toBeNull(); expect(h.coordinator.catalogueSnapshot().catalogue).toBeNull();
  });
  it('auth-object invalidation also poisons actual asset work held by a layer using the same public client', async () => {
    const h = setup(); await h.coordinator.refresh(); const gate = deferred(); h.transport = () => gate.promise;
    const client = h.coordinator.client, pending = client.asset(h.f.pack.items[0]); await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    h.card._hass.auth = {}; h.coordinator.sync(); expect(h.coordinator.client).toBe(client);
    gate.resolve(new Response(h.f.glb, { headers: { 'content-type': 'model/gltf-binary' } }));
    expect(await pending).toMatchObject({ ok: false, bytes: null, diagnostics: [{ code: 'stale' }] });
    expect(h.coordinator.catalogueSnapshot().catalogue).toBeNull();
  });
  it.each([undefined, null, [], false].map((value) => ({ value })))('denies a missing/nonplain layout $value without trusting editor hooks', async ({ value }) => {
    const h = setup(); h.card._layout = value; h.coordinator.sync();
    expect((await h.coordinator.refresh()).ok).toBe(false); expect((await h.coordinator.importPack(h.f.file)).ok).toBe(false);
    expect(h.coordinator.previewDraft(h.raw())).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('cannot reactivate a preview or import when the public actual client is closed', async () => {
    const h = setup(); h.coordinator.client.dispose(); expect(h.coordinator.sync()).toBe(false);
    expect(h.coordinator.previewDraft(h.raw())).toBe(false); expect((await h.coordinator.importPack(h.f.file)).ok).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('keeps defensive preview copies and equal drafts idle, then clears on editor exit without touching raw layout', () => {
    const h = setup(), raw = h.raw(), before = copy(h.card._layout); expect(h.coordinator.previewDraft(raw)).toBe(true);
    const calls = h.onChange.mock.calls.length; expect(h.coordinator.previewDraft(copy(raw))).toBe(true); expect(h.onChange).toHaveBeenCalledTimes(calls);
    raw.instances[0].x = 12; const preview = h.coordinator.preview; preview.instances[0].x = 99;
    expect(h.coordinator.preview.instances[0].x).toBe(1); h.card._edit.tab = 'rooms'; h.coordinator.sync(); expect(h.coordinator.preview).toBeNull();
    expect(h.card._layout).toEqual(before); expect(h.card._hass.callService).not.toHaveBeenCalled(); expect(h.card._hass.callWS).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { version: '1', instances: [] }, { version: 1, instances: [null] }].map((raw) => ({ raw })))('rejects malformed draft $raw without creating a replacement', ({ raw }) => {
    const h = setup(); expect(h.coordinator.previewDraft(raw)).toBe(false); expect(h.coordinator.preview).toBeNull(); expect(h.onChange).not.toHaveBeenCalled();
  });
  it('clears a preview when the basic editor hook revokes access, even through recovery', () => {
    const h = setup(); h.coordinator.previewDraft(h.raw()); h.card.furnitureEditorAvailable = () => false; h.coordinator.sync();
    h.card.furnitureEditorAvailable = () => true; h.coordinator.sync(); expect(h.coordinator.preview).toBeNull();
  });
});

describe('explicit import publishes a freshly validated catalogue before editor completion', () => {
  it('waits for post-import catalogue publication and blocks duplicate import while allowing the real editor pending flag', async () => {
    const h = setup({ empty: true }), get = deferred();
    h.transport = (url, options) => options?.method === 'POST' ? json({ imported: true, pack: h.f.pack }) : get.promise;
    const pending = h.coordinator.importPack(h.f.file); expect(h.coordinator.importing).toBe(true);
    expect((await h.coordinator.importPack(h.f.file)).diagnostics[0].code).toBe('pending');
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2)); let resolved = false; pending.then(() => { resolved = true; });
    await Promise.resolve(); expect(resolved).toBe(false); expect(h.coordinator.catalogueSnapshot().catalogue).toBeNull();
    get.resolve(json(h.f.catalogue)); const result = await pending;
    expect(result).toMatchObject({ ok: true, imported: true, pack: h.f.pack, catalogue: h.f.catalogue });
    expect(h.coordinator.catalogueSnapshot()).toMatchObject({ status: 'ready', catalogue: h.f.catalogue, importing: false });
    expect(h.fetch.mock.calls.map(([, options]) => options.method || 'GET')).toEqual(['POST', 'GET']);
    expect(h.card._layout).toEqual({}); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('composes the actual FurnitureEditor whose pending flag is set before its public import request', async () => {
    const h = setup({ empty: true }); h.card._floors = [{ id: 'ground', elevation: 0 }]; h.card.furnitureCatalogue = () => h.coordinator.catalogueSnapshot();
    h.card.furnitureLibrary = h.coordinator; let editor;
    editor = new FurnitureEditor(h.card, () => editor.render()); owners.push({ dispose: () => editor.dispose() });
    h.card.furnitureImportAvailable = () => !editor.dirty && !editor.stale; editor.render(); editor.file = h.f.file;
    h.transport = (url, options) => { if (options?.method === 'POST') { expect(editor._importPending).toBe(true); h.catalogue = h.f.catalogue; return json({ imported: true, pack: h.f.pack }); } return json(h.catalogue); };
    editor.onClick('furniture-import'); await vi.waitFor(() => expect(editor.message).toContain('ZIP import accepted'));
    expect(h.coordinator.catalogueSnapshot().catalogue).toEqual(h.f.catalogue); expect(editor.draft.instances).toEqual([]); expect(h.card._layout).toEqual({});
  });
  it('forces a new catalogue read after import instead of accepting an older refresh already in flight', async () => {
    const h = setup({ empty: true }), old = deferred(); let reads = 0;
    h.transport = (url, options) => options?.method === 'POST' ? json({ imported: true, pack: h.f.pack }) : ++reads === 1 ? old.promise : json(h.f.catalogue);
    const first = h.coordinator.refresh(); await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1)); const imported = await h.coordinator.importPack(h.f.file);
    expect(imported.ok).toBe(true); expect(h.coordinator.catalogueSnapshot().catalogue).toEqual(h.f.catalogue);
    old.resolve(json({ version: 1, packs: [] })); expect((await first).ok).toBe(false); expect(h.coordinator.catalogueSnapshot().catalogue).toEqual(h.f.catalogue);
    expect(reads).toBe(2);
  });
  it.each(['dirty hook', 'own preview', 'wrong tab', 'loading', 'nonadmin', 'basic hook'])('denies %s import without making a request', async (kind) => {
    const h = setup(); if (kind === 'dirty hook') h.dirty = true; if (kind === 'own preview') h.coordinator.previewDraft(h.raw());
    if (kind === 'wrong tab') h.card._edit.tab = 'model'; if (kind === 'loading') h.card._loading = true;
    if (kind === 'nonadmin') h.card._hass.user.is_admin = false; if (kind === 'basic hook') h.card.furnitureEditorAvailable = () => false;
    expect((await h.coordinator.importPack(h.f.file)).ok).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('poisons a pending import through observed dirty-hook loss/recovery without pretending its server mutation rolled back', async () => {
    const h = setup(), gate = deferred(); let serverPublished = false;
    h.transport = () => gate.promise.then(() => { serverPublished = true; return json({ imported: true, pack: h.f.pack }); });
    const pending = h.coordinator.importPack(h.f.file); await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    h.dirty = true; h.coordinator.sync(); h.dirty = false; h.coordinator.sync(); gate.resolve();
    const result = await pending; expect(serverPublished).toBe(true); expect(result).toMatchObject({ ok: false, imported: true, publicationMayHaveOccurred: true, pack: null });
    expect(h.coordinator.catalogueSnapshot().catalogue).toBeNull(); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('poisons an import after a same-key raw layout replacement while leaving already validated global metadata current', async () => {
    const h = setup(); await h.coordinator.refresh(); const gate = deferred(); h.transport = () => gate.promise;
    const pending = h.coordinator.importPack(h.f.file); await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    h.card._layout = { savedByAnotherEditor: true }; h.coordinator.sync(); gate.resolve(json({ imported: true, pack: h.f.pack }));
    const result = await pending; expect(result).toMatchObject({ ok: false, imported: true, publicationMayHaveOccurred: true });
    expect(h.coordinator.catalogueSnapshot().catalogue).toEqual(h.f.catalogue); expect(h.card._layout).toEqual({ savedByAnotherEditor: true });
  });
  it('reports an accepted but not yet visible pack without fabricating catalogue membership', async () => {
    const h = setup({ empty: true }); const result = await h.coordinator.importPack(h.f.file);
    expect(result).toMatchObject({ ok: false, imported: true, publicationMayHaveOccurred: true }); expect(result.diagnostics[0].code).toBe('published');
    expect(h.coordinator.catalogueSnapshot().catalogue.packs).toEqual([]); expect(h.fetch).toHaveBeenCalledTimes(2);
  });
  it('reports post-import read failure as a stored-mutation uncertainty and does not auto-retry', async () => {
    const h = setup(); h.transport = (url, options) => options?.method === 'POST' ? json({ imported: true, pack: h.f.pack }) : json({}, 500);
    const result = await h.coordinator.importPack(h.f.file); expect(result).toMatchObject({ ok: false, imported: true, publicationMayHaveOccurred: true });
    for (let i = 0; i < 10; i++) h.coordinator.sync(); expect(h.fetch).toHaveBeenCalledTimes(2); expect(h.coordinator.catalogueSnapshot().status).toBe('error');
  });
  it('disposes pending work and preview without recreating a client or reviving old results', async () => {
    const h = setup(), gate = deferred(); h.transport = () => gate.promise; const pending = h.coordinator.refresh();
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1)); h.coordinator.previewDraft(h.raw()); h.coordinator.dispose(); h.coordinator.dispose(); gate.resolve(json(h.catalogue));
    expect((await pending).ok).toBe(false); expect(h.coordinator.preview).toBeNull(); expect(h.coordinator.catalogueSnapshot().status).toBe('unavailable');
    expect((await h.coordinator.refresh()).ok).toBe(false); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});
