// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ObjectLayer } from '../src/objects/layer.js';
import { lightBudget, lightColor, lightLevel } from '../src/objects/logic.js';
import { hintDefaults, MAX_LIGHT_HINT } from '../src/objects/types.js';

const state = (attributes = {}) => ({ state: 'on', attributes: { color_mode: 'rgb', supported_color_modes: ['rgb'], brightness: 128, rgb_color: [255, 80, 30], ...attributes } });
function fixture(specs = [{ id: 'lamp', max: 5 }]) {
  const scene = new THREE.Scene(), view = { objectsGroup: new THREE.Group(), dirty: 0, shadows: 0,
    markDirty() { this.dirty++; }, requestShadowUpdate(lights) { this.shadows++; for (const light of lights) light.shadow.needsUpdate = true; } };
  scene.add(view.objectsGroup);
  const root = new THREE.Group(), objects = specs.map(({ id, max, beam, shadow, group, type = 'light', ...hints }, index) => {
    const node = new THREE.Group(), glow = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial());
    glow.name = 'glow'; node.position.set(index, 1, 0); node.add(glow); root.add(node);
    return { id, type, group, level: 'ground', node, glow: 'glow', hints: { max, beam, castShadow: shadow !== false, ...hints } };
  });
  const layer = new ObjectLayer(view); layer.setModel({ id: 'test-lights', root, manifest: { objects, levels: [] } });
  layer.setBindings(new Map(objects.map(({ id }) => [id, { entity: 'light.' + id }])), {});
  return { layer, view, scene, root, objects };
}

describe('semantic HA light state in the fixed ObjectLayer pool', () => {
  it('does not repaint, redraw, reassign or allocate after a friendly-name-only replacement', () => {
    const { layer, view, objects } = fixture();
    layer.update({ 'light.lamp': state({ friendly_name: 'Old label' }) });
    const slot = layer._slots.get('lamp'), material = objects[0].node.children[0].material, budget = layer.stats.budget;
    const materialPaint = vi.spyOn(material.emissive, 'setRGB'), poolPaint = vi.spyOn(slot.light.color, 'setRGB'), version = material.version;
    const lights = [...layer.pool.points, ...layer.pool.spots]; view.dirty = 0; view.shadows = 0;
    for (let i = 0; i < 5; i++) layer.update({ 'light.lamp': state({ friendly_name: 'New label ' + i, last_seen: i }) });
    expect(view.dirty).toBe(0); expect(view.shadows).toBe(0); expect(layer.stats.budget).toBe(budget);
    expect(layer._slots.get('lamp')).toBe(slot); expect(objects[0].node.children[0].material).toBe(material);
    expect(materialPaint).not.toHaveBeenCalled(); expect(poolPaint).not.toHaveBeenCalled(); expect(material.version).toBe(version);
    expect([...layer.pool.points, ...layer.pool.spots]).toEqual(lights); layer.dispose();
  });
  it('never sends malformed brightness or RGB values to real lights or emissive materials', () => {
    const { layer, objects } = fixture();
    for (const attributes of [{ brightness: NaN }, { brightness: Infinity }, { rgb_color: [NaN, 80, 30] }, { rgb_color: [255, 80] }]) {
      layer.update({ 'light.lamp': state(attributes) });
      expect(layer._slots.size).toBe(0);
      for (const light of [...layer.pool.points, ...layer.pool.spots]) expect(Number.isFinite(light.intensity)).toBe(true);
      const material = objects[0].node.children[0].material;
      expect(material.emissive.toArray().every(Number.isFinite)).toBe(true); expect(material.emissiveIntensity).toBe(0);
    }
    layer.dispose();
  });
  it('keeps compatibility colour/brightness readers safe for malformed explicit entity IDs', () => {
    for (const entity_id of [3, true, [], null]) {
      const source = { entity_id, state: 'on', attributes: { brightness: 255, rgb_color: [255, 0, 0] } };
      expect(lightColor(source)).toEqual([0, 0, 0]); expect(lightLevel(source)).toBe(0);
    }
  });
  it('ranks actual emitted output rather than the configured maximum alone', () => {
    const fixture = (id, max, output) => ({ id, max, output, lit: true, visible: true, beam: 'point' });
    const result = lightBudget([fixture('dim', 50, 1 / 255), fixture('bright', 5, 1)], { points: 1 });
    expect([...result.real.keys()]).toEqual(['bright']);
  });
  it('suppresses zero brightness and black RGB output before allocating a pooled light', () => {
    const { layer, objects } = fixture();
    for (const attributes of [{ brightness: 0 }, { brightness: 255, rgb_color: [0, 0, 0] }]) {
      layer.update({ 'light.lamp': state(attributes) }); expect(layer._slots.size).toBe(0);
      expect(objects[0].node.children[0].material.emissiveIntensity).toBe(0);
    }
    layer.dispose();
  });
  it('preserves actual switch-controlled fixed fixtures without claiming measured colour', () => {
    const { layer } = fixture();
    layer.setBindings(new Map([['lamp', { entity: 'switch.lamp' }]]), {});
    layer.update({ 'switch.lamp': { entity_id: 'switch.lamp', state: 'on', attributes: { brightness: 10, rgb_color: [0, 0, 255] } } });
    expect(layer.objectAt('lamp').result).toMatchObject({ lit: true, level: 1, color: [255, 191, 128], appearance: { status: 'fallback', colorSource: 'display-fallback', colorKnown: false } });
    expect(layer._slots.size).toBe(1);
    layer.update({ 'switch.lamp': { entity_id: 'switch.lamp', state: 'on', attributes: { restored: true } } });
    expect(layer._slots.size).toBe(0); expect(layer.objectAt('lamp').result.appearance.status).toBe('unavailable'); layer.dispose();
  });
  it('changes current colour/brightness in place without changing the selected budget or shadows', () => {
    const { layer, view } = fixture(); layer.update({ 'light.lamp': state() });
    const slot = layer._slots.get('lamp'), budget = layer.stats.budget; view.dirty = 0; view.shadows = 0;
    layer.update({ 'light.lamp': state({ brightness: 51, rgb_color: [0, 0, 255] }) });
    expect(layer._slots.get('lamp')).toBe(slot); expect(layer.stats.budget).toBe(budget); expect(view.shadows).toBe(0);
    expect(view.dirty).toBe(1); expect(slot.light.intensity).toBeCloseTo(1); expect(slot.light.color.toArray()).toEqual([0, 0, 1]); layer.dispose();
  });
  it('rebudgets strongest current outputs while preserving surviving shadow/free/spot slot identities', () => {
    const specs = [...Array.from({ length: 13 }, (_, i) => ({ id: 'p' + i, max: 10 })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: 's' + i, max: 10, beam: 'spot' }))];
    const { layer } = fixture(specs);
    const states = Object.fromEntries(specs.map(({ id }) => ['light.' + id, state({ brightness: 220 - Number(id.slice(1)) * 10 })]));
    layer.update(states);
    const prev = new Map([...layer._slots].map(([id, slot]) => [id, slot.light]));
    expect([...layer._slots.keys()].filter((id) => id.startsWith('p')).sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
    expect([...layer._slots.keys()].filter((id) => id.startsWith('s')).sort()).toEqual(['s0', 's1', 's2', 's3']);
    states['light.p0'] = state({ brightness: 1 }); states['light.s0'] = state({ brightness: 1 }); layer.update(states);
    expect(layer._slots.has('p0')).toBe(false); expect(layer._slots.has('p8')).toBe(true);
    expect(layer._slots.has('s0')).toBe(false); expect(layer._slots.has('s4')).toBe(true);
    for (const id of ['p1', 'p2', 'p3', 'p5', 'p6', 'p7', 's1', 's2', 's3']) expect(layer._slots.get(id).light).toBe(prev.get(id));
    expect(layer._slots.size).toBe(12); expect(new Set([...layer._slots.values()].map((s) => s.light)).size).toBe(12); layer.dispose();
  });
  it('uses actual RGB output in selection, excludes hidden fixtures and never exceeds the unchanged pools', () => {
    const specs = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, max: i === 0 ? 50 : 5 }));
    const { layer, objects } = fixture(specs);
    const states = Object.fromEntries(specs.map(({ id }) => ['light.' + id, state({ brightness: 255, rgb_color: id === 'p0' ? [1, 0, 0] : [255, 255, 255] })]));
    objects[1].node.visible = false; layer.update(states);
    expect(layer._slots.has('p0')).toBe(false); expect(layer._slots.has('p1')).toBe(false); expect(layer._slots.size).toBe(8);
    expect(layer.pool.points.filter((l) => l.castShadow)).toHaveLength(4); expect(layer.pool.points).toHaveLength(8); expect(layer.pool.spots).toHaveLength(4); layer.dispose();
  });
  it('keeps rank changes within the same selected roles idle for budget/shadow assignment', () => {
    const { layer, view } = fixture([{ id: 'a', max: 10, shadow: false }, { id: 'b', max: 10, shadow: false }, { id: 's', max: 10, beam: 'spot' }]);
    layer.update({ 'light.a': state({ brightness: 200 }), 'light.b': state({ brightness: 100 }), 'light.s': state() });
    const slots = new Map(layer._slots), budget = layer.stats.budget; view.shadows = 0;
    layer.update({ 'light.a': state({ brightness: 100 }), 'light.b': state({ brightness: 200 }), 'light.s': state() });
    expect(layer.stats.budget).toBe(budget); expect(view.shadows).toBe(0);
    for (const [id, slot] of slots) expect(layer._slots.get(id)).toBe(slot); layer.dispose();
  });
  it('falls back from impossible authored magnitudes and keeps derived grouped intensities GPU finite', () => {
    expect(hintDefaults({ max: Number.MAX_VALUE, distance: Number.MAX_VALUE, decay: Number.MAX_VALUE, target: [Number.MAX_VALUE, 0, 0], offset: [Number.MAX_VALUE, 0, 0] }))
      .toMatchObject({ max: 5, distance: 0, decay: 2, target: null, offset: null });
    for (const max of [MAX_LIGHT_HINT, Number.MAX_VALUE]) {
      const { layer } = fixture([{ id: 'a', max, group: 'row' }, { id: 'b', max, group: 'row' }]);
      layer.update({ 'light.a': state({ brightness: 255 }), 'light.b': state({ brightness: 255 }) });
      const light = [...layer._slots.values()][0].light;
      expect(light.intensity).toBe(max === MAX_LIGHT_HINT ? MAX_LIGHT_HINT * 1.5 : 7.5);
      expect(Number.isFinite(Math.fround(light.intensity))).toBe(true); expect(Number.isFinite(Math.fround(light.distance))).toBe(true); expect(Number.isFinite(Math.fround(light.decay))).toBe(true); layer.dispose();
    }
  });
  it('invalidates status labels only for actual text/colour/visibility changes', () => {
    const { layer, view } = fixture([{ id: 'lamp', type: 'climate' }]);
    layer.setBindings(new Map([['lamp', { entity: 'climate.room' }]]), {});
    const climate = (temperature = 21) => ({ entity_id: 'climate.room', state: 'heat', attributes: { hvac_action: 'heating', current_temperature: temperature } });
    layer.update({ 'climate.room': climate() }); view.dirty = 0;
    layer.update({ 'climate.room': { ...climate(), attributes: { ...climate().attributes, friendly_name: 'New label' } } }); expect(view.dirty).toBe(0);
    layer.update({ 'climate.room': climate(22) }); expect(view.dirty).toBe(1); expect(layer.objectAt('lamp').part.text).toBe('22 °C');
    view.dirty = 0; layer.update({ 'climate.room': climate(22) }, { visibleLevel: () => false }); expect(view.dirty).toBe(1);
    view.dirty = 0; layer.update({ 'climate.room': climate(22) }, { visibleLevel: () => false }); expect(view.dirty).toBe(0); layer.dispose();
  });
  it('non-shadow point/group overflow uses the fixed shadow-capable slots without casting/requesting shadows', () => {
    const specs = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, max: 10, shadow: false, group: i < 3 ? 'row' + i : null }));
    const { layer, view, objects } = fixture(specs), states = Object.fromEntries(specs.map(({ id }) => ['light.' + id, state()]));
    layer.update(states); expect(layer._slots.size).toBe(8); expect(view.shadows).toBe(0);
    expect(layer.pool.points.slice(0, 4).every((l) => l.castShadow && l.shadow.intensity === 0 && !l.shadow.needsUpdate)).toBe(true);
    expect([...layer._slots.values()].every((slot) => !slot.shadow)).toBe(true); expect(layer.shadowsStale()).toEqual([]);
    for (const obj of objects) obj.node.position.x += .25;
    layer.refreshAnchors(objects.map((o) => o.node)); expect(view.shadows).toBe(0); expect(layer.shadowsStale()).toEqual([]); layer.dispose();
  });
  it('restores a reused physical slot as a real shadow, then clears pending maps when returning to non-shadow', () => {
    const specs = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, max: 10, shadow: false }));
    const { layer, view } = fixture(specs), states = Object.fromEntries(specs.map(({ id }) => ['light.' + id, state()]));
    layer.update(states); const pool = layer.pool.points.slice();
    layer.parts.get('p4').part.hints.castShadow = true; view.dirty = 0; view.shadows = 0; layer.update(states);
    const slot = layer._slots.get('p4'); expect(slot.shadow).toBe(true); expect(slot.light.castShadow).toBe(true);
    expect(slot.light.shadow.intensity).toBe(1); expect(slot.light.shadow.needsUpdate).toBe(true); expect(view.shadows).toBe(1); expect(view.dirty).toBe(1);
    layer.parts.get('p4').part.hints.castShadow = false; view.dirty = 0; view.shadows = 0; layer.update(states);
    expect(layer._slots.get('p4').shadow).toBe(false); expect(slot.light.shadow.intensity).toBe(0); expect(slot.light.shadow.needsUpdate).toBe(false);
    expect(view.shadows).toBe(0); expect(view.dirty).toBe(1); expect(layer.shadowsStale()).toEqual([]); expect(layer.pool.points).toEqual(pool);
    view.dirty = 0; layer.update({ ...states }); expect(view.dirty).toBe(0); layer.dispose();
  });
  it('keeps non-shadow spillover survivors when a free physical shadow slot can serve a newcomer', () => {
    const specs = [...Array.from({ length: 5 }, (_, i) => ({ id: 'p' + i, max: 10, shadow: false })), { id: 'new', max: 10 }];
    const { layer } = fixture(specs), states = Object.fromEntries(specs.map(({ id }) => ['light.' + id, state()]));
    states['light.new'] = { state: 'off', attributes: {} }; layer.update(states);
    const previous = new Map([...layer._slots].map(([id, slot]) => [id, slot.light]));
    states['light.new'] = state(); layer.update(states);
    for (const [id, light] of previous) expect(layer._slots.get(id).light).toBe(light);
    expect(layer._slots.get('new').shadow).toBe(true); layer.dispose();
  });
});
