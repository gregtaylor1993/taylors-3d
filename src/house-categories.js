import { entityMetadata } from './entity-metadata.js';

// These lists describe current HA entities, never physical bulb/person/vehicle totals.
export const HOUSE_CATEGORY_LIMITS = Object.freeze({ entities: 512, vehicleBindings: 512, states: 50000 });
const INVALID = Symbol('invalid record');
const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const field = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return !descriptor ? undefined : own(descriptor, 'value') ? descriptor.value : INVALID;
};
const identifier = (value) => typeof value === 'string' && value.length <= 255
  && /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value);
const securityClasses = new Set(['door', 'window', 'garage_door', 'opening', 'smoke', 'moisture', 'safety', 'tamper', 'motion']);
const categories = Object.freeze({
  lights: { title: 'Lights', emptyText: 'No current visible lights are available.' },
  security: { title: 'Security', emptyText: 'No current visible security entities are available.' },
  media: { title: 'Media', emptyText: 'No current visible media players are available.' },
  climate: { title: 'Climate', emptyText: 'No current visible climate, weather, temperature or humidity entities are available.' },
  cars: { title: 'Cars', emptyText: 'No current vehicle sources are selected. Choose your sources in Edit → Tracking.' },
});
const unreadable = 'Current Home Assistant entities could not be read. Refresh the connection and try again.';
const ownedPresentation = new WeakMap();

// The public category data remains literal English. Only results produced here
// carry private provenance for the card's own translated headings and guidance.
export function ownedHouseCategoryPresentation(category) {
  return category && typeof category === 'object' ? ownedPresentation.get(category) : undefined;
}

function session(hass) {
  if (!plain(hass)) return false;
  const user = field(hass, 'user'), connection = field(hass, 'connection');
  if (!plain(user) || !connection || typeof connection !== 'object') return false;
  const id = field(user, 'id');
  if (typeof id !== 'string' || !id.trim() || id.length > 255 || [...id].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || own(user, 'is_active') && field(user, 'is_active') !== true) return false;
  // HA Connection is a class instance; its actual current connected getter is supported.
  try { return connection.connected === true; } catch { return false; }
}

function registryFields(value) {
  if (value === undefined || value === null) return {};
  if (!plain(value)) return null;
  const out = {};
  for (const key of ['hidden', 'disabled', 'hidden_by', 'disabled_by', 'entity_category', 'device_id', 'device_class', 'original_device_class']) {
    if (!own(value, key)) continue;
    const item = field(value, key);
    if (item === INVALID || (key === 'hidden' || key === 'disabled') && typeof item !== 'boolean'
      || (key === 'hidden_by' || key === 'disabled_by') && item !== null && item !== false && typeof item !== 'string'
      || !['hidden', 'disabled', 'hidden_by', 'disabled_by'].includes(key) && item !== null && typeof item !== 'string') return null;
    out[key] = item;
  }
  return out;
}

function currentMetadata(states, entities, devices, entityId) {
  if (!identifier(entityId) || !own(states, entityId)) return null;
  const state = field(states, entityId);
  if (!plain(state)) return null;
  const value = field(state, 'state'), attr = own(state, 'attributes') ? field(state, 'attributes') : {};
  if (typeof value !== 'string' || !value.trim() || !plain(attr)
    || own(state, 'entity_id') && field(state, 'entity_id') !== entityId
    || own(attr, 'restored') && field(attr, 'restored') !== false) return null;
  const deviceClass = field(attr, 'device_class');
  if (deviceClass === INVALID || deviceClass !== undefined && deviceClass !== null && typeof deviceClass !== 'string') return null;
  const registry = registryFields(field(entities, entityId));
  if (!registry) return null;
  const deviceId = registry.device_id;
  const rawDevice = deviceId ? field(devices, deviceId) : undefined;
  let device = {};
  if (rawDevice !== undefined && rawDevice !== null) {
    if (!plain(rawDevice)) return null;
    if (own(rawDevice, 'disabled_by')) {
      const disabledBy = field(rawDevice, 'disabled_by');
      if (disabledBy === INVALID || disabledBy !== null && disabledBy !== false && typeof disabledBy !== 'string') return null;
      device = { disabled_by: disabledBy };
    }
  }
  // Only eligibility fields are needed. Avoid HA formatters, labels and unrelated getters.
  const metadata = entityMetadata({
    states: { [entityId]: { state: value, attributes: { device_class: deviceClass } } },
    entities: { [entityId]: registry }, devices: deviceId ? { [deviceId]: device } : {},
  }, entityId);
  return !metadata.hasState || metadata.missing || metadata.hidden || metadata.disabled || metadata.category ? null : metadata;
}

function matches(id, metadata) {
  const { domain, deviceClass } = metadata;
  if (id === 'lights') return domain === 'light';
  if (id === 'media') return domain === 'media_player';
  if (id === 'climate') return domain === 'climate' || domain === 'weather'
    || domain === 'sensor' && (deviceClass === 'temperature' || deviceClass === 'humidity');
  return domain === 'lock' || domain === 'alarm_control_panel' || domain === 'camera'
    || domain === 'binary_sensor' && securityClasses.has(deviceClass);
}

/** Read-only current category rows. Cars uses the saved flat vehicle_bindings array.
 * Unavailable/unknown current sources remain visible; no cached/restored/hidden sources.
 * Null means no authenticated current context or an unknown category. Over-limit lists
 * fail as a whole with an actionable emptyText; never show an unexplained partial list.
 */
export function buildHouseCategory(options = {}) {
  if (!plain(options)) return null;
  const hass = field(options, 'hass'), id = field(options, 'id');
  if (typeof id !== 'string' || !own(categories, id) || !session(hass)) return null;
  const category = categories[id];
  const result = (entityIds = [], emptyText = category.emptyText,
    emptyTextKey = `house.categories.${id}Empty`, emptyTextParams = {}) => {
    const value = { id, title: category.title, entityIds, emptyText };
    ownedPresentation.set(value, Object.freeze({ titleKey: `house.nav.${id}`, emptyTextKey,
      emptyTextParams: Object.freeze({ ...emptyTextParams }) }));
    return value;
  };
  const states = field(hass, 'states');
  const entities = own(hass, 'entities') ? field(hass, 'entities') : {};
  const devices = own(hass, 'devices') ? field(hass, 'devices') : {};
  if (!plain(states) || !plain(entities) || !plain(devices)) return result([], unreadable, 'house.categories.unreadable');
  const stateIds = Object.keys(states);
  if (stateIds.length > HOUSE_CATEGORY_LIMITS.states) return result([], 'Too many Home Assistant entities to list safely. Reduce the entity list and try again.', 'house.categories.stateLimit');
  let candidates = stateIds;
  if (id === 'cars') {
    const layout = own(options, 'layout') ? field(options, 'layout') : {};
    if (!plain(layout)) return result([], 'Vehicle settings need review in Edit → Tracking.', 'house.categories.vehicleReview');
    const bindings = field(layout, 'vehicle_bindings');
    if (bindings === undefined && !own(layout, 'vehicle_bindings')) return result();
    if (!Array.isArray(bindings)) return result([], 'Vehicle settings need review in Edit → Tracking.', 'house.categories.vehicleReview');
    if (bindings.length > HOUSE_CATEGORY_LIMITS.vehicleBindings) return result([], 'Too many saved vehicle bindings. Reduce the list in Edit → Tracking.', 'house.categories.vehicleLimit');
    candidates = [];
    for (let index = 0; index < bindings.length; index++) {
      const binding = field(bindings, String(index));
      if (!plain(binding) || own(binding, 'enabled') && field(binding, 'enabled') !== true) continue;
      for (const key of ['entity', 'identity_entity']) {
        const entityId = field(binding, key);
        if (identifier(entityId)) candidates.push(entityId);
      }
    }
  }
  const selected = new Set();
  for (const entityId of candidates) {
    const metadata = currentMetadata(states, entities, devices, entityId);
    if (!metadata || id !== 'cars' && !matches(id, metadata)) continue;
    selected.add(entityId);
    if (selected.size > HOUSE_CATEGORY_LIMITS.entities) return result([], `More than ${HOUSE_CATEGORY_LIMITS.entities} current ${category.title.toLowerCase()} entities are selected. Reduce the list to open this category.`,
      `house.categories.${id}Limit`, { limit: HOUSE_CATEGORY_LIMITS.entities });
  }
  return result([...selected].sort());
}
