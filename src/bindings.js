// Bindings between a model's manifest and Home Assistant: which HA floor shows each level,
// which HA area each room/zone is. Saved choices live in layout.model.levels / .rooms; anything
// not saved is derived here, so re-exports and HA changes never need manual repair.

const SHOW = ['with', 'always', 'hidden', 'all-only'];

export function levelsFromFloorMap(map) {
  const out = {};
  for (const [id, v] of Object.entries(map || {})) out[id] = v === 'always' || v === 'hidden' ? { show: v } : { floor: v };
  return out;
}

export function migrateModel(model) {
  if (!model || !model.floor_map) return model;
  const { floor_map: fm, ...rest } = model;
  return { ...rest, levels: { ...levelsFromFloorMap(fm), ...(model.levels || {}) } };
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export function resolveLevels(levels, floors, saved = {}) {
  const ids = new Set(floors.map((f) => f.id));
  const out = {};
  const stale = new Set();
  for (const l of levels) {
    const s = saved[l.id];
    if (!s) continue;
    if (s.show && SHOW.includes(s.show) && s.show !== 'with') {
      out[l.id] = { show: s.show, floor: ids.has(s.floor) ? s.floor : null, auto: false };
    } else if (ids.has(s.floor)) {
      out[l.id] = { show: 'with', floor: s.floor, auto: false };
    } else {
      stale.add(l.id); // saved floor was deleted in HA: fall back to the defaults below
    }
  }
  for (const l of levels) if (!out[l.id] && ids.has(l.id)) out[l.id] = { show: 'with', floor: l.id, auto: true };

  const used = new Set(Object.values(out).map((v) => v.floor).filter(Boolean));
  const storeys = levels.filter((l) => !out[l.id] && (l.role === 'storey' || l.role === 'basement')).sort(byOrder);
  const free = floors.filter((f) => !used.has(f.id)).sort((a, b) => a.elevation - b.elevation);
  // align the model's order 0 with HA's floor at elevation 0 (a basement must not take the ground floor)
  const k = storeys.findIndex((l) => (l.order ?? null) === 0);
  const j = free.findIndex((f) => f.elevation === 0);
  const shift = k >= 0 && j >= 0 ? j - k : 0;
  storeys.forEach((l, i) => {
    const f = free[i + shift];
    out[l.id] = f ? { show: 'with', floor: f.id, auto: true } : { show: 'always', floor: null, auto: true };
  });

  // the exterior goes with the lowest above-ground storey's floor (not a basement)
  const storeyFloors = levels.filter((l) => (l.role === 'storey' || l.role === 'basement') && out[l.id] && out[l.id].floor)
    .map((l) => floors.find((f) => f.id === out[l.id].floor));
  const byElev = (a, b) => a.elevation - b.elevation;
  const ground = storeyFloors.filter((f) => f.elevation >= 0).sort(byElev)[0] || storeyFloors.sort(byElev)[0]
    || floors.slice().sort(byElev)[0];
  const groundFloor = ground ? ground.id : null;
  for (const l of levels) {
    if (out[l.id]) continue;
    if (l.role === 'roof') out[l.id] = { show: 'all-only', floor: null, auto: true };
    else if (l.role === 'exterior') out[l.id] = groundFloor ? { show: 'with', floor: groundFloor, auto: true } : { show: 'always', floor: null, auto: true };
    else out[l.id] = { show: 'always', floor: null, auto: true };
  }
  for (const id of stale) out[id] = { ...out[id], stale: true };
  return out;
}

export function resolveRoomAreas(rooms, areaIds, saved = {}) {
  const areas = new Set(areaIds);
  const out = {};
  for (const r of rooms) {
    const s = saved[r.id];
    if (s && 'area' in s && (s.area === null || areas.has(s.area))) { out[r.id] = { area: s.area, auto: false }; continue; }
    const sug = r.suggest && r.suggest.area;
    const area = sug && areas.has(sug) ? sug : areas.has(r.id) ? r.id : null;
    out[r.id] = s && 'area' in s ? { area, auto: true, stale: true } : { area, auto: true };
  }
  return out;
}

export function transformPoint([x, y], { position = [0, 0, 0], rotation = 0, scale = 1 } = {}) {
  const a = (rotation * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const px = x * scale, py = y * scale;
  return [px * c - py * s + (position[0] || 0), px * s + py * c + (position[1] || 0)];
}

export function modelRooms(rooms, levelAssign, roomAreas, align) {
  const out = [];
  for (const r of rooms) {
    const lv = levelAssign[r.level];
    if (!r.outline || !lv || !lv.floor) continue; // levels without an HA floor carry no rooms
    out.push({
      id: 'm:' + r.id, modelId: r.id, label: r.label,
      area_id: roomAreas[r.id] ? roomAreas[r.id].area : null,
      floor_id: lv.floor,
      polygon: r.outline.map((p) => transformPoint(p, align)),
      doors: (r.doors || []).map((p) => transformPoint(p, align)),
      outdoor: r.kind === 'zone',
      fromModel: true,
    });
  }
  return out;
}

export function combineRooms(drawn, fromModel) {
  const covered = new Set(fromModel.map((r) => r.area_id).filter(Boolean));
  return [...fromModel, ...(drawn || []).filter((r) => !covered.has(r.area_id))];
}

export function levelFloorOverrides(levels, levelAssign, { position = [0, 0, 0], scale = 1 } = {}) {
  const out = [];
  const done = new Set();
  for (const l of levels) {
    const a = levelAssign[l.id];
    if (l.role === 'exterior' || l.role === 'roof' || !a || a.show !== 'with' || !a.floor || done.has(a.floor)) continue;
    if (l.elevation === null || l.elevation === undefined) continue;
    done.add(a.floor);
    const o = { id: a.floor, elevation: Math.round((l.elevation * scale + (position[2] || 0)) * 1000) / 1000 };
    if (l.height) o.height = Math.round(l.height * scale * 1000) / 1000;
    out.push(o);
  }
  return out;
}

export function bindingDiff(manifest, model) {
  const one = (entries, saved) => {
    const ids = new Set(entries.map((e) => e.id));
    const keys = Object.keys(saved || {});
    return {
      kept: [...ids].filter((id) => keys.includes(id)),
      added: [...ids].filter((id) => !keys.includes(id)),
      missing: keys.filter((id) => !ids.has(id)),
    };
  };
  return { levels: one(manifest.levels, model && model.levels), rooms: one(manifest.rooms, model && model.rooms) };
}
