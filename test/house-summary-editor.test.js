// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseSummaryEditor } from '../src/house-summary-editor.js';

const editors = [];
const state = (id, value, attributes = {}) => ({ entity_id: id, state: value, attributes });
const saved = (extra = {}) => ({ title: 'My home', weather_entity: 'weather.local', alarm_entity: 'alarm_control_panel.house', person_entities: ['person.one'], ...extra });
function setup({ raw, config = {}, states, card: overrides = {} } = {}) {
  const card = { isConnected: true, _editing: true, _edit: { tab: 'settings' }, _config: { layout_key: 'house', ...config },
    _layout: { ...(raw === undefined ? {} : { house_summary: raw }), model: { url: '/api/taylors3d/model/house.glb' }, rooms: [], floors: [] },
    _floors: [{ id: 'ground', elevation: 0 }], _view: { model: { root: { uuid: 'original-root' } } },
    _modelAlign: () => ({ position: [0, 0, 0], rotation: 0, scale: 1 }),
    _hass: { user: { id: 'taylor', is_admin: true, is_active: true }, connection: { connected: true }, auth: {}, config: { location_name: 'Configured HA name' },
      states: states || { 'weather.local': state('weather.local', 'sunny', { friendly_name: 'Local weather', temperature: 18, temperature_unit: '°C' }),
        'weather.second': state('weather.second', 'cloudy', { friendly_name: 'Second weather' }),
        'person.one': state('person.one', 'home', { friendly_name: 'One' }), 'person.two': state('person.two', 'not_home', { friendly_name: 'Two' }),
        'alarm_control_panel.house': state('alarm_control_panel.house', 'disarmed', { friendly_name: 'House alarm' }),
        'sensor.motion': state('sensor.motion', 'on', { friendly_name: 'Motion', device_class: 'motion' }),
        'light.kitchen': state('light.kitchen', 'on', { friendly_name: 'Kitchen' }) }, entities: {}, devices: {},
      callService: vi.fn(), callWS: vi.fn() },
    commitFeatureLayout: vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; }), ...overrides };
  const host = document.createElement('div'); document.body.append(host);
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  const editor = new HouseSummaryEditor(card, render); editors.push(editor);
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const element = event.target.closest('[data-act]'); editor.onClick(element?.dataset.act, element); });
  render();
  const field = (name) => host.querySelector(`[data-field="house-summary-${name}"]`);
  const button = (name) => host.querySelector(`[data-act="house-summary-${name}"]`);
  const change = (name, value, type = 'input') => { const element = field(name); element.value = value; element.dispatchEvent(new Event(type, { bubbles: true })); return element; };
  const click = (name) => button(name).click();
  const person = (index) => host.querySelector(`[data-house-summary-person="${index}"] select`);
  const changePerson = (index, id) => { const element = person(index); element.value = id; element.dispatchEvent(new Event('change', { bubbles: true })); };
  const remove = (index) => host.querySelector(`[data-house-summary-person="${index}"] button`).click();
  return { card, editor, host, render, field, button, change, click, person, changePerson, remove };
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); });

describe('future house header configuration, not readings or household guesses', () => {
  it('opens blank defaults without choosing a title, weather, person or alarm and sends no requests', () => {
    const { card, editor, host, field, button, click } = setup();
    expect(editor.draft).toEqual({}); expect(field('title').value).toBe(''); expect(field('weather_entity').value).toBe('');
    expect(field('alarm_entity').value).toBe(''); expect(host.querySelectorAll('[data-house-summary-person]')).toHaveLength(0);
    expect(host.textContent).toContain('No people selected'); expect(host.textContent).toContain('Motion sensors do not name a person');
    expect(button('save').disabled).toBe(true); click('cancel'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('saves deliberate exact source choices and title once with one history label', () => {
    const { card, change, click, editor } = setup();
    change('title', 'Taylor’s home'); change('weather_entity', 'weather.local', 'change'); change('alarm_entity', 'alarm_control_panel.house', 'change');
    change('new-person', 'person.two', 'change'); expect(editor.draft.person_entities).toBeUndefined(); click('add-person');
    expect(card._layout.house_summary).toBeUndefined(); click('save'); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledExactlyOnceWith({ house_summary: { title: 'Taylor’s home', weather_entity: 'weather.local', alarm_entity: 'alarm_control_panel.house', person_entities: ['person.two'] } }, 'House summary');
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('empty explicit title/weather/alarm omits each override rather than inventing a replacement', () => {
    const { card, change, click } = setup({ raw: saved({ future: { preserve: true } }) });
    change('title', ''); change('weather_entity', '', 'change'); change('alarm_entity', '', 'change'); click('save');
    expect(card._layout.house_summary).toEqual({ person_entities: ['person.one'], future: { preserve: true } });
  });
  it('returns an initially absent title back to blank without creating an unnecessary default edit', () => {
    const { editor, change, button, click, card } = setup(); change('title', 'Draft'); change('title', '');
    expect(editor.dirty).toBe(false); expect(button('save').disabled).toBe(true); click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('uses layout before YAML and leaves both the raw import and YAML extensions unchanged', () => {
    const raw = saved({ future: { keep: ['custom', 2] } }), yaml = saved({ title: 'YAML title', yamlExtra: true });
    const before = structuredClone(raw), { card, field, change, click } = setup({ raw, config: { house_summary: yaml } });
    expect(field('title').value).toBe('My home'); change('title', 'Changed'); click('save');
    expect(raw).toEqual(before); expect(card._layout.house_summary).toEqual({ ...before, title: 'Changed' }); expect(card._config.house_summary).toEqual(yaml);
  });
  it('inherits YAML without replacing it on Cancel, then stores a deliberate layout override', () => {
    const yaml = saved({ extra: { source: 'kept' } }), { card, change, click, field } = setup({ config: { house_summary: yaml } });
    change('title', 'Temporary'); click('cancel'); expect(field('title').value).toBe('My home'); expect(card._layout.house_summary).toBeUndefined();
    change('title', 'Saved'); click('save'); expect(card._layout.house_summary).toEqual({ ...yaml, title: 'Saved' }); expect(card._config.house_summary).toEqual(yaml);
  });
  it('Cancel restores exact people order, source IDs, title and extensions without history writes', () => {
    const raw = saved({ person_entities: ['person.two', 'person.one'], future: { preserved: true } }), { card, editor, change, changePerson, remove, click } = setup({ raw });
    change('title', 'Draft'); changePerson(0, 'person.one'); remove(1); click('cancel');
    expect(editor.draft).toEqual(raw); expect(card._layout.house_summary).toEqual(raw); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('filters actual entity domains so motion, lights and similarly named sources do not become people/weather/alarm', () => {
    const { field, editor } = setup();
    expect([...field('new-person').options].map((entry) => entry.value)).toEqual(['', 'person.one', 'person.two']);
    expect([...field('weather_entity').options].map((entry) => entry.value)).toEqual(['', 'weather.local', 'weather.second']);
    expect([...field('alarm_entity').options].map((entry) => entry.value)).toEqual(['', 'alarm_control_panel.house']);
    const fake = document.createElement('select'); fake.dataset.houseSummaryEpoch = String(editor._epoch); fake.innerHTML = '<option value="sensor.motion" selected>Motion</option>';
    editor.onChange('house-summary-new-person', fake); expect(editor.newPerson).toBe('');
  });
  it('preserves missing exact IDs with warning rows and allows an unrelated valid title edit', () => {
    const raw = saved({ weather_entity: 'weather.removed', alarm_entity: 'alarm_control_panel.old', person_entities: ['person.old'], future: 7 });
    const { card, host, field, change, click } = setup({ raw }); expect(field('weather_entity').value).toBe('weather.removed');
    expect(field('weather_entity').selectedOptions[0].disabled).toBe(true); expect(host.textContent).toContain('No current entity state');
    change('title', 'Repair later'); click('save'); expect(card._layout.house_summary).toEqual({ ...raw, title: 'Repair later' });
  });
  it('relinks saved missing/filtered choices only by an explicit current picker selection', () => {
    const { card, change, changePerson, click } = setup({ raw: saved({ weather_entity: 'weather.old', person_entities: ['person.old'] }) });
    change('weather_entity', 'weather.second', 'change'); changePerson(0, 'person.two'); click('save');
    expect(card._layout.house_summary).toEqual(saved({ weather_entity: 'weather.second', person_entities: ['person.two'] }));
  });
  it.each([{ hidden: true }, { disabled_by: 'user' }, { entity_category: 'diagnostic' }])('preserves selected excluded registration %j but never offers it as a new source', (registry) => {
    const { card, render, field, host } = setup({ raw: saved() }); card._hass.entities['person.one'] = registry; render();
    const selected = host.querySelector('[data-house-summary-person="0"] select').selectedOptions[0];
    expect(selected.value).toBe('person.one'); expect(selected.disabled).toBe(true);
    expect([...field('new-person').options].map((entry) => entry.value)).not.toContain('person.one');
  });
  it('does not treat a disabled device as an available selected person', () => {
    const { card, render, host } = setup({ raw: saved() }); card._hass.entities['person.one'] = { device_id: 'old-device' };
    card._hass.devices['old-device'] = { disabled_by: 'user' }; render();
    expect(host.querySelector('[data-house-summary-person="0"] select').selectedOptions[0].disabled).toBe(true);
  });
  it.each([true, 'true', 'false', 0, null, undefined])('labels a present restored flag %j without claiming a current reading', (restored) => {
    const { card, render, host, field } = setup({ raw: saved() }); card._hass.states['person.one'].attributes.restored = restored; render();
    expect(host.querySelector('[data-house-summary-person="0"] select').selectedOptions[0].disabled).toBe(true);
    expect([...field('new-person').options].map((entry) => entry.value)).not.toContain('person.one');
    expect(host.textContent).toMatch(/stored\/restored|malformed/);
  });
  it('keeps unavailable/unknown actual entities labelled as configuration choices, without calling them current readings', () => {
    const { card, host, render, field } = setup({ raw: saved() }); card._hass.states['weather.local'].state = 'unavailable';
    card._hass.states['person.one'].state = 'unknown'; render();
    expect(field('weather_entity').selectedOptions[0].disabled).toBe(false); expect(field('weather_entity').selectedOptions[0].textContent).toContain('Unavailable');
    expect(host.textContent).toContain('Configuration does not make it a current reading');
  });
  it('adds/removes actual people deliberately, refuses duplicates, and preserves exact source order', () => {
    const { card, change, click, button, remove } = setup({ raw: saved() }); change('new-person', 'person.one', 'change');
    expect(button('add-person').disabled).toBe(true); click('add-person'); change('new-person', 'person.two', 'change'); click('add-person'); remove(0); click('save');
    expect(card._layout.house_summary.person_entities).toEqual(['person.two']);
  });
  it('bounds deliberate addition to 12 while preserving an imported oversized list until explicit removal', () => {
    const states = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`person.p${index}`, state(`person.p${index}`, 'home')]));
    const raw = saved({ person_entities: Object.keys(states) }), { editor, button, remove, click, card } = setup({ raw, states });
    expect(editor.draft.person_entities).toHaveLength(14); expect(button('save').disabled).toBe(true); expect(button('add-person').disabled).toBe(true);
    remove(13); remove(12); click('save'); expect(card._layout.house_summary.person_entities).toEqual(Object.keys(states).slice(0, 12));
  });
  it.each([{ title: null }, { title: 5 }, { title: '' }, { title: ' '.repeat(5) }, { title: 'x'.repeat(129) }])('requires deliberate title repair for malformed import %j', (extra) => {
    const { editor, change, button, click, card } = setup({ raw: saved(extra) }); expect(button('save').disabled).toBe(true);
    change('title', 'New actual title'); expect(editor.draft.title).toBe('New actual title'); click('save'); expect(card._layout.house_summary.title).toBe('New actual title');
  });
  it('clears a malformed imported title hint after explicit repair without replacing the focused input', () => {
    const { field, change, host } = setup({ raw: saved({ title: null }) }); const input = field('title'); input.focus();
    expect(host.textContent).toContain('Imported title needs explicit repair'); change('title', 'Fixed title');
    expect(field('title')).toBe(input); expect(document.activeElement).toBe(input); expect(host.textContent).not.toContain('Imported title needs explicit repair');
  });
  it('repairs a malformed people type only after Clear people and preserves unknown extensions', () => {
    const raw = saved({ person_entities: 'person.one', future: { keep: true } }), { card, editor, button, click, change } = setup({ raw });
    expect(editor.draft.person_entities).toBe('person.one'); change('title', 'Draft'); expect(button('save').disabled).toBe(true);
    click('clear-people'); click('save'); expect(card._layout.house_summary).toEqual({ ...raw, title: 'Draft', person_entities: [] });
  });
  it('keeps Add visibly blocked until a malformed people list is deliberately cleared', () => {
    const { change, button, click, editor } = setup({ raw: saved({ person_entities: 'person.one' }) });
    change('new-person', 'person.two', 'change'); expect(button('add-person').disabled).toBe(true);
    click('clear-people'); change('new-person', 'person.two', 'change'); click('add-person'); expect(editor.draft.person_entities).toEqual(['person.two']);
  });
  it('updates selected option warnings and new actual choices during HA updates while preserving focused native selectors', () => {
    const { card, editor, field, host } = setup({ raw: saved() }); const picker = field('weather_entity'); picker.focus();
    card._hass.entities['weather.local'] = { hidden: true }; card._hass.states['weather.new'] = state('weather.new', 'sunny', { friendly_name: 'New current weather' });
    editor.updatePreviews(host); expect(field('weather_entity')).toBe(picker); expect(document.activeElement).toBe(picker);
    expect(picker.selectedOptions[0].disabled).toBe(true); expect(picker.selectedOptions[0].textContent).toContain('Hidden');
    expect([...picker.options].map((entry) => entry.value)).toContain('weather.new'); expect(editor.draft.weather_entity).toBe('weather.local');
  });
  it.each([null, [], false, 'wrong', 1])('requires explicit structure repair for malformed policy %j', (raw) => {
    // Present null has the documented ?? precedence and defaults when YAML is absent.
    const { card, editor, button, click, change } = setup({ raw });
    if (raw === null) { expect(editor.draft).toEqual({}); expect(button('save').disabled).toBe(true); return; }
    expect(button('save').disabled).toBe(true); click('repair-settings'); expect(editor.draft).toEqual({});
    change('title', 'Repaired'); click('save'); expect(card._layout.house_summary).toEqual({ title: 'Repaired' });
  });
  it('keeps malformed entity/duplicate people imports until explicit replacement/removal', () => {
    const { card, change, remove, click, button } = setup({ raw: saved({ weather_entity: 3, person_entities: ['person.one', 'person.one'] }) });
    expect(button('save').disabled).toBe(true); change('weather_entity', 'weather.local', 'change'); remove(1); click('save'); expect(card._layout.house_summary).toEqual(saved());
  });
});

describe('header drafts, current account context and stable native focus', () => {
  it('keeps a focused title, exact DOM node and draft during normal state/registry updates', () => {
    const { card, editor, field, change, host } = setup({ raw: saved() }); const input = field('title'); input.focus(); change('title', 'Still typing');
    card._hass = { ...card._hass, states: { ...card._hass.states, 'person.one': state('person.one', 'not_home', { friendly_name: 'Updated person name' }) } };
    card._hass.entities['weather.local'] = { hidden: true }; editor.updatePreviews(host);
    expect(field('title')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('Still typing');
    expect(editor.stale).toBe(false); expect(editor.draft.title).toBe('Still typing'); expect(host.textContent).toContain('Hidden, disabled');
  });
  it('keeps a focused person picker and current saved ID while reporting later source unavailability', () => {
    const { card, editor, person, host } = setup({ raw: saved() }); const select = person(0); select.focus();
    card._hass.states['person.one'].state = 'unavailable'; editor.updatePreviews(host);
    expect(person(0)).toBe(select); expect(document.activeElement).toBe(select); expect(select.value).toBe('person.one');
    expect(host.textContent).toContain('currently reports unknown/unavailable'); expect(editor.dirty).toBe(false);
  });
  const contextChanges = [
    ['model source', (card) => { card._layout.model = { url: '/new.glb' }; }],
    ['falsey YAML source', (card) => { card._config.model = ''; card._layout.model = { url: '/new.glb' }; }],
    ['model root', (card) => { card._view.model.root = { uuid: 'another' }; }],
    ['model alignment', (card) => { card._modelAlign = () => ({ position: [1, 0, 0], rotation: 0, scale: 1 }); }],
    ['source floors', (card) => { card._floors[0].elevation = 3; }],
    ['layout rooms', (card) => { card._layout.rooms.push({ id: 'replacement' }); }],
    ['layout key', (card) => { card._config.layout_key = 'another'; }],
    ['saved header/history', (card) => { card._layout.house_summary = saved({ title: 'Restored elsewhere' }); }],
    ['user identity', (card) => { card._hass.user.id = 'another'; }],
    ['admin permission', (card) => { card._hass.user.is_admin = false; }],
    ['inactive user', (card) => { card._hass.user.is_active = false; }],
    ['permissions', (card) => { card._hass.user.permissions = { entities: {} }; }],
    ['connection', (card) => { card._hass.connection.connected = false; }],
    ['new connection', (card) => { card._hass.connection = { connected: true }; }],
    ['auth session', (card) => { card._hass.auth = {}; }],
    ['tab leave', (card) => { card._edit.tab = 'rooms'; }],
    ['edit exit', (card) => { card._editing = false; }],
    ['card detach', (card) => { card.isConnected = false; }],
  ];
  it.each(contextChanges)('keeps dirty draft but latches %s change and blocks Save', (name, changeContext) => {
    const { card, editor, change, host, button } = setup({ raw: saved() }); change('title', 'Draft survives'); changeContext(card); editor.updatePreviews(host);
    expect(editor.stale).toBe(true); expect(editor.draft.title).toBe('Draft survives'); expect(button('save').disabled).toBe(true);
    editor.onClick('house-summary-save', button('save')); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('does not revive a dirty draft after permission loss/recovery; Cancel begins a new deliberate edit', () => {
    const { card, editor, change, host, click } = setup({ raw: saved() }); change('title', 'Old intent'); card._hass.user.is_admin = false; editor.updatePreviews(host);
    card._hass.user.is_admin = true; editor.updatePreviews(host); expect(editor.stale).toBe(true); click('cancel'); change('title', 'Fresh'); click('save');
    expect(card._layout.house_summary.title).toBe('Fresh');
  });
  it.each([['is_active', 'true'], ['is_active', null], ['is_active', 0], ['is_active', undefined], ['is_admin', 'true'], ['id', ''], ['id', '   ']])('requires actual active admin identity %s=%j', (key, value) => {
    const { card, editor, host, button } = setup({ raw: saved() }); card._hass.user[key] = value; editor.updatePreviews(host);
    expect(editor.canEdit).toBe(false); expect(button('clear-people').disabled).toBe(true); expect(button('cancel').disabled).toBe(false);
  });
  it('accepts an older HA user shape lacking is_active but still requires current connection/admin', () => {
    const { card, editor, host } = setup(); delete card._hass.user.is_active; editor.updatePreviews(host); expect(editor.canEdit).toBe(true);
  });
  it('uses the explicit root Settings gate only when exactly true and keeps strict identity requirements', () => {
    const { card, editor, host } = setup({ card: { _editing: false, houseSummaryEditorAvailable: () => true } });
    expect(editor.canEdit).toBe(true); card.houseSummaryEditorAvailable = () => 'true'; editor.updatePreviews(host); expect(editor.canEdit).toBe(false);
    card.houseSummaryEditorAvailable = () => true; card._hass.user.is_admin = false; editor.updatePreviews(host); expect(editor.canEdit).toBe(false);
  });
  it('supports an unregistered standalone fragment with editing omitted, without choosing another live tab', () => {
    const { editor } = setup({ card: { _editing: undefined, _edit: undefined } }); expect(editor.canEdit).toBe(true);
    const other = setup({ card: { _edit: { tab: 'model' } } }); expect(other.editor.canEdit).toBe(false);
  });
  it('rejects an old row event after removal shifts indexes and after Cancel replaces its native node', () => {
    const { editor, person, remove, click } = setup({ raw: saved({ person_entities: ['person.one', 'person.two'] }) }); const old = person(1);
    remove(0); old.value = 'person.one'; editor.onChange('house-summary-person', old); expect(editor.draft.person_entities).toEqual(['person.two']);
    const second = person(0); click('cancel'); second.value = 'person.two'; editor.onChange('house-summary-person', second);
    expect(editor.draft.person_entities).toEqual(['person.one', 'person.two']);
  });
  it.each(['reset', 'cancel', 'dispose'])('%s clears the local draft and removes native gesture listeners without writes', (method) => {
    const { card, editor, change, host, button } = setup({ raw: saved() }); change('title', 'Draft'); const old = button('save'), root = host.querySelector('[data-house-summary-editor]');
    const removed = vi.spyOn(root, 'removeEventListener'); editor[method](); expect(removed).toHaveBeenCalledTimes(6); expect(editor.draft).toBeNull();
    editor.onClick('house-summary-save', old); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); if (method === 'dispose') expect(editor.render()).toBe('');
  });
  it('displays exact restored Undo/Redo settings after a parent history reset and does not create another commit', () => {
    const { card, editor, change, click, render, field } = setup({ raw: saved() }); const before = structuredClone(card._layout.house_summary);
    change('title', 'Saved change'); click('save'); const after = structuredClone(card._layout.house_summary);
    card._layout.house_summary = before; editor.reset(); render(); expect(field('title').value).toBe('My home');
    card._layout.house_summary = after; editor.reset(); render(); expect(field('title').value).toBe('Saved change'); expect(card.commitFeatureLayout).toHaveBeenCalledTimes(1);
  });
});

describe('explicit native action intent, keyboard and accessible clicks', () => {
  it.each(['pointer', 'Space', 'Enter'])('blocks held %s Save after revocation/recovery and permits a fresh deliberate press', (kind) => {
    const { card, editor, change, button, host } = setup({ raw: saved() }); change('title', 'Draft'); const control = button('save');
    control.dispatchEvent(kind === 'pointer' ? new MouseEvent('pointerdown', { bubbles: true, button: 0 }) : new KeyboardEvent('keydown', { bubbles: true, key: kind === 'Space' ? ' ' : 'Enter' }));
    card._hass.connection.connected = false; editor.updatePreviews(host); card._hass.connection.connected = true; editor.updatePreviews(host);
    control.dispatchEvent(kind === 'pointer' ? new MouseEvent('pointerup', { bubbles: true, button: 0 }) : new KeyboardEvent('keyup', { bubbles: true, key: kind === 'Space' ? ' ' : 'Enter' }));
    editor.onClick('house-summary-save', control); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    button('cancel').click(); change('title', 'Fresh'); const fresh = button('save');
    fresh.dispatchEvent(kind === 'pointer' ? new MouseEvent('pointerdown', { bubbles: true, button: 0 }) : new KeyboardEvent('keydown', { bubbles: true, key: kind === 'Space' ? ' ' : 'Enter' }));
    fresh.click(); expect(card._layout.house_summary.title).toBe('Fresh');
  });
  it('poisons a clean held Clear people across a user swap and does not clear the new account’s settings', () => {
    const { card, editor, host, button } = setup({ raw: saved() }); const old = button('clear-people'); old.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    card._hass.user = { id: 'another', is_admin: true, is_active: true }; editor.updatePreviews(host); old.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    editor.onClick('house-summary-clear-people', old); expect(editor.draft.person_entities).toEqual(['person.one']);
  });
  it('rejects a cancelled pointer’s queued Save, then accepts a fresh press on the same focused button', () => {
    const { card, change, button } = setup({ raw: saved() }); change('title', 'Saved'); const control = button('save'); control.focus();
    control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); control.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true })); control.click();
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(document.activeElement).toBe(control);
    control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); control.click(); expect(card.commitFeatureLayout).toHaveBeenCalledTimes(1);
  });
  it('keeps accessibility-only current clicks working and rejects detached stale controls', () => {
    const { card, editor, change, button, render } = setup({ raw: saved() }); change('title', 'Accessible'); const old = button('save'); render();
    editor.onClick('house-summary-save', old); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); button('save').click(); expect(card.commitFeatureLayout).toHaveBeenCalledTimes(1);
  });
  it('keeps a held Save valid through unrelated actual HA state pushes without inventing commands', () => {
    const { card, editor, change, host, button } = setup({ raw: saved() }); change('title', 'Intent retained'); const control = button('save');
    control.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' })); card._hass = { ...card._hass, states: { ...card._hass.states,
      'person.one': state('person.one', 'not_home') } }; editor.updatePreviews(host); control.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' })); control.click();
    expect(card._layout.house_summary.title).toBe('Intent retained'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
