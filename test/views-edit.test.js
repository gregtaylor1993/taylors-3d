import { describe, it, expect } from 'vitest';
import { nodeIndex, ruleState, setRuleState, nextEyeState, viewTree, pickSelector, orderViews, nextViewId } from '../src/views.js';
import { buildManifest } from '../src/manifest.js';

const tree = (roots) => {
  const parent = new Map();
  const walk = (n) => (n.children || []).forEach((c) => { parent.set(c, n); walk(c); });
  roots.forEach(walk);
  return { roots: () => roots, children: (n) => n.children || [], name: (n) => n.name || '', extras: (n) => n.extras || {}, parent: (n) => parent.get(n) || null };
};
const fp = (o) => ({ fp: o });
const sq = [[0, 0], [4, 0], [4, 3]];
const lamp = { name: 'lamp', extras: fp({ kind: 'object', id: 'l1', type: 'light' }) };
const sofa = { name: 'Sofa', extras: fp({ kind: 'object', id: 'sofa', type: 'furniture', layer: 'furniture' }) };
const chairs = { name: 'Chairs', extras: fp({ layer: 'furniture' }), children: [{ name: 'chair1' }, { name: 'chair2' }] };
const kitchen = { name: 'kitchen', extras: fp({ kind: 'room', id: 'kitchen', outline: sq }), children: [sofa, chairs, { name: 'slab' }] };
const deep = { name: 'deep', children: [{ name: 'deeper', children: [{ name: 'deepest', children: [{ name: 'm' }] }] }] };
const ceiling = { name: 'Ceiling', extras: fp({ layer: ['ceiling'] }) };
const ground = { name: 'ground', extras: fp({ kind: 'level', id: 'ground', order: 0 }), children: [kitchen, lamp, deep, { name: 'mesh_177' }] };
const attic = { name: 'attic', extras: fp({ kind: 'level', id: 'attic', order: 1 }), children: [ceiling] };
const ext = { name: 'exterior', extras: fp({ kind: 'level', id: 'exterior', role: 'exterior' }), children: [{ name: 'lawn', extras: fp({ kind: 'zone', id: 'lawn', outline: sq }) }] };
const props = { name: 'Props', children: [{ name: 'Tree', children: [{ name: 'leaves' }] }] };
const adapter = tree([ground, attic, ext, props]);
const man = buildManifest(adapter);
const idx = nodeIndex(adapter, man);
const at = (name) => idx.nodes.findIndex((n) => n.name === name);

describe('rule list edits', () => {
  it('reads the state of a selector from the layout rules (last one wins)', () => {
    expect(ruleState([], 'level:ground')).toBe('default');
    expect(ruleState([{ hide: 'level:ground' }], 'level:ground')).toBe('hidden');
    expect(ruleState([{ hide: 'level:ground' }, { show: 'level:ground' }], 'level:ground')).toBe('shown');
    expect(ruleState([{ show: 'layer:x' }], 'level:ground')).toBe('default');
    expect(ruleState(null, 'all')).toBe('default');
  });
  it('replaces earlier rules for the selector and appends the new one', () => {
    const r = [{ hide: 'level:ground' }, { show: 'layer:x' }, { show: 'level:ground' }];
    expect(setRuleState(r, 'level:ground', 'hidden')).toEqual([{ show: 'layer:x' }, { hide: 'level:ground' }]);
    expect(setRuleState(r, 'level:ground', 'shown')).toEqual([{ show: 'layer:x' }, { show: 'level:ground' }]);
    expect(setRuleState(r, 'level:ground', 'default')).toEqual([{ show: 'layer:x' }]);
    expect(setRuleState(undefined, 'all', 'hidden')).toEqual([{ hide: 'all' }]);
    expect(r).toHaveLength(3); // not mutated
  });
  it('cycles default -> shown -> hidden -> default', () => {
    expect(nextEyeState('default')).toBe('shown');
    expect(nextEyeState('shown')).toBe('hidden');
    expect(nextEyeState('hidden')).toBe('default');
  });
});

describe('viewTree', () => {
  const t = viewTree(idx, { 'level:ground': 'Ground floor' });
  it('lists levels, their rooms/zones and objects under each', () => {
    expect(t.tree.map((r) => [r.sel, r.depth])).toEqual([
      ['level:ground', 0], ['room:kitchen', 1], ['object:sofa', 2], ['object:l1', 1],
      ['level:attic', 0],
      ['level:exterior', 0], ['zone:lawn', 1],
    ]);
    expect(t.tree[0].label).toBe('Ground floor');
    expect(t.tree[1].label).toBe('kitchen');
    expect(t.tree[1].nodes).toEqual([at('kitchen')]);
  });
  it('lists distinct layers with their nodes', () => {
    expect(t.layers.map((r) => r.sel)).toEqual(['layer:furniture', 'layer:ceiling']);
    expect(t.layers[0].nodes).toEqual([at('Sofa'), at('Chairs')]);
  });
  it('lists untagged groups with children up to two levels below a level or the root', () => {
    expect(t.groups.map((r) => [r.sel, r.depth])).toEqual([
      ['node:ground/kitchen/Chairs', 1], ['node:ground/deep', 0], ['node:ground/deep/deeper', 1],
      ['node:Props', 0], ['node:Props/Tree', 1],
    ]);
  });
});

describe('pickSelector', () => {
  const owner = (name) => { const e = man.byNode.get(idx.nodes[at(name)].node); return e; };
  it('uses the tag of a tagged room/zone/object owner', () => {
    expect(pickSelector(idx, at('slab'), owner('kitchen'))).toEqual({ sel: 'room:kitchen', idx: at('kitchen') });
    expect(pickSelector(idx, at('lawn'), owner('lawn'))).toEqual({ sel: 'zone:lawn', idx: at('lawn') });
  });
  it('walks up to the nearest named group with children (not past the owning level)', () => {
    expect(pickSelector(idx, at('chair1'), owner('kitchen'))).toEqual({ sel: 'room:kitchen', idx: at('kitchen') });
    expect(pickSelector(idx, at('m'), owner('ground'))).toEqual({ sel: 'node:ground/deep/deeper/deepest', idx: at('deepest') });
    expect(pickSelector(idx, at('leaves'), null)).toEqual({ sel: 'node:Props/Tree', idx: at('Tree') });
  });
  it('a mesh directly in a level picks the mesh itself', () => {
    expect(pickSelector(idx, at('mesh_177'), owner('ground'))).toEqual({ sel: 'node:ground/mesh_177', idx: at('mesh_177') });
  });
  it('the level node itself picks the level', () => {
    expect(pickSelector(idx, at('attic'), owner('attic'))).toEqual({ sel: 'level:attic', idx: at('attic') });
  });
  it('returns null without a node', () => {
    expect(pickSelector(idx, -1, null)).toBeNull();
  });
});

describe('orderViews / nextViewId', () => {
  const vs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'all' }];
  it('sorts by the stored order; unknown ids keep their relative place after', () => {
    expect(orderViews(vs, ['c', 'a']).map((v) => v.id)).toEqual(['c', 'a', 'b', 'all']);
    expect(orderViews(vs, null).map((v) => v.id)).toEqual(['a', 'b', 'c', 'all']);
    expect(orderViews(vs, ['x', 'all', 'b']).map((v) => v.id)).toEqual(['all', 'b', 'a', 'c']);
  });
  it('picks the first free view_<n>', () => {
    expect(nextViewId(['a', 'view_1', 'view_3'])).toEqual({ id: 'view_2', n: 2 });
    expect(nextViewId([])).toEqual({ id: 'view_1', n: 1 });
  });
});
