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

// Path segments escape \\ * / # in names with a backslash; a name shared by several siblings gets
// "#<n>" (0-based among them) so every node path is unique.
export const escapeName = (name) => String(name).replace(/[\\*/#]/g, '\\$&');

const globCache = new Map();
function globRe(pattern) {
  let re = globCache.get(pattern);
  if (re) return re;
  const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  // split on unescaped '/', keeping escapes inside segments
  const segs = [];
  let cur = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) { cur += c + pattern[++i]; continue; }
    if (c === '/') { segs.push(cur); cur = ''; continue; }
    cur += c;
  }
  segs.push(cur);
  const segRe = (seg) => {
    let out = '';
    for (let i = 0; i < seg.length; i++) {
      const c = seg[i];
      if (c === '\\' && i + 1 < seg.length) out += reEsc(c + seg[++i]); // literal (paths keep the escape)
      else if (c === '*') out += '(?:\\\\.|[^/\\\\])*';
      else out += reEsc(c);
    }
    return out;
  };
  const list = segs.filter((seg, i, a) => !(seg === '**' && a[i - 1] === '**'));
  let body = '';
  list.forEach((seg, i) => {
    const last = i === list.length - 1;
    if (seg === '**') body += last ? '.*' : '(?:.*/)?';
    else body += segRe(seg) + (last ? '' : '/');
  });
  re = new RegExp('^' + body + '$');
  globCache.set(pattern, re);
  return re;
}

export function nodeIndex(adapter, manifest) {
  const nodes = [];
  // unique path segment per sibling list
  const segments = (list) => {
    const names = list.map((n) => adapter.name(n));
    const count = new Map(), seen = new Map();
    for (const n of names) count.set(n, (count.get(n) || 0) + 1);
    return names.map((n) => {
      if (count.get(n) < 2) return { seg: escapeName(n), dup: null };
      const k = seen.get(n) || 0;
      seen.set(n, k + 1);
      return { seg: escapeName(n) + '#' + k, dup: k };
    });
  };
  const walk = (node, parent, parentPath, levelId, { seg, dup }) => {
    const name = adapter.name(node);
    const path = parentPath ? `${parentPath}/${seg}` : seg;
    const entry = manifest.byNode.get(node) || null;
    const fp = (adapter.extras(node) || {}).fp || {};
    const layers = Array.isArray(fp.layer) ? fp.layer.filter((x) => typeof x === 'string') : typeof fp.layer === 'string' ? [fp.layer] : [];
    const tag = entry ? { kind: entry.kind, id: entry.id, role: entry.role || null, type: entry.type || null, group: entry.group || null } : null;
    const lvl = entry && entry.kind === 'level' ? entry.id : levelId;
    const i = nodes.length;
    nodes.push({ node, parent, children: [], path, name, dup, layers, tag, levelId: lvl });
    if (parent >= 0) nodes[parent].children.push(i);
    const kids = adapter.children(node);
    const segs = segments(kids);
    kids.forEach((c, k) => walk(c, i, path, lvl, segs[k]));
  };
  const roots = adapter.roots();
  const rootSegs = segments(roots);
  roots.forEach((r, k) => walk(r, -1, '', null, rootSegs[k]));
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
      .map((v) => ({ id: v.id, label: v.label || v.id, rules: modelViewRules(v), camera: v.camera, floors: null, source: 'model', section: v.section }));
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
    const section = normSection(y.section !== undefined ? y.section : l.section);
    return { id: b.id, label: pick('label', b.label), rules, camera, floors, cut: pick('cut', null), source: b.source, hidden: !!pick('hidden', false),
      section, modelSection: normSection(b.section) };
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

// ---------- edit mode: per-view rule edits, element tree, picks, order ----------

const selOf = (r) => (r ? r.show ?? r.hide : undefined);

// 'shown' | 'hidden' | 'default' for a selector in a rule list (the last rule for it wins).
export function ruleState(rules, sel) {
  let s = 'default';
  for (const r of rules || []) if (selOf(r) === sel) s = r.show !== undefined ? 'shown' : 'hidden';
  return s;
}

// Drop every rule for the selector, then append the new one ('default' appends nothing).
export function setRuleState(rules, sel, state) {
  const out = (rules || []).filter((r) => selOf(r) !== sel).map((r) => ({ ...r }));
  if (state === 'shown') out.push({ show: sel });
  else if (state === 'hidden') out.push({ hide: sel });
  return out;
}

export const nextEyeState = (s) => ({ default: 'shown', shown: 'hidden' }[s] || 'default');

const TAG_SEL = { level: 'level', room: 'room', zone: 'zone', object: 'object' };

// Rows for the Views tab: tree (levels -> rooms/zones -> objects), layers, untagged model groups
// (named nodes with children, at most two levels below a level or the model root).
// Each row: { sel, label, depth, nodes: [index positions], path? }.
export function viewTree(index, labels = {}) {
  const nodes = index.nodes;
  const rows = new Map(); // sel -> row (several nodes may carry the same tag)
  const row = (sel, i, depth, extra) => {
    let r = rows.get(sel);
    if (r) { r.nodes.push(i); return null; }
    r = { sel, label: labels[sel] || nodes[i].name || sel, depth, nodes: [i], parent: null, children: 0, ...extra };
    rows.set(sel, r);
    return r;
  };
  const nearest = (i, kinds) => {
    for (let p = nodes[i].parent; p >= 0; p = nodes[p].parent) if (nodes[p].tag && kinds.includes(nodes[p].tag.kind)) return p;
    return -1;
  };
  const sel = (n) => TAG_SEL[n.tag.kind] + ':' + n.tag.id;
  const tagged = (kinds) => nodes.map((n, i) => i).filter((i) => nodes[i].tag && kinds.includes(nodes[i].tag.kind));
  const levels = tagged(['level']), places = tagged(['room', 'zone']), objects = tagged(['object']);
  const tree = [];
  const push = (r) => { if (r) tree.push(r); };
  const objectsUnder = (p, depth, parent) => objects.filter((o) => nearest(o, ['room', 'zone', 'level']) === p).forEach((o) => {
    const r = row(sel(nodes[o]), o, depth, { parent: parent ? parent.sel : null });
    push(r);
    if (r && parent) parent.children++;
  });
  const placesUnder = (lv, depth, parent) => places.filter((p) => nearest(p, ['level']) === lv).forEach((p) => {
    const r = row(sel(nodes[p]), p, depth, { parent: parent ? parent.sel : null });
    push(r);
    if (r && parent) parent.children++;
    objectsUnder(p, depth + 1, r);
  });
  for (const lv of levels) {
    const r = row(sel(nodes[lv]), lv, 0);
    if (!r) continue;
    push(r);
    placesUnder(lv, 1, r);
    objectsUnder(lv, 1, r);
  }
  placesUnder(-1, 0, null); // rooms/zones outside any level
  objectsUnder(-1, 0, null);

  const layers = [];
  nodes.forEach((n, i) => n.layers.forEach((name) => {
    const r = row('layer:' + name, i, 0);
    if (r) layers.push(r);
  }));

  const depth = new Array(nodes.length);
  const groups = [];
  nodes.forEach((n, i) => {
    depth[i] = n.tag && n.tag.kind === 'level' ? 0 : (n.parent >= 0 ? depth[n.parent] : 0) + 1;
    if (!n.tag && n.name && n.children.length && depth[i] <= 2) {
      const r = row('node:' + n.path, i, depth[i] - 1, { path: n.path, label: n.dup === null || n.dup === undefined ? n.name : `${n.name} #${n.dup + 1}` });
      if (r) groups.push(r);
    }
  });
  return { tree, layers, groups };
}

// Selector for a click in 3D: a tagged room/zone/object owner by its tag; otherwise (untagged, or
// inside a level) the nearest named group with children above the hit node, not past the owning
// level; a mesh directly in a level picks the mesh. hitIdx = index position of the hit node.
export function pickSelector(index, hitIdx, owner) {
  const nodes = index.nodes;
  if (!(hitIdx >= 0 && hitIdx < nodes.length)) return null;
  const ownerIdx = owner && owner.node ? nodes.findIndex((n) => n.node === owner.node) : -1;
  if (owner && ownerIdx >= 0 && TAG_SEL[owner.kind] && (owner.kind !== 'level' || ownerIdx === hitIdx)) {
    return { sel: TAG_SEL[owner.kind] + ':' + owner.id, idx: ownerIdx };
  }
  for (let p = nodes[hitIdx].parent; p >= 0 && p !== ownerIdx; p = nodes[p].parent) {
    if (nodes[p].name && nodes[p].children.length) return { sel: 'node:' + nodes[p].path, idx: p };
  }
  return { sel: 'node:' + nodes[hitIdx].path, idx: hitIdx };
}

// Views sorted by a stored id order; ids not in it keep their relative place after the ordered ones.
export function orderViews(views, order) {
  const pos = new Map((Array.isArray(order) ? order : []).map((id, i) => [id, i]));
  const n = pos.size + 1;
  return (views || []).map((v, i) => [v, pos.has(v.id) ? pos.get(v.id) : n + i]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
}

export function nextViewId(ids) {
  const used = new Set(ids || []);
  let n = 1;
  while (used.has('view_' + n)) n++;
  return { id: 'view_' + n, n };
}

// A level's legacy show mode (layout.model.levels[id].show) as layout rules: the same rules the
// migration adds to generated views, put before each view's own layout rules. Used before the
// "belongs to HA floor" dropdown drops the show mode. Returns layoutViews unchanged when there is none.
export function legacyShowRules(layoutViews, views, levelId, savedLevels, levels) {
  const b = (savedLevels || {})[levelId];
  if (!b || typeof b !== 'object' || !['hidden', 'always', 'all-only', 'only'].includes(b.show)) return layoutViews;
  const one = { [levelId]: b };
  const mig = migrateShowModes(one);
  const out = { ...(layoutViews || {}) };
  let changed = false;
  for (const v of views || []) {
    if (v.source !== 'generated') continue;
    const add = migratedRules(v.id, mig, one, levels || []);
    if (!add.length) continue;
    const cur = obj(out[v.id]);
    out[v.id] = { ...cur, rules: [...add.map((r) => ({ ...r })), ...(Array.isArray(cur.rules) ? cur.rules : [])] };
    changed = true;
  }
  return changed ? out : layoutViews;
}

// ---------- side section: one vertical clipping plane ----------
// A plane is { normal: [x, y, z], constant } in card world (three.js Plane: n·p + constant = 0);
// points with n·p + constant >= 0 are kept, the rest is cut away.

const z0 = (x) => x + 0; // no -0

// A valid section (finite numbers, normal length > 0) with a unit normal, or null.
export function normSection(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.normal) || s.normal.length !== 3) return null;
  const n = s.normal, c = s.constant;
  if (!n.every((x) => typeof x === 'number' && Number.isFinite(x)) || typeof c !== 'number' || !Number.isFinite(c)) return null;
  const len = Math.hypot(...n);
  if (!(len > 1e-9)) return null;
  return { normal: n.map((x) => z0(x / len)), constant: z0(c / len) };
}

// box: { min: [x, y, z], max: [x, y, z] } (card world)
const centre = (box) => box.min.map((v, i) => (v + box.max[i]) / 2);
export const sectionSide = (plane, p) => plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] + plane.constant;

// The view's cut: layout / YAML section (card world), else the model's (model space; toWorld maps it
// into card world), else normal (-1,0,0) through the box centre x (keeps the west half).
export function sectionPlane(view, box, toWorld = (p) => p) {
  const own = normSection(view && view.section);
  if (own) return own;
  const m = normSection(view && view.modelSection);
  if (m) return normSection(toWorld(m)) || m;
  return { normal: [-1, 0, 0], constant: z0(centre(box)[0]) };
}

// Camera on the removed side looking back at the cut face: target = the box centre projected onto
// the plane at 45 % of the box height, distance max(20, 1.3 × diagonal), slightly above the target.
export function sectionCamera(plane, box) {
  const c = centre(box);
  c[1] = box.min[1] + 0.45 * (box.max[1] - box.min[1]);
  const n = plane.normal, d = sectionSide(plane, c);
  const target = c.map((v, i) => v - n[i] * d);
  const diag = Math.hypot(...box.max.map((v, i) => v - box.min[i]));
  const dist = Math.max(20, 1.3 * diag);
  const position = target.map((v, i) => v - n[i] * dist);
  position[1] += 0.11 * dist; // ~6° down: OrbitControls in 3D limit the polar angle to 0.47π (84.6°)
  return { position, target };
}

// Views tab directions (world normals; world z = -plan y).
export const SECTION_DIRS = [
  { id: 'we', label: 'West→East', normal: [-1, 0, 0] },
  { id: 'ew', label: 'East→West', normal: [1, 0, 0] },
  { id: 'ns', label: 'North→South', normal: [0, 0, 1] },
  { id: 'sn', label: 'South→North', normal: [0, 0, -1] },
];

export function sectionDir(normal) {
  let best = SECTION_DIRS[0], bd = -Infinity;
  for (const d of SECTION_DIRS) {
    const dot = d.normal[0] * normal[0] + d.normal[1] * normal[1] + d.normal[2] * normal[2];
    if (dot > bd) { bd = dot; best = d; }
  }
  return best;
}

// Slider axis: east (x) for east-west normals, north (-z) for north-south ones.
const axisOf = (normal) => (Math.abs(normal[0]) >= Math.abs(normal[2]) ? [1, 0, 0] : [0, 0, -1]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Slider position (metres east, or north) of a plane: where it crosses its axis.
export function sectionPos(plane) {
  const u = axisOf(plane.normal), k = dot3(plane.normal, u);
  return Math.abs(k) < 1e-9 ? 0 : z0(-plane.constant / k);
}

// The plane with this normal crossing its axis at pos.
export function sectionAt(normal, pos) {
  const n = normSection({ normal, constant: 0 }).normal;
  return { normal: n, constant: z0(-pos * dot3(n, axisOf(n))) };
}

// Slider range: the box along the axis.
export function sectionRange(normal, box) {
  return axisOf(normal)[0] ? [box.min[0], box.max[0]] : [z0(-box.max[2]), z0(-box.min[2])];
}
