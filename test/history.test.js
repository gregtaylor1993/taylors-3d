// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditHistory, historyShortcut } from '../src/history.js';
import { EditMode } from '../src/edit-mode.js';
import { resolveViews } from '../src/views.js';

const state = (value = 0) => ({ layout: { pins: { lamp: { x: value, y: 0 } } }, config: { layout_key: 'default', mini_map_size: 180 } });

describe('configuration history', () => {
  it('restores layout and card settings together, and never exposes stored snapshot references', () => {
    const history = new EditHistory();
    const initial = state();
    history.reset(initial);
    initial.layout.pins.lamp.x = 999;
    const moved = state(3);
    moved.config.mini_map_size = 240;
    expect(history.record(moved, 'Move light and resize map')).toBe(true);
    moved.layout.pins.lamp.x = 999;
    expect(history.undoLabel).toBe('Move light and resize map');
    const undone = history.undo();
    expect(undone).toEqual(state());
    undone.config.mini_map_size = 999;
    const redone = history.redo();
    expect(redone.layout.pins.lamp.x).toBe(3);
    expect(redone.config.mini_map_size).toBe(240);
    redone.layout.pins.lamp.x = 999;
    expect(history.current.layout.pins.lamp.x).toBe(3);
  });

  it('preserves redo on no-op updates and clears it only for a new edit', () => {
    const history = new EditHistory();
    history.reset(state());
    history.record(state(1), 'First');
    history.record(state(2), 'Second');
    history.undo();
    expect(history.record({ config: state().config, layout: state(1).layout }, 'Same fields, different order')).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redoLabel).toBe('Second');
    history.record(state(7), 'New branch');
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeNull();
    expect(history.undo().layout.pins.lamp.x).toBe(1);
  });

  it('groups every intermediate save of a slider or drag into one undoable gesture', () => {
    const history = new EditHistory();
    history.reset(state());
    expect(history.begin('Move device')).toBe(true);
    expect(history.begin('Nested gesture')).toBe(false);
    for (let x = 1; x <= 80; x++) history.record(state(x));
    expect(history.size).toBe(0);
    expect(history.current.layout.pins.lamp.x).toBe(80);
    expect(history.canUndo).toBe(true);
    expect(history.end()).toBe(true);
    expect(history.size).toBe(1);
    expect(history.undoLabel).toBe('Move device');
    expect(history.undo().layout.pins.lamp.x).toBe(0);
    expect(history.redo().layout.pins.lamp.x).toBe(80);
  });

  it('keeps the redo branch when a gesture is empty, reverted or cancelled', () => {
    const history = new EditHistory();
    history.reset(state());
    history.record(state(1));
    history.undo();
    history.begin('Empty drag');
    expect(history.end()).toBe(false);
    history.begin('Drag back to its start');
    history.record(state(9));
    history.record(state());
    expect(history.end()).toBe(false);
    expect(history.canRedo).toBe(true);
    history.begin('Cancelled');
    history.record(state(8));
    expect(history.cancel()).toEqual(state());
    expect(history.canRedo).toBe(true);
    expect(history.redo().layout.pins.lamp.x).toBe(1);
  });

  it('finishes an active gesture before Undo and stores an import as a single edit', () => {
    const history = new EditHistory();
    history.reset(state());
    history.begin('Slider');
    history.record(state(5));
    expect(history.undo()).toEqual(state());
    expect(history.grouping).toBe(false);
    history.record({ layout: { rooms: [{ id: 'new', polygon: [[0, 0], [3, 0], [3, 2]] }] }, config: state().config }, 'Import layout');
    expect(history.undo()).toEqual(state());
    expect(history.redo().layout.rooms[0].id).toBe('new');
  });

  it('bounds retained edits and serialized bytes while keeping the current configuration', () => {
    const history = new EditHistory({ limit: 2 });
    history.reset(state());
    for (let x = 1; x <= 6; x++) history.record(state(x));
    expect(history.size).toBe(2);
    expect(history.undo().layout.pins.lamp.x).toBe(5);
    expect(history.undo().layout.pins.lamp.x).toBe(4);
    expect(history.undo()).toBeNull();
    const bounded = new EditHistory({ maxBytes: 300 });
    bounded.reset(state());
    for (let x = 1; x <= 10; x++) bounded.record(state(x));
    expect(bounded.bytes).toBeLessThanOrEqual(300);
    bounded.record({ layout: { description: 'x'.repeat(600) }, config: {} });
    expect(bounded.current.layout.description).toHaveLength(600);
    expect(bounded.canUndo).toBe(false);
  });

  it('resets loaded/layout-key history and rejects invalid snapshots without losing valid edits', () => {
    const history = new EditHistory();
    history.reset(state());
    history.record(state(1));
    const circular = state(2);
    circular.layout.self = circular;
    expect(() => history.record(circular)).toThrow();
    expect(history.current.layout.pins.lamp.x).toBe(1);
    const nextLayout = state(20);
    nextLayout.config.layout_key = 'upstairs';
    history.reset(nextLayout);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeNull();
    history.reset();
    expect(history.current).toBeNull();
    expect(history.begin()).toBe(false);
    expect(history.record(state())).toBe(false);
  });
});

const editors = [];
function makeEditor() {
  const card = {
    _config: { layout_key: 'default' },
    _layout: { version: 1, floors: [], rooms: [], pins: {}, hidden: [], mower: { overlay: { entity: 'image.map', x: 0, y: 0, opacity: 0.6 } } },
    _hass: { states: {}, areas: {}, floors: {}, callService: vi.fn() },
    _floors: [{ id: 'ground', name: 'Ground', elevation: 0, height: 2.7 }],
    _view: { model: null, setControlsEnabled: vi.fn(), highlightModelNode: vi.fn() },
    _store: { backend: 'browser' }, _history: new EditHistory(),
  };
  const snapshot = () => ({ layout: card._layout, config: card._config });
  card._history.reset(snapshot());
  const edit = new EditMode(card);
  edit.tab = 'data';
  card._commit = (layout) => { card._layout = layout; card._history.record(snapshot(), 'Edit layout'); edit.updateHistoryState(); };
  card.beginHistory = (label) => card._history.begin(label);
  card.endHistory = () => { card._history.end(); edit.updateHistoryState(); };
  const restore = (value) => { if (value) { card._layout = value.layout; card._config = value.config; edit.render(); } };
  card.undoEdit = vi.fn(() => restore(card._history.undo()));
  card.redoEdit = vi.fn(() => restore(card._history.redo()));
  card.resetHistory = vi.fn(() => { card._history.reset(snapshot()); edit.updateHistoryState(); });
  edit.render();
  document.body.append(edit.panel);
  edit.attach();
  editors.push(edit);
  return { card, edit };
}

afterEach(() => {
  editors.splice(0).forEach((edit) => edit.detach());
  document.body.replaceChildren();
});

describe('editing history controls and gesture boundaries', () => {
  it('enables accessible Undo/Redo buttons for real edits and keeps live device state unchanged', () => {
    const { card, edit } = makeEditor();
    const button = (action) => edit.panel.querySelector(`[data-act="history-${action}"]`);
    expect(button('undo').disabled).toBe(true);
    card._commit({ ...card._layout, hidden: ['device:lamp'] });
    card._hass.states['light.lounge'] = { state: 'on' };
    expect(button('undo').disabled).toBe(false);
    button('undo').focus();
    button('undo').click();
    expect(card._layout.hidden).toEqual([]);
    expect(button('redo').disabled).toBe(false);
    expect(document.activeElement).toBe(button('redo'));
    button('redo').click();
    expect(card._layout.hidden).toEqual(['device:lamp']);
    expect(card._hass.states['light.lounge'].state).toBe('on');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('records pointer and keyboard range changes as one gesture until change/release', () => {
    const { card, edit } = makeEditor();
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.1'; slider.dataset.field = 'ov-opacity';
    edit.panel.append(slider);
    slider.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    for (const value of ['0.7', '0.8', '0.9']) {
      slider.value = value;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(card._history.size).toBe(0);
    expect(edit.panel.querySelector('[data-act="history-undo"]').disabled).toBe(true);
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(card._history.size).toBe(1);
    card.undoEdit();
    expect(card._layout.mower.overlay.opacity).toBe(0.6);
    card.redoEdit();
    expect(card._layout.mower.overlay.opacity).toBe(0.9);
    edit.panel.append(slider);
    slider.value = '0.4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(card._history.size).toBe(2);
    card.undoEdit();
    expect(card._layout.mower.overlay.opacity).toBe(0.9);
    edit.panel.append(slider);
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    for (const value of ['0.8', '0.7', '0.6']) {
      slider.value = value;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(card._history.grouping).toBe(true);
    slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
    expect(card._history.grouping).toBe(false);
    card.undoEdit();
    expect(card._layout.mower.overlay.opacity).toBe(0.9);
  });

  it('groups many saved map drag positions, and records the final room shape after releasing', () => {
    const { card, edit } = makeEditor();
    edit._planPoint = (event) => [event.clientX, event.clientY];
    edit._startWindowDrag({ kind: 'overlay', start: [0, 0], floorId: 'ground', plan: [0, 0], origin: [0, 0] });
    edit._dragMove({ clientX: 10, clientY: 6 });
    edit._dragMove({ clientX: 12, clientY: 8 });
    edit._dragEnd();
    expect(card._history.size).toBe(1);
    expect(card._history.undoLabel).toBe('Move map');
    card.undoEdit();
    expect(card._layout.mower.overlay.x).toBe(0);
    card.redoEdit();
    expect(card._layout.mower.overlay.x).toBe(12);
    const room = { id: 'r1', area_id: 'lounge', polygon: [[0, 0], [4, 0], [4, 3]] };
    edit._startWindowDrag({ kind: 'vertex', moved: true, preview: room });
    edit._dragEnd();
    expect(card._history.undoLabel).toBe('Edit room shape');
    card.undoEdit();
    expect(card._layout.rooms).toEqual([]);
    card.redoEdit();
    expect(card._layout.rooms).toEqual([room]);
  });

  it('keeps a held keyboard slider alive when its change handler asks to rerender', () => {
    const { card, edit } = makeEditor();
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '255'; slider.dataset.field = 'mower-img-tolerance';
    edit.panel.append(slider);
    slider.focus();
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    for (const value of ['5', '6', '7']) {
      slider.value = value;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(document.activeElement).toBe(slider);
    expect(slider.isConnected).toBe(true);
    expect(card._history.size).toBe(0);
    slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(card._history.size).toBe(1);
    expect(card._layout.mower.image.tolerance).toBe(7);
    card.undoEdit();
    expect(card._layout.mower.image).toBeUndefined();
  });

  it('uses Ctrl/Cmd Z, Shift Z and Y while leaving native text editing and composition alone', () => {
    const { card, edit } = makeEditor();
    card._commit({ ...card._layout, hidden: ['device:lamp'] });
    const key = (target, options) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
      target.dispatchEvent(event);
      return event;
    };
    expect(key(document.body, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(card._layout.hidden).toEqual([]);
    key(document.body, { key: 'Z', metaKey: true, shiftKey: true });
    expect(card._layout.hidden).toEqual(['device:lamp']);
    key(document.body, { key: 'z', metaKey: true });
    key(document.body, { key: 'y', ctrlKey: true });
    expect(card._layout.hidden).toEqual(['device:lamp']);
    const calls = card.undoEdit.mock.calls.length;
    const input = document.createElement('input');
    edit.panel.append(input);
    expect(key(input, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false);
    const rich = document.createElement('div'); rich.setAttribute('contenteditable', 'true');
    const span = document.createElement('span'); rich.append(span); edit.panel.append(rich);
    expect(key(span, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false);
    key(document.body, { key: 'z', ctrlKey: true, isComposing: true });
    key(document.body, { key: 'z', ctrlKey: true, altKey: true });
    expect(card.undoEdit.mock.calls).toHaveLength(calls);
    expect(historyShortcut({ key: 'z', ctrlKey: true, defaultPrevented: true })).toBeNull();
  });

  it('scopes Undo/Redo to the focused editor across multiple cards and shadow roots', () => {
    const first = makeEditor(), second = makeEditor();
    first.card._commit({ ...first.card._layout, hidden: ['first'] });
    second.card._commit({ ...second.card._layout, hidden: ['second'] });
    const host = document.createElement('taylors3d-card');
    host.attachShadow({ mode: 'open' }).append(second.edit.panel); document.body.append(host);
    const key = (target, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey, bubbles: true, composed: true, cancelable: true });
      target.dispatchEvent(event); return event;
    };
    let button = second.edit.panel.querySelector('[data-act="history-undo"]'); button.focus();
    expect(key(button).defaultPrevented).toBe(true);
    expect(second.card._layout.hidden).toEqual([]);
    expect(first.card._layout.hidden).toEqual(['first']);
    expect(first.card.undoEdit).not.toHaveBeenCalled();
    // A retargeted body event still uses the deepest currently focused editor.
    expect(key(document.body, true).defaultPrevented).toBe(true);
    expect(second.card._layout.hidden).toEqual(['second']);
    button = first.edit.panel.querySelector('[data-act="history-undo"]'); button.focus();
    key(button);
    expect(first.card._layout.hidden).toEqual([]);
    button = first.edit.panel.querySelector('[data-act="history-redo"]'); button.blur();
    expect(key(document.body, true).defaultPrevented).toBe(false);
    expect(first.card._layout.hidden).toEqual([]);
  });

  it('resets configuration history after a successful GLB replacement or removal', async () => {
    const { card, edit } = makeEditor();
    card._commit({ ...card._layout, hidden: ['device:lamp'] });
    card._hass.fetchWithAuth = vi.fn(async () => ({ ok: true, json: async () => ({ name: 'house.glb', version: 'v2', size: 100 }) }));
    await edit._uploadModel(new File(['model bytes'], 'house.glb'));
    expect(card._layout.model.version).toBe('v2');
    expect(card._history.canUndo).toBe(false);
    card._commit({ ...card._layout, model: { ...card._layout.model, scale: 2 } });
    expect(card._history.canUndo).toBe(true);
    await edit._removeModel();
    expect(card._layout.model).toBeNull();
    expect(card.resetHistory).toHaveBeenCalledTimes(2);
    expect(card._history.canUndo).toBe(false);
  });

  it('saves the current camera mode and pose with new named views and camera presets', async () => {
    const { card, edit } = makeEditor();
    const camera = { position: [4, 8, 12], target: [1, 0, 1] };
    const top = { center: [2, 3], zoom: 1.5 };
    card._view.getCamera = () => camera;
    card._view.getTopCamera = () => top;
    card._views = [{ id: 'all', label: 'All', rules: [{ hide: 'layer:roof' }] }];
    edit._vwView = () => card._views[0];
    card.leaveSection = vi.fn();
    card._setView = vi.fn();
    card.saveViewPatch = (id, patch) => card._commit({ ...card._layout, views: { ...card._layout.views, [id]: { ...card._layout.views?.[id], ...patch } } });
    card._mode = 'top';
    edit._viewsClick('vw-add', document.createElement('button'));
    await Promise.resolve();
    expect(card._layout.views.view_1).toMatchObject({ camera_mode: 'top', camera_top: top, rules: [{ hide: 'layer:roof' }] });
    expect(card._setView).toHaveBeenCalledWith('view_1');
    card._mode = '3d';
    edit._viewsClick('vw-save-cam', document.createElement('button'));
    expect(card._layout.views.all).toMatchObject({ camera_mode: '3d', camera });
  });

  it('copies the chosen floors and section into a new view instead of widening it to all floors', async () => {
    const { card, edit } = makeEditor();
    const current = { id: 'ground', label: 'Ground', floors: ['ground'], rules: [], section: { normal: [-1, 0, 0], constant: 4 } };
    card._mode = '3d'; card._views = [current]; card._view.getCamera = () => ({ position: [1, 5, 8], target: [1, 0, 1] });
    card._setView = vi.fn(); edit._vwView = () => current;
    edit._viewsClick('vw-add', document.createElement('button')); await Promise.resolve();
    current.floors.push('first'); current.section.normal[0] = 1;
    const added = resolveViews({ floors: [{ id: 'ground', name: 'Ground' }, { id: 'first', name: 'First' }], layoutViews: card._layout.views }).find((view) => view.source === 'added');
    expect(added.floors).toEqual(['ground']);
    expect(added.section).toEqual({ normal: [-1, 0, 0], constant: 4 });
    expect(card._setView).toHaveBeenCalledWith(added.id);
    // An explicitly roomless view retains an empty floor list.
    current.floors = []; current.section = null;
    edit._viewsClick('vw-add', document.createElement('button')); await Promise.resolve();
    expect(card._layout.views.view_2.floors).toEqual([]);
  });

  it('cancels transient tools and ignores an upload that finishes after a layout switch', async () => {
    const { card, edit } = makeEditor();
    let complete;
    card._hass.fetchWithAuth = () => new Promise((resolve) => { complete = resolve; });
    const upload = edit._uploadModel(new File(['old model'], 'old.glb'));
    edit._startWindowDrag({ kind: 'overlay', start: [0, 0], floorId: 'ground', plan: [0, 0], origin: [0, 0] });
    edit.drawing = { points: [[1, 2]] }; edit.selectedRoom = 'old-room';
    edit.cancelHistoryGestures();
    card._config = { layout_key: 'new-layout' };
    card._layout = { rooms: [], model: { version: 'new-model' } };
    complete({ ok: true, json: async () => ({ name: 'old.glb', version: 'old-model', size: 100 }) });
    await upload;
    expect(card._layout.model.version).toBe('new-model');
    expect(card.resetHistory).not.toHaveBeenCalled();
    expect(card._history.grouping).toBe(false);
    expect(edit.drag).toBeNull(); expect(edit.drawing).toBeNull(); expect(edit.selectedRoom).toBeNull();
    expect(edit.uploading).toBeNull();
  });

  it('ignores a model deletion or imported file that completes after a reload/layout-key switch', async () => {
    const { card, edit } = makeEditor();
    let finishDelete, finishFile;
    card._hass.fetchWithAuth = () => new Promise((resolve) => { finishDelete = resolve; });
    const deletion = edit._removeModel();
    const file = { text: () => new Promise((resolve) => { finishFile = resolve; }) };
    edit._onPanelChange({ target: { dataset: { field: 'import' }, files: [file], value: '' } });
    edit.cancelHistoryGestures(); card._config = { layout_key: 'next' };
    card._layout = { rooms: [], model: { version: 'keep-this' } };
    finishDelete({ ok: true });
    finishFile(JSON.stringify({ version: 1, rooms: [], pins: {}, floors: [], hidden: [] }));
    await deletion; await Promise.resolve();
    expect(card._layout.model.version).toBe('keep-this');
    expect(card.resetHistory).not.toHaveBeenCalled();
  });

  it('saves a browser screen name through its visual field without editing the shared layout', () => {
    const { card, edit } = makeEditor();
    card.currentView = () => null;
    card.setPanelName = vi.fn((value) => { card._panelName = value.trim(); });
    edit.tab = 'views'; edit.render();
    const input = edit.panel.querySelector('[data-field="screen-name"]');
    input.value = ' kitchen-wall ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    edit.render();
    expect(edit.panel.querySelector('[data-field="screen-name"]').value).toBe(' kitchen-wall ');
    edit.panel.querySelector('[data-act="save-screen-name"]').click();
    expect(card.setPanelName).toHaveBeenCalledWith(' kitchen-wall ');
    expect(card._panelName).toBe('kitchen-wall');
    expect(card._history.size).toBe(0);
  });
});
