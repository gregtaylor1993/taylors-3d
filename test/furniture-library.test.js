import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { FurnitureLibraryClient, FURNITURE_LIBRARY_LIMITS as LIMITS } from '../src/furniture-library.js';

// Real original bytes, native Fetch/File streams and actual cryptography. Only the
// HA transport is replaced; these tests do not mock hashes, JSON or byte readers.
const BASE = '/api/taylors3d/furniture', utf8 = (v) => new TextEncoder().encode(v);
const digest = (v) => createHash('sha256').update(v).digest('hex');
const copy = (v) => structuredClone(v);
const concatenate = (parts) => { const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; } return result; };
function triangleGlb() {
  const raw = utf8(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3,
      type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] }));
  const json = new Uint8Array(Math.ceil(raw.length / 4) * 4); json.fill(32); json.set(raw);
  const bytes = new Uint8Array(12 + 8 + json.length + 8 + 36), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(json, 20);
  const start = 20 + json.length; view.setUint32(start, 36, true); view.setUint32(start + 4, 0x004e4942, true);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((n, i) => view.setFloat32(start + 8 + 4 * i, n, true)); return bytes;
}
function storedZip(files) {
  const locals = [], central = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const path = utf8(name), local = new Uint8Array(30 + path.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true); l.setUint16(12, 0x21, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, path.length, true); local.set(path, 30);
    const entry = new Uint8Array(46 + path.length), c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, path.length, true); c.setUint32(42, offset, true); entry.set(path, 46);
    locals.push(local, data); central.push(entry); offset += local.length + data.length;
  }
  const directory = concatenate(central), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true);
  e.setUint32(12, directory.length, true); e.setUint32(16, offset, true); return concatenate([...locals, directory, end]);
}
function fixture() {
  const asset = triangleGlb(), licenseText = 'MIT test fixture credit.\n', license = { id: 'MIT', file: 'LICENSE.txt', text: licenseText, sha256: digest(utf8(licenseText)) };
  const manifest = { version: 1, id: 'original-fixture', name: 'Original fixture', author: 'Test author',
    license: { id: 'MIT', file: 'LICENSE.txt', link_hint: 'Preserve this raw credit field' },
    items: [{ id: 'triangle', name: 'Original triangle', file: 'triangle.glb', unit: 'm', anchor: [0, 0, 0], vendor: { original: true } }],
    extensions: { untouched: ['raw metadata', 7] } };
  const files = { 'pack.json': utf8(JSON.stringify(manifest)), 'LICENSE.txt': utf8(licenseText), 'triangle.glb': asset }, archive = storedZip(files);
  const packId = digest(archive), assetSha = digest(asset);
  const itemStats = { nodes: 1, meshes: 1, mesh_uses: 1, primitives: 1, triangles: 1, source_triangles: 1, materials: 0, textures: 0, images: [], texture_pixels: 0 };
  const pack = { pack_id: packId, logical_sha256: digest(utf8('independent logical manifest identity')), archive_bytes: archive.length,
    manifest, license: copy(license), licenses: { 'LICENSE.txt': license }, download_url: `${BASE}/packs/${packId}.zip`,
    items: [{ ...copy(manifest.items[0]), sha256: assetSha, pack_id: packId, asset_url: `${BASE}/assets/${assetSha}.glb`,
      metadata: copy(manifest.items[0]), license: copy(license), stats: itemStats }],
    stats: { archive_bytes: archive.length, expanded_bytes: Object.values(files).reduce((n, p) => n + p.length, 0), members: 3,
      items: 1, unique_assets: 1, asset_bytes: asset.length, triangles: 1, texture_pixels: 0 }, extensions: { keep: 'published raw metadata' } };
  return { asset, archive, pack, catalogue: { version: 1, packs: [pack], future: { preserved: true } },
    file: new File([archive], 'original.ZIP', { type: 'application/zip' }) };
}
const json = (value, options = {}) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { ...options,
  headers: { 'content-type': 'application/json', ...options.headers } });
const binary = (bytes, type, options = {}) => new Response(bytes, { ...options, headers: { 'content-type': type, ...options.headers } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const clients = [];
function harness(f = fixture()) {
  const connection = Object.assign(new EventTarget(), { connected: true }), user = { id: 'current-user', is_admin: true, is_active: true };
  const fetch = vi.fn(async (url, options) => url === BASE ? json(options?.method === 'POST' ? { imported: true, pack: f.pack } : f.catalogue)
    : url === f.pack.items[0].asset_url ? binary(f.asset, 'model/gltf-binary') : url === f.pack.download_url ? binary(f.archive, 'application/zip') : json({}, { status: 404 }));
  const h = { current: { user, connection, fetchWithAuth: fetch, states: {}, callService: vi.fn() }, fetch, connection, user, fixture: f };
  h.client = new FurnitureLibraryClient({ getHass: () => h.current }); clients.push(h.client); return h;
}
const errorCode = (result) => result.diagnostics[0]?.code;
afterEach(() => { for (const c of clients.splice(0)) c.dispose(); vi.unstubAllGlobals(); });

describe('authenticated immutable furniture library transport', () => {
  it('returns cloned original metadata/credits and verifies real GLB and original ZIP bytes using canonical routes', async () => {
    const h = harness(), before = copy(h.fixture.catalogue);
    const catalogue = await h.client.catalogue(); expect(catalogue.ok).toBe(true); expect(catalogue.catalogue).toEqual(before);
    catalogue.catalogue.packs[0].manifest.extensions.untouched.push('caller mutation'); catalogue.catalogue.packs[0].items[0].asset_url = 'https://foreign.invalid/leak';
    const asset = await h.client.asset(h.fixture.pack.items[0]), archive = await h.client.archive(h.fixture.pack.pack_id);
    expect(asset).toMatchObject({ ok: true, verified: true, sha256: digest(h.fixture.asset), diagnostics: [] }); expect(asset.bytes).toEqual(h.fixture.asset);
    expect(archive).toMatchObject({ ok: true, verified: true, sha256: digest(h.fixture.archive), diagnostics: [] }); expect(archive.bytes).toEqual(h.fixture.archive);
    expect(h.fixture.catalogue).toEqual(before); expect(h.fetch.mock.calls.map(([url]) => url)).toEqual([BASE, h.fixture.pack.items[0].asset_url, h.fixture.pack.download_url]);
    expect(h.current.callService).not.toHaveBeenCalled(); expect(h.client.diagnostics).toEqual([]);
  });
  it('works on HTTP-style contexts without crypto.subtle using independently checked local SHA256', async () => {
    vi.stubGlobal('crypto', undefined); const h = harness(); const result = await h.client.asset(h.fixture.pack.items[0].sha256);
    expect(result.ok).toBe(true); expect(result.sha256).toBe(digest(h.fixture.asset)); expect(result.verified).toBe(true);
  });
  it('uses genuine WebCrypto when present and permits compatible absent is_active', async () => {
    vi.stubGlobal('crypto', webcrypto); const h = harness(); delete h.user.is_active;
    expect((await h.client.catalogue()).ok).toBe(true); expect((await h.client.asset(h.fixture.pack.items[0].sha256)).sha256).toBe(digest(h.fixture.asset));
  });
  it('imports one native file with bounded immutable original bytes and a fixed harmless multipart filename', async () => {
    const h = harness(), result = await h.client.importPack(h.fixture.file);
    expect(result).toMatchObject({ ok: true, imported: true, pack: h.fixture.pack, diagnostics: [] }); expect(h.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = h.fetch.mock.calls[0], entries = [...options.body.entries()];
    expect(url).toBe(BASE); expect(options.method).toBe('POST'); expect(options.redirect).toBe('error'); expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(entries).toHaveLength(1); expect(entries[0][0]).toBe('file'); expect(entries[0][1].name).toBe('furniture-pack.zip');
    expect(entries[0][1].type).toBe('application/zip'); expect(new Uint8Array(await entries[0][1].arrayBuffer())).toEqual(h.fixture.archive);
    expect(h.current.callService).not.toHaveBeenCalled(); result.pack.items[0].metadata.vendor.original = false;
    expect(h.fixture.pack.items[0].metadata.vendor.original).toBe(true);
  });
  it('accepts an already published identical pack without claiming a new import', async () => {
    const h = harness(); await h.client.catalogue(); h.fetch.mockResolvedValueOnce(json({ imported: false, pack: h.fixture.pack }));
    expect(await h.client.importPack(h.fixture.file)).toMatchObject({ ok: true, imported: false, pack: h.fixture.pack });
  });
  it('does not treat one import response as a complete catalogue', async () => {
    const h = harness(); expect((await h.client.importPack(h.fixture.file)).ok).toBe(true);
    expect((await h.client.asset(h.fixture.pack.items[0].sha256)).ok).toBe(true);
    expect(h.fetch.mock.calls.map(([url, opts]) => [url, opts?.method || 'GET'])).toEqual([[BASE, 'POST'], [BASE, 'GET'], [h.fixture.pack.items[0].asset_url, 'GET']]);
  });
  it('preserves actual Unicode names up to the backend character bound', async () => {
    const f = fixture(); f.pack.manifest.name = '🏠'.repeat(128); f.pack.manifest.author = '🏠'.repeat(256);
    expect((await harness(f).client.catalogue()).ok).toBe(true);
  });
  it.each([
    ['version', (p) => { p.manifest.version = true; }], ['hash', (p) => { p.logical_sha256 = 'a'.repeat(63); }],
    ['foreign archive', (p) => { p.download_url = `https://foreign.invalid${p.download_url}`; }], ['foreign asset', (p) => { p.items[0].asset_url += '?token=secret'; }],
    ['unsafe path', (p) => { p.items[0].file = p.items[0].metadata.file = p.manifest.items[0].file = '../triangle.glb'; }],
    ['reserved path', (p) => { p.items[0].file = p.items[0].metadata.file = p.manifest.items[0].file = 'COM¹.glb'; }],
    ['blank name', (p) => { p.items[0].name = ' '; }], ['boolean coordinate', (p) => { p.items[0].anchor[0] = true; }],
    ['wrong source metadata', (p) => { p.items[0].metadata.vendor.original = false; }], ['wrong metre declaration', (p) => { p.items[0].unit = 'cm'; }],
    ['missing credit', (p) => { delete p.licenses['LICENSE.txt'].text; }], ['negative stats', (p) => { p.items[0].stats.triangles = -1; }],
    ['excess triangles', (p) => { p.items[0].stats.triangles = 100001; }], ['image MIME', (p) => { p.items[0].stats.images = [{ width: 1, height: 1, mime_type: 'image/svg+xml' }]; }],
    ['image dimensions', (p) => { p.items[0].stats.images = [{ width: 2049, height: 1, mime_type: 'image/png' }]; }],
    ['pixel count mismatch', (p) => { p.items[0].stats.texture_pixels = 1; }], ['aggregate mismatch', (p) => { p.stats.triangles = 2; }],
    ['duplicate item', (p) => { p.items.push(copy(p.items[0])); p.manifest.items.push(copy(p.manifest.items[0])); }],
  ])('rejects malformed known field: %s without changing server metadata', async (_label, change) => {
    const f = fixture(); change(f.pack); const before = copy(f.catalogue), h = harness(f), result = await h.client.catalogue();
    expect(result.ok).toBe(false); expect(result.catalogue).toBeNull(); expect(errorCode(result)).toBe('malformed'); expect(f.catalogue).toEqual(before);
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.current.callService).not.toHaveBeenCalled();
  });
  it('rejects a changed licence even when all other hashes/routes look valid', async () => {
    const f = fixture(); f.pack.licenses['LICENSE.txt'].text += 'changed'; const result = await harness(f).client.catalogue();
    expect(errorCode(result)).toBe('corrupt'); expect(result.catalogue).toBeNull();
  });
  it.each(['{"version":1,"version":1,"packs":[]}', '{"version":1,"packs":[],"extra":1e999}', '{"version":1,"packs":[],"extra":"\\ud800"}'])('rejects ambiguous/nonfinite/invalid-Unicode JSON %s', async (source) => {
    const h = harness(); h.fetch.mockResolvedValueOnce(json(source)); expect(errorCode(await h.client.catalogue())).toBe('malformed');
  });
  it('rejects actual malformed UTF8 and oversized pack-count responses', async () => {
    const h = harness(); h.fetch.mockResolvedValueOnce(binary(new Uint8Array([0xc3, 0x28]), 'application/json'));
    expect(errorCode(await h.client.catalogue())).toBe('malformed');
    h.fetch.mockResolvedValueOnce(json({ version: 1, packs: Array(1025).fill(h.fixture.pack) })); expect(errorCode(await h.client.catalogue())).toBe('malformed');
  });
  it('accepts an empty current library without inventing an item', async () => {
    const h = harness(); h.fetch.mockResolvedValueOnce(json({ version: 1, packs: [], extra: 'original' }));
    expect(await h.client.catalogue()).toMatchObject({ ok: true, catalogue: { version: 1, packs: [], extra: 'original' } });
    expect(errorCode(await h.client.asset('a'.repeat(64)))).toBe('missing'); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects changed immutable metadata for a previously accepted exact pack', async () => {
    const h = harness(); expect((await h.client.catalogue()).ok).toBe(true);
    const changed = copy(h.fixture.catalogue); changed.packs[0].extensions.keep = 'different'; h.fetch.mockResolvedValueOnce(json(changed));
    expect(errorCode(await h.client.catalogue())).toBe('corrupt');
  });
  it.each(['https://foreign.invalid/asset.glb', 'a'.repeat(63), 'A'.repeat(64), '../pack.zip', `${'a'.repeat(64)}?secret=token`])('rejects supplied route/hash %s before any request', async (value) => {
    const h = harness(); expect(errorCode(await h.client.asset(value))).toBe('route'); expect(errorCode(await h.client.archive(value))).toBe('route'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('rejects foreign item URLs before even reading the catalogue, and unpublished identities before binary requests', async () => {
    const h = harness(), item = { ...h.fixture.pack.items[0], asset_url: 'https://foreign.invalid/token' };
    expect(errorCode(await h.client.asset(item))).toBe('route'); expect(h.fetch).not.toHaveBeenCalled();
    expect(errorCode(await h.client.asset('a'.repeat(64)))).toBe('missing'); expect(h.fetch.mock.calls.map(([url]) => url)).toEqual([BASE]);
    expect(errorCode(await h.client.archive('b'.repeat(64)))).toBe('missing'); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('detects changed actual asset/archive bytes rather than accepting their declared identities', async () => {
    const h = harness(); await h.client.catalogue(); const wrong = h.fixture.asset.slice(); wrong[wrong.length - 1] ^= 1;
    h.fetch.mockResolvedValueOnce(binary(wrong, 'model/gltf-binary')); expect(errorCode(await h.client.asset(h.fixture.pack.items[0].sha256))).toBe('corrupt');
    h.fetch.mockResolvedValueOnce(binary(h.fixture.archive.slice(0, -1), 'application/zip')); expect(errorCode(await h.client.archive(h.fixture.pack.pack_id))).toBe('corrupt');
  });
  it('reads real multi-chunk binary data even when a misleading Content-Length says zero', async () => {
    const h = harness(); await h.client.catalogue(); const bytes = h.fixture.asset;
    h.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 17) c.enqueue(bytes.subarray(i, i + 17)); c.close(); } }),
      { headers: { 'content-type': 'model/gltf-binary', 'content-length': '0' } }));
    expect((await h.client.asset(h.fixture.pack.items[0].sha256)).bytes).toEqual(bytes);
  });
  it.each([['asset', LIMITS.asset, 'model/gltf-binary'], ['archive', LIMITS.archive, 'application/zip']])('bounds actual %s response bytes and cancels its reader independently of headers', async (kind, maximum, type) => {
    const h = harness(); await h.client.catalogue(); let cancelled = 0;
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(maximum + 1)); }, cancel() { cancelled++; } });
    h.fetch.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': type, 'content-length': '1' } }));
    const result = await (kind === 'asset' ? h.client.asset(h.fixture.pack.items[0].sha256) : h.client.archive(h.fixture.pack.pack_id));
    expect(errorCode(result)).toBe('size'); expect(result.bytes).toBeNull(); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
  });
  it('bounds actual JSON metadata before decoding and rejects an oversized header before reading', async () => {
    const h = harness(); let cancelled = 0;
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(LIMITS.metadata + 2049)); }, cancel() { cancelled++; } });
    h.fetch.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/json' } }));
    expect(errorCode(await h.client.catalogue())).toBe('size'); expect(cancelled).toBe(1);
    h.fetch.mockResolvedValueOnce(json({}, { headers: { 'content-length': String(LIMITS.metadata + 2049) } })); expect(errorCode(await h.client.catalogue())).toBe('size');
  });
  it.each([[401, 'unauthorized'], [403, 'unauthorized'], [404, 'missing'], [409, 'corrupt'], [413, 'size'], [400, 'malformed'], [500, 'server']])('returns safe status %s diagnostics without server credentials', async (status, expected) => {
    const h = harness(); h.fetch.mockResolvedValueOnce(json({ error: 'https://user:password@host/?token=secret' }, { status }));
    const result = await h.client.catalogue(); expect(errorCode(result)).toBe(expected); expect(JSON.stringify(result)).not.toMatch(/password|secret|user:|token=/);
  });
  it('rejects wrong content types and redirects without following any foreign URL', async () => {
    const h = harness(); h.fetch.mockResolvedValueOnce(binary(utf8('<html>login</html>'), 'text/html'));
    expect(errorCode(await h.client.catalogue())).toBe('type');
    const response = json(h.fixture.catalogue); Object.defineProperty(response, 'redirected', { value: true }); h.fetch.mockResolvedValueOnce(response);
    expect(errorCode(await h.client.catalogue())).toBe('route'); expect(h.fetch.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true);
  });
  it('accepts exact response route and rejects changed route/query even on an otherwise real Response', async () => {
    const h = harness(); let response = json(h.fixture.catalogue); Object.defineProperty(response, 'url', { value: `http://ha.local${BASE}` }); h.fetch.mockResolvedValueOnce(response);
    expect((await h.client.catalogue()).ok).toBe(true);
    response = json(h.fixture.catalogue); Object.defineProperty(response, 'url', { value: `http://ha.local${BASE}?token=hidden` }); h.fetch.mockResolvedValueOnce(response);
    expect(errorCode(await h.client.catalogue())).toBe('route');
  });
  it.each([['missing user', (h) => { h.current.user = null; }], ['blank ID', (h) => { h.user.id = ' '; }],
    ['inactive', (h) => { h.user.is_active = false; }], ['malformed active', (h) => { h.user.is_active = 'true'; }],
    ['disconnected', (h) => { h.connection.connected = false; }]])('waits for actual current session: %s', async (_label, change) => {
    const h = harness(); change(h); expect(errorCode(await h.client.catalogue())).toBe('session'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('allows current authenticated read-only users but blocks import before reading/sending a file', async () => {
    const h = harness(); h.user.is_admin = false; expect((await h.client.catalogue()).ok).toBe(true); h.fetch.mockClear();
    expect(errorCode(await h.client.importPack(h.fixture.file))).toBe('admin'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('reports unavailable authenticated transport and safely handles thrown transport errors', async () => {
    const h = harness(); h.current.fetchWithAuth = null; expect(errorCode(await h.client.catalogue())).toBe('transport');
    h.current.fetchWithAuth = h.fetch; h.fetch.mockRejectedValueOnce(new Error('Bearer secrettoken; https://user:password@host'));
    const result = await h.client.catalogue(); expect(errorCode(result)).toBe('network'); expect(JSON.stringify(result)).not.toMatch(/password|secrettoken|Bearer/);
  });
  it.each([null, {}, new Blob(['data']), new File([], 'empty.zip'), new File(['data'], 'wrong.glb')])('rejects unsupported/empty upload input without fetching', async (file) => {
    const h = harness(); expect(errorCode(await h.client.importPack(file))).toBe('file'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('checks genuine native file bytes despite forged own size/stream and never imports oversized native files', async () => {
    const h = harness(), file = h.fixture.file; Object.defineProperty(file, 'size', { value: 1 }); Object.defineProperty(file, 'stream', { value: () => new Blob(['forged']).stream() });
    expect((await h.client.importPack(file)).ok).toBe(true); h.fetch.mockClear();
    const large = new File([new Uint8Array(LIMITS.archive + 1)], 'large.zip'); expect(errorCode(await h.client.importPack(large))).toBe('file'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('rejects import results whose immutable archive identity or archive size do not match the file uploaded', async () => {
    const h = harness(); let pack = copy(h.fixture.pack); pack.pack_id = 'a'.repeat(64); pack.download_url = `${BASE}/packs/${pack.pack_id}.zip`; pack.items[0].pack_id = pack.pack_id;
    h.fetch.mockResolvedValueOnce(json({ imported: true, pack })); expect(errorCode(await h.client.importPack(h.fixture.file))).toBe('corrupt');
    pack = copy(h.fixture.pack); pack.archive_bytes++; pack.stats.archive_bytes++; h.fetch.mockResolvedValueOnce(json({ imported: true, pack }));
    expect(errorCode(await h.client.importPack(h.fixture.file))).toBe('corrupt');
  });
  it('accepts unrelated HA state replacements without invalidating a pending download', async () => {
    const h = harness(), network = deferred(); h.fetch.mockReturnValueOnce(network.promise); const pending = h.client.catalogue();
    h.current = { ...h.current, states: { 'sensor.unrelated': { state: '123' } } }; h.client.revalidate(); network.resolve(json(h.fixture.catalogue));
    expect((await pending).ok).toBe(true);
  });
  it.each(['user', 'connection', 'fetch', 'inactive'])('rejects late response after observed %s change, even if the original context is restored', async (kind) => {
    const h = harness(), original = { ...h.current }, network = deferred(); h.fetch.mockReturnValueOnce(network.promise); const pending = h.client.catalogue();
    const signal = h.fetch.mock.calls[0][1].signal;
    if (kind === 'user') h.current = { ...h.current, user: { ...h.user } };
    if (kind === 'connection') h.current = { ...h.current, connection: Object.assign(new EventTarget(), { connected: true }) };
    if (kind === 'fetch') h.current = { ...h.current, fetchWithAuth: (...args) => h.fetch(...args) };
    if (kind === 'inactive') h.user.is_active = false;
    h.client.revalidate(); if (kind === 'inactive') h.user.is_active = true; h.current = original; h.client.revalidate();
    expect(signal.aborted).toBe(true); network.resolve(json(h.fixture.catalogue)); expect(errorCode(await pending)).toBe('stale');
    expect(h.client.diagnostics).toEqual([]); expect((await h.client.catalogue()).ok).toBe(true);
  });
  it('latches a real connection disconnect event even if connected state recovers before response', async () => {
    const h = harness(), network = deferred(); h.fetch.mockReturnValueOnce(network.promise); const pending = h.client.catalogue();
    h.connection.dispatchEvent(new Event('disconnected')); network.resolve(json(h.fixture.catalogue)); expect(errorCode(await pending)).toBe('stale');
    expect((await h.client.catalogue()).ok).toBe(true);
  });
  it('exposes a read-only session generation that survives loss/recovery but not unrelated HA updates', () => {
    const h = harness(); expect(h.client.revalidate()).toBe(true); const first = h.client.generation;
    h.current = { ...h.current, states: { 'sensor.temperature': { state: '21' } } }; h.client.revalidate(); expect(h.client.generation).toBe(first);
    h.user.is_active = false; h.client.revalidate(); h.user.is_active = true; h.client.revalidate(); expect(h.client.generation).toBeGreaterThan(first);
    expect(() => { h.client.generation = first; }).toThrow(); const current = h.client.generation;
    h.connection.dispatchEvent(new Event('disconnected')); expect(h.client.generation).toBeGreaterThan(current);
  });
  it('revalidates administrator role before POST after native file read/hash', async () => {
    const h = harness(), pending = h.client.importPack(h.fixture.file); h.user.is_admin = false; h.client.revalidate();
    expect(errorCode(await pending)).toBe('stale'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('discards import response after admin loss/recovery without claiming publication was rolled back', async () => {
    const h = harness(), reached = deferred(), network = deferred(); h.fetch.mockImplementationOnce(() => { reached.resolve(); return network.promise; });
    const pending = h.client.importPack(h.fixture.file); await reached.promise; h.user.is_admin = false; h.client.revalidate(); h.user.is_admin = true; h.client.revalidate();
    network.resolve(json({ imported: true, pack: h.fixture.pack })); const result = await pending;
    expect(errorCode(result)).toBe('stale'); expect(result.pack).toBeNull(); expect(result.imported).toBe(false);
    expect(h.fetch).toHaveBeenCalledTimes(1); expect((await h.client.catalogue()).ok).toBe(true);
  });
  it('does not let older failure overwrite newer successful diagnostics', async () => {
    const h = harness(), old = deferred(); h.fetch.mockReturnValueOnce(old.promise); const pending = h.client.catalogue();
    expect((await h.client.catalogue()).ok).toBe(true); old.reject(new Error('secret old error'));
    expect(errorCode(await pending)).toBe('network'); expect(h.client.diagnostics).toEqual([]);
  });
  it('cancels owned waiting binary readers and closes late results on dispose without leaking data or listeners', async () => {
    const h = harness(); await h.client.catalogue(); const started = deferred(); let cancelled = 0;
    const body = new ReadableStream({ start(c) { c.enqueue(h.fixture.asset.subarray(0, 7)); }, pull() { started.resolve(); }, cancel() { cancelled++; } });
    h.fetch.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'model/gltf-binary' } }));
    const pending = h.client.asset(h.fixture.pack.items[0].sha256); await started.promise; h.client.dispose(); h.client.dispose();
    const result = await pending; expect(errorCode(result)).toBe('disposed'); expect(result.bytes).toBeNull(); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
    expect(h.client.diagnostics).toEqual([]); expect(h.client.revalidate()).toBe(false); expect(errorCode(await h.client.catalogue())).toBe('disposed');
    const generation = h.client._generation; h.connection.dispatchEvent(new Event('disconnected')); expect(h.client._generation).toBe(generation);
  });
});
