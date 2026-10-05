// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const editors = [];
function setup({ config = {}, layout = {}, backend = 'browser', root = null } = {}) {
  const card = { _config: { layout_key: 'house', ...config }, _layout: { rooms: [], pins: {}, ...layout }, _built: {},
    _hass: { user: { is_admin: true }, states: {}, entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn(), callWS: vi.fn() },
    _floors: [{ id: 'ground', elevation: 0 }], _roomList: [], _floor: 'ground', _mode: 'top', _editing: true,
    _stage: document.createElement('div'), _markers: [], _positions: new Map(), _store: { backend }, _history: new EditHistory(),
    _applyMarkerSelection: vi.fn(), modelBindings: () => null,
    _view: { model: root ? { root } : null, floorElevation: () => 0, setOverlay: vi.fn(),
      setPivotMarker: vi.fn(), setControlsEnabled: vi.fn(), highlightModelNode: vi.fn() } };
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  const edit = new EditMode(card); card._edit = edit;
  card._commit = vi.fn((value) => { card._layout = value; card._history.record(snapshot()); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch) => card._commit({ ...card._layout, ...patch }));
  card.undoEdit = vi.fn(() => { const value = card._history.undo(); if (value) card._layout = value.layout; edit.render(); });
  card.redoEdit = vi.fn(() => { const value = card._history.redo(); if (value) card._layout = value.layout; edit.render(); });
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach(); editors.push(edit);
  const click = (action, selector = '') => { const element = edit.panel.querySelector(`[data-act="${action}"]${selector}`); expect(element).toBeTruthy(); element.click(); };
  const model = () => click('tab', '[data-id="model"]');
  const select = () => edit.panel.querySelector('[data-field="model-rendering-preset"]');
  const choose = (value) => { const element = select(); element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); return element; };
  return { card, edit, click, model, select, choose };
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); });

describe('Model shading in the actual layout editor', () => {
  it.each([
    ['YAML model', { config: { model: '/local/house.glb' } }],
    ['browser storage', {}],
    ['shared storage with no model', { backend: 'shared' }],
    ['invalid upload key', { backend: 'shared', config: { layout_key: 'invalid/key' } }],
    ['shared uploaded model', { backend: 'shared', layout: { model: { name: 'house.glb', position: [0, 0, 0], known: {} } } }],
  ])('makes display settings available through the %s route without changing upload behavior', (label, options) => {
    const { card, edit, model, select } = setup(options); model();
    expect(select()).toBeTruthy(); expect(edit.panel.textContent).toContain('Model shading');
    if (label === 'YAML model') expect(edit.panel.textContent).toContain('from its YAML');
    if (label === 'browser storage') expect(edit.panel.textContent).toContain('Uploading a model needs');
    if (label === 'invalid upload key') expect(edit.panel.textContent).toContain('for model uploads');
    expect(card._commit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('applies one saved edit through existing history and restores exact additive fields on Undo/Redo', () => {
    const saved = { shadows: 'realtime', lamps: 'inherit', future: { author: 'Taylor' } };
    const { card, model, choose, click, select } = setup({ layout: { model_rendering: saved } }); model(); choose('authored');
    expect(card._commit).not.toHaveBeenCalled(); click('model-rendering-save'); expect(card._commit).toHaveBeenCalledOnce();
    expect(card._layout.model_rendering).toEqual({ ...saved, shadows: 'off', lamps: 'off' });
    click('history-undo'); expect(card._layout.model_rendering).toEqual(saved); expect(select().value).toBe('normal');
    click('history-redo'); expect(select().value).toBe('authored');
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('keeps the actual focused draft select during live states and registry/model evidence refreshes', () => {
    const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const { card, edit, model, choose, select } = setup({ config: { model: '/local/house.glb' }, root }); model();
    const input = choose('no-shadows'); input.focus();
    card._hass.states['light.lounge'] = { state: 'on', attributes: {} }; edit.onStates();
    expect(select()).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('no-shadows');
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())); edit.afterUpdate();
    expect(select()).toBe(input); expect(document.activeElement).toBe(input); expect(edit.panel.textContent).toContain('Unlit materials: 1');
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('rejects stale model replacement through the real Save button while keeping the choice visible', () => {
    const root = new THREE.Group(); const { card, edit, model, choose, select, click } = setup({ config: { model: '/local/house.glb' }, root });
    model(); const input = choose('authored'); input.focus(); card._view.model = { root: new THREE.Group() }; edit.afterUpdate();
    expect(select()).toBe(input); expect(input.value).toBe('authored');
    expect(edit.panel.querySelector('[data-act="model-rendering-save"]').disabled).toBe(true);
    click('model-rendering-save'); expect(card._commit).not.toHaveBeenCalled();
    click('model-rendering-cancel'); expect(select().value).toBe('normal');
  });
  it('discards only the unsaved display draft on Cancel, tab leave, context reset and detach', () => {
    const { card, edit, model, choose, select, click } = setup(); model(); choose('authored'); click('model-rendering-cancel');
    expect(select().value).toBe('normal'); choose('authored'); click('tab', '[data-id="rooms"]');
    expect(edit._modelRenderingEditor.draft).toBeNull(); model(); expect(select().value).toBe('normal');
    choose('authored'); edit.cancelHistoryGestures(); expect(edit._modelRenderingEditor.draft).toBeNull();
    edit.render(); choose('authored'); edit.detach(); expect(edit._modelRenderingEditor.draft).toBeNull();
    edit.attach(); edit.render(); expect(select().value).toBe('normal'); expect(edit._modelRenderingEditor.disposed).toBe(false);
    expect(card._commit).not.toHaveBeenCalled();
  });
});
