// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';

const editors = [];
function setup() {
  const card = { _config: { layout_key: 'house' }, _layout: { rooms: [], pins: {} }, _built: {},
    _hass: { states: {}, entities: {}, areas: {}, floors: {}, devices: {}, callService: vi.fn() },
    _floors: [{ id: 'ground', elevation: 0 }, { id: 'up', elevation: 3 }], _floor: 'ground', _mode: '3d',
    _editing: true, _stage: document.createElement('div'), _history: { canUndo: false, canRedo: false },
    _markers: [], _roomList: [], _positions: new Map(), _store: { backend: 'browser' },
    _applyMarkerSelection: vi.fn(), _commit: vi.fn(), modelBindings: () => null, alignment: { scale: 1 },
    _view: { model: null, floorElevation: (id) => id === 'up' ? 3 : id === 'ground' ? 0 : NaN,
      planPoint: vi.fn(() => [1.237, 4.823]), setOverlay: vi.fn(), setPivotMarker: vi.fn(),
      setControlsEnabled: vi.fn(), highlightModelNode: vi.fn() } };
  card._modelAlign = () => card.alignment;
  card._navigationFloors = () => [card._floor];
  card._setFloor = vi.fn((id) => { card._floor = id; });
  card._setMode = vi.fn((mode) => { card._mode = mode; });
  const edit = new EditMode(card); card._edit = edit; edit.tab = 'tracking';
  edit._trackingEditor.dispose();
  const tracker = { pendingPlanPick: null, render: () => '<p>Draft coordinates</p>',
    onClick: () => false, updatePreviews: vi.fn(), calibrationOverlay: vi.fn(() => null),
    acceptPlanPoint: vi.fn(), cancelPlanPick: vi.fn(), reset: vi.fn(), cancel: vi.fn(), dispose: vi.fn() };
  tracker.cancelPlanPick.mockImplementation(() => { tracker.pendingPlanPick = null; edit.beginTrackingPlanPick(null); });
  tracker.reset.mockImplementation(() => tracker.cancelPlanPick()); tracker.cancel.mockImplementation(() => tracker.cancelPlanPick());
  edit._trackingEditor = tracker; card._stage.append(edit.panel); document.body.append(card._stage); edit.attach(); editors.push(edit);
  const arm = (floorId = 'up', token = 'tracking-1-1') => {
    tracker.pendingPlanPick = { token, floorId }; return edit.beginTrackingPlanPick(tracker.pendingPlanPick);
  };
  return { card, edit, tracker, arm };
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); });

describe('visual tracking calibration through the plan pointer', () => {
  it('shows the explicitly chosen floor and Top mode, then passes an unsnapped point and token without saving', () => {
    const { card, edit, tracker, arm } = setup(); expect(arm()).toBe(true);
    expect(card._setFloor).toHaveBeenCalledExactlyOnceWith('up'); expect(card._setMode).toHaveBeenCalledExactlyOnceWith('top');
    edit._click({ clientX: 123, clientY: 456 });
    expect(card._view.planPoint).toHaveBeenCalledExactlyOnceWith(123, 456, 3);
    expect(tracker.acceptPlanPoint).toHaveBeenCalledExactlyOnceWith([1.237, 4.823], 'up', 'tracking-1-1');
    expect(card._commit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
    expect(edit.selectedRoom).toBeNull();
  });
  it('ignores an orbit drag and accepts only a subsequent click inside the existing click slop', () => {
    const { edit, tracker, arm } = setup(); arm();
    edit.canvasDown({ button: 0, clientX: 10, clientY: 20 }); edit.canvasUp({ clientX: 18, clientY: 20 });
    expect(tracker.acceptPlanPoint).not.toHaveBeenCalled();
    edit.canvasDown({ button: 0, clientX: 10, clientY: 20 }); edit.canvasUp({ clientX: 12, clientY: 21 });
    expect(tracker.acceptPlanPoint).toHaveBeenCalledOnce();
  });
  it('never substitutes another floor for a missing source floor', () => {
    const { card, edit, tracker, arm } = setup(); expect(arm('missing')).toBe(false);
    edit._click({ clientX: 1, clientY: 2 });
    expect(tracker.cancelPlanPick).toHaveBeenCalledOnce(); expect(tracker.acceptPlanPoint).not.toHaveBeenCalled();
    expect(card._setFloor).not.toHaveBeenCalled(); expect(card._view.planPoint).not.toHaveBeenCalled();
  });
  it.each(['generation', 'layout', 'model', 'alignment', 'floor_visibility'])('cancels a captured click after the %s context changes', (change) => {
    const { card, edit, tracker, arm } = setup(); arm();
    if (change === 'generation') edit._generation++;
    if (change === 'layout') card._config.layout_key = 'other-house';
    if (change === 'model') card._view.model = {};
    if (change === 'alignment') card.alignment = { scale: 2 };
    if (change === 'floor_visibility') card._floor = 'ground';
    edit._click({ clientX: 2, clientY: 3 });
    expect(tracker.cancelPlanPick).toHaveBeenCalledOnce(); expect(tracker.acceptPlanPoint).not.toHaveBeenCalled();
    expect(card._view.planPoint).not.toHaveBeenCalled(); expect(card._commit).not.toHaveBeenCalled();
  });
  it('ignores an older token after another captured source point replaces it', () => {
    const { edit, tracker, arm } = setup(); arm(); tracker.pendingPlanPick = { token: 'tracking-1-2', floorId: 'up' };
    edit._click({ clientX: 2, clientY: 3 }); expect(tracker.acceptPlanPoint).not.toHaveBeenCalled(); expect(tracker.cancelPlanPick).toHaveBeenCalledOnce();
  });
  it('cancels the captured point immediately when a view hides its floor, before any canvas gesture', () => {
    const { card, edit, tracker, arm } = setup(); arm(); edit.canvasMove({ clientX: 2, clientY: 3 });
    card._floor = 'ground'; edit.onViewChanged();
    expect(tracker.pendingPlanPick).toBeNull(); expect(edit._trackingPickCursor).toBeNull();
    expect(card._stage.classList.contains('drawing')).toBe(false); expect(tracker.updatePreviews).toHaveBeenCalledWith(edit.panel);
    expect(tracker.acceptPlanPoint).not.toHaveBeenCalled(); expect(card._commit).not.toHaveBeenCalled();
  });
  it('draws numbered draft points on their actual floor and ignores invalid coordinates', () => {
    const { card, edit, tracker } = setup(); tracker.calibrationOverlay.mockReturnValue({ floorId: 'up',
      points: [{ index: 0, label: '1', x: 1.237, y: 4.823 }, { index: 1, label: '2', x: 7.1, y: 8.2 }, { index: 2, x: NaN, y: 0 }],
      mapped: [3.5, 4.5], status: 'ready' }); edit.refreshOverlay();
    const overlay = card._view.setOverlay.mock.lastCall[0];
    expect(overlay.lines[0]).toMatchObject({ points: [[1.237, 4.823], [7.1, 8.2]], floorId: 'up' });
    expect(overlay.handles).toHaveLength(3); expect(overlay.handles.every((h) => h.floorId === 'up')).toBe(true);
    expect(overlay.handles[0].element.textContent).toBe('1'); expect(overlay.handles[0].element.style.pointerEvents).toBe('none');
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('shows a crosshair cursor without altering or saving the captured source reading', () => {
    const { card, edit, tracker, arm } = setup(); arm(); const captured = tracker.pendingPlanPick;
    edit.canvasMove({ clientX: 10, clientY: 20 });
    expect(card._stage.classList.contains('drawing')).toBe(true);
    const handles = card._view.setOverlay.mock.lastCall[0].handles;
    expect(handles).toHaveLength(1); expect(handles[0]).toMatchObject({ x: 1.237, y: 4.823, floorId: 'up' });
    expect(tracker.pendingPlanPick).toBe(captured); expect(tracker.acceptPlanPoint).not.toHaveBeenCalled(); expect(card._commit).not.toHaveBeenCalled();
  });
  it('Escape cancels the pending point, removes its cursor and does not save', () => {
    const { card, edit, tracker, arm } = setup(); arm(); edit.canvasMove({ clientX: 2, clientY: 3 });
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); document.body.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true); expect(tracker.pendingPlanPick).toBeNull(); expect(edit._trackingPickCursor).toBeNull();
    expect(card._stage.classList.contains('drawing')).toBe(false); expect(card._commit).not.toHaveBeenCalled();
  });
  it('Tracking canvas and ordinary marker taps cannot switch to room/device editing', () => {
    const { card, edit } = setup(); edit._click({ clientX: 1, clientY: 2 });
    edit.markerDown({ id: 'entity:lamp' }, { button: 0, stopPropagation: vi.fn(), preventDefault: vi.fn() });
    expect(edit.tab).toBe('tracking'); expect(edit.selectedMarker).toBeNull(); expect(card._view.planPoint).not.toHaveBeenCalled(); expect(card._commit).not.toHaveBeenCalled();
  });
});
