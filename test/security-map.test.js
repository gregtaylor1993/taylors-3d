// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPlanSecurity } from '../src/security-plan.js';
import { MiniMap, miniMapScene } from '../src/minimap.js';

const floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 4 }];
const rooms = floors.map((floor) => ({ room: { id: 'room-' + floor.id, polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]] }, floorId: floor.id }));
const binding = (id, entity, floorId = 'upper') => ({ id, entity, kind: entity.startsWith('lock.') ? 'lock' : 'door',
  ...(entity.startsWith('lock.') ? {} : { open_states: ['on'], closed_states: ['off'] }),
  target: { type: 'plan', position: { x: .75, y: 1.25, z: .2, floorId } } });
const maps = [];
afterEach(() => { maps.splice(0).forEach((map) => map.dispose()); document.body.replaceChildren(); });
function data(state = 'unlocked') {
  const built = buildPlanSecurity({ hass: { states: { 'lock.entrance': { state, attributes: { friendly_name: 'Entrance lock' } } } },
    bindings: [binding('entrance', 'lock.entrance')], floors, rooms });
  return { rooms, floors, visibleFloors: 'all', trackedMarkers: built.miniMap };
}

describe('plan security symbols on the existing north-up map', () => {
  it('uses canonical source coordinates and exact floor with a real lock symbol and evidence colour', () => {
    const scene = miniMapScene(data(), { floorId: 'upper' });
    expect(scene.markers).toHaveLength(1);
    expect(scene.markers[0]).toMatchObject({ id: 'security:entrance', entityId: 'lock.entrance', x: .75, y: 1.25,
      floorId: 'upper', active: true, icon: 'mdi:lock-open-variant-outline', color: '#ef5350', status: 'unlocked' });
    expect(miniMapScene(data(), { floorId: 'ground' }).markers).toEqual([]);
    const [east, north] = scene.transform.toSvg([.75, 1.25]), [originEast, originNorth] = scene.transform.toSvg([0, 0]);
    expect(east).toBeGreaterThan(originEast); expect(north).toBeLessThan(originNorth);
  });
  it('keeps clear and uncertain evidence distinct instead of inferring that a lock opens a door', () => {
    const locked = miniMapScene(data('locked'), { floorId: 'upper' }).markers[0];
    const jammed = miniMapScene(data('jammed'), { floorId: 'upper' }).markers[0];
    expect(locked).toMatchObject({ active: false, icon: 'mdi:lock-outline', status: 'locked' });
    expect(jammed).toMatchObject({ active: false, status: 'jammed', color: '#8d9199' });
    expect(jammed.name.toLowerCase()).toContain('jammed');
  });
  it('opens the exact entity from an accessible SVG button and retains focus through current state changes', () => {
    const stage = document.createElement('div'); document.body.append(stage); const onMarker = vi.fn();
    const map = new MiniMap(stage, { onMarker }); maps.push(map); map.update(data());
    map.select.value = 'upper'; map.select.dispatchEvent(new Event('change', { bubbles: true }));
    const node = map.el.querySelector('[data-marker="security:entrance"]'); expect(node).toBeTruthy();
    expect(node.querySelector('.symbol').getAttribute('d')).not.toBe(''); node.focus();
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onMarker).toHaveBeenCalledWith('security:entrance', expect.objectContaining({ entityId: 'lock.entrance', floorId: 'upper', tracked: true }));
    map.update(data('jammed')); expect(map.el.querySelector('[data-marker="security:entrance"]')).toBe(node);
    expect(document.activeElement).toBe(node); expect(node.getAttribute('aria-label').toLowerCase()).toContain('jammed');
    map.update({ ...data(), trackedMarkers: [] }); node.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(onMarker).toHaveBeenCalledTimes(1);
  });
  it('replaces only a single-source ordinary dot, without dropping a device with another actual entity', () => {
    const value = { ...data(), positions: new Map([['lock-dot', { x: .75, y: 1.25, floorId: 'upper' }], ['device', { x: 0, y: 0, floorId: 'upper' }]]),
      markers: [{ id: 'lock-dot', entityId: 'lock.entrance' }, { id: 'device', entityId: 'lock.entrance', secondaryId: 'binary_sensor.contact' }] };
    expect(miniMapScene(value, { floorId: 'upper' }).markers.map((record) => record.id)).toEqual(['device', 'security:entrance']);
  });
});
