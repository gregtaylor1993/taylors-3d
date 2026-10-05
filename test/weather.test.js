import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { pointInPolygon } from '../src/placement.js';
import { readSunState, readHaLocation, readWeather, normaliseWeatherFootprints, WeatherLayer, WEATHER_LIMITS } from '../src/weather.js';

const state = (value, attributes = {}) => ({ state: value, attributes });
const weatherConfig = { enabled: true, entity: 'weather.home', quality: 'low', intensity: 1, effects: ['rain', 'clouds', 'snow'] };
const hass = (condition = 'rainy', attributes = {}) => ({ states: {
  'weather.home': state(condition, attributes),
  'sun.sun': state('above_horizon', { elevation: 45, azimuth: 90 }),
}, config: { latitude: 51.5, longitude: -0.1, time_zone: 'Europe/London' }, callService: vi.fn() });
const outdoor = (extra = {}) => ({ id: 'garden', floorId: 'ground', elevation: 0, outdoor: true,
  polygon: [[0, 0], [8, 0], [8, 6], [0, 6]], ...extra });
const indoor = (extra = {}) => ({ id: 'room', floorId: 'ground', elevation: 0,
  polygon: [[2, 1], [6, 1], [6, 5], [2, 5]], ...extra });
const data = (extra = {}) => ({ weather: readWeather(hass(), weatherConfig), outdoors: [outdoor()], indoors: [], ...extra });
const layerFixture = () => {
  const scene = new THREE.Scene(), onInvalidate = vi.fn();
  return { scene, onInvalidate, layer: new WeatherLayer(scene, { onInvalidate }) };
};
function points(layer, name) {
  const object = layer[name], attribute = object.geometry.getAttribute('position');
  const count = object.geometry.drawRange.count, stride = name === 'rain' ? 2 : 1;
  return Array.from({ length: count / stride }, (_, index) => {
    const vertex = index * stride;
    return [attribute.getX(vertex), -attribute.getZ(vertex), attribute.getY(vertex)];
  });
}

describe('actual sun and Home Assistant location', () => {
  it('reads actual angles, permits the equator and Greenwich, and does not use forecast data', () => {
    const source = hass();
    expect(readSunState(source)).toMatchObject({ status: 'ready', elevation: 45, azimuth: 90 });
    source.states['sun.sun'] = state('below_horizon', { elevation: -12, azimuth: 360 });
    expect(readSunState(source)).toMatchObject({ elevation: -12, azimuth: 0 });
    source.config.latitude = 0; source.config.longitude = 0;
    expect(readHaLocation(source)).toMatchObject({ status: 'ready', latitude: 0, longitude: 0, timeZone: 'Europe/London' });
    expect(source.callService).not.toHaveBeenCalled();
  });

  it.each([null, '', '45', NaN, Infinity, -Infinity, {}, [], 91, -91])('rejects malformed/out-of-range elevation %s rather than inventing a horizon', (elevation) => {
    const source = hass(); source.states['sun.sun'].attributes.elevation = elevation;
    expect(readSunState(source)).toMatchObject({ status: 'invalid', elevation: null, azimuth: null });
  });

  it.each([null, '', '90', NaN, Infinity, -1, 361])('rejects malformed azimuth %s', (azimuth) => {
    const source = hass(); source.states['sun.sun'].attributes.azimuth = azimuth;
    expect(readSunState(source).status).toBe('invalid');
  });

  it.each(['unknown', 'unavailable', 'on'])('does not accept old attributes with sun state %s', (value) => {
    const source = hass(); source.states['sun.sun'].state = value;
    expect(readSunState(source).status).not.toBe('ready');
  });

  it.each([null, '', '51.5', NaN, Infinity, 91, -91])('does not infer a latitude from %s', (latitude) => {
    const source = hass(); source.config.latitude = latitude;
    expect(readHaLocation(source)).toMatchObject({ status: 'invalid', latitude: null, longitude: null });
  });

  it('validates longitude/time zone independently without substituting browser defaults', () => {
    const source = hass(); source.config.longitude = 181;
    expect(readHaLocation(source).status).toBe('invalid');
    source.config.longitude = 0; source.config.time_zone = 'not-a-zone';
    expect(readHaLocation(source)).toMatchObject({ status: 'ready', latitude: 51.5, longitude: 0, timeZone: null });
    expect(readHaLocation(source).diagnostics.map((d) => d.code)).toContain('time_zone');
    delete source.config.time_zone;
    expect(readHaLocation(source).timeZone).toBeNull();
  });
});

describe('current weather evidence and opt-in settings', () => {
  it('is off until explicitly enabled and selecting an entity, without making HA requests', () => {
    const source = hass();
    expect(readWeather(source)).toMatchObject({ status: 'off', effects: { rain: 0, snow: 0, clouds: 0 } });
    expect(readWeather(source, { enabled: true }).status).toBe('invalid');
    expect(readWeather(source, { ...weatherConfig, quality: 'off' }).status).toBe('off');
    expect(readWeather(source, { ...weatherConfig, effects: [] }).effects).toEqual({ rain: 0, snow: 0, clouds: 0 });
    expect(source.callService).not.toHaveBeenCalled();
  });

  it.each([
    ['rainy', 1, 0], ['pouring', 1, 0], ['snowy', 0, 1], ['snowy-rainy', 0.5, 0.5],
    ['lightning-rainy', 1, 0], ['lightning', 0, 0], ['hail', 0, 0], ['fog', 0, 0],
    ['sunny', 0, 0], ['clear-night', 0, 0], ['windy', 0, 0], ['exceptional', 0, 0],
  ])('maps actual %s without inventing unsupported hail/lightning animation', (condition, rain, snow) => {
    expect(readWeather(hass(condition), weatherConfig)).toMatchObject({ status: 'ready', condition, effects: { rain, snow } });
  });

  it('ignores rainy forecasts and freezing temperature when the actual condition is sunny', () => {
    const reading = readWeather(hass('sunny', { temperature: -10, precipitation: 8, precipitation_probability: 90,
      forecast: [{ condition: 'snowy', precipitation_probability: 100 }] }), weatherConfig);
    expect(reading.effects).toEqual({ rain: 0, snow: 0, clouds: 0 });
    expect(reading.condition).toBe('sunny');
  });

  it('uses only optional valid current cloud coverage, retaining the condition when it is malformed', () => {
    expect(readWeather(hass('partlycloudy', { cloud_coverage: 80 }), weatherConfig)).toMatchObject({ cloudCoverage: 80, effects: { clouds: 0.8 } });
    for (const coverage of ['80', NaN, -1, 101]) {
      const reading = readWeather(hass('cloudy', { cloud_coverage: coverage }), weatherConfig);
      expect(reading).toMatchObject({ status: 'ready', cloudCoverage: null, effects: { clouds: 0.9 } });
      expect(reading.diagnostics.map((d) => d.code)).toContain('cloud_coverage');
    }
    expect(readWeather(hass('cloudy', { cloud_coverage: null }), weatherConfig).cloudCoverage).toBeNull();
    expect(readWeather(hass('rainy'), { ...weatherConfig, effects: ['snow'] }).effects).toEqual({ rain: 0, snow: 0, clouds: 0 });
  });

  it.each([null, [], 'rain', { enabled: 'yes' }, { ...weatherConfig, quality: null }, { ...weatherConfig, quality: 'high' },
    { ...weatherConfig, intensity: NaN }, { ...weatherConfig, intensity: null }, { ...weatherConfig, intensity: '1' },
    { ...weatherConfig, intensity: -1 }, { ...weatherConfig, intensity: 1.1 }, { ...weatherConfig, effects: ['storm'] },
    { ...weatherConfig, effects: null }, { ...weatherConfig, entity: 'sensor.rain' }, { ...weatherConfig, entity: 'weather.home ' }])('rejects malformed settings %s', (config) => {
    expect(readWeather(hass(), config).status).toBe('invalid');
  });

  it.each(['unknown', 'unavailable', 'toString', 'forecast', 'raining'])('does not infer live weather from %s', (condition) => {
    expect(readWeather(hass(condition), weatherConfig).status).not.toBe('ready');
  });

  it.each(['sun.sun', 'weather.home'])('rejects restored, hidden, diagnostic, disabled, unavailable and absent %s sources', (entity) => {
    const read = (source) => entity === 'sun.sun' ? readSunState(source) : readWeather(source, weatherConfig);
    const restored = hass(); restored.states[entity].attributes.restored = true;
    expect(read(restored).status).toBe('unavailable');
    restored.states[entity].attributes.restored = 'true';
    expect(read(restored).status).toBe('invalid');
    const hidden = hass(); hidden.entities = { [entity]: { hidden_by: 'user' } };
    expect(read(hidden).status).toBe('hidden');
    hidden.entities[entity] = { entity_category: 'diagnostic' };
    expect(read(hidden).status).toBe('hidden');
    hidden.entities[entity] = { device_id: 'disabled-device' }; hidden.devices = { 'disabled-device': { disabled_by: 'user' } };
    expect(read(hidden).status).toBe('disabled');
    delete hidden.states[entity]; hidden.devices = {};
    expect(read(hidden).status).toBe('missing');
    const unavailable = hass(); unavailable.states[entity].state = 'unavailable';
    expect(read(unavailable).status).toBe('unavailable');
  });
});

describe('explicit outdoor footprints', () => {
  it('requires floor, finite elevation, deliberate outdoor designation and complete indoor input', () => {
    expect(normaliseWeatherFootprints([outdoor()], undefined).outdoors).toHaveLength(0);
    for (const extra of [{ outdoor: undefined }, { floorId: '' }, { elevation: null }, { elevation: NaN }, { elevation: 10001 }]) {
      expect(normaliseWeatherFootprints([outdoor(extra)], []).outdoors).toHaveLength(0);
    }
    expect(normaliseWeatherFootprints([outdoor()], []).outdoors).toHaveLength(1);
  });

  it.each([
    [], [[0, 0], [1, 1]], [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [4, 4], [0, 4], [4, 0]],
    [[0, 0], [4, 0], [2, 0], [4, 4], [0, 4]],
    [[0, 0], [4, 0], [4, 0], [4, 4], [0, 4]],
    [[0, 0], [4, 0], [4, NaN], [0, 4]],
    [[0, 0], [4, 0], ['4', 4], [0, 4]],
  ])('rejects empty/degenerate/self-crossing/malformed outlines %s', (polygon) => {
    const result = normaliseWeatherFootprints([outdoor({ polygon })], []);
    expect(result.outdoors).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('outdoor_footprint');
  });

  it('fails closed for broken indoor data and ambiguous outdoor region IDs', () => {
    const broken = normaliseWeatherFootprints([outdoor()], [indoor({ polygon: [[0, 0]] })]);
    expect(broken.outdoors).toHaveLength(0);
    expect(broken.diagnostics.map((d) => d.code)).toContain('indoor_footprint');
    const duplicate = normaliseWeatherFootprints([outdoor(), outdoor({ elevation: 3 })], []);
    expect(duplicate.outdoors).toHaveLength(0);
    expect(duplicate.diagnostics.map((d) => d.code)).toContain('duplicate_region');
    expect(normaliseWeatherFootprints([outdoor()], [], null).outdoors).toHaveLength(0);
  });

  it('normalizes winding/start/closing point without mutating source polygons and filters shown floors', () => {
    const source = outdoor(), original = JSON.stringify(source);
    const reference = normaliseWeatherFootprints([source], []).outdoors[0];
    const reversed = outdoor({ polygon: [[8, 6], [8, 0], [0, 0], [0, 6], [8, 6]] });
    expect(normaliseWeatherFootprints([reversed], []).outdoors[0]).toEqual(reference);
    expect(JSON.stringify(source)).toBe(original);
    expect(normaliseWeatherFootprints([source], [], ['first']).outdoors).toHaveLength(0);
    expect(normaliseWeatherFootprints([outdoor({ shown: false })], []).outdoors).toHaveLength(0);
  });
});

describe('owned weather renderer and idle rendering', () => {
  it('leaves disabled/empty/unavailable weather completely idle and allocates no particle resources', () => {
    const { layer, scene, onInvalidate } = layerFixture();
    expect(layer.setData()).toBe(false);
    expect(layer.setData({ weather: readWeather(hass()) })).toBe(false);
    expect(layer.setData(data({ weather: readWeather(hass('unavailable'), weatherConfig) }))).toBe(false);
    expect(layer.setVisible(false)).toBe(false);
    expect(layer.setVisible(true)).toBe(false);
    expect(layer.update(100)).toBe(false);
    expect(layer.group.children).toHaveLength(0);
    expect(scene.children.some((object) => object.isLight)).toBe(false);
    expect(onInvalidate).not.toHaveBeenCalled();
    layer.dispose();
  });

  it('places north correctly in the existing scene and excludes hidden indoor outlines across floors', () => {
    const { layer } = layerFixture();
    const room = indoor({ floorId: 'first', elevation: 3, shown: false });
    layer.setData(data({ outdoors: [outdoor({ elevation: 2 })], indoors: [room] }));
    const rain = points(layer, 'rain');
    expect(rain.length).toBeGreaterThan(50);
    for (const [east, north, height] of rain) {
      expect(pointInPolygon([east, north], outdoor().polygon)).toBe(true);
      expect(pointInPolygon([east, north], room.polygon)).toBe(false);
      expect(height).toBeGreaterThanOrEqual(2.15);
      expect(height).toBeLessThanOrEqual(10.15);
    }
    layer.group.traverse((object) => {
      expect(object.isLight).toBeFalsy();
      if (object.geometry) { expect(object.userData.helper).toBe(true); expect(object.castShadow).toBe(false); expect(object.receiveShadow).toBe(false); }
    });
    expect(layer.rain.raycast()).toBeUndefined();
    layer.dispose();
  });

  it('samples concave regions rather than their bounding rectangle', () => {
    const polygon = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]], { layer } = layerFixture();
    layer.setData(data({ outdoors: [outdoor({ polygon })], weather: readWeather(hass('snowy'), { ...weatherConfig, quality: 'medium' }) }));
    for (const [east, north] of points(layer, 'snow')) expect(pointInPolygon([east, north], polygon)).toBe(true);
    layer.dispose();
  });

  it('renders no precipitation when indoors cover the entire outdoor region or masks are incomplete', () => {
    const { layer, onInvalidate } = layerFixture();
    layer.setData(data({ indoors: [indoor({ polygon: outdoor().polygon })] }));
    expect(layer.group.visible).toBe(false);
    expect(layer.stats.rain).toBe(0);
    expect(layer.diagnostics.map((d) => d.code)).toContain('no_exposed_outdoors');
    expect(layer.setData(data({ indoors: [indoor({ polygon: outdoor().polygon })] }))).toBe(false);
    expect(layer.diagnostics.map((d) => d.code)).toContain('no_exposed_outdoors');
    layer.setData(data({ indoors: undefined }));
    expect(layer.group.visible).toBe(false);
    expect(layer.diagnostics.map((d) => d.code)).toContain('footprints');
    expect(onInvalidate).not.toHaveBeenCalled();
    layer.dispose();
  });

  it('bounds resources across quality/intensity changes and keeps existing geometry/material ownership', () => {
    const { layer } = layerFixture();
    layer.setData(data());
    const resources = layer.group.children.map((object) => [object.geometry, object.material]);
    layer.setData(data({ weather: readWeather(hass('snowy-rainy', { cloud_coverage: 100 }), { ...weatherConfig, quality: 'medium' }) }));
    expect(layer.stats.rain).toBeLessThanOrEqual(WEATHER_LIMITS.medium.rain);
    expect(layer.stats.snow).toBeLessThanOrEqual(WEATHER_LIMITS.medium.snow);
    expect(layer.stats.clouds).toBeLessThanOrEqual(WEATHER_LIMITS.medium.clouds);
    expect(layer.clouds.count).toBeLessThanOrEqual(WEATHER_LIMITS.medium.clouds * 4);
    expect(layer.group.children.map((object) => [object.geometry, object.material])).toEqual(resources);
    layer.setData(data({ weather: readWeather(hass(), { ...weatherConfig, intensity: 0 }) }));
    expect(layer.group.visible).toBe(false);
    expect(layer.update(1000)).toBe(false);
    layer.dispose();
  });

  it('preserves phase/buffers and makes no idle invalidation for clones, unrelated diagnostics/source changes and equivalent outlines', () => {
    const { layer, onInvalidate } = layerFixture(), initial = data();
    expect(layer.setData(initial)).toBe(true);
    layer.update(100); expect(layer.update(200)).toBe(true);
    const position = Array.from(layer.rain.geometry.getAttribute('position').array), builds = layer.stats.rebuilds;
    onInvalidate.mockClear();
    const clone = structuredClone(initial);
    clone.weather.entity = 'weather.other'; clone.weather.diagnostics = [{ code: 'other', message: 'A diagnostic changed.' }];
    expect(layer.setData(clone)).toBe(false);
    clone.outdoors[0].polygon.reverse();
    expect(layer.setData(clone)).toBe(false);
    expect(layer.stats.rebuilds).toBe(builds);
    expect(Array.from(layer.rain.geometry.getAttribute('position').array)).toEqual(position);
    expect(layer.diagnostics).toContainEqual({ code: 'other', message: 'A diagnostic changed.' });
    expect(onInvalidate).not.toHaveBeenCalled();
    expect(layer.setVisible(true)).toBe(false);
    expect(layer.update(250)).toBe(true);
    layer.dispose();
  });

  it('updates falling particles only, leaves clouds static, and uses elapsed time with a bounded resume step', () => {
    const { layer, onInvalidate } = layerFixture();
    layer.setData(data());
    const cloudMatrix = Array.from(layer.clouds.instanceMatrix.array), cloudVersion = layer.clouds.instanceMatrix.version;
    const rain = points(layer, 'rain')[0]; onInvalidate.mockClear();
    expect(layer.update(100)).toBe(false);
    expect(layer.update(100)).toBe(false);
    expect(layer.update(200)).toBe(true);
    const moved = points(layer, 'rain')[0];
    expect(moved[0]).toBe(rain[0]); expect(moved[1]).toBe(rain[1]);
    expect((rain[2] - moved[2] + WEATHER_LIMITS.height) % WEATHER_LIMITS.height).toBeCloseTo(0.5, 5);
    expect(layer.update(10000000)).toBe(true);
    expect(Array.from(layer.clouds.instanceMatrix.array)).toEqual(cloudMatrix);
    expect(layer.clouds.instanceMatrix.version).toBe(cloudVersion);
    expect(onInvalidate).not.toHaveBeenCalled();
    layer.dispose();
  });

  it('supports Static/reduced motion/cloud-only modes and visibility without background animation', () => {
    const { layer, onInvalidate } = layerFixture();
    const staticData = data({ weather: readWeather(hass(), { ...weatherConfig, quality: 'static' }) });
    layer.setData(staticData);
    expect(layer.group.visible).toBe(true); expect(layer.update(100)).toBe(false); expect(layer.update(200)).toBe(false);
    const position = Array.from(layer.rain.geometry.getAttribute('position').array), builds = layer.stats.rebuilds;
    expect(layer.setData(data())).toBe(false); // Same visible data, animated policy only.
    expect(layer.stats.rebuilds).toBe(builds);
    expect(layer.update(300, { reducedMotion: true })).toBe(false);
    expect(layer.update(400, { reducedMotion: true })).toBe(false);
    expect(Array.from(layer.rain.geometry.getAttribute('position').array)).toEqual(position);
    expect(layer.update(500)).toBe(false); expect(layer.update(600)).toBe(true);
    onInvalidate.mockClear();
    expect(layer.setVisible(false)).toBe(true); expect(layer.setVisible(false)).toBe(false);
    expect(layer.update(700)).toBe(false); expect(layer.update(1000000)).toBe(false);
    expect(layer.setVisible(true)).toBe(true); expect(layer.update(1000001)).toBe(false);
    expect(onInvalidate).toHaveBeenCalledTimes(2);
    layer.setData(data({ weather: readWeather(hass('cloudy'), weatherConfig) }));
    expect(layer.stats.clouds).toBeGreaterThan(0); expect(layer.update(1000100)).toBe(false);
    layer.dispose();
  });

  it('responds to actual weather/floor/footprint changes, hides unavailable sources, and supplies actionable empty-region diagnostics', () => {
    const { layer, onInvalidate } = layerFixture();
    layer.setData(data()); onInvalidate.mockClear();
    expect(layer.setData(data({ weather: readWeather(hass('snowy'), weatherConfig) }))).toBe(true);
    expect(layer.stats.rain).toBe(0); expect(layer.stats.snow).toBeGreaterThan(0);
    expect(layer.setData(data({ visibleFloors: ['first'] }))).toBe(true); expect(layer.group.visible).toBe(false);
    expect(layer.setData(data({ outdoors: [] }))).toBe(false);
    expect(layer.diagnostics.map((d) => d.code)).toContain('no_outdoors');
    layer.setData(data({ outdoors: [outdoor({ elevation: 3 })] }));
    expect(points(layer, 'rain').every((point) => point[2] >= 3.15)).toBe(true);
    expect(layer.setData(data({ weather: readWeather(hass('unavailable'), weatherConfig) }))).toBe(true);
    expect(layer.group.visible).toBe(false);
    expect(layer.update(100)).toBe(false);
    expect(onInvalidate).toHaveBeenCalledTimes(4);
    layer.dispose();
  });

  it('removes and disposes only owned resources once, and cannot revive after teardown', () => {
    const { layer, scene } = layerFixture();
    const unrelated = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(unrelated);
    const external = vi.spyOn(unrelated.geometry, 'dispose');
    layer.setData(data());
    const owned = layer.group.children.flatMap((object) => [vi.spyOn(object.geometry, 'dispose'), vi.spyOn(object.material, 'dispose')]);
    layer.dispose(); layer.dispose();
    expect(scene.children).toEqual([unrelated]);
    owned.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
    expect(external).not.toHaveBeenCalled();
    expect(layer.setData(data())).toBe(false); expect(layer.setVisible(true)).toBe(false); expect(layer.update(200)).toBe(false);
    unrelated.geometry.dispose(); unrelated.material.dispose();
  });
});
