// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { FloorplanView } from '../src/view.js';
import { ObjectLayer } from '../src/objects/layer.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';

const fixtures = [];
const flagsOf = (controls) => Object.fromEntries(['enabled', 'enableRotate', 'enablePan', 'enableZoom', 'enableDamping', 'dampingFactor',
  'screenSpacePanning', 'zoomToCursor', 'autoRotate', 'autoRotateSpeed', 'minDistance', 'maxDistance', 'minZoom', 'maxZoom',
  'minPolarAngle', 'maxPolarAngle', 'minAzimuthAngle', 'maxAzimuthAngle', 'minTargetRadius', 'maxTargetRadius'].map((key) => [key, controls[key]]));
const pose = (view) => ({ position: view.camera.position.clone(), quaternion: view.camera.quaternion.clone(), up: view.camera.up.clone(),
  zoom: view.camera.zoom, target: view.controls.target.clone(), flags: flagsOf(view.controls) });
const expectPose = (view, saved, exact = true) => {
  for (const field of ['position', 'quaternion', 'up']) {
    if (exact) expect(view.camera[field].toArray()).toEqual(saved[field].toArray());
    else view.camera[field].toArray().forEach((value, index) => expect(value).toBeCloseTo(saved[field].toArray()[index], 12));
  }
  expect(view.camera.zoom).toBe(saved.zoom); expect(view.controls.target.toArray()).toEqual(saved.target.toArray());
  expect(flagsOf(view.controls)).toEqual(saved.flags);
};
const owner = (patch = {}) => ({ token: Object.freeze({ id: 'idle' }), generation: 'house:1', speed: .5, ...patch });
function fixture({ up = [0, 1, 0], lighting = false } = {}) {
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
  Object.defineProperties(canvas, { clientHeight: { value: 600 }, clientWidth: { value: 800 } });
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600 });
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, .1, 1000); camera.up.fromArray(up).normalize();
  camera.position.set(10.123456789, 8.87654321, 12.01234567); camera.zoom = 1.125; camera.updateProjectionMatrix();
  const labels = new CSS2DRenderer(); labels.setSize(800, 600); labels.domElement.style.display = 'grid'; document.body.append(labels.domElement);
  const root = new THREE.Group(), level = new THREE.Group(), mount = new THREE.Group(); root.add(level); level.add(mount);
  level.userData.fp = { kind: 'level', id: 'ground', role: 'storey' };
  mount.userData.fp = { kind: 'object', id: 'lamp', type: 'light' }; mount.position.set(1, 1.5, -1);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial()); glow.name = 'glow'; mount.add(glow);
  const model = { id: 'house', root, manifest: buildManifest(threeAdapter(root)), opacity: 1 };
  const view = Object.create(FloorplanView.prototype);
  Object.assign(view, { camera, persp: camera, ortho: new THREE.OrthographicCamera(-5, 5, 5, -5), mode: '3d', labelRenderer: labels,
    renderer: { domElement: canvas, render: vi.fn(), shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false }, setClearColor: vi.fn() },
    scene: new THREE.Scene(), model, modelGroup: new THREE.Group(), objectsGroup: new THREE.Group(), staticGroup: new THREE.Group(),
    sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), moonLight: new THREE.DirectionalLight(), sky: { night: 0 },
    cssObjects: [], markerObjects: new Map(), glows: new Map(), floors: [{ id: 'ground', elevation: 0 }], visibleFloor: 'all',
    modelClip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), sectionClip: null, size: { w: 800, h: 600 },
    stats: { frames: 0, shadow: 0, shadowLights: 0, occPasses: 0, occPartial: 0, occDone: 0 },
    _occlusion: true, _occGen: 0, _occTimer: null, _occFull: false, _occRay: new THREE.Raycaster(), _raf: null, _zoomTo: 'cursor',
    _updateDepth: vi.fn(), _placeSkyBodies: vi.fn(), pixelsPerMetre: vi.fn(() => 100), onObjectsInvalidate: vi.fn() });
  view.scene.add(view.modelGroup, view.objectsGroup, view.sun, view.hemi, view.moonLight); view.modelGroup.add(root);
  view._makeControls(); view.controls.target.set(1.11111111, .22222222, -3.33333333); view.controls.update();
  Object.assign(view.controls, { autoRotateSpeed: 1.75, dampingFactor: .07, minZoom: .2, maxZoom: 4, minDistance: 3, maxDistance: 140,
    minAzimuthAngle: -1, maxAzimuthAngle: 1 });
  root.updateMatrixWorld(true); view.camera.updateMatrixWorld(true);
  if (lighting) {
    const objects = new ObjectLayer(view); objects.setModel(model); objects.setBindings(new Map([['lamp', { entity: 'light.lamp' }]]), {});
    objects.update({ 'light.lamp': { entity_id: 'light.lamp', state: 'on', attributes: { supported_color_modes: ['rgb'], color_mode: 'rgb', brightness: 128, rgb_color: [255, 70, 30] } } });
    objects.stats.shadowRequests = 0; objects.stats.budget = 0;
  }
  view.dirty = false; view.stats.shadow = 0; view.stats.shadowLights = 0; view.renderer.shadowMap.needsUpdate = false;
  view._camMovedAt = -1000;
  const pointer = (type, x, y) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } }); canvas.dispatchEvent(event);
  };
  const f = { view, canvas, labels, root, glow, model, pointer }; fixtures.push(f); return f;
}
afterEach(() => {
  fixtures.splice(0).forEach(({ view, canvas, labels }) => { view.stop(); view.controls.dispose(); view.objectLayer?.dispose(); canvas.remove(); labels.domElement.remove(); });
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('real OrbitControls ambient ownership and precise restoration', () => {
  it.each([{ up: [0, 1, 0] }, { up: [.2, 1, .1] }])('preserves raw pose/control flags after a real damped gesture and the next ordinary update (up $up)', ({ up }) => {
    const f = fixture({ up }), { view } = f, request = owner();
    f.pointer('pointerdown', 200, 200); f.pointer('pointermove', 240, 220); f.pointer('pointerup', 240, 220);
    const saved = pose(view), rounded = view.getCamera();
    expect(saved.position.toArray()).not.toEqual(rounded.position);
    expect(view.beginAmbientCamera(request)).toBe(true); expect(view.dirty).toBe(true); // preceding gesture already requested its frame
    for (let frame = 0; frame < 60; frame++) expect(view.advanceAmbientCamera({ ...request, deltaSeconds: 1 / 60 })).toBe(true);
    expect(view.camera.position.equals(saved.position)).toBe(false); expect(view.endAmbientCamera(request)).toBe(true);
    expectPose(view, saved); view.controls.update(); expectPose(view, saved, false);
    expect(view._ambientCamera).toBeNull(); expect(f.labels.domElement.style.display).toBe('grid');
  });
  it('starts with no GPU frame for CSS label hiding and restores exact label DOM without replacing it', () => {
    const f = fixture(), request = owner(), element = document.createElement('button'); element.textContent = 'Lamp'; element.style.pointerEvents = 'auto';
    const label = new CSS2DObject(element); f.view.scene.add(label); label.position.set(1, 1, -1);
    f.labels.render(f.view.scene, f.view.camera); const parent = element.parentNode;
    expect(f.view.beginAmbientCamera(request)).toBe(true); expect(f.view.dirty).toBe(false);
    expect(f.labels.domElement.style.display).toBe('none'); f.labels.render(f.view.scene, f.view.camera);
    expect(f.labels.domElement.style.display).toBe('none'); expect(element.parentNode).toBe(parent);
    expect(f.view.endAmbientCamera(request)).toBe(false); expect(f.view.dirty).toBe(false);
    expect(f.labels.domElement.style.display).toBe('grid'); expect(element.parentNode).toBe(parent);
  });
  it('refuses to hide a focused interactive label', () => {
    const f = fixture(), button = document.createElement('button'); f.labels.domElement.append(button); button.focus();
    expect(document.activeElement).toBe(button); expect(f.view.beginAmbientCamera(owner())).toBe(false);
    expect(f.labels.domElement.style.display).toBe('grid'); expect(f.view.controls.autoRotate).toBe(false);
  });
  it.each(['position', 'target', 'up', 'quaternion', 'zoom'])('rejects a nonfinite %s pose without hiding labels', (field) => {
    const f = fixture(); if (field === 'target') f.view.controls.target.x = NaN;
    else if (field === 'zoom') f.view.camera.zoom = Infinity;
    else f.view.camera[field].x = NaN;
    expect(f.view.beginAmbientCamera(owner())).toBe(false); expect(f.view._ambientCamera).toBeUndefined(); expect(f.labels.domElement.style.display).toBe('grid');
  });
  it('retains ordinary controls behavior without the optional start/end callback', () => {
    const f = fixture(); f.view._tween = { existing: true };
    expect(() => { f.view.controls.dispatchEvent({ type: 'start' }); f.view.controls.dispatchEvent({ type: 'end' }); }).not.toThrow();
    expect(f.view._tween).toBeNull(); expect(f.view.onCameraInteraction).toBeUndefined();
  });
  it('calls the current optional interaction callback exactly once for real pointer start/end', () => {
    const f = fixture(), interaction = vi.fn(); f.view.onCameraInteraction = interaction;
    f.pointer('pointerdown', 200, 200); f.pointer('pointermove', 240, 220); f.pointer('pointerup', 240, 220);
    expect(interaction.mock.calls).toEqual([['start'], ['end']]);
  });
  it.each([undefined, null, 0, -1, 6.01, NaN, Infinity, '0.5'])('rejects unsupported speed %j without writes', (speed) => {
    const f = fixture(), saved = pose(f.view); expect(f.view.beginAmbientCamera(owner({ speed }))).toBe(false);
    expectPose(f.view, saved); expect(f.view.dirty).toBe(false); expect(f.labels.domElement.style.display).toBe('grid');
  });
  it.each(['top', 'section', 'tween', 'model motion', 'disabled', 'rotate disabled', 'disposed', 'no token', 'no generation'])('rejects %s before touching camera', (kind) => {
    const f = fixture(), request = owner();
    const changes = { top: () => { f.view.mode = 'top'; }, section: () => { f.view.sectionClip = new THREE.Plane(); },
      tween: () => { f.view._tween = {}; }, 'model motion': () => { f.view._modelMotionMoving = true; },
      disabled: () => { f.view.controls.enabled = false; }, 'rotate disabled': () => { f.view.controls.enableRotate = false; },
      disposed: () => { f.view._disposed = true; }, 'no token': () => { request.token = null; }, 'no generation': () => { delete request.generation; } };
    changes[kind](); const saved = pose(f.view); expect(f.view.beginAmbientCamera(request)).toBe(false); expectPose(f.view, saved);
  });
  it('same owner begin is a no-op, stale owners cannot step/clear, and later sessions remain protected', () => {
    const f = fixture(), first = owner(); f.view.beginAmbientCamera(first); const saved = f.view._ambientCamera;
    expect(f.view.beginAmbientCamera(first)).toBe(true); expect(f.view._ambientCamera).toBe(saved);
    expect(f.view.beginAmbientCamera(owner({ token: {} }))).toBe(false);
    expect(f.view.advanceAmbientCamera({ ...first, generation: 'old', deltaSeconds: .05 })).toBe(false);
    expect(f.view.endAmbientCamera({ ...first, token: {} })).toBe(false); expect(f.view._ambientCamera).toBe(saved);
    f.view.endAmbientCamera(first); const second = owner({ token: {}, generation: 'house:2' }); f.view.beginAmbientCamera(second);
    expect(f.view.endAmbientCamera(first)).toBe(false); expect(f.view._ambientCamera.token).toBe(second.token);
  });
  it.each(['root', 'controls', 'camera'])('discards a replaced %s without restoring or touching the new owner', (kind) => {
    const f = fixture(), request = owner(), originalFlags = flagsOf(f.view.controls); f.view.beginAmbientCamera(request); f.view.advanceAmbientCamera({ ...request, deltaSeconds: .05 });
    if (kind === 'root') f.view.model = { ...f.model, root: new THREE.Group() };
    if (kind === 'controls') {
      const previous = f.view.controls; f.view._makeControls(); previous.dispose();
    }
    if (kind === 'camera') { f.view.camera = new THREE.PerspectiveCamera(); f.view.camera.position.set(2, 3, 4); }
    const saved = pose(f.view); if (kind !== 'controls') saved.flags = originalFlags;
    expect(f.view.advanceAmbientCamera({ ...request, deltaSeconds: .05 })).toBe(false);
    expect(f.view.endAmbientCamera(request)).toBe(false); expectPose(f.view, saved); expect(f.view._ambientCamera).toBeNull();
    expect(f.labels.domElement.style.display).toBe('grid');
  });
  it('discard restore:false does not overwrite current pose but returns owned controls/labels', () => {
    const f = fixture(), request = owner(), initialFlags = flagsOf(f.view.controls); f.view.beginAmbientCamera(request);
    f.view.advanceAmbientCamera({ ...request, deltaSeconds: .05 }); const current = f.view.camera.position.clone();
    expect(f.view.endAmbientCamera({ ...request, restore: false })).toBe(false);
    expect(f.view.camera.position.equals(current)).toBe(true); expect(flagsOf(f.view.controls)).toEqual(initialFlags);
  });
  it('a direct camera command releases ambient ownership before placing its new camera', () => {
    const f = fixture(), request = owner(); f.view.beginAmbientCamera(request); f.view.advanceAmbientCamera({ ...request, deltaSeconds: .05 });
    f.view.setCamera({ position: [9, 10, 9], target: [1, 2, 3] }, { instant: true });
    expect(f.view._ambientCamera).toBeNull(); f.view.camera.position.toArray().forEach((value, index) => expect(value).toBeCloseTo([9, 10, 9][index], 12));
    expect(f.view.controls.target.toArray()).toEqual([1, 2, 3]); expect(f.view.controls.autoRotate).toBe(false);
  });
  it('Top transition captures the restored baseline before replacing controls', () => {
    const f = fixture(), request = owner(), saved = f.view.getCamera(); f.view.fit = vi.fn();
    f.view.beginAmbientCamera(request); f.view.advanceAmbientCamera({ ...request, deltaSeconds: .05 }); f.view.setMode('top');
    expect(f.view._ambientCamera).toBeNull(); expect(f.view.lastCamera3d).toEqual(saved); expect(f.view.camera).toBe(f.view.ortho);
    expect(f.labels.domElement.style.display).toBe('grid'); expect(f.view.controls.autoRotate).toBe(false);
  });
  it('makes equal angular progress at30/60fps and caps a long gap to50ms', () => {
    const angles = [30, 60].map((fps) => {
      const f = fixture(), request = owner(), before = f.view.camera.position.clone().sub(f.view.controls.target); f.view.beginAmbientCamera(request);
      for (let frame = 0; frame < fps; frame++) f.view.advanceAmbientCamera({ ...request, deltaSeconds: 1 / fps });
      const after = f.view.camera.position.clone().sub(f.view.controls.target);
      return Math.atan2(after.x, after.z) - Math.atan2(before.x, before.z);
    });
    expect(angles[0]).toBeCloseTo(-.5 * Math.PI / 180, 12); expect(angles[1]).toBeCloseTo(angles[0], 12);
    const f = fixture(), request = owner(); f.view.beginAmbientCamera(request); const update = vi.spyOn(f.view.controls, 'update');
    f.view.advanceAmbientCamera({ ...request, deltaSeconds: 10 }); expect(update).toHaveBeenCalledExactlyOnceWith(.05);
  });
});

describe('existing RAF, occlusion and resource budget', () => {
  it('skips hidden CSS2D work during rotation and runs one current label pass on wake', () => {
    const f = fixture(), request = owner(), pending = [], element = document.createElement('button');
    const label = new CSS2DObject(element); label.position.set(1, 1, -1); f.view.scene.add(label);
    f.labels.render(f.view.scene, f.view.camera); const originalParent = element.parentNode;
    const labels = vi.spyOn(f.labels, 'render'), rendered = vi.fn(); f.view.onRender = rendered;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { pending.push(callback); return 1; })); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    f.view.beginAmbientCamera(request); f.view.onFrame = () => f.view.advanceAmbientCamera({ ...request, deltaSeconds: 1 / 60 }); f.view.start();
    for (let frame = 0; frame < 60; frame++) pending.shift()();
    expect(labels.mock.calls.length).toBe(0); expect(f.view.renderer.render).toHaveBeenCalledTimes(60); expect(rendered).toHaveBeenCalledTimes(60);
    expect(f.labels.domElement.style.display).toBe('none'); expect(element.parentNode).toBe(originalParent);
    expect(f.view.endAmbientCamera(request)).toBe(true); f.view.onFrame = () => false; pending.shift()();
    expect(labels).toHaveBeenCalledExactlyOnceWith(f.view.scene, f.view.camera); expect(f.labels.domElement.style.display).toBe('grid');
    expect(f.view.stats.frames).toBe(61); expect(rendered).toHaveBeenCalledTimes(61);
    for (let frame = 0; frame < 10; frame++) pending.shift()();
    expect(labels).toHaveBeenCalledTimes(1); expect(f.view.renderer.render).toHaveBeenCalledTimes(61);
  });
  it('wakes latest real labels after a hidden dirty frame even when the camera never advanced', () => {
    const f = fixture(), request = owner(), pending = [], element = document.createElement('button'); element.textContent = 'Temperature 20';
    const label = new CSS2DObject(element); label.position.set(1, 1, -1); f.view.scene.add(label);
    const labels = vi.spyOn(f.labels, 'render');
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { pending.push(callback); return 1; })); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    f.view.beginAmbientCamera(request); f.view.onFrame = () => false; f.view.start();
    element.textContent = 'Temperature 21'; label.position.set(2, 1.5, -2); f.view.dirty = true; pending.shift()();
    expect(labels.mock.calls.length).toBe(0); expect(element.parentNode).toBeNull(); expect(f.view.stats.frames).toBe(1);
    expect(f.view.endAmbientCamera(request)).toBe(false); expect(f.view.dirty).toBe(true); pending.shift()();
    expect(labels).toHaveBeenCalledExactlyOnceWith(f.view.scene, f.view.camera); expect(element.parentNode).toBe(f.labels.domElement);
    expect(element.textContent).toBe('Temperature 21');
    const point = label.getWorldPosition(new THREE.Vector3()).project(f.view.camera);
    const projected = element.style.transform.match(/^translate\(-50%,-50%\)translate\(([^,]+)px,([^)]+)px\)$/);
    expect(projected).not.toBeNull(); expect(Number(projected[1])).toBeCloseTo(point.x * 400 + 400, 10);
    expect(Number(projected[2])).toBeCloseTo(-point.y * 300 + 300, 10);
    expect(f.view.stats.frames).toBe(2); pending.shift()(); expect(labels).toHaveBeenCalledTimes(1); expect(f.view.stats.frames).toBe(2);
  });
  it('a zero-step session with no hidden dirty frame adds no wake rendering', () => {
    const f = fixture(), request = owner(), pending = [], labels = vi.spyOn(f.labels, 'render');
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { pending.push(callback); return 1; })); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    f.view.beginAmbientCamera(request); f.view.onFrame = () => false; f.view.start(); pending.shift()();
    expect(f.view.endAmbientCamera(request)).toBe(false); expect(f.view.dirty).toBe(false); pending.shift()();
    expect(labels.mock.calls.length).toBe(0); expect(f.view.renderer.render).not.toHaveBeenCalled(); expect(f.view.stats.frames).toBe(0);
  });
  it('uses one bounded control update per rotating RAF and ordinary damping remains available otherwise', () => {
    const f = fixture(), request = owner(), pending = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { pending.push(callback); return 1; })); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    f.view.beginAmbientCamera(request); const update = vi.spyOn(f.view.controls, 'update');
    f.view.onFrame = () => f.view.advanceAmbientCamera({ ...request, deltaSeconds: 1 / 60 }); f.view.start();
    for (let frame = 0; frame < 60; frame++) pending.shift()();
    expect(update).toHaveBeenCalledTimes(60); expect(update.mock.calls.every(([delta]) => delta === 1 / 60)).toBe(true);
    expect(f.view.stats.frames).toBe(60); f.view.endAmbientCamera(request); update.mockClear(); f.view.onFrame = () => false;
    pending.shift()(); expect(update).toHaveBeenCalledExactlyOnceWith();
  });
  it('default/dim-only onFrame never starts a camera session or suppresses real drag damping', () => {
    const f = fixture(), pending = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { pending.push(callback); return 1; })); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    f.pointer('pointerdown', 200, 200); f.pointer('pointermove', 240, 220); f.pointer('pointerup', 240, 220);
    const before = f.view.camera.position.clone(), update = vi.spyOn(f.view.controls, 'update'), labels = vi.spyOn(f.labels, 'render'); f.view.onFrame = () => false; f.view.start();
    pending.shift()(); expect(update).toHaveBeenCalledExactlyOnceWith(); expect(f.view.camera.position.equals(before)).toBe(false);
    expect(f.view._ambientCamera).toBeUndefined(); expect(f.labels.domElement.style.display).toBe('grid');
    expect(labels).toHaveBeenCalledExactlyOnceWith(f.view.scene, f.view.camera);
  });
  it('cancels pending occlusion once, creates no per-frame work, then runs one settled pass', () => {
    vi.useFakeTimers(); const f = fixture(), request = owner(); f.view._raf = 1;
    f.view._scheduleOcclusion(); expect(vi.getTimerCount()).toBe(1);
    f.view.beginAmbientCamera(request); expect(vi.getTimerCount()).toBe(0); const schedule = vi.spyOn(globalThis, 'setTimeout'), cancel = vi.spyOn(globalThis, 'clearTimeout');
    for (let frame = 0; frame < 60; frame++) { f.view.advanceAmbientCamera({ ...request, deltaSeconds: 1 / 60 }); f.view._scheduleOcclusion(0, 'mower'); }
    f.view._runOcclusion(); expect(schedule).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled(); expect(f.view.stats.occPasses).toBe(0);
    f.view.endAmbientCamera(request); expect(schedule).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(150); expect(f.view.stats).toMatchObject({ occPasses: 1, occDone: 1 }); expect(vi.getTimerCount()).toBe(0);
  });
  it('stop restores baseline and leaves no timer behind; repeated stop is a no-op', () => {
    vi.useFakeTimers(); const f = fixture(), request = owner(), saved = pose(f.view); f.view._raf = 1;
    vi.stubGlobal('cancelAnimationFrame', vi.fn()); f.view.beginAmbientCamera(request); f.view.advanceAmbientCamera({ ...request, deltaSeconds: .05 });
    f.view.stop(); expectPose(f.view, saved); expect(f.view._ambientCamera).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    const update = vi.spyOn(f.view.controls, 'update'); f.view.stop(); expect(update).not.toHaveBeenCalled();
  });
  it('same-source placement retains the session; actual model disposal discards its baseline and labels', async () => {
    const f = fixture(), request = owner(); f.view._fitShadow = vi.fn(); f.view._shadowDirty = vi.fn(); f.view._applyFloorVisibility = vi.fn(); f.view._objectsInvalid = vi.fn(); f.view._captureModelMotion = vi.fn();
    f.view.beginAmbientCamera(request); await f.view.setModel({ url: 'house' }); expect(f.view._ambientCamera.token).toBe(request.token);
    f.view._sceneBounds = vi.fn(() => null); f.view.highlightModelNode = vi.fn(); f.view._clearGroup = vi.fn(); f.view._applyLook = vi.fn();
    const current = f.view.camera.position.clone(); f.view._disposeModel(); expect(f.view._ambientCamera).toBeNull();
    expect(f.view.camera.position.equals(current)).toBe(true); expect(f.labels.domElement.style.display).toBe('grid'); expect(f.view.model).toBeNull();
  });
  it.each(['realtime', 'off'])('camera-only movement leaves lights/shadows/materials/authored geometry intact under %s shadows', (shadows) => {
    const f = fixture({ lighting: true }), objects = f.view.objectLayer, request = owner(); f.view.setModelRendering({ shadows });
    f.view.dirty = false; objects.stats.shadowRequests = 0; f.view.stats.shadow = 0; f.view.stats.shadowLights = 0;
    const lights = [...objects.pool.points, ...objects.pool.spots], slots = [...objects._slots].map(([id, slot]) => [id, slot.light.uuid]),
      materials = [f.glow.material, ...[...objects.parts.values()].map((part) => part.part.glow?.material).filter(Boolean)],
      versions = materials.map((material) => material.version), geometry = f.glow.geometry, matrix = f.root.matrixWorld.clone(), flags = lights.map((light) => light.shadow.needsUpdate), budget = objects.stats.budget;
    f.view.beginAmbientCamera(request); for (let frame = 0; frame < 60; frame++) f.view.advanceAmbientCamera({ ...request, deltaSeconds: 1 / 60 }); f.view.endAmbientCamera(request);
    expect([...objects.pool.points, ...objects.pool.spots]).toEqual(lights); expect([...objects._slots].map(([id, slot]) => [id, slot.light.uuid])).toEqual(slots);
    expect(materials.map((material) => material.version)).toEqual(versions); expect(f.glow.geometry).toBe(geometry); expect(f.root.matrixWorld.equals(matrix)).toBe(true);
    expect(lights.map((light) => light.shadow.needsUpdate)).toEqual(flags); expect(objects.stats.budget).toBe(budget); expect(objects.stats.shadowRequests).toBe(0);
    expect(f.view.stats.shadow).toBe(0); expect(f.view.stats.shadowLights).toBe(0); expect(f.view.onObjectsInvalidate).not.toHaveBeenCalled();
  });
});
