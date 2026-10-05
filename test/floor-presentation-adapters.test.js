import { describe, expect, it } from 'vitest';
import { floorDisplayOffset, displayPlanPosition, displayFloorFootprint, displayLocatedRecords,
  displayCameraAnchors, translateFloorCamera } from '../src/floor-presentation-adapters.js';

const floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 3 }, { id: 'basement', elevation: -3 }];
const report = { valid: true, mode: 'horizontal', rows: [{ floor_id: 'ground', offset: [0, 0, 0] }, { floor_id: 'upper', offset: [10, -3, -5] }] };
const position = { x: 2, y: 4, z: .7, elevation: 3, floorId: 'upper', extension: { keep: true } };
describe('source/display feature adapters', () => {
  it.each([undefined, { mode: 'assembled', valid: true }, { mode: 'horizontal', valid: false }])('keeps disabled/invalid baseline references for %j', (state) => {
    const records = [{ location: position }], anchors = [{ position }], footprint = { floorId: 'upper', elevation: 3, polygon: [[0, 0], [2, 0], [0, 2]] };
    expect(displayPlanPosition(position, state, floors)).toBe(position);
    expect(displayLocatedRecords(records, state, floors)).toBe(records);
    expect(displayCameraAnchors(anchors, state, floors)).toBe(anchors);
    expect(displayFloorFootprint(footprint, state, floors)).toBe(footprint);
  });
  it('moves display east/north/elevation but leaves height above the floor unchanged', () => {
    expect(displayPlanPosition(position, report, floors)).toEqual({ ...position, x: 12, y: 9, elevation: 0 });
    expect(position).toEqual({ x: 2, y: 4, z: .7, elevation: 3, floorId: 'upper', extension: { keep: true } });
  });
  it('preserves the exact source position for a zero-offset selected floor', () => {
    const ground = { ...position, floorId: 'ground', elevation: 0 };
    expect(displayPlanPosition(ground, report, floors)).toBe(ground);
  });
  it('preserves a unique known unselected floor in its assembled position', () => {
    expect(floorDisplayOffset(report, 'basement', floors)).toEqual([0, 0, 0]);
  });
  it('refuses an unknown floor during active separation', () => {
    expect(displayPlanPosition({ ...position, floorId: 'old' }, report, floors)).toBeNull();
  });
  it('refuses a duplicate current floor even when both elevations are finite', () => {
    expect(floorDisplayOffset(report, 'upper', [...floors, floors[1]])).toBeNull();
  });
  it.each([[10, NaN, 0], [10, 0], ['10', 0, 0]])('refuses a malformed display offset %j', (offset) => {
    expect(floorDisplayOffset({ ...report, rows: [{ floor_id: 'upper', offset }] }, 'upper', floors)).toBeNull();
  });
  it('refuses duplicate compiled rows rather than adding both offsets', () => {
    expect(floorDisplayOffset({ ...report, rows: [report.rows[1], report.rows[1]] }, 'upper', floors)).toBeNull();
  });
  it('moves copied polygon and center without changing source points or extra fields', () => {
    const footprint = { floorId: 'upper', elevation: 3, polygon: [[0, 0, 'extra'], [2, 0], [0, 2]], center: [1, 1], color: '#123' };
    const displayed = displayFloorFootprint(footprint, report, floors);
    expect(displayed).toEqual({ ...footprint, elevation: 0, polygon: [[10, 5, 'extra'], [12, 5], [10, 7]], center: [11, 6] });
    expect(footprint.polygon[0]).toEqual([0, 0, 'extra']); expect(footprint.center).toEqual([1, 1]);
  });
  it('copies located alerts/tracking and preserves their real readings', () => {
    const reading = { active: true }, source = [{ id: 'vacuum', location: position, reading, transitionMs: 600 }];
    const displayed = displayLocatedRecords(source, report, floors);
    expect(displayed[0].reading).toBe(reading); expect(displayed[0].location.x).toBe(12);
    expect(source[0].location).toBe(position); expect(displayed[0].transitionMs).toBe(600);
  });
  it('snaps a presentation change rather than inventing a vacuum journey between floors', () => {
    const source = [{ location: position, transitionMs: 600 }];
    expect(displayLocatedRecords(source, report, floors, { snap: true })[0].transitionMs).toBe(0);
    expect(source[0].transitionMs).toBe(600);
  });
  it('hides unresolved displayed records without deleting the saved source', () => {
    const source = [{ shown: true, location: { ...position, floorId: 'old' } }];
    expect(displayLocatedRecords(source, report, floors)[0]).toMatchObject({ shown: false, location: null });
    expect(source[0].shown).toBe(true); expect(source[0].location.floorId).toBe('old');
  });
  it('maps physical camera cone positions without altering source anchor placement', () => {
    const source = [{ entity: 'camera.ring', shown: true, position }];
    expect(displayCameraAnchors(source, report, floors)[0].position.x).toBe(12);
    expect(source[0].position).toBe(position);
  });
  it('hides camera anchors on missing floors', () => {
    expect(displayCameraAnchors([{ shown: true, position: { ...position, floorId: 'old' } }], report, floors)[0]).toMatchObject({ shown: false, position: null });
  });
  it('translates saved source camera position and target together and round trips exactly', () => {
    const camera = { position: [2.123456789, 6, -4], target: [2, 3, -4], zoom: 1.2, extension: true };
    const displayed = translateFloorCamera(camera, report, 'upper', floors);
    expect(displayed.position).toEqual([12.123456789, 3, -9]); expect(displayed.target).toEqual([12, 0, -9]);
    const source = translateFloorCamera(displayed, report, 'upper', floors, { toSource: true });
    expect(source.position[0]).toBeCloseTo(camera.position[0], 12); expect(source.target).toEqual(camera.target);
    expect(camera.target).toEqual([2, 3, -4]);
  });
  it('translates top camera plan center with the north sign while retaining zoom', () => {
    const top = { center: [2, 4], zoom: 2.5 };
    expect(translateFloorCamera(top, report, 'upper', floors, { top: true })).toEqual({ center: [12, 9], zoom: 2.5 });
    expect(translateFloorCamera({ center: [12, 9], zoom: 2.5 }, report, 'upper', floors, { top: true, toSource: true })).toEqual(top);
  });
  it('refuses malformed active camera tuples', () => {
    expect(translateFloorCamera({ position: [1, 2, NaN], target: [0, 0, 0] }, report, 'upper', floors)).toBeNull();
  });
});
