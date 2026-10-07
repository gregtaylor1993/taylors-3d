// Actual source/bundle card and native inputs; explicit simulated HA transport.
// No household data, device actions, private assets or real-HA acceptance claim.
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { clickEditorTab } from './lib/editor-tab-navigation.mjs';
import { roomActionEntities as entities, roomActionLayoutKey as key,
  prepareRoomActionsFixture, serveRoomActionsFixture } from './lib/room-actions-fixture.mjs';

const checks = [], browserErrors = [];
let mode = '', context = 'setup';
const check = (name, pass, detail) => { checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${mode} ${name}${detail === undefined ? '' : ' - ' + JSON.stringify(detail)}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const movie = '[data-custom-controls-button-id="feedback-movie"]';
const scene = '[data-scene-action="activate"][data-scene-id="feedback-saved-scene"]';
const dismiss = (kind) => `[data-feedback-dismiss="${kind}"]`;
const snapshot = (page) => page.evaluate(() => {
  const card = document.querySelector('taylors3d-card'), f = window.roomActionsFixture, host = card._feedbackHost;
  const body = card.shadowRoot.querySelector('.body').getBoundingClientRect(), rect = host.getBoundingClientRect();
  return { feedback: card._feedback.snapshot(), calls: structuredClone(f.calls),
    actualScene: card._hass.states[f.entities.scene].state, writes: f.ws.filter((message) => message.type === 'taylors3d/layout/set').length,
    sceneRequestText: card._scenePreviewBar?.status?.textContent,
    editorSceneMessage: card._edit?._scenePreviewEditor?.message,
    sceneSize: { width: card._scene.clientWidth, height: card._scene.clientHeight }, renderer: card._view.renderer === f.renderer,
    sceneHeight: card._scene.getBoundingClientRect().height,
    sceneDocumentY: card._scene.getBoundingClientRect().top + window.scrollY,
    editing: card._editing === true, popupOpen: card._devicePopup.isOpen,
    stageHeight: card._stage.getBoundingClientRect().height, toolbarHeight: card._toolbar.getBoundingClientRect().height,
    barReserve: parseFloat(getComputedStyle(card._stage).getPropertyValue('--taylors3d-bar-height')) || 0,
    contexts: window.feedbackContexts.size, hostHidden: host.hidden,
    outsideBody: !host.closest('.body') && host.parentElement === card.shadowRoot.querySelector('ha-card'),
    afterBody: host.hidden || rect.top >= body.bottom - .5,
    text: host.textContent, dirty: card._edit?._customControlsEditor?.dirty,
    savedLabel: f.saved.custom_controls?.bars?.[0]?.label,
    rows: [...card._feedbackView.rows].map(([kind, refs]) => { const row = refs.row.getBoundingClientRect(), button = refs.dismiss.getBoundingClientRect();
      return { kind, shown: !!row.width && !!row.height, width: row.width, height: row.height,
        dismiss: !refs.dismiss.hidden, buttonWidth: button.width, buttonHeight: button.height, label: refs.message.textContent,
        role: refs.message.parentElement.getAttribute('role'), live: refs.message.parentElement.getAttribute('aria-live') }; }) };
});
async function control(page, selector, use) {
  context = 'native ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw Error('Missing control ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const point = await page.waitForFunction((element) => {
      const rect = element.getBoundingClientRect(), shadow = document.querySelector('taylors3d-card').shadowRoot;
      const hit = shadow.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return element.isConnected && !element.disabled && rect.width > 0 && rect.height > 0
        && (hit === element || element.contains(hit)) ? [rect.x + rect.width / 2, rect.y + rect.height / 2] : false;
    }, { timeout: 10000 }, element);
    try { await use(element, await point.jsonValue()); } finally { await point.dispose(); }
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (_element, point) => page.mouse.click(...point));
async function type(page, selector, value) {
  await control(page, selector, async (element) => {
    await element.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace'); await page.keyboard.type(value);
  });
}
async function commands(page) {
  const initial = await snapshot(page);
  check('empty feedback is zero-height and mounted outside the scene/editor body', initial.hostHidden && initial.outsideBody && initial.afterBody);
  await page.evaluate(() => window.roomActionsFixture.queue.push('deferred'));
  await click(page, movie); const pending = await snapshot(page);
  check('native deliberate action reports pending without changing actual device readings', pending.feedback.action?.status === 'pending'
    && pending.actualScene === initial.actualScene && pending.calls.length === initial.calls.length + 1);
  // The existing custom-button busy caption legitimately adds one line to its
  // measured toolbar. Separate that owned toolbar change from the feedback strip.
  check('feedback stays outside the fixed body and the only scene reserve change belongs to the existing toolbar', pending.sceneSize.width === initial.sceneSize.width
    && pending.stageHeight === initial.stageHeight && pending.sceneHeight + pending.barReserve === initial.sceneHeight + initial.barReserve
    && pending.afterBody && pending.outsideBody, { initial: initial.sceneSize, pending: pending.sceneSize,
      initialToolbar: initial.toolbarHeight, pendingToolbar: pending.toolbarHeight, initialReserve: initial.barReserve, pendingReserve: pending.barReserve,
      initialCssScene: initial.sceneHeight, pendingCssScene: pending.sceneHeight,
      afterBody: pending.afterBody, outsideBody: pending.outsideBody });
  await page.evaluate(() => document.querySelector('taylors3d-card')._feedback.setSaveState('saving')); await settle(page);
  const extraStrip = await snapshot(page);
  check('an independently visible shared save strip steals no scene or toolbar dimensions', same(extraStrip.sceneSize, pending.sceneSize)
    && extraStrip.stageHeight === pending.stageHeight && extraStrip.toolbarHeight === pending.toolbarHeight && extraStrip.afterBody);
  await page.evaluate(() => document.querySelector('taylors3d-card')._feedback.setSaveState('idle')); await settle(page);
  await page.evaluate(() => window.roomActionsFixture.finish()); await settle(page); const requested = await snapshot(page);
  check('resolved service reports requested rather than physical-device completion', requested.feedback.action?.status === 'requested'
    && requested.actualScene === initial.actualScene && !/device completed|confirmed|turned on/i.test(requested.text));
  const actionRow = requested.rows.find((row) => row.kind === 'action');
  check('requested status is polite, native and has a reachable 44px dismissal', actionRow.role === 'status' && actionRow.live === 'polite'
    && actionRow.dismiss && actionRow.buttonWidth >= 44 && actionRow.buttonHeight >= 44, actionRow);
  await click(page, dismiss('action')); const cleared = await snapshot(page);
  check('native dismissal removes only feedback and sends no service', cleared.feedback.action === null && cleared.calls.length === requested.calls.length);
  await page.evaluate(() => window.roomActionsFixture.queue.push('reject')); await click(page, movie); const failed = await snapshot(page);
  check('real rejected callback shows failure and keeps backend markup out of UI', failed.feedback.action?.status === 'failed'
    && !failed.text.includes('User_Error') && failed.actualScene === initial.actualScene);
  await click(page, dismiss('action'));
  for (const pulse of ['account', 'connection', 'permission', 'source', 'service']) {
    await page.evaluate(() => window.roomActionsFixture.queue.push('deferred')); await click(page, movie);
    await page.evaluate((pulse) => window.roomActionsFixture.pulse(pulse, window.roomActionsFixture.entities.scene), pulse);
    await page.evaluate(() => window.roomActionsFixture.finish('Late simulated error')); await settle(page);
    const after = await snapshot(page);
    check(`late action result cannot attach after ${pulse} loss and recovery`, after.feedback.action === null && after.actualScene === initial.actualScene);
  }
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), h = c._hass; h.connection.connected = false; c.hass = { ...h }; });
  const offline = await snapshot(page); check('current disconnected session has an explicit offline message', offline.feedback.connection.status === 'offline');
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), h = c._hass; h.connection.connected = true; c.hass = { ...h }; });
  const connected = await snapshot(page); check('actual reconnect has a dismissible current-session message', connected.feedback.connection.status === 'reconnected');
  await click(page, dismiss('connection'));
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._loading = true; c._syncCustomControls(); });
  const loading = await snapshot(page); check('transient root loading uses the shared loading strip', loading.feedback.connection.status === 'loading');
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._loading = false; c._syncCustomControls(); });
}
async function sceneRequests(page) {
  const before = await snapshot(page);
  await page.evaluate(() => window.roomActionsFixture.queue.push('deferred'));
  await click(page, scene); const pending = await snapshot(page);
  check('native standalone Scene Activate uses the same pending strip and one exact request', pending.feedback.action?.status === 'pending'
    && pending.feedback.action.label === 'User Saved Scene' && pending.calls.length === before.calls.length + 1
    && pending.actualScene === before.actualScene && pending.sceneRequestText === 'Requesting User Saved Scene…');
  await page.evaluate(() => window.roomActionsFixture.finish()); await settle(page);
  const requested = await snapshot(page);
  check('standalone scene acknowledgement means requested with unchanged actual readings', requested.feedback.action?.status === 'requested'
    && requested.actualScene === before.actualScene && requested.sceneRequestText === 'Request for User Saved Scene accepted. Check the current readings.');
  const captions = { en: 'Request for User Saved Scene accepted. Check the current readings.',
    de: 'Anfrage für User Saved Scene angenommen. Prüfe die aktuellen Werte.',
    fr: 'Demande pour User Saved Scene acceptée. Vérifiez les valeurs actuelles.',
    es: 'Solicitud para User Saved Scene aceptada. Comprueba las lecturas actuales.' };
  for (const language of ['en', 'de', 'fr', 'es']) {
    await page.evaluate((language) => window.roomActionsFixture.locale(language), language);
    const translated = await snapshot(page);
    check(`standalone ${language} terminal scene caption reports an accepted request without a new action`, translated.sceneRequestText === captions[language]
      && translated.actualScene === before.actualScene && translated.calls.length === requested.calls.length);
  }
  await page.evaluate(() => window.roomActionsFixture.locale('en'));
  await page.evaluate(() => window.roomActionsFixture.queue.push('reject')); await click(page, scene);
  const failed = await snapshot(page);
  check('standalone scene rejection is shared failure without invented HA state', failed.feedback.action?.status === 'failed' && failed.actualScene === before.actualScene);
  await page.evaluate(() => window.roomActionsFixture.queue.push('deferred')); await click(page, scene);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._layout.scene_previews.items[0].label = 'Different current binding'; c._syncScenePreviews();
  });
  await page.evaluate(() => window.roomActionsFixture.finish('Late replaced scene error')); await settle(page);
  const stale = await snapshot(page);
  check('a replaced scene binding cannot attach its late error to current feedback', stale.feedback.action === null && stale.actualScene === before.actualScene);
  await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'); c._layout.scene_previews.items[0].label = 'User Saved Scene'; c._syncScenePreviews();
  });
  await click(page, scene); const fresh = await snapshot(page);
  check('a fresh deliberate Scene Activate works after source recovery without automatic retry', fresh.feedback.action?.status === 'requested'
    && fresh.calls.length === stale.calls.length + 1 && fresh.actualScene === before.actualScene);
}
async function editorSceneRequest(page) {
  await clickEditorTab(page, 'scenes'); const before = await snapshot(page);
  await page.evaluate(() => window.roomActionsFixture.queue.push('deferred'));
  await click(page, '[data-act="scene-preview-activate"]'); const pending = await snapshot(page);
  check('native editor Scene Activate uses the same pending feedback without a layout save', pending.feedback.action?.status === 'pending'
    && pending.calls.length === before.calls.length + 1 && pending.writes === before.writes && pending.actualScene === before.actualScene);
  await page.evaluate(() => window.roomActionsFixture.finish()); await settle(page); const requested = await snapshot(page);
  check('editor scene acknowledgement reports a request and keeps current readings authoritative', requested.feedback.action?.status === 'requested'
    && requested.actualScene === before.actualScene && requested.writes === before.writes
    && requested.editorSceneMessage?.includes('accepted by Home Assistant'));
}
async function editPress(page) {
  const before = await snapshot(page);
  const open = async () => {
    const pixel = await page.evaluate(() => window.roomActionsFixture.roomPixel());
    await page.mouse.click(...pixel); await settle(page);
  };
  await open();
  await control(page, 'button.edit', async (element, point) => {
    await page.mouse.move(...point); await page.mouse.down(); await settle(page);
    const held = await snapshot(page), rect = await element.boundingBox();
    check('current native Edit press preserves its popup and exact target until click', held.popupOpen && !held.editing
      && rect.x + rect.width / 2 === point[0] && rect.y + rect.height / 2 === point[1]);
    await page.mouse.move(point[0], 1); await page.mouse.up(); await settle(page);
    const cancelled = await snapshot(page);
    check('releasing Edit outside the button leaves room/editor/layout/device intent unchanged', cancelled.popupOpen && !cancelled.editing
      && cancelled.calls.length === before.calls.length && cancelled.writes === before.writes);
  });
  const pixel = await page.evaluate(() => window.roomActionsFixture.roomPixel());
  await page.mouse.click(...pixel); await settle(page); const dismissed = await snapshot(page);
  check('foreign canvas press still dismisses the popup without opening Edit or changing a device', !dismissed.popupOpen && !dismissed.editing
    && dismissed.calls.length === before.calls.length && dismissed.writes === before.writes);
  await open(); check('a fresh actual room tap remains available after outside dismissal', (await snapshot(page)).popupOpen);
  await click(page, 'button.edit'); const editing = await snapshot(page);
  check('deliberate current Edit click closes controls and opens the real editor with no service or save', editing.editing && !editing.popupOpen
    && editing.calls.length === before.calls.length && editing.writes === before.writes);
}
async function editor(page) {
  await editPress(page); await editorSceneRequest(page); await clickEditorTab(page, 'controls');
  await click(page, dismiss('action'));
  const input = '[data-field="custom-controls-bar-label"][data-cc-bar="feedback-evening"]';
  const before = await snapshot(page); await type(page, input, 'User_<b>Changed_été'); const dirty = await snapshot(page);
  check('native editor typing immediately produces an independent unsaved strip', dirty.dirty === true && dirty.feedback.save.status === 'unsaved'
    && dirty.sceneDocumentY === before.sceneDocumentY && dirty.afterBody && before.hostHidden, { before: before.sceneDocumentY, after: dirty.sceneDocumentY });
  check('drafting runs no device service or persistence write', dirty.calls.length === before.calls.length && dirty.writes === before.writes);
  await click(page, '[data-act="custom-controls-cancel"]'); const cancelled = await snapshot(page);
  check('native Cancel clears the actual draft without a device or persistence command', cancelled.dirty === false
    && cancelled.feedback.save.status !== 'unsaved' && cancelled.calls.length === before.calls.length && cancelled.writes === before.writes);
  await type(page, input, 'User_<b>Saved_été'); await click(page, '[data-act="custom-controls-save"]');
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._feedback.snapshot().save.status === 'saved');
  const saved = await snapshot(page); check('native Save reports the actual simulated persisted callback and exact literal layout label', saved.savedLabel === 'User_<b>Saved_été'
    && saved.feedback.save.persistedStatus === 'saved' && saved.writes === before.writes + 1 && saved.calls.length === before.calls.length);
  for (const locale of ['en', 'de', 'fr', 'es']) {
    await page.evaluate((locale) => window.roomActionsFixture.locale(locale), locale); const translated = await snapshot(page);
    const caption = { en: 'Layout saved', de: 'Layout gespeichert', fr: 'Disposition enregistrée', es: 'Distribución guardada' }[locale];
    check(`current ${locale} saved feedback translates without changing stored user text or actions`, translated.rows.find((row) => row.kind === 'save').label === caption
      && translated.savedLabel === 'User_<b>Saved_été' && translated.calls.length === saved.calls.length && translated.writes === saved.writes);
  }
  await page.evaluate(() => window.roomActionsFixture.locale('en'));
  await page.setViewport({ width: 320, height: 1150, hasTouch: true, isMobile: true }); await settle(page);
  const narrow = await snapshot(page), width = await page.evaluate(() => document.querySelector('taylors3d-card').clientWidth);
  check('320px feedback remains within the card and retains its 44px native dismissal', narrow.afterBody && narrow.rows.every((row) => !row.shown
    || row.width <= width && (!row.dismiss || row.buttonWidth >= 44 && row.buttonHeight >= 44)), { width, rows: narrow.rows });
  await control(page, dismiss('save'), (_element, point) => page.touchscreen.tap(...point));
  check('native touch dismisses saved feedback without changing scene data or services', (await snapshot(page)).feedback.save.status === 'idle');
}

let browser, fixture;
try {
  for (mode of process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle']) {
    fixture = await serveRoomActionsFixture(root, mode); browser = await launch();
    const { page, errors } = await newPage(browser.browser, { width: 1440, height: 1150, hasTouch: true, isMobile: true });
    await page.evaluateOnNewDocument(() => { window.feedbackContexts = new Set(); const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const context = getContext.call(this, kind, ...args); if (context && /^webgl/.test(kind)) window.feedbackContexts.add(this); return context; }; });
    const external = []; page.on('request', (request) => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') external.push(url.href); });
    context = 'load fixture'; await page.goto(fixture.base + '/demo/room-actions-fixture.html', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.roomActionsModuleReady); await page.bringToFront();
    const layout = structuredClone(fixture.layout); layout.custom_controls = { version: 1, bars: [{ id: 'feedback-evening', label: 'User Evening', placement: 'bottom', style: 'pills', buttons: [
      { id: 'feedback-movie', label: 'User Movie', icon: 'mdi:movie', color: 'amber', action: { type: 'scene', entity: entities.scene } }] }] };
    layout.scene_previews = { enabled: true, items: [{ id: 'feedback-saved-scene', label: 'User Saved Scene', scene_entity: entities.scene, lights: [] }] };
    await page.evaluate(prepareRoomActionsFixture, { layout, readings: fixture.readings, entities, key });
    await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return c._feedback && !c._loading && !c._customControlsModelLoad; }); await settle(page);
    await commands(page); await sceneRequests(page); await editor(page);
    const end = await snapshot(page); check('feedback retains one original renderer and requests no new WebGL context', end.renderer && end.contexts === 1);
    check('no browser errors, private/external assets or unexpected fixture routes', !errors.length && !external.length && !fixture.unexpected.length, { errors, external, unexpected: fixture.unexpected });
    browserErrors.push(...errors); await page.close(); await browser.close(); browser = null; await fixture.close(); fixture = null; console.log(`Cleanup ${mode}: complete`);
  }
} catch (error) { console.error(`Native feedback check stopped at ${context}: ${error.stack}`); checks.push(false); }
finally { if (browser) await browser.close(); if (fixture) await fixture.close(); }
console.log(`${checks.filter(Boolean).length}/${checks.length} feedback checks passed; ${browserErrors.length} browser errors.`);
if (checks.some((pass) => !pass) || browserErrors.length) process.exitCode = 1;
