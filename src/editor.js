// Pure edit operations on the layout. Every function returns new objects (the card compares
// layout identity to decide what to rebuild) and never mutates its input.

import { snap } from './placement.js';
import { normalise } from './storage.js';

export const GRID = 0.05;
export const SNAP_RADIUS = 0.25;

const round = (v) => Math.round(v * 1000) / 1000;

// Snap a plan point: to an existing vertex within radius, else align x / y with a nearby
// vertex (straight walls), else to the grid.
export function snapPoint(p, { vertices = [], radius = SNAP_RADIUS, grid = GRID } = {}) {
  let best = null, bestD = radius;
  for (const v of vertices) {
    const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
    if (d <= bestD) { best = v; bestD = d; }
  }
  if (best) return { point: [best[0], best[1]], kind: 'vertex' };
  let x = round(snap(p[0], grid)), y = round(snap(p[1], grid));
  let ax = radius, ay = radius, aligned = false;
  for (const v of vertices) {
    const dx = Math.abs(v[0] - p[0]), dy = Math.abs(v[1] - p[1]);
    if (dx < ax) { ax = dx; x = v[0]; aligned = true; }
    if (dy < ay) { ay = dy; y = v[1]; aligned = true; }
  }
  return { point: [x, y], kind: aligned ? 'align' : 'grid' };
}

// All room vertices on one floor, for snapping. `skip` = {roomId, index} to leave out.
export function floorVertices(rooms, floorIdOf, floorId, skip) {
  const out = [];
  for (const r of rooms) {
    if (floorIdOf(r) !== floorId || !r.polygon) continue;
    r.polygon.forEach((v, i) => {
      if (!skip || skip.roomId !== r.id || skip.index !== i) out.push(v);
    });
  }
  return out;
}

export function nearestEdge(poly, p) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const q = [a[0] + dx * t, a[1] + dy * t];
    const dist = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!best || dist < best.dist) best = { index: i, point: q, t, dist };
  }
  return best;
}

// ---------- rooms ----------
export function newRoomId(layout) {
  const ids = new Set((layout.rooms || []).map((r) => r.id));
  let n = 1;
  while (ids.has('r' + n)) n++;
  return 'r' + n;
}

export function upsertRoom(layout, room) {
  const rooms = layout.rooms || [];
  const i = rooms.findIndex((r) => r.id === room.id);
  return { ...layout, rooms: i === -1 ? [...rooms, room] : rooms.map((r, j) => (j === i ? room : r)) };
}

export function deleteRoom(layout, id) {
  return { ...layout, rooms: (layout.rooms || []).filter((r) => r.id !== id) };
}

export function moveVertex(room, i, p) {
  return { ...room, polygon: room.polygon.map((v, j) => (j === i ? [p[0], p[1]] : v)) };
}

export function insertVertex(room, edgeIndex, p) {
  const polygon = [...room.polygon];
  polygon.splice(edgeIndex + 1, 0, [p[0], p[1]]);
  return { ...room, polygon };
}

export function removeVertex(room, i) {
  if (room.polygon.length <= 3) return room;
  return { ...room, polygon: room.polygon.filter((_, j) => j !== i) };
}

// Door on the nearest edge, if the click is within maxDist of it.
export function addDoor(room, p, maxDist = 0.6) {
  const e = nearestEdge(room.polygon, p);
  if (!e || e.dist > maxDist) return room;
  const door = [round(snap(e.point[0], GRID)), round(snap(e.point[1], GRID))];
  // snapping can pull the door off a diagonal wall, keep the exact projection then
  const d = nearestEdge(room.polygon, door).dist < 0.02 ? door : e.point.map(round);
  return { ...room, doors: [...(room.doors || []), d] };
}

export function removeDoor(room, i) {
  return { ...room, doors: (room.doors || []).filter((_, j) => j !== i) };
}

// Drop consecutive duplicates and a closing point equal to the first.
export function cleanPolygon(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const [f, l] = [out[0], out[out.length - 1]];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) out.pop();
  }
  return out;
}

// ---------- devices ----------
export function setPin(layout, id, pin) {
  const p = { x: round(snap(pin.x, GRID)), y: round(snap(pin.y, GRID)), z: round(pin.z), floor_id: pin.floor_id };
  return { ...layout, pins: { ...(layout.pins || {}), [id]: p } };
}

export function clearPin(layout, id) {
  const pins = { ...(layout.pins || {}) };
  delete pins[id];
  return { ...layout, pins };
}

export function hide(layout, id) {
  const hidden = layout.hidden || [];
  return hidden.includes(id) ? layout : { ...layout, hidden: [...hidden, id] };
}

export function unhide(layout, id) {
  return { ...layout, hidden: (layout.hidden || []).filter((h) => h !== id) };
}

// ---------- floors ----------
// Stored floor entries are overrides for HA floors or standalone floors.
export function upsertFloor(layout, floor) {
  const floors = layout.floors || [];
  const i = floors.findIndex((f) => f.id === floor.id);
  const merged = i === -1 ? floor : { ...floors[i], ...floor };
  return { ...layout, floors: i === -1 ? [...floors, merged] : floors.map((f, j) => (j === i ? merged : f)) };
}

export function deleteFloor(layout, id) {
  return { ...layout, floors: (layout.floors || []).filter((f) => f.id !== id) };
}

export function newFloorId(layout, floors) {
  const ids = new Set([...(layout.floors || []), ...floors].map((f) => f.id));
  let n = 1;
  while (ids.has('floor_' + n)) n++;
  return 'floor_' + n;
}

// ---------- import ----------
const isPoint = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Not valid JSON: ' + e.message, { cause: e });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a layout object');
  if (data.version !== undefined && data.version !== 1) throw new Error('Unsupported layout version ' + data.version);
  const l = normalise(data);
  l.rooms.forEach((r, i) => {
    if (!r || typeof r !== 'object') throw new Error(`Room ${i + 1} is not an object`);
    if (!Array.isArray(r.polygon) || r.polygon.length < 3 || !r.polygon.every(isPoint)) {
      throw new Error(`Room ${r.id || i + 1}: polygon needs at least 3 [x, y] points`);
    }
    if (r.doors !== undefined && (!Array.isArray(r.doors) || !r.doors.every(isPoint))) {
      throw new Error(`Room ${r.id || i + 1}: doors must be [x, y] points`);
    }
  });
  const ids = new Set();
  l.rooms = l.rooms.map((r) => {
    let id = r.id || 'r';
    while (ids.has(id)) id += '_';
    ids.add(id);
    return { ...r, id };
  });
  for (const f of l.floors) if (!f || !f.id) throw new Error('Every floor needs an id');
  return l;
}

// Fit an imported layout to this Home Assistant: floor ids HA doesn't have are mapped bottom-up
// onto unused HA floors (rooms, pins and floor overrides follow); floors left over stay as
// layout floors. haFloors: [{id, elevation}] from HA only.
// Returns { layout, floorMap: {imported: haId}, unknownAreas: [...] }.
export function fitImport(layout, haFloors, haAreaIds) {
  const ha = new Set(haFloors.map((f) => f.id));
  const imported = layout.floors || [];
  const used = new Set(imported.filter((f) => ha.has(f.id)).map((f) => f.id));
  for (const r of layout.rooms) if (ha.has(r.floor_id)) used.add(r.floor_id);
  const free = haFloors.filter((f) => !used.has(f.id)).sort((a, b) => a.elevation - b.elevation);
  const foreign = imported.filter((f) => !ha.has(f.id)).sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
  const floorMap = {};
  foreign.forEach((f, i) => { if (free[i]) floorMap[f.id] = free[i].id; });
  const mapId = (id) => floorMap[id] || id;
  const floors = imported.map((f) => (floorMap[f.id] ? { ...f, id: floorMap[f.id], name: undefined } : f))
    .map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
  const rooms = layout.rooms.map((r) => (r.floor_id && floorMap[r.floor_id] ? { ...r, floor_id: mapId(r.floor_id) } : r));
  const pins = Object.fromEntries(Object.entries(layout.pins || {}).map(([k, p]) => [k, p.floor_id && floorMap[p.floor_id] ? { ...p, floor_id: mapId(p.floor_id) } : p]));
  const areas = new Set(haAreaIds);
  const unknownAreas = [...new Set(layout.rooms.map((r) => r.area_id).filter((a) => a && !areas.has(a)))];
  return { layout: { ...layout, floors, rooms, pins }, floorMap, unknownAreas };
}
