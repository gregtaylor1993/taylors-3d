import { describe, expect, it, vi } from 'vitest';
import { CUSTOM_CONTROL_ACTIONS, CUSTOM_CONTROL_COLORS, CUSTOM_CONTROL_LIMITS, readCustomControls,
  customControlAvailability, customControlVisibility, resolveCustomControls, replaceCustomBars, moveCustomBar, moveCustomButton, customControlCommand } from '../src/custom-controls.js';

const room = { id: 'm:living-room', floor_id: 'ground', area_id: 'lounge', name: 'Lounge' };
const views = [{ id: 'front-door', label: 'Front door', camera: { position: [1, 2, 3], target: [0, 0, 0] } }];
const button = (id, action = { type: 'scene', entity: 'scene.movie' }) => ({ id, label: id, icon: 'mdi:movie', color: 'amber', action, future: { kept: true } });
const bar = (id, buttons = [button(`${id}_movie`)]) => ({ id, label: id, placement: 'bottom', style: 'pills', buttons, future: `bar-${id}` });
const settings = () => ({ version: 1, future: { kept: true }, bars: [bar('evening', [button('movie'), button('bedtime')]),
  { ...bar('lounge', [button('lamp', { type: 'toggle', entity: 'light.lounge' })]), placement: 'room', room_id: room.id }, bar('empty', [])] });
const hass = () => ({ user: { id: 'current', is_active: true, is_admin: true, permissions: { control: true } }, connection: { connected: true },
  auth: {}, services: { scene: { turn_on: {} }, script: { turn_on: {} }, automation: { trigger: {} },
    light: { toggle: {} }, switch: { toggle: {} }, fan: { toggle: {} }, input_boolean: { toggle: {} } },
  callService: vi.fn(), entities: {}, devices: {}, states: {
    'scene.movie': { entity_id: 'scene.movie', state: 'unknown', attributes: {} },
    'script.bedtime': { state: 'off', attributes: {} }, 'automation.doorbell': { state: 'off', attributes: {} },
    'light.lounge': { state: 'on', attributes: { friendly_name: 'Lounge lamp' } },
    'switch.socket': { state: 'off', attributes: {} }, 'fan.office': { state: 'off', attributes: {} },
    'input_boolean.home': { state: 'off', attributes: {} }, 'sensor.temperature': { state: '18.5', attributes: {} },
  } });
const options = (raw = settings(), h = hass()) => ({ hass: h, settings: raw, views, rooms: [room] });
const command = (extra = {}, raw = settings(), h = hass()) => customControlCommand({ ...options(raw, h), barId: 'evening', buttonId: 'movie', ...extra });
const actionSetting = (action) => ({ version: 1, bars: [bar('evening', [button('movie', action)])] });
const defineGetter = (value, key, getter, enumerable = true) => Object.defineProperty(value, key, { get: getter, enumerable, configurable: true });

describe('explicit compact docks and visibility', () => {
  const condition = { type: 'state', entity: 'vacuum.house', state: 'cleaning' };
  const conditional = () => { const raw = settings(); raw.bars[0].dock = { limit: 4, extra: 'kept' }; Object.assign(raw.bars[0].buttons[0], { pinned: true, visibility: { ...condition, extra: ['kept'] } }); return raw; };
  const readings = () => { const h = hass(); h.states['vacuum.house'] = { entity_id: 'vacuum.house', state: 'cleaning', attributes: { friendly_name: 'Vacuum' } }; return h; };
  it('retains future visibility data and refuses dispatch until its discriminator is deliberately repaired', () => {
    const raw = conditional(), h = readings(); raw.bars[0].buttons[0].visibility.type = 'future-rule'; const before = structuredClone(raw);
    expect(readCustomControls(raw).valid).toBe(false);
    expect(customControlVisibility({ hass: h, visibility: raw.bars[0].buttons[0].visibility })).toMatchObject({ visible: true, available: false, conditionStatus: 'invalid' });
    expect(command({}, raw, h).available).toBe(false); expect(replaceCustomBars(raw, raw.bars)).toBeNull(); expect(raw).toEqual(before);
    const repaired = structuredClone(raw); repaired.bars[0].buttons[0].visibility.type = 'state';
    expect(command({}, repaired, h).available).toBe(true); expect(raw).toEqual(before); expect(h.callService).not.toHaveBeenCalled();
  });
  it('keeps the old schema and all unknown extensions unchanged, with opt-in four or five places', () => {
    const raw = conditional(), before = structuredClone(raw); expect(readCustomControls(raw).valid).toBe(true);
    expect(replaceCustomBars(raw, raw.bars)).toEqual(before); expect(raw).toEqual(before);
    raw.bars[0].dock.limit = 5; expect(readCustomControls(raw).valid).toBe(true); expect(readCustomControls(settings()).valid).toBe(true);
  });
  it.each([null, false, { limit: 0 }, { limit: 6 }, { limit: '5' }])('does not silently repair malformed dock %j', (dock) => {
    const raw = settings(); raw.bars[0].dock = dock; expect(readCustomControls(raw).valid).toBe(false);
  });
  it('rejects too many deliberately pinned buttons rather than silently hiding a favourite', () => {
    const raw = conditional(); raw.bars[0].buttons = Array.from({ length: 5 }, (_, index) => ({ ...button(`p${index}`), pinned: true }));
    expect(readCustomControls(raw).diagnostics.some((entry) => entry.code === 'pinned')).toBe(true);
  });
  it.each([null, {}, { type: 'state', entity: '', state: 'cleaning' }, { type: 'state', entity: 'vacuum.house', state: 'unknown' },
    { type: 'state', entity: 'vacuum.house', state: 'unavailable' }, { type: 'template', entity: 'vacuum.house', state: 'cleaning' }])('rejects malformed visibility %j', (visibility) => {
    const raw = settings(); raw.bars[0].buttons[0].visibility = visibility; expect(readCustomControls(raw).valid).toBe(false);
  });
  it.each([['cleaning', true, 'matched'], ['docked', false, 'false'], ['unknown', true, 'unknown'], ['unavailable', true, 'missing']])('distinguishes the actual %s reading', (state, visible, conditionStatus) => {
    const h = readings(); h.states['vacuum.house'].state = state;
    expect(customControlVisibility({ hass: h, visibility: condition })).toMatchObject({ visible, conditionStatus });
    const raw = conditional(), resolved = resolveCustomControls(options(raw, h)).bars[0].buttons[0];
    expect(resolved.visible).toBe(visible); expect(resolved.available).toBe(state === 'cleaning');
    expect(command({}, raw, h).available).toBe(state === 'cleaning'); expect(h.callService).not.toHaveBeenCalled();
  });
  it('keeps a missing source visible and unavailable; never infers it from a friendly name', () => {
    const h = readings(); delete h.states['vacuum.house']; h.states['vacuum.other'] = { state: 'cleaning', attributes: { friendly_name: 'Vacuum' } };
    expect(customControlVisibility({ hass: h, visibility: condition })).toMatchObject({ visible: true, available: false, conditionStatus: 'missing' });
  });
  it('never calls accessors on condition settings or readings', () => {
    const getter = vi.fn(() => 'cleaning'), raw = conditional(), h = readings(); defineGetter(raw.bars[0].buttons[0].visibility, 'state', getter, false);
    expect(readCustomControls(raw).valid).toBe(false); expect(customControlVisibility({ hass: h, visibility: raw.bars[0].buttons[0].visibility }).conditionStatus).toBe('invalid');
    defineGetter(h.states['vacuum.house'], 'state', getter); expect(customControlVisibility({ hass: h, visibility: condition }).conditionStatus).toBe('missing');
    expect(getter).not.toHaveBeenCalled();
  });
  it('changes the held-command context when condition evidence or exact source metadata changes', () => {
    const raw = conditional(), h = readings(), initial = resolveCustomControls(options(raw, h));
    h.states['vacuum.house'].state = 'docked'; expect(resolveCustomControls(options(raw, h)).contextKey).not.toBe(initial.contextKey);
    h.states['vacuum.house'].state = 'cleaning'; h.entities['vacuum.house'] = { area_id: 'new-area' }; expect(resolveCustomControls(options(raw, h)).contextKey).not.toBe(initial.contextKey);
  });
  it('shows selected view or room only from exact current IDs and leaves unknown selection unclaimed', () => {
    const raw = actionSetting({ type: 'view', view_id: views[0].id });
    expect(resolveCustomControls({ ...options(raw), selectedViewId: views[0].id }).bars[0].buttons[0].active).toBe(true);
    expect(resolveCustomControls(options(raw)).bars[0].buttons[0]).not.toHaveProperty('active');
    expect(resolveCustomControls({ ...options(), placement: 'room', roomId: room.id, selectedRoomId: room.id }).bars[0].selected).toBe(true);
    expect(resolveCustomControls({ ...options(), placement: 'room', roomId: room.id, rooms: [], selectedRoomId: room.id }).bars[0]).not.toHaveProperty('selected');
  });
});

describe('custom controls raw schema and recovery', () => {
  it('exports one fixed shared set of limits, colours and actions', () => {
    expect(CUSTOM_CONTROL_LIMITS).toEqual({ bars: 8, buttonsPerBar: 12, total: 96, id: 64, label: 80, icon: 68, roomId: 256 });
    expect(CUSTOM_CONTROL_COLORS).toEqual(['theme', 'amber', 'teal', 'blue', 'purple', 'red']);
    expect(CUSTOM_CONTROL_ACTIONS).toEqual(['view', 'scene', 'script', 'automation', 'toggle', 'more-info']);
    expect(Object.isFrozen(CUSTOM_CONTROL_LIMITS)).toBe(true); expect(Object.isFrozen(CUSTOM_CONTROL_COLORS)).toBe(true);
  });
  it('reads undefined as the empty default and keeps valid imported rows and all extras intact', () => {
    expect(readCustomControls(undefined)).toEqual({ valid: true, bars: [], diagnostics: [] });
    const raw = settings(), before = structuredClone(raw), parsed = readCustomControls(raw);
    expect(parsed.valid).toBe(true); expect(parsed.bars).toBe(raw.bars); expect(raw).toEqual(before);
    expect(replaceCustomBars(undefined, [])).toEqual({ version: 1, bars: [] });
  });
  it.each([null, false, '', [], { version: 2, bars: [] }, { version: 1, bars: null }, { bars: [] }])('keeps malformed/future raw input untouched and refuses implicit replacement: %j', (raw) => {
    const before = structuredClone(raw); expect(readCustomControls(raw).valid).toBe(false);
    expect(replaceCustomBars(raw, [])).toBeNull(); expect(raw).toEqual(before);
    expect(resolveCustomControls({ ...options(), settings: raw }).bars).toEqual([]);
  });
  it.each([
    ['bar id', (r) => { r.bars[0].id = 'with spaces'; }],
    ['bar label', (r) => { r.bars[0].label = 'x'.repeat(81); }],
    ['placement', (r) => { r.bars[0].placement = 'sidebar'; }],
    ['room', (r) => { r.bars[1].room_id = ''; }],
    ['style', (r) => { r.bars[0].style = 'html'; }],
    ['button id', (r) => { r.bars[0].buttons[0].id = 'x'.repeat(65); }],
    ['button label', (r) => { r.bars[0].buttons[0].label = {}; }],
    ['icon', (r) => { r.bars[0].buttons[0].icon = 'mdi:<script>'; }],
    ['colour', (r) => { r.bars[0].buttons[0].color = '#fff'; }],
    ['action', (r) => { r.bars[0].buttons[0].action = { type: 'unlock', entity: 'lock.front' }; }],
    ['action domain', (r) => { r.bars[0].buttons[0].action = { type: 'scene', entity: 'script.movie' }; }],
    ['toggle domain', (r) => { r.bars[0].buttons[0].action = { type: 'toggle', entity: 'lock.front' }; }],
    ['skip conditions', (r) => { r.bars[0].buttons[0].action = { type: 'automation', entity: 'automation.doorbell', skip_conditions: 'true' }; }],
    ['skip on another action', (r) => { r.bars[0].buttons[0].action.skip_conditions = true; }],
    ['view reference', (r) => { r.bars[0].buttons[0].action = { type: 'view', view_id: '' }; }],
  ])('rejects invalid %s without silently repairing it', (_name, edit) => {
    const raw = settings(); edit(raw); const before = structuredClone(raw);
    expect(readCustomControls(raw).valid).toBe(false); expect(replaceCustomBars(undefined, raw.bars)).toBeNull(); expect(raw).toEqual(before);
  });
  it('rejects globally duplicated buttons even in different placements, and separately duplicated bars', () => {
    const raw = settings(); raw.bars[1].buttons[0].id = 'movie';
    expect(readCustomControls(raw).diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate_button', barId: 'lounge', buttonId: 'movie' }));
    expect(command({}, raw).available).toBe(false);
    const duplicate = settings(); duplicate.bars[2].id = 'evening';
    expect(readCustomControls(duplicate).diagnostics.some((item) => item.code === 'duplicate_bar')).toBe(true);
  });
  it('enforces bar/button caps and accepts the exact full 96-button boundary', () => {
    const full = { version: 1, bars: Array.from({ length: 8 }, (_, b) => bar(`bar_${b}`, Array.from({ length: 12 }, (_, i) => button(`button_${b}_${i}`)))) };
    expect(readCustomControls(full).valid).toBe(true);
    expect(readCustomControls({ ...full, bars: [...full.bars, bar('overflow', [])] }).valid).toBe(false);
    const many = settings(); many.bars[0].buttons = Array.from({ length: 13 }, (_, i) => button(`b_${i}`));
    expect(readCustomControls(many).valid).toBe(false);
  });
  it.each(['root', 'button', 'action', 'non-enumerable', 'array', 'toJSON'])('does not invoke a raw %s getter or custom JSON hook', (kind) => {
    const raw = settings(), getter = vi.fn(() => 'injected');
    if (kind === 'root') defineGetter(raw, 'version', getter);
    if (kind === 'button') defineGetter(raw.bars[0].buttons[0], 'label', getter);
    if (kind === 'action') defineGetter(raw.bars[0].buttons[0].action, 'entity', getter);
    if (kind === 'non-enumerable') defineGetter(raw, 'hiddenExtra', getter, false);
    if (kind === 'array') defineGetter(raw.bars, 'extra', getter);
    if (kind === 'toJSON') raw.toJSON = getter;
    expect(readCustomControls(raw).valid).toBe(false); expect(replaceCustomBars(raw, [])).toBeNull();
    expect(command({}, raw).available).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it('rejects cyclic/oversized/non-JSON imports without consuming them', () => {
    const raw = settings(); raw.extra = raw; expect(readCustomControls(raw).valid).toBe(false);
    expect(readCustomControls({ ...settings(), extra: 'x'.repeat(100001) }).valid).toBe(false);
    expect(readCustomControls({ ...settings(), extra: new Date() }).valid).toBe(false);
    expect(readCustomControls({ ...settings(), extra: NaN }).valid).toBe(false);
  });
  it.each(['bars', 'buttons', 'extra'])('rejects a raw %s array subclass without executing its inherited iterator getter', (kind) => {
    class ImportedArray extends Array {}
    const getter = vi.fn(() => Array.prototype[Symbol.iterator]);
    Object.defineProperty(ImportedArray.prototype, Symbol.iterator, { get: getter });
    const raw = settings();
    if (kind === 'bars') raw.bars = ImportedArray.from(raw.bars);
    if (kind === 'buttons') raw.bars[0].buttons = ImportedArray.from(raw.bars[0].buttons);
    if (kind === 'extra') raw.extra = ImportedArray.from([1, 2, 3]);
    const result = readCustomControls(raw);
    expect(getter).not.toHaveBeenCalled(); expect(result.valid).toBe(false);
  });
});

describe('current action descriptors without HA calls', () => {
  it.each([
    ['scene', 'scene.movie', 'scene', 'turn_on', { entity_id: 'scene.movie' }],
    ['script', 'script.bedtime', 'script', 'turn_on', { entity_id: 'script.bedtime' }],
    ['automation', 'automation.doorbell', 'automation', 'trigger', { entity_id: 'automation.doorbell', skip_condition: false }],
    ['toggle', 'light.lounge', 'light', 'toggle', { entity_id: 'light.lounge' }],
    ['toggle', 'switch.socket', 'switch', 'toggle', { entity_id: 'switch.socket' }],
    ['toggle', 'fan.office', 'fan', 'toggle', { entity_id: 'fan.office' }],
    ['toggle', 'input_boolean.home', 'input_boolean', 'toggle', { entity_id: 'input_boolean.home' }],
  ])('describes %s for the exact %s current source', (type, entity, domain, service, data) => {
    const h = hass(), raw = actionSetting({ type, entity }), before = structuredClone(raw);
    expect(command({}, raw, h)).toEqual({ available: true, issue: '', kind: 'service', domain, service, data, entityId: entity });
    expect(raw).toEqual(before); expect(h.callService).not.toHaveBeenCalled();
  });
  it('supports an off automation and makes Skip conditions an explicit separate boolean', () => {
    const action = { type: 'automation', entity: 'automation.doorbell', skip_conditions: true }, h = hass();
    expect(customControlAvailability({ hass: h, action }).data).toEqual({ entity_id: action.entity, skip_condition: true });
    expect(customControlAvailability({ hass: h, action: { ...action, skip_conditions: false } }).data.skip_condition).toBe(false);
    expect(h.states[action.entity].state).toBe('off'); expect(h.callService).not.toHaveBeenCalled();
  });
  it('keeps arbitrary imported service data inert while preserving it in pure edits', () => {
    const action = { type: 'automation', entity: 'automation.doorbell', data: { skip_condition: true, entity_id: 'automation.other' },
      service: 'delete', target: { entity_id: 'all' }, future: { kept: true } };
    const raw = actionSetting(action), next = replaceCustomBars(raw, raw.bars);
    expect(next.bars[0].buttons[0].action).toEqual(action);
    expect(command({}, next).data).toEqual({ entity_id: 'automation.doorbell', skip_condition: false });
  });
  it('uses an exact visible saved view without an HA service, never its label or a substitute', () => {
    const h = hass(); delete h.callService; delete h.services;
    const raw = actionSetting({ type: 'view', view_id: 'front-door' });
    expect(command({}, raw, h)).toEqual({ available: true, issue: '', kind: 'view', viewId: 'front-door' });
    for (const current of [[], [{ ...views[0], hidden: true }], [views[0], { ...views[0] }], [{ id: 'other', label: 'front-door' }]]) {
      expect(command({ views: current }, raw, h).available).toBe(false);
    }
  });
  it('describes All controls for a usable exact entity without a service', () => {
    const h = hass(); delete h.callService; delete h.services;
    expect(command({}, actionSetting({ type: 'more-info', entity: 'sensor.temperature' }), h))
      .toEqual({ available: true, issue: '', kind: 'more-info', entityId: 'sensor.temperature' });
  });
  it.each(['missing', 'unavailable', 'unknown', 'restored', 'bad restored', 'wrong entity', 'bad attributes', 'hidden', 'disabled', 'diagnostic', 'disabled device'])('withholds commands after current %s evidence', (kind) => {
    const h = hass(), entity = 'light.lounge', state = h.states[entity];
    if (kind === 'missing') delete h.states[entity];
    if (kind === 'unavailable' || kind === 'unknown') state.state = kind;
    if (kind === 'restored') state.attributes.restored = true;
    if (kind === 'bad restored') state.attributes.restored = 'false';
    if (kind === 'wrong entity') state.entity_id = 'light.another';
    if (kind === 'bad attributes') state.attributes = [];
    if (kind === 'hidden') h.entities[entity] = { hidden_by: 'user' };
    if (kind === 'disabled') h.entities[entity] = { disabled_by: 'integration' };
    if (kind === 'diagnostic') h.entities[entity] = { entity_category: 'diagnostic' };
    if (kind === 'disabled device') { h.entities[entity] = { device_id: 'device' }; h.devices.device = { disabled_by: 'user' }; }
    expect(command({}, actionSetting({ type: 'toggle', entity }), h).available).toBe(false); expect(h.callService).not.toHaveBeenCalled();
  });
  it('retains legitimate unknown scenes but does not invent scene state from malformed timestamps', () => {
    const h = hass(); expect(command({}, actionSetting({ type: 'scene', entity: 'scene.movie' }), h).available).toBe(true);
    h.states['scene.movie'].state = '2026-10-06T12:00:00Z'; expect(command({}, actionSetting({ type: 'scene', entity: 'scene.movie' }), h).available).toBe(true);
    h.states['scene.movie'].state = 'on'; expect(command({}, actionSetting({ type: 'scene', entity: 'scene.movie' }), h).available).toBe(false);
  });
  it.each(['disconnected', 'inactive', 'no user', 'bad active', 'no service', 'false service', 'no caller'])('revalidates current %s before describing a command', (kind) => {
    const h = hass();
    if (kind === 'disconnected') h.connection.connected = false;
    if (kind === 'inactive') h.user.is_active = false;
    if (kind === 'no user') delete h.user;
    if (kind === 'bad active') h.user.is_active = 'true';
    if (kind === 'no service') delete h.services.scene.turn_on;
    if (kind === 'false service') h.services.scene.turn_on = false;
    if (kind === 'no caller') delete h.callService;
    expect(command({}, settings(), h).available).toBe(false); if (h.callService) expect(h.callService).not.toHaveBeenCalled();
  });
  it.each(['state', 'attributes', 'registry', 'device', 'service', 'user', 'view', 'room'])('never invokes an untrusted %s getter', (kind) => {
    const h = hass(), getter = vi.fn(() => 'injected'), raw = settings(), currentViews = structuredClone(views), currentRoom = { ...room };
    let extra = {};
    if (kind === 'state') defineGetter(h.states, 'scene.movie', getter);
    if (kind === 'attributes') defineGetter(h.states['scene.movie'].attributes, 'restored', getter);
    if (kind === 'registry') defineGetter(h.entities, 'scene.movie', getter);
    if (kind === 'device') { h.entities['scene.movie'] = { device_id: 'camera' }; defineGetter(h.devices, 'camera', getter); }
    if (kind === 'service') defineGetter(h.services.scene, 'turn_on', getter);
    if (kind === 'user') defineGetter(h.user, 'id', getter);
    if (kind === 'view') { raw.bars[0].buttons[0].action = { type: 'view', view_id: 'front-door' }; defineGetter(currentViews[0], 'camera', getter); extra.views = currentViews; }
    if (kind === 'room') { defineGetter(currentRoom, 'area_id', getter); extra = { placement: 'room', roomId: room.id, barId: 'lounge', buttonId: 'lamp', rooms: [currentRoom] }; }
    expect(command(extra, raw, h).available).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(h.callService).not.toHaveBeenCalled();
  });
  it('supports the trusted native Connection prototype getter and safely handles its failure', () => {
    const h = hass(); h.connection = new (class { get connected() { return true; } })();
    expect(command({}, settings(), h).available).toBe(true);
    h.connection = new (class { get connected() { throw Error('closed'); } })();
    expect(command({}, settings(), h).available).toBe(false);
  });
});

describe('exact placement, current context and immutable moves', () => {
  it('keeps missing saved entity/view/room links visible and explicitly unavailable', () => {
    const raw = settings(); raw.bars[0].buttons[0].action.entity = 'scene.missing';
    raw.bars[0].buttons[1].action = { type: 'view', view_id: 'saved-missing' };
    const result = resolveCustomControls(options(raw));
    expect(result.bars.map((entry) => entry.id)).toEqual(['evening', 'empty']);
    expect(result.bars[0].buttons).toHaveLength(2); expect(result.bars[0].buttons.every((entry) => !entry.available && !!entry.issue)).toBe(true);
    const missing = resolveCustomControls({ ...options(raw), placement: 'room', roomId: room.id, rooms: [] });
    expect(missing.bars[0].id).toBe('lounge'); expect(missing.bars[0].buttons[0].issueCode).toBe('room');
    expect(command({}, replaceCustomBars(raw, raw.bars)).available).toBe(false);
  });
  it('only describes the exact room/bar/button relationship and never borrows a same-name room', () => {
    const raw = settings(), extra = { placement: 'room', roomId: room.id, barId: 'lounge', buttonId: 'lamp' };
    expect(command(extra, raw).available).toBe(true);
    for (const rooms of [[], [room, { ...room }], [{ ...room, id: 'other' }], [{ ...room, stale: true }]]) expect(command({ ...extra, rooms }, raw).available).toBe(false);
    expect(command({ ...extra, roomId: 'other' }, raw).available).toBe(false);
    expect(command({ ...extra, placement: 'bottom' }, raw).available).toBe(false);
    expect(command({ buttonId: 'lamp' }, raw).available).toBe(false);
  });
  it.each([{ editing: true }, { loading: true }, { editing: 'true' }, { loading: undefined, placement: 'sidebar' }])('does not run controls in an unsupported/suspended context %j', (extra) => {
    const h = hass(); expect(command(extra, settings(), h).available).toBe(false); expect(h.callService).not.toHaveBeenCalled();
  });
  it.each(['placement', 'roomId', 'editing', 'loading', 'contextKey', 'userId'])('does not serialize or execute hooks in an invalid %s context', (key) => {
    const h = hass(), hook = vi.fn(() => 'injected'), value = { toJSON: hook }, opts = options(settings(), h);
    if (key === 'userId') h.user.id = value; else opts[key] = value;
    const result = resolveCustomControls(opts);
    expect(typeof result.contextKey).toBe('string'); expect(result.bars.flatMap((entry) => entry.buttons).every((entry) => !entry.available)).toBe(true);
    expect(hook).not.toHaveBeenCalled(); expect(h.callService).not.toHaveBeenCalled();
  });
  it('fences settings/actions/auth/connection/source/view/room changes without changing for ordinary names, values or locale', () => {
    const raw = settings(), h = hass(), opts = options(raw, h), initial = resolveCustomControls(opts).contextKey;
    h.locale = { language: 'de' }; h.states['scene.movie'].state = '2026-10-06T13:00:00Z'; h.states['scene.movie'].attributes.friendly_name = 'Film';
    h.states['light.lounge'].state = 'off';
    expect(resolveCustomControls(opts).contextKey).toBe(initial);
    h.user.permissions.control = false; expect(resolveCustomControls(opts).contextKey).not.toBe(initial); h.user.permissions.control = true;
    h.auth = {}; expect(resolveCustomControls(opts).contextKey).not.toBe(initial);
    const current = resolveCustomControls(opts).contextKey; h.connection = { connected: true }; expect(resolveCustomControls(opts).contextKey).not.toBe(current);
    const connectionKey = resolveCustomControls(opts).contextKey; raw.bars[0].buttons[0].action.entity = 'scene.missing'; expect(resolveCustomControls(opts).contextKey).not.toBe(connectionKey);
    const roomOpts = { ...opts, placement: 'room', roomId: room.id, rooms: [{ ...room }] }, roomKey = resolveCustomControls(roomOpts).contextKey;
    roomOpts.rooms[0].name = 'Salon'; expect(resolveCustomControls(roomOpts).contextKey).toBe(roomKey);
    roomOpts.rooms[0].floor_id = 'first'; expect(resolveCustomControls(roomOpts).contextKey).not.toBe(roomKey);
    const viewRaw = actionSetting({ type: 'view', view_id: 'front-door' }), viewOpts = { ...options(viewRaw, h), views: structuredClone(views) }, viewKey = resolveCustomControls(viewOpts).contextKey;
    viewOpts.views[0].label = 'Entrée'; expect(resolveCustomControls(viewOpts).contextKey).toBe(viewKey);
    viewOpts.views[0].camera.position[0] = 99; expect(resolveCustomControls(viewOpts).contextKey).not.toBe(viewKey);
  });
  it('revalidates current data after a previously available resolved snapshot', () => {
    const raw = settings(), h = hass(); expect(resolveCustomControls(options(raw, h)).bars[0].buttons[0].available).toBe(true);
    delete h.services.scene.turn_on; expect(command({}, raw, h).available).toBe(false); expect(h.callService).not.toHaveBeenCalled();
  });
  it('fences an available linked entity/device moving to another exact room while ignoring its name and readings', () => {
    const h = hass(), raw = actionSetting({ type: 'toggle', entity: 'light.lounge' }), opts = options(raw, h);
    h.entities['light.lounge'] = { device_id: 'device', area_id: 'lounge', name: 'My lamp', hidden_by: null, disabled_by: null };
    h.devices.device = { area_id: 'lounge', disabled_by: null };
    const initial = resolveCustomControls(opts).contextKey;
    h.entities['light.lounge'].name = 'Renamed lamp'; h.states['light.lounge'].state = 'off'; h.states['light.lounge'].attributes.brightness = 90;
    expect(resolveCustomControls(opts).contextKey).toBe(initial);
    h.entities['light.lounge'].area_id = 'bedroom';
    expect(command({}, raw, h).available).toBe(true); expect(resolveCustomControls(opts).contextKey).not.toBe(initial);
    const changed = resolveCustomControls(opts).contextKey; h.devices.device.area_id = 'garage';
    expect(command({}, raw, h).available).toBe(true); expect(resolveCustomControls(opts).contextKey).not.toBe(changed);
    const deviceKey = resolveCustomControls(opts).contextKey; h.entities['light.lounge'].device_id = 'another'; h.devices.another = { area_id: 'garage' };
    expect(resolveCustomControls(opts).contextKey).not.toBe(deviceKey);
  });
  it('replaces bars without mutating the original and preserves unrelated imported extras', () => {
    const raw = settings(), before = structuredClone(raw), next = replaceCustomBars(raw, [{ ...raw.bars[0], label: 'New label' }, ...raw.bars.slice(1)]);
    expect(raw).toEqual(before); expect(next.future).toBe(raw.future); expect(next.bars[1]).toBe(raw.bars[1]);
    expect(next.bars[0].future).toBe('bar-evening'); expect(next.bars[0].buttons[0].future).toEqual({ kept: true });
  });
  it('preserves safe non-enumerable extra data through replacement and moves', () => {
    const raw = settings(); Object.defineProperty(raw, 'extra', { value: { kept: 'root' } });
    Object.defineProperty(raw.bars[1], 'extra', { value: { kept: 'bar' } });
    const next = moveCustomButton(raw, 'evening', 'movie', 'lounge');
    expect(next.extra).toBe(raw.extra); expect(next.bars[1].extra).toBe(raw.bars[1].extra);
    expect(Object.getOwnPropertyDescriptor(next, 'extra').enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(next.bars[1], 'extra').enumerable).toBe(false);
  });
  it('moves bars before an exact target or to the end and keeps their contents intact', () => {
    const raw = settings(), before = structuredClone(raw), moved = moveCustomBar(raw, 'empty', 'evening');
    expect(moved.bars.map((entry) => entry.id)).toEqual(['empty', 'evening', 'lounge']);
    expect(moveCustomBar(moved, 'empty').bars.map((entry) => entry.id)).toEqual(['evening', 'lounge', 'empty']);
    expect(moveCustomBar(raw, 'evening', 'evening')).toEqual(raw); expect(raw).toEqual(before);
  });
  it('moves buttons within and between bars, preserving global IDs/action/extras and unrelated references', () => {
    const raw = settings(), before = structuredClone(raw), reordered = moveCustomButton(raw, 'evening', 'bedtime', 'evening', 'movie');
    expect(reordered.bars[0].buttons.map((entry) => entry.id)).toEqual(['bedtime', 'movie']);
    const moved = moveCustomButton(raw, 'evening', 'movie', 'lounge', 'lamp');
    expect(moved.bars[0].buttons.map((entry) => entry.id)).toEqual(['bedtime']); expect(moved.bars[1].buttons.map((entry) => entry.id)).toEqual(['movie', 'lamp']);
    expect(moved.bars[1].buttons[0]).toBe(raw.bars[0].buttons[0]); expect(moved.bars[1].future).toBe(raw.bars[1].future); expect(moved.bars[2]).toBe(raw.bars[2]);
    expect(moveCustomButton(moved, 'lounge', 'movie', 'evening').bars[0].buttons.map((entry) => entry.id)).toEqual(['bedtime', 'movie']);
    expect(moveCustomButton(raw, 'evening', 'movie', 'evening', 'movie')).toEqual(raw); expect(raw).toEqual(before);
  });
  it.each([
    ['missing', 'movie', 'lounge', null], ['evening', 'missing', 'lounge', null], ['evening', 'movie', 'missing', null],
    ['evening', 'movie', 'lounge', 'movie'], ['evening', 'movie', 'lounge', 'missing'], ['evening', 'lamp', 'lounge', null],
  ])('refuses ambiguous/foreign moves %s/%s → %s/%s', (from, id, to, before) => {
    const raw = settings(), old = structuredClone(raw); expect(moveCustomButton(raw, from, id, to, before)).toBeNull(); expect(raw).toEqual(old);
  });
  it('refuses a move into a full bar or any duplicated imported source without deleting a button', () => {
    const raw = settings(); raw.bars[1].buttons = Array.from({ length: 12 }, (_, i) => button(`lamp_${i}`)); const before = structuredClone(raw);
    expect(moveCustomButton(raw, 'evening', 'movie', 'lounge')).toBeNull(); expect(raw).toEqual(before);
    raw.bars[1].buttons[0].id = 'movie'; expect(moveCustomButton(raw, 'evening', 'movie', 'empty')).toBeNull();
    expect(moveCustomBar(raw, 'empty', 'evening')).toBeNull(); expect(moveCustomBar(settings(), 'missing')).toBeNull();
    expect(moveCustomBar(settings(), 'evening', 'missing')).toBeNull();
  });
  it('supports frozen inputs and a cancelled draft by leaving original arrays and objects untouched', () => {
    const raw = settings(), old = structuredClone(raw);
    Object.freeze(raw.bars[0].buttons[0].action); Object.freeze(raw.bars[0].buttons); Object.freeze(raw.bars[0]); Object.freeze(raw.bars); Object.freeze(raw);
    const draft = moveCustomButton(raw, 'evening', 'movie', 'empty'); expect(draft).not.toBeNull(); expect(raw).toEqual(old);
    expect(readCustomControls(raw).bars[0].buttons.map((entry) => entry.id)).toEqual(['movie', 'bedtime']);
    expect(moveCustomButton(draft, 'empty', 'movie', 'evening', 'bedtime')).toEqual(raw);
  });
});
