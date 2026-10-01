// test/bindings.test.js
import { describe, it, expect } from 'vitest';
import {
  levelsFromFloorMap, migrateModel, resolveLevels, resolveRoomAreas, transformPoint, modelRooms,
  combineRooms, levelFloorOverrides, bindingDiff,
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
});

describe('resolveLevels', () => {
  it('matches exact ids, then storeys bottom-up, exterior with the lowest, roof all-only', () => {
    const r = resolveLevels([L('floor2'), L('ground', 'storey', 0), L('exterior', 'exterior'), L('roof', 'roof')], floors, {});
    expect(r.floor2).toMatchObject({ show: 'with', floor: 'floor2', auto: true });
    expect(r.ground).toMatchObject({ show: 'with', floor: 'floor1' });
    expect(r.exterior).toMatchObject({ show: 'with', floor: 'floor1' });
    expect(r.roof).toMatchObject({ show: 'all-only', floor: null });
  });

  it('order 0 aligns with the floor at elevation 0 (basement on a one-floor HA)', () => {
    const r = resolveLevels([L('basement', 'basement', -1), L('ground', 'storey', 0)], [{ id: 'floor1', elevation: 0 }], {});
    expect(r.ground.floor).toBe('floor1');
    expect(r.basement).toMatchObject({ show: 'always', floor: null });
  });

  it('honours saved bindings and show modes', () => {
    const r = resolveLevels([L('ground', 'storey', 0), L('exterior', 'exterior')], floors,
      { ground: { floor: 'floor2' }, exterior: { show: 'hidden' } });
    expect(r.ground).toMatchObject({ show: 'with', floor: 'floor2', auto: false });
    expect(r.exterior).toMatchObject({ show: 'hidden', auto: false });
  });

  it('falls back to defaults when a saved floor no longer exists', () => {
    const r = resolveLevels([L('ground', 'storey', 0)], floors, { ground: { floor: 'deleted' } });
    expect(r.ground).toMatchObject({ show: 'with', floor: 'floor1', auto: true, stale: true });
  });

  it('leftover storeys are always shown', () => {
    const r = resolveLevels([L('a', 'storey', 0), L('b', 'storey', 1), L('c', 'storey', 2)], floors, {});
    expect([r.a.floor, r.b.floor, r.c.show]).toEqual(['floor1', 'floor2', 'always']);
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
    expect(resolveRoomAreas(rooms.slice(0, 1), ['kitchen'], { kitchen: { area: 'gone' } }).kitchen).toEqual({ area: 'kitchen', auto: true, stale: true });
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
});

describe('levelFloorOverrides', () => {
  it('takes elevation and height of the level bound to a floor', () => {
    const lv = [L('ground', 'storey', 0, { elevation: 0, height: 2.89 }), L('first', 'storey', 1, { elevation: 3.25, height: 2.5 }), L('ext', 'exterior', null, { elevation: 0 })];
    const as = { ground: { show: 'with', floor: 'floor1' }, first: { show: 'with', floor: 'floor2' }, ext: { show: 'with', floor: 'floor1' } };
    expect(levelFloorOverrides(lv, as, { position: [0, 0, 0.1], scale: 1 })).toEqual([
      { id: 'floor1', elevation: 0.1, height: 2.89 }, { id: 'floor2', elevation: 3.35, height: 2.5 },
    ]);
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
});
