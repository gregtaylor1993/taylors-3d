// Which static model meshes can be merged into one draw call (pure: works on three.js-like nodes,
// so it is unit tested with plain objects). view.js does the geometry work.
import { GLASS_RE } from './render-rules.js';

export const MAX_MERGE_VERTICES = 1000000;
const FLOOR_RE = /_floor$/i; // room floor pieces (<roomId>_floor): Pick traces them one by one

const matsOf = (o) => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);
const nameOf = (n) => (n.userData && n.userData.name) || n.name || '';
const arrOf = (a) => a.array || (a.data && a.data.array);
const ownLayers = (n) => {
  const l = n.userData && n.userData.fp && n.userData.fp.layer;
  return Array.isArray(l) ? l.filter((x) => typeof x === 'string') : typeof l === 'string' ? [l] : [];
};

// Attribute set of a geometry: names, item sizes, normalized, array type, index presence. null = no position.
export function geometrySignature(g) {
  const attrs = (g && g.attributes) || {};
  if (!attrs.position) return null;
  const parts = Object.keys(attrs).sort().map((k) => {
    const a = attrs[k];
    const arr = arrOf(a);
    return `${k}:${a.itemSize}:${a.normalized ? 1 : 0}:${arr ? arr.constructor.name : '?'}`;
  });
  return parts.join(',') + (g.index ? '|i' : '|-');
}

const seeThrough = (o) => {
  if (o.userData && o.userData.seeThrough) return true;
  return matsOf(o).some((m) => {
    const ud = m.userData || {};
    return !!m.transparent || !!ud.wasTransparent || (m.opacity ?? 1) < 1 || (ud.baseOpacity ?? 1) < 1 || (m.transmission || 0) > 0
      || GLASS_RE.test(m.name || '');
  });
};

// Why a mesh can never be merged (null = it can).
function excluded(o, opts) {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh) return 'kind';
  if (Array.isArray(o.material) || !o.material) return 'materials';
  if ((o.morphTargetInfluences && o.morphTargetInfluences.length) || (o.geometry && o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length)) return 'morph';
  if (o.children && o.children.length) return 'children';
  if (o.visible === false || (o.userData && o.userData.helper)) return 'hidden';
  if (opts.kindOf(o) || opts.keep.has(o)) return 'referenced';
  const name = nameOf(o);
  if (FLOOR_RE.test(name) || FLOOR_RE.test(o.name || '')) return 'floor';
  if (GLASS_RE.test(name) || seeThrough(o)) return 'transparent';
  if (!geometrySignature(o.geometry)) return 'geometry';
  // baking the transform needs float positions / normals / tangents (quantized ones would clamp)
  const a = o.geometry.attributes;
  if (['position', 'normal', 'tangent'].some((k) => a[k] && !(arrOf(a[k]) instanceof Float32Array))) return 'quantized';
  return null;
}

// meshes: candidate mesh nodes (traversal order). opts: { root, kindOf(node) -> 'object' | 'tag' | null,
// isOwner(node) -> bool (layer groups, groups listed in the Views tree), keep: Set of nodes referenced by
// node: selectors (a mesh is left alone, a group owns its meshes), maxVertices }.
// Owner = the nearest ancestor that is tagged, an owner or kept; else root. Anything below an object is
// left alone. Returns [{ owner, meshes, vertices, layers, key }], only groups of two or more meshes.
export function mergeGroups(meshes, opts) {
  const o = { kindOf: () => null, isOwner: () => false, keep: new Set(), maxVertices: MAX_MERGE_VERTICES, ...opts };
  const ownerIds = new Map();
  const buckets = new Map();
  for (const m of meshes) {
    if (excluded(m, o)) continue;
    let owner = null, inObject = false;
    for (let p = m.parent; p && p !== o.root; p = p.parent) {
      const k = o.kindOf(p);
      if (k === 'object') { inObject = true; break; }
      if (!owner && (k || o.isOwner(p) || o.keep.has(p))) owner = p;
    }
    if (inObject) continue;
    owner = owner || o.root;
    if (!ownerIds.has(owner)) ownerIds.set(owner, ownerIds.size);
    const layers = [...new Set(ownLayers(m))].sort();
    const key = [ownerIds.get(owner), m.material.uuid, geometrySignature(m.geometry), m.castShadow ? 1 : 0, m.receiveShadow ? 1 : 0,
      m.renderOrder || 0, m.layers ? m.layers.mask : 1, layers.join('\u0001')].join('|');
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { owner, layers, key, meshes: [] }));
    b.meshes.push(m);
  }
  const out = [];
  for (const b of buckets.values()) {
    let chunk = null;
    const flush = () => { if (chunk && chunk.meshes.length >= 2) out.push(chunk); chunk = null; };
    for (const m of b.meshes) {
      const n = m.geometry.attributes.position.count;
      if (n > o.maxVertices) continue;
      if (chunk && chunk.vertices + n > o.maxVertices) flush();
      if (!chunk) chunk = { owner: b.owner, layers: b.layers, key: b.key, meshes: [], vertices: 0 };
      chunk.meshes.push(m);
      chunk.vertices += n;
    }
    flush();
  }
  return out;
}
