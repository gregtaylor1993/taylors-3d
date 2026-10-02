// Pure logic for model objects: binding, chains, colour, budget, sun. No Three.js here.
const isOn = (s) => !!s && s.state === 'on';
const bad = (s) => !s || s.state === 'unavailable' || s.state === 'unknown';

export function bindObjects(objects, layoutObjects = {}, states = {}) {
  const out = new Map();
  for (const o of objects) {
    const saved = layoutObjects[o.id] || {};
    const hidden = !!saved.hidden;
    if (saved.entity !== undefined) {
      const entity = saved.entity || null;
      out.set(o.id, { entity: entity && states[entity] ? entity : null, auto: false, missing: !!entity && !states[entity], hidden });
      continue;
    }
    const s = (o.suggest || {}).entity;
    out.set(o.id, { entity: s && states[s] ? s : null, auto: true, missing: !!s && !states[s], hidden });
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

function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}

function kelvinToRgb(k) {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))));
}

export function lightColor(s) {
  const a = (s && s.attributes) || {};
  if (Array.isArray(a.rgb_color)) return a.rgb_color.slice(0, 3);
  if (Array.isArray(a.hs_color)) return hsvToRgb(a.hs_color[0], a.hs_color[1] / 100, 1);
  if (a.color_temp_kelvin) return kelvinToRgb(a.color_temp_kelvin);
  return hsvToRgb(30, 0.5, 1); // warm white
}

export function lightLevel(s) {
  if (!isOn(s)) return 0;
  const b = s.attributes && s.attributes.brightness;
  return typeof b === 'number' ? Math.max(0, Math.min(1, b / 255)) : 1;
}

export function lightBudget(fixtures, { points = 8, spots = 4, shadows = 4 } = {}) {
  const cand = [];
  const groups = new Map();
  for (const f of fixtures) {
    if (!f.lit || !f.visible) continue;
    if (f.group) { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); } else cand.push({ f, factor: 1 });
  }
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    cand.push({ f: sorted[Math.floor((sorted.length - 1) / 2)], factor: 1.5, grouped: true });
  }
  cand.sort((a, b) => (b.f.max || 0) - (a.f.max || 0) || (a.f.id < b.f.id ? -1 : 1));
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
