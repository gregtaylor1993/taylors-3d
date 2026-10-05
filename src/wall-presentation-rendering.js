// Owns only explicitly selected wall materials. View supplies the existing RAF,
// current camera and model context; this layer creates no renderer or timer.
import * as THREE from 'three';
import { ghostMaterial } from './render-rules.js';
import { wallTargetReport, readWallSide, stepWallTransition } from './wall-presentation.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const materialsOf = (mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material];
const owners = new WeakMap();
const diagnostic = (code, message, id) => ({ code, message, id });
const assign = (material, values) => {
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    if (material[key] === value) continue;
    if (['transparent', 'alphaHash', 'alphaToCoverage', 'side', 'clipIntersection', 'clipShadows'].includes(key)) material.needsUpdate = true;
    material[key] = value; changed = true;
  }
  return changed;
};
const planesEqual = (left, right) => left === right || Array.isArray(left) && Array.isArray(right)
  && left.length === right.length && left.every((plane, index) => plane === right[index]);

/** Independent material owner integrated by View's existing render lifecycle.
 * setData(context) does not infer wall geometry or alter HA state. update(now,
 * cameraPosition) returns actual visible/semantic/shadow work to the caller.
 * Original material references, texture references and geometry stay intact.
 */
export class WallPresentationLayer {
  constructor() {
    this.entries = new Map(); this.context = {}; this.disposed = false;
    this._report = { rows: [], diagnostics: [] };
    this._pending = { changed: false, semanticChanged: false, shadowChanged: false };
    this._contextKey = null; this._camera = [NaN, NaN, NaN]; this._point = new THREE.Vector3();
  }

  setData(context = {}) {
    if (this.disposed) return;
    const key = [context.raw, context.index, context.floors, context.modelRoot, context.modelOpacity,
      !!context.section, context.materialWriters, context.eligible !== false, !!context.reducedMotion];
    const intact = [...this.entries.values()].every((entry) => this._owns(entry));
    if (intact && this._contextKey?.every((value, index) => value === key[index])) {
      this.context.freezeCameraSide = !!context.freezeCameraSide; return;
    }
    this._contextKey = key; this.context = { ...context };
    const report = wallTargetReport(context.raw, context);
    const wanted = new Map();
    for (const row of report.rows) {
      if (!row.enabled || context.eligible === false) continue;
      const materials = materialsOf(row.node);
      if (owners.has(row.node) && owners.get(row.node) !== this) {
        row.ready = row.enabled = false;
        row.diagnostics.push(diagnostic('material_writer', 'Another wall layer already owns this mesh.', row.id));
      } else if (materials.length > 32) {
        row.ready = row.enabled = false;
        row.diagnostics.push(diagnostic('material_limit', 'This mesh has more than 32 material slots; select a smaller wall piece.', row.id));
      } else if (report.policy.mode === 'cutaway' && materials.some((material) => material.clipIntersection)) {
        row.ready = row.enabled = false;
        row.diagnostics.push(diagnostic('clipping_intersection', 'This wall uses intersecting clip planes; its existing appearance is kept.', row.id));
      }
      if (row.enabled) wanted.set(row.node, row);
    }
    for (const [mesh, entry] of this.entries) {
      if (wanted.has(mesh) && this._owns(entry)) continue;
      this._release(entry); this.entries.delete(mesh);
    }
    for (const [mesh, row] of wanted) {
      let entry = this.entries.get(mesh);
      if (!entry) {
        const originalReference = mesh.material, originals = materialsOf(mesh).slice(), unique = new Map();
        let materials;
        try { materials = originals.map((material) => { if (!unique.has(material)) unique.set(material, material.clone()); return unique.get(material); }); }
        catch {
          for (const material of unique.values()) material.dispose();
          row.ready = row.enabled = false; row.status = 'material_clone';
          row.diagnostics.push(diagnostic('material_clone', 'These authored materials could not be copied safely.', row.id)); continue;
        }
        entry = { mesh, originalReference, originals, materials, row, active: false,
          multiplier: 1, cut: null, transition: null, plane: new THREE.Plane(),
          localPlane: new THREE.Plane(), wallPlane: new THREE.Plane(new THREE.Vector3(0, -1, 0)),
          point: new THREE.Vector3(), normal: new THREE.Vector3(), normalMatrix: new THREE.Matrix3(), worldKey: null, faceKey: null,
          baseData: originals.map((material) => ({ ...material.userData, wasTransparent: material.userData.wasTransparent ?? material.transparent,
            baseOpacity: material.userData.baseOpacity ?? material.opacity, baseDepthWrite: material.userData.baseDepthWrite ?? material.depthWrite })),
          authoredSides: originals.map((material) => material.userData.sectionSide ?? material.side),
          clipArrays: new Map(), baseDirty: true };
        this.entries.set(mesh, entry);
        mesh.material = Array.isArray(originalReference) ? materials : materials[0];
        owners.set(mesh, this); this._pending.changed = true;
      }
      entry.row = row; entry.baseDirty = true;
      const face = row.face, faceKey = face ? [...face.point, ...face.normal].join('|') : null;
      if (faceKey !== entry.faceKey) {
        entry.faceKey = faceKey; entry.worldKey = null;
        if (face) entry.localPlane.setFromNormalAndCoplanarPoint(entry.normal.fromArray(face.normal), entry.point.fromArray(face.point));
      }
    }
    report.diagnostics = [...report.policy.diagnostics, ...report.rows.flatMap((row) => row.diagnostics)];
    this._report = report;
  }

  report() {
    const rows = this._report.rows.map((row) => ({ ...row, face: row.face ? { ...row.face, point: row.face.point.slice(), normal: row.face.normal.slice() } : null,
      diagnostics: row.diagnostics.map((entry) => ({ ...entry })) }));
    return { ...this._report, rows, diagnostics: this._report.diagnostics.map((entry) => ({ ...entry })) };
  }

  get moving() { for (const entry of this.entries.values()) if (entry.transition?.moving) return true; return false; }
  ownsMesh(mesh) { const entry = this.entries.get(mesh); return !!entry && this._owns(entry); }
  _owns(entry) {
    return Array.isArray(entry.mesh.material) ? entry.mesh.material.length === entry.materials.length
      && entry.mesh.material.every((material, index) => material === entry.materials[index]) : entry.mesh.material === entry.materials[0] && entry.materials.length === 1;
  }

  _base(entry, index) {
    const original = entry.originals[index];
    const ghost = ghostMaterial(entry.baseData[index], finite(this.context.modelOpacity) ? this.context.modelOpacity : 1);
    return { opacity: ghost?.opacity ?? original.opacity,
      transparent: ghost?.transparent ?? original.transparent,
      alphaHash: ghost?.alphaHash ?? original.alphaHash,
      alphaToCoverage: ghost?.alphaToCoverage ?? original.alphaToCoverage,
      depthWrite: ghost?.depthWrite ?? original.depthWrite,
      side: this.context.section ? THREE.DoubleSide : entry.authoredSides[index] };
  }

  _apply(entry) {
    let changed = false;
    entry.materials.forEach((material, index) => {
      const original = entry.originals[index], base = this._base(entry, index);
      const faded = entry.multiplier < 1;
      changed = assign(material, { ...base, opacity: base.opacity * entry.multiplier,
        transparent: faded || base.transparent, alphaHash: faded ? false : base.alphaHash,
        alphaToCoverage: faded ? false : base.alphaToCoverage,
        depthWrite: faded ? false : base.depthWrite,
        clipIntersection: original.clipIntersection, clipShadows: original.clipShadows }) || changed;
      const basePlanes = original.clippingPlanes;
      let planes = basePlanes;
      if (entry.cut) {
        let cached = entry.clipArrays.get(index);
        if (!cached || !planesEqual(cached.base, basePlanes)) {
          cached = { base: Array.isArray(basePlanes) ? basePlanes.slice() : basePlanes,
            value: [...(basePlanes || []), entry.cut] };
          entry.clipArrays.set(index, cached);
        }
        planes = cached.value;
      }
      if (!planesEqual(material.clippingPlanes, planes)) {
        const oldLength = material.clippingPlanes?.length || 0;
        material.clippingPlanes = planes;
        if (oldLength !== (planes?.length || 0)) material.needsUpdate = true;
        changed = true;
      }
    });
    return changed;
  }

  _release(entry) {
    // A replacement material owner must never be overwritten by late cleanup.
    const owned = this._owns(entry);
    if (owned) {
      entry.originals.forEach((material, index) => {
        assign(material, this._base(entry, index));
        if (this.context.section) {
          if (material.userData.sectionSide === undefined) material.userData.sectionSide = entry.authoredSides[index];
        } else delete material.userData.sectionSide;
      });
      entry.mesh.material = entry.originalReference;
      if (entry.multiplier !== 1 || entry.cut) {
        this._pending.changed = this._pending.semanticChanged = true;
        if (entry.cut && entry.originals.some((material) => material.clipShadows)) this._pending.shadowChanged = true;
      }
    }
    if (owners.get(entry.mesh) === this) owners.delete(entry.mesh);
    for (const material of new Set(entry.materials)) material.dispose();
  }

  update(now, cameraPosition) {
    const result = { ...this._pending, moving: false };
    this._pending = { changed: false, semanticChanged: false, shadowChanged: false };
    if (this.disposed || !finite(now) || now < 0) return result;
    const policy = this._report.policy;
    if (!policy) return result;
    const cameraValid = Array.isArray(cameraPosition) && cameraPosition.length === 3 && cameraPosition.every(finite);
    const cameraChanged = cameraValid && cameraPosition.some((value, index) => value !== this._camera[index]);
    if (cameraValid) for (let index = 0; index < 3; index++) this._camera[index] = cameraPosition[index];
    const thawed = this._sideFrozen && !this.context.freezeCameraSide;
    this._sideFrozen = !!this.context.freezeCameraSide;
    for (const entry of this.entries.values()) {
      if (!this._owns(entry)) continue; // A late frame cannot write a replacement material owner's appearance.
      const row = entry.row, previousActive = entry.active;
      let active = policy.scope === 'all_selected';
      if (policy.scope === 'camera_side') {
        active = previousActive;
        if (!this.context.freezeCameraSide) {
          entry.mesh.updateWorldMatrix(true, false);
          const face = row.face;
          if (!face || !cameraValid) active = false;
          else {
            const matrix = entry.mesh.matrixWorld.elements;
            const worldChanged = !entry.worldKey || matrix.some((value, index) => value !== entry.worldKey[index]);
            if (worldChanged) {
              entry.worldKey = matrix.slice();
              entry.plane.copy(entry.localPlane).applyMatrix4(entry.mesh.matrixWorld, entry.normalMatrix.getNormalMatrix(entry.mesh.matrixWorld));
            }
            if (worldChanged || cameraChanged || entry.baseDirty || thawed) {
              const side = readWallSide({ constant: entry.plane.constant, normal: entry.plane.normal.toArray() }, cameraPosition, previousActive);
              active = side.valid && side.active;
            }
          }
        }
      }
      entry.active = active;
      const wasCut = !!entry.cut, oldHeight = entry.cut?.constant;
      if (policy.mode === 'cutaway' && active && finite(row.elevation)) {
        entry.cut = entry.wallPlane;
        entry.cut.constant = row.elevation + policy.cut_height_m;
      } else entry.cut = null;
      const cutChanged = wasCut !== !!entry.cut || oldHeight !== entry.cut?.constant;
      if (cutChanged) result.semanticChanged = true;
      if (cutChanged && entry.originals.some((material) => material.clipShadows)) result.shadowChanged = true;
      const target = active && policy.mode !== 'cutaway' ? policy.opacity : 1;
      const previousMultiplier = entry.multiplier;
      if (!entry.transition || entry.transition.moving || entry.transition.target !== target || entry.transition.duration_ms !== policy.transition_ms || entry.baseDirty)
        entry.transition = stepWallTransition(entry.transition, { now, target, duration_ms: policy.transition_ms, reducedMotion: !!this.context.reducedMotion });
      entry.multiplier = entry.transition.value;
      result.moving ||= entry.transition.moving;
      if ((previousMultiplier < 1) !== (entry.multiplier < 1)) result.semanticChanged = true;
      if (entry.baseDirty || previousMultiplier !== entry.multiplier || cutChanged) result.changed = this._apply(entry) || cutChanged || result.changed;
      entry.baseDirty = false;
    }
    return result;
  }

  seeThrough(mesh, materialIndex = 0) {
    const entry = this.entries.get(mesh);
    return !!(entry && this._owns(entry) && entry.materials[materialIndex] && entry.multiplier < 1);
  }

  pointHidden(mesh, point, materialIndex = 0) {
    const entry = this.entries.get(mesh);
    if (!entry || !this._owns(entry) || !entry.materials[materialIndex]) return false;
    return this.seeThrough(mesh, materialIndex) || !!(entry.cut && point
      && entry.cut.distanceToPoint(point.isVector3 ? point : this._point.fromArray(point)) < -1e-6);
  }

  cutHeight(mesh) { return this.entries.get(mesh)?.cut?.constant ?? null; }
  baselineMaterial(mesh, materialIndex = 0) {
    const entry = this.entries.get(mesh);
    return entry && this._owns(entry) ? entry.originals[materialIndex] : Array.isArray(mesh.material) ? mesh.material[materialIndex] : mesh.material;
  }

  dispose() {
    if (this.disposed) return;
    for (const entry of this.entries.values()) this._release(entry);
    this.entries.clear(); this.disposed = true;
  }
}
