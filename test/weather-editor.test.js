// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeatherEditor } from '../src/weather-editor.js';
import { EditHistory } from '../src/history.js';

const weatherState = (name, state = 'rainy', attributes = {}) => ({ state, attributes: { friendly_name: name, ...attributes } });
const saved = { enabled: true, entity: 'weather.home', effects: ['rain', 'clouds', 'snow'], intensity: 0.6, quality: 'low' };
const room = (id, outdoor, polygon, floorId = 'ground') => ({ room: { id, outdoor, polygon, floor_id: floorId }, floorId });
function setup({ layout = {}, config = {}, states = {}, entities = {}, devices = {}, admin = true, rooms, footprints, cardElement } = {}) {
  const card = Object.assign(cardElement || {}, {
    _layout: { pins: { lamp: { x: 2, y: 1 } }, ...layout }, _config: { layout_key: 'default', ...config },
    _hass: { states: { 'weather.home': weatherState('Home weather'), 'weather.garden': weatherState('Garden weather', 'cloudy'),
      'sun.sun': { state: 'above_horizon', attributes: { elevation: 30, azimuth: 90 } }, 'sensor.rain': { state: '1', attributes: {} }, ...states },
    entities, devices, user: { is_admin: admin }, config: { latitude: 51.5, longitude: -0.1, time_zone: 'Europe/London' }, callService: vi.fn() },
    _floors: [{ id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'first', name: 'First floor', elevation: 3 }],
    _roomList: rooms || [room('garden', true, [[0, 0], [8, 0], [8, 6], [0, 6]]), room('lounge', false, [[2, 1], [6, 1], [6, 5], [2, 5]])],
    previewWeather: vi.fn(), _history: new EditHistory(),
  });
  if (footprints) card.weatherFootprints = vi.fn(() => footprints);
  card._history.reset({ layout: card._layout, config: card._config });
  card.commitFeatureLayout = vi.fn((patch) => {
    card._layout = { ...card._layout, ...patch };
    card._history.record({ layout: card._layout, config: card._config }, 'Edit weather');
  });
  const host = document.createElement('div'); document.body.append(host);
  const editor = new WeatherEditor(card, () => { host.innerHTML = editor.render(); });
  host.addEventListener('change', (event) => editor.handleChange(event));
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => editor.handleClick(event));
  host.innerHTML = editor.render();
  const input = (field) => host.querySelector(`[data-field="env-weather-${field}"]`);
  const change = (field, value, type = 'change') => {
    const element = input(field); expect(element).toBeTruthy();
    if (element.type === 'checkbox') element.checked = value; else element.value = value;
    element.dispatchEvent(new Event(type, { bubbles: true }));
  };
  const click = (action) => { const element = host.querySelector(`[data-act="env-weather-${action}"]`); expect(element).toBeTruthy(); element.click(); };
  const configure = () => { change('entity', 'weather.home'); change('enabled', true); };
  return { card, editor, host, input, change, click, configure };
}
afterEach(() => document.body.replaceChildren());

describe('visual weather configuration', () => {
  it.each([
    ['wrong current entity ID', { state: 'rainy', entity_id: 'sensor.explicit_wrong_domain', attributes: {} }],
    ['non-string state', { state: 12, attributes: {} }],
    ['array current state', ['rainy']],
    ['array current attributes', { state: 'rainy', attributes: ['rainy'] }],
    ['null current attributes', { state: 'rainy', attributes: null }],
  ])('rejects a %s as a new weather source while retaining its exact saved ID as a disabled choice', (_, malformed) => {
    const sourceId = 'weather.malformed_exact', states = { [sourceId]: malformed };
    const fresh = setup({ states });
    expect(fresh.editor.sourceChoices.some((entry) => entry.value === sourceId)).toBe(false);
    // A synthetic option cannot make an invalid source eligible for a native change.
    const forged = document.createElement('option'); forged.value = sourceId; fresh.input('entity').append(forged);
    fresh.change('entity', sourceId);
    expect(fresh.editor.draft.entity).toBe(''); expect(fresh.editor.dirty).toBe(false);
    const imported = { ...saved, entity: sourceId, extra: { retained: 'raw_import' } };
    const existing = setup({ layout: { weather: imported }, states });
    const option = [...existing.input('entity').options].find((entry) => entry.value === sourceId);
    expect(option).toBeDefined(); expect(option.disabled).toBe(true); expect(existing.input('entity').value).toBe(sourceId);
    existing.change('quality', 'static'); existing.click('save');
    expect(existing.card._layout.weather).toBe(imported); expect(existing.editor.draft.entity).toBe(sourceId);
    for (const ctx of [fresh, existing]) { expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._hass.callService).not.toHaveBeenCalled(); }
  });

  it('keeps explicit matching or absent current entity IDs, unknown/unavailable and restored weather selectable without claiming a current reading', () => {
    const { editor, card } = setup({ states: {
      'weather.matching': { entity_id: 'weather.matching', state: 'rainy', attributes: {} },
      'weather.no_attributes': { state: 'rainy' },
      'weather.unknown': weatherState('Unknown source', 'unknown'),
      'weather.offline': weatherState('Offline source', 'unavailable'),
      'weather.restored': weatherState('Stored source', 'rainy', { restored: true }),
      'weather.restored_malformed': weatherState('Stored malformed flag', 'rainy', { restored: 'false' }),
    } });
    const choices = new Map(editor.sourceChoices.map((entry) => [entry.value, entry]));
    for (const id of ['matching', 'no_attributes', 'unknown', 'offline', 'restored', 'restored_malformed']) expect(choices.get(`weather.${id}`)?.selectable).toBe(true);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('starts off with no guessed source and filters selectable entities while retaining offline weather', () => {
    const { input, card, host } = setup({ states: {
      'weather.hidden': weatherState('Hidden'), 'weather.diagnostic': weatherState('Diagnostic'),
      'weather.disabled': weatherState('Disabled'), 'weather.offline': weatherState('Offline', 'unavailable'),
    }, entities: { 'weather.hidden': { hidden_by: 'user' }, 'weather.diagnostic': { entity_category: 'diagnostic' }, 'weather.disabled': { device_id: 'disabled' } }, devices: { disabled: { disabled_by: 'user' } } });
    expect(input('enabled').checked).toBe(false); expect(input('entity').value).toBe('');
    const choices = [...input('entity').options].map((option) => option.value);
    expect(choices).toEqual(['', 'weather.garden', 'weather.home', 'weather.offline']);
    expect(host.textContent).toContain('not a measured rain or snow rate');
    expect(host.textContent).toContain('mark it Outdoor'); expect(host.textContent).toContain('balcony');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card.previewWeather).not.toHaveBeenCalled();
  });

  it('uses the layout override, otherwise card fallback, without mutating either during drafts', () => {
    const fallback = { ...saved, quality: 'medium', intensity: 0.8 };
    const ctx = setup({ config: { weather: fallback }, layout: { weather: { ...saved, intensity: 0.3 } } });
    expect(ctx.input('intensity').value).toBe('0.3');
    ctx.change('intensity', '0.45', 'input');
    expect(ctx.card._layout.weather.intensity).toBe(0.3); expect(fallback.intensity).toBe(0.8);
    delete ctx.card._layout.weather; ctx.editor.reset(); ctx.host.innerHTML = ctx.editor.render();
    expect(ctx.input('quality').value).toBe('medium'); expect(ctx.input('intensity').value).toBe('0.8');
  });

  it('saves one layout/history change, preserves unknown settings and unrelated data, and Undo restores the saved source', () => {
    const original = { ...saved, future_setting: { retained: true } };
    const { card, change, click, editor, host } = setup({ layout: { weather: original } });
    const pins = card._layout.pins;
    change('entity', 'weather.garden'); change('intensity', '0.8', 'input');
    change('quality', 'static'); change('effect-rain', false); change('effect-snow', false);
    expect(card._history.size).toBe(0); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledTimes(1); expect(card._history.size).toBe(1);
    expect(card._layout.weather).toEqual({ ...original, entity: 'weather.garden', intensity: 0.8, quality: 'static', effects: ['clouds'] });
    expect(card._layout.pins).toBe(pins); expect(original.entity).toBe('weather.home');
    const snapshot = card._history.undo(); card._layout = snapshot.layout; card._config = snapshot.config; editor.reset(); host.innerHTML = editor.render();
    expect(editor.draft.entity).toBe('weather.home'); expect(card._layout.weather.intensity).toBe(0.6);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card.previewWeather).not.toHaveBeenCalled();
  });

  it('Cancel/reset/Undo/context changes discard unsaved values without a commit or renderer preview', () => {
    const { editor, change, click, card, host, input } = setup({ layout: { weather: saved } });
    change('intensity', '0.9', 'input'); change('effect-rain', false); click('cancel');
    expect(input('intensity').value).toBe('0.6'); expect(input('effect-rain').checked).toBe(true);
    change('intensity', '0.25', 'input'); editor.reset(); card._layout = { weather: { ...saved, entity: 'weather.garden', quality: 'static' } }; host.innerHTML = editor.render();
    expect(input('entity').value).toBe('weather.garden'); expect(input('intensity').value).toBe('0.6');
    expect(editor.dirty).toBe(false); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card.previewWeather).not.toHaveBeenCalled();
  });

  it('records numeric text on input before change/blur and preserves the actual focused control across HA updates', () => {
    const { input, editor, card, host, change, click } = setup({ layout: { weather: saved } });
    const intensity = input('intensity'); intensity.focus();
    change('intensity', '0.37', 'input');
    card._hass.states['weather.home'] = weatherState('Home weather', 'snowy');
    card._hass.states['sensor.unrelated'] = { state: '99', attributes: {} };
    editor.afterUpdate(host);
    expect(input('intensity')).toBe(intensity); expect(document.activeElement).toBe(intensity);
    expect(intensity.value).toBe('0.37'); expect(editor.draft.intensity).toBe('0.37'); expect(host.textContent).toContain('Snowy');
    click('save'); expect(card._layout.weather.intensity).toBe(0.37);
  });

  it('updates choices/labels without replacing a focused select or selecting the first entity', () => {
    const { input, editor, card, host } = setup({ layout: { weather: saved } });
    const source = input('entity'), selected = [...source.options].find((option) => option.value === 'weather.home');
    source.focus(); card._hass.states['weather.home'].attributes.friendly_name = 'Changed home name';
    card._hass.states['weather.added'] = weatherState('Added source'); editor.updatePreviews(host);
    expect(input('entity')).toBe(source); expect(document.activeElement).toBe(source);
    expect(source.value).toBe('weather.home'); expect([...source.options].find((option) => option.value === 'weather.home')).toBe(selected);
    expect(selected.textContent).toBe('Changed home name'); expect([...source.options].map((option) => option.value)).toContain('weather.added');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });

  it.each(['', '-0.1', '1.1', 'Infinity', 'not-a-number'])('rejects invalid intensity text %s without saving', (value) => {
    const { configure, change, click, card, host } = setup(); configure();
    change('intensity', value, 'input'); click('save');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(host.textContent).toContain('nothing has been saved');
    expect(host.textContent).toContain('intensity from 0 to 1'); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each(['0.6', true, false, '', ' ', null, ['0.6'], { value: .6 }])('does not repair imported intensity %j when changing quality alone', (intensity) => {
    const original = { ...saved, intensity };
    const { editor, change, click, card, host } = setup({ layout: { weather: original } });
    expect(editor._evaluation().reading.status).toBe('invalid');
    change('quality', 'static'); click('save');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._layout.weather).toBe(original); expect(editor.draft.intensity).toEqual(intensity);
    expect(host.textContent).toContain('nothing has been saved'); expect(host.textContent).toContain('intensity from 0 to 1');
    expect(card._history.size).toBe(0); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('requires an explicit valid intensity repair, and that repair is cleared by Cancel or reset', () => {
    const original = { ...saved, intensity: '0.6' };
    const { editor, change, click, card, host } = setup({ layout: { weather: original } });
    change('intensity', '.4', 'input'); click('cancel');
    change('quality', 'static'); click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    change('intensity', '.4', 'input'); editor.reset(); host.innerHTML = editor.render();
    change('quality', 'static'); click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    change('intensity', '.4', 'input'); click('save');
    expect(card._layout.weather).toEqual({ ...saved, quality: 'static', intensity: .4 });
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(card._history.size).toBe(1);
    expect(original.intensity).toBe('0.6'); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each([
    { effects: ['rain', 'unsupported'] }, { effects: 'rain' }, { enabled: 'true' }, { intensity: '0.6' },
  ])('preserves other untouched imported invalid fields %j until their setting is repaired', (invalid) => {
    const original = { ...saved, ...invalid };
    const { change, click, card, editor } = setup({ layout: { weather: original } });
    change('quality', 'static'); click('save');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._layout.weather).toBe(original);
    for (const [field, value] of Object.entries(invalid)) expect(editor.draft[field]).toEqual(value);
  });

  it('keeps a valid numeric intensity unchanged and lets an unavailable source save future configuration', () => {
    const { change, click, card } = setup({ layout: { weather: saved }, states: { 'weather.home': weatherState('Offline', 'unavailable') } });
    change('quality', 'static'); click('save');
    expect(card._layout.weather).toEqual({ ...saved, quality: 'static' });
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('blocks a dirty fallback draft after actual same-key card setConfig instead of overwriting newer weather settings', async () => {
    await import('../src/taylors3d-card.js');
    const old = { ...saved, retained: 'old' }, latest = { ...saved, entity: 'weather.garden', quality: 'medium', retained: 'new' };
    const { card, editor, change, click, input, host } = setup({ cardElement: document.createElement('taylors3d-card'), config: { weather: old } });
    card._edit = { cancelHistoryGestures: vi.fn(), updateHistoryState: vi.fn() };
    change('intensity', '.8', 'input'); const draftControl = input('intensity'); draftControl.focus();
    card.setConfig({ ...card._config, weather: latest }); editor.updatePreviews(host);
    expect(card._edit.cancelHistoryGestures).not.toHaveBeenCalled();
    expect(input('intensity')).toBe(draftControl); expect(document.activeElement).toBe(draftControl);
    expect(input('intensity').value).toBe('.8'); expect(editor.draft).toMatchObject({ entity: 'weather.home', intensity: '.8', retained: 'old' });
    expect(host.textContent).toContain('changed while you were editing');
    expect(host.querySelector('[data-act="env-weather-save"]').disabled).toBe(true);
    editor.onClick('env-weather-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._layout.weather).toBeUndefined(); expect(card._config.weather).toBe(latest);
    click('cancel'); expect(editor.draft).toMatchObject(latest); expect(input('entity').value).toBe('weather.garden');
    expect(input('intensity').value).toBe('0.6'); expect(host.querySelector('[data-act="env-weather-save"]').disabled).toBe(false);
    change('intensity', '.7', 'input'); click('save');
    expect(card._layout.weather).toEqual({ ...latest, intensity: .7 }); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('protects a newer same-feature layout override while allowing unrelated layout and HA updates', () => {
    const { card, editor, host, change, input, click } = setup({ layout: { weather: saved } });
    change('intensity', '.8', 'input');
    card._layout = { ...card._layout, pins: { other: { x: 4, y: 3 } } };
    card._hass.states['sensor.unrelated'] = { state: '6', attributes: {} }; editor.updatePreviews(host);
    expect(host.querySelector('[data-act="env-weather-save"]').disabled).toBe(false); expect(input('intensity').value).toBe('.8');
    const latest = { ...saved, intensity: .3, retained: 'newer' }; card._layout = { ...card._layout, weather: latest }; editor.updatePreviews(host);
    editor.onClick('env-weather-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._layout.weather).toBe(latest);
    expect(input('intensity').value).toBe('.8'); click('cancel');
    expect(input('intensity').value).toBe('0.3'); expect(editor.draft.retained).toBe('newer');
  });

  it('never carries a dirty weather draft into a different layout key, even when both weather objects are identical', () => {
    const { card, editor, host, change, click, input } = setup({ layout: { weather: saved } });
    change('intensity', '.8', 'input'); card._config = { ...card._config, layout_key: 'different-house' }; editor.updatePreviews(host);
    expect(host.querySelector('[data-act="env-weather-save"]').disabled).toBe(true);
    editor.onClick('env-weather-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(input('intensity').value).toBe('.8');
    click('cancel'); expect(input('intensity').value).toBe('0.6');
    change('intensity', '.7', 'input'); click('save'); expect(card._layout.weather.intensity).toBe(.7);
  });

  it('requires a deliberate weather source for enabled effects, but permits disabled or quality-Off configuration without guessing one', () => {
    const { change, click, card, host } = setup();
    change('enabled', true); click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(host.textContent).toContain('Choose a weather source');
    change('quality', 'off'); click('save'); expect(card._layout.weather).toMatchObject({ enabled: true, entity: '', quality: 'off' });
    change('enabled', false); change('quality', 'static'); click('save'); expect(card._layout.weather).toMatchObject({ enabled: false, entity: '', quality: 'static' });
  });

  it('does not treat freezing temperature or a rainy forecast as current snow or rain', () => {
    const { host, configure } = setup({ states: { 'weather.home': weatherState('Home weather', 'sunny', { temperature: -10, forecast: [{ condition: 'snowy' }], precipitation_probability: 100 }) } });
    configure(); expect(host.textContent).toContain('Sunny'); expect(host.textContent).toContain('No selected effects for this condition');
  });

  it.each(['unavailable', 'unknown', 'restored'])('warns about %s readings without claiming active effects or blocking valid future configuration', (value) => {
    const current = value === 'restored' ? weatherState('Home weather', 'rainy', { restored: true }) : weatherState('Home weather', value);
    const { configure, host, click, card, input } = setup({ states: { 'weather.home': current } });
    configure(); expect(host.textContent).toContain('Weather data unavailable');
    expect(host.textContent).not.toContain('Rain · Clouds.'); expect(input('entity').disabled).toBe(false);
    click('save'); expect(card._layout.weather).toMatchObject({ enabled: true, entity: 'weather.home' });
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}, { 'weather.removed': { name: 'Remembered weather' } }, {}],
    ['hidden', { 'weather.removed': weatherState('Hidden weather') }, { 'weather.removed': { hidden_by: 'user' } }, {}],
    ['diagnostic', { 'weather.removed': weatherState('Diagnostic weather') }, { 'weather.removed': { entity_category: 'diagnostic' } }, {}],
    ['disabled', { 'weather.removed': weatherState('Disabled weather') }, { 'weather.removed': { device_id: 'gone' } }, { gone: { disabled_by: 'user' } }],
  ])('preserves %s saved sources read-only and requires deliberate Relink without guessing replacements', (_name, states, entities, devices) => {
    const original = { ...saved, entity: 'weather.removed', intensity: 0.75, retained: { keep: 1 } };
    const { input, card, editor, click, host, change } = setup({ layout: { weather: original }, states, entities, devices });
    expect(input('entity').value).toBe('weather.removed'); expect(input('entity').disabled).toBe(true); expect(input('intensity').disabled).toBe(true);
    expect(host.textContent).toContain('read-only'); expect(host.querySelector('[data-act="env-weather-relink"]').hidden).toBe(false);
    editor.onChange('env-weather-entity', { value: 'weather.home' }); editor.onClick('env-weather-save');
    expect(editor.draft.entity).toBe('weather.removed'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('relink'); expect(input('entity').disabled).toBe(false); expect(input('intensity').disabled).toBe(true);
    expect(input('entity').value).toBe('weather.removed');
    change('entity', 'weather.garden'); expect(input('intensity').disabled).toBe(false);
    expect(card._layout.weather).toBe(original); click('save');
    expect(card._layout.weather).toEqual({ ...original, entity: 'weather.garden' }); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('keeps an entity removed during editing selected, locks Save, and resumes only when that exact source returns', () => {
    const { input, editor, card, host, change, click } = setup({ layout: { weather: saved } });
    change('intensity', '0.7', 'input'); delete card._hass.states['weather.home']; editor.updatePreviews(host);
    expect(input('entity').value).toBe('weather.home'); expect(editor.draft.entity).toBe('weather.home'); expect(input('intensity').value).toBe('0.7');
    expect(host.querySelector('[data-act="env-weather-save"]').disabled).toBe(true); click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    card._hass.states['weather.home'] = weatherState('Returned exact weather'); editor.updatePreviews(host);
    expect(input('entity').value).toBe('weather.home'); expect(input('intensity').disabled).toBe(false);
    click('save'); expect(card._layout.weather).toMatchObject({ entity: 'weather.home', intensity: 0.7 });
  });

  it('can deliberately turn off a missing source without replacing or losing its saved reference', () => {
    const original = { ...saved, entity: 'weather.removed', future: 4 };
    const { click, card } = setup({ layout: { weather: original } });
    click('clear'); expect(card._layout.weather).toEqual({ ...original, enabled: false });
    expect(card.commitFeatureLayout).toHaveBeenCalledTimes(1); expect(card._history.size).toBe(1);
  });

  it('Cancel after deliberate Relink restores the exact missing source and does not repair saved data implicitly', () => {
    const original = { ...saved, entity: 'weather.removed', intensity: 0.75 };
    const { click, change, input, card } = setup({ layout: { weather: original } });
    click('relink'); change('entity', 'weather.garden'); change('intensity', '0.2', 'input'); click('cancel');
    expect(input('entity').value).toBe('weather.removed'); expect(input('entity').disabled).toBe(true);
    expect(input('intensity').value).toBe('0.75'); expect(card._layout.weather).toBe(original);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });

  it('makes malformed imported weather read-only until explicit replacement and validates malformed saved numeric settings', () => {
    const malformed = setup({ layout: { weather: ['unexpected'] } });
    expect(malformed.host.textContent).toContain('malformed'); expect(malformed.input('entity').disabled).toBe(true);
    malformed.click('relink'); expect(malformed.input('entity').value).toBe(''); malformed.configure(); malformed.click('save');
    expect(malformed.card._layout.weather).toMatchObject({ enabled: true, entity: 'weather.home', intensity: 0.6 });
    const numeric = setup({ layout: { weather: { ...saved, intensity: null } } });
    numeric.click('save'); expect(numeric.card.commitFeatureLayout).not.toHaveBeenCalled();
    numeric.change('intensity', '0.4', 'input'); numeric.click('save'); expect(numeric.card._layout.weather.intensity).toBe(0.4);
  });

  it('shows actual sun/location and their unavailable/restored/malformed diagnostics without an editable sun-source guess', () => {
    const { host, card, editor } = setup();
    expect(host.textContent).toContain('sun.sun'); expect(host.textContent).toContain('Elevation 30°'); expect(host.textContent).toContain('HA latitude 51.5°');
    expect(host.querySelector('[data-field*="sun"]')).toBeNull();
    card._hass.states['sun.sun'].attributes.restored = true; card._hass.config.latitude = null; editor.updatePreviews(host);
    expect(host.textContent).toContain('Current sun data unavailable'); expect(host.textContent).toContain('restored snapshot');
    expect(host.textContent).toContain('Set a valid latitude and longitude'); expect(host.textContent).not.toContain('HA latitude 0°');
  });

  it('reports explicit outdoor/indoor setup errors including hidden floors without inferring a building boundary', () => {
    const { host, card, editor } = setup({ rooms: [room('lounge', false, [[0, 0], [4, 0], [4, 4], [0, 4]])] });
    expect(host.textContent).toContain('No exposed outdoor region is set up');
    card._roomList.push({ ...room('broken', false, [[0, 0]], 'first'), shown: false }); editor.updatePreviews(host);
    expect(host.textContent).toContain('Repair every indoor outline');
    expect(host.textContent).not.toContain('2 valid outdoor');
  });

  it('uses root-supplied transformed footprints when available, without rewriting them or inventing missing elevation', () => {
    const footprints = { outdoors: [{ id: 'patio', floorId: 'ground', elevation: 0, outdoor: true, polygon: [[10, 0], [12, 0], [12, 2], [10, 2]] }], indoors: [], visibleFloors: ['ground'] };
    const original = JSON.stringify(footprints), { host, editor, card } = setup({ footprints });
    expect(host.textContent).toContain('1 valid outdoor region'); expect(card.weatherFootprints).toHaveBeenCalled();
    footprints.outdoors[0].elevation = null; editor.updatePreviews(host);
    expect(host.textContent).toContain('explicitly outdoor polygon');
    footprints.outdoors[0].elevation = 0; expect(JSON.stringify(footprints)).toBe(original);
  });

  it('escapes source names/diagnostics, provides scoped UI markers/touch sizes, and makes no service or preview calls', () => {
    const { configure, host, card } = setup({ states: { 'weather.home': weatherState('<img src=x onerror=alert(1)>') } });
    configure(); expect(host.textContent).toContain('<img src=x onerror=alert(1)>'); expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[data-taylors3d-ui="weather-editor"]')).not.toBeNull(); expect(host.innerHTML).toContain('min-height:44px');
    expect(host.querySelector('[aria-live="polite"]')).not.toBeNull(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card.previewWeather).not.toHaveBeenCalled();
  });

  it('blocks non-admin settings and ignores late events after disposal without touching other editors', () => {
    const { input, editor, card } = setup({ layout: { weather: saved }, admin: false });
    expect(input('entity').disabled).toBe(true); expect(input('intensity').disabled).toBe(true);
    editor.onChange('env-weather-intensity', { value: '0.9' }); editor.onClick('env-weather-save'); editor.onClick('env-weather-clear');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(editor.draft.intensity).toBe(0.6);
    expect(editor.onChange('cov-range', { value: '5' })).toBe(false); expect(editor.onClick('trk-save')).toBe(false);
    editor.dispose(); expect(editor.render()).toBe(''); expect(editor.onInput('env-weather-intensity', { value: '0.1' })).toBe(false); expect(editor.onClick('env-weather-save')).toBe(false);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
