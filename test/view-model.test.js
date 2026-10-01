import { describe, it, expect } from 'vitest';
import { levelVisible, fallbackOutline } from '../src/view.js';

describe('levelVisible', () => {
  it('follows the show mode', () => {
    expect(levelVisible({ show: 'with', floor: 'f1' }, 'f1')).toBe(true);
    expect(levelVisible({ show: 'with', floor: 'f1' }, 'f2')).toBe(false);
    expect(levelVisible({ show: 'with', floor: 'f1' }, 'all')).toBe(true);
    expect(levelVisible({ show: 'always', floor: null }, 'f2')).toBe(true);
    expect(levelVisible({ show: 'hidden', floor: null }, 'all')).toBe(false);
    expect(levelVisible({ show: 'all-only', floor: null }, 'f1')).toBe(false);
    expect(levelVisible({ show: 'all-only', floor: null }, 'all')).toBe(true);
    expect(levelVisible(undefined, 'f1')).toBe(true); // unknown: show
  });
});

describe('fallbackOutline', () => {
  it('is the plan rectangle of a world box (north = -z)', () => {
    expect(fallbackOutline({ min: { x: 1, z: -5 }, max: { x: 4, z: -2 } })).toEqual([[1, 2], [4, 2], [4, 5], [1, 5]]);
  });
});
