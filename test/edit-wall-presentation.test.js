// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';
import { wallTargetReport } from '../src/wall-presentation.js';

const instances = [];
const face = { space: 'node-local', point: [.125, 1.345, -.25], normal: [0, 0, 1] };
const row = (extra = {}) => ({ id: 'wall-1', label: 'Front wall', enabled: true, selector: 'node:House/Wall', face, floor_id: 'ground', future: { keep: 1 }, ...extra });
const policy = (extra = {}) => ({ enabled: true, mode: 'fade', scope: 'camera_side', opacity: .2, future: ['keep'], walls: [row()], ...extra });
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

function setup({ layout = {}, config = {}, backend = 'shared', noModel = false, prepared = true } = {}) {
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, .1), new THREE.MeshStandardMaterial()); root.add(mesh);
  const candidates = { prepared, rows: [{ selector: 'node:House/Wall', label: 'Wall', node: mesh, selectable: true }], diagnostics: [] };
  const floors = [{ id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'first', name: 'First floor', elevation: 3 }];
  const card = { _config: { layout_key: 'house', ...config }, _layout: { rooms: [], pins: {}, floors, ...layout }, _built: {},
    _hass: { user: { id: 'taylor', is_admin: true }, states: {}, entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn(), callWS: vi.fn() },
    _floors: floors, _roomList: [], _floor: 'ground', _mode: '3d', _editing: true,
    _stage: document.createElement('div'), _markers: [], _positions: new Map(), _store: { backend }, _history: new EditHistory(),
    _applyMarkerSelection: vi.fn(), modelBindings: () => null, _modelAlign: () => ({ scale: 1 }),
    finishWallSelectionPreparation: vi.fn(),
    _view: { model: noModel ? null : { root }, floorElevation: (id) => floors.find((floor) => floor.id === id)?.elevation,
      setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(), setControlsEnabled: vi.fn(), highlightModelNode: vi.fn(),
      planPoint: vi.fn(() => [1, 1]), pickModel: vi.fn(() => null), pixelsPerMetre: () => 10,
      captureWallSurfacePick: vi.fn(() => ({ selector: 'node:House/Wall', label: 'Wall', face: structuredClone(face), modelRoot: card._view.model?.root })),
      wallPresentationCandidates: () => candidates,
      wallPresentationReport: () => wallTargetReport(card._layout.wall_presentation ?? card._config.wall_presentation, { index: { nodes: [{ path: 'House/Wall', node: mesh }] }, floors: card._layout.floors, modelRoot: card._view.model?.root }),
    } };
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  const edit = new EditMode(card); card._edit = edit; instances.push(edit);
  card._commit = vi.fn((value) => { card._layout = value; card._history.record(snapshot()); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch) => card._commit({ ...card._layout, ...patch }));
  card.undoEdit = vi.fn(() => { const saved = card._history.undo(); if (saved) card._layout = saved.layout; edit.render(); });
  card.redoEdit = vi.fn(() => { const saved = card._history.redo(); if (saved) card._layout = saved.layout; edit.render(); });
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach();
  const action = (name, selector = '') => edit.panel.querySelector(`[data-act="${name}"]${selector}`);
  const click = (name, selector = '') => { const control = action(name, selector); expect(control).toBeTruthy(); control.click(); return control; };
  const model = () => click('tab', '[data-id="model"]');
  const field = (name) => edit.panel.querySelector(`[data-field="wall-presentation-${name}"]`);
  const change = (name, value, type = 'input') => { const control = field(name); expect(control).toBeTruthy();
    if (control.type === 'checkbox') control.checked = value; else control.value = value; control.dispatchEvent(new Event(type, { bubbles: true })); return control; };
  const pointer = (x = 10, y = 10) => ({ button: 0, clientX: x, clientY: y, stopPropagation: vi.fn(), preventDefault: vi.fn() });
  const surfaceClick = () => { edit.canvasDown(pointer()); edit.canvasUp(pointer()); };
  return { card, edit, root, mesh, candidates, action, click, model, field, change, pointer, surfaceClick };
}

afterEach(() => { instances.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); });

describe('wall presentation in the actual Model editor', () => {
  it.each([
    ['YAML', { model: '/local/house.glb' }, 'browser', false],
    ['shared upload', {}, 'shared', false],
    ['no shared storage', {}, 'browser', false],
    ['no model', {}, 'shared', true],
  ])('shows Normal/off alongside shading for %s without a save or HA action', (_name, config, backend, noModel) => {
    const { card, edit, model, field } = setup({ config, backend, noModel }); model();
    expect(edit.panel.querySelector('[data-model-rendering-editor]')).not.toBeNull(); expect(edit.panel.querySelector('[data-wall-presentation-editor]')).not.toBeNull();
    expect(field('enabled').checked).toBe(false); expect(field('mode').value).toBe('normal');
    expect(card._commit).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('routes native fields into exactly one history edit, preserving imported extensions through Undo/Redo', () => {
    const original = policy(), { card, model, change, click, field } = setup({ layout: { wall_presentation: original } }); model();
    change('opacity', '37'); change('wall.label', 'My wall'); expect(card._commit).not.toHaveBeenCalled();
    click('wall-presentation-save'); click('wall-presentation-save'); expect(card._commit).toHaveBeenCalledOnce();
    expect(card._layout.wall_presentation).toEqual({ ...original, opacity: .37, walls: [{ ...original.walls[0], label: 'My wall' }] });
    click('history-undo'); expect(card._layout.wall_presentation).toEqual(original); expect(field('opacity').value).toBe('20');
    click('history-redo'); expect(field('opacity').value).toBe('37'); expect(field('wall.label').value).toBe('My wall');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('captures one unsnapped local triangle and the explicitly chosen floor without selecting a room/model owner or pinning a device', () => {
    const { card, edit, model, click, change, surfaceClick } = setup(); model(); click('wall-presentation-add');
    change('mode', 'cutaway', 'change'); change('wall.floor_id', 'ground', 'change'); click('wall-presentation-pick');
    expect(edit._wallSurfacePick()?.floor_id).toBe('ground'); expect(card._stage.classList.contains('wall-picking')).toBe(true);
    surfaceClick(); expect(edit._wallPresentationEditor.pendingSurfacePick).toBeNull(); expect(card._stage.classList.contains('wall-picking')).toBe(false);
    expect(edit._wallPresentationEditor.draft.walls[0]).toMatchObject({ selector: 'node:House/Wall', face, floor_id: 'ground' });
    expect(card._view.captureWallSurfacePick).toHaveBeenCalledExactlyOnceWith(10, 10); expect(card._view.pickModel).not.toHaveBeenCalled();
    expect(card._view.planPoint).not.toHaveBeenCalled(); expect(card._commit).not.toHaveBeenCalled(); expect(card._layout.pins).toEqual({});
    click('wall-presentation-save'); expect(card._commit).toHaveBeenCalledOnce(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('does not guess a floor from active view or surface hit when the editor has not chosen one', () => {
    const { card, edit, model, click, surfaceClick } = setup(); model(); click('wall-presentation-add'); click('wall-presentation-pick'); surfaceClick();
    expect(card._floor).toBe('ground'); expect(edit._wallPresentationEditor.draft.walls[0].floor_id).toBeUndefined();
    expect(edit._wallPresentationEditor.draft.walls[0].face).toEqual(face);
  });
  it('offers genuine resolved HA floors when no layout floor overrides were saved, and still requires deliberate selection', () => {
    const { card, model, click, change, field, surfaceClick } = setup({ layout: { floors: [] } }); model();
    click('wall-presentation-add'); change('mode', 'cutaway', 'change');
    expect([...field('wall.floor_id').options].map((option) => option.value)).toContain('first');
    expect(field('wall.floor_id').value).toBe(''); change('wall.floor_id', 'first', 'change');
    card._floor = 'first'; click('wall-presentation-pick'); surfaceClick(); click('wall-presentation-save');
    expect(card._layout.wall_presentation.walls[0].floor_id).toBe('first'); expect(card._layout.floors).toEqual([]);
  });
  it('keeps a pick pending after a missed surface and ignores orbit drags instead of converting their release to a face', () => {
    const { card, edit, model, click, pointer, surfaceClick } = setup(); model(); click('wall-presentation-add'); click('wall-presentation-pick');
    const token = edit._wallPresentationEditor.pendingSurfacePick.token;
    edit.canvasDown(pointer()); edit.canvasMove(pointer(80, 90)); edit.canvasUp(pointer(80, 90));
    expect(card._view.captureWallSurfacePick).not.toHaveBeenCalled(); expect(edit._wallPresentationEditor.pendingSurfacePick.token).toBe(token);
    card._view.captureWallSurfacePick.mockReturnValueOnce(null); surfaceClick(); expect(edit._wallPresentationEditor.pendingSurfacePick.token).toBe(token);
    expect(edit.panel.textContent).toContain('Choose an exposed face'); expect(card._commit).not.toHaveBeenCalled();
  });
  it('clears old tools/handles and blocks room vertices and marker drags while waiting for a surface', () => {
    const { card, edit, model, click, pointer } = setup({ layout: { wall_presentation: policy(), rooms: [{ id: 'room', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }] } }); model();
    edit.drawing = { points: [[0, 0]], floorId: 'ground' }; edit.calibrating = { src: [1, 1] }; edit.doorMode = edit.overlayMove = edit.colorPick = true;
    edit.selectedRoom = 'room'; edit.selectedMarker = 'device:lamp';
    edit.drag = { kind: 'marker', id: 'device:lamp', moved: true, pos: { x: 2, y: 2, z: 1, floorId: 'ground' } };
    click('wall-presentation-pick'); expect(edit.drag).toBeNull(); expect(edit.selectedRoom).toBeNull(); expect(edit.selectedMarker).toBeNull();
    expect(edit.drawing).toBeNull(); expect(edit.calibrating).toBeNull(); expect(edit.colorPick || edit.doorMode || edit.overlayMove).toBe(false);
    card._positions.set('device:lamp', { x: 1, y: 1, z: 1, floorId: 'ground' });
    edit.markerDown({ id: 'device:lamp' }, pointer()); edit._vertexDown(pointer(), 'room', 0); edit._midDown(pointer(), 'room', 0); edit._dragEnd({});
    expect(edit.drag).toBeNull(); expect(edit.tab).toBe('model'); expect(card._commit).not.toHaveBeenCalled(); expect(card._layout.pins).toEqual({});
  });
  it('Escape from a focused wall input cancels the pending surface mode without throwing away the draft', () => {
    const { card, edit, model, click, field } = setup(); model(); click('wall-presentation-add'); click('wall-presentation-pick');
    const input = field('wall.label'); input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(edit._wallPresentationEditor.pendingSurfacePick).toBeNull(); expect(edit._wallPresentationEditor.draft.walls).toHaveLength(1);
    expect(card._stage.classList.contains('wall-picking')).toBe(false); expect(field('wall.label')).toBe(input); expect(document.activeElement).toBe(input);
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('does not let Escape in another card cancel this card’s selection', () => {
    const first = setup(); first.model(); first.click('wall-presentation-add'); first.click('wall-presentation-pick');
    const second = setup(); second.model(); const input = second.field('opacity'); input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(first.edit._wallPresentationEditor.pendingSurfacePick).not.toBeNull(); first.edit.detach();
  });
  it.each(['view', 'floor', 'model', 'source', 'floor-data', 'role'])('immediately cancels pending selection after %s changes and rejects an old held release', (kind) => {
    const { card, edit, model, click, change, pointer, action } = setup({ layout: { model: { name: 'original.glb' } }, config: { model: '' } });
    model(); click('wall-presentation-add'); change('wall.floor_id', 'ground', 'change'); click('wall-presentation-pick'); edit.canvasDown(pointer());
    if (kind === 'view') card._viewId = 'other'; if (kind === 'floor') card._floor = 'first';
    if (kind === 'model') card._view.model = { root: new THREE.Group() }; if (kind === 'source') card._layout.model = { name: 'new.glb' };
    if (kind === 'floor-data') card._layout.floors = [{ id: 'ground', elevation: 2 }]; if (kind === 'role') card._hass.user.is_admin = false;
    if (['view', 'floor'].includes(kind)) edit.onViewChanged(); else edit.onStates();
    expect(edit._wallPresentationEditor.pendingSurfacePick).toBeNull(); expect(card._stage.classList.contains('wall-picking')).toBe(false);
    edit.canvasUp(pointer()); expect(card._view.captureWallSurfacePick).not.toHaveBeenCalled(); expect(card._view.pickModel).not.toHaveBeenCalled();
    expect(edit._wallPresentationEditor.draft.walls[0].face).toBeUndefined(); expect(action('wall-presentation-save').disabled).toBe(true); expect(card._commit).not.toHaveBeenCalled();
  });
  it('rejects a face from a replaced model root even before a state notification arrives', () => {
    const { card, edit, model, click, pointer } = setup(); model(); click('wall-presentation-add'); click('wall-presentation-pick'); edit.canvasDown(pointer());
    card._view.model = { root: new THREE.Group() }; edit.canvasUp(pointer());
    expect(card._view.captureWallSurfacePick).not.toHaveBeenCalled(); expect(edit._wallPresentationEditor.pendingSurfacePick).toBeNull();
    expect(edit._wallPresentationEditor.stale).toBe(true); expect(card._commit).not.toHaveBeenCalled();
  });
  it.each(['inactive', 'unknown ID'])('cancels a real held wall gesture after same-session %s and rejects its old release through recovery', (kind) => {
    const { card, edit, model, click, pointer } = setup({ layout: { wall_presentation: policy() } }); model(); click('wall-presentation-pick');
    const old = edit._wallPresentationEditor.pendingSurfacePick; edit.canvasDown(pointer());
    if (kind === 'inactive') card._hass.user.is_active = false; else card._hass.user.id = '';
    edit.onStates(); expect(edit._wallPresentationEditor.pendingSurfacePick).toBeNull(); expect(card._stage.classList.contains('wall-picking')).toBe(false);
    card._hass.user.is_active = true; card._hass.user.id = 'taylor'; edit.onStates(); edit.canvasUp(pointer());
    expect(card._view.captureWallSurfacePick).not.toHaveBeenCalled(); expect(card._view.pickModel).not.toHaveBeenCalled();
    expect(edit._wallPresentationEditor.receiveSurfacePick({ token: old.token, selector: 'node:House/Wall', face, modelRoot: card._view.model.root })).toBe(false);
    click('wall-presentation-pick'); expect(edit._wallPresentationEditor.pendingSurfacePick.token).not.toBe(old.token);
    edit.canvasDown(pointer()); edit.canvasUp(pointer()); expect(card._view.captureWallSurfacePick).toHaveBeenCalledOnce(); expect(card._commit).not.toHaveBeenCalled();
  });
  it('latches a dirty draft after activity revocation, keeping its native field but denying Save until Cancel', () => {
    const { card, edit, model, change, field, action, click } = setup({ layout: { wall_presentation: policy() } }); model();
    const input = change('opacity', '37'); input.focus(); card._hass.user.is_active = false; edit.onStates();
    expect(field('opacity')).toBe(input); expect(input.value).toBe('37'); expect(action('wall-presentation-save').disabled).toBe(true);
    card._hass.user.is_active = true; edit.onStates(); expect(action('wall-presentation-save').disabled).toBe(true);
    edit._wallPresentationEditor.onClick('wall-presentation-save'); expect(card._commit).not.toHaveBeenCalled();
    click('wall-presentation-cancel'); change('opacity', '37'); click('wall-presentation-save'); expect(card._commit).toHaveBeenCalledOnce();
  });
  it('keeps focused wall inputs, Save/Cancel and the independent shading control stable through state/rebuild updates', () => {
    const { card, edit, model, change, field, action, click } = setup({ layout: { wall_presentation: policy() } }); model();
    const input = change('opacity', '41'); input.focus(); card._hass = { ...card._hass, states: { 'sensor.example': { state: 'on' } } }; edit.onStates(); edit.afterUpdate();
    expect(field('opacity')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('41');
    const save = action('wall-presentation-save'); save.focus(); edit.onStates(); edit.afterUpdate(); expect(action('wall-presentation-save')).toBe(save); expect(document.activeElement).toBe(save);
    const cancel = action('wall-presentation-cancel'); cancel.focus(); edit.afterUpdate(); expect(action('wall-presentation-cancel')).toBe(cancel); expect(document.activeElement).toBe(cancel);
    click('wall-presentation-cancel'); const shade = edit.panel.querySelector('[data-field="model-rendering-preset"]'); shade.value = 'authored'; shade.dispatchEvent(new Event('change', { bubbles: true })); shade.focus();
    edit.onStates(); edit.afterUpdate(); expect(edit.panel.querySelector('[data-field="model-rendering-preset"]')).toBe(shade); expect(shade.value).toBe('authored');
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('keeps dirty raw wall drafts until Cancel on source changes, without silently saving the latest model context', () => {
    const { card, edit, model, change, field, action, click } = setup({ layout: { model: { name: 'old.glb' }, wall_presentation: policy() }, config: { model: '' } }); model();
    const input = change('wall.label', 'Keep draft'); input.focus(); card._layout.model = { name: 'new.glb' }; edit.onStates(); edit.afterUpdate();
    expect(field('wall.label')).toBe(input); expect(input.value).toBe('Keep draft'); expect(action('wall-presentation-save').disabled).toBe(true);
    edit._wallPresentationEditor.onClick('wall-presentation-save'); expect(card._commit).not.toHaveBeenCalled(); click('wall-presentation-cancel');
    expect(field('wall.label').value).toBe('Front wall'); expect(edit._wallPresentationEditor.stale).toBe(false);
  });
  it('explicit preparation is clean-only and finishing on Cancel/tab leave/detach restores parent-owned merge policy once', async () => {
    const { card, edit, model, click, mesh, candidates } = setup({ prepared: false });
    const wait = deferred(); card.prepareWallSelection = vi.fn(() => wait.promise); model(); click('wall-presentation-prepare');
    const replacement = new THREE.Group(); replacement.add(mesh); card._view.model = { root: replacement }; candidates.prepared = true; edit.afterUpdate();
    wait.resolve({ prepared: true }); await edit._wallPresentationEditor.preparingPromise;
    expect(card.prepareWallSelection).toHaveBeenCalledOnce(); expect(card.finishWallSelectionPreparation).not.toHaveBeenCalled(); expect(card._commit).not.toHaveBeenCalled();
    click('wall-presentation-cancel'); expect(card.finishWallSelectionPreparation).toHaveBeenCalledOnce();
    click('tab', '[data-id="rooms"]'); edit.detach(); expect(card.finishWallSelectionPreparation).toHaveBeenCalledOnce();
    expect(edit._wallPresentationEditor.disposed).toBe(false); edit.attach(); model(); expect(edit._wallPresentationEditor.disposed).toBe(false);
  });
  it('Cancel during preparatory reload finishes ownership and late completion cannot restore an old success', async () => {
    const { card, edit, model, click, candidates } = setup({ prepared: false }); const wait = deferred(); card.prepareWallSelection = vi.fn(() => wait.promise);
    model(); click('wall-presentation-prepare'); click('wall-presentation-cancel'); expect(card.finishWallSelectionPreparation).toHaveBeenCalledOnce();
    candidates.prepared = true; wait.resolve({ prepared: true }); await edit._wallPresentationEditor.preparingPromise;
    expect(edit.panel.textContent).not.toContain('Separate mesh choices are ready'); expect(card._commit).not.toHaveBeenCalled();
  });
  it('cleans pending/draft state on tab leave, history cancellation, detach and permanent dispose', () => {
    const { card, edit, model, click } = setup(); model(); click('wall-presentation-add'); click('wall-presentation-pick');
    click('tab', '[data-id="rooms"]'); expect(edit.tab).toBe('model'); expect(edit._wallPresentationEditor.dirty).toBe(true);
    click('draft-leave-discard'); expect(edit._wallPresentationEditor.draft).toBeNull(); expect(edit._wallPresentationEditor.pendingSurfacePick).toBeNull();
    model(); click('wall-presentation-add'); click('wall-presentation-pick'); edit.cancelHistoryGestures(); expect(edit._wallPresentationEditor.draft).toBeNull();
    edit.render(); click('wall-presentation-add'); click('wall-presentation-pick'); edit.detach(); expect(edit._wallPresentationEditor.draft).toBeNull();
    expect(edit._wallPresentationEditor.disposed).toBe(false); edit.attach(); edit.render(); edit.dispose(); expect(edit._wallPresentationEditor.disposed).toBe(true);
    expect(edit._wallPresentationEditor.render()).toBe(''); expect(card._commit).not.toHaveBeenCalled();
  });
});
