// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scene } from 'three';
import { StatusOverlays } from '../src/status-overlays.js';

const GET_LAYOUT = 'taylors3d/layout/get';
const SET_LAYOUT = 'taylors3d/layout/set';

function layoutFor(id) {
  return {
    version: 1,
    floors: [{ id: 'ground', name: 'Ground', elevation: 0 }],
    rooms: [{ id, floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
    pins: {}, hidden: [], mower: null,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function cardWith(key, callWS) {
  const card = document.createElement('taylors3d-card');
  card.setConfig({ type: 'custom:taylors3d-card', layout_key: key });
  // Keep the card disconnected: exercise real persistence without constructing WebGL.
  card._hass = { states: {}, callWS };
  return card;
}

describe('card configuration and layout persistence', () => {
  beforeAll(async () => {
    await import('../src/taylors3d-card.js');
  });

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps shared storage after a map setting changes and saves the next edit to HA', async () => {
    const callWS = vi.fn(async (message) => {
      if (message.type === GET_LAYOUT) return { layout: layoutFor('kitchen') };
      if (message.type === SET_LAYOUT) return {};
      throw new Error('Unexpected storage request: ' + message.type);
    });
    const card = cardWith('home', callWS);
    await card._load();
    const store = card._store;
    const loadedLayout = card._layout;
    const browserSave = vi.spyOn(Storage.prototype, 'setItem');

    card.setConfig({ ...card._config, mini_map_size: 240, mini_map_position: 'bottom-left' });

    expect(card._store).toBe(store);
    expect(card._store.backend).toBe('shared');
    expect(card._layout).toBe(loadedLayout);
    expect(callWS).toHaveBeenCalledTimes(1);

    const nextLayout = { ...card._layout, hidden: ['device:lamp'] };
    const saved = card._store.save(card._hass, nextLayout);
    await vi.advanceTimersByTimeAsync(600);

    await expect(saved).resolves.toBe(true);
    expect(callWS).toHaveBeenLastCalledWith({ type: SET_LAYOUT, key: 'home', layout: nextLayout });
    expect(browserSave).not.toHaveBeenCalled();
    expect(localStorage.getItem('taylors3d_home')).toBeNull();
  });

  it('preserves the selected Top view and a temporarily hidden map during unrelated edits', () => {
    const card = cardWith('home', vi.fn());
    card._mode = 'top';
    card._miniMapVisible = false;

    card.setConfig({
      ...card._config, height: '600px', mini_map_size: 220, mini_map_position: 'top-left',
      bubble_bar_controls: ['reset', 'mode', 'minimap'], device_tap_action: 'toggle',
    });

    expect(card._config.view).toBe('3d');
    expect(card._config.mini_map).toBe(true);
    expect(card._mode).toBe('top');
    expect(card._miniMapVisible).toBe(false);
  });

  it('still applies explicit changes to the configured view and map visibility', () => {
    const card = cardWith('home', vi.fn());
    card.setConfig({ ...card._config, view: 'top', mini_map: false });
    expect(card._mode).toBe('top');
    expect(card._miniMapVisible).toBe(false);

    card.setConfig({ ...card._config, view: '3d', mini_map: true });
    expect(card._mode).toBe('3d');
    expect(card._miniMapVisible).toBe(true);
  });

  it('clears the previous layout and loads the newly selected storage key', async () => {
    const next = deferred();
    const callWS = vi.fn((message) => {
      if (message.type !== GET_LAYOUT) throw new Error('Unexpected storage request');
      return message.key === 'home' ? Promise.resolve({ layout: layoutFor('old-room') }) : next.promise;
    });
    const card = cardWith('home', callWS);
    await card._load();
    const oldStore = card._store;
    const load = vi.spyOn(card, '_load');

    card.setConfig({ ...card._config, layout_key: 'holiday' });
    const nextLoad = load.mock.results[0].value;

    expect(load).toHaveBeenCalledTimes(1);
    expect(card._store).not.toBe(oldStore);
    expect(card._store.key).toBe('holiday');
    expect(card._layout).toBeNull();
    expect(card._loading).toBe(true);
    expect(callWS).toHaveBeenLastCalledWith({ type: GET_LAYOUT, key: 'holiday' });

    next.resolve({ layout: layoutFor('holiday-room') });
    await nextLoad;
    expect(card._layout.rooms.map((room) => room.id)).toEqual(['holiday-room']);
    expect(card._store.backend).toBe('shared');
    expect(card._loading).toBe(false);
  });

  it('ignores an old response while the new key is still loading', async () => {
    const old = deferred();
    const next = deferred();
    const callWS = vi.fn((message) => message.key === 'home' ? old.promise : next.promise);
    const card = cardWith('home', callWS);
    const oldLoad = card._load();
    const load = vi.spyOn(card, '_load');

    card.setConfig({ ...card._config, layout_key: 'holiday' });
    const nextLoad = load.mock.results[0].value;
    const currentStore = card._store;
    const ready = vi.fn();
    card._layoutReady.then(ready);

    old.resolve({ layout: layoutFor('old-room') });
    await oldLoad;
    expect(card._store).toBe(currentStore);
    expect(card._layout).toBeNull();
    expect(card._loading).toBe(true);
    expect(ready).not.toHaveBeenCalled();

    next.resolve({ layout: layoutFor('holiday-room') });
    await nextLoad;
    expect(card._layout.rooms.map((room) => room.id)).toEqual(['holiday-room']);
    expect(card._loading).toBe(false);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(callWS.mock.calls.map(([message]) => message.key)).toEqual(['home', 'holiday']);
  });

  it('does not overwrite the new layout when an old request finishes last', async () => {
    const old = deferred();
    const next = deferred();
    const callWS = vi.fn((message) => message.key === 'home' ? old.promise : next.promise);
    const card = cardWith('home', callWS);
    const oldLoad = card._load();
    const load = vi.spyOn(card, '_load');

    card.setConfig({ ...card._config, layout_key: 'holiday' });
    const nextLoad = load.mock.results[0].value;
    next.resolve({ layout: layoutFor('holiday-room') });
    await nextLoad;
    const currentLayout = card._layout;
    const currentStore = card._store;

    old.resolve({ layout: layoutFor('old-room') });
    await oldLoad;

    expect(card._layout).toBe(currentLayout);
    expect(card._layout.rooms.map((room) => room.id)).toEqual(['holiday-room']);
    expect(card._store).toBe(currentStore);
    expect(card._store.backend).toBe('shared');
    expect(card._loading).toBe(false);
  });

  it('undoes a grouped layout edit, saves the restored layout and leaves live HA states alone', async () => {
    const callWS = vi.fn(async (message) => message.type === GET_LAYOUT ? { layout: layoutFor('office') } : {});
    const card = cardWith('home', callWS);
    await card._load();
    const liveStates = { 'light.desk': { state: 'on' } };
    card._hass.states = liveStates;
    card.beginHistory('Move device');
    card._commit({ ...card._layout, pins: { lamp: { x: 1, y: 1 } } });
    card._commit({ ...card._layout, pins: { lamp: { x: 3, y: 1 } } });
    card.endHistory();
    expect(card._history.size).toBe(1);
    card.undoEdit();
    expect(card._layout.pins).toEqual({});
    expect(card._hass.states).toBe(liveStates);
    await vi.advanceTimersByTimeAsync(600);
    expect(callWS).toHaveBeenLastCalledWith({ type: SET_LAYOUT, key: 'home', layout: card._layout });
    card.redoEdit();
    expect(card._layout.pins.lamp.x).toBe(3);
    card.undoEdit();
    card._commit({ ...card._layout, hidden: ['lamp'] });
    expect(card._history.canRedo).toBe(false);
  });

  it('keeps undo confined to the current layout after switching names', async () => {
    const callWS = vi.fn(async (message) => ({ layout: layoutFor(message.key) }));
    const card = cardWith('home', callWS);
    await card._load();
    card._commit({ ...card._layout, hidden: ['lamp'] });
    expect(card._history.canUndo).toBe(true);
    card.setConfig({ ...card._config, layout_key: 'holiday' });
    await Promise.resolve();
    await Promise.resolve();
    card.undoEdit();
    expect(card._layout.rooms[0].id).toBe('holiday');
    expect(card._history.canUndo).toBe(false);
    expect(card._store.key).toBe('holiday');
  });

  it('leaves the house renderer idle on unrelated HA updates when overlays are off', () => {
    const card = cardWith('home', vi.fn());
    card._layout = layoutFor('office');
    card._floors = card._layout.floors;
    card._roomList = [];
    card._markers = [];
    card._editing = false;
    card._view = { dirty: false, floorElevation: () => 0 };
    card._statusLegend = document.createElement('div');
    card._statusOverlays = new StatusOverlays(new Scene(), {
      onInvalidate: () => { card._view.dirty = true; },
    });
    try {
      card._syncStatus();
      expect(card._view.dirty).toBe(false);
      for (let i = 0; i < 10; i++) {
        card._hass = { ...card._hass, states: { 'sensor.unrelated': { state: String(i) } } };
        card._syncStatus();
      }
      expect(card._view.dirty).toBe(false);
      expect(card._statusOverlays.rooms.size).toBe(0);
      expect(card._statusOverlays.alerts.size).toBe(0);
    } finally { card._statusOverlays.dispose(); }
  });
});
