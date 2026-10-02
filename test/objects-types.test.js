import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { hintDefaults, findGlow, TYPES, typeOf } from '../src/objects/types.js';

const DEF = { beam: 'point', max: 5, distance: 0, decay: 2, angle: 24, penumbra: 0.6, target: null, castShadow: true, offset: null };

describe('hintDefaults', () => {
  it('fills defaults for empty or missing hints', () => {
    expect(hintDefaults()).toEqual(DEF);
    expect(hintDefaults(null)).toEqual(DEF);
    expect(hintDefaults({})).toEqual(DEF);
  });

  it('keeps valid hints', () => {
    expect(hintDefaults({ beam: 'spot', max: 34, distance: 9, decay: 1.5, angle: 30, penumbra: 0.2, target: [1, 0, 2], castShadow: false, offset: [0, 0, 0.12] }))
      .toEqual({ beam: 'spot', max: 34, distance: 9, decay: 1.5, angle: 30, penumbra: 0.2, target: [1, 0, 2], castShadow: false, offset: [0, 0, 0.12] });
  });

  it('treats down / up as point and unknown beams as point', () => {
    expect(hintDefaults({ beam: 'down' }).beam).toBe('point');
    expect(hintDefaults({ beam: 'up' }).beam).toBe('point');
    expect(hintDefaults({ beam: 'laser' }).beam).toBe('point');
  });

  it('replaces invalid values with defaults', () => {
    const h = hintDefaults({ max: -1, distance: 'far', decay: NaN, penumbra: 3, target: [1, 2], castShadow: 'yes', offset: ['a', 0, 0], angle: 'wide' });
    expect(h).toEqual(DEF);
  });

  it('clamps the spot angle to 5..80 degrees', () => {
    expect(hintDefaults({ angle: 1 }).angle).toBe(5);
    expect(hintDefaults({ angle: 120 }).angle).toBe(80);
    expect(hintDefaults({ angle: 45 }).angle).toBe(45);
  });
});

describe('findGlow', () => {
  const tree = {
    name: 'lamp', userData: {}, children: [
      { name: 'base', userData: {}, isMesh: true, children: [] },
      { name: 'shade', userData: {}, children: [
        { name: 'bulb_glow', userData: { name: 'bulb:glow' }, isMesh: true, children: [] },
        { name: 'glow', userData: {}, isMesh: true, children: [] },
      ] },
    ],
  };

  it('finds the first mesh by name, userData.name first', () => {
    expect(findGlow(tree, 'glow').name).toBe('glow');
    expect(findGlow(tree, 'bulb:glow').name).toBe('bulb_glow');
  });

  it('returns null when nothing matches', () => {
    expect(findGlow(tree, 'nope')).toBeNull();
    expect(findGlow(null, 'glow')).toBeNull();
  });

  it('a named group resolves to its first mesh', () => {
    const t = { name: 'lamp', children: [{ name: 'glow', children: [{ name: 'glow_1', isMesh: true, children: [] }] }] };
    expect(findGlow(t, 'glow').name).toBe('glow_1');
  });

  it('the node itself can be the glow mesh', () => {
    const t = { name: 'glow', isMesh: true, children: [] };
    expect(findGlow(t, 'glow')).toBe(t);
  });
});

describe('types', () => {
  it('has the registry with defaults', () => {
    for (const k of ['light', 'light_strip', 'mower', 'dock', 'ev_charger', 'climate', 'generic']) {
      expect(typeof TYPES[k].prepare).toBe('function');
      expect(typeof TYPES[k].update).toBe('function');
      expect(TYPES[k].defaults).toHaveProperty('tap');
    }
    expect(TYPES.light.defaults).toEqual({ tap: 'toggle', hold: 'popup', popup: ['toggle', 'brightness', 'color'] });
    expect(typeOf('nonsense')).toBe(TYPES.generic);
  });

  const lamp = () => {
    const root = new THREE.Group();
    const node = new THREE.Group();
    node.position.set(2, 1, 0);
    const mat = new THREE.MeshStandardMaterial({ emissive: 0x333333, emissiveIntensity: 1 });
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat);
    glow.name = 'glow';
    glow.position.set(0, 0.5, 0);
    node.add(glow);
    root.add(node);
    return { root, node, glow, mat };
  };

  it('light: clones the glow material, starts dark, anchors at the glow centre', () => {
    const { root, node, glow, mat } = lamp();
    const obj = { id: 'l1', type: 'light', node, glow: null, hints: {} };
    const part = TYPES.light.prepare(obj, { root });
    expect(glow.material).not.toBe(mat);
    expect(glow.material.emissive.getHex()).toBe(0);
    expect(glow.material.emissiveIntensity).toBe(0);
    expect(glow.material.userData.baseEmissive).toBe(0x333333);
    expect(part.anchor.toArray()).toEqual([2, 1.5, 0]);
    expect(part.pool).toBe(true);
    TYPES.light.dispose(part);
    expect(glow.material).toBe(mat);
  });

  it('light: hints.offset moves the anchor in the model frame', () => {
    const { root, node } = lamp();
    const part = TYPES.light.prepare({ id: 'l', type: 'light', node, hints: { offset: [0, 0, 0.12] } }, { root });
    expect(part.anchor.toArray().map((v) => +v.toFixed(3))).toEqual([2, 1.5, 0.12]);
  });

  it('light: update sets emissive from level and colour', () => {
    const { root, node, glow } = lamp();
    const part = TYPES.light.prepare({ id: 'l', type: 'light', node, hints: {} }, { root });
    const on = { state: 'on', attributes: { brightness: 255, rgb_color: [255, 0, 0] } };
    let r = TYPES.light.update(part, { lit: true, source: on });
    expect(r).toEqual({ lit: true, level: 1, color: [255, 0, 0] });
    expect(glow.material.emissiveIntensity).toBe(3);
    expect(glow.material.emissive.r).toBeCloseTo(1);
    r = TYPES.light.update(part, { lit: false, source: on });
    expect(r.lit).toBe(false);
    expect(glow.material.emissiveIntensity).toBe(0);
    // relay (no light.* source): full brightness warm white
    r = TYPES.light.update(part, { lit: true, source: null });
    expect(r.level).toBe(1);
  });

  it('light without a glow mesh: anchor at the node bounding-box centre, no material', () => {
    const root = new THREE.Group();
    const node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    node.position.set(0, 2, 0);
    root.add(node);
    const part = TYPES.light.prepare({ id: 'x', type: 'light', node, hints: {} }, { root });
    expect(part.glow).toBeNull();
    expect(part.anchor.toArray()).toEqual([0, 2, 0]);
    expect(TYPES.light.update(part, { lit: true, source: null }).lit).toBe(true);
  });

  it('two objects sharing one glow mesh: one clone, strongest owner wins, original back after the last owner', () => {
    const { root, node, glow, mat } = lamp();
    const a = TYPES.light.prepare({ id: 'a', type: 'light', node, hints: {} }, { root });
    const clone = glow.material;
    const b = TYPES.light.prepare({ id: 'b', type: 'light', node, hints: {} }, { root });
    expect(glow.material).toBe(clone); // cloned once per mesh
    const on = (bri, rgb) => ({ lit: true, source: { state: 'on', attributes: { brightness: bri, rgb_color: rgb } } });
    TYPES.light.update(a, on(255, [255, 0, 0]));
    TYPES.light.update(b, on(51, [0, 0, 255]));
    expect(clone.emissiveIntensity).toBeCloseTo(3);
    expect(clone.emissive.r).toBeCloseTo(1);
    TYPES.light.update(a, { lit: false, source: null });
    expect(clone.emissiveIntensity).toBeCloseTo(0.6); // b still on
    expect(clone.emissive.b).toBeCloseTo(1);
    TYPES.light.update(b, { lit: false, source: null });
    expect(clone.emissiveIntensity).toBe(0);
    TYPES.light.update(b, on(255, [0, 255, 0]));
    let disposed = 0;
    clone.addEventListener('dispose', () => disposed++);
    TYPES.light.dispose(a);
    expect(glow.material).toBe(clone); // b still owns it
    expect(clone.emissive.g).toBeCloseTo(1);
    TYPES.light.dispose(b);
    expect(glow.material).toBe(mat);
    expect(disposed).toBe(1);
    TYPES.light.dispose(b); // twice is harmless
    expect(disposed).toBe(1);
  });

  it('light_strip pools only with an explicit hints.max', () => {
    const { root, node } = lamp();
    expect(TYPES.light_strip.prepare({ id: 's', node, hints: {} }, { root }).pool).toBe(false);
    expect(TYPES.light_strip.prepare({ id: 's', node, hints: { max: 3 } }, { root }).pool).toBe(true);
  });

  it('generic: no visual change', () => {
    const { root, node, glow, mat } = lamp();
    const part = TYPES.generic.prepare({ id: 'g', node, hints: {} }, { root });
    expect(glow.material).toBe(mat);
    expect(part.pool).toBe(false);
    expect(TYPES.generic.update(part, { lit: true, source: null }).lit).toBe(false);
  });
});
