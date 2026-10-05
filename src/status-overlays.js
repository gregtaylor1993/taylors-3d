// Room measurements and location alerts. Units, meter choices and missing readings stay explicit.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { centroid, signedArea } from './placement.js';
import { localeInfo, localize } from './localization.js';
import messages from './translations/status-overlays.js';

const text = (hass,key,params = {}) => localize(hass,`statusOverlays.${key}`,params,
  (messages[localeInfo(hass).resolved] || messages.en)[`statusOverlays.${key}`] || messages.en[`statusOverlays.${key}`] || '');

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const at = (v, key) => v instanceof Map ? v.get(key) : v && Object.hasOwn(v, key) ? v[key] : undefined;
const point = (p) => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]);
const fmt = (v) => Number(v.toFixed(2)).toString();
const issue = (code, message, entity = null) => ({ code, message, entity });
const metricNames = { temperature: 'Temperature', power: 'Power now', energy: 'Energy' };
export const STATUS_PALETTES = Object.freeze({
  temperature: Object.freeze(['#315b9b', '#49a8b1', '#e9cf74', '#e68b47', '#bf3e45']),
  usage: Object.freeze(['#315b81', '#4cb7ad', '#f8d44a', '#c83e35']),
  violet: Object.freeze(['#46327e', '#477eaf', '#54b6a4', '#d8cf67']),
});
export const UNKNOWN_STATUS_COLOR = '#8d9199';

const periodAliases = { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', annual: 'year', total: 'lifetime' };
export function measurementPeriod(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const key = v.trim().toLowerCase();
  return Object.hasOwn(periodAliases, key) ? periodAliases[key] : key;
}

function temperatureUnit(unit) {
  const units = { '°C': '°C', C: '°C', '℃': '°C', '°F': '°F', F: '°F', '℉': '°F', K: 'K' };
  return Object.hasOwn(units, unit) ? units[unit] : null;
}
function outputUnit(mode, requested) {
  if (mode === 'temperature') return requested === undefined ? '°C' : temperatureUnit(requested);
  const allowed = mode === 'power' ? ['W', 'kW'] : mode === 'energy' ? ['Wh', 'kWh'] : [];
  return requested === undefined ? allowed[mode === 'energy' ? 1 : 0] : allowed.includes(requested) ? requested : null;
}
const fromCelsius = (c, unit) => unit === '°F' ? c * 9 / 5 + 32 : unit === 'K' ? c + 273.15 : c;

// No parseFloat: values such as "20 W", an empty state and Infinity are invalid measurements.
export function readMeasurement(states, entity, mode, { unit, period, bindingPeriod } = {}, hass) {
  const target = outputUnit(mode, unit);
  const base = { entity, value: null, unit: target, period: mode === 'energy' ? measurementPeriod(period) : null, diagnostics: [] };
  const invalid = (code, message) => ({ ...base, status: 'invalid', diagnostics: [issue(code, message, entity)] });
  if (!Object.hasOwn(metricNames, mode) || !target) return invalid('unit', text(hass,'measurement.choose'));
  const state = at(states, entity);
  if (!state) return { ...base, status: 'missing', diagnostics: [issue('missing', text(hass,'measurement.missing'), entity)] };
  if (state.state === 'unknown' || state.state === 'unavailable') return { ...base, status: 'unavailable', diagnostics: [issue('unavailable', text(hass,'measurement.unavailable',{state:state.state}), entity)] };
  const raw = state.state;
  const value = finite(raw) ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!finite(value)) return invalid('value', text(hass,'measurement.finite'));
  const attributes = state.attributes || {};
  const source = attributes.unit_of_measurement;
  let converted;
  if (mode === 'temperature') {
    const sourceUnit = temperatureUnit(source);
    if (!sourceUnit) return invalid('unit', text(hass,'measurement.temperatureUnit'));
    const c = sourceUnit === '°F' ? (value - 32) * 5 / 9 : sourceUnit === 'K' ? value - 273.15 : value;
    if (c < -273.15) return invalid('value', text(hass,'measurement.absoluteZero'));
    converted = fromCelsius(c, target);
  } else {
    const expected = mode === 'power' ? ['W', 'kW'] : ['Wh', 'kWh'];
    if (!expected.includes(source)) return invalid('unit', text(hass,mode === 'power' ? 'measurement.powerUnit' : 'measurement.energyUnit'));
    converted = value * (source.startsWith('k') ? 1000 : 1) / (target.startsWith('k') ? 1000 : 1);
    if (mode === 'energy') {
      const reportedPeriod = measurementPeriod(attributes.meter_period || attributes.period);
      const declaredPeriod = measurementPeriod(bindingPeriod);
      if (reportedPeriod && declaredPeriod && reportedPeriod !== declaredPeriod) return invalid('period', text(hass,'measurement.declaredPeriod',{declared:declaredPeriod,reported:reportedPeriod}));
      const actualPeriod = declaredPeriod || reportedPeriod;
      if (!base.period) return invalid('period', text(hass,'measurement.choosePeriod'));
      if (!actualPeriod) return invalid('period', text(hass,'measurement.confirmPeriod'));
      if (actualPeriod !== base.period) return invalid('period', text(hass,'measurement.periodMismatch',{actual:actualPeriod,period:base.period}));
    }
  }
  if (!finite(converted)) return invalid('value', text(hass,'measurement.convertedRange'));
  return { ...base, value: converted, sourceUnit: source, status: 'ready' };
}

// A device with two power entities may expose alternative versions of one reading. Choose one,
// or explicitly mark independent channels. Circuit totals and their parts must share a group.
export function aggregateMeasurements(binding = {}, states = {}, registry = {}, options = {}, hass) {
  binding = plain(binding) || Array.isArray(binding) ? binding : {};
  const mode = options.mode;
  const unit = outputUnit(mode, options.unit);
  const aggregation = binding.aggregation || (mode === 'temperature' ? 'mean' : 'sum');
  const diagnostics = [], selected = [], seen = new Set();
  const list = Array.isArray(binding) ? binding : Array.isArray(binding.entities) ? binding.entities : [];
  for (const raw of list) {
    const source = typeof raw === 'string' ? { entity: raw } : plain(raw) ? raw : {};
    if (source.enabled === false) continue;
    if (typeof source.entity !== 'string' || !source.entity.trim()) { diagnostics.push(issue('binding', text(hass,'aggregate.sensor'))); continue; }
    const entity = source.entity.trim();
    if (seen.has(entity)) { diagnostics.push(issue('duplicate_entity', text(hass,'aggregate.duplicate'), entity)); continue; }
    seen.add(entity);
    const device = at(registry, entity)?.device_id;
    const group = typeof source.group === 'string' && source.group.trim() ? source.group.trim() : null;
    const key = group ? `group:${group}` : device && !source.independent ? `device:${device}` : `entity:${entity}`;
    selected.push({ ...source, entity, key, group });
  }
  const requested = selected.length;
  const allowed = mode === 'temperature' ? ['mean', 'min', 'max', 'median'] : ['sum', 'mean', 'min', 'max'];
  const result = { value: null, unit, aggregation, requested, valid: 0, sources: [], diagnostics, status: 'missing', scopeConfirmed: binding.independent_meters === true || selected.every((s) => !!s.group || s.independent === true) };
  if (!Object.hasOwn(metricNames, mode) || !unit || !allowed.includes(aggregation)) {
    diagnostics.push(issue('aggregation', text(hass,'aggregate.choose'))); return { ...result, status: 'invalid' };
  }
  let chosen = selected;
  if (mode !== 'temperature') {
    const groups = new Map();
    for (const s of selected) { if (!groups.has(s.key)) groups.set(s.key, []); groups.get(s.key).push(s); }
    chosen = [];
    for (const group of groups.values()) {
      const totals = group.filter((s) => s.role === 'total');
      if (group.length < 2) chosen.push(...group);
      else if (totals.length === 1 && group.every((s) => s.role === 'total' || s.role === 'part')) {
        chosen.push(totals[0]);
        diagnostics.push(issue('parts_excluded', text(hass,'aggregate.parts'), totals[0].entity));
      } else if (group[0].group && group.every((s) => s.role === 'part')) chosen.push(...group);
      else if (!group[0].group && binding.independent_meters === true) chosen.push(...group);
      else diagnostics.push({ ...issue('meter_conflict', text(hass,'aggregate.conflict')), choices: group.map((s) => s.entity) });
    }
    if (diagnostics.some((d) => d.code === 'meter_conflict')) return { ...result, status: 'invalid' };
    if (aggregation === 'sum' && chosen.length > 1 && !result.scopeConfirmed) {
      diagnostics.push({ ...issue('meter_scope', text(hass,'aggregate.scope')), choices: chosen.map((s) => s.entity) });
      return { ...result, status: 'invalid' };
    }
  }
  const readings = chosen.map((s) => ({ ...readMeasurement(states, s.entity, mode, { ...options, bindingPeriod: s.period || binding.period },hass), key: s.key, role: s.role || null }));
  result.sources = readings;
  result.requested = chosen.length;
  for (const r of readings) diagnostics.push(...r.diagnostics);
  const good = readings.filter((r) => r.status === 'ready');
  result.valid = good.length;
  if (!good.length) {
    result.status = readings.some((r) => r.status === 'invalid') || diagnostics.some((d) => d.code === 'binding') ? 'invalid'
      : readings.some((r) => r.status === 'unavailable') ? 'unavailable' : 'missing';
    return result;
  }
  const values = good.map((r) => r.value).sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  result.value = aggregation === 'min' ? values[0] : aggregation === 'max' ? values.at(-1)
    : aggregation === 'median' ? (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2
      : aggregation === 'mean' ? sum / values.length : sum;
  if (!finite(result.value)) { result.value = null; result.status = 'invalid'; diagnostics.push(issue('value', text(hass,'aggregate.range'))); }
  else result.status = good.length < readings.length || diagnostics.some((d) => d.code === 'binding') ? 'partial' : 'ready';
  return result;
}

export function statusColor(value, min, max, palette = 'temperature') {
  if (![value, min, max].every(finite) || max <= min) return UNKNOWN_STATUS_COLOR;
  const colors = Array.isArray(palette) ? palette : STATUS_PALETTES[palette];
  if (!Array.isArray(colors) || colors.length < 2 || !colors.every((c) => /^#[\da-f]{6}$/i.test(c))) return UNKNOWN_STATUS_COLOR;
  const t = Math.max(0, Math.min(1, (value - min) / (max - min))) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(t)), f = t - i;
  const rgb = (c) => [1, 3, 5].map((start) => parseInt(c.slice(start, start + 2), 16));
  const a = rgb(colors[i]), b = rgb(colors[i + 1]);
  return '#' + a.map((n, j) => Math.round(n + (b[j] - n) * f).toString(16).padStart(2, '0')).join('');
}

function resolvedRooms(rooms = [], floors = [], visibleFloors = 'all') {
  const visible = visibleFloors === 'all' ? null : new Set(Array.isArray(visibleFloors) ? visibleFloors : [visibleFloors]);
  const elevations = new Map((Array.isArray(floors) ? floors : []).filter(Boolean).map((f) => [f.id, finite(f.elevation) ? f.elevation : 0]));
  return (Array.isArray(rooms) ? rooms : []).flatMap((entry) => {
    const room = entry && (entry.room || entry);
    const floorId = entry?.floorId || room?.floor_id || room?.floorId;
    const polygon = room?.polygon || room?.outline;
    if (!room || typeof room.id !== 'string' || !floorId || entry.shown === false || (visible && !visible.has(floorId))
      || !Array.isArray(polygon) || polygon.length < 3 || !polygon.every(point) || !finite(signedArea(polygon)) || Math.abs(signedArea(polygon)) < 1e-9) return [];
    return [{ id: room.id, floorId, polygon: polygon.map((p) => p.slice(0, 2)), name: entry.name || room.name || room.label || room.id,
      areaId: room.area_id || null, elevation: elevations.get(floorId) || 0, center: centroid(polygon) }];
  });
}

export function buildRoomOverlays({ rooms = [], floors = [], states = {}, entities = {}, visibleFloors = 'all', config = {}, hass } = {}) {
  config = plain(config) ? config : {};
  const mode = config.mode || 'off';
  const stats = { rooms: 0, ready: 0, partial: 0, missing: 0, unavailable: 0, invalid: 0, total: null, totalReason: null };
  if (mode === 'off') return { rooms: [], legend: null, stats };
  const unit = outputUnit(mode, config.unit);
  const period = mode === 'energy' ? measurementPeriod(config.period) : null;
  const normalized = resolvedRooms(rooms, floors, visibleFloors);
  const output = normalized.map((room) => {
    const binding = at(config.bindings, room.id) || {};
    const metric = aggregateMeasurements(binding, states, entities, { mode, unit: config.unit, period: config.period },hass);
    const value = metric.value === null ? text(hass,metric.status === 'missing' ? 'overlay.missing' : metric.status === 'unavailable' ? 'overlay.unavailable' : 'overlay.choices') : `${fmt(metric.value)} ${metric.unit}`;
    const suffix = metric.status === 'partial' ? text(hass,'overlay.partial',{valid:metric.valid,requested:metric.requested}) : '';
    stats[metric.status]++; stats.rooms++;
    return { ...room, ...metric, label: `${room.name}: ${value}${suffix}` };
  });
  const canonical = mode === 'temperature' ? [16, 28] : mode === 'power' ? [0, 3000] : [0, 20];
  const defaults = mode === 'temperature' ? canonical.map((v) => fromCelsius(v, unit))
    : canonical.map((v) => v * (mode === 'energy' && unit === 'Wh' ? 1000 : mode === 'power' && unit === 'kW' ? .001 : 1));
  const readings = output.filter((r) => r.value !== null).map((r) => r.value);
  let min = finite(config.min) ? config.min : defaults[0], max = finite(config.max) ? config.max : defaults[1];
  if (config.scale === 'auto' && readings.length) { min = Math.min(...readings); max = Math.max(...readings); if (max === min) { min -= .5; max += .5; } }
  const validScale = finite(min) && finite(max) && max > min;
  const palette = config.palette || (mode === 'temperature' ? 'temperature' : 'usage');
  const colors = Array.isArray(palette) ? palette : STATUS_PALETTES[palette];
  const validPalette = Array.isArray(colors) && colors.length >= 2 && colors.every((c) => /^#[\da-f]{6}$/i.test(c));
  for (const room of output) room.color = validScale ? statusColor(room.value, min, max, palette) : UNKNOWN_STATUS_COLOR;
  const configured = output.filter((r) => r.requested > 0);
  if (mode !== 'temperature' && configured.length) {
    const seen = new Map(); let overlap = false;
    for (const room of configured) for (const source of room.sources) {
      const previous = seen.get(source.key);
      if (previous && previous !== room.id) overlap = true;
      seen.set(source.key, room.id);
    }
    if (overlap) stats.totalReason = text(hass,'overlay.overlap');
    else if (configured.some((r) => r.status !== 'ready' || r.aggregation !== 'sum')) stats.totalReason = text(hass,'overlay.complete');
    else if (configured.length > 1 && !configured.every((r) => r.scopeConfirmed)) stats.totalReason = text(hass,'overlay.scope');
    else { const total = configured.reduce((sum, r) => sum + r.value, 0); if (finite(total)) stats.total = total; }
  }
  const metricTitle = Object.hasOwn(metricNames,mode) ? text(hass,`metric.${mode}`) : text(hass,'legend.choose');
  const title = mode === 'energy' ? text(hass,'legend.energy',{metric:metricTitle,period:period || text(hass,'legend.choosePeriod')}) : metricTitle;
  return { rooms: output, stats, legend: { mode, title, unit, period, min, max, valid: validScale && validPalette && !!unit,
    palette, stops: validScale && validPalette ? [0, .25, .5, .75, 1].map((t) => ({ value: min + t * (max - min), color: statusColor(min + t * (max - min), min, max, palette) })) : [],
    label: validScale && validPalette && unit ? text(hass,'legend.label',{title,min:fmt(min),max:fmt(max),unit}) : text(hass,'legend.invalid') } };
}

const ALERT_TYPES = {
  smoke: { icon: 'mdi:smoke-detector', trigger: ['on'], clearStates: ['off'], active: 'smoke.active', clear: 'smoke.clear' },
  leak: { icon: 'mdi:water-alert', trigger: ['on'], clearStates: ['off'], active: 'leak.active', clear: 'leak.clear' },
  unlocked: { icon: 'mdi:lock-open', trigger: ['unlocked'], clearStates: ['locked'], active: 'unlocked.active', clear: 'unlocked.clear' },
  custom: { icon: 'mdi:alert', trigger: [], active: 'custom.active', clear: 'custom.clear' },
};

export function alertState(binding = {}, state, { latched = false, acknowledged = false } = {}, hass) {
  binding = plain(binding) ? binding : {};
  const type = at(ALERT_TYPES, binding.type || 'custom');
  const triggers = binding.trigger_states === undefined ? type?.trigger : binding.trigger_states;
  const clears = binding.clear_states === undefined ? type?.clearStates : binding.clear_states;
  const valid = type && Array.isArray(triggers) && triggers.length > 0 && triggers.every((v) => typeof v === 'string' && v.trim())
    && (clears === undefined || (Array.isArray(clears) && clears.length > 0 && clears.every((v) => typeof v === 'string' && v.trim())))
    && ['state', 'latched'].includes(binding.clear_rule || 'state');
  const raw = state?.state;
  const restored = state?.attributes?.restored === true;
  const good = !restored && typeof raw === 'string' && raw.trim() && raw !== 'unknown' && raw !== 'unavailable';
  const triggered = !!(valid && good && triggers.some((v) => v.trim().toLowerCase() === raw.toLowerCase()));
  const confirmed = triggered || (good && (clears === undefined || clears.some((v) => v.trim().toLowerCase() === raw.toLowerCase())));
  const keep = binding.clear_rule === 'latched' && latched && !acknowledged;
  const active = triggered || keep;
  const status = !valid ? 'invalid' : !state ? 'missing' : !good || !confirmed ? 'unavailable' : active ? 'active' : 'clear';
  const message = text(hass,`alert.${status === 'invalid' ? 'invalid' : status === 'missing' ? 'missing'
    : status === 'unavailable' ? restored ? active ? 'latchedRestored' : 'restored'
      : active ? 'latchedUnavailable' : 'unavailable' : active ? triggered ? type.active : 'acknowledge' : type.clear}`);
  return { status, active: valid && active, triggered, latched: valid && binding.clear_rule === 'latched' && active, message, icon: type?.icon || ALERT_TYPES.custom.icon };
}

export function alertPulse(timeMs = 0, reducedMotion = false) {
  if (reducedMotion) return { scale: 1, opacity: .8, animate: false };
  const wave = (Math.sin((finite(timeMs) ? timeMs : 0) / 1000 * Math.PI) + 1) / 2;
  return { scale: 1 + .4 * wave, opacity: .35 + .5 * wave, animate: true };
}

/** Explicit opt-in locations are SOURCE plan metres, without reference guesses.
 * Bindings without location_mode retain their original automatic precedence. */
export function resolveAlertLocation(binding, { rooms = [], floors = [], positions = {}, visibleFloors = 'all' } = {}, hass) {
  const mode = binding?.location_mode;
  const fail = (code, message) => ({ location: null, shown: false, diagnostics: [issue(code, message, binding?.entity)] });
  if (!['room', 'marker', 'coordinates'].includes(mode)) return fail('location_mode', text(hass,'location.mode'));
  const reference = (value, keys) => {
    const values = keys.filter((key) => Object.hasOwn(value, key)).map((key) => value[key]);
    if (!values.length) return { value: undefined };
    return values.every((id) => typeof id === 'string' && !!id.trim() && id === values[0]) ? { value: values[0] } : { invalid: true };
  };
  let x, y, z, floorId, sourceShown = true;
  if (mode === 'room') {
    const ref = reference(binding, ['roomId', 'room_id']);
    const matches = Array.isArray(rooms) ? rooms.filter((entry) => (entry?.room || entry)?.id === ref.value) : [];
    if (ref.invalid || !ref.value || matches.length !== 1) return fail('room', text(hass,'location.roomMissing'));
    const entry = matches[0], room = entry.room || entry, polygon = room.polygon || room.outline;
    const roomFloor = reference(room, ['floorId', 'floor_id']);
    if (roomFloor.invalid || entry.floorId !== undefined && roomFloor.value !== undefined && entry.floorId !== roomFloor.value) return fail('floor', text(hass,'location.roomFloor'));
    floorId = entry.floorId ?? roomFloor.value;
    if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every(point) || !finite(signedArea(polygon)) || Math.abs(signedArea(polygon)) < 1e-9) return fail('room', text(hass,'location.room'));
    [x, y] = centroid(polygon); z = .12; sourceShown = entry.shown !== false && room.shown !== false;
  } else if (mode === 'marker') {
    const ref = reference(binding, ['position_key', 'markerId']);
    const pos = ref.value && at(positions, ref.value);
    if (ref.invalid || !ref.value || !plain(pos)) return fail('marker', text(hass,'location.marker'));
    const override = reference(binding, ['floorId', 'floor_id']), sourceFloor = reference(pos, ['floorId', 'floor_id']);
    if (override.invalid || sourceFloor.invalid) return fail('floor', text(hass,'location.floorConflict'));
    const sourceFloors = Array.isArray(floors) ? floors.filter((floor) => floor?.id === sourceFloor.value) : [];
    if (!sourceFloor.value || sourceFloors.length !== 1 || !finite(sourceFloors[0].elevation) || sourceFloors[0].stale) return fail('floor', text(hass,'location.markerFloor'));
    x = pos.x; y = pos.y; z = pos.z ?? .12; floorId = override.value ?? sourceFloor.value;
    sourceShown = pos.shown !== false && pos.visible !== false;
  } else {
    const ref = reference(binding, ['floorId', 'floor_id']);
    if (ref.invalid) return fail('floor', text(hass,'location.floorConflict'));
    x = binding.x; y = binding.y; z = binding.z; floorId = ref.value;
  }
  if (![x, y, z].every(finite) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(z) > 1000) return fail('coordinates', text(hass,'location.coordinates'));
  const matches = Array.isArray(floors) ? floors.filter((floor) => floor?.id === floorId) : [];
  if (typeof floorId !== 'string' || !floorId.trim() || matches.length !== 1 || !finite(matches[0].elevation) || matches[0].stale) return fail('floor', text(hass,'location.floor'));
  const visible = visibleFloors === 'all' ? true : (Array.isArray(visibleFloors) ? visibleFloors : [visibleFloors]).includes(floorId);
  return { location: { x, y, z, floorId, elevation: matches[0].elevation }, shown: sourceShown && visible && binding.shown !== false, diagnostics: [] };
}

export function buildAlerts({ bindings = [], states = {}, positions = {}, rooms = [], floors = [], visibleFloors = 'all', previousLatches = {}, acknowledged = [], hass } = {}) {
  rooms = Array.isArray(rooms) ? rooms.filter(Boolean) : [];
  floors = Array.isArray(floors) ? floors.filter(Boolean) : [];
  const normalizedRooms = resolvedRooms(rooms, floors, 'all');
  const elevation = new Map(floors.filter(Boolean).map((f) => [f.id, finite(f.elevation) ? f.elevation : 0]));
  const visible = visibleFloors === 'all' ? null : new Set(Array.isArray(visibleFloors) ? visibleFloors : [visibleFloors]);
  const ack = acknowledged instanceof Set ? acknowledged : new Set(Array.isArray(acknowledged) ? acknowledged : []);
  const alerts = [], nextLatches = Object.create(null), used = new Set();
  const stats = { active: 0, clear: 0, unavailable: 0, missing: 0, invalid: 0, unplaced: 0 };
  for (const binding of Array.isArray(bindings) ? bindings : []) {
    if (!plain(binding) || binding.enabled === false) continue;
    const id = typeof binding.id === 'string' && binding.id ? binding.id : binding.entity;
    if (typeof id !== 'string' || !id || used.has(id)) { stats.invalid++; continue; }
    used.add(id);
    const state = at(states, binding.entity);
    const result = alertState(binding, state, { latched: !!at(previousLatches, id), acknowledged: ack.has(id) },hass);
    nextLatches[id] = result.latched;
    const roomId = binding.roomId || binding.room_id;
    const rawRoom = rooms.find((r) => (r.room || r).id === roomId);
    const room = normalizedRooms.find((r) => r.id === roomId);
    const pos = at(positions, binding.position_key || binding.markerId || binding.entity) || at(positions, `entity:${binding.entity}`);
    let x, y, z, floorId;
    if (binding.x !== undefined || binding.y !== undefined) { x = binding.x; y = binding.y; z = binding.z ?? .12; floorId = binding.floorId || binding.floor_id || room?.floorId; }
    else if (pos) { x = pos.x; y = pos.y; z = pos.z ?? .12; floorId = binding.floorId || binding.floor_id || pos.floorId || pos.floor_id; }
    else if (room) { [x, y] = room.center; z = binding.z ?? .12; floorId = room.floorId; }
    let location = finite(x) && finite(y) && finite(z) && typeof floorId === 'string' && (!floors.length || elevation.has(floorId))
      ? { x, y, z, floorId, elevation: elevation.get(floorId) || 0 } : null;
    let shown = !!location && (!visible || visible.has(floorId)) && binding.shown !== false && rawRoom?.shown !== false;
    let locationDiagnostics = location ? [] : [issue('location', text(hass,'location.automatic'), binding.entity)];
    if (Object.hasOwn(binding, 'location_mode')) {
      const explicit = resolveAlertLocation(binding, { rooms, floors, positions, visibleFloors },hass);
      location = explicit.location; shown = explicit.shown; locationDiagnostics = explicit.diagnostics;
    }
    const name = binding.label || state?.attributes?.friendly_name || binding.entity || id;
    alerts.push({ id, entity: binding.entity, ...result, location, shown,
      label: `${name}: ${result.message}`, color: result.active ? '#d83d46' : UNKNOWN_STATUS_COLOR,
      diagnostics: locationDiagnostics });
    stats[result.status]++; if (result.active && result.status !== 'active') stats.active++; if (!location) stats.unplaced++;
  }
  return { alerts, nextLatches, stats };
}

// Adapter for the existing Three.js scene. Root owns config/UI and drives update() from its render loop.
export class StatusOverlays {
  constructor(parent, { document: doc = globalThis.document, onInvalidate } = {}) {
    this.group = new THREE.Group(); this.group.name = 'taylors3d-status-overlays'; this.group.userData.helper = true;
    parent.add(this.group); this.doc = doc; this.onInvalidate = onInvalidate;
    this.rooms = new Map(); this.alerts = new Map(); this.disposed = false; this.hasAnimation = false;
    this.ringGeometry = new THREE.RingGeometry(.22, .32, 32); this.ringGeometry.rotateX(-Math.PI / 2);
  }

  _label(text, icon) {
    if (!this.doc) return null;
    const el = this.doc.createElement('div'); el.className = 'taylors3d-status-label';
    Object.assign(el.style, { padding: '3px 6px', borderRadius: '5px', fontSize: '11px', color: 'var(--primary-text-color,#222)',
      background: 'var(--ha-card-background,var(--card-background-color,#fff))', pointerEvents: 'none', whiteSpace: 'nowrap' });
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true');
    if (icon) { const symbol = this.doc.createElement('ha-icon'); symbol.setAttribute('icon', icon); symbol.setAttribute('aria-hidden', 'true'); symbol.style.setProperty('--mdc-icon-size', '16px'); el.append(symbol); }
    const span = this.doc.createElement('span'); span.textContent = text; el.append(span);
    const obj = new CSS2DObject(el); obj.userData.helper = true;
    return obj;
  }

  _remove(part) {
    if (part.label) { part.label.element.remove(); part.label.removeFromParent(); }
    part.mesh.removeFromParent(); if (part.ownGeometry) part.mesh.geometry.dispose(); part.mesh.material.dispose();
  }

  setData({ rooms = [], alerts = [] } = {}) {
    if (this.disposed) return false;
    let changed = false;
    const ids = new Set();
    for (const room of rooms) {
      if (!Array.isArray(room.polygon) || room.polygon.length < 3 || !room.polygon.every(point)) continue;
      const id = `${room.floorId}:${room.id}`; ids.add(id);
      const signature = JSON.stringify([room.polygon, room.elevation]); let part = this.rooms.get(id);
      if (part && part.signature !== signature) { this._remove(part); this.rooms.delete(id); part = null; }
      if (!part) {
        const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
        const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({ color: room.color || UNKNOWN_STATUS_COLOR, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
        const mesh = new THREE.Mesh(geometry, material); mesh.position.y = (room.elevation || 0) + .018; mesh.renderOrder = 4; mesh.userData.helper = true; mesh.raycast = () => {};
        const label = this._label(room.label || room.id); const center = centroid(room.polygon);
        if (label) { label.center.set(.5, 1.5); label.position.set(center[0], (room.elevation || 0) + .03, -center[1]); this.group.add(label); }
        this.group.add(mesh); part = { mesh, label, ownGeometry: true, signature }; this.rooms.set(id, part); changed = true;
      }
      const appearance = JSON.stringify([room.color || UNKNOWN_STATUS_COLOR, room.status === 'ready' ? .5 : .3, room.label || room.id, room.requested !== 0]);
      if (part.appearance === appearance) continue;
      part.appearance = appearance; changed = true;
      part.mesh.material.color.set(room.color || UNKNOWN_STATUS_COLOR); part.mesh.material.opacity = room.status === 'ready' ? .5 : .3;
      if (part.label) {
        const span = part.label.element.querySelector('span'); if (span.textContent !== (room.label || room.id)) span.textContent = room.label || room.id;
        // The legend explains unbound grey rooms. Keep their diagnostics in data without
        // crowding the house with identical labels; configured missing sensors stay labelled.
        part.label.visible = room.requested !== 0; part.label.element.hidden = room.requested === 0;
      }
    }
    for (const [id, part] of this.rooms) if (!ids.has(id)) { this._remove(part); this.rooms.delete(id); changed = true; }
    const alertIds = new Set();
    for (const alert of alerts) {
      if (!alert.location || ![alert.location.x, alert.location.y, alert.location.z, alert.location.elevation ?? 0].every(finite)
        || !alert.shown || (!alert.active && alert.status === 'clear')) continue;
      alertIds.add(alert.id); let part = this.alerts.get(alert.id);
      if (!part) {
        const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
        const mesh = new THREE.Mesh(this.ringGeometry, material); mesh.renderOrder = 10; mesh.userData.helper = true; mesh.raycast = () => {};
        const label = this._label(alert.label, alert.icon); this.group.add(mesh); if (label) { label.center.set(.5, 1.4); this.group.add(label); }
        part = { mesh, label, ownGeometry: false }; this.alerts.set(alert.id, part); changed = true;
      }
      const p = alert.location;
      const appearance = JSON.stringify([p.x, (p.elevation ?? 0) + p.z, -p.y, alert.color || UNKNOWN_STATUS_COLOR, !!alert.active, alert.label, alert.icon]);
      if (part.appearance === appearance) continue;
      part.appearance = appearance; changed = true;
      part.mesh.position.set(p.x, (p.elevation ?? 0) + p.z, -p.y); part.mesh.material.color.set(alert.color || UNKNOWN_STATUS_COLOR);
      part.active = !!alert.active;
      if (!part.active) { part.mesh.scale.setScalar(1); part.mesh.material.opacity = .8; }
      if (part.label) {
        part.label.position.copy(part.mesh.position).add(new THREE.Vector3(0, .1, 0));
        const span = part.label.element.querySelector('span'); if (span.textContent !== alert.label) span.textContent = alert.label;
        part.label.element.querySelector('ha-icon')?.setAttribute('icon', alert.icon);
      }
    }
    for (const [id, part] of this.alerts) if (!alertIds.has(id)) { this._remove(part); this.alerts.delete(id); changed = true; }
    if (changed) {
      this.hasAnimation = [...this.alerts.values()].some((a) => a.active);
      this.onInvalidate?.();
    }
    return changed;
  }

  update(nowMs, { reducedMotion = false } = {}) {
    if (this.disposed || !this.group.visible) return false;
    let animate = false, changed = false;
    for (const part of this.alerts.values()) {
      const pulse = alertPulse(nowMs, reducedMotion || !part.active);
      changed ||= part.mesh.scale.x !== pulse.scale || part.mesh.material.opacity !== pulse.opacity;
      part.mesh.scale.setScalar(pulse.scale); part.mesh.material.opacity = pulse.opacity;
      animate ||= pulse.animate && part.active;
    }
    return animate || changed;
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const part of this.rooms.values()) this._remove(part); for (const part of this.alerts.values()) this._remove(part);
    this.rooms.clear(); this.alerts.clear(); this.ringGeometry.dispose(); this.group.removeFromParent(); this.hasAnimation = false;
  }
}
