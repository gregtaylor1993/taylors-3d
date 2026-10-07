// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';
import '../src/taylors3d-card.js';

const editors = [];
const hash = 'a'.repeat(64), packId = 'b'.repeat(64);
const catalogue = { version: 1, packs: [{ pack_id: packId, manifest: { name: 'Own furniture' },
  items: [{ id: 'chair', name: 'Chair', pack_id: packId, sha256: hash, unit: 'm', anchor: [0, 0, 0],
    url: `/api/taylors3d/furniture/assets/${hash}.glb` }] }] };
const row = (extra = {}) => ({ id: 'chair-1', pack_id: packId, item_id: 'chair', asset_sha256: hash,
  floor_id: 'ground', x: 1, y: 2, z: 0, rotation_degrees: 0, scale: 1, ...extra });

function setup({ instances = [], backend = 'shared' } = {}) {
  const floors = [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'first', name: 'First', elevation: 3 }];
  const card = { isConnected: true, _editing: true, _loading: false, _config: { layout_key: 'home' },
    _layout: { rooms: [], pins: {}, furniture: { version: 1, instances }, extra: { untouched: true } },
    _built: {}, _floor: 'ground', _mode: 'top', _floors: floors, _roomList: [], _markers: [], _positions: new Map(),
    _stage: document.createElement('div'), _store: { backend }, _history: new EditHistory(),
    _applyMarkerSelection: vi.fn(), modelBindings: () => null,
    _hass: { user: { id: 'taylor', is_active: true, is_admin: true }, connection: { connected: true },
      entities: {}, devices: {}, areas: {}, floors: {}, states: {}, callService: vi.fn(), callWS: vi.fn() },
    furnitureCatalogue: vi.fn(() => ({ status: 'ready', catalogue })), furniturePreviewDraft: vi.fn(),
    furnitureLibrary: { importPack: vi.fn() }, furnitureRefresh: vi.fn(),
    _view: { model: null, controls: { enabled: true }, floorElevation: (id) => floors.find((floor) => floor.id === id)?.elevation,
      setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(), setControlsEnabled: vi.fn(),
      highlightModelNode: vi.fn(), planPoint: vi.fn(() => [1, 1]), pixelsPerMetre: () => 10 } };
  const edit = new EditMode(card); card._edit = edit; editors.push(edit);
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  card._commit = vi.fn((next, label) => { card._layout = next; card._history.record(snapshot(), label); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch, label) => card._commit({ ...card._layout, ...patch }, label));
  card.undoEdit = vi.fn(() => { const value = card._history.undo(); if (value) card._layout = value.layout; edit.render(); });
  card.redoEdit = vi.fn(() => { const value = card._history.redo(); if (value) card._layout = value.layout; edit.render(); });
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach();
  const action = (name, suffix = '') => edit.panel.querySelector(`[data-act="${name}"]${suffix}`);
  const click = (name, suffix = '') => { const node = action(name, suffix); expect(node).toBeTruthy(); node.click(); return node; };
  const furniture = () => click('tab', '[data-id="furniture"]');
  const field = (name) => edit.panel.querySelector(`[data-field="furniture-${name}"]`);
  const change = (name, value, type = 'input') => { const node = field(name); expect(node).toBeTruthy(); node.focus(); node.value = value;
    node.dispatchEvent(new Event(type, { bubbles: true })); return node; };
  return { card, edit, action, click, furniture, field, change };
}

afterEach(() => { editors.splice(0).forEach((edit) => { edit.card._endGesture?.(); edit.dispose(); }); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('Furniture in the actual editor', () => {
  it.each(['browser', 'shared', 'user'])('opens an empty Furniture tab without saving or choosing a pack in %s storage', (backend) => {
    const { card, edit, furniture, field, action } = setup({ backend }); furniture();
    expect(edit.tab).toBe('furniture'); expect(field('new-pack').value).toBe('');
    expect(action('furniture-save').disabled).toBe(true); expect(card._commit).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('previews a position draft, saves once and restores it with ordinary Undo/Redo', () => {
    const original = row(), { card, furniture, change, click } = setup({ instances: [original] }); furniture();
    change('x', '4'); expect(card._layout.furniture.instances[0].x).toBe(1); expect(card._commit).not.toHaveBeenCalled();
    expect(card.furniturePreviewDraft).toHaveBeenCalledWith(expect.objectContaining({ instances: [expect.objectContaining({ x: 4 })] }));
    click('furniture-save'); click('furniture-save'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
    expect(card._layout.furniture.instances[0].x).toBe(4); expect(card._layout.extra).toEqual({ untouched: true });
    expect(card._history.size).toBe(1); click('history-undo'); expect(card._layout.furniture.instances[0].x).toBe(1);
    click('history-redo'); expect(card._layout.furniture.instances[0].x).toBe(4); expect(original.x).toBe(1);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps a focused native position field during state, rebuild and view updates', () => {
    const { card, edit, furniture, change, field } = setup({ instances: [row()] }); furniture();
    const input = change('x', '3.5'); edit.onStates(); edit.afterUpdate(); edit.onViewChanged();
    expect(field('x')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('3.5');
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('preserves the focused decimal text inside the actual shadow-root boundary', () => {
    const { card, edit, furniture, change, field } = setup({ instances: [row()] });
    const shadow = card._stage.attachShadow({ mode: 'open' }); shadow.append(edit.panel); furniture();
    const input = change('x', '1.20'); edit.onStates(); edit.afterUpdate();
    expect(shadow.activeElement).toBe(input); expect(document.activeElement).toBe(card._stage);
    expect(field('x')).toBe(input); expect(input.value).toBe('1.20');
    expect(edit._furnitureEditor.draft.instances[0].x).toBe(1.2);
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('cancels preview on tab leave without changing saved furniture', () => {
    const { card, edit, furniture, change, click } = setup({ instances: [row()] }); furniture(); change('x', '4');
    click('tab', '[data-id="rooms"]'); expect(edit.tab).toBe('furniture'); expect(edit._furnitureEditor.dirty).toBe(true);
    click('draft-leave-discard'); expect(edit._furnitureEditor.draft).toBeNull();
    expect(card.furniturePreviewDraft).toHaveBeenLastCalledWith(null); expect(card._layout.furniture.instances[0].x).toBe(1);
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('removes old room tools and ignores rooms, markers and old handles in Furniture', () => {
    const { card, edit, furniture } = setup(); edit.drawing = { points: [[0, 0]], floorId: 'ground' };
    edit.calibrating = { src: [1, 1] }; edit.colorPick = edit.doorMode = edit.overlayMove = true;
    edit.selectedRoom = 'lounge'; edit.selectedMarker = 'device:lamp';
    edit.drag = { kind: 'marker', id: 'device:lamp', moved: true, pos: { x: 2, y: 2, z: 1, floorId: 'ground' } }; furniture();
    expect(edit.drawing || edit.calibrating || edit.doorMode || edit.colorPick || edit.overlayMove || edit.selectedRoom || edit.selectedMarker || edit.drag).toBeFalsy();
    card._positions.set('device:lamp', { x: 1, y: 1, z: 1, floorId: 'ground' });
    const event = { button: 0, clientX: 10, clientY: 10, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    edit._dragEnd(event); edit.canvasDown(event); edit.canvasUp(event); edit.markerDown({ id: 'device:lamp' }, event);
    edit._vertexDown(event, 'lounge', 0); edit._midDown(event, 'lounge', 0);
    expect(edit.tab).toBe('furniture'); expect(card._view.planPoint).not.toHaveBeenCalled();
    expect(card._layout.pins).toEqual({}); expect(card._commit).not.toHaveBeenCalled();
  });
  it('rejects saving while the layout reloads, even after the connection returns', () => {
    const { card, edit, furniture, change, action, click } = setup({ instances: [row()] }); furniture(); change('x', '4');
    card._loading = true; edit.onStates(); expect(action('furniture-save').disabled).toBe(true);
    card._loading = false; edit.onStates(); click('furniture-save'); expect(card._commit).not.toHaveBeenCalled();
    click('furniture-cancel'); change('x', '5'); click('furniture-save'); expect(card._layout.furniture.instances[0].x).toBe(5);
  });
  it('cleans draft and drag on history reset, detach and permanent disposal', () => {
    const { card, edit, furniture, change, field } = setup({ instances: [row()] }); furniture(); change('x', '4');
    edit.cancelHistoryGestures(); expect(edit._furnitureEditor.draft).toBeNull(); expect(edit._furnitureDrag.active).toBe(false);
    edit.render(); change('x', '5'); edit.detach(); expect(edit._furnitureEditor.draft).toBeNull();
    expect(edit._furnitureEditor.disposed).toBe(false); edit.attach(); edit.render(); expect(field('x').value).toBe('1');
    edit.dispose(); expect(edit._furnitureEditor.disposed).toBe(true); expect(edit._furnitureDrag.disposed).toBe(true);
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('cancels a held house-object gesture when a keyboard tab change opens Furniture', () => {
    const { card, edit, furniture } = setup(), prototype = customElements.get('taylors3d-card').prototype;
    edit.tab = 'objects'; edit.selectObject = vi.fn(); card._ambientWakeEvents = new Set(); card._popup = {}; card._devicePopup = {};
    card._objectTapsOn = () => true; card._objectHit = () => 'house-lamp'; card._endGesture = prototype._endGesture.bind(card);
    const canvas = document.createElement('canvas'); card._stage.append(canvas);
    prototype._objectDown.call(card, { button: 0, isPrimary: true, pointerId: 7, clientX: 10, clientY: 10,
      target: canvas, composedPath: () => [canvas] }, canvas);
    expect(card._gesture).toBeTruthy(); furniture();
    const up = new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }); Object.defineProperty(up, 'pointerId', { value: 7 });
    window.dispatchEvent(up); expect(edit.selectObject).not.toHaveBeenCalled(); expect(card._gesture).toBeNull();
  });
});
