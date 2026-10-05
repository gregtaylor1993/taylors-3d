// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const editors = [];
const reading = (value, name, attributes = {}) => ({ state: value, attributes: { friendly_name: name, ...attributes } });
function setup() {
  const room = { id: 'lounge', area_id: 'lounge', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], doors: [] };
  const card = {
    isConnected: true, _loading: false,
    _config: { layout_key: 'default', group_by: 'entity' },
    _layout: { version: 1, floors: [], rooms: [room], pins: {}, hidden: [], mower: {} },
    _hass: { user: { id: 'current-admin', is_admin: true, is_active: true }, connection: { connected: true }, auth: {}, states: {
      'binary_sensor.motion': reading('on', 'Lounge activity', { device_class: 'motion' }),
      'binary_sensor.car': reading('on', 'Vehicle occupancy', { device_class: 'occupancy' }),
      'vacuum.robot': reading('cleaning', 'Robot vacuum'), 'light.lamp': reading('on', 'Lounge lamp'),
    }, entities: { 'light.lamp': { area_id: 'lounge' }, 'binary_sensor.motion': { area_id: 'lounge' } }, devices: {},
    areas: { lounge: { area_id: 'lounge', name: 'Lounge', floor_id: 'ground' } }, floors: { ground: { name: 'Ground' } },
    callService: vi.fn(), callWS: vi.fn() },
    _roomList: [{ room, floorId: 'ground' }], _floors: [{ id: 'ground', name: 'Ground', elevation: 0, height: 2.7 }],
    _positions: new Map([['entity:light.lamp', { x: 1, y: 2, z: .5, floorId: 'ground' }]]), _markers: [],
    _view: { model: null, setControlsEnabled: vi.fn(), highlightModelNode: vi.fn(), setPivotMarker: vi.fn(), setOverlay: vi.fn(), setStems: vi.fn() },
    _built: {}, _stage: document.createElement('div'), _store: { backend: 'browser' }, _editing: true,
    _history: new EditHistory(), _applyMarkerSelection: vi.fn(), _syncCameraCoverage: vi.fn(), _syncTracking: vi.fn(),
    trackingAnchors: vi.fn(() => [{ id: 'object:dock', label: 'Dock', position: { x: 1, y: 2, z: 0, floorId: 'ground' } }]),
  };
  const snapshot = () => ({ layout: card._layout, config: card._config });
  card._history.reset(snapshot());
  const edit = new EditMode(card); edit.tab = 'data';
  card._edit = edit;
  card._syncTracking.mockImplementation(() => { card.trackingVisible = !card._editing || card._edit.tab === 'tracking'; });
  card._commit = vi.fn((layout) => { card._layout = layout; card._history.record(snapshot(), 'Layout edit'); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch) => card._commit({ ...card._layout, ...patch }));
  card.beginHistory = (label) => card._history.begin(label);
  card.endHistory = () => { card._history.end(); edit.updateHistoryState(); };
  const restore = (value) => { if (value) { card._layout = value.layout; card._config = value.config; edit.render(); } };
  card.undoEdit = vi.fn(() => restore(card._history.undo())); card.redoEdit = vi.fn(() => restore(card._history.redo()));
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach(); editors.push(edit);
  const click = (action, selector = '') => {
    const target = edit.panel.querySelector(`[data-act="${action}"]${selector}`); expect(target, action).toBeTruthy(); target.click();
  };
  const change = (field, value, eventType = 'change') => {
    const target = edit.panel.querySelector(`[data-field="${field}"]`); expect(target, field).toBeTruthy();
    if (target.type === 'checkbox') target.checked = value; else target.value = value;
    target.dispatchEvent(new Event(eventType, { bubbles: true })); return target;
  };
  const tracking = () => click('tab', '[data-id="tracking"]');
  const activity = () => { tracking(); click('trk-add'); change('trk-entity', 'binary_sensor.motion'); change('trk-room', 'lounge'); };
  const assertNoHA = () => { expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled(); };
  return { card, edit, click, change, tracking, activity, assertNoHA };
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); });

describe('Tracking through the actual EditMode panel', () => {
  it('adds the Tracking tab with all three observation forms and delegates input, changes and Save', () => {
    const ctx = setup(); ctx.activity(); ctx.change('trk-label', 'Room activity', 'input');
    expect(ctx.edit._trackingEditor.draft.label).toBe('Room activity'); expect(ctx.card._commit).not.toHaveBeenCalled();
    ctx.click('trk-save'); expect(ctx.card._layout.presence_bindings[0]).toMatchObject({ label: 'Room activity', entity: 'binary_sensor.motion', roomId: 'lounge', kind: 'room_activity' });
    expect(ctx.edit.panel.querySelector('[data-act="history-undo"]').disabled).toBe(false);
    for (const section of ['presence', 'vehicles', 'vacuums']) expect(ctx.edit.panel.querySelector(`[data-act="trk-section"][data-section="${section}"]`)).toBeTruthy();
    ctx.assertNoHA();
  });
  it('synchronizes tracking visibility after each tab change, using the newly selected tab', () => {
    const ctx = setup(); ctx.tracking(); expect(ctx.card.trackingVisible).toBe(true);
    ctx.click('tab', '[data-id="devices"]'); expect(ctx.card.trackingVisible).toBe(false);
    ctx.tracking(); expect(ctx.card.trackingVisible).toBe(true); expect(ctx.card._syncTracking).toHaveBeenCalledTimes(3); ctx.assertNoHA();
  });
  it('keeps draft inputs mounted and focused through live states and registry rebuilds', () => {
    const ctx = setup(); ctx.activity(); const target = ctx.change('trk-label', 'Still typing', 'input'); target.focus();
    ctx.card._hass.states['binary_sensor.motion'] = reading('unavailable', 'Updated source name'); ctx.edit.onStates();
    expect(ctx.edit.panel.querySelector('[data-field="trk-label"]')).toBe(target); expect(document.activeElement).toBe(target);
    expect(ctx.edit.panel.textContent).toContain('does not provide a current observation');
    ctx.card._hass.entities = { ...ctx.card._hass.entities }; ctx.edit.afterUpdate();
    expect(ctx.edit.panel.querySelector('[data-field="trk-label"]')).toBe(target); expect(document.activeElement).toBe(target); expect(target.value).toBe('Still typing');
    expect(ctx.edit._trackingEditor.draft.label).toBe('Still typing'); ctx.assertNoHA();
  });
  it('marks removed sources read-only in place and exposes deliberate Relink on a live update', () => {
    const ctx = setup(); ctx.activity(); const target = ctx.edit.panel.querySelector('[data-field="trk-label"]'); target.focus();
    delete ctx.card._hass.states['binary_sensor.motion']; delete ctx.card._hass.entities['binary_sensor.motion']; ctx.edit.onStates();
    expect(ctx.edit.panel.querySelector('[data-field="trk-label"]')).toBe(target); expect(target.disabled).toBe(true);
    expect(ctx.edit.panel.querySelector('[data-act="trk-relink"]').hidden).toBe(false); expect(ctx.edit.panel.querySelector('[data-act="trk-save"]').disabled).toBe(true);
    ctx.assertNoHA();
  });
  it('retains an unfinished draft during an unfocused registry redraw without saving it', () => {
    const ctx = setup(); ctx.activity(); ctx.change('trk-label', 'An unfinished idea', 'input'); document.activeElement.blur(); ctx.edit.afterUpdate();
    expect(ctx.edit.panel.querySelector('[data-field="trk-label"]').value).toBe('An unfinished idea'); expect(ctx.card._commit).not.toHaveBeenCalled();
    ctx.assertNoHA();
  });
  it('Cancel and leaving Tracking discard the draft instead of applying it later', () => {
    const ctx = setup(); ctx.activity(); ctx.change('trk-label', 'Unwanted draft'); ctx.click('trk-cancel'); expect(ctx.edit._trackingEditor.draft).toBeNull();
    ctx.click('trk-add'); ctx.change('trk-entity', 'binary_sensor.motion'); ctx.click('tab', '[data-id="data"]');
    expect(ctx.edit._trackingEditor.draft).toBeNull(); ctx.tracking(); expect(ctx.edit.panel.querySelector('[data-act="trk-add"]')).toBeTruthy();
    expect(ctx.card._commit).not.toHaveBeenCalled(); ctx.assertNoHA();
  });
  it('saves one history entry and Undo/Redo restore config while cancelling an unsaved replacement draft', () => {
    const ctx = setup(); ctx.activity(); ctx.click('trk-save'); const saved = structuredClone(ctx.card._layout.presence_bindings);
    expect(ctx.card._history.size).toBe(1); ctx.click('trk-edit', '[data-index="0"]'); ctx.change('trk-label', 'Unsaved replacement'); ctx.click('history-undo');
    expect(ctx.edit._trackingEditor.draft).toBeNull(); expect(ctx.card._layout.presence_bindings).toBeUndefined();
    ctx.click('history-redo'); expect(ctx.card._layout.presence_bindings).toEqual(saved); ctx.assertNoHA();
  });
  it('Clear is undoable and never changes the actual source state', () => {
    const ctx = setup(); ctx.activity(); ctx.click('trk-save'); const before = ctx.card._hass.states['binary_sensor.motion'];
    ctx.click('trk-clear', '[data-index="0"]'); expect(ctx.card._layout.presence_bindings).toEqual([]); ctx.click('history-undo');
    expect(ctx.card._layout.presence_bindings).toHaveLength(1); expect(ctx.card._hass.states['binary_sensor.motion']).toBe(before); ctx.assertNoHA();
  });
  it('context/history cancellation drops drafts before a different layout can be edited', () => {
    const ctx = setup(); ctx.activity(); ctx.change('trk-label', 'Old layout idea', 'input'); ctx.edit.cancelHistoryGestures();
    expect(ctx.edit._trackingEditor.draft).toBeNull(); ctx.card._config.layout_key = 'another-layout'; ctx.edit.render();
    expect(ctx.edit.panel.querySelector('[data-act="trk-add"]')).toBeTruthy(); expect(ctx.edit.panel.textContent).not.toContain('Old layout idea'); ctx.assertNoHA();
  });
  it('detach cancels drafts but attach/enter keeps the same editor usable', () => {
    const ctx = setup(); ctx.activity(); const tracker = ctx.edit._trackingEditor; ctx.edit.detach();
    expect(tracker.draft).toBeNull(); expect(tracker.disposed).toBe(false); ctx.edit.enter();
    expect(ctx.edit._trackingEditor).toBe(tracker); ctx.click('trk-add'); ctx.change('trk-entity', 'binary_sensor.motion'); ctx.change('trk-room', 'lounge'); ctx.click('trk-save');
    expect(ctx.card._layout.presence_bindings).toHaveLength(1); ctx.assertNoHA();
  });
  it('permanent dispose freezes child editors and leaves late input unable to save', () => {
    const ctx = setup(); ctx.activity(); ctx.edit.dispose(); expect(ctx.edit._trackingEditor.disposed).toBe(true); expect(ctx.edit._trackingEditor.draft).toBeNull();
    ctx.edit._onPanelInput({ target: { value: 'late', dataset: { field: 'trk-label' } } });
    ctx.edit._onPanelClick({ target: ctx.edit.panel.querySelector('[data-act="trk-save"]') });
    expect(ctx.card._commit).not.toHaveBeenCalled(); ctx.assertNoHA();
  });
  it('preserves legacy device height, pin reset and Hide operations outside Tracking', () => {
    const ctx = setup(); ctx.activity(); ctx.click('tab', '[data-id="devices"]'); ctx.edit.selectedMarker = 'entity:light.lamp'; ctx.edit.render();
    ctx.change('marker-z', '1.7'); expect(ctx.card._layout.pins['entity:light.lamp']).toMatchObject({ x: 1, y: 2, z: 1.7, floor_id: 'ground' });
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.edit.render(); ctx.click('unpin'); expect(ctx.card._layout.pins['entity:light.lamp']).toBeUndefined();
    ctx.edit.render(); ctx.click('hide'); expect(ctx.card._layout.hidden).toContain('entity:light.lamp');
    expect(ctx.card._layout.presence_bindings).toBeUndefined(); ctx.assertNoHA();
  });
  it('switches vehicle/vacuum subforms deliberately and stores their separate additive arrays', () => {
    const ctx = setup(); ctx.tracking(); ctx.click('trk-section', '[data-section="vehicles"]'); ctx.click('trk-add');
    ctx.change('trk-entity', 'binary_sensor.car'); ctx.change('trk-vehicle-confirmed', true); ctx.change('trk-room', 'lounge'); ctx.click('trk-save');
    ctx.click('trk-section', '[data-section="vacuums"]'); ctx.click('trk-add'); ctx.change('trk-entity', 'vacuum.robot'); ctx.change('trk-location-mode', 'anchor'); ctx.change('trk-anchor', 'object:dock'); ctx.click('trk-save');
    expect(ctx.card._layout.vehicle_bindings[0]).toMatchObject({ kind: 'occupancy', entity: 'binary_sensor.car' });
    expect(ctx.card._layout.vacuum_bindings[0]).toMatchObject({ kind: 'static', entity: 'vacuum.robot', position_key: 'object:dock' }); ctx.assertNoHA();
  });
});
