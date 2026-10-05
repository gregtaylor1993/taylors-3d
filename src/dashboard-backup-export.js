// FUTURE whole-dashboard ZIP transport, unregistered. Only own authenticated
// routes and explicitly referenced Taylor storage keys are read. No normalise,
// resource/GLB URL fetch, file extraction, dashboard save or HA device action.
import { DashboardBackupClient } from './dashboard-backup-client.js';

const BASE = '/api/taylors3d/dashboard_backup/export', MiB = 1024 * 1024;
export const DASHBOARD_EXPORT_LIMITS = Object.freeze({ request: 36 * MiB, archive: 512 * MiB, dashboard: 3 * MiB, layout: 2000000, depth: 64, values: 250000, layouts: 64 });
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const text = (v) => typeof v === 'string' && !!v.trim() && [...v].length <= 64 && [...v].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
const copy = (v) => structuredClone(v);
const messages = { session: 'A current active Home Assistant account is required.', stale: 'The account, connection, selected dashboard or Data screen changed. Read the dashboard again.',
  disposed: 'The backup download is closed.', transport: 'Authenticated dashboard backup downloads are unavailable.', source: 'The full raw dashboard or its resource information could not be collected.',
  shape: 'The backup response or saved layout is malformed; no substitute layout was invented.', size: 'Backup content exceeds its permitted size or complexity.',
  fallback: 'The exact shared or account layout could not be read. No fallback was guessed.', browser: 'This browser cannot read its saved Taylor layout.',
  unauthorized: 'The current account cannot export this dashboard.', unsupported: 'The installed integration does not provide full-dashboard export.',
  network: 'The backup download failed or was interrupted. No partial ZIP is offered.' };
class ExportError extends Error { constructor(code) { super(messages[code]); this.code = code; } }
const requireValue = (condition, code = 'shape') => { if (!condition) throw new ExportError(code); };
function json(value, max) {
  let count = 0; const seen = new Set();
  const walk = (v, depth) => {
    requireValue(++count <= DASHBOARD_EXPORT_LIMITS.values && depth <= 64, 'size');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
    if (typeof v === 'number') { requireValue(Number.isFinite(v)); return; }
    const array = Array.isArray(v); requireValue(array || plain(v)); requireValue(!seen.has(v)); seen.add(v);
    const keys = Reflect.ownKeys(v); if (array) requireValue(keys.length === v.length + 1 && keys.at(-1) === 'length'); let index = 0;
    for (const key of keys) { if (array && key === 'length') continue; requireValue(typeof key === 'string' && (!array || key === String(index++)));
      const d = Object.getOwnPropertyDescriptor(v, key); requireValue(d && Object.hasOwn(d, 'value') && d.enumerable); walk(d.value, depth + 1); }
    seen.delete(v);
  };
  walk(value, 0); const result = JSON.stringify(value); requireValue(new TextEncoder().encode(result).length <= max, 'size'); return result;
}
function rawBrowser(value) {
  requireValue(typeof value === 'string' && new TextEncoder().encode(value).length <= DASHBOARD_EXPORT_LIMITS.layout, 'size');
  let parsed; try { parsed = JSON.parse(value); } catch { throw new ExportError('shape'); } requireValue(plain(parsed)); json(parsed, DASHBOARD_EXPORT_LIMITS.layout); return value;
}
/** create(urlPath,{includeUserFallback,includeBrowserFallback}) re-reads the
 * complete raw dashboard on each deliberate action. Fallback consent applies
 * only to its exact referenced Taylor keys; missing snapshots stay missing.
 * ZIP validity is supplied by the authenticated backend; interrupted output is
 * rejected by actual length. Call revalidate on HA setters; no Blob URLs owned.
 */
export class DashboardBackupExportClient {
  constructor({ getHass, getStorage, isCurrent } = {}) {
    this.getHass = typeof getHass === 'function' ? getHass : () => null;
    this.getStorage = typeof getStorage === 'function' ? getStorage : () => globalThis.localStorage;
    this.isCurrent = typeof isCurrent === 'function' ? isCurrent : () => true;
    this.collector = new DashboardBackupClient({ getHass: this.getHass }); this._session = null; this._generation = 0; this._disposed = false; this._requests = new Set(); this._listeners = null;
  }
  _invalidate() { this._generation++; for (const c of this._requests) c.cancel(); }
  _observe() {
    let hass; try { hass = this.getHass(); } catch { hass = null; } const user = hass?.user, connection = hass?.connection;
    const s = { hass, user, connection, id: user?.id, fetch: hass?.fetchWithAuth, ws: hass?.callWS, auth: hass?.auth, connectionAuth: connection?.options?.auth,
      active: !!user && (!Object.hasOwn(user, 'is_active') || user.is_active === true), admin: user?.is_admin === true, connected: connection?.connected === true };
    if (!this._session || ['user', 'connection', 'id', 'fetch', 'ws', 'auth', 'connectionAuth', 'active', 'admin', 'connected'].some((k) => this._session[k] !== s[k])) {
      if (this._listeners) for (const e of ['disconnected', 'reconnect-error']) this._listeners.connection?.removeEventListener?.(e, this._listeners.lost);
      this._invalidate(); const lost = () => this._invalidate(); this._listeners = { connection, lost };
      for (const e of ['disconnected', 'reconnect-error']) connection?.addEventListener?.(e, lost);
    }
    this._session = s; return s;
  }
  revalidate() { if (this._disposed) return false; this.collector.revalidate(); const s = this._observe();
    let current = false; try { current = this.isCurrent() === true; } catch { /* unavailable parent */ }
    if (!current) this._invalidate(); return s.connected && s.active && typeof s.id === 'string' && !!s.id.trim() && current; }
  _check(c) { requireValue(!this._disposed && !c.cancelled && this.revalidate() && c.generation === this._generation, this._disposed ? 'disposed' : 'stale'); }
  async _await(c, promise) { const value = await Promise.race([promise, c.stopped]); this._check(c); return value; }
  async _ws(c, message) { this._check(c); return this._await(c, Promise.resolve().then(() => { this._check(c); return c.ws.call(c.hass, message); })); }
  async create(urlPath, { includeUserFallback = false, includeBrowserFallback = false } = {}) {
    this.cancel(); let c;
    try {
      requireValue(!this._disposed, 'disposed'); const s = this._observe(); requireValue(s.connected && s.active && typeof s.id === 'string' && !!s.id.trim(), 'session');
      requireValue(typeof s.fetch === 'function' && typeof s.ws === 'function', 'transport'); requireValue(typeof includeUserFallback === 'boolean' && typeof includeBrowserFallback === 'boolean');
      let cancel; const stopped = new Promise((_, reject) => { cancel = () => { if (c.cancelled) return; c.cancelled = true; c.abort.abort();
        for (const reader of c.readers) Promise.resolve(reader.cancel()).catch(() => {}); reject(new ExportError(this._disposed ? 'disposed' : 'stale')); }; }); stopped.catch(() => {});
      c = { ...s, generation: this._generation, abort: new AbortController(), readers: new Set(), cancelled: false, stopped, cancel }; this._requests.add(c); this._check(c);
      const collection = await this._await(c, this.collector.collect(urlPath));
      requireValue(collection.ok && plain(collection.dashboard) && (Array.isArray(collection.dashboard.views) || plain(collection.dashboard.strategy))
        && (!Object.hasOwn(collection.dashboard, 'strategy') || plain(collection.dashboard.strategy)) && plain(collection.source) && plain(collection.resources), 'source');
      json(collection.dashboard, DASHBOARD_EXPORT_LIMITS.dashboard);
      requireValue(Array.isArray(collection.layout_keys) && collection.layout_keys.length <= 64 && collection.layout_keys.every(text) && new Set(collection.layout_keys).size === collection.layout_keys.length);
      const payload = { dashboard: collection.dashboard, source: collection.source, resources: collection.resources, shared_keys: [], layouts: {} }, provenance = [];
      for (const key of collection.layout_keys) {
        this._check(c); let row = null;
        if (includeUserFallback || includeBrowserFallback) {
          let shared; try { shared = await this._ws(c, { type: 'taylors3d/layout/get', key }); } catch (e) { this._check(c); throw e instanceof ExportError ? e : new ExportError('fallback'); }
          requireValue(plain(shared) && Object.hasOwn(shared, 'layout'), 'fallback');
          if (shared.layout !== null) requireValue(plain(shared.layout), 'fallback');
          if (shared.layout === null) {
            if (includeUserFallback) {
              let user; try { user = await this._ws(c, { type: 'frontend/get_user_data', key: 'taylors3d_' + key }); } catch (e) { this._check(c); throw e instanceof ExportError ? e : new ExportError('fallback'); }
              requireValue(plain(user) && Object.hasOwn(user, 'value'), 'fallback');
              if (user.value != null) { requireValue(plain(user.value), 'fallback'); json(user.value, DASHBOARD_EXPORT_LIMITS.layout);
                row = { backend: 'user', layout: copy(user.value), metadata: { source: 'frontend/get_user_data', scope: 'current_user', user_id: s.id, normalized: false } }; }
            }
            if (!row && includeBrowserFallback) {
              let raw; try { this._check(c); raw = this.getStorage()?.getItem('taylors3d_' + key); } catch (e) { this._check(c); throw e instanceof ExportError ? e : new ExportError('browser'); }
              if (raw !== null && raw !== undefined) row = { backend: 'browser', layout_json: rawBrowser(raw), metadata: { source: 'localStorage', scope: 'same_browser_only', storage_key: 'taylors3d_' + key, normalized: false } };
            }
          }
        }
        if (row) Object.defineProperty(payload.layouts, key, { value: row, enumerable: true, configurable: true, writable: true }); else payload.shared_keys.push(key);
        provenance.push({ key, backend: row?.backend ?? 'shared', note: row ? 'Explicit saved raw fallback snapshot; not an atomic Home Assistant transaction.' : 'The server reads this exact shared key. Missing data will be reported.' });
      }
      const body = json(payload, DASHBOARD_EXPORT_LIMITS.request); this._check(c);
      const response = await this._await(c, Promise.resolve().then(() => { this._check(c); return c.fetch.call(c.hass, BASE,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, redirect: 'error', signal: c.abort.signal }); }));
      if ([401, 403].includes(response?.status)) throw new ExportError('unauthorized'); if ([404, 501].includes(response?.status)) throw new ExportError('unsupported');
      requireValue(response?.status >= 200 && response.status < 300, 'network'); requireValue(response.redirected !== true);
      if (response.url) requireValue(new URL(response.url, 'http://backup.invalid').pathname === BASE);
      requireValue(response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/zip');
      const header = response.headers.get('x-taylors3d-complete'), length = response.headers.get('content-length');
      requireValue(header === 'true' || header === 'false'); requireValue(/^\d+$/.test(length || '') && Number(length) > 0 && Number(length) <= DASHBOARD_EXPORT_LIMITS.archive, 'size');
      requireValue(response.body && typeof response.body.getReader === 'function'); const reader = response.body.getReader(); c.readers.add(reader); const parts = []; let size = 0, ended = false;
      try { while (true) { const chunk = await this._await(c, reader.read()); if (chunk.done) { ended = true; break; }
        requireValue(chunk.value instanceof Uint8Array); size += chunk.value.byteLength; requireValue(size <= Number(length) && size <= DASHBOARD_EXPORT_LIMITS.archive, 'size'); parts.push(chunk.value.slice()); }
      } finally { c.readers.delete(reader); if (!ended) Promise.resolve(reader.cancel()).catch(() => {}); reader.releaseLock(); }
      requireValue(size === Number(length), 'network'); this._check(c);
      return { ok: true, blob: new Blob(parts, { type: 'application/zip' }), complete: header === 'true', filename: 'taylors3d-dashboard-backup.zip',
        collection: copy(collection), provenance, warnings: ['Declared resources and external model URLs are not downloaded or installed.', 'Saved snapshots are not an atomic live Home Assistant transaction.', ...(header === 'false' ? ['This archive is incomplete. Inspect its missing dependencies before restoring.'] : [])] };
    } catch (error) { return { ok: false, blob: null, complete: false, diagnostics: [{ code: error instanceof ExportError ? error.code : 'network', message: messages[error instanceof ExportError ? error.code : 'network'] }] }; }
    finally { if (c) { this._requests.delete(c); if (!c.cancelled) c.cancel(); } }
  }
  cancel() { this._invalidate(); this.collector.dispose(); if (!this._disposed) this.collector = new DashboardBackupClient({ getHass: this.getHass }); }
  dispose() { if (this._disposed) return; this._disposed = true; this.cancel();
    if (this._listeners) for (const e of ['disconnected', 'reconnect-error']) this._listeners.connection?.removeEventListener?.(e, this._listeners.lost); this._listeners = null; }
}
