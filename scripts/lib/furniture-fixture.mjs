// Original, locally licensed simulation bytes. The browser uses the real library
// client and GLTFLoader; only the authenticated HA HTTP observations are simulated.
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { floorPresentationFixtureGlb, floorFixtureIds, floorFixtureEntities } from './floor-presentation-fixture.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sorted = (value) => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function png() {
  const width = 16, height = 16, pixels = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 4) + 1 + x * 4;
    // Two broad, contrasting stripes make native image decode visible in actual
    // readPixels output, rather than proving only a texture/header exists.
    pixels.set(x < 8 ? [235, 30, 180, 255] : [20, 215, 225, 255], offset);
  }
  const chunk = (type, body) => { const name = Buffer.from(type), result = Buffer.alloc(body.length + 12);
    result.writeUInt32BE(body.length); name.copy(result, 4); body.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([name, body])), body.length + 8); return result;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
function tableGlb() {
  const chunks = []; let length = 0;
  const doc = { asset: { version: '2.0', generator: "Taylor's 3D original simulated textured table" }, scene: 0,
    scenes: [{ nodes: [5] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
    materials: [{ name: 'Actual embedded two-colour unlit texture', extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    extensionsUsed: ['KHR_materials_unlit'], images: [], textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }] };
  const append = (bytes, target) => { const pad = Buffer.alloc((4 - length % 4) % 4); chunks.push(pad); length += pad.length;
    const result = doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) }) - 1;
    chunks.push(bytes); length += bytes.length; return result;
  };
  const attribute = (values, type, size, target) => { const view = append(Buffer.from(values.buffer), target);
    const bounds = type === 'VEC3' ? { min: [0, 1, 2].map((axis) => Math.min(...Array.from(values).filter((_, i) => i % 3 === axis))),
      max: [0, 1, 2].map((axis) => Math.max(...Array.from(values).filter((_, i) => i % 3 === axis))) } : {};
    return doc.accessors.push({ bufferView: view, componentType: values instanceof Uint16Array ? 5123 : 5126,
      count: values.length / size, type, ...bounds }) - 1;
  };
  const vertices = [], normals = [], uv = [], indices = [];
  const faces = [
    [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5], [0, 0, 1]],
    [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5], [0, 0, -1]],
    [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [1, 0, 0]],
    [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-1, 0, 0]],
    [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5], [0, 1, 0]],
    [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5], [0, -1, 0]],
  ];
  for (const face of faces) { const start = vertices.length / 3;
    for (const point of face.slice(0, 4)) { vertices.push(...point); normals.push(...face[4]); }
    uv.push(0, 0, 1, 0, 1, 1, 0, 1); indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const attributes = { POSITION: attribute(new Float32Array(vertices), 'VEC3', 3, 34962),
    NORMAL: attribute(new Float32Array(normals), 'VEC3', 3, 34962), TEXCOORD_0: attribute(new Float32Array(uv), 'VEC2', 2, 34962) };
  doc.meshes = [{ name: 'Shared original box', primitives: [{ attributes, indices: attribute(new Uint16Array(indices), 'SCALAR', 1, 34963), material: 0 }] }];
  doc.images = [{ mimeType: 'image/png', bufferView: append(png()) }];
  const placements = [
    ['tabletop', [0, .66, 0], [.9, .12, .75]],
    ['leg-nw', [-.35, .3, -.25], [.09, .6, .09]], ['leg-ne', [.35, .3, -.25], [.09, .6, .09]],
    ['leg-sw', [-.35, .3, .25], [.09, .6, .09]], ['leg-se', [.35, .3, .25], [.09, .6, .09]],
  ];
  doc.nodes = placements.map(([name, translation, scale]) => ({ name, mesh: 0, translation, scale }));
  doc.nodes.push({ name: 'Original simulated furniture table', children: [0, 1, 2, 3, 4] });
  chunks.push(Buffer.alloc((4 - length % 4) % 4)); const binary = Buffer.concat(chunks); doc.buffers[0].byteLength = binary.length;
  const raw = Buffer.from(JSON.stringify(doc)), json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const head = Buffer.alloc(20), tail = Buffer.alloc(8); head.write('glTF'); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(28 + json.length + binary.length, 8); head.writeUInt32LE(json.length, 12); head.write('JSON', 16);
  tail.writeUInt32LE(binary.length); tail.write('BIN\0', 4); return Buffer.concat([head, json, tail, binary]);
}
function zip(files) {
  const chunks = [], directory = []; let offset = 0;
  for (const [filename, body] of Object.entries(files)) {
    const name = Buffer.from(filename), checksum = crc32(body), local = Buffer.alloc(30 + name.length), central = Buffer.alloc(46 + name.length);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); name.copy(central, 46);
    chunks.push(local, body); directory.push(central); offset += local.length + body.length;
  }
  const end = Buffer.alloc(22), directoryBytes = Buffer.concat(directory); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length, 8); end.writeUInt16LE(directory.length, 10); end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directoryBytes, end]);
}
function license(credit, file) {
  const text = `MIT License\n\nCopyright (c) 2026 ${credit}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`;
  return { id: 'MIT', file, text, sha256: digest(Buffer.from(text)) };
}

export function furnitureFixture() {
  const glb = tableGlb(), assetSha = digest(glb), primary = license('Taylor original simulated furniture fixture', 'LICENSE.txt'),
    second = license('Taylor alternate simulated item credit', 'CREDITS.txt');
  const manifest = { version: 1, id: 'simulated-local-furniture', name: 'Simulated local textured furniture', author: 'Taylor · original test fixture',
    license: { id: primary.id, file: primary.file }, preserved: { explanation: 'Original local test bytes; no purchased pack or real household data.' },
    items: [{ id: 'table', name: 'Simulated striped table', file: 'table.glb', unit: 'm', anchor: [0, 0, 0], credit: 'Original simulated tabletop and legs' },
      { id: 'table-credit', name: 'Same asset, separate item credit', file: 'table.glb', unit: 'm', anchor: [0, 0, 0], license: { id: second.id, file: second.file }, credit: 'Separate declared item attribution' }] };
  const files = { 'pack.json': Buffer.from(JSON.stringify(manifest)), 'table.glb': glb, 'LICENSE.txt': Buffer.from(primary.text), 'CREDITS.txt': Buffer.from(second.text) };
  const archive = zip(files), packId = digest(archive), stats = { nodes: 6, meshes: 1, mesh_uses: 5, primitives: 1,
    triangles: 60, source_triangles: 12, materials: 1, textures: 1, images: [{ width: 16, height: 16, mime_type: 'image/png' }], texture_pixels: 256 };
  const canonical = Buffer.from(JSON.stringify(sorted({ manifest, files: Object.fromEntries(Object.entries(files).filter(([name]) => name !== 'pack.json').map(([name, body]) => [name, digest(body)])) })));
  const pack = { pack_id: packId, logical_sha256: digest(canonical), archive_bytes: archive.length, manifest,
    license: primary, licenses: { 'LICENSE.txt': primary, 'CREDITS.txt': second }, download_url: `/api/taylors3d/furniture/packs/${packId}.zip`,
    items: manifest.items.map((item, index) => ({ ...item, metadata: structuredClone(item), sha256: assetSha, pack_id: packId,
      asset_url: `/api/taylors3d/furniture/assets/${assetSha}.glb`, license: index ? second : primary, stats: structuredClone(stats) })),
    stats: { archive_bytes: archive.length, expanded_bytes: Object.values(files).reduce((sum, body) => sum + body.length, 0), members: 4,
      items: 2, unique_assets: 1, asset_bytes: glb.length, triangles: 60, texture_pixels: 256 } };
  return { glb, archive, pack, packId, assetSha, catalogue: { version: 1, packs: [pack] },
    house: floorPresentationFixtureGlb(), ids: floorFixtureIds, entities: floorFixtureEntities };
}

export function furnitureFixtureHtml(mode) {
  const imports = { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/' };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Simulated locally licensed furniture proof</title><link rel="icon" href="data:,">
    <script type="importmap">${JSON.stringify({ imports })}</script><style>
    body{margin:0;padding:12px;font:14px system-ui;background:#e9eef2;color:#172833}main{width:max-content}
    .notice{margin:0 0 12px;max-width:1200px}taylors3d-card{display:block;width:1200px;--card-background-color:#fff;
      --secondary-background-color:#f4f4f4;--primary-text-color:#212121;--secondary-text-color:#595959;
      --primary-color:#007c70;--divider-color:#777;--text-primary-color:#fff}</style></head><body>
    <p class="notice">SIMULATED local furniture ZIP and Home Assistant observations · original embedded image · no real home connected</p>
    <main><taylors3d-card></taylors3d-card></main><script type="module">
    import * as mdi from '/node_modules/@mdi/js/mdi.js'; import '/${mode === 'source' ? 'src' : 'dist'}/taylors3d-card.js';
    class TestIcon extends HTMLElement{static get observedAttributes(){return ['icon'];}attributeChangedCallback(){
      const name=(this.getAttribute('icon')||'').replace(/^mdi:/,'');const key='mdi'+name.split('-').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join('');
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.style.cssText='width:24px;height:24px;fill:currentColor';
      const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',mdi[key]||mdi.mdiHelpCircleOutline);svg.append(shape);this.replaceChildren(svg);}}
    if(!customElements.get('ha-icon'))customElements.define('ha-icon',TestIcon);window.furnitureModuleReady=true;
    </script></body></html>`;
}

// Unlike CDP request interception, a real local HTTP server exposes the binary
// multipart file body. This is a labelled transport stand-in, not HA middleware.
export async function serveFurnitureFixture(root, mode) {
  const fixture = furnitureFixture(), requests = [], pending = new Set();
  const state = { published: false, catalogueMissing: false, holdAssets: false, imports: 0, uploads: [], assetReads: 0, archiveReads: 0 };
  const send = (response, status, type, body, authenticated = false) => { response.writeHead(status, { 'content-type': type,
    ...(authenticated ? { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } : {}) }); response.end(body); };
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://fixture').pathname;
    requests.push({ pathname, method: request.method, authorization: request.headers.authorization || null });
    if (pathname.startsWith('/api/taylors3d/furniture')) {
      if (request.headers.authorization !== 'Bearer furniture-simulated-admin') { send(response, 401, 'application/json', '{}', true); return; }
      if (pathname === '/api/taylors3d/furniture' && request.method === 'POST') {
        const bodies = []; let bytes = 0;
        try { for await (const chunk of request) { bytes += chunk.length; if (bytes > fixture.archive.length + 65536) throw new Error('fixture body limit'); bodies.push(chunk); } }
        catch { if (!response.destroyed) send(response, 400, 'application/json', '{}', true); return; }
        const body = Buffer.concat(bodies), boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(request.headers['content-type'] || '');
        const marker = boundary && Buffer.from(`\r\n--${boundary[1] || boundary[2]}`), start = body.indexOf(Buffer.from('\r\n\r\n'));
        const end = marker && start >= 0 ? body.indexOf(marker, start + 4) : -1;
        const header = start >= 0 ? body.subarray(0, start).toString('utf8') : '', supplied = end >= 0 ? body.subarray(start + 4, end) : Buffer.alloc(0);
        const exact = header.includes('name="file"; filename="furniture-pack.zip"') && supplied.equals(fixture.archive);
        state.uploads.push({ bytes: supplied.length, sha256: digest(supplied), exact, header });
        if (!exact) { send(response, 400, 'application/json', JSON.stringify({ error: 'The simulated endpoint requires the original fixture ZIP.' }), true); return; }
        const imported = !state.published; state.published = true; state.imports++;
        send(response, 200, 'application/json', JSON.stringify({ imported, pack: fixture.pack }), true); return;
      }
      if (pathname === '/api/taylors3d/furniture' && request.method === 'GET') {
        send(response, 200, 'application/json', JSON.stringify(state.published && !state.catalogueMissing ? fixture.catalogue : { version: 1, packs: [] }), true); return;
      }
      if (state.published && pathname === fixture.pack.items[0].asset_url) {
        state.assetReads++;
        if (state.holdAssets) await new Promise((resolve) => { pending.add(resolve); response.once('close', () => { pending.delete(resolve); resolve(); }); });
        if (!response.destroyed) send(response, 200, 'model/gltf-binary', fixture.glb, true); return;
      }
      if (state.published && pathname === fixture.pack.download_url) {
        state.archiveReads++; send(response, 200, 'application/zip', fixture.archive, true); return;
      }
      send(response, 404, 'application/json', '{}', true); return;
    }
    if (pathname === '/demo/furniture-fixture.html') { send(response, 200, 'text/html', furnitureFixtureHtml(mode)); return; }
    if (pathname === '/demo/furniture-house.glb') { send(response, 200, 'model/gltf-binary', fixture.house); return; }
    let file; try { file = path.resolve(root, '.' + decodeURIComponent(pathname)); } catch { send(response, 400, 'text/plain', 'Invalid fixture path'); return; }
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { send(response, 404, 'text/plain', 'Fixture resource missing'); return; }
    const types = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    send(response, 200, types[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const release = () => { state.holdAssets = false; for (const resolve of pending) resolve(); pending.clear(); };
  const close = () => { release(); server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); };
  return { fixture, state, requests, release, close, base: `http://127.0.0.1:${server.address().port}` };
}
