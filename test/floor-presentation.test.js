import { describe, expect, it } from 'vitest';
import { FLOOR_PRESENTATION_DEFAULTS, FLOOR_PRESENTATION_LIMITS, readFloorPresentation,
  compileFloorPresentation, sourceWorldToDisplay, displayWorldToSource } from '../src/floor-presentation.js';

const floors = [{ id: 'upper', elevation: 4.5 }, { id: 'basement', elevation: -2 }, { id: 'ground', elevation: .25 }];
const bounds = [{ floor_id: 'basement', min: [-12, -2, -7], max: [-4, .5, 1] },
  { floor_id: 'ground', min: [3, .25, -2], max: [16, 3, 4] },
  { floor_id: 'upper', min: [-8, 4.5, 9], max: [-3, 7, 13] }];
const model = { present: true, supported: true, diagnostics: [] };
const context = (extra = {}) => ({ floors, bounds, model, ...extra });
const codes = (result) => result.diagnostics.map((entry) => entry.code);
const compile = (raw, extra) => compileFloorPresentation(raw, context(extra));
const ids = (result) => result.rows.map((row) => row.floor_id);
const failClosed = (result, code) => {
  expect(result).toMatchObject({ mode: 'assembled', valid: false, rows: [] }); expect(codes(result)).toContain(code);
};
const freezeDeep = (value) => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeDeep(child); Object.freeze(value); }
  return value;
};

describe('strict floor presentation settings', () => {
  it('defines named safety limits and an assembled default without imported-field writes', () => {
    expect(FLOOR_PRESENTATION_LIMITS).toMatchObject({ maxFloors: 4, maxGapM: 100, maxBaseElevationM: 1000, maxWorldCoordinate: 1000000 });
    expect(Object.isFrozen(FLOOR_PRESENTATION_DEFAULTS)).toBe(true);
    const raw = freezeDeep({ extension: { custom: ['retained'] } });
    expect(readFloorPresentation(raw)).toEqual({ ...FLOOR_PRESENTATION_DEFAULTS, valid: true, diagnostics: [] });
    expect(readFloorPresentation(undefined)).toEqual(readFloorPresentation(raw)); expect(raw.extension.custom).toEqual(['retained']);
  });
  it.each([null, false, true, 0, '', [], new Date()])('rejects malformed settings shape %j', (raw) => {
    expect(readFloorPresentation(raw)).toMatchObject({ mode: 'assembled', valid: false }); expect(codes(readFloorPresentation(raw))).toEqual(['invalid_policy']);
  });
  it.each([['mode', 'flat'], ['mode', 'HORIZONTAL'], ['mode', undefined], ['axis', 'south'], ['axis', null],
    ['gap_m', -1], ['gap_m', 101], ['gap_m', '2'], ['gap_m', Infinity], ['gap_m', NaN], ['gap_m', true],
    ['base_elevation_m', -1001], ['base_elevation_m', 1001], ['base_elevation_m', '0'], ['base_elevation_m', null]])('rejects malformed own %s=%j atomically', (field, value) => {
    const raw = { mode: 'horizontal', [field]: value }, policy = readFloorPresentation(raw);
    expect(policy.valid).toBe(false); expect(codes(policy)).toContain(`invalid_${field}`);
    const compiled = compile(raw); expect(compiled.mode).toBe('assembled');
    if (field !== 'mode') expect(compiled.rows).toEqual([]);
  });
  it('accepts exact endpoints, zero gap and a null-prototype settings object', () => {
    const raw = Object.assign(Object.create(null), { mode: 'vertical', floors: ['basement'], gap_m: 0, axis: 'north', base_elevation_m: -1000 });
    expect(readFloorPresentation(raw)).toMatchObject({ valid: true, gap_m: 0, base_elevation_m: -1000 });
    expect(readFloorPresentation({ gap_m: 100, base_elevation_m: 1000 }).valid).toBe(true);
  });
  it.each([null, undefined, 'ground', {}, [1], [null], [''], [' ground'], ['ground '], ['ground\n'], [false], ['ground', 'ground'], Array(1)])('rejects invalid explicit floor list %j', (selected) => {
    expect(readFloorPresentation({ mode: 'horizontal', floors: selected }).valid).toBe(false);
  });
  it('preserves exact case-sensitive IDs, imported selection order and unknown fields', () => {
    const raw = freezeDeep({ mode: 'horizontal', floors: ['Upper exact', 'floor:ß'], future: { mode: 'new' } });
    const policy = readFloorPresentation(raw); expect(policy.valid).toBe(true); expect(policy.floors).toEqual(raw.floors); expect(policy.floors).not.toBe(raw.floors);
    policy.floors.push('changed-output-only'); expect(raw.floors).toEqual(['Upper exact', 'floor:ß']);
  });
  it('keeps the reader diagnostics when its normalized policy is compiled', () => {
    const policy = readFloorPresentation({ mode: 'horizontal', gap_m: '2' });
    failClosed(compile(policy), 'invalid_gap_m'); expect(readFloorPresentation(policy)).toBe(policy);
  });
});

describe('assembled identity is independent of split prerequisites', () => {
  it('works without bounds or model support, retains every known floor beyond the split limit', () => {
    const many = Array.from({ length: 6 }, (_, rank) => ({ id: `f${rank}`, elevation: rank * 3 }));
    const compiled = compileFloorPresentation(undefined, { floors: many, bounds: null, model: { present: true, supported: false } });
    expect(compiled).toMatchObject({ mode: 'assembled', requestedMode: 'assembled', valid: true, diagnostics: [] }); expect(compiled.rows).toHaveLength(6);
    expect(compiled.rows.every((row) => row.bounds === null && row.offset.every((component) => component === 0))).toBe(true);
    expect(sourceWorldToDisplay([1, 16, -2], 'f5', compiled)).toEqual({ ok: true, point: [1, 16, -2], diagnostics: [] });
    expect(sourceWorldToDisplay([1, 2, 3], 'not-a-floor', compiled).ok).toBe(false);
  });
  it('does not require selected-floor references or a max-four list while assembled', () => {
    const selected = ['missing', 'b', 'c', 'd', 'e'];
    expect(readFloorPresentation({ mode: 'assembled', floors: selected }).valid).toBe(true);
    expect(compile({ mode: 'assembled', floors: selected }, { bounds: [] })).toMatchObject({ valid: true, mode: 'assembled' });
    expect(ids(compile({ mode: 'assembled', floors: selected }))).toEqual(['basement', 'ground', 'upper']);
  });
  it('provides identity only for unique finite current floors rather than guessing invalid IDs', () => {
    const compiled = compileFloorPresentation(undefined, { floors: [{ id: 'known', elevation: 0 }, { id: 'duplicate', elevation: 0 },
      { id: 'duplicate', elevation: 3 }, { id: 'stale', elevation: 3, stale: true }, { id: 'invalid', elevation: NaN }, { id: 'string', elevation: '3' }] });
    expect(ids(compiled)).toEqual(['known']); expect(compiled.valid).toBe(true);
    expect(displayWorldToSource([1, 2, 3], 'duplicate', compiled)).toMatchObject({ ok: false, point: null });
  });
  it('returns a safe empty default with no context and never requests geometry', () => {
    expect(compileFloorPresentation()).toEqual({ mode: 'assembled', requestedMode: 'assembled', valid: true, diagnostics: [], rows: [] });
  });
});

describe('measured floor layout math', () => {
  it('defaults to stable elevation/ID order without changing source footprints', () => {
    const equal = [{ id: 'z', elevation: 0 }, { id: 'A', elevation: 0 }, { id: 'a', elevation: 0 }];
    const footprints = equal.map((floor) => ({ floor_id: floor.id, min: [0, 0, 0], max: [2, 2, 3] }));
    expect(ids(compile({ mode: 'horizontal' }))).toEqual(['basement', 'ground', 'upper']);
    expect(ids(compile({ mode: 'vertical' }, { floors: equal, bounds: footprints }))).toEqual(['A', 'a', 'z']);
    expect(ids(compile({ mode: 'vertical' }, { floors: equal.slice().reverse(), bounds: footprints }))).toEqual(['A', 'a', 'z']);
  });
  it('packs east using actual unequal width and negative origins, keeping first X/Z footprint unchanged', () => {
    const compiled = compile({ mode: 'horizontal', gap_m: 2, base_elevation_m: 1 });
    expect(compiled).toMatchObject({ mode: 'horizontal', valid: true, diagnostics: [] });
    expect(compiled.rows.map((row) => row.offset)).toEqual([[0, 3, 0], [-5, .75, 0], [21, -3.5, 0]]);
    const intervals = compiled.rows.map((row) => [row.bounds.min[0] + row.offset[0], row.bounds.max[0] + row.offset[0]]);
    expect(intervals).toEqual([[-12, -4], [-2, 11], [13, 18]]);
    for (const row of compiled.rows) expect(row.elevation + row.offset[1]).toBe(1);
    expect(compiled.rows[0].bounds).toEqual({ min: bounds[0].min, max: bounds[0].max });
  });
  it('packs north along negative world Z using actual unequal depths with an explicit order', () => {
    const compiled = compile({ mode: 'horizontal', floors: ['upper', 'ground', 'basement'], axis: 'north', gap_m: 3, base_elevation_m: -1 });
    expect(compiled.rows.map((row) => row.offset)).toEqual([[0, -5.5, 0], [0, -1.25, 2], [0, 1, -4]]);
    expect(compiled.rows.map((row) => [row.bounds.min[2] + row.offset[2], row.bounds.max[2] + row.offset[2]])).toEqual([[9, 13], [0, 6], [-11, -3]]);
    for (const row of compiled.rows) expect(row.elevation + row.offset[1]).toBe(-1);
  });
  it('keeps real floor elevations while adding vertical rank gaps in the exact saved order', () => {
    const compiled = compile({ mode: 'vertical', floors: ['upper', 'basement', 'ground'], gap_m: 2.25, base_elevation_m: 100 });
    expect(compiled.rows.map((row) => row.offset)).toEqual([[0, 0, 0], [0, 2.25, 0], [0, 4.5, 0]]);
    expect(compiled.rows.map((row) => row.elevation + row.offset[1])).toEqual([4.5, .25, 4.75]);
    expect(ids(compiled)).toEqual(['upper', 'basement', 'ground']);
  });
  it('allows touching horizontal footprints at zero gap without changing their shape', () => {
    const compiled = compile({ mode: 'horizontal', gap_m: 0 });
    const extent = compiled.rows.map((row) => [row.bounds.min[0] + row.offset[0], row.bounds.max[0] + row.offset[0]]);
    expect(extent).toEqual([[-12, -4], [-4, 9], [9, 14]]);
  });
  it('accepts a thin authored floor plane but rejects an empty horizontal footprint', () => {
    expect(compile({ mode: 'vertical', floors: ['ground'] }, { bounds: [{ floor_id: 'ground', min: [0, .25, 0], max: [4, .25, 5] }] }).valid).toBe(true);
    failClosed(compile({ mode: 'vertical', floors: ['ground'] }, { bounds: [{ floor_id: 'ground', min: [0, .25, 0], max: [0, .25, 5] }] }), 'invalid_bounds');
  });
  it.each(['horizontal', 'vertical'])('round-trips noninteger source points exactly within floating tolerance in %s', (mode) => {
    const compiled = compile({ mode, axis: 'north', gap_m: 3.125, base_elevation_m: -1.75 });
    for (const row of compiled.rows) for (const source of [row.bounds.min, row.bounds.max, [1.123456789, row.elevation + .987654321, -.23456789]]) {
      const displayed = sourceWorldToDisplay(source, row.floor_id, compiled), restored = displayWorldToSource(displayed.point, row.floor_id, compiled);
      expect(displayed.ok).toBe(true); expect(restored.ok).toBe(true); expect(displayed.point).not.toBe(source);
      restored.point.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(source[index], 12));
    }
  });
});

describe('atomic current-floor and model evidence', () => {
  it('requires deliberate selection when more than four resolved floors exist', () => {
    const many = Array.from({ length: 5 }, (_, rank) => ({ id: `f${rank}`, elevation: rank * 3 }));
    const footprints = many.map((floor) => ({ floor_id: floor.id, min: [0, floor.elevation, 0], max: [5, floor.elevation + 2, 6] }));
    failClosed(compile({ mode: 'horizontal' }, { floors: many, bounds: footprints }), 'floor_limit');
    failClosed(compile({ mode: 'vertical', floors: many.map((floor) => floor.id) }, { floors: many, bounds: footprints }), 'floor_limit');
    expect(compile({ mode: 'horizontal', floors: ['f4', 'f0', 'f2', 'f1'] }, { floors: many, bounds: footprints })).toMatchObject({ valid: true, mode: 'horizontal' });
  });
  it('does not substitute a similar name or case for a missing saved ID, and restores only that exact ID', () => {
    const raw = { mode: 'horizontal', floors: ['Ground'] };
    failClosed(compile(raw), 'missing_floor');
    const fixed = compile(raw, { floors: [...floors, { id: 'Ground', elevation: 5 }], bounds: [...bounds, { floor_id: 'Ground', min: [0, 5, 0], max: [4, 7, 6] }] });
    expect(ids(fixed)).toEqual(['Ground']); expect(fixed.mode).toBe('horizontal'); expect(raw.floors).toEqual(['Ground']);
  });
  it.each([true, undefined, 'false'])('rejects a selected floor with present invalid/stale flag %j', (stale) => {
    failClosed(compile({ mode: 'vertical' }, { floors: floors.map((floor) => floor.id === 'ground' ? { ...floor, stale } : floor) }), 'invalid_resolved_floor');
  });
  it.each([NaN, Infinity, '3', null, 1000001])('rejects a selected invalid source elevation %j without partial offsets', (elevation) => {
    failClosed(compile({ mode: 'horizontal', floors: ['basement', 'ground'] }, { floors: floors.map((floor) => floor.id === 'ground' ? { ...floor, elevation } : floor) }), 'invalid_resolved_floor');
  });
  it('rejects duplicate current floor IDs even when both resolutions have identical elevations', () => {
    failClosed(compile({ mode: 'vertical' }, { floors: [...floors, { ...floors[1] }] }), 'ambiguous_floor');
  });
  it('rejects no selected floors, malformed registry shape and missing/duplicate source bounds', () => {
    failClosed(compile({ mode: 'horizontal', floors: [] }), 'no_floors');
    failClosed(compile({ mode: 'vertical' }, { floors: null }), 'invalid_resolved_floors');
    failClosed(compile({ mode: 'vertical' }, { bounds: bounds.filter((row) => row.floor_id !== 'ground') }), 'missing_bounds');
    failClosed(compile({ mode: 'horizontal' }, { bounds: [...bounds, { ...bounds[1] }] }), 'ambiguous_bounds');
    failClosed(compile({ mode: 'horizontal' }, { bounds: null }), 'invalid_bounds');
  });
  it.each([[NaN, 0, 0], [Infinity, 0, 0], [1000001, 0, 0], ['1', 0, 0], [false, 0, 0], [0, 0], Array(3)])('rejects nonfinite, out-of-limit or malformed source-bound vector %j', (min) => {
    failClosed(compile({ mode: 'vertical' }, { bounds: bounds.map((row) => row.floor_id === 'ground' ? { ...row, min } : row) }), 'invalid_bounds');
  });
  it('rejects reversed source bounds and an unsupported whole-model proof before returning any offsets', () => {
    failClosed(compile({ mode: 'horizontal' }, { bounds: bounds.map((row) => row.floor_id === 'ground' ? { ...row, max: [2, 3, 4] } : row) }), 'invalid_bounds');
    const unsupported = { present: true, supported: false, diagnostics: [{ code: 'shared_floor_geometry', message: 'One mesh spans two floors.', floor_id: 'ground' }] };
    const result = compile({ mode: 'horizontal' }, { model: unsupported }); failClosed(result, 'unsupported_model');
    expect(codes(result)).toContain('shared_floor_geometry'); expect(result.diagnostics.at(-1)).not.toBe(unsupported.diagnostics[0]);
  });
  it.each([null, false, {}, { present: 'true', supported: true }, { present: true }, { present: true, supported: 'true' }])('rejects malformed/missing model ownership proof %j', (proof) => {
    const compiled = compile({ mode: 'horizontal' }, { model: proof }); expect(compiled).toMatchObject({ valid: false, mode: 'assembled', rows: [] });
  });
  it('allows drawn-plan evidence without GLB support and ignores unrelated unselected footprint errors', () => {
    const result = compile({ mode: 'horizontal', floors: ['ground'] }, { model: { present: false, supported: false },
      bounds: [bounds[1], { floor_id: 'not-selected', min: [NaN, 0, 0], max: [Infinity, 1, 1] }],
      floors: [...floors, { id: 'not-selected', elevation: NaN }] });
    expect(result).toMatchObject({ valid: true, mode: 'horizontal', diagnostics: [] }); expect(ids(result)).toEqual(['ground']);
    expect(compile({ mode: 'vertical' }, { model: undefined }).valid).toBe(true);
  });
  it('fails all split output if packing would leave the safe world range', () => {
    const near = [{ id: 'a', elevation: 0 }, { id: 'b', elevation: 2 }];
    const footprints = [{ floor_id: 'a', min: [999990, 0, 0], max: [1000000, 2, 5] }, { floor_id: 'b', min: [0, 2, 0], max: [2, 4, 5] }];
    failClosed(compile({ mode: 'horizontal' }, { floors: near, bounds: footprints }), 'display_bounds_limit');
    const high = [{ id: 'a', elevation: 999999 }, { id: 'b', elevation: 1000000 }];
    failClosed(compile({ mode: 'vertical' }, { floors: high, bounds: high.map((floor) => ({ floor_id: floor.id, min: [0, floor.elevation, 0], max: [2, floor.elevation, 2] })) }), 'display_bounds_limit');
  });
});

describe('coordinate conversion and source ownership', () => {
  it.each([[NaN, 0, 0], [Infinity, 0, 0], ['0', 0, 0], [0, null, 0], [0, 0], Array(3), { x: 0, y: 0, z: 0 }, [1000001, 0, 0]])('rejects invalid point %j without producing a guessed position', (point) => {
    const compiled = compile({ mode: 'vertical' });
    for (const convert of [sourceWorldToDisplay, displayWorldToSource]) expect(convert(point, 'ground', compiled)).toMatchObject({ ok: false, point: null });
  });
  it('requires an exact unique compiled floor and refuses failed split mappings', () => {
    const compiled = compile({ mode: 'horizontal' });
    expect(codes(sourceWorldToDisplay([0, 0, 0], 'Ground', compiled))).toEqual(['unknown_floor']);
    expect(codes(displayWorldToSource([0, 0, 0], '', compiled))).toEqual(['invalid_floor_id']);
    expect(sourceWorldToDisplay([0, 0, 0], 'ground', compile({ mode: 'horizontal', floors: ['deleted'] })).ok).toBe(false);
    expect(codes(sourceWorldToDisplay([0, 0, 0], 'ground', { ...compiled, rows: [...compiled.rows, compiled.rows[1]] }))).toEqual(['ambiguous_floor']);
    expect(sourceWorldToDisplay([0, 0, 0], 'ground', { ...compiled, valid: false }).ok).toBe(false);
  });
  it('rejects malformed/unsafe converter mappings and points shifted outside the safe range', () => {
    const compiled = compile({ mode: 'vertical' });
    expect(codes(sourceWorldToDisplay([0, 0, 0], 'ground', {}))).toEqual(['invalid_presentation']);
    expect(codes(sourceWorldToDisplay([0, 0, 0], 'ground', { ...compiled, rows: [{ floor_id: 'ground', offset: [0, Infinity, 0] }] }))).toEqual(['invalid_offset']);
    expect(codes(sourceWorldToDisplay([0, 1000000, 0], 'ground', compiled))).toEqual(['point_limit']);
    expect(codes(displayWorldToSource([0, -1000000, 0], 'ground', compiled))).toEqual(['point_limit']);
    const assembled = compile(undefined);
    expect(codes(sourceWorldToDisplay([0, 0, 0], 'ground', { ...assembled, rows: [{ floor_id: 'ground', offset: [1, 0, 0] }] }))).toEqual(['invalid_offset']);
  });
  it('never mutates saved settings, source context, points or unknown imported data', () => {
    const raw = freezeDeep({ mode: 'horizontal', floors: ['upper', 'ground'], gap_m: 4, axis: 'north', base_elevation_m: 2, extension: { version: 9 } });
    const ctx = freezeDeep(context()), before = JSON.stringify({ raw, ctx });
    const compiled = compileFloorPresentation(raw, ctx), point = freezeDeep([1.25, 5.5, -2.25]);
    const displayed = sourceWorldToDisplay(point, 'upper', compiled); displayWorldToSource(displayed.point, 'upper', compiled);
    expect(JSON.stringify({ raw, ctx })).toBe(before); expect(point).toEqual([1.25, 5.5, -2.25]);
    expect(compiled.rows[0].bounds.min).not.toBe(bounds[2].min); expect(compiled.rows[0].bounds.max).not.toBe(bounds[2].max);
    compiled.rows[0].bounds.min[0] = 42; expect(bounds[2].min[0]).toBe(-8); expect(raw.extension).toEqual({ version: 9 });
  });
});
