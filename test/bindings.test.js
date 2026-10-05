// test/bindings.test.js
import { describe, it, expect } from 'vitest';
import {
  levelsFromFloorMap, migrateModel, resolveLevels, resolveRoomAreas, transformPoint, modelRooms,
  combineRooms, levelFloorOverrides, bindingDiff, snapshotDiff, levelVisible, measuredElevations,
} from '../src/bindings.js';

const L = (id, role = 'storey', order = null, extra = {}) => ({ kind: 'level', id, role, order, elevation: null, height: null, ...extra });
const floors = [{ id: 'floor1', elevation: 0 }, { id: 'floor2', elevation: 3 }];

describe('legacy bindings', () => {
  it('reads floor_map / model_floors', () => {
    expect(levelsFromFloorMap({ ground: 'floor1', attic: 'always', x: 'hidden' }))
      .toEqual({ ground: { floor: 'floor1' }, attic: { show: 'always' }, x: { show: 'hidden' } });
  });
  it('migrates layout.model.floor_map into levels', () => {
    expect(migrateModel({ version: 'v', floor_map: { ground: 'floor1' } })).toEqual({ version: 'v', levels: { ground: { floor: 'floor1' } } });
    const m = { version: 'v', levels: { a: { floor: 'floor1' } } };
    expect(migrateModel(m)).toBe(m);
    expect(migrateModel(null)).toBeNull();
  });
  it('levelsFromFloorMap ignores non-string values and non-object input', () => {
    expect(levelsFromFloorMap('abc')).toEqual({});
    expect(levelsFromFloorMap({ good: 'floor1', bad: 123, ugly: ['array'] })).toEqual({ good: { floor: 'floor1' } });
    expect(levelsFromFloorMap(null)).toEqual({});
  });
  it('migrateModel ignores non-plain-object floor_map', () => {
    expect(migrateModel({ version: 'v', floor_map: 'x' }).levels).toEqual({});
    expect(migrateModel({ version: 'v', floor_map: { x: 123 } }).levels).toEqual({});
  });
});

describe('resolveLevels', () => {
  it('matches exact ids, then storeys bottom-up, exterior with the lowest, roof all-only', () => {
    const r = resolveLevels([L('floor2'), L('ground', 'storey', 0), L('exterior', 'exterior'), L('roof', 'roof')], floors, {});
    expect(r.floor2).toMatchObject({ show: 'with', floor: 'floor2', auto: true });
    expect(r.ground).toMatchObject({ show: 'with', floor: 'floor1' });
    expect(r.exterior).toMatchObject({ show: 'always', floor: 'floor1' });
    expect(r.roof).toMatchObject({ show: 'all-only', floor: null });
  });

  it('order 0 aligns with the floor at elevation 0 (basement on a one-floor HA)', () => {
    const r = resolveLevels([L('basement', 'basement', -1), L('ground', 'storey', 0)], [{ id: 'floor1', elevation: 0 }], {});
    expect(r.ground.floor).toBe('floor1');
    expect(r.basement).toMatchObject({ show: 'always', floor: null });
  });

  it('a pinned exterior (always/hidden/all-only) does not reserve its floor for storey mapping', () => {
    for (const show of ['always', 'hidden', 'all-only']) {
      const r = resolveLevels([L('ground', 'storey', 0), L('first', 'storey', 1), L('exterior', 'exterior')], floors,
        { exterior: { show, floor: 'floor1' } });
      expect(r.ground).toMatchObject({ show: 'with', floor: 'floor1' });
      expect(r.first).toMatchObject({ show: 'with', floor: 'floor2' });
      expect(r.exterior).toMatchObject({ show, floor: 'floor1' });
    }
  });

  it('honours saved bindings and show modes', () => {
    const r = resolveLevels([L('ground', 'storey', 0), L('exterior', 'exterior')], floors,
      { ground: { floor: 'floor2' }, exterior: { show: 'hidden' } });
    expect(r.ground).toMatchObject({ show: 'with', floor: 'floor2', auto: false });
    expect(r.exterior).toMatchObject({ show: 'hidden', auto: false });
  });

  it('accepts a saved only binding and treats a deleted floor as stale', () => {
    const r = resolveLevels([L('ground', 'storey', 0)], floors, { ground: { show: 'only', floor: 'floor2' } });
    expect(r.ground).toMatchObject({ show: 'only', floor: 'floor2', auto: false });
    const g = resolveLevels([L('ground', 'storey', 0)], floors, { ground: { show: 'only', floor: 'gone' } });
    expect(g.ground).toMatchObject({ show: 'only', floor: 'gone', auto: false, stale: true });
  });

  it('a saved { floor: null } puts the level on no floor (not stale)', () => {
    const r = resolveLevels([L('ground', 'storey', 0), L('exterior', 'exterior')], floors, { exterior: { floor: null } });
    expect(r.exterior).toEqual({ show: 'always', floor: null, auto: false });
    expect(r.ground).toMatchObject({ show: 'with', floor: 'floor1', auto: true });
  });

  it('preserves a saved missing floor instead of falling back to another floor', () => {
    const r = resolveLevels([L('ground', 'storey', 0)], floors, { ground: { floor: 'deleted' } });
    expect(r.ground).toMatchObject({ show: 'with', floor: 'deleted', auto: false, stale: true });
  });

  it.each(['with', 'only', 'always', 'hidden', 'all-only'])('preserves the missing floor and %s mode until that exact ID returns', (show) => {
    const levels = [L('floor1', 'storey', 0), L('exterior', 'exterior')];
    const saved = { floor1: { floor: 'deleted', show } };
    const available = [...floors, { id: 'deleted_2', name: 'Deleted', elevation: 6 }];
    expect(resolveLevels(levels, available, saved).floor1)
      .toEqual({ floor: 'deleted', show, auto: false, stale: true });
    const restored = resolveLevels(levels, [...available, { id: 'deleted', name: 'Renamed floor', elevation: 9 }], saved);
    expect(restored.floor1).toEqual({ floor: 'deleted', show, auto: false });
    expect(saved).toEqual({ floor1: { floor: 'deleted', show } });
  });

  it('a stale storey cannot crash exterior mapping or reserve a different floor', () => {
    const r = resolveLevels([L('gone', 'storey', 0), L('upper', 'storey', 1), L('exterior', 'exterior')], floors,
      { gone: { floor: 'deleted' } });
    expect(r.gone).toEqual({ show: 'with', floor: 'deleted', auto: false, stale: true });
    expect(r.upper).toEqual({ show: 'with', floor: 'floor1', auto: true });
    expect(r.exterior).toEqual({ show: 'always', floor: 'floor1', auto: true });
    expect(resolveLevels([L('gone'), L('exterior', 'exterior')], [], { gone: { floor: 'deleted' } }).exterior)
      .toEqual({ show: 'always', floor: null, auto: true });
  });

  it('an empty saved entry still permits automatic mapping rather than creating a missing link', () => {
    expect(resolveLevels([L('ground', 'storey', 0)], floors, { ground: {} }).ground)
      .toEqual({ show: 'with', floor: 'floor1', auto: true });
  });

  it('leftover storeys are always shown', () => {
    const r = resolveLevels([L('a', 'storey', 0), L('b', 'storey', 1), L('c', 'storey', 2)], floors, {});
    expect([r.a.floor, r.b.floor, r.c.show]).toEqual(['floor1', 'floor2', 'always']);
  });
  it('treats null/non-object saved as {} and ignores non-object entries', () => {
    const r1 = resolveLevels([L('ground', 'storey', 0)], floors, null);
    expect(r1.ground.floor).toBe('floor1');
    const r2 = resolveLevels([L('ground', 'storey', 0)], floors, { ground: 'string-not-object' });
    expect(r2.ground.floor).toBe('floor1');
  });
  it('basement with null order gets order -1; storey null gets 0; aligns correctly on 2-floor HA', () => {
    const r = resolveLevels(
      [L('basement', 'basement', null), L('ground', 'storey', null)],
      [{ id: 'floor1', elevation: -3 }, { id: 'floor2', elevation: 0 }],
      {}
    );
    expect(r.basement.floor).toBe('floor1');
    expect(r.ground.floor).toBe('floor2');
  });
});

describe('resolveRoomAreas', () => {
  const rooms = [{ id: 'kitchen', suggest: {} }, { id: 'room_a', suggest: { area: 'guest_room' } }, { id: 'wc', suggest: {} }];
  it('saved, then suggest, then id, else unassigned', () => {
    const r = resolveRoomAreas(rooms, ['kitchen', 'guest_room', 'bathroom'], { wc: { area: 'bathroom' } });
    expect(r).toEqual({
      kitchen: { area: 'kitchen', auto: true },
      room_a: { area: 'guest_room', auto: true },
      wc: { area: 'bathroom', auto: false },
    });
    expect(resolveRoomAreas([{ id: 'x', suggest: {} }], [], {}).x).toEqual({ area: null, auto: true });
  });
  it('explicit "no area" sticks; a deleted area is stale', () => {
    expect(resolveRoomAreas(rooms.slice(0, 1), ['kitchen'], { kitchen: { area: null } }).kitchen).toEqual({ area: null, auto: false });
    expect(resolveRoomAreas(rooms.slice(0, 1), ['kitchen'], { kitchen: { area: 'gone' } }).kitchen).toEqual({ area: 'gone', auto: false, stale: true });
  });
  it('does not replace a deleted saved area with an exact room ID, suggestion, or similarly named ID', () => {
    const saved = { kitchen: { area: 'old_kitchen' } };
    const modelRooms = [{ id: 'kitchen', suggest: { area: 'suggested_kitchen' } }];
    const areaIds = ['kitchen', 'suggested_kitchen', 'old_kitchen_2'];
    expect(resolveRoomAreas(modelRooms, areaIds, saved).kitchen)
      .toEqual({ area: 'old_kitchen', auto: false, stale: true });
    expect(resolveRoomAreas(modelRooms, [...areaIds, 'old_kitchen'], saved).kitchen)
      .toEqual({ area: 'old_kitchen', auto: false });
    expect(saved).toEqual({ kitchen: { area: 'old_kitchen' } });
  });
  it('treats null/non-object saved as {} and ignores non-object entries', () => {
    const r1 = resolveRoomAreas([{ id: 'x', suggest: {} }], ['x'], null);
    expect(r1.x).toEqual({ area: 'x', auto: true });
    const r2 = resolveRoomAreas([{ id: 'x', suggest: {} }], ['x'], { x: 'string-not-object' });
    expect(r2.x).toEqual({ area: 'x', auto: true });
  });
});

describe('transformPoint', () => {
  it('scales, rotates counter-clockwise, then moves', () => {
    expect(transformPoint([1, 0], {})).toEqual([1, 0]);
    const [x, y] = transformPoint([1, 0], { rotation: 90, scale: 2, position: [10, 20, 0] });
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(22);
  });
});

describe('modelRooms / combineRooms', () => {
  const rooms = [
    { kind: 'room', id: 'kitchen', label: 'Kitchen', level: 'ground', outline: [[0, 0], [4, 0], [4, 3]], doors: [[2, 0]] },
    { kind: 'zone', id: 'garden', label: 'Garden', level: 'exterior', outline: [[0, 0], [9, 0], [9, 9]], doors: [] },
    { kind: 'room', id: 'loft', label: 'Loft', level: 'attic', outline: [[0, 0], [1, 0], [1, 1]], doors: [] },
    { kind: 'room', id: 'noline', label: 'X', level: 'ground', outline: null, doors: [] },
  ];
  const levelAssign = { ground: { show: 'with', floor: 'floor1' }, exterior: { show: 'with', floor: 'floor1' }, attic: { show: 'always', floor: null } };
  const areas = { kitchen: { area: 'kitchen' }, garden: { area: null }, loft: { area: 'loft' }, noline: { area: 'x' } };

  it('turns outlined rooms on a floor into layout rooms, transformed by the alignment', () => {
    const out = modelRooms(rooms, levelAssign, areas, { position: [1, 1, 0] });
    expect(out.map((r) => r.id)).toEqual(['m:kitchen', 'm:garden']);
    expect(out[0]).toMatchObject({ modelId: 'kitchen', area_id: 'kitchen', floor_id: 'floor1', outdoor: false, label: 'Kitchen', fromModel: true });
    expect(out[0].polygon[1]).toEqual([5, 1]);
    expect(out[0].doors).toEqual([[3, 1]]);
    expect(out[1]).toMatchObject({ outdoor: true, area_id: null });
  });

  it('model rooms win over drawn rooms for the same area', () => {
    const drawn = [{ id: 'r1', area_id: 'kitchen' }, { id: 'r2', area_id: 'hall' }];
    const fromModel = [{ id: 'm:kitchen', area_id: 'kitchen' }, { id: 'm:garden', area_id: null }];
    expect(combineRooms(drawn, fromModel).map((r) => r.id)).toEqual(['m:kitchen', 'm:garden', 'r2']);
  });

  it('retains transformed geometry on a valid floor without assigning a stale area', () => {
    const staleAreas = { ...areas, kitchen: { area: 'deleted', auto: false, stale: true } };
    const out = modelRooms(rooms, levelAssign, staleAreas, { position: [2, 3, 0], scale: 2 });
    expect(out[0]).toMatchObject({ modelId: 'kitchen', area_id: null, floor_id: 'floor1' });
    expect(out[0].polygon).toEqual([[2, 3], [10, 3], [10, 9]]);
    expect(out[0].doors).toEqual([[6, 3]]);
    const drawn = [{ id: 'drawn', area_id: 'deleted' }];
    expect(combineRooms(drawn, out).map((r) => r.id)).toContain('drawn');
    const restored = resolveRoomAreas(rooms, ['deleted'], { kitchen: { area: 'deleted' } });
    expect(modelRooms(rooms, levelAssign, restored, {})[0].area_id).toBe('deleted');
  });

  it.each(['with', 'only', 'always', 'hidden', 'all-only'])('a stale %s floor supplies no placement rooms', (show) => {
    const assign = { ...levelAssign, ground: { floor: 'deleted', show, auto: false, stale: true } };
    expect(modelRooms(rooms, assign, areas, {}).map((r) => r.id)).toEqual(['m:garden']);
  });

  it('treats null levelAssign/roomAreas as {} and returns empty', () => {
    const testRooms = [{ kind: 'room', id: 'kitchen', label: 'Kitchen', level: 'ground', outline: [[0, 0], [4, 0], [4, 3]], doors: [] }];
    expect(modelRooms(testRooms, null, {}, {})).toEqual([]);
    expect(modelRooms(testRooms, {}, null, {})).toEqual([]);
  });

  it('skips rooms on levels with show=hidden even if they have a floor', () => {
    const testRooms = [
      { kind: 'room', id: 'visible', label: 'V', level: 'ground', outline: [[0, 0], [1, 0], [1, 1]], doors: [] },
      { kind: 'room', id: 'hidden', label: 'H', level: 'attic', outline: [[0, 0], [1, 0], [1, 1]], doors: [] },
    ];
    const assign = { ground: { show: 'with', floor: 'floor1' }, attic: { show: 'hidden', floor: 'floor1' } };
    const areas = { visible: { area: 'living' }, hidden: { area: 'storage' } };
    const out = modelRooms(testRooms, assign, areas, {});
    expect(out.map((r) => r.id)).toEqual(['m:visible']);
  });
});

describe('levelFloorOverrides', () => {
  it('takes elevation and height of the level bound to a floor', () => {
    const lv = [L('ground', 'storey', 0, { elevation: 0, height: 2.89 }), L('first', 'storey', 1, { elevation: 3.25, height: 2.5 }), L('ext', 'exterior', null, { elevation: 0 })];
    const as = { ground: { show: 'with', floor: 'floor1' }, first: { show: 'with', floor: 'floor2' }, ext: { show: 'with', floor: 'floor1' } };
    expect(levelFloorOverrides(lv, as, { position: [0, 0, 0.1], scale: 1 })).toEqual([
      { id: 'floor1', elevation: 0.1, height: 2.89 }, { id: 'floor2', elevation: 3.35, height: 2.5 },
    ]);
  });
  it('treats only like with', () => {
    const lv = [L('ground', 'storey', 0, { elevation: 0, height: 2.89 })];
    expect(levelFloorOverrides(lv, { ground: { show: 'only', floor: 'floor1' } }, {})).toEqual([{ id: 'floor1', elevation: 0, height: 2.89 }]);
  });
  it('does not fabricate elevation overrides for stale floors, and resumes when the exact ID returns', () => {
    const lv = [L('ground', 'storey', 0, { elevation: 1, height: 2.89 })];
    const saved = { ground: { show: 'only', floor: 'deleted' } };
    expect(levelFloorOverrides(lv, resolveLevels(lv, floors, saved), { position: [0, 0, 2], scale: 2 })).toEqual([]);
    const restored = resolveLevels(lv, [...floors, { id: 'deleted', elevation: 1 }], saved);
    expect(levelFloorOverrides(lv, restored, { position: [0, 0, 2], scale: 2 }))
      .toEqual([{ id: 'deleted', elevation: 4, height: 5.78 }]);
  });
  it('treats null levelAssign as {} and returns empty', () => {
    const lv = [L('ground', 'storey', 0, { elevation: 0, height: 2.89 })];
    expect(levelFloorOverrides(lv, null, {})).toEqual([]);
  });
});

describe('bindingDiff', () => {
  it('reports kept, added and missing ids', () => {
    const manifest = { levels: [{ id: 'ground' }, { id: 'attic' }], rooms: [{ id: 'kitchen' }] };
    const model = { levels: { ground: { floor: 'f' }, old: { floor: 'f' } }, rooms: { kitchen: { area: 'k' }, gone: { area: 'g' } } };
    expect(bindingDiff(manifest, model)).toEqual({
      levels: { kept: ['ground'], added: ['attic'], missing: ['old'] },
      rooms: { kept: ['kitchen'], added: [], missing: ['gone'] },
    });
  });
  it('treats null manifest and missing arrays as empty', () => {
    expect(bindingDiff(null, null)).toEqual({ levels: { kept: [], added: [], missing: [] }, rooms: { kept: [], added: [], missing: [] } });
    expect(bindingDiff({ levels: [], rooms: [] }, { levels: {}, rooms: {} })).toEqual({ levels: { kept: [], added: [], missing: [] }, rooms: { kept: [], added: [], missing: [] } });
    expect(bindingDiff({ levels: [{ id: 'x' }], rooms: [] }, null)).toEqual({ levels: { kept: [], added: ['x'], missing: [] }, rooms: { kept: [], added: [], missing: [] } });
  });
});

describe('legacy storeys without order/elevation', () => {
  it('stack bottom-up by minY, not file order', () => {
    const levels = [L('upper', 'storey', null, { minY: 3 }), L('lower', 'storey', null, { minY: 0 })];
    const r = resolveLevels(levels, floors);
    expect(r.lower.floor).toBe('floor1');
    expect(r.upper.floor).toBe('floor2');
  });
});

describe('snapshotDiff', () => {
  const man = { levels: [{ id: 'a' }, { id: 'b' }], rooms: [{ id: 'r1' }, { id: 'r2' }] };
  it('compares the manifest with the known snapshot', () => {
    expect(snapshotDiff(man, { levels: ['a', 'x'], rooms: ['r1'] })).toEqual({
      levels: { added: ['b'], missing: ['x'] }, rooms: { added: ['r2'], missing: [] },
    });
  });
  it('is empty when nothing changed or no snapshot exists', () => {
    expect(snapshotDiff(man, { levels: ['a', 'b'], rooms: ['r1', 'r2'] })).toEqual({ levels: { added: [], missing: [] }, rooms: { added: [], missing: [] } });
    expect(snapshotDiff(man, null)).toEqual({ levels: { added: [], missing: [] }, rooms: { added: [], missing: [] } });
  });
});

describe('levelVisible (stacking)', () => {
  const elev = (id) => ({ basement: -3, ground: 0, first: 3 })[id];
  const w = (floor) => ({ show: 'with', floor });
  it('shows a storey on its floor and on floors above', () => {
    expect(levelVisible(w('ground'), 'ground', elev)).toBe(true);
    expect(levelVisible(w('ground'), 'first', elev)).toBe(true);
    expect(levelVisible(w('first'), 'ground', elev)).toBe(false);
    expect(levelVisible(w('basement'), 'ground', elev)).toBe(true);
    expect(levelVisible(w('first'), 'all', elev)).toBe(true);
  });
  it('only / always / all-only / hidden / unknown', () => {
    expect(levelVisible({ show: 'only', floor: 'ground' }, 'first', elev)).toBe(false);
    expect(levelVisible({ show: 'only', floor: 'ground' }, 'ground', elev)).toBe(true);
    expect(levelVisible({ show: 'always', floor: 'ground' }, 'basement', elev)).toBe(true);
    expect(levelVisible({ show: 'all-only', floor: null }, 'first', elev)).toBe(false);
    expect(levelVisible({ show: 'all-only', floor: null }, 'all', elev)).toBe(true);
    expect(levelVisible({ show: 'hidden', floor: 'ground' }, 'all', elev)).toBe(false);
    expect(levelVisible(undefined, 'ground', elev)).toBe(true);
  });
  it('falls back to equality when elevations are unknown', () => {
    expect(levelVisible(w('x'), 'y', () => undefined)).toBe(false);
    expect(levelVisible(w('x'), 'x', () => undefined)).toBe(true);
  });
  it.each(['with', 'only', 'always', 'all-only'])('a stale %s level is visible only in overview', (show) => {
    const assign = { floor: 'deleted', show, auto: false, stale: true };
    const unexpectedElevation = () => { throw new Error('a stale floor cannot be stacked'); };
    expect(levelVisible(assign, 'all', unexpectedElevation)).toBe(true);
    expect(levelVisible(assign, 'ground', unexpectedElevation)).toBe(false);
    expect(levelVisible(assign, 'deleted', unexpectedElevation)).toBe(false);
  });
  it('an explicitly hidden stale level stays hidden even in overview', () => {
    expect(levelVisible({ floor: 'deleted', show: 'hidden', stale: true }, 'all', elev)).toBe(false);
  });
});

describe('measuredElevations', () => {
  it('ground at 0, others from their lowest point, heights from the next storey', () => {
    expect(measuredElevations([
      { id: 'ground', role: 'storey', order: null, minY: -0.3, elevation: null },
      { id: 'attic', role: 'storey', order: null, minY: 2.89, elevation: null },
      { id: 'site', role: 'exterior', order: null, minY: -0.25, elevation: null },
    ])).toEqual({ ground: { elevation: 0, height: 2.9 }, attic: { elevation: 2.9, height: 2.7 } });
  });
  it('keeps tagged elevations out', () => {
    expect(measuredElevations([{ id: 'g', role: 'storey', order: 0, minY: 0, elevation: 0 }])).toEqual({});
  });
});

describe('measuredElevations fixes', () => {
  it('no -0, fallback ground, tagged neighbour boundary', () => {
    const r = measuredElevations([{ id: 'g', role: 'storey', order: 0, minY: -0.0, elevation: null }, { id: 'a', role: 'storey', order: 1, minY: 3, elevation: 3 }]);
    expect(Object.is(r.g.elevation, 0)).toBe(true);
    expect(r.g.height).toBe(3);
    expect(measuredElevations([{ id: 'x', role: 'storey', order: null, minY: 1.4, elevation: null }]).x.elevation).toBe(1);
  });
});
