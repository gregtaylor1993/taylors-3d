// Room outline from a mesh's upward-facing triangles at the clicked height (pick a room from the model).
import { pointInPolygon, signedArea } from './placement.js';

const COS_UP = Math.cos((25 * Math.PI) / 180);
const MERGE = 200; // points within 5 mm share a key
const key = (x, z) => Math.round(x * MERGE) + ',' + Math.round(z * MERGE);

export function outlineFromTriangles(tris, hit) {
  const pts = new Map(); // key -> [x, z]
  const edgeCount = new Map(); // undirected key -> count
  const edgeDir = new Map(); // undirected key -> [p, q] as it appeared in a triangle
  for (let i = 0; i + 8 < tris.length; i += 9) {
    let a = [tris[i], tris[i + 1], tris[i + 2]], b = [tris[i + 3], tris[i + 4], tris[i + 5]], c = [tris[i + 6], tris[i + 7], tris[i + 8]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!len || Math.abs(ny / len) < COS_UP) continue;
    if (Math.abs((a[1] + b[1] + c[1]) / 3 - hit[1]) > 0.05) continue;
    // Normalize winding: flip triangle if normal points down
    if (ny < 0) [b, c] = [c, b];
    const ks = [a, b, c].map((p) => { const k = key(p[0], p[2]); pts.set(k, [p[0], p[2]]); return k; });
    for (const [p, q] of [[ks[0], ks[1]], [ks[1], ks[2]], [ks[2], ks[0]]]) {
      const e = p < q ? p + '|' + q : q + '|' + p;
      edgeCount.set(e, (edgeCount.get(e) || 0) + 1);
      // Store direction as it appears in the triangle
      edgeDir.set(e, [p, q]);
    }
  }
  const boundaryEdges = [];
  const edgesByStart = new Map(); // vertex key -> array of edge indices
  for (const [e, count] of edgeCount) {
    if (count !== 1) continue;
    const [p, q] = edgeDir.get(e);
    const idx = boundaryEdges.length;
    boundaryEdges.push([p, q]);
    if (!edgesByStart.has(p)) edgesByStart.set(p, []);
    edgesByStart.get(p).push(idx);
  }
  const used = new Set();
  const loops = [];
  for (let startIdx = 0; startIdx < boundaryEdges.length; startIdx++) {
    if (used.has(startIdx)) continue;
    const loop = [];
    let edgeIdx = startIdx;
    for (;;) {
      if (used.has(edgeIdx)) break;
      used.add(edgeIdx);
      const [p, q] = boundaryEdges[edgeIdx];
      loop.push(p);
      const nexts = (edgesByStart.get(q) || []).filter((i) => !used.has(i));
      if (!nexts.length) break;
      let next;
      if (nexts.length === 1) {
        next = nexts[0];
      } else if (loop.length > 1) {
        // Pinch vertex: pick edge with smallest signed turning angle (most clockwise)
        const [px, pz] = pts.get(p), [qx, qz] = pts.get(q);
        const incoming = [qx - px, qz - pz];
        next = nexts.reduce((best, i) => {
          const [, qNext] = boundaryEdges[i];
          const [qnx, qnz] = pts.get(qNext);
          const outgoing = [qnx - qx, qnz - qz];
          const cross = incoming[0] * outgoing[1] - incoming[1] * outgoing[0];
          const dot = incoming[0] * outgoing[0] + incoming[1] * outgoing[1];
          const angle = Math.atan2(cross, dot);
          const [, qBest] = boundaryEdges[best];
          const [qbx, qbz] = pts.get(qBest);
          const bestVec = [qbx - qx, qbz - qz];
          const bestCross = incoming[0] * bestVec[1] - incoming[1] * bestVec[0];
          const bestDot = incoming[0] * bestVec[0] + incoming[1] * bestVec[1];
          const bestAngle = Math.atan2(bestCross, bestDot);
          return angle < bestAngle ? i : best;
        });
      } else {
        next = nexts[0];
      }
      if (next === startIdx && loop.length > 2) break;
      edgeIdx = next;
    }
    if (loop.length >= 3) loops.push(loop.map((k) => { const [x, z] = pts.get(k); return [x, -z]; }));
  }
  const target = [hit[0], -hit[2]];
  const area = (l) => Math.abs(signedArea(l));
  // the smallest loop around the click (a merged mesh can span several rooms), else the largest loop
  let candidates = loops.filter((l) => pointInPolygon(target, l)).sort((a, b) => area(a) - area(b));
  if (!candidates.length) { // the hit sits on an edge/seam: take the largest loop whose box (+10 cm) holds it
    const near = (l) => l.some(([x]) => x <= target[0] + 0.1) && l.some(([x]) => x >= target[0] - 0.1)
      && l.some(([, y]) => y <= target[1] + 0.1) && l.some(([, y]) => y >= target[1] - 0.1);
    candidates = loops.filter(near).sort((a, b) => area(b) - area(a));
  }
  if (!candidates.length) return null;
  // Simplify collinear points BEFORE snapping
  let simplified = candidates[0];
  const simp = [];
  for (let i = 0; i < simplified.length; i++) {
    const p = simp.length ? simp[simp.length - 1] : simplified[simplified.length - 1];
    const c = simplified[i], n = simplified[(i + 1) % simplified.length];
    if (Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-6) continue;
    const dx = n[0] - p[0], dy = n[1] - p[1], l = Math.hypot(dx, dy) || 1;
    if (Math.abs((c[0] - p[0]) * dy - (c[1] - p[1]) * dx) / l < 0.02) continue; // collinear
    simp.push(c);
  }
  simplified = simp;
  const snapped = simplified.map(([x, y]) => [Math.round(x / 0.05) * 0.05, Math.round(y / 0.05) * 0.05].map((v) => Math.round(v * 1000) / 1000));
  const out = [];
  for (let i = 0; i < snapped.length; i++) {
    const p = out.length ? out[out.length - 1] : snapped[snapped.length - 1];
    const c = snapped[i];
    if (Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-6) continue;
    out.push(c);
  }
  return out.length >= 3 ? out : null;
}
