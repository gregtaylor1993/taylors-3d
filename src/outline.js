// Room outline from a mesh's upward-facing triangles at the clicked height (pick a room from the model).
import { pointInPolygon, signedArea } from './placement.js';

const COS_UP = Math.cos((25 * Math.PI) / 180);
const key = (x, z) => Math.round(x * 1000) + ',' + Math.round(z * 1000);

export function outlineFromTriangles(tris, hit) {
  const pts = new Map(); // key -> [x, z]
  const edgeCount = new Map(); // "a|b" -> count
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]], b = [tris[i + 3], tris[i + 4], tris[i + 5]], c = [tris[i + 6], tris[i + 7], tris[i + 8]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!len || Math.abs(ny / len) < COS_UP) continue;
    if (Math.abs((a[1] + b[1] + c[1]) / 3 - hit[1]) > 0.05) continue;
    const ks = [a, b, c].map((p) => { const k = key(p[0], p[2]); pts.set(k, [p[0], p[2]]); return k; });
    for (const [p, q] of [[ks[0], ks[1]], [ks[1], ks[2]], [ks[2], ks[0]]]) {
      const e = p < q ? p + '|' + q : q + '|' + p;
      edgeCount.set(e, (edgeCount.get(e) || 0) + 1);
    }
  }
  const adj = new Map();
  for (const [e, n] of edgeCount) {
    if (n !== 1) continue;
    const [p, q] = e.split('|');
    if (!adj.has(p)) adj.set(p, []);
    if (!adj.has(q)) adj.set(q, []);
    adj.get(p).push(q); adj.get(q).push(p);
  }
  const used = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop = [start]; used.add(start);
    let prev = null, cur = start;
    for (;;) {
      const next = (adj.get(cur) || []).find((n) => n !== prev && (n === start ? loop.length > 2 : !used.has(n)));
      if (!next || next === start) break;
      loop.push(next); used.add(next); prev = cur; cur = next;
    }
    if (loop.length >= 3) loops.push(loop.map((k) => { const [x, z] = pts.get(k); return [x, -z]; }));
  }
  const target = [hit[0], -hit[2]];
  const candidates = loops.filter((l) => pointInPolygon(target, l)).sort((a, b) => Math.abs(signedArea(a)) - Math.abs(signedArea(b)));
  if (!candidates.length) return null;
  const snapped = candidates[0].map(([x, y]) => [Math.round(x / 0.05) * 0.05, Math.round(y / 0.05) * 0.05].map((v) => Math.round(v * 1000) / 1000));
  const out = [];
  for (let i = 0; i < snapped.length; i++) {
    const p = out.length ? out[out.length - 1] : snapped[snapped.length - 1];
    const c = snapped[i], n = snapped[(i + 1) % snapped.length];
    if (Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-6) continue;
    const dx = n[0] - p[0], dy = n[1] - p[1], l = Math.hypot(dx, dy) || 1;
    if (Math.abs((c[0] - p[0]) * dy - (c[1] - p[1]) * dx) / l < 0.02) continue; // collinear
    out.push(c);
  }
  return out.length >= 3 ? out : null;
}
