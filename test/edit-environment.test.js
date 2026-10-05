// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const editors = [];
function setup() {
  const indoor = { id: 'room', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], floor_id: 'ground' };
  const garden = { id: 'garden', polygon: [[5, 0], [10, 0], [10, 6], [5, 6]], floor_id: 'ground', outdoor: true };
  const card = { _config: { layout_key: 'house' }, _layout: { rooms: [indoor, garden], pins: {} }, _built: {},
    _hass: { user: { is_admin: true }, states: { 'weather.home': { state: 'rainy', attributes: { friendly_name: 'Home weather' } } },
      entities: {}, areas: {}, floors: {}, devices: {}, callService: vi.fn(), callWS: vi.fn() },
    _floors: [{ id: 'ground', elevation: 0 }], _roomList: [{ room: indoor, floorId: 'ground' }, { room: garden, floorId: 'ground' }],
    _floor: 'ground', _mode: 'top', _editing: true, _stage: document.createElement('div'), _markers: [],
    _positions: new Map(), _store: { backend: 'browser' }, _history: new EditHistory(), _applyMarkerSelection: vi.fn(),
    _syncWeather: vi.fn(), _view: { model: null, floorElevation: () => 0, setOverlay: vi.fn(),
      setPivotMarker: vi.fn(), setControlsEnabled: vi.fn(), highlightModelNode: vi.fn() } };
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  const edit = new EditMode(card); card._edit = edit;
  card._commit = vi.fn((layout) => { card._layout = layout; card._history.record(snapshot()); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch) => card._commit({ ...card._layout, ...patch }));
  card.undoEdit = vi.fn(() => { const value = card._history.undo(); if (value) card._layout = value.layout; edit.render(); });
  card.redoEdit = vi.fn(() => { const value = card._history.redo(); if (value) card._layout = value.layout; edit.render(); });
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach(); editors.push(edit);
  const click = (action, selector = '') => { const el = edit.panel.querySelector(`[data-act="${action}"]${selector}`); expect(el).toBeTruthy(); el.click(); };
  const change = (field, value, event = 'change') => {
    const el = edit.panel.querySelector(`[data-field="env-weather-${field}"]`); expect(el).toBeTruthy();
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(event, { bubbles: true })); return el;
  };
  const environment = () => click('tab', '[data-id="environment"]');
  return { card, edit, click, change, environment };
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); });

describe('Environment controls in the actual layout editor', () => {
  it('opens the tab, previews explicit source data and saves exactly one undoable change without HA actions', () => {
    const { card, edit, click, change, environment } = setup(); environment();
    expect(card._syncWeather).toHaveBeenCalledOnce(); expect(edit.tab).toBe('environment');
    change('enabled', true); change('entity', 'weather.home'); change('quality', 'static'); change('intensity', '.42', 'input');
    expect(edit.panel.textContent).toContain('Rainy'); expect(card._commit).not.toHaveBeenCalled();
    click('env-weather-save'); expect(card._commit).toHaveBeenCalledOnce();
    expect(card._layout.weather).toMatchObject({ enabled: true, entity: 'weather.home', quality: 'static', intensity: .42 });
    click('history-undo'); expect(card._layout.weather).toBeUndefined();
    click('history-redo'); expect(card._layout.weather.intensity).toBe(.42);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('keeps the real focused control and unsaved text through state and registry refreshes', () => {
    const { card, edit, change, environment } = setup(); environment(); change('enabled', true); change('entity', 'weather.home');
    const input = change('intensity', '.63', 'input'); input.focus();
    card._hass.states['weather.home'] = { state: 'unavailable', attributes: {} }; edit.onStates();
    expect(edit.panel.querySelector('[data-field="env-weather-intensity"]')).toBe(input); expect(document.activeElement).toBe(input);
    expect(input.value).toBe('.63'); expect(edit.panel.textContent).toContain('unavailable');
    card._hass.entities = {}; edit.afterUpdate();
    expect(edit.panel.querySelector('[data-field="env-weather-intensity"]')).toBe(input); expect(document.activeElement).toBe(input);
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('leaving the tab discards weather drafts and keeps saved settings', () => {
    const { card, edit, click, change, environment } = setup(); environment(); change('enabled', true); change('entity', 'weather.home');
    click('tab', '[data-id="rooms"]'); expect(edit._weatherEditor.draft).toBeNull(); expect(card._layout.weather).toBeUndefined();
    environment(); expect(edit.panel.querySelector('[data-field="env-weather-enabled"]').checked).toBe(false); expect(card._commit).not.toHaveBeenCalled();
  });
  it('resetting context, detach and reattach discard weather drafts without disposing the reusable editor', () => {
    const { card, edit, change, environment } = setup(); environment(); change('enabled', true);
    edit.cancelHistoryGestures(); expect(edit._weatherEditor.draft).toBeNull();
    edit.render(); change('enabled', true); edit.detach(); expect(edit._weatherEditor.draft).toBeNull();
    edit.attach(); edit.render(); expect(edit.panel.querySelector('[data-field="env-weather-enabled"]').checked).toBe(false);
    expect(edit._weatherEditor.disposed).toBe(false); expect(card._commit).not.toHaveBeenCalled();
  });
});
