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
  card._hass = { connection: { connected: true }, user: { id: 'taylor', is_admin: true, is_active: true }, states: { 'binary_sensor.front': state('off') }, entities: {}, devices: {}, callService: vi.fn() };
  card._floors = [{ id: 'ground', elevation: 0 }]; card._roomList = []; card._positions = new Map(); card._markers = [];
  card._view = { model, scene: new THREE.Scene(), dirty: false, modelClip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 10),
    sectionClip: null, modelMotionChanged: vi.fn(() => ({ changed: true, objectIds: new Set(['front']) })), floorElevation: (id) => card._floors.find((floor) => floor.id === id)?.elevation ?? 0, screenPoint: vi.fn(() => [50, 60]), stop: vi.fn() };
  card._objects = { parts: new Map(), objectAt: () => ({ obj: { id: 'front', node: door }, binding: {} }), anchors: () => [] };
  card._refreshAttached = vi.fn(); card._syncCameraCoverage = vi.fn(); card._syncMiniMap = vi.fn();
  card._syncTracking = vi.fn(); card._popup = { close: vi.fn() }; card._devicePopup = { close: vi.fn(), update: vi.fn(), showMarker: vi.fn() };
  card._schedule = vi.fn(); cards.push(card); return { card, root, door, leaf, model };
}
beforeAll(async () => { await import('../src/taylors3d-card.js'); });
afterEach(() => { for (const card of cards.splice(0)) { card._clearTrackingTimer(); card._securityLayer?.dispose(); card._planSecurityLayer?.dispose(); card._miniMap?.dispose(); }
  vi.restoreAllMocks(); vi.useRealTimers(); delete window.__demoNow; document.body.replaceChildren(); });

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

describe('explicit plan and lock security in the existing card', () => {
  const plan = (extra = {}) => ({ id: 'plan', entity: 'lock.entry', kind: 'lock', target: { type: 'plan', position: { x: 1, y: 2, z: .4, floorId: 'upper' } }, ...extra });
  function prepared(settings = {}) {
    const ctx = fixture({ security_bindings: [plan()], ...settings }); ctx.card._view.model = null;
    ctx.card._floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 3 }];
    ctx.card._hass.states['lock.entry'] = { state: 'unlocked', attributes: { friendly_name: 'Entry lock' }, last_updated: new Date(epoch).toISOString() };
    return ctx;
  }
  it('renders an explicit plan without a house GLB and applies source-to-display separation once', () => {
    const { card } = prepared(); card._floorPresentationReportValue = { valid: true, mode: 'horizontal', rows: [{ floor_id: 'upper', offset: [10, 2, -4] }] };
    card._syncSecurity(); expect(card._securityPlanData.records[0]).toMatchObject({ open: null, active: true, locked: false, location: { x: 1, y: 2, z: .4, elevation: 3 } });
    expect(card._planSecurityLayer.parts.get('plan').group.position.toArray()).toEqual([11, 5.4, -6]);
    expect(card._securityPlanData.miniMap[0].position.x).toBe(1); expect(card._securityLayer.diagnostics.some((d) => d.code === 'missing_object')).toBe(false);
    card._view.scene.traverse((node) => expect(node.isLight).not.toBe(true)); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('reuses glyphs and materials for equal or unrelated current snapshots, including closed clear readings', () => {
    const { card } = prepared(); card._syncSecurity(); const part = card._planSecurityLayer.parts.get('plan'), version = part.ringMaterial.version;
    card._view.dirty = false;
    for (let i = 0; i < 10; i++) { card._hass.states['sensor.unrelated'] = state(String(i)); card._syncSecurity(); }
    expect(card._planSecurityLayer.parts.get('plan')).toBe(part); expect(part.ringMaterial.version).toBe(version); expect(card._view.dirty).toBe(false);
    card._hass.states['lock.entry'].state = 'locked'; card._syncSecurity(); expect(part.group.visible).toBe(false);
    card._view.dirty = false; card._syncSecurity(); expect(card._view.dirty).toBe(false); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('uses the original single nearest timer for model, plan and tracking deadlines', () => {
    const { card, model } = prepared({ security_bindings: [{ ...binding, motion: undefined, freshness: { timestamp_mode: 'last_updated', max_age_seconds: 4 } }, plan({ freshness: { timestamp_mode: 'last_updated', max_age_seconds: 2 } })] });
    card._view.model = model;
    card._trackingData.nextExpiry = epoch + 6000; card._syncSecurity(); expect(card._trackingDeadline).toBe(epoch + 2000); expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2000); expect(card._securityPlanData.records[0].status).toBe('stale'); expect(card._planSecurityLayer.parts.get('plan').ringMaterial.color.getHexString()).toBe('8d9199');
    expect(card._trackingDeadline).toBe(epoch + 4000); expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2000); expect(card._securityLayer.parts.get('front').reading.status).toBe('stale');
    expect(card._trackingDeadline).toBe(epoch + 6000); expect(vi.getTimerCount()).toBe(1); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('composes Section and selected floors without relinking a missing exact target', () => {
    const { card } = prepared(); card._view.sectionClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 3);
    card._syncSecurity(); const part = card._planSecurityLayer.parts.get('plan'); expect(part.group.visible).toBe(false); expect(part.body.disabled).toBe(true);
    expect(card._showPlanSecurityEntity('plan')).toBe(false); card._view.sectionClip.constant = 4; card._syncSecurity(); expect(part.group.visible).toBe(true);
    card._floorOnly = 'ground'; card._floor = 'ground'; card._syncSecurity(); expect(part.group.visible).toBe(false); expect(card._securityPlanData.records[0].location.floorId).toBe('upper');
    card._floors = [{ id: 'ground', elevation: 0 }]; card._syncSecurity(); expect(card._securityPlanData.records[0].location).toBeNull(); expect(card._planSecurityLayer.parts.size).toBe(0); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('observes same-connection loss before recovery and invalidates old button/map intents', () => {
    const { card } = prepared(); card._syncSecurity(); const button = card._planSecurityLayer.parts.get('plan').body, generation = card._securitySessionGeneration;
    button.dispatchEvent(new Event('pointerdown')); card._hass.connection.connected = false; card.hass = card._hass;
    card._hass.connection.connected = true; card.hass = card._hass; button.click(); expect(card._devicePopup.showMarker).not.toHaveBeenCalled();
    expect(card._securitySessionGeneration).toBeGreaterThan(generation); expect(card._showPlanSecurityEntity('plan', { generation, entity: 'lock.entry' })).toBe(false);
    const fresh = card._planSecurityLayer.parts.get('plan').body; fresh.dispatchEvent(new Event('pointerdown')); fresh.click();
    expect(card._devicePopup.showMarker).toHaveBeenCalledOnce(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('opens current locked or uncertain information and closes it after the binding changes source', () => {
    const { card } = prepared(); card._hass.states['lock.entry'].state = 'locked'; card._syncSecurity(); expect(card._showPlanSecurityEntity('plan')).toBe(true);
    expect(card._devicePopup.showMarker).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'lock.entry' }), [50, 60]);
    card._hass.states['lock.other'] = { state: 'unlocked', attributes: {} }; card._layout.security_bindings = [plan({ entity: 'lock.other' })]; card._syncSecurity();
    expect(card._devicePopup.close).toHaveBeenCalled(); expect(card._securityPopup).toBeNull();
    expect(card._showPlanSecurityEntity('plan', { entity: 'lock.entry' })).toBe(false); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('cannot reinterpret a held current map node after the same binding ID changes entity or source context', () => {
    const { card } = prepared(); card._stage = document.createElement('div'); document.body.append(card._stage); card._focusPlan = vi.fn();
    card._hass.states['lock.other'] = { state: 'unlocked', attributes: {} }; card._syncSecurity(); card._configureMiniMap();
    const generation = card._securitySessionGeneration;
    const update = () => card._miniMap.update({ rooms: [{ room: { id: 'upper-room', polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] }, floorId: 'upper' }],
      floors: card._floors, visibleFloors: ['upper'], trackedMarkers: card._securityPlanData.miniMap.map((marker) => ({ ...marker, id: `${marker.id}:${card._securitySessionGeneration}` })) });
    update(); const old = card._miniMap.el.querySelector('[data-marker]'); old.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    card._layout.security_bindings = [plan({ entity: 'lock.other' })]; card._syncSecurity(); update();
    old.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(card._devicePopup.showMarker).not.toHaveBeenCalled();
    expect(card._securitySessionGeneration).toBeGreaterThan(generation);
    // A genuine map focus changes the current floor/view synchronously. It is
    // part of this accepted gesture, not a reason to reject its own popup.
    card._focusPlan.mockImplementationOnce(() => { card._viewId = 'upper'; card._syncSecurity(); });
    const fresh = card._miniMap.el.querySelector('[data-marker]'); fresh.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(card._devicePopup.showMarker).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'lock.other' }), [50, 60]);
    const current = card._securitySessionGeneration; card._layout.security_bindings = structuredClone(card._layout.security_bindings);
    card._hass.states['lock.other'] = { state: 'locked', attributes: {} }; card._syncSecurity(); expect(card._securitySessionGeneration).toBe(current);
    card._config.layout_key = 'different-house'; card._syncSecurity(); expect(card._securitySessionGeneration).toBeGreaterThan(current);
    expect(card._hass.callService).not.toHaveBeenCalled(); card._miniMap.dispose();
  });
  it('disposes only the owned old scene resources and retains static readings across renderer replacement', () => {
    const { card } = prepared(); card._syncSecurity(); const old = card._planSecurityLayer, geometry = vi.spyOn(old.ringGeometry, 'dispose');
    card._view.scene = new THREE.Scene(); card._syncSecurity(); expect(geometry).toHaveBeenCalledOnce(); expect(old.group.parent).toBeNull();
    expect(card._planSecurityLayer).not.toBe(old); expect(card._planSecurityLayer.parts.get('plan').record.status).toBe('unlocked');
    card._resetSecurity(); expect(card._planSecurityLayer.parts.size).toBe(0); expect(card._securityPlanData.nextExpiry).toBeNull();
  });
});
