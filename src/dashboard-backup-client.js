// FUTURE, read-only transport. This module does not save/restore configurations,
// instantiate cards, normalize layouts, fetch resource URLs or collect asset bytes.
// HA's callWS already decodes its messages: these limits bound retained/serialized
// responses, not the underlying WebSocket frame allocation. Raw wire bytes and
// concurrent server-side edits cannot be made atomic through these read APIs.
// Official command contracts:
// https://github.com/home-assistant/frontend/blob/dev/src/data/lovelace/config/types.ts
// https://github.com/home-assistant/frontend/blob/dev/src/data/lovelace/resource.ts
// https://github.com/home-assistant/core/blob/dev/homeassistant/components/lovelace/dashboard.py

const MiB = 1024 * 1024;
export const DASHBOARD_BACKUP_CLIENT_LIMITS = Object.freeze({ dashboard: 3 * MiB,
  metadata: 4 * MiB, info: 64 * 1024, depth: 64, values: 250000,
  dashboards: 1024, resources: 4096, cards: 4096, layouts: 64, diagnostics: 4096 });
const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const messages = Object.freeze({ session: 'A current active Home Assistant session is required.',
  transport: 'Home Assistant dashboard reads are unavailable.', stale: 'The selected dashboard or Home Assistant session changed. Collect it again.',
  disposed: 'The dashboard backup client is closed.', url_path: 'Select an exact dashboard URL path, or explicitly select the default with null.',
  unauthorized: 'The current account cannot read this dashboard information.', missing: 'The selected dashboard configuration is unavailable.',
  unsupported: 'This Home Assistant instance does not provide this dashboard read.', network: 'The dashboard read failed. Try again with the current connection.',
  shape: 'Home Assistant returned malformed dashboard information.', json_type: 'Use only raw JSON values without implicit conversion.',
  json_number: 'Nonfinite JSON numbers cannot be backed up.', utf8: 'JSON text must contain valid Unicode.',
  json_complexity: 'Dashboard JSON exceeds its depth or value budget.', json_cycle: 'Cyclic source data cannot be backed up.',
  json_size: 'Dashboard information exceeds its retained JSON byte budget.', wire_budget: 'The complete dashboard save message would exceed the 3 MiB UTF-8 budget.',
  card_budget: 'At most 4096 Taylor card references are supported.', count: 'At most 64 distinct Taylor layout keys are supported.',
  diagnostic_budget: 'Too many missing references or external dependencies were reported.', ambiguous: 'Dashboard addresses must identify one exact source.',
});
class BackupClientError extends Error { constructor(code, path = '') { super(messages[code]); this.code = code; this.path = path; } }
const fail = (code, path = '') => { throw new BackupClientError(code, path); };
const requireValue = (condition, code = 'shape', path = '') => { if (!condition) fail(code, path); };
const characters = (value) => { let count = 0; for (let i = 0; i < value.length; i++, count++) {
  const code = value.charCodeAt(i); if (code >= 0xd800 && code <= 0xdbff) i++;
} return count; };
function unicode(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++i); requireValue(next >= 0xdc00 && next <= 0xdfff, 'utf8'); }
    else requireValue(code < 0xdc00 || code > 0xdfff, 'utf8');
  }
}
const controls = (value) => { for (let i = 0; i < value.length; i++) {
  const code = value.charCodeAt(i); if (code < 32 || code === 127) return true;
} return false; };
const text = (value, maximum) => typeof value === 'string' && !!value.trim() && characters(value) <= maximum && !controls(value);
const escapePointer = (key) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const issue = (code, path, message, severity = 'missing') => ({ code, path, message, severity });
const diagnostic = (error, path = '') => {
  const code = error instanceof BackupClientError ? error.code
    : ['unauthorized', 'not_authorized'].includes(error?.code) ? 'unauthorized'
      : ['not_found', 'config_not_found'].includes(error?.code) ? 'missing'
        : error?.code === 'unknown_command' ? 'unsupported' : 'network';
  return issue(code, error instanceof BackupClientError && error.path ? error.path : path, messages[code]);
};

// Clone from descriptors so getters/toJSON/prototype coercions cannot alter an
// archive or execute while collecting. Shared JSON references are copied, not
// mistaken for cycles; __proto__ is preserved as an ordinary own JSON field.
function jsonSnapshot(value, maximum, path) {
  let count = 0, bytes = 0; const ancestors = new Set();
  const add = (length) => { bytes += length; requireValue(bytes <= maximum, 'json_size', path); };
  const string = (entry) => {
    requireValue(entry.length <= maximum, 'json_size', path); unicode(entry);
    add(new TextEncoder().encode(JSON.stringify(entry)).byteLength); return entry;
  };
  const walk = (entry, depth) => {
    requireValue(++count <= DASHBOARD_BACKUP_CLIENT_LIMITS.values && depth <= DASHBOARD_BACKUP_CLIENT_LIMITS.depth, 'json_complexity', path);
    if (typeof entry === 'string') return string(entry);
    if (typeof entry === 'number') { requireValue(Number.isFinite(entry), 'json_number', path); add(JSON.stringify(entry).length); return entry; }
    if (entry === null || typeof entry === 'boolean') { add(entry === null ? 4 : entry ? 4 : 5); return entry; }
    requireValue(Array.isArray(entry) || plain(entry), 'json_type', path);
    requireValue(!ancestors.has(entry), 'json_cycle', path); ancestors.add(entry);
    const array = Array.isArray(entry), keys = Reflect.ownKeys(entry), result = array ? [] : {};
    if (array) {
      requireValue(entry.length <= DASHBOARD_BACKUP_CLIENT_LIMITS.values && keys.length === entry.length + 1
        && keys.at(-1) === 'length', 'json_type', path);
    }
    add(2); let index = 0;
    for (const key of keys) {
      if (array && key === 'length') continue;
      requireValue(typeof key === 'string' && (!array || key === String(index)), 'json_type', path);
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      requireValue(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'json_type', path);
      if (index++) add(1);
      if (!array) { requireValue(++count <= DASHBOARD_BACKUP_CLIENT_LIMITS.values && depth + 1 <= DASHBOARD_BACKUP_CLIENT_LIMITS.depth, 'json_complexity', path); string(key); add(1); }
      const child = walk(descriptor.value, depth + 1);
      Object.defineProperty(result, key, { value: child, enumerable: true, configurable: true, writable: true });
    }
    ancestors.delete(entry); return result;
  };
  return walk(value, 0);
}

function dashboardsSnapshot(raw) {
  const list = jsonSnapshot(raw, DASHBOARD_BACKUP_CLIENT_LIMITS.metadata, 'dashboards');
  requireValue(Array.isArray(list) && list.length <= DASHBOARD_BACKUP_CLIENT_LIMITS.dashboards);
  const seen = new Set();
  for (const item of list) {
    requireValue(plain(item) && text(item.url_path, 256) && ['yaml', 'storage'].includes(item.mode), 'shape', 'dashboards');
    requireValue(!seen.has(item.url_path), 'ambiguous', 'dashboards'); seen.add(item.url_path);
    for (const field of ['require_admin', 'show_in_sidebar']) if (Object.hasOwn(item, field)) requireValue(typeof item[field] === 'boolean', 'shape', 'dashboards');
    if (Object.hasOwn(item, 'id')) requireValue(text(item.id, 256), 'shape', 'dashboards');
    if (Object.hasOwn(item, 'title')) requireValue(typeof item.title === 'string', 'shape', 'dashboards');
  }
  return list;
}
function resourcesSnapshot(raw, info) {
  const items = jsonSnapshot(raw, DASHBOARD_BACKUP_CLIENT_LIMITS.metadata, 'resources');
  requireValue(Array.isArray(items) && items.length <= DASHBOARD_BACKUP_CLIENT_LIMITS.resources, 'shape', 'resources');
  for (const item of items) requireValue(plain(item) && text(item.url, 4096) && ['css', 'js', 'module', 'html'].includes(item.type), 'shape', 'resources');
  return jsonSnapshot({ mode: info?.resource_mode ?? null, items }, DASHBOARD_BACKUP_CLIENT_LIMITS.metadata, 'resources');
}
function discover(dashboard) {
  const cards = [], layoutKeys = new Set(), diagnostics = [], pending = [[dashboard, '']];
  while (pending.length) {
    const [item, pointer] = pending.pop();
    if (plain(item)) {
      if (item.type === 'custom:taylors3d-card') {
        const rawKey = Object.hasOwn(item, 'layout_key') ? item.layout_key : 'default', key = text(rawKey, 64) ? rawKey : null;
        cards.push({ pointer, layout_key: key }); requireValue(cards.length <= DASHBOARD_BACKUP_CLIENT_LIMITS.cards, 'card_budget');
        if (key === null) diagnostics.push(issue('layout_key', pointer, 'This Taylor card has an invalid explicit layout key; no replacement was guessed.'));
        else { layoutKeys.add(key); requireValue(layoutKeys.size <= DASHBOARD_BACKUP_CLIENT_LIMITS.layouts, 'count'); }
        if (item.model) diagnostics.push(typeof item.model === 'string' && item.model.trim()
          ? issue('model_dependency', pointer + '/model', 'The explicit model source remains an unchanged dependency; no URL was downloaded.', 'dependency')
          : issue('model_reference', pointer + '/model', 'The explicit model source is malformed; its raw value is preserved.'));
      }
      for (const key of Object.keys(item).reverse()) pending.push([item[key], pointer + '/' + escapePointer(key)]);
    } else if (Array.isArray(item)) for (let i = item.length - 1; i >= 0; i--) pending.push([item[i], pointer + '/' + i]);
  }
  return { cards, layout_keys: [...layoutKeys], diagnostics };
}
const emptyCollection = () => ({ dashboard: null, source: null, resources: null, info: null, cards: [], layout_keys: [], collectionReady: false });

/** collect(urlPath) requires a string or explicit null. collectionReady proves
 * only a dashboard/metadata/resource snapshot, never complete asset coverage or
 * an atomic live-server snapshot. Unknown default source mode remains null.
 * Future HA setter integration must call revalidate() to latch observed account,
 * permission/auth loss and recovery even if the same objects later recover.
 */
export class DashboardBackupClient {
  constructor({ getHass } = {}) {
    this.getHass = typeof getHass === 'function' ? getHass : () => null;
    this._session = null; this._listeners = null; this._generation = 0; this._disposed = false;
    this._requests = new Set(); this._selection = 0; this._order = 0; this._latest = 0; this._diagnostics = [];
  }
  get generation() { return this._generation; }
  get diagnostics() { return structuredClone(this._diagnostics); }
  _invalidate() {
    this._generation++; this._diagnostics = [];
    for (const request of this._requests) request.cancel(this._disposed ? 'disposed' : 'stale');
  }
  _observe() {
    let hass; try { hass = this.getHass(); } catch { hass = null; }
    const user = hass?.user, connection = hass?.connection;
    const next = { hass, user, connection, id: user?.id, callWS: hass?.callWS, auth: hass?.auth, connectionAuth: connection?.options?.auth,
      connected: connection?.connected === true, active: !!user && (!Object.hasOwn(user, 'is_active') || user.is_active === true), admin: user?.is_admin === true };
    const old = this._session;
    if (!old || ['user', 'connection', 'id', 'callWS', 'auth', 'connectionAuth', 'connected', 'active', 'admin'].some((key) => old[key] !== next[key])) {
      if (this._listeners) for (const event of ['disconnected', 'reconnect-error']) this._listeners.connection?.removeEventListener?.(event, this._listeners.lost);
      this._invalidate(); this._session = next;
      const lost = () => { if (!this._disposed && this._session?.connection === connection) this._invalidate(); };
      this._listeners = { connection, lost };
      for (const event of ['disconnected', 'reconnect-error']) connection?.addEventListener?.(event, lost);
    } else this._session = next;
    return next;
  }
  revalidate() {
    if (this._disposed) return false;
    const session = this._observe(); return session.connected && session.active && text(session.id, 256) && typeof session.callWS === 'function';
  }
  _current(context) {
    if (this._disposed || context.cancelled) return false;
    const session = this._observe();
    return context.generation === this._generation && session.connected && session.active && text(session.id, 256)
      && (!context.selection || context.selection === this._selection);
  }
  _check(context) { if (!this._current(context)) fail(this._disposed ? 'disposed' : 'stale'); }
  async _run(selection, empty, work) {
    const order = ++this._order; this._latest = order; let context;
    try {
      if (this._disposed) fail('disposed'); const session = this._observe();
      requireValue(session.connected && session.active && text(session.id, 256), 'session'); requireValue(typeof session.callWS === 'function', 'transport');
      let cancel; const stopped = new Promise((_, reject) => { cancel = (code) => { context.cancelled = true; reject(new BackupClientError(code)); }; });
      stopped.catch(() => {}); // Invalid inputs can finish before any read attaches.
      // Register immediately; each read attaches to this fence before calling HA.
      context = { ...session, generation: this._generation, order, selection, stopped, cancel, cancelled: false };
      this._requests.add(context); const result = await work(context); this._check(context);
      if (order === this._latest) this._diagnostics = structuredClone(result.diagnostics || []);
      return { ok: true, ...result, generation: context.generation, diagnostics: result.diagnostics || [] };
    } catch (error) {
      const current = context ? this._current(context) : !this._disposed;
      const diagnostics = [diagnostic(this._disposed ? new BackupClientError('disposed') : !current ? new BackupClientError('stale') : error)];
      if (current && order === this._latest) this._diagnostics = structuredClone(diagnostics);
      return { ok: false, ...empty(), generation: this._generation, diagnostics };
    } finally {
      if (context) { this._requests.delete(context); if (!context.cancelled) context.cancel('stale'); }
    }
  }
  async _read(context, message, transform) {
    this._check(context);
    // The local fence settles/discards UI work; HA callWS has no per-command
    // AbortSignal. It does not cancel a read already sent on the shared socket.
    const response = await Promise.race([Promise.resolve().then(() => { this._check(context); return context.callWS.call(context.hass, message); }), context.stopped]);
    this._check(context); return transform(response);
  }
  dashboards() {
    return this._run(null, () => ({ dashboards: null }), async (context) => ({ dashboards: await this._read(context, { type: 'lovelace/dashboards/list' }, dashboardsSnapshot) }));
  }
  collect(urlPath) {
    const selection = ++this._selection;
    for (const request of this._requests) if (request.selection) request.cancel('stale');
    return this._run(selection, emptyCollection, async (context) => {
      requireValue(urlPath === null || text(urlPath, 256), 'url_path');
      if (typeof urlPath === 'string') unicode(urlPath);
      const read = (message, transform) => this._read(context, message, transform).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
      const config = read({ type: 'lovelace/config', url_path: urlPath, force: true }, (raw) => {
        const dashboard = jsonSnapshot(raw, DASHBOARD_BACKUP_CLIENT_LIMITS.dashboard, 'dashboard'); requireValue(plain(dashboard));
        const wire = { id: 1, type: 'lovelace/config/save', url_path: urlPath, config: dashboard };
        requireValue(new TextEncoder().encode(JSON.stringify(wire)).byteLength <= DASHBOARD_BACKUP_CLIENT_LIMITS.dashboard, 'wire_budget', 'dashboard'); return dashboard;
      });
      const listed = read({ type: 'lovelace/dashboards/list' }, dashboardsSnapshot);
      const resources = read({ type: 'lovelace/resources' }, (raw) => jsonSnapshot(raw, DASHBOARD_BACKUP_CLIENT_LIMITS.metadata, 'resources'));
      const info = read({ type: 'lovelace/info' }, (raw) => {
        const result = jsonSnapshot(raw, DASHBOARD_BACKUP_CLIENT_LIMITS.info, 'info');
        requireValue(plain(result) && ['storage', 'yaml'].includes(result.resource_mode), 'shape', 'info'); return result;
      });
      const captured = await config; if (!captured.ok) throw captured.error;
      const [listResult, resourceResult, infoResult] = await Promise.all([listed, resources, info]); this._check(context);
      const dashboard = captured.value, discovered = discover(dashboard), diagnostics = discovered.diagnostics;
      if (!Array.isArray(dashboard.views) && !plain(dashboard.strategy)) diagnostics.push(issue('dashboard_shape', 'dashboard.json',
        'Preserve a raw dashboard with views or an explicit strategy; this raw source is not ready for an archive.'));
      let metadata = {}, mode = null, resourceSnapshot = null;
      if (listResult.ok) {
        const selected = listResult.value.find((row) => row.url_path === urlPath);
        metadata = selected || {};
        if (metadata?.require_admin === true && !context.admin) fail('unauthorized', 'source');
        if (selected) mode = metadata.mode;
        else if (urlPath !== null) diagnostics.push(issue('source_metadata', 'source', 'The selected named dashboard is not in the current dashboard list; its raw configuration is retained.'));
      } else diagnostics.push(diagnostic(listResult.error, 'source'));
      if (Object.hasOwn(dashboard, 'strategy')) {
        if (plain(dashboard.strategy)) mode = 'generated';
        else diagnostics.push(issue('dashboard_strategy', 'dashboard/strategy', 'The raw strategy setting is malformed; no generated dashboard was substituted.'));
      }
      if (mode === null) diagnostics.push(issue('source_mode', 'source', 'The dashboard read does not prove its storage or YAML source mode; no mode was guessed.'));
      if (!resourceResult.ok) diagnostics.push(diagnostic(resourceResult.error, 'resources'));
      if (!infoResult.ok) diagnostics.push(diagnostic(infoResult.error, 'info'));
      if (resourceResult.ok) {
        try { resourceSnapshot = resourcesSnapshot(resourceResult.value, infoResult.ok ? infoResult.value : null); }
        catch (error) { diagnostics.push(diagnostic(error, 'resources')); }
      }
      if (resourceSnapshot) resourceSnapshot.items.forEach((_, i) => diagnostics.push(issue('resource_dependency', `resources.items[${i}]`,
        'This unchanged dashboard resource reference requires its separately installed source.', 'dependency')));
      requireValue(diagnostics.length <= DASHBOARD_BACKUP_CLIENT_LIMITS.diagnostics, 'diagnostic_budget');
      return { dashboard, source: { url_path: urlPath, mode, metadata }, resources: resourceSnapshot,
        info: infoResult.ok ? infoResult.value : null, cards: discovered.cards, layout_keys: discovered.layout_keys,
        collectionReady: mode !== null && resourceSnapshot?.mode != null && !diagnostics.some((row) => row.severity === 'missing'), diagnostics };
    });
  }
  dispose() {
    if (this._disposed) return; this._disposed = true;
    if (this._listeners) for (const event of ['disconnected', 'reconnect-error']) this._listeners.connection?.removeEventListener?.(event, this._listeners.lost);
    this._listeners = null; this._invalidate(); this._session = null;
  }
}
