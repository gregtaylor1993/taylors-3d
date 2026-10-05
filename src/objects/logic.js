// Pure logic for model objects: binding, chains, colour, budget, sun. No Three.js here.
import { readLightAppearance } from '../light-state.js';
import { entityMetadata } from '../entity-metadata.js';
const isOn = (s) => !!s && s.state === 'on';
const bad = (s) => !s || s.state === 'unavailable' || s.state === 'unknown'
  || s.attributes?.restored === true || (s.attributes && Object.hasOwn(s.attributes, 'restored') && typeof s.attributes.restored !== 'boolean');

const fullHass = (hass) => hass && typeof hass === 'object' && !Array.isArray(hass);
// Keep the exact reference for repair, separate from the current effective binding.
// Unavailable entities remain selected; metadata exclusion and absent state do not bind.
function bindingEvidence(entity, hass) {
  const requestedEntity = typeof entity === 'string' && entity ? entity : null;
  if (!requestedEntity) return { entity: null, requestedEntity, missing: false, filtered: false, filterReason: '' };
  const metadata = entityMetadata(hass, requestedEntity);
  const missing = !metadata.hasState;
  const filtered = !!(metadata.disabled || metadata.hidden || metadata.category);
  const filterReason = missing ? 'missing' : metadata.disabled ? 'disabled' : metadata.hidden ? 'hidden' : metadata.category || '';
  return { entity: !missing && !filtered ? requestedEntity : null, requestedEntity, missing, filtered, filterReason };
}

/** Optional full current hass enables shared eligibility and exact requestedEntity diagnostics.
 * Without it, the existing state-only return shape remains unchanged. No saved data is repaired.
 */
export function bindObjects(objects, layoutObjects = {}, states = {}, hass) {
  const out = new Map();
  for (const o of objects) {
    const saved = layoutObjects[o.id] || {};
    const hidden = !!saved.hidden;
    if (saved.entity !== undefined) {
      const entity = saved.entity || null;
      if (fullHass(hass)) {
        out.set(o.id, { ...bindingEvidence(entity, hass), auto: false, hidden });
        continue;
      }
      out.set(o.id, { entity: entity && states[entity] ? entity : null, auto: false, missing: !!entity && !states[entity], hidden });
      continue;
    }
    const s = (o.suggest || {}).entity;
    if (fullHass(hass)) {
      out.set(o.id, { ...bindingEvidence(s, hass), auto: true, hidden });
      continue;
    }
    out.set(o.id, { entity: s && states[s] ? s : null, auto: true, missing: !!s && !states[s], hidden });
  }
  return out;
}

// State-only callers retain existing controllers only. With full hass, excluded/missing saved
// IDs remain warning records (entity:null), so they cannot enter the chain or be replaced by name.
export function effectiveGroups(groups = {}, states = {}, hass) {
  const out = {};
  for (const [name, g] of Object.entries(groups || {})) {
    const e = g && typeof g.entity === 'string' ? g.entity : null;
    const value = e && (fullHass(hass) ? { ...g, ...bindingEvidence(e, hass) } : states[e] ? { ...g, entity: e } : null);
    if (value) Object.defineProperty(out, name, { value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/**
 * Chain object state through group controller. Callers gate on `lit`; `source` may be an off light.
 */
export function chainState(obj, binding, groups = {}, states = {}) {
  const ctrl = obj.group && groups[obj.group] && groups[obj.group].entity;
  const entities = [binding && binding.entity, ctrl].filter(Boolean);
  if (!entities.length) return { lit: false, unavailable: false, source: null, entities, reason: null };
  const sts = entities.map((e) => states[e]);
  const unavailable = sts.some(bad);
  const lit = !unavailable && sts.every(isOn);
  let reason = null;
  if (!lit && !unavailable && ctrl && !isOn(states[ctrl])) reason = `${ctrl} is off`;
  else if (!lit && !unavailable && binding && binding.entity && !isOn(states[binding.entity])) reason = null;
  const source = sts.find((s, i) => s && entities[i].startsWith('light.')) || null;
  return { lit, unavailable, source, entities, reason };
}

// A switch controls a fixed fixture; its attributes do not constitute measured light colour.
function fixtureState(s) {
  if (!s || s.entity_id === undefined || typeof s.entity_id !== 'string' || s.entity_id.startsWith('light.')) return s;
  const attributes = {};
  if (s.attributes && Object.hasOwn(s.attributes, 'restored')) attributes.restored = s.attributes.restored;
  return { state: s.state, attributes };
}
export const lightColor = (s) => readLightAppearance(fixtureState(s || { state: 'on', attributes: {} })).color;
export const lightLevel = (s) => readLightAppearance(fixtureState(s)).level;

export function lightBudget(fixtures, { points = 8, spots = 4, shadows = 4 } = {}) {
  const cand = [];
  const groups = new Map();
  for (const f of fixtures) {
    const output = f.output === undefined ? 1 : f.output;
    if (!f.lit || !f.visible || !Number.isFinite(f.max) || f.max <= 0 || !Number.isFinite(output) || output <= 0 || output > 1) continue;
    if (f.group) { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); } else cand.push({ f, factor: 1 });
  }
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    cand.push({ f: sorted[Math.floor((sorted.length - 1) / 2)], factor: 1.5, grouped: true });
  }
  // A common scale factor preserves ranking without overflowing extreme authored maxima.
  const score = (c) => c.f.max * ((c.f.output ?? 1) * (c.factor / 1.5));
  cand.sort((a, b) => score(b) - score(a) || (a.f.id < b.f.id ? -1 : 1));
  const real = new Map(), shadowSet = new Set();
  let p = 0, s = 0;
  for (const c of cand) {
    const kind = c.f.beam === 'spot' ? 'spot' : 'point';
    if (kind === 'spot' ? s >= spots : p >= points) continue;
    if (kind === 'spot') s++; else p++;
    real.set(c.f.id, { kind, factor: c.factor });
    if (!c.grouped && kind === 'point' && c.f.castShadow !== false && shadowSet.size < shadows) shadowSet.add(c.f.id);
  }
  return { real, shadows: shadowSet };
}

export function nightFactor(elevation) {
  if (!Number.isFinite(elevation)) return 0;
  const t = Math.max(0, Math.min(1, (6 - elevation) / 12));
  return t * t * (3 - 2 * t);
}

// Bearing clockwise from model north = HA azimuth + fp.north; plan (x east, y north) → world (x, ·, −y);
// then the model alignment rotation (degrees, counter-clockwise seen from above).
export function sunVector(azimuth, elevation, north = 0, alignRotation = 0) {
  const d = Math.PI / 180;
  const b = (azimuth + north) * d, e = elevation * d;
  let px = Math.sin(b) * Math.cos(e), py = Math.cos(b) * Math.cos(e);
  const r = alignRotation * d;
  [px, py] = [px * Math.cos(r) - py * Math.sin(r), px * Math.sin(r) + py * Math.cos(r)];
  return [px, Math.sin(e), -py];
}

// Sun strength factor 0..1: smoothstep(-2, +4 degrees) so the sun is off at / under the horizon.
// A missing elevation is day (1), like nightFactor (0).
export function sunStrength(elevation) {
  if (!Number.isFinite(elevation)) return 1;
  const t = Math.max(0, Math.min(1, (elevation + 2) / 6));
  return t * t * (3 - 2 * t);
}

// Never light from underneath: y >= minY, renormalised.
export function clampSunDir(v, minY = 0.05) {
  if (!v) return v;
  let [x, y, z] = v;
  if (y >= minY) return [x, y, z];
  const h = Math.hypot(x, z);
  if (h < 1e-9) return [0, 1, 0];
  const k = Math.sqrt(1 - minY * minY) / h;
  return [x * k, minY, z * k];
}

export function screenNearest(points, x, y, radius) {
  let best = null, bd = radius;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (best === null ? d <= radius : d < bd) { bd = d; best = p.id; }
  }
  return best;
}

// Ids of the points within radius px of (x, y), nearest first (ties keep their order).
export function screenByDistance(points, x, y, radius) {
  return points.map((p, i) => ({ id: p.id, i, d: Math.hypot(p.x - x, p.y - y) }))
    .filter((p) => p.d <= radius)
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((p) => p.id);
}

// ---------- magnetic drag ----------
const vec = (v) => (Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v);
export const SNAP_OFFSET = 0.05; // markers float 5 cm off the surface they stick to

// A model surface hit ({ point, normal } in card world) -> plan pin 5 cm off the surface along its normal.
export function snapPin(hit, floorElevation, floorId) {
  const p = vec(hit.point), n = vec(hit.normal);
  const wx = p.x + n.x * SNAP_OFFSET, wy = p.y + n.y * SNAP_OFFSET, wz = p.z + n.z * SNAP_OFFSET;
  return { x: wx, y: -wz, z: wy - (floorElevation || 0), floor_id: floorId };
}

// Offset (world metres, mm) of a plan position { x, y, z } on a floor at floorElevation from an anchor.
export function attachOffset(anchor, pos, floorElevation) {
  const a = vec(anchor), r = (v) => Math.round(v * 1000) / 1000 || 0;
  return [r(pos.x - a.x), r((floorElevation || 0) + pos.z - a.y), r(-pos.y - a.z)];
}

// Plan position { x, y, z } of an attached marker: anchor + offset, z above floorElevation.
export function attachedPosition(anchor, offset, floorElevation) {
  if (!anchor || !Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite)) return null;
  const a = vec(anchor);
  return { x: a.x + offset[0], y: -(a.z + offset[2]), z: a.y + offset[1] - (floorElevation || 0) };
}

// The floor a model hit at world height y stands on: the highest floor with elevation <= y + tol, else null.
export function floorAtHeight(floors, y, tol = 0.05) {
  let best = null;
  for (const f of floors || []) if (f.elevation <= y + tol && (!best || f.elevation > best.elevation)) best = f;
  return best ? best.id : null;
}
