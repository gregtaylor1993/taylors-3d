// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildAlerts } from '../src/status-overlays.js';
import { displayLocatedRecords } from '../src/floor-presentation-adapters.js';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 4 }];
const rooms = [{ room: { id: 'kitchen', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }, floorId: 'ground' }];
const source = { state: 'on', attributes: { device_class: 'smoke' } };
const base = { id: 'warning', entity: 'binary_sensor.smoke', type: 'smoke', roomId: 'kitchen' };
const positions = new Map([
  [base.entity, { x: 8, y: 9, z: 1.2, floorId: 'upper' }],
  ['device:exact', { x: 3, y: 7, z: 1.5, floorId: 'upper', shown: true }],
]);
const read = (binding, context = {}) => buildAlerts({ floors, rooms, positions, states: { [base.entity]: source }, bindings: [binding], ...context }).alerts[0];

describe('explicit alert SOURCE locations retain legacy behavior separately', () => {
  it('retains automatic entity priority for an unchanged legacy binding', () => {
    expect(read(base).location).toEqual({ x: 8, y: 9, z: 1.2, floorId: 'upper', elevation: 4 });
  });
  it('uses the exact room centre when Room is explicit, even with an entity pin and stale override extras', () => {
    expect(read({ ...base, location_mode: 'room', position_key: 'device:exact', x: 99, y: 88, floorId: 'upper' }).location)
      .toEqual({ x: 2, y: 2, z: .12, floorId: 'ground', elevation: 0 });
  });
  it('uses only the selected marker and its canonical source floor, then a deliberate exact override', () => {
    const binding = { ...base, location_mode: 'marker', position_key: 'device:exact' };
    expect(read(binding).location).toEqual({ x: 3, y: 7, z: 1.5, floorId: 'upper', elevation: 4 });
    expect(read({ ...binding, floor_id: 'ground' }).location).toEqual({ x: 3, y: 7, z: 1.5, floorId: 'ground', elevation: 0 });
  });
  it.each([
    { location_mode: 'marker', position_key: 'device:missing' },
    { location_mode: 'marker', position_key: '' },
    { location_mode: 'marker', position_key: 'device:exact', markerId: 'device:other' },
    { location_mode: 'marker', position_key: 'device:exact', floor_id: 'missing' },
    { location_mode: 'coordinates', x: 1, y: 2, z: .4, floor_id: 'missing' },
    { location_mode: 'coordinates', x: '1', y: 2, z: .4, floor_id: 'ground' },
    { location_mode: 'coordinates', x: 1, y: false, z: .4, floor_id: 'ground' },
    { location_mode: 'coordinates', x: 1, y: 2, floor_id: 'ground' },
    { location_mode: 'coordinates', x: 1, y: 2, z: .4, floorId: 'upper', floor_id: 'ground' },
    { location_mode: 'room', roomId: 'missing' },
    { location_mode: 'saved_unknown' },
  ])('does not substitute another entity, room or floor for invalid explicit settings %j', (extra) => {
    const result = read({ ...base, ...extra });
    expect(result.location).toBeNull(); expect(result.shown).toBe(false); expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  it('rejects ambiguous current floors/rooms/markers and does not guess finite elevation zero', () => {
    const marker = { ...base, location_mode: 'marker', position_key: 'device:exact' };
    expect(read(marker, { positions: new Map([...positions, ['device:exact', null]]) }).location).toBeNull();
    expect(read(marker, { floors: [...floors, { id: 'upper', elevation: 5 }] }).location).toBeNull();
    expect(read(marker, { floors: [{ id: 'upper' }] }).location).toBeNull();
    expect(read({ ...base, location_mode: 'room' }, { rooms: [...rooms, structuredClone(rooms[0])] }).location).toBeNull();
  });
  it('respects an exact marker visibility without allowing an unrelated saved room to hide or relocate it', () => {
    const binding = { ...base, location_mode: 'marker', position_key: 'device:exact' };
    expect(read(binding, { rooms: [{ ...rooms[0], shown: false }] }).shown).toBe(true);
    expect(read(binding, { positions: new Map([...positions, ['device:exact', { ...positions.get('device:exact'), shown: false }]]) }).shown).toBe(false);
    expect(read({ ...base, location_mode: 'room' }, { rooms: [{ ...rooms[0], shown: false }] })).toMatchObject({ shown: false, location: { x: 2, y: 2 } });
  });
  it('keeps explicit coordinates canonical and applies the display split exactly once to a copy', () => {
    const binding = { ...base, location_mode: 'coordinates', x: -3, y: 2, z: 1.1, floor_id: 'upper', vendor: { keep: true } };
    const original = structuredClone(binding), alert = read(binding);
    expect(alert.location).toEqual({ x: -3, y: 2, z: 1.1, floorId: 'upper', elevation: 4 });
    const display = displayLocatedRecords([alert], { valid: true, mode: 'horizontal', rows: [{ floor_id: 'upper', offset: [9, -4, -2] }] }, floors)[0];
    expect(display.location).toEqual({ x: 6, y: 4, z: 1.1, floorId: 'upper', elevation: 0 });
    expect(alert.location.x).toBe(-3); expect(binding).toEqual(original);
  });
});

beforeAll(async () => { await import('../src/taylors3d-card.js'); });
function cardFixture(bindings = []) {
  const card = document.createElement('taylors3d-card');
  card._config = {}; card._layout = { alert_bindings: bindings }; card._floors = structuredClone(floors); card._roomList = structuredClone(rooms);
  card._hass = { states: { [base.entity]: source }, entities: {}, callService: vi.fn() };
  card._view = { floorElevation: (id) => floors.find((floor) => floor.id === id)?.elevation };
  card._navigationRooms = () => card._roomList; card._navigationFloors = () => 'all';
  card._markers = [{ id: 'device:exact', entityId: base.entity, entities: [] }];
  card._positions = new Map([['device:exact', { x: 3, y: 7, z: 1.5, floorId: 'upper' }]]);
  card._statusOverlays = { setData: vi.fn(), group: { visible: true } }; card._objects = null; card._statusLegend = document.createElement('div');
  card.trackingAnchors = vi.fn(() => [{ id: 'device:exact', label: 'Exact marker', position: { ...card._positions.get('device:exact'), shown: true } }]);
  return card;
}
describe('actual card alert canonical anchor bridge', () => {
  it('registers exact current marker IDs and retains SOURCE data while rendering one display offset with no commands', () => {
    const card = cardFixture([{ ...base, location_mode: 'marker', position_key: 'device:exact' }]);
    card._floorPresentationReportValue = { valid: true, mode: 'horizontal', rows: [{ floor_id: 'upper', offset: [9, -4, -2] }] };
    card._syncStatus();
    expect(card._alertData.alerts[0].location).toEqual({ x: 3, y: 7, z: 1.5, floorId: 'upper', elevation: 4 });
    expect(card._statusOverlays.setData.mock.calls[0][0].alerts[0].location).toEqual({ x: 12, y: 9, z: 1.5, floorId: 'upper', elevation: 0 });
    expect(card._positions.get('device:exact').x).toBe(3); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('does not resolve an exact duplicate anchor to an arbitrary survivor or entity fallback', () => {
    const card = cardFixture([{ ...base, location_mode: 'marker', position_key: 'device:exact' }]);
    const entry = card.trackingAnchors()[0]; card.trackingAnchors.mockReturnValue([entry, { ...entry, position: { ...entry.position, x: 40 } }]);
    card._syncStatus(); expect(card._alertData.alerts[0].location).toBeNull(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});

const editors = [];
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); });
function nativeEditor() {
  const host = document.createElement('div'), shadow = host.attachShadow({ mode: 'open' }), stage = document.createElement('div');
  shadow.append(stage); document.body.append(host);
  const card = Object.assign(document.createElement('div'), { _stage: stage, _config: { layout_key: 'source-only' },
    _layout: { version: 1, rooms: rooms.map((entry) => structuredClone(entry.room)), pins: {}, hidden: [], floors: [], mower: {}, alert_bindings: [] },
    _floors: structuredClone(floors), _roomList: structuredClone(rooms), _markers: [], _positions: new Map(),
    _hass: { user: { id: 'admin', is_admin: true, is_active: true }, connected: true, connection: { connected: true },
      states: { [base.entity]: structuredClone(source) }, entities: {}, areas: {}, devices: {}, callService: vi.fn(), callWS: vi.fn() },
    _view: { model: null, setControlsEnabled: vi.fn(), setOverlay: vi.fn(), setStems: vi.fn(), setPivotMarker: vi.fn() },
    _built: {}, _store: { backend: 'browser' }, _editing: true, _history: new EditHistory(), _applyMarkerSelection: vi.fn(),
    trackingAnchors: () => [{ id: 'device:exact', label: 'Exact smoke marker', position: { x: 3, y: 7, z: 1.5, floorId: 'upper' } }],
  });
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  const edit = new EditMode(card); card._edit = edit; edit.tab = 'overlays';
  card._commit = vi.fn((next) => { card._layout = next; card._history.record(snapshot(), 'Alert placement'); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch) => card._commit({ ...card._layout, ...patch }));
  card.undoEdit = () => { const value = card._history.undo(); if (value) { card._layout = value.layout; edit.render(); } };
  card.redoEdit = () => { const value = card._history.redo(); if (value) { card._layout = value.layout; edit.render(); } };
  stage.append(edit.panel); edit.render(); editors.push(edit);
  const click = (action) => { const target = edit.panel.querySelector(`[data-act="${action}"]`); expect(target).toBeTruthy(); target.click(); };
  const change = (field, value, type = 'change') => { const target = edit.panel.querySelector(`[data-field="${field}"]`); expect(target).toBeTruthy(); target.value = value; target.dispatchEvent(new Event(type, { bubbles: true, composed: true })); return target; };
  click('ovr-add-alert'); change('ovr-alert-entity', base.entity); change('ovr-alert-location', 'coordinates'); change('ovr-alert-x', '1'); change('ovr-alert-y', '2'); change('ovr-alert-z', '.7'); change('ovr-alert-floor', 'upper');
  return { card, edit, shadow, click, change };
}
describe('alert location through the actual shadow-root EditMode', () => {
  it('delegates decimal input and one Save/history step, Undo/Redo and Cancel with no HA calls', () => {
    const { card, edit, change, click } = nativeEditor(); const input = change('ovr-alert-x', '1.20', 'input'); input.focus();
    card._hass.states[base.entity].state = 'off'; edit.onStates(); expect(input.value).toBe('1.20'); expect(edit._overlayEditor.draftAlert.x).toBe('1.20');
    click('ovr-save-alert'); expect(card._layout.alert_bindings[0]).toMatchObject({ location_mode: 'coordinates', x: 1.2, y: 2, z: .7, floor_id: 'upper' });
    expect(card._commit).toHaveBeenCalledOnce(); click('history-undo'); expect(card._layout.alert_bindings).toEqual([]); click('history-redo'); expect(card._layout.alert_bindings[0].x).toBe(1.2);
    click('ovr-edit-alert'); change('ovr-alert-x', '9', 'input'); click('ovr-cancel-alert'); expect(card._layout.alert_bindings[0].x).toBe(1.2);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('keeps the real focused decimal control through a registry-driven parent refresh', () => {
    const { card, edit, shadow, change } = nativeEditor(); const input = change('ovr-alert-x', '1.20', 'input'); input.focus();
    card._hass.entities = { unrelated: { entity_id: 'sensor.new' } }; edit.afterUpdate();
    expect(edit.panel.querySelector('[data-field="ovr-alert-x"]')).toBe(input); expect(shadow.activeElement).toBe(input); expect(input.value).toBe('1.20'); expect(card._commit).not.toHaveBeenCalled();
  });
  it.each(['source', 'connection', 'role'])('rejects an observed held Save through %s loss/recovery, then accepts one fresh press', (kind) => {
    const { card, edit } = nativeEditor(); const button = edit.panel.querySelector('[data-act="ovr-save-alert"]');
    button.focus(); button.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    const original = card._hass.states[base.entity];
    if (kind === 'source') delete card._hass.states[base.entity]; else if (kind === 'connection') card._hass.connection.connected = false; else card._hass.user.is_admin = false;
    edit.onStates();
    if (kind === 'source') card._hass.states[base.entity] = original; else if (kind === 'connection') card._hass.connection.connected = true; else card._hass.user.is_admin = true;
    edit.onStates(); button.dispatchEvent(new Event('pointerup', { bubbles: true, composed: true })); button.click(); expect(card._commit).not.toHaveBeenCalled();
    const fresh = edit.panel.querySelector('[data-act="ovr-save-alert"]'); fresh.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true })); fresh.click();
    expect(card._commit).toHaveBeenCalledOnce(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
});
