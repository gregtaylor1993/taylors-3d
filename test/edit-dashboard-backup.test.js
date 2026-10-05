// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';
import '../src/taylors3d-card.js';

// Actual EditMode + actual backup/restore clients. Only HA replies and the
// existing renderer are fixtures; these tests do not prove live middleware.
const editors = [], copy = (v) => structuredClone(v);
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const streamed = (bytes, options) => new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), options);
const json = (value) => streamed(new Uint8Array(new TextEncoder().encode(JSON.stringify(value))), { headers: { 'content-type': 'application/json' } });
const hash = 'a'.repeat(64), newKey = 'restore_copy_' + 'f'.repeat(51), newPath = 'taylors3d-restore-copy';
function inspected(dashboard) {
  return { manifest: { format: 'taylors3d-dashboard-backup', version: 1, complete: true,
    cards: [{ pointer: '/views/0/cards/0', layout_key: 'home' }], layouts: [{ key: 'home' }], models: [], furniture: [], resources: { mode: 'storage', items: [] } },
    report: { complete: true, diagnostics: [], counts: { cards: 1, layouts: 1, models: 0, furniture_packs: 0, members: 3 },
      expanded_bytes: 300, nested_expanded_bytes: 0, verified_expanded_bytes: 300 },
    preview: { dashboard, layouts: { home: { backend: 'shared', metadata: {}, layout: { version: 1, extension: 'raw' } } } }, restoreAvailable: false };
}
function staged(dashboard) {
  const config = copy(dashboard); config.views[0].cards[0].layout_key = newKey;
  return { ok: true, namespace: 'copy', restore_id: 'b'.repeat(32), target_dashboard: { url_path: newPath, mode: 'storage', title: 'Simulated copy' },
    save_message: { id: 1, type: 'lovelace/config/save', url_path: newPath, config }, resources: { mode: 'storage', items: [] },
    report: { valid: true, complete: true, archive_complete: true, allow_incomplete: false, publication_available: false, resources_installed: false,
      requires_current_admin_at_publication: true, requires_shared_integration: true, diagnostics: [], collision_checked: { internal: true, external: false },
      counts: { cards: 1, layouts: 1, models: 0, furniture_packs: 0 }, collision_targets: { dashboard_url_path: newPath,
        layout_keys: [newKey], model_keys: [], legacy_fallback_keys: ['taylors3d_' + newKey] } },
    staging: { models: [], layouts: [{ target_key: newKey, original_sha256: hash, staged_json_sha256: hash, persistence: 'scheduled_not_durable' }],
      furniture: [], unavailable: [], integrity_verified: true, integrity_scope: 'present_assets_and_populated_shared_layouts',
      layouts_persistence: 'scheduled_not_durable', dashboard_created: false, resources_installed: false,
      collision_evidence: { dashboard: 'absent_at_check', user_fallbacks: 'all_current_users_absent_at_check',
        browser: 'not_read;unchanged_and_shadowed_by_populated_shared_layouts', transaction: false } }, orphans: [] };
}
function setup({ admin = true } = {}) {
  const h = { dashboard: { views: [{ title: 'Simulated source', cards: [{ type: 'custom:taylors3d-card', layout_key: 'home' },
    { type: 'custom:other-card', content: '<script>not instantiated</script>', unknown: [1, 2] }] }], extra: 'whole dashboard' }, list: [], exports: [], creates: [], saves: [] };
  h.inspection = inspected(copy(h.dashboard)); h.staging = staged(copy(h.dashboard));
  h.ws = vi.fn(async (message) => {
    if (message.type === 'lovelace/dashboards/list') return h.list;
    if (message.type === 'lovelace/config') { if (message.url_path === newPath) throw { code: 'config_not_found' }; return h.dashboard; }
    if (message.type === 'lovelace/resources') return [];
    if (message.type === 'lovelace/info') return { resource_mode: 'storage' };
    if (message.type === 'lovelace/dashboards/create') { const row = { ...message, id: 'created-id' }; delete row.type;
      h.list.push(row); h.creates.push(copy(message)); return row; }
    if (message.type === 'lovelace/config/save') { h.saves.push(copy(message)); return null; }
    throw { code: 'unknown_command' };
  });
  h.fetch = vi.fn(async (route, options) => {
    if (route.endsWith('/export')) { h.exports.push(JSON.parse(options.body)); return streamed(new Uint8Array([80, 75, 3, 4]),
      { headers: { 'content-type': 'application/zip', 'content-length': '4', 'x-taylors3d-complete': 'true' } }); }
    if (route.endsWith('/inspect')) return json(h.inspection);
    if (route.includes('/stage/')) return json(h.staging);
    throw new Error('Unexpected HTTP request');
  });
  const floors = [{ id: 'ground', name: 'Ground', elevation: 0 }];
  h.card = { ownerDocument: document, isConnected: true, _editing: true, _loading: false,
    _config: { layout_key: 'home' }, _layout: { rooms: [], pins: {}, unknown: 'unchanged' }, _built: {}, _floor: 'ground', _mode: 'top',
    _floors: floors, _roomList: [], _markers: [], _positions: new Map(), _stage: document.createElement('div'),
    _store: { backend: 'shared' }, _history: new EditHistory(), _applyMarkerSelection: vi.fn(), modelBindings: () => null,
    _hass: { user: { id: 'current', is_active: true, is_admin: admin }, connection: Object.assign(new EventTarget(), { connected: true, options: { auth: {} } }),
      auth: {}, callWS: h.ws, fetchWithAuth: h.fetch, callService: vi.fn(), states: {}, entities: {}, devices: {}, areas: {}, floors: {} },
    _view: { model: null, floorElevation: (id) => floors.find((f) => f.id === id)?.elevation, setOverlay: vi.fn(), setPivotMarker: vi.fn(),
      setStems: vi.fn(), setControlsEnabled: vi.fn(), highlightModelNode: vi.fn(), planPoint: vi.fn(() => [1, 1]), pixelsPerMetre: () => 10 } };
  const edit = new EditMode(h.card); h.card._edit = edit; editors.push(edit); h.edit = edit;
  h.card._commit = vi.fn((value) => { h.card._layout = value; }); h.card.commitFeatureLayout = vi.fn();
  h.card._history.reset({ layout: h.card._layout, config: h.card._config });
  edit.render(); h.card._stage.append(edit.panel); document.body.append(h.card._stage); edit.attach();
  h.button = (action, suffix = '') => edit.panel.querySelector(`[data-act="${action}"]${suffix}`);
  h.click = (action, suffix = '') => { const button = h.button(action, suffix); expect(button).toBeTruthy(); button.click(); return button; };
  h.data = () => h.click('tab', '[data-id="data"]'); h.field = (name) => edit.panel.querySelector(`[data-field="dashboard-backup-${name}"]`);
  h.change = (name, value) => { const field = h.field(name); field.focus(); if (field.type === 'checkbox') field.checked = value; else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true })); return field; };
  h.choose = () => { const field = h.field('file'); Object.defineProperty(field, 'files', { configurable: true,
    value: [new File(['simulated PK'], 'simulated-backup.zip', { type: 'application/zip' })] }); field.dispatchEvent(new Event('change', { bubbles: true })); return field; };
  return h;
}
async function prepare(h) { h.data(); h.choose(); await h.edit._dashboardBackupEditor.inspectBackup(); h.change('namespace', 'copy'); h.change('reviewed', true);
  await h.edit._dashboardBackupEditor.prepareCopy(); expect(h.edit._dashboardBackupEditor.stageToken, h.edit._dashboardBackupEditor.message).not.toBeNull(); }
function rootSetter(h, next) {
  // Invoke the real producer setter; stub unrelated 3D/security scheduling.
  for (const name of ['_observeSecuritySession', '_observeAlertMapContext', '_syncSecurity', '_syncFurniture', '_syncHouseShell', '_syncScenePreviews', '_syncAmbient', '_schedule']) h.card[name] = vi.fn();
  h.card._houseLayoutEnabled = () => false; h.card._presetEvents = { setHass: vi.fn() };
  const type = customElements.get('taylors3d-card'); Object.getOwnPropertyDescriptor(type.prototype, 'hass').set.call(h.card, next);
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

describe('full dashboard backup in actual EditMode Data', () => {
  it('adds full backup beside explicitly single-layout JSON without a request, service or commit on entry', () => {
    const h = setup(); expect(h.edit._dashboardBackupEditor).toBeDefined(); expect(h.edit._dashboardBackupEditor.active).toBe(false); h.data();
    expect(h.edit.panel.textContent).toContain('Single-layout JSON'); expect(h.edit.panel.textContent).toContain('Full dashboard backup');
    expect(h.button('export')).not.toBeNull(); expect(h.edit.panel.querySelector('[data-field="import"]')).not.toBeNull();
    expect(h.ws).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled(); expect(h.card._commit).not.toHaveBeenCalled();
    expect(h.card._hass.callService).not.toHaveBeenCalled(); expect(h.edit._dashboardBackupEditor.active).toBe(true);
  });
  it('routes native Read and Export to whole raw dashboard while single-layout controls keep their own action', async () => {
    const h = setup(); h.data(); h.click('dashboard-backup-read'); await tick();
    expect(h.edit.panel.querySelector('[data-dashboard-backup-config]').textContent).toContain('custom:other-card');
    expect(h.edit.panel.querySelector('script')).toBeNull(); h.click('dashboard-backup-export'); await tick();
    expect(h.exports[0].dashboard).toEqual(h.dashboard); expect(h.exports[0].shared_keys).toEqual(['home']);
    expect(h.fetch.mock.calls.map(([route]) => route)).toEqual(['/api/taylors3d/dashboard_backup/export', '/api/taylors3d/dashboard_backup/inspect']);
    expect(h.card._layout.unknown).toBe('unchanged'); expect(h.card._commit).not.toHaveBeenCalled(); expect(h.creates).toEqual([]);
  });
  it('still displays single-layout JSON import errors while keeping a backup draft and file connected', () => {
    const h = setup(); h.data(); const file = h.choose(), input = h.change('namespace', 'typed');
    h.edit._import('{ invalid json');
    expect(h.edit.panel.querySelector('.msg.error')).not.toBeNull(); expect(h.field('namespace')).toBe(input);
    expect(input.value).toBe('typed'); expect(h.field('file')).toBe(file); expect(h.card._commit).not.toHaveBeenCalled();
  });
  it('keeps actual file input, typed namespace, static summary and held action nodes through in-place Data redraws', async () => {
    const h = setup(); h.data(); const file = h.choose(); await h.edit._dashboardBackupEditor.inspectBackup();
    const input = h.change('namespace', 'still-typing'); const exportButton = h.button('dashboard-backup-export');
    h.card._hass = { ...h.card._hass, states: { 'sensor.actual': { state: 'new' } } }; h.edit.onStates(); h.edit.afterUpdate(); h.edit.render(); h.edit.onViewChanged();
    expect(h.field('namespace')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('still-typing');
    expect(h.field('file')).toBe(file); expect(file.files[0].name).toBe('simulated-backup.zip'); expect(h.button('dashboard-backup-export')).toBe(exportButton);
    const summary = h.edit.panel.querySelector('[data-dashboard-backup-static] summary'); summary.focus(); h.edit.afterUpdate();
    expect(document.activeElement).toBe(summary); expect(h.edit._dashboardBackupEditor.inspection).not.toBeNull();
  });
  it('refreshes exact official dashboard choices inside the retained native select without replacing it', async () => {
    const h = setup(); h.data(); const select = h.field('dashboard'); select.focus();
    h.list = [{ id: 'source-id', url_path: 'dashboard-exact', mode: 'storage', title: 'Actual source option' }];
    await h.edit._dashboardBackupEditor.listDashboards();
    expect(h.field('dashboard')).toBe(select); expect(document.activeElement).toBe(select);
    expect([...select.options].map((option) => option.value)).toEqual(['default', 'path:dashboard-exact']);
    h.change('dashboard', 'path:dashboard-exact'); h.click('dashboard-backup-read'); await tick();
    expect(h.ws.mock.calls.find(([message]) => message.type === 'lovelace/config')[0].url_path).toBe('dashboard-exact');
  });
  it('retains a removed selected dashboard with an honest warning, blocks reading it and still permits official refresh', async () => {
    const h = setup(); h.data(); h.list = [{ id: 'source-id', url_path: 'dashboard-exact', mode: 'storage', title: 'Actual source' }];
    await h.edit._dashboardBackupEditor.listDashboards(); h.change('dashboard', 'path:dashboard-exact');
    const select = h.field('dashboard'); h.list = []; await h.edit._dashboardBackupEditor.listDashboards();
    expect(select.value).toBe('path:dashboard-exact'); expect(select.selectedOptions[0].textContent).toContain('Unavailable selected dashboard');
    expect(select.selectedOptions[0].disabled).toBe(true); expect(h.button('dashboard-backup-read').disabled).toBe(true);
    expect(h.button('dashboard-backup-export').disabled).toBe(true); expect(h.button('dashboard-backup-list').disabled).toBe(false);
    expect(h.edit._dashboardBackupEditor.selectedPath).toBe('dashboard-exact'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('Cancel clears native scope/review/name values and snapshot fields in place without leaving stale visible intent', async () => {
    const h = setup(); h.data(); h.choose(); await h.edit._dashboardBackupEditor.inspectBackup();
    const input = h.change('namespace', 'copy'); h.change('reviewed', true); h.change('partial', true); h.change('browser', true);
    h.click('dashboard-backup-cancel'); expect(h.field('namespace')).toBe(input); expect(input.value).toBe('');
    for (const name of ['reviewed', 'partial', 'browser', 'user']) expect(h.field(name).checked).toBe(false);
    expect(h.edit._dashboardBackupEditor.file).toBeNull(); expect(h.edit._dashboardBackupEditor.inspection).toBeNull();
    expect(h.button('dashboard-backup-create').disabled).toBe(true); expect(h.ws.mock.calls.some(([m]) => m.type.includes('create'))).toBe(false);
  });
  it('an unchanged actual HA push and Data redraw keep a held deliberate action valid exactly once', async () => {
    const h = setup(); h.data(); const button = h.button('dashboard-backup-export'); button.focus();
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    rootSetter(h, { ...h.card._hass, states: { 'sensor.actual': { state: 'new' } } }); h.edit.afterUpdate(); h.edit.render();
    expect(h.button('dashboard-backup-export')).toBe(button); expect(document.activeElement).toBe(button);
    button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); button.click(); await tick();
    expect(h.exports).toHaveLength(1); expect(h.creates).toEqual([]); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('routes review/prepare/create as separate native actions with no layout history or device commands', async () => {
    const h = setup(); await prepare(h); expect(h.creates).toEqual([]); expect(h.saves).toEqual([]);
    h.click('dashboard-backup-create'); await tick(); expect(h.creates).toHaveLength(1);
    expect(h.saves).toEqual([{ type: 'lovelace/config/save', url_path: newPath, config: h.staging.save_message.config }]);
    expect(h.edit.panel.querySelector('[data-dashboard-backup-created]').getAttribute('href')).toBe('/' + newPath);
    expect(h.card._commit).not.toHaveBeenCalled(); expect(h.card._history.size).toBe(0); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps reader export available while disabling administrator restore on current role loss', async () => {
    const h = setup(); h.data(); const input = h.field('namespace'); input.focus();
    rootSetter(h, { ...h.card._hass, user: { ...h.card._hass.user, is_admin: false } });
    expect(h.field('namespace')).toBe(input); expect(input.disabled).toBe(true); expect(h.button('dashboard-backup-export').disabled).toBe(false);
    h.click('dashboard-backup-export'); await tick(); expect(h.exports).toHaveLength(1); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.button('dashboard-backup-inspect').disabled).toBe(true); expect(h.creates).toEqual([]);
  });
  it.each(['pointer', 'Space', 'Enter'])('real setter observed disconnect/recovery poisons held %s while keeping same native nodes', async (gesture) => {
    const h = setup(); h.data(); const button = h.button('dashboard-backup-export');
    if (gesture === 'pointer') button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    else button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: gesture === 'Space' ? ' ' : 'Enter' }));
    h.card._hass.connection.connected = false; rootSetter(h, h.card._hass); expect(button.disabled).toBe(true);
    h.card._hass.connection.connected = true; rootSetter(h, h.card._hass); expect(button.disabled).toBe(false);
    expect(h.button('dashboard-backup-export')).toBe(button);
    if (gesture === 'pointer') button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    else button.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: gesture === 'Space' ? ' ' : 'Enter' }));
    button.click(); await tick(); expect(h.exports).toEqual([]);
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    button.click(); await tick(); expect(h.exports).toHaveLength(1);
  });
  it('leaving Data cancels a pending actual stage, keeps uncertainty and requires a fresh inspected copy on return', async () => {
    const h = setup(); h.data(); h.choose(); await h.edit._dashboardBackupEditor.inspectBackup(); h.change('namespace', 'copy'); h.change('reviewed', true);
    const slow = deferred(), original = h.fetch.getMockImplementation(); h.fetch.mockImplementation((route, opts) => route.includes('/stage/') ? slow.promise : original(route, opts));
    const pending = h.edit._dashboardBackupEditor.prepareCopy(); await tick(); h.click('tab', '[data-id="rooms"]');
    slow.resolve(json(h.staging)); await pending; h.data(); expect(h.edit._dashboardBackupEditor.stageToken).toBeNull();
    expect(h.button('dashboard-backup-create').disabled).toBe(true); expect(h.edit._dashboardBackupEditor.namespace).toBe(''); expect(h.creates).toEqual([]);
  });
  it.each(['source', 'layout', 'model'])('invalidates an inspected copy on actual %s change without triggering new reads', async (kind) => {
    const h = setup(); await prepare(h); const before = h.ws.mock.calls.length;
    if (kind === 'source') h.card._config = { ...h.card._config, layout_key: 'different' };
    else if (kind === 'layout') h.card._layout = { ...h.card._layout, extension: 'new' };
    else h.card._view.model = { root: {} };
    h.edit.afterUpdate(); expect(h.edit._dashboardBackupEditor.stageToken).toBeNull(); expect(h.edit._dashboardBackupEditor.inspection).toBeNull();
    expect(h.button('dashboard-backup-create').disabled).toBe(true); expect(h.ws).toHaveBeenCalledTimes(before); expect(h.creates).toEqual([]);
    expect(h.edit._dashboardBackupEditor.message).toContain('Copying may already have started');
  });
  it('direct real card history restoration cancels prepared publication before the restored layout becomes active', async () => {
    const h = setup(); await prepare(h); const editor = h.edit._dashboardBackupEditor, reset = vi.spyOn(editor, 'reset');
    for (const name of ['_suspendAmbient', 'finishWallSelectionPreparation', '_stopScenePreview']) h.card[name] = vi.fn();
    h.card.setConfig = (config) => { h.card._config = config; };
    const next = { ...h.card._layout, unrelated: 'restored' };
    customElements.get('taylors3d-card').prototype._restoreHistory.call(h.card, { layout: next, config: h.card._config });
    expect(reset).toHaveBeenCalledOnce(); expect(h.card._layout).toEqual(next); expect(editor.stageToken).toBeNull();
    expect(h.edit.panel.textContent).toContain('may remain in Home Assistant'); expect(h.creates).toEqual([]);
  });
  it('explicit real history reset clears a prepared copy even when the current layout reference is unchanged', async () => {
    const h = setup(); await prepare(h);
    customElements.get('taylors3d-card').prototype.resetHistory.call(h.card);
    expect(h.edit._dashboardBackupEditor.stageToken).toBeNull(); expect(h.edit._dashboardBackupEditor.inspection).toBeNull();
    expect(h.card._layout.unknown).toBe('unchanged'); expect(h.creates).toEqual([]);
  });
  it('real setConfig cancels an old backup before same-key card settings/model can replace its source', async () => {
    const h = setup(); await prepare(h); const editor = h.edit._dashboardBackupEditor;
    for (const name of ['_suspendAmbient', 'finishWallSelectionPreparation', '_syncScenePreviews', '_syncFurniture', '_applyZoomTo', '_setMode',
      '_loadModel', '_updateObjects', '_configureMiniMap', '_syncToolbar', '_schedule', '_recordHistory']) h.card[name] = vi.fn();
    h.card._view.setOcclusion = vi.fn(); h.card._devicePopup = { setPlacement: vi.fn() }; h.card._houseLayoutEnabled = () => false;
    h.card._body = document.createElement('div'); h.card._presetEvents = { setHass: vi.fn() };
    customElements.get('taylors3d-card').prototype.setConfig.call(h.card, { ...h.card._config, model: '/local/exact-new.glb' });
    expect(editor.stageToken).toBeNull(); expect(editor.inspection).toBeNull(); expect(h.creates).toEqual([]);
    expect(h.card._config.model).toBe('/local/exact-new.glb'); expect(h.card._layout.unknown).toBe('unchanged');
  });
  it('real card disconnect clears backup ownership even before a future recovered HA setter', async () => {
    const h = setup(); await prepare(h); h.card.isConnected = false;
    for (const name of ['_syncFurniture', '_suspendAmbient', 'finishWallSelectionPreparation', '_syncWallPresentation',
      '_unwatchAmbientPreference', '_stopScenePreview', '_clearTrackingTimer', '_refreshSecurityMotion', '_endGesture', '_setCameraTimer', '_setImageTimer']) h.card[name] = vi.fn();
    h.card._ambientPointers = new Set(); h.card._ambientKeys = new Set(); h.card._presetEvents = { disconnect: vi.fn() }; h.card._view.stop = vi.fn();
    customElements.get('taylors3d-card').prototype.disconnectedCallback.call(h.card);
    expect(h.edit._dashboardBackupEditor.active).toBe(false); expect(h.edit._dashboardBackupEditor.stageToken).toBeNull();
    h.card.isConnected = true; h.edit.attach(); h.edit.render(); expect(h.button('dashboard-backup-create').disabled).toBe(true);
    expect(h.creates).toEqual([]); expect(h.saves).toEqual([]);
  });
  it('cancels prepared state on history reset, detach/reattach and true disposal; never resurrects old controls', async () => {
    const h = setup(); await prepare(h); const editor = h.edit._dashboardBackupEditor, oldButton = h.button('dashboard-backup-create');
    h.edit.cancelHistoryGestures(); expect(editor.stageToken).toBeNull(); expect(editor.inspection).toBeNull();
    h.edit.detach(); expect(editor.active).toBe(false); expect(editor.disposed).toBe(false); h.edit.attach(); h.edit.render();
    expect(editor.active).toBe(true); editor.click(oldButton); expect(h.creates).toEqual([]);
    h.edit.dispose(); expect(editor.disposed).toBe(true); expect(await editor.exportBackup()).toBe(false);
  });
  it('Data entry ends old room/device tools, and real canvas/marker handlers cannot move or leave the backup screen', () => {
    const h = setup(); h.edit.drawing = { floorId: 'ground', points: [] }; h.edit.calibrating = { src: [1, 2] };
    h.edit.doorMode = h.edit.overlayMove = h.edit.colorPick = true; h.edit.selectedRoom = 'room'; h.edit.selectedMarker = 'device'; h.data();
    expect(h.edit.drawing).toBeNull(); expect(h.edit.calibrating).toBeNull(); expect(h.edit.selectedRoom).toBeNull(); expect(h.edit.selectedMarker).toBeNull();
    const event = { button: 0, clientX: 1, clientY: 1, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    h.edit.canvasDown(event); h.edit.canvasUp(event); h.edit.markerDown({ id: 'device' }, event); h.edit.selectRoom('room'); h.edit.selectMarker('device');
    expect(h.edit.tab).toBe('data'); expect(h.edit.drag).toBeNull(); expect(h.card._commit).not.toHaveBeenCalled();
  });
});
