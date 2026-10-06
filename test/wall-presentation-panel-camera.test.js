import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { nodeIndex } from '../src/views.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import { WallPresentationLayer } from '../src/wall-presentation-rendering.js';

function fixture({ transitionMs = 0, mode = 'fade', scope = 'camera_side', texture = null } = {}) {
  const root = new THREE.Group(), walls = [], originals = [];
  for (let index = 0; index < 2; index++) {
    const material = new THREE.MeshStandardMaterial({ opacity: .8 }); material.clipShadows = true;
    if (index === 0) material.map = texture;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, .1), material); wall.name = `wall-${index}`;
    wall.position.set(index * 7, index * 3, index * 20); root.add(wall); walls.push(wall); originals.push(material);
  }
  const floors = [{ id: 'ground:west', elevation: 0 }, { id: 'upper floor', elevation: 3 }];
  const raw = { enabled: true, mode, scope, opacity: .2, transition_ms: transitionMs,
    walls: walls.map((wall, index) => ({ id: `exact-${index}`, selector: `node:${wall.name}`, floor_id: floors[index].id,
      face: { space: 'node-local', point: [0, 0, 0], normal: [0, 0, 1] } })) };
  const context = { raw, floors, modelRoot: root, index: nodeIndex(threeAdapter(root), buildManifest(threeAdapter(root))), modelOpacity: 1, eligible: true };
  const layer = new WallPresentationLayer(); layer.setData(context);
  const positions = new Map([[walls[0], [0, 5, 5]], [walls[1], [7, 8, 15]]]);
  const resolver = vi.fn((mesh) => positions.get(mesh));
  return { root, walls, originals, floors, context, layer, positions, resolver, global: [0, 8, 30] };
}
const active = (f) => f.walls.map((wall) => f.layer.entries.get(wall).active);

describe('per-wall floor-panel camera ownership', () => {
  it('uses each displayed floor camera rather than a common house camera', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver);
    expect(active(f)).toEqual([true, false]); expect(f.walls[0].material.opacity).toBeCloseTo(.16, 12); expect(f.walls[1].material.opacity).toBe(.8);
    expect(f.resolver.mock.calls.map(([mesh]) => mesh)).toEqual(f.walls); f.layer.dispose();
  });
  it('reevaluates when returning to the unchanged global camera, and when entering panes again', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver); expect(active(f)).toEqual([true, false]);
    const first = f.layer.update(16, f.global); expect(active(f)).toEqual([true, true]); expect(first.changed).toBe(true);
    const second = f.layer.update(32, f.global, f.resolver); expect(active(f)).toEqual([true, false]); expect(second.changed).toBe(true);
    f.layer.dispose(); expect(f.walls.map((wall) => wall.material)).toEqual(f.originals);
  });
  it('changes only the wall whose pane camera changed, while the global camera stays fixed', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver); const apply = vi.spyOn(f.layer, '_apply');
    f.positions.set(f.walls[1], [7, 8, 25]); const result = f.layer.update(16, f.global, f.resolver);
    expect(active(f)).toEqual([true, true]); expect(result).toMatchObject({ changed: true, shadowChanged: false });
    expect(apply.mock.calls.map(([entry]) => entry.mesh)).toEqual([f.walls[1]]); f.layer.dispose();
  });
  it('copies resolved coordinates into independent caches rather than retaining mutable caller arrays', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver);
    f.positions.get(f.walls[0])[2] = -5; f.layer.update(16, f.global, f.resolver);
    expect(active(f)).toEqual([false, false]); f.layer.dispose();
  });
  it('does no appearance/semantic/shadow work for sixty unchanged pane frames or a changed unused global camera', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver); const clones = f.walls.map((wall) => wall.material), versions = clones.map((material) => material.version);
    const apply = vi.spyOn(f.layer, '_apply');
    for (let frame = 1; frame <= 60; frame++) expect(f.layer.update(frame * 16, [frame, 8, 30], f.resolver))
      .toEqual({ changed: false, semanticChanged: false, shadowChanged: false, moving: false });
    expect(apply).not.toHaveBeenCalled(); expect(f.walls.map((wall) => wall.material)).toEqual(clones); expect(clones.map((material) => material.version)).toEqual(versions);
    f.layer.dispose();
  });
  it('uses new resolver coordinates without requiring a context rebuild or fresh material copies', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver); const references = f.walls.map((wall) => wall.material);
    const changedResolver = (wall) => wall === f.walls[0] ? [0, 5, -5] : [7, 8, 25];
    f.layer.update(16, f.global, changedResolver); expect(active(f)).toEqual([false, true]);
    expect(f.walls.map((wall) => wall.material)).toEqual(references); f.layer.dispose();
  });
});

describe('missing or invalid pane cameras fail closed', () => {
  it.each([null, undefined, [0, 0], [0, 0, NaN], [0, 0, Infinity], new Array(3), 'camera', new THREE.Vector3(0, 0, 5)].map((value) => [value]))('keeps a wall authored for resolver result %j', (value) => {
    const f = fixture(); f.layer.update(0, f.global, (wall) => wall === f.walls[0] ? value : [7, 8, 25]);
    expect(active(f)).toEqual([false, true]); expect(f.walls[0].material.opacity).toBe(.8); expect(f.walls[1].material.opacity).toBeCloseTo(.16, 12);
    f.layer.dispose();
  });
  it.each([null, false, {}, []].map((value) => [value]))('does not silently use the master camera for malformed resolver %j', (resolver) => {
    const f = fixture(); f.layer.update(0, f.global, resolver); expect(active(f)).toEqual([false, false]);
    expect(f.walls.map((wall) => wall.material.opacity)).toEqual([.8, .8]); f.layer.dispose();
  });
  it('contains a resolver throw to that wall and restores baseline appearance', () => {
    const f = fixture(); f.layer.update(0, f.global, () => [0, 8, 30]); expect(active(f)).toEqual([true, true]);
    expect(() => f.layer.update(16, f.global, (wall) => { if (wall === f.walls[0]) throw new Error('old pane'); return [7, 8, 25]; })).not.toThrow();
    expect(active(f)).toEqual([false, true]); expect(f.walls[0].material.opacity).toBe(.8); f.layer.dispose();
  });
  it('contains an unreadable coordinate returned by a pane resolver', () => {
    const f = fixture(), unreadable = [0, 5, 5]; Object.defineProperty(unreadable, 2, { get() { throw new Error('old camera'); } });
    expect(() => f.layer.update(0, f.global, (wall) => wall === f.walls[0] ? unreadable : [7, 8, 25])).not.toThrow();
    expect(active(f)).toEqual([false, true]); f.layer.dispose();
  });
  it('recovers the same valid coordinates after a missing pane without relying on a global movement', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver); f.positions.set(f.walls[0], null);
    f.layer.update(16, f.global, f.resolver); expect(active(f)).toEqual([false, false]);
    f.positions.set(f.walls[0], [0, 5, 5]); f.layer.update(32, f.global, f.resolver); expect(active(f)).toEqual([true, false]); f.layer.dispose();
  });
  it('fails closed for a disappeared pane even during side freeze', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver); f.layer.setData({ ...f.context, freezeCameraSide: true });
    f.positions.set(f.walls[0], null); f.layer.update(16, f.global, f.resolver); expect(active(f)).toEqual([false, false]); f.layer.dispose();
  });
});

describe('wall world transforms, hysteresis and lifecycle with panes', () => {
  it('retains independent five-centimetre hysteresis and reevaluates outside it', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver);
    f.positions.set(f.walls[0], [0, 5, -.02]); f.positions.set(f.walls[1], [7, 8, 20.02]);
    f.layer.update(16, f.global, f.resolver); expect(active(f)).toEqual([true, false]);
    f.positions.set(f.walls[0], [0, 5, -.06]); f.positions.set(f.walls[1], [7, 8, 20.06]);
    f.layer.update(32, f.global, f.resolver); expect(active(f)).toEqual([false, true]); f.layer.dispose();
  });
  it('freezes valid camera-side changes, then thaws each wall using its latest pane camera', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver);
    f.layer.setData({ ...f.context, freezeCameraSide: true }); f.positions.set(f.walls[0], [0, 5, -5]); f.positions.set(f.walls[1], [7, 8, 25]);
    f.layer.update(16, f.global, f.resolver); expect(active(f)).toEqual([true, false]);
    f.layer.setData({ ...f.context, freezeCameraSide: false }); f.layer.update(32, f.global, f.resolver); expect(active(f)).toEqual([false, true]); f.layer.dispose();
  });
  it('reevaluates transformed world planes while a pane camera remains fixed', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver); f.walls[0].rotation.y = Math.PI; f.walls[0].position.z = 2;
    f.layer.update(16, f.global, f.resolver); expect(active(f)).toEqual([false, false]); f.layer.dispose();
  });
  it('keeps cut planes and shared texture references, requesting shadows only for semantic cut changes', () => {
    const texture = new THREE.Texture(), f = fixture({ mode: 'cutaway', texture });
    f.layer.setData({ ...f.context, modelOpacity: .9 }); const references = f.walls.map((wall) => wall.material);
    expect(f.layer.update(0, f.global, f.resolver).shadowChanged).toBe(true); const cut = f.walls[0].material.clippingPlanes[0];
    expect(f.layer.cutHeight(f.walls[0])).toBe(1.2); expect(f.layer.cutHeight(f.walls[1])).toBeNull();
    f.positions.set(f.walls[0], [0, 5, -5]); expect(f.layer.update(16, f.global, f.resolver).shadowChanged).toBe(true);
    f.positions.set(f.walls[0], [0, 5, 5]); expect(f.layer.update(32, f.global, f.resolver).shadowChanged).toBe(true);
    expect(f.walls[0].material.clippingPlanes[0]).toBe(cut); expect(f.walls[0].material.map).toBe(texture);
    expect(f.walls.map((wall) => wall.material)).toEqual(references); expect(f.layer.update(48, f.global, f.resolver).shadowChanged).toBe(false); f.layer.dispose();
  });
  it('keeps transition work on the existing clock and reduced motion snaps the resolved side', () => {
    const f = fixture({ transitionMs: 250 }); f.layer.update(0, f.global, f.resolver);
    expect(f.layer.moving).toBe(true); for (let time = 50; time <= 250; time += 50) f.layer.update(time, f.global, f.resolver);
    expect(f.walls[0].material.opacity).toBeCloseTo(.16, 12); expect(f.walls[1].material.opacity).toBe(.8); expect(f.layer.moving).toBe(false);
    f.layer.setData({ ...f.context, reducedMotion: true }); f.positions.set(f.walls[0], [0, 5, -5]);
    f.layer.update(266, f.global, f.resolver); expect(f.walls[0].material.opacity).toBe(.8); expect(f.layer.moving).toBe(false); f.layer.dispose();
  });
  it('does not consult pane cameras for all-selected scope', () => {
    const f = fixture({ scope: 'all_selected' }), resolver = vi.fn(() => { throw new Error('not needed'); });
    f.layer.update(0, null, resolver); expect(active(f)).toEqual([true, true]); expect(resolver).not.toHaveBeenCalled(); f.layer.dispose();
  });
  it('never evaluates or overwrites a foreign material owner during pane updates or cleanup', () => {
    const f = fixture(); f.layer.update(0, f.global, f.resolver); const clone = f.walls[0].material, dispose = vi.spyOn(clone, 'dispose');
    const foreign = new THREE.MeshStandardMaterial({ opacity: .7 }); f.walls[0].material = foreign; f.resolver.mockClear();
    f.positions.set(f.walls[1], [7, 8, 25]); f.layer.update(16, f.global, f.resolver);
    expect(f.resolver.mock.calls.map(([mesh]) => mesh)).toEqual([f.walls[1]]); expect(foreign.opacity).toBe(.7); f.layer.dispose();
    expect(f.walls[0].material).toBe(foreign); expect(dispose).toHaveBeenCalledTimes(1); expect(foreign.opacity).toBe(.7);
  });
});
