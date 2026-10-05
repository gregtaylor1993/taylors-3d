// FUTURE static furniture owner only. No root imports, house mutations, timers,
// extra renderer/lights, DOM labels, arbitrary resource URLs or device actions.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveFurniturePlacement } from './furniture-placement.js';
import { sha256 } from './sha256.js';

const MiB = 1024 * 1024;
export const FURNITURE_RENDERING_LIMITS = Object.freeze({ instances: 128, triangles: 500000,
  assetBytes: 32 * MiB, texturePixels: 32 * MiB, asset: 10 * MiB, assetTriangles: 100000,
  assetTexturePixels: 16 * MiB, cachedAssets: 128, parses: 2 });
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const vec = (v, count, max = 1e6) => Array.isArray(v) && v.length === count && v.every((n) => finite(n) && Math.abs(n) <= max);
const clone = (v) => structuredClone(v);
const diagnostic = (code, message, id) => ({ code, message, ...(id ? { id } : {}) });
const messages = Object.freeze({ session: 'Furniture waits for a current active Home Assistant session.',
  identity: 'Use the exact published item, hash and canonical furniture route.', metadata: 'Published furniture statistics or anchor are malformed.',
  corrupt: 'Furniture bytes or statistics do not match their published identity.', glb: 'This asset is not a bounded static embedded GLB supported by this furniture layer.',
  loading: 'This furniture asset could not be loaded. Retry with the current library.', mapping: 'This exact current floor has no valid source-to-display mapping.',
  budget: 'The requested furniture exceeds the instance, triangle, asset-byte or texture-pixel budget.',
  disabled: 'Furniture display is disabled.', stale: 'The current furniture context changed while this asset was loading.' });
class FurnitureError extends Error { constructor(code) { super(messages[code]); this.code = code; } }
const requireValue = (value, code = 'glb') => { if (!value) throw new FurnitureError(code); };
const extensionNames = new Set(['KHR_materials_unlit', 'KHR_texture_transform']);

// Header dimensions are verified before the browser decodes an embedded image.
// This bounds decoded texture work even if published statistics are corrupted;
// the actual decoder still decides whether the pixels are decodable.
function imageDimensions(bytes, mimeType) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let width, height;
  if (mimeType === 'image/png') {
    requireValue(bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
      && data.getUint32(8) === 13 && data.getUint32(12) === 0x49484452);
    width = data.getUint32(16); height = data.getUint32(20);
    requireValue(bytes[26] === 0 && bytes[27] === 0 && bytes[28] <= 1);
  } else {
    requireValue(bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217);
    let offset = 2, segments = 0;
    while (offset + 4 <= bytes.length && !width) {
      requireValue(++segments <= 4096 && bytes[offset++] === 255); while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]; requireValue(marker !== 0 && marker !== 216 && marker !== 217 && marker !== 218 && !(marker >= 208 && marker <= 215));
      requireValue(offset + 2 <= bytes.length); const length = data.getUint16(offset); requireValue(length >= 2 && offset + length <= bytes.length);
      if (marker === 192 || marker === 193 || marker === 194) {
        requireValue(length >= 8 && bytes[offset + 2] === 8); height = data.getUint16(offset + 3); width = data.getUint16(offset + 5);
      } else requireValue(!(marker >= 193 && marker <= 207 && ![196, 200, 204].includes(marker)));
      offset += length;
    }
  }
  requireValue(integer(width, 1, 2048) && integer(height, 1, 2048)); return { width, height, mime_type: mimeType };
}

// A defence before GLTFLoader can allocate arrays or request a resource. The
// integration remains the full ZIP/GLB validator; this is not a second importer.
function inspectGlb(bytes) {
  requireValue(bytes instanceof Uint8Array && integer(bytes.length, 20, FURNITURE_RENDERING_LIMITS.asset));
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireValue(data.getUint32(0, true) === 0x46546c67 && data.getUint32(4, true) === 2 && data.getUint32(8, true) === bytes.length);
  const chunks = []; let offset = 12;
  while (offset < bytes.length) {
    requireValue(offset + 8 <= bytes.length && chunks.length < 2);
    const length = data.getUint32(offset, true), type = data.getUint32(offset + 4, true); requireValue(length % 4 === 0 && offset + 8 + length <= bytes.length);
    chunks.push({ type, bytes: bytes.subarray(offset + 8, offset + 8 + length) }); offset += 8 + length;
  }
  requireValue(chunks[0]?.type === 0x4e4f534a && chunks[0].bytes.length <= 512 * 1024 && (chunks.length === 1 || chunks[1].type === 0x004e4942));
  let json; try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunks[0].bytes)); } catch { throw new FurnitureError('glb'); }
  requireValue(plain(json) && plain(json.asset) && json.asset.version === '2.0' && (!Object.hasOwn(json.asset, 'minVersion') || json.asset.minVersion === '2.0'));
  const array = (field, max) => { const value = json[field] ?? []; requireValue(Array.isArray(value) && value.length <= max); return value; };
  const used = array('extensionsUsed', 16), required = array('extensionsRequired', 16);
  requireValue(used.every((name) => extensionNames.has(name)) && required.every((name) => extensionNames.has(name) && used.includes(name))
    && new Set(used).size === used.length && new Set(required).size === required.length);
  for (const field of ['animations', 'skins', 'cameras']) requireValue(array(field, 0).length === 0);
  const todo = [[json, 0, false]]; let values = 0;
  while (todo.length) {
    const [value, depth, extras] = todo.pop(); requireValue(++values <= 50000 && depth <= 32);
    if (typeof value === 'number') requireValue(finite(value));
    if (plain(value)) {
      if (!extras && Object.hasOwn(value, 'extensions')) {
        requireValue(plain(value.extensions));
        for (const [name, definition] of Object.entries(value.extensions)) requireValue(extensionNames.has(name) && used.includes(name) && plain(definition));
      }
      for (const [key, child] of Object.entries(value)) todo.push([child, depth + 1, extras || key === 'extras']);
    } else if (Array.isArray(value)) for (const child of value) todo.push([child, depth + 1, extras]);
  }
  const buffers = array('buffers', 1), binary = chunks[1]?.bytes || new Uint8Array();
  requireValue(buffers.length === 1 && plain(buffers[0]) && !Object.hasOwn(buffers[0], 'uri')
    && integer(buffers[0].byteLength, 1, bytes.length) && binary.length >= buffers[0].byteLength && binary.length <= buffers[0].byteLength + 3);
  const views = array('bufferViews', 2080), accessors = array('accessors', 2048), nodes = array('nodes', 512), meshes = array('meshes', 256);
  const index = (v, list) => integer(v, 0, list.length - 1);
  for (const view of views) requireValue(plain(view) && view.buffer === 0 && integer(view.byteOffset ?? 0, 0, binary.length)
    && integer(view.byteLength, 1, binary.length) && (view.byteOffset ?? 0) + view.byteLength <= buffers[0].byteLength
    && (!Object.hasOwn(view, 'byteStride') || integer(view.byteStride, 4, 252) && view.byteStride % 4 === 0));
  const types = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }; let elements = 0;
  for (const accessor of accessors) {
    requireValue(plain(accessor) && index(accessor.bufferView, views) && !Object.hasOwn(accessor, 'sparse')
      && integer(accessor.count, 1, 300000) && Object.hasOwn(types, accessor.type) && Object.hasOwn(sizes, accessor.componentType));
    elements += accessor.count * types[accessor.type]; requireValue(elements <= 2000000);
    const view = views[accessor.bufferView], size = sizes[accessor.componentType], item = types[accessor.type] * size, stride = view.byteStride ?? item;
    const start = accessor.byteOffset ?? 0; requireValue(integer(start, 0, view.byteLength) && start % size === 0 && (view.byteOffset ?? 0) % size === 0
      && stride >= item && stride % size === 0 && start + (accessor.count - 1) * stride + item <= view.byteLength);
    if (accessor.componentType === 5126) {
      const float = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
      for (let i = 0; i < accessor.count; i++) for (let c = 0; c < types[accessor.type]; c++) requireValue(finite(float.getFloat32((view.byteOffset ?? 0) + start + i * stride + c * 4, true)));
    }
  }
  const images = array('images', 32), textures = array('textures', 64), materials = array('materials', 128);
  const imageReports = [];
  for (const image of images) {
    requireValue(plain(image) && !Object.hasOwn(image, 'uri') && index(image.bufferView, views) && ['image/png', 'image/jpeg'].includes(image.mimeType));
    const view = views[image.bufferView], start = view.byteOffset ?? 0;
    imageReports.push(imageDimensions(binary.subarray(start, start + view.byteLength), image.mimeType));
  }
  for (const texture of textures) requireValue(plain(texture) && index(texture.source, images));
  const unitVector = (value, count) => vec(value, count, 1) && value.every((n) => n >= 0);
  const textureReference = (reference) => {
    requireValue(plain(reference) && index(reference.index, textures) && (!Object.hasOwn(reference, 'texCoord') || integer(reference.texCoord, 0, 3)));
    const transform = reference.extensions?.KHR_texture_transform;
    if (transform) {
      for (const key of ['offset', 'scale']) if (Object.hasOwn(transform, key)) requireValue(vec(transform[key], 2, 10000));
      if (Object.hasOwn(transform, 'rotation')) requireValue(finite(transform.rotation) && Math.abs(transform.rotation) <= 1e6);
      if (Object.hasOwn(transform, 'texCoord')) requireValue(integer(transform.texCoord, 0, 3));
    }
  };
  for (const material of materials) {
    requireValue(plain(material) && (!Object.hasOwn(material, 'alphaMode') || ['OPAQUE', 'MASK', 'BLEND'].includes(material.alphaMode))
      && (!Object.hasOwn(material, 'alphaCutoff') || finite(material.alphaCutoff) && material.alphaCutoff >= 0 && material.alphaCutoff <= 1)
      && (!Object.hasOwn(material, 'doubleSided') || typeof material.doubleSided === 'boolean')
      && (!Object.hasOwn(material, 'emissiveFactor') || unitVector(material.emissiveFactor, 3)));
    if (Object.hasOwn(material, 'pbrMetallicRoughness')) {
      const pbr = material.pbrMetallicRoughness; requireValue(plain(pbr));
      if (Object.hasOwn(pbr, 'baseColorFactor')) requireValue(unitVector(pbr.baseColorFactor, 4));
      for (const key of ['metallicFactor', 'roughnessFactor']) if (Object.hasOwn(pbr, key)) requireValue(finite(pbr[key]) && pbr[key] >= 0 && pbr[key] <= 1);
      for (const key of ['baseColorTexture', 'metallicRoughnessTexture']) if (Object.hasOwn(pbr, key)) textureReference(pbr[key]);
    }
    for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) if (Object.hasOwn(material, key)) textureReference(material[key]);
    if (Object.hasOwn(material.normalTexture ?? {}, 'scale')) requireValue(finite(material.normalTexture.scale) && Math.abs(material.normalTexture.scale) <= 10000);
    if (Object.hasOwn(material.occlusionTexture ?? {}, 'strength')) requireValue(finite(material.occlusionTexture.strength) && material.occlusionTexture.strength >= 0 && material.occlusionTexture.strength <= 1);
  }
  const triangles = []; let primitives = 0;
  for (const mesh of meshes) {
    requireValue(plain(mesh) && !Object.hasOwn(mesh, 'weights') && Array.isArray(mesh.primitives) && mesh.primitives.length > 0); let count = 0;
    for (const primitive of mesh.primitives) {
      requireValue(++primitives <= 512 && plain(primitive) && (primitive.mode ?? 4) === 4 && !Object.hasOwn(primitive, 'targets')
        && plain(primitive.attributes) && index(primitive.attributes.POSITION, accessors));
      const position = accessors[primitive.attributes.POSITION]; requireValue(position.type === 'VEC3' && position.componentType === 5126);
      for (const [name, reference] of Object.entries(primitive.attributes)) requireValue(!/^(JOINTS|WEIGHTS)_/.test(name) && index(reference, accessors));
      let countVertices = position.count;
      if (Object.hasOwn(primitive, 'indices')) { requireValue(index(primitive.indices, accessors)); const indices = accessors[primitive.indices];
        requireValue(indices.type === 'SCALAR' && [5121, 5123, 5125].includes(indices.componentType)); countVertices = indices.count; }
      requireValue(countVertices % 3 === 0 && (!Object.hasOwn(primitive, 'material') || index(primitive.material, materials))); count += countVertices / 3;
    }
    requireValue(count > 0 && count <= 100000); triangles.push(count);
  }
  const parents = new Map();
  for (const [i, node] of nodes.entries()) {
    requireValue(plain(node) && !['skin', 'camera', 'weights'].some((field) => Object.hasOwn(node, field))
      && (!Object.hasOwn(node, 'mesh') || index(node.mesh, meshes)) && (!Object.hasOwn(node, 'name') || typeof node.name === 'string' && node.name.length <= 1024));
    for (const [field, length] of [['translation', 3], ['rotation', 4], ['scale', 3], ['matrix', 16]])
      if (Object.hasOwn(node, field)) requireValue(vec(node[field], length, 10000));
    requireValue(!Object.hasOwn(node, 'matrix') || !['translation', 'rotation', 'scale'].some((field) => Object.hasOwn(node, field)));
    if (node.scale) requireValue(node.scale.every((n) => n !== 0));
    const children = node.children ?? []; requireValue(Array.isArray(children) && children.length <= 512);
    for (const child of children) { requireValue(index(child, nodes) && !parents.has(child)); parents.set(child, i); }
  }
  for (let i = 0; i < nodes.length; i++) { const seen = new Set(); let node = i; while (parents.has(node)) { requireValue(!seen.has(node)); seen.add(node); node = parents.get(node); } }
  const scenes = array('scenes', 1); requireValue(scenes.length === 1 && plain(scenes[0]) && Array.isArray(scenes[0].nodes)
    && scenes[0].nodes.length > 0 && scenes[0].nodes.every((root) => index(root, nodes) && !parents.has(root)) && new Set(scenes[0].nodes).size === scenes[0].nodes.length
    && (!Object.hasOwn(json, 'scene') || json.scene === 0));
  let drawn = 0, uses = 0; const selected = [...scenes[0].nodes];
  while (selected.length) { const node = nodes[selected.pop()]; if (Object.hasOwn(node, 'mesh')) { drawn += triangles[node.mesh]; uses++; } selected.push(...(node.children || [])); }
  const sourceTriangles = triangles.reduce((sum, value) => sum + value, 0); requireValue(drawn > 0 && drawn <= 100000 && sourceTriangles <= 100000);
  return { json, triangles: drawn, sourceTriangles, meshUses: uses, nodes: nodes.length, meshes: meshes.length, primitives, materials: materials.length, textures: textures.length, images: imageReports };
}

function metadata(item) {
  requireValue(item.asset_url === `/api/taylors3d/furniture/assets/${item.sha256}.glb`, 'identity');
  requireValue(vec(item.anchor, 3, 10000) && plain(item.stats), 'metadata');
  const stats = item.stats;
  for (const [field, minimum, maximum] of [['nodes', 1, 512], ['meshes', 1, 256], ['mesh_uses', 1, 512], ['primitives', 1, 512],
    ['triangles', 1, 100000], ['source_triangles', 1, 100000], ['materials', 0, 128], ['textures', 0, 64], ['texture_pixels', 0, 16 * MiB]])
    requireValue(integer(stats[field], minimum, maximum), 'metadata');
  requireValue(Array.isArray(stats.images) && stats.images.length <= 32, 'metadata'); let pixels = 0;
  for (const image of stats.images) { requireValue(plain(image) && integer(image.width, 1, 2048) && integer(image.height, 1, 2048) && ['image/png', 'image/jpeg'].includes(image.mime_type), 'metadata'); pixels += image.width * image.height; }
  requireValue(pixels === stats.texture_pixels, 'metadata');
  return JSON.stringify([stats.nodes, stats.meshes, stats.mesh_uses, stats.primitives, stats.triangles, stats.source_triangles,
    stats.materials, stats.textures, stats.texture_pixels, stats.images.map((image) => [image.width, image.height, image.mime_type])]);
}

// Per-parse ownership, including resources that finish after a cancelled/failed
// parse. Hooks call the actual pinned GLTFLoader/parser; no decoder is replaced.
class Resources {
  constructor() { this.geometries = new Set(); this.materials = new Set(); this.textures = new Set(); this.images = new Set(); this.urls = new Set(); this.disposed = false; }
  capture(resource, set) { if (!resource || set.has(resource)) return; set.add(resource); if (this.disposed) resource.dispose(); }
  texture(texture) { this.capture(texture, this.textures); const image = texture?.image; if (image && typeof image.close === 'function' && !this.images.has(image)) { this.images.add(image); if (this.disposed) image.close(); } }
  material(material) { if (!material) return; for (const value of Object.values(material)) if (value?.isTexture) this.texture(value); this.capture(material, this.materials); }
  url(url) { if (this.disposed) URL.revokeObjectURL(url); else this.urls.add(url); }
  tree(root) { root.traverse((node) => { if (node.geometry) this.capture(node.geometry, this.geometries); for (const material of Array.isArray(node.material) ? node.material : [node.material]) this.material(material); }); }
  plugin(parser) {
    return { name: 'TAYLORS3D_FURNITURE_OWNER', beforeRoot: () => {
      const original = parser.loadGeometries;
      parser.loadGeometries = (...args) => { const result = original.apply(parser, args);
        for (const entry of Object.values(parser.primitiveCache)) entry.promise.then((geometry) => this.capture(geometry, this.geometries), () => {}); return result; };
    }, loadMaterial: (index) => parser.loadMaterial(index).then((material) => { this.material(material); return material; }),
    loadTexture: (index) => parser.loadTexture(index).then((texture) => { requireValue(texture?.isTexture); this.texture(texture); return texture; }),
    loadMesh: (index) => parser.loadMesh(index).then((mesh) => { this.tree(mesh); return mesh; }), afterRoot: (result) => { this.tree(result.scene); } };
  }
  releaseUrls() { for (const url of this.urls) URL.revokeObjectURL(url); this.urls.clear(); }
  dispose() { if (this.disposed) return; this.disposed = true; this.releaseUrls();
    for (const resource of [...this.geometries, ...this.materials, ...this.textures]) resource.dispose(); for (const image of this.images) image.close(); }
}

/** Static scene/cache owner. Root must call setData on HA lifecycle/context,
 * floor visibility and presentation changes. revalidate() plus library.generation
 * protects async work through session loss/recovery. It never owns the client.
 */
export class FurnitureLayer {
  constructor(view, { library, onInvalidate } = {}) {
    this.view = view; this.library = library; this.onInvalidate = typeof onInvalidate === 'function' ? onInvalidate : () => view.markDirty?.();
    this.group = new THREE.Group(); this.group.name = 'taylors3d-furniture'; this.group.userData.furniture = true; view.scene.add(this.group);
    this.parts = new Map(); this._cache = new Map(); this._inflight = new Map(); this._queue = []; this._running = 0; this._parses = 0;
    this._generation = 0; this._sessionGeneration = null; this._disposed = false; this._key = null; this._contextKey = undefined;
    this._rows = []; this._diagnostics = []; this._valid = true; this._enabled = false; this._errors = new Map(); this._reservedBytes = 0; this._reservedPixels = 0;
    this._waiters = new Set(); this._clock = 0; this._raycaster = new THREE.Raycaster(); this._pointer = new THREE.Vector2();
  }
  _session() {
    try { const ready = this.library?.revalidate?.() === true, generation = this.library?.generation;
      return { ready: ready && integer(generation, 0, Number.MAX_SAFE_INTEGER), generation }; } catch { return { ready: false, generation: null }; }
  }
  _clearParts() { if (!this.parts.size) return false; for (const part of this.parts.values()) part.group.removeFromParent(); this.parts.clear(); return true; }
  _release(sha) { const entry = this._cache.get(sha); if (entry) { entry.owner.dispose(); this._cache.delete(sha); } }
  _cancelWork() { this._generation++; for (const task of this._queue.splice(0)) task.resolve(null); this._inflight.clear(); }
  _revoke(session) {
    this._cancelWork(); const changed = this._clearParts(); for (const sha of [...this._cache.keys()]) this._release(sha);
    this._sessionGeneration = session.generation; this._key = null; this._errors.clear(); this._diagnostics = [diagnostic('session', messages.session)]; this._enabled = false;
    if (changed) this.onInvalidate(); this._notifyReady();
  }
  _current(task) {
    if (this._disposed) return false; const session = this._session();
    if (!session.ready || session.generation !== this._sessionGeneration) { this._revoke(session); return false; }
    return task.generation === this._generation && task.sessionGeneration === session.generation;
  }
  setData({ raw, floors, catalogue, enabled = true, contextKey } = {}) {
    if (this._disposed) return this.report(); const session = this._session();
    if (this._sessionGeneration !== session.generation || !session.ready) this._revoke(session);
    const resolved = resolveFurniturePlacement(raw, { floors, catalogue }); this._valid = resolved.valid;
    const diagnostics = [...resolved.diagnostics], rows = [], assets = new Map(); let triangles = 0, pixels = 0;
    for (const row of resolved.rows) {
      const next = { id: row.instance.id, instance: clone(row.instance), floorId: row.instance.floor_id,
        sourceWorld: row.sourceWorld?.slice() || null, displayWorld: null, item: row.item ? clone(row.item) : null,
        rotation: row.rotationRadians, ready: row.ready, diagnostics: clone(row.diagnostics), shown: false };
      if (next.ready) try {
        next.assetKey = metadata(next.item); const prior = assets.get(next.item.sha256);
        requireValue(!prior || prior.assetKey === next.assetKey, 'corrupt');
        const cached = this._cache.get(next.item.sha256); requireValue(!cached || cached.assetKey === next.assetKey, 'corrupt');
        const display = typeof this.view.sourceWorldToDisplay === 'function' ? this.view.sourceWorldToDisplay(next.sourceWorld.slice(), next.floorId) : { ok: true, point: next.sourceWorld };
        requireValue(display?.ok === true && vec(display.point, 3, 2e6), 'mapping'); next.displayWorld = display.point.slice();
        next.shown = typeof this.view._shows === 'function' ? this.view._shows(next.floorId) : this.view.visibleFloor === undefined || this.view.visibleFloor === 'all' || this.view.visibleFloor === next.floorId;
        requireValue(typeof next.shown === 'boolean', 'mapping');
        triangles += next.item.stats.triangles; if (!prior) { assets.set(next.item.sha256, next); pixels += next.item.stats.texture_pixels; }
      } catch (error) { next.ready = false; next.diagnostics.push(diagnostic(error instanceof FurnitureError ? error.code : 'metadata', messages[error.code] || messages.metadata, next.id)); }
      rows.push(next);
    }
    if (enabled !== true && enabled !== false) { this._valid = false; diagnostics.push(diagnostic('disabled', 'Furniture eligibility must be explicitly true or false.')); }
    if (triangles > FURNITURE_RENDERING_LIMITS.triangles || pixels > FURNITURE_RENDERING_LIMITS.texturePixels) { this._valid = false; diagnostics.push(diagnostic('budget', messages.budget)); }
    if (!session.ready && rows.length) diagnostics.push(diagnostic('session', messages.session));
    const active = enabled === true && session.ready && this._valid;
    const key = JSON.stringify([active, rows.map((row) => [row.id, row.ready, row.instance, row.item?.sha256, row.assetKey, row.item?.anchor,
      row.sourceWorld, row.displayWorld, row.shown]), diagnostics]);
    if (key === this._key && Object.is(contextKey, this._contextKey)) return this.report();
    this._cancelWork(); this._key = key; this._contextKey = contextKey; this._rows = rows; this._diagnostics = diagnostics; this._enabled = active; this._errors.clear();
    // Membership revocation releases even retained cache entries. Exact known
    // unselected assets otherwise stay cached until bounded LRU eviction/disposal.
    const published = new Set((Array.isArray(catalogue?.packs) ? catalogue.packs : []).flatMap((pack) => Array.isArray(pack?.items) ? pack.items.map((item) => item?.sha256) : []));
    for (const sha of [...this._cache.keys()]) if (!published.has(sha)) this._release(sha);
    if (active) for (const row of assets.values()) if (!this._cache.has(row.item.sha256)) this._enqueue(row);
    this._render(); this._drain(); this._notifyReady(); return this.report();
  }
  _enqueue(row) {
    let resolve; const promise = new Promise((done) => { resolve = done; });
    const task = { row, promise, resolve, generation: this._generation, sessionGeneration: this._sessionGeneration, bytes: 0, pixels: 0 };
    this._inflight.set(row.item.sha256, task); this._queue.push(task);
  }
  _drain() { while (!this._disposed && this._running < FURNITURE_RENDERING_LIMITS.parses && this._queue.length) {
    const task = this._queue.shift(); this._running++; this._load(task).finally(() => { this._running--; this._drain(); });
  } }
  _reserve(task, bytes, pixels) {
    const requested = new Set(this._rows.filter((row) => row.ready).map((row) => row.item.sha256));
    const totals = () => ({ bytes: this._reservedBytes + [...this._cache.values()].reduce((sum, entry) => sum + entry.bytes, 0),
      pixels: this._reservedPixels + [...this._cache.values()].reduce((sum, entry) => sum + entry.pixels, 0) });
    for (const [sha] of [...this._cache].sort((a, b) => a[1].used - b[1].used)) {
      const sum = totals(); if (sum.bytes + bytes <= FURNITURE_RENDERING_LIMITS.assetBytes && sum.pixels + pixels <= FURNITURE_RENDERING_LIMITS.texturePixels
        && this._cache.size < FURNITURE_RENDERING_LIMITS.cachedAssets) break;
      if (!requested.has(sha)) this._release(sha);
    }
    const sum = totals(); requireValue(sum.bytes + bytes <= FURNITURE_RENDERING_LIMITS.assetBytes && sum.pixels + pixels <= FURNITURE_RENDERING_LIMITS.texturePixels
      && this._cache.size + this._parses < FURNITURE_RENDERING_LIMITS.cachedAssets, 'budget');
    task.bytes = bytes; task.pixels = pixels; this._reservedBytes += bytes; this._reservedPixels += pixels;
  }
  async _load(task) {
    let owner, entry;
    try {
      if (!this._current(task)) return; const response = await this.library.asset(task.row.item); if (!this._current(task)) return;
      requireValue(response?.ok === true && response.verified === true && response.sha256 === task.row.item.sha256
        && response.bytes instanceof Uint8Array && integer(response.bytes.length, 20, FURNITURE_RENDERING_LIMITS.asset), 'identity');
      const bytes = response.bytes.slice(); requireValue(await sha256(bytes) === task.row.item.sha256, 'corrupt'); if (!this._current(task)) return;
      const info = inspectGlb(bytes), stats = task.row.item.stats;
      for (const [key, value] of Object.entries({ nodes: info.nodes, meshes: info.meshes, mesh_uses: info.meshUses, primitives: info.primitives,
        triangles: info.triangles, source_triangles: info.sourceTriangles, materials: info.materials, textures: info.textures })) requireValue(stats[key] === value, 'corrupt');
      requireValue(info.images.length === stats.images.length && info.images.every((image, index) => image.width === stats.images[index].width
        && image.height === stats.images[index].height && image.mime_type === stats.images[index].mime_type), 'corrupt');
      this._reserve(task, bytes.length, stats.texture_pixels);
      owner = new Resources(); const manager = new THREE.LoadingManager();
      // Three revokes embedded-image Blob URLs on success, but not on failed
      // decoding. Remember only URLs created by this bounded embedded parse;
      // repeat revocation after success is harmless and avoids global hooks.
      const resources = owner;
      manager.setURLModifier((url) => { requireValue(typeof url === 'string' && url.startsWith('blob:')); resources.url(url); return url; });
      const loader = new GLTFLoader(manager); loader.register((parser) => resources.plugin(parser));
      this._parses++; let parsed; try { parsed = await loader.parseAsync(bytes.buffer, ''); } finally { this._parses--; resources.releaseUrls(); }
      if (!this._current(task)) return;
      requireValue(parsed.scene?.isObject3D && parsed.scenes.length === 1 && !parsed.animations.length && !parsed.cameras.length);
      let count = 0; parsed.scene.updateMatrixWorld(true);
      parsed.scene.traverse((node) => {
        requireValue(!node.isLight && !node.isCamera && !node.isSkinnedMesh && !node.isBone && !node.isInstancedMesh && !node.morphTargetInfluences?.length
          && node.matrixWorld.elements.every(finite));
        if (!node.isMesh) return; const geometry = node.geometry, position = geometry.attributes.position;
        requireValue(position?.itemSize === 3 && position.count > 0); count += (geometry.index?.count ?? position.count) / 3;
        if (geometry.index) for (let i = 0; i < geometry.index.count; i++) requireValue(integer(geometry.index.getX(i), 0, position.count - 1));
      });
      requireValue(count === stats.triangles, 'corrupt'); const bounds = new THREE.Box3().setFromObject(parsed.scene);
      requireValue(!bounds.isEmpty() && [...bounds.min.toArray(), ...bounds.max.toArray()].every((v) => finite(v) && Math.abs(v) <= 1e6));
      entry = { root: parsed.scene, owner, bytes: bytes.length, pixels: stats.texture_pixels, triangles: count, assetKey: task.row.assetKey, used: ++this._clock };
      this._cache.set(task.row.item.sha256, entry); owner = null;
    } catch (error) {
      if (this._current(task)) { const code = error instanceof FurnitureError ? error.code : 'loading'; this._errors.set(task.row.item.sha256, diagnostic(code, messages[code], task.row.id));
        if (code === 'budget') this._valid = false; }
    } finally {
      owner?.dispose(); this._reservedBytes -= task.bytes; this._reservedPixels -= task.pixels;
      if (this._inflight.get(task.row.item.sha256) === task) this._inflight.delete(task.row.item.sha256);
      task.resolve(entry || null); if (this._current(task)) this._render(); this._notifyReady();
    }
  }
  _render() {
    let changed = false; const wanted = new Set();
    // Wait for this current asset batch; render valid partial results only with
    // explicit missing-asset diagnostics, and never a fabricated placeholder.
    if (this._enabled && this._valid && !this._inflight.size) for (const row of this._rows) {
      const asset = row.ready && this._cache.get(row.item.sha256); if (!asset || this._errors.has(row.item.sha256)) continue;
      wanted.add(row.id); let part = this.parts.get(row.id);
      if (part && part.sha !== row.item.sha256) { part.group.removeFromParent(); this.parts.delete(row.id); part = null; changed = true; }
      if (!part) {
        const group = new THREE.Group(), offset = new THREE.Group(), model = asset.root.clone(true); group.userData.furnitureId = row.id;
        offset.add(model); group.add(offset); this.group.add(group); part = { group, offset, model, sha: row.item.sha256 }; this.parts.set(row.id, part); changed = true;
      }
      const key = JSON.stringify([row.displayWorld, row.item.anchor, row.rotation, row.instance.scale, row.shown]);
      if (part.key !== key) { part.group.position.fromArray(row.displayWorld); part.group.rotation.set(0, row.rotation, 0); part.group.scale.setScalar(row.instance.scale);
        part.offset.position.fromArray(row.item.anchor).multiplyScalar(-1); part.group.visible = row.shown; part.group.updateMatrixWorld(true); part.key = key; changed = true; }
      part.row = row; asset.used = ++this._clock;
    }
    for (const [id, part] of this.parts) if (!wanted.has(id)) { part.group.removeFromParent(); this.parts.delete(id); changed = true; }
    if (changed) this.onInvalidate();
  }
  report() {
    const rows = this._rows.map((row) => { const error = row.item && this._errors.get(row.item.sha256), pending = row.item && this._inflight.has(row.item.sha256);
      const ready = !!this.parts.get(row.id); return { id: row.id, floorId: row.floorId, label: row.item?.name || row.id,
        status: this._disposed ? 'disposed' : !this._enabled ? 'disabled' : error || !row.ready ? 'unavailable' : pending ? 'pending' : ready ? 'ready' : 'unavailable',
        ready, shown: ready && this.parts.get(row.id).group.visible, sourceWorld: row.sourceWorld?.slice() || null, displayWorld: row.displayWorld?.slice() || null,
        diagnostics: [...clone(row.diagnostics), ...(error ? [clone(error)] : [])] }; });
    return { valid: this._valid, ready: !this._disposed && this._valid && !this._inflight.size && rows.every((row) => row.ready),
      pending: this._inflight.size, rows, diagnostics: [...clone(this._diagnostics), ...rows.flatMap((row) => row.diagnostics)],
      budgets: { instances: this.parts.size, triangles: [...this.parts.values()].reduce((sum, part) => sum + this._cache.get(part.sha).triangles, 0),
        assetBytes: [...this._cache.values()].reduce((sum, entry) => sum + entry.bytes, 0), texturePixels: [...this._cache.values()].reduce((sum, entry) => sum + entry.pixels, 0),
        cachedAssets: this._cache.size, parsesActive: this._parses } };
  }
  whenReady() { if (!this._inflight.size || this._disposed) return Promise.resolve(this.report()); return new Promise((resolve) => this._waiters.add(resolve)); }
  _notifyReady() { if (this._inflight.size && !this._disposed) return; const report = this.report(); for (const resolve of this._waiters) resolve(clone(report)); this._waiters.clear(); }
  anchorOf(id) { const row = this.parts.get(id)?.row; return row ? new THREE.Vector3(...row.sourceWorld) : null; }
  displayAnchorOf(id) { const row = this.parts.get(id)?.row; return row ? new THREE.Vector3(...row.displayWorld) : null; }
  anchors() { return [...this.parts].map(([id]) => ({ id, floorId: this.parts.get(id).row.floorId, world: this.anchorOf(id) })); }
  displayAnchors() { return [...this.parts].map(([id]) => ({ id, floorId: this.parts.get(id).row.floorId, world: this.displayAnchorOf(id) })); }
  hitTest(clientX, clientY) {
    if (this._disposed || !this._enabled || !finite(clientX) || !finite(clientY)) return null;
    const rect = this.view.renderer?.domElement?.getBoundingClientRect?.(), camera = this.view.camera;
    if (!rect || !camera?.isCamera || ![rect.left, rect.top, rect.width, rect.height].every(finite) || rect.width <= 0 || rect.height <= 0
      || clientX < rect.left || clientY < rect.top || clientX > rect.left + rect.width || clientY > rect.top + rect.height) return null;
    this._pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.group.updateMatrixWorld(true); camera.updateMatrixWorld(true); this._raycaster.setFromCamera(this._pointer, camera);
    const groups = [...this.parts.values()].filter((part) => part.group.visible).map((part) => part.group);
    for (const hit of this._raycaster.intersectObjects(groups, true)) {
      const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex ?? 0] : hit.object.material;
      let shown = true; for (let parent = hit.object; parent && parent !== this.group; parent = parent.parent) if (!parent.visible) shown = false;
      if (!shown || !material || material.visible === false || material.opacity <= 0 || this.view._cutAway?.(hit.point)
        || this.view.pointHidden?.(hit.point)) continue; let node = hit.object;
      while (node && node.parent !== this.group) node = node.parent;
      const part = node && this.parts.get(node.userData.furnitureId); if (!part || part.group !== node) continue;
      const source = typeof this.view.displayWorldToSource === 'function' ? this.view.displayWorldToSource(hit.point.toArray(), part.row.floorId) : { ok: true, point: hit.point.toArray() };
      if (!source?.ok || !vec(source.point, 3, 2e6)) continue;
      return { id: part.row.id, floorId: part.row.floorId, packId: part.row.item.pack_id, itemId: part.row.item.id, assetSha256: part.sha,
        sourcePoint: source.point.slice(), displayPoint: hit.point.toArray(), distance: hit.distance, materialIndex: hit.face?.materialIndex ?? 0 };
    }
    return null;
  }
  dispose() { if (this._disposed) return; this._disposed = true; this._cancelWork(); const changed = this._clearParts();
    for (const sha of [...this._cache.keys()]) this._release(sha); this.group.removeFromParent(); if (changed) this.onInvalidate(); this._notifyReady(); }
}
