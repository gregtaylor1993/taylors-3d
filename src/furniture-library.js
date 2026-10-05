// FUTURE library transport only. No extraction, renderer, DOM, persistence or HA services.
// Server contract: custom_components/taylors3d/furniture.py. All URLs are built here.
import { sha256 } from './sha256.js';
import { ownFurnitureCaption } from './furniture-caption-source.js';

const BASE = '/api/taylors3d/furniture', MiB = 1024 * 1024;
export const FURNITURE_LIBRARY_LIMITS = Object.freeze({ packs: 1024, items: 32, asset: 10 * MiB,
  archive: 64 * MiB, metadata: 32 * MiB, record: 8 * MiB, manifest: 256 * 1024, license: 128 * 1024 });
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const hash = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const id = (v) => typeof v === 'string' && /^[a-z0-9_-]{1,64}$/.test(v);
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const characters = (v, max) => { let count = 0; for (let i = 0; i < v.length; i++) {
  if (++count > max) return false; const code = v.charCodeAt(i); if (code >= 0xd800 && code <= 0xdbff) i++;
} return true; };
const controls = (v, del = false) => { for (let i = 0; i < v.length; i++) { const code = v.charCodeAt(i); if (code < 32 || del && code === 127) return true; } return false; };
const text = (v, max = 128) => typeof v === 'string' && !!v.trim() && characters(v, max) && !controls(v);
const vector = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000);
const encode = (v) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
const clone = (v) => structuredClone(v);
const assetUrl = (sha) => `${BASE}/assets/${sha}.glb`;
const archiveUrl = (sha) => `${BASE}/packs/${sha}.zip`;
const portable = (v) => typeof v === 'string' && v.length > 0 && characters(v, 240) && v.normalize('NFC') === v
  && v.split('/').every((part) => part && part !== '.' && part !== '..' && characters(part, 120) && !/[. ]$/.test(part)
    && !controls(part, true) && !/[\\:*?"<>|]/.test(part) && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(part.split('.')[0]));
const equal = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  return plain(a) && plain(b) && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
};
const messages = Object.freeze({
  session: 'A current active Home Assistant session is required.', admin: 'Current administrator access is required to import furniture.',
  transport: 'Home Assistant authenticated downloads are unavailable.', network: 'Furniture library request failed. Try again with the current connection.',
  stale: 'The Home Assistant session changed. Start this library action again.', disposed: 'The furniture library client is closed.',
  route: 'Use an exact published furniture identity and its canonical library route.', missing: 'This item or pack is not in the published furniture library.',
  size: 'Furniture content exceeds its permitted byte limit.', malformed: 'Furniture library metadata is malformed or unsupported.',
  corrupt: 'Published furniture bytes or metadata are corrupt. Restore the library from a backup.',
  file: 'Choose one nonempty ZIP file of at most 64 MiB.', unauthorized: 'The furniture request is not authorized for the current account.',
  server: 'Furniture library storage is unavailable.', type: 'The server did not return the expected furniture content type.',
});
export const FURNITURE_LIBRARY_MESSAGES = messages;
class LibraryError extends Error { constructor(code) { super(messages[code]); this.code = code; } }
const fail = (code) => { throw new LibraryError(code); };
const requireValue = (value, code = 'malformed') => { if (!value) fail(code); };

// JSON.parse accepts duplicate keys and escaped lone surrogates. Reject them rather
// than silently replacing a saved credit or immutable identity. Unknown fields remain.
function parseMetadata(bytes) {
  let source, value;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); value = JSON.parse(source); } catch { fail('malformed'); }
  const frames = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      const start = i; while (++i < source.length) { if (source[i] === '\\') i++; else if (source[i] === '"') break; }
      const frame = frames.at(-1);
      if (frame?.keys && frame.next) {
        const key = JSON.parse(source.slice(start, i + 1)); requireValue(!frame.keys.has(key)); frame.keys.add(key); frame.next = false;
      }
    } else if (c === '{') frames.push({ keys: new Set(), next: true });
    else if (c === '[') frames.push({});
    else if (c === '}' || c === ']') frames.pop();
    else if (c === ',' && frames.at(-1)?.keys) frames.at(-1).next = true;
  }
  const pending = [[value, 0]];
  while (pending.length) {
    const [entry, depth] = pending.pop(); requireValue(depth <= 40);
    if (typeof entry === 'number') requireValue(Number.isFinite(entry));
    else if (typeof entry === 'string') {
      for (let i = 0; i < entry.length; i++) {
        const code = entry.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) { const next = entry.charCodeAt(++i); requireValue(next >= 0xdc00 && next <= 0xdfff); }
        else requireValue(code < 0xdc00 || code > 0xdfff);
      }
    } else if (entry && typeof entry === 'object') for (const [key, child] of Object.entries(entry)) {
      pending.push([key, depth], [child, depth + 1]);
    }
  }
  return value;
}

function metadataBudget(value) {
  const pending = [[value, 0]]; let count = 0;
  while (pending.length) {
    const [entry, depth] = pending.pop(); requireValue(++count <= 50000 && depth <= 32);
    if (entry && typeof entry === 'object') for (const child of Object.values(entry)) pending.push([child, depth + 1]);
  }
}

async function validatePack(pack, check) {
  const limits = FURNITURE_LIBRARY_LIMITS;
  requireValue(plain(pack) && hash(pack.pack_id) && hash(pack.logical_sha256) && integer(pack.archive_bytes, 1, limits.archive)
    && pack.download_url === archiveUrl(pack.pack_id) && encode(pack).length <= limits.record);
  const manifest = pack.manifest;
  requireValue(plain(manifest) && manifest.version === 1 && id(manifest.id) && text(manifest.name) && text(manifest.author, 256)
    && plain(manifest.license) && encode(manifest).length <= limits.manifest);
  metadataBudget(manifest);
  requireValue(Array.isArray(pack.items) && pack.items.length > 0 && pack.items.length <= limits.items
    && Array.isArray(manifest.items) && manifest.items.length === pack.items.length && plain(pack.licenses) && plain(pack.license)
    && Object.keys(pack.licenses).length > 0 && Object.keys(pack.licenses).length <= limits.items + 1 && plain(pack.stats));
  for (const [file, license] of Object.entries(pack.licenses)) {
    requireValue(plain(license) && portable(file) && file !== 'pack.json' && !/\.glb$/i.test(file)
      && license.file === file && text(license.id) && hash(license.sha256)
      && typeof license.text === 'string' && !!license.text.trim() && !license.text.includes('\0') && encode(license.text).length <= limits.license);
    requireValue(await sha256(encode(license.text)) === license.sha256, 'corrupt'); check();
  }
  requireValue(equal(pack.license, pack.licenses[pack.license.file]) && manifest.license.id === pack.license.id && manifest.license.file === pack.license.file);
  const seen = new Set(), assets = new Map(), usedLicenses = new Set([pack.license.file]);
  for (const [index, item] of pack.items.entries()) {
    const metadata = manifest.items[index];
    requireValue(plain(item) && id(item.id) && !seen.has(item.id) && text(item.name) && portable(item.file) && /\.glb$/i.test(item.file)
      && item.unit === 'm' && vector(item.anchor) && hash(item.sha256) && item.pack_id === pack.pack_id
      && item.asset_url === assetUrl(item.sha256) && plain(item.license) && plain(item.stats) && plain(item.metadata)
      && equal(item.metadata, metadata));
    for (const field of ['id', 'name', 'file', 'unit', 'anchor']) requireValue(equal(item[field], metadata[field]));
    const declared = metadata.license || manifest.license;
    requireValue(plain(declared) && declared.id === item.license.id && declared.file === item.license.file
      && equal(item.license, pack.licenses[item.license.file]));
    for (const [field, max] of [['nodes', 512], ['meshes', 256], ['mesh_uses', 512], ['primitives', 512], ['triangles', 100000],
      ['source_triangles', 100000], ['materials', 128], ['textures', 64], ['texture_pixels', 16 * MiB]]) {
      requireValue(integer(item.stats[field], ['materials', 'textures', 'texture_pixels'].includes(field) ? 0 : 1, max));
    }
    requireValue(Array.isArray(item.stats.images) && item.stats.images.length <= 32);
    let pixels = 0;
    for (const image of item.stats.images) {
      requireValue(plain(image) && integer(image.width, 1, 2048) && integer(image.height, 1, 2048)
        && ['image/png', 'image/jpeg'].includes(image.mime_type));
      pixels += image.width * image.height;
    }
    requireValue(pixels === item.stats.texture_pixels);
    requireValue(!assets.has(item.sha256) || equal(assets.get(item.sha256), item.stats), 'corrupt');
    assets.set(item.sha256, item.stats); usedLicenses.add(item.license.file);
    seen.add(item.id);
  }
  const stats = pack.stats;
  requireValue(Object.keys(pack.licenses).every((file) => usedLicenses.has(file)));
  requireValue(stats.archive_bytes === pack.archive_bytes && stats.items === pack.items.length
    && integer(stats.expanded_bytes, 1, 50 * MiB) && integer(stats.members, 1, 128)
    && stats.unique_assets === assets.size && integer(stats.asset_bytes, 20 * assets.size, 50 * MiB)
    && integer(stats.triangles, 1, 250000) && integer(stats.texture_pixels, 0, 32 * MiB)
    && stats.triangles === Array.from(assets.values()).reduce((sum, item) => sum + item.triangles, 0)
    && stats.texture_pixels === Array.from(assets.values()).reduce((sum, item) => sum + item.texture_pixels, 0));
  return pack;
}

/** Reads/imports local immutable packs only. Methods resolve {ok,...,diagnostics};
 * failures never echo URLs, supplied filenames, server bodies or transport errors.
 * Future HA setter wiring should call revalidate() to latch permission/session loss.
 */
export class FurnitureLibraryClient {
  constructor({ getHass } = {}) {
    this.getHass = typeof getHass === 'function' ? getHass : () => null;
    this._disposed = false; this._generation = 0; this._requests = new Set(); this._session = null;
    this._cache = null; this._cacheComplete = false; this._cacheOrder = 0; this._order = 0; this._latest = 0; this._diagnostics = [];
    this._onDisconnected = () => this._invalidate();
  }
  get diagnostics() { return clone(this._diagnostics); }
  get generation() { return this._generation; }
  _invalidate() {
    this._generation++; this._cache = null; this._cacheComplete = false; this._cacheOrder = 0; this._diagnostics = [];
    for (const context of this._requests) {
      context.controller.abort();
      for (const reader of context.readers) reader.cancel().catch(() => {});
    }
  }
  _observe() {
    let hass; try { hass = this.getHass(); } catch { hass = null; }
    const user = hass?.user;
    const session = { hass, connection: hass?.connection, user, id: user?.id, fetch: hass?.fetchWithAuth,
      connected: hass?.connection?.connected === true, active: !!user && (!Object.hasOwn(user, 'is_active') || user.is_active === true), admin: user?.is_admin === true };
    const old = this._session;
    if (!old || ['connection', 'user', 'id', 'fetch', 'connected', 'active', 'admin'].some((field) => old[field] !== session[field])) {
      old?.connection?.removeEventListener?.('disconnected', this._onDisconnected);
      this._invalidate(); this._session = session;
      session.connection?.addEventListener?.('disconnected', this._onDisconnected);
    } else this._session = session;
    return session;
  }
  revalidate() {
    if (this._disposed) return false;
    const session = this._observe(); return session.connected && session.active && typeof session.id === 'string' && !!session.id.trim() && typeof session.fetch === 'function';
  }
  _current(context) {
    if (this._disposed) return false;
    const session = this._observe();
    return context.generation === this._generation && !context.controller.signal.aborted && session.connected && session.active
      && session.user === context.user && session.id === context.id && session.connection === context.connection && session.fetch === context.fetch
      && (!context.adminRequired || session.admin);
  }
  _check(context) { if (!this._current(context)) fail(this._disposed ? 'disposed' : 'stale'); }
  async _run(adminRequired, empty, work) {
    const order = ++this._order; this._latest = order; let context;
    try {
      if (this._disposed) fail('disposed');
      const session = this._observe();
      requireValue(session.connected && session.active && typeof session.id === 'string' && !!session.id.trim(), 'session');
      requireValue(typeof session.fetch === 'function', 'transport'); requireValue(!adminRequired || session.admin, 'admin');
      context = { ...session, adminRequired, order, generation: this._generation, controller: new AbortController(), readers: new Set() };
      this._requests.add(context); const result = await work(context); this._check(context);
      if (order === this._latest) this._diagnostics = [];
      return { ok: true, ...result, diagnostics: [] };
    } catch (error) {
      const current = context ? this._current(context) : !this._disposed;
      const code = this._disposed ? 'disposed' : !current ? 'stale' : error instanceof LibraryError ? error.code : 'network';
      const diagnostics = [ownFurnitureCaption({ code, message: messages[code] }, 'library', code)];
      if (current && order === this._latest) this._diagnostics = diagnostics;
      return { ok: false, ...empty, diagnostics };
    } finally { if (context) this._requests.delete(context); }
  }
  async _bytes(stream, maximum, context, minimum = 1) {
    requireValue(stream && typeof stream.getReader === 'function', 'malformed');
    const reader = stream.getReader(), chunks = []; let length = 0, completed = false;
    context.readers.add(reader);
    try {
      while (true) {
        this._check(context); const part = await reader.read(); this._check(context);
        if (part.done) break;
        requireValue(part.value instanceof Uint8Array, 'malformed');
        requireValue(length + part.value.length <= maximum, 'size');
        length += part.value.length; if (part.value.length) chunks.push(part.value.slice());
      }
      requireValue(length >= minimum, 'malformed'); const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      completed = true; return bytes;
    } finally {
      if (!completed) { try { await reader.cancel(); } catch { /* Fixed safe diagnostic only. */ } }
      context.readers.delete(reader); reader.releaseLock();
    }
  }
  async _request(context, url, maximum, type, options = {}) {
    this._check(context);
    requireValue(url === BASE || /^\/api\/taylors3d\/furniture\/(?:assets\/[0-9a-f]{64}\.glb|packs\/[0-9a-f]{64}\.zip)$/.test(url), 'route');
    const response = await context.fetch.call(this._session.hass, url, { ...options, redirect: 'error', signal: context.controller.signal });
    this._check(context);
    try {
      requireValue(response && typeof response.ok === 'boolean' && response.headers?.get && !response.redirected, 'route');
      if (response.url) {
        const actual = new URL(response.url, 'https://relative.invalid');
        requireValue(actual.pathname === url && !actual.search && !actual.hash && !actual.username && !actual.password, 'route');
      }
      if (!response.ok) fail([401, 403].includes(response.status) ? 'unauthorized' : response.status === 404 ? 'missing'
        : response.status === 409 ? 'corrupt' : response.status === 413 ? 'size' : response.status === 400 ? 'malformed' : 'server');
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      requireValue(contentType === type, 'type');
      const declared = response.headers.get('content-length');
      if (declared !== null) requireValue(/^\d+$/.test(declared) && Number(declared) <= maximum, 'size');
      return await this._bytes(response.body, maximum, context);
    } catch (error) { try { await response?.body?.cancel(); } catch { /* Never echo the server error. */ } throw error; }
  }
  async _catalogue(context) {
    const value = parseMetadata(await this._request(context, BASE, FURNITURE_LIBRARY_LIMITS.metadata + 2048, 'application/json'));
    requireValue(plain(value) && value.version === 1 && Array.isArray(value.packs) && value.packs.length <= FURNITURE_LIBRARY_LIMITS.packs);
    const ids = new Set(); let total = 0;
    for (const pack of value.packs) {
      await validatePack(pack, () => this._check(context)); this._check(context);
      requireValue(!ids.has(pack.pack_id)); ids.add(pack.pack_id); total += encode(pack).length;
      requireValue(total <= FURNITURE_LIBRARY_LIMITS.metadata, 'size');
      const existing = this._cache?.packs.find((record) => record.pack_id === pack.pack_id);
      requireValue(!existing || equal(existing, pack), 'corrupt');
    }
    if (context.order >= this._cacheOrder) { this._cache = clone(value); this._cacheComplete = true; this._cacheOrder = context.order; }
    return value;
  }
  catalogue() { return this._run(false, { catalogue: null }, async (context) => ({ catalogue: clone(await this._catalogue(context)) })); }
  importPack(file) {
    return this._run(true, { imported: false, pack: null }, async (context) => {
      let size, stream;
      try { requireValue(typeof File === 'function' && file instanceof File && /\.zip$/i.test(file.name), 'file');
        size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(file); stream = Blob.prototype.stream.call(file);
      } catch { fail('file'); }
      requireValue(integer(size, 1, FURNITURE_LIBRARY_LIMITS.archive), 'file');
      const bytes = await this._bytes(stream, FURNITURE_LIBRARY_LIMITS.archive, context); requireValue(bytes.length === size, 'file');
      const digest = await sha256(bytes); this._check(context);
      const body = new FormData(); body.append('file', new Blob([bytes], { type: 'application/zip' }), 'furniture-pack.zip');
      const value = parseMetadata(await this._request(context, BASE, FURNITURE_LIBRARY_LIMITS.record + 256, 'application/json', { method: 'POST', body }));
      requireValue(plain(value) && typeof value.imported === 'boolean'); await validatePack(value.pack, () => this._check(context));
      requireValue(value.pack.pack_id === digest && value.pack.archive_bytes === size, 'corrupt'); this._check(context);
      const existing = this._cache?.packs.find((pack) => pack.pack_id === digest); requireValue(!existing || equal(existing, value.pack), 'corrupt');
      if (context.order >= this._cacheOrder) {
        this._cache = { ...(this._cache || { version: 1 }), packs: [...(this._cache?.packs || []).filter((pack) => pack.pack_id !== digest), clone(value.pack)] };
        this._cacheOrder = context.order;
      }
      return { imported: value.imported, pack: clone(value.pack) };
    });
  }
  asset(value) {
    return this._run(false, { bytes: null, sha256: null }, async (context) => {
      const digest = typeof value === 'string' ? value : value?.sha256; requireValue(hash(digest), 'route');
      if (typeof value !== 'string') requireValue(plain(value) && id(value.id) && hash(value.pack_id) && value.asset_url === assetUrl(digest), 'route');
      const catalogue = this._cacheComplete ? this._cache : await this._catalogue(context);
      const item = catalogue.packs.flatMap((pack) => pack.items).find((item) => item.sha256 === digest
        && (typeof value === 'string' || item.id === value?.id && item.pack_id === value?.pack_id));
      requireValue(item, 'missing');
      return this._binary(context, assetUrl(digest), digest, FURNITURE_LIBRARY_LIMITS.asset, 'model/gltf-binary');
    });
  }
  archive(packId) {
    return this._run(false, { bytes: null, sha256: null }, async (context) => {
      requireValue(hash(packId), 'route'); const catalogue = this._cacheComplete ? this._cache : await this._catalogue(context);
      const pack = catalogue.packs.find((pack) => pack.pack_id === packId); requireValue(pack, 'missing');
      return this._binary(context, archiveUrl(packId), packId, FURNITURE_LIBRARY_LIMITS.archive, 'application/zip', pack.archive_bytes);
    });
  }
  async _binary(context, url, expected, maximum, type, size) {
    const bytes = await this._request(context, url, maximum, type);
    if (size !== undefined) requireValue(bytes.length === size, 'corrupt');
    const digest = await sha256(bytes); this._check(context); requireValue(digest === expected, 'corrupt');
    return { bytes, sha256: digest, verified: true };
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true; this._session?.connection?.removeEventListener?.('disconnected', this._onDisconnected);
    this._invalidate(); this._session = null;
  }
}
