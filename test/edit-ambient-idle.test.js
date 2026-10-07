// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const editors = [];
const settings = () => ({ enabled: true, idle_seconds: 120, rotate: true, rotation_degrees_per_second: 0.5,
  future: { note: 'keep' }, dim: { enabled: true, brightness: 0.65, when: 'sun_or_quiet_hours', start: '22:00', end: '07:00', future: ['retain'] } });
const sun = (elevation = -12, restored) => ({ state: elevation >= 0 ? 'above_horizon' : 'below_horizon', attributes: { elevation, azimuth: 180, ...(restored === undefined ? {} : { restored }) } });
function setup({ config = {}, layout = {}, backend = 'browser', admin = true } = {}) {
  const card = { _config: { layout_key: 'home', ...config }, _layout: { rooms: [], pins: {}, ...layout }, _built: {},
    _hass: { user: { id: 'taylor', is_admin: admin }, config: { time_zone: 'Europe/London' }, states: { 'sun.sun': sun() },
      entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn(), callWS: vi.fn() },
    _floors: [{ id: 'ground', elevation: 0 }, { id: 'first', elevation: 3 }], _roomList: [], _floor: 'ground', _mode: 'top', _editing: true,
    _stage: document.createElement('div'), _markers: [], _positions: new Map(), _store: { backend }, _history: new EditHistory(),
    _applyMarkerSelection: vi.fn(), modelBindings: () => null,
    _view: { model: null, floorElevation: () => 0, setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(),
      setControlsEnabled: vi.fn(), highlightModelNode: vi.fn(), planPoint: vi.fn(() => [1, 1]), pixelsPerMetre: () => 10 } };
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  const edit = new EditMode(card); card._edit = edit; editors.push(edit);
  card._commit = vi.fn((value) => { card._layout = value; card._history.record(snapshot()); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch) => card._commit({ ...card._layout, ...patch }));
  card.undoEdit = vi.fn(() => { const value = card._history.undo(); if (value) card._layout = value.layout; edit.render(); });
  card.redoEdit = vi.fn(() => { const value = card._history.redo(); if (value) card._layout = value.layout; edit.render(); });
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach();
  const action = (name, selector = '') => edit.panel.querySelector(`[data-act="${name}"]${selector}`);
  const click = (name, selector = '') => { const control = action(name, selector); expect(control).toBeTruthy(); control.click(); return control; };
  const idle = () => click('tab', '[data-id="idle"]');
  const field = (name) => edit.panel.querySelector(`[data-field="ambient-idle-${name}"]`);
  const change = (name, value, type = 'input') => { const control = field(name); expect(control).toBeTruthy();
    if (control.type === 'checkbox') control.checked = value; else control.value = value; control.dispatchEvent(new Event(type, { bubbles: true })); return control; };
  return { card, edit, action, click, idle, field, change };
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('Idle in the actual layout editor', () => {
  it.each(['browser', 'shared', 'user'])('opens off defaults in %s storage without a saved edit or HA action', (backend) => {
    const { card, edit, idle, field } = setup({ backend }); idle();
    expect(edit.tab).toBe('idle'); expect(edit.panel.textContent).toContain('Ambient idle'); expect(field('enabled').checked).toBe(false);
    expect(field('idle_seconds').value).toBe('120'); expect(field('dim.brightness').value).toBe('65');
    expect(card._commit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('routes native fields through one Save and restores exact raw extras through Undo/Redo', () => {
    const original = settings(), { card, idle, change, click, field } = setup({ layout: { ambient_idle: original } }); idle();
    change('idle_seconds', '30'); change('dim.brightness', '50'); change('rotate', false, 'change');
    expect(card._commit).not.toHaveBeenCalled(); click('ambient-idle-save'); click('ambient-idle-save');
    expect(card._commit).toHaveBeenCalledOnce(); expect(card._history.size).toBe(1);
    expect(card._layout.ambient_idle).toEqual({ ...original, idle_seconds: 30, rotate: false, dim: { ...original.dim, brightness: 0.5 } });
    click('history-undo'); expect(card._layout.ambient_idle).toEqual(original); expect(field('idle_seconds').value).toBe('120');
    click('history-redo'); expect(field('idle_seconds').value).toBe('30'); expect(field('dim.brightness').value).toBe('50');
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('inherits YAML settings without rewriting shared storage before explicit Save', () => {
    const inherited = settings(), { card, idle, change, click, field } = setup({ config: { ambient_idle: inherited } }); idle();
    expect(field('enabled').checked).toBe(true); change('idle_seconds', '70'); click('ambient-idle-cancel');
    expect(field('idle_seconds').value).toBe('120'); expect(card._layout.ambient_idle).toBeUndefined();
    change('idle_seconds', '70'); click('ambient-idle-save'); expect(card._layout.ambient_idle.future).toEqual(inherited.future);
    expect(card._config.ambient_idle).toEqual(inherited);
  });
  it.each([['idle_seconds', '37'], ['dim.start', '22:'], ['dim.end', '07:']])('keeps exact focused %s draft through states and rebuilds', (name, value) => {
    const { card, edit, idle, field, change } = setup({ layout: { ambient_idle: settings() } }); idle();
    const input = change(name, value); input.focus(); card._hass.states['sun.sun'] = sun(20); edit.onStates(); edit.afterUpdate();
    expect(field(name)).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe(value);
    expect(edit.panel.textContent).toContain('Current sun elevation: 20°'); expect(card._commit).not.toHaveBeenCalled();
  });
  it('preserves focused checkbox and Cancel button nodes through HA updates and afterUpdate', () => {
    const { card, edit, idle, change, field, action } = setup({ layout: { ambient_idle: settings() } }); idle();
    const checkbox = change('rotate', false, 'change'); checkbox.focus(); edit.onStates(); edit.afterUpdate();
    expect(field('rotate')).toBe(checkbox); expect(document.activeElement).toBe(checkbox); expect(checkbox.checked).toBe(false);
    const cancel = action('ambient-idle-cancel'); cancel.focus(); card._hass.states['sun.sun'] = sun(12); edit.afterUpdate();
    expect(action('ambient-idle-cancel')).toBe(cancel); expect(document.activeElement).toBe(cancel); expect(card._commit).not.toHaveBeenCalled();
  });
  it('updates source diagnostics without changing a valid draft or denying configuration Save', () => {
    const { card, edit, idle, change, click, field, action } = setup({ layout: { ambient_idle: settings() } }); idle();
    const input = change('idle_seconds', '45'); input.focus(); card._hass.states['sun.sun'] = sun(-12, true); delete card._hass.config.time_zone;
    edit.onStates(); edit.afterUpdate(); expect(field('idle_seconds')).toBe(input); expect(input.value).toBe('45');
    expect(edit.panel.textContent).toContain('No usable current sun reading'); expect(edit.panel.textContent).toContain('time zone: not reported');
    expect(action('ambient-idle-save').disabled).toBe(false); click('ambient-idle-save'); expect(card._commit).toHaveBeenCalledOnce();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('retains the global settings draft across camera/floor changes and refreshes diagnostics in place', () => {
    const { card, edit, idle, change, field, action } = setup({ layout: { ambient_idle: settings() } }); idle();
    const input = change('idle_seconds', '41'); input.focus(); card._floor = 'first'; card._mode = '3d'; card._viewId = 'upstairs';
    edit.onViewChanged(); expect(field('idle_seconds')).toBe(input); expect(document.activeElement).toBe(input);
    expect(input.value).toBe('41'); expect(action('ambient-idle-save').disabled).toBe(false); expect(card._commit).not.toHaveBeenCalled();
  });
  it.each(['key', 'uploaded source', 'model root', 'user', 'role'])('blocks dirty Save after %s replacement until Cancel', (kind) => {
    const { card, edit, idle, change, action, click, field } = setup({ config: { model: '' }, layout: { model: { name: 'old.glb' }, ambient_idle: settings() } }); idle();
    const input = change('idle_seconds', '33'); input.focus();
    if (kind === 'key') card._config.layout_key = 'other';
    if (kind === 'uploaded source') card._layout.model = { name: 'replacement.glb' };
    if (kind === 'model root') card._view.model = { root: {} };
    if (kind === 'user') card._hass.user.id = 'another';
    if (kind === 'role') card._hass.user.is_admin = false;
    edit.onStates(); edit.afterUpdate(); expect(field('idle_seconds')).toBe(input); expect(input.value).toBe('33');
    expect(action('ambient-idle-save').disabled).toBe(true); edit._ambientIdleEditor.onClick('ambient-idle-save'); expect(card._commit).not.toHaveBeenCalled();
    if (kind === 'role') card._hass.user.is_admin = true;
    edit.onStates(); expect(action('ambient-idle-save').disabled).toBe(true); click('ambient-idle-cancel');
    expect(field('idle_seconds').value).toBe('120'); expect(field('idle_seconds').disabled).toBe(false);
  });
  it('discards only unsaved changes on Cancel, tab leave, context reset and detach, with reusable reattach', () => {
    const original = settings(), { card, edit, idle, change, click, field } = setup({ layout: { ambient_idle: original } }); idle();
    change('idle_seconds', '30'); click('ambient-idle-cancel'); expect(field('idle_seconds').value).toBe('120');
    change('idle_seconds', '31'); click('tab', '[data-id="rooms"]'); expect(edit.tab).toBe('idle'); expect(edit._ambientIdleEditor.dirty).toBe(true);
    click('draft-leave-discard'); expect(edit._ambientIdleEditor.draft).toBeNull(); idle(); expect(field('idle_seconds').value).toBe('120');
    change('idle_seconds', '32'); edit.cancelHistoryGestures(); expect(edit._ambientIdleEditor.draft).toBeNull(); edit.render();
    change('idle_seconds', '33'); edit.detach(); expect(edit._ambientIdleEditor.draft).toBeNull(); expect(edit._ambientIdleEditor.disposed).toBe(false);
    edit.attach(); edit.render(); expect(field('idle_seconds').value).toBe('120'); change('idle_seconds', '34'); click('ambient-idle-save');
    expect(card._commit).toHaveBeenCalledOnce(); expect(original.idle_seconds).toBe(120);
  });
  it('clears old plan tools and edit handles, so room/device/old-handle taps cannot leave Idle or pin', () => {
    const { card, edit, idle } = setup({ layout: { rooms: [{ id: 'lounge', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], floor_id: 'ground' }] } });
    edit.drawing = { points: [[0, 0]], floorId: 'ground' }; edit.calibrating = { src: [1, 1] }; edit.colorPick = edit.doorMode = edit.overlayMove = true;
    edit.selectedRoom = 'lounge'; edit.selectedMarker = 'device:lamp'; idle();
    expect(edit.drawing).toBeNull(); expect(edit.calibrating).toBeNull(); expect(edit.selectedRoom).toBeNull(); expect(edit.selectedMarker).toBeNull();
    expect(edit.doorMode || edit.colorPick || edit.overlayMove).toBe(false); expect(card._view.setOverlay).toHaveBeenCalled();
    const event = { button: 0, clientX: 10, clientY: 10, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    card._positions.set('device:lamp', { x: 1, y: 1, z: 1, floorId: 'ground' });
    edit.canvasDown(event); edit.canvasUp(event); edit.markerDown({ id: 'device:lamp' }, event);
    edit._vertexDown(event, 'lounge', 0); edit._midDown(event, 'lounge', 0);
    expect(edit.tab).toBe('idle'); expect(edit.drag).toBeNull(); expect(card._commit).not.toHaveBeenCalled();
    expect(card._view.planPoint).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('cancels a previous held marker drag before entering Idle, rejecting its late release', () => {
    const { card, edit, idle } = setup();
    edit.drag = { kind: 'marker', id: 'device:lamp', moved: true, pos: { x: 2, y: 2, z: 1, floorId: 'ground' } };
    idle(); expect(edit.drag).toBeNull(); edit._dragEnd({}); expect(card._commit).not.toHaveBeenCalled(); expect(card._layout.pins).toEqual({});
  });
  it('keeps malformed imported values through unrelated edits until deliberate default repair', () => {
    const malformed = { enabled: 'true', dim: { enabled: true, when: 'moon', future: '<keep>' }, future: [3] };
    const { card, idle, change, click, action } = setup({ layout: { ambient_idle: malformed } }); idle();
    change('idle_seconds', '20'); expect(action('ambient-idle-save').disabled).toBe(true); click('ambient-idle-cancel');
    expect(card._layout.ambient_idle).toEqual(malformed); click('ambient-idle-repair'); click('ambient-idle-save');
    expect(card._layout.ambient_idle).toMatchObject({ enabled: false, future: [3], dim: { enabled: false, when: 'sun', future: '<keep>' } });
    expect(card._commit).toHaveBeenCalledOnce();
  });
  it('rejects nonadministrator delegation and only permanently disposes on true teardown', () => {
    const { card, edit, idle, change, field } = setup(); idle(); change('idle_seconds', '40'); card._hass.user.is_admin = false;
    edit.onStates(); edit._ambientIdleEditor.onClick('ambient-idle-save'); expect(field('idle_seconds').disabled).toBe(true); expect(card._commit).not.toHaveBeenCalled();
    edit.dispose(); expect(edit._ambientIdleEditor.disposed).toBe(true); expect(edit._ambientIdleEditor.render()).toBe('');
    expect(edit._ambientIdleEditor.onChange('ambient-idle-enabled', { checked: true })).toBe(false);
  });
});
