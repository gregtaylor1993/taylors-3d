// Model objects on the plan: per-object looks (types.js) and a fixed pool of real lights.
// The pool is created once (8 point + 4 spot) so shaders never recompile; the first 4 point
// slots always cast shadows and get the budget's shadow picks. The pool lives in its own sub-group:
// shown only with a model and `lights` not off (hiding it drops the lights from the shaders).
// Shadow maps are rendered per light (shadow.autoUpdate = false): only lit shadow slots whose
// fixture or position changed, or all lit ones when the casters changed (shadowsStale).
import * as THREE from 'three';
import { chainState, lightBudget } from './logic.js';
import { typeOf } from './types.js';
import { renderLightChainPreview } from '../scene-preview-rendering.js';

const POINTS = 8, SPOTS = 4, SHADOWS = 4;
const DEG = Math.PI / 180;

const shown = (node) => { for (let n = node; n; n = n.parent) if (!n.visible) return false; return true; };
const colorKey = (c) => (c ? c.join(',') : '');
const renderKey = (p) => JSON.stringify([p.renderResult?.level || 0, p.renderResult?.color || null, p.part.text || null]);
const within = (node, ancestor) => { for (let n = node; n; n = n.parent) if (n === ancestor) return true; return false; };

// Match types.js's authored anchor priority and ROOT-local offset convention exactly.
// Motion refreshes the cache; it must not prepare/dispose a type or alter its HA look.
function currentAnchor(p, root) {
  const { obj, part } = p, world = new THREE.Vector3(), box = new THREE.Box3();
  obj.node.updateWorldMatrix(true, true);
  if (part.glow && !box.setFromObject(part.glow).isEmpty()) box.getCenter(world);
  else if (Array.isArray(obj.anchor)) obj.node.localToWorld(world.set(obj.anchor[0], obj.anchor[1], obj.anchor[2] || 0));
  else if (!box.setFromObject(obj.node).isEmpty()) box.getCenter(world);
  else obj.node.getWorldPosition(world);
  const floor = part.displayFloorId ?? part.view?.floorForModelNode?.(obj.node);
  const source = floor && part.view?.displayWorldToSource?.(world.toArray(), floor);
  if (source?.ok) world.fromArray(source.point);
  root.worldToLocal(world);
  // Generic prepare deliberately ignores hints.offset; retain that existing behavior.
  if (p.type !== typeOf('generic') && part.hints?.offset) world.add(new THREE.Vector3(...part.hints.offset));
  return world;
}

export class ObjectLayer {
  constructor(view) {
    this.view = view;
    const group = new THREE.Group(); // the real light pool (labels stay in objectsGroup)
    this.lights = group;
    view.objectsGroup.add(group);
    this.pool = { points: [], spots: [] };
    for (let i = 0; i < POINTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 0, 2);
      if (i < SHADOWS) {
        l.castShadow = true; // never toggled later (a toggle recompiles every shader)
        l.shadow.mapSize.set(512, 512);
        l.shadow.bias = -0.004;
        l.shadow.camera.near = 0.15;
        l.shadow.autoUpdate = false; // re-rendered only when flagged (needsUpdate)
        l.shadow.intensity = 0; // inactive/requested non-shadow uses keep the fixed shader flag
      }
      this.pool.points.push(l);
      group.add(l);
    }
    for (let i = 0; i < SPOTS; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 7, 24 * DEG, 0.6, 1.4);
      this.pool.spots.push(l);
      group.add(l, l.target);
    }
    view.objectsGroup.visible = false; // objects (and their lights) only while a model is loaded
    group.visible = false;
    this._lightsOn = true;
    this._shadowKeys = new Array(SHADOWS).fill(null); // per shadow slot: fixture@position its map was rendered for
    this.model = null;
    this.parts = new Map(); // actual chain/result; renderResult and previewKey stay private
    this.bindings = new Map();
    this.groups = {};
    this._budgetSig = null;
    this._slots = new Map(); // fixture id -> { light, shadow, factor }
    this._placeSig = null;
    this.stats = { updates: 0, evaluated: 0, budget: 0, shadowRequests: 0 }; // counters for the headless checks
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
    this._poseSig = null;
    this._shadowKeys.fill(null);
    if (model) {
      const ctx = { root: model.root, view: this.view, levels: model.manifest.levels || [] };
      for (const obj of model.manifest.objects || []) {
        const type = typeOf(obj.type);
        try {
          const part = type.prepare(obj, ctx);
          const prepared = { obj, type, part, anchorWorld: model.root.localToWorld(part.anchor.clone()), chain: null, result: null, inputs: null };
          prepared.anchorDisplayWorld = this._displayWorld(prepared, prepared.anchorWorld);
          this.parts.set(obj.id, prepared);
        } catch (e) {
          console.warn('taylors3d: object', obj.id, e);
        }
      }
    }
    this.view.objectsGroup.visible = !!model;
    this._showLights();
    this._applyPose();
    this.view.markDirty();
  }

  _displayWorld(p, source) {
    const floor = p.part.displayFloorId ?? this.view.floorForModelNode?.(p.obj.node);
    const display = floor && this.view.sourceWorldToDisplay?.(source.toArray(), floor);
    return display?.ok ? new THREE.Vector3(...display.point) : source.clone();
  }

  // The pool joins the scene only with a model and lights on (a change recompiles the shaders once).
  _showLights() {
    const on = !!this.model && this._lightsOn;
    if (this.lights.visible === on) return false;
    this.lights.visible = on;
    return true;
  }

  // The mower object (bound and not hidden) or null.
  _mower() {
    for (const [id, p] of this.parts) {
      const b = this.bindings.get(id);
      if (p.obj.type === 'mower' && b && b.entity && !b.hidden) return { id, p, entity: b.entity };
    }
    return null;
  }

  mowerBound() {
    return !!this._mower();
  }

  // { x, y, floorId, heading } (plan metres, radians ccw from east) or null: moves the mower node.
  // Unchanged poses do nothing (no matrix work, no frame).
  setMowerPose(pose) {
    const next = pose ? { x: pose.x, y: pose.y, floorId: pose.floorId, heading: pose.heading } : null;
    const a = this._pose, b = next;
    if (a === b || (a && b && a.x === b.x && a.y === b.y && a.floorId === b.floorId && Object.is(a.heading, b.heading))) return;
    this._pose = next;
    this._applyPose();
    this.view.markDirty();
  }

  _applyPose() {
    if (!this.model) return;
    this.model.root.updateWorldMatrix(true, false);
    const sig = this.model.root.matrixWorld.elements.map((v) => v.toFixed(5)).join();
    const moved = this._poseSig && sig !== this._poseSig;
    this._poseSig = sig;
    for (const p of this.parts.values()) {
      if (!p.type.place) continue;
      if (moved) p.type.place(p.part, null); // restore, so the origin is captured again in the new alignment
      p.type.place(p.part, this._pose);
    }
  }

  setBindings(bindings, groups) {
    if (bindings === this.bindings && groups === this.groups) return;
    this.bindings = bindings || new Map();
    this.groups = groups || {};
    for (const p of this.parts.values()) p.inputs = null; // re-evaluate every chain once
  }

  update(states, ctx = {}) {
    if (!this.model) return;
    this.stats.updates++;
    const visibleLevel = ctx.visibleLevel || (() => true);
    const lightsOn = ctx.lightsOn !== false;
    this._lightsOn = lightsOn;
    let changed = this._showLights();
    const fixtures = [];
    const recolour = [];
    const mw = this._mower();
    const mowerEntity = mw ? mw.entity : null;
    for (const [id, p] of this.parts) {
      const labelWasVisible = p.part.label?.visible;
      const binding = this.bindings.get(id);
      const hidden = !!(binding && binding.hidden); // hidden = ignored as a control: dark, no pool light
      const ctrl = !hidden && p.obj.group && this.groups[p.obj.group] && this.groups[p.obj.group].entity;
      const own = binding && binding.entity;
      // extra inputs a type reads (e.g. the charger's power sensor), so its look follows them too
      const extra = !hidden && own && p.type.inputs ? p.type.inputs(own) : [];
      const ents = hidden ? [] : [own, ctrl, p.obj.type === 'dock' ? mowerEntity : null, ...extra];
      // HA replaces a state object when it changes: same objects, nothing to do
      const inputs = ents.map((e) => (e ? states[e] : null));
      const inputChanged = !p.inputs || inputs.length !== p.inputs.length || inputs.some((x, i) => x !== p.inputs[i]) || ents.some((e, i) => e !== p.ents[i]);
      if (inputChanged) {
        p.inputs = inputs;
        p.ents = ents;
        p.chain = hidden ? { lit: false, unavailable: false, source: null, entities: [], reason: null }
          : chainState(p.obj, binding, this.groups, states);
      }
      const preview = p.type.render && !hidden ? renderLightChainPreview(p.chain, states, ctx.lightPreview) : null;
      const previewKey = preview?.key ?? null;
      if (inputChanged || previewKey !== p.previewKey) {
        const prev = p.renderResult;
        p.previewKey = previewKey;
        this.stats.evaluated++;
        p.result = p.type.update(p.part, p.chain, { ...ctx, states, entity: hidden ? null : (binding && binding.entity) || null, mowerEntity, lightPreviewReading: preview });
        p.renderResult = p.type.render?.(p.part) || p.result;
        const key = renderKey(p);
        if (key !== p.renderKey) changed = true;
        p.renderKey = key;
        if (prev && (prev.level !== p.renderResult.level || colorKey(prev.color) !== colorKey(p.renderResult.color))) recolour.push(id);
      }
      if (p.part.label) {
        p.part.label.visible = !!p.part.text && !hidden && visibleLevel(p.obj.level) && shown(p.obj.node);
        if (p.part.label.visible !== labelWasVisible) changed = true;
      }
      if (!p.part.pool || hidden) continue;
      const h = p.part.hints;
      fixtures.push({
        id, lit: lightsOn && !!p.renderResult.lit, visible: visibleLevel(p.obj.level) && shown(p.obj.node),
        group: p.obj.group, max: h.max, output: p.renderResult.output, beam: h.beam, castShadow: h.castShadow,
      });
    }
    // the model was placed elsewhere: pool positions move with it
    const root = this.model.root;
    root.updateWorldMatrix(true, false);
    const placeSig = root.matrixWorld.elements.map((v) => v.toFixed(5)).join();
    const displaySig = placeSig + (this.view.floorPresentationRevision ? '|floors:' + this.view.floorPresentationRevision : '');
    if (this._pose && placeSig !== this._poseSig) this._applyPose(); // the model was re-aligned
    if (displaySig !== this._labelSig) {
      this._labelSig = displaySig;
      for (const p of this.parts.values()) {
        p.anchorWorld = root.localToWorld(p.part.anchor.clone());
        p.anchorDisplayWorld = this._displayWorld(p, p.anchorWorld);
        if (p.type.relayout) p.type.relayout(p.part);
      }
    }
    const budget = lightBudget(fixtures, { points: POINTS, spots: SPOTS, shadows: SHADOWS });
    // Selected IDs/roles drive assignment, not state identity or brightness ranking order.
    const selection = [...budget.real].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([id, pick]) => `${id}:${pick.kind}:${pick.factor}:${budget.shadows.has(id)}`).join(';');
    // The floor owner already moves existing physical slots in place. Only
    // actual source alignment/selection changes need another pool assignment.
    const sig = placeSig + '|' + selection;
    if (sig !== this._budgetSig) {
      this._budgetSig = sig;
      const before = this._slotSig();
      this._assign(budget);
      this.stats.budget++;
      // shadow maps: only lit shadow slots whose fixture or position changed (dark slots are never redrawn)
      const redraw = [];
      this.pool.points.slice(0, SHADOWS).forEach((l, i) => {
        const key = this.view.shadowsEnabled === false ? null : this._shadowKey(l);
        if (key && key !== this._shadowKeys[i]) redraw.push(l);
        this._shadowKeys[i] = key;
        if (!key) l.shadow.needsUpdate = false;
      });
      if (redraw.length) { this.stats.shadowRequests++; this.view.requestShadowUpdate(redraw); }
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

  // fixture@position of a lit shadow slot, null when the slot is dark
  _shadowKey(light) {
    for (const [id, s] of this._slots) if (s.light === light && s.shadow) return `${id}@${light.position.toArray().join()}`;
    return null;
  }

  // The shadow casters changed (model, visibility, cut, section): the lit shadow slots to redraw.
  // Dark slots forget their key, so they are redrawn once they light up.
  shadowsStale() {
    if (this.view.shadowsEnabled === false) { this.clearShadowRequests(); return []; }
    const out = [];
    this.pool.points.slice(0, SHADOWS).forEach((l, i) => {
      // Re-enabling shadows seeds the current assignment once, including lamps
      // that moved or became lit while maps were disabled.
      const key = this.lights.visible ? this._shadowKey(l) : null;
      this._shadowKeys[i] = key;
      if (key) out.push(l);
    });
    return out;
  }

  clearShadowRequests() {
    this._shadowKeys.fill(null);
    for (const light of this.pool.points.slice(0, SHADOWS)) light.shadow.needsUpdate = false;
  }

  _assign({ real, shadows }) {
    const prev = new Map([...this._slots].map(([id, s]) => [id, s.light]));
    this._darken({ keepShadowRequests: true });
    const pts = this.pool.points;
    const shadowSlots = pts.slice(0, SHADOWS), freeSlots = pts.slice(SHADOWS), spotSlots = this.pool.spots.slice();
    const order = [...real.keys()];
    const take = (slots, id) => {
      const i = slots.indexOf(prev.get(id));
      return i >= 0 ? slots.splice(i, 1)[0] : null;
    };
    // Reserve surviving slots before allocating newcomers, including points/spots without shadows.
    const picks = order.filter((x) => shadows.has(x));
    const rest = order.filter((id) => !shadows.has(id));
    const survivingPoints = new Set(rest.filter((id) => real.get(id).kind === 'point').map((id) => prev.get(id)));
    const kept = new Map(picks.map((id) => [id, take(shadowSlots, id)]));
    for (const id of picks) {
      const free = shadowSlots.findIndex((light) => !survivingPoints.has(light));
      const light = kept.get(id) || shadowSlots.splice(free >= 0 ? free : 0, 1)[0];
      this._slots.set(id, { light, shadow: true, factor: real.get(id).factor });
    }
    const retained = new Map(rest.map((id) => [id, real.get(id).kind === 'spot'
      ? take(spotSlots, id) : take(freeSlots, id) || take(shadowSlots, id)]));
    for (const id of rest) {
      const { kind, factor } = real.get(id);
      if (kind === 'spot') { this._slots.set(id, { light: retained.get(id) || spotSlots.shift(), shadow: false, factor }); continue; }
      const light = retained.get(id) || freeSlots.shift() || shadowSlots.shift();
      this._slots.set(id, { light, shadow: false, factor });
    }
    const root = this.model.root;
    for (const [id, slot] of this._slots) {
      const p = this.parts.get(id);
      const h = p.part.hints, l = slot.light;
      l.position.copy(this._displayWorld(p, root.localToWorld(p.part.anchor.clone())));
      l.distance = h.distance;
      l.decay = h.decay;
      if (l.isSpotLight) {
        l.angle = h.angle * DEG;
        l.penumbra = h.penumbra;
        if (h.target) l.target.position.copy(this._displayWorld(p, root.localToWorld(new THREE.Vector3(...h.target))));
        else l.target.position.copy(l.position).y -= 1;
        l.target.updateMatrixWorld();
      }
      l.updateMatrixWorld();
      this._light(slot, p);
    }
    // Non-shadow overflow can use a physical shadow-capable slot without contributing
    // shadows or scheduling maps. Existing shader flags and GPU resources stay fixed.
    for (const light of pts.slice(0, SHADOWS)) {
      const active = [...this._slots.values()].some((slot) => slot.light === light && slot.shadow);
      light.shadow.intensity = active ? 1 : 0;
      if (!active) light.shadow.needsUpdate = false;
    }
  }

  _slotSig() {
    return [...this._slots].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([id, s]) => `${id}:${s.light.id}:${s.shadow}:${s.factor}:${s.light.position.toArray().join()}`).join(';');
  }

  _light(slot, p) {
    const r = p.renderResult;
    const c = r.color || [255, 255, 255];
    slot.light.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    // A finite authored maximum can still overflow after the group multiplier.
    const intensity = r.level * p.part.hints.max;
    slot.light.intensity = Math.min(Number.MAX_VALUE / slot.factor, intensity) * slot.factor;
  }

  _darken({ keepShadowRequests = false } = {}) {
    for (const l of [...this.pool.points, ...this.pool.spots]) l.intensity = 0;
    for (const light of this.pool.points.slice(0, SHADOWS)) {
      light.shadow.intensity = 0;
      if (!keepShadowRequests) light.shadow.needsUpdate = false;
    }
    this._slots.clear();
  }

  // World positions of every object's anchor (card world).
  anchors() {
    if (!this.model) return [];
    const root = this.model.root;
    root.updateWorldMatrix(true, false);
    return [...this.parts].map(([id, p]) => ({ id, world: root.localToWorld(p.part.anchor.clone()) }));
  }

  // Moving model targets may contain objects OR change an enclosing object's box centre.
  // Recompute only related anchors. Root consumes exact changed IDs for tracking/map/popups.
  // Already assigned light slots move in place; no pool allocation or HA state evaluation.
  refreshAnchors(targets, { requestShadows = true, markDirty = true, displayOnly = false } = {}) {
    const result = { changed: false, objectIds: new Set(), roots: new Set(), anchors: [] };
    if (!this.model) return result;
    const root = this.model.root;
    const nodes = (targets instanceof Set || Array.isArray(targets) ? [...targets] : []).filter((node) => node?.isObject3D && within(node, root));
    if (!nodes.length) return result;
    root.updateWorldMatrix(true, false);
    const movedShadows = new Set();
    for (const [id, p] of this.parts) {
      if (!p.obj.node || !nodes.some((target) => within(p.obj.node, target) || within(target, p.obj.node))) continue;
      const anchor = displayOnly ? p.part.anchor.clone() : currentAnchor(p, root);
      const world = root.localToWorld(anchor.clone());
      const display = this._displayWorld(p, world);
      if (p.part.anchor.equals(anchor) && p.anchorWorld?.equals(world) && p.anchorDisplayWorld?.equals(display)) continue;
      p.part.anchor.copy(anchor); result.changed = true; result.objectIds.add(id); result.roots.add(p.obj.node);
      p.anchorWorld = world.clone(); result.anchors.push({ id, world });
      p.anchorDisplayWorld = display.clone();
      if (p.type.relayout) p.type.relayout(p.part);
      const slot = this._slots.get(id);
      if (slot) {
        const light = slot.light, hints = p.part.hints, before = light.position.clone();
        light.position.copy(display);
        if (light.isSpotLight) {
          if (hints.target) light.target.position.copy(this._displayWorld(p, root.localToWorld(new THREE.Vector3(...hints.target))));
          else light.target.position.copy(display).y -= 1;
          light.target.updateMatrixWorld();
        }
        light.updateMatrixWorld();
        if (this.view.shadowsEnabled !== false && slot.shadow && light.intensity > 0 && !before.equals(light.position)) movedShadows.add(light);
      }
    }
    // Keep assignment shadow keys current so the next identical HA update stays idle.
    for (const light of movedShadows) {
      const index = this.pool.points.indexOf(light);
      if (index >= 0 && index < SHADOWS) this._shadowKeys[index] = this._shadowKey(light);
    }
    if (requestShadows && movedShadows.size) {
      this.stats.shadowRequests++; this.view.requestShadowUpdate([...movedShadows]);
    }
    if (markDirty && result.changed) this.view.markDirty();
    return result;
  }

  // World position of one object's anchor (null when the object is gone).
  anchorOf(id) {
    const p = this.model && this.parts.get(id);
    if (!p) return null;
    this.model.root.updateWorldMatrix(true, false);
    return this.model.root.localToWorld(p.part.anchor.clone());
  }

  // SOURCE anchors stay public/canonical; these explicit counterparts are for
  // physical pool lights, popups and labels in a separated-floor presentation.
  displayAnchorOf(id) {
    const p = this.model && this.parts.get(id), source = p && this.anchorOf(id);
    return p && source ? this._displayWorld(p, source) : null;
  }

  displayAnchors() {
    return this.anchors().map(({ id, world }) => ({ id, world: this._displayWorld(this.parts.get(id), world) }));
  }

  refreshFloorPresentation({ requestShadows = false, markDirty = false } = {}) {
    if (!this.model) return { changed: false, objectIds: new Set(), roots: new Set(), anchors: [] };
    if (this._pose) this._applyPose();
    const result = this.refreshAnchors([this.model.root], { requestShadows, markDirty, displayOnly: true });
    if (this._labelSig !== undefined) {
      const placeSig = this.model.root.matrixWorld.elements.map((value) => value.toFixed(5)).join();
      this._labelSig = placeSig + (this.view.floorPresentationRevision ? '|floors:' + this.view.floorPresentationRevision : '');
    }
    return result;
  }

  // Canonical measured origins for read-only SOURCE geometry measurement. Never
  // derive these from a node's compensated DISPLAY position or move the live node.
  // null marks a current mover whose floor/evidence is invalid, so the floor owner
  // diagnoses and assembles rather than silently measuring misleading geometry.
  sourcePosePositions(floors = this.view.floors) {
    const positions = new Map();
    if (!this.model || !this._pose) return positions;
    for (const { obj, part, type } of this.parts.values()) {
      if (!type.place || !part.origin || part.displayFloorId === undefined) continue;
      const pose = this._pose, matches = Array.isArray(floors) ? floors.filter((floor) => floor?.id === pose.floorId) : [];
      const floor = matches.length === 1 ? matches[0] : null;
      const valid = typeof pose.floorId === 'string' && !!pose.floorId.trim() && part.displayFloorId === pose.floorId
        && floor && typeof floor.elevation === 'number' && Number.isFinite(floor.elevation)
        && (!Object.hasOwn(floor, 'stale') || floor.stale === false)
        && [pose.x, pose.y, part.origin.localY].every((value) => typeof value === 'number' && Number.isFinite(value));
      positions.set(obj.node, valid ? [pose.x, floor.elevation + part.origin.localY, -pose.y] : null);
    }
    return positions;
  }

  // A live measured mower can stand on another floor than its authored parent.
  // Its local DISPLAY compensation must also be removed on the export clone.
  // Touch only clone positions; live geometry, materials, poses and HA stay real.
  sourcePosesForExport(cloneRoot) {
    const root = this.model?.root;
    if (!root || !cloneRoot?.isObject3D || cloneRoot === root) return false;
    root.updateWorldMatrix(true, false); cloneRoot.updateWorldMatrix(true, true);
    for (const p of this.parts.values()) {
      const { part, obj } = p;
      if (obj.type !== 'mower' || !part.origin || part.displayFloorId === undefined) continue;
      const path = [];
      for (let node = obj.node; node !== root; node = node.parent) {
        if (!node?.parent) return false;
        path.unshift(node.parent.children.indexOf(node));
      }
      let clone = cloneRoot;
      for (const index of path) { clone = clone.children[index]; if (!clone) return false; }
      if (!clone.parent) return false;
      const world = obj.node.getWorldPosition(new THREE.Vector3());
      const source = this.view.displayWorldToSource?.(world.toArray(), part.displayFloorId);
      if (!source?.ok) return false;
      root.worldToLocal(world.fromArray(source.point));
      cloneRoot.localToWorld(world); clone.position.copy(clone.parent.worldToLocal(world));
      clone.updateMatrixWorld(true);
    }
    return true;
  }

  objectAt(id) {
    const p = this.parts.get(id);
    return p ? { obj: p.obj, part: p.part, chain: p.chain, result: p.result, binding: this.bindings.get(id) || null } : null;
  }

  dispose() {
    this.setModel(null);
    const group = this.lights;
    for (const l of this.pool.spots) group.remove(l.target);
    for (const l of [...this.pool.points, ...this.pool.spots]) { group.remove(l); l.dispose(); }
    this.view.objectsGroup.remove(group);
    if (this.view.objectLayer === this) this.view.objectLayer = null;
  }
}
