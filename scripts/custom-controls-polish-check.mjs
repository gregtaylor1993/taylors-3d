// Actual source/bundle card, native controls and anonymous simulated HA transport.
// This proves UI behaviour, never a physical household action or real persistence.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { clickEditorTab } from './lib/editor-tab-navigation.mjs';
import { roomActionEntities as entities, roomActionLayoutKey as key, prepareRoomActionsFixture,
  serveRoomActionsFixture } from './lib/room-actions-fixture.mjs';

const checks = [], browserErrors = [];
let mode = '', context = 'setup';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, pass, detail) => { checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${mode} ${name}${detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`); };
const action = (kind, button) => `[data-act="custom-controls-${kind}"][data-cc-bar="daily"]${button ? `[data-cc-button="${button}"]` : ''}`;
const field = (kind, button) => `[data-field="custom-controls-${kind}"][data-cc-bar="daily"]${button ? `[data-cc-button="${button}"]` : ''}`;
const native = (id) => `.custom-controls-host [data-custom-controls-button-id="${id}"]`;
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const savedWrite = (page, number) => page.waitForFunction((number) => window.roomActionsFixture.ws.filter((entry) => entry.type === 'taylors3d/layout/set').length === number, { timeout: 10000 }, number);

function data(fixture, saved) {
  const layout = saved || structuredClone(fixture.layout), readings = structuredClone(fixture.readings);
  readings.states[entities.scene].attributes.friendly_name = 'Simulated Movie routine';
  readings.states[entities.script].attributes.friendly_name = 'Simulated Return routine';
  readings.states[entities.vacuum].attributes.friendly_name = 'Simulated Downstairs robot';
  if (!saved) layout.custom_controls = { version: 1, opaque: { keep: ['α', false, null] }, bars: [{ id: 'daily', label: 'Simulated Daily',
    placement: 'bottom', style: 'pills', dock: { limit: 4, opaque: 'dock' }, opaque: 'bar', buttons: [
      { id: 'movie', label: 'Movie', icon: 'mdi:movie', color: 'amber', action: { type: 'scene', entity: entities.scene }, pinned: true, opaque: 'movie' },
      { id: 'bedtime', label: 'Bedtime', icon: 'mdi:weather-night', color: 'purple', action: { type: 'script', entity: entities.script }, pinned: true },
      { id: 'lamp', label: 'Light', icon: 'mdi:lightbulb', color: 'amber', action: { type: 'toggle', entity: entities.lamp }, pinned: true },
      { id: 'view', label: 'Ground', icon: 'mdi:home', color: 'theme', action: { type: 'view', view_id: 'ground' }, pinned: true },
      { id: 'info', label: 'Robot details', icon: 'mdi:robot-vacuum', color: 'teal', action: { type: 'more-info', entity: entities.vacuum } },
      { id: 'other', label: 'Another scene', icon: 'mdi:star', color: 'theme', action: { type: 'scene', entity: entities.scene } },
      { id: 'return', label: 'Return vacuum', icon: 'mdi:home-import-outline', color: 'teal', action: { type: 'script', entity: entities.script },
        visibility: { type: 'state', entity: entities.vacuum, state: 'cleaning', opaque: 'condition' } },
    ] }] };
  return { layout, readings, entities, key };
}

async function control(page, selector, operation) {
  context = `native ${selector}`;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const node = handle.asElement(); if (!node) { const detail = await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); return {
      editing: card?._editing, tab: card?._edit?.tab, editor: !!card?.shadowRoot.querySelector('[data-custom-controls-editor]'),
      body: card?.shadowRoot.querySelector('.tab-body')?.textContent?.slice(0, 600), bars: card?._edit?._customControlsEditor?.draft?.bars?.map((bar) => [bar.id, bar.buttons.map((button) => button.id)]) }; });
      throw Error('Missing native control ' + selector + ': ' + JSON.stringify(detail)); }
    await node.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const hit = await page.waitForFunction((element, selector) => {
      const shadow = document.querySelector('taylors3d-card').shadowRoot, rect = element.getBoundingClientRect(), point = [rect.x + rect.width / 2, rect.y + rect.height / 2];
      const target = shadow.elementFromPoint(...point);
      return element.isConnected && shadow.querySelector(selector) === element && rect.width > 0 && rect.height > 0
        && (target === element || element.contains(target)) ? point : false;
    }, { timeout: 10000 }, node, selector);
    try { await operation(node, await hit.jsonValue()); } finally { await hit.dispose(); }
  } finally { await handle.dispose(); }
  await settle(page);
}
const click = (page, selector, touch = false) => control(page, selector, (_node, point) => touch ? page.touchscreen.tap(...point) : page.mouse.click(...point));
const keyboard = (page, selector, key = 'Enter') => control(page, selector, async (node) => { await node.focus(); await page.keyboard.press(key); });
const type = (page, selector, value) => control(page, selector, async (node) => {
  await node.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace'); await page.keyboard.type(value);
});
const choose = (page, selector, value) => control(page, selector, async (node) => {
  if (!await node.evaluate((element, value) => [...element.options].some((entry) => entry.value === value && !entry.disabled), value)) throw Error('Unavailable source ' + value);
  await node.focus(); await node.select(value);
});
const state = (page) => page.evaluate(() => {
  const card = document.querySelector('taylors3d-card'), fixture = window.roomActionsFixture, editor = card._edit?._customControlsEditor;
  return { calls: structuredClone(fixture.calls), infos: [...fixture.infos], writes: fixture.ws.filter((entry) => entry.type === 'taylors3d/layout/set').length,
    commits: fixture.commits, history: card._history.size, layout: structuredClone(card._layout), saved: structuredClone(fixture.saved),
    draft: editor?.draft === undefined ? null : structuredClone(editor.draft), dirty: editor?.dirty, stale: editor?.stale,
    renderer: card._view.renderer === fixture.renderer, more: card.shadowRoot.querySelector('.custom-controls-host [data-custom-controls-more]')?.getAttribute('aria-expanded'),
    shown: [...card.shadowRoot.querySelectorAll('.custom-controls-host [data-custom-controls-button-id]')].filter((node) => node.getClientRects().length).map((node) => node.dataset.customControlsButtonId) };
});
async function geometry(page, name) {
  const result = await page.evaluate(() => {
    const shadow = document.querySelector('taylors3d-card').shadowRoot;
    const nodes = [...shadow.querySelectorAll('[data-custom-controls-view] button,[data-custom-controls-editor] :is(button,select,input:not([type=checkbox]),summary)')].filter((node) => node.getClientRects().length);
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, count: nodes.length,
      tiny: nodes.filter((node) => { const rect = node.getBoundingClientRect(); return rect.width < 43.9 || rect.height < 43.9; }).map((node) => [node.dataset.act || node.dataset.field || node.tagName, node.getBoundingClientRect().width, node.getBoundingClientRect().height]),
      overflow: nodes.filter((node) => { const rect = node.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1; }).map((node) => node.dataset.act || node.dataset.field || node.tagName) };
  });
  check(`${name} keeps44px native targets within the viewport`, result.count > 0 && !result.tiny.length && !result.overflow.length && result.document <= result.viewport + 1, result);
}

async function runtime(page) {
  const before = await state(page); check('only four deliberately pinned actions are visible', same(before.shown, ['movie', 'bedtime', 'lamp', 'view']) && before.calls.length === 0 && before.writes === 0);
  await keyboard(page, '[data-custom-controls-more="daily"]'); check('native keyboard More reveals overflow with no command', (await state(page)).shown.length === 7 && !(await state(page)).calls.length);
  await keyboard(page, native('return'), 'Space'); let current = await state(page);
  check('Return runs only its explicitly saved script', same(current.calls, [['script', 'turn_on', { entity_id: entities.script }]]) && current.writes === 0);
  await control(page, native('other'), async (node) => { await node.focus(); await page.keyboard.press('Escape'); });
  check('Escape closes More and restores dock focus', (await state(page)).more === 'false' && await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.activeElement?.dataset.customControlsMore === 'daily'));
  await page.evaluate((id) => window.roomActionsFixture.patch(id, 'docked'), entities.vacuum); await settle(page);
  await click(page, '[data-custom-controls-more="daily"]'); current = await state(page); check('a known false cleaning condition hides Return', !current.shown.includes('return') && current.shown.length === 6);
  for (const [reading, code] of [['unknown', 'condition_unknown'], ['unavailable', 'condition_missing']]) {
    await page.evaluate(({ id, reading }) => window.roomActionsFixture.patch(id, reading), { id: entities.vacuum, reading }); await settle(page);
    await click(page, '[data-custom-controls-more="daily"]');
    const reported = await page.evaluate((selector) => { const node = document.querySelector('taylors3d-card').shadowRoot.querySelector(selector); return { shown: !!node.getClientRects().length, disabled: node.disabled, status: node.parentElement.textContent }; }, native('return'));
    check(`${reading} condition remains visible, disabled and clearly explained`, reported.shown && reported.disabled && reported.status.includes(reading === 'unknown' ? 'known current state' : 'missing'), { code, ...reported });
  }
  await page.evaluate((id) => window.roomActionsFixture.patch(id, 'cleaning'), entities.vacuum); await settle(page); await click(page, '[data-custom-controls-more="daily"]');
  for (const pulse of ['connection', 'account', 'permission', 'source', 'condition']) {
    const calls = (await state(page)).calls.length;
    if ((await state(page)).more !== 'true') await click(page, '[data-custom-controls-more="daily"]');
    await control(page, native('return'), async (_node, point) => { await page.mouse.move(...point); await page.mouse.down();
      await page.evaluate(({ pulse, id, script }) => { if (pulse === 'condition') { window.roomActionsFixture.patch(id, 'docked'); window.roomActionsFixture.patch(id, 'cleaning'); }
        else window.roomActionsFixture.pulse(pulse, pulse === 'source' ? script : id); }, { pulse, id: entities.vacuum, script: entities.script });
      await page.mouse.up(); });
    check(`${pulse} change cancels a held overflow command through recovery`, (await state(page)).calls.length === calls);
  }
  await geometry(page, 'wide compact dock');
}

async function editor(page) {
  await click(page, '[data-bubble="edit"]');
  await clickEditorTab(page, 'controls');
  const before = await state(page), summary = '[data-cc-button-row="movie"] .cc-icon-picker>summary';
  await click(page, summary); await type(page, field('icon-search', 'movie'), 'robot vacuum');
  const icons = await page.evaluate(() => { const shadow = document.querySelector('taylors3d-card').shadowRoot, grid = shadow.querySelector('[data-cc-icon-grid="movie"]');
    return [...grid.querySelectorAll('svg path')].map((node) => node.getAttribute('d')); });
  check('visual search draws one local SVG icon without an external request', icons.length === 1 && /^M/.test(icons[0]));
  await keyboard(page, '[data-cc-button="movie"][data-cc-icon="mdi:robot-vacuum"]', 'Space');
  check('keyboard icon choice changes only the draft', (await state(page)).draft.bars[0].buttons[0].icon === 'mdi:robot-vacuum' && same((await state(page)).layout, before.layout));
  await type(page, field('source-search', 'movie'), 'Movie routine');
  const options = await page.evaluate((selector) => [...document.querySelector('taylors3d-card').shadowRoot.querySelector(selector).options].map((option) => ({ value: option.value, label: option.textContent })), field('source', 'movie'));
  check('friendly source search retains the exact ID in the option', options.some((option) => option.value === entities.scene && option.label.includes('Simulated Movie routine') && option.label.includes(entities.scene)));
  await keyboard(page, action('duplicate', 'movie')); let current = await state(page);
  const duplicate = current.draft.bars[0].buttons.find((button) => button.id === 'button_1');
  check('Duplicate chooses a globally fresh ID and retains action and opaque extras', duplicate?.opaque === 'movie' && duplicate.pinned === false && same(duplicate.action, before.layout.custom_controls.bars[0].buttons[0].action));
  await click(page, '[data-cc-bar-row="daily"]>details>summary'); await click(page, action('template-return-vacuum')); current = await state(page);
  const starter = current.draft.bars[0].buttons.find((button) => button.id === 'button_2');
  check('Return starter requires an exact existing script, never fabricated sources', starter?.starter === 'return-vacuum' && starter.action.type === 'script' && starter.action.entity === '' && current.calls.length === before.calls.length);
  await type(page, field('source-search', 'button_2'), 'Return routine'); await choose(page, field('source', 'button_2'), entities.script);
  await click(page, '[data-cc-button-row="button_2"] details:not(.cc-icon-picker)>summary'); await click(page, field('conditional', 'button_2'));
  // Enabling a rule redraws the draft; reopen its native details before filling it.
  await click(page, '[data-cc-button-row="button_2"] details:not(.cc-icon-picker)>summary');
  await type(page, field('condition-search', 'button_2'), 'Downstairs robot'); await choose(page, field('condition-source', 'button_2'), entities.vacuum);
  current = await state(page); check('Return rule saves the exact selected vacuum and cleaning state', same(current.draft.bars[0].buttons.find((button) => button.id === 'button_2').visibility,
    { type: 'state', entity: entities.vacuum, state: 'cleaning' }) && current.calls.length === before.calls.length && current.writes === before.writes);
  await geometry(page, 'wide visual builder');
  await page.setViewport({ width: 320, height: 950, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); await settle(page);
  await click(page, '[data-cc-button-row="movie"] .cc-icon-picker>summary', true); await type(page, field('icon-search', 'movie'), 'movie');
  await click(page, '[data-cc-button="movie"][data-cc-icon="mdi:movie"]', true); await geometry(page, '320px icon pictures and builder');
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots', `custom-controls-polish-${mode}-phone.png`), fullPage: true });
  const final = await state(page); check('all catalogue, template, search and preview operations dispatch zero actions or writes', final.calls.length === before.calls.length && final.writes === before.writes && final.commits === before.commits);
  const saved = final.draft; await click(page, '[data-act="custom-controls-save"]'); await savedWrite(page, before.writes + 1); await settle(page); current = await state(page);
  check('one Save persists the complete dock/rules/extras in one history step', same(current.layout.custom_controls, saved) && current.writes === before.writes + 1 && current.commits === before.commits + 1,
    { layoutParity: same(current.layout.custom_controls, saved), writesBefore: before.writes, writesAfter: current.writes, commitsBefore: before.commits, commitsAfter: current.commits, historyBefore: before.history, historyAfter: current.history });
  await click(page, '[data-act="history-undo"]'); await savedWrite(page, before.writes + 2); await settle(page); check('Undo restores the entire old dock and conditions without actions', same((await state(page)).layout.custom_controls, before.layout.custom_controls) && (await state(page)).calls.length === before.calls.length);
  await click(page, '[data-act="history-redo"]'); await savedWrite(page, before.writes + 3); await settle(page); check('Redo restores the exact authored controls and extensions', same((await state(page)).layout.custom_controls, saved));
  await click(page, '[data-act="custom-controls-duplicate"][data-cc-bar="daily"][data-cc-button="movie"]'); await click(page, '[data-act="custom-controls-cancel"]');
  current = await state(page); check('Cancel discards a later duplicate without a history/write/action', same(current.layout.custom_controls, saved) && current.calls.length === before.calls.length && current.writes === before.writes + 3,
    { layoutParity: same(current.layout.custom_controls, saved), callsBefore: before.calls.length, callsAfter: current.calls.length, writesBefore: before.writes, writesAfter: current.writes, commits: current.commits });
  await click(page, '[data-bubble="edit"]'); await geometry(page, '320px saved compact dock');
  await click(page, '[data-custom-controls-more="daily"]', true); check('native phone touch More reveals saved overflow', (await state(page)).shown.includes('button_2'));
  return (await state(page)).saved;
}

async function futureVisibility(page, fixture, saved) {
  const future = structuredClone(saved); future.custom_controls.bars[0].buttons[0].visibility = {
    type: 'future-rule', entity: 'vacuum.literal_future', state: 'cleaning', unknown: { retain: ['α', false, null] } };
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.roomActionsModuleReady);
  await page.evaluate(prepareRoomActionsFixture, data(fixture, future)); await settle(page); let current = await state(page);
  check('future visibility remains raw and disables the saved controls without passive commands', same(current.layout.custom_controls, future.custom_controls)
    && current.shown.length === 0 && current.calls.length === 0 && current.writes === 0 && current.commits === 0);
  const result = await page.evaluate(() => document.querySelector('taylors3d-card')._runCustomControl('daily', 'movie'));
  check('the actual root rejects direct dispatch through an unsupported visibility rule', result?.ok === false && (await state(page)).calls.length === 0);
  await click(page, '[data-bubble="edit"]'); await clickEditorTab(page, 'controls'); current = await state(page);
  check('the phone editor preserves future raw settings and requires an explicit replacement', same(current.draft, future.custom_controls)
    && await page.evaluate(() => { const shadow = document.querySelector('taylors3d-card').shadowRoot;
      return shadow.querySelector('[data-act="custom-controls-save"]').disabled && !shadow.querySelector('[data-cc-button-row]') && !!shadow.querySelector('[data-act="custom-controls-replace"]'); }));
  await click(page, '[data-act="custom-controls-replace"]');
  check('replacement changes only the draft until Save', same((await state(page)).draft, { version: 1, bars: [] })
    && same((await state(page)).layout.custom_controls, future.custom_controls) && (await state(page)).writes === 0);
  await click(page, '[data-act="custom-controls-cancel"]');
  check('Cancel restores the complete future rule and its extras without writing', same((await state(page)).draft, future.custom_controls)
    && same((await state(page)).layout.custom_controls, future.custom_controls) && (await state(page)).writes === 0);
  await click(page, '[data-act="custom-controls-replace"]'); await click(page, '[data-act="custom-controls-save"]'); await savedWrite(page, 1); current = await state(page);
  check('explicit replacement Save changes this feature once while preserving unrelated layout', same(current.layout.custom_controls, { version: 1, bars: [] })
    && same({ ...current.layout, custom_controls: undefined }, { ...future, custom_controls: undefined })
    && current.writes === 1 && current.commits === 1 && current.calls.length === 0);
}

async function run() {
  console.log('Scope: actual native source/bundle UI, simulated anonymous HA data/services/storage; no physical household proof.');
  if (fs.existsSync(path.join(root, 'dist/taylors3d-card.js'))) console.log('Bundle SHA256: ' + createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/taylors3d-card.js'))).digest('hex'));
  const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
  let fixture, browser;
  try {
    for (mode of modes) {
      fixture = await serveRoomActionsFixture(root, mode); browser = await launch(); const { page, errors } = await newPage(browser.browser, { width: 1440, height: 1200, hasTouch: true, isMobile: true });
      const external = []; page.on('request', (request) => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') external.push(url.href); });
      await page.goto(fixture.base + '/demo/room-actions-fixture.html', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.roomActionsModuleReady);
      await page.bringToFront(); await page.evaluate(prepareRoomActionsFixture, data(fixture)); await settle(page);
      await runtime(page); const saved = await editor(page);
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.roomActionsModuleReady);
      await page.evaluate(prepareRoomActionsFixture, data(fixture, saved)); await settle(page); const restored = await state(page);
      check('a real page reload recovers complete saved dock/templates/rules without automatic actions', same(restored.layout.custom_controls, saved.custom_controls) && !restored.calls.length && !restored.writes && restored.renderer);
      await futureVisibility(page, fixture, saved);
      check('no external assets, unexpected routes or browser errors', !external.length && !fixture.unexpected.length && !errors.length, { external, unexpected: fixture.unexpected, errors }); browserErrors.push(...errors);
      await page.close(); await browser.close(); browser = null; await fixture.close(); fixture = null; console.log(`Cleanup ${mode}: page, Chrome and fixture closed.`);
    }
  } catch (error) { console.error(`Polish proof stopped at ${context}: ${error.stack}`); checks.push(false); }
  finally { if (browser) await browser.close(); if (fixture) await fixture.close(); }
}
await run();
console.log(`${checks.filter(Boolean).length}/${checks.length} custom-controls-polish checks passed; ${browserErrors.length} browser errors.`);
if (checks.some((pass) => !pass) || browserErrors.length) process.exitCode = 1;
