// Real Chrome navigation and guided setup, against source and bundle. Transport,
// model storage and HA facts are explicit simulations; no household is contacted.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { prepareRoomActionsFixture, serveRoomActionsFixture, roomActionEntities, roomActionLayoutKey, roomActionIds } from './lib/room-actions-fixture.mjs';

const results = [], browserErrors = [], receipts = [];
const selectedMode = process.env.EDITOR_NAVIGATION_MODE;
if (selectedMode !== undefined && !['source', 'bundle'].includes(selectedMode)) throw Error('EDITOR_NAVIGATION_MODE must be source or bundle');
let mode = '', operation = 'initialization';
const check = (name, passed, detail) => { results.push(!!passed); console.log(`${passed ? 'ok  ' : 'FAIL'} ${mode} ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const action = (name, id) => `[data-act="${name}"]${id === undefined ? '' : `[data-id="${id}"]`}`;
async function control(page, selector, run) {
  operation = selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw Error('Missing native control ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await page.waitForFunction((node) => { const rect = node.getBoundingClientRect(), shadow = document.querySelector('taylors3d-card').shadowRoot;
      const hit = shadow.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return node.isConnected && rect.width > 0 && rect.height > 0 && (hit === node || node.contains(hit)); }, { timeout: 10000 }, element);
    await run(element);
  } finally { await handle.dispose(); }
  await frames(page);
}
const click = (page, selector) => control(page, selector, (node) => node.click());
const keyboard = (page, selector, key = 'Enter') => control(page, selector, async (node) => { await node.focus(); await page.keyboard.press(key); });
const select = (page, selector, value) => control(page, selector, async (node) => { await node.focus(); await node.select(value); });
const snapshot = (page) => page.evaluate(() => {
  const card = document.querySelector('taylors3d-card'), fixture = window.roomActionsFixture;
  return { editing: card._editing, tab: card._edit?.tab, setup: card._edit?.setupSnapshot(), notice: card._edit?._navigation?.notice,
    calls: fixture.calls.length, commits: fixture.commits, writes: fixture.ws.filter((message) => message.type === 'taylors3d/layout/set').length,
    saved: structuredClone(fixture.saved), layout: structuredClone(card._layout), model: !!card._view?.model, uploadPosts: fixture.uploadPosts || 0,
    renderer: card._view?.renderer === fixture.renderer, groups: [...card.shadowRoot.querySelectorAll('.editor-groups button')].map((node) => ({ id: node.dataset.id, label: node.textContent, selected: node.getAttribute('aria-pressed') })),
    visibleTabs: [...card.shadowRoot.querySelectorAll('.tabs button')].filter((node) => node.getClientRects().length && !node.closest('details:not([open])')).map((node) => node.dataset.id) };
});
async function geometry(page, name) {
  const data = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), panel = card._edit.panel;
    const controls = [...panel.querySelectorAll('[data-editor-navigation] button,[data-editor-navigation] select,[data-editor-advanced] button,[data-editor-advanced] summary,[data-editor-setup] button,[data-editor-setup] a,[data-setup-upload]')]
      .filter((node) => node.getClientRects().length && (!node.closest('details:not([open])') || node.tagName === 'SUMMARY'));
    return { width: innerWidth, document: document.documentElement.scrollWidth, panelWidth: panel.clientWidth, panelScroll: panel.scrollWidth,
      controls: controls.length, tooSmall: controls.filter((node) => { const rect = node.getBoundingClientRect(); return rect.width < 43.9 || rect.height < 43.9; }).map((node) => ({ id: node.dataset.act || node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
      labels: controls.every((node) => node.scrollWidth <= node.clientWidth + 1), focusVisible: !!panel.querySelector(':focus-visible'),
      sceneHeight: card._scene.getBoundingClientRect().height, panelHeight: panel.getBoundingClientRect().height,
      bodyHeight: panel.querySelector('.tab-body')?.getBoundingClientRect().height, navigationHeight: panel.querySelector('[data-editor-navigation]')?.getBoundingClientRect().height,
      historyHeight: panel.querySelector('.history-controls')?.getBoundingClientRect().height, footHeight: panel.querySelector('.foot')?.getBoundingClientRect().height };
  });
  check(`${name}: no horizontal overflow, readable labels and 44px native controls`, data.document <= data.width + 1 && data.panelScroll <= data.panelWidth + 1 && data.controls > 0 && !data.tooSmall.length && data.labels, data);
  if (name.includes('shallow')) check(`${name}: useful editing body keeps at least240px while retaining at least240px scene`, data.bodyHeight >= 239.9 && data.sceneHeight >= 239.9, data);
}
const ready = (page) => page.waitForFunction(() => {
  const card = document.querySelector('taylors3d-card'); return !!card?._layout && !card._loading && !card._customControlsModelLoad && card._edit;
}, { timeout: 30000 });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const chrome = await launch();
try {
  for (mode of selectedMode ? [selectedMode] : ['source', 'bundle']) {
    const fixture = await serveRoomActionsFixture(root, mode);
    const { page, errors } = await newPage(chrome.browser, { width: 1400, height: 1100 }); const expectedSaveErrors = [];
    try {
      await page.goto(`${fixture.base}/demo/room-actions-fixture.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.roomActionsModuleReady === true);
      await page.evaluate(prepareRoomActionsFixture, { layout: fixture.layout, readings: fixture.readings, entities: roomActionEntities, key: roomActionLayoutKey }); await ready(page);
      await click(page, '[data-bubble="edit"]'); const before = await snapshot(page);
      check('existing house stays in ordinary editing until setup is deliberately requested', !before.setup.wizard && before.tab === 'rooms' && before.groups.length === 5, before.groups);
      await keyboard(page, action('editor-group', 'devices'), 'Space'); let state = await snapshot(page);
      check('keyboard selects Devices and only its basic choices', state.tab === 'devices' && equal(state.visibleTabs, ['devices', 'objects']), state.visibleTabs);
      await keyboard(page, '[data-editor-advanced] summary', 'Space');
      check('native Advanced disclosure exposes the specialist choices', (await snapshot(page)).visibleTabs.includes('tracking'));
      await keyboard(page, action('tab', 'tracking')); state = await snapshot(page);
      check('advanced Tracking still opens the actual feature editor', state.tab === 'tracking' && await page.evaluate(() => !!document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-trk-editor]')));
      await geometry(page, 'wide grouped editor');
      await page.setViewport({ width: 320, height: 900, deviceScaleFactor: 1 }); await frames(page);
      await select(page, '[data-field="editor-group"]', 'controls'); await geometry(page, '320px grouped editor');
      await page.setViewport({ width: 320, height: 480, deviceScaleFactor: 1 });
      await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card.setConfig({ ...card._config, height: '320px' }); }); await frames(page);
      await geometry(page, '320px shallow editor');
      for (const group of ['house', 'devices', 'controls', 'appearance', 'data']) {
        await select(page, '[data-field="editor-group"]', group); await geometry(page, `320px shallow ${group} section`);
        if (['devices', 'appearance'].includes(group)) {
          const open = await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-editor-advanced]').open);
          if (!open) await keyboard(page, '[data-editor-advanced] summary', 'Space');
          await geometry(page, `320px shallow ${group} expanded Advanced`);
        }
      }
      await select(page, '[data-field="editor-group"]', 'controls');
      await page.setViewport({ width: 320, height: 900, deviceScaleFactor: 1 });
      await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card.setConfig({ ...card._config, height: '900px' }); }); await frames(page);
      const quiet = await snapshot(page);
      check('group and disclosure navigation never calls devices or writes the layout', quiet.calls === before.calls && quiet.commits === before.commits && quiet.writes === before.writes && quiet.renderer);

      // First-run layout: use the real root commit/model-loader, not fake DOM.
      await click(page, '[data-bubble="edit"]'); await page.evaluate(() => {
        const card = document.querySelector('taylors3d-card'), fixture = window.roomActionsFixture;
        card._commit({ version: 1, rooms: [], pins: {}, unknown: { preserved: ['first-run'] }, model: null }); card.resetHistory();
        const original = card._hass.fetchWithAuth; fixture.uploadPosts = 0;
        card.hass = { ...card._hass, fetchWithAuth: async (url, options) => {
          if (options?.method === 'POST' && url.includes('/api/taylors3d/model/')) {
            fixture.uploadPosts++; const file = options.body.get('file'), bytes = await file.arrayBuffer();
            const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
            if (String.fromCharCode(...header.slice(0, 4)) !== 'glTF' || header[4] !== 2) return new Response(JSON.stringify({ message: 'Simulated invalid GLB' }), { status: 400 });
            return new Response(JSON.stringify({ version: 'guided-native', name: file.name, size: bytes.byteLength }), { status: 200 });
          }
          return original(url, options);
        } };
      }); await ready(page); await frames(page);
      await click(page, '[data-bubble="edit"]'); state = await snapshot(page);
      check('first setup automatically opens the actual GLB upload workflow', state.setup.wizard && state.setup.step === 0 && state.tab === 'model' && !state.setup.modelReady);
      check('Continue cannot claim a missing house is ready', await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-act="setup-next"]').disabled));
      await geometry(page, '320px first setup');
      await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); window.roomActionsFixture.setupAreas = card._hass.areas; card.hass = { ...card._hass, areas: {} }; });
      await keyboard(page, action('setup-draw-instead')); state = await snapshot(page);
      check('missing HA areas give a real repair route and cannot count as linked rooms', state.setup.step === 1 && !state.setup.roomsReady
        && await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-editor-setup] a')?.getAttribute('href') === '/config/areas/dashboard'
          && document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-act="setup-next"]').disabled));
      await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card.hass = { ...card._hass, areas: window.roomActionsFixture.setupAreas }; });
      await keyboard(page, action('setup-step', '0'));
      const file = path.join(root, 'screenshots', 'editor-navigation-simulated.glb'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, fixture.model);
      const invalidFile = path.join(root, 'screenshots', 'editor-navigation-invalid.glb'); fs.writeFileSync(invalidFile, 'Explicit invalid fixture bytes');
      const invalidChooserWait = page.waitForFileChooser(); await keyboard(page, '[data-setup-upload]', 'Enter'); const invalidChooser = await invalidChooserWait; await invalidChooser.accept([invalidFile]);
      await page.waitForFunction(() => { const card = document.querySelector('taylors3d-card'); return !card._edit.uploading && !!card._edit.message?.error; }, { timeout: 10000 }); state = await snapshot(page);
      check('a rejected GLB leaves an honest error and permits another native file choice', !state.model && !state.setup.modelReady && state.uploadPosts === 1
        && await page.evaluate(() => document.querySelector('taylors3d-card')._edit.message.text === 'Simulated invalid GLB'));
      const uploadBefore = state.uploadPosts;
      operation = 'keyboard file upload'; const chooserWait = page.waitForFileChooser(); await keyboard(page, '[data-setup-upload]', 'Enter');
      const chooser = await chooserWait; await chooser.accept([file]);
      await page.waitForFunction(() => document.querySelector('taylors3d-card')._view?.model && !document.querySelector('taylors3d-card')._customControlsModelLoad, { timeout: 30000 }); await ready(page);
      state = await snapshot(page); check('native keyboard file choice uploads one real GLB and loads actual geometry', state.model && state.uploadPosts === uploadBefore + 1 && state.layout.model.name === 'editor-navigation-simulated.glb' && state.setup.modelReady);
      await keyboard(page, action('setup-next')); state = await snapshot(page);
      check('room step uses the real model floor and area pickers', state.setup.step === 1 && state.tab === 'model'
        && await page.evaluate(() => !!document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="md-level"]') && !!document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-field="md-room"]')));
      await select(page, `[data-field="md-level"][data-id="${roomActionIds.ground}"]`, 'floor:ground');
      await select(page, `[data-field="md-level"][data-id="${roomActionIds.upper}"]`, 'floor:upper');
      await select(page, `[data-field="md-room"][data-id="${roomActionIds.groundRoom}"]`, 'simulated-ground');
      await select(page, `[data-field="md-room"][data-id="${roomActionIds.upperRoom}"]`, 'simulated-upper'); await frames(page);
      state = await snapshot(page); check('deliberate current floor and room selections are saved without inferred links', state.layout.model.levels[roomActionIds.ground]?.floor === 'ground'
        && state.layout.model.levels[roomActionIds.upper]?.floor === 'upper' && state.layout.model.rooms[roomActionIds.upperRoom]?.area === 'simulated-upper' && state.setup.roomsReady, { rooms: state.setup.roomCount });
      const deliberateLayout = JSON.stringify(state.layout), deliberateCommits = state.commits;
      await page.evaluate(() => {
        const card = document.querySelector('taylors3d-card'), original = card.modelBindings; window.roomActionsFixture.setupModelBindings = original;
        card.modelBindings = () => { const value = original.call(card); return { ...value,
          rooms: Object.fromEntries(Object.entries(value.rooms).map(([id, row]) => [id, { ...row, auto: true }])),
          levels: Object.fromEntries(Object.entries(value.levels).map(([id, row]) => [id, { ...row, auto: true }])) }; };
      });
      state = await snapshot(page);
      check('guided progress rejects inferred model floor/area suggestions without changing the actual linked layout', !state.setup.roomsReady
        && JSON.stringify(state.layout) === deliberateLayout && state.commits === deliberateCommits);
      await page.evaluate(() => { document.querySelector('taylors3d-card').modelBindings = window.roomActionsFixture.setupModelBindings; });
      await keyboard(page, action('setup-next')); state = await snapshot(page);
      check('controls step opens the actual visual button builder', state.setup.step === 2 && state.tab === 'controls');
      await click(page, action('custom-controls-add-bar')); state = await snapshot(page);
      check('an open draft prevents step changes and finish', state.setup.draftsOpen && !state.setup.canFinish
        && await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-act="setup-next"]').disabled));
      await keyboard(page, action('setup-step', '3')); state = await snapshot(page);
      check('attempted forward step preserves the unsaved button draft', state.setup.step === 2 && state.notice === 'drafts'
        && await page.evaluate(() => document.querySelector('taylors3d-card')._edit._customControlsEditor.dirty));
      await click(page, action('custom-controls-cancel')); await keyboard(page, action('setup-controls-later')); state = await snapshot(page);
      check('explicit Add controls later reaches an honest final save summary', state.setup.step === 3 && state.tab === 'setup' && state.setup.canFinish);
      await geometry(page, '320px final setup');
      const saveBefore = await snapshot(page); await keyboard(page, action('setup-save'));
      await page.waitForFunction(() => document.querySelector('taylors3d-card')._editing === false, { timeout: 10000 }); state = await snapshot(page);
      check('final Save persists setup once and returns through normal Edit exit', state.saved.ui_setup?.complete === true && state.layout.ui_setup?.complete === true
        && state.commits === saveBefore.commits + 1 && state.writes === saveBefore.writes + 1 && !state.editing && state.renderer, { writes: state.writes - saveBefore.writes, commits: state.commits - saveBefore.commits });
      check('wizard never operates devices and preserves imported extra fields', state.calls === 0 && equal(state.layout.unknown, { preserved: ['first-run'] }));
      await click(page, '[data-bubble="edit"]'); state = await snapshot(page);
      check('a completed setup reopens ordinary editing without restarting the guide', !state.setup.wizard); await keyboard(page, action('setup-start'));
      check('existing house can deliberately continue its setup', (await snapshot(page)).setup.wizard); await keyboard(page, action('setup-edit-existing'));
      check('Edit existing exits guidance without removing the house or links', !(await snapshot(page)).setup.wizard && (await snapshot(page)).model);

      // Current transport rejection must preserve work and enable a fresh retry.
      const errorsBeforeFailure = errors.length;
      await keyboard(page, action('setup-start')); await page.evaluate(() => {
        const card = document.querySelector('taylors3d-card'), fixture = window.roomActionsFixture; fixture.normalSetupWS = card._hass.callWS;
        card.hass = { ...card._hass, callWS: async (message) => { if (message.type === 'taylors3d/layout/set') throw Error('Simulated setup save unavailable'); return fixture.normalSetupWS(message); } };
      }); await keyboard(page, action('setup-save'));
      await page.waitForFunction(() => document.querySelector('taylors3d-card')._edit._navigation.notice === 'failed', { timeout: 10000 }); state = await snapshot(page);
      check('failed final save keeps the house in Edit with a readable retry state', state.editing && state.model && state.notice === 'failed' && !state.setup.saveBusy);
      const injectedErrors = errors.slice(errorsBeforeFailure);
      check('the deliberate rejected save emits only its expected storage error', injectedErrors.length === 1 && injectedErrors[0].startsWith('error: taylors3d: save failed'), injectedErrors);
      if (injectedErrors.length === 1 && injectedErrors[0].startsWith('error: taylors3d: save failed')) expectedSaveErrors.push(...errors.splice(errorsBeforeFailure));
      await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card.hass = { ...card._hass, callWS: window.roomActionsFixture.normalSetupWS }; });
      await keyboard(page, action('setup-save')); await page.waitForFunction(() => document.querySelector('taylors3d-card')._editing === false, { timeout: 10000 });
      check('fresh Save retries successfully after transport recovery', !(await snapshot(page)).editing);
      await click(page, '[data-bubble="edit"]'); await keyboard(page, action('setup-start'));
      await control(page, action('setup-save'), async (node) => {
        await node.focus(); await page.keyboard.down('Space');
        await page.evaluate(() => { const card = document.querySelector('taylors3d-card'), fixture = window.roomActionsFixture;
          card.hass = { ...card._hass, user: { ...fixture.user, is_admin: false } }; card.hass = { ...card._hass, user: fixture.user }; });
        await page.keyboard.up('Space');
      }); state = await snapshot(page);
      check('held Save across permission loss/recovery cannot regain authority', state.editing && state.setup.wizard);
      await geometry(page, 'keyboard recovered setup');
      fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'screenshots', `editor-navigation-${mode}-phone.png`), fullPage: true });
      check('source/bundle browser has no errors or unexpected fixture routes', !errors.length && !fixture.unexpected.length, { errors, routes: fixture.unexpected });
      browserErrors.push(...errors); receipts.push({ mode, requests: fixture.requests, unexpected: fixture.unexpected, expectedSaveErrors, errors });
    } catch (error) { check(`exception during ${operation}`, false, error.stack || String(error)); browserErrors.push(...errors); }
    finally { await page.close(); await fixture.close(); }
  }
} finally { await chrome.close(); }
console.log(JSON.stringify({ program: 'editor-navigation', checks: results.length, passed: results.filter(Boolean).length, failed: results.filter((value) => !value).length,
  browserErrors, receipts, sourceSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'src/editor-navigation.js'))).digest('hex'),
  editorSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'src/edit-mode.js'))).digest('hex'), bundleSha256: fs.existsSync(path.join(root, 'dist/taylors3d-card.js'))
    ? createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/taylors3d-card.js'))).digest('hex') : null }));
if (results.some((value) => !value) || browserErrors.length) process.exitCode = 1;
