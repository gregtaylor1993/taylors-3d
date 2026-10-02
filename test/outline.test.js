import { describe, it, expect } from 'vitest';
import { outlineFromTriangles } from '../src/outline.js';
import { pointInPolygon, signedArea } from '../src/placement.js';

// a horizontal quad at height y from plan rect (x0..x1, y0..y1) → two triangles (world z = -plan y), CCW from above
const quad = (x0, y0, x1, y1, y = 0) => [x0, y, -y0, x1, y, -y0, x1, y, -y1, x0, y, -y0, x1, y, -y1, x0, y, -y1];
const wall = (x0, y0, x1) => [x0, 0, -y0, x1, 0, -y0, x1, 2.7, -y0]; // vertical triangle, ignored
const norm = (p) => p.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
const area = (p) => Math.abs(signedArea(p));

describe('outlineFromTriangles', () => {
  it('rectangle from two triangles', () => {
    const out = outlineFromTriangles([...quad(0, 0, 4, 3), ...wall(0, 0, 4)], [2, 0, -1.5]);
    expect(out).toHaveLength(4);
    expect(area(out)).toBeCloseTo(12);
  });
  it('L-shape made of quads sharing whole edges', () => {
    // vertices must coincide on shared edges; T-junctions are not traced (the pick then falls back to the rectangle)
    const out = outlineFromTriangles([...quad(0, 0, 2, 2), ...quad(2, 0, 4, 2), ...quad(0, 2, 2, 5)], [1, 0, -1]);
    expect(out).toHaveLength(6);
    expect(area(out)).toBeCloseTo(8 + 6);
  });
  it('two separate slabs: picks the loop containing the hit', () => {
    const out = outlineFromTriangles([...quad(0, 0, 4, 3), ...quad(6, 0, 9, 3)], [7, 0, -1]);
    expect(pointInPolygon([7, 1], out)).toBe(true);
    expect(area(out)).toBeCloseTo(9);
  });
  it('ignores faces at another height', () => {
    const out = outlineFromTriangles([...quad(0, 0, 4, 3, 0), ...quad(0, 0, 10, 10, 2.9)], [1, 0, -1]);
    expect(area(out)).toBeCloseTo(12);
  });
  it('snaps to 5 cm and drops collinear points', () => {
    const out = outlineFromTriangles([...quad(0, 0, 2.02, 3), ...quad(2.02, 0, 4.01, 3)], [1, 0, -1]);
    expect(norm(out).every(([x, y]) => Math.abs(x * 20 - Math.round(x * 20)) < 1e-6 && Math.abs(y * 20 - Math.round(y * 20)) < 1e-6)).toBe(true);
    expect(out).toHaveLength(4);
  });
  it('returns null when nothing is under the hit', () => {
    expect(outlineFromTriangles(quad(0, 0, 4, 3), [10, 0, -10])).toBeNull();
    expect(outlineFromTriangles([], [0, 0, 0])).toBeNull();
  });
  it('pinch vertices: two squares touching at a corner', () => {
    const out1 = outlineFromTriangles([...quad(0, 0, 2, 2)], [1, 0, -1]);
    expect(area(out1)).toBeCloseTo(4);
    const out2 = outlineFromTriangles([...quad(2, 2, 4, 4)], [3, 0, -3]);
    expect(area(out2)).toBeCloseTo(4);
    const out12 = outlineFromTriangles([...quad(0, 0, 2, 2), ...quad(2, 2, 4, 4)], [3, 0, -3]);
    expect(area(out12)).toBeCloseTo(4);
  });
  it('simplify collinear before snap: vertex 0.01 m off line removed even if snapping would move it', () => {
    const out = outlineFromTriangles([...quad(0, 0, 2, 2.01), ...quad(2, 0, 4, 2.01)], [1, 0, -1]);
    expect(out).toHaveLength(4);
  });
});
