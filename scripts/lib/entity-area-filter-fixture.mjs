// Explicit anonymous HA registry/readings for the existing authored GLB server.
// No photograph, household data, service execution or real HA storage claim.
import { roomActionsLayout, roomActionRoomId } from './room-actions-fixture.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const entityAreaIds = Object.freeze({ lounge: 'simulated-upper', garden: 'filter-garden' });
export const areaEntity = (domain, variant) => `${domain}.area_${variant}`;
export const entityAreaSpecifications = Object.freeze([
  { name: 'Scenes', tab: 'scenes', controller: '_scenePreviewEditor', section: '[data-scene-preview-editor]', prefix: 'scene-preview-',
    rawKey: 'scene_previews', candidate: 'new-light', domain: 'light', saved: [{ field: 'scene-entity', domain: 'scene' }, { field: 'light-entity', domain: 'light' }],
    draftField: 'label', draftValue: 'User_Scene_Draft_<b>été', pendingAction: 'add-light' },
  { name: 'Room shortcuts', tab: 'rooms', controller: '_roomActionsEditor', section: '[data-room-actions-editor]', prefix: 'room-actions-',
    rawKey: 'room_actions', candidate: 'new-source', domain: 'scene', saved: [{ field: 'source', domain: 'scene', index: 0 }, { field: 'source', domain: 'script', index: 1 }],
    draftField: 'label', draftIndex: 0, draftValue: 'User_Room_Draft_<b>été' },
  { name: 'Weather', tab: 'environment', controller: '_weatherEditor', section: '[data-env-weather-editor]', prefix: 'env-weather-',
    rawKey: 'weather', candidate: 'entity', domain: 'weather', saved: [{ field: 'entity', domain: 'weather' }], draftField: 'intensity', draftValue: '0.35' },
  { name: 'House', tab: 'house', controller: '_houseSummaryEditor', section: '[data-house-summary-editor]', prefix: 'house-summary-',
    rawKey: 'house_summary', candidate: 'new-person', domain: 'person', saved: [{ field: 'weather_entity', domain: 'weather' }, { field: 'alarm_entity', domain: 'alarm_control_panel' }, { field: 'person', domain: 'person', index: 0 }],
    draftField: 'title', draftValue: 'User_House_Draft_<b>été', pendingAction: 'add-person' },
]);

export function entityAreaLayout(bytes) {
  const layout = roomActionsLayout(bytes);
  layout.scene_previews = { enabled: false, items: [{ id: 'explicit-area-preview', label: 'User_Saved_Preview_été',
    scene_entity: areaEntity('scene', 'lounge'), lights: [{ entity: areaEntity('light', 'lounge'), state: 'on' }] }] };
  layout.room_actions.rooms[0].actions[0].entity = areaEntity('scene', 'lounge');
  layout.room_actions.rooms[0].actions[1].entity = areaEntity('script', 'lounge');
  layout.weather = { enabled: false, entity: areaEntity('weather', 'lounge'), intensity: .6, quality: 'off', effects: [] };
  layout.house_summary = { title: 'User_Saved_House_été', weather_entity: areaEntity('weather', 'lounge'),
    alarm_entity: areaEntity('alarm_control_panel', 'lounge'), person_entities: [areaEntity('person', 'lounge')] };
  return layout;
}

export function entityAreaRegistry() {
  const states = {}, entities = {};
  const readings = { scene: 'unknown', script: 'off', light: 'on', weather: 'sunny', person: 'home', alarm_control_panel: 'disarmed' };
  for (const domain of Object.keys(readings)) for (const variant of ['lounge', 'garden', 'unassigned', 'hidden', 'diagnostic', 'disabled', 'restored', 'malformed']) {
    const entity_id = areaEntity(domain, variant);
    const attributes = { friendly_name: `User_${domain}_${variant}_<b>été`, ...(domain === 'light' ? { supported_color_modes: ['onoff'], color_mode: 'onoff' } : {}),
      ...(variant === 'restored' ? { restored: true } : {}) };
    states[entity_id] = { entity_id: variant === 'malformed' ? 'sensor.explicit_wrong_domain' : entity_id, state: readings[domain], attributes,
      last_changed: '2026-01-01T00:00:00Z', last_updated: '2026-01-01T00:00:00Z' };
    if (variant === 'malformed' && domain === 'light') states[entity_id].attributes.supported_color_modes = ['unsupported_fixture_mode'];
    entities[entity_id] = { entity_id, device_id: variant === 'lounge' ? 'filter-child' : null,
      area_id: variant === 'garden' ? entityAreaIds.garden : null, hidden_by: variant === 'hidden' ? 'user' : null,
      disabled_by: variant === 'disabled' ? 'user' : null, entity_category: variant === 'diagnostic' ? 'diagnostic' : null };
  }
  return { states, entities, devices: { 'filter-child': { id: 'filter-child', area_id: null, parent_device_id: 'filter-parent' },
    'filter-parent': { id: 'filter-parent', area_id: entityAreaIds.lounge } },
    areas: { [entityAreaIds.garden]: { area_id: entityAreaIds.garden, name: 'User_Garden_<outside>été', floor_id: 'ground' } } };
}

// Serialized page.evaluate boundary; the real Root setter observes the changes.
export function prepareEntityAreaFilterFixture({ data }) {
  const card = document.querySelector('taylors3d-card'), fixture = window.roomActionsFixture;
  window.entityAreaFilterFixture = fixture;
  const previous = card._hass.callWS;
  card.hass = { ...card._hass, states: { ...card._hass.states, ...data.states }, entities: { ...card._hass.entities, ...data.entities },
    devices: data.devices, areas: { ...card._hass.areas, ...data.areas },
    callWS: async (message) => {
      if (message.type === 'config/device_registry/list') { fixture.ws.push(structuredClone(message)); return Object.values(card._hass.devices); }
      return previous(message);
    } };
  fixture.registryOriginal = { states: structuredClone(card._hass.states), entities: structuredClone(card._hass.entities),
    devices: structuredClone(card._hass.devices), areas: structuredClone(card._hass.areas) };
  fixture.updateRegistry = (patch) => { card.hass = { ...card._hass, ...patch }; };
}

export { roomActionRoomId as entityAreaRoomId };

// A native bundle run must use both current distributed copies. Compilation is
// read-only (write:false); this helper never builds or replaces a saved artifact.
// Preflight intentionally does not call it or claim bundle application coverage.
export async function assertEntityAreaBundlePrerequisites(projectRoot) {
  const { build } = await import('esbuild');
  const files = ['dist/taylors3d-card.js', 'custom_components/taylors3d/frontend/taylors3d-card.js'];
  const result = await build({ entryPoints: [path.join(projectRoot, 'src/taylors3d-card.js')], outfile: path.join(projectRoot, files[0]),
    bundle: true, format: 'esm', target: 'es2020', minify: true, sourcemap: false, write: false, logLevel: 'silent' });
  const expected = Buffer.from(result.outputFiles[0].contents);
  for (const file of files) {
    const actual = await fs.readFile(path.join(projectRoot, file)).catch(() => null);
    if (!actual || !actual.equals(expected)) throw new Error(`${file} is missing or stale. Run npm run build before the native source+bundle area-filter proof.`);
  }
  return createHash('sha256').update(expected).digest('hex');
}
