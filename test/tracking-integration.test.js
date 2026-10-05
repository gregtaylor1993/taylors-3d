// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Group, Plane, Scene, Vector3 } from 'three';
import { TrackedEntitiesLayer } from '../src/tracked-entities.js';

const epoch = Date.parse('2026-10-05T12:00:00Z');
const state = (value, attributes = {}) => ({ state: value, attributes });
const eventBinding = (id = 'seen', ttl = 10) => ({ id, entity: 'event.car', kind: 'event', vehicle_source_confirmed: true,
  timestamp_mode: 'attribute', timestamp_attr: 'observed_at', timestamp_format: 'iso', expires_seconds: ttl,
  event_type_attr: 'type', event_types: ['car'], position: { x: 10, y: 2, z: .1, floorId: 'ground' } });
const parkedBinding = { id: 'bay', entity: 'binary_sensor.car', kind: 'occupancy', vehicle_source_confirmed: true,
  position: { x: 11, y: 2, z: .1, floorId: 'ground' } };
const vacuumBinding = { id: 'robot', entity: 'vacuum.robot', kind: 'static', roomId: 'lounge' };
const cards = [];

function fixture(layout = {}) {
  vi.useFakeTimers(); vi.setSystemTime(epoch);
  delete window.__demoNow;
  const card = document.createElement('taylors3d-card');
  card.connected = true;
  Object.defineProperty(card, 'isConnected', { get: () => card.connected });
  card._config = { layout_key: 'default' };
  card._layout = { ...layout };
  card._floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 3 }];
  card._levels = { levelFloor: { ground: 'ground', upper: 'upper' } };
  card._roomList = [{ room: { id: 'lounge', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], floor_id: 'ground' }, floorId: 'ground', name: 'Lounge' },
    { room: { id: 'bedroom', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], floor_id: 'upper' }, floorId: 'upper', name: 'Bedroom' }];
  card._navigationRooms = () => card._roomList.filter((room) => room.room.id !== card.hiddenRoom);
  card._navigationFloors = () => card.visibleFloors || 'all';
  card._hass = { connection: {}, states: {
    'event.car': state('event', { observed_at: new Date(epoch).toISOString(), type: 'car' }),
    'binary_sensor.car': { ...state('on'), last_changed: '2020-01-01T00:00:00Z' },
    'vacuum.robot': state('cleaning', { x: 2, y: 2 }), 'sensor.xy': state('position', { x: 2, y: 2 }),
    'person.taylor': state('home', { friendly_name: 'Taylor' }), 'sensor.room': state('lounge'),
    'light.dock': state('off') }, entities: {}, callService: vi.fn() };
  card._markers = [{ id: 'device:dock', name: 'Dock', entityId: 'light.dock', entities: [{ eid: 'light.dock' }] }];
  card._positions = new Map([['device:dock', { x: 5, y: 6, z: .2, floorId: 'ground' }]]);
  card._view = { scene: new Scene(), dirty: false, floorElevation: (id) => card._floors.find((f) => f.id === id)?.elevation,
    _markerStates: new Map([['device:dock', { shown: true }]]), markerObjects: new Map([['device:dock', { obj: new Group() }]]),
    _cutAway: (point) => !!card._view.sectionClip && card._view.sectionClip.distanceToPoint(point) < 0,
    screenPoint: vi.fn(() => [123, 89]), getCamera: () => null, getTopCamera: () => null, stop: vi.fn(), start: vi.fn() };
  card._objects = { anchors: () => [], objectAt: () => null };
  card._popup = { close: vi.fn() };
  card._devicePopup = { close: vi.fn(), update: vi.fn(), showMarker: vi.fn() };
  card._miniMap = { setVisible: vi.fn(), update: vi.fn() };
  card._trackingLayer = new TrackedEntitiesLayer(card._view.scene, { onInvalidate: () => { if (card._view) card._view.dirty = true; },
    onSelect: (id) => card._showTrackedEntity(id) });
  cards.push(card);
  return card;
}

beforeAll(async () => { await import('../src/taylors3d-card.js'); });
afterEach(() => {
  for (const card of cards.splice(0)) { card._clearTrackingTimer(); card._trackingLayer.dispose(); }
  delete window.__demoNow;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('card tracking lifecycle and expiry', () => {
  it('expires a sighting without a HA update and arms only the nearest of multiple deadlines', () => {
    const card = fixture({ vehicle_bindings: [eventBinding(), eventBinding('other', 20)] });
    card._syncMiniMap();
    expect(card._trackingLayer.parts.size).toBe(2);
    expect(card._trackingDeadline).toBe(epoch + 10000); expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(10000);
    expect(card._trackingData.records.find((r) => r.id === 'vehicle:seen')).toMatchObject({ active: false, shown: false });
    expect(card._trackingLayer.parts.size).toBe(1);
    expect(card._trackingDeadline).toBe(epoch + 20000); expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(10000);
    expect(card._trackingLayer.parts.size).toBe(0); expect(card._trackingTimer).toBeNull();
    expect(card._miniMap.update.mock.lastCall[0].trackedMarkers).toEqual([]);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('keeps an unchanged event deadline through metadata, TTL edits and temporary disable', () => {
    const card = fixture({ vehicle_bindings: [eventBinding()] }); card._syncTracking();
    const timer = card._trackingTimer;
    vi.advanceTimersByTime(4000);
    card._hass.states['event.car'] = { ...card._hass.states['event.car'], context: { id: 'later' } };
    card._layout.vehicle_bindings[0].expires_seconds = 120;
    card._syncTracking(); expect(card._trackingTimer).toBe(timer); expect(card._trackingDeadline).toBe(epoch + 10000);
    card._layout.vehicle_bindings[0].enabled = false; card._syncTracking(); expect(card._trackingLayer.parts.size).toBe(0);
    card._layout.vehicle_bindings[0].enabled = true; card._syncTracking(); expect(card._trackingDeadline).toBe(epoch + 10000);
    vi.advanceTimersByTime(6000);
    expect(card._trackingData.records[0].active).toBe(false);
    card._syncTracking(true); expect(card._trackingData.records[0].active).toBe(false);
  });

  it('drops memory for a deliberately changed source while preserving unrelated active sources', () => {
    const card = fixture({ vehicle_bindings: [eventBinding(), eventBinding('stable', 20)] }); card._syncTracking();
    vi.advanceTimersByTime(2000);
    card._hass.states['event.new'] = state('event', { observed_at: new Date(epoch + 2000).toISOString(), type: 'car' });
    card._layout.vehicle_bindings[0].entity = 'event.new'; card._syncTracking();
    expect(card._trackingMemory.vehicles.seen.observedAt).toBe(epoch + 2000);
    expect(card._trackingMemory.vehicles.stable.expiresAt).toBe(epoch + 20000);
    card._resetTracking(); expect(vi.getTimerCount()).toBe(0); expect(card._trackingData.records).toEqual([]);
    expect(card._trackingMemory.vehicles).toEqual({});
  });

  it('cleans up on disconnect and removes expired observations on reconnect', () => {
    const card = fixture({ vehicle_bindings: [eventBinding()] }); card._syncTracking();
    const eventKey = card._trackingMemory.vehicles.seen.eventKey;
    card.connected = false; card.disconnectedCallback();
    expect(vi.getTimerCount()).toBe(0); expect(card._trackingLayer.group.visible).toBe(false);
    vi.advanceTimersByTime(15000);
    card.connected = true; card._syncTracking(true);
    expect(card._trackingData.records[0].active).toBe(false); expect(card._trackingLayer.parts.size).toBe(0);
    expect(card._trackingMemory.vehicles.seen.eventKey).toBe(eventKey); expect(vi.getTimerCount()).toBe(0);
  });

  it('resnapshots after tab visibility resumes and never extends a paused sighting', () => {
    const card = fixture({ vehicle_bindings: [eventBinding()] }); card._syncTracking();
    const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    card._onTrackingVisibility(); expect(card._trackingTimer).toBeNull();
    vi.advanceTimersByTime(12000);
    visibility.mockReturnValue(false); card._onTrackingVisibility();
    expect(card._trackingData.records[0].active).toBe(false); expect(card._trackingLayer.parts.size).toBe(0);
    expect(card._trackingDeadline).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps immutable event memory across a new HA connection, but resets it for a different layout key', () => {
    const card = fixture({ vehicle_bindings: [eventBinding()] }); card._syncTracking();
    card._schedule = vi.fn();
    vi.advanceTimersByTime(4000); card._layout.vehicle_bindings[0].expires_seconds = 120;
    const memory = card._trackingMemory.vehicles.seen;
    card.hass = { ...card._hass, connection: {} };
    expect(card._trackingMemory.vehicles.seen).toEqual(memory);
    expect(card._trackingTimer).toBeNull();
    card._syncTracking(); expect(card._trackingDeadline).toBe(epoch + 10000);
    vi.advanceTimersByTime(6000); expect(card._trackingData.records[0].active).toBe(false);
    card.hass = { ...card._hass, connection: {} }; card._syncTracking();
    expect(card._trackingData.records[0].active).toBe(false); expect(card._trackingTimer).toBeNull();
    // Disconnect the lightweight test scene before setConfig can create WebGL.
    card.connected = false; card._view = null; card._hass = null;
    card.setConfig({ layout_key: 'another_home' });
    expect(card._trackingMemory.vehicles).toEqual({}); expect(card._trackingTimer).toBeNull();
    expect(card._layout).toBeNull();
  });

  it('keeps maintained old occupancy indefinitely and does not redraw unrelated HA changes', () => {
    const card = fixture({ vehicle_bindings: [parkedBinding] }); card._syncTracking();
    const part = card._trackingLayer.parts.get('vehicle:bay'), label = part.label.element;
    expect(card._trackingData.records[0]).toMatchObject({ active: true, shown: true }); expect(vi.getTimerCount()).toBe(0);
    card._view.dirty = false;
    card._hass.states = { ...card._hass.states, 'sensor.unplaced': state('99') };
    card._syncTracking(); card._syncTracking();
    expect(card._view.dirty).toBe(false); expect(card._trackingLayer.parts.get('vehicle:bay').label.element).toBe(label);
    vi.advanceTimersByTime(86400000); card._syncTracking(); expect(card._trackingData.records[0].active).toBe(true);
    card._hass.states['binary_sensor.car'] = state('off'); card._syncTracking();
    expect(card._trackingLayer.parts.size).toBe(0); expect(card._view.dirty).toBe(true);
  });

  it('updates both animated layers even when alert animation already requests rendering', () => {
    const card = fixture(); card._statusOverlays = { update: vi.fn(() => true) };
    vi.spyOn(card._trackingLayer, 'update').mockReturnValue(true);
    expect(card._animateFeatures(100)).toBe(true);
    expect(card._statusOverlays.update).toHaveBeenCalledWith(100, { reducedMotion: false });
    expect(card._trackingLayer.update).toHaveBeenCalledWith(100, { reducedMotion: false });
  });
});

describe('card tracking placement and controls', () => {
  it('uses exact original marker/model keys and actual floor elevation without feedback anchors', () => {
    const card = fixture({ vacuum_bindings: [{ ...vacuumBinding, roomId: undefined, position_key: 'object:dock' }] });
    const node = new Group(), object = { obj: { id: 'dock', label: 'Dock model', node, level: 'upper' }, binding: {} };
    card._objects = { anchors: () => [{ id: 'dock', world: new Vector3(7, 3.4, -9) }], objectAt: () => object };
    const anchors = card.trackingAnchors();
    expect(anchors.map((entry) => entry.id)).toEqual(['object:dock', 'device:dock']);
    expect(anchors[0].position).toMatchObject({ x: 7, y: 9, floorId: 'upper', elevation: 3 });
    expect(anchors[0].position.z).toBeCloseTo(.4);
    card._syncTracking(); expect(card._trackingData.records[0].location.x).toBe(7);
    expect(card.trackingAnchors()).toEqual(anchors); expect(card._positions.size).toBe(1);
    expect(card._positions.has('vacuum:robot')).toBe(false);
    node.visible = false; card._syncTracking(); expect(card._trackingData.records[0].shown).toBe(false);
    expect(card.trackingAnchors()[0].shown).toBe(false);
    card._mb = { levels: { upper: { stale: true, floor: 'deleted' } } };
    expect(card.trackingAnchors().map((entry) => entry.id)).toEqual(['device:dock']);
  });

  it('rejects duplicate object keys instead of silently taking the last position', () => {
    const card = fixture({ vacuum_bindings: [{ ...vacuumBinding, roomId: undefined, position_key: 'object:dock' }] });
    card._objects = { objectAt: () => ({ obj: { label: 'Dock', level: 'ground', node: new Group() } }),
      anchors: () => [{ id: 'dock', world: new Vector3(1, 0, -2) }, { id: 'dock', world: new Vector3(5, 0, -2) }] };
    card._syncTracking(); expect(card._trackingData.records[0].location).toBeNull();
    expect(card._trackingData.diagnostics.some((issue) => issue.code === 'anchor')).toBe(true);
  });

  it('hides measured points in a hidden room, on another floor, or behind the real section plane', () => {
    const card = fixture({ vacuum_bindings: [{ ...vacuumBinding, kind: 'xy',
      position_source: { entity: 'sensor.xy', source: 'xy', x_attr: 'x', y_attr: 'y', units: 'm', plan_meters: true, floorId: 'upper' } }] });
    card._syncMiniMap(); expect(card._trackingData.records[0]).toMatchObject({ measured: true, shown: true });
    card.hiddenRoom = 'bedroom'; card._syncMiniMap(); expect(card._trackingLayer.parts.size).toBe(0);
    card.hiddenRoom = null; card.visibleFloors = ['ground']; card._syncMiniMap(); expect(card._trackingData.records[0].shown).toBe(false);
    card.visibleFloors = 'all'; card._view.sectionClip = new Plane(new Vector3(1, 0, 0), -3);
    card._syncMiniMap(); expect(card._trackingData.records[0].shown).toBe(false);
    expect(card._miniMap.update.mock.lastCall[0].trackedMarkers).toEqual([]);
    card._view.sectionClip = null; card._syncMiniMap(); expect(card._trackingData.records[0].shown).toBe(true);
  });

  it('expires stale measured coordinates to an honest fixed status anchor with matching mini-map styling', () => {
    const card = fixture({ vacuum_bindings: [{ ...vacuumBinding, kind: 'xy', position_source: {
      entity: 'sensor.xy', source: 'xy', x_attr: 'x', y_attr: 'y', units: 'm', plan_meters: true, floorId: 'upper',
      freshness: { timestamp_mode: 'attribute', timestamp_attr: 'observed_at', timestamp_format: 'iso', max_age_seconds: 5 } } }] });
    card._hass.states['sensor.xy'].attributes.observed_at = new Date(epoch).toISOString();
    card._syncMiniMap(); expect(card._trackingData.records[0]).toMatchObject({ measured: true, location: { floorId: 'upper' } });
    vi.advanceTimersByTime(5000);
    expect(card._trackingData.records[0]).toMatchObject({ measured: false, positionStatus: 'stale', color: '#8d9199', location: { floorId: 'ground' } });
    expect(card._miniMap.update.mock.lastCall[0].trackedMarkers[0]).toMatchObject({ kind: 'vacuum', color: '#8d9199', positionStatus: 'stale' });
    expect(card._trackingDeadline).toBeNull();
  });

  it('opens exact current vacuum controls from map or scene labels without any service call', () => {
    const card = fixture({ vacuum_bindings: [vacuumBinding] }); card._syncTracking();
    card._trackingLayer.parts.get('vacuum:robot').label.element.click();
    expect(card._devicePopup.showMarker).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'vacuum.robot', id: 'vacuum:robot' }), [123, 89]);
    card._hass.states['vacuum.second'] = state('docked'); card._layout.vacuum_bindings[0].entity = 'vacuum.second'; card._syncTracking();
    expect(card._showTrackedEntity('vacuum:robot')).toBe(true);
    expect(card._devicePopup.showMarker.mock.lastCall[0].entityId).toBe('vacuum.second');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('opens a genuine identified person with its room-source reading and blocks hidden/missing/diagnostic targets', () => {
    const card = fixture({ presence_bindings: [{ id: 'taylor', entity: 'sensor.room', kind: 'room_location',
      identity_entity: 'person.taylor', room_source: { entity: 'sensor.room', room_map: { lounge: 'lounge' } } }] });
    card._syncTracking(); expect(card._showTrackedEntity('presence:taylor')).toBe(true);
    expect(card._devicePopup.showMarker.mock.lastCall[0]).toMatchObject({ entityId: 'person.taylor', entities: [{ eid: 'person.taylor' }, { eid: 'sensor.room' }] });
    card._hass.entities['person.taylor'] = { hidden_by: 'user' }; expect(card._showTrackedEntity('presence:taylor')).toBe(false);
    card._hass.entities['person.taylor'] = { entity_category: 'diagnostic' }; expect(card._showTrackedEntity('presence:taylor')).toBe(false);
    delete card._hass.states['person.taylor']; expect(card._showTrackedEntity('presence:taylor')).toBe(false);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('shows tracking edit previews only in Tracking and disables all label control buttons during editing', () => {
    const card = fixture({ vacuum_bindings: [vacuumBinding] }); card._syncTracking();
    card._editing = true; card._edit = { tab: 'devices' }; card._syncTracking();
    expect(card._trackingLayer.group.visible).toBe(false);
    card._edit.tab = 'tracking'; card._syncTracking(); expect(card._trackingLayer.group.visible).toBe(true);
    const button = card._trackingLayer.parts.get('vacuum:robot').label.element;
    expect(button.disabled).toBe(true); button.click(); expect(card._devicePopup.showMarker).not.toHaveBeenCalled();
    expect(card._showTrackedEntity('vacuum:robot')).toBe(false);
    card._editing = false; card._syncTracking(); expect(button.disabled).toBe(false);
  });
});
