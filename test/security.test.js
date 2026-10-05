import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import { normaliseSecurityBinding, readSecurityContact, SecurityLayer } from '../src/security.js';

const NOW = Date.parse('2026-10-05T10:00:00Z');
const source = (value = 'on', attributes = {}) => ({ state: value, attributes: { device_class: 'door', ...attributes }, last_changed: '2020-01-01T00:00:00Z', last_updated: '2020-01-01T00:00:00Z' });
const hass = (value = 'on', attributes = {}) => ({ states: { 'binary_sensor.front_door': source(value, attributes) }, entities: {} });
const binding = (extra = {}) => ({ id: 'front', entity: 'binary_sensor.front_door', object_id: 'front_door', kind: 'door', open_states: ['on'], closed_states: ['off'], ...extra });
const motion = (extra = {}) => ({ target: 'leaf', pivot: [0, 0, 0], axis: [0, 1, 0], closed_degrees: 0, open_degrees: 90, duration_ms: 200, ...extra });
function fixture() {
  const root = new THREE.Group(), level = new THREE.Group(), object = new THREE.Group();
  level.userData.fp = { kind: 'level', id: 'ground' }; object.userData.fp = { kind: 'object', id: 'front_door', type: 'door' };
  const geometry = new THREE.BoxGeometry(2, 2, .1), texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture });
  const frame = new THREE.Mesh(geometry, material), leaf = new THREE.Mesh(geometry, material);
  leaf.name = 'leaf'; frame.name = 'frame'; leaf.position.set(1, 1, 0);
  root.add(level); level.add(object); object.add(frame, leaf); root.updateMatrixWorld(true);
  return { model: { id: 'house', root, manifest: buildManifest(threeAdapter(root)) }, root, level, object, leaf, frame, geometry, material, texture };
}
const layerFor = (f = fixture(), options) => { const layer = new SecurityLayer(options); layer.setModel(f.model); return { ...f, layer }; };
const data = (extra = {}) => ({ hass: hass(), bindings: [binding({ motion: motion() })], now: NOW, animationNow: 0, ...extra });
const closeVector = (actual, expected) => actual.toArray().forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
const lockBinding = (extra = {}) => ({ id: 'front-lock', entity: 'lock.front_door', object_id: 'front_door', kind: 'lock', ...extra });
const lockHass = (value, attributes = {}) => ({ states: { 'lock.front_door': { state: value, attributes } }, entities: {} });

describe('lock evidence is separate from an opening contact', () => {
  it('accepts an exact lock target without inventing contact state lists or a hinge', () => {
    expect(normaliseSecurityBinding(lockBinding())).toMatchObject({ valid: true, motion: null });
    expect(normaliseSecurityBinding(lockBinding({ motion: motion() })).valid).toBe(false);
    expect(normaliseSecurityBinding(lockBinding({ entity: 'binary_sensor.front_door' })).valid).toBe(false);
  });
  it.each([
    ['locked', true, false], ['unlocked', false, true], ['locking', null, null], ['unlocking', null, null], ['jammed', null, null],
  ])('reads %s honestly and never supplies a door-open angle', (state, locked, active) => {
    expect(readSecurityContact(lockHass(state), lockBinding(), { now: NOW })).toMatchObject({ status: state, locked, active, open: null, shown: true });
  });
  it.each(['unknown', 'unavailable', 'open', 'off'])('does not convert %s into a locked or closed door', (state) => {
    const reading = readSecurityContact(lockHass(state), lockBinding(), { now: NOW });
    expect(reading).toMatchObject({ open: null, locked: null, active: null, shown: true });
    expect(reading.status).not.toBe('locked');
  });
  it('uses only current lock evidence and preserves explicit heartbeat deadlines', () => {
    const raw = lockBinding({ freshness: { timestamp_mode: 'attribute', timestamp_attr: 'observed', timestamp_format: 'milliseconds', max_age_seconds: 5 } });
    const ha = lockHass('unlocked', { observed: NOW - 2000 });
    expect(readSecurityContact(ha, raw, { now: NOW })).toMatchObject({ active: true, locked: false, open: null, nextExpiry: NOW + 3000 });
    expect(readSecurityContact(ha, raw, { now: NOW + 3000 })).toMatchObject({ status: 'stale', active: null, locked: null, open: null });
    expect(readSecurityContact(lockHass('unlocked', { restored: true }), lockBinding(), { now: NOW })).toMatchObject({ status: 'unavailable', active: null, locked: null });
  });
  it('allows model locks to highlight and clear without moving authored transforms', () => {
    const { layer, leaf } = layerFor(), authored = leaf.position.clone();
    expect(layer.setData(data({ hass: lockHass('unlocked'), bindings: [lockBinding()] }))).toBe(true);
    const part = layer.parts.get('front-lock');
    expect(part.lines.every((line) => line.visible)).toBe(true); expect(part.color).toBe('#ef5350');
    expect(part.target).toBeNull(); expect(layer.moving).toBe(false); expect(leaf.position.equals(authored)).toBe(true);
    layer.setData(data({ hass: lockHass('locking'), bindings: [lockBinding()] })); expect(part.color).toBe('#8d9199');
    layer.setData(data({ hass: lockHass('locked'), bindings: [lockBinding()] })); expect(part.lines.every((line) => !line.visible)).toBe(true);
    expect(layer.takeMotionChanges().movementChanged).toBe(false); layer.dispose();
  });
  it('ignores a valid plan target in the model adapter and still rejects duplicate IDs across targets', () => {
    const { layer } = layerFor();
    const plan = { ...binding(), object_id: undefined, target: { type: 'plan', position: { x: 1, y: 2, z: .12, floorId: 'ground' } } };
    expect(normaliseSecurityBinding(plan).valid).toBe(true);
    expect(layer.setData(data({ bindings: [plan] }))).toBe(false); expect(layer.diagnostics).toEqual([]);
    layer.setData(data({ bindings: [binding(), plan] }));
    expect(layer.parts.size).toBe(0); expect(layer.diagnostics.some((item) => item.code === 'duplicate_binding')).toBe(true); layer.dispose();
  });
  it('does not activate a substitute model binding with the same saved ID as a disabled or malformed plan binding', () => {
    const { layer } = layerFor();
    for (const other of [
      { ...binding(), object_id: undefined, enabled: false, target: { type: 'plan', position: { x: 1, y: 2, z: .12, floorId: 'ground' } } },
      { ...binding(), object_id: undefined, target: { type: 'plan', roomId: 'removed', position_key: 'other' } },
    ]) {
      layer.setData(data({ bindings: [binding(), other] }));
      expect(layer.parts.size).toBe(0); expect(layer.diagnostics.some((item) => item.code === 'duplicate_binding')).toBe(true);
    }
    layer.dispose();
  });
});

describe('explicit contact configuration and HA evidence', () => {
  it('does not supply open/closed states, moving parts or hinge angles by guessing', () => {
    expect(normaliseSecurityBinding(binding({ open_states: undefined })).valid).toBe(false);
    expect(normaliseSecurityBinding(binding()).motion).toBeNull();
    expect(normaliseSecurityBinding(binding({ motion: { target: 'leaf' } })).valid).toBe(false);
    expect(normaliseSecurityBinding(binding({ motion: motion() })).motion).toEqual(motion());
  });
  it.each([
    { id: 'bad ID' }, { entity: 'lock.front_door' }, { kind: 'lock' }, { object_id: '../door' }, { enabled: 'yes' },
    { open_states: ['on'], closed_states: ['on'] }, { open_states: ['unknown'] }, { closed_states: ['off', 'off'] },
    { highlight: null }, { highlight: { open: null } }, { highlight: { opacity: NaN } }, { highlight: { mode: 'emissive' } },
    { motion: null }, { motion: motion({ target: '../leaf' }) }, { motion: motion({ axis: [0, 0, 0] }) },
    { motion: motion({ pivot: ['0', 0, 0] }) }, { motion: motion({ open_degrees: Infinity }) }, { motion: motion({ duration_ms: -1 }) },
  ])('rejects malformed explicit settings %j', (invalid) => {
    expect(normaliseSecurityBinding(binding(invalid)).valid).toBe(false);
  });
  it('normalizes a tiny finite axis without numerical underflow and does not mutate saved arrays', () => {
    const cfg = binding({ motion: motion({ axis: [0, 1e-300, 0] }) }), copy = structuredClone(cfg);
    expect(normaliseSecurityBinding(cfg).motion.axis).toEqual([0, 1, 0]); expect(cfg).toEqual(copy);
  });
  it('reads maintained contact states without expiring their old HA change time', () => {
    expect(readSecurityContact(hass(), binding(), { now: NOW })).toMatchObject({ status: 'open', open: true, shown: true, verified: false, nextExpiry: null });
    expect(readSecurityContact(hass('off'), binding(), { now: NOW })).toMatchObject({ status: 'closed', open: false, shown: true });
    expect(readSecurityContact(hass('closed'), binding({ open_states: ['open'], closed_states: ['closed'] }), { now: NOW }).open).toBe(false);
  });
  it.each(['door', 'window', 'opening', 'garage_door'])('accepts the actual contact device class %s', (device_class) => {
    expect(readSecurityContact(hass('on', { device_class }), binding(), { now: NOW }).open).toBe(true);
  });
  it.each(['lock', 'motion', 'occupancy', 'presence'])('cannot turn %s into open-door evidence with confirmation', (device_class) => {
    expect(readSecurityContact(hass('on', { device_class }), binding({ contact_source_confirmed: true }), { now: NOW })).toMatchObject({ status: 'contact_class', open: null, shown: false });
  });
  it('requires deliberate confirmation for an unclassified real contact', () => {
    const ha = hass('on', { device_class: undefined });
    expect(readSecurityContact(ha, binding(), { now: NOW }).open).toBeNull();
    expect(readSecurityContact(ha, binding({ contact_source_confirmed: true }), { now: NOW }).open).toBe(true);
  });
  it.each(['unknown', 'unavailable', 'not-reported'])('does not call %s a closed door', (value) => {
    expect(readSecurityContact(hass(value), binding(), { now: NOW })).toMatchObject({ open: null, shown: true });
  });
  it('rejects restored, missing and registered-without-state readings', () => {
    expect(readSecurityContact(hass('on', { restored: true }), binding(), { now: NOW })).toMatchObject({ status: 'unavailable', open: null });
    expect(readSecurityContact({}, binding(), { now: NOW })).toMatchObject({ status: 'missing', shown: false, open: null });
    expect(readSecurityContact({ entities: { 'binary_sensor.front_door': {} } }, binding(), { now: NOW })).toMatchObject({ status: 'unavailable', shown: false, open: null });
  });
  it.each(['true', 'false', 0, null, [], {}].map((value) => [value]))('does not turn malformed restored metadata %j into contact evidence', (restored) => {
    expect(readSecurityContact(hass('on', { restored }), binding(), { now: NOW })).toMatchObject({ status: 'invalid', open: null, shown: true });
  });
  it.each([{ hidden: true }, { hidden_by: 'user' }, { disabled_by: 'user' }, { entity_category: 'diagnostic' }, { entity_category: 'config' }])('honors registry visibility/availability %j', (entry) => {
    const ha = hass(); ha.entities['binary_sensor.front_door'] = entry;
    expect(readSecurityContact(ha, binding(), { now: NOW })).toMatchObject({ shown: false, open: null });
  });
  it('honors disabled devices and registry device classes when a state lacks one', () => {
    const ha = hass('on', { device_class: undefined });
    ha.entities['binary_sensor.front_door'] = { device_id: 'door-device', original_device_class: 'door' };
    expect(readSecurityContact(ha, binding(), { now: NOW }).open).toBe(true);
    ha.devices = { 'door-device': { disabled_by: 'user' } };
    expect(readSecurityContact(ha, binding(), { now: NOW })).toMatchObject({ status: 'disabled', open: null });
  });
  it('expires only an explicitly chosen heartbeat, and rejects malformed freshness settings', () => {
    const cfg = binding({ freshness: { timestamp_mode: 'attribute', timestamp_attr: 'measured_at', timestamp_format: 'milliseconds', max_age_seconds: 5 } });
    const ha = hass('on', { measured_at: NOW - 2000 });
    expect(readSecurityContact(ha, cfg, { now: NOW })).toMatchObject({ open: true, verified: true, nextExpiry: NOW + 3000 });
    expect(readSecurityContact(ha, cfg, { now: NOW + 3000 })).toMatchObject({ status: 'stale', open: null, shown: true });
    for (const freshness of [null, false, 'wrong', []]) expect(readSecurityContact(ha, binding({ freshness }), { now: NOW })).toMatchObject({ status: 'invalid', open: null });
  });
});

describe('owned outlines and exact model resolution', () => {
  it('requires a tagged object ID; plain node names and detached supplied nodes do not match', () => {
    const f = fixture(); delete f.object.userData.fp; f.object.name = 'front_door';
    f.model.manifest = buildManifest(threeAdapter(f.root));
    const layer = new SecurityLayer(); layer.setModel(f.model, { objectNodes: new Map([['front_door', new THREE.Group()]]) });
    expect(layer.setData(data())).toBe(false); expect(layer.parts.size).toBe(0);
    expect(layer.diagnostics[0].code).toBe('missing_object'); layer.dispose();
  });
  it('detects duplicate raw object tags even when the manifest omits the second ID', () => {
    const f = fixture(), duplicate = f.object.clone(); f.level.add(duplicate);
    f.model.manifest = buildManifest(threeAdapter(f.root)); expect(f.model.manifest.objects).toHaveLength(1);
    const { layer } = layerFor(f); expect(layer.setData(data())).toBe(false);
    expect(layer.diagnostics.some((d) => d.code === 'ambiguous_object')).toBe(true); layer.dispose();
  });
  it('rejects both duplicate binding IDs and repeated object selections', () => {
    const { layer, leaf } = layerFor();
    for (const bindings of [[binding(), binding()], [binding(), binding({ id: 'other' })]]) {
      expect(layer.setData(data({ bindings }))).toBe(false); expect(layer.parts.size).toBe(0);
      expect(layer.diagnostics.filter((d) => d.code === 'duplicate_binding')).toHaveLength(2);
    }
    closeVector(leaf.position, [1, 1, 0]); layer.dispose();
  });
  it('highlights independently when a moving-part path is missing or ambiguous', () => {
    const { layer, leaf, object } = layerFor(); const duplicate = leaf.clone(); object.add(duplicate);
    expect(layer.setData(data())).toBe(true); expect(layer.parts.get('front').target).toBeNull();
    expect(layer.diagnostics.some((d) => d.code === 'ambiguous_target')).toBe(true);
    layer.setData(data({ bindings: [binding({ motion: motion({ target: 'does-not-exist' }) })] }));
    expect(layer.diagnostics.some((d) => d.code === 'missing_target')).toBe(true); expect(layer.moving).toBe(false); layer.dispose();
  });
  it('uses exact relative child paths and original GLTF names, never a deep first-name search', () => {
    const f = fixture(), assembly = new THREE.Group(); assembly.name = 'assembly'; f.object.remove(f.leaf); assembly.add(f.leaf); f.object.add(assembly);
    f.leaf.userData.name = 'moving:leaf'; f.leaf.name = 'movingleaf';
    const { layer } = layerFor(f);
    layer.setData(data({ bindings: [binding({ motion: motion({ target: 'moving:leaf' }) })] }));
    expect(layer.parts.get('front').target).toBeNull();
    layer.setData(data({ bindings: [binding({ motion: motion({ target: 'assembly/moving:leaf' }) })], reducedMotion: true }));
    expect(layer.parts.get('front').target).toBe(f.leaf); expect(layer.diagnostics).toEqual([]); layer.dispose();
  });
  it('owns only outline resources and does not mutate or dispose shared original materials/geometry/textures', () => {
    const { layer, leaf, frame, material, geometry, texture } = layerFor();
    const originals = [material, geometry, texture].map((r) => vi.spyOn(r, 'dispose'));
    layer.setData(data({ bindings: [binding()] })); const part = layer.parts.get('front');
    expect(leaf.material).toBe(material); expect(frame.material).toBe(material); expect(material.map).toBe(texture);
    expect(part.lines).toHaveLength(2); expect(part.material).not.toBe(material); expect(part.material.depthTest).toBe(true);
    part.lines.forEach((line) => { expect(line.userData.helper).toBe(true); expect(line.castShadow).toBe(false); expect(line.geometry).not.toBe(geometry); });
    const owned = [part.material, ...part.lines.map((l) => l.geometry)].map((r) => vi.spyOn(r, 'dispose'));
    layer.setData({}); layer.dispose(); layer.dispose(); owned.forEach((s) => expect(s).toHaveBeenCalledOnce()); originals.forEach((s) => expect(s).not.toHaveBeenCalled());
    expect(leaf.children).toEqual([]); expect(frame.children).toEqual([]);
  });
  it('keeps helpers nonpickable and adds no actual lights or model reparenting', () => {
    const { layer, object, leaf, root } = layerFor(); layer.setData(data({ bindings: [binding()] }));
    const ray = new THREE.Raycaster(new THREE.Vector3(1, 1, 10), new THREE.Vector3(0, 0, -1));
    for (const line of layer.parts.get('front').lines) expect(ray.intersectObject(line)).toEqual([]);
    expect(leaf.parent).toBe(object); expect(root.children).toHaveLength(1);
    root.traverse((node) => expect(node.isLight).not.toBe(true)); layer.dispose();
  });
  it('preserves original local clipping, supplies cloned security planes and detects mutable plane changes', () => {
    const { layer, material } = layerFor(); const original = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2); material.clippingPlanes = [original];
    layer.setData(data({ bindings: [binding()] })); const section = new THREE.Plane(new THREE.Vector3(1, 0, 0), 3);
    expect(layer.setClippingPlanes([original, section])).toBe(true);
    const own = layer.parts.get('front').material.clippingPlanes;
    expect(own[0]).not.toBe(original); expect(own[1]).not.toBe(section); expect(material.clippingPlanes).toEqual([original]);
    expect(layer.setClippingPlanes([original, section])).toBe(false);
    section.constant = 4; expect(layer.setClippingPlanes([original, section])).toBe(true); expect(own[1].constant).toBe(3);
    expect(() => layer.setClippingPlanes([{}])).toThrow(TypeError); layer.dispose();
  });
  it('leaves semantically unchanged and unrelated HA updates idle, reusing owned resources', () => {
    const invalidate = vi.fn(), { layer } = layerFor(fixture(), { onInvalidate: invalidate });
    layer.setData(data({ reducedMotion: true })); layer.takeMotionChanges(); invalidate.mockClear();
    const part = layer.parts.get('front'), geometry = part.lines[0].geometry, color = vi.spyOn(part.material.color, 'set');
    for (let i = 0; i < 5; i++) {
      const ha = hass(); ha.states['sensor.unrelated'] = { state: String(i), attributes: {} };
      expect(layer.setData(data({ hass: ha, animationNow: 100 + i, reducedMotion: true }))).toBe(false);
    }
    expect(invalidate).not.toHaveBeenCalled(); expect(color).not.toHaveBeenCalled(); expect(layer.parts.get('front')).toBe(part);
    expect(part.lines[0].geometry).toBe(geometry); expect(layer.takeMotionChanges().movementChanged).toBe(false); layer.dispose();
  });
  it('rejects empty/oversized geometry and excessive binding counts without touching original resources', () => {
    for (const invalid of ['empty', 'oversized']) {
      const f = fixture(), geometry = new THREE.BufferGeometry();
      if (invalid === 'oversized') geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(100001 * 3), 3));
      f.leaf.geometry = geometry; const { layer } = layerFor(f), dispose = vi.spyOn(geometry, 'dispose');
      expect(layer.setData(data())).toBe(false); expect(layer.parts.size).toBe(0); expect(layer.diagnostics.some((d) => d.code === 'outline_geometry')).toBe(true);
      expect(dispose).not.toHaveBeenCalled(); layer.dispose();
    }
    const { layer, leaf } = layerFor(); layer.setData(data({ reducedMotion: true }));
    layer.setData(data({ bindings: Array.from({ length: 257 }, () => binding()) }));
    expect(layer.diagnostics[0].code).toBe('bindings'); expect(layer.parts.size).toBe(0); closeVector(leaf.position, [1, 1, 0]); layer.dispose();
  });
});

describe('explicit authored hinge motion and lifecycle', () => {
  it('rotates around the parent-local pivot and preserves authored rotation, scale and hierarchy', () => {
    const f = fixture(); f.root.position.set(10, 3, 7); f.root.rotation.y = .7; f.root.scale.setScalar(2);
    f.leaf.rotation.z = .4; f.leaf.scale.set(-2, 1.5, .7); f.root.updateMatrixWorld(true);
    const authored = f.leaf.quaternion.clone(), parent = f.leaf.parent;
    const { layer } = layerFor(f); layer.setData(data({ reducedMotion: true }));
    closeVector(f.leaf.position, [0, 1, -1]); closeVector(f.leaf.scale, [-2, 1.5, .7]);
    const expected = authored.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    expect(f.leaf.quaternion.angleTo(expected)).toBeCloseTo(0, 8); expect(f.leaf.parent).toBe(parent);
    const expectedWorld = parent.localToWorld(new THREE.Vector3(0, 1, -1)); closeVector(f.leaf.getWorldPosition(new THREE.Vector3()), expectedWorld.toArray());
    const changes = layer.takeMotionChanges(); expect(changes.movementChanged).toBe(true); expect([...changes.changedMotionTargets]).toEqual([f.leaf]);
    expect(layer.takeMotionChanges()).toEqual({ movementChanged: false, changedMotionTargets: new Set() }); layer.dispose();
  });
  it('uses an explicit non-origin hinge and signed closed/open offsets instead of treating zero as measured closed', () => {
    const { layer, leaf } = layerFor(); const b = binding({ motion: motion({ pivot: [1, 0, 0], open_degrees: -90, closed_degrees: 20 }) });
    layer.setData(data({ bindings: [b], reducedMotion: true })); closeVector(leaf.position, [1, 1, 0]);
    expect(layer.parts.get('front').degrees).toBe(-90);
    layer.setData(data({ bindings: [b], hass: hass('off'), reducedMotion: true })); expect(layer.parts.get('front').degrees).toBe(20);
    layer.setData(data({ bindings: [b], hass: hass('unknown') })); expect(layer.parts.get('front').degrees).toBe(0); closeVector(leaf.quaternion, [0, 0, 0, 1]); layer.dispose();
  });
  it('supports an explicitly selected tagged object itself without moving its floor or changing its parent', () => {
    const { layer, object, level } = layerFor(); object.position.set(2, 0, 0); object.rotation.x = .3; object.updateMatrix();
    const authored = object.quaternion.clone();
    layer.setData(data({ bindings: [binding({ motion: motion({ target: '.' }) })], reducedMotion: true }));
    closeVector(object.position, [0, 0, -2]); closeVector(level.position, [0, 0, 0]); expect(object.parent).toBe(level);
    closeVector(object.quaternion, authored.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)).toArray());
    layer.dispose(); closeVector(object.position, [2, 0, 0]); expect(object.quaternion.equals(authored)).toBe(true);
  });
  it('surfaces the nearest real heartbeat expiry and neutralizes stale motion without an HA state change', () => {
    const { layer, leaf } = layerFor(); const b = binding({ motion: motion(), freshness: { timestamp_mode: 'attribute', timestamp_attr: 'measured_at', timestamp_format: 'milliseconds', max_age_seconds: 5 } });
    const ha = hass('on', { measured_at: NOW - 2000 }); layer.setData(data({ hass: ha, bindings: [b], reducedMotion: true }));
    expect(layer.nextExpiry).toBe(NOW + 3000); expect(layer.parts.get('front').reading.open).toBe(true);
    layer.takeMotionChanges(); layer.setData(data({ hass: ha, bindings: [b], now: NOW + 3000, animationNow: 3000 }));
    expect(layer.nextExpiry).toBeNull(); expect(layer.parts.get('front').reading).toMatchObject({ status: 'stale', open: null });
    expect(layer.moving).toBe(false); closeVector(leaf.position, [1, 1, 0]); expect(layer.takeMotionChanges().movementChanged).toBe(true); layer.dispose();
  });
  it('reverses from the current pose without snapping or restarting on repeated source states', () => {
    const { layer } = layerFor(); layer.setData(data()); expect(layer.moving).toBe(true);
    layer.update(100); expect(layer.parts.get('front').degrees).toBeCloseTo(45);
    layer.setData(data({ animationNow: 100 })); expect(layer.parts.get('front').tween.start).toBe(0);
    layer.setData(data({ hass: hass('off'), animationNow: 100 })); expect(layer.parts.get('front').degrees).toBeCloseTo(45);
    expect(layer.parts.get('front').tween).toMatchObject({ from: 45, to: 0, start: 100 });
    expect(layer.parts.get('front').lines.every((line) => !line.visible)).toBe(true); // Closed outline is optional; closing motion still runs.
    layer.update(200); expect(layer.parts.get('front').degrees).toBeCloseTo(22.5);
    layer.update(300); expect(layer.moving).toBe(false); expect(layer.parts.get('front').degrees).toBe(0);
    layer.takeMotionChanges(); expect(layer.update(400)).toBe(false);
    expect(layer.setData(data({ hass: hass('unknown'), animationNow: 400 }))).toBe(true); // Grey evidence only, no geometry change.
    expect(layer.takeMotionChanges().movementChanged).toBe(false); layer.dispose();
  });
  it('starts a mid-flight reversal at the actual current time even without an intervening frame', () => {
    const { layer } = layerFor(); layer.setData(data());
    layer.setData(data({ hass: hass('off'), animationNow: 100 }));
    expect(layer.parts.get('front').tween.from).toBeCloseTo(45); layer.dispose();
  });
  it('unknown/restored readings cancel flight and restore neutral rather than claiming closed', () => {
    const { layer, leaf } = layerFor(); layer.setData(data()); layer.update(100);
    layer.setData(data({ hass: hass('on', { restored: true }), animationNow: 100 }));
    expect(layer.moving).toBe(false); closeVector(leaf.position, [1, 1, 0]);
    expect(layer.parts.get('front').reading.open).toBeNull(); expect(layer.parts.get('front').material.color.getHexString()).toBe('8d9199');
    expect(layer.update(200)).toBe(false); layer.dispose();
  });
  it('reduced motion and zero duration snap exactly and stop scheduling frames', () => {
    for (const extra of [{ reducedMotion: true }, { bindings: [binding({ motion: motion({ duration_ms: 0 }) })] }]) {
      const { layer, leaf } = layerFor(); layer.setData(data(extra)); closeVector(leaf.position, [0, 1, -1]);
      expect(layer.moving).toBe(false); expect(layer.update(1000)).toBe(false); layer.dispose();
    }
    const { layer } = layerFor(); layer.setData(data()); layer.update(50, { reducedMotion: true });
    expect(layer.parts.get('front').degrees).toBe(90); expect(layer.moving).toBe(false); layer.dispose();
  });
  it('hidden floors/global visibility stop motion and remain hidden without resetting known contact evidence', () => {
    const { layer } = layerFor(); layer.setData(data()); layer.update(50); layer.setVisible(false);
    expect(layer.moving).toBe(false); expect(layer.parts.get('front').degrees).toBe(90); expect(layer.update(100)).toBe(false);
    expect(layer.setVisible(true)).toBe(true);
    layer.setData(data({ hass: hass('off'), shownObjectIds: new Set(), animationNow: 100 }));
    expect(layer.moving).toBe(false); expect(layer.parts.get('front').degrees).toBe(0); expect(layer.parts.get('front').shown).toBe(false);
    layer.dispose();
  });
  it('removing/HA-hiding a binding restores the exact authored pose and releases owned resources', () => {
    const { layer, leaf } = layerFor(); const original = { p: leaf.position.clone(), q: leaf.quaternion.clone(), s: leaf.scale.clone(), m: leaf.matrix.clone() };
    layer.setData(data({ reducedMotion: true })); const ha = hass(); ha.entities['binary_sensor.front_door'] = { hidden: true };
    layer.setData(data({ hass: ha })); expect(layer.parts.size).toBe(0); expect(leaf.position.equals(original.p)).toBe(true);
    expect(leaf.quaternion.equals(original.q)).toBe(true); expect(leaf.scale.equals(original.s)).toBe(true); expect(leaf.matrix.equals(original.m)).toBe(true);
    expect(layer.takeMotionChanges().changedMotionTargets.has(leaf)).toBe(true); layer.dispose();
  });
  it('preserves manually authored matrices and matrix flags on model replacement and disposal', () => {
    const { layer, leaf } = layerFor(); leaf.matrixAutoUpdate = false;
    leaf.matrix.makeTranslation(2, 1, 0); // Matrix is authoritative even when the p/q/s fields differ.
    const original = leaf.matrix.clone(), p = leaf.position.clone();
    layer.setData(data({ reducedMotion: true })); closeVector(leaf.position, [0, 1, -2]); expect(leaf.matrixAutoUpdate).toBe(false);
    expect(layer.setModel(null)).toBe(true); expect(leaf.matrix.equals(original)).toBe(true); expect(leaf.position.equals(p)).toBe(true); expect(leaf.matrixAutoUpdate).toBe(false);
    layer.setModel(fixture().model); layer.setData(data({ reducedMotion: true })); layer.dispose();
    expect(layer.setData(data())).toBe(false); expect(layer.setModel(fixture().model)).toBe(false); expect(layer.setVisible(true)).toBe(false);
  });
  it.each(['skinned', 'morph', 'manual-world', 'shear'])('rejects %s moving targets without transforming them', (kind) => {
    const f = fixture();
    if (kind === 'skinned') f.leaf.isSkinnedMesh = true;
    if (kind === 'morph') { f.leaf.geometry = f.leaf.geometry.clone(); f.leaf.geometry.morphAttributes.position = [f.leaf.geometry.attributes.position.clone()]; }
    if (kind === 'manual-world') f.leaf.matrixWorldAutoUpdate = false;
    if (kind === 'shear') { f.leaf.matrixAutoUpdate = false; f.leaf.matrix.elements[4] = .5; }
    const { layer } = layerFor(f); const original = f.leaf.position.clone(); layer.setData(data({ reducedMotion: true }));
    expect(layer.parts.get('front').target).toBeNull(); expect(f.leaf.position.equals(original)).toBe(true);
    expect(layer.diagnostics.some((d) => d.code.startsWith('unsupported'))).toBe(true); layer.dispose();
  });
  it('rejects an external transform writer and overlapping second-layer claims', () => {
    const f = fixture(), first = new SecurityLayer(); first.setModel(f.model, { motionWriters: new Set([f.object]) });
    first.setData(data({ reducedMotion: true })); expect(first.parts.get('front').target).toBeNull(); expect(first.diagnostics.some((d) => d.code === 'shared_writer')).toBe(true);
    first.dispose(); const one = new SecurityLayer(), two = new SecurityLayer(); one.setModel(f.model); two.setModel(f.model);
    one.setData(data({ reducedMotion: true })); two.setData(data({ reducedMotion: true })); expect(two.parts.get('front').target).toBeNull();
    two.dispose(); one.dispose(); const next = new SecurityLayer(); next.setModel(f.model); next.setData(data({ reducedMotion: true })); expect(next.parts.get('front').target).toBe(f.leaf); next.dispose();
  });
  it('rejects all nested motion writers independently of binding order', () => {
    const f = fixture(); f.leaf.userData.fp = { kind: 'object', id: 'nested_door', type: 'door' }; f.model.manifest = buildManifest(threeAdapter(f.root));
    const b1 = binding({ motion: motion({ target: '.' }) }), b2 = binding({ id: 'nested', object_id: 'nested_door', motion: motion({ target: '.' }) });
    for (const bindings of [[b1, b2], [b2, b1]]) {
      const { layer } = layerFor(f); layer.setData(data({ bindings, reducedMotion: true }));
      expect([...layer.parts.values()].every((part) => part.target === null)).toBe(true); expect(layer.diagnostics.filter((d) => d.code === 'shared_writer')).toHaveLength(2); layer.dispose();
    }
  });
  it('does not reset motion for setModel with the same model and unchanged options', () => {
    const { layer, model } = layerFor(); layer.setData(data()); layer.update(50);
    expect(layer.setModel(model)).toBe(false); expect(layer.parts.get('front').degrees).toBeGreaterThan(0); expect(layer.moving).toBe(true); layer.dispose();
  });
});
