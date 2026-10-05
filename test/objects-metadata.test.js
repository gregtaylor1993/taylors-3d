// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindObjects, chainState, effectiveGroups } from '../src/objects/logic.js';
import { actionTarget, ObjectPopup, popupRows } from '../src/objects/popup.js';

const state = (value = 'on', attributes = {}) => ({ state: value, attributes });
const object = { id: 'fixture', type: 'light', suggest: { entity: 'light.suggested' } };
const source = (entities = {}, devices = {}) => ({
  states: { 'light.suggested': state(), 'light.saved': state(), 'switch.relay': state() },
  entities, devices,
});

describe('legacy object bindings with full current HA metadata', () => {
  it.each([
    ['hidden', { hidden: true }],
    ['hidden', { hidden_by: 'user' }],
    ['disabled', { disabled: true }],
    ['disabled', { disabled_by: 'integration' }],
    ['diagnostic', { entity_category: 'diagnostic' }],
    ['config', { entity_category: 'config' }],
  ])('does not automatically bind a %s entity by its suggested name', (reason, entry) => {
    const hass = source({ 'light.suggested': entry });
    expect(bindObjects([object], {}, hass.states, hass).get(object.id)).toEqual({
      entity: null, requestedEntity: 'light.suggested', auto: true, hidden: false,
      missing: false, filtered: true, filterReason: reason,
    });
  });

  it('uses disabled device inheritance rather than only the entity flags', () => {
    const hass = source({ 'light.suggested': { device_id: 'device-1' } }, { 'device-1': { disabled_by: 'user' } });
    expect(bindObjects([object], {}, hass.states, hass).get(object.id)).toMatchObject({
      entity: null, filtered: true, filterReason: 'disabled', requestedEntity: 'light.suggested',
    });
  });

  it.each(['hidden', 'disabled', 'diagnostic'])('preserves the exact saved %s ID instead of substituting the eligible suggestion', (kind) => {
    const registry = kind === 'diagnostic' ? { entity_category: kind } : { [kind]: true };
    const hass = source({ 'light.saved': registry });
    const saved = { fixture: { entity: 'light.saved', hidden: true, extra: 'preserved' } };
    const before = JSON.stringify(saved);
    const binding = bindObjects([object], saved, hass.states, hass).get(object.id);
    expect(binding).toEqual({ entity: null, requestedEntity: 'light.saved', auto: false, hidden: true,
      missing: false, filtered: true, filterReason: kind });
    expect(JSON.stringify(saved)).toBe(before);
  });

  it.each([{}, { 'light.gone': { name: 'Registered without a current state' } }])('retains a missing saved ID, including a registry-only source', (entities) => {
    const hass = source(entities);
    const binding = bindObjects([object], { fixture: { entity: 'light.gone' } }, hass.states, hass).get(object.id);
    expect(binding).toEqual({ entity: null, requestedEntity: 'light.gone', auto: false, hidden: false,
      missing: true, filtered: false, filterReason: 'missing' });
  });

  it('does not trust stale supplied states after the actual current source disappears', () => {
    const hass = source(), previous = hass.states;
    hass.states = {};
    expect(bindObjects([object], {}, previous, hass).get(object.id)).toMatchObject({
      entity: null, missing: true, requestedEntity: 'light.suggested',
    });
  });

  it('keeps an eligible unavailable binding selected without pretending that it is lit', () => {
    const hass = source(); hass.states['light.suggested'] = state('unavailable');
    const binding = bindObjects([object], {}, hass.states, hass).get(object.id);
    expect(binding).toEqual({ entity: 'light.suggested', requestedEntity: 'light.suggested', auto: true,
      hidden: false, missing: false, filtered: false, filterReason: '' });
    expect(chainState(object, binding, {}, hass.states)).toMatchObject({ lit: false, unavailable: true });
  });

  it('keeps an explicit empty selection unbound rather than returning to the suggestion', () => {
    const hass = source();
    expect(bindObjects([object], { fixture: { entity: null } }, hass.states, hass).get(object.id)).toEqual({
      entity: null, requestedEntity: null, auto: false, hidden: false, missing: false, filtered: false, filterReason: '',
    });
  });

  it('preserves the legacy state-only binding output shape when hass is omitted', () => {
    const hass = source({ 'light.suggested': { hidden: true } });
    expect(bindObjects([object], {}, hass.states).get(object.id)).toEqual({
      entity: 'light.suggested', auto: true, missing: false, hidden: false,
    });
  });

  it('retains saved group warnings and extras without adding them to the active chain', () => {
    const hass = source({ 'switch.relay': { entity_category: 'diagnostic' } });
    const saved = { hidden: { entity: 'switch.relay', extra: 3 }, missing: { entity: 'switch.gone' } };
    const before = JSON.stringify(saved), groups = effectiveGroups(saved, hass.states, hass);
    expect(groups.hidden).toEqual({ entity: null, requestedEntity: 'switch.relay', extra: 3,
      missing: false, filtered: true, filterReason: 'diagnostic' });
    expect(groups.missing).toEqual({ entity: null, requestedEntity: 'switch.gone',
      missing: true, filtered: false, filterReason: 'missing' });
    expect(chainState({ ...object, group: 'hidden' }, { entity: null }, groups, hass.states).entities).toEqual([]);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('uses current device eligibility for group controllers and permits current unavailable selections', () => {
    const hass = source({ 'switch.relay': { device_id: 'disabled' } }, { disabled: { disabled_by: 'integration' } });
    expect(effectiveGroups({ group: { entity: 'switch.relay' } }, hass.states, hass).group)
      .toMatchObject({ entity: null, requestedEntity: 'switch.relay', filtered: true, filterReason: 'disabled' });
    delete hass.devices.disabled.disabled_by; hass.states['switch.relay'] = state('unavailable');
    expect(effectiveGroups({ group: { entity: 'switch.relay' } }, hass.states, hass).group)
      .toEqual({ entity: 'switch.relay', requestedEntity: 'switch.relay', missing: false, filtered: false, filterReason: '' });
  });

  it('does not activate a stale controller snapshot or a inherited state property', () => {
    const hass = source(), previous = hass.states;
    hass.states = Object.create({ 'switch.relay': previous['switch.relay'] });
    expect(effectiveGroups({ relay: { entity: 'switch.relay' } }, previous, hass).relay)
      .toMatchObject({ entity: null, requestedEntity: 'switch.relay', missing: true, filterReason: 'missing' });
  });

  it('keeps an exact special-character group name as own data without changing the result prototype', () => {
    const hass = source(), groups = JSON.parse('{"__proto__":{"entity":"switch.relay"}}');
    const effective = effectiveGroups(groups, hass.states, hass);
    expect(Object.getPrototypeOf(effective)).toBe(Object.prototype);
    expect(Object.hasOwn(effective, '__proto__')).toBe(true);
    expect(chainState({ group: '__proto__' }, { entity: null }, effective, hass.states).entities).toEqual(['switch.relay']);
  });

  it('does not silently target a group when an explicit own source becomes ineligible or missing', () => {
    const hass = source({ 'light.saved': { hidden: true } }), groups = { relay: { entity: 'switch.relay' } };
    const grouped = { ...object, group: 'relay' };
    const filtered = bindObjects([object], { fixture: { entity: 'light.saved' } }, hass.states, hass).get(object.id);
    expect(actionTarget(grouped, filtered, groups, hass.states)).toBeNull();
    const missing = bindObjects([object], { fixture: { entity: 'light.gone' } }, hass.states, hass).get(object.id);
    expect(actionTarget(grouped, missing, groups, hass.states)).toBeNull();
    const unavailable = { entity: 'light.saved', requestedEntity: 'light.saved', auto: false, filtered: false, missing: false };
    hass.states['light.saved'] = state('unavailable');
    expect(actionTarget(grouped, unavailable, groups, hass.states)).toBe('switch.relay');
  });
});

describe('legacy object popup shared names and readings', () => {
  const values = (entity, hass, kinds = ['state']) => {
    const obj = { id: 'value', type: 'generic', ui: { popup: kinds } };
    return popupRows(obj, chainState(obj, { entity }, {}, hass.states), hass.states, {}, hass);
  };

  it('uses HA native state formatting once, without appending the unit twice', () => {
    const hass = { states: { 'sensor.temperature': state('21.456', { unit_of_measurement: '°C' }) },
      formatEntityState: vi.fn(() => '21.5 °C') };
    expect(values('sensor.temperature', hass)).toEqual([{ kind: 'state', entity: 'sensor.temperature', label: 'State', value: '21.5 °C' }]);
    expect(hass.formatEntityState).toHaveBeenCalledExactlyOnceWith(hass.states['sensor.temperature']);
  });

  it.each([['temperature', '°C', '21.456', '21.5 °C'], ['power', 'W', '32.456', '32.5 W'], ['energy', 'kWh', '4.456', '4.5 kWh']])(
    'uses registered display precision and actual %s units in fallback readings', (kind, unit, raw, expected) => {
      const hass = { states: { 'sensor.value': state(raw, { unit_of_measurement: unit }) },
        entities: { 'sensor.value': { display_precision: 1 } }, locale: { number_format: 'none' } };
      expect(values('sensor.value', hass, [kind])[0].value).toBe(expected);
    });

  it('formats actual attributes separately from a sensor state precision/unit', () => {
    const hass = { states: { 'sensor.value': state('100', { unit_of_measurement: 'W', battery_level: 87.5, current_temperature: 20.25,
      temperature_unit: '°C', current_power_w: 12.25, total_energy_kwh: 1.125 }) },
      entities: { 'sensor.value': { display_precision: 0 } }, locale: { number_format: 'none' } };
    const rows = values('sensor.value', hass, ['battery', 'temperature', 'energy']);
    expect(rows.map((row) => row.value)).toEqual(['87.5 %', '20.25 °C', '1.125 kWh']);
  });

  it('uses native attribute formatters and translated climate state without optimistic state changes', () => {
    const hass = { states: { 'climate.value': state('heat', { current_temperature: 20.25 }) },
      formatEntityAttributeValue: vi.fn(() => '20,3 °C'), formatEntityState: vi.fn(() => 'Heating') };
    expect(values('climate.value', hass, ['temperature', 'mode']).map((row) => row.value)).toEqual(['20,3 °C', 'Heating']);
    expect(hass.formatEntityAttributeValue).toHaveBeenCalledExactlyOnceWith(hass.states['climate.value'], 'current_temperature');
    expect(hass.states['climate.value'].state).toBe('heat');
  });

  it('uses native entity names, then registry names, for controller labels and reasons', () => {
    const hass = source({ 'switch.relay': { name: 'Registered relay' } }); hass.states['switch.relay'] = state('off', { friendly_name: 'Old name' });
    const obj = { ...object, group: 'relay' }, groups = { relay: { entity: 'switch.relay' } };
    const rows = () => popupRows(obj, chainState(obj, { entity: 'light.saved' }, groups, hass.states), hass.states, groups, hass);
    expect(rows().find((row) => row.kind === 'chain').label).toBe('Registered relay');
    expect(rows().find((row) => row.kind === 'reason').label).toBe('Registered relay is off');
    hass.formatEntityName = () => 'HA name';
    expect(rows().find((row) => row.kind === 'chain').label).toBe('HA name');
  });

  it('falls back safely when HA formatters throw and supports state-only callers unchanged', () => {
    const states = { 'sensor.temperature': state('21.456', { unit_of_measurement: '°C' }) };
    const hass = { states, entities: { 'sensor.temperature': { display_precision: 1 } },
      formatEntityState: () => { throw new Error('old HA'); }, locale: { number_format: 'none' } };
    expect(values('sensor.temperature', hass)[0].value).toBe('21.5 °C');
    const obj = { id: 'v', type: 'generic' }, chain = chainState(obj, { entity: 'sensor.temperature' }, {}, states);
    expect(popupRows(obj, chain, states)[0].value).toBe('21.456 °C');
  });

  it('preserves raw state-only mode attributes and formats full-HA mode attributes separately', () => {
    const states = { 'fan.value': state('on', { mode: 2 }) }, obj = { id: 'v', type: 'generic', ui: { popup: ['mode'] } };
    const chain = chainState(obj, { entity: 'fan.value' }, {}, states);
    expect(popupRows(obj, chain, states)[0].value).toBe(2);
    const hass = { states, formatEntityAttributeValue: vi.fn(() => 'Programme 2') };
    expect(popupRows(obj, chain, states, {}, hass)[0].value).toBe('Programme 2');
    expect(hass.formatEntityAttributeValue).toHaveBeenCalledExactlyOnceWith(states['fan.value'], 'mode');
  });

  it('reads the current HA source rather than displaying the stale supplied snapshot', () => {
    const previous = { 'sensor.temperature': state('19.1', { unit_of_measurement: '°C' }) };
    const hass = { states: { 'sensor.temperature': state('22.25', { unit_of_measurement: '°C' }) },
      entities: { 'sensor.temperature': { display_precision: 1 } }, locale: { number_format: 'none' } };
    const obj = { id: 'v', type: 'generic' }, chain = chainState(obj, { entity: 'sensor.temperature' }, {}, previous);
    expect(popupRows(obj, chain, previous, {}, hass)[0].value).toBe('22.3 °C');
    delete hass.states['sensor.temperature'];
    expect(popupRows(obj, chain, previous, {}, hass)).toEqual([{ kind: 'state', label: 'State', value: 'unavailable' }]);
  });
});

describe('ObjectPopup passes current HA metadata through its real resolver', () => {
  const cleanups = [];
  afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

  it('refreshes a retained reading node from current precision without sending a command', () => {
    const hass = { states: { 'sensor.value': state('21.456', { unit_of_measurement: '°C' }) },
      entities: { 'sensor.value': { display_precision: 1 } }, locale: { number_format: 'none' } };
    const obj = { id: 'v', type: 'generic' }, stage = document.createElement('div'), onAction = vi.fn(); document.body.append(stage);
    const popup = new ObjectPopup(stage, { onAction, project: () => [10, 10], resolve: () => ({
      obj, states: hass.states, chain: chainState(obj, { entity: 'sensor.value' }, {}, hass.states), hass,
    }) });
    cleanups.push(() => { popup.close(); stage.remove(); }); popup.open(obj, [0, 0, 0]);
    const reading = popup.el.querySelector('.fp-pop-value');
    expect(reading.textContent).toBe('21.5 °C'); hass.entities['sensor.value'].display_precision = 0; popup.update();
    expect(popup.el.querySelector('.fp-pop-value')).toBe(reading); expect(reading.textContent).toBe('21 °C');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('still rejects a stale controller button when its device is disabled before any refresh', () => {
    const hass = source({ 'switch.relay': { device_id: 'device' } }, { device: {} });
    hass.services = { switch: { toggle: {} } }; const obj = { id: 'v', type: 'generic', ui: { popup: ['toggle'] } };
    const stage = document.createElement('div'), onAction = vi.fn(); document.body.append(stage);
    const popup = new ObjectPopup(stage, { onAction, project: () => [10, 10], resolve: () => ({
      obj, states: hass.states, chain: chainState(obj, { entity: 'switch.relay' }, {}, hass.states), hass,
    }) });
    cleanups.push(() => { popup.close(); stage.remove(); }); popup.open(obj, [0, 0, 0]);
    const button = popup.el.querySelector('[data-act="toggle"]'); expect(button.disabled).toBe(false);
    hass.devices.device.disabled_by = 'user'; button.click(); expect(onAction).not.toHaveBeenCalled(); expect(button.disabled).toBe(true);
  });

  it('updates the current registered controller name while retaining its focused button', () => {
    const hass = source({ 'switch.relay': { name: 'Before' } }); hass.states['switch.relay'].state = 'off';
    hass.services = { switch: { toggle: {} }, light: { toggle: {} } };
    const obj = { ...object, group: 'relay' }, groups = { relay: { entity: 'switch.relay' } };
    const stage = document.createElement('div'), onAction = vi.fn(); document.body.append(stage);
    const popup = new ObjectPopup(stage, { onAction, project: () => [10, 10], resolve: () => ({
      obj, states: hass.states, chain: chainState(obj, { entity: 'light.saved' }, groups, hass.states), groups, hass,
    }) });
    cleanups.push(() => { popup.close(); stage.remove(); }); popup.open(obj, [0, 0, 0]);
    const button = popup.el.querySelector('.fp-pop-row.chain button'); button.focus();
    hass.entities['switch.relay'].name = 'After <img>'; popup.update();
    expect(popup.el.querySelector('.fp-pop-row.chain button')).toBe(button); expect(document.activeElement).toBe(button);
    expect(popup.el.querySelector('.fp-pop-row.chain .fp-pop-label').textContent).toBe('After <img>');
    expect(button.getAttribute('aria-label')).toBe('After <img>: switch.relay');
    expect(popup.el.querySelector('img')).toBeNull(); expect(onAction).not.toHaveBeenCalled();
  });
});
