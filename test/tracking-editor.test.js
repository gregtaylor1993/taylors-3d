// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingEditor, trackingEntities } from '../src/tracking-editor.js';
import { EditHistory } from '../src/history.js';
import { compileCalibration, readDetection } from '../src/tracked-source.js';
import { buildPresence, buildVehicles, buildVacuums } from '../src/tracked-entities.js';

const state = (value, name, attributes = {}) => ({ state: value, attributes: { friendly_name: name, ...attributes }, last_changed: '2026-10-05T10:00:00Z', last_updated: '2026-10-05T10:00:00Z' });
function setup({ layout = {}, config = {} } = {}) {
  const card = {
    _layout: { pins: { 'device:lamp': { x: 1, y: 2, floor_id: 'ground' } }, ...layout }, _config: { layout_key: 'default', ...config },
    _roomList: [
      { room: { id: 'lounge', area_id: 'lounge', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }, floorId: 'ground' },
      { room: { id: 'bedroom', area_id: 'bedroom', polygon: [[5, 0], [8, 0], [8, 3], [5, 3]] }, floorId: 'first' },
      { room: { id: 'driveway', name: 'Driveway', outdoor: true, polygon: [[0, -4], [4, -4], [4, -1], [0, -1]] }, floorId: 'ground' },
    ], _floors: [{ id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'first', name: 'First floor', elevation: 3 }],
    _hass: {
      areas: { lounge: { name: 'Lounge' }, bedroom: { name: 'Bedroom' } },
      states: {
        'binary_sensor.motion': state('on', 'Lounge motion', { device_class: 'motion' }),
        'binary_sensor.occupancy': state('on', 'Room occupancy', { device_class: 'occupancy' }),
        'binary_sensor.car': state('on', 'Driveway vehicle occupancy', { device_class: 'occupancy' }),
        'sensor.car_count': state('2', 'Vehicles on drive'),
        'sensor.room': state('Living Room', 'Reported room'),
        'sensor.vacuum_room': state('Kitchen', 'Vacuum room'),
        'person.taylor': state('home', 'Taylor'),
        'device_tracker.phone': state('home', 'Phone'),
        'sensor.plate': state('AB12 XYZ', 'Detected vehicle identifier'),
        'event.vehicle': state('2026-10-05T10:00:00Z', 'Vehicle event', { event_type: 'vehicle', event_id: 'sighting-1' }),
        'sensor.timestamp': state('2026-10-05T10:00:00Z', 'Last vehicle seen', { observed: { timestamp: 1791194400 } }),
        'vacuum.robot': state('cleaning', 'Robot vacuum'),
        'vacuum.offline': state('unavailable', 'Offline vacuum'),
        'sensor.position': state('ok', 'Reported coordinates', { location: { east: 1.5, north: 2.5 } }),
        'sensor.hidden': state('Lounge', 'Hidden source'),
        'sensor.disabled': state('on', 'Disabled source'),
        'sensor.diagnostic': state('ok', 'Diagnostic'),
        'light.lounge': state('on', 'Lounge lamp'),
      },
      entities: { 'sensor.hidden': { hidden_by: 'user' }, 'sensor.disabled': { disabled_by: 'user' }, 'sensor.diagnostic': { entity_category: 'diagnostic' } },
      callService: vi.fn(), callWS: vi.fn(),
    }, _history: new EditHistory(),
    trackingAnchors: vi.fn(() => [{ id: 'object:dock', label: 'Vacuum dock', position: { x: 1, y: 2, z: 0, floorId: 'ground' } }]),
  };
  card._history.reset({ layout: card._layout, config: card._config });
  card.commitFeatureLayout = vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; card._history.record({ layout: card._layout, config: card._config }, 'Edit tracking'); });
  const host = document.createElement('div'); document.body.append(host);
  const editor = new TrackingEditor(card, () => { host.innerHTML = editor.render(); editor.updatePreviews(host); });
  host.addEventListener('change', (event) => { editor.onChange(event.target.dataset.field, event.target); editor.updatePreviews(host); });
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const button = event.target.closest('[data-act]'); if (button && !button.disabled) editor.onClick(button.dataset.act, button); });
  host.innerHTML = editor.render();
  const change = (field, value, index) => {
    const control = [...host.querySelectorAll(`[data-field="trk-${field}"]`)].find((node) => index === undefined || Number(node.dataset.index) === index);
    expect(control, `field ${field}`).toBeTruthy();
    if (control.type === 'checkbox') control.checked = value; else control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const click = (action, index) => {
    const control = [...host.querySelectorAll(`[data-act="trk-${action}"]`)].find((node) => index === undefined || Number(node.dataset.index) === index);
    expect(control, `action ${action}`).toBeTruthy(); control.click();
  };
  const section = (name) => host.querySelector(`[data-act="trk-section"][data-section="${name}"]`).click();
  const assertNoHA = () => { expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled(); };
  return { card, host, editor, change, click, section, assertNoHA };
}
const activity = { id: 'presence_1', entity: 'binary_sensor.motion', kind: 'room_activity', signal: 'motion', roomId: 'lounge', active_states: ['on'], clear_states: ['off'], enabled: true };
const occupancy = { id: 'vehicle_1', entity: 'binary_sensor.car', kind: 'occupancy', roomId: 'driveway', active_states: ['on'], clear_states: ['off'], enabled: true, vehicle_source_confirmed: true };
const vacuum = { id: 'vacuum_1', entity: 'vacuum.robot', kind: 'static', position_key: 'object:dock', enabled: true };
function chooseActivity(ctx) { ctx.click('add'); ctx.change('entity', 'binary_sensor.motion'); ctx.change('room', 'lounge'); }
function chooseVehicle(ctx, kind = 'occupancy') {
  ctx.section('vehicles'); ctx.click('add'); if (kind !== 'occupancy') ctx.change('kind', kind);
  ctx.change('entity', kind === 'count' ? 'sensor.car_count' : kind === 'event' ? 'event.vehicle' : 'binary_sensor.car');
  ctx.change('room', 'driveway'); ctx.change('vehicle-confirmed', true);
}
function chooseXY(ctx) {
  ctx.section('vacuums'); ctx.click('add'); ctx.change('kind', 'xy'); ctx.change('entity', 'vacuum.robot');
  ctx.change('position-source', 'sensor.position'); ctx.change('x-attr', 'location.east'); ctx.change('y-attr', 'location.north');
  ctx.change('position-floor', 'ground'); ctx.change('plan-metres', true); ctx.change('location-mode', 'anchor'); ctx.change('anchor', 'object:dock');
}
function chooseRoomLocation(ctx) {
  ctx.click('add'); ctx.change('kind', 'room_location'); ctx.change('entity', 'sensor.room'); ctx.change('room-source', 'sensor.room');
  ctx.click('add-map'); ctx.change('map-value', 'Living Room', 0); ctx.change('map-room', 'lounge', 0);
}

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('tracking source choices and accessibility', () => {
  it('uses actual metadata names and filters unrelated, hidden, disabled and diagnostic sources', () => {
    const { card, assertNoHA } = setup();
    const entities = trackingEntities(card._hass, 'presence', 'room_activity').map((item) => item.value);
    expect(entities).toContain('binary_sensor.motion');
    expect(entities).not.toContain('person.taylor'); expect(entities).not.toContain('light.lounge');
    for (const excluded of ['sensor.hidden', 'sensor.disabled', 'sensor.diagnostic']) expect(entities).not.toContain(excluded);
    expect(trackingEntities(card._hass, 'vacuums', 'static').map((item) => item.value)).toEqual(['vacuum.offline', 'vacuum.robot']);
    card._hass.formatEntityName = () => 'Native HA name';
    expect(trackingEntities(card._hass, 'vehicles', 'count')[0].name).toBe('Native HA name'); assertNoHA();
  });
  it('retains selected missing sources as disabled warning choices without selecting another entity', () => {
    const choices = trackingEntities({}, 'vacuums', 'static', 'vacuum.deleted');
    expect(choices).toHaveLength(1); expect(choices[0]).toMatchObject({ value: 'vacuum.deleted', selectable: false, selected: true });
  });
  it('requires explicit first choices and supplies labels, keyboard focus and 44px theme controls', () => {
    const { host, click, editor } = setup(); click('add');
    expect(editor.draft.entity).toBe(''); expect(editor.draft.roomId).toBeUndefined();
    expect(host.querySelector('[data-field="trk-entity"]').value).toBe(''); expect(host.querySelector('[data-field="trk-room"]').value).toBe('');
    for (const control of host.querySelectorAll('input,select')) expect(control.closest('label')).toBeTruthy();
    expect(host.querySelector('style').textContent).toContain('min-height:44px');
    expect(host.querySelector('style').textContent).toContain(':focus-visible');
    expect(host.querySelector('style').textContent).toContain('var(--card-background-color');
    host.querySelector('[data-field="trk-label"]').focus(); expect(document.activeElement.dataset.field).toBe('trk-label');
  });
  it('escapes names, IDs, reading text and draft labels instead of creating unsafe markup', () => {
    const ctx = setup();
    ctx.card._hass.states['binary_sensor.motion'].attributes.friendly_name = '<img src=x onerror=alert(1)>';
    ctx.card._hass.states['binary_sensor.motion'].state = '<script>bad</script>';
    chooseActivity(ctx); ctx.change('label', '"><img src=x onerror=alert(1)>'); ctx.click('save');
    expect(ctx.host.querySelector('img,script')).toBeNull(); expect(ctx.host.textContent).toContain('<img src=x onerror=alert(1)>');
    ctx.assertNoHA();
  });
});

describe('presence drafts and explicit room evidence', () => {
  it('saves anonymous motion only on Save and leaves other layout/config and HA devices intact', () => {
    const ctx = setup(); chooseActivity(ctx);
    expect(ctx.card._layout.presence_bindings).toBeUndefined(); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(ctx.host.textContent).toContain('Anonymous room activity only');
    ctx.click('save');
    expect(ctx.card._layout.presence_bindings).toEqual([{ ...activity, label: '' }]);
    expect(ctx.card.commitFeatureLayout).toHaveBeenCalledWith({ presence_bindings: [{ ...activity, label: '' }] });
    expect(ctx.card._layout.pins['device:lamp']).toEqual({ x: 1, y: 2, floor_id: 'ground' });
    expect(ctx.card._config).toEqual({ layout_key: 'default' }); ctx.assertNoHA();
  });
  it('supports a deliberate occupancy sensor and custom exact active/clear states', () => {
    const ctx = setup(); chooseActivity(ctx); ctx.change('entity', 'binary_sensor.occupancy'); ctx.change('signal', 'occupancy');
    ctx.change('active', 'occupied, active, occupied'); ctx.change('clear', 'clear, empty'); ctx.click('save');
    expect(ctx.card._layout.presence_bindings[0]).toMatchObject({ signal: 'occupancy', active_states: ['occupied', 'active'], clear_states: ['clear', 'empty'] });
  });
  it('rejects shared active/clear states rather than creating ambiguous occupancy', () => {
    const ctx = setup(); chooseActivity(ctx); ctx.change('clear', 'off, on'); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('cannot be both active and clear');
  });
  it('does not infer a person from motion or a friendly label in an imported activity binding', () => {
    const ctx = setup({ layout: { presence_bindings: [{ ...activity, identity_entity: 'person.taylor', label: 'Taylor' }] } });
    ctx.click('edit', 0); ctx.click('save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(ctx.host.textContent).toContain('Motion cannot identify a person');
  });
  it('saves exact room mappings and a deliberate person association without a fabricated fixed location', () => {
    const ctx = setup(); chooseRoomLocation(ctx); ctx.change('identity', 'person.taylor'); ctx.click('save');
    const saved = ctx.card._layout.presence_bindings[0];
    expect(saved).toMatchObject({ kind: 'room_location', entity: 'sensor.room', identity_entity: 'person.taylor', room_source: { entity: 'sensor.room', room_map: { 'Living Room': 'lounge' } } });
    expect(saved.roomId).toBeUndefined(); expect(saved.position).toBeUndefined(); expect(saved.position_key).toBeUndefined(); ctx.assertNoHA();
  });
  it.each(['home', 'not_home', 'away', 'unknown', 'unavailable'])('rejects %s as room location evidence', (value) => {
    const ctx = setup(); chooseRoomLocation(ctx); ctx.change('map-value', value, 0); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('home/away is not a room location');
  });
  it('rejects conflicting exact mappings and permits deliberate correction', () => {
    const ctx = setup(); chooseRoomLocation(ctx); ctx.click('add-map'); ctx.change('map-value', 'Living Room', 1); ctx.change('map-room', 'bedroom', 1); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('exactly one room');
    ctx.click('remove-map', 1); ctx.click('save'); expect(ctx.card._layout.presence_bindings[0].room_source.room_map).toEqual({ 'Living Room': 'lounge' });
  });
  it('requires actual source selections and at least one mapped room', () => {
    const ctx = setup(); ctx.click('add'); ctx.change('kind', 'room_location'); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('actual source entity');
    ctx.change('entity', 'sensor.room'); ctx.change('room-source', 'sensor.room'); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('at least one exact');
  });
  it('Cancel and tab changes discard unsaved ideas without a layout commit', () => {
    const ctx = setup(); chooseActivity(ctx); ctx.change('label', 'Unsaved idea'); ctx.click('cancel');
    expect(ctx.editor.draft).toBeNull(); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    chooseRoomLocation(ctx); ctx.section('vehicles'); expect(ctx.editor.maps).toEqual([]); expect(ctx.editor.draft).toBeNull(); ctx.assertNoHA();
  });
});

describe('vehicle observations remain truthful', () => {
  it('saves sustained occupied/clear state separately from an expiring event', () => {
    const ctx = setup(); chooseVehicle(ctx); ctx.click('save');
    const saved = ctx.card._layout.vehicle_bindings[0]; expect(saved).toEqual({ ...occupancy, label: '' });
    expect(saved.expires_seconds).toBeUndefined(); expect(saved.timestamp_mode).toBeUndefined();
    expect(readDetection(ctx.card._hass.states[saved.entity], saved, Date.parse('2026-10-10T10:00:00Z')).active).toBe(true); ctx.assertNoHA();
  });
  it('requires the user to declare vehicle evidence and rejects general motion even after confirmation', () => {
    const ctx = setup(); chooseVehicle(ctx); ctx.change('vehicle-confirmed', false); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('actually reports vehicles');
    ctx.change('vehicle-confirmed', true); ctx.change('entity', 'binary_sensor.motion'); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('general motion sensor cannot prove');
  });
  it('requires vehicle evidence to be confirmed again after the observation source changes', () => {
    const ctx = setup({ layout: { vehicle_bindings: [occupancy] } }); ctx.section('vehicles'); ctx.click('edit', 0);
    ctx.change('entity', 'sensor.car_count');
    expect(ctx.host.querySelector('[data-field="trk-vehicle-confirmed"]').checked).toBe(false); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.assertNoHA();
  });
  it('saves a generic count without inventing parking bays or vehicle identities', () => {
    const ctx = setup(); chooseVehicle(ctx, 'count'); ctx.change('label', 'Driveway'); ctx.click('save');
    const saved = ctx.card._layout.vehicle_bindings[0]; expect(saved).toMatchObject({ kind: 'count', entity: 'sensor.car_count', roomId: 'driveway', label: 'Driveway' });
    expect(saved.identity_entity).toBeUndefined(); expect(ctx.host.textContent).toContain('Driveway'); ctx.assertNoHA();
  });
  it('shows invalid count readings without converting them to vehicles or blocking a legitimate future source', () => {
    const ctx = setup(); chooseVehicle(ctx, 'count'); ctx.card._hass.states['sensor.car_count'].state = '2.5'; ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.textContent).toContain('nonnegative whole number');
    ctx.click('save'); expect(ctx.card._layout.vehicle_bindings[0].kind).toBe('count');
  });
  it('saves an event timestamp/filter/ID and an absolute expiry contract, never a browser receipt time', () => {
    const ctx = setup(); chooseVehicle(ctx, 'event'); ctx.change('timestamp-mode', 'state'); ctx.change('expires', '30'); ctx.change('event-types', 'vehicle, vehicle'); ctx.change('event-id-attr', 'event_id'); ctx.click('save');
    const saved = ctx.card._layout.vehicle_bindings[0];
    expect(saved).toMatchObject({ kind: 'event', timestamp_mode: 'state', timestamp_format: 'iso', expires_seconds: 30, event_types: ['vehicle'], event_type_attr: 'event_type', event_id_attr: 'event_id' });
    const at = Date.parse(ctx.card._hass.states['event.vehicle'].state), first = readDetection(ctx.card._hass.states['event.vehicle'], saved, at + 1000);
    expect(first.expiresAt).toBe(at + 30000);
    expect(readDetection(ctx.card._hass.states['event.vehicle'], saved, at + 31000, first.memory).active).toBe(false);
    expect(saved.seen_at).toBeUndefined(); ctx.assertNoHA();
  });
  it.each(['', '0', '-1', '86401'])('does not save an event with expiry %s', (expiry) => {
    const ctx = setup(); chooseVehicle(ctx, 'event'); ctx.change('timestamp-mode', 'state'); ctx.change('event-types', 'vehicle'); ctx.change('expires', expiry); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('expiry from 1 to 86400');
  });
  it('requires actual event time and its attribute when attribute timing is selected', () => {
    const ctx = setup(); chooseVehicle(ctx, 'event'); ctx.change('expires', '45'); ctx.click('save');
    expect(ctx.host.textContent).toContain('actual event time source');
    ctx.change('timestamp-mode', 'attribute'); ctx.change('timestamp-attr', ''); ctx.click('save'); expect(ctx.host.textContent).toContain('timestamp attribute path');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('allows a declared vehicle-only last-seen timestamp source without inventing an event type attribute', () => {
    const ctx = setup(); chooseVehicle(ctx, 'event'); ctx.change('entity', 'sensor.timestamp'); ctx.change('vehicle-confirmed', true); ctx.change('timestamp-mode', 'state'); ctx.change('expires', '45'); ctx.click('save');
    const saved = ctx.card._layout.vehicle_bindings[0]; expect(saved.event_types).toBeUndefined();
    const at = Date.parse(ctx.card._hass.states['sensor.timestamp'].state);
    expect(readDetection(ctx.card._hass.states['sensor.timestamp'], saved, at + 1000).active).toBe(true); ctx.assertNoHA();
  });
  it('supports explicitly chosen attribute time formats and source change pulses', () => {
    const ctx = setup(); chooseVehicle(ctx, 'event'); ctx.change('timestamp-mode', 'attribute'); ctx.change('timestamp-attr', 'observed.timestamp'); ctx.change('timestamp-format', 'seconds'); ctx.change('expires', '45'); ctx.change('event-types', 'vehicle'); ctx.click('save');
    expect(ctx.card._layout.vehicle_bindings[0]).toMatchObject({ timestamp_mode: 'attribute', timestamp_attr: 'observed.timestamp', timestamp_format: 'seconds' });
    ctx.click('edit', 0); ctx.change('timestamp-mode', 'last_changed'); ctx.click('save');
    expect(ctx.card._layout.vehicle_bindings[0].timestamp_mode).toBe('last_changed'); ctx.assertNoHA();
  });
  it('names a vehicle only with an explicit actual identity source and exact identifier', () => {
    const ctx = setup(); chooseVehicle(ctx); ctx.change('identity', 'sensor.plate'); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('exact confirmed vehicle identifier');
    ctx.change('identity-value', 'AB12 XYZ'); ctx.change('identity-attribute', 'plate'); ctx.click('save');
    expect(ctx.card._layout.vehicle_bindings[0]).toMatchObject({ identity_entity: 'sensor.plate', identity_value: 'AB12 XYZ', identity_attribute: 'plate' }); ctx.assertNoHA();
  });
});

describe('vacuum status and measured placement', () => {
  it('keeps cleaning-only status stationary at a selected dock with an honest label', () => {
    const ctx = setup(); ctx.section('vacuums'); ctx.click('add'); ctx.change('entity', 'vacuum.robot'); ctx.change('location-mode', 'anchor'); ctx.change('anchor', 'object:dock');
    expect(ctx.host.textContent).toContain('Stationary status'); expect(ctx.host.textContent).toContain('Moving location is not reported');
    ctx.click('save'); expect(ctx.card._layout.vacuum_bindings[0]).toEqual({ ...vacuum, label: '' }); ctx.assertNoHA();
  });
  it('requires all measured coordinate declarations and saves separate status/position entities', () => {
    const ctx = setup(); chooseXY(ctx); ctx.click('save');
    const saved = ctx.card._layout.vacuum_bindings[0]; expect(saved).toMatchObject({ entity: 'vacuum.robot', kind: 'xy', position_key: 'object:dock', position_source: { entity: 'sensor.position', source: 'xy', units: 'm', plan_meters: true, x_attr: 'location.east', y_attr: 'location.north', floorId: 'ground' } });
    const transform = compileCalibration(saved.position_source); expect(transform.status).toBe('ready'); expect(transform.transform({ kind: 'xy', raw: [1.5, 2.5], status: 'ready' })).toEqual([1.5, 2.5]); ctx.assertNoHA();
  });
  it('will not treat XY as metres merely because a vacuum is cleaning', () => {
    const ctx = setup(); chooseXY(ctx); ctx.change('plan-metres', false); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('Confirm that coordinates already use');
  });
  it('rejects missing or duplicate coordinate attribute paths and an undeclared floor', () => {
    const ctx = setup(); chooseXY(ctx); ctx.change('y-attr', 'location.east'); ctx.click('save'); expect(ctx.host.textContent).toContain('distinct X and Y');
    ctx.change('y-attr', 'location.north'); ctx.change('position-floor', ''); ctx.click('save'); expect(ctx.host.textContent).toContain('floor for measured coordinates');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('shows missing/bool/blank coordinate readings as invalid instead of animating a made-up route', () => {
    const ctx = setup(); chooseXY(ctx);
    for (const bad of [false, '', '   ', null]) {
      ctx.card._hass.states['sensor.position'].attributes.location.east = bad; ctx.editor.updatePreviews(ctx.host);
      expect(ctx.host.textContent).toContain('Both coordinate attributes must be finite numbers');
    }
    ctx.assertNoHA();
  });
  it('supports exact vacuum room reports while showing that the position inside the room is unknown', () => {
    const ctx = setup(); ctx.section('vacuums'); ctx.click('add'); ctx.change('kind', 'room'); ctx.change('entity', 'vacuum.robot'); ctx.change('room-source', 'sensor.vacuum_room');
    ctx.click('add-map'); ctx.change('map-value', 'Kitchen', 0); ctx.change('map-room', 'lounge', 0); ctx.change('room', 'bedroom');
    expect(ctx.host.textContent).toContain('exact position is unknown'); ctx.click('save');
    expect(ctx.card._layout.vacuum_bindings[0]).toMatchObject({ entity: 'vacuum.robot', kind: 'room', roomId: 'bedroom', room_source: { entity: 'sensor.vacuum_room', room_map: { Kitchen: 'lounge' } } }); ctx.assertNoHA();
  });
  it('allows unavailable sources to be configured but never shows a current observation', () => {
    const ctx = setup(); ctx.section('vacuums'); ctx.click('add'); ctx.change('entity', 'vacuum.offline'); ctx.change('room', 'lounge');
    expect(ctx.host.textContent).toContain('does not provide a current observation'); ctx.click('save');
    expect(ctx.card._layout.vacuum_bindings[0].entity).toBe('vacuum.offline'); ctx.assertNoHA();
  });
  it('preserves calibrated imported coordinates read-only until a deliberate relink', () => {
    const old = { ...vacuum, kind: 'xy', position_source: { entity: 'sensor.position', source: 'xy', units: 'cm', calibration: [{ src: [0, 0], plan: [2, 3] }], floorId: 'ground' } };
    const ctx = setup({ layout: { vacuum_bindings: [old] } }); ctx.section('vacuums'); ctx.click('edit', 0);
    expect(ctx.host.querySelector('[data-field="trk-entity"]').disabled).toBe(true); expect(ctx.host.textContent).toContain('uses calibration or different units');
    ctx.click('relink'); expect(ctx.editor.draft.position_source).toEqual({ entity: '', source: 'xy', units: 'm', plan_meters: false, x_attr: '', y_attr: '', floorId: '' });
    expect(ctx.card._layout.vacuum_bindings[0]).toEqual(old); ctx.click('cancel'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
});

describe('saved references, coordinates and history', () => {
  it('saves fixed plan coordinates with a real floor, and Undo removes only that explicit change', () => {
    const ctx = setup(); chooseActivity(ctx); ctx.change('location-mode', 'position'); ctx.change('x', '1.25'); ctx.change('y', '-2.5'); ctx.change('z', '0.2'); ctx.change('floor', 'first'); ctx.click('save');
    expect(ctx.card._layout.presence_bindings[0]).toMatchObject({ position: { x: 1.25, y: -2.5, z: 0.2, floorId: 'first' } });
    expect(ctx.card._layout.presence_bindings[0].roomId).toBeUndefined();
    const previous = ctx.card._history.undo(); expect(previous.layout.presence_bindings).toBeUndefined(); expect(previous.layout.pins).toEqual(ctx.card._layout.pins); ctx.assertNoHA();
  });
  it.each(['', ' ', 'false', 'Infinity'])('rejects fixed X coordinate %s rather than converting it to zero', (x) => {
    const ctx = setup(); chooseActivity(ctx); ctx.change('location-mode', 'position'); ctx.change('x', x); ctx.change('y', '2'); ctx.change('floor', 'ground'); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('Blank coordinates are not zero');
  });
  it('rejects booleans and hexadecimal numbers through the public change handler too', () => {
    const ctx = setup(); chooseActivity(ctx); ctx.change('location-mode', 'position'); ctx.change('y', '2'); ctx.change('floor', 'ground');
    for (const invalid of [false, true, '0x10']) {
      ctx.editor.onChange('trk-x', { value: invalid }); ctx.click('save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    }
  });
  it('rejects a degenerate room outline and a floor with no actual elevation', () => {
    const ctx = setup(); chooseActivity(ctx); ctx.card._roomList[0].room.polygon = [[0, 0], [1, 0], [2, 0]]; ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('outline and a valid floor');
    ctx.card._roomList[0].room.polygon = [[0, 0], [2, 0], [2, 2]]; delete ctx.card._floors[0].elevation; ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('rejects a duplicate floor ID and malformed reported anchor coordinates', () => {
    const ctx = setup(); chooseActivity(ctx); ctx.change('location-mode', 'anchor'); ctx.change('anchor', 'object:dock');
    ctx.card.trackingAnchors.mockReturnValue([{ id: 'object:dock', position: { x: false, y: 2, floorId: 'ground' } }]); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('genuinely mapped');
    ctx.card.trackingAnchors.mockReturnValue([{ id: 'object:dock', position: { x: 1, y: 2, floorId: 'ground' } }]); ctx.card._floors.push({ id: 'ground', elevation: 0 }); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('preserves missing source selections read-only; Clear is available and never substitutes another entity', () => {
    const old = { ...activity, entity: 'binary_sensor.deleted' };
    const ctx = setup({ layout: { presence_bindings: [old] } }); ctx.click('edit', 0);
    expect(ctx.host.querySelector('[data-field="trk-entity"]').value).toBe('binary_sensor.deleted');
    expect(ctx.host.querySelector('[data-field="trk-entity"]').disabled).toBe(true); expect(ctx.host.querySelector('[data-act="trk-save"]').disabled).toBe(true);
    expect(ctx.card._layout.presence_bindings[0]).toEqual(old);
    ctx.click('clear-draft'); expect(ctx.card._layout.presence_bindings).toEqual([]); ctx.assertNoHA();
  });
  it('requires deliberate Relink for a missing source and preserves unrelated imported settings', () => {
    const old = { ...activity, entity: 'binary_sensor.deleted', freshness: { timestamp_mode: 'attribute', timestamp_attr: 'heartbeat', timestamp_format: 'iso', max_age_seconds: 60 }, future_option: { keep: true } };
    const ctx = setup({ layout: { presence_bindings: [old], vehicle_bindings: [occupancy] } }); ctx.click('edit', 0); ctx.click('relink'); ctx.change('entity', 'binary_sensor.occupancy'); ctx.click('save');
    expect(ctx.card._layout.presence_bindings[0]).toMatchObject({ entity: 'binary_sensor.occupancy', freshness: old.freshness, future_option: old.future_option });
    expect(ctx.card._layout.vehicle_bindings).toEqual([occupancy]); ctx.assertNoHA();
  });
  it.each(['hidden', 'disabled', 'diagnostic'])('makes a selected %s entity read-only instead of silently relinking', (type) => {
    const ctx = setup({ layout: { presence_bindings: [{ ...activity, entity: `sensor.${type}` }] } }); ctx.click('edit', 0);
    expect(ctx.host.querySelector('[data-field="trk-entity"]').value).toBe(`sensor.${type}`);
    expect(ctx.host.querySelector('[data-field="trk-label"]').disabled).toBe(true); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('retains a deleted room and floor until they are deliberately repaired', () => {
    const ctx = setup({ layout: { presence_bindings: [{ ...activity, roomId: 'deleted-room' }] } }); ctx.click('edit', 0);
    expect(ctx.host.querySelector('[data-field="trk-room"]').value).toBe('deleted-room'); expect(ctx.host.textContent).toContain('Saved room deleted-room is missing');
    ctx.click('relink'); ctx.change('room', 'lounge'); ctx.click('save'); expect(ctx.card._layout.presence_bindings[0].roomId).toBe('lounge');
    ctx.click('edit', 0); ctx.change('location-mode', 'position'); ctx.change('x', '1'); ctx.change('y', '2'); ctx.change('floor', 'first');
    ctx.card._floors = ctx.card._floors.filter((floor) => floor.id !== 'first'); ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.textContent).toContain('Saved floor first is missing'); expect(ctx.host.querySelector('[data-act="trk-save"]').disabled).toBe(true);
  });
  it('does not choose a different anchor when the selected mapped dock disappears', () => {
    const ctx = setup({ layout: { vacuum_bindings: [vacuum] } }); ctx.section('vacuums'); ctx.click('edit', 0);
    ctx.card.trackingAnchors.mockReturnValue([{ id: 'object:other-dock', label: 'Other dock', position: { x: 2, y: 3, floorId: 'ground' } }]);
    ctx.editor.updatePreviews(ctx.host); expect(ctx.editor.draft.position_key).toBe('object:dock'); expect(ctx.host.textContent).toContain('Saved anchor object:dock is missing');
    ctx.click('relink'); ctx.change('anchor', 'object:other-dock'); ctx.click('save'); expect(ctx.card._layout.vacuum_bindings[0].position_key).toBe('object:other-dock');
  });
  it.each([
    ['presence', 'binary_sensor.motion', chooseActivity, 'presence_bindings'],
    ['vehicles', 'binary_sensor.car', chooseVehicle, 'vehicle_bindings'],
    ['vacuums', 'vacuum.robot', (ctx) => { ctx.section('vacuums'); ctx.click('add'); ctx.change('entity', 'vacuum.robot'); ctx.change('room', 'lounge'); }, 'vacuum_bindings'],
  ])('labels a restored %s observation as stored while preserving an explicitly saveable configuration', (_, entity, choose, key) => {
    const ctx = setup(); ctx.card._hass.states[entity].attributes.restored = true; choose(ctx);
    const preview = ctx.host.querySelector('[data-trk-preview]').textContent;
    expect(preview).toContain('Stored source reading:'); expect(preview).toContain(`Source ${entity} is a stored/restored reading`);
    expect(preview).toContain('Waiting for current data.'); expect(preview).not.toContain('Current HA state;');
    expect(preview).not.toContain('Ready to save this explicit source');
    expect(ctx.host.querySelector('[data-field="trk-entity"]').value).toBe(entity); expect(ctx.host.querySelector('[data-act="trk-save"]').disabled).toBe(false);
    ctx.click('save'); expect(ctx.card._layout[key][0].entity).toBe(entity); ctx.assertNoHA();
  });
  it('warns separately about restored room and person readings instead of treating a stored identity as observed', () => {
    const ctx = setup(); chooseRoomLocation(ctx); ctx.change('room-source', 'sensor.vacuum_room'); ctx.change('identity', 'person.taylor');
    ctx.card._hass.states['sensor.vacuum_room'].attributes.restored = true; ctx.card._hass.states['person.taylor'].attributes.restored = true;
    ctx.editor.updatePreviews(ctx.host);
    const preview = ctx.host.querySelector('[data-trk-preview]').textContent;
    expect(preview).toContain('Room source sensor.vacuum_room is a stored/restored reading');
    expect(preview).toContain('Identity person.taylor is a stored/restored reading'); expect(preview).not.toContain('Current HA state;');
    ctx.click('save'); expect(ctx.card._layout.presence_bindings[0]).toMatchObject({ entity: 'sensor.room', identity_entity: 'person.taylor', room_source: { entity: 'sensor.vacuum_room' } }); ctx.assertNoHA();
  });
  it('rejects restored measured coordinates in the preview even when old numeric X/Y attributes remain', () => {
    const ctx = setup(); chooseXY(ctx); ctx.card._hass.states['sensor.position'].attributes.restored = true; ctx.editor.updatePreviews(ctx.host);
    const preview = ctx.host.querySelector('[data-trk-preview]').textContent;
    expect(preview).toContain('Position source sensor.position is a stored/restored reading'); expect(preview).toContain('A current reading is not available.');
    expect(preview).not.toContain('Ready to save this explicit source'); expect(preview).not.toContain('Current HA state;');
    ctx.click('save'); const saved = ctx.card._layout.vacuum_bindings[0];
    expect(saved.position_source).toMatchObject({ entity: 'sensor.position', x_attr: 'location.east', y_attr: 'location.north', plan_meters: true });
    const result = buildVacuums({ hass: ctx.card._hass, bindings: [saved], rooms: ctx.card._roomList, floors: ctx.card._floors,
      positions: { 'object:dock': { x: 1, y: 2, floorId: 'ground' } }, now: Date.parse('2026-10-05T10:00:01Z') });
    expect(result.records[0]).toMatchObject({ measured: false, positionStatus: 'unavailable', location: { x: 1, y: 2 } }); ctx.assertNoHA();
  });
  it('labels a restored vehicle identity as stored and keeps saved freshness settings', () => {
    const saved = { ...occupancy, identity_entity: 'sensor.plate', identity_value: 'AB12 XYZ', freshness: { timestamp_mode: 'last_updated', max_age_seconds: 30 } };
    const ctx = setup({ layout: { vehicle_bindings: [saved] } }); ctx.section('vehicles'); ctx.click('edit', 0);
    ctx.card._hass.states['sensor.plate'].attributes.restored = true; ctx.editor.updatePreviews(ctx.host);
    const preview = ctx.host.querySelector('[data-trk-preview]').textContent;
    expect(preview).toContain('Identity sensor.plate is a stored/restored reading'); expect(preview).toContain('Saved explicit freshness rules are preserved.');
    ctx.click('save'); expect(ctx.card._layout.vehicle_bindings[0]).toMatchObject(saved); ctx.assertNoHA();
  });
  it('updates stored-reading status when fresh data arrives without replacing a focused control or changing its draft', () => {
    const ctx = setup(); chooseActivity(ctx); const input = ctx.host.querySelector('[data-field="trk-label"]'); input.focus(); input.value = 'My unfinished name';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.card._hass.states['binary_sensor.motion'].attributes.restored = true; ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.querySelector('[data-trk-preview]').textContent).toContain('Stored source reading:');
    ctx.card._hass.states['binary_sensor.motion'] = state('off', 'Lounge motion', { device_class: 'motion' }); ctx.editor.updatePreviews(ctx.host);
    const preview = ctx.host.querySelector('[data-trk-preview]').textContent;
    expect(preview).not.toContain('stored/restored'); expect(preview).toContain('Source reading: off'); expect(preview).toContain('Current HA state;');
    expect(ctx.host.querySelector('[data-field="trk-label"]')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('My unfinished name');
    expect(ctx.editor.draft.label).toBe('My unfinished name'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.assertNoHA();
  });
  it('updates live diagnostics without replacing a focused input or resetting its unsaved value', () => {
    const ctx = setup(); chooseActivity(ctx); const input = ctx.host.querySelector('[data-field="trk-label"]'); input.focus(); input.value = 'My unfinished name';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.card._hass.states['binary_sensor.motion'] = state('unavailable', 'Motion sensor'); ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.querySelector('[data-field="trk-label"]')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('My unfinished name');
    expect(ctx.editor.draft.label).toBe('My unfinished name'); expect(ctx.host.textContent).toContain('does not provide a current observation'); ctx.assertNoHA();
  });
  it('disables deleted live sources without replacing editable controls and keeps the draft recoverable', () => {
    const ctx = setup(); chooseActivity(ctx); const input = ctx.host.querySelector('[data-field="trk-label"]'); input.focus();
    delete ctx.card._hass.states['binary_sensor.motion']; ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.querySelector('[data-field="trk-label"]')).toBe(input); expect(input.disabled).toBe(true); expect(ctx.editor.draft.entity).toBe('binary_sensor.motion');
    ctx.click('cancel'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('uses fallback card settings until an explicit Save and does not mutate their original objects', () => {
    const fallback = [activity]; const ctx = setup({ config: { presence_bindings: fallback } }); ctx.click('edit', 0); ctx.change('label', 'New saved name');
    expect(fallback[0].label).toBeUndefined(); ctx.click('save'); expect(ctx.card._layout.presence_bindings[0].label).toBe('New saved name'); expect(fallback[0].label).toBeUndefined();
  });
  it('keeps malformed imported entries visible and clearable without crashing or deleting neighbors', () => {
    const ctx = setup({ layout: { presence_bindings: [null, { ...activity, id: undefined }, { ...activity, id: 'other' }] } });
    expect(ctx.host.textContent).toContain('Saved binding 1'); ctx.click('edit', 1); ctx.change('label', 'Repaired ID'); ctx.click('save');
    expect(ctx.card._layout.presence_bindings).toHaveLength(3); expect(ctx.card._layout.presence_bindings[0]).toBeNull(); expect(ctx.card._layout.presence_bindings[1].id).toBeTruthy(); expect(ctx.card._layout.presence_bindings[2].id).toBe('other');
    ctx.click('clear', 0); expect(ctx.card._layout.presence_bindings).toHaveLength(2);
  });
  it('rejects duplicate binding IDs and keeps an unsupported saved type explicitly visible', () => {
    const ctx = setup({ layout: { presence_bindings: [activity, { ...activity }] } }); ctx.click('edit', 0); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('IDs must be unique');
    ctx.click('cancel'); ctx.card._layout.presence_bindings = [{ ...activity, kind: 'imaginary' }]; ctx.host.innerHTML = ctx.editor.render(); ctx.click('edit', 0);
    expect(ctx.host.querySelector('[data-field="trk-kind"]').value).toBe('imaginary'); expect(ctx.host.textContent).toContain('Unsupported saved type: imaginary');
  });
  it('reset/dispose drop drafts and further delegated events cannot save or call HA', () => {
    const ctx = setup(); chooseActivity(ctx); ctx.editor.reset(); expect(ctx.editor.draft).toBeNull();
    ctx.host.innerHTML = ctx.editor.render();
    chooseActivity(ctx); ctx.editor.dispose(); expect(ctx.editor.render()).toBe('');
    expect(ctx.editor.onChange('trk-label', { value: 'late' })).toBe(false); expect(ctx.editor.onClick('trk-save')).toBe(false); ctx.editor.updatePreviews(ctx.host);
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.assertNoHA();
  });
});

describe('saved form contracts reach the real observation builders', () => {
  const options = (ctx, key) => ({ hass: ctx.card._hass, bindings: ctx.card._layout[key], rooms: ctx.card._roomList, floors: ctx.card._floors,
    positions: Object.fromEntries(ctx.card.trackingAnchors().map((anchor) => [anchor.id, anchor.position])), now: Date.parse('2026-10-05T10:00:01Z') });
  it('creates anonymous room activity, never an identified person, from a motion form Save', () => {
    const ctx = setup(); chooseActivity(ctx); ctx.click('save'); const result = buildPresence(options(ctx, 'presence_bindings'));
    expect(result.records).toHaveLength(1); expect(result.records[0]).toMatchObject({ kind: 'activity', active: true, shown: true, roomId: 'lounge' });
    expect(result.records[0].identity).toBeUndefined(); ctx.assertNoHA();
  });
  it('locates a named presence only from the exact observed room and removes its location for home/away', () => {
    const ctx = setup(); chooseRoomLocation(ctx); ctx.change('identity', 'person.taylor'); ctx.click('save');
    const result = buildPresence(options(ctx, 'presence_bindings')); expect(result.records[0]).toMatchObject({ identity: 'person.taylor', active: true, roomId: 'lounge', shown: true });
    ctx.card._hass.states['sensor.room'].state = 'home'; const home = buildPresence(options(ctx, 'presence_bindings'));
    expect(home.records[0].location).toBeNull(); expect(home.records[0].shown).toBe(false); ctx.assertNoHA();
  });
  it('keeps a maintained occupied vehicle parked and clears an event at its true source deadline', () => {
    const ctx = setup(); chooseVehicle(ctx); ctx.click('save');
    expect(buildVehicles({ ...options(ctx, 'vehicle_bindings'), now: Date.parse('2026-10-10T10:00:00Z') }).records[0]).toMatchObject({ active: true, evidence: 'maintained', shown: true });
    ctx.click('add'); ctx.change('kind', 'event'); ctx.change('entity', 'event.vehicle'); ctx.change('vehicle-confirmed', true); ctx.change('room', 'driveway'); ctx.change('timestamp-mode', 'state'); ctx.change('expires', '30'); ctx.change('event-types', 'vehicle'); ctx.click('save');
    const early = buildVehicles(options(ctx, 'vehicle_bindings')); expect(early.records[1]).toMatchObject({ active: true, evidence: 'sighting' });
    const late = buildVehicles({ ...options(ctx, 'vehicle_bindings'), now: Date.parse('2026-10-05T10:00:31Z'), memory: early.memory });
    expect(late.records[1]).toMatchObject({ active: false, shown: false }); ctx.assertNoHA();
  });
  it('places the measured vacuum at real X/Y, then shows its explicit dock status when coordinates become unavailable', () => {
    const ctx = setup(); chooseXY(ctx); ctx.click('save'); const measured = buildVacuums(options(ctx, 'vacuum_bindings'));
    expect(measured.records[0]).toMatchObject({ measured: true, active: true, shown: true, location: { x: 1.5, y: 2.5, floorId: 'ground' } });
    ctx.card._hass.states['sensor.position'].state = 'unavailable'; const stopped = buildVacuums(options(ctx, 'vacuum_bindings'));
    expect(stopped.records[0]).toMatchObject({ measured: false, positionStatus: 'unavailable', location: { x: 1, y: 2, floorId: 'ground' } });
    expect(stopped.records[0].label).toContain('status at chosen anchor; position unavailable'); ctx.assertNoHA();
  });
  it('keeps a cleaning vacuum stationary at its selected dock when only status was configured', () => {
    const ctx = setup({ layout: { vacuum_bindings: [vacuum] } }); const result = buildVacuums(options(ctx, 'vacuum_bindings'));
    expect(result.records[0]).toMatchObject({ measured: false, active: true, shown: true, location: { x: 1, y: 2 } });
    expect(result.records[0].label).toContain('position not reported'); ctx.assertNoHA();
  });
});
