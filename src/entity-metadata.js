// Shared HA metadata; no requests, subscriptions, device actions or layout mutations.
// HA's display registry uses hidden/display_precision; full entries use hidden_by/options.
// Primary contracts: home-assistant/frontend src/types.ts and data/entity/entity_registry.ts.
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const entry = (values, id) => Object.prototype.hasOwnProperty.call(record(values), id) ? values[id] : null;
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' && value.trim() ? value : null;
const ids = (value) => [...new Set(list(value).filter((id) => typeof id === 'string' && id))];
const precision = (value) => Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
const present = (value) => value !== null && value !== undefined && value !== false;
const numericDomains = new Set(['number', 'input_number', 'counter']);

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
    const warning = metadata.missing ? 'Missing entity' : !metadata.hasState ? 'No current state'
      : metadata.disabled ? 'Disabled' : metadata.hidden ? 'Hidden' : metadata.category ? metadata.category
        : !metadata.available ? 'Unavailable' : !matching ? 'Outside current filter' : '';
    out.push({ ...metadata, value: entityId, label: `${metadata.name}${warning ? ` (${warning})` : ''}`,
      selected: selected.has(entityId), filtered: !matching, selectable: matching });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId));
}

function localizeState(hass, state) {
  if (typeof hass.localize === 'function') {
    try { const value = hass.localize(`state.default.${state}`); if (text(value)) return value; } catch { /* Use English fallback. */ }
  }
  return state === 'unknown' ? 'Unknown' : 'Unavailable';
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
 * Layout-only floors are valid; registries not supplied yet are not treated as empty/deleted.
 */
export function registryIssues(hass = {}, layout = {}, config = {}) {
  hass = record(hass); layout = record(layout); config = record(config);
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
    issues.push({ code, kind, id, path, message: code === 'entity_no_state' ? `${id} has no current state.`
      : `Saved ${kind} ${id} is missing. Relink or clear this choice; its saved layout is preserved.` });
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
  if (config.model) for (const [id, value] of Object.entries(record(config.model_floors))) {
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
      if (name === 'config' && Array.isArray(layout.views?.[id]?.floors)) continue;
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
  return issues;
}
