// Future header data only. No DOM, clock, services, storage or inferred occupancy.
// house_summary: {title?, weather_entity?, person_entities?:[], alarm_entity?}.
// HA person states are home/not_home or the exact name of a configured zone:
// https://www.home-assistant.io/integrations/person/
import { entityMetadata, formatEntityValue } from './entity-metadata.js';
import { readLightAppearance } from './light-state.js';
import { readFreshness } from './tracked-source.js';
import { readWeather } from './weather.js';
import { localize } from './localization.js';

export const HOUSE_SUMMARY_LIMITS = Object.freeze({ title: 128, people: 12, entity: 255 });
const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const record = (value) => plain(value) ? value : {};
const issue = (code, message, extra = {}) => ({ code, message, ...extra });
const exactEntity = (value, domain) => typeof value === 'string' && value.length <= HOUSE_SUMMARY_LIMITS.entity
  && new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(value);
const validTitle = (value) => typeof value === 'string' && !!value.trim() && value.trim().length <= HOUSE_SUMMARY_LIMITS.title;
const alarms = Object.freeze({
  disarmed: ['Disarmed', 'neutral'], armed_home: ['Armed at home', 'armed'],
  armed_away: ['Armed away', 'armed'], armed_night: ['Armed at night', 'armed'],
  armed_vacation: ['Armed for vacation', 'armed'], armed_custom_bypass: ['Armed with bypass', 'armed'],
  pending: ['Alarm pending', 'warning'], arming: ['Arming', 'pending'],
  disarming: ['Disarming', 'pending'], triggered: ['Alarm triggered', 'danger'],
});

/** Normalize known fields without changing the saved object or guessing replacements.
 * Invalid selected strings remain present so the caller can show a deliberate repair.
 */
export function readHouseSummary(value) {
  const out = { title: null, weather_entity: null, person_entities: [], alarm_entity: null,
    configuredPeople: 0, omittedPeople: 0, valid: true, diagnostics: [] };
  if (value === undefined) return out;
  if (!plain(value)) return { ...out, valid: false, diagnostics: [issue('settings', 'House summary settings must be an object.')] };
  if (Object.hasOwn(value, 'title')) {
    if (validTitle(value.title)) out.title = value.title.trim();
    else out.diagnostics.push(issue('title', `Choose a nonblank title of at most ${HOUSE_SUMMARY_LIMITS.title} characters.`, { path: 'title' }));
  }
  for (const [field, domain] of [['weather_entity', 'weather'], ['alarm_entity', 'alarm_control_panel']]) {
    if (!Object.hasOwn(value, field)) continue;
    out[field] = typeof value[field] === 'string' ? value[field] : null;
    if (!exactEntity(value[field], domain)) out.diagnostics.push(issue('entity', `Choose an exact ${domain} entity ID.`, { path: field, entity: out[field] }));
  }
  if (Object.hasOwn(value, 'person_entities')) {
    if (!Array.isArray(value.person_entities)) out.diagnostics.push(issue('people', 'Select an explicit list of person entities.', { path: 'person_entities' }));
    else {
      out.configuredPeople = value.person_entities.length;
      out.omittedPeople = Math.max(0, out.configuredPeople - HOUSE_SUMMARY_LIMITS.people);
      out.person_entities = value.person_entities.slice(0, HOUSE_SUMMARY_LIMITS.people).map((id, index) => {
        if (!exactEntity(id, 'person')) out.diagnostics.push(issue('entity', 'Choose an exact person entity ID.', { path: `person_entities[${index}]`, entity: typeof id === 'string' ? id : null }));
        return typeof id === 'string' ? id : null;
      });
      if (out.omittedPeople) out.diagnostics.push(issue('people_limit', `Select at most ${HOUSE_SUMMARY_LIMITS.people} people. The incomplete list is not a household total.`, { path: 'person_entities' }));
      const seen = new Set();
      for (const [index, id] of out.person_entities.entries()) {
        if (seen.has(id)) out.diagnostics.push(issue('duplicate_person', 'Each person must appear only once.', { path: `person_entities[${index}]`, entity: id }));
        seen.add(id);
      }
    }
  }
  out.valid = !out.diagnostics.length;
  return out;
}

function readSession(hass) {
  if (hass?.connection?.connected !== true) return { status: hass?.connection ? 'unavailable' : 'waiting',
    reason: 'connection', label: localize(hass, 'house.header.waiting'), diagnostics: [issue('connection', 'Current readings need an established Home Assistant connection.')] };
  const user = record(hass.user);
  if (typeof user.id !== 'string' || !user.id.trim() || Object.hasOwn(user, 'is_active') && user.is_active !== true)
    return { status: 'unavailable', reason: 'authentication', label: localize(hass, 'house.header.sessionUnavailable'),
      diagnostics: [issue('authentication', 'Current readings need an active authenticated Home Assistant user.')] };
  return { status: 'ready', reason: null, label: localize(hass, 'house.header.connected'), diagnostics: [] };
}

function currentSource(hass, entity, domain, session) {
  const metadata = entityMetadata(hass, entity || '');
  const base = { entity, name: metadata.name, status: 'unavailable', reason: null, diagnostics: [], evidence: null };
  const fail = (reason, message, status = 'unavailable') => ({ ...base, status, reason,
    diagnostics: [issue(reason, message, { entity })] });
  if (!exactEntity(entity, domain)) return fail('entity', `Choose an exact ${domain} entity ID.`, 'invalid');
  if (session.status !== 'ready') return fail(session.reason, 'This saved selection is waiting for a current Home Assistant session.');
  if (metadata.disabled) return fail('disabled', 'The selected entity or its device is disabled.');
  if (metadata.hidden || metadata.category) return fail('hidden', 'The selected entity is hidden or administrative/diagnostic.');
  if (!metadata.hasState) return fail('missing', 'This saved selection has no current Home Assistant state.');
  const state = metadata.state;
  if (state.entity_id !== undefined && state.entity_id !== entity) return fail('source_entity', 'The reading belongs to a different entity.', 'invalid');
  if (state.attributes !== undefined && !plain(state.attributes)) return fail('attributes', 'The source attributes are malformed.', 'invalid');
  if (Object.hasOwn(record(state.attributes), 'restored') && typeof state.attributes.restored !== 'boolean')
    return fail('restored', 'The restored-state flag is malformed.', 'invalid');
  // Reuse current-source validation only. An old last_changed is not a heartbeat.
  // The reader's clock argument is irrelevant without a configured timestamp rule.
  const freshness = readFreshness(state, {}, 0);
  if (freshness.status !== 'current') return fail(state.attributes?.restored === true ? 'restored' : freshness.status,
    'A current non-restored source reading is unavailable.', freshness.status === 'invalid' ? 'invalid' : 'unavailable');
  return { ...base, status: 'ready', state, evidence: { basis: freshness.basis, ageVerified: freshness.verified } };
}

const sourceLabels = ({ state: _state, ...source }) => source;

function nativeStateLabel(hass, state, fallback) {
  if (typeof hass.formatEntityState === 'function') {
    try { const label = hass.formatEntityState(state); if (typeof label === 'string' && label.trim()) return label; } catch { /* English fallback. */ }
  }
  return fallback;
}

function weatherSummary(hass, entity, configured, session) {
  const empty = { entity, name: null, status: 'not_configured', reason: null, condition: null, conditionLabel: null,
    temperature: null, unit: null, temperatureLabel: null, label: 'Weather not configured', evidence: null, diagnostics: [] };
  if (!configured) return empty;
  const source = currentSource(hass, entity, 'weather', session);
  if (source.status !== 'ready') return { ...empty, ...sourceLabels(source), label: localize(hass, 'house.header.weatherUnavailable') };
  const reading = readWeather(hass, { enabled: true, entity, quality: 'static', effects: [] });
  if (reading.status !== 'ready') return { ...empty, ...sourceLabels(source), status: reading.status === 'invalid' ? 'invalid' : 'unavailable',
    reason: 'condition', label: localize(hass, 'house.header.weatherUnavailable'), diagnostics: reading.diagnostics };
  const { temperature, temperature_unit: unit } = source.state.attributes || {};
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || !['°C', '°F'].includes(unit)) {
    return { ...empty, ...sourceLabels(source), status: 'unavailable', reason: 'temperature', label: localize(hass, 'house.header.weatherUnavailable'),
      diagnostics: [issue('temperature', 'Current weather needs a finite numeric temperature and its reported °C or °F unit.', { entity })] };
  }
  const temperatureLabel = formatEntityValue(hass, entity, { attribute: 'temperature', unit });
  const conditionLabel = nativeStateLabel(hass, source.state, reading.label);
  return { ...empty, ...sourceLabels(source), condition: reading.condition, conditionLabel, temperature, unit,
    temperatureLabel, label: `${conditionLabel} · ${temperatureLabel}`, diagnostics: reading.diagnostics };
}

function personSummary(hass, entity, session, duplicate) {
  const source = currentSource(hass, entity, 'person', session);
  const base = { ...sourceLabels(source), location: 'unknown', zoneEntity: null, label: 'Location unavailable' };
  if (duplicate) return { ...base, status: 'invalid', reason: 'duplicate_person', diagnostics: [issue('duplicate_person', 'This person was selected more than once.', { entity })] };
  if (source.status !== 'ready') return base;
  const value = source.state.state;
  if (value === 'home' || value === 'not_home') return { ...base, location: value === 'home' ? 'home' : 'away',
    label: nativeStateLabel(hass, source.state, value === 'home' ? 'Home' : 'Away') };
  const matches = [];
  for (const id of Object.keys(record(hass.states))) {
    if (id === 'zone.home' || !exactEntity(id, 'zone')) continue;
    const zone = currentSource(hass, id, 'zone', session), attributes = zone.state?.attributes;
    if (zone.status === 'ready' && /^\d+$/.test(zone.state.state) && Number.isSafeInteger(Number(zone.state.state))
      && attributes?.passive !== true && attributes?.friendly_name === value
      && (!Object.hasOwn(attributes, 'passive') || attributes.passive === false)) matches.push(zone);
  }
  if (matches.length !== 1) return { ...base, status: 'unknown', reason: matches.length ? 'ambiguous_zone' : 'unknown_zone',
    diagnostics: [issue(matches.length ? 'ambiguous_zone' : 'unknown_zone', 'The reported location does not identify one current visible configured zone.', { entity })] };
  return { ...base, location: 'other', zoneEntity: matches[0].entity,
    label: nativeStateLabel(hass, source.state, value) };
}

function alarmSummary(hass, entity, configured, session) {
  const empty = { entity, name: null, status: 'not_configured', reason: null, state: null, severity: 'unknown',
    label: 'Alarm not configured', evidence: null, diagnostics: [] };
  if (!configured) return empty;
  const source = currentSource(hass, entity, 'alarm_control_panel', session);
  if (source.status !== 'ready') return { ...empty, ...sourceLabels(source), label: localize(hass, 'house.header.alarmUnavailable') };
  if (!Object.hasOwn(alarms, source.state.state)) return { ...empty, ...sourceLabels(source), status: 'unknown', reason: 'alarm_state',
    label: 'Alarm state unknown', diagnostics: [issue('alarm_state', 'The alarm does not report a recognized alarm state.', { entity })] };
  const [label, severity] = alarms[source.state.state];
  return { ...empty, ...sourceLabels(source), state: source.state.state, severity, label: nativeStateLabel(hass, source.state, label) };
}

function lightSummary(hass, session) {
  const result = { status: 'ready', on: 0, off: 0, unknown: 0, total: 0, excluded: 0, rows: [],
    label: '', evidence: { basis: 'current', ageVerified: false, counts: 'light_entities' }, diagnostics: [] };
  const ids = new Set([...Object.keys(record(hass.states)), ...Object.keys(record(hass.entities))]);
  for (const id of [...ids].sort()) {
    if (!exactEntity(id, 'light')) continue;
    const metadata = entityMetadata(hass, id);
    if (metadata.disabled || metadata.hidden || metadata.category) { result.excluded++; continue; }
    const source = currentSource(hass, id, 'light', session);
    const appearance = source.status === 'ready' ? readLightAppearance(source.state) : null;
    const known = appearance && ['ready', 'fallback', 'off'].includes(appearance.status);
    const status = known ? source.state.state : 'unknown';
    result[status]++; result.total++;
    const row = { entity: id, name: source.name, status, reason: known ? null : source.reason || appearance.status,
      diagnostics: known ? [] : [...source.diagnostics, ...(appearance?.diagnostics || [])] };
    result.rows.push(row); result.diagnostics.push(...row.diagnostics);
  }
  result.status = session.status !== 'ready' ? 'unavailable' : result.unknown ? 'partial' : result.total ? 'ready' : 'empty';
  result.label = session.status !== 'ready' ? localize(hass, 'house.header.lightsUnavailable') : !result.total ? localize(hass, 'house.summary.noLights')
    : localize(hass, 'house.summary.lightsOn', { count: result.on })
      + (result.unknown ? ` · ${localize(hass, 'house.summary.unknown', { count: result.unknown })}` : '');
  return result;
}

/** Pure summary. The caller decides placement/visibility; no reader changes HA state.
 * Defaults never auto-select weather, people or an alarm. Counts describe eligible
 * light entities (including HA groups), not a guessed number of physical bulbs.
 */
export function buildHouseSummary(hass = {}, raw) {
  hass = record(hass);
  const policy = readHouseSummary(raw), session = readSession(hass), configured = record(raw);
  const locationTitle = session.status === 'ready' && validTitle(hass.config?.location_name) ? hass.config.location_name.trim() : null;
  const title = { text: policy.title || locationTitle || "Taylor's 3D", source: policy.title ? 'configured' : locationTitle ? 'home_assistant' : 'default' };
  const weather = weatherSummary(hass, policy.weather_entity, Object.hasOwn(configured, 'weather_entity'), session);
  const alarm = alarmSummary(hass, policy.alarm_entity, Object.hasOwn(configured, 'alarm_entity'), session);
  const rows = policy.person_entities.map((id) => personSummary(hass, id, session, policy.person_entities.filter((other) => other === id).length > 1));
  const people = { status: 'not_configured', rows, total: rows.length, configured: policy.configuredPeople, omitted: policy.omittedPeople,
    home: 0, away: 0, other: 0, unknown: 0, complete: !policy.diagnostics.some((d) => d.path?.startsWith('person_entities')), label: 'People not configured' };
  for (const row of rows) people[row.location]++;
  if (rows.length || !people.complete) {
    people.status = !people.complete ? 'invalid' : session.status !== 'ready' ? 'unavailable' : people.unknown ? 'partial' : 'ready';
    people.label = !people.complete ? 'People summary needs configuration' : session.status !== 'ready' ? localize(hass, 'house.header.peopleUnavailable')
      : localize(hass, 'house.summary.peopleHome', { count: people.total, home: people.home })
        + (people.unknown ? ` · ${localize(hass, 'house.summary.unknown', { count: people.unknown })}` : '');
  }
  const lights = lightSummary(hass, session);
  return { title, weather, people, alarm, lights, session, valid: policy.valid,
    diagnostics: [...policy.diagnostics, ...session.diagnostics, ...weather.diagnostics, ...rows.flatMap((row) => row.diagnostics), ...alarm.diagnostics, ...lights.diagnostics] };
}
