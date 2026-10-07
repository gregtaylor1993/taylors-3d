// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditHistory } from '../src/history.js';
import { EditMode } from '../src/edit-mode.js';
import { ScenePreviewController } from '../src/scene-preview.js';
import { ScenePreviewEditor } from '../src/scene-preview-editor.js';
import '../src/taylors3d-card.js';

const prototype = customElements.get('taylors3d-card').prototype;
const mounted = [];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const parent = document.createElement('div'), host = document.createElement('div'), panel = document.createElement('div');
  parent.append(host, panel); document.body.append(parent);
  const c = { isConnected: true, _editing: false, _loading: false, _feedbackHost: host,
    _layout: { version: 1, rooms: [], floors: [], custom_controls: { version: 1, bars: [{ id: 'evening', label: 'Evening', placement: 'bottom', style: 'pills', buttons: [
      { id: 'movie', label: 'Movie', icon: 'mdi:movie', color: 'amber', action: { type: 'scene', entity: 'scene.movie' } }] }] } },
    _config: { layout_key: 'feedback-fixture', model: '/simulated.glb' }, _store: { save: vi.fn(async () => true) },
    _view: { model: { root: {} } }, _viewId: 'ground', _views: [], _floors: [], _roomList: [], _history: new EditHistory(),
    _hass: { connection: { connected: true, options: { auth: {} } }, auth: {}, user: { id: 'current', is_active: true, is_admin: true, permissions: {} },
      states: { 'light.lounge': { entity_id: 'light.lounge', state: 'off', attributes: { friendly_name: 'Lounge lamp', brightness: 0 } },
        'scene.movie': { entity_id: 'scene.movie', state: 'unknown', attributes: { friendly_name: 'Movie' } } },
      entities: {}, devices: {}, areas: {}, floors: {}, services: { light: { toggle: {} }, scene: { turn_on: {} } }, callService: vi.fn(async () => ({})), language: 'en' },
    _edit: { panel, setSaveState: vi.fn(), _customControlsEditor: { dirty: false } },
    _devicePopup: { _session: 1, _selection: null, isOpen: false, updateCustomControls: vi.fn() }, _popup: { objectId: null },
    _resize: vi.fn(), _suspendAmbient: vi.fn(), _stopScenePreview: vi.fn(), resetHistory: vi.fn(), _syncSecurity: vi.fn(),
    finishWallSelectionPreparation: vi.fn(), _recordHistory: vi.fn(), _schedule: vi.fn(), _moreInfo: vi.fn(), _setView: vi.fn() };
  for (const name of ['_ensureFeedback', '_feedbackContext', '_syncFeedback', '_unbindFeedbackEditor', '_requestService', '_requestSceneService', '_commit', '_syncCustomControls',
    '_customControlsSettings', '_customControlsRooms', '_customControlContext', '_runCustomControl', '_runRoomShortcut']) c[name] = prototype[name];
  c._ensureFeedback();
  mounted.push({ dispose() { c.isConnected = false; c._unbindFeedbackEditor(); c._feedback.dispose(); c._feedbackView.dispose(); parent.remove(); } });
  return { c, host, panel, parent, snapshot: () => c._feedback.snapshot() };
}
afterEach(() => { for (const item of mounted.splice(0)) item.dispose(); vi.restoreAllMocks(); });

describe('exact current Edit press owns popup closure until click', () => {
  function pressFixture() {
    const card = document.createElement('div'); card.attachShadow({ mode: 'open' }); document.body.append(card);
    const button = document.createElement('button'), label = document.createElement('span'); button.append(label); card.shadowRoot.append(button);
    card._editBtn = button; card._hass = { user: { is_admin: true, is_active: true } };
    let result;
    card.shadowRoot.addEventListener('pointerdown', (event) => { result = prototype._keepPopupForEditPress.call(card, event); });
    mounted.push({ dispose() { card.remove(); } });
    return { card, button, label, press(target = label) { target.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true })); return result; } };
  }
  it('recognizes the actual current button through its native label path without acting on pointerdown', () => {
    const f = pressFixture(); expect(f.press()).toBe(true); expect(f.card._editing).toBeUndefined();
  });
  it.each(['hidden', 'disabled', 'inactive', 'not-admin', 'replaced', 'foreign'])('does not exempt a %s Edit target', (kind) => {
    const f = pressFixture(); let target = f.label;
    if (kind === 'hidden') f.button.hidden = true;
    if (kind === 'disabled') f.button.disabled = true;
    if (kind === 'inactive') f.card._hass.user.is_active = false;
    if (kind === 'not-admin') f.card._hass.user.is_admin = false;
    if (kind === 'replaced') { f.card._editBtn = document.createElement('button'); f.card.shadowRoot.append(f.card._editBtn); }
    if (kind === 'foreign') { target = document.createElement('button'); target.dataset.bubble = 'edit'; f.card.shadowRoot.append(target); }
    expect(f.press(target)).toBe(false);
  });
});

describe('root save transport and feedback ownership', () => {
  it('dispatches the captured current hass/store immediately and retains the actual save promise result', async () => {
    const f = fixture(), run = deferred(), initialHass = f.c._hass, initialStore = f.c._store, next = { ...f.c._layout, extension: 'saved' };
    initialStore.save.mockReturnValue(run.promise);
    const saved = f.c._commit(next);
    expect(initialStore.save).toHaveBeenCalledExactlyOnceWith(initialHass, next);
    expect(f.c._pendingLayoutSave).toBe(saved); expect(f.snapshot().save.persistedStatus).toBe('saving');
    run.resolve(true); expect(await saved).toBe(true);
    expect(f.snapshot().save.status).toBe('saved'); expect(f.c._edit.setSaveState.mock.calls).toEqual([['saving'], ['saved']]);
  });
  it('captures hass/store before an editor callback can replace them', async () => {
    const f = fixture(), hass = f.c._hass, store = f.c._store, replacement = { save: vi.fn() };
    f.c._edit.setSaveState.mockImplementation((state) => { if (state === 'saving') { f.c._hass = { ...hass, user: { ...hass.user, id: 'new' } }; f.c._store = replacement; } });
    const next = { ...f.c._layout }; expect(await f.c._commit(next)).toBe(false);
    expect(store.save).toHaveBeenCalledExactlyOnceWith(hass, next); expect(replacement.save).not.toHaveBeenCalled();
    expect(f.snapshot().save.status).toBe('idle');
  });
  it('keeps newer dirty edits visibly unsaved when the older dispatched save succeeds', async () => {
    const f = fixture(), run = deferred(); f.c._store.save.mockReturnValue(run.promise);
    const saved = f.c._commit({ ...f.c._layout }); f.c._editing = true; f.c._edit._customControlsEditor.dirty = true; f.c._syncFeedback();
    run.resolve(true); expect(await saved).toBe(true);
    expect(f.snapshot().save).toMatchObject({ status: 'unsaved', persistedStatus: 'saved', dirty: true });
    f.c._edit._customControlsEditor.dirty = false; f.c._syncFeedback(); expect(f.snapshot().save.status).toBe('saved');
  });
  it.each(['resolve-false', 'reject', 'throw'])('reports actual save failure %s without claiming a persisted layout', async (kind) => {
    const f = fixture();
    if (kind === 'resolve-false') f.c._store.save.mockResolvedValue(false);
    if (kind === 'reject') f.c._store.save.mockRejectedValue(new Error('simulated'));
    if (kind === 'throw') f.c._store.save.mockImplementation(() => { throw new Error('simulated'); });
    expect(await f.c._commit({ ...f.c._layout })).toBe(false);
    expect(f.snapshot().save.status).toBe('failed'); expect(f.c._edit.setSaveState).toHaveBeenLastCalledWith('failed');
  });
  it('does not attach old save results to a later layout save', async () => {
    const f = fixture(), old = deferred(), current = deferred(); f.c._store.save.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const prior = f.c._commit({ ...f.c._layout }), latest = f.c._commit({ ...f.c._layout });
    old.resolve(true); expect(await prior).toBe(false); expect(f.snapshot().save.status).toBe('saving');
    current.resolve(true); expect(await latest).toBe(true); expect(f.snapshot().save.status).toBe('saved');
  });
  it('revokes shared status after account change while preserving the existing actual persistence return', async () => {
    const f = fixture(), run = deferred(); f.c._store.save.mockReturnValue(run.promise);
    const saved = f.c._commit({ ...f.c._layout }); f.c._hass = { ...f.c._hass, user: { ...f.c._hass.user, id: 'another' } }; f.c._syncFeedback();
    run.resolve(true); expect(await saved).toBe(true); expect(f.snapshot().save.status).toBe('idle');
    expect(f.c._edit.setSaveState).not.toHaveBeenCalledWith('saved');
  });
  it('clears an old local Saving footer when its request loses the current account', async () => {
    const f = fixture(), run = deferred(); f.c._store.save.mockReturnValue(run.promise);
    f.c._edit.setSaveState.mockImplementation((state) => { f.c._edit.saveState = state; });
    const saved = f.c._commit({ ...f.c._layout }); expect(f.c._edit.saveState).toBe('saving');
    f.c._hass.user = { ...f.c._hass.user, id: 'another-account' }; f.c._syncFeedback();
    expect(f.c._edit.saveState).toBe(''); run.resolve(true); await saved;
    expect(f.c._edit.saveState).toBe(''); expect(f.snapshot().save.status).toBe('idle');
  });
});

describe('root deliberate service feedback and source fences', () => {
  it.each(['runtime', 'editor'])('routes the actual %s scene controller through pending/requested feedback with unchanged HA readings', async (kind) => {
    const f = fixture(), run = deferred(); f.c._hass.callService.mockReturnValue(run.promise);
    const settings = { enabled: true, items: [{ id: 'movie', scene_entity: 'scene.movie', label: 'Saved Movie', lights: [] }] };
    f.c._layout.scene_previews = settings;
    let controller;
    if (kind === 'runtime') {
      const card = document.createElement('taylors3d-card');
      card._scenePreviewContext = () => ({ hass: f.c._hass, bindings: settings, contextKey: 'scene-owner' });
      card._requestSceneService = (...args) => f.c._requestSceneService(...args);
      controller = card._scenePreviewController; mounted.push({ dispose: () => { controller.dispose(); card._feedback.dispose(); } });
    } else {
      const editor = new ScenePreviewEditor(f.c); controller = editor.controller; mounted.push(editor);
    }
    const result = controller.activate('movie');
    expect(f.c._hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.movie' });
    expect(f.snapshot().action).toMatchObject({ status: 'pending', label: 'Saved Movie' });
    run.resolve({}); expect(await result).toMatchObject({ ok: true, current: true });
    expect(f.snapshot().action.status).toBe('requested'); expect(f.c._hass.states['scene.movie'].state).toBe('unknown');
  });
  it.each(['success', 'failure'])('ignores late scene %s from a changed activation owner without removing newer action feedback', async (kind) => {
    const f = fixture(), run = deferred(); f.c._hass.callService.mockReturnValueOnce(run.promise);
    const context = { hass: f.c._hass, bindings: { enabled: true, items: [{ id: 'movie', scene_entity: 'scene.movie', lights: [] }] }, contextKey: 'one' };
    const controller = new ScenePreviewController({ getContext: () => context, requestService: (...args) => f.c._requestSceneService(...args) }); mounted.push(controller);
    const result = controller.activate('movie'); context.contextKey = 'two';
    f.c._hass.callService.mockResolvedValue({}); await f.c._requestService('light', 'toggle', { entity_id: 'light.lounge' });
    expect(f.snapshot().action).toMatchObject({ id: 'light.lounge', status: 'requested' });
    if (kind === 'failure') run.reject(new Error('old failure')); else run.resolve({});
    expect(await result).toMatchObject({ current: false });
    expect(f.snapshot().action).toMatchObject({ id: 'light.lounge', status: 'requested' });
  });
  it.each(['binding', 'dispatcher', 'disposed'])('revokes its pending scene token when the exact %s owner changes', async (kind) => {
    const f = fixture(), run = deferred(); f.c._hass.callService.mockReturnValue(run.promise);
    const context = { hass: f.c._hass, bindings: { enabled: true, items: [{ id: 'movie', scene_entity: 'scene.movie', lights: [] }] }, contextKey: 'one' };
    const controller = new ScenePreviewController({ getContext: () => context, requestService: (...args) => f.c._requestSceneService(...args) }); mounted.push(controller);
    const result = controller.activate('movie');
    if (kind === 'binding') context.bindings.items[0].label = 'different saved target';
    if (kind === 'dispatcher') controller.requestService = vi.fn();
    if (kind === 'disposed') controller.dispose();
    run.resolve({}); expect(await result).toMatchObject({ current: false }); expect(f.snapshot().action).toBeNull();
    expect(f.c._hass.callService).toHaveBeenCalledOnce(); expect(f.c._hass.states['scene.movie'].state).toBe('unknown');
  });
  it('rejects a captured foreign HA provider before dispatching the scene', async () => {
    const f = fixture(), foreign = { ...f.c._hass };
    await expect(f.c._requestSceneService(foreign, 'scene', 'turn_on', { entity_id: 'scene.movie' })).rejects.toThrow('changed');
    expect(f.c._hass.callService).not.toHaveBeenCalled(); expect(f.snapshot().action).toBeNull();
  });
  it.each(['disconnected', 'loading', 'inactive'])('sends no device request in the current %s context', async (kind) => {
    const f = fixture();
    if (kind === 'disconnected') f.c._hass.connection.connected = false;
    if (kind === 'loading') f.c._loading = true;
    if (kind === 'inactive') f.c._hass.user.is_active = false;
    await expect(f.c._requestService('light', 'toggle', { entity_id: 'light.lounge' })).rejects.toThrow('unavailable');
    expect(f.c._hass.callService).not.toHaveBeenCalled(); expect(f.snapshot().action).toBeNull();
  });
  it('dispatches exact service data synchronously, then reports requested without inventing device state', async () => {
    const f = fixture(), run = deferred(), data = { entity_id: 'light.lounge' }; f.c._hass.callService.mockReturnValue(run.promise);
    const requested = f.c._requestService('light', 'toggle', data);
    expect(f.c._hass.callService).toHaveBeenCalledExactlyOnceWith('light', 'toggle', data);
    expect(f.snapshot().action).toMatchObject({ status: 'pending', label: 'Lounge lamp' });
    run.resolve({}); expect(await requested).toEqual({}); expect(f.snapshot().action.status).toBe('requested');
    expect(f.c._hass.states['light.lounge'].state).toBe('off');
  });
  it.each(['resolve-false', 'resolve-ok-false', 'reject', 'throw'])('shows request failure %s and retains the original result/error', async (kind) => {
    const f = fixture(), call = f.c._hass.callService;
    if (kind === 'resolve-false') call.mockResolvedValue(false);
    if (kind === 'resolve-ok-false') call.mockResolvedValue({ ok: false });
    if (kind === 'reject') call.mockRejectedValue(new Error('simulated'));
    if (kind === 'throw') call.mockImplementation(() => { throw new Error('simulated'); });
    const result = f.c._requestService('light', 'toggle', { entity_id: 'light.lounge' });
    if (kind === 'reject' || kind === 'throw') await expect(result).rejects.toThrow('simulated'); else await result;
    expect(f.snapshot().action.status).toBe('failed'); expect(f.c._hass.states['light.lounge'].state).toBe('off');
  });
  it.each(['account', 'connection', 'permission', 'source', 'metadata', 'service', 'view', 'room', 'model', 'store', 'loading'])('revokes a late request result through %s change', async (kind) => {
    const f = fixture(), run = deferred(); f.c._hass.callService.mockReturnValue(run.promise);
    const result = f.c._requestService('light', 'toggle', { entity_id: 'light.lounge' });
    if (kind === 'account') f.c._hass.user = { ...f.c._hass.user, id: 'other' };
    if (kind === 'connection') { f.c._hass.connection.connected = false; f.c._syncFeedback(); f.c._hass.connection.connected = true; }
    if (kind === 'permission') { f.c._hass.user.permissions = { control: false }; f.c._syncFeedback(); f.c._hass.user.permissions = {}; }
    if (kind === 'source') { f.c._hass.states['light.lounge'].state = 'unavailable'; f.c._syncFeedback(); f.c._hass.states['light.lounge'].state = 'off'; }
    if (kind === 'metadata') { f.c._hass.entities['light.lounge'] = { area_id: 'another' }; f.c._syncFeedback(); delete f.c._hass.entities['light.lounge']; }
    if (kind === 'service') { const old = f.c._hass.services; f.c._hass.services = {}; f.c._syncFeedback(); f.c._hass.services = old; }
    if (kind === 'view') f.c._viewId = 'upper';
    if (kind === 'room') f.c._devicePopup._selection = { kind: 'room', room: { id: 'different' } };
    if (kind === 'model') f.c._view.model.root = {};
    if (kind === 'store') f.c._store = {};
    if (kind === 'loading') { f.c._loading = true; f.c._syncFeedback(); f.c._loading = false; }
    f.c._syncFeedback(); run.resolve({}); await result; expect(f.snapshot().action).toBeNull();
  });
  it('keeps ownership through ordinary actual readings and locale updates', async () => {
    const f = fixture(), run = deferred(); f.c._hass.callService.mockReturnValue(run.promise);
    const result = f.c._requestService('light', 'toggle', { entity_id: 'light.lounge' });
    f.c._hass = { ...f.c._hass, language: 'fr', states: { ...f.c._hass.states, 'light.lounge': { ...f.c._hass.states['light.lounge'], state: 'on', attributes: { friendly_name: 'Lounge lamp', brightness: 123 } } } };
    f.c._syncFeedback(); run.resolve({}); await result;
    expect(f.snapshot().action.status).toBe('requested'); expect(f.c._feedbackView.rows.get('action').message.textContent).toContain('Action demandée');
  });
  it('wraps a currently validated custom button with its saved literal label', async () => {
    const f = fixture(); await f.c._runCustomControl('evening', 'movie');
    expect(f.c._hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.movie' });
    expect(f.snapshot().action).toMatchObject({ label: 'Movie', status: 'requested' });
  });
  it('wraps a currently selected room shortcut with its deliberate command', async () => {
    const f = fixture(); f.c._devicePopup.isOpen = true; f.c._devicePopup._selection = { kind: 'room', room: { id: 'room' } };
    f.c._roomShortcutData = vi.fn(() => ({ actions: [{ id: 'movie', label: 'Room Movie', available: true, domain: 'scene', service: 'turn_on', entityId: 'scene.movie' }] }));
    await f.c._runRoomShortcut('room', 'movie');
    expect(f.snapshot().action).toMatchObject({ label: 'Room Movie', status: 'requested' });
    expect(f.c._hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.movie' });
  });
  it('does not fabricate service feedback for local More info or camera navigation', () => {
    const f = fixture(); f.c._layout.custom_controls.bars[0].buttons[0].action = { type: 'more-info', entity: 'light.lounge' };
    f.c._runCustomControl('evening', 'movie'); expect(f.c._moreInfo).toHaveBeenCalledExactlyOnceWith('light.lounge');
    expect(f.c._hass.callService).not.toHaveBeenCalled(); expect(f.snapshot().action).toBeNull();
  });
});

describe('root feedback layout and current editor drafts', () => {
  it('aggregates current dirty feature editors independently of the persistence status', () => {
    const f = fixture(); f.c._editing = true; f.c._edit._customControlsEditor.dirty = true; f.c._edit._cameraEditor = { dirty: true }; f.c._syncFeedback();
    expect(f.snapshot().save.status).toBe('unsaved'); f.c._edit._customControlsEditor.dirty = false; f.c._syncFeedback(); expect(f.snapshot().save.status).toBe('unsaved');
    f.c._edit._cameraEditor.dirty = false; f.c._syncFeedback(); expect(f.snapshot().save.status).toBe('idle');
  });
  it('observes the final draft after actual bubbled editor input and cancel clicks', async () => {
    const f = fixture(), input = document.createElement('input'); f.panel.append(input); f.c._editing = true;
    input.addEventListener('input', () => { f.c._edit._customControlsEditor.dirty = true; });
    input.dispatchEvent(new Event('input', { bubbles: true })); await flush(); expect(f.snapshot().save.status).toBe('unsaved');
    f.c._edit._customControlsEditor.dirty = false; input.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush(); expect(f.snapshot().save.status).toBe('idle');
  });
  it('does not enqueue new resize work for equal context, actual readings or locale-only text updates', async () => {
    const f = fixture(); f.c._editing = true; f.c._edit._customControlsEditor.dirty = true; f.c._syncFeedback(); await flush(); f.c._resize.mockClear();
    f.c._hass.states['light.lounge'].attributes.brightness = 200; f.c._syncFeedback(); f.c._syncFeedback();
    f.c._hass.language = 'de'; f.c._syncFeedback(); await flush();
    expect(f.c._resize).not.toHaveBeenCalled(); expect(f.c._feedbackView.rows.get('save').message.textContent).toBe('Ungespeicherte Änderungen');
  });
  it('revokes invisible old-context tokens without resizing an unchanged hidden strip', async () => {
    const f = fixture(); await flush(); f.c._resize.mockClear();
    const generation = f.snapshot().contextGeneration;
    f.c._devicePopup._session++; f.c._syncFeedback(); await flush();
    expect(f.snapshot().contextGeneration).toBeGreaterThan(generation);
    expect(f.host.hidden).toBe(true); expect(f.c._feedbackView.el.hidden).toBe(true);
    expect(f.c._resize).not.toHaveBeenCalled();
  });
  it('replaces save ownership without resizing an identical visible saving caption', async () => {
    const f = fixture(), old = f.c._feedback.setSaveState('saving'); await flush(); f.c._resize.mockClear();
    const current = f.c._feedback.setSaveState('saving'); await flush();
    expect(current).not.toBe(old); expect(f.snapshot().save.status).toBe('saving');
    expect(f.c._resize).not.toHaveBeenCalled();
    expect(f.c._feedback.setSaveState('saved', old)).toBe(false);
    expect(f.c._feedback.setSaveState('saved', current)).toBe(true); await flush();
    expect(f.snapshot().save.status).toBe('saved'); expect(f.c._resize).toHaveBeenCalledOnce();
  });
  it('places feedback outside the body/scene and keeps editor-local footer updates token-free', () => {
    const render = String(prototype._render); expect(render.indexOf('class="feedback-host"')).toBeGreaterThan(render.indexOf('class="body"'));
    const edit = fakedEditor(); EditMode.prototype.setSaveState.call(edit, 'saving'); expect(edit.card._feedback.setSaveState).not.toHaveBeenCalled();
    expect(edit.card._syncFeedback).toHaveBeenCalledOnce();
  });
  it('disposes editor listeners and rejects old results when feedback lifecycle is replaced', async () => {
    const f = fixture(), run = deferred(); f.c._hass.callService.mockReturnValue(run.promise);
    const requested = f.c._requestService('light', 'toggle', { entity_id: 'light.lounge' }), old = f.c._feedback;
    f.c._feedbackView.dispose(); f.c._feedbackView = null; old.dispose(); f.c._ensureFeedback();
    run.resolve({}); await requested; expect(f.c._feedback).not.toBe(old); expect(f.snapshot().action).toBeNull();
    f.c._unbindFeedbackEditor(); f.c._editing = true; f.c._edit._customControlsEditor.dirty = true; f.panel.dispatchEvent(new Event('input', { bubbles: true })); await flush();
    expect(f.snapshot().save.status).toBe('idle');
  });
});

function fakedEditor() {
  // The editor's existing footer remains presentation-only; root owns results.
  const card = { _feedback: { setSaveState: vi.fn() }, _syncFeedback: vi.fn() };
  return { card, saveState: '', _navigation: { update: vi.fn() }, panel: document.createElement('div'),
    _saveText: () => '', render: vi.fn() };
}
