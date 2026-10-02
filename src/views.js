// Views: what each floor button shows. Pure: works on a node index built through the same adapter
// as the manifest, so it is testable without three.js.

const KINDS = ['all', 'level', 'role', 'room', 'zone', 'object', 'type', 'group', 'layer', 'node'];

export function parseSelector(s) {
  if (typeof s !== 'string' || !s) return null;
  if (s === 'all') return { kind: 'all', value: null };
  const i = s.indexOf(':');
  if (i < 1) return null;
  const kind = s.slice(0, i), value = s.slice(i + 1);
  return KINDS.includes(kind) && value ? { kind, value } : null;
}

const globCache = new Map();
function globRe(pattern) {
  let re = globCache.get(pattern);
  if (re) return re;
  const esc = (t) => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const segs = pattern.split('/').filter((seg, i, a) => !(seg === '**' && a[i - 1] === '**'));
  const body = segs.map((seg) => (seg === '**' ? '.*' : esc(seg).replace(/\*/g, '[^/]*'))).join('/')
    .replace(/\.\*\//g, '(?:.*/)?');
  re = new RegExp('^' + body + '$');
  globCache.set(pattern, re);
  return re;
}

export function nodeIndex(adapter, manifest) {
  const nodes = [];
  const walk = (node, parent, parentPath, levelId) => {
    const name = adapter.name(node);
    const path = parentPath ? `${parentPath}/${name}` : name;
    const entry = manifest.byNode.get(node) || null;
    const fp = (adapter.extras(node) || {}).fp || {};
    const layers = Array.isArray(fp.layer) ? fp.layer.filter((x) => typeof x === 'string') : typeof fp.layer === 'string' ? [fp.layer] : [];
    const tag = entry ? { kind: entry.kind, id: entry.id, role: entry.role || null, type: entry.type || null, group: entry.group || null } : null;
    const lvl = entry && entry.kind === 'level' ? entry.id : levelId;
    const i = nodes.length;
    nodes.push({ node, parent, children: [], path, name, layers, tag, levelId: lvl });
    if (parent >= 0) nodes[parent].children.push(i);
    for (const c of adapter.children(node)) walk(c, i, path, lvl);
  };
  for (const r of adapter.roots()) walk(r, -1, '', null);
  return { nodes };
}

export function matches(sel, info) {
  if (!sel) return false;
  const t = info.tag;
  switch (sel.kind) {
    case 'all': return true;
    case 'level': return !!t && t.kind === 'level' && t.id === sel.value;
    case 'role': return !!t && t.kind === 'level' && t.role === sel.value;
    case 'room': return !!t && t.kind === 'room' && t.id === sel.value;
    case 'zone': return !!t && t.kind === 'zone' && t.id === sel.value;
    case 'object': return !!t && t.kind === 'object' && t.id === sel.value;
    case 'type': return !!t && t.kind === 'object' && t.type === sel.value;
    case 'group': return !!t && t.kind === 'object' && t.group === sel.value;
    case 'layer': return info.layers.includes(sel.value);
    case 'node': return globRe(sel.value).test(info.path);
    default: return false;
  }
}

const ruleSel = (r) => parseSelector(r && (r.show ?? r.hide));

export function resolveVisibility(index, rules, defaultVisible = true) {
  const parsed = (rules || []).map((r) => ({ sel: ruleSel(r), show: r && r.show !== undefined }));
  // a rule applies to the matched node and cascades to its descendants; the latest rule in order wins
  const resolved = new Array(index.nodes.length);
  const decided = new Array(index.nodes.length); // index of the winning rule, -1 = none
  index.nodes.forEach((info, i) => {
    let d = info.parent >= 0 ? decided[info.parent] : -1;
    parsed.forEach((r, k) => { if (k > d && r.sel && matches(r.sel, info)) d = k; });
    decided[i] = d;
    resolved[i] = d >= 0 ? parsed[d].show : defaultVisible;
  });
  // a visible descendant keeps its ancestors on (their other children still use their own value)
  const effective = resolved.slice();
  for (let i = index.nodes.length - 1; i >= 0; i--) {
    if (effective[i]) for (let p = index.nodes[i].parent; p >= 0 && !effective[p]; p = index.nodes[p].parent) effective[p] = true;
  }
  return effective;
}

export function unmatchedSelectors(index, rules) {
  const out = [];
  for (const r of rules || []) {
    const s = r && (r.show ?? r.hide);
    const sel = parseSelector(s);
    if (typeof s === 'string' && (!sel || !index.nodes.some((n) => matches(sel, n)))) out.push(s);
  }
  return [...new Set(out)];
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.minY ?? 0) - (b.minY ?? 0);
const isStorey = (l) => l.role === 'storey' || l.role === 'basement';

export function modelViewRules(v) {
  const show = (v.show || []).map((s) => ({ show: s }));
  const hide = (v.hide || []).map((s) => ({ hide: s }));
  return show.length ? [{ hide: 'all' }, ...show, ...hide] : hide;
}

export function generatedViews(levels) {
  const storeys = levels.filter(isStorey).sort(byOrder);
  const out = storeys.map((l, i) => ({
    id: l.id, label: l.label || l.id,
    rules: [{ hide: 'all' }, ...storeys.slice(0, i + 1).map((s) => ({ show: 'level:' + s.id })), { show: 'role:exterior' }],
  }));
  out.push({ id: 'all', label: 'All', rules: [] });
  return out;
}

export function migrateShowModes(savedLevels) {
  const all = [], floorViews = [];
  for (const [id, b] of Object.entries(savedLevels || {})) {
    if (!b || typeof b !== 'object') continue;
    if (b.show === 'hidden') all.push({ hide: 'level:' + id });
    else if (b.show === 'always') all.push({ show: 'level:' + id });
    else if (b.show === 'all-only') floorViews.push({ hide: 'level:' + id });
  }
  return { all, floorViews };
}

// Per-view migrated rules: all-only levels stay visible in their own view; `only` levels are hidden
// in the views of lower storeys.
function migratedRules(viewId, mig, savedLevels, levels) {
  if (viewId === 'all') return mig.all;
  const order = new Map(levels.map((l) => [l.id, l.order ?? 0]));
  const own = order.get(viewId) ?? 0;
  const only = Object.entries(savedLevels || {})
    .filter(([id, b]) => b && b.show === 'only' && order.has(id) && own < order.get(id))
    .map(([id]) => ({ hide: 'level:' + id }));
  return [...mig.all, ...mig.floorViews.filter((r) => r.hide !== 'level:' + viewId), ...only];
}

const isCam = (c) => c && Array.isArray(c.position) && Array.isArray(c.target);
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});

const warned = new Set();

export function resolveViews({ manifest, haFloors, layoutViews, yamlViews, savedLevels }) {
  let base;
  haFloors = haFloors || [];
  const mLevels = (manifest && manifest.levels) || [];
  if (!manifest) {
    base = [...haFloors.map((f) => ({ id: f.id, label: f.name, rules: [], floors: [f.id], source: 'floors' })),
      { id: 'all', label: 'All', rules: [], floors: null, source: 'floors' }];
  } else if (manifest.views && manifest.views.length) {
    base = manifest.views.filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
      .map((v) => ({ id: v.id, label: v.label || v.id, rules: modelViewRules(v), camera: v.camera, floors: null, source: 'model' }));
  } else {
    const mig = migrateShowModes(savedLevels);
    base = generatedViews(mLevels).map((v) => ({
      ...v, floors: null, source: 'generated',
      rules: [...v.rules, ...migratedRules(v.id, mig, savedLevels, mLevels)],
    }));
  }
  const lv = obj(layoutViews), yv = obj(yamlViews);
  const added = Object.entries(lv).filter(([id, v]) => obj(v).added && !base.some((b) => b.id === id))
    .map(([id, v]) => ({ id, label: obj(v).label || id, rules: [], floors: null, source: 'added' }));
  const all = [...base, ...added];
  for (const id of Object.keys(yv)) {
    if (!all.some((b) => b.id === id) && !warned.has(id)) {
      warned.add(id);
      console.warn(`floorplan3d: card YAML views.${id} does not match any view; ignored`);
    }
  }
  return all.map((b) => {
    const l = obj(lv[b.id]), y = obj(yv[b.id]);
    const pick = (k, d) => (y[k] !== undefined ? y[k] : l[k] !== undefined ? l[k] : d);
    const rules = [...b.rules, ...(Array.isArray(l.rules) ? l.rules : []), ...(Array.isArray(y.rules) ? y.rules : [])].map((r) => ({ ...r }));
    const cam = isCam(y.camera) ? y.camera : isCam(l.camera) ? l.camera : b.camera;
    const camera = isCam(cam) ? { position: [...cam.position], target: [...cam.target] } : null;
    const fl = Array.isArray(y.floors) ? y.floors : Array.isArray(l.floors) ? l.floors : b.floors;
    const floors = Array.isArray(fl) ? [...fl] : null;
    return { id: b.id, label: pick('label', b.label), rules, camera, floors, cut: pick('cut', null), source: b.source, hidden: !!pick('hidden', false) };
  });
}

export function primaryLevel(index, effective, levels) {
  const visible = new Set(index.nodes.filter((n, i) => effective[i] && n.tag && n.tag.kind === 'level').map((n) => n.tag.id));
  const storeys = levels.filter((l) => isStorey(l) && visible.has(l.id)).sort(byOrder);
  return storeys.length ? storeys[storeys.length - 1].id : null;
}

export function defaultFloors(primaryLevelId, levelFloor) {
  const f = primaryLevelId && levelFloor[primaryLevelId];
  return f ? [f] : [];
}

export function markerState({ roomId, roomLevelId, markerFloorId }, ctx) {
  const order = ctx.levelOrder[roomLevelId];
  const fade = (lvlOrder) => lvlOrder !== undefined && ctx.primaryOrder !== null && lvlOrder < ctx.primaryOrder;
  if (roomId && ctx.visibleRooms.has(roomId)) return { shown: true, faded: fade(order) };
  // no room, or the room is hidden here: fall back to the marker's HA floor linked to the view
  const shown = ctx.isAll || ctx.viewFloors.has(markerFloorId);
  return { shown, faded: shown && !!roomId && fade(order) };
}

// Storey/basement levels bottom-up: level id -> 0, 1, 2…; other roles have no order.
export function levelOrders(levels) {
  const out = {};
  (levels || []).filter(isStorey).sort(byOrder).forEach((l, i) => { out[l.id] = i; });
  return out;
}

// An overview view (Exterior / All) shows every storey/basement level and the roof; a top-storey
// view that hides only the roof is still a storey view (prototype: "Attic shows only attic devices").
export function isOverview(index, effective, levels) {
  const storeys = new Set((levels || []).filter((l) => isStorey(l) || l.role === 'roof').map((l) => l.id));
  return index.nodes.every((n, i) => !(n.tag && n.tag.kind === 'level' && storeys.has(n.tag.id)) || effective[i]);
}

// HA floor id -> the lowest storey level bound to it (inverse of levelFloor).
export function floorLevels(levelFloor, levelOrder) {
  const out = {};
  for (const [lid, fid] of Object.entries(levelFloor || {})) {
    if (!fid || levelOrder[lid] === undefined) continue;
    if (out[fid] === undefined || levelOrder[lid] < levelOrder[out[fid]]) out[fid] = lid;
  }
  return out;
}

// markerState plus the view rules: an overview view shows everything markerState shows, unfaded;
// a storey view hides devices below its primary storey (roomless ones by their HA floor's level).
export function deviceState({ roomId, roomLevelId, markerFloorId, floorLevelId }, ctx) {
  const s = markerState({ roomId, roomLevelId, markerFloorId }, { ...ctx, isAll: !!ctx.overview });
  if (ctx.overview || !s.shown) return { shown: s.shown, faded: false };
  const ord = ctx.levelOrder[roomId ? roomLevelId : floorLevelId];
  const below = ord !== undefined && ctx.primaryOrder !== null && ctx.primaryOrder !== undefined && ord < ctx.primaryOrder;
  return { shown: !below, faded: false };
}

// Start view: config view_id, else config floor as a view id, else a view linked to that floor
// (only that floor first), else the fallback, else the first visible view.
export function defaultViewId(views, { viewId, floor, fallback } = {}, floorsOf = () => []) {
  const vis = (views || []).filter((v) => !v.hidden);
  const has = (id) => !!id && vis.some((v) => v.id === id);
  if (has(viewId)) return viewId;
  if (has(floor)) return floor;
  if (floor) {
    const fl = (v) => floorsOf(v) || [];
    const v = vis.find((x) => fl(x).length === 1 && fl(x)[0] === floor) || vis.find((x) => fl(x).includes(floor));
    if (v) return v.id;
  }
  if (has(fallback)) return fallback;
  return vis.length ? vis[0].id : null;
}

// Clip height for untagged models: the highest linked floor + the cut-away wall height. On by
// default except for the default "All" view; tagged models are never cut.
export function viewCut(view, { tagged, elevations, wallHeight }) {
  const on = view.cut ?? view.id !== 'all';
  if (tagged || !on || !elevations || !elevations.length) return null;
  return Math.max(...elevations) + Math.max(Number(wallHeight) || 0, 0.3);
}
