// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const editors = [];
const saved = (extra = {}) => ({ title: 'Our home', weather_entity: 'weather.local',
  alarm_entity: 'alarm_control_panel.house', person_entities: ['person.taylor'], extension: { keep: true }, ...extra });
const state = (entity_id, name, value = 'home') => ({ entity_id, state: value, attributes: { friendly_name: name } });

function setup({ layout = {}, config = {}, backend = 'browser' } = {}) {
  const floors = [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'first', name: 'First', elevation: 3 }];
  const card = { isConnected: true, _editing: true, _config: { layout_key: 'home', layout_style: 'house', ...config },
    _layout: { rooms: [], pins: {}, ...layout }, _built: {}, _floor: 'ground', _mode: 'top',
    _floors: floors, _roomList: [], _markers: [], _positions: new Map(), _stage: document.createElement('div'),
    _store: { backend }, _history: new EditHistory(), _applyMarkerSelection: vi.fn(), modelBindings: () => null,
    _hass: { user: { id: 'taylor', is_active: true, is_admin: true }, connection: { connected: true },
      entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn(), callWS: vi.fn(), states: {
        'weather.local': state('weather.local', 'Local weather', 'sunny'),
        'weather.second': state('weather.second', 'Other weather', 'cloudy'),
        'alarm_control_panel.house': state('alarm_control_panel.house', 'House alarm', 'disarmed'),
        'person.taylor': state('person.taylor', 'Taylor'), 'person.second': state('person.second', 'Second person', 'not_home'),
      } },
    _view: { model: null, floorElevation: (id) => floors.find((floor) => floor.id === id)?.elevation,
      setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(), setControlsEnabled: vi.fn(),
      highlightModelNode: vi.fn(), planPoint: vi.fn(() => [1, 1]), pixelsPerMetre: () => 10 } };
  const edit = new EditMode(card); card._edit = edit; editors.push(edit);
  card.houseSummaryEditorAvailable = vi.fn(() => card._editing === true && edit.tab === 'house'
    && card._config.layout_style === 'house' && card.isConnected === true && card._hass.connection.connected === true
    && card._hass.user.is_admin === true && card._hass.user.is_active === true && !!card._hass.user.id.trim());
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  card._commit = vi.fn((next, label) => { card._layout = next; card._history.record(snapshot(), label); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch, label) => card._commit({ ...card._layout, ...patch }, label));
  card.undoEdit = vi.fn(() => { const value = card._history.undo(); if (value) card._layout = value.layout; edit.render(); });
  card.redoEdit = vi.fn(() => { const value = card._history.redo(); if (value) card._layout = value.layout; edit.render(); });
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach();
  const action = (name, suffix = '') => edit.panel.querySelector(`[data-act="${name}"]${suffix}`);
  const click = (name, suffix = '') => { const node = action(name, suffix); expect(node).toBeTruthy(); node.click(); return node; };
  const house = () => click('tab', '[data-id="house"]');
  const field = (name) => edit.panel.querySelector(`[data-field="house-summary-${name}"]`);
  const change = (name, value, type = 'input') => { const node = field(name); expect(node).toBeTruthy(); node.focus(); node.value = value;
    node.dispatchEvent(new Event(type, { bubbles: true })); return node; };
  return { card, edit, action, click, house, field, change };
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('House summary in the actual editor', () => {
  it.each(['browser', 'shared', 'user'])('shows optional House defaults in %s storage without choosing sources or writing', (backend) => {
    const { card, edit, house, field, action } = setup({ backend }); house();
    expect(edit.tab).toBe('house'); expect(field('title').value).toBe(''); expect(field('weather_entity').value).toBe('');
    expect(field('alarm_entity').value).toBe(''); expect(action('house-summary-save').disabled).toBe(true);
    expect(edit.panel.querySelectorAll('[data-house-summary-person]')).toHaveLength(0);
    expect(card._commit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it.each([undefined, 'legacy', 'House'])('omits the House tab unless the exact house layout is enabled (%s)', (layout_style) => {
    const { edit, action } = setup({ config: { layout_style } }); expect(action('tab', '[data-id="house"]')).toBeNull();
    expect(edit.panel.querySelector('[data-house-summary-editor]')).toBeNull();
  });
  it('uses layout before YAML and saves exact choices once as one undoable change', () => {
    const original = saved(), yaml = saved({ title: 'YAML' }), { card, house, change, click, field, action } = setup({
      layout: { house_summary: original }, config: { house_summary: yaml } }); house();
    expect(field('title').value).toBe('Our home'); change('title', 'Taylor’s home'); change('weather_entity', 'weather.second', 'change');
    change('new-person', 'person.second', 'change'); click('house-summary-add-person');
    expect(card._layout.house_summary).toEqual(original); expect(card._commit).not.toHaveBeenCalled();
    click('house-summary-save'); click('house-summary-save');
    const next = { ...original, title: 'Taylor’s home', weather_entity: 'weather.second', person_entities: ['person.taylor', 'person.second'] };
    expect(card.commitFeatureLayout).toHaveBeenCalledExactlyOnceWith({ house_summary: next }, 'House summary');
    expect(card._history.size).toBe(1); expect(action('history-undo').title).toContain('House summary');
    click('history-undo'); expect(card._layout.house_summary).toEqual(original); expect(field('title').value).toBe('Our home');
    click('history-redo'); expect(card._layout.house_summary).toEqual(next); expect(field('title').value).toBe('Taylor’s home');
    expect(card._config.house_summary).toEqual(yaml); expect(original.title).toBe('Our home');
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('inherits YAML without saving on Cancel and Undo removes the later override', () => {
    const yaml = saved(), { card, house, change, click, field } = setup({ config: { house_summary: yaml } }); house();
    change('title', 'Draft'); click('house-summary-cancel'); expect(field('title').value).toBe('Our home');
    expect(card._layout.house_summary).toBeUndefined(); change('title', 'Saved'); click('house-summary-save');
    click('history-undo'); expect(card._layout.house_summary).toBeUndefined(); expect(field('title').value).toBe('Our home');
    expect(card._config.house_summary).toEqual(yaml);
  });
  it('keeps a typed title and its actual focused node through state, rebuild and view updates', () => {
    const { card, edit, house, change, field, action } = setup({ layout: { house_summary: saved() } }); house();
    const input = change('title', 'Still typing…'); card._hass.states['weather.local'].state = 'rainy';
    edit.onStates(); edit.afterUpdate(); card._floor = 'first'; edit.onViewChanged();
    expect(field('title')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('Still typing…');
    expect(action('house-summary-save').disabled).toBe(false); expect(card._commit).not.toHaveBeenCalled();
  });
  it('updates missing-source diagnostics and preserves a focused native select without guessed repair', () => {
    const raw = saved(), { card, edit, house, field, change, action, click } = setup({ layout: { house_summary: raw } }); house();
    change('title', 'Changed'); const select = field('weather_entity'); select.focus(); delete card._hass.states['weather.local'];
    edit.onStates(); edit.afterUpdate(); expect(field('weather_entity')).toBe(select); expect(document.activeElement).toBe(select);
    expect(select.value).toBe('weather.local'); expect(edit.panel.textContent).toContain('No current entity state');
    expect(action('house-summary-save').disabled).toBe(false); click('house-summary-save');
    expect(card._layout.house_summary.weather_entity).toBe('weather.local'); expect(raw.title).toBe('Our home');
  });
  it('keeps a focused action node stable through an unrelated HA update', () => {
    const { card, edit, house, change, action } = setup({ layout: { house_summary: saved() } }); house(); change('title', 'Draft');
    const button = action('house-summary-cancel'); button.focus(); card._hass.states['person.taylor'].state = 'not_home'; edit.onStates(); edit.afterUpdate();
    expect(action('house-summary-cancel')).toBe(button); expect(document.activeElement).toBe(button); expect(card._commit).not.toHaveBeenCalled();
  });
  it('honours the actual Settings availability seam, latching observed denial until Cancel', () => {
    const { card, edit, house, change, field, action, click } = setup({ layout: { house_summary: saved() } }); house();
    const input = change('title', 'Draft'); card.houseSummaryEditorAvailable.mockReturnValue(false); edit.onStates();
    expect(field('title')).toBe(input); expect(input.disabled).toBe(true); expect(action('house-summary-save').disabled).toBe(true);
    card.houseSummaryEditorAvailable.mockReturnValue(true); edit.onStates(); edit.afterUpdate();
    expect(input.value).toBe('Draft'); expect(action('house-summary-save').disabled).toBe(true); click('house-summary-save');
    expect(card._commit).not.toHaveBeenCalled(); click('house-summary-cancel'); change('title', 'Fresh'); click('house-summary-save');
    expect(card._layout.house_summary.title).toBe('Fresh'); expect(card._commit).toHaveBeenCalledOnce();
  });
  it('keeps the exact focused person row and selected ID through ordinary entity-name updates', () => {
    const { card, edit, house, field } = setup({ layout: { house_summary: saved() } }); house();
    const person = field('person'); person.focus(); card._hass.states['person.taylor'].attributes.friendly_name = 'Updated name';
    edit.onStates(); edit.afterUpdate(); expect(field('person')).toBe(person); expect(document.activeElement).toBe(person);
    expect(person.value).toBe('person.taylor'); expect(person.selectedOptions[0].textContent).toContain('Updated name');
    expect(card._commit).not.toHaveBeenCalled();
  });
  it.each(['connection', 'admin', 'active', 'user', 'model', 'source', 'floor', 'settings'])('keeps but blocks a dirty draft after observed %s context change until Cancel', (kind) => {
    const { card, edit, house, change, action, field, click } = setup({ layout: { house_summary: saved(), model: { name: 'original.glb' } } }); house();
    const input = change('title', 'Typed draft');
    if (kind === 'connection') card._hass.connection.connected = false;
    if (kind === 'admin') card._hass.user.is_admin = false;
    if (kind === 'active') card._hass.user.is_active = false;
    if (kind === 'user') card._hass.user.id = 'other';
    if (kind === 'model') card._view.model = { root: {} };
    if (kind === 'source') card._layout.model = { name: 'replacement.glb' };
    if (kind === 'floor') card._floors[0].elevation = 1;
    if (kind === 'settings') card._layout.house_summary = saved({ title: 'Elsewhere' });
    edit.onStates(); edit.afterUpdate(); expect(field('title')).toBe(input); expect(input.value).toBe('Typed draft');
    expect(action('house-summary-save').disabled).toBe(true);
    card._hass.connection.connected = true; card._hass.user.is_admin = card._hass.user.is_active = true;
    edit.onStates(); expect(action('house-summary-save').disabled).toBe(true); click('house-summary-save'); expect(card._commit).not.toHaveBeenCalled();
    click('house-summary-cancel'); expect(field('title').value).toBe(kind === 'settings' ? 'Elsewhere' : 'Our home');
    expect(field('title').disabled).toBe(false);
  });
  it.each(['pointer', 'keyboard'])('rejects a held %s Save through session loss/recovery; fresh intent still works after Cancel', (gesture) => {
    const { card, edit, house, change, click, action } = setup({ layout: { house_summary: saved() } }); house(); change('title', 'Draft');
    const button = action('house-summary-save'); button.focus();
    button.dispatchEvent(gesture === 'pointer' ? new MouseEvent('pointerdown', { bubbles: true, button: 0 }) : new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    card._hass.connection.connected = false; edit.onStates(); card._hass.connection.connected = true; edit.onStates(); edit.afterUpdate();
    expect(action('house-summary-save')).toBe(button);
    button.dispatchEvent(gesture === 'pointer' ? new MouseEvent('pointerup', { bubbles: true, button: 0 }) : new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    button.click(); expect(card._commit).not.toHaveBeenCalled(); click('house-summary-cancel'); change('title', 'Fresh'); click('house-summary-save');
    expect(card._commit).toHaveBeenCalledOnce(); expect(card._layout.house_summary.title).toBe('Fresh');
  });
  it('retains malformed imported fields and extras until deliberate repair, rather than accepting an unrelated title edit', () => {
    const raw = { title: null, person_entities: 'person.taylor', weather_entity: false, future: { keep: '<raw>' } };
    const { card, house, change, action, click, field } = setup({ layout: { house_summary: raw } }); house(); change('title', 'Valid title');
    expect(action('house-summary-save').disabled).toBe(true); click('house-summary-cancel'); expect(card._layout.house_summary).toEqual(raw);
    change('title', 'Valid title'); change('weather_entity', '', 'change'); click('house-summary-clear-people'); click('house-summary-save');
    expect(card._layout.house_summary).toEqual({ title: 'Valid title', person_entities: [], future: { keep: '<raw>' } });
    expect(field('title').value).toBe('Valid title'); expect(card._commit).toHaveBeenCalledOnce();
  });
  it('clears old plan tools and cancels a held marker drag, then ignores canvas/device/old handles in House', () => {
    const { card, edit, house } = setup({ layout: { rooms: [{ id: 'lounge', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }] } });
    edit.drawing = { points: [[0, 0]], floorId: 'ground' }; edit.calibrating = { src: [1, 1] }; edit.colorPick = edit.doorMode = edit.overlayMove = true;
    edit.selectedRoom = 'lounge'; edit.selectedMarker = 'device:lamp';
    edit.drag = { kind: 'marker', id: 'device:lamp', moved: true, pos: { x: 2, y: 2, z: 1, floorId: 'ground' } }; house();
    expect(edit.drawing || edit.calibrating || edit.doorMode || edit.colorPick || edit.overlayMove || edit.selectedRoom || edit.selectedMarker || edit.drag).toBeFalsy();
    card._positions.set('device:lamp', { x: 1, y: 1, z: 1, floorId: 'ground' });
    const event = { button: 0, clientX: 10, clientY: 10, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    edit._dragEnd(event); edit.canvasDown(event); edit.canvasUp(event); edit.markerDown({ id: 'device:lamp' }, event);
    edit._vertexDown(event, 'lounge', 0); edit._midDown(event, 'lounge', 0);
    expect(edit.tab).toBe('house'); expect(edit.drag).toBeNull(); expect(card._layout.pins).toEqual({});
    expect(card._view.planPoint).not.toHaveBeenCalled(); expect(card._commit).not.toHaveBeenCalled();
  });
  it('discards draft on tab leave, context reset and detach, reuses on reattach and disposes only at teardown', () => {
    const { card, edit, house, change, click, field } = setup({ layout: { house_summary: saved() } }); house(); change('title', 'Draft');
    click('tab', '[data-id="rooms"]'); expect(edit._houseSummaryEditor.draft).toBeNull(); house(); expect(field('title').value).toBe('Our home');
    change('title', 'Other draft'); edit.cancelHistoryGestures(); expect(edit._houseSummaryEditor.draft).toBeNull(); edit.render();
    change('title', 'Detached draft'); edit.detach(); expect(edit._houseSummaryEditor.draft).toBeNull(); expect(edit._houseSummaryEditor.disposed).toBe(false);
    edit.attach(); edit.render(); expect(field('title').value).toBe('Our home'); change('title', 'Saved'); click('house-summary-save'); expect(card._commit).toHaveBeenCalledOnce();
    edit.dispose(); expect(edit._houseSummaryEditor.disposed).toBe(true); expect(edit._houseSummaryEditor.render()).toBe('');
  });
  it('resets an open House draft and returns to Rooms when the layout style is replaced', () => {
    const { card, edit, house, change, action } = setup({ layout: { house_summary: saved() } }); house(); change('title', 'Draft');
    card._config.layout_style = 'legacy'; edit.afterUpdate();
    expect(edit.tab).toBe('rooms'); expect(action('tab', '[data-id="house"]')).toBeNull(); expect(edit._houseSummaryEditor.draft).toBeNull();
    expect(card._commit).not.toHaveBeenCalled();
  });
});
