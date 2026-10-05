// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FloorplanView } from '../src/view.js';
import { ObjectLayer } from '../src/objects/layer.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import { nodeIndex } from '../src/views.js';

const all = [];
const near = (actual, expected) => (actual.toArray ? actual.toArray() : actual).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
const states = { 'light.lamp': { entity_id: 'light.lamp', state: 'on', attributes: { supported_color_modes: ['rgb'], color_mode: 'rgb', brightness: 128, rgb_color: [255, 70, 30] } },
  'climate.room': { entity_id: 'climate.room', state: 'heat', attributes: { current_temperature: 21, hvac_action: 'heating' } } };
function fixture({ spot = false, mower = false, unclassified = false, third = false, transformed = false, tagged = true } = {}) {
  const root = new THREE.Group(), ground = new THREE.Group(), upper = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  ground.userData.fp = { kind: 'level', id: 'level_ground', elevation: 0, role: 'storey' };
  upper.userData.fp = { kind: 'level', id: 'level_upper', elevation: 4, role: 'storey' }; upper.position.y = 4;
  root.add(ground, upper);
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 6), material), mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 6), material);
  base.position.y = mesh.position.y = 1; ground.add(base); upper.add(mesh);
  const door = new THREE.Group(), leaf = new THREE.Group(); door.position.x = 2; upper.add(door); door.add(leaf);
  const add = (id, type, position, hints = {}) => {
    const node = new THREE.Group(); node.userData.fp = { kind: 'object', id, type, hints }; node.position.set(...position); leaf.add(node);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), material); glow.name = 'glow'; node.add(glow); return node;
  };
  const lamp = add('lamp', 'light', [1, 1.5, -1], spot ? { beam: 'spot', target: [0, 4, 0] } : {});
  const climate = add('climate', 'climate', [-1, 1, 0]); const robot = mower ? add('robot', 'mower', [0, .2, 0]) : null;
  if (mower === 'ground') ground.add(robot);
  const floors = [{ id: 'lower', elevation: 0, height: 2.7 }, { id: 'upper', elevation: 4, height: 2.7 }];
  const targets = [{ floor_id: 'lower', node: ground }, { floor_id: 'upper', node: upper }];
  let extra;
  if (third) { extra = new THREE.Group(); extra.position.y = 9; extra.add(new THREE.Mesh(new THREE.BoxGeometry(8, 2, 6), material)); root.add(extra); floors.push({ id: 'third', elevation: 9 }); targets.push({ floor_id: 'third', node: extra }); }
  if (unclassified) root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  const view = Object.create(FloorplanView.prototype), canvas = document.createElement('canvas'); document.body.append(canvas);
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } }); canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, .1, 1000); camera.position.set(12.123456789, 10.987654321, 16.123456789);
  Object.assign(view, { scene: new THREE.Scene(), modelGroup: new THREE.Group(), objectsGroup: new THREE.Group(), staticGroup: new THREE.Group(), markerGroup: new THREE.Group(),
    overlayGroup: new THREE.Group(), glowGroup: new THREE.Group(), stemGroup: new THREE.Group(), mowerGroup: new THREE.Group(),
    floors, cssObjects: [], markerObjects: new Map(), glows: new Map(), stems: new Map(), visibleFloor: 'all', mode: '3d', size: { w: 800, h: 600 },
    camera, persp: camera, ortho: new THREE.OrthographicCamera(-5, 5, 5, -5), raycaster: new THREE.Raycaster(),
    renderer: { domElement: canvas, shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false }, clippingPlanes: [], render: vi.fn(), info: { render: { calls: 0 } } },
    sun: new THREE.DirectionalLight(0xffffff, 1), sky: { sunDir: null }, _raf: null, _occGen: 0, _occTimer: null, _occlusion: true,
    modelClip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), sectionClip: null,
    stats: { shadow: 0, shadowLights: 0, frames: 0, occPasses: 0, occPartial: 0, occDone: 0 },
    theme: { floor: 0xdddddd, outdoor: 0xbbbbbb, wall: 0xcccccc, edge: 0x444444 },
    _rooms: [{ floorId: 'upper', room: { id: 'room', polygon: [[0, 0], [3, 0], [3, 2], [0, 2]] }, label: 'Room' }],
    _placeSkyBodies: vi.fn(), _applyMoonLight: vi.fn(), _applyLook: vi.fn(), onObjectsInvalidate: vi.fn(),
    pickHelper: null, _zoomTo: 'cursor' });
  view._makeControls(); view.controls.target.set(1.123456789, .23456789, -2.3456789); view.controls.update();
  view.scene.add(view.modelGroup, view.objectsGroup, view.staticGroup, view.markerGroup, view.overlayGroup, view.glowGroup, view.stemGroup, view.mowerGroup, view.sun);
  view.modelGroup.add(root);
  if (transformed) { view.modelGroup.rotation.y = .65; view.modelGroup.scale.set(1.4, .8, 2.2); view.modelGroup.position.set(-6, 2, 9); }
  const model = { id: 'house', root, manifest: buildManifest(threeAdapter(root)), tagged, opacity: 1 }; view.model = model;
  view.modelLevels = { level_ground: { floor: 'lower' }, level_upper: { floor: 'upper' } };
  root.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const objects = new ObjectLayer(view); objects.setModel(model); objects.setBindings(new Map([['lamp', { entity: 'light.lamp' }], ['climate', { entity: 'climate.room' }], ['robot', { entity: 'lawn_mower.robot' }]]), {});
  objects.update(states); view._captureModelMotion(); view._bounds = view._sceneBounds(); view._shadowSig = view._modelSig();
  view.dirty = false; view.stats.shadow = 0; view.stats.shadowLights = 0;
  const options = { floors, targets, backgroundNodes: [], transformWriters: new Set() };
  const f = { view, objects, model, root, ground, upper, base, mesh, door, leaf, lamp, climate, robot, extra, material, floors, targets, options, canvas }; all.push(f); return f;
}
const split = (f, raw = { mode: 'horizontal', gap_m: 2 }, options = {}) => f.view.setFloorPresentation(raw, { ...f.options, ...options });
const snapshot = (view) => ({ revision: view.floorPresentationRevision, stats: { ...view.stats }, dirty: view.dirty });
afterEach(() => { for (const f of all.splice(0)) { f.view._releaseFloorPresentation(); f.objects.dispose(); f.view.controls.dispose(); f.view._cancelOcclusion(); f.canvas.remove(); } vi.restoreAllMocks(); });

describe('SOURCE data and DISPLAY model/light ownership', () => {
  it('default/assembled is a true rendering and authored-transform no-op, even for unsupported geometry', () => {
    const f = fixture({ unclassified: true }), before = snapshot(f.view), source = f.upper.position.clone();
    const position = vi.spyOn(f.upper.position, 'copy'), refresh = vi.spyOn(f.objects, 'refreshFloorPresentation'), shadow = vi.spyOn(f.view, '_shadowDirty');
    for (const raw of [undefined, { mode: 'assembled' }, { mode: 'assembled', future: 7 }]) expect(f.view.setFloorPresentation(raw, f.options)).toMatchObject({ mode: 'assembled', valid: true });
    expect(snapshot(f.view)).toEqual(before); expect(position).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled(); expect(shadow).not.toHaveBeenCalled(); expect(f.upper.position.equals(source)).toBe(true);
  });
  it.each(['horizontal', 'vertical'])('moves physical $mode geometry, lights and status labels while keeping exact public source anchors', (mode) => {
    const f = fixture(), source = f.objects.anchorOf('lamp'), local = f.objects.parts.get('lamp').part.anchor.clone(), labelSource = f.objects.anchorOf('climate');
    const slot = f.objects._slots.get('lamp'), pool = [...f.objects.pool.points, ...f.objects.pool.spots], publicResult = f.objects.objectAt('lamp').result;
    expect(split(f, { mode, gap_m: 3 })).toMatchObject({ valid: true, mode });
    const offset = f.view.floorPresentationReport().rows.find((row) => row.floor_id === 'upper').offset;
    expect(f.objects.anchorOf('lamp').toArray()).toEqual(source.toArray()); expect(f.objects.parts.get('lamp').part.anchor.toArray()).toEqual(local.toArray());
    near(f.objects.displayAnchorOf('lamp'), source.toArray().map((value, i) => value + offset[i])); near(slot.light.position, f.objects.displayAnchorOf('lamp').toArray());
    near(f.objects.parts.get('climate').part.label.position, labelSource.toArray().map((value, i) => value + offset[i]));
    expect(f.objects.objectAt('lamp').result).toBe(publicResult); expect(f.objects._slots.get('lamp')).toBe(slot); expect([...f.objects.pool.points, ...f.objects.pool.spots]).toEqual(pool);
    expect(f.view.floorElevation('upper')).toBe(4); expect(f.view.displayFloorElevation('upper')).toBe(4 + offset[1]); expect(f.view.floorForModelNode(f.lamp)).toBe('upper');
    expect(f.objects.anchors().find((entry) => entry.id === 'lamp').world.toArray()).toEqual(source.toArray());
    expect(f.objects.displayAnchors().find((entry) => entry.id === 'lamp').world.toArray()).toEqual(f.objects.displayAnchorOf('lamp').toArray());
  });
  it('known unselected floors retain identity; unknown and ambiguous floor mappings fail explicitly', () => {
    const f = fixture({ third: true }); split(f, { mode: 'horizontal', floors: ['lower', 'upper'] });
    expect(f.view.sourceWorldToDisplay([3, 10, -2], 'third')).toMatchObject({ ok: true, point: [3, 10, -2] }); expect(f.view.floorForModelNode(f.extra.children[0])).toBe('third');
    expect(f.view.displayWorldToSource([3, 10, -2], 'missing').ok).toBe(false);
    split(f, { mode: 'horizontal' }, { floors: [...f.floors, { id: 'third', elevation: 11 }] });
    expect(f.view.floorPresentationActive).toBe(false); expect(f.view.sourceWorldToDisplay([0, 0, 0], 'third').ok).toBe(false);
  });
  it('equal fresh settings and HA snapshots cause zero dirty/shadow/light-slot/anchor writes', () => {
    const f = fixture(); split(f); f.objects.update(states); f.view.dirty = false;
    const before = snapshot(f.view), position = vi.spyOn(f.upper.position, 'copy'), dirty = vi.spyOn(f.view, 'markDirty'), shadow = vi.spyOn(f.view, 'requestShadowUpdate');
    const slot = f.objects._slots.get('lamp'), lampWrite = vi.spyOn(slot.light.position, 'copy'), budget = f.objects.stats.budget;
    for (let i = 0; i < 10; i++) { split(f, { mode: 'horizontal', gap_m: 2, extension: i }, { floors: f.floors.map((floor) => ({ ...floor })) }); f.objects.update(structuredClone(states)); }
    expect(snapshot(f.view)).toEqual(before); expect(position).not.toHaveBeenCalled(); expect(lampWrite).not.toHaveBeenCalled(); expect(dirty).not.toHaveBeenCalled(); expect(shadow).not.toHaveBeenCalled(); expect(f.objects.stats.budget).toBe(budget);
  });
  it('the first equal HA refresh after a display-only floor transition performs no duplicate pool/label writes', () => {
    const f = fixture(); split(f); f.view.dirty = false;
    const slot = f.objects._slots.get('lamp'), position = vi.spyOn(slot.light.position, 'copy'), label = vi.spyOn(f.objects.parts.get('climate').part.label.position, 'copy');
    const before = snapshot(f.view), budget = f.objects.stats.budget;
    f.objects.update(structuredClone(states)); expect(position).not.toHaveBeenCalled(); expect(label).not.toHaveBeenCalled(); expect(snapshot(f.view)).toEqual(before); expect(f.objects.stats.budget).toBe(budget);
  });
  it('supported child hinge motion changes only the true source anchor and displays it with one floor offset', () => {
    const f = fixture(); split(f); const before = f.objects.anchorOf('lamp'), revision = f.view.floorPresentationRevision, row = f.view.floorPresentationReport().rows[1];
    f.leaf.rotation.y = Math.PI / 2; const moved = f.view.modelMotionChanged([f.leaf]);
    expect(moved.changed).toBe(true); expect(moved.objectIds.has('lamp')).toBe(true); expect(f.objects.anchorOf('lamp').distanceTo(before)).toBeGreaterThan(.5);
    near(f.objects.displayAnchorOf('lamp'), f.objects.anchorOf('lamp').toArray().map((value, i) => value + row.offset[i]));
    split(f); expect(f.view.floorPresentationRevision).toBe(revision); expect(f.view.floorPresentationReport().rows[1].offset).toEqual(row.offset);
  });
  it('source anchors remain source after preparing ObjectLayer while floors are already displayed', () => {
    const f = fixture(), before = f.objects.anchorOf('lamp'); f.objects.setModel(null); split(f); f.objects.setModel(f.model); f.objects.update(states);
    near(f.objects.anchorOf('lamp'), before.toArray()); near(f.objects._slots.get('lamp').light.position, f.objects.displayAnchorOf('lamp').toArray());
  });
  it('explicit spot targets use the same display offset while source hints stay untouched', () => {
    const f = fixture({ spot: true }), hints = f.objects.parts.get('lamp').part.hints.target.slice(); split(f);
    near(f.objects._slots.get('lamp').light.target.position, f.view.sourceWorldToDisplay(hints, 'upper').point);
    expect(f.objects.parts.get('lamp').part.hints.target).toEqual(hints);
  });
  it('source mesh triangles and footprint fallback remain canonical while rendered triangles actually move', () => {
    const f = fixture(), triangles = f.view.meshTriangles(f.mesh), rect = f.view.meshPlanRect(f.mesh), world = f.mesh.getWorldPosition(new THREE.Vector3()); split(f);
    expect(f.mesh.getWorldPosition(new THREE.Vector3()).equals(world)).toBe(false); expect(f.view.meshTriangles(f.mesh)).toEqual(triangles); expect(f.view.meshPlanRect(f.mesh)).toEqual(rect);
  });
  it('clones a source hierarchy for export without touching live floors/shared resources or live hinge transforms', () => {
    const f = fixture(); split(f); f.leaf.rotation.y = .7; const before = f.upper.position.clone(), geometry = f.mesh.geometry;
    const result = f.view.sourceModelRootForExport(); expect(result.ok).toBe(true); expect(result.root).not.toBe(f.root);
    expect(result.root.children[1].position.toArray()).toEqual([0, 4, 0]); expect(result.root.children[1].children[0].geometry).toBe(geometry);
    expect(result.root.children[1].children[1].children[0].rotation.y).toBeCloseTo(.7); expect(f.upper.position.equals(before)).toBe(true);
  });
  it('rejects an unclassified model atomically and leaves all known markers and lights assembled', () => {
    const f = fixture({ unclassified: true }), source = f.objects.anchorOf('lamp'); expect(split(f)).toMatchObject({ valid: false, mode: 'assembled', rows: [] });
    expect(f.upper.position.toArray()).toEqual([0, 4, 0]); expect(f.objects.displayAnchorOf('lamp').toArray()).toEqual(source.toArray()); expect(f.view.floorPresentationRevision).toBe(0);
  });
  it('a measured mower pose uses its reported floor rather than its authored parent floor, including split/resume', () => {
    const f = fixture({ mower: true }), part = f.objects.parts.get('robot').part, authored = f.robot.position.clone();
    f.objects.setMowerPose({ x: 1, y: 2, floorId: 'lower', heading: .3 }); const source = f.objects.anchorOf('robot');
    split(f); near(f.objects.anchorOf('robot'), source.toArray()); near(f.robot.getWorldPosition(new THREE.Vector3()), [1, .2, -2]);
    f.objects.setMowerPose({ x: 2, y: 1, floorId: 'upper', heading: .7 }); const offset = f.view.floorPresentationReport().rows[1].offset;
    near(f.robot.getWorldPosition(new THREE.Vector3()), [2 + offset[0], 4.2 + offset[1], -1 + offset[2]]);
    near(f.objects.anchorOf('robot'), [2, 4.2, -1]); expect(part.displayFloorId).toBe('upper');
    split(f, { mode: 'assembled' }); near(f.robot.getWorldPosition(new THREE.Vector3()), [2, 4.2, -1]);
    split(f); f.objects.setMowerPose(null); expect(part.displayFloorId).toBeUndefined(); expect(f.robot.position.toArray()).toEqual(authored.toArray());
  });
  it('source export removes cross-floor mower display compensation without rewriting the live pose', () => {
    const f = fixture({ mower: true }); split(f); f.objects.setMowerPose({ x: 1, y: 2, floorId: 'lower', heading: .3 });
    const before = f.robot.position.clone(), result = f.view.sourceModelRootForExport();
    const robot = result.root.children[1].children[1].children[0].children.find((node) => node.userData.fp?.id === 'robot');
    near(robot.getWorldPosition(new THREE.Vector3()), [1, .2, -2]); expect(f.robot.position.equals(before)).toBe(true);
  });
  it('child writer add/remove/reorder and owned helpers never repack around a cross-floor DISPLAY mower pose', () => {
    const f = fixture({ mower: 'ground' }); split(f); f.objects.setMowerPose({ x: 1, y: 0, floorId: 'upper', heading: 0 });
    const rows = f.view.floorPresentationReport().rows, revision = f.view.floorPresentationRevision;
    const measure = vi.spyOn(f.view._floorPresentation, '_measure'), position = vi.spyOn(f.upper.position, 'copy');
    const helper = new THREE.Group(); helper.userData.helper = true; helper.add(new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), f.material)); f.root.add(helper);
    for (const writers of [[f.leaf], [f.base, f.leaf], [f.leaf, f.base], [], [f.leaf]]) {
      f.leaf.rotation.y += .1;
      expect(split(f, { mode: 'horizontal', gap_m: 2 }, { transformWriters: new Set(writers) })).toMatchObject({ mode: 'horizontal', valid: true });
      expect(f.view.floorPresentationReport().rows).toEqual(rows); expect(f.view.floorPresentationRevision).toBe(revision);
      near(f.objects.anchorOf('robot'), [1, 4.2, 0]);
    }
    expect(measure).not.toHaveBeenCalled(); expect(position).not.toHaveBeenCalled();
    expect(f.view.sourceModelRootForExport().root.children.some((node) => node.userData.helper)).toBe(true);
  });
  it('structural and alignment remeasurement use measured SOURCE mower coordinates without changing its live display pose early', () => {
    const f = fixture({ mower: 'ground' }); split(f); f.objects.setMowerPose({ x: 1, y: 0, floorId: 'upper', heading: 0 });
    const before = f.robot.position.clone(), writes = vi.spyOn(f.robot.position, 'copy');
    near(f.objects.sourcePosePositions().get(f.robot), [1, 4.2, 0]); expect(writes).not.toHaveBeenCalled(); expect(f.robot.position.equals(before)).toBe(true);
    const extension = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), f.material); extension.position.set(5, .5, 0); f.ground.add(extension);
    split(f); let report = f.view.floorPresentationReport(); expect(report.rows[0].bounds.max[0]).toBe(6); expect(report.rows[1].offset[0]).toBe(12);
    near(f.objects.anchorOf('robot'), [1, 4.2, 0]); near(f.robot.getWorldPosition(new THREE.Vector3()), [13, .2, 0]);
    f.view.modelGroup.position.x += 3; split(f); report = f.view.floorPresentationReport();
    expect(report.rows[0].bounds.max[0]).toBe(9); expect(report.rows[1].offset[0]).toBe(12); near(f.objects.anchorOf('robot'), [1, 4.2, 0]);
    const fresh = f.objects.sourcePosePositions(); fresh.get(f.robot)[0] = 1000; near(f.objects.sourcePosePositions().get(f.robot), [1, 4.2, 0]);
  });
  it.each(['missing', 'duplicate', 'nonfinite', 'stale'])('does not guess elevation0 for %s measured source floor during packing', (kind) => {
    const f = fixture({ mower: 'ground' }); split(f); f.objects.setMowerPose({ x: 1, y: 0, floorId: 'upper', heading: 0 });
    const floors = f.floors.map((floor) => ({ ...floor }));
    if (kind === 'missing') floors.splice(1, 1);
    if (kind === 'duplicate') floors.push({ ...floors[1] });
    if (kind === 'nonfinite') floors[1].elevation = NaN;
    if (kind === 'stale') floors[1].stale = true;
    const result = split(f, { mode: 'horizontal', gap_m: 2 }, { floors });
    expect(result).toMatchObject({ mode: 'assembled', valid: false, rows: [] });
    expect(result.diagnostics.some((entry) => entry.code === 'invalid_source_pose')).toBe(true);
  });
  it('restores then remeasures after genuine parent alignment changes; no offset accumulates', () => {
    const f = fixture({ transformed: true }); split(f); const before = f.objects.parts.get('lamp').part.anchor.clone();
    f.view.modelGroup.position.x += 7; split(f); const row = f.view.floorPresentationReport().rows[1], source = f.objects.anchorOf('lamp');
    expect(f.objects.parts.get('lamp').part.anchor.toArray()).toEqual(before.toArray()); near(f.objects.displayAnchorOf('lamp'), source.toArray().map((value, i) => value + row.offset[i]));
    f.view.setFloorPresentation(undefined, f.options); near(f.upper.position, [0, 4, 0]); expect(f.objects.displayAnchorOf('lamp').toArray()).toEqual(source.toArray());
  });
  it('same-source setModel placement remeasures source geometry and retains exact source-local object anchors', async () => {
    const f = fixture(), local = f.objects.parts.get('lamp').part.anchor.clone(); split(f);
    expect(await f.view.setModel({ id: 'house', position: [7, -3, 2], rotation: 37, scale: 1.4 })).toBeNull();
    expect(f.objects.parts.get('lamp').part.anchor.toArray()).toEqual(local.toArray());
    near(f.objects._slots.get('lamp').light.position, f.objects.displayAnchorOf('lamp').toArray());
    split(f, { mode: 'assembled' }); near(f.upper.position, [0, 4, 0]);
  });
  it('releases presentation before merging so source buffers never contain a baked display translation', () => {
    const f = fixture(), measure = f.view.meshPlanRect(f.mesh), offset = split(f).rows[1].offset;
    f.view._mergeModel([], 1); expect(f.upper.position.toArray()).toEqual([0, 4, 0]);
    f.view._afterMerge(); expect(f.view.floorPresentationActive).toBe(true); expect(f.view.floorPresentationReport().rows[1].offset).toEqual(offset);
    const geometry = f.upper.children.find((node) => node.isMesh); expect(f.view.meshPlanRect(geometry)).toEqual(measure);
  });
});

describe('plan drawing, editing and Section use one explicit display adapter', () => {
  it('moves existing room shapes/markers/glows/handles/map/trail/stems, preserving every source input', () => {
    const f = fixture(), { view } = f;
    view.setStructure(f.floors, view._rooms, { walls: false }); view.setMarkers([{ id: 'marker', element: document.createElement('button'), x: 1, y: 2, z: 1, floorId: 'upper' }]); view.setStems(true);
    const handle = document.createElement('button'); view.setOverlay({ handles: [{ element: handle, x: 2, y: 1, floorId: 'upper' }], fills: [{ points: [[0, 0], [2, 0], [2, 1]], floorId: 'upper', color: 0xff0000 }], lines: [{ points: [[0, 0], [2, 1]], floorId: 'upper', color: 0xff0000 }] });
    view.glows.set('marker', { floorId: 'upper', mesh: new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()) }); view.glows.get('marker').mesh.position.set(1, 4.03, -2);
    view.mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); view.mapPlane.position.set(0, 4.015, 0); view.mapPlane.userData.floorId = 'upper';
    view.setTrail([[0, 0], [1, 1]], 'upper'); const rooms = structuredClone(view._rooms), floors = structuredClone(f.floors); split(f);
    const offset = view.floorPresentationReport().rows[1].offset;
    near(view.markerObjects.get('marker').obj.position, [1 + offset[0], 5 + offset[1], -2 + offset[2]]);
    near(view.glows.get('marker').mesh.position, [1 + offset[0], 4.03 + offset[1], -2 + offset[2]]);
    near(view.staticGroup.children[1].position, [offset[0], 4 + offset[1], offset[2]]);
    near(view.overlayGroup.children[0].position, [offset[0], 4.02 + offset[1], offset[2]]);
    near(view.overlayGroup.children[1].position, [offset[0], 4.03 + offset[1], offset[2]]);
    near(view.cssObjects.find((entry) => entry.kind === 'handle').obj.position, [2 + offset[0], 4.03 + offset[1], -1 + offset[2]]);
    near(view.mapPlane.position, [offset[0], 4.015 + offset[1], offset[2]]); near(view.trail.position, [offset[0], 4.04 + offset[1], offset[2]]);
    expect(view.stems.get('marker').line.userData.height).toBe(1); expect(view._rooms).toEqual(rooms); expect(f.floors).toEqual(floors);
    split(f, { mode: 'assembled' }); near(view.markerObjects.get('marker').obj.position, [1, 5, -2]); near(view.staticGroup.children[1].position, [0, 4, 0]); near(view.trail.position, [0, 4.04, 0]);
  });
  it('new/moved markers and handles use source inputs once and remain on the correct floor after reassembly', () => {
    const f = fixture(), handle = document.createElement('button'); split(f); f.view.setMarkers([{ id: 'm', element: document.createElement('button'), x: 1, y: 2, z: 1, floorId: 'upper' }]);
    f.view.setOverlay({ handles: [{ element: handle, x: 2, y: 1, floorId: 'upper' }] }); f.view.moveMarker('m', 3, 4, 2, 'upper'); f.view.moveHandle(handle, 5, 6, 'upper');
    const row = f.view.floorPresentationReport().rows[1]; near(f.view.markerObjects.get('m').obj.position, [3 + row.offset[0], 6 + row.offset[1], -4 + row.offset[2]]);
    split(f, { mode: 'assembled' }); near(f.view.markerObjects.get('m').obj.position, [3, 6, -4]); near(f.view.cssObjects.find((entry) => entry.kind === 'handle').obj.position, [5, 4.03, -6]);
  });
  it('an equal radial glow/map update immediately after split stays idle because participants already moved', () => {
    const f = fixture(), glow = { id: 'one', x: 1, y: 2, floorId: 'upper', rgb: [255, 70, 30], strength: .5 };
    f.view.glows.set('one', { floorId: 'upper', mesh: new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()) }); f.view.setGlows([glow]);
    const map = { url: 'already-loaded.png', x: 1, y: 2, floorId: 'upper', width: 5 }; f.view.mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: new THREE.Texture() })); f.view.mapPlane.userData.url = map.url; f.view.setMapOverlay(map);
    split(f); f.view.dirty = false; const material = f.view.glows.get('one').mesh.material, color = vi.spyOn(material.color, 'setRGB'), position = vi.spyOn(f.view.mapPlane.position, 'copy');
    const before = snapshot(f.view); f.view.setGlows([glow]); f.view.setMapOverlay(map);
    expect(snapshot(f.view)).toEqual(before); expect(color).not.toHaveBeenCalled(); expect(position).not.toHaveBeenCalled();
  });
  it('Section suspends geometry/labels/lights and clearing it resumes the exact saved policy', () => {
    const f = fixture({ tagged: false }), source = f.objects.anchorOf('lamp'); split(f); const raw = f.view._floorRaw;
    f.view.setSection({ normal: [1, 0, 0], constant: 0 }); expect(f.view.floorPresentationReport()).toMatchObject({ mode: 'assembled', suspended: true, suspension: 'section' });
    near(f.upper.position, [0, 4, 0]); near(f.objects._slots.get('lamp').light.position, source.toArray()); expect(f.view._floorRaw).toBe(raw);
    f.view.setSection(null); expect(f.view.floorPresentationActive).toBe(true); near(f.objects._slots.get('lamp').light.position, f.objects.displayAnchorOf('lamp').toArray());
  });
  it('legacy single-storey clipping is disabled while split and restored to its source height on suspension', () => {
    const f = fixture({ tagged: false }); f.view.visibleFloor = 'upper'; f.view._applyFloorVisibility(); expect(f.view.modelClip.constant).toBe(6.7);
    split(f); expect(f.view.modelClip.constant).toBe(1e6); split(f, { mode: 'horizontal' }, { enabled: false }); expect(f.view.modelClip.constant).toBe(6.7);
  });
  it('drawn-plan-only floors compile from explicit source polygons without needing GLB nodes', () => {
    const f = fixture(); f.objects.setModel(null); f.view.modelGroup.remove(f.root); f.view.model = null;
    const bounds = [{ floor_id: 'lower', min: [-4, 0, -3], max: [4, 0, 3] }, { floor_id: 'upper', min: [-2, 4, -1], max: [2, 4, 1] }];
    expect(split(f, { mode: 'horizontal' }, { bounds })).toMatchObject({ valid: true, mode: 'horizontal' });
    expect(f.view.sourceWorldToDisplay([0, 4, 0], 'upper')).toMatchObject({ ok: true, point: [8, 0, 0] });
    expect(split(f, { mode: 'horizontal' }, { bounds: [bounds[0]] })).toMatchObject({ valid: false, mode: 'assembled', rows: [] });
  });
  it('display plan picking returns canonical saved coordinates and screen projection matches rendered markers', () => {
    const f = fixture(); split(f); const source = [1, 5, -2], display = f.view.sourceWorldToDisplay(source, 'upper').point;
    const screen = f.view.screenPoint(1, 2, 1, 'upper'); near(screen, f.view.projectWorld(new THREE.Vector3(...display)));
    near(f.view.displayPlanPoint(...screen, 'upper', 1), [1, 2]); expect(f.view.displayPlanPoint(...screen, 'missing')).toBeNull();
  });
  it('selected wall cut heights use copied display floor elevations; original HA/source floor data stay unchanged', () => {
    const f = fixture(), index = nodeIndex(threeAdapter(f.root), f.model.manifest), path = index.nodes.find((row) => row.node === f.mesh).path;
    const raw = { enabled: true, mode: 'cutaway', scope: 'all_selected', transition_ms: 0, cut_height_m: 1, walls: [{ id: 'upper-wall', selector: 'node:' + path, floor_id: 'upper' }] };
    const floors = structuredClone(f.floors); f.view.setWallPresentation(raw, { index, floors: f.floors }); expect(f.view._wallPresentation.cutHeight(f.mesh)).toBe(5);
    const material = f.mesh.material; split(f); expect(f.view._wallPresentation.cutHeight(f.mesh)).toBe(1); expect(f.mesh.material).toBe(material);
    split(f, { mode: 'vertical', gap_m: 3 }); expect(f.view._wallPresentation.cutHeight(f.mesh)).toBe(8); expect(f.mesh.material).toBe(material);
    split(f, { mode: 'assembled' }); expect(f.view._wallPresentation.cutHeight(f.mesh)).toBe(5); expect(f.floors).toEqual(floors);
    f.view._wallPresentation.dispose();
  });
  it('frame/depth bounds follow actual displayed room/model extents rather than only the assembled footprint', () => {
    const f = fixture(); const before = f.view._sceneBounds().house.clone(); split(f);
    const after = f.view._sceneBounds().house; expect(after.max.x).toBeGreaterThan(before.max.x); expect(after.max.y).toBeLessThan(before.max.y);
    f.view.visibleFloor = 'upper'; f.view.fit({ instant: true }); expect(f.view.controls.target.y).toBe(0);
  });
  it('model teardown restores authored floor transforms before geometry disposal and restores independent markers', () => {
    const f = fixture(); f.view.setMarkers([{ id: 'm', element: document.createElement('button'), x: 1, y: 2, z: 1, floorId: 'upper' }]); split(f);
    const dispose = vi.spyOn(f.mesh.geometry, 'dispose').mockImplementation(() => { expect(f.upper.position.toArray()).toEqual([0, 4, 0]); });
    f.view._disposeModel(); expect(dispose).toHaveBeenCalled(); expect(f.view.floorPresentationActive).toBe(false); near(f.view.markerObjects.get('m').obj.position, [1, 5, -2]); expect(f.view.model).toBeNull();
  });
  it('shadows-off remains centrally suppressed through split/suspend/hinge transitions with the same fixed pool', () => {
    const f = fixture(); f.view.setModelRendering({ shadows: 'off' }); const pool = [...f.objects.pool.points, ...f.objects.pool.spots], before = { ...f.view.stats };
    split(f); f.leaf.rotation.y = .5; f.view.modelMotionChanged([f.leaf]); split(f, { mode: 'assembled' }); split(f);
    expect(f.view.stats.shadow).toBe(before.shadow); expect(f.view.stats.shadowLights).toBe(before.shadowLights); expect(f.view.renderer.shadowMap.needsUpdate).toBe(false); expect([...f.objects.pool.points, ...f.objects.pool.spots]).toEqual(pool);
  });
});

describe('raw camera frame is exact and guarded by the current View lifecycle', () => {
  it('restores source framing limits after fitting separated floors so the next ordinary update cannot clamp the source pose', () => {
    const f = fixture(), { view } = f;
    view._rooms.push({ floorId: 'lower', room: { id: 'lower-room', polygon: [[0, 0], [3, 0], [3, 2], [0, 2]] } });
    view.fit({ instant: true }); expect(view.controls.minDistance).toBe(1);
    view.setCamera({ position: [0, 1, 2], target: [0, 0, 0] }, { instant: true }); const frame = view.captureCameraFrame();
    split(f); view.fit({ instant: true }); expect(view.controls.minDistance).toBe(4);
    split(f, { mode: 'assembled' }); expect(view.restoreCameraFrame(frame)).toBe(true);
    view.controls.update(); near(view.camera.position, frame.position); expect(view.controls.minDistance).toBe(1);
  });
  it('restores Top world-scale framing after a split fit while respecting the current viewport aspect', () => {
    const f = fixture(), { view } = f;
    view._rooms.push({ floorId: 'lower', room: { id: 'lower-room', polygon: [[0, 0], [3, 0], [3, 2], [0, 2]] } });
    view.setMode('top'); view.setTopCamera({ center: [1.11111111, 2.22222222], zoom: 3 }, { instant: true }); const frame = view.captureCameraFrame();
    split(f); view.fit({ instant: true }); expect(view._orthoHalf).toBeGreaterThan(frame.framing.orthoHalf);
    view.size = { w: 1024, h: 768 }; view._updateOrtho(); split(f, { mode: 'assembled' }); expect(view.restoreCameraFrame(frame)).toBe(true);
    expect(view._orthoHalf).toBe(frame.framing.orthoHalf); expect(view.ortho.top).toBe(frame.framing.orthoHalf);
    expect(view.ortho.right).toBeCloseTo(frame.framing.orthoHalf * 1024 / (768 + 48)); expect(view.ortho.zoom).toBe(frame.zoom);
    view.controls.update(); near(view.camera.position, frame.position); near(view.controls.target, frame.target);
  });
  it('restores a real OrbitControls pose at full precision and preserves every control setting on the following update', () => {
    const f = fixture(), { view } = f; view.camera.up.set(.2, 1, .1).normalize(); view.controls.update();
    Object.assign(view.controls, { enableDamping: true, dampingFactor: .07, minDistance: 2, maxDistance: 200, minAzimuthAngle: -.9, maxAzimuthAngle: 1.1 });
    const flags = { ...Object.fromEntries(['enabled', 'enableRotate', 'enablePan', 'enableZoom', 'enableDamping', 'dampingFactor', 'minDistance', 'maxDistance', 'minAzimuthAngle', 'maxAzimuthAngle'].map((key) => [key, view.controls[key]])) };
    const frame = view.captureCameraFrame(); expect(frame.position).not.toEqual(view.getCamera().position);
    view.setCamera({ position: [22, 12, 14], target: [8, 2, -4] }, { instant: true }); expect(view.restoreCameraFrame(frame)).toBe(true);
    expect(view.captureCameraFrame().position).toEqual(frame.position); expect(view.captureCameraFrame().quaternion).toEqual(frame.quaternion); expect(view.captureCameraFrame().up).toEqual(frame.up); expect(view.captureCameraFrame().target).toEqual(frame.target);
    view.controls.update(); near(view.camera.position, frame.position); near(view.camera.quaternion, frame.quaternion);
    for (const [key, value] of Object.entries(flags)) expect(view.controls[key]).toBe(value);
  });
  it.each(['root', 'mode', 'controls', 'camera', 'disposed'])('refuses stale %s frame ownership without writing the replacement pose', (change) => {
    const f = fixture(), frame = f.view.captureCameraFrame(), restore = f.view.restoreCameraFrame.bind(f.view), before = f.view.camera.position.clone();
    if (change === 'root') f.view.model = { ...f.model, root: new THREE.Group() };
    else if (change === 'mode') f.view.mode = 'top';
    else if (change === 'controls') frame.controls = {};
    else if (change === 'camera') frame.camera = new THREE.PerspectiveCamera();
    else f.view._disposed = true;
    expect(restore(frame)).toBe(false); expect(f.view.camera.position.equals(before)).toBe(true); if (change === 'root') f.view.model = f.model;
  });
});
