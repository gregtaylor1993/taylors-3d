// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import '../src/taylors3d-card.js';

const instances = [];
const wall = (selector = 'node:House/Wall') => ({ id: 'wall-1', selector, face: { space: 'node-local', point: [0, 0, 0], normal: [0, 0, 1] } });
const policy = (extra = {}) => ({ enabled: true, mode: 'fade', walls: [wall()], ...extra });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function fixture() {
  const card = document.createElement('taylors3d-card'); instances.push(card);
  Object.defineProperty(card, 'isConnected', { configurable: true, value: true });
  card._config = { layout_key: 'home', model: '/house.glb', merge: true };
  card._layout = { rooms: [], floors: [{ id: 'ground', elevation: 0 }] };
  card._hass = { user: { id: 'taylor', is_admin: true }, connection: { connected: true }, states: {}, callService: vi.fn() };
  card._floors = card._layout.floors; card._mode = '3d'; card._editing = true;
  card._weatherInView = true; card._stage = document.createElement('div');
  const camera = new THREE.PerspectiveCamera(); camera.position.set(1.123456789, 3.987654321, 5.456789123);
  const target = new THREE.Vector3(.123456789, .234567891, -.345678912);
  const view = { camera, controls: { target, enabled: true }, mode: '3d', size: { w: 600, h: 500 },
    model: { id: '/house.glb', root: new THREE.Group(), manifest: { levels: [] } },
    mergeStats: { enabled: true, merged: 2, keep: [] },
    setModelRendering: vi.fn(), setWallPresentation: vi.fn(), stopCameraMotion: vi.fn(),
    setCamera: vi.fn((pose) => { camera.position.fromArray(pose.position); target.fromArray(pose.target); }),
    setDaylight: vi.fn(),
    wallPresentationCandidates: vi.fn(() => ({ prepared: view.model?.id.endsWith('#nomerge') || false, rows: [], diagnostics: [] })),
  };
  view.setModel = vi.fn(async (opts) => {
    view.model = opts ? { id: opts.url + (opts.merge === false ? '#nomerge' : ''), root: new THREE.Group(), manifest: { levels: [] } } : null;
    view.mergeStats = { enabled: opts?.merge !== false, merged: opts?.merge === false ? 0 : 2, keep: opts?.keep?.() || [] };
    return null;
  });
  card._view = view;
  card._edit = { tab: 'model', _wallPresentationEditor: { dirty: false, pendingSurfacePick: null },
    _modelRenderingEditor: { dirty: false }, onModelLoaded: vi.fn(), setSaveState: vi.fn(), updateHistoryState: vi.fn() };
  card._objects = { parts: new Map(), setModel: vi.fn() };
  card._popup = { close: vi.fn() }; card._devicePopup = { close: vi.fn() };
  card._schedule = vi.fn(); card._applySky = vi.fn(); card._showNotice = vi.fn();
  card._syncBindings = vi.fn(() => false); card._updateObjects = vi.fn(); card._refreshAttached = vi.fn();
  card._syncToolbar = vi.fn(); card._endGesture = vi.fn();
  card._store = { save: vi.fn(async () => true) };
  return { card, view };
}

afterEach(() => {
  for (const card of instances.splice(0)) {
    card._ambientController.dispose(); card._scenePreviewController.dispose(); card._presetEvents.disconnect();
  }
  vi.restoreAllMocks();
});

describe('root exact wall preparation and saved policy', () => {
  it('retains safe disabled/imported wall paths in the deduplicated merge keep set', () => {
    const { card } = fixture();
    card._layout.wall_presentation = policy({ enabled: false, mode: 'future-mode', walls: [wall(), wall('node:House/Wall\\*#1'), wall('room:living'), wall('node:House/**')] });
    card._layout.views = { all: { rules: [{ hide: 'node:House/Wall' }, { show: 'level:ground' }] } };
    card._config.wall_presentation = policy({ walls: [wall('node:Wrong/YAML')] });
    expect(card._mergeKeepSelectors()).toEqual(['node:House/Wall', 'level:ground', 'node:House/Wall\\*#1']);
  });

  it('uses card wall paths only when shared wall settings are absent', () => {
    const { card } = fixture(); card._config.wall_presentation = policy();
    expect(card._mergeKeepSelectors()).toContain('node:House/Wall');
    card._layout.wall_presentation = { walls: [] };
    expect(card._mergeKeepSelectors()).not.toContain('node:House/Wall');
  });

  it('permits one bounded reload for each genuinely new missing wall selector set', () => {
    const { card, view } = fixture(); card._index = { nodes: [] }; card._loadModel = vi.fn();
    card._layout.wall_presentation = policy();
    card._checkMergeKeep(); card._checkMergeKeep();
    expect(card._loadModel).toHaveBeenCalledExactlyOnceWith(true);
    card._layout.wall_presentation = policy({ walls: [wall('node:House/NewWall')] });
    card._checkMergeKeep(); card._checkMergeKeep(); expect(card._loadModel).toHaveBeenCalledTimes(2);
    view.mergeStats.keep = ['node:House/NewWall']; card._checkMergeKeep();
    expect(card._loadModel).toHaveBeenCalledTimes(2);
  });

  it('passes actual resolved floors and only actual live glow material writers', () => {
    const { card, view } = fixture(); card._editing = false;
    const glow = new THREE.Mesh(), furniture = new THREE.Mesh();
    card._objects.parts.set('lamp', { obj: { node: furniture }, part: { glow } });
    card._objects.parts.set('generic', { obj: { node: furniture }, part: { glow: null } });
    card._layout.wall_presentation = policy(); card._config.wall_presentation = { enabled: false };
    card._syncWallPresentation(); const [raw, context] = view.setWallPresentation.mock.lastCall;
    expect(raw).toBe(card._layout.wall_presentation); expect(context.floors).toBe(card._floors);
    expect(context.enabled).toBe(true); expect([...context.materialWriters]).toEqual([glow]);
  });

  it.each(['editing', 'top', 'offscreen', 'loading', 'disconnected', 'hidden'])('restores wall presentation while %s without an HA command', (condition) => {
    const { card, view } = fixture(); card._editing = false;
    if (condition === 'editing') card._editing = true;
    if (condition === 'top') card._mode = 'top';
    if (condition === 'offscreen') card._weatherInView = false;
    if (condition === 'loading') card._loading = true;
    if (condition === 'disconnected') Object.defineProperty(card, 'isConnected', { value: false });
    if (condition === 'hidden') vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    card._syncWallPresentation(); expect(view.setWallPresentation.mock.lastCall[1].enabled).toBe(false);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('allows Section composition and passes reduced motion independently', () => {
    const { card, view } = fixture(); card._editing = false; card._section = true;
    card._reducedMotion = { matches: true }; card._syncWallPresentation();
    expect(view.setWallPresentation.mock.lastCall[1]).toMatchObject({ enabled: true, reducedMotion: true });
  });

  it.each(['nonadmin', 'inactive', 'malformed-active', 'own-undefined-active', 'blank-user', 'unknown-user', 'connection', 'notediting', 'wrongtab', 'top', 'draft', 'shadingdraft', 'picking'])('rejects preparation with %s before reload or save', async (condition) => {
    const { card, view } = fixture();
    if (condition === 'nonadmin') card._hass.user.is_admin = false;
    if (condition === 'inactive') card._hass.user.is_active = false;
    if (condition === 'malformed-active') card._hass.user.is_active = 'true';
    if (condition === 'own-undefined-active') card._hass.user.is_active = undefined;
    if (condition === 'blank-user') card._hass.user.id = '   ';
    if (condition === 'unknown-user') delete card._hass.user.id;
    if (condition === 'connection') card._hass.connection.connected = false;
    if (condition === 'notediting') card._editing = false;
    if (condition === 'wrongtab') card._edit.tab = 'objects';
    if (condition === 'top') card._mode = 'top';
    if (condition === 'draft') card._edit._wallPresentationEditor.dirty = true;
    if (condition === 'shadingdraft') card._edit._modelRenderingEditor.dirty = true;
    if (condition === 'picking') card._edit._wallPresentationEditor.pendingSurfacePick = {};
    await expect(card.prepareWallSelection()).rejects.toThrow('administrator');
    expect(view.setModel).not.toHaveBeenCalled(); expect(card._store.save).not.toHaveBeenCalled();
  });

  it('does no reload when original pieces are already separate', async () => {
    const { card, view } = fixture(); view.model.id = '/house.glb#nomerge';
    expect(await card.prepareWallSelection()).toMatchObject({ prepared: true });
    expect(view.setModel).not.toHaveBeenCalled(); expect(card._wallPreparation).toBeUndefined();
    expect(card._store.save).not.toHaveBeenCalled();
  });

  it('loads original pieces without changing configuration, layout or full-precision camera', async () => {
    const { card, view } = fixture(); const config = card._config, layout = card._layout;
    const pose = { position: view.camera.position.toArray(), target: view.controls.target.toArray() };
    expect(await card.prepareWallSelection()).toMatchObject({ prepared: true });
    expect(view.setModel.mock.lastCall[0]).toMatchObject({ merge: false, reload: true, url: '/house.glb' });
    expect(card._config).toBe(config); expect(config.merge).toBe(true); expect(card._layout).toBe(layout);
    expect(view.setCamera).toHaveBeenCalledWith(pose); expect(card._store.save).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('does not restore an old camera over a later real interaction during preparation', async () => {
    const { card, view } = fixture(), gate = deferred();
    const ordinaryLoad = card._loadModel.bind(card);
    card._loadModel = vi.fn(async () => { await gate.promise; return ordinaryLoad(true); });
    const pending = card.prepareWallSelection(); card._wallInteractionSerial++; view.camera.position.x = 99;
    gate.resolve(); await pending; expect(view.setCamera).not.toHaveBeenCalled();
    expect(view.camera.position.x).toBe(99);
  });

  it.each(['source', 'user', 'connection', 'lifecycle'])('rejects late preparation across a changed %s context', async (condition) => {
    const { card } = fixture(), gate = deferred(); card._loadModel = vi.fn(() => gate.promise);
    const pending = card.prepareWallSelection();
    if (condition === 'source') card._config.model = '/replacement.glb';
    if (condition === 'user') card._hass.user.id = 'different-user';
    if (condition === 'connection') card._hass.connection = { connected: true };
    if (condition === 'lifecycle') card._wallLifecycleGeneration++;
    gate.resolve(null); await expect(pending).rejects.toThrow('changed during preparation');
    expect(card._wallPreparation).toBeNull(); expect(card._store.save).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'malformed-active', 'nonadmin', 'blank-user', 'disconnected'])('rejects late preparation after %s and retains merge cleanup', async (condition) => {
    const { card, view } = fixture(), gate = deferred();
    const ordinaryLoad = card._loadModel.bind(card);
    card._loadModel = vi.fn(async () => { await gate.promise; return ordinaryLoad(true); });
    const pending = card.prepareWallSelection();
    if (condition === 'inactive') card._hass.user.is_active = false;
    if (condition === 'malformed-active') card._hass.user.is_active = 'true';
    if (condition === 'nonadmin') card._hass.user.is_admin = false;
    if (condition === 'blank-user') card._hass.user.id = '   ';
    if (condition === 'disconnected') card._hass.connection.connected = false;
    gate.resolve(); await expect(pending).rejects.toThrow('changed during preparation');
    expect(card._wallPreparation).toBeNull();
    if (['inactive', 'malformed-active', 'blank-user', 'disconnected'].includes(condition)) {
      expect(card._wallRestoreMergePending).toBe(true);
      expect(view.setModel.mock.lastCall[0].merge).toBe(false);
    }
    expect(card._store.save).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each(['activity', 'administrator', 'connection', 'missing-id', 'blank-id', 'new-id'])('latches an observed %s loss even when it recovers before preparation finishes', async (condition) => {
    const { card, view } = fixture(), gate = deferred();
    card._loadModel = vi.fn(() => gate.promise);
    const pending = card.prepareWallSelection();
    const hass = card._hass;
    if (condition === 'activity') hass.user.is_active = false;
    if (condition === 'administrator') hass.user.is_admin = false;
    if (condition === 'connection') hass.connection.connected = false;
    if (condition === 'missing-id') delete hass.user.id;
    if (condition === 'blank-id') hass.user.id = '   ';
    if (condition === 'new-id') hass.user.id = 'someone-else';
    card.hass = hass;
    expect(card._wallPreparation).toBeNull();
    expect(card._wallRestoreMergePending).toBe(true);
    if (condition === 'activity') hass.user.is_active = true;
    if (condition === 'administrator') hass.user.is_admin = true;
    if (condition === 'connection') hass.connection.connected = true;
    if (['missing-id', 'blank-id', 'new-id'].includes(condition)) hass.user.id = 'taylor';
    card.hass = hass;
    gate.resolve(null); await expect(pending).rejects.toThrow('changed during preparation');
    expect(view.setCamera).not.toHaveBeenCalled(); expect(card._store.save).not.toHaveBeenCalled();
  });

  it('defers configured merge restoration until the same inactive user recovers', async () => {
    const { card, view } = fixture(); await card.prepareWallSelection(); view.setModel.mockClear();
    card._hass.user.is_active = false; card.hass = card._hass;
    expect(card._wallRestoreMergePending).toBe(true); expect(view.setModel).not.toHaveBeenCalled();
    card.hass = card._hass; expect(view.setModel).not.toHaveBeenCalled();
    card._hass.user.is_active = true; card.hass = card._hass;
    await Promise.resolve(); expect(view.setModel).toHaveBeenCalledTimes(1);
    expect(view.setModel.mock.lastCall[0].merge).toBe(true);
    expect(card._store.save).not.toHaveBeenCalled();
  });

  it('ends temporary preparation around newly saved wall references without another history entry', async () => {
    const { card, view } = fixture(); await card.prepareWallSelection();
    card._commit({ ...card._layout, wall_presentation: policy() }); await Promise.resolve(); await Promise.resolve();
    const opts = view.setModel.mock.lastCall[0];
    expect(opts.merge).toBe(true); expect(opts.keep()).toContain('node:House/Wall');
    expect(card._wallPreparation).toBeNull(); expect(card._store.save).toHaveBeenCalledTimes(1);
    expect(card._config.merge).toBe(true); expect(card._history.canUndo).toBe(true);
  });

  it('finishes preparation only once and does not write any layout on Cancel', async () => {
    const { card, view } = fixture(); await card.prepareWallSelection(); view.setModel.mockClear();
    expect(card.finishWallSelectionPreparation()).toBe(true);
    expect(card.finishWallSelectionPreparation()).toBe(false);
    await Promise.resolve(); expect(view.setModel).toHaveBeenCalledTimes(1);
    expect(view.setModel.mock.lastCall[0].merge).toBe(true); expect(card._store.save).not.toHaveBeenCalled();
  });

  it('keeps an explicit merge:false preference when preparation ends', async () => {
    const { card, view } = fixture(); card._config.merge = false;
    await card.prepareWallSelection(); card.finishWallSelectionPreparation(); await Promise.resolve();
    expect(view.setModel.mock.lastCall[0].merge).toBe(false); expect(card._config.merge).toBe(false);
  });

  it('keeps a pending wall tap out of ordinary object handling', () => {
    const { card } = fixture(); card._edit._wallSurfacePick = vi.fn(() => ({ token: {} }));
    card._objectHit = vi.fn(); const event = new Event('pointerdown');
    card._objectDown(event, document.createElement('canvas'));
    expect(card._objectHit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
