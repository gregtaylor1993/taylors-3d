import { describe, it, expect, vi } from 'vitest';
import { buildMarkers, registrySignature, floorsFromHA, iconFor, isActive, displayValue } from '../src/registry.js';

const st = (state, attributes = {}) => ({ state, attributes });
const hass = {
  areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen', floor_id: 'ground' } },
  floors: {
    up: { floor_id: 'up', name: 'Upstairs', level: 1 },
    ground: { floor_id: 'ground', name: 'Ground', level: 0 },
  },
  devices: {
    d1: { id: 'd1', name: 'Plug', name_by_user: 'Kettle plug', area_id: 'kitchen' },
    d2: { id: 'd2', name: 'Thermo', area_id: 'kitchen' },
  },
  entities: {
    'switch.plug': { entity_id: 'switch.plug', device_id: 'd1' },
    'sensor.plug_power': { entity_id: 'sensor.plug_power', device_id: 'd1' },
    'sensor.plug_temp': { entity_id: 'sensor.plug_temp', device_id: 'd1' },
    'update.plug_fw': { entity_id: 'update.plug_fw', device_id: 'd1' },
    'sensor.plug_rssi': { entity_id: 'sensor.plug_rssi', device_id: 'd1', entity_category: 'diagnostic' },
    'sensor.thermo_h': { entity_id: 'sensor.thermo_h', device_id: 'd2' },
    'sensor.thermo_t': { entity_id: 'sensor.thermo_t', device_id: 'd2' },
    'light.hall': { entity_id: 'light.hall', area_id: 'hall', device_id: 'd2' },
    'light.hidden': { entity_id: 'light.hidden', area_id: 'kitchen', hidden: true },
    'light.no_state': { entity_id: 'light.no_state', area_id: 'kitchen' },
  },
  states: {
    'switch.plug': st('on'),
    'sensor.plug_power': st('12.345', { device_class: 'power', unit_of_measurement: 'W' }),
    'sensor.plug_temp': st('21', { device_class: 'temperature', unit_of_measurement: '°C' }),
    'update.plug_fw': st('off'),
    'sensor.plug_rssi': st('-60'),
    'sensor.thermo_h': st('40', { device_class: 'humidity' }),
    'sensor.thermo_t': st('20.5', { device_class: 'temperature', friendly_name: 'Thermo T' }),
    'light.hall': st('off', { friendly_name: 'Hall light' }),
    'light.hidden': st('on'),
  },
};

describe('buildMarkers', () => {
  const markers = buildMarkers(hass, { hidden: [] });
  const byId = Object.fromEntries(markers.map((m) => [m.id, m]));

  it('groups entities per device and skips hidden, diagnostic, skipped-domain and stateless entities', () => {
    expect(Object.keys(byId).sort()).toEqual(['device:d1', 'device:d2', 'entity:light.hall']);
    expect(byId['device:d1'].entities.map((e) => e.eid)).not.toContain('sensor.plug_rssi');
    expect(byId['device:d1'].entities.map((e) => e.eid)).not.toContain('update.plug_fw');
  });

  it('picks the primary entity by domain priority, then sensor class', () => {
    expect(byId['device:d1']).toMatchObject({ entityId: 'switch.plug', domain: 'switch', name: 'Kettle plug', areaId: 'kitchen' });
    expect(byId['device:d2']).toMatchObject({ entityId: 'sensor.thermo_t', deviceClass: 'temperature', name: 'Thermo' });
  });

  it('chooses a secondary sensor for value display', () => {
    expect(byId['device:d1'].secondaryId).toBe('sensor.plug_temp');
    expect(byId['device:d2'].secondaryId).toBe('sensor.thermo_h');
  });

  it('splits entities with their own area off the device', () => {
    expect(byId['entity:light.hall']).toMatchObject({ areaId: 'hall', name: 'Hall light' });
  });

  it('honours the hidden list (marker id or entity id)', () => {
    const ids = buildMarkers(hass, { hidden: ['device:d1', 'light.hall'] }).map((m) => m.id);
    expect(ids).toEqual(['device:d2']);
  });

  it('groups by entity when asked', () => {
    const ids = buildMarkers(hass, {}, { group_by: 'entity' }).map((m) => m.id);
    expect(ids).toContain('entity:switch.plug');
    expect(ids).toContain('entity:sensor.plug_temp');
  });

  it('includes state-only entities without guessing their device or area from names/attributes', () => {
    const h = { ...hass, states: { ...hass.states, 'sensor.plug_extra': st('7', {
      friendly_name: 'Unregistered reading', device_class: 'power', device_id: 'd1', area_id: 'kitchen',
    }) } };
    expect(buildMarkers(h, {}).find((m) => m.entityId === 'sensor.plug_extra')).toMatchObject({
      id: 'entity:sensor.plug_extra', name: 'Unregistered reading', deviceId: null, areaId: null, floorId: null,
    });
  });

  it('filters full-registry hidden, disabled and config metadata while retaining offline markers', () => {
    const h = { ...hass, entities: { ...hass.entities,
      'light.full_hidden': { hidden_by: 'user' }, 'light.disabled': { disabled_by: 'integration' },
      'light.config': { entity_category: 'config' }, 'light.offline': {},
    }, states: { ...hass.states, 'light.full_hidden': st('off'), 'light.disabled': st('off'),
      'light.config': st('off'), 'light.offline': st('unavailable') } };
    const ids = buildMarkers(h, {}).map((m) => m.entityId);
    expect(ids).toContain('light.offline');
    expect(ids).not.toContain('light.full_hidden'); expect(ids).not.toContain('light.disabled'); expect(ids).not.toContain('light.config');
  });

  it('inherits logical parent area/floor, keeps an explicit entity override separate, and skips disabled devices', () => {
    const h = { ...hass, areas: { ...hass.areas, hall: { area_id: 'hall', floor_id: 'up' } },
      devices: { ...hass.devices, child: { id: 'child', name: 'Outlet', parent_device_id: 'd1' } },
      entities: { ...hass.entities, 'switch.child': { device_id: 'child' }, 'light.child': { device_id: 'child', area_id: 'hall' } },
      states: { ...hass.states, 'switch.child': st('on'), 'light.child': st('off', { friendly_name: 'Hall child' }) } };
    const markers = buildMarkers(h, {});
    expect(markers.find((m) => m.id === 'device:child')).toMatchObject({ areaId: 'kitchen', floorId: 'ground', name: 'Outlet' });
    expect(markers.find((m) => m.id === 'entity:light.child')).toMatchObject({ areaId: 'hall', floorId: 'up', name: 'Hall child' });
    const disabled = { ...h, devices: { ...h.devices, child: { ...h.devices.child, disabled_by: 'user' } } };
    expect(buildMarkers(disabled, {}).some((m) => m.deviceId === 'child')).toBe(false);
  });

  it('retains manual hides, grouping priority ties and pins when new unregistered states appear', () => {
    const h = { ...hass, entities: { 'switch.b': { device_id: 'd1' }, 'switch.a': { device_id: 'd1' } },
      states: { 'switch.a': st('on'), 'switch.b': st('off'), 'sensor.free': st('2') } };
    const layout = { pins: { 'device:d1': { x: 1, y: 2, floor_id: 'ground' } }, hidden: ['entity:sensor.free'] };
    const before = JSON.stringify(layout);
    expect(buildMarkers(h, layout)).toMatchObject([{ id: 'device:d1', entityId: 'switch.b' }]);
    expect(JSON.stringify(layout)).toBe(before);
    expect(buildMarkers(h, { ...layout, hidden: ['device:d1', 'sensor.free'] })).toEqual([]);
  });

  it('uses native HA entity names for standalone markers while preserving grouped device names', () => {
    const h = { ...hass, formatEntityName: vi.fn(() => 'Translated entity') };
    const markers = buildMarkers(h, {});
    expect(markers.find((m) => m.id === 'entity:light.hall').name).toBe('Translated entity');
    expect(markers.find((m) => m.id === 'device:d1').name).toBe('Kettle plug');
  });
});

describe('registrySignature', () => {
  it('detects added and removed state-only entity IDs with the same registry objects', () => {
    const added = { ...hass, states: { ...hass.states, 'sensor.new': st('1') } };
    expect(registrySignature(added)).not.toEqual(registrySignature(hass));
    const removed = { ...hass, states: { ...hass.states } }; delete removed.states['sensor.plug_power'];
    expect(registrySignature(removed)).not.toEqual(registrySignature(hass));
  });

  it('stays stable for ordinary readings, new states objects, enumeration order and formatter closures', () => {
    const updated = { ...hass, states: Object.fromEntries(Object.entries(hass.states).reverse()), formatEntityState: () => 'new closure' };
    updated.states['sensor.plug_power'] = st('99.9', hass.states['sensor.plug_power'].attributes);
    updated.states['switch.plug'] = st('off');
    const original = registrySignature(hass);
    expect(registrySignature(updated).every((part, index) => part === original[index])).toBe(true);
  });

  it('observes marker labels, classes/icons and language changes without using state values', () => {
    const original = registrySignature(hass);
    for (const patch of [{ friendly_name: 'Renamed power' }, { device_class: 'temperature' }, { icon: 'mdi:meter-electric' }]) {
      const updated = { ...hass, states: { ...hass.states, 'sensor.plug_power': st('12.345', { ...hass.states['sensor.plug_power'].attributes, ...patch }) } };
      expect(registrySignature(updated)).not.toEqual(original);
    }
    expect(registrySignature({ ...hass, language: 'fr' })).not.toEqual(original);
    expect(registrySignature({ ...hass, locale: { number_format: 'decimal_comma' } })).not.toEqual(original);
    expect(registrySignature({ ...hass, translationMetadata: { fragments: ['sensor'] } })).not.toEqual(original);
    expect(registrySignature({ ...hass, devices: { ...hass.devices } })[1]).not.toBe(original[1]);
  });
});

describe('helpers', () => {
  it('sorts floors by level', () => {
    expect(floorsFromHA(hass).map((f) => f.id)).toEqual(['ground', 'up']);
    expect(floorsFromHA({})).toEqual([]);
  });

  it('picks icons from attributes, device class, then domain', () => {
    const h = { states: { 'light.a': st('on', { icon: 'mdi:ceiling-light' }), 'sensor.t': st('1', { device_class: 'temperature' }), 'fan.f': st('on') }, entities: {} };
    expect(iconFor(h, 'light.a')).toBe('mdi:ceiling-light');
    expect(iconFor(h, 'sensor.t')).toBe('mdi:thermometer');
    expect(iconFor(h, 'fan.f')).toBe('mdi:fan');
    expect(iconFor(h, 'foo.bar')).toBe('mdi:checkbox-blank-circle-outline');
  });

  it('knows active states', () => {
    expect(isActive(st('on'))).toBe(true);
    expect(isActive(st('off'))).toBe(false);
    expect(isActive(undefined)).toBe(false);
  });

  it('formats values', () => {
    expect(displayValue(hass, 'sensor.plug_power')).toBe('12.345 W');
    expect(displayValue(hass, 'sensor.missing')).toBe('');
    const h = { states: { 'climate.a': st('heat', { current_temperature: 21 }), 'climate.b': st('off', { current_temperature: null }), 'sensor.s': st('unavailable') } };
    expect(displayValue(h, 'climate.a')).toBe('21');
    expect(displayValue(h, 'climate.b')).toBe('');
    expect(displayValue(h, 'sensor.s')).toBe('Unavailable');
  });

  it('keeps exactly HA-formatted sensor values/units and current-temperature attributes', () => {
    const h = { states: { 'sensor.s': st('12.345', { unit_of_measurement: 'W' }),
      'climate.room': st('heat', { current_temperature: 21.5 }) },
    formatEntityState: vi.fn(() => '12,35 Watts'), formatEntityAttributeValue: vi.fn(() => '21,5 °C') };
    expect(displayValue(h, 'sensor.s')).toBe('12,35 Watts');
    expect(displayValue(h, 'climate.room')).toBe('21,5 °C');
    expect(h.formatEntityState).toHaveBeenCalledExactlyOnceWith(h.states['sensor.s']);
    expect(h.formatEntityAttributeValue).toHaveBeenCalledExactlyOnceWith(h.states['climate.room'], 'current_temperature');
  });

  it.each([[0, '12 W'], [2, '12.35 W']])('uses chosen fallback sensor precision %s instead of forcing one decimal', (precision, expected) => {
    const h = { entities: { 'sensor.s': { display_precision: precision } }, states: { 'sensor.s': st('12.345', { unit_of_measurement: 'W' }) } };
    expect(displayValue(h, 'sensor.s')).toBe(expected);
  });

  it('shows unknown/unavailable instead of a stale climate reading, and blanks missing/other domains', () => {
    const h = { states: { 'climate.offline': st('unavailable', { current_temperature: 20 }),
      'climate.unknown': st('unknown'), 'climate.no_temperature': st('off'), 'light.a': st('on'),
      'sensor.unknown': st('unknown') } };
    expect(displayValue(h, 'climate.offline')).toBe('Unavailable');
    expect(displayValue(h, 'climate.unknown')).toBe('Unknown');
    expect(displayValue(h, 'sensor.unknown')).toBe('Unknown');
    expect(displayValue(h, 'climate.no_temperature')).toBe('');
    expect(displayValue(h, 'sensor.missing')).toBe('');
    expect(displayValue(h, 'light.a')).toBe('');
  });

  it('preserves numeric-looking enum identifiers and zero-degree readings with real HA units', () => {
    const h = { config: { unit_system: { temperature: '°F' } }, states: {
      'sensor.code': st('00123', { device_class: 'enum' }), 'climate.cold': st('heat', { current_temperature: 0 }) } };
    expect(displayValue(h, 'sensor.code')).toBe('00123');
    expect(displayValue(h, 'climate.cold')).toBe('0 °F');
  });
});
