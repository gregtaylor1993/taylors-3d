// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomControlsView } from '../src/custom-controls-view.js';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';
import '../src/taylors3d-card.js';

const prototype = customElements.get('taylors3d-card').prototype;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const views = [];
const editors = [];
function fixture() {
  const room = { id: 'room', floor_id: 'ground', area_id: 'lounge' };
  const c = { isConnected: true, _editing: false, _loading: false, _store: {}, _config: { layout_key: 'home', model: '/simulated.glb' },
    _layout: { custom_controls: { version: 1, bars: [{ id: 'evening', label: 'Evening', placement: 'bottom', style: 'pills',
      buttons: [{ id: 'movie', label: 'Movie', icon: 'mdi:movie', color: 'amber', action: { type: 'scene', entity: 'scene.movie' } }] }] } },
    _views: [], _roomList: [{ room, floorId: 'ground' }], _floors: [{ id: 'ground', elevation: 0 }],
    _hass: { user: { id: 'current', is_admin: true, is_active: true }, auth: {}, connection: { connected: true },
      states: { 'scene.movie': { entity_id: 'scene.movie', state: 'unknown', attributes: {} } }, entities: {}, devices: {},
      services: { scene: { turn_on: {} } }, callService: vi.fn(async () => {}) },
    _stage: document.createElement('div'), _objects: { setModel: vi.fn() }, _edit: { _customControlsEditor: { observe: vi.fn() }, onModelLoaded: vi.fn() },
    _view: { model: { id: '/old.glb', root: {} }, setModel: vi.fn(), setDaylight: vi.fn() } };
  for (const name of ['_customControlsSettings', '_customControlsRooms', '_customControlContext', '_syncCustomControls', '_runCustomControl']) c[name] = prototype[name];
  for (const name of ['_syncModelRendering', '_mergeKeepSelectors', '_suspendAmbient', '_stopScenePreview', '_endGesture', '_updateObjects',
    '_refreshAttached', '_showNotice', '_syncToolbar', '_schedule', '_syncWallPresentation', '_moreInfo', '_setView', '_applySky']) c[name] = vi.fn();
  c._syncBindings = () => false; c._popup = { close: vi.fn() }; c._devicePopup = { close: vi.fn() };
  const host = document.createElement('div'); document.body.append(host);
  c._customControlsHost = host; c._customControlsView = new CustomControlsView(host, {
    getContext: () => c._customControlContext(), onAction: (bar, button) => c._runCustomControl(bar, button),
  }); views.push(c._customControlsView);
  return c;
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); views.splice(0).forEach((view) => view.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

function editingFixture() {
  const c = fixture(); c._editing = true; c._built = {}; c._mode = 'top'; c._floor = 'ground'; c._markers = []; c._positions = new Map();
  c._layout = { ...c._layout, rooms: [], pins: {}, floors: c._floors }; c._store.backend = 'shared';
  Object.assign(c._hass, { areas: {}, floors: {}, callWS: vi.fn() });
  c._applyMarkerSelection = vi.fn(); c.modelBindings = () => null;
  for (const name of ['setOverlay', 'setPivotMarker', 'setStems', 'setControlsEnabled', 'highlightModelNode']) c._view[name] = vi.fn();
  c._view.floorElevation = () => 0; c._view.pixelsPerMetre = () => 10; c._view.model = null;
  c._history = new EditHistory(); c._history.reset({ layout: c._layout, config: c._config });
  const edit = new EditMode(c); c._edit = edit; editors.push(edit); c._stage.append(edit.panel); document.body.append(c._stage);
  c.commitFeatureLayout = vi.fn((patch) => { c._layout = { ...c._layout, ...patch }; c._history.record({ layout: c._layout, config: c._config }, 'Buttons'); });
  const restore = (kind) => { const state = c._history[kind](); if (state) c._layout = state.layout; edit.render(); };
  c.undoEdit = () => restore('undo'); c.redoEdit = () => restore('redo');
  edit.render(); edit.attach();
  return { c, edit, click: (selector) => { const node = edit.panel.querySelector(selector); expect(node).toBeTruthy(); node.click(); } };
}

describe('custom buttons in the actual card adapter', () => {
  it('uses own shared settings without calling an accessor or reviving an inactive config', () => {
    const c = fixture(), getter = vi.fn(() => undefined);
    c._config.custom_controls = c._layout.custom_controls; c._layout = { custom_controls: null };
    expect(c._customControlsSettings()).toBeNull(); expect(c._customControlContext().bars).toEqual([]);
    Object.defineProperty(c._layout, 'custom_controls', { get: getter }); c._customControlContext();
    expect(getter).not.toHaveBeenCalled(); expect(c._hass.callService).not.toHaveBeenCalled();
  });
  it('rejects an obsolete room, stale floor and foreign popup before any command', () => {
    const c = fixture(); c._layout.custom_controls.bars[0] = { ...c._layout.custom_controls.bars[0], placement: 'room', room_id: 'room' };
    expect(c._runCustomControl('evening', 'movie', 'room', 'room').ok).toBe(false);
    c._devicePopup = { isOpen: true, _session: 1, _selection: { kind: 'room', room: { id: 'room' } } };
    c._floors[0].stale = true;
    expect(c._runCustomControl('evening', 'movie', 'room', 'room').ok).toBe(false);
    delete c._floors[0].stale; c._roomList[0].room.floor_id = 'foreign-floor';
    expect(c._runCustomControl('evening', 'movie', 'room', 'room').ok).toBe(false);
    expect(c._hass.callService).not.toHaveBeenCalled();
  });
  it('suspends an actual pending model request and fences a held native press after settlement', async () => {
    const c = fixture(), pending = deferred(), native = c._customControlsView.el.querySelector('button');
    c._view.setModel.mockReturnValue(pending.promise);
    native.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    const load = prototype._loadModel.call(c);
    expect(c._customControlsModelLoad.promise).toBe(pending.promise); expect(c._customControlsView.el.hidden).toBe(true);
    expect(c._runCustomControl('evening', 'movie').ok).toBe(false);
    pending.resolve(null); await load;
    expect(c._customControlsModelLoad).toBeNull(); expect(c._customControlsView.el.hidden).toBe(false);
    native.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); native.click();
    expect(c._hass.callService).not.toHaveBeenCalled();
    native.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    native.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); native.click();
    expect(c._hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.movie' });
  });
  it('keeps a newer model request suspended when an obsolete request finishes', async () => {
    const c = fixture(), old = deferred(), next = deferred();
    c._view.setModel.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const first = prototype._loadModel.call(c); c._config.model = '/next.glb'; const second = prototype._loadModel.call(c);
    old.resolve(null); await first; expect(c._customControlsModelLoad.promise).toBe(next.promise);
    expect(c._runCustomControl('evening', 'movie').ok).toBe(false);
    next.resolve(null); await second; expect(c._customControlsModelLoad).toBeNull();
  });
  it('observes model alignment changes even when the same root and saved action remain', () => {
    const c = fixture(), first = c._customControlContext().contextKey;
    c._config.model_rotation = 90; expect(c._customControlContext().contextKey).not.toBe(first);
    c._config.model_rotation = undefined; expect(c._customControlContext().contextKey).not.toBe(first);
  });
  it('entering the actual controls tab ends room tools and prevents old canvas/marker handlers from leaving it', () => {
    const { c, edit, click } = editingFixture();
    edit.drawing = { floorId: 'ground', points: [] }; edit.calibrating = { src: [1, 2] };
    edit.doorMode = edit.colorPick = edit.overlayMove = true; edit.selectedRoom = 'room'; edit.selectedMarker = 'marker';
    click('[data-act="tab"][data-id="controls"]');
    expect(edit.drawing).toBeNull(); expect(edit.calibrating).toBeNull(); expect(edit.selectedRoom).toBeNull(); expect(edit.selectedMarker).toBeNull();
    const event = { button: 0, stopPropagation: vi.fn(), preventDefault: vi.fn(), clientX: 1, clientY: 1 };
    edit.canvasDown(event); edit.canvasUp(event); edit.markerDown({ id: 'marker' }, event); edit.selectRoom('room'); edit.selectMarker('marker');
    expect(edit.tab).toBe('controls'); expect(edit.drag).toBeNull(); expect(c.commitFeatureLayout).not.toHaveBeenCalled(); expect(c._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps a focused draft across HA updates and saves one undoable layout change without actions', () => {
    const { c, edit, click } = editingFixture(); click('[data-act="tab"][data-id="controls"]');
    const field = edit.panel.querySelector('[data-field="custom-controls-button-label"]'); field.focus(); field.value = 'My evening';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    c._hass.language = 'fr'; c._hass.locale = { language: 'fr' }; edit.onStates(); edit.afterUpdate();
    expect(edit.panel.querySelector('[data-field="custom-controls-button-label"]')).toBe(field); expect(document.activeElement).toBe(field);
    expect(c._layout.custom_controls.bars[0].buttons[0].label).toBe('Movie');
    click('[data-act="custom-controls-save"]'); expect(c.commitFeatureLayout).toHaveBeenCalledOnce(); expect(c._history.size).toBe(1);
    expect(c._layout.custom_controls.bars[0].buttons[0].label).toBe('My evening');
    click('[data-act="history-undo"]'); expect(c._layout.custom_controls.bars[0].buttons[0].label).toBe('Movie');
    click('[data-act="history-redo"]'); expect(c._layout.custom_controls.bars[0].buttons[0].label).toBe('My evening');
    expect(c._hass.callService).not.toHaveBeenCalled(); expect(c._hass.callWS).not.toHaveBeenCalled();
  });
});
