// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FloorplanView } from '../src/view.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import { nodeIndex } from '../src/views.js';

const fixtures = [];
function fixture({ clipShadows = true, multiple = false } = {}) {
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  const renderer = { domElement: canvas, render: vi.fn(), shadowMap: { enabled: true, needsUpdate: false }, setClearColor: vi.fn() };
  const labels = new CSS2DRenderer(); labels.setSize(800, 600); document.body.append(labels.domElement);
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, .1, 1000); camera.position.set(0, 4, 6); camera.lookAt(0, 4, 0); camera.updateMatrixWorld(true);
  const root = new THREE.Group(), level = new THREE.Group(); level.name = 'ground'; level.userData.fp = { kind: 'level', id: 'ground', role: 'storey' }; root.add(level);
  const original = new THREE.MeshStandardMaterial(); Object.assign(original.userData, { baseOpacity: 1, wasTransparent: false, baseDepthWrite: true }); original.clipShadows = clipShadows;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, .1), multiple ? [original, original, original, original, original, original] : original); wall.name = 'wall'; wall.position.y = 3.5; level.add(wall);
  const behind = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), original); behind.name = 'behind'; behind.position.set(0, 4, -2); level.add(behind);
  const model = { id: 'house', root, manifest: buildManifest(threeAdapter(root)), opacity: 1, tagged: true };
  const view = Object.create(FloorplanView.prototype), sun = new THREE.DirectionalLight(); sun.intensity = 1;
  Object.assign(view, { renderer, labelRenderer: labels, camera, persp: camera, ortho: new THREE.OrthographicCamera(), mode: '3d', model,
    scene: new THREE.Scene(), modelGroup: new THREE.Group(), objectsGroup: new THREE.Group(), staticGroup: new THREE.Group(), markerGroup: new THREE.Group(), overlayGroup: new THREE.Group(),
    cssObjects: [], markerObjects: new Map(), glows: new Map(), stems: new Map(), floors: [{ id: 'ground', elevation: 2 }], visibleFloor: 'all',
    modelClip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), sectionClip: null, raycaster: new THREE.Raycaster(), _occRay: new THREE.Raycaster(), _occGen: 0,
    _occlusion: true, _camMovedAt: -1000, _raf: null, _zoomTo: 'center', sun, hemi: new THREE.HemisphereLight(), moonLight: new THREE.DirectionalLight(),
    stats: { frames: 0, shadow: 0, shadowLights: 0, occPasses: 0, occDone: 0, occPartial: 0 },
    mergeStats: { enabled: false, merged: 0 }, size: { w: 800, h: 600 }, _updateDepth: vi.fn(), _placeSkyBodies: vi.fn(), pixelsPerMetre: () => 100 });
  view.scene.add(view.modelGroup); view.modelGroup.add(root); root.updateWorldMatrix(true, true);
  view._makeControls(); view.controls.maxPolarAngle = Math.PI; view.controls.target.set(0, 4, 0); view.controls.update(); camera.updateMatrixWorld(true); view._camMovedAt = -1000; view.dirty = false;
  const index = nodeIndex(threeAdapter(root), model.manifest), raw = { enabled: true, mode: 'fade', scope: 'all_selected', opacity: .2, transition_ms: 0,
    walls: [{ id: 'wall', selector: 'node:ground/wall', floor_id: 'ground', face: { space: 'node-local', point: [0, 0, .05], normal: [0, 0, 1] } }] };
  const options = { index, floors: view.floors, enabled: true }, f = { view, canvas, labels, original, wall, behind, raw, options, root };
  fixtures.push(f); return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) { f.view.stop(); f.view._wallPresentation?.dispose(); f.view.controls.dispose(); f.canvas.remove(); f.labels.domElement.remove(); }
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('actual View wall picking and occlusion', () => {
  it('default/disabled/equal configuration is idle and does not clone source materials', () => {
    const f = fixture(); f.view.setWallPresentation(undefined, f.options); expect(f.view.dirty).toBe(false); expect(f.view._wallPresentation).toBeUndefined();
    f.view.setWallPresentation({ ...f.raw, enabled: false }, f.options); expect(f.wall.material).toBe(f.original); expect(f.view.dirty).toBe(false);
    f.view.setWallPresentation(f.raw, f.options); const clone = f.wall.material, version = clone.version; f.view.dirty = false;
    for (let count = 0; count < 20; count++) f.view.setWallPresentation(f.raw, f.options);
    expect(f.view.dirty).toBe(false); expect(f.wall.material).toBe(clone); expect(clone.version).toBe(version); expect(f.view.stats.shadow).toBe(0);
  });
  it('uses the same fade/cut shape for actual model hits, object tap occlusion and CSS2D labels', () => {
    const f = fixture(), marker = new CSS2DObject(document.createElement('button')); marker.position.set(0, 4, -2); f.view.scene.add(marker);
    f.view.cssObjects.push({ id: 'test', kind: 'marker', obj: marker, floorId: 'ground' });
    expect(f.view._modelHit(400, 300).object).toBe(f.wall); expect(f.view.pointHidden(marker.position)).toBe(true);
    f.view._occFull = true; f.view._runOcclusion(); expect(marker.element.classList.contains('fp-occluded')).toBe(true);
    const boxes = f.view._occluders(); f.view.setWallPresentation(f.raw, f.options);
    expect(f.view._modelHit(400, 300).object).toBe(f.behind); expect(f.view.pointHidden(marker.position)).toBe(false); expect(f.view._occluders()).toBe(boxes);
    f.view._occFull = true; f.view._runOcclusion(); expect(marker.element.classList.contains('fp-occluded')).toBe(false);
    f.view.setWallPresentation({ ...f.raw, mode: 'cutaway', cut_height_m: 1 }, f.options);
    expect(f.view._modelHit(400, 300).object).toBe(f.behind); expect(f.view.pointHidden(new THREE.Vector3(0, 4, -2))).toBe(false);
    expect(f.view.pointHidden(new THREE.Vector3(0, 2.5, -2))).toBe(true);
    expect(f.view._wallPresentation.cutHeight(f.wall)).toBe(3);
  });
  it('captures the actual exact rigid triangle and mesh-local side through a displayed fade, with no floor guess', () => {
    const f = fixture(); f.view.setWallPresentation(f.raw, f.options); const pick = f.view.captureWallSurfacePick(400, 300);
    expect(pick.selector).toBe('node:ground/wall'); expect(pick.modelRoot).toBe(f.root); expect(pick.floor_id).toBeUndefined();
    expect(pick.face.space).toBe('node-local'); expect(pick.face.point[1]).toBeCloseTo(.5, 12); expect(pick.face.normal).toEqual([0, 0, 1]);
    f.wall.userData.merged = 2; expect(f.view.captureWallSurfacePick(400, 300)).toBeNull();
    f.view.mergeStats = { enabled: true, merged: 10 }; expect(f.view.wallPresentationCandidates().prepared).toBe(false);
  });
  it('resolves large candidate lists once per exact path and still rejects duplicate current paths', () => {
    const f = fixture(), nodes = [];
    for (let count = 0; count < 200; count++) {
      const mesh = new THREE.Mesh(f.wall.geometry, f.original); f.root.add(mesh);
      nodes.push({ node: mesh, path: `mesh-${count}`, name: `Mesh ${count}` });
    }
    nodes.push({ node: f.wall, path: 'duplicate', name: 'Wall' }, { node: f.behind, path: 'duplicate', name: 'Furniture' });
    let completeScans = 0;
    f.view._wallIndexModel = f.view.model; f.view._wallIndex = { nodes: new Proxy(nodes, { get: (target, key, receiver) => {
      if (key === 'filter') completeScans++;
      return Reflect.get(target, key, receiver);
    } }) };
    const result = f.view.wallPresentationCandidates();
    expect(completeScans).toBe(0); expect(result.rows.filter((row) => row.selectable)).toHaveLength(200);
    expect(result.rows.filter((row) => row.selector === 'node:duplicate').every((row) => !row.selectable && row.reason.includes('ambiguous'))).toBe(true);
  });
  it('capture and ordinary picks retain the current Section and authored material clipping', () => {
    const f = fixture(); f.view.setWallPresentation(f.raw, f.options);
    f.view.sectionClip = new THREE.Plane(new THREE.Vector3(0, 0, -1), -.5); // front wall clipped, behind still kept
    expect(f.view.captureWallSurfacePick(400, 300).selector).toBe('node:ground/behind');
    f.view.sectionClip = null; f.original.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 3)];
    expect(f.view.captureWallSurfacePick(400, 300)).toBeNull(); // shared authored plane clips both actual targets at this point
  });
  it('honours hit face materialIndex for picking and opaque portions of a mixed-material occluder', () => {
    const f = fixture({ multiple: true }), glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: .2 });
    Object.assign(glass.userData, { wasTransparent: true, baseOpacity: .2 }); f.wall.material[4] = glass; // BoxGeometry front (+z) group
    f.original.side = THREE.DoubleSide; // the real opaque back face remains visible from this side
    f.wall.userData.seeThrough = true; expect(f.view._modelHit(400, 300).object).toBe(f.wall);
    expect(f.view.pointHidden(new THREE.Vector3(0, 4, -2))).toBe(true); // opaque back face still occludes
    expect(f.view._modelIntersectionShown({ object: f.wall, face: { materialIndex: 4 }, point: new THREE.Vector3(0, 4, .05) }, { occlusion: true })).toBe(false);
    expect(f.view._modelIntersectionShown({ object: f.wall, face: { materialIndex: 5 }, point: new THREE.Vector3(0, 4, -.05) }, { occlusion: true })).toBe(true);
  });
});

describe('existing rendering/lifecycle budget', () => {
  it('retains the current fade when the same model is re-placed and composes latest global opacity and Section', async () => {
    const f = fixture(); f.view._fitShadow = vi.fn(); f.view.setWallPresentation(f.raw, f.options);
    const clone = f.wall.material;
    await f.view.setModel({ id: 'house', position: [1, 0, 0], opacity: 1 });
    expect(f.wall.material).toBe(clone); expect(clone.opacity).toBe(.2); expect(clone.transparent).toBe(true);
    await f.view.setModel({ id: 'house', position: [1, 0, 0], opacity: .5 });
    expect(clone.opacity).toBe(.1); expect(f.behind.material.opacity).toBe(.5);
    const version = clone.version;
    f.view.setSection({ normal: [1, 0, 0], constant: 5 }); expect(clone.side).toBe(THREE.DoubleSide); expect(clone.opacity).toBe(.1);
    f.view.setSection({ normal: [1, 0, 0], constant: 6 }); expect(clone.version).toBe(version + 1);
    f.view.setSection(null); expect(clone.side).toBe(THREE.FrontSide); expect(clone.opacity).toBe(.1);
    f.view.setWallPresentation({ ...f.raw, enabled: false }, f.options);
    expect(f.wall.material).toBe(f.original); expect(f.original.opacity).toBe(.5); expect(f.original.side).toBe(THREE.FrontSide);
  });
  it.each([false, true])('cut requests one current shadow change only with authored clipShadows=%s', (clipShadows) => {
    const f = fixture({ clipShadows }); f.view.setWallPresentation({ ...f.raw, mode: 'cutaway', cut_height_m: 1 }, f.options);
    expect(f.view.stats.shadow).toBe(clipShadows ? 1 : 0); const count = f.view.stats.shadow;
    f.view.setWallPresentation({ ...f.raw, mode: 'cutaway', cut_height_m: 1 }, f.options); expect(f.view.stats.shadow).toBe(count);
    f.view.setModelRendering({ shadows: 'off' }); f.view.setWallPresentation({ ...f.raw, mode: 'cutaway', cut_height_m: 2 }, f.options); expect(f.view.stats.shadow).toBe(count);
  });
  it('uses existing RAF for fade with no repeated occlusion or shadow work, then remains idle', () => {
    vi.useFakeTimers(); const f = fixture(), queue = [];
    vi.stubGlobal('requestAnimationFrame', (callback) => { queue.push(callback); return 1; }); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    f.view.start(); f.view._cancelOcclusion(); const schedule = vi.spyOn(f.view, '_scheduleOcclusion');
    f.view.setWallPresentation({ ...f.raw, transition_ms: 250 }, f.options);
    for (let count = 0; count < 20; count++) { vi.advanceTimersByTime(20); queue.shift()(); }
    expect(f.view._wallPresentation.moving).toBe(false); expect(f.view.stats.shadow).toBe(0); expect(schedule).toHaveBeenCalledTimes(1);
    const frames = f.view.stats.frames, version = f.wall.material.version;
    for (let count = 0; count < 20; count++) { vi.advanceTimersByTime(20); queue.shift()(); }
    expect(f.view.stats.frames).toBe(frames); expect(f.wall.material.version).toBe(version);
  });
  it('freezes automatic idle sides, but reduced motion snaps real manual changes and stop restores current appearance', () => {
    const f = fixture(); f.view.setWallPresentation({ ...f.raw, scope: 'camera_side' }, { ...f.options, reducedMotion: true });
    expect(f.wall.material.opacity).toBe(.2); f.view._ambientCamera = {}; f.view.camera.position.z = -6; f.view.camera.updateMatrixWorld(true); f.view._wallCameraDirty = true;
    f.view.updateWallPresentation(performance.now()); expect(f.wall.material.opacity).toBe(.2);
    f.view._ambientCamera = null; f.view._wallCameraDirty = true; f.view.updateWallPresentation(performance.now()); expect(f.wall.material.opacity).toBe(1);
    f.view.stop(); expect(f.wall.material).toBe(f.original);
  });
  it('restores authored references in Top and stops, then reclaims only the current enabled 3D context', () => {
    const f = fixture(); f.view.fit = vi.fn(); f.view.setWallPresentation(f.raw, f.options);
    const clone = f.wall.material, dispose = vi.spyOn(clone, 'dispose');
    f.view.setMode('top'); expect(f.wall.material).toBe(f.original); expect(dispose).toHaveBeenCalledTimes(1);
    f.view.setMode('3d'); expect(f.wall.material).not.toBe(f.original); expect(f.wall.material).not.toBe(clone); expect(f.wall.material.opacity).toBe(.2);
    f.view.setWallPresentation(f.raw, { ...f.options, enabled: false }); expect(f.wall.material).toBe(f.original);
    f.view.setWallPresentation(f.raw, f.options); const current = f.wall.material; f.view.stop(); expect(f.wall.material).toBe(f.original);
    f.view.setWallPresentation(f.raw, f.options); expect(f.wall.material).not.toBe(current); expect(f.wall.material.opacity).toBe(.2);
  });
  it('clears multi-material/shared model resources once and releases wall copies before authored teardown', () => {
    const f = fixture({ multiple: true }), reference = f.wall.material, texture = new THREE.Texture(); f.original.map = texture;
    const originalDispose = vi.spyOn(f.original, 'dispose'), textureDispose = vi.spyOn(texture, 'dispose'), geometryDispose = vi.spyOn(f.wall.geometry, 'dispose');
    f.view.setWallPresentation(f.raw, f.options); const cloneDispose = vi.spyOn(f.wall.material[0], 'dispose');
    f.view._applyLook = vi.fn(); f.view.highlightModelNode = vi.fn();
    expect(() => f.view._disposeModel()).not.toThrow(); expect(f.wall.material).toBe(reference); expect(cloneDispose).toHaveBeenCalledTimes(1);
    expect(originalDispose).toHaveBeenCalledTimes(1); expect(geometryDispose).toHaveBeenCalledTimes(1); expect(textureDispose).not.toHaveBeenCalled();
  });
});
