// Pure source/display coordinate planning. Geometry ownership belongs to the
// caller: this module never guesses floor membership from heights or node names.
export const FLOOR_PRESENTATION_LIMITS = Object.freeze({ maxFloors: 4, maxGapM: 100,
  maxBaseElevationM: 1000, maxWorldCoordinate: 1000000, maxIdLength: 256 });
export const FLOOR_PRESENTATION_DEFAULTS = Object.freeze({ mode: 'assembled', floors: null,
  gap_m: 2, axis: 'east', base_elevation_m: 0, panels: false });

const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const coordinate = (value) => finite(value) && Math.abs(value) <= FLOOR_PRESENTATION_LIMITS.maxWorldCoordinate;
const vector = (value, bounded = true) => Array.isArray(value) && value.length === 3
  && [0, 1, 2].every((index) => (bounded ? coordinate : finite)(value[index]));
const exactId = (value) => {
  if (typeof value !== 'string' || !value.length || value.length > FLOOR_PRESENTATION_LIMITS.maxIdLength || value.trim() !== value) return false;
  for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) < 32 || value.charCodeAt(index) === 127) return false;
  return true;
};
const issue = (code, message, floor_id) => ({ code, message, ...(typeof floor_id === 'string' ? { floor_id } : {}) });
const order = (a, b) => a.elevation - b.elevation || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const normalized = new WeakSet();

/** readFloorPresentation(raw) -> normalized requested settings, valid, diagnostics.
 * Absent settings preserve assembled behavior. Known malformed values are errors;
 * unknown imported fields are untouched and ignored. A valid reader result alone
 * never authorizes transforms: compileFloorPresentation checks current evidence.
 */
export function readFloorPresentation(value) {
  if (normalized.has(value)) return value;
  const policy = { ...FLOOR_PRESENTATION_DEFAULTS, valid: true, diagnostics: [] };
  const bad = (code, message, id) => policy.diagnostics.push(issue(code, message, id));
  if (value !== undefined && !plain(value)) bad('invalid_policy', 'Floor presentation settings must be an object.');
  const raw = plain(value) ? value : {};
  if (Object.hasOwn(raw, 'panels')) {
    if (typeof raw.panels === 'boolean') policy.panels = raw.panels;
    else bad('invalid_panels', 'Separate floor panels must be true or false.');
  }
  for (const [field, choices] of [['mode', ['assembled', 'horizontal', 'vertical']], ['axis', ['east', 'north']]]) {
    if (!Object.hasOwn(raw, field)) continue;
    if (choices.includes(raw[field])) policy[field] = raw[field];
    else bad(`invalid_${field}`, `Choose a supported floor presentation ${field}.`);
  }
  for (const [field, min, max] of [['gap_m', 0, FLOOR_PRESENTATION_LIMITS.maxGapM],
    ['base_elevation_m', -FLOOR_PRESENTATION_LIMITS.maxBaseElevationM, FLOOR_PRESENTATION_LIMITS.maxBaseElevationM]]) {
    if (!Object.hasOwn(raw, field)) continue;
    if (finite(raw[field]) && raw[field] >= min && raw[field] <= max) policy[field] = raw[field];
    else bad(`invalid_${field}`, `${field} must be a finite number from ${min} to ${max}.`);
  }
  if (Object.hasOwn(raw, 'floors')) {
    if (!Array.isArray(raw.floors)) bad('invalid_floors', 'Choose an array of exact floor IDs.');
    else {
      policy.floors = Array.from(raw.floors);
      const seen = new Set();
      for (const id of policy.floors) {
        if (!exactId(id)) bad('invalid_floor_id', 'Choose a nonblank exact floor ID without surrounding spaces.');
        else if (seen.has(id)) bad('duplicate_floor_id', 'Each selected floor ID must be unique.', id);
        seen.add(id);
      }
      if (policy.mode !== 'assembled' && policy.floors.length > FLOOR_PRESENTATION_LIMITS.maxFloors)
        bad('floor_limit', `Choose at most ${FLOOR_PRESENTATION_LIMITS.maxFloors} floors for separation.`);
    }
  }
  policy.valid = policy.diagnostics.length === 0;
  normalized.add(policy);
  return policy;
}

const knownFloor = (floor) => plain(floor) && exactId(floor.id) && coordinate(floor.elevation)
  && (!Object.hasOwn(floor, 'stale') || floor.stale === false);
const boundsValid = (bounds) => plain(bounds) && vector(bounds.min) && vector(bounds.max)
  && [0, 1, 2].every((index) => bounds.min[index] <= bounds.max[index])
  && bounds.min[0] < bounds.max[0] && bounds.min[2] < bounds.max[2];
const cloneBounds = (bounds) => ({ min: bounds.min.slice(), max: bounds.max.slice() });

/** compileFloorPresentation(raw,{floors,bounds,model}) ->
 * {mode,requestedMode,panels,valid,diagnostics,rows:[{floor_id,elevation,bounds,offset}]}.
 * `floors` are current exact resolved {id,elevation}; `bounds` are SOURCE-world
 * {floor_id,min:[x,y,z],max:[x,y,z]} footprints. Optional `model` is current
 * {present,supported,diagnostics}; supported must be a caller's explicit ownership
 * proof. Every selected floor must pass before any split row is returned.
 * Assembled needs no bounds/model proof/selection limit and provides identity rows
 * for unique, finite known floors. Failed splits return assembled with no rows.
 * Separate panels are optional and activate only for a proven horizontal split.
 * Other arrangements keep the saved preference without applying extra cameras.
 */
export function compileFloorPresentation(value, { floors = [], bounds = [], model } = {}) {
  const policy = readFloorPresentation(value), diagnostics = policy.diagnostics.map((entry) => ({ ...entry }));
  const result = { mode: 'assembled', requestedMode: policy.mode, panels: false, valid: policy.valid, diagnostics, rows: [] };
  const currentFloors = Array.isArray(floors) ? Array.from(floors) : [];
  if (policy.mode === 'assembled') {
    const counts = new Map();
    for (const floor of currentFloors) if (exactId(floor?.id)) counts.set(floor.id, (counts.get(floor.id) || 0) + 1);
    result.rows = currentFloors.filter((floor) => knownFloor(floor) && counts.get(floor.id) === 1).sort(order)
      .map((floor) => ({ floor_id: floor.id, elevation: floor.elevation, bounds: null, offset: [0, 0, 0] }));
    return result;
  }
  const bad = (code, message, id) => { result.valid = false; diagnostics.push(issue(code, message, id)); };
  if (!policy.valid) return result;
  if (!Array.isArray(floors)) bad('invalid_resolved_floors', 'Current resolved floors must be an array.');
  if (model !== undefined) {
    if (!plain(model) || typeof model.present !== 'boolean') bad('invalid_model', 'Current model presence must be explicitly reported.');
    else if (model.present && model.supported !== true) {
      bad('unsupported_model', 'The loaded model does not prove independent geometry for every selected floor.');
      if (Array.isArray(model.diagnostics)) for (const entry of model.diagnostics) {
        if (plain(entry) && typeof entry.code === 'string' && typeof entry.message === 'string')
          diagnostics.push(issue(entry.code, entry.message, entry.floor_id));
      }
    }
  }
  let ids;
  if (policy.floors === null) {
    if (currentFloors.some((floor) => !knownFloor(floor))) bad('invalid_resolved_floor', 'A current floor has a missing, stale or invalid resolved ID/elevation.');
    ids = currentFloors.filter(knownFloor).sort(order).map((floor) => floor.id);
  } else ids = policy.floors.slice();
  if (!ids.length) bad('no_floors', 'Choose at least one currently resolved floor.');
  if (ids.length > FLOOR_PRESENTATION_LIMITS.maxFloors)
    bad('floor_limit', `Choose an explicit list of at most ${FLOOR_PRESENTATION_LIMITS.maxFloors} floors for separation.`);
  if (!Array.isArray(bounds)) bad('invalid_bounds', 'Current source-world floor bounds must be an array.');
  const sourceBounds = Array.isArray(bounds) ? Array.from(bounds) : [], rows = [];
  for (const id of ids.slice(0, FLOOR_PRESENTATION_LIMITS.maxFloors)) {
    const matches = currentFloors.filter((floor) => floor?.id === id);
    if (matches.length !== 1) {
      bad(matches.length ? 'ambiguous_floor' : 'missing_floor', matches.length
        ? 'This exact floor ID is ambiguous in the current resolved floors.' : 'This saved floor is missing from the current resolved floors.', id);
      continue;
    }
    const floor = matches[0];
    if (!knownFloor(floor)) { bad('invalid_resolved_floor', 'This floor has a stale or invalid resolved elevation.', id); continue; }
    const footprints = sourceBounds.filter((entry) => entry?.floor_id === id);
    if (footprints.length !== 1) {
      bad(footprints.length ? 'ambiguous_bounds' : 'missing_bounds', footprints.length
        ? 'This floor has more than one source-world footprint.' : 'This floor has no measured source-world footprint.', id);
      continue;
    }
    if (!boundsValid(footprints[0])) { bad('invalid_bounds', 'Floor bounds need finite ordered coordinates and a positive east/north footprint.', id); continue; }
    rows.push({ floor_id: id, elevation: floor.elevation, bounds: cloneBounds(footprints[0]), offset: [0, 0, 0] });
  }
  if (!result.valid) return result;
  let edge = null;
  for (let rank = 0; rank < rows.length; rank++) {
    const row = rows[rank];
    if (policy.mode === 'vertical') row.offset[1] = rank * policy.gap_m;
    else {
      row.offset[1] = policy.base_elevation_m - row.elevation;
      if (policy.axis === 'east') {
        if (rank) row.offset[0] = edge + policy.gap_m - row.bounds.min[0];
        edge = row.bounds.max[0] + row.offset[0];
      } else {
        if (rank) row.offset[2] = edge - policy.gap_m - row.bounds.max[2];
        edge = row.bounds.min[2] + row.offset[2]; // north is negative world Z
      }
    }
    if (!coordinate(row.elevation + row.offset[1]) || ['min', 'max'].some((side) => row.bounds[side]
      .some((component, index) => !coordinate(component + row.offset[index]))))
      bad('display_bounds_limit', 'The separated floor would exceed the safe display coordinate limit.', row.floor_id);
  }
  if (!result.valid) return result;
  result.mode = policy.mode; result.panels = policy.mode === 'horizontal' && policy.panels; result.rows = rows;
  return result;
}

function transformPoint(point, floorId, compiled, direction) {
  const fail = (code, message) => ({ ok: false, point: null, diagnostics: [issue(code, message, floorId)] });
  if (!vector(point)) return fail('invalid_point', 'Use three finite source/display world coordinates within the safe limit.');
  if (!exactId(floorId)) return fail('invalid_floor_id', 'Use an exact current floor ID.');
  if (!plain(compiled) || !['assembled', 'horizontal', 'vertical'].includes(compiled.mode) || !Array.isArray(compiled.rows)
    || (compiled.mode !== 'assembled' && compiled.valid !== true)) return fail('invalid_presentation', 'Use a current compiled floor presentation.');
  const matches = compiled.rows.filter((row) => row?.floor_id === floorId);
  if (matches.length !== 1) return fail(matches.length ? 'ambiguous_floor' : 'unknown_floor', 'This exact floor has no unique compiled coordinate mapping.');
  const offset = matches[0].offset;
  if (!vector(offset, false) || (compiled.mode === 'assembled' && offset.some((component) => component !== 0)))
    return fail('invalid_offset', 'This floor has an invalid compiled display offset.');
  const transformed = point.map((component, index) => component + direction * offset[index]);
  if (!vector(transformed)) return fail('point_limit', 'The transformed point would exceed the safe world coordinate limit.');
  return { ok: true, point: transformed, diagnostics: [] };
}

/** Exact known-floor conversions allocate a new point and never change source data. */
export function sourceWorldToDisplay(point, floorId, compiled) { return transformPoint(point, floorId, compiled, 1); }
export function displayWorldToSource(point, floorId, compiled) { return transformPoint(point, floorId, compiled, -1); }
