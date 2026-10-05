// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AmbientIdleEditor } from '../src/ambient-idle-editor.js';

describe('idle mode in the actual card', () => {
  let now, cards;
  beforeAll(async () => { await import('../src/taylors3d-card.js'); });
  beforeEach(() => { now = 0; cards = []; vi.spyOn(performance, 'now').mockImplementation(() => now); });
  afterEach(() => {
    for (const card of cards) {
      card._endGesture(); card._unbindAmbientInput(); card._unwatchAmbientPreference();
      card._ambientController.dispose(now);
    }
    vi.restoreAllMocks();
  });

  function fixture(policy = { enabled: true, idle_seconds: 1 }) {
    const card = document.createElement('taylors3d-card'); cards.push(card);
    card.setConfig({});
    Object.defineProperty(card, 'isConnected', { configurable: true, value: true });
    card._layout = { rooms: [], floors: [], ambient_idle: policy };
    card._hass = { user: { id: 'current', is_admin: true }, connection: new EventTarget(),
      config: { time_zone: 'Europe/London' }, services: {}, callService: vi.fn(), states: {
        'sun.sun': { entity_id: 'sun.sun', state: 'below_horizon', attributes: { elevation: -10, azimuth: 180 } },
      } };
    card._hass.connection.connected = true;
    card._scene = document.createElement('div'); card._body = document.createElement('div');
    card._stage = document.createElement('div'); const canvas = document.createElement('canvas');
    card._body.append(card._stage); card._stage.append(card._scene); card._scene.append(canvas);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(3.123456789, 2.456789123, 5.345678912);
    const target = new THREE.Vector3(.123456789, .456789123, -.345678912);
    camera.lookAt(target);
    let saved = null;
    const view = { camera, mode: '3d', size: { w: 640, h: 520 }, controls: { enabled: true, target },
      model: { id: '/same.glb', root: new THREE.Group() }, dirty: false, setModelRendering: vi.fn(),
      labelRenderer: { domElement: document.createElement('div') },
      beginAmbientCamera: vi.fn((reading) => { saved = { reading, position: camera.position.clone() }; return true; }),
      advanceAmbientCamera: vi.fn((reading) => { camera.position.x += reading.deltaSeconds; return true; }),
      endAmbientCamera: vi.fn((reading) => {
        if (!saved || reading.token !== saved.reading.token) return false;
        const changed = reading.restore && !camera.position.equals(saved.position);
        if (reading.restore) camera.position.copy(saved.position);
        saved = null; return changed;
      }),
      getCamera: vi.fn(() => ({ position: camera.position.toArray(), target: target.toArray() })),
      getTopCamera: vi.fn(() => null), stop: vi.fn(), setModel: vi.fn(() => new Promise(() => {})),
    };
    card._view = view;
    card._popup = { isOpen: false, closedBy: null, close: vi.fn() };
    card._devicePopup = { isOpen: false, closedBy: null, close: vi.fn() };
    card._schedule = vi.fn(); card._presetEvents.setHass = vi.fn();
    card._applySky = vi.fn(); // Existing sky rendering is tested separately; this fixture owns the idle camera seam.
    card._bindAmbientInput(); card._syncAmbient();
    const baseline = camera.position.toArray();
    const tick = (time) => { now = time; return card._ambientController.tick(time); };
    const start = () => { tick(1000); tick(1033); return card._ambientController.active; };
    return { card, view, canvas, baseline, tick, start };
  }

  function input(target, type, values = {}) {
    const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
    Object.assign(event, { pointerId: 7, isPrimary: true, button: 0, clientX: 20, clientY: 20, ...values });
    target.dispatchEvent(event); return event;
  }

  it('defaults remain disabled with no camera, style or HA writes', () => {
    const f = fixture(undefined); delete f.card._layout.ambient_idle;
    const style = vi.spyOn(f.card._scene.style, 'setProperty');
    f.tick(200000);
    expect(f.card._ambientController.active).toBeNull();
    expect(f.view.beginAmbientCamera).not.toHaveBeenCalled(); expect(style).not.toHaveBeenCalled();
    expect(f.view.dirty).toBe(false); expect(f.card._hass.callService).not.toHaveBeenCalled();
  });

  it('starts only at the saved deadline and advances the current owner', () => {
    const f = fixture(); f.tick(999); expect(f.view.beginAmbientCamera).not.toHaveBeenCalled();
    f.tick(1000); expect(f.view.beginAmbientCamera).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ speed: .5 }));
    expect(f.view.advanceAmbientCamera).not.toHaveBeenCalled();
    f.tick(1033); expect(f.view.advanceAmbientCamera).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ deltaSeconds: .033 }));
    expect(f.view.camera.position.toArray()).not.toEqual(f.baseline); expect(f.card._hass.callService).not.toHaveBeenCalled();
  });

  it('cloned unrelated HA readings retain deadline, generation and active owner', () => {
    const f = fixture(); now = 500;
    f.card.hass = { ...f.card._hass, states: { ...f.card._hass.states, 'sensor.unrelated': { state: '22' } } };
    expect(f.card._ambientController.state.deadline).toBe(1000);
    const active = f.start(), generation = f.card._ambientGeneration(); now = 1100;
    f.card.hass = { ...f.card._hass, states: { ...f.card._hass.states, 'sensor.unrelated': { state: '23' } } };
    expect(f.card._ambientController.active.token).toBe(active.token);
    expect(f.card._ambientGeneration()).toBe(generation); expect(f.view.endAmbientCamera).not.toHaveBeenCalled();
  });

  it.each(['pointerdown', 'pointermove', 'wheel', 'keydown', 'focusin'])('restores before captured %s reaches the scene', (type) => {
    const f = fixture(); f.start(); let observed;
    f.card._stage.addEventListener(type, () => { observed = f.view.camera.position.toArray(); }, true);
    now = 1100; const event = input(f.canvas, type, { code: 'Space', key: ' ' });
    expect(observed).toEqual(f.baseline); expect(f.card._ambientController.active).toBeNull();
    expect(f.card._ambientWakeEvents.has(event)).toBe(type === 'pointerdown');
    expect(f.card._hass.callService).not.toHaveBeenCalled();
  });

  it('the wake tap skips actual room/object handlers; a fresh tap can select a room', () => {
    const f = fixture(); f.start();
    vi.spyOn(f.card, '_objectTapsOn').mockReturnValue(true);
    const hit = vi.spyOn(f.card, '_objectHit').mockReturnValue(null), open = vi.spyOn(f.card, '_openRoomAt').mockImplementation(() => {});
    f.card._stage.addEventListener('pointerdown', (event) => f.card._objectDown(event, f.canvas), true);
    f.canvas.addEventListener('pointerdown', (event) => f.card._roomDown(event));
    now = 1100; const wake = input(f.canvas, 'pointerdown');
    expect(f.card._ambientWakeEvents.has(wake)).toBe(true); expect(hit).not.toHaveBeenCalled(); expect(f.card._gesture).toBeFalsy();
    f.card._onAmbientRelease({ type: 'pointerup', pointerId: 7 });
    now = 1200; input(f.canvas, 'pointerdown');
    expect(hit).toHaveBeenCalledOnce(); expect(f.card._gesture).toBeTruthy();
    input(window, 'pointerup'); expect(open).toHaveBeenCalledExactlyOnceWith(20, 20);
  });

  it.each(['pointer', 'keyboard', 'controls'])('a held %s gesture blocks idle and release rearms the full delay', (kind) => {
    const f = fixture(); now = 500;
    if (kind === 'controls') f.card._onAmbientCameraInteraction('start');
    else input(f.canvas, kind === 'pointer' ? 'pointerdown' : 'keydown', { code: 'Space', key: ' ' });
    f.tick(10000); expect(f.view.beginAmbientCamera).not.toHaveBeenCalled();
    if (kind === 'controls') f.card._onAmbientCameraInteraction('end');
    else f.card._onAmbientRelease(kind === 'pointer' ? { type: 'pointerup', pointerId: 7 } : { type: 'keyup', code: 'Space' });
    expect(f.card._ambientController.state.deadline).toBe(11000);
    f.tick(10999); expect(f.view.beginAmbientCamera).not.toHaveBeenCalled();
    f.tick(11000); expect(f.view.beginAmbientCamera).toHaveBeenCalledOnce();
  });

  it.each(['editing', 'offscreen', 'page hidden', 'loading', 'popup', 'room panel', 'scene preview', 'alerts', 'top', 'section',
    'flight', 'model motion', 'reduced motion', 'focus lost', 'disconnected'])('stops immediately for %s and requires a full delay on recovery', (kind) => {
    const f = fixture(); const active = f.start();
    const change = (value) => {
      switch (kind) {
        case 'editing': f.card._editing = value; break;
        case 'offscreen': f.card._weatherInView = !value; break;
        case 'page hidden': vi.spyOn(document, 'hidden', 'get').mockReturnValue(value); break;
        case 'loading': f.card._loading = value; break;
        case 'popup': f.card._popup.isOpen = value; break;
        case 'room panel': f.card._devicePopup.isOpen = value; break;
        case 'scene preview': f.card._lightPreview = value ? new Map() : null; break;
        case 'alerts': f.card._alertData = { stats: { active: value ? 1 : 0, unplaced: value ? 1 : 0 } }; break;
        case 'top': f.card._mode = f.view.mode = value ? 'top' : '3d'; break;
        case 'section': f.card._section = value; break;
        case 'flight': f.view._tween = value ? {} : null; break;
        case 'model motion': f.view._modelMotionMoving = value; break;
        case 'reduced motion': f.card._reducedMotion = { matches: value }; break;
        case 'focus lost': f.card._ambientWindowActive = !value; break;
        case 'disconnected': f.card._hass.connection.connected = !value; break;
      }
    };
    now = 1100; change(true); f.card._syncAmbient();
    expect(f.card._ambientController.active).toBeNull();
    expect(f.view.endAmbientCamera).toHaveBeenCalledWith(expect.objectContaining({ token: active.token }));
    // A new view generation must never restore its old baseline into that view.
    if (kind !== 'top') expect(f.view.camera.position.toArray()).toEqual(f.baseline);
    now = 1200; change(false); f.card._syncAmbient();
    f.tick(2199); expect(f.view.beginAmbientCamera).toHaveBeenCalledOnce();
    f.tick(2200); expect(f.view.beginAmbientCamera).toHaveBeenCalledTimes(2);
  });

  it('a new model discards the old camera baseline rather than restoring over it', () => {
    const f = fixture(); f.start();
    f.view.model = { root: new THREE.Group() }; f.view.camera.position.set(9, 8, 7);
    now = 1100; f.card._syncAmbient();
    expect(f.view.endAmbientCamera).toHaveBeenCalledWith(expect.objectContaining({ restore: false }));
    expect(f.view.camera.position.toArray()).toEqual([9, 8, 7]);
  });

  it('a changed HA connection restores before replacing the session identity', () => {
    const f = fixture(); f.start(); now = 1100;
    const connection = new EventTarget(); connection.connected = true;
    f.card.hass = { ...f.card._hass, connection };
    expect(f.view.camera.position.toArray()).toEqual(f.baseline);
    expect(f.view.endAmbientCamera).toHaveBeenCalledWith(expect.objectContaining({ restore: true }));
    expect(f.card._ambientController.active).toBeNull();
  });

  it('automation captures its return camera after restoring idle, without interrupting the request', () => {
    const f = fixture(); f.card._viewId = 'front'; f.card._syncAmbient(); f.start();
    const selection = f.card._presetEvents._selection, interrupt = vi.spyOn(f.card._presetEvents, 'interrupt');
    now = 1100; const captured = f.card._presetEvents._getCurrent();
    expect(captured.camera.position).toEqual(f.baseline); expect(captured.id).toBe('front');
    expect(f.view.getCamera).toHaveBeenCalledOnce(); expect(interrupt).not.toHaveBeenCalled();
    expect(f.card._presetEvents._selection).toBe(selection); expect(f.card._ambientController.active).toBeNull();
  });

  it('dim-only changes the scene CSS, preserves prior inline filter and never moves or dirties the renderer', () => {
    const f = fixture({ enabled: true, idle_seconds: 1, rotate: false, dim: { enabled: true, brightness: .65, when: 'sun' } });
    f.card._scene.style.setProperty('filter', 'contrast(1.1)', 'important');
    const style = vi.spyOn(f.card._scene.style, 'setProperty');
    f.tick(1000); expect(f.card._scene.style.filter).toBe('contrast(1.1) brightness(0.65)');
    expect(f.view.beginAmbientCamera).not.toHaveBeenCalled(); expect(f.view.advanceAmbientCamera).not.toHaveBeenCalled();
    expect(f.view.dirty).toBe(false); const writes = style.mock.calls.length;
    f.tick(1033); f.tick(1066); expect(style).toHaveBeenCalledTimes(writes);
    now = 1100; f.card._ambientActivity();
    expect(f.card._scene.style.filter).toBe('contrast(1.1)'); expect(f.card._scene.style.getPropertyPriority('filter')).toBe('important');
    expect(f.view.endAmbientCamera).not.toHaveBeenCalled(); expect(f.card._hass.callService).not.toHaveBeenCalled();
  });

  it('missing actual sun stays undimmed and manual night does not supply night evidence', () => {
    const f = fixture({ enabled: true, idle_seconds: 1, rotate: false, dim: { enabled: true, when: 'sun' } });
    delete f.card._hass.states['sun.sun']; f.card._daylight = false;
    f.tick(1000); expect(f.card._scene.style.filter).toBe('');
    expect(f.card._ambientController.state.diagnostics.some((item) => item.code === 'sun')).toBe(true);
    expect(f.view.dirty).toBe(false);
  });

  it('reduced-motion change uses one removable current media listener and restores synchronously', () => {
    const f = fixture(), media = new EventTarget(); media.matches = false;
    const add = vi.spyOn(media, 'addEventListener'), remove = vi.spyOn(media, 'removeEventListener');
    f.card._reducedMotion = media; f.card._watchAmbientPreference(); f.card._watchAmbientPreference();
    expect(add).toHaveBeenCalledOnce(); f.start(); now = 1100;
    media.matches = true; media.dispatchEvent(new Event('change'));
    expect(f.view.camera.position.toArray()).toEqual(f.baseline);
    f.card._unwatchAmbientPreference(); expect(remove).toHaveBeenCalledExactlyOnceWith('change', f.card._onAmbientPreference);
  });

  it('separates CSS changes from the combined existing animation draw request', () => {
    const f = fixture({ enabled: true, idle_seconds: 1, rotate: false, dim: { enabled: true, when: 'sun' } });
    const updates = ['_statusOverlays', '_trackingLayer', '_weatherLayer', '_securityLayer'].map((key) => {
      const update = vi.fn(() => false); f.card[key] = { update }; return update;
    });
    vi.spyOn(f.card, '_refreshSecurityMotion').mockReturnValue(false);
    now = 1000; expect(f.card._animateFeatures(1000)).toBe(false);
    expect(f.card._scene.style.filter).toBe('brightness(0.65)');
    updates.forEach((update) => expect(update).toHaveBeenCalledOnce());
  });

  it.each(['undo', 'redo'])('direct root %s clears an unsaved Idle draft before restoring saved policy', (direction) => {
    const f = fixture();
    Object.defineProperty(f.card, 'isConnected', { configurable: true, value: false }); f.card._view = null;
    f.card._store.save = vi.fn(async () => true);
    f.card.resetHistory();
    f.card._layout = { ...f.card._layout, ambient_idle: { enabled: true, idle_seconds: 30, retained: 'saved' } };
    f.card._recordHistory('Saved idle delay');
    if (direction === 'redo') f.card.undoEdit();
    const editor = new AmbientIdleEditor(f.card);
    f.card._edit = { _ambientIdleEditor: editor, setSaveState: vi.fn(), afterUpdate: vi.fn(), updateHistoryState: vi.fn() };
    const host = document.createElement('div'); host.innerHTML = editor.render();
    const field = host.querySelector('[data-field="ambient-idle-idle_seconds"]'); field.value = '60';
    editor.onInput('ambient-idle-idle_seconds', field); expect(editor.dirty).toBe(true);
    if (direction === 'undo') f.card.undoEdit(); else f.card.redoEdit();
    expect(editor.dirty).toBe(false); editor.render();
    expect(editor.draft.idle_seconds).toBe(direction === 'undo' ? 1 : 30);
    expect(f.card._hass.callService).not.toHaveBeenCalled();
  });

  it.each([['same source', false, '/same.glb', false], ['forced reload', true, '/same.glb', true],
    ['new source', false, '/new.glb', true]])('handles pending %s before a model can be replaced', (_name, reload, source, stopped) => {
    const f = fixture(); f.card._config.model = '/same.glb'; f.card._syncAmbient(); f.start();
    f.card._config.model = source;
    f.view.setModel.mockImplementation(() => {
      expect(f.card._ambientController.active === null).toBe(stopped);
      return new Promise(() => {});
    });
    f.card._loadModel(reload);
    expect(f.view.setModel).toHaveBeenCalledOnce();
    expect(f.card._hass.callService).not.toHaveBeenCalled();
  });

  it('disconnect restores, clears held gestures and removes the preference listener', () => {
    const f = fixture(); f.start(); now = 1100;
    const media = new EventTarget(), remove = vi.spyOn(media, 'removeEventListener');
    media.matches = false; f.card._reducedMotion = media; f.card._watchAmbientPreference();
    f.card._ambientPointers.add(99); f.card._ambientKeys.add('Space'); f.card._ambientControlsGesture = true;
    Object.defineProperty(f.card, 'isConnected', { configurable: true, value: false });
    f.card.disconnectedCallback();
    expect(f.view.camera.position.toArray()).toEqual(f.baseline); expect(f.view.stop).toHaveBeenCalledOnce();
    expect(f.card._ambientPointers.size).toBe(0); expect(f.card._ambientKeys.size).toBe(0);
    expect(f.card._ambientControlsGesture).toBe(false); expect(remove).toHaveBeenCalledOnce();
  });
});
