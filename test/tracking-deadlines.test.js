// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readDetection } from '../src/tracked-source.js';
import { buildVacuums } from '../src/tracked-entities.js';

const epoch = Date.parse('2026-10-05T12:00:00Z');
const iso = (at) => new Date(at).toISOString();
const source = { state: iso(epoch), attributes: { event_type: 'vehicle', heartbeat: iso(epoch) } };
const binding = { id: 'driveway', entity: 'event.vehicle', kind: 'event', timestamp_mode: 'state',
  expires_seconds: 60, event_types: ['vehicle'], vehicle_source_confirmed: true,
  freshness: { timestamp_mode: 'attribute', timestamp_attr: 'heartbeat', max_age_seconds: 5 },
  position: { x: 10, y: 4, z: .1, floorId: 'ground' } };

beforeAll(async () => { await import('../src/taylors3d-card.js'); });
afterEach(() => { delete window.__demoNow; vi.useRealTimers(); });

describe('combined event and source freshness deadlines', () => {
  it('requests the earlier heartbeat deadline without changing the immutable event expiry', () => {
    const first = readDetection(source, binding, epoch);
    expect(first).toMatchObject({ active: true, expiresAt: epoch + 60000, nextExpiry: epoch + 5000 });
    const memory = Object.freeze(first.memory);
    const stale = readDetection(source, binding, epoch + 5000, memory);
    expect(stale).toMatchObject({ active: false, status: 'stale', nextExpiry: null });
    expect(stale.memory).toEqual(memory); expect(memory.expiresAt).toBe(epoch + 60000);
    const refreshed = { ...source, attributes: { ...source.attributes, heartbeat: iso(epoch + 6000) } };
    const replay = readDetection(refreshed, { ...binding, expires_seconds: 120 }, epoch + 6000, memory);
    expect(replay).toMatchObject({ active: true, expiresAt: epoch + 60000, nextExpiry: epoch + 11000 });
    expect(replay.memory).toEqual(memory);
  });

  it('still expires a short sighting before a longer heartbeat rule', () => {
    const reading = readDetection(source, { ...binding, expires_seconds: 2 }, epoch);
    expect(reading).toMatchObject({ active: true, expiresAt: epoch + 2000, nextExpiry: epoch + 2000 });
    expect(readDetection(source, { ...binding, expires_seconds: 2 }, epoch + 2000, reading.memory))
      .toMatchObject({ active: false, status: 'clear', nextExpiry: epoch + 5000 });
    expect(readDetection(source, { ...binding, expires_seconds: 2 }, epoch + 5000, reading.memory))
      .toMatchObject({ active: false, status: 'stale', nextExpiry: null });
  });

  it('refreshes the real card at source staleness without another HA update', () => {
    vi.useFakeTimers(); vi.setSystemTime(epoch); delete window.__demoNow;
    const card = document.createElement('taylors3d-card');
    Object.defineProperty(card, 'isConnected', { value: true });
    card._config = {}; card._layout = { vehicle_bindings: [binding] };
    card._floors = [{ id: 'ground', elevation: 0 }]; card._roomList = [];
    card._navigationFloors = () => 'all'; card._navigationRooms = () => [];
    card._hass = { states: { 'event.vehicle': source }, entities: {}, callService: vi.fn() };
    card._view = { floorElevation: () => 0, _cutAway: () => false };
    card._trackingLayer = { setData: vi.fn(), setVisible: vi.fn() };
    card._syncMiniMap = vi.fn();
    try {
      card._syncTracking(); expect(card._trackingData.records[0].active).toBe(true);
      expect(card._trackingDeadline).toBe(epoch + 5000); expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(5000);
      expect(card._trackingData.records[0]).toMatchObject({ active: false, status: 'stale', color: '#8d9199' });
      expect(card._trackingTimer).toBeNull(); expect(vi.getTimerCount()).toBe(0);
      expect(card._trackingMemory.vehicles.driveway.expiresAt).toBe(epoch + 60000);
      expect(card._syncMiniMap).toHaveBeenCalledTimes(1); expect(card._hass.callService).not.toHaveBeenCalled();
    } finally { card._clearTrackingTimer(); }
  });
});

describe('independent vacuum status and position freshness', () => {
  const heartbeat = (seconds) => ({ timestamp_mode: 'attribute', timestamp_attr: 'heartbeat', max_age_seconds: seconds });
  const vacuumSource = { state: 'cleaning', attributes: { heartbeat: iso(epoch) } };
  const positionSource = { state: 'position', attributes: { x: 4, y: 6, heartbeat: iso(epoch) } };
  const vacuum = { id: 'robot', entity: 'vacuum.robot', kind: 'xy', interpolate_ms: 1000,
    freshness: heartbeat(5), position: { x: 1, y: 2, z: .1, floorId: 'ground' },
    position_source: { entity: 'sensor.position', source: 'xy', x_attr: 'x', y_attr: 'y', floorId: 'ground',
      units: 'm', plan_meters: true, freshness: heartbeat(20) } };
  const options = (patch = {}) => ({ hass: { states: { 'vacuum.robot': vacuumSource, 'sensor.position': positionSource } },
    floors: [{ id: 'ground', elevation: 0 }], bindings: [vacuum], now: epoch, ...patch });

  it('keeps fresh measured coordinates but removes cleaning confidence and animation when only status expires', () => {
    const first = buildVacuums(options());
    expect(first.records[0]).toMatchObject({ status: 'ready', active: true, measured: true, transitionMs: 1000 });
    expect(first.nextExpiry).toBe(epoch + 5000);
    const statusStale = buildVacuums(options({ now: epoch + 5000 }));
    expect(statusStale.records[0]).toMatchObject({ status: 'stale', active: false, measured: true, shown: true,
      color: '#8d9199', transitionMs: 0, location: { x: 4, y: 6 }, positionStatus: 'ready' });
    expect(statusStale.records[0].label).toContain('stale · reported position');
    expect(statusStale.records[0].label).not.toContain('Cleaning');
    expect(statusStale.nextExpiry).toBe(epoch + 20000);
    const bothStale = buildVacuums(options({ now: epoch + 20000 }));
    expect(bothStale.records[0]).toMatchObject({ status: 'stale', active: false, measured: false, positionStatus: 'stale',
      location: { x: 1, y: 2 }, color: '#8d9199', transitionMs: 0 });
    expect(bothStale.nextExpiry).toBeNull();
  });

  it('keeps current cleaning status independently when position expires to its chosen anchor', () => {
    const result = buildVacuums(options({ now: epoch + 5000, bindings: [{ ...vacuum,
      freshness: heartbeat(20), position_source: { ...vacuum.position_source, freshness: heartbeat(5) } }] }));
    expect(result.records[0]).toMatchObject({ status: 'ready', active: true, measured: false,
      location: { x: 1, y: 2 }, positionStatus: 'stale', transitionMs: 0, color: '#8d9199' });
    expect(result.records[0].label).toContain('Cleaning'); expect(result.records[0].label).toContain('position stale');
    expect(result.nextExpiry).toBe(epoch + 20000);
  });

  it.each([null, false, [], 'malformed', { max_age_seconds: 5 }])('does not trust cleaning when an explicit status rule is invalid: %j', (freshness) => {
    const result = buildVacuums(options({ bindings: [{ ...vacuum, freshness }] }));
    expect(result.records[0]).toMatchObject({ status: 'invalid', active: false, measured: true, color: '#8d9199', transitionMs: 0 });
    expect(result.records[0].label).not.toContain('Cleaning'); expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('keeps absent status freshness unverified current and refuses restored status even with valid coordinates', () => {
    const result = buildVacuums(options({ now: epoch + 86400000,
      bindings: [{ ...vacuum, freshness: undefined, position_source: { ...vacuum.position_source, freshness: undefined } }] }));
    expect(result.records[0]).toMatchObject({ status: 'ready', active: true, measured: true }); expect(result.nextExpiry).toBeNull();
    const restored = buildVacuums(options({ hass: { states: { 'vacuum.robot': { ...vacuumSource,
      attributes: { ...vacuumSource.attributes, restored: true } }, 'sensor.position': positionSource } } }));
    expect(restored.records[0]).toMatchObject({ status: 'unavailable', active: false, measured: false,
      color: '#8d9199', location: { x: 1, y: 2 }, transitionMs: 0 });
  });

  it('arms one real-card timer for each successive status and position deadline without HA updates', () => {
    vi.useFakeTimers(); vi.setSystemTime(epoch); delete window.__demoNow;
    const card = document.createElement('taylors3d-card');
    Object.defineProperty(card, 'isConnected', { value: true });
    card._config = {}; card._layout = { vacuum_bindings: [vacuum] };
    card._floors = [{ id: 'ground', elevation: 0 }]; card._roomList = [];
    card._navigationFloors = () => 'all'; card._navigationRooms = () => [];
    card._hass = { ...options().hass, callService: vi.fn() };
    card._view = { floorElevation: () => 0, _cutAway: () => false };
    card._trackingLayer = { setData: vi.fn(), setVisible: vi.fn() }; card._syncMiniMap = vi.fn();
    try {
      card._syncTracking(); expect(card._trackingDeadline).toBe(epoch + 5000); expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(5000);
      expect(card._trackingData.records[0]).toMatchObject({ status: 'stale', active: false, measured: true, transitionMs: 0 });
      expect(card._trackingDeadline).toBe(epoch + 20000); expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(15000);
      expect(card._trackingData.records[0]).toMatchObject({ active: false, measured: false, location: { x: 1, y: 2 } });
      expect(card._trackingTimer).toBeNull(); expect(vi.getTimerCount()).toBe(0);
      expect(card._hass.callService).not.toHaveBeenCalled();
    } finally { card._clearTrackingTimer(); }
  });
});

describe('tracking evidence metadata refresh', () => {
  it('re-evaluates registry device-class changes even when the state and entity name are unchanged', () => {
    const card = document.createElement('taylors3d-card');
    Object.defineProperty(card, 'isConnected', { value: true });
    card._config = {}; card._layout = { vehicle_bindings: [{ id: 'parked', entity: 'binary_sensor.car', kind: 'occupancy',
      vehicle_source_confirmed: true, position: { x: 1, y: 2, floorId: 'ground' } }] };
    card._floors = [{ id: 'ground', elevation: 0 }]; card._roomList = [];
    card._navigationFloors = () => 'all'; card._navigationRooms = () => [];
    card._hass = { states: { 'binary_sensor.car': { state: 'on', attributes: {} } },
      entities: { 'binary_sensor.car': { device_class: 'occupancy' } } };
    card._view = { floorElevation: () => 0, _cutAway: () => false };
    card._trackingLayer = { setData: vi.fn(), setVisible: vi.fn() };
    try {
      card._syncTracking(); expect(card._trackingData.records[0].active).toBe(true);
      card._hass.entities['binary_sensor.car'] = { device_class: 'motion' };
      card._syncTracking();
      expect(card._trackingData.records[0]).toMatchObject({ status: 'invalid', active: false, color: '#8d9199' });
      expect(card._trackingData.records[0].label).not.toContain(' parked');
      expect(card._trackingData.diagnostics.some((issue) => issue.code === 'vehicle_source')).toBe(true);
    } finally { card._clearTrackingTimer(); }
  });
});
