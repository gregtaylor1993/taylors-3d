// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloorPresentationEditor } from '../src/floor-presentation-editor.js';
import { readFloorPresentation } from '../src/floor-presentation.js';

const editors = [];
const floorList = () => [{ id: 'upper', name: 'First floor', elevation: 3 }, { id: 'ground', name: 'Ground floor', elevation: 0 }];
const policy = (extra = {}) => ({ mode: 'horizontal', floors: ['ground', 'upper'], gap_m: 2, axis: 'east', base_elevation_m: 0, ...extra });
function setup({ layout = {}, config = {}, floors = floorList(), report, connected = true } = {}) {
  const card = { isConnected: connected, _editing: true, _edit: { tab: 'model' },
    _config: { layout_key: 'house', ...config }, _layout: { rooms: [], ...layout }, _floors: floors,
    _view: { model: null }, _mb: null, _modelAlign: () => ({ position: [0, 0, 0], rotation: 0, scale: 1 }),
    _hass: { user: { id: 'taylor', is_admin: true, is_active: true }, connection: { connected: true },
      states: {}, callService: vi.fn(), callWS: vi.fn() },
    commitFeatureLayout: vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; }),
  };
  if (report !== undefined) card.floorPresentationReport = vi.fn(() => report);
  const host = document.createElement('div'); document.body.append(host);
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  const editor = new FloorPresentationEditor(card, render); editors.push(editor);
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => editor.onClick(event.target.closest('[data-act]')?.dataset.act));
  render();
  const field = (key) => host.querySelector(`[data-field="floor-presentation-${key}"]`);
  const button = (key) => host.querySelector(`[data-act="floor-presentation-${key}"]`);
  const change = (key, value, type = 'input') => { const element = field(key); element.value = value;
    element.dispatchEvent(new Event(type, { bubbles: true })); return element; };
  const click = (key) => button(key).click();
  const rowButton = (index, key) => host.querySelector(`[data-floor-presentation-row="${index}"] [data-act^="floor-presentation-${key}:"]`);
  const replace = (index, id) => { const element = host.querySelector(`[data-floor-presentation-row="${index}"] select`);
    element.value = id; element.dispatchEvent(new Event('change', { bubbles: true })); };
  return { card, editor, host, render, field, button, change, click, rowButton, replace };
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); });

describe('draft-only floor presentation fragment', () => {
  it('opens assembled defaults without calls, writes, guessed floor links or renderer claims', () => {
    const { card, field, host, button, click } = setup();
    expect(field('mode').value).toBe('assembled'); expect(field('axis').value).toBe('east');
    expect(field('gap_m').value).toBe('2'); expect(field('base_elevation_m').value).toBe('0');
    expect(host.textContent).toContain('Using all current floors in elevation order');
    expect(host.querySelector('[data-floor-presentation-row="0"]').textContent).toContain('ground');
    expect(host.textContent).toContain('Renderer checks are not connected');
    expect(button('save').disabled).toBe(true); click('cancel');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it.each(['assembled', 'horizontal', 'vertical'])('saves %s once, with one history label and no draft geometry changes', (mode) => {
    const { card, change, click } = setup({ layout: { floor_presentation: policy() } });
    const root = { position: { x: 0, y: 0, z: 0 }, matrix: [1, 0, 0, 1] }; card._view.model = { root };
    // Clean reload accepts the current model before drafting.
    change('gap_m', '3.75'); change('mode', mode, 'change'); change('axis', 'north', 'change'); change('base_elevation_m', '-1.25');
    expect(root).toEqual({ position: { x: 0, y: 0, z: 0 }, matrix: [1, 0, 0, 1] });
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); click('save'); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledExactlyOnceWith({ floor_presentation: policy({ mode, gap_m: 3.75, axis: 'north', base_elevation_m: -1.25 }) }, 'Floor presentation');
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('uses layout before YAML and retains untouched nested extensions', () => {
    const saved = policy({ future: { source: ['custom', 4] } }), yaml = policy({ axis: 'north', yamlExtra: 5 });
    const { card, field, change, click } = setup({ layout: { floor_presentation: saved }, config: { floor_presentation: yaml } });
    expect(field('axis').value).toBe('east'); change('gap_m', '7'); click('save');
    expect(card._layout.floor_presentation).toEqual({ ...saved, gap_m: 7 }); expect(saved.gap_m).toBe(2);
    expect(card._config.floor_presentation).toEqual(yaml);
  });
  it('inherits YAML without rewriting it on open or Cancel', () => {
    const yaml = policy({ future: { keep: true } }); const { card, change, click } = setup({ config: { floor_presentation: yaml } });
    change('gap_m', '8'); click('cancel'); expect(card._layout.floor_presentation).toBeUndefined();
    expect(card._config.floor_presentation).toEqual(yaml); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    change('gap_m', '9'); click('save'); expect(card._layout.floor_presentation.future).toEqual(yaml.future);
  });
  it('Cancel discards exact draft order and scalar changes', () => {
    const saved = policy({ gap_m: 2.125, future: 8 }); const { card, change, click, rowButton, field } = setup({ layout: { floor_presentation: saved } });
    rowButton(1, 'up').click(); change('gap_m', '9'); click('cancel');
    expect(field('gap_m').value).toBe('2.125'); expect(card._layout.floor_presentation).toEqual(saved);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('keeps current floor IDs in an explicit order without changing source elevations', () => {
    const floors = floorList(), before = structuredClone(floors); const { card, rowButton, change, click } = setup({ floors });
    rowButton(1, 'up').click(); change('mode', 'vertical', 'change'); click('save');
    expect(card._layout.floor_presentation.floors).toEqual(['upper', 'ground']); expect(floors).toEqual(before);
  });
  it('removes, adds and relinks deliberate exact IDs rather than matching floor names', () => {
    const floors = [...floorList(), { id: 'attic:3', name: 'First floor', elevation: 6 }];
    const { card, rowButton, change, replace, click } = setup({ floors, layout: { floor_presentation: policy() } });
    rowButton(1, 'remove').click(); change('add-floor', 'attic:3', 'change'); replace(1, 'upper'); click('save');
    expect(card._layout.floor_presentation.floors).toEqual(['ground', 'upper']);
    // Only a changed scalar creates a new saved edit when order returns to base.
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); change('gap_m', '4'); click('save');
    expect(card._layout.floor_presentation.floors).toEqual(['ground', 'upper']);
  });
  it('rejects stale row events after reordering, including a floor ID containing punctuation', () => {
    const saved = policy({ floors: ['ground', 'up:per'] }); const floors = [{ id: 'ground', elevation: 0 }, { id: 'up:per', elevation: 3 }];
    const { editor, rowButton } = setup({ layout: { floor_presentation: saved }, floors });
    const oldAction = rowButton(0, 'remove').dataset.act; rowButton(1, 'up').click(); editor.onClick(oldAction);
    expect(editor.draft.floors).toEqual(['up:per', 'ground']);
  });
  it('preserves unavailable references until a deliberate replacement or assembled choice', () => {
    const saved = policy({ floors: ['ground', 'missing-floor'], future: { keep: 'yes' } });
    const { card, host, button, replace, click, change } = setup({ layout: { floor_presentation: saved } });
    expect(host.textContent).toContain('Saved floor is missing'); expect(button('save').disabled).toBe(true);
    change('gap_m', '3'); expect(button('save').disabled).toBe(true); click('cancel');
    expect(card._layout.floor_presentation).toEqual(saved); replace(1, 'upper'); click('save');
    expect(card._layout.floor_presentation.floors).toEqual(['ground', 'upper']);
    card._layout.floor_presentation = saved; click('cancel'); change('mode', 'assembled', 'change'); click('save');
    expect(card._layout.floor_presentation).toEqual({ ...saved, mode: 'assembled' });
  });
  it.each([
    { id: 'upper', elevation: undefined }, { id: 'upper', elevation: '3' }, { id: 'upper', elevation: NaN },
    { id: 'upper', elevation: 3, stale: true }, { id: 'upper', elevation: 3, stale: null },
  ])('blocks separated Save with invalid current floor evidence %j', (upper) => {
    const { card, change, button, click } = setup({ floors: [{ id: 'ground', elevation: 0 }, upper] });
    change('mode', 'vertical', 'change'); expect(button('save').disabled).toBe(true); click('save');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('blocks ambiguous floor IDs and automatic selections over four', () => {
    const { card, change, editor, host, click } = setup({ floors: [{ id: 'ground', elevation: 0 }, { id: 'ground', elevation: 3 }] });
    change('mode', 'vertical', 'change'); expect(host.textContent).toContain('ambiguous'); click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('cancel'); card._floors = Array.from({ length: 5 }, (_, index) => ({ id: `floor-${index}`, elevation: index * 3 }));
    editor.updatePreviews(host); change('mode', 'horizontal', 'change'); expect(host.textContent).toContain('at most 4 floors');
    click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('never substitutes saved layout floors when current resolved floors are absent', () => {
    const { card, change, click } = setup({ floors: undefined, layout: { floors: floorList() } });
    card._floors = undefined; change('mode', 'horizontal', 'change'); click('save');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); change('mode', 'assembled', 'change'); change('gap_m', '3'); click('save');
    expect(card._layout.floor_presentation.mode).toBe('assembled');
  });
  it('can save a valid request despite unavailable geometry, with honest current diagnostics', () => {
    const report = { mode: 'assembled', requestedMode: 'horizontal', valid: false,
      diagnostics: [{ code: 'confirm_floor_link', message: 'Confirm the exact model floor links.' }, { code: 'missing_bounds', message: 'No real room outline.', floor_id: 'upper' }] };
    const { card, host, change, click } = setup({ report }); change('mode', 'horizontal', 'change'); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(host.textContent).toContain('saving a valid request does not prove');
    expect(host.textContent).toContain('Confirm the exact model floor links'); expect(host.textContent).toContain('No real room outline');
  });
  it.each([null, [], 'vertical', { mode: 'exploded', future: 4 }, { gap_m: '2', future: 4 }, { axis: 'west', future: 4 },
    { base_elevation_m: true, future: 4 }, { floors: null, future: 4 }, { floors: [false], future: 4 }, { floors: ['ground', 'ground'], future: 4 }])('requires explicit repair for malformed settings %j', (saved) => {
    const { card, editor, button, click } = setup({ config: { floor_presentation: saved } });
    expect(button('save').disabled).toBe(true); click('cancel'); expect(card._config.floor_presentation).toEqual(saved);
    click('repair'); expect(readFloorPresentation(editor.draft).valid).toBe(true); expect(editor.draft).not.toHaveProperty('floors');
    click('save'); expect(card._layout.floor_presentation).toMatchObject({ mode: 'assembled', gap_m: 2, axis: 'east', base_elevation_m: 0 });
    if (saved?.future) expect(card._layout.floor_presentation.future).toBe(4);
  });
  it('does not silently erase present malformed undefined settings when another field changes', () => {
    const saved = { gap_m: undefined, future: { keep: true } }; const { card, editor, change, button, click } = setup({ config: { floor_presentation: saved } });
    expect(Object.hasOwn(editor.draft, 'gap_m')).toBe(true); change('mode', 'vertical', 'change'); expect(button('save').disabled).toBe(true);
    click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); change('gap_m', '2'); click('save');
    expect(card._layout.floor_presentation).toEqual({ ...saved, gap_m: 2, mode: 'vertical' });
  });
  it.each([['gap_m', ''], ['gap_m', '-1'], ['gap_m', '101'], ['base_elevation_m', '-1001'], ['base_elevation_m', '1001']])('blocks invalid or blank %s=%j', (key, value) => {
    const { card, change, button, click } = setup(); change(key, value); expect(button('save').disabled).toBe(true); click('save');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('requires a floor after clearing split choices and can restore automatic order deliberately', () => {
    const { card, change, click, button } = setup(); change('mode', 'vertical', 'change'); click('clear-floors');
    expect(button('save').disabled).toBe(true); click('all-floors'); click('save');
    expect(card._layout.floor_presentation.mode).toBe('vertical'); expect(card._layout.floor_presentation).not.toHaveProperty('floors');
  });
  it.each(['card', 'connection', 'admin', 'inactive', 'blank-id', 'no-id', 'tab'])('rejects direct Save while %s eligibility is invalid', (kind) => {
    const { card, editor, change, host } = setup(); change('gap_m', '3');
    if (kind === 'card') card.isConnected = false;
    if (kind === 'connection') card._hass.connection.connected = false;
    if (kind === 'admin') card._hass.user.is_admin = false;
    if (kind === 'inactive') card._hass.user.is_active = false;
    if (kind === 'blank-id') card._hass.user.id = '   ';
    if (kind === 'no-id') delete card._hass.user.id;
    if (kind === 'tab') card._edit.tab = 'rooms';
    editor.updatePreviews(host); editor.onClick('floor-presentation-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each(['settings', 'key', 'root', 'source', 'alignment', 'floors', 'rooms', 'levels', 'user', 'session', 'auth', 'permission', 'connection', 'active'])('latches dirty %s context changes through recovery until Cancel', (kind) => {
    const { card, editor, change, host, button, click } = setup(); change('gap_m', '3'); const original = editor.draft;
    const restore = {
      settings: () => { card._layout.floor_presentation = undefined; }, key: () => { card._config.layout_key = 'house'; },
      root: () => { card._view.model = null; }, source: () => { delete card._config.model; },
      alignment: () => { delete card._config.model_rotation; }, floors: () => { card._floors = floorList(); },
      rooms: () => { card._layout.rooms = []; }, levels: () => { card._mb = null; },
      user: () => { card._hass.user.id = 'taylor'; }, session: () => { card._hass.connection = previousConnection; },
      auth: () => { delete card._hass.auth; }, permission: () => { card._hass.user.is_admin = true; },
      connection: () => { card._hass.connection.connected = true; }, active: () => { card._hass.user.is_active = true; },
    };
    const previousConnection = card._hass.connection;
    if (kind === 'settings') card._layout.floor_presentation = policy();
    if (kind === 'key') card._config.layout_key = 'other';
    if (kind === 'root') card._view.model = { root: {} };
    if (kind === 'source') card._config.model = '/local/new.glb';
    if (kind === 'alignment') card._config.model_rotation = 30;
    if (kind === 'floors') card._floors[0].elevation = 4;
    if (kind === 'rooms') card._layout.rooms = [{ floor_id: 'ground', polygon: [[0, 0], [1, 0], [1, 1]] }];
    if (kind === 'levels') card._mb = { levels: { level: { floor: 'upper', auto: false } } };
    if (kind === 'user') card._hass.user.id = 'other-admin';
    if (kind === 'session') card._hass.connection = { connected: true };
    if (kind === 'auth') card._hass.auth = {};
    if (kind === 'permission') card._hass.user.is_admin = false;
    if (kind === 'connection') card._hass.connection.connected = false;
    if (kind === 'active') card._hass.user.is_active = false;
    editor.updatePreviews(host); restore[kind](); editor.updatePreviews(host);
    expect(editor.stale).toBe(true); expect(editor.draft).toBe(original); expect(button('save').disabled).toBe(true);
    editor.onClick('floor-presentation-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('cancel'); change('gap_m', '4'); click('save'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
  });
  it('accepts omitted is_active compatibility but rejects explicit malformed activity flags', () => {
    const { card, editor, host, change, click } = setup(); delete card._hass.user.is_active; editor.updatePreviews(host); change('gap_m', '3'); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
    for (const value of [undefined, null, 0, 'true', {}]) { card._hass.user.is_active = value; editor.reset(); editor.updatePreviews(host); expect(editor.canEdit).toBe(false); }
  });
  it('keeps focused scalar and floor native controls stable through unrelated HA updates', () => {
    const { card, editor, host, change, field } = setup({ layout: { floor_presentation: policy() } });
    const gap = change('gap_m', '2.125'); gap.focus();
    card._hass = { ...card._hass, states: { 'sensor.temperature': { state: '17' } } }; editor.updatePreviews(host);
    expect(field('gap_m')).toBe(gap); expect(document.activeElement).toBe(gap); expect(gap.value).toBe('2.125');
    const select = field('floor'); select.focus(); editor.updatePreviews(host);
    expect(field('floor')).toBe(select); expect(document.activeElement).toBe(select); expect(editor.stale).toBe(false);
    card._floors.find((floor) => floor.id === 'ground').name = 'Renamed current floor'; editor.updatePreviews(host);
    expect(field('floor')).toBe(select); expect(document.activeElement).toBe(select); expect(editor.stale).toBe(false);
    expect(host.querySelector('[data-floor-presentation-row="0"] strong').textContent).toBe('Renamed current floor');
  });
  it('matches core automatic ordering by elevation then exact ID, independent of browser locale', () => {
    const { editor } = setup({ floors: [{ id: 'a', elevation: 0 }, { id: 'Z', elevation: 0 }] });
    expect(editor._rows()).toEqual(['Z', 'a']);
  });
  it('refreshes clean saved policy after history restoration through reset', () => {
    const { card, editor, host, change, click, field } = setup({ layout: { floor_presentation: policy() } });
    change('mode', 'vertical', 'change'); click('save'); card._layout.floor_presentation = policy(); editor.reset(); editor.updatePreviews(host);
    expect(field('mode').value).toBe('horizontal'); card._layout.floor_presentation = policy({ mode: 'vertical' }); editor.reset(); editor.updatePreviews(host);
    expect(field('mode').value).toBe('vertical'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
  });
  it('escapes model diagnostics and floor labels and provides scoped theme/touch/focus rules', () => {
    const attack = '<img src=x onerror=alert(1)>'; const { host } = setup({ floors: [{ id: 'ground', name: attack, elevation: 0 }],
      report: { diagnostics: [{ message: attack, floor_id: attack }] } });
    expect(host.textContent).toContain(attack); expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('style').textContent).toContain('min-height:44px');
    expect(host.querySelector('style').textContent).toContain('var(--ha-card-background,var(--card-background-color');
    expect(host.querySelector('style').textContent).toContain(':focus-visible'); expect(host.querySelector('style').textContent).toContain('min-width:0');
  });
  it('does not route unrelated events and disposes without listeners, timers or later writes', () => {
    const { editor, card, host } = setup(); expect(editor.onClick('other-save')).toBe(false); expect(editor.onChange('other-field', {})).toBe(false);
    editor.dispose(); editor.updatePreviews(host); expect(editor.render()).toBe('');
    expect(editor.onClick('floor-presentation-save')).toBe(false); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
});
