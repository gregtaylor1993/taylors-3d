// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const editors = [];
const defaultFloors = () => [{ id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'first', name: 'First floor', elevation: 3 }];
const saved = (extra = {}) => ({ mode: 'assembled', gap_m: 2, axis: 'east', base_elevation_m: 0, floors: ['ground', 'first'], extension: { keep: ['Taylor'] }, ...extra });

function setup({ layout = {}, config = {}, floors = defaultFloors(), backend = 'browser', modelRoot = null } = {}) {
  const card = { isConnected: true, _config: { layout_key: 'house', ...config },
    _layout: { rooms: [], pins: {}, floors: structuredClone(floors), ...layout }, _built: {},
    _hass: { user: { id: 'taylor', is_admin: true, is_active: true }, connection: { connected: true },
      states: {}, entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn(), callWS: vi.fn() },
    _floors: floors, _roomList: [], _floor: 'ground', _mode: 'top', _editing: true,
    _stage: document.createElement('div'), _markers: [], _positions: new Map(), _store: { backend }, _history: new EditHistory(),
    _applyMarkerSelection: vi.fn(), modelBindings: () => null, _modelAlign: () => ({ scale: 1 }),
    finishWallSelectionPreparation: vi.fn(), floorPresentationReport: vi.fn(() => ({ mode: 'assembled', valid: true, diagnostics: [] })),
    _view: { model: modelRoot ? { root: modelRoot } : null, floorElevation: (id) => floors.find((floor) => floor.id === id)?.elevation,
      setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(), setControlsEnabled: vi.fn(), highlightModelNode: vi.fn(),
      setFloorPresentation: vi.fn(), setCamera: vi.fn(), planPoint: vi.fn(() => [1, 1]), pickModel: vi.fn(() => null), pixelsPerMetre: () => 10 } };
  const snapshot = () => ({ layout: card._layout, config: card._config });
  card._history.reset(snapshot());
  const edit = new EditMode(card); card._edit = edit; editors.push(edit);
  card._commit = vi.fn((value, label = 'Edit') => { card._layout = value; card._history.record(snapshot(), label); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch, label) => card._commit({ ...card._layout, ...patch }, label));
  card.undoEdit = vi.fn(() => { const value = card._history.undo(); if (value) card._layout = value.layout; edit.render(); });
  card.redoEdit = vi.fn(() => { const value = card._history.redo(); if (value) card._layout = value.layout; edit.render(); });
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach();
  const action = (name, suffix = '') => edit.panel.querySelector(`[data-act="${name}"]${suffix}`);
  const click = (name, suffix = '') => { const control = action(name, suffix); expect(control).toBeTruthy(); control.click(); return control; };
  const model = () => click('tab', '[data-id="model"]');
  const field = (name) => edit.panel.querySelector(`[data-field="floor-presentation-${name}"]`);
  const change = (name, value, type = 'input') => { const control = field(name); expect(control).toBeTruthy();
    control.focus(); control.value = value; control.dispatchEvent(new Event(type, { bubbles: true })); return control; };
  const rowAction = (kind, index) => { const control = edit.panel.querySelector(`[data-floor-presentation-row="${index}"] [data-act^="floor-presentation-${kind}:"]`);
    expect(control).toBeTruthy(); control.click(); return control; };
  return { card, edit, action, click, model, field, change, rowAction };
}

afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); });

describe('floor presentation in the actual Model editor', () => {
  it.each([
    ['YAML model', { config: { model: '/local/house.glb' } }],
    ['uploaded model', { backend: 'shared', layout: { model: { name: 'house.glb' } } }],
    ['browser storage', {}],
    ['no model', { backend: 'shared' }],
  ])('shows assembled defaults alongside shading/walls for %s, without applying a draft', (_label, options) => {
    const { card, edit, model, field, action } = setup(options); model();
    expect(edit.panel.querySelector('[data-model-rendering-editor]')).not.toBeNull();
    expect(edit.panel.querySelector('[data-wall-presentation-editor]')).not.toBeNull();
    expect(edit.panel.querySelector('[data-floor-presentation-editor]')).not.toBeNull();
    expect(field('mode').value).toBe('assembled'); expect(field('gap_m').value).toBe('2');
    expect(action('floor-presentation-save').disabled).toBe(true);
    expect(card._commit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
    expect(card._view.setFloorPresentation).not.toHaveBeenCalled(); expect(card._view.setCamera).not.toHaveBeenCalled();
  });
  it('routes native input/change fields to one labelled history edit and restores exact values through Undo/Redo', () => {
    const original = saved(), { card, model, change, click, field, action } = setup({ layout: { floor_presentation: original } }); model();
    change('mode', 'horizontal', 'change'); change('gap_m', '4.125'); change('axis', 'north', 'change'); change('base_elevation_m', '-.375');
    expect(card._layout.floor_presentation).toEqual(original); expect(card._commit).not.toHaveBeenCalled();
    expect(card._view.setFloorPresentation).not.toHaveBeenCalled(); expect(card._view.setCamera).not.toHaveBeenCalled();
    click('floor-presentation-save'); click('floor-presentation-save');
    const expected = { ...original, mode: 'horizontal', gap_m: 4.125, axis: 'north', base_elevation_m: -.375 };
    expect(card.commitFeatureLayout).toHaveBeenCalledExactlyOnceWith({ floor_presentation: expected }, 'Floor presentation');
    expect(card._layout.floor_presentation).toEqual(expected); expect(card._history.size).toBe(1);
    expect(action('history-undo').title).toContain('Floor presentation');
    click('history-undo'); expect(card._layout.floor_presentation).toEqual(original); expect(field('mode').value).toBe('assembled');
    click('history-redo'); expect(card._layout.floor_presentation).toEqual(expected); expect(field('gap_m').value).toBe('4.125');
    expect(field('base_elevation_m').value).toBe('-0.375'); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('saves an additive layout override of YAML settings and Undo restores the original YAML fallback', () => {
    const configured = saved({ mode: 'vertical' }), { card, model, change, click, field } = setup({ config: { floor_presentation: configured } }); model();
    expect(field('mode').value).toBe('vertical'); change('gap_m', '6'); click('floor-presentation-save');
    expect(card._config.floor_presentation).toEqual(configured); expect(card._layout.floor_presentation).toEqual({ ...configured, gap_m: 6 });
    click('history-undo'); expect(Object.hasOwn(card._layout, 'floor_presentation')).toBe(false); expect(field('gap_m').value).toBe('2');
    click('history-redo'); expect(field('gap_m').value).toBe('6');
  });
  it('routes exact Up/Down/Remove and Add controls, preserving floor elevations and rejecting a stale row button', () => {
    const original = saved(), { card, edit, model, rowAction, change, click } = setup({ layout: { floor_presentation: original } }); model();
    const oldDown = edit.panel.querySelector('[data-floor-presentation-row="0"] [data-act^="floor-presentation-down:"]').dataset.act;
    rowAction('up', 1); expect(edit._floorPresentationEditor.draft.floors).toEqual(['first', 'ground']);
    edit._floorPresentationEditor.onClick(oldDown); expect(edit._floorPresentationEditor.draft.floors).toEqual(['first', 'ground']);
    rowAction('down', 0); rowAction('remove', 1); expect(edit._floorPresentationEditor.draft.floors).toEqual(['ground']);
    change('add-floor', 'first', 'change'); click('floor-presentation-save');
    expect(card._layout.floor_presentation).toEqual(original); expect(card._commit).not.toHaveBeenCalled();
    // A restored original list is a clean draft, so the disabled Save creates no empty history entry.
    expect(card._layout.floors).toEqual(defaultFloors()); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps native scalar inputs and Save/Cancel stable during unrelated state pushes and editor rebuilds', () => {
    const { card, edit, model, change, field, action } = setup({ layout: { floor_presentation: saved() } }); model();
    const input = change('gap_m', '3.875');
    card._hass = { ...card._hass, states: { 'sensor.example': { state: 'on' } } }; edit.onStates(); edit.afterUpdate();
    expect(field('gap_m')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('3.875');
    const save = action('floor-presentation-save'); save.focus(); edit.onStates(); edit.afterUpdate();
    expect(action('floor-presentation-save')).toBe(save); expect(document.activeElement).toBe(save); expect(save.disabled).toBe(false);
    const cancel = action('floor-presentation-cancel'); cancel.focus(); edit.afterUpdate();
    expect(action('floor-presentation-cancel')).toBe(cancel); expect(document.activeElement).toBe(cancel); expect(card._commit).not.toHaveBeenCalled();
  });
  it('keeps a focused native floor select through rename/report refreshes without guessing a new floor ID', () => {
    const { card, edit, model } = setup({ layout: { floor_presentation: saved() } }); model();
    const select = edit.panel.querySelector('[data-floor-presentation-row="0"] select'); select.focus();
    edit.onStates(); card._floors[0].name = 'Downstairs';
    card.floorPresentationReport.mockReturnValue({ mode: 'assembled', valid: false, diagnostics: [{ message: 'Exact model floor link needs confirmation.', floor_id: 'ground' }] });
    edit.onStates(); edit.afterUpdate();
    expect(edit.panel.querySelector('[data-floor-presentation-row="0"] select')).toBe(select); expect(document.activeElement).toBe(select);
    expect(select.value).toBe('ground'); expect(edit.panel.textContent).toContain('Downstairs'); expect(edit.panel.textContent).toContain('needs confirmation');
    expect(edit._floorPresentationEditor.stale).toBe(false); expect(card._commit).not.toHaveBeenCalled();
  });
  it('leaves a focused independent shading draft alone while floor controls are edited', () => {
    const { card, edit, model, change } = setup(); model();
    const shade = edit.panel.querySelector('[data-field="model-rendering-preset"]');
    shade.value = 'no-shadows'; shade.dispatchEvent(new Event('change', { bubbles: true }));
    const input = change('gap_m', '7'); edit.onStates(); edit.afterUpdate();
    expect(document.activeElement).toBe(input); expect(edit._modelRenderingEditor.dirty).toBe(true);
    expect(edit.panel.querySelector('[data-field="model-rendering-preset"]').value).toBe('no-shadows'); expect(card._commit).not.toHaveBeenCalled();
  });
  it.each(['model', 'source', 'alignment', 'floor-data', 'session', 'inactive', 'disconnected'])('latches a dirty draft across %s changes and recovery until Cancel', (kind) => {
    const original = saved(), root = new THREE.Group(), { card, edit, model, change, field, action, click } = setup({ layout: { floor_presentation: original, model: { name: 'old.glb' } }, config: { model: '' }, modelRoot: root }); model();
    const input = change('gap_m', '9');
    const oldConnection = card._hass.connection;
    if (kind === 'model') card._view.model = { root: new THREE.Group() };
    if (kind === 'source') card._layout.model = { name: 'new.glb' };
    if (kind === 'alignment') card._config.model_rotation = 90;
    if (kind === 'floor-data') card._floors[0].elevation = .1;
    if (kind === 'session') card._hass.connection = { connected: true };
    if (kind === 'inactive') card._hass.user.is_active = false;
    if (kind === 'disconnected') card._hass.connection.connected = false;
    edit.onStates(); edit.afterUpdate(); expect(field('gap_m')).toBe(input); expect(input.value).toBe('9');
    expect(action('floor-presentation-save').disabled).toBe(true); expect(edit._floorPresentationEditor.stale).toBe(true);
    card._view.model = { root }; card._layout.model = { name: 'old.glb' }; delete card._config.model_rotation;
    card._floors[0].elevation = 0; card._hass.connection = oldConnection; oldConnection.connected = true; card._hass.user.is_active = true;
    edit.onStates(); expect(action('floor-presentation-save').disabled).toBe(true);
    edit._floorPresentationEditor.onClick('floor-presentation-save'); expect(card._commit).not.toHaveBeenCalled();
    click('floor-presentation-cancel'); expect(edit._floorPresentationEditor.stale).toBe(false); expect(field('gap_m').value).toBe('2');
    change('gap_m', '9'); click('floor-presentation-save'); expect(card._commit).toHaveBeenCalledOnce();
  });
  it.each(['role', 'identity'])('updates read-only controls immediately after losing current admin %s', (kind) => {
    const { card, edit, model, field, action, change } = setup(); model();
    if (kind === 'role') card._hass.user.is_admin = false; else card._hass.user.id = '';
    edit.onStates(); expect(field('mode').disabled).toBe(true); expect(action('floor-presentation-repair').disabled).toBe(true);
    change('mode', 'horizontal', 'change'); expect(edit._floorPresentationEditor.dirty).toBe(false); expect(card._commit).not.toHaveBeenCalled();
  });
  it('preserves a missing saved floor until deliberate removal, or saves it unchanged in assembled mode', () => {
    const original = saved({ mode: 'horizontal', floors: ['ground', 'missing'] }), { card, edit, model, change, click, action, rowAction } = setup({ layout: { floor_presentation: original } }); model();
    expect(edit.panel.textContent).toContain('Saved floor is missing'); change('gap_m', '3'); expect(action('floor-presentation-save').disabled).toBe(true);
    click('floor-presentation-save'); expect(card._commit).not.toHaveBeenCalled();
    change('mode', 'assembled', 'change'); click('floor-presentation-save');
    expect(card._layout.floor_presentation).toEqual({ ...original, mode: 'assembled', gap_m: 3 });
    change('mode', 'vertical', 'change'); rowAction('remove', 1); click('floor-presentation-save');
    expect(card._layout.floor_presentation.floors).toEqual(['ground']); expect(card._layout.floor_presentation.extension).toEqual(original.extension);
  });
  it('lets a geometry warning stay visible while saving structurally valid settings, without claiming the requested mode was rendered', () => {
    const { card, edit, model, change, click } = setup();
    card.floorPresentationReport.mockReturnValue({ mode: 'assembled', valid: false, diagnostics: [{ message: 'Missing confirmed model floor targets.' }] }); model();
    change('mode', 'horizontal', 'change'); expect(edit.panel.textContent).toContain('Missing confirmed model floor targets');
    click('floor-presentation-save'); expect(card._layout.floor_presentation.mode).toBe('horizontal');
    expect(edit.panel.querySelector('[data-floor-presentation-report]').textContent).toContain('Normal (assembled)');
    expect(card._view.setFloorPresentation).not.toHaveBeenCalled();
  });
  it.each([
    ['string spacing', saved({ gap_m: '2' })],
    ['null floor list', saved({ floors: null })],
    ['unknown mode', saved({ mode: 'exploded' })],
  ])('preserves %s imports through unrelated edits/Cancel and repairs only by an explicit defaults action', (_label, original) => {
    const { card, edit, model, change, click, action } = setup({ layout: { floor_presentation: original } }); model();
    change('base_elevation_m', '1.25'); expect(action('floor-presentation-save').disabled).toBe(true);
    click('floor-presentation-save'); expect(card._commit).not.toHaveBeenCalled(); expect(card._layout.floor_presentation).toEqual(original);
    click('floor-presentation-cancel'); expect(edit._floorPresentationEditor.draft).toEqual(original);
    click('floor-presentation-repair'); expect(Object.hasOwn(edit._floorPresentationEditor.draft, 'floors')).toBe(false);
    click('floor-presentation-save'); expect(card._layout.floor_presentation).toEqual({ extension: original.extension, mode: 'assembled', gap_m: 2, axis: 'east', base_elevation_m: 0 });
    click('history-undo'); expect(card._layout.floor_presentation).toEqual(original);
  });
  it('discards an unsaved draft before Undo/Redo replaces the history context', () => {
    const { card, edit, model, change, click, field } = setup({ layout: { floor_presentation: saved() } }); model();
    change('gap_m', '4'); click('floor-presentation-save'); change('gap_m', '12');
    click('history-undo'); expect(field('gap_m').value).toBe('2'); expect(edit._floorPresentationEditor.dirty).toBe(false);
    click('history-redo'); expect(field('gap_m').value).toBe('4'); expect(edit._floorPresentationEditor.dirty).toBe(false);
    expect(card._commit).toHaveBeenCalledOnce();
  });
  it('clears drafts on tab leave, history cancellation and detach, but only permanent disposal destroys the fragment', () => {
    const { card, edit, model, change, field, click } = setup({ layout: { floor_presentation: saved() } }); model(); change('gap_m', '8');
    click('tab', '[data-id="rooms"]'); expect(edit._floorPresentationEditor.draft).toBeNull(); model(); expect(field('gap_m').value).toBe('2');
    change('gap_m', '8'); edit.cancelHistoryGestures(); expect(edit._floorPresentationEditor.draft).toBeNull(); edit.render();
    change('gap_m', '8'); edit.detach(); expect(edit._floorPresentationEditor.draft).toBeNull(); expect(edit._floorPresentationEditor.disposed).toBe(false);
    edit.attach(); edit.render(); expect(field('gap_m').value).toBe('2'); edit.dispose(); expect(edit._floorPresentationEditor.disposed).toBe(true);
    expect(edit._floorPresentationEditor.render()).toBe(''); expect(card._commit).not.toHaveBeenCalled();
  });
});
