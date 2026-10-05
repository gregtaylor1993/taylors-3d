// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingCalibration, calibrationReport, coordinateEvidence } from '../src/tracking-calibration.js';

const epoch = Date.parse('2026-10-05T10:00:00Z');
const state = (value = 'ready', attrs = {}) => ({ state: value, attributes: { friendly_name: 'Measured robot map', x: 10, y: 20, ...attrs }, last_updated: new Date(epoch).toISOString() });
const floors = [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'upper', name: 'Upper', elevation: 3 }];
const source = { source: 'xy', entity: 'sensor.xy', x_attr: 'x', y_attr: 'y', floorId: 'ground', units: 'm', plan_meters: true };
const point = (src, plan, extra = {}) => ({ src, plan, ...extra });
const clone = (value) => JSON.parse(JSON.stringify(value));
const malformedRestored = ['true', 'false', 0, null, [], {}].map((value) => ({ value }));
function setup(overrides = {}) {
  let time = epoch + 1000;
  const hass = { states: { 'sensor.xy': state(), 'vacuum.robot': state('cleaning', { x: 88, y: 99 }), 'sensor.other': state() }, entities: {}, callService: vi.fn(), callWS: vi.fn() };
  const options = { source: clone(source), hass, floors, contextKey: 'layout:model:generation-1', now: () => time, imported: false,
    onChange: vi.fn(), onPlanPick: vi.fn(), onPreview: vi.fn(), ...overrides };
  const controller = new TrackingCalibration(options);
  const noHA = () => { expect(options.hass.callService).not.toHaveBeenCalled(); expect(options.hass.callWS).not.toHaveBeenCalled(); };
  const capture = (raw, plan, floor = 'ground') => {
    options.hass.states['sensor.xy'] = state('ready', { x: raw[0], y: raw[1] }); controller.update({ hass: options.hass });
    const pending = controller.captureSourcePoint(); expect(pending).toBeTruthy(); expect(controller.acceptPlanPoint(plan, floor, pending.token)).toBe(true);
  };
  return { controller, options, hass: options.hass, noHA, capture, time: (value) => { time = value; } };
}
afterEach(() => document.body.replaceChildren());

describe('honest coordinate evidence', () => {
  it('reads the actual separate position entity and calls missing age unverified', () => {
    const ctx = setup(); expect(ctx.controller.evidence()).toMatchObject({ status: 'ready', kind: 'xy', raw: [10, 20], verified: false, observedAt: null });
    expect(ctx.controller.evidence().ageLabel).toContain('measurement age is unverified'); ctx.noHA();
  });
  it.each(['unknown', 'unavailable'])('rejects %s even when numeric coordinate attributes remain', (value) => {
    const ctx = setup(); ctx.hass.states['sensor.xy'] = state(value);
    expect(ctx.controller.evidence()).toMatchObject({ status: 'unavailable', raw: null }); ctx.controller.setFrame('calibrated'); expect(ctx.controller.captureSourcePoint()).toBeNull(); ctx.noHA();
  });
  it.each(['hidden', 'disabled', 'diagnostic', 'restored', 'missing'])('does not capture a %s source', (kind) => {
    const ctx = setup(); if (kind === 'missing') delete ctx.hass.states['sensor.xy'];
    else if (kind === 'restored') ctx.hass.states['sensor.xy'].attributes.restored = true;
    else ctx.hass.entities['sensor.xy'] = kind === 'hidden' ? { hidden_by: 'user' } : kind === 'disabled' ? { disabled_by: 'user' } : { entity_category: 'diagnostic' };
    ctx.controller.setFrame('calibrated'); expect(ctx.controller.captureSourcePoint()).toBeNull(); expect(ctx.options.onPlanPick).not.toHaveBeenCalled(); ctx.noHA();
  });
  it.each(malformedRestored)('rejects a present nonboolean restored flag $value without a measured draft', ({ value }) => {
    const calibration = [point([0, 0], [0, 0]), point([1, 0], [1, 0])];
    const ctx = setup({ source: { ...source, plan_meters: false, calibration }, imported: true });
    ctx.hass.states['sensor.xy'] = state('ready', { restored: value }); ctx.controller.update({ hass: ctx.hass });
    expect(ctx.controller.evidence()).toMatchObject({ status: 'invalid', raw: null });
    expect(ctx.options.onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'invalid', mapped: null }));
    const host = document.createElement('div'); host.innerHTML = ctx.controller.renderHTML(); ctx.controller.updatePreviews(host);
    expect(host.querySelector('[data-cal-capture]').disabled).toBe(true); expect(host.textContent).not.toContain('Raw X/Y: 10, 20');
    expect(ctx.controller.captureSourcePoint()).toBeNull(); expect(ctx.controller.pending).toBeNull();
    expect(ctx.options.onPlanPick).not.toHaveBeenCalled(); expect(ctx.controller.getSource().calibration).toEqual(calibration); ctx.noHA();
  });
  it.each([{ kind: 'omitted', attrs: {} }, { kind: 'false', attrs: { restored: false } }])('keeps an $kind restored flag as current evidence and accepts a genuine capture', ({ attrs }) => {
    const ctx = setup(); ctx.hass.states['sensor.xy'] = state('ready', attrs); ctx.controller.update({ hass: ctx.hass });
    expect(ctx.controller.evidence()).toMatchObject({ status: 'ready', raw: [10, 20] });
    expect(ctx.options.onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', mapped: [10, 20] }));
    ctx.controller.setFrame('calibrated'); const pending = ctx.controller.captureSourcePoint();
    expect(pending).toMatchObject({ raw: [10, 20] }); expect(ctx.controller.acceptPlanPoint([1, 2], 'ground', pending.token)).toBe(true);
    expect(ctx.controller.getSource().calibration).toEqual([point([10, 20], [1, 2])]); ctx.noHA();
  });
  it('treats restored true as unavailable without exposing its numeric coordinates as a measured draft', () => {
    const ctx = setup(); ctx.hass.states['sensor.xy'] = state('ready', { restored: true }); ctx.controller.update({ hass: ctx.hass });
    expect(ctx.controller.evidence()).toMatchObject({ status: 'unavailable', raw: null });
    expect(ctx.options.onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'unavailable', mapped: null }));
    ctx.controller.setFrame('calibrated'); expect(ctx.controller.captureSourcePoint()).toBeNull();
    expect(ctx.options.onPlanPick).not.toHaveBeenCalled(); ctx.noHA();
  });
  it.each([false, true, '', ' ', '0x10', null, Infinity])('rejects malformed source numbers: %s', (value) => {
    const ctx = setup(); ctx.hass.states['sensor.xy'] = state('ready', { x: value }); expect(ctx.controller.evidence()).toMatchObject({ status: 'invalid', raw: null }); ctx.noHA();
  });
  it('supports nested exact attributes while rejecting inherited path data', () => {
    const ctx = setup({ source: { ...source, x_attr: 'location.east', y_attr: 'location.north' } });
    ctx.hass.states['sensor.xy'] = state('ready', { location: { east: '1.5', north: '-2' } }); expect(ctx.controller.evidence().raw).toEqual([1.5, -2]);
    ctx.hass.states['sensor.xy'].attributes.location = Object.create({ east: 1, north: 2 }); expect(ctx.controller.evidence().status).toBe('invalid');
  });
  it('checks declared absolute timestamps and rejects expired/future/malformed freshness', () => {
    const ctx = setup({ source: { ...source, freshness: { timestamp_mode: 'last_updated', max_age_seconds: 5 } } });
    expect(ctx.controller.evidence()).toMatchObject({ status: 'ready', observedAt: epoch, expiresAt: epoch + 5000, verified: true });
    ctx.time(epoch + 5000); expect(ctx.controller.evidence()).toMatchObject({ status: 'stale', raw: null });
    ctx.time(epoch - 1); expect(ctx.controller.evidence().status).toBe('invalid');
    ctx.controller.setSource({ ...source, freshness: 'broken' }); expect(ctx.controller.evidence().status).toBe('invalid'); ctx.noHA();
  });
  it('requires an exact mapped floor with actual finite elevation, not a name or guessed floor', () => {
    const ctx = setup();
    for (const value of [[], [{ id: 'ground' }], [{ id: 'ground', elevation: '0' }], [...floors, floors[0]], [{ id: 'replacement', name: 'Ground', elevation: 0 }]]) {
      expect(coordinateEvidence(ctx.hass, source, { floors: value, now: epoch }).status).toBe('invalid');
    }
  });
});

describe('configuration math and preservation', () => {
  it('supports explicit direct m/cm/mm units without claiming raw map units are metres', () => {
    for (const [units, raw, expected] of [['m', [2, -1], [2, -1]], ['cm', [200, -100], [2, -1]], ['mm', [2000, -1000], [2, -1]]]) {
      const fit = calibrationReport({ ...source, units }, { floors }); expect(fit.status).toBe('ready'); expect(fit.transform(raw)).toEqual(expected);
    }
    expect(calibrationReport({ ...source, units: undefined }, { floors }).status).toBe('invalid');
  });
  it('requires 2+ genuine pairs for new calibration and shows exact similarity is not accuracy', () => {
    const ctx = setup(); ctx.controller.setFrame('calibrated'); ctx.controller.setUnits('raw');
    ctx.capture([0, 0], [5, 1]); expect(ctx.controller.report().status).toBe('invalid');
    ctx.capture([1000, 0], [5, 3]); const report = ctx.controller.report();
    expect(report).toMatchObject({ status: 'ready', method: 'similarity', residual: 0 }); expect(report.transform([3000, -2000])).toEqual([9, 7]);
    expect(report.explanation).toContain('does not measure accuracy'); expect(ctx.controller.getSource().units).toBeUndefined(); ctx.noHA();
  });
  it('fits a genuine reflected and unequal-scale map with three noncollinear pairs', () => {
    const ctx = setup(); ctx.controller.setFrame('calibrated'); ctx.controller.setUnits('raw');
    const map = ([x, y]) => [2 * x + 5, -3 * y + 7];
    for (const raw of [[0, 0], [1, 0], [0, 1]]) ctx.capture(raw, map(raw));
    const report = ctx.controller.report(); expect(report).toMatchObject({ status: 'ready', method: 'affine' }); expect(report.transform([2, 3])[0]).toBeCloseTo(9); expect(report.transform([2, 3])[1]).toBeCloseTo(-2);
  });
  it.each([
    [point([0, 0], [1, 2]), point([0, 0], [3, 4])],
    [point([0, 0], [0, 0]), point([1, 0], [1, 0]), point([2, 0], [2, 0])],
    [point([0, 0], [1, 1]), point([1, 0], [1, 1])],
    [point([0, false], [1, 2]), point([1, 0], [3, 4])],
  ])('rejects duplicate, collinear, collapsed or malformed pairs', (calibration) => {
    const report = calibrationReport({ ...source, plan_meters: false, calibration }, { floors }); expect(report.status).toBe('invalid'); expect(report.transform).toBeNull();
  });
  it('reports actual noisy-fit residual in plan metres and never labels it guaranteed accuracy', () => {
    const calibration = [[0, 0], [10, 0], [10, 10], [0, 10]].map((src, i) => point(src, [src[0] + (i % 2 ? .5 : -.5), src[1]]));
    const report = calibrationReport({ ...source, calibration }, { floors }); expect(report.residual).toBeGreaterThan(.3); expect(report.explanation).toContain('does not guarantee accuracy elsewhere');
  });
  it.each([
    { ...source, units: 'cm', calibration: [point([100, 200], [3, 4], { provenance: 'imported' })], future: { retained: true } },
    { entity: 'sensor.xy', source: 'gps', latitude_attr: 'lat', longitude_attr: 'lon', north_up: true, floorId: 'ground', calibration: [point([45, 10], [3, 4])], future: [1, 2] },
  ])('preserves valid one-point/GPS imports including every unknown field without forced conversion', (imported) => {
    const before = clone(imported), ctx = setup({ source: imported, imported: true }); expect(ctx.controller.report().status).toBe('ready');
    expect(ctx.controller.getSource()).toEqual(before); const copy = ctx.controller.getSource(); copy.future = 'changed'; expect(ctx.controller.getSource()).toEqual(before);
    ctx.controller.reset(); expect(ctx.controller.getSource()).toEqual(before); expect(imported).toEqual(before); expect(ctx.options.onChange).not.toHaveBeenCalled(); ctx.noHA();
  });
  it('keeps unsupported imported sources visibly preserved instead of converting them', () => {
    const imported = { ...source, source: 'future-format', calibration: [point([1, 2], [3, 4])] };
    const ctx = setup({ source: imported, imported: true }); expect(ctx.controller.renderHTML()).toContain('preserved read-only'); expect(ctx.controller.setUnits('m')).toBe(false);
    expect(ctx.controller.setFrame('calibrated')).toBe(false); expect(ctx.controller.getSource()).toEqual(imported);
  });
  it('preserves per-point provenance and all source fields when changing only matched plan coordinates', () => {
    const imported = { ...source, future: { keep: true }, calibration: [point([0, 0], [1, 2], { source_note: 'dock' }), point([1, 0], [3, 4])] };
    const ctx = setup({ source: imported, imported: true }); ctx.controller.setPlanPoint(0, ['1.23456789', '-2.987654321']);
    expect(ctx.controller.getSource().calibration[0]).toEqual({ src: [0, 0], plan: [1.23456789, -2.987654321], source_note: 'dock' }); expect(ctx.controller.getSource().future).toEqual({ keep: true });
    ctx.controller.reset(); expect(ctx.controller.getSource()).toEqual(imported);
  });
  it('configuration stays valid offline while measured preview disappears', () => {
    const ctx = setup(); ctx.hass.states['sensor.xy'].state = 'unavailable'; ctx.controller.update({ hass: ctx.hass });
    expect(ctx.controller.report().status).toBe('ready'); expect(ctx.options.onPreview.mock.lastCall[0].mapped).toBeNull(); ctx.noHA();
  });
  it('blocks readiness for an incomplete edit rather than silently saving the old plan coordinate', () => {
    const ctx = setup({ source: { ...source, calibration: [point([0, 0], [1, 2]), point([1, 0], [2, 2])] }, imported: true });
    ctx.controller.onChange('trk-cal-plan-x', { value: '', dataset: { index: '0' } });
    expect(ctx.controller.report().status).toBe('invalid'); expect(ctx.controller.getSource().calibration[0].plan).toEqual([1, 2]);
    const host = document.createElement('div'); host.innerHTML = ctx.controller.renderHTML(); expect(host.querySelector('[data-field="trk-cal-plan-x"]').value).toBe('');
    ctx.controller.onChange('trk-cal-plan-y', { value: '3', dataset: { index: '0' } }); expect(ctx.controller.report().status).toBe('invalid');
    ctx.controller.onChange('trk-cal-plan-x', { value: '1.1234567', dataset: { index: '0' } });
    expect(ctx.controller.report().status).toBe('ready'); expect(ctx.controller.getSource().calibration[0].plan).toEqual([1.1234567, 3]); ctx.noHA();
  });
  it('retains invalid edits of other pairs when removing a different row, and Reset restores the import', () => {
    const imported = { ...source, calibration: [point([0, 0], [1, 2]), point([1, 0], [2, 2]), point([0, 1], [1, 3])] };
    const ctx = setup({ source: imported, imported: true }); ctx.controller.setPlanPoint(2, ['', 3]); ctx.controller.removePoint(0);
    expect(ctx.controller.report().status).toBe('invalid'); expect(ctx.controller.planEdits.has(1)).toBe(true); ctx.controller.reset();
    expect(ctx.controller.report().status).toBe('ready'); expect(ctx.controller.getSource()).toEqual(imported);
  });
  it.each([null, 'broken', false, []])('safely reports malformed imported source values: %j', (value) => {
    expect(calibrationReport(value, { floors }).status).toBe('invalid'); expect(coordinateEvidence({}, value, { floors, now: epoch }).status).toBe('missing');
  });
});

describe('frozen capture, explicit context and cancellation', () => {
  it('freezes raw pair and actual timestamp evidence, never replacing it with newer readings', () => {
    const ctx = setup({ source: { ...source, freshness: { timestamp_mode: 'last_updated', max_age_seconds: 30 } } }); ctx.controller.setFrame('calibrated');
    const pending = ctx.controller.captureSourcePoint(); expect(Object.isFrozen(pending)).toBe(true); expect(Object.isFrozen(pending.raw)).toBe(true);
    expect(pending).toMatchObject({ raw: [10, 20], observedAt: epoch, expiresAt: epoch + 30000, verified: true, floorId: 'ground' });
    ctx.hass.states['sensor.xy'] = state('ready', { x: 30, y: 40 }); ctx.controller.update({ hass: ctx.hass });
    expect(ctx.controller.pending).toBe(pending); expect(ctx.controller.acceptPlanPoint([1.234567, -3.1415926], 'ground', pending.token)).toBe(true);
    expect(ctx.controller.getSource().calibration[0]).toEqual(point([10, 20], [1.234567, -3.1415926])); ctx.noHA();
  });
  it('requires explicit attribute mappings before capturing even if default X/Y values exist', () => {
    const ctx = setup({ source: { ...source, x_attr: '', y_attr: '' } }); ctx.controller.setFrame('calibrated'); expect(ctx.controller.captureSourcePoint()).toBeNull(); expect(ctx.controller.message).toContain('attribute paths');
  });
  it.each([[false, 2], ['', 2], [null, 2], [Infinity, 2], ['0x10', 2]])('rejects invalid manually entered plan coordinates without substituting zero', (invalid) => {
    const ctx = setup(); ctx.controller.setFrame('calibrated'); const pending = ctx.controller.captureSourcePoint();
    expect(ctx.controller.acceptPlanPoint(invalid, 'ground', pending.token)).toBe(false); expect(ctx.controller.pending).toBe(pending); expect(ctx.options.onChange).toHaveBeenCalledTimes(1);
  });
  it('rejects wrong-floor or delayed-token picks and never accepts an old snapshot into a new model context', () => {
    const ctx = setup(); ctx.controller.setFrame('calibrated'); const pending = ctx.controller.captureSourcePoint();
    expect(ctx.controller.acceptPlanPoint([1, 2], 'ground', pending.token + 1)).toBe(false); expect(ctx.controller.pending).toBe(pending);
    expect(ctx.controller.acceptPlanPoint([1, 2], 'upper', pending.token)).toBe(false); expect(ctx.controller.pending).toBeNull();
    const next = ctx.controller.captureSourcePoint(); ctx.controller.update({ contextKey: 'layout:model:generation-2' });
    expect(ctx.controller.acceptPlanPoint([1, 2], 'ground', next.token)).toBe(false); expect(ctx.controller.getSource().calibration).toBeUndefined();
  });
  it('cancels a pick when its floor disappears or current source becomes restored', () => {
    const ctx = setup(); ctx.controller.setFrame('calibrated'); ctx.controller.captureSourcePoint(); ctx.controller.update({ floors: [] }); expect(ctx.controller.pending).toBeNull();
    ctx.controller.update({ floors }); ctx.controller.captureSourcePoint(); ctx.hass.states['sensor.xy'].attributes.restored = true; ctx.controller.update({ hass: ctx.hass }); expect(ctx.controller.pending).toBeNull();
  });
  it.each(malformedRestored)('cancels an existing capture when restored changes to nonboolean $value and rejects its delayed plan click', ({ value }) => {
    const calibration = [point([0, 0], [0, 0]), point([1, 0], [1, 0])];
    const ctx = setup({ source: { ...source, plan_meters: false, calibration }, imported: true });
    ctx.controller.update(); expect(ctx.options.onPreview.mock.lastCall[0].mapped).toEqual([10, 20]);
    const pending = ctx.controller.captureSourcePoint(); expect(pending).toMatchObject({ raw: [10, 20] });
    ctx.hass.states['sensor.xy'].attributes.restored = value; ctx.controller.update({ hass: ctx.hass });
    expect(ctx.controller.pending).toBeNull(); expect(ctx.options.onPlanPick).toHaveBeenLastCalledWith(null);
    expect(ctx.options.onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'invalid', mapped: null }));
    expect(ctx.controller.acceptPlanPoint([2, 3], 'ground', pending.token)).toBe(false);
    expect(ctx.controller.getSource().calibration).toEqual(calibration); ctx.noHA();
  });
  it('does not silently substitute a newer reading when the captured timestamp expires', () => {
    const ctx = setup({ source: { ...source, freshness: { timestamp_mode: 'last_updated', max_age_seconds: 5 } } }); ctx.controller.setFrame('calibrated'); const pending = ctx.controller.captureSourcePoint();
    ctx.time(epoch + 6000); ctx.hass.states['sensor.xy'] = { ...state(), last_updated: new Date(epoch + 6000).toISOString() };
    expect(ctx.controller.acceptPlanPoint([1, 2], 'ground', pending.token)).toBe(false); expect(ctx.controller.pending).toBeNull();
  });
  it.each([['entity', 'sensor.other'], ['x_attr', 'new_x'], ['y_attr', 'new_y'], ['floorId', 'upper']])('retains existing pairs but requires deliberate confirmation after changing %s', (field, value) => {
    const calibration = [point([0, 0], [1, 2]), point([1, 0], [2, 2])]; const ctx = setup({ source: { ...source, calibration }, imported: true });
    ctx.controller.captureSourcePoint(); ctx.controller.setField(field, value); expect(ctx.controller.pending).toBeNull();
    expect(ctx.controller.getSource().calibration).toEqual(calibration); expect(ctx.controller.report().diagnostics.some((d) => d.code === 'context')).toBe(true);
    expect(ctx.controller.captureSourcePoint()).toBeNull(); ctx.controller.confirmSourceContext(); expect(ctx.controller.changedContext).toBe(false);
  });
  it('requires explicit context confirmation for unit/frame/source replacements without deleting imported pairs', () => {
    const calibration = [point([0, 0], [1, 2]), point([1, 0], [2, 2])]; const ctx = setup({ source: { ...source, calibration }, imported: true });
    ctx.controller.setUnits('cm'); expect(ctx.controller.changedContext).toBe(true); expect(ctx.controller.getSource().calibration).toEqual(calibration);
    ctx.controller.confirmSourceContext(); ctx.controller.setFrame('plan'); expect(ctx.controller.report().status).toBe('invalid'); expect(ctx.controller.getSource().calibration).toEqual(calibration);
    ctx.controller.clearMapping(); expect(ctx.controller.getSource().calibration).toEqual([]); expect(ctx.controller.report().status).toBe('ready');
    ctx.controller.setSource({ ...source, calibration, floorId: 'upper' }); expect(ctx.controller.changedContext).toBe(true);
  });
  it('cleanup cancels actual pending picks, removes previews and rejects late delegated actions', () => {
    const ctx = setup(); ctx.controller.setFrame('calibrated'); const pending = ctx.controller.captureSourcePoint(); ctx.controller.dispose();
    expect(ctx.options.onPlanPick.mock.lastCall).toEqual([null]); expect(ctx.options.onPreview.mock.lastCall).toEqual([null]);
    expect(ctx.controller.acceptPlanPoint([1, 2], 'ground', pending.token)).toBe(false); expect(ctx.controller.onClick('trk-cal-clear')).toBe(false); expect(ctx.controller.onChange('trk-cal-x_attr', { value: 'bad' })).toBe(false); ctx.noHA();
  });
  it('unchanged live updates do not repeat geometry preview callbacks', () => {
    const ctx = setup(); ctx.controller.update(); const count = ctx.options.onPreview.mock.calls.length;
    ctx.controller.update({ hass: { ...ctx.hass, states: { ...ctx.hass.states, 'sensor.unrelated': state('43') } } }); expect(ctx.options.onPreview).toHaveBeenCalledTimes(count); ctx.noHA();
  });
});

describe('reusable visual form delegation', () => {
  it('labels an available preserved GPS reading as latitude/longitude without calling it X/Y', () => {
    const gps = { source: 'gps', entity: 'sensor.xy', north_up: true, floorId: 'ground', calibration: [point([51.5, -.1], [1, 2])] };
    const ctx = setup({ source: gps }); ctx.hass.states['sensor.xy'] = state('ready', { latitude: 51.5, longitude: -.1 });
    const host = document.createElement('div'); host.innerHTML = ctx.controller.renderHTML();
    expect(host.textContent).toContain('Raw latitude/longitude: 51.5, -0.1'); expect(host.textContent).not.toContain('Raw X/Y');
    expect(ctx.controller.getSource()).toEqual(gps); ctx.noHA();
  });
  it('changes only explicit freshness without losing imported points, context or incomplete edits', () => {
    const imported = { ...source, units: 'cm', calibration: [point([0, 0], [1, 2], { provenance: true }), point([100, 0], [2, 2])] };
    const ctx = setup({ source: imported, imported: true }); ctx.controller.setPlanPoint(0, ['', 2]);
    const rule = { timestamp_mode: 'last_updated', max_age_seconds: 5, future_rule: { keep: true } };
    ctx.controller.setFreshness(rule); rule.future_rule.keep = false;
    expect(ctx.controller.getSource()).toEqual({ ...imported, freshness: { ...rule, future_rule: { keep: true } } });
    expect(ctx.controller.changedContext).toBe(false); expect(ctx.controller.planEdits.get(0)).toEqual(['', 2]);
    expect(ctx.controller.report().status).toBe('invalid'); ctx.controller.setFreshness(undefined); expect(ctx.controller.getSource()).toEqual(imported); ctx.noHA();
  });
  it('cancels an in-progress source capture when its explicit freshness rule changes', () => {
    const ctx = setup(); ctx.controller.setFrame('calibrated'); ctx.controller.captureSourcePoint();
    ctx.controller.setFreshness({ timestamp_mode: 'last_updated', max_age_seconds: 5 });
    expect(ctx.controller.pending).toBeNull(); expect(ctx.options.onPlanPick).toHaveBeenLastCalledWith(null); expect(ctx.controller.changedContext).toBe(false); ctx.noHA();
  });
  it('supports keyboard numeric pairing with unsnapped points and no parent Save or HA action', () => {
    const ctx = setup(); ctx.controller.setFrame('calibrated'); const host = document.createElement('div'); document.body.append(host);
    host.innerHTML = ctx.controller.renderHTML(); ctx.controller.updatePreviews(host);
    expect(ctx.controller.onClick('trk-cal-capture', host.querySelector('[data-act="trk-cal-capture"]'))).toBe(true); host.innerHTML = ctx.controller.renderHTML();
    host.querySelector('[data-field="trk-cal-pending-x"]').value = '1.123456789'; host.querySelector('[data-field="trk-cal-pending-y"]').value = '-2.987654321';
    ctx.controller.onClick('trk-cal-accept', host.querySelector('[data-act="trk-cal-accept"]'));
    expect(ctx.controller.getSource().calibration[0]).toEqual(point([10, 20], [1.123456789, -2.987654321])); ctx.noHA();
  });
  it('labels/filter choices, keeps missing exact IDs and includes touch/focus/theme styles', () => {
    const ctx = setup({ source: { ...source, entity: 'sensor.deleted', floorId: 'removed' } }); ctx.hass.states['sensor.hidden'] = state(); ctx.hass.entities['sensor.hidden'] = { hidden_by: 'user' };
    const host = document.createElement('div'); host.innerHTML = ctx.controller.renderHTML(); ctx.controller.updatePreviews(host);
    expect(host.querySelector('[data-field="trk-cal-entity"]').value).toBe('sensor.deleted'); expect(host.querySelector('[data-field="trk-cal-floorId"]').value).toBe('removed');
    expect(host.querySelector('[data-field="trk-cal-entity"]').textContent).not.toContain('sensor.hidden');
    expect(host.querySelector('style').textContent).toContain('min-height:44px'); expect(host.querySelector('style').textContent).toContain(':focus-visible'); expect(host.querySelector('style').textContent).toContain('--card-background-color');
    expect(host.querySelector('[data-cal-capture]').disabled).toBe(true); ctx.noHA();
  });
  it('keeps an unsupported saved unit selected instead of quietly showing metres', () => {
    const imported = { ...source, units: 'pixels', calibration: [point([0, 0], [0, 0]), point([100, 0], [1, 0])] };
    const ctx = setup({ source: imported, imported: true }); const host = document.createElement('div'); host.innerHTML = ctx.controller.renderHTML();
    expect(host.querySelector('[data-field="trk-cal-units"]').value).toBe('pixels'); expect(host.querySelector('[data-field="trk-cal-units"]').selectedOptions[0].textContent).toContain('Unsupported saved unit');
    expect(ctx.controller.getSource()).toEqual(imported); expect(ctx.controller.report().status).toBe('invalid'); ctx.noHA();
  });
  it('keeps focused edits and frozen-pick controls mounted during passive live evidence updates', () => {
    const ctx = setup(); ctx.controller.setFrame('calibrated'); ctx.controller.captureSourcePoint(); const host = document.createElement('div'); document.body.append(host); host.innerHTML = ctx.controller.renderHTML();
    const input = host.querySelector('[data-field="trk-cal-pending-x"]'); input.value = '1.234'; input.focus();
    ctx.hass.states['sensor.xy'] = state('ready', { x: 30, y: 40 }); ctx.controller.update({ hass: ctx.hass }); ctx.controller.updatePreviews(host);
    expect(host.querySelector('[data-field="trk-cal-pending-x"]')).toBe(input); expect(input.value).toBe('1.234'); expect(document.activeElement).toBe(input); expect(ctx.controller.pending.raw).toEqual([10, 20]);
    ctx.hass.states['sensor.xy'].attributes.restored = true; ctx.controller.update({ hass: ctx.hass }); ctx.controller.updatePreviews(host);
    expect(host.querySelector('[data-cal-pending]').hidden).toBe(true); expect(ctx.controller.pending).toBeNull();
  });
  it('escapes imported reading/name/point annotation and never creates markup from source data', () => {
    const ctx = setup(); ctx.hass.states['sensor.xy'].attributes.friendly_name = '<img src=x onerror=bad()>'; ctx.hass.states['sensor.xy'].state = '<script>bad()</script>';
    const host = document.createElement('div'); host.innerHTML = ctx.controller.renderHTML(); expect(host.querySelector('img,script')).toBeNull(); expect(host.textContent).toContain('<img');
    expect(host.querySelector('[data-tracking-calibration]').dataset.taylors3dUi).toBe('tracking-calibration');
  });
  it('delegates only its own field/action prefix and preserves sources on Cancel', () => {
    const ctx = setup(); expect(ctx.controller.onChange('mower-xattr', { value: 'x' })).toBe(false); expect(ctx.controller.onClick('cal-add')).toBe(false);
    ctx.controller.onChange('trk-cal-x_attr', { value: 'nested.x' }); expect(ctx.controller.getSource().x_attr).toBe('nested.x'); ctx.controller.reset(); expect(ctx.controller.getSource()).toEqual(source); ctx.noHA();
  });
});
