import { revealEditorTab } from './lib/editor-tab-navigation.mjs';
// Explicit simulated HA readings verify the UI/rendering contract, not household weather.
// Run after npm run build: node scripts/weather-check.mjs (set CHROME_PATH when needed).
import fs from 'node:fs';
import path from 'node:path';
import { openDemo, root } from './lib/demo-browser.mjs';

const checks = [], browserErrors = [];
const check = (name, pass, detail) => {
  checks.push(pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ' – ' + JSON.stringify(detail) : ''}`);
};
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function control(page, selector, action) {
  await revealEditorTab(page, selector);
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement();
    if (!element) throw new Error('Missing environment control: ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await action(element);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const select = (page, field, value) => control(page, `[data-field="env-weather-${field}"]`, (element) => element.select(value));
const type = (page, field, value) => control(page, `[data-field="env-weather-${field}"]`, async (element) => {
  await element.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type(value);
});
async function statePatch(page, changes) {
  await page.evaluate((changes) => {
    const card = document.querySelector('taylors3d-card'); card.hass = { ...card._hass, states: { ...card._hass.states, ...changes } };
  }, changes);
  await settle(page);
}
async function configure(page, weather) {
  await page.evaluate((weather) => {
    const card = document.querySelector('taylors3d-card'); card._commit({ ...card._layout, weather });
  }, weather);
  await settle(page);
}
async function prepare(page) {
  await page.evaluate(() => {
    window.__demoMowerPaused = true;
    document.querySelectorAll('section.theme')[1]?.remove(); document.querySelector('main').style.display = 'block';
    const card = document.querySelector('taylors3d-card');
    window.weatherFixture = { services: [], renderer: card._view.renderer, resources: null, docHidden: false };
    card.setConfig({ ...card._config, height: '700px' });
    card.hass = { ...card._hass, config: { ...card._hass.config, latitude: 51.5, longitude: -.1, time_zone: 'Europe/London' },
      callService: (...args) => { window.weatherFixture.services.push(args); return Promise.resolve(); },
      states: { ...card._hass.states,
        // Registry membership is setup; idle checks below change only an existing reading.
        'sensor.weather_unrelated': { state: '0', attributes: {} },
        'weather.fixture': { state: 'rainy', attributes: { friendly_name: 'Simulated current weather' } },
        'sun.sun': { state: 'above_horizon', attributes: { elevation: 35, azimuth: 180 } } } };
    card._skyMode = 'auto'; card._applySky(true);
    card._commit({ ...card._layout, weather: { enabled: false } });
    card._view.stopCameraMotion();
    window.weatherFixture.lights = []; card._view.scene.traverse((node) => { if (node.isLight) window.weatherFixture.lights.push(node); });
  });
  await settle(page);
  await page.evaluate(() => document.querySelector('taylors3d-card').resetHistory());
}
async function snapshot(page) {
  return page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), layer = card._weatherLayer;
    const pointIn = ([x, y], polygon) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    };
    const footprints = card.weatherFootprints(), indoors = footprints.indoors.filter((region) => Array.isArray(region.polygon));
    const samples = [...layer._samples.rain, ...layer._samples.snow];
    const lights = []; card._view.scene.traverse((node) => { if (node.isLight) lights.push(node); });
    const resources = layer.group.children.map((object) => [object.geometry, object.material]);
    return { reading: card._weatherReading, stats: { ...layer.stats }, visible: layer.group.visible,
      resources: resources.length, sameResources: !window.weatherFixture.resources || resources.length === window.weatherFixture.resources.length
        && resources.every((pair, index) => pair[0] === window.weatherFixture.resources[index][0] && pair[1] === window.weatherFixture.resources[index][1]),
      helpers: layer.group.children.every((object) => object.userData.helper && !object.castShadow && !object.receiveShadow),
      finite: layer.group.children.filter((object) => object.geometry.getAttribute('position'))
        .every((object) => [...object.geometry.getAttribute('position').array].every(Number.isFinite)),
      insideOutdoors: samples.every((sample) => footprints.outdoors.some((region) => region.shown !== false
        && (!footprints.visibleFloors || footprints.visibleFloors.includes(region.floorId)) && pointIn([sample.x, sample.y], region.polygon))),
      outsideIndoors: samples.every((sample) => !indoors.some((region) => pointIn([sample.x, sample.y], region.polygon))),
      elevations: [...new Set(samples.map((sample) => sample.elevation))], phase: layer._samples.rain[0]?.phase ?? layer._samples.snow[0]?.phase ?? null,
      noExtraLights: lights.length === window.weatherFixture.lights.length && lights.every((light, index) => light === window.weatherFixture.lights[index]),
      sameRenderer: card._view.renderer === window.weatherFixture.renderer, calls: window.weatherFixture.services.length,
      diagnostics: layer.diagnostics, sky: card._skyLast,
      history: card._history.size, saved: card._layout.weather, motionPreference: !!card._reducedMotion?.matches,
      footprintCount: { outdoors: footprints.outdoors.length, indoors: footprints.indoors.length } };
  });
}
async function idle(page, name) {
  await page.waitForFunction(() => {
    const view = document.querySelector('taylors3d-card')._view, now = performance.now();
    if (view.dirty || view._tween || now - (view._camMovedAt || 0) < 350) { window.weatherIdle = null; return false; }
    if (!window.weatherIdle || ['frames', 'shadow', 'shadowLights'].some((key) => window.weatherIdle[key] !== view.stats[key])) {
      window.weatherIdle = { ...view.stats, at: now }; return false;
    }
    return now - window.weatherIdle.at >= 350;
  }, { timeout: 10000 });
  const counts = await page.evaluate(async () => {
    const card = document.querySelector('taylors3d-card'), layer = card._weatherLayer;
    const stats = () => ({ frames: card._view.stats.frames, shadow: card._view.stats.shadow, shadowLights: card._view.stats.shadowLights });
    const before = stats(), rebuilds = layer.stats.rebuilds, resources = layer.group.children.map((object) => object.geometry);
    for (let index = 0; index < 10; index++) {
      card.hass = { ...card._hass, states: { ...card._hass.states,
        'sensor.weather_unrelated': { state: String(index), attributes: {} } } };
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { before, after: stats(), unchanged: rebuilds === layer.stats.rebuilds
      && resources.every((geometry, index) => geometry === layer.group.children[index]?.geometry), services: window.weatherFixture.services.length };
  });
  check(name, counts.unchanged && counts.services === 0 && Object.keys(counts.before).every((key) => counts.before[key] === counts.after[key]), counts);
}
const weatherConfig = (quality = 'low', effects = ['rain', 'clouds', 'snow']) => ({ enabled: true, entity: 'weather.fixture', quality, intensity: .6, effects });
const shots = path.join(root, 'screenshots'); fs.mkdirSync(shots, { recursive: true });

let session;
try {
  session = await openDemo({ view: 'top', floor: 'ground' }, { width: 1280, height: 1000 });
  const { page } = session; await prepare(page); let data = await snapshot(page);
  check('weather starts opted out without particle resources or Home Assistant actions', data.reading.status === 'off' && data.resources === 0 && data.calls === 0);
  await click(page, 'button.edit'); await click(page, '[data-act="tab"][data-id="environment"]');
  check('Environment explains actual sun data and the explicit outdoor mask', await page.evaluate(() => {
    const text = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-env-weather-editor]').textContent;
    return text.includes('sun.sun') && text.includes('35°') && text.includes('51.5°') && text.includes('no building boundary is guessed');
  }));
  await select(page, 'entity', 'weather.fixture'); await click(page, '[data-field="env-weather-enabled"]');
  await type(page, 'intensity', '.7');
  await page.evaluate(() => { window.weatherFocused = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="env-weather-intensity"]'); });
  await statePatch(page, { 'sensor.weather_unrelated': { state: '2', attributes: {} } });
  check('a focused unfinished weather draft survives a live HA update without saving or animating', await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), input = card.shadowRoot.querySelector('[data-field="env-weather-intensity"]');
    return input === window.weatherFocused && card.shadowRoot.activeElement === input && Number(input.value) === .7
      && card._layout.weather.enabled === false && !card._weatherLayer.group.visible && card._weatherLayer.stats.rain === 0;
  }));
  await click(page, '[data-act="env-weather-cancel"]'); data = await snapshot(page);
  check('Cancel restores the saved disabled settings and adds no history entry', data.saved.enabled === false && data.history === 0
    && await page.evaluate(() => !document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="env-weather-enabled"]').checked));
  await select(page, 'entity', 'weather.fixture'); await click(page, '[data-field="env-weather-enabled"]');
  await type(page, 'intensity', '.7'); await select(page, 'quality', 'low'); await click(page, '[data-act="env-weather-save"]'); data = await snapshot(page);
  check('Save records explicit weather settings once while editing keeps particles suspended', data.saved.enabled && data.saved.entity === 'weather.fixture'
    && data.saved.intensity === .7 && data.history === 1 && !data.visible);
  await type(page, 'intensity', '.2'); await click(page, '[data-act="history-undo"]'); data = await snapshot(page);
  check('Undo clears a later unsaved draft and restores weather off', data.saved.enabled === false && !data.visible
    && await page.evaluate(() => !document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="env-weather-enabled"]').checked));
  await click(page, '[data-act="history-redo"]'); data = await snapshot(page);
  check('Redo restores the saved weather choice', data.saved.enabled && data.saved.intensity === .7);
  await page.screenshot({ path: path.join(shots, 'environment-weather-editor.png') });
  await click(page, 'button.edit');
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherLayer.group.visible);
  data = await snapshot(page);
  check('actual rain and cloud helpers are finite, outdoors and excluded from every indoor floor', data.stats.rain > 0 && data.stats.clouds > 0
    && data.stats.rain <= 96 && data.stats.clouds <= 6 && data.finite && data.insideOutdoors && data.outsideIndoors && data.helpers, data.stats);
  await page.evaluate(() => { window.weatherFixture.resources = document.querySelector('taylors3d-card')._weatherLayer.group.children.map((object) => [object.geometry, object.material]); });
  const phase = data.phase; await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120))); data = await snapshot(page);
  check('the existing render loop animates rain without any extra renderer or light slots', phase !== data.phase && data.sameRenderer && data.noExtraLights && data.calls === 0);
  await page.screenshot({ path: path.join(shots, 'environment-rain-top.png') });
  await statePatch(page, { 'weather.fixture': { state: 'snowy', attributes: { friendly_name: 'Simulated current weather' } } }); data = await snapshot(page);
  check('a current snow reading replaces rain and reuses the bounded weather resources', data.stats.rain === 0 && data.stats.snow > 0
    && data.stats.snow <= 48 && data.sameResources && data.outsideIndoors && data.insideOutdoors, data.stats);
  await page.screenshot({ path: path.join(shots, 'environment-snow-top.png') });
  await statePatch(page, { 'weather.fixture': { state: 'sunny', attributes: { forecast: [{ condition: 'rainy' }], precipitation_probability: 100 } } }); data = await snapshot(page);
  check('a forecast rain chance never animates rain during a sunny current state', !data.visible && data.stats.rain === 0 && data.stats.snow === 0 && data.stats.clouds === 0);
  await statePatch(page, { 'weather.fixture': { state: 'rainy', attributes: { restored: true } } }); data = await snapshot(page);
  check('restored weather attributes are labelled unavailable and remove the old effect', data.reading.status === 'unavailable' && !data.visible);
  await statePatch(page, { 'weather.fixture': { state: 'rainy', attributes: {} } });
  await configure(page, weatherConfig('static')); data = await snapshot(page); const staticPhase = data.phase;
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120))); data = await snapshot(page);
  check('Static keeps the actual weather still while retaining geometry', data.visible && data.phase === staticPhase && data.sameResources);
  await configure(page, weatherConfig());
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._reducedMotion.matches);
  data = await snapshot(page); const reducedPhase = data.phase;
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120))); data = await snapshot(page);
  check('reduced motion shows a static effect without pretending weather is off', data.visible && data.phase === reducedPhase && data.motionPreference);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card.style.transform = 'translateY(3000px)'; });
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._weatherLayer.group.visible);
  data = await snapshot(page); const offscreenPhase = data.phase;
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120))); data = await snapshot(page);
  check('moving the scene offscreen pauses its weather animation', !data.visible && data.phase === offscreenPhase);
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card.style.transform = ''; card.scrollIntoView({ block: 'center' }); });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherLayer.group.visible);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.weatherFixture.docHidden });
    window.weatherFixture.docHidden = true; document.dispatchEvent(new Event('visibilitychange'));
  }); data = await snapshot(page); const hiddenPhase = data.phase;
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 120))); data = await snapshot(page);
  check('a simulated document visibility event pauses effects without particle movement', !data.visible && data.phase === hiddenPhase);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherLayer.group.visible);
  await page.evaluate(() => document.querySelector('taylors3d-card')._setFloor('first')); data = await snapshot(page);
  check('an indoor-only selected floor shows no ground-floor weather', !data.visible && data.stats.rain === 0);
  await page.evaluate(() => document.querySelector('taylors3d-card')._setFloor('ground'));
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherLayer.group.visible);
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); window.weatherDetached = card; card.remove(); });
  const detached = await page.evaluate(() => ({ visible: window.weatherDetached._weatherLayer.group.visible,
    observer: !!window.weatherDetached._weatherObserver, raf: !!window.weatherDetached._view._raf, parent: !!window.weatherDetached._weatherLayer.group.parent }));
  check('disconnect stops weather and its observer/render loop while preserving reusable resources', !detached.visible && !detached.observer && !detached.raf && detached.parent, detached);
  await page.evaluate(() => document.querySelector('section.theme').append(window.weatherDetached));
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherLayer.group.visible); data = await snapshot(page);
  check('reconnecting resumes the saved current reading with the same owned geometry', data.sameResources && data.reading.status === 'ready' && data.calls === 0);
} catch (error) { check('weather UI and lifecycle scenario completes', false, error.message); }
finally { if (session) { browserErrors.push(...session.errors); await session.close(); } }

session = null;
try {
  session = await openDemo({ model: '1', floor: 'ground', view: '3d' }, { width: 1280, height: 1000 });
  const { page } = session; await page.waitForFunction(() => !!document.querySelector('taylors3d-card')._view.model, { timeout: 30000 });
  await prepare(page);
  await idle(page, 'GLB weather off: ten unrelated HA updates add zero frames, shadows or resource rebuilds');
  await configure(page, weatherConfig('static')); await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherLayer.group.visible);
  let data = await snapshot(page);
  check('tagged GLB indoor/outdoor outlines work with the same scene and zero extra lights', data.stats.rain > 0 && data.finite && data.outsideIndoors
    && data.insideOutdoors && data.noExtraLights && data.sameRenderer && data.footprintCount.indoors > 0, data.stats);
  await idle(page, 'GLB static weather: ten unrelated HA updates add zero frames, shadows or resource rebuilds');
  await page.screenshot({ path: path.join(shots, 'environment-weather-model.png') });
  const skyBoundary = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), original = card._view.setSkyBodies.bind(card._view);
    window.weatherFixture.skyBodies = [];
    card._view.setSkyBodies = (data) => { window.weatherFixture.skyBodies.push(data); return original(data); };
    card.hass = { ...card._hass, states: { ...card._hass.states, 'sun.sun': { state: 'below_horizon', attributes: { elevation: -12, azimuth: 300 } } } };
    return { night: card._skyLast.night, sun: window.weatherFixture.skyBodies.at(-1)?.sun };
  });
  check('automatic sun uses an actual HA below-horizon reading', skyBoundary.night > .9 && Array.isArray(skyBoundary.sun?.dir), skyBoundary);
  await statePatch(page, { 'sun.sun': { state: 'unavailable', attributes: { elevation: -12, azimuth: 300 } } });
  const unavailableSun = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'); return { sky: card._skyLast, sun: window.weatherFixture.skyBodies.at(-1)?.sun, diagnostic: card.weatherDiagnostics().sun.status };
  });
  check('unavailable sun keeps a neutral daytime fallback and clears the stale sun direction', unavailableSun.sky.night === 0
    && unavailableSun.sky.sunDir === null && unavailableSun.sun === null && unavailableSun.diagnostic === 'unavailable', unavailableSun);
  await statePatch(page, { 'sun.sun': { state: 'above_horizon', attributes: { elevation: 35, azimuth: 180, restored: true } } });
  check('a restored sun snapshot cannot invent a current lighting direction', await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'); return card._skyLast.sunDir === null && window.weatherFixture.skyBodies.at(-1).sun === null;
  }));
  await statePatch(page, { 'sun.sun': { state: 'above_horizon', attributes: { elevation: 35, azimuth: 180 } } });
  const invalidMoon = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'); card.hass = { ...card._hass, config: { ...card._hass.config, latitude: null, longitude: null } };
    return window.weatherFixture.skyBodies.at(-1)?.moon === null && card.weatherDiagnostics().location.status === 'invalid';
  });
  check('invalid HA latitude/longitude immediately removes the actual moon instead of assuming zeroes', invalidMoon);
  await page.evaluate(() => document.querySelector('taylors3d-card').setSection(true)); data = await snapshot(page);
  check('Section hides decorative weather even with valid current readings', !data.visible && data.reading.status === 'ready');
  await page.evaluate(() => document.querySelector('taylors3d-card').setSection(false, { camera: false }));
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._weatherLayer.group.visible);
  await configure(page, weatherConfig('low', ['clouds']));
  await statePatch(page, { 'weather.fixture': { state: 'cloudy', attributes: { cloud_coverage: 75 } } }); data = await snapshot(page);
  check('actual cloud coverage supplies a bounded static cloud layer without rain', data.stats.clouds > 0 && data.stats.clouds <= 6
    && data.stats.rain === 0 && data.stats.snow === 0 && data.reading.cloudCoverage === 75, data.stats);
  await idle(page, 'GLB clouds alone: unrelated HA updates remain idle with the existing light budget');
  check('every weather and sky scenario sends zero Home Assistant service calls', (await snapshot(page)).calls === 0);
} catch (error) { check('tagged-model sky and idle scenario completes', false, error.message); }
finally { if (session) { browserErrors.push(...session.errors); await session.close(); } }
check('no browser errors', browserErrors.length === 0, browserErrors);
if (checks.some((pass) => !pass)) process.exitCode = 1;
