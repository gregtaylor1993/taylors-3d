// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScenePreviewEditor } from '../src/scene-preview-editor.js';
import { EditHistory } from '../src/history.js';

const rgbLight = (state = 'on', attributes = {}) => ({ state, attributes: { friendly_name: 'Lounge lamp', brightness: 180,
  supported_color_modes: ['rgb', 'color_temp'], color_mode: 'rgb', rgb_color: [120, 20, 30], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6400, ...attributes } });
const target = (entity = 'light.lounge') => ({ entity, state: 'on', brightness: 120, color: { mode: 'rgb', rgb: [255, 30, 0] } });
const item = (id = 'movie', scene = 'scene.movie') => ({ id, label: 'Movie', scene_entity: scene, lights: [target()] });
const saved = () => ({ enabled: true, items: [item()] });
const editors = [];
function setup({ layout = {}, config = {}, states = {}, entities = {}, admin = true } = {}) {
  const connection = new EventTarget(); connection.connected = true;
  const card = { _config: { layout_key: 'home', ...config }, _layout: { pins: {}, ...layout }, _view: { model: null },
    _hass: { states: { 'scene.movie': { state: 'unknown', attributes: { friendly_name: 'Movie scene' } },
      'scene.bedtime': { state: '2026-10-05T12:00:00+00:00', attributes: { friendly_name: 'Bedtime scene' } },
      'light.lounge': rgbLight(), 'light.off': rgbLight('off', { friendly_name: 'Off light', rgb_color: [200, 1, 2] }),
      'light.simple': { state: 'on', attributes: { friendly_name: 'Simple relay light', supported_color_modes: ['onoff'], color_mode: 'onoff' } }, ...states },
      entities, devices: {}, areas: {}, floors: {}, user: { id: 'taylor', is_admin: admin, is_active: true }, connection,
      services: { scene: { turn_on: {} } }, callService: vi.fn().mockResolvedValue(undefined) },
    previewSceneLights: vi.fn(), _history: new EditHistory() };
  card._history.reset({ layout: card._layout, config: card._config });
  card.commitFeatureLayout = vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; card._history.record({ layout: card._layout, config: card._config }); });
  const host = document.createElement('div'); document.body.append(host);
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  const editor = new ScenePreviewEditor(card, render); editors.push(editor);
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const button = event.target.closest('[data-act]'); if (button) editor.onClick(button.dataset.act, button); });
  render();
  const input = (field, index) => host.querySelector(`[data-field="scene-preview-${field}"]${index === undefined ? '' : `[data-target="${index}"]`}`);
  const change = (field, value, index, type = 'change') => { const element = input(field, index); expect(element).toBeTruthy();
    if (element.type === 'checkbox') element.checked = value; else element.value = value; element.dispatchEvent(new Event(type, { bubbles: true })); return element; };
  const action = (name, index) => host.querySelector(`[data-act="scene-preview-${name}"]${index === undefined ? '' : `[data-target="${index}"]`}`);
  const click = (name, index) => { const element = action(name, index); expect(element).toBeTruthy(); element.click(); return element; };
  return { card, editor, host, render, input, change, action, click };
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('explicit scene-light draft editor', () => {
  it('starts disabled without selecting a scene or inferring targets from scene attributes', () => {
    const { card, editor, host, input } = setup({ states: { 'scene.movie': { state: 'unknown', attributes: { entity_id: ['light.lounge'], entities: { 'light.lounge': { state: 'off' } } } } } });
    expect(input('enabled').checked).toBe(false); expect(editor.items).toEqual([]); expect(editor.selected).toBeUndefined();
    expect(host.textContent).toContain('other devices'); expect(card.previewSceneLights).not.toHaveBeenCalled();
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('adds an exact scene/light mapping with no guessed state, brightness or colour, and saves once', () => {
    const { card, editor, change, click, action } = setup(); change('enabled', true); click('add'); change('scene-entity', 'scene.movie');
    change('new-light', 'light.lounge'); click('add-light');
    expect(editor.selected.lights).toEqual([{ entity: 'light.lounge', state: '' }]); expect(action('save').disabled).toBe(true);
    change('light-state', 'on', 0); change('light-brightness', '100', 0, 'input'); change('light-color-mode', 'rgb', 0);
    expect(editor.selected.lights[0].color.rgb).toEqual([]); expect(action('save').disabled).toBe(true);
    change('light-rgb', '#112233', 0); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(card._history.size).toBe(1);
    expect(card._layout.scene_previews).toMatchObject({ enabled: true, items: [{ scene_entity: 'scene.movie', lights: [{ entity: 'light.lounge', state: 'on', brightness: 100, color: { mode: 'rgb', rgb: [17, 34, 51] } }] }] });
    click('save'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('requires deliberate confirmation even when the native RGB picker starts at white', () => {
    const { editor, change, click, action } = setup({ layout: { scene_previews: saved() } });
    change('light-color-mode', 'rgb', 0); expect(editor.selected.lights[0].color.rgb).toEqual([]);
    expect(action('preview').disabled).toBe(true); click('use-rgb', 0);
    expect(editor.selected.lights[0].color.rgb).toEqual([255, 255, 255]); expect(action('preview').disabled).toBe(false);
  });
  it('updates the incomplete RGB caption after explicit native colour input without replacing the focused picker', () => {
    const { card, editor, host, change, input, action } = setup({ layout: { scene_previews: saved() } });
    change('light-color-mode', 'rgb', 0);
    const hint = [...host.querySelector('.scene-preview-light').querySelectorAll('.scene-preview-hint')]
      .find((element) => element.textContent.includes('The picker starts at white'));
    expect(hint).toBeTruthy(); expect(action('preview').disabled).toBe(true);
    const picker = input('light-rgb', 0); picker.focus();
    change('light-rgb', '#0000ff', 0, 'input');
    expect(editor.selected.lights[0].color.rgb).toEqual([0, 0, 255]);
    expect(host.querySelector('[data-scene-preview-rgb-hint="0"]')).toBe(hint);
    expect(hint.dataset.binding).toBe('movie'); expect(hint.dataset.entity).toBe('light.lounge');
    expect(hint.textContent).toBe('This is your chosen visual target, not a current light reading.');
    expect(input('light-rgb', 0)).toBe(picker); expect(document.activeElement).toBe(picker);
    expect(action('preview').disabled).toBe(false); expect(card._hass.callService).not.toHaveBeenCalled();
    card._hass.states['light.lounge'] = rgbLight('on', { rgb_color: [0, 255, 0] }); editor.updatePreviews(host);
    expect(hint.textContent).toBe('This is your chosen visual target, not a current light reading.');
    expect(input('light-rgb', 0)).toBe(picker); expect(document.activeElement).toBe(picker);
    expect(editor.selected.lights[0].color.rgb).toEqual([0, 0, 255]);
  });
  it('refreshes each exact RGB target caption independently and never labels malformed imported RGB as chosen', () => {
    const settings = { enabled: true, items: [{ ...item(), lights: [
      { ...target(), color: { mode: 'rgb', rgb: [] } },
      { ...target('light.off'), color: { mode: 'rgb', rgb: [0, 'blue', 255] } },
    ] }] };
    const { host, change, editor, card } = setup({ layout: { scene_previews: settings } });
    const first = host.querySelector('[data-scene-preview-rgb-hint="0"]'), second = host.querySelector('[data-scene-preview-rgb-hint="1"]');
    expect(first.textContent).toContain('The picker starts at white'); expect(second.textContent).toContain('The picker starts at white');
    change('light-rgb', '#0000ff', 0, 'input'); editor.updatePreviews(host);
    expect(first.textContent).toContain('your chosen visual target'); expect(second.textContent).toContain('The picker starts at white');
    expect(host.querySelector('[data-scene-preview-rgb-hint="1"]')).toBe(second); expect(second.dataset.entity).toBe('light.off');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('preserves extension fields and untouched unavailable entries on a label-only edit and Undo', () => {
    const original = { ...saved(), future: { version: 2 }, items: [{ ...item(), futureItem: 'keep', lights: [{ ...target(), futureTarget: 3, color: { ...target().color, futurePalette: 'orange' } }] },
      { id: 'other', scene_entity: 'scene.bedtime', lights: [{ entity: 'light.missing', state: 'off' }], imported: ['keep'] }] };
    const { card, change, click, render, editor, input } = setup({ layout: { scene_previews: original } });
    change('label', 'Cinema', undefined, 'input'); click('save'); expect(card._layout.scene_previews).toEqual({ ...original, items: [{ ...original.items[0], label: 'Cinema' }, original.items[1]] });
    expect(original.items[0].label).toBe('Movie'); expect(card._history.size).toBe(1);
    const previous = card._history.undo(); card._layout = previous.layout; editor.reset(); render();
    expect(input('label').value).toBe('Movie'); expect(card._layout.scene_previews.future).toEqual({ version: 2 });
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('uses layout before card fallback while keeping both untouched during drafts and Cancel', () => {
    const layout = saved(), config = { enabled: false, items: [{ ...item('sleep', 'scene.bedtime'), label: 'Sleep' }] };
    const { card, editor, input, change, click, render } = setup({ layout: { scene_previews: layout }, config: { scene_previews: config } });
    expect(input('label').value).toBe('Movie'); change('label', 'Unfinished'); click('cancel'); expect(input('label').value).toBe('Movie');
    delete card._layout.scene_previews; editor.reset(); render(); expect(input('label').value).toBe('Sleep');
    expect(config.items[0].label).toBe('Sleep'); expect(layout.items[0].label).toBe('Movie'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each([false, [], 'movie'])('preserves malformed explicit settings %j until deliberate replacement', (value) => {
    const { card, host, action, click, change } = setup({ config: { scene_previews: value } });
    expect(host.textContent).toContain('imported preview settings are malformed'); expect(action('save').disabled).toBe(true);
    expect(card._config.scene_previews).toEqual(value); click('cancel'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('repair'); change('enabled', true); click('save');
    expect(card._layout.scene_previews).toEqual({ enabled: true, items: [] }); expect(card._config.scene_previews).toEqual(value);
  });
  it('captures only selected current readings, keeps off lights off and does not read or create a scene', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const original = { enabled: true, future: true, items: [{ ...item(), lights: [{ ...target(), futureTarget: 'keep' }, { ...target('light.off'), futureOff: 9 }] }] };
    const { card, editor, click, host } = setup({ layout: { scene_previews: original } }); click('capture');
    expect(editor.selected.lights).toEqual([{ entity: 'light.lounge', state: 'on', brightness: 180, color: { mode: 'rgb', rgb: [120, 20, 30] }, futureTarget: 'keep' },
      { entity: 'light.off', state: 'off', futureOff: 9 }]);
    expect(editor.selected.captured_at).toBe(1000); expect(host.textContent).toContain('not the Home Assistant scene definition');
    expect(card._layout.scene_previews).toEqual(original); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card.previewSceneLights).not.toHaveBeenCalled();
  });
  it('captures actual Kelvin within that light’s bounds, not a universal warm default', () => {
    const { editor, click } = setup({ layout: { scene_previews: saved() }, states: { 'light.lounge': rgbLight('on', { color_mode: 'color_temp', color_temp_kelvin: 4100 }) } });
    click('capture'); expect(editor.selected.lights[0].color).toEqual({ mode: 'kelvin', kelvin: 4100 });
  });
  it.each([
    ['unavailable', rgbLight('unavailable')], ['unknown', rgbLight('unknown')], ['restored', rgbLight('on', { restored: true })],
    ['malformed restored', rgbLight('on', { restored: 'false' })], ['missing brightness', rgbLight('on', { brightness: null })],
    ['missing colour', rgbLight('on', { rgb_color: null })],
  ])('rejects an all-or-nothing capture with %s evidence without changing any target', (name, state) => {
    const current = { ...item(), lights: [target(), { entity: 'light.off', state: 'off' }] };
    const { card, editor, click, host } = setup({ layout: { scene_previews: { enabled: true, items: [current] } }, states: { 'light.lounge': state } });
    const before = JSON.stringify(editor.selected); click('capture');
    expect(JSON.stringify(editor.selected)).toBe(before); expect(editor.dirty).toBe(false); expect(host.textContent.length).toBeGreaterThan(50);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('requires complete numeric targets and actual Kelvin limits, even while the real light is off', () => {
    const { editor, input, change, action, card } = setup({ layout: { scene_previews: saved() }, states: { 'light.lounge': rgbLight('off') } });
    change('light-color-mode', 'kelvin', 0); expect(input('light-kelvin', 0).value).toBe(''); expect(editor.selected.lights[0].color.kelvin).toBe('');
    expect(action('save').disabled).toBe(true); expect(input('light-kelvin', 0).min).toBe('2200'); expect(input('light-kelvin', 0).max).toBe('6400');
    change('light-kelvin', '2100', 0, 'input'); expect(action('save').disabled).toBe(true);
    change('light-kelvin', '6401', 0, 'input'); expect(action('save').disabled).toBe(true);
    change('light-kelvin', '3600', 0, 'input'); expect(action('save').disabled).toBe(false);
    change('light-brightness', '', 0, 'input'); expect(action('save').disabled).toBe(true);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('validates a changed item after switching to another row instead of saving a hidden invalid draft', () => {
    const { change, action, editor, card } = setup({ layout: { scene_previews: { enabled: true, items: [item(), { ...item('sleep', 'scene.bedtime'), label: 'Sleep' }] } } });
    change('light-brightness', '', 0, 'input'); change('binding', '1'); change('label', 'Bedtime');
    expect(action('save').disabled).toBe(true); editor.onClick('scene-preview-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('does not require a fake light target to save and activate a scene-only mapping', async () => {
    const { card, change, click, action } = setup(); change('enabled', true); click('add'); change('scene-entity', 'scene.movie'); click('save');
    expect(card._layout.scene_previews.items[0].lights).toEqual([]); expect(action('preview').disabled).toBe(true); expect(action('activate').disabled).toBe(false);
    click('activate'); await vi.waitFor(() => expect(card._hass.callService).toHaveBeenCalledOnce());
    expect(card._hass.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' });
  });
  it('keeps unknown scenes selectable without falsely labelling them unavailable', () => {
    const { input, action, card } = setup({ layout: { scene_previews: saved() } });
    const selected = [...input('scene-entity').options].find((option) => option.value === 'scene.movie');
    expect(selected.disabled).toBe(false); expect(selected.textContent).toContain('No activation time reported');
    expect(selected.textContent).not.toContain('Unavailable'); expect(action('activate').disabled).toBe(false);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('blocks deliberately added duplicate scene links instead of saving unusable runtime mappings', () => {
    const { change, click, action, card } = setup({ layout: { scene_previews: saved() } });
    click('add'); change('scene-entity', 'scene.movie'); expect(action('save').disabled).toBe(true);
    click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    change('scene-entity', 'scene.bedtime'); expect(action('save').disabled).toBe(false); click('save');
    expect(card._layout.scene_previews.items.map((item) => item.scene_entity)).toEqual(['scene.movie', 'scene.bedtime']);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('preserves malformed imported numeric values rather than silently coercing them during label edits', () => {
    const value = { enabled: true, items: [{ ...item(), lights: [{ ...target(), brightness: '120' }] }] };
    const { change, action, editor, card, click } = setup({ layout: { scene_previews: value } });
    change('label', 'Cinema'); expect(editor.selected.lights[0].brightness).toBe('120'); expect(action('save').disabled).toBe(true);
    change('light-brightness', '120', 0, 'input'); expect(editor.selected.lights[0].brightness).toBe(120); click('save');
    expect(card._layout.scene_previews.items[0].lights[0].brightness).toBe(120); expect(value.items[0].lights[0].brightness).toBe('120');
  });
  it('refreshes actual Kelvin bounds and revoked colour choices without replacing focused native controls', () => {
    const { card, editor, input, host, change, action } = setup({ layout: { scene_previews: saved() } });
    change('light-color-mode', 'kelvin', 0); const temperature = change('light-kelvin', '3600', 0, 'input'); temperature.focus();
    const mode = input('light-color-mode', 0);
    card._hass.states['light.lounge'] = rgbLight('on', { supported_color_modes: ['color_temp'], color_mode: 'color_temp', color_temp_kelvin: 3400,
      min_color_temp_kelvin: 3000, max_color_temp_kelvin: 4000 }); editor.updatePreviews(host);
    expect(input('light-kelvin', 0)).toBe(temperature); expect(document.activeElement).toBe(temperature); expect(temperature.value).toBe('3600');
    expect(temperature.min).toBe('3000'); expect(temperature.max).toBe('4000'); expect(host.textContent).toContain('3000–4000 K');
    expect(input('light-color-mode', 0)).toBe(mode); expect([...mode.options].some((option) => option.value === 'rgb' && !option.disabled)).toBe(false);
    card._hass.states['light.lounge'] = rgbLight('on', { supported_color_modes: ['brightness'], color_mode: 'brightness' }); editor.updatePreviews(host);
    expect(temperature.disabled).toBe(true); expect(temperature.hasAttribute('min')).toBe(false); expect(temperature.hasAttribute('max')).toBe(false);
    expect(host.textContent).toContain('Reported Kelvin limits are unavailable'); expect(action('save').disabled).toBe(true);
    expect(editor.selected.lights[0].color).toEqual({ mode: 'kelvin', kelvin: 3600 }); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('revokes the explicit RGB confirmation button on a source capability change and preserves the saved target', () => {
    const { card, editor, host, action, click } = setup({ layout: { scene_previews: saved() } });
    const savedTarget = JSON.stringify(editor.selected.lights[0]);
    card._hass.states['light.lounge'] = rgbLight('on', { supported_color_modes: ['brightness'], color_mode: 'brightness' }); editor.updatePreviews(host);
    expect(action('use-rgb', 0).disabled).toBe(true); click('use-rgb', 0); expect(JSON.stringify(editor.selected.lights[0])).toBe(savedTarget);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});

describe('preview lifecycle and deliberate saved-scene activation', () => {
  it('previews only explicit light appearances, then stops to latest real readings without any HA action', () => {
    const { card, editor, click, host } = setup({ layout: { scene_previews: saved() } }); const real = card._hass.states;
    click('preview'); const [overrides, info] = card.previewSceneLights.mock.calls[0];
    expect(overrides).toBeInstanceOf(Map); expect(overrides.get('light.lounge')).toMatchObject({ desiredOn: true, appearance: { status: 'preview', level: 120 / 255 } });
    expect(info.draft).toBe(true); expect(host.textContent).toContain('Home Assistant states have not changed'); expect(card._hass.states).toBe(real);
    card._hass = { ...card._hass, states: { ...real, 'light.lounge': rgbLight('off') } }; editor.updatePreviews(host); click('stop');
    expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); expect(card._hass.states['light.lounge'].state).toBe('off');
    expect(host.textContent).toContain('current Home Assistant light readings'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('opening, pointer hovering, editing, capture and Cancel never activate a scene', () => {
    const { card, editor, host, change, click } = setup({ layout: { scene_previews: saved() } });
    host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); host.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }));
    change('label', 'Preview only', undefined, 'input'); click('capture'); click('preview'); click('cancel');
    expect(editor.previewToken).toBeNull(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each(['setting', 'key', 'model', 'uploaded', 'position', 'user', 'connection'])('cancels preview and blocks stale Save after %s context changes', (kind) => {
    const { card, editor, host, click, change, action, input } = setup({ layout: { scene_previews: saved(), model: { version: 'old' } }, config: { model: '' } });
    change('label', 'Unfinished', undefined, 'input'); const field = input('label'); field.focus(); click('preview');
    if (kind === 'setting') card._layout.scene_previews = { ...saved(), future: 'changed' };
    if (kind === 'key') card._config.layout_key = 'another';
    if (kind === 'model') card._view.model = { root: {} };
    if (kind === 'uploaded') card._layout.model = { version: 'replacement-pending' };
    if (kind === 'position') card._layout.pins = { lamp: { x: 5, y: 2 } };
    if (kind === 'user') card._hass.user = { ...card._hass.user, id: 'other-admin' };
    if (kind === 'connection') { const connection = new EventTarget(); connection.connected = true; card._hass.connection = connection; }
    editor.updatePreviews(host); expect(editor.previewToken).toBeNull(); expect(card.previewSceneLights.mock.lastCall[0]).toBeNull();
    expect(input('label')).toBe(field); expect(field.value).toBe('Unfinished'); expect(action('save').disabled).toBe(true);
    editor.onClick('scene-preview-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
    click('cancel'); expect(input('label').value).toBe('Movie');
  });
  it.each(['capability', 'restored', 'hidden', 'missing', 'disconnected', 'permission'])('revokes a preview on %s and leaves source commands untouched', (kind) => {
    const { card, editor, host, click } = setup({ layout: { scene_previews: saved() } }); click('preview');
    if (kind === 'capability') card._hass.states['light.lounge'] = rgbLight('on', { supported_color_modes: ['brightness'], color_mode: 'brightness' });
    if (kind === 'restored') card._hass.states['light.lounge'] = rgbLight('on', { restored: true });
    if (kind === 'hidden') card._hass.entities['light.lounge'] = { hidden_by: 'user' };
    if (kind === 'missing') delete card._hass.states['light.lounge'];
    if (kind === 'disconnected') { card._hass.connection.connected = false; card._hass.connection.dispatchEvent(new Event('disconnected')); }
    if (kind === 'permission') card._hass.user.is_admin = false;
    editor.updatePreviews(host); expect(editor.previewToken).toBeNull(); expect(card.previewSceneLights.mock.lastCall[0]).toBeNull();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('retains exact focused native input and unsaved values on unrelated current HA state refreshes', () => {
    const { card, editor, host, change, input } = setup({ layout: { scene_previews: saved() } });
    const field = change('light-brightness', '99', 0, 'input'); field.focus();
    card._hass = { ...card._hass, states: { ...card._hass.states, 'sensor.other': { state: '2', attributes: {} } } }; editor.updatePreviews(host);
    expect(input('light-brightness', 0)).toBe(field); expect(document.activeElement).toBe(field); expect(field.value).toBe('99');
    expect(editor.selected.lights[0].brightness).toBe(99); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('uses the root visibility/loading gate both before previewing and while a draft preview is active', () => {
    const { card, editor, host, click, action } = setup({ layout: { scene_previews: saved() } });
    card._scenePreviewAvailable = vi.fn(() => false); editor.updatePreviews(host);
    expect(action('preview').disabled).toBe(true); editor.onClick('scene-preview-preview'); expect(card.previewSceneLights).not.toHaveBeenCalled();
    card._scenePreviewAvailable.mockReturnValue(true); editor.updatePreviews(host); click('preview');
    expect(card.previewSceneLights.mock.lastCall[0]).toBeInstanceOf(Map); expect(card._scenePreviewAvailable).toHaveBeenCalledWith(true);
    card._scenePreviewAvailable.mockReturnValue(false); editor.updatePreviews(host);
    expect(editor.previewToken).toBeNull(); expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); expect(action('preview').disabled).toBe(true);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('rejects a detached old field after selecting another preview and allows clearing selection deliberately', () => {
    const { editor, change, input, card } = setup({ layout: { scene_previews: { enabled: true, items: [item(), { ...item('sleep', 'scene.bedtime'), label: 'Sleep' }] } } });
    const old = input('label'); change('binding', '1'); old.value = 'Old row'; editor.onInput('scene-preview-label', old);
    expect(editor.selected.label).toBe('Sleep'); change('binding', ''); expect(editor.selected).toBeUndefined();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps missing sources as exact read-only choices until explicit relink/removal', () => {
    const { card, editor, input, change, click } = setup({ layout: { scene_previews: { enabled: true, items: [{ ...item(), lights: [{ entity: 'light.deleted', state: 'off', future: 8 }] }] } } });
    expect(input('light-entity', 0).value).toBe('light.deleted'); expect(input('light-state', 0).disabled).toBe(true);
    expect([...input('light-entity', 0).options].find((option) => option.value === 'light.deleted').disabled).toBe(true);
    change('light-entity', 'light.off', 0); expect(editor.selected.lights[0]).toEqual({ entity: 'light.off', state: 'off', future: 8 });
    click('save'); expect(card._layout.scene_previews.items[0].lights[0].entity).toBe('light.off'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('activates a valid saved scene independently of incomplete light targets, with exact one payload', async () => {
    const { card, click, action } = setup({ layout: { scene_previews: { enabled: true, items: [{ ...item(), lights: [{ entity: 'light.missing', state: 'on' }] }] } } });
    expect(action('preview').disabled).toBe(true); expect(action('activate').disabled).toBe(false); click('activate');
    await vi.waitFor(() => expect(card._hass.callService).toHaveBeenCalledOnce());
    expect(card._hass.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' }); expect(card.previewSceneLights).not.toHaveBeenCalled();
  });
  it('permits saved-scene activation for a current authenticated nonadministrator while keeping editing/capture/draft disabled', async () => {
    const { card, click, input, editor } = setup({ layout: { scene_previews: saved() }, admin: false });
    expect(input('label').disabled).toBe(true); editor.onClick('scene-preview-capture'); editor.onClick('scene-preview-preview');
    expect(card.previewSceneLights).not.toHaveBeenCalled(); click('activate'); await vi.waitFor(() => expect(card._hass.callService).toHaveBeenCalledOnce());
  });
  it.each(['disabled', 'removed scene', 'restored scene', 'service', 'connection', 'changed draft scene'])('rejects intentional Activate when %s is invalid at the moment of action', (kind) => {
    const { card, editor, change } = setup({ layout: { scene_previews: saved() } });
    if (kind === 'disabled') card._layout.scene_previews.enabled = false;
    if (kind === 'removed scene') delete card._hass.states['scene.movie'];
    if (kind === 'restored scene') card._hass.states['scene.movie'].attributes.restored = true;
    if (kind === 'service') card._hass.services = {};
    if (kind === 'connection') card._hass.connection.connected = false;
    if (kind === 'changed draft scene') change('scene-entity', 'scene.bedtime');
    editor.onClick('scene-preview-activate'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('blocks a relink performed by a synchronous preview removal callback before Activate', async () => {
    const { card, editor, click } = setup({ layout: { scene_previews: saved() } }); click('preview');
    card.previewSceneLights.mockImplementation((map) => { if (map === null) card._layout.scene_previews = { enabled: true, items: [{ ...item(), scene_entity: 'scene.bedtime' }] }; });
    editor.onClick('scene-preview-activate'); await Promise.resolve(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps pending/error state honest, prevents duplicate service calls and never retries automatically', async () => {
    let reject; const { card, editor, click, action, host } = setup({ layout: { scene_previews: saved() } });
    card._hass.callService.mockImplementationOnce(() => new Promise((resolve, rejection) => { reject = rejection; }));
    click('activate'); expect(action('activate').disabled).toBe(true); editor.onClick('scene-preview-activate'); expect(card._hass.callService).toHaveBeenCalledOnce();
    reject(new Error('Permission denied by HA')); await vi.waitFor(() => expect(host.textContent).toContain('Permission denied by HA'));
    expect(card._hass.callService).toHaveBeenCalledOnce(); expect(action('activate').disabled).toBe(false);
  });
  it('does not attach an old activation reply to a new editor context after Cancel', async () => {
    let resolve; const { card, editor, click, host, change } = setup({ layout: { scene_previews: saved() } });
    card._hass.callService.mockImplementationOnce(() => new Promise((done) => { resolve = done; })); click('activate');
    expect(card._hass.callService).toHaveBeenCalledOnce(); click('cancel'); change('label', 'New draft');
    resolve(); await Promise.resolve(); await Promise.resolve();
    expect(editor.activationPending).toBe(false); expect(editor.message).toBeNull(); expect(host.textContent).not.toContain('Scene activation accepted');
    expect(editor.selected.label).toBe('New draft'); expect(card._hass.callService).toHaveBeenCalledOnce();
  });
  it('reset and disposal remove only local appearance without retaining or rewriting real HA states', () => {
    const { card, editor, click, render } = setup({ layout: { scene_previews: saved() } }); click('preview'); editor.reset(); render();
    expect(editor.previewToken).toBeNull(); expect(card.previewSceneLights.mock.lastCall[0]).toBeNull();
    click('preview'); editor.dispose(); expect(card.previewSceneLights.mock.lastCall[0]).toBeNull(); expect(editor.render()).toBe('');
    expect(editor.onClick('scene-preview-activate')).toBe(false); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
