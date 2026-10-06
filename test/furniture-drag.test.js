// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FloorplanView as View } from '../src/view.js';
import { FurnitureEditor } from '../src/furniture-editor.js';
import { FurnitureDrag } from '../src/furniture-drag.js';

const PACK = 'a'.repeat(64), HASH = 'b'.repeat(64), owners = [];
const saved = () => ({ version: 1, instances: [{ id: 'chair', pack_id: PACK, item_id: 'seat', asset_sha256: HASH,
  floor_id: 'upper', x: 2, y: -3.25, z: 0.5, rotation_degrees: 30, scale: 0.75, retained: { credit: 'Author' } }] });
const catalogue = { version: 1, packs: [{ pack_id: PACK, items: [{ id: 'seat', pack_id: PACK, sha256: HASH, unit: 'm', anchor: [0, 0, 0] }] }] };
function event(type = 'pointerdown', { x = 104, y = 100, id = 1, ...extra } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { clientX: x, clientY: y, pointerId: id, button: 0, isPrimary: true, ...extra });
  return e;
}
function setup({ split = true, select } = {}) {
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  const offset = split ? new THREE.Vector3(7, -4, -3) : new THREE.Vector3(), camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  const source = new THREE.Vector3(2, 4.5, 3.25), display = source.clone().add(offset);
  camera.position.copy(display).add(new THREE.Vector3(0, 10, 0)); camera.up.set(0, 0, -1); camera.lookAt(display); camera.updateMatrixWorld(true);
  const view = { camera, renderer: { domElement: canvas }, controls: { enabled: true }, model: { root: new THREE.Group() },
    mode: 'top', visibleFloor: 'upper', floorPresentationActive: split, raycaster: new THREE.Raycaster(),
    floorElevation: () => 4, _screenRay: View.prototype._screenRay, planPoint: View.prototype.planPoint, displayPlanPoint: View.prototype.displayPlanPoint,
    sourceWorldToDisplay: (p) => ({ ok: true, point: new THREE.Vector3(...p).add(offset).toArray() }),
    displayWorldToSource: (p) => ({ ok: true, point: new THREE.Vector3(...p).sub(offset).toArray() }) };
  const card = { ownerDocument: document, isConnected: true, _loading: false, _editing: true, _edit: { tab: 'furniture' },
    _config: { layout_key: 'house' }, _layout: { furniture: saved(), model: { url: '/house.glb' } }, _view: view,
    _floors: [{ id: 'upper', elevation: 4 }], _hass: { user: { id: 'taylor', is_admin: true, is_active: true }, auth: {}, connection: { connected: true },
      callService: vi.fn(), callWS: vi.fn() }, furnitureCatalogue: () => ({ status: 'ready', catalogue }), furniturePreviewDraft: vi.fn(), commitFeatureLayout: vi.fn() };
  const editor = new FurnitureEditor(card); editor.render(); const move = vi.spyOn(editor, 'moveDraftInstance');
  // Genuine Three raycasting of a visible fixture mesh. The existing layer's
  // GLB/parser/occlusion proofs remain in furniture-rendering.test.js.
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial(), chair = new THREE.Mesh(geometry, material);
  chair.position.copy(display); chair.updateMatrixWorld(true); const ray = new THREE.Raycaster();
  const layer = { shown: true, ready: true, hitTest: vi.fn((x, y) => {
    ray.setFromCamera(new THREE.Vector2(x / 100 - 1, -(y / 100 - 1)), camera);
    return layer.shown && ray.intersectObject(chair).length ? { id: 'chair', floorId: 'upper' } : null;
  }), report: () => ({ rows: [{ id: 'chair', floorId: 'upper', ready: layer.ready, shown: layer.shown }] }) };
  let currentLayer = layer;
  const onSelect = vi.fn(select || (() => {})), drag = new FurnitureDrag(card, { editor, getLayer: () => currentLayer, onSelect });
  owners.push({ drag, editor, geometry, material });
  return { card, editor, drag, layer, view, canvas, onSelect, move, setLayer: (next) => { currentLayer = next; } };
}
afterEach(() => { for (const { drag, editor, geometry, material } of owners.splice(0)) { drag.dispose(); editor.dispose(); geometry.dispose(); material.dispose(); }
  document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('native furniture draft movement', () => {
  it.each([false, true])('uses actual plan projection with split=%s, keeps pointer offset/Z/extensions and never saves', (split) => {
    const h = setup({ split }), before = structuredClone(h.card._layout), down = event();
    const handle = h.editor.draftPlacementHandles()[0]; expect(h.drag.down(down)).toBe(true); expect(down.defaultPrevented).toBe(true);
    expect(h.onSelect).toHaveBeenCalledExactlyOnceWith('chair'); expect(h.view.controls.enabled).toBe(false);
    window.dispatchEvent(event('pointermove', { x: 124, y: 120 }));
    const row = h.editor.draft.instances[0]; expect(row.x).toBeCloseTo(3, 12); expect(row.y).toBeCloseTo(-4.25, 12);
    expect(row).toMatchObject({ z: 0.5, rotation_degrees: 30, scale: 0.75, retained: { credit: 'Author' } });
    expect(h.move).toHaveBeenLastCalledWith('chair', { x: row.x, y: row.y, z: 0.5 }, handle.token);
    expect(h.card._layout).toEqual(before); expect(h.card.commitFeatureLayout).not.toHaveBeenCalled();
    const up = event('pointerup', { x: 124, y: 120 }); window.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true); expect(h.drag.active).toBe(false); expect(h.view.controls.enabled).toBe(true);
    expect(h.card._hass.callService).not.toHaveBeenCalled(); expect(h.card._hass.callWS).not.toHaveBeenCalled();
  });
  it('selects a genuine tap but waits for strictly more than five pixels before changing the draft', () => {
    const h = setup(); expect(h.drag.down(event())).toBe(true);
    window.dispatchEvent(event('pointermove', { x: 109 })); expect(h.move).not.toHaveBeenCalled(); expect(h.drag.moved).toBe(false);
    window.dispatchEvent(event('pointerup', { x: 109 })); expect(h.move).not.toHaveBeenCalled(); expect(h.editor.dirty).toBe(false);
    const click = event('click', { x: 109, detail: 1 }); expect(h.drag.consumeClick(click)).toBe(true);
    expect(h.drag.consumeClick(event('click', { x: 109, detail: 1 }))).toBe(false);
  });
  it('uses the final genuine pointerup coordinates even when no final move event arrived', () => {
    const h = setup(); h.drag.down(event()); window.dispatchEvent(event('pointerup', { x: 124 }));
    expect(h.editor.draft.instances[0].x).toBeCloseTo(3, 12); expect(h.drag.active).toBe(false); expect(h.view.controls.enabled).toBe(true);
  });
  it('ignores another pointer without cancelling, moving or consuming it', () => {
    const h = setup(); h.drag.down(event()); const other = event('pointermove', { x: 130, id: 2 }); window.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false); expect(h.move).not.toHaveBeenCalled(); expect(h.drag.active).toBe(true);
    window.dispatchEvent(event('pointerup', { id: 2 })); expect(h.drag.active).toBe(true); expect(h.drag.down(event('pointerdown', { id: 2 }))).toBe(false);
    window.dispatchEvent(event('pointercancel')); expect(h.drag.active).toBe(false); expect(h.view.controls.enabled).toBe(true);
  });
  it.each(['miss', 'hidden', 'not ready', 'missing handle', 'wrong floor', 'bad plane'])('does not consume a %s and never starts an invented drag', (kind) => {
    const h = setup();
    if (kind === 'miss') h.layer.hitTest.mockReturnValue(null);
    if (kind === 'hidden') h.layer.shown = false;
    if (kind === 'not ready') h.layer.ready = false;
    if (kind === 'missing handle') h.editor.draftPlacementHandles = () => [];
    if (kind === 'wrong floor') h.layer.hitTest.mockReturnValue({ id: 'chair', floorId: 'ground' });
    if (kind === 'bad plane') h.view.displayPlanPoint = () => [NaN, 0];
    const down = event(); expect(h.drag.down(down)).toBe(false); expect(down.defaultPrevented).toBe(false);
    expect(h.onSelect).not.toHaveBeenCalled(); expect(h.view.controls.enabled).toBe(true); expect(h.move).not.toHaveBeenCalled();
  });
  it.each([{ button: 2 }, { isPrimary: false }, { id: -1 }, { id: '1' }, { x: Infinity }, { y: NaN }])('rejects malformed or non-primary pointer %j', (data) => {
    const h = setup(), down = event('pointerdown', data); expect(h.drag.down(down)).toBe(false); expect(h.layer.hitTest).not.toHaveBeenCalled();
  });
  it('allows the callback to select and replace a handle before capturing the current token', () => {
    const h = setup(); h.drag.onSelect = () => { h.editor.reset(); h.editor.render(); };
    const prior = h.editor.draftPlacementHandles()[0].token; h.drag.down(event()); window.dispatchEvent(event('pointermove', { x: 124 }));
    expect(h.move.mock.calls[0][2]).not.toBe(prior); expect(h.editor.draft.instances[0].x).toBeCloseTo(3, 12);
  });
  it('fails closed if selection changes the current user instead of moving under an old context', () => {
    const h = setup(); h.drag.onSelect = () => { h.card._hass.user.is_admin = false; };
    const down = event(); expect(h.drag.down(down)).toBe(false); expect(h.drag.active).toBe(false); expect(h.view.controls.enabled).toBe(true);
  });
  it('never uses an assembled fallback after an authoritative split adapter fails', () => {
    const h = setup(), fallback = vi.spyOn(h.view, 'planPoint'); h.view.displayPlanPoint = () => null;
    expect(h.drag.down(event())).toBe(false); expect(fallback).not.toHaveBeenCalled();
  });
  it('supports a drawn assembled plan fallback at the exact current floor elevation', () => {
    const h = setup({ split: false }); delete h.view.displayPlanPoint; h.view.model = null; const plan = vi.spyOn(h.view, 'planPoint');
    expect(h.drag.down(event())).toBe(true); window.dispatchEvent(event('pointermove', { x: 124 }));
    expect(plan).toHaveBeenLastCalledWith(124, 100, 4); expect(h.editor.draft.instances[0].x).toBeCloseTo(3, 12);
  });
  it('does not use a legacy plane fallback for a GLB or active split presentation', () => {
    const h = setup(); delete h.view.displayPlanPoint; expect(h.drag.down(event())).toBe(false);
    h.view.model = null; expect(h.drag.down(event())).toBe(false);
  });
});

describe('captured source/session/gesture ownership', () => {
  const changes = [
    ['loading', (h) => { h.card._loading = true; }], ['missing layout', (h) => { h.card._layout = null; }],
    ['layout key', (h) => { h.card._config.layout_key = 'another'; }], ['layout replacement', (h) => { h.card._layout = structuredClone(h.card._layout); }],
    ['source model', (h) => { h.card._layout.model.url = '/replacement.glb'; }], ['model root', (h) => { h.view.model.root = new THREE.Group(); }],
    ['view replacement', (h) => { h.card._view = { ...h.view }; }], ['layer replacement', (h) => { h.setLayer({ ...h.layer }); }],
    ['selected floor', (h) => { h.view.visibleFloor = 'ground'; }], ['floor elevation', (h) => { h.card._floors[0].elevation = 5; }],
    ['visible floor set', (h) => { h.view._visibleSet = new Set(['upper', 'ground']); }],
    ['floor display revision', (h) => { h.view.floorPresentationRevision = 2; }],
    ['Section plane', (h) => { h.view.sectionClip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 2); }],
    ['active camera', (h) => { h.view.camera = h.view.camera.clone(); }],
    ['floor stale', (h) => { h.card._floors[0].stale = true; }], ['hidden item', (h) => { h.layer.shown = false; }],
    ['admin revoked', (h) => { h.card._hass.user.is_admin = false; }], ['inactive account', (h) => { h.card._hass.user.is_active = false; }],
    ['new account', (h) => { h.card._hass.user = { ...h.card._hass.user }; }], ['connection lost', (h) => { h.card._hass.connection.connected = false; }],
    ['new connection', (h) => { h.card._hass.connection = { connected: true }; }], ['new auth session', (h) => { h.card._hass.auth = {}; }],
    ['tab left', (h) => { h.card._edit.tab = 'model'; }], ['card detached', (h) => { h.card.isConnected = false; }],
    ['history reset', (h) => { h.editor.reset(); h.editor.render(); }], ['foreign coordinate edit', (h) => { h.editor.draft.instances[0].x = 8; }],
  ];
  it.each(changes)('cancels an observed %s before any more draft moves and consumes its later release', (label, change) => {
    const h = setup(); h.drag.down(event()); change(h); expect(h.drag.update()).toBe(false); expect(h.drag.active).toBe(false);
    const up = event('pointerup', { x: 124 }); expect(h.drag.up(up)).toBe(true); expect(up.defaultPrevented).toBe(true);
    expect(h.drag.consumeClick(event('click', { x: 124, detail: 1 }))).toBe(true);
    expect(h.move).not.toHaveBeenCalled(); expect(h.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('loading and recovery cannot revive the old gesture; Cancel and a fresh native press can start a new one', () => {
    const h = setup(); h.drag.down(event()); h.card._loading = true; h.drag.update(); h.card._loading = false;
    window.dispatchEvent(event('pointermove', { x: 124 })); expect(h.move).not.toHaveBeenCalled(); expect(h.drag.update()).toBe(false);
    h.drag.up(event('pointerup')); h.editor.reset(); h.editor.render(); expect(h.drag.down(event())).toBe(true);
    window.dispatchEvent(event('pointermove', { x: 124 })); expect(h.editor.draft.instances[0].x).toBeCloseTo(3, 12);
  });
  it('keeps the exact opaque token current through continuous moves but cancels a genuine handle reset', () => {
    const h = setup(); h.drag.down(event()); window.dispatchEvent(event('pointermove', { x: 124 })); const token = h.move.mock.calls[0][2];
    window.dispatchEvent(event('pointermove', { x: 134 })); expect(h.move).toHaveBeenLastCalledWith('chair', expect.objectContaining({ z: 0.5 }), token);
    h.editor.reset(); h.editor.render(); expect(h.drag.update()).toBe(false); window.dispatchEvent(event('pointermove', { x: 144 })); expect(h.move).toHaveBeenCalledTimes(2);
  });
  it('does not cancel on unrelated HA readings and never adds a saved history step', () => {
    const h = setup(); h.drag.down(event()); h.card._hass = { ...h.card._hass, states: { 'sensor.temperature': { state: '19' } } };
    expect(h.drag.update()).toBe(true); window.dispatchEvent(event('pointermove', { x: 124 })); expect(h.move).toHaveBeenCalledTimes(1);
    expect(h.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('keeps its own new anchor current if the draft preview synchronously revalidates the drag', () => {
    const h = setup(); h.drag.down(event()); h.card.furniturePreviewDraft.mockImplementation(() => h.drag.update());
    window.dispatchEvent(event('pointermove', { x: 124 })); expect(h.drag.active).toBe(true); expect(h.drag.moved).toBe(true);
    window.dispatchEvent(event('pointermove', { x: 134 })); expect(h.editor.draft.instances[0].x).toBeCloseTo(3.5, 12);
    expect(h.move).toHaveBeenCalledTimes(2); expect(h.view.controls.enabled).toBe(false); expect(h.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each(['pointercancel', 'blur', 'Escape', 'dispose'])('releases controls and every listener on %s without saving', (kind) => {
    const h = setup(), add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener'),
      documentAdd = vi.spyOn(document, 'addEventListener'), documentRemove = vi.spyOn(document, 'removeEventListener'); h.drag.down(event());
    if (kind === 'dispose') h.drag.dispose(); else if (kind === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    else window.dispatchEvent(event(kind));
    expect(h.drag.active).toBe(false); expect(h.view.controls.enabled).toBe(true);
    for (const args of add.mock.calls) expect(remove.mock.calls.some((values) => values.every((value, index) => value === args[index]))).toBe(true);
    for (const args of documentAdd.mock.calls) expect(documentRemove.mock.calls.some((values) => values.every((value, index) => value === args[index]))).toBe(true);
    window.dispatchEvent(event('pointermove', { x: 124 })); expect(h.move).not.toHaveBeenCalled(); expect(h.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('cancels when the document is hidden and restores the original document getter', () => {
    const h = setup(); h.drag.down(event()); const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    try { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
      expect(h.drag.active).toBe(false); expect(h.view.controls.enabled).toBe(true); }
    finally { if (descriptor) Object.defineProperty(document, 'hidden', descriptor); else delete document.hidden; }
  });
  it('does not overwrite foreign control changes or a replacement controls object on release', () => {
    const h = setup(); let enabled = false; const write = vi.fn((value) => { enabled = value; });
    Object.defineProperty(h.view.controls, 'enabled', { configurable: true, get: () => enabled, set: write });
    expect(h.drag.down(event())).toBe(true); h.drag.cancel(); expect(h.view.controls.enabled).toBe(false); expect(write).not.toHaveBeenCalled();
    h.view.controls.enabled = true; h.drag.down(event()); h.view.controls.enabled = true; const writes = write.mock.calls.length;
    expect(h.drag.update()).toBe(false); expect(h.view.controls.enabled).toBe(true); expect(write).toHaveBeenCalledTimes(writes);
    h.drag.down(event()); const current = { enabled: false }; h.view.controls = current; h.drag.update(); expect(current.enabled).toBe(false);
  });
  it('never consumes a keyboard click, another pointer, or a fresh empty-canvas gesture', () => {
    const h = setup(); h.drag.down(event()); h.drag.up(event('pointerup'));
    expect(h.drag.consumeClick(event('click', { detail: 0 }))).toBe(false);
    expect(h.drag.consumeClick(event('click', { id: 2, detail: 1 }))).toBe(false);
    h.layer.hitTest.mockReturnValue(null); expect(h.drag.down(event())).toBe(false);
    expect(h.drag.consumeClick(event('click', { detail: 1 }))).toBe(false);
  });
});
