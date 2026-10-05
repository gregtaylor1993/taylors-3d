// Display-only copies for feature layers. Saved locations, readings, mini-map
// positions and tracking/calibration inputs keep their SOURCE coordinates.
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const vector = (value, count) => Array.isArray(value) && value.length === count && value.every(finite);
const active = (report) => report?.valid === true && ['horizontal', 'vertical'].includes(report.mode);

export function floorDisplayOffset(report, floorId, floors = []) {
  if (!active(report)) return [0, 0, 0];
  const matches = Array.isArray(floors) ? floors.filter((floor) => floor?.id === floorId && finite(floor.elevation) && !floor.stale) : [];
  if (matches.length !== 1) return null;
  const rows = (Array.isArray(report.rows) ? report.rows : []).filter((row) => row?.floor_id === floorId);
  if (rows.length === 0) return [0, 0, 0]; // A known unselected floor remains assembled.
  return rows.length === 1 && vector(rows[0].offset, 3) ? rows[0].offset.slice() : null;
}

export function displayPlanPosition(position, report, floors) {
  if (!active(report)) return position;
  const offset = floorDisplayOffset(report, position?.floorId, floors);
  if (!position || !offset || ![position.x, position.y, position.elevation].every(finite)) return null;
  if (offset.every((value) => value === 0)) return position;
  return { ...position, x: position.x + offset[0], y: position.y - offset[2], elevation: position.elevation + offset[1] };
}

export function displayFloorFootprint(footprint, report, floors) {
  if (!active(report)) return footprint;
  const offset = floorDisplayOffset(report, footprint?.floorId, floors);
  if (!footprint || !offset || !finite(footprint.elevation) || !Array.isArray(footprint.polygon)
    || !footprint.polygon.every((point) => Array.isArray(point) && point.length >= 2 && finite(point[0]) && finite(point[1]))) return null;
  if (offset.every((value) => value === 0)) return footprint;
  const result = { ...footprint, elevation: footprint.elevation + offset[1],
    polygon: footprint.polygon.map((point) => [point[0] + offset[0], point[1] - offset[2], ...point.slice(2)]) };
  if (vector(footprint.center, 2)) result.center = [footprint.center[0] + offset[0], footprint.center[1] - offset[2]];
  return result;
}

export function displayLocatedRecords(records, report, floors, { snap = false } = {}) {
  if (!active(report)) return records;
  return records.map((record) => {
    if (!record?.location) return record;
    const location = displayPlanPosition(record.location, report, floors);
    if (!location) return { ...record, shown: false, location: null };
    if (location === record.location && !snap) return record;
    return { ...record, location, ...(snap ? { transitionMs: 0 } : {}) };
  });
}

export function displayCameraAnchors(anchors, report, floors) {
  if (!active(report)) return anchors;
  return anchors.map((anchor) => {
    const position = displayPlanPosition(anchor.position, report, floors);
    return position ? position === anchor.position ? anchor : { ...anchor, position } : { ...anchor, shown: false, position: null };
  });
}

export function translateFloorCamera(camera, report, floorId, floors, { toSource = false, top = false } = {}) {
  if (!camera || !active(report)) return camera;
  const offset = floorDisplayOffset(report, floorId, floors);
  if (!offset) return null;
  if (offset.every((value) => value === 0)) return camera;
  const sign = toSource ? -1 : 1;
  if (top) {
    if (!vector(camera.center, 2)) return null;
    return { ...camera, center: [camera.center[0] + sign * offset[0], camera.center[1] - sign * offset[2]] };
  }
  if (!vector(camera.position, 3) || !vector(camera.target, 3)) return null;
  return { ...camera, position: camera.position.map((value, index) => value + sign * offset[index]),
    target: camera.target.map((value, index) => value + sign * offset[index]) };
}
