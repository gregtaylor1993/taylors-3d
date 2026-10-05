import { describe, expect, it } from 'vitest';
import { floorPresentationContext } from '../src/floor-presentation-context.js';

const floors = [{ id: 'ground', elevation: 0 }, { id: 'upper', elevation: 3 }];
function model() {
  const root = { parent: null }, ground = { parent: root }, upper = { parent: root }, site = { parent: root };
  return { root, ground, upper, site, manifest: { levels: [
    { id: 'g', label: 'Ground model', node: ground }, { id: 'u', node: upper }, { id: 's', node: site },
  ] }, bindings: { g: { auto: false, floor: 'ground' }, u: { auto: false, floor: 'upper' }, s: { auto: false, floor: null } } };
}
const context = (m, extra = {}) => floorPresentationContext({ modelRoot: m.root, manifest: m.manifest, bindings: m.bindings, floors, ...extra });
describe('explicit separated floor context', () => {
  it('returns exact saved level nodes and an explicitly unassigned background', () => {
    const m = model(), result = context(m);
    expect(result.valid).toBe(true);
    expect(result.targets).toEqual([{ floor_id: 'ground', node: m.ground }, { floor_id: 'upper', node: m.upper }]);
    expect(result.backgroundNodes).toEqual([m.site]);
  });
  it.each([true, undefined, null])('does not treat auto=%s as an explicit saved choice', (auto) => {
    const m = model(); m.bindings.g.auto = auto;
    const result = context(m); expect(result.valid).toBe(false);
    expect(result.targets.some((target) => target.node === m.ground)).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === 'confirm_floor_link')).toBe(true);
  });
  it('does not infer a missing binding from a matching floor ID or elevation', () => {
    const m = model(); m.manifest.levels[0].id = 'ground'; delete m.bindings.g;
    expect(context(m).targets).toEqual([{ floor_id: 'upper', node: m.upper }]);
  });
  it('does not automatically classify a site/roof as background', () => {
    const m = model(); m.bindings.s.auto = true;
    expect(context(m).backgroundNodes).toEqual([]);
  });
  it('does not accept an inherited level binding', () => {
    const m = model(); m.manifest.levels[0].id = '__proto__';
    expect(context(m).targets.some((entry) => entry.node === m.ground)).toBe(false);
  });
  it('rejects stale saved links even when their ID has returned', () => {
    const m = model(); m.bindings.g.stale = true;
    expect(context(m).targets.some((target) => target.node === m.ground)).toBe(false);
  });
  it('rejects an unknown saved floor without selecting a nearby known floor', () => {
    const m = model(); m.bindings.g.floor = 'old-ground';
    expect(context(m).diagnostics.some((entry) => entry.code === 'missing_floor_link' && entry.floor_id === 'old-ground')).toBe(true);
  });
  it.each([undefined, '', 0, false])('requires deliberate null for background, not %s', (floor) => {
    const m = model(); m.bindings.s.floor = floor;
    expect(context(m).backgroundNodes).toEqual([]);
  });
  it('rejects a duplicate current floor rather than choosing the first match', () => {
    const m = model(); const result = context(m, { floors: [...floors, { id: 'ground', elevation: 2 }] });
    expect(result.valid).toBe(false); expect(result.targets.some((entry) => entry.floor_id === 'ground')).toBe(false);
  });
  it.each([NaN, Infinity, '0', null, 1e7])('rejects elevation %s', (elevation) => {
    const m = model(); expect(context(m, { floors: [{ id: 'ground', elevation }, floors[1]] }).valid).toBe(false);
  });
  it('rejects a target from a previous model', () => {
    const m = model(); m.manifest.levels[0].node = { parent: null };
    expect(context(m).diagnostics.some((entry) => entry.code === 'invalid_level_group')).toBe(true);
  });
  it('rejects duplicate model level IDs', () => {
    const m = model(); m.manifest.levels[1].id = 'g';
    expect(context(m).valid).toBe(false);
  });
  it('rejects two level records claiming the same node', () => {
    const m = model(); m.manifest.levels[1].node = m.ground;
    expect(context(m).valid).toBe(false);
  });
  it('diagnoses an untagged model', () => {
    expect(floorPresentationContext({ modelRoot: {}, floors }).diagnostics[0].code).toBe('missing_level_groups');
  });
  it('measures drawn outlines in SOURCE world coordinates, including north sign', () => {
    const rooms = [{ floorId: 'upper', room: { polygon: [[2, 5], [6, 5], [6, 9], [2, 9]] } }];
    expect(floorPresentationContext({ floors, rooms }).bounds).toEqual([{ floor_id: 'upper', min: [2, 3, -9], max: [6, 3, -5] }]);
  });
  it('combines rooms on the same floor without adding a guessed margin', () => {
    const rooms = [{ floorId: 'ground', room: { polygon: [[0, 0], [2, 0], [0, 2]] } },
      { floorId: 'ground', room: { polygon: [[8, 1], [9, 1], [8, 3]] } }];
    expect(floorPresentationContext({ floors, rooms }).bounds[0]).toEqual({ floor_id: 'ground', min: [0, 0, -3], max: [9, 0, -0] });
  });
  it('preserves a broken explicit room floor instead of borrowing its resolved fallback', () => {
    const result = floorPresentationContext({ floors, rooms: [{ floorId: 'ground', room: { floor_id: 'old', polygon: [[0, 0], [2, 0], [0, 2]] } }] });
    expect(result.valid).toBe(false); expect(result.bounds).toEqual([]);
  });
  it.each([null, [], [[0, 0], [1, 1]], [[0, 0], [NaN, 1], [2, 2]], [[0, 0], ['1', 1], [2, 2]]])('refuses malformed drawn outline %j', (polygon) => {
    expect(floorPresentationContext({ floors, rooms: [{ floorId: 'ground', room: { polygon } }] }).valid).toBe(false);
  });
  it('does not invent a footprint for a floor with no room', () => {
    expect(floorPresentationContext({ floors }).bounds).toEqual([]);
  });
  it('does not change the original model, bindings, floors or room data', () => {
    const m = model(), beforeBindings = JSON.stringify(m.bindings), beforeFloors = JSON.stringify(floors);
    context(m); expect(JSON.stringify(m.bindings)).toBe(beforeBindings); expect(JSON.stringify(floors)).toBe(beforeFloors);
    expect(m.upper.parent).toBe(m.root);
    const rooms = [{ floorId: 'ground', room: { polygon: [[0, 0], [2, 0], [0, 2]] } }], beforeRooms = JSON.stringify(rooms);
    floorPresentationContext({ floors, rooms }); expect(JSON.stringify(rooms)).toBe(beforeRooms);
  });
});
