// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ObjectPopup, popupRows, objectAction, actionTarget } from '../src/objects/popup.js';
import { chainState } from '../src/objects/logic.js';

const st = (state, attributes = {}) => ({ state, attributes });
const kinds = (rows) => rows.map((r) => r.kind);

describe('popupRows', () => {
  it('light defaults: toggle, brightness, colour on a colour light', () => {
    const states = { 'light.a': st('on', { brightness: 128, supported_color_modes: ['hs', 'color_temp'], color_mode: 'hs',
      rgb_color: [255, 59, 48], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, friendly_name: 'Lamp A' }) };
    const obj = { id: 'l1', type: 'light' };
    const chain = chainState(obj, { entity: 'light.a' }, {}, states);
    const rows = popupRows(obj, chain, states);
    expect(kinds(rows)).toEqual(['toggle', 'brightness', 'color']);
    expect(rows[0]).toMatchObject({ entity: 'light.a', value: true });
    expect(rows[1]).toMatchObject({ entity: 'light.a', value: 128 });
    expect(rows[2].entity).toBe('light.a');
    expect(rows[2].whiteKelvin).toBe(2200);
  });

  it('keeps an unknown brightness honest and does not infer unsupported colour commands', () => {
    const states = { 'light.a': st('on', { supported_color_modes: ['brightness'], color_mode: 'brightness', rgb_color: [255, 59, 48] }) };
    const obj = { id: 'l1', type: 'light' };
    const rows = popupRows(obj, chainState(obj, { entity: 'light.a' }, {}, states), states);
    expect(kinds(rows)).toEqual(['toggle', 'brightness']); expect(rows[1].value).toBeNull();
  });

  it('offers only supported white temperature when the light has no RGB mode', () => {
    const states = { 'light.a': st('on', { supported_color_modes: ['color_temp'], color_mode: 'color_temp', brightness: 128,
      min_color_temp_kelvin: 3200, max_color_temp_kelvin: 5000, color_temp_kelvin: 3500 }) };
    const obj = { id: 'l1', type: 'light' };
    const row = popupRows(obj, chainState(obj, { entity: 'light.a' }, {}, states), states).find((r) => r.kind === 'color');
    expect(row).toMatchObject({ rgb: false, whiteKelvin: 3200 });
  });

  it('hides colour on a brightness-only light and brightness/colour on a relay', () => {
    const states = {
      'light.d': st('off', { supported_color_modes: ['brightness'] }),
      'switch.r': st('on'),
    };
    const obj = { id: 'l1', type: 'light' };
    expect(kinds(popupRows(obj, chainState(obj, { entity: 'light.d' }, {}, states), states))).toEqual(['toggle', 'brightness']);
    const rows = popupRows(obj, chainState(obj, { entity: 'switch.r' }, {}, states), states);
    expect(kinds(rows)).toEqual(['toggle']);
    expect(rows[0]).toMatchObject({ entity: 'switch.r', value: true });
  });

  it('off light: brightness value 0', () => {
    const states = { 'light.a': st('off', { supported_color_modes: ['brightness'] }) };
    const obj = { id: 'l1', type: 'light' };
    const rows = popupRows(obj, chainState(obj, { entity: 'light.a' }, {}, states), states);
    expect(rows[1].value).toBe(0);
  });

  it('generic default: state row with unit', () => {
    const states = { 'sensor.t': st('21.5', { unit_of_measurement: '°C' }) };
    const obj = { id: 'x', type: 'something' };
    const rows = popupRows(obj, chainState(obj, { entity: 'sensor.t' }, {}, states), states);
    expect(rows).toEqual([{ kind: 'state', entity: 'sensor.t', label: 'State', value: '21.5 °C' }]);
  });

  it('fp.ui.popup overrides the type default; unknown kinds dropped', () => {
    const states = { 'light.a': st('on', { brightness: 255, supported_color_modes: ['rgb'] }) };
    const obj = { id: 'l1', type: 'light', ui: { popup: ['brightness', 'bogus', 'state'] } };
    const rows = popupRows(obj, chainState(obj, { entity: 'light.a' }, {}, states), states);
    expect(kinds(rows)).toEqual(['brightness', 'state']);
  });

  it('grouped fixture: one chain row per controller and a reason row when dark', () => {
    const states = {
      'light.a': st('on', { brightness: 200, supported_color_modes: ['brightness'] }),
      'switch.g': st('off', { friendly_name: 'Group switch' }),
    };
    const groups = { hall: { entity: 'switch.g' } };
    const obj = { id: 'l1', type: 'light', group: 'hall' };
    const chain = chainState(obj, { entity: 'light.a' }, groups, states);
    const rows = popupRows(obj, chain, states, groups);
    expect(kinds(rows)).toEqual(['toggle', 'brightness', 'chain', 'reason']);
    expect(rows[0].entity).toBe('light.a');
    expect(rows[2]).toMatchObject({ entity: 'switch.g', label: 'Group switch', value: false });
    expect(rows[3].label).toBe('Group switch is off');
  });

  it('grouped fixture lit: chain row, no reason', () => {
    const states = { 'light.a': st('on', { supported_color_modes: ['onoff'] }), 'switch.g': st('on') };
    const groups = { hall: { entity: 'switch.g' } };
    const obj = { id: 'l1', type: 'light', group: 'hall' };
    const rows = popupRows(obj, chainState(obj, { entity: 'light.a' }, groups, states), states, groups);
    expect(kinds(rows)).toEqual(['toggle', 'chain']); // on/off-only light: no brightness
    expect(rows[1]).toMatchObject({ entity: 'switch.g', label: 'switch.g', value: true });
  });

  it('fixture without own entity: toggle targets the controller, no duplicate chain row', () => {
    const states = { 'switch.g': st('off') };
    const groups = { hall: { entity: 'switch.g' } };
    const obj = { id: 'l1', type: 'light', group: 'hall' };
    const rows = popupRows(obj, chainState(obj, { entity: null }, groups, states), states, groups);
    expect(kinds(rows)).toEqual(['toggle', 'reason']);
    expect(rows[0].entity).toBe('switch.g');
  });

  it('unavailable or missing entity: single state row "unavailable"', () => {
    const states = { 'light.a': st('unavailable') };
    const obj = { id: 'l1', type: 'light' };
    const one = [{ kind: 'state', label: 'State', value: 'unavailable' }];
    expect(popupRows(obj, chainState(obj, { entity: 'light.a' }, {}, states), states)).toEqual(one);
    expect(popupRows(obj, chainState(obj, { entity: null }, {}, {}), {})).toEqual(one);
    expect(popupRows(obj, null, {})).toEqual(one);
  });

  it('grouped fixture with an unavailable own entity: controller row and reason stay', () => {
    const groups = { hall: { entity: 'switch.g' } };
    const obj = { id: 'l1', type: 'light', group: 'hall' };
    let states = { 'light.a': st('unavailable', { friendly_name: 'Bulb' }), 'switch.g': st('off', { friendly_name: 'Relay' }) };
    let rows = popupRows(obj, chainState(obj, { entity: 'light.a' }, groups, states), states, groups);
    expect(rows).toEqual([
      { kind: 'chain', entity: 'switch.g', label: 'Relay', value: false },
      { kind: 'reason', label: 'Relay is off' },
    ]);
    states = { ...states, 'switch.g': st('on', { friendly_name: 'Relay' }) };
    rows = popupRows(obj, chainState(obj, { entity: 'light.a' }, groups, states), states, groups);
    expect(rows).toEqual([
      { kind: 'chain', entity: 'switch.g', label: 'Relay', value: true },
      { kind: 'reason', label: 'Bulb is unavailable' },
    ]);
  });

  it('nothing in the chain usable: single unavailable row', () => {
    const groups = { hall: { entity: 'switch.g' } };
    const obj = { id: 'l1', type: 'light', group: 'hall' };
    const states = { 'light.a': st('unavailable'), 'switch.g': st('unknown') };
    expect(popupRows(obj, chainState(obj, { entity: 'light.a' }, groups, states), states, groups))
      .toEqual([{ kind: 'state', label: 'State', value: 'unavailable' }]);
  });

  it('toggle row is labelled On / off', () => {
    const states = { 'switch.r': st('on') };
    const obj = { id: 'l1', type: 'light' };
    expect(popupRows(obj, chainState(obj, { entity: 'switch.r' }, {}, states), states)[0].label).toBe('On / off');
  });

  it('mower: state, battery and one start/dock row', () => {
    const states = { 'lawn_mower.m': st('docked', { battery_level: 87 }) };
    const obj = { id: 'm', type: 'mower' };
    const rows = popupRows(obj, chainState(obj, { entity: 'lawn_mower.m' }, {}, states), states);
    expect(kinds(rows)).toEqual(['state', 'battery', 'start_dock']);
    expect(rows[1].value).toBe('87 %');
  });

  it('climate: temperature and mode', () => {
    const states = { 'climate.c': st('heat', { current_temperature: 20.5, temperature_unit: '°C' }) };
    const obj = { id: 'c', type: 'climate' };
    const rows = popupRows(obj, chainState(obj, { entity: 'climate.c' }, {}, states), states);
    expect(rows).toEqual([
      { kind: 'temperature', entity: 'climate.c', label: 'Temperature', value: '20.5 °C' },
      { kind: 'mode', entity: 'climate.c', label: 'Mode', value: 'heat' },
    ]);
  });
});

describe('ObjectPopup supported controls', () => {
  let stage, popup, h, states, onAction, binding;
  const obj = { id: 'lamp', type: 'light', label: 'Desk fixture' };
  const control = (selector) => popup.el.querySelector(selector);
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  beforeEach(() => {
    states = { 'light.a': st('on', { brightness: 128, supported_color_modes: ['rgb', 'color_temp'], color_mode: 'rgb',
      rgb_color: [255, 59, 48], min_color_temp_kelvin: 3200, max_color_temp_kelvin: 6500 }) };
    h = { states, entities: {}, connected: true, services: { light: { turn_on: {}, toggle: {} } } };
    binding = { entity: 'light.a' }; onAction = vi.fn();
    stage = document.createElement('div'); document.body.append(stage);
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 });
    popup = new ObjectPopup(stage, { onAction, project: () => [100, 100], resolve: () =>
      ({ obj, chain: chainState(obj, binding, {}, states), states, groups: {}, hass: h }) });
    popup.open(obj, [0, 0, 0]);
  });
  afterEach(() => { popup.close(); stage.remove(); });

  it('opens without a command and warm-white uses the real supported minimum rather than a guessed 2700 K', async () => {
    expect(onAction).not.toHaveBeenCalled(); const white = control('[data-act="white"]');
    expect(white.title).toBe('Warmest supported white'); expect(white.dataset.kelvin).toBe('3200');
    white.click(); await flush();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.a', color_temp_kelvin: 3200 });
    expect(control('.fp-pop-reading').textContent).toBe('Brightness: 50%');
  });

  it('sends one supported RGB payload and leaves actual swatch selection unchanged until HA reports it', async () => {
    const red = control('[data-rgb="255,59,48"]'), blue = control('[data-rgb="10,132,255"]');
    expect(red.getAttribute('aria-pressed')).toBe('true'); blue.click(); await flush();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.a', rgb_color: [10, 132, 255] });
    expect(red.getAttribute('aria-pressed')).toBe('true'); expect(blue.getAttribute('aria-pressed')).toBe('false');
    states['light.a'].attributes.rgb_color = [10, 132, 255]; popup.update(); expect(blue.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps keyboard slider draft and focus through unrelated updates, sends once on change and then reads actual brightness', async () => {
    const slider = control('input'); slider.focus(); slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    states['sensor.power'] = st('32.1'); popup.update(); expect(control('input')).toBe(slider);
    expect(document.activeElement).toBe(slider); expect(slider.value).toBe('200'); expect(onAction).not.toHaveBeenCalled();
    slider.dispatchEvent(new Event('change', { bubbles: true })); await flush();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.a', brightness: 200 });
    expect(slider.value).toBe('128');
  });

  it.each(['unknown', 'unavailable', 'restored', 'malformed restored', 'missing', 'hidden', 'disabled', 'diagnostic', 'connection', 'service', 'capability'])('rejects a stale RGB action after %s revokes permission before refresh', (reason) => {
    const blue = control('[data-rgb="10,132,255"]');
    if (reason === 'unknown' || reason === 'unavailable') states['light.a'].state = reason;
    else if (reason === 'restored') states['light.a'].attributes.restored = true;
    else if (reason === 'malformed restored') states['light.a'].attributes.restored = 'false';
    else if (reason === 'missing') delete states['light.a'];
    else if (reason === 'hidden') h.entities['light.a'] = { hidden_by: 'user' };
    else if (reason === 'disabled') h.entities['light.a'] = { disabled_by: 'user' };
    else if (reason === 'diagnostic') h.entities['light.a'] = { entity_category: 'diagnostic' };
    else if (reason === 'connection') h.connection = { connected: false };
    else if (reason === 'service') h.services.light.turn_on = undefined;
    else states['light.a'].attributes.supported_color_modes = ['brightness'];
    blue.click(); expect(onAction).not.toHaveBeenCalled();
  });

  it('cancels a previously shown white action when its actual bounds change before refresh', () => {
    const white = control('[data-act="white"]'); states['light.a'].attributes.min_color_temp_kelvin = 4000;
    white.click(); expect(onAction).not.toHaveBeenCalled();
    popup.update(); white.click(); expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.a', color_temp_kelvin: 4000 });
  });

  it.each(['connection', 'service'])('cancels an interrupted slider gesture even if %s recovers before its queued release', (reason) => {
    const old = control('input'); old.value = '200'; old.dispatchEvent(new Event('input', { bubbles: true }));
    if (reason === 'connection') h.connected = false; else delete h.services.light.turn_on;
    popup.update(); if (reason === 'connection') h.connected = true; else h.services.light.turn_on = {};
    popup.update(); old.value = '200'; old.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
    old.value = '200'; old.dispatchEvent(new Event('input', { bubbles: true })); old.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.a', brightness: 200 });
  });

  it('blocks duplicate commands while pending and shows a safe readable error without changing HA state', async () => {
    let reject; onAction.mockReturnValueOnce(new Promise((_resolve, r) => { reject = r; }));
    const blue = control('[data-rgb="10,132,255"]'); blue.click(); blue.click();
    expect(onAction).toHaveBeenCalledTimes(1); expect(control('input').disabled).toBe(true);
    expect(popup.el.textContent).toContain('Sending command…');
    reject(new Error('<img src=x> denied')); await flush();
    expect(popup.el.querySelector('[role="alert"]').textContent).toContain('<img src=x> denied'); expect(popup.el.querySelector('img')).toBeNull();
    expect(blue.disabled).toBe(false); blue.click(); expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('cancels a pointer-cancelled brightness gesture until a fresh input', () => {
    const slider = control('input'); slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    slider.value = '200'; slider.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
    slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.a', brightness: 200 });
  });

  it('still cancels an unfinished blurred slider after connection loss and recovery', () => {
    const slider = control('input'); slider.focus(); slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.blur();
    h.connected = false; popup.update(); h.connected = true; popup.update();
    slider.value = '200'; slider.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
    slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.a', brightness: 200 });
  });

  it('does not read partially replaced legacy rows when removing a focused brightness input emits blur', () => {
    const slider = control('input'); slider.focus(); slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    const box = control('.fp-pop-rows'), descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    const errors = [], onError = (event) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener('error', onError);
    Object.defineProperty(box, 'innerHTML', { configurable: true, get: () => descriptor.get.call(box), set: (html) => {
      slider.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); descriptor.set.call(box, html);
    } });
    try {
      states['light.a'].state = 'unavailable'; popup.update();
      expect(errors).toEqual([]); expect(box.textContent).toBe('Stateunavailable');
      slider.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
      delete box.innerHTML; states['light.a'].state = 'on'; popup.update();
      const next = control('input'); expect(next).not.toBeNull(); next.value = '200'; next.dispatchEvent(new Event('input', { bubbles: true }));
      next.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.a', brightness: 200 });
    } finally { window.removeEventListener('error', onError); delete box.innerHTML; }
  });

  it.each(['close', 'reopen', 'removed binding'])('rejects controls retained from a prior %s', (reason) => {
    const blue = control('[data-rgb="10,132,255"]'), slider = control('input');
    if (reason === 'close') popup.close(); else if (reason === 'reopen') popup.open(obj, [0, 0, 0]);
    else { binding = { entity: null }; popup.update(); }
    blue.click(); slider.value = '200'; slider.dispatchEvent(new Event('change', { bubbles: true })); expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps state-only legacy callers working and names the keyboard-accessible swatches', () => {
    popup.resolve = () => ({ obj, chain: chainState(obj, binding, {}, states), states }); popup.update();
    const blue = control('[data-rgb="10,132,255"]'); expect(blue.getAttribute('aria-label')).toBe('Set blue');
    expect(popup.el.querySelector('style').textContent).toContain('min-height: 44px');
    blue.focus(); expect(document.activeElement).toBe(blue); blue.click(); expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('objectAction / actionTarget', () => {
  it('type defaults and fp.ui overrides, invalid falls back', () => {
    expect(objectAction({ type: 'light' }, 'tap')).toBe('toggle');
    expect(objectAction({ type: 'light' }, 'hold')).toBe('popup');
    expect(objectAction({ type: 'zzz' }, 'tap')).toBe('more-info');
    expect(objectAction({ type: 'light', ui: { tap: 'none' } }, 'tap')).toBe('none');
    expect(objectAction({ type: 'light', ui: { hold: 'bogus' } }, 'hold')).toBe('popup');
  });

  it('own entity first, else the group controller', () => {
    const groups = { g: { entity: 'switch.g' } };
    expect(actionTarget({ group: 'g' }, { entity: 'light.a' }, groups)).toBe('light.a');
    expect(actionTarget({ group: 'g' }, { entity: null }, groups)).toBe('switch.g');
    expect(actionTarget({}, null, groups)).toBe(null);
    expect(actionTarget({ group: 'g' }, { entity: 'light.a', hidden: true }, groups)).toBe(null);
  });

  it('unavailable own entity falls back to a usable group controller', () => {
    const groups = { g: { entity: 'switch.g' } };
    const states = { 'light.a': st('unavailable'), 'switch.g': st('off') };
    expect(actionTarget({ group: 'g' }, { entity: 'light.a' }, groups, states)).toBe('switch.g');
    expect(actionTarget({ group: 'g' }, { entity: 'light.a' }, groups, { ...states, 'light.a': st('on') })).toBe('light.a');
    // controller not usable either: the own entity (the caller shows the popup)
    expect(actionTarget({ group: 'g' }, { entity: 'light.a' }, groups, { ...states, 'switch.g': st('unknown') })).toBe('light.a');
    expect(actionTarget({}, { entity: 'light.a' }, {}, states)).toBe('light.a');
  });
});
