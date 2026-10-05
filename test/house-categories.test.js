import { describe, expect, it, vi } from 'vitest';
import { buildHouseCategory, HOUSE_CATEGORY_LIMITS } from '../src/house-categories.js';

const state = (entityId, value = 'off', attributes = {}) => ({ entity_id: entityId, state: value, attributes });
const fixture = () => ({
  connection: { connected: true }, user: { id: 'current-user', is_active: true, is_admin: false },
  states: {}, entities: {}, devices: {}, callService: vi.fn(),
});
const read = (hass, id, layout = {}) => buildHouseCategory({ hass, id, layout });
function add(hass, entityId, value = 'off', attributes = {}) {
  hass.states[entityId] = state(entityId, value, attributes);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

describe('current house category memberships', () => {
  it('returns fixed readable titles and sorted exact IDs without name inference', () => {
    const hass = fixture();
    add(hass, 'light.z', 'on', { friendly_name: 'A light' }); add(hass, 'light.a', 'off', { friendly_name: 'Z light' });
    add(hass, 'switch.light_named', 'on'); add(hass, 'sensor.brand_named_light', '20');
    expect(read(hass, 'lights')).toEqual({ id: 'lights', title: 'Lights', entityIds: ['light.a', 'light.z'], emptyText: 'No current visible lights are available.' });
    expect(read(hass, 'media')).toMatchObject({ title: 'Media', entityIds: [], emptyText: expect.stringContaining('media players') });
    expect(read(hass, 'cars')).toMatchObject({ title: 'Cars', entityIds: [], emptyText: expect.stringContaining('Edit → Tracking') });
  });

  it('includes genuine media, climate/weather and temperature/humidity sensors only', () => {
    const hass = fixture();
    for (const id of ['media_player.tv', 'climate.heat', 'weather.outside', 'fan.humidifier']) add(hass, id, 'unknown');
    for (const [name, device_class] of [['temp', 'temperature'], ['humidity', 'humidity'], ['power', 'power'], ['energy', 'energy'], ['gas', 'gas']]) add(hass, `sensor.${name}`, '1', { device_class });
    add(hass, 'sensor.named_temperature', '25', { friendly_name: 'Temperature' });
    hass.entities['sensor.registry_temp'] = { original_device_class: 'temperature' }; add(hass, 'sensor.registry_temp', '10');
    expect(read(hass, 'media').entityIds).toEqual(['media_player.tv']);
    expect(read(hass, 'climate').entityIds).toEqual(['climate.heat', 'sensor.humidity', 'sensor.registry_temp', 'sensor.temp', 'weather.outside']);
  });

  it('includes security domains and only explicitly classified binary sensors', () => {
    const hass = fixture();
    for (const domain of ['lock', 'alarm_control_panel', 'camera', 'switch', 'sensor']) add(hass, `${domain}.security_named`, 'unknown');
    const classes = ['door', 'window', 'garage_door', 'opening', 'smoke', 'moisture', 'safety', 'tamper', 'motion'];
    for (const device_class of [...classes, 'occupancy', 'presence', 'battery', 'power']) add(hass, `binary_sensor.${device_class}`, 'off', { device_class });
    add(hass, 'binary_sensor.front_door', 'on');
    expect(read(hass, 'security').entityIds).toEqual([
      'alarm_control_panel.security_named', ...classes.map((name) => `binary_sensor.${name}`), 'camera.security_named', 'lock.security_named',
    ].sort());
  });

  it('retains unknown/unavailable current sources without inventing availability or values', () => {
    const hass = fixture(); add(hass, 'light.available', 'on'); add(hass, 'light.unavailable', 'unavailable'); add(hass, 'light.unknown', 'unknown');
    hass.entities['light.registry_only'] = { name: 'No actual state' };
    expect(read(hass, 'lights').entityIds).toEqual(['light.available', 'light.unavailable', 'light.unknown']);
    const result = read(hass, 'lights'); expect(result).not.toHaveProperty('states'); expect(result).not.toHaveProperty('values');
  });

  it.each([
    { hidden: true }, { hidden_by: 'user' }, { disabled: true }, { disabled_by: 'integration' },
    { entity_category: 'diagnostic' }, { entity_category: 'config' }, { device_id: 'disabled-device' },
  ])('uses shared current registry exclusion %j', (registry) => {
    const hass = fixture(); add(hass, 'light.excluded', 'on'); add(hass, 'light.kept');
    hass.entities['light.excluded'] = registry; hass.devices['disabled-device'] = { disabled_by: 'user' };
    expect(read(hass, 'lights').entityIds).toEqual(['light.kept']);
  });

  it('allows legitimate false/null metadata and state-only entities', () => {
    const hass = fixture(); add(hass, 'light.a'); add(hass, 'light.b');
    hass.entities['light.a'] = { hidden: false, hidden_by: null, disabled: false, disabled_by: false, entity_category: null, device_id: 'one' };
    hass.devices.one = { disabled_by: null }; hass.entities['light.b'] = null;
    expect(read(hass, 'lights').entityIds).toEqual(['light.a', 'light.b']);
  });

  it('re-reads membership, metadata and current state rather than caching the first list', () => {
    const hass = fixture(); add(hass, 'light.one');
    const first = read(hass, 'lights'); add(hass, 'light.two'); delete hass.states['light.one'];
    expect(read(hass, 'lights').entityIds).toEqual(['light.two']); expect(first.entityIds).toEqual(['light.one']);
    hass.entities['light.two'] = { hidden_by: 'user' }; expect(read(hass, 'lights').entityIds).toEqual([]);
    hass.entities['light.two'] = {}; expect(read(hass, 'lights').entityIds).toEqual(['light.two']);
  });
});

describe('explicit saved vehicle sources', () => {
  it('lists only exact enabled flat saved entity and identity_entity references, deduplicated', () => {
    const hass = fixture();
    for (const id of ['binary_sensor.driveway', 'sensor.plate', 'device_tracker.named_vehicle', 'sensor.car_count', 'camera.car_camera', 'sensor.other']) add(hass, id, 'unavailable');
    const layout = { vehicle_bindings: [
      { id: 'drive', kind: 'occupancy', entity: 'binary_sensor.driveway', identity_entity: 'sensor.plate' },
      { id: 'count', enabled: true, entity: 'sensor.car_count', identity_entity: 'sensor.plate' },
      { id: 'disabled', enabled: false, entity: 'camera.car_camera' },
      { entity: 'sensor.removed', identity_entity: 'sensor.plate' },
    ], tracking: { vehicle_bindings: [{ entity: 'sensor.other' }] } };
    expect(read(hass, 'cars', layout).entityIds).toEqual(['binary_sensor.driveway', 'sensor.car_count', 'sensor.plate']);
    expect(read(hass, 'cars', {} ).entityIds).toEqual([]);
    expect(read(hass, 'cars', { tracking: layout.tracking }).entityIds).toEqual([]);
  });

  it('lists selected sources without claiming a parked car or named identity', () => {
    const hass = fixture(); add(hass, 'sensor.car_motion', 'on', { device_class: 'motion' }); add(hass, 'sensor.plate', 'unknown');
    const result = read(hass, 'cars', { vehicle_bindings: [{ entity: 'sensor.car_motion', identity_entity: 'sensor.plate' }] });
    expect(result.entityIds).toEqual(['sensor.car_motion', 'sensor.plate']);
    expect(Object.keys(result)).toEqual(['id', 'title', 'entityIds', 'emptyText']);
  });

  it('applies identical metadata/session exclusions to explicit vehicle sources', () => {
    const hass = fixture(); for (const id of ['sensor.hidden', 'sensor.disabled', 'sensor.restored', 'sensor.diagnostic', 'sensor.kept']) add(hass, id, 'unavailable');
    hass.entities['sensor.hidden'] = { hidden: true }; hass.entities['sensor.disabled'] = { device_id: 'blocked' };
    hass.devices.blocked = { disabled_by: 'user' }; hass.entities['sensor.diagnostic'] = { entity_category: 'diagnostic' };
    hass.states['sensor.restored'].attributes.restored = true;
    const layout = { vehicle_bindings: Object.keys(hass.states).map((entity) => ({ entity })) };
    expect(read(hass, 'cars', layout).entityIds).toEqual(['sensor.kept']);
    hass.connection.connected = false; expect(read(hass, 'cars', layout)).toBeNull();
  });

  it.each([null, false, 'sensor.one', {}, undefined])('diagnoses a malformed owned saved array %s', (vehicle_bindings) => {
    expect(read(fixture(), 'cars', { vehicle_bindings })).toMatchObject({ entityIds: [], emptyText: expect.stringContaining('need review') });
  });

  it('does not accept inherited bindings, inherited sources or malformed enabled flags', () => {
    const hass = fixture(); add(hass, 'sensor.one'); add(hass, 'sensor.two');
    const inherited = Object.create({ entity: 'sensor.one' });
    const layout = { vehicle_bindings: [inherited, { entity: 'sensor.one', enabled: 'true' }, { identity_entity: 'sensor.two' }] };
    expect(read(hass, 'cars', layout).entityIds).toEqual(['sensor.two']);
    expect(read(hass, 'cars', Object.create({ vehicle_bindings: [{ entity: 'sensor.one' }] })).entityIds).toEqual([]);
  });
});

describe('current authenticated session and malformed inputs', () => {
  it.each([undefined, null, {}, [], 'lights', { id: 'unknown' }, { id: '__proto__' }, { id: 'constructor' }])('returns null for unusable options %s', (options) => {
    expect(buildHouseCategory(options)).toBeNull();
  });

  it.each([undefined, { connected: false }, { connected: 'true' }, { connected: null }])('does not reveal old entity IDs with connection %s', (connection) => {
    const hass = fixture(); add(hass, 'light.old'); hass.connection = connection;
    expect(read(hass, 'lights')).toBeNull();
  });

  it.each([undefined, {}, { id: '' }, { id: '   ' }, { id: 1 }, { id: 'one', is_active: false }, { id: 'one', is_active: null },
    { id: 'one', is_active: undefined }, { id: 'one', is_active: 'true' }, { id: 'one\nuser' }])('rejects missing/inactive/malformed current user %s', (user) => {
    const hass = fixture(); add(hass, 'light.old'); hass.user = user;
    expect(read(hass, 'lights')).toBeNull();
  });

  it('accepts older actual user shape and a HA Connection class getter, with no admin requirement', () => {
    class Connection { constructor() { this.online = true; } get connected() { return this.online; } }
    const hass = fixture(); add(hass, 'light.one'); hass.user = { id: 'one', is_admin: false }; hass.connection = new Connection();
    expect(read(hass, 'lights').entityIds).toEqual(['light.one']);
    hass.connection.online = false; expect(read(hass, 'lights')).toBeNull();
    hass.connection.online = true; hass.user = { id: 'new-user' }; expect(read(hass, 'lights').entityIds).toEqual(['light.one']);
  });

  it('excludes restored, malformed, inherited or mismatched source snapshots without invoking getters', () => {
    const hass = fixture(), invoked = vi.fn(() => { throw new Error('No getters'); });
    add(hass, 'light.ok'); add(hass, 'light.restored', 'on', { restored: true }); add(hass, 'light.bad_restored', 'on', { restored: 'false' });
    hass.states['light.bad_id'] = state('light.different'); hass.states['light.inherited'] = Object.create({ state: 'on', attributes: {} });
    hass.states['light.bad_attrs'] = { state: 'on', attributes: [] }; hass.states['light.bad_state'] = { state: 1, attributes: {} };
    hass.states['light.getter'] = { attributes: {} }; Object.defineProperty(hass.states['light.getter'], 'state', { get: invoked });
    Object.defineProperty(hass.states, 'light.entry_getter', { enumerable: true, get: invoked });
    add(hass, 'light.registry_getter'); hass.entities['light.registry_getter'] = {}; Object.defineProperty(hass.entities['light.registry_getter'], 'hidden', { get: invoked });
    add(hass, 'light.device_getter'); hass.entities['light.device_getter'] = { device_id: 'bad' }; hass.devices.bad = {}; Object.defineProperty(hass.devices.bad, 'disabled_by', { get: invoked });
    expect(read(hass, 'lights').entityIds).toEqual(['light.ok']); expect(invoked).not.toHaveBeenCalled();
  });

  it.each(['states', 'entities', 'devices'])('fails malformed dictionary %s as a whole, rather than an unexplained partial list', (key) => {
    const hass = fixture(); add(hass, 'light.one'); hass[key] = Object.create({ 'light.old': state('light.old') });
    expect(read(hass, 'lights')).toMatchObject({ entityIds: [], emptyText: expect.stringContaining('could not be read') });
  });

  it('rejects prototype categories and ignores inherited dictionary IDs while allowing null-prototype JSON maps', () => {
    const hass = fixture(); hass.states = Object.create(null); hass.entities = Object.create(null); hass.devices = Object.create(null); add(hass, 'light.one');
    expect(read(hass, 'lights').entityIds).toEqual(['light.one']);
    expect(read(hass, '__proto__')).toBeNull(); expect(buildHouseCategory(Object.create({ hass, id: 'lights' }))).toBeNull();
  });

  it('has no DOM, clock, HA services, formatter calls or mutation, and output arrays own their contents', () => {
    const hass = fixture(); add(hass, 'light.one'); hass.formatEntityName = vi.fn(() => { throw new Error('No formatter'); });
    const layout = { vehicle_bindings: [{ entity: 'light.one' }] }; freeze(hass); freeze(layout);
    const before = JSON.stringify({ hass, layout }), clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('No clock'); });
    try {
      const a = read(hass, 'lights'), b = read(hass, 'cars', layout); a.entityIds.push('light.fake'); b.entityIds.length = 0;
      expect(read(hass, 'lights').entityIds).toEqual(['light.one']); expect(read(hass, 'cars', layout).entityIds).toEqual(['light.one']);
      expect(JSON.stringify({ hass, layout })).toBe(before); expect(hass.callService).not.toHaveBeenCalled(); expect(hass.formatEntityName).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
});

describe('whole-list budgets', () => {
  it('allows exactly 512 current matching rows and rejects overflow without silently truncating', () => {
    const hass = fixture();
    for (let index = 0; index < HOUSE_CATEGORY_LIMITS.entities; index++) add(hass, `light.l${index}`);
    expect(read(hass, 'lights').entityIds).toHaveLength(512);
    add(hass, 'light.overflow'); const result = read(hass, 'lights');
    expect(result.entityIds).toEqual([]); expect(result.emptyText).toContain('More than 512');
  });

  it('does not mistake a large unrelated HA registry for too many matching lights', () => {
    const hass = fixture(); for (let index = 0; index < 800; index++) add(hass, `sensor.s${index}`, '1'); add(hass, 'light.one');
    expect(read(hass, 'lights').entityIds).toEqual(['light.one']);
  });

  it('rejects saved vehicle-binding overflow even when rows repeat or are disabled', () => {
    const hass = fixture(); add(hass, 'sensor.one');
    const layout = { vehicle_bindings: Array.from({ length: HOUSE_CATEGORY_LIMITS.vehicleBindings + 1 }, () => ({ entity: 'sensor.one', enabled: false })) };
    expect(read(hass, 'cars', layout)).toMatchObject({ entityIds: [], emptyText: expect.stringContaining('Too many saved vehicle bindings') });
  });

  it('rejects pathological state dictionary size before reading values', () => {
    const hass = fixture(), getter = vi.fn(); hass.states = Object.create(null);
    for (let index = 0; index <= HOUSE_CATEGORY_LIMITS.states; index++) Object.defineProperty(hass.states, `sensor.s${index}`, { enumerable: true, get: getter });
    expect(read(hass, 'lights')).toMatchObject({ entityIds: [], emptyText: expect.stringContaining('Too many Home Assistant entities') });
    expect(getter).not.toHaveBeenCalled();
  });
});
