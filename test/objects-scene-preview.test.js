// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ObjectLayer } from '../src/objects/layer.js';
import { FloorplanView } from '../src/view.js';
import { validateScenePreview } from '../src/scene-preview.js';
import { popupRows } from '../src/objects/popup.js';

const light = (id = 'lamp', state = 'on', brightness = 128, rgb = [255, 80, 30], attributes = {}) => ({
  entity_id: `light.${id}`, state, attributes: { supported_color_modes: ['rgb'], color_mode: 'rgb', brightness, rgb_color: rgb, ...attributes },
});
const target = (id = 'lamp', brightness = 255, rgb = [0, 0, 255]) => ({ entity: `light.${id}`, state: 'on', brightness, color: { mode: 'rgb', rgb } });
function preview(states, targets = [target()]) {
  const result = validateScenePreview({ states: { ...states, 'scene.test': { state: 'unknown', attributes: {} } } },
    { id: 'test', scene_entity: 'scene.test', lights: targets });
  expect(result.diagnostics).toEqual([]);
  return result.overrides;
}
function fixture(specs = [{ id: 'lamp', type: 'light', max: 5 }], { shared = false, central = false } = {}) {
  const scene = new THREE.Scene(), root = new THREE.Group(), original = new THREE.MeshStandardMaterial();
  const common = new THREE.Group(), commonGlow = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), original);
  commonGlow.name = 'glow'; common.add(commonGlow); if (shared) root.add(common);
  const objects = specs.map(({ id, type = 'light', max = 5, beam, group, shadow = true }, i) => {
    const node = shared ? common : new THREE.Group();
    if (!shared) { const glow = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial()); glow.name = 'glow'; node.add(glow); node.position.set(i, 1, 0); root.add(node); }
    return { id, type, group, level: 'ground', node, glow: 'glow', hints: { max, beam, castShadow: shadow } };
  });
  const view = central ? Object.create(FloorplanView.prototype) : {};
  Object.assign(view, { scene, objectsGroup: new THREE.Group(), dirty: 0, shadows: 0,
    sun: new THREE.DirectionalLight(0xffffff, 1), renderer: { shadowMap: { enabled: true, needsUpdate: false } },
    stats: { shadow: 0, shadowLights: 0 } });
  if (!central) Object.assign(view, { markDirty() { this.dirty++; }, requestShadowUpdate(lights) { this.shadows++; for (const l of lights) l.shadow.needsUpdate = true; } });
  scene.add(root, view.objectsGroup, view.sun);
  const model = { id: 'scene-lights', root, manifest: { objects, levels: [] } }; view.model = model;
  const layer = new ObjectLayer(view); layer.setModel(model);
  layer.setBindings(new Map(objects.map(({ id }) => [id, { entity: `light.${id}` }])), {});
  const pool = [...layer.pool.points, ...layer.pool.spots];
  const clear = () => { view.dirty = 0; view.shadows = 0; view.renderer.shadowMap.needsUpdate = false; view.sun.shadow.needsUpdate = false; pool.filter((l) => l.shadow).forEach((l) => { l.shadow.needsUpdate = false; }); };
  return { view, layer, root, objects, original, commonGlow, pool, clear };
}

describe('private model lamp scene readings', () => {
  it('previews an actually off lamp without changing its public source, part, result or popup', () => {
    const f = fixture(), states = { 'light.lamp': light('lamp', 'off') }, copy = structuredClone(states), map = preview(states);
    f.layer.update(states); f.clear(); f.layer.update(states, { lightPreview: map });
    const live = f.layer.objectAt('lamp'), rendered = f.layer._slots.get('lamp').light;
    expect(live.chain.source).toBe(states['light.lamp']); expect(live.chain.lit).toBe(false);
    expect(live.result).toMatchObject({ lit: false, level: 0, output: 0, appearance: { status: 'off' } });
    expect(live.part).toMatchObject({ level: 0, output: 0, appearance: { status: 'off' } });
    expect(Object.hasOwn(live, 'renderResult')).toBe(false);
    expect(popupRows(live.obj, live.chain, states).find((r) => r.kind === 'toggle').value).toBe(false);
    expect(rendered.intensity).toBe(5); expect(rendered.color.toArray()).toEqual([0, 0, 1]);
    expect(live.part.glow.material.emissiveIntensity).toBe(3); expect(states).toEqual(copy); f.layer.dispose();
  });
  it('an explicit preview off darkens only the rendered lamp and stop restores the actual on reading', () => {
    const f = fixture(), states = { 'light.lamp': light() }, map = preview(states, [{ entity: 'light.lamp', state: 'off' }]);
    f.layer.update(states); f.layer.update(states, { lightPreview: map });
    expect(f.layer._slots.size).toBe(0); expect(f.layer.objectAt('lamp').result.lit).toBe(true);
    expect(f.layer.objectAt('lamp').part.glow.material.emissiveIntensity).toBe(0);
    f.layer.update(states, { lightPreview: null }); expect(f.layer._slots.size).toBe(1);
    expect(f.layer.objectAt('lamp').part.glow.material.emissiveIntensity).toBeCloseTo(128 / 255 * 3); f.layer.dispose();
  });
  it('keeps real relay gates and blocks restored, unknown or missing relay evidence', () => {
    const f = fixture([{ id: 'lamp', group: 'relay' }]); f.layer.setBindings(new Map([['lamp', { entity: 'light.lamp' }]]), { relay: { entity: 'switch.relay' } });
    const states = { 'light.lamp': light('lamp', 'off'), 'switch.relay': { state: 'on', attributes: {} } }, map = preview(states);
    f.layer.update(states, { lightPreview: map }); expect(f.layer._slots.size).toBe(1);
    for (const source of [{ state: 'off', attributes: {} }, { state: 'unknown', attributes: {} }, { state: 'on', attributes: { restored: true } }, undefined]) {
      f.layer.update({ ...states, 'switch.relay': source }, { lightPreview: map }); expect(f.layer._slots.size).toBe(0);
      expect(f.layer.objectAt('lamp').part.glow.material.emissiveIntensity).toBe(0);
    }
    f.layer.dispose();
  });
  it('requires unmapped light controllers on; mapped controllers may use an explicit desired on', () => {
    const f = fixture([{ id: 'lamp', group: 'controller' }]); f.layer.setBindings(new Map([['lamp', { entity: 'light.lamp' }]]), { controller: { entity: 'light.controller' } });
    const states = { 'light.lamp': light('lamp', 'off'), 'light.controller': light('controller', 'off') };
    f.layer.update(states, { lightPreview: preview(states) }); expect(f.layer._slots.size).toBe(0);
    f.layer.update(states, { lightPreview: preview(states, [target(), target('controller', 80, [0, 255, 0])]) });
    expect(f.layer._slots.size).toBe(1); expect(f.layer._slots.get('lamp').light.color.toArray()).toEqual([0, 0, 1]);
    expect(f.layer.objectAt('lamp').chain.lit).toBe(false); f.layer.dispose();
  });
  it('a mapped controller retains the first unmapped light’s latest actual colour', () => {
    const f = fixture([{ id: 'lamp', group: 'controller' }]); f.layer.setBindings(new Map([['lamp', { entity: 'light.lamp' }]]), { controller: { entity: 'light.controller' } });
    const states = { 'light.lamp': light('lamp', 'on', 255, [255, 0, 0]), 'light.controller': light('controller', 'off') }, map = preview(states, [target('controller')]);
    f.layer.update(states, { lightPreview: map }); expect(f.layer._slots.get('lamp').light.color.toArray()).toEqual([1, 0, 0]);
    f.layer.update({ ...states, 'light.lamp': light('lamp', 'on', 128, [0, 255, 0]) }, { lightPreview: map });
    expect(f.layer._slots.get('lamp').light.color.toArray()).toEqual([0, 1, 0]);
    f.layer.update({ ...states, 'light.lamp': light('lamp', 'off') }, { lightPreview: map }); expect(f.layer._slots.size).toBe(0); f.layer.dispose();
  });
  it('stops using a previously compiled target when current source evidence becomes unusable', () => {
    const f = fixture(), states = { 'light.lamp': light() }, map = preview(states);
    f.layer.update(states, { lightPreview: map });
    for (const source of [undefined, light('lamp', 'unavailable'), light('lamp', 'unknown'), light('lamp', 'on', 128, [255, 0, 0], { restored: true })]) {
      f.layer.update({ 'light.lamp': source }, { lightPreview: map }); expect(f.layer._slots.size).toBe(0);
      expect(f.layer.objectAt('lamp').part.glow.material.emissiveIntensity).toBe(0);
    }
    f.layer.dispose();
  });
  it('clearing a preview restores the latest real update rather than the state at preview start', () => {
    const f = fixture(), states = { 'light.lamp': light() }, map = preview(states, [target('lamp', 255, [255, 0, 0])]);
    f.layer.update(states, { lightPreview: map }); const slot = f.layer._slots.get('lamp');
    const latest = { 'light.lamp': light('lamp', 'on', 51, [0, 0, 255]) }; f.clear();
    f.layer.update(latest, { lightPreview: map }); expect(f.view.dirty).toBe(0); expect(slot.light.color.toArray()).toEqual([1, 0, 0]);
    expect(f.layer.objectAt('lamp').result.color).toEqual([0, 0, 255]); expect(f.layer.objectAt('lamp').chain.source).toBe(latest['light.lamp']);
    f.layer.update(latest, { lightPreview: null }); expect(f.layer._slots.get('lamp')).toBe(slot);
    expect(slot.light.color.toArray()).toEqual([0, 0, 1]); expect(slot.light.intensity).toBeCloseTo(1); expect(f.view.shadows).toBe(0); f.layer.dispose();
  });
  it('supports glow-only light strips without allocating a pooled light', () => {
    const f = fixture([{ id: 'lamp', type: 'light_strip', max: 0 }]), states = { 'light.lamp': light('lamp', 'off') };
    f.layer.update(states, { lightPreview: preview(states) }); expect(f.layer._slots.size).toBe(0);
    expect(f.layer.objectAt('lamp').part.glow.material.emissiveIntensity).toBe(3); expect(f.layer.objectAt('lamp').result.lit).toBe(false); f.layer.dispose();
  });
  it('retains actual status actors and generic models even when their bound light is in the map', () => {
    for (const type of ['climate', 'mower', 'ev_charger', 'generic']) {
      const f = fixture([{ id: 'lamp', type }]), states = { 'light.lamp': light('lamp', 'on', 128, [255, 0, 0], { hvac_action: 'cooling' }) };
      f.layer.update(states); const live = f.layer.objectAt('lamp'), before = { result: live.result, color: live.part.glow?.material.emissive.toArray(), level: live.part.glow?.material.emissiveIntensity };
      f.clear(); f.layer.update(states, { lightPreview: preview(states) });
      expect(f.layer.objectAt('lamp').result).toBe(before.result); expect(live.part.glow?.material.emissive.toArray()).toEqual(before.color);
      expect(live.part.glow?.material.emissiveIntensity).toBe(before.level); expect(f.view.dirty).toBe(0); f.layer.dispose();
    }
  });
  it('retains the fixed switch-only legacy display fallback without fabricating a mapped light source', () => {
    const f = fixture(), states = { 'switch.lamp': { entity_id: 'switch.lamp', state: 'on', attributes: {} }, 'light.unrelated': light('unrelated') };
    f.layer.setBindings(new Map([['lamp', { entity: 'switch.lamp' }]]), {}); f.layer.update(states);
    const slot = f.layer._slots.get('lamp'), reading = f.layer.objectAt('lamp').result; f.clear();
    f.layer.update(states, { lightPreview: preview(states, [target('unrelated')]) });
    expect(f.layer.objectAt('lamp').result).toBe(reading); expect(reading.appearance.colorSource).toBe('display-fallback');
    expect(f.layer._slots.get('lamp')).toBe(slot); expect(slot.light.color.r).toBe(1); expect(f.view.dirty).toBe(0); f.layer.dispose();
  });
});

describe('preview resources, semantic updates and existing policies', () => {
  it('equal compiled maps and replacement HA snapshots write no lights/materials/maps or budget', () => {
    const f = fixture(), states = { 'light.lamp': light() }; f.layer.update(states, { lightPreview: preview(states) });
    const slot = f.layer._slots.get('lamp'), material = f.layer.objectAt('lamp').part.glow.material, budget = f.layer.stats.budget, version = material.version;
    const glowWrite = vi.spyOn(material.emissive, 'setRGB'), lightWrite = vi.spyOn(slot.light.color, 'setRGB'), poolIDs = f.pool.map((l) => l.uuid); f.clear();
    for (let i = 0; i < 5; i++) {
      const next = { 'light.lamp': light('lamp', 'on', 128, [255, 80, 30], { friendly_name: `New ${i}` }) };
      f.layer.update(next, { lightPreview: preview(next) });
    }
    expect(f.view.dirty).toBe(0); expect(f.view.shadows).toBe(0); expect(f.layer.stats.budget).toBe(budget);
    expect(glowWrite).not.toHaveBeenCalled(); expect(lightWrite).not.toHaveBeenCalled(); expect(material.version).toBe(version);
    expect(f.layer._slots.get('lamp')).toBe(slot); expect(f.pool.map((l) => l.uuid)).toEqual(poolIDs); f.layer.dispose();
  });
  it('changes preview RGB/brightness in place without rebudgeting or redrawing shadows', () => {
    const f = fixture(), states = { 'light.lamp': light() }; f.layer.update(states, { lightPreview: preview(states) });
    const slot = f.layer._slots.get('lamp'), budget = f.layer.stats.budget; f.clear();
    f.layer.update(states, { lightPreview: preview(states, [target('lamp', 51, [0, 255, 0])]) });
    expect(f.view.dirty).toBe(1); expect(f.view.shadows).toBe(0); expect(f.layer.stats.budget).toBe(budget);
    expect(f.layer._slots.get('lamp')).toBe(slot); expect(slot.light.intensity).toBeCloseTo(1); expect(slot.light.color.toArray()).toEqual([0, 1, 0]); f.layer.dispose();
  });
  it('ranks preview outputs within the same fixed point/spot/shadow capacity and retains compatible survivors', () => {
    const specs = [...Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, max: 5, shadow: false })), ...Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, max: 5, beam: 'spot' }))];
    const f = fixture(specs), states = Object.fromEntries(specs.map(({ id }) => [`light.${id}`, light(id)]));
    const targets = specs.map(({ id }, i) => target(id, i === 0 || id === 's0' ? 1 : 200, [255, 255, 255]));
    f.layer.update(states, { lightPreview: preview(states, targets) }); const previous = new Map([...f.layer._slots].map(([id, slot]) => [id, slot.light]));
    expect(previous.size).toBe(12); expect(previous.has('p0')).toBe(false); expect(previous.has('s0')).toBe(false);
    expect([...f.layer._slots.values()].filter((s) => s.shadow)).toHaveLength(0);
    const changed = targets.map((t) => t.entity === 'light.p0' || t.entity === 'light.s0' ? { ...t, brightness: 255 } : t);
    f.layer.update(states, { lightPreview: preview(states, changed) });
    expect(f.layer._slots.size).toBe(12); expect(f.layer._slots.has('p0')).toBe(true); expect(f.layer._slots.has('s0')).toBe(true);
    for (const [id, slot] of f.layer._slots) if (previous.has(id)) expect(slot.light).toBe(previous.get(id));
    expect([...f.layer.pool.points, ...f.layer.pool.spots]).toEqual(f.pool); expect(f.pool.filter((l) => l.castShadow)).toHaveLength(4); f.layer.dispose();
  });
  it('keeps hidden bindings and lamp policy off out of the actual light pool', () => {
    const f = fixture(), states = { 'light.lamp': light('lamp', 'off') }, map = preview(states);
    f.layer.update(states, { lightPreview: map, lightsOn: false }); expect(f.layer.lights.visible).toBe(false); expect(f.layer._slots.size).toBe(0);
    f.layer.update(states, { lightPreview: map, lightsOn: true }); expect(f.layer._slots.size).toBe(1);
    f.layer.setBindings(new Map([['lamp', { entity: 'light.lamp', hidden: true }]]), {}); f.layer.update(states, { lightPreview: map });
    expect(f.layer._slots.size).toBe(0); expect(f.layer.objectAt('lamp').part.glow.material.emissiveIntensity).toBe(0); f.layer.dispose();
  });
  it('restores shared glow ownership and the authored material after preview replacement/model teardown', () => {
    const f = fixture([{ id: 'a' }, { id: 'b' }], { shared: true });
    const states = { 'light.a': light('a', 'on', 255, [1, 0, 0]), 'light.b': light('b', 'on', 128, [255, 255, 255]) };
    f.layer.update(states); const clone = f.commonGlow.material, dispose = vi.spyOn(clone, 'dispose'); expect(clone.emissive.toArray()).toEqual([1, 1, 1]);
    f.layer.update(states, { lightPreview: preview(states, [target('a', 255, [255, 0, 0])]) }); expect(clone.emissive.toArray()).toEqual([1, 0, 0]);
    const latest = { ...states, 'light.b': light('b', 'on', 51, [0, 0, 255]) };
    f.layer.update(latest, { lightPreview: null }); expect(clone.emissive.toArray()).toEqual([0, 0, 1]); expect(f.commonGlow.material).toBe(clone);
    f.layer.setModel(null); expect(f.commonGlow.material).toBe(f.original); expect(dispose).toHaveBeenCalledTimes(1);
    expect(f.original.emissiveIntensity).toBe(1); expect(f.original.emissive.getHex()).toBe(0); f.layer.dispose();
  });
  it('central shadow-off blocks preview requests and re-enable seeds the current maps only once', () => {
    const f = fixture(undefined, { central: true }), states = { 'light.lamp': light('lamp', 'off') }, map = preview(states);
    f.view.setModelRendering({ shadows: 'off' }); f.layer.update(states, { lightPreview: map }); f.clear();
    const stats = { ...f.view.stats }, requests = f.layer.stats.shadowRequests, slot = f.layer._slots.get('lamp');
    f.layer.update(states, { lightPreview: preview(states, [target('lamp', 51, [255, 0, 0])]) });
    expect(f.view.stats).toEqual(stats); expect(f.layer.stats.shadowRequests).toBe(requests);
    expect(f.view.renderer.shadowMap.needsUpdate).toBe(false); expect(f.pool.slice(0, 4).every((l) => !l.shadow.needsUpdate)).toBe(true);
    expect(f.layer.shadowsStale()).toEqual([]); expect(f.view.renderer.shadowMap.enabled).toBe(false);
    expect(f.view.setModelRendering({ shadows: 'realtime' })).toBe(true);
    expect(f.view.stats.shadow).toBe(stats.shadow + 1); expect(f.view.stats.shadowLights).toBe(stats.shadowLights + 2);
    expect(f.layer._slots.get('lamp')).toBe(slot); const seeded = { ...f.view.stats }; f.clear();
    f.layer.update({ 'light.lamp': light('lamp', 'off') }, { lightPreview: preview(states, [target('lamp', 51, [255, 0, 0])]) });
    expect(f.view.stats).toEqual(seeded); expect(f.layer.stats.shadowRequests).toBe(requests); expect(f.view.dirty).toBe(0); f.layer.dispose();
  });
});
