import { describe, expect, it, vi } from 'vitest';
import { buildHouseSummary, readHouseSummary, HOUSE_SUMMARY_LIMITS } from '../src/house-summary.js';

const state = (id, value, attributes = {}) => ({ entity_id: id, state: value, attributes,
  last_changed: '2000-01-01T00:00:00Z', last_updated: '2000-01-01T00:00:00Z' });
const fixture = () => ({
  connection: { connected: true }, user: { id: 'current-user', is_active: true, is_admin: false },
  config: { location_name: 'My home', unit_system: { temperature: '°F' } },
  states: {
    'weather.selected': state('weather.selected', 'sunny', { temperature: 0, temperature_unit: '°C', friendly_name: 'Selected weather' }),
    'person.one': state('person.one', 'home', { friendly_name: 'One' }),
    'person.two': state('person.two', 'not_home', { friendly_name: 'Two' }),
    'person.three': state('person.three', 'Work', { friendly_name: 'Three' }),
    'zone.work': state('zone.work', '1', { friendly_name: 'Work', passive: false }),
    'alarm_control_panel.selected': state('alarm_control_panel.selected', 'armed_home'),
    'light.rgb': state('light.rgb', 'on', { color_mode: 'rgb', supported_color_modes: ['rgb'], brightness: 255, rgb_color: [255, 0, 0] }),
    'light.off': state('light.off', 'off'),
    'light.legacy': state('light.legacy', 'on'),
    'sensor.motion': state('sensor.motion', 'on', { device_class: 'motion' }),
    'person.unselected': state('person.unselected', 'home'),
  },
  entities: {}, devices: {}, callService: vi.fn(),
});
const settings = () => ({ title: 'My house', weather_entity: 'weather.selected',
  person_entities: ['person.one', 'person.two', 'person.three'], alarm_entity: 'alarm_control_panel.selected' });
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

describe('future house-summary settings and explicit sources', () => {
  it('defaults to actual HA title and eligible lamps without auto-selecting people, weather or alarm', () => {
    const hass = fixture(), result = buildHouseSummary(hass);
    expect(result.title).toEqual({ text: 'My home', source: 'home_assistant' });
    expect(result.weather).toMatchObject({ status: 'not_configured', entity: null, temperature: null });
    expect(result.people).toMatchObject({ status: 'not_configured', rows: [], total: 0, home: 0 });
    expect(result.alarm).toMatchObject({ status: 'not_configured', entity: null, state: null });
    expect(result.lights).toMatchObject({ on: 2, off: 1, unknown: 0, total: 3, label: '2 lights on' });
    expect(hass.callService).not.toHaveBeenCalled();
  });

  it('uses a configured title, actual weather, selected people and exact alarm state', () => {
    const result = buildHouseSummary(fixture(), settings());
    expect(result.title).toEqual({ text: 'My house', source: 'configured' });
    expect(result.weather).toMatchObject({ status: 'ready', condition: 'sunny', temperature: 0, unit: '°C', temperatureLabel: '0 °C', label: 'Sunny · 0 °C' });
    expect(result.people).toMatchObject({ status: 'ready', home: 1, away: 1, other: 1, unknown: 0, total: 3, label: '1 of 3 selected people home' });
    expect(result.people.rows[2]).toMatchObject({ entity: 'person.three', location: 'other', zoneEntity: 'zone.work', label: 'Work' });
    expect(result.alarm).toMatchObject({ status: 'ready', entity: 'alarm_control_panel.selected', state: 'armed_home', severity: 'armed', label: 'Armed at home' });
    expect(result.weather.evidence).toEqual({ basis: 'current', ageVerified: false });
  });

  it('fallback title has no sample address and needs no browser or wall clock', () => {
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('No clock'); });
    try {
      expect(buildHouseSummary().title).toEqual({ text: "Taylor's 3D", source: 'default' });
      const hass = fixture(); delete hass.config.location_name;
      expect(buildHouseSummary(hass).title.text).toBe("Taylor's 3D");
      expect(buildHouseSummary(hass).lights).toMatchObject({ on: 2, evidence: { ageVerified: false } });
    } finally { clock.mockRestore(); }
  });

  it.each([null, [], 'wrong', true, 1, new Date(0)])('diagnoses malformed settings %s without guessing selections', (raw) => {
    const result = buildHouseSummary(fixture(), raw);
    expect(result.valid).toBe(false);
    expect(result.weather.status).toBe('not_configured');
    expect(result.people.rows).toEqual([]);
  });

  it.each(['', '  ', false, null, 'a'.repeat(129)])('diagnoses invalid title %s and safely falls back', (title) => {
    expect(buildHouseSummary(fixture(), { title })).toMatchObject({ valid: false, title: { text: 'My home' }, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'title' })]) });
  });

  it('keeps missing/wrong-domain selections explicit, with no similar-name replacement', () => {
    const hass = fixture(), raw = { weather_entity: 'weather.selected_old', alarm_entity: 'alarm_control_panel.old',
      person_entities: ['person.one_old', 'sensor.motion', ' person.one'] };
    const result = buildHouseSummary(hass, raw);
    expect(result.weather).toMatchObject({ entity: 'weather.selected_old', status: 'unavailable', reason: 'missing', temperature: null });
    expect(result.alarm).toMatchObject({ entity: 'alarm_control_panel.old', status: 'unavailable', state: null });
    expect(result.people.rows.map((row) => [row.entity, row.location])).toEqual([
      ['person.one_old', 'unknown'], ['sensor.motion', 'unknown'], [' person.one', 'unknown'],
    ]);
    expect(result.people.home).toBe(0);
  });

  it('bounds the explicit list and diagnoses duplicates instead of claiming a full household total', () => {
    const people = Array.from({ length: HOUSE_SUMMARY_LIMITS.people + 2 }, (_, index) => `person.p${index}`);
    const result = buildHouseSummary(fixture(), { person_entities: people });
    expect(result.people).toMatchObject({ status: 'invalid', total: 12, configured: 14, omitted: 2, complete: false, label: 'People summary needs configuration' });
    const duplicate = buildHouseSummary(fixture(), { person_entities: ['person.one', 'person.one'] });
    expect(duplicate.people).toMatchObject({ status: 'invalid', home: 0, unknown: 2, complete: false });
    expect(duplicate.people.rows.every((row) => row.reason === 'duplicate_person')).toBe(true);
    expect(readHouseSummary({ person_entities: 'person.one' }).valid).toBe(false);
  });

  it('preserves raw extensions and returns labels rather than mutable HA state references', () => {
    const raw = freeze({ ...settings(), vendor: { nested: ['keep', 5] } }), hass = fixture();
    freeze(hass); const before = JSON.stringify({ raw, hass });
    const result = buildHouseSummary(hass, raw);
    result.people.rows[0].label = 'Only output'; result.weather.temperature = 99;
    expect(JSON.stringify({ raw, hass })).toBe(before);
    expect(result.people.rows[0]).not.toHaveProperty('state');
    expect(hass.callService).not.toHaveBeenCalled();
  });
});

describe('current authenticated session and source uncertainty', () => {
  it.each([undefined, { connected: false }, { connected: 'true' }, { connected: null }])('does not expose cached readings with connection %s', (connection) => {
    const hass = fixture(); hass.connection = connection;
    const result = buildHouseSummary(hass, settings());
    expect(result.session.status).not.toBe('ready');
    expect(result.weather).toMatchObject({ status: 'unavailable', temperature: null });
    expect(result.people).toMatchObject({ status: 'unavailable', home: 0, unknown: 3 });
    expect(result.alarm).toMatchObject({ status: 'unavailable', state: null });
    expect(result.lights).toMatchObject({ status: 'unavailable', on: 0, off: 0, unknown: 3 });
  });

  it.each([undefined, {}, { id: '' }, { id: '   ' }, { id: 3 }, { id: 'one', is_active: false }, { id: 'one', is_active: null }, { id: 'one', is_active: 'true' }, { id: 'one', is_active: undefined }])('rejects missing/malformed/inactive user %s', (user) => {
    const hass = fixture(); hass.user = user;
    expect(buildHouseSummary(hass, settings())).toMatchObject({ session: { status: 'unavailable' }, weather: { temperature: null }, lights: { on: 0, unknown: 3 } });
  });

  it('accepts an older HA active user shape without an is_active field and never requires admin to read', () => {
    const hass = fixture(); hass.user = { id: 'current', is_admin: false };
    expect(buildHouseSummary(hass, settings())).toMatchObject({ session: { status: 'ready' }, lights: { on: 2 }, weather: { status: 'ready' } });
  });

  it.each(['weather.selected', 'person.one', 'alarm_control_panel.selected'])('preserves selected %s when hidden/disabled', (id) => {
    for (const registry of [{ hidden: true }, { hidden_by: 'user' }, { disabled_by: 'integration' }, { entity_category: 'diagnostic' }, { device_id: 'blocked' }]) {
      const hass = fixture(); hass.entities[id] = registry; hass.devices.blocked = { disabled_by: 'user' };
      const result = buildHouseSummary(hass, settings());
      const selected = id.startsWith('weather.') ? result.weather : id.startsWith('person.') ? result.people.rows[0] : result.alarm;
      expect(selected).toMatchObject({ entity: id, status: 'unavailable' });
      expect(selected.reason).toMatch(/hidden|disabled/);
    }
  });

  it.each(['unknown', 'unavailable'])('labels %s readings uncertain rather than using retained attributes', (value) => {
    const hass = fixture();
    for (const id of ['weather.selected', 'person.one', 'alarm_control_panel.selected']) hass.states[id].state = value;
    const result = buildHouseSummary(hass, settings());
    expect(result.weather.temperature).toBe(null);
    expect(result.people.rows[0]).toMatchObject({ location: 'unknown', label: 'Location unavailable' });
    expect(result.alarm).toMatchObject({ state: null, severity: 'unknown', label: 'Alarm unavailable' });
  });

  it.each([true, 'true', 1, null, undefined])('does not treat present restored flag %s as a current reading', (restored) => {
    const hass = fixture();
    for (const id of Object.keys(hass.states)) hass.states[id].attributes.restored = restored;
    const result = buildHouseSummary(hass, settings());
    expect(result.weather.temperature).toBe(null);
    expect(result.people.home).toBe(0);
    expect(result.alarm.state).toBe(null);
    expect(result.lights).toMatchObject({ on: 0, off: 0, unknown: 3 });
  });

  it('refuses mismatched entity state identity and malformed source attributes', () => {
    const hass = fixture(); hass.states['weather.selected'].entity_id = 'weather.other';
    hass.states['person.one'].attributes = []; hass.states['alarm_control_panel.selected'].attributes = null;
    const result = buildHouseSummary(hass, settings());
    expect(result.weather).toMatchObject({ status: 'invalid', reason: 'source_entity', temperature: null });
    expect(result.people.rows[0]).toMatchObject({ status: 'invalid', reason: 'attributes', location: 'unknown' });
    expect(result.alarm).toMatchObject({ status: 'invalid', reason: 'attributes', state: null });
  });
});

describe('reported weather units, people zones, alarm states and lamp counts', () => {
  it.each(['', '12', true, null, undefined, NaN, Infinity, -Infinity])('does not invent numeric temperature from %s', (temperature) => {
    const hass = fixture(); hass.states['weather.selected'].attributes.temperature = temperature;
    expect(buildHouseSummary(hass, settings()).weather).toMatchObject({ status: 'unavailable', temperature: null, unit: null, temperatureLabel: null });
  });

  it.each([undefined, '', 'C', true, null, 'K'])('does not substitute HA default units for missing/malformed weather unit %s', (unit) => {
    const hass = fixture(); hass.states['weather.selected'].attributes.temperature_unit = unit;
    expect(buildHouseSummary(hass, settings()).weather).toMatchObject({ status: 'unavailable', temperature: null, unit: null });
  });

  it('prefers bound HA native formatters without duplicated units, and does not convert the raw value', () => {
    const hass = fixture(); hass.states['weather.selected'].attributes.temperature = -12.5;
    hass.states['weather.selected'].attributes.temperature_unit = '°F';
    hass.formatEntityState = function (source) { expect(this).toBe(hass); return source.entity_id === 'weather.selected' ? 'Sonnig' : source.state; };
    hass.formatEntityAttributeValue = function (source, attribute) { expect(this).toBe(hass); expect(source).toBe(hass.states['weather.selected']); expect(attribute).toBe('temperature'); return '-12,5 °F'; };
    expect(buildHouseSummary(hass, settings()).weather).toMatchObject({ temperature: -12.5, unit: '°F', label: 'Sonnig · -12,5 °F' });
  });

  it('ignores forecast temperatures and unsupported conditions', () => {
    const hass = fixture(); delete hass.states['weather.selected'].attributes.temperature;
    hass.states['weather.selected'].attributes.forecast = [{ temperature: 21 }];
    expect(buildHouseSummary(hass, settings()).weather.temperature).toBe(null);
    hass.states['weather.selected'].attributes.temperature = 10;
    hass.states['weather.selected'].state = 'made_up_weather';
    expect(buildHouseSummary(hass, settings()).weather).toMatchObject({ status: 'invalid', temperature: null });
  });

  it('keeps unsupported person strings uncertain and never uses motion/area metadata as identity', () => {
    const hass = fixture(); hass.states['person.one'].state = 'office';
    hass.entities['person.one'] = { area_id: 'office' }; hass.areas = { office: { name: 'Office' } };
    expect(buildHouseSummary(hass, settings()).people.rows[0]).toMatchObject({ status: 'unknown', location: 'unknown', reason: 'unknown_zone' });
    expect(buildHouseSummary(hass, { person_entities: [] }).people).toMatchObject({ rows: [], home: 0, total: 0 });
  });

  it('requires an exact unique current visible non-passive zone, with no slug/name-case guess', () => {
    for (const change of [
      (h) => { h.states['person.three'].state = 'work'; },
      (h) => { h.states['zone.work'].attributes.passive = true; },
      (h) => { h.states['zone.work'].attributes.restored = true; },
      (h) => { h.entities['zone.work'] = { hidden: true }; },
      (h) => { h.states['zone.work'].state = 'unknown'; },
      (h) => { h.states['zone.work'].state = 'not_a_count'; },
      (h) => { h.states['zone.second'] = state('zone.second', '1', { friendly_name: 'Work' }); },
    ]) {
      const hass = fixture(); change(hass);
      expect(buildHouseSummary(hass, settings()).people.rows[2]).toMatchObject({ status: 'unknown', location: 'unknown', zoneEntity: null });
    }
  });

  it.each(['disarmed', 'armed_home', 'armed_away', 'armed_night', 'armed_vacation', 'armed_custom_bypass', 'pending', 'arming', 'disarming', 'triggered'])('shows actual known alarm state %s without a secure-house claim', (value) => {
    const hass = fixture(); hass.states['alarm_control_panel.selected'].state = value;
    expect(buildHouseSummary(hass, settings()).alarm).toMatchObject({ status: 'ready', state: value });
  });

  it('labels an unsupported alarm state uncertain, never disarmed or secure', () => {
    const hass = fixture(); hass.states['alarm_control_panel.selected'].state = 'on';
    expect(buildHouseSummary(hass, settings()).alarm).toMatchObject({ status: 'unknown', state: null, severity: 'unknown', label: 'Alarm state unknown' });
  });

  it('counts only current eligible light entities, with registry-only/unavailable/malformed lights unknown', () => {
    const hass = fixture();
    hass.entities['light.hidden'] = { hidden_by: 'user' }; hass.states['light.hidden'] = state('light.hidden', 'on');
    hass.entities['light.disabled'] = { device_id: 'disabled' }; hass.devices.disabled = { disabled_by: 'user' };
    hass.states['light.disabled'] = state('light.disabled', 'on');
    hass.entities['light.diag'] = { entity_category: 'config' }; hass.states['light.diag'] = state('light.diag', 'on');
    hass.entities['light.registered_only'] = { name: 'No state' };
    hass.states['light.bad'] = state('light.bad', 'on', { color_mode: 'rgb', brightness: '255', rgb_color: [255, 0, 0] });
    hass.states['light.offline'] = state('light.offline', 'unavailable', { brightness: 255 });
    expect(buildHouseSummary(hass).lights).toMatchObject({ status: 'partial', on: 2, off: 1, unknown: 3, total: 6, excluded: 3, label: '2 lights on · 3 unknown' });
  });

  it('counts trustworthy HA on at zero/black output as on, and uses singular text', () => {
    const hass = fixture(); delete hass.states['light.legacy'];
    hass.states['light.rgb'].attributes.brightness = 0;
    hass.states['light.rgb'].attributes.rgb_color = [0, 0, 0];
    expect(buildHouseSummary(hass).lights).toMatchObject({ on: 1, off: 1, unknown: 0, label: '1 light on' });
    hass.states['light.rgb'].attributes.brightness = 128;
    expect(buildHouseSummary(hass).lights.on).toBe(1);
  });

  it('does not expire unchanged lights/person states by last_changed or claim zero unknown lights are all off', () => {
    const hass = fixture(); hass.states['light.rgb'].state = 'unknown'; hass.states['light.legacy'].state = 'unknown';
    expect(buildHouseSummary(hass).lights).toMatchObject({ on: 0, unknown: 2, label: '0 lights on · 2 unknown' });
    expect(buildHouseSummary(hass, settings()).people.home).toBe(1);
    expect(buildHouseSummary({ ...hass, states: {}, entities: {} }).lights).toMatchObject({ status: 'empty', label: 'No lights available', total: 0 });
  });
});
