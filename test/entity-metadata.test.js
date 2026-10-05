import { describe, it, expect, vi } from 'vitest';
import { entityMetadata, entityChoices, formatEntityValue, registryIssues } from '../src/entity-metadata.js';

const state = (entity_id, value, attributes = {}) => ({ entity_id, state: value, attributes });
function household() {
  return {
    locale: { language: 'en', number_format: 'comma_decimal' },
    floors: { ground: { floor_id: 'ground', name: 'Ground' }, upstairs: { floor_id: 'upstairs', name: 'Upstairs' } },
    areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen', floor_id: 'ground', labels: ['indoors'] },
      office: { area_id: 'office', name: 'Office', floor_id: 'upstairs' } },
    devices: { plug: { id: 'plug', area_id: 'kitchen', name_by_user: 'Kitchen plug', labels: ['energy'] },
      child: { id: 'child', parent_device_id: 'plug', labels: ['outlet'] },
      gatewayChild: { id: 'gatewayChild', via_device_id: 'plug' } },
    entities: {
      'sensor.power': { entity_id: 'sensor.power', device_id: 'plug', display_precision: 2, labels: ['meter'] },
      'switch.socket': { entity_id: 'switch.socket', device_id: 'child' },
      'sensor.office': { entity_id: 'sensor.office', device_id: 'plug', area_id: 'office' },
      'sensor.wifi': { entity_id: 'sensor.wifi', device_id: 'plug', entity_category: 'diagnostic' },
      'sensor.config': { entity_id: 'sensor.config', entity_category: 'config' },
      'light.hidden': { entity_id: 'light.hidden', hidden: true },
      'camera.hidden_full': { entity_id: 'camera.hidden_full', hidden_by: 'user' },
      'sensor.disabled': { entity_id: 'sensor.disabled', disabled_by: 'integration' },
      'light.offline': { entity_id: 'light.offline' },
      'sensor.no_state': { entity_id: 'sensor.no_state', device_id: 'plug' },
    },
    states: {
      'sensor.power': state('sensor.power', '12.3', { friendly_name: 'Power', device_class: 'power', unit_of_measurement: 'W', supported_features: 5 }),
      'switch.socket': state('switch.socket', 'on', { friendly_name: 'Socket' }),
      'sensor.office': state('sensor.office', '20', { friendly_name: 'Office temperature', device_class: 'temperature', unit_of_measurement: '°C' }),
      'sensor.wifi': state('sensor.wifi', '-60', { device_class: 'signal_strength' }),
      'sensor.config': state('sensor.config', '3'),
      'light.hidden': state('light.hidden', 'off'),
      'camera.hidden_full': state('camera.hidden_full', 'idle'),
      'sensor.disabled': state('sensor.disabled', '5'),
      'light.offline': state('light.offline', 'unavailable'),
      // A real state may legitimately have no registry entry (e.g. YAML-created entities).
      'sensor.free': state('sensor.free', '8', { friendly_name: 'Free reading', device_class: 'power', unit_of_measurement: 'W' }),
    },
  };
}

describe('entityMetadata', () => {
  it('resolves an entity override ahead of its device area, including the HA floor', () => {
    expect(entityMetadata(household(), 'sensor.office')).toMatchObject({ areaId: 'office', floorId: 'upstairs', deviceId: 'plug',
      name: 'Office temperature', deviceClass: 'temperature', unit: '°C', available: true });
  });

  it('inherits a logical parent area, but never a communication gateway area', () => {
    const hass = household();
    expect(entityMetadata(hass, 'switch.socket')).toMatchObject({ areaId: 'kitchen', floorId: 'ground' });
    hass.entities['switch.socket'].device_id = 'gatewayChild';
    expect(entityMetadata(hass, 'switch.socket').areaId).toBeNull();
  });

  it('keeps the child device own area and safely handles cyclic malformed parent data', () => {
    const hass = household();
    hass.devices.child.area_id = 'office';
    expect(entityMetadata(hass, 'switch.socket').areaId).toBe('office');
    delete hass.devices.child.area_id;
    hass.devices.child.parent_device_id = 'child';
    expect(entityMetadata(hass, 'switch.socket').areaId).toBeNull();
  });

  it('exposes label sources and a unique union for household filters', () => {
    const meta = entityMetadata(household(), 'sensor.power');
    expect(meta).toMatchObject({ entityLabels: ['meter'], deviceLabels: ['energy'], areaLabels: ['indoors'], labels: ['meter', 'energy', 'indoors'] });
  });

  it('uses HA naming when supplied, retaining its method context', () => {
    const hass = household();
    hass.formatEntityName = vi.fn(function (st) { expect(this).toBe(hass); return `Translated ${st.entity_id}`; });
    expect(entityMetadata(hass, 'sensor.power').name).toBe('Translated sensor.power');
    expect(hass.formatEntityName).toHaveBeenCalledWith(hass.states['sensor.power'], undefined);
  });

  it('normalizes display and full hidden shapes and disabled device state', () => {
    const hass = household();
    expect(entityMetadata(hass, 'light.hidden').hidden).toBe(true);
    expect(entityMetadata(hass, 'camera.hidden_full').hidden).toBe(true);
    hass.entities['camera.hidden_full'].hidden_by = null;
    expect(entityMetadata(hass, 'camera.hidden_full').hidden).toBe(false);
    hass.devices.plug.disabled_by = 'user';
    expect(entityMetadata(hass, 'sensor.power')).toMatchObject({ disabled: true, available: false });
  });

  it('distinguishes missing, registered without state, unavailable, and state-only entities', () => {
    const hass = household();
    expect(entityMetadata(hass, 'sensor.deleted')).toMatchObject({ missing: true, hasState: false, registered: false, available: false });
    expect(entityMetadata(hass, 'sensor.no_state')).toMatchObject({ missing: false, hasState: false, registered: true, available: false });
    expect(entityMetadata(hass, 'light.offline')).toMatchObject({ missing: false, hasState: true, available: false });
    expect(entityMetadata(hass, 'sensor.free')).toMatchObject({ missing: false, hasState: true, registered: false, available: true, areaId: null });
  });

  it('treats inherited object properties as absent references', () => {
    expect(entityMetadata({ states: {}, entities: {} }, '__proto__')).toMatchObject({ missing: true, state: null, registry: null });
  });
});

describe('entityChoices', () => {
  const values = (hass, filters) => entityChoices(hass, filters).map((choice) => choice.value);
  it('offers real state-only and offline devices while hiding config, diagnostic, hidden and disabled defaults', () => {
    expect(values(household())).toEqual(['sensor.free', 'light.offline', 'sensor.office', 'sensor.power', 'switch.socket']);
  });

  it('combines domain, class, area, floor, inherited labels, features and capability filters', () => {
    const hass = household();
    const predicate = vi.fn((meta, current) => current === hass && meta.unit === 'W');
    expect(values(hass, { domains: ['sensor'], deviceClasses: ['power'], areaId: 'kitchen', floorId: 'ground',
      labels: ['energy'], supportedFeatures: 5, capability: predicate })).toEqual(['sensor.power']);
    expect(predicate).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'sensor.power' }), hass);
    expect(values(hass, { supportedFeatures: 2 })).toEqual([]);
  });

  it('uses every required feature bit, including values beyond signed 32-bit masks', () => {
    const hass = household();
    hass.states['sensor.power'].attributes.supported_features = 2 ** 32 + 1;
    expect(values(hass, { supportedFeatures: 2 ** 32 + 1 })).toEqual(['sensor.power']);
    expect(values(hass, { supportedFeatures: -1 })).toEqual([]);
  });

  it('supports unassigned-area filters and explicit visibility/category opt-ins', () => {
    expect(values(household(), { domains: ['sensor'], areaId: null })).toEqual(['sensor.free']);
    const all = values(household(), { includeHidden: true, includeCategories: true, includeDisabled: true });
    expect(all).toEqual(expect.arrayContaining(['light.hidden', 'camera.hidden_full', 'sensor.wifi', 'sensor.config', 'sensor.disabled']));
    expect(all).not.toContain('sensor.no_state');
  });

  it('retains a missing or filtered selected choice with an honest warning', () => {
    const hass = household(), selected = ['sensor.deleted', 'light.hidden', 'switch.socket', 'sensor.no_state'];
    const choices = entityChoices(hass, { domains: ['sensor'], selected });
    expect(choices.find((choice) => choice.value === 'sensor.deleted')).toMatchObject({ selected: true, missing: true, selectable: false, label: 'sensor.deleted (Missing entity)' });
    expect(choices.find((choice) => choice.value === 'light.hidden')).toMatchObject({ hidden: true, filtered: true, label: 'light.hidden (Hidden)' });
    expect(choices.find((choice) => choice.value === 'switch.socket').label).toBe('Socket (Outside current filter)');
    expect(choices.find((choice) => choice.value === 'sensor.no_state').label).toBe('sensor.no_state (No current state)');
    expect(selected).toEqual(['sensor.deleted', 'light.hidden', 'switch.socket', 'sensor.no_state']);
  });

  it('can require availability without losing the current offline selection', () => {
    expect(entityChoices(household(), { domains: ['light'], availableOnly: true, selected: 'light.offline' })).toMatchObject([
      { value: 'light.offline', label: 'light.offline (Unavailable)', filtered: true, selectable: false },
    ]);
  });
});

describe('formatEntityValue', () => {
  it.each([0, 2])('defers precision %s, translated state and units to the native HA formatter', (digits) => {
    const hass = household(); hass.entities['sensor.power'].display_precision = digits;
    hass.formatEntityState = vi.fn(function (st) {
      expect(this).toBe(hass);
      return `${Number(st.state).toFixed(this.entities[st.entity_id].display_precision)} Watts`;
    });
    expect(formatEntityValue(hass, 'sensor.power')).toBe(digits === 0 ? '12 Watts' : '12.30 Watts');
    expect(hass.formatEntityState).toHaveBeenCalledExactlyOnceWith(hass.states['sensor.power']);
  });

  it('passes attributes to the native formatter without using a state formatter or adding units twice', () => {
    const hass = household();
    hass.states['climate.room'] = state('climate.room', 'heat', { current_temperature: 21.25 });
    hass.formatEntityAttributeValue = vi.fn(function (st, attribute) { expect(this).toBe(hass); return `${st.attributes[attribute]} °F`; });
    hass.formatEntityState = vi.fn();
    expect(formatEntityValue(hass, 'climate.room', { attribute: 'current_temperature' })).toBe('21.25 °F');
    expect(hass.formatEntityAttributeValue).toHaveBeenCalledWith(hass.states['climate.room'], 'current_temperature');
    expect(hass.formatEntityState).not.toHaveBeenCalled();
  });

  it.each([[0, '12 W'], [2, '12.30 W']])('fallback respects exact precision %s including trailing zeroes', (digits, expected) => {
    const hass = household(); hass.entities['sensor.power'].display_precision = digits;
    expect(formatEntityValue(hass, 'sensor.power')).toBe(expected);
  });

  it('honours full sensor user precision before suggested precision and rejects malformed precision', () => {
    const hass = household();
    hass.entities['sensor.power'] = { options: { sensor: { display_precision: 0, suggested_display_precision: 2 } } };
    expect(formatEntityValue(hass, 'sensor.power')).toBe('12 W');
    hass.entities['sensor.power'].options.sensor.display_precision = -2;
    expect(formatEntityValue(hass, 'sensor.power')).toBe('12.30 W');
    hass.entities['sensor.power'].options.sensor.suggested_display_precision = '2';
    expect(formatEntityValue(hass, 'sensor.power')).toBe('12.3 W');
  });

  it('uses locale number preferences and actual unit without converting the measurement', () => {
    const hass = household(); hass.locale = { language: 'en', number_format: 'decimal_comma' };
    hass.states['sensor.power'].state = '-1234.5';
    expect(formatEntityValue(hass, 'sensor.power')).toBe('-1.234,50 W');
    hass.locale.number_format = 'none';
    expect(formatEntityValue(hass, 'sensor.power')).toBe('-1234.50 W');
  });

  it('keeps unchosen reported precision and does not turn empty/text states into numeric zeroes', () => {
    const hass = { states: { 'sensor.reading': state('sensor.reading', '1.2300') } };
    expect(formatEntityValue(hass, 'sensor.reading')).toBe('1.2300');
    hass.states['sensor.reading'].state = '';
    expect(formatEntityValue(hass, 'sensor.reading')).toBe('');
    hass.states['sensor.reading'].state = 'ready';
    expect(formatEntityValue(hass, 'sensor.reading')).toBe('ready');
  });

  it('preserves numeric-looking identifiers without measurement metadata', () => {
    const hass = { states: { 'sensor.code': state('sensor.code', '00123', { device_class: 'enum' }) } };
    expect(formatEntityValue(hass, 'sensor.code')).toBe('00123');
  });

  it('supports high valid decimal precision but falls back safely for excessive precision', () => {
    const hass = household(); hass.entities['sensor.power'].display_precision = 21;
    expect(formatEntityValue(hass, 'sensor.power')).toBe(`12.3${'0'.repeat(20)} W`);
    hass.entities['sensor.power'].display_precision = 101;
    expect(formatEntityValue(hass, 'sensor.power')).toBe('12.3 W');
  });

  it('has readable missing/unavailable/unknown fallbacks and prefers native translations', () => {
    const hass = household();
    expect(formatEntityValue(hass, 'sensor.deleted')).toBe('Unavailable');
    expect(formatEntityValue(hass, 'light.offline')).toBe('Unavailable');
    hass.states['light.offline'].state = 'unknown';
    hass.localize = (key) => key === 'state.default.unknown' ? 'Inconnu' : undefined;
    expect(formatEntityValue(hass, 'light.offline')).toBe('Inconnu');
    hass.formatEntityState = () => 'Nicht verfügbar';
    expect(formatEntityValue(hass, 'light.offline')).toBe('Nicht verfügbar');
  });

  it('recovers from missing demo formatter context or malformed locale settings', () => {
    const hass = household();
    hass.formatEntityState = () => { throw new Error('No translation loaded'); };
    hass.locale.language = 'invalid_locale'; delete hass.locale.number_format;
    expect(formatEntityValue(hass, 'sensor.power')).toBe('12.30 W');
  });

  it('attribute fallback does not borrow sensor precision or a state unit', () => {
    const hass = household();
    hass.entities['sensor.power'].display_precision = 0;
    hass.states['sensor.power'].attributes.battery_level = 75.5;
    expect(formatEntityValue(hass, 'sensor.power', { attribute: 'battery_level' })).toBe('75.5 %');
    expect(formatEntityValue(hass, 'sensor.power', { attribute: 'absent' })).toBe('');
    hass.states['climate.room'] = state('climate.room', 'heat', { current_temperature: 68.5 });
    hass.config = { unit_system: { temperature: '°F' } };
    expect(formatEntityValue(hass, 'climate.room', { attribute: 'current_temperature' })).toBe('68.5 °F');
  });
});

describe('registryIssues', () => {
  it('checks effective tracking source, identity, room source and position source entities with exact paths', () => {
    const layout = {
      presence_bindings: [{ entity: 'sensor.deleted_room', identity_entity: 'person.deleted', room_source: { entity: 'sensor.deleted_location' } }],
      vehicle_bindings: [{ entity: 'sensor.free', identity_entity: 'sensor.no_state' }],
      vacuum_bindings: [{ entity: 'vacuum.deleted', position_source: { entity: 'sensor.deleted_xy' } }],
    };
    const result = registryIssues(household(), layout);
    expect(result.map((issue) => [issue.code, issue.path])).toEqual([
      ['missing_entity', 'layout.presence_bindings.0.entity'],
      ['missing_entity', 'layout.presence_bindings.0.identity_entity'],
      ['missing_entity', 'layout.presence_bindings.0.room_source.entity'],
      ['entity_no_state', 'layout.vehicle_bindings.0.identity_entity'],
      ['missing_entity', 'layout.vacuum_bindings.0.entity'],
      ['missing_entity', 'layout.vacuum_bindings.0.position_source.entity'],
    ]);
  });
  it('honors saved tracking arrays including empty overrides and nullish fallback for each feature independently', () => {
    const config = { presence_bindings: [{ entity: 'person.deleted' }], vehicle_bindings: [{ entity: 'sensor.deleted' }], vacuum_bindings: [{ entity: 'vacuum.deleted' }] };
    expect(registryIssues(household(), {}, config).map((issue) => issue.path)).toEqual(['config.presence_bindings.0.entity', 'config.vehicle_bindings.0.entity', 'config.vacuum_bindings.0.entity']);
    expect(registryIssues(household(), { presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [] }, config)).toEqual([]);
    expect(registryIssues(household(), { presence_bindings: null, vehicle_bindings: [], vacuum_bindings: [] }, config)).toMatchObject([{ path: 'config.presence_bindings.0.entity' }]);
  });
  it('checks explicit tracking floor references and accepts actual resolved/layout-only floors', () => {
    const layout = { floors: [{ id: 'garden' }], vacuum_bindings: [{ entity: 'sensor.free', floorId: 'deleted_status_floor',
      position: { x: 1, y: 2, floorId: 'deleted_position_floor' }, position_source: { entity: 'sensor.free', floorId: 'deleted_source_floor' } }],
    vehicle_bindings: [{ entity: 'sensor.free', position: { floorId: 'garden' } }] };
    expect(registryIssues(household(), layout).map((issue) => issue.path)).toEqual([
      'layout.vacuum_bindings.0.floorId', 'layout.vacuum_bindings.0.position.floorId', 'layout.vacuum_bindings.0.position_source.floorId',
    ]);
    const loaded = { floors: [{ id: 'deleted_status_floor' }, { id: 'deleted_position_floor' }, { id: 'deleted_source_floor' }, { id: 'garden' }] };
    expect(registryIssues(household(), layout, {}, loaded)).toEqual([]);
  });
  it('checks mapped room IDs including model rooms and ambiguous imported mapping arrays against loaded resolved geometry', () => {
    const layout = { presence_bindings: [{ entity: 'sensor.free', roomId: 'deleted_static_room', room_source: { entity: 'sensor.free',
      room_map: { 'Living room': 'model:lounge', Bedroom: ['model:bedroom', 'deleted_mapped_room'] } } }] };
    const loaded = { rooms: [{ room: { id: 'model:lounge' }, floorId: 'ground' }, { id: 'model:bedroom' }], anchors: [] };
    expect(registryIssues(household(), layout, {}, loaded).map((issue) => [issue.code, issue.path])).toEqual([
      ['missing_room', 'layout.presence_bindings.0.roomId'], ['missing_room', 'layout.presence_bindings.0.room_source.room_map.Bedroom.1'],
    ]);
    expect(registryIssues(household(), layout)).toEqual([]);
  });
  it('checks exact marker/object position keys without inferring an anchor from an entity or similar display name', () => {
    const layout = { vehicle_bindings: [{ entity: 'sensor.free', position_key: 'object:deleted-car' }, { entity: 'sensor.free', position_key: 'device:plug' }],
      vacuum_bindings: [{ entity: 'sensor.free', position_key: 'object:dock' }] };
    const loaded = { anchors: [{ id: 'object:replacement-car', label: 'Deleted car' }, { id: 'object:dock', shown: false }, { id: 'device:plug:camera.front' }] };
    const result = registryIssues(household(), layout, {}, loaded);
    expect(result.map((issue) => [issue.kind, issue.id, issue.path])).toEqual([
      ['anchor', 'object:deleted-car', 'layout.vehicle_bindings.0.position_key'], ['anchor', 'device:plug', 'layout.vehicle_bindings.1.position_key'],
    ]);
    expect(result.every((issue) => !('replacement' in issue))).toBe(true);
    expect(registryIssues(household(), layout)).toEqual([]);
  });
  it('does not infer missing geometry/floors from absent, malformed or explicitly unloaded context', () => {
    const layout = { presence_bindings: [{ entity: 'sensor.free', roomId: 'model:lounge', position_key: 'object:mount', position: { floorId: 'model-floor' } }] };
    const hass = { states: { 'sensor.free': state('sensor.free', 'ready') } };
    for (const context of [undefined, null, {}, { rooms: null, anchors: null }, { rooms: [], anchors: [], floors: [], ready: false }]) expect(registryIssues(hass, layout, {}, context)).toEqual([]);
    expect(registryIssues(hass, layout, {}, { rooms: [], anchors: [], floors: [] }).map((issue) => issue.code)).toEqual(['missing_floor', 'missing_room', 'missing_anchor']);
  });
  it('waits for missing HA states while still checking supplied loaded geometry', () => {
    const layout = { vacuum_bindings: [{ entity: 'vacuum.loading', identity_entity: 'sensor.loading', roomId: 'removed' }] };
    expect(registryIssues({}, layout)).toEqual([]);
    expect(registryIssues({}, layout, {}, { rooms: [] })).toMatchObject([{ code: 'missing_room', id: 'removed' }]);
  });
  it('keeps persisted tracking references untouched and clears errors only when the exact saved IDs return', () => {
    const hass = household(), layout = { presence_bindings: [{ entity: 'sensor.deleted', roomId: 'model:deleted', position_key: 'object:deleted' }] }, before = JSON.stringify(layout);
    hass.callWS = vi.fn(); hass.callService = vi.fn();
    const context = { rooms: [], anchors: [] };
    expect(registryIssues(hass, layout, {}, context)).toHaveLength(3);
    hass.states['sensor.deleted'] = state('sensor.deleted', 'ready'); context.rooms.push({ room: { id: 'model:deleted' } }); context.anchors.push({ id: 'object:deleted' });
    expect(registryIssues(hass, layout, {}, context)).toEqual([]); expect(JSON.stringify(layout)).toBe(before);
    expect(hass.callWS).not.toHaveBeenCalled(); expect(hass.callService).not.toHaveBeenCalled();
  });
  it('ignores malformed tracking lists and unrelated annotation text rather than guessing references', () => {
    const layout = { presence_bindings: 'broken', vehicle_bindings: [null, false, { note: 'sensor.deleted', entity: null }],
      vacuum_bindings: [{ label: 'vacuum.deleted', room_source: 'broken', position_source: false, position_key: null }] };
    expect(registryIssues(household(), layout, {}, { rooms: [], anchors: [] })).toEqual([]);
  });
  it('diagnoses saved camera entities and specific marker keys, honoring a layout override', () => {
    const config = { camera_coverage: { 'camera.deleted': { enabled: true } } };
    expect(registryIssues(household(), {}, config)).toMatchObject([{ id: 'camera.deleted', path: 'config.camera_coverage.camera.deleted' }]);
    expect(registryIssues(household(), { camera_coverage: {} }, config)).toEqual([]);
    expect(registryIssues(household(), { camera_coverage: { 'device:doorbell:camera.deleted': {} } })).toMatchObject([
      { id: 'camera.deleted', path: 'layout.camera_coverage.device:doorbell:camera.deleted' },
    ]);
  });
  it('reports explicit missing area/floor/entity/device references without modifying saved geometry or guessing replacements', () => {
    const hass = household();
    hass.states['sensor.replacement'] = state('sensor.replacement', '12', { friendly_name: 'Deleted lamp' });
    const layout = { rooms: [{ id: 'authored', area_id: 'deleted_area', polygon: [[0, 0], [4, 0], [4, 3]] }],
      model: { rooms: { kitchen: { area: 'deleted_area' } }, levels: { ground: { floor: 'deleted_floor' } } },
      objects: { lamp: { entity: 'sensor.deleted' } }, groups: { circuit: { entity: null } },
      pins: { 'device:deleted': { x: 1, y: 2, floor_id: 'ground' } } };
    const before = JSON.stringify(layout);
    expect(registryIssues(hass, layout)).toMatchObject([
      { code: 'missing_area', id: 'deleted_area', path: 'layout.rooms.0.area_id' },
      { code: 'missing_device', id: 'deleted', path: 'layout.pins.device:deleted' },
      { code: 'missing_area', id: 'deleted_area', path: 'layout.model.rooms.kitchen.area' },
      { code: 'missing_floor', id: 'deleted_floor', path: 'layout.model.levels.ground.floor' },
      { code: 'missing_entity', id: 'sensor.deleted', path: 'layout.objects.lamp.entity' },
    ]);
    expect(JSON.stringify(layout)).toBe(before);
    expect(registryIssues(hass, layout).every((issue) => !('replacement' in issue))).toBe(true);
  });

  it('accepts deliberate unassignment, state-only entities and layout-only floors', () => {
    const layout = { floors: [{ id: 'garden' }], rooms: [{ area_id: null, floor_id: 'garden' }],
      model: { rooms: { terrace: { area: null } }, levels: { terrace: { floor: 'garden' }, roof: { floor: null } } },
      objects: { gauge: { entity: 'sensor.free' }, empty: { entity: null } } };
    expect(registryIssues(household(), layout)).toEqual([]);
  });

  it('differentiates no-state registration from deletion and clears diagnostics when the exact ID returns', () => {
    const hass = household(), layout = { objects: { lamp: { entity: 'sensor.no_state' } } };
    expect(registryIssues(hass, layout)).toMatchObject([{ code: 'entity_no_state', id: 'sensor.no_state' }]);
    hass.states['sensor.no_state'] = state('sensor.no_state', '0');
    expect(registryIssues(hass, layout)).toEqual([]);
  });

  it('covers mower, view floors, overlay sources, alert entities and marker references', () => {
    const layout = { mower: { entity: 'device_tracker.deleted', floor_id: 'ground', overlay: { entity: 'camera.deleted' } },
      views: { closeup: { floors: ['deleted_floor', 'all'] } },
      room_overlays: { bindings: { authored: { entities: ['sensor.deleted', { entity: 'sensor.free' }] } } },
      alert_bindings: [{ entity: 'binary_sensor.deleted', floor_id: 'ground', position_key: 'device:deleted' }] };
    const result = registryIssues(household(), layout);
    expect(result.map((issue) => issue.id)).toEqual(['device_tracker.deleted', 'camera.deleted', 'deleted_floor', 'sensor.deleted', 'binary_sensor.deleted', 'deleted']);
  });

  it('only diagnoses effective YAML overlay/view/model bindings after saved overrides', () => {
    const config = { model: '/local/house.glb', model_floors: { ground: 'deleted_floor', roof: 'always' },
      views: { ground: { floors: ['deleted_floor'] } }, room_overlays: { bindings: { kitchen: ['sensor.deleted'] } },
      alert_bindings: [{ entity: 'binary_sensor.deleted' }] };
    expect(registryIssues(household(), {}, config)).toHaveLength(4);
    const layout = { model: { levels: { ground: { floor: 'ground' } } }, views: { ground: { floors: ['ground'] } },
      room_overlays: { bindings: {} }, alert_bindings: [] };
    expect(registryIssues(household(), layout, config)).toEqual([]);
    const legacyLayout = { model: { floor_map: { ground: 'ground' } } };
    expect(registryIssues(household(), legacyLayout, { model: config.model, model_floors: config.model_floors })).toEqual([]);
  });

  it('ignores arbitrary annotation text/model anchor IDs and waits for absent registries', () => {
    const layout = { rooms: [{ area_id: 'loading_area' }], pins: { 'device:loading': {} }, hidden: ['object:lamp'],
      objects: { lamp: { note: 'sensor.not_a_binding' } }, alert_bindings: [{ entity: 'sensor.free', position_key: 'mower' }] };
    expect(registryIssues({ states: { 'sensor.free': state('sensor.free', '1') } }, layout)).toEqual([]);
  });
});
