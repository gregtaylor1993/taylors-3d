import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { nodeIndex } from '../src/views.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import { WallPresentationLayer } from '../src/wall-presentation-rendering.js';

function fixture({ clipShadows = true, multiple = false } = {}) {
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, .1), new THREE.MeshStandardMaterial({ opacity: .8 })); mesh.name = 'wall'; root.add(mesh);
  const original = mesh.material, texture = new THREE.Texture(), basePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 20);
  Object.assign(original.userData, { baseOpacity: .8, wasTransparent: false, baseDepthWrite: true });
  Object.assign(original, { map: texture, clippingPlanes: [basePlane], clipShadows });
  if (multiple) mesh.material = [original, original];
  const reference = mesh.material, shared = new THREE.Mesh(mesh.geometry, original); shared.name = 'furniture'; root.add(shared);
  const index = nodeIndex(threeAdapter(root), buildManifest(threeAdapter(root))), floors = [{ id: 'ground', elevation: 2 }];
  const raw = { enabled: true, mode: 'fade', scope: 'all_selected', opacity: .2, transition_ms: 0,
    walls: [{ id: 'wall', selector: 'node:wall', floor_id: 'ground', face: { space: 'node-local', point: [0, 0, 0], normal: [0, 0, 1] } }] };
  const context = { raw, index, floors, modelRoot: root, modelOpacity: 1, eligible: true }, layer = new WallPresentationLayer();
  return { root, mesh, original, shared, texture, basePlane, reference, context, layer };
}

describe('owned wall material lifecycle', () => {
  it('changes only selected copies and restores latest global ghost/Section with no texture or geometry disposal', () => {
    const f = fixture(), materialDispose = vi.spyOn(f.original, 'dispose'), textureDispose = vi.spyOn(f.texture, 'dispose'), geometryDispose = vi.spyOn(f.mesh.geometry, 'dispose');
    f.layer.setData(f.context); const clone = f.mesh.material, dispose = vi.spyOn(clone, 'dispose'); f.layer.update(0, [0, 0, 5]);
    expect(clone).not.toBe(f.original); expect(clone.map).toBe(f.texture); expect(f.shared.material).toBe(f.original); expect(f.original.opacity).toBe(.8);
    expect(clone.opacity).toBeCloseTo(.16, 12); expect(clone.depthWrite).toBe(false); expect(clone.transparent).toBe(true);
    f.layer.setData({ ...f.context, modelOpacity: .35, section: {}, eligible: false }); f.layer.update(1, [0, 0, 5]);
    expect(f.mesh.material).toBe(f.reference); expect(f.original.opacity).toBe(.35); expect(f.original.side).toBe(THREE.DoubleSide); expect(f.original.userData.sectionSide).toBe(THREE.FrontSide);
    expect(dispose).toHaveBeenCalledTimes(1); expect(materialDispose).not.toHaveBeenCalled(); expect(textureDispose).not.toHaveBeenCalled(); expect(geometryDispose).not.toHaveBeenCalled();
    f.layer.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('preserves array shape/shared slot identity and disposes an owned clone once', () => {
    const f = fixture({ multiple: true }); f.layer.setData(f.context);
    expect(f.mesh.material[0]).toBe(f.mesh.material[1]); const dispose = vi.spyOn(f.mesh.material[0], 'dispose');
    f.layer.update(0, [0, 0, 5]); f.layer.dispose(); expect(f.mesh.material).toBe(f.reference); expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite a replacement owner during a late frame or cleanup', () => {
    const f = fixture(); f.layer.setData(f.context); const clone = f.mesh.material, dispose = vi.spyOn(clone, 'dispose'); f.layer.update(0, [0, 0, 5]);
    const foreign = new THREE.MeshStandardMaterial({ opacity: .7 }); f.mesh.material = foreign;
    expect(f.layer.update(10, [0, 0, -5]).changed).toBe(false); expect(f.layer.pointHidden(f.mesh, [0, 30, 0])).toBe(false);
    f.layer.dispose(); expect(f.mesh.material).toBe(foreign); expect(foreign.opacity).toBe(.7); expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('rejects two live wall material writers without touching the first owner', () => {
    const f = fixture(); f.layer.setData(f.context); f.layer.update(0, [0, 0, 5]); const first = f.mesh.material, other = new WallPresentationLayer();
    other.setData(f.context); expect(other.entries.size).toBe(0); expect(other.report().diagnostics.map((entry) => entry.code)).toContain('material_writer');
    other.dispose(); expect(f.mesh.material).toBe(first); f.layer.dispose(); expect(f.mesh.material).toBe(f.original);
  });
  it('keeps report row arrays private and ignores equal context/camera frames without material writes', () => {
    const f = fixture(); f.layer.setData(f.context); f.layer.update(0, [0, 0, 5]);
    const clone = f.mesh.material, version = clone.version, planes = clone.clippingPlanes;
    const report = f.layer.report(); report.rows[0].face.normal[2] = -1; report.rows[0].diagnostics.push({ code: 'foreign' });
    expect(f.layer.report().rows[0].face.normal[2]).toBe(1); expect(f.layer.report().rows[0].diagnostics).toHaveLength(0);
    for (let count = 1; count <= 60; count++) { f.layer.setData(f.context); expect(f.layer.update(count * 16, [0, 0, 5])).toMatchObject({ changed: false, semanticChanged: false, shadowChanged: false, moving: false }); }
    expect(f.mesh.material).toBe(clone); expect(clone.version).toBe(version); expect(clone.clippingPlanes).toBe(planes); f.layer.dispose();
  });
});

describe('actual plane/cut/transition semantics', () => {
  it.each([false, true])('composes selected floor cut and preserves clipShadows=%s with semantic-only shadow flags', (clipShadows) => {
    const f = fixture({ clipShadows }); f.context.raw = { ...f.context.raw, mode: 'cutaway' };
    f.layer.setData(f.context); expect(f.layer.update(0, [0, 0, 5]).shadowChanged).toBe(clipShadows);
    const clone = f.mesh.material, cut = clone.clippingPlanes[1]; expect(clone.clippingPlanes[0]).toBe(f.basePlane); expect(cut.constant).toBe(3.2); expect(clone.clipShadows).toBe(clipShadows);
    expect(f.layer.pointHidden(f.mesh, [0, 4, 0])).toBe(true); expect(f.layer.pointHidden(f.mesh, [0, 3, 0])).toBe(false);
    expect(f.layer.update(16, [0, 0, 5])).toMatchObject({ changed: false, semanticChanged: false, shadowChanged: false });
    f.layer.setData({ ...f.context, floors: [{ id: 'ground', elevation: 5 }] }); expect(f.layer.update(32, [0, 0, 5]).shadowChanged).toBe(clipShadows);
    expect(clone.clippingPlanes[1]).toBe(cut); expect(cut.constant).toBe(6.2); expect(f.original.clippingPlanes).toEqual([f.basePlane]); f.layer.dispose();
  });
  it('reuses the same cut plane/cache through side reversals and respects node rotation/translation', () => {
    const f = fixture(); f.context.raw = { ...f.context.raw, mode: 'cutaway', scope: 'camera_side' }; f.layer.setData(f.context);
    f.layer.update(0, [0, 0, 5]); const cut = f.mesh.material.clippingPlanes[1], planeArray = f.mesh.material.clippingPlanes;
    f.layer.update(16, [0, 0, -5]); expect(f.mesh.material.clippingPlanes).toEqual([f.basePlane]);
    f.layer.update(32, [0, 0, 5]); expect(f.mesh.material.clippingPlanes).toBe(planeArray); expect(f.mesh.material.clippingPlanes[1]).toBe(cut);
    f.mesh.rotation.y = Math.PI; f.mesh.position.z = 2;
    f.layer.update(48, [0, 0, 5]); expect(f.layer.cutHeight(f.mesh)).toBeNull();
    f.layer.update(64, [0, 0, -5]); expect(f.layer.cutHeight(f.mesh)).toBe(3.2); f.layer.dispose();
  });
  it('freezes ambient side only; reduced motion still reevaluates actual camera and snaps', () => {
    const f = fixture(); f.context.raw = { ...f.context.raw, scope: 'camera_side', transition_ms: 250 }; f.layer.setData({ ...f.context, reducedMotion: true });
    f.layer.update(0, [0, 0, 5]); expect(f.mesh.material.opacity).toBeCloseTo(.16, 12);
    f.layer.setData({ ...f.context, reducedMotion: true, freezeCameraSide: true }); f.layer.update(16, [0, 0, -5]); expect(f.layer.entries.get(f.mesh).active).toBe(true);
    f.layer.setData({ ...f.context, reducedMotion: true, freezeCameraSide: false }); f.layer.update(32, [0, 0, -5]); expect(f.layer.entries.get(f.mesh).active).toBe(false); expect(f.mesh.material.opacity).toBe(.8);
    f.layer.dispose();
  });
  it('fades on the existing explicit monotonic frames, with one through-boundary and no opacity shadow changes', () => {
    const f = fixture(); f.context.raw = { ...f.context.raw, transition_ms: 250 }; f.layer.setData(f.context);
    f.layer.update(0, [0, 0, 5]); const flags = [];
    for (let time = 50; time <= 250; time += 50) flags.push(f.layer.update(time, [0, 0, 5]));
    expect(flags.filter((result) => result.semanticChanged)).toHaveLength(1); expect(flags.every((result) => !result.shadowChanged)).toBe(true);
    expect(f.mesh.material.opacity).toBeCloseTo(.16, 12); expect(f.layer.moving).toBe(false); f.layer.dispose();
  });
});
