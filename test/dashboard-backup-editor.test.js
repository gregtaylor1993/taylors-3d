// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardBackupEditor } from '../src/dashboard-backup-editor.js';

// Actual read/export/restore clients are used, with only HA endpoint replies
// simulated. Native DOM events prove UI flow, not live HA middleware/real ZIPs.
const editors = [], copy = (v) => structuredClone(v), tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const hash = 'a'.repeat(64), key = 'restore_new-house_' + 'f'.repeat(46), path = 'taylors3d-restore-new-house';
// jsdom and Node Response use distinct Uint8Array realms. A real supplied stream
// emits this browser realm's byte arrays, matching native browser fetch chunks.
const streamed = (bytes, options) => new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), options);
const jsonResponse = (v, status = 200) => streamed(new Uint8Array(new TextEncoder().encode(JSON.stringify(v))), { status, headers: { 'content-type': 'application/json' } });
function inspection(dashboard) { return { manifest: { format: 'taylors3d-dashboard-backup', version: 1, complete: true,
  cards: [{ pointer: '/views/0/cards/0', layout_key: 'house' }], layouts: [{ key: 'house' }], models: [], furniture: [], resources: { mode: 'storage', items: [] } },
  report: { complete: true, diagnostics: [{ code: 'resource_dependency', path: '/resources/0', message: 'Install the declared external resource separately.', severity: 'dependency' }],
    counts: { cards: 1, layouts: 1, models: 0, furniture_packs: 0, members: 3 }, expanded_bytes: 300, nested_expanded_bytes: 0, verified_expanded_bytes: 300 },
  preview: { dashboard, layouts: { house: { backend: 'shared', metadata: {}, layout: { version: 1, extra: 'raw' } } } }, restoreAvailable: false }; }
function staging(dashboard) { const config = copy(dashboard); config.views[0].cards[0].layout_key = key;
  return { ok: true, namespace: 'new-house', restore_id: 'b'.repeat(32), target_dashboard: { url_path: path, mode: 'storage', title: 'Simulated restored dashboard' },
    save_message: { id: 1, type: 'lovelace/config/save', url_path: path, config }, resources: { mode: 'storage', items: [] },
    report: { valid: true, complete: true, archive_complete: true, allow_incomplete: false, publication_available: false, resources_installed: false,
      requires_current_admin_at_publication: true, requires_shared_integration: true, diagnostics: [], collision_checked: { internal: true, external: false },
      counts: { cards: 1, layouts: 1, models: 0, furniture_packs: 0 }, collision_targets: { dashboard_url_path: path, layout_keys: [key], model_keys: [], legacy_fallback_keys: ['taylors3d_' + key] } },
    staging: { models: [], layouts: [{ target_key: key, original_sha256: hash, staged_json_sha256: hash, persistence: 'scheduled_not_durable' }], furniture: [], unavailable: [],
      integrity_verified: true, integrity_scope: 'present_assets_and_populated_shared_layouts', layouts_persistence: 'scheduled_not_durable', dashboard_created: false, resources_installed: false,
      collision_evidence: { dashboard: 'absent_at_check', user_fallbacks: 'all_current_users_absent_at_check', browser: 'not_read;unchanged_and_shadowed_by_populated_shared_layouts', transaction: false } }, orphans: [] };
}
function setup({ admin = true } = {}) {
  const h = { dashboard: { views: [{ cards: [{ type: 'custom:taylors3d-card', layout_key: 'house' }, { type: 'custom:foreign-card', markup: '<script>not executed</script>', extra: { keep: 7 } }] }], extra: 'whole raw dashboard' },
    list: [{ id: 'named', url_path: 'dashboard-exact', mode: 'storage', title: 'Actual selected source' }], saved: [], creates: [], partial: false, exports: [] };
  h.inspection = inspection(copy(h.dashboard)); h.staging = staging(copy(h.dashboard));
  const user = { id: 'current-user', is_admin: admin, is_active: true }, connection = Object.assign(new EventTarget(), { connected: true, options: { auth: {} } });
  h.ws = vi.fn(async (message) => {
    if (message.type === 'lovelace/dashboards/list') return h.list;
    if (message.type === 'lovelace/config') { if (message.url_path === path) throw { code: 'config_not_found' }; return h.dashboard; }
    if (message.type === 'lovelace/resources') return [{ type: 'module', url: '/hacsfiles/other-card.js' }];
    if (message.type === 'lovelace/info') return { resource_mode: 'storage' };
    if (message.type === 'taylors3d/layout/get') return { layout: null };
    if (message.type === 'frontend/get_user_data') return { value: null };
    if (message.type === 'lovelace/dashboards/create') { const row = { ...message, id: 'exact-new-id' }; delete row.type; h.list.push(row); h.creates.push(copy(message)); return row; }
    if (message.type === 'lovelace/config/save') { h.saved.push(copy(message)); return null; }
    throw { code: 'unknown_command' };
  });
  h.fetch = vi.fn(async (route, options) => {
    if (route.endsWith('/export')) { h.exports.push(JSON.parse(options.body)); const bytes = new Uint8Array([80, 75, 3, 4]);
      return streamed(bytes, { headers: { 'content-type': 'application/zip', 'content-length': '4', 'x-taylors3d-complete': String(!h.partial) } }); }
    if (route.endsWith('/inspect')) return jsonResponse(h.inspection);
    if (route.includes('/stage/')) return jsonResponse(h.staging);
    throw new Error('Unexpected HTTP route');
  });
  h.card = { ownerDocument: document, isConnected: true, _editing: true, _edit: { tab: 'data' }, _config: { layout_key: 'house' }, _layout: { untouched: true },
    _view: { model: { root: { uuid: 'exact-root' } } }, _hass: { user, connection, auth: {}, callWS: h.ws, fetchWithAuth: h.fetch, callService: vi.fn() }, commitFeatureLayout: vi.fn() };
  h.host = document.createElement('div'); document.body.append(h.host);
  const render = () => { h.host.innerHTML = h.editor.render(); h.editor.updatePreviews(h.host); };
  h.editor = new DashboardBackupEditor(h.card, render); editors.push(h.editor); h.editor.setActive(true); h.render = render; render();
  h.field = (id) => h.host.querySelector(`[data-field="dashboard-backup-${id}"]`); h.button = (id) => h.host.querySelector(`[data-act="dashboard-backup-${id}"]`);
  h.host.addEventListener('click', (e) => { const button = e.target.closest('button'); if (button) h.editor.click(button); });
  h.host.addEventListener('input', (e) => h.editor.change(e.target)); h.host.addEventListener('change', (e) => h.editor.change(e.target));
  h.change = (id, value) => { const field = h.field(id); if (field.type === 'checkbox') field.checked = value; else field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); };
  h.chooseFile = () => { const field = h.field('file'); Object.defineProperty(field, 'files', { configurable: true, value: [new File(['PK simulated'], 'actual-backup.zip', { type: 'application/zip' })] }); field.dispatchEvent(new Event('change', { bubbles: true })); };
  return h;
}
async function inspected(h) { h.chooseFile(); await h.editor.inspectBackup(); expect(h.editor.inspection, h.editor.message).not.toBeNull(); }
async function prepared(h) { await inspected(h); h.change('namespace', 'new-house'); h.change('reviewed', true); await h.editor.prepareCopy(); expect(h.editor.stageToken).not.toBeNull(); }
afterEach(() => { editors.splice(0).forEach((e) => e.dispose()); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

describe('full dashboard UI scope and static inspection', () => {
  it('separates complete archive verification from current missing entity, area and floor links without rewriting the preview', async () => {
    const h = setup(); h.card._hass.states = {}; h.card._hass.entities = {}; h.card._hass.areas = {}; h.card._hass.floors = {};
    h.inspection.preview.layouts.house.layout = { version: 1, room_actions: { version: 1, rooms: [{ room_id: 'saved-room',
      actions: [{ id: 'evening', entity: 'scene.removed' }] }] }, rooms: [{ id: 'saved-room', area_id: 'removed-area', floor_id: 'removed-floor' }] };
    const raw = copy(h.inspection); await inspected(h);
    const report = h.host.querySelector('[data-dashboard-backup-environment]'); expect(report).toBeTruthy();
    expect(report.textContent).toContain('scene.removed'); expect(report.textContent).toContain('removed-area'); expect(report.textContent).toContain('removed-floor');
    expect(report.textContent).toContain('not inspected'); expect(h.host.textContent).toContain('Archive references are complete.');
    expect(h.editor.inspection).toEqual(raw); h.change('namespace', 'new-house'); expect(h.button('prepare').disabled).toBe(true);
    h.change('reviewed', true); expect(h.button('prepare').disabled).toBe(false); expect(h.editor.partial).toBe(false);
    expect(h.field('reviewed').closest('label').textContent).toContain('current Home Assistant');
    expect(h.card._hass.callService).not.toHaveBeenCalled(); expect(h.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('updates current registry warnings and language in place without clearing native focus, ZIP ownership, consent or namespace', async () => {
    const h = setup(); h.card._hass.states = {}; h.card._hass.entities = {}; h.card._hass.areas = {}; h.card._hass.floors = {};
    h.inspection.preview.dashboard.views[0].cards[0].house_summary = { weather_entity: 'weather.new_source2' };
    await inspected(h); h.change('namespace', 'new-house'); h.change('reviewed', true);
    const token = h.editor.inspectToken, graph = h.editor._referenceGraph, input = h.field('namespace'), save = h.button('prepare'); input.focus();
    const report = h.host.querySelector('[data-dashboard-backup-environment]'); expect(report).toBeTruthy();
    const summary = report.querySelector('summary'); summary.focus();
    h.card._hass.states['weather.new_source2'] = { state: 'unavailable', attributes: {} };
    h.card._hass.entities['weather.new_source2'] = { hidden: true }; h.card._hass.language = 'de';
    h.editor.revalidate(); h.editor.updatePreviews(h.host);
    expect(h.host.querySelector('[data-dashboard-backup-environment]')).toBe(report); expect(report.querySelector('summary')).toBe(summary);
    expect(document.activeElement).toBe(summary); expect(h.field('namespace')).toBe(input); expect(input.value).toBe('new-house'); expect(h.button('prepare')).toBe(save);
    expect(h.editor.inspectToken).toBe(token); expect(h.editor.reviewed).toBe(true); expect(h.editor.partial).toBe(false);
    expect(h.editor._referenceGraph).toBe(graph);
    expect(report.textContent).toContain('weather.new_source2'); expect(report.textContent).toContain('nicht geprüft');
    expect(h.editor.environmentReport.references.find((r) => r.id === 'weather.new_source2')).toMatchObject({ status: 'present', reading: 'unavailable', hidden: true });
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.ws).not.toHaveBeenCalled(); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('clears multiple not-loaded registry disclosures in the stable report when dictionaries arrive in place', async () => {
    const h = setup(); h.inspection.preview.layouts.house.layout = { version: 1, rooms: [{ area_id: 'area', floor_id: 'floor' }] };
    h.inspection.preview.dashboard.views[0].cards[0].house_summary = { weather_entity: 'weather.actual' };
    await inspected(h); const report = h.host.querySelector('[data-dashboard-backup-environment]'), graph = h.editor._referenceGraph;
    expect(report.querySelector('[data-reference-omissions]').textContent).toContain('/current/states');
    expect(report.querySelector('[data-reference-omissions]').textContent).toContain('/current/areas');
    Object.assign(h.card._hass, { states: { 'weather.actual': { state: 'sunny' } }, entities: {}, areas: { area: {} }, floors: { floor: {} } });
    h.editor.revalidate();
    expect(h.editor._referenceGraph).toBe(graph); expect(report.querySelector('[data-reference-omissions]').textContent).not.toContain('/current/');
    expect(h.editor.environmentReport.counts.missing).toBe(0); expect(h.editor.environmentReport.references.every((r) => r.status === 'present')).toBe(true);
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.ws).not.toHaveBeenCalled();
  });
  it('opens without any request/action and distinguishes whole ZIP from single-layout JSON', () => {
    const h = setup(); expect(h.host.textContent).toContain('Full dashboard backup'); expect(h.field('dashboard').value).toBe('default');
    expect(h.ws).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled(); expect(h.button('prepare').disabled).toBe(true); expect(h.button('create').disabled).toBe(true);
    expect(h.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('uses official exact list options, not window route, and reads complete foreign cards statically', async () => {
    const h = setup(); await h.editor.listDashboards(); h.change('dashboard', 'path:dashboard-exact'); await h.editor.readDashboard();
    expect(h.ws.mock.calls.find(([m]) => m.type === 'lovelace/config')[0]).toEqual({ type: 'lovelace/config', url_path: 'dashboard-exact', force: true });
    expect(h.host.querySelector('[data-dashboard-backup-config]').textContent).toContain('custom:foreign-card'); expect(h.host.querySelector('script')).toBeNull();
    expect(h.host.querySelector('foreign-card')).toBeNull(); expect(h.fetch).not.toHaveBeenCalled(); expect(h.card._layout).toEqual({ untouched: true });
  });
  it('exports by freshly re-reading whole dashboard and server-derived assets; inspection does not stage or create', async () => {
    const h = setup(); await h.editor.readDashboard(); h.dashboard.extra = 'latest whole source'; await h.editor.exportBackup();
    expect(h.exports[0].dashboard.extra).toBe('latest whole source'); expect(h.exports[0].shared_keys).toEqual(['house']);
    expect(h.editor.blob.size).toBe(4); expect(h.button('download').disabled).toBe(false); expect(h.fetch.mock.calls.map(([route]) => route)).toEqual([
      '/api/taylors3d/dashboard_backup/export', '/api/taylors3d/dashboard_backup/inspect']);
    expect(h.creates).toEqual([]); expect(h.saved).toEqual([]); expect(h.host.textContent).toContain('declared external resource'); expect(h.editor.reviewed).toBe(false);
  });
  it('permits active nonadministrator export, but no inspect/stage/publish or restore consent controls', async () => {
    const h = setup({ admin: false }); await h.editor.exportBackup(); expect(h.exports).toHaveLength(1); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.button('inspect').disabled).toBe(true); expect(h.field('namespace').disabled).toBe(true); expect(h.button('prepare').disabled).toBe(true);
    expect(await h.editor.prepareCopy()).toBe(false); expect(await h.editor.createDashboard()).toBe(false); expect(h.creates).toEqual([]);
  });
  it('requires explicit fallback scope and preserves actual original browser JSON instead of card._layout normalization', async () => {
    const h = setup(), raw = '{ "rooms": null, "model": {"unknown":true}, "raw_extra":9 }'; localStorage.setItem('taylors3d_house', raw); localStorage.setItem('unrelated-app', 'secret');
    h.change('browser', true); await h.editor.exportBackup(); expect(h.exports[0].layouts.house).toMatchObject({ backend: 'browser', layout_json: raw });
    expect(h.exports[0].shared_keys).toEqual([]); expect(h.host.textContent).toContain('browser'); expect(h.card._layout).toEqual({ untouched: true });
  });
  it('file selection clears old static source data until that file is inspected', async () => {
    const h = setup(); await h.editor.readDashboard(); expect(h.editor.collection).not.toBeNull(); h.chooseFile();
    expect(h.editor.collection).toBeNull(); expect(h.host.querySelector('[data-dashboard-backup-config]')).toBeNull(); await h.editor.inspectBackup();
    expect(h.editor.inspection.preview.dashboard).toEqual(h.inspection.preview.dashboard);
  });
  it('keeps native typed fields/summary focus and inspection data across unrelated real HA reading updates', async () => {
    const h = setup(); await inspected(h); h.change('namespace', 'new-house'); const input = h.field('namespace'); input.focus();
    h.card._hass = { ...h.card._hass, states: { 'sensor.actual': { state: 'changed' } } }; h.editor.onStates();
    expect(h.field('namespace')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('new-house'); expect(h.editor.inspection).not.toBeNull();
    const summary = h.host.querySelector('summary'); summary.focus(); h.editor.onStates(); expect(h.host.querySelector('summary')).toBe(summary); expect(document.activeElement).toBe(summary);
  });
});

describe('review, preparation and publication stay separate deliberate actions', () => {
  it('creates nothing before review; prepares once without publication; then saves exact raw config only on Create', async () => {
    const h = setup(); await inspected(h); h.change('namespace', 'new-house'); expect(await h.editor.prepareCopy()).toBe(false);
    h.change('reviewed', true); await h.editor.prepareCopy(); expect(h.fetch.mock.calls.filter(([route]) => route.includes('/stage/'))).toHaveLength(1);
    expect(h.creates).toEqual([]); expect(h.host.textContent).toContain('scheduled'); expect(h.host.querySelector('[data-dashboard-backup-created]')).toBeNull();
    await h.editor.createDashboard(); expect(h.creates).toHaveLength(1); expect(h.saved).toEqual([{ type: 'lovelace/config/save', url_path: path, config: h.staging.save_message.config }]);
    expect(h.host.querySelector('[data-dashboard-backup-created]').getAttribute('href')).toBe('/' + path); expect(await h.editor.createDashboard()).toBe(false);
    expect(h.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('namespace/review changes revoke the held prepared copy and require fresh preparation', async () => {
    const h = setup(); await prepared(h); h.change('namespace', 'different'); expect(h.editor.stageToken).toBeNull(); expect(h.button('create').disabled).toBe(true);
    expect(await h.editor.createDashboard()).toBe(false); expect(h.creates).toEqual([]);
  });
  it('incomplete download needs visible acknowledgment; missing layout remains a preparation blocker even after acknowledgment', async () => {
    const h = setup(); h.partial = true; h.inspection.manifest.complete = false; h.inspection.report.complete = false;
    h.inspection.report.diagnostics.push({ code: 'layout_missing', path: '/views/0/cards/0', severity: 'missing', message: 'The referenced layout snapshot was not supplied.' });
    await h.editor.exportBackup(); expect(h.button('download').disabled).toBe(true); h.change('partial', true); expect(h.button('download').disabled).toBe(false);
    h.change('namespace', 'new-house'); h.change('reviewed', true); expect(h.button('prepare').disabled).toBe(true); expect(await h.editor.prepareCopy()).toBe(false);
    expect(h.host.textContent).toContain('cannot bypass this blocker'); expect(h.fetch.mock.calls.some(([route]) => route.includes('/stage/'))).toBe(false);
  });
  it('safe stage orphans and failed publication remain explicit; no automatic retry/delete/resource installation', async () => {
    const h = setup(); await prepared(h); const original = h.ws.getMockImplementation(); h.ws.mockImplementation((m) => m.type === 'lovelace/config/save' ? Promise.reject({ code: 'error', message: 'do not echo private error' }) : original(m));
    await h.editor.createDashboard(); expect(h.editor.publication).toMatchObject({ ok: false, publication: { creation: 'acknowledged', save: 'sent_unknown' } });
    expect(h.host.textContent).toContain('requiring review'); expect(h.host.querySelector('[data-dashboard-backup-created]')).not.toBeNull();
    expect(h.host.textContent).not.toContain('do not echo'); expect(h.ws.mock.calls.some(([m]) => m.type.includes('delete') || m.type.includes('resources/create'))).toBe(false);
    h.change('namespace', 'another-copy'); expect(h.host.textContent).toContain('requiring review'); expect(h.host.querySelector('[data-dashboard-backup-created]').getAttribute('href')).toBe('/' + path);
    expect(await h.editor.createDashboard()).toBe(false);
  });
  it('does not offer a target link after ambiguous create without valid created ID evidence', async () => {
    const h = setup(); await prepared(h); const original = h.ws.getMockImplementation(); h.ws.mockImplementation((m) => m.type === 'lovelace/dashboards/create' ? Promise.reject(new Error('unknown')) : original(m));
    await h.editor.createDashboard(); expect(h.editor.publication.publication.creation).toBe('sent_unknown'); expect(h.host.querySelector('[data-dashboard-backup-created]')).toBeNull();
  });
});

describe('actual native intent and lifecycle fences', () => {
  it('inactive Data observes source/account changes and cancels a late stage without redrawing another editor', async () => {
    const h = setup(); await inspected(h); h.change('namespace', 'new-house'); h.change('reviewed', true);
    const slow = deferred(), original = h.fetch.getMockImplementation();
    h.fetch.mockImplementation((route, options) => route.includes('/stage/') ? slow.promise : original(route, options));
    const pending = h.editor.prepareCopy(); await tick();
    expect(h.fetch.mock.calls.some(([route]) => route.includes('/stage/'))).toBe(true);
    const oldCreate = h.button('create'), redraw = vi.fn(); h.editor.onRender = redraw;
    h.editor.setActive(false); h.card._edit.tab = 'scenes';
    h.card._view.model.root = { uuid: 'other-root' }; h.editor.onStates();
    h.card._hass.user.is_active = false; h.editor.onStates();
    h.card._hass.user.is_active = true; h.editor.onStates();
    slow.resolve(jsonResponse(h.staging)); await pending; h.editor.click(oldCreate);
    expect(redraw).not.toHaveBeenCalled(); expect(h.editor.inspection).toBeNull(); expect(h.editor.stageToken).toBeNull();
    expect(h.creates).toEqual([]); expect(h.saved).toEqual([]); expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.editor.message).toContain('Copying may already have started');
    h.card._edit.tab = 'data'; h.editor.setActive(true); h.render();
    expect(h.field('namespace').value).toBe(''); expect(h.field('reviewed').checked).toBe(false);
    expect(h.button('create').disabled).toBe(true); expect(h.fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['pointer', 'Space', 'Enter'])('observed account loss/recovery poisons held %s export until a fresh gesture', async (gesture) => {
    const h = setup(); h.editor.onRender = () => h.editor.updatePreviews(h.host); const button = h.button('export');
    if (gesture === 'pointer') button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); else button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: gesture === 'Space' ? ' ' : 'Enter' }));
    h.card._hass.user.is_active = false; h.editor.onStates(); h.card._hass.user.is_active = true; h.editor.onStates();
    if (gesture === 'pointer') button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); else button.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: gesture === 'Space' ? ' ' : 'Enter' }));
    button.click(); await tick(); expect(h.exports).toHaveLength(0);
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); button.click();
    for (let i = 0; i < 30 && !h.exports.length; i++) await tick(); expect(h.exports).toHaveLength(1);
  });
  it('detached/replaced buttons cannot act, and repeated held Enter cannot repeat an export', async () => {
    const h = setup(), old = h.button('export'); h.render(); h.editor.click(old); await tick(); expect(h.exports).toHaveLength(0);
    const button = h.button('export'); button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })); button.click();
    for (let i = 0; i < 30 && h.editor.busy; i++) await tick();
    button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', repeat: true })); h.editor.click(button); await tick(); expect(h.exports).toHaveLength(1);
  });
  it.each(['tab', 'layout', 'model', 'session'])('actual %s ownership changes during async stage cannot publish a late token', async (kind) => {
    const h = setup(); await inspected(h); h.change('namespace', 'new-house'); h.change('reviewed', true); const slow = deferred(), original = h.fetch.getMockImplementation();
    h.fetch.mockImplementation((route, options) => route.includes('/stage/') ? slow.promise : original(route, options)); const pending = h.editor.prepareCopy(); await tick();
    if (kind === 'tab') h.card._edit.tab = 'rooms'; else if (kind === 'layout') h.card._config.layout_key = 'other'; else if (kind === 'model') h.card._view.model.root = { uuid: 'new-root' }; else h.card._hass.user = { ...h.card._hass.user };
    // Do not call onStates first: clients still fence ownership through getHass.
    slow.resolve(jsonResponse(h.staging)); await pending; h.editor.onStates(); expect(h.editor.stageToken).toBeNull(); expect(h.creates).toEqual([]); expect(h.editor.inspection).toBeNull();
    expect(h.editor.message).toContain('Copying may already have started');
  });
  it('tab departure/reset clears private preview, cancels requests and preserves original live layout', async () => {
    const h = setup(); await prepared(h); const before = copy(h.card._layout); h.editor.setActive(false); expect(h.editor.stageToken).toBeNull(); expect(h.editor.inspection).toBeNull();
    expect(await h.editor.createDashboard()).toBe(false); h.editor.setActive(true); expect(h.editor.namespace).toBe(''); expect(h.card._layout).toEqual(before);
  });
  it('download uses a real ZIP Blob and fixed filename, then revokes URLs on reset/dispose', async () => {
    const h = setup(); await h.editor.exportBackup(); const create = vi.fn(() => 'blob:owned-zip'), revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { expect(this.download).toBe('taylors3d-dashboard-backup.zip'); expect(this.href).toBe('blob:owned-zip'); });
    expect(h.editor.downloadZip()).toBe(true); expect(create).toHaveBeenCalledWith(h.editor.blob); expect(click).toHaveBeenCalledOnce(); h.editor.reset(); expect(revoke).toHaveBeenCalledWith('blob:owned-zip'); vi.unstubAllGlobals();
  });
  it.each(['loading', 'missing layout', 'inactive', 'wrong tab'])('does not begin any request in %s context', async (kind) => {
    const h = setup(); if (kind === 'loading') h.card._loading = true; else if (kind === 'missing layout') h.card._layout = null;
    else if (kind === 'inactive') h.card._hass.user.is_active = false; else h.card._edit.tab = 'rooms';
    h.editor.onStates(); expect(await h.editor.exportBackup()).toBe(false); expect(await h.editor.inspectBackup()).toBe(false); expect(h.ws).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('pointer cancellation permanently rejects delayed release/click, while a fresh action still works', async () => {
    const h = setup(), button = h.button('export'); button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    button.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true, button: 0 })); button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); button.click(); await tick(); expect(h.exports).toHaveLength(0);
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); button.click();
    for (let i = 0; i < 30 && !h.exports.length; i++) await tick(); expect(h.exports).toHaveLength(1);
  });
});
