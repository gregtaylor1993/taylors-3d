// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FloorplanView } from '../src/view.js';
import { ObjectLayer } from '../src/objects/layer.js';
import { SecurityLayer } from '../src/security.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';

const close = (actual, expected) => actual.toArray().forEach((v, i) => expect(v).toBeCloseTo(expected[i], 8));
function fixture({ mounted = true, climate = false, spot = false, target } = {}) {
  const root = new THREE.Group(), level = new THREE.Group(), door = new THREE.Group(), leaf = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .1), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
  level.userData.fp = { kind: 'level', id: 'ground', role: 'storey' }; door.userData.fp = { kind: 'object', type: 'door', id: 'door' };
  leaf.name = 'leaf'; leaf.position.set(1, 1, 0); root.add(level); level.add(door); door.add(leaf);
  const addObject = (parent, id, type, position, hints = {}) => {
    const node = new THREE.Group(); node.userData.fp = { kind: 'object', type, id, hints }; node.position.set(...position);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial()); glow.name = 'glow'; node.add(glow); parent.add(node); return node;
  };
  const lamp = mounted ? addObject(leaf, 'mounted', 'light', [.5, 0, .2], { ...(spot ? { beam: 'spot', target } : {}), offset: [.2, .3, .4] }) : null;
  const label = climate ? addObject(leaf, 'climate', 'climate', [-.3, .2, 0]) : null;
  const other = addObject(level, 'other', 'light', [4, 2, 0]);
  const model = { id: 'house', root, manifest: buildManifest(threeAdapter(root)), opacity: 1 };
  const view = Object.create(FloorplanView.prototype);
  Object.assign(view, { scene: new THREE.Scene(), modelGroup: new THREE.Group(), objectsGroup: new THREE.Group(), model,
    floors: [{ id: 'ground', elevation: 0, height: 2.7 }], _rooms: [], cssObjects: [], modelClip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), sectionClip: null,
    camera: new THREE.PerspectiveCamera(50, 1, .1, 100), ortho: new THREE.OrthographicCamera(-5, 5, 5, -5), controls: { target: new THREE.Vector3(1, 1, -2) },
    mode: '3d', sky: { sunDir: null }, sun: new THREE.DirectionalLight(0xffffff, 1), renderer: { shadowMap: { needsUpdate: false } },
    stats: { occPasses: 0, occPartial: 0, occDone: 0, shadow: 0, shadowLights: 0, frames: 0 }, _occGen: 0, _raf: null, _occTimer: null, _occFull: false,
    _placeSkyBodies: vi.fn(), _applyMoonLight: vi.fn(), pickHelper: { update: vi.fn() }, onObjectsInvalidate: vi.fn() });
  view.scene.add(view.modelGroup, view.objectsGroup, view.sun); view.modelGroup.add(root);
  view.camera.position.set(1, 1, 5); view.camera.lookAt(view.controls.target); view.camera.updateMatrixWorld(true); root.updateMatrixWorld(true);
  const objects = new ObjectLayer(view); objects.setModel(model);
  objects.setBindings(new Map([['mounted', { entity: 'light.mounted' }], ['other', { entity: 'light.other' }], ['climate', { entity: 'climate.one' }]]), {});
  const states = { 'light.mounted': { state: 'on', attributes: {} }, 'light.other': { state: 'off', attributes: {} }, 'climate.one': { state: 'heat', attributes: { hvac_action: 'heating', current_temperature: 21 } } };
  objects.update(states); view._captureModelMotion(); view._bounds = view._sceneBounds(); view._shadowSig = view._modelSig();
  view.dirty = false; view.stats.shadow = 0; view.stats.shadowLights = 0; view.renderer.shadowMap.needsUpdate = false;
  return { view, objects, model, root, level, door, leaf, lamp, label, other, states };
}
const contact = (open = true) => ({ states: { 'binary_sensor.door': { state: open ? 'on' : 'off', attributes: { device_class: 'door' } } } });
const settings = { id: 'front', entity: 'binary_sensor.door', object_id: 'door', kind: 'door', open_states: ['on'], closed_states: ['off'], motion: { target: 'leaf', pivot: [0, 0, 0], axis: [0, 1, 0], closed_degrees: 0, open_degrees: 90, duration_ms: 200 } };
const animate = (f) => { const security = new SecurityLayer(); security.setModel(f.model); return security; };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('moving model anchors and existing light slots', () => {
  it('refreshes related object/glow anchors and live labels without changing HA looks or allocating lights', () => {
    const f = fixture({ climate: true }); const before = f.objects.anchorOf('mounted'), unrelated = f.objects.anchorOf('other');
    const slot = f.objects._slots.get('mounted'), pool = [...f.objects.pool.points, ...f.objects.pool.spots];
    const evaluated = f.objects.stats.evaluated, budget = f.objects.stats.budget, prepare = vi.spyOn(f.objects.parts.get('mounted').type, 'prepare');
    f.leaf.rotation.y = Math.PI / 2;
    const result = f.objects.refreshAnchors(new Set([f.leaf]));
    expect(result.changed).toBe(true); expect(result.objectIds).toEqual(new Set(['door', 'mounted', 'climate']));
    expect(result.roots).toEqual(new Set([f.door, f.lamp, f.label])); expect(f.objects.anchorOf('mounted').distanceTo(before)).toBeGreaterThan(.1);
    expect(f.objects.anchorOf('other').equals(unrelated)).toBe(true); expect(f.objects._slots.get('mounted')).toBe(slot);
    close(slot.light.position, f.objects.anchorOf('mounted').toArray());
    close(f.objects.parts.get('climate').part.label.position, f.objects.anchorOf('climate').toArray());
    expect([...f.objects.pool.points, ...f.objects.pool.spots]).toEqual(pool); expect(f.objects.stats.evaluated).toBe(evaluated); expect(f.objects.stats.budget).toBe(budget); expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore(); f.objects.dispose();
  });
  it('leaves repeated/current anchors idle, including unchanged HA updates after refresh', () => {
    const f = fixture(); f.leaf.rotation.y = .7; f.objects.refreshAnchors([f.leaf]);
    const dirty = vi.spyOn(f.view, 'markDirty'), shadows = vi.spyOn(f.view, 'requestShadowUpdate'); f.view.dirty = false;
    for (let i = 0; i < 4; i++) {
      expect(f.objects.refreshAnchors([f.leaf]).changed).toBe(false); f.objects.update({ ...f.states });
    }
    expect(dirty).not.toHaveBeenCalled(); expect(shadows).not.toHaveBeenCalled(); expect(f.view.dirty).toBe(false); f.objects.dispose();
  });
  it('preserves the existing root-local offset convention under rotated/scaled ancestors', () => {
    const f = fixture(); f.root.position.set(10, 3, 5); f.root.rotation.y = Math.PI / 2; f.root.scale.setScalar(2); f.leaf.rotation.y = .4;
    f.objects.refreshAnchors([f.leaf]);
    const physical = f.lamp.children[0].getWorldPosition(new THREE.Vector3());
    close(f.objects.anchorOf('mounted'), [physical.x + .8, physical.y + .6, physical.z - .4]); f.objects.dispose();
  });
  it('updates world anchors when the model root moves even though cached root-local coordinates do not', () => {
    const f = fixture(); const beforeLocal = f.objects.parts.get('mounted').part.anchor.clone(), beforeWorld = f.objects.anchorOf('mounted');
    f.root.position.x += 5; const result = f.objects.refreshAnchors([f.root]);
    expect(f.objects.parts.get('mounted').part.anchor.equals(beforeLocal)).toBe(true); expect(result.objectIds.has('mounted')).toBe(true);
    close(f.objects.anchorOf('mounted'), [beforeWorld.x + 5, beforeWorld.y, beforeWorld.z]); close(f.objects._slots.get('mounted').light.position, f.objects.anchorOf('mounted').toArray()); f.objects.dispose();
  });
  it('keeps explicit anchors ahead of box fallback and preserves generic ignored offsets', () => {
    const f = fixture({ mounted: false }); const entry = f.model.manifest.objects.find((obj) => obj.id === 'door');
    entry.anchor = [0, 0, 0]; entry.hints = { offset: [100, 100, 100] };
    f.objects.setModel(null); f.objects.setModel(f.model);
    f.leaf.rotation.y = .7; expect(f.objects.refreshAnchors([f.leaf]).objectIds.has('door')).toBe(false);
    close(f.objects.anchorOf('door'), [0, 0, 0]); f.door.position.x = 2; expect(f.objects.refreshAnchors([f.door]).objectIds.has('door')).toBe(true); close(f.objects.anchorOf('door'), [2, 0, 0]); f.objects.dispose();
  });
  it.each([undefined, [1, 0, 2]])('moves spot anchors while retaining authored target semantics %j', (target) => {
    const f = fixture({ spot: true, target }); const slot = f.objects._slots.get('mounted'); f.leaf.rotation.y = .7;
    f.objects.refreshAnchors([f.leaf]); close(slot.light.position, f.objects.anchorOf('mounted').toArray());
    close(slot.light.target.position, target || [slot.light.position.x, slot.light.position.y - 1, slot.light.position.z]);
    expect(slot.light.castShadow).toBe(false); f.objects.dispose();
  });
  it('ignores detached/wrong-model targets and exposes no stale objects after model removal', () => {
    const f = fixture(); const result = f.objects.refreshAnchors(new Set([new THREE.Group(), null, 'leaf']));
    expect(result).toEqual({ changed: false, objectIds: new Set(), roots: new Set(), anchors: [] });
    f.objects.setModel(null); expect(f.objects.refreshAnchors([f.leaf]).changed).toBe(false); f.objects.dispose();
  });
});

describe('model motion cache invalidation', () => {
  it('keeps the exact baseline bounds/signatures and renderer idle for unchanged or absent targets', () => {
    const f = fixture(), oldBounds = f.view._bounds, oldSig = f.view._shadowSig, boxes = f.view._occluders();
    const fit = vi.spyOn(f.view, '_fitShadow'), cancel = vi.spyOn(f.view, '_cancelOcclusion'), schedule = vi.spyOn(f.view, '_scheduleOcclusion');
    for (const targets of [[], [f.leaf], [new THREE.Group()], new Set([null])]) expect(f.view.modelMotionChanged(targets).changed).toBe(false);
    expect(f.view._bounds).toBe(oldBounds); expect(f.view._occBoxes).toBe(boxes); expect(f.view._shadowSig).toBe(oldSig); expect(f.view.dirty).toBe(false);
    expect(fit).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled(); expect(schedule).not.toHaveBeenCalled(); expect(f.view.stats.shadow).toBe(0); f.objects.dispose();
  });
  it('refreshes bounds, picks, dynamic anchors and existing caster shadows once for actual movement', () => {
    const f = fixture(), security = animate(f); const oldSig = f.view._modelSig(), oldBounds = f.view._bounds; f.view._occluders();
    security.setData({ hass: contact(), bindings: [settings], now: 1000, animationNow: 0, reducedMotion: true });
    const changes = security.takeMotionChanges(), result = f.view.modelMotionChanged(changes.changedMotionTargets);
    expect(result.changed).toBe(true); expect(result.objectIds.has('mounted')).toBe(true); expect(f.view._occBoxes).toBeNull(); expect(f.view._bounds).not.toBe(oldBounds);
    expect(f.view._modelSig()).not.toBe(oldSig); expect(f.view._shadowSig).toBe(f.view._modelSig()); expect(f.view.stats.shadow).toBe(1);
    expect(f.view.renderer.shadowMap.needsUpdate).toBe(true); expect(f.view.sun.shadow.needsUpdate).toBe(true); expect(f.objects._slots.get('mounted').light.shadow.needsUpdate).toBe(true);
    expect(f.view.pickHelper.update).toHaveBeenCalledOnce(); expect(f.view.onObjectsInvalidate).not.toHaveBeenCalled(); expect(f.view.dirty).toBe(true);
    security.dispose(); f.objects.dispose();
  });
  it('updates stale occluder boxes when a previously open door closes in front of a marker', () => {
    const f = fixture({ mounted: false }), security = animate(f), behind = new THREE.Vector3(1, 1, -2);
    expect(f.view.pointHidden(behind)).toBe(true);
    security.setData({ hass: contact(), bindings: [settings], now: 1000, animationNow: 0, reducedMotion: true });
    f.view.modelMotionChanged(security.takeMotionChanges().changedMotionTargets); expect(f.view.pointHidden(behind)).toBe(false); const openBoxes = f.view._occBoxes;
    security.setData({ hass: contact(false), bindings: [settings], now: 1000, animationNow: 0, reducedMotion: true });
    expect(f.view._occBoxes).toBe(openBoxes); expect(f.view.pointHidden(behind)).toBe(false); // Old box prefilter wrongly excludes the now-closed leaf.
    f.view.modelMotionChanged(security.takeMotionChanges().changedMotionTargets); expect(f.view.pointHidden(behind)).toBe(true); security.dispose(); f.objects.dispose();
  });
  it('debounces/cancels occlusion while a door moves and settles exactly once with no trailing render loop', () => {
    vi.useFakeTimers(); const f = fixture(); f.view._raf = 1; f.view._runOcclusion = vi.fn();
    f.view._scheduleOcclusion(0); expect(vi.getTimerCount()).toBe(1);
    f.view.modelMotionChanged([], { moving: true }); expect(vi.getTimerCount()).toBe(0);
    f.leaf.rotation.y = .4; f.view.modelMotionChanged([f.leaf], { moving: true });
    f.view._scheduleOcclusion(0); expect(vi.getTimerCount()).toBe(0);
    f.view.dirty = false; f.view.modelMotionChanged([], { moving: false }); expect(vi.getTimerCount()).toBe(1); expect(f.view.dirty).toBe(false);
    f.view.modelMotionChanged([], { moving: false }); expect(vi.getTimerCount()).toBe(1); vi.runAllTimers(); expect(f.view._runOcclusion).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0); f.objects.dispose();
  });
  it('does not rerun shadows/bounds for repeated target notifications, including cached descendants', () => {
    const f = fixture(); f.door.rotation.y = .4; f.view.modelMotionChanged([f.door]);
    const bounds = f.view._bounds, revision = f.view._modelMotionRevision, shadow = f.view.stats.shadow; f.view.dirty = false;
    expect(f.view.modelMotionChanged([f.door, f.leaf, f.lamp]).changed).toBe(false);
    expect(f.view._bounds).toBe(bounds); expect(f.view._modelMotionRevision).toBe(revision); expect(f.view.stats.shadow).toBe(shadow); expect(f.view.dirty).toBe(false); f.objects.dispose();
  });
  it('recapturing the same placed model preserves a live motion gate and its current geometry revision', () => {
    const f = fixture(); f.leaf.rotation.y = .4; f.view.modelMotionChanged([f.leaf], { moving: true });
    const revision = f.view._modelMotionRevision; f.view._captureModelMotion();
    expect(f.view._modelMotionMoving).toBe(true); expect(f.view._modelMotionRevision).toBe(revision);
    expect(f.view.modelMotionChanged([f.leaf], { moving: true }).changed).toBe(false); f.objects.dispose();
  });
  it('neutral restore invalidates stale geometry once, while paint-only state changes do not', () => {
    const f = fixture(), security = animate(f);
    security.setData({ hass: contact(), bindings: [settings], now: 1000, animationNow: 0, reducedMotion: true }); f.view.modelMotionChanged(security.takeMotionChanges().changedMotionTargets);
    const opened = f.view._modelSig(); security.setData({ hass: { states: { 'binary_sensor.door': { state: 'unknown', attributes: { device_class: 'door' } } } }, bindings: [settings], now: 1000 });
    expect(f.view.modelMotionChanged(security.takeMotionChanges().changedMotionTargets).changed).toBe(true); expect(f.view._modelSig()).not.toBe(opened);
    f.view.dirty = false; expect(f.view.modelMotionChanged(security.takeMotionChanges().changedMotionTargets).changed).toBe(false); expect(f.view.dirty).toBe(false); security.dispose(); f.objects.dispose();
  });
  it('uses current actual bounds to update depth and the same sun shadow camera', () => {
    const f = fixture({ mounted: false }); const camera = f.view.sun.shadow.camera, projection = vi.spyOn(camera, 'updateProjectionMatrix');
    f.leaf.position.x = 80; f.view.modelMotionChanged([f.leaf]);
    expect(f.view.sun.shadow.camera).toBe(camera); expect(camera.right).toBeGreaterThan(40); expect(camera.far).toBeGreaterThan(200);
    expect(f.view._bounds.house.max.x).toBeGreaterThan(80); expect(projection).toHaveBeenCalledOnce(); expect(f.view.camera.far).toBeGreaterThan(80); f.objects.dispose();
  });
  it('keeps nighttime shadow maps deferred and detached cards free of occlusion timers', () => {
    vi.useFakeTimers(); const f = fixture(); f.view.sun.intensity = 0;
    f.objects.update({ 'light.mounted': { state: 'off', attributes: {} }, 'light.other': { state: 'off', attributes: {} } });
    f.view.renderer.shadowMap.needsUpdate = false; f.leaf.rotation.y = .4; f.view.modelMotionChanged([f.leaf]);
    expect(f.view._sunStale).toBe(true); expect(f.view.renderer.shadowMap.needsUpdate).toBe(false); expect(vi.getTimerCount()).toBe(0); f.objects.dispose();
  });
  it('ignores stale targets after model replacement/disposal and clears motion gating on stop', () => {
    vi.useFakeTimers(); vi.stubGlobal('cancelAnimationFrame', vi.fn()); const f = fixture(), oldLeaf = f.leaf;
    const replacement = fixture(); f.view.model = replacement.model; f.view.modelGroup.clear(); f.view.modelGroup.add(replacement.root); f.view._captureModelMotion(); f.view.dirty = false;
    expect(f.view.modelMotionChanged([oldLeaf], { moving: true }).changed).toBe(false); expect(f.view.dirty).toBe(false); expect(f.view._modelMotionMoving).toBe(false);
    f.view._raf = 1; f.view.modelMotionChanged([], { moving: true }); f.view.stop(); expect(f.view._modelMotionMoving).toBe(false); expect(vi.getTimerCount()).toBe(0);
    f.view._disposed = true; expect(f.view.modelMotionChanged([replacement.leaf]).changed).toBe(false); f.objects.dispose(); replacement.objects.dispose();
  });
});
