// Object types: how a model object looks for its HA state. prepare() once per model load,
// update() when the object's state changed. Real lights come from the layer's fixed pool.
import * as THREE from 'three';
import { lightColor, lightLevel } from './logic.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const vec3 = (a) => (Array.isArray(a) && a.length === 3 && a.every(fin) ? a.slice() : null);

// Invalid hints fall back to defaults; down / up beams are point lights.
export function hintDefaults(hints) {
  const h = hints && typeof hints === 'object' ? hints : {};
  return {
    beam: h.beam === 'spot' ? 'spot' : 'point',
    max: fin(h.max) && h.max >= 0 ? h.max : 5,
    distance: fin(h.distance) && h.distance >= 0 ? h.distance : 0,
    decay: fin(h.decay) && h.decay >= 0 ? h.decay : 2,
    angle: fin(h.angle) ? Math.min(80, Math.max(5, h.angle)) : 24,
    penumbra: fin(h.penumbra) && h.penumbra >= 0 && h.penumbra <= 1 ? h.penumbra : 0.6,
    target: vec3(h.target),
    castShadow: typeof h.castShadow === 'boolean' ? h.castShadow : true,
    offset: vec3(h.offset),
  };
}

const nameOf = (n) => (n.userData && n.userData.name) || n.name || '';

// First node named `name` (userData.name or name) under node, resolved to a mesh (itself or its first mesh).
export function findGlow(node, name) {
  if (!node || !name) return null;
  const firstMesh = (n) => {
    if (n.isMesh) return n;
    for (const c of n.children || []) { const m = firstMesh(c); if (m) return m; }
    return null;
  };
  const find = (n) => {
    if (nameOf(n) === name || n.name === name) { const m = firstMesh(n); if (m) return m; }
    for (const c of n.children || []) { const m = find(c); if (m) return m; }
    return null;
  };
  return find(node);
}

const matsOf = (mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

// The anchor in the model root's frame: glow centre, else fp anchor (node frame), else node box centre; + hints.offset.
function anchorOf(obj, glow, root, offset) {
  root.updateWorldMatrix(true, true);
  const p = new THREE.Vector3();
  const box = new THREE.Box3();
  if (glow && !box.setFromObject(glow).isEmpty()) box.getCenter(p);
  else if (Array.isArray(obj.anchor)) obj.node.localToWorld(p.set(obj.anchor[0], obj.anchor[1], obj.anchor[2] || 0));
  else if (!box.setFromObject(obj.node).isEmpty()) box.getCenter(p);
  else obj.node.getWorldPosition(p);
  root.worldToLocal(p);
  if (offset) p.add(new THREE.Vector3(...offset));
  return p;
}

function prepareLight(obj, { root }, pool) {
  const hints = hintDefaults(obj.hints);
  const glow = obj.node ? findGlow(obj.node, obj.glow || 'glow') : null;
  const mats = [];
  if (glow) {
    const orig = glow.material;
    const clones = matsOf(glow).map((m) => {
      const c = m.clone();
      c.userData = { ...m.userData, baseEmissive: m.emissive ? m.emissive.getHex() : 0 };
      if (c.emissive) c.emissive.setRGB(0, 0, 0);
      c.emissiveIntensity = 0;
      return c;
    });
    glow.material = Array.isArray(orig) ? clones : clones[0];
    mats.push(...clones);
    glow.userData.fpOrigMaterial = orig;
  }
  return { obj, glow, mats, hints, pool, anchor: obj.node ? anchorOf(obj, glow, root, hints.offset) : new THREE.Vector3() };
}

function updateLight(part, chain) {
  const level = chain.lit ? lightLevel(chain.source || { state: 'on', attributes: {} }) : 0;
  const color = lightColor(chain.source);
  for (const m of part.mats) {
    if (m.emissive) m.emissive.setRGB(color[0] / 255, color[1] / 255, color[2] / 255, THREE.SRGBColorSpace);
    m.emissiveIntensity = level * 3;
  }
  return { lit: level > 0, level, color };
}

function disposeLight(part) {
  if (part.glow && part.glow.userData.fpOrigMaterial) {
    part.glow.material = part.glow.userData.fpOrigMaterial;
    delete part.glow.userData.fpOrigMaterial;
  }
  for (const m of part.mats) m.dispose();
  part.mats = [];
}

const generic = {
  prepare: (obj, ctx) => ({ obj, glow: null, mats: [], hints: hintDefaults(obj.hints), pool: false, anchor: obj.node ? anchorOf(obj, null, ctx.root, null) : new THREE.Vector3() }),
  update: () => ({ lit: false, level: 0, color: null }),
  dispose: () => {},
  defaults: { tap: 'more-info', hold: 'popup', popup: ['state'] },
};

export const TYPES = {
  light: {
    prepare: (obj, ctx) => prepareLight(obj, ctx, true),
    update: updateLight, dispose: disposeLight,
    defaults: { tap: 'toggle', hold: 'popup', popup: ['toggle', 'brightness', 'color'] },
  },
  light_strip: {
    // real light only when the model asks for one (hints.max)
    prepare: (obj, ctx) => prepareLight(obj, ctx, !!obj.hints && fin(obj.hints.max) && obj.hints.max > 0),
    update: updateLight, dispose: disposeLight,
    defaults: { tap: 'toggle', hold: 'popup', popup: ['toggle', 'brightness', 'color'] },
  },
  // mower / dock / ev_charger / climate get their looks in later steps; until then generic
  mower: { ...generic, defaults: { tap: 'popup', hold: 'more-info', popup: ['state', 'battery', 'start', 'dock'] } },
  dock: { ...generic, defaults: { tap: 'more-info', hold: 'more-info', popup: ['state'] } },
  ev_charger: { ...generic, defaults: { tap: 'more-info', hold: 'popup', popup: ['state', 'power', 'energy'] } },
  climate: { ...generic, defaults: { tap: 'more-info', hold: 'popup', popup: ['temperature', 'mode'] } },
  generic,
};

export const typeOf = (type) => (Object.prototype.hasOwnProperty.call(TYPES, type) ? TYPES[type] : TYPES.generic);
