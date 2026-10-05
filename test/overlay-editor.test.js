// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayEditor, measurementSensors, alertSensors } from '../src/overlay-editor.js';
import { EditHistory } from '../src/history.js';
import { aggregateMeasurements, buildAlerts } from '../src/status-overlays.js';

const sensor = (value, unit, device_class, friendly_name) => ({ state: value, attributes: { unit_of_measurement: unit, device_class, friendly_name } });
function setup({ layout = {}, config = {} } = {}) {
  const card = {
    _layout: { rooms: [], pins: { 'device:lamp': { x: 1, y: 2 } }, ...layout }, _config: { layout_key: 'default', ...config },
    _roomList: [
      { room: { id: 'room:lounge', area_id: 'lounge', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }, floorId: 'ground' },
      { room: { id: 'room:bedroom', area_id: 'bedroom', polygon: [[5, 0], [8, 0], [8, 3], [5, 3]] }, floorId: 'ground' },
    ], _floors: [{ id: 'ground', elevation: 0 }],
    _hass: {
      areas: { lounge: { name: 'Lounge' }, bedroom: { name: 'Bedroom' } },
      states: {
        'sensor.lounge_f': sensor('68', '°F', 'temperature', 'Lounge temperature'),
        'sensor.bedroom': sensor('18', '°C', 'temperature', 'Bedroom temperature'),
        'sensor.dryer': sensor('100', 'W', 'power', 'Dryer power'),
        'sensor.total': sensor('2000', 'W', 'power', 'House power'),
        'sensor.day': { ...sensor('0.5', 'kWh', 'energy', 'Daily energy'), attributes: { unit_of_measurement: 'kWh', device_class: 'energy' } },
        'sensor.status': { state: 'warning', attributes: { friendly_name: 'Safety status' } },
        'binary_sensor.smoke': { state: 'on', attributes: { device_class: 'smoke', friendly_name: 'Hall smoke' } },
        'binary_sensor.leak': { state: 'off', attributes: { device_class: 'moisture', friendly_name: 'Kitchen leak' } },
        'lock.front': { state: 'locked', attributes: { friendly_name: 'Front door' } },
        'sensor.hidden': sensor('22', '°C', 'temperature', 'Hidden temperature'),
        'sensor.diagnostic': sensor('100', 'W', 'power', 'Diagnostic power'),
      },
      entities: { 'sensor.hidden': { hidden: true }, 'sensor.diagnostic': { entity_category: 'diagnostic' } }, callService: vi.fn(),
    }, _history: new EditHistory(), acknowledgeAlert: vi.fn(),
  };
  card._history.reset({ layout: card._layout, config: card._config });
  card._commit = vi.fn((next) => { card._layout = next; card._history.record({ layout: next, config: card._config }, 'Edit overlay'); });
  const host = document.createElement('div'); document.body.append(host);
  const editor = new OverlayEditor(card, () => { host.innerHTML = editor.render(); });
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const button = event.target.closest('[data-act]'); if (button && !button.disabled) editor.onClick(button.dataset.act, button); });
  host.innerHTML = editor.render();
  const change = (field, value, id) => {
    const el = [...host.querySelectorAll(`[data-field="${field}"]`)].find((node) => id === undefined || node.dataset.id === id);
    expect(el).toBeTruthy();
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const click = (action, id) => {
    const button = [...host.querySelectorAll(`[data-act="${action}"]`)].find((node) => id === undefined || node.dataset.id === id);
    expect(button).toBeTruthy(); button.click();
  };
  return { card, editor, host, change, click };
}
afterEach(() => document.body.replaceChildren());

describe('visual room overlay setup', () => {
  it('filters entity pickers by measurement/alert type and omits hidden diagnostics', () => {
    const { card } = setup();
    expect(measurementSensors(card._hass, 'temperature').map(([entity]) => entity)).toEqual(['sensor.bedroom', 'sensor.lounge_f']);
    expect(measurementSensors(card._hass, 'power').map(([entity]) => entity)).toEqual(['sensor.dryer', 'sensor.total']);
    expect(alertSensors(card._hass, 'smoke').map(([entity]) => entity)).toEqual(['binary_sensor.smoke']);
    expect(alertSensors(card._hass, 'leak').map(([entity]) => entity)).toEqual(['binary_sensor.leak']);
    expect(alertSensors(card._hass, 'unlocked').map(([entity]) => entity)).toEqual(['lock.front']);
  });

  it('configures an actual room ID, converts temperature units and leaves other layout data intact', () => {
    const { card, host, change } = setup();
    change('ovr-mode', 'temperature');
    change('ovr-add-source', 'sensor.lounge_f');
    expect(card._layout.room_overlays.bindings['room:lounge']).toEqual({ aggregation: 'mean', entities: [{ entity: 'sensor.lounge_f' }] });
    expect(host.querySelector('[data-ovr-preview="measure"]').textContent).toContain('20 °C');
    change('ovr-unit', '°F');
    expect(card._layout.room_overlays.min).toBeCloseTo(60.8);
    expect(host.querySelector('[data-ovr-preview="measure"]').textContent).toContain('68 °F');
    change('ovr-room', 'room:bedroom');
    change('ovr-add-source', 'sensor.bedroom');
    expect(card._layout.room_overlays.bindings['room:bedroom'].entities).toEqual([{ entity: 'sensor.bedroom' }]);
    expect(card._layout.pins).toEqual({ 'device:lamp': { x: 1, y: 2 } });
    expect(card._config).toEqual({ layout_key: 'default' });
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('requires an energy period and sensor confirmation, with mismatches explained in preview', () => {
    const { card, host, change } = setup();
    change('ovr-mode', 'energy');
    change('ovr-add-source', 'sensor.day');
    expect(host.textContent).toContain('Choose the energy period');
    change('ovr-period', 'day');
    expect(host.textContent).toContain('Confirm the period');
    change('ovr-source-period', 'lifetime', 'sensor.day');
    expect(host.textContent).toContain('does not match day');
    change('ovr-source-period', 'day', 'sensor.day');
    expect(host.querySelector('[data-ovr-preview="measure"]').textContent).toContain('0.5 kWh');
    expect(card._layout.room_overlays.period).toBe('day');
    expect(card._layout.room_overlays.bindings['room:lounge'].entities[0].period).toBe('day');
  });

  it('asks for separate-load confirmation and supports circuit totals/parts without double counting', () => {
    const { card, host, change } = setup();
    change('ovr-mode', 'power');
    change('ovr-add-source', 'sensor.total');
    change('ovr-add-source', 'sensor.dryer');
    expect(host.querySelector('[data-ovr-preview="measure"]').textContent).toContain('separate');
    change('ovr-source-group', 'home-circuit', 'sensor.total');
    change('ovr-source-role', 'total', 'sensor.total');
    change('ovr-source-group', 'home-circuit', 'sensor.dryer');
    change('ovr-source-role', 'part', 'sensor.dryer');
    const cfg = card._layout.room_overlays;
    const metric = aggregateMeasurements(cfg.bindings['room:lounge'], card._hass.states, card._hass.entities, cfg);
    expect(metric.value).toBe(2000);
    expect(host.textContent).toContain('component meters are excluded');
    change('ovr-independent-meters', true);
    expect(card._layout.room_overlays.bindings['room:lounge'].independent_meters).toBe(true);
  });

  it('seeds fallback card settings then saves authoritative layout settings and rejects an invalid scale', () => {
    const fallback = { mode: 'temperature', unit: '°F', bindings: {} };
    const { card, host, change } = setup({ config: { room_overlays: fallback } });
    expect(Number(host.querySelector('[data-field="ovr-min"]').value)).toBeCloseTo(60.8);
    change('ovr-palette', 'violet');
    expect(card._layout.room_overlays.palette).toBe('violet');
    expect(card._config.room_overlays).toBe(fallback);
    const saves = card._commit.mock.calls.length;
    change('ovr-min', '100');
    expect(card._commit.mock.calls).toHaveLength(saves);
    expect(host.textContent).toContain('maximum greater');
    const previous = card._history.undo();
    expect(previous.layout.room_overlays).toBeUndefined();
  });

  it('refreshes missing/live reading diagnostics without replacing a focused editor control', () => {
    const { card, editor, host, change } = setup();
    change('ovr-mode', 'temperature'); change('ovr-add-source', 'sensor.lounge_f');
    const input = host.querySelector('[data-field="ovr-min"]'); input.focus();
    card._hass.states['sensor.lounge_f'].state = 'unavailable';
    editor.updatePreviews(host);
    expect(host.textContent).toContain('Reading is unavailable');
    expect(host.querySelector('[data-field="ovr-min"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('lets a reading be excluded and colours be chosen without losing the saved room sources', () => {
    const { card, host, change, click } = setup();
    change('ovr-mode', 'temperature'); change('ovr-add-source', 'sensor.lounge_f');
    change('ovr-source-enabled', false, 'sensor.lounge_f');
    expect(host.querySelector('[data-ovr-preview="measure"]').textContent).toContain('No valid reading');
    change('ovr-source-enabled', true, 'sensor.lounge_f');
    expect(host.querySelector('[data-ovr-preview="measure"]').textContent).toContain('20 °C');
    change('ovr-palette', 'custom');
    change('ovr-palette-stop', '#123456');
    click('ovr-add-colour');
    expect(card._layout.room_overlays.palette[0]).toBe('#123456');
    expect(card._layout.room_overlays.palette.length).toBeGreaterThan(2);
    expect(card._layout.room_overlays.bindings['room:lounge'].entities).toEqual([{ entity: 'sensor.lounge_f', enabled: true }]);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
});

describe('visual alert setup', () => {
  it('saves a smoke alert in a selected room and Cancel preserves its previous binding', () => {
    const { card, host, change, click } = setup();
    click('ovr-add-alert'); change('ovr-alert-entity', 'binary_sensor.smoke'); change('ovr-alert-room', 'room:bedroom');
    expect(host.textContent).toContain('Smoke detected');
    expect(card._layout.alert_bindings).toBeUndefined();
    click('ovr-save-alert');
    expect(card._layout.alert_bindings).toEqual([{ id: 'alert_1', entity: 'binary_sensor.smoke', type: 'smoke', roomId: 'room:bedroom', clear_rule: 'state' }]);
    expect(buildAlerts({ bindings: card._layout.alert_bindings, states: card._hass.states, rooms: card._roomList, floors: card._floors }).alerts[0].location.x).toBeCloseTo(6.5);
    click('ovr-edit-alert', 'alert_1'); change('ovr-alert-label', 'Changed draft'); click('ovr-cancel-alert');
    expect(card._layout.alert_bindings[0].label).toBeUndefined();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('validates custom trigger/clear states and escapes user-provided labels', () => {
    const { card, host, change, click } = setup();
    click('ovr-add-alert'); change('ovr-alert-type', 'custom'); change('ovr-alert-entity', 'sensor.status');
    click('ovr-save-alert'); expect(host.textContent).toContain('at least one trigger');
    change('ovr-alert-trigger', 'warning'); change('ovr-alert-clear', 'WARNING');
    click('ovr-save-alert'); expect(host.textContent).toContain('cannot both trigger and clear');
    host.querySelector('[data-act="ovr-remove-clear"]').click();
    change('ovr-alert-label', '<script>unsafe</script>');
    click('ovr-save-alert');
    expect(card._layout.alert_bindings[0].trigger_states).toEqual(['warning']);
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>unsafe</script>');
  });

  it('exposes latched alert clearing and acknowledgement without changing real devices or layout', () => {
    const { card, editor, host, change, click } = setup();
    click('ovr-add-alert'); change('ovr-alert-entity', 'binary_sensor.smoke'); change('ovr-alert-rule', 'latched'); click('ovr-save-alert');
    card._alertLatches = { alert_1: true }; host.innerHTML = editor.render();
    const saves = card._commit.mock.calls.length;
    click('ovr-ack-alert', 'alert_1');
    expect(card.acknowledgeAlert).toHaveBeenCalledWith('alert_1');
    expect(card._commit.mock.calls).toHaveLength(saves);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('can save a disabled existing alert for later use', () => {
    const { card, change, click } = setup();
    click('ovr-add-alert'); change('ovr-alert-entity', 'binary_sensor.smoke'); click('ovr-save-alert');
    click('ovr-edit-alert', 'alert_1'); change('ovr-alert-enabled', false); click('ovr-save-alert');
    expect(card._layout.alert_bindings[0]).toMatchObject({ enabled: false, entity: 'binary_sensor.smoke', roomId: 'room:lounge' });
    expect(buildAlerts({ bindings: card._layout.alert_bindings, states: card._hass.states, rooms: card._roomList, floors: card._floors }).alerts).toEqual([]);
  });
});
