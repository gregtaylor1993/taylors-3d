// @vitest-environment jsdom
// Real cameras, raycasts, level ownership and CSS labels run here. The existing
// WebGL renderer alone is a boundary: no GPU context is needed for these checks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { FloorPanelView } from '../src/floor-panel-view.js';
import { FloorPresentationLayer } from '../src/floor-presentation-rendering.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import { TrackedEntitiesLayer } from '../src/tracked-entities.js';
import { buildPlanSecurity, PlanSecurityLayer } from '../src/security-plan.js';
import { displayLocatedRecords } from '../src/floor-presentation-adapters.js';
import { ObjectPopup } from '../src/objects/popup.js';
import '../src/taylors3d-card.js';

// Card._render constructs a GPU renderer. Only that constructor is replaced;
// every fixture method still comes from the original FloorplanView prototype.
const viewConstructor = vi.hoisted(() => ({ current: null }));
vi.mock('../src/view.js', async (importOriginal) => ({ ...await importOriginal(), FloorplanView: class {
  constructor() { if (!viewConstructor.current) throw new Error('No real View fixture provided'); return viewConstructor.current; }
} }));
const { FloorplanView } = await vi.importActual('../src/view.js');

const fixtures = [];
const snapshotCamera = (camera) => ({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
  zoom: camera.zoom, aspect: camera.aspect, left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom,
  projection: camera.projectionMatrix.toArray(), inverse: camera.projectionMatrixInverse.toArray(), view: structuredClone(camera.view) });
const topology = (root) => { const rows = []; root.traverse((node) => rows.push([node.name, node === root ? null : node.parent?.name ?? null,
  node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), node.matrix.toArray(), node.visible])); return rows; };
const freeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) {
  Object.freeze(value); for (const child of Object.values(value)) freeze(child);
} return value; };

function fixture({ mode = '3d', size = { w: 800, h: 600 }, floorCount = 2, floorIds = [] } = {}) {
  const scene = new THREE.Scene(), root = new THREE.Group(), modelGroup = new THREE.Group();
  root.name = 'source-house'; modelGroup.name = 'placed-house'; modelGroup.add(root); scene.add(modelGroup);
  const material = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide });
  const names = [['ground', 'Ground floor'], ['upper', 'Upper floor'], ['second', 'Second floor'], ['loft', 'Loft']];
  const floors = freeze(names.slice(0, floorCount).map(([id, name], index) => ({ id: floorIds[index] ?? id, name, elevation: index * 4, height: 3 })));
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
  f.card?._trackingLayer?.dispose(); f.card?._planSecurityLayer?.dispose();
  f.miniMap?.dispose(); f.view._cancelOcclusion(); f.view._floorPanels.clear(); f.view._clearGroup(f.view.staticGroup);
  f.owner.dispose(); f.root.traverse((node) => { if (node.isMesh) node.geometry.dispose(); });
  for (const light of [f.view.sun, f.view.hemi, f.view.moonLight]) light?.dispose(); f.host.remove();
} viewConstructor.current = null; vi.restoreAllMocks(); vi.useRealTimers(); });

// HA and popup controls are boundaries. Floor selection, source/display
// ownership, projections and native actor/marker gestures use the real classes.
function cardFor(f) {
  const card = Object.create(customElements.get('taylors3d-card').prototype);
  Object.defineProperty(card, 'isConnected', { value: true, configurable: true });
  Object.assign(card, { _view: f.view, _floors: f.floors, _roomList: [], _layout: freeze({ rooms: [], pins: {} }),
    _config: { group_by: 'device', device_tap_action: 'popup', room_labels: 'name' }, _floorPresentationReportValue: f.compiled,
    _hass: { states: {}, entities: {}, devices: {}, areas: {}, floors: {}, user: { id: 'test-user', is_active: true },
      connection: { connected: true }, callService: vi.fn() }, _groups: {}, _editing: false, _loading: false,
    _stopScenePreview: vi.fn(), _popup: { close: vi.fn(), open: vi.fn() },
    _devicePopup: { update: vi.fn(), showMarker: vi.fn(), close: vi.fn() }, _syncMiniMap: vi.fn(), _syncSecurity: vi.fn(),
    _stage: f.host, _markers: [], _positions: new Map(), _trackingData: { records: [] },
    _securityPlanData: { records: [] }, _securitySessionGeneration: 7 });
  f.card = card; f.view._floorPanels.entries(); f.view.onFloorPanelSelect = vi.fn();
  return card;
}

function addState(card, entityId, state = 'on') {
  card._hass.states[entityId] = { entity_id: entityId, state, attributes: { friendly_name: entityId, brightness: 180 } };
}

function assertUnchanged(f, card, before) {
  expect(snapshotCamera(f.view.camera)).toEqual(before.camera);
  expect(f.view.controls.target.toArray()).toEqual(before.target);
  expect(topology(f.root)).toEqual(before.topology);
  expect(JSON.stringify(card._layout)).toBe(before.layout);
  expect(JSON.stringify(f.raw)).toBe(before.raw);
  expect(JSON.stringify(f.floors)).toBe(before.floors);
  expect(JSON.stringify([...card._positions])).toBe(before.positions);
  expect(JSON.stringify(card._markers)).toBe(before.markers);
  expect(JSON.stringify(card._trackingData.records)).toBe(before.tracking);
  expect(JSON.stringify(card._securityPlanData.records)).toBe(before.security);
  expect(f.view._visibleSet).toBe(before.visibleSet); expect(f.view.visibleFloor).toBe(before.visibleFloor);
  expect(card._hass.callService).not.toHaveBeenCalled();
}

function beforeAction(f, card) {
  return { camera: snapshotCamera(f.view.camera), target: f.view.controls.target.toArray(), topology: topology(f.root),
    layout: JSON.stringify(card._layout), raw: JSON.stringify(f.raw), floors: JSON.stringify(f.floors),
    visibleSet: f.view._visibleSet, visibleFloor: f.view.visibleFloor, positions: JSON.stringify([...card._positions]),
    markers: JSON.stringify(card._markers), tracking: JSON.stringify(card._trackingData.records), security: JSON.stringify(card._securityPlanData.records) };
}

function expectOpenOn(f, card, floorId, open = 'device') {
  const popup = open === 'device' ? card._devicePopup.showMarker : card._popup.open;
  const implementation = popup.getMockImplementation();
  popup.mockImplementation((...args) => {
    expect(f.view._floorPanels.activeFloorId).toBe(floorId);
    expect(f.view.onFloorPanelSelect).toHaveBeenCalledExactlyOnceWith(floorId);
    return implementation?.(...args);
  });
  return popup;
}

function tracked(card, f, floorId = 'upper') {
  const record = { id: 'presence:upstairs', entity: 'device_tracker.phone', identity: 'person.taylor', kind: 'presence',
    active: true, shown: true, label: 'Taylor upstairs', location: { x: 1, y: 1, z: .2, floorId, elevation: 4 } };
  addState(card, record.entity, 'home'); addState(card, record.identity, 'home');
  card._trackingData = { records: [record] };
  card._trackingLayer?.dispose(); card._trackingLayer = new TrackedEntitiesLayer(f.view.scene, { onSelect: (id) => card._showTrackedEntity(id) });
  card._trackingLayer.setData({ records: displayLocatedRecords([record], f.compiled, f.floors), now: 1234 });
  f.context.trackingLayer = card._trackingLayer;
  return record;
}

function security(card, f, floorId = 'upper') {
  const entity = 'binary_sensor.upstairs_door'; addState(card, entity);
  card._hass.states[entity].attributes.device_class = 'door';
  card._securityPlanData = buildPlanSecurity({ hass: card._hass, floors: f.floors, rooms: [], now: Date.parse('2026-10-05T12:00:00Z'),
    bindings: [{ id: 'upper-door', entity, kind: 'door', open_states: ['on'], closed_states: ['off'],
      target: { type: 'plan', position: { x: 1, y: 1, z: .2, floorId } } }] });
  const record = card._securityPlanData.records[0]; expect(record.shown).toBe(true);
  card._planSecurityLayer = new PlanSecurityLayer(f.view.scene, { onSelect: (id) => card._showPlanSecurityEntity(id) });
  card._planSecurityLayer.setData({ records: displayLocatedRecords([record], f.compiled, f.floors), contextKey: 'same-session' });
  f.context.planSecurityLayer = card._planSecurityLayer;
  return record;
}

function marker(card, floorId = 'upper') {
  const record = { id: 'device:upper-lamp', entityId: 'light.upper_lamp', name: 'Upstairs lamp', domain: 'light' };
  addState(card, record.entityId); card._markers = [record];
  card._positions.set(record.id, { x: 1, y: 1, z: .2, floorId });
  return record;
}

function boundObject(card, f, floorId = 'upper') {
  const record = { obj: { id: 'bound-upper', label: 'Bound upstairs lamp', type: 'light', node: f.meshes[1], ui: { hold: 'popup' } },
    binding: freeze({ entity: 'light.upper_lamp', floor_id: floorId }), chain: { entities: ['light.upper_lamp'] } };
  addState(card, record.binding.entity);
  card._objects = { objectAt: (id) => id === record.obj.id ? record : null,
    displayAnchors: () => [{ id: record.obj.id, world: f.point(floorId, 1, 1, .2) }] };
  return record;
}

function installActualRenderCallbacks(card, f) {
  const root = document.createElement('div'); f.host.append(root); Object.defineProperty(card, 'shadowRoot', { value: root });
  Object.assign(card, { _view: null, _mode: f.view.mode, _miniMap: { updateCamera: vi.fn() },
    _config: { ...card._config, height: '600px', control_panel: 'popup' },
    finishWallSelectionPreparation: vi.fn(), _unwatchAmbientPreference: vi.fn(), _unbindAmbientInput: vi.fn(),
    _watchAmbientPreference: vi.fn(), _syncModelRendering: vi.fn(), _ensureWeatherLayer: vi.fn(),
    _suspendAmbient: vi.fn(), _configureMiniMap: vi.fn(), _houseLayoutEnabled: () => false });
  viewConstructor.current = f.view;
  const stop = vi.spyOn(f.view, 'setOcclusion').mockImplementationOnce(() => { throw new Error('callbacks installed'); });
  try { expect(() => card._render()).toThrow('callbacks installed'); } finally { stop.mockRestore(); viewConstructor.current = null; }
  f.renderedCard = card;
  card._scene.getBoundingClientRect = () => ({ ...f.box, right: f.box.left + f.box.width, bottom: f.box.top + f.box.height });
  card._stage.getBoundingClientRect = card._scene.getBoundingClientRect;
  expect(card._view).toBe(f.view); expect(card._view._screenRay).toBe(FloorplanView.prototype._screenRay);
  return card._view.onRender;
}

describe('real Card selects exact floors before opening controls', () => {
  it.each(['3d', 'top'])('tracked actor native label selects its actual %s floor before showing identity controls', (mode) => {
    const f = fixture({ mode }), card = cardFor(f), record = tracked(card, f), before = beforeAction(f, card);
    freeze(record); const source = JSON.stringify(record), opened = expectOpenOn(f, card, 'upper');
    const label = card._trackingLayer.parts.get(record.id).label.element;
    label.click();
    expect(opened).toHaveBeenCalledExactlyOnceWith({ id: record.id, entityId: record.identity, name: record.label,
      entities: [{ eid: record.identity }, { eid: record.entity }] }, f.view.screenPoint(1, 1, .2, 'upper'));
    expect(JSON.stringify(record)).toBe(source); assertUnchanged(f, card, before);
  });

  it.each(['3d', 'top'])('plan-security native label selects its current exact %s floor before controls', (mode) => {
    const f = fixture({ mode }), card = cardFor(f), record = security(card, f), before = beforeAction(f, card);
    freeze(record); const source = JSON.stringify(record), opened = expectOpenOn(f, card, 'upper');
    card._planSecurityLayer.parts.get(record.id).body.click();
    expect(opened).toHaveBeenCalledExactlyOnceWith({ id: `security:${record.id}`, entityId: record.entity, name: record.name,
      entities: [{ eid: record.entity }] }, f.view.screenPoint(1, 1, .2, 'upper'));
    expect(card._securityPopup).toEqual({ id: record.id, entity: record.entity, generation: 7 });
    expect(JSON.stringify(record)).toBe(source); assertUnchanged(f, card, before);
  });

  it.each(['tap', 'Enter', ' '])('ordinary marker %s selects its exact current placement before controls', (gesture) => {
    const f = fixture(), card = cardFor(f), record = marker(card), before = beforeAction(f, card);
    freeze(record); const opened = expectOpenOn(f, card, 'upper');
    if (gesture === 'tap') card._tap(record);
    else card._markerElement(record).dispatchEvent(new KeyboardEvent('keydown', { key: gesture, bubbles: true, cancelable: true }));
    expect(opened).toHaveBeenCalledExactlyOnceWith(record, f.view.screenPoint(1, 1, .2, 'upper'));
    assertUnchanged(f, card, before);
  });

  it.each(['tap', 'hold'])('bound object %s uses current exact node ownership before opening controls', (which) => {
    const f = fixture(), card = cardFor(f), record = boundObject(card, f), before = beforeAction(f, card);
    const opened = expectOpenOn(f, card, 'upper', which === 'tap' ? 'device' : 'object');
    const participants = vi.spyOn(f.view._floorPanels, 'participants');
    card._runObjectAction(record.obj.id, which);
    expect(opened).toHaveBeenCalledTimes(1); expect(participants).toHaveBeenCalledTimes(1);
    if (which === 'tap') expect(opened.mock.lastCall).toEqual([{ name: record.obj.label, entityId: record.binding.entity,
      entities: [{ eid: record.binding.entity }] }, f.view.projectWorld(f.point('upper', 1, 1, .2), 'upper')]);
    else expect(opened.mock.lastCall).toEqual([record.obj, f.point('upper', 1, 1, .2)]);
    assertUnchanged(f, card, before);
  });

  it('uses the current marker placement after a retained keyboard label outlives a registry rename', () => {
    const f = fixture(), card = cardFor(f), old = marker(card), label = card._markerElement(old);
    const current = { ...old, name: 'Current registry name' }; card._markers = [current];
    const opened = expectOpenOn(f, card, 'upper');
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(opened.mock.lastCall[0]).toBe(current); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('uses current resolved model ownership instead of an obsolete bound floor stamp', () => {
    const f = fixture(), card = cardFor(f), record = boundObject(card, f);
    record.binding = freeze({ entity: record.binding.entity, floor_id: 'ground' });
    expectOpenOn(f, card, 'upper'); card._runObjectAction(record.obj.id, 'tap');
    expect(card._devicePopup.showMarker).toHaveBeenCalledTimes(1); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'unavailable'])('an existing %s marker retains its actual entity controls', (state) => {
    const f = fixture(), card = cardFor(f), record = marker(card); card._hass.states[record.entityId].state = state;
    const opened = expectOpenOn(f, card, 'upper'), before = beforeAction(f, card); card._tap(record);
    expect(opened).toHaveBeenCalledTimes(1); expect(opened.mock.lastCall[0].entityId).toBe(record.entityId);
    assertUnchanged(f, card, before);
  });

  it.each(['missing', 'unknown', 'unavailable'])('bound object retains its existing %s source popup on the current floor', (state) => {
    const f = fixture(), card = cardFor(f), record = boundObject(card, f);
    if (state === 'missing') delete card._hass.states[record.binding.entity]; else card._hass.states[record.binding.entity].state = state;
    const opened = expectOpenOn(f, card, 'upper', 'object'), before = beforeAction(f, card);
    card._runObjectAction(record.obj.id, 'hold'); expect(opened).toHaveBeenCalledTimes(1); assertUnchanged(f, card, before);
  });

  it.each(['tracked', 'security', 'marker', 'bound-tap', 'bound-hold'])('selects the complete legal colon floor ID for %s', (kind) => {
    const floorId = 'upper:bedroom', f = fixture({ floorIds: ['ground:main', floorId] }), card = cardFor(f);
    const record = kind === 'tracked' ? tracked(card, f, floorId) : kind === 'security' ? security(card, f, floorId)
      : kind === 'marker' ? marker(card, floorId) : boundObject(card, f, floorId);
    const opened = expectOpenOn(f, card, floorId, kind === 'bound-hold' ? 'object' : 'device'), before = beforeAction(f, card);
    if (kind === 'tracked') card._showTrackedEntity(record.id);
    else if (kind === 'security') card._showPlanSecurityEntity(record.id);
    else if (kind === 'marker') card._tap(record);
    else card._runObjectAction(record.obj.id, kind === 'bound-tap' ? 'tap' : 'hold');
    expect(opened).toHaveBeenCalledTimes(1); assertUnchanged(f, card, before);
  });

  it.each([undefined, null, '', 'upper', 'Upper:bedroom', ' upper:bedroom', 'upper:bedroom '])('never aliases absent or altered exact floor ID %s', (floorId) => {
    const f = fixture({ floorIds: ['ground:main', 'upper:bedroom'] }), card = cardFor(f), before = beforeAction(f, card);
    expect(card._selectControlFloor(floorId)).toBe(false); expect(f.view._floorPanels.activeFloorId).toBe('ground:main');
    expect(f.view.onFloorPanelSelect).not.toHaveBeenCalled(); assertUnchanged(f, card, before);
  });
});

describe('actual header selection callback closes previous controls first', () => {
  function openPreviousControls(card, f) {
    const old = { id: 'previous', type: 'light', node: f.meshes[0], label: 'Previous floor controls' },
      next = { id: 'next', type: 'light', node: f.meshes[1], label: 'Next floor controls', ui: { hold: 'popup' } };
    addState(card, 'light.previous'); addState(card, 'light.next');
    const records = new Map([['previous', { obj: old, binding: { entity: 'light.previous' }, chain: { entities: ['light.previous'] } }],
      ['next', { obj: next, binding: { entity: 'light.next' }, chain: { entities: ['light.next'] } }]]);
    vi.spyOn(card._objects, 'objectAt').mockImplementation((id) => records.get(id));
    vi.spyOn(card._objects, 'displayAnchors').mockReturnValue([{ id: next.id, world: f.point('upper', 1, 1, .2) }]);
    vi.spyOn(card._objects, 'displayAnchorOf').mockImplementation((id) => f.point(id === 'previous' ? 'ground' : 'upper', 1, 1, .2));
    // Visibility notification concerns the unrelated House shell. The actual
    // popup DOM and its real close method remain present for the order check.
    card._devicePopup.onVisibilityChange = vi.fn(); card._devicePopup.update(card._hass);
    card._devicePopup.showMarker({ id: 'old-marker', entityId: 'light.previous', name: old.label }, f.view.screenPoint(1, 1, .2, 'ground'));
    card._popup.open(old, f.point('ground', 1, 1, .2));
    const elements = [card._popup.el, card._devicePopup.el]; expect(elements.every((el) => el?.isConnected)).toBe(true);
    return { next, elements };
  }

  it('the native floor header runs the real callback and removes both previous control panels', () => {
    const f = fixture(), card = cardFor(f); installActualRenderCallbacks(card, f);
    const { elements } = openPreviousControls(card, f), before = beforeAction(f, card);
    f.view._floorPanels.render(); const header = f.view._floorPanels.labels.panes.get('upper').button; header.click();
    expect(f.view._floorPanels.activeFloorId).toBe('upper'); expect(elements.every((el) => !el.isConnected)).toBe(true);
    expect(card._popup.isOpen).toBe(false); expect(card._devicePopup.isOpen).toBe(false);
    expect(card._syncMiniMap).toHaveBeenCalledTimes(1); assertUnchanged(f, card, before);
  });

  it.each(['tracked', 'security', 'marker', 'bound-tap', 'bound-hold'])('the real floor callback removes old controls before new %s controls open', (kind) => {
    const f = fixture(), card = cardFor(f); installActualRenderCallbacks(card, f);
    const { next, elements } = openPreviousControls(card, f);
    const record = kind === 'tracked' ? tracked(card, f) : kind === 'security' ? security(card, f) : kind === 'marker' ? marker(card) : null;
    const popup = kind === 'bound-hold' ? card._popup : card._devicePopup, method = kind === 'bound-hold' ? 'open' : 'showMarker';
    const original = popup[method], opened = vi.spyOn(popup, method).mockImplementation(function (...args) {
      expect(f.view._floorPanels.activeFloorId).toBe('upper'); expect(elements.every((el) => !el.isConnected)).toBe(true);
      expect(card._syncMiniMap).toHaveBeenCalledTimes(1); return original.apply(this, args);
    });
    const before = beforeAction(f, card);
    if (kind === 'tracked') card._showTrackedEntity(record.id);
    else if (kind === 'security') card._showPlanSecurityEntity(record.id);
    else if (kind === 'marker') card._tap(record);
    else card._runObjectAction(next.id, kind === 'bound-tap' ? 'tap' : 'hold');
    expect(opened).toHaveBeenCalledTimes(1); expect(popup.isOpen).toBe(true); assertUnchanged(f, card, before);
  });
});

describe('stale or unavailable controls cannot switch panes', () => {
  it.each(['removed', 'not-shown', 'missing-location', 'unknown-floor', 'filtered-floor', 'editing', 'missing-state', 'hidden', 'disabled', 'diagnostic', 'nan-x', 'infinite-y', 'invalid-z'])(
    'rejects tracked actor %s before selecting or opening', (reason) => {
    const f = fixture(), card = cardFor(f), record = tracked(card, f);
    if (reason === 'removed') card._trackingData.records = [];
    if (reason === 'not-shown') record.shown = false;
    if (reason === 'missing-location') record.location = null;
    if (reason === 'unknown-floor') record.location.floorId = 'deleted-floor';
    if (reason === 'filtered-floor') f.view._visibleSet = new Set(['ground']);
    if (reason === 'editing') card._editing = true;
    if (reason === 'missing-state') delete card._hass.states[record.identity];
    if (reason === 'hidden') card._hass.entities[record.identity] = { hidden_by: 'user' };
    if (reason === 'disabled') card._hass.entities[record.identity] = { disabled_by: 'user' };
    if (reason === 'diagnostic') card._hass.entities[record.identity] = { entity_category: 'diagnostic' };
    if (reason === 'nan-x') record.location.x = NaN;
    if (reason === 'infinite-y') record.location.y = Infinity;
    if (reason === 'invalid-z') record.location.z = '1';
    const before = beforeAction(f, card); expect(card._showTrackedEntity(record.id)).toBe(false);
    expect(f.view._floorPanels.activeFloorId).toBe('ground'); expect(f.view.onFloorPanelSelect).not.toHaveBeenCalled();
    expect(card._devicePopup.showMarker).not.toHaveBeenCalled(); assertUnchanged(f, card, before);
  });

  it.each(['removed', 'not-shown', 'missing-location', 'unknown-floor', 'filtered-floor', 'editing', 'loading', 'hidden-layer', 'missing-part',
    'old-entity', 'old-generation', 'disconnected', 'missing-state', 'hidden', 'disabled', 'diagnostic', 'clipped', 'nan-x', 'infinite-y', 'invalid-z'])(
    'rejects plan-security %s before selecting or opening', (reason) => {
    const f = fixture(), card = cardFor(f), record = security(card, f); let expected = {};
    if (reason === 'removed') card._securityPlanData.records = [];
    if (reason === 'not-shown') record.shown = false;
    if (reason === 'missing-location') record.location = null;
    if (reason === 'unknown-floor') record.location.floorId = 'deleted-floor';
    if (reason === 'filtered-floor') f.view._visibleSet = new Set(['ground']);
    if (reason === 'editing') card._editing = true;
    if (reason === 'loading') card._loading = true;
    if (reason === 'hidden-layer') card._planSecurityLayer.group.visible = false;
    if (reason === 'missing-part') { const part = card._planSecurityLayer.parts.get(record.id); part.group.removeFromParent(); card._planSecurityLayer.parts.delete(record.id); }
    if (reason === 'old-entity') expected = { entity: 'binary_sensor.previous' };
    if (reason === 'old-generation') expected = { generation: 6 };
    if (reason === 'disconnected') card._hass.connection.connected = false;
    if (reason === 'missing-state') delete card._hass.states[record.entity];
    if (reason === 'hidden') card._hass.entities[record.entity] = { hidden_by: 'user' };
    if (reason === 'disabled') card._hass.entities[record.entity] = { disabled_by: 'user' };
    if (reason === 'diagnostic') card._hass.entities[record.entity] = { entity_category: 'diagnostic' };
    if (reason === 'clipped') f.view.sectionClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -100);
    if (reason === 'nan-x') record.location.x = NaN;
    if (reason === 'infinite-y') record.location.y = Infinity;
    if (reason === 'invalid-z') record.location.z = '1';
    const before = beforeAction(f, card); expect(card._showPlanSecurityEntity(record.id, expected)).toBe(false);
    expect(f.view._floorPanels.activeFloorId).toBe('ground'); expect(f.view.onFloorPanelSelect).not.toHaveBeenCalled();
    expect(card._devicePopup.showMarker).not.toHaveBeenCalled(); assertUnchanged(f, card, before);
  });

  it.each(['removed', 'missing-position', 'unknown-floor', 'filtered-floor', 'missing-state', 'hidden', 'disabled', 'diagnostic', 'hidden-marker',
    'not-shown', 'hidden-marker-state', 'nan-x', 'infinite-y', 'invalid-z'])(
    'rejects a retained ordinary keyboard marker after %s', (reason) => {
    const f = fixture(), card = cardFor(f), record = marker(card), label = card._markerElement(record);
    if (reason === 'removed') card._markers = [];
    if (reason === 'missing-position') card._positions.delete(record.id);
    if (reason === 'unknown-floor') card._positions.get(record.id).floorId = 'deleted-floor';
    if (reason === 'filtered-floor') f.view._visibleSet = new Set(['ground']);
    if (reason === 'missing-state') delete card._hass.states[record.entityId];
    if (reason === 'hidden') card._hass.entities[record.entityId] = { hidden_by: 'user' };
    if (reason === 'disabled') card._hass.entities[record.entityId] = { disabled_by: 'user' };
    if (reason === 'diagnostic') card._hass.entities[record.entityId] = { entity_category: 'diagnostic' };
    if (reason === 'not-shown') card._positions.get(record.id).shown = false;
    if (reason === 'hidden-marker-state') f.view._markerStates = new Map([[record.id, { shown: false }]]);
    if (reason === 'nan-x') card._positions.get(record.id).x = NaN;
    if (reason === 'infinite-y') card._positions.get(record.id).y = Infinity;
    if (reason === 'invalid-z') card._positions.get(record.id).z = '1';
    if (reason === 'hidden-marker') { const object = new CSS2DObject(label); f.view.markerGroup.add(object); object.visible = false;
      f.view.markerObjects.set(record.id, { obj: object, floorId: 'upper' }); }
    const before = beforeAction(f, card); label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(f.view._floorPanels.activeFloorId).toBe('ground'); expect(f.view.onFloorPanelSelect).not.toHaveBeenCalled();
    expect(card._devicePopup.showMarker).not.toHaveBeenCalled(); assertUnchanged(f, card, before);
  });

  it.each(['tap', 'hold'].flatMap((which) => ['removed', 'hidden-binding', 'hidden-node', 'hidden-ancestor', 'unowned', 'filtered-floor', 'missing-anchor', 'invalid-anchor']
    .map((reason) => [which, reason])))('rejects bound-object %s after %s before selecting or opening', (which, reason) => {
      const f = fixture(), card = cardFor(f), record = boundObject(card, f);
      if (reason === 'removed') card._objects.objectAt = () => null;
      if (reason === 'hidden-binding') record.binding = freeze({ ...record.binding, hidden: true });
      if (reason === 'hidden-node') record.obj.node.visible = false;
      if (reason === 'hidden-ancestor') f.groups[1].visible = false;
      if (reason === 'unowned') { record.obj.node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), f.meshes[1].material); f.root.add(record.obj.node); }
      if (reason === 'filtered-floor') f.view._visibleSet = new Set(['ground']);
      if (reason === 'missing-anchor') card._objects.displayAnchors = () => [];
      if (reason === 'invalid-anchor') card._objects.displayAnchors = () => [{ id: record.obj.id, world: new THREE.Vector3(NaN, 0, 0) }];
      const before = beforeAction(f, card); card._runObjectAction(record.obj.id, which);
      expect(f.view._floorPanels.activeFloorId, reason).toBe('ground'); expect(f.view.onFloorPanelSelect, reason).not.toHaveBeenCalled();
      expect(card._devicePopup.showMarker, reason).not.toHaveBeenCalled(); expect(card._popup.open, reason).not.toHaveBeenCalled();
      assertUnchanged(f, card, before);
  });
});

describe('inactive panes and popup frame ownership', () => {
  it.each(['tracked', 'security', 'marker', 'bound-tap', 'bound-hold'])('inactive %s opens ordinary controls with zero pane ownership scans', (kind) => {
    const f = fixture(), card = cardFor(f);
    const record = kind === 'tracked' ? tracked(card, f) : kind === 'security' ? security(card, f)
      : kind === 'marker' ? marker(card) : boundObject(card, f);
    f.view._floorCompiled = { ...f.compiled, panels: false }; expect(f.view._floorPanels.active).toBe(false);
    const before = beforeAction(f, card), participants = vi.spyOn(f.view._floorPanels, 'participants'), select = vi.spyOn(f.view._floorPanels, 'select');
    if (kind === 'tracked') expect(card._showTrackedEntity(record.id)).toBe(true);
    else if (kind === 'security') expect(card._showPlanSecurityEntity(record.id)).toBe(true);
    else if (kind === 'marker') card._tap(record);
    else card._runObjectAction(record.obj.id, kind === 'bound-tap' ? 'tap' : 'hold');
    expect(kind === 'bound-hold' ? card._popup.open : card._devicePopup.showMarker).toHaveBeenCalledTimes(1);
    expect(participants).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled(); assertUnchanged(f, card, before);
  });

  it('actual open ObjectPopup and Card.onRender use one synchronous ownership map for all projections', () => {
    const f = fixture(), card = cardFor(f), onRender = installActualRenderCallbacks(card, f), panels = f.view._floorPanels;
    const object = { id: 'live-upper', label: 'Real upstairs light', type: 'light', node: f.meshes[1] }, world = f.point('upper', 1, 1, .2);
    addState(card, 'light.upper_lamp');
    vi.spyOn(card._objects, 'objectAt').mockReturnValue({ obj: object, binding: { entity: 'light.upper_lamp' }, chain: { entities: ['light.upper_lamp'] } });
    vi.spyOn(card._objects, 'displayAnchorOf').mockReturnValue(world);
    panels.select('upper'); card._popup.open(object, world); expect(card._popup.isOpen).toBe(true);
    card._trackingLayer.setData({ records: displayLocatedRecords(f.floors.map((row) => ({ id: `actor:${row.id}`, kind: 'presence', entity: `person.${row.id}`,
      shown: true, active: true, label: row.name, location: { x: 0, y: 0, z: .2, floorId: row.id, elevation: row.elevation } })), f.compiled, f.floors), now: 1234 });
    expect(card._trackingLayer.parts.size).toBe(2);
    const participants = vi.spyOn(panels, 'participants'), floor = vi.spyOn(panels, 'floorForNode'), withFloor = vi.spyOn(panels, 'withFloor');
    const frame = panels.render(); onRender(frame);
    expect(participants).toHaveBeenCalledTimes(1); expect(floor).toHaveBeenCalledExactlyOnceWith(object.node, frame.members);
    expect(withFloor.mock.calls.map(([floorId, , members]) => [floorId, members === frame.members])).toEqual([['ground', true], ['upper', true]]);
    expect(card._popup.el.style.visibility).toBe(''); expect(card._popup.el.style.transform).toContain('translate(');
    participants.mockClear(); floor.mockClear(); card._popup.position();
    expect(participants).toHaveBeenCalledTimes(1); expect(floor).toHaveBeenCalledExactlyOnceWith(object.node, undefined);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('outside-frame positioning observes a changed exact floor owner rather than a cached map', () => {
    const f = fixture(), card = cardFor(f); installActualRenderCallbacks(card, f); const panels = f.view._floorPanels;
    const object = { id: 'moving-object', type: 'light', node: f.meshes[1] }; addState(card, 'light.upper_lamp');
    vi.spyOn(card._objects, 'objectAt').mockReturnValue({ obj: object, binding: { entity: 'light.upper_lamp' }, chain: { entities: ['light.upper_lamp'] } });
    const anchor = vi.spyOn(card._objects, 'displayAnchorOf').mockReturnValue(f.point('upper', 1, 1, .2));
    card._popup.open(object, anchor()); const participants = vi.spyOn(panels, 'participants'), project = vi.spyOn(f.view, 'projectWorld');
    card._popup.position(); expect(project.mock.lastCall[1]).toBe('upper');
    object.node = f.meshes[0]; anchor.mockReturnValue(f.point('ground', 1, 1, .2)); card._popup.position();
    expect(project.mock.lastCall[1]).toBe('ground'); expect(participants).toHaveBeenCalledTimes(2);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('ObjectPopup forwards a supplied map but preserves the exact one-argument projection call when omitted', () => {
    const f = fixture(), project = vi.fn(() => [f.box.left + 50, f.box.top + 50]), world = new THREE.Vector3(1, 2, 3), members = new Map([[f.meshes[1], 'upper']]);
    f.host.getBoundingClientRect = f.canvas.getBoundingClientRect;
    const obj = { id: 'basic', type: 'generic' }, states = { 'sensor.basic': { state: '1', attributes: {} } };
    const popup = new ObjectPopup(f.host, { project, resolve: () => ({ obj, chain: { entities: ['sensor.basic'] }, states, hass: { states } }) });
    try {
      popup.open({ id: 'basic' }, world); project.mockClear(); popup.position(members);
      expect(project).toHaveBeenCalledExactlyOnceWith(world, members); project.mockClear(); popup.position();
      expect(project).toHaveBeenCalledExactlyOnceWith(world);
    } finally { popup.close(); }
  });

  it('explicit marker toggle keeps its existing one-service behavior without selecting a pane', () => {
    const f = fixture(), card = cardFor(f), record = marker(card); card._config.device_tap_action = 'toggle';
    const participants = vi.spyOn(f.view._floorPanels, 'participants'), before = snapshotCamera(f.view.camera);
    card._tap(record);
    expect(card._hass.callService).toHaveBeenCalledExactlyOnceWith('light', 'toggle', { entity_id: record.entityId });
    expect(f.view.onFloorPanelSelect).not.toHaveBeenCalled(); expect(participants).not.toHaveBeenCalled();
    expect(card._devicePopup.showMarker).not.toHaveBeenCalled(); expect(snapshotCamera(f.view.camera)).toEqual(before);
  });
});
