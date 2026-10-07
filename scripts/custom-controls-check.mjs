import { revealEditorTab } from './lib/editor-tab-navigation.mjs';
// Native Chrome source/bundle proof. HA data, service replies and persistence are
// explicit simulations; the real card, editor, popup, renderer and input run here.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { roomActionEntities, roomActionLayoutKey as key, roomActionRoomId as roomId,
  prepareRoomActionsFixture, serveRoomActionsFixture } from './lib/room-actions-fixture.mjs';

const entities = { ...roomActionEntities, automation: 'automation.custom_simulated', sensor: 'sensor.custom_simulated' };
const checks = [], browserErrors = [];
let mode = '', context = 'setup';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, pass, detail) => { checks.push(!!pass); console.log(`${pass ? 'ok  ' : 'FAIL'} ${mode} ${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`); };
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const transitionsReady = (page) => page.waitForFunction(() => {
  const card = document.querySelector('taylors3d-card');
  return !!card?.isConnected && [...card.shadowRoot.querySelectorAll('[data-custom-controls-view] *,[data-custom-controls-editor] *')]
    .every((node) => node.getAnimations().every((animation) => !(animation instanceof CSSTransition) || ['finished', 'idle'].includes(animation.playState)));
}, { timeout: 10000 });
const bottom = (id) => `.custom-controls-host [data-custom-controls-button-id="${id}"]`;
const roomButton = (id) => `.t3d-custom-room-controls [data-custom-controls-button-id="${id}"]`;
const action = (kind, bar, button) => `[data-act="custom-controls-${kind}"]${bar ? `[data-cc-bar="${bar}"]` : ''}${button ? `[data-cc-button="${button}"]` : ''}`;
const field = (kind, bar, button) => `[data-field="custom-controls-${kind}"]${bar ? `[data-cc-bar="${bar}"]` : ''}${button ? `[data-cc-button="${button}"]` : ''}`;
const handle = (kind, bar, button) => `[data-cc-drag="${kind}"][data-cc-bar="${bar}"]${button ? `[data-cc-button="${button}"]` : ''}`;
const controlButton = (id, type, source, color = 'amber') => ({ id, label: `User_<b>${id}_été`, icon: 'mdi:gesture-tap-button', color,
  action: { type, ...(type === 'view' ? { view_id: source } : { entity: source }) }, extra: { preserve: [false, 'α', null] } });

function fixtureData(fixture) {
  const layout = structuredClone(fixture.layout), readings = structuredClone(fixture.readings);
  layout.custom_controls = { version: 1, extra: { preserve: 'envelope' }, bars: [
    { id: 'main', label: 'User_<b>Evening_été', placement: 'bottom', style: 'pills', extra: { preserve: 'main' }, buttons: [
      controlButton('scene', 'scene', entities.scene), controlButton('script', 'script', entities.script),
      controlButton('automation', 'automation', entities.automation, 'teal'),
      { ...controlButton('skip', 'automation', entities.automation, 'blue'), action: { type: 'automation', entity: entities.automation, skip_conditions: true } },
      controlButton('toggle', 'toggle', entities.lamp), controlButton('view', 'view', 'ground', 'theme'),
      controlButton('info', 'more-info', entities.sensor, 'purple'), controlButton('missing', 'scene', 'scene.saved_missing', 'red')] },
    { id: 'spare', label: 'User_Spare_été', placement: 'bottom', style: 'tiles', buttons: [], extra: { preserve: 'spare' } },
    { id: 'room', label: 'User_Room_Bar_été', placement: 'room', room_id: roomId, style: 'tiles', buttons: [controlButton('room_scene', 'scene', entities.scene, 'teal')], extra: { preserve: 'room' } },
  ] };
  readings.states[entities.automation] = { entity_id: entities.automation, state: 'off', attributes: { friendly_name: 'User_Automation_été' } };
  readings.states[entities.sensor] = { entity_id: entities.sensor, state: '18.5', attributes: { friendly_name: 'User_Temperature_été', unit_of_measurement: '°C' } };
  readings.services.automation = { trigger: {} };
  return { layout, readings, entities, key };
}

async function control(page, selector, operation) {
  await revealEditorTab(page, selector);
  context = `native control ${selector}`;
  const object = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const node = object.asElement(); if (!node) throw Error('Missing control ' + selector);
    await node.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const hit = await page.waitForFunction((element, selector) => {
      const shadow = document.querySelector('taylors3d-card').shadowRoot, rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const target = shadow.elementFromPoint(x, y);
      return element.isConnected && shadow.querySelector(selector) === element && rect.width > 0 && rect.height > 0
        && (target === element || element.contains(target)) ? [x, y] : false;
    }, { timeout: 10000 }, node, selector);
    try { await operation(node, await hit.jsonValue()); } finally { await hit.dispose(); }
  } finally { await object.dispose(); }
  await settle(page);
}
const click = (page, selector) => control(page, selector, (_node, point) => page.mouse.click(...point));
const choose = (page, selector, value) => control(page, selector, async (node) => {
  if (!await node.evaluate((select, value) => [...select.options].some((entry) => entry.value === value && !entry.disabled), value)) throw Error(`Unavailable exact option ${selector}: ${value}`);
  await node.focus(); await node.select(value);
});
const type = async (page, selector, value, blur = true) => {
  const closed = await page.evaluate((selector) => { const node = document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), picker = node?.closest('.cc-icon-picker');
    return picker && !picker.open ? `[data-cc-button-row="${picker.closest('[data-cc-button-row]').dataset.ccButtonRow}"] .cc-icon-picker>summary` : null; }, selector);
  if (closed) await click(page, closed);
  return control(page, selector, async (node) => {
  await node.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace'); await page.keyboard.type(value); if (blur) await page.keyboard.press('Tab');
  });
};
const snapshot = (page) => page.evaluate(() => {
  const card = document.querySelector('taylors3d-card'), fixture = window.roomActionsFixture, editor = card._edit?._customControlsEditor;
  return { calls: structuredClone(fixture.calls), infos: [...fixture.infos], commits: fixture.commits,
    writes: fixture.ws.filter((entry) => entry.type === 'taylors3d/layout/set').length, history: card._history.size,
    layout: structuredClone(card._layout), saved: structuredClone(fixture.saved), readings: structuredClone(card._hass.states),
    view: card._viewId, room: card._devicePopup?._selection?.room?.id, editing: card._editing, tab: card._edit?.tab,
    camera: { position: card._view.camera.position.toArray(), quaternion: card._view.camera.quaternion.toArray(), target: card._view.controls.target.toArray(), zoom: card._view.camera.zoom, mode: card._view.mode },
    viewSize: { sceneWidth: card._scene.clientWidth, sceneHeight: card._scene.clientHeight, canvasWidth: card._view.renderer.domElement.width, canvasHeight: card._view.renderer.domElement.height },
    draft: editor?.draft === undefined ? null : structuredClone(editor.draft), dirty: editor?.dirty, stale: editor?.stale, drag: editor?.drag?.active,
    renderer: card._view.renderer === fixture.renderer, contexts: window.customControlsContexts.size,
    buttons: [...card.shadowRoot.querySelectorAll('[data-custom-controls-button-id]')].map((node) => ({ id: node.dataset.customControlsButtonId, disabled: node.disabled,
      label: node.querySelector('.custom-controls-label')?.textContent, html: node.querySelector('.custom-controls-label')?.innerHTML, status: node.parentElement.textContent,
      shown: !!node.getClientRects().length, busy: node.getAttribute('aria-busy') })),
    section: card.shadowRoot.querySelector('[data-custom-controls-editor]')?.textContent || '' };
});
async function exactCall(page, name, selector, expected) {
  const before = await snapshot(page); await click(page, selector); const after = await snapshot(page);
  check(name, after.calls.length === before.calls.length + 1 && same(after.calls.at(-1), expected)
    && same(before.readings, after.readings) && after.writes === before.writes && after.commits === before.commits,
  { added: after.calls.length - before.calls.length, actual: after.calls.at(-1) });
}
async function openRoom(page) {
  if (await page.evaluate(() => document.querySelector('taylors3d-card')._devicePopup.isOpen)) await click(page, '.t3d-popup-close');
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card._setView('upper', { instant: true }); card._setMode('top'); }); await settle(page);
  const point = await page.evaluate(() => window.roomActionsFixture.roomPixel()); await page.mouse.click(...point); await settle(page);
  check('native authored room tap selects the exact room and its saved custom bar', (await snapshot(page)).room === roomId);
}
async function enterEditor(page) {
  if (await page.evaluate(() => document.querySelector('taylors3d-card')._devicePopup.isOpen)) await click(page, '.t3d-popup-close');
  if (!(await snapshot(page)).editing) await click(page, '[data-bubble="edit"]');
  await click(page, '[data-act="tab"][data-id="controls"]');
  check('Buttons and bars opens the real visual draft editor', (await snapshot(page)).tab === 'controls');
}
async function geometry(page, label, editing = false, room = false) {
  const result = await page.evaluate(({ editing, room }) => {
    const card = document.querySelector('taylors3d-card'), scope = card.shadowRoot.querySelector(editing ? '[data-custom-controls-editor]'
      : room ? '.t3d-custom-room-controls [data-custom-controls-view]' : '.custom-controls-host [data-custom-controls-view]');
    const nodes = [...scope.querySelectorAll('button,input:not([type=checkbox]),select')].filter((node) => node.getClientRects().length);
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, scope: { width: scope.clientWidth, scroll: scope.scrollWidth },
      tiny: nodes.filter((node) => { const rect = node.getBoundingClientRect(); return rect.width < 43.9 || rect.height < 43.9; }).map((node) => ({ id: node.dataset.field || node.dataset.act || node.dataset.customControlsButtonId,
        width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })), count: nodes.length };
  }, { editing, room });
  check(`${label} has no horizontal overflow and at least44px native controls`, result.document <= result.viewport + 1 && result.scope.scroll <= result.scope.width + 1 && result.count > 0 && !result.tiny.length, result);
}
async function screenshot(page, name) {
  fs.mkdirSync(path.join(root, 'screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'screenshots', `custom-controls-${mode}-${name}.png`), fullPage: true });
}
async function tileGeometry(page, selector, label) {
  const value = await page.evaluate((selector) => { const node = document.querySelector('taylors3d-card').shadowRoot.querySelector(selector);
    if (!node) return null; const css = getComputedStyle(node), rect = node.getBoundingClientRect();
    return { minHeight: parseFloat(css.minHeight), height: rect.height, radius: parseFloat(css.borderTopLeftRadius), direction: css.flexDirection, align: css.alignItems }; }, selector);
  check(`${label} actually renders the selected tile style with76px target/14px radius/column/start alignment`, value?.minHeight === 76
    && value.height >= 75.9 && value.radius === 14 && value.direction === 'column' && value.align === 'start', value);
}

async function readContrast(page, selector, includeDisabled = false) {
  return page.evaluate(({ selector, includeDisabled }) => {
      const card = document.querySelector('taylors3d-card');
      const parse = (value) => { const parts = value.match(/[\d.]+/g); if (!parts || !/^rgba?\(/.test(value)) return null;
        return [...parts.slice(0, 3).map(Number), parts.length === 4 ? Number(parts[3]) : 1]; };
      const blend = (front, back, alpha = front[3] ?? 1) => front.slice(0, 3).map((value, index) => value * alpha + back[index] * (1 - alpha));
      const parent = (node) => node.parentElement || node.getRootNode()?.host;
      const background = (node) => { if (!node) return [255, 255, 255]; const colour = parse(getComputedStyle(node).backgroundColor);
        return colour ? blend(colour, background(parent(node))) : null; };
      const luminance = (rgb) => rgb.map((channel) => channel / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      const read = (node) => {
        const css = getComputedStyle(node), colour = parse(css.color); let surface = background(node);
        if (!colour || !surface) return { kind: node.className, valid: false, foreground: css.color, background: css.backgroundColor };
        let foreground = blend(colour, surface);
        for (let current = node; current; current = parent(current)) {
          const opacity = Number(getComputedStyle(current).opacity);
          if (opacity < 1) { const below = background(parent(current)); if (!below) return { valid: false }; foreground = blend(foreground, below, opacity); surface = blend(surface, below, opacity); }
        }
        const a = luminance(foreground), b = luminance(surface), rect = node.getBoundingClientRect();
        const text = node.tagName === 'INPUT' ? node.value || node.getAttribute('aria-label') || node.placeholder : node.tagName === 'SELECT' ? node.selectedOptions[0]?.textContent : node.textContent;
        return { kind: node.className || node.dataset.field || node.dataset.ccText || node.tagName, id: node.closest('[data-custom-controls-button-id]')?.dataset.customControlsButtonId, text,
          palette: node.closest('.cc-preview > span[data-color]')?.dataset.color,
          foreground: css.color, surface: surface.map((value) => Math.round(value)), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), valid: true,
          width: rect.width, height: rect.height, disabled: node.disabled === true, opacity: css.opacity, border: css.borderTopStyle };
      };
      return [...card.shadowRoot.querySelectorAll(selector)]
        .filter((node) => node.getClientRects().length && (node.textContent.trim() || ['INPUT', 'SELECT'].includes(node.tagName))
          && (includeDisabled || !node.disabled && !node.closest('button:disabled'))).map(read);
  }, { selector, includeDisabled });
}

async function contrast(page) {
  const before = await snapshot(page);
  for (const scheme of ['dark', 'light', 'ha']) {
    await page.evaluate((scheme) => { const card = document.querySelector('taylors3d-card'); card.setConfig({ ...card._config, house_colour_scheme: scheme }); }, scheme);
    await page.waitForFunction((scheme) => document.querySelector('taylors3d-card').getAttribute('data-taylors3d-scheme') === (scheme === 'ha' ? null : scheme), {}, scheme); await settle(page);
    await openRoom(page);
    await transitionsReady(page);
    // Disabled saved links remain covered explicitly; their readable reason and
    // native disabled state are deliberate parts of this runtime presentation.
    const values = await readContrast(page, '[data-custom-controls-view] .custom-controls-label,[data-custom-controls-view] .custom-controls-heading,[data-custom-controls-view] .custom-controls-status', true);
    check(`${scheme} actual bottom/room button labels, bar headings and unavailable status have at least4.5:1 computed text contrast`, values.length >= 12
      && values.every((entry) => entry.valid && entry.ratio >= 4.5), values);
    await geometry(page, `${scheme} paired theme controls`); await screenshot(page, `${scheme}-contrast`);
    await click(page, '.t3d-popup-close');
    await enterEditor(page);
    await type(page, field('button-label', 'main', 'scene'), 'User_Contrast_Draft_été');
    await transitionsReady(page);
    const editorValues = await readContrast(page, '[data-custom-controls-editor] [data-cc-text],[data-custom-controls-editor] [data-cc-bar-name],'
      + '[data-custom-controls-editor] [data-cc-preview-name],[data-custom-controls-editor] [data-cc-source-status],'
      + '[data-custom-controls-editor] .cc-preview span span,[data-custom-controls-editor] input:not([type=checkbox]),[data-custom-controls-editor] select');
    const failed = editorValues.filter((entry) => !entry.valid || entry.ratio < 4.5), save = editorValues.find((entry) => entry.kind === 'save');
    check(`${scheme} actual editor captions, help, status, inputs, static previews and enabled Save have at least4.5:1 contrast`, editorValues.length >= 90
      && save?.ratio >= 4.5 && failed.length === 0, { count: editorValues.length, minimum: Math.min(...editorValues.map((entry) => entry.ratio || 0)), save, failed });
    const palettes = { amber: [255, 199, 103], teal: [81, 212, 196], blue: [156, 200, 255], purple: [212, 181, 255], red: [255, 180, 171] };
    const previews = editorValues.filter((entry) => Object.hasOwn(palettes, entry.palette));
    check(`${scheme} static previews retain all five chosen palette backgrounds and Save retains its amber accent`, previews.length >= 8
      && previews.every((entry) => same(entry.surface, palettes[entry.palette])) && same(save?.surface, palettes.amber), { previews: previews.map((entry) => [entry.palette, entry.surface]), save: save?.surface });
    await geometry(page, `${scheme} editor controls`, true); await screenshot(page, `${scheme}-editor-contrast`);
    await click(page, action('cancel')); await transitionsReady(page);
    const disabled = await readContrast(page, '[data-custom-controls-editor] [data-act="custom-controls-save"],'
      + '[data-custom-controls-editor] [data-act="custom-controls-bar-up"][data-cc-bar="main"],'
      + '[data-custom-controls-editor] [data-act="custom-controls-move"][data-cc-bar="main"][data-cc-button="scene"]', true);
    check(`${scheme} representative disabled Save/up/move stay readable and natively disabled with explicit dashed styling`, disabled.length === 3
      && disabled.every((entry) => entry.disabled && entry.valid && entry.ratio >= 4.5 && entry.opacity === '1' && entry.border === 'dashed'), disabled);
    await click(page, '[data-bubble="edit"]');
  }
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card.setConfig({ ...card._config, house_colour_scheme: 'dark' }); }); await settle(page);
  const after = await snapshot(page); check('paired theme checks preserve saved layout, actual states and service/write counts', same(before.layout, after.layout)
    && same(before.readings, after.readings) && before.calls.length === after.calls.length && before.writes === after.writes && before.commits === after.commits);
}

async function runtime(page) {
  const before = await snapshot(page);
  check('saved literal labels render as text and missing saved links remain visible and disabled', before.buttons.find((entry) => entry.id === 'scene')?.html === 'User_&lt;b&gt;scene_été'
    && before.buttons.find((entry) => entry.id === 'missing')?.disabled && before.buttons.find((entry) => entry.id === 'missing')?.shown
    && before.calls.length === 0 && before.writes === 0 && before.commits === 0 && before.contexts === 1 && before.renderer, before.buttons);
  await geometry(page, 'wide bottom bars'); await screenshot(page, 'wide');
  for (const [id, domain, service, data] of [
    ['scene', 'scene', 'turn_on', { entity_id: entities.scene }], ['script', 'script', 'turn_on', { entity_id: entities.script }],
    ['automation', 'automation', 'trigger', { entity_id: entities.automation, skip_condition: false }],
    ['skip', 'automation', 'trigger', { entity_id: entities.automation, skip_condition: true }], ['toggle', 'light', 'toggle', { entity_id: entities.lamp }],
  ]) await exactCall(page, `native ${id} sends one exact advertised action without changing reported states`, bottom(id), [domain, service, data]);
  let old = await snapshot(page); await click(page, bottom('view')); let current = await snapshot(page);
  check('saved view button selects its exact actual floor view without an HA call or write', current.view === 'ground' && current.calls.length === old.calls.length && current.writes === old.writes);
  old = current; await click(page, bottom('info')); current = await snapshot(page);
  check('All controls emits exact HA more-info without a service command or inferred state', same(current.infos, [...old.infos, entities.sensor]) && current.calls.length === old.calls.length && same(current.readings, old.readings));
  await openRoom(page); await tileGeometry(page, roomButton('room_scene'), 'wide room');
  await exactCall(page, 'exact authored room custom button dispatches scene.turn_on', roomButton('room_scene'), ['scene', 'turn_on', { entity_id: entities.scene }]);
  await click(page, '.t3d-popup-close');
  old = await snapshot(page);
  await control(page, bottom('scene'), (node) => node.evaluate((element) => element.click())); current = await snapshot(page);
  check('independent native DOM assistive-style click after a completed pointer gesture requests the exact current action once', current.calls.length === old.calls.length + 1
    && same(current.calls.at(-1), ['scene', 'turn_on', { entity_id: entities.scene }]) && current.writes === old.writes && same(current.readings, old.readings));
  old = current;
  await control(page, bottom('scene'), async (node) => { await node.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('End'); });
  const focused = await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.activeElement?.dataset.customControlsButtonId);
  current = await snapshot(page); check('native bar arrow/End navigation skips the unavailable saved link without dispatching an action', focused === 'info'
    && current.calls.length === old.calls.length && current.writes === old.writes);
}

async function held(page) {
  for (const placement of ['bottom', 'room']) for (const loss of ['source', 'account', 'connection', 'service', 'permission', 'metadata']) for (const gesture of ['pointer', 'Space', 'Enter']) {
    if (placement === 'room') await openRoom(page);
    const selector = placement === 'room' ? roomButton('room_scene') : bottom('scene'), before = await snapshot(page);
    await control(page, selector, async (node, point) => { await node.focus();
      if (gesture === 'pointer') { await page.mouse.move(...point); await page.mouse.down(); } else await page.keyboard.down(gesture);
    });
    const pressed = await snapshot(page); await page.evaluate(({ loss, entity }) => window.roomActionsFixture.pulse(loss, entity), { loss, entity: entities.scene });
    if (gesture === 'pointer') await page.mouse.up(); else { if (gesture === 'Enter') await page.keyboard.down('Enter'); await page.keyboard.up(gesture); } await settle(page);
    const after = await snapshot(page), initial = gesture === 'Enter' ? 1 : 0;
    check(`${placement} held ${gesture} cancels stale release/repeat after ${loss} loss/recovery`, pressed.calls.length === before.calls.length + initial && after.calls.length === pressed.calls.length
      && after.writes === before.writes && after.commits === before.commits, { before: before.calls.length, pressed: pressed.calls.length, after: after.calls.length });
    if (placement === 'room') await openRoom(page);
    await exactCall(page, `fresh ${placement} ${gesture}/${loss} input works once`, selector, ['scene', 'turn_on', { entity_id: entities.scene }]);
    if (placement === 'room') await click(page, '.t3d-popup-close');
  }
}

async function pendingAndLocale(page) {
  let before = await snapshot(page); await page.evaluate(() => window.roomActionsFixture.queue.push('deferred'));
  await click(page, bottom('automation')); await click(page, bottom('automation')); let after = await snapshot(page);
  check('pending action blocks duplicate native presses and leaves reported off automation state unchanged', after.calls.length === before.calls.length + 1
    && after.buttons.find((entry) => entry.id === 'automation')?.busy === 'true' && same(after.readings, before.readings));
  await page.evaluate(() => window.roomActionsFixture.finish('SIMULATED refusal <b>literal')); await settle(page); after = await snapshot(page);
  check('current rejection remains an honest failure with no invented success/state', after.buttons.find((entry) => entry.id === 'automation')?.status.includes('Could not run')
    && !after.buttons.find((entry) => entry.id === 'automation')?.disabled && same(after.readings, before.readings));
  await page.evaluate(() => window.roomActionsFixture.queue.push('deferred')); await click(page, bottom('automation'));
  await page.evaluate(() => { window.roomActionsFixture.pulse('account'); window.roomActionsFixture.finish('OLD_ACCOUNT_ERROR'); }); await settle(page);
  check('old deferred result cannot attach failure or success to a recovered account', !(await snapshot(page)).buttons.find((entry) => entry.id === 'automation')?.status.includes('Could not run'));
  before = await snapshot(page);
  await control(page, bottom('scene'), (node) => node.focus());
  await page.evaluate((selector) => { const card = document.querySelector('taylors3d-card'); window.customControlsFocused = card.shadowRoot.querySelector(selector); }, bottom('scene'));
  for (const language of ['de', 'fr', 'es', 'en']) {
    await page.evaluate((language) => window.roomActionsFixture.locale(language), language); await settle(page);
    const focused = await page.evaluate((selector) => { const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector);
      return node === window.customControlsFocused && card.shadowRoot.activeElement === node && node.querySelector('.custom-controls-label').textContent === 'User_<b>scene_été'; }, bottom('scene'));
    after = await snapshot(page); check(`${language} updates retain the exact focused native button and literal saved name without actions/writes`, focused
      && after.calls.length === before.calls.length && after.writes === before.writes && after.commits === before.commits && after.renderer);
  }
}

async function drag(page, source, target, gesture = 'mouse', cancel = false) {
  context = `actual ${gesture} drag ${source} → ${target}`;
  const before = await snapshot(page);
  let active;
  await control(page, source, async (_node, point) => {
    if (gesture === 'touch') await page.touchscreen.touchStart(...point); else { await page.mouse.move(...point); await page.mouse.down(); }
    // Scrolling both controls to centre can give them identical client points.
    // Make an actual deliberate movement before scrolling the destination into view.
    if (gesture === 'touch') await page.touchscreen.touchMove(point[0] + 12, point[1] + 12);
    else await page.mouse.move(point[0] + 12, point[1] + 12, { steps: 4 });
  });
  active = (await snapshot(page)).drag;
  const point = await page.evaluate((target) => { const node = document.querySelector('taylors3d-card').shadowRoot.querySelector(target);
    if (!node) throw Error('Missing drag target ' + target); node.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = node.getBoundingClientRect(); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; }, target);
  if (gesture === 'touch') await page.touchscreen.touchMove(...point); else await page.mouse.move(...point, { steps: 8 });
  await settle(page);
  const observed = await page.evaluate((point) => { const card = document.querySelector('taylors3d-card'), drag = card._edit._customControlsEditor.drag, hit = card.shadowRoot.elementFromPoint(...point);
    return { gesture: drag?.gesture ? { moved: drag.gesture.moved, destination: drag.gesture.destination, source: drag.gesture.barId } : null,
      hit: hit?.outerHTML?.slice(0, 350), scroll: card._editPanel?.scrollTop }; }, point);
  if (cancel) await page.keyboard.press('Escape');
  if (gesture === 'touch') await page.touchscreen.touchEnd(); else await page.mouse.up(); await settle(page);
  const after = await snapshot(page);
  // OrbitControls recomputes its spherical position/orientation every frame.
  // Measured drift: 4.4e-13m position, 1.11e-16 quaternion component. These
  // independent bounds remain far below visible motion; target/zoom/mode and
  // the actual scene/canvas viewport must still remain exactly unchanged.
  const positionDifference = Math.max(...after.camera.position.map((value, index) => Math.abs(value - before.camera.position[index]))), positionBound = 1e-10;
  const quaternionDifference = Math.max(...after.camera.quaternion.map((value, index) => Math.abs(value - before.camera.quaternion[index]))), quaternionBound = 8 * Number.EPSILON;
  const exactPose = same({ ...before.camera, position: undefined, quaternion: undefined }, { ...after.camera, position: undefined, quaternion: undefined });
  const exactViewport = same(before.viewSize, after.viewSize);
  check(`native ${gesture} drag used the owned handle, kept the camera fixed and cleared capture/listeners on ${cancel ? 'Escape' : 'release'}`, active && !after.drag && exactPose && exactViewport
    && positionDifference <= positionBound && quaternionDifference <= quaternionBound,
    { ...observed, positionDifference, positionBound, quaternionDifference, quaternionBound, exactPose, exactViewport,
      cameraBefore: before.camera, cameraAfter: after.camera, viewportBefore: before.viewSize, viewportAfter: after.viewSize });
}

async function makeNewBar(page) {
  await click(page, action('add-bar')); await type(page, field('bar-label', 'bar_1'), 'User_<b>New_Bar_été');
  await choose(page, field('style', 'bar_1'), 'tiles'); await click(page, action('add-button', 'bar_1'));
  await type(page, field('button-label', 'bar_1', 'button_1'), 'User_New_Automation_été'); await type(page, field('icon', 'bar_1', 'button_1'), 'mdi:doorbell');
  await choose(page, field('color', 'bar_1', 'button_1'), 'teal'); await choose(page, field('action', 'bar_1', 'button_1'), 'automation');
  await choose(page, field('source', 'bar_1', 'button_1'), entities.automation); await click(page, field('skip', 'bar_1', 'button_1'));
}

async function editor(page) {
  await enterEditor(page); const before = await snapshot(page);
  const attempted = await page.evaluate(() => document.querySelector('taylors3d-card')._runCustomControl('main', 'scene'));
  check('root explicitly rejects saved-button dispatch while editing and previews remain inert', attempted?.ok === false && (await snapshot(page)).calls.length === before.calls.length);
  await geometry(page, 'wide draft builder', true);
  await type(page, field('button-label', 'main', 'scene'), 'User_Draft_été', false);
  await page.evaluate((selector) => { const card = document.querySelector('taylors3d-card'); window.customControlsInput = card.shadowRoot.querySelector(selector); }, field('button-label', 'main', 'scene'));
  for (const language of ['de', 'fr', 'es', 'en']) {
    await page.evaluate((language) => { const card = document.querySelector('taylors3d-card'); window.roomActionsFixture.locale(language);
      const view = card._views.find((entry) => entry.id === 'ground'); if (view) view.label = `Translated ${language}`;
      const entry = card._roomList.find((entry) => entry.room.id === 'm:fp_room_upper'); if (entry) entry.name = `Room ${language}`;
      card._edit._customControlsEditor.observe(); card._edit._customControlsEditor.updatePreviews(card._editPanel);
    }, language); await settle(page);
    const focused = await page.evaluate((selector) => { const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector);
      return node === window.customControlsInput && card.shadowRoot.activeElement === node && node.value === 'User_Draft_été'; }, field('button-label', 'main', 'scene'));
    const current = await snapshot(page); check(`${language} harmless names/locale preserve unfinished editor input and runnable draft ownership`, focused && !current.stale
      && current.calls.length === before.calls.length && same(current.layout, before.layout) && current.writes === before.writes);
  }
  await click(page, action('cancel')); check('Cancel restores saved labels and imported extras with zero layout/history/device writes', same((await snapshot(page)).draft, before.layout.custom_controls)
    && same((await snapshot(page)).layout, before.layout) && (await snapshot(page)).writes === before.writes);
  await drag(page, handle('bar', 'room'), handle('bar', 'main'));
  let current = await snapshot(page); check('actual bar drag reorders only the draft', current.draft.bars.map((bar) => bar.id).join(',') === 'room,main,spare' && same(current.layout, before.layout));
  await click(page, action('cancel'));
  await drag(page, handle('button', 'main', 'script'), handle('button', 'main', 'scene'));
  current = await snapshot(page); check('actual within-bar button drag changes only its exact draft order', current.draft.bars[0].buttons.slice(0, 2).map((button) => button.id).join(',') === 'script,scene'
    && same(current.layout, before.layout) && current.calls.length === before.calls.length && current.writes === before.writes);
  await click(page, action('cancel'));
  await drag(page, handle('button', 'main', 'scene'), handle('bar', 'spare'));
  current = await snapshot(page); check('actual cross-bar button drag preserves exact action, ID and extra data', current.draft.bars[1].buttons[0]?.id === 'scene'
    && same(current.draft.bars[1].buttons[0], before.layout.custom_controls.bars[0].buttons[0]) && same(current.layout, before.layout), current.draft.bars.map((bar) => [bar.id, bar.buttons.map((button) => button.id)]));
  await click(page, action('cancel'));
  await drag(page, handle('button', 'main', 'scene'), handle('bar', 'spare'), 'touch');
  current = await snapshot(page); check('actual native touch drag moves a button between bars without a device/write', current.draft.bars[1].buttons[0]?.id === 'scene'
    && current.calls.length === before.calls.length && current.writes === before.writes, current.draft.bars.map((bar) => [bar.id, bar.buttons.map((button) => button.id)])); await click(page, action('cancel'));
  await drag(page, handle('button', 'main', 'scene'), handle('bar', 'spare'), 'mouse', true);
  check('Escape cancels an actual drag without changing draft, camera or shared layout', same((await snapshot(page)).draft, before.layout.custom_controls)
    && same((await snapshot(page)).layout, before.layout));
  await control(page, action('bar-up', 'spare'), async (node) => { await node.focus(); await page.keyboard.press('Space'); });
  await choose(page, field('move-to', 'main', 'scene'), 'spare');
  await control(page, action('move', 'main', 'scene'), async (node) => { await node.focus(); await page.keyboard.press('Enter'); });
  current = await snapshot(page); check('keyboard-accessible Up and Move-to controls reorder/move only the explicit draft', current.draft.bars[0].id === 'spare'
    && current.draft.bars[0].buttons[0]?.id === 'scene' && current.calls.length === before.calls.length && current.writes === before.writes);
  await click(page, action('cancel')); await makeNewBar(page);
  await choose(page, field('placement', 'bar_1'), 'room'); await choose(page, field('room', 'bar_1'), roomId); current = await snapshot(page);
  const roomDraft = current.draft.bars.find((bar) => bar.id === 'bar_1');
  check('native placement and room pickers assign only the exact current room in the draft', roomDraft?.placement === 'room' && roomDraft.room_id === roomId
    && current.calls.length === before.calls.length && current.writes === before.writes && same(current.layout, before.layout));
  await click(page, action('cancel')); await makeNewBar(page); current = await snapshot(page);
  const added = current.draft.bars.find((bar) => bar.id === 'bar_1')?.buttons[0];
  check('native Add bar/button edits label, icon, colour, action and explicit Skip conditions in a draft only', added?.label === 'User_New_Automation_été'
    && added.icon === 'mdi:doorbell' && added.color === 'teal' && same(added.action, { type: 'automation', entity: entities.automation, skip_conditions: true })
    && current.calls.length === before.calls.length && current.writes === before.writes && same(current.layout, before.layout), added);
  const draft = current.draft; await click(page, action('save'));
  await page.waitForFunction((writes) => window.roomActionsFixture.ws.filter((entry) => entry.type === 'taylors3d/layout/set').length === writes, {}, before.writes + 1); await settle(page);
  const saved = await snapshot(page); check('explicit Save makes exactly one shared layout/history step and preserves every unrelated field', same(saved.layout.custom_controls, draft)
    && same({ ...saved.layout, custom_controls: undefined }, { ...before.layout, custom_controls: undefined })
    && saved.commits === before.commits + 1 && saved.history === before.history + 1 && saved.writes === before.writes + 1 && saved.calls.length === before.calls.length);
  await click(page, '[data-act="history-undo"]');
  await page.waitForFunction((writes) => window.roomActionsFixture.ws.filter((entry) => entry.type === 'taylors3d/layout/set').length === writes, {}, before.writes + 2); await settle(page); current = await snapshot(page);
  check('native Undo restores the entire saved previous controls without device action', same(current.layout.custom_controls, before.layout.custom_controls)
    && current.writes === before.writes + 2 && current.calls.length === before.calls.length);
  await click(page, '[data-act="history-redo"]');
  await page.waitForFunction((writes) => window.roomActionsFixture.ws.filter((entry) => entry.type === 'taylors3d/layout/set').length === writes, {}, before.writes + 3); await settle(page); current = await snapshot(page);
  check('native Redo restores the exact new bar/button and imported extras', same(current.layout.custom_controls, draft) && current.writes === before.writes + 3 && current.calls.length === before.calls.length);
  await click(page, '[data-bubble="edit"]'); await tileGeometry(page, bottom('button_1'), 'new saved bottom bar');
  await exactCall(page, 'newly saved automation button runs only after leaving editing', bottom('button_1'),
    ['automation', 'trigger', { entity_id: entities.automation, skip_condition: true }]);
  return (await snapshot(page)).saved;
}

async function narrow(page) {
  await page.setViewport({ width: 320, height: 900, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); await settle(page);
  await geometry(page, '320px bottom bars'); await tileGeometry(page, bottom('button_1'), '320px bottom bar');
  await openRoom(page); await geometry(page, '320px room tiles', false, true); await tileGeometry(page, roomButton('room_scene'), '320px room'); await screenshot(page, 'phone-room');
  await enterEditor(page); await geometry(page, '320px editor', true); await screenshot(page, 'phone-editor');
  const before = await snapshot(page); await control(page, field('button-label', 'main', 'scene'), (node) => node.focus());
  await page.keyboard.press('Shift'); const result = await page.evaluate((selector) => { const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector), rect = node.getBoundingClientRect(), css = getComputedStyle(node);
    return { focused: card.shadowRoot.activeElement === node, left: rect.left, right: rect.right, outline: css.outlineStyle, width: parseFloat(css.outlineWidth) }; }, field('button-label', 'main', 'scene'));
  check('320px focused builder input remains readable and has visible keyboard focus', result.focused && result.left >= -1 && result.right <= 321 && result.outline !== 'none' && result.width >= 2, result);
  await click(page, action('cancel')); await click(page, '[data-bubble="edit"]'); const after = await snapshot(page);
  check('phone resize/focus/editor previews do not dispatch actions or write configuration', after.calls.length === before.calls.length && after.writes === before.writes && after.commits === before.commits);
}

async function run() {
  console.log('Scope: actual card/editor/popup/renderer and Chrome mouse, touch and keyboard; simulated anonymous HA services/WS/readings/storage. No real household persistence or device result proof.');
  if (fs.existsSync(path.join(root, 'dist/taylors3d-card.js'))) console.log('Bundle SHA256: ' + createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/taylors3d-card.js'))).digest('hex'));
  const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
  let browser, fixture, activeErrors = [];
  try {
    for (mode of modes) {
      fixture = await serveRoomActionsFixture(root, mode); browser = await launch();
      const { page, errors } = await newPage(browser.browser, { width: 1440, height: 1150, hasTouch: true, isMobile: true });
      activeErrors = errors;
      page.on('pageerror', (error) => console.error(`${mode} browser error: ${error.message}`));
      await page.evaluateOnNewDocument(() => { window.customControlsContexts = new Set(); const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const value = original.call(this, kind, ...args); if (value && /^webgl/.test(kind)) window.customControlsContexts.add(this); return value; }; });
      const external = []; page.on('request', (request) => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') external.push(url.href); });
      context = 'load actual card module'; await page.goto(fixture.base + '/demo/room-actions-fixture.html', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.roomActionsModuleReady);
      context = 'prepare explicit anonymous HA/model fixture'; await page.bringToFront(); await page.evaluate(prepareRoomActionsFixture, fixtureData(fixture));
      await page.evaluate(() => { const card = document.querySelector('taylors3d-card'), fixture = window.roomActionsFixture, base = fixture.pulse;
        fixture.pulse = (kind, entity) => { if (kind !== 'metadata') return base(kind, entity); const old = card._hass;
          card.hass = { ...old, entities: { ...old.entities, [entity]: { ...old.entities[entity], area_id: 'simulated-other-room' } } }; card.hass = { ...old }; };
      });
      context = 'wait for actual authored model and canonical room';
      await page.waitForFunction(() => { const card = document.querySelector('taylors3d-card'); return card._view?.model && !card._loading && card._roomList?.some((entry) => entry.room.id === 'm:fp_room_upper'); }, { timeout: 30000 }); await settle(page);
      await contrast(page); await runtime(page); await held(page); await pendingAndLocale(page); const saved = await editor(page); await narrow(page);
      const end = await snapshot(page); check('all editing and native actions retain one existing renderer and use only explicit Save/Undo/Redo writes', end.renderer && end.contexts === 1 && end.writes === 3 && end.commits === 3, { contexts: end.contexts, writes: end.writes, commits: end.commits });
      context = 'actual page reload with simulated saved layout'; await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.roomActionsModuleReady);
      await page.evaluate(prepareRoomActionsFixture, { ...fixtureData(fixture), layout: saved }); await settle(page);
      const reload = await snapshot(page); check('actual page reload recovers the simulated saved full controls with no automatic action or write', same(reload.layout.custom_controls, saved.custom_controls)
        && reload.calls.length === 0 && reload.writes === 0 && reload.commits === 0 && reload.contexts === 1 && reload.renderer);
      check('no external/private assets, unexpected fixture routes or browser errors', external.length === 0 && fixture.unexpected.length === 0 && errors.length === 0, { external, unexpected: fixture.unexpected, errors });
      browserErrors.push(...errors); activeErrors = []; context = `${mode} native page cleanup`; console.log(`Cleanup ${mode}: closing native page`);
      await page.close(); context = `${mode} Chrome cleanup`; console.log(`Cleanup ${mode}: closing Chrome`);
      await browser.close(); browser = null; context = `${mode} fixture cleanup`; console.log(`Cleanup ${mode}: closing fixture`);
      await fixture.close(); fixture = null; console.log(`Cleanup ${mode}: complete`);
    }
  } catch (error) { console.error(`Native custom controls proof stopped at ${context}: ${error.stack}`); browserErrors.push(...activeErrors); checks.push(false); }
  finally { if (browser) await browser.close(); if (fixture) await fixture.close(); }
}
await run();
console.log(`${checks.filter(Boolean).length}/${checks.length} custom-controls checks passed; ${browserErrors.length} browser errors.`);
if (checks.some((pass) => !pass) || browserErrors.length) process.exitCode = 1;
