import { describe, it, expect } from 'vitest';
import { parseSelector, nodeIndex, matches, resolveVisibility, unmatchedSelectors } from '../src/views.js';
import { buildManifest } from '../src/manifest.js';

const tree = (roots) => {
  const parent = new Map();
  const walk = (n) => (n.children || []).forEach((c) => { parent.set(c, n); walk(c); });
  roots.forEach(walk);
  return { roots: () => roots, children: (n) => n.children || [], name: (n) => n.name || '', extras: (n) => n.extras || {}, parent: (n) => parent.get(n) || null };
};
const fp = (o) => ({ fp: o });
const sq = [[0, 0], [4, 0], [4, 3]];
const lamp = { name: 'lamp', extras: fp({ kind: 'object', id: 'l1', type: 'light', group: 'facade' }) };
const sofa = { name: 'Sofa', extras: fp({ layer: 'furniture' }) };
const kitchen = { name: 'kitchen', extras: fp({ kind: 'room', id: 'kitchen', outline: sq }), children: [sofa, { name: 'slab' }] };
const ceiling = { name: 'Ceiling', extras: fp({ layer: ['ceiling'] }) };
const ground = { name: 'ground', extras: fp({ kind: 'level', id: 'ground', order: 0 }), children: [kitchen, lamp] };
const attic = { name: 'attic', extras: fp({ kind: 'level', id: 'attic', order: 1 }), children: [ceiling] };
const ext = { name: 'exterior', extras: fp({ kind: 'level', id: 'exterior', role: 'exterior' }), children: [{ name: 'lawn', extras: fp({ kind: 'zone', id: 'lawn', outline: sq }) }] };
const roof = { name: 'roof' };
const adapter = tree([ground, attic, ext, roof]);
const idx = nodeIndex(adapter, buildManifest(adapter));
const at = (name) => idx.nodes.findIndex((n) => n.name === name);

describe('parseSelector', () => {
  it('parses known kinds', () => {
    expect(parseSelector('all')).toEqual({ kind: 'all', value: null });
    expect(parseSelector('level:ground')).toEqual({ kind: 'level', value: 'ground' });
    expect(parseSelector('node:ground/**/Sofa')).toEqual({ kind: 'node', value: 'ground/**/Sofa' });
    expect(parseSelector('nope:x')).toBeNull();
    expect(parseSelector('')).toBeNull();
  });
});

describe('nodeIndex / matches', () => {
  it('indexes tags, layers, paths and levels', () => {
    const k = idx.nodes[at('kitchen')];
    expect(k).toMatchObject({ path: 'ground/kitchen', levelId: 'ground', tag: { kind: 'room', id: 'kitchen' } });
    expect(idx.nodes[at('Sofa')].layers).toEqual(['furniture']);
    expect(idx.nodes[at('Ceiling')].layers).toEqual(['ceiling']);
    expect(idx.nodes[at('roof')].tag).toMatchObject({ kind: 'level', id: 'roof', role: 'roof' });
  });
  it('matches every selector kind', () => {
    const m = (s, name) => matches(parseSelector(s), idx.nodes[at(name)]);
    expect(m('level:ground', 'ground')).toBe(true);
    expect(m('role:exterior', 'exterior')).toBe(true);
    expect(m('room:kitchen', 'kitchen')).toBe(true);
    expect(m('zone:lawn', 'lawn')).toBe(true);
    expect(m('object:l1', 'lamp')).toBe(true);
    expect(m('type:light', 'lamp')).toBe(true);
    expect(m('group:facade', 'lamp')).toBe(true);
    expect(m('layer:furniture', 'Sofa')).toBe(true);
    expect(m('node:ground/kitchen/Sofa', 'Sofa')).toBe(true);
    expect(m('node:ground/*/Sofa', 'Sofa')).toBe(true);
    expect(m('node:**/Sofa', 'Sofa')).toBe(true);
    expect(m('node:ground/*', 'Sofa')).toBe(false);
    expect(m('all', 'roof')).toBe(true);
    expect(m('room:kitchen', 'Sofa')).toBe(false); // selectors match the node itself, not descendants
  });
});

describe('resolveVisibility', () => {
  const vis = (rules) => { const v = resolveVisibility(idx, rules); return (name) => v[at(name)]; };
  it('defaults to visible and inherits', () => {
    const v = vis([]);
    expect(v('Sofa')).toBe(true);
  });
  it('last matching rule wins; children inherit', () => {
    const v = vis([{ hide: 'level:attic' }, { hide: 'role:roof' }]);
    expect([v('ground'), v('attic'), v('Ceiling'), v('roof')]).toEqual([true, false, false, false]);
    expect(vis([{ hide: 'level:attic' }, { show: 'level:attic' }])('attic')).toBe(true);
  });
  it('a shown descendant keeps its ancestors visible but not its siblings', () => {
    const v = vis([{ hide: 'level:ground' }, { show: 'room:kitchen' }]);
    expect([v('ground'), v('kitchen'), v('slab'), v('lamp')]).toEqual([true, true, true, false]);
  });
  it('hide all + show list (model views)', () => {
    const v = vis([{ hide: 'all' }, { show: 'level:ground' }, { show: 'role:exterior' }]);
    expect([v('ground'), v('kitchen'), v('attic'), v('lawn'), v('roof')]).toEqual([true, true, false, true, false]);
  });
  it('layer rules reach nested nodes', () => {
    expect(vis([{ hide: 'layer:furniture' }])('Sofa')).toBe(false);
  });
  it('reports selectors that match nothing', () => {
    expect(unmatchedSelectors(idx, [{ hide: 'node:old/path' }, { hide: 'level:ground' }, { hide: 'bad' }])).toEqual(['node:old/path', 'bad']);
  });
});

describe('views edge cases', () => {
  it('rule order matters', () => {
    const v = resolveVisibility(idx, [{ show: 'room:kitchen' }, { hide: 'level:ground' }]);
    expect(v[at('kitchen')]).toBe(false);
  });
  it('malformed rules are ignored', () => {
    const rules = [{}, null, { show: 5 }, { hide: 'node:' }];
    expect(() => unmatchedSelectors(idx, rules)).not.toThrow();
    expect(resolveVisibility(idx, rules).every(Boolean)).toBe(true);
    expect(unmatchedSelectors(idx, rules)).toEqual(['node:']);
  });
  it('node names with regex characters match literally', () => {
    const odd = { name: 'a.b[1]' };
    const a2 = tree([{ name: 'root', children: [odd, { name: 'aXb1' }] }]);
    const i2 = nodeIndex(a2, buildManifest(a2));
    const hit = i2.nodes.filter((n) => matches(parseSelector('node:root/a.b[1]'), n)).map((n) => n.name);
    expect(hit).toEqual(['a.b[1]']);
  });
});
