// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FloorplanView } from '../src/view.js';
import { ObjectLayer } from '../src/objects/layer.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';

const state = (on = true, brightness = 255, rgb = [255, 255, 255]) => ({ entity_id: 'light.lamp', state: on ? 'on' : 'off',
  attributes: { supported_color_modes: ['rgb'], color_mode: 'rgb', brightness, rgb_color: rgb } });
function fixture({ lamp = true, castShadow } = {}) {
  const root = new THREE.Group(), level = new THREE.Group(), leaf = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .1), new THREE.MeshStandardMaterial());
  level.userData.fp = { kind: 'level', id: 'ground', role: 'storey' }; root.add(level); level.add(leaf); leaf.position.set(1, 1, 0); leaf.castShadow = true;
  const mount = new THREE.Group(); mount.userData.fp = { kind: 'object', type: 'light', id: 'lamp', hints: castShadow === undefined ? {} : { castShadow } };
  mount.position.set(.5, .2, .2); const glow = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial()); glow.name = 'glow'; mount.add(glow); leaf.add(mount);
  const model = { id: 'house', root, manifest: buildManifest(threeAdapter(root)), opacity: 1 };
  const view = Object.create(FloorplanView.prototype);
  Object.assign(view, { scene: new THREE.Scene(), modelGroup: new THREE.Group(), objectsGroup: new THREE.Group(), model,
    floors: [{ id: 'ground', elevation: 0, height: 2.7 }], _rooms: [], cssObjects: [], visibleFloor: 'all', glows: new Map(), stems: new Map(), markerObjects: new Map(),
    staticGroup: new THREE.Group(), overlayGroup: new THREE.Group(), modelClip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), sectionClip: null,
    camera: new THREE.PerspectiveCamera(50, 1, .1, 100), ortho: new THREE.OrthographicCamera(-5, 5, 5, -5), controls: { target: new THREE.Vector3(1, 1, -2) },
    mode: '3d', daylight: true, sky: { sunDir: null, night: 0, sun: 1 }, sun: new THREE.DirectionalLight(0xffffff, 1),
    hemi: new THREE.HemisphereLight(), moonLight: new THREE.DirectionalLight(0xffffff, 0), renderer: { shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false }, setClearColor: vi.fn() },
    stats: { occPasses: 0, occPartial: 0, occDone: 0, shadow: 0, shadowLights: 0, frames: 0 }, _occGen: 0, _raf: null, _occTimer: null, _occFull: false,
    _placeSkyBodies: vi.fn(), _applyMoonLight: vi.fn(), pickHelper: { update: vi.fn() }, onObjectsInvalidate: vi.fn() });
  view.scene.add(view.modelGroup, view.objectsGroup, view.sun, view.hemi, view.moonLight); view.modelGroup.add(root);
  view.camera.position.set(1, 1, 5); view.camera.lookAt(view.controls.target); view.camera.updateMatrixWorld(true); root.updateMatrixWorld(true);
  const objects = new ObjectLayer(view); objects.setModel(model); objects.setBindings(new Map([['lamp', { entity: 'light.lamp' }]]), {});
  objects.update({ 'light.lamp': state(lamp) }); view._captureModelMotion(); view._bounds = view._sceneBounds(); view._shadowSig = view._modelSig();
  const clearPending = () => {
    view.dirty = false; view.renderer.shadowMap.needsUpdate = false; view.sun.shadow.needsUpdate = false;
    objects.pool.points.slice(0, 4).forEach((light) => { light.shadow.needsUpdate = false; });
  };
  clearPending(); view.stats.shadow = 0; view.stats.shadowLights = 0; objects.stats.shadowRequests = 0;
  return { view, objects, root, model, leaf, mount, clearPending };
}
const counters = (f) => ({ shadow: f.view.stats.shadow, shadowLights: f.view.stats.shadowLights, requests: f.objects.stats.shadowRequests });
const offPending = (f) => {
  expect(f.view.renderer.shadowMap.enabled).toBe(false); expect(f.view.renderer.shadowMap.needsUpdate).toBe(false);
  expect(f.view.sun.shadow.needsUpdate).toBe(false);
  expect(f.objects.pool.points.slice(0, 4).map((light) => light.shadow.needsUpdate)).toEqual([false, false, false, false]);
};
afterEach(() => { vi.useRealTimers(); });

describe('central model shadow policy', () => {
  it('leaves default/equal policy and idle materials/counters untouched', () => {
    const f = fixture(), material = f.leaf.material, version = material.version;
    for (const value of [undefined, {}, { shadows: 'realtime', lamps: 'inherit' }, { unknown: true }]) expect(f.view.setModelRendering(value)).toBe(false);
    expect(f.view.shadowsEnabled).toBe(true); expect(f.view.dirty).toBe(false); expect(material.version).toBe(version);
    expect(counters(f)).toEqual({ shadow: 0, shadowLights: 0, requests: 0 }); f.objects.dispose();
  });
  it('disables both sun and pool pending maps, retaining all actual lights/materials', () => {
    const f = fixture(), pool = [...f.objects.pool.points, ...f.objects.pool.spots], slot = f.objects._slots.get('lamp'), material = f.leaf.material;
    f.view._applyLook(); f.clearPending();
    f.view._shadowDirty(); f.objects.pool.points[1].shadow.needsUpdate = true; const before = counters(f), version = material.version;
    expect(f.view.setModelRendering({ shadows: 'off' })).toBe(true);
    expect(f.view.shadowsEnabled).toBe(false); offPending(f); expect(counters(f)).toEqual(before);
    expect(f.view.sun.castShadow).toBe(true);
    expect(slot.light.castShadow).toBe(true); expect(slot.light.intensity).toBeGreaterThan(0); expect(slot.light.shadow.intensity).toBe(1);
    expect(f.objects._slots.get('lamp')).toBe(slot); expect([...f.objects.pool.points, ...f.objects.pool.spots]).toEqual(pool);
    expect(f.leaf.material).toBe(material); expect(material.version).toBe(version + 1); expect(f.view.dirty).toBe(true);
    expect(f.view.onObjectsInvalidate).not.toHaveBeenCalled(); f.objects.dispose();
  });
  it('does not invalidate a diagnostic-only/equal off policy update', () => {
    const f = fixture(); f.view.setModelRendering({ shadows: 'off' }); f.clearPending(); const version = f.leaf.material.version;
    expect(f.view.setModelRendering({ shadows: 'off', lamps: 'invalid', unknown: 'retained' })).toBe(false);
    expect(f.view._modelRendering.valid).toBe(false); expect(f.view.dirty).toBe(false); expect(f.leaf.material.version).toBe(version); offPending(f); f.objects.dispose();
  });
  it('stores lamp policy without shadow work or recursive object refresh', () => {
    const f = fixture(); expect(f.view.setModelRendering({ lamps: 'off' })).toBe(true);
    expect(f.view.shadowsEnabled).toBe(true); expect(f.view.dirty).toBe(false); expect(f.view.onObjectsInvalidate).not.toHaveBeenCalled();
    expect(counters(f)).toEqual({ shadow: 0, shadowLights: 0, requests: 0 }); f.objects.dispose();
  });
  it('guards every shadow request path while disabled', () => {
    const f = fixture(); f.view.setModelRendering({ shadows: 'off' }); f.clearPending(); const before = counters(f), light = f.objects._slots.get('lamp').light;
    f.view._shadowDirty(); f.view._sunShadow(); f.view._flagShadows([f.view.sun, light]); f.view.requestShadowUpdate([light]); f.view._fitShadow();
    expect(counters(f)).toEqual(before); offPending(f); expect(f.objects.shadowsStale()).toEqual([]); f.objects.dispose();
  });
  it('preserves the policy through model look, sky and model removal/reload', () => {
    const f = fixture(); f.view.setModelRendering({ shadows: 'off' }); const before = counters(f);
    f.view._applyLook(); expect(f.view.sun.castShadow).toBe(true); offPending(f);
    f.view.setSky({ night: 1, sun: 0, sunDir: [1, 0, 0] }); offPending(f);
    f.view.setSky({ night: 0, sun: 1, sunDir: [0, 1, 0] }); offPending(f); expect(f.view.sun.intensity).toBeGreaterThan(0);
    f.objects.setModel(null); f.view.model = null; f.view._applyLook(); offPending(f);
    f.view.model = f.model; f.objects.setModel(f.model); f.objects.update({ 'light.lamp': state() }); f.view._applyLook(); offPending(f);
    expect(counters(f)).toEqual(before); f.objects.dispose();
  });
  it('stores off before a model exists and does not produce a policy-only frame', () => {
    const f = fixture(); f.objects.setModel(null); f.view.model = null; f.view._applyLook(); f.clearPending();
    const before = counters(f); expect(f.view.setModelRendering({ shadows: 'off' })).toBe(true); expect(f.view.dirty).toBe(false);
    f.view.model = f.model; f.objects.setModel(f.model); f.objects.update({ 'light.lamp': state() }); f.view._applyLook();
    offPending(f); expect(counters(f)).toEqual(before); f.objects.dispose();
  });
  it('keeps maps stopped across real Day/Night, theme, repeated alignment and floor refresh paths', async () => {
    const f = fixture(); f.view.setModelRendering({ shadows: 'off' }); const before = counters(f);
    for (let i = 0; i < 3; i++) {
      f.view.setDaylight(false); f.view.setTheme({ dark: true }); f.view.setDaylight(true); f.view.setTheme({ dark: false });
      await expect(f.view.setModel({ id: f.model.id, position: [i + 1, 2, 0], rotation: 15 * i, scale: 1.2 })).resolves.toBe(null);
      f.objects.update({ 'light.lamp': state() }); f.view._applyFloorVisibility();
      offPending(f); expect(counters(f)).toEqual(before);
    }
    expect(f.view.modelGroup.position.x).toBe(3); expect(f.objects._slots.get('lamp').light.intensity).toBeGreaterThan(0); f.objects.dispose();
  });
  it('omitted historical settings restore defaults exactly like an explicit realtime policy', () => {
    const omitted = fixture(), explicit = fixture();
    for (const f of [omitted, explicit]) { f.view._applyLook(); f.view.setModelRendering({ shadows: 'off', lamps: 'off' }); f.clearPending(); }
    expect(omitted.view.setModelRendering(undefined)).toBe(true);
    expect(explicit.view.setModelRendering({ shadows: 'realtime', lamps: 'inherit' })).toBe(true);
    expect(counters(omitted)).toEqual(counters(explicit)); expect(omitted.view._modelRendering).toEqual(explicit.view._modelRendering);
    expect(omitted.view.renderer.shadowMap.enabled).toBe(true);
    omitted.objects.dispose(); explicit.objects.dispose();
  });
  it('re-enables current sun and active pool maps exactly once, keeping next equal HA update idle', () => {
    const f = fixture(); f.view._applyLook(); f.view.setModelRendering({ shadows: 'off' }); f.clearPending(); const before = counters(f);
    expect(f.view.setModelRendering({ shadows: 'realtime' })).toBe(true);
    expect(f.view.renderer.shadowMap.enabled).toBe(true); expect(f.view.renderer.shadowMap.needsUpdate).toBe(true);
    expect(f.view.sun.shadow.needsUpdate).toBe(true); expect(f.objects._slots.get('lamp').light.shadow.needsUpdate).toBe(true);
    expect(counters(f)).toEqual({ ...before, shadow: before.shadow + 1, shadowLights: before.shadowLights + 2 });
    f.clearPending(); const after = counters(f), budget = f.objects.stats.budget;
    for (let i = 0; i < 5; i++) { expect(f.view.setModelRendering({ shadows: 'realtime' })).toBe(false); f.objects.update({ 'light.lamp': state() }); }
    expect(counters(f)).toEqual(after); expect(f.objects.stats.budget).toBe(budget); expect(f.view.dirty).toBe(false); expect(f.view.renderer.shadowMap.needsUpdate).toBe(false); f.objects.dispose();
  });
  it('defers nighttime sun maps on re-enable until real sunrise and skips dark lamps', () => {
    const f = fixture({ lamp: false }); f.view.sun.intensity = 0; f.view.setModelRendering({ shadows: 'off' }); f.clearPending();
    expect(f.view.setModelRendering({ shadows: 'realtime' })).toBe(true);
    expect(f.view._sunStale).toBe(true); expect(f.view.renderer.shadowMap.needsUpdate).toBe(false); expect(f.view.stats.shadow).toBe(1); expect(f.view.stats.shadowLights).toBe(0);
    f.view.sun.intensity = 1; f.view._sunShadow(); expect(f.view.sun.shadow.needsUpdate).toBe(true); expect(f.view.stats.shadowLights).toBe(1); f.objects.dispose();
  });
  it('does not turn a deliberate non-shadow fixture into a shadow writer when re-enabled', () => {
    const f = fixture({ castShadow: false }); expect(f.objects._slots.get('lamp').shadow).toBe(false);
    f.view.setModelRendering({ shadows: 'off' }); f.clearPending(); const before = counters(f);
    f.view.setModelRendering({ shadows: 'realtime' });
    expect(counters(f)).toEqual({ ...before, shadow: before.shadow + 1, shadowLights: before.shadowLights + 1 });
    expect(f.objects._shadowKeys).toEqual([null, null, null, null]); expect(f.objects.shadowsStale()).toEqual([]); f.objects.dispose();
  });
  it('marks a shared material once per real renderer policy change, retaining authored texture data', () => {
    const f = fixture(), material = f.leaf.material; material.map = new THREE.Texture(); const texture = material.map;
    f.root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)); const version = material.version;
    f.view.setModelRendering({ shadows: 'off' }); expect(material.version).toBe(version + 1);
    f.view.setModelRendering({ shadows: 'off' }); expect(material.version).toBe(version + 1);
    f.view.setModelRendering({ shadows: 'realtime' }); expect(material.version).toBe(version + 2);
    expect(material.map).toBe(texture); expect(material.isMeshStandardMaterial).toBe(true); f.objects.dispose();
  });
});

describe('pool updates and model motion with shadows off', () => {
  it('continues actual lamp colour/output changes without any shadow request/allocation', () => {
    const f = fixture(); f.view.setModelRendering({ shadows: 'off' }); f.clearPending(); const before = counters(f), pool = [...f.objects.pool.points, ...f.objects.pool.spots];
    const slot = f.objects._slots.get('lamp'), budget = f.objects.stats.budget;
    f.objects.update({ 'light.lamp': state(true, 128, [0, 0, 255]) });
    expect(slot.light.color.b).toBe(1); expect(slot.light.color.r).toBe(0); expect(slot.light.intensity).toBeGreaterThan(0); expect(f.view.dirty).toBe(true);
    offPending(f); expect(counters(f)).toEqual(before); expect(f.objects.stats.budget).toBe(budget); expect([...f.objects.pool.points, ...f.objects.pool.spots]).toEqual(pool);
    f.clearPending(); f.objects.update({ 'light.lamp': state(true, 128, [0, 0, 255]) }); expect(f.view.dirty).toBe(false); offPending(f); f.objects.dispose();
  });
  it('handles dark→lit and reassignment under off, then draws current maps once on re-enable', () => {
    const f = fixture({ lamp: false }); f.view.setModelRendering({ shadows: 'off' }); f.clearPending(); const before = counters(f);
    f.objects.update({ 'light.lamp': state() }); offPending(f); expect(counters(f)).toEqual(before); expect(f.objects._shadowKeys).toEqual([null, null, null, null]);
    const light = f.objects._slots.get('lamp').light; f.view.setModelRendering({ shadows: 'realtime' }); expect(light.shadow.needsUpdate).toBe(true);
    expect(counters(f)).toEqual({ ...before, shadow: before.shadow + 1, shadowLights: before.shadowLights + 2 });
    f.clearPending(); f.objects.update({ 'light.lamp': state() }); expect(f.view.dirty).toBe(false); expect(f.view.renderer.shadowMap.needsUpdate).toBe(false); f.objects.dispose();
  });
  it('refreshes moving attached light anchors/bounds/picks/occlusion while stopping shadow work', () => {
    vi.useFakeTimers(); const f = fixture(); f.view.setModelRendering({ shadows: 'off' }); f.clearPending(); const before = counters(f), oldAnchor = f.objects.anchorOf('lamp');
    const bounds = f.view._bounds, signature = f.view._shadowSig; f.view._occluders(); f.leaf.rotation.y = Math.PI / 2;
    const result = f.view.modelMotionChanged([f.leaf]);
    expect(result.changed).toBe(true); expect(result.objectIds.has('lamp')).toBe(true); expect(f.objects.anchorOf('lamp').distanceTo(oldAnchor)).toBeGreaterThan(.1);
    expect(f.view._bounds).not.toBe(bounds); expect(f.view._shadowSig).not.toBe(signature); expect(f.view._occBoxes).toBeNull(); expect(f.view.pickHelper.update).toHaveBeenCalledOnce();
    expect(f.objects._slots.get('lamp').light.position.equals(f.objects.anchorOf('lamp'))).toBe(true); expect(counters(f)).toEqual(before); offPending(f); expect(vi.getTimerCount()).toBe(0);
    f.clearPending(); expect(f.view.modelMotionChanged([f.leaf]).changed).toBe(false); f.objects.update({ 'light.lamp': state() }); expect(f.view.dirty).toBe(false);
    f.view.setModelRendering({ shadows: 'realtime' }); expect(f.objects._slots.get('lamp').light.shadow.needsUpdate).toBe(true); expect(f.view.stats.shadow).toBe(before.shadow + 1); f.objects.dispose();
  });
  it('does not request shadows from the direct attached-anchor refresh path', () => {
    const f = fixture(); f.view.setModelRendering({ shadows: 'off' }); f.clearPending(); const request = vi.spyOn(f.view, 'requestShadowUpdate'), before = counters(f);
    f.leaf.rotation.y = .4; expect(f.objects.refreshAnchors([f.leaf]).changed).toBe(true);
    expect(request).not.toHaveBeenCalled(); expect(counters(f)).toEqual(before); offPending(f); f.objects.dispose();
  });
  it('keeps selected light controls/bulb glows when root lamp visibility is disabled independently', () => {
    const f = fixture(); const part = f.objects.parts.get('lamp'), material = part.part.glow.material;
    f.view.setModelRendering({ shadows: 'off', lamps: 'off' }); f.clearPending(); const before = counters(f);
    f.objects.update({ 'light.lamp': state() }, { lightsOn: false });
    expect(f.objects.lights.visible).toBe(false); expect(part.part.glow.material).toBe(material); expect(part.part.level).toBe(1); expect(part.chain.lit).toBe(true);
    expect(counters(f)).toEqual(before); offPending(f); f.objects.dispose();
  });
});
