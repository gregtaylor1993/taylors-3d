// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildPresence, buildVehicles, buildVacuums, buildTrackedEntities, TrackedEntitiesLayer } from '../src/tracked-entities.js';

const now = Date.parse('2026-10-05T12:00:00Z');
const state = (value, attributes = {}, extras = {}) => ({ state: value, attributes, ...extras });
const rooms = [
  { room: { id: 'lounge', name: 'Lounge', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }, floorId: 'ground', shown: true },
  { room: { id: 'bedroom', name: 'Bedroom', floor_id: 'upper', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }, floorId: 'upper', shown: true },
];
const floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 3 }];
const position = { x: 10, y: -2, z: 0, floorId: 'ground' };
const environment = (extra = {}) => ({ now, rooms, floors, states: {
  'binary_sensor.motion': state('on', { device_class: 'motion', friendly_name: 'Lounge motion' }),
  'sensor.room': state('lounge', { friendly_name: 'Taylor room reading' }), 'person.taylor': state('home', { friendly_name: 'Taylor' }),
  'binary_sensor.car': state('on', { device_class: 'occupancy' }, { last_changed: '2020-01-01T00:00:00Z' }),
  'vacuum.robot': state('cleaning', { friendly_name: 'Robot', x: 2, y: 3 }), ...extra.states }, ...extra });
const activity = { id: 'activity', entity: 'binary_sensor.motion', kind: 'room_activity', signal: 'motion', roomId: 'lounge' };
const presence = { id: 'taylor', entity: 'person.taylor', kind: 'room_location', room_source: { entity: 'sensor.room', room_map: { lounge: 'lounge', bedroom: 'bedroom' } } };
const vehicle = { id: 'drive', entity: 'binary_sensor.car', kind: 'occupancy', vehicle_source_confirmed: true, position };
const vacuum = { id: 'robot', entity: 'vacuum.robot', kind: 'static', roomId: 'lounge' };
const event = { ...vehicle, kind: 'event', timestamp_mode: 'attribute', timestamp_attr: 'observed_at', timestamp_format: 'iso', expires_seconds: 60, event_types: ['car'], event_type_attr: 'type' };
const xy = { ...vacuum, kind: 'xy', floorId: 'upper', position_source: { source: 'xy', entity: 'vacuum.robot', x_attr: 'x', y_attr: 'y', units: 'm', plan_meters: true } };

describe('explicit presence observations', () => {
  it('shows motion as room activity without person identity or a service', () => {
    const hass = { states: environment().states, callService: vi.fn() };
    const result = buildPresence({ ...environment(), hass, bindings: [{ ...activity, identity_entity: 'person.taylor' }] });
    expect(result.records[0]).toMatchObject({ kind: 'activity', active: true, roomId: 'lounge', shown: true, location: { x: 2, y: 1.5, floorId: 'ground', elevation: 0 } });
    expect(result.records[0].label).toContain('Room activity'); expect(result.records[0].identity).toBeUndefined(); expect(result.diagnostics.some((d) => d.code === 'activity_not_identity')).toBe(true);
    expect(hass.callService).not.toHaveBeenCalled(); expect(result.nextExpiry).toBeNull();
  });
  it('places one actual person/device room reading and reports that it represents the room', () => {
    const result = buildPresence({ ...environment(), bindings: [presence] });
    expect(result.records[0]).toMatchObject({ identity: 'person.taylor', roomId: 'lounge', active: true, shown: true, measured: false });
    expect(result.records[0].label).toBe('Taylor: Lounge (room observation)'); expect(result.miniMap[0]).toMatchObject({ entityId: 'person.taylor', position: { x: 2, y: 1.5 } });
  });
  it('uses only a verified associated identity as the default room-location label', () => {
    const binding = { ...presence, entity: 'sensor.room', identity_entity: 'person.taylor' };
    const associated = buildPresence({ ...environment(), bindings: [binding] });
    expect(associated.records[0]).toMatchObject({ name: 'Taylor', label: 'Taylor: Lounge (room observation)' });
    const labelled = buildPresence({ ...environment(), bindings: [{ ...binding, label: 'Phone location' }] });
    expect(labelled.records[0].label).toBe('Phone location: Lounge (room observation)');
    const anonymous = buildPresence({ ...environment(), bindings: [{ ...activity, identity_entity: 'person.taylor' }] });
    expect(anonymous.records[0].label).toBe('Lounge motion: Room activity');
    const unavailable = buildPresence({ ...environment({ states: { ...environment().states, 'person.taylor': state('unavailable', { friendly_name: 'Taylor' }) } }), bindings: [binding] });
    expect(unavailable.records[0]).toMatchObject({ identity: null, name: 'Taylor room reading', shown: false });
  });
  it.each(['home', 'not_home', 'away'])('never turns coarse %s state into a room location', (value) => {
    const result = buildPresence({ ...environment({ states: { 'person.taylor': state(value) } }), bindings: [{ ...presence, room_source: { entity: 'person.taylor', room_map: { [value]: 'lounge' } } }] });
    expect(result.records[0].location).toBeNull(); expect(result.records[0].shown).toBe(false); expect(result.diagnostics.some((d) => d.code === 'home_not_room')).toBe(true);
  });
  it('rejects a motion-to-room mapping as evidence of a person location', () => {
    const result = buildPresence({ ...environment(), bindings: [{ ...presence, room_source: { entity: 'binary_sensor.motion', room_map: { on: 'lounge' } } }] });
    expect(result.records[0].status).toBe('invalid'); expect(result.records[0].location).toBeNull();
  });
  it('does not pick the first of two rooms mapped to one observation', () => {
    const result = buildPresence({ ...environment(), bindings: [{ ...presence, room_source: { entity: 'sensor.room', room_map: { lounge: ['lounge', 'bedroom'] } } }] });
    expect(result.records[0].status).toBe('ambiguous'); expect(result.records[0].shown).toBe(false);
  });
  it('reports contradictory room observations for one identity instead of choosing a room', () => {
    const result = buildPresence({ ...environment({ states: { ...environment().states, 'sensor.other': state('bedroom') } }), bindings: [presence,
      { ...presence, id: 'other', room_source: { entity: 'sensor.other', room_map: { bedroom: 'bedroom' } } }] });
    expect(result.records.every((r) => r.status === 'ambiguous' && !r.shown && !r.location)).toBe(true); expect(result.diagnostics.some((d) => d.code === 'conflicting_presence')).toBe(true);
  });
  it('shows one symbol for matching independent observations of the same identity/room', () => {
    const result = buildPresence({ ...environment(), bindings: [presence, { ...presence, id: 'wifi' }] });
    expect(result.records).toHaveLength(2); expect(result.records.filter((r) => r.shown)).toHaveLength(1); expect(result.miniMap).toHaveLength(1); expect(result.records.some((r) => r.supporting)).toBe(true);
  });
  it('marks a room observation contradictory when its person/device source reports away', () => {
    const result = buildPresence({ ...environment({ states: { ...environment().states, 'person.taylor': state('not_home') } }), bindings: [presence] });
    expect(result.records[0]).toMatchObject({ status: 'ambiguous', active: false, location: null, shown: false }); expect(result.diagnostics.some((d) => d.code === 'conflicting_presence')).toBe(true);
  });
  it('uses exact attribute mappings and distinguishes occupancy from a named person', () => {
    const result = buildPresence({ ...environment({ states: { ...environment().states, 'sensor.room': state('active', { room: 'bedroom' }) } }), bindings: [{ ...presence, room_source: { entity: 'sensor.room', attribute: 'room', room_map: { bedroom: 'bedroom' } } }] });
    expect(result.records[0]).toMatchObject({ roomId: 'bedroom', location: { floorId: 'upper', elevation: 3 } });
    const occupied = buildPresence({ ...environment(), bindings: [{ ...activity, signal: 'occupancy' }] }); expect(occupied.records[0].label).toContain('Occupancy reported');
  });
  it('suppresses inactive activity and displays explicit unavailable diagnostics at its selected anchor', () => {
    const clear = buildPresence({ ...environment({ states: { 'binary_sensor.motion': state('off') } }), bindings: [activity] }); expect(clear.records[0].shown).toBe(false);
    const unknown = buildPresence({ ...environment({ states: { 'binary_sensor.motion': state('unavailable') } }), bindings: [activity] }); expect(unknown.records[0]).toMatchObject({ status: 'unavailable', active: false, shown: true }); expect(unknown.records[0].label).toContain('unavailable');
  });
  it('never uses restored primary, room-source or associated identity states as a current person location', () => {
    for (const entity of ['person.taylor', 'sensor.room']) {
      const states = { ...environment().states, [entity]: { ...environment().states[entity], attributes: { ...environment().states[entity].attributes, restored: true } } };
      const result = buildPresence({ ...environment({ states }), bindings: [presence, { ...presence, id: 'associated', entity: 'sensor.room', identity_entity: 'person.taylor' }] });
      expect(result.records.every((r) => !r.active && !r.shown && !r.location)).toBe(true);
    }
  });
  it.each([null, false, 0, '', []])('does not erase an explicitly malformed presence freshness setting: %j', (freshness) => {
    const result = buildPresence({ ...environment(), bindings: [{ ...presence, freshness }] });
    expect(result.records[0]).toMatchObject({ active: false, shown: false, status: 'invalid', location: null });
  });
});

describe('parked vehicle evidence', () => {
  it('keeps a maintained parked state current even when last_changed is years old', () => {
    const result = buildVehicles({ ...environment(), bindings: [vehicle] }); expect(result.records[0]).toMatchObject({ active: true, shown: true, evidence: 'maintained' }); expect(result.records[0].label).toContain('Vehicle parked'); expect(result.nextExpiry).toBeNull();
  });
  it('requires an explicit vehicle-source declaration and rejects general motion even with confirmation', () => {
    for (const binding of [{ ...vehicle, vehicle_source_confirmed: false }, { ...vehicle, entity: 'binary_sensor.motion' }]) {
      const result = buildVehicles({ ...environment(), bindings: [binding] }); expect(result.records[0].active).toBe(false); expect(result.records[0].status).toBe('invalid'); expect(result.records[0].label).not.toContain(' parked');
    }
  });
  it('requires an explicit supported vehicle kind and excludes diagnostic/config sources', () => {
    for (const kind of [undefined, 'moving', null]) {
      const result = buildVehicles({ ...environment(), bindings: [{ ...vehicle, kind }] });
      expect(result.records[0]).toMatchObject({ active: false, status: 'invalid', evidence: null }); expect(result.records[0].label).not.toContain('parked');
      expect(result.diagnostics.some((d) => d.code === 'kind')).toBe(true);
    }
    for (const entity_category of ['diagnostic', 'config']) {
      const result = buildVehicles({ ...environment({ entities: { 'binary_sensor.car': { entity_category } } }), bindings: [vehicle] });
      expect(result.records[0]).toMatchObject({ active: false, shown: false, status: 'unavailable' }); expect(result.miniMap).toEqual([]);
    }
  });
  it('keeps a maintained vehicle observation generic when the plate identity is only restored', () => {
    const result = buildVehicles({ ...environment({ states: { ...environment().states, 'sensor.plate': state('ABC123', { friendly_name: 'Taylor car', restored: true }) } }),
      bindings: [{ ...vehicle, identity_entity: 'sensor.plate', identity_value: 'ABC123' }] });
    expect(result.records[0]).toMatchObject({ active: true, identity: null, label: 'Vehicle parked' });
  });
  it('shows one counted observation with its count rather than inventing several parking spaces', () => {
    const result = buildVehicles({ ...environment({ states: { 'sensor.cars': state('3') } }), bindings: [{ ...vehicle, entity: 'sensor.cars', kind: 'count' }] });
    expect(result.records).toHaveLength(1); expect(result.records[0].count).toBe(3); expect(result.records[0].label).toContain('3 reported');
  });
  it('labels event detection Seen recently with a fixed absolute deadline', () => {
    const options = environment({ states: { 'binary_sensor.car': state('detected', { observed_at: '2026-10-05T11:59:40Z', type: 'car' }) } });
    const first = buildVehicles({ ...options, bindings: [event] }); expect(first.records[0].label).toContain('seen recently'); expect(first.records[0].label).not.toContain('parked'); expect(first.nextExpiry).toBe(now + 40000);
    const again = buildVehicles({ ...options, now: now + 10000, bindings: [{ ...event, expires_seconds: 600 }], memory: first.memory }); expect(again.nextExpiry).toBe(first.nextExpiry);
    const expired = buildVehicles({ ...options, now: now + 40000, bindings: [event], memory: again.memory }); expect(expired.records[0].active).toBe(false); expect(expired.records[0].shown).toBe(false); expect(expired.nextExpiry).toBeNull();
  });
  it('cannot revive an expired event from an unrelated HA update or changed friendly_name', () => {
    const options = environment({ states: { 'binary_sensor.car': state('seen', { observed_at: '2026-10-05T11:59:00Z', type: 'car' }) } });
    const result = buildVehicles({ ...options, bindings: [event] }); expect(result.records[0].active).toBe(false);
    const next = buildVehicles({ ...options, now: now + 1, states: { 'binary_sensor.car': state('seen', { observed_at: '2026-10-05T11:59:00Z', type: 'car', friendly_name: 'New label' }) }, bindings: [event], memory: result.memory }); expect(next.records[0].active).toBe(false);
  });
  it('makes named vehicle identity depend on actual matching identity data', () => {
    const base = environment({ states: { ...environment().states, 'sensor.plate': state('ABC123', { friendly_name: 'Taylor car' }) } });
    const options = { ...vehicle, identity_entity: 'sensor.plate', identity_value: 'ABC123' };
    const matching = buildVehicles({ ...base, bindings: [options] }); expect(matching.records[0].label).toContain('Taylor car parked');
    const mismatch = buildVehicles({ ...base, bindings: [{ ...options, identity_value: 'OTHER' }] }); expect(mismatch.records[0].label).toBe('Vehicle parked'); expect(mismatch.records[0].identity).toBeNull();
    const unknown = buildVehicles({ ...base, bindings: [{ ...options, identity_value: undefined }] }); expect(unknown.records[0].label).toBe('Vehicle parked');
  });
  it('does not confirm an identity from a missing/object attribute coerced into a matching string', () => {
    for (const identity of [undefined, null, { car: 'ABC123' }, ['ABC123']]) {
      const result = buildVehicles({ ...environment({ states: { ...environment().states, 'sensor.plate': state('active', { plate: identity }) } }), bindings: [{ ...vehicle, identity_entity: 'sensor.plate', identity_attribute: 'plate', identity_value: String(identity) }] });
      expect(result.records[0].identity).toBeNull(); expect(result.records[0].label).toBe('Vehicle parked');
    }
  });
  it('labels unavailable evidence explicitly and suppresses a hidden or device-disabled source', () => {
    const unknown = buildVehicles({ ...environment({ states: { 'binary_sensor.car': state('unavailable') } }), bindings: [vehicle] }); expect(unknown.records[0]).toMatchObject({ active: false, status: 'unavailable' }); expect(unknown.records[0].label).not.toContain('parked');
    const hidden = buildVehicles({ ...environment({ entities: { 'binary_sensor.car': { hidden_by: 'user' } } }), bindings: [vehicle] }); expect(hidden.records[0].shown).toBe(false);
    const disabled = buildVehicles({ ...environment({ entities: { 'binary_sensor.car': { device_id: 'car' } }, devices: { car: { disabled_by: 'user' } } }), bindings: [vehicle] }); expect(disabled.records[0]).toMatchObject({ active: false, shown: false });
  });
});

describe('reported robot vacuum positions', () => {
  it('keeps cleaning with no XY at the actual chosen stationary anchor and explicitly labels status only', () => {
    const result = buildVacuums({ ...environment(), bindings: [vacuum] }); expect(result.records[0]).toMatchObject({ active: true, measured: false, location: { x: 2, y: 1.5 }, transitionMs: 0 }); expect(result.records[0].label).toContain('Cleaning'); expect(result.records[0].label).toContain('position not reported');
  });
  it('shows docking, paused and unavailable states without decorative movement', () => {
    for (const value of ['docked', 'paused', 'unavailable']) {
      const result = buildVacuums({ ...environment({ states: { 'vacuum.robot': state(value) } }), bindings: [vacuum] }); expect(result.records[0].active).toBe(false); expect(result.records[0].transitionMs).toBe(0); expect(result.records[0].location.x).toBe(2); expect(result.records[0].label.toLowerCase()).toContain(value);
    }
  });
  it('places actual plan-metre readings on their explicit floor and never doubles its elevation', () => {
    const result = buildVacuums({ ...environment(), bindings: [xy] }); expect(result.records[0]).toMatchObject({ measured: true, location: { x: 2, y: 3, z: .05, floorId: 'upper', elevation: 3 } }); expect(result.records[0].label).toContain('reported position');
  });
  it('applies strict calibrated source readings and preserves different vacuum IDs', () => {
    const source = { ...xy.position_source, units: undefined, plan_meters: undefined, calibration: [{ src: [0, 0], plan: [10, 20] }, { src: [10, 0], plan: [20, 20] }] };
    const result = buildVacuums({ ...environment(), bindings: [{ ...xy, position_source: source }, { ...vacuum, id: 'other' }] });
    expect(result.records[0].location).toMatchObject({ x: 12, y: 23 }); expect(new Set(result.records.map((r) => r.id)).size).toBe(2);
  });
  it.each([
    { ...xy.position_source, plan_meters: false }, { ...xy.position_source, calibration: [{ src: [0, 0], plan: [0, 0] }, { src: [0, 0], plan: [2, 2] }] },
    { ...xy.position_source, x_attr: 'missing' }, { ...xy.position_source, floorId: 'removed' },
  ])('falls back only to the chosen status anchor for invalid measured sources: %j', (source) => {
    const result = buildVacuums({ ...environment(), bindings: [{ ...xy, position_source: source }] }); expect(result.records[0].measured).toBe(false); expect(result.records[0].location).toMatchObject({ x: 2, y: 1.5, floorId: 'ground' }); expect(result.records[0].label).toContain('status at chosen anchor'); expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  it('does not draw a measured path or choose a floor when neither coordinates nor a static anchor exist', () => {
    const without = { ...xy }; delete without.roomId;
    const result = buildVacuums({ ...environment({ states: { 'vacuum.robot': state('cleaning') } }), bindings: [without] }); expect(result.records[0]).toMatchObject({ location: null, measured: false, shown: false });
  });
  it('hides stale measured readings and schedules their exact expiry when freshness is explicitly configured', () => {
    const cfg = { ...xy, position_source: { ...xy.position_source, freshness: { timestamp_mode: 'last_updated', timestamp_format: 'iso', max_age_seconds: 30 } } };
    const current = environment({ states: { 'vacuum.robot': state('cleaning', { x: 2, y: 3 }, { last_updated: '2026-10-05T11:59:50Z' }) } });
    const first = buildVacuums({ ...current, bindings: [cfg] }); expect(first.records[0].measured).toBe(true); expect(first.nextExpiry).toBe(now + 20000);
    const stale = buildVacuums({ ...current, now: now + 20000, bindings: [cfg] }); expect(stale.records[0].measured).toBe(false); expect(stale.records[0].positionStatus).toBe('stale'); expect(stale.nextExpiry).toBeNull();
  });
  it('uses actual room-level vacuum observations and never maps a generic home state to its dock room', () => {
    const cfg = { ...vacuum, kind: 'room', room_source: { entity: 'sensor.room', room_map: { lounge: 'lounge', bedroom: 'bedroom' } } };
    const result = buildVacuums({ ...environment(), bindings: [cfg] }); expect(result.records[0].roomId).toBe('lounge'); expect(result.records[0].label).toContain('room observation');
  });
  it('does not treat restored vacuum status as current activity or read stale position attributes from it', () => {
    const result = buildVacuums({ ...environment({ states: { 'vacuum.robot': state('cleaning', { restored: true, x: 80, y: 90 }) } }), bindings: [vacuum, { ...xy, id: 'measured' }] });
    expect(result.records.every((r) => !r.active && !r.measured && r.status === 'unavailable' && r.location.x === 2)).toBe(true);
    expect(result.records.every((r) => !r.label.includes('Cleaning'))).toBe(true);
  });
  it.each([null, false, 0, '', []])('preserves malformed coordinate freshness for validation instead of accepting it: %j', (freshness) => {
    const result = buildVacuums({ ...environment(), bindings: [{ ...xy, position_source: { ...xy.position_source, freshness } }] });
    expect(result.records[0]).toMatchObject({ measured: false, positionStatus: 'invalid', color: '#8d9199' }); expect(result.records[0].label).toContain('position invalid');
  });
});

describe('tracking location/visibility safety', () => {
  it('uses only a deliberately chosen marker key and its actual coordinates', () => {
    const cfg = { ...vehicle }; delete cfg.position;
    const good = buildVehicles({ ...environment(), positions: new Map([['camera-drive', { ...position, x: 20 }]]), bindings: [{ ...cfg, position_key: 'camera-drive' }] }); expect(good.records[0].location.x).toBe(20);
    const implicit = buildVehicles({ ...environment(), positions: { 'binary_sensor.car': position }, bindings: [cfg] }); expect(implicit.records[0].location).toBeNull();
  });
  it('filters hidden room outlines/floors and marker visibility without losing source diagnostics', () => {
    const hidden = buildPresence({ ...environment(), rooms: [{ ...rooms[0], shown: false }, rooms[1]], bindings: [presence] }); expect(hidden.records[0].shown).toBe(false);
    const upper = buildPresence({ ...environment(), visibleFloors: ['upper'], bindings: [presence, activity] }); expect(upper.miniMap).toEqual([]);
    const cfg = { ...vehicle }; delete cfg.position;
    const marker = buildVehicles({ ...environment(), positions: { driveway: { ...position, shown: false } }, bindings: [{ ...cfg, position_key: 'driveway' }] }); expect(marker.records[0].shown).toBe(false);
  });
  it('hides measured vacuum coordinates inside a hidden room while preserving their actual measured data', () => {
    const result = buildVacuums({ ...environment({ states: { ...environment().states, 'vacuum.robot': state('cleaning', { x: 2, y: 2 }) } }), rooms: [rooms[0], { ...rooms[1], shown: false }], bindings: [xy] });
    expect(result.records[0]).toMatchObject({ measured: true, shown: false, roomId: 'bedroom', location: { x: 2, y: 2, floorId: 'upper' } }); expect(result.miniMap).toEqual([]);
  });
  it('honours explicit floor visibility and hidden associated identity flags', () => {
    const floor = buildVehicles({ ...environment(), floors: [{ ...floors[0], hidden: true }, floors[1]], bindings: [vehicle] }); expect(floor.records[0].shown).toBe(false);
    const hidden = buildPresence({ ...environment({ entities: { 'person.taylor': { hidden_by: 'user' } } }), bindings: [{ ...presence, entity: 'sensor.room', identity_entity: 'person.taylor' }] }); expect(hidden.records[0]).toMatchObject({ active: false, shown: false, identity: null, status: 'unavailable' });
  });
  it('handles missing/invalid binding lists, time, source fields and styles without fabricated output', () => {
    expect(buildTrackedEntities({}).records).toEqual([]);
    expect(buildVehicles({ ...environment(), now: NaN, bindings: [vehicle] }).records).toEqual([]);
    expect(buildPresence({ ...environment(), bindings: [{ ...presence, room_source: null }] }).records[0].status).toBe('invalid');
    expect(buildVehicles({ ...environment(), bindings: [{ ...vehicle, color: 'blue', size: Infinity }] }).records[0].shown).toBe(false);
  });
  it.each([null, { x: NaN, y: 2, floorId: 'ground' }, { x: 1, y: Infinity, floorId: 'ground' }, { x: 1, y: 2 }, { x: 1, y: 2, floorId: 'removed' }])('rejects invalid or unmapped explicit positions: %j', (position) => {
    const result = buildVehicles({ ...environment(), bindings: [{ ...vehicle, position }] }); expect(result.records[0].location).toBeNull(); expect(result.records[0].shown).toBe(false); expect(result.diagnostics.some((d) => d.code === 'anchor')).toBe(true);
  });
  it('rejects conflicting anchors and duplicate floor/room IDs rather than selecting an arbitrary one', () => {
    const conflict = buildVehicles({ ...environment(), bindings: [{ ...vehicle, roomId: 'lounge' }] }); expect(conflict.records[0].location).toBeNull();
    const floor = buildVehicles({ ...environment(), floors: [...floors, { id: 'ground', elevation: 8 }], bindings: [vehicle] }); expect(floor.records[0].location).toBeNull();
    const room = buildPresence({ ...environment(), rooms: [...rooms, { ...rooms[0] }], bindings: [presence] }); expect(room.records[0].location).toBeNull();
  });
  it('chooses an interior room symbol even for a concave polygon', () => {
    const polygon = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
    const result = buildPresence({ ...environment(), rooms: [{ ...rooms[0], room: { ...rooms[0].room, polygon } }], bindings: [activity] });
    const p = result.records[0].location; expect(p.x <= 1 || p.y <= 1).toBe(true); expect(p.x >= 0 && p.y >= 0).toBe(true);
  });
  it('rejects all duplicated IDs and ignores disabled settings with no hidden arbitrary priority', () => {
    const result = buildVehicles({ ...environment(), bindings: [vehicle, { ...vehicle }, { ...vehicle, id: 'disabled', enabled: false }] }); expect(result.records).toEqual([]); expect(result.diagnostics).toHaveLength(2);
  });
  it('aggregates independent layers without ID collisions and leaves source states/config untouched', () => {
    const options = { ...environment(), presence_bindings: [activity], vehicle_bindings: [vehicle], vacuum_bindings: [vacuum] }, before = JSON.stringify(options);
    const result = buildTrackedEntities(options); expect(result.records).toHaveLength(3); expect(new Set(result.records.map((r) => r.id)).size).toBe(3); expect(result.miniMap).toHaveLength(3); expect(JSON.stringify(options)).toBe(before); expect(result.nextExpiry).toBeNull();
  });
});

describe('existing-scene tracked entity adapter', () => {
  const record = (patch = {}) => ({ id: 'vacuum:robot', kind: 'vacuum', entity: 'vacuum.robot', shown: true, active: true, measured: true,
    label: 'Robot: Cleaning · reported position', icon: 'mdi:robot-vacuum', color: '#57b990', size: 1, heading: null, location: { x: 2, y: 3, z: .05, elevation: 3, floorId: 'upper' }, ...patch });
  function setup(options = {}) { const scene = new Scene(), invalidate = vi.fn(), layer = new TrackedEntitiesLayer(scene, { onInvalidate: invalidate, ...options }); return { scene, layer, invalidate }; }
  it('converts north to -Z once, labels accessibly and prevents helper geometry picking', () => {
    const { layer, scene } = setup(); layer.setData({ records: [record()] }); const part = layer.parts.get('vacuum:robot');
    expect(part.group.position.toArray()).toEqual([2, 3.05, -3]); expect(part.group.userData.floorId).toBe('upper'); expect(scene.children).toContain(layer.group);
    expect(part.label.element.getAttribute('role')).toBe('status'); expect(part.label.element.textContent).toContain('reported position'); expect(part.mesh.userData.helper).toBe(true); expect(part.mesh.raycast()).toBeUndefined(); layer.dispose();
  });
  it('does not render or recreate geometry/material/label for cloned unchanged data or diagnostics-only changes', () => {
    const { layer, invalidate } = setup(), data = { records: [record()] }; expect(layer.setData(data)).toBe(true);
    const part = layer.parts.get('vacuum:robot'), geometry = part.mesh.geometry, material = part.material, label = part.label; invalidate.mockClear();
    expect(layer.setData(JSON.parse(JSON.stringify(data)))).toBe(false); expect(layer.setData({ records: [{ ...record(), diagnostics: ['Changed unrelated metadata'] }] })).toBe(false);
    expect(layer.parts.get('vacuum:robot').mesh.geometry).toBe(geometry); expect(layer.parts.get('vacuum:robot').material).toBe(material); expect(layer.parts.get('vacuum:robot').label).toBe(label); expect(invalidate).not.toHaveBeenCalled(); expect(layer.update(100)).toBe(false); layer.dispose();
  });
  it('reuses geometry and updates actual position, label, heading and colour when they change', () => {
    const { layer, invalidate } = setup(); layer.setData({ records: [record()] }); const part = layer.parts.get('vacuum:robot'), geometry = part.mesh.geometry;
    expect(layer.setData({ records: [record({ location: { ...record().location, x: 5 }, color: '#ff0000', label: 'Robot: Paused', heading: 90 })] })).toBe(true);
    expect(part.group.position.x).toBe(5); expect(part.group.rotation.y).toBeCloseTo(-Math.PI / 2); expect(part.mesh.geometry).toBe(geometry); expect(part.material.color.getHexString()).toBe('ff0000'); expect(part.label.element.textContent).toContain('Paused'); expect(invalidate).toHaveBeenCalledTimes(2); layer.dispose();
  });
  it('interpolates only between measured observations, ends at the reported target and never extrapolates', () => {
    const { layer } = setup(); layer.setData({ records: [record()], now: 0 });
    const next = record({ location: { ...record().location, x: 6 }, transitionMs: 1000 }); layer.setData({ records: [next], now: 100 });
    const part = layer.parts.get('vacuum:robot'); expect(part.group.position.x).toBe(2); expect(layer.update(600)).toBe(true); expect(part.group.position.x).toBe(4);
    layer.setData({ records: [JSON.parse(JSON.stringify(next))], now: 650 }); expect(layer.update(1100)).toBe(true); expect(part.group.position.x).toBe(6); expect(layer.update(9999)).toBe(false); expect(part.group.position.x).toBe(6); layer.dispose();
  });
  it('snaps measured floor changes and reduced-motion targets instead of animating invented cross-floor routes', () => {
    const { layer } = setup(); layer.setData({ records: [record()], now: 0 });
    layer.setData({ records: [record({ transitionMs: 1000, location: { ...record().location, x: 6, floorId: 'ground', elevation: 0 } })], now: 100 }); expect(layer.parts.get('vacuum:robot').moving).toBeNull();
    const next = record({ transitionMs: 1000, location: { ...record().location, x: 8, floorId: 'ground', elevation: 0 } }); layer.setData({ records: [next], now: 200 }); expect(layer.parts.get('vacuum:robot').moving).not.toBeNull();
    expect(layer.setData({ records: [next], now: 250, reducedMotion: true })).toBe(true); expect(layer.parts.get('vacuum:robot').group.position.x).toBe(8); expect(layer.update(1000)).toBe(false); layer.dispose();
  });
  it('never animates a cleaning-only static marker or a person/activity/car symbol', () => {
    const { layer } = setup(); layer.setData({ records: [record({ measured: false })] });
    layer.setData({ records: [record({ measured: false, transitionMs: 1000, location: { ...record().location, x: 9 } })] }); expect(layer.update(100)).toBe(false); expect(layer.parts.get('vacuum:robot').group.position.x).toBe(9); layer.dispose();
  });
  it('snaps a fresh measured reading after a stale fixed anchor rather than inventing travel from that anchor', () => {
    const { layer } = setup(); layer.setData({ records: [record({ measured: false, location: { ...record().location, x: 9 } })], now: 0 });
    layer.setData({ records: [record({ measured: true, transitionMs: 1000, location: { ...record().location, x: 3 } })], now: 100 });
    expect(layer.parts.get('vacuum:robot').moving).toBeNull(); expect(layer.parts.get('vacuum:robot').group.position.x).toBe(3); expect(layer.update(600)).toBe(false); layer.dispose();
  });
  it.each([{ measured: false, transitionMs: 0 }, { active: false, transitionMs: 0 }, { entity: 'vacuum.replacement' }])('cancels an existing tween when evidence/activity/device changes at an unchanged target: %j', (patch) => {
    const { layer } = setup(); layer.setData({ records: [record()], now: 0 });
    const target = record({ transitionMs: 1000, location: { ...record().location, x: 6 } }); layer.setData({ records: [target], now: 100 }); layer.update(600);
    expect(layer.parts.get('vacuum:robot').group.position.x).toBe(4); layer.setData({ records: [{ ...target, ...patch }], now: 600 });
    expect(layer.parts.get('vacuum:robot').moving).toBeNull(); expect(layer.parts.get('vacuum:robot').group.position.x).toBe(6); expect(layer.update(900)).toBe(false); layer.dispose();
  });
  it('shares generic symbol geometries, disposes owned materials/labels once and keeps hidden updates idle', () => {
    const { layer, invalidate } = setup(); layer.setData({ records: [record(), record({ id: 'vacuum:other' })] });
    const a = layer.parts.get('vacuum:robot'), b = layer.parts.get('vacuum:other'); expect(a.mesh.geometry).toBe(b.mesh.geometry);
    const geometryDispose = vi.spyOn(a.mesh.geometry, 'dispose'), materialDispose = vi.spyOn(a.material, 'dispose'), labelRemove = vi.spyOn(a.label.element, 'remove');
    layer.setVisible(false); invalidate.mockClear(); layer.setData({ records: [record({ location: { ...record().location, x: 8 } }), record({ id: 'vacuum:other' })] }); expect(invalidate).not.toHaveBeenCalled(); expect(a.label.element.hidden).toBe(true); expect(layer.update(100)).toBe(false);
    expect(layer.setVisible(true)).toBe(true); expect(a.label.element.hidden).toBe(false); layer.dispose(); layer.dispose(); expect(materialDispose).toHaveBeenCalledTimes(1); expect(geometryDispose).toHaveBeenCalledTimes(1); expect(labelRemove).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid/duplicate records and removes a hidden actor with owned label/material cleanup', () => {
    const { layer } = setup(); expect(layer.setData({ records: [record({ location: { ...record().location, x: NaN } }), record({ id: 'bad', location: { ...record().location, floorId: null } })] })).toBe(false);
    expect(layer.setData({ records: [record(), record()] })).toBe(false); layer.setData({ records: [record()] }); const part = layer.parts.get('vacuum:robot'), dispose = vi.spyOn(part.material, 'dispose');
    expect(layer.setData({ records: [record({ shown: false })] })).toBe(true); expect(layer.parts.size).toBe(0); expect(dispose).toHaveBeenCalledTimes(1); layer.dispose();
  });
  it('works without DOM labels, keeps empty/off data idle and disposes only its own scene group', () => {
    const scene = new Scene(), other = new Scene(); scene.add(other); const invalidate = vi.fn(), layer = new TrackedEntitiesLayer(scene, { document: null, onInvalidate: invalidate });
    expect(layer.setData()).toBe(false); expect(layer.setVisible(false)).toBe(false); expect(invalidate).not.toHaveBeenCalled();
    layer.setData({ records: [record({ kind: 'vehicle', id: 'vehicle:drive' })] }); expect(layer.parts.get('vehicle:drive').label).toBeNull(); layer.dispose(); expect(scene.children).toEqual([other]); expect(layer.setData({ records: [record()] })).toBe(false);
  });
  it('offers a deliberate 44px entity-options button and stops scene gestures without services', () => {
    const onSelect = vi.fn(), callService = vi.fn(), { layer } = setup({ onSelect }); layer.setData({ records: [record()] });
    const button = layer.parts.get('vacuum:robot').label.element, container = document.createElement('div'); document.body.append(container); container.append(button);
    const pointer = vi.fn(), click = vi.fn(); container.addEventListener('pointerdown', pointer); container.addEventListener('click', click);
    expect(button.tagName).toBe('BUTTON'); expect(button.type).toBe('button'); expect(button.dataset.taylors3dUi).toBe('tracking');
    expect(button.dataset.trackingId).toBe('vacuum:robot');
    expect(button.style.minHeight).toBe('44px'); expect(button.style.minWidth).toBe('44px'); expect(button.style.pointerEvents).toBe('auto');
    expect(button.getAttribute('aria-label')).toBe('Open options for Robot: Cleaning · reported position');
    button.dispatchEvent(new Event('pointerdown', { bubbles: true })); button.click();
    expect(pointer).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled(); expect(onSelect).toHaveBeenCalledExactlyOnceWith('vacuum:robot'); expect(callService).not.toHaveBeenCalled();
    expect(layer.parts.get('vacuum:robot').mesh.raycast()).toBeUndefined(); layer.dispose(); container.remove();
  });
  it('preserves the actual focused button while current entity, label and measured position update', () => {
    const onSelect = vi.fn(), { layer, invalidate } = setup({ onSelect }); layer.setData({ records: [record()] });
    const part = layer.parts.get('vacuum:robot'), button = part.label.element; document.body.append(button); button.focus(); invalidate.mockClear();
    expect(layer.setData({ records: [JSON.parse(JSON.stringify(record()))] })).toBe(false); expect(document.activeElement).toBe(button); expect(invalidate).not.toHaveBeenCalled();
    layer.setData({ records: [record({ entity: 'vacuum.replacement', label: 'Replacement: Paused', location: { ...record().location, x: 5 } })] });
    expect(part.label.element).toBe(button); expect(document.activeElement).toBe(button); expect(button.getAttribute('aria-label')).toBe('Open options for Replacement: Paused');
    expect(part.group.userData.entity).toBe('vacuum.replacement'); button.click(); expect(onSelect).toHaveBeenCalledExactlyOnceWith('vacuum:robot'); layer.dispose();
  });
  it('retains native Enter/Space activation and returns focus on Escape', () => {
    const opener = document.createElement('button'); document.body.append(opener);
    const onSelect = vi.fn(), { layer } = setup({ onSelect, returnFocus: () => opener }); layer.setData({ records: [record()] });
    const button = layer.parts.get('vacuum:robot').label.element; document.body.append(button); button.focus();
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); button.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    // Real browsers generate the native button click for Enter/Space; the adapter adds no duplicate synthetic action.
    expect(onSelect).not.toHaveBeenCalled(); button.click(); expect(onSelect).toHaveBeenCalledOnce();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); button.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true); expect(document.activeElement).toBe(opener); expect(onSelect).toHaveBeenCalledOnce(); layer.dispose(); opener.remove();
  });
  it('returns focused actors to the opener on hiding, removal and disposal without stealing outside focus', () => {
    const opener = document.createElement('button'), outside = document.createElement('button'); document.body.append(opener, outside);
    const onSelect = vi.fn(), { layer } = setup({ onSelect, returnFocus: opener }); layer.setData({ records: [record()] });
    let button = layer.parts.get('vacuum:robot').label.element; document.body.append(button); button.focus();
    layer.setVisible(false); expect(document.activeElement).toBe(opener); button.click(); expect(onSelect).not.toHaveBeenCalled();
    layer.setVisible(true); button.focus(); layer.setData({ records: [] }); expect(document.activeElement).toBe(opener);
    layer.setData({ records: [record()] }); button = layer.parts.get('vacuum:robot').label.element; document.body.append(button); button.focus(); layer.dispose(); expect(document.activeElement).toBe(opener);
    const other = setup({ onSelect, returnFocus: opener }).layer; other.setData({ records: [record()] }); document.body.append(other.parts.get('vacuum:robot').label.element); outside.focus(); other.setVisible(false); other.dispose(); expect(document.activeElement).toBe(outside);
    opener.remove(); outside.remove();
  });
  it('removes button listeners and leaves an existing parent focus target usable without an explicit opener', () => {
    const onSelect = vi.fn(), { layer } = setup({ onSelect }); layer.setData({ records: [record()] });
    const part = layer.parts.get('vacuum:robot'), button = part.label.element, container = document.createElement('div'); document.body.append(container); container.append(button); button.focus();
    layer.setData({ records: [] }); expect(document.activeElement).toBe(container); expect(container.getAttribute('tabindex')).toBe('-1'); expect(part.listeners).toEqual([]);
    const propagated = vi.fn(); container.addEventListener('click', propagated); container.append(button); button.click();
    expect(onSelect).not.toHaveBeenCalled(); expect(propagated).toHaveBeenCalledOnce(); layer.dispose(); button.click(); expect(onSelect).not.toHaveBeenCalled(); container.remove();
  });
  it('keeps editor previews read-only and restores the same button when selection is enabled', () => {
    const opener = document.createElement('button'); document.body.append(opener);
    const onSelect = vi.fn(), { layer } = setup({ onSelect, returnFocus: opener }); layer.setData({ records: [record()] });
    const button = layer.parts.get('vacuum:robot').label.element; document.body.append(button); button.focus();
    expect(layer.setData({ records: [record()], selectable: false })).toBe(true); expect(document.activeElement).toBe(opener); expect(button.disabled).toBe(true);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(onSelect).not.toHaveBeenCalled();
    expect(layer.setData({ records: [record()], selectable: false })).toBe(false);
    expect(layer.setData({ records: [record()], selectable: true })).toBe(true); expect(layer.parts.get('vacuum:robot').label.element).toBe(button);
    expect(button.disabled).toBe(false); button.click(); expect(onSelect).toHaveBeenCalledExactlyOnceWith('vacuum:robot'); layer.dispose(); opener.remove();
  });
  it('keeps full evidence accessible while capping scene buttons above ordinary sensor hit targets', () => {
    const { layer, scene } = setup({ onSelect: vi.fn() }); layer.setData({ records: [record()] });
    const part = layer.parts.get('vacuum:robot'), button = part.label.element, ordinary = new CSS2DObject(document.createElement('button'));
    ordinary.position.copy(part.group.position); ordinary.position.y += 2; scene.add(ordinary);
    const camera = new PerspectiveCamera(35, 1, .1, 100); camera.position.set(0, 10, 10); camera.lookAt(0, 0, 0);
    const renderer = new CSS2DRenderer(); renderer.setSize(600, 500); renderer.render(scene, camera);
    expect(Number(button.style.zIndex)).toBeGreaterThan(Number(ordinary.element.style.zIndex));
    expect(button.style.maxWidth).toBe('200px'); expect(button.style.minHeight).toBe('44px'); expect(button.style.boxSizing).toBe('border-box');
    expect(button.querySelector('span').style.textOverflow).toBe('ellipsis'); expect(button.title).toBe(record().label); expect(button.getAttribute('aria-label')).toContain('reported position');
    layer.dispose(); ordinary.removeFromParent(); ordinary.element.remove(); renderer.domElement.remove();
  });
  it('stacks co-located labels deterministically with screen margins without moving either real glyph', () => {
    const onSelect = vi.fn(), { layer, invalidate } = setup({ onSelect });
    const person = record({ id: 'presence:taylor', kind: 'presence', entity: 'person.taylor', label: 'Taylor: Lounge (room observation)' });
    const motion = record({ id: 'activity:motion', kind: 'activity', entity: 'binary_sensor.motion', label: 'Lounge: Room activity' });
    layer.setData({ records: [person, motion] });
    const a = layer.parts.get(person.id), b = layer.parts.get(motion.id), button = a.label.element; document.body.append(button); button.focus();
    expect(a.group.position.toArray()).toEqual(b.group.position.toArray()); expect(a.group.position.toArray()).toEqual([2, 3.05, -3]);
    expect(a.label.element.style.marginTop).toBe('-48px'); expect(b.label.element.style.marginTop).toBe('0px');
    invalidate.mockClear(); expect(layer.setData({ records: [motion, person] })).toBe(false); expect(invalidate).not.toHaveBeenCalled(); expect(document.activeElement).toBe(button);
    expect(layer.setData({ records: [person] })).toBe(true); expect(a.label.element).toBe(button); expect(a.label.element.style.marginTop).toBe('0px'); expect(document.activeElement).toBe(button);
    layer.dispose();
  });
  it('provides a reusable car silhouette with a raised cabin and four ground-contact wheels, then releases its geometry once', () => {
    const { layer } = setup(), car = record({ id: 'vehicle:one', kind: 'vehicle', entity: 'binary_sensor.car', measured: false, heading: 90 });
    layer.setData({ records: [car, { ...car, id: 'vehicle:two' }] });
    const a = layer.parts.get(car.id), b = layer.parts.get('vehicle:two'), geometry = a.mesh.geometry; geometry.computeBoundingBox();
    expect(a.mesh.isMesh).toBe(true); expect(geometry).toBe(b.mesh.geometry);
    expect(geometry.boundingBox.max.y).toBeGreaterThan(1); expect(geometry.boundingBox.max.z - geometry.boundingBox.min.z).toBeGreaterThan(3);
    const vertices = geometry.getAttribute('position'), contacts = new Set();
    for (let i = 0; i < vertices.count; i++) if (vertices.getY(i) < .04) contacts.add(`${Math.sign(vertices.getX(i))},${Math.sign(vertices.getZ(i))}`);
    expect(contacts).toEqual(new Set(['-1,-1', '-1,1', '1,-1', '1,1']));
    expect(a.group.rotation.y).toBeCloseTo(-Math.PI / 2); expect(a.group.position.toArray()).toEqual([2, 3.05, -3]);
    expect(a.mesh.castShadow).toBe(false); const dispose = vi.spyOn(geometry, 'dispose'); layer.dispose(); layer.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });
  function labelRect(el, { left, top, width = 180, height = 44 }) {
    el.getBoundingClientRect = () => {
      const x = left + (Number.parseFloat(el.style.marginLeft) || 0), y = top + (Number.parseFloat(el.style.marginTop) || 0);
      return { left: x, top: y, right: x + width, bottom: y + height, width, height };
    };
    document.body.append(el);
  }
  const separate = (a, b) => a.right + 4 <= b.left || b.right + 4 <= a.left || a.bottom + 4 <= b.top || b.bottom + 4 <= a.top;
  it('separates nearby projected buttons, preserving glyph positions, focus, evidence and idle semantic updates', () => {
    const { layer, invalidate } = setup({ onSelect: vi.fn() }), person = record({ id: 'presence:taylor', kind: 'presence', entity: 'person.taylor', label: 'Taylor: Lounge (room observation)', location: { ...record().location, x: 3 } });
    const data = { records: [record(), person] }; layer.setData(data);
    const vacuum = layer.parts.get('vacuum:robot'), presencePart = layer.parts.get('presence:taylor'), before = vacuum.group.position.toArray();
    labelRect(vacuum.label.element, { left: 100, top: 100 }); labelRect(presencePart.label.element, { left: 120, top: 90, width: 160 }); vacuum.label.element.focus();
    invalidate.mockClear(); const bounds = { left: 0, top: 0, right: 400, bottom: 250 };
    expect(layer.arrangeScreenLabels(bounds)).toBe(true);
    expect(separate(vacuum.label.element.getBoundingClientRect(), presencePart.label.element.getBoundingClientRect())).toBe(true);
    expect(vacuum.group.position.toArray()).toEqual(before); expect(document.activeElement).toBe(vacuum.label.element);
    expect(vacuum.label.element.title).toBe(record().label); expect(vacuum.label.element.getAttribute('aria-label')).toContain('reported position');
    const margin = vacuum.label.element.style.marginTop; expect(layer.arrangeScreenLabels(bounds)).toBe(false);
    expect(layer.setData(JSON.parse(JSON.stringify(data)))).toBe(false); expect(vacuum.label.element.style.marginTop).toBe(margin);
    expect(layer.arrangeScreenLabels(bounds)).toBe(false); expect(invalidate).not.toHaveBeenCalled(); expect(layer.update(100)).toBe(false); layer.dispose();
  });
  it('recovers original projections from existing margins and fits multiple 44px targets inside scene edges deterministically', () => {
    const { layer } = setup({ onSelect: vi.fn() }); const records = [
      record({ id: 'presence:taylor', kind: 'presence' }), record({ id: 'activity:motion', kind: 'activity' }), record(),
    ]; layer.setData({ records });
    for (const part of layer.parts.values()) labelRect(part.label.element, { left: 90, top: 100 });
    const bounds = { left: 100, top: 80, width: 200, height: 180 }; expect(layer.arrangeScreenLabels(bounds)).toBe(true);
    const rectangles = [...layer.parts.values()].map((p) => p.label.element.getBoundingClientRect());
    for (const rect of rectangles) { expect(rect.left).toBeGreaterThanOrEqual(100); expect(rect.right).toBeLessThanOrEqual(300); expect(rect.top).toBeGreaterThanOrEqual(80); expect(rect.bottom).toBeLessThanOrEqual(260); }
    for (let a = 0; a < rectangles.length; a++) for (let b = a + 1; b < rectangles.length; b++) expect(separate(rectangles[a], rectangles[b])).toBe(true);
    const offsets = [...layer.parts].map(([id, p]) => [id, p.label.element.style.marginTop]);
    expect(layer.setData({ records: [...records].reverse() })).toBe(false); expect(layer.arrangeScreenLabels(bounds)).toBe(false);
    expect([...layer.parts].map(([id, p]) => [id, p.label.element.style.marginTop])).toEqual(offsets); expect(layer.screenLabelOverlaps).toEqual([]); layer.dispose();
  });
  it('excludes hidden, disconnected and offscreen controls and removes stale UI offsets from offscreen projections', () => {
    const { layer } = setup({ onSelect: vi.fn() }); layer.setData({ records: [record(), record({ id: 'vacuum:hidden' }), record({ id: 'vacuum:offscreen' }), record({ id: 'vacuum:detached' })] });
    const shown = layer.parts.get('vacuum:robot').label.element, hidden = layer.parts.get('vacuum:hidden').label.element, offscreen = layer.parts.get('vacuum:offscreen').label.element;
    labelRect(shown, { left: 40, top: 60 }); labelRect(hidden, { left: 40, top: 60 }); hidden.style.display = 'none';
    labelRect(offscreen, { left: 600, top: 60 }); offscreen.style.marginLeft = '-400px'; offscreen.style.marginTop = '-48px';
    layer.arrangeScreenLabels({ left: 0, top: 0, right: 400, bottom: 300 });
    expect(shown.style.marginTop).toBe('0px'); expect(offscreen.style.marginLeft).toBe('0px'); expect(offscreen.style.marginTop).toBe('0px'); expect(layer.screenLabelOverlaps).toEqual([]);
    layer.dispose();
  });
  it('reports an infeasibly dense scene without removing observations or changing their physical positions', () => {
    const { layer, invalidate } = setup({ onSelect: vi.fn() }); layer.setData({ records: [record(), record({ id: 'vacuum:second' })] });
    for (const part of layer.parts.values()) labelRect(part.label.element, { left: 10, top: 20, width: 100 });
    invalidate.mockClear(); layer.arrangeScreenLabels({ left: 0, top: 0, right: 140, bottom: 65 });
    expect(layer.screenLabelOverlaps).toEqual(['vacuum:second']); expect(layer.parts.size).toBe(2);
    for (const part of layer.parts.values()) { expect(part.group.position.toArray()).toEqual([2, 3.05, -3]); expect(part.label.element.style.minHeight).toBe('44px'); }
    expect(layer.arrangeScreenLabels({ left: 0, top: 0, right: 140, bottom: 65 })).toBe(false); expect(invalidate).not.toHaveBeenCalled(); layer.dispose();
  });
  it('ignores invalid scene bounds and makes no CSS arrangement changes after disposal or while hidden', () => {
    const { layer } = setup({ onSelect: vi.fn() }); layer.setData({ records: [record()] });
    const button = layer.parts.get('vacuum:robot').label.element; labelRect(button, { left: 10, top: 20 }); const css = button.style.cssText;
    expect(layer.arrangeScreenLabels({ left: NaN, top: 0, width: 400, height: 300 })).toBe(false); expect(button.style.cssText).toBe(css);
    layer.setVisible(false); expect(layer.arrangeScreenLabels({ left: 0, top: 0, width: 400, height: 300 })).toBe(false); layer.dispose(); expect(layer.arrangeScreenLabels({ left: 0, top: 0, width: 400, height: 300 })).toBe(false);
  });
});
