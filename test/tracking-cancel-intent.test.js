// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingEditor } from '../src/tracking-editor.js';
import { EditHistory } from '../src/history.js';
import '../src/taylors3d-card.js';

// Exercises the actual editor's native gesture handlers. The renderer and HA
// observations are fixtures; these checks never connect to a household.
const gestures = ['pointer', 'Space', 'Enter'], editors = [];
const clone = (value) => structuredClone(value);
const savedBinding = {
  id: 'robot', kind: 'xy', entity: 'vacuum.robot', label: 'Saved robot', enabled: true,
  position: { x: 1, y: 2, z: .05, floorId: 'ground' },
  position_source: { source: 'xy', entity: 'sensor.robot_position', x_attr: 'east', y_attr: 'north',
    floorId: 'ground', units: 'cm', calibration: [{ src: [10, 20], plan: [1, 2] }, { src: [110, 20], plan: [2, 2] }],
    future_source: { preserved: true } },
  future_binding: ['keep', 42],
};

function setup() {
  const now = new Date().toISOString(), card = {
    isConnected: true, _editing: true, _loading: false, _wallLifecycleGeneration: 0,
    _config: { layout_key: 'cancel-fixture', model: '/local/simulated.glb' },
    _layout: { vacuum_bindings: [clone(savedBinding), { ...clone(savedBinding), id: 'other', label: 'Other saved robot' }],
      pins: { untouched: { x: 7, y: 8, floor_id: 'ground' } }, future_layout: { preserved: true } },
    _floors: [{ id: 'ground', name: 'Ground', elevation: 0 }], _roomList: [],
    _view: { model: { root: { uuid: 'model-before' } }, floorElevation: () => 0 },
    _alignment: [[0, 0, 0], 0, 1], _modelAlign: () => card._alignment,
    _hass: { user: { id: 'admin', is_admin: true, is_active: true, permissions: { fixture: true } },
      connection: { connected: true, options: { auth: {} } }, auth: {},
      states: { 'vacuum.robot': { state: 'cleaning', last_updated: now, attributes: {} },
        'sensor.robot_position': { state: 'ready', last_updated: now, attributes: { east: 10, north: 20 } } },
      entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn(), callWS: vi.fn(), fetchWithAuth: vi.fn() },
    _edit: { tab: 'tracking', beginTrackingPlanPick: vi.fn(), refreshOverlay: vi.fn() },
    _history: new EditHistory(), _store: { save: vi.fn() }, _presetEvents: { setHass: vi.fn() },
  };
  for (const name of ['_observeSecuritySession', '_observeAlertMapContext', '_syncSecurity', '_syncFurniture', '_syncHouseShell',
    '_syncScenePreviews', '_syncAmbient', '_schedule', '_suspendAmbient', 'finishWallSelectionPreparation', '_clearTrackingTimer']) card[name] = vi.fn();
  card._houseLayoutEnabled = () => false;
  // Keep a pre-existing Undo step, so Cancel must preserve more than an empty history.
  card._history.reset({ layout: { ...clone(card._layout), prior_revision: true }, config: card._config });
  card._history.record({ layout: card._layout, config: card._config }, 'Earlier deliberate saved edit');
  card.commitFeatureLayout = vi.fn((patch) => {
    card._layout = { ...card._layout, ...patch };
    card._history.record({ layout: card._layout, config: card._config }, 'Tracking binding');
    card._store.save(card._layout);
  });
  const host = document.createElement('div'); document.body.append(host);
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  const editor = new TrackingEditor(card, render); editors.push(editor); card._edit._trackingEditor = editor;
  editor.section = 'vacuums';
  host.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]'); if (button) editor.onClick(button.dataset.act, button);
  });
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  render();
  const button = (name, index) => host.querySelector(`[data-act="trk-${name}"]${index === undefined ? '' : `[data-index="${index}"]`}`);
  const open = (index = 0) => {
    button('edit', index).click();
    const field = host.querySelector('[data-field="trk-label"]');
    field.focus(); field.value = `Unsaved idea for ${index}`; field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(editor.draft.label).toBe(`Unsaved idea for ${index}`);
  };
  const observe = () => Object.getOwnPropertyDescriptor(customElements.get('taylors3d-card').prototype, 'hass').set.call(card, card._hass);
  const initial = { layout: clone(card._layout), history: card._history.current, size: card._history.size,
    bytes: card._history.bytes, canUndo: card._history.canUndo, canRedo: card._history.canRedo };
  const noWrites = () => {
    expect(card._layout).toEqual(initial.layout);
    expect(card._history.current).toEqual(initial.history);
    expect(card._history.size).toBe(initial.size); expect(card._history.bytes).toBe(initial.bytes);
    expect(card._history.canUndo).toBe(initial.canUndo); expect(card._history.canRedo).toBe(initial.canRedo);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._store.save).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
    expect(card._hass.fetchWithAuth).not.toHaveBeenCalled();
  };
  return { card, host, editor, render, button, open, observe, noWrites };
}
function press(button, gesture) {
  expect(button?.isConnected).toBe(true); expect(button.disabled).toBe(false); button.focus();
  button.dispatchEvent(gesture === 'pointer' ? new MouseEvent('pointerdown', { bubbles: true, button: 0 })
    : new KeyboardEvent('keydown', { bubbles: true, key: gesture === 'Space' ? ' ' : 'Enter' }));
}
function release(button, gesture) {
  button.dispatchEvent(gesture === 'pointer' ? new MouseEvent('pointerup', { bubbles: true, button: 0 })
    : new KeyboardEvent('keyup', { bubbles: true, key: gesture === 'Space' ? ' ' : 'Enter' }));
  button.click();
}
function activate(button, gesture) { press(button, gesture); release(button, gesture); }
function discarded(ctx) {
  ctx.noWrites();
  expect(ctx.editor.draft).toBeNull(); expect(ctx.editor.pendingPlanPick).toBeNull();
  expect(ctx.editor.calibration).toBeNull(); expect(ctx.editor.calibrationPreview).toBeNull();
}
const freshChanges = {
  model: (ctx) => { ctx.card._view.model.root = { uuid: 'model-after' }; },
  alignment: (ctx) => { ctx.card._alignment = [[0, 0, 0], .05, 1]; },
  'lost admin role': (ctx) => { ctx.card._hass.user.is_admin = false; },
  disconnected: (ctx) => { ctx.card._hass.connection.connected = false; },
};
const recoveries = {
  model: (ctx) => {
    const original = ctx.card._view.model.root; ctx.card._view.model.root = { uuid: 'temporary-model' }; ctx.observe();
    ctx.card._view.model.root = original; ctx.observe();
  },
  role: (ctx) => { ctx.card._hass.user.is_admin = false; ctx.observe(); ctx.card._hass.user.is_admin = true; ctx.observe(); },
  connection: (ctx) => { ctx.card._hass.connection.connected = false; ctx.observe(); ctx.card._hass.connection.connected = true; ctx.observe(); },
  authentication: (ctx) => {
    const original = ctx.card._hass.auth; ctx.card._hass.auth = {}; ctx.observe(); ctx.card._hass.auth = original; ctx.observe();
  },
};
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('current Tracking Cancel discards only its unsaved draft', () => {
  it.each(gestures.flatMap((gesture) => Object.keys(freshChanges).map((change) => ({ gesture, change }))))(
    'fresh $gesture Cancel works after $change without saving or issuing device actions', ({ gesture, change }) => {
      const ctx = setup(); ctx.open();
      const oldDraft = ctx.editor.draft, cancel = ctx.button('cancel');
      freshChanges[change](ctx); ctx.observe(); ctx.editor.updatePreviews(ctx.host);
      expect(ctx.editor.stale).toBe(true); expect(ctx.editor.draft).toBe(oldDraft);
      expect(ctx.button('cancel')).toBe(cancel); expect(cancel.disabled).toBe(false); ctx.noWrites();
      activate(cancel, gesture); discarded(ctx);
    });

  it.each(gestures.flatMap((gesture) => Object.keys(recoveries).map((loss) => ({ gesture, loss }))))(
    'old held $gesture Cancel stays rejected across $loss loss/recovery; a fresh Cancel works', ({ gesture, loss }) => {
      const ctx = setup(); ctx.open(); const draft = ctx.editor.draft, cancel = ctx.button('cancel'); press(cancel, gesture);
      recoveries[loss](ctx); ctx.editor.updatePreviews(ctx.host);
      expect(ctx.editor.stale).toBe(true); expect(ctx.button('cancel')).toBe(cancel);
      release(cancel, gesture); expect(ctx.editor.draft).toBe(draft); ctx.noWrites();
      activate(cancel, gesture); discarded(ctx);
    });

  it.each(gestures)('an old %s Cancel node cannot discard a newly opened binding draft', (gesture) => {
    const ctx = setup(); ctx.open(); const old = ctx.button('cancel'); press(old, gesture);
    ctx.open(1); const currentDraft = ctx.editor.draft, current = ctx.button('cancel');
    expect(old.isConnected).toBe(false); expect(current).not.toBe(old);
    release(old, gesture);
    // Independently deliver the delayed delegated action: detached nodes cannot
    // gain the accessibility-only no-gesture fallback on a replacement draft.
    ctx.editor.onClick('trk-cancel', old);
    expect(ctx.editor.draft).toBe(currentDraft); expect(currentDraft.id).toBe('other'); ctx.noWrites();
    activate(current, gesture); discarded(ctx);
  });

  it.each(gestures)('a detached then reattached %s Cancel gesture needs a fresh press', (gesture) => {
    const ctx = setup(); ctx.open(); const cancel = ctx.button('cancel'), draft = ctx.editor.draft; press(cancel, gesture);
    ctx.host.remove(); ctx.editor.observe(); document.body.append(ctx.host); ctx.editor.updatePreviews(ctx.host);
    release(cancel, gesture); expect(ctx.editor.draft).toBe(draft); ctx.noWrites();
    activate(cancel, gesture); discarded(ctx);
  });

  it.each(gestures)('allowing fresh %s Cancel does not enable stale Save', (gesture) => {
    const ctx = setup(); ctx.open(); const draft = ctx.editor.draft;
    freshChanges.model(ctx); ctx.observe(); ctx.editor.updatePreviews(ctx.host);
    const save = ctx.button('save'); expect(save.disabled).toBe(true);
    save.dispatchEvent(gesture === 'pointer' ? new MouseEvent('pointerdown', { bubbles: true, button: 0 })
      : new KeyboardEvent('keydown', { bubbles: true, key: gesture === 'Space' ? ' ' : 'Enter' }));
    release(save, gesture); ctx.editor.onClick('trk-save', save);
    expect(ctx.editor.draft).toBe(draft); ctx.noWrites();
  });

  it('keeps current accessibility-only Cancel available after a context change', () => {
    const ctx = setup(); ctx.open(); freshChanges.model(ctx); ctx.observe(); ctx.editor.updatePreviews(ctx.host);
    ctx.button('cancel').click(); discarded(ctx);
  });
});
