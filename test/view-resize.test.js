// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { FloorplanView } from '../src/view.js';

function fixture() {
  const canvas = document.createElement('canvas');
  const renderer = { domElement: canvas, setSize: vi.fn((w, h) => { canvas.width = w; canvas.height = h; }) };
  const labelRenderer = new CSS2DRenderer();
  const persp = new THREE.PerspectiveCamera(35, 1, .3, 500), ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 500);
  const view = Object.assign(Object.create(FloorplanView.prototype), { renderer, labelRenderer, persp, ortho, size: { w: 1, h: 1 }, dirty: false });
  const calls = { labels: vi.spyOn(labelRenderer, 'setSize'), perspective: vi.spyOn(persp, 'setViewOffset'),
    orthographic: vi.spyOn(ortho, 'setViewOffset'), perspectiveProjection: vi.spyOn(persp, 'updateProjectionMatrix'),
    orthographicProjection: vi.spyOn(ortho, 'updateProjectionMatrix'), orthoLayout: vi.spyOn(view, '_updateOrtho') };
  return { view, canvas, calls };
}

const offsets = (camera) => ({ ...camera.view });
const projections = (view) => [view.persp.projectionMatrix.toArray(), view.ortho.projectionMatrix.toArray()];

describe('actual viewport sizing and camera projections', () => {
  it('applies the first valid size to the canvas, CSS labels and both actual camera projections', () => {
    const { view, canvas, calls } = fixture(), before = projections(view);
    view.resize(1248, 600);
    expect(view.size).toEqual({ w: 1248, h: 600 }); expect(canvas.width).toBe(1248); expect(canvas.height).toBe(600);
    expect(view.labelRenderer.domElement.style.width).toBe('1248px'); expect(view.labelRenderer.domElement.style.height).toBe('600px');
    expect(view.persp.aspect).toBe(1248 / 648); expect(view.ortho.left).toBe(-10 * 1248 / 648); expect(view.ortho.right).toBe(10 * 1248 / 648);
    expect(offsets(view.persp)).toMatchObject({ enabled: true, fullWidth: 1248, fullHeight: 648, width: 1248, height: 600 });
    expect(offsets(view.ortho)).toMatchObject({ enabled: true, fullWidth: 1248, fullHeight: 648, width: 1248, height: 600 });
    expect(projections(view)).not.toEqual(before); expect(projections(view).flat().every(Number.isFinite)).toBe(true);
    expect(calls.perspectiveProjection).toHaveBeenCalledTimes(1); expect(calls.orthographicProjection).toHaveBeenCalledTimes(1); expect(view.dirty).toBe(true);
  });
  it('treats a second equal ResizeObserver/panel notification as a complete no-op', () => {
    const { view, calls } = fixture(); view.resize(1248, 600); view.dirty = false;
    const size = view.size, perspectiveView = view.persp.view, orthoView = view.ortho.view, matrices = projections(view);
    for (let count = 0; count < 20; count++) view.resize(1248, 600);
    expect(view.size).toBe(size); expect(view.persp.view).toBe(perspectiveView); expect(view.ortho.view).toBe(orthoView); expect(projections(view)).toEqual(matrices);
    expect(view.renderer.setSize).toHaveBeenCalledTimes(1); for (const spy of Object.values(calls)) expect(spy).toHaveBeenCalledTimes(1);
    expect(view.dirty).toBe(false);
  });
  it('preserves an already pending frame on an equal notification', () => {
    const { view, calls } = fixture(); view.resize(600, 400); view.dirty = true; view.resize(600, 400);
    expect(view.dirty).toBe(true); expect(view.renderer.setSize).toHaveBeenCalledTimes(1); expect(calls.orthoLayout).toHaveBeenCalledTimes(1);
  });
  it('still applies the first 1×1 viewport even though the constructor stores that placeholder', () => {
    const { view, calls } = fixture(); view.resize(1, 1);
    expect(view.renderer.setSize).toHaveBeenCalledExactlyOnceWith(1, 1); expect(calls.labels).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(view.persp.view).toMatchObject({ width: 1, height: 1, fullHeight: 49 }); expect(view.dirty).toBe(true);
    view.dirty = false; view.resize(1, 1); expect(view.renderer.setSize).toHaveBeenCalledTimes(1); expect(view.dirty).toBe(false);
  });
  it('applies each genuinely changed width or height once, retaining the existing toolbar crop', () => {
    const { view, calls } = fixture(); view.resize(600, 400); view.dirty = false;
    const before = projections(view); view.resize(700, 400); expect(view.dirty).toBe(true); expect(projections(view)).not.toEqual(before);
    view.dirty = false; view.resize(700, 500);
    expect(view.size).toEqual({ w: 700, h: 500 }); expect(view.persp.aspect).toBe(700 / 548);
    expect(view.persp.view).toMatchObject({ fullWidth: 700, fullHeight: 548, width: 700, height: 500 });
    expect(view.renderer.setSize).toHaveBeenCalledTimes(3); for (const spy of Object.values(calls)) expect(spy).toHaveBeenCalledTimes(3);
    expect(view.dirty).toBe(true);
  });
  it.each([0, -1, NaN, Infinity, -Infinity, '700', true, null, undefined, [], {}, new Number(700)])('rejects invalid width %j without consuming the first-size application', (width) => {
    const { view, calls } = fixture(), size = view.size, before = projections(view); view.resize(width, 400);
    expect(view.size).toBe(size); expect(view.dirty).toBe(false); expect(view.renderer.setSize).not.toHaveBeenCalled();
    for (const spy of Object.values(calls)) expect(spy).not.toHaveBeenCalled(); expect(projections(view)).toEqual(before);
    view.resize(1, 1); expect(view.renderer.setSize).toHaveBeenCalledExactlyOnceWith(1, 1);
  });
  it.each([0, -1, NaN, Infinity, -Infinity, '400', false, null, undefined, [], {}, new Number(400)])('rejects invalid height %j and preserves a current valid viewport', (height) => {
    const { view, calls } = fixture(); view.resize(700, 400); view.dirty = true;
    const size = view.size, before = projections(view); view.resize(700, height);
    expect(view.size).toBe(size); expect(projections(view)).toEqual(before); expect(view.dirty).toBe(true);
    expect(view.renderer.setSize).toHaveBeenCalledTimes(1); for (const spy of Object.values(calls)) expect(spy).toHaveBeenCalledTimes(1);
  });
});
