import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardBackupClient, DASHBOARD_BACKUP_CLIENT_LIMITS as LIMITS } from '../src/dashboard-backup-client.js';

// Only HA's decoded read transport is replaced. Real JSON descriptors, Unicode,
// byte budgets, connection events and concurrent promises remain in use.
const clients = [], copy = (value) => structuredClone(value), tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const card = (key = 'shared-house') => ({ type: 'custom:taylors3d-card', layout_key: key });
function harness(options = {}) {
  const connection = Object.assign(new EventTarget(), { connected: true, options: { auth: {} } });
  vi.spyOn(connection, 'addEventListener'); vi.spyOn(connection, 'removeEventListener');
  const user = { id: 'exact-user', is_active: true, is_admin: false };
  const dashboard = { title: 'Actual house', views: [{ title: 'A', cards: [card(), { type: 'custom:foreign-card', raw: { entity: 'light.actual', extra: [1, 'keep'] } }] }],
    extras: { '/~actual': { sections: [{ cards: [{ type: 'conditional', card: card('other') }] }] } } };
  const dashboards = [{ id: 'house-id', url_path: 'dashboard-house', mode: 'storage', title: 'Actual house', require_admin: false,
    show_in_sidebar: true, extension: { keep: ['unknown', 4] } }];
  const resources = [{ id: 'r', type: 'module', url: '/hacsfiles/taylors-3d/taylors3d-card.js', custom: { credit: 'unchanged' } }];
  const info = { resource_mode: 'storage', extension: { retained: true } };
  const h = { connection, user, dashboard, dashboards, resources, info };
  const callWS = vi.fn(async (message) => {
    if (message.type === 'lovelace/config') return h.dashboard;
    if (message.type === 'lovelace/dashboards/list') return h.dashboards;
    if (message.type === 'lovelace/resources') return h.resources;
    if (message.type === 'lovelace/info') return h.info;
    throw new Error('Unexpected request');
  });
  h.current = { connection, user, callWS, auth: {}, callService: vi.fn(), fetchWithAuth: vi.fn() };
  Object.assign(h, options); h.client = new DashboardBackupClient({ getHass: () => h.current }); clients.push(h.client); return h;
}
const code = (result) => result.diagnostics[0]?.code;
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()); vi.restoreAllMocks(); });

describe('read-only selected dashboard collection', () => {
  it('preserves the full heterogeneous dashboard, metadata/resource fields, order and exact IDs without source mutation', async () => {
    const h = harness(), before = copy([h.dashboard, h.dashboards, h.resources, h.info]), result = await h.client.collect('dashboard-house');
    expect(result).toMatchObject({ ok: true, dashboard: h.dashboard, source: { url_path: 'dashboard-house', mode: 'storage', metadata: h.dashboards[0] },
      resources: { mode: 'storage', items: h.resources }, info: h.info, collectionReady: true });
    expect(result.cards).toEqual([{ pointer: '/views/0/cards/0', layout_key: 'shared-house' },
      { pointer: '/extras/~1~0actual/sections/0/cards/0/card', layout_key: 'other' }]);
    expect(result.layout_keys).toEqual(['shared-house', 'other']); expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'resource_dependency', severity: 'dependency' })]);
    expect(h.current.callWS.mock.calls.map(([message]) => message)).toEqual([
      { type: 'lovelace/config', url_path: 'dashboard-house', force: true }, { type: 'lovelace/dashboards/list' }, { type: 'lovelace/resources' }, { type: 'lovelace/info' }]);
    result.dashboard.views[0].cards[1].raw.entity = 'changed'; result.source.metadata.extension.keep.push('changed'); result.resources.items[0].custom.credit = 'changed';
    result.info.extension.retained = false; result.diagnostics[0].message = 'changed';
    expect([h.dashboard, h.dashboards, h.resources, h.info]).toEqual(before); expect(h.client.diagnostics[0].message).not.toBe('changed');
    expect(h.current.callService).not.toHaveBeenCalled(); expect(h.current.fetchWithAuth).not.toHaveBeenCalled();
  });
  it('allows ordinary non-admin read access and compatible missing is_active', async () => {
    const h = harness(); delete h.user.is_active; expect((await h.client.collect('dashboard-house')).ok).toBe(true);
    expect(h.client.revalidate()).toBe(true); expect((await h.client.dashboards()).dashboards).toEqual(h.dashboards);
  });
  it('rejects a current explicit administrator-only dashboard without exposing its config', async () => {
    const h = harness(); h.dashboards[0].require_admin = true; const denied = await h.client.collect('dashboard-house');
    expect(denied).toMatchObject({ ok: false, dashboard: null, collectionReady: false }); expect(code(denied)).toBe('unauthorized');
    h.user.is_admin = true; h.client.revalidate(); expect((await h.client.collect('dashboard-house')).ok).toBe(true);
  });
  it('preserves the exact default read and does not infer its source from resource mode', async () => {
    const h = harness(); h.dashboards = []; h.info.resource_mode = 'yaml'; const result = await h.client.collect(null);
    expect(result).toMatchObject({ ok: true, dashboard: h.dashboard, source: { url_path: null, mode: null, metadata: {} },
      resources: { mode: 'yaml' }, collectionReady: false }); expect(result.diagnostics.some((d) => d.code === 'source_mode')).toBe(true);
    expect(result.source.metadata).toEqual({});
    expect(h.current.callWS.mock.calls[0][0]).toEqual({ type: 'lovelace/config', url_path: null, force: true });
  });
  it('keeps raw generated strategy and surrounding unknown fields rather than materializing cards', async () => {
    const h = harness(); h.dashboard = { strategy: { type: 'original-custom-strategy', options: { entities: ['light.exact'], opaque: [4, {}] } }, other: { version: 7 } };
    h.dashboards = []; const result = await h.client.collect(null);
    expect(result).toMatchObject({ ok: true, dashboard: h.dashboard, source: { mode: 'generated', metadata: {} }, cards: [], layout_keys: [], collectionReady: true });
    expect(result.source.metadata).toEqual({});
  });
  it('retains actual named source metadata when that source contains a strategy', async () => {
    const h = harness(); h.dashboard = { strategy: { type: 'original' } };
    expect((await h.client.collect('dashboard-house')).source).toEqual({ url_path: 'dashboard-house', mode: 'generated', metadata: h.dashboards[0] });
  });
  it('keeps malformed raw strategy as a diagnostic instead of generating a replacement', async () => {
    const h = harness(); h.dashboard.strategy = []; const result = await h.client.collect('dashboard-house');
    expect(result.dashboard.strategy).toEqual([]); expect(result.collectionReady).toBe(false); expect(result.diagnostics.some((d) => d.code === 'dashboard_strategy')).toBe(true);
  });
  it.each([{}, { title: 'No views' }, { title: 'Malformed persisted dashboard', views: {} }, { views: null }, { strategy: [], views: 'invalid' }])('retains malformed dashboard shape %j but does not claim archive readiness', async (raw) => {
      const h = harness(); h.dashboard = raw; h.resources = []; const result = await h.client.collect('dashboard-house');
      expect(result).toMatchObject({ ok: true, dashboard: raw, collectionReady: false }); expect(result.diagnostics.some((d) => d.code === 'dashboard_shape')).toBe(true);
    });
  it('does not guess a missing named source from another similar dashboard', async () => {
    const h = harness(); h.dashboards[0].url_path = 'dashboard-house-similar'; const result = await h.client.collect('dashboard-house');
    expect(result).toMatchObject({ ok: true, dashboard: h.dashboard, source: { mode: null, metadata: {} }, collectionReady: false });
    expect(result.diagnostics.some((d) => d.code === 'source_metadata')).toBe(true);
  });
  it.each([undefined, '', ' ', false, 0, {}, [], 'dashboard\nsecret', 'x'.repeat(257), '\ud800'])('requires an explicit exact source, rejecting %j with no transport', async (path) => {
    const h = harness(), result = await h.client.collect(path); expect(result.ok).toBe(false); expect(['url_path', 'utf8']).toContain(code(result)); expect(h.current.callWS).not.toHaveBeenCalled();
  });
  it('never uses browser address, fetches dependency URLs, or reads normalizing LayoutStore backends', async () => {
    const h = harness(); h.resources.push({ type: 'html', url: 'https://external.invalid/resource?opaque=keep' });
    h.dashboard.views[0].cards[0].model = 'https://external.invalid/original.glb'; const result = await h.client.collect('dashboard-house');
    expect(result.dashboard.views[0].cards[0].model).toBe('https://external.invalid/original.glb'); expect(result.resources.items[1].url).toContain('opaque=keep');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['model_dependency', 'resource_dependency', 'resource_dependency']);
    expect(h.current.callWS).toHaveBeenCalledTimes(4); expect(h.current.fetchWithAuth).not.toHaveBeenCalled(); expect(h.current.callService).not.toHaveBeenCalled();
  });
  it.each(['lovelace/dashboards/list', 'lovelace/resources', 'lovelace/info'])('retains a permitted raw dashboard after %s is denied, without guessing completeness', async (type) => {
    const h = harness(), original = h.current.callWS.getMockImplementation(); h.current.callWS.mockImplementation((message) => message.type === type
      ? Promise.reject({ code: 'unauthorized', message: 'https://user:credential@server.invalid/private' }) : original(message));
    const result = await h.client.collect('dashboard-house'); expect(result).toMatchObject({ ok: true, dashboard: h.dashboard, collectionReady: false });
    expect(result.diagnostics.some((d) => d.code === 'unauthorized')).toBe(true); expect(JSON.stringify(result.diagnostics)).not.toContain('credential');
    if (type === 'lovelace/info') expect(result.resources).toEqual({ mode: null, items: h.resources });
  });
  it.each([['unauthorized', 'unauthorized'], ['config_not_found', 'missing'], ['unknown_command', 'unsupported'], ['opaque-server-code', 'network']])('does not echo sensitive config read errors %s', async (rawCode, expected) => {
    const h = harness(), original = h.current.callWS.getMockImplementation(); h.current.callWS.mockImplementation((message) => message.type === 'lovelace/config'
      ? Promise.reject({ code: rawCode, message: 'Secret original server URL/token' }) : original(message));
    const result = await h.client.collect('dashboard-house'); expect(result).toMatchObject({ ok: false, dashboard: null }); expect(code(result)).toBe(expected);
    expect(JSON.stringify(result)).not.toContain('Secret');
  });
  it('captures each response immediately so a later mutation cannot replace its raw readings', async () => {
    const h = harness(), slow = deferred(), original = h.current.callWS.getMockImplementation(); h.current.callWS.mockImplementation((message) => message.type === 'lovelace/info' ? slow.promise : original(message));
    const pending = h.client.collect('dashboard-house'); await tick(); h.dashboard.title = 'later'; h.resources[0].url = 'https://later.invalid';
    h.dashboards[0].title = 'later'; slow.resolve(h.info); const result = await pending;
    expect(result.dashboard.title).toBe('Actual house'); expect(result.resources.items[0].url).toContain('/hacsfiles/'); expect(result.source.metadata.title).toBe('Actual house');
  });
});

describe('exact references and bounded raw JSON', () => {
  it('preserves missing selections and discovers nested entries in source order with canonical JSON pointers', async () => {
    const h = harness(); h.dashboard = { views: [{ sections: [{ cards: [{ type: 'conditional', card: { type: 'custom:taylors3d-card' } }, card(''),
      card(null), card('🏠'.repeat(64)), { type: 'custom:taylors3d-card-similar', layout_key: 'ignore' }] }] }], '/~': card('exact/~key') };
    const result = await h.client.collect('dashboard-house'); expect(result.cards).toEqual([
      { pointer: '/views/0/sections/0/cards/0/card', layout_key: 'default' }, { pointer: '/views/0/sections/0/cards/1', layout_key: null },
      { pointer: '/views/0/sections/0/cards/2', layout_key: null }, { pointer: '/views/0/sections/0/cards/3', layout_key: '🏠'.repeat(64) }, { pointer: '/~1~0', layout_key: 'exact/~key' }]);
    expect(result.layout_keys).toEqual(['default', '🏠'.repeat(64), 'exact/~key']); expect(result.dashboard).toEqual(h.dashboard); expect(result.collectionReady).toBe(false);
  });
  it.each([{}, [], true, ' '])('matches JavaScript truthy explicit model semantics for %j', async (model) => {
    const h = harness(); h.dashboard = { views: [{ cards: [{ ...card(), model }] }] }; const result = await h.client.collect('dashboard-house');
    expect(result.dashboard).toEqual(h.dashboard); expect(result.collectionReady).toBe(false); expect(result.diagnostics.some((d) => d.code === 'model_reference')).toBe(true);
  });
  it.each([null, false, 0, -0, ''])('preserves legitimate falsy explicit model %j without inventing dependency', async (model) => {
    const h = harness(); h.dashboard = { views: [{ cards: [{ ...card(), model }] }] }; const result = await h.client.collect('dashboard-house');
    expect(result.dashboard).toEqual(h.dashboard); expect(result.diagnostics.some((d) => d.code.startsWith('model_'))).toBe(false);
  });
  it('deduplicates exact shared layout keys but requires a deliberate limit of 64 distinct keys', async () => {
    const h = harness(); h.dashboard = { nested: Array.from({ length: 4096 }, () => card('shared')) };
    expect((await h.client.collect('dashboard-house')).layout_keys).toEqual(['shared']);
    h.dashboard = { nested: Array.from({ length: 65 }, (_, i) => card(String(i))) }; expect(code(await h.client.collect('dashboard-house'))).toBe('count');
    h.dashboard = { nested: Array.from({ length: 4097 }, () => card('shared')) }; expect(code(await h.client.collect('dashboard-house'))).toBe('card_budget');
  });
  it('counts the entire eventual save envelope, not just the dashboard body', async () => {
    const h = harness(); h.dashboard = { title: 'x'.repeat(LIMITS.dashboard - 20) };
    const result = await h.client.collect('dashboard-house'); expect(result.dashboard).toBeNull(); expect(code(result)).toBe('wire_budget');
    const overhead = new TextEncoder().encode(JSON.stringify({ id: 1, type: 'lovelace/config/save', url_path: 'dashboard-house', config: { title: '' } })).length;
    h.dashboard.title = 'x'.repeat(LIMITS.dashboard - overhead); expect((await h.client.collect('dashboard-house')).ok).toBe(true);
    h.dashboard.title += 'x'; expect(code(await h.client.collect('dashboard-house'))).toBe('wire_budget');
  });
  it('counts UTF-8 and JSON escape bytes, rather than JavaScript character count', async () => {
    const h = harness(); h.dashboard = { title: '🏠'.repeat(Math.ceil(LIMITS.dashboard / 4)) }; expect(code(await h.client.collect('dashboard-house'))).toBe('json_size');
    h.dashboard = { title: '\n'.repeat(LIMITS.dashboard / 2) }; expect(code(await h.client.collect('dashboard-house'))).toBe('json_size');
  });
  it.each([
    ['NaN', () => NaN, 'json_number'], ['Infinity', () => Infinity, 'json_number'], ['undefined', () => undefined, 'json_type'],
    ['Date', () => new Date(), 'json_type'], ['Map', () => new Map(), 'json_type'], ['BigInt', () => 1n, 'json_type'],
    ['lone surrogate', () => '\ud800', 'utf8'], ['sparse array', () => Array(2), 'json_type'], ['cycle', () => { const a = {}; a.self = a; return a; }, 'json_cycle'],
    ['nonenumerable', () => Object.defineProperty({}, 'hidden', { value: 4 }), 'json_type'], ['symbol', () => ({ [Symbol('unknown')]: 4 }), 'json_type'],
  ])('rejects ambiguous/coerced raw value %s without mutating or returning a guessed dashboard', async (_label, make, expected) => {
    const h = harness(); h.dashboard = { extra: make() }; expect(code(await h.client.collect('dashboard-house'))).toBe(expected);
  });
  it('does not execute getters or toJSON, and safely preserves __proto__ own data', async () => {
    const h = harness(), get = vi.fn(() => 'executed'); h.dashboard = { extra: Object.defineProperty({}, 'secret', { get, enumerable: true }) };
    expect(code(await h.client.collect('dashboard-house'))).toBe('json_type'); expect(get).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => ({ changed: true })); h.dashboard = { extra: { toJSON } }; expect(code(await h.client.collect('dashboard-house'))).toBe('json_type'); expect(toJSON).not.toHaveBeenCalled();
    h.dashboard = JSON.parse('{"__proto__":{"exact":true},"views":[]}'); const result = await h.client.collect('dashboard-house');
    expect(Object.hasOwn(result.dashboard, '__proto__')).toBe(true); expect(Object.getPrototypeOf(result.dashboard)).toBe(Object.prototype); expect(result.dashboard.__proto__).toEqual({ exact: true });
  });
  it('rejects depth/value budgets before serializing, but does not mistake shared objects for cycles', async () => {
    const h = harness(); let nested = {}; for (let i = 0; i < 65; i++) nested = { next: nested }; h.dashboard = nested;
    expect(code(await h.client.collect('dashboard-house'))).toBe('json_complexity'); h.dashboard = { many: Array(250000).fill(null) };
    expect(code(await h.client.collect('dashboard-house'))).toBe('json_complexity'); const shared = { exact: 1 }; h.dashboard = { a: shared, b: shared };
    const result = await h.client.collect('dashboard-house'); expect(result.dashboard).toEqual(h.dashboard); expect(result.dashboard.a).not.toBe(result.dashboard.b);
  });
  it.each([
    ['duplicate source', (h) => h.dashboards.push(copy(h.dashboards[0])), 'ambiguous'],
    ['mode', (h) => { h.dashboards[0].mode = 'guessed'; }, 'shape'], ['permission', (h) => { h.dashboards[0].require_admin = 'false'; }, 'shape'],
    ['list limit', (h) => { h.dashboards = Array.from({ length: 1025 }, (_, i) => ({ url_path: String(i), mode: 'storage' })); }, 'shape'],
    ['metadata bytes', (h) => { h.dashboards[0].extra = 'x'.repeat(LIMITS.metadata); }, 'json_size'],
  ])('rejects %s dashboard-list data while retaining permitted selected raw config', async (_label, change, expected) => {
    const h = harness(); change(h); const result = await h.client.collect('dashboard-house'); expect(result).toMatchObject({ ok: true, dashboard: h.dashboard, collectionReady: false });
    expect(result.diagnostics.some((d) => d.code === expected)).toBe(true); expect((await h.client.dashboards()).ok).toBe(false);
  });
  it.each([
    ['resource URL', (h) => { h.resources[0].url = ''; }], ['resource type', (h) => { h.resources[0].type = 'execute'; }],
    ['resource list', (h) => { h.resources = {}; }], ['info mode', (h) => { h.info.resource_mode = 'guessed'; }],
  ])('reports invalid %s without claiming a ready collection', async (_label, change) => {
    const h = harness(); change(h); const result = await h.client.collect('dashboard-house'); expect(result.collectionReady).toBe(false); expect(result.diagnostics.some((d) => d.code === 'shape')).toBe(true);
  });
});

describe('monotonic session, permission and selected-source fences', () => {
  it.each([
    ['missing user', (h) => { h.current.user = null; }], ['blank ID', (h) => { h.user.id = ' '; }], ['false active', (h) => { h.user.is_active = false; }],
    ['malformed active', (h) => { h.user.is_active = 'true'; }], ['disconnected', (h) => { h.connection.connected = false; }],
  ])('requires current session %s without reads', async (_label, change) => {
    const h = harness(); change(h); expect(code(await h.client.collect('dashboard-house'))).toBe('session'); expect(h.current.callWS).not.toHaveBeenCalled();
  });
  it('returns a clear transport result with no callWS rather than using HTTP or service fallbacks', async () => {
    const h = harness(); h.current.callWS = null; expect(code(await h.client.collect('dashboard-house'))).toBe('transport'); expect(h.current.fetchWithAuth).not.toHaveBeenCalled();
  });
  it.each([
    ['user object', (h) => { h.current.user = { ...h.user }; }], ['ID', (h) => { h.user.id = 'different'; }],
    ['connection', (h) => { h.current.connection = Object.assign(new EventTarget(), { connected: true }); }],
    ['callWS', (h) => { h.current.callWS = vi.fn(h.current.callWS.getMockImplementation()); }],
    ['auth', (h) => { h.current.auth = {}; }], ['connection auth', (h) => { h.connection.options.auth = {}; }],
    ['active loss', (h) => { h.user.is_active = false; }], ['admin loss', (h) => { h.user.is_admin = false; }],
  ])('discards pending reads after observed %s even when the old response later succeeds', async (_label, change) => {
    const h = harness(); h.user.is_admin = true; const slow = deferred(), original = h.current.callWS.getMockImplementation();
    h.current.callWS.mockImplementation((message) => message.type === 'lovelace/config' ? slow.promise : original(message));
    const pending = h.client.collect('dashboard-house'); await tick(); const oldGeneration = h.client.generation; change(h); h.client.revalidate();
    expect(h.client.generation).toBeGreaterThan(oldGeneration); const result = await pending; expect(result).toMatchObject({ ok: false, dashboard: null }); expect(code(result)).toBe('stale');
    slow.resolve(h.dashboard); await tick(); expect(h.client.diagnostics).toEqual([]);
  });
  it('poisons observed loss then recovery of the same account/connection objects', async () => {
    const h = harness(), slow = deferred(), original = h.current.callWS.getMockImplementation();
    h.current.callWS.mockImplementation((message) => message.type === 'lovelace/config' ? slow.promise : original(message));
    const pending = h.client.collect('dashboard-house'); await tick(); h.user.is_active = false; expect(h.client.revalidate()).toBe(false);
    h.user.is_active = true; expect(h.client.revalidate()).toBe(true); slow.resolve(h.dashboard); expect(code(await pending)).toBe('stale');
  });
  it.each(['disconnected', 'reconnect-error'])('latches official %s events even if current connection immediately recovers', async (event) => {
    const h = harness(), slow = deferred(), original = h.current.callWS.getMockImplementation();
    h.current.callWS.mockImplementation((message) => message.type === 'lovelace/config' ? slow.promise : original(message));
    const pending = h.client.collect('dashboard-house'); await tick(); h.connection.dispatchEvent(new Event(event));
    expect(code(await pending)).toBe('stale'); expect(h.client.revalidate()).toBe(true); slow.reject(new Error('late credential failure')); await tick();
  });
  it('does not reset on unrelated HA state updates or refreshed tokens within the same auth object', async () => {
    const h = harness(), slow = deferred(), original = h.current.callWS.getMockImplementation();
    h.current.callWS.mockImplementation((message) => message.type === 'lovelace/config' ? slow.promise : original(message));
    const pending = h.client.collect('dashboard-house'); await tick(); const generation = h.client.generation;
    h.current = { ...h.current, states: { 'sensor.unrelated': { state: '2' } } }; h.current.auth.accessToken = 'refreshed'; h.client.revalidate();
    expect(h.client.generation).toBe(generation); slow.resolve(h.dashboard); expect((await pending).ok).toBe(true);
  });
  it('latest explicit dashboard selection cancels older reads without stale result or diagnostics overwriting the new source', async () => {
    const h = harness(), older = deferred(), newer = deferred(); h.dashboards.push({ ...h.dashboards[0], id: 'other', url_path: 'dashboard-other' });
    const original = h.current.callWS.getMockImplementation(); h.current.callWS.mockImplementation((message) => message.type === 'lovelace/config'
      ? message.url_path === 'dashboard-house' ? older.promise : newer.promise : original(message));
    const first = h.client.collect('dashboard-house'); await tick(); const second = h.client.collect('dashboard-other'); await tick();
    expect(code(await first)).toBe('stale'); newer.resolve({ title: 'exact other', views: [] }); expect((await second).source.url_path).toBe('dashboard-other');
    const diagnostics = copy(h.client.diagnostics); older.reject(new Error('late confidential failure')); await tick(); expect(h.client.diagnostics).toEqual(diagnostics);
  });
  it('an invalid new selection cannot allow an earlier valid selection to reappear', async () => {
    const h = harness(), slow = deferred(), original = h.current.callWS.getMockImplementation(); h.current.callWS.mockImplementation((message) => message.type === 'lovelace/config' ? slow.promise : original(message));
    const older = h.client.collect('dashboard-house'); await tick(); expect(code(await h.client.collect(undefined))).toBe('url_path'); expect(code(await older)).toBe('stale');
    slow.resolve(h.dashboard); await tick(); expect(h.client.diagnostics[0].code).toBe('url_path');
  });
  it('a concurrent list refresh does not supersede selected-source collection', async () => {
    const h = harness(), slow = deferred(), original = h.current.callWS.getMockImplementation(); h.current.callWS.mockImplementation((message) => message.type === 'lovelace/config' ? slow.promise : original(message));
    const pending = h.client.collect('dashboard-house'); await tick(); expect((await h.client.dashboards()).ok).toBe(true); slow.resolve(h.dashboard);
    expect((await pending).ok).toBe(true); expect(h.current.callWS).toHaveBeenCalledTimes(5);
  });
  it('recovers safely from initially missing/throwing getHass without stale listener errors', async () => {
    let current = null; const client = new DashboardBackupClient({ getHass: () => current }); clients.push(client); expect(client.revalidate()).toBe(false);
    expect(code(await client.collect(null))).toBe('session'); const h = harness(); current = h.current; expect(client.revalidate()).toBe(true);
    expect((await client.collect('dashboard-house')).ok).toBe(true);
    const broken = new DashboardBackupClient({ getHass: () => { throw new Error('private getter'); } }); clients.push(broken);
    expect(code(await broken.collect(null))).toBe('session');
  });
  it('disposes pending work immediately and removes only owned connection listeners once', async () => {
    const h = harness(), slow = deferred(), original = h.current.callWS.getMockImplementation(); h.current.callWS.mockImplementation((message) => message.type === 'lovelace/config' ? slow.promise : original(message));
    const pending = h.client.collect('dashboard-house'); await tick(); h.client.dispose(); expect(code(await pending)).toBe('disposed');
    expect(h.connection.removeEventListener.mock.calls.map(([name]) => name)).toEqual(['disconnected', 'reconnect-error']);
    const generation = h.client.generation; h.client.dispose(); h.connection.dispatchEvent(new Event('disconnected')); expect(h.client.generation).toBe(generation);
    slow.resolve(h.dashboard); await tick(); expect(code(await h.client.collect('dashboard-house'))).toBe('disposed'); expect(h.client.revalidate()).toBe(false);
  });
  it('revalidation has no reads, timers, loops or service actions', async () => {
    const h = harness(), timer = vi.spyOn(globalThis, 'setTimeout'); for (let i = 0; i < 20; i++) expect(h.client.revalidate()).toBe(true);
    expect(h.current.callWS).not.toHaveBeenCalled(); expect(h.current.callService).not.toHaveBeenCalled(); expect(timer).not.toHaveBeenCalled();
  });
});
