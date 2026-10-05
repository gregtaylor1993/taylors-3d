// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MiniMap, miniMapScene } from '../src/minimap.js';
import { buildAlerts } from '../src/status-overlays.js';
import { localize } from '../src/localization.js';

const floors = [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'upper', name: 'Upper', elevation: 3 }];
const rooms = floors.map((floor) => ({ floorId: floor.id, name: floor.name,
  room: { id: floor.id, floor_id: floor.id, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] } }));
const binding = { id: 'leak', type: 'leak', entity: 'binary_sensor.leak', location_mode: 'coordinates',
  floor_id: 'upper', x: 1.25, y: 2.75, z: .12 };
const source = (state = 'on', attributes = {}) => ({ state, attributes });
const data = (state = source(), extra = {}) => {
  const records = buildAlerts({ floors, rooms, bindings: [binding], states: { [binding.entity]: state } }).alerts;
  return { rooms, floors, visibleFloors: ['upper'], alertMarkers: records.map((record) => ({ ...record,
    id: `alert:${record.id}:1`, bindingId: record.id, generation: 1, selectable: !!state })), ...extra };
};
const maps = [];
function mount(initial = data()) {
  const host = document.createElement('div'); document.body.append(host);
  const stage = document.createElement('div'); host.attachShadow({ mode: 'open' }).append(stage);
  const onFocus = vi.fn(), onMarker = vi.fn(), map = new MiniMap(stage, { onFocus, onMarker });
  maps.push({ map, host }); map.update(initial); return { map, host, onFocus, onMarker };
}
const pointer = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));
const click = (node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const key = (node, type, value, repeat = false) => node.dispatchEvent(new KeyboardEvent(type, { key: value, repeat, bubbles: true }));
afterEach(() => { maps.splice(0).forEach(({ map, host }) => { map.dispose(); host.remove(); }); vi.restoreAllMocks(); });

describe('located mini-map alerts', () => {
  it('uses the canonical alert location rather than the ordinary sensor dot or a separated display offset', () => {
    const input = data(source(), { markers: [{ id: 'sensor-dot', entityId: binding.entity }],
      positions: new Map([['sensor-dot', { x: 3, y: 1, floorId: 'upper' }]]) });
    const before = JSON.stringify(input.alertMarkers), scene = miniMapScene(input);
    expect(scene.markers.find((marker) => marker.alert)).toMatchObject({ id: 'alert:leak:1',
      entityId: binding.entity, x: 1.25, y: 2.75, floorId: 'upper', active: true, icon: 'mdi:water-alert' });
    expect(scene.markers.find((marker) => marker.id === 'sensor-dot')).toMatchObject({ x: 3, y: 1 });
    expect(JSON.stringify(input.alertMarkers)).toBe(before);
  });

  it('shows uncertainty and a real retained latch, while a confirmed clear removes the alert symbol', () => {
    expect(miniMapScene(data(source('off'))).markers.filter((marker) => marker.alert)).toEqual([]);
    const waiting = miniMapScene(data(source('on', { restored: true }))).markers.find((marker) => marker.alert);
    expect(waiting).toMatchObject({ active: false, unavailable: true }); expect(waiting.name).toContain('Stored reading');
    const kept = buildAlerts({ floors, rooms, bindings: [{ ...binding, clear_rule: 'latched' }],
      states: { [binding.entity]: source('unavailable') }, previousLatches: { leak: true } }).alerts[0];
    const marker = miniMapScene(data(source(), { alertMarkers: [{ ...kept, id: 'alert:leak:1', selectable: true }] })).markers[0];
    expect(marker).toMatchObject({ alert: true, active: true, unavailable: true }); expect(marker.name).toContain('latched');
  });

  it.each(['missing', 'stale', 'duplicate', 'nonfinite', 'pending'])('does not guess Ground for a %s alert location', (kind) => {
    const input = data();
    if (kind === 'missing') input.floors = [floors[0]];
    if (kind === 'stale') input.floors = [floors[0], { ...floors[1], stale: true }];
    if (kind === 'duplicate') input.alertMarkers.push({ ...input.alertMarkers[0] });
    if (kind === 'nonfinite') input.alertMarkers[0].location.x = NaN;
    if (kind === 'pending') input.alertMarkers[0].location = null;
    expect(miniMapScene(input).markers.filter((marker) => marker.alert)).toEqual([]);
  });

  it('preserves tracking and security symbols, floor visibility and plain-text alert labels', () => {
    const input = data(); input.alertMarkers[0].label = '<img src=x onerror=bad()>: Leak detected';
    input.trackedMarkers = ['security:door:1', 'vehicle:drive'].map((id) => ({ id, entityId: 'binary_sensor.door',
      icon: id.startsWith('security') ? 'mdi:door-open' : 'mdi:car', position: { x: 2, y: 1, floorId: 'upper' }, active: true }));
    const { map } = mount(input); const alert = map.el.querySelector('.map-marker.alert');
    expect(map.scene.markers).toHaveLength(3); expect(alert.querySelector('.symbol').getAttribute('d')).toBeTruthy();
    expect(alert.getAttribute('aria-label')).toContain('<img'); expect(map.el.querySelector('img')).toBeNull();
    expect(map.el.querySelector('canvas')).toBeNull();
    map.update({ ...input, visibleFloors: ['ground'] }); expect(map.el.querySelector('.map-marker.alert')).toBeNull();
  });

  it('opens only current alert information; pointer and Enter/Space do not focus, acknowledge or command', () => {
    const { map, onFocus, onMarker } = mount(); const alert = map.el.querySelector('.map-marker.alert');
    expect(alert).toBeTruthy(); pointer(alert, 'pointerdown'); pointer(alert, 'pointerup'); click(alert);
    for (const value of ['Enter', ' ']) { key(alert, 'keydown', value); expect(onMarker).toHaveBeenCalledTimes(value === 'Enter' ? 1 : 2); key(alert, 'keyup', value); }
    expect(onMarker).toHaveBeenCalledTimes(3); expect(onFocus).not.toHaveBeenCalled();
    expect(onMarker).toHaveBeenLastCalledWith('alert:leak:1', expect.objectContaining({ alert: true, entityId: binding.entity, generation: 1 }));
  });

  it('keeps a focused alert and held key through locale/reading changes without repeating activation', () => {
    const { map, host, onMarker } = mount(); const alert = map.el.querySelector('.map-marker.alert'); alert.focus();
    key(alert, 'keydown', ' '); const input = data(source('unknown')); input.hass = { locale: { language: 'de' } }; map.update(input);
    expect(map.el.querySelector('.map-marker.alert')).toBe(alert); expect(host.shadowRoot.activeElement).toBe(alert);
    expect(alert.getAttribute('aria-label')).toBe(localize(input.hass, 'popup.entityControls', { name: input.alertMarkers[0].label })); key(alert, 'keydown', ' ', true); key(alert, 'keyup', ' ');
    expect(onMarker).toHaveBeenCalledOnce();
  });

  it.each(['pointer', 'Enter', ' '])('poisons a held %s across observed source loss/recovery until a fresh press', (kind) => {
    const { map, onFocus, onMarker } = mount(); const alert = map.el.querySelector('.map-marker.alert');
    if (kind === 'pointer') pointer(alert, 'pointerdown'); else key(alert, 'keydown', kind);
    const lost = data(undefined); lost.alertMarkers[0].selectable = false; map.update(lost); map.update(data());
    if (kind === 'pointer') { pointer(alert, 'pointerup'); click(alert); } else key(alert, 'keyup', kind);
    expect(onMarker).not.toHaveBeenCalled(); expect(onFocus).not.toHaveBeenCalled();
    const fresh = map.el.querySelector('.map-marker.alert');
    if (kind === 'pointer') { pointer(fresh, 'pointerdown'); pointer(fresh, 'pointerup'); click(fresh); }
    else { key(fresh, 'keydown', kind); key(fresh, 'keyup', kind); }
    expect(onMarker).toHaveBeenCalledOnce();
  });
});
