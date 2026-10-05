// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildManifest, threeAdapter } from '../src/manifest.js';

const epoch = Date.parse('2026-10-05T12:00:00Z'), cards = [];
const binding = { id: 'front', entity: 'binary_sensor.front', object_id: 'front', kind: 'door', open_states: ['on'], closed_states: ['off'],
  motion: { target: 'leaf', pivot: [0, 0, 0], axis: [0, 1, 0], closed_degrees: 0, open_degrees: 90, duration_ms: 200 } };
const state = (value, extra = {}) => ({ state: value, attributes: { device_class: 'door', ...extra }, last_updated: new Date(epoch).toISOString() });
function fixture(settings = {}) {
  vi.useFakeTimers(); vi.setSystemTime(epoch); delete window.__demoNow;
  const card = document.createElement('taylors3d-card'); card.connected = true;
  Object.defineProperty(card, 'isConnected', { get: () => card.connected });
  const root = new THREE.Group(), door = new THREE.Group(), leaf = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .1), new THREE.MeshStandardMaterial());
  door.userData.fp = { kind: 'object', id: 'front', type: 'door' }; leaf.name = 'leaf'; leaf.position.set(1, 1, 0); root.add(door); door.add(leaf);
  const model = { id: 'test-house', root, manifest: buildManifest(threeAdapter(root)) }; root.updateMatrixWorld(true);
  card._config = { layout_key: 'house' }; card._layout = { security_bindings: [structuredClone(binding)], ...settings };
  card._hass = { connection: {}, user: { is_admin: true }, states: { 'binary_sensor.front': state('off') }, entities: {}, devices: {}, callService: vi.fn() };
  card._floors = [{ id: 'ground', elevation: 0 }]; card._roomList = []; card._positions = new Map(); card._markers = [];
  card._view = { model, scene: new THREE.Scene(), dirty: false, modelClip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 10),
    sectionClip: null, modelMotionChanged: vi.fn(() => ({ changed: true, objectIds: new Set(['front']) })), floorElevation: () => 0, stop: vi.fn() };
  card._objects = { parts: new Map(), objectAt: () => ({ obj: { id: 'front', node: door }, binding: {} }), anchors: () => [] };
  card._refreshAttached = vi.fn(); card._syncCameraCoverage = vi.fn(); card._syncMiniMap = vi.fn();
  card._syncTracking = vi.fn(); card._popup = { close: vi.fn() }; card._devicePopup = { close: vi.fn() };
  card._schedule = vi.fn(); cards.push(card); return { card, root, door, leaf, model };
}
beforeAll(async () => { await import('../src/taylors3d-card.js'); });
afterEach(() => { for (const card of cards.splice(0)) { card._clearTrackingTimer(); card._securityLayer?.dispose(); }
  vi.restoreAllMocks(); vi.useRealTimers(); delete window.__demoNow; });

describe('security evidence in the actual card lifecycle', () => {
  it('animates the exact leaf and refreshes existing geometry/anchors after real contact changes', () => {
    const { card, leaf } = fixture(); card._syncSecurity();
    card._hass.states['binary_sensor.front'] = state('on'); card._syncSecurity();
    expect(card._securityLayer.moving).toBe(true);
    const start = card._securityLayer.parts.get('front').tween.start;
    card._animateFeatures(start + 100); expect(leaf.rotation.y).toBeCloseTo(Math.PI / 4);
    expect(card._view.modelMotionChanged).toHaveBeenLastCalledWith(new Set([leaf]), { moving: true });
    expect(card._refreshAttached).toHaveBeenCalled(); expect(card._syncMiniMap).toHaveBeenCalled();
    card._animateFeatures(start + 200); expect(leaf.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(card._view.modelMotionChanged).toHaveBeenLastCalledWith(new Set([leaf]), { moving: false });
    expect(card._securityLayer.moving).toBe(false); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('leaves unchanged contacts, unrelated entities and off bindings idle', () => {
    const { card } = fixture(); card._syncSecurity(); card._view.dirty = false;
    const lines = card._securityLayer.parts.get('front').lines;
    card._view.modelMotionChanged.mockClear(); card._refreshAttached.mockClear();
    for (let i = 0; i < 10; i++) { card._hass = { ...card._hass, states: { ...card._hass.states, 'sensor.unrelated': { state: String(i), attributes: {} } } }; card._syncSecurity(); }
    expect(card._securityLayer.parts.get('front').lines).toBe(lines); expect(card._view.dirty).toBe(false);
    expect(card._view.modelMotionChanged).not.toHaveBeenCalled(); expect(card._refreshAttached).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('uses one shared nearest expiry timer and expires a stale contact without HA updates', () => {
    const { card, leaf } = fixture({ security_bindings: [{ ...binding, freshness: { timestamp_mode: 'last_updated', timestamp_format: 'iso', max_age_seconds: 5 } }] });
    card._hass.states['binary_sensor.front'] = state('on'); card._reducedMotion = { matches: true }; card._syncSecurity();
    card._trackingData.nextExpiry = epoch + 10000; card._setTrackingTimer(card._trackingData.nextExpiry);
    expect(card._trackingDeadline).toBe(epoch + 5000); expect(vi.getTimerCount()).toBe(1); expect(leaf.rotation.y).toBeCloseTo(Math.PI / 2);
    vi.advanceTimersByTime(5000);
    expect(card._securityLayer.parts.get('front').reading.status).toBe('stale'); expect(leaf.rotation.y).toBeCloseTo(0);
    expect(card._securityLayer.parts.get('front').color).toBe('#8d9199');
    expect(card._trackingDeadline).toBe(epoch + 10000); expect(vi.getTimerCount()).toBe(1); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('does not treat unknown or restored evidence as a closed door', () => {
    const { card, leaf } = fixture(); card._reducedMotion = { matches: true }; card._hass.states['binary_sensor.front'] = state('on'); card._syncSecurity();
    expect(leaf.rotation.y).toBeCloseTo(Math.PI / 2);
    for (const reading of [state('unknown'), state('on', { restored: true })]) {
      card._hass.states['binary_sensor.front'] = reading; card._syncSecurity();
      expect(leaf.rotation.y).toBeCloseTo(0); expect(card._securityLayer.parts.get('front').reading.open).toBeNull();
      expect(card._securityLayer.parts.get('front').color).toBe('#8d9199');
    }
  });
  it('protects independently driven parts and exact hidden selections', () => {
    const { card, door, leaf } = fixture(); card._objects.parts.set('front', { obj: { id: 'front', node: leaf }, type: { place: () => {} } });
    card._hass.states['binary_sensor.front'] = state('on'); card._reducedMotion = { matches: true }; card._syncSecurity();
    expect(leaf.rotation.y).toBeCloseTo(0); expect(card._securityLayer.diagnostics.some((d) => d.code === 'shared_writer')).toBe(true);
    door.visible = false; card._syncSecurity(); expect(card._securityLayer.parts.get('front').lines.every((line) => !line.visible)).toBe(true);
  });
  it('shares actual clipping planes and restores authored geometry on a layout/model reset', () => {
    const { card, leaf, model } = fixture(); card._reducedMotion = { matches: true };
    card._view.sectionClip = new THREE.Plane(new THREE.Vector3(1, 0, 0), -1); card._hass.states['binary_sensor.front'] = state('on'); card._syncSecurity();
    expect(card._securityLayer.parts.get('front').material.clippingPlanes).toHaveLength(2); expect(card._view.securityLayer).toBe(card._securityLayer);
    card._resetSecurity(); expect(leaf.rotation.y).toBeCloseTo(0); expect(card._securityLayer.parts.size).toBe(0);
    expect(leaf.children.filter((n) => n.userData.helper)).toHaveLength(0); expect(card._view.model).toBe(model);
    card._syncSecurity(); expect(card._securityLayer.parts.size).toBe(1);
  });
  it('ends visible motion and timers on disconnect and reevaluates deadlines on resume', () => {
    const { card } = fixture({ security_bindings: [{ ...binding, freshness: { timestamp_mode: 'last_updated', timestamp_format: 'iso', max_age_seconds: 5 } }] });
    card._hass.states['binary_sensor.front'] = state('on'); card._syncSecurity(); card._setTrackingTimer(null);
    card.connected = false; card.disconnectedCallback(); expect(vi.getTimerCount()).toBe(0); expect(card._securityLayer.moving).toBe(false);
    vi.advanceTimersByTime(7000); card.connected = true; card._syncSecurity(true);
    expect(card._securityLayer.parts.get('front').reading.status).toBe('stale'); expect(card._securityLayer.moving).toBe(false);
  });
});
