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
      user: { id: 'admin', is_admin: true, is_active: true }, connected: true, connection: { connected: true },
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
  card._edit = { panel: host };
  const editor = new OverlayEditor(card, () => { host.innerHTML = editor.render(); editor.updatePreviews(host); });
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const button = event.target.closest('[data-act]'); if (button && !button.disabled) editor.onClick(button.dataset.act, button); });
  host.innerHTML = editor.render();
  editor.updatePreviews(host);
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

describe('explicit alert location drafts', () => {
  const saved = { id: 'located', entity: 'binary_sensor.smoke', type: 'smoke', roomId: 'room:lounge',
    x: 8, y: -2, z: 1.5, floor_id: 'ground', position_key: 'device:old', vendor: { keep: [1, 2] } };
  const withAnchors = (ctx) => {
    ctx.card.trackingAnchors = vi.fn(() => [{ id: 'device:smoke', label: 'Smoke marker', position: { x: 3, y: 1, z: 1.2, floorId: 'ground', shown: true } }]);
    return ctx;
  };
  it('shows existing coordinate/marker overrides and preserves original raw extras until an explicit location choice', () => {
    const ctx = withAnchors(setup({ layout: { alert_bindings: [saved] } })); ctx.click('ovr-edit-alert', saved.id);
    expect(ctx.host.querySelector('[data-field="ovr-alert-location"]').value).toBe('coordinates');
    expect(ctx.host.querySelector('[data-field="ovr-alert-x"]').value).toBe('8');
    ctx.change('ovr-alert-label', 'A new label'); ctx.click('ovr-save-alert');
    expect(ctx.card._layout.alert_bindings[0]).toEqual({ ...saved, label: 'A new label' }); expect(saved.label).toBeUndefined();
    expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it('switches deliberately to Room, removes old overrides once and restores the original exact fields through Undo', () => {
    const ctx = withAnchors(setup({ layout: { alert_bindings: [saved] } })); ctx.click('ovr-edit-alert', saved.id);
    ctx.change('ovr-alert-location', 'room'); ctx.change('ovr-alert-room', 'room:bedroom');
    expect(ctx.card._layout.alert_bindings[0]).toBe(saved); ctx.click('ovr-save-alert');
    const next = ctx.card._layout.alert_bindings[0]; expect(next).toMatchObject({ location_mode: 'room', roomId: 'room:bedroom', vendor: saved.vendor });
    for (const key of ['x', 'y', 'z', 'position_key', 'markerId', 'floorId', 'floor_id']) expect(next).not.toHaveProperty(key);
    expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.card._history.undo().layout.alert_bindings[0]).toEqual(saved);
    expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it('saves only an exact canonical marker with a deliberate optional floor override and keeps Cancel read-only', () => {
    const ctx = withAnchors(setup({ layout: { alert_bindings: [saved] } })); ctx.card._floors.push({ id: 'upper', elevation: 4 });
    ctx.click('ovr-edit-alert', saved.id); ctx.change('ovr-alert-location', 'marker'); ctx.change('ovr-alert-position-key', 'device:smoke');
    ctx.change('ovr-alert-floor', 'upper'); ctx.click('ovr-cancel-alert'); expect(ctx.card._commit).not.toHaveBeenCalled();
    ctx.click('ovr-edit-alert', saved.id); ctx.change('ovr-alert-location', 'marker'); ctx.change('ovr-alert-position-key', 'device:smoke'); ctx.change('ovr-alert-floor', 'upper'); ctx.click('ovr-save-alert');
    expect(ctx.card._layout.alert_bindings[0]).toMatchObject({ location_mode: 'marker', position_key: 'device:smoke', floor_id: 'upper', vendor: saved.vendor });
    for (const key of ['x', 'y', 'z', 'markerId', 'floorId', 'roomId']) expect(ctx.card._layout.alert_bindings[0]).not.toHaveProperty(key);
    expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it('saves finite fixed SOURCE coordinates above an exact source floor in one commit without moving device state', () => {
    const ctx = setup(); ctx.click('ovr-add-alert'); ctx.change('ovr-alert-entity', 'binary_sensor.smoke'); ctx.change('ovr-alert-location', 'coordinates');
    ctx.change('ovr-alert-x', '-2.5'); ctx.change('ovr-alert-y', '3'); ctx.change('ovr-alert-z', '.8'); ctx.change('ovr-alert-floor', 'ground'); ctx.click('ovr-save-alert');
    expect(ctx.card._layout.alert_bindings[0]).toMatchObject({ location_mode: 'coordinates', x: -2.5, y: 3, z: .8, floor_id: 'ground' });
    expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.card._hass.states['binary_sensor.smoke'].state).toBe('on'); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['', '0x10', 'Infinity', 'garbage'])('does not turn an edited invalid coordinate %j into zero or another placement', (value) => {
    const ctx = setup(); ctx.click('ovr-add-alert'); ctx.change('ovr-alert-entity', 'binary_sensor.smoke'); ctx.change('ovr-alert-location', 'coordinates');
    ctx.change('ovr-alert-x', value); ctx.change('ovr-alert-y', '2'); ctx.change('ovr-alert-z', '.4'); ctx.change('ovr-alert-floor', 'ground'); ctx.click('ovr-save-alert');
    expect(ctx.card._commit).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('finite source coordinates');
  });
  it('retains a missing saved marker/floor as visible warnings and does not rewrite it during label-only Save', () => {
    const binding = { ...saved, location_mode: 'marker', position_key: 'device:missing', floor_id: 'missing' }; delete binding.x; delete binding.y; delete binding.z;
    const ctx = withAnchors(setup({ layout: { alert_bindings: [binding] } })); ctx.click('ovr-edit-alert', binding.id);
    expect(ctx.host.querySelector('[data-field="ovr-alert-position-key"]').value).toBe('device:missing'); expect(ctx.host.querySelector('[data-field="ovr-alert-floor"]').value).toBe('missing');
    expect(ctx.host.textContent).toContain('Missing marker'); expect(ctx.host.textContent).toContain('Missing floor');
    ctx.change('ovr-alert-label', 'Preserved'); ctx.click('ovr-save-alert'); expect(ctx.card._layout.alert_bindings[0]).toEqual({ ...binding, label: 'Preserved' });
    ctx.click('ovr-edit-alert', binding.id); ctx.change('ovr-alert-position-key', 'device:smoke'); ctx.click('ovr-save-alert');
    expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.host.textContent).toContain('current unique floor');
  });
  it('keeps an unfinished native decimal in focus across HA refresh and reports removed markers without guessing a survivor', () => {
    const ctx = withAnchors(setup({ layout: { alert_bindings: [saved] } })); ctx.click('ovr-edit-alert', saved.id); ctx.change('ovr-alert-location', 'coordinates');
    const input = ctx.host.querySelector('[data-field="ovr-alert-x"]'); input.focus(); input.value = '1.20'; input.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.card._hass.states['sensor.status'].state = 'fine'; ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.querySelector('[data-field="ovr-alert-x"]')).toBe(input); expect(input.value).toBe('1.20'); expect(document.activeElement).toBe(input);
    ctx.change('ovr-alert-location', 'marker'); ctx.change('ovr-alert-position-key', 'device:smoke'); ctx.card.trackingAnchors.mockReturnValue([]); ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.querySelector('[data-field="ovr-alert-position-key"]').value).toBe('device:smoke'); ctx.click('ovr-save-alert'); expect(ctx.card._commit).not.toHaveBeenCalled();
  });
  it.each(['pointer', 'Space', 'Enter'])('poisons a held %s Save through role loss/recovery while a fresh intended Save commits once', (kind) => {
    const ctx = withAnchors(setup({ layout: { alert_bindings: [saved] } })); ctx.click('ovr-edit-alert', saved.id); ctx.change('ovr-alert-location', 'room');
    const button = ctx.host.querySelector('[data-act="ovr-save-alert"]'); button.focus();
    button.dispatchEvent(kind === 'pointer' ? new Event('pointerdown', { bubbles: true }) : new KeyboardEvent('keydown', { key: kind === 'Space' ? ' ' : 'Enter', bubbles: true }));
    ctx.card._hass.user.is_admin = false; ctx.editor.updatePreviews(ctx.host); expect(button.disabled).toBe(true);
    ctx.card._hass.user.is_admin = true; ctx.editor.updatePreviews(ctx.host); expect(button.disabled).toBe(false);
    button.dispatchEvent(kind === 'pointer' ? new Event('pointerup', { bubbles: true }) : new KeyboardEvent('keyup', { key: kind === 'Space' ? ' ' : 'Enter', bubbles: true })); button.click();
    expect(ctx.card._commit).not.toHaveBeenCalled();
    const fresh = ctx.host.querySelector('[data-act="ovr-save-alert"]'); fresh.dispatchEvent(new Event('pointerdown', { bubbles: true })); fresh.dispatchEvent(new Event('pointerup', { bubbles: true })); fresh.click();
    expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it('rejects source and exact-floor loss before a changed-location Save, keeping the saved binding untouched', () => {
    const ctx = withAnchors(setup({ layout: { alert_bindings: [saved] } })); ctx.click('ovr-edit-alert', saved.id); ctx.change('ovr-alert-location', 'room');
    delete ctx.card._hass.states[saved.entity]; ctx.editor.updatePreviews(ctx.host); ctx.editor.onClick('ovr-save-alert', { dataset: {} }); expect(ctx.card._commit).not.toHaveBeenCalled();
    ctx.card._hass.states[saved.entity] = { state: 'on', attributes: { device_class: 'smoke' } }; ctx.card._floors = []; ctx.editor.updatePreviews(ctx.host); ctx.editor.onClick('ovr-save-alert', { dataset: {} });
    expect(ctx.card._commit).not.toHaveBeenCalled(); expect(ctx.card._layout.alert_bindings[0]).toBe(saved); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['missing user', 'inactive user', 'malformed active flag', 'unestablished connection'])('does not save a draft with %s', (kind) => {
    const ctx = setup(); ctx.click('ovr-add-alert'); ctx.change('ovr-alert-entity', 'binary_sensor.smoke');
    if (kind === 'missing user') delete ctx.card._hass.user;
    else if (kind === 'inactive user') ctx.card._hass.user.is_active = false;
    else if (kind === 'malformed active flag') ctx.card._hass.user.is_active = null;
    else delete ctx.card._hass.connection.connected;
    ctx.editor.updatePreviews(ctx.host); ctx.editor.onClick('ovr-save-alert', { dataset: {} }); expect(ctx.card._commit).not.toHaveBeenCalled(); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it('retains a missing room and a malformed imported location mode without rewriting its raw payload on a label-only edit', () => {
    const binding = { ...saved, roomId: 'missing-room', location_mode: { imported: true }, x: 'legacy', vendor: { keep: [3] } };
    const ctx = setup({ layout: { alert_bindings: [binding] } }); ctx.click('ovr-edit-alert', binding.id);
    expect(ctx.host.querySelector('[data-field="ovr-alert-location"]').value).toBe('saved'); expect(ctx.host.textContent).toContain('Unsupported saved location mode');
    ctx.change('ovr-alert-label', 'Kept malformed import'); ctx.click('ovr-save-alert'); expect(ctx.card._layout.alert_bindings[0]).toEqual({ ...binding, label: 'Kept malformed import' });
    ctx.click('ovr-edit-alert', binding.id); ctx.change('ovr-alert-location', 'room'); expect(ctx.host.querySelector('[data-field="ovr-alert-room"]').value).toBe('missing-room');
    expect(ctx.host.textContent).toContain('Missing room'); ctx.change('ovr-alert-room', 'room:lounge'); ctx.click('ovr-save-alert'); expect(ctx.card._layout.alert_bindings[0]).toMatchObject({ location_mode: 'room', roomId: 'room:lounge', vendor: binding.vendor });
  });
  it('preserves malformed neighboring archive entries and an absent imported ID during a label-only save', () => {
    const binding = { entity: 'binary_sensor.smoke', type: 'smoke', room_id: 'room:lounge', vendor: { unchanged: true } }, neighbor = ['unknown import'];
    const ctx = setup({ layout: { alert_bindings: [null, binding, neighbor] } }); ctx.click('ovr-edit-alert', binding.entity); ctx.change('ovr-alert-label', 'Exact preserved link'); ctx.click('ovr-save-alert');
    expect(ctx.card._layout.alert_bindings).toEqual([null, { ...binding, label: 'Exact preserved link' }, neighbor]);
    expect(binding).not.toHaveProperty('label'); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it('refuses to recreate or overwrite a saved alert that changed externally while its draft was open', () => {
    const ctx = setup({ layout: { alert_bindings: [saved] } }); ctx.click('ovr-edit-alert', saved.id); ctx.change('ovr-alert-label', 'Old draft');
    ctx.card._layout.alert_bindings = [{ ...saved, vendor: { external: true } }]; ctx.click('ovr-save-alert'); expect(ctx.card._commit).not.toHaveBeenCalled();
    expect(ctx.card._layout.alert_bindings[0].vendor).toEqual({ external: true });
    ctx.card._layout.alert_bindings = []; ctx.click('ovr-save-alert'); expect(ctx.card._commit).not.toHaveBeenCalled(); expect(ctx.card._layout.alert_bindings).toEqual([]);
  });
  it('can create an exact-marker alert on an existing floor without inventing a room outline', () => {
    const ctx = withAnchors(setup()); ctx.card._roomList = []; ctx.host.innerHTML = ctx.editor.render(); ctx.editor.updatePreviews(ctx.host);
    ctx.click('ovr-add-alert'); ctx.change('ovr-alert-entity', 'binary_sensor.smoke'); ctx.change('ovr-alert-location', 'marker'); ctx.change('ovr-alert-position-key', 'device:smoke'); ctx.click('ovr-save-alert');
    expect(ctx.card._layout.alert_bindings[0]).toMatchObject({ location_mode: 'marker', position_key: 'device:smoke' });
    expect(ctx.card._layout.alert_bindings[0]).not.toHaveProperty('roomId'); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
});

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
    expect(card._layout.alert_bindings).toEqual([{ id: 'alert_1', entity: 'binary_sensor.smoke', type: 'smoke', roomId: 'room:bedroom', clear_rule: 'state', location_mode: 'room' }]);
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

describe('current metadata in overlay and alert choices', () => {
  const flags = [
    ['hidden', { hidden: true }], ['hidden_by', { hidden_by: 'user' }],
    ['disabled', { disabled: true }], ['disabled_by', { disabled_by: 'user' }],
    ['device disabled', { device_id: 'disabled-device' }], ['diagnostic', { entity_category: 'diagnostic' }],
  ];
  it.each(flags)('omits %s measurements and contacts from ordinary choices', (_name, registration) => {
    const { card } = setup(); card._hass.devices = { 'disabled-device': { disabled_by: 'user' } };
    card._hass.entities['sensor.lounge_f'] = registration; card._hass.entities['binary_sensor.smoke'] = registration;
    expect(measurementSensors(card._hass, 'temperature').map(([id]) => id)).not.toContain('sensor.lounge_f');
    expect(alertSensors(card._hass, 'smoke').map(([id]) => id)).not.toContain('binary_sensor.smoke');
  });
  it('uses current HA names and registry device-class fallbacks without changing raw IDs', () => {
    const { card } = setup(); card._hass.states['binary_sensor.smoke'].attributes = {};
    card._hass.entities['binary_sensor.smoke'] = { original_device_class: 'smoke', name: 'Registry smoke name' };
    card._hass.entities['sensor.bedroom'] = { name: 'Renamed bedroom' };
    expect(alertSensors(card._hass, 'smoke').map(([id, label]) => [id, label])).toEqual([['binary_sensor.smoke', 'Registry smoke name']]);
    expect(measurementSensors(card._hass, 'temperature').find(([id]) => id === 'sensor.bedroom')[1]).toBe('Renamed bedroom');
    card._hass.formatEntityName = () => 'Native HA name';
    expect(alertSensors(card._hass, 'smoke')[0][1]).toBe('Native HA name');
  });
  it('keeps exact missing/hidden selected references as disabled warning choices', () => {
    const { card } = setup(); card._hass.entities['sensor.bedroom'] = { hidden_by: 'user' };
    const choices = measurementSensors(card._hass, 'temperature', { selected: ['sensor.bedroom', 'sensor.removed'] });
    expect(choices.find(([id]) => id === 'sensor.bedroom')).toEqual(['sensor.bedroom', 'Bedroom temperature (Hidden)', false]);
    expect(choices.find(([id]) => id === 'sensor.removed')).toEqual(['sensor.removed', 'sensor.removed (Missing entity)', false]);
  });
  it.each(['unavailable', 'unknown'])('does not offer a new %s source as current evidence', (state) => {
    const { card } = setup(); card._hass.states['sensor.lounge_f'].state = state;
    card._hass.states['binary_sensor.smoke'].state = state;
    expect(measurementSensors(card._hass, 'temperature').map(([id]) => id)).not.toContain('sensor.lounge_f');
    expect(alertSensors(card._hass, 'smoke').map(([id]) => id)).not.toContain('binary_sensor.smoke');
  });
  it.each([true, 'true', 'false', 0, null, [], {}].map((value) => [value]))('rejects stored or malformed restored=%j evidence for new choices', (restored) => {
    const { card } = setup(); card._hass.states['sensor.lounge_f'].attributes.restored = restored;
    card._hass.states['binary_sensor.smoke'].attributes.restored = restored;
    expect(measurementSensors(card._hass, 'temperature').map(([id]) => id)).not.toContain('sensor.lounge_f');
    expect(alertSensors(card._hass, 'smoke').map(([id]) => id)).not.toContain('binary_sensor.smoke');
  });
  it('filters explicit areas and unassigned sources using entity/device inheritance without saving a filter', () => {
    const { card, editor, host, change } = setup(); change('ovr-mode', 'temperature');
    card._hass.entities['sensor.lounge_f'] = { device_id: 'lounge-device' };
    card._hass.entities['sensor.bedroom'] = { device_id: 'lounge-device', area_id: 'bedroom' };
    card._hass.devices = { 'lounge-device': { area_id: 'lounge' } };
    card._hass.states['sensor.unassigned'] = sensor('17', '°C', 'temperature', 'Unassigned temperature');
    host.innerHTML = editor.render(); const before = card._layout, saves = card._commit.mock.calls.length;
    const options = () => [...host.querySelector('[data-field="ovr-add-source"]').options].map((option) => option.value);
    expect(options()).toEqual(expect.arrayContaining(['sensor.lounge_f', 'sensor.bedroom', 'sensor.unassigned']));
    change('ovr-picker-area', 'area:lounge'); expect(options()).toEqual(['', 'sensor.lounge_f']);
    change('ovr-picker-area', 'unassigned'); expect(options()).toEqual(['', 'sensor.unassigned']);
    change('ovr-picker-area', 'all'); expect(options()).toContain('sensor.bedroom');
    expect(card._layout).toBe(before); expect(card._commit.mock.calls).toHaveLength(saves);
  });
  it('keeps a saved source outside the temporary filter and labels source precision separately from the aggregate', () => {
    const { card, editor, host, change } = setup(); change('ovr-mode', 'temperature'); change('ovr-add-source', 'sensor.bedroom');
    card._hass.entities['sensor.bedroom'] = { area_id: 'bedroom', display_precision: 1 };
    card._hass.states['sensor.bedroom'].state = '18.87654'; host.innerHTML = editor.render();
    const before = structuredClone(card._layout); change('ovr-picker-area', 'area:lounge');
    expect(host.querySelector('[data-ovr-source-warning]').textContent).toContain('Outside current filter');
    expect(host.querySelector('[data-ovr-source-reading]').textContent).toContain('18.9 °C');
    expect(host.querySelector('[data-ovr-preview="measure"]').textContent).toContain('Aggregate preview');
    expect(host.querySelector('[data-ovr-preview="measure"]').textContent).toContain('18.88 °C');
    expect(card._layout).toEqual(before); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'disabled', 'missing'])('retains a saved %s reading with a live warning, without replacing a focused control', (kind) => {
    const { card, editor, host, change } = setup(); change('ovr-mode', 'temperature'); change('ovr-add-source', 'sensor.bedroom');
    const saved = structuredClone(card._layout), input = host.querySelector('[data-field="ovr-min"]'); input.focus();
    if (kind === 'missing') delete card._hass.states['sensor.bedroom'];
    else card._hass.entities['sensor.bedroom'] = { [kind === 'hidden' ? 'hidden_by' : 'disabled_by']: 'user' };
    editor.updatePreviews(host);
    expect(host.querySelector('[data-ovr-source-warning]').textContent).toMatch(/Hidden|Disabled|No current state|Missing entity/);
    expect(host.querySelector('[data-field="ovr-min"]')).toBe(input); expect(document.activeElement).toBe(input);
    expect(card._layout).toEqual(saved);
  });
  it('rechecks a stale add-source option against current registry eligibility', () => {
    const { card, editor, host, change } = setup(); change('ovr-mode', 'temperature');
    const old = host.querySelector('[data-field="ovr-add-source"]'), before = card._commit.mock.calls.length;
    old.value = 'sensor.bedroom'; card._hass.entities['sensor.bedroom'] = { disabled_by: 'user' };
    editor.onChange('ovr-add-source', old);
    expect(card._commit.mock.calls).toHaveLength(before); expect(card._layout.room_overlays.bindings ?? {}).toEqual({});
    expect(host.textContent).toContain('Choose a current');
  });
  it('refreshes picker membership and HA-formatted source values without replacing focused native nodes', () => {
    const { card, editor, host, change } = setup(); change('ovr-mode', 'temperature'); change('ovr-add-source', 'sensor.bedroom');
    const input = host.querySelector('[data-field="ovr-min"]'), select = host.querySelector('[data-field="ovr-add-source"]'); input.focus();
    card._hass.formatEntityState = () => 'HA actual reading'; card._hass.entities['sensor.lounge_f'] = { hidden_by: 'user' };
    editor.updatePreviews(host);
    expect(host.querySelector('[data-ovr-source-reading]').textContent).toContain('HA actual reading');
    expect([...select.options].map((option) => option.value)).not.toContain('sensor.lounge_f');
    expect(host.querySelector('[data-field="ovr-add-source"]')).toBe(select); expect(document.activeElement).toBe(input);
  });
  it.each([['omitted', undefined], ['explicit false', false]])('accepts %s restored metadata without inventing a new value', (_label, restored) => {
    const { card } = setup();
    if (restored !== undefined) card._hass.states['sensor.lounge_f'].attributes.restored = restored;
    expect(measurementSensors(card._hass, 'temperature').map(([id]) => id)).toContain('sensor.lounge_f');
  });
  it('keeps missing selected areas visible until a deliberate filter change and resets only the temporary UI', () => {
    const { card, editor, host, change } = setup(); change('ovr-mode', 'temperature');
    change('ovr-picker-area', 'area:lounge'); const saved = structuredClone(card._layout), saves = card._commit.mock.calls.length;
    delete card._hass.areas.lounge; editor.updatePreviews(host);
    const select = host.querySelector('[data-field="ovr-picker-area"]');
    expect(select.value).toBe('area:lounge'); expect(select.selectedOptions[0].disabled).toBe(true);
    expect(select.selectedOptions[0].textContent).toContain('Missing area');
    change('ovr-picker-area', 'all'); expect(host.querySelector('[data-field="ovr-add-source"]').options.length).toBeGreaterThan(1);
    editor.reset(); expect(editor.areaFilter).toBe('all');
    expect(card._layout).toEqual(saved); expect(card._commit.mock.calls).toHaveLength(saves);
  });
  it('updates a focused native add picker to a disabled warning after revocation and rejects its delayed change', () => {
    const { card, editor, host, change } = setup(); change('ovr-mode', 'temperature');
    const select = host.querySelector('[data-field="ovr-add-source"]'); select.value = 'sensor.bedroom'; select.focus();
    card._hass.entities['sensor.bedroom'] = { hidden_by: 'user' }; editor.updatePreviews(host);
    expect(host.querySelector('[data-field="ovr-add-source"]')).toBe(select); expect(document.activeElement).toBe(select);
    expect(select.value).toBe('sensor.bedroom'); expect(select.selectedOptions[0].disabled).toBe(true);
    expect(select.selectedOptions[0].textContent).toContain('Hidden');
    const saves = card._commit.mock.calls.length; editor.onChange('ovr-add-source', select);
    expect(card._commit.mock.calls).toHaveLength(saves); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('retains an excluded restored source and its extras with waiting wording, not a measured-source caption', () => {
    const overlays = { mode: 'temperature', unit: '°C', bindings: { 'room:lounge': { entities: [{ entity: 'sensor.bedroom', custom: 5, enabled: false }] } } };
    const { card, editor, host, change } = setup({ layout: { room_overlays: overlays } });
    card._hass.states['sensor.bedroom'].attributes.restored = true; editor.updatePreviews(host);
    expect(host.querySelector('[data-ovr-source-warning]').textContent).toContain('waiting for a current reading');
    expect(host.querySelector('[data-ovr-source-reading]').textContent).toBe('Stored reading — waiting for a current reading');
    expect(host.querySelector('[data-ovr-source]').textContent).toContain('sensor.bedroom');
    change('ovr-source-enabled', false, 'sensor.bedroom');
    expect(card._layout.room_overlays.bindings['room:lounge'].entities).toEqual([{ entity: 'sensor.bedroom', custom: 5, enabled: false }]);
  });
});

describe('saved alert link preservation and current deliberate selection', () => {
  const saved = { id: 'retained', entity: 'binary_sensor.smoke', type: 'smoke', roomId: 'room:lounge', clear_rule: 'state', custom_data: { retained: true } };
  it.each(['hidden', 'disabled', 'missing', 'unavailable'])('allows a label edit to retain an unchanged saved %s alert link with a warning', (kind) => {
    const { card, host, click, change } = setup({ layout: { alert_bindings: [structuredClone(saved)] } });
    if (kind === 'missing') delete card._hass.states['binary_sensor.smoke'];
    else if (kind === 'unavailable') card._hass.states['binary_sensor.smoke'].state = 'unavailable';
    else card._hass.entities['binary_sensor.smoke'] = { [kind === 'hidden' ? 'hidden_by' : 'disabled_by']: 'user' };
    click('ovr-edit-alert', 'retained');
    const option = [...host.querySelector('[data-field="ovr-alert-entity"]').options].find((entry) => entry.value === saved.entity);
    expect(option.disabled).toBe(true); expect(option.selected).toBe(true);
    expect(host.querySelector('[data-ovr-alert-warning]').textContent).toMatch(/Hidden|Disabled|No current state|Missing entity|Unavailable/);
    change('ovr-alert-label', 'Kept source'); click('ovr-save-alert');
    expect(card._layout.alert_bindings[0]).toEqual({ ...saved, label: 'Kept source' });
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['hidden_by', 'disabled_by', 'entity_category'])('does not save a newly chosen alert after %s changes before Save', (flag) => {
    const { card, host, change, click } = setup(); click('ovr-add-alert'); change('ovr-alert-entity', 'binary_sensor.smoke');
    card._hass.entities['binary_sensor.smoke'] = { [flag]: flag === 'entity_category' ? 'diagnostic' : 'user' };
    click('ovr-save-alert'); expect(card._layout.alert_bindings).toBeUndefined();
    expect(host.textContent).toContain('Choose a current');
  });
  it('preserves an unchanged saved cross-area alert while rejecting a new choice outside the active filter', () => {
    const { card, host, editor, click, change } = setup({ layout: { alert_bindings: [structuredClone(saved)] } });
    card._hass.entities['binary_sensor.smoke'] = { area_id: 'bedroom' }; host.innerHTML = editor.render();
    change('ovr-picker-area', 'area:lounge'); click('ovr-edit-alert', 'retained');
    expect(host.querySelector('[data-ovr-alert-warning]').textContent).toContain('Outside current filter');
    change('ovr-alert-label', 'Cross-area source'); click('ovr-save-alert');
    expect(card._layout.alert_bindings[0].entity).toBe(saved.entity);
    click('ovr-add-alert'); editor.onChange('ovr-alert-entity', { value: saved.entity, dataset: {} });
    click('ovr-save-alert'); expect(card._layout.alert_bindings).toHaveLength(1);
  });
  it('updates a focused alert select with current warnings without replacing its native element or saved link', () => {
    const { card, host, editor, click } = setup({ layout: { alert_bindings: [structuredClone(saved)] } });
    click('ovr-edit-alert', saved.id); const select = host.querySelector('[data-field="ovr-alert-entity"]'); select.focus();
    card._hass.entities[saved.entity] = { device_id: 'contact' }; card._hass.devices = { contact: { disabled_by: 'user' } };
    editor.updatePreviews(host);
    expect(host.querySelector('[data-field="ovr-alert-entity"]')).toBe(select); expect(document.activeElement).toBe(select);
    expect(select.value).toBe(saved.entity); expect(select.selectedOptions[0].disabled).toBe(true);
    expect(host.querySelector('[data-ovr-alert-warning]').textContent).toContain('Disabled');
    expect(host.querySelector('[data-ovr-saved-alert-warning]').textContent).toContain('Disabled');
    expect(card._layout.alert_bindings[0]).toEqual(saved);
  });
  it('does not use retained-link permission after the saved alert was removed externally', () => {
    const { card, host, click, change } = setup({ layout: { alert_bindings: [structuredClone(saved)] } });
    click('ovr-edit-alert', saved.id); change('ovr-alert-label', 'Do not recreate');
    card._layout.alert_bindings = []; card._hass.entities[saved.entity] = { hidden_by: 'user' };
    const saves = card._commit.mock.calls.length; click('ovr-save-alert');
    expect(card._commit.mock.calls).toHaveLength(saves); expect(card._layout.alert_bindings).toEqual([]);
    expect(host.textContent).toContain('Choose a current');
  });
  it('rejects a new smoke source whose actual current device class changed before Save', () => {
    const { card, click, change, host } = setup(); click('ovr-add-alert'); change('ovr-alert-entity', saved.entity);
    card._hass.states[saved.entity].attributes.device_class = 'motion'; click('ovr-save-alert');
    expect(card._layout.alert_bindings).toBeUndefined(); expect(host.textContent).toContain('Choose a current');
  });
  it('keeps an empty new alert picker free of misleading missing-source warnings on HA updates', () => {
    const { editor, host, click } = setup(); click('ovr-add-alert'); editor.updatePreviews(host);
    expect(host.querySelector('[data-ovr-alert-warning]').textContent).toBe('');
  });
  it('refreshes saved source and alert names from HA while retaining focused action nodes and exact IDs', () => {
    const { card, editor, host, change } = setup({ layout: { alert_bindings: [structuredClone(saved)] } });
    change('ovr-mode', 'temperature'); change('ovr-add-source', 'sensor.bedroom');
    const button = host.querySelector('[data-act="ovr-edit-alert"]'); button.focus();
    card._hass.formatEntityName = (state) => state === card._hass.states[saved.entity] ? 'HA renamed smoke' : 'HA renamed measurement';
    editor.updatePreviews(host);
    expect(button.textContent).toBe('HA renamed smoke'); expect(document.activeElement).toBe(button);
    expect(host.querySelector('[data-act="ovr-edit-alert"]')).toBe(button);
    expect(host.querySelector('[data-ovr-source-name]').textContent).toBe('HA renamed measurement');
    expect(host.querySelector('[data-act="ovr-remove-source"]').getAttribute('aria-label')).toBe('Remove HA renamed measurement');
    expect(host.querySelector('[data-act="ovr-delete-alert"]').getAttribute('aria-label')).toBe('Delete alert HA renamed smoke');
    expect(card._layout.alert_bindings[0].entity).toBe(saved.entity);
    expect(card._layout.room_overlays.bindings['room:lounge'].entities[0].entity).toBe('sensor.bedroom');
  });
});
