// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Group, Scene, Vector3 } from 'three';
import { CameraCoverageLayer } from '../src/camera-coverage.js';

const settings = { enabled: true, heading: 0, fov: 90, range: 8 };
const cameraState = (value = 'idle') => ({ entity_id: 'camera.front', state: value, attributes: { friendly_name: 'Front camera' } });
const nodeObject = (id = 'front', entity = 'camera.front') => ({
  obj: { id, label: 'Front camera', level: 'ground', type: 'generic', node: new Group(), ui: { tap: 'popup', hold: 'more-info' } },
  binding: { entity, hidden: false }, chain: { entities: [entity, 'light.flood'] },
});

function fixture({ objects = [], markers = [] } = {}) {
  // Use the real custom-element methods while disconnected, without WebGL or HA calls.
  const card = document.createElement('taylors3d-card');
  card._layout = { camera_coverage: { 'camera.front': { ...settings } } };
  card._config = { device_tap_action: 'controls' };
  card._hass = { entities: { 'camera.front': {} }, states: { 'camera.front': cameraState(),
    'light.flood': { state: 'on', attributes: {} } }, callService: vi.fn() };
  card._floors = [{ id: 'ground', elevation: 0 }, { id: 'first', elevation: 3 }];
  card._levels = { levelFloor: { ground: 'ground', first: 'first' } };
  card._markers = markers;
  card._positions = new Map(markers.map((marker) => [marker.id, { x: 1, y: 2, z: 2.3, floorId: 'ground' }]));
  card._view = { floorElevation: (id) => id === 'first' ? 3 : 0,
    _markerStates: new Map(markers.map((marker) => [marker.id, { shown: true, faded: false }])),
    markerObjects: new Map(markers.map((marker) => {
      const obj = new Group(); obj.position.set(1, 2.3, -2); return [marker.id, { obj, floorId: 'ground' }];
    })), _cutAway: () => false,
    projectWorld: vi.fn(() => [120, 80]), screenPoint: vi.fn(() => [120, 80]), dirty: false };
  card._objects = { objectAt: (id) => objects.find((entry) => entry.object.obj.id === id)?.object,
    anchors: () => objects.map((entry) => ({ id: entry.object.obj.id, world: entry.world })) };
  card._groups = { flood: { entity: 'light.flood' } };
  card._navigationFloors = () => 'all';
  card._popup = { close: vi.fn(), open: vi.fn() };
  card._devicePopup = { close: vi.fn(), update: vi.fn(), showMarker: vi.fn() };
  card._moreInfo = vi.fn();
  card._cameraCoverage = new CameraCoverageLayer(new Scene(), { onInvalidate: () => { card._view.dirty = true; } });
  return card;
}

const modelEntry = (id = 'front') => ({ object: nodeObject(id), world: new Vector3(4, 2.4, -5) });
const groupedMarker = () => ({ id: 'device:flood', entityId: 'light.flood', domain: 'light', name: 'Floodlight',
  entities: [{ eid: 'light.flood' }, { eid: 'camera.front' }] });

beforeAll(async () => { await import('../src/taylors3d-card.js'); });

describe('card camera coverage anchors', () => {
  it('finds camera entities inside a light-primary grouped device marker', () => {
    const card = fixture({ markers: [groupedMarker()] });
    expect(card.cameraAnchors()).toMatchObject([{ entity: 'camera.front', position: { x: 1, y: 2, z: 2.3, elevation: 0, floorId: 'ground' } }]);
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(1);
    card._cameraCoverage.dispose();
  });

  it('uses a genuine model camera position instead of duplicating its grouped device marker', () => {
    const card = fixture({ objects: [modelEntry()], markers: [groupedMarker()] });
    expect(card.cameraAnchors()).toMatchObject([{ id: 'object:front', entity: 'camera.front', position: { x: 4, y: 5, z: 2.4 } }]);
    card._syncCameraCoverage(); expect([...card._cameraCoverage.sectors.keys()]).toEqual(['object:front']);
    card._cameraCoverage.dispose();
  });

  it('converts aligned world positions using the actual linked floor elevation', () => {
    const entry = modelEntry(); entry.object.obj.level = 'first'; entry.world.set(-2, 5.4, 7);
    const card = fixture({ objects: [entry] });
    const anchor = card.cameraAnchors()[0];
    expect(anchor.position).toMatchObject({ x: -2, y: -7, elevation: 3, floorId: 'first' });
    expect(anchor.position.z).toBeCloseTo(2.4);
    card._syncCameraCoverage();
    expect(card._cameraCoverage.sectors.get('object:front').group.position.y).toBeCloseTo(3.035);
    card._cameraCoverage.dispose();
  });

  it('does not draw coverage for a room-hidden marker on an otherwise visible floor', () => {
    const marker = groupedMarker(), card = fixture({ markers: [marker] });
    card._view._markerStates.set(marker.id, { shown: false, faded: false });
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    card._cameraCoverage.dispose();
  });

  it('respects hidden model ancestors, layout-hidden objects and selected floors', () => {
    const entry = modelEntry(), ancestor = new Group(); ancestor.add(entry.object.obj.node); ancestor.visible = false;
    const card = fixture({ objects: [entry] });
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    ancestor.visible = true; entry.object.binding.hidden = true;
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    entry.object.binding.hidden = false; card._navigationFloors = () => ['first'];
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    card._cameraCoverage.dispose();
  });

  it('retains a view-hidden model choice and prevents its cone from relocating to a grouped marker', () => {
    const entry = modelEntry(); entry.object.obj.node.visible = false;
    const card = fixture({ objects: [entry], markers: [groupedMarker()] });
    expect(card.cameraAnchors()).toMatchObject([{ id: 'object:front', shown: false }]);
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    card._cameraCoverage.dispose();
  });
  it('does not relocate a user-hidden bound model camera onto its grouped device marker', () => {
    const entry = modelEntry(); entry.object.binding.hidden = true;
    const card = fixture({ objects: [entry], markers: [groupedMarker()] });
    expect(card.cameraAnchors()).toMatchObject([{ id: 'object:front', shown: false }]);
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    card._cameraCoverage.dispose();
  });
  it('keeps duplicate mount coverage ambiguous when one model camera is user-hidden', () => {
    const hidden = modelEntry(); hidden.object.binding.hidden = true;
    const second = modelEntry('rear'); second.world.x = 12;
    const card = fixture({ objects: [hidden, second] });
    expect(card.cameraAnchors()).toHaveLength(2);
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    expect(card._cameraCoverage.diagnostics.some((issue) => issue.code === 'ambiguous_anchor')).toBe(true);
    card._layout.camera_coverage = { 'object:rear': { ...settings } };
    card._syncCameraCoverage(); expect([...card._cameraCoverage.sectors.keys()]).toEqual(['object:rear']);
    card._cameraCoverage.dispose();
  });
  it('does not assign a camera from a stale model floor to a floor inferred by height', () => {
    const card = fixture({ objects: [modelEntry()] });
    card._mb = { levels: { ground: { floor: 'deleted_floor', stale: true } } };
    expect(card.cameraAnchors()).toEqual([]);
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    card._cameraCoverage.dispose();
  });

  it('hides section-removed camera origins using model cut state and real marker visibility', () => {
    const model = fixture({ objects: [modelEntry()] }); model._view._cutAway = () => true;
    model._syncCameraCoverage(); expect(model._cameraCoverage.sectors.size).toBe(0); model._cameraCoverage.dispose();
    const marker = groupedMarker(), card = fixture({ markers: [marker] });
    card._view.markerObjects.get(marker.id).obj.visible = false;
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0); card._cameraCoverage.dispose();
  });

  it.each(['model', 'marker'])('excludes HA-hidden, disabled, missing and registered-without-state %s cameras', (source) => {
    const card = source === 'model' ? fixture({ objects: [modelEntry()] }) : fixture({ markers: [groupedMarker()] });
    for (const registration of [{ hidden: true }, { hidden_by: 'user' }, { disabled_by: 'integration' }]) {
      card._hass.entities['camera.front'] = registration;
      card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    }
    card._hass.entities['camera.front'] = {}; delete card._hass.states['camera.front'];
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    delete card._hass.entities['camera.front'];
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    card._cameraCoverage.dispose();
  });

  it.each(['unavailable', 'unknown', 'off'])('retains an existing %s camera static approximation without starting any stream/service', (value) => {
    const card = fixture({ objects: [modelEntry()] }); card._hass.states['camera.front'] = cameraState(value);
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(1);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._devicePopup.showMarker).not.toHaveBeenCalled();
    card._cameraCoverage.dispose();
  });

  it('requires a specific saved anchor when the same entity has two physical model bindings', () => {
    const second = modelEntry('rear'); second.world.x = 12;
    const card = fixture({ objects: [modelEntry(), second] });
    expect(card.cameraAnchors().map((anchor) => anchor.id)).toEqual(['object:front', 'object:rear']);
    card._syncCameraCoverage(); expect(card._cameraCoverage.sectors.size).toBe(0);
    expect(card._cameraCoverage.diagnostics.map((issue) => issue.code)).toEqual(['ambiguous_anchor', 'ambiguous_anchor']);
    card._layout.camera_coverage['object:rear'] = { ...settings };
    card._syncCameraCoverage(); expect([...card._cameraCoverage.sectors.keys()]).toEqual(['object:rear']);
    card._cameraCoverage.dispose();
  });

  it('previews coverage reversibly and remains idle for unchanged geometry and ordinary state updates', () => {
    const card = fixture({ objects: [modelEntry()] }); card._syncCameraCoverage();
    const saved = JSON.stringify(card._layout);
    card._view.dirty = false;
    card._hass.states['camera.front'] = cameraState('streaming'); card._syncCameraCoverage();
    expect(card._view.dirty).toBe(false);
    card.previewCameraCoverage({ 'object:front': { ...settings, range: 12 } });
    expect(card._view.dirty).toBe(true);
    expect(JSON.stringify(card._layout)).toBe(saved);
    const previewKey = card._cameraCoverage.sectors.get('object:front').geometryKey;
    card._view.dirty = false; card.previewCameraCoverage(null);
    expect(card._view.dirty).toBe(true); expect(card._cameraCoverage.sectors.get('object:front').geometryKey).not.toBe(previewKey);
    card._editing = true; card._edit = { tab: 'devices' }; card._syncCameraCoverage(); expect(card._cameraCoverage.group.visible).toBe(false);
    card._edit.tab = 'cameras'; card._syncCameraCoverage(); expect(card._cameraCoverage.group.visible).toBe(true);
    card._cameraCoverage.dispose();
  });
});

describe('default bound-camera taps', () => {
  it('retains an unavailable bound camera rather than silently choosing its working light controller', () => {
    const entry = modelEntry(); entry.object.obj.group = 'flood';
    const card = fixture({ objects: [entry] }); card._hass.states['camera.front'] = cameraState('unavailable');
    card._runObjectAction('front', 'tap');
    expect(card._devicePopup.showMarker).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'camera.front' }), [120, 80]);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._moreInfo).not.toHaveBeenCalled();
    expect(card._popup.open).not.toHaveBeenCalled(); card._cameraCoverage.dispose();
  });

  it('preserves an explicitly disabled tap action without opening controls or sending a service', () => {
    const entry = modelEntry(); entry.object.obj.ui.tap = 'none'; const card = fixture({ objects: [entry] });
    card._runObjectAction('front', 'tap');
    expect(card._devicePopup.showMarker).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
    expect(card._popup.open).not.toHaveBeenCalled(); card._cameraCoverage.dispose();
  });

  it('passes the complete grouped marker to controls so its camera row remains accessible', () => {
    const marker = groupedMarker(), card = fixture({ markers: [marker] }); card._tap(marker);
    expect(card._devicePopup.showMarker).toHaveBeenCalledWith(marker, [120, 80]);
    expect(card._hass.callService).not.toHaveBeenCalled(); card._cameraCoverage.dispose();
  });
});
