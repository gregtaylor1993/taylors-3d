// Model objects on the plan: per-object looks (types.js) and a fixed pool of real lights.
// The pool is created once (8 point + 4 spot) so shaders never recompile; the first 4 point
// slots always cast shadows and get the budget's shadow picks.
import * as THREE from 'three';
import { chainState, lightBudget } from './logic.js';
import { typeOf } from './types.js';

const POINTS = 8, SPOTS = 4, SHADOWS = 4;
const DEG = Math.PI / 180;

const shown = (node) => { for (let n = node; n; n = n.parent) if (!n.visible) return false; return true; };
const colorKey = (c) => (c ? c.join(',') : '');

export class ObjectLayer {
  constructor(view) {
    this.view = view;
    const group = view.objectsGroup;
    this.pool = { points: [], spots: [] };
    for (let i = 0; i < POINTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 0, 2);
      if (i < SHADOWS) {
        l.castShadow = true; // never toggled later (a toggle recompiles every shader)
        l.shadow.mapSize.set(512, 512);
        l.shadow.bias = -0.004;
        l.shadow.camera.near = 0.15;
      }
      this.pool.points.push(l);
      group.add(l);
    }
    for (let i = 0; i < SPOTS; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 7, 24 * DEG, 0.6, 1.4);
      this.pool.spots.push(l);
      group.add(l, l.target);
    }
    group.visible = false; // lights join the shaders only while a model is loaded
    this.model = null;
    this.parts = new Map(); // id -> { obj, type, part, chain, result, inputs }
    this.bindings = new Map();
    this.groups = {};
    this._budgetSig = null;
    this._slots = new Map(); // fixture id -> { light, shadow, factor }
    this._placeSig = null;
    view.objectLayer = this; // the view resets us when it drops the model
  }

  setModel(model) {
    if (model && this.model === model) return;
    for (const p of this.parts.values()) p.type.dispose(p.part);
    this.parts.clear();
    this._darken();
    this.model = model || null;
    this._budgetSig = null;
    this._placeSig = null;
    if (model) {
      const ctx = { root: model.root };
      for (const obj of model.manifest.objects || []) {
        const type = typeOf(obj.type);
        try {
          this.parts.set(obj.id, { obj, type, part: type.prepare(obj, ctx), chain: null, result: null, inputs: null });
        } catch (e) {
          console.warn('floorplan3d: object', obj.id, e);
        }
      }
    }
    this.view.objectsGroup.visible = !!model;
    this.view.markDirty();
  }

  setBindings(bindings, groups) {
    if (bindings === this.bindings && groups === this.groups) return;
    this.bindings = bindings || new Map();
    this.groups = groups || {};
    for (const p of this.parts.values()) p.inputs = null; // re-evaluate every chain once
  }

  update(states, ctx = {}) {
    if (!this.model) return;
    const visibleLevel = ctx.visibleLevel || (() => true);
    const lightsOn = ctx.lightsOn !== false;
    let changed = false;
    const fixtures = [];
    const recolour = [];
    for (const [id, p] of this.parts) {
      const binding = this.bindings.get(id);
      const hidden = !!(binding && binding.hidden); // hidden = ignored as a control: dark, no pool light
      const ctrl = !hidden && p.obj.group && this.groups[p.obj.group] && this.groups[p.obj.group].entity;
      const ents = hidden ? [] : [binding && binding.entity, ctrl];
      // HA replaces a state object when it changes: same objects, nothing to do
      const inputs = ents.map((e) => (e ? states[e] : null));
      if (!p.inputs || inputs.length !== p.inputs.length || inputs.some((x, i) => x !== p.inputs[i]) || ents.some((e, i) => e !== p.ents[i])) {
        const prev = p.result;
        p.inputs = inputs;
        p.ents = ents;
        p.chain = hidden ? { lit: false, unavailable: false, source: null, entities: [], reason: null }
          : chainState(p.obj, binding, this.groups, states);
        p.result = p.type.update(p.part, p.chain, ctx);
        changed = true;
        if (prev && (prev.level !== p.result.level || colorKey(prev.color) !== colorKey(p.result.color))) recolour.push(id);
      }
      if (!p.part.pool || hidden) continue;
      const h = p.part.hints;
      fixtures.push({
        id, lit: lightsOn && !!p.result.lit, visible: visibleLevel(p.obj.level) && shown(p.obj.node),
        group: p.obj.group, max: h.max, beam: h.beam, castShadow: h.castShadow,
      });
    }
    // the model was placed elsewhere: pool positions move with it
    const root = this.model.root;
    root.updateWorldMatrix(true, false);
    const placeSig = root.matrixWorld.elements.map((v) => v.toFixed(5)).join();
    const sig = placeSig + '|' + fixtures.filter((f) => f.lit && f.visible).map((f) => f.id).join();
    if (sig !== this._budgetSig) {
      this._budgetSig = sig;
      const before = this._slotSig();
      const hadShadow = [...this._slots.values()].some((x) => x.shadow);
      this._assign(fixtures);
      // shadow maps only depend on the shadow slots; nothing lit before or after: nothing to redraw
      if (hadShadow || [...this._slots.values()].some((x) => x.shadow)) this.view.requestShadowUpdate();
      if (before !== this._slotSig()) changed = true;
    } else {
      // colour / brightness only: shadow maps depend on light positions, so no redraw
      for (const id of recolour) {
        const slot = this._slots.get(id);
        if (slot) this._light(slot, this.parts.get(id));
      }
    }
    if (changed) this.view.markDirty();
  }

  _assign(fixtures) {
    this._darken();
    const { real, shadows } = lightBudget(fixtures, { points: POINTS, spots: SPOTS, shadows: SHADOWS });
    const pts = this.pool.points;
    const shadowSlots = pts.slice(0, SHADOWS), freeSlots = pts.slice(SHADOWS);
    const order = [...real.keys()];
    // shadow picks first (slots 0..3), then the rest into 4..7, then any shadow slot left
    for (const id of order.filter((x) => shadows.has(x))) this._slots.set(id, { light: shadowSlots.shift(), shadow: true, factor: real.get(id).factor });
    let spot = 0;
    for (const id of order) {
      if (shadows.has(id)) continue;
      const { kind, factor } = real.get(id);
      if (kind === 'spot') { this._slots.set(id, { light: this.pool.spots[spot++], shadow: false, factor }); continue; }
      const light = freeSlots.shift() || shadowSlots.shift();
      this._slots.set(id, { light, shadow: pts.indexOf(light) < SHADOWS, factor });
    }
    const root = this.model.root;
    for (const [id, slot] of this._slots) {
      const p = this.parts.get(id);
      const h = p.part.hints, l = slot.light;
      l.position.copy(root.localToWorld(p.part.anchor.clone()));
      l.distance = h.distance;
      l.decay = h.decay;
      if (l.isSpotLight) {
        l.angle = h.angle * DEG;
        l.penumbra = h.penumbra;
        if (h.target) l.target.position.copy(root.localToWorld(new THREE.Vector3(...h.target)));
        else l.target.position.copy(l.position).y -= 1;
        l.target.updateMatrixWorld();
      }
      l.updateMatrixWorld();
      this._light(slot, p);
    }
  }

  _slotSig() {
    return [...this._slots].map(([id, s]) => `${id}:${s.light.id}:${s.light.position.toArray().join()}`).join(';');
  }

  _light(slot, p) {
    const r = p.result;
    const c = r.color || [255, 255, 255];
    slot.light.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    slot.light.intensity = r.level * p.part.hints.max * slot.factor;
  }

  _darken() {
    for (const l of [...this.pool.points, ...this.pool.spots]) l.intensity = 0;
    this._slots.clear();
  }

  // World positions of every object's anchor (card world).
  anchors() {
    if (!this.model) return [];
    const root = this.model.root;
    root.updateWorldMatrix(true, false);
    return [...this.parts].map(([id, p]) => ({ id, world: root.localToWorld(p.part.anchor.clone()) }));
  }

  // World position of one object's anchor (null when the object is gone).
  anchorOf(id) {
    const p = this.model && this.parts.get(id);
    if (!p) return null;
    this.model.root.updateWorldMatrix(true, false);
    return this.model.root.localToWorld(p.part.anchor.clone());
  }

  objectAt(id) {
    const p = this.parts.get(id);
    return p ? { obj: p.obj, part: p.part, chain: p.chain, result: p.result, binding: this.bindings.get(id) || null } : null;
  }

  dispose() {
    this.setModel(null);
    const group = this.view.objectsGroup;
    for (const l of this.pool.spots) group.remove(l.target);
    for (const l of [...this.pool.points, ...this.pool.spots]) { group.remove(l); l.dispose(); }
    if (this.view.objectLayer === this) this.view.objectLayer = null;
  }
}
