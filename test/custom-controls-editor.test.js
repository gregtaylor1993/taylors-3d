// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomControlsEditor } from '../src/custom-controls-editor.js';
import { EditHistory } from '../src/history.js';
import { inspectSourceValue } from '../src/imported-source-controls.js';

const owners = [];
const state = (id, value = 'off', extra = {}) => ({ entity_id: id, state: value, attributes: { friendly_name: id }, ...extra });
const button = (id = 'movie', action = { type: 'scene', entity: 'scene.movie' }, extra = {}) => ({ id, label: 'Movie', icon: 'mdi:movie', color: 'amber', action, ...extra });
const bar = (id = 'evening', buttons = [button()], extra = {}) => ({ id, label: 'Evening', placement: 'bottom', style: 'pills', buttons, ...extra });
const settings = (bars = [bar()], extra = {}) => ({ version: 1, bars, ...extra });
function setup({ raw, config = {}, ...overrides } = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const card = { isConnected: true, _editing: true, _loading: false, _edit: { tab: 'controls', _generation: 1, panel: host },
    _config: { layout_key: 'home', ...config }, _layout: { version: 1, rooms: [], floors: [], ...(raw === undefined ? {} : { custom_controls: raw }) },
    _views: [{ id: 'front', name: 'Front door', camera: { position: [2, 3, 4] } }, { id: 'garden', name: 'Garden' }, { id: 'hidden', hidden: true }],
    _view: { model: { root: {} }, controls: { enabled: true } }, _floors: [{ id: 'ground', elevation: 0 }],
    _roomList: [{ room: { id: 'model:lounge', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 4]] }, name: 'Lounge', floorId: 'ground' }],
    _hass: { user: { id: 'admin', is_admin: true, is_active: true }, connection: { connected: true }, auth: {}, locale: { language: 'en' },
      states: { 'scene.movie': state('scene.movie', 'unknown'), 'scene.second': state('scene.second', 'unknown'), 'script.sleep': state('script.sleep'),
        'automation.doorbell': state('automation.doorbell', 'on'), 'light.lounge': state('light.lounge', 'on'), 'sensor.temperature': state('sensor.temperature', '18'),
        'switch.hidden': state('switch.hidden'), 'light.offline': state('light.offline', 'unavailable') },
      entities: { 'switch.hidden': { entity_id: 'switch.hidden', hidden_by: 'user' } }, devices: {},
      services: { scene: { turn_on: {} }, script: { turn_on: {} }, automation: { trigger: {} }, light: { toggle: {} }, switch: { toggle: {} } },
      callService: vi.fn(), callWS: vi.fn() }, ...overrides };
  const history = new EditHistory();
  // History receives persisted JSON in the real card; an opaque accessor fixture
  // belongs to the editor boundary and must not be serialized by this harness.
  history.reset({ layout: inspectSourceValue(card._layout).readable ? card._layout : {}, config: card._config });
  card.commitFeatureLayout = vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; history.record({ layout: card._layout, config: card._config }, 'Buttons and bars'); });
  const editor = new CustomControlsEditor(card, () => render()); owners.push(editor);
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  host.addEventListener('click', (event) => { const node = event.target.closest('[data-act]'); editor.onClick(node?.dataset.act, node); });
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  render();
  const find = (attribute, name, barId, buttonId) => [...host.querySelectorAll(`[${attribute}="custom-controls-${name}"]`)]
    .find((node) => (barId === undefined || node.dataset.ccBar === barId) && (buttonId === undefined || node.dataset.ccButton === buttonId));
  const field = (name, barId, buttonId) => find('data-field', name, barId, buttonId);
  const action = (name, barId, buttonId) => find('data-act', name, barId, buttonId);
  const change = (name, value, barId = 'evening', buttonId, type = 'change') => {
    const node = field(name, barId, buttonId); if (node.type === 'checkbox') node.checked = value; else node.value = value;
    node.dispatchEvent(new Event(type, { bubbles: true })); return node;
  };
  const click = (name, barId, buttonId) => action(name, barId, buttonId).click();
  return { card, host, editor, render, history, field, action, change, click };
}
function pointer(node, type, id = 1) { const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: id, button: 0, clientX: 10, clientY: 10 }); node.dispatchEvent(event); return event; }
afterEach(() => { owners.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); delete document.elementFromPoint; vi.restoreAllMocks(); });

describe('visual custom control drafts', () => {
  it('starts empty and requires a deliberate source, without choosing or executing one', () => {
    const h = setup(); expect(h.editor.draft).toEqual(settings([])); expect(h.action('save').disabled).toBe(true);
    h.click('add-bar'); h.click('add-button', 'bar_1');
    expect(h.editor.draft.bars[0].buttons[0].action).toEqual({ type: 'more-info', entity: '' });
    expect(h.action('save').disabled).toBe(true); expect(h.field('source', 'bar_1', 'button_1').value).toBe('');
    h.change('source', 'light.lounge', 'bar_1', 'button_1'); h.click('save');
    expect(h.card._layout.custom_controls.bars[0].buttons[0].action.entity).toBe('light.lounge');
    expect(h.card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(h.card._hass.callService).not.toHaveBeenCalled(); expect(h.card._hass.callWS).not.toHaveBeenCalled();
  });
  it('edits named bars, palette, icons, exact room and tiles, then commits one undoable snapshot', () => {
    const raw = settings([bar('evening', [button()], { futureBar: { keep: true } })], { future: ['keep'] }), before = structuredClone(raw), h = setup({ raw });
    h.change('bar-label', 'Lounge favourites', 'evening', undefined, 'input'); h.change('button-label', 'Cinema', 'evening', 'movie', 'input');
    h.change('icon', 'mdi:television', 'evening', 'movie', 'input'); h.change('color', 'teal', 'evening', 'movie'); h.change('placement', 'room');
    expect(h.action('save').disabled).toBe(true); h.change('room', 'model:lounge'); h.change('style', 'tiles');
    expect(h.host.querySelector('[data-cc-preview]').dataset.ccStyle).toBe('tiles'); expect(h.card._layout.custom_controls).toEqual(before); h.click('save');
    expect(raw).toEqual(before); expect(h.card._layout.custom_controls).toMatchObject({ future: ['keep'], bars: [{ label: 'Lounge favourites', room_id: 'model:lounge', style: 'tiles', futureBar: { keep: true }, buttons: [{ label: 'Cinema', icon: 'mdi:television', color: 'teal' }] }] });
    expect(h.history.size).toBe(1); const undo = h.history.undo(); expect(undo.layout.custom_controls).toEqual(before);
    expect(h.history.redo().layout.custom_controls).toEqual(h.card._layout.custom_controls); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it.each([
    ['view', 'front', { type: 'view', view_id: 'front' }], ['scene', 'scene.second', { type: 'scene', entity: 'scene.second' }],
    ['script', 'script.sleep', { type: 'script', entity: 'script.sleep' }], ['automation', 'automation.doorbell', { type: 'automation', entity: 'automation.doorbell', skip_conditions: false }],
    ['toggle', 'light.lounge', { type: 'toggle', entity: 'light.lounge' }], ['more-info', 'sensor.temperature', { type: 'more-info', entity: 'sensor.temperature' }],
  ])('selects exact %s sources; neither source selection nor preview runs the action', (type, source, expected) => {
    const h = setup({ raw: settings() }); h.change('action', type, 'evening', 'movie'); h.change('source', source, 'evening', 'movie');
    expect(h.editor.draft.bars[0].buttons[0].action).toEqual(expected); h.click('save');
    expect(h.card._layout.custom_controls.bars[0].buttons[0].action).toEqual(expected);
    expect(h.card._hass.callService).not.toHaveBeenCalled(); expect(h.card._hass.callWS).not.toHaveBeenCalled();
    expect(h.host.querySelector('[data-cc-preview] [data-act]')).toBeNull();
  });
  it('offers an explicit Skip conditions opt-in and defaults to checking conditions', () => {
    const h = setup({ raw: settings() }); h.change('action', 'automation', 'evening', 'movie'); h.change('source', 'automation.doorbell', 'evening', 'movie');
    expect(h.field('skip', 'evening', 'movie').checked).toBe(false); h.change('skip', true, 'evening', 'movie');
    h.click('save'); expect(h.card._layout.custom_controls.bars[0].buttons[0].action.skip_conditions).toBe(true); expect(h.card._hass.callService).not.toHaveBeenCalled();
  });
  it('retains unavailable saved links, excludes hidden/offline new sources, and permits a label repair', () => {
    const h = setup({ raw: settings([bar('evening', [button('movie', { type: 'toggle', entity: 'light.gone' })])]) });
    const source = h.field('source', 'evening', 'movie'); expect(source.value).toBe('light.gone'); expect(source.selectedOptions[0].disabled).toBe(true);
    expect([...source.options].some((row) => row.value === 'switch.hidden')).toBe(false); expect([...source.options].some((row) => row.value === 'light.offline')).toBe(false);
    h.change('button-label', 'Keep this missing light', 'evening', 'movie', 'input'); expect(h.action('save').disabled).toBe(false); h.click('save');
    expect(h.card._layout.custom_controls.bars[0].buttons[0]).toMatchObject({ label: 'Keep this missing light', action: { entity: 'light.gone' } });
  });
  it('moves bars and buttons with keyboard-accessible controls without losing extensions', () => {
    const h = setup({ raw: settings([bar('evening', [button('movie'), button('second', { type: 'scene', entity: 'scene.second' }, { extra: { keep: 2 } })]), bar('room', [], { placement: 'room', room_id: 'model:lounge' })]) });
    h.click('button-up', 'evening', 'second'); expect(h.editor.draft.bars[0].buttons.map((row) => row.id)).toEqual(['second', 'movie']);
    h.click('button-down', 'evening', 'second'); h.change('move-to', 'room', 'evening', 'second'); h.click('move', 'evening', 'second');
    expect(h.editor.draft.bars[1].buttons[0]).toMatchObject({ id: 'second', extra: { keep: 2 } }); h.click('bar-up', 'room');
    expect(h.editor.draft.bars.map((row) => row.id)).toEqual(['room', 'evening']); h.click('bar-down', 'room');
    expect(h.editor.draft.bars.map((row) => row.id)).toEqual(['evening', 'room']); h.click('cancel');
    expect(h.editor.draft.bars[0].buttons.map((row) => row.id)).toEqual(['movie', 'second']); expect(h.history.size).toBe(0);
  });
  it('keeps invalid typed icons and long labels editable and blocks Save until repaired', () => {
    const h = setup({ raw: settings() }); const input = h.change('icon', 'mdi:bad<script>', 'evening', 'movie', 'input');
    expect(h.field('icon', 'evening', 'movie')).toBe(input); expect(h.action('save').disabled).toBe(true);
    h.change('icon', 'mdi:movie', 'evening', 'movie', 'input'); h.change('button-label', 'x'.repeat(81), 'evening', 'movie', 'input'); expect(h.action('save').disabled).toBe(true);
    h.change('button-label', 'Repaired', 'evening', 'movie', 'input'); expect(h.action('save').disabled).toBe(false);
  });
  it('keeps frozen and non-enumerable inert extensions through labels, source changes, moves and Save', () => {
    const raw = settings([bar('evening', [button(), button('second')]), bar('other', [])]);
    for (const [row, value] of [[raw, 'settings'], [raw.bars[0], 'bar'], [raw.bars[0].buttons[0], 'button'], [raw.bars[0].buttons[0].action, 'action']]) {
      Object.defineProperty(row, 'inert', { enumerable: false, value: { keep: value } }); Object.freeze(row);
    }
    const h = setup({ raw }); h.change('button-label', 'Edited', 'evening', 'movie', 'input'); h.change('source', 'scene.second', 'evening', 'movie');
    h.change('move-to', 'other', 'evening', 'movie'); h.click('move', 'evening', 'movie'); h.click('save');
    const saved = h.card.commitFeatureLayout.mock.calls[0][0].custom_controls;
    expect(saved.inert).toEqual({ keep: 'settings' }); expect(saved.bars[0].inert).toEqual({ keep: 'bar' });
    expect(saved.bars[1].buttons[0].inert).toEqual({ keep: 'button' }); expect(saved.bars[1].buttons[0].action.inert).toEqual({ keep: 'action' });
    expect(Object.getOwnPropertyDescriptor(saved, 'inert').enumerable).toBe(false); expect(raw.bars[0].buttons[0].label).toBe('Movie');
  });
  it('never calls non-enumerable HA source accessors while preparing a picker', () => {
    const h = setup({ raw: settings() }), getter = vi.fn(() => 'on');
    Object.defineProperty(h.card._hass.states['light.lounge'], 'state', { configurable: true, get: getter });
    h.change('action', 'toggle', 'evening', 'movie'); h.editor.observe(); h.editor.updatePreviews(h.host);
    expect(getter).not.toHaveBeenCalled(); expect([...h.field('source', 'evening', 'movie').options].some((row) => row.value === 'light.lounge')).toBe(false);
  });
  it('uses shared own null before YAML and preserves unsupported raw data until explicit replacement Save', () => {
    const yaml = settings(), h = setup({ raw: null, config: { custom_controls: yaml } }); expect(h.editor.draft).toBeNull(); expect(h.field('button-label')).toBeUndefined();
    h.click('replace'); h.click('add-bar'); h.click('cancel'); expect(h.card._layout.custom_controls).toBeNull(); expect(h.card._config.custom_controls).toEqual(yaml);
    h.click('replace'); h.click('save'); expect(h.card._layout.custom_controls).toEqual(settings([])); expect(h.card._config.custom_controls).toEqual(yaml);
  });
  it.each([settings([], { version: 9, future: { kept: true } }), settings([bar('same'), bar('same')]), settings([bar('a'), bar('b')])])('does not silently normalize unsupported/duplicate imported configuration', (raw) => {
    const h = setup({ raw }); expect(h.action('save').disabled).toBe(true); expect(h.action('replace')).toBeDefined(); h.click('cancel'); expect(h.card._layout.custom_controls).toEqual(raw);
  });
  it('never executes imported getters or serialization hooks, including in unsupported review', () => {
    const getter = vi.fn(() => []), raw = { version: 1 }; Object.defineProperty(raw, 'bars', { enumerable: true, get: getter });
    const h = setup({ raw }); h.editor.observe(); h.editor.updatePreviews(h.host); h.click('replace'); h.click('cancel'); expect(getter).not.toHaveBeenCalled(); expect(h.card._layout.custom_controls).toBe(raw);
  });
  it('preserves native input/select focus and partial draft through unrelated state and all locale updates', () => {
    const h = setup({ raw: settings() }); const input = h.change('button-label', 'Still typing', 'evening', 'movie', 'input'); input.focus(); input.setSelectionRange(2, 7);
    const select = h.field('source', 'evening', 'movie');
    for (const language of ['de', 'fr', 'es', 'en']) { h.card._hass.locale.language = language; h.card._hass.states['sensor.temperature'].state = '19'; h.editor.observe(); h.editor.updatePreviews(h.host);
      expect(h.editor.stale).toBe(false); expect(h.field('button-label', 'evening', 'movie')).toBe(input); expect(h.field('source', 'evening', 'movie')).toBe(select);
      expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(2); expect(input.selectionEnd).toBe(7); }
    expect(input.value).toBe('Still typing'); expect(h.action('save').disabled).toBe(false);
  });
  it('refreshes room/view/entity names without changing exact IDs or losing the draft', () => {
    const h = setup({ raw: settings([bar('evening', [button('movie', { type: 'view', view_id: 'front' })], { placement: 'room', room_id: 'model:lounge' })]) });
    const input = h.change('button-label', 'Still typing', 'evening', 'movie', 'input'); input.focus();
    h.card._roomList[0].name = 'Renamed room'; h.card._views[0].label = 'Renamed front'; h.card._hass.states['scene.movie'].attributes.friendly_name = 'Renamed scene';
    h.editor.observe(); h.editor.updatePreviews(h.host); expect(h.editor.stale).toBe(false); expect(document.activeElement).toBe(input);
    expect(h.field('room').value).toBe('model:lounge'); expect(h.field('room').selectedOptions[0].textContent).toContain('Renamed room');
    expect(h.field('source', 'evening', 'movie').value).toBe('front'); expect(h.field('source', 'evening', 'movie').selectedOptions[0].textContent).toContain('Renamed front');
  });
  it('supports keyboard Enter and Space for reorder and Save while a cancelled held intent remains rejected', () => {
    const h = setup({ raw: settings([bar('evening', [button(), button('second')])]) }); let up = h.action('button-up', 'evening', 'second');
    up.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    up.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true })); expect(h.editor.draft.bars[0].buttons[0].id).toBe('second');
    const save = h.action('save'); save.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    save.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true })); expect(h.card.commitFeatureLayout).toHaveBeenCalledOnce();
    h.change('button-label', 'Held', 'evening', 'movie', 'input'); up = h.action('save'); pointer(up, 'pointerdown'); pointer(up, 'pointercancel'); up.click();
    expect(h.card.commitFeatureLayout).toHaveBeenCalledOnce();
  });
  it('enforces bar/button limits and unique generated IDs across both placements', () => {
    const buttons = Array.from({ length: 12 }, (_, index) => button(`button_${index + 1}`));
    const h = setup({ raw: settings([bar('bar_1', buttons), ...Array.from({ length: 7 }, (_, index) => bar(`bar_${index + 2}`, [], index === 0 ? { placement: 'room', room_id: 'model:lounge' } : {}))]) });
    expect(h.action('add-bar').disabled).toBe(true); expect(h.action('add-button', 'bar_1').disabled).toBe(true);
    h.click('add-button', 'bar_2'); expect(h.editor.draft.bars[1].buttons[0].id).toBe('button_13'); expect(h.editor.draft.bars[1].room_id).toBe('model:lounge');
    h.click('remove-button', 'bar_2', 'button_13'); h.click('remove-bar', 'bar_8'); h.click('add-bar'); expect(h.editor.draft.bars[7].id).toBe('bar_8');
  });
  it('wires actual owned pointer handles to cross-scope draft moves and leaves layout/history/actions untouched', () => {
    const raw = settings([bar(), bar('room', [], { placement: 'room', room_id: 'model:lounge' })]), h = setup({ raw });
    const handle = h.host.querySelector('[data-cc-drag=button]'), target = h.host.querySelector('[data-cc-bar-row=room]');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) });
    pointer(handle, 'pointerdown'); const event = new Event('pointerup', { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: 1, clientX: 30, clientY: 40 }); window.dispatchEvent(event);
    expect(h.editor.draft.bars[0].buttons).toEqual([]); expect(h.editor.draft.bars[1].buttons[0].id).toBe('movie');
    expect(h.card._layout.custom_controls).toEqual(raw); expect(h.history.size).toBe(0); expect(h.card._hass.callService).not.toHaveBeenCalled(); expect(h.card._hass.callWS).not.toHaveBeenCalled();
    delete document.elementFromPoint;
  });
  it.each(['source', 'account', 'draft', 'locale'])('fences a native editor drag across %s updates', (kind) => {
    const h = setup({ raw: settings([bar(), bar('other', [])]) }), handle = h.host.querySelector('[data-cc-drag=button]'), target = h.host.querySelector('[data-cc-bar-row=other]');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) }); pointer(handle, 'pointerdown');
    if (kind === 'source') delete h.card._hass.states['scene.movie']; if (kind === 'account') h.card._hass.user.id = 'other';
    if (kind === 'draft') h.change('button-label', 'Changed during gesture', 'evening', 'movie', 'input'); if (kind === 'locale') h.card._hass.locale.language = 'de';
    h.editor.observe(); const event = new Event('pointerup', { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: 1, clientX: 30, clientY: 40 }); window.dispatchEvent(event);
    expect(h.editor.draft.bars[1].buttons).toHaveLength(kind === 'locale' ? 1 : 0); expect(h.card.commitFeatureLayout).not.toHaveBeenCalled(); delete document.elementFromPoint;
  });
  it.each(['account', 'auth', 'connection', 'key', 'root', 'layout', 'source', 'metadata', 'view', 'room', 'loading', 'model-pending', 'tab', 'permission'])('blocks stale %s drafts and cannot resurrect an old held Save', (kind) => {
    const h = setup({ raw: settings() }); h.change('button-label', 'Draft', 'evening', 'movie', 'input'); const save = h.action('save'); pointer(save, 'pointerdown');
    if (kind === 'account') h.card._hass.user.id = 'another'; if (kind === 'auth') h.card._hass.auth = {};
    if (kind === 'connection') h.card._hass.connection = { connected: true }; if (kind === 'key') h.card._config.layout_key = 'other';
    if (kind === 'root') h.card._view.model.root = {}; if (kind === 'layout') h.card._layout.rooms.push({ id: 'changed' });
    if (kind === 'source') delete h.card._hass.states['scene.movie']; if (kind === 'view') h.card._views[0].camera.position[0] = 8;
    if (kind === 'metadata') h.card._hass.entities['scene.movie'] = { entity_id: 'scene.movie', device_id: 'replacement-device' };
    if (kind === 'room') h.card._floors[0].elevation = 5; if (kind === 'loading') h.card._loading = true;
    if (kind === 'tab') h.card._edit.tab = 'rooms'; if (kind === 'permission') h.card._hass.user.is_admin = false;
    if (kind === 'model-pending') h.card._customControlsModelLoad = { view: h.card._view, promise: Promise.resolve() };
    h.editor.observe(); pointer(save, 'pointerup'); save.click(); expect(h.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(h.editor.stale).toBe(true);
    expect(h.editor.draft.bars[0].buttons[0].label).toBe('Draft');
  });
  it('retains the missing-source locale draft while translating authored warnings', () => {
    const h = setup({ raw: settings([bar('evening', [button('movie', { type: 'scene', entity: 'scene.missing' })])]) });
    h.change('button-label', 'Kept', 'evening', 'movie', 'input'); h.card._hass.locale.language = 'de'; h.editor.observe(); h.editor.updatePreviews(h.host);
    expect(h.editor.stale).toBe(false); expect(h.editor.draft.bars[0].buttons[0].label).toBe('Kept'); expect(h.action('save').textContent).toBe('Speichern');
  });
  it('blocks pending model requests without serializing the promise and keeps a dirty draft stale after settlement', () => {
    const h = setup({ raw: settings() }); h.change('button-label', 'Kept', 'evening', 'movie', 'input');
    const promise = Promise.resolve(); h.card._customControlsModelLoad = { view: h.card._view, promise }; h.editor.observe(); h.editor.updatePreviews(h.host);
    expect(h.editor.canEdit).toBe(false); expect(h.action('save').disabled).toBe(true); expect(h.editor._context().pending).toBe(promise);
    h.card._customControlsModelLoad = null; h.editor.observe(); h.editor.updatePreviews(h.host); expect(h.editor.stale).toBe(true);
    h.click('save'); expect(h.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(h.editor.draft.bars[0].buttons[0].label).toBe('Kept');
  });
  it('requires current native nodes and ignores another editor’s fields/actions', () => {
    const h = setup({ raw: settings() }), old = h.field('button-label', 'evening', 'movie'); h.click('add-bar'); old.value = 'Foreign';
    h.editor.onInput('custom-controls-button-label', old); expect(h.editor.draft.bars[0].buttons[0].label).toBe('Movie');
    expect(h.editor.onInput('weather-enabled', old)).toBe(false); expect(h.editor.onChange('room-actions-source', old)).toBe(false);
    expect(h.editor.onClick('house-summary-save', old)).toBe(false); h.editor.dispose(); expect(h.editor.render()).toBe(''); expect(h.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
});
