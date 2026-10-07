// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EDITOR_GROUPS, editorTabs, editorGroupForTab, setupProgress } from '../src/editor-navigation.js';
import { EditHistory } from '../src/history.js';

const editors = [];
const turn = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const room = { id: 'lounge', area_id: 'lounge', floor_id: 'ground', polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] };
function setup({ empty = false, admin = true } = {}) {
  const floors = [{ id: 'ground', name: 'Ground', elevation: 0, height: 2.7 }], stage = document.createElement('div'); document.body.append(stage);
  const card = { isConnected: true, _editing: true, _loading: false, _config: { layout_key: 'setup', layout_style: 'house' },
    _layout: { version: 1, rooms: empty ? [] : [structuredClone(room)], pins: {}, future: { preserved: true } },
    _floors: floors, _floor: 'ground', _mode: 'top', _roomList: empty ? [] : [{ room, floorId: 'ground' }], _markers: [], _positions: new Map(), _bindings: new Map(),
    _hass: { user: { id: 'admin', is_admin: admin, is_active: true }, connection: { connected: true, options: { auth: {} } }, auth: {},
      states: {}, entities: {}, devices: {}, areas: { lounge: { area_id: 'lounge', name: 'Lounge', floor_id: 'ground' } },
      floors: { ground: { floor_id: 'ground', name: 'Ground', level: 0 } }, callService: vi.fn(), fetchWithAuth: vi.fn(), callWS: vi.fn() },
    _stage: stage, _store: { backend: 'shared' }, _history: new EditHistory(), _built: {}, _applyMarkerSelection: vi.fn(),
    _view: { model: null, floorElevation: () => 0, setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(),
      setControlsEnabled: vi.fn(), highlightModelNode: vi.fn(), pixelsPerMetre: () => 10 }, modelBindings: () => null,
    _syncCustomControls: vi.fn(), furnitureRefresh: vi.fn(), _endGesture: vi.fn() };
  const edit = new EditMode(card); card._edit = edit; editors.push(edit);
  card._commit = vi.fn((layout) => { card._layout = layout; card._roomList = (layout.rooms || []).map((entry) => ({ room: entry, floorId: entry.floor_id })); });
  card.commitFeatureLayout = vi.fn((patch) => { card._commit({ ...card._layout, ...patch }); edit.afterUpdate(); });
  card._history.reset({ layout: card._layout, config: card._config }); edit.render(); stage.append(edit.panel); edit.attach();
  const button = (action, id) => edit.panel.querySelector(`[data-act="${action}"]${id === undefined ? '' : `[data-id="${id}"]`}`);
  const click = (action, id) => { const element = button(action, id); expect(element).toBeTruthy(); element.click(); return element; };
  return { card, edit, nav: edit._navigation, button, click };
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('small editor sections', () => {
  it('places every existing tab in exactly one of five clear groups', () => {
    expect(EDITOR_GROUPS).toHaveLength(5);
    const all = editorTabs({ hasObjects: true, houseStyle: true }).map(([id]) => id), grouped = EDITOR_GROUPS.flatMap((group) => [...group.tabs, ...group.advanced]);
    expect(new Set(grouped).size).toBe(all.length); expect(grouped.sort()).toEqual(all.sort());
    for (const tab of all) expect(editorGroupForTab(tab)).toBeTruthy(); expect(editorGroupForTab('foreign')).toBeNull();
  });
  it('keeps optional House and Objects availability unchanged', () => {
    expect(editorTabs().map(([id]) => id)).not.toContain('objects'); expect(editorTabs().map(([id]) => id)).not.toContain('house');
    expect(editorTabs({ hasObjects: true }).map(([id]) => id)).toContain('objects');
  });
  it('shows only the current group basics and tucks specialist tabs into Advanced', () => {
    const h = setup(); expect([...h.edit.panel.querySelectorAll('.editor-groups button')].map((button) => button.textContent)).toEqual(['House', 'Devices', 'Controls', 'Appearance', 'Data']);
    expect([...h.edit.panel.querySelectorAll('.editor-basic-tabs button:not([hidden])')].map((button) => button.dataset.id)).toEqual(['rooms', 'model']);
    h.click('editor-group', 'devices'); expect(h.edit.tab).toBe('devices');
    const details = h.edit.panel.querySelector('[data-editor-advanced]'); expect(details.hidden).toBe(false); expect(details.open).toBe(false);
    expect(details.closest('.tab-body')).toBeTruthy(); expect(details.closest('[data-editor-navigation]')).toBeNull();
    expect([...details.querySelectorAll('button:not([hidden])')].map((button) => button.dataset.id)).toEqual(['cameras', 'tracking', 'security', 'mower']);
  });
  it('revealTab performs normal cancellation and opens the matching advanced group', () => {
    const h = setup(); h.edit.drawing = { points: [[0, 0]] }; h.edit.selectedMarker = 'old';
    expect(h.edit.revealTab('controls')).toBe(true); expect(h.edit.tab).toBe('controls'); expect(h.edit.drawing).toBeNull(); expect(h.edit.selectedMarker).toBeNull();
    expect(h.edit.revealTab('tracking')).toBe(true); expect(h.nav.group).toBe('devices'); expect(h.edit.panel.querySelector('[data-editor-advanced]').open).toBe(true);
    expect(h.edit.revealTab('foreign')).toBe(false); expect(h.edit.tab).toBe('tracking');
    expect(h.card._hass.callService).not.toHaveBeenCalled(); expect(h.card._commit).not.toHaveBeenCalled();
  });
  it('retains focused navigation after a normal redraw', () => {
    const h = setup(), group = h.button('editor-group', 'devices'); group.focus(); group.click();
    expect(document.activeElement?.dataset.id).toBe('devices'); expect(document.activeElement?.dataset.act).toBe('editor-group');
  });
  it('the compact native group picker opens the same real tabs and retains focus', () => {
    const h = setup(), select = h.edit.panel.querySelector('[data-field="editor-group"]'); select.focus(); select.value = 'controls'; select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.edit.tab).toBe('controls'); expect(h.nav.group).toBe('controls'); expect(document.activeElement?.dataset.field).toBe('editor-group');
    expect(h.edit.panel.querySelector('[data-field="editor-group"]').value).toBe('controls'); expect(h.card._commit).not.toHaveBeenCalled();
  });
  it('refreshes authored labels without replacing an unfinished feature input', () => {
    const h = setup(); h.edit.revealTab('controls'); h.click('custom-controls-add-bar');
    const input = h.edit.panel.querySelector('[data-field="custom-controls-bar-label"]'); input.focus(); input.value = 'My unfinished bar'; input.dispatchEvent(new Event('input', { bubbles: true }));
    h.card._hass.language = 'de'; h.edit._syncOwnedLabels(true);
    expect(h.edit.panel.querySelector('[data-field="custom-controls-bar-label"]')).toBe(input); expect(input.value).toBe('My unfinished bar');
    expect(h.button('editor-group', 'devices').textContent).toBe('Geräte');
  });
  it('feedback sync observes draft changes after real native click/input and state paths', () => {
    const h = setup(), seen = []; h.card._syncFeedback = vi.fn(() => seen.push(h.edit._customControlsEditor.dirty));
    h.edit.revealTab('controls'); h.click('custom-controls-add-bar'); expect(seen.at(-1)).toBe(true);
    const input = h.edit.panel.querySelector('[data-field="custom-controls-bar-label"]'); input.value = 'Changed'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(seen.at(-1)).toBe(true); h.click('custom-controls-cancel'); expect(seen.at(-1)).toBe(false);
    h.card._syncFeedback.mockClear(); h.edit.onStates(); expect(h.card._syncFeedback).toHaveBeenCalled();
    h.card._syncFeedback.mockClear(); h.edit.afterUpdate(); expect(h.card._syncFeedback).toHaveBeenCalled();
  });
  it('editor save captions do not create a second root-owned feedback token', () => {
    const h = setup(); h.card._feedback = { setSaveState: vi.fn() }; h.card._syncFeedback = vi.fn(); h.edit.setSaveState('saving'); h.edit.setSaveState('saved');
    expect(h.card._feedback.setSaveState).not.toHaveBeenCalled(); expect(h.card._syncFeedback).toHaveBeenCalledTimes(2);
    expect(h.edit.panel.querySelector('.save-state').textContent).toBe('Saved');
  });
});

describe('current setup progress evidence', () => {
  it('uses resolved current room/floor/area data rather than raw saved outlines', () => {
    const h = setup(); expect(setupProgress(h.card).roomCount).toBe(1); h.card._roomList = []; expect(setupProgress(h.card).roomsReady).toBe(false);
  });
  it.each(['area', 'floor', 'polygon', 'stale', 'duplicateFloor'])('rejects %s room evidence', (condition) => {
    const h = setup(), ownRoom = structuredClone(room); h.card._roomList = [{ room: ownRoom, floorId: 'ground' }];
    if (condition === 'area') delete h.card._hass.areas.lounge;
    if (condition === 'floor') h.card._roomList[0].floorId = 'missing';
    if (condition === 'polygon') ownRoom.polygon = [[0, 0], [1, NaN], [1, 1]];
    if (condition === 'stale') ownRoom.stale = true;
    if (condition === 'duplicateFloor') h.card._floors.push({ ...h.card._floors[0] });
    expect(setupProgress(h.card).roomsReady).toBe(false);
  });
  it('distinguishes a configured model from actual loaded geometry', () => {
    const h = setup(); h.card._config.model = '/local/real-house.glb'; expect(setupProgress(h.card)).toMatchObject({ modelConfigured: true, modelReady: false });
    h.card._view.model = { root: {} }; expect(setupProgress(h.card).modelReady).toBe(true); h.card._loading = true; expect(setupProgress(h.card).modelReady).toBe(false);
  });
  it.each(['inferredArea', 'inferredFloor', 'missingSource', 'duplicateSource', 'differentArea', 'differentFloor'])('requires deliberate exact model links before setup counts a room: %s', (condition) => {
    const h = setup(), ownRoom = { ...structuredClone(room), id: 'm:model-lounge', modelId: 'model-lounge', fromModel: true };
    const source = { id: 'model-lounge', level: 'model-ground' }, bindings = { manifest: { rooms: [source] },
      rooms: { 'model-lounge': { area: 'lounge', auto: false } }, levels: { 'model-ground': { floor: 'ground', auto: false, show: 'with' } } };
    h.card._roomList = [{ room: ownRoom, floorId: 'ground' }]; h.card.modelBindings = () => bindings;
    expect(setupProgress(h.card)).toMatchObject({ roomsReady: true, roomCount: 1 });
    if (condition === 'inferredArea') bindings.rooms['model-lounge'].auto = true;
    if (condition === 'inferredFloor') bindings.levels['model-ground'].auto = true;
    if (condition === 'missingSource') bindings.manifest.rooms = [];
    if (condition === 'duplicateSource') bindings.manifest.rooms.push({ ...source });
    if (condition === 'differentArea') bindings.rooms['model-lounge'].area = 'another-area';
    if (condition === 'differentFloor') bindings.levels['model-ground'].floor = 'another-floor';
    expect(setupProgress(h.card)).toMatchObject({ roomsReady: false, roomCount: 0 });
    expect(h.card._roomList[0].room).toEqual(ownRoom); expect(h.card._commit).not.toHaveBeenCalled();
  });
  it('only counts placed current marker IDs and current valid object bindings', () => {
    const h = setup(); h.card._positions.set('old', { x: 1, y: 2 }); h.card._bindings.set('missing', { entity: 'light.old' });
    expect(setupProgress(h.card).controlsReady).toBe(false); h.card._markers.push({ id: 'old' }); expect(setupProgress(h.card).placed).toBe(1);
    h.card._hass.states['light.current'] = { state: 'off' }; h.card._bindings.set('current', { entity: 'light.current' }); expect(setupProgress(h.card).bound).toBe(1);
  });
  it('does not call missing saved buttons a ready control source', () => {
    const h = setup(); h.card._layout.custom_controls = { version: 1, bars: [{ id: 'bar', label: 'Saved', placement: 'bottom', style: 'pills', buttons: [
      { id: 'button', label: 'Missing scene', icon: 'mdi:movie', color: 'amber', action: { type: 'scene', entity: 'scene.missing' } }] }] };
    expect(setupProgress(h.card).controlsReady).toBe(false); expect(setupProgress(h.card).buttonCount).toBe(0);
  });
});

describe('actionable guided setup in actual editor', () => {
  it('opens the real upload workflow automatically for an empty first layout', () => {
    const h = setup({ empty: true }); h.edit.enter();
    expect(h.nav.wizard).toBe(true); expect(h.nav.step).toBe(0); expect(h.edit.tab).toBe('model');
    expect(h.edit.panel.querySelector('[data-field="model-file"]')).toBeTruthy(); expect(h.button('setup-next').disabled).toBe(true);
    expect(h.card._commit).not.toHaveBeenCalled(); expect(h.card._hass.fetchWithAuth).not.toHaveBeenCalled(); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('provides an explicit drawn-room route, then real draw/pick controls', () => {
    const h = setup({ empty: true }); h.edit.enter(); h.click('setup-draw-instead');
    expect(h.nav.step).toBe(1); expect(h.edit.tab).toBe('rooms'); expect(h.button('draw', 'lounge')).toBeTruthy(); expect(h.button('setup-next').disabled).toBe(true);
    h.click('draw', 'lounge'); expect(h.edit.drawing?.areaId).toBe('lounge'); expect(h.card._commit).not.toHaveBeenCalled();
  });
  it('shows a clear areas empty state with the actual HA areas route', () => {
    const h = setup({ empty: true }); h.card._hass.areas = {}; h.edit.enter(); h.click('setup-draw-instead');
    expect(h.edit.panel.querySelector('[data-editor-setup] a')?.getAttribute('href')).toBe('/config/areas/dashboard');
    expect(h.edit.panel.textContent).toContain('Create your rooms as areas'); expect(h.button('setup-next').disabled).toBe(true);
  });
  it('lets the same saved layout continue or leave guidance for ordinary editing', () => {
    const h = setup(); h.edit.enter(); expect(h.nav.wizard).toBe(false); h.click('setup-start'); expect(h.nav.wizard).toBe(true);
    h.click('setup-edit-existing'); expect(h.nav.wizard).toBe(false); expect(h.edit.panel.querySelector('[data-editor-setup]')).toBeNull();
    expect(h.card._layout.rooms).toHaveLength(1); expect(h.card._commit).not.toHaveBeenCalled();
  });
  it('uses real button drafts and requires Save or Cancel before advancing', () => {
    const h = setup(); h.nav.skippedModel = true; h.click('setup-start'); expect(h.nav.step).toBe(2); expect(h.edit.tab).toBe('controls');
    h.click('custom-controls-add-bar'); expect(h.edit._customControlsEditor.dirty).toBe(true); h.edit.render();
    expect(h.button('setup-next').disabled).toBe(true); h.click('setup-step', '3'); expect(h.nav.step).toBe(2);
    expect(h.edit._customControlsEditor.dirty).toBe(true); expect(h.edit.panel.textContent).toContain('Save or cancel');
    h.click('custom-controls-cancel'); h.click('setup-controls-later'); expect(h.nav.step).toBe(3); expect(h.edit.tab).toBe('setup');
  });
  it('does not replace an existing unsaved draft when Continue setup is pressed', () => {
    const h = setup(); h.edit.revealTab('controls'); h.click('custom-controls-add-bar'); const draft = h.edit._customControlsEditor.draft;
    h.click('setup-start'); expect(h.nav.wizard).toBe(false); expect(h.edit._customControlsEditor.draft).toBe(draft); expect(h.edit._customControlsEditor.dirty).toBe(true);
  });
  it('retains the exact setup button and focus through unrelated Home Assistant readings', () => {
    const h = setup(); h.nav.skippedModel = true; h.nav.skippedControls = true; h.click('setup-start');
    const button = h.button('setup-save'); button.focus();
    h.card._hass = { ...h.card._hass, states: { 'sensor.unrelated': { state: '1' } } }; h.edit.observeSetupContext();
    expect(h.button('setup-save')).toBe(button); expect(document.activeElement).toBe(button);
  });
  it('final Save preserves existing extensions and calls one root save route', async () => {
    const h = setup(); h.card._layout.ui_setup = { future: ['keep'] }; h.nav.skippedModel = true; h.nav.skippedControls = true;
    h.card.completeSetup = vi.fn(async (next, token) => { expect(h.edit.setupSaveCurrent(token)).toBe(true); h.card._commit(next); expect(h.edit.setupSaveCurrent(token)).toBe(true); return true; });
    h.click('setup-start'); expect(h.nav.step).toBe(3); expect(h.button('setup-save').disabled).toBe(false); h.click('setup-save'); await turn();
    expect(h.card.completeSetup).toHaveBeenCalledOnce(); expect(h.card._commit).toHaveBeenCalledOnce();
    expect(h.card._layout.ui_setup).toEqual({ future: ['keep'], version: 1, complete: true, mode: 'drawn', controls: 'later' });
    expect(h.card._layout.future).toEqual({ preserved: true }); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps work visible and supports deliberate retry after a save failure', async () => {
    const h = setup(); h.nav.skippedModel = true; h.nav.skippedControls = true; h.card.completeSetup = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    h.click('setup-start'); h.click('setup-save'); await turn(); expect(h.nav.notice).toBe('failed'); expect(h.edit.panel.textContent).toContain('Your work is still here');
    expect(h.button('setup-save').disabled).toBe(false); h.click('setup-save'); await turn(); expect(h.card.completeSetup).toHaveBeenCalledTimes(2); expect(h.nav.notice).toBe('');
  });
  it.each(['account', 'connection', 'source', 'loading', 'permission'])('rejects an old held Save across %s loss and recovery', async (change) => {
    const h = setup(); h.nav.skippedModel = true; h.nav.skippedControls = true; h.card.completeSetup = vi.fn().mockResolvedValue(true); h.click('setup-start');
    const old = h.button('setup-save'); h.nav.press(old);
    const restore = () => { h.card._hass.user.id = 'admin'; h.card._hass.connection.connected = true; h.card._config.layout_key = 'setup'; h.card._loading = false; h.card._hass.user.is_admin = true; };
    if (change === 'account') h.card._hass.user.id = 'other'; if (change === 'connection') h.card._hass.connection.connected = false;
    if (change === 'source') h.card._config.layout_key = 'other'; if (change === 'loading') h.card._loading = true; if (change === 'permission') h.card._hass.user.is_admin = false;
    h.edit.observeSetupContext(); restore(); h.edit.observeSetupContext(); h.nav.onClick(old); await turn(); expect(h.card.completeSetup).not.toHaveBeenCalled();
    h.edit.render(); h.click('setup-save'); await turn(); expect(h.card.completeSetup).toHaveBeenCalledOnce();
  });
  it('discards late Save results after layout context replacement', async () => {
    const h = setup(); h.nav.skippedModel = true; h.nav.skippedControls = true; let resolve;
    h.card.completeSetup = vi.fn(() => new Promise((done) => { resolve = done; })); h.click('setup-start'); h.click('setup-save'); expect(h.nav.saveBusy).toBe(true);
    h.card._config = { ...h.card._config, layout_key: 'replacement' }; h.edit.cancelHistoryGestures(); resolve(false); await turn();
    expect(h.nav.wizard).toBe(false); expect(h.nav.notice).toBe(''); expect(h.edit.tab).toBe('rooms'); expect(h.card._commit).not.toHaveBeenCalled();
  });
  it('rejects held Save after a different saved layout takes over under the same key', async () => {
    const h = setup(); h.nav.skippedModel = true; h.nav.skippedControls = true; h.card.completeSetup = vi.fn().mockResolvedValue(true); h.click('setup-start');
    const button = h.button('setup-save'); h.nav.press(button); h.card._layout = { ...h.card._layout, rooms: structuredClone(h.card._layout.rooms), future: { changed: true } };
    h.nav.onClick(button); await turn(); expect(h.card.completeSetup).not.toHaveBeenCalled();
  });
  it.each(['pointercancel', 'Escape', 'focusout'])('a cancelled %s Save press cannot write setup', async (reason) => {
    const h = setup(); h.nav.skippedModel = true; h.nav.skippedControls = true; h.card.completeSetup = vi.fn().mockResolvedValue(true); h.click('setup-start');
    const button = h.button('setup-save'); button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    if (reason === 'Escape') button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else button.dispatchEvent(new Event(reason, { bubbles: true }));
    button.click(); await turn(); expect(h.card.completeSetup).not.toHaveBeenCalled();
    const fresh = h.button('setup-save'); fresh.focus(); fresh.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); fresh.click(); await turn(); expect(h.card.completeSetup).toHaveBeenCalledOnce();
  });
  it('rejects held Save across a model loading interval even if the old root returns', async () => {
    const h = setup(); h.nav.skippedModel = true; h.nav.skippedControls = true; h.card.completeSetup = vi.fn().mockResolvedValue(true); h.click('setup-start');
    const button = h.button('setup-save'); h.nav.press(button); h.card._customControlsModelLoad = { promise: Promise.resolve() }; h.edit.observeSetupContext();
    h.card._customControlsModelLoad = null; h.edit.observeSetupContext(); h.nav.onClick(button); await turn(); expect(h.card.completeSetup).not.toHaveBeenCalled();
  });
  it('a pending final Save cannot finish after its current room link disappears', async () => {
    const h = setup(); h.nav.skippedModel = true; h.nav.skippedControls = true; let resolve, savedToken;
    h.card.completeSetup = vi.fn((_next, token) => { savedToken = token; return new Promise((done) => { resolve = done; }); });
    h.click('setup-start'); h.click('setup-save'); expect(h.edit.setupSaveCurrent(savedToken)).toBe(true);
    h.card._roomList = []; expect(h.edit.setupSaveCurrent(savedToken)).toBe(false); resolve(true); await turn(); expect(h.card._commit).not.toHaveBeenCalled();
    expect(h.nav.saveBusy).toBe(false); expect(h.nav.notice).toBe('changed');
  });
  it('does not start or save setup from a non-administrator account', () => {
    const h = setup({ empty: true, admin: false }); h.edit.enter(); expect(h.nav.wizard).toBe(false); expect(h.button('setup-start').disabled).toBe(true);
    expect(h.nav.start()).toBe(false); expect(h.nav.snapshot().canFinish).toBe(false); expect(h.card._commit).not.toHaveBeenCalled();
  });
  it('uploads a deliberate GLB through the existing authenticated route', async () => {
    const h = setup({ empty: true }); h.edit.enter(); h.card.resetHistory = vi.fn();
    h.card._hass.fetchWithAuth.mockResolvedValue(new Response(JSON.stringify({ version: 'new', name: 'my-house.glb', size: 12 }), { status: 200 }));
    await h.edit._uploadModel(new File(['GLB fixture'], 'my-house.glb'));
    expect(h.card._hass.fetchWithAuth).toHaveBeenCalledWith('/api/taylors3d/model/setup', expect.objectContaining({ method: 'POST' }));
    expect(h.card._layout.model).toMatchObject({ version: 'new', name: 'my-house.glb', size: 12 }); expect(h.card.resetHistory).toHaveBeenCalledOnce();
    expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['account', 'connection', 'permission', 'layout', 'exit'])('rejects an old upload response across %s replacement or recovery', async (change) => {
    const h = setup({ empty: true }); h.edit.enter(); let resolve;
    h.card._hass.fetchWithAuth.mockReturnValue(new Promise((done) => { resolve = done; }));
    const uploading = h.edit._uploadModel(new File(['GLB fixture'], 'my-house.glb')); await turn();
    if (change === 'account') { h.card._hass.user.id = 'other'; h.edit.observeSetupContext(); h.card._hass.user.id = 'admin'; }
    if (change === 'connection') { h.card._hass.connection.connected = false; h.edit.observeSetupContext(); h.card._hass.connection.connected = true; }
    if (change === 'permission') { h.card._hass.user.is_admin = false; h.edit.observeSetupContext(); h.card._hass.user.is_admin = true; }
    if (change === 'layout') h.card._config.layout_key = 'other';
    if (change === 'exit') { h.card._editing = false; h.edit.exit(); }
    h.edit.observeSetupContext(); resolve(new Response(JSON.stringify({ version: 'old', name: 'my-house.glb', size: 12 }), { status: 200 })); await uploading;
    expect(h.card._commit).not.toHaveBeenCalled(); expect(h.card._layout.model).toBeUndefined(); expect(h.edit.uploading).toBeNull();
  });
  it('does not post a file or delete a model from a non-admin session', async () => {
    const h = setup({ admin: false }); await h.edit._uploadModel(new File(['fixture'], 'model.glb')); await h.edit._removeModel();
    expect(h.card._hass.fetchWithAuth).not.toHaveBeenCalled(); expect(h.card._commit).not.toHaveBeenCalled();
  });
});
