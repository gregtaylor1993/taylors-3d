// Shared HA metadata; no requests, subscriptions, device actions or layout mutations.
// HA's display registry uses hidden/display_precision; full entries use hidden_by/options.
// Primary contracts: home-assistant/frontend src/types.ts and data/entity/entity_registry.ts.
import { enumerateSavedHaReferences, SAVED_HA_REFERENCE_LIMITS } from './saved-ha-reference-paths.js';
import { inspectSourceValue } from './imported-source-controls.js';
import { localeInfo, localize } from './localization.js';
import savedReferenceMessages from './translations/saved-ha-references.js';
import entityChoiceCaptions from './translations/entity-choice-captions.js';
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const entry = (values, id) => Object.prototype.hasOwnProperty.call(record(values), id) ? values[id] : null;
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' && value.trim() ? value : null;
const ids = (value) => [...new Set(list(value).filter((id) => typeof id === 'string' && id))];
const precision = (value) => Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
const present = (value) => value !== null && value !== undefined && value !== false;
const numericDomains = new Set(['number', 'input_number', 'counter']);
const LEGACY_UNREADABLE = Symbol('unreadable saved reference data');
const ownData = (value, key) => {
  try {
    const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : null;
    return { own: !!descriptor, safe: !descriptor || Object.hasOwn(descriptor, 'value'), value: descriptor?.value };
  } catch { return { own: true, safe: false, value: undefined }; }
};
const sourceRecord = (value) => {
  try { return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
  catch { return false; }
};
const referenceText = (hass, word, params = {}) => {
  const key = `savedHaReferences.${word}`, language = localeInfo(hass).resolved;
  return localize(hass, key, params, savedReferenceMessages[language]?.[key] || savedReferenceMessages.en[key]);
};

/** Current evidence for a saved entity. Registration can exist before states load;
 * a current state-only entity does not need the registry to finish loading. */
function savedEntityIssue(hass, id) {
  const connection = ownData(hass, 'connection'), connected = ownData(connection.safe ? connection.value : null, 'connected');
  const base = { name: id };
  if (!connection.safe || !connected.safe || connected.value === false) return { ...base, code: 'reference_pending', word: 'pending' };
  const states = ownData(hass, 'states'), entities = ownData(hass, 'entities');
  const state = ownData(states.safe ? states.value : null, id), registered = ownData(entities.safe ? entities.value : null, id);
  const usableState = state.safe && sourceRecord(state.value), usableRegistry = registered.safe && sourceRecord(registered.value);
  if (!states.safe || !entities.safe || !state.safe || !registered.safe) return { ...base, code: 'reference_pending', word: 'pending' };
  if (!usableState) {
    if (usableRegistry) return { ...base, code: 'entity_no_state', word: 'noState' };
    return sourceRecord(states.value) && sourceRecord(entities.value)
      ? { ...base, code: 'missing_entity', word: 'missing' } : { ...base, code: 'reference_pending', word: 'pending' };
  }
  // A report never executes source accessors/serialization hooks while resolving
  // captions. Feed the existing metadata reader only inspected exact data rows.
  if (!inspectSourceValue(state.value).readable || usableRegistry && !inspectSourceValue(registered.value).readable)
    return { ...base, code: 'entity_malformed', word: 'malformed' };
  const deviceId = ownData(registered.value, 'device_id').value, devices = ownData(hass, 'devices');
  const device = typeof deviceId === 'string' ? ownData(devices.safe ? devices.value : null, deviceId) : { safe: true };
  if (!device.safe || device.value !== undefined && !inspectSourceValue(device.value).readable)
    return { ...base, code: 'reference_pending', word: 'pending' };
  const metadata = entityMetadata({ states: { [id]: state.value }, entities: usableRegistry ? { [id]: registered.value } : {},
    devices: deviceId && device.value ? { [deviceId]: device.value } : {} }, id);
  const named = { name: metadata.name };
  if (metadata.disabled) return { ...named, code: 'entity_disabled', word: 'disabled' };
  if (metadata.hidden || metadata.category) return { ...named, code: 'entity_hidden', word: 'hidden' };
  if (state.value.attributes?.restored === true) return { ...named, code: 'entity_restored', word: 'restored' };
  if (state.value.entity_id !== undefined && state.value.entity_id !== id || typeof state.value.state !== 'string')
    return { ...named, code: 'entity_malformed', word: 'malformed' };
  if (state.value.state === 'unavailable') return { ...named, code: 'entity_unavailable', word: 'unavailable' };
  // Unknown is a legitimate scene last-activation timestamp, not a device reading.
  if (state.value.state === 'unknown' && metadata.domain !== 'scene') return { ...named, code: 'entity_unknown', word: 'unknown' };
  return null;
}

// Project only the legacy fields used by the existing checker. Imported raw
// objects remain untouched; accessors/hooks and excessive trees are disclosed.
function legacyReferenceProjection(source, name) {
  const value = Object.create(null), diagnostics = [], ancestors = new Set(), limits = SAVED_HA_REFERENCE_LIMITS;
  let nodes = 0, limited = false;
  const warn = (code, segments) => {
    if (diagnostics.length < limits.diagnostics) diagnostics.push({ code, path: segments.join('.') });
    else limited = true;
  };
  const copy = (input, segments, depth) => {
    if (++nodes > limits.nodes || depth > limits.depth) { limited = true; return LEGACY_UNREADABLE; }
    if (input === null || input === undefined || typeof input === 'string' || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) return input;
    if (!Array.isArray(input) && !sourceRecord(input) || ancestors.has(input)) { warn('reference_unsafe', segments); return LEGACY_UNREADABLE; }
    ancestors.add(input);
    const out = Array.isArray(input) ? [] : Object.create(null);
    const keys = Array.isArray(input) ? Array.from({ length: Math.min(input.length, limits.nodes) }, (_, index) => String(index)) : Reflect.ownKeys(input);
    if (Array.isArray(input) && input.length > limits.nodes) limited = true;
    for (const key of keys) {
      if (nodes >= limits.nodes) { limited = true; break; }
      if (typeof key !== 'string') { warn('reference_unsafe', segments); continue; }
      const current = ownData(input, key), path = [...segments, key];
      if (!current.safe) { warn('reference_accessor', path); out[key] = LEGACY_UNREADABLE; }
      else if (current.own) out[key] = copy(current.value, path, depth + 1);
    }
    ancestors.delete(input); return out;
  };
  const fields = ['rooms', 'floors', 'pins', 'hidden', 'model', 'model_floors', 'objects', 'groups', 'mower', 'views',
    'room_overlays', 'alert_bindings', 'camera_coverage', 'presence_bindings', 'vehicle_bindings', 'vacuum_bindings'];
  for (const key of fields) {
    const current = ownData(source, key);
    if (!current.safe) { warn('reference_accessor', [name, key]); value[key] = LEGACY_UNREADABLE; }
    else if (current.own) value[key] = copy(current.value, [name, key], 0);
  }
  if (limited) {
    const row = { code: 'reference_limit', path: `${name}.saved` };
    if (diagnostics.length >= limits.diagnostics) diagnostics[limits.diagnostics - 1] = row; else diagnostics.push(row);
  }
  return { value, diagnostics };
}

function effectiveDeviceArea(device, devices) {
  const seen = new Set();
  for (let current = device; current && !seen.has(current); current = entry(devices, current.parent_device_id)) {
    seen.add(current);
    if (text(current.area_id)) return current.area_id;
    // via_device_id means communication gateway, not household area inheritance.
    if (!current.parent_device_id) break;
  }
  return null;
}

function entityName(hass, entityId, state, registry) {
  if (state && typeof hass.formatEntityName === 'function') {
    try {
      const value = hass.formatEntityName(state, undefined);
      if (text(value)) return value;
    } catch { /* Demo/older formatter fallbacks stay readable. */ }
  }
  return text(registry?.name) || text(state?.attributes?.friendly_name) || text(registry?.original_name) || entityId;
}

/** Resolve one entity, including state-only entities. Missing means neither state nor registration exists.
 * labels are the union of entity/device/effective-area labels; the three source lists remain available.
 * available excludes missing state, unknown/unavailable and disabled entities/devices.
 */
export function entityMetadata(hass = {}, entityId = '') {
  hass = record(hass);
  entityId = typeof entityId === 'string' ? entityId : '';
  const state = entry(hass.states, entityId);
  const registry = entry(hass.entities, entityId);
  const attr = record(state?.attributes);
  const domain = entityId.split('.')[0];
  const deviceId = text(registry?.device_id);
  const device = deviceId ? entry(hass.devices, deviceId) : null;
  const areaId = text(registry?.area_id) || effectiveDeviceArea(device, record(hass.devices));
  const area = areaId ? entry(hass.areas, areaId) : null;
  const floorId = text(area?.floor_id);
  const floor = floorId ? entry(hass.floors, floorId) : null;
  const entityLabels = ids(registry?.labels), deviceLabels = ids(device?.labels), areaLabels = ids(area?.labels);
  const sensorOptions = record(registry?.options?.sensor);
  const displayPrecision = precision(registry?.display_precision) ?? precision(sensorOptions.display_precision)
    ?? precision(sensorOptions.suggested_display_precision);
  const disabled = registry?.disabled === true || present(registry?.disabled_by) || present(device?.disabled_by);
  return {
    entityId, domain, state, registry, device, area, floor, deviceId, areaId, floorId,
    name: entityName(hass, entityId, state, registry),
    deviceClass: text(attr.device_class) || text(registry?.device_class) || text(registry?.original_device_class),
    entityLabels, deviceLabels, areaLabels, labels: ids([...entityLabels, ...deviceLabels, ...areaLabels]),
    hidden: registry?.hidden === true || present(registry?.hidden_by), disabled,
    category: text(registry?.entity_category), hasState: !!state, registered: !!registry, missing: !state && !registry,
    available: !!state && !disabled && state.state !== 'unknown' && state.state !== 'unavailable',
    displayPrecision,
    // Actual state units win: this helper formats readings, it never converts their values.
    unit: typeof attr.unit_of_measurement === 'string' ? attr.unit_of_measurement
      : text(record(registry?.options?.[domain]).unit_of_measurement) || '',
    supportedFeatures: Number.isSafeInteger(attr.supported_features) && attr.supported_features >= 0 ? attr.supported_features : 0,
  };
}

function matches(metadata, filters, hass) {
  if (!metadata.hasState || (!filters.includeHidden && metadata.hidden) || (!filters.includeDisabled && metadata.disabled)
    || (!filters.includeCategories && metadata.category) || (filters.availableOnly && !metadata.available)) return false;
  if (list(filters.domains).length && !filters.domains.includes(metadata.domain)) return false;
  if (list(filters.deviceClasses).length && !filters.deviceClasses.includes(metadata.deviceClass)) return false;
  if (filters.areaId !== undefined && metadata.areaId !== filters.areaId) return false;
  if (filters.floorId !== undefined && metadata.floorId !== filters.floorId) return false;
  if (list(filters.labels).length && !filters.labels.some((label) => metadata.labels.includes(label))) return false;
  const required = filters.supportedFeatures;
  if (required !== undefined && (!Number.isSafeInteger(required) || required < 0
    || (BigInt(metadata.supportedFeatures) & BigInt(required)) !== BigInt(required))) return false;
  return typeof filters.capability !== 'function' || !!filters.capability(metadata, hass);
}

/** Sorted choices { ...metadata, value, label, selected, filtered, selectable }.
 * Filters: domains/deviceClasses arrays, areaId/floorId (null = unassigned), labels (any match),
 * supportedFeatures (all mask bits), capability(metadata,hass), availableOnly and includeHidden/
 * includeCategories/includeDisabled. selected string/array preserves excluded or missing choices.
 * Unavailable states remain selectable by default; absent states are selected warning rows only.
 */
export function entityChoices(hass = {}, filters = {}) {
  hass = record(hass); filters = record(filters);
  const selected = new Set(ids(typeof filters.selected === 'string' ? [filters.selected] : filters.selected));
  const candidates = new Set([...Object.keys(record(hass.states)), ...selected]);
  const out = [];
  for (const entityId of candidates) {
    const metadata = entityMetadata(hass, entityId);
    const matching = matches(metadata, filters, hass);
    if (!matching && !selected.has(entityId)) continue;
    const warningKey = metadata.missing ? 'missing' : !metadata.hasState ? 'noState'
      : metadata.disabled ? 'disabled' : metadata.hidden ? 'hidden'
        : metadata.category ? ['config', 'diagnostic'].includes(metadata.category) ? metadata.category : null
          : !metadata.available ? 'unavailable' : !matching ? 'outsideFilter' : null;
    const warning = warningKey ? choiceCaption(hass, warningKey) : metadata.category || '';
    out.push({ ...metadata, value: entityId, label: `${metadata.name}${warning ? ` (${warning})` : ''}`,
      selected: selected.has(entityId), filtered: !matching, selectable: matching });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId));
}

function localizeState(hass, state) {
  if (typeof hass.localize === 'function') {
    try { const value = hass.localize(`state.default.${state}`); if (text(value)) return value; } catch { /* Use English fallback. */ }
  }
  return choiceCaption(hass, state === 'unknown' ? 'unknown' : 'unavailable');
}

function choiceCaption(hass, word) {
  const key = `entityChoice.${word}`, language = localeInfo(hass).resolved;
  return localize(hass, key, {}, entityChoiceCaptions[language]?.[key] ?? entityChoiceCaptions.en[key]);
}

const numberFormatters = new Map();
function formatNumber(hass, value, displayPrecision) {
  const locale = record(hass.locale);
  const preferences = { comma_decimal: 'en-US', decimal_comma: 'de', space_comma: 'fr', quote_decimal: 'de-CH', none: 'en-US' };
  const language = preferences[locale.number_format] || (locale.number_format === 'system' ? undefined : locale.language || hass.language || 'en');
  // Preserve reported trailing zeroes when HA did not choose a precision; guard malformed/extreme inputs.
  const parts = /^[-+]?\d*(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(String(value));
  const reported = parts ? Math.max(0, (parts[1]?.length || 0) - (Number(parts[2]) || 0)) : 0;
  const digits = displayPrecision ?? Math.min(100, reported);
  const options = { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: locale.number_format !== 'none' };
  const key = JSON.stringify([language, options]);
  try {
    if (!numberFormatters.has(key)) {
      if (numberFormatters.size >= 32) numberFormatters.clear();
      numberFormatters.set(key, new Intl.NumberFormat(language, options));
    }
    return numberFormatters.get(key).format(Number(value));
  } catch { return Number(value).toFixed(digits); }
}

function attributeUnit(hass, metadata, attribute) {
  const attr = record(metadata.state?.attributes);
  if (['current_temperature', 'temperature', 'target_temp_high', 'target_temp_low'].includes(attribute)) {
    return text(attr.temperature_unit) || text(hass.config?.unit_system?.temperature) || '';
  }
  if (['battery', 'battery_level', 'humidity', 'current_humidity'].includes(attribute)) return '%';
  return '';
}

/** Prefer HA's translated/unit-aware state or attribute formatter. Fallback respects display precision,
 * locale number preferences, actual units and unknown/unavailable; options.unit overrides fallback only.
 * Attribute values never inherit a sensor state's decimal precision or unrelated unit.
 */
export function formatEntityValue(hass = {}, entityId, options = {}) {
  hass = record(hass); options = record(options);
  const state = entry(hass.states, entityId);
  if (!state) return localizeState(hass, 'unavailable');
  const attribute = text(options.attribute);
  const raw = attribute ? state.attributes?.[attribute] : state.state;
  if (raw === undefined || raw === null) return '';
  const formatter = attribute ? hass.formatEntityAttributeValue : hass.formatEntityState;
  if (typeof formatter === 'function') {
    try {
      const value = attribute ? formatter.call(hass, state, attribute) : formatter.call(hass, state);
      if (typeof value === 'string') return value;
    } catch { /* Mock/older HA objects still render safely. */ }
  }
  if (!attribute && (raw === 'unknown' || raw === 'unavailable')) return localizeState(hass, raw);
  const metadata = entityMetadata(hass, entityId);
  const numeric = (typeof raw === 'number' || typeof raw === 'string' && raw.trim() !== '') && Number.isFinite(Number(raw));
  const shouldFormat = numeric && (attribute || typeof raw === 'number' || numericDomains.has(metadata.domain)
    || metadata.unit || state.attributes?.state_class || metadata.displayPrecision !== null);
  const value = shouldFormat ? formatNumber(hass, raw, attribute ? null : metadata.displayPrecision) : String(raw);
  const unit = options.unit !== undefined ? String(options.unit ?? '') : attribute ? attributeUnit(hass, metadata, attribute) : metadata.unit;
  return `${value}${unit ? ` ${unit}` : ''}`;
}

/** Read-only saved-reference diagnostics {code,kind,id,path,message}. No repairs/rename guesses.
 * Checks rooms/pins/hidden markers, model area/floor bindings, objects/groups, mower, views and overlays.
 * Tracking room/anchor IDs are checked only against an explicitly supplied loaded resolved context:
 * {rooms: card._roomList, anchors: card.trackingAnchors(), floors?: card._floors, ready?: boolean}.
 * Layout-only floors are valid; registries not supplied yet are not treated as empty/deleted.
 */
export function registryIssues(hass = {}, layout = {}, config = {}, resolved = {}) {
  const rawLayout = layout, rawConfig = config, legacyLayout = legacyReferenceProjection(layout, 'layout'), legacyConfig = legacyReferenceProjection(config, 'config');
  hass = record(hass); layout = legacyLayout.value; config = legacyConfig.value;
  resolved = record(resolved);
  const issues = [], seen = new Set();
  const floors = new Set([...Object.keys(record(hass.floors)), ...list(layout.floors).map((floor) => floor?.id).filter(Boolean)]);
  if (!floors.size) floors.add('ground'); // Same initial fallback as mergeFloors.
  const check = (kind, id, path) => {
    if (!text(id) || id === 'all' && kind === 'floor') return;
    let code;
    if (kind === 'entity') {
      if (!hass.states) return;
      const metadata = entityMetadata(hass, id);
      code = metadata.missing ? 'missing_entity' : !metadata.hasState ? 'entity_no_state' : null;
    } else if (kind === 'floor') code = !floors.has(id) ? 'missing_floor' : null;
    else {
      const registry = hass[`${kind}s`];
      if (!registry) return;
      code = !entry(registry, id) ? `missing_${kind}` : null;
    }
    if (!code || seen.has(`${code}:${path}:${id}`)) return;
    seen.add(`${code}:${path}:${id}`);
    issues.push({ code, kind, id, path, message: referenceText(hass, code === 'entity_no_state' ? 'legacyNoState' : 'legacyMissing',
      { kind: referenceText(hass, kind), id }) });
  };
  const marker = (id, path) => {
    if (typeof id !== 'string') return;
    if (id.startsWith('device:')) check('device', id.slice(7), path);
    else if (id.startsWith('entity:')) check('entity', id.slice(7), path);
    else if (/^[a-z_]+\.[a-z0-9_]+$/.test(id)) check('entity', id, path);
  };
  for (const [index, room] of list(layout.rooms).entries()) {
    check('area', room?.area_id, `layout.rooms.${index}.area_id`);
    check('floor', room?.floor_id, `layout.rooms.${index}.floor_id`);
  }
  for (const [id, pin] of Object.entries(record(layout.pins))) {
    marker(id, `layout.pins.${id}`); check('floor', pin?.floor_id, `layout.pins.${id}.floor_id`);
  }
  list(layout.hidden).forEach((id, index) => marker(id, `layout.hidden.${index}`));
  const model = record(layout.model);
  for (const [id, value] of Object.entries(record(model.rooms))) check('area', value?.area, `layout.model.rooms.${id}.area`);
  for (const [id, value] of Object.entries(record(model.levels))) check('floor', value?.floor, `layout.model.levels.${id}.floor`);
  for (const [id, value] of Object.entries(record(model.floor_map))) {
    if (!(id in record(model.levels)) && value !== 'always' && value !== 'hidden') check('floor', value, `layout.model.floor_map.${id}`);
  }
  if (config.model && config.model !== LEGACY_UNREADABLE && layout.model !== LEGACY_UNREADABLE
    && model.levels !== LEGACY_UNREADABLE && model.floor_map !== LEGACY_UNREADABLE) for (const [id, value] of Object.entries(record(config.model_floors))) {
    if (!(id in record(model.levels)) && !(id in record(model.floor_map)) && value !== 'always' && value !== 'hidden') {
      check('floor', value, `config.model_floors.${id}`);
    }
  }
  for (const field of ['objects', 'groups']) for (const [id, value] of Object.entries(record(layout[field]))) {
    check('entity', value?.entity, `layout.${field}.${id}.entity`);
  }
  const mower = record(layout.mower);
  check('entity', mower.entity, 'layout.mower.entity'); check('floor', mower.floor_id, 'layout.mower.floor_id');
  check('entity', mower.overlay?.entity, 'layout.mower.overlay.entity');
  for (const [name, source] of [['layout', layout], ['config', config]]) {
    for (const [id, view] of Object.entries(record(source.views))) {
      if (name === 'config' && (layout.views === LEGACY_UNREADABLE || layout.views?.[id] === LEGACY_UNREADABLE
        || layout.views?.[id]?.floors === LEGACY_UNREADABLE || Array.isArray(layout.views?.[id]?.floors))) continue;
      list(view?.floors).forEach((floor, index) => check('floor', floor, `${name}.views.${id}.floors.${index}`));
    }
  }
  const overlaySource = layout.room_overlays != null ? 'layout' : 'config';
  const overlays = record(layout.room_overlays ?? config.room_overlays);
  for (const [roomId, binding] of Object.entries(record(overlays.bindings))) {
    const sources = Array.isArray(binding) ? binding : list(binding?.entities);
    sources.forEach((source, index) => check('entity', typeof source === 'string' ? source : source?.entity,
      `${overlaySource}.room_overlays.bindings.${roomId}.entities.${index}`));
  }
  const alertSource = layout.alert_bindings != null ? 'layout' : 'config';
  list(layout.alert_bindings ?? config.alert_bindings).forEach((binding, index) => {
    const path = `${alertSource}.alert_bindings.${index}`;
    check('entity', binding?.entity, `${path}.entity`); check('floor', binding?.floorId || binding?.floor_id, `${path}.floorId`);
    check('area', binding?.area_id, `${path}.area_id`);
    if (binding?.position_key || binding?.markerId) marker(binding.position_key || binding.markerId, `${path}.position_key`);
  });
  const coverageSource = layout.camera_coverage != null ? 'layout' : 'config';
  for (const id of Object.keys(record(layout.camera_coverage ?? config.camera_coverage))) {
    const entity = /^camera\.[a-z0-9_]+$/.test(id) ? id : /:(camera\.[a-z0-9_]+)$/.exec(id)?.[1];
    if (entity) check('entity', entity, `${coverageSource}.camera_coverage.${id}`);
  }
  // Missing/unloaded context is not an empty collection. A model room or object
  // may simply be waiting for its GLB; never infer deletion or a renamed ID.
  const ready = resolved.ready !== false;
  const roomIds = ready && Array.isArray(resolved.rooms) ? new Set(resolved.rooms.map((entry) => entry?.room?.id || entry?.id).filter(text)) : null;
  const anchorIds = ready && Array.isArray(resolved.anchors) ? new Set(resolved.anchors.map((anchor) => anchor?.id).filter(text)) : null;
  const trackingFloors = ready && Array.isArray(resolved.floors) ? new Set(resolved.floors.map((floor) => floor?.id).filter(text))
    : ready && (hass.floors || Array.isArray(layout.floors)) ? floors : null;
  const exact = (kind, id, path, known) => {
    if (!text(id) || !known || known.has(id)) return;
    const code = `missing_${kind}`, key = `${code}:${path}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ code, kind, id, path, message: referenceText(hass, 'legacyMissing', { kind: referenceText(hass, kind), id }) });
  };
  for (const field of ['presence_bindings', 'vehicle_bindings', 'vacuum_bindings']) {
    const source = layout[field] != null ? 'layout' : 'config';
    list(layout[field] ?? config[field]).forEach((binding, index) => {
      if (!binding || typeof binding !== 'object') return;
      const path = `${source}.${field}.${index}`;
      check('entity', binding.entity, `${path}.entity`);
      check('entity', binding.identity_entity, `${path}.identity_entity`);
      for (const key of ['room_source', 'position_source']) check('entity', binding[key]?.entity, `${path}.${key}.entity`);
      for (const [key, value] of [['', binding], ['.position', binding.position], ['.position_source', binding.position_source]]) {
        for (const floorKey of ['floorId', 'floor_id']) exact('floor', value?.[floorKey], `${path}${key}.${floorKey}`, trackingFloors);
      }
      exact('room', binding.roomId, `${path}.roomId`, roomIds);
      for (const [reported, roomId] of Object.entries(record(binding.room_source?.room_map))) {
        if (Array.isArray(roomId)) roomId.forEach((id, i) => exact('room', id, `${path}.room_source.room_map.${reported}.${i}`, roomIds));
        else exact('room', roomId, `${path}.room_source.room_map.${reported}`, roomIds);
      }
      exact('anchor', binding.position_key, `${path}.position_key`, anchorIds);
    });
  }
  const report = enumerateSavedHaReferences({ layout: rawLayout, config: rawConfig });
  let limited = issues.length >= SAVED_HA_REFERENCE_LIMITS.references;
  const append = (reference, code, word, name = reference.id) => {
    const key = `${code}:${reference.path}:${reference.id ?? ''}`;
    if (seen.has(key)) return;
    if (issues.length >= SAVED_HA_REFERENCE_LIMITS.references - 1) { limited = true; return; }
    seen.add(key);
    const kind = reference.kind || 'settings';
    issues.push({ code, kind, ...(reference.id === undefined ? {} : { id: reference.id }), path: reference.path,
      message: referenceText(hass, word, { kind: referenceText(hass, kind), id: reference.id || '', name }) });
  };
  for (const diagnostic of [...legacyLayout.diagnostics, ...legacyConfig.diagnostics, ...report.diagnostics]) {
    // Future annotation/style fields remain opaque. They are not broken known
    // links and must not turn this report into a request to delete unknown data.
    if (diagnostic.code === 'reference_unknown') continue;
    append(diagnostic, diagnostic.code, diagnostic.code === 'reference_limit' ? 'limited' : 'uninspected');
  }
  const matches = (kind, id) => {
    const rows = ownData(resolved, kind === 'room' ? 'rooms' : kind === 'anchor' ? 'anchors' : 'floors');
    if (ownData(resolved, 'ready').value === false || !rows.safe || !Array.isArray(rows.value)) return null;
    return rows.value.filter((row) => (kind === 'room' ? ownData(ownData(row, 'room').value, 'id').value ?? ownData(row, 'id').value : ownData(row, 'id').value) === id);
  };
  for (const reference of report.references) {
    if (reference.kind === 'entity') {
      const status = savedEntityIssue(hass, reference.id);
      if (status) append(reference, status.code, status.word, status.name);
    } else if (['room', 'anchor', 'floor'].includes(reference.kind)) {
      const current = matches(reference.kind, reference.id);
      if (current === null) append(reference, 'reference_pending', 'pending');
      else if (!current.length) append(reference, `missing_${reference.kind}`, 'missing');
      else if (current.length > 1) append(reference, `ambiguous_${reference.kind}`, 'ambiguous');
      else if (reference.kind === 'floor' && ownData(current[0], 'stale').value === true) append(reference, 'missing_floor', 'missing');
    } else {
      const registry = ownData(hass, `${reference.kind}s`);
      if (!registry.safe || !sourceRecord(registry.value)) append(reference, 'reference_pending', 'pending');
      else if (!ownData(registry.value, reference.id).own) append(reference, `missing_${reference.kind}`, 'missing');
    }
  }
  if (limited) return [...issues.slice(0, SAVED_HA_REFERENCE_LIMITS.references - 1), { code: 'reference_limit', kind: 'settings', path: 'saved', message: referenceText(hass, 'limited') }];
  return issues;
}
