import { describe, it, expect } from 'vitest';
import { findBlob, pixelToPlan, planToPixel, medianColor, imageScale } from '../src/mower-image.js';

// synthetic RGBA image filled with one colour
function image(w, h, bg = [30, 80, 30]) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([...bg, 255], i * 4);
  return a;
}
function rect(a, w, x0, y0, rw, rh, c) {
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) a.set([...c, 255], (y * w + x) * 4);
}
const RED = [255, 40, 30];

describe('pixelToPlan / planToPixel', () => {
  const ov = { x: 3, y: -2, rotation: 30, width: 9 };

  it('maps the image centre to the overlay centre', () => {
    const p = pixelToPlan(225, 425, 450, 850, ov);
    expect(p.x).toBeCloseTo(3, 9);
    expect(p.y).toBeCloseTo(-2, 9);
  });

  it('puts the top of the image north before rotation', () => {
    const p = pixelToPlan(225, 0, 450, 850, { x: 0, y: 0, rotation: 0, width: 9 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(8.5, 9); // height = 9 * 850 / 450 = 17
    const q = pixelToPlan(450, 425, 450, 850, { x: 0, y: 0, rotation: 0, width: 9 });
    expect(q.x).toBeCloseTo(4.5, 9); // right edge east
  });

  it('rotates counter-clockwise like the overlay plane (rotation.y)', () => {
    // right edge centre, rotated 90°: east becomes north
    const p = pixelToPlan(450, 425, 450, 850, { x: 0, y: 0, rotation: 90, width: 9 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(4.5, 9);
  });

  it('round-trips with rotation 30° and offsets', () => {
    for (const [px, py] of [[0, 0], [450, 850], [12.5, 700], [300, 40]]) {
      const p = pixelToPlan(px, py, 450, 850, ov);
      const q = planToPixel(p.x, p.y, 450, 850, ov);
      expect(q.px).toBeCloseTo(px, 9);
      expect(q.py).toBeCloseTo(py, 9);
    }
  });

  it('defaults a missing width to 20 m and missing offsets to 0', () => {
    const p = pixelToPlan(100, 50, 100, 100, {});
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });
});

describe('findBlob', () => {
  it('finds a single dot (centroid in pixel-centre coordinates)', () => {
    const a = image(40, 30);
    rect(a, 40, 10, 5, 4, 4, RED);
    const b = findBlob(a, 40, 30, RED, 40);
    expect(b).toEqual({ px: 12, py: 7, count: 16 });
  });

  it('returns null when nothing matches', () => {
    expect(findBlob(image(20, 20), 20, 20, RED, 40)).toBeNull();
  });

  it('respects the colour tolerance (max channel difference)', () => {
    const a = image(20, 20);
    rect(a, 20, 2, 2, 3, 3, [225, 40, 30]); // 30 off in red
    expect(findBlob(a, 20, 20, RED, 40)).toMatchObject({ count: 9 });
    expect(findBlob(a, 20, 20, RED, 20)).toBeNull();
  });

  it('ignores noise smaller than minPixels', () => {
    const a = image(30, 30);
    rect(a, 30, 1, 1, 1, 1, RED);
    rect(a, 30, 5, 5, 1, 3, RED);
    expect(findBlob(a, 30, 30, RED, 40, { minPixels: 4 })).toBeNull();
    rect(a, 30, 20, 20, 2, 2, RED);
    expect(findBlob(a, 30, 30, RED, 40, { minPixels: 4 })).toEqual({ px: 21, py: 21, count: 4 });
  });

  it('picks the largest blob, or the one nearest prev when sizes are close', () => {
    const a = image(60, 40);
    rect(a, 60, 2, 2, 5, 5, RED); // 25 px
    rect(a, 60, 50, 30, 5, 5, RED); // 25 px
    rect(a, 60, 30, 2, 2, 2, RED); // 4 px, too small to compete
    const near = findBlob(a, 60, 40, RED, 40, { prev: { px: 50, py: 30 } });
    expect(near).toEqual({ px: 52.5, py: 32.5, count: 25 });
    const other = findBlob(a, 60, 40, RED, 40, { prev: { px: 0, py: 0 } });
    expect(other).toEqual({ px: 4.5, py: 4.5, count: 25 });
    // a much bigger blob wins even far from prev
    rect(a, 60, 2, 2, 8, 8, RED); // 64 px
    expect(findBlob(a, 60, 40, RED, 40, { prev: { px: 50, py: 30 } })).toMatchObject({ count: 64 });
  });

  it('uses 4-neighbour connectivity', () => {
    const a = image(10, 10);
    rect(a, 10, 1, 1, 2, 2, RED);
    rect(a, 10, 3, 3, 2, 2, RED); // touches only diagonally
    expect(findBlob(a, 10, 10, RED, 40, { minPixels: 1 })).toMatchObject({ count: 4 });
  });

  it('skips transparent pixels', () => {
    const a = image(10, 10);
    rect(a, 10, 1, 1, 3, 3, RED);
    for (let i = 0; i < 100; i++) a[i * 4 + 3] = 0;
    expect(findBlob(a, 10, 10, RED, 40)).toBeNull();
  });
});

describe('medianColor', () => {
  it('takes the per-channel median of a 5x5 neighbourhood, clamped at the edges', () => {
    const a = image(10, 10, [0, 0, 0]);
    rect(a, 10, 0, 0, 3, 3, RED); // 9 of the 9..25 neighbours
    a.set([255, 255, 255, 255], 0); // one outlier
    expect(medianColor(a, 10, 10, 1, 1)).toEqual(RED);
    expect(medianColor(a, 10, 10, 8, 8)).toEqual([0, 0, 0]);
  });
});

describe('imageScale', () => {
  it('samples images wider than 1600 px on a smaller canvas', () => {
    expect(imageScale(800)).toBe(1);
    expect(imageScale(3200)).toBe(0.5);
  });
});
