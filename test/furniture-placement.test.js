import { describe, expect, it } from 'vitest';
import { readFurniturePlacement, resolveFurniturePlacement } from '../src/furniture-placement.js';
const packId = 'a'.repeat(64), asset = 'b'.repeat(64);
const instance = (patch = {}) => ({ id: 'chair_1', pack_id: packId, item_id: 'chair', asset_sha256: asset, floor_id: 'upper', x: 2, y: 3, ...patch });
const raw = (row = instance(), patch = {}) => ({ version: 1, instances: [row], ...patch });
const catalogue = () => ({ version: 1, packs: [{ pack_id: packId, manifest: { name: 'Actual pack' },
  items: [{ id: 'chair', pack_id: packId, sha256: asset, unit: 'm', anchor: [1, 2, 3], name: 'Actual chair' }] }] });
const floors = () => [{ id: 'upper', elevation: 4 }];

describe('strict versioned source furniture placements', () => {
  it('defaults only absent settings and optional fields without mutating or erasing imported extras', () => {
    expect(readFurniturePlacement(undefined)).toEqual({ version: 1, instances: [], valid: true, diagnostics: [] });
    const original = raw(instance({ custom: { artist: 'Original' } }), { extension: { enabled: 'kept' } }), before = structuredClone(original);
    const read = readFurniturePlacement(original); expect(read.valid).toBe(true); expect(read.instances[0]).toMatchObject({ z: 0, rotation_degrees: 0, scale: 1 });
    expect(original).toEqual(before);
  });
  it.each([null, [], true, { version: '1', instances: [] }, { version: 1 }, { version: 1, instances: null }])('rejects malformed present policy %#', (value) => {
    expect(readFurniturePlacement(value).valid).toBe(false);
  });
  it.each([
    { id: '' }, { id: 'A' }, { id: 'x'.repeat(65) }, { pack_id: 'a'.repeat(63) }, { pack_id: 'A'.repeat(64) }, { asset_sha256: '../asset' },
    { item_id: 'chair/name' }, { floor_id: '' }, { floor_id: 'f'.repeat(257) }, { floor_id: 'floor\n' },
    { x: '2' }, { x: null }, { y: true }, { y: NaN }, { z: undefined }, { z: Infinity }, { x: 1000.001 }, { y: -1000.001 },
    { rotation_degrees: '90' }, { rotation_degrees: null }, { rotation_degrees: Infinity }, { scale: undefined }, { scale: 0.049 }, { scale: 10.001 },
  ])('rejects a malformed known instance field without coercion %#', (patch) => {
    const read = readFurniturePlacement(raw(instance(patch))); expect(read.valid).toBe(false); expect(read.diagnostics.length).toBeGreaterThan(0);
  });
  it('accepts exact coordinate/scale endpoints and preserves explicitly finite rotation offsets', () => {
    expect(readFurniturePlacement(raw(instance({ x: -1000, y: 1000, z: -1000, scale: 0.05, rotation_degrees: -450 }))).valid).toBe(true);
    expect(readFurniturePlacement(raw(instance({ scale: 10 }))).valid).toBe(true);
  });
  it('requires unique IDs and respects the full 128-instance budget', () => {
    expect(readFurniturePlacement({ version: 1, instances: [instance(), instance()] }).valid).toBe(false);
    const entries = Array.from({ length: 128 }, (_, index) => instance({ id: `chair_${index}` }));
    expect(readFurniturePlacement({ version: 1, instances: entries }).valid).toBe(true);
    expect(readFurniturePlacement({ version: 1, instances: [...entries, instance({ id: 'overflow' })] }).valid).toBe(false);
  });
});
describe('exact current catalogue and floor evidence', () => {
  it('resolves actual item/pack credit identity and source coordinates, keeping GLB-local anchor separate', () => {
    const library = catalogue(), level = floors(), report = resolveFurniturePlacement(raw(instance({ z: 1.5, rotation_degrees: 450 })), { catalogue: library, floors: level });
    expect(report.ready).toBe(true); expect(report.rows[0].sourceWorld).toEqual([2, 5.5, -3]); expect(report.rows[0].rotationRadians).toBeCloseTo(Math.PI / 2);
    expect(report.rows[0].item).toBe(library.packs[0].items[0]); expect(report.rows[0].pack).toBe(library.packs[0]); expect(report.rows[0].floor).toBe(level[0]);
    expect(report.rows[0].item.anchor).toEqual([1, 2, 3]);
  });
  it.each([undefined, [], [{ id: 'other', elevation: 0 }], [{ id: 'upper', elevation: '4' }], [{ id: 'upper', elevation: Infinity }],
    [{ id: 'upper', elevation: 4, stale: true }], [{ id: 'upper', elevation: 4, stale: undefined }], [{ id: 'upper', elevation: 1e7 }],
    [{ id: 'upper', elevation: 4 }, { id: 'upper', elevation: 4 }]])('does not invent floor zero or choose an ambiguous/stale elevation %#', (current) => {
    const report = resolveFurniturePlacement(raw(), { floors: current, catalogue: catalogue() });
    expect(report.valid).toBe(true); expect(report.ready).toBe(false); expect(report.rows[0].sourceWorld).toBeNull(); expect(report.rows[0].instance.floor_id).toBe('upper');
  });
  it.each(['missing', 'duplicate-pack', 'duplicate-item', 'hash', 'foreign-pack', 'unit', 'anchor', 'version'])('suppresses %s catalogue uncertainty without changing saved references', (kind) => {
    const library = catalogue(), pack = library.packs[0];
    if (kind === 'missing') library.packs = [];
    if (kind === 'duplicate-pack') library.packs.push(structuredClone(pack));
    if (kind === 'duplicate-item') pack.items.push(structuredClone(pack.items[0]));
    if (kind === 'hash') pack.items[0].sha256 = 'c'.repeat(64);
    if (kind === 'foreign-pack') pack.items[0].pack_id = 'c'.repeat(64);
    if (kind === 'unit') pack.items[0].unit = 'cm';
    if (kind === 'anchor') pack.items[0].anchor = [0, NaN, 0];
    if (kind === 'version') library.version = '1';
    const original = raw(), before = structuredClone(original), report = resolveFurniturePlacement(original, { catalogue: library, floors: floors() });
    expect(report.ready).toBe(false); expect(report.rows[0].ready).toBe(false); expect(original).toEqual(before);
  });
  it('never substitutes an identical asset from another published pack or item', () => {
    const library = catalogue(); library.packs[0].pack_id = 'c'.repeat(64); library.packs[0].items[0].pack_id = 'c'.repeat(64);
    expect(resolveFurniturePlacement(raw(), { catalogue: library, floors: floors() }).ready).toBe(false);
  });
  it('retains missing runtime references while independently resolving another valid instance', () => {
    const report = resolveFurniturePlacement({ version: 1, instances: [instance(), instance({ id: 'missing', floor_id: 'lost' })] }, { catalogue: catalogue(), floors: floors() });
    expect(report.valid).toBe(true); expect(report.ready).toBe(false); expect(report.rows.map((row) => row.ready)).toEqual([true, false]);
  });
  it('does not render any placement when an imported known field is structurally malformed', () => {
    const report = resolveFurniturePlacement({ version: 1, instances: [instance(), instance({ id: 'bad', scale: '1' })] }, { catalogue: catalogue(), floors: floors() });
    expect(report.valid).toBe(false); expect(report.rows.every((row) => !row.ready && row.sourceWorld === null)).toBe(true);
  });
});
