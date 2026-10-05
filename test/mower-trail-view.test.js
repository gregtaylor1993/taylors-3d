// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FloorplanView } from '../src/view.js';

const fixture = () => Object.assign(Object.create(FloorplanView.prototype), {
  trail: null, mowerGroup: new THREE.Group(), theme: { primary: '#03a9f4' },
  floorElevation: (id) => id === 'upper' ? 3 : 0, _shows: (id) => id !== 'hidden', dirty: false,
});

beforeAll(async () => { await import('../src/taylors3d-card.js'); });

describe('mower trail lifecycle and idle rendering', () => {
  it('leaves an already-empty trail idle for absent, empty or single-point paths', () => {
    const view = fixture();
    for (const points of [null, undefined, [], [[1, 2]], null]) view.setTrail(points, 'upper');
    expect(view.dirty).toBe(false);
    expect(view.trail).toBeNull();
    expect(view.mowerGroup.children).toHaveLength(0);
  });

  it('still creates the real trail at the selected floor and releases it exactly once', () => {
    const view = fixture();
    view.setTrail([[1, 2], [3, 4]], 'upper');
    const trail = view.trail, geometry = vi.spyOn(trail.geometry, 'dispose'), material = vi.spyOn(trail.material, 'dispose');
    expect(view.dirty).toBe(true);
    expect(trail.position.y).toBeCloseTo(3.04);
    expect(Array.from(trail.geometry.getAttribute('position').array)).toEqual([1, 0, -2, 3, 0, -4]);
    expect(trail.visible).toBe(true);
    view.dirty = false;
    view.setTrail(null);
    expect(view.dirty).toBe(true);
    expect(trail.parent).toBeNull();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    view.dirty = false;
    view.setTrail(null);
    view.setTrail([]);
    expect(view.dirty).toBe(false);
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });

  it('removes an existing trail when fewer than two points remain', () => {
    const view = fixture();
    view.setTrail([[1, 2], [3, 4]], 'hidden');
    expect(view.trail.visible).toBe(false);
    view.dirty = false;
    view.setTrail([[1, 2]], 'hidden');
    expect(view.dirty).toBe(true);
    expect(view.trail).toBeNull();
    expect(view.mowerGroup.children).toHaveLength(0);
  });

  it('keeps repeated real card mower-off refreshes idle', () => {
    const refresh = customElements.get('taylors3d-card').prototype._refreshMower;
    const view = fixture();
    view.setMapOverlay = vi.fn();
    const card = { _layout: { mower: {} }, _view: view, _setCameraTimer: vi.fn(), _setImageTimer: vi.fn() };
    for (let i = 0; i < 10; i++) refresh.call(card, false);
    expect(view.dirty).toBe(false);
    expect(card._trail).toEqual([]);
    expect(card._mowerLive).toBeNull();
    expect(card._setCameraTimer.mock.calls.every(([seconds]) => seconds === 0)).toBe(true);
    expect(card._setImageTimer.mock.calls.every(([seconds]) => seconds === 0)).toBe(true);
  });
});
