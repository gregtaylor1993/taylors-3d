// Current HA weather and decorative outdoor effects. No services, forecasts,
// timers, renderer, lights, inferred building footprint or texture ownership.
import * as THREE from 'three';
import { entityMetadata } from './entity-metadata.js';
import { pointInPolygon, signedArea } from './placement.js';

export const WEATHER_LIMITS = Object.freeze({
  areas: 128, vertices: 256, coordinate: 100000, elevation: 10000,
  low: Object.freeze({ rain: 96, snow: 48, clouds: 6 }),
  medium: Object.freeze({ rain: 256, snow: 128, clouds: 12 }),
  height: 8, spawnAttempts: 64,
});
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const diagnostic = (code, message, extra = {}) => ({ code, message, ...extra });
const effectsOff = () => ({ rain: 0, snow: 0, clouds: 0 });
const qualityValues = ['off', 'static', 'low', 'medium'];
const effectValues = ['rain', 'clouds', 'snow'];
const conditions = {
  'clear-night': ['Clear night', 0, 0, 0], sunny: ['Sunny', 0, 0, 0],
  partlycloudy: ['Partly cloudy', 0, 0, 0.4], cloudy: ['Cloudy', 0, 0, 0.9],
  rainy: ['Rainy', 1, 0, 0.65], pouring: ['Heavy rain', 1, 0, 0.9],
  snowy: ['Snowy', 0, 1, 0.7], 'snowy-rainy': ['Rain and snow', 0.5, 0.5, 0.8],
  'lightning-rainy': ['Thunderstorm with rain', 1, 0, 0.9],
  lightning: ['Thunderstorm', 0, 0, 0.85], hail: ['Hail', 0, 0, 0.8],
  fog: ['Fog', 0, 0, 0], windy: ['Windy', 0, 0, 0],
  'windy-variant': ['Windy and cloudy', 0, 0, 0.8], exceptional: ['Exceptional weather', 0, 0, 0],
};

function currentSource(hass, entity, domain) {
  if (typeof entity !== 'string' || !new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(entity) || entity.length > 255) {
    return { status: 'invalid', diagnostics: [diagnostic('entity', `Select an actual ${domain} entity.`)] };
  }
  const metadata = entityMetadata(hass, entity);
  const fail = (status, code, message) => ({ status, metadata, diagnostics: [diagnostic(code, message, { entity })] });
  if (metadata.disabled) return fail('disabled', 'disabled', 'This entity or its device is disabled. Choose an enabled source.');
  if (metadata.hidden || metadata.category) return fail('hidden', 'hidden', 'This source is hidden or diagnostic. Choose a visible source.');
  if (!metadata.hasState) return fail('missing', 'missing', 'This saved source has no current Home Assistant state.');
  const state = metadata.state;
  if (state.state === 'unknown' || state.state === 'unavailable') return fail('unavailable', 'unavailable', 'The source is unavailable; its old attributes are not current evidence.');
  if (record(state.attributes).restored === true) return fail('unavailable', 'restored', 'This is a restored snapshot. Wait for a current reading.');
  if (record(state.attributes).restored !== undefined && typeof record(state.attributes).restored !== 'boolean') return fail('invalid', 'restored', 'The restored-state flag is malformed. Wait for a valid current reading.');
  if (typeof state.state !== 'string') return fail('invalid', 'state', 'The source state is malformed.');
  return { status: 'ready', metadata, diagnostics: [] };
}

/** Actual sun attributes only. A bad reading has null angles, never guessed zeroes. */
export function readSunState(hass, entity = 'sun.sun') {
  const source = currentSource(hass, entity, 'sun');
  const result = { status: source.status, entity, elevation: null, azimuth: null, diagnostics: source.diagnostics };
  if (source.status !== 'ready') return result;
  const state = source.metadata.state, attributes = record(state.attributes);
  if (!['above_horizon', 'below_horizon'].includes(state.state)) {
    return { ...result, status: 'invalid', diagnostics: [diagnostic('state', 'The sun source must report above_horizon or below_horizon.', { entity })] };
  }
  const { elevation, azimuth } = attributes;
  if (!finite(elevation) || elevation < -90 || elevation > 90 || !finite(azimuth) || azimuth < 0 || azimuth > 360) {
    return { ...result, status: 'invalid', diagnostics: [diagnostic('angles', 'Sun elevation and azimuth must be finite angles in degrees.', { entity })] };
  }
  return { ...result, elevation, azimuth: azimuth === 360 ? 0 : azimuth };
}

/** Home Assistant's explicit location; zero latitude/longitude are legitimate. */
export function readHaLocation(hass) {
  const config = record(record(hass).config), { latitude, longitude } = config;
  const result = { status: 'invalid', latitude: null, longitude: null, timeZone: null, diagnostics: [] };
  if (!finite(latitude) || latitude < -90 || latitude > 90 || !finite(longitude) || longitude < -180 || longitude > 180) {
    result.diagnostics.push(diagnostic('location', 'Set a valid latitude and longitude in Home Assistant before showing the actual moon.'));
    return result;
  }
  const timeZone = text(config.time_zone);
  if (timeZone) {
    try { new Intl.DateTimeFormat('en', { timeZone }); result.timeZone = timeZone; }
    catch { result.diagnostics.push(diagnostic('time_zone', 'Home Assistant’s time zone is invalid. No substitute time zone was chosen.')); }
  }
  return { ...result, status: 'ready', latitude, longitude };
}

/** Decorative intensity is a user setting, not a claimed rain rate. Forecasts are ignored. */
export function readWeather(hass, config = {}) {
  const validConfig = config !== null && typeof config === 'object' && !Array.isArray(config);
  config = record(config);
  const quality = config.quality === undefined ? 'low' : config.quality;
  const intensity = config.intensity === undefined ? 0.6 : config.intensity;
  const selectedEffects = config.effects === undefined ? effectValues : config.effects;
  const entity = typeof config.entity === 'string' ? config.entity : null;
  const result = { status: 'off', entity, condition: null, label: 'Weather effects off', quality, intensity, effects: effectsOff(), cloudCoverage: null, diagnostics: [] };
  const fail = (message) => ({ ...result, status: 'invalid', label: 'Weather setup needs attention', diagnostics: [diagnostic('config', message)] });
  if (!validConfig || config.enabled !== undefined && typeof config.enabled !== 'boolean') return fail('Weather enabled must be true or false.');
  if (config.enabled !== true) return result;
  if (!qualityValues.includes(quality) || !finite(intensity) || intensity < 0 || intensity > 1
    || !Array.isArray(selectedEffects) || selectedEffects.some((value) => !effectValues.includes(value))) {
    return fail('Choose Off, Static, Low or Medium quality, an intensity from 0 to 1, and rain/clouds/snow effects.');
  }
  if (quality === 'off') return result;
  const source = currentSource(hass, entity, 'weather');
  if (source.status !== 'ready') return { ...result, status: source.status, label: 'Weather data unavailable', diagnostics: source.diagnostics };
  const state = source.metadata.state, condition = state.state;
  if (!Object.prototype.hasOwnProperty.call(conditions, condition)) {
    return { ...result, status: 'invalid', label: 'Unsupported weather condition', diagnostics: [diagnostic('condition', 'The source does not report a recognized current weather condition.', { entity })] };
  }
  const [label, rain, snow, clouds] = conditions[condition];
  const coverage = record(state.attributes).cloud_coverage;
  const cloudCoverage = finite(coverage) && coverage >= 0 && coverage <= 100 ? coverage : null;
  const diagnostics = coverage === undefined || coverage === null || cloudCoverage !== null ? []
    : [diagnostic('cloud_coverage', 'Invalid cloud coverage was ignored; the current condition is still shown.', { entity })];
  const effects = { rain, snow, clouds: cloudCoverage === null ? clouds : cloudCoverage / 100 };
  for (const effect of effectValues) if (!selectedEffects.includes(effect)) effects[effect] = 0;
  return { ...result, status: 'ready', condition, label, effects, cloudCoverage, diagnostics };
}

const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (p, a, b) => Math.abs(cross(a, b, p)) <= 1e-8
  && p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8
  && p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8;
const within = (p, polygon) => pointInPolygon(p, polygon) || polygon.some((a, index) => onSegment(p, a, polygon[(index + 1) % polygon.length]));
function intersect(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0 || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

function footprint(value, outdoor) {
  const entry = record(value), id = text(entry.id), floorId = text(entry.floorId);
  if (!id || !floorId || id.length > 255 || floorId.length > 255 || !finite(entry.elevation) || Math.abs(entry.elevation) > WEATHER_LIMITS.elevation) return null;
  if (outdoor && entry.outdoor !== true) return null;
  if (!Array.isArray(entry.polygon) || entry.polygon.length < 3 || entry.polygon.length > WEATHER_LIMITS.vertices + 1) return null;
  let polygon = entry.polygon.map((point) => Array.isArray(point) && point.length === 2 && point.every((v) => finite(v) && Math.abs(v) <= WEATHER_LIMITS.coordinate) ? point.slice() : null);
  if (polygon.some((point) => !point)) return null;
  if (samePoint(polygon[0], polygon.at(-1))) polygon.pop();
  if (polygon.length < 3 || polygon.length > WEATHER_LIMITS.vertices || polygon.some((point, index) => samePoint(point, polygon[(index + 1) % polygon.length]))) return null;
  const area = signedArea(polygon);
  if (!finite(area) || Math.abs(area) < 0.0001) return null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = polygon[(i + 2) % polygon.length];
    if (Math.abs(cross(a, b, c)) < 1e-8 && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) <= 0) return null;
  }
  for (let i = 0; i < polygon.length; i++) for (let j = i + 1; j < polygon.length; j++) {
    if (j === i + 1 || i === 0 && j === polygon.length - 1) continue;
    if (intersect(polygon[i], polygon[(i + 1) % polygon.length], polygon[j], polygon[(j + 1) % polygon.length])) return null;
  }
  // Equivalent winding/start vertex must preserve particle positions and pulse time.
  if (area < 0) polygon.reverse();
  let start = 0;
  polygon.forEach((p, index) => { if (p[0] < polygon[start][0] || p[0] === polygon[start][0] && p[1] < polygon[start][1]) start = index; });
  polygon = [...polygon.slice(start), ...polygon.slice(0, start)];
  return { id, floorId, elevation: entry.elevation, polygon, area: Math.abs(area) };
}

/** All indoor outlines, including hidden floors, exclude precipitation columns.
 * Missing/malformed indoor data fails closed. Empty [] explicitly describes an outdoor-only scene.
 */
export function normaliseWeatherFootprints(outdoors, indoors, visibleFloors) {
  const diagnostics = [], result = { outdoors: [], indoors: [], diagnostics };
  if (!Array.isArray(outdoors) || !Array.isArray(indoors) || outdoors.length > WEATHER_LIMITS.areas || indoors.length > WEATHER_LIMITS.areas
    || visibleFloors !== undefined && (!Array.isArray(visibleFloors) || visibleFloors.some((id) => !text(id)))) {
    diagnostics.push(diagnostic('footprints', 'Supply explicit outdoor regions and all indoor outlines, within the region limit.'));
    return result;
  }
  for (const entry of indoors) {
    const region = footprint(entry, false);
    if (!region) diagnostics.push(diagnostic('indoor_footprint', 'Repair every indoor outline before drawing weather; indoor areas must remain excluded.', { id: text(entry?.id) }));
    else result.indoors.push(region);
  }
  if (diagnostics.length) return result;
  const ids = new Map();
  for (const entry of outdoors) {
    if (entry?.shown === false || visibleFloors !== undefined && !visibleFloors.includes(entry?.floorId)) continue;
    const region = footprint(entry, true);
    if (!region) diagnostics.push(diagnostic('outdoor_footprint', 'Choose a valid, explicitly outdoor polygon with a floor and elevation.', { id: text(entry?.id) }));
    else { ids.set(region.id, ids.has(region.id) ? null : region); }
  }
  for (const [id, region] of ids) {
    if (region) result.outdoors.push(region);
    else diagnostics.push(diagnostic('duplicate_region', 'Outdoor region IDs must be unique; the ambiguous region was skipped.', { id }));
  }
  result.outdoors.sort((a, b) => a.id.localeCompare(b.id));
  result.indoors.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

function randomSequence(seed) {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
function spawnSamples(regions, indoors, count, random) {
  const triangles = [];
  for (const region of regions) {
    const vertices = region.polygon.map(([x, y]) => new THREE.Vector2(x, y));
    for (const triangle of THREE.ShapeUtils.triangulateShape(vertices, [])) {
      const points = triangle.map((index) => region.polygon[index]);
      const area = Math.abs(signedArea(points));
      if (area > 0) triangles.push({ points, elevation: region.elevation, floorId: region.floorId, area });
    }
  }
  const total = triangles.reduce((sum, triangle) => sum + triangle.area, 0), samples = [];
  if (!total) return samples;
  for (let index = 0; index < count; index++) {
    for (let attempt = 0; attempt < WEATHER_LIMITS.spawnAttempts; attempt++) {
      let pick = random() * total;
      const triangle = triangles.find((value) => { pick -= value.area; return pick <= 0; }) || triangles.at(-1);
      const [a, b, c] = triangle.points, u = Math.sqrt(random()), v = random();
      const x = (1 - u) * a[0] + u * (1 - v) * b[0] + u * v * c[0];
      const y = (1 - u) * a[1] + u * (1 - v) * b[1] + u * v * c[1];
      if (indoors.some((region) => within([x, y], region.polygon))) continue;
      samples.push({ x, y, elevation: triangle.elevation, floorId: triangle.floorId, phase: random(), size: 0.6 + random() * 0.6 });
      break;
    }
  }
  return samples;
}

function visualWeather(weather) {
  const value = record(weather), intensity = value.intensity;
  if (value.status !== 'ready' || !qualityValues.includes(value.quality) || value.quality === 'off' || !finite(intensity) || intensity < 0 || intensity > 1) return null;
  const effects = {};
  for (const name of effectValues) {
    const effect = record(value.effects)[name];
    if (!finite(effect) || effect < 0 || effect > 1) return null;
    effects[name] = effect;
  }
  return { quality: value.quality, intensity, effects };
}

/** The root supplies connection/document/offscreen/edit/section visibility.
 * update() returns a render request; it never creates timers or invalidates shadow maps.
 */
export class WeatherLayer {
  constructor(scene, { onInvalidate = () => {} } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'taylors3d-weather';
    this.group.userData.helper = true;
    this.group.visible = false;
    scene.add(this.group);
    this.onInvalidate = onInvalidate;
    this.diagnostics = [];
    this.stats = { rebuilds: 0, rain: 0, snow: 0, clouds: 0 };
    this._visible = true;
    this._key = '';
    this._clock = null;
    this._samples = { rain: [], snow: [], clouds: [] };
  }

  setData({ weather, outdoors = [], indoors, visibleFloors, reducedMotion = false } = {}) {
    if (this._disposed) return false;
    this.weather = weather;
    this._reducedMotion = reducedMotion === true;
    const visual = visualWeather(weather);
    const footprints = visual ? normaliseWeatherFootprints(outdoors, indoors, visibleFloors) : { outdoors: [], indoors: [], diagnostics: [] };
    this.diagnostics = [...(Array.isArray(weather?.diagnostics) ? weather.diagnostics : []), ...footprints.diagnostics];
    if (visual && !footprints.outdoors.length && !footprints.diagnostics.length && Object.values(visual.effects).some((value) => value > 0) && visual.intensity > 0) {
      this.diagnostics.push(diagnostic('no_outdoors', 'Mark an outdoor region and provide its outline before showing weather.'));
    }
    const budget = WEATHER_LIMITS[visual?.quality === 'medium' ? 'medium' : 'low'];
    const counts = Object.fromEntries(effectValues.map((name) => [name, visual ? Math.round(budget[name] * visual.intensity * visual.effects[name]) : 0]));
    const active = footprints.outdoors.length && Object.values(counts).some((value) => value > 0);
    const key = active ? JSON.stringify([counts, footprints.outdoors, footprints.indoors]) : '';
    this._quality = visual?.quality || 'off';
    if (key === this._key) {
      if (this._spawnDiagnostic) this.diagnostics.push(this._spawnDiagnostic);
      return false;
    }
    const before = this.group.visible;
    this._key = key;
    this._spawnDiagnostic = null;
    this._clock = null;
    this._samples = { rain: [], snow: [], clouds: [] };
    if (active) {
      this._ensureResources();
      const random = randomSequence(JSON.stringify([footprints.outdoors, footprints.indoors]));
      for (const name of effectValues) {
        this._samples[name] = spawnSamples(footprints.outdoors, footprints.indoors, counts[name], random);
      }
      if (Object.values(this._samples).every((samples) => !samples.length)) {
        this._spawnDiagnostic = diagnostic('no_exposed_outdoors', 'No exposed outdoor points could be placed safely. Repair the indoor outlines or choose a larger exposed outdoor region.');
        this.diagnostics.push(this._spawnDiagnostic);
      }
    }
    for (const name of effectValues) this.stats[name] = this._samples[name].length;
    this.stats.rebuilds++;
    this._writeGeometry();
    this._writeClouds();
    this.group.visible = this._visible && Object.values(this._samples).some((samples) => samples.length);
    const changed = before || this.group.visible;
    if (changed) this.onInvalidate();
    return changed;
  }

  _ensureResources() {
    if (this.rain) return;
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WEATHER_LIMITS.medium.rain * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xb5d8ff, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }));
    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WEATHER_LIMITS.medium.snow * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.snow = new THREE.Points(snowGeometry, new THREE.PointsMaterial({ color: 0xf0f7ff, size: 0.075, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    this.clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 5), new THREE.MeshBasicMaterial({ color: 0xbbc4d4, transparent: true, opacity: 0.38, depthWrite: false, toneMapped: false }), WEATHER_LIMITS.medium.clouds * 4);
    this.clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._cloudTransform = new THREE.Object3D();
    for (const object of [this.rain, this.snow, this.clouds]) {
      object.userData.helper = true;
      object.frustumCulled = false;
      object.raycast = () => {};
      object.castShadow = false;
      object.receiveShadow = false;
      this.group.add(object);
    }
  }

  _writeGeometry() {
    if (!this.rain) return;
    const rain = this.rain.geometry.getAttribute('position'), snow = this.snow.geometry.getAttribute('position');
    this._samples.rain.forEach((sample, index) => {
      const height = sample.elevation + 0.15 + sample.phase * WEATHER_LIMITS.height;
      rain.setXYZ(index * 2, sample.x, height, -sample.y);
      rain.setXYZ(index * 2 + 1, sample.x, Math.max(sample.elevation + 0.1, height - 0.45), -sample.y);
    });
    this._samples.snow.forEach((sample, index) => snow.setXYZ(index, sample.x, sample.elevation + 0.15 + sample.phase * WEATHER_LIMITS.height, -sample.y));
    rain.needsUpdate = true; snow.needsUpdate = true;
    this.rain.geometry.setDrawRange(0, this._samples.rain.length * 2);
    this.snow.geometry.setDrawRange(0, this._samples.snow.length);
    this.rain.visible = this._samples.rain.length > 0;
    this.snow.visible = this._samples.snow.length > 0;
  }

  _writeClouds() {
    if (!this.clouds) return;
    const transform = this._cloudTransform;
    this._samples.clouds.forEach((sample, index) => {
      for (let puff = 0; puff < 4; puff++) {
        // Puffs stay above their explicit outdoor column; no horizontal wind drift.
        transform.position.set(sample.x, sample.elevation + WEATHER_LIMITS.height + 1 + puff * 0.35, -sample.y);
        transform.scale.set(sample.size * (1 - puff * 0.12), 0.28 + puff * 0.06, sample.size * 0.7);
        transform.updateMatrix();
        this.clouds.setMatrixAt(index * 4 + puff, transform.matrix);
      }
    });
    this.clouds.count = this._samples.clouds.length * 4;
    this.clouds.visible = this.clouds.count > 0;
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  update(now, { reducedMotion = this._reducedMotion } = {}) {
    if (this._disposed || !this.group.visible || reducedMotion || this._quality === 'static'
      || !this._samples.rain.length && !this._samples.snow.length || !finite(now)) {
      this._clock = null;
      return false;
    }
    const before = this._clock;
    this._clock = now;
    if (before === null || now <= before) return false;
    const seconds = Math.min(0.1, (now - before) / 1000);
    for (const name of ['rain', 'snow']) for (const sample of this._samples[name]) {
      const speed = name === 'rain' ? 5 : 0.6;
      sample.phase = ((sample.phase - speed * seconds / WEATHER_LIMITS.height) % 1 + 1) % 1;
    }
    this._writeGeometry();
    return true;
  }

  setVisible(visible) {
    if (this._disposed) return false;
    const next = visible === true;
    if (this._visible === next) return false;
    this._visible = next;
    this._clock = null;
    const shown = this._visible && Object.values(this._samples).some((samples) => samples.length);
    if (this.group.visible === shown) return false;
    this.group.visible = shown;
    this.onInvalidate();
    return true;
  }

  dispose() {
    if (this._disposed) return;
    const shown = this.group.visible;
    this._disposed = true;
    this._clock = null;
    this.group.removeFromParent();
    for (const object of this.group.children) { object.geometry.dispose(); object.material.dispose(); }
    this.group.clear();
    this._samples = { rain: [], snow: [], clouds: [] };
    if (shown) this.onInvalidate();
  }
}
