// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TrackedEntitiesLayer } from '../src/tracked-entities.js';
import { FloorPanelView } from '../src/floor-panel-view.js';
import { FloorPresentationLayer } from '../src/floor-presentation-rendering.js';
import { displayLocatedRecords } from '../src/floor-presentation-adapters.js';
import '../src/taylors3d-card.js';

// Only the GPU constructor is a boundary; actual View, Card callbacks, shared
// rendering, current floor ownership and projection methods remain in use.
const viewConstructor = vi.hoisted(() => ({ current: null }));
vi.mock('../src/view.js', async (importOriginal) => ({ ...await importOriginal(), FloorplanView: class {
  constructor() { if (!viewConstructor.current) throw new Error('No real View fixture'); return viewConstructor.current; }
} }));
const { FloorplanView } = await vi.importActual('../src/view.js');

// jsdom has no layout engine. These measured client rectangles include the
// actual native button's CSS margins, just as browser layout does.
const measure = (element, base) => {
  element.getBoundingClientRect = () => {
    const left = base.left + (Number.parseFloat(element.style.marginLeft) || 0);
    const top = base.top + (Number.parseFloat(element.style.marginTop) || 0);
    return { left, top, width: base.width, height: base.height, right: left + base.width, bottom: top + base.height };
  };
  document.body.append(element);
};
const separate = (a, b) => a.right + 4 <= b.left || b.left + b.width + 4 <= a.left
  || a.bottom + 4 <= b.top || b.top + b.height + 4 <= a.top;
const fixtures = [];
function actor(base) {
  const invalidate = vi.fn(), onSelect = vi.fn(), layer = new TrackedEntitiesLayer(new THREE.Scene(), { onInvalidate: invalidate, onSelect });
  const record = { id: 'presence:upstairs', kind: 'presence', entity: 'device_tracker.phone', label: 'Taylor: Upstairs (room observation)',
    shown: true, active: true, location: { x: -.8, y: .5, z: .12, elevation: 4, floorId: 'upper' } };
  layer.setData({ records: [record] });
  const part = layer.parts.get(record.id), button = part.label.element;
  measure(button, base); invalidate.mockClear(); fixtures.push(layer);
  return { layer, part, button, record, invalidate, onSelect };
}
const paneFixtures = [];
function panes({ mode = '3d' } = {}) {
  const scene = new THREE.Scene(), root = new THREE.Group(), groups = [], meshes = [], targets = [];
  const floors = [{ id: 'ground:main', name: 'Ground', elevation: 0 }, { id: 'upper:east', name: 'Upper', elevation: 4 }];
  const material = new THREE.MeshBasicMaterial(); scene.add(root);
  for (const floor of floors) {
    const group = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(8, .1, 6), material);
    group.position.y = floor.elevation; group.add(mesh); root.add(group); groups.push(group); meshes.push(mesh); targets.push({ floor_id: floor.id, node: group });
  }
  root.updateMatrixWorld(true);
  const raw = { mode: 'horizontal', panels: true, gap_m: 2, floors: floors.map((floor) => floor.id) }, owner = new FloorPresentationLayer();
  expect(owner.setData({ raw, floors, modelRoot: root, targets })).toMatchObject({ valid: true });
  const compiled = owner.report(), host = document.createElement('div'), canvas = document.createElement('canvas'), labelRenderer = new CSS2DRenderer();
  host.append(canvas, labelRenderer.domElement); document.body.append(host);
  const box = { left: 37, top: 53, width: 1200, height: 800 }, size = { w: 800, h: 600 };
  canvas.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height });
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(); let scissorTest = false;
  const set = (value, args) => args[0]?.isVector4 ? value.copy(args[0]) : value.set(...args);
  const renderer = { domElement: canvas, autoClear: true, shadowMap: { enabled: false },
    getSize: (target) => target.set(size.w, size.h), getViewport: (target) => target.copy(viewport), getScissor: (target) => target.copy(scissor),
    getScissorTest: () => scissorTest, setViewport: (...args) => set(viewport, args), setScissor: (...args) => set(scissor, args),
    setScissorTest: (value) => { scissorTest = value; }, clear: vi.fn(), clearDepth: vi.fn(),
    render: (current, camera) => { current.updateMatrixWorld(true); camera.updateMatrixWorld(true); } };
  const persp = new THREE.PerspectiveCamera(35, 4 / 3, .1, 1000); persp.position.set(12, 12, 16); persp.lookAt(0, 0, 0);
  const ortho = new THREE.OrthographicCamera(-12, 12, 9, -9, .1, 1000); ortho.position.set(0, 30, 0); ortho.up.set(0, 0, -1); ortho.lookAt(0, 0, 0);
  const camera = mode === 'top' ? ortho : persp, view = Object.create(FloorplanView.prototype);
  const markerGroup = new THREE.Group(), objectsGroup = new THREE.Group(), staticGroup = new THREE.Group(), overlayGroup = new THREE.Group();
  scene.add(markerGroup, objectsGroup, staticGroup, overlayGroup);
  Object.assign(view, { scene, renderer, labelRenderer, markerGroup, objectsGroup, staticGroup, overlayGroup, floors, camera, persp, ortho,
    controls: { target: new THREE.Vector3() }, mode, size, visibleFloor: 'all', _visibleSet: null,
    cssObjects: [], markerObjects: new Map(), glows: new Map(), stems: new Map(), model: { root, manifest: { levels: [], objects: [] } },
    _floorRaw: raw, _floorCompiled: compiled, _floorPresentation: owner, _floorOptions: { enabled: true, floors, targets },
    sectionClip: null, _orthoHalf: 9, floorPanelContext: () => ({}) });
  view._floorPanels = new FloorPanelView(view); labelRenderer.setSize(size.w, size.h);
  const card = Object.create(customElements.get('taylors3d-card').prototype), shadow = document.createElement('div'); host.append(shadow);
  Object.defineProperties(card, { isConnected: { value: true }, shadowRoot: { value: shadow } });
  Object.assign(card, { _view: null, _mode: mode, _miniMap: { updateCamera: vi.fn() }, _editing: false, _loading: false, _groups: {},
    _config: { height: '600px', control_panel: 'popup' }, _hass: { states: {}, callService: vi.fn() },
    _roomList: [], _layout: { rooms: [], pins: {} }, _floors: floors,
    _suspendAmbient: vi.fn(), _stopScenePreview: vi.fn(), finishWallSelectionPreparation: vi.fn(), _unwatchAmbientPreference: vi.fn(),
    _unbindAmbientInput: vi.fn(), _watchAmbientPreference: vi.fn(), _syncModelRendering: vi.fn(), _ensureWeatherLayer: vi.fn(),
    _configureMiniMap: vi.fn(), _houseLayoutEnabled: () => false });
  viewConstructor.current = view;
  const stop = vi.spyOn(view, 'setOcclusion').mockImplementationOnce(() => { throw new Error('callbacks installed'); });
  try { expect(() => card._render()).toThrow('callbacks installed'); } finally { stop.mockRestore(); viewConstructor.current = null; }
  card._scene.getBoundingClientRect = canvas.getBoundingClientRect; card._stage.getBoundingClientRect = canvas.getBoundingClientRect;
  const world = (floorId, x = -.8, y = .5, z = .12) => {
    const floor = floors.find((f) => f.id === floorId), result = view.sourceWorldToDisplay([x, floor.elevation + z, -y], floorId);
    expect(result.ok).toBe(true); return new THREE.Vector3(...result.point);
  };
  const addActor = (floorId) => {
    const floor = floors.find((f) => f.id === floorId), record = { id: `presence:${floorId}`, kind: 'presence', entity: `person.${floorId}`,
      label: `${floor.name}: Room observation`, shown: true, active: true, location: { x: -.8, y: .5, z: .12, elevation: floor.elevation, floorId } };
    const records = [...(card._trackingData?.records || []), record]; card._trackingData = { records };
    card._trackingLayer.setData({ records: displayLocatedRecords(records, compiled, floors), now: 1234 });
    const element = card._trackingLayer.parts.get(record.id).label.element, projected = view._floorPanels.projectWorld(world(floorId), floorId);
    const base = { left: projected[0] - 90, top: projected[1] - 22, width: 180, height: 44 }; measure(element, base);
    return { record, element, base, part: card._trackingLayer.parts.get(record.id) };
  };
  const addMarker = (floorId, extra = {}) => {
    const descriptor = { id: `entity:${floorId}`, entityId: 'light.floors_lamp', domain: 'light', name: 'Actual floor lamp' };
    const element = card._markerElement(descriptor), obj = new CSS2DObject(element); obj.position.copy(world(floorId)); markerGroup.add(obj);
    view.cssObjects.push({ obj, floorId, kind: 'marker', id: descriptor.id }); view.markerObjects.set(descriptor.id, { obj, floorId });
    const projected = view._floorPanels.projectWorld(world(floorId), floorId), base = { left: projected[0] - 22, top: projected[1] - 22, width: 44, height: 44, ...extra };
    measure(element, base); return { obj, element, base };
  };
  const bind = (floorId) => {
    const index = floors.findIndex((floor) => floor.id === floorId), object = { id: `bound:${floorId}`, type: 'generic', node: meshes[index], anchor: [-.8, .12, -.5] };
    view.model.manifest.objects.push(object); card._objects.setModel(view.model); card._objects.setBindings(new Map([[object.id, { entity: 'light.floors_lamp' }]]), {});
    return object;
  };
  const f = { card, view, floors, root, groups, meshes, owner, host, box, size, world, addActor, addMarker, bind, raw, compiled, material };
  paneFixtures.push(f); return f;
}
afterEach(() => {
  for (const layer of fixtures.splice(0)) layer.dispose();
  for (const f of paneFixtures.splice(0)) {
    f.card._popup.close(); f.card._devicePopup.dispose(); f.card._trackingLayer.dispose(); f.card._statusOverlays.dispose(); f.card._cameraCoverage.dispose();
    f.card._objects.dispose(); f.view._floorPanels.clear(); f.owner.dispose(); f.root.traverse((node) => node.geometry?.dispose()); f.material.dispose(); f.host.remove();
  }
  viewConstructor.current = null; vi.restoreAllMocks();
});

describe('tracked native controls avoid the current pane device controls', () => {
  it('keeps the real Upper lamp dot and value control exposed instead of covering every native hit point', () => {
    const f = actor({ left: 850, top: 350, width: 180, height: 44 });
    const lamp = { left: 893, top: 344, width: 44, height: 42 };
    const source = JSON.stringify(f.record), position = f.part.group.position.toArray(); f.button.focus();
    f.layer.arrangeScreenLabels({ left: 650, top: 130, width: 550, height: 600 }, [lamp]);
    expect(separate(f.button.getBoundingClientRect(), lamp)).toBe(true);
    for (const [x, y] of [[914, 365], [905, 356], [923, 356], [905, 374], [923, 374]]) {
      const rect = f.button.getBoundingClientRect(); expect(x < rect.left || x > rect.right || y < rect.top || y > rect.bottom).toBe(true);
    }
    expect(f.part.group.position.toArray()).toEqual(position); expect(JSON.stringify(f.record)).toBe(source);
    expect(document.activeElement).toBe(f.button); expect(f.button.style.minHeight).toBe('44px');
    expect(f.button.title).toBe(f.record.label); expect(f.button.getAttribute('aria-label')).toContain(f.record.label);
    expect(f.invalidate).not.toHaveBeenCalled(); f.button.click(); expect(f.onSelect).toHaveBeenCalledExactlyOnceWith(f.record.id);
  });

  it('uses a horizontal escape when a narrow-height pane cannot fit a vertical label move', () => {
    const f = actor({ left: 120, top: 80, width: 100, height: 44 }), lamp = { left: 150, top: 80, width: 44, height: 44 };
    f.layer.arrangeScreenLabels({ left: 0, top: 80, width: 400, height: 44 }, [lamp]);
    expect(separate(f.button.getBoundingClientRect(), lamp)).toBe(true);
    expect(f.button.style.marginTop).toBe('0px'); expect(f.layer.screenLabelOverlaps).toEqual([]);
  });

  it('keeps honest overlap evidence when the actor and a fixed control cannot fit together', () => {
    const f = actor({ left: 0, top: 0, width: 100, height: 44 }), lamp = { left: 0, top: 0, width: 100, height: 44 };
    const before = f.part.group.position.toArray();
    f.layer.arrangeScreenLabels({ left: 0, top: 0, width: 100, height: 44 }, [lamp]);
    expect(f.layer.screenLabelOverlaps).toEqual([f.record.id]); expect(f.part.group.position.toArray()).toEqual(before);
    expect(f.button.hidden).toBe(false); expect(f.button.style.pointerEvents).toBe('auto'); expect(f.button.style.minHeight).toBe('44px');
    expect(f.layer.arrangeScreenLabels({ left: 0, top: 0, width: 100, height: 44 }, [lamp])).toBe(false); expect(f.invalidate).not.toHaveBeenCalled();
  });

  it('ignores malformed and wholly outside control rectangles without changing the default placement', () => {
    const f = actor({ left: 20, top: 80, width: 100, height: 44 });
    f.layer.arrangeScreenLabels({ left: 0, top: 0, width: 400, height: 300 }, [null, { left: NaN, top: 80, width: 20, height: 44 },
      { left: 20, top: 80, width: 0, height: 44 }, { left: 500, top: 80, width: 100, height: 44 }]);
    expect(f.button.style.marginLeft).toBe('0px'); expect(f.button.style.marginTop).toBe('0px'); expect(f.layer.screenLabelOverlaps).toEqual([]);
  });
});

describe('actual Card arranges tracking controls with one current pane frame', () => {
  it.each(['3d', 'top'])('uses actual %s marker controls and exact floor ownership without another scene ownership scan', (mode) => {
    const f = panes({ mode }), lower = f.addActor('ground:main'), upper = f.addActor('upper:east'), marker = f.addMarker('upper:east');
    const source = JSON.stringify(f.card._trackingData), poses = [lower, upper].map((actor) => actor.part.group.position.toArray());
    const panels = f.view._floorPanels, participants = vi.spyOn(panels, 'participants'), floor = vi.spyOn(panels, 'floorForNode');
    const arrange = vi.spyOn(f.card._trackingLayer, 'arrangeScreenLabels'), controls = vi.spyOn(f.card, '_trackingControlObstacles');
    const frame = panels.render(); f.view.dirty = false; f.view.onRender(frame);
    expect(participants).toHaveBeenCalledTimes(1); expect(controls).toHaveBeenCalledExactlyOnceWith(frame.entries, frame.members);
    expect(floor).toHaveBeenCalledExactlyOnceWith(marker.obj, frame.members);
    expect(arrange.mock.calls[0][1]).toEqual([]); expect(arrange.mock.calls[1][1]).toEqual([marker.base]);
    expect(separate(upper.element.getBoundingClientRect(), marker.element.getBoundingClientRect())).toBe(true);
    expect(lower.element.style.marginLeft).toBe('0px'); expect(lower.element.style.marginTop).toBe('0px');
    expect(JSON.stringify(f.card._trackingData)).toBe(source); expect([lower, upper].map((actor) => actor.part.group.position.toArray())).toEqual(poses);
    expect(f.view.dirty).toBe(false); expect(f.card._hass.callService).not.toHaveBeenCalled();
    const css = upper.element.style.cssText; participants.mockClear(); f.view.onRender(frame);
    expect(upper.element.style.cssText).toBe(css); expect(participants).not.toHaveBeenCalled(); expect(f.view.dirty).toBe(false);
  });

  it.each(['hidden', 'display', 'visibility', 'pointer', 'occluded', 'parent', 'detached', 'unknown', 'case', 'non-marker'])(
    'does not reserve a %s ordinary marker control', (reason) => {
      const f = panes(), upper = f.addActor('upper:east'), marker = f.addMarker('upper:east');
      if (reason === 'hidden') marker.element.hidden = true;
      if (reason === 'display') marker.element.style.display = 'none';
      if (reason === 'visibility') marker.element.style.visibility = 'hidden';
      if (reason === 'pointer') marker.element.style.pointerEvents = 'none';
      if (reason === 'occluded') marker.element.classList.add('fp-occluded');
      if (reason === 'parent') f.view.markerGroup.visible = false;
      if (reason === 'detached') marker.element.remove();
      if (reason === 'unknown' || reason === 'case') {
        const floorId = reason === 'unknown' ? 'gone:floor' : 'Upper:east';
        f.view.cssObjects[0].floorId = floorId; f.view.markerObjects.get('entity:upper:east').floorId = floorId;
      }
      if (reason === 'non-marker') f.view.cssObjects[0].kind = 'handle';
      const panels = f.view._floorPanels, entries = panels.entries(), members = panels.participants(), participants = vi.spyOn(panels, 'participants');
      const controls = f.card._trackingControlObstacles(entries, members);
      expect([...controls.values()].flat()).toEqual([]); expect(participants).not.toHaveBeenCalled();
      f.view.onRender({ entries, members }); expect(upper.element.style.marginTop).toBe('0px'); expect(upper.element.style.marginLeft).toBe('0px');
    });

  it('keeps another exact floor control out of the Upper collision calculation even at the same client rectangle', () => {
    const f = panes(), upper = f.addActor('upper:east'), marker = f.addMarker('ground:main', { ...upper.base });
    const frame = f.view._floorPanels.render(), controls = f.card._trackingControlObstacles(frame.entries, frame.members);
    expect(controls.get('ground:main')).toEqual([marker.base]); expect(controls.get('upper:east')).toEqual([]);
    f.view.onRender(frame); expect(upper.element.style.marginLeft).toBe('0px'); expect(upper.element.style.marginTop).toBe('0px');
  });

  it.each(['3d', 'top'])('projects the actual %s bound object once using its displayed anchor and current exact pane camera', (mode) => {
    const f = panes({ mode }), upper = f.addActor('upper:east'), object = f.bind('upper:east');
    const before = f.groups.map((group) => group.position.toArray()), source = JSON.stringify(f.raw), panels = f.view._floorPanels;
    const frame = panels.render(), anchor = f.card._objects.displayAnchorOf(object.id), expected = panels.projectWorld(anchor, 'upper:east');
    const participants = vi.spyOn(panels, 'participants'), anchors = vi.spyOn(f.card._objects, 'displayAnchors'), floor = vi.spyOn(panels, 'floorForNode');
    const controls = f.card._trackingControlObstacles(frame.entries, frame.members), rect = controls.get('upper:east')[0];
    expect(rect.left + rect.width / 2).toBeCloseTo(expected[0], 8); expect(rect.top + rect.height / 2).toBeCloseTo(expected[1], 8);
    expect(rect.width).toBe(104); expect(rect.height).toBe(104); expect(controls.get('ground:main')).toEqual([]);
    expect(participants).not.toHaveBeenCalled(); expect(anchors).toHaveBeenCalledTimes(1); expect(floor).toHaveBeenCalledExactlyOnceWith(object.node, frame.members);
    f.view.onRender(frame); expect(separate(upper.element.getBoundingClientRect(), rect)).toBe(true);
    expect(anchors).toHaveBeenCalledTimes(2); expect(participants).not.toHaveBeenCalled();
    expect(f.groups.map((group) => group.position.toArray())).toEqual(before); expect(JSON.stringify(f.raw)).toBe(source); expect(f.card._hass.callService).not.toHaveBeenCalled();
  });

  it.each(['hidden-binding', 'hidden-node', 'unbound', 'outside-pane', 'unknown'])('does not reserve a %s bound object', (reason) => {
    const f = panes(), object = f.bind('upper:east'); f.addActor('upper:east');
    if (reason === 'hidden-binding') f.card._objects.bindings.get(object.id).hidden = true;
    if (reason === 'hidden-node') object.node.visible = false;
    if (reason === 'unbound') f.card._objects.bindings.clear();
    if (reason === 'outside-pane') object.anchor[0] = 1e6;
    if (reason === 'outside-pane') f.card._objects.parts.get(object.id).part.anchor.x = 1e6;
    const panels = f.view._floorPanels, entries = panels.entries(), members = panels.participants();
    if (reason === 'unknown') members.set(object.node, null);
    expect([...f.card._trackingControlObstacles(entries, members).values()].flat()).toEqual([]);
  });

  it('remeasures actual marker controls after a responsive pane and popup width change', () => {
    const f = panes(), upper = f.addActor('upper:east'), marker = f.addMarker('upper:east'), panels = f.view._floorPanels;
    f.view.onRender(panels.render()); expect(separate(upper.element.getBoundingClientRect(), marker.element.getBoundingClientRect())).toBe(true);
    f.size.w = 390; f.size.h = 700; f.box.width = 390; f.box.height = 700;
    const projected = panels.projectWorld(f.world('upper:east'), 'upper:east');
    Object.assign(marker.base, { left: projected[0] - 22, top: projected[1] - 22 });
    Object.assign(upper.base, { left: projected[0] - 90, top: projected[1] - 22 });
    const frame = panels.render(), participants = vi.spyOn(panels, 'participants');
    f.view.onRender(frame); expect(separate(upper.element.getBoundingClientRect(), marker.element.getBoundingClientRect())).toBe(true);
    const rect = upper.element.getBoundingClientRect(), pane = frame.entries[1].rect;
    expect(rect.left).toBeGreaterThanOrEqual(f.box.left); expect(rect.right).toBeLessThanOrEqual(f.box.left + pane.width);
    expect(rect.top).toBeGreaterThanOrEqual(f.box.top + pane.y + 52); expect(rect.bottom).toBeLessThanOrEqual(f.box.top + pane.y + pane.height);
    const css = upper.element.style.cssText; f.view.onRender(frame); expect(upper.element.style.cssText).toBe(css); expect(participants).not.toHaveBeenCalled();
  });

  it('preserves the exact one-argument default layout call and makes no ownership or obstacle scans when panels are off', () => {
    const f = panes(); f.addActor('upper:east'); f.addMarker('upper:east'); f.view._floorCompiled = { ...f.compiled, panels: false };
    const participants = vi.spyOn(f.view._floorPanels, 'participants'), floor = vi.spyOn(f.view._floorPanels, 'floorForNode');
    const controls = vi.spyOn(f.card, '_trackingControlObstacles'), arrange = vi.spyOn(f.card._trackingLayer, 'arrangeScreenLabels');
    f.view.onRender(); expect(arrange).toHaveBeenCalledExactlyOnceWith(f.card._scene.getBoundingClientRect());
    expect(controls).not.toHaveBeenCalled(); expect(participants).not.toHaveBeenCalled(); expect(floor).not.toHaveBeenCalled();
  });

  it('skips control and ownership scans entirely when the current pane frame has no tracked actors', () => {
    const f = panes(); f.addMarker('upper:east'); const frame = f.view._floorPanels.render();
    const participants = vi.spyOn(f.view._floorPanels, 'participants'), controls = vi.spyOn(f.card, '_trackingControlObstacles');
    f.view.onRender(frame); expect(controls).not.toHaveBeenCalled(); expect(participants).not.toHaveBeenCalled();
  });
});
