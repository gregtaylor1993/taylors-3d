import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardBackupExportClient, DASHBOARD_EXPORT_LIMITS as LIMITS } from '../src/dashboard-backup-export.js';

// Real raw collection/Blob/Response/streams/session fences; only HA HTTP/WS
// boundaries are replaced. Server ZIP validation and live HA remain unproven here.
const clients = [], tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }, copy = (v) => structuredClone(v);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const zip = new Uint8Array([80, 75, 3, 4, 6]), resultCode = (r) => r.diagnostics[0]?.code;
const download = (data = zip, complete = true, extra = {}) => new Response(data, { headers: { 'content-type': 'application/zip', 'content-length': String(data.byteLength), 'x-taylors3d-complete': String(complete), ...extra } });
function harness() {
  const h = { dashboard: { title: 'Simulated whole dashboard', views: [{ cards: [{ type: 'custom:taylors3d-card', layout_key: 'house' }, { type: 'custom:foreign-card', raw: { preserve: true } }] },
    { cards: [{ type: 'custom:taylors3d-card', layout_key: 'other' }] }], unknown: { untouched: [1, 'x'] } }, shared: { house: { extra: 'shared' }, other: null }, users: {}, storage: new Map(), currentScreen: true };
  h.getItem = vi.fn((key) => h.storage.get(key) ?? null); h.user = { id: 'actual-user', is_admin: false, is_active: true };
  h.connection = Object.assign(new EventTarget(), { connected: true, options: { auth: {} } });
  h.ws = vi.fn(async (message) => {
    if (message.type === 'lovelace/config') return h.dashboard;
    if (message.type === 'lovelace/dashboards/list') return [{ id: 'selected', url_path: 'dashboard-selected', mode: 'storage', title: 'Selected actual dashboard' }];
    if (message.type === 'lovelace/resources') return [{ type: 'module', url: 'https://external.invalid/unchanged.js', raw: true }];
    if (message.type === 'lovelace/info') return { resource_mode: 'storage' };
    if (message.type === 'taylors3d/layout/get') return { layout: Object.hasOwn(h.shared, message.key) ? h.shared[message.key] : null };
    if (message.type === 'frontend/get_user_data') return { value: h.users[message.key] ?? null };
    throw { code: 'unknown_command' };
  });
  h.fetch = vi.fn(async (_route, options) => { h.payload = JSON.parse(options.body); return download(); });
  h.current = { user: h.user, connection: h.connection, auth: {}, callWS: h.ws, fetchWithAuth: h.fetch, callService: vi.fn() };
  h.client = new DashboardBackupExportClient({ getHass: () => h.current, getStorage: () => ({ getItem: h.getItem }), isCurrent: () => h.currentScreen }); clients.push(h.client); return h;
}
afterEach(() => { clients.splice(0).forEach((c) => c.dispose()); vi.restoreAllMocks(); });

describe('actual whole dashboard collection and explicit snapshot provenance', () => {
  it('re-reads whole named dashboard, preserving foreign cards/views/resources; only requests own export route', async () => {
    const h = harness(), before = copy(h.dashboard), result = await h.client.create('dashboard-selected');
    expect(result).toMatchObject({ ok: true, complete: true, filename: 'taylors3d-dashboard-backup.zip' });
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(zip); expect(h.payload.dashboard).toEqual(before);
    expect(h.payload).toMatchObject({ source: { url_path: 'dashboard-selected', mode: 'storage' }, shared_keys: ['house', 'other'], layouts: {} });
    expect(h.payload.resources.items[0].url).toBe('https://external.invalid/unchanged.js'); expect(h.payload).not.toHaveProperty('allow_incomplete');
    expect(h.fetch).toHaveBeenCalledExactlyOnceWith('/api/taylors3d/dashboard_backup/export', expect.objectContaining({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' } }));
    expect(h.ws.mock.calls.map(([m]) => m.type)).toEqual(['lovelace/config', 'lovelace/dashboards/list', 'lovelace/resources', 'lovelace/info']);
    expect(h.getItem).not.toHaveBeenCalled(); expect(h.current.callService).not.toHaveBeenCalled(); expect(h.dashboard).toEqual(before);
  });
  it('uses exact default:null and retains unresolved source mode for actual backend resolution, without a browser-route guess', async () => {
    const h = harness(), result = await h.client.create(null); expect(result.ok).toBe(true);
    expect(h.ws.mock.calls[0][0]).toEqual({ type: 'lovelace/config', url_path: null, force: true }); expect(h.payload.source).toMatchObject({ url_path: null, mode: null });
    expect(result.collection.diagnostics.some((d) => d.code === 'source_mode')).toBe(true);
  });
  it('preserves exact raw browser text and unknown fields only for referenced missing shared keys under explicit consent', async () => {
    const h = harness(), raw = '{ "version": 9, "rooms": null, "model": {"opaque":true}, "unknown": [1,2] }';
    h.storage.set('taylors3d_other', raw); h.storage.set('unrelated-secret', 'never read'); h.storage.set('taylors3d_unreferenced', 'never read');
    const result = await h.client.create('dashboard-selected', { includeBrowserFallback: true }); expect(result.ok).toBe(true);
    expect(h.getItem.mock.calls).toEqual([['taylors3d_other']]); expect(h.payload.shared_keys).toEqual(['house']);
    expect(h.payload.layouts.other).toEqual({ backend: 'browser', layout_json: raw, metadata: { source: 'localStorage', scope: 'same_browser_only', storage_key: 'taylors3d_other', normalized: false } });
    expect(h.payload.layouts.other).not.toHaveProperty('layout'); expect(result.provenance.find((p) => p.key === 'other').backend).toBe('browser');
  });
  it('selects the actual raw account value before browser when both fallback scopes are enabled', async () => {
    const h = harness(); h.users.taylors3d_other = { version: 8, rooms: 'retained malformed shape', unknown: { exact: [3] } };
    h.storage.set('taylors3d_other', '{"wrong":"do not silently choose"}');
    expect((await h.client.create('dashboard-selected', { includeUserFallback: true, includeBrowserFallback: true })).ok).toBe(true);
    expect(h.payload.layouts.other).toEqual({ backend: 'user', layout: h.users.taylors3d_other, metadata: { source: 'frontend/get_user_data', scope: 'current_user', user_id: 'actual-user', normalized: false } });
    expect(h.getItem).not.toHaveBeenCalled(); expect(h.ws.mock.calls.some(([m]) => m.type === 'frontend/set_user_data')).toBe(false);
  });
  it('keeps missing layouts unresolved instead of inventing empty defaults; incomplete header remains truthful', async () => {
    const h = harness(); h.fetch.mockImplementation(async (_route, options) => { h.payload = JSON.parse(options.body); return download(zip, false); });
    const result = await h.client.create('dashboard-selected', { includeBrowserFallback: true });
    expect(result).toMatchObject({ ok: true, complete: false }); expect(h.payload.shared_keys).toEqual(['house', 'other']); expect(h.payload.layouts).toEqual({});
    expect(result.warnings.some((m) => m.includes('incomplete'))).toBe(true);
  });
  it('does not treat a failed shared/account read as proof of absence or choose another fallback silently', async () => {
    const h = harness(), original = h.ws.getMockImplementation(); h.ws.mockImplementation((m) => m.type === 'taylors3d/layout/get' ? Promise.reject({ code: 'unauthorized' }) : original(m));
    expect(resultCode(await h.client.create('dashboard-selected', { includeBrowserFallback: true }))).toBe('fallback'); expect(h.fetch).not.toHaveBeenCalled(); expect(h.getItem).not.toHaveBeenCalled();
  });
  it.each(['not json', '[]', 'null'])('does not normalize malformed browser text %j into a fake layout', async (raw) => {
    const h = harness(); h.storage.set('taylors3d_other', raw); expect((await h.client.create('dashboard-selected', { includeBrowserFallback: true })).ok).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('keeps own __proto__ layout IDs/data without prototype assignment or loss', async () => {
    const h = harness(); h.dashboard = { views: [{ cards: [{ type: 'custom:taylors3d-card', layout_key: '__proto__' }] }] };
    h.storage.set('taylors3d___proto__', '{"__proto__":{"raw":true},"rooms":[]}');
    expect((await h.client.create('dashboard-selected', { includeBrowserFallback: true })).ok).toBe(true);
    expect(Object.hasOwn(h.payload.layouts, '__proto__')).toBe(true); expect(h.payload.layouts.__proto__.layout_json).toContain('"__proto__"');
  });
});

describe('bounded authenticated ZIP stream and cancellation', () => {
  it.each([['wrong type', { 'content-type': 'text/html' }, 'shape'], ['no truth marker', { 'x-taylors3d-complete': '' }, 'shape'],
    ['over-budget length', { 'content-length': String(LIMITS.archive + 1) }, 'size'], ['truncated output', { 'content-length': '100' }, 'network'],
    ['too many bytes', { 'content-length': '1' }, 'size']])('rejects %s with no downloadable partial Blob', async (_name, headers, expected) => {
    const h = harness(); h.fetch.mockResolvedValueOnce(download(zip, true, headers)); const result = await h.client.create(null); expect(resultCode(result)).toBe(expected); expect(result.blob).toBeNull();
  });
  it('rejects transport stream failure and releases/cancels the reader', async () => {
    const h = harness(), body = new ReadableStream({ start(c) { c.enqueue(zip.slice(0, 2)); c.error(new Error('interrupted')); } });
    h.fetch.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/zip', 'content-length': '5', 'x-taylors3d-complete': 'true' } }));
    const result = await h.client.create(null); expect(result.ok).toBe(false); expect(result.blob).toBeNull();
  });
  it.each([[401, 'unauthorized'], [403, 'unauthorized'], [404, 'unsupported'], [500, 'network']])('handles HTTP %d without exposing its body', async (status, expected) => {
    const h = harness(); h.fetch.mockResolvedValueOnce(new Response('private server detail', { status })); const result = await h.client.create(null);
    expect(resultCode(result)).toBe(expected); expect(JSON.stringify(result)).not.toContain('private');
  });
  it.each(['account', 'connection', 'auth', 'screen'])('observed %s loss during awaited export permanently poisons result', async (kind) => {
    const h = harness(), slow = deferred(); h.fetch.mockReturnValueOnce(slow.promise); const pending = h.client.create(null);
    for (let i = 0; i < 20 && !h.fetch.mock.calls.length; i++) await tick(); expect(h.fetch).toHaveBeenCalledOnce();
    if (kind === 'account') h.current.user = { ...h.user }; else if (kind === 'connection') h.connection.connected = false;
    else if (kind === 'auth') h.current.auth = {}; else h.currentScreen = false;
    h.client.revalidate(); if (kind === 'connection') h.connection.connected = true; if (kind === 'screen') h.currentScreen = true;
    const result = await pending; expect(result.blob).toBeNull(); expect(resultCode(result)).toBe('stale'); slow.resolve(download());
  });
  it('cancels an actual stalled response reader and offers no partial ZIP', async () => {
    const h = harness(), cancelled = vi.fn(); let stream;
    h.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { stream = c; }, cancel: cancelled }),
      { headers: { 'content-type': 'application/zip', 'content-length': '5', 'x-taylors3d-complete': 'true' } }));
    const pending = h.client.create(null); for (let i = 0; i < 20 && !h.fetch.mock.calls.length; i++) await tick(); await tick(); stream.enqueue(zip.slice(0, 2)); await tick(); h.client.cancel();
    expect((await pending).blob).toBeNull(); expect(cancelled).toHaveBeenCalled();
  });
  it('re-reads changed raw config on every explicit export rather than reusing a stale cached dashboard', async () => {
    const h = harness(); expect((await h.client.create(null)).ok).toBe(true); h.dashboard.unknown.untouched.push('new-current-reading');
    expect((await h.client.create(null)).ok).toBe(true); expect(h.payload.dashboard.unknown.untouched.at(-1)).toBe('new-current-reading');
    expect(h.ws.mock.calls.filter(([m]) => m.type === 'lovelace/config')).toHaveLength(2);
  });
});
