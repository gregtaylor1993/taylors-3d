// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { floorPanelParticipants } from '../src/floor-panel-membership.js';

const groundId = 'ground:west wing', upperId = 'first floor:east';
const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
const label = () => new CSS2DObject(document.createElement('span'));
function fixture() {
  const scene = new THREE.Scene(), modelRoot = new THREE.Group(), ground = new THREE.Group(), upper = new THREE.Group();
  scene.add(modelRoot); modelRoot.add(ground, upper);
  const lowerMesh = mesh(), upperMesh = mesh(); ground.add(lowerMesh); upper.add(upperMesh);
  const targets = [{ node: ground, floor_id: groundId }, { node: upper, floor_id: upperId }];
  const floors = [{ id: groundId, elevation: 0 }, { id: upperId, elevation: 3 }];
  const within = (node, parent) => { for (let current = node; current; current = current.parent) if (current === parent) return true; return false; };
  const view = { scene, model: { root: modelRoot }, floors, _floorOptions: { floors, targets, backgroundNodes: [] },
    cssObjects: [], markerObjects: new Map(), glows: new Map(), staticGroup: new THREE.Group(), overlayGroup: new THREE.Group(),
    objectLayer: { parts: new Map(), _pose: null }, floorForModelNode: vi.fn((node) => {
      const owners = targets.filter((row) => within(node, row.node)); return owners.length === 1 ? owners[0].floor_id : null;
    }) };
  scene.add(view.staticGroup, view.overlayGroup);
  return { scene, view, modelRoot, ground, upper, lowerMesh, upperMesh, targets, floors };
}
const codes = (map) => map.diagnostics.map((row) => row.code);
function actor(f, { floorId = groundId, name = 'mower', node, pose = true } = {}) {
  node ||= new THREE.Group(); if (!node.parent) f.upper.add(node);
  const body = mesh(), decoration = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()); node.add(body, decoration);
  const part = { displayFloorId: floorId, origin: { localY: .15 }, label: label(), glow: body };
  const prepared = { obj: { node, type: 'mower' }, type: { place() {} }, part };
  f.scene.add(part.label); f.view.objectLayer.parts.set(name, prepared);
  if (pose) f.view.objectLayer._pose = { floorId, x: 4, y: 7 };
  return { prepared, part, node, body, decoration };
}

describe('current exact floor participants', () => {
  it('returns a Map with readable diagnostics but does not classify model Group ancestors or lights', () => {
    const f = fixture(), light = new THREE.PointLight(0xffffff, 2); f.upper.add(light);
    const participants = floorPanelParticipants(f.view);
    expect(participants).toBeInstanceOf(Map); expect(participants.get(f.lowerMesh)).toBe(groundId); expect(participants.get(f.upperMesh)).toBe(upperId);
    expect(participants.has(f.ground)).toBe(false); expect(participants.has(f.upper)).toBe(false); expect(participants.has(f.modelRoot)).toBe(false);
    expect(participants.has(light)).toBe(false); expect(participants.diagnostics).toEqual([]);
    expect(Object.keys(participants)).toEqual([]); expect(Object.isFrozen(participants.diagnostics)).toBe(true);
  });
  it('keeps existing plan labels, markers, glows, editor geometry and mower maps on their exact floor', () => {
    const f = fixture(), roomLabel = label(), marker = label(), glow = mesh(), staticFloor = new THREE.Group(), handle = mesh();
    const trail = new THREE.Line(), plane = mesh(), line = new THREE.Line(), disc = mesh();
    f.view.cssObjects = [{ obj: roomLabel, floorId: groundId }, { obj: marker, floorId: upperId }];
    f.view.markerObjects.set('exact-marker', { obj: marker, floorId: upperId }); f.view.glows.set('lamp', { mesh: glow, floorId: groundId });
    staticFloor.userData.floorId = upperId; f.view.staticGroup.add(staticFloor);
    handle.userData.floorId = groundId; f.view.overlayGroup.add(handle);
    trail.userData.floorId = upperId; plane.userData.floorId = groundId; f.view.trail = trail; f.view.mapPlane = plane;
    f.view.stems = new Map([['exact-marker', { line, disc }]]);
    const participants = floorPanelParticipants(f.view);
    for (const node of [roomLabel, glow, handle, plane]) expect(participants.get(node)).toBe(groundId);
    for (const node of [marker, staticFloor, trail, line, disc]) expect(participants.get(node)).toBe(upperId);
    expect(codes(participants)).not.toContain('conflicting_ownership');
  });
  it('ignores height, mesh name and arbitrary userData when explicit model ownership is missing', () => {
    const f = fixture(); f.targets.splice(0); f.targets.push({ node: f.modelRoot, floor_id: 'removed' });
    f.lowerMesh.name = groundId; f.lowerMesh.position.y = 0; f.lowerMesh.userData.floorId = groundId;
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(f.lowerMesh)).toBeNull(); expect(codes(participants)).toContain('unknown_floor');
  });
  it('preserves colon and space characters in exact floor IDs without normalization', () => {
    const f = fixture(), exact = ' north: mezzanine '; f.floors[0].id = exact; f.targets[0].floor_id = exact;
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(f.lowerMesh)).toBe(exact); expect(participants.get(f.upperMesh)).toBe(upperId);
  });
  it.each(['unknown', 'stale', 'duplicate', 'invalid'])('keeps %s floor ownership unclassified', (condition) => {
    const f = fixture();
    if (condition === 'unknown') f.floors.splice(0, 1);
    if (condition === 'stale') f.floors[0].stale = true;
    if (condition === 'duplicate') f.floors.push({ ...f.floors[0] });
    if (condition === 'invalid') f.floors[0].elevation = NaN;
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(f.lowerMesh)).toBeNull(); expect(participants.get(f.upperMesh)).toBe(upperId);
    expect(codes(participants)).toContain({ unknown: 'unknown_floor', stale: 'stale_floor', duplicate: 'ambiguous_floor', invalid: 'invalid_floor' }[condition]);
  });
  it('uses current floor-options resolution before a different older view floor list', () => {
    const f = fixture(); f.view.floors = [{ id: groundId, elevation: 0 }, { id: upperId, elevation: 3 }]; f.floors[0].stale = true;
    expect(floorPanelParticipants(f.view).get(f.lowerMesh)).toBeNull();
  });
  it('keeps conflicting ownership poisoned after a later matching claim', () => {
    const f = fixture(), node = label(); f.view.cssObjects.push({ obj: node, floorId: groundId }, { obj: node, floorId: upperId });
    f.view.markerObjects.set('same-node', { obj: node, floorId: groundId });
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(node)).toBeNull(); expect(participants.diagnostics.filter((row) => row.code === 'conflicting_ownership')).toHaveLength(1);
  });
  it('records explicit background leaf geometry without hiding its Group or light allocations', () => {
    const f = fixture(), driveway = new THREE.Group(), groundPlane = mesh(), lamp = new THREE.PointLight();
    driveway.add(groundPlane, lamp); f.modelRoot.add(driveway); f.view._floorOptions.backgroundNodes.push(driveway);
    const participants = floorPanelParticipants(f.view);
    expect(participants.has(driveway)).toBe(false); expect(participants.has(lamp)).toBe(false); expect(participants.get(groundPlane)).toBeNull();
    expect(participants.diagnostics).toContainEqual(expect.objectContaining({ code: 'background', node: groundPlane }));
  });
  it('rejects a floor leaf simultaneously claimed as explicit background', () => {
    const f = fixture(); f.view._floorOptions.backgroundNodes.push(f.lowerMesh);
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(f.lowerMesh)).toBeNull(); expect(codes(participants)).toContain('conflicting_ownership');
  });
  it('handles missing or malformed layer containers without inventing participants', () => {
    expect(floorPanelParticipants(undefined).size).toBe(0);
    const result = floorPanelParticipants({ floors: null, cssObjects: {}, markerObjects: [], objectLayer: { parts: {} } }, { rooms: {}, alerts: {} });
    expect(result.size).toBe(0); expect(result.diagnostics).toEqual([]);
  });
});

describe('current measured model actors and temporary leaf isolation', () => {
  it('places all measured mower descendants and labels on Ground despite their authored Upper parent', () => {
    const f = fixture(), a = actor(f), participants = floorPanelParticipants(f.view);
    expect(participants.get(a.body)).toBe(groundId); expect(participants.get(a.decoration)).toBe(groundId); expect(participants.get(a.part.label)).toBe(groundId);
    expect(participants.get(f.upperMesh)).toBe(upperId); expect(participants.has(f.upper)).toBe(false); expect(participants.has(a.node)).toBe(false);
    const original = new Map([...participants].map(([node]) => [node, node.visible]));
    for (const [node, owner] of participants) node.visible = owner === groundId;
    expect(f.upper.visible).toBe(true); expect(a.node.visible).toBe(true); expect(a.body.visible).toBe(true); expect(f.upperMesh.visible).toBe(false);
    for (const [node, visible] of original) node.visible = visible;
    expect(codes(participants)).not.toContain('conflicting_ownership');
  });
  it('falls back to the authored exact model owner when no measured display stamp exists', () => {
    const f = fixture(), a = actor(f); delete a.part.displayFloorId; a.part.origin = null; f.view.objectLayer._pose = null;
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(a.body)).toBe(upperId); expect(participants.get(a.part.label)).toBe(upperId);
  });
  it.each(['pose', 'floor', 'origin', 'type', 'coordinate'])('rejects an orphaned %s measured override instead of retaining its old floor', (condition) => {
    const f = fixture(), a = actor(f);
    if (condition === 'pose') f.view.objectLayer._pose = null;
    if (condition === 'floor') f.view.objectLayer._pose.floorId = upperId;
    if (condition === 'origin') a.part.origin = null;
    if (condition === 'type') a.prepared.type = {};
    if (condition === 'coordinate') f.view.objectLayer._pose.x = Infinity;
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(a.body)).toBeNull(); expect(participants.get(a.part.label)).toBeNull(); expect(codes(participants)).toContain('stale_measured_override');
  });
  it('rejects an unknown or stale measured destination', () => {
    for (const condition of ['unknown', 'stale']) {
      const f = fixture(), a = actor(f);
      if (condition === 'unknown') f.floors.splice(0, 1); else f.floors[0].stale = true;
      const participants = floorPanelParticipants(f.view);
      expect(participants.get(a.body)).toBeNull(); expect(participants.get(a.part.label)).toBeNull();
      expect(codes(participants)).toContain(condition === 'unknown' ? 'unknown_floor' : 'stale_floor');
    }
  });
  it('fails closed when two actor parts claim the same model descendant, even on the same destination', () => {
    const f = fixture(), a = actor(f); f.view.objectLayer.parts.set('duplicate-actor', { ...a.prepared, part: { ...a.part, label: label() } });
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(a.body)).toBeNull(); expect(participants.get(a.decoration)).toBeNull();
    expect(codes(participants)).toContain('ambiguous_measured_override');
  });
  it('never borrows a measured override from a node outside the current model', () => {
    const f = fixture(), external = new THREE.Group(); f.scene.add(external); const a = actor(f, { node: external });
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(a.part.label)).toBeNull(); expect(participants.has(a.body)).toBe(true); expect(participants.get(a.body)).toBeNull();
    expect(participants.has(a.decoration)).toBe(false); expect(codes(participants)).toContain('stale_measured_override');
  });
});

describe('existing feature layers in floor panels', () => {
  it('classifies tracking, camera coverage, furniture, status and plan-security objects by actual exact records', () => {
    const f = fixture(), tracked = { group: new THREE.Group(), mesh: mesh(), label: label() };
    tracked.group.userData.floorId = groundId; tracked.group.add(tracked.mesh, tracked.label); f.scene.add(tracked.group);
    const cone = { group: new THREE.Group(), fill: mesh(), outline: new THREE.LineSegments(), rays: new THREE.LineSegments() };
    cone.group.userData.floorId = upperId; cone.group.add(cone.fill, cone.outline, cone.rays); f.scene.add(cone.group);
    const furniture = { group: new THREE.Group(), offset: new THREE.Group(), model: mesh(), row: { floorId: groundId } };
    furniture.group.add(furniture.offset); furniture.offset.add(furniture.model); f.scene.add(furniture.group);
    const room = { mesh: mesh(), label: label() }, alert = { mesh: mesh(), label: label() };
    const plan = { group: new THREE.Group(), ring: mesh(), glyph: new THREE.LineSegments(), label: label(), record: { location: { floorId: upperId } } };
    plan.group.add(plan.ring, plan.glyph, plan.label); f.scene.add(plan.group, room.mesh, room.label, alert.mesh, alert.label);
    const context = { trackingLayer: { parts: new Map([['person', tracked]]) }, cameraCoverage: { sectors: new Map([['camera', cone]]) },
      furnitureLayer: { parts: new Map([['sofa', furniture]]) }, statusOverlays: { rooms: new Map([[`${groundId}:lounge:TV`, room]]), alerts: new Map([['leak', alert]]) },
      rooms: [{ room: { id: 'lounge:TV' }, floorId: groundId }], alerts: [{ id: 'leak', location: { floorId: upperId } }],
      planSecurityLayer: { parts: new Map([['door', plan]]) } };
    const participants = floorPanelParticipants(f.view, context);
    for (const node of [tracked.group, tracked.mesh, tracked.label, furniture.group, furniture.model, room.mesh, room.label]) expect(participants.get(node)).toBe(groundId);
    for (const node of [cone.group, cone.fill, cone.outline, alert.mesh, alert.label, plan.group, plan.glyph, plan.label]) expect(participants.get(node)).toBe(upperId);
    expect(codes(participants)).toEqual([]);
  });
  it('does not split room overlay keys at colons or use a matching prefix without a complete descriptor', () => {
    const f = fixture(), part = { mesh: mesh(), label: label() }, statusOverlays = { rooms: new Map([[`${groundId}:unlisted`, part]]) };
    const participants = floorPanelParticipants(f.view, { statusOverlays, rooms: [{ id: 'other', floorId: groundId }] });
    expect(participants.get(part.mesh)).toBeNull(); expect(participants.get(part.label)).toBeNull(); expect(codes(participants)).toContain('unmapped_room_overlay');
  });
  it('rejects colliding complete room keys from different colon-bearing floor/room pairs', () => {
    const f = fixture(), part = { mesh: mesh(), label: label() };
    f.floors.push({ id: 'a:b', elevation: 6 }, { id: 'a', elevation: 9 });
    const participants = floorPanelParticipants(f.view, { statusOverlays: { rooms: new Map([['a:b:c', part]]) },
      rooms: [{ id: 'c', floorId: 'a:b' }, { room: { id: 'b:c' }, floorId: 'a' }] });
    expect(participants.get(part.mesh)).toBeNull(); expect(codes(participants)).toContain('ambiguous_room_key');
  });
  it('allows repeated identical room descriptors but not a removed alert or duplicate alert record', () => {
    const f = fixture(), room = { mesh: mesh() }, alert = { mesh: mesh() }, descriptor = { room: { id: 'lounge' }, floorId: groundId };
    const context = { rooms: [descriptor, descriptor], statusOverlays: { rooms: new Map([[`${groundId}:lounge`, room]]), alerts: new Map([['leak', alert]]) }, alerts: [] };
    let participants = floorPanelParticipants(f.view, context);
    expect(participants.get(room.mesh)).toBe(groundId); expect(participants.get(alert.mesh)).toBeNull(); expect(codes(participants)).toContain('unmapped_alert');
    context.alerts = [{ id: 'leak', location: { floorId: upperId } }, { id: 'leak', location: { floorId: upperId } }];
    participants = floorPanelParticipants(f.view, context); expect(participants.get(alert.mesh)).toBeNull(); expect(codes(participants)).toContain('ambiguous_alert');
  });
  it('reads current actor/cone userData and furniture/plan records rather than names or unrelated fields', () => {
    const f = fixture(), tracked = { group: new THREE.Group(), floorId: groundId }, cone = { group: new THREE.Group(), floorId: groundId },
      furniture = { group: new THREE.Group(), floorId: groundId }, plan = { group: new THREE.Group(), floorId: groundId };
    for (const part of [tracked, cone, furniture, plan]) { part.group.name = groundId; part.group.position.y = 0; }
    const participants = floorPanelParticipants(f.view, { trackingLayer: { parts: new Map([['p', tracked]]) }, cameraCoverage: { sectors: new Map([['c', cone]]) },
      furnitureLayer: { parts: new Map([['f', furniture]]) }, planSecurityLayer: { parts: new Map([['s', plan]]) } });
    for (const part of [tracked, cone, furniture, plan]) expect(participants.get(part.group)).toBeNull();
    expect(codes(participants).filter((code) => code === 'missing_floor')).toHaveLength(4);
  });
  it.each(['unknown', 'stale', 'duplicate'])('rejects a %s floor consistently across all five feature layers', (condition) => {
    const f = fixture(), tracked = { group: new THREE.Group(), label: label() }, cone = { group: new THREE.Group(), fill: mesh() },
      furniture = { group: new THREE.Group(), model: mesh(), row: { floorId: groundId } },
      room = { mesh: mesh(), label: label() }, alert = { mesh: mesh(), label: label() },
      plan = { group: new THREE.Group(), label: label(), record: { location: { floorId: groundId } } };
    tracked.group.userData.floorId = groundId; cone.group.userData.floorId = groundId;
    if (condition === 'unknown') f.floors.splice(0, 1);
    else if (condition === 'stale') f.floors[0].stale = true;
    else f.floors.push({ ...f.floors[0] });
    const participants = floorPanelParticipants(f.view, { trackingLayer: { parts: new Map([['person', tracked]]) },
      cameraCoverage: { sectors: new Map([['camera', cone]]) }, furnitureLayer: { parts: new Map([['sofa', furniture]]) },
      rooms: [{ room: { id: 'Lounge' }, floorId: groundId }], alerts: [{ id: 'leak', location: { floorId: groundId } }],
      statusOverlays: { rooms: new Map([[`${groundId}:Lounge`, room]]), alerts: new Map([['leak', alert]]) },
      planSecurityLayer: { parts: new Map([['door', plan]]) } });
    for (const node of [tracked.group, tracked.label, cone.group, cone.fill, furniture.group, furniture.model,
      room.mesh, room.label, alert.mesh, alert.label, plan.group, plan.label]) expect(participants.get(node)).toBeNull();
    expect(codes(participants)).toContain({ unknown: 'unknown_floor', stale: 'stale_floor', duplicate: 'ambiguous_floor' }[condition]);
  });
  it('attaches model security outlines to their actual object owner before considering a different motion target', () => {
    const f = fixture(), line = new THREE.LineSegments(); f.upperMesh.add(line);
    const participants = floorPanelParticipants(f.view, { securityLayer: { parts: new Map([['door', { object: f.upperMesh, target: f.lowerMesh, lines: [line] }]]) } });
    expect(participants.get(line)).toBe(upperId);
  });
  it('uses an exact rigid security target if its object is genuinely missing', () => {
    const f = fixture(), line = new THREE.LineSegments(); f.upperMesh.add(line);
    expect(floorPanelParticipants(f.view, { securityLayer: { parts: new Map([['door', { target: f.upperMesh, lines: [line] }]]) } }).get(line)).toBe(upperId);
  });
  it('reports an unreadable model owner rather than throwing or reassigning by geometry', () => {
    const f = fixture(); f.view.floorForModelNode.mockImplementation(() => { throw new Error('old context'); });
    const participants = floorPanelParticipants(f.view);
    expect(participants.get(f.lowerMesh)).toBeNull(); expect(codes(participants)).toContain('model_floor_unreadable');
  });
  it('does not change visibility, transforms, light intensity, material references or source collections', () => {
    const f = fixture(), a = actor(f), light = new THREE.PointLight(0xffaa00, 1.25); f.upper.add(light);
    f.upperMesh.visible = false; const before = [];
    f.scene.traverse((node) => before.push({ node, visible: node.visible, position: node.position.toArray(), quaternion: node.quaternion.toArray(),
      scale: node.scale.toArray(), parent: node.parent, geometry: node.geometry, material: node.material, intensity: node.intensity }));
    const parts = f.view.objectLayer.parts, pose = f.view.objectLayer._pose, targets = f.targets, cssObjects = f.view.cssObjects;
    const participants = floorPanelParticipants(f.view); expect(participants.get(a.body)).toBe(groundId);
    for (const old of before) expect({ node: old.node, visible: old.node.visible, position: old.node.position.toArray(), quaternion: old.node.quaternion.toArray(),
      scale: old.node.scale.toArray(), parent: old.node.parent, geometry: old.node.geometry, material: old.node.material, intensity: old.node.intensity }).toEqual(old);
    expect(f.view.objectLayer.parts).toBe(parts); expect(f.view.objectLayer._pose).toBe(pose); expect(f.targets).toBe(targets); expect(f.view.cssObjects).toBe(cssObjects);
    expect(light.intensity).toBe(1.25); expect(participants.has(light)).toBe(false);
  });
});
