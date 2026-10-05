// Current explicit geometry ownership for separated floors. Suggested HA links
// and model names/heights never authorize moving a model level.
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6;
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const issue = (code, message, floor_id) => ({ code, message, ...(typeof floor_id === 'string' ? { floor_id } : {}) });
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
const within = (node, root) => {
  const seen = new Set();
  for (let current = node; current && !seen.has(current); current = current.parent) {
    if (current === root) return true;
    seen.add(current);
  }
  return false;
};

/** Resolved current floors plus exact model level bindings, or measured SOURCE
 * room polygons for a drawn plan. The renderer still proves disjoint ownership
 * and actual supported geometry before applying any offset.
 */
export function floorPresentationContext({ modelRoot = null, manifest = null, bindings = {}, floors = [], rooms = [] } = {}) {
  const result = { targets: [], backgroundNodes: [], bounds: [], diagnostics: [], valid: true };
  const bad = (code, message, floor) => result.diagnostics.push(issue(code, message, floor));
  const counts = new Map(), known = new Map();
  if (!Array.isArray(floors)) bad('invalid_floors', 'Current floors are unavailable.');
  for (const floor of Array.isArray(floors) ? floors : []) {
    if (!id(floor?.id)) { bad('invalid_floor_id', 'A current floor has no valid exact ID.'); continue; }
    counts.set(floor.id, (counts.get(floor.id) || 0) + 1);
    if (!finite(floor.elevation) || floor.stale) bad('invalid_floor_elevation', 'A current floor needs a finite elevation.', floor.id);
    else known.set(floor.id, floor);
  }
  for (const [floorId, count] of counts) if (count !== 1) {
    known.delete(floorId); bad('duplicate_floor_id', 'A floor ID resolves more than once.', floorId);
  }
  if (modelRoot) {
    const levels = Array.isArray(manifest?.levels) ? manifest.levels : [];
    if (!levels.length) bad('missing_level_groups', 'The model needs separate tagged floor groups before they can be moved.');
    const seenIds = new Set(), seenNodes = new Set();
    for (const level of levels) {
      if (!id(level?.id) || seenIds.has(level.id) || !level.node || seenNodes.has(level.node) || !within(level.node, modelRoot)) {
        bad('invalid_level_group', 'Each model level must identify one unique current group.'); continue;
      }
      seenIds.add(level.id); seenNodes.add(level.node);
      const binding = plain(bindings) && Object.hasOwn(bindings, level.id) ? bindings[level.id] : null;
      if (!plain(binding) || binding.auto !== false) {
        bad('confirm_floor_link', `Confirm the floor link for ${level.label || level.id} in Edit → Model before separating it.`); continue;
      }
      if (binding.stale) { bad('stale_floor_link', `Repair the missing floor link for ${level.label || level.id}.`, binding.floor); continue; }
      if (binding.floor === null) { result.backgroundNodes.push(level.node); continue; }
      if (!id(binding.floor) || !known.has(binding.floor)) {
        bad('missing_floor_link', `Choose a current floor or explicitly choose no HA floor for ${level.label || level.id}.`, binding.floor); continue;
      }
      result.targets.push({ floor_id: binding.floor, node: level.node });
    }
  } else {
    const measured = new Map();
    for (const entry of Array.isArray(rooms) ? rooms : []) {
      const room = entry?.room ?? entry, floorId = room?.floor_id ?? entry?.floorId;
      if (!known.has(floorId)) { bad('missing_room_floor', 'A drawn room needs one exact current floor.', floorId); continue; }
      const polygon = room?.polygon;
      if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every((point) => Array.isArray(point)
        && point.length >= 2 && finite(point[0]) && finite(point[1]))) {
        bad('invalid_room_outline', 'A drawn room needs a finite outline before separating floors.', floorId); continue;
      }
      const elevation = known.get(floorId).elevation;
      if (!measured.has(floorId)) measured.set(floorId, { floor_id: floorId,
        min: [Infinity, elevation, Infinity], max: [-Infinity, elevation, -Infinity] });
      const bounds = measured.get(floorId);
      for (const point of polygon) {
        bounds.min[0] = Math.min(bounds.min[0], point[0]); bounds.max[0] = Math.max(bounds.max[0], point[0]);
        bounds.min[2] = Math.min(bounds.min[2], -point[1]); bounds.max[2] = Math.max(bounds.max[2], -point[1]);
      }
    }
    result.bounds = [...measured.values()];
  }
  result.valid = result.diagnostics.length === 0;
  return result;
}
