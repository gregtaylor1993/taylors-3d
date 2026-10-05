// Explicit visual wall settings and pure runtime decisions. No GLB name guesses,
// material/geometry writes, clocks, timers, Home Assistant actions or Three imports.
export const WALL_PRESENTATION_LIMITS = Object.freeze({ maxWalls: 256, maxPath: 4096,
  maxCoordinate: 1000000, maxCutHeight: 1000, maxTransitionMs: 1000, frameDeltaMs: 50, sideEpsilonM: .05 });
export const WALL_PRESENTATION_DEFAULTS = Object.freeze({ enabled: false, mode: 'normal', scope: 'camera_side',
  opacity: .2, cut_height_m: 1.2, transition_ms: 250, walls: Object.freeze([]) });

const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const vector = (value) => Array.isArray(value) && value.length === 3 && [0, 1, 2].every((index) => finite(value[index]));
const own = (value, key) => Object.hasOwn(value, key);
const issue = (code, message, id) => ({ code, message, ...(typeof id === 'string' ? { id } : {}) });
const normalized = new WeakSet();
const direction = (value) => {
  if (!vector(value)) return null;
  const scale = Math.max(...value.map(Math.abs));
  if (scale === 0) return null;
  const scaled = value.map((component) => component / scale), length = Math.hypot(...scaled);
  return { normal: scaled.map((component) => component / length), scale, length };
};

// Paths already contain nodeIndex's escaped names and duplicate-sibling suffixes.
// An escaped literal '*' is a name; an unescaped '*' is a broad selector and unsafe.
export function exactWallSelector(value) {
  if (typeof value !== 'string' || !value.startsWith('node:') || value.length <= 5
    || value.length > WALL_PRESENTATION_LIMITS.maxPath || /[\r\n\0]/.test(value)) return null;
  for (let index = 5; index < value.length; index++) {
    if (value[index] === '\\') {
      if (++index >= value.length || !'\\*/#'.includes(value[index])) return null;
    } else if (value[index] === '*') return null;
  }
  return value;
}

/** readWallPresentation(raw) -> strict normalized policy and per-row diagnostics.
 * Known malformed fields disable this policy; unknown extension fields are ignored.
 * Editors preserve raw imports separately. Runtime missing references are resolved
 * by wallTargetReport, never repaired or inferred here.
 */
export function readWallPresentation(value) {
  if (normalized.has(value)) return value; // retain the diagnostics of this reader's compiled policy
  const policy = { ...WALL_PRESENTATION_DEFAULTS, walls: [], valid: true, diagnostics: [] };
  const add = (code, message, id) => policy.diagnostics.push(issue(code, message, id));
  if (value !== undefined && !plain(value)) add('invalid_policy', 'Wall presentation settings must be an object.');
  const raw = plain(value) ? value : {};
  for (const [field, allowed] of [['mode', ['normal', 'fade', 'cutaway', 'glass']], ['scope', ['camera_side', 'all_selected']]]) {
    if (!own(raw, field)) continue;
    if (allowed.includes(raw[field])) policy[field] = raw[field];
    else add(`invalid_${field}`, `Choose a supported wall ${field}.`);
  }
  if (own(raw, 'enabled')) {
    if (typeof raw.enabled === 'boolean') policy.enabled = raw.enabled;
    else add('invalid_enabled', 'Enabled must be true or false.');
  }
  for (const [field, maximum] of [['opacity', 1], ['cut_height_m', WALL_PRESENTATION_LIMITS.maxCutHeight], ['transition_ms', WALL_PRESENTATION_LIMITS.maxTransitionMs]]) {
    if (!own(raw, field)) continue;
    if (finite(raw[field]) && raw[field] >= 0 && raw[field] <= maximum) policy[field] = raw[field];
    else add(`invalid_${field}`, `${field} must be a finite number from 0 to ${maximum}.`);
  }
  if (own(raw, 'walls') && !Array.isArray(raw.walls)) add('invalid_walls', 'Choose an array of exact wall meshes.');
  const walls = Array.isArray(raw.walls) ? raw.walls : [];
  if (walls.length > WALL_PRESENTATION_LIMITS.maxWalls) add('wall_limit', `Choose at most ${WALL_PRESENTATION_LIMITS.maxWalls} walls.`);
  policy.walls = Array.from(walls.slice(0, WALL_PRESENTATION_LIMITS.maxWalls)).map((input) => {
    const cfg = plain(input) ? input : {}, diagnostics = [];
    const row = { id: cfg.id, label: cfg.label, selector: cfg.selector, enabled: true, face: null,
      floor_id: cfg.floor_id, valid: true, diagnostics };
    const bad = (code, message) => diagnostics.push(issue(code, message, cfg.id));
    if (!plain(input)) bad('invalid_wall', 'A wall selection must be an object.');
    if (typeof cfg.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(cfg.id)) bad('invalid_id', 'Choose a unique wall ID using a-z, 0-9, underscore or dash.');
    if (own(cfg, 'label') && (typeof cfg.label !== 'string' || cfg.label.length > 128)) bad('invalid_label', 'A wall label must be text of at most 128 characters.');
    if (!exactWallSelector(cfg.selector)) bad('invalid_selector', 'Choose one exact mesh node path, without wildcard selectors.');
    if (own(cfg, 'enabled')) {
      if (typeof cfg.enabled === 'boolean') row.enabled = cfg.enabled;
      else bad('invalid_wall_enabled', 'Wall enabled must be true or false.');
    }
    if (own(cfg, 'floor_id') && (typeof cfg.floor_id !== 'string' || !cfg.floor_id || cfg.floor_id.trim() !== cfg.floor_id || cfg.floor_id.length > 256))
      bad('invalid_floor_id', 'Choose an exact saved floor ID.');
    if (policy.mode === 'cutaway' && !own(cfg, 'floor_id')) bad('missing_floor_id', 'Cut-away requires an explicit floor.');
    if (own(cfg, 'face')) {
      const face = cfg.face;
      const unit = direction(face?.normal);
      if (!plain(face) || face.space !== 'node-local' || !vector(face.point)
        || face.point.some((n) => Math.abs(n) > WALL_PRESENTATION_LIMITS.maxCoordinate) || !unit)
        bad('invalid_face', 'Choose a finite mesh-local face point and a nonzero face normal.');
      else row.face = { space: 'node-local', point: face.point.slice(), normal: unit.normal };
    } else if (policy.scope === 'camera_side') bad('missing_face', 'Camera-side presentation requires an explicitly selected mesh face.');
    return row;
  });
  for (const field of ['id', 'selector']) {
    const counts = new Map();
    for (const row of policy.walls) if (typeof row[field] === 'string') counts.set(row[field], (counts.get(row[field]) || 0) + 1);
    for (const row of policy.walls) if (counts.get(row[field]) > 1)
      row.diagnostics.push(issue(`duplicate_${field}`, `Each wall ${field === 'id' ? 'ID' : 'mesh selector'} must be unique.`, row.id));
  }
  for (const row of policy.walls) {
    row.valid = row.diagnostics.length === 0;
    if (!row.valid) row.enabled = false;
    policy.diagnostics.push(...row.diagnostics);
  }
  policy.valid = policy.diagnostics.length === 0;
  if (!policy.valid) policy.enabled = false;
  normalized.add(policy);
  return policy;
}

/** Safe saved exact targets survive merging even while settings are disabled or
 * another imported field is invalid. This does not activate any presentation.
 */
export function wallKeepSelectors(value) {
  return [...new Set((plain(value) && Array.isArray(value.walls) ? value.walls : [])
    .slice(0, WALL_PRESENTATION_LIMITS.maxWalls).map((row) => exactWallSelector(row?.selector)).filter(Boolean))];
}

const within = (node, root) => { for (let current = node; current; current = current.parent) if (current === root) return true; return false; };
const materialsOf = (node) => Array.isArray(node?.material) ? Array.from(node.material) : node?.material ? [node.material] : [];

/** wallTargetReport(rawOrPolicy,{index,floors,modelRoot?,materialWriters?})
 * -> {policy,rows,diagnostics}. Each row retains its selector/floor_id, plus
 * node, floor, elevation, ready, enabled, status and diagnostics. `ready` means
 * supported current references; `enabled` additionally applies policy/row gates.
 * materialWriters is an optional Set of exact meshes already owned by live glows.
 */
export function wallTargetReport(value, { index, floors = [], modelRoot, materialWriters } = {}) {
  const policy = normalized.has(value) ? value : readWallPresentation(value);
  const rows = policy.walls.map((cfg) => {
    const diagnostics = cfg.diagnostics.slice(), found = exactWallSelector(cfg.selector)
      ? (Array.isArray(index?.nodes) ? index.nodes.filter((entry) => entry.path === cfg.selector.slice(5)) : []) : [];
    const row = { ...cfg, node: null, floor: null, elevation: null, ready: false, enabled: false, status: 'invalid', diagnostics };
    const bad = (code, message) => { row.status = code; diagnostics.push(issue(code, message, cfg.id)); };
    if (found.length !== 1) bad(found.length ? 'ambiguous_node' : 'missing_node', found.length ? 'This mesh path is ambiguous in the current model.' : 'The saved wall mesh is missing from the current model.');
    else {
      const node = found[0].node; row.node = node || null;
      if (modelRoot !== undefined && (!modelRoot?.isObject3D || !within(node, modelRoot))) bad('stale_model', 'This mesh belongs to an older or unavailable model.');
      else if (!node?.isMesh) bad('not_mesh', 'Choose the exact wall mesh, rather than a room or group.');
      else if (node.userData?.merged) bad('merged_mesh', 'This mesh combines original parts. Reload with the exact original wall path preserved.');
      else if (node.isSkinnedMesh || node.isInstancedMesh || node.isBatchedMesh
        || node.morphTargetInfluences?.length || Object.keys(node.geometry?.morphAttributes || {}).length)
        bad('unsupported_mesh', 'Choose one rigid, non-instanced wall mesh without morph targets.');
      else if (materialWriters?.has?.(node)) bad('material_writer', 'This mesh already has a live appearance owner. Choose a separate wall mesh.');
      else {
        const materials = materialsOf(node);
        if (!materials.length || materials.some((material) => !material?.isMaterial)) bad('missing_material', 'The wall needs valid authored materials.');
        else if (policy.mode === 'cutaway' && materials.some((material) => material.clipIntersection === true)) bad('clip_intersection', 'This wall uses intersection clipping, which cannot safely combine with wall cut-away.');
        else if (materials.some((material) => material.isShaderMaterial || material.isRawShaderMaterial)) bad('unsupported_material', 'Custom wall shaders need an explicit compatible material implementation.');
        else row.status = 'ready';
      }
    }
    if (cfg.floor_id !== undefined) {
      const matching = (Array.isArray(floors) ? floors : []).filter((floor) => floor?.id === cfg.floor_id);
      if (matching.length !== 1 || !finite(matching[0]?.elevation)) {
        diagnostics.push(issue(matching.length > 1 ? 'ambiguous_floor' : 'missing_floor', 'The saved floor needs one current finite elevation; no replacement is inferred.', cfg.id));
        if (policy.mode === 'cutaway' && row.status === 'ready') row.status = 'missing_floor';
      } else { row.floor = matching[0]; row.elevation = matching[0].elevation; }
    }
    row.ready = cfg.valid && row.status === 'ready' && (policy.mode !== 'cutaway' || row.floor !== null);
    row.enabled = policy.valid && policy.enabled && policy.mode !== 'normal' && cfg.enabled && row.ready;
    if (!cfg.valid) row.status = 'invalid';
    return row;
  });
  const counts = new Map();
  for (const row of rows) if (row.node) counts.set(row.node, (counts.get(row.node) || 0) + 1);
  for (const row of rows) if (counts.get(row.node) > 1) {
    row.ready = false; row.enabled = false; row.status = 'duplicate_target';
    row.diagnostics.push(issue('duplicate_target', 'Two wall selections resolve to the same current mesh.', row.id));
  }
  return { policy, rows, diagnostics: [...policy.diagnostics, ...rows.flatMap((row) => row.diagnostics.filter((entry) => !policy.diagnostics.includes(entry)))] };
}

/** Camera-side activation from an explicit WORLD plane n·p+c=0. No focus rule.
 * Normalize distance to metres; ±5cm hysteresis retains the previous side at
 * an edge, avoiding rapid fade/cut changes when the camera rests near the wall.
 */
export function readWallSide(plane, cameraPosition, previousActive = false) {
  const unit = direction(plane?.normal);
  const invalid = () => ({ active: false, signedDistance: null, valid: false,
    diagnostics: [issue('invalid_world_plane', 'Choose a finite world plane and current camera position.')] });
  if (!plain(plane) || !finite(plane.constant) || !unit || !vector(cameraPosition)) return invalid();
  const distance = unit.normal.reduce((sum, component, index) => sum + component * cameraPosition[index], plane.constant / unit.scale / unit.length);
  if (!finite(distance)) return invalid();
  const epsilon = WALL_PRESENTATION_LIMITS.sideEpsilonM;
  return { active: distance > epsilon ? true : distance < -epsilon ? false : previousActive === true,
    signedDistance: distance, valid: true, diagnostics: [] };
}

/** Immutable transition state, fed explicit performance.now() by the existing RAF.
 * target is 1 (normal) or the selected fade/glass opacity multiplier. A reversal
 * starts at the current value. Lost/hidden time never advances more than 50ms.
 */
export function stepWallTransition(previous, { now, target, duration_ms = 250, reducedMotion = false } = {}) {
  const validPrevious = previous == null || (plain(previous) && finite(previous.value) && previous.value >= 0 && previous.value <= 1
    && finite(previous.target) && previous.target >= 0 && previous.target <= 1 && finite(previous.lastNow) && previous.lastNow >= 0
    && finite(previous.remaining_ms) && previous.remaining_ms >= 0 && finite(previous.duration_ms) && previous.duration_ms >= 0
    && previous.duration_ms <= WALL_PRESENTATION_LIMITS.maxTransitionMs && previous.remaining_ms <= previous.duration_ms);
  if (!validPrevious || !finite(now) || now < 0 || !finite(target) || target < 0 || target > 1
    || !finite(duration_ms) || duration_ms < 0 || duration_ms > WALL_PRESENTATION_LIMITS.maxTransitionMs || typeof reducedMotion !== 'boolean')
    return { value: 1, target: 1, lastNow: validPrevious && previous ? previous.lastNow : 0, remaining_ms: 0, duration_ms: 0,
      moving: false, changed: previous?.value !== 1, valid: false, diagnostics: [issue('invalid_transition', 'Supply finite, bounded wall transition values and monotonic frame time.')] };
  const oldValue = previous?.value ?? 1, lastNow = Math.max(previous?.lastNow ?? now, now);
  const reset = !previous || previous.target !== target || previous.duration_ms !== duration_ms;
  let remaining = reset ? duration_ms : previous.remaining_ms, value = oldValue;
  if (reducedMotion || duration_ms === 0 || oldValue === target || remaining === 0) { value = target; remaining = 0; }
  else if (!reset) {
    const delta = Math.min(WALL_PRESENTATION_LIMITS.frameDeltaMs, Math.max(0, now - previous.lastNow));
    if (delta >= remaining) { value = target; remaining = 0; }
    else { value = oldValue + (target - oldValue) * delta / remaining; remaining -= delta; }
  }
  return { value, target, lastNow, remaining_ms: remaining, duration_ms, moving: remaining > 0 && value !== target,
    changed: value !== oldValue, valid: true, diagnostics: [] };
}
