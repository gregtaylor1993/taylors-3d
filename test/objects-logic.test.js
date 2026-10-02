import { describe, it, expect } from 'vitest';
import { bindObjects, chainState, lightColor, lightLevel, lightBudget, nightFactor, sunVector, screenNearest, sunStrength, clampSunDir } from '../src/objects/logic.js';

const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

describe('bindObjects', () => {
  const objects = [
    { id: 'a', suggest: { entity: 'light.a' } },
    { id: 'b', suggest: { entity: 'light.missing' } },
    { id: 'c', suggest: {} },
  ];
  const states = { 'light.a': st('light.a', 'on'), 'light.x': st('light.x', 'off') };
  it('auto-binds suggest.entity when it exists', () => {
    const b = bindObjects(objects, {}, states);
    expect(b.get('a')).toEqual({ entity: 'light.a', auto: true, missing: false, hidden: false });
    expect(b.get('b')).toEqual({ entity: null, auto: true, missing: true, hidden: false });
    expect(b.get('c')).toEqual({ entity: null, auto: true, missing: false, hidden: false });
  });
  it('layout entry overrides and can hide', () => {
    const b = bindObjects(objects, { a: { entity: 'light.x' }, c: { hidden: true } }, states);
    expect(b.get('a')).toEqual({ entity: 'light.x', auto: false, missing: false, hidden: false });
    expect(b.get('c').hidden).toBe(true);
  });
  it('explicit entity that no longer exists is missing', () => {
    expect(bindObjects(objects, { a: { entity: 'light.gone' } }, states).get('a').missing).toBe(true);
  });
});

describe('chainState', () => {
  const states = {
    'light.f': st('light.f', 'on', { brightness: 128 }),
    'switch.g': st('switch.g', 'off'),
    'switch.on': st('switch.on', 'on'),
    'switch.x': st('switch.x', 'home'),
    'climate.y': st('climate.y', 'heat'),
    'light.u': st('light.u', 'unavailable'),
  };
  it('own entity only', () => {
    const r = chainState({ group: null }, { entity: 'light.f' }, {}, states);
    expect(r.lit).toBe(true); expect(r.source.entity_id).toBe('light.f'); expect(r.reason).toBe(null);
  });
  it('group controller off makes it dark with reason entity name', () => {
    const r = chainState({ group: 'facade' }, { entity: 'light.f' }, { facade: { entity: 'switch.g' } }, states);
    expect(r.lit).toBe(false); expect(r.reason).toBe('switch.g is off'); expect(r.entities).toEqual(['light.f', 'switch.g']);
  });
  it('group controller only (no own entity)', () => {
    const r = chainState({ group: 'facade' }, { entity: null }, { facade: { entity: 'switch.on' } }, states);
    expect(r.lit).toBe(true); expect(r.source).toBe(null);
  });
  it('unavailable is dark and flagged', () => {
    const r = chainState({ group: null }, { entity: 'light.u' }, {}, states);
    expect(r.lit).toBe(false); expect(r.unavailable).toBe(true);
  });
  it('no entity at all is dark without reason', () => {
    expect(chainState({ group: null }, { entity: null }, {}, states)).toMatchObject({ lit: false, reason: null });
  });
  it('switch.x in home state is dark (isOn is on only)', () => {
    const r = chainState({ group: null }, { entity: 'switch.x' }, {}, states);
    expect(r.lit).toBe(false);
  });
  it('climate heat as own entity is dark', () => {
    const r = chainState({ group: null }, { entity: 'climate.y' }, {}, states);
    expect(r.lit).toBe(false);
  });
  it('no own entity + controller off gives reason with entity name', () => {
    const r = chainState({ group: 'facade' }, { entity: null }, { facade: { entity: 'switch.g' } }, states);
    expect(r.lit).toBe(false); expect(r.reason).toBe('switch.g is off');
  });
});

describe('lightColor / lightLevel', () => {
  it('rgb_color wins', () => expect(lightColor(st('light.a', 'on', { rgb_color: [255, 0, 0], hs_color: [120, 100] }))).toEqual([255, 0, 0]));
  it('hs_color converts', () => expect(lightColor(st('light.a', 'on', { hs_color: [120, 100] }))).toEqual([0, 255, 0]));
  it('kelvin converts to warm for 2700', () => { const [r, g, b] = lightColor(st('light.a', 'on', { color_temp_kelvin: 2700 })); expect(r).toBe(255); expect(b).toBeLessThan(g); });
  it('default warm white', () => expect(lightColor(st('switch.a', 'on'))).toEqual([255, 191, 128]));
  it('level from brightness, 1 when on without brightness, 0 when off', () => {
    expect(lightLevel(st('light.a', 'on', { brightness: 51 }))).toBeCloseTo(0.2);
    expect(lightLevel(st('switch.a', 'on'))).toBe(1);
    expect(lightLevel(st('light.a', 'off', { brightness: 200 }))).toBe(0);
    expect(lightLevel(null)).toBe(0);
  });
});

describe('lightBudget', () => {
  const f = (id, o = {}) => ({ id, lit: true, visible: true, group: null, max: 5, beam: 'point', castShadow: true, ...o });
  it('largest max first, pools respected, unlit and invisible skipped', () => {
    const fx = [f('a', { max: 34 }), f('b', { max: 5 }), f('c', { lit: false, max: 99 }), f('d', { visible: false, max: 99 }), f('s', { beam: 'spot', max: 10 })];
    const r = lightBudget(fx, { points: 1, spots: 1, shadows: 4 });
    expect([...r.real.keys()].sort()).toEqual(['a', 's']);
    expect(r.real.get('s').kind).toBe('spot');
  });
  it('one real light per group (middle fixture, factor 1.5), groups never cast shadows', () => {
    const fx = ['g1', 'g2', 'g3'].map((id) => f(id, { group: 'facade', max: 5 }));
    const r = lightBudget(fx);
    expect([...r.real.keys()]).toEqual(['g2']);
    expect(r.real.get('g2').factor).toBe(1.5);
    expect(r.shadows.size).toBe(0);
  });
  it('group middle fixture with numeric collation (lamp2/lamp10/lamp3 → lamp3)', () => {
    const fx = ['lamp2', 'lamp10', 'lamp3'].map((id) => f(id, { group: 'facade', max: 5 }));
    const r = lightBudget(fx);
    expect([...r.real.keys()]).toEqual(['lamp3']);
  });
  it('at most N shadows, only castShadow !== false singles', () => {
    const fx = [1, 2, 3, 4, 5, 6].map((i) => f('p' + i, { max: i })).concat([f('n', { max: 100, castShadow: false })]);
    const r = lightBudget(fx);
    expect(r.shadows.size).toBe(4);
    expect(r.shadows.has('n')).toBe(false);
    expect(r.shadows.has('p6')).toBe(true);
  });
  it('spot fixture never casts shadow even with castShadow true and largest max', () => {
    const fx = [f('point1', { max: 2 }), f('spot1', { beam: 'spot', max: 100, castShadow: true })];
    const r = lightBudget(fx);
    expect(r.real.has('spot1')).toBe(true);
    expect(r.shadows.has('spot1')).toBe(false);
  });
  it('tie-break equal max by id (alphabetical)', () => {
    const fx = [f('z', { max: 10 }), f('a', { max: 10 })];
    const r = lightBudget(fx, { points: 1 });
    expect([...r.real.keys()]).toEqual(['a']);
  });
});

describe('nightFactor / sunVector', () => {
  it('smoothstep between +6 and -6 degrees', () => {
    expect(nightFactor(30)).toBe(0); expect(nightFactor(-20)).toBe(1); expect(nightFactor(0)).toBeCloseTo(0.5);
  });
  it('non-finite input returns 0', () => {
    expect(nightFactor(NaN)).toBe(0);
    expect(nightFactor(Infinity)).toBe(0);
    expect(nightFactor(-Infinity)).toBe(0);
  });
  it('east sun with north 0 points to +x', () => {
    const [x, y, z] = sunVector(90, 0, 0, 0); expect(x).toBeCloseTo(1); expect(y).toBeCloseTo(0); expect(z).toBeCloseTo(0);
  });
  it('south sun at 45° elevation points to +z (south) and up', () => {
    const [x, y, z] = sunVector(180, 45, 0, 0); expect(x).toBeCloseTo(0); expect(y).toBeCloseTo(Math.SQRT1_2); expect(z).toBeCloseTo(Math.SQRT1_2);
  });
  it('north -26.4: true north lies west of model north', () => {
    const [x, , z] = sunVector(0, 0, -26.4, 0); expect(x).toBeLessThan(0); expect(z).toBeLessThan(0);
  });
  it('model alignment rotation (deg, CCW) rotates the vector', () => {
    const [x, , z] = sunVector(90, 0, 0, 90); expect(x).toBeCloseTo(0); expect(z).toBeCloseTo(-1);
  });
});

describe('screenNearest', () => {
  const pts = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 130, y: 100 }];
  it('nearest within radius', () => { expect(screenNearest(pts, 118, 100, 30)).toBe('b'); expect(screenNearest(pts, 300, 300, 52)).toBe(null); });
  it('exact tie: first point wins', () => {
    const tied = [{ id: 'first', x: 100, y: 100 }, { id: 'second', x: 100, y: 100 }];
    expect(screenNearest(tied, 100, 100, 10)).toBe('first');
  });
});

describe('sun below the horizon', () => {
  it('sunStrength is 0 at -2 and below, 1 from +4', () => {
    expect(sunStrength(-10)).toBe(0);
    expect(sunStrength(-2)).toBe(0);
    expect(sunStrength(0)).toBeGreaterThan(0);
    expect(sunStrength(0)).toBeLessThan(1);
    expect(sunStrength(4)).toBe(1);
    expect(sunStrength(NaN)).toBe(1);
  });
  it('clampSunDir lifts y to 0.05 and keeps unit length and bearing', () => {
    const v = clampSunDir(sunVector(90, -10));
    expect(v[1]).toBeCloseTo(0.05);
    expect(Math.hypot(...v)).toBeCloseTo(1);
    expect(v[0]).toBeGreaterThan(0.99);
    expect(clampSunDir([0, 0.5, 0.5])).toEqual([0, 0.5, 0.5]);
    expect(clampSunDir([0, -1, 0])).toEqual([0, 1, 0]);
  });
});
