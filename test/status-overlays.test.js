// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  aggregateMeasurements, alertPulse, alertState, buildAlerts, buildRoomOverlays, measurementPeriod,
  readMeasurement, statusColor, StatusOverlays, UNKNOWN_STATUS_COLOR,
} from '../src/status-overlays.js';

const reading = (state, unit, extra = {}) => ({ state, attributes: { unit_of_measurement: unit, ...extra } });
const floors = [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'first', name: 'First', elevation: 3 }];
const room = (id = 'kitchen', floorId = 'ground') => ({ room: { id, polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }, floorId, name: id });

describe('measurement units and periods', () => {
  it.each([['°C', '20', 20], ['°F', '68', 20], ['K', '293.15', 20]])('normalizes %s temperature to Celsius', (unit, state, expected) => {
    expect(readMeasurement({ t: reading(state, unit) }, 't', 'temperature')).toMatchObject({ status: 'ready', unit: '°C', value: expected });
  });

  it('can display Fahrenheit and Kelvin without changing the source reading', () => {
    const states = { t: reading('20', '°C') };
    expect(readMeasurement(states, 't', 'temperature', { unit: '°F' }).value).toBe(68);
    expect(readMeasurement(states, 't', 'temperature', { unit: 'K' }).value).toBe(293.15);
    expect(states.t.state).toBe('20');
  });

  it('keeps watts and kilowatts separate from energy, with lossless output conversion', () => {
    expect(readMeasurement({ p: reading('1.5', 'kW') }, 'p', 'power')).toMatchObject({ value: 1500, unit: 'W' });
    expect(readMeasurement({ p: reading('1500', 'W') }, 'p', 'power', { unit: 'kW' })).toMatchObject({ value: 1.5, unit: 'kW' });
    expect(readMeasurement({ p: reading('2', 'kWh') }, 'p', 'power').status).toBe('invalid');
    expect(readMeasurement({ p: reading('2000', 'W') }, 'p', 'energy', { period: 'day', bindingPeriod: 'day' }).status).toBe('invalid');
  });

  it('normalizes energy only with an explicitly matching period', () => {
    const states = { e: reading('1500', 'Wh') };
    expect(readMeasurement(states, 'e', 'energy', { period: 'day', bindingPeriod: 'daily' })).toMatchObject({ status: 'ready', value: 1.5, unit: 'kWh', period: 'day' });
    expect(readMeasurement({ e: reading('1.5', 'kWh', { meter_period: 'monthly' }) }, 'e', 'energy', { unit: 'Wh', period: 'month' }).value).toBe(1500);
    expect(readMeasurement(states, 'e', 'energy', { period: 'day', bindingPeriod: 'lifetime' }).diagnostics[0].code).toBe('period');
    expect(readMeasurement(states, 'e', 'energy', { period: 'day' }).status).toBe('invalid');
    expect(readMeasurement(states, 'e', 'energy', { bindingPeriod: 'day' }).status).toBe('invalid');
    expect(readMeasurement({ e: reading('2', 'kWh', { period: 'lifetime' }) }, 'e', 'energy', { period: 'day', bindingPeriod: 'day' }).status).toBe('invalid');
    expect(measurementPeriod(' WEEKLY ')).toBe('week'); expect(measurementPeriod('')).toBeNull();
  });

  it.each(['', '  ', '20 W', 'NaN', 'Infinity', null, NaN, Infinity])('rejects a nonnumeric or nonfinite reading (%s)', (state) => {
    expect(readMeasurement({ p: reading(state, 'W') }, 'p', 'power').status).toBe('invalid');
  });

  it('distinguishes an absent sensor, unavailable sensor and unsupported units', () => {
    expect(readMeasurement({}, 't', 'temperature').status).toBe('missing');
    expect(readMeasurement({ t: reading('unavailable', '°C') }, 't', 'temperature').status).toBe('unavailable');
    expect(readMeasurement({ t: reading('unknown', '°C') }, 't', 'temperature').status).toBe('unavailable');
    expect(readMeasurement({ t: reading('20', undefined) }, 't', 'temperature').status).toBe('invalid');
    expect(readMeasurement({ t: reading('-274', '°C') }, 't', 'temperature').status).toBe('invalid');
    expect(readMeasurement({ p: reading('-500', 'W') }, 'p', 'power').value).toBe(-500);
  });

  it('rejects prototype names as display units and does not resolve them as period aliases', () => {
    expect(readMeasurement({ t: reading('20', '°C') }, 't', 'temperature', { unit: '__proto__' })).toMatchObject({ status: 'invalid', value: null });
    expect(measurementPeriod('__proto__')).toBe('__proto__');
  });
});

describe('room aggregation and meter choices', () => {
  const states = { a: reading('10', '°C'), b: reading('30', '°C'), c: reading('20', '°C') };
  it('supports mean, minimum, maximum and median temperature, without summing temperatures', () => {
    const bindings = { entities: ['a', 'b', 'c'] };
    expect(aggregateMeasurements(bindings, states, {}, { mode: 'temperature' }).value).toBe(20);
    for (const [aggregation, value] of [['min', 10], ['max', 30], ['median', 20]]) expect(aggregateMeasurements({ ...bindings, aggregation }, states, {}, { mode: 'temperature' }).value).toBe(value);
    expect(aggregateMeasurements({ ...bindings, aggregation: 'sum' }, states, {}, { mode: 'temperature' }).status).toBe('invalid');
  });

  it('counts duplicate entities once and labels incomplete aggregates as partial', () => {
    const result = aggregateMeasurements({ entities: ['a', 'a', 'absent'] }, states, {}, { mode: 'temperature' });
    expect(result).toMatchObject({ value: 10, status: 'partial', requested: 2, valid: 1 });
    expect(result.diagnostics.some((d) => d.code === 'duplicate_entity')).toBe(true);
  });

  it('requires a choice between multiple power readings from the same device', () => {
    const p = { a: reading('500', 'W'), b: reading('.5', 'kW') }, registry = { a: { device_id: 'dryer' }, b: { device_id: 'dryer' } };
    const result = aggregateMeasurements({ entities: ['a', 'b'] }, p, registry, { mode: 'power' });
    expect(result).toMatchObject({ value: null, status: 'invalid' }); expect(result.diagnostics[0].choices).toEqual(['a', 'b']);
    expect(aggregateMeasurements({ entities: ['a', 'b'], independent_meters: true }, p, registry, { mode: 'power' }).value).toBe(1000);
  });

  it('uses a selected circuit total and excludes its submeter parts rather than double counting', () => {
    const p = { total: reading('1000', 'W'), dryer: reading('500', 'W'), lamp: reading('50', 'W') };
    const binding = { entities: [{ entity: 'total', group: 'laundry', role: 'total' },
      { entity: 'dryer', group: 'laundry', role: 'part' }, { entity: 'lamp', group: 'laundry', role: 'part' }] };
    const result = aggregateMeasurements(binding, p, {}, { mode: 'power' });
    expect(result).toMatchObject({ value: 1000, valid: 1, requested: 1, status: 'ready' });
    expect(result.diagnostics[0].code).toBe('parts_excluded');
    expect(aggregateMeasurements({ entities: binding.entities.slice(1) }, p, {}, { mode: 'power' }).value).toBe(550);
    p.total.state = 'unavailable';
    expect(aggregateMeasurements(binding, p, {}, { mode: 'power' })).toMatchObject({ status: 'unavailable', value: null });
  });

  it('rejects ambiguous circuit groups and safely handles invalid bindings or overflow', () => {
    const p = { a: reading('10', 'W'), b: reading('15', 'W') };
    expect(aggregateMeasurements({ entities: [{ entity: 'a', group: 'x' }, { entity: 'b', group: 'x' }] }, p, {}, { mode: 'power' }).status).toBe('invalid');
    expect(aggregateMeasurements({ entities: [null] }, p, {}, { mode: 'power' }).status).toBe('invalid');
    expect(aggregateMeasurements({ entities: [{ entity: 'a', enabled: false }] }, p, {}, { mode: 'power' }).status).toBe('missing');
    expect(aggregateMeasurements({ entities: ['a', 'b'], independent_meters: true }, { a: reading('1e308', 'W'), b: reading('1e308', 'W') }, {}, { mode: 'power' }).value).toBeNull();
  });

  it('requires an explicit non-overlap choice before adding unrelated meter readings', () => {
    const p = { a: reading('1000', 'W'), b: reading('500', 'W') };
    const missing = aggregateMeasurements({ entities: ['a', 'b'] }, p, {}, { mode: 'power' });
    expect(missing).toMatchObject({ status: 'invalid', value: null }); expect(missing.diagnostics[0].code).toBe('meter_scope');
    expect(missing.diagnostics[0].message).toContain('component meters');
    expect(aggregateMeasurements({ entities: ['a', 'b'], independent_meters: true }, p, {}, { mode: 'power' }).value).toBe(1500);
    expect(aggregateMeasurements({ entities: [{ entity: 'a', group: 'laundry' }, { entity: 'b', group: 'kitchen' }] }, p, {}, { mode: 'power' }).value).toBe(1500);
    expect(aggregateMeasurements({ entities: ['a'] }, p, {}, { mode: 'power' }).value).toBe(1000);
  });
});

describe('room overlays and legends', () => {
  it('handles malformed imported config and missing lists without throwing or inventing locations', () => {
    expect(buildRoomOverlays({ rooms: null, floors: null, config: null })).toMatchObject({ rooms: [], legend: null });
    expect(buildRoomOverlays({ rooms: [room()], floors: null, config: { mode: 'temperature', bindings: { kitchen: null } } }).rooms[0].status).toBe('missing');
    expect(aggregateMeasurements(null, {}, {}, { mode: 'temperature' })).toMatchObject({ value: null, status: 'missing' });
    expect(alertState(null, undefined).status).toBe('invalid');
    expect(alertState({ type: '__proto__' }, { state: 'on' }).status).toBe('invalid');
    expect(buildAlerts({ rooms: [null], floors: null, bindings: [{ entity: 's', type: 'smoke', roomId: 'missing' }], states: { s: { state: 'on' } } }).alerts[0].location).toBeNull();
  });

  it('builds filtered floor polygons and labels missing data without relying only on colour', () => {
    const result = buildRoomOverlays({ rooms: [room(), room('bedroom', 'first')], floors, visibleFloors: ['first'],
      states: { t: reading('15', '°C') }, config: { mode: 'temperature', bindings: { bedroom: { entities: ['t', 'absent'] } } } });
    expect(result.rooms).toHaveLength(1); expect(result.rooms[0]).toMatchObject({ id: 'bedroom', elevation: 3, value: 15, status: 'partial' });
    expect(result.rooms[0].label).toContain('partial: 1/2'); expect(result.legend.label).toContain('°C'); expect(result.stats.partial).toBe(1);
    const missing = buildRoomOverlays({ rooms: [room()], floors, config: { mode: 'temperature' } });
    expect(missing.rooms[0].color).toBe(UNKNOWN_STATUS_COLOR); expect(missing.rooms[0].label).toContain('No reading');
    expect(buildRoomOverlays({ config: { mode: 'off' } })).toMatchObject({ rooms: [], legend: null });
  });

  it('does not total overlapping meters across rooms or incomplete/non-sum aggregates', () => {
    const data = { rooms: [room('one'), room('two')], floors, states: { p: reading('1000', 'W'), q: reading('500', 'W') } };
    const duplicate = buildRoomOverlays({ ...data, config: { mode: 'power', bindings: { one: { entities: ['p'] }, two: { entities: ['p'] } } } });
    expect(duplicate.stats.total).toBeNull(); expect(duplicate.stats.totalReason).toContain('overlap');
    const good = buildRoomOverlays({ ...data, config: { mode: 'power', bindings: { one: { entities: [{ entity: 'p', group: 'one' }] }, two: { entities: [{ entity: 'q', group: 'two' }] } } } });
    expect(good.stats.total).toBe(1500);
    const unconfirmed = buildRoomOverlays({ ...data, config: { mode: 'power', bindings: { one: { entities: ['p'] }, two: { entities: ['q'] } } } });
    expect(unconfirmed.stats.total).toBeNull(); expect(unconfirmed.stats.totalReason).toContain('separate loads');
    const partial = buildRoomOverlays({ ...data, config: { mode: 'power', bindings: { one: { entities: ['p', 'absent'], independent_meters: true } } } });
    expect(partial.stats.total).toBeNull(); expect(partial.stats.totalReason).toContain('complete');
  });

  it('keeps energy periods visible and supports fixed/auto ranges in the chosen output unit', () => {
    const e = buildRoomOverlays({ rooms: [room()], floors, states: { e: reading('500', 'Wh') },
      config: { mode: 'energy', period: 'day', bindings: { kitchen: { entities: [{ entity: 'e', period: 'daily' }] } } } });
    expect(e.legend).toMatchObject({ title: 'Energy (day)', unit: 'kWh', period: 'day' }); expect(e.stats.total).toBe(.5);
    const f = buildRoomOverlays({ rooms: [room()], floors, states: { t: reading('20', '°C') },
      config: { mode: 'temperature', unit: '°F', bindings: { kitchen: { entities: ['t'] } } } });
    expect(f.legend.min).toBeCloseTo(60.8); expect(f.legend.max).toBeCloseTo(82.4);
    const auto = buildRoomOverlays({ rooms: [room()], floors, states: { t: reading('20', '°C') },
      config: { mode: 'temperature', scale: 'auto', bindings: { kitchen: { entities: ['t'] } } } });
    expect(auto.legend.min).toBeLessThan(20); expect(auto.legend.max).toBeGreaterThan(20);
  });

  it('clamps palette endpoints and rejects invalid scales, palettes and polygons', () => {
    expect(statusColor(-100, 0, 10, ['#000000', '#ffffff'])).toBe('#000000');
    expect(statusColor(100, 0, 10, ['#000000', '#ffffff'])).toBe('#ffffff');
    expect(statusColor(5, 0, 10, ['#000000', '#ffffff'])).toBe('#808080');
    expect(statusColor(NaN, 0, 10)).toBe(UNKNOWN_STATUS_COLOR); expect(statusColor(5, 10, 0)).toBe(UNKNOWN_STATUS_COLOR);
    expect(statusColor(5, 0, 10, '__proto__')).toBe(UNKNOWN_STATUS_COLOR);
    const bad = buildRoomOverlays({ rooms: [room(), { ...room('bad'), room: { id: 'bad', polygon: [[0, 0], [NaN, 1], [0, 1]] } }], floors,
      config: { mode: 'power', palette: ['not a colour'], min: 10, max: 0 } });
    expect(bad.rooms).toHaveLength(1); expect(bad.legend.valid).toBe(false); expect(bad.legend.stops).toEqual([]);
    expect(buildRoomOverlays({ rooms: [{ ...room(), shown: false }], floors, config: { mode: 'power' } }).rooms).toEqual([]);
  });
});

describe('alert state and locations', () => {
  it('activates smoke/leak/unlocked triggers, distinguishes cleared and unavailable state', () => {
    expect(alertState({ type: 'smoke' }, { state: 'on' })).toMatchObject({ status: 'active', active: true, icon: 'mdi:smoke-detector' });
    expect(alertState({ type: 'leak' }, { state: 'off' })).toMatchObject({ status: 'clear', active: false });
    expect(alertState({ type: 'unlocked' }, { state: 'unlocked' })).toMatchObject({ status: 'active', active: true });
    expect(alertState({ type: 'unlocked' }, { state: 'locked' }).message).toBe('Door locked');
    expect(alertState({ type: 'unlocked' }, { state: 'locking' }).status).toBe('unavailable');
    expect(alertState({ type: 'smoke' }, { state: 'unavailable' })).toMatchObject({ status: 'unavailable', active: false });
    expect(alertState({ type: 'leak' }, undefined).status).toBe('missing');
  });

  it('supports explicit custom triggers and clearing states without treating unknown as clear', () => {
    const custom = { type: 'custom', trigger_states: ['alarm', ' ALERT '], clear_states: ['normal'] };
    expect(alertState(custom, { state: 'alert' }).active).toBe(true);
    expect(alertState(custom, { state: 'normal' }).status).toBe('clear');
    expect(alertState(custom, { state: 'pending' }).status).toBe('unavailable');
    expect(alertState({ type: 'custom' }, { state: 'on' }).status).toBe('invalid');
    expect(alertState({ type: 'smoke', clear_rule: 'bogus' }, { state: 'on' }).status).toBe('invalid');
  });

  it('latches until acknowledged, and acknowledgement cannot suppress a currently triggered sensor', () => {
    const binding = { type: 'leak', clear_rule: 'latched' };
    expect(alertState(binding, { state: 'on' }, { acknowledged: true })).toMatchObject({ active: true, latched: true });
    expect(alertState(binding, { state: 'off' }, { latched: true })).toMatchObject({ active: true, triggered: false, latched: true });
    expect(alertState(binding, { state: 'off' }, { latched: true, acknowledged: true })).toMatchObject({ active: false, status: 'clear', latched: false });
    expect(alertState(binding, { state: 'unknown' }, { latched: true })).toMatchObject({ status: 'unavailable', active: true, latched: true });
  });

  it('places multiple alerts at live device coordinates or a room centre on the correct floor', () => {
    const result = buildAlerts({ rooms: [room('bedroom', 'first')], floors, positions: new Map([['entity:smoke', { x: 1, y: 2, z: 2.4, floorId: 'first' }]]),
      states: { smoke: { state: 'on' }, leak: { state: 'on' } }, bindings: [
        { id: 'smoke', type: 'smoke', entity: 'smoke' }, { id: 'leak', type: 'leak', entity: 'leak', roomId: 'bedroom' }] });
    expect(result.alerts[0].location).toEqual({ x: 1, y: 2, z: 2.4, floorId: 'first', elevation: 3 });
    expect(result.alerts[1].location).toEqual({ x: 2, y: 1.5, z: .12, floorId: 'first', elevation: 3 });
    expect(result.stats.active).toBe(2); expect(result.alerts.every((a) => a.shown)).toBe(true);
  });

  it('keeps latch memory for hidden floors, validates coordinates and respects hidden rooms', () => {
    const binding = { id: 'alarm', entity: 'smoke', type: 'smoke', clear_rule: 'latched', x: 1, y: 2, floorId: 'first' };
    const result = buildAlerts({ floors, visibleFloors: ['ground'], states: { smoke: { state: 'on' } }, bindings: [binding] });
    expect(result.alerts[0].shown).toBe(false); expect(result.nextLatches.alarm).toBe(true);
    const next = buildAlerts({ floors, bindings: [binding], states: { smoke: { state: 'off' } }, previousLatches: result.nextLatches, acknowledged: ['alarm'] });
    expect(next.alerts[0].status).toBe('clear'); expect(next.nextLatches.alarm).toBe(false);
    const bad = buildAlerts({ floors, bindings: [{ ...binding, x: NaN }, { ...binding, id: 'missing-floor', floorId: 'absent' }] });
    expect(bad.stats.unplaced).toBe(2); expect(bad.alerts.every((a) => !a.shown)).toBe(true);
    const hidden = buildAlerts({ floors, rooms: [{ ...room(), shown: false }], states: { smoke: { state: 'on' } },
      bindings: [{ ...binding, roomId: 'kitchen', floorId: 'ground' }] });
    expect(hidden.alerts[0].shown).toBe(false);
  });

  it('uses static highlights for reduced motion and bounded, finite pulses otherwise', () => {
    expect(alertPulse(100, true)).toEqual(alertPulse(1000, true)); expect(alertPulse(100, true).animate).toBe(false);
    const pulse = alertPulse(NaN); expect(pulse.scale).toBeGreaterThanOrEqual(1); expect(pulse.scale).toBeLessThanOrEqual(1.4);
    expect(pulse.opacity).toBeGreaterThanOrEqual(.35); expect(pulse.opacity).toBeLessThanOrEqual(.85); expect(pulse.animate).toBe(true);
  });
});

describe('StatusOverlays renderer adapter', () => {
  const overlayData = () => buildRoomOverlays({ floors, rooms: [room('bedroom', 'first')], states: { t: reading('20', '°C') },
    config: { mode: 'temperature', bindings: { bedroom: { entities: ['t'] } } } });
  const alertData = (state = 'on') => buildAlerts({ floors, bindings: [{ id: 'a', entity: 'smoke', type: 'smoke', x: 1, y: 2, z: 1.5, floorId: 'first' }], states: { smoke: { state } } });

  it('adds coloured polygons and accessible labelled alert rings using existing world coordinates', () => {
    const parent = new THREE.Group(), invalidate = vi.fn(), layer = new StatusOverlays(parent, { onInvalidate: invalidate });
    layer.setData({ ...overlayData(), alerts: alertData().alerts });
    expect(parent.children).toContain(layer.group); expect(layer.rooms.size).toBe(1); expect(layer.alerts.size).toBe(1);
    const alert = layer.alerts.get('a'); expect(alert.mesh.position.toArray()).toEqual([1, 4.5, -2]);
    expect(alert.label.element.getAttribute('role')).toBe('status'); expect(alert.label.element.textContent).toContain('Smoke detected');
    expect(alert.label.element.querySelector('ha-icon').getAttribute('icon')).toBe('mdi:smoke-detector');
    expect(layer.rooms.get('first:bedroom').mesh.position.y).toBeCloseTo(3.018); expect(invalidate).toHaveBeenCalledOnce();
    layer.dispose();
  });

  it('reuses unchanged meshes/labels and only animates active visible alerts', () => {
    const layer = new StatusOverlays(new THREE.Group()); const data = { ...overlayData(), alerts: alertData().alerts }; layer.setData(data);
    const roomPart = layer.rooms.get('first:bedroom'), textNode = roomPart.label.element.querySelector('span').firstChild;
    layer.setData(data); expect(layer.rooms.get('first:bedroom')).toBe(roomPart);
    expect(roomPart.label.element.querySelector('span').firstChild).toBe(textNode);
    expect(layer.update(500)).toBe(true); expect(layer.alerts.get('a').mesh.scale.x).toBeCloseTo(1.4);
    expect(layer.update(700, { reducedMotion: true })).toBe(true); expect(layer.alerts.get('a').mesh.scale.x).toBe(1);
    expect(layer.update(750, { reducedMotion: true })).toBe(false);
    layer.group.visible = false; expect(layer.update(1000)).toBe(false); layer.group.visible = true;
    layer.setData({ alerts: alertData('unavailable').alerts }); expect(layer.hasAnimation).toBe(false); expect(layer.update(800)).toBe(false);
    layer.setData({ alerts: alertData('off').alerts }); expect(layer.alerts.size).toBe(0); layer.dispose();
  });

  it('does not invalidate an empty/off layer or clear alerts on unrelated HA updates', () => {
    const invalidate = vi.fn(), layer = new StatusOverlays(new THREE.Group(), { onInvalidate: invalidate });
    for (let i = 0; i < 10; i++) {
      expect(layer.setData({ rooms: [], alerts: alertData('off').alerts })).toBe(false);
      expect(layer.update(i * 100)).toBe(false);
    }
    expect(invalidate).not.toHaveBeenCalled(); expect(layer.group.children).toHaveLength(0);
    layer.dispose(); expect(layer.setData(overlayData())).toBe(false);
  });

  it('compares visual data rather than input identity, preserving resources and an ongoing pulse', () => {
    const invalidate = vi.fn(), layer = new StatusOverlays(new THREE.Group(), { onInvalidate: invalidate });
    const data = { ...overlayData(), alerts: alertData().alerts };
    expect(layer.setData(data)).toBe(true);
    const part = layer.rooms.get('first:bedroom'), alert = layer.alerts.get('a');
    const geometry = part.mesh.geometry, material = part.mesh.material, label = part.label;
    const dispose = vi.spyOn(geometry, 'dispose'), setColor = vi.spyOn(material.color, 'set');
    layer.update(500); const pulse = [alert.mesh.scale.x, alert.mesh.material.opacity]; invalidate.mockClear();
    for (let i = 0; i < 10; i++) {
      const same = structuredClone(data);
      same.rooms[0].sources = [{ entity: 'unrelated', value: i }];
      same.rooms[0].diagnostics = [{ code: 'unrelated', message: String(i) }];
      same.alerts[0].diagnostics = [{ code: 'unrelated', message: String(i) }];
      same.stats = { unrelated: i };
      expect(layer.setData(same)).toBe(false);
    }
    expect(invalidate).not.toHaveBeenCalled(); expect(dispose).not.toHaveBeenCalled(); expect(setColor).not.toHaveBeenCalled();
    expect(layer.rooms.get('first:bedroom')).toBe(part); expect(part.mesh.geometry).toBe(geometry);
    expect(part.mesh.material).toBe(material); expect(part.label).toBe(label); expect(layer.alerts.get('a')).toBe(alert);
    expect([alert.mesh.scale.x, alert.mesh.material.opacity]).toEqual(pulse); expect(layer.hasAnimation).toBe(true);
    layer.dispose();
  });

  it('invalidates real reading, style, geometry, alert position and active-state changes', () => {
    const invalidate = vi.fn(), layer = new StatusOverlays(new THREE.Group(), { onInvalidate: invalidate });
    let data = { ...overlayData(), alerts: alertData().alerts }; layer.setData(data); invalidate.mockClear();
    const original = layer.rooms.get('first:bedroom'); const disposed = vi.spyOn(original.mesh.geometry, 'dispose');
    data = { ...buildRoomOverlays({ floors, rooms: [room('bedroom', 'first')], states: { t: reading('21', '°C') },
      config: { mode: 'temperature', bindings: { bedroom: { entities: ['t'] } } } }), alerts: alertData().alerts };
    expect(layer.setData(data)).toBe(true); expect(layer.rooms.get('first:bedroom')).toBe(original);
    data.rooms[0].color = '#abcdef'; expect(layer.setData(data)).toBe(true);
    data.rooms[0].status = 'partial'; expect(layer.setData(data)).toBe(true); expect(original.mesh.material.opacity).toBe(.3);
    data.rooms[0].requested = 0; expect(layer.setData(data)).toBe(true); expect(original.label.visible).toBe(false);
    data.rooms[0].polygon[1][0] = 5; expect(layer.setData(data)).toBe(true); expect(disposed).toHaveBeenCalledOnce();
    layer.update(500); const alert = layer.alerts.get('a'), scale = alert.mesh.scale.x;
    data.alerts[0].location.x = 2; expect(layer.setData(data)).toBe(true); expect(alert.mesh.position.x).toBe(2); expect(alert.mesh.scale.x).toBe(scale);
    data.alerts[0].color = '#abcdef'; expect(layer.setData(data)).toBe(true);
    data.alerts[0].active = false; data.alerts[0].status = 'unavailable'; expect(layer.setData(data)).toBe(true);
    expect(layer.hasAnimation).toBe(false); expect(alert.mesh.scale.x).toBe(1); expect(alert.mesh.material.opacity).toBe(.8);
    expect(layer.update(700)).toBe(false); expect(invalidate).toHaveBeenCalledTimes(8);
    expect(layer.setData({})).toBe(true); expect(layer.setData({})).toBe(false);
    layer.dispose();
  });

  it('keeps unbound rooms quiet while labelling a configured missing reading', () => {
    const layer = new StatusOverlays(new THREE.Group());
    const empty = buildRoomOverlays({ rooms: [room('bedroom', 'first')], floors, config: { mode: 'temperature' } });
    layer.setData(empty);
    const part = layer.rooms.get('first:bedroom');
    expect(part.label.visible).toBe(false); expect(part.label.element.hidden).toBe(true);
    const configured = buildRoomOverlays({ rooms: [room('bedroom', 'first')], floors,
      config: { mode: 'temperature', bindings: { bedroom: { entities: ['absent'] } } } });
    layer.setData(configured);
    expect(layer.rooms.get('first:bedroom')).toBe(part); expect(part.label.visible).toBe(true);
    expect(part.label.element.hidden).toBe(false); expect(part.label.element.textContent).toContain('No reading');
    layer.dispose();
  });

  it('removes CSS2D labels and disposes owned/shared resources exactly once', () => {
    const parent = new THREE.Group(), layer = new StatusOverlays(parent); layer.setData({ ...overlayData(), alerts: alertData().alerts });
    const roomPart = layer.rooms.get('first:bedroom'), alert = layer.alerts.get('a');
    document.body.append(roomPart.label.element, alert.label.element);
    const roomGeo = vi.spyOn(roomPart.mesh.geometry, 'dispose'), roomMat = vi.spyOn(roomPart.mesh.material, 'dispose'), ring = vi.spyOn(layer.ringGeometry, 'dispose');
    layer.setData({ alerts: alertData().alerts }); expect(roomPart.label.element.isConnected).toBe(false); expect(roomGeo).toHaveBeenCalledOnce(); expect(roomMat).toHaveBeenCalledOnce();
    layer.dispose(); layer.dispose(); expect(ring).toHaveBeenCalledOnce(); expect(alert.label.element.isConnected).toBe(false); expect(parent.children).toHaveLength(0);
    layer.setData(overlayData()); expect(layer.rooms.size).toBe(0); expect(layer.update(0)).toBe(false);
  });
});
