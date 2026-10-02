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

function globRe(pattern) {
  const esc = (t) => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const body = pattern.split('/').map((seg) => (seg === '**' ? '.*' : esc(seg).replace(/\*/g, '[^/]*'))).join('/')
    .replace(/\.\*\//g, '(?:.*/)?');
  return new RegExp('^' + body + '$');
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
    if (!sel || !index.nodes.some((n) => matches(sel, n))) out.push(s);
  }
  return [...new Set(out)];
}
