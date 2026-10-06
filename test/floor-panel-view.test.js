// @vitest-environment jsdom
// Real cameras, raycasts, level ownership and CSS labels run here. The existing
// WebGL renderer alone is a boundary: no GPU context is needed for these checks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { FloorPanelView } from '../src/floor-panel-view.js';
import { FloorPresentationLayer } from '../src/floor-presentation-rendering.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import { MiniMap } from '../src/minimap.js';
import '../src/taylors3d-card.js';

// Card._render constructs a GPU renderer. Only that constructor is replaced;
// every fixture method still comes from the original FloorplanView prototype.
const viewConstructor = vi.hoisted(() => ({ current: null }));
vi.mock('../src/view.js', async (importOriginal) => ({ ...await importOriginal(), FloorplanView: class {
  constructor() { if (!viewConstructor.current) throw new Error('No real View fixture provided'); return viewConstructor.current; }
} }));
const { FloorplanView } = await vi.importActual('../src/view.js');

const fixtures = [];
const near = (actual, expected) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 8));
const snapshotCamera = (camera) => ({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
  zoom: camera.zoom, aspect: camera.aspect, left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom,
  projection: camera.projectionMatrix.toArray(), inverse: camera.projectionMatrixInverse.toArray(), view: structuredClone(camera.view) });
const topology = (root) => { const rows = []; root.traverse((node) => rows.push([node.name, node === root ? null : node.parent?.name ?? null,
  node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), node.matrix.toArray(), node.visible])); return rows; };
const freeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) {
  Object.freeze(value); for (const child of Object.values(value)) freeze(child);
} return value; };

function fixture({ mode = '3d', size = { w: 800, h: 600 }, floorCount = 2 } = {}) {
  const scene = new THREE.Scene(), root = new THREE.Group(), modelGroup = new THREE.Group();
  root.name = 'source-house'; modelGroup.name = 'placed-house'; modelGroup.add(root); scene.add(modelGroup);
  const material = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide });
  const names = [['ground', 'Ground floor'], ['upper', 'Upper floor'], ['second', 'Second floor'], ['loft', 'Loft']];
  const floors = freeze(names.slice(0, floorCount).map(([id, name], index) => ({ id, name, elevation: index * 4, height: 3 })));
  const groups = [], meshes = [], targets = [];
  for (let index = 0; index < floors.length; index++) {
    const group = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(8, .1, 6), material);
    group.name = `level-${floors[index].id}`; group.position.y = floors[index].elevation;
    group.userData.fp = { kind: 'level', id: group.name, elevation: floors[index].elevation, role: 'storey' };
    mesh.name = `room-${floors[index].id}`; mesh.position.y = .05;
    mesh.userData.fp = { kind: 'room', id: mesh.name };
    group.add(mesh); root.add(group); groups.push(group); meshes.push(mesh); targets.push({ floor_id: floors[index].id, node: group });
  }
  const background = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material); background.name = 'background';
  background.position.set(25, 0, 20); root.add(background); root.updateMatrixWorld(true);
  const source = topology(root), raw = freeze({ mode: 'horizontal', panels: true, gap_m: 2, floors: floors.map((floor) => floor.id) });
  const owner = new FloorPresentationLayer();
  const prepared = owner.setData({ raw, modelRoot: root, floors, targets, backgroundNodes: [background], transformWriters: new Set() });
  expect(prepared).toMatchObject({ mode: 'horizontal', valid: true });
  const compiled = owner.report(); expect(compiled.panels).toBe(true); expect(compiled.rows).toHaveLength(floors.length);
  const canvas = document.createElement('canvas'), labelRenderer = new CSS2DRenderer();
  const host = document.createElement('div'); host.append(canvas, labelRenderer.domElement); document.body.append(host);
  const box = { left: 37, top: 53, width: 1200, height: 800 };
  canvas.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height });
  const measured = { ...size }, viewport = new THREE.Vector4(3, 7, 800, 600), scissor = new THREE.Vector4(9, 11, 760, 570);
  let scissorTest = false;
  const draws = [], viewportValue = (target, args) => args[0]?.isVector4 ? target.copy(args[0]) : target.set(...args);
  const renderer = {
    domElement: canvas, autoClear: true, shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false },
    getSize: (target) => target.set(measured.w, measured.h), setSize: vi.fn((w, h) => { measured.w = w; measured.h = h; }),
    getViewport: (target) => target.copy(viewport), getScissor: (target) => target.copy(scissor), getScissorTest: () => scissorTest,
    setViewport: vi.fn((...args) => viewportValue(viewport, args)), setScissor: vi.fn((...args) => viewportValue(scissor, args)),
    setScissorTest: vi.fn((on) => { scissorTest = on; }), clear: vi.fn(), clearDepth: vi.fn(),
    render: vi.fn((current, camera) => {
      current.updateMatrixWorld(true); camera.updateMatrixWorld(true); const shown = [];
      current.traverseVisible((node) => { if (node.isMesh) shown.push(node); });
      draws.push({ scene: current, camera, shown, viewport: viewport.clone(), scissor: scissor.clone(), projection: camera.projectionMatrix.clone() });
    }),
  };
  const persp = new THREE.PerspectiveCamera(35, 4 / 3, .1, 1000); persp.position.set(12, 12, 16); persp.lookAt(0, 0, 0);
  persp.setViewOffset(800, 680, 0, 0, 800, 600); persp.updateMatrixWorld(true);
  const ortho = new THREE.OrthographicCamera(-12, 12, 9, -9, .1, 1000); ortho.position.set(0, 30, 0);
  ortho.up.set(0, 0, -1); ortho.lookAt(0, 0, 0); ortho.updateMatrixWorld(true);
  const view = Object.create(FloorplanView.prototype), camera = mode === 'top' ? ortho : persp;
  const staticGroup = new THREE.Group(), markerGroup = new THREE.Group(), glowGroup = new THREE.Group(), overlayGroup = new THREE.Group();
  const objectsGroup = new THREE.Group(), mowerGroup = new THREE.Group(), stemGroup = new THREE.Group();
  scene.add(staticGroup, markerGroup, glowGroup, overlayGroup, objectsGroup, mowerGroup, stemGroup);
  Object.assign(view, { scene, renderer, labelRenderer, modelGroup, staticGroup, markerGroup, glowGroup, overlayGroup,
    objectsGroup, mowerGroup, stemGroup, floors, camera, persp, ortho, controls: { target: new THREE.Vector3(), object: camera,
      minDistance: 1, maxDistance: 130, update: vi.fn(() => { camera.lookAt(view.controls.target); camera.updateMatrixWorld(true); }) },
    mode, size: { ...size }, visibleFloor: 'all', _visibleSet: null, cssObjects: [], markerObjects: new Map(), glows: new Map(), stems: new Map(),
    model: { id: 'owned', root, manifest: buildManifest(threeAdapter(root)), tagged: true },
    _floorRaw: raw, _floorCompiled: compiled, _floorPresentation: owner,
    _floorOptions: { enabled: true, floors, targets, backgroundNodes: [background] },
    modelClip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), sectionClip: null,
    raycaster: new THREE.Raycaster(), dirty: false, _orthoHalf: 9 });
  const context = { rooms: [], alerts: [] }; view.floorPanelContext = () => context;
  view._floorPanels = new FloorPanelView(view); labelRenderer.setSize(size.w, size.h); scene.updateMatrixWorld(true);
  const point = (floorId, x = 0, y = 0, z = .1) => {
    const floor = floors.find((row) => row.id === floorId);
    const result = view.sourceWorldToDisplay([x, floor.elevation + z, -y], floorId); expect(result.ok).toBe(true);
    return new THREE.Vector3(...result.point);
  };
  const gap = () => {
    const entries = view._floorPanels.entries(), a = entries[0].rect, b = entries[1].rect;
    const x = a.y === b.y ? (a.x + a.width + b.x) / 2 : a.width / 2;
    const y = a.y === b.y ? a.height / 2 : (a.y + a.height + b.y) / 2;
    return [box.left + x * box.width / view.size.w, box.top + y * box.height / view.size.h];
  };
  const addLabel = (floorId, { recorded = true } = {}) => {
    const object = new CSS2DObject(document.createElement('button')); object.element.textContent = `Real ${floorId} actor`;
    object.position.copy(point(floorId, 1, 1, .2)); markerGroup.add(object);
    if (recorded) { view.cssObjects.push({ obj: object, floorId, kind: 'marker', id: floorId }); view.markerObjects.set(floorId, { obj: object, floorId }); }
    return object;
  };
  const f = { view, owner, compiled, root, groups, meshes, background, source, raw, floors, targets, renderer, draws,
    viewport, scissor, labelRenderer, host, canvas, box, context, point, gap, addLabel }; fixtures.push(f); return f;
}
afterEach(() => { for (const f of fixtures.splice(0)) {
  if (f.renderedCard) {
    const card = f.renderedCard; card._popup?.close(); card._devicePopup?.dispose(); card._objects?.dispose();
    card._trackingLayer?.dispose(); card._cameraCoverage?.dispose(); card._statusOverlays?.dispose();
  }
  f.miniMap?.dispose(); f.view._cancelOcclusion(); f.view._floorPanels.clear(); f.view._clearGroup(f.view.staticGroup);
  f.owner.dispose(); f.root.traverse((node) => { if (node.isMesh) node.geometry.dispose(); });
  for (const light of [f.view.sun, f.view.hemi, f.view.moonLight]) light?.dispose(); f.host.remove();
} viewConstructor.current = null; vi.restoreAllMocks(); vi.useRealTimers(); });

describe('actual floor pane geometry and source invariants', () => {
  it.each(['3d', 'top'])('projects and raycasts canonical floor points through CSS-scaled %s panes', (mode) => {
    const f = fixture({ mode });
    for (const floorId of ['ground', 'upper']) for (const [x, y] of [[0, 0], [1.25, -.75], [-2, 1]]) {
      const world = f.point(floorId, x, y), screen = f.view.projectWorld(world, floorId);
      expect(screen).not.toBeNull(); expect(f.view._floorPanels.paneAt(...screen)?.floorId).toBe(floorId);
      near(f.view.displayPlanPoint(...screen, floorId, .1), [x, y]);
      near(f.view.screenPoint(x, y, .1, floorId), screen);
      const ray = f.view._floorPanels.rayAt(...screen, floorId); expect(ray.pane.floorId).toBe(floorId);
      const rc = new THREE.Raycaster(); rc.setFromCamera(ray.ndc, ray.camera);
      const hit = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -world.y), new THREE.Vector3());
      near(hit.toArray(), world.toArray());
    }
  });

  it.each(['3d', 'top'])('does not invent a ray or floor selection for a gap in %s panes', (mode) => {
    const f = fixture({ mode }); const gap = f.gap(), ray = vi.spyOn(f.view.raycaster, 'setFromCamera');
    expect(f.view._floorPanels.paneAt(...gap)).toBeNull(); expect(f.view._floorPanels.rayAt(...gap)).toBeNull();
    expect(f.view.planPoint(...gap, 0)).toBeNull(); expect(f.view._modelHit(...gap)).toBeNull(); expect(ray).not.toHaveBeenCalled();
    const upper = f.view.projectWorld(f.point('upper'), 'upper');
    expect(f.view._floorPanels.rayAt(...upper, 'ground')).toBeNull(); expect(f.view.displayPlanPoint(...upper, 'ground')).toBeNull();
    expect(f.view._floorPanels.projectWorld(f.point('upper'), 'missing')).toBeNull();
  });

  it.each(['3d', 'top'])('the real model pick returns only the exact clicked floor in %s panes', (mode) => {
    const f = fixture({ mode });
    for (let index = 0; index < 2; index++) {
      const id = f.floors[index].id, screen = f.view.projectWorld(f.point(id), id), hit = f.view._modelHit(...screen);
      expect(hit?.object).toBe(f.meshes[index]); expect(f.view.pickModel(...screen)).toMatchObject({ kind: 'room', id: `room-${id}` });
      f.groups[index].visible = false; expect(f.view._modelHit(...screen)).toBeNull(); f.groups[index].visible = true;
    }
  });

  it('skips an unowned model import and nearer other-floor mesh in actual ray picking', () => {
    const f = fixture({ mode: 'top' }), screen = f.view.projectWorld(f.point('ground'), 'ground');
    const unknown = new THREE.Mesh(new THREE.BoxGeometry(8, .1, 6), f.meshes[0].material); unknown.name = 'unowned-new-source'; unknown.position.y = 2;
    f.root.add(unknown); const alien = new THREE.Mesh(new THREE.BoxGeometry(8, .1, 6), f.meshes[0].material);
    f.groups[1].add(alien); alien.position.copy(f.groups[1].worldToLocal(new THREE.Vector3(0, 3, 0))); f.view.scene.updateMatrixWorld(true);
    expect(f.view._floorPanels.floorForNode(unknown)).toBeNull(); expect(f.view._floorPanels.floorForNode(alien)).toBe('upper');
    expect(f.view._modelHit(...screen)?.object).toBe(f.meshes[0]);
  });

  it('does not render newly unclassified source-model geometry in every floor pane', () => {
    const f = fixture(), unknown = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), f.meshes[0].material);
    unknown.name = 'unowned-new-source'; unknown.position.set(0, 1, 0); f.root.add(unknown);
    expect(f.view._floorPanels.floorForNode(unknown)).toBeNull(); expect(f.view._floorPanels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) });
    for (const draw of f.draws) expect(draw.shown).not.toContain(unknown);
    // This temporary rendering rule cannot delete or permanently hide the source.
    expect(unknown.parent).toBe(f.root); expect(unknown.visible).toBe(true);
  });

  it.each(['3d', 'top'])('linked %s orbit, zoom and pan keep distinct display cameras and primary ownership', (mode) => {
    const f = fixture({ mode }), panel = f.view._floorPanels, initial = panel.entries(), refs = initial.map((entry) => entry.camera);
    expect(new Set(refs).size).toBe(2); expect(refs.every((camera) => camera !== f.view.camera)).toBe(true);
    const primary = f.view.camera, target = f.view.controls.target;
    const delta = primary.position.clone().sub(target).multiplyScalar(.75).applyAxisAngle(new THREE.Vector3(0, 1, 0), mode === '3d' ? .45 : 0);
    target.add(new THREE.Vector3(1.2, .3, -.8)); primary.position.copy(target).add(delta); primary.zoom = 1.6; primary.lookAt(target); primary.updateProjectionMatrix();
    const snapshot = snapshotCamera(primary), next = panel.entries();
    expect(next.map((entry) => entry.camera)).toEqual(refs); expect(f.view.camera).toBe(primary); expect(f.view.controls.target).toBe(target);
    expect(snapshotCamera(primary)).toEqual(snapshot);
    const directions = next.map((entry) => entry.camera.getWorldDirection(new THREE.Vector3()).toArray()); near(directions[0], directions[1]);
    near(directions[0], primary.getWorldDirection(new THREE.Vector3()).toArray());
    for (const entry of next) { expect(entry.camera.zoom).toBeCloseTo(1.6); expect(entry.camera.view?.enabled === true).toBe(false); }
    expect(next[0].camera.position.distanceTo(next[1].camera.position)).toBeGreaterThan(8);
  });

  it.each(['3d', 'top'])('actual default %s fit recentres each pane on its own floor after the whole-house fit settles', (mode) => {
    const f = fixture({ mode, size: { w: 320, h: 400 } }), panels = f.view._floorPanels;
    f.view._rooms = f.floors.map((floor) => ({ floorId: floor.id, room: { polygon: [[-4, -3], [4, -3], [4, 3], [-4, 3]] } }));
    f.view._framed = true; const initial = panels.entries(), refs = initial.map((entry) => entry.camera), live = topology(f.root);
    const primary = f.view.camera, target = f.view.controls.target;
    f.view.fit(); if (mode === '3d') { expect(f.view._tween).not.toBeNull(); f.view._stepTween(f.view._tween.t0 + 400); }
    const next = panels.entries(); expect(next.map((entry) => entry.camera)).toEqual(refs);
    for (const entry of next) {
      const centre = new THREE.Vector3(...entry.row.bounds.min).add(new THREE.Vector3(...entry.row.bounds.max)).multiplyScalar(.5)
        .add(new THREE.Vector3(...entry.row.offset));
      near(entry.target.toArray(), centre.toArray());
      const screen = f.view.projectWorld(centre, entry.floorId), rect = entry.rect;
      near(screen, [f.box.left + (rect.x + rect.width / 2) * f.box.width / f.view.size.w,
        f.box.top + (rect.y + rect.height / 2) * f.box.height / f.view.size.h]);
    }
    expect(f.view.camera).toBe(primary); expect(f.view.controls.target).toBe(target); expect(topology(f.root)).toEqual(live);
  });

  it('does not multiply each fitted floor distance by the union-house fit during an actual animated reset', () => {
    const f = fixture({ size: { w: 320, h: 400 } }), panels = f.view._floorPanels;
    f.view._rooms = f.floors.map((floor) => ({ floorId: floor.id, room: { polygon: [[-4, -3], [4, -3], [4, 3], [-4, 3]] } }));
    f.view._framed = true;
    const distances = panels.entries().map((entry) => entry.camera.position.distanceTo(entry.target));
    f.view.fit(); f.view._stepTween(f.view._tween.t0 + 400);
    near(panels.entries().map((entry) => entry.camera.position.distanceTo(entry.target)), distances);
  });

  it.each(['3d', 'top'])('reports the active %s pane camera and target in exact source coordinates', (mode) => {
    const f = fixture({ mode }), panels = f.view._floorPanels;
    f.view.controls.target.set(1.23456789, .3456789, -.7654321);
    for (const id of ['ground', 'upper']) {
      panels.select(id); const entry = panels.entries().find((row) => row.floorId === id), snapshot = panels.cameraSnapshot();
      expect(snapshot.mode).toBe(mode); expect(snapshot.camera.position).toEqual(f.view.displayWorldToSource(entry.camera.position.toArray(), id).point);
      expect(snapshot.camera.target).toEqual(f.view.displayWorldToSource(entry.target.toArray(), id).point);
      near(snapshot.topCamera.center, [snapshot.camera.target[0], -snapshot.camera.target[2]]); expect(snapshot.topCamera.zoom).toBe(entry.camera.zoom);
      snapshot.camera.position[0] = 999; snapshot.camera.target[0] = 999;
      expect(panels.cameraSnapshot().camera.target[0]).not.toBe(999); expect(entry.camera.position.x).not.toBe(999);
    }
  });

  it.each(['3d', 'top'])('focuses an actual displayed %s floor point by panning linked cameras without dropping the other floor', (mode) => {
    const f = fixture({ mode }), panels = f.view._floorPanels, primary = f.view.camera, target = f.view.controls.target;
    panels.entries(); const beforeDirection = primary.getWorldDirection(new THREE.Vector3()).toArray(), beforeDistance = primary.position.distanceTo(target);
    const displayed = f.point('upper', 2.5, -1.5), beforeRoot = topology(f.root);
    expect(panels.focusPlan({ x: displayed.x, y: -displayed.z, floorId: 'upper' })).toBe(true);
    if (f.view._tween) f.view._stepTween(f.view._tween.t0 + 400);
    expect(panels.activeFloorId).toBe('upper'); expect(f.view.camera).toBe(primary); expect(f.view.controls.target).toBe(target);
    near(primary.getWorldDirection(new THREE.Vector3()).toArray(), beforeDirection);
    if (mode === '3d') expect(primary.position.distanceTo(target)).toBeCloseTo(beforeDistance, 8);
    const active = panels.entries().find((entry) => entry.floorId === 'upper'); near([active.target.x, -active.target.z], [displayed.x, -displayed.z]);
    near(panels.cameraSnapshot().topCamera.center, [2.5, -1.5]); expect(panels.entries().map((entry) => entry.floorId)).toEqual(['ground', 'upper']);
    expect(topology(f.root)).toEqual(beforeRoot); expect(f.view._visibleSet).toBeNull(); expect(f.view.visibleFloor).toBe('all');
    const frame = snapshotCamera(primary); expect(panels.focusPlan({ floorId: 'missing', x: 1, y: 1 })).toBe(false);
    expect(panels.focusPlan({ floorId: 'upper', x: NaN, y: 1 })).toBe(false); expect(snapshotCamera(primary)).toEqual(frame);
  });

  it('calls the floor selection hook once for an exact different floor without changing saved policy or primary framing', () => {
    const f = fixture(), panels = f.view._floorPanels, selected = vi.fn(); f.view.onFloorPanelSelect = selected;
    panels.entries(); const primary = snapshotCamera(f.view.camera), policy = JSON.stringify(f.raw);
    expect(panels.select('ground')).toBe(true); expect(selected).not.toHaveBeenCalled();
    expect(panels.select('upper')).toBe(true); expect(selected).toHaveBeenCalledExactlyOnceWith('upper');
    expect(panels.select('upper')).toBe(true); expect(panels.select('deleted')).toBe(false); expect(selected).toHaveBeenCalledTimes(1);
    expect(f.view.dirty).toBe(true); expect(JSON.stringify(f.raw)).toBe(policy); expect(snapshotCamera(f.view.camera)).toEqual(primary);
    expect(f.view._visibleSet).toBeNull(); expect(f.view.visibleFloor).toBe('all');
  });

  it.each([false, true])('uses only current-floor lamp output and restores the same light slots after error=%s', (fail) => {
    const f = fixture(), ground = new THREE.PointLight(0xffcc88, 1.25), upper = new THREE.SpotLight(0x88ccff, 3.75), unknown = new THREE.PointLight(0xffffff, .75);
    const lights = [ground, upper, unknown], parts = new Map([['g', { obj: { node: f.meshes[0] }, part: {} }],
      ['u', { obj: { node: f.meshes[1] }, part: {} }], ['unknown', { obj: { node: f.background }, part: {} }]]);
    const slots = new Map([['g', { light: ground }], ['u', { light: upper }], ['unknown', { light: unknown }]]);
    f.view.objectsGroup.add(...lights, upper.target); f.view.objectLayer = { parts, _slots: slots };
    const original = f.renderer.render.getMockImplementation(), outputs = [], allocation = [...f.view.objectsGroup.children];
    f.renderer.render.mockImplementation((scene, camera) => {
      outputs.push(lights.map((light) => light.intensity));
      if (fail && outputs.length === 2) throw new Error('later lamp draw failed'); original(scene, camera);
    });
    if (fail) expect(() => f.view._floorPanels.render()).toThrow('later lamp draw failed'); else expect(f.view._floorPanels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) });
    expect(outputs).toEqual([[1.25, 0, 0], [0, 3.75, 0]]); expect(lights.map((light) => light.intensity)).toEqual([1.25, 3.75, .75]);
    expect(lights.every((light) => light.visible)).toBe(true); expect(f.view.objectsGroup.children).toEqual(allocation);
    expect(f.view.objectLayer._slots).toBe(slots); expect([...slots.values()].map((slot) => slot.light)).toEqual(lights);
  });

  it('resolves each wall against its own pane camera from one current ownership snapshot', () => {
    const f = fixture(), panel = f.view._floorPanels, participants = vi.spyOn(panel, 'participants');
    const update = vi.fn((now, camera, resolver) => {
      expect(now).toBe(1234); expect(camera).toEqual(f.view.camera.position.toArray());
      expect(resolver(f.meshes[0])).toEqual(panel.cameraForFloor('ground').position.toArray());
      expect(resolver(f.meshes[1])).toEqual(panel.cameraForFloor('upper').position.toArray()); expect(resolver(f.background)).toBeNull();
      return { changed: false, semanticChanged: false, shadowChanged: false };
    });
    f.view._wallPresentation = { moving: false, context: {}, update }; f.view._wallCameraDirty = true;
    expect(f.view.updateWallPresentation(1234)).toBe(false); expect(participants).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
    expect(f.view._wallCameraDirty).toBe(false); expect(f.view.dirty).toBe(false);
    f.view.updateWallPresentation(1235); expect(update).toHaveBeenCalledTimes(1);
    f.view._floorCompiled = { ...f.compiled, panels: false }; f.view._wallCameraDirty = true;
    update.mockImplementationOnce((_now, _camera, resolver) => { expect(resolver).toBeUndefined(); return { changed: false }; });
    f.view.updateWallPresentation(1236); expect(participants).toHaveBeenCalledTimes(1);
  });

  it('renders the same real scene twice with exact temporary membership and restores existing renderer state', () => {
    const f = fixture(), groundLabel = f.addLabel('ground'), upperLabel = f.addLabel('upper'), unknown = f.addLabel('ground', { recorded: false });
    unknown.position.set(0, .3, 0); const primary = snapshotCamera(f.view.camera), live = topology(f.root);
    const viewport = f.viewport.toArray(), scissor = f.scissor.toArray();
    expect(f.view._floorPanels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) }); expect(f.draws).toHaveLength(2);
    expect(f.draws[0].shown).toEqual([f.meshes[0]]); expect(f.draws[1].shown).toEqual([f.meshes[1]]);
    expect(f.draws.every((draw) => draw.scene === f.view.scene)).toBe(true);
    expect(f.viewport.toArray()).toEqual(viewport); expect(f.scissor.toArray()).toEqual(scissor);
    expect(f.renderer.getScissorTest()).toBe(false); expect(f.renderer.autoClear).toBe(true); expect(topology(f.root)).toEqual(live);
    expect(snapshotCamera(f.view.camera)).toEqual(primary); expect(f.labelRenderer.getSize()).toEqual({ width: 800, height: 600 });
    expect(groundLabel.element.parentNode).toBe(f.view._floorPanels.labels.panes.get('ground').clip);
    expect(upperLabel.element.parentNode).toBe(f.view._floorPanels.labels.panes.get('upper').clip);
    expect(groundLabel.element.style.display).toBe(''); expect(upperLabel.element.style.display).toBe('');
    expect(unknown.element.style.display).toBe('none');
  });

  it('builds one current ownership snapshot for both actual floor draws in each synchronous render', () => {
    const f = fixture(), panels = f.view._floorPanels, participants = vi.spyOn(panels, 'participants');
    expect(panels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) });
    expect(f.draws.map((draw) => draw.shown)).toEqual([[f.meshes[0]], [f.meshes[1]]]);
    expect(participants).toHaveBeenCalledTimes(1);
    // A subsequent frame must observe current membership, rather than retaining
    // a cache that could hide a newly imported or rebound object incorrectly.
    const late = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), f.meshes[0].material); f.groups[1].add(late);
    expect(panels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) }); expect(participants).toHaveBeenCalledTimes(2);
    expect(f.draws[2].shown).not.toContain(late); expect(f.draws[3].shown).toContain(late);
  });

  it.each(['3d', 'top'])('keeps the primary %s view usable when a viewport cannot hold two accessible floor panes', (mode) => {
    const f = fixture({ mode }), panels = f.view._floorPanels, primary = f.view.camera;
    panels.render(); const label = f.addLabel('ground'); panels.render();
    // Two rows with a 44px minimum and their gap cannot fit in this viewport.
    f.view.resize(320, 80); expect(panels.entries()).toEqual([]); expect(panels.render()).toBe(false);
    expect(panels.labels.panes.size).toBe(0); expect(label.element.parentNode).toBe(f.labelRenderer.domElement);
    const world = f.point('ground', .5, -.5), projected = world.clone().project(primary);
    const expected = [f.box.left + (projected.x + 1) / 2 * f.box.width, f.box.top + (1 - projected.y) / 2 * f.box.height];
    expect(panels.active).toBe(false);
    near(f.view.projectWorld(world, 'ground'), expected);
    const ray = f.view._screenRay(...expected, 'ground'); expect(ray.camera).toBe(primary); expect(ray.pane).toBeNull();
    near(f.view.displayPlanPoint(...expected, 'ground', .1), [.5, -.5]);
    expect(f.view._modelHit(...expected)?.object).toBe(f.meshes[0]);
    expect(f.view.camera).toBe(primary);
    // Restoring enough space returns both panes, with canonical picking intact.
    f.view.resize(800, 600); expect(panels.active).toBe(true); expect(panels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) });
    for (const id of ['ground', 'upper']) near(f.view.displayPlanPoint(...f.view.projectWorld(f.point(id, .5, -.5), id), id, .1), [.5, -.5]);
  });

  it('requires room for the complete 44px floor heading and its owned insets before enabling panes', () => {
    const f = fixture(), panels = f.view._floorPanels;
    for (const height of [44, 45, 48, 52, 53]) {
      f.view.resize(800, height); expect(panels.active).toBe(false); expect(panels.entries()).toEqual([]); expect(panels.render()).toBe(false);
    }
    f.view.resize(800, 54); expect(panels.active).toBe(true);
    const frame = panels.render(); expect(frame.entries).toHaveLength(2);
    for (const entry of frame.entries) {
      const header = panels.labels.panes.get(entry.floorId).button;
      expect(entry.rect.height).toBe(54); expect(Number.parseFloat(header.style.minHeight)).toBe(44); expect(Number.parseFloat(header.style.top)).toBe(4);
      header.click(); expect(panels.activeFloorId).toBe(entry.floorId);
    }
  });

  it.each(['3d', 'top'])('repeated no-model loading preserves the actual drawn %s floor mapping and panes', async (mode) => {
    const f = fixture({ mode });
    // Use the real unloading path first, then build an actual drawn floor plan.
    // Renderer colour and physical lights are only the GPU constructor boundary.
    Object.assign(f.view, { theme: { floor: '#aaaaaa', outdoor: '#bbbbbb', wall: '#777777', edge: '#333333' },
      sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), moonLight: new THREE.DirectionalLight(), stats: { shadow: 0 } });
    f.renderer.setClearColor = vi.fn(); await f.view.setModel(null); expect(f.view.model).toBeNull();
    const rooms = freeze(f.floors.map((floor) => ({ floorId: floor.id, label: floor.name,
      room: { id: `drawn-${floor.id}`, polygon: [[-4, -3], [4, -3], [4, 3], [-4, 3]] } })));
    const bounds = freeze(f.floors.map((floor) => ({ floor_id: floor.id, min: [-4, floor.elevation, -3], max: [4, floor.elevation + 3, 3] })));
    const source = JSON.stringify([f.raw, f.floors, rooms, bounds]);
    const report = f.view.setFloorPresentation(f.raw, { floors: f.floors, bounds });
    expect(report).toMatchObject({ valid: true, mode: 'horizontal', panels: true }); f.view.setStructure(f.floors, rooms, { walls: false, outlines: false });
    const sourcePoint = [1, f.floors[1].elevation + .2, -1], display = f.view.sourceWorldToDisplay(sourcePoint, 'upper');
    expect(display.ok).toBe(true); near(display.point, [11, .2, -1]);
    expect(f.view._floorPanels.render().entries).toHaveLength(2);
    const drawnGroups = [...f.view.staticGroup.children], geometry = drawnGroups.map((group) => group.children.find((node) => node.isMesh));
    const before = topology(f.view.staticGroup);
    for (let update = 0; update < 2; update++) {
      await f.view.setModel(null); expect(f.view.model).toBeNull();
      expect(f.view.floorPresentationReport()).toMatchObject({ valid: true, mode: 'horizontal', panels: true });
      expect(f.view.sourceWorldToDisplay(sourcePoint, 'upper')).toEqual(display);
      expect(f.view._floorPanels.render().entries).toHaveLength(2); expect(f.view.staticGroup.children).toEqual(drawnGroups);
      expect(topology(f.view.staticGroup)).toEqual(before);
      for (const floor of f.floors) near(f.view.displayPlanPoint(...f.view.projectWorld(f.point(floor.id, 1, -1), floor.id), floor.id, .1), [1, -1]);
    }
    expect(f.draws.slice(-2).map((draw) => draw.shown)).toEqual(geometry.map((mesh) => [mesh]));
    expect(JSON.stringify([f.raw, f.floors, rooms, bounds])).toBe(source);
  });

  it('rechecks settled wall sides against the new real pane cameras after actual View.resize', () => {
    const f = fixture(), cameras = [], update = vi.fn((_now, _primary, resolver) => {
      cameras.push(resolver(f.meshes[0])); return { changed: false, semanticChanged: false, shadowChanged: false };
    });
    f.view._wallPresentation = { moving: false, context: {}, update }; f.view._wallCameraDirty = true;
    f.view.updateWallPresentation(1234); expect(update).toHaveBeenCalledTimes(1); expect(f.view._wallCameraDirty).toBe(false);
    const primaryPosition = f.view.camera.position.toArray();
    f.view.resize(500, 700); f.view.updateWallPresentation(1235);
    expect(update).toHaveBeenCalledTimes(2); expect(cameras[1]).toEqual(f.view._floorPanels.cameraForFloor('ground').position.toArray());
    expect(cameras[1]).not.toEqual(cameras[0]); expect(f.view.camera.position.toArray()).toEqual(primaryPosition);
    f.view.updateWallPresentation(1236); expect(update).toHaveBeenCalledTimes(2);
  });

  it('settles marker occlusion against the resized real pane camera without requiring another orbit gesture', () => {
    vi.useFakeTimers(); const f = fixture(), label = f.addLabel('ground'), panels = f.view._floorPanels;
    panels.entries(); const previous = panels.cameraForFloor('ground').position.toArray(); label.element.classList.add('fp-occluded');
    Object.assign(f.view, { _raf: 1, _occGen: 0, _occRay: new THREE.Raycaster(), _occlusion: true, _camMovedAt: -1000,
      stats: { occPasses: 0, occPartial: 0, occDone: 0 } });
    const schedule = vi.spyOn(f.view, '_scheduleOcclusion'), cameraForFloor = vi.spyOn(panels, 'cameraForFloor');
    f.view.resize(500, 700); expect(schedule).toHaveBeenCalledTimes(1); vi.runOnlyPendingTimers();
    expect(cameraForFloor).toHaveBeenCalledWith('ground'); expect(cameraForFloor.mock.lastCall).toEqual(['ground']);
    expect(panels.cameraForFloor('ground').position.toArray()).not.toEqual(previous);
    expect(label.element.classList.contains('fp-occluded')).toBe(false); expect(f.view.stats.occDone).toBe(1);
  });

  it('keeps four fitted floor targets and slab corners inside pane clipping without changing the primary camera', () => {
    const f = fixture({ floorCount: 4 }), panels = f.view._floorPanels;
    // The ordinary house camera can have a short far plane. Narrow four-floor
    // panes require a farther fitted camera, so they need their own clip range.
    f.view.camera.far = 52.5; f.view.camera.updateProjectionMatrix(); const primary = snapshotCamera(f.view.camera);
    const entries = panels.entries(); expect(entries).toHaveLength(4);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      for (const [x, y] of [[0, 0], [-3.8, -2.8], [-3.8, 2.8], [3.8, -2.8], [3.8, 2.8]]) {
        const world = f.point(entry.floorId, x, y), ndc = world.clone().project(entry.camera);
        expect(ndc.z).toBeGreaterThanOrEqual(-1); expect(ndc.z).toBeLessThanOrEqual(1);
        const screen = f.view.projectWorld(world, entry.floorId); expect(screen).not.toBeNull();
        expect(f.view._modelHit(...screen)?.object).toBe(f.meshes[index]);
        near(f.view.displayPlanPoint(...screen, entry.floorId, .1), [x, y]);
      }
    }
    expect(panels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) }); expect(f.draws.map((draw) => draw.shown)).toEqual(f.meshes.map((mesh) => [mesh]));
    expect(snapshotCamera(f.view.camera)).toEqual(primary);
  });

  it('keeps frozen source settings and exported authored transforms unchanged through renders and selection', () => {
    const f = fixture(), settings = JSON.stringify([f.raw, f.floors]);
    const live = topology(f.root), source = f.view.sourceModelRootForExport(); expect(source.ok).toBe(true); expect(source.root).not.toBe(f.root);
    expect(topology(source.root)).toEqual(f.source); f.view._floorPanels.render(); f.view._floorPanels.select('upper'); f.view._floorPanels.render();
    expect(JSON.stringify([f.raw, f.floors])).toBe(settings); expect(topology(f.root)).toEqual(live);
    expect(topology(f.view.sourceModelRootForExport().root)).toEqual(f.source);
    const sameResources = []; source.root.traverse((node) => { if (node.isMesh) sameResources.push(node.geometry); });
    expect(sameResources).toEqual([...f.meshes, f.background].map((node) => node.geometry));
  });

  it.each(['3d', 'top'])('resizes %s pane rectangles and restores projections after every temporary render', (mode) => {
    const f = fixture({ mode }), primary = snapshotCamera(f.view.camera);
    for (const [w, h] of [[800, 600], [500, 700], [1100, 480], [500, 700], [800, 600]]) {
      f.view.size = { w, h }; f.renderer.setSize(w, h); f.labelRenderer.setSize(w, h);
      const entries = f.view._floorPanels.entries(), projections = entries.map((entry) => snapshotCamera(entry.camera));
      expect(entries).toHaveLength(2); expect(entries[0].rect.x === entries[1].rect.x).toBe(w < 640);
      expect(f.view._floorPanels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) });
      expect(entries.map((entry) => snapshotCamera(entry.camera))).toEqual(projections); expect(snapshotCamera(f.view.camera)).toEqual(primary);
      for (const id of ['ground', 'upper']) {
        const point = f.point(id, .75, -.5), screen = f.view.projectWorld(point, id);
        near(f.view.displayPlanPoint(...screen, id, .1), [.75, -.5]);
      }
    }
  });

  it('removes owned pane UI when panels are disabled without moving the primary camera', () => {
    const f = fixture(), label = f.addLabel('ground'); f.view._floorPanels.render();
    const primary = snapshotCamera(f.view.camera), before = f.view.camera, target = f.view.controls.target.toArray();
    f.view._floorCompiled = { ...f.compiled, panels: false };
    expect(f.view._floorPanels.active).toBe(false); expect(f.view._floorPanels.render()).toBe(false);
    expect(f.view._floorPanels.labels.panes.size).toBe(0); expect(label.element.parentNode).toBe(f.labelRenderer.domElement);
    expect(f.view.camera).toBe(before); expect(snapshotCamera(f.view.camera)).toEqual(primary); expect(f.view.controls.target.toArray()).toEqual(target);
  });

  it('native heading selection and actual focused actor survive repeated integrated frames', () => {
    const f = fixture(), label = f.addLabel('ground'); f.addLabel('upper'); const panels = f.view._floorPanels;
    panels.render(); const header = panels.labels.panes.get('upper').button; header.click();
    expect(panels.activeFloorId).toBe('upper'); expect(f.view.dirty).toBe(true);
    header.focus(); panels.render(); expect(document.activeElement).toBe(header);
    label.element.focus(); panels.render(); panels.render(); expect(document.activeElement).toBe(label.element);
    expect(Object.hasOwn(f.labelRenderer.domElement, 'appendChild')).toBe(false);
  });

  it('restores visibility, projection and renderer state when an actual pane render throws', () => {
    const f = fixture(), entries = f.view._floorPanels.entries(), projections = entries.map((entry) => snapshotCamera(entry.camera));
    const live = topology(f.root), viewport = f.viewport.toArray(), scissor = f.scissor.toArray();
    f.renderer.render.mockImplementationOnce(() => { throw new Error('GPU draw failed'); });
    expect(() => f.view._floorPanels.render()).toThrow('GPU draw failed');
    expect(topology(f.root)).toEqual(live); expect(f.viewport.toArray()).toEqual(viewport); expect(f.scissor.toArray()).toEqual(scissor);
    expect(f.renderer.getScissorTest()).toBe(false); expect(f.renderer.autoClear).toBe(true);
    expect(entries.map((entry) => snapshotCamera(entry.camera))).toEqual(projections);
  });

  it('cleans incomplete pane UI if a later draw fails after the first real label pass', () => {
    const f = fixture(), label = f.addLabel('ground'), original = f.renderer.render.getMockImplementation();
    f.renderer.render.mockImplementationOnce(original).mockImplementationOnce(() => { throw new Error('second pane draw failed'); });
    expect(() => f.view._floorPanels.render()).toThrow('second pane draw failed');
    expect(f.view._floorPanels.labels.panes.size).toBe(0); expect(label.element.parentNode).toBe(f.labelRenderer.domElement);
    expect(f.labelRenderer.getSize()).toEqual({ width: 800, height: 600 });
  });
});

describe('actual card prototype routes room/device controls to the clicked floor', () => {
  function cardFor(f) {
    const card = Object.create(customElements.get('taylors3d-card').prototype);
    const rooms = f.floors.map((floor) => ({ floorId: floor.id, name: `${floor.name} room`,
      room: { id: `drawn-${floor.id}`, modelId: `room-${floor.id}`, floor_id: floor.id, polygon: [[-4, -3], [4, -3], [4, 3], [-4, 3]] } }));
    Object.assign(card, { _view: f.view, _floors: f.floors, _roomList: rooms, _layout: { rooms: [] }, _config: { group_by: 'device', room_labels: 'name' },
      _floorPresentationReportValue: f.compiled,
      _hass: { states: {}, entities: {}, devices: {}, areas: {}, floors: {} }, _groups: {}, _navigationRooms: () => rooms,
      _stopScenePreview: vi.fn(), _popup: { close: vi.fn() }, _devicePopup: { update: vi.fn(), showRoom: vi.fn() },
      _syncMiniMap: vi.fn(), _stage: document.createElement('div') });
    return { card, rooms };
  }

  function configureActualMiniMap(card, f) {
    delete card._syncMiniMap; delete card._navigationRooms;
    Object.assign(card, { _stage: f.host, _mode: f.view.mode, _editing: false, _miniMapVisible: true, _markers: [], _positions: new Map(),
      _trackingData: { miniMap: [] }, _securityPlanData: { miniMap: [] }, _securitySessionGeneration: 0,
      _viewState: { allFloors: false, floors: ['ground', 'upper'] }, _selectedRoomId: 'old-room',
      _syncToolbarLabels: vi.fn(), _syncFloorPresentation: vi.fn(), _syncSecurity: vi.fn(), _syncTracking: vi.fn(),
      _syncWeather: vi.fn(), _syncStatus: vi.fn(), _syncCameraCoverage: vi.fn(), _syncToolbar: vi.fn(),
      _alertMapMarkers: () => [], _suspendAmbient: vi.fn(), _presetEvents: { interrupt: vi.fn() }, _setFloor: vi.fn() });
    card._devicePopup.close = vi.fn(); card._hass.callService = vi.fn();
    card._configureMiniMap(); f.miniMap = card._miniMap; expect(f.miniMap).toBeInstanceOf(MiniMap);
    return f.miniMap;
  }

  function installActualRenderCallbacks(card, f) {
    const root = document.createElement('div'); f.host.append(root); Object.defineProperty(card, 'shadowRoot', { value: root });
    Object.assign(card, { _view: null, _mode: f.view.mode, _miniMap: { updateCamera: vi.fn() },
      _config: { ...card._config, height: '600px', control_panel: 'popup' },
      finishWallSelectionPreparation: vi.fn(), _unwatchAmbientPreference: vi.fn(), _unbindAmbientInput: vi.fn(),
      _watchAmbientPreference: vi.fn(), _syncModelRendering: vi.fn(), _ensureWeatherLayer: vi.fn(),
      _suspendAmbient: vi.fn(), _configureMiniMap: vi.fn(), _houseLayoutEnabled: () => false });
    viewConstructor.current = f.view;
    // The owned callbacks are now installed. The rest of _render initializes
    // unrelated editing/model loading, outside this focused View boundary.
    const stop = vi.spyOn(f.view, 'setOcclusion').mockImplementationOnce(() => { throw new Error('callbacks installed'); });
    try { expect(() => card._render()).toThrow('callbacks installed'); } finally { stop.mockRestore(); viewConstructor.current = null; }
    f.renderedCard = card; card._scene.getBoundingClientRect = () => ({ ...f.box, right: f.box.left + f.box.width, bottom: f.box.top + f.box.height });
    card._stage.getBoundingClientRect = card._scene.getBoundingClientRect;
    expect(card._view).toBe(f.view); expect(card._view._modelHit).toBe(FloorplanView.prototype._modelHit);
    return card._view.onRender;
  }

  it.each(['3d', 'top'])('the configured %s mini-map uses the active pane source camera exactly once and leaves both 3D floors visible', (mode) => {
    const f = fixture({ mode }), { card } = cardFor(f); f.view._floorPanels.select('upper');
    const map = configureActualMiniMap(card, f), snapshot = f.view._floorPanels.cameraSnapshot();
    expect(map.scene.floorId).toBe('upper'); expect(map.scene.rooms.map((room) => room.floorId)).toEqual(['upper']);
    near(map._camera.focus, snapshot.topCamera.center); near(map._camera.focus, [0, 0]);
    expect(map._data.camera).toEqual(snapshot.camera); expect(card._navigationFloors()).toEqual(['ground', 'upper']);
    expect(f.view._floorPanels.entries().map((entry) => entry.floorId)).toEqual(['ground', 'upper']);
    expect(f.groups.every((group) => group.visible)).toBe(true); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each(['3d', 'top'])('the actual %s mini-map pointer focus pans linked panes using canonical coordinates and closes controls without HA actions', (mode) => {
    const f = fixture({ mode }), { card } = cardFor(f); f.view._floorPanels.select('upper');
    const map = configureActualMiniMap(card, f), original = topology(f.root);
    map.svg.getBoundingClientRect = () => ({ left: 5, top: 9, width: 200, height: 150 });
    const [x, y] = map.scene.transform.toSvg([2.25, -1.75]);
    map.ground.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5 + x, clientY: 9 + y }));
    if (f.view._tween) f.view._stepTween(f.view._tween.t0 + 400);
    card._syncMiniMap();
    near(f.view._floorPanels.cameraSnapshot().topCamera.center, [2.25, -1.75]); near(map._camera.focus, [2.25, -1.75]);
    expect(card._setFloor).not.toHaveBeenCalled(); expect(card._navigationFloors()).toEqual(['ground', 'upper']);
    expect(card._popup.close).toHaveBeenCalledTimes(1); expect(card._devicePopup.close).toHaveBeenCalledTimes(1);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(topology(f.root)).toEqual(original);
    expect(f.view._floorPanels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) }); expect(f.draws[0].shown).toEqual([f.meshes[0]]); expect(f.draws[1].shown).toEqual([f.meshes[1]]);
  });

  it('opens only the actual clicked room and sends no control service just by selecting it', () => {
    const f = fixture({ mode: 'top' }), { card, rooms } = cardFor(f); card._hass.callService = vi.fn();
    for (const floor of f.floors) {
      const screen = f.view.projectWorld(f.point(floor.id), floor.id); card._openRoomAt(...screen);
      expect(card._selectedRoomId).toBe(`drawn-${floor.id}`);
      expect(card._devicePopup.showRoom.mock.lastCall[0]).toMatchObject({ ...rooms.find((room) => room.floorId === floor.id).room });
    }
    expect(card._hass.callService).not.toHaveBeenCalled();
    const count = card._devicePopup.showRoom.mock.calls.length; card._openRoomAt(...f.gap()); expect(card._devicePopup.showRoom).toHaveBeenCalledTimes(count);
  });

  it('filters bound object controls by exact floor before distance and occlusion picking', () => {
    const f = fixture({ mode: 'top' }), { card } = cardFor(f), items = new Map();
    for (let index = 0; index < 2; index++) {
      const id = f.floors[index].id, node = f.meshes[index];
      items.set(id, { obj: { id, node }, binding: freeze({ entity: `light.${id}`, hidden: false, floor_id: id }) });
    }
    card._levelShown = () => () => true;
    card._objects = { model: f.view.model, displayAnchors: () => [...items].map(([id]) => ({ id, world: f.point(id) })), objectAt: (id) => items.get(id) };
    const bindings = JSON.stringify([...items.values()].map((item) => item.binding));
    for (const id of ['ground', 'upper']) {
      const screen = f.view.projectWorld(f.point(id), id); expect(card._objectHit(...screen, 25)).toBe(id);
    }
    expect(card._objectHit(...f.gap(), 10000)).toBeNull(); expect(JSON.stringify([...items.values()].map((item) => item.binding))).toBe(bindings);
    items.get('upper').binding = freeze({ entity: 'light.upper', hidden: true, floor_id: 'upper' });
    expect(card._objectHit(...f.view.projectWorld(f.point('upper'), 'upper'), 10000)).toBeNull();
  });

  it('opens ordinary device controls without scanning pane membership when panes are disabled', () => {
    const f = fixture(), { card } = cardFor(f), world = f.point('ground', .5, -.5);
    f.view._floorCompiled = { ...f.compiled, panels: false }; expect(f.view._floorPanels.active).toBe(false);
    const object = { obj: { id: 'actual-lamp', label: 'Actual lamp', node: f.meshes[0], type: 'light' },
      binding: freeze({ entity: 'light.actual_lamp' }), chain: { entities: ['light.actual_lamp'] } };
    card._objects = { objectAt: (id) => id === object.obj.id ? object : null, displayAnchors: () => [{ id: object.obj.id, world }] };
    card._hass.states['light.actual_lamp'] = { entity_id: 'light.actual_lamp', state: 'on', attributes: {} };
    card._hass.callService = vi.fn(); card._devicePopup.showMarker = vi.fn(); card._config.device_tap_action = 'popup';
    const floorForNode = vi.spyOn(f.view._floorPanels, 'floorForNode'), participants = vi.spyOn(f.view._floorPanels, 'participants');
    const expected = f.view.projectWorld(world); card._runObjectAction(object.obj.id, 'tap');
    expect(card._devicePopup.showMarker).toHaveBeenCalledExactlyOnceWith({ name: 'Actual lamp', entityId: 'light.actual_lamp',
      entities: [{ eid: 'light.actual_lamp' }] }, expected);
    expect(floorForNode).not.toHaveBeenCalled(); expect(participants).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('the actual ObjectPopup position callback avoids pane membership while panels are disabled', () => {
    const f = fixture(), { card } = cardFor(f); installActualRenderCallbacks(card, f);
    f.view._floorCompiled = { ...f.compiled, panels: false };
    const world = f.point('ground', .5, -.5), node = f.meshes[0];
    vi.spyOn(card._objects, 'objectAt').mockReturnValue({ obj: { node } }); vi.spyOn(card._objects, 'displayAnchorOf').mockReturnValue(world);
    card._popup._id = 'real-lamp'; card._popup.el = document.createElement('div'); card._stage.append(card._popup.el);
    const project = vi.spyOn(f.view, 'projectWorld'), floor = vi.spyOn(f.view._floorPanels, 'floorForNode'), participants = vi.spyOn(f.view._floorPanels, 'participants');
    card._popup.position(); expect(project).toHaveBeenCalledExactlyOnceWith(world, undefined);
    expect(card._popup.el.style.visibility).toBe(''); expect(card._popup.el.style.transform).toContain('translate(');
    expect(floor).not.toHaveBeenCalled(); expect(participants).not.toHaveBeenCalled();
  });

  it('actual Card.onRender reuses its synchronous ownership map while arranging real floor actors', () => {
    const f = fixture(), { card } = cardFor(f), onRender = installActualRenderCallbacks(card, f), panels = f.view._floorPanels;
    card._trackingLayer.setData({ records: f.floors.map((floor) => ({ id: `presence:${floor.id}`, entity: `person.${floor.id}`,
      kind: 'presence', active: true, shown: true, label: `Actor ${floor.id}`,
      location: { x: 1, y: 1, z: .2, floorId: floor.id, elevation: floor.elevation } })), now: 1234 });
    for (const part of card._trackingLayer.parts.values()) part.group.position.copy(f.point(part.floorId, 1, 1, .2));
    const participants = vi.spyOn(panels, 'participants'), withFloor = vi.spyOn(panels, 'withFloor'), visibility = [];
    const original = card._trackingLayer.arrangeScreenLabels;
    const arrange = vi.spyOn(card._trackingLayer, 'arrangeScreenLabels').mockImplementation(function (bounds) {
      visibility.push([...this.parts.values()].map((part) => part.group.visible)); return original.call(this, bounds);
    });
    const frame = panels.render(); onRender(frame);
    expect(participants).toHaveBeenCalledTimes(1); expect(withFloor).toHaveBeenCalledTimes(2); expect(arrange).toHaveBeenCalledTimes(2);
    expect(withFloor.mock.calls.map(([floorId, , members]) => [floorId, members === frame.members])).toEqual([['ground', true], ['upper', true]]);
    expect(visibility).toEqual([[true, false], [false, true]]); expect([...card._trackingLayer.parts.values()].every((part) => part.group.visible)).toBe(true);
    for (const [index, entry] of frame.entries.entries()) {
      expect(arrange.mock.calls[index][0]).toEqual({ left: f.box.left + entry.rect.x * f.box.width / f.view.size.w,
        top: f.box.top + (entry.rect.y + 52) * f.box.height / f.view.size.h,
        width: entry.rect.width * f.box.width / f.view.size.w, height: Math.max(0, entry.rect.height - 52) * f.box.height / f.view.size.h });
      const part = card._trackingLayer.parts.get(`presence:${entry.floorId}`);
      expect(part.label.element.parentNode).toBe(panels.labels.panes.get(entry.floorId).clip);
    }
  });

  it('actual Card.onRender performs no extra ownership scans when the real tracking layer is empty', () => {
    const f = fixture(), { card } = cardFor(f), onRender = installActualRenderCallbacks(card, f), panels = f.view._floorPanels;
    expect(card._trackingLayer.parts.size).toBe(0);
    const participants = vi.spyOn(panels, 'participants'), withFloor = vi.spyOn(panels, 'withFloor');
    const frame = panels.render(); onRender(frame);
    expect(participants).toHaveBeenCalledTimes(1); expect(withFloor).not.toHaveBeenCalled();
    expect(card._miniMap.updateCamera).toHaveBeenCalledExactlyOnceWith(panels.cameraSnapshot());
  });

  it('uses canonical selected-pane room outlines when a model slab has no room tag', () => {
    const f = fixture({ mode: 'top' }), { card } = cardFor(f);
    for (const mesh of f.meshes) mesh.userData.fp = {};
    f.view.model.manifest = buildManifest(threeAdapter(f.root));
    for (const id of ['ground', 'upper']) {
      const screen = f.view.projectWorld(f.point(id, 2.5, 1.5), id);
      expect(f.view.pickModel(...screen)?.kind).not.toBe('room'); card._openRoomAt(...screen);
      expect(card._selectedRoomId).toBe(`drawn-${id}`);
    }
    const count = card._devicePopup.showRoom.mock.calls.length; card._openRoomAt(...f.gap()); expect(card._devicePopup.showRoom).toHaveBeenCalledTimes(count);
  });

  it('uses the clicked pane source plane for a drawn plan with no imported house', () => {
    const f = fixture({ mode: 'top' }), { card } = cardFor(f); f.view.model = null;
    for (const id of ['ground', 'upper']) {
      const screen = f.view.projectWorld(f.point(id, -2.5, 1.5), id); card._openRoomAt(...screen);
      expect(card._selectedRoomId).toBe(`drawn-${id}`);
    }
    expect(card._devicePopup.showRoom).toHaveBeenCalledTimes(2);
  });

  it.each(['name', 'size', 'none'])('keeps the saved %s room-label preference when simultaneous model panes expose both floors', (mode) => {
    const f = fixture(), { card } = cardFor(f); card._config.room_labels = mode;
    const structure = vi.spyOn(f.view, 'setStructure').mockImplementation(() => {}); card._pushStructure();
    expect(card._labelKey).toBe('panels:ground|upper'); const rooms = structure.mock.lastCall[1]; expect(rooms).toHaveLength(2);
    for (const room of rooms) {
      if (mode === 'none') expect(room.label).toBe('');
      else expect(room.label).toContain(f.floors.find((floor) => floor.id === room.floorId).name);
    }
    expect(card._config.room_labels).toBe(mode);
  });
});
