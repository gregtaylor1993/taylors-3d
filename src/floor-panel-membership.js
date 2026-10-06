// Read current exact ownership only. This helper does not change visibility,
// geometry, labels, readings, lights or the source model's authored hierarchy.
const id = (value) => typeof value === 'string' && value.trim().length > 0;
const array = (value) => Array.isArray(value) ? value : [];
const values = (value) => value instanceof Map ? value.values() : [];
const entries = (value) => value instanceof Map ? value.entries() : [];
const nodeOf = (value) => value?.isObject3D ? value : value?.node?.isObject3D ? value.node : null;
const renderable = (node) => node?.isObject3D && !node.isLight
  && (node.isMesh || node.isLine || node.isPoints || node.isSprite || node.isCSS2DObject);
const within = (node, root) => {
  const seen = new Set();
  for (let current = node; current && !seen.has(current); current = current.parent) {
    if (current === root) return true;
    seen.add(current);
  }
  return false;
};

/** Map<Object3D, exact floor ID|null>. Null is unresolved/conflicting, or an
 * explicit background node. Non-enumerable diagnostics explain those cases.
 * Lights are never visibility participants: their fixed pool stays allocated.
 * A separate non-enumerable authoredLights map journals source-model intensity.
 */
export function floorPanelParticipants(view, context = {}) {
  const result = new Map(), authoredLights = new Map(), diagnostics = [], claims = new Map(), conflicts = new Set();
  const modelRoot = view?.model?.root, objectLayer = view?.objectLayer;
  const sharedLights = new Set([view?.hemi, view?.sun, view?.moonLight,
    ...array(objectLayer?.pool?.points), ...array(objectLayer?.pool?.spots),
    ...[...values(objectLayer?._slots)].map((slot) => slot?.light)]);
  const authoredLight = (node) => node?.isObject3D && node.isLight && modelRoot?.isObject3D
    && !sharedLights.has(node) && within(node, modelRoot);
  const floors = array(Array.isArray(view?._floorOptions?.floors) ? view._floorOptions.floors : view?.floors);
  const known = new Map();
  for (const floor of floors) if (id(floor?.id)) {
    const matches = known.get(floor.id) || []; matches.push(floor); known.set(floor.id, matches);
  }
  const note = (code, source, node, floorId, message) => diagnostics.push({ code, source, node, floorId, message });
  const resolve = (floorId, source, node) => {
    if (!id(floorId)) { note('missing_floor', source, node, floorId, 'This participant has no exact floor reference.'); return null; }
    const matches = known.get(floorId) || [];
    if (!matches.length) { note('unknown_floor', source, node, floorId, 'This exact floor is not present in the current resolved floors.'); return null; }
    if (matches.length !== 1) { note('ambiguous_floor', source, node, floorId, 'This exact floor ID occurs more than once.'); return null; }
    if (matches[0].stale === true) { note('stale_floor', source, node, floorId, 'This exact floor is marked stale.'); return null; }
    if (!Number.isFinite(matches[0].elevation) || Object.hasOwn(matches[0], 'stale') && matches[0].stale !== false) {
      note('invalid_floor', source, node, floorId, 'This current floor does not have a finite, non-stale resolved elevation.'); return null;
    }
    return floorId;
  };
  const add = (node, floorId, source, background = false, destination = result) => {
    if (!node?.isObject3D || node.isLight && (destination !== authoredLights || !authoredLight(node))) return;
    const floor = background ? null : resolve(floorId, source, node), raw = background ? null : floorId;
    const previous = claims.get(node);
    if (previous && (previous.raw !== raw || previous.floor !== floor)) {
      if (!conflicts.has(node)) note('conflicting_ownership', source, node, floorId, 'This node has conflicting exact floor/background owners.');
      conflicts.add(node); destination.set(node, null); return;
    }
    if (!previous) claims.set(node, { floor, raw });
    destination.set(node, conflicts.has(node) ? null : floor);
    if (background && !previous) note('background', source, node, null, 'This node is explicitly assigned to background, not to a floor.');
  };
  const addPart = (part, floorId, source, names) => {
    for (const name of names) add(part?.[name], floorId, source);
  };
  const modelFloor = (node, source) => {
    if (!node?.isObject3D) return undefined;
    try { return view?.floorForModelNode?.(node); }
    catch { note('model_floor_unreadable', source, node, undefined, 'The current model floor owner could not be read.'); return undefined; }
  };

  for (const row of array(view?.cssObjects)) add(row?.obj, row?.floorId, 'view.cssObjects');
  for (const row of values(view?.markerObjects)) add(row?.obj, row?.floorId, 'view.markerObjects');
  for (const row of values(view?.glows)) add(row?.mesh, row?.floorId, 'view.glows');
  for (const node of array(view?.staticGroup?.children)) add(node, node?.userData?.floorId, 'view.staticGroup');
  for (const node of array(view?.overlayGroup?.children)) add(node, node?.userData?.floorId, 'view.overlayGroup');
  add(view?.trail, view?.trail?.userData?.floorId, 'view.trail');
  add(view?.mapPlane, view?.mapPlane?.userData?.floorId, 'view.mapPlane');
  for (const [markerId, stem] of entries(view?.stems)) {
    const floorId = view?.markerObjects?.get?.(markerId)?.floorId;
    addPart(stem, floorId, 'view.stems', ['line', 'disc']);
  }
  const modelNodes = new Set(), background = new Set(), overrides = new Map(), objectFloors = new Map();
  const collect = (root, destination) => {
    if (!root?.isObject3D) return;
    root.traverse((node) => { if (renderable(node) || authoredLight(node)) { modelNodes.add(node); destination?.add(node); } });
  };
  for (const row of array(view?._floorOptions?.targets)) collect(row?.node);
  for (const candidate of array(view?._floorOptions?.backgroundNodes)) collect(nodeOf(candidate), background);
  // Include unclassified source lights too: they must not illuminate every pane.
  // This current-root scan happens once with the frame, never once per pane.
  modelRoot?.traverse?.((node) => { if (authoredLight(node)) modelNodes.add(node); });
  const pose = objectLayer?._pose;
  for (const prepared of values(view?.objectLayer?.parts)) {
    const part = prepared?.part, object = prepared?.obj?.node;
    let floorId = modelFloor(object, 'objects');
    if (part?.displayFloorId !== undefined && part.displayFloorId !== null) {
      floorId = resolve(part.displayFloorId, 'objects.measured', object);
      const current = typeof prepared?.type?.place === 'function' && part.origin && Number.isFinite(part.origin.localY)
        && pose && pose.floorId === part.displayFloorId && Number.isFinite(pose.x) && Number.isFinite(pose.y)
        && object?.isObject3D && view?.model?.root?.isObject3D && within(object, view.model.root);
      if (!current) { note('stale_measured_override', 'objects.measured', object, part.displayFloorId,
        'This saved display-floor stamp is not backed by the current measured actor pose.'); floorId = null; }
      if (object?.isObject3D && view?.model?.root?.isObject3D && within(object, view.model.root)) object.traverse((node) => {
        if (!renderable(node) && !authoredLight(node)) return;
        modelNodes.add(node); const owners = overrides.get(node) || []; owners.push({ floorId }); overrides.set(node, owners);
      });
    }
    objectFloors.set(prepared, floorId);
  }
  for (const node of modelNodes) {
    const owners = overrides.get(node), destination = node.isLight ? authoredLights : result;
    if (owners?.length > 1) {
      note('ambiguous_measured_override', 'model', node, undefined, 'Several current actor parts claim this same model descendant.');
      add(node, undefined, 'model', false, destination);
    } else if (owners?.length === 1) add(node, owners[0].floorId, 'model.measured', false, destination);
    else if (background.has(node)) {
      const floor = modelFloor(node, 'model.background');
      add(node, null, 'view.background', true, destination);
      if (id(floor)) add(node, floor, 'model', false, destination); // explicit background/floor conflict fails closed
    } else add(node, modelFloor(node, 'model'), 'model', false, destination);
  }
  for (const prepared of values(view?.objectLayer?.parts)) {
    const part = prepared?.part, floorId = objectFloors.get(prepared);
    addPart(part, floorId, 'objects', ['label', 'glow']);
  }
  for (const part of values(context?.trackingLayer?.parts))
    addPart(part, part?.group?.userData?.floorId, 'tracking', ['group', 'mesh', 'label']);
  for (const part of values(context?.cameraCoverage?.sectors))
    addPart(part, part?.group?.userData?.floorId, 'cameraCoverage', ['group', 'fill', 'outline', 'rays']);
  for (const part of values(context?.furnitureLayer?.parts))
    addPart(part, part?.row?.floorId, 'furniture', ['group', 'offset', 'model']);

  // The complete key is made from exact descriptors. A colon in either ID is
  // legal: splitting a stored key would falsely assign one floor to another.
  const roomOwners = new Map();
  for (const row of array(context?.rooms)) {
    const roomId = row?.room?.id ?? row?.id, floorId = row?.floorId;
    if (!id(roomId) || !id(floorId)) continue;
    const key = `${floorId}:${roomId}`, owners = roomOwners.get(key) || new Set(); owners.add(floorId); roomOwners.set(key, owners);
  }
  for (const [key, part] of entries(context?.statusOverlays?.rooms)) {
    const owners = roomOwners.get(key), floorId = owners?.size === 1 ? owners.values().next().value : undefined;
    if (owners?.size > 1) note('ambiguous_room_key', 'status.rooms', part?.mesh, undefined, 'Different exact floor/room pairs produce the same stored overlay key.');
    else if (!owners) note('unmapped_room_overlay', 'status.rooms', part?.mesh, undefined, 'This overlay has no matching current complete room descriptor.');
    addPart(part, floorId, 'status.rooms', ['mesh', 'label']);
  }
  const alertOwners = new Map();
  for (const alert of array(context?.alerts)) if (id(alert?.id)) {
    const owners = alertOwners.get(alert.id) || []; owners.push(alert); alertOwners.set(alert.id, owners);
  }
  for (const [alertId, part] of entries(context?.statusOverlays?.alerts)) {
    const owners = alertOwners.get(alertId) || [], floorId = owners.length === 1 ? owners[0]?.location?.floorId : undefined;
    if (owners.length !== 1) note(owners.length ? 'ambiguous_alert' : 'unmapped_alert', 'status.alerts', part?.mesh, undefined,
      'This alert part does not have one exact current alert record.');
    addPart(part, floorId, 'status.alerts', ['mesh', 'label']);
  }
  for (const part of values(context?.planSecurityLayer?.parts))
    addPart(part, part?.record?.location?.floorId, 'planSecurity', ['group', 'ring', 'glyph', 'label']);
  for (const part of values(context?.securityLayer?.parts)) {
    const object = nodeOf(part?.object) || nodeOf(part?.target), floorId = modelFloor(object, 'modelSecurity');
    for (const line of array(part?.lines)) add(line, floorId, 'modelSecurity');
  }
  Object.defineProperty(result, 'diagnostics', { value: Object.freeze(diagnostics), enumerable: false });
  Object.defineProperty(result, 'authoredLights', { value: authoredLights, enumerable: false });
  return result;
}
