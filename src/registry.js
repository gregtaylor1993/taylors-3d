// Turns hass.entities / hass.devices / hass.areas into a list of markers.
// These registries live on the hass object and update by themselves, so a new device
// with an area shows up on the plan without any extra work.

import { SKIP_DOMAINS, domainPriority, sensorPriority } from './placement.js';

export function registrySignature(hass) {
  // Cheap identity check: HA replaces these objects when the registries change.
  return [hass.entities, hass.devices, hass.areas, hass.floors];
}

export function buildMarkers(hass, layout, opts = {}) {
  const groupBy = opts.group_by || 'device';
  const hidden = new Set(layout.hidden || []);
  const ents = hass.entities || {};
  const devs = hass.devices || {};
  const byMarker = new Map();

  for (const eid of Object.keys(ents)) {
    const e = ents[eid];
    if (!e || e.hidden || e.entity_category) continue;
    const domain = eid.split('.')[0];
    if (SKIP_DOMAINS.has(domain)) continue;
    const st = hass.states[eid];
    if (!st) continue;
    const dev = e.device_id ? devs[e.device_id] : null;
    const areaId = e.area_id || (dev && dev.area_id) || null;
    const id = groupBy === 'device' && e.device_id && !e.area_id ? 'device:' + e.device_id : 'entity:' + eid;
    if (hidden.has(id) || hidden.has(eid)) continue;
    const dc = st.attributes.device_class;
    const cand = { eid, domain, dc, prio: domainPriority(domain) * 100 + (domain === 'sensor' ? sensorPriority(dc) : 0) };
    const cur = byMarker.get(id);
    if (!cur) {
      byMarker.set(id, {
        id,
        areaId,
        deviceId: e.device_id || null,
        name: (dev && (dev.name_by_user || dev.name)) || st.attributes.friendly_name || eid,
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
      m.name = hass.states[p.eid].attributes.friendly_name || m.name;
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

export function iconFor(hass, eid) {
  const st = hass.states[eid];
  const e = hass.entities && hass.entities[eid];
  if (st && st.attributes.icon) return st.attributes.icon;
  if (e && e.icon) return e.icon;
  const d = eid.split('.')[0];
  const dc = st && st.attributes.device_class;
  return (dc && DC_ICONS[dc]) || ICONS[d] || 'mdi:checkbox-blank-circle-outline';
}

const ACTIVE = new Set(['on', 'open', 'opening', 'unlocked', 'playing', 'heat', 'cool', 'heat_cool', 'auto', 'cleaning', 'mowing', 'home']);
export function isActive(st) {
  return !!st && ACTIVE.has(st.state);
}

export function displayValue(hass, eid) {
  const st = hass.states[eid];
  if (!st) return '';
  const d = eid.split('.')[0];
  if (d === 'sensor') {
    const n = Number(st.state);
    const unit = st.attributes.unit_of_measurement || '';
    if (Number.isFinite(n)) return (Math.round(n * 10) / 10) + unit;
    return st.state;
  }
  if (d === 'climate') {
    const t = st.attributes.current_temperature;
    return t !== undefined ? t + '°' : '';
  }
  return '';
}

export const TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'cover', 'lock']);
