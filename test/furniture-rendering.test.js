import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FurnitureLayer, FURNITURE_RENDERING_LIMITS as LIMITS } from '../src/furniture-rendering.js';
import { FurnitureLibraryClient } from '../src/furniture-library.js';
import { FloorplanView as View } from '../src/view.js';

// Actual original GLBs, genuine native Fetch/WebCrypto and the pinned GLTFLoader.
// Only Home Assistant's network transport is simulated; parser output is real.
const BASE = '/api/taylors3d/furniture', MiB = 1024 * 1024;
const utf8 = (value) => new TextEncoder().encode(value), hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const copy = (value) => structuredClone(value), jsonResponse = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const binaryResponse = (bytes) => new Response(bytes, { headers: { 'content-type': 'model/gltf-binary' } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function asset({ name = 'Original furniture', triangles = 1, unlit = false, anchor = [0, 0, 0], translate = [0, 0, 0], size, image,
  imageMime = 'image/png', unusedImage = false, imageReport, change } = {}) {
  let binary = new Uint8Array(36 + (triangles > 1 ? triangles * 6 : 0)), view = new DataView(binary.buffer);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => view.setFloat32(index * 4, value, true));
  if (triangles > 1) for (let i = 0; i < triangles * 3; i++) view.setUint16(36 + i * 2, i % 3, true);
  const definition = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0, translation: translate }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, ...(triangles > 1 ? { indices: 1 } : {}) }] }],
    materials: [{ name: 'Original material', pbrMetallicRoughness: { baseColorFactor: [0.7, 0.3, 0.1, 1], metallicFactor: 0, roughnessFactor: 0.8 },
      ...(unlit ? { extensions: { KHR_materials_unlit: {} } } : {}) }], buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteLength: 36 }, ...(triangles > 1 ? [{ buffer: 0, byteOffset: 36, byteLength: binary.length - 36 }] : [])],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      ...(triangles > 1 ? [{ bufferView: 1, componentType: 5123, count: triangles * 3, type: 'SCALAR' }] : [])],
    ...(unlit ? { extensionsUsed: ['KHR_materials_unlit'] } : {}) };
  if (image) { const start = binary.length, expanded = new Uint8Array(start + image.length); expanded.set(binary); expanded.set(image, start); binary = expanded;
    definition.buffers[0].byteLength = binary.length; definition.images = [{ mimeType: imageMime, bufferView: definition.bufferViews.length }];
    definition.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: image.length });
    if (!unusedImage) { definition.textures = [{ source: 0 }]; definition.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 }; }
  }
  change?.(definition, binary);
  let encoded;
  // Optional exact original asset-byte size, including its real GLB headers.
  for (let pass = 0; pass < 5; pass++) {
    const bytes = utf8(JSON.stringify(definition)); encoded = new Uint8Array(Math.ceil(bytes.length / 4) * 4); encoded.fill(32); encoded.set(bytes);
    if (!size || binary.length === size - 28 - encoded.length) break;
    const expanded = new Uint8Array(size - 28 - encoded.length); expanded.set(binary.subarray(0, expanded.length)); binary = expanded;
    definition.buffers[0].byteLength = binary.length;
  }
  const padded = Math.ceil(binary.length / 4) * 4, bytes = new Uint8Array(28 + encoded.length + padded), header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, bytes.length, true);
  header.setUint32(12, encoded.length, true); header.setUint32(16, 0x4e4f534a, true); bytes.set(encoded, 20);
  const start = encoded.length + 20; header.setUint32(start, padded, true); header.setUint32(start + 4, 0x004e4942, true); bytes.set(binary, start + 8);
  const reported = image ? imageReport || { width: new DataView(image.buffer, image.byteOffset, image.byteLength).getUint32(16),
    height: new DataView(image.buffer, image.byteOffset, image.byteLength).getUint32(20), mime_type: imageMime } : null;
  return { bytes, sha256: hash(bytes), anchor, stats: { nodes: definition.nodes.length, meshes: definition.meshes.length, mesh_uses: 1,
    primitives: 1, triangles, source_triangles: triangles, materials: definition.materials.length, textures: definition.textures?.length || 0,
    images: reported ? [reported] : [], texture_pixels: reported ? reported.width * reported.height : 0 } };
}
function published(assets = [asset()]) {
  const license = { id: 'MIT', file: 'LICENSE.txt', text: 'MIT original test furniture credit.\n', sha256: hash(utf8('MIT original test furniture credit.\n')) };
  const packId = hash(utf8(assets.map((entry) => entry.sha256).join(','))), items = assets.map((entry, index) => ({ id: `item-${index}`, name: `Original item ${index}`,
    file: `item-${index}.glb`, unit: 'm', anchor: entry.anchor.slice(), extension_data: { kept: true } }));
  const manifest = { version: 1, id: 'original-fixtures', name: 'Original furniture test fixtures', author: 'Test author', license: { id: 'MIT', file: 'LICENSE.txt' }, items };
  const assetBytes = assets.reduce((sum, entry) => sum + entry.bytes.length, 0), expandedBytes = assetBytes + utf8(JSON.stringify(manifest)).length + utf8(license.text).length;
  const pack = { pack_id: packId, logical_sha256: hash(utf8(JSON.stringify(manifest))), archive_bytes: expandedBytes + 600,
    manifest, license, licenses: { 'LICENSE.txt': license }, download_url: `${BASE}/packs/${packId}.zip`,
    items: items.map((item, index) => ({ ...copy(item), metadata: copy(item), license: copy(license), pack_id: packId, sha256: assets[index].sha256,
      asset_url: `${BASE}/assets/${assets[index].sha256}.glb`, stats: copy(assets[index].stats) })),
    stats: { archive_bytes: expandedBytes + 600, expanded_bytes: expandedBytes, members: assets.length + 2, items: assets.length, unique_assets: assets.length,
      asset_bytes: assetBytes, triangles: assets.reduce((sum, entry) => sum + entry.stats.triangles, 0), texture_pixels: assets.reduce((sum, entry) => sum + entry.stats.texture_pixels, 0) } };
  return { catalogue: { version: 1, packs: [pack], extensions: { untouched: 'licence and source metadata' } }, pack, assets };
}
const owners = [];
async function harness(fixture = published()) {
  vi.stubGlobal('crypto', webcrypto);
  const connection = Object.assign(new EventTarget(), { connected: true }), user = { id: 'actual-user', is_active: true, is_admin: true };
  const byUrl = new Map(fixture.assets.map((entry) => [`${BASE}/assets/${entry.sha256}.glb`, entry.bytes]));
  const fetch = vi.fn(async (url) => url === BASE ? jsonResponse(fixture.catalogue) : byUrl.has(url) ? binaryResponse(byUrl.get(url)) : new Response('', { status: 404 }));
  const h = { current: { user, connection, fetchWithAuth: fetch, callService: vi.fn() }, connection, user, fetch, byUrl, fixture, sessionHook: null };
  const library = new FurnitureLibraryClient({ getHass: () => { h.sessionHook?.(); return h.current; } });
  const catalogue = await library.catalogue(); expect(catalogue.ok).toBe(true); fetch.mockClear();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100), onInvalidate = vi.fn();
  const view = { scene, camera, renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) } },
    visibleFloor: 'all', markDirty: vi.fn(), sourceWorldToDisplay: vi.fn((point) => ({ ok: true, point: point.slice() })),
    displayWorldToSource: vi.fn((point) => ({ ok: true, point: point.slice() })), _shows: () => true };
  const layer = new FurnitureLayer(view, { library, onInvalidate }); owners.push({ layer, library });
  const floor = { id: 'ground', elevation: 0 }, instance = (id = 'one', assetIndex = 0, changes = {}) => ({ id, pack_id: fixture.pack.pack_id,
    item_id: `item-${assetIndex}`, asset_sha256: fixture.pack.items[assetIndex].sha256, floor_id: floor.id, x: 0, y: 0, ...changes });
  const data = (instances = [instance()], changes = {}) => ({ raw: { version: 1, instances }, floors: [floor], catalogue: catalogue.catalogue, contextKey: 'same-layout', ...changes });
  Object.assign(h, { library, catalogue: catalogue.catalogue, view, layer, floor, instance, data, onInvalidate }); return h;
}
const codes = (report) => report.diagnostics.map((entry) => entry.code);
const mesh = (part) => { let found; part.model.traverse((node) => { if (node.isMesh && !found) found = node; }); return found; };
afterEach(() => { for (const { layer, library } of owners.splice(0)) { layer.dispose(); library.dispose(); } vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('static furniture actual GLB/cache ownership', () => {
  it.each([false, true])('parses actual PBR/unlit=%s models and shares one owned geometry/material across exact instances', async (unlit) => {
    const h = await harness(published([asset({ unlit })])), parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    const raw = h.data([h.instance('one'), h.instance('two', 0, { x: 2 })]), before = copy(raw);
    expect(h.layer.setData(raw).pending).toBe(1); const result = await h.layer.whenReady();
    expect(result).toMatchObject({ valid: true, ready: true, pending: 0, diagnostics: [], budgets: { instances: 2, triangles: 2, cachedAssets: 1, texturePixels: 0 } });
    expect(parse).toHaveBeenCalledTimes(1); expect(h.fetch.mock.calls.map(([url]) => url)).toEqual([h.fixture.pack.items[0].asset_url]);
    const one = mesh(h.layer.parts.get('one')), two = mesh(h.layer.parts.get('two'));
    expect(one.geometry).toBe(two.geometry); expect(one.material).toBe(two.material); expect(one.material[unlit ? 'isMeshBasicMaterial' : 'isMeshStandardMaterial']).toBe(true);
    expect(h.layer.group.parent).toBe(h.view.scene); expect(raw).toEqual(before); expect(h.current.callService).not.toHaveBeenCalled();
  });
  it('subtracts original file-local anchor before scale/CCW rotation and maps exact source to display once', async () => {
    const h = await harness(published([asset({ anchor: [0.5, 1, -0.25], translate: [2, 3, 4] })]));
    h.floor.elevation = 4; const offset = new THREE.Vector3(7, -4, -3);
    h.view.sourceWorldToDisplay.mockImplementation((point, floor) => ({ ok: floor === 'ground', point: new THREE.Vector3(...point).add(offset).toArray() }));
    h.layer.setData(h.data([h.instance('one', 0, { x: 3, y: 2, z: 0.75, scale: 1.5, rotation_degrees: 90 })])); await h.layer.whenReady();
    const part = h.layer.parts.get('one'), actual = mesh(part).localToWorld(new THREE.Vector3(1, 0, 0));
    const expected = new THREE.Vector3(3, 3, 4).sub(new THREE.Vector3(0.5, 1, -0.25)).multiplyScalar(1.5)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).add(new THREE.Vector3(3, 4.75, -2)).add(offset);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-12); expect(h.layer.anchorOf('one').toArray()).toEqual([3, 4.75, -2]);
    expect(h.layer.displayAnchorOf('one').toArray()).toEqual([10, 0.75, -5]); expect(h.view.sourceWorldToDisplay).toHaveBeenCalledTimes(1);
    h.layer.anchorOf('one').set(100, 100, 100); expect(h.layer.anchorOf('one').toArray()).toEqual([3, 4.75, -2]);
    expect(part.group.parent).toBe(h.layer.group); expect(h.floor.elevation).toBe(4);
  });
  it('equal newly cloned settings and unrelated HA updates produce zero scene/resource/pose writes', async () => {
    const h = await harness(), parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync'), settings = h.data();
    h.layer.setData(settings); await h.layer.whenReady(); const part = h.layer.parts.get('one'), originalMesh = mesh(part);
    const position = vi.spyOn(part.group.position, 'fromArray'), rotation = vi.spyOn(part.group.rotation, 'set'), scale = vi.spyOn(part.group.scale, 'setScalar');
    const cloneGeometry = vi.spyOn(originalMesh.geometry, 'clone'), cloneMaterial = vi.spyOn(originalMesh.material, 'clone');
    h.onInvalidate.mockClear(); h.current = { ...h.current, states: { 'sensor.unrelated': { state: '123' } } }; h.library.revalidate();
    h.layer.setData(copy(settings)); await h.layer.whenReady();
    expect(h.layer.parts.get('one')).toBe(part); expect(h.onInvalidate).not.toHaveBeenCalled(); expect(position).not.toHaveBeenCalled(); expect(rotation).not.toHaveBeenCalled();
    expect(scale).not.toHaveBeenCalled(); expect(cloneGeometry).not.toHaveBeenCalled(); expect(cloneMaterial).not.toHaveBeenCalled(); expect(parse).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.view.markDirty).not.toHaveBeenCalled(); expect(h.current.callService).not.toHaveBeenCalled();
  });
  it('valid statistics key reordering keeps exact cached asset identity and zero redraws', async () => {
    const h = await harness(); h.layer.setData(h.data()); await h.layer.whenReady(); const part = h.layer.parts.get('one'), data = h.data();
    const stats = data.catalogue.packs[0].items[0].stats; data.catalogue.packs[0].items[0].stats = Object.fromEntries(Object.entries(stats).reverse());
    h.onInvalidate.mockClear(); h.layer.setData(data); expect(h.layer.report().ready).toBe(true); expect(h.layer.parts.get('one')).toBe(part);
    expect(h.layer.report().diagnostics).toEqual([]); expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.onInvalidate).not.toHaveBeenCalled();
  });
  it('moves/changes visibility with stable cached model and restores retained cached instances without reloading', async () => {
    const h = await harness(); h.layer.setData(h.data()); await h.layer.whenReady(); const original = mesh(h.layer.parts.get('one'));
    h.onInvalidate.mockClear(); h.layer.setData(h.data([h.instance('one', 0, { x: 5 })]));
    expect(h.onInvalidate).toHaveBeenCalledTimes(1); expect(mesh(h.layer.parts.get('one')).geometry).toBe(original.geometry);
    h.view._shows = () => false; h.onInvalidate.mockClear(); h.layer.setData(h.data([h.instance('one', 0, { x: 5 })]));
    expect(h.layer.report().rows[0]).toMatchObject({ ready: true, shown: false }); expect(h.onInvalidate).toHaveBeenCalledTimes(1);
    h.layer.setData(h.data([])); expect(h.layer.report().budgets).toMatchObject({ instances: 0, cachedAssets: 1 }); h.view._shows = () => true;
    h.layer.setData(h.data()); expect(h.layer.report().ready).toBe(true); expect(mesh(h.layer.parts.get('one')).material).toBe(original.material); expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('disposes owned shared resources exactly once while leaving house resources and library alive', async () => {
    const h = await harness(), house = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); h.view.scene.add(house);
    const houseGeometry = vi.spyOn(house.geometry, 'dispose'), houseMaterial = vi.spyOn(house.material, 'dispose');
    h.layer.setData(h.data([h.instance('one'), h.instance('two')])); await h.layer.whenReady();
    const source = mesh(h.layer.parts.get('one')), geometry = vi.spyOn(source.geometry, 'dispose'), material = vi.spyOn(source.material, 'dispose');
    h.layer.setData(h.data([])); expect(geometry).not.toHaveBeenCalled(); h.layer.dispose(); h.layer.dispose();
    expect(geometry).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1); expect(houseGeometry).not.toHaveBeenCalled(); expect(houseMaterial).not.toHaveBeenCalled();
    expect(house.parent).toBe(h.view.scene); expect(h.layer.group.parent).toBeNull(); expect(h.library.revalidate()).toBe(true); expect(h.layer.setData(h.data()).rows).toEqual([]);
    house.geometry.dispose(); house.material.dispose();
  });
  it('preserves harmless extras and resolves hit identity from owned wrapper rather than authored userData', async () => {
    const h = await harness(published([asset({ change: (json) => { json.nodes[0].extras = { furnitureId: 'spoofed', extensions: { CUSTOM_NOTE: 'plain metadata' } }; } })]));
    h.layer.setData(h.data()); await h.layer.whenReady(); expect(h.layer.report().ready).toBe(true);
    h.view.camera.position.set(0.2, 0.2, 5); h.view.camera.lookAt(0.2, 0.2, 0); h.view.camera.updateProjectionMatrix();
    expect(h.layer.hitTest(100, 100)).toMatchObject({ id: 'one', floorId: 'ground', sourcePoint: [0.2, 0.2, 0], displayPoint: [0.2, 0.2, 0] });
    expect(h.view.displayWorldToSource).toHaveBeenCalledTimes(1); expect(h.layer.hitTest(-1, 100)).toBeNull(); expect(h.layer.hitTest(100, Infinity)).toBeNull();
    h.view._cutAway = () => true; expect(h.layer.hitTest(100, 100)).toBeNull();
  });
  it('uses actual View house occlusion and authored alpha rather than picking an invisible chair', async () => {
    const h = await harness(); h.layer.setData(h.data()); await h.layer.whenReady(); h.view.camera.position.set(0.2, 0.2, 5); h.view.camera.lookAt(0.2, 0.2, 0);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial()), root = new THREE.Group(); wall.position.set(0.2, 0.2, 2); root.add(wall); h.view.scene.add(root);
    Object.assign(h.view, { model: { root, opacity: 1 }, modelGroup: root, modelClip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 100),
      pointHidden: View.prototype.pointHidden, _occluders: View.prototype._occluders, _modelIntersectionShown: View.prototype._modelIntersectionShown, _cutAway: () => false });
    expect(h.layer.hitTest(100, 100)).toBeNull(); wall.visible = false; expect(h.layer.hitTest(100, 100)?.id).toBe('one');
    wall.visible = true; wall.material.transparent = true; wall.material.opacity = 0.2; expect(h.layer.hitTest(100, 100)?.id).toBe('one');
    mesh(h.layer.parts.get('one')).material.opacity = 0; expect(h.layer.hitTest(100, 100)).toBeNull(); wall.geometry.dispose(); wall.material.dispose();
  });
  it('raycasts the actual active orthographic Top camera with split SOURCE coordinates and current Section clipping', async () => {
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2).toArray();
    const h = await harness(published([asset({ change: (json) => { json.nodes[0].rotation = rotation; } })]));
    h.floor.elevation = 4; const offset = new THREE.Vector3(7, -4, -3);
    h.view.sourceWorldToDisplay.mockImplementation((point, floor) => ({ ok: floor === 'ground', point: new THREE.Vector3(...point).add(offset).toArray() }));
    h.view.displayWorldToSource.mockImplementation((point, floor) => ({ ok: floor === 'ground', point: new THREE.Vector3(...point).sub(offset).toArray() }));
    h.layer.setData(h.data()); await h.layer.whenReady(); const part = h.layer.parts.get('one'), original = mesh(part);
    const perspective = h.view.camera; perspective.position.set(100, 10, 100); perspective.lookAt(100, 0, 100);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    ortho.position.set(7.2, 5, -3.2); ortho.up.set(0, 0, -1); ortho.lookAt(7.2, 0, -3.2); ortho.updateProjectionMatrix();
    Object.assign(h.view, { mode: '3d', persp: perspective, ortho, controls: { target: new THREE.Vector3(100, 0, 100) },
      getCamera: View.prototype.getCamera, _makeControls: vi.fn(), fit: vi.fn(), _cancelOcclusion: vi.fn(), _clearOcclusion: vi.fn(),
      _refreshWallPresentation: vi.fn(), _scheduleOcclusion: vi.fn(), _cutAway: View.prototype._cutAway });
    View.prototype.setMode.call(h.view, 'top');
    expect(h.view.camera).toBe(ortho); expect(h.view.getCamera()).toEqual({ position: [100, 10, 100], target: [100, 0, 100] });
    h.view.sectionClip = new THREE.Plane(new THREE.Vector3(1, 0, 0), -7.1); h.onInvalidate.mockClear();
    const hit = h.layer.hitTest(100, 100); expect(hit).toMatchObject({ id: 'one', floorId: 'ground' });
    expect(new THREE.Vector3(...hit.displayPoint).distanceTo(new THREE.Vector3(7.2, 0, -3.2))).toBeLessThan(1e-12);
    expect(new THREE.Vector3(...hit.sourcePoint).distanceTo(new THREE.Vector3(0.2, 4, -0.2))).toBeLessThan(1e-12);
    expect(h.view.displayWorldToSource).toHaveBeenLastCalledWith(hit.displayPoint, 'ground');
    h.view.sectionClip.constant = -7.3; expect(h.layer.hitTest(100, 100)).toBeNull();
    h.view.sectionClip = null; View.prototype.setMode.call(h.view, '3d'); expect(h.view.camera).toBe(perspective);
    expect(h.layer.hitTest(100, 100)).toBeNull(); View.prototype.setMode.call(h.view, 'top'); expect(h.layer.hitTest(100, 100)?.id).toBe('one');
    expect(h.layer.parts.get('one')).toBe(part); expect(mesh(part).geometry).toBe(original.geometry); expect(mesh(part).material).toBe(original.material);
    expect(h.onInvalidate).not.toHaveBeenCalled(); expect(h.current.callService).not.toHaveBeenCalled();
  });
  it('does not fall back to a stale perspective camera when the active View camera is unavailable', async () => {
    const h = await harness(); h.layer.setData(h.data()); await h.layer.whenReady();
    const old = h.view.camera; old.position.set(0.2, 0.2, 5); old.lookAt(0.2, 0.2, 0);
    h.view.persp = old; h.view.camera = null; h.view.getCamera = () => old;
    expect(h.layer.hitTest(100, 100)).toBeNull(); h.view.camera = old; expect(h.layer.hitTest(100, 100)?.id).toBe('one');
  });
});

describe('exact references and explicit rendering diagnostics', () => {
  it('default/disabled settings allocate no asset or material and do not invalidate the view', async () => {
    const h = await harness(); h.layer.setData({ floors: [h.floor], catalogue: h.catalogue });
    h.layer.setData(h.data([h.instance()], { enabled: false })); expect(h.layer.report().budgets).toMatchObject({ instances: 0, cachedAssets: 0 });
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.onInvalidate).not.toHaveBeenCalled(); expect(h.current.callService).not.toHaveBeenCalled();
  });
  it.each(['missing-floor', 'duplicate-floor', 'stale-floor', 'missing-pack', 'wrong-hash', 'malformed-catalogue'])('keeps %s unavailable without guessing any replacement', async (kind) => {
    const h = await harness(), data = h.data();
    if (kind === 'missing-floor') data.floors = [{ id: 'similar-floor', elevation: 0 }];
    if (kind === 'duplicate-floor') data.floors.push(copy(h.floor));
    if (kind === 'stale-floor') data.floors[0] = { ...h.floor, stale: true };
    if (kind === 'missing-pack') data.catalogue.packs = [];
    if (kind === 'wrong-hash') data.raw.instances[0].asset_sha256 = 'a'.repeat(64);
    if (kind === 'malformed-catalogue') data.catalogue = { version: 1, packs: {} };
    const before = copy(data); expect(() => h.layer.setData(data)).not.toThrow(); const report = await h.layer.whenReady();
    expect(report.ready).toBe(false); expect(report.rows[0].ready).toBe(false); expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.layer.parts.size).toBe(0); expect(data).toEqual(before);
  });
  it('renders only an exact valid row while reporting the missing row; malformed structure suppresses all', async () => {
    const h = await harness(); h.layer.setData(h.data([h.instance(), h.instance('missing', 0, { floor_id: 'deleted' })])); await h.layer.whenReady();
    expect(h.layer.report().ready).toBe(false); expect([...h.layer.parts.keys()]).toEqual(['one']); expect(codes(h.layer.report())).toContain('floor_unavailable');
    h.layer.setData(h.data([h.instance(), h.instance('malformed', 0, { scale: true })])); expect(h.layer.report().valid).toBe(false); expect(h.layer.parts.size).toBe(0);
  });
  it.each(['foreign-route', 'bad-stats', 'bad-anchor', 'failed-display-map'])('rejects %s without loading or inventing geometry', async (kind) => {
    const h = await harness(), data = h.data();
    if (kind === 'foreign-route') data.catalogue.packs[0].items[0].asset_url = 'https://foreign.invalid/model.glb?credential=never-log';
    if (kind === 'bad-stats') data.catalogue.packs[0].items[0].stats.triangles = 100001;
    if (kind === 'bad-anchor') data.catalogue.packs[0].items[0].anchor[0] = Infinity;
    if (kind === 'failed-display-map') h.view.sourceWorldToDisplay.mockReturnValue({ ok: false, point: [0, 0, 0] });
    h.layer.setData(data); const result = await h.layer.whenReady(); expect(result.ready).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
    expect(result.diagnostics.length).toBeGreaterThan(0); expect(JSON.stringify(result)).not.toContain('credential');
  });
  it('removing published membership releases cached resources without substituting identical geometry from another item', async () => {
    const h = await harness(); h.layer.setData(h.data()); await h.layer.whenReady(); const source = mesh(h.layer.parts.get('one')), dispose = vi.spyOn(source.geometry, 'dispose');
    h.layer.setData(h.data([], { catalogue: { version: 1, packs: [] } })); expect(dispose).toHaveBeenCalledTimes(1); expect(h.layer.report().budgets.cachedAssets).toBe(0);
  });
});

describe('bounded static GLB defence before genuine GLTFLoader', () => {
  it.each([0xc0, 0xc1, 0xc2])('accepts the backend-supported 8-bit JPEG SOF %s without guessing decoded pixels', async (frame) => {
    // Match the backend's bounded complete frame/scan fixture. It is deliberately
    // unused, so this verifies predecode compatibility plus the actual GLB parser,
    // not a claim that a browser decoder accepts this synthetic scan's pixels.
    const jpeg = new Uint8Array([255, 216, 255, frame, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 0, 255, 217]);
    const h = await harness(published([asset({ image: jpeg, imageMime: 'image/jpeg', unusedImage: true,
      imageReport: { width: 1, height: 1, mime_type: 'image/jpeg' } })])), parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    h.layer.setData(h.data()); expect((await h.layer.whenReady()).ready).toBe(true); expect(parse).toHaveBeenCalledTimes(1);
    expect(h.layer.report().budgets.texturePixels).toBe(1);
  });
  it.each([
    ['external buffer', (json) => { json.buffers[0].uri = 'https://foreign.invalid/private'; }],
    ['external image', (json) => { json.images = [{ uri: 'image.png', mimeType: 'image/png' }]; }],
    ['animation', (json) => { json.animations = [{ channels: [], samplers: [] }]; }],
    ['skin', (json) => { json.skins = [{ joints: [0] }]; }],
    ['camera', (json) => { json.cameras = [{ type: 'perspective' }]; }],
    ['camera node', (json) => { json.nodes[0].camera = 0; }],
    ['unhandled extension', (json) => { json.extensionsUsed = ['KHR_lights_punctual']; json.extensions = { KHR_lights_punctual: { lights: [] } }; }],
    ['undeclared extension', (json) => { json.nodes[0].extensions = { KHR_materials_unlit: {} }; }],
    ['morph target', (json) => { json.meshes[0].primitives[0].targets = [{ POSITION: 0 }]; }],
    ['morph weights', (json) => { json.nodes[0].weights = []; }],
    ['joint attribute', (json) => { json.meshes[0].primitives[0].attributes.JOINTS_0 = 0; }],
    ['nontriangle primitive', (json) => { json.meshes[0].primitives[0].mode = 1; }],
    ['huge count', (json) => { json.accessors[0].count = 300001; }],
    ['cyclic node', (json) => { json.nodes[0].children = [0]; }],
    ['nonfinite float', (_json, bytes) => { new DataView(bytes.buffer).setFloat32(0, NaN, true); }],
    ['invalid PBR colour', (json) => { json.materials[0].pbrMetallicRoughness.baseColorFactor = [true, 0, 0, 1]; }],
    ['renderer-overflow material', (json) => { json.materials[0].pbrMetallicRoughness.roughnessFactor = Number.MAX_VALUE; }],
    ['malformed material shape', (json) => { json.materials[0].pbrMetallicRoughness = 'invalid'; }],
    ['malformed alpha', (json) => { json.materials[0].alphaMode = 'unknown'; }],
  ])('rejects %s before parser allocation/resource requests', async (_label, change) => {
    const h = await harness(published([asset({ change })])), parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    h.layer.setData(h.data()); const result = await h.layer.whenReady(); expect(codes(result)).toContain('glb'); expect(result.ready).toBe(false);
    expect(parse).not.toHaveBeenCalled(); expect(h.fetch.mock.calls.map(([url]) => url)).toEqual([h.fixture.pack.items[0].asset_url]); expect(h.layer.parts.size).toBe(0);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('checks actual published counts rather than trusting valid-looking metadata', async () => {
    const f = published(); f.pack.items[0].stats.nodes = 2; const h = await harness(f), parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    h.layer.setData(h.data()); expect(codes(await h.layer.whenReady())).toContain('corrupt'); expect(parse).not.toHaveBeenCalled();
  });
  it('cleans real parser resources after a bounded but invalid triangle index fails validation', async () => {
    const f = published([asset({ triangles: 2, change: (_json, bytes) => { new DataView(bytes.buffer).setUint16(36, 7, true); } })]), h = await harness(f);
    const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync'), geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose'), materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    h.layer.setData(h.data()); const result = await h.layer.whenReady();
    expect(codes(result)).toContain('glb'); expect(parse).toHaveBeenCalledTimes(1); const actual = await parse.mock.results[0].value;
    let parsedMesh; actual.scene.traverse((node) => { if (node.isMesh) parsedMesh = node; });
    expect(h.layer.report().budgets.cachedAssets).toBe(0); expect(h.layer.parts.size).toBe(0); expect(parsedMesh.geometry.attributes.position.count).toBe(3);
    expect(geometryDispose.mock.contexts.filter((value) => value === parsedMesh.geometry)).toHaveLength(1);
    expect(materialDispose.mock.contexts.filter((value) => value === parsedMesh.material)).toHaveLength(1);
  });
  it('cleans real embedded Blob URLs and parse resources when the platform image decoder fails', async () => {
    // A genuine framed 1x1 PNG; the platform failure is deliberate. The real
    // GLTFLoader/ImageBitmapLoader still fetches its real native Blob URL.
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const h = await harness(published([asset({ image: png })])), created = vi.spyOn(URL, 'createObjectURL'), revoked = vi.spyOn(URL, 'revokeObjectURL');
    vi.stubGlobal('self', globalThis); const decode = vi.fn(async () => { throw new Error('platform decoder failed'); }); vi.stubGlobal('createImageBitmap', decode);
    const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync'), errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.layer.setData(h.data()); const result = await h.layer.whenReady(); expect(parse).toHaveBeenCalledTimes(1); expect(decode).toHaveBeenCalledTimes(1);
    expect(result.ready).toBe(false); expect(codes(result)).toContain('glb'); expect(h.layer.report().budgets.cachedAssets).toBe(0); expect(errors).toHaveBeenCalled();
    expect(created).toHaveBeenCalledTimes(1); const url = created.mock.results[0].value;
    expect(revoked.mock.calls.filter(([value]) => value === url)).toHaveLength(1); await expect(fetch(url)).rejects.toThrow();
  });
  it('checks actual embedded image header dimensions before decoding rather than trusting reported texture pixels', async () => {
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const f = published([asset({ image: png })]); f.pack.items[0].stats.images[0].width = 2; f.pack.items[0].stats.texture_pixels = 2; f.pack.stats.texture_pixels = 2;
    const h = await harness(f), parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync'); h.layer.setData(h.data());
    expect(codes(await h.layer.whenReady())).toContain('corrupt'); expect(parse).not.toHaveBeenCalled();
  });
});

describe('bounded rendering budgets and guarded async context', () => {
  it('allows exactly 128 real instances of one asset and rejects 129 without silently truncating', async () => {
    const h = await harness(), instances = Array.from({ length: 128 }, (_, index) => h.instance(`chair-${index}`));
    h.layer.setData(h.data(instances)); await h.layer.whenReady(); expect(h.layer.report().budgets.instances).toBe(128); expect(h.layer.report().budgets.cachedAssets).toBe(1);
    h.layer.setData(h.data([...instances, h.instance('overflow')])); expect(h.layer.report().valid).toBe(false); expect(h.layer.parts.size).toBe(0); expect(codes(h.layer.report())).toContain('instances');
  });
  it('allows the actual 500k triangle boundary and explicitly rejects aggregate 600k before loading', async () => {
    const h = await harness(published([asset({ triangles: 100000 })])), instances = Array.from({ length: 5 }, (_, index) => h.instance(`one-${index}`));
    h.layer.setData(h.data(instances)); expect((await h.layer.whenReady()).budgets.triangles).toBe(500000);
    h.onInvalidate.mockClear(); h.layer.setData(h.data([...instances, h.instance('six')])); expect(h.layer.report().valid).toBe(false); expect(codes(h.layer.report())).toContain('budget');
    expect(h.layer.parts.size).toBe(0); expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.onInvalidate).toHaveBeenCalledTimes(1);
  });
  it('retains at most 32 MiB of original assets and evicts only unselected cached entries', async () => {
    const assets = Array.from({ length: 5 }, (_, index) => asset({ name: `Byte boundary ${index}`, size: 8 * MiB })), h = await harness(published(assets));
    for (let index = 0; index < assets.length; index++) { h.layer.setData(h.data([h.instance('one', index)])); const report = await h.layer.whenReady();
      expect(report.ready).toBe(true); expect(report.budgets.assetBytes).toBeLessThanOrEqual(LIMITS.assetBytes); }
    expect(h.layer.report().budgets).toMatchObject({ cachedAssets: 4, assetBytes: 32 * MiB, instances: 1 }); expect(h.layer._cache.has(assets[0].sha256)).toBe(false);
  });
  it('fails the whole display for active unique bytes over 32 MiB with an explicit budget diagnosis', async () => {
    const assets = Array.from({ length: 5 }, (_, index) => asset({ name: `Active boundary ${index}`, size: index === 4 ? MiB : 8 * MiB })), h = await harness(published(assets));
    h.layer.setData(h.data(assets.map((_, index) => h.instance(`item-${index}`, index)))); const report = await h.layer.whenReady();
    expect(report.valid).toBe(false); expect(codes(report)).toContain('budget'); expect(report.budgets.instances).toBe(0); expect(report.budgets.assetBytes).toBeLessThanOrEqual(LIMITS.assetBytes);
  });
  it('blocks published texture-pixel totals over 32 MiPixels before requests instead of silently omitting instances', async () => {
    const assets = Array.from({ length: 3 }, (_, index) => asset({ name: `Declared texture budget ${index}` })), f = published(assets);
    for (const item of f.pack.items) { item.stats.images = Array.from({ length: 4 }, () => ({ width: 2048, height: 2048, mime_type: 'image/png' })); item.stats.texture_pixels = 16 * MiB; }
    // Separate packs keep each actual backend per-pack metadata limit intact.
    const packs = f.pack.items.map((item, index) => { const one = published([assets[index]]).pack; one.items[0].stats = copy(item.stats); one.stats.texture_pixels = 16 * MiB; return one; });
    f.catalogue.packs = packs; const h = await harness(f), instances = packs.map((pack, index) => h.instance(`item-${index}`, 0,
      { pack_id: pack.pack_id, item_id: 'item-0', asset_sha256: pack.items[0].sha256 }));
    h.layer.setData(h.data(instances)); expect(codes(h.layer.report())).toContain('budget'); expect(h.layer.report().valid).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('runs at most two actual asset/parse jobs while all four distinct models become ready', async () => {
    const h = await harness(published(Array.from({ length: 4 }, (_, index) => asset({ name: `Concurrent ${index}` })))), gates = new Map(), reached = deferred();
    let outstanding = 0, peak = 0, peakParses = 0; h.sessionHook = () => { peakParses = Math.max(peakParses, h.layer.report().budgets.parsesActive); };
    h.fetch.mockImplementation((url) => { outstanding++; peak = Math.max(peak, outstanding); const gate = deferred(); gates.set(url, gate); if (gates.size === 2) reached.resolve();
      return gate.promise.then(() => { outstanding--; return binaryResponse(h.byUrl.get(url)); }); });
    const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync'); h.layer.setData(h.data(Array.from({ length: 4 }, (_, index) => h.instance(`item-${index}`, index))));
    await reached.promise; expect(gates.size).toBe(2); for (const gate of gates.values()) gate.resolve();
    await vi.waitFor(() => expect(gates.size).toBe(4)); for (const gate of gates.values()) gate.resolve(); const report = await h.layer.whenReady();
    expect(report.ready).toBe(true); expect(report.budgets.instances).toBe(4); expect(parse).toHaveBeenCalledTimes(4); expect(peak).toBe(2); expect(peakParses).toBeLessThanOrEqual(2);
  });
  it('never publishes an old fetch after context cancellation and does not overwrite the fresh report', async () => {
    const h = await harness(), gate = deferred(), reached = deferred(); h.fetch.mockImplementationOnce(() => { reached.resolve(); return gate.promise; });
    h.layer.setData(h.data()); const ready = h.layer.whenReady(); await reached.promise;
    h.layer.setData(h.data([], { contextKey: 'new-layout' })); expect((await ready).rows).toEqual([]); gate.resolve(binaryResponse(h.fixture.assets[0].bytes));
    await vi.waitFor(() => expect(h.layer._running).toBe(0)); expect(h.layer.report().rows).toEqual([]); expect(h.layer._cache.size).toBe(0); expect(h.onInvalidate).not.toHaveBeenCalled();
  });
  it('observed loss/recovery cannot revive old work, and a fresh request succeeds in the recovered session', async () => {
    const h = await harness(), gate = deferred(), reached = deferred(); h.fetch.mockImplementationOnce(() => { reached.resolve(); return gate.promise; });
    h.layer.setData(h.data()); const oldReady = h.layer.whenReady(); await reached.promise;
    h.user.is_active = false; h.library.revalidate(); h.user.is_active = true; h.library.revalidate(); gate.resolve(binaryResponse(h.fixture.assets[0].bytes));
    const revoked = await oldReady; expect(codes(revoked)).toContain('session'); expect(h.layer.parts.size).toBe(0); expect(h.layer._cache.size).toBe(0);
    h.layer.setData(h.data()); expect((await h.layer.whenReady()).ready).toBe(true); expect(h.current.callService).not.toHaveBeenCalled();
  });
  it('releases an actual parsed model when the current session is revoked before the parsed result can publish', async () => {
    const h = await harness(), parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync'), geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose'), materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    let revoked = false; h.sessionHook = () => { if (parse.mock.calls.length && !revoked) { revoked = true; h.user.is_active = false; } };
    h.layer.setData(h.data()); expect(codes(await h.layer.whenReady())).toContain('session'); const actual = await parse.mock.results[0].value;
    let source; actual.scene.traverse((node) => { if (node.isMesh) source = node; });
    await vi.waitFor(() => expect(h.layer._running).toBe(0)); expect(geometryDispose.mock.contexts.filter((value) => value === source.geometry)).toHaveLength(1);
    expect(materialDispose.mock.contexts.filter((value) => value === source.material)).toHaveLength(1); expect(h.layer.parts.size).toBe(0); expect(h.layer.report().budgets.cachedAssets).toBe(0);
  });
  it('disposes immediately with a pending transport and safely ignores the late response', async () => {
    const h = await harness(), gate = deferred(), reached = deferred(); h.fetch.mockImplementationOnce(() => { reached.resolve(); return gate.promise; });
    h.layer.setData(h.data()); const ready = h.layer.whenReady(); await reached.promise; h.layer.dispose(); expect((await ready).rows[0].status).toBe('disposed');
    gate.resolve(binaryResponse(h.fixture.assets[0].bytes)); await vi.waitFor(() => expect(h.layer._running).toBe(0)); expect(h.layer.parts.size).toBe(0); expect(h.layer._cache.size).toBe(0);
    expect(h.layer.group.parent).toBeNull(); expect(h.onInvalidate).not.toHaveBeenCalled();
  });
});
