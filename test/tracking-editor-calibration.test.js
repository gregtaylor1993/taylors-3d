// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingEditor } from '../src/tracking-editor.js';
import { EditHistory } from '../src/history.js';
import { buildVacuums } from '../src/tracked-entities.js';

const epoch = Date.parse('2026-10-05T10:00:00Z');
const state = (value = 'ready', attributes = {}) => ({ state: value, attributes: { friendly_name: 'Reported position', map: { x: 10, y: 20 }, ...attributes }, last_updated: new Date(epoch).toISOString() });
const source = { source: 'xy', entity: 'sensor.position', x_attr: 'map.x', y_attr: 'map.y', floorId: 'ground', units: 'cm',
  calibration: [{ src: [10, 20], plan: [1, 2] }, { src: [110, 20], plan: [2, 2] }], future_source_option: { preserved: true } };
const binding = { id: 'robot', entity: 'vacuum.robot', kind: 'xy', position_key: 'object:dock', position_source: source, future_binding_option: [1, 2] };
const clone = (value) => JSON.parse(JSON.stringify(value));
function setup(saved = []) {
  const card = { isConnected: true, _editing: true, _loading: false, _layout: { vacuum_bindings: clone(saved), pins: { keep: { x: 1 } } }, _config: { layout_key: 'home' },
    _floors: [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'upper', name: 'Upper', elevation: 3 }], _roomList: [],
    _hass: { user: { id: 'current-admin', is_admin: true, is_active: true }, connection: { connected: true }, auth: {},
      states: { 'vacuum.robot': state('cleaning'), 'sensor.position': state(), 'sensor.other': state() }, entities: {}, callService: vi.fn(), callWS: vi.fn() },
    _view: { model: { root: { uuid: 'model-one' } } }, _modelAlign: () => card._alignment,
    _alignment: { position: [0, 0, 0], rotation: 0, scale: 1 },
    trackingAnchors: () => [{ id: 'object:dock', label: 'Dock', position: { x: 0, y: 0, z: 0, floorId: 'ground' } }],
    _edit: { tab: 'tracking', beginTrackingPlanPick: vi.fn(), refreshOverlay: vi.fn() }, _history: new EditHistory(),
  };
  card._history.reset({ layout: card._layout, config: card._config });
  card.commitFeatureLayout = vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; card._history.record({ layout: card._layout, config: card._config }, 'Tracking calibration'); });
  const host = document.createElement('div'); document.body.append(host);
  const editor = new TrackingEditor(card, () => { host.innerHTML = editor.render(); editor.updatePreviews(host); });
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const button = event.target.closest('button[data-act]'); if (button && !button.disabled) editor.onClick(button.dataset.act, button); });
  render(); editor.onClick('trk-section', { dataset: { section: 'vacuums' } });
  const click = (action, index) => {
    const button = [...host.querySelectorAll(`[data-act="${action}"]`)].find((node) => index === undefined || Number(node.dataset.index) === index);
    expect(button, action).toBeTruthy(); button.click();
  };
  const change = (field, value, index) => {
    const control = [...host.querySelectorAll(`[data-field="${field}"]`)].find((node) => index === undefined || Number(node.dataset.index) === index);
    expect(control, field).toBeTruthy(); control.focus(); control.value = value; control.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const reading = (raw) => { card._hass.states['sensor.position'] = state('ready', { map: { x: raw[0], y: raw[1] } }); editor.updatePreviews(host); };
  const capture = (raw, plan) => { reading(raw); click('trk-cal-capture'); const pending = editor.pendingPlanPick; expect(pending).toBeTruthy(); expect(editor.acceptPlanPoint(plan, pending.floorId, pending.token)).toBe(true); };
  const noHA = () => { expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled(); };
  return { card, host, editor, click, change, render, reading, capture, noHA };
}
function newXY(ctx) {
  ctx.click('trk-add'); ctx.change('trk-kind', 'xy'); ctx.change('trk-entity', 'vacuum.robot');
  ctx.change('trk-location-mode', 'anchor'); ctx.change('trk-anchor', 'object:dock');
  ctx.change('trk-cal-entity', 'sensor.position'); ctx.change('trk-cal-x_attr', 'map.x'); ctx.change('trk-cal-y_attr', 'map.y');
  ctx.change('trk-cal-floorId', 'ground'); ctx.change('trk-cal-frame', 'calibrated');
}
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('visual calibration in Tracking drafts', () => {
  it('matches two genuine raw points without saving until one explicit binding Save', () => {
    const ctx = setup(); newXY(ctx); ctx.capture([10, 20], [1.123456, -2.987654]); ctx.capture([110, 20], [2.123456, -2.987654]);
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._layout.vacuum_bindings).toEqual([]);
    expect(ctx.editor.calibrationOverlay()).toMatchObject({ floorId: 'ground', points: [
      { index: 0, label: '1', x: 1.123456, y: -2.987654 }, { index: 1, label: '2', x: 2.123456, y: -2.987654 }], mapped: [2.123456, -2.987654] });
    expect(ctx.host.textContent).toContain('Zero fit error does not measure accuracy'); ctx.click('trk-save');
    expect(ctx.card.commitFeatureLayout).toHaveBeenCalledTimes(1);
    expect(ctx.card._layout.vacuum_bindings[0].position_source).toMatchObject({ source: 'xy', plan_meters: false,
      calibration: [{ src: [10, 20], plan: [1.123456, -2.987654] }, { src: [110, 20], plan: [2.123456, -2.987654] }] });
    expect(ctx.card._layout.vacuum_bindings[0].position_source.units).toBeUndefined();
    const records = buildVacuums({ hass: ctx.card._hass, bindings: ctx.card._layout.vacuum_bindings, floors: ctx.card._floors, anchors: ctx.card.trackingAnchors(), now: epoch });
    expect(records.records[0]).toMatchObject({ measured: true, location: { x: 2.123456, y: -2.987654, floorId: 'ground' } }); ctx.noHA();
  });
  it('uses three spread points for a mirrored source map and exposes the actual affine fit', () => {
    const ctx = setup(); newXY(ctx); ctx.capture([0, 0], [0, 0]); ctx.capture([100, 0], [1, 0]); ctx.capture([0, 100], [0, -1]);
    expect(ctx.editor.calibration.report()).toMatchObject({ status: 'ready', method: 'affine' });
    expect(ctx.editor.calibration.report().residual).toBeLessThan(1e-12);
    ctx.reading([50, 25]); const mapped = ctx.editor.calibrationOverlay().mapped;
    expect(mapped[0]).toBeCloseTo(0.5, 12); expect(mapped[1]).toBeCloseTo(-0.25, 12); ctx.click('trk-save'); ctx.noHA();
  });
  it.each(['one', 'duplicate', 'collinear'])('blocks %s calibration without discarding the visible draft', (problem) => {
    const ctx = setup(); newXY(ctx); ctx.capture([0, 0], [0, 0]);
    if (problem === 'duplicate') ctx.capture([0, 0], [1, 0]);
    if (problem === 'collinear') { ctx.capture([10, 0], [1, 0]); ctx.capture([20, 0], [2, 0]); }
    ctx.click('trk-save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.editor.draft).toBeTruthy(); ctx.noHA();
  });
  it('keeps an exact imported known-unit one-point source and unknown fields on a label edit', () => {
    const old = { ...binding, position_source: { ...source, calibration: [{ src: [10, 20], plan: [1, 2], future_point: { keep: true } }] } };
    const ctx = setup([old]); ctx.click('trk-edit', 0); ctx.change('trk-label', 'Kitchen robot'); ctx.click('trk-save');
    expect(ctx.card._layout.vacuum_bindings[0]).toMatchObject({ label: 'Kitchen robot', future_binding_option: [1, 2], position_source: old.position_source }); ctx.noHA();
  });
  it('keeps an imported GPS mapping exact while allowing the binding label to change', () => {
    const gps = { entity: 'sensor.position', source: 'gps', north_up: true, floorId: 'ground', calibration: [{ src: [51.5, -0.1], plan: [1, 2] }], future_gps: true };
    const ctx = setup([{ ...binding, position_source: gps }]); ctx.click('trk-edit', 0);
    expect(ctx.host.textContent).toContain('imported source is preserved read-only'); expect(ctx.host.querySelector('[data-field="trk-cal-frame"]')).toBeNull();
    ctx.change('trk-label', 'GPS robot'); ctx.click('trk-save'); expect(ctx.card._layout.vacuum_bindings[0].position_source).toEqual(gps); ctx.noHA();
  });
  it('allows explicit direct centimetres without rewriting the source units to metres', () => {
    const direct = { ...source, calibration: [], plan_meters: true };
    const ctx = setup([{ ...binding, position_source: direct }]); ctx.click('trk-edit', 0); ctx.change('trk-label', 'Direct robot'); ctx.click('trk-save');
    expect(ctx.card._layout.vacuum_bindings[0].position_source).toEqual(direct);
    const records = buildVacuums({ hass: ctx.card._hass, bindings: ctx.card._layout.vacuum_bindings, floors: ctx.card._floors, anchors: ctx.card.trackingAnchors(), now: epoch });
    expect(records.records[0]).toMatchObject({ measured: true, location: { x: 0.1, y: 0.2 } }); ctx.noHA();
  });
  it('retains old pairs and requires deliberate same-frame confirmation after a source change', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.change('trk-cal-entity', 'sensor.other');
    expect(ctx.editor.draft.position_source.calibration).toEqual(source.calibration); expect(ctx.host.textContent).toContain('The source frame changed');
    ctx.click('trk-save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.click('trk-cal-confirm'); ctx.click('trk-save');
    expect(ctx.card._layout.vacuum_bindings[0].position_source).toEqual({ ...source, entity: 'sensor.other' }); ctx.noHA();
  });
  it('does not treat an explicitly blanked imported coordinate attribute as a preserved label-only edit', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.change('trk-cal-x_attr', ''); ctx.click('trk-cal-confirm'); ctx.click('trk-save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('edited X/Y source needs distinct actual coordinate attribute paths'); ctx.noHA();
  });
  it('keeps pairs after switching to direct coordinates until they are explicitly cleared', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.change('trk-cal-frame', 'plan');
    ctx.click('trk-cal-confirm'); ctx.click('trk-save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(ctx.host.textContent).toContain('Clear calibration deliberately'); ctx.click('trk-cal-clear'); ctx.click('trk-save');
    expect(ctx.card._layout.vacuum_bindings[0].position_source).toEqual({ ...source, plan_meters: true, calibration: [] }); ctx.noHA();
  });
  it('preserves the saved layout on Cancel and cancels its pending point pick', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.change('trk-cal-plan-x', '9.25', 0); ctx.click('trk-cal-capture');
    ctx.click('trk-cancel'); expect(ctx.editor.pendingPlanPick).toBeNull(); expect(ctx.editor.calibrationOverlay()).toBeNull();
    expect(ctx.card._edit.beginTrackingPlanPick).toHaveBeenLastCalledWith(null); expect(ctx.card._layout.vacuum_bindings[0]).toEqual(binding);
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noHA();
  });
  it('records one undo step for a saved calibration while retaining existing pins', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.change('trk-cal-plan-x', '1.5', 0); ctx.click('trk-save');
    expect(ctx.card._history.undo().layout).toEqual({ vacuum_bindings: [binding], pins: { keep: { x: 1 } } });
    expect(ctx.card._history.redo().layout.vacuum_bindings[0].position_source.calibration[0].plan).toEqual([1.5, 2]); ctx.noHA();
  });
});

describe('source evidence and plan-pick lifecycle', () => {
  it('freezes the captured reading while new source readings arrive', () => {
    const ctx = setup(); newXY(ctx); ctx.click('trk-cal-capture'); const pending = ctx.editor.pendingPlanPick;
    expect(Object.isFrozen(pending)).toBe(true); expect(Object.isFrozen(pending.raw)).toBe(true);
    ctx.reading([90, 80]); expect(ctx.editor.acceptPlanPoint([1.234, -2.345], 'ground', pending.token)).toBe(true);
    expect(ctx.editor.draft.position_source.calibration[0]).toEqual({ src: [10, 20], plan: [1.234, -2.345] }); ctx.noHA();
  });
  it('rejects an old token without consuming the current pick and rejects the wrong floor', () => {
    const ctx = setup(); newXY(ctx); ctx.click('trk-cal-capture'); const first = ctx.editor.pendingPlanPick;
    ctx.editor.cancelPlanPick(); ctx.render(); ctx.click('trk-cal-capture'); const next = ctx.editor.pendingPlanPick;
    expect(ctx.editor.acceptPlanPoint([1, 2], 'ground', first.token)).toBe(false); expect(ctx.editor.pendingPlanPick).toBe(next);
    expect(ctx.editor.acceptPlanPoint([1, 2], 'upper', next.token)).toBe(false); expect(ctx.editor.pendingPlanPick).toBeNull(); ctx.noHA();
  });
  it.each(['model', 'alignment', 'floor', 'layout_key'])('cancels capture when its %s context changes', (kind) => {
    const ctx = setup(); newXY(ctx); ctx.click('trk-cal-capture'); const pending = ctx.editor.pendingPlanPick;
    if (kind === 'model') ctx.card._view.model.root.uuid = 'replacement';
    if (kind === 'alignment') ctx.card._alignment.rotation = 90;
    if (kind === 'floor') ctx.card._floors[0].elevation = 0.5;
    if (kind === 'layout_key') ctx.card._config.layout_key = 'another';
    expect(ctx.editor.acceptPlanPoint([1, 2], 'ground', pending.token)).toBe(false); expect(ctx.editor.pendingPlanPick).toBeNull(); ctx.noHA();
  });
  it('leaves unrelated states and a pure pending getter stable without repeated overlay calls', () => {
    const ctx = setup(); newXY(ctx); ctx.click('trk-cal-capture'); const pending = ctx.editor.pendingPlanPick;
    ctx.card._edit.beginTrackingPlanPick.mockClear(); ctx.card._edit.refreshOverlay.mockClear();
    ctx.card._hass.states['light.unrelated'] = state('on'); ctx.editor.updatePreviews(ctx.host);
    expect(ctx.editor.pendingPlanPick).toBe(pending); expect(ctx.editor.pendingPlanPick).toBe(pending);
    expect(ctx.card._edit.beginTrackingPlanPick).not.toHaveBeenCalled(); expect(ctx.card._edit.refreshOverlay).not.toHaveBeenCalled(); ctx.noHA();
  });
  it.each(['unavailable', 'unknown', 'restored', 'hidden', 'disabled', 'diagnostic', 'missing'])('cancels capture for %s position evidence and never shows a measured draft', (kind) => {
    const ctx = setup(); newXY(ctx); ctx.capture([0, 0], [0, 0]); ctx.capture([100, 0], [1, 0]); ctx.click('trk-cal-capture');
    if (kind === 'missing') delete ctx.card._hass.states['sensor.position'];
    else if (kind === 'restored') ctx.card._hass.states['sensor.position'].attributes.restored = true;
    else if (['unavailable', 'unknown'].includes(kind)) ctx.card._hass.states['sensor.position'].state = kind;
    else ctx.card._hass.entities['sensor.position'] = kind === 'hidden' ? { hidden_by: 'user' } : kind === 'disabled' ? { disabled_by: 'user' } : { entity_category: 'diagnostic' };
    ctx.editor.updatePreviews(ctx.host); expect(ctx.editor.pendingPlanPick).toBeNull();
    expect(ctx.editor.calibrationOverlay()?.mapped ?? null).toBeNull();
    if (kind === 'restored') expect(ctx.host.textContent).toContain('Stored/restored reading'); ctx.noHA();
  });
  it('retains missing selected references until a deliberate repair, including saved calibration', () => {
    const old = { ...binding, position_source: { ...source, entity: 'sensor.deleted', floorId: 'deleted' } };
    const ctx = setup([old]); ctx.click('trk-edit', 0); expect(ctx.host.querySelector('[data-trk-cal-fieldset]').disabled).toBe(true);
    ctx.click('trk-relink'); expect(ctx.editor.draft.position_source).toEqual(old.position_source);
    ctx.change('trk-cal-entity', 'sensor.position'); ctx.change('trk-cal-floorId', 'ground'); ctx.click('trk-cal-confirm'); ctx.click('trk-save');
    expect(ctx.card._layout.vacuum_bindings[0].position_source).toEqual(source); ctx.noHA();
  });
  it('rejects a captured timestamp that expired even if a new fresh measurement has arrived', () => {
    vi.useFakeTimers(); vi.setSystemTime(epoch + 1000);
    const old = { ...binding, position_source: { ...source, freshness: { timestamp_mode: 'last_updated', max_age_seconds: 5 } } };
    const ctx = setup([old]); ctx.click('trk-edit', 0); ctx.click('trk-cal-capture'); const pending = ctx.editor.pendingPlanPick;
    vi.setSystemTime(epoch + 6000); ctx.card._hass.states['sensor.position'].last_updated = new Date(epoch + 6000).toISOString();
    expect(ctx.editor.acceptPlanPoint([3, 4], 'ground', pending.token)).toBe(false); expect(ctx.editor.draft.position_source.calibration).toEqual(source.calibration); ctx.noHA();
  });
  it.each(['cancel', 'reset', 'dispose', 'section', 'replacement', 'kind'])('clears pending points on %s and makes old tokens unusable', (action) => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.click('trk-cal-capture'); const pending = ctx.editor.pendingPlanPick;
    if (action === 'section') ctx.editor.onClick('trk-section', { dataset: { section: 'presence' } });
    else if (action === 'replacement') ctx.click('trk-edit', 0);
    else if (action === 'kind') ctx.change('trk-kind', 'static');
    else ctx.editor[action]();
    expect(ctx.editor.pendingPlanPick).toBeNull(); expect(ctx.editor.acceptPlanPoint([1, 2], 'ground', pending.token)).toBe(false); ctx.noHA();
  });
  it('namespaces tokens across replacement bindings even when both captures have token one', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.click('trk-cal-capture'); const first = ctx.editor.pendingPlanPick;
    ctx.click('trk-cancel'); newXY(ctx); ctx.click('trk-cal-capture'); const next = ctx.editor.pendingPlanPick;
    expect(next.token).not.toBe(first.token); expect(ctx.editor.acceptPlanPoint([1, 2], 'ground', first.token)).toBe(false); expect(ctx.editor.pendingPlanPick).toBe(next); ctx.noHA();
  });
  it('prevents Save from silently discarding an unmatched capture', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.click('trk-cal-capture'); ctx.click('trk-save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('Match or cancel the captured source point');
    ctx.click('trk-cal-cancel-pick'); ctx.click('trk-save'); expect(ctx.card.commitFeatureLayout).toHaveBeenCalledTimes(1); ctx.noHA();
  });
  it('clears overlays even when the parent synchronously rereads the controller during pick cleanup', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.click('trk-cal-capture');
    let overlay;
    ctx.card._edit.refreshOverlay = vi.fn(() => { overlay = ctx.editor.calibrationOverlay(); });
    ctx.card._edit.beginTrackingPlanPick = vi.fn(() => ctx.card._edit.refreshOverlay());
    ctx.editor.reset(); expect(overlay).toBeNull(); expect(ctx.editor.calibration).toBeNull(); expect(ctx.editor.pendingPlanPick).toBeNull(); ctx.noHA();
  });
});

describe('keyboard editing and stable focused controls', () => {
  it('accepts exact unsnapped numeric plan points using the actual draft form controls', () => {
    const ctx = setup(); newXY(ctx); ctx.click('trk-cal-capture');
    ctx.change('trk-cal-pending-x', '1.123456'); ctx.change('trk-cal-pending-y', '-2.987654'); ctx.click('trk-cal-accept');
    expect(ctx.editor.draft.position_source.calibration).toEqual([{ src: [10, 20], plan: [1.123456, -2.987654] }]); ctx.noHA();
  });
  it('keeps a focused raw attribute input while states update, and cancels a pick on frame changes', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.click('trk-cal-capture');
    const field = ctx.host.querySelector('[data-field="trk-cal-x_attr"]'); field.focus(); field.value = 'map.other'; field.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.card._hass.states['sensor.position'].attributes.map.other = 12; ctx.editor.updatePreviews(ctx.host);
    expect(document.activeElement).toBe(field); expect(field.value).toBe('map.other'); expect(ctx.editor.pendingPlanPick).toBeNull();
    expect(ctx.editor.calibration.report().status).toBe('invalid'); ctx.noHA();
  });
  it('does not save an old coordinate when a numeric plan edit is incomplete', () => {
    const ctx = setup([binding]); ctx.click('trk-edit', 0); ctx.change('trk-cal-plan-x', '', 0); ctx.click('trk-save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('Complete the edited plan coordinates');
    expect(ctx.host.querySelector('[data-field="trk-cal-plan-x"]').value).toBe('');
    expect(ctx.editor.calibrationOverlay().points).toEqual([{ index: 1, label: '2', x: 2, y: 2 }]);
    ctx.change('trk-cal-plan-x', '1.25', 0); ctx.click('trk-save'); expect(ctx.card._layout.vacuum_bindings[0].position_source.calibration[0].plan).toEqual([1.25, 2]); ctx.noHA();
  });
  it('respects readonly repair guards and escapes imported source fields and provenance', () => {
    const old = { ...binding, position_source: { ...source, entity: 'sensor.deleted', calibration: [{ src: [10, 20], plan: [1, 2], note: '<script>bad</script>' }] } };
    const ctx = setup([old]); ctx.click('trk-edit', 0); ctx.editor.onClick('trk-cal-clear');
    expect(ctx.editor.draft.position_source).toEqual(old.position_source); expect(ctx.host.querySelector('script')).toBeNull();
    expect(ctx.editor.onClick('cal-add')).toBe(false); expect(ctx.editor.onChange('mower-entity', { value: 'sensor.other' })).toBe(false); ctx.noHA();
  });
});

function freshSetup(saved = [binding]) { vi.useFakeTimers(); vi.setSystemTime(epoch + 1000); const ctx = setup(saved); ctx.click('trk-edit', 0); return ctx; }
function configureFreshness(ctx, target, { mode = 'last_updated', format = 'iso', age = 5, attribute } = {}) {
  ctx.change(`trk-freshness-${target}-mode`, 'timestamp'); ctx.change(`trk-freshness-${target}-timestamp-mode`, mode);
  if (attribute !== undefined) ctx.change(`trk-freshness-${target}-attribute`, attribute);
  ctx.change(`trk-freshness-${target}-format`, format); ctx.change(`trk-freshness-${target}-age`, String(age));
}
describe('independent explicit vacuum reading age', () => {
  it('starts with absent rules and calls current HA measurement age unverified', () => {
    const ctx = freshSetup();
    for (const target of ['status', 'position']) {
      expect(ctx.host.querySelector(`[data-field="trk-freshness-${target}-mode"]`).value).toBe('current');
      expect(ctx.host.querySelector(`[data-trk-freshness-preview="${target}"]`).textContent).toContain('reading age is unverified');
    }
    ctx.change('trk-label', 'Keep current state'); ctx.click('trk-save');
    expect(ctx.card._layout.vacuum_bindings[0].freshness).toBeUndefined(); expect(ctx.card._layout.vacuum_bindings[0].position_source.freshness).toBeUndefined(); ctx.noHA();
  });
  it('saves separate status/location timestamp rules in one binding change with truthful independent expiry', () => {
    const ctx = freshSetup(); configureFreshness(ctx, 'status', { age: 5 }); configureFreshness(ctx, 'position', { age: 20 });
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.click('trk-save'); expect(ctx.card.commitFeatureLayout).toHaveBeenCalledTimes(1);
    const saved = ctx.card._layout.vacuum_bindings[0];
    expect(saved.freshness).toEqual({ timestamp_mode: 'last_updated', timestamp_format: 'iso', max_age_seconds: 5 });
    expect(saved.position_source.freshness).toEqual({ timestamp_mode: 'last_updated', timestamp_format: 'iso', max_age_seconds: 20 });
    const evaluate = (now) => buildVacuums({ hass: ctx.card._hass, bindings: [saved], floors: ctx.card._floors,
      positions: Object.fromEntries(ctx.card.trackingAnchors().map((anchor) => [anchor.id, anchor.position])), now });
    const statusExpired = evaluate(epoch + 6000);
    expect(statusExpired.records[0]).toMatchObject({ active: false, status: 'stale', measured: true, positionStatus: 'ready' });
    expect(statusExpired.nextExpiry).toBe(epoch + 20000);
    expect(evaluate(epoch + 21000).records[0]).toMatchObject({ active: false, status: 'stale', measured: false, positionStatus: 'stale', location: { x: 0, y: 0 } }); ctx.noHA();
  });
  it.each(['seconds', 'milliseconds', 'iso'])('uses actual %s attribute timestamps for location evidence', (format) => {
    const ctx = freshSetup(); ctx.card._hass.states['sensor.position'].attributes.observed = { at: format === 'seconds' ? epoch / 1000 : format === 'milliseconds' ? epoch : new Date(epoch).toISOString() };
    configureFreshness(ctx, 'position', { mode: 'attribute', format, age: 5, attribute: 'observed.at' });
    expect(ctx.editor.calibration.evidence()).toMatchObject({ status: 'ready', observedAt: epoch, expiresAt: epoch + 5000, verified: true });
    ctx.click('trk-save'); expect(ctx.card._layout.vacuum_bindings[0].position_source.freshness.timestamp_attr).toBe('observed.at'); ctx.noHA();
  });
  it('accepts an explicit timestamp in the source state and warns that last-changed is not a heartbeat', () => {
    const ctx = freshSetup(); ctx.card._hass.states['sensor.position'].state = '2026-10-05T10:00:00+00:00';
    configureFreshness(ctx, 'position', { mode: 'state', age: 5 }); expect(ctx.editor.calibration.evidence().observedAt).toBe(epoch);
    ctx.card._hass.states['vacuum.robot'].last_changed = new Date(epoch).toISOString(); configureFreshness(ctx, 'status', { mode: 'last_changed', age: 10 });
    expect(ctx.host.textContent).toContain('it is not a heartbeat for a quiet parked sensor'); ctx.click('trk-save'); ctx.noHA();
  });
  it('never substitutes dashboard time for a missing, future or timezone-free source timestamp', () => {
    const ctx = freshSetup(); configureFreshness(ctx, 'position', { mode: 'attribute', attribute: 'observed', age: 5 });
    for (const value of [undefined, '2026-10-05T10:00:00', new Date(epoch + 2000).toISOString()]) {
      ctx.card._hass.states['sensor.position'].attributes.observed = value; ctx.editor.updatePreviews(ctx.host);
      expect(ctx.editor.calibration.evidence()).toMatchObject({ status: 'invalid', raw: null, observedAt: null });
      expect(ctx.host.querySelector('[data-trk-freshness-preview="position"]').textContent).toContain('valid timestamp that is not in the future');
    }
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noHA();
  });
  it.each(['', '0', '-1', '1e309'])('blocks maximum age %s without changing the saved rule', (value) => {
    const ctx = freshSetup(); configureFreshness(ctx, 'status'); ctx.change('trk-freshness-status-age', value); ctx.click('trk-save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('positive finite number of seconds');
    expect(ctx.card._layout.vacuum_bindings[0]).toEqual(binding); ctx.noHA();
  });
  it('requires a chosen timestamp, attribute path and honest ISO format for HA update fields', () => {
    const ctx = freshSetup(); ctx.change('trk-freshness-status-mode', 'timestamp'); ctx.change('trk-freshness-status-age', '5'); ctx.click('trk-save');
    expect(ctx.host.textContent).toContain('Choose the actual source timestamp');
    ctx.change('trk-freshness-status-timestamp-mode', 'attribute'); ctx.click('trk-save'); expect(ctx.host.textContent).toContain('actual timestamp attribute path');
    ctx.change('trk-freshness-status-timestamp-mode', 'last_updated'); ctx.change('trk-freshness-status-format', 'seconds'); ctx.click('trk-save');
    expect(ctx.host.textContent).toContain('timestamps use ISO with a timezone'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noHA();
  });
  it.each([null, false, 'bad', [], { timestamp_mode: 'invented', max_age_seconds: 60 }, { timestamp_mode: 'last_updated', timestamp_format: 'fortnights', max_age_seconds: 60 }])('preserves malformed imported rule %j until a deliberate repair', (rule) => {
    const old = { ...binding, freshness: rule }; const ctx = freshSetup([old]); ctx.change('trk-label', 'Only label'); ctx.click('trk-save');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.editor.draft.freshness).toEqual(rule);
    expect(ctx.card._layout.vacuum_bindings[0]).toEqual(old); ctx.click('trk-cancel'); expect(ctx.card._layout.vacuum_bindings[0]).toEqual(old); ctx.noHA();
  });
  it('allows an explicit replacement of an unsupported rule while preserving its unknown object options', () => {
    const oldRule = { timestamp_mode: 'invented', max_age_seconds: 60, custom_rule: { keep: true }, timestamp_attr: 'heartbeat' };
    const ctx = freshSetup([{ ...binding, position_source: { ...source, freshness: oldRule } }]);
    expect(ctx.host.textContent).toContain('preserved until you deliberately choose a replacement');
    ctx.change('trk-freshness-position-mode', 'timestamp'); ctx.change('trk-freshness-position-timestamp-mode', 'last_updated'); ctx.change('trk-freshness-position-age', '10'); ctx.click('trk-save');
    expect(ctx.card._layout.vacuum_bindings[0].position_source.freshness).toEqual({ ...oldRule, timestamp_mode: 'last_updated', timestamp_format: 'iso', max_age_seconds: 10 }); ctx.noHA();
  });
  it('preserves supported imported rule field types and extra options on label-only edits', () => {
    const rule = { timestamp_mode: 'last_updated', max_age_seconds: '5', extra: ['keep'] };
    const ctx = freshSetup([{ ...binding, freshness: rule, position_source: { ...source, freshness: rule } }]); ctx.change('trk-label', 'My robot'); ctx.click('trk-save');
    expect(ctx.card._layout.vacuum_bindings[0].freshness).toEqual(rule); expect(ctx.card._layout.vacuum_bindings[0].position_source.freshness).toEqual(rule); ctx.noHA();
  });
  it('keeps imported incomplete rule settings visible and requires explicit positive age before Save', () => {
    const rule = { timestamp_mode: 'last_updated' }; const ctx = freshSetup([{ ...binding, freshness: rule }]);
    expect(ctx.host.querySelector('[data-field="trk-freshness-status-age"]').value).toBe(''); ctx.click('trk-save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    ctx.change('trk-freshness-status-age', '15'); ctx.click('trk-save'); expect(ctx.card._layout.vacuum_bindings[0].freshness).toEqual({ ...rule, max_age_seconds: 15 }); ctx.noHA();
  });
  it('deliberately returns one source to current-state mode without clearing the other rule', () => {
    const rule = { timestamp_mode: 'last_updated', max_age_seconds: 60 };
    const ctx = freshSetup([{ ...binding, freshness: rule, position_source: { ...source, freshness: rule } }]); ctx.change('trk-freshness-position-mode', 'current'); ctx.click('trk-save');
    expect(ctx.card._layout.vacuum_bindings[0].position_source.freshness).toBeUndefined(); expect(ctx.card._layout.vacuum_bindings[0].freshness).toEqual(rule); ctx.noHA();
  });
  it('validates configuration while offline and never claims that offline/restored readings are current', () => {
    const ctx = freshSetup(); ctx.card._hass.states['vacuum.robot'].state = 'unavailable'; ctx.card._hass.states['sensor.position'].attributes.restored = true;
    configureFreshness(ctx, 'status', { age: 5 }); configureFreshness(ctx, 'position', { age: 20 });
    expect(ctx.host.querySelector('[data-trk-freshness-preview="status"]').textContent).toContain('No current reading');
    expect(ctx.host.querySelector('[data-trk-freshness-preview="position"]').textContent).toContain('Stored reading');
    expect(ctx.editor.calibrationOverlay().mapped).toBeNull(); ctx.click('trk-save'); expect(ctx.card.commitFeatureLayout).toHaveBeenCalledTimes(1); ctx.noHA();
  });
  it('changes timestamp semantics without losing calibration pairs or demanding a new coordinate frame', () => {
    const ctx = freshSetup(); ctx.click('trk-cal-capture'); configureFreshness(ctx, 'position', { age: 5 });
    expect(ctx.editor.pendingPlanPick).toBeNull(); expect(ctx.editor.calibration.changedContext).toBe(false); expect(ctx.editor.draft.position_source.calibration).toEqual(source.calibration);
    ctx.click('trk-save'); expect(ctx.card._layout.vacuum_bindings[0].position_source.calibration).toEqual(source.calibration); ctx.noHA();
  });
  it('retains incomplete plan edits and focused timestamp attributes while live state updates arrive', () => {
    const ctx = freshSetup(); ctx.change('trk-cal-plan-x', '', 0); configureFreshness(ctx, 'position', { mode: 'attribute', attribute: 'observed', age: 5 });
    const field = ctx.host.querySelector('[data-field="trk-freshness-position-attribute"]'); field.focus(); field.value = 'observed.at'; field.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.card._hass.states['sensor.position'].attributes.observed = { at: new Date(epoch).toISOString() }; ctx.editor.updatePreviews(ctx.host);
    expect(document.activeElement).toBe(field); expect(ctx.editor.calibration.planEdits.get(0)).toEqual(['', 2]); ctx.click('trk-save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noHA();
  });
  it('saves both rules in one undo step, and Cancel restores exact imported options', () => {
    const ctx = freshSetup(); configureFreshness(ctx, 'status', { age: 5 }); configureFreshness(ctx, 'position', { age: 20 }); ctx.click('trk-cancel');
    expect(ctx.card._layout.vacuum_bindings[0]).toEqual(binding); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    ctx.click('trk-edit', 0); configureFreshness(ctx, 'status', { age: 5 }); configureFreshness(ctx, 'position', { age: 20 }); ctx.click('trk-save');
    expect(ctx.card._history.undo().layout.vacuum_bindings[0]).toEqual(binding); expect(ctx.card._history.redo().layout.vacuum_bindings[0].freshness.max_age_seconds).toBe(5); ctx.noHA();
  });
  it('escapes malformed saved rules rather than executing their text', () => {
    const ctx = freshSetup([{ ...binding, freshness: '<img src=x onerror=bad()>' }]); expect(ctx.host.querySelector('img,script')).toBeNull(); expect(ctx.host.textContent).toContain('<img'); ctx.noHA();
  });
});
