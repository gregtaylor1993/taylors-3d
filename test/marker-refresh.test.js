// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FloorplanView } from '../src/view.js';
import { EditMode } from '../src/edit-mode.js';

beforeAll(async () => { await import('../src/taylors3d-card.js'); });

function fixture() {
  const card = document.createElement('taylors3d-card');
  card._config = { group_by: 'device' };
  card._layout = { rooms: [{ id: 'kitchen', area_id: 'kitchen', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }], hidden: [], pins: {} };
  card._hass = { areas: { kitchen: { area_id: 'kitchen', floor_id: 'ground' } },
    devices: { lamp: { id: 'lamp', name: 'Kitchen lamp', area_id: 'kitchen' } },
    entities: { 'light.kitchen': { device_id: 'lamp' } }, states: { 'light.kitchen': { state: 'off', attributes: {} } } };
  card._floors = [{ id: 'ground', elevation: 0, height: 2.7 }];
  card._devicePopup = { close: vi.fn() };
  card._view = { dirty: false, floorElevation: (id) => card._floors.find((floor) => floor.id === id)?.elevation,
    setControlsEnabled: vi.fn(),
    setMarkers: vi.fn(() => { card._view.dirty = true; }), setMarkerStates: FloorplanView.prototype.setMarkerStates,
    _applyFloorVisibility: vi.fn() };
  return card;
}

describe('visible marker updates and idle rendering', () => {
  it('keeps visible marker DOM and the idle scene when an unrelated unplaced state-only sensor appears', () => {
    const card = fixture(); card._buildMarkers(); const el = card._markerEls.get('device:lamp');
    card._view.dirty = false;
    card._hass.states = { ...card._hass.states, 'sensor.unplaced': { state: '10', attributes: { unit_of_measurement: 'W' } } };
    card._buildMarkers();
    expect(card._markers.some((marker) => marker.entityId === 'sensor.unplaced')).toBe(true);
    expect(card._positions.has('entity:sensor.unplaced')).toBe(false);
    expect(card._view.setMarkers).toHaveBeenCalledTimes(1);
    expect(card._markerEls.get('device:lamp')).toBe(el); expect(card._view.dirty).toBe(false);
  });

  it('still recreates visible markers when grouping membership changes, keeping captured controls current', () => {
    const card = fixture(); card._buildMarkers(); const el = card._markerEls.get('device:lamp');
    card._hass.entities = { ...card._hass.entities, 'camera.kitchen': { device_id: 'lamp' } };
    card._hass.states = { ...card._hass.states, 'camera.kitchen': { state: 'idle', attributes: {} } };
    card._buildMarkers();
    expect(card._view.setMarkers).toHaveBeenCalledTimes(2); expect(card._markerEls.get('device:lamp')).not.toBe(el);
    expect(card._markers.find((marker) => marker.id === 'device:lamp').entities.map((entry) => entry.eid)).toContain('camera.kitchen');
  });
  it('restores a cancelled drag preview when reloading an identical saved layout', () => {
    const card = fixture(), visible = new Map();
    card._view.setMarkers = vi.fn((list) => { visible.clear(); for (const marker of list) visible.set(marker.id, { ...marker }); });
    card._buildMarkers(); const saved = visible.get('device:lamp').x;
    // EditMode's drag previews move the view without committing new saved positions.
    visible.get('device:lamp').x = 999;
    const edit = new EditMode(card); edit.cancelHistoryGestures();
    card._layout = structuredClone(card._layout); card._buildMarkers();
    expect(card._positions.get('device:lamp').x).toBe(saved);
    expect(visible.get('device:lamp').x).toBe(saved); expect(card._view.setMarkers).toHaveBeenCalledTimes(2);
  });

  it('updates marker placement for changed floor elevation and removes genuinely hidden markers', () => {
    const card = fixture(); card._buildMarkers();
    card._floors = [{ ...card._floors[0], elevation: 3 }]; card._buildMarkers();
    expect(card._view.setMarkers).toHaveBeenCalledTimes(2);
    card._layout = { ...card._layout, hidden: ['device:lamp'] }; card._buildMarkers();
    expect(card._view.setMarkers).toHaveBeenLastCalledWith([]); expect(card._markerEls.size).toBe(0);
  });

  it('invalidates marker visibility only for actual shown/faded changes, including in-place mutation', () => {
    const view = { dirty: false, _applyFloorVisibility: vi.fn() };
    const set = FloorplanView.prototype.setMarkerStates;
    const first = new Map([['lamp', { shown: true, faded: false }]]);
    set.call(view, first); view.dirty = false;
    set.call(view, new Map([['lamp', { shown: true, faded: false }]])); expect(view.dirty).toBe(false);
    first.get('lamp').faded = true; set.call(view, first); expect(view.dirty).toBe(true); view.dirty = false;
    first.get('lamp').shown = false; set.call(view, first); expect(view.dirty).toBe(true); view.dirty = false;
    set.call(view, null); expect(view.dirty).toBe(true); view.dirty = false;
    set.call(view, null); expect(view.dirty).toBe(false);
  });
});
