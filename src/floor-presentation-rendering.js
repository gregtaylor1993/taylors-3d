import * as THREE from 'three';
import { readFloorPresentation, compileFloorPresentation, sourceWorldToDisplay as toDisplay,
  displayWorldToSource as toSource } from './floor-presentation.js';

// Explicit GLB floor ownership only. No names/heights, reparenting, geometry or
// material mutations, animation clocks, renderers, lights, timers or HA actions.
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const diagnostic = (code, message, floor_id) => ({ code, message, ...(typeof floor_id === 'string' ? { floor_id } : {}) });
const arrayEqual = (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]);
const tuplesEqual = (a, b) => a.length === b.length && a.every((entry, index) => arrayEqual(entry, b[index]));
const vectorValues = (vector) => vector.toArray();
const within = (node, root) => {
  const visited = new Set();
  for (let current = node; current && !visited.has(current); current = current.parent) {
    if (current === root) return true; visited.add(current);
  }
  return false;
};
const renderable = (node) => node.isMesh || node.isLine || node.isPoints || node.isSprite;
const rigid = (node) => !node.isSkinnedMesh && !node.isInstancedMesh && !node.isBatchedMesh && !node.isBone && !node.isSprite
  && !node.morphTargetInfluences?.length && !Object.keys(node.geometry?.morphAttributes || {}).length;
const affine = (matrix) => matrix.elements.every(finite) && matrix.elements[3] === 0
  && matrix.elements[7] === 0 && matrix.elements[11] === 0 && matrix.elements[15] === 1;
const localMatrix = (node) => node.matrixAutoUpdate
  ? new THREE.Matrix4().compose(node.position, node.quaternion, node.scale) : node.matrix.clone();
const worldMatrix = (node, cache = new Map(), sourcePositions) => {
  if (!node) return new THREE.Matrix4();
  if (cache.has(node)) return cache.get(node);
  const matrix = worldMatrix(node.parent, cache, sourcePositions).clone().multiply(localMatrix(node));
  const source = sourcePositions?.get(node);
  if (source) { matrix.elements[12] = source[0]; matrix.elements[13] = source[1]; matrix.elements[14] = source[2]; }
  cache.set(node, matrix); return matrix;
};
const invertibleParent = (matrix) => {
  if (!affine(matrix) || !finite(matrix.determinant()) || matrix.determinant() === 0) return false;
  const inverse = matrix.clone().invert();
  const norm = (value) => Math.max(...[0, 1, 2].map((row) => [0, 1, 2].reduce((sum, col) => sum + Math.abs(value.elements[col * 4 + row]), 0)));
  return inverse.elements.every(finite) && norm(matrix) * norm(inverse) <= 1e12;
};
const snapshot = (node) => ({ node, parent: node.parent, positionRef: node.position, quaternionRef: node.quaternion,
  scaleRef: node.scale, matrixRef: node.matrix, position: node.position.clone(), quaternion: node.quaternion.clone(),
  scale: node.scale.clone(), matrix: node.matrix.clone(), matrixAutoUpdate: node.matrixAutoUpdate });
const sameReferences = (entry) => entry.node.parent === entry.parent && entry.node.position === entry.positionRef
  && entry.node.quaternion === entry.quaternionRef && entry.node.scale === entry.scaleRef && entry.node.matrix === entry.matrixRef;
const stillOwned = (entry) => sameReferences(entry) && entry.node.matrixAutoUpdate === entry.matrixAutoUpdate
  && entry.node.position.equals(entry.appliedPosition) && entry.node.quaternion.equals(entry.quaternion)
  && entry.node.scale.equals(entry.scale) && entry.node.matrix.equals(entry.appliedMatrix);
const sourceTransform = (entry) => [entry.node, entry.parent, entry.matrixAutoUpdate,
  ...entry.position.toArray(), ...entry.quaternion.toArray(), ...entry.scale.toArray(), ...(entry.matrixAutoUpdate ? [] : entry.matrix.elements)];

// Runtime outlines and other explicitly marked helper subtrees are not authored
// house geometry. Skip them consistently, without removing them from the scene.
function traverseSource(node, visit) {
  if (node.userData?.helper === true) return;
  visit(node); for (const child of node.children) traverseSource(child, visit);
}
const sourceNode = (node, root) => {
  for (let current = node; current; current = current.parent) {
    if (current.userData?.helper === true) return false;
    if (current === root) return true;
  }
  return false;
};

function topology(root) {
  const rows = [];
  traverseSource(root, (node) => {
    const position = node.geometry?.attributes?.position;
    rows.push([node, node.parent, !!renderable(node), !!rigid(node), node.geometry, position,
      position?.count, position?.itemSize, position?.version]);
  });
  return rows;
}

/** setData({raw,modelRoot,floors,targets:[{floor_id,node}],backgroundNodes,
 * transformWriters:Set,sourceWorldPositions:Map<Object3D,[x,y,z]>,enabled})
 * -> {changed,changedTargets,valid,mode,diagnostics}.
 * Exact, disjoint targets must classify every renderable under the current root,
 * or it must be explicitly excluded as background. Selected targets alone move.
 * Source positions correct measured actors only during remeasurement; their live
 * DISPLAY compensation is never a house footprint. A changing reading alone does
 * not repack floors. Changed writers re-prove ownership without changing bounds.
 * All changes are synchronous; the caller handles its existing bounds/render pass.
 */
export class FloorPresentationLayer {
  constructor() {
    this._owned = new Map(); this._revoked = new Set(); this._context = null; this._root = null;
    this._floorTargets = []; this._compiled = compileFloorPresentation(); this._proof = []; this._cleanupDiagnostics = [];
  }

  _restore(changed, diagnostics) {
    for (const [node, entry] of this._owned) {
      if (!stillOwned(entry)) {
        this._revoked.add(node);
        diagnostics.push(diagnostic('external_transform_writer', 'A floor transform changed outside this owner; it was left untouched.', entry.floor_id));
        continue;
      }
      if (!node.position.equals(entry.position) || !node.matrix.equals(entry.matrix)) {
        if (!node.position.equals(entry.position)) node.position.copy(entry.position);
        if (!node.matrix.equals(entry.matrix)) node.matrix.copy(entry.matrix);
        node.matrixWorldNeedsUpdate = true; changed.add(node);
      }
    }
    this._owned.clear();
  }

  _inspectOwnership(diagnostics) {
    for (const entry of this._owned.values()) if (!stillOwned(entry)) {
      this._revoked.add(entry.node);
      diagnostics.push(diagnostic('external_transform_writer', 'A floor transform changed outside this owner; further offsets are refused.', entry.floor_id));
    }
  }

  _contextFor(root, floors, targets, backgrounds, writers) {
    const ancestors = [], seen = new Set();
    for (const target of targets) for (let node = target.node?.parent; node && !seen.has(node); node = node.parent) {
      seen.add(node); ancestors.push([node, node.parent, node.matrixAutoUpdate, ...localMatrix(node).elements]);
    }
    const targetTransforms = targets.map(({ node }) => {
      const entry = this._owned.get(node);
      return entry && stillOwned(entry) ? sourceTransform(entry) : sourceTransform(snapshot(node));
    });
    return { root, floors: JSON.stringify(floors.map((floor) => [floor?.id, floor?.elevation, Object.hasOwn(floor || {}, 'stale'), floor?.stale])),
      targets: targets.map((target) => [target.floor_id, target.node]), backgrounds: backgrounds.slice(), writers: writers.slice(),
      ancestors, targetTransforms, topology: topology(root), bounds: null };
  }

  _sameSpatialContext(context) {
    const previous = this._context;
    return !!previous && previous.root === context.root && previous.floors === context.floors
      && tuplesEqual(previous.targets, context.targets) && arrayEqual(previous.backgrounds, context.backgrounds)
      && tuplesEqual(previous.ancestors, context.ancestors)
      && tuplesEqual(previous.targetTransforms, context.targetTransforms) && tuplesEqual(previous.topology, context.topology);
  }

  _prove(root, floors, targets, backgrounds, writers) {
    const diagnostics = [], counts = new Map(), nodes = new Set();
    const bad = (code, message, id) => diagnostics.push(diagnostic(code, message, id));
    for (const target of targets) {
      const matches = floors.filter((floor) => floor?.id === target.floor_id);
      if (matches.length !== 1 || typeof target.floor_id !== 'string' || !target.floor_id.trim()
        || !finite(matches[0]?.elevation) || (Object.hasOwn(matches[0] || {}, 'stale') && matches[0].stale !== false))
        bad(matches.length > 1 ? 'ambiguous_floor' : 'missing_floor', 'A level target needs one exact current, finite, non-stale floor.', target.floor_id);
      counts.set(target.floor_id, (counts.get(target.floor_id) || 0) + 1);
      if (nodes.has(target.node)) bad('shared_floor_target', 'Two floor IDs point at the same level node.', target.floor_id);
      nodes.add(target.node);
      if (!target.node?.isObject3D || !within(target.node, root)) bad('stale_floor_target', 'A saved floor node is outside the current model root.', target.floor_id);
      else {
        if (!sourceNode(target.node, root)) bad('helper_floor_target', 'A floor target cannot be a runtime helper or inside a helper subtree.', target.floor_id);
        if (!rigid(target.node) || target.node.isCamera || target.node.isLight) bad('unsupported_floor_target', 'Choose a rigid level group or mesh.', target.floor_id);
        if (!affine(localMatrix(target.node)) || ![...vectorValues(target.node.position), ...target.node.quaternion.toArray(), ...vectorValues(target.node.scale)].every(finite))
          bad('invalid_floor_transform', 'The authored level transform is nonfinite or non-affine.', target.floor_id);
        if (!invertibleParent(worldMatrix(target.node.parent))) bad('invalid_parent_transform', 'The level parent transform is singular or too ill-conditioned for a safe world translation.', target.floor_id);
        if (writers.some((writer) => writer === target.node || within(target.node, writer)))
          bad('transform_writer', 'Another transform writer owns this level or one of its ancestors.', target.floor_id);
        if (this._revoked.has(target.node)) bad('external_transform_writer', 'This level lost transform ownership; reload or deliberately replace the target before retrying.', target.floor_id);
      }
    }
    for (const target of targets) if (counts.get(target.floor_id) > 1) bad('ambiguous_floor_target', 'A floor ID has more than one level target.', target.floor_id);
    for (let index = 0; index < targets.length; index++) for (let other = index + 1; other < targets.length; other++) {
      const a = targets[index], b = targets[other];
      if (a.node !== b.node && (within(a.node, b.node) || within(b.node, a.node))) bad('nested_floor_targets', 'Level targets must be disjoint rather than nested.', a.floor_id);
    }
    const backgroundSet = new Set();
    for (const node of backgrounds) {
      if (!node?.isObject3D || !within(node, root)) bad('stale_background', 'An explicit background node is outside the current model root.');
      if (backgroundSet.has(node)) bad('ambiguous_background', 'Each explicit background node must be unique.');
      backgroundSet.add(node);
      if (targets.some((target) => within(node, target.node) || within(target.node, node))) bad('overlapping_background', 'Background and floor targets must not overlap.');
    }
    if (!diagnostics.length) traverseSource(root, (node) => {
      if (!renderable(node)) return;
      const containing = targets.filter((target) => within(node, target.node));
      const background = backgrounds.filter((target) => within(node, target));
      if (containing.length + background.length !== 1) bad('unclassified_geometry', 'Every rendered model part needs an exact level owner or explicit background node.');
      else if (containing.length && !rigid(node)) bad('unsupported_floor_mesh', 'Floor geometry must be rigid, non-instanced and without skinning or morph targets.', containing[0].floor_id);
      else if (background.length && !rigid(node)) bad('unsupported_background_mesh', 'This first split implementation supports rigid background geometry only; animated or instanced dependencies require an explicit supported adapter.');
    });
    return diagnostics;
  }

  _measure(targets, sourceWorldPositions) {
    const bounds = [], matrices = new Map(), point = new THREE.Vector3();
    for (const target of targets) {
      const box = new THREE.Box3();
      let valid = true, vertices = 0;
      traverseSource(target.node, (node) => {
        if (!renderable(node)) return;
        const position = node.geometry?.attributes?.position;
        if (!position || !Number.isInteger(position.count) || position.count <= 0 || position.itemSize < 3
          || typeof position.getX !== 'function' || typeof position.getY !== 'function' || typeof position.getZ !== 'function') { valid = false; return; }
        const matrix = worldMatrix(node, matrices, sourceWorldPositions);
        if (!affine(matrix)) { valid = false; return; }
        for (let index = 0; index < position.count; index++) {
          point.set(position.getX(index), position.getY(index), position.getZ(index));
          if (![point.x, point.y, point.z].every(finite)) { valid = false; continue; }
          point.applyMatrix4(matrix); if (![point.x, point.y, point.z].every(finite)) { valid = false; continue; }
          box.expandByPoint(point); vertices++;
        }
      });
      bounds.push({ floor_id: target.floor_id, min: valid && vertices ? box.min.toArray() : [NaN, NaN, NaN],
        max: valid && vertices ? box.max.toArray() : [NaN, NaN, NaN] });
    }
    return bounds;
  }

  setData({ raw, modelRoot, floors = [], targets = [], backgroundNodes = [], transformWriters = new Set(), sourceWorldPositions = new Map(), enabled = true } = {}) {
    const changed = new Set(), ownershipDiagnostics = [];
    this._cleanupDiagnostics = [];
    this._inspectOwnership(ownershipDiagnostics);
    if (this._root !== modelRoot) {
      this._restore(changed, ownershipDiagnostics); this._revoked.clear(); this._context = null;
      // An old source's external writer is reported, but cannot revoke a new model.
      this._cleanupDiagnostics = ownershipDiagnostics.splice(0).filter((entry, index, all) =>
        all.findIndex((other) => other.code === entry.code && other.floor_id === entry.floor_id) === index);
    }
    this._root = modelRoot;
    const policy = readFloorPresentation(raw), currentFloors = Array.isArray(floors) ? floors : [];
    const identity = () => {
      const compiled = compileFloorPresentation(undefined, { floors: currentFloors }); compiled.requestedMode = policy.mode;
      compiled.valid = policy.valid && ownershipDiagnostics.length === 0; compiled.diagnostics = [...policy.diagnostics, ...ownershipDiagnostics]; return compiled;
    };
    if (enabled === false || policy.mode === 'assembled' || !policy.valid) {
      this._restore(changed, ownershipDiagnostics);
      this._compiled = !policy.valid && policy.mode !== 'assembled' ? compileFloorPresentation(policy, { floors: currentFloors }) : identity();
      if (!policy.valid && policy.mode !== 'assembled') this._compiled.diagnostics.push(...ownershipDiagnostics);
      this._proof = []; this._context = null; this._floorTargets = [];
      return this._result(changed);
    }
    const malformed = [];
    if (enabled !== true) malformed.push(diagnostic('invalid_enabled', 'Floor display eligibility must be explicitly true or false.'));
    if (!modelRoot?.isObject3D || typeof modelRoot.traverse !== 'function') malformed.push(diagnostic('missing_model', 'A current model root is required for geometry separation.'));
    if (!Array.isArray(floors)) malformed.push(diagnostic('invalid_resolved_floors', 'Current resolved floors must be an array.'));
    if (!Array.isArray(targets) || targets.some((entry) => !entry || !entry.node?.isObject3D)) malformed.push(diagnostic('invalid_targets', 'Choose exact current Object3D level targets.'));
    if (!Array.isArray(backgroundNodes) || backgroundNodes.some((node) => !node?.isObject3D)) malformed.push(diagnostic('invalid_background', 'Explicit background nodes must be current Object3D references.'));
    if (!(transformWriters instanceof Set) || [...transformWriters].some((node) => !node?.isObject3D)) malformed.push(diagnostic('invalid_transform_writers', 'Transform writers must be a Set of exact Object3D references.'));
    if (!(sourceWorldPositions instanceof Map)) malformed.push(diagnostic('invalid_source_pose', 'Measured source positions must be an explicit Map of current rigid model nodes.'));
    else for (const [node, point] of sourceWorldPositions) {
      if (!node?.isObject3D || !sourceNode(node, modelRoot) || !rigid(node) || node.isCamera || node.isLight
        || !Array.isArray(point) || point.length !== 3 || !point.every((value) => finite(value) && Math.abs(value) <= 1e6)
        || (Array.isArray(targets) && targets.some((target) => target?.node && (node === target.node || within(target.node, node)))))
        malformed.push(diagnostic('invalid_source_pose', 'A measured source pose needs an exact current rigid child, a known current floor and finite bounded world coordinates.'));
    }
    if (malformed.length || ownershipDiagnostics.length) {
      this._restore(changed, ownershipDiagnostics); this._compiled = { mode: 'assembled', requestedMode: policy.mode, valid: false,
        diagnostics: [...policy.diagnostics, ...malformed, ...ownershipDiagnostics], rows: [] };
      this._context = null; this._floorTargets = []; this._proof = this._compiled.diagnostics; return this._result(changed);
    }
    const context = this._contextFor(modelRoot, floors, targets, backgroundNodes, [...transformWriters]);
    if (!this._sameSpatialContext(context)) {
      this._restore(changed, ownershipDiagnostics);
      this._proof = this._prove(modelRoot, floors, targets, backgroundNodes, [...transformWriters]);
      if (!this._proof.length) context.bounds = this._measure(targets, sourceWorldPositions);
    } else {
      context.bounds = this._context.bounds;
      if (!arrayEqual(this._context.writers, context.writers))
        this._proof = this._prove(modelRoot, floors, targets, backgroundNodes, [...transformWriters]);
      // An initially forbidden writer had no valid footprint to cache. Once the
      // exact ownership proof succeeds, measure the assembled source once.
      if (!this._proof.length && !context.bounds) context.bounds = this._measure(targets, sourceWorldPositions);
    }
    this._context = context;
    const compiled = compileFloorPresentation(policy, { floors, bounds: context.bounds || [],
      model: { present: true, supported: !this._proof.length && !ownershipDiagnostics.length, diagnostics: [...this._proof, ...ownershipDiagnostics] } });
    this._compiled = compiled;
    if (!compiled.valid) {
      this._restore(changed, compiled.diagnostics); this._floorTargets = []; return this._result(changed);
    }
    this._floorTargets = targets.map((target) => ({ floor_id: target.floor_id, node: target.node }));
    const requested = new Map(compiled.rows.map((row) => [this._floorTargets.find((target) => target.floor_id === row.floor_id)?.node, row]));
    const matrices = new Map(), updates = [];
    for (const [node, row] of requested) {
      if (!node || row.offset.every((component) => component === 0)) continue;
      const entry = this._owned.get(node) || { ...snapshot(node), floor_id: row.floor_id };
      const parentMatrix = worldMatrix(node.parent, matrices), inverse = parentMatrix.clone().invert();
      const delta = new THREE.Vector3(...row.offset).applyMatrix3(new THREE.Matrix3().setFromMatrix4(inverse));
      const position = entry.matrixAutoUpdate ? entry.position.clone().add(delta) : entry.position.clone();
      const matrix = entry.matrixAutoUpdate ? new THREE.Matrix4().compose(position, entry.quaternion, entry.scale)
        : new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z).multiply(entry.matrix);
      const source = entry.matrixAutoUpdate ? new THREE.Matrix4().compose(entry.position, entry.quaternion, entry.scale) : entry.matrix;
      const actualDelta = new THREE.Vector3(...[12, 13, 14].map((index) => matrix.elements[index] - source.elements[index]))
        .applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentMatrix)).toArray();
      if (!position.toArray().every(finite) || !affine(matrix) || actualDelta.some((component, index) => !finite(component)
        || Math.abs(component - row.offset[index]) > 1e-8 * Math.max(1, Math.abs(row.offset[index]))))
        compiled.diagnostics.push(diagnostic('unrepresentable_translation', 'The authored transform cannot accurately represent the requested world offset.', row.floor_id));
      updates.push({ node, entry, position, matrix });
    }
    if (compiled.diagnostics.some((entry) => entry.code === 'unrepresentable_translation')) {
      compiled.valid = false; compiled.mode = 'assembled'; compiled.rows = [];
      this._restore(changed, compiled.diagnostics); this._floorTargets = []; return this._result(changed);
    }
    for (const [node, entry] of this._owned) if (!requested.has(node) || requested.get(node).offset.every((component) => component === 0)) {
      if (stillOwned(entry)) {
        if (!node.position.equals(entry.position)) node.position.copy(entry.position);
        if (!node.matrix.equals(entry.matrix)) node.matrix.copy(entry.matrix);
        node.matrixWorldNeedsUpdate = true; changed.add(node);
      }
      this._owned.delete(node);
    }
    for (const { node, entry, position, matrix } of updates) {
      if (!node.position.equals(position) || !node.matrix.equals(matrix)) {
        if (!node.position.equals(position)) node.position.copy(position);
        if (!node.matrix.equals(matrix)) node.matrix.copy(matrix);
        node.matrixWorldNeedsUpdate = true; changed.add(node);
      }
      entry.appliedPosition = position; entry.appliedMatrix = matrix; this._owned.set(node, entry);
    }
    return this._result(changed);
  }

  _result(changed) { return { changed: changed.size > 0, changedTargets: [...changed], valid: this._compiled.valid,
    mode: this._compiled.mode, diagnostics: [...this._compiled.diagnostics, ...this._cleanupDiagnostics].map((entry) => ({ ...entry })) }; }

  _mappingCurrent() {
    if (!this._compiled.valid || this._revoked.size || [...this._owned.values()].some((entry) => !stillOwned(entry))) return false;
    if (this._compiled.mode === 'assembled') return true;
    const context = this._context;
    return !!context && context.root === this._root && context.ancestors.every(([node, parent, auto, ...elements]) =>
      node.parent === parent && node.matrixAutoUpdate === auto && arrayEqual(localMatrix(node).elements, elements))
      && context.targetTransforms.every((expected) => {
        const node = expected[0], entry = this._owned.get(node);
        return within(node, this._root) && arrayEqual(sourceTransform(entry || snapshot(node)), expected);
      });
  }

  offsetForFloor(id) { return this._mappingCurrent() ? this._compiled.rows.find((row) => row.floor_id === id)?.offset.slice() || null : null; }
  floorForNode(node) {
    if (!this._mappingCurrent() || !node?.isObject3D || !within(node, this._root)) return null;
    const targets = this._floorTargets.filter((target) => within(node, target.node)); return targets.length === 1 ? targets[0].floor_id : null;
  }
  _staleMapping() { return { ok: false, point: null, diagnostics: [diagnostic('stale_mapping', 'Re-evaluate current level ownership before converting source/display coordinates.')] }; }
  sourceWorldToDisplay(point, floorId) { return this._mappingCurrent() ? toDisplay(point, floorId, this._compiled) : this._staleMapping(); }
  displayWorldToSource(point, floorId) { return this._mappingCurrent() ? toSource(point, floorId, this._compiled) : this._staleMapping(); }

  report() {
    let skinned = false;
    this._root?.traverse?.((node) => { if (node.isSkinnedMesh) skinned = true; });
    const exportReady = !!this._root?.isObject3D && !skinned && !this._revoked.size && [...this._owned.values()].every(stillOwned);
    const current = this._mappingCurrent(), stale = this._compiled.valid && !current;
    return { ...this._compiled, valid: this._compiled.valid && current,
      diagnostics: [...[...this._compiled.diagnostics, ...this._cleanupDiagnostics].map((entry) => ({ ...entry })), ...(stale ? this._staleMapping().diagnostics : [])],
      rows: (current ? this._compiled.rows : []).map((row) => ({ ...row, offset: row.offset.slice(), bounds: row.bounds
        ? { min: row.bounds.min.slice(), max: row.bounds.max.slice() } : null })),
      export: { supported: exportReady, strategy: 'clone_source_transforms', reason: exportReady ? null
        : skinned ? 'Skinned source export requires a supported skeleton-cloning adapter.' : 'No current trustworthy source-transform ownership.' } };
  }

  /** Read-only source export adapter: never temporarily changes the live tree.
   * Clone object transforms only; geometry/material/texture resources stay shared.
   * The caller must never dispose those shared resources through the export clone.
   */
  cloneSourceRoot() {
    if (!this.report().export.supported) return { ok: false, root: null, diagnostics: [diagnostic('source_export_unavailable', 'Current source transforms cannot be safely reconstructed.')] };
    const clone = this._root.clone(true), originals = [], copies = [];
    this._root.traverse((node) => originals.push(node)); clone.traverse((node) => copies.push(node));
    if (originals.length !== copies.length) return { ok: false, root: null, diagnostics: [diagnostic('source_export_structure', 'The source clone did not retain the exact object hierarchy.')] };
    originals.forEach((node, index) => {
      const entry = this._owned.get(node); if (!entry) return;
      copies[index].position.copy(entry.position); copies[index].matrix.copy(entry.matrix); copies[index].matrixWorldNeedsUpdate = true;
    });
    clone.updateMatrixWorld(true);
    return { ok: true, root: clone, diagnostics: [] };
  }

  dispose() {
    const changed = new Set(), diagnostics = []; this._restore(changed, diagnostics);
    this._root = null; this._context = null; this._floorTargets = []; this._revoked.clear(); this._proof = []; this._cleanupDiagnostics = [];
    this._compiled = compileFloorPresentation();
    return { changed: changed.size > 0, changedTargets: [...changed], diagnostics };
  }
}
