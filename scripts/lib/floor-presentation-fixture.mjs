// Explicit simulated two-storey GLB. These authored tags and suggested entities
// are test fixtures, not guesses about Taylor's real house or Home Assistant.
export const floorFixtureEntities = Object.freeze({ lamp: 'light.floors_lamp', switch: 'switch.floors_upper',
  door: 'binary_sensor.floors_door', mower: 'lawn_mower.floors_robot', position: 'sensor.floors_robot_xy',
  camera: 'camera.floors_upper', temperature: 'sensor.floors_temperature', leak: 'binary_sensor.floors_leak',
  presence: 'sensor.floors_room', weather: 'weather.floors_simulated', unrelated: 'sensor.floors_unrelated' });
export const floorFixtureIds = Object.freeze({ ground: 'fp_ground', upper: 'fp_upper', background: 'fp_site',
  groundRoom: 'fp_room_ground', upperRoom: 'fp_room_upper', lamp: 'fp_lamp', switch: 'fp_switch',
  mower: 'fp_mower', door: 'fp_door', camera: 'fp_camera' });

export function floorPresentationFixtureGlb({ nested = false, unclassified = false, authoredLights = false } = {}) {
  const document = { asset: { version: '2.0', generator: "Taylor's 3D simulated independent-floor bench" },
    scene: 0, scenes: [], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
    materials: [], extensionsUsed: ['KHR_materials_unlit'] };
  const buffers = []; let length = 0;
  const append = (values, type, components, target) => {
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength), padding = Buffer.alloc((4 - length % 4) % 4);
    buffers.push(padding); length += padding.length;
    const view = document.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, target }) - 1;
    buffers.push(bytes); length += bytes.length;
    const bounds = components === 3 ? { min: [0, 1, 2].map((axis) => Math.min(...Array.from(values).filter((_, index) => index % 3 === axis))),
      max: [0, 1, 2].map((axis) => Math.max(...Array.from(values).filter((_, index) => index % 3 === axis))) } : {};
    return document.accessors.push({ bufferView: view, componentType: values instanceof Uint16Array ? 5123 : 5126,
      count: values.length / components, type, ...bounds }) - 1;
  };
  const vertices = [], normals = [], indices = [];
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
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const attributes = { POSITION: append(new Float32Array(vertices), 'VEC3', 3, 34962), NORMAL: append(new Float32Array(normals), 'VEC3', 3, 34962) };
  const index = append(new Uint16Array(indices), 'SCALAR', 1, 34963);
  const mesh = (name, colour, unlit = true, emissive) => {
    const material = document.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [...colour, 1], metallicFactor: 0, roughnessFactor: 1 },
      ...(unlit ? { extensions: { KHR_materials_unlit: {} } } : {}), ...(emissive ? { emissiveFactor: emissive } : {}) }) - 1;
    return document.meshes.push({ name: name + '_shared_box', primitives: [{ attributes, indices: index, material }] }) - 1;
  };
  const blue = mesh('ground_blue_unlit', [.05, .2, .8]), orange = mesh('upper_orange_unlit', [.8, .28, .04]);
  const green = mesh('switch_green_unlit', [.04, .9, .08]), gray = mesh('authored_shared_pbr', [.6, .6, .6], false);
  const lampMesh = mesh('authored_lamp_pbr', [.7, .7, .7], false, [.2, .2, .2]);
  const node = (value) => document.nodes.push(value) - 1;
  const box = (name, geometry, translation, scale, role) => node({ name, mesh: geometry, translation, scale, extras: { floorsTestRole: role } });
  const object = (id, type, entity, translation, children, extras = {}) => node({ name: id, translation, children, extras: { floorsTestRole: id,
    fp: { kind: 'object', id, label: 'Simulated ' + id, type, suggest: { entity }, ...extras } } });
  const groundFloor = box('ground_floor', blue, [0, -.025, 0], [6, .05, 4], 'ground-floor');
  const upperFloor = box('upper_floor', orange, [0, -.025, 0], [4, .05, 3], 'upper-floor');
  const lampGlow = box('glow', lampMesh, [0, 0, 0], [.16, .16, .16], 'lamp-glow');
  const lamp = object(floorFixtureIds.lamp, 'light', floorFixtureEntities.lamp, [-1, 2.4, -.5], [lampGlow],
    { glow: 'glow', hints: { beam: 'point', max: 18, distance: 7, decay: 2 } });
  const switchBody = box('switch_body', green, [0, 0, 0], [.35, .5, .35], 'switch-body');
  const switchNode = object(floorFixtureIds.switch, 'switch', floorFixtureEntities.switch, [.6, 1.2, .2], [switchBody]);
  const cameraBody = box('camera_body', gray, [0, 0, 0], [.2, .2, .2], 'camera-body');
  const camera = object(floorFixtureIds.camera, 'camera', floorFixtureEntities.camera, [-1.4, 1.8, -.8], [cameraBody]);
  const leaf = box('leaf', gray, [.4, 1, 0], [.8, 2, .08], 'door-leaf');
  const door = object(floorFixtureIds.door, 'door', floorFixtureEntities.door, [1.7, 0, -.7], [leaf]);
  const mowerGlow = box('glow', gray, [0, 0, 0], [.5, .25, .4], 'mower-body');
  const mower = object(floorFixtureIds.mower, 'mower', floorFixtureEntities.mower, [0, .18, 0], [mowerGlow], { glow: 'glow' });
  const sharedGround = box('shared_ground_object', gray, [-2.3, .35, .5], [.4, .7, .4], 'shared-ground');
  const sharedUpper = box('shared_upper_object', gray, [1.4, .35, .6], [.4, .7, .4], 'shared-upper');
  const room = (id, children, outline, area) => node({ name: id, children, extras: { fp: { kind: 'room', id, label: 'Simulated ' + id, outline, suggest: { area } } } });
  const lowerRoom = room(floorFixtureIds.groundRoom, [groundFloor, door, mower, sharedGround], [[-3, -2], [3, -2], [3, 2], [-3, 2]], 'floor_ground_area');
  const upperRoom = room(floorFixtureIds.upperRoom, [upperFloor, lamp, switchNode, camera, sharedUpper], [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]], 'floor_upper_area');
  const level = (id, elevation, children, role = 'storey') => node({ name: id, translation: [0, elevation, 0], children,
    extras: { floorsTestRole: id, fp: { kind: 'level', id, label: 'Simulated ' + id, role, elevation, height: 3, order: elevation } } });
  const upper = level(floorFixtureIds.upper, 4, [upperRoom]);
  const ground = level(floorFixtureIds.ground, 0, [lowerRoom, ...(nested ? [upper] : [])]);
  const parcel = box('background_parcel', gray, [-5, -.08, -4], [1, .1, 1], 'background');
  const background = level(floorFixtureIds.background, 0, [parcel], 'exterior');
  const stray = unclassified ? [box('explicit_unclassified', green, [7, 0, 0], [.3, .3, .3], 'unclassified')] : [];
  const root = node({ name: 'simulated_floor_bench', children: [ground, ...(!nested ? [upper] : []), background, ...stray], extras: { fp: { north: 0,
    views: [{ id: 'all', label: 'Simulated all floors', show: ['level:fp_ground', 'level:fp_upper', 'level:fp_site'] },
      { id: 'ground', label: 'Simulated ground', show: ['level:fp_ground'] }, { id: 'upper', label: 'Simulated upper', show: ['level:fp_upper'] }] } } });
  // Explicit opt-in only: preserve the original default GLB bytes and geometry.
  // This imported light belongs to the actual authored Upper room hierarchy.
  if (authoredLights) {
    const name = 'simulated_upper_authored_light';
    const light = node({ name, extensions: { KHR_lights_punctual: { light: 0 } } });
    document.nodes[upperRoom].children.push(light);
    document.extensionsUsed.push('KHR_lights_punctual');
    document.extensions = { KHR_lights_punctual: { lights: [{ name, type: 'directional', intensity: 2.35, color: [1, 1, 1] }] } };
  }
  document.scenes = [{ nodes: [root] }]; buffers.push(Buffer.alloc((4 - length % 4) % 4));
  const binary = Buffer.concat(buffers); document.buffers[0].byteLength = binary.length;
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20), tail = Buffer.alloc(8); header.write('glTF'); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + binary.length, 8); header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
  tail.writeUInt32LE(binary.length); tail.write('BIN\0', 4); return Buffer.concat([header, json, tail, binary]);
}
