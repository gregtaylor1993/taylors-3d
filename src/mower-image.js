// Mower position from a live map image: find the mower icon by its colour, then map the pixel
// onto the plan through the map overlay alignment (the overlay IS the calibration).
//
// Pixel coordinates are continuous: pixel (i, j) covers [i, i+1) x [j, j+1), so its centre is
// (i + 0.5, j + 0.5) and the image spans [0, w] x [0, h].

export const MAX_SAMPLE_WIDTH = 1600;

// Overlay geometry, exactly as view.setMapOverlay draws it: a plane centred on (x, y), `width`
// metres wide, height = width * imgH / imgW, top of the image north, then rotated
// counter-clockwise by `rotation` degrees (plane.rotation.y) about its centre.
function frame(imgW, imgH, o) {
  const w = (o && o.width) || 20;
  const r = (((o && o.rotation) || 0) * Math.PI) / 180;
  return { w, h: (w * imgH) / imgW, cos: Math.cos(r), sin: Math.sin(r), ox: (o && o.x) || 0, oy: (o && o.y) || 0 };
}

export function pixelToPlan(px, py, imgW, imgH, overlay) {
  const f = frame(imgW, imgH, overlay);
  const lx = (px / imgW - 0.5) * f.w;
  const ly = (0.5 - py / imgH) * f.h;
  return { x: f.ox + lx * f.cos - ly * f.sin, y: f.oy + lx * f.sin + ly * f.cos };
}

export function planToPixel(x, y, imgW, imgH, overlay) {
  const f = frame(imgW, imgH, overlay);
  const dx = x - f.ox, dy = y - f.oy;
  const lx = dx * f.cos + dy * f.sin;
  const ly = -dx * f.sin + dy * f.cos;
  return { px: (lx / f.w + 0.5) * imgW, py: (0.5 - ly / f.h) * imgH };
}

// Largest blob of pixels within `tolerance` (max channel difference) of `color`, 4-connected.
// When `prev` (last pixel position) is given, blobs within 20 % of the largest size compete
// and the one nearest prev wins. Components smaller than minPixels are noise.
// Returns { px, py, count } (centroid) or null.
export function findBlob(rgba, w, h, color, tolerance, { minPixels = 4, prev = null } = {}) {
  const n = w * h;
  const [cr, cg, cb] = color;
  const tol = tolerance ?? 40;
  const mask = new Uint8Array(n);
  for (let i = 0, k = 0; i < n; i++, k += 4) {
    if (rgba[k + 3] < 128) continue;
    if (Math.abs(rgba[k] - cr) <= tol && Math.abs(rgba[k + 1] - cg) <= tol && Math.abs(rgba[k + 2] - cb) <= tol) mask[i] = 1;
  }
  const stack = new Int32Array(n);
  const blobs = [];
  for (let s = 0; s < n; s++) {
    if (mask[s] !== 1) continue;
    let top = 0, count = 0, sx = 0, sy = 0;
    stack[top++] = s;
    mask[s] = 2;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      count++;
      sx += x;
      sy += y;
      if (x > 0 && mask[i - 1] === 1) { mask[i - 1] = 2; stack[top++] = i - 1; }
      if (x < w - 1 && mask[i + 1] === 1) { mask[i + 1] = 2; stack[top++] = i + 1; }
      if (y > 0 && mask[i - w] === 1) { mask[i - w] = 2; stack[top++] = i - w; }
      if (y < h - 1 && mask[i + w] === 1) { mask[i + w] = 2; stack[top++] = i + w; }
    }
    if (count >= minPixels) blobs.push({ px: sx / count + 0.5, py: sy / count + 0.5, count });
  }
  if (!blobs.length) return null;
  let best = blobs[0];
  for (const b of blobs) if (b.count > best.count) best = b;
  if (prev) {
    const d = (b) => Math.hypot(b.px - prev.px, b.py - prev.py);
    const near = blobs.filter((b) => b.count >= best.count * 0.8);
    best = near.reduce((a, b) => (d(b) < d(a) ? b : a));
  }
  return best;
}

// Per-channel median of the 5x5 neighbourhood around pixel (px, py) (integer pixel indices),
// clamped to the image.
export function medianColor(rgba, w, h, px, py) {
  const ch = [[], [], []];
  for (let y = py - 2; y <= py + 2; y++) {
    if (y < 0 || y >= h) continue;
    for (let x = px - 2; x <= px + 2; x++) {
      if (x < 0 || x >= w) continue;
      const k = (y * w + x) * 4;
      ch[0].push(rgba[k]);
      ch[1].push(rgba[k + 1]);
      ch[2].push(rgba[k + 2]);
    }
  }
  return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0);
}

// Scale used to sample an image of this width (large images are read on a smaller canvas).
export function imageScale(width) {
  return width > MAX_SAMPLE_WIDTH ? MAX_SAMPLE_WIDTH / width : 1;
}

// ---------- browser: load an image URL into pixels (one reused canvas) ----------
let canvas = null;

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob); // decoded off the main thread
      return { src: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
    } catch { /* e.g. SVG: fall back to an <img> */ }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return { src: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

// { data, width, height } of the sampled canvas plus the real image size (imgW, imgH).
// Throws when the image cannot be fetched or read (e.g. another origin).
export async function readImagePixels(url) {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const img = await decode(await res.blob());
  try {
    if (!img.width || !img.height) throw new Error('empty image');
    const s = imageScale(img.width);
    const cw = Math.max(1, Math.round(img.width * s)), chh = Math.max(1, Math.round(img.height * s));
    if (!canvas) canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(cw, chh) : document.createElement('canvas');
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== chh) canvas.height = chh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, cw, chh);
    ctx.drawImage(img.src, 0, 0, cw, chh);
    const data = ctx.getImageData(0, 0, cw, chh).data;
    return { data, width: cw, height: chh, imgW: img.width, imgH: img.height };
  } finally {
    img.done();
  }
}
