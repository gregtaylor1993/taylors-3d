// Observations, never invented routes/identities. Root supplies time and owns expiry scheduling.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { entityMetadata } from './entity-metadata.js';
import { centroid, pointInPolygon, signedArea } from './placement.js';
import { readCoordinate, compileCalibration, readFreshness, readDetection } from './tracked-source.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const at = (values, key) => values instanceof Map ? values.get(key) : values && Object.hasOwn(values, key) ? values[key] : undefined;
const text = (value) => typeof value === 'string' && !!value.trim();
const color = (value) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const issue = (code, message, entity, id) => ({ code, message, entity: entity || null, id: id || null });
const current = (metadata) => metadata.available && !metadata.hidden && !metadata.category && metadata.state?.attributes?.restored !== true;
const colors = { presence: '#8c6de0', activity: '#e9a338', vehicle: '#459cb4', vacuum: '#57b990' };
const icons = { presence: 'mdi:account', activity: 'mdi:motion-sensor', vehicle: 'mdi:car', vacuum: 'mdi:robot-vacuum' };
export const TRACKING_LIMITS = Object.freeze({ coordinate: 1000000, height: 1000, maxRecords: 500, interpolation: 2000 });

function context(options) {
  const hass = options.hass || { states: options.states || {}, entities: options.entities || {}, devices: options.devices || {} };
  const floors = new Map();
  for (const floor of Array.isArray(options.floors) ? options.floors : []) if (text(floor?.id) && finite(floor.elevation)) floors.set(floor.id, floors.has(floor.id) ? null : floor);
  const rooms = new Map();
  for (const entry of Array.isArray(options.rooms) ? options.rooms : []) {
    const room = entry?.room || entry, floorId = entry?.floorId || room?.floor_id || room?.floorId;
    if (!text(room?.id)) continue;
    if (rooms.has(room.id)) { rooms.set(room.id, null); continue; }
    const polygon = room.polygon || room.outline;
    const valid = Array.isArray(polygon) && polygon.length >= 3 && polygon.every((p) => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1])) && Math.abs(signedArea(polygon)) > 1e-9;
    let center = valid ? centroid(polygon) : null;
    // A concave room's centroid can be outside it. Use an interior triangle for its room symbol.
    if (center && !pointInPolygon(center, polygon)) {
      const vertices = polygon.map(([x, y]) => new THREE.Vector2(x, y));
      const triangles = THREE.ShapeUtils.triangulateShape(vertices, []);
      const candidates = triangles.map((ids) => ids.map((i) => polygon[i]));
      candidates.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
      center = candidates.map((p) => centroid(p)).find((p) => pointInPolygon(p, polygon)) || null;
    }
    rooms.set(room.id, { id: room.id, floorId, polygon, center, name: entry.name || room.name || room.label || room.id,
      shown: entry.shown !== false && entry.visible !== false && room.hidden !== true && room.shown !== false });
  }
  const visible = options.visibleFloors === undefined || options.visibleFloors === 'all' ? null : new Set(options.visibleFloors instanceof Set || Array.isArray(options.visibleFloors) ? options.visibleFloors : [options.visibleFloors]);
  return { hass, floors, rooms, positions: options.positions || {}, visible, now: options.now ?? Date.now(), previous: options.memory || {} };
}

function position(raw, ctx, floorOverride) {
  if (!plain(raw)) return null;
  const floorId = raw.floorId ?? raw.floor_id ?? floorOverride, elevation = ctx.floors.get(floorId)?.elevation;
  const z = raw.z ?? .12;
  if (!text(floorId) || !finite(elevation) || floorOverride && floorOverride !== floorId || ![raw.x, raw.y, z].every(finite)
    || Math.abs(raw.x) > TRACKING_LIMITS.coordinate || Math.abs(raw.y) > TRACKING_LIMITS.coordinate || Math.abs(z) > TRACKING_LIMITS.height) return null;
  return { x: raw.x, y: raw.y, z, floorId, elevation };
}
function roomLocation(id, ctx) {
  const room = ctx.rooms.get(id);
  return room?.center ? { location: position({ x: room.center[0], y: room.center[1], floorId: room.floorId }, ctx), room, shown: room.shown } : null;
}
function anchor(binding, ctx, diagnostics) {
  const selectors = [binding.roomId !== undefined, binding.position_key !== undefined, binding.position !== undefined].filter(Boolean).length;
  if (selectors > 1) { diagnostics.push(issue('anchor_conflict', 'Choose one room, marker or position anchor.', binding.entity, binding.id)); return null; }
  let resolved;
  if (binding.roomId !== undefined) resolved = roomLocation(binding.roomId, ctx);
  else if (binding.position_key !== undefined) {
    const raw = at(ctx.positions, binding.position_key);
    resolved = { location: position(raw, ctx, binding.floorId), shown: raw?.shown !== false && raw?.visible !== false,
      room: raw?.roomId ? ctx.rooms.get(raw.roomId) : null };
    if (raw?.roomId && !resolved.room) resolved.shown = false;
  } else if (binding.position !== undefined) resolved = { location: position(binding.position, ctx, binding.floorId), shown: binding.position?.shown !== false };
  if (!resolved?.location) diagnostics.push(issue('anchor', 'Choose a real room outline, marker anchor or finite position on a mapped floor.', binding.entity, binding.id));
  return resolved?.location ? resolved : null;
}
function roomObservation(source, fallbackEntity, ctx, diagnostics, id) {
  if (!plain(source) || !plain(source.room_map)) { diagnostics.push(issue('room_map', 'Map exact room readings to room outlines.', fallbackEntity, id)); return { status: 'invalid', resolved: null }; }
  const entity = source.entity || fallbackEntity, metadata = entityMetadata(ctx.hass, entity);
  if (!current(metadata)) {
    const status = metadata.missing ? 'missing' : 'unavailable';
    diagnostics.push(issue(status, 'Room source is missing, hidden, disabled, diagnostic, restored or unavailable.', entity, id)); return { status, resolved: null };
  }
  if (['motion', 'occupancy', 'presence'].includes(metadata.deviceClass) && metadata.domain === 'binary_sensor') {
    diagnostics.push(issue('activity_not_identity', 'Motion or occupancy reports room activity, not a person’s room identity.', entity, id)); return { status: 'invalid', resolved: null };
  }
  const raw = source.attribute ? metadata.state.attributes?.[source.attribute] : metadata.state.state;
  if (!(typeof raw === 'string' || finite(raw))) { diagnostics.push(issue('room_reading', 'Room source must report one exact room value.', entity, id)); return { status: 'invalid', resolved: null }; }
  if (['home', 'not_home', 'away'].includes(String(raw))) {
    diagnostics.push(issue('home_not_room', 'Home or away does not identify a room. Use a real room-level source.', entity, id)); return { status: String(raw) === 'home' ? 'unplaced' : 'away', resolved: null };
  }
  const mapped = at(source.room_map, String(raw)), ids = Array.isArray(mapped) ? [...new Set(mapped)] : text(mapped) ? [mapped] : [];
  if (ids.length > 1) { diagnostics.push(issue('ambiguous_room', 'This observation points to more than one room. Correct the mapping.', entity, id)); return { status: 'ambiguous', resolved: null }; }
  const resolved = ids.length === 1 ? roomLocation(ids[0], ctx) : null;
  if (!resolved?.location) { diagnostics.push(issue('room_unknown', 'This reading has no unique mapped room outline.', entity, id)); return { status: 'unplaced', resolved: null }; }
  return { status: 'ready', resolved, entity };
}
function bindings(options, ctx, diagnostics) {
  const list = (Array.isArray(options.bindings) ? options.bindings : []).filter((b) => plain(b) && b.enabled !== false);
  const counts = new Map();
  for (const b of list) if (text(b.id)) counts.set(b.id, (counts.get(b.id) || 0) + 1);
  return list.filter((b, index) => {
    if (index >= TRACKING_LIMITS.maxRecords || !text(b.id) || counts.get(b.id) !== 1 || !text(b.entity) || !finite(ctx.now)) {
      diagnostics.push(issue('binding', 'Choose a unique tracking ID, an entity and a valid current time; limit each layer to 500 records.', b.entity, b.id)); return false;
    }
    return true;
  });
}
function finish(result) {
  result.miniMap = result.records.filter((record) => record.shown && record.location).map((record) => ({ id: record.id, entityId: record.entity, name: record.label, icon: record.icon, active: record.active, status: record.status, position: { ...record.location } }));
  return result;
}
function base(binding, kind, ctx, diagnostics) {
  const metadata = entityMetadata(ctx.hass, binding.entity), styleValid = (binding.color === undefined || color(binding.color)) && (binding.size === undefined || finite(binding.size) && binding.size >= .1 && binding.size <= 5)
    && (binding.heading === undefined || finite(binding.heading));
  if (!styleValid) diagnostics.push(issue('style', 'Use a six-digit colour, a size from 0.1 to 5 and a finite heading.', binding.entity, binding.id));
  return { id: `${kind}:${binding.id}`, bindingId: binding.id, entity: binding.entity, kind, status: 'ready', active: false, location: null, shown: false,
    label: binding.label || metadata.name, name: binding.label || metadata.name, color: binding.color || colors[kind], icon: icons[kind], heading: finite(binding.heading) ? ((binding.heading % 360) + 360) % 360 : null,
    size: binding.size ?? 1, measured: false, metadata, styleValid };
}
function place(record, resolved, ctx) {
  record.location = resolved?.location || null;
  record.roomId = resolved?.room?.id || null;
  const point = record.location ? [record.location.x, record.location.y] : null;
  const containing = point ? [...ctx.rooms.values()].filter((room) => room?.center && room.floorId === record.location.floorId && pointInPolygon(point, room.polygon)) : [];
  if (!record.roomId && containing.length === 1) record.roomId = containing[0].id;
  const floor = record.location ? ctx.floors.get(record.location.floorId) : null;
  record.shown = !!record.location && resolved?.shown !== false && resolved?.room?.shown !== false && !containing.some((room) => !room.shown)
    && floor?.shown !== false && floor?.visible !== false && floor?.hidden !== true && record.styleValid && !record.metadata.hidden && !record.metadata.disabled && !record.metadata.category && (!ctx.visible || ctx.visible.has(record.location.floorId));
}
function expiry(result, value, now) { if (finite(value) && value > now) result.nextExpiry = result.nextExpiry === null ? value : Math.min(result.nextExpiry, value); }
function freshness(binding, state, ctx, result) {
  if (binding.freshness === undefined) return { status: 'current', verified: false };
  const reading = readFreshness(state, binding.freshness, ctx.now);
  result.diagnostics.push(...reading.diagnostics.map((d) => ({ ...d, entity: binding.entity, id: binding.id })));
  expiry(result, reading.nextExpiry, ctx.now); return reading;
}
const empty = () => ({ records: [], diagnostics: [], memory: {}, nextExpiry: null, miniMap: [] });

/** presence kind room_activity|room_location; motion never supplies a person's identity. */
export function buildPresence(options = {}) {
  const ctx = context(options), result = empty();
  for (const binding of bindings(options, ctx, result.diagnostics)) {
    const activity = binding.kind === 'room_activity', record = base(binding, activity ? 'activity' : 'presence', ctx, result.diagnostics);
    if (!['room_activity', 'room_location'].includes(binding.kind)) { record.status = 'invalid'; result.diagnostics.push(issue('kind', 'Choose room activity or an actual room-location source.', binding.entity, binding.id)); }
    else if (!current(record.metadata)) { record.status = record.metadata.missing ? 'missing' : 'unavailable'; result.diagnostics.push(issue(record.status, 'Tracking source is missing, hidden, disabled, diagnostic, restored or unavailable.', binding.entity, binding.id)); }
    else {
      const fresh = freshness(binding, record.metadata.state, ctx, result);
      if (!['ready', 'current'].includes(fresh.status)) record.status = fresh.status;
      else if (activity) {
        const detection = readDetection(record.metadata.state, { kind: 'occupancy', active_states: binding.active_states, clear_states: binding.clear_states }, ctx.now);
        result.diagnostics.push(...detection.diagnostics.map((d) => ({ ...d, id: binding.id, entity: binding.entity })));
        record.status = detection.status; record.active = detection.active;
        if (binding.identity_entity) result.diagnostics.push(issue('activity_not_identity', 'Room activity cannot identify a person; that identity is ignored.', binding.entity, binding.id));
      } else {
        const observed = roomObservation(binding.room_source, binding.entity, ctx, result.diagnostics, binding.id);
        record.status = observed.status; record.active = observed.status === 'ready';
        place(record, observed.resolved, ctx);
        const identity = binding.identity_entity || (record.metadata.domain === 'person' || record.metadata.domain === 'device_tracker' ? binding.entity : null);
        const identityMeta = identity ? entityMetadata(ctx.hass, identity) : null;
        record.identity = identityMeta && current(identityMeta) && ['person', 'device_tracker'].includes(identityMeta.domain) ? identity : null;
        if (record.identity && !binding.label) record.name = identityMeta.name;
        if (binding.identity_entity && !record.identity) { record.status = 'unavailable'; record.active = false; record.location = null; record.shown = false; result.diagnostics.push(issue('identity', 'The associated person/device must exist and be available.', binding.identity_entity, binding.id)); }
        if (record.identity && record.active && ['not_home', 'away'].includes(identityMeta.state.state)) {
          record.status = 'ambiguous'; record.active = false; record.location = null; record.shown = false;
          result.diagnostics.push(issue('conflicting_presence', 'The person/device reports away while its room source reports a room. Check both sources.', identity, binding.id));
        }
      }
    }
    if (activity) {
      place(record, anchor(binding, ctx, result.diagnostics), ctx);
      record.label = `${binding.label || record.metadata.name}: ${record.active ? binding.signal === 'occupancy' ? 'Occupancy reported' : 'Room activity' : record.status === 'ready' || record.status === 'clear' ? 'No activity reported' : record.status}`;
      if (!record.active && ['ready', 'clear'].includes(record.status) && binding.show_inactive !== true) record.shown = false;
    } else record.label = `${record.name}: ${record.roomId && record.active ? `${ctx.rooms.get(record.roomId)?.name} (room observation)` : record.status === 'ready' ? 'Room unknown' : record.status}`;
    if (!record.active || !record.styleValid) record.color = '#8d9199';
    result.records.push(record);
  }
  // Conflicting independent observations of the same identity do not choose a new room.
  const identities = new Map();
  for (const record of result.records) if (record.identity && record.active) { if (!identities.has(record.identity)) identities.set(record.identity, []); identities.get(record.identity).push(record); }
  for (const [identity, records] of identities) {
    if (new Set(records.map((record) => record.roomId)).size > 1) {
      for (const record of records) { record.status = 'ambiguous'; record.active = false; record.shown = false; record.location = null; record.label = `${record.name}: Conflicting room observations`; }
      result.diagnostics.push(issue('conflicting_presence', 'Multiple observations place this person/device in different rooms.', identity));
    } else if (records.length > 1) {
      records.sort((a, b) => a.id.localeCompare(b.id));
      for (const record of records.slice(1)) { record.shown = false; record.supporting = true; }
      result.diagnostics.push(issue('supporting_presence', 'Matching observations support one person/device symbol in this room.', identity));
    }
  }
  return finish(result);
}

/** vehicle kind occupancy|count|event. Event sightings never claim a vehicle remains parked. */
export function buildVehicles(options = {}) {
  const ctx = context(options), result = empty();
  for (const binding of bindings(options, ctx, result.diagnostics)) {
    const record = base(binding, 'vehicle', ctx, result.diagnostics);
    const detection = readDetection(record.metadata.state, binding, ctx.now, at(ctx.previous, binding.id) || {});
    result.memory = { ...result.memory, [binding.id]: detection.memory };
    result.diagnostics.push(...detection.diagnostics.map((d) => ({ ...d, id: binding.id, entity: binding.entity })));
    if (current(record.metadata)) expiry(result, detection.nextExpiry, ctx.now);
    record.status = record.metadata.missing ? 'missing' : !current(record.metadata) ? 'unavailable' : detection.status;
    record.active = current(record.metadata) && detection.active;
    const validKind = ['occupancy', 'count', 'event'].includes(binding.kind);
    record.count = detection.count; record.evidence = validKind ? binding.kind === 'event' ? 'sighting' : 'maintained' : null;
    if (!validKind) {
      record.status = 'invalid'; record.active = false;
      result.diagnostics.push(issue('kind', 'Choose maintained occupancy, vehicle count or a timestamped event explicitly.', binding.entity, binding.id));
    }
    if (binding.vehicle_source_confirmed !== true || record.metadata.deviceClass === 'motion') {
      record.status = 'invalid'; record.active = false;
      result.diagnostics.push(issue('vehicle_source', 'Confirm a source that reports vehicles at this location. General motion does not prove a parked car.', binding.entity, binding.id));
    }
    let identityName = null;
    if (binding.identity_entity) {
      const identity = entityMetadata(ctx.hass, binding.identity_entity), observed = binding.identity_attribute ? identity.state?.attributes?.[binding.identity_attribute] : identity.state?.state;
      if (current(identity) && (text(observed) || finite(observed)) && text(binding.identity_value) && String(observed) === binding.identity_value && identity.deviceClass !== 'motion') identityName = identity.name;
      else result.diagnostics.push(issue('vehicle_identity', 'A named vehicle requires its available identity source to match the exact chosen identifier.', binding.identity_entity, binding.id));
    }
    record.identity = identityName ? binding.identity_entity : null;
    const name = identityName || 'Vehicle', prefix = binding.label ? `${binding.label}: ` : '';
    record.label = `${prefix}${name}${record.active ? binding.kind === 'event' ? ' seen recently' : ` parked${finite(record.count) && record.count > 1 ? ` (${record.count} reported)` : ''}` : ['ready', 'clear'].includes(record.status) ? ' not reported' : ` — ${record.status}`}`;
    place(record, anchor(binding, ctx, result.diagnostics), ctx);
    if (!record.active && ['ready', 'clear'].includes(record.status) && binding.show_inactive !== true) record.shown = false;
    if (!record.active || !record.styleValid) record.color = '#8d9199';
    result.records.push(record);
  }
  return finish(result);
}

/** vacuum kind static|room|xy. A cleaning state alone never creates movement. */
export function buildVacuums(options = {}) {
  const ctx = context(options), result = empty();
  for (const binding of bindings(options, ctx, result.diagnostics)) {
    const record = base(binding, 'vacuum', ctx, result.diagnostics), state = record.metadata.state;
    record.active = current(record.metadata) && state.state === 'cleaning';
    record.status = record.metadata.missing ? 'missing' : !current(record.metadata) ? 'unavailable' : 'ready';
    if (record.status === 'ready') {
      const statusFreshness = freshness(binding, state, ctx, result);
      if (!['current', 'ready'].includes(statusFreshness.status)) { record.status = statusFreshness.status; record.active = false; }
    }
    if (!current(record.metadata)) result.diagnostics.push(issue(record.status, 'Vacuum source is missing, hidden, disabled or unavailable.', binding.entity, binding.id));
    let resolved = null, sourceStatus = null;
    if (!['static', 'room', 'xy'].includes(binding.kind) || record.metadata.domain !== 'vacuum') { record.status = 'invalid'; record.active = false; result.diagnostics.push(issue('vacuum', 'Choose a vacuum entity and static, room or measured position mode.', binding.entity, binding.id)); }
    else if (current(record.metadata) && binding.kind === 'room') {
      const observed = roomObservation(binding.room_source, binding.entity, ctx, result.diagnostics, binding.id);
      resolved = observed.resolved; sourceStatus = observed.status;
    } else if (current(record.metadata) && binding.kind === 'xy') {
      const source = plain(binding.position_source) ? binding.position_source : {}, sourceEntity = source.entity || binding.entity, metadata = entityMetadata(ctx.hass, sourceEntity);
      const read = readCoordinate(metadata.state, source), compiled = compileCalibration(source), fresh = readFreshness(metadata.state, source.freshness, ctx.now);
      for (const diagnostics of [read.diagnostics, compiled.diagnostics, fresh.diagnostics]) result.diagnostics.push(...diagnostics.map((d) => ({ ...d, id: binding.id, entity: sourceEntity })));
      expiry(result, fresh.nextExpiry, ctx.now);
      sourceStatus = !current(metadata) ? metadata.missing ? 'missing' : 'unavailable' : read.status !== 'ready' ? read.status : compiled.status !== 'ready' ? compiled.status : !['current', 'ready'].includes(fresh.status) ? fresh.status : 'ready';
      const mapped = sourceStatus === 'ready' ? compiled.transform(read) : null;
      const floorId = source.floorId || binding.floorId;
      const location = Array.isArray(mapped) ? position({ x: mapped[0], y: mapped[1], z: source.z ?? .05, floorId }, ctx) : null;
      if (sourceStatus === 'ready' && !location) { sourceStatus = 'invalid'; result.diagnostics.push(issue('position', 'Measured vacuum coordinates need finite plan metres and an explicit mapped floor.', sourceEntity, binding.id)); }
      if (location) { resolved = { location, shown: true }; record.measured = true; record.freshnessVerified = fresh.verified; }
    }
    if (!resolved && (binding.roomId !== undefined || binding.position_key !== undefined || binding.position !== undefined)) resolved = anchor(binding, ctx, result.diagnostics);
    if (!resolved) result.diagnostics.push(issue('unplaced', 'Choose a stationary status anchor or provide a valid measured/room position.', binding.entity, binding.id));
    place(record, resolved, ctx);
    const activity = record.status === 'ready' && typeof state?.state === 'string' ? state.state.charAt(0).toUpperCase() + state.state.slice(1).replaceAll('_', ' ') : record.status;
    record.positionStatus = sourceStatus || (binding.kind === 'static' ? 'status_only' : 'unplaced');
    record.label = `${binding.label || record.metadata.name}: ${activity} · ${record.measured ? 'reported position' : binding.kind === 'room' && sourceStatus === 'ready' ? 'room observation' : `status at chosen anchor; position ${sourceStatus || 'not reported'}`}`;
    record.transitionMs = record.measured && record.active && finite(binding.interpolate_ms) ? Math.max(0, Math.min(TRACKING_LIMITS.interpolation, binding.interpolate_ms)) : 0;
    if (record.status !== 'ready' || !current(record.metadata) || !record.styleValid || sourceStatus && sourceStatus !== 'ready') record.color = '#8d9199';
    result.records.push(record);
  }
  return finish(result);
}

export function buildTrackedEntities(options = {}) {
  const previous = options.memory || {};
  const presence = buildPresence({ ...options, bindings: options.presence_bindings, memory: previous.presence });
  const vehicles = buildVehicles({ ...options, bindings: options.vehicle_bindings, memory: previous.vehicles });
  const vacuums = buildVacuums({ ...options, bindings: options.vacuum_bindings, memory: previous.vacuums });
  const deadlines = [presence.nextExpiry, vehicles.nextExpiry, vacuums.nextExpiry].filter(finite);
  return { records: [...presence.records, ...vehicles.records, ...vacuums.records], diagnostics: [...presence.diagnostics, ...vehicles.diagnostics, ...vacuums.diagnostics],
    memory: { presence: presence.memory, vehicles: vehicles.memory, vacuums: vacuums.memory }, nextExpiry: deadlines.length ? Math.min(...deadlines) : null,
    miniMap: [...presence.miniMap, ...vehicles.miniMap, ...vacuums.miniMap] };
}

const helper = (object) => { object.userData.helper = true; object.raycast = () => {}; return object; };
const clockNow = () => globalThis.performance?.now?.() ?? 0;

// An owned generic car, pointing north (-Z): body, cabin and four wheels. The single
// shared geometry uses fixed vertex shades; each instance still has its own paint material.
function carGeometry() {
  const pieces = [], add = (geometry, shade) => {
    const count = geometry.getAttribute('position').count, colours = new Float32Array(count * 3); colours.fill(shade);
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3)); pieces.push(geometry);
  };
  add(new THREE.BoxGeometry(1.5, .5, 3.1).translate(0, .37, 0), 1);
  add(new THREE.BoxGeometry(1.1, .53, 1.4).translate(0, .885, .12), .75);
  for (const x of [-.75, .75]) for (const z of [-1.02, 1.02]) add(new THREE.CylinderGeometry(.27, .27, .18, 10).rotateZ(Math.PI / 2).translate(x, .27, z), .16);
  try { return mergeGeometries(pieces, false); } finally { for (const geometry of pieces) geometry.dispose(); }
}

/** Reuses one existing scene. Optional interpolation joins measured samples, never predicts a route. */
export class TrackedEntitiesLayer {
  constructor(parent, { document: doc = globalThis.document, onInvalidate, onSelect, returnFocus } = {}) {
    this.group = new THREE.Group(); this.group.name = 'taylors3d-tracked-entities'; this.group.userData.helper = true;
    parent.add(this.group); this.doc = doc; this.onInvalidate = onInvalidate; this.parts = new Map(); this.disposed = false;
    this.geometries = new Map();
    this.onSelect = typeof onSelect === 'function' ? onSelect : null; this.returnFocus = returnFocus; this.selectable = true;
  }
  _geometry(kind) {
    if (!this.geometries.has(kind)) {
      let geometry;
      if (kind === 'vehicle') geometry = carGeometry();
      else if (kind === 'vacuum') { geometry = new THREE.CylinderGeometry(.19, .19, .09, 24); }
      else { geometry = kind === 'activity' ? new THREE.RingGeometry(.15, .22, 24) : new THREE.CircleGeometry(.16, 24); geometry.rotateX(-Math.PI / 2); }
      this.geometries.set(kind, geometry);
    }
    return this.geometries.get(kind);
  }
  _create(record) {
    const group = helper(new THREE.Group()); group.name = `taylors3d-tracked-${record.id}`;
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, vertexColors: record.kind === 'vehicle' });
    const mesh = helper(new THREE.Mesh(this._geometry(record.kind), material));
    mesh.renderOrder = 7; group.add(mesh);
    let label = null; const listeners = [];
    if (this.doc) {
      const interactive = !!this.onSelect, el = this.doc.createElement(interactive ? 'button' : 'div'); el.className = 'taylors3d-tracked-label';
      el.dataset.trackingId = record.id;
      Object.assign(el.style, { padding: interactive ? '6px 9px' : '3px 6px', fontFamily: 'inherit', fontSize: '11px', borderRadius: '5px', whiteSpace: 'nowrap', pointerEvents: interactive ? 'auto' : 'none', color: 'var(--primary-text-color,#222)', background: 'var(--card-background-color,#fff)' });
      if (interactive) {
        el.type = 'button'; el.dataset.taylors3dUi = 'tracking';
        Object.assign(el.style, { minWidth: '44px', minHeight: '44px', maxWidth: '200px', boxSizing: 'border-box', overflow: 'hidden', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', border: '1px solid var(--divider-color,#ddd)' });
        const listen = (type, handler) => { el.addEventListener(type, handler); listeners.push(() => el.removeEventListener(type, handler)); };
        for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'touchmove', 'wheel', 'dblclick', 'contextmenu']) listen(type, (event) => event.stopPropagation());
        listen('click', (event) => {
          event.stopPropagation();
          if (!this.disposed && this.group.visible && this.selectable && !el.hidden && this.parts.get(record.id)?.label?.element === el) this.onSelect?.(record.id);
        });
        listen('keydown', (event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); this._focusOutside(el); }
          // Enter and Space retain native button activation; no duplicate synthetic click.
        });
      } else { el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true'); }
      const icon = this.doc.createElement('ha-icon'); icon.setAttribute('aria-hidden', 'true'); icon.style.setProperty('--mdc-icon-size', '16px');
      const span = this.doc.createElement('span');
      if (interactive) {
        span.setAttribute('aria-live', 'polite'); span.setAttribute('aria-atomic', 'true');
        Object.assign(span.style, { display: 'inline-block', verticalAlign: 'middle', maxWidth: '156px', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
      }
      el.append(icon, span);
      label = helper(new CSS2DObject(el)); label.position.y = record.kind === 'vehicle' ? .8 : .2; label.center.set(.5, 1); group.add(label);
      // CSS2DRenderer sorts its own objects, independently of the mesh's renderOrder.
      // Dedicated controls must win a real hit-test over an ordinary sensor label below them.
      if (interactive) label.renderOrder = 20;
    }
    this.group.add(group); return { group, mesh, material, label, listeners, labelBaseY: record.kind === 'vehicle' ? .8 : .2, kind: record.kind, targetKey: null, styleKey: null, moving: null };
  }
  _focusedLabel(el) { const active = el.getRootNode().activeElement || el.ownerDocument.activeElement; return active && (active === el || el.contains(active)); }
  _focusOutside(el) {
    const requested = typeof this.returnFocus === 'function' ? this.returnFocus() : this.returnFocus;
    const target = requested?.isConnected && !requested.hidden ? requested : el.parentElement;
    if (target?.isConnected && target !== el && !target.hidden) {
      if (!target.hasAttribute('tabindex') && !['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(target.tagName)) target.setAttribute('tabindex', '-1');
      target.focus?.({ preventScroll: true });
    } else el.blur?.();
  }
  _remove(part) {
    if (part.label && this._focusedLabel(part.label.element)) this._focusOutside(part.label.element);
    for (const remove of part.listeners.splice(0)) remove();
    part.label?.element.remove(); part.group.removeFromParent(); part.material.dispose();
  }
  _arrangeLabels() {
    if (!this.onSelect) return false;
    const stackKey = JSON.stringify([...this.parts].filter(([, part]) => part.label).map(([id, part]) => [id, part.floorId, part.targetKey, part.labelBaseY]).sort((a, b) => a[0].localeCompare(b[0])));
    if (this._labelStackKey === stackKey) return false;
    this._labelStackKey = stackKey;
    const clusters = new Map();
    for (const [id, part] of this.parts) if (part.label) {
      const key = `${part.floorId}|${part.targetKey}`;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push({ id, part });
    }
    let changed = false;
    for (const cluster of clusters.values()) {
      cluster.sort((a, b) => a.id.localeCompare(b.id));
      const baseY = Math.max(...cluster.map(({ part }) => part.labelBaseY));
      cluster.forEach(({ part }, index) => {
        const margin = `${-48 * index}px`;
        if (part.label.element.style.marginTop !== margin) { part.label.element.style.marginTop = margin; changed = true; }
        if (part.label.position.y !== baseY) { part.label.position.y = baseY; changed = true; }
      });
    }
    return changed;
  }
  /** After CSS2DRenderer.render: separate projected controls with CSS offsets only.
   * No frame invalidation/timers; the real glyph/observation positions remain untouched.
   * screenLabelOverlaps reports the IDs that cannot fit in a densely occupied viewport.
   */
  arrangeScreenLabels(bounds, controls = []) {
    if (this.disposed || !this.group.visible || !this.onSelect || !bounds) return false;
    const left = bounds.left, top = bounds.top, right = finite(bounds.right) ? bounds.right : left + bounds.width,
      bottom = finite(bounds.bottom) ? bounds.bottom : top + bounds.height;
    if (![left, top, right, bottom].every(finite) || right <= left || bottom <= top) return false;
    const gap = 4, occupied = [], pending = [], pixels = (value) => Number.parseFloat(value) || 0;
    for (const rect of controls) if (rect && [rect.left, rect.top, rect.width, rect.height].every(finite)
      && rect.width > 0 && rect.height > 0 && rect.left < right && rect.left + rect.width > left
      && rect.top < bottom && rect.top + rect.height > top) occupied.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    const fixedControls = occupied.length > 0;
    let changed = false; this.screenLabelOverlaps = [];
    const margin = (el, name, value) => {
      const next = `${Math.round(value * 1000) / 1000}px`;
      if (el.style[name] !== next) { el.style[name] = next; changed = true; }
    };
    for (const [id, part] of this.parts) {
      const el = part.label?.element;
      if (!el || el.hidden || el.style.display === 'none' || !part.group.visible || !part.label.visible || !el.isConnected) continue;
      const cap = `${Math.max(44, Math.min(200, right - left))}px`;
      if (el.style.maxWidth !== cap) { el.style.maxWidth = cap; changed = true; }
      const rect = el.getBoundingClientRect(), width = rect.width, height = rect.height;
      if (![rect.left, rect.top, width, height].every(finite) || width <= 0 || height <= 0) continue;
      const base = { left: rect.left - pixels(el.style.marginLeft), top: rect.top - pixels(el.style.marginTop), width, height };
      if (base.left + width <= left || base.left >= right || base.top + height <= top || base.top >= bottom) {
        margin(el, 'marginLeft', 0); margin(el, 'marginTop', 0); continue;
      }
      pending.push({ id, el, base });
    }
    pending.sort((a, b) => a.id.localeCompare(b.id));
    const intersectsX = (a, b) => a.left < b.left + b.width + gap && a.left + a.width + gap > b.left;
    const intersects = (a, b) => intersectsX(a, b) && a.top < b.top + b.height + gap && a.top + a.height + gap > b.top;
    for (const { id, el, base } of pending) {
      const x = Math.max(left, Math.min(right - base.width, base.left)), minTop = top, maxTop = bottom - base.height;
      const desired = Math.max(minTop, Math.min(maxTop, base.top)), rect = { ...base, left: x }, obstacles = occupied.filter((o) => intersectsX(rect, o));
      const candidates = [desired, minTop, maxTop];
      for (const obstacle of obstacles) candidates.push(obstacle.top - base.height - gap, obstacle.top + obstacle.height + gap);
      const choices = [...new Set(candidates)].filter((y) => finite(y) && y >= minTop && y <= maxTop)
        .sort((a, b) => Math.abs(a - base.top) - Math.abs(b - base.top) || a - b).slice(0, 128);
      const y = choices.find((at) => !obstacles.some((o) => intersects({ ...rect, top: at }, o)));
      let placed = { ...rect, top: y ?? desired }, fitted = y !== undefined;
      // A short pane may have room beside a device but none above or below it.
      // Keep the ordinary layout unchanged when no fixed controls were supplied.
      if (!fitted && fixedControls) {
        const xs = [x, left, right - base.width];
        for (const obstacle of occupied) xs.push(obstacle.left - base.width - gap, obstacle.left + obstacle.width + gap);
        const alternatives = [...new Set(xs)].filter((at) => finite(at) && at >= left && at + base.width <= right)
          .sort((a, b) => Math.abs(a - base.left) - Math.abs(b - base.left) || a - b).slice(0, 128);
        for (const at of alternatives) {
          const nearby = occupied.filter((o) => intersectsX({ ...base, left: at }, o)), ys = [desired, minTop, maxTop];
          for (const obstacle of nearby) ys.push(obstacle.top - base.height - gap, obstacle.top + obstacle.height + gap);
          const free = [...new Set(ys)].filter((v) => finite(v) && v >= minTop && v <= maxTop)
            .sort((a, b) => Math.abs(a - base.top) - Math.abs(b - base.top) || a - b).slice(0, 128)
            .find((v) => !nearby.some((o) => intersects({ ...base, left: at, top: v }, o)));
          if (free !== undefined) { placed = { ...base, left: at, top: free }; fitted = true; break; }
        }
      }
      // A viewport can hold only so many 44px buttons. Preserve access/evidence rather
      // than inventing a world position or silently removing an actor when it is full.
      if (!fitted || base.width > right - left || base.height > bottom - top) this.screenLabelOverlaps.push(id);
      margin(el, 'marginLeft', placed.left - base.left); margin(el, 'marginTop', placed.top - base.top);
      occupied.push(placed);
    }
    return changed;
  }
  setData({ records = [], now = clockNow(), reducedMotion = false, selectable = true } = {}) {
    if (this.disposed) return false;
    this.selectable = selectable !== false;
    let changed = false; const ids = new Set(), counts = new Map();
    for (const record of records) counts.set(record?.id, (counts.get(record?.id) || 0) + 1);
    for (const record of records) {
      const p = record?.location;
      if (!text(record?.id) || counts.get(record.id) !== 1 || !Object.hasOwn(colors, record.kind) || record.shown !== true || !p || !text(p.floorId) || ![p.x, p.y, p.z, p.elevation].every(finite)
        || Math.abs(p.x) > TRACKING_LIMITS.coordinate || Math.abs(p.y) > TRACKING_LIMITS.coordinate || Math.abs(p.z) > TRACKING_LIMITS.height) continue;
      ids.add(record.id); let part = this.parts.get(record.id);
      if (part && part.kind !== record.kind) { this._remove(part); this.parts.delete(record.id); part = null; changed = true; }
      const created = !part;
      if (!part) { part = this._create(record); this.parts.set(record.id, part); changed = true; }
      const target = new THREE.Vector3(p.x, p.elevation + p.z, -p.y), targetKey = JSON.stringify(target.toArray());
      const canInterpolate = record.kind === 'vacuum' && record.measured === true && record.active === true && part.measured === true && part.active === true
        && part.entity === record.entity && !created && part.floorId === p.floorId && !reducedMotion && finite(record.transitionMs) && record.transitionMs > 0;
      if (part.targetKey !== targetKey) {
        const ms = canInterpolate ? Math.min(TRACKING_LIMITS.interpolation, record.transitionMs) : 0;
        part.moving = ms > 0 ? { from: part.group.position.clone(), target, start: finite(now) ? now : clockNow(), duration: ms } : null;
        if (!part.moving) part.group.position.copy(target);
        part.targetKey = targetKey; changed = true;
      }
      if (!canInterpolate && part.moving) { if (!part.group.position.equals(part.moving.target)) changed = true; part.group.position.copy(part.moving.target); part.moving = null; }
      const heading = finite(record.heading) ? record.heading : 0, size = finite(record.size) && record.size >= .1 && record.size <= 5 ? record.size : 1;
      const paint = color(record.color) ? record.color : colors[record.kind], label = typeof record.label === 'string' ? record.label : record.id;
      const styleKey = JSON.stringify([heading, size, paint, label, record.icon]);
      if (part.styleKey !== styleKey) {
        part.group.rotation.y = -heading * Math.PI / 180; part.mesh.scale.setScalar(size); part.material.color.set(paint);
        if (part.label) {
          part.label.element.querySelector('span').textContent = label; part.label.element.querySelector('ha-icon').setAttribute('icon', record.icon || icons[record.kind]);
          if (this.onSelect) { part.label.element.setAttribute('aria-label', `Open options for ${label}`); part.label.element.title = label; }
        }
        part.styleKey = styleKey; changed = true;
      }
      part.group.userData.entity = record.entity; part.group.userData.floorId = p.floorId; part.floorId = p.floorId;
      part.entity = record.entity; part.measured = record.measured === true; part.active = record.active === true;
      if (part.label) {
        const el = part.label.element;
        if (this.onSelect && el.disabled === this.selectable) {
          if (!this.selectable && this._focusedLabel(el)) this._focusOutside(el);
          el.disabled = !this.selectable; changed = true;
        }
        el.hidden = !this.group.visible;
      }
    }
    for (const [id, part] of this.parts) if (!ids.has(id)) { this._remove(part); this.parts.delete(id); changed = true; }
    if (this._arrangeLabels()) changed = true;
    if (changed && this.group.visible) this.onInvalidate?.(); return changed;
  }
  update(now = clockNow(), { reducedMotion = false } = {}) {
    if (this.disposed || !this.group.visible) return false;
    let moving = false, changed = false;
    for (const part of this.parts.values()) if (part.moving) {
      const t = reducedMotion ? 1 : Math.max(0, Math.min(1, ((finite(now) ? now : part.moving.start) - part.moving.start) / part.moving.duration));
      const point = part.moving.from.clone().lerp(part.moving.target, t);
      if (!part.group.position.equals(point)) { part.group.position.copy(point); changed = true; }
      if (t >= 1) part.moving = null; else moving = true;
    }
    return moving || changed;
  }
  setVisible(visible) {
    const next = visible !== false;
    if (this.disposed || this.group.visible === next) return false;
    this.group.visible = next;
    for (const part of this.parts.values()) if (part.label) {
      if (!next && this._focusedLabel(part.label.element)) this._focusOutside(part.label.element);
      part.label.element.hidden = !next;
    }
    if (this.parts.size) { this.onInvalidate?.(); return true; } return false;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const part of this.parts.values()) this._remove(part); this.parts.clear();
    for (const geometry of this.geometries.values()) geometry.dispose(); this.geometries.clear(); this.group.removeFromParent();
    this.onSelect = this.onInvalidate = this.returnFocus = null;
  }
}
