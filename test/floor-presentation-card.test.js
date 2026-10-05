// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import '../src/taylors3d-card.js';

const instances = [];
const settings = (extra = {}) => ({ mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2, axis: 'east', ...extra });
function fixture() {
  const card = new (customElements.get('taylors3d-card'))(); instances.push(card);
  Object.defineProperty(card, 'isConnected', { value: true, configurable: true });
  card._mode = '3d'; card._viewId = 'upper'; card._floorOnly = null;
  card._config = { layout_key: 'house' }; card._layout = { model: { version: 1 }, floor_presentation: settings() };
  card._hass = { connection: { connected: true }, user: { id: 'taylor', is_admin: true }, states: {} };
  card._floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 3 }]; card._roomList = [];
  const root = new THREE.Group(), ground = new THREE.Group(), upper = new THREE.Group(); root.add(ground, upper);
  const manifest = { levels: [{ id: 'g', node: ground }, { id: 'u', node: upper }] };
  card._mb = { levels: { g: { auto: false, floor: 'ground' }, u: { auto: false, floor: 'upper' } } };
  card._views = [{ id: 'upper', floors: ['upper'] }, { id: 'all', floors: ['ground', 'upper'] }];
  card._stateFor = vi.fn((view) => ({ floors: view.floors }));
  card._suspendAmbient = vi.fn(); card._stopScenePreview = vi.fn(); card._presetEvents.interrupt = vi.fn();
  card._objects = { parts: new Map(), refreshFloorPresentation: vi.fn() };
  const camera = new THREE.PerspectiveCamera(); camera.position.set(1.123456789123, 6.345678912345, -2.456789123456);
  const controls = { object: camera, target: new THREE.Vector3(.123456789123, 3.456789123456, -.234567891234) };
  let report = { mode: 'assembled', requestedMode: 'assembled', valid: true, rows: [], diagnostics: [] };
  const view = { model: { root, manifest }, camera, controls, mode: '3d', floorPresentationRevision: 0,
    floorElevation: vi.fn((id) => card._floors.find((floor) => floor.id === id)?.elevation ?? 0),
    floorPresentationReport: vi.fn(() => report), stopCameraMotion: vi.fn(),
    fit: vi.fn(() => { camera.position.set(30, 20, 30); controls.target.set(10, 0, 0); }),
    captureCameraFrame: vi.fn(() => ({ camera, controls, modelRoot: root, mode: view.mode,
      position: camera.position.toArray(), target: controls.target.toArray(), quaternion: camera.quaternion.toArray(), up: camera.up.toArray(), zoom: camera.zoom })),
    restoreCameraFrame: vi.fn((frame) => {
      if (frame.camera !== camera || frame.controls !== controls || frame.modelRoot !== root || frame.mode !== view.mode) return false;
      camera.position.fromArray(frame.position); controls.target.fromArray(frame.target); camera.quaternion.fromArray(frame.quaternion); camera.up.fromArray(frame.up); camera.zoom = frame.zoom; return true;
    }),
    setFloorPresentation: vi.fn((raw, options) => {
      const mode = options.enabled && ['horizontal', 'vertical'].includes(raw?.mode) ? raw.mode : 'assembled';
      const rows = mode === 'assembled' ? [] : [{ floor_id: 'ground', offset: [0, 0, 0] }, { floor_id: 'upper', offset: mode === 'horizontal' ? [10, -3, 0] : [0, 2, 0] }];
      const changed = mode !== report.mode || JSON.stringify(rows) !== JSON.stringify(report.rows);
      if (changed) view.floorPresentationRevision++;
      report = { mode, requestedMode: raw?.mode || 'assembled', valid: true, rows, diagnostics: [] };
      return { changed };
    }),
  };
  card._view = view;
  return { card, view, root, ground, upper, camera, controls };
}
afterEach(() => {
  for (const card of instances.splice(0)) { card._ambientController.dispose(); card._scenePreviewController.dispose(); card._presetEvents.disconnect(); }
  vi.restoreAllMocks();
});

describe('card separated floor context and cameras', () => {
  it('leaves an absent policy entirely outside the renderer and controller paths', () => {
    const { card, view } = fixture(); delete card._layout.floor_presentation;
    card._syncFloorPresentation();
    expect(view.setFloorPresentation).not.toHaveBeenCalled(); expect(card._suspendAmbient).not.toHaveBeenCalled();
  });
  it.each([{ mode: 'assembled' }, { mode: 'unknown' }])('reports an unchanged default %j without stopping a running view', (raw) => {
    const { card, view } = fixture(); card._layout.floor_presentation = raw;
    card._syncFloorPresentation();
    expect(card._suspendAmbient).not.toHaveBeenCalled(); expect(card._stopScenePreview).not.toHaveBeenCalled();
    expect(card._presetEvents.interrupt).not.toHaveBeenCalled(); expect(view.stopCameraMotion).not.toHaveBeenCalled();
    expect(view.captureCameraFrame).not.toHaveBeenCalled(); expect(card._objects.refreshFloorPresentation).not.toHaveBeenCalled();
  });
  it('passes exact confirmed nodes and canonical floor elevations without mutating saved settings', () => {
    const { card, view, ground, upper } = fixture(), before = JSON.stringify(card._layout);
    card._syncFloorPresentation();
    expect(view.setFloorPresentation).toHaveBeenCalledWith(card._layout.floor_presentation, expect.objectContaining({ enabled: true,
      targets: [{ floor_id: 'ground', node: ground }, { floor_id: 'upper', node: upper }], floors: card._floors }));
    expect(JSON.stringify(card._layout)).toBe(before);
  });
  it('adds no repeat work for an unrelated HA state object', () => {
    const { card, view } = fixture(); card._syncFloorPresentation(); view.setFloorPresentation.mockClear();
    card._hass.states = { 'sensor.unrelated': { state: '12' } }; card._syncFloorPresentation();
    expect(view.setFloorPresentation).not.toHaveBeenCalled();
  });
  it('does not interrupt a targeted camera preset merely because its view changed', () => {
    const { card, view } = fixture(); card._syncFloorPresentation(); card._presetEvents.interrupt.mockClear(); view.setFloorPresentation.mockClear();
    card._viewId = 'all'; card._syncFloorPresentation();
    expect(card._presetEvents.interrupt).not.toHaveBeenCalled(); expect(view.setFloorPresentation).not.toHaveBeenCalled();
  });
  it('refuses automatic level suggestions and exposes a repair diagnostic', () => {
    const { card, view } = fixture(); card._mb.levels.u.auto = true; card._syncFloorPresentation();
    expect(view.setFloorPresentation.mock.calls[0][1].enabled).toBe(false);
    expect(card.floorPresentationReport().diagnostics.some((issue) => issue.code === 'confirm_floor_link')).toBe(true);
    expect(card._floorPresentationActive()).toBe(false);
  });
  it.each([false, null, undefined])('blocks an explicitly inactive/unknown active flag %s', (is_active) => {
    const { card, view } = fixture(); card._hass.user.is_active = is_active; card._syncFloorPresentation();
    expect(view.setFloorPresentation.mock.calls[0][1].enabled).toBe(false);
  });
  it.each(['', '   ', 3])('requires a nonblank current user ID %j', (id) => {
    const { card, view } = fixture(); card._hass.user.id = id; card._syncFloorPresentation();
    expect(view.setFloorPresentation.mock.calls[0][1].enabled).toBe(false);
  });
  it('suspends a saved split while editing without rewriting the saved policy', () => {
    const { card, view } = fixture(); card._syncFloorPresentation(); card._editing = true; card._syncFloorPresentation();
    expect(view.setFloorPresentation.mock.calls.at(-1)[1].enabled).toBe(false);
    expect(card._layout.floor_presentation.mode).toBe('horizontal');
    expect(card.floorPresentationReport().diagnostics.some((issue) => issue.message.includes('Editing'))).toBe(true);
  });
  it('suspends a saved split for Section without changing its policy', () => {
    const { card } = fixture(); card._syncFloorPresentation(); card._section = true; card._syncFloorPresentation();
    expect(card._floorPresentationActive()).toBe(false); expect(card._layout.floor_presentation.mode).toBe('horizontal');
  });
  it('maps a single-floor raw camera and restores the original exact precision', () => {
    const { card, camera, controls } = fixture(), original = { position: camera.position.toArray(), target: controls.target.toArray() };
    card._syncFloorPresentation();
    expect(camera.position.x).toBe(original.position[0] + 10); expect(controls.target.y).toBe(original.target[1] - 3);
    card._layout.floor_presentation = { mode: 'assembled' }; card._syncFloorPresentation();
    expect(camera.position.toArray()).toEqual(original.position); expect(controls.target.toArray()).toEqual(original.target);
  });
  it('retains deliberate camera movement by converting its current displayed pose back to source', () => {
    const { card, camera, controls } = fixture(); card._syncFloorPresentation(); camera.position.x += 2; controls.target.x += 2;
    const displayed = camera.position.toArray(); card._layout.floor_presentation = { mode: 'assembled' }; card._syncFloorPresentation();
    expect(camera.position.x).toBe(displayed[0] - 10); expect(camera.position.y).toBe(displayed[1] + 3);
  });
  it('does not accumulate offsets across flat/layer/assembled changes', () => {
    const { card, camera } = fixture(), original = camera.position.toArray(); card._syncFloorPresentation();
    card._layout.floor_presentation = settings({ mode: 'vertical' }); card._syncFloorPresentation();
    expect(camera.position.toArray()).toEqual([original[0], original[1] + 2, original[2]]);
    card._layout.floor_presentation = { mode: 'assembled' }; card._syncFloorPresentation(); expect(camera.position.toArray()).toEqual(original);
  });
  it('fits a separated overview rather than applying one floor offset to every camera', () => {
    const { card, view } = fixture(); card._viewId = 'all'; card._syncFloorPresentation();
    expect(view.fit).toHaveBeenCalledWith({ instant: true });
  });
  it('does not restore an old single-floor camera after changing to overview and moving it', () => {
    const { card, view, camera, controls } = fixture(); card._syncFloorPresentation();
    card._viewId = 'all'; camera.position.set(99, 8, 50); controls.target.set(40, 0, 20);
    view.restoreCameraFrame.mockClear(); view.fit.mockClear();
    card._layout.floor_presentation = settings({ mode: 'vertical' }); card._syncFloorPresentation();
    expect(view.restoreCameraFrame).not.toHaveBeenCalled(); expect(view.fit).toHaveBeenCalledTimes(1);
    card._layout.floor_presentation = { mode: 'assembled' }; card._syncFloorPresentation();
    expect(view.restoreCameraFrame).not.toHaveBeenCalled(); expect(view.fit).toHaveBeenCalledTimes(2);
  });
  it('does not restore a different account’s earlier camera', () => {
    const { card, view } = fixture(); card._syncFloorPresentation(); view.restoreCameraFrame.mockClear();
    card._hass = { ...card._hass, user: { id: 'other', is_admin: true } }; card._editing = true; card._syncFloorPresentation();
    expect(view.restoreCameraFrame).not.toHaveBeenCalled();
  });
  it('keeps source coordinates for tracking while only display copies move', () => {
    const { card } = fixture(); card._syncFloorPresentation();
    const source = { x: 1, y: 2, z: .15, elevation: 3, floorId: 'upper' };
    expect(card._displayFeaturePosition(source)).toEqual({ ...source, x: 11, elevation: 0 });
    expect(source).toEqual({ x: 1, y: 2, z: .15, elevation: 3, floorId: 'upper' });
  });
  it('uses exact geometry ownership for active floor identification, never object height', () => {
    const { card, view, upper } = fixture(); card._syncFloorPresentation(); view.floorForModelNode = vi.fn(() => 'upper');
    expect(card._sourceObjectFloor({ obj: { node: upper, level: 'u' } }, { y: 0 })).toBe('upper');
    view.floorForModelNode.mockReturnValue(null); expect(card._sourceObjectFloor({ obj: { node: upper, level: 'u' } }, { y: 3 })).toBeNull();
  });
  it.each(['assembled', 'horizontal'])('honours the measured mower floor in %s instead of its authored parent', (mode) => {
    const { card, view, ground } = fixture(); card._layout.floor_presentation = settings({ mode }); card._syncFloorPresentation();
    card._levels = { levelFloor: { g: 'ground' } }; view.floorForModelNode = vi.fn(() => 'ground');
    const mower = { obj: { node: ground, level: 'g' }, part: { displayFloorId: 'upper' } };
    expect(card._sourceObjectFloor(mower, { y: 3 })).toBe('upper');
  });
  it.each([null, undefined, '', 'missing'])('refuses a present invalid measured floor %j instead of guessing its authored floor', (floor) => {
    const { card, view, ground } = fixture(); card._syncFloorPresentation(); view.floorForModelNode = vi.fn(() => 'ground');
    expect(card._sourceObjectFloor({ obj: { node: ground, level: 'g' }, part: { displayFloorId: floor } }, { y: 3 })).toBeNull();
  });
  it('refuses duplicate measured floor IDs', () => {
    const { card, view, ground } = fixture(); card._syncFloorPresentation(); card._floors.push({ id: 'upper', elevation: 8 });
    view.floorForModelNode = vi.fn(() => 'ground');
    expect(card._sourceObjectFloor({ obj: { node: ground, level: 'g' }, part: { displayFloorId: 'upper' } }, { y: 3 })).toBeNull();
  });
  it('maps the mini-map camera to its selected SOURCE floor, retaining its real direction', () => {
    const { card } = fixture(); card._syncFloorPresentation();
    const snapshot = { mode: '3d', camera: { position: [11, 5, -2], target: [11, 0, -2] }, topCamera: { center: [11, 2], zoom: 1.3 } };
    const mapped = card._miniMapSourceCamera(snapshot, 'upper');
    expect(mapped.camera.position).toEqual([1, 8, -2]); expect(mapped.camera.target).toEqual([1, 3, -2]);
    expect(mapped.topCamera).toEqual({ center: [1, 2], zoom: 1.3 }); expect(snapshot.camera.position[0]).toBe(11);
  });
});
