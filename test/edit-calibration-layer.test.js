// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { FloorplanView } from '../src/view.js';

describe('calibration point visibility in the real DOM renderer', () => {
  it('keeps a numbered ground point above a nearer device badge without moving it or changing ordinary handles', () => {
    const view = Object.create(FloorplanView.prototype);
    Object.assign(view, { overlayGroup: new THREE.Group(), cssObjects: [], floorElevation: () => 3, _applyFloorVisibility: vi.fn() });
    const point = document.createElement('span'); point.className = 'fp-handle draw calibration'; point.textContent = '1'; point.style.pointerEvents = 'none';
    const ordinary = document.createElement('button'); ordinary.className = 'fp-handle vertex';
    const device = document.createElement('button'); device.textContent = 'Lamp';
    const marker = new CSS2DObject(device); marker.position.set(1, 5, -2);
    view.setOverlay({ handles: [{ element: point, x: 1, y: 2, floorId: 'ground' }, { element: ordinary, x: 2, y: 2, floorId: 'ground' }] });
    const scene = new THREE.Scene(); scene.add(view.overlayGroup, marker);
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 100); camera.position.set(0, 15, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
    const renderer = new CSS2DRenderer(); renderer.setSize(300, 300); renderer.render(scene, camera);
    expect(Number(point.style.zIndex)).toBeGreaterThan(Number(device.style.zIndex));
    expect(view.cssObjects[0].obj.position.toArray()).toEqual([1, 3.03, -2]);
    expect(view.cssObjects[1].obj.renderOrder).toBe(0); expect(point.style.pointerEvents).toBe('none');
    view.setOverlay({}); expect(point.parentNode).toBeNull(); expect(ordinary.parentNode).toBeNull();
  });
});
