import { revealEditorTab } from './lib/editor-tab-navigation.mjs';
// Real Root legacy-object popup and nested TrackingCalibration, source/bundle.
// --preflight checks fixture bytes/routes/production readers without Chrome.
// A default native run requires freshly built distributed copies before launch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual as equal } from 'node:util';
import { prepareGPSCalibrationFixture } from './lib/gps-calibration-fixture.mjs';
import { assertEntityAreaBundlePrerequisites } from './lib/entity-area-filter-fixture.mjs';
import { runtimeLocalizationKey as key, runtimeLocalizationEntities as entities, runtimeLocalizationIds as ids,
  runtimeLocalizationNames as names, runtimeLocalizationHtml, prepareRuntimeLocalizationFixture,
  serveRuntimeLocalizationFixture } from './lib/runtime-localization-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), checks = [], errors = [];
const languages = ['en', 'de', 'fr', 'es'];
let scenario = 'preflight', context = 'fixture';
const check = (name, pass, detail) => { checks.push(!!pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${scenario}: ${name}${detail === undefined ? '' : ' · ' + JSON.stringify(detail)}`); };
// Fixed independent expected examples: never import a source/bundle dictionary.
const words = {
  en: { brightness: 'Brightness', blue: 'Set blue', close: 'Close object controls', sending: 'Sending command…',
    failed: 'Command failed: ', title: 'Vacuum coordinate calibration', capture: 'Capture current source point',
    units: 'Source units', metres: 'Metres', position: 'Position reading', raw: 'Raw X/Y', planX: 'Matching plan X — metres east',
    unfinished: 'Complete the edited plan coordinates. Blank values, booleans and nonfinite values cannot be saved.' },
  de: { brightness: 'Helligkeit', blue: 'Blau einstellen', close: 'Objektsteuerung schließen', sending: 'Befehl wird gesendet…',
    failed: 'Befehl fehlgeschlagen: ', title: 'Koordinatenkalibrierung des Staubsaugers', capture: 'Aktuellen Quellpunkt erfassen',
    units: 'Quelleinheiten', metres: 'Meter', position: 'Positionswert', raw: 'Rohes X/Y', planX: 'Passendes Plan-X — Meter Osten',
    unfinished: 'Vervollständigen Sie die bearbeiteten Plankoordinaten. Leere Werte, Wahrheitswerte und nicht endliche Werte sind nicht speicherbar.' },
  fr: { brightness: 'Luminosité', blue: 'Choisir le bleu', close: 'Fermer les commandes de l’objet', sending: 'Envoi de la commande…',
    failed: 'Échec de la commande : ', title: 'Calibrage des coordonnées d’aspirateur', capture: 'Capturer le point source actuel',
    units: 'Unités source', metres: 'Mètres', position: 'Valeur de position', raw: 'X/Y bruts', planX: 'X correspondant du plan — mètres est',
    unfinished: 'Complétez les coordonnées modifiées. Les valeurs vides, booléennes et non finies ne peuvent pas être enregistrées.' },
  es: { brightness: 'Brillo', blue: 'Elegir azul', close: 'Cerrar controles del objeto', sending: 'Enviando comando…',
    failed: 'Error del comando: ', title: 'Calibración de coordenadas del aspirador', capture: 'Capturar punto actual de origen',
    units: 'Unidades de origen', metres: 'Metros', position: 'Lectura de posición', raw: 'X/Y originales', planX: 'X correspondiente del plano — metros este',
    unfinished: 'Complete las coordenadas editadas. No se pueden guardar valores vacíos, booleanos o no finitos.' },
};
const popup = '.fp-popup', slider = popup + ' .brightness input', blue = popup + ' [data-rgb="10,132,255"]';
const toggle = popup + ' [data-act="toggle"]', cal = '[data-tracking-calibration]';
const field = (name, index) => `[data-field="trk-cal-${name}"]${index === undefined ? '' : `[data-index="${index}"]`}`;
const action = (name) => `[data-act="trk-cal-${name}"]`;
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function control(page, selector, callback) {
  await revealEditorTab(page, selector);
  context = 'native control ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try { const element = handle.asElement(); if (!element) throw new Error('Missing actual Root control ' + selector);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(element);
  } finally { await handle.dispose(); }
  await frames(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const type = (page, selector, value) => control(page, selector, async (element) => { await element.focus();
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace'); if (value) await page.keyboard.type(value); });
async function locale(page, language) { await page.evaluate((language) => window.runtimeLocalizationFixture.locale(language), language); await frames(page); }
const state = (page) => page.evaluate(() => {
  const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture, f = r.f, editor = c._edit?._trackingEditor;
  return { layout: c._layout, original: r.original, services: f.services, commits: f.commits.length - r.baseCommits,
    writes: f.ws.filter((message) => message.type === 'taylors3d/layout/set').length - r.baseWrites,
    sameRenderer: c._view.renderer === r.renderer, canvases: c.shadowRoot.querySelectorAll('canvas').length,
    draft: editor?.draft ?? null, pending: editor?.pendingPlanPick ?? null,
    planEdits: editor?.calibration ? [...editor.calibration.planEdits] : [],
    history: c._history.size, popupId: c._popup.objectId, modelId: c._view.model?.manifest?.objects?.find((object) => object.id === r.ids.lamp)?.id };
});
async function openPopup(page) {
  context = 'genuine Root model-object popup route';
  await page.evaluate((id) => document.querySelector('taylors3d-card')._runObjectAction(id, 'hold'), ids.lamp);
  try {
    await page.waitForFunction(() => {
      const c = document.querySelector('taylors3d-card'), panel = c?._popup?.el, input = panel?.querySelector('.brightness input');
      if (!input || input.disabled || !input.getClientRects().length || c._view?._tween) return false;
      const rectangle = input.getBoundingClientRect(), style = getComputedStyle(input), panelStyle = getComputedStyle(panel);
      const point = [rectangle.x + rectangle.width * .55, rectangle.y + rectangle.height / 2];
      return style.visibility === 'visible' && panelStyle.visibility === 'visible' && style.display !== 'none' && panelStyle.display !== 'none'
        && style.pointerEvents !== 'none' && panelStyle.pointerEvents !== 'none' && rectangle.width > 0 && rectangle.height >= 44
        && c.shadowRoot.elementFromPoint(...point) === input;
    }, { timeout: 15000 });
  } catch (error) {
    error.message += '; actual popup exposure: ' + JSON.stringify(await popupPointerState(page));
    throw error;
  }
  await frames(page);
  check('the existing Root route opens its real tagged model-object popup', (await state(page)).popupId === ids.lamp);
  const shown = await page.evaluate((id) => {
    const c = document.querySelector('taylors3d-card'), view = c._view, object = c._objects.objectAt(id), anchor = c._popup.anchorOf(id);
    const point = anchor && view.projectWorld(anchor), rectangle = c._scene.getBoundingClientRect();
    let visible = !!object?.obj?.node;
    for (let node = object?.obj?.node; node; node = node.parent) if (!node.visible) visible = false;
    return { object: object?.obj?.id, selected: c._popup.objectId, view: c._viewId, mode: c._mode,
      visible, clear: !!anchor && !view.pointHidden(anchor, object.obj.node), point, scene: rectangle.toJSON(),
      sameRenderer: view.renderer === window.runtimeLocalizationFixture.renderer };
  }, ids.lamp);
  check('the selected authored upper-storey object is visible in the original renderer before native popup input', shown.object === ids.lamp
    && shown.selected === ids.lamp && shown.view === 'upper' && shown.mode === '3d' && shown.visible && shown.clear && shown.sameRenderer
    && shown.point?.[0] >= shown.scene.left && shown.point[0] <= shown.scene.right && shown.point[1] >= shown.scene.top && shown.point[1] <= shown.scene.bottom, shown);
}
async function popupPointerState(page, point) {
  return page.evaluate((point) => {
    const c = document.querySelector('taylors3d-card'), popup = c?._popup, panel = popup?.el, input = panel?.querySelector('.brightness input'), view = c?._view;
    const rectangle = input?.getBoundingClientRect(), chosen = point || (rectangle && [rectangle.x + rectangle.width * .55, rectangle.y + rectangle.height / 2]);
    const hit = chosen && c?.shadowRoot.elementFromPoint(...chosen);
    const style = (node) => { if (!node) return null; const value = getComputedStyle(node);
      return { visibility: value.visibility, display: value.display, pointerEvents: value.pointerEvents, opacity: value.opacity }; };
    const anchor = popup?.anchorOf?.(popup.objectId) || popup?._anchor, projected = anchor && popup?.project(anchor);
    return { point: chosen, correct: !!input && hit === input, hit: hit?.className || hit?.tagName, popup: popup?.isOpen,
      object: popup?.objectId, range: rectangle?.toJSON(), panel: panel?.getBoundingClientRect().toJSON(), rangeStyle: style(input), panelStyle: style(panel),
      anchor: anchor?.toArray ? anchor.toArray() : anchor, projected, stage: c?._stage?.getBoundingClientRect().toJSON(), scene: c?._scene?.getBoundingClientRect().toJSON(),
      camera: view?.camera && { position: view.camera.position.toArray(), quaternion: view.camera.quaternion.toArray(), zoom: view.camera.zoom,
        target: view.controls?.target.toArray(), mode: view.mode, dirty: view.dirty, tween: !!view._tween },
      current: { view: c?._viewId, mode: c?._mode, floor: c?._floor, floorOnly: c?._floorOnly, loading: c?._loading, model: view?.model?.id },
      sameRenderer: view?.renderer === window.runtimeLocalizationFixture?.renderer };
  }, point);
}
async function dimensions(page, selector, description) {
  const size = await page.evaluate((selector) => {
    const c = document.querySelector('taylors3d-card'), element = c.shadowRoot.querySelector(selector), rectangle = element.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
      width: innerWidth, left: rectangle.left, right: rectangle.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      controls: [...element.querySelectorAll('input,select,button')].filter((node) => node.getClientRects().length)
        .map((node) => ({ id: node.dataset.act || node.dataset.field || node.className,
          width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })) };
  }, selector);
  check(`${description} fits at ${size.width}px with real 44px targets`, !size.overflow && size.left >= -1 && size.right <= size.width + 1
    && size.scrollWidth <= size.clientWidth + 1 && size.controls.length > 3 && size.controls.every((node) => node.height >= 44
      && (!['fp-pop-x', 'fp-switch'].includes(node.id) || node.width >= 44)), size);
}
async function popupCaptionsAndSlider(page) {
  await openPopup(page);
  await control(page, slider, async (element) => { await element.focus(); await element.evaluate((node) => {
    const r = window.runtimeLocalizationFixture; r.slider = node; r.blue = node.closest('.fp-popup').querySelector('[data-rgb="10,132,255"]');
    r.toggle = node.closest('.fp-popup').querySelector('[data-act="toggle"]');
  }); const box = await element.boundingBox(), start = [box.x + box.width * .55, box.y + box.height / 2];
    const target = await popupPointerState(page, start);
    if (!target.correct) throw new Error('The held native range must be the exposed pointer target: ' + JSON.stringify(target));
    await element.evaluate((node) => {
      const r = window.runtimeLocalizationFixture, panel = node.closest('.fp-popup');
      window.addEventListener('pointerdown', (event) => { const path = event.composedPath();
        r.sliderPointerObservation = { x: event.clientX, y: event.clientY, containsRange: path.includes(node), containsPopup: path.includes(panel),
          path: path.filter((item) => item?.tagName).map((item) => ({ tag: item.tagName, class: String(item.className || '') })) };
      }, { capture: true, once: true });
    });
    await page.mouse.move(...start); await page.mouse.down(); await page.mouse.move(box.x + box.width * .68, box.y + box.height / 2, { steps: 3 }); });
  const heldPopup = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), closed = c._popup.closedBy;
    return { open: c._popup.isOpen, object: c._popup.objectId, pointer: window.runtimeLocalizationFixture.sliderPointerObservation,
      outside: closed ? { type: closed.type, x: closed.clientX, y: closed.clientY, target: closed.target?.className || closed.target?.tagName } : null };
  });
  if (!heldPopup.open) throw new Error('The popup closed during its deliberate native slider gesture: ' + JSON.stringify(heldPopup));
  const before = await state(page), draftValue = await page.evaluate(() => window.runtimeLocalizationFixture.slider.value);
  for (const language of languages) {
    await locale(page, language);
    const result = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture, el = c._popup.el;
      return { same: el.querySelector('.brightness input') === r.slider && el.querySelector('[data-rgb="10,132,255"]') === r.blue
          && el.querySelector('[data-act="toggle"]') === r.toggle,
        focused: c.shadowRoot.activeElement === r.slider, value: r.slider.value,
        label: el.querySelector('.brightness .fp-pop-label').textContent, title: r.blue.title,
        close: el.querySelector('.fp-pop-x').getAttribute('aria-label'), object: el.querySelector('.fp-pop-title').textContent,
        reading: el.querySelector('.value .fp-pop-value').textContent, entity: el.querySelector('.brightness').dataset.entity,
        markup: !!el.querySelector('b'), colour: el.querySelector('.color .fp-pop-reading').textContent };
    });
    check(`${language} legacy captions change while the native unfinished slider/buttons, raw identity and HA value stay current`,
      result.same && result.focused && result.value === draftValue && result.label === words[language].brightness
      && result.title === words[language].blue && result.close === words[language].close && result.object === names.object
      && result.reading === 'HA_STATE:on' && result.entity === entities.lamp && !result.markup && result.colour.includes('rgb(12,34,56)'), result);
    const current = await state(page);
    check(`${language} repaint makes no save, command or renderer`, current.services.length === before.services.length
      && current.commits === 0 && current.writes === 0 && current.sameRenderer && current.canvases === 1 && equal(current.layout, current.original));
  }
  await page.mouse.up(); await frames(page); const after = await state(page);
  check('releasing the healthy native slider submits its exact current brightness once', after.services.length === before.services.length + 1
    && equal(after.services.at(-1), ['light', 'turn_on', { entity_id: entities.lamp, brightness: Number(draftValue) }]), after.services.at(-1));
  await page.setViewport({ width: 320, height: 1000, deviceScaleFactor: 1 }); await frames(page);
  for (const language of languages) { await locale(page, language); await dimensions(page, popup, `${language} legacy popup`); }
  if (process.argv.includes('--screenshots')) { const directory = path.join(root, 'screenshots'); fs.mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `runtime-localization-${scenario}-popup-320.png`), fullPage: true }); }
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 }); await frames(page);
}
async function held(page, selector, gesture, loss, entity) {
  await control(page, selector, async (element) => {
    await element.focus();
    if (gesture === 'pointer') { const box = await element.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.evaluate(({ loss, entity }) => window.runtimeLocalizationFixture.pulse(loss, entity), { loss, entity }); await page.mouse.up(); }
    else if (gesture === 'Space') { await page.keyboard.down('Space'); await page.evaluate(({ loss, entity }) => window.runtimeLocalizationFixture.pulse(loss, entity), { loss, entity }); await page.keyboard.up('Space'); }
    else { await element.evaluate((node, detail) => node.addEventListener('keydown', () => window.runtimeLocalizationFixture.pulse(detail.loss, detail.entity), { once: true }), { loss, entity }); await page.keyboard.press('Enter'); }
  });
}
async function popupFencesAndPending(page) {
  for (const loss of ['connection', 'account', 'active', 'permission', 'source', 'service']) for (const gesture of ['pointer', 'Space', 'Enter']) {
    await openPopup(page); const before = await state(page); await held(page, blue, gesture, loss, entities.lamp); const after = await state(page);
    check(`${loss} loss/recovery rejects the held native ${gesture} legacy action`, after.services.length === before.services.length
      && equal(after.layout, before.layout) && after.commits === 0 && after.writes === 0);
  }
  await openPopup(page); const before = await state(page); await click(page, blue); let after = await state(page);
  check('a fresh legacy action still sends the exact current colour after rejected stale gestures', after.services.length === before.services.length + 1
    && equal(after.services.at(-1), ['light', 'turn_on', { entity_id: entities.lamp, rgb_color: [10, 132, 255] }]));
  await page.evaluate(() => window.runtimeLocalizationFixture.replies.push('defer')); await click(page, toggle);
  const pendingCount = (await state(page)).services.length;
  for (const language of languages) { await locale(page, language);
    const status = await page.evaluate(() => document.querySelector('taylors3d-card')._popup.el.querySelector('.toggle .fp-pop-status').textContent);
    check(`${language} pending legacy command caption uses current language without retry`, status === words[language].sending
      && (await state(page)).services.length === pendingCount, status);
  }
  await page.evaluate((error) => window.runtimeLocalizationFixture.finish(error), names.error); await frames(page);
  for (const language of languages) { await locale(page, language);
    const status = await page.evaluate(() => { const el = document.querySelector('taylors3d-card')._popup.el;
      return { text: el.querySelector('.toggle .fp-pop-status').textContent, markup: !!el.querySelector('b') }; });
    check(`${language} rejected legacy command keeps the literal escaped external error`, status.text === words[language].failed + names.error
      && !status.markup && (await state(page)).services.length === pendingCount, status);
  }
}
// A separate fresh page keeps the original three-command calibration scenario
// intact. All controls below belong to the real Root's cached ObjectLayer chain;
// no popup resolver, binding, action callback or gesture handler is substituted.
async function popupCurrentUseAndPendingOwnership(page) {
  await page.evaluate(() => window.runtimeLocalizationFixture.viewer()); await frames(page);
  await openPopup(page);
  const before = await state(page);
  const bound = await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture;
    const object = c._objects.objectAt(r.ids.lamp), part = c._objects.parts.get(r.ids.lamp), resolved = c._popup.resolve(r.ids.lamp);
    r.realResolver = c._popup.resolve; r.realAction = c._popup.onAction;
    return { user: c._hass.user.id, admin: c._hass.user.is_admin, active: c._hass.user.is_active,
      savedEntity: c._layout.objects[r.ids.lamp].entity, boundEntity: object.binding.entity, entities: object.chain.entities,
      cached: resolved.chain === part.chain && resolved.chain === object.chain && resolved.obj === part.obj
        && resolved.states === c._hass.states && resolved.hass === c._hass,
      enabled: ['[data-rgb="10,132,255"]', '[data-act="toggle"]', '.brightness input'].every((selector) => !c._popup.el.querySelector(selector).disabled) };
  });
  check('a fresh active viewer receives valid controls through the actual Root cached ObjectLayer binding', bound.user === 'simulated-runtime-viewer'
    && bound.admin === false && bound.active === true && bound.savedEntity === entities.lamp && bound.boundEntity === entities.lamp
    && equal(bound.entities, [entities.lamp]) && bound.cached && bound.enabled && before.services.length === 0, bound);
  await click(page, blue); let after = await state(page);
  check('a fresh viewer native click sends exactly the current tagged lamp colour once', after.services.length === 1
    && equal(after.services[0], ['light', 'turn_on', { entity_id: entities.lamp, rgb_color: [10, 132, 255] }])
    && after.commits === 0 && after.writes === 0 && equal(after.layout, after.original), after.services);

  const normalBefore = await state(page);
  await control(page, blue, async (element) => {
    await element.focus(); await element.evaluate((node) => {
      const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture;
      r.normalButton = node; r.normalChain = c._objects.objectAt(r.ids.lamp).chain;
    });
    await page.keyboard.down('Space');
    await page.evaluate(() => window.runtimeLocalizationFixture.lampReading(64, [90, 80, 70]));
    await locale(page, 'de');
    const current = await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture, el = c._popup.el;
      const object = c._objects.objectAt(r.ids.lamp), resolved = c._popup.resolve(r.ids.lamp);
      return { same: el.querySelector('[data-rgb="10,132,255"]') === r.normalButton,
        focused: c.shadowRoot.activeElement === r.normalButton, enabled: !r.normalButton.disabled,
        title: r.normalButton.title, brightness: el.querySelector('.brightness input').value,
        reading: el.querySelector('.value .fp-pop-value').textContent, colour: el.querySelector('.color .fp-pop-reading').textContent,
        refreshed: object.chain !== r.normalChain && resolved.chain === object.chain && object.chain.source === c._hass.states[r.entities.lamp],
        boundEntity: object.binding.entity, user: c._hass.user.id, handlers: c._popup.resolve === r.realResolver && c._popup.onAction === r.realAction };
    });
    const passive = await state(page);
    check('an ordinary reading and locale update refresh the real cached chain while preserving the held viewer control', current.same
      && current.focused && current.enabled && current.title === 'Blau einstellen' && current.brightness === '64'
      && current.reading === 'HA_STATE:on' && current.colour.includes('rgb(90,80,70)') && current.refreshed
      && current.boundEntity === entities.lamp && current.user === 'simulated-runtime-viewer' && current.handlers
      && passive.services.length === normalBefore.services.length && passive.commits === 0 && passive.writes === 0, current);
    await page.keyboard.up('Space');
  });
  after = await state(page);
  check('releasing that healthy held viewer gesture sends its exact intended colour once', after.services.length === normalBefore.services.length + 1
    && equal(after.services.at(-1), ['light', 'turn_on', { entity_id: entities.lamp, rgb_color: [10, 132, 255] }]), after.services.at(-1));

  const outsideBefore = await state(page);
  await control(page, blue, async (element) => {
    const box = await element.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await element.evaluate((node) => { window.runtimeLocalizationFixture.outsideButton = node; });
    await page.evaluate(() => window.runtimeLocalizationFixture.pulse('connection'));
    const outside = await page.evaluate(() => {
      const rectangle = document.querySelector('taylors3d-card')._popup.el.getBoundingClientRect();
      return [[4, 4], [innerWidth - 4, 4], [4, innerHeight - 4], [innerWidth - 4, innerHeight - 4]]
        .find(([x, y]) => x < rectangle.left || x > rectangle.right || y < rectangle.top || y > rectangle.bottom);
    });
    if (!outside) throw new Error('The real popup must leave an outside point for the native release');
    await page.mouse.move(...outside); await page.mouse.up();
  });
  after = await state(page);
  check('releasing a recovered old pointer outside the real popup sends no command and retains the current panel', after.services.length === outsideBefore.services.length
    && after.popupId === ids.lamp && await page.evaluate(() => {
      const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture;
      return c._popup.el.querySelector('[data-rgb="10,132,255"]') === r.outsideButton && !r.outsideButton.disabled;
    }) && after.commits === 0 && after.writes === 0);
  await click(page, blue); after = await state(page);
  check('the next fresh native pointer press succeeds after that outside release', after.services.length === outsideBefore.services.length + 1
    && equal(after.services.at(-1), ['light', 'turn_on', { entity_id: entities.lamp, rgb_color: [10, 132, 255] }]), after.services.at(-1));

  await locale(page, 'en'); const pendingBefore = await state(page);
  await page.evaluate(() => window.runtimeLocalizationFixture.replies.push('defer')); await click(page, toggle);
  check('the first actual viewer command stays pending at the simulated HA boundary', (await state(page)).services.length === pendingBefore.services.length + 1
    && await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture;
      return r.pending.length === 1 && c._popup.el.querySelector('[data-act="toggle"]').disabled
        && c._popup.el.querySelector('.toggle .fp-pop-status').textContent === 'Sending command…'; }));
  await page.evaluate(() => window.runtimeLocalizationFixture.pulse('connection')); await frames(page);
  check('Root observes the connection loss and recovery before a new native command is allowed', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture;
    return r.pending.length === 1 && c._popup.isOpen && !c._popup.el.querySelector('[data-act="toggle"]').disabled
      && c._popup.resolve === r.realResolver && c._popup.onAction === r.realAction;
  }));
  await page.evaluate(() => window.runtimeLocalizationFixture.replies.push('defer')); await click(page, toggle);
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture;
    r.newPendingButton = c._popup.el.querySelector('[data-act="toggle"]'); });
  after = await state(page);
  check('a fresh native command becomes the newer pending run for the exact same lamp', after.services.length === pendingBefore.services.length + 2
    && equal(after.services.slice(-2), [['light', 'toggle', { entity_id: entities.lamp }], ['light', 'toggle', { entity_id: entities.lamp }]])
    && await page.evaluate(() => window.runtimeLocalizationFixture.pending.length === 2), after.services.slice(-2));
  await page.evaluate(() => window.runtimeLocalizationFixture.finish('Stale_<b>Old_command_error')); await frames(page);
  for (const language of languages) {
    await locale(page, language);
    const current = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture, el = c._popup.el;
      return { pending: r.pending.length, same: el.querySelector('[data-act="toggle"]') === r.newPendingButton,
        disabled: r.newPendingButton.disabled, status: el.querySelector('.toggle .fp-pop-status').textContent,
        oldError: el.textContent.includes('Stale_<b>Old_command_error'), markup: !!el.querySelector('b') }; });
    check(`${language} an old rejected result cannot clear or report over the newer actual pending run`, current.pending === 1 && current.same
      && current.disabled && current.status === words[language].sending && !current.oldError && !current.markup
      && (await state(page)).services.length === pendingBefore.services.length + 2, current);
  }
  await page.evaluate((error) => window.runtimeLocalizationFixture.finish(error), names.error); await frames(page);
  for (const language of languages) {
    await locale(page, language);
    const current = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture, el = c._popup.el;
      return { pending: r.pending.length, same: el.querySelector('[data-act="toggle"]') === r.newPendingButton,
        disabled: r.newPendingButton.disabled, status: el.querySelector('.toggle .fp-pop-status').textContent,
        oldError: el.textContent.includes('Stale_<b>Old_command_error'), markup: !!el.querySelector('b') }; });
    check(`${language} only the newer result publishes its literal escaped error and enables its existing native control`, current.pending === 0
      && current.same && !current.disabled && current.status === words[language].failed + names.error && !current.oldError && !current.markup
      && (await state(page)).services.length === pendingBefore.services.length + 2, current);
  }
  const final = await state(page);
  check('the separate real-Root viewer scenario makes exactly five explicit commands with no layout writes or renderer replacement', equal(final.services,
    [['light', 'turn_on', { entity_id: entities.lamp, rgb_color: [10, 132, 255] }],
      ['light', 'turn_on', { entity_id: entities.lamp, rgb_color: [10, 132, 255] }],
      ['light', 'turn_on', { entity_id: entities.lamp, rgb_color: [10, 132, 255] }],
      ['light', 'toggle', { entity_id: entities.lamp }], ['light', 'toggle', { entity_id: entities.lamp }]])
    && final.commits === 0 && final.writes === 0 && equal(final.layout, final.original) && final.sameRenderer && final.canvases === 1, final.services);
}
async function popupCurrentEvidence(browser, fixture) {
  const { newPage } = await import('./lib/demo-browser.mjs');
  const session = await newPage(browser, { width: 1280, height: 1000 });
  try {
    const { page } = session; await page.goto(fixture.base + '/demo/runtime-localization.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.gpsModuleReady, { timeout: 15000 });
    await page.evaluate(prepareGPSCalibrationFixture, { layout: fixture.layout, readings: fixture.readings, entities, key });
    await page.evaluate(prepareRuntimeLocalizationFixture, { entities, ids, names });
    await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return c._view.model && c._view.stats.frames > 0
      && c._objects.objectAt(window.runtimeLocalizationFixture.ids.lamp); }, { timeout: 30000 });
    await popupCurrentUseAndPendingOwnership(page);
    check('the fresh viewer page has no browser errors', session.errors.length === 0, session.errors); errors.push(...session.errors);
  } finally { await session.page.evaluate(() => document.querySelector('taylors3d-card')?.remove()).catch(() => {}); await session.page.close(); }
}
async function tracking(page) {
  if (!await page.evaluate(() => document.querySelector('taylors3d-card')._editing)) await click(page, '[data-bubble="edit"]');
  if (await page.evaluate(() => document.querySelector('taylors3d-card')._edit.tab) !== 'tracking') await click(page, '[data-act="tab"][data-id="tracking"]');
  await click(page, '[data-act="trk-section"][data-section="vacuums"]');
}
async function reopen(page) {
  if ((await state(page)).draft) await click(page, '[data-act="trk-cancel"]');
  await tracking(page); await click(page, '[data-act="trk-edit"][data-index="2"]');
  await page.waitForFunction(() => !!document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-tracking-calibration]'), { timeout: 15000 });
}
async function calibrationCaptions(page) {
  await click(page, popup + ' .fp-pop-x');
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'); c._setView('ground', { instant: true }); c._setMode('top'); });
  await reopen(page); await type(page, field('plan-x', 0), '');
  await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture;
    r.planInput = c.shadowRoot.querySelector('[data-field="trk-cal-plan-x"][data-index="0"]'); r.calibration = c._edit._trackingEditor.calibration;
    r.units = c.shadowRoot.querySelector('[data-field="trk-cal-units"]'); r.unitOption = r.units.selectedOptions[0];
    r.capture = c.shadowRoot.querySelector('[data-act="trk-cal-capture"]'); });
  const before = await state(page);
  assert(before.planEdits.length === 1 && before.planEdits[0][1][0] === '', 'A cleared native coordinate must retain its exact blank unfinished calibration draft');
  for (const language of languages) { await locale(page, language);
    const result = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture,
      root = c.shadowRoot.querySelector('[data-tracking-calibration]');
      return { same: root.querySelector('[data-field="trk-cal-plan-x"][data-index="0"]') === r.planInput
          && c._edit._trackingEditor.calibration === r.calibration && root.querySelector('[data-field="trk-cal-units"]') === r.units
          && r.units.selectedOptions[0] === r.unitOption && root.querySelector('[data-act="trk-cal-capture"]') === r.capture,
        focused: c.shadowRoot.activeElement === r.planInput, value: r.planInput.value, title: root.querySelector(':scope > h4').textContent,
        capture: r.capture.textContent, units: r.units.closest('label').querySelector('[data-cal-detail]').textContent,
        option: r.unitOption.textContent, unit: r.units.value, planX: r.planInput.closest('label').querySelector('[data-cal-detail]').textContent,
        status: root.querySelector('[data-cal-status]').textContent, source: root.querySelector('[data-field="trk-cal-entity"]').value,
        raw: c._edit._trackingEditor.draft.label, markup: !!root.querySelector('b') };
    });
    check(`${language} nested calibration re-translates real captions/status while the focused unfinished input/units option/source object survive`, result.same
      && result.focused && result.value === '' && result.title === words[language].title && result.capture === words[language].capture
      && result.units === words[language].units && result.option === words[language].metres && result.unit === 'm'
      && result.planX === words[language].planX && result.status.includes(words[language].position) && result.status.includes(words[language].raw)
      && result.status.includes('10, 20') && result.status.includes('HA_STATE:ready') && result.status.includes(words[language].unfinished)
      && result.source === entities.xy && result.raw === names.binding && !result.markup, result);
    const after = await state(page);
    check(`${language} nested repaint keeps raw pairs/extras and makes no command/save/renderer`, equal(after.planEdits, before.planEdits)
      && equal(after.draft, before.draft) && equal(after.layout, after.original) && after.services.length === before.services.length
      && after.commits === 0 && after.writes === 0 && after.sameRenderer && after.canvases === 1);
  }
  await control(page, field('units'), (element) => element.focus()); await locale(page, 'de');
  check('focused real select retains its exact native selected option through a language update', await page.evaluate(() => {
    const c = document.querySelector('taylors3d-card'), r = window.runtimeLocalizationFixture;
    return c.shadowRoot.activeElement === r.units && r.units.selectedOptions[0] === r.unitOption && r.units.value === 'm';
  }));
  await page.setViewport({ width: 320, height: 1000, deviceScaleFactor: 1 }); await frames(page);
  for (const language of languages) { await locale(page, language); await dimensions(page, cal, `${language} nested calibration`); }
  if (process.argv.includes('--screenshots')) { const directory = path.join(root, 'screenshots'); fs.mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `runtime-localization-${scenario}-calibration-320.png`), fullPage: true }); }
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 }); await frames(page);
}
async function canvasPoint(page) {
  await page.waitForFunction(() => !document.querySelector('taylors3d-card')._view._tween, { timeout: 15000 });
  const point = await page.evaluate(() => { const c = document.querySelector('taylors3d-card'), v = c._view, canvas = v.renderer.domElement,
    floor = c._edit._trackingEditor.pendingPlanPick.floorId, box = canvas.getBoundingClientRect();
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) {
      const pixel = v.screenPoint(x + .137, y + .239, 0, floor);
      if (pixel[0] > box.left + 16 && pixel[0] < box.right - 16 && pixel[1] > box.top + 16 && pixel[1] < box.bottom - 16
        && c.shadowRoot.elementFromPoint(...pixel) === canvas) return { pixel, floor, plan: v.planPoint(...pixel, v.floorElevation(floor)) };
    } return null;
  }); if (!point) throw new Error('No exposed actual GLB floor point for the pending real calibration token'); return point;
}
async function calibrationFences(page) {
  for (const loss of ['connection', 'account', 'role', 'source']) for (const gesture of ['pointer', 'Space', 'Enter']) {
    await reopen(page); const before = await state(page); await held(page, action('capture'), gesture, loss, entities.xy); const after = await state(page);
    check(`${loss} loss/recovery rejects held native ${gesture} capture without adding/replacing a pair or writing a layout`, !after.pending
      && equal(after.layout, before.layout) && (!after.draft || equal(after.draft.position_source.calibration, before.draft.position_source.calibration))
      && after.commits === 0 && after.writes === 0 && after.services.length === before.services.length);
  }
  await reopen(page); await click(page, action('capture')); const captured = await state(page);
  check('a fresh deliberate capture freezes the actual current XY source and exact measured floor', captured.pending
    && equal(captured.pending.raw, [10, 20]) && captured.pending.floorId === 'ground');
  for (const language of languages) { await locale(page, language); const current = await state(page);
    check(`${language} pending capture remains the same token/source/floor during passive caption changes`, current.pending?.token === captured.pending?.token
      && equal(current.pending?.raw, [10, 20]) && current.pending?.floorId === 'ground' && current.commits === 0 && current.writes === 0); }
  const point = await canvasPoint(page); await page.mouse.move(...point.pixel); await page.mouse.down();
  await page.evaluate((entity) => window.runtimeLocalizationFixture.pulse('source', entity), entities.xy); await page.mouse.up(); await frames(page);
  const after = await state(page);
  check('source loss/recovery rejects a held real renderer plan click and cancels the captured token', !after.pending
    && (!after.draft || equal(after.draft.position_source.calibration, captured.draft.position_source.calibration))
    && after.commits === 0 && after.writes === 0 && after.services.length === captured.services.length);
  await click(page, '[data-act="trk-cancel"]');
  const final = await state(page);
  check('all runtime localization work retains raw saved layouts with one renderer and only the explicit popup device commands', equal(final.layout, final.original)
    && final.commits === 0 && final.writes === 0 && final.sameRenderer && final.canvases === 1 && final.services.length === 3, final.services);
}

async function preflight() {
  const { transform } = await import('esbuild'), { JSDOM } = await import('jsdom'), { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { buildManifest, threeAdapter } = await import('../src/manifest.js'), { readCoordinate, compileCalibration } = await import('../src/tracked-source.js');
  for (const mode of ['source', 'bundle']) { const fixture = await serveRuntimeLocalizationFixture(root, mode);
    try {
      const html = runtimeLocalizationHtml(mode), dom = new JSDOM(html);
      await transform(dom.window.document.querySelector('script[type="module"]').textContent, { loader: 'js' });
      await transform(`(${prepareGPSCalibrationFixture.toString()})`, { loader: 'js' });
      await transform(`(${prepareRuntimeLocalizationFixture.toString()})`, { loader: 'js' });
      check(`${mode} real Root module is selected with one card and explicit simulated boundaries`, html.includes(`/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js`)
        && dom.window.document.querySelectorAll('taylors3d-card').length === 1 && dom.window.document.body.textContent.includes('SIMULATED'));
      dom.window.close(); const model = await new Promise((resolve, reject) => new GLTFLoader().parse(fixture.model.buffer.slice(fixture.model.byteOffset,
        fixture.model.byteOffset + fixture.model.length), '', resolve, reject)), manifest = buildManifest(threeAdapter(model.scene));
      const lamp = manifest.objects.find((object) => object.id === ids.lamp);
      check(`${mode} existing purpose-built GLB provides the exact tagged lamp and two real independent floors`, lamp?.label === names.object
        && lamp.ui.hold === 'popup' && manifest.levels.some((level) => level.id === ids.ground) && manifest.levels.some((level) => level.id === ids.upper));
      const binding = fixture.layout.vacuum_bindings[2], coordinate = readCoordinate(fixture.readings[entities.xy], binding.position_source);
      check(`${mode} production coordinate reader and fit use exact reported nested XY and saved pairs`, coordinate.status === 'ready'
        && equal(coordinate.raw, [10, 20]) && compileCalibration(binding.position_source).status === 'ready');
      check(`${mode} raw original pair annotations/binding labels and layout IDs are explicit fixture data`, binding.label === names.binding
        && binding.position_source.calibration[0].annotation.retain === 'User_raw_pair' && binding.position_source.entity === entities.xy);
      const response = await fetch(fixture.base + '/demo/runtime-localization.html');
      check(`${mode} local HTTP page matches its exact source/bundle fixture module`, response.status === 200 && await response.text() === html);
      const modelResponse = await fetch(fixture.base + '/demo/runtime-localization.glb');
      check(`${mode} model HTTP route returns the actual purpose-built GLB bytes`, modelResponse.status === 200 && Buffer.from(await modelResponse.arrayBuffer()).equals(fixture.model));
      const furniture = await fetch(fixture.base + '/api/taylors3d/furniture');
      check(`${mode} passive furniture HTTP boundary is explicit and empty`, equal(await furniture.json(), { version: 1, packs: [] }));
      check(`${mode} fixture substitutes no popup/calibration/render handlers`, !prepareRuntimeLocalizationFixture.toString().includes('new ObjectPopup')
        && !prepareRuntimeLocalizationFixture.toString().includes('acceptPlanPoint') && !prepareRuntimeLocalizationFixture.toString().includes('new WebGLRenderer'));
      check(`${mode} current-viewer evidence changes only explicit HA account and lamp readings`, prepareRuntimeLocalizationFixture.toString().includes("id: 'simulated-runtime-viewer'")
        && prepareRuntimeLocalizationFixture.toString().includes('is_admin: false') && prepareRuntimeLocalizationFixture.toString().includes('rgb_color: [...rgb]')
        && !prepareRuntimeLocalizationFixture.toString().includes('c._popup.resolve =') && !prepareRuntimeLocalizationFixture.toString().includes('c._objects.setBindings('));
      check(`${mode} preflight requests use only registered local GETs`, fixture.unexpected.length === 0 && fixture.requests.every((request) => request.method === 'GET'));
      model.scene.traverse((node) => { node.geometry?.dispose(); for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) material.dispose(); });
    } finally { await fixture.close(); }
  }
  check('independent words cover four languages and raw values are not dictionary-derived', equal(Object.keys(words), languages)
    && languages.every((language) => Object.keys(words[language]).length === 13 && Object.values(words[language]).every((word) => typeof word === 'string' && word.trim())));
  console.log('Preflight only: Chrome/native controls, current bundle application, GPU and household HA have NOT been verified.');
}
async function nativeProof() {
  if (!process.argv.includes('--source-only')) { context = 'read-only current distributed bundle prerequisite';
    await assertEntityAreaBundlePrerequisites(root); }
  const { launch, newPage } = await import('./lib/demo-browser.mjs');
  const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
  for (const mode of modes) { scenario = mode; let fixture, running, session;
    try {
      fixture = await serveRuntimeLocalizationFixture(root, mode); running = await launch(); session = await newPage(running.browser, { width: 1280, height: 1000 });
      const { page } = session; await page.goto(fixture.base + '/demo/runtime-localization.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.gpsModuleReady, { timeout: 15000 });
      await page.evaluate(prepareGPSCalibrationFixture, { layout: fixture.layout, readings: fixture.readings, entities, key });
      await page.evaluate(prepareRuntimeLocalizationFixture, { entities, ids, names });
      await page.waitForFunction(() => { const c = document.querySelector('taylors3d-card'); return c._view.model && c._view.stats.frames > 0
        && c._objects.objectAt(window.runtimeLocalizationFixture.ids.lamp); }, { timeout: 30000 });
      const urls = fixture.requests.map((request) => request.path);
      check('loaded application is exactly the selected source or bundle', mode === 'source' ? urls.includes('/src/objects/popup.js') && urls.includes('/src/tracking-calibration.js')
        && !urls.includes('/dist/taylors3d-card.js') : urls.includes('/dist/taylors3d-card.js') && !urls.some((url) => url.startsWith('/src/')));
      await popupCaptionsAndSlider(page); await popupFencesAndPending(page); await calibrationCaptions(page); await calibrationFences(page);
      await popupCurrentEvidence(running.browser, fixture);
      check('no unexpected fixture requests or browser errors', fixture.unexpected.length === 0 && session.errors.length === 0, { unexpected: fixture.unexpected, errors: session.errors });
      errors.push(...session.errors);
    } catch (error) { check('runtime localization native scenario completes at ' + context, false, error.stack || error.message); }
    finally { if (session) { await session.page.evaluate(() => document.querySelector('taylors3d-card')?.remove()).catch(() => {}); await session.page.close(); }
      if (running) await running.close(); if (fixture) await fixture.close(); }
  }
}
assert(!(process.argv.includes('--source-only') && process.argv.includes('--bundle-only')), 'Select one mode or use default source plus bundle.');
try { if (process.argv.includes('--preflight')) await preflight(); else await nativeProof(); }
catch (error) { check('proof completes at ' + context, false, error.stack || error.message); }
console.log(`${checks.filter(Boolean).length}/${checks.length} runtime localization checks passed; ${process.argv.includes('--preflight') ? 'no browser launched' : `${errors.length} browser errors`}.`);
if (checks.some((pass) => !pass) || errors.length) process.exitCode = 1;
