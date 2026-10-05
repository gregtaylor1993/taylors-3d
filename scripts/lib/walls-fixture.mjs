// Original simulated geometry for the native F14 wall checks. The GLB contains
// actual shared PBR textures, duplicate escaped names and multiple primitives;
// no browser-side material/geometry replacement is used by the checks.
import { deflateSync } from 'node:zlib';

export const wallsLampEntity = 'light.walls_lamp';
export const wallsRelayEntity = 'switch.walls_panel';
export const wallsProbes = {
  upper: [0, 4.1, .14],
  right: [.3, 4.1, .14],
  left: [-.3, 4.1, .14],
  lower: [0, 2.5, .14],
  furniture: [2.8, 2.65, .45],
  floor: [1.7, 2.015, 1],
};

function png(width, height, pixel) {
  const chunk = (name, data) => {
    const payload = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
    for (const value of payload) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, payload, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * (1 + width * 4) + 1 + x * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

export function wallsFixtureGlb({ legacyFloor = false } = {}) {
  const json = { asset: { version: '2.0', generator: "Taylor's 3D simulated explicit-wall verification" },
    buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [], meshes: [], nodes: [], materials: [], images: [], textures: [],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }], extensionsUsed: ['KHR_materials_unlit'] };
  const parts = []; let offset = 0;
  const append = (bytes, target) => {
    const pad = Buffer.alloc((4 - offset % 4) % 4); parts.push(pad); offset += pad.length;
    const index = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) }) - 1;
    parts.push(bytes); offset += bytes.length; return index;
  };
  const accessor = (values, type, componentType, bounds) => json.accessors.push({ bufferView: append(Buffer.from(values.buffer), componentType === 5123 ? 34963 : 34962),
    componentType, count: values.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3 }[type]), type, ...bounds }) - 1;
  const primitive = (vertices, normals, uv, indices, material) => {
    const min = [0, 1, 2].map((axis) => Math.min(...vertices.filter((_, index) => index % 3 === axis)));
    const max = [0, 1, 2].map((axis) => Math.max(...vertices.filter((_, index) => index % 3 === axis)));
    return { attributes: { POSITION: accessor(new Float32Array(vertices), 'VEC3', 5126, { min, max }),
      NORMAL: accessor(new Float32Array(normals), 'VEC3', 5126), TEXCOORD_0: accessor(new Float32Array(uv), 'VEC2', 5126) },
    indices: accessor(new Uint16Array(indices), 'SCALAR', 5123), material };
  };
  const checker = png(4, 4, (x, y) => (x + y) % 2 ? [230, 214, 180, 255] : [175, 162, 135, 255]);
  json.images.push({ name: 'walls_shared_checker', bufferView: append(checker), mimeType: 'image/png' });
  json.textures.push({ source: 0, sampler: 0 });
  const shared = json.materials.push({ name: 'walls_authored_shared_pbr', pbrMetallicRoughness: {
    baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }) - 1;
  const green = json.materials.push({ name: 'walls_interior_green_unlit', pbrMetallicRoughness: { baseColorFactor: [.05, .92, .15, 1] },
    extensions: { KHR_materials_unlit: {} } }) - 1;
  const blue = json.materials.push({ name: 'walls_second_primitive_blue', pbrMetallicRoughness: { baseColorFactor: [.05, .15, .8, 1] },
    extensions: { KHR_materials_unlit: {} } }) - 1;
  const authoredGlass = json.materials.push({ name: 'walls_authored_glass', alphaMode: 'BLEND', doubleSided: true,
    pbrMetallicRoughness: { baseColorFactor: [.25, .6, .85, .4], metallicFactor: 0, roughnessFactor: .7 } }) - 1;
  const bulb = json.materials.push({ name: 'walls_lamp_bulb', pbrMetallicRoughness: { baseColorFactor: [.7, .7, .7, 1], metallicFactor: 0, roughnessFactor: .8 },
    emissiveFactor: [.3, .3, .3] }) - 1;
  const box = (material) => {
    const positions = [], normals = [], uv = [], indices = [];
    const faces = [
      [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5], [0, 0, 1]],
      [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5], [0, 0, -1]],
      [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [1, 0, 0]],
      [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-1, 0, 0]],
      [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5], [0, 1, 0]],
      [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5], [0, -1, 0]],
    ];
    for (const face of faces) {
      const start = positions.length / 3; for (const vertex of face.slice(0, 4)) { positions.push(...vertex); normals.push(...face[4]); }
      uv.push(0, 0, 1, 0, 1, 1, 0, 1); indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    return primitive(positions, normals, uv, indices, material);
  };
  const sharedBox = json.meshes.push({ name: 'walls_shared_box_geometry', primitives: [box(shared)] }) - 1;
  const greenBox = json.meshes.push({ name: 'walls_green_box_geometry', primitives: [box(green)] }) - 1;
  const glassBox = json.meshes.push({ name: 'walls_glass_box_geometry', primitives: [box(authoredGlass)] }) - 1;
  const glowBox = json.meshes.push({ name: 'walls_glow_geometry', primitives: [box(bulb)] }) - 1;
  const multi = json.meshes.push({ name: 'walls_actual_multi_primitive', primitives: [box(shared), box(blue)] }) - 1;
  const node = (value) => json.nodes.push(value) - 1;
  const front = node({ name: 'wall*/#\\face', mesh: sharedBox, translation: [0, 3.5, 2], scale: [5, 3, .12], extras: { wallsTestRole: 'front' } });
  const back = node({ name: 'wall*/#\\face', mesh: sharedBox, translation: [0, 3.5, -2], scale: [5, 3, .12], extras: { wallsTestRole: 'back' } });
  const furniture = node({ name: 'walls_shared_furniture', mesh: sharedBox, translation: [2.8, 2.6, 0], scale: [.7, 1.2, .8], extras: {
    wallsTestRole: 'furniture', fp: { kind: 'object', id: 'walls_furniture', type: 'switch', label: 'Simulated unbound furniture' } } });
  const floor = node({ name: 'walls_shared_floor', mesh: sharedBox, translation: [0, 1.97, 0], scale: [7, .06, 5], extras: { wallsTestRole: 'floor', fp: { layer: ['floor'] } } });
  const glass = node({ name: 'walls_original_glass', mesh: glassBox, translation: [-2.9, 3, .3], scale: [.5, 1.3, .05], extras: { wallsTestRole: 'authored-glass' } });
  const split = node({ name: 'walls_multi_primitive', mesh: multi, translation: [-4, 3.5, 0], scale: [.3, 1.5, .15], extras: { wallsTestRole: 'multi' } });
  const panelBody = node({ name: 'walls_panel_body', mesh: greenBox, translation: [0, 3.5, 0], scale: [1.2, 2.6, .28], extras: { wallsTestRole: 'panel' } });
  const panel = node({ name: 'walls_panel', children: [panelBody], extras: { fp: { kind: 'object', id: 'walls_panel', type: 'switch',
    label: 'Simulated inside switch', suggest: { entity: wallsRelayEntity } } } });
  const glow = node({ name: 'glow', mesh: glowBox, scale: [.16, .16, .16] });
  const lamp = node({ name: 'walls_lamp', translation: [1.5, 4.4, 0], children: [glow], extras: { fp: { kind: 'object', id: 'walls_lamp', type: 'light',
    label: 'Simulated inside lamp', glow: 'glow', hints: { beam: 'point', max: 20, distance: 8, decay: 2 }, suggest: { entity: wallsLampEntity } } } });
  const room = node({ name: 'walls_room', children: [front, back, furniture, floor, glass, split, panel, lamp], extras: { fp: {
    kind: 'room', id: 'walls_room', outline: [[-3.5, -2.5], [3.5, -2.5], [3.5, 2.5], [-3.5, 2.5]], suggest: { area: 'living_room' } } } });
  // The optional genuinely legacy level exercises the app's existing model
  // floor clip/clipShadows together with the new wall clip, without injecting
  // Three.js clipping properties into a material in the browser.
  const level = node({ name: legacyFloor ? 'floor:ground' : 'walls_ground', children: [room],
    ...(!legacyFloor ? { extras: { fp: { kind: 'level', id: 'ground', role: 'storey', elevation: 2, height: 3, order: 0 } } } : {}) });
  const bench = node({ name: 'walls_bench', children: [level], extras: { fp: { north: 0, views: [{ id: 'ground', label: 'Simulated walls bench', show: ['level:ground'] }] } } });
  json.scenes = [{ nodes: [bench] }]; json.scene = 0;
  const padding = Buffer.alloc((4 - offset % 4) % 4); parts.push(padding); offset += padding.length; json.buffers[0].byteLength = offset;
  const body = Buffer.from(JSON.stringify(json)), jsonPad = Buffer.alloc((4 - body.length % 4) % 4, 0x20), header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + body.length + jsonPad.length + offset, 8);
  header.writeUInt32LE(body.length + jsonPad.length, 12); header.write('JSON', 16); binHeader.writeUInt32LE(offset); binHeader.write('BIN\0', 4);
  return Buffer.concat([header, body, jsonPad, binHeader, ...parts]);
}
