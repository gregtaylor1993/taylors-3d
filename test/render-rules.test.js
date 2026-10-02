import { describe, it, expect } from 'vitest';
import { castsShadow, isCoplanarOverlay, depthRange, depthChanged, isOccluded, sunDirection, ghostMaterial, pickable } from '../src/render-rules.js';

describe('castsShadow', () => {
  const solid = { names: ['wall_1', 'plaster'], layers: [], transparent: false, opacity: 1, transmission: 0, size: [4, 2.7, 0.15] };
  it('opaque solid meshes cast', () => {
    expect(castsShadow(solid)).toBe(true);
    expect(castsShadow({ ...solid, layers: ['furniture'] })).toBe(true);
  });
  it('glass: transparent, opacity < 1, transmission, names, glass layer', () => {
    expect(castsShadow({ ...solid, transparent: true })).toBe(false);
    expect(castsShadow({ ...solid, opacity: 0.98 })).toBe(false);
    expect(castsShadow({ ...solid, transmission: 0.9 })).toBe(false);
    for (const n of ['Window_frame_glass', 'pane_3', 'GLAZING', 'livingroom window']) expect(castsShadow({ ...solid, names: [n] })).toBe(false);
    expect(castsShadow({ ...solid, layers: ['glass'] })).toBe(false);
    expect(castsShadow({ ...solid, layers: ['facade_glass'] })).toBe(false);
  });
  it('floor overlays and ground: terrain / floor / decal / label layers, flat thin meshes', () => {
    for (const l of ['terrain', 'floor', 'decal', 'label']) expect(castsShadow({ ...solid, layers: [l] })).toBe(false);
    expect(castsShadow({ ...solid, size: [3, 0.01, 2] })).toBe(false);
    expect(castsShadow({ ...solid, size: [3, 0.04, 2] })).toBe(true); // a ceiling slab still casts
    expect(castsShadow({ ...solid, size: [0.01, 0.01, 0.01] })).toBe(true); // tiny, not flat
  });
});

describe('isCoplanarOverlay', () => {
  it('decal / edging layers and overlay-like names', () => {
    expect(isCoplanarOverlay({ names: ['lawn_edging'], layers: [] })).toBe(true);
    expect(isCoplanarOverlay({ names: ['x'], layers: ['decal'] })).toBe(true);
    expect(isCoplanarOverlay({ names: ['x'], layers: ['edging'] })).toBe(true);
    expect(isCoplanarOverlay({ names: ['Paving Overlay'], layers: [] })).toBe(true);
    expect(isCoplanarOverlay({ names: ['wall'], layers: ['furniture'] })).toBe(false);
  });
});

describe('depthRange', () => {
  it('near follows the distance, far covers the scene', () => {
    expect(depthRange(20, 10)).toEqual({ near: 0.2, far: 50 });
    expect(depthRange(100, 20)).toEqual({ near: 0.5, far: 160 });
    expect(depthRange(30, 25)).toEqual({ near: 0.2, far: 105 });
  });
  it('ortho keeps near 0.1', () => {
    expect(depthRange(60, 20, { ortho: true })).toEqual({ near: 0.1, far: 120 });
  });
  it('changes over 1 % only', () => {
    expect(depthChanged({ near: 0.2, far: 100 }, { near: 0.2, far: 100.5 })).toBe(false);
    expect(depthChanged({ near: 0.2, far: 100 }, { near: 0.2, far: 102 })).toBe(true);
    expect(depthChanged({ near: 0.2, far: 100 }, { near: 0.21, far: 100 })).toBe(true);
  });
});

describe('isOccluded', () => {
  it('a hit closer than the marker minus 0.3 m hides it', () => {
    expect(isOccluded(null, 10)).toBe(false);
    expect(isOccluded(5, 10)).toBe(true);
    expect(isOccluded(9.8, 10)).toBe(false); // the surface the marker sits on
    expect(isOccluded(9.69, 10)).toBe(true);
  });
});

describe('sunDirection', () => {
  const len = (v) => Math.hypot(...v);
  it('default direction without north', () => {
    const d = sunDirection(null);
    expect(len(d)).toBeCloseTo(1);
    const e = [-0.4, 1, 0.35], l = len(e);
    d.forEach((x, i) => expect(x).toBeCloseTo(e[i] / l));
  });
  it('azimuth = north + 0.35 rad, about 42° up, turned with the model rotation', () => {
    const d = sunDirection(0);
    expect(len(d)).toBeCloseTo(1);
    expect(d[0]).toBeCloseTo(-Math.sin(0.35) * 38 / Math.hypot(38, 34));
    expect(d[1]).toBeCloseTo(34 / Math.hypot(38, 34));
    expect(d[2]).toBeCloseTo(Math.cos(0.35) * 38 / Math.hypot(38, 34));
    const r = sunDirection(90, Math.PI / 2); // north 90°, model turned 90° CCW
    const a = Math.PI / 2 + 0.35, h = Math.hypot(38, 34);
    const mx = -Math.sin(a) * 38 / h, mz = Math.cos(a) * 38 / h;
    expect(r[0]).toBeCloseTo(mx * Math.cos(Math.PI / 2) + mz * Math.sin(Math.PI / 2));
    expect(r[2]).toBeCloseTo(-mx * Math.sin(Math.PI / 2) + mz * Math.cos(Math.PI / 2));
  });
});

describe('ghostMaterial', () => {
  const base = { wasTransparent: false, baseOpacity: 1, baseDepthWrite: true };
  it('ghosted: blended with depth writes kept', () => {
    expect(ghostMaterial(base, 0.6)).toEqual({ transparent: true, alphaHash: false, depthWrite: true, opacity: 0.6, alphaToCoverage: false });
    expect(ghostMaterial({ ...base, baseDepthWrite: false }, 0.6).depthWrite).toBe(true);
  });
  it('opaque again restores', () => {
    expect(ghostMaterial(base, 1)).toEqual({ transparent: false, alphaHash: false, depthWrite: true, opacity: 1, alphaToCoverage: false });
  });
  it('originally transparent materials are untouched', () => {
    expect(ghostMaterial({ wasTransparent: true, baseOpacity: 0.3, baseDepthWrite: false }, 0.6)).toBe(null);
  });
});

describe('pickable', () => {
  it('skips helpers, lines, see-through meshes', () => {
    expect(pickable({ isMesh: true, helper: false, transparent: false, opacity: 1 })).toBe(true);
    expect(pickable({ isMesh: true, helper: true, transparent: false, opacity: 1 })).toBe(false);
    expect(pickable({ isMesh: false, helper: false, transparent: false, opacity: 1 })).toBe(false);
    expect(pickable({ isMesh: true, helper: false, transparent: true, opacity: 0.4 })).toBe(false);
    expect(pickable({ isMesh: true, helper: false, transparent: true, opacity: 0.8 })).toBe(true);
  });
});
