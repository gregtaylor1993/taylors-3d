// Turns hass.entities / hass.devices / hass.areas into a list of markers.
// These registries live on the hass object and update by themselves, so a new device
// with an area shows up on the plan without any extra work.

import { SKIP_DOMAINS, domainPriority, sensorPriority } from './placement.js';
import { entityMetadata, formatEntityValue } from './entity-metadata.js';

export function registrySignature(hass = {}) {
  // HA replaces registries when they change. State-only entities also need membership/name
  // changes observed, but readings and the states object's identity must not rebuild markers.
  const states = hass.states || {};
  const membership = JSON.stringify(Object.keys(states).sort().map((id) => {
    const state = states[id], attr = state?.attributes || {};
    return [id, !!state, attr.friendly_name || null, attr.device_class || null, attr.icon || null];
  }));
  const locale = hass.locale || {};
  return [hass.entities, hass.devices, hass.areas, hass.floors, membership,
    hass.language || '', locale.language || '', locale.number_format || '', hass.translationMetadata];
}

export function buildMarkers(hass = {}, layout = {}, opts = {}) {
  const groupBy = opts.group_by || 'device';
  const hidden = new Set(layout.hidden || []);
  const ents = hass.entities || {};
  const byMarker = new Map();

  // Keep registered ordering (including priority ties), then include real state-only entities.
  const candidates = new Set([...Object.keys(ents), ...Object.keys(hass.states || {})]);
  for (const eid of candidates) {
    const metadata = entityMetadata(hass, eid);
    if (!metadata.hasState || metadata.hidden || metadata.disabled || metadata.category) continue;
    const { domain, deviceId, areaId, floorId, deviceClass: dc, device } = metadata;
    if (SKIP_DOMAINS.has(domain)) continue;
    const id = groupBy === 'device' && deviceId && !metadata.registry?.area_id ? 'device:' + deviceId : 'entity:' + eid;
    if (hidden.has(id) || hidden.has(eid)) continue;
    const cand = { eid, domain, dc, prio: domainPriority(domain) * 100 + (domain === 'sensor' ? sensorPriority(dc) : 0) };
    const cur = byMarker.get(id);
    if (!cur) {
      byMarker.set(id, {
        id,
        areaId, floorId, deviceId,
        name: (device && (device.name_by_user || device.name)) || metadata.name,
        entities: [cand],
      });
    } else {
      cur.entities.push(cand);
    }
  }

  const markers = [];
  for (const m of byMarker.values()) {
    m.entities.sort((a, b) => a.prio - b.prio);
    const p = m.entities[0];
    m.entityId = p.eid;
    m.domain = p.domain;
    m.deviceClass = p.dc;
    // a secondary reading (e.g. temperature next to a switch) for value display
    const sec = m.entities.find((x) => x.domain === 'sensor' && x.eid !== p.eid);
    m.secondaryId = sec ? sec.eid : null;
    if (m.entities.length === 1 && m.id.startsWith('entity:')) {
      m.name = entityMetadata(hass, p.eid).name;
    }
    markers.push(m);
  }
  return markers;
}

export function areaName(hass, areaId) {
  const a = hass.areas && hass.areas[areaId];
  return a ? a.name : areaId;
}

export function floorsFromHA(hass) {
  const f = hass.floors || {};
  return Object.values(f)
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
    .map((x) => ({ id: x.floor_id, name: x.name, level: x.level ?? 0 }));
}

const ICONS = {
  light: 'mdi:lightbulb', switch: 'mdi:toggle-switch-variant', fan: 'mdi:fan', cover: 'mdi:window-shutter',
  climate: 'mdi:thermostat', lock: 'mdi:lock', camera: 'mdi:cctv', media_player: 'mdi:speaker',
  vacuum: 'mdi:robot-vacuum', lawn_mower: 'mdi:robot-mower', water_heater: 'mdi:water-boiler',
  humidifier: 'mdi:air-humidifier', valve: 'mdi:valve', alarm_control_panel: 'mdi:shield-home',
  input_boolean: 'mdi:toggle-switch-variant',
};
const DC_ICONS = {
  temperature: 'mdi:thermometer', humidity: 'mdi:water-percent', carbon_dioxide: 'mdi:molecule-co2',
  illuminance: 'mdi:brightness-5', power: 'mdi:flash', energy: 'mdi:lightning-bolt', motion: 'mdi:motion-sensor',
  occupancy: 'mdi:account-eye', presence: 'mdi:account-eye', door: 'mdi:door', garage_door: 'mdi:garage',
  window: 'mdi:window-closed-variant', opening: 'mdi:door', smoke: 'mdi:smoke-detector', gas: 'mdi:gas-cylinder',
  moisture: 'mdi:water-alert', battery: 'mdi:battery', voltage: 'mdi:sine-wave', current: 'mdi:current-ac',
};

export function iconFor(hass = {}, eid) {
  const metadata = entityMetadata(hass, eid);
  const st = metadata.state, e = metadata.registry;
  if (st?.attributes?.icon) return st.attributes.icon;
  if (e && e.icon) return e.icon;
  const d = metadata.domain, dc = metadata.deviceClass;
  return (dc && DC_ICONS[dc]) || ICONS[d] || 'mdi:checkbox-blank-circle-outline';
}

const ACTIVE = new Set(['on', 'open', 'opening', 'unlocked', 'playing', 'heat', 'cool', 'heat_cool', 'auto', 'cleaning', 'mowing', 'home']);
export function isActive(st) {
  return !!st && ACTIVE.has(st.state);
}

export function displayValue(hass = {}, eid) {
  const st = Object.prototype.hasOwnProperty.call(hass.states || {}, eid) ? hass.states[eid] : null;
  if (!st) return '';
  const d = eid.split('.')[0];
  if (d === 'sensor') return formatEntityValue(hass, eid);
  if (d === 'climate') {
    if (st.state === 'unknown' || st.state === 'unavailable') return formatEntityValue(hass, eid);
    const t = st.attributes?.current_temperature;
    return t !== undefined && t !== null ? formatEntityValue(hass, eid, { attribute: 'current_temperature' }) : '';
  }
  return '';
}

export const TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'cover', 'lock']);
