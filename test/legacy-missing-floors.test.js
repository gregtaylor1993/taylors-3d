// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';
import { EditMode } from '../src/edit-mode.js';
import { markerPositions, roomFloorId } from '../src/layout.js';

const floors = [{ id: 'ground', name: 'Ground', height: 2.7, elevation: 0 }];
const room = { id: 'lounge', area_id: 'lounge', floor_id: 'removed-floor', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] };
const hass = { states: {}, entities: {}, devices: {}, areas: { lounge: { area_id: 'lounge', name: 'Lounge', floor_id: 'ground' } } };
const prototype = customElements.get('taylors3d-card').prototype;

function cardFixture(actualElement = false) {
  // The actual EditMode now owns DOM drag listeners. Its card must be a real
  // HTMLElement; pure root-method cases can retain their prototype fixture.
  return Object.assign(actualElement ? document.createElement('taylors3d-card') : Object.create(prototype), {
    _layout: { rooms: [room], mower: { entity: 'sensor.mower', floor_id: 'removed-floor', source: 'xy' } },
    _hass: hass, _config: {}, _floors: floors, _store: { backend: 'shared' },
    _view: { setTrail: vi.fn(), setMapOverlay: vi.fn() },
    _setCameraTimer: vi.fn(), _setImageTimer: vi.fn(), _buildMarkers: vi.fn(), _refreshAttached: vi.fn(),
    _objects: { setMowerPose: vi.fn() }, _positions: new Map(), _commit: vi.fn(),
  });
}

describe('missing explicit floor links keep their identity', () => {
  it('does not replace an explicit removed room floor with its area floor', () => {
    expect(roomFloorId(room, hass, floors)).toBe('removed-floor');
  });
  it('does not replace an area-owned removed floor with Ground when no room override exists', () => {
    expect(roomFloorId({ area_id: 'upstairs' }, { areas: { upstairs: { floor_id: 'removed-floor' } } }, floors)).toBe('removed-floor');
  });
  it('still gives an initially unassigned room the ordinary initial floor', () => {
    expect(roomFloorId({ area_id: 'unassigned' }, hass, floors)).toBe('ground');
  });
  it('keeps unresolvable automatic room markers out of the scene without modifying saved data', () => {
    const layout = { rooms: [room] }, before = JSON.stringify(layout);
    const positions = markerPositions([{ id: 'entity:light.lounge', areaId: 'lounge', domain: 'light' }], layout, hass, floors);
    expect(positions.size).toBe(0); expect(JSON.stringify(layout)).toBe(before);
  });
  it('keeps an explicit removed pin floor out of the scene instead of moving it to Ground', () => {
    const layout = { rooms: [], pins: { 'entity:light.lounge': { x: 1, y: 1, floor_id: 'removed-floor' } } };
    expect(markerPositions([{ id: 'entity:light.lounge' }], layout, hass, floors).size).toBe(0);
    expect(layout.pins['entity:light.lounge'].floor_id).toBe('removed-floor');
  });
  it('shows a missing room floor in its editor and refuses a forged replacement', () => {
    const card = cardFixture(true), edit = new EditMode(card); edit.selectedRoom = room.id; edit.render = vi.fn();
    edit.panel.innerHTML = edit._roomsTab();
    const selector = edit.panel.querySelector('[data-field="room-floor"]');
    expect(selector.value).toBe('removed-floor'); expect(selector.selectedOptions[0].textContent).toContain('Missing floor');
    selector.append(new Option('Forged', 'forged')); selector.value = 'forged';
    edit._onPanelChange({ target: selector }); expect(card._commit).not.toHaveBeenCalled();
  });
  it('keeps the saved mower floor ID and suppresses live position/trail/map on a missing floor', () => {
    const card = cardFixture();
    card._trail = [[1, 2]]; card._mowerLive = { x: 1, y: 2, floorId: 'ground' };
    expect(card._mowerFloor()).toBe('removed-floor');
    card._refreshMower(false);
    expect(card._mowerLive).toBeNull(); expect(card._trail).toEqual([]);
    expect(card._view.setTrail).toHaveBeenCalledWith(null);
    expect(card._view.setMapOverlay).toHaveBeenCalledWith(null);
    expect(card._setImageTimer).toHaveBeenCalledWith(0); expect(card._setCameraTimer).toHaveBeenCalledWith(0);
    expect(card._layout.mower.floor_id).toBe('removed-floor');
  });
  it('keeps every saved outline selectable when its HA area also has a model room', () => {
    const card = cardFixture(true);
    card._layout.rooms = [{ ...room, id: 'current-outline', floor_id: 'ground' }, room];
    card._modelRooms = [{ area_id: 'lounge' }];
    card._view.model = {};
    const edit = new EditMode(card);
    edit.panel.innerHTML = edit._roomsTab();
    const ids = [...edit.panel.querySelectorAll('[data-act="select-room"]')].map((button) => button.dataset.id);
    expect(ids).toEqual(['current-outline', room.id]);
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('does not restart a camera map timer on an unresolved saved floor', () => {
    const card = cardFixture(); card._layout.mower.overlay = { entity: 'camera.map' };
    card._hass = { ...hass, states: { 'camera.map': { state: 'idle', attributes: {} } } };
    card._refreshMapOverlay();
    expect(card._view.setMapOverlay).toHaveBeenCalledWith(null); expect(card._setCameraTimer).toHaveBeenCalledWith(0);
  });
});
