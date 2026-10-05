// FUTURE transport foundation; not registered or connected to the card UI.
// Inspect is read-only. Stage writes only verified Taylor assets/layouts. Publish
// is a separate, explicit new-dashboard operation. No resources are installed.
// Official HA contracts: frontend/src/data/lovelace/{dashboard.ts,config/types.ts}
// and core/homeassistant/components/lovelace/websocket.py (force:true and the
// exact config_not_found error). Public reads provide no CAS/transaction guarantee.

const MiB = 1024 * 1024, BASE = '/api/taylors3d/dashboard_backup';
export const DASHBOARD_RESTORE_CLIENT_LIMITS = Object.freeze({ archive: 512 * MiB,
  response: 36 * MiB, dashboard: 3 * MiB, manifest: 4 * MiB, layout: 2000000,
  depth: 64, values: 250000, dashboards: 1024, layouts: 64, models: 64, packs: 128, diagnostics: 4096 });
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const integer = (v, max, min = 0) => Number.isSafeInteger(v) && v >= min && v <= max;
const hash = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const namespaceValid = (v) => typeof v === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/.test(v);
const targetFor = (namespace) => 'taylors3d-restore-' + namespace;
const text = (v, max = 256) => {
  if (typeof v !== 'string' || !v.trim() || [...v].length > max) return false;
  for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i); if (n < 32 || n === 127) return false; } return true;
};
const encode = (v) => new TextEncoder().encode(JSON.stringify(v));
const copy = (v) => structuredClone(v);
const messages = Object.freeze({ session: 'A current active administrator session is required.',
  transport: 'Home Assistant authenticated restore transport is unavailable.', disposed: 'The dashboard restore client is closed.',
  stale: 'The backup choice or Home Assistant session changed. Review the backup again.',
  approval: 'Explicit approval of this exact preview or publication is required.', token: 'This restore intent is no longer current. Review and stage again.',
  namespace: 'Use a new lowercase namespace of 1 to 24 letters, digits or hyphens, with a letter or digit at each end.',
  file: 'Choose one nonempty ZIP of at most 512 MiB.', shape: 'The restore response is malformed or inconsistent.',
  size: 'Restore data exceeds its byte, count or complexity budget.', json: 'Restore data must be finite raw JSON with valid Unicode and no duplicate keys.',
  network: 'The restore request failed. Its result may require checking before a new attempt.',
  unauthorized: 'The current account cannot perform this restore operation.', unsupported: 'This Home Assistant instance does not provide the requested restore operation.',
  collision: 'The new dashboard address already exists. Nothing was overwritten.',
  changed: 'The newly created dashboard identity or configuration changed. Its configuration was not saved.',
  incomplete: 'This backup is incomplete. Explicit incomplete-restore approval is required.',
  stage: 'Staging failed. Review any reported staged files before choosing a new namespace.' });
class RestoreError extends Error { constructor(code, details = null) { super(messages[code]); this.code = code; this.details = details; } }
const fail = (code, details) => { throw new RestoreError(code, details); };
const requireValue = (value, code = 'shape') => { if (!value) fail(code); };
function unicode(v) {
  for (let i = 0; i < v.length; i++) {
    const n = v.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); requireValue(next >= 0xdc00 && next <= 0xdfff, 'json'); }
    else requireValue(n < 0xdc00 || n > 0xdfff, 'json');
  }
}
// Descriptor-only snapshots preserve unknown fields, including own __proto__,
// without invoking getters/toJSON. Bounds apply before retaining the snapshot.
function snapshot(value, maximum = DASHBOARD_RESTORE_CLIENT_LIMITS.response) {
  let bytes = 0, count = 0; const ancestors = new Set(), limits = DASHBOARD_RESTORE_CLIENT_LIMITS;
  const add = (n) => { bytes += n; requireValue(bytes <= maximum, 'size'); };
  const string = (v) => { requireValue(v.length <= maximum, 'size'); unicode(v); add(encode(v).length); return v; };
  const walk = (v, depth) => {
    requireValue(++count <= limits.values && depth <= limits.depth, 'size');
    if (typeof v === 'string') return string(v);
    if (typeof v === 'number') { requireValue(Number.isFinite(v), 'json'); add(JSON.stringify(v).length); return v; }
    if (v === null || typeof v === 'boolean') { add(v === null ? 4 : v ? 4 : 5); return v; }
    const array = Array.isArray(v); requireValue(array || plain(v), 'json'); requireValue(!ancestors.has(v), 'json'); ancestors.add(v);
    const keys = Reflect.ownKeys(v), result = array ? [] : {}; add(2);
    if (array) requireValue(v.length <= limits.values && keys.length === v.length + 1 && keys.at(-1) === 'length', 'json');
    let index = 0;
    for (const key of keys) {
      if (array && key === 'length') continue;
      requireValue(typeof key === 'string' && (!array || key === String(index)), 'json');
      const descriptor = Object.getOwnPropertyDescriptor(v, key); requireValue(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'json');
      if (index++) add(1);
      if (!array) { requireValue(++count <= limits.values, 'size'); string(key); add(1); }
      Object.defineProperty(result, key, { value: walk(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    ancestors.delete(v); return result;
  };
  return walk(value, 0);
}
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function parse(bytes) {
  let source; try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('json'); }
  // Reject duplicate object keys and excessive nesting before JSON.parse. Escaped
  // spellings of the same key are the same key; arrays never infer replacements.
  const frames = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      const start = i; while (++i < source.length) { if (source[i] === '\\') i++; else if (source[i] === '"') break; }
      const frame = frames.at(-1);
      if (frame?.keys && frame.next) {
        let key; try { key = JSON.parse(source.slice(start, i + 1)); } catch { fail('json'); }
        requireValue(!frame.keys.has(key), 'json'); frame.keys.add(key); frame.next = false;
      }
    } else if (c === '{' || c === '[') { frames.push(c === '{' ? { keys: new Set(), next: true } : {}); requireValue(frames.length <= 65, 'size'); }
    else if (c === '}' || c === ']') frames.pop();
    else if (c === ',' && frames.at(-1)?.keys) frames.at(-1).next = true;
  }
  let value; try { value = JSON.parse(source); } catch { fail('json'); } return snapshot(value);
}
function dashboard(raw, path) {
  const result = snapshot(raw, DASHBOARD_RESTORE_CLIENT_LIMITS.dashboard);
  requireValue(plain(result) && (Array.isArray(result.views) || plain(result.strategy))
    && (!Object.hasOwn(result, 'strategy') || plain(result.strategy)));
  requireValue(encode({ id: Number.MAX_SAFE_INTEGER, type: 'lovelace/config/save', url_path: path, config: result }).length <= DASHBOARD_RESTORE_CLIENT_LIMITS.dashboard, 'size');
  return result;
}
const list = (v, max) => Array.isArray(v) && v.length <= max;
function diagnostics(v) { requireValue(list(v, 4096)); for (const row of v) requireValue(plain(row) && text(row.code, 128)
  && typeof row.path === 'string' && row.path.length <= 4096 && text(row.message, 4096) && ['missing', 'dependency', 'info'].includes(row.severity)); }
function counts(v, members = false) {
  requireValue(plain(v));
  for (const [key, max] of [['cards', 4096], ['layouts', 64], ['models', 64], ['furniture_packs', 128], ...(members ? [['members', 258]] : [])]) requireValue(integer(v[key], max));
}
function inspectSnapshot(raw) {
  const result = snapshot(raw), { manifest, report, preview } = result;
  requireValue(plain(manifest) && manifest.format === 'taylors3d-dashboard-backup' && manifest.version === 1 && typeof manifest.complete === 'boolean');
  snapshot(manifest, DASHBOARD_RESTORE_CLIENT_LIMITS.manifest);
  for (const [key, max] of [['cards', 4096], ['layouts', 64], ['models', 64], ['furniture', 128]]) requireValue(list(manifest[key], max));
  requireValue(plain(report) && typeof report.complete === 'boolean'); counts(report.counts, true); diagnostics(report.diagnostics);
  for (const key of ['expanded_bytes', 'nested_expanded_bytes', 'verified_expanded_bytes']) requireValue(integer(report[key], DASHBOARD_RESTORE_CLIENT_LIMITS.archive));
  requireValue(plain(preview) && plain(preview.layouts) && Object.keys(preview.layouts).length <= 64 && result.restoreAvailable === false);
  dashboard(preview.dashboard, 'taylors3d-restore-' + 'x'.repeat(24));
  for (const row of Object.values(preview.layouts)) { requireValue(plain(row) && text(row.backend, 64) && plain(row.metadata) && plain(row.layout)); snapshot(row.layout, DASHBOARD_RESTORE_CLIENT_LIMITS.layout); }
  return result;
}
const keyFor = (key, namespace) => text(key, 64) && /^[A-Za-z0-9_-]{1,64}$/.test(key) && key.startsWith('restore_' + namespace + '_');
function stageSnapshot(raw, namespace, allowIncomplete) {
  const result = snapshot(raw), { target_dashboard: target, save_message: save, staging, report } = result;
  const path = targetFor(namespace); requireValue(result.ok === true && result.namespace === namespace && typeof result.restore_id === 'string' && /^[0-9a-f]{32}$/.test(result.restore_id));
  requireValue(plain(target) && target.url_path === path && target.mode === 'storage' && text(target.title, 256));
  for (const k of ['require_admin', 'show_in_sidebar']) if (Object.hasOwn(target, k)) requireValue(typeof target[k] === 'boolean');
  if (Object.hasOwn(target, 'icon')) requireValue(text(target.icon, 256));
  requireValue(plain(save) && Object.keys(save).length === 4 && save.id === 1 && save.type === 'lovelace/config/save' && save.url_path === path);
  dashboard(save.config, path);
  requireValue(plain(report) && report.valid === true && typeof report.complete === 'boolean' && typeof report.archive_complete === 'boolean'
    && report.allow_incomplete === allowIncomplete && report.publication_available === false && report.resources_installed === false
    && report.requires_current_admin_at_publication === true && report.requires_shared_integration === true);
  requireValue(report.complete || allowIncomplete, 'incomplete'); counts(report.counts); diagnostics(report.diagnostics);
  requireValue(plain(report.collision_checked) && report.collision_checked.internal === true && report.collision_checked.external === false);
  const targets = report.collision_targets; requireValue(plain(targets) && targets.dashboard_url_path === path);
  for (const field of ['layout_keys', 'model_keys']) requireValue(list(targets[field], 64) && new Set(targets[field]).size === targets[field].length && targets[field].every((key) => keyFor(key, namespace)));
  requireValue(list(targets.legacy_fallback_keys, 64) && targets.legacy_fallback_keys.length === targets.layout_keys.length
    && targets.layout_keys.every((key, i) => targets.legacy_fallback_keys[i] === 'taylors3d_' + key));
  requireValue(plain(result.resources) && list(result.resources.items, 4096));
  requireValue(plain(staging) && staging.integrity_verified === true && staging.integrity_scope === 'present_assets_and_populated_shared_layouts'
    && staging.layouts_persistence === 'scheduled_not_durable' && staging.dashboard_created === false && staging.resources_installed === false);
  const evidence = staging.collision_evidence;
  requireValue(plain(evidence) && evidence.dashboard === 'absent_at_check' && evidence.user_fallbacks === 'all_current_users_absent_at_check'
    && evidence.browser === 'not_read;unchanged_and_shadowed_by_populated_shared_layouts' && evidence.transaction === false);
  for (const [field, max] of [['models', 64], ['layouts', 64], ['furniture', 128], ['unavailable', 192]]) requireValue(list(staging[field], max));
  const seen = new Set();
  for (const row of staging.models) { requireValue(plain(row) && keyFor(row.target_key, namespace) && !seen.has('m' + row.target_key)
    && targets.model_keys.includes(row.target_key) && hash(row.sha256) && integer(row.bytes, 100 * MiB, 1) && row.exclusive === true && row.integrity_verified === true); seen.add('m' + row.target_key); }
  for (const row of staging.layouts) { requireValue(plain(row) && keyFor(row.target_key, namespace) && !seen.has('l' + row.target_key)
    && targets.layout_keys.includes(row.target_key) && hash(row.original_sha256) && hash(row.staged_json_sha256) && row.persistence === 'scheduled_not_durable'); seen.add('l' + row.target_key); }
  requireValue(staging.layouts.length === targets.layout_keys.length);
  for (const row of staging.furniture) { requireValue(plain(row) && hash(row.pack_id) && row.sha256 === row.pack_id && typeof row.imported === 'boolean' && !seen.has('p' + row.pack_id)); seen.add('p' + row.pack_id); }
  for (const row of staging.unavailable) requireValue(plain(row) && ['model', 'furniture'].includes(row.kind)
    && (row.source_key === null || text(row.source_key, 64)) && (row.pack_id === null || hash(row.pack_id)));
  requireValue(report.counts.layouts === staging.layouts.length && targets.model_keys.length === report.counts.models
    && report.counts.models === staging.models.length + staging.unavailable.filter((row) => row.kind === 'model').length
    && report.counts.furniture_packs === staging.furniture.length + staging.unavailable.filter((row) => row.kind === 'furniture').length
    && (!staging.unavailable.length || report.complete === false));
  requireValue(list(result.orphans, 0)); return result;
}
function dashboards(raw) {
  const rows = snapshot(raw, DASHBOARD_RESTORE_CLIENT_LIMITS.manifest); requireValue(list(rows, 1024)); const seen = new Set();
  for (const row of rows) {
    // HA's list includes YAML dashboard.config objects, which have url_path
    // but no storage collection ID. The new storage record still requires ID.
    requireValue(plain(row) && text(row.url_path) && ['storage', 'yaml'].includes(row.mode) && !seen.has(row.url_path)); seen.add(row.url_path);
    if (Object.hasOwn(row, 'id')) requireValue(text(row.id));
    for (const k of ['require_admin', 'show_in_sidebar']) if (Object.hasOwn(row, k)) requireValue(typeof row[k] === 'boolean');
    if (Object.hasOwn(row, 'title')) requireValue(typeof row.title === 'string');
  }
  return rows;
}
function stageFailure(raw, namespace) {
  requireValue(plain(raw) && raw.ok === false && raw.namespace === namespace && raw.publication_available === false
    && plain(raw.staging) && list(raw.orphans, 256));
  const staging = {};
  for (const [field, max, kind] of [['models', 64, 'model'], ['layouts', 64, 'layout'], ['furniture', 128, 'furniture']]) {
    requireValue(list(raw.staging[field], max));
    staging[field] = raw.staging[field].map((row) => {
      requireValue(plain(row) && (kind === 'furniture' ? hash(row.pack_id) && row.sha256 === row.pack_id && typeof row.imported === 'boolean' : keyFor(row.target_key, namespace)));
      if (kind === 'model') requireValue(hash(row.sha256) && integer(row.bytes, 100 * MiB, 1) && row.exclusive === true && row.integrity_verified === true);
      if (kind === 'layout') requireValue(hash(row.original_sha256) && hash(row.staged_json_sha256) && row.persistence === 'scheduled_not_durable');
      const fields = kind === 'model' ? ['target_key', 'sha256', 'bytes', 'exclusive', 'integrity_verified']
        : kind === 'layout' ? ['target_key', 'original_sha256', 'staged_json_sha256', 'persistence'] : ['pack_id', 'sha256', 'imported'];
      return Object.fromEntries(fields.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
    });
  }
  const orphans = raw.orphans.map((row) => {
    requireValue(plain(row) && ['model', 'layout', 'furniture'].includes(row.kind) && typeof row.status === 'string' && /^[a-z0-9_]{1,128}$/.test(row.status)
      && (row.kind === 'furniture' ? hash(row.pack_id) : keyFor(row.target_key, namespace)));
    for (const field of ['sha256', 'original_sha256', 'staged_json_sha256']) if (Object.hasOwn(row, field)) requireValue(hash(row[field]));
    if (Object.hasOwn(row, 'bytes')) requireValue(integer(row.bytes, 100 * MiB, 1));
    if (Object.hasOwn(row, 'imported')) requireValue(typeof row.imported === 'boolean');
    if (Object.hasOwn(row, 'persistence')) requireValue(row.persistence === 'scheduled_not_durable');
    return Object.fromEntries(['kind', 'status', 'target_key', 'pack_id', 'sha256', 'original_sha256', 'staged_json_sha256', 'bytes', 'persistence', 'imported']
      .filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
  });
  return { staging, orphans };
}
function created(raw, target) {
  const row = snapshot(raw, DASHBOARD_RESTORE_CLIENT_LIMITS.manifest);
  requireValue(plain(row) && text(row.id) && row.url_path === target.url_path && row.mode === 'storage' && row.title === target.title
    && row.require_admin === (target.require_admin ?? false) && row.show_in_sidebar === (target.show_in_sidebar ?? true), 'changed');
  if (Object.hasOwn(target, 'icon')) requireValue(row.icon === target.icon, 'changed'); return row;
}
function blobSnapshot(value) {
  let result;
  try {
    if (value instanceof Uint8Array) result = new Blob([value], { type: 'application/zip' });
    else result = Blob.prototype.slice.call(value, 0, undefined, 'application/zip');
    const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(result);
    requireValue(integer(size, DASHBOARD_RESTORE_CLIENT_LIMITS.archive, 1), 'file');
  } catch { fail('file'); } return result;
}
const diagnose = (error) => {
  const code = error instanceof RestoreError ? error.code : ['unauthorized', 'not_authorized'].includes(error?.code) ? 'unauthorized'
    : error?.code === 'unknown_command' ? 'unsupported' : 'network';
  return { code, message: messages[code] };
};

/** Opaque tokens bind one immutable local operation, not server authorization.
 * Call revalidate() on every HA setter to latch observed session loss/recovery.
 * WS commands cannot be aborted once sent. No automatic retry/rollback/delete.
 * Layout saves are scheduled, resources remain declarations, and the public
 * re-list/config checks cannot exclude a concurrent writer after the last read.
 */
export class DashboardRestoreClient {
  #inspection = null; #staged = null; #session = null; #listeners = null;
  #generation = 0; #disposed = false; #requests = new Set(); #diagnostics = [];
  constructor({ getHass } = {}) { this.getHass = typeof getHass === 'function' ? getHass : () => null; }
  get generation() { return this.#generation; }
  get diagnostics() { return copy(this.#diagnostics); }
  get inspection() { return this.#inspection ? copy(this.#inspection.data) : null; }
  get staging() { return this.#staged ? copy(this.#staged.data) : null; }
  #invalidate(keepInspection = false) {
    this.#generation++; this.#diagnostics = []; this.#staged = null; if (!keepInspection) this.#inspection = null;
    for (const c of this.#requests) c.cancel(this.#disposed ? 'disposed' : 'stale');
  }
  #observe() {
    let hass; try { hass = this.getHass(); } catch { hass = null; }
    const user = hass?.user, connection = hass?.connection;
    const next = { hass, user, connection, id: user?.id, fetch: hass?.fetchWithAuth, ws: hass?.callWS, auth: hass?.auth,
      connectionAuth: connection?.options?.auth, active: !!user && (!Object.hasOwn(user, 'is_active') || user.is_active === true),
      admin: user?.is_admin === true, connected: connection?.connected === true };
    if (!this.#session || ['user', 'connection', 'id', 'fetch', 'ws', 'auth', 'connectionAuth', 'active', 'admin', 'connected'].some((k) => this.#session[k] !== next[k])) {
      if (this.#listeners) for (const e of ['disconnected', 'reconnect-error']) this.#listeners.connection?.removeEventListener?.(e, this.#listeners.lost);
      this.#invalidate(); this.#session = next;
      const lost = () => { if (!this.#disposed && this.#session?.connection === connection) this.#invalidate(); };
      this.#listeners = { connection, lost }; for (const e of ['disconnected', 'reconnect-error']) connection?.addEventListener?.(e, lost);
    } else this.#session = next;
    return next;
  }
  revalidate() { if (this.#disposed) return false; const s = this.#observe(); return s.connected && s.active && s.admin && text(s.id); }
  #current(c) { if (this.#disposed || c.cancelled) return false; const s = this.#observe(); return c.generation === this.#generation && s.connected && s.active && s.admin && text(s.id); }
  #check(c) { if (!this.#current(c)) fail(this.#disposed ? 'disposed' : 'stale'); }
  #failure(error, c, phase) {
    const current = c ? this.#current(c) : !this.#disposed, d = diagnose(this.#disposed ? new RestoreError('disposed') : !current ? new RestoreError('stale') : error);
    const progress = c?.progress ?? { creation: 'not_sent', save: 'not_sent' }, partial = progress.creation !== 'not_sent' || c?.stageSent;
    const result = { ok: false, phase, status: partial ? 'review_required' : 'stopped', token: null, diagnostics: [d], publication: copy(progress),
      transaction: false, retry_available: false, inspection: null, stage: null, createdDashboard: copy(c?.created ?? null), orphans: [] };
    if (c?.stageSent) result.orphans.push({ kind: 'staged_files', namespace: c.namespace, status: 'may_exist' });
    if (progress.creation !== 'not_sent') result.orphans.push({ kind: 'dashboard', url_path: c.target, id: c.created?.id ?? null,
      status: progress.creation === 'acknowledged' ? 'new_dashboard_requires_review' : 'creation_result_unknown' });
    if (c?.stageData) result.staging = { counts: { models: c.stageData.staging.models.length, layouts: c.stageData.staging.layouts.length,
      furniture: c.stageData.staging.furniture.length }, layouts_persistence: 'scheduled_not_durable', resources_installed: false };
    if (current && error instanceof RestoreError && error.details) {
      result.orphans = copy(error.details.orphans); result.staging = copy(error.details.staging);
    }
    if (partial || result.orphans.length) result.guidance = 'Review the new dashboard and staged files in Home Assistant before any new attempt. This client does not delete or automatically retry them.';
    if (current) this.#diagnostics = copy(result.diagnostics); return result;
  }
  async #run(phase, work) {
    let c;
    try {
      if (this.#disposed) fail('disposed'); const s = this.#observe(); requireValue(s.connected && s.active && s.admin && text(s.id), 'session');
      requireValue(typeof (phase === 'publish' ? s.ws : s.fetch) === 'function', 'transport');
      let cancel; const stopped = new Promise((_, reject) => { cancel = (code) => { if (c.cancelled) return; c.cancelled = true; c.controller.abort();
        for (const reader of c.readers) Promise.resolve(reader.cancel()).catch(() => {}); reject(new RestoreError(code)); }; }); stopped.catch(() => {});
      c = { ...s, generation: this.#generation, cancelled: false, cancel, stopped, controller: new AbortController(), readers: new Set(),
        progress: { creation: 'not_sent', save: 'not_sent' } }; this.#requests.add(c);
      const result = await work(c); this.#check(c); this.#diagnostics = [];
      return { ok: true, phase, ...result, diagnostics: [] };
    } catch (error) { return this.#failure(error, c, phase); }
    finally { if (c) { this.#requests.delete(c); if (!c.cancelled) c.cancel('stale'); } }
  }
  async #await(c, promise) { const result = await Promise.race([promise, c.stopped]); this.#check(c); return result; }
  async #http(c, route, blob) {
    this.#check(c);
    const response = await this.#await(c, Promise.resolve().then(() => { this.#check(c); if (c.namespace) c.stageSent = true;
      return c.fetch.call(c.hass, route, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: blob, redirect: 'error', signal: c.controller.signal }); }));
    requireValue(response && response.redirected !== true && typeof response.status === 'number', 'shape');
    if (response.url) { const url = new URL(response.url, 'http://restore.invalid'); requireValue(url.pathname + url.search === route, 'shape'); }
    // Middleware can deny with HTML/empty data. A stage can also be denied
    // after an exclusive write, so retain ONLY bounded canonical orphan/file
    // descriptors from its JSON failure (never raw config/error-body extras).
    const contentType = response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase(), denied = [401, 403].includes(response.status);
    if (denied && (!c.namespace || contentType !== 'application/json')) fail('unauthorized'); if ([404, 501].includes(response.status)) fail('unsupported');
    requireValue(contentType === 'application/json', 'shape');
    const declared = response.headers.get('content-length'); if (declared !== null) requireValue(/^\d+$/.test(declared) && Number(declared) <= DASHBOARD_RESTORE_CLIENT_LIMITS.response, 'size');
    requireValue(response.body && typeof response.body.getReader === 'function', 'shape');
    const reader = response.body.getReader(); c.readers.add(reader); const chunks = []; let length = 0, ended = false;
    try {
      while (true) { const item = await this.#await(c, reader.read()); if (item.done) { ended = true; break; }
        requireValue(item.value instanceof Uint8Array, 'shape'); length += item.value.byteLength; requireValue(length <= DASHBOARD_RESTORE_CLIENT_LIMITS.response, 'size'); chunks.push(item.value.slice()); }
    } finally { c.readers.delete(reader); if (!ended) Promise.resolve(reader.cancel()).catch(() => {}); if (reader.releaseLock) reader.releaseLock(); }
    requireValue(length > 0, 'shape'); const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const result = parse(bytes); this.#check(c);
    if (response.status < 200 || response.status >= 300) {
      if (denied) { let details; try { details = stageFailure(result, c.namespace); } catch { /* Untrusted failure extras are discarded. */ } fail('unauthorized', details); }
      if (c.namespace && plain(result) && result.ok === false) fail('stage', stageFailure(result, c.namespace));
      fail('network');
    }
    return result;
  }
  async #ws(c, message, phase = null) {
    this.#check(c); return this.#await(c, Promise.resolve().then(() => {
      this.#check(c); if (phase) c.progress[phase] = 'sent_unknown'; return c.ws.call(c.hass, message);
    }));
  }
  inspect(input) {
    // Freeze bytes before the first await; later caller mutations cannot replace
    // the approved archive. Native Blob storage avoids another 512 MiB JS copy.
    this.#invalidate(); let blob, inputError; try { blob = blobSnapshot(input); } catch (e) { inputError = e; }
    return this.#run('inspect', async (c) => {
      if (inputError) throw inputError;
      const data = freeze(inspectSnapshot(await this.#http(c, BASE + '/inspect', blob))), token = Object.freeze({});
      this.#inspection = { token, blob, data }; return { inspection: copy(data), token, publication_available: false };
    });
  }
  stage(token, options = {}) {
    const inspected = this.#inspection; this.#invalidate(true);
    let args, inputError; try { args = snapshot(options, 64 * 1024); requireValue(plain(args), 'approval'); } catch (e) { inputError = e; }
    return this.#run('stage', async (c) => {
      if (inputError) throw inputError; const { namespace, allowIncomplete = false, previewApproved = false } = args;
      requireValue(inspected && this.#inspection === inspected && token === inspected.token, 'token'); requireValue(previewApproved === true, 'approval');
      requireValue(namespaceValid(namespace), 'namespace'); requireValue(typeof allowIncomplete === 'boolean', 'approval');
      requireValue(inspected.data.report.complete || allowIncomplete, 'incomplete'); c.namespace = namespace; c.target = targetFor(namespace);
      const route = `${BASE}/stage/${namespace}?allow_incomplete=${allowIncomplete ? '1' : '0'}`;
      const data = stageSnapshot(await this.#http(c, route, inspected.blob), namespace, allowIncomplete);
      requireValue(data.report.archive_complete === inspected.data.report.complete && data.report.counts.cards === inspected.data.report.counts.cards);
      freeze(data); const publishToken = Object.freeze({});
      this.#staged = { token: publishToken, data, generation: c.generation }; return { stage: copy(data), token: publishToken, publication_available: true,
        warnings: ['Shared layout persistence is scheduled, not disk-durable.', 'Resources are declarations and have not been installed.', 'Publication has no transaction or compare-and-swap guarantee.'] };
    });
  }
  publish(token, options = {}) {
    const staged = this.#staged;
    // Consume this intent before the first await; even ambiguous results cannot
    // be retried by the same held button/token. No automatic stage/publish chain.
    this.#staged = null;
    let args, inputError; try { args = snapshot(options, 64 * 1024); requireValue(plain(args), 'approval'); } catch (e) { inputError = e; }
    return this.#run('publish', async (c) => {
      if (inputError) throw inputError; const { namespace, approved = false } = args;
      requireValue(staged && token === staged.token && staged.generation === c.generation, 'token');
      requireValue(approved === true, 'approval'); requireValue(namespaceValid(namespace) && namespace === staged.data.namespace, 'namespace');
      c.namespace = namespace; c.target = targetFor(namespace); c.stageData = staged.data;
      const target = staged.data.target_dashboard, before = dashboards(await this.#ws(c, { type: 'lovelace/dashboards/list' }));
      requireValue(!before.some((row) => row.url_path === c.target), 'collision');
      const message = { type: 'lovelace/dashboards/create', url_path: c.target, mode: 'storage', title: target.title,
        require_admin: target.require_admin ?? false, show_in_sidebar: target.show_in_sidebar ?? true };
      if (Object.hasOwn(target, 'icon')) message.icon = target.icon;
      const rawCreated = await this.#ws(c, message, 'creation'); c.progress.creation = 'acknowledged'; c.created = created(rawCreated, target);
      const after = dashboards(await this.#ws(c, { type: 'lovelace/dashboards/list' })), own = after.find((row) => row.url_path === c.target);
      requireValue(own && own.id === c.created.id && own.mode === 'storage' && own.title === c.created.title
        && own.require_admin === c.created.require_admin && own.show_in_sidebar === c.created.show_in_sidebar, 'changed');
      let empty = false;
      try { await this.#ws(c, { type: 'lovelace/config', url_path: c.target, force: true }); }
      catch (error) { this.#check(c); if (error?.code === 'config_not_found') empty = true; else throw error; }
      requireValue(empty, 'changed'); this.#check(c);
      const save = staged.data.save_message;
      const ack = await this.#ws(c, { type: 'lovelace/config/save', url_path: c.target, config: copy(save.config) }, 'save');
      c.progress.save = 'acknowledged'; requireValue(ack === undefined || ack === null, 'shape');
      return { status: 'published', namespace, createdDashboard: copy(c.created), publication: copy(c.progress), complete: staged.data.report.complete,
        staging: copy(staged.data.staging), report: copy(staged.data.report), resources: copy(staged.data.resources), resources_installed: false,
        transaction: false, retry_available: false, orphans: [], guidance: 'Home Assistant accepted the new dashboard configuration. Check its declared resources and any missing dependencies; scheduled layout saves are not a disk-durable transaction.' };
    });
  }
  cancel() { if (!this.#disposed) this.#invalidate(); }
  dispose() {
    if (this.#disposed) return; this.#disposed = true; this.#invalidate();
    if (this.#listeners) for (const e of ['disconnected', 'reconnect-error']) this.#listeners.connection?.removeEventListener?.(e, this.#listeners.lost);
    this.#listeners = null; this.#session = null;
  }
}
