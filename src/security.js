// Explicit contact evidence and owned model outlines/hinge motion. No Home Assistant actions.
// Angles are configured visual offsets, not measured door angles. Pivot/axis are in the
// moving target's PARENT-local model frame; authored hierarchy/materials stay intact.
import * as THREE from 'three';
import { entityMetadata } from './entity-metadata.js';
import { readFreshness } from './tracked-source.js';
import { readTag } from './manifest.js';

const plain = (v) => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const vector = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);
const nameOf = (node) => node.userData?.name || node.name || '';
const issue = (code, message, id) => ({ code, message, ...(id ? { id } : {}) });
const contactClasses = new Set(['door', 'window', 'opening', 'garage_door']);
const claims = new WeakMap(); // Two SecurityLayers cannot write the same/nested model target.
const DEG = Math.PI / 180;
export const SECURITY_LIMITS = Object.freeze({ maxBindings: 256, maxMeshes: 256, maxTotalMeshes: 1024, maxVertices: 100000, maxDuration: 5000, maxDegrees: 360, maxCoordinate: 1000000 });

/** Saved binding: {id,entity,object_id,kind,open_states,closed_states,enabled?,
 * contact_source_confirmed?,freshness?,highlight?:{mode:'outline',open,closed?,unknown,opacity},
 * motion?:{target,pivot,axis,closed_degrees,open_degrees,duration_ms}}.
 * A relative target is an exact direct-child path ('leaf/mesh'); '.' means the tagged object.
 * No state defaults, untagged object-name search, hinge guesses or inferred angles.
 */
export function normaliseSecurityBinding(value) {
  const diagnostics = [], cfg = plain(value) ? value : {};
  const add = (code, message) => diagnostics.push(issue(code, message, cfg.id));
  if (!plain(value)) add('binding', 'Choose explicit security binding settings.');
  if (typeof cfg.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(cfg.id)) add('id', 'Choose a unique security binding ID.');
  if (typeof cfg.entity !== 'string' || !/^binary_sensor\.[a-z0-9_]+$/.test(cfg.entity)) add('entity', 'Choose a binary sensor that reports an opening contact.');
  if (typeof cfg.object_id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(cfg.object_id)) add('object_id', 'Choose an exact tagged model object ID.');
  if (!['door', 'window', 'opening'].includes(cfg.kind)) add('kind', 'Choose door, window or opening.');
  if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') add('enabled', 'Enabled must be true or false.');
  if (cfg.contact_source_confirmed !== undefined && typeof cfg.contact_source_confirmed !== 'boolean') add('contact_source', 'Contact-source confirmation must be true or false.');
  const validStates = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.trim() === s && s.length > 0 && !['unknown', 'unavailable'].includes(s)) && new Set(v).size === v.length;
  if (!validStates(cfg.open_states) || !validStates(cfg.closed_states) || cfg.open_states?.some?.((s) => cfg.closed_states?.includes?.(s)))
    add('states', 'Choose explicit, separate open and closed states.');
  const h = cfg.highlight === undefined ? {} : cfg.highlight;
  if (!plain(h)) add('highlight', 'Outline settings must be an object.');
  const defaults = { mode: 'outline', open: '#ef5350', closed: null, unknown: '#8d9199', opacity: 1 };
  const highlight = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, h?.[key] === undefined ? fallback : h[key]]));
  if (highlight.mode !== 'outline') add('highlight', 'Security highlighting uses an owned outline.');
  for (const key of ['open', 'closed', 'unknown']) {
    if (highlight[key] === null && key === 'closed') continue;
    if (typeof highlight[key] !== 'string' || !/^#[a-f\d]{6}$/i.test(highlight[key])) add('color', `Choose a six-digit hexadecimal ${key} outline colour.`);
    else highlight[key] = highlight[key].toLowerCase();
  }
  if (!finite(highlight.opacity) || highlight.opacity < 0 || highlight.opacity > 1) add('opacity', 'Outline opacity must be between 0 and 1.');
  let motion = null;
  if (cfg.motion !== undefined) {
    const m = cfg.motion;
    if (!plain(m)) add('motion', 'Door motion requires explicit moving-part and hinge settings.');
    else {
      if (typeof m.target !== 'string' || !(m.target === '.' || m.target.split('/').every((p) => p && p !== '.' && p !== '..'))) add('target', 'Choose an exact relative moving-part path.');
      if (!vector(m.pivot) || m.pivot.some((n) => Math.abs(n) > SECURITY_LIMITS.maxCoordinate)) add('pivot', 'Choose a finite parent-local hinge pivot.');
      if (!vector(m.axis) || !finite(Math.hypot(...m.axis)) || Math.hypot(...m.axis) === 0) add('axis', 'Choose a finite, nonzero parent-local hinge axis.');
      for (const key of ['closed_degrees', 'open_degrees']) if (!finite(m[key]) || Math.abs(m[key]) > SECURITY_LIMITS.maxDegrees) add('angle', 'Choose explicit signed angles between -360 and 360 degrees.');
      if (!finite(m.duration_ms) || m.duration_ms < 0 || m.duration_ms > SECURITY_LIMITS.maxDuration) add('duration', 'Choose a motion duration between 0 and 5000 milliseconds.');
      if (diagnostics.length === 0) motion = { target: m.target, pivot: m.pivot.slice(), axis: m.axis.map((n) => n / Math.hypot(...m.axis)), closed_degrees: m.closed_degrees, open_degrees: m.open_degrees, duration_ms: m.duration_ms };
    }
  }
  return { ...cfg, enabled: cfg.enabled !== false, highlight, motion, valid: diagnostics.length === 0, diagnostics,
    open_states: Array.isArray(cfg.open_states) ? cfg.open_states.slice() : [], closed_states: Array.isArray(cfg.closed_states) ? cfg.closed_states.slice() : [] };
}

/** Honest contact evidence. Unknown/missing/restored never means closed. No configured
 * heartbeat means current HA state with age unverified; old last_changed alone is not stale.
 * Explicit wrong device classes (lock/motion/etc.) cannot be confirmed into door evidence.
 */
export function readSecurityContact(hass, binding, { now = Date.now() } = {}) {
  const config = normaliseSecurityBinding(binding), metadata = entityMetadata(hass, config.entity);
  const base = { id: config.id, entity: config.entity, config, metadata, status: 'invalid', open: null, shown: false, nextExpiry: null, verified: false, diagnostics: config.diagnostics.slice() };
  const bad = (status, message) => ({ ...base, status, diagnostics: [...base.diagnostics, issue(status, message, config.id)] });
  if (!config.valid) return base;
  if (!config.enabled) return { ...base, status: 'disabled', diagnostics: [] };
  if (metadata.missing) return bad('missing', 'The saved contact entity is missing.');
  if (metadata.disabled) return bad('disabled', 'The contact entity or its device is disabled.');
  if (metadata.hidden || metadata.category) return bad('hidden', 'The contact entity is hidden or belongs to a configuration/diagnostic category.');
  if (!metadata.hasState) return bad('unavailable', 'The registered contact has no current state.');
  if (metadata.deviceClass && !contactClasses.has(metadata.deviceClass)) return bad('contact_class', 'This device class does not report an opening contact.');
  if (!metadata.deviceClass && config.contact_source_confirmed !== true) return bad('contact_class', 'Confirm that this unclassified binary sensor is a real opening contact.');
  const freshness = readFreshness(metadata.state, config.freshness, now);
  if (!['ready', 'current'].includes(freshness.status)) return { ...base, status: metadata.state.state === 'unknown' ? 'unknown' : freshness.status,
    shown: true, diagnostics: freshness.diagnostics.map((d) => ({ ...d, id: config.id })) };
  const reported = metadata.state.state;
  if (![...config.open_states, ...config.closed_states].includes(reported)) return { ...bad('unknown', 'The contact does not report a configured open or closed state.'), shown: true };
  const open = config.open_states.includes(reported);
  return { ...base, status: open ? 'open' : 'closed', open, shown: true, verified: freshness.verified,
    nextExpiry: freshness.nextExpiry, diagnostics: [] };
}

const within = (node, ancestor) => { for (let n = node; n; n = n.parent) if (n === ancestor) return true; return false; };
const related = (a, b) => within(a, b) || within(b, a);
const shown = (node) => { for (let n = node; n; n = n.parent) if (!n.visible) return false; return true; };
const deforms = (node) => node.isSkinnedMesh || node.isBone || Object.keys(node.geometry?.morphAttributes || {}).length > 0 || node.morphTargetInfluences?.length > 0;
const poseKey = (m) => m ? JSON.stringify(m) : '';

function resolveTarget(object, path) {
  let node = object;
  if (path === '.') return { node };
  for (const segment of path.split('/')) {
    const matches = node.children.filter((child) => !child.userData.helper && nameOf(child) === segment);
    if (matches.length !== 1) return { error: matches.length ? 'ambiguous_target' : 'missing_target' };
    node = matches[0];
  }
  return { node };
}

function baseline(node) {
  if (![...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray(), ...node.matrix.elements].every(finite)) return null;
  const matrix = node.matrixAutoUpdate ? new THREE.Matrix4().compose(node.position, node.quaternion, node.scale) : node.matrix.clone();
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  if (![...position.toArray(), ...quaternion.toArray(), ...scale.toArray()].every(finite) || scale.toArray().some((v) => v === 0)) return null;
  const composed = new THREE.Matrix4().compose(position, quaternion, scale);
  if (matrix.elements.some((v, i) => Math.abs(v - composed.elements[i]) > 1e-8 * Math.max(1, Math.abs(v)))) return null; // Shear cannot be represented by hinge p/q/s.
  return { position, quaternion, scale, original: { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), matrix: node.matrix.clone(), matrixWorld: node.matrixWorld.clone(), matrixAutoUpdate: node.matrixAutoUpdate, matrixWorldAutoUpdate: node.matrixWorldAutoUpdate, matrixWorldNeedsUpdate: node.matrixWorldNeedsUpdate } };
}

/** Existing model scene adapter; no renderer, lights, source-material clones or textures.
 * setData/update return visible change OR ongoing visible motion for demand rendering.
 * movementChanged/changedMotionTargets accumulate actual geometry changes until
 * takeMotionChanges() returns {movementChanged,changedMotionTargets:Set<Object3D>} once.
 * Root must refresh bounds/occlusion/shadows/dynamic anchors for those targets.
 * Call setModel(null)/dispose BEFORE the model's original resources are disposed.
 */
export class SecurityLayer {
  constructor({ onInvalidate = () => {} } = {}) {
    this.onInvalidate = onInvalidate;
    this.model = null; this.parts = new Map(); this.diagnostics = [];
    this.movementChanged = false; this.changedMotionTargets = new Set();
    this._objects = new Map(); this._visible = true; this._disposed = false;
    this._planes = []; this._planeKey = ''; this._motionWriters = new Set();
    this.nextExpiry = null;
  }

  get moving() { return this._visible && [...this.parts.values()].some((part) => part.tween && part.shown); }

  takeMotionChanges() {
    const result = { movementChanged: this.movementChanged, changedMotionTargets: new Set(this.changedMotionTargets) };
    this.movementChanged = false; this.changedMotionTargets.clear(); return result;
  }

  setModel(model, { objectNodes, motionWriters } = {}) {
    if (this._disposed) return false;
    motionWriters ??= this.model === model ? this._motionWriters : new Set();
    if (this.model === model && objectNodes === this._objectNodes && motionWriters === this._motionWriters) return false;
    const changed = this.parts.size > 0;
    for (const part of this.parts.values()) this._remove(part);
    this.parts.clear(); this._objects.clear(); this.diagnostics = []; this.nextExpiry = null;
    this.model = model || null; this._objectNodes = objectNodes; this._motionWriters = motionWriters;
    if (model?.root) {
      const add = (id, node) => {
        if (typeof id !== 'string' || !node?.isObject3D || !within(node, model.root)) return;
        const nodes = this._objects.get(id) || []; if (!nodes.includes(node)) nodes.push(node); this._objects.set(id, nodes);
      };
      // Scan raw tags too: buildManifest deliberately omits later duplicate entries.
      model.root.traverse((node) => {
        if (node.userData.helper) return;
        const tag = readTag(nameOf(node), node.userData);
        if (tag?.kind === 'object') add(tag.id, node);
      });
      for (const object of model.manifest?.objects || []) add(object.id, object.node);
      if (objectNodes instanceof Map) for (const [id, value] of objectNodes) for (const node of Array.isArray(value) ? value : [value]) add(id, node);
    }
    if (changed) this.onInvalidate(); return changed;
  }

  setClippingPlanes(planes = []) {
    if (this._disposed) return false;
    if (!Array.isArray(planes) || planes.some((plane) => !plane?.isPlane || ![...plane.normal.toArray(), plane.constant].every(finite))) throw new TypeError('Security clipping planes must be finite Three.js planes.');
    const key = JSON.stringify(planes.map((p) => [...p.normal.toArray(), p.constant]));
    if (key === this._planeKey || !planes.length && !this._planes.length) return false;
    this._planes = planes.map((plane) => plane.clone()); this._planeKey = key;
    let changed = false;
    for (const part of this.parts.values()) {
      part.material.clippingPlanes = this._planes; part.material.needsUpdate = true;
      changed ||= part.shown && part.lines.some((line) => line.visible);
    }
    if (changed && this._visible) this.onInvalidate(); return changed && this._visible;
  }

  setVisible(value) {
    if (this._disposed || typeof value !== 'boolean' || this._visible === value) return false;
    this._visible = value;
    for (const part of this.parts.values()) {
      if (!value && part.tween) { this._apply(part, part.tween.to); part.tween = null; }
      for (const line of part.lines) line.visible = value && part.shown && !!part.color && part.opacity > 0;
    }
    if (this.parts.size) this.onInvalidate(); return this.parts.size > 0;
  }

  setData({ hass = {}, bindings = [], now = Date.now(), animationNow = 0, reducedMotion = false, shownObjectIds } = {}) {
    if (this._disposed) return false;
    const diagnostics = [], candidates = [], ids = new Map(), objects = new Map();
    this.nextExpiry = null;
    if (!Array.isArray(bindings) || bindings.length > SECURITY_LIMITS.maxBindings) {
      diagnostics.push(issue('bindings', 'Supply no more than 256 explicit security bindings.')); bindings = [];
    }
    for (const value of bindings) {
      const reading = readSecurityContact(hass, value, { now }), config = reading.config;
      diagnostics.push(...reading.diagnostics);
      if (!config.valid || !config.enabled) continue;
      ids.set(config.id, (ids.get(config.id) || 0) + 1); objects.set(config.object_id, (objects.get(config.object_id) || 0) + 1);
      const matches = this._objects.get(config.object_id) || [];
      if (matches.length !== 1) { diagnostics.push(issue(matches.length ? 'ambiguous_object' : 'missing_object', 'Choose one exact tagged model object; plain node names are not object IDs.', config.id)); continue; }
      if (!reading.shown) continue;
      const object = matches[0];
      const isShown = shown(object) && (shownObjectIds === undefined || shownObjectIds instanceof Set && shownObjectIds.has(config.object_id));
      let target = null, motionIssue = null;
      if (config.motion) {
        const resolution = resolveTarget(object, config.motion.target); target = resolution.node;
        motionIssue = resolution.error;
        if (target) {
          let unsupported = false;
          target.traverse((node) => { if (!node.userData.helper && (deforms(node) || node.matrixWorldAutoUpdate === false)) unsupported = true; });
          if (unsupported) motionIssue = 'unsupported_target';
          if (!target.parent || !baseline(target)) motionIssue = 'unsupported_transform';
          if ([...this._motionWriters].some((writer) => writer?.isObject3D && related(target, writer))) motionIssue = 'shared_writer';
          modelTraversal(this.model?.root, (node) => { if (claims.has(node) && claims.get(node) !== this && related(target, node)) motionIssue = 'shared_writer'; });
          for (let node = target.parent; node; node = node.parent) if (claims.has(node) && claims.get(node) !== this) motionIssue = 'shared_writer';
        }
      }
      candidates.push({ reading, config, object, shown: isShown, target, motionIssue });
    }
    // Reject BOTH conflicting configurations, not whichever happens to be processed second.
    const motionCandidates = candidates.filter((candidate) => candidate.target && !candidate.motionIssue);
    for (const candidate of candidates) {
      if (ids.get(candidate.config.id) > 1 || objects.get(candidate.config.object_id) > 1) candidate.reject = 'duplicate_binding';
    }
    for (const candidate of motionCandidates) for (const other of motionCandidates) if (other !== candidate && related(candidate.target, other.target)) candidate.motionIssue = other.motionIssue = 'shared_writer';
    const keep = new Set(), intendedIds = new Set(candidates.filter((candidate) => !candidate.reject).map((candidate) => candidate.config.id));
    let changed = false;
    // Release removed bindings before budgeting their replacements.
    for (const [id, part] of this.parts) if (!intendedIds.has(id)) { changed = this._remove(part) || changed; this.parts.delete(id); }
    for (const candidate of candidates) {
      const { config, object, reading } = candidate;
      if (candidate.reject) { diagnostics.push(issue(candidate.reject, 'Security binding IDs and object selections must each be unique.', config.id)); continue; }
      if (candidate.motionIssue) diagnostics.push(issue(candidate.motionIssue, 'Door motion needs one unique rigid moving target with an unshared transform writer.', config.id));
      const target = candidate.motionIssue ? null : candidate.target;
      const key = `${poseKey(target && config.motion)}:${object.uuid}:${target?.uuid || ''}`;
      let part = this.parts.get(config.id);
      if (part && part.key !== key) { changed = this._remove(part) || changed; this.parts.delete(config.id); part = null; }
      if (!part) {
        part = this._prepare(candidate, target, key, diagnostics);
        if (!part) continue;
        this.parts.set(config.id, part);
      }
      keep.add(config.id); part.reading = reading; part.shown = candidate.shown; part.config = config;
      if (reading.nextExpiry !== null) this.nextExpiry = this.nextExpiry === null ? reading.nextExpiry : Math.min(this.nextExpiry, reading.nextExpiry);
      const color = reading.status === 'open' ? config.highlight.open : reading.status === 'closed' ? config.highlight.closed : config.highlight.unknown;
      const visible = this._visible && part.shown && !!color && config.highlight.opacity > 0;
      if (part.color !== color || part.opacity !== config.highlight.opacity) {
        if (color) part.material.color.set(color); part.material.opacity = config.highlight.opacity;
        changed ||= visible || part.lines.some((line) => line.visible); part.color = color; part.opacity = config.highlight.opacity;
      }
      for (const line of part.lines) if (line.visible !== visible) { line.visible = visible; changed = true; }
      if (part.target) {
        const degrees = reading.open === null ? null : reading.open ? config.motion.open_degrees : config.motion.closed_degrees;
        if (degrees === null) { changed = this._restore(part) || changed; part.targetDegrees = null; }
        else if (part.targetDegrees !== degrees) {
          // Advance the old flight to this time BEFORE reversal; repeated state never restarts it.
          changed = this._advance(part, animationNow, false) || changed;
          part.targetDegrees = degrees;
          if (!finite(animationNow) || reducedMotion || !this._visible || !part.shown || config.motion.duration_ms === 0 || part.degrees === degrees) {
            changed = this._apply(part, degrees) || changed; part.tween = null;
          } else part.tween = { from: part.degrees, to: degrees, start: animationNow, duration: config.motion.duration_ms };
        } else if (part.tween && (reducedMotion || !this._visible || !part.shown)) { changed = this._apply(part, degrees) || changed; part.tween = null; }
      }
    }
    for (const [id, part] of this.parts) if (!keep.has(id)) { changed = this._remove(part) || changed; this.parts.delete(id); }
    this.diagnostics = diagnostics;
    if ((changed || this.moving) && this._visible) this.onInvalidate();
    return changed || this.moving;
  }

  update(animationNow, { reducedMotion = false } = {}) {
    if (this._disposed || !finite(animationNow)) return false;
    let changed = false;
    for (const part of this.parts.values()) changed = this._advance(part, animationNow, reducedMotion || !this._visible || !part.shown) || changed;
    return changed || this.moving;
  }

  _prepare(candidate, target, key, diagnostics) {
    const meshes = [];
    candidate.object.traverse((node) => { if (node.isMesh && !node.userData.helper && !deforms(node)) meshes.push(node); });
    const ownedCount = [...this.parts.values()].reduce((total, part) => total + part.lines.length, 0);
    if (!meshes.length || meshes.length > SECURITY_LIMITS.maxMeshes || ownedCount + meshes.length > SECURITY_LIMITS.maxTotalMeshes
      || meshes.some((mesh) => !mesh.geometry?.isBufferGeometry || !mesh.geometry.attributes.position || !Number.isSafeInteger(mesh.geometry.attributes.position.count)
        || mesh.geometry.attributes.position.count < 3 || mesh.geometry.attributes.position.count > SECURITY_LIMITS.maxVertices)) {
      diagnostics.push(issue('outline_geometry', 'Security outlines need bounded rigid source geometry: 1–256 meshes per object, 1024 overall, and at most 100000 vertices per mesh.', candidate.config.id)); return null;
    }
    const material = new THREE.LineBasicMaterial({ color: candidate.config.highlight.open, transparent: true, opacity: candidate.config.highlight.opacity,
      depthTest: true, depthWrite: false, clippingPlanes: this._planes });
    const lines = [];
    try {
      for (const mesh of meshes) {
        const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), material);
        line.userData.helper = true; line.name = `taylors3d-security:${candidate.config.id}`;
        line.raycast = () => {}; line.castShadow = false; line.receiveShadow = false; line.visible = false;
        mesh.add(line); lines.push(line);
      }
    } catch {
      for (const line of lines) { line.removeFromParent(); line.geometry.dispose(); }
      material.dispose(); diagnostics.push(issue('outline_geometry', 'The source geometry cannot supply a valid rigid outline.', candidate.config.id)); return null;
    }
    const part = { key, object: candidate.object, target, baseline: target ? baseline(target) : null, config: candidate.config, material, lines,
      shown: false, color: null, opacity: candidate.config.highlight.opacity, degrees: 0, targetDegrees: null, tween: null, touched: false };
    if (target) claims.set(target, this); return part;
  }

  _advance(part, now, snap) {
    if (!part.tween || !finite(now)) return false;
    const t = snap ? 1 : Math.max(0, Math.min(1, (now - part.tween.start) / part.tween.duration));
    const ease = t * t * (3 - 2 * t);
    const changed = this._apply(part, part.tween.from + (part.tween.to - part.tween.from) * ease);
    if (t === 1) part.tween = null; return changed;
  }

  _markMoved(target) { this.movementChanged = true; this.changedMotionTargets.add(target); }

  _apply(part, degrees) {
    if (!part.target || part.degrees === degrees) return false;
    const node = part.target, base = part.baseline, m = part.config.motion;
    const pivot = new THREE.Vector3(...m.pivot), delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...m.axis), degrees * DEG);
    node.position.copy(base.position).sub(pivot).applyQuaternion(delta).add(pivot);
    node.quaternion.copy(base.quaternion).premultiply(delta); node.scale.copy(base.scale);
    node.updateMatrix(); node.updateWorldMatrix(true, true);
    part.degrees = degrees; part.touched = true; this._markMoved(node); return true;
  }

  _restore(part) {
    part.tween = null;
    if (!part.target || !part.touched) { part.degrees = 0; return false; }
    const changed = part.degrees !== 0;
    const node = part.target, saved = part.baseline.original;
    node.position.copy(saved.position); node.quaternion.copy(saved.quaternion); node.scale.copy(saved.scale);
    node.matrix.copy(saved.matrix); node.matrixAutoUpdate = saved.matrixAutoUpdate; node.matrixWorldAutoUpdate = saved.matrixWorldAutoUpdate;
    node.updateWorldMatrix(true, true); node.matrixWorldNeedsUpdate = saved.matrixWorldNeedsUpdate;
    part.degrees = 0; part.touched = false; if (changed) this._markMoved(node); return changed;
  }

  _remove(part) {
    const changed = this._restore(part) || part.lines.some((line) => line.visible);
    if (part.target && claims.get(part.target) === this) claims.delete(part.target);
    for (const line of part.lines) { line.removeFromParent(); line.geometry.dispose(); }
    part.material.dispose(); return changed;
  }

  dispose() {
    if (this._disposed) return;
    for (const part of this.parts.values()) this._remove(part);
    this.parts.clear(); this._objects.clear(); this.model = null; this.nextExpiry = null; this._disposed = true;
  }
}

function modelTraversal(root, visit) { root?.traverse(visit); }
