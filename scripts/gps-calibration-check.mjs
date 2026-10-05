// Native GPS workflow against source and the built bundle. --preflight checks
// simulated data, pure production readers and HTTP boundaries without Chrome.
// Build the current candidate before a browser run; CHROME_PATH may be needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compileCalibration, readCoordinate } from '../src/tracked-source.js';
import catalogues from '../src/translations/tracking-calibration.js';
import { gpsEntities as entities, gpsLayoutKey, gpsSamples, gpsCalibrationLayout, gpsCalibrationReadings,
  gpsCalibrationHtml, prepareGPSCalibrationFixture, serveGPSCalibrationFixture } from './lib/gps-calibration-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), failures = [];
let scenario = 'preflight';
const check = (name, pass, detail) => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${scenario}: ${name}${detail === undefined ? '' : ' · ' + JSON.stringify(detail)}`);
  if (!pass) failures.push(`${scenario}: ${name}`);
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const closeTo = (a, b, tolerance = 1e-6) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((number, index) => Number.isFinite(number) && Math.abs(number - b[index]) <= tolerance);
const field = (name) => `[data-field="trk-${name}"]`, act = (name, index) => `[data-act="trk-${name}"]${index === undefined ? '' : `[data-index="${index}"]`}`;
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function control(page, selector, action) {
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw new Error('Missing native GPS control ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await action(element);
  } finally { await handle.dispose(); }
  await frames(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const select = (page, name, value) => control(page, field(name), (element) => element.select(value));
const type = (page, name, value, blur = true) => control(page, field(name), async (element) => {
  await element.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type(value); if (blur) await page.keyboard.press('Tab');
});
const state = (page) => page.evaluate(() => {
  const c = document.querySelector('taylors3d-card'), editor = c._edit?._trackingEditor, f = window.gpsFixture;
  return { draft: editor?.draft, pending: editor?.pendingPlanPick, stale: editor?.stale,
    saved: c._layout.vacuum_bindings, history: c._history.size, commits: f.commits.length, services: f.services.length,
    records: c._trackingData?.records, observations: f.pointerUps, floor: c._floor, drawing: c._stage.classList.contains('drawing'),
    rendererSame: c._view.renderer === f.renderer, canvases: c.shadowRoot.querySelectorAll('canvas').length,
    noTrackingTimer: !c._trackingTimer && !f.initialTrackingTimer };
});
async function settled(page) {
  await page.waitForFunction(async () => {
    const view = document.querySelector('taylors3d-card')?._view; if (!view || view._tween) return false;
    const sample = () => [...view.camera.position.toArray(), ...view.controls.target.toArray(), view.camera.zoom, view.size.w, view.size.h];
    const a = sample(); await new Promise((resolve) => requestAnimationFrame(resolve)); const b = sample();
    return a.every((value, i) => Number.isFinite(value) && Math.abs(value - b[i]) < 1e-5);
  }, { timeout: 10000, polling: 'raf' });
}
async function canvasPoint(page, variant = 0) {
  await settled(page);
  const point = await page.evaluate((variant) => {
    const c = document.querySelector('taylors3d-card'), v = c._view, canvas = v.renderer.domElement;
    const floorId = c._edit._trackingEditor.pendingPlanPick?.floorId || c._floor, box = canvas.getBoundingClientRect();
    for (let x = 0; x < 8; x++) for (let y = 0; y < 6; y++) {
      const plan = [-3.876544 + x * .817 + variant * .217, -2.765433 + y * .937 - variant * .133];
      const pixel = v.screenPoint(...plan, 0, floorId);
      if (pixel[0] < box.left + 24 || pixel[0] > box.right - 24 || pixel[1] < box.top + 24 || pixel[1] > box.bottom - 24) continue;
      if (c.shadowRoot.elementFromPoint(...pixel) !== canvas) continue;
      const actual = v.planPoint(...pixel, v.floorElevation(floorId));
      if (actual?.length === 2 && actual.every(Number.isFinite)) return { pixel, plan: actual, floorId };
    }
    return null;
  }, variant);
  if (!point) throw new Error('No exposed drawn-plan point on the exact capture floor'); return point;
}
async function editor(page) {
  if (!await page.evaluate(() => document.querySelector('taylors3d-card')._editing)) await click(page, '[data-bubble="edit"]');
  if (await page.evaluate(() => document.querySelector('taylors3d-card')._edit.tab) !== 'tracking') await click(page, '[data-act="tab"][data-id="tracking"]');
  await click(page, '[data-act="trk-section"][data-section="vacuums"]');
}
async function reopen(page, index, editable = true) {
  const before = await state(page);
  await page.evaluate(() => { window.gpsFixture.previousDraft = document.querySelector('taylors3d-card')._edit?._trackingEditor?.draft; });
  if (before.draft) {
    await click(page, act('cancel')); const cancelled = await state(page);
    assert(!cancelled.draft && !cancelled.pending && !cancelled.drawing, 'Fresh native Cancel must discard the previous draft and its plan pick');
    assert(equal(cancelled.saved, before.saved) && cancelled.commits === before.commits && cancelled.history === before.history
      && cancelled.services === before.services, 'Native Cancel must leave saved bindings, history and device actions unchanged');
  }
  await editor(page); await click(page, act('edit', index));
  const opened = await page.evaluate((index) => {
    const c = document.querySelector('taylors3d-card'), e = c._edit?._trackingEditor;
    return { current: e?.draft !== window.gpsFixture.previousDraft && e?.editingIndex === index
      && e?.draft?.id === c._layout.vacuum_bindings[index]?.id && e?.section === 'vacuums' && e?.stale === false,
      index: e?.editingIndex, id: e?.draft?.id, stale: e?.stale };
  }, index);
  assert(opened.current, 'Native Edit must open the exact fresh saved binding: ' + JSON.stringify(opened));
  if (editable && await page.evaluate(() => !!document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-act="trk-cal-edit-gps"]'))) await click(page, act('cal-edit-gps'));
  if (editable) await control(page, act('save'), async (button) => {
    assert(await button.evaluate((node) => !node.matches(':disabled')), 'Fresh native GPS Save must be enabled before testing a held gesture');
  });
}
async function newGPS(page) {
  await click(page, act('add')); await select(page, 'kind', 'xy'); await select(page, 'entity', entities.robot);
  await select(page, 'location-mode', 'position'); await type(page, 'x', '0'); await type(page, 'y', '0');
  await type(page, 'z', '.05'); await select(page, 'floor', 'ground');
  await select(page, 'cal-source', 'gps'); await select(page, 'cal-entity', entities.position);
  await select(page, 'cal-latitude_attr', 'measured.latitude'); await select(page, 'cal-longitude_attr', 'measured.longitude');
  await select(page, 'cal-floorId', 'ground'); await type(page, 'label', 'User_GPS_<b>été');
}
async function capture(page, raw, variant) {
  await page.evaluate((raw) => window.gpsFixture.reading(raw), raw); await frames(page); await click(page, act('cal-capture'));
  const before = await state(page), point = await canvasPoint(page, variant);
  assert(before.pending, 'Native capture must produce a token before the canvas click');
  await page.evaluate((raw) => window.gpsFixture.reading([raw[0] + .000003, raw[1] + .000002]), raw);
  await page.mouse.click(...point.pixel); await frames(page);
  const after = await state(page), pair = after.draft?.position_source?.calibration?.at(-1), observation = after.observations.at(-1);
  check('native plan click uses the frozen real source pair and exact unsnapped plan point', closeTo(pair?.src, raw)
    && closeTo(pair?.plan, observation?.plan) && observation?.token === before.pending.token && !after.pending
    && pair.plan.some((value) => Math.abs(value / .05 - Math.round(value / .05)) > 1e-3), { pair, observation });
  return pair;
}
async function creation(page) {
  await newGPS(page); let current = await state(page);
  const paths = await page.evaluate(() => [...document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="trk-cal-latitude_attr"]').options].map((o) => o.value));
  check('new GPS is a draft with explicit actual attribute paths and no invented north-up policy', current.saved.length === 2 && current.commits === 0
    && current.draft.position_source.source === 'gps' && current.draft.position_source.latitude_attr === 'measured.latitude'
    && current.draft.position_source.longitude_attr === 'measured.longitude' && current.draft.position_source.north_up === undefined
    && paths.includes('measured.latitude') && paths.includes('numeric_extra') && !paths.includes('fake_latitude') && !paths.includes('latitude_hint'));
  await capture(page, gpsSamples[0], 0); await click(page, act('save')); current = await state(page);
  check('one new GPS pair cannot save a mapping', current.commits === 0 && current.saved.length === 2 && !!current.draft);
  await capture(page, gpsSamples[1], 1); current = await state(page); const source = current.draft.position_source;
  await page.evaluate((raw) => window.gpsFixture.reading(raw), gpsSamples[2]); await frames(page);
  await click(page, act('save')); current = await state(page);
  const record = current.records?.find((r) => r.entity === entities.robot), expected = compileCalibration(source).transform(gpsSamples[2]);
  const midpoint = [0, 1].map((axis) => (source.calibration[0].plan[axis] + source.calibration[1].plan[axis]) / 2);
  check('Save once preserves the two pairs in one history step and runtime shows the measured midpoint', current.commits === 1 && current.history === 1
    && current.saved.length === 3 && equal(current.saved[2].position_source, source) && record?.measured
    && closeTo([record.location.x, record.location.y], expected) && closeTo([record.location.x, record.location.y], midpoint)
    && record.location.floorId === 'ground' && current.services === 0, record);
  await click(page, '[data-act="history-undo"]'); current = await state(page);
  check('native Undo removes the one new binding', current.saved.length === 2 && current.services === 0);
  await click(page, '[data-act="history-redo"]'); current = await state(page);
  check('native Redo restores the exact GPS source', equal(current.saved[2].position_source, source) && current.services === 0);
  await reopen(page, 2); await type(page, 'label', 'Cancelled GPS label'); await click(page, act('cancel')); current = await state(page);
  check('Cancel changes neither saved GPS pairs nor history', equal(current.saved[2].position_source, source) && current.saved[2].label === 'User_GPS_<b>été' && current.history === 1 && current.commits === 1);
}
async function importedAndRepair(page, original) {
  await reopen(page, 0, false); let current = await state(page);
  check('imported one-point north-up policy is shown with every raw option intact', equal(current.draft.position_source, original[0].position_source)
    && await page.evaluate(() => !document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="trk-cal-source"]')));
  await click(page, act('cal-edit-gps')); current = await state(page);
  check('opening explicit GPS editing does not write default attribute paths or normalize legacy options', equal(current.draft.position_source, original[0].position_source));
  await select(page, 'cal-latitude_attr', 'measured.latitude'); current = await state(page);
  check('only deliberate path edit changes that path while preserving north-up, legacy units and pair annotations', current.draft.position_source.latitude_attr === 'measured.latitude'
    && current.draft.position_source.north_up === true && current.draft.position_source.units === original[0].position_source.units
    && equal(current.draft.position_source.calibration, original[0].position_source.calibration));
  await click(page, act('cancel')); current = await state(page);
  check('Cancel preserves the complete imported GPS source', equal(current.saved[0].position_source, original[0].position_source) && current.commits === 1);
  await reopen(page, 1, false);
  check('missing exact source and floor are retained as unavailable choices', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), e = c._edit._trackingEditor;
    return e.draft.position_source.entity === 'sensor.gps_removed' && e.draft.position_source.floorId === 'removed-floor'
      && c.shadowRoot.querySelector('[data-trk-cal-fieldset]').disabled;
  }));
  await click(page, act('relink')); await click(page, act('cal-edit-gps'));
  check('deliberate repair exposes the exact missing floor warning', await page.evaluate(() => {
    const select = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="trk-cal-floorId"]');
    return select.value === 'removed-floor' && [...select.options].some((o) => o.value === 'removed-floor' && o.disabled);
  }));
  await select(page, 'cal-entity', entities.replacement); await select(page, 'cal-floorId', 'upper'); await click(page, act('save')); current = await state(page);
  check('source and floor repair requires deliberate same-frame confirmation', current.commits === 1 && equal(current.saved[1], original[1]));
  await click(page, act('cal-confirm')); await click(page, act('save')); current = await state(page);
  const expected = { ...original[1].position_source, entity: entities.replacement, floorId: 'upper' };
  check('repair saves exact chosen links and retains raw pairs and unknown extras', equal(current.saved[1].position_source, expected)
    && equal(current.saved[1].future_binding, original[1].future_binding) && current.commits === 2 && current.history === 2 && current.services === 0);
}
async function holdSave(page, loss, gesture) {
  await reopen(page, 2); await type(page, 'label', `Held ${loss} ${gesture}`); const before = await state(page);
  assert(before.draft?.label === `Held ${loss} ${gesture}` && before.stale === false,
    'The intended current GPS draft must accept native typing before the held Save');
  await control(page, act('save'), async (button) => {
    assert(await button.evaluate((node) => !node.matches(':disabled')), 'The native Save must still be enabled at press time');
    await button.focus(); await button.evaluate((node) => { window.gpsFixture.heldNode = node; });
    if (gesture === 'pointer') {
      const box = await button.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.evaluate((loss) => window.gpsFixture.pulse(loss), loss); await page.mouse.up();
    } else if (gesture === 'Space') {
      await page.keyboard.down('Space'); await page.evaluate((loss) => window.gpsFixture.pulse(loss), loss); await page.keyboard.up('Space');
    } else {
      // Enter's native click happens during keydown. Deliver actual HA updates
      // after production capture listeners and before the browser default click.
      await button.evaluate((node, loss) => node.addEventListener('keydown', () => window.gpsFixture.pulse(loss), { once: true }), loss);
      await page.keyboard.press('Enter');
    }
  });
  const after = await state(page);
  check(`${loss} loss/recovery rejects native ${gesture} Save`, after.commits === before.commits && equal(after.saved, before.saved) && after.services === 0);
  if (loss !== 'floor') check('passive updates retain the pressed native Save node', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); return c.shadowRoot.querySelector('[data-act="trk-save"]') === window.gpsFixture.heldNode;
  }));
}
async function planFences(page) {
  for (const loss of ['role', 'session', 'connection', 'source', 'floor']) {
    await reopen(page, 2); await page.evaluate((raw) => window.gpsFixture.reading(raw), gpsSamples[0]); await frames(page);
    const captureReady = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), e = c._edit?._trackingEditor, calibration = e?.calibration;
      return { enabled: !!c.shadowRoot.querySelector('[data-act="trk-cal-capture"]')?.matches(':enabled'),
        stale: e?.stale, frame: calibration?.frame, changedContext: calibration?.changedContext, changedKind: calibration?.changedKind,
        evidence: calibration?.evidence(), floor: c._floor, floorOnly: c._floorOnly, sourceFloor: e?.draft?.position_source?.floorId };
    });
    assert(captureReady.enabled && captureReady.stale === false && captureReady.frame === 'calibrated'
      && !captureReady.changedContext && !captureReady.changedKind && captureReady.evidence?.status === 'ready',
    'Fresh native capture must be enabled before testing the plan fence: ' + JSON.stringify(captureReady));
    await click(page, act('cal-capture')); const before = await state(page);
    assert(before.pending && closeTo(before.pending.raw, gpsSamples[0]) && before.pending.floorId === before.draft.position_source.floorId,
      'Capture the exact actual GPS source and floor before testing the stale plan fence: ' + JSON.stringify(before));
    const point = await canvasPoint(page, 3);
    await page.mouse.move(...point.pixel); await page.mouse.down(); await page.evaluate((loss) => window.gpsFixture.pulse(loss), loss);
    await page.mouse.up(); await frames(page); const after = await state(page);
    check(`${loss} loss/recovery rejects the held native plan click`, !after.pending && !after.drawing
      && equal(after.saved, before.saved) && after.commits === before.commits && after.services === 0
      && (!after.draft || equal(after.draft.position_source.calibration, before.draft.position_source.calibration)));
  }
  if ((await state(page)).draft) await click(page, act('cancel'));
}
async function localizationAndSize(page, mode) {
  await reopen(page, 2); await type(page, 'label', 'User_Locale_<b>été', false);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); window.gpsFixture.focused = c.shadowRoot.activeElement;
    window.gpsFixture.pathSelect = c.shadowRoot.querySelector('[data-field="trk-cal-latitude_attr"]'); });
  const before = await state(page);
  for (const language of ['de', 'fr', 'es', 'en']) {
    await page.evaluate((language) => window.gpsFixture.locale(language), language); await frames(page);
    const captions = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), f = window.gpsFixture;
      return { focused: c.shadowRoot.activeElement === f.focused && f.focused.value === 'User_Locale_<b>été',
        sameSelect: c.shadowRoot.querySelector('[data-field="trk-cal-latitude_attr"]') === f.pathSelect,
        label: c.shadowRoot.querySelector('[data-cal-caption="latitude"]')?.textContent,
        path: f.pathSelect.value, raw: c._edit._trackingEditor.draft.label };
    });
    check(`${language} native captions update while exact user text, attribute path and focus survive`, captions.focused && captions.sameSelect
      && captions.label === catalogues[language]['edit.tracking.calibration.latitude'] && captions.path === 'measured.latitude' && captions.raw === 'User_Locale_<b>été', captions);
  }
  await page.evaluate(() => { const f = window.gpsFixture, c = document.querySelector('taylors3d-card');
    c.hass = { ...c._hass, states: { ...c._hass.states, [f.entities.unrelated]: { ...c._hass.states[f.entities.unrelated], state: '2' } } }; });
  await frames(page);
  check('unrelated readings preserve focused native label and GPS draft without commits', (await state(page)).commits === before.commits
    && await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.activeElement === window.gpsFixture.focused));
  await page.setViewport({ width: 320, height: 1000, deviceScaleFactor: 1 }); await frames(page);
  const narrow = await page.evaluate(() => {
    const form = document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-trk-editor]');
    return { overflow: document.documentElement.scrollWidth > innerWidth, controls: [...form.querySelectorAll('input,select,button')]
      .filter((node) => node.getClientRects().length).map((node) => ({ field: node.dataset.field || node.dataset.act, height: node.getBoundingClientRect().height })) };
  });
  check('320px native GPS controls fit and expose 44px targets', !narrow.overflow && narrow.controls.length > 10 && narrow.controls.every((c) => c.height >= 44), narrow);
  if (process.argv.includes('--screenshots')) { const shots = path.join(root, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, `gps-calibration-${mode}-320.png`), fullPage: true }); }
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 }); await frames(page); await click(page, act('cancel'));
}
async function preflight() {
  const layout = gpsCalibrationLayout(), readings = gpsCalibrationReadings(), source = layout.vacuum_bindings[0].position_source;
  check('fixture defines drawn exact floors and explicitly missing repair IDs', layout.rooms.length === 2 && layout.floors.length === 2
    && !layout.floors.some((f) => f.id === 'removed-floor') && !readings['sensor.gps_removed']);
  const raw = readCoordinate(readings[entities.position], { source: 'gps', latitude_attr: 'measured.latitude', longitude_attr: 'measured.longitude' });
  check('production GPS reader accepts exact reported nested paths', raw.status === 'ready' && closeTo(raw.raw, gpsSamples[0]), raw);
  check('production reader rejects nonnumeric guessed paths', readCoordinate(readings[entities.position], { source: 'gps', latitude_attr: 'fake_latitude', longitude_attr: 'latitude_hint' }).status !== 'ready');
  const imported = compileCalibration(source);
  check('imported explicit north-up one-point GPS mapping is valid without normalizing extras', imported.status === 'ready' && imported.method === 'translation'
    && closeTo(imported.transform(gpsSamples[0]), [-2, 1]) && !Object.hasOwn(source, 'latitude_attr') && source.units === 'legacy-imported-unit');
  const fitted = compileCalibration({ source: 'gps', calibration: [{ src: gpsSamples[0], plan: [1.123456, -2.987654] },
    { src: gpsSamples[1], plan: [1.123456, -1.987654] }] });
  check('production GPS similarity mapping yields the measured midpoint with no north-up guess', fitted.status === 'ready' && fitted.method === 'similarity'
    && closeTo(fitted.transform(gpsSamples[2]), [1.123456, -2.487654]));
  for (const language of ['en', 'de', 'fr', 'es']) check(`${language} has all explicit GPS translation keys`, Object.keys(catalogues[language]).length === 17
    && Object.values(catalogues[language]).every((value) => typeof value === 'string' && value.length > 0));
  for (const mode of ['source', 'bundle']) {
    const html = gpsCalibrationHtml(mode), server = await serveGPSCalibrationFixture(root, mode);
    try {
      const response = await fetch(server.base + '/demo/gps-calibration-fixture.html'), document = await response.text();
      check(`${mode} HTTP page loads exactly its selected real implementation`, response.status === 200 && document === html
        && document.includes(`await import('/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js')`) && (document.match(/<taylors3d-card>/g) || []).length === 1);
      const furniture = await fetch(server.base + '/api/taylors3d/furniture');
      check(`${mode} simulated read-only furniture boundary is explicit`, equal(await furniture.json(), { version: 1, packs: [] }));
      check(`${mode} fixture setup substitutes no production editor or renderer`, !prepareGPSCalibrationFixture.toString().includes('new WebGLRenderer')
        && !prepareGPSCalibrationFixture.toString().includes('acceptPlanPoint') && !prepareGPSCalibrationFixture.toString().includes('setInterval'));
      check(`${mode} server received only registered local GET routes`, server.unexpected.length === 0 && server.requests.every((r) => r.method === 'GET'));
    } finally { await server.close(); }
  }
  console.log('Preflight only: Chrome, native controls, bundle freshness and household HA have NOT been verified.');
}
async function browserProof() {
  // Deferred import ensures --preflight never initializes Puppeteer or Chrome.
  const { launch, newPage } = await import('./lib/demo-browser.mjs'), modes = process.argv.includes('--source-only')
    ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
  for (const mode of modes) {
    scenario = mode; let transport, fixture, session;
    try {
      fixture = await serveGPSCalibrationFixture(root, mode); transport = await launch(); session = await newPage(transport.browser, { width: 1280, height: 1000 });
      const { page } = session; await page.goto(fixture.base + '/demo/gps-calibration-fixture.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.gpsModuleReady, { timeout: 15000 });
      await page.evaluate(prepareGPSCalibrationFixture, { layout: fixture.layout, readings: fixture.readings, entities, key: gpsLayoutKey });
      await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return c._view?.stats.frames > 0 && c._roomList?.length === 2; }, { timeout: 15000 });
      const urls = fixture.requests.map((request) => request.path);
      check('fixture loads only the selected source or bundle', mode === 'source' ? urls.includes('/src/tracking-calibration.js') && urls.includes('/src/tracking-editor.js') && !urls.includes('/dist/taylors3d-card.js')
        : urls.includes('/dist/taylors3d-card.js') && !urls.some((url) => url.startsWith('/src/')));
      await editor(page); await creation(page); await importedAndRepair(page, fixture.layout.vacuum_bindings);
      for (const loss of ['role', 'session', 'connection', 'source', 'floor']) for (const gesture of ['pointer', 'Space', 'Enter']) await holdSave(page, loss, gesture);
      await planFences(page); await localizationAndSize(page, mode); const final = await state(page);
      check('all calibration work reuses one renderer, adds no expiry timer and sends no device action', final.rendererSame && final.canvases === 1 && final.noTrackingTimer && final.services === 0);
      check('no unexpected local requests or browser errors', fixture.unexpected.length === 0 && session.errors.length === 0, { requests: fixture.unexpected, errors: session.errors });
    } catch (error) { check('native GPS scenario completes', false, error.stack || error.message); }
    finally {
      if (session) { await session.page.evaluate(() => document.querySelector('taylors3d-card')?.remove()).catch(() => {}); await session.page.close(); }
      if (transport) await transport.close(); if (fixture) await fixture.close();
    }
  }
}
if (process.argv.includes('--preflight')) await preflight(); else await browserProof();
if (failures.length) process.exitCode = 1;
