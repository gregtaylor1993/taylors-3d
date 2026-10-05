import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FloorPresentationLayer } from '../src/floor-presentation-rendering.js';

const closeVector = (actual, expected) => actual.forEach((component, index) => expect(component).toBeCloseTo(expected[index], 9));
const codes = (result) => result.diagnostics.map((entry) => entry.code);
const geometry = () => new THREE.BoxGeometry(8, 2, 6);
function fixture({ transformParent = false } = {}) {
  const scene = new THREE.Group(), parent = new THREE.Group(), root = new THREE.Group(); scene.add(parent); parent.add(root);
  if (transformParent) { parent.position.set(-6, 2, 9); parent.rotation.set(.1, .65, -.2); parent.scale.set(1.4, .8, 2.2); }
  const shared = new THREE.MeshStandardMaterial(), ground = new THREE.Group(), upper = new THREE.Group();
  ground.name = 'not-ground'; upper.name = 'not-upper'; upper.position.set(0, 4, 0);
  const lowerMesh = new THREE.Mesh(geometry(), shared), upperMesh = new THREE.Mesh(geometry(), shared);
  lowerMesh.position.y = 1; upperMesh.position.set(2, 1, -1); ground.add(lowerMesh); upper.add(upperMesh); root.add(ground, upper);
  const floors = [{ id: 'exact_ground', elevation: 0 }, { id: 'exact_upper', elevation: 4 }];
  const targets = [{ floor_id: floors[0].id, node: ground }, { floor_id: floors[1].id, node: upper }];
  const data = { modelRoot: root, floors, targets, backgroundNodes: [], transformWriters: new Set() };
  return { scene, parent, root, ground, upper, lowerMesh, upperMesh, shared, data, layer: new FloorPresentationLayer() };
}
const transform = (node) => ({ position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(),
  matrix: node.matrix.toArray(), matrixAutoUpdate: node.matrixAutoUpdate, parent: node.parent,
  positionRef: node.position, quaternionRef: node.quaternion, scaleRef: node.scale, matrixRef: node.matrix });
const worldPoint = (node, local = [0, 0, 0]) => node.localToWorld(new THREE.Vector3(...local)).toArray();
const fail = (layer, result, code) => { expect(result).toMatchObject({ valid: false, mode: 'assembled' });
  expect(layer.report().rows).toEqual([]); expect(codes(result)).toContain(code); };

describe('exact rigid floor ownership and measured world translation', () => {
  it('adds vertical world gaps without changing hierarchy, authored rotation/scale or shared resources', () => {
    const f = fixture(); f.scene.updateMatrixWorld(true);
    const initialGround = transform(f.ground), initialUpper = transform(f.upper), upperSource = worldPoint(f.upperMesh, [2, .5, 1]);
    const refs = [f.upperMesh.geometry, f.upperMesh.material, f.lowerMesh.material], state = JSON.stringify(f.data.floors);
    const result = f.layer.setData({ ...f.data, raw: { mode: 'vertical', gap_m: 3 } }); f.scene.updateMatrixWorld(true);
    expect(result).toMatchObject({ changed: true, valid: true, mode: 'vertical' }); expect(result.changedTargets).toEqual([f.upper]);
    closeVector(worldPoint(f.upperMesh, [2, .5, 1]), [upperSource[0], upperSource[1] + 3, upperSource[2]]);
    expect(transform(f.ground)).toEqual(initialGround); expect(f.upper.parent).toBe(initialUpper.parent);
    expect(f.upper.quaternion.toArray()).toEqual(initialUpper.quaternion); expect(f.upper.scale.toArray()).toEqual(initialUpper.scale);
    expect([f.upperMesh.geometry, f.upperMesh.material, f.lowerMesh.material]).toEqual(refs); expect(JSON.stringify(f.data.floors)).toBe(state);
    expect(f.layer.floorForNode(f.upperMesh)).toBe('exact_upper'); expect(f.layer.floorForNode(f.root)).toBeNull();
    expect(f.layer.offsetForFloor('exact_upper')).toEqual([0, 3, 0]); expect(f.layer.offsetForFloor('renamed_upper')).toBeNull();
    expect(f.layer.dispose()).toMatchObject({ changed: true, diagnostics: [] }); expect(transform(f.upper)).toEqual(initialUpper);
  });
  it('uses additive world translation under a rotated, translated, nonuniform parent', () => {
    const f = fixture({ transformParent: true }); f.ground.rotation.set(.2, -.3, .05); f.upper.rotation.set(-.1, .4, .2);
    f.upper.scale.set(.8, 1.3, 1.1); f.scene.updateMatrixWorld(true);
    const before = transform(f.upper), source = worldPoint(f.upperMesh, [1.25, .75, -2.1]), parent = transform(f.parent);
    const result = f.layer.setData({ ...f.data, raw: { mode: 'horizontal', floors: ['exact_upper', 'exact_ground'], axis: 'north', base_elevation_m: 1, gap_m: 2.5 } });
    expect(result.valid).toBe(true); f.scene.updateMatrixWorld(true);
    const offset = f.layer.offsetForFloor('exact_upper'); closeVector(worldPoint(f.upperMesh, [1.25, .75, -2.1]), source.map((component, index) => component + offset[index]));
    expect(transform(f.parent)).toEqual(parent); expect(f.upper.quaternion.toArray()).toEqual(before.quaternion); expect(f.upper.scale.toArray()).toEqual(before.scale);
    const display = f.layer.sourceWorldToDisplay(source, 'exact_upper'); closeVector(display.point, worldPoint(f.upperMesh, [1.25, .75, -2.1]));
    closeVector(f.layer.displayWorldToSource(display.point, 'exact_upper').point, source);
    f.layer.dispose(); expect(transform(f.upper)).toEqual(before);
  });
  it('preserves an explicit manual authored affine matrix and every original transform reference', () => {
    const f = fixture({ transformParent: true });
    f.upper.matrixAutoUpdate = false; f.upper.position.set(17, 18, 19); f.upper.quaternion.setFromEuler(new THREE.Euler(.2, .3, -.1)); f.upper.scale.set(.7, 1.2, .9);
    f.upper.matrix.set(1, .15, 0, 2, 0, 1, .1, 4, .2, 0, 1, -3, 0, 0, 0, 1); f.scene.updateMatrixWorld(true);
    const before = transform(f.upper), source = worldPoint(f.upperMesh, [2, 1, -1]), positionWrite = vi.spyOn(f.upper.position, 'copy');
    const result = f.layer.setData({ ...f.data, raw: { mode: 'vertical', gap_m: 5 } }); f.scene.updateMatrixWorld(true);
    expect(result.valid).toBe(true); closeVector(worldPoint(f.upperMesh, [2, 1, -1]), [source[0], source[1] + 5, source[2]]);
    expect(positionWrite).not.toHaveBeenCalled(); expect(f.upper.matrixAutoUpdate).toBe(false);
    f.layer.dispose(); expect(transform(f.upper)).toEqual(before); expect(positionWrite).not.toHaveBeenCalled();
  });
  it('leaves known unselected levels assembled while translating selected levels only', () => {
    const f = fixture(); const third = new THREE.Group(); third.position.y = 8; third.add(new THREE.Mesh(geometry(), f.shared)); f.root.add(third);
    const data = { ...f.data, floors: [...f.data.floors, { id: 'third', elevation: 8 }], targets: [...f.data.targets, { floor_id: 'third', node: third }] };
    f.scene.updateMatrixWorld(true); const before = transform(third);
    expect(f.layer.setData({ ...data, raw: { mode: 'horizontal', floors: ['exact_ground', 'exact_upper'] } }).valid).toBe(true);
    expect(transform(third)).toEqual(before); expect(f.layer.floorForNode(third.children[0])).toBe('third');
    expect(f.layer.offsetForFloor('third')).toBeNull(); // unselected source data is never fabricated as a selected display row
  });
  it('measures actual unequal source-world footprints rather than names, elevations or shared geometry IDs', () => {
    const f = fixture(); f.upperMesh.scale.set(2, 1, .5); f.upperMesh.position.x = -13;
    const result = f.layer.setData({ ...f.data, raw: { mode: 'horizontal', gap_m: 3 } }); expect(result.valid).toBe(true);
    const rows = f.layer.report().rows;
    expect(rows[0].bounds).toEqual({ min: [-4, 0, -3], max: [4, 2, 3] }); expect(rows[1].bounds).toEqual({ min: [-21, 4, -2.5], max: [-5, 6, .5] });
    expect(rows[1].offset).toEqual([28, -4, 0]);
  });
});

describe('changed-only reversible transforms and source footprint cache', () => {
  it('default/assembled and hidden eligibility write no authored values even with unsupported model geometry', () => {
    const f = fixture(); f.root.add(new THREE.Mesh(geometry(), f.shared)); const before = [transform(f.ground), transform(f.upper)];
    const position = vi.spyOn(f.upper.position, 'copy'), matrix = vi.spyOn(f.upper.matrix, 'copy'), bounds = vi.spyOn(f.layer, '_measure');
    for (const raw of [undefined, { mode: 'assembled' }]) expect(f.layer.setData({ ...f.data, raw })).toMatchObject({ changed: false, valid: true, mode: 'assembled' });
    expect(f.layer.setData({ ...f.data, raw: { mode: 'horizontal' }, enabled: false })).toMatchObject({ changed: false, valid: true, mode: 'assembled' });
    expect(position).not.toHaveBeenCalled(); expect(matrix).not.toHaveBeenCalled(); expect(bounds).not.toHaveBeenCalled();
    expect([transform(f.ground), transform(f.upper)]).toEqual(before); expect(f.layer.dispose().changed).toBe(false);
  });
  it('equal fresh settings after real matrix updates do not release/reapply or remeasure', () => {
    const f = fixture(), measure = vi.spyOn(f.layer, '_measure');
    f.layer.setData({ ...f.data, raw: { mode: 'vertical', gap_m: 3 } }); f.scene.updateMatrixWorld(true);
    const writePosition = vi.spyOn(f.upper.position, 'copy'), writeMatrix = vi.spyOn(f.upper.matrix, 'copy'), before = transform(f.upper);
    for (let index = 0; index < 10; index++) {
      expect(f.layer.setData({ ...f.data, floors: f.data.floors.map((floor) => ({ ...floor })), raw: { mode: 'vertical', gap_m: 3, unknown: index } }).changed).toBe(false);
      f.scene.updateMatrixWorld(true);
    }
    expect(measure).toHaveBeenCalledTimes(1); expect(writePosition).not.toHaveBeenCalled(); expect(writeMatrix).not.toHaveBeenCalled(); expect(transform(f.upper)).toEqual(before);
  });
  it('ordinary child hinge motion remains valid and cannot move cached horizontal floor spacing', () => {
    const f = fixture(); const hinge = new THREE.Group(), leaf = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .1), f.shared);
    leaf.position.x = 1; hinge.add(leaf); hinge.position.x = 4; f.upper.add(hinge); f.scene.updateMatrixWorld(true);
    const data = { ...f.data, transformWriters: new Set([hinge]) }, raw = { mode: 'horizontal', gap_m: 2 };
    expect(f.layer.setData({ ...data, raw }).valid).toBe(true); const offset = f.layer.offsetForFloor('exact_upper'), measured = f.layer.report().rows[1].bounds;
    const measure = vi.spyOn(f.layer, '_measure'); hinge.rotation.y = Math.PI / 2; f.scene.updateMatrixWorld(true);
    expect(f.layer.setData({ ...data, raw })).toMatchObject({ changed: false, valid: true }); expect(f.layer.offsetForFloor('exact_upper')).toEqual(offset);
    expect(f.layer.report().rows[1].bounds).toEqual(measured); expect(measure).not.toHaveBeenCalled(); expect(f.layer.floorForNode(leaf)).toBe('exact_upper');
  });
  it('reproves changed child writer sets without restoring transforms or repacking live child geometry', () => {
    const f = fixture(), raw = { mode: 'horizontal' }; f.layer.setData({ ...f.data, raw }); const rows = f.layer.report().rows;
    const measure = vi.spyOn(f.layer, '_measure'), restore = vi.spyOn(f.layer, '_restore'); f.lowerMesh.position.x = 15;
    for (const writers of [[f.lowerMesh], [f.lowerMesh, f.upperMesh], [f.upperMesh, f.lowerMesh], []])
      expect(f.layer.setData({ ...f.data, raw, transformWriters: new Set(writers) })).toMatchObject({ changed: false, valid: true });
    expect(f.layer.report().rows).toEqual(rows); expect(measure).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    fail(f.layer, f.layer.setData({ ...f.data, raw, transformWriters: new Set([f.upper]) }), 'transform_writer');
    expect(f.upper.position.toArray()).toEqual([0, 4, 0]);
    expect(f.layer.setData({ ...f.data, raw })).toMatchObject({ valid: true }); expect(f.layer.report().rows).toEqual(rows); expect(measure).not.toHaveBeenCalled();
  });
  it('ignores complete helper subtrees in source topology/proof/bounds while preserving them on source clones', () => {
    const f = fixture(), raw = { mode: 'horizontal' }; f.layer.setData({ ...f.data, raw }); const rows = f.layer.report().rows, measure = vi.spyOn(f.layer, '_measure');
    const helper = new THREE.Group(); helper.userData.helper = true; helper.add(new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000), f.shared)); f.root.add(helper);
    expect(f.layer.setData({ ...f.data, raw })).toMatchObject({ changed: false, valid: true }); expect(f.layer.report().rows).toEqual(rows); expect(measure).not.toHaveBeenCalled();
    expect(f.layer.cloneSourceRoot().root.children.some((node) => node.userData.helper && node.children.length === 1)).toBe(true);
    helper.userData.helper = false; fail(f.layer, f.layer.setData({ ...f.data, raw }), 'unclassified_geometry');
  });
  it('source world translation overrides apply recursively under rotated/scaled parents only for measurement, without any live child writes', () => {
    const f = fixture({ transformParent: true }), mover = new THREE.Group(), child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), f.shared);
    mover.position.set(200, 0, 0); mover.rotation.y = .4; mover.scale.set(.7, 1.3, 1.1); child.position.x = 2; mover.add(child); f.ground.add(mover);
    const before = transform(mover), parentMatrix = worldPoint(f.ground), matrix = f.ground.matrixWorld.clone().multiply(new THREE.Matrix4().compose(mover.position, mover.quaternion, mover.scale));
    const source = [1, 2, 3]; matrix.setPosition(...source); const expected = new THREE.Box3();
    for (let i = 0; i < child.geometry.attributes.position.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(child.geometry.attributes.position, i).applyMatrix4(child.matrix.clone().makeTranslation(2, 0, 0)).applyMatrix4(matrix); expected.expandByPoint(point);
    }
    // The independently authored floor bounds still participate; only the mover's translation is replaced.
    const floorBox = new THREE.Box3().setFromObject(f.lowerMesh); expected.union(floorBox);
    const result = f.layer.setData({ ...f.data, raw: { mode: 'horizontal' }, sourceWorldPositions: new Map([[mover, source]]) });
    expect(result.valid).toBe(true); closeVector(f.layer.report().rows[0].bounds.min, expected.min.toArray()); closeVector(f.layer.report().rows[0].bounds.max, expected.max.toArray());
    expect(transform(mover)).toEqual(before); expect(worldPoint(f.ground)).toEqual(parentMatrix);
  });
  it.each(['nonmap', 'nonvector', 'nonfinite', 'oversized', 'foreign', 'ancestor', 'level', 'helper', 'skinned'])('fails whole split for %s source-pose overrides and restores owned floors', (kind) => {
    const f = fixture(), raw = { mode: 'vertical', gap_m: 3 }; f.layer.setData({ ...f.data, raw });
    let node = f.lowerMesh, value = [1, 2, 3], positions;
    if (kind === 'nonvector') value = new THREE.Vector3(1, 2, 3);
    if (kind === 'nonfinite') value = [1, NaN, 3];
    if (kind === 'oversized') value = [1e6 + 1, 2, 3];
    if (kind === 'foreign') node = new THREE.Group();
    if (kind === 'ancestor') node = f.root;
    if (kind === 'level') node = f.ground;
    if (kind === 'helper') { node = new THREE.Group(); node.userData.helper = true; f.ground.add(node); }
    if (kind === 'skinned') { node = new THREE.SkinnedMesh(geometry(), f.shared); f.ground.add(node); }
    positions = kind === 'nonmap' ? {} : new Map([[node, value]]);
    const result = f.layer.setData({ ...f.data, raw, sourceWorldPositions: positions });
    fail(f.layer, result, 'invalid_source_pose'); expect(f.upper.position.toArray()).toEqual([0, 4, 0]);
  });
  it('policy changes use the same source bounds and baseline without accumulating offsets', () => {
    const f = fixture(); f.scene.updateMatrixWorld(true); const before = transform(f.upper), measure = vi.spyOn(f.layer, '_measure');
    f.layer.setData({ ...f.data, raw: { mode: 'vertical', gap_m: 2 } });
    expect(f.layer.setData({ ...f.data, raw: { mode: 'vertical', gap_m: 5 } })).toMatchObject({ changed: true, valid: true }); expect(f.upper.position.y).toBe(9);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(f.layer.setData({ ...f.data, raw: { mode: 'vertical', gap_m: 0 } })).toMatchObject({ changed: true, valid: true }); expect(transform(f.upper)).toEqual(before);
    expect(f.layer.dispose().changed).toBe(false);
  });
  it('restores before measuring changed parent alignment and reapplies a world-space gap once', () => {
    const f = fixture(); f.scene.updateMatrixWorld(true); const before = transform(f.upper), measure = vi.spyOn(f.layer, '_measure'), raw = { mode: 'vertical', gap_m: 3 };
    f.layer.setData({ ...f.data, raw }); f.parent.rotation.y = .5; f.parent.scale.set(1.3, .7, 2); f.parent.position.set(4, 1, -3);
    const result = f.layer.setData({ ...f.data, raw }); f.scene.updateMatrixWorld(true); expect(result).toMatchObject({ changed: true, valid: true }); expect(measure).toHaveBeenCalledTimes(2);
    const source = f.layer.cloneSourceRoot(); expect(source.ok).toBe(true); const cloneParent = new THREE.Group(); cloneParent.position.copy(f.parent.position);
    cloneParent.quaternion.copy(f.parent.quaternion); cloneParent.scale.copy(f.parent.scale); cloneParent.add(source.root); cloneParent.updateMatrixWorld(true);
    const sourcePoint = worldPoint(source.root.children[1]), currentPoint = worldPoint(f.upper); closeVector(currentPoint, [sourcePoint[0], sourcePoint[1] + 3, sourcePoint[2]]);
    f.layer.dispose(); expect(transform(f.upper)).toEqual(before);
  });
  it('restores the old root before changing source and restores current root on disable/teardown', () => {
    const a = fixture(), b = fixture(); a.scene.updateMatrixWorld(true); b.scene.updateMatrixWorld(true);
    const old = transform(a.upper), next = transform(b.upper), layer = a.layer;
    layer.setData({ ...a.data, raw: { mode: 'vertical' } }); layer.setData({ ...b.data, raw: { mode: 'horizontal' } }); expect(transform(a.upper)).toEqual(old);
    expect(layer.setData({ ...b.data, raw: { mode: 'horizontal' }, enabled: false }).changed).toBe(true); expect(transform(b.upper)).toEqual(next);
    expect(layer.dispose().changed).toBe(false); expect(layer.floorForNode(b.upperMesh)).toBeNull();
  });
});

describe('atomic explicit model ownership proof', () => {
  it.each(['nested', 'shared', 'duplicate', 'stale', 'missing'])('rejects %s level targets without partially moving any floor', (kind) => {
    const f = fixture(); f.scene.updateMatrixWorld(true); const before = [transform(f.ground), transform(f.upper)]; let targets = f.data.targets;
    if (kind === 'nested') targets = [targets[0], { floor_id: 'exact_upper', node: f.lowerMesh }];
    if (kind === 'shared') targets = [targets[0], { floor_id: 'exact_upper', node: f.ground }];
    if (kind === 'duplicate') targets = [targets[0], { floor_id: 'exact_ground', node: f.upper }];
    if (kind === 'stale') targets = [targets[0], { floor_id: 'exact_upper', node: new THREE.Group() }];
    if (kind === 'missing') targets = [targets[0], { floor_id: 'deleted_floor', node: f.upper }];
    const result = f.layer.setData({ ...f.data, targets, raw: { mode: 'horizontal' } }); expect(result).toMatchObject({ changed: false, valid: false, mode: 'assembled' });
    expect(f.layer.report().rows).toEqual([]); expect([transform(f.ground), transform(f.upper)]).toEqual(before);
    expect(codes(result)).toContain({ nested: 'nested_floor_targets', shared: 'shared_floor_target', duplicate: 'ambiguous_floor_target', stale: 'stale_floor_target', missing: 'missing_floor' }[kind]);
  });
  it('rejects unclassified furniture/site geometry and allows only an explicit nonoverlapping background node', () => {
    const f = fixture(), site = new THREE.Group(), outside = new THREE.Mesh(geometry(), f.shared); site.add(outside); f.root.add(site);
    fail(f.layer, f.layer.setData({ ...f.data, raw: { mode: 'horizontal' } }), 'unclassified_geometry');
    expect(f.layer.setData({ ...f.data, backgroundNodes: [site], raw: { mode: 'horizontal' } })).toMatchObject({ valid: true, mode: 'horizontal' });
    expect(f.layer.floorForNode(outside)).toBeNull(); expect(site.position.toArray()).toEqual([0, 0, 0]);
  });
  it('rejects an overlapping background root or duplicate background declarations', () => {
    const f = fixture(); fail(f.layer, f.layer.setData({ ...f.data, backgroundNodes: [f.root], raw: { mode: 'vertical' } }), 'overlapping_background');
    const site = new THREE.Mesh(geometry(), f.shared); f.root.add(site);
    fail(f.layer, f.layer.setData({ ...f.data, backgroundNodes: [site, site], raw: { mode: 'vertical' } }), 'ambiguous_background');
  });
  it.each(['skinned', 'instanced', 'morph', 'sprite'])('rejects unsupported %s floor geometry', (kind) => {
    const f = fixture(); let mesh;
    if (kind === 'skinned') mesh = new THREE.SkinnedMesh(geometry(), f.shared);
    if (kind === 'instanced') mesh = new THREE.InstancedMesh(geometry(), f.shared, 1);
    if (kind === 'morph') { const geom = geometry(); geom.morphAttributes.position = [geom.attributes.position.clone()]; mesh = new THREE.Mesh(geom, f.shared); }
    if (kind === 'sprite') mesh = new THREE.Sprite(new THREE.SpriteMaterial());
    f.upper.add(mesh); fail(f.layer, f.layer.setData({ ...f.data, raw: { mode: 'horizontal' } }), 'unsupported_floor_mesh');
    expect(f.upper.position.y).toBe(4);
  });
  it('does not treat explicit background as proof of independent skinned geometry or claim a safe rigid export', () => {
    const f = fixture(), background = new THREE.SkinnedMesh(geometry(), f.shared); f.root.add(background);
    fail(f.layer, f.layer.setData({ ...f.data, backgroundNodes: [background], raw: { mode: 'horizontal' } }), 'unsupported_background_mesh');
    expect(f.layer.setData({ ...f.data }).changed).toBe(false); expect(f.layer.report().valid).toBe(true);
    expect(f.layer.report().export).toMatchObject({ supported: false, reason: 'Skinned source export requires a supported skeleton-cloning adapter.' });
    expect(f.layer.cloneSourceRoot()).toMatchObject({ ok: false, root: null });
  });
  it('refuses exact level and ancestor writers but permits ordinary child transform writers', () => {
    const f = fixture();
    for (const writer of [f.upper, f.root, f.parent]) fail(f.layer, f.layer.setData({ ...f.data, transformWriters: new Set([writer]), raw: { mode: 'horizontal' } }), 'transform_writer');
    expect(f.layer.setData({ ...f.data, transformWriters: new Set([f.upperMesh]), raw: { mode: 'horizontal' } }).valid).toBe(true);
  });
  it('returns every owned target to source on a newly unclassified mesh instead of leaving a partial split', () => {
    const f = fixture(); f.scene.updateMatrixWorld(true); const before = [transform(f.ground), transform(f.upper)];
    f.layer.setData({ ...f.data, raw: { mode: 'horizontal', base_elevation_m: 2 } }); f.root.add(new THREE.Mesh(geometry(), f.shared));
    const result = f.layer.setData({ ...f.data, raw: { mode: 'horizontal', base_elevation_m: 2 } }); fail(f.layer, result, 'unclassified_geometry');
    expect(result.changed).toBe(true); expect([transform(f.ground), transform(f.upper)]).toEqual(before);
  });
  it('fails closed for malformed target/context fields, a collapsed parent and malformed policy', () => {
    for (const extra of [{ targets: null }, { targets: [{ floor_id: 'exact_ground', node: {} }] }, { backgroundNodes: null }, { transformWriters: [] }, { enabled: 'true' }, { modelRoot: null }, { floors: null }]) {
      const f = fixture(); expect(f.layer.setData({ ...f.data, ...extra, raw: { mode: 'horizontal' } })).toMatchObject({ changed: false, valid: false, mode: 'assembled' }); expect(f.layer.report().rows).toEqual([]);
    }
    const f = fixture(); f.parent.scale.y = 0; fail(f.layer, f.layer.setData({ ...f.data, raw: { mode: 'horizontal' } }), 'invalid_parent_transform');
    fail(f.layer, f.layer.setData({ ...f.data, raw: { mode: 'horizontal', gap_m: '2' } }), 'invalid_gap_m');
  });
  it('rejects invalid and degenerate actual geometry and never allocates a bounding-box cache on source geometry', () => {
    const f = fixture(); const original = f.upperMesh.geometry; expect(original.boundingBox).toBeNull();
    expect(f.layer.setData({ ...f.data, raw: { mode: 'vertical' } }).valid).toBe(true); expect(original.boundingBox).toBeNull(); f.layer.dispose();
    original.attributes.position.setX(0, NaN); original.attributes.position.needsUpdate = true;
    fail(f.layer, f.layer.setData({ ...f.data, raw: { mode: 'vertical' } }), 'invalid_bounds'); expect(f.upper.position.y).toBe(4);
  });
  it('rejects an unrepresentable additive offset atomically, even when source-world geometry is finite', () => {
    const f = fixture(); f.upper.position.y = 1e16; f.upperMesh.position.y = -1e16;
    f.scene.updateMatrixWorld(true); const before = [transform(f.ground), transform(f.upper)];
    const result = f.layer.setData({ ...f.data, raw: { mode: 'vertical', gap_m: .5 } });
    fail(f.layer, result, 'unrepresentable_translation'); expect([transform(f.ground), transform(f.upper)]).toEqual(before);
  });
});

describe('later transform writers and source export', () => {
  it('never overwrites a later external level position and latches ownership loss through recovery', () => {
    const f = fixture(); const raw = { mode: 'horizontal' }; f.layer.setData({ ...f.data, raw }); f.scene.updateMatrixWorld(true);
    f.upper.position.set(91, 92, 93); f.upper.updateMatrix(); const external = transform(f.upper);
    const result = f.layer.setData({ ...f.data, raw }); fail(f.layer, result, 'external_transform_writer'); expect(transform(f.upper)).toEqual(external);
    expect(f.layer.cloneSourceRoot()).toMatchObject({ ok: false, root: null });
    expect(f.layer.setData({ ...f.data, raw }).valid).toBe(false); expect(transform(f.upper)).toEqual(external);
    expect(f.layer.dispose().diagnostics).toEqual([]); expect(transform(f.upper)).toEqual(external);
  });
  it('refuses a stale mapping immediately after an external level write, before the next setData', () => {
    const f = fixture(); f.layer.setData({ ...f.data, raw: { mode: 'horizontal' } }); f.scene.updateMatrixWorld(true);
    f.upper.position.x += 7; f.upper.updateMatrix();
    expect(f.layer.sourceWorldToDisplay([0, 4, 0], 'exact_upper')).toMatchObject({ ok: false, point: null });
    expect(f.layer.displayWorldToSource([0, 0, 0], 'exact_upper')).toMatchObject({ ok: false, point: null });
    expect(f.layer.offsetForFloor('exact_upper')).toBeNull(); expect(f.layer.floorForNode(f.upperMesh)).toBeNull();
    expect(f.layer.report()).toMatchObject({ valid: false, rows: [] });
  });
  it('refuses old world offsets after an ancestor alignment change until setData re-evaluates it', () => {
    const f = fixture(); const raw = { mode: 'vertical' }; f.layer.setData({ ...f.data, raw }); f.scene.updateMatrixWorld(true);
    f.parent.scale.y = 2;
    expect(f.layer.sourceWorldToDisplay([0, 4, 0], 'exact_upper')).toMatchObject({ ok: false, point: null });
    expect(f.layer.report().valid).toBe(false);
    expect(f.layer.setData({ ...f.data, raw }).valid).toBe(true); expect(f.layer.sourceWorldToDisplay([0, 4, 0], 'exact_upper').ok).toBe(true);
  });
  it('restores still-owned peers when another floor acquires an external writer', () => {
    const f = fixture(); f.scene.updateMatrixWorld(true); const originalGround = transform(f.ground);
    const raw = { mode: 'horizontal', base_elevation_m: 2 }; f.layer.setData({ ...f.data, raw }); f.scene.updateMatrixWorld(true);
    f.upper.scale.x = 2; f.upper.updateMatrix(); const external = transform(f.upper);
    expect(f.layer.setData({ ...f.data, raw }).valid).toBe(false); expect(transform(f.ground)).toEqual(originalGround); expect(transform(f.upper)).toEqual(external);
  });
  it('does not restore an externally changed manual matrix or overwrite a changed update flag', () => {
    for (const kind of ['matrix', 'flag', 'reparent']) {
      const f = fixture(); f.upper.matrixAutoUpdate = false; f.upper.matrix.makeTranslation(0, 4, 0);
      f.layer.setData({ ...f.data, raw: { mode: 'vertical' } });
      if (kind === 'matrix') f.upper.matrix.elements[12] = 87;
      if (kind === 'flag') f.upper.matrixAutoUpdate = true;
      if (kind === 'reparent') f.parent.add(f.upper);
      const external = transform(f.upper), result = f.layer.dispose(); expect(codes(result)).toContain('external_transform_writer'); expect(transform(f.upper)).toEqual(external);
    }
  });
  it('reports old-root ownership loss without blocking a separately proven replacement model', () => {
    const old = fixture(), next = fixture(), layer = old.layer;
    layer.setData({ ...old.data, raw: { mode: 'vertical' } }); old.upper.position.x = 71; old.upper.updateMatrix(); const external = transform(old.upper);
    const result = layer.setData({ ...next.data, raw: { mode: 'vertical' } });
    expect(result).toMatchObject({ valid: true, mode: 'vertical' }); expect(codes(result)).toContain('external_transform_writer');
    expect(transform(old.upper)).toEqual(external); expect(next.upper.position.y).toBe(6); expect(layer.cloneSourceRoot().ok).toBe(true);
    layer.dispose(); expect(next.upper.position.y).toBe(4);
  });
  it('clones source transforms for export without ever moving the live display or cloning/disposal of assets', () => {
    const f = fixture(); f.upper.matrixAutoUpdate = false; f.upper.matrix.makeRotationY(.3); f.upper.matrix.setPosition(0, 4, 0);
    f.scene.updateMatrixWorld(true); const original = transform(f.upper), geometry = f.upperMesh.geometry, material = f.upperMesh.material;
    const geometryDispose = vi.spyOn(geometry, 'dispose'), materialDispose = vi.spyOn(material, 'dispose');
    f.layer.setData({ ...f.data, raw: { mode: 'horizontal' } }); f.scene.updateMatrixWorld(true); const current = transform(f.upper);
    const positionWrite = vi.spyOn(f.upper.position, 'copy'), matrixWrite = vi.spyOn(f.upper.matrix, 'copy');
    expect(f.layer.report().export).toMatchObject({ supported: true, strategy: 'clone_source_transforms' }); const exported = f.layer.cloneSourceRoot();
    expect(exported).toMatchObject({ ok: true, diagnostics: [] }); expect(exported.root).not.toBe(f.root);
    const cloneFloor = exported.root.children[1]; expect(cloneFloor.matrix.toArray()).toEqual(original.matrix); expect(cloneFloor.matrixAutoUpdate).toBe(false);
    expect(cloneFloor.position.toArray()).toEqual(original.position); expect(cloneFloor.children[0].geometry).toBe(geometry); expect(cloneFloor.children[0].material).toBe(material);
    expect(transform(f.upper)).toEqual(current); expect(positionWrite).not.toHaveBeenCalled(); expect(matrixWrite).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled(); f.layer.dispose(); expect(transform(f.upper)).toEqual(original);
  });
  it('returns isolated report/offset copies and keeps all input settings/floor arrays untouched', () => {
    const f = fixture(), raw = Object.freeze({ mode: 'horizontal', floors: Object.freeze(['exact_upper', 'exact_ground']), extension: Object.freeze({ preserved: true }) });
    const floors = Object.freeze(f.data.floors.map((floor) => Object.freeze({ ...floor }))), before = JSON.stringify({ raw, floors });
    expect(f.layer.setData({ ...f.data, floors, raw }).valid).toBe(true);
    const report = f.layer.report(), offset = f.layer.offsetForFloor('exact_upper'); report.rows[0].offset[0] = 50; report.rows[0].bounds.min[0] = 51; offset[1] = 52;
    expect(f.layer.report().rows[0].offset).not.toEqual(report.rows[0].offset); expect(f.layer.report().rows[0].bounds.min[0]).not.toBe(51);
    expect(JSON.stringify({ raw, floors })).toBe(before); f.layer.dispose();
  });
});
