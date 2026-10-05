// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomActionsEditor } from '../src/room-actions-editor.js';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';
import { inspectSourceValue } from '../src/imported-source-controls.js';

const scene = (entity, name = entity) => ({ entity_id: entity, state: 'unknown', attributes: { friendly_name: name } });
const shortcut = (id = 'evening', entity = 'scene.evening', extra = {}) => ({ id, entity, label: 'Evening', ...extra });
const saved = (actions = [shortcut()], extra = {}) => ({ version: 1, rooms: [{ room_id: 'model:kitchen', actions, roomExtra: { keep: 1 } }], future: ['keep'], ...extra });
const fixtures = [];
function setup({ settings, config = {}, model = true } = {}) {
  const card = document.createElement('div'), host = document.createElement('div'); host.attachShadow({ mode: 'open' }).append(card); document.body.append(host);
  const room = { id: 'model:kitchen', area_id: 'kitchen', floor_id: 'g', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] };
  Object.assign(card, { _stage: card, _config: { layout_key: 'exact', ...config }, _layout: { rooms: [], floors: [], pins: {}, hidden: [], ...(settings !== undefined ? { room_actions: settings } : {}) },
    _roomList: [{ room, floorId: 'g', name: 'Kitchen' }, { room: { ...room, id: 'drawn:kitchen', floor_id: 'u' }, floorId: 'u', name: 'Kitchen' }],
    _floors: [{ id: 'g', name: 'Ground', elevation: 0 }, { id: 'u', name: 'Upper', elevation: 3 }], _editing: true, _loading: false,
    _hass: { user: { id: 'admin', is_admin: true, is_active: true }, connection: { connected: true }, auth: {},
      states: { 'scene.evening': scene('scene.evening', 'Evening scene'), 'scene.second': scene('scene.second', 'Second scene'),
        'script.cleanup': { entity_id: 'script.cleanup', state: 'off', attributes: { friendly_name: 'Cleanup' } }, 'light.fake': { state: 'on', attributes: {} } },
      entities: {}, devices: {}, areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen', floor_id: 'g' } }, floors: {}, services: { scene: { turn_on: {} }, script: { turn_on: {} } }, callService: vi.fn(), callWS: vi.fn() },
    _view: { model: model ? { root: { uuid: 'model-one' } } : null, setOverlay: vi.fn(), setControlsEnabled: vi.fn(), setStems: vi.fn() },
    _built: {}, _store: { backend: 'browser' }, _markers: [], _positions: new Map(), _applyMarkerSelection: vi.fn(), _history: new EditHistory(), modelBindings: () => null });
  const snapshot = () => ({ layout: card._layout, config: card._config });
  card._history.reset(inspectSourceValue(settings).readable ? snapshot() : { ...snapshot(), layout: { ...card._layout, room_actions: undefined } });
  card._commit = vi.fn((layout) => { card._layout = layout; card._history.record(snapshot(), 'Room shortcuts'); });
  const edit = new EditMode(card); card._edit = edit; edit.refreshOverlay = vi.fn(); card.append(edit.panel); edit.render();
  card.undoEdit = () => { card._layout = card._history.undo().layout; edit._roomActionsEditor.reset(); edit.render(); };
  card.redoEdit = () => { card._layout = card._history.redo().layout; edit._roomActionsEditor.reset(); edit.render(); };
  const field = (name, index) => edit.panel.querySelector(`[data-field="room-actions-${name}"]${index === undefined ? '' : `[data-ra-index="${index}"]`}`);
  const button = (name, index) => edit.panel.querySelector(`[data-act="room-actions-${name}"]${index === undefined ? '' : `[data-ra-index="${index}"]`}`);
  const change = (name, value, index, type = 'change') => { const node = field(name, index); expect(node).toBeTruthy(); node.value = value; node.dispatchEvent(new Event(type, { bubbles: true })); return node; };
  const click = (name, index) => { const node = button(name, index); expect(node).toBeTruthy(); node.click(); };
  const choose = (id = 'model:kitchen') => change('room', id);
  fixtures.push({ edit, host }); return { card, edit, editor: edit._roomActionsEditor, host, field, button, change, click, choose };
}
const pointer = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));
const key = (node, type, value) => node.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true }));
afterEach(() => { fixtures.splice(0).forEach(({ edit, host }) => { edit.dispose(); host.remove(); }); vi.restoreAllMocks(); });

describe('actual Rooms tab shortcut drafts', () => {
  it.each([true, false])('shows the editor for model=%s without choosing a room or running a source', (model) => {
    const { card, editor, field, button } = setup({ model }); expect(editor).toBeInstanceOf(RoomActionsEditor);
    expect(field('room').value).toBe(''); expect(button('save').disabled).toBe(true);
    expect([...field('room').options].map((option) => option.value)).toContain('model:kitchen');
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('saves the explicitly selected exact room/source once, with one Undo/Redo step and no commands', () => {
    const { card, choose, change, click, edit } = setup(); choose('drawn:kitchen'); change('new-source', 'script.cleanup'); click('add');
    change('label', 'Run cleanup', 0, 'input'); expect(card._layout.room_actions).toBeUndefined(); click('save'); click('save');
    expect(card._commit).toHaveBeenCalledOnce(); expect(card._layout.room_actions.rooms).toEqual([{ room_id: 'drawn:kitchen', actions: [expect.objectContaining({ entity: 'script.cleanup', label: 'Run cleanup' })] }]);
    expect(card._history.size).toBe(1); edit._runHistory('undo'); expect(card._layout.room_actions).toBeUndefined();
    edit._runHistory('redo'); expect(card._layout.room_actions.rooms[0].room_id).toBe('drawn:kitchen');
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('preserves envelope/room/action extensions and exact order, with Cancel leaving everything untouched', () => {
    const raw = saved([shortcut('a', 'scene.evening', { vendor: { keep: true } }), shortcut('b', 'script.cleanup')]);
    const before = structuredClone(raw), { card, choose, change, click } = setup({ settings: raw }); choose(); change('label', 'Draft', 0, 'input'); click('down', 0); click('remove', 0); click('cancel');
    expect(card._layout.room_actions).toEqual(before); expect(card._commit).not.toHaveBeenCalled();
    choose(); click('down', 0); change('label', 'Kept', 1, 'input'); click('save');
    expect(card._layout.room_actions).toEqual({ ...before, rooms: [{ ...before.rooms[0], actions: [before.rooms[0].actions[1], { ...before.rooms[0].actions[0], label: 'Kept' }] }] });
  });
  it('inherits YAML, stores a deliberate layout override and preserves unrelated saved room data', () => {
    const yaml = saved([], { rooms: [{ room_id: 'removed:exact', actions: [shortcut()], extras: 8 }] });
    const { card, choose, change, click, field } = setup({ config: { room_actions: yaml } });
    expect([...field('room').options].find((option) => option.value === 'removed:exact').disabled).toBe(false);
    choose(); change('new-source', 'scene.second'); click('add'); click('save');
    expect(card._config.room_actions).toEqual(yaml); expect(card._layout.room_actions.rooms[0]).toEqual(yaml.rooms[0]); expect(card._layout.room_actions.rooms[1].room_id).toBe('model:kitchen');
  });
  it('retains missing sources with warnings and changes a source only after an explicit current selection', () => {
    const { card, choose, field, change, click } = setup({ settings: saved([shortcut('old', 'scene.deleted')]) }); choose();
    expect(field('source', 0).value).toBe('scene.deleted'); expect(field('source', 0).selectedOptions[0].disabled).toBe(true);
    change('label', 'Repair later', 0, 'input'); click('save'); expect(card._layout.room_actions.rooms[0].actions[0].entity).toBe('scene.deleted');
    choose(); change('source', 'scene.second', 0); click('save'); expect(card._layout.room_actions.rooms[0].actions[0].entity).toBe('scene.second');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each([false, { version: 2, rooms: [], future: 'kept' }, { version: 1, rooms: 'bad' }])('keeps malformed/unsupported settings %j until deliberate known replacement', (raw) => {
    const { card, choose, change, click, button } = setup({ settings: raw }); choose(); expect(button('add').disabled).toBe(true); expect(button('save').disabled).toBe(true);
    click('replace-settings'); choose(); change('new-source', 'scene.evening'); click('add'); expect(card._layout.room_actions).toEqual(raw); click('save');
    expect(card._layout.room_actions.version).toBe(1); expect(card._layout.room_actions.rooms[0].room_id).toBe('model:kitchen');
    if (raw.future) expect(card._layout.room_actions.future).toBe('kept');
  });
  it('keeps an explicitly saved null policy authoritative over a valid card override until deliberate replacement', () => {
    const yaml = saved(), { card, editor, choose, button, click, change } = setup({ settings: null, config: { room_actions: yaml } }); choose();
    expect(editor.effective).toBeNull(); expect(editor.draft).toBeNull(); expect(button('add').disabled).toBe(true); expect(button('save').disabled).toBe(true);
    expect(card._layout.room_actions).toBeNull(); click('replace-settings'); choose(); change('new-source', 'script.cleanup'); click('add'); click('save');
    expect(card._layout.room_actions.rooms[0].actions[0].entity).toBe('script.cleanup'); expect(card._config.room_actions).toEqual(yaml);
  });
  it('keeps an own undefined shared policy distinct from falling back to card settings', () => {
    const { card, editor, edit, choose } = setup({ config: { room_actions: saved() } });
    card._layout.room_actions = undefined; editor.observe(); editor.updatePreviews(edit.panel); choose();
    expect(editor.effective).toBeUndefined(); expect(editor._actions()).toEqual([]); expect(card._commit).not.toHaveBeenCalled();
  });
  it('does not invoke imported getters or allow a partial destructive replacement', () => {
    const getter = vi.fn(() => []), raw = { version: 1 }; Object.defineProperty(raw, 'rooms', { enumerable: true, get: getter });
    const { choose, button, click, card } = setup({ settings: raw }); choose(); expect(button('replace-settings').disabled).toBe(true); click('replace-settings');
    expect(getter).not.toHaveBeenCalled(); expect(card._commit).not.toHaveBeenCalled();
  });
  it('does not invoke a saved-settings accessor or an imported serialization hook', () => {
    const { card, editor, button } = setup(); const getter = vi.fn(() => saved());
    Object.defineProperty(card._layout, 'room_actions', { enumerable: true, configurable: true, get: getter }); editor.observe(); editor.updatePreviews(card._edit.panel);
    expect(getter).not.toHaveBeenCalled(); expect(button('replace-settings').disabled).toBe(true);
    delete card._layout.room_actions; const hook = vi.fn(); card._layout.room_actions = { version: 1, rooms: [], toJSON: hook };
    editor.observe(); editor.updatePreviews(card._edit.panel); expect(hook).not.toHaveBeenCalled(); expect(button('replace-settings').disabled).toBe(true);
  });
  it('requires deliberate replacement of malformed selected actions while preserving another row', () => {
    const raw = saved([{ id: 'same', entity: 'scene.evening' }, { id: 'same', entity: 'scene.second' }]); raw.rooms.push({ room_id: 'drawn:kitchen', actions: [shortcut()], unknown: true });
    const { card, choose, button, click, change } = setup({ settings: raw }); choose(); expect(button('save').disabled).toBe(true); expect(button('add').disabled).toBe(true);
    click('replace-actions'); change('new-source', 'script.cleanup'); click('add'); click('save');
    expect(card._layout.room_actions.rooms[1]).toEqual(raw.rooms[1]); expect(card._layout.room_actions.rooms[0].roomExtra).toEqual({ keep: 1 });
  });
  it('offers only current eligible scenes/scripts and refuses forged or restored sources', () => {
    const { card, choose, field, change, editor } = setup(); card._hass.states['scene.restored'] = scene('scene.restored'); card._hass.states['scene.restored'].attributes.restored = true;
    card._hass.entities['scene.second'] = { hidden: true }; choose();
    expect([...field('new-source').options].map((option) => option.value)).toEqual(['', 'script.cleanup', 'scene.evening']);
    const fake = document.createElement('select'); fake.innerHTML = '<option value="light.fake" selected>Fake</option>'; editor.onChange('room-actions-new-source', fake);
    expect(editor.newSource).toBe(''); change('new-source', 'scene.evening'); expect(editor.newSource).toBe('scene.evening');
  });
  it('bounds labels and additions to 12 rather than truncating or silently losing settings', () => {
    const raw = saved(Array.from({ length: 12 }, (_, index) => shortcut(`a${index}`))), { card, choose, button, change, click } = setup({ settings: raw }); choose();
    expect(button('add').disabled).toBe(true); change('label', 'x'.repeat(161), 0, 'input'); expect(button('save').disabled).toBe(true); click('save'); expect(card._commit).not.toHaveBeenCalled();
    change('label', 'Valid', 0, 'input'); click('remove', 11); click('save'); expect(card._layout.room_actions.rooms[0].actions).toHaveLength(11);
  });
  it('keeps separate exact room drafts together and saves both in one history step', () => {
    const { card, choose, change, click } = setup(); choose(); change('new-source', 'scene.evening'); click('add');
    choose('drawn:kitchen'); change('new-source', 'script.cleanup'); click('add'); click('save');
    expect(card._history.size).toBe(1); expect(card._layout.room_actions.rooms.map((row) => [row.room_id, row.actions[0].entity]))
      .toEqual([['model:kitchen', 'scene.evening'], ['drawn:kitchen', 'script.cleanup']]);
  });
});

describe('native room shortcut Save context', () => {
  const changes = [
    ['admin', (card) => { card._hass.user.is_admin = false; }, (card) => { card._hass.user.is_admin = true; }],
    ['connection', (card) => { card._hass.connection.connected = false; }, (card) => { card._hass.connection.connected = true; }],
    ['active user', (card) => { card._hass.user.is_active = false; }, (card) => { card._hass.user.is_active = true; }],
    ['auth', (card) => { card._hass.auth = {}; }],
    ['source', (card) => { delete card._hass.states['scene.evening']; }, (card) => { card._hass.states['scene.evening'] = scene('scene.evening'); }],
    ['service', (card) => { delete card._hass.services.scene.turn_on; }, (card) => { card._hass.services.scene.turn_on = {}; }],
    ['room', (card) => { card._roomList.splice(0, 1); }],
    ['floor', (card) => { card._floors[0].stale = true; }, (card) => { card._floors[0].stale = false; }],
    ['layout key', (card) => { card._config.layout_key = 'another'; }],
    ['saved settings', (card) => { card._layout.room_actions = saved([shortcut('other')]); }],
    ['generation', (card) => { card._edit._generation++; }],
  ];
  it.each(changes)('keeps a draft but fences observed %s loss/recovery and the held Save', (_name, lose, recover) => {
    const { card, editor, choose, change, button } = setup({ settings: saved() }); choose(); change('label', 'Draft survives', 0, 'input'); const save = button('save'); pointer(save, 'pointerdown');
    lose(card); editor.observe(); if (recover) { recover(card); editor.observe(); } pointer(save, 'pointerup'); save.click();
    expect(card._commit).not.toHaveBeenCalled(); expect(editor.stale).toBe(true); expect(editor.draft.rooms[0].actions[0].label).toBe('Draft survives');
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it.each(['Enter', ' '])('fences held %s Save across role recovery, then permits a fresh deliberate draft', (value) => {
    const { card, editor, choose, change, button, click } = setup({ settings: saved() }); choose(); change('label', 'Old draft', 0, 'input'); const old = button('save'); key(old, 'keydown', value);
    card._hass.user.is_admin = false; editor.observe(); card._hass.user.is_admin = true; editor.observe(); key(old, 'keyup', value); expect(card._commit).not.toHaveBeenCalled();
    click('cancel'); choose(); change('label', 'New draft', 0, 'input'); const fresh = button('save'); key(fresh, 'keydown', value); expect(card._commit).not.toHaveBeenCalled(); key(fresh, 'keyup', value); expect(card._commit).toHaveBeenCalledOnce();
  });
  it('requires a fresh explicit source choice after a held Add loses and recovers its source', () => {
    const { card, editor, edit, choose, change, button, click } = setup(); choose(); change('new-source', 'scene.evening'); const old = button('add'); pointer(old, 'pointerdown');
    delete card._hass.states['scene.evening']; editor.observe(); card._hass.states['scene.evening'] = scene('scene.evening'); editor.observe();
    pointer(old, 'pointerup'); old.click(); expect(editor._actions()).toEqual([]); expect(card._commit).not.toHaveBeenCalled();
    edit.onStates(); change('new-source', 'scene.evening'); click('add'); click('save'); expect(card._layout.room_actions.rooms[0].actions[0].entity).toBe('scene.evening');
  });
  it('refreshes language/source names in place, preserving the focused typed label and held Save', () => {
    const { card, edit, choose, change, field, button } = setup({ settings: saved() }); choose(); const input = change('label', 'Still typing', 0, 'input'); input.focus();
    const save = button('save'), text = save.textContent; card._hass.locale = { language: 'de' }; card._hass.states['scene.evening'].attributes.friendly_name = 'Renamed actual scene'; edit.onStates(); edit.afterUpdate();
    expect(field('label', 0)).toBe(input); expect(card.getRootNode().activeElement).toBe(input); expect(input.value).toBe('Still typing'); expect(button('save').textContent).not.toBe(text);
    pointer(save, 'pointerdown'); card._hass.locale.language = 'fr'; edit.onStates(); pointer(save, 'pointerup'); save.click(); expect(card._commit).toHaveBeenCalledOnce();
    expect(card._layout.room_actions.rooms[0].actions[0].label).toBe('Still typing');
  });
  it('observes inactive-editor ownership losses without redrawing another tab or consuming its fields', () => {
    const { card, edit, editor, choose, change } = setup({ settings: saved() }); choose(); change('label', 'Kept draft', 0, 'input');
    const render = vi.spyOn(edit, 'render'); edit.tab = 'mower'; card._hass.connection.connected = false; editor.observe();
    card._hass.connection.connected = true; editor.observe(); editor.updatePreviews(edit.panel);
    expect(editor.stale).toBe(true); expect(render).not.toHaveBeenCalled();
    const field = document.createElement('input'); field.value = 'Unrelated';
    for (const name of ['ov-opacity', 'screen-name', 'mower-img-min-pixels']) {
      expect(editor.onInput(name, field)).toBe(false); expect(editor.onChange(name, field)).toBe(false);
    }
    expect(card._commit).not.toHaveBeenCalled(); expect(editor.draft.rooms[0].actions[0].label).toBe('Kept draft');
    edit.tab = 'rooms';
  });
});

describe('deliberate saved-room removal', () => {
  const missing = (id = 'removed:exact', actions = [shortcut('old', 'scene.deleted')]) => ({ room_id: id, actions, extra: { retainedUntilRemoval: true } });
  it('allows read-only review and exact deletion of a missing saved room, without needing its scene', () => {
    const obsolete = missing(), raw = saved([], { rooms: [obsolete, ...saved().rooms] }), before = structuredClone(raw);
    const { card, editor, choose, field, button, click } = setup({ settings: raw });
    expect([...field('room').options].find((option) => option.value === obsolete.room_id).disabled).toBe(false); choose(obsolete.room_id);
    expect(field('source', 0).disabled).toBe(true); expect(field('label', 0).disabled).toBe(true); expect(button('add').disabled).toBe(true);
    expect(button('remove-room').disabled).toBe(false); click('remove-room');
    expect(card._layout.room_actions).toEqual(before); expect(editor.draft.rooms).toEqual([before.rooms[1]]);
    expect(field('room').value).toBe(obsolete.room_id); expect(field('room').selectedOptions[0].textContent).toContain('removal');
    expect(button('save').disabled).toBe(false); click('save'); click('save');
    expect(card._commit).toHaveBeenCalledOnce(); expect(card._layout.room_actions).toEqual({ ...before, rooms: [before.rooms[1]] });
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('keeps empty-row extras until explicit whole-row removal and restores every byte of saved data with Undo/Redo', () => {
    const raw = saved(), before = structuredClone(raw), { card, edit, choose, click, button } = setup({ settings: raw });
    choose(); click('remove', 0); click('save');
    expect(card._layout.room_actions.rooms[0]).toEqual({ ...before.rooms[0], actions: [] }); expect(card._history.size).toBe(1);
    choose(); expect(button('remove-room').disabled).toBe(false); click('remove-room'); click('cancel');
    expect(card._layout.room_actions.rooms[0]).toEqual({ ...before.rooms[0], actions: [] }); expect(card._history.size).toBe(1);
    choose(); click('remove-room'); click('save'); expect(card._layout.room_actions).toEqual({ ...before, rooms: [] }); expect(card._history.size).toBe(2);
    edit._runHistory('undo'); expect(card._layout.room_actions.rooms[0]).toEqual({ ...before.rooms[0], actions: [] });
    edit._runHistory('redo'); expect(card._layout.room_actions).toEqual({ ...before, rooms: [] }); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('recovers the 128-room capacity by removing only the explicitly chosen obsolete row', () => {
    const rows = Array.from({ length: 128 }, (_, index) => missing(`old:${index}`, [])), raw = saved([], { rooms: rows });
    const { card, editor, choose, change, button, click, edit } = setup({ settings: raw });
    choose(); change('new-source', 'scene.evening'); expect(button('add').disabled).toBe(true);
    choose('old:73'); click('remove-room'); expect(editor.draft.rooms).toEqual(rows.filter((row) => row.room_id !== 'old:73'));
    choose(); change('new-source', 'script.cleanup'); expect(button('add').disabled).toBe(false); click('add'); click('save');
    expect(card._history.size).toBe(1); expect(card._layout.room_actions.rooms).toHaveLength(128);
    expect(card._layout.room_actions.rooms.slice(0, 127)).toEqual(rows.filter((row) => row.room_id !== 'old:73'));
    expect(card._layout.room_actions.rooms[127].room_id).toBe('model:kitchen');
    edit._runHistory('undo'); expect(card._layout.room_actions).toEqual(raw); edit._runHistory('redo'); expect(card._layout.room_actions.rooms).toHaveLength(128);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('removes a saved row with a stale floor or malformed actions without replacing an unrelated row', () => {
    const raw = saved([{ id: 'duplicate', entity: 'scene.deleted' }, { id: 'duplicate', entity: 'scene.deleted' }]); raw.rooms.push(missing());
    const { card, editor, edit, choose, field, button, click } = setup({ settings: raw });
    card._floors[0].stale = true; editor.observe(); editor.updatePreviews(edit.panel); choose();
    expect(field('new-source').disabled).toBe(true); expect(button('remove-room').disabled).toBe(false); click('remove-room'); click('save');
    expect(card._layout.room_actions).toEqual({ ...raw, rooms: [raw.rooms[1]] }); expect(card._commit).toHaveBeenCalledOnce();
  });
  it('keeps inherited card settings unchanged on Cancel and saves only the explicit removal as a shared override', () => {
    const yaml = saved([], { rooms: [missing()] }), { card, choose, click, edit } = setup({ config: { room_actions: yaml } });
    choose('removed:exact'); click('remove-room'); click('cancel'); expect(card._layout.room_actions).toBeUndefined(); expect(card._config.room_actions).toEqual(yaml);
    choose('removed:exact'); click('remove-room'); click('save'); expect(card._layout.room_actions).toEqual({ ...yaml, rooms: [] }); expect(card._config.room_actions).toEqual(yaml);
    edit._runHistory('undo'); expect(card._layout.room_actions).toBeUndefined(); expect(card._config.room_actions).toEqual(yaml); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('does not allow guessed rows, unknown envelopes or unreadable data to enter whole-row removal', () => {
    const { card, choose, button, click } = setup({ settings: { version: 2, rooms: [missing()], future: true } }); choose();
    expect(button('remove-room').disabled).toBe(true); click('remove-room'); expect(card._commit).not.toHaveBeenCalled();
    const clean = setup(); clean.choose(); expect(clean.button('remove-room').disabled).toBe(true); clean.click('remove-room'); expect(clean.editor.dirty).toBe(false);
    const getter = vi.fn(() => [missing()]), unreadable = { version: 1 }; Object.defineProperty(unreadable, 'rooms', { enumerable: true, get: getter });
    const blocked = setup({ settings: unreadable }); blocked.choose(); expect(blocked.button('remove-room').disabled).toBe(true); blocked.click('remove-room'); expect(getter).not.toHaveBeenCalled();
  });
  it('updates translated removal captions in place while retaining the focused exact missing-room choice and fresh gesture', () => {
    const raw = saved([], { rooms: [missing()] }), { card, edit, choose, field, button, click } = setup({ settings: raw }); choose('removed:exact');
    const chooser = field('room'); chooser.focus(); card._hass.locale = { language: 'de' }; edit.onStates();
    expect(field('room')).toBe(chooser); expect(card.getRootNode().activeElement).toBe(chooser); expect(chooser.value).toBe('removed:exact');
    const remove = button('remove-room'); expect(remove.textContent).toBe('Diesen gespeicherten Raum entfernen'); remove.focus(); pointer(remove, 'pointerdown');
    card._hass.locale.language = 'fr'; edit.onStates(); expect(button('remove-room')).toBe(remove); expect(card.getRootNode().activeElement).toBe(remove);
    expect(remove.textContent).toBe('Supprimer cette pièce enregistrée'); pointer(remove, 'pointerup'); remove.click();
    expect(field('room').selectedOptions[0].textContent).toBe('Suppression prévue : removed:exact'); click('save');
    expect(card._layout.room_actions.rooms).toEqual([]); expect(card._commit).toHaveBeenCalledOnce(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['pointer', 'Enter', ' '])('poisons held %s removal across role loss and recovery, then allows a fresh explicit choice', (gesture) => {
    const raw = saved([], { rooms: [missing()] }), { card, editor, edit, choose, button, click } = setup({ settings: raw }); choose('removed:exact');
    const old = button('remove-room'); if (gesture === 'pointer') pointer(old, 'pointerdown'); else key(old, 'keydown', gesture);
    card._hass.user.is_admin = false; editor.observe(); card._hass.user.is_admin = true; editor.observe();
    if (gesture === 'pointer') { pointer(old, 'pointerup'); old.click(); } else key(old, 'keyup', gesture);
    expect(editor.draft).toEqual(raw); expect(card._commit).not.toHaveBeenCalled();
    edit.onStates(); click('cancel'); choose('removed:exact'); const fresh = button('remove-room');
    if (gesture === 'pointer') { pointer(fresh, 'pointerdown'); pointer(fresh, 'pointerup'); fresh.click(); } else { key(fresh, 'keydown', gesture); key(fresh, 'keyup', gesture); }
    click('save'); expect(card._layout.room_actions.rooms).toEqual([]); expect(card._commit).toHaveBeenCalledOnce();
  });
  it.each([
    ['connection', (card) => { card._hass.connection.connected = false; }, (card) => { card._hass.connection.connected = true; }],
    ['source', (card) => { delete card._hass.states['scene.evening']; }, (card) => { card._hass.states['scene.evening'] = scene('scene.evening'); }],
    ['floor', (card) => { card._floors[0].stale = true; }, (card) => { card._floors[0].stale = false; }],
    ['layout', (card) => { card._config.layout_key = 'changed'; }],
    ['room', (card) => { card._roomList.splice(0, 1); }],
  ])('retains an unsaved removal but prevents held Save after observed %s loss', (_name, lose, recover) => {
    const raw = saved(), { card, editor, choose, click, button } = setup({ settings: raw }); choose(); click('remove-room');
    const save = button('save'); pointer(save, 'pointerdown'); lose(card); editor.observe(); if (recover) { recover(card); editor.observe(); } pointer(save, 'pointerup'); save.click();
    expect(editor.stale).toBe(true); expect(editor.draft.rooms).toEqual([]); expect(card._layout.room_actions).toEqual(raw); expect(card._commit).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
