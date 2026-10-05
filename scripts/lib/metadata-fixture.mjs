// Deliberately simulated HA registry/state data and tiny authored GLB. No real
// household entities, image references, services or detection claims are used.
import { floorPresentationFixtureGlb, floorFixtureIds } from './floor-presentation-fixture.mjs';

export const metadataIds = Object.freeze({ ...floorFixtureIds, room: 'metadata-room',
  staleRoom: 'metadata-stale-room', drawnArea: 'metadata-drawn-area', staleArea: 'metadata-stale-area',
  goneFloor: 'metadata-gone-floor', alert: 'metadata-retained-alert' });
export const metadataEntities = Object.freeze({ lamp: 'light.metadata_lamp', precise: 'sensor.metadata_precise',
  position: 'sensor.metadata_position', smoke: 'binary_sensor.metadata_smoke',
  savedHidden: 'sensor.metadata_saved_hidden', missing: 'sensor.metadata_missing',
  missingPosition: 'sensor.metadata_missing_position', missingImage: 'camera.metadata_missing_image',
  missingContact: 'binary_sensor.metadata_missing_contact', stalePin: 'switch.metadata_stale_pin',
  map: 'image.metadata_map', upper: 'sensor.metadata_upper', unassigned: 'sensor.metadata_unassigned' });
export const metadataExcluded = Object.freeze(['hidden', 'disabled', 'diagnostic', 'device_disabled']);

// Reuse the original no-exporter binary geometry, adding an explicit read-only
// state popup to one real tagged object. This does not import a second Three.
export function metadataFixtureGlb() {
  const original = floorPresentationFixtureGlb(), jsonLength = original.readUInt32LE(12);
  const doc = JSON.parse(original.subarray(20, 20 + jsonLength).toString('utf8'));
  const object = doc.nodes.find((node) => node.extras?.fp?.id === metadataIds.camera);
  object.extras.fp.type = 'other'; object.extras.fp.label = 'Simulated precision object';
  object.extras.fp.suggest.entity = metadataEntities.precise;
  object.extras.fp.ui = { tap: 'popup', hold: 'popup', popup: ['state'] };
  const raw = Buffer.from(JSON.stringify(doc)), json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const header = Buffer.from(original.subarray(0, 20)), binaryChunk = original.subarray(20 + jsonLength);
  header.writeUInt32LE(20 + json.length + binaryChunk.length, 8); header.writeUInt32LE(json.length, 12);
  return Buffer.concat([header, json, binaryChunk]);
}

export function metadataScenario() {
  const e = metadataEntities, ids = metadataIds;
  const state = (value, name, attributes = {}) => ({ state: value, attributes: { friendly_name: name, ...attributes } });
  const temp = (name, value = '18.87654') => state(value, name, { device_class: 'temperature', unit_of_measurement: '°C', x: 1, y: 2 });
  const registry = (name, area_id = 'metadata-ground-area', extras = {}) => ({ name, area_id, hidden: false,
    disabled_by: null, entity_category: null, ...extras });
  const states = {
    [e.lamp]: state('on', 'Old simulated lamp label', { brightness: 128, supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: [255, 180, 80] }),
    [e.precise]: temp('Old simulated precision label', '19.87654'),
    [e.position]: state('current', 'Old simulated position label', { x: 1, y: 2 }),
    [e.smoke]: state('off', 'Old simulated contact label'),
    [e.savedHidden]: temp('Old saved hidden source label'),
    [e.stalePin]: state('off', 'Simulated saved pin'),
    [e.map]: state('current', 'Old simulated image label', { entity_picture: '/demo/mower-map.svg' }),
    [e.upper]: temp('Simulated upper reading'), [e.unassigned]: temp('Simulated unassigned reading'),
  };
  const entities = {
    [e.lamp]: registry('HA simulated lamp'), [e.precise]: registry('HA precise source', 'metadata-upper-area', { display_precision: 1 }),
    [e.position]: registry('HA position source', null, { device_id: 'metadata-device' }),
    [e.smoke]: registry('HA smoke contact', 'metadata-ground-area', { original_device_class: 'smoke' }),
    [e.savedHidden]: registry('HA retained hidden source', 'metadata-ground-area', { hidden_by: 'user', display_precision: 1 }),
    [e.stalePin]: registry('Simulated saved pin'), [e.map]: registry('HA image source'),
    [e.upper]: registry('HA upper source', 'metadata-upper-area'), [e.unassigned]: registry('HA unassigned source', null),
  };
  for (const kind of metadataExcluded) {
    const extras = kind === 'hidden' ? { hidden_by: 'user' } : kind === 'disabled' ? { disabled_by: 'user' }
      : kind === 'diagnostic' ? { entity_category: 'diagnostic' } : { device_id: 'metadata-disabled-device' };
    for (const [domain, attributes] of [['sensor', { x: 1, y: 2, device_class: 'temperature', unit_of_measurement: '°C' }],
      ['binary_sensor', { device_class: 'smoke' }], ['camera', {}], ['image', {}]]) {
      const id = `${domain}.metadata_${kind}`;
      states[id] = state(domain === 'binary_sensor' ? 'off' : domain === 'sensor' ? '20' : 'idle', `Simulated ${kind} ${domain}`, attributes);
      entities[id] = registry(`HA excluded ${kind} ${domain}`, 'metadata-ground-area', extras);
    }
  }
  return { states, entities,
    areas: { 'metadata-ground-area': { area_id: 'metadata-ground-area', name: 'Simulated ground room', floor_id: 'ground' },
      'metadata-upper-area': { area_id: 'metadata-upper-area', name: 'Simulated upper room', floor_id: 'upper' },
      [ids.drawnArea]: { area_id: ids.drawnArea, name: 'Simulated drawn overlay area', floor_id: 'ground' },
      [ids.staleArea]: { area_id: ids.staleArea, name: 'Simulated retained outline area', floor_id: ids.goneFloor } },
    devices: { 'metadata-device': { area_id: 'metadata-ground-area', name: 'Simulated position device' },
      'metadata-disabled-device': { area_id: 'metadata-ground-area', disabled_by: 'user' } },
    floors: { ground: { floor_id: 'ground', name: 'Simulated ground', level: 0 }, upper: { floor_id: 'upper', name: 'Simulated upper', level: 1 } },
    layout: { floors: [{ id: 'ground', name: 'Simulated ground', elevation: 0, height: 3 }, { id: 'upper', name: 'Simulated upper', elevation: 4, height: 3 }],
      // A tagged model room intentionally supersedes drawn outlines for the same
      // HA area. These two drawn outlines belong to their own explicit areas so
      // the overlay and missing-floor tests exercise genuinely separate rooms.
      rooms: [{ id: ids.room, name: 'Simulated drawn room', area_id: ids.drawnArea, floor_id: 'ground', outdoor: true,
        polygon: [[-8, -2], [-5, -2], [-5, 2], [-8, 2]], doors: [] },
      { id: ids.staleRoom, name: 'Simulated retained room', area_id: ids.staleArea, floor_id: ids.goneFloor,
        outdoor: true, polygon: [[8, -2], [11, -2], [11, 2], [8, 2]], doors: [] }],
      pins: { [`entity:${e.stalePin}`]: { x: 9, y: 0, z: .4, floor_id: ids.goneFloor, marker_extra: 'keep' } }, hidden: [],
      mower: { entity: e.missingPosition, source: 'xy', x_attr: 'x', y_attr: 'y', floor_id: ids.goneFloor, trail: false,
        calibration: [{ src: [0, 0], plan: [0, 0] }], overlay: { entity: e.missingImage, x: 0, y: 0, width: 4, opacity: .5 },
        image: { entity: e.missingImage }, mower_extra: 'keep' },
      objects: { [ids.lamp]: { entity: e.lamp }, [ids.camera]: { entity: e.precise }, [ids.mower]: { entity: null },
        [ids.switch]: { entity: null }, [ids.door]: { entity: null } }, groups: {},
      model: { levels: { [ids.ground]: { floor: 'ground' }, [ids.upper]: { floor: 'upper' }, [ids.background]: { floor: null } },
        rooms: { [ids.groundRoom]: { area: 'metadata-ground-area' }, [ids.upperRoom]: { area: 'metadata-upper-area' } } },
      views: { all: { floors: [ids.goneFloor, 'ground'], view_extra: 'keep' } },
      room_overlays: { mode: 'temperature', unit: '°C', bindings: { [ids.room]: { aggregation: 'mean', entities: [
        { entity: e.savedHidden, source_extra: 'keep' }, { entity: e.missing, source_extra: 'keep-missing' } ] } } },
      alert_bindings: [{ id: ids.alert, entity: e.missingContact, type: 'smoke', roomId: ids.room, clear_rule: 'state', alert_extra: 'keep' }],
      ambient_idle: { enabled: false }, scene_previews: { enabled: false }, weather: { enabled: false },
      camera_coverage: {}, security_bindings: [], presence_bindings: [], vehicle_bindings: [], vacuum_bindings: [] } };
}
