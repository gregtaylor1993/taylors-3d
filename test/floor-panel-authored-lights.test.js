// @vitest-environment jsdom
// Real scene/model ownership and floor rendering run here. Only the WebGL
// renderer is a boundary; no GPU, Card timer or Home Assistant is constructed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { FloorplanView } from '../src/view.js';
import { FloorPanelView } from '../src/floor-panel-view.js';
import { FloorPresentationLayer } from '../src/floor-presentation-rendering.js';

const fixtures = [];
const freeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) {
  Object.freeze(value); for (const child of Object.values(value)) freeze(child);
} return value; };
const transforms = (root) => { const rows = []; root.traverse((node) => rows.push({ node, parent: node.parent,
  position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(),
  matrix: node.matrix.toArray(), visible: node.visible })); return rows; };
const lampSnapshot = (lamp) => ({ parent: lamp.parent, position: lamp.position.toArray(), quaternion: lamp.quaternion.toArray(), scale: lamp.scale.toArray(),
  visible: lamp.visible, intensity: lamp.intensity, color: lamp.color.toArray(), distance: lamp.distance, decay: lamp.decay,
  angle: lamp.angle, penumbra: lamp.penumbra, castShadow: lamp.castShadow, layers: lamp.layers.mask,
  shadow: lamp.shadow, shadowAuto: lamp.shadow?.autoUpdate, shadowNeeds: lamp.shadow?.needsUpdate });
const constructors = [['PointLight', THREE.PointLight], ['SpotLight', THREE.SpotLight], ['DirectionalLight', THREE.DirectionalLight]];
const paneDraws = (f) => f.draws.filter((draw) => draw.viewport.z > 0 && draw.viewport.w > 0);

function globals(f) {
  const hemi = new THREE.HemisphereLight(0x7799bb, 0x333322, .75), sun = new THREE.DirectionalLight(0xffeecc, 1.65), moon = new THREE.DirectionalLight(0x8899ff, .125);
  f.scene.add(hemi, sun, sun.target, moon, moon.target); Object.assign(f.view, { hemi, sun, moonLight: moon });
  return [hemi, sun, moon];
}

function pool(f) {
  const ground = new THREE.PointLight(0xffcc77, 1.25), upper = new THREE.SpotLight(0x77aaff, 3.75), unused = new THREE.PointLight(0xffffff, 0);
  f.view.objectsGroup.add(ground, upper, upper.target, unused);
  const slots = new Map([['ground-lamp', { light: ground }], ['upper-lamp', { light: upper }]]),
    parts = new Map([['ground-lamp', { obj: { node: f.groundMesh }, part: {} }], ['upper-lamp', { obj: { node: f.upperMesh }, part: {} }]]),
    lights = { points: [ground, unused], spots: [upper] };
  Object.assign(f.view.objectLayer, { _slots: slots, parts, pool: lights });
  return { ground, upper, unused, slots, parts, lights };
}

function measuredActor(f) {
  const node = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(.4, .1, .4), f.material), lamp = new THREE.SpotLight(0x1199ff, 3.125);
  node.name = 'measured-upper-authored-actor'; node.add(body, lamp, lamp.target); f.upper.add(node);
  const prepared = { obj: { node, type: 'mower' }, type: { place() {} }, part: { displayFloorId: f.floors[0].id, origin: { localY: .15 } } };
  f.view.objectLayer.parts.set('mower', prepared); f.view.objectLayer._pose = { floorId: f.floors[0].id, x: 1, y: 2 };
  return { node, body, lamp, prepared };
}

function fixture({ populate } = {}) {
  const scene = new THREE.Scene(), root = new THREE.Group(), ground = new THREE.Group(), upper = new THREE.Group(), background = new THREE.Group();
  root.name = 'actual-model'; ground.name = 'ground-source'; upper.name = 'upper-source'; background.name = 'explicit-background';
  upper.position.y = 4; root.add(ground, upper, background); scene.add(root);
  const material = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: .6 });
  const slab = () => new THREE.Mesh(new THREE.BoxGeometry(8, .1, 6), material);
  const groundMesh = slab(), upperMesh = slab(), driveway = new THREE.Mesh(new THREE.BoxGeometry(1, .1, 1), material);
  ground.add(groundMesh); upper.add(upperMesh); background.add(driveway); background.position.x = 30;
  populate?.({ root, ground, upper, background });
  const floors = freeze([{ id: 'ground:main', name: 'Ground floor', elevation: 0, height: 3 }, { id: 'upper:east', name: 'Upper floor', elevation: 4, height: 3 }]);
  const targets = [{ floor_id: floors[0].id, node: ground }, { floor_id: floors[1].id, node: upper }], raw = freeze({ mode: 'horizontal', panels: true, gap_m: 2, floors: floors.map((row) => row.id) });
  root.updateMatrixWorld(true); const authored = transforms(root), owner = new FloorPresentationLayer();
  expect(owner.setData({ raw, modelRoot: root, floors, targets, backgroundNodes: [background], transformWriters: new Set() })).toMatchObject({ valid: true, mode: 'horizontal' });
  const compiled = owner.report(); expect(compiled.panels).toBe(true); expect(compiled.rows).toHaveLength(2);
  const canvas = document.createElement('canvas'), labelRenderer = new CSS2DRenderer(), host = document.createElement('div');
  host.append(canvas, labelRenderer.domElement); document.body.append(host);
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
  const viewport = new THREE.Vector4(3, 7, 800, 600), scissor = new THREE.Vector4(9, 11, 760, 570), draws = [];
  let scissorTest = false;
  const setBox = (target, args) => args[0]?.isVector4 ? target.copy(args[0]) : target.set(...args);
  const renderer = { domElement: canvas, autoClear: true, shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false },
    getSize: (target) => target.set(800, 600), getViewport: (target) => target.copy(viewport), getScissor: (target) => target.copy(scissor), getScissorTest: () => scissorTest,
    setViewport: vi.fn((...args) => setBox(viewport, args)), setScissor: vi.fn((...args) => setBox(scissor, args)), setScissorTest: vi.fn((value) => { scissorTest = value; }),
    clear: vi.fn(), clearDepth: vi.fn(), render: vi.fn((current, camera) => {
      current.updateMatrixWorld(true); camera.updateMatrixWorld(true); const lamps = new Map(), visible = new Map();
      current.traverse((node) => { visible.set(node, node.visible); if (node.isLight) lamps.set(node, node.intensity); });
      draws.push({ scene: current, camera, lamps, visible, viewport: viewport.clone(), scissor: scissor.clone(),
        shadow: { ...renderer.shadowMap } });
    }) };
  const camera = new THREE.PerspectiveCamera(35, 4 / 3, .1, 1000); camera.position.set(12, 12, 16); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const staticGroup = new THREE.Group(), overlayGroup = new THREE.Group(), markerGroup = new THREE.Group(), objectsGroup = new THREE.Group();
  scene.add(staticGroup, overlayGroup, markerGroup, objectsGroup);
  const view = Object.create(FloorplanView.prototype);
  Object.assign(view, { scene, renderer, labelRenderer, staticGroup, overlayGroup, markerGroup, objectsGroup,
    model: { root }, camera, persp: camera, controls: { target: new THREE.Vector3() }, mode: '3d', size: { w: 800, h: 600 }, floors,
    visibleFloor: 'all', _visibleSet: null, cssObjects: [], markerObjects: new Map(), glows: new Map(), stems: new Map(),
    _floorRaw: raw, _floorCompiled: compiled, _floorPresentation: owner, _floorOptions: { enabled: true, floors, targets, backgroundNodes: [background] },
    sectionClip: null, objectLayer: { parts: new Map(), _slots: new Map(), _pose: null }, floorPanelContext: () => ({}) });
  view._floorPanels = new FloorPanelView(view); labelRenderer.setSize(800, 600); scene.updateMatrixWorld(true);
  const f = { scene, root, ground, upper, background, groundMesh, upperMesh, material, floors, targets, raw, owner, compiled, authored,
    view, renderer, viewport, scissor, draws, host }; fixtures.push(f); return f;
}

afterEach(() => { for (const f of fixtures.splice(0)) {
  f.view._floorPanels.clear(); f.owner.dispose();
  f.scene.traverse((node) => { node.geometry?.dispose(); if (node.isLight) node.dispose(); });
  f.material.dispose(); f.host.remove();
} vi.restoreAllMocks(); });

describe('authored model lights in actual floor panels', () => {
  it('suppresses an Upper authored DirectionalLight in Ground instead of bleeding 2.35 intensity into both panes', () => {
    const light = new THREE.DirectionalLight(0x5599ff, 2.35), f = fixture({ populate: ({ upper }) => upper.add(light) });
    const panels = f.view._floorPanels, before = lampSnapshot(light);
    expect(panels.render()).toMatchObject({ entries: expect.any(Array), members: expect.any(Map) });
    expect(f.draws[0].lamps.get(light)).toBe(0); expect(f.draws[1].lamps.get(light)).toBe(2.35);
    expect(lampSnapshot(light)).toEqual(before);
  });

  it.each(constructors)('%s retains exact own-floor intensity and every light setting after both real panes', (name, Type) => {
    const f = fixture(), lower = new Type(0xffcc77, 1.23456789), upper = new Type(0x77aaff, 2.34567891);
    lower.position.set(-1, .5, 2); upper.position.set(2, .75, -1); lower.castShadow = true; upper.castShadow = true;
    lower.shadow.autoUpdate = false; upper.shadow.autoUpdate = false;
    f.ground.add(lower); f.upper.add(upper); const before = [lower, upper].map(lampSnapshot);
    const frame = f.view._floorPanels.render(); expect(frame.entries.map((entry) => entry.floorId)).toEqual(f.floors.map((floor) => floor.id));
    expect(paneDraws(f).map((draw) => [draw.lamps.get(lower), draw.lamps.get(upper)])).toEqual([[1.23456789, 0], [0, 2.34567891]]);
    for (const draw of paneDraws(f)) { expect(draw.visible.get(lower)).toBe(true); expect(draw.visible.get(upper)).toBe(true); }
    expect([lower, upper].map(lampSnapshot)).toEqual(before);
    expect(frame.members.has(lower)).toBe(false); expect(frame.members.has(upper)).toBe(false);
    expect(frame.members.authoredLights.get(lower)).toBe(f.floors[0].id); expect(frame.members.authoredLights.get(upper)).toBe(f.floors[1].id);
  });

  it('authoredLights is a nonenumerable Map of only actual current model lights and keeps every Light out of visibility keys', () => {
    const f = fixture(), lower = new THREE.PointLight(0xffffff, 1), upper = new THREE.SpotLight(0xffffff, 2), unknown = new THREE.DirectionalLight(0xffffff, 3), background = new THREE.PointLight(0xffffff, 4);
    f.ground.add(lower); f.upper.add(upper); f.root.add(unknown); f.background.add(background);
    const outside = new THREE.PointLight(0xffffff, 5), global = globals(f), allocated = pool(f); f.scene.add(outside);
    const before = [lower, upper, unknown, background, outside, ...global, allocated.ground, allocated.upper, allocated.unused].map(lampSnapshot), members = f.view._floorPanels.participants();
    expect(members).toBeInstanceOf(Map); expect([...members.keys()].every((node) => !node.isLight)).toBe(true);
    expect(members.authoredLights).toBeInstanceOf(Map); expect(members.authoredLights.size).toBe(4);
    expect([...members.authoredLights]).toEqual([[lower, f.floors[0].id], [upper, f.floors[1].id], [background, null], [unknown, null]]);
    expect(Object.getOwnPropertyDescriptor(members, 'authoredLights').enumerable).toBe(false); expect(Object.keys(members)).toEqual([]);
    for (const light of [outside, ...global, allocated.ground, allocated.upper, allocated.unused]) expect(members.authoredLights.has(light)).toBe(false);
    expect([lower, upper, unknown, background, outside, ...global, allocated.ground, allocated.upper, allocated.unused].map(lampSnapshot)).toEqual(before);
  });

  it.each(constructors)('a newly imported unknown and explicit-background %s contributes zero in every pane', (name, Type) => {
    const f = fixture(), unknown = new Type(0xffffff, .875), background = new Type(0xffaa44, 2.875);
    f.root.add(unknown); f.background.add(background); const before = [unknown, background].map(lampSnapshot);
    const frame = f.view._floorPanels.render();
    expect(paneDraws(f).map((draw) => [draw.lamps.get(unknown), draw.lamps.get(background)])).toEqual([[0, 0], [0, 0]]);
    expect(frame.members.authoredLights.get(unknown)).toBeNull(); expect(frame.members.authoredLights.get(background)).toBeNull();
    expect([unknown, background].map(lampSnapshot)).toEqual(before);
  });

  it('uses current proven measured-actor ownership for its authored light despite the Upper parent', () => {
    const f = fixture(), actor = measuredActor(f), before = lampSnapshot(actor.lamp), pose = f.view.objectLayer._pose, part = actor.prepared.part;
    const frame = f.view._floorPanels.render();
    expect(frame.members.get(actor.body)).toBe(f.floors[0].id); expect(frame.members.has(actor.lamp)).toBe(false);
    expect(frame.members.authoredLights.get(actor.lamp)).toBe(f.floors[0].id);
    expect(paneDraws(f).map((draw) => draw.lamps.get(actor.lamp))).toEqual([3.125, 0]);
    expect(actor.lamp.parent).toBe(actor.node); expect(actor.node.parent).toBe(f.upper); expect(lampSnapshot(actor.lamp)).toEqual(before);
    expect(f.view.objectLayer._pose).toBe(pose); expect(actor.prepared.part).toBe(part);
  });

  it.each(['pose', 'floor', 'origin', 'type', 'coordinate', 'unknown-destination', 'stale-destination', 'duplicate-actor'])(
    'suppresses a measured authored light when its %s proof is no longer current', (condition) => {
      const f = fixture(), actor = measuredActor(f);
      if (condition === 'pose') f.view.objectLayer._pose = null;
      if (condition === 'floor') f.view.objectLayer._pose.floorId = f.floors[1].id;
      if (condition === 'origin') actor.prepared.part.origin = null;
      if (condition === 'type') actor.prepared.type = {};
      if (condition === 'coordinate') f.view.objectLayer._pose.x = Infinity;
      if (condition === 'unknown-destination') { actor.prepared.part.displayFloorId = 'removed'; f.view.objectLayer._pose.floorId = 'removed'; }
      if (condition === 'stale-destination') f.view._floorOptions.floors = [{ ...f.floors[0], stale: true }, f.floors[1]];
      if (condition === 'duplicate-actor') f.view.objectLayer.parts.set('duplicate', { ...actor.prepared, part: { ...actor.prepared.part } });
      const before = lampSnapshot(actor.lamp), frame = f.view._floorPanels.render();
      expect(frame.members.authoredLights.get(actor.lamp)).toBeNull(); expect(paneDraws(f).map((draw) => draw.lamps.get(actor.lamp))).toEqual([0, 0]);
      expect(lampSnapshot(actor.lamp)).toEqual(before);
    });

  it('a light with conflicting exact background/floor claims stays unresolved in every pane', () => {
    const f = fixture(), light = new THREE.PointLight(0xffffff, 1.875); f.upper.add(light); f.view._floorOptions.backgroundNodes.push(light);
    const frame = f.view._floorPanels.render(); expect(frame.members.authoredLights.get(light)).toBeNull();
    expect(paneDraws(f).map((draw) => draw.lamps.get(light))).toEqual([0, 0]); expect(light.intensity).toBe(1.875);
  });

  it.each(['unknown', 'stale', 'duplicate', 'invalid'])('an authored light never borrows a %s current exact floor resolution', (condition) => {
    const f = fixture(), light = new THREE.DirectionalLight(0xffffff, 2.35); f.ground.add(light);
    if (condition === 'unknown') f.view._floorOptions.floors = [f.floors[1]];
    if (condition === 'stale') f.view._floorOptions.floors = [{ ...f.floors[0], stale: true }, f.floors[1]];
    if (condition === 'duplicate') f.view._floorOptions.floors = [...f.floors, { ...f.floors[0] }];
    if (condition === 'invalid') f.view._floorOptions.floors = [{ ...f.floors[0], elevation: NaN }, f.floors[1]];
    const frame = f.view._floorPanels.render(); expect(frame.members.authoredLights.get(light)).toBeNull();
    expect(paneDraws(f).map((draw) => draw.lamps.get(light))).toEqual([0, 0]); expect(light.intensity).toBe(2.35);
    expect(frame.members.has(light)).toBe(false);
  });

  it('global hemisphere/sun/moon, fixed light pool allocation and material shader ownership remain unchanged', () => {
    const f = fixture(), authored = new THREE.DirectionalLight(0xffbb66, 2.35); f.upper.add(authored);
    const global = globals(f), allocated = pool(f), nodes = [authored, ...global, allocated.ground, allocated.upper, allocated.unused], before = nodes.map(lampSnapshot),
      material = f.material, version = material.version, shaderKey = material.customProgramCacheKey(), children = [...f.view.objectsGroup.children], poolRefs = [...allocated.lights.points, ...allocated.lights.spots];
    const frame = f.view._floorPanels.render();
    for (const draw of paneDraws(f)) {
      expect(global.map((light) => draw.lamps.get(light))).toEqual([.75, 1.65, .125]);
      for (const light of nodes) expect(draw.visible.get(light)).toBe(before[nodes.indexOf(light)].visible);
    }
    expect(paneDraws(f).map((draw) => [draw.lamps.get(allocated.ground), draw.lamps.get(allocated.upper), draw.lamps.get(allocated.unused)])).toEqual([[1.25, 0, 0], [0, 3.75, 0]]);
    expect(nodes.map(lampSnapshot)).toEqual(before); expect(f.view.objectLayer.pool).toBe(allocated.lights); expect(f.view.objectLayer._slots).toBe(allocated.slots);
    expect(f.view.objectLayer.parts).toBe(allocated.parts); expect([...allocated.lights.points, ...allocated.lights.spots]).toEqual(poolRefs);
    expect(f.view.objectsGroup.children).toEqual(children); expect(f.groundMesh.material).toBe(material); expect(f.upperMesh.material).toBe(material);
    expect(material.version).toBe(version); expect(material.customProgramCacheKey()).toBe(shaderKey);
    for (const light of [...global, ...poolRefs]) expect(frame.members.authoredLights.has(light)).toBe(false);
  });

  it('fixed allocated pool refs are excluded from authoredLights even when reparented into the current model root', () => {
    const f = fixture(), allocated = pool(f), freePoint = allocated.unused, slotOnly = new THREE.SpotLight(0xffaa77, .5);
    f.upper.add(allocated.ground); f.ground.add(allocated.upper); f.root.add(freePoint, slotOnly);
    allocated.slots.set('slot-only', { light: slotOnly }); allocated.parts.set('slot-only', { obj: { node: f.groundMesh }, part: {} });
    const original = [allocated.ground, allocated.upper, freePoint, slotOnly].map(lampSnapshot), members = f.view._floorPanels.participants();
    for (const light of [allocated.ground, allocated.upper, freePoint, slotOnly]) { expect(members.has(light)).toBe(false); expect(members.authoredLights.has(light)).toBe(false); }
    f.view._floorPanels.render();
    expect(paneDraws(f).map((draw) => [draw.lamps.get(allocated.ground), draw.lamps.get(allocated.upper), draw.lamps.get(slotOnly)])).toEqual([[1.25, 0, .5], [0, 3.75, 0]]);
    expect([allocated.ground, allocated.upper, freePoint, slotOnly].map(lampSnapshot)).toEqual(original);
  });

  it('known global hemisphere/sun/moon refs remain global even if their parent moves inside the model root', () => {
    const f = fixture(), global = globals(f); f.upper.add(...global); const before = global.map(lampSnapshot);
    const frame = f.view._floorPanels.render();
    for (const light of global) { expect(frame.members.has(light)).toBe(false); expect(frame.members.authoredLights.has(light)).toBe(false); }
    expect(paneDraws(f).map((draw) => global.map((light) => draw.lamps.get(light)))).toEqual([[.75, 1.65, .125], [.75, 1.65, .125]]);
    expect(global.map(lampSnapshot)).toEqual(before);
  });

  it.each([0, 1])('a renderer error in pane %s restores authored/pool intensities, visibility, transforms and shadow requests', (failedPane) => {
    const f = fixture(), light = new THREE.SpotLight(0xffbb88, 2.35), global = globals(f), allocated = pool(f); f.upper.add(light, light.target);
    light.castShadow = true; light.shadow.autoUpdate = false; light.shadow.needsUpdate = true;
    allocated.ground.castShadow = true; allocated.ground.shadow.autoUpdate = false; allocated.ground.shadow.needsUpdate = false;
    f.renderer.shadowMap = { enabled: true, autoUpdate: false, needsUpdate: true }; f.scene.updateMatrixWorld(true);
    const nodes = [light, ...global, allocated.ground, allocated.upper], lamps = nodes.map(lampSnapshot), live = transforms(f.root),
      camera = { position: f.view.camera.position.toArray(), quaternion: f.view.camera.quaternion.toArray(), projection: f.view.camera.projectionMatrix.toArray() },
      viewport = f.viewport.toArray(), scissor = f.scissor.toArray(), original = f.renderer.render.getMockImplementation();
    let pane = 0; f.renderer.render.mockImplementation((...args) => {
      original(...args); if (f.viewport.z === 0) return;
      for (const node of nodes) if (node.shadow) node.shadow.needsUpdate = false;
      if (pane++ === failedPane) throw new Error('real pane draw failed');
    });
    expect(() => f.view._floorPanels.render()).toThrow('real pane draw failed');
    expect(nodes.map(lampSnapshot)).toEqual(lamps); expect(transforms(f.root)).toEqual(live);
    expect({ position: f.view.camera.position.toArray(), quaternion: f.view.camera.quaternion.toArray(), projection: f.view.camera.projectionMatrix.toArray() }).toEqual(camera);
    expect(f.viewport.toArray()).toEqual(viewport); expect(f.scissor.toArray()).toEqual(scissor); expect(f.renderer.getScissorTest()).toBe(false);
    expect(f.renderer.autoClear).toBe(true); expect(f.renderer.shadowMap).toEqual({ enabled: true, autoUpdate: false, needsUpdate: true });
    expect(f.view._floorPanels.labels.panes.size).toBe(0);
  });

  it('a fresh ownership snapshot each render sees late lights and removes obsolete model ownership without per-pane resolver scans', () => {
    const f = fixture(), panels = f.view._floorPanels, light = new THREE.DirectionalLight(0xffffff, 2.35); f.upper.add(light);
    const participants = vi.spyOn(panels, 'participants'), resolve = vi.spyOn(f.view, 'floorForModelNode');
    const first = panels.render(); expect(participants).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls.filter(([node]) => node === light)).toHaveLength(1);
    const unknown = new THREE.PointLight(0xffffff, .85); f.root.add(unknown); f.ground.add(light); f.draws.length = 0;
    const second = panels.render(); expect(participants).toHaveBeenCalledTimes(2); expect(second.members).not.toBe(first.members);
    expect(second.members.authoredLights).not.toBe(first.members.authoredLights);
    expect(first.members.authoredLights.get(light)).toBe(f.floors[1].id); expect(second.members.authoredLights.get(light)).toBe(f.floors[0].id);
    expect(resolve.mock.calls.filter(([node]) => node === light)).toHaveLength(2);
    expect(paneDraws(f).map((draw) => [draw.lamps.get(light), draw.lamps.get(unknown)])).toEqual([[2.35, 0], [0, 0]]);
    f.scene.add(light); const third = panels.participants(); expect(third.authoredLights.has(light)).toBe(false);
    expect(first.members.authoredLights.has(unknown)).toBe(false); expect(second.members.authoredLights.get(unknown)).toBeNull();
  });

  it('disabled pane rendering adds no ownership scans or authored intensity changes', () => {
    const f = fixture(), light = new THREE.DirectionalLight(0xffffff, 2.35), allocated = pool(f); f.upper.add(light);
    const before = [light, allocated.ground, allocated.upper].map(lampSnapshot), live = transforms(f.root), members = vi.spyOn(f.view._floorPanels, 'participants');
    f.view._floorCompiled = { ...f.compiled, panels: false };
    expect(f.view._floorPanels.active).toBe(false); expect(f.view._floorPanels.render()).toBe(false); expect(f.draws).toHaveLength(0);
    expect(members).not.toHaveBeenCalled(); expect([light, allocated.ground, allocated.upper].map(lampSnapshot)).toEqual(before); expect(transforms(f.root)).toEqual(live);
  });
});
