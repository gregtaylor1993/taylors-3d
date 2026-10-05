// Actual source/bundle Root and four native editors; HA registries, readings,
// permissions and persistence are explicit anonymous fixtures. --preflight does
// not launch Chrome and cannot prove native geometry, GPU or Root history.
import fs from 'node:fs';
import path from 'node:path';
import { roomActionEntities, roomActionIds, roomActionLayoutKey, roomActionsHtml, prepareRoomActionsFixture, serveRoomActionsFixture } from './lib/room-actions-fixture.mjs';
import { areaEntity, entityAreaIds, entityAreaRoomId, entityAreaSpecifications, entityAreaLayout, entityAreaRegistry, prepareEntityAreaFilterFixture, assertEntityAreaBundlePrerequisites } from './lib/entity-area-filter-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const checks = [], browserErrors = [];
let mode = 'preflight', context = 'setup';
// Object key order is not a configuration edit; saved array order remains exact.
const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
const same = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const check = (name, pass, detail) => { checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${mode} ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const field = (spec, name, index) => `[data-field="${spec.prefix}${name}"]${index === undefined ? '' : spec.tab === 'rooms' ? `[data-ra-index="${index}"]` : spec.tab === 'house' ? `[data-house-summary-index="${index}"]` : `[data-target="${index}"]`}`;
const action = (spec, name) => `[data-act="${spec.prefix}${name}"]`;
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function control(page, selector, callback) {
  context = 'actual native control ' + selector;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const node = handle.asElement(); if (!node) throw new Error('Missing actual native control ' + selector);
    await node.evaluate((element) => element.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(node);
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (node) => node.click());
async function choose(page, selector, value, keepFocus = false) {
  await control(page, selector, async (node) => {
    const available = await node.evaluate((select, value) => [...select.options].some((option) => option.value === value && !option.disabled), value);
    if (!available) throw new Error('Exact native option is unavailable: ' + selector + ' / ' + value);
    if (!keepFocus) await node.focus(); await node.select(value);
  });
}
async function scalar(page, selector, value) {
  await control(page, selector, async (node) => { await node.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA');
    await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.type(value); });
}
const state = (page, spec) => page.evaluate((spec) => {
  const card = document.querySelector('taylors3d-card'), fixture = window.entityAreaFilterFixture, editor = card._edit[spec.controller], section = card.shadowRoot.querySelector(spec.section);
  const selector = (name, index) => `[data-field="${spec.prefix}${name}"]${index === undefined ? '' : spec.tab === 'rooms' ? `[data-ra-index="${index}"]` : spec.tab === 'house' ? `[data-house-summary-index="${index}"]` : `[data-target="${index}"]`}`;
  const options = (select) => [...(select?.options || [])].map((option) => ({ value: option.value, label: option.textContent, disabled: option.disabled, selected: option.selected }));
  let lights = 0; card._view.scene.traverse((node) => { if (node.isLight) lights++; });
  const filter = section.querySelector(selector('area-filter'));
  return { layout: structuredClone(card._layout), saved: structuredClone(fixture.saved), readings: structuredClone(card._hass.states),
    draft: editor.draft === undefined ? null : structuredClone(editor.draft), dirty: editor.dirty, stale: !!editor.stale, newSource: editor.newSource ?? editor.newPerson,
    calls: structuredClone(fixture.calls), commits: fixture.commits, writes: fixture.ws.filter((message) => message.type === 'taylors3d/layout/set').length,
    history: card._history.size, filter: filter.value, filterOptions: options(filter), candidate: section.querySelector(selector(spec.candidate)).value, candidates: options(section.querySelector(selector(spec.candidate))),
    sources: spec.saved.map((source) => ({ ...source, options: options(section.querySelector(selector(source.field, source.index))) })),
    saveDisabled: section.querySelector(`[data-act="${spec.prefix}save"]`).disabled,
    addDisabled: section.querySelector(`[data-act="${spec.prefix}${spec.pendingAction || 'add'}"]`)?.disabled,
    text: section.textContent, hasMarkup: !!section.querySelector('b,outside'), contexts: window.entityAreaContexts.size,
    sameRenderer: fixture.renderer === card._view.renderer, lights, pool: card._objects._slots.size };
}, spec);
const passive = (before, after) => same(before.layout, after.layout) && before.commits === after.commits && before.writes === after.writes
  && before.history === after.history && same(before.calls, after.calls) && same(before.readings, after.readings);
const has = (options, id, disabled = false) => options.some((option) => option.value === id && option.disabled === disabled);
const keptSources = (snapshot) => snapshot.sources.every((source) => has(source.options, areaEntity(source.domain, 'lounge')));

async function openEditor(page, spec) {
  if (!await page.evaluate(() => document.querySelector('taylors3d-card')._editing)) await click(page, '[data-bubble="edit"]');
  await click(page, `[data-act="tab"][data-id="${spec.tab}"]`);
  if (spec.tab === 'scenes') await choose(page, field(spec, 'binding'), '0');
  if (spec.tab === 'rooms') await choose(page, field(spec, 'room'), entityAreaRoomId);
}

async function filters(page, spec) {
  const before = await state(page, spec), lounge = areaEntity(spec.domain, 'lounge'), garden = areaEntity(spec.domain, 'garden'), unassigned = areaEntity(spec.domain, 'unassigned');
  const domains = spec.tab === 'rooms' ? ['scene', 'script'] : [spec.domain];
  check(`${spec.name} default All offers only supported domains and ordinary explicit sources`, before.filter === 'all' && has(before.candidates, lounge)
    && has(before.candidates, garden) && has(before.candidates, unassigned)
    && before.candidates.filter((option) => option.value).every((option) => domains.includes(option.value.split('.')[0]))
    && ['hidden', 'diagnostic', 'disabled'].every((variant) => !before.candidates.some((option) => option.value === areaEntity(spec.domain, variant)))
    && !before.hasMarkup && before.calls.length === 0 && before.writes === 0 && before.commits === 0, before.candidates);
  check(`${spec.name} does not invent eligibility for malformed source capability`,
    !before.candidates.some((option) => option.value === areaEntity(spec.domain, 'malformed')));
  await choose(page, field(spec, 'area-filter'), `area:${entityAreaIds.garden}`); let now = await state(page, spec);
  check(`${spec.name} exact garden filter retains healthy saved sources outside the filter`, now.filter === `area:${entityAreaIds.garden}` && has(now.candidates, garden)
    && !now.candidates.some((option) => option.value === unassigned) && (spec.tab === 'environment' || !now.candidates.some((option) => option.value === lounge))
    && keptSources(now) && passive(before, now) && same(before.draft, now.draft), { candidates: now.candidates, sources: now.sources });
  await choose(page, field(spec, 'area-filter'), `area:${entityAreaIds.lounge}`); now = await state(page, spec);
  check(`${spec.name} exact lounge filter follows the entity's parent-device area`, has(now.candidates, lounge)
    && !now.candidates.some((option) => option.value === garden || option.value === unassigned) && keptSources(now) && passive(before, now));
  await choose(page, field(spec, 'area-filter'), 'unassigned'); now = await state(page, spec);
  check(`${spec.name} Unassigned excludes inherited, hidden and administrative sources while saved choices stay visible`, has(now.candidates, unassigned)
    && !now.candidates.some((option) => option.value === garden) && (spec.tab === 'environment' || !now.candidates.some((option) => option.value === lounge))
    && ['hidden', 'diagnostic', 'disabled'].every((variant) => !now.candidates.some((option) => option.value === areaEntity(spec.domain, variant)))
    && keptSources(now) && passive(before, now));
  await choose(page, field(spec, 'area-filter'), `area:${entityAreaIds.garden}`);
  await page.evaluate((id) => { const card = document.querySelector('taylors3d-card'), areas = { ...card._hass.areas }; delete areas[id]; window.entityAreaFilterFixture.updateRegistry({ areas }); }, entityAreaIds.garden); await settle(page);
  now = await state(page, spec);
  check(`${spec.name} deleted selected area stays explicit and disabled with no guessed fallback`, now.filter === `area:${entityAreaIds.garden}`
    && has(now.filterOptions, now.filter, true) && !now.candidates.some((option) => option.value === garden || option.value === unassigned)
    && keptSources(now) && passive(before, now) && same(before.draft, now.draft), { filter: now.filter, options: now.filterOptions, candidates: now.candidates });
  await page.evaluate(() => window.entityAreaFilterFixture.updateRegistry({ areas: structuredClone(window.entityAreaFilterFixture.registryOriginal.areas) })); await settle(page);
  await choose(page, field(spec, 'area-filter'), 'all');
  // Selected-source eligibility is independent from the local area preference.
  const source = spec.saved[0], id = areaEntity(source.domain, 'lounge'), stable = await state(page, spec);
  await page.evaluate((id) => { const card = document.querySelector('taylors3d-card'), entities = { ...card._hass.entities, [id]: { ...card._hass.entities[id], hidden_by: 'user' } };
    window.entityAreaFilterFixture.updateRegistry({ entities }); }, id); await settle(page);
  now = await state(page, spec);
  check(`${spec.name} current hidden source remains a retained warning rather than becoming eligible through All`, has(now.sources[0].options, id, true)
    && same(stable.layout, now.layout) && same(stable.draft, now.draft) && now.calls.length === stable.calls.length && now.writes === stable.writes);
  await page.evaluate(() => window.entityAreaFilterFixture.updateRegistry({ entities: structuredClone(window.entityAreaFilterFixture.registryOriginal.entities) })); await settle(page);
  await openEditor(page, spec);
}

async function focusAndLocale(page, spec) {
  const before = await state(page, spec), selector = field(spec, 'area-filter');
  await choose(page, selector, `area:${entityAreaIds.garden}`);
  await control(page, selector, async (node) => { await node.focus(); await page.keyboard.press('Shift'); });
  await page.evaluate(({ selector, area }) => { const card = document.querySelector('taylors3d-card'), select = card.shadowRoot.querySelector(selector);
    window.entityAreaFocused = select; window.entityAreaFocusedOption = [...select.options].find((option) => option.value === `area:${area}`); }, { selector, area: entityAreaIds.garden });
  const labels = { de: 'Geräte nach Home-Assistant-Bereich filtern', fr: 'Filtrer les appareils par zone Home Assistant', es: 'Filtrar dispositivos por área de Home Assistant' };
  for (const [language, label] of Object.entries(labels)) {
    await page.evaluate(({ language, area }) => { const card = document.querySelector('taylors3d-card');
      window.entityAreaFilterFixture.updateRegistry({ areas: { ...card._hass.areas, [area]: { ...card._hass.areas[area], name: 'User_Renamed_<outside>été' } } });
      window.entityAreaFilterFixture.locale(language); }, { language, area: entityAreaIds.garden }); await settle(page);
    const focus = await page.evaluate(({ selector, label, area }) => { const card = document.querySelector('taylors3d-card'), select = card.shadowRoot.querySelector(selector), option = [...select.options].find((option) => option.value === `area:${area}`);
      return { same: select === window.entityAreaFocused, focus: card.shadowRoot.activeElement === select, sameOption: option === window.entityAreaFocusedOption,
        value: select.value, name: option.textContent, caption: select.closest('[data-entity-area-filter]').querySelector('[data-entity-area-label]').textContent, label,
        markup: !!select.closest('[data-entity-area-filter]').querySelector('outside') }; }, { selector, label, area: entityAreaIds.garden });
    const now = await state(page, spec);
    check(`${spec.name} ${language} registry/locale update keeps the same focused native filter and literal option`, focus.same && focus.focus && focus.sameOption
      && focus.value === `area:${entityAreaIds.garden}` && focus.name === 'User_Renamed_<outside>été' && focus.caption === label && !focus.markup
      && passive(before, now) && same(before.draft, now.draft), focus);
  }
  await page.evaluate(() => window.entityAreaFilterFixture.locale('en')); await settle(page);
}

function expectedLayout(before, spec) {
  const layout = structuredClone(before.layout);
  if (spec.tab === 'scenes') layout.scene_previews.items[0].label = spec.draftValue;
  if (spec.tab === 'rooms') layout.room_actions.rooms.find((row) => row.room_id === entityAreaRoomId).actions[0].label = spec.draftValue;
  if (spec.tab === 'environment') layout.weather.intensity = Number(spec.draftValue);
  if (spec.tab === 'house') layout.house_summary.title = spec.draftValue;
  return layout;
}
async function shortcutPending(page, spec, before) {
  const draftSelector = field(spec, spec.draftField, spec.draftIndex), filter = field(spec, 'area-filter');
  await choose(page, filter, `area:${entityAreaIds.garden}`); await choose(page, field(spec, 'new-source'), areaEntity('scene', 'garden'));
  await control(page, draftSelector, (node) => node.focus());
  await page.evaluate((selector) => { window.entityAreaLabel = document.querySelector('taylors3d-card').shadowRoot.querySelector(selector); }, draftSelector);
  const draft = await state(page, spec); await choose(page, filter, `area:${entityAreaIds.lounge}`, true);
  const kept = await page.evaluate((selector) => { const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector);
    return { same: node === window.entityAreaLabel, focus: card.shadowRoot.activeElement === node, value: node.value }; }, draftSelector);
  let now = await state(page, spec);
  check('Room shortcuts deliberate filter change clears pending source without poisoning the unrelated dirty label', kept.same && kept.focus && kept.value === spec.draftValue
    && now.newSource === '' && now.addDisabled && !now.saveDisabled && !now.stale && same(now.draft, draft.draft) && passive(before, now), { kept, stale: now.stale, newSource: now.newSource });
  await choose(page, filter, `area:${entityAreaIds.garden}`); await choose(page, field(spec, 'new-source'), areaEntity('scene', 'garden'));
  await control(page, action(spec, 'add'), async (node) => { await node.focus(); await page.keyboard.down('Space'); });
  const pressed = await state(page, spec); await choose(page, filter, `area:${entityAreaIds.lounge}`, true); await page.keyboard.up('Space'); await settle(page);
  now = await state(page, spec);
  check('Room shortcuts old held Add cannot run after a native filter choice clears its pending source', same(now.draft, pressed.draft) && now.newSource === ''
    && now.addDisabled && !now.saveDisabled && !now.stale && passive(before, now));
}

async function otherPending(page, spec, before) {
  const filter = field(spec, 'area-filter'), candidate = field(spec, spec.candidate), draftSelector = field(spec, spec.draftField, spec.draftIndex);
  await choose(page, filter, `area:${entityAreaIds.garden}`); await choose(page, candidate, areaEntity(spec.domain, 'garden'));
  await control(page, draftSelector, (node) => node.focus());
  await page.evaluate((selector) => { window.entityAreaLabel = document.querySelector('taylors3d-card').shadowRoot.querySelector(selector); }, draftSelector);
  const draft = await state(page, spec); await choose(page, filter, `area:${entityAreaIds.lounge}`, true);
  const kept = await page.evaluate((selector) => { const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector);
    return { same: node === window.entityAreaLabel, focus: card.shadowRoot.activeElement === node, value: node.value }; }, draftSelector);
  let now = await state(page, spec);
  check(`${spec.name} filter switch clears pending new source while keeping the same focused draft and valid Save`, kept.same && kept.focus && kept.value === spec.draftValue
    && now.candidate === '' && !now.saveDisabled && !now.stale && same(now.draft, draft.draft) && passive(before, now), { kept, candidate: now.candidate, stale: now.stale });
  await choose(page, filter, `area:${entityAreaIds.garden}`); await choose(page, candidate, areaEntity(spec.domain, 'garden'));
  await control(page, action(spec, spec.pendingAction), async (node) => { await node.focus(); await page.keyboard.down('Space'); });
  const pressed = await state(page, spec); await choose(page, filter, `area:${entityAreaIds.lounge}`, true); await page.keyboard.up('Space'); await settle(page);
  now = await state(page, spec);
  check(`${spec.name} old held Add cannot insert a source removed by the native filter`, same(now.draft, pressed.draft) && now.candidate === ''
    && !now.saveDisabled && !now.stale && passive(before, now));
}

async function historyAndDraft(page, spec) {
  const before = await state(page, spec), selector = field(spec, spec.draftField, spec.draftIndex);
  await scalar(page, selector, spec.draftValue); const changed = await state(page, spec);
  await choose(page, field(spec, 'area-filter'), `area:${entityAreaIds.lounge}`, true); let now = await state(page, spec);
  check(`${spec.name} changing the local filter preserves the exact dirty draft and enables only deliberate Save`, changed.dirty && now.dirty
    && same(changed.draft, now.draft) && passive(before, now) && !now.saveDisabled && !now.stale, { dirty: now.dirty, stale: now.stale });
  if (spec.tab === 'rooms') await shortcutPending(page, spec, before);
  if (spec.pendingAction) await otherPending(page, spec, before);
  await click(page, action(spec, 'save'));
  await page.waitForFunction((writes) => window.entityAreaFilterFixture.ws.filter((message) => message.type === 'taylors3d/layout/set').length === writes, {}, before.writes + 1); await settle(page);
  const saved = await state(page, spec), expected = expectedLayout(before, spec);
  check(`${spec.name} explicit native Save creates one exact layout/history/storage step`, same(saved.layout, expected) && same(saved.saved, expected)
    && saved.commits === before.commits + 1 && saved.writes === before.writes + 1 && saved.history === before.history + 1
    && same(saved.calls, before.calls) && same(saved.readings, before.readings) && !Object.hasOwn(saved.layout[spec.rawKey], 'area_filter'),
  { writes: [before.writes, saved.writes], commits: [before.commits, saved.commits], history: [before.history, saved.history] });
  await click(page, '[data-act="history-undo"]');
  await page.waitForFunction((writes) => window.entityAreaFilterFixture.ws.filter((message) => message.type === 'taylors3d/layout/set').length === writes, {}, before.writes + 2); await settle(page);
  const undone = await state(page, spec);
  check(`${spec.name} real Undo restores exact previous configuration without an entity action`, same(undone.layout, before.layout) && same(undone.calls, before.calls) && same(undone.readings, before.readings));
  await click(page, '[data-act="history-redo"]');
  await page.waitForFunction((writes) => window.entityAreaFilterFixture.ws.filter((message) => message.type === 'taylors3d/layout/set').length === writes, {}, before.writes + 3); await settle(page);
  const redone = await state(page, spec);
  check(`${spec.name} real Redo restores the exact new draft once`, same(redone.layout, expected) && redone.history === saved.history
    && redone.commits === before.commits + 3 && redone.writes === before.writes + 3 && same(redone.calls, before.calls));
  if (spec.tab === 'rooms') await choose(page, field(spec, 'room'), entityAreaRoomId);
  await scalar(page, selector, spec.tab === 'environment' ? '0.45' : 'User_Cancelled_<b>été'); await click(page, action(spec, 'cancel'));
  now = await state(page, spec);
  check(`${spec.name} Cancel after a separate draft leaves saved configuration and history untouched`, passive(redone, now));
}

async function phone(page, spec) {
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); window.entityAreaViewportIdentity = { card, renderer: card._view.renderer, fixture: window.entityAreaFilterFixture }; });
  await page.setViewport({ width: 320, height: 1050, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); await settle(page);
  check(`${spec.name} width-only touch resize retains the actual card, renderer and fixture`, await page.evaluate(() => {
    const previous = window.entityAreaViewportIdentity, card = document.querySelector('taylors3d-card');
    return !!previous && card === previous.card && card._view.renderer === previous.renderer && window.entityAreaFilterFixture === previous.fixture;
  }));
  await openEditor(page, spec);
  const before = await state(page, spec); await choose(page, field(spec, 'area-filter'), `area:${entityAreaIds.garden}`);
  await page.evaluate(() => window.entityAreaFilterFixture.locale('de')); await settle(page);
  const selectors = [field(spec, 'area-filter'), field(spec, spec.candidate), ...spec.saved.map((source) => field(spec, source.field, source.index)),
    field(spec, spec.draftField, spec.draftIndex), action(spec, 'save'), action(spec, 'cancel')];
  for (const selector of [...new Set(selectors)]) {
    await control(page, selector, async (node) => { await node.focus(); await page.keyboard.press('Shift'); });
    const geometry = await page.evaluate(({ selector, section }) => { const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector), box = node.getBoundingClientRect(), panel = card._edit.panel.getBoundingClientRect(), style = getComputedStyle(node), editor = card.shadowRoot.querySelector(section);
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
        panelTop: panel.top, panelBottom: panel.bottom, overflow: editor.scrollWidth > editor.clientWidth + 1, focused: card.shadowRoot.activeElement === node,
        disabled: node.disabled, outline: style.outlineStyle, outlineWidth: style.outlineWidth }; }, { selector, section: spec.section });
    check(`${spec.name} 320px ${selector} has44px native target and no horizontal overflow`, geometry.document <= 321 && geometry.left >= -1 && geometry.right <= 321
      && geometry.width >= 43.9 && geometry.height >= 43.9 && !geometry.overflow
      && geometry.top >= geometry.panelTop - 1 && geometry.bottom <= geometry.panelBottom + 1
      && (geometry.disabled || geometry.focused && geometry.outline !== 'none' && parseFloat(geometry.outlineWidth) >= 2), geometry);
  }
  const selector = field(spec, spec.draftField, spec.draftIndex), draftValue = spec.tab === 'environment' ? '0.55' : 'User_Phone_Draft_<b>été';
  await scalar(page, selector, draftValue); await choose(page, field(spec, 'area-filter'), `area:${entityAreaIds.lounge}`, true);
  const draft = await state(page, spec); check(`${spec.name} phone filter keeps an unfinished native draft without passive Save or service`, draft.dirty && !draft.stale && passive(before, draft));
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots', `entity-area-filter-${mode}-${spec.tab}-320.png`), fullPage: true });
  await click(page, action(spec, 'cancel')); const after = await state(page, spec);
  check(`${spec.name} phone Cancel retains one renderer/light pool and creates no layout/entity change`, passive(before, after) && after.contexts === 1 && after.sameRenderer
    && after.lights === before.lights && after.pool === before.pool);
}

async function nativeProof() {
  console.log('Scope: actual Root/source/bundle/native input and history; anonymous simulated HA registry/readings/model storage. No real HA or physical result claim.');
  const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
  let running, fixture, page;
  try {
    if (modes.includes('bundle')) {
      context = 'current distributed bundle prerequisite';
      console.log('Both current distributed bundle copies SHA256: ' + await assertEntityAreaBundlePrerequisites(root));
    }
    const { launch, newPage } = await import('./lib/demo-browser.mjs');
    for (mode of modes) {
      fixture = await serveRoomActionsFixture(root, mode); running = await launch();
      for (const spec of entityAreaSpecifications) {
        const requestStart = fixture.requests.length;
        const opened = await newPage(running.browser, { width: 1440, height: 1150, isMobile: true, hasTouch: true }); page = opened.page; const errors = opened.errors, external = [];
        await page.evaluateOnNewDocument(() => { window.entityAreaContexts = new Set(); const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const value = original.call(this, kind, ...args); if (value && /^webgl/.test(kind)) window.entityAreaContexts.add(this); return value; }; });
        page.on('request', (request) => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') external.push(url.href); });
        context = `${spec.name} actual Root initialization`;
        await page.goto(fixture.base + '/demo/room-actions-fixture.html', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.roomActionsModuleReady);
        await page.bringToFront(); await page.evaluate(prepareRoomActionsFixture, { layout: entityAreaLayout(fixture.model.length), readings: fixture.readings, entities: roomActionEntities, key: roomActionLayoutKey });
        await page.evaluate(prepareEntityAreaFilterFixture, { data: entityAreaRegistry() });
        await page.waitForFunction(() => { const card = document.querySelector('taylors3d-card'); return card._view?.model && !card._loading && card._roomList?.some((entry) => entry.room.id === 'm:fp_room_upper'); }, { timeout: 30000 }); await settle(page);
        await openEditor(page, spec); const before = await state(page, spec);
        check(`${spec.name} actual native tab starts on one authenticated model renderer with no commands`, before.contexts === 1 && before.sameRenderer && before.calls.length === 0
          && before.writes === 0 && before.commits === 0 && fixture.requests.slice(requestStart).some((request) => request.path === `/api/taylors3d/model/${roomActionLayoutKey}`));
        await filters(page, spec); await focusAndLocale(page, spec); await historyAndDraft(page, spec); await phone(page, spec);
        const after = await state(page, spec);
        check(`${spec.name} all filtering keeps the original renderer/light pool and only intentional Save/Undo/Redo writes`, after.contexts === 1 && after.sameRenderer
          && after.lights === before.lights && after.pool === before.pool && after.calls.length === 0 && after.commits === 3 && after.writes === 3, { commits: after.commits, writes: after.writes, lights: [before.lights, after.lights], pool: [before.pool, after.pool] });
        check(`${spec.name} no external/private assets, unexpected routes or browser errors`, external.length === 0 && fixture.unexpected.length === 0 && errors.length === 0, { external, routes: fixture.unexpected, errors });
        browserErrors.push(...errors); await page.close(); page = null;
      }
      await running.close(); running = null; await fixture.close(); fixture = null;
    }
  } catch (error) { console.error('Native area-filter proof stopped at ' + context + ': ' + error.stack); checks.push(false); }
  finally { if (page) await page.close(); if (running) await running.close(); if (fixture) await fixture.close(); }
}

async function preflight() {
  const { transform } = await import('esbuild'), { JSDOM } = await import('jsdom'), { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const fixture = await serveRoomActionsFixture(root, 'source');
  try {
    for (const kind of ['source', 'bundle']) {
      const html = roomActionsHtml(kind), dom = new JSDOM(html); await transform(dom.window.document.querySelector('script[type="module"]').textContent, { loader: 'js' });
      check(`${kind} fixture module parses and identifies simulated transport`, html.includes(`/${kind === 'source' ? 'src' : 'dist'}/taylors3d-card.js`) && dom.window.document.body.textContent.includes('SIMULATED Home Assistant')); dom.window.close();
    }
    await transform(`(${prepareRoomActionsFixture.toString()})`, { loader: 'js' }); await transform(`(${prepareEntityAreaFilterFixture.toString()})`, { loader: 'js' });
    const bytes = fixture.model, glb = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '', resolve, reject));
    check('shared authored GLB has exact upper room/light and uses no photo asset', !!glb.scene.getObjectByName(roomActionIds.upperRoom) && !!glb.scene.getObjectByName(roomActionIds.lamp));
    const denied = await fetch(fixture.base + `/api/taylors3d/model/${roomActionLayoutKey}`), allowed = await fetch(fixture.base + `/api/taylors3d/model/${roomActionLayoutKey}`, { headers: { authorization: 'Bearer simulated-room-actions' } });
    check('existing GLB server enforces its explicitly simulated model authorization', denied.status === 401 && allowed.status === 200 && (await allowed.arrayBuffer()).byteLength === bytes.length);
    const dom = new JSDOM('<!doctype html><div id="host"></div>', { url: 'http://fixture/' });
    for (const name of ['window', 'document', 'HTMLElement', 'Element', 'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
    const { ScenePreviewEditor } = await import('../src/scene-preview-editor.js'), { RoomActionsEditor } = await import('../src/room-actions-editor.js'),
      { WeatherEditor } = await import('../src/weather-editor.js'), { HouseSummaryEditor } = await import('../src/house-summary-editor.js');
    const editors = { scenes: ScenePreviewEditor, rooms: RoomActionsEditor, environment: WeatherEditor, house: HouseSummaryEditor };
    for (const spec of entityAreaSpecifications) {
      const host = document.querySelector('#host'), data = entityAreaRegistry(); let commands = 0, proposals = 0, editor;
      const card = { isConnected: true, _editing: true, _loading: false, _config: { layout_key: roomActionLayoutKey, layout_style: 'house' }, _layout: entityAreaLayout(bytes.length),
        _view: { model: { root: {} } }, _floors: [{ id: 'upper', elevation: 4 }], _roomList: [{ floorId: 'upper', room: { id: entityAreaRoomId, floor_id: 'upper' } }],
        _edit: { tab: spec.tab, panel: host, _generation: 1 }, houseSummaryEditorAvailable: () => true,
        _hass: { ...data, areas: { ...data.areas, [entityAreaIds.lounge]: { area_id: entityAreaIds.lounge, name: 'User_Lounge_été' } }, language: 'en', locale: { language: 'en' },
          user: { id: 'simulated-preflight', is_admin: true, is_active: true }, connection: { connected: true }, auth: {}, services: { scene: { turn_on: {} }, script: { turn_on: {} } }, callService() { commands++; }, callWS() { commands++; } },
        commitFeatureLayout(patch) { proposals++; card._layout = { ...card._layout, ...structuredClone(patch) }; }, previewSceneLights() {} };
      card._edit.commit = (layout) => { proposals++; card._layout = structuredClone(layout); };
      const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
      editor = new editors[spec.tab](card, render); render();
      const onChange = (event) => editor.onChange(event.target.dataset.field, event.target), onInput = (event) => editor.onInput(event.target.dataset.field, event.target),
        onClick = (event) => { const node = event.target.closest('button[data-act]'); if (node && !node.disabled) editor.onClick(node.dataset.act, node); };
      host.addEventListener('change', onChange); host.addEventListener('input', onInput); host.addEventListener('click', onClick);
      const select = (name, value, index) => { const node = host.querySelector(field(spec, name, index)); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); return node; };
      const options = (name, index) => [...host.querySelector(field(spec, name, index)).options].map((option) => ({ value: option.value, disabled: option.disabled }));
      if (spec.tab === 'scenes') select('binding', '0'); if (spec.tab === 'rooms') select('room', entityAreaRoomId);
      const before = structuredClone(card._layout), initial = structuredClone(editor.draft), candidate = spec.candidate;
      check(`${spec.name} actual editor DOM default All offers ordinary domains and no hidden/administrative choices`, editor.areaFilter.value === 'all'
        && ['lounge', 'garden', 'unassigned'].every((variant) => has(options(candidate), areaEntity(spec.domain, variant)))
        && ['hidden', 'diagnostic', 'disabled'].every((variant) => !options(candidate).some((option) => option.value === areaEntity(spec.domain, variant))));
      check(`${spec.name} actual DOM excludes a malformed capability/source`, !options(candidate).some((option) => option.value === areaEntity(spec.domain, 'malformed')));
      select('area-filter', `area:${entityAreaIds.garden}`);
      check(`${spec.name} actual DOM exact area retains saved healthy source choices`, has(options(candidate), areaEntity(spec.domain, 'garden'))
        && !options(candidate).some((option) => option.value === areaEntity(spec.domain, 'unassigned'))
        && spec.saved.every((source) => has(options(source.field, source.index), areaEntity(source.domain, 'lounge'))) && same(before, card._layout) && same(initial, editor.draft));
      select('area-filter', `area:${entityAreaIds.lounge}`);
      check(`${spec.name} actual DOM follows inherited parent-device area`, has(options(candidate), areaEntity(spec.domain, 'lounge')) && !options(candidate).some((option) => option.value === areaEntity(spec.domain, 'garden')));
      select('area-filter', 'unassigned'); check(`${spec.name} actual DOM Unassigned stays separate`, has(options(candidate), areaEntity(spec.domain, 'unassigned'))
        && !options(candidate).some((option) => option.value === areaEntity(spec.domain, 'garden')));
      const filter = select('area-filter', `area:${entityAreaIds.garden}`), option = [...filter.options].find((option) => option.value === filter.value); filter.focus();
      card._hass.areas[entityAreaIds.garden].name = 'User_Renamed_<outside>été'; card._hass.language = 'de'; card._hass.locale.language = 'de'; editor.updatePreviews(host);
      check(`${spec.name} actual DOM registry rename and locale keep exact focused select/option`, host.querySelector(field(spec, 'area-filter')) === filter && document.activeElement === filter
        && [...filter.options].find((node) => node.value === filter.value) === option && option.textContent === 'User_Renamed_<outside>été'
        && host.querySelector('[data-entity-area-label]').textContent === 'Geräte nach Home-Assistant-Bereich filtern' && !host.querySelector('outside') && same(initial, editor.draft));
      delete card._hass.areas[entityAreaIds.garden]; editor.updatePreviews(host);
      check(`${spec.name} actual DOM missing selected area stays disabled with no guessed choice`, filter.value === `area:${entityAreaIds.garden}` && filter.selectedOptions[0].disabled
        && !options(candidate).some((option) => option.value === areaEntity(spec.domain, 'garden')) && same(before, card._layout));
      card._hass.areas = { ...card._hass.areas, ...data.areas }; editor.updatePreviews(host); select('area-filter', 'all');
      const draftNode = host.querySelector(field(spec, spec.draftField, spec.draftIndex)); draftNode.value = spec.draftValue; draftNode.dispatchEvent(new Event('input', { bubbles: true }));
      const changed = structuredClone(editor.draft);
      if (spec.tab === 'rooms' || spec.pendingAction) { select(candidate, areaEntity(spec.domain, 'garden')); draftNode.focus(); }
      select('area-filter', `area:${entityAreaIds.lounge}`);
      check(`${spec.name} actual DOM filter switch retains dirty draft and valid Save without any proposal`, editor.dirty && !editor.stale && same(changed, editor.draft)
        && !host.querySelector(action(spec, 'save')).disabled && proposals === 0 && commands === 0
        && (spec.tab !== 'rooms' && !spec.pendingAction || host.querySelector(field(spec, candidate)).value === ''
          && host.querySelector(field(spec, spec.draftField, spec.draftIndex)) === draftNode && document.activeElement === draftNode
          && (spec.tab !== 'rooms' || editor.newSource === '') && (spec.tab !== 'house' || editor.newPerson === '')));
      host.querySelector(action(spec, 'cancel')).click(); check(`${spec.name} actual DOM Cancel retains exact saved settings without commands`, same(before, card._layout) && same(initial, editor.draft) && proposals === 0 && commands === 0);
      if (spec.tab === 'rooms') select('room', entityAreaRoomId);
      const savedNode = host.querySelector(field(spec, spec.draftField, spec.draftIndex)); savedNode.value = spec.draftValue; savedNode.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector(action(spec, 'save')).click();
      check(`${spec.name} actual editor delegates exactly one deliberate bounded configuration proposal`, same(card._layout, expectedLayout({ layout: before }, spec)) && proposals === 1 && commands === 0);
      editor.dispose(); host.removeEventListener('change', onChange); host.removeEventListener('input', onInput); host.removeEventListener('click', onClick);
    }
    dom.window.close(); console.log('Preflight proves fixture syntax/routes and real editor DOM only. Native Root/source+bundle geometry, GPU and Undo/Redo await the browser run.');
  } finally { await fixture.close(); }
}

if (process.argv.includes('--preflight')) await preflight(); else await nativeProof();
console.log(`${checks.filter(Boolean).length}/${checks.length} entity-area-filter checks passed; ${mode === 'preflight' ? 'no browser launched' : `${browserErrors.length} browser errors`}.`);
if (checks.some((pass) => !pass) || browserErrors.length) process.exitCode = 1;
