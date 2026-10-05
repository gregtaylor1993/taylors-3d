// Real browser checks for room measurements and location alerts on the existing card/renderer.
// Run after npm run build: node scripts/overlays-check.mjs (set CHROME_PATH when needed).
import fs from 'node:fs';
import path from 'node:path';
import { openDemo, root } from './lib/demo-browser.mjs';

const failures = [], browserErrors = [];
const shots = path.join(root, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
const check = (name, passed, details = '') => {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${details ? ` – ${details}` : ''}`);
  if (!passed) failures.push(name);
};

async function configure(page, config, states = {}, bindings = []) {
  await page.evaluate((config, states, bindings) => {
    window.__demoMowerPaused = true;
    for (const c of document.querySelectorAll('taylors3d-card')) {
      c._commit({ ...c._layout, room_overlays: config, alert_bindings: bindings });
      c.hass = { ...c.hass, states: { ...c.hass.states, ...states } };
    }
  }, config, states, bindings);
  await page.waitForFunction((mode) => {
    const c = document.querySelector('taylors3d-card');
    return c?._roomOverlayData && (mode === 'off' ? !c._roomOverlayData.legend : c._roomOverlayData.legend?.mode === mode);
  }, { timeout: 10000 }, config.mode);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function snapshot(page) {
  return page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), layer = c._statusOverlays;
    return {
      rooms: c._roomOverlayData.rooms.map((r) => ({ id: r.id, floorId: r.floorId, value: r.value, status: r.status, label: r.label, color: r.color })),
      meshes: [...layer.rooms].map(([id, part]) => ({ id, y: part.mesh.position.y, color: '#' + part.mesh.material.color.getHexString(),
        vertices: part.mesh.geometry.attributes.position.count, label: part.label?.element.textContent, connected: !!part.label?.element.isConnected,
        labelVisible: !!part.label?.visible && !part.label.element.hidden })),
      alerts: c._alertData.alerts.map((a) => ({ id: a.id, active: a.active, status: a.status, shown: a.shown, location: a.location, label: a.label })),
      rings: [...layer.alerts].map(([id, part]) => ({ id, position: part.mesh.position.toArray(), scale: part.mesh.scale.x, opacity: part.mesh.material.opacity, color: '#' + part.mesh.material.color.getHexString() })),
      legend: c._statusLegend.textContent, legendHidden: c._statusLegend.hidden, visible: layer.group.visible,
      calls: (window.__serviceCalls || []).length,
    };
  });
}

async function checkModelIdle(page, label) {
  await page.waitForFunction(() => {
    const view = document.querySelector('taylors3d-card')._view, now = performance.now();
    if (view.dirty || view._tween || now - (view._camMovedAt || 0) < 350) { window.__overlayIdleSample = null; return false; }
    const sample = window.__overlayIdleSample;
    if (!sample || sample.frames !== view.stats.frames || sample.shadow !== view.stats.shadow || sample.shadowLights !== view.stats.shadowLights) {
      window.__overlayIdleSample = { ...view.stats, at: now }; return false;
    }
    return now - sample.at >= 350;
  }, { timeout: 10000 });
  const counters = await page.evaluate(async () => {
    const card = document.querySelector('taylors3d-card'), stats = () => ({ frames: card._view.stats.frames, shadow: card._view.stats.shadow, shadowLights: card._view.stats.shadowLights });
    const before = stats();
    for (let i = 0; i < 10; i++) {
      card.hass = { ...card.hass, states: { ...card.hass.states,
        'sensor.overlay_unrelated': { entity_id: 'sensor.overlay_unrelated', state: String(i), attributes: { unit_of_measurement: 'W' } } } };
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { before, after: stats() };
  });
  check(label, Object.keys(counters.before).every((key) => counters.before[key] === counters.after[key]), JSON.stringify(counters));
}

let session;
try {
  session = await openDemo({ view: 'top', floor: 'ground' });
  const { page } = session;
  await page.evaluate(() => { window.__demoMowerPaused = true; window.__serviceCalls = []; });
  const temperature = { mode: 'temperature', bindings: { 'r-living': { entities: ['sensor.overlay_fahrenheit'] }, 'r-kitchen': { entities: ['sensor.overlay_absent'] } } };
  await configure(page, temperature, { 'sensor.overlay_fahrenheit': { state: '68', attributes: { unit_of_measurement: '°F' } } });
  let data = await snapshot(page);
  const living = data.rooms.find((r) => r.id === 'r-living'), mesh = data.meshes.find((m) => m.id === 'ground:r-living');
  check('Celsius temperature view converts Fahrenheit and renders a real coloured floor polygon', living?.value === 20 && mesh?.vertices >= 3 && mesh.color === living.color && mesh.connected);
  const kitchen = data.rooms.find((r) => r.id === 'r-kitchen');
  check('missing reading is grey and explicitly labelled, with a readable units legend', kitchen?.status === 'missing' && kitchen.color === '#8d9199' && kitchen.label.includes('No reading') && data.legend.includes('°C') && !data.legendHidden);
  check('only configured rooms add labels, avoiding repeated unbound-room notices', data.meshes.filter((m) => m.labelVisible).length === 2 && data.meshes.some((m) => m.id === 'ground:r-kitchen' && m.labelVisible));
  await page.screenshot({ path: path.join(shots, 'overlays-temperature-top.png'), fullPage: true });

  await configure(page, { mode: 'power', bindings: { 'r-living': { entities: ['sensor.overlay_kw'] } } },
    { 'sensor.overlay_kw': { state: '1.25', attributes: { unit_of_measurement: 'kW' } } });
  data = await snapshot(page);
  check('instantaneous kW becomes W while power and accumulated energy stay distinct', data.rooms.find((r) => r.id === 'r-living')?.value === 1250 && data.legend.includes('Power now') && data.legend.includes(' W'));
  await configure(page, { mode: 'power', bindings: { 'r-living': { entities: ['sensor.overlay_kw', 'sensor.overlay_load'] } } },
    { 'sensor.overlay_load': { state: '250', attributes: { unit_of_measurement: 'W' } } });
  data = await snapshot(page);
  check('adding multiple meters needs an explicit separate-load choice', data.rooms.find((r) => r.id === 'r-living')?.status === 'invalid' && data.rooms.find((r) => r.id === 'r-living')?.value === null);
  await configure(page, { mode: 'power', bindings: { 'r-living': { entities: ['sensor.overlay_kw', 'sensor.overlay_load'], independent_meters: true } } });
  data = await snapshot(page);
  check('confirmed separate loads sum converted readings', data.rooms.find((r) => r.id === 'r-living')?.value === 1500);

  await configure(page, { mode: 'energy', period: 'day', bindings: { 'r-living': { entities: [{ entity: 'sensor.overlay_energy', period: 'day' }] } } },
    { 'sensor.overlay_energy': { state: '2500', attributes: { unit_of_measurement: 'Wh', period: 'daily' } } });
  data = await snapshot(page);
  check('energy overlay converts Wh to kWh and labels its chosen day period', data.rooms.find((r) => r.id === 'r-living')?.value === 2.5 && data.legend.includes('Energy (day)') && data.legend.includes('kWh'));
  await configure(page, { mode: 'energy', period: 'day', bindings: { 'r-living': { entities: [{ entity: 'sensor.overlay_energy', period: 'lifetime' }] } } });
  data = await snapshot(page);
  check('conflicting sensor periods produce a labelled invalid reading instead of a misleading daily total', data.rooms.find((r) => r.id === 'r-living')?.status === 'invalid' && data.rooms.find((r) => r.id === 'r-living')?.value === null);

  const alerts = [
    { id: 'smoke-ground', entity: 'binary_sensor.smoke_hall', type: 'smoke', x: 6, y: 2, z: 1.7, floorId: 'ground', label: 'Hall smoke alarm' },
    { id: 'leak-first', entity: 'binary_sensor.overlay_leak', type: 'leak', x: 2, y: 2, z: .1, floorId: 'first', label: 'Upstairs leak' },
    { id: 'unknown-ground', entity: 'binary_sensor.overlay_unknown', type: 'leak', x: 1, y: 3, z: .1, floorId: 'ground', label: 'Leak sensor' },
  ];
  await configure(page, { mode: 'off' }, {
    'binary_sensor.smoke_hall': { state: 'on', attributes: { device_class: 'smoke' } },
    'binary_sensor.overlay_leak': { state: 'on', attributes: { device_class: 'moisture' } },
    'binary_sensor.overlay_unknown': { state: 'unavailable', attributes: { device_class: 'moisture' } },
  }, alerts);
  data = await snapshot(page);
  check('live ground-floor smoke ring is localized, with unknown data shown as a separate static grey alert', data.rings.some((a) => a.id === 'smoke-ground' && a.position.join(',') === '6,1.7,-2')
    && data.rings.some((a) => a.id === 'unknown-ground' && a.color === '#8d9199') && !data.rings.some((a) => a.id === 'leak-first'));
  const motion = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'), part = c._statusOverlays.alerts.get('smoke-ground');
    const before = part.mesh.scale.x;
    for (let i = 0; i < 4; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    return Math.abs(part.mesh.scale.x - before) > 1e-7;
  });
  check('active alert animates through the main render loop', motion);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._statusOverlays.alerts.get('smoke-ground')?.mesh.scale.x === 1);
  const staticPulse = await page.evaluate(async () => {
    const c = document.querySelector('taylors3d-card'), part = c._statusOverlays.alerts.get('smoke-ground');
    const before = [part.mesh.scale.x, part.mesh.material.opacity];
    for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    return before[0] === 1 && before[1] === .8 && part.mesh.scale.x === before[0] && part.mesh.material.opacity === before[1];
  });
  check('reduced-motion preference keeps a clear static highlight', staticPulse);
  await page.screenshot({ path: path.join(shots, 'overlays-alerts-top.png'), fullPage: true });
  await page.evaluate(() => document.querySelector('taylors3d-card')._setFloor('first'));
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._statusOverlays.alerts.has('leak-first'));
  data = await snapshot(page);
  check('switching floors hides ground alerts and uses the first-floor elevation for its leak', data.rings.length === 1 && data.rings[0].id === 'leak-first' && Math.abs(data.rings[0].position[1] - 3.1) < 1e-6);
  await configure(page, { mode: 'temperature', bindings: { 'r-kids': { entities: ['sensor.overlay_fahrenheit'] } } }, {}, alerts);
  data = await snapshot(page);
  check('first-floor room colour polygons follow resolved floor elevation and visible rooms only', data.meshes.every((m) => m.id.startsWith('first:') && Math.abs(m.y - 3.018) < 1e-6));
  await configure(page, { mode: 'off' }, { 'binary_sensor.overlay_leak': { state: 'off', attributes: { device_class: 'moisture' } } }, alerts);
  data = await snapshot(page);
  check('cleared sensors remove the affected ring and do not call any Home Assistant service', !data.rings.some((a) => a.id === 'leak-first') && data.calls === 0);
  const latched = alerts.map((a) => a.id === 'leak-first' ? { ...a, clear_rule: 'latched' } : a);
  await configure(page, { mode: 'off' }, { 'binary_sensor.overlay_leak': { state: 'on', attributes: { device_class: 'moisture' } } }, latched);
  await page.evaluate(() => document.querySelector('taylors3d-card').acknowledgeAlert('leak-first'));
  data = await snapshot(page);
  check('acknowledging a still-triggered alert keeps its warning visible', data.rings.some((a) => a.id === 'leak-first') && data.alerts.find((a) => a.id === 'leak-first')?.active);
  await configure(page, { mode: 'off' }, { 'binary_sensor.overlay_leak': { state: 'off', attributes: { device_class: 'moisture' } } }, latched);
  data = await snapshot(page);
  check('a latched alert remains after its sensor clears', data.rings.some((a) => a.id === 'leak-first') && data.alerts.find((a) => a.id === 'leak-first')?.label.includes('acknowledge'));
  await page.evaluate(() => document.querySelector('taylors3d-card').acknowledgeAlert('leak-first'));
  data = await snapshot(page);
  check('acknowledgement clears a latched alert once the sensor has cleared', !data.rings.some((a) => a.id === 'leak-first') && data.calls === 0);
  await page.evaluate(() => document.querySelector('taylors3d-card')._toggleEdit());
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._statusOverlays.group.visible);
  check('editing hides status visuals so room handles remain usable', !(await snapshot(page)).visible);
} catch (error) {
  check('room/alert scenario completes', false, error.message);
} finally {
  if (session) { browserErrors.push(...session.errors); await session.close(); }
}

session = null;
try {
  session = await openDemo({ model: '1', view: 'top', floor: 'ground' });
  const { page } = session;
  await page.waitForFunction(() => !!document.querySelector('taylors3d-card')._view.model, { timeout: 30000 });
  const binding = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); window.__demoMowerPaused = true; window.__serviceCalls = [];
    return c._roomList.find((r) => r.room.area_id === 'living_room')?.room.id;
  });
  if (!binding) throw new Error('Tagged demo living room was not resolved.');
  await configure(page, { mode: 'off' });
  await checkModelIdle(page, 'GLB with overlays off: 10 unrelated HA updates render zero frames and request zero shadows');
  await configure(page, { mode: 'temperature', bindings: { [binding]: { entities: ['sensor.living_temperature'] } } });
  await checkModelIdle(page, 'GLB with unchanged temperature overlay: 10 unrelated HA updates render zero frames and request zero shadows');
  const data = await snapshot(page), metric = data.rooms.find((r) => r.id === binding), mesh = data.meshes.find((r) => r.id.endsWith(`:${binding}`));
  check('tagged GLB room outlines share the existing coloured overlay and label renderer', metric?.status === 'ready' && metric.value === 21.4 && mesh?.vertices >= 3 && mesh.connected && mesh.color === metric.color);
  check('GLB overlay updates make no Home Assistant service calls', data.calls === 0);
  await page.screenshot({ path: path.join(shots, 'overlays-model-temperature-top.png'), fullPage: true });
} catch (error) {
  check('tagged model overlay scenario completes', false, error.message);
} finally {
  if (session) { browserErrors.push(...session.errors); await session.close(); }
}

check('no browser errors', browserErrors.length === 0, browserErrors.join('; '));
if (failures.length) { console.error(`${failures.length} overlay check(s) failed: ${failures.join('; ')}`); process.exitCode = 1; }
