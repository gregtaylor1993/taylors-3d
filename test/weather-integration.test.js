// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Scene } from 'three';
import { normaliseWeatherFootprints } from '../src/weather.js';
import { transformPoint } from '../src/bindings.js';
import { clampSunDir, nightFactor, sunStrength, sunVector } from '../src/objects/logic.js';
import { moonPosition } from '../src/sky.js';

const epoch = Date.parse('2026-10-05T12:00:00Z');
const polygon = (x, y, size = 4) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
const state = (value, attributes = {}) => ({ state: value, attributes });
const setup = (quality = 'low') => ({ enabled: true, entity: 'weather.house', quality, intensity: .5, effects: ['rain', 'snow', 'clouds'] });
const cards = [];

function fixture(weather = setup()) {
  vi.useFakeTimers(); vi.setSystemTime(epoch);
  const card = document.createElement('taylors3d-card');
  card.connected = true;
  Object.defineProperty(card, 'isConnected', { get: () => card.connected });
  card._config = { layout_key: 'default', sky_bodies: true };
  card._layout = { weather };
  card._scene = document.createElement('div');
  card._floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 3 }];
  card._roomList = [
    { room: { id: 'house', floor_id: 'ground', polygon: polygon(0, 0) }, floorId: 'ground' },
    { room: { id: 'bedroom', floor_id: 'upper', polygon: polygon(0, 0) }, floorId: 'upper' },
    { room: { id: 'garden', floor_id: 'ground', polygon: polygon(7, 0), outdoor: true }, floorId: 'ground' },
  ];
  card._navigationRooms = () => card._roomList.filter((entry) => !card.hiddenRooms?.includes(entry.room.id));
  card._navigationFloors = () => card.visibleFloors || 'all';
  card._hass = { config: { latitude: 51.5, longitude: -.1, time_zone: 'Europe/London' }, states: {
    'weather.house': state('rainy'), 'sun.sun': state('above_horizon', { elevation: 30, azimuth: 180 }),
    'sensor.unrelated': state('1') }, entities: {}, devices: {}, callService: vi.fn() };
  card._view = { scene: new Scene(), model: { north: 0 }, dirty: false,
    floorElevation: (id) => card._floors.find((floor) => floor.id === id)?.elevation,
    setSky: vi.fn(), setSkyBodies: vi.fn(), start: vi.fn(), stop: vi.fn() };
  card._skyMode = 'auto';
  card._modelAlign = () => ({ position: [0, 0, 0], rotation: 0, scale: 1 });
  card._reducedMotion = { matches: false };
  cards.push(card);
  return card;
}

const footprints = (card) => {
  const data = card.weatherFootprints();
  return normaliseWeatherFootprints(data.outdoors, data.indoors, data.visibleFloors);
};

beforeAll(async () => { await import('../src/taylors3d-card.js'); });
afterEach(() => {
  for (const card of cards.splice(0)) {
    card._weatherObserver?.disconnect(); card._weatherLayer?.dispose();
    clearInterval(card._skyTimer); card._clearTrackingTimer();
    document.removeEventListener('visibilitychange', card._onTrackingVisibility);
    document.removeEventListener('visibilitychange', card._onWeatherVisibility);
    window.removeEventListener('taylors3d-panel-change', card._onPanelName);
    window.removeEventListener('storage', card._onPanelName);
  }
  delete window.__demoNow;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('weather placement follows the real card outlines', () => {
  it('uses known floor heights and retains hidden indoor rooms on every floor', () => {
    const card = fixture(); card.hiddenRooms = ['bedroom']; card.visibleFloors = ['ground'];
    const data = card.weatherFootprints();
    expect(data.indoors).toHaveLength(2);
    expect(data.indoors.find((room) => room.id === 'bedroom')).toMatchObject({ floorId: 'upper', elevation: 3, shown: false });
    expect(data.outdoors).toHaveLength(1); expect(data.visibleFloors).toEqual(['ground']);
    card._syncWeather();
    expect(card._weatherLayer.stats.rain).toBe(48);
    for (const sample of card._weatherLayer._samples.rain) {
      expect(sample.x).toBeGreaterThanOrEqual(7); expect(sample.x).toBeLessThanOrEqual(11);
      expect(sample.elevation).toBe(0);
    }
  });

  it('only renders outdoor areas in the selected floor and visible room set', () => {
    const card = fixture();
    card._roomList.push({ room: { id: 'terrace', polygon: polygon(7, 0), outdoor: true, floor_id: 'upper' }, floorId: 'upper' });
    card.visibleFloors = ['upper']; card._syncWeather();
    expect(card._weatherLayer._samples.rain.every((sample) => sample.elevation === 3)).toBe(true);
    card.hiddenRooms = ['terrace']; card._viewState = {}; card._syncWeather();
    expect(card._weatherLayer.stats.rain).toBe(0); expect(card._weatherLayer.group.visible).toBe(false);
    expect(card.weatherFootprints().indoors).toHaveLength(2);
  });

  it('never treats an indoor room or a name containing Garden as an outdoor tag', () => {
    const card = fixture(); card._roomList = [{ room: { id: 'Garden', label: 'Outside', polygon: polygon(7, 0), floor_id: 'ground' }, floorId: 'ground' }];
    expect(card.weatherFootprints().outdoors).toEqual([]); card._syncWeather();
    expect(card._weatherLayer.group.children).toHaveLength(0);
    expect(card.weatherDiagnostics().diagnostics.some((item) => item.code === 'no_outdoors')).toBe(true);
  });

  it('keeps a broken explicit floor link invalid instead of substituting the first floor', () => {
    const card = fixture(); card._roomList[0].room.floor_id = 'deleted';
    expect(footprints(card).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'indoor_footprint' })]));
    card._syncWeather(); expect(card._weatherLayer.group.visible).toBe(false);
    expect(card._weatherLayer.stats.rain).toBe(0);
  });

  it('refuses a duplicate or nonfinite known floor height', () => {
    const card = fixture(); card._floors.push({ id: 'ground', elevation: 2 });
    expect(footprints(card).diagnostics.some((item) => item.code === 'indoor_footprint')).toBe(true);
    card._floors.pop(); card._floors[0].elevation = NaN;
    expect(footprints(card).diagnostics.some((item) => item.code === 'indoor_footprint')).toBe(true);
  });

  it('supplements omitted hidden GLB indoor rooms using the actual model alignment', () => {
    const card = fixture(); const outline = polygon(0, 0);
    const alignment = { position: [15, 9, 2], rotation: 90, scale: 2 };
    card._modelAlign = () => alignment;
    card._mb = { manifest: { rooms: [{ id: 'hidden-model', kind: 'room', level: 'level', outline }] },
      levels: { level: { floor: 'upper', show: 'hidden' } } };
    const indoor = card.weatherFootprints().indoors.find((room) => room.id === 'm:hidden-model');
    expect(indoor).toMatchObject({ elevation: 3, floorId: 'upper', outdoor: false });
    expect(indoor.polygon).toEqual(outline.map((point) => transformPoint(point, alignment)));
    expect(footprints(card).diagnostics).toEqual([]);
  });

  it.each([
    { stale: true, floor: 'ground' }, { floor: 'deleted' }, {}, undefined,
  ])('does not discard an omitted indoor mask with an unresolved level (%j)', (assignment) => {
    const card = fixture();
    card._mb = { manifest: { rooms: [{ id: 'omitted', kind: 'room', level: 'broken', outline: polygon(7, 0) }] }, levels: { broken: assignment } };
    expect(card.weatherFootprints().indoors).toHaveLength(3);
    card._syncWeather();
    expect(card._weatherLayer.stats.rain).toBe(0);
    expect(card.weatherDiagnostics().diagnostics.some((item) => item.code === 'indoor_footprint')).toBe(true);
  });

  it('fails closed for a missing hidden indoor outline and skips hidden outdoor zones', () => {
    const card = fixture();
    card._mb = { manifest: { rooms: [{ id: 'broken', kind: 'room', level: 'level' },
      { id: 'outside', kind: 'zone', level: 'level' }] }, levels: { level: { floor: 'ground', show: 'hidden' } } };
    expect(card.weatherFootprints().indoors).toHaveLength(3); expect(card.weatherFootprints().outdoors).toHaveLength(1);
    card._syncWeather(); expect(card._weatherLayer.stats.rain).toBe(0);
  });

  it('does not transform or duplicate a GLB room already resolved in the card', () => {
    const card = fixture();
    card._roomList[0].room.modelId = 'existing';
    card._mb = { manifest: { rooms: [{ id: 'existing', kind: 'room', level: 'level', outline: polygon(100, 100) }] },
      levels: { level: { floor: 'ground' } } };
    card._modelAlign = () => ({ position: [99, 99, 0], rotation: 90, scale: 3 });
    expect(card.weatherFootprints().indoors).toHaveLength(2);
    expect(card.weatherFootprints().indoors[0].polygon).toEqual(polygon(0, 0));
  });
});

describe('weather lifecycle uses one existing scene and animation loop', () => {
  it('prefers saved layout settings and falls back to config only when absent', () => {
    const card = fixture({ enabled: false }); card._config.weather = setup(); card._syncWeather();
    expect(card._weatherReading.status).toBe('off'); expect(card._weatherLayer.group.children).toHaveLength(0);
    card._layout = {}; card._syncWeather(); expect(card._weatherReading.status).toBe('ready');
    expect(card._weatherLayer.stats.rain).toBe(48);
  });

  it.each(['off', 'static', 'unchanged'])('does not invalidate on unrelated HA updates in %s mode', (kind) => {
    const card = fixture(kind === 'off' ? { enabled: false } : setup(kind === 'static' ? 'static' : 'low'));
    card._syncWeather(); const layer = card._weatherLayer, rain = layer.rain;
    const rebuilds = layer.stats.rebuilds; card._view.dirty = false;
    for (let index = 0; index < 10; index++) {
      card._hass = { ...card._hass, states: { ...card._hass.states, 'sensor.unrelated': state(String(index)) } };
      card._syncWeather();
    }
    expect(card._view.dirty).toBe(false); expect(layer.stats.rebuilds).toBe(rebuilds); expect(layer.rain).toBe(rain);
    if (kind !== 'unchanged') expect(card._animateFeatures(500)).toBe(false);
    expect(card._view.scene.children.every((child) => !child.isLight)).toBe(true);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves particle phase and geometry on a deep-cloned equal selected reading', () => {
    const card = fixture(); card._syncWeather(); card._animateFeatures(0); card._animateFeatures(100);
    const geometry = card._weatherLayer.rain.geometry, phase = card._weatherLayer._samples.rain[0].phase;
    const rebuilds = card._weatherLayer.stats.rebuilds;
    card._view.dirty = false; card._hass.states['weather.house'] = structuredClone(card._hass.states['weather.house']); card._syncWeather();
    expect(card._weatherLayer.rain.geometry).toBe(geometry);
    expect(card._weatherLayer._samples.rain[0].phase).toBe(phase);
    expect(card._weatherLayer.stats.rebuilds).toBe(rebuilds); expect(card._view.dirty).toBe(false);
  });

  it('responds to current condition changes and source metadata without using forecasts or stale attributes', () => {
    const card = fixture(); card._syncWeather(); const geometry = card._weatherLayer.rain.geometry;
    card._hass.states['weather.house'] = state('sunny', { forecast: [{ condition: 'rainy' }] }); card._syncWeather();
    expect(card._weatherLayer.group.visible).toBe(false); expect(card._weatherLayer.stats.rain).toBe(0);
    card._hass.states['weather.house'] = state('snowy'); card._syncWeather(); expect(card._weatherLayer.stats.snow).toBe(24);
    card._hass.entities = { 'weather.house': { device_id: 'weather-device' } };
    card._hass.devices = { 'weather-device': { disabled_by: 'user' } }; card._syncWeather();
    expect(card._weatherReading.status).toBe('disabled'); expect(card._weatherLayer.group.visible).toBe(false);
    card._hass.devices = {}; card._hass.states['weather.house'] = state('rainy', { restored: true }); card._syncWeather();
    expect(card._weatherReading.status).toBe('unavailable'); expect(card._weatherLayer.group.visible).toBe(false);
    expect(card._weatherLayer.rain.geometry).toBe(geometry);
  });

  it('evaluates weather, tracking and alert animations independently', () => {
    const card = fixture(); card._syncWeather();
    card._statusOverlays = { update: vi.fn(() => true) }; card._trackingLayer = { update: vi.fn(() => true) };
    const update = vi.spyOn(card._weatherLayer, 'update');
    expect(card._animateFeatures(0)).toBe(true); expect(update).toHaveBeenCalledOnce();
    expect(card._trackingLayer.update).toHaveBeenCalledOnce();
    expect(card._animateFeatures(100)).toBe(true); expect(card._weatherLayer._samples.rain[0].phase).not.toBe(0);
  });

  it.each(['_editing', '_loading', '_section'])('suspends and resumes weather for %s without reallocating', (flag) => {
    const card = fixture(); card._syncWeather(); const geometry = card._weatherLayer.rain.geometry;
    card[flag] = true; card._syncWeather();
    expect(card._weatherLayer.group.visible).toBe(false); expect(card._animateFeatures(100)).toBe(false);
    card[flag] = false; card._syncWeather();
    expect(card._weatherLayer.group.visible).toBe(true); expect(card._weatherLayer.rain.geometry).toBe(geometry);
    expect(card._animateFeatures(1000)).toBe(false); expect(card._animateFeatures(1010)).toBe(true);
  });

  it('suspends an actual section clip even without a Section button and respects reduced motion', () => {
    const card = fixture(); card._syncWeather(); card._view.sectionClip = {}; card._syncWeather();
    expect(card._weatherLayer.group.visible).toBe(false);
    card._view.sectionClip = null; card._reducedMotion.matches = true; card._syncWeather();
    expect(card._weatherLayer.group.visible).toBe(true); expect(card._animateFeatures(0)).toBe(false); expect(card._animateFeatures(100)).toBe(false);
  });

  it('recomputes the normal visible outdoor set when leaving Section after a hidden source update', () => {
    const card = fixture();
    card._navigationRooms = () => card._roomList.filter((entry) => card._section || entry.room.id !== 'garden');
    card._syncWeather(); expect(card._weatherLayer.stats.rain).toBe(0);
    card._section = true; card._hass.states['weather.house'] = state('pouring'); card._syncWeather();
    expect(card._weatherLayer.stats.rain).toBe(48); expect(card._weatherLayer.group.visible).toBe(false);
    card._section = false; card._syncWeather();
    expect(card._weatherLayer.stats.rain).toBe(0); expect(card._weatherLayer.group.visible).toBe(false);
  });

  it('hides weather immediately on a document visibility event and resumes without a giant time step', () => {
    const card = fixture(); let hidden = false; vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    card._syncWeather(); card._animateFeatures(0); card._animateFeatures(100);
    const phase = card._weatherLayer._samples.rain[0].phase;
    hidden = true; card._onWeatherVisibility(); expect(card._weatherLayer.group.visible).toBe(false);
    expect(card._animateFeatures(60000)).toBe(false);
    hidden = false; card._onWeatherVisibility(); expect(card._weatherLayer.group.visible).toBe(true);
    expect(card._animateFeatures(61000)).toBe(false); expect(card._weatherLayer._samples.rain[0].phase).toBe(phase);
  });

  it('observes the scene once, suspends offscreen effects, and ignores a late disconnected observer', () => {
    const observers = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this); }
    });
    const card = fixture(); card._syncWeather(); const observer = observers[0];
    expect(card._weatherLayer.group.visible).toBe(false); expect(observer.observe).toHaveBeenCalledWith(card._scene);
    observer.callback([{ target: card._scene, isIntersecting: true }]); expect(card._weatherLayer.group.visible).toBe(true);
    card._watchWeatherVisibility(); expect(observers).toHaveLength(1);
    observer.callback([{ target: card._scene, isIntersecting: false }]); expect(card._weatherLayer.group.visible).toBe(false);
    card.connected = false; card._weatherObserver.disconnect(); card._weatherObserver = null;
    observer.callback([{ target: card._scene, isIntersecting: true }]); expect(card._weatherLayer.group.visible).toBe(false);
  });

  it('disposes the old scene resources on replacement and guards obsolete invalidation callbacks', () => {
    const card = fixture(); card._syncWeather(); const oldLayer = card._weatherLayer, oldView = card._view;
    const disposed = oldLayer.group.children.map((object) => [vi.spyOn(object.geometry, 'dispose'), vi.spyOn(object.material, 'dispose')]);
    card._view = { ...oldView, scene: new Scene(), dirty: false }; card._ensureWeatherLayer();
    expect(oldView.scene.children).not.toContain(oldLayer.group);
    for (const [geometry, material] of disposed) { expect(geometry).toHaveBeenCalledOnce(); expect(material).toHaveBeenCalledOnce(); }
    expect(card._view.dirty).toBe(false); oldLayer.onInvalidate(); expect(card._view.dirty).toBe(false);
    card._syncWeather(); expect(card._view.scene.children).toContain(card._weatherLayer.group);
    expect(card._weatherLayer.stats.rain).toBe(48);
  });

  it('cleans the observer on disconnect, preserves resources, and reconnects with only the existing sky timer', () => {
    const observers = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this); }
    });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const card = fixture(); card._stage = document.createElement('div'); card._toolbar = document.createElement('div');
    card._presetEvents = { setHass: vi.fn(), disconnect: vi.fn() }; card._schedule = vi.fn();
    card._endGesture = vi.fn(); card._setCameraTimer = vi.fn(); card._setImageTimer = vi.fn();
    card.connectedCallback(); const first = observers[0]; first.callback([{ target: card._scene, isIntersecting: true }]);
    const layer = card._weatherLayer; expect(vi.getTimerCount()).toBe(1);
    card.connected = false; card.disconnectedCallback();
    expect(first.disconnect).toHaveBeenCalledOnce(); expect(card._weatherObserver).toBeNull();
    expect(layer.group.parent).toBe(card._view.scene); expect(layer.group.visible).toBe(false); expect(vi.getTimerCount()).toBe(0);
    card.connected = true; card.connectedCallback(); expect(observers).toHaveLength(2);
    observers[1].callback([{ target: card._scene, isIntersecting: true }]);
    expect(card._weatherLayer).toBe(layer); expect(layer.group.visible).toBe(true); expect(vi.getTimerCount()).toBe(1);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('synchronizes weather even with the mini-map switched off or absent', () => {
    const card = fixture(); card._syncTracking = vi.fn(); card._miniMap = null;
    card._syncMiniMap(); expect(card._weatherLayer.stats.rain).toBe(48);
    card._hass.states['weather.house'] = state('unavailable'); card._syncMiniMap(); expect(card._weatherLayer.group.visible).toBe(false);
  });
});

describe('automatic sky requires genuine Home Assistant evidence', () => {
  it('uses the actual sun angles and model north/rotation', () => {
    const card = fixture(); card._view.model.north = 15; card._modelAlign = () => ({ rotation: 25 });
    card._applySky(false); const direction = sunVector(180, 30, 15, 25);
    expect(card._view.setSky).toHaveBeenCalledWith({ night: nightFactor(30), sunDir: clampSunDir(direction), sun: sunStrength(30) });
    expect(card._view.setSkyBodies.mock.lastCall[0].sun.dir).toEqual(direction);
  });

  it.each([
    undefined, state('unavailable', { elevation: 30, azimuth: 180 }),
    state('above_horizon', { elevation: null, azimuth: 180 }),
    state('above_horizon', { elevation: '30', azimuth: 180 }),
    state('above_horizon', { elevation: 30, azimuth: 180, restored: true }),
  ])('uses the neutral daytime fallback for invalid current sun evidence (%j)', (sun) => {
    const card = fixture(); card._hass.states['sun.sun'] = sun; card._applySky(false);
    expect(card._view.setSky).toHaveBeenCalledWith({ night: 0, sunDir: null });
    expect(card._view.setSkyBodies.mock.lastCall[0].sun).toBeNull(); expect(card._daylight).toBe(true);
    expect(card.weatherDiagnostics().sun.status).not.toBe('ready');
  });

  it('does not use a hidden or inherited disabled sun device', () => {
    const card = fixture(); card._hass.entities['sun.sun'] = { hidden: true }; card._applySky(false);
    expect(card._view.setSkyBodies.mock.lastCall[0].sun).toBeNull();
    card._hass.entities['sun.sun'] = { device_id: 'sun-device' }; card._hass.devices['sun-device'] = { disabled_by: 'user' };
    card._applySky(true); expect(card._view.setSkyBodies.mock.lastCall[0].sun).toBeNull();
  });

  it.each(['day', 'night'])('retains the existing manual %s choice when HA sun/location are absent', (mode) => {
    const card = fixture(); card._hass = { states: {}, config: {}, callService: vi.fn() }; card._skyMode = mode; card._applySky(false);
    const sky = card._view.setSky.mock.lastCall[0], bodies = card._view.setSkyBodies.mock.lastCall[0];
    expect(sky.night).toBe(mode === 'night' ? 1 : 0);
    if (mode === 'night') { expect(bodies.moon).toMatchObject({ phase: .4, illumination: .8 }); expect(bodies.sun).toBeNull(); }
    else { expect(bodies.sun.dir).toEqual(sunVector(200, 40, 0, 0)); expect(bodies.moon).toBeNull(); }
  });

  it.each([{}, { latitude: null, longitude: null }, { latitude: '51.5', longitude: '-.1' }, { latitude: 91, longitude: 0 }])('does not invent the moon location (%j)', (config) => {
    const card = fixture(); card._hass.config = config; card._applySky(false);
    expect(card._view.setSkyBodies.mock.lastCall[0].moon).toBeNull(); expect(card.weatherDiagnostics().location.status).toBe('invalid');
  });

  it('accepts genuine zero coordinates and removes an old moon immediately if location becomes invalid', () => {
    const card = fixture(); card._hass.config = { latitude: 0, longitude: 0 }; card._applySky(false);
    const actual = moonPosition(epoch, 0, 0); expect(card._view.setSkyBodies.mock.lastCall[0].moon).toMatchObject({ phase: actual.phase, latitude: 0 });
    card._view.setSky.mockClear(); card._view.setSkyBodies.mockClear();
    card._hass.config = { latitude: null, longitude: null }; card._applySky(false);
    expect(card._view.setSky).not.toHaveBeenCalled(); expect(card._view.setSkyBodies).toHaveBeenCalledOnce();
    expect(card._view.setSkyBodies.mock.lastCall[0].moon).toBeNull();
  });

  it('keeps unrelated updates idle while the normal moon refresh remains once per minute', () => {
    const card = fixture(); card._applySky(false); card._view.setSky.mockClear(); card._view.setSkyBodies.mockClear();
    for (let index = 0; index < 10; index++) {
      card._hass = { ...card._hass, states: { ...card._hass.states, 'sensor.unrelated': state(String(index)) } };
      card._applySky(false);
    }
    expect(card._view.setSky).not.toHaveBeenCalled(); expect(card._view.setSkyBodies).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000); card._applySky(false);
    expect(card._view.setSky).not.toHaveBeenCalled(); expect(card._view.setSkyBodies).toHaveBeenCalledOnce();
  });

  it('does not create a model, renderer or light just to show the sky on a drawn plan', () => {
    const card = fixture(); card._view.model = null; card._applySky(true);
    expect(card._view.setSky).not.toHaveBeenCalled(); expect(card._view.setSkyBodies).not.toHaveBeenCalled();
    expect(card._view.scene.children).toEqual([]);
  });
});
