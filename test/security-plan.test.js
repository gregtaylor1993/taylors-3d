// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { normaliseSecurityBinding } from '../src/security.js';
import { buildPlanSecurity, PlanSecurityLayer } from '../src/security-plan.js';
import { displayLocatedRecords } from '../src/floor-presentation-adapters.js';
import { pointInPolygon } from '../src/placement.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 3 }];
const rooms = [{ room: { id: 'lounge', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }, floorId: 'ground', name: 'Lounge' }];
const target = { type: 'plan', position: { x: 1, y: 2, z: .4, floorId: 'upper' } };
const binding = (extra = {}) => ({ id: 'door', entity: 'binary_sensor.door', kind: 'door', open_states: ['on'], closed_states: ['off'], target, ...extra });
const lock = (extra = {}) => ({ id: 'lock', entity: 'lock.front', kind: 'lock', target, ...extra });
const state = (value, attributes = {}) => ({ state: value, attributes });
const hass = (contact = 'on', locked = 'unlocked') => ({ states: {
  'binary_sensor.door': state(contact, { device_class: 'door', friendly_name: 'Front contact' }), 'lock.front': state(locked, { friendly_name: 'Front lock' }),
}, entities: {} });
const build = (extra = {}) => buildPlanSecurity({ hass: hass(), bindings: [binding()], floors, rooms, now: NOW, ...extra });
function layerFixture(options) {
  const scene = new THREE.Scene(), onInvalidate = vi.fn(), layer = new PlanSecurityLayer(scene, { onInvalidate, ...options });
  return { scene, layer, onInvalidate };
}

describe('explicit plan targets and canonical location evidence', () => {
  it('validates one target without guessing a room, marker, floor or hinge', () => {
    expect(normaliseSecurityBinding(binding()).valid).toBe(true);
    const configs = [
      { target: { type: 'plan' } }, { object_id: 'old' }, { motion: {} },
      { target: { ...target, roomId: 'lounge' } }, { target: { type: 'model', object_id: 'a' } },
      { target: { ...target, position: { ...target.position, floorId: '' } } },
      { target: { ...target, position: { ...target.position, z: undefined } } },
      { target: { ...target, position: { ...target.position, x: '1' } } },
      { target: { ...target, position: { ...target.position, y: Infinity } } },
      { target: { ...target, position: { ...target.position, x: 1000001 } } },
      { target: { type: 'plan', position_key: 'marker', z: 1 } }, { target: { type: 'plan', roomId: 'lounge', z: 1001 } },
    ];
    for (const config of configs) expect(normaliseSecurityBinding(binding(config)).valid).toBe(false);
  });
  it('keeps source coordinates and produces labelled source mini-map records', () => {
    const data = build();
    expect(data.records[0]).toMatchObject({ location: { x: 1, y: 2, z: .4, elevation: 3, floorId: 'upper' }, active: true, open: true, locked: null, color: '#ef5350', shown: true });
    expect(data.miniMap[0]).toMatchObject({ id: 'security:door', entityId: 'binary_sensor.door', name: 'Front contact: Open', status: 'open', active: true, position: { x: 1, y: 2, elevation: 3 } });
    expect(data.diagnostics).toEqual([]);
  });
  it('uses the exact chosen room outline and a declared decorative height', () => {
    const data = build({ bindings: [binding({ target: { type: 'plan', roomId: 'lounge', z: .2 } })] });
    expect(data.records[0].location).toEqual({ x: 2, y: 1.5, z: .2, floorId: 'ground', elevation: 0 });
    const concave = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
    const record = build({ rooms: [{ room: { id: 'lounge', polygon: concave, floor_id: 'ground' } }], bindings: [binding({ target: { type: 'plan', roomId: 'lounge' } })] }).records[0];
    expect(pointInPolygon([record.location.x, record.location.y], concave)).toBe(true);
  });
  it('uses only the exact marker anchor and ignores stale embedded display elevation', () => {
    const positions = new Map([['marker:actual', { x: 7, y: -2, z: 1.5, floorId: 'upper', elevation: 999 }], ['binary_sensor.door', target.position]]);
    const data = build({ positions, bindings: [binding({ target: { type: 'plan', position_key: 'marker:actual' } })] });
    expect(data.records[0].location).toEqual({ x: 7, y: -2, z: 1.5, floorId: 'upper', elevation: 3 });
    const missing = build({ positions, bindings: [binding({ target: { type: 'plan', position_key: 'marker:removed' } })] });
    expect(missing.records[0]).toMatchObject({ location: null, shown: false }); expect(missing.miniMap).toEqual([]);
    expect(missing.diagnostics.some((d) => d.code === 'missing_anchor')).toBe(true);
  });
  it.each([
    [{ id: 'ground', elevation: 0 }], [{ id: 'upper', elevation: 3 }, { id: 'upper', elevation: 4 }],
    [{ id: 'upper', elevation: 3, stale: true }], [{ id: 'upper', elevation: NaN }],
  ])('does not replace a missing/ambiguous/stale floor %j with a lower one', (...items) => {
    const supplied = items.length === 1 && Array.isArray(items[0]) ? items[0] : items;
    const data = build({ floors: supplied }); expect(data.records[0]).toMatchObject({ location: null, shown: false });
    expect(data.diagnostics.some((d) => d.code === 'missing_floor')).toBe(true);
  });
  it('rejects conflicting floor constraints, duplicate rooms and prototype-only anchors', () => {
    const constrained = build({ bindings: [binding({ target: { type: 'plan', roomId: 'lounge', floorId: 'upper' } })] });
    expect(constrained.records[0].location).toBeNull();
    expect(build({ rooms: [...rooms, rooms[0]], bindings: [binding({ target: { type: 'plan', roomId: 'lounge' } })] }).records[0].location).toBeNull();
    const positions = Object.create({ marker: { x: 1, y: 2, z: .4, floorId: 'upper' } });
    expect(build({ positions, bindings: [binding({ target: { type: 'plan', position_key: 'marker' } })] }).records[0].location).toBeNull();
  });
  it('respects current room/floor/marker visibility while retaining canonical diagnostics', () => {
    expect(build({ visibleFloors: ['ground'] }).records[0]).toMatchObject({ shown: false, location: target.position });
    expect(build({ floors: [{ ...floors[1], shown: false }] }).miniMap).toEqual([]);
    expect(build({ rooms: [{ ...rooms[0], shown: false }], bindings: [binding({ target: { type: 'plan', roomId: 'lounge' } })] }).records[0].shown).toBe(false);
    expect(build({ positions: { marker: { ...target.position, shown: false } }, bindings: [binding({ target: { type: 'plan', position_key: 'marker' } })] }).records[0].shown).toBe(false);
  });
  it('rejects conflicting IDs across model/plan targets and enforces the whole-list budget', () => {
    const model = { ...binding(), target: undefined, object_id: 'real-door' };
    expect(build({ bindings: [binding(), model] }).records).toEqual([]);
    expect(build({ bindings: Array.from({ length: 257 }, (_, i) => binding({ id: `door-${i}` })) }).records).toEqual([]);
    expect(build({ bindings: { door: binding() } }).diagnostics[0].code).toBe('bindings');
    expect(build({ now: NaN }).records).toEqual([]);
  });
  it('does not choose an enabled plan source when a disabled or invalid saved row has the same ID', () => {
    for (const other of [binding({ enabled: false }), binding({ target: { type: 'plan', roomId: 'lounge', position_key: 'marker' } })]) {
      const data = build({ bindings: [binding(), other] }); expect(data.records).toEqual([]);
      expect(data.diagnostics.some((item) => item.code === 'duplicate_binding')).toBe(true);
    }
  });
  it('does not mutate imported targets, arrays, source locations or mini-map coordinates', () => {
    const raw = binding({ target: { ...target, position: { ...target.position }, future: { keep: true } } });
    const saved = structuredClone(raw), inputRooms = structuredClone(rooms), data = build({ bindings: [raw], rooms: inputRooms });
    data.miniMap[0].position.x = 999;
    expect(data.records[0].location.x).toBe(1); expect(raw).toEqual(saved); expect(inputRooms).toEqual(rooms);
  });
});

describe('plan security actual state and source age', () => {
  it.each([
    ['locked', false, true, null], ['unlocked', true, false, '#ef5350'], ['locking', null, null, '#8d9199'],
    ['unlocking', null, null, '#8d9199'], ['jammed', null, null, '#8d9199'], ['unavailable', null, null, '#8d9199'],
  ])('shows %s without claiming a door opened', (value, active, locked, color) => {
    const record = build({ hass: hass('off', value), bindings: [lock()] }).records[0];
    expect(record).toMatchObject({ status: value, active, locked, color, open: null, shown: true });
  });
  it('labels missing/restored/invalid readings neutrally and excludes registry-hidden sources', () => {
    const raw = lock();
    expect(build({ hass: {}, bindings: [raw] }).records[0]).toMatchObject({ status: 'missing', active: null, locked: null, color: '#8d9199', shown: true });
    const ha = hass(); ha.states['lock.front'].attributes.restored = true;
    expect(build({ hass: ha, bindings: [raw] }).records[0]).toMatchObject({ status: 'unavailable', active: null, color: '#8d9199' });
    ha.states['lock.front'].attributes.restored = 'false'; expect(build({ hass: ha, bindings: [raw] }).records[0]).toMatchObject({ status: 'invalid', active: null });
    delete ha.states['lock.front'].attributes.restored; ha.entities['lock.front'] = { hidden_by: 'user' };
    expect(build({ hass: ha, bindings: [raw] }).records[0]).toMatchObject({ active: null, shown: false });
    expect(build({ hass: ha, bindings: [raw] }).miniMap).toEqual([]);
  });
  it('clears contacts only on the chosen closed states and allows an explicit closed colour', () => {
    expect(build({ hass: hass('off') }).records[0]).toMatchObject({ color: null, active: false, status: 'closed' });
    expect(build({ hass: hass('unreported') }).records[0]).toMatchObject({ color: '#8d9199', active: null, status: 'unknown' });
    expect(build({ hass: hass('off'), bindings: [binding({ highlight: { closed: '#008000' } })] }).records[0].color).toBe('#008000');
  });
  it('returns the nearest absolute configured deadline, with no timers or inferred heartbeat', () => {
    const ha = hass(); ha.states['binary_sensor.door'].attributes.observed = NOW - 1000; ha.states['lock.front'].attributes.observed = NOW - 2000;
    const age = { timestamp_mode: 'attribute', timestamp_attr: 'observed', timestamp_format: 'milliseconds', max_age_seconds: 5 };
    const data = build({ hass: ha, bindings: [binding({ freshness: age }), lock({ freshness: age })] });
    expect(data.nextExpiry).toBe(NOW + 3000);
    const expired = build({ hass: ha, bindings: [binding({ freshness: age }), lock({ freshness: age })], now: NOW + 3000 });
    expect(expired.records.find((record) => record.kind === 'lock')).toMatchObject({ status: 'stale', active: null, color: '#8d9199' });
    expect(expired.nextExpiry).toBe(NOW + 4000); expect(build().nextExpiry).toBeNull();
  });
});

describe('owned static helpers and existing source/display adapter', () => {
  it('renders source world coordinates north=-Z and applies separation exactly once', () => {
    const { layer, scene } = layerFixture(), data = build();
    layer.setData(data); expect(layer.parts.get('door').group.position.toArray()).toEqual([1, 3.4, -2]);
    const report = { valid: true, mode: 'horizontal', rows: [{ floor_id: 'upper', offset: [10, 2, -4] }] };
    layer.setData({ records: displayLocatedRecords(data.records, report, floors) });
    expect(layer.parts.get('door').group.position.toArray()).toEqual([11, 5.4, -6]);
    expect(data.records[0].location).toEqual({ ...target.position, elevation: 3 });
    expect(data.miniMap[0].position).toEqual({ ...target.position, elevation: 3 });
    expect(scene.children).toEqual([layer.group]); layer.dispose();
  });
  it('stays idle for empty/clear/equal cloned or irrelevant readings and reuses resources', () => {
    const { layer, onInvalidate } = layerFixture();
    expect(layer.setData({})).toBe(false); expect(layer.setClippingPlanes([])).toBe(false);
    expect(layer.setData(build({ hass: hass('off') }))).toBe(false); expect(onInvalidate).not.toHaveBeenCalled();
    layer.setData(build()); const part = layer.parts.get('door'), resources = [part.group, part.glyph.geometry, part.ring.geometry, part.lineMaterial, part.ringMaterial, part.label.element];
    const versions = [part.lineMaterial.version, part.ringMaterial.version]; onInvalidate.mockClear();
    const ha = hass(); ha.states['sensor.unrelated'] = state('123');
    expect(layer.setData(structuredClone(build({ hass: ha })))).toBe(false);
    expect(layer.setData(build({ hass: ha }))).toBe(false); expect(layer.update(2000)).toBe(false);
    const same = layer.parts.get('door'); expect([same.group, same.glyph.geometry, same.ring.geometry, same.lineMaterial, same.ringMaterial, same.label.element]).toEqual(resources);
    expect([part.lineMaterial.version, part.ringMaterial.version]).toEqual(versions); expect(onInvalidate).not.toHaveBeenCalled(); layer.dispose();
  });
  it('updates actual state, colour and location only when visible semantics change', () => {
    const { layer, onInvalidate } = layerFixture(); layer.setData(build()); onInvalidate.mockClear();
    expect(layer.setData(build({ hass: hass('unknown') }))).toBe(true); expect(layer.parts.get('door').ringMaterial.color.getHexString()).toBe('8d9199');
    expect(layer.setData(build({ bindings: [binding({ target: { ...target, position: { ...target.position, x: 8 } } })] }))).toBe(true);
    expect(layer.parts.get('door').group.position.x).toBe(8); expect(onInvalidate).toHaveBeenCalledTimes(2); layer.dispose();
  });
  it('composes finite cloned Section planes, hides clipped labels and detects mutated planes', () => {
    const { layer, onInvalidate } = layerFixture(); layer.setData(build());
    const part = layer.parts.get('door'), plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 3);
    expect(layer.setClippingPlanes([plane])).toBe(true); expect(part.group.visible).toBe(false); expect(part.label.element.hidden).toBe(true);
    expect(part.ringMaterial.clippingPlanes[0]).not.toBe(plane); expect(part.glyph.material.clippingPlanes[0]).not.toBe(plane);
    onInvalidate.mockClear(); expect(layer.setClippingPlanes([plane])).toBe(false); expect(onInvalidate).not.toHaveBeenCalled();
    plane.constant = 4; expect(layer.setClippingPlanes([plane])).toBe(true); expect(part.group.visible).toBe(true);
    expect(() => layer.setClippingPlanes([{}])).toThrow(TypeError); layer.dispose();
  });
  it('keeps hidden updates quiet and resumes the latest known state without animation', () => {
    const { layer, onInvalidate } = layerFixture(); layer.setData(build()); expect(layer.setVisible(false)).toBe(true); onInvalidate.mockClear();
    expect(layer.setData(build({ hass: hass('unknown') }))).toBe(false); expect(onInvalidate).not.toHaveBeenCalled();
    expect(layer.setVisible(true)).toBe(true); expect(layer.parts.get('door').ringMaterial.color.getHexString()).toBe('8d9199');
    expect(layer.moving).toBe(false); expect(layer.update(10)).toBe(false); layer.dispose();
  });
  it('preserves focused native buttons and current labels across semantic updates', () => {
    const onSelect = vi.fn(), { layer, scene } = layerFixture({ onSelect }), renderer = new CSS2DRenderer(), camera = new THREE.PerspectiveCamera();
    document.body.append(renderer.domElement); renderer.setSize(600, 400); camera.position.set(1, 8, 10); camera.lookAt(1, 3, -2); camera.updateMatrixWorld();
    layer.setData(build()); renderer.render(scene, camera);
    const part = layer.parts.get('door'), button = part.body; button.focus(); expect(document.activeElement).toBe(button);
    layer.setData(build({ hass: hass('unknown') })); expect(part.body).toBe(button); expect(document.activeElement).toBe(button); expect(button.title).toContain('State unknown');
    expect(button.style.minHeight).toBe('44px'); expect(button.getAttribute('aria-label')).toContain('State unknown'); button.click(); expect(onSelect).toHaveBeenCalledWith('door');
    layer.setData({ ...build(), selectable: false }); button.click(); expect(onSelect).toHaveBeenCalledOnce();
    layer.dispose(); button.click(); expect(onSelect).toHaveBeenCalledOnce(); renderer.domElement.remove();
  });
  it('never picks helper meshes, allocates lights or disposes external scene resources', () => {
    const { layer, scene } = layerFixture(), externalGeometry = new THREE.BoxGeometry(), externalMaterial = new THREE.MeshStandardMaterial(), external = new THREE.Mesh(externalGeometry, externalMaterial);
    scene.add(external); const externalDisposals = [vi.spyOn(externalGeometry, 'dispose'), vi.spyOn(externalMaterial, 'dispose')];
    const data = build({ bindings: [binding(), lock()] }); layer.setData(data);
    const part = layer.parts.get('door'), ray = new THREE.Raycaster(new THREE.Vector3(1, 10, -2), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(layer.group, true)).toEqual([]); layer.group.traverse((node) => { expect(node.isLight).not.toBe(true); expect(node.castShadow).toBe(false); });
    expect(part.ring.geometry).toBe(layer.parts.get('lock').ring.geometry);
    const owned = [layer.ringGeometry, ...layer.geometries.values(), ...[...layer.parts.values()].flatMap((value) => [value.ringMaterial, value.lineMaterial])].map((value) => vi.spyOn(value, 'dispose'));
    layer.dispose(); layer.dispose(); owned.forEach((spy) => expect(spy).toHaveBeenCalledOnce()); externalDisposals.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(scene.children).toEqual([external]); expect(layer.setData(data)).toBe(false); expect(layer.setVisible(true)).toBe(false);
  });
  it('removes deleted/duplicate/invalid compiled records without resurrecting labels or geometry', () => {
    const { layer } = layerFixture(); const data = build(); layer.setData(data);
    const part = layer.parts.get('door'), disposals = [vi.spyOn(part.lineMaterial, 'dispose'), vi.spyOn(part.ringMaterial, 'dispose')];
    expect(layer.setData({ records: [data.records[0], data.records[0]] })).toBe(true); expect(layer.parts.size).toBe(0);
    disposals.forEach((spy) => expect(spy).toHaveBeenCalledOnce()); expect(part.label.element.isConnected).toBe(false);
    expect(layer.setData({ records: [{ ...data.records[0], location: { ...data.records[0].location, x: NaN } }] })).toBe(false); layer.dispose();
  });
  it('poisons a held pointer intent when the same binding ID changes source, even after it recovers', () => {
    const onSelect = vi.fn(), { layer } = layerFixture({ onSelect }); layer.setData(build());
    const button = layer.parts.get('door').body; button.dispatchEvent(new Event('pointerdown'));
    const ha = hass(); ha.states['binary_sensor.other'] = state('on', { device_class: 'door' });
    layer.setData(build({ hass: ha, bindings: [binding({ entity: 'binary_sensor.other' })] })); layer.setData(build());
    button.click(); expect(onSelect).not.toHaveBeenCalled();
    button.dispatchEvent(new Event('pointerdown')); button.click(); expect(onSelect).toHaveBeenCalledOnce(); layer.dispose();
  });
  it('poisons held keyboard/source-loss intents through recovery until a fresh deliberate press', () => {
    const onSelect = vi.fn(), { layer } = layerFixture({ onSelect }); layer.setData(build()); const button = layer.parts.get('door').body;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); layer.setData({ ...build(), selectable: false }); layer.setData(build());
    button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })); button.click(); expect(onSelect).not.toHaveBeenCalled();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); layer.setData(build({ hass: hass('unavailable') })); layer.setData(build());
    button.click(); expect(onSelect).not.toHaveBeenCalled();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); button.click(); expect(onSelect).toHaveBeenCalledOnce();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true })); button.click(); expect(onSelect).toHaveBeenCalledOnce(); layer.dispose();
  });
  it('rejects a held gesture after a context change and ignores a removed button when its ID is reused', () => {
    const onSelect = vi.fn(), { layer } = layerFixture({ onSelect }); layer.setData({ ...build(), contextKey: 'session:a' });
    const button = layer.parts.get('door').body; button.dispatchEvent(new Event('pointerdown'));
    layer.setData({ ...build(), contextKey: 'session:b' }); layer.setData({ ...build(), contextKey: 'session:a' });
    button.click(); expect(onSelect).not.toHaveBeenCalled();
    layer.setData({ records: [] }); layer.setData(build()); button.dispatchEvent(new Event('pointerdown')); button.click();
    expect(onSelect).not.toHaveBeenCalled(); const fresh = layer.parts.get('door').body;
    fresh.dispatchEvent(new Event('pointerdown')); fresh.click(); expect(onSelect).toHaveBeenCalledWith('door'); layer.dispose();
  });
});
