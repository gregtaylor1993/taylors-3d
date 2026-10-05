import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import { nodeIndex } from '../src/views.js';
import { WALL_PRESENTATION_DEFAULTS, readWallPresentation, exactWallSelector, wallKeepSelectors,
  wallTargetReport, readWallSide, stepWallTransition } from '../src/wall-presentation.js';

const face = () => ({ space: 'node-local', point: [1, 0, 0], normal: [2, 0, 0] });
const wall = (patch = {}) => ({ id: 'east', selector: 'node:House/Room/Wall', face: face(), floor_id: 'ground', ...patch });
const config = (patch = {}) => ({ enabled: true, mode: 'fade', walls: [wall()], ...patch });
const codes = (result) => result.diagnostics.map((entry) => entry.code);
function model() {
  const root = new THREE.Group(), house = new THREE.Group(); root.name = 'GLTF scene'; house.name = 'House'; root.add(house);
  const room = new THREE.Group(); room.name = 'Room'; house.add(room);
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, .1), material);
  mesh.name = 'Wall'; room.add(mesh);
  return { root, room, mesh, material, index: nodeIndex(threeAdapter(root), buildManifest(threeAdapter(root))), floors: [{ id: 'ground', elevation: 3 }] };
}
const report = (f, cfg = config(), extra = {}) => wallTargetReport(cfg, { index: f.index, floors: f.floors, modelRoot: f.root, ...extra });

describe('strict opt-in wall policy', () => {
  it('defaults to disabled Normal with no guessed target or source writes', () => {
    const value = readWallPresentation(undefined);
    expect(value).toEqual({ ...WALL_PRESENTATION_DEFAULTS, walls: [], valid: true, diagnostics: [] });
    expect(readWallPresentation({}).valid).toBe(true);
  });
  it('normalizes explicit local normals while preserving the raw import and extension fields', () => {
    const raw = config({ future: { editor: true }, walls: [wall({ vendor: { keep: true } })] }), before = structuredClone(raw);
    const value = readWallPresentation(raw);
    expect(value.valid).toBe(true); expect(value.enabled).toBe(true); expect(value.walls[0].enabled).toBe(true);
    expect(value.walls[0].face).toEqual({ space: 'node-local', point: [1, 0, 0], normal: [1, 0, 0] });
    expect(value.walls[0].face.point).not.toBe(raw.walls[0].face.point); expect(raw).toEqual(before);
  });
  it('keeps normalized policy diagnostics and static omissions when a consumer reads it again', () => {
    const target = wall(); delete target.face; delete target.floor_id;
    const good = readWallPresentation(config({ scope: 'all_selected', walls: [target] }));
    expect(readWallPresentation(good)).toEqual(good);
    const invalid = readWallPresentation(config({ opacity: false }));
    expect(readWallPresentation(invalid)).toEqual(invalid);
  });
  it('normalizes finite very small normals to a real unit direction without underflow distortion', () => {
    const result = readWallPresentation(config({ walls: [wall({ face: { space: 'node-local', point: [0, 0, 0], normal: [1e-323, 1e-323, 0] } })] }));
    expect(result.valid).toBe(true); expect(Math.hypot(...result.walls[0].face.normal)).toBeCloseTo(1, 15);
    expect(result.walls[0].face.normal[0]).toBeCloseTo(Math.SQRT1_2, 15);
  });
  it.each([null, false, 'fade', [], 1])('rejects explicit malformed policy %j safely', (raw) => {
    const value = readWallPresentation(raw); expect(value.valid).toBe(false); expect(value.enabled).toBe(false); expect(codes(value)).toContain('invalid_policy');
  });
  it.each([
    ['enabled', undefined], ['enabled', 1], ['mode', 'automatic'], ['scope', 'focus'], ['opacity', '0.2'], ['opacity', -1], ['opacity', 1.01],
    ['cut_height_m', Infinity], ['cut_height_m', 1001], ['transition_ms', true], ['transition_ms', -1], ['transition_ms', 1001], ['walls', null],
  ])('rejects present invalid %s=%j without activating other valid rows', (field, input) => {
    const value = readWallPresentation(config({ [field]: input })); expect(value.valid).toBe(false); expect(value.enabled).toBe(false); expect(codes(value)).toContain(`invalid_${field}`);
  });
  it('accepts documented numeric endpoints and static targets without a captured face', () => {
    const value = readWallPresentation(config({ scope: 'all_selected', opacity: 0, cut_height_m: 0, transition_ms: 0, walls: [wall({ face: undefined })] }));
    expect(value.valid).toBe(false); // present undefined is malformed, not an omitted setting
    const target = wall(); delete target.face;
    const staticValue = readWallPresentation(config({ scope: 'all_selected', opacity: 1, cut_height_m: 1000, transition_ms: 1000, walls: [target] }));
    expect(staticValue.valid).toBe(true); expect(staticValue.walls[0].face).toBeNull();
  });
  it.each([
    { face: null }, { face: { space: 'model-local', point: [1, 0, 0], normal: [1, 0, 0] } },
    { face: { space: 'node-local', point: [1, false, 0], normal: [1, 0, 0] } },
    { face: { space: 'node-local', point: new Array(3), normal: [1, 0, 0] } },
    { face: { space: 'node-local', point: [1000001, 0, 0], normal: [1, 0, 0] } },
    { face: { space: 'node-local', point: [1, 0, 0], normal: [0, 0, 0] } },
    { face: { space: 'node-local', point: [1, 0, 0], normal: [Infinity, 0, 0] } },
    { id: 'east wall' }, { selector: 'room:living' }, { selector: 'node:House/**' }, { enabled: 'false' }, { floor_id: ' ground' },
  ])('keeps malformed imported wall settings inactive (%j)', (patch) => {
    const raw = config({ walls: [wall(patch)] }), value = readWallPresentation(raw);
    expect(value.valid).toBe(false); expect(value.enabled).toBe(false); expect(value.walls[0].enabled).toBe(false); expect(raw.walls[0]).toEqual(wall(patch));
  });
  it('does not silently overlook malformed disabled rows, missing faces or missing explicit cut floors', () => {
    const target = wall({ enabled: false }); delete target.face;
    expect(codes(readWallPresentation(config({ enabled: false, walls: [target] })))).toContain('missing_face');
    const cut = wall(); delete cut.floor_id;
    expect(codes(readWallPresentation(config({ mode: 'cutaway', walls: [cut] })))).toContain('missing_floor_id');
  });
  it('rejects duplicate IDs and duplicate selectors rather than choosing a writer', () => {
    const value = readWallPresentation(config({ walls: [wall(), wall()] }));
    expect(value.enabled).toBe(false); expect(value.walls.every((entry) => !entry.valid && !entry.enabled)).toBe(true);
    expect(codes(value)).toContain('duplicate_id'); expect(codes(value)).toContain('duplicate_selector');
  });
  it('bounds work to256 rows and rejects sparse arrays without throwing', () => {
    const value = readWallPresentation(config({ walls: Array.from({ length: 257 }, (_, id) => wall({ id: `wall_${id}`, selector: `node:House/Wall${id}` })) }));
    expect(value.walls).toHaveLength(256); expect(value.enabled).toBe(false); expect(codes(value)).toContain('wall_limit');
    const sparse = readWallPresentation(config({ walls: new Array(1) })); expect(sparse.valid).toBe(false); expect(codes(sparse)).toContain('invalid_wall');
  });
});

describe('exact targets survive merging and are resolved honestly', () => {
  it('retains exact escaped paths independently of enabled, mode and face validity', () => {
    const escaped = 'node:House/Wall\\*part\\/inner\\#name#0', raw = config({ enabled: false, mode: 'unsupported', walls: [wall({ selector: escaped, face: null }), wall(), wall(), wall({ selector: 'node:House/**' })] });
    expect(wallKeepSelectors(raw)).toEqual([escaped, 'node:House/Room/Wall']); expect(exactWallSelector(escaped)).toBe(escaped);
    expect(exactWallSelector('node:House/Wall\\')).toBeNull(); expect(exactWallSelector('node:House/Wall\\q')).toBeNull();
  });
  it('resolves actual escaped sibling paths, never a room owner or name guess', () => {
    const f = model(); f.mesh.name = 'Wall*/#'; const second = f.mesh.clone(); f.room.add(second);
    f.index = nodeIndex(threeAdapter(f.root), buildManifest(threeAdapter(f.root)));
    const meshEntries = f.index.nodes.filter((entry) => entry.node.isMesh);
    const raw = config({ walls: [wall({ selector: `node:${meshEntries[1].path}` })] });
    expect(report(f, raw).rows[0]).toMatchObject({ node: second, ready: true, enabled: true, elevation: 3 });
    expect(report(f, config({ walls: [wall({ selector: 'node:House/Room' })] })).rows[0].status).toBe('not_mesh');
  });
  it('readiness is independent of disabled Normal policy/row gates', () => {
    const f = model(), result = report(f, config({ enabled: false, mode: 'normal', walls: [wall({ enabled: false })] }));
    expect(result.rows[0]).toMatchObject({ ready: true, enabled: false, node: f.mesh, elevation: 3 });
  });
  it('preserves missing and ambiguous references rather than selecting similar names or IDs', () => {
    const f = model(), raw = config({ walls: [wall({ selector: 'node:House/Room/WallOld' })] });
    const missing = report(f, raw).rows[0]; expect(missing).toMatchObject({ selector: 'node:House/Room/WallOld', node: null, status: 'missing_node', ready: false });
    const duplicate = report(f, config(), { index: { nodes: [f.index.nodes.find((entry) => entry.node === f.mesh), f.index.nodes.find((entry) => entry.node === f.mesh)] } }).rows[0];
    expect(duplicate.status).toBe('ambiguous_node'); expect(duplicate.node).toBeNull(); expect(raw.walls[0].selector).toBe('node:House/Room/WallOld');
  });
  it.each(['isSkinnedMesh', 'isInstancedMesh', 'isBatchedMesh', 'morph', 'merged'])('rejects unsupported %s instead of modifying a whole compiled part', (flag) => {
    const f = model(); if (flag === 'merged') f.mesh.userData.merged = 2;
    else if (flag === 'morph') f.mesh.geometry.morphAttributes.position = [f.mesh.geometry.attributes.position.clone()];
    else f.mesh[flag] = true;
    const result = report(f).rows[0]; expect(result.ready).toBe(false); expect(result.enabled).toBe(false); expect(result.status).toBe(flag === 'merged' ? 'merged_mesh' : 'unsupported_mesh');
  });
  it('rejects an old-model mesh and exact material writers without guessing by object names', () => {
    const f = model(); expect(report(f, config(), { modelRoot: new THREE.Group() }).rows[0].status).toBe('stale_model');
    expect(report(f, config(), { materialWriters: new Set([f.mesh]) }).rows[0].status).toBe('material_writer');
    f.mesh.name = 'Lamp wall'; expect(report(f).rows[0].ready).toBe(true); // names do not determine ownership
  });
  it('supports actual shared/multiple authored materials without changing them or their textures', () => {
    const f = model(), glass = new THREE.MeshPhysicalMaterial({ opacity: .4, transparent: true }), texture = new THREE.Texture();
    f.material.map = texture; f.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 2)];
    f.mesh.material = [f.material, glass, f.material]; const original = f.mesh.material, planes = f.material.clippingPlanes, version = f.material.version;
    const another = new THREE.Mesh(f.mesh.geometry, f.material); f.room.add(another);
    expect(report(f).rows[0].ready).toBe(true); expect(f.mesh.material).toBe(original); expect(another.material).toBe(f.material);
    expect(f.material.map).toBe(texture); expect(f.material.clippingPlanes).toBe(planes); expect(f.material.version).toBe(version); expect(glass.opacity).toBe(.4);
    f.mesh.material = new Array(1); expect(report(f).rows[0].status).toBe('missing_material');
  });
  it('rejects intersection clipping for cut but retains it for simple fade/glass', () => {
    const f = model(); f.material.clipIntersection = true;
    expect(report(f, config({ mode: 'cutaway' })).rows[0].status).toBe('clip_intersection');
    expect(report(f, config({ mode: 'glass' })).rows[0].ready).toBe(true); expect(f.material.clipIntersection).toBe(true);
  });
  it('requires the exact current finite floor for cut; restoration uses the same ID only', () => {
    const f = model(), raw = config({ mode: 'cutaway', walls: [wall({ floor_id: 'deleted' })] });
    const result = report(f, raw).rows[0]; expect(result).toMatchObject({ floor_id: 'deleted', elevation: null, status: 'missing_floor', ready: false, enabled: false });
    expect(report(f, raw, { floors: [{ id: 'Deleted', elevation: 4 }, { id: 'deleted_similar', elevation: 3 }] }).rows[0].ready).toBe(false);
    expect(report(f, raw, { floors: [{ id: 'deleted', elevation: 4 }] }).rows[0]).toMatchObject({ ready: true, elevation: 4 });
    expect(report(f, raw, { floors: [{ id: 'deleted', elevation: NaN }] }).rows[0].ready).toBe(false);
    expect(report(f, raw, { floors: [{ id: 'deleted', elevation: 4 }, { id: 'deleted', elevation: 5 }] }).rows[0].ready).toBe(false);
    const fade = report(f, { ...raw, mode: 'fade' }).rows[0]; expect(fade.ready).toBe(true); expect(codes(fade)).toContain('missing_floor');
    expect(raw.walls[0].floor_id).toBe('deleted');
  });
  it('diagnoses duplicate actual writers even when a malformed index gives them distinct paths', () => {
    const f = model(), raw = config({ walls: [wall(), wall({ id: 'west', selector: 'node:Alias' })] });
    const result = report(f, raw, { index: { nodes: [{ node: f.mesh, path: 'House/Room/Wall' }, { node: f.mesh, path: 'Alias' }] } });
    expect(result.rows.every((entry) => entry.status === 'duplicate_target' && !entry.ready && !entry.enabled)).toBe(true);
  });
});

describe('explicit world-plane side and bounded pure transitions', () => {
  it('uses only signed camera distance and5cm hysteresis, including a normalized world plane', () => {
    const plane = { normal: [2, 0, 0], constant: -4 };
    expect(readWallSide(plane, [2.1, 0, 0]).active).toBe(true); expect(readWallSide(plane, [1.9, 0, 0], true).active).toBe(false);
    expect(readWallSide(plane, [2.02, 999, -999], false).active).toBe(false); expect(readWallSide(plane, [2.02, 999, -999], true).active).toBe(true);
    expect(readWallSide({ normal: [1, 0, 0], constant: 0 }, [.05, 0, 0], false).active).toBe(false);
    expect(readWallSide({ normal: [1, 0, 0], constant: 0 }, [-.05, 0, 0], true).active).toBe(true);
    expect(readWallSide(plane, [2.1, 0, 0]).signedDistance).toBeCloseTo(.1, 12);
  });
  it('normalizes the finite world direction consistently even at subnormal magnitudes', () => {
    const result = readWallSide({ normal: [1e-323, 1e-323, 0], constant: 0 }, [1, 1, 0]);
    expect(result.valid).toBe(true); expect(result.signedDistance).toBeCloseTo(Math.SQRT2, 15);
  });
  it.each([
    [{ normal: [0, 0, 0], constant: 0 }, [1, 0, 0]], [{ normal: [1, 0, 0], constant: Infinity }, [1, 0, 0]],
    [{ normal: [1, 0, 0], constant: 0 }, [false, 0, 0]], [{ normal: new Array(3), constant: 0 }, [1, 0, 0]],
    [{ normal: [1, 1, 0], constant: Number.MAX_VALUE }, [Number.MAX_VALUE, Number.MAX_VALUE, 0]],
  ])('invalid side evidence stays inactive (%j)', (plane, camera) => {
    expect(readWallSide(plane, camera, true)).toMatchObject({ valid: false, active: false, signedDistance: null });
  });
  it('has equal30/60fps progress and lands exactly at the configured multiplier', () => {
    const values = [30, 60].map((fps) => {
      let state = stepWallTransition(null, { now: 0, target: .2, duration_ms: 1000 });
      for (let frame = 1; frame <= fps; frame++) state = stepWallTransition(state, { now: frame * 1000 / fps, target: .2, duration_ms: 1000 });
      expect(state.valid).toBe(true); expect(state.value).toBeCloseTo(.2, 12); return state.value;
    });
    expect(values[0]).toBeCloseTo(values[1], 12);
    let state = stepWallTransition(null, { now: 0, target: .2, duration_ms: 250 });
    for (let frame = 1; frame <= 5; frame++) state = stepWallTransition(state, { now: frame * 50, target: .2, duration_ms: 250 });
    expect(state).toMatchObject({ value: .2, moving: false, remaining_ms: 0 });
  });
  it('caps hidden gaps to50ms and ignores backward/repeated time without catch-up or mutation', () => {
    const first = stepWallTransition(null, { now: 100, target: .2, duration_ms: 250 }), before = structuredClone(first);
    const next = stepWallTransition(first, { now: 10100, target: .2, duration_ms: 250 });
    expect(next.value).toBeCloseTo(.84, 12); expect(next.remaining_ms).toBe(200); expect(first).toEqual(before);
    const backwards = stepWallTransition(next, { now: 100, target: .2, duration_ms: 250 });
    expect(backwards).toMatchObject({ value: next.value, remaining_ms: 200, lastNow: 10100, changed: false });
    expect(stepWallTransition(backwards, { now: 10100, target: .2, duration_ms: 250 }).value).toBe(next.value);
  });
  it('reverses from the current appearance and becomes instant for reduced motion or0ms', () => {
    let state = stepWallTransition(null, { now: 0, target: .2 }); state = stepWallTransition(state, { now: 50, target: .2 });
    const reverse = stepWallTransition(state, { now: 60, target: 1 }); expect(reverse.value).toBe(state.value); expect(reverse.changed).toBe(false);
    const progressed = stepWallTransition(reverse, { now: 110, target: 1 }); expect(progressed.value).toBeGreaterThan(state.value);
    expect(stepWallTransition(progressed, { now: 111, target: .1, reducedMotion: true })).toMatchObject({ value: .1, moving: false, changed: true });
    expect(stepWallTransition(progressed, { now: 111, target: .1, duration_ms: 0 })).toMatchObject({ value: .1, moving: false, changed: true });
  });
  it('settled equal frames are idle and malformed frames cannot keep a fabricated fade', () => {
    const settled = stepWallTransition(null, { now: 0, target: .2, duration_ms: 0 });
    expect(stepWallTransition(settled, { now: 10, target: .2, duration_ms: 0 })).toMatchObject({ value: .2, changed: false, moving: false });
    for (const invalid of [{ now: NaN, target: .2 }, { now: 1, target: '0.2' }, { now: 1, target: .2, duration_ms: Infinity }, { now: 1, target: .2, reducedMotion: 'false' }])
      expect(stepWallTransition(settled, invalid)).toMatchObject({ value: 1, moving: false, valid: false });
    expect(stepWallTransition({ ...settled, remaining_ms: 9999 }, { now: 1, target: .2 })).toMatchObject({ value: 1, moving: false, valid: false });
  });
});
