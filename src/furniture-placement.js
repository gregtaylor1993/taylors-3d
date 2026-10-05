// Pure SOURCE placement validation. No asset loading, geometry mutation, inferred
// floor/item relinking or licence/author-scale claims are made by this module.
export const FURNITURE_PLACEMENT_LIMITS = Object.freeze({ instances: 128, coordinate: 1000,
  scale: Object.freeze([0.05, 10]), floorElevation: 1e6, packs: 1024, itemsPerPack: 32 });
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => plain(value) && Object.hasOwn(value, key);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const id = (value) => typeof value === 'string' && /^[a-z0-9_-]{1,64}$/.test(value);
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const floorId = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 256
  && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const diagnostic = (code, message, index) => ({ code, message, ...(index === undefined ? {} : { index }) });

/** Undefined means an empty version-1 layout. Present malformed known fields
 * never become defaults by coercion. Unknown raw fields are left untouched.
 * z/rotation/scale have defaults ONLY when absent. Structural invalidity prevents
 * all active rendering; missing runtime references are separate readiness issues.
 */
export function readFurniturePlacement(raw) {
  if (raw === undefined) return { version: 1, instances: [], valid: true, diagnostics: [] };
  const diagnostics = [], instances = [];
  if (!plain(raw)) return { version: 1, instances, valid: false, diagnostics: [diagnostic('shape', 'Furniture settings must be a version-1 object.')] };
  if (raw.version !== 1) diagnostics.push(diagnostic('version', 'Furniture settings need the exact numeric version 1.'));
  if (!Array.isArray(raw.instances) || raw.instances.length > FURNITURE_PLACEMENT_LIMITS.instances) {
    diagnostics.push(diagnostic('instances', 'Provide at most 128 explicit furniture instances.'));
    return { version: 1, instances, valid: false, diagnostics };
  }
  const seen = new Set();
  for (const [index, value] of raw.instances.entries()) {
    const issues = [];
    if (!plain(value)) issues.push(diagnostic('instance', 'This saved furniture instance is malformed.', index));
    const entry = plain(value) ? value : {};
    if (!id(entry.id)) issues.push(diagnostic('id', 'Use a unique furniture ID of 1–64 lowercase letters, numbers, underscores or hyphens.', index));
    else if (seen.has(entry.id)) issues.push(diagnostic('duplicate', 'Furniture instance IDs must be unique.', index));
    else seen.add(entry.id);
    for (const key of ['pack_id', 'asset_sha256']) if (!sha(entry[key])) issues.push(diagnostic(key, `${key} must be an exact lowercase full SHA256 identity.`, index));
    if (!id(entry.item_id)) issues.push(diagnostic('item_id', 'Choose an exact saved furniture item ID.', index));
    if (!floorId(entry.floor_id)) issues.push(diagnostic('floor_id', 'Choose an exact saved floor ID.', index));
    const position = {};
    for (const key of ['x', 'y', 'z']) {
      const number = key === 'z' && !own(entry, key) ? 0 : entry[key]; position[key] = number;
      if (!finite(number) || Math.abs(number) > FURNITURE_PLACEMENT_LIMITS.coordinate) issues.push(diagnostic(key, `${key.toUpperCase()} must be a finite number within ±1000 metres.`, index));
    }
    const rotation = own(entry, 'rotation_degrees') ? entry.rotation_degrees : 0, scale = own(entry, 'scale') ? entry.scale : 1;
    if (!finite(rotation)) issues.push(diagnostic('rotation_degrees', 'Rotation must be a finite number of degrees, positive anticlockwise.', index));
    if (!finite(scale) || scale < 0.05 || scale > 10) issues.push(diagnostic('scale', 'Uniform scale must be a finite number from 0.05 to 10.', index));
    instances.push({ id: entry.id, pack_id: entry.pack_id, item_id: entry.item_id, asset_sha256: entry.asset_sha256,
      floor_id: entry.floor_id, ...position, rotation_degrees: rotation, scale, valid: !issues.length, diagnostics: issues });
    diagnostics.push(...issues);
  }
  return { version: 1, instances, valid: !diagnostics.length, diagnostics };
}

export function resolveFurnitureAsset(catalogue, reference, index) {
  const issues = [], published = plain(catalogue) && catalogue.version === 1 && Array.isArray(catalogue.packs)
    && catalogue.packs.length <= FURNITURE_PLACEMENT_LIMITS.packs;
  const packs = published ? catalogue.packs.filter((pack) => plain(pack) && pack.pack_id === reference?.pack_id) : [];
  const pack = packs.length === 1 ? packs[0] : null;
  const items = pack && Array.isArray(pack.items) && pack.items.length <= FURNITURE_PLACEMENT_LIMITS.itemsPerPack
    ? pack.items.filter((item) => plain(item) && item.id === reference?.item_id) : [];
  let item = items.length === 1 ? items[0] : null;
  if (!published) issues.push(diagnostic('catalogue_unavailable', 'A current published furniture catalogue is not available.', index));
  else if (!pack || !sha(pack.pack_id)) issues.push(diagnostic('pack_unavailable', 'The exact saved pack is missing or ambiguous. No other pack is substituted.', index));
  else if (!item || !id(item.id) || item.pack_id !== reference.pack_id || item.sha256 !== reference.asset_sha256 || !sha(item.sha256)
    || item.unit !== 'm' || !Array.isArray(item.anchor) || item.anchor.length !== 3 || !item.anchor.every(finite)) {
    issues.push(diagnostic('item_unavailable', 'The exact item/hash/metre anchor is missing, ambiguous or changed. Relink it deliberately.', index)); item = null;
  }
  return { ready: issues.length === 0, pack, item, diagnostics: issues };
}

/** Resolve ONLY current published pack/item/hash membership and exact current
 * finite floor. World is SOURCE [east,elevation+aboveFloor,-north]. Asset anchors
 * remain original GLB-local metres; renderer applies those separately. No missing
 * floor ever receives a zero elevation. Same asset in another pack is not a relink.
 */
export function resolveFurniturePlacement(raw, { floors, catalogue } = {}) {
  const policy = readFurniturePlacement(raw), rows = [], diagnostics = [...policy.diagnostics];
  const currentFloors = Array.isArray(floors) ? floors : [];
  for (const [index, instance] of policy.instances.entries()) {
    const issues = [], matches = currentFloors.filter((floor) => plain(floor) && floor.id === instance.floor_id);
    let floor = matches.length === 1 ? matches[0] : null;
    if (!floor || !finite(floor.elevation) || Math.abs(floor.elevation) > FURNITURE_PLACEMENT_LIMITS.floorElevation
      || own(floor, 'stale') && floor.stale !== false) {
      issues.push(diagnostic('floor_unavailable', 'The exact current floor is missing, ambiguous, stale or has no finite elevation. Its saved ID is kept.', index)); floor = null;
    }
    const asset = resolveFurnitureAsset(catalogue, instance, index), { pack, item } = asset; issues.push(...asset.diagnostics);
    const ready = policy.valid && !!floor && !!pack && !!item && issues.length === 0;
    rows.push({ index, instance, pack, item, floor, ready, diagnostics: [...instance.diagnostics, ...issues],
      sourceWorld: ready ? [instance.x, floor.elevation + instance.z, -instance.y] : null,
      rotationRadians: ready ? (instance.rotation_degrees % 360) * Math.PI / 180 : null });
    diagnostics.push(...issues);
  }
  return { ...policy, rows, ready: policy.valid && rows.every((row) => row.ready), diagnostics };
}
