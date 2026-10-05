import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardRestoreClient, DASHBOARD_RESTORE_CLIENT_LIMITS as LIMITS } from '../src/dashboard-restore-client.js';

// Real Blob/Response/streams/JSON/connection events are used. Only authenticated
// HTTP and decoded HA WS boundaries are replaced; this does not prove live HA
// middleware, archive validation, disk persistence or a server-side transaction.
const clients = [], bytes = () => new Uint8Array([80, 75, 3, 4, 5]), clone = (v) => structuredClone(v);
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const code = (result) => result.diagnostics[0]?.code, digest = 'a'.repeat(64), packId = 'b'.repeat(64);
const response = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
function inspected() {
  return { manifest: { format: 'taylors3d-dashboard-backup', version: 1, complete: true, cards: [], layouts: [], models: [], furniture: [],
    producer: { original: 'retained' }, resources: { mode: 'storage', items: [] } },
  report: { complete: true, diagnostics: [], counts: { cards: 1, layouts: 1, models: 1, furniture_packs: 1, members: 5 },
    expanded_bytes: 150, nested_expanded_bytes: 20, verified_expanded_bytes: 170, dependencyFree: false, externalDependencies: [] },
  preview: { dashboard: { title: 'Simulated archived dashboard', views: [{ cards: [{ type: 'custom:taylors3d-card', layout_key: 'original' },
    { type: 'custom:foreign-card', unknown: { untouched: ['x', 3] } }] }], extra: { '/~key': { source: 'exact' } } },
  layouts: { original: { backend: 'shared', metadata: { unknown: true }, layout: { rooms: [], source: { unknown: ['keep'] } } } } }, restoreAvailable: false };
}
function staged(namespace = 'new-house') {
  const path = 'taylors3d-restore-' + namespace, key = 'restore_' + namespace + '_' + 'f'.repeat(64 - ('restore_' + namespace + '_').length);
  const config = clone(inspected().preview.dashboard); config.views[0].cards[0].layout_key = key;
  return { ok: true, namespace, restore_id: 'c'.repeat(32), target_dashboard: { url_path: path, title: "Taylor's 3D restore (" + namespace + ')', mode: 'storage', unknown: { keep: true } },
    save_message: { id: 1, type: 'lovelace/config/save', url_path: path, config }, resources: { mode: 'storage', items: [{ type: 'module', url: 'https://external.invalid/do-not-fetch.js', extra: true }] },
    report: { valid: true, complete: true, archive_complete: true, allow_incomplete: false, publication_available: false,
      resources_installed: false, requires_current_admin_at_publication: true, requires_shared_integration: true,
      collision_checked: { internal: true, external: false }, counts: { cards: 1, layouts: 1, models: 1, furniture_packs: 1 },
      collision_targets: { dashboard_url_path: path, layout_keys: [key], model_keys: [key], legacy_fallback_keys: ['taylors3d_' + key] },
      diagnostics: [{ code: 'resource_dependency', path: '/resources/items/0', message: 'Explicit external dependency remains.', severity: 'dependency' }],
      patches: [{ path: '/views/0/cards/0/layout_key', from: 'original', to: key }], extra: { retained: 'report' } },
    staging: { models: [{ target_key: key, sha256: digest, bytes: 100, exclusive: true, integrity_verified: true }],
      layouts: [{ target_key: key, original_sha256: digest, staged_json_sha256: digest, persistence: 'scheduled_not_durable' }],
      furniture: [{ pack_id: packId, imported: true, sha256: packId }], unavailable: [], integrity_verified: true,
      integrity_scope: 'present_assets_and_populated_shared_layouts', layouts_persistence: 'scheduled_not_durable', dashboard_created: false, resources_installed: false,
      collision_evidence: { dashboard: 'absent_at_check', user_fallbacks: 'all_current_users_absent_at_check', browser: 'not_read;unchanged_and_shadowed_by_populated_shared_layouts', transaction: false } }, orphans: [], extra: ['untouched'] };
}
function harness() {
  const h = { inspect: inspected(), stage: staged(), lists: [], configs: new Map(), httpBodies: [], saved: [], created: [] };
  h.user = { id: 'current-admin', is_active: true, is_admin: true };
  h.connection = Object.assign(new EventTarget(), { connected: true, options: { auth: {} } });
  vi.spyOn(h.connection, 'addEventListener'); vi.spyOn(h.connection, 'removeEventListener');
  h.fetch = vi.fn(async (route, options) => { h.httpBodies.push({ route, options }); return response(route.endsWith('/inspect') ? h.inspect : h.stage); });
  h.ws = vi.fn(async (message) => {
    if (message.type === 'lovelace/dashboards/list') return h.lists;
    if (message.type === 'lovelace/dashboards/create') {
      const fields = clone(message); delete fields.type; const row = { id: 'created-exact-id', ...fields };
      h.created.push(clone(row)); h.lists.push(row); return row;
    }
    if (message.type === 'lovelace/config') { if (h.configs.has(message.url_path)) return h.configs.get(message.url_path); throw { code: 'config_not_found' }; }
    if (message.type === 'lovelace/config/save') { h.saved.push(clone(message)); h.configs.set(message.url_path, clone(message.config)); return null; }
    throw new Error('Unexpected WS command');
  });
  h.current = { user: h.user, connection: h.connection, auth: {}, callWS: h.ws, fetchWithAuth: h.fetch, callService: vi.fn() };
  h.client = new DashboardRestoreClient({ getHass: () => h.current }); clients.push(h.client); return h;
}
async function prepare(h, options = {}) {
  const inspection = await h.client.inspect(bytes()); expect(inspection.ok).toBe(true);
  const stage = await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true, ...options }); expect(stage.ok).toBe(true); return stage;
}
afterEach(() => { clients.splice(0).forEach((c) => c.dispose()); vi.restoreAllMocks(); });

describe('three explicit operations and exact immutable snapshots', () => {
  it('does not publish from inspect/stage; saves the entire exact raw dashboard only after fresh create/list/empty-config checks', async () => {
    const h = harness(), before = clone(h.stage), stage = await prepare(h);
    expect(h.ws).not.toHaveBeenCalled(); expect(h.httpBodies.map((row) => row.route)).toEqual([
      '/api/taylors3d/dashboard_backup/inspect', '/api/taylors3d/dashboard_backup/stage/new-house?allow_incomplete=0']);
    expect(h.httpBodies[0].options.body).toBe(h.httpBodies[1].options.body);
    for (const row of h.httpBodies) expect(row.options).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/zip' }, redirect: 'error' });
    const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true });
    expect(result).toMatchObject({ ok: true, status: 'published', complete: true, resources_installed: false, transaction: false,
      publication: { creation: 'acknowledged', save: 'acknowledged' }, staging: { layouts_persistence: 'scheduled_not_durable' } });
    expect(h.ws.mock.calls.map(([row]) => row.type)).toEqual(['lovelace/dashboards/list', 'lovelace/dashboards/create', 'lovelace/dashboards/list', 'lovelace/config', 'lovelace/config/save']);
    expect(h.ws.mock.calls[1][0]).toEqual({ type: 'lovelace/dashboards/create', url_path: before.target_dashboard.url_path, mode: 'storage', title: before.target_dashboard.title, require_admin: false, show_in_sidebar: true });
    expect(h.ws.mock.calls[3][0]).toEqual({ type: 'lovelace/config', url_path: before.target_dashboard.url_path, force: true });
    expect(h.saved).toEqual([{ type: 'lovelace/config/save', url_path: before.target_dashboard.url_path, config: before.save_message.config }]);
    expect(h.saved[0]).not.toHaveProperty('id'); expect(h.current.callService).not.toHaveBeenCalled(); expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(result.resources).toEqual(before.resources); expect(result.report.extra).toEqual(before.report.extra); expect(h.stage).toEqual(before);
  });
  it('freezes caller bytes before any await and ignores custom File name/size/arrayBuffer getters', async () => {
    const h = harness(), input = bytes(), promise = h.client.inspect(input); input.fill(0);
    const first = await promise; expect(first.ok).toBe(true); expect(new Uint8Array(await h.httpBodies[0].options.body.arrayBuffer())).toEqual(bytes());
    const native = new Blob([bytes()]); Object.defineProperty(native, 'size', { get() { throw new Error('do not call'); } });
    native.arrayBuffer = () => { throw new Error('do not call'); }; expect((await h.client.inspect(native)).ok).toBe(true);
  });
  it('does not execute a Uint8Array subclass species while freezing native bytes', async () => {
    class Hostile extends Uint8Array { static get [Symbol.species]() { throw new Error('No species'); } }
    const h = harness(); expect((await h.client.inspect(new Hostile(bytes()))).ok).toBe(true);
  });
  it('returns defensive copies; caller changes cannot alter private stage/config/publication', async () => {
    const h = harness(), inspection = await h.client.inspect(bytes()); inspection.inspection.preview.dashboard.title = 'caller replacement';
    const getter = h.client.inspection; getter.preview.layouts.original.layout.rooms.push('caller');
    expect(h.client.inspection.preview.dashboard.title).not.toBe('caller replacement'); expect(h.client.inspection.preview.layouts.original.layout.rooms).toEqual([]);
    const stage = await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true });
    stage.stage.save_message.config.views = []; stage.stage.target_dashboard.url_path = 'dashboard-existing';
    const copyStage = h.client.staging; copyStage.save_message.config.extra = null;
    const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true });
    expect(result.ok).toBe(true); expect(h.saved[0].config).toEqual(h.stage.save_message.config); expect(h.saved[0].url_path).toBe('taylors3d-restore-new-house');
    expect(Object.keys(stage.token)).toEqual([]); expect(Object.isFrozen(stage.token)).toBe(true);
  });
  it('keeps strategy dashboards and own __proto__/unknown fields as raw data', async () => {
    const h = harness(); h.inspect.preview.dashboard = JSON.parse('{"strategy":{"type":"foreign","config":{"raw":true}},"__proto__":{"data":7}}');
    h.stage.save_message.config = clone(h.inspect.preview.dashboard); const stage = await prepare(h);
    expect((await h.client.publish(stage.token, { namespace: 'new-house', approved: true })).ok).toBe(true);
    expect(Object.hasOwn(h.saved[0].config, '__proto__')).toBe(true); expect(h.saved[0].config.__proto__).toEqual({ data: 7 });
    expect(h.saved[0].config.strategy).toEqual({ type: 'foreign', config: { raw: true } });
  });
  it('uses only explicitly supplied optional create flags/icon and never sends unknown target fields', async () => {
    const h = harness(); Object.assign(h.stage.target_dashboard, { require_admin: true, show_in_sidebar: false, icon: 'mdi:home', unexpected_command: 'keep-readonly' });
    const stage = await prepare(h); expect((await h.client.publish(stage.token, { namespace: 'new-house', approved: true })).ok).toBe(true);
    expect(h.ws.mock.calls[1][0]).toMatchObject({ require_admin: true, show_in_sidebar: false, icon: 'mdi:home' }); expect(h.ws.mock.calls[1][0]).not.toHaveProperty('unexpected_command');
  });
});

describe('explicit approvals and operation-owned intents', () => {
  it.each([false, 'true', 1, null])('does not stage without exact previewApproved:true (%j)', async (previewApproved) => {
    const h = harness(), inspection = await h.client.inspect(bytes()); expect(code(await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved }))).toBe('approval'); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([false, 'true', 1, null])('does not create without exact approved:true (%j)', async (approved) => {
    const h = harness(), stage = await prepare(h); expect(code(await h.client.publish(stage.token, { namespace: 'new-house', approved }))).toBe('approval'); expect(h.ws).not.toHaveBeenCalled();
    expect(code(await h.client.publish(stage.token, { namespace: 'new-house', approved: true }))).toBe('token');
  });
  it.each(['', 'A', '-bad', 'bad-', 'two/paths', 'x'.repeat(25), 'bad?query=1', '../other', null])('rejects a noncanonical namespace %j before staging', async (namespace) => {
    const h = harness(), inspection = await h.client.inspect(bytes()); expect(code(await h.client.stage(inspection.token, { namespace, previewApproved: true }))).toBe('namespace'); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not accept fabricated/copied/cross-client tokens or a different publish namespace', async () => {
    const h = harness(), other = harness(), inspection = await h.client.inspect(bytes());
    expect(code(await h.client.stage({}, { namespace: 'new-house', previewApproved: true }))).toBe('token');
    expect(code(await other.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true }))).toBe('token');
    const stage = await prepare(h); expect(code(await h.client.publish(stage.token, { namespace: 'different', approved: true }))).toBe('namespace'); expect(h.ws).not.toHaveBeenCalled();
  });
  it('invalid re-inspection and failed/replaced staging poison held old publication', async () => {
    const h = harness(), stage = await prepare(h); expect(code(await h.client.inspect(new Uint8Array()))).toBe('file');
    expect(code(await h.client.publish(stage.token, { namespace: 'new-house', approved: true }))).toBe('token');
    const next = await prepare(h), inspection = await h.client.inspect(bytes());
    expect(code(await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: false }))).toBe('approval');
    expect(code(await h.client.publish(next.token, { namespace: 'new-house', approved: true }))).toBe('token'); expect(h.ws).not.toHaveBeenCalled();
  });
  it('a failed second stage poisons a previously successful stage without discarding exact inspection', async () => {
    const h = harness(), inspection = await h.client.inspect(bytes()), first = await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true });
    expect(first.ok).toBe(true); h.fetch.mockResolvedValueOnce(response({ ok: false }, 500));
    expect((await h.client.stage(inspection.token, { namespace: 'different', previewApproved: true })).ok).toBe(false);
    expect(code(await h.client.publish(first.token, { namespace: 'new-house', approved: true }))).toBe('token'); expect(h.client.inspection).not.toBeNull();
  });
  it.each([null, [], 'invalid'])('malformed action options %j resolve failure and do not escape', async (options) => {
    const h = harness(), inspection = await h.client.inspect(bytes()); expect((await h.client.stage(inspection.token, options)).ok).toBe(false);
    const stage = await prepare(h); expect((await h.client.publish(stage.token, options)).ok).toBe(false); expect(h.ws).not.toHaveBeenCalled();
  });
  it('action option getters are rejected without executing them', async () => {
    const h = harness(), inspection = await h.client.inspect(bytes()), getter = vi.fn(() => true), options = { namespace: 'new-house' };
    Object.defineProperty(options, 'previewApproved', { enumerable: true, get: getter }); expect((await h.client.stage(inspection.token, options)).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
});

describe('fresh active administrator/session ownership at every await', () => {
  it.each([['inactive', (h) => { h.user.is_active = false; }], ['admin lost', (h) => { h.user.is_admin = false; }],
    ['invalid active', (h) => { h.user.is_active = 'true'; }], ['missing user', (h) => { h.current.user = null; }],
    ['blank id', (h) => { h.user.id = ' '; }], ['disconnected', (h) => { h.connection.connected = false; }]])('rejects %s before inspect, regardless of approval flags', async (_name, revoke) => {
    const h = harness(); revoke(h); expect(code(await h.client.inspect(bytes()))).toBe('session'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('allows absent compatible is_active and ordinary HA object spreads without poisoning the exact session', async () => {
    const h = harness(); delete h.user.is_active; const stage = await prepare(h);
    h.current = { ...h.current, states: { 'sun.sun': { state: 'above_horizon' } } }; expect(h.client.revalidate()).toBe(true);
    expect((await h.client.publish(stage.token, { namespace: 'new-house', approved: true })).ok).toBe(true);
  });
  it.each([['same-object admin', (h) => { h.user.is_admin = false; }, (h) => { h.user.is_admin = true; }],
    ['connection', (h) => { h.connection.connected = false; }, (h) => { h.connection.connected = true; }],
    ['active', (h) => { h.user.is_active = false; }, (h) => { h.user.is_active = true; }]])('observed %s loss/recovery permanently invalidates held publish intent', async (_name, revoke, restore) => {
    const h = harness(), stage = await prepare(h); revoke(h); expect(h.client.revalidate()).toBe(false); restore(h); expect(h.client.revalidate()).toBe(true);
    expect(code(await h.client.publish(stage.token, { namespace: 'new-house', approved: true }))).toBe('token'); expect(h.ws).not.toHaveBeenCalled(); expect(h.client.inspection).toBeNull();
  });
  it.each([['user replacement', (h) => { h.current.user = { ...h.user }; }], ['auth replacement', (h) => { h.current.auth = {}; }],
    ['connection auth', (h) => { h.connection.options.auth = {}; }], ['WS replacement', (h) => { h.current.callWS = vi.fn(); }],
    ['HTTP replacement', (h) => { h.current.fetchWithAuth = vi.fn(); }]])('invalidates an awaited inspection after %s', async (_name, change) => {
    const h = harness(), slow = deferred(); h.fetch.mockReturnValueOnce(slow.promise); const pending = h.client.inspect(bytes()); await tick(); change(h); h.client.revalidate();
    const result = await pending; expect(code(result)).toBe('stale'); expect(result.inspection).toBeNull(); slow.resolve(response(h.inspect)); await tick(); expect(h.client.inspection).toBeNull();
  });
  it.each(['disconnected', 'reconnect-error'])('connection %s event poisons in-flight work even if connected remains true', async (event) => {
    const h = harness(), slow = deferred(); h.fetch.mockReturnValueOnce(slow.promise); const pending = h.client.inspect(bytes()); await tick(); h.connection.dispatchEvent(new Event(event));
    expect(code(await pending)).toBe('stale'); expect(h.httpBodies).toEqual([]); slow.resolve(response(h.inspect));
  });
  it('cancel settles ignored HTTP aborts promptly; dispose unregisters exact listeners and blocks later work', async () => {
    const h = harness(), slow = deferred(); h.fetch.mockReturnValueOnce(slow.promise); const pending = h.client.inspect(bytes()); await tick();
    const signal = h.fetch.mock.calls[0][1].signal; h.client.cancel(); expect(code(await pending)).toBe('stale'); expect(signal.aborted).toBe(true);
    h.client.dispose(); expect(code(await h.client.inspect(bytes()))).toBe('disposed'); expect(h.connection.removeEventListener).toHaveBeenCalledWith('disconnected', expect.any(Function));
    slow.resolve(response(h.inspect));
  });
  it('latest concurrent inspection wins and late discarded bytes do not replace its immutable preview', async () => {
    const h = harness(), slow = deferred(); h.fetch.mockReturnValueOnce(slow.promise); const old = h.client.inspect(bytes()); await tick();
    const current = await h.client.inspect(bytes()); expect(current.ok).toBe(true); expect(code(await old)).toBe('stale');
    slow.resolve(response({ ...h.inspect, restoreAvailable: true })); await tick(); expect(h.client.inspection.restoreAvailable).toBe(false);
  });
  it('stops during real streamed response reading and cancels the reader without retaining private preview', async () => {
    const h = harness(), cancelled = vi.fn(); let source;
    const body = new ReadableStream({ start(controller) { source = controller; }, cancel: cancelled });
    h.fetch.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/json' } }));
    const pending = h.client.inspect(bytes()); await tick(); source.enqueue(new TextEncoder().encode('{"manifest":')); await tick();
    h.user.is_active = false; h.client.revalidate(); const result = await pending;
    expect(code(result)).toBe('stale'); expect(cancelled).toHaveBeenCalled(); expect(h.client.inspection).toBeNull();
  });
  it('a replacement inspection aborts an in-flight stage and cannot inherit its late publish intent', async () => {
    const h = harness(), inspection = await h.client.inspect(bytes()), slow = deferred(); h.fetch.mockReturnValueOnce(slow.promise);
    const pending = h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true }); await tick();
    const next = await h.client.inspect(bytes()); expect(next.ok).toBe(true); const old = await pending; expect(code(old)).toBe('stale'); expect(old.orphans[0].status).toBe('may_exist');
    slow.resolve(response(h.stage)); await tick(); expect(h.client.staging).toBeNull(); expect(h.ws).not.toHaveBeenCalled();
  });
});

describe('bounded static response and verified staging contract', () => {
  it.each([new Uint8Array(), null, 'file.zip', {}, new ArrayBuffer(4)])('rejects invalid ZIP input %j without fetching', async (input) => {
    const h = harness(); expect(code(await h.client.inspect(input))).toBe('file'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['wrong format', (h) => { h.inspect.manifest.format = 'foreign'; }], ['unsupported version', (h) => { h.inspect.manifest.version = 2; }],
    ['dashboard missing views', (h) => { h.inspect.preview.dashboard = {}; }], ['malformed strategy', (h) => { h.inspect.preview.dashboard.strategy = []; }],
    ['layout type', (h) => { h.inspect.preview.layouts.original.layout = []; }], ['restore claim', (h) => { h.inspect.restoreAvailable = true; }],
    ['oversized member count', (h) => { h.inspect.report.counts.members = 259; }], ['nonboolean complete', (h) => { h.inspect.report.complete = 1; }],
    ['missing report', (h) => { delete h.inspect.report; }], ['excess verified bytes', (h) => { h.inspect.report.verified_expanded_bytes = LIMITS.archive + 1; }],
  ])('rejects inspection %s and never creates an intent', async (_name, change) => {
    const h = harness(); change(h); expect((await h.client.inspect(bytes())).ok).toBe(false); expect(h.client.inspection).toBeNull(); expect(h.ws).not.toHaveBeenCalled();
  });
  it.each([
    ['wrong namespace', (h) => { h.stage.namespace = 'other'; }], ['wrong target', (h) => { h.stage.target_dashboard.url_path = 'dashboard-existing'; }],
    ['wrong save target', (h) => { h.stage.save_message.url_path = 'dashboard-existing'; }], ['extra save fields', (h) => { h.stage.save_message.command = 'delete'; }],
    ['save id', (h) => { h.stage.save_message.id = 3; }], ['wrong config shape', (h) => { h.stage.save_message.config.views = {}; }],
    ['false integrity', (h) => { h.stage.staging.integrity_verified = false; }], ['durable claim', (h) => { h.stage.staging.layouts_persistence = 'durable'; }],
    ['wrong model identity', (h) => { h.stage.staging.models[0].sha256 = 'short'; }], ['source key reuse', (h) => { h.stage.staging.models[0].target_key = 'original'; }],
    ['missing shared layout', (h) => { h.stage.staging.layouts = []; }], ['pack identity mismatch', (h) => { h.stage.staging.furniture[0].sha256 = digest; }],
    ['resource install claim', (h) => { h.stage.staging.resources_installed = true; }], ['created claim', (h) => { h.stage.staging.dashboard_created = true; }],
    ['transaction claim', (h) => { h.stage.staging.collision_evidence.transaction = true; }], ['preflight absent', (h) => { delete h.stage.staging.collision_evidence; }],
    ['numeric restore id', (h) => { h.stage.restore_id = Number('1'.repeat(32)); }], ['invalid flags', (h) => { h.stage.target_dashboard.require_admin = 'false'; }],
    ['archive completeness changed', (h) => { h.stage.report.archive_complete = false; }], ['original card count changed', (h) => { h.stage.report.counts.cards = 2; }],
  ])('rejects inconsistent staging %s before issuing a publish token', async (_name, change) => {
    const h = harness(), inspection = await h.client.inspect(bytes()); change(h);
    const result = await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true });
    expect(result.ok).toBe(false); expect(h.client.staging).toBeNull(); expect(h.ws).not.toHaveBeenCalled(); expect(result.orphans[0]).toMatchObject({ kind: 'staged_files', status: 'may_exist' });
  });
  it('requires deliberate incomplete approval and keeps every missing dependency visible after publication', async () => {
    const h = harness(); h.inspect.report.complete = false; h.inspect.manifest.complete = false;
    const inspection = await h.client.inspect(bytes()); expect(code(await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true }))).toBe('incomplete'); expect(h.fetch).toHaveBeenCalledTimes(1);
    h.stage.report.complete = false; h.stage.report.archive_complete = false; h.stage.report.allow_incomplete = true;
    h.stage.staging.models = []; h.stage.staging.unavailable = [{ kind: 'model', source_key: 'original', pack_id: null }];
    h.stage.report.diagnostics.push({ code: 'model_missing', path: '/models', message: 'Missing model remains missing.', severity: 'missing' });
    const stage = await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true, allowIncomplete: true }); expect(stage.ok).toBe(true);
    expect(h.httpBodies.at(-1).route.endsWith('?allow_incomplete=1')).toBe(true); const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true });
    expect(result).toMatchObject({ ok: true, complete: false }); expect(result.staging.unavailable).toEqual(h.stage.staging.unavailable);
    expect(result.report.diagnostics.some((d) => d.severity === 'missing')).toBe(true); expect(result.transaction).toBe(false);
  });
  it('rejects duplicate JSON keys, malformed UTF-8 and escaped lone surrogates without a usable preview', async () => {
    const h = harness(); for (const body of ['{"manifest":{},"manifest":{}}', '{"bad":"\\ud800"}', new Uint8Array([0xff])]) {
      h.fetch.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/json' } })); expect(code(await h.client.inspect(bytes()))).toBe('json');
    }
  });
  it('bounds content length/depth and rejects cross-route redirects before retaining response data', async () => {
    const h = harness(); h.fetch.mockResolvedValueOnce(response(h.inspect, 200, { 'content-length': String(LIMITS.response + 1) })); expect(code(await h.client.inspect(bytes()))).toBe('size');
    h.fetch.mockResolvedValueOnce(new Response('['.repeat(70) + '0' + ']'.repeat(70), { headers: { 'content-type': 'application/json' } })); expect(code(await h.client.inspect(bytes()))).toBe('size');
    const redirected = response(h.inspect); Object.defineProperty(redirected, 'redirected', { value: true }); h.fetch.mockResolvedValueOnce(redirected); expect((await h.client.inspect(bytes())).ok).toBe(false);
    const different = response(h.inspect); Object.defineProperty(different, 'url', { value: 'https://same.invalid/other-route' }); h.fetch.mockResolvedValueOnce(different); expect((await h.client.inspect(bytes())).ok).toBe(false);
  });
  it('rejects an oversized dashboard save envelope despite fitting the larger response budget', async () => {
    const h = harness(); h.stage.save_message.config.long = 'x'.repeat(LIMITS.dashboard); const inspection = await h.client.inspect(bytes());
    expect(code(await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true }))).toBe('size'); expect(h.ws).not.toHaveBeenCalled();
  });
  it('preserves explicit backend staging failure/orphans and never publishes or automatically retries', async () => {
    const h = harness(), inspection = await h.client.inspect(bytes()), failure = { ok: false, error: 'staged_changed', namespace: 'new-house', publication_available: false,
      staging: { models: clone(h.stage.staging.models), layouts: [], furniture: [] }, orphans: [{ kind: 'model', target_key: h.stage.staging.models[0].target_key, status: 'staged_without_dashboard' }] };
    h.fetch.mockResolvedValueOnce(response(failure, 409)); const result = await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true });
    expect(code(result)).toBe('stage'); expect(result.orphans).toEqual(failure.orphans); expect(result.staging).toEqual(failure.staging); expect(result.retry_available).toBe(false); expect(h.ws).not.toHaveBeenCalled();
  });
  it('retains only safe exact model orphans from a denied stage response, with an unauthorized diagnostic', async () => {
    const h = harness(), inspection = await h.client.inspect(bytes()), model = clone(h.stage.staging.models[0]);
    const failure = { ok: false, error: 'unauthorized', namespace: 'new-house', publication_available: false,
      staging: { models: [model], layouts: [], furniture: [] }, orphans: [{ kind: 'model', target_key: model.target_key, sha256: model.sha256, status: 'cancelled_new_stage' }],
      secret: 'must not echo a server body or raw dashboard' };
    h.fetch.mockResolvedValueOnce(response(failure, 401)); const result = await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true });
    expect(code(result)).toBe('unauthorized'); expect(result.orphans).toEqual(failure.orphans); expect(result.staging).toEqual(failure.staging);
    expect(result.stage).toBeNull(); expect(JSON.stringify(result)).not.toContain('must not echo'); expect(h.ws).not.toHaveBeenCalled();
  });
  it('never exposes nested raw config disguised as a denied-stage file/hash descriptor', async () => {
    const h = harness(), inspection = await h.client.inspect(bytes()), model = clone(h.stage.staging.models[0]);
    model.sha256 = { secret: 'private raw dashboard' };
    h.fetch.mockResolvedValueOnce(response({ ok: false, namespace: 'new-house', publication_available: false,
      staging: { models: [model], layouts: [], furniture: [] }, orphans: [] }, 403));
    const result = await h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true });
    expect(code(result)).toBe('unauthorized'); expect(result.orphans).toEqual([{ kind: 'staged_files', namespace: 'new-house', status: 'may_exist' }]);
    expect(JSON.stringify(result)).not.toContain('private raw dashboard');
  });
  it.each([[401, 'unauthorized'], [403, 'unauthorized'], [404, 'unsupported'], [500, 'network']])('does not echo an HTTP %d error body', async (status, expected) => {
    const h = harness(); h.fetch.mockResolvedValueOnce(response({ secret: 'private token or dashboard' }, status)); const result = await h.client.inspect(bytes());
    expect(code(result)).toBe(expected); expect(JSON.stringify(result)).not.toContain('private token');
  });
  it.each([[401, 'unauthorized'], [403, 'unauthorized'], [404, 'unsupported']])('recognizes HTTP %d middleware HTML/empty errors without decoding them', async (status, expected) => {
    const h = harness(); h.fetch.mockResolvedValueOnce(new Response('private middleware text', { status, headers: { 'content-type': 'text/html' } }));
    const result = await h.client.inspect(bytes()); expect(code(result)).toBe(expected); expect(JSON.stringify(result)).not.toContain('private middleware');
  });
  it('bounds actual streamed bytes even when content-length is absent, cancelling oversized content', async () => {
    const h = harness(), cancel = vi.fn(); let sent = false;
    // A single real over-budget chunk proves the transport bound rather than
    // merely trusting a declared header. No archive decompression is involved.
    const body = new ReadableStream({ pull(controller) { if (!sent) { sent = true; controller.enqueue(new Uint8Array(LIMITS.response + 1)); } }, cancel });
    h.fetch.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/json' } }));
    expect(code(await h.client.inspect(bytes()))).toBe('size'); expect(cancel).toHaveBeenCalled(); expect(h.client.inspection).toBeNull();
  });
});

describe('publication collision, new-dashboard ownership and ambiguous results', () => {
  it('stops on fresh dashboard collision before create; old dashboards/configs stay untouched', async () => {
    const h = harness(), stage = await prepare(h); h.lists = [{ id: 'someone-else', url_path: h.stage.target_dashboard.url_path, mode: 'storage' }];
    h.configs.set(h.stage.target_dashboard.url_path, { views: [], original: true }); const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true });
    expect(code(result)).toBe('collision'); expect(h.created).toEqual([]); expect(h.saved).toEqual([]); expect(h.configs.get(h.stage.target_dashboard.url_path).original).toBe(true);
    expect(h.ws).toHaveBeenCalledTimes(1); expect(result.publication.creation).toBe('not_sent');
  });
  it('accepts unrelated actual YAML dashboard metadata without a collection ID while requiring the new storage ID', async () => {
    // Core's DashboardsCollectionWebSocket lists dashboard.config for both
    // YAML and storage; YAML config gets url_path but does not gain an id.
    const h = harness(), stage = await prepare(h); h.lists.push({ url_path: 'yaml-existing', mode: 'yaml', title: 'Existing YAML', require_admin: false, show_in_sidebar: true, filename: 'unchanged.yaml' });
    expect((await h.client.publish(stage.token, { namespace: 'new-house', approved: true })).ok).toBe(true);
    expect(h.lists[0]).not.toHaveProperty('id'); expect(h.saved).toHaveLength(1);
  });
  it.each([['removed', (h) => { h.lists = []; }], ['replaced ID', (h) => { h.lists[0].id = 'other-id'; }],
    ['mode changed', (h) => { h.lists[0].mode = 'yaml'; }], ['metadata changed', (h) => { h.lists[0].title = 'Other writer'; }]])('reports created dashboard and stops after post-create %s', async (_name, change) => {
    const h = harness(), stage = await prepare(h), original = h.ws.getMockImplementation(); h.ws.mockImplementation(async (message) => {
      const result = await original(message); if (message.type === 'lovelace/dashboards/create') { const snapshot = clone(result); change(h); return snapshot; } return result;
    });
    const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true }); expect(code(result)).toBe('changed'); expect(h.saved).toEqual([]);
    expect(result).toMatchObject({ status: 'review_required', createdDashboard: { id: 'created-exact-id' }, publication: { creation: 'acknowledged', save: 'not_sent' } });
    expect(result.orphans[0].kind).toBe('dashboard'); expect(result.guidance).toContain('does not delete');
  });
  it.each([{}, { views: [] }, { strategy: { type: 'other-writer' } }, null])('any existing raw config %j stops first save rather than overwriting', async (config) => {
    const h = harness(), stage = await prepare(h); h.configs.set(h.stage.target_dashboard.url_path, config);
    const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true }); expect(code(result)).toBe('changed'); expect(h.saved).toEqual([]);
    expect(result.createdDashboard.id).toBe('created-exact-id'); expect(result.publication.save).toBe('not_sent');
  });
  it.each(['not_found', 'unknown_command', 'unauthorized', 'error'])('raw-config error %s is not confused with exact config_not_found', async (rawCode) => {
    const h = harness(), stage = await prepare(h), original = h.ws.getMockImplementation(); h.ws.mockImplementation((m) => m.type === 'lovelace/config' ? Promise.reject({ code: rawCode, message: 'Secret URL/token' }) : original(m));
    const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true }); expect(result.ok).toBe(false); expect(h.saved).toEqual([]); expect(result.createdDashboard.id).toBe('created-exact-id');
    expect(JSON.stringify(result)).not.toContain('Secret');
  });
  it('an ambiguous create failure consumes the intent once and does not re-list/save/delete/retry', async () => {
    const h = harness(), stage = await prepare(h), original = h.ws.getMockImplementation(); h.ws.mockImplementation((m) => m.type === 'lovelace/dashboards/create' ? Promise.reject(new Error('unknown transport result')) : original(m));
    const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true }); expect(code(result)).toBe('network');
    expect(result).toMatchObject({ status: 'review_required', publication: { creation: 'sent_unknown', save: 'not_sent' }, createdDashboard: null });
    expect(h.ws).toHaveBeenCalledTimes(2); expect(code(await h.client.publish(stage.token, { namespace: 'new-house', approved: true }))).toBe('token'); expect(h.ws).toHaveBeenCalledTimes(2);
  });
  it('a malformed create acknowledgement is explicit orphan guidance, not a claim nothing happened', async () => {
    const h = harness(), stage = await prepare(h), original = h.ws.getMockImplementation(); h.ws.mockImplementation(async (m) => m.type === 'lovelace/dashboards/create' ? { wrong: true } : original(m));
    const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true }); expect(code(result)).toBe('changed'); expect(result.publication.creation).toBe('acknowledged');
    expect(result.orphans).toEqual([expect.objectContaining({ kind: 'dashboard', url_path: h.stage.target_dashboard.url_path, id: null })]); expect(h.saved).toEqual([]);
  });
  it('a save failure retains the new dashboard and honest unknown-save result without fake rollback', async () => {
    const h = harness(), stage = await prepare(h), original = h.ws.getMockImplementation(); h.ws.mockImplementation((m) => m.type === 'lovelace/config/save' ? Promise.reject({ code: 'error', message: 'Private storage path' }) : original(m));
    const result = await h.client.publish(stage.token, { namespace: 'new-house', approved: true }); expect(result).toMatchObject({ ok: false, status: 'review_required',
      createdDashboard: { id: 'created-exact-id' }, publication: { creation: 'acknowledged', save: 'sent_unknown' }, transaction: false, retry_available: false });
    expect(h.created).toHaveLength(1); expect(h.ws.mock.calls.some(([m]) => m.type.includes('delete'))).toBe(false); expect(result.staging.layouts_persistence).toBe('scheduled_not_durable');
    expect(JSON.stringify(result)).not.toContain('Private');
  });
  it.each(['before-list', 'create', 'after-list', 'raw-config', 'save'])('session loss at awaited %s stops later commands and retains only safe progress', async (at) => {
    const h = harness(), stage = await prepare(h), slow = deferred(), original = h.ws.getMockImplementation(); let lists = 0;
    h.ws.mockImplementation((m) => {
      const phase = m.type === 'lovelace/dashboards/list' ? (++lists === 1 ? 'before-list' : 'after-list') : m.type === 'lovelace/dashboards/create' ? 'create'
        : m.type === 'lovelace/config' ? 'raw-config' : 'save'; return phase === at ? slow.promise : original(m);
    });
    const pending = h.client.publish(stage.token, { namespace: 'new-house', approved: true });
    for (let i = 0; i < 20; i++) { await tick(); if ((at === 'before-list' && h.ws.mock.calls.length === 1) || (at === 'create' && h.ws.mock.calls.length === 2)
      || (at === 'after-list' && h.ws.mock.calls.length === 3) || (at === 'raw-config' && h.ws.mock.calls.length === 4) || (at === 'save' && h.ws.mock.calls.length === 5)) break; }
    const count = h.ws.mock.calls.length; h.user.is_admin = false; h.client.revalidate(); h.user.is_admin = true; h.client.revalidate();
    const result = await pending; expect(code(result)).toBe('stale'); expect(result.stage).toBeNull(); expect(h.ws).toHaveBeenCalledTimes(count);
    expect(result.publication.creation).toBe(at === 'before-list' ? 'not_sent' : at === 'create' ? 'sent_unknown' : 'acknowledged');
    expect(result.publication.save).toBe(at === 'save' ? 'sent_unknown' : 'not_sent');
    slow.resolve(at === 'create' ? { id: 'late', ...h.stage.target_dashboard } : null); await tick(); expect(h.ws).toHaveBeenCalledTimes(count);
  });
  it('cancel during staging reports potentially written files and never exposes a late publish token', async () => {
    const h = harness(), inspection = await h.client.inspect(bytes()), slow = deferred(); h.fetch.mockReturnValueOnce(slow.promise);
    const pending = h.client.stage(inspection.token, { namespace: 'new-house', previewApproved: true }); await tick(); h.client.cancel();
    const result = await pending; expect(result).toMatchObject({ ok: false, status: 'review_required', token: null, orphans: [{ kind: 'staged_files', namespace: 'new-house', status: 'may_exist' }] });
    slow.resolve(response(h.stage)); await tick(); expect(h.client.staging).toBeNull(); expect(h.ws).not.toHaveBeenCalled();
  });
});
