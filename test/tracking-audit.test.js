// @vitest-environment jsdom
// Independent regression cases for tracking source evidence and renderer lifecycle.
import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { readDetection, readFreshness } from '../src/tracked-source.js';
import { buildPresence, buildVehicles, buildVacuums, TrackedEntitiesLayer } from '../src/tracked-entities.js';

const now = Date.parse('2026-10-05T12:00:00Z');
const iso = (at) => new Date(at).toISOString();
const state = (value, attributes = {}, at = now) => ({ state: value, attributes, last_changed: iso(at), last_updated: iso(at) });
const floors = [{ id: 'ground', elevation: 0 }, { id: 'first', elevation: 3 }];
const rooms = [
  { room: { id: 'lounge', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }, floorId: 'ground', name: 'Lounge' },
  { room: { id: 'bedroom', polygon: [[5, 0], [9, 0], [9, 4], [5, 4]] }, floorId: 'first', name: 'Bedroom' },
];
const position = { x: 2, y: 2, z: 0, floorId: 'ground' };
const presence = { id: 'presence', entity: 'sensor.room', kind: 'room_location', identity_entity: 'person.taylor', room_source: { entity: 'sensor.room', room_map: { lounge: 'lounge', bedroom: 'bedroom' } } };
const vehicle = { id: 'car', entity: 'binary_sensor.car', kind: 'occupancy', vehicle_source_confirmed: true, position };
const vacuum = { id: 'robot', entity: 'vacuum.robot', kind: 'static', position };
function environment(states = {}, entities = {}) {
  return { hass: { states: { 'person.taylor': state('home', { friendly_name: 'Taylor' }), 'sensor.room': state('lounge'),
    'binary_sensor.car': state('on'), 'vacuum.robot': state('cleaning'), ...states }, entities, devices: {} }, floors, rooms, now };
}

describe('fresh tracking evidence audit', () => {
  it('does not treat a restored room reading as the person’s current location', () => {
    const result = buildPresence({ ...environment({ 'sensor.room': state('lounge', { restored: true }) }), bindings: [presence] });
    expect(result.records[0].active).toBe(false); expect(result.records[0].shown).toBe(false); expect(result.records[0].location).toBeNull();
  });
  it('does not show a restored vacuum cleaning state as an active current cleaning observation', () => {
    const result = buildVacuums({ ...environment({ 'vacuum.robot': state('cleaning', { restored: true }) }), bindings: [vacuum] });
    expect(result.records[0].active).toBe(false); expect(result.records[0].status).toBe('unavailable');
  });
  it('does not confirm a vehicle identity from a restored identity source', () => {
    const result = buildVehicles({ ...environment({ 'sensor.plate': state('ABC123', { restored: true, friendly_name: 'Taylor car' }) }), bindings: [{ ...vehicle, identity_entity: 'sensor.plate', identity_value: 'ABC123' }] });
    expect(result.records[0].identity).toBeNull(); expect(result.records[0].label).toBe('Vehicle parked');
  });
  it('does not turn a saved configuration/diagnostic entity into a parked vehicle observation', () => {
    const result = buildVehicles({ ...environment({}, { 'binary_sensor.car': { entity_category: 'diagnostic' } }), bindings: [vehicle] });
    expect(result.records[0].active).toBe(false); expect(result.records[0].shown).toBe(false);
  });
  it('does not turn malformed saved freshness settings into an unbounded current occupancy reading', () => {
    expect(readFreshness(state('on'), 'malformed', now).status).toBe('invalid');
    expect(readDetection(state('on'), { kind: 'occupancy', freshness: 'malformed' }, now).active).toBe(false);
  });
  it('requires a vehicle binding to declare maintained occupancy, count or event instead of guessing the mode', () => {
    const binding = { ...vehicle }; delete binding.kind;
    const result = buildVehicles({ ...environment(), bindings: [binding] });
    expect(result.records[0].status).toBe('invalid'); expect(result.records[0].active).toBe(false); expect(result.records[0].label).not.toContain(' parked');
  });
});

describe('motion cancellation audit', () => {
  const record = (patch = {}) => ({ id: 'vacuum:robot', entity: 'vacuum.robot', kind: 'vacuum', active: true, measured: true, shown: true,
    label: 'Robot: Cleaning', color: '#57b990', size: 1, transitionMs: 1000, location: { x: 2, y: 2, z: 0, floorId: 'ground', elevation: 0 }, ...patch });
  it.each([{ measured: false, transitionMs: 0 }, { active: false, transitionMs: 0 }])('cancels an in-flight vacuum tween when the same target becomes stationary: %j', (patch) => {
    const layer = new TrackedEntitiesLayer(new Scene(), { document: null });
    try {
      layer.setData({ records: [record()], now: 0 });
      const target = record({ location: { ...record().location, x: 6 } }); layer.setData({ records: [target], now: 100 }); layer.update(600);
      expect(layer.parts.get('vacuum:robot').group.position.x).toBe(4);
      layer.setData({ records: [{ ...target, ...patch }], now: 600 });
      expect(layer.parts.get('vacuum:robot').moving).toBeNull();
      expect(layer.parts.get('vacuum:robot').group.position.x).toBe(6); expect(layer.update(900)).toBe(false);
    } finally { layer.dispose(); }
  });
  it('keeps simultaneous measured vacuum samples in independent actor poses', () => {
    const layer = new TrackedEntitiesLayer(new Scene(), { document: null });
    try {
      layer.setData({ records: [record(), record({ id: 'vacuum:second', entity: 'vacuum.second', location: { ...record().location, x: 10 } })], now: 0 });
      layer.setData({ records: [record({ location: { ...record().location, x: 6 } }), record({ id: 'vacuum:second', entity: 'vacuum.second', location: { ...record().location, x: 20 } })], now: 100 });
      layer.update(600); expect(layer.parts.get('vacuum:robot').group.position.x).toBe(4); expect(layer.parts.get('vacuum:second').group.position.x).toBe(15);
      layer.update(1100); expect(layer.parts.get('vacuum:robot').group.position.x).toBe(6); expect(layer.parts.get('vacuum:second').group.position.x).toBe(20);
    } finally { layer.dispose(); }
  });
});

describe('audit controls for supported source behavior', () => {
  it('keeps sustained occupancy current until its actual clear state even with an old last-change time', () => {
    expect(readDetection(state('on', {}, now - 365 * 86400000), { kind: 'occupancy' }, now)).toMatchObject({ status: 'ready', active: true, nextExpiry: null });
    expect(readDetection(state('off'), { kind: 'occupancy' }, now)).toMatchObject({ status: 'ready', active: false, nextExpiry: null });
  });
  it('preserves an accepted event deadline after unrelated newer events, older events and ID changes at the same time', () => {
    const cfg = { kind: 'event', expires_seconds: 30, event_types: ['vehicle'], event_id_attr: 'id' };
    const start = readDetection(state(iso(now), { event_type: 'vehicle', id: 'a' }), cfg, now);
    for (const source of [state(iso(now + 1000), { event_type: 'person', id: 'b' }), state(iso(now - 1000), { event_type: 'vehicle', id: 'c' }), state(iso(now), { event_type: 'vehicle', id: 'd' })]) {
      const replay = readDetection(source, cfg, now + 1000, start.memory); expect(replay.expiresAt).toBe(now + 30000); expect(replay.memory).toEqual(start.memory);
      expect(readDetection(source, cfg, now + 30000, replay.memory).active).toBe(false);
    }
  });
  it('suppresses conflicting exact room observations rather than choosing one person location', () => {
    const result = buildPresence({ ...environment({ 'sensor.other': state('bedroom') }), bindings: [presence, { ...presence, id: 'other', room_source: { entity: 'sensor.other', room_map: { bedroom: 'bedroom' } } }] });
    expect(result.records.every((record) => record.status === 'ambiguous' && !record.shown && !record.location)).toBe(true);
  });
  it('does not use inherited room mappings or silently select an available room for a deleted mapped ID', () => {
    const inherited = Object.create({ lounge: 'lounge' });
    const result = buildPresence({ ...environment(), bindings: [{ ...presence, room_source: { entity: 'sensor.room', room_map: inherited } }] });
    expect(result.records[0].location).toBeNull();
    const missing = buildPresence({ ...environment(), bindings: [{ ...presence, room_source: { entity: 'sensor.room', room_map: { lounge: 'deleted' } } }] }); expect(missing.records[0].location).toBeNull();
  });
});
