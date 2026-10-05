// Explicit, approximate horizontal camera coverage. No camera model/lens is inferred.
// Plan metres: x east, y north; headings are degrees clockwise from north.
import * as THREE from 'three';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const at = (value, key) => value instanceof Map ? value.get(key) : plain(value) && Object.hasOwn(value, key) ? value[key] : undefined;
const bearing = (value) => ((value % 360) + 360) % 360;
const issue = (code, message) => ({ code, message });
const FLOOR_LIFT = .035;
export const COVERAGE_LIMITS = Object.freeze({ minFov: 1, maxFov: 175, minRange: .1, maxRange: 100, maxSegments: 64, maxCoordinate: 1000000, maxHeight: 1000 });

/**
 * Settings: {enabled, heading, fov, range, color?, opacity?, segments?, show_rays?}.
 * Heading/FOV/range must be supplied when enabled. A root-provided heading is already
 * in plan space; callers explicitly transform authored model headings before supplying it.
 */
export function normaliseCoverage(value = {}, { heading } = {}) {
  const diagnostics = [];
  const config = plain(value) ? value : {};
  if (!plain(value)) diagnostics.push(issue('settings', 'Choose camera coverage settings.'));
  const enabled = config.enabled === true;
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') diagnostics.push(issue('enabled', 'Coverage must be enabled or disabled.'));
  const values = { heading: config.heading === undefined ? heading : config.heading, fov: config.fov, range: config.range };
  for (const field of ['heading', 'fov', 'range']) {
    if ((values[field] === undefined || values[field] === null) && !enabled) continue;
    if (!finite(values[field])) diagnostics.push(issue(field, `Choose a finite ${field === 'heading' ? 'heading in degrees' : field === 'fov' ? 'horizontal field of view in degrees' : 'range in metres'}.`));
  }
  if (finite(values.fov) && (values.fov < COVERAGE_LIMITS.minFov || values.fov > COVERAGE_LIMITS.maxFov)) diagnostics.push(issue('fov', `Horizontal field of view must be ${COVERAGE_LIMITS.minFov}–${COVERAGE_LIMITS.maxFov} degrees.`));
  if (finite(values.range) && (values.range < COVERAGE_LIMITS.minRange || values.range > COVERAGE_LIMITS.maxRange)) diagnostics.push(issue('range', `Coverage range must be ${COVERAGE_LIMITS.minRange}–${COVERAGE_LIMITS.maxRange} metres.`));
  if (config.unit !== undefined && config.unit !== 'm') diagnostics.push(issue('unit', 'Coverage range uses metres.'));
  const color = config.color === undefined ? '#03a9f4' : config.color;
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) diagnostics.push(issue('color', 'Choose a six-digit hexadecimal coverage colour.'));
  const opacity = config.opacity === undefined ? .14 : config.opacity;
  if (!finite(opacity) || opacity < 0 || opacity > 1) diagnostics.push(issue('opacity', 'Coverage opacity must be between 0 and 1.'));
  const segments = config.segments === undefined ? 24 : config.segments;
  if (!Number.isInteger(segments) || segments < 2 || segments > COVERAGE_LIMITS.maxSegments) diagnostics.push(issue('segments', `Coverage curve needs 2–${COVERAGE_LIMITS.maxSegments} segments.`));
  const rays = config.show_rays === undefined ? true : config.show_rays;
  if (typeof rays !== 'boolean') diagnostics.push(issue('show_rays', 'Boundary rays must be enabled or disabled.'));
  return { enabled, valid: diagnostics.length === 0, approximate: true, diagnostics,
    heading: finite(values.heading) ? bearing(values.heading) : null,
    fov: finite(values.fov) ? values.fov : null, range: finite(values.range) ? values.range : null,
    color: typeof color === 'string' ? color.toLowerCase() : null, opacity, segments, show_rays: rays };
}

function normalisePosition(position) {
  if (!plain(position)) return null;
  const floorId = position.floorId ?? position.floor_id;
  const z = position.z === undefined ? 0 : position.z;
  const elevation = position.elevation === undefined ? 0 : position.elevation;
  if (!finite(position.x) || !finite(position.y) || Math.abs(position.x) > COVERAGE_LIMITS.maxCoordinate || Math.abs(position.y) > COVERAGE_LIMITS.maxCoordinate
    || !finite(z) || Math.abs(z) > COVERAGE_LIMITS.maxHeight || !finite(elevation) || Math.abs(elevation) > COVERAGE_LIMITS.maxCoordinate
    || typeof floorId !== 'string' || !floorId.trim()) return null;
  return { x: position.x, y: position.y, z, elevation, floorId };
}

/** A configured horizontal floor sector, not a tested detection area or a vertical-FOV calculation. */
export function coverageSector(position, config) {
  const origin = normalisePosition(position);
  const settings = normaliseCoverage(config);
  if (!origin || config?.valid === false || !settings.enabled || !settings.valid) return null;
  const arc = [];
  for (let i = 0; i <= settings.segments; i++) {
    const angle = (settings.heading - settings.fov / 2 + settings.fov * i / settings.segments) * Math.PI / 180;
    arc.push([origin.x + Math.sin(angle) * settings.range, origin.y + Math.cos(angle) * settings.range]);
  }
  return { origin, polygon: [[origin.x, origin.y], ...arc], arc, heading: settings.heading, fov: settings.fov, range: settings.range, approximate: true };
}

function geometryFor(settings) {
  // One reusable shape facing north; pose changes translate/rotate its parent group.
  const sector = coverageSector({ x: 0, y: 0, floorId: 'shape' }, { ...settings, heading: 0 });
  const positions = sector.polygon.flatMap(([x, y]) => [x, 0, -y]);
  const indices = [];
  for (let i = 1; i < sector.polygon.length - 1; i++) indices.push(0, i, i + 1);
  const fill = new THREE.BufferGeometry(); fill.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); fill.setIndex(indices); fill.computeBoundingSphere();
  const segments = [];
  for (let i = 0; i < sector.polygon.length; i++) {
    const a = sector.polygon[i], b = sector.polygon[(i + 1) % sector.polygon.length];
    segments.push(a[0], 0, -a[1], b[0], 0, -b[1]);
  }
  const outline = new THREE.BufferGeometry(); outline.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3)); outline.computeBoundingSphere();
  return { fill, outline, edges: [sector.arc[0], sector.arc.at(-1)] };
}

const helper = (object) => { object.userData.helper = true; object.userData.approximate = true; object.raycast = () => {}; return object; };

/**
 * Reuses the current Three.js scene; no lights, renderer, timer, DOM listener or stream.
 * setData({anchors:[{id?,entity?,position,heading?,shown?,visible?}], bindings:Map|object,
 *          visibleFloors:'all'|floorIds}) returns whether its scene data changed.
 * A binding keyed by anchor ID overrides its entity binding. Entity fallback must resolve
 * one anchor, otherwise the user must choose a specific object/marker ID.
 */
export class CameraCoverageLayer {
  constructor(parent, { onInvalidate } = {}) {
    this.group = new THREE.Group(); this.group.name = 'taylors3d-camera-coverage'; this.group.userData.helper = true;
    parent.add(this.group); this.onInvalidate = onInvalidate;
    this.sectors = new Map(); this.diagnostics = []; this.disposed = false;
  }

  _create(id) {
    const group = new THREE.Group(); group.name = `taylors3d-coverage-${id}`; group.userData.approximate = true; group.userData.helper = true;
    const fillMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const lineMaterial = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
    const fill = helper(new THREE.Mesh(new THREE.BufferGeometry(), fillMaterial)); fill.renderOrder = 5;
    const outline = helper(new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial)); outline.renderOrder = 6;
    const raysGeometry = new THREE.BufferGeometry(); raysGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    const rays = helper(new THREE.LineSegments(raysGeometry, lineMaterial)); rays.renderOrder = 6;
    group.add(fill, outline, rays); this.group.add(group);
    return { group, fill, outline, rays, fillMaterial, lineMaterial, geometryKey: null, poseKey: null, styleKey: null };
  }

  _remove(part) {
    part.group.removeFromParent(); part.fill.geometry.dispose(); part.outline.geometry.dispose(); part.rays.geometry.dispose();
    part.fillMaterial.dispose(); part.lineMaterial.dispose();
  }

  setData({ anchors = [], bindings = {}, visibleFloors = 'all' } = {}) {
    if (this.disposed) return false;
    const list = Array.isArray(anchors) ? anchors.filter(plain) : [];
    const visible = visibleFloors === 'all' ? null : new Set(visibleFloors instanceof Set || Array.isArray(visibleFloors) ? visibleFloors : typeof visibleFloors === 'string' ? [visibleFloors] : []);
    const entities = new Map(), anchorIds = new Map();
    for (const anchor of list) {
      if (typeof anchor.entity === 'string') entities.set(anchor.entity, (entities.get(anchor.entity) || 0) + 1);
      const id = anchor.id ?? anchor.entity;
      if (typeof id === 'string') anchorIds.set(id, (anchorIds.get(id) || 0) + 1);
    }
    let changed = false; const ids = new Set(); this.diagnostics = [];
    for (const anchor of list) {
      const id = anchor.id ?? anchor.entity;
      if (typeof id !== 'string' || !id.trim()) continue;
      const specific = at(bindings, id), raw = specific === undefined ? at(bindings, anchor.entity) : specific;
      if (raw === undefined) continue;
      const settings = normaliseCoverage(raw, { heading: anchor.heading });
      if (!settings.enabled) continue;
      if (anchorIds.get(id) > 1) { this.diagnostics.push({ id, ...issue('duplicate_anchor', 'Camera coverage anchor IDs must be unique.') }); continue; }
      if ((specific === undefined || anchor.id === undefined) && entities.get(anchor.entity) > 1) { this.diagnostics.push({ id, ...issue('ambiguous_anchor', 'Choose a specific camera object or marker for this coverage binding.') }); continue; }
      if (!settings.valid) { this.diagnostics.push(...settings.diagnostics.map((diagnostic) => ({ id, ...diagnostic }))); continue; }
      const p = normalisePosition(anchor.position);
      if (!p) { this.diagnostics.push({ id, ...issue('position', 'Camera coverage needs a valid position in plan metres and a floor.') }); continue; }
      if (anchor.shown === false || anchor.visible === false || (visible && !visible.has(p.floorId)) || settings.opacity === 0) continue;
      ids.add(id); let part = this.sectors.get(id);
      if (!part) { part = this._create(id); this.sectors.set(id, part); changed = true; }
      const geometryKey = JSON.stringify([settings.fov, settings.range, settings.segments]);
      let geometryChanged = false;
      if (part.geometryKey !== geometryKey) {
        const geometry = geometryFor(settings);
        part.fill.geometry.dispose(); part.outline.geometry.dispose(); part.fill.geometry = geometry.fill; part.outline.geometry = geometry.outline;
        part.edges = geometry.edges; part.geometryKey = geometryKey; changed = true; geometryChanged = true;
      }
      const poseKey = JSON.stringify([p.x, p.y, p.z, p.elevation, settings.heading]);
      if (part.poseKey !== poseKey || geometryChanged) {
        part.group.position.set(p.x, p.elevation + FLOOR_LIFT, -p.y); part.group.rotation.y = -settings.heading * Math.PI / 180;
        const positions = part.rays.geometry.attributes.position, height = p.z - FLOOR_LIFT;
        positions.setXYZ(0, 0, height, 0); positions.setXYZ(1, part.edges[0][0], 0, -part.edges[0][1]);
        positions.setXYZ(2, 0, height, 0); positions.setXYZ(3, part.edges[1][0], 0, -part.edges[1][1]);
        positions.needsUpdate = true; part.rays.geometry.computeBoundingSphere(); part.poseKey = poseKey; changed = true;
      }
      const styleKey = JSON.stringify([settings.color, settings.opacity, settings.show_rays]);
      if (part.styleKey !== styleKey) {
        part.fillMaterial.color.set(settings.color); part.fillMaterial.opacity = settings.opacity;
        part.lineMaterial.color.set(settings.color); part.lineMaterial.opacity = Math.min(1, settings.opacity * 2 + .15);
        part.rays.visible = settings.show_rays; part.styleKey = styleKey; changed = true;
      }
      part.group.userData.entity = anchor.entity || null; part.group.userData.floorId = p.floorId;
    }
    for (const [id, part] of this.sectors) if (!ids.has(id)) { this._remove(part); this.sectors.delete(id); changed = true; }
    if (changed && this.group.visible) this.onInvalidate?.();
    return changed;
  }

  setVisible(visible) {
    const next = visible !== false;
    if (this.disposed || this.group.visible === next) return false;
    this.group.visible = next;
    if (this.sectors.size) { this.onInvalidate?.(); return true; }
    return false;
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const part of this.sectors.values()) this._remove(part);
    this.sectors.clear(); this.group.removeFromParent(); this.diagnostics = [];
  }
}
