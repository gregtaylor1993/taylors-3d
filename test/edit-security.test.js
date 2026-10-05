// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';

const editors = [];
function setup() {
  const root = new THREE.Group(), door = new THREE.Group(), leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, .1), new THREE.MeshStandardMaterial());
  door.userData.fp = { kind: 'object', id: 'front', type: 'door' }; leaf.name = 'leaf'; root.add(door); door.add(leaf);
  const model = { root, manifest: buildManifest(threeAdapter(root)) };
  const card = { _config: { layout_key: 'house' }, _layout: { rooms: [], pins: {} }, _built: {},
    _hass: { user: { is_admin: true }, states: { 'binary_sensor.front': { state: 'off', attributes: { device_class: 'door' } } },
      entities: {}, areas: {}, floors: {}, devices: {}, callService: vi.fn() }, _objects: { parts: new Map() },
    modelBindings: () => ({ manifest: model.manifest }), _floors: [{ id: 'ground', elevation: 0 }], _roomList: [],
    _floor: 'ground', _mode: 'top', _editing: true, _stage: document.createElement('div'), _markers: [],
    _positions: new Map(), _store: { backend: 'browser' }, _history: new EditHistory(), _applyMarkerSelection: vi.fn(),
    _syncSecurity: vi.fn(), _view: { model, floorElevation: () => 0, setOverlay: vi.fn(), setPivotMarker: vi.fn(),
      setControlsEnabled: vi.fn(), highlightModelNode: vi.fn() } };
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  const edit = new EditMode(card); card._edit = edit;
  card._commit = vi.fn((layout) => { card._layout = layout; card._history.record(snapshot()); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch) => card._commit({ ...card._layout, ...patch }));
  card.undoEdit = vi.fn(() => { const value = card._history.undo(); if (value) card._layout = value.layout; edit.render(); });
  card.redoEdit = vi.fn(() => { const value = card._history.redo(); if (value) card._layout = value.layout; edit.render(); });
  edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach(); editors.push(edit);
  const click = (action, selector = '') => { const el = edit.panel.querySelector(`[data-act="${action}"]${selector}`); expect(el).toBeTruthy(); el.click(); };
  const change = (field, value, event = 'change') => { const el = edit.panel.querySelector(`[data-field="sec-${field}"]`); expect(el).toBeTruthy();
    if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new Event(event, { bubbles: true })); return el; };
  const security = () => click('tab', '[data-id="security"]');
  const newDraft = () => { security(); click('sec-add'); change('entity', 'binary_sensor.front'); change('object', 'front'); click('sec-contact-preset'); };
  return { card, edit, click, change, security, newDraft, leaf };
}
afterEach(() => { editors.splice(0).forEach((edit) => edit.dispose()); document.body.replaceChildren(); });

describe('Security controls in the actual layout editor', () => {
  it('saves one undoable exact contact binding without moving draft geometry or calling a device', () => {
    const { card, edit, click, change, newDraft, leaf } = setup(); newDraft(); change('label', 'Front door', 'input');
    expect(edit.panel.textContent).toContain('Closed'); expect(card._commit).not.toHaveBeenCalled(); expect(leaf.rotation.y).toBe(0);
    click('sec-save'); expect(card._commit).toHaveBeenCalledOnce();
    expect(card._layout.security_bindings[0]).toMatchObject({ entity: 'binary_sensor.front', object_id: 'front', kind: 'door', label: 'Front door', open_states: ['on'], closed_states: ['off'] });
    click('history-undo'); expect(card._layout.security_bindings).toBeUndefined();
    click('history-redo'); expect(card._layout.security_bindings[0].label).toBe('Front door');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('retains the exact focused native field during state and registry changes', () => {
    const { card, edit, change, newDraft } = setup(); newDraft(); const input = change('label', 'Unsaved front door', 'input'); input.focus();
    card._hass.states['binary_sensor.front'] = { state: 'unknown', attributes: { device_class: 'door' } }; edit.onStates();
    card._hass.entities = {}; edit.afterUpdate();
    expect(edit.panel.querySelector('[data-field="sec-label"]')).toBe(input); expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Unsaved front door'); expect(edit.panel.textContent.toLowerCase()).toContain('unknown'); expect(card._commit).not.toHaveBeenCalled();
  });
  it('discards drafts on tab exit, reset and detach while retaining the reusable editor', () => {
    const { card, edit, click, newDraft, security } = setup(); newDraft(); click('tab', '[data-id="rooms"]');
    expect(edit._securityEditor.draft).toBeNull(); expect(card._layout.security_bindings).toBeUndefined();
    newDraft(); edit.cancelHistoryGestures(); expect(edit._securityEditor.draft).toBeNull();
    security(); click('sec-add'); edit.detach(); expect(edit._securityEditor.draft).toBeNull();
    edit.attach(); edit.render(); expect(edit._securityEditor.disposed).toBe(false); expect(card._commit).not.toHaveBeenCalled();
  });
});
