// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MiniMap } from '../src/minimap.js';
import { translateFloorCamera } from '../src/floor-presentation-adapters.js';

const maps = [];
const floors = [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'upper', name: 'Upper', elevation: 3 }];
const report = { mode: 'horizontal', valid: true, rows: [{ floor_id: 'ground', offset: [0, 0, 0] }, { floor_id: 'upper', offset: [10, -3, 0] }] };
const rooms = floors.map((floor) => ({ floorId: floor.id, room: { id: floor.id, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] } }));
const camera = { position: [12, 8, -2], target: [12, 0, -2] };
function mount(options = {}) {
  const stage = document.createElement('div'); document.body.append(stage);
  const map = new MiniMap(stage, options); maps.push(map); return map;
}
afterEach(() => { for (const map of maps.splice(0)) map.dispose(); document.body.replaceChildren(); });
describe('mini-map selected-floor camera adapter', () => {
  it('asks the adapter for the selected source floor after an actual dropdown change', () => {
    const cameraForFloor = vi.fn((snapshot, id) => ({ ...snapshot, camera: translateFloorCamera(snapshot.camera, report, id, floors, { toSource: true }) }));
    const map = mount({ cameraForFloor }); map.update({ floors, rooms, visibleFloors: 'all', camera, mode: '3d' });
    map.select.value = 'upper'; map.select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(cameraForFloor).toHaveBeenLastCalledWith(expect.objectContaining({ camera }), 'upper');
    expect(map._camera.focus).toEqual([2, 2]); expect(map.scene.rooms[0].polygon[0]).toEqual([0, 0]);
  });
  it('updates the displayed camera arrow without replacing source room DOM', () => {
    const map = mount({ cameraForFloor: (snapshot, id) => ({ ...snapshot, camera: translateFloorCamera(snapshot.camera, report, id, floors, { toSource: true }) }) });
    map.update({ floors, rooms, visibleFloors: ['upper'], camera, mode: '3d' });
    const room = map.el.querySelector('[data-room="upper"]');
    map.updateCamera({ camera: { position: [13, 8, -2], target: [13, 0, -2] }, mode: '3d' });
    expect(map._camera.focus).toEqual([3, 2]); expect(map.el.querySelector('[data-room="upper"]')).toBe(room);
  });
  it('uses exact canonical plan metres when a displayed mini-map room is selected', () => {
    const onFocus = vi.fn(), callService = vi.fn();
    const map = mount({ onFocus, cameraForFloor: (snapshot) => snapshot });
    map.update({ floors, rooms, visibleFloors: ['upper'], camera, mode: '3d' });
    const room = map.el.querySelector('[data-room="upper"]');
    room.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onFocus).toHaveBeenCalledWith(expect.objectContaining({ x: 2, y: 2, floorId: 'upper', roomId: 'upper' }));
    expect(callService).not.toHaveBeenCalled();
  });
  it('hides an unresolved camera indicator instead of showing a guessed source position', () => {
    const map = mount({ cameraForFloor: () => ({ mode: '3d', camera: null }) });
    map.update({ floors, rooms, visibleFloors: ['upper'], camera, mode: '3d' });
    expect(map.cameraLayer.getAttribute('visibility')).toBe('hidden');
  });
  it('preserves ordinary camera behavior when no adapter is configured', () => {
    const map = mount(); map.update({ floors, rooms, visibleFloors: ['upper'], camera, mode: '3d' });
    expect(map._camera.focus).toEqual([12, 2]);
  });
});
