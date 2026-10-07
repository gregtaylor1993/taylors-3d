// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const light = (state = 'on', attributes = {}) => ({ state, attributes: { friendly_name: 'Lounge lamp',
  supported_color_modes: ['rgb', 'color_temp'], color_mode: 'rgb', brightness: 160, rgb_color: [70, 20, 200],
  min_color_temp_kelvin: 2300, max_color_temp_kelvin: 6500, ...attributes } });
const settings = () => ({ enabled: true, future: 'keep', items: [{ id: 'movie', label: 'Movie', scene_entity: 'scene.movie',
  lights: [{ entity: 'light.lounge', state: 'on', brightness: 100, color: { mode: 'rgb', rgb: [255, 0, 0] } }] }] });
const editors = [];
function setup({ config = {}, layout = {}, backend = 'browser', admin = true } = {}) {
  const connection = new EventTarget(); connection.connected = true;
  const card = { _config: { layout_key: 'home', ...config }, _layout: { rooms: [], pins: {}, ...layout }, _built: {},
    _hass: { user: { id: 'taylor', is_admin: admin }, connection, states: {
      'scene.movie': { state: 'unknown', attributes: { friendly_name: 'Movie scene' } }, 'light.lounge': light() },
      services: { scene: { turn_on: {} } }, entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn().mockResolvedValue(undefined), callWS: vi.fn() },
    _floors: [{ id: 'ground', elevation: 0 }], _roomList: [], _floor: 'ground', _mode: 'top', _editing: true,
    _stage: document.createElement('div'), _markers: [], _positions: new Map(), _store: { backend }, _history: new EditHistory(),
    _applyMarkerSelection: vi.fn(), modelBindings: () => null, previewSceneLights: vi.fn(),
    _view: { model: null, floorElevation: () => 0, setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(),
      setControlsEnabled: vi.fn(), highlightModelNode: vi.fn() } };
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  const edit = new EditMode(card); card._edit = edit; editors.push(edit);
  card._commit = vi.fn((value) => { card._layout = value; card._history.record(snapshot()); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch) => card._commit({ ...card._layout, ...patch }));
  card.undoEdit = vi.fn(() => { const value = card._history.undo(); if (value) card._layout = value.layout; edit.render(); });
  card.redoEdit = vi.fn(() => { const value = card._history.redo(); if (value) card._layout = value.layout; edit.render(); });
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach();
  const action = (name, selector = '') => edit.panel.querySelector(`[data-act="${name}"]${selector}`);
  const click = (name, selector = '') => { const control = action(name, selector); expect(control).toBeTruthy(); control.click(); return control; };
  const scenes = () => click('tab', '[data-id="scenes"]');
  const field = (name, index) => edit.panel.querySelector(`[data-field="scene-preview-${name}"]${index === undefined ? '' : `[data-target="${index}"]`}`);
  const change = (name, value, index, type = 'change') => { const element = field(name, index); expect(element).toBeTruthy();
    if (element.type === 'checkbox') element.checked = value; else element.value = value; element.dispatchEvent(new Event(type, { bubbles: true })); return element; };
  return { card, edit, action, click, scenes, field, change };
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); });

describe('Scenes in the actual layout editor', () => {
  it.each(['browser', 'shared', 'user'])('opens an opt-in empty editor in %s storage without any HA or saved-layout action', (backend) => {
    const { card, edit, scenes, field } = setup({ backend }); scenes();
    expect(edit.panel.textContent).toContain('Scene light previews'); expect(field('enabled').checked).toBe(false);
    expect(edit._scenePreviewEditor.items).toEqual([]); expect(card._commit).not.toHaveBeenCalled();
    expect(card.previewSceneLights).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
    expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('delegates explicit capture and Save once through existing history, with exact Undo/Redo settings', () => {
    const original = settings(); const { card, scenes, change, click, field } = setup({ layout: { scene_previews: original } }); scenes();
    change('label', 'Cinema', undefined, 'input'); click('scene-preview-capture');
    expect(card._commit).not.toHaveBeenCalled(); click('scene-preview-save');
    expect(card._commit).toHaveBeenCalledOnce(); expect(card._layout.scene_previews.future).toBe('keep');
    expect(card._layout.scene_previews.items[0].lights[0]).toEqual({ entity: 'light.lounge', state: 'on', brightness: 160, color: { mode: 'rgb', rgb: [70, 20, 200] } });
    expect(card._history.size).toBe(1); click('scene-preview-save'); expect(card._commit).toHaveBeenCalledOnce();
    click('history-undo'); expect(card._layout.scene_previews).toEqual(original); expect(field('label').value).toBe('Movie');
    click('history-redo'); expect(field('label').value).toBe('Cinema'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps the exact focused numeric draft during both HA updates and card rebuilds', () => {
    const { card, edit, scenes, field, change } = setup({ layout: { scene_previews: settings() } }); scenes();
    const input = change('light-brightness', '97', 0, 'input'); input.focus();
    card._hass.states['light.lounge'] = light('off'); edit.onStates(); edit.afterUpdate();
    expect(field('light-brightness', 0)).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('97');
    expect(edit.panel.textContent).toContain('Reported Home Assistant state (not preview): off');
    expect(edit._scenePreviewEditor.selected.lights[0].brightness).toBe(97); expect(card._commit).not.toHaveBeenCalled();
  });
  it('cancels local preview on live capability loss while preserving the visible unsaved field', () => {
    const { card, edit, scenes, click, field, change, action } = setup({ layout: { scene_previews: settings() } }); scenes();
    const input = change('light-brightness', '97', 0, 'input'); input.focus(); click('scene-preview-preview');
    expect(card.previewSceneLights.mock.lastCall[0]).toBeInstanceOf(Map);
    card._hass.states['light.lounge'] = light('on', { supported_color_modes: ['onoff'], color_mode: 'onoff' }); edit.onStates(); edit.afterUpdate();
    expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); expect(field('light-brightness', 0)).toBe(input); expect(input.value).toBe('97');
    expect(input.disabled).toBe(true); expect(action('scene-preview-save').disabled).toBe(true); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('removes an active draft preview on tab leave and discards only unsaved visual settings', () => {
    const original = settings(); const { card, edit, scenes, change, click, field } = setup({ layout: { scene_previews: original } }); scenes();
    change('label', 'Unfinished'); click('scene-preview-preview'); click('tab', '[data-id="rooms"]');
    expect(edit.tab).toBe('scenes'); expect(edit._scenePreviewEditor.dirty).toBe(true); click('draft-leave-discard');
    expect(edit._scenePreviewEditor.draft).toBeNull(); expect(card.previewSceneLights.mock.lastCall[0]).toBeNull();
    scenes(); expect(field('label').value).toBe('Movie'); expect(card._layout.scene_previews).toEqual(original);
    expect(card._commit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('stops with Escape while a native input is focused, retains the draft and leaves actual readings unchanged', () => {
    const { card, edit, scenes, click, change, field } = setup({ layout: { scene_previews: settings() } }); scenes();
    const input = change('light-brightness', '77', 0, 'input'); input.focus(); click('scene-preview-preview');
    card._hass.states['light.lounge'] = light('off'); edit.onStates();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); input.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true); expect(edit._scenePreviewEditor.previewToken).toBeNull();
    expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); expect(field('light-brightness', 0)).toBe(input); expect(input.value).toBe('77');
    expect(card._hass.states['light.lounge'].state).toBe('off'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('cancels history/context gestures and detach without permanently disposing a reusable scene editor', () => {
    const { card, edit, scenes, click, field, change } = setup({ layout: { scene_previews: settings() } }); scenes();
    change('label', 'Draft'); click('scene-preview-preview'); edit.cancelHistoryGestures();
    expect(edit._scenePreviewEditor.draft).toBeNull(); expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); edit.render();
    expect(field('label').value).toBe('Movie'); click('scene-preview-preview'); edit.detach();
    expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); expect(edit._scenePreviewEditor.disposed).toBe(false);
    edit.attach(); edit.render(); click('scene-preview-preview'); expect(card.previewSceneLights.mock.lastCall[0]).toBeInstanceOf(Map);
    edit.dispose(); expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); expect(edit._scenePreviewEditor.disposed).toBe(true);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('rejects a draft after a falsey YAML source is replaced by an uploaded model, until deliberate Cancel', () => {
    const { card, edit, scenes, click, field, change, action } = setup({ config: { model: '' }, layout: { model: { name: 'old.glb' }, scene_previews: settings() } }); scenes();
    const input = change('label', 'Draft', undefined, 'input'); input.focus(); click('scene-preview-preview');
    card._layout.model = { name: 'new.glb' }; edit.afterUpdate();
    expect(field('label')).toBe(input); expect(input.value).toBe('Draft'); expect(action('scene-preview-save').disabled).toBe(true);
    expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); click('scene-preview-save'); expect(card._commit).not.toHaveBeenCalled();
    click('scene-preview-cancel'); expect(field('label').value).toBe('Movie');
  });
  it('cancels the active preview before Undo and reloads restored settings on both history directions', () => {
    const { card, edit, scenes, click, change, field } = setup({ layout: { scene_previews: settings() } }); scenes();
    change('label', 'Cinema'); click('scene-preview-save'); click('scene-preview-preview'); click('history-undo');
    expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); expect(edit._scenePreviewEditor.previewToken).toBeNull(); expect(field('label').value).toBe('Movie');
    click('history-redo'); expect(field('label').value).toBe('Cinema'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('permits only the deliberate saved-scene command for an authenticated nonadministrator', async () => {
    const { card, edit, scenes, field, click, action } = setup({ layout: { scene_previews: settings() }, admin: false }); scenes();
    expect(field('label').disabled).toBe(true); expect(action('scene-preview-preview').disabled).toBe(true);
    edit._scenePreviewEditor.onClick('scene-preview-capture'); expect(card.previewSceneLights).not.toHaveBeenCalled();
    click('scene-preview-activate'); await vi.waitFor(() => expect(card._hass.callService).toHaveBeenCalledOnce());
    expect(card._hass.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' }); expect(card._commit).not.toHaveBeenCalled();
  });
  it('keeps canvas and marker taps in Scenes without room selection, pin drags or layout actions', () => {
    const { card, edit, scenes, click } = setup({ layout: { scene_previews: settings(), rooms: [{ id: 'lounge', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }] } });
    edit.selectedRoom = 'lounge'; edit.doorMode = true; edit.drawing = { floorId: 'ground', points: [[1, 1]] }; scenes();
    expect(edit.selectedRoom).toBeNull(); expect(edit.doorMode).toBe(false); expect(edit.drawing).toBeNull();
    click('scene-preview-preview'); card._view.planPoint = vi.fn(() => [2, 2]);
    edit.canvasDown({ button: 0, clientX: 10, clientY: 10 }); edit.canvasUp({ button: 0, clientX: 10, clientY: 10 });
    edit.markerDown({ id: 'entity:light.lounge' }, { button: 0, clientX: 10, clientY: 10, stopPropagation: vi.fn() });
    expect(edit.tab).toBe('scenes'); expect(edit.selectedRoom).toBeNull(); expect(edit.selectedMarker).toBeNull(); expect(edit.drag).toBeNull();
    expect(edit._scenePreviewEditor.previewToken).not.toBeNull(); expect(card._commit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps focus on the chosen target row when a colour-mode change deliberately rebuilds the form', () => {
    const saved = settings(); saved.items[0].lights.push({ ...saved.items[0].lights[0], entity: 'light.second' });
    const { card, scenes, field, change } = setup({ layout: { scene_previews: saved } }); card._hass.states['light.second'] = light(); scenes();
    field('light-color-mode', 1).focus(); change('light-color-mode', 'kelvin', 1);
    expect(document.activeElement).toBe(field('light-color-mode', 1)); expect(field('light-kelvin', 1).value).toBe('');
    expect(card._commit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});

describe('deliberate scene activation press lifetime', () => {
  const press = (button, kind, repeat = false) => button.dispatchEvent(kind === 'pointer'
    ? new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    : new KeyboardEvent('keydown', { bubbles: true, key: kind, repeat }));
  const release = (button, kind) => button.dispatchEvent(kind === 'pointer'
    ? new MouseEvent('pointerup', { bubbles: true, button: 0 })
    : new KeyboardEvent('keyup', { bubbles: true, key: kind }));
  it.each(['pointer', ' ', 'Enter'].flatMap((kind) => ['source', 'service', 'connection'].map((revocation) => [kind, revocation])))(
    'permanently cancels the old %j press across observed %s revocation and recovery, then accepts a fresh press', async (kind, revocation) => {
      const saved = settings(); saved.items[0].lights = []; // Scene activation is independent of visual target completeness.
      const { card, edit, scenes, action } = setup({ layout: { scene_previews: saved } }); scenes();
      const button = action('scene-preview-activate'); button.focus(); press(button, kind);
      const service = card._hass.services.scene.turn_on;
      if (revocation === 'source') card._hass.states['scene.movie'].state = 'unavailable';
      if (revocation === 'service') delete card._hass.services.scene.turn_on;
      if (revocation === 'connection') card._hass.connection.connected = false;
      edit.onStates(); expect(button.disabled).toBe(true); expect(action('scene-preview-activate')).toBe(button);
      if (revocation === 'source') card._hass.states['scene.movie'].state = 'unknown';
      if (revocation === 'service') card._hass.services.scene.turn_on = service;
      if (revocation === 'connection') card._hass.connection.connected = true;
      edit.onStates(); expect(button.disabled).toBe(false); expect(action('scene-preview-activate')).toBe(button);
      release(button, kind); button.click(); await Promise.resolve(); await Promise.resolve();
      expect(card._hass.callService).not.toHaveBeenCalled();
      press(button, kind); release(button, kind); button.click();
      await vi.waitFor(() => expect(card._hass.callService).toHaveBeenCalledOnce());
      expect(card._hass.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' });
      expect(card._commit).not.toHaveBeenCalled(); expect(card.previewSceneLights).not.toHaveBeenCalled();
    });
  it.each(['mapping', 'model', 'user', 'permissions', 'connection object', 'service function', 'display context'])(
    'does not reuse a held action across observed %s changes even when the original context is restored', async (kind) => {
      const { card, edit, scenes, action } = setup({ layout: { scene_previews: settings() } });
      card._scenePreviewKey = () => card.testDisplayContext; card.testDisplayContext = 'ground'; scenes();
      const button = action('scene-preview-activate'); button.focus(); press(button, 'pointer');
      const originalConnection = card._hass.connection, originalService = card._hass.callService;
      if (kind === 'mapping') card._layout.scene_previews.items[0].scene_entity = 'scene.changed';
      if (kind === 'model') card._view.model = { root: {} };
      if (kind === 'user') card._hass.user.id = 'another-user';
      if (kind === 'permissions') card._hass.user.permissions = { control: false };
      if (kind === 'connection object') { card._hass.connection = new EventTarget(); card._hass.connection.connected = true; }
      if (kind === 'service function') card._hass.callService = vi.fn().mockResolvedValue(undefined);
      if (kind === 'display context') card.testDisplayContext = 'first';
      edit.onStates();
      if (kind === 'mapping') card._layout.scene_previews.items[0].scene_entity = 'scene.movie';
      if (kind === 'model') card._view.model = null;
      if (kind === 'user') card._hass.user.id = 'taylor';
      if (kind === 'permissions') delete card._hass.user.permissions;
      if (kind === 'connection object') card._hass.connection = originalConnection;
      if (kind === 'service function') card._hass.callService = originalService;
      if (kind === 'display context') card.testDisplayContext = 'ground';
      edit.onStates(); expect(action('scene-preview-activate')).toBe(button); expect(button.disabled).toBe(false);
      release(button, 'pointer'); button.click(); await Promise.resolve(); expect(originalService).not.toHaveBeenCalled();
      press(button, 'pointer'); release(button, 'pointer'); button.click(); await vi.waitFor(() => expect(originalService).toHaveBeenCalledOnce());
      expect(originalService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' });
    });
  it('treats a held Enter key and its repeated native clicks as one action until a fresh keypress', async () => {
    const { card, edit, scenes, action } = setup({ layout: { scene_previews: settings() } }); scenes();
    const button = action('scene-preview-activate'); button.focus(); press(button, 'Enter'); button.click();
    await vi.waitFor(() => expect(edit._scenePreviewEditor.activationPending).toBe(false)); expect(card._hass.callService).toHaveBeenCalledOnce();
    press(button, 'Enter', true); button.click(); press(button, 'Enter', true); button.click(); await Promise.resolve();
    expect(card._hass.callService).toHaveBeenCalledOnce(); release(button, 'Enter'); press(button, 'Enter'); button.click(); release(button, 'Enter');
    await vi.waitFor(() => expect(card._hass.callService).toHaveBeenCalledTimes(2));
  });
  it.each(['pointercancel', 'focusout'])('rejects the delayed click after %s, then accepts a new deliberate gesture', async (event) => {
    const { card, scenes, action } = setup({ layout: { scene_previews: settings() } }); scenes();
    const button = action('scene-preview-activate'); button.focus(); const kind = event === 'focusout' ? ' ' : 'pointer'; press(button, kind);
    button.dispatchEvent(new Event(event, { bubbles: true })); release(button, kind); button.click(); await Promise.resolve();
    expect(card._hass.callService).not.toHaveBeenCalled(); press(button, kind); release(button, kind); button.click();
    await vi.waitFor(() => expect(card._hass.callService).toHaveBeenCalledOnce());
  });
  it('preserves a focused held button through unrelated HA updates and afterUpdate, with one valid released action', async () => {
    const { card, edit, scenes, action } = setup({ layout: { scene_previews: settings() } }); scenes();
    const button = action('scene-preview-activate'); button.focus(); press(button, 'pointer');
    card._hass.states['light.lounge'] = light('off'); edit.onStates(); edit.afterUpdate();
    expect(action('scene-preview-activate')).toBe(button); expect(document.activeElement).toBe(button);
    release(button, 'pointer'); button.click(); await vi.waitFor(() => expect(card._hass.callService).toHaveBeenCalledOnce());
    expect(card._hass.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' });
  });
  it('removes press listeners on detach/reset and ignores old-node clicks, while preserving a direct accessibility click on a fresh control', async () => {
    const { card, edit, scenes, action } = setup({ layout: { scene_previews: settings() } }); scenes();
    const button = action('scene-preview-activate'), root = edit.panel.querySelector('[data-scene-preview-editor]');
    const remove = vi.spyOn(root, 'removeEventListener'); press(button, 'pointer'); edit.detach();
    for (const event of ['pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup', 'focusout']) expect(remove).toHaveBeenCalledWith(event, expect.any(Function), true);
    expect(edit._scenePreviewEditor._activationPressed.size).toBe(0); expect(edit._scenePreviewEditor._activationRoot).toBeNull();
    release(button, 'pointer'); button.click(); await Promise.resolve(); expect(card._hass.callService).not.toHaveBeenCalled();
    edit.attach(); edit.render(); const fresh = action('scene-preview-activate'); expect(fresh).not.toBe(button); fresh.click();
    await vi.waitFor(() => expect(card._hass.callService).toHaveBeenCalledOnce());
    const freshRoot = edit.panel.querySelector('[data-scene-preview-editor]'), clean = vi.spyOn(freshRoot, 'removeEventListener'); edit.dispose();
    expect(clean).toHaveBeenCalledTimes(6); expect(edit._scenePreviewEditor._activationRoot).toBeNull();
  });
});
