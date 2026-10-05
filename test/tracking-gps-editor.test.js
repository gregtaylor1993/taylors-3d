// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingEditor } from '../src/tracking-editor.js';
import { TrackingCalibration } from '../src/tracking-calibration.js';
import { EditHistory } from '../src/history.js';
import { buildVacuums } from '../src/tracked-entities.js';
import '../src/taylors3d-card.js';

// Real GPS reader/calibration/editor/history, with reported HA states and the
// existing renderer supplied as fixtures. No real household GPS is certified.
const now = Date.parse('2026-10-05T10:00:00Z'), editors = [];
const copy = (value) => structuredClone(value);
const state = (latitude = 51.5, longitude = -.1) => ({ state: 'ready', last_updated: new Date(now).toISOString(),
  attributes: { friendly_name: 'Reported robot location', measured: { latitude, longitude }, latitude_hint: 'not a number',
    fake_latitude: true, battery: 50 } });
const gpsSource = { source: 'gps', entity: 'sensor.position', latitude_attr: 'measured.latitude', longitude_attr: 'measured.longitude',
  floorId: 'ground', calibration: [{ src: [51.5, -.1], plan: [1, 2], provenance: { keep: true } },
    { src: [51.50001, -.1], plan: [1, 3] }], future_source: { keep: true } };
const binding = { id: 'robot', kind: 'xy', entity: 'vacuum.robot', position_key: 'object:dock', position_source: gpsSource,
  label: 'Robot', enabled: true, future_binding: [1, 2] };
function fixture(saved = []) {
  const card = { isConnected: true, _editing: true, _loading: false, ownerDocument: document,
    _layout: { vacuum_bindings: copy(saved), pins: {} }, _config: { layout_key: 'gps-fixture' },
    _floors: [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'upper', name: 'Upper', elevation: 3 }], _roomList: [],
    _view: { model: { root: { uuid: 'gps-model' } } }, _modelAlign: () => [0, 0, 0, 1],
    _hass: { user: { id: 'current-admin', is_admin: true, is_active: true }, auth: {}, connection: { connected: true, options: { auth: {} } },
      states: { 'vacuum.robot': { state: 'cleaning', attributes: {} }, 'sensor.position': state(), 'sensor.replacement': state() },
      entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn(), callWS: vi.fn() },
    _edit: { tab: 'tracking', beginTrackingPlanPick: vi.fn(), refreshOverlay: vi.fn() }, _history: new EditHistory(),
    trackingAnchors: () => [{ id: 'object:dock', label: 'Dock', position: { x: 0, y: 0, z: 0, floorId: 'ground' } }] };
  card._history.reset({ layout: card._layout, config: card._config });
  card.commitFeatureLayout = vi.fn((patch) => { card._layout = { ...card._layout, ...patch };
    card._history.record({ layout: card._layout, config: card._config }, 'GPS binding'); });
  const host = document.createElement('div'); document.body.append(host);
  const editor = new TrackingEditor(card, () => { host.innerHTML = editor.render(); editor.updatePreviews(host); }); editors.push(editor);
  card._edit._trackingEditor = editor;
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  host.addEventListener('click', (event) => { const button = event.target.closest('[data-act]'); if (button) editor.onClick(button.dataset.act, button); });
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  editor.section = 'vacuums'; render();
  const field = (name) => host.querySelector(`[data-field="trk-${name}"]`), button = (name) => host.querySelector(`[data-act="trk-${name}"]`);
  const change = (name, value) => { const node = field(name); expect(node, name).toBeTruthy(); node.focus(); node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true })); };
  const click = (name) => { const node = button(name); expect(node, name).toBeTruthy(); node.click(); };
  const noHA = () => { expect(card._hass.callWS).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); };
  return { card, host, editor, render, field, button, change, click, noHA };
}
function newGPS(ctx) {
  ctx.click('add'); ctx.change('kind', 'xy'); ctx.change('entity', 'vacuum.robot');
  ctx.change('location-mode', 'anchor'); ctx.change('anchor', 'object:dock');
  ctx.change('cal-source', 'gps'); ctx.change('cal-entity', 'sensor.position');
  ctx.change('cal-latitude_attr', 'measured.latitude'); ctx.change('cal-longitude_attr', 'measured.longitude');
  ctx.change('cal-floorId', 'ground');
}
function capture(ctx, latitude, longitude, plan) {
  ctx.card._hass.states['sensor.position'] = state(latitude, longitude); ctx.editor.updatePreviews(ctx.host);
  ctx.click('cal-capture'); const pick = ctx.editor.pendingPlanPick; expect(pick).toBeTruthy();
  expect(ctx.editor.acceptPlanPoint(plan, pick.floorId, pick.token)).toBe(true); return pick;
}
function setter(ctx, hass = ctx.card._hass) {
  for (const name of ['_observeSecuritySession', '_observeAlertMapContext', '_syncSecurity', '_syncFurniture', '_syncHouseShell', '_syncScenePreviews', '_syncAmbient',
    '_schedule', '_suspendAmbient', 'finishWallSelectionPreparation', '_clearTrackingTimer']) ctx.card[name] = vi.fn();
  ctx.card._houseLayoutEnabled = () => false; ctx.card._presetEvents = { setHass: vi.fn() };
  Object.getOwnPropertyDescriptor(customElements.get('taylors3d-card').prototype, 'hass').set.call(ctx.card, hass);
}
function press(button, gesture) { button.focus(); button.dispatchEvent(gesture === 'pointer'
  ? new MouseEvent('pointerdown', { bubbles: true, button: 0 })
  : new KeyboardEvent('keydown', { bubbles: true, key: gesture === 'Space' ? ' ' : 'Enter' })); }
function release(button, gesture) { button.dispatchEvent(gesture === 'pointer'
  ? new MouseEvent('pointerup', { bubbles: true, button: 0 })
  : new KeyboardEvent('keyup', { bubbles: true, key: gesture === 'Space' ? ' ' : 'Enter' })); }
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('deliberate visual GPS setup and exact repair', () => {
  it('pairs real selected GPS readings with unsnapped plan points and saves one history step without device actions', () => {
    const ctx = fixture(); newGPS(ctx);
    const paths = [...ctx.field('cal-latitude_attr').options].map((option) => option.value);
    expect(paths).toContain('measured.latitude'); expect(paths).not.toContain('latitude_hint'); expect(paths).not.toContain('fake_latitude');
    expect(ctx.field('cal-units')).toBeNull(); expect(ctx.editor.draft.position_source.north_up).toBeUndefined();
    capture(ctx, 51.5, -.1, [1.123456789, -2.987654321]);
    ctx.click('save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    capture(ctx, 51.50001, -.1, [1.123456789, -1.987654321]);
    const source = copy(ctx.editor.draft.position_source); expect(source.calibration[0].src).toEqual([51.5, -.1]);
    expect(ctx.card._layout.vacuum_bindings).toEqual([]); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).toHaveBeenCalledTimes(1); expect(ctx.card._history.size).toBe(1);
    expect(ctx.card._layout.vacuum_bindings[0].position_source).toEqual(source);
    const record = buildVacuums({ hass: ctx.card._hass, bindings: ctx.card._layout.vacuum_bindings, floors: ctx.card._floors,
      anchors: ctx.card.trackingAnchors(), now }).records[0];
    expect(record.measured).toBe(true); expect(record.location.x).toBeCloseTo(1.123456789, 10);
    expect(record.location.y).toBeCloseTo(-1.987654321, 10); ctx.noHA();
  });
  it('repairs missing exact GPS entity and floor only after Relink and explicit GPS editing, retaining every imported pair and extra', () => {
    const old = { ...binding, position_source: { ...gpsSource, entity: 'sensor.removed', floorId: 'removed' } };
    const ctx = fixture([old]); ctx.click('edit'); expect(ctx.host.querySelector('[data-trk-cal-fieldset]').disabled).toBe(true);
    expect(ctx.editor.draft.position_source).toEqual(old.position_source); ctx.click('relink'); ctx.click('cal-edit-gps');
    ctx.change('cal-entity', 'sensor.replacement'); ctx.change('cal-floorId', 'upper');
    expect(ctx.editor.draft.position_source.calibration).toEqual(old.position_source.calibration);
    ctx.click('save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.click('cal-confirm'); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).toHaveBeenCalledTimes(1);
    expect(ctx.card._layout.vacuum_bindings[0]).toEqual({ ...old, position_source: { ...old.position_source, entity: 'sensor.replacement', floorId: 'upper' } });
    ctx.noHA();
  });
  it('opens editable GPS controls without normalizing imported defaults, units, north-up policy or annotations; Cancel restores the original', () => {
    const source = { source: 'gps', entity: 'sensor.position', north_up: true, units: 'legacy-unit', plan_meters: true, floorId: 'ground',
      calibration: [{ src: [51.5, -.1], plan: [1, 2], original: 'retained' }], future: { raw: true } };
    const ctx = fixture([{ ...binding, position_source: source }]); ctx.click('edit'); ctx.click('cal-edit-gps');
    expect(ctx.editor.draft.position_source).toEqual(source);
    expect(ctx.editor.calibration.report()).toMatchObject({ status: 'ready', method: 'translation' });
    expect(ctx.editor.calibration.report().explanation).toContain('north-up');
    ctx.change('cal-floorId', 'upper'); ctx.click('cancel');
    expect(ctx.card._layout.vacuum_bindings[0].position_source).toEqual(source); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noHA();
  });
  it('never confirms existing XY pairs as GPS; switching source kind requires deliberately clearing pairs before a new capture', () => {
    const source = { source: 'xy', entity: 'sensor.position', x_attr: 'measured.latitude', y_attr: 'measured.longitude', floorId: 'ground',
      calibration: [{ src: [10, 20], plan: [1, 2] }, { src: [11, 20], plan: [2, 2] }], keep: true };
    const controller = new TrackingCalibration({ source, imported: true, floors: [{ id: 'ground', elevation: 0 }] });
    controller.onChange('trk-cal-source', { value: 'gps' }); controller.confirmSourceContext();
    expect(controller.report().status).toBe('invalid'); expect(controller.getSource().calibration).toEqual(source.calibration);
    expect(controller.report().diagnostics.some((diagnostic) => diagnostic.code === 'coordinate_kind')).toBe(true);
    controller.clearMapping(); expect(controller.getSource()).toMatchObject({ source: 'gps', calibration: [], keep: true });
    controller.reset(); expect(controller.getSource()).toEqual(source); controller.dispose();
  });
  it('keeps a frozen GPS snapshot and focused decimal field through genuine later readings, and rejects a late plan point after role loss', () => {
    const ctx = fixture(); newGPS(ctx); ctx.click('cal-capture'); const pick = ctx.editor.pendingPlanPick;
    const field = ctx.field('cal-pending-x'); field.focus(); field.value = '1.123456789';
    ctx.card._hass.states['sensor.position'] = state(51.50001, -.10001); setter(ctx); ctx.editor.updatePreviews(ctx.host);
    expect(ctx.field('cal-pending-x')).toBe(field); expect(document.activeElement).toBe(field); expect(field.value).toBe('1.123456789');
    expect(ctx.editor.pendingPlanPick.raw).toEqual([51.5, -.1]);
    ctx.card._hass.user.is_admin = false; setter(ctx); ctx.card._hass.user.is_admin = true; setter(ctx);
    expect(ctx.editor.acceptPlanPoint([1, 2], 'ground', pick.token)).toBe(false); expect(ctx.editor.draft.position_source.calibration).toBeUndefined();
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noHA();
  });
  it.each(['pointer', 'Space', 'Enter'])('real setter observed source loss/recovery rejects held %s GPS capture while a fresh gesture works', (gesture) => {
    const ctx = fixture(); newGPS(ctx); const button = ctx.button('cal-capture'); press(button, gesture);
    ctx.card._hass.states['sensor.position'].state = 'unavailable'; setter(ctx);
    ctx.card._hass.states['sensor.position'].state = 'ready'; setter(ctx); ctx.editor.updatePreviews(ctx.host);
    expect(ctx.button('cal-capture')).toBe(button); release(button, gesture); button.click(); expect(ctx.editor.pendingPlanPick).toBeNull();
    press(button, 'pointer'); release(button, 'pointer'); button.click(); expect(ctx.editor.pendingPlanPick.raw).toEqual([51.5, -.1]);
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noHA();
  });
  it('rejects an old GPS input and Save after model context changes, keeping the existing saved mapping untouched', () => {
    const ctx = fixture([binding]); ctx.click('edit'); ctx.click('cal-edit-gps');
    const input = ctx.field('cal-latitude_attr'), save = ctx.button('save'); input.focus(); press(save, 'pointer');
    ctx.card._view.model.root = { uuid: 'replacement-model' }; setter(ctx); ctx.editor.updatePreviews(ctx.host);
    input.value = 'battery'; input.dispatchEvent(new Event('change', { bubbles: true })); release(save, 'pointer'); save.click();
    expect(ctx.card._layout.vacuum_bindings[0]).toEqual(binding); expect(ctx.editor.draft.position_source).toEqual(gpsSource);
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noHA();
  });
  it.each(['pointer', 'Space', 'Enter'].flatMap((gesture) => ['role', 'connection'].map((loss) => ({ gesture, loss }))))('real setter observed $loss loss/recovery rejects held $gesture GPS Save and requires a freshly opened draft', ({ gesture, loss }) => {
    const ctx = fixture([binding]); ctx.click('edit'); ctx.click('cal-edit-gps'); ctx.change('label', 'Held change');
    const save = ctx.button('save'); press(save, gesture);
    if (loss === 'role') ctx.card._hass.user.is_admin = false; else ctx.card._hass.connection.connected = false;
    setter(ctx);
    if (loss === 'role') ctx.card._hass.user.is_admin = true; else ctx.card._hass.connection.connected = true;
    setter(ctx); ctx.editor.updatePreviews(ctx.host); release(save, gesture); save.click();
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._layout.vacuum_bindings[0]).toEqual(binding);
    ctx.click('cancel'); ctx.click('edit'); ctx.change('label', 'Fresh deliberate change'); ctx.click('save');
    expect(ctx.card.commitFeatureLayout).toHaveBeenCalledTimes(1);
    expect(ctx.card._layout.vacuum_bindings[0].position_source).toEqual(gpsSource); ctx.noHA();
  });
});
