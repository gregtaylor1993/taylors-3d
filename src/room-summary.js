import { entityMetadata, formatEntityValue } from './entity-metadata.js';
import { localize, localeInfo } from './localization.js';
import roomSheetCaptions from './translations/room-sheet.js';

export const ROOM_SUMMARY_LIMITS = Object.freeze({ entities: 512 });
const INVALID = Symbol('invalid field');
const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const field = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return !descriptor ? undefined : own(descriptor, 'value') ? descriptor.value : INVALID;
};
const identifier = (value) => typeof value === 'string' && value.length <= 255
  && /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value);
const knownMediaStates = new Set(['playing', 'paused', 'idle', 'off', 'on', 'standby', 'buffering']);
const counts = () => ({ lights: { on: 0, total: 0, unknown: 0, groupsIncluded: false }, media: { playing: 0, total: 0, unknown: 0 } });
const unavailable = (text) => ({ available: false, text, ...counts() });

function currentSession(hass) {
  if (!plain(hass)) return false;
  const user = field(hass, 'user'), connection = field(hass, 'connection');
  if (!plain(user) || !connection || typeof connection !== 'object') return false;
  const id = field(user, 'id');
  if (typeof id !== 'string' || !id.trim() || id.length > 255
    || [...id].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || own(user, 'is_active') && field(user, 'is_active') !== true) return false;
  // HA's actual Connection may be a class instance with a current connected getter.
  try { return connection.connected === true; } catch { return false; }
}

function currentEntity(states, entities, devices, entityId) {
  const state = field(states, entityId);
  if (!plain(state)) return null;
  const value = field(state, 'state'), attr = own(state, 'attributes') ? field(state, 'attributes') : {};
  if (typeof value !== 'string' || !value.trim() || !plain(attr)
    || own(state, 'entity_id') && field(state, 'entity_id') !== entityId
    || own(attr, 'restored') && field(attr, 'restored') !== false) return null;
  const registry = field(entities, entityId);
  if (registry !== undefined && registry !== null && !plain(registry)) return null;
  const selected = {};
  if (registry) for (const key of ['hidden', 'hidden_by', 'disabled', 'disabled_by', 'device_id', 'entity_category']) {
    if (!own(registry, key)) continue;
    const item = field(registry, key);
    if (item === INVALID || ['hidden', 'disabled'].includes(key) && typeof item !== 'boolean'
      || ['hidden_by', 'disabled_by'].includes(key) && item !== null && item !== false && typeof item !== 'string'
      || ['device_id', 'entity_category'].includes(key) && item !== null && typeof item !== 'string') return null;
    selected[key] = item;
  }
  const deviceId = selected.device_id, device = deviceId ? field(devices, deviceId) : undefined;
  const selectedDevice = {};
  if (device !== undefined && device !== null) {
    if (!plain(device)) return null;
    if (own(device, 'disabled_by')) {
      const disabledBy = field(device, 'disabled_by');
      if (disabledBy === INVALID || disabledBy !== null && disabledBy !== false && typeof disabledBy !== 'string') return null;
      selectedDevice.disabled_by = disabledBy;
    }
  }
  // The shared eligibility reader receives only the fields this summary needs.
  // Names, arbitrary state attributes and HA formatters cannot affect counts.
  const metadata = entityMetadata({ states: { [entityId]: { state: value, attributes: {} } },
    entities: { [entityId]: selected }, devices: deviceId ? { [deviceId]: selectedDevice } : {} }, entityId);
  if (!metadata.hasState || metadata.missing || metadata.hidden || metadata.disabled || metadata.category) return null;
  const members = field(attr, 'entity_id');
  let groupMembers = Array.isArray(members) && members.length > 0 && members.length <= ROOM_SUMMARY_LIMITS.entities;
  if (groupMembers) for (let index = 0; index < members.length; index++) {
    if (!identifier(field(members, String(index)))) { groupMembers = false; break; }
  }
  return { value, group: groupMembers || !!registry && field(registry, 'platform') === 'group' };
}

/** Current read-only room header. entityIds must come from the caller's actual
 * room membership; this helper never assigns an entity to a room. Light groups
 * count as one HA light entity, not as their physical members. No clock/actions.
 */
export function buildRoomSummary(options = {}) {
  if (!plain(options)) return unavailable(localize(undefined, 'room.settingsInvalid'));
  const hass = field(options, 'hass');
  if (!currentSession(hass)) return unavailable(localize(hass, 'room.waiting'));
  const entityIds = field(options, 'entityIds');
  if (!Array.isArray(entityIds)) return unavailable(localize(hass, 'room.membersMissing'));
  if (entityIds.length > ROOM_SUMMARY_LIMITS.entities) return unavailable(localize(hass, 'room.membersLimit', { max: ROOM_SUMMARY_LIMITS.entities }));
  const unique = new Set();
  for (let index = 0; index < entityIds.length; index++) {
    const id = field(entityIds, String(index));
    if (!identifier(id)) return unavailable(localize(hass, 'room.memberInvalid'));
    unique.add(id);
  }
  const states = field(hass, 'states'), entities = own(hass, 'entities') ? field(hass, 'entities') : {},
    devices = own(hass, 'devices') ? field(hass, 'devices') : {};
  if (!plain(states) || !plain(entities) || !plain(devices)) return unavailable(localize(hass, 'room.entitiesUnreadable'));
  const out = counts();
  for (const id of unique) {
    const domain = id.split('.')[0];
    if (domain !== 'light' && domain !== 'media_player') continue;
    const source = currentEntity(states, entities, devices, id);
    if (!source) continue;
    if (domain === 'light') {
      out.lights.total++;
      if (source.value === 'on') out.lights.on++;
      else if (source.value !== 'off') out.lights.unknown++;
      out.lights.groupsIncluded ||= source.group;
    } else {
      out.media.total++;
      if (source.value === 'playing') out.media.playing++;
      else if (!knownMediaStates.has(source.value)) out.media.unknown++;
    }
  }
  let text = `${localize(hass, 'room.lightsOn', { count: out.lights.on })} · ${localize(hass, 'room.mediaPlaying', { count: out.media.playing })}`;
  if (out.lights.unknown) text += ` · ${localize(hass, 'room.lightsUnknown', { count: out.lights.unknown })}`;
  if (out.media.unknown) text += ` · ${localize(hass, 'room.mediaUnknown', { count: out.media.unknown })}`;
  if (out.lights.groupsIncluded) text += ` · ${localize(hass, 'room.groupsIncluded')}`;
  return { available: true, text, ...out };
}

// Compact room readings keep each source and its unit separate. In particular,
// two thermometers are never averaged and a climate target is never presented
// as the measured room temperature. Names are source text, not inferred rooms.
export function buildRoomOverview(options = {}) {
  const empty = { available:false,temperatures:[],media:[] };
  const summary = buildRoomSummary(options); if (!summary.available) return empty;
  const hass = field(options,'hass'), ids = field(options,'entityIds'), states = field(hass,'states');
  const entities = own(hass,'entities') ? field(hass,'entities') : {}, devices = own(hass,'devices') ? field(hass,'devices') : {};
  const out = { available:true,temperatures:[],media:[] }, seen = new Set();
  const sourceText = (value) => typeof value === 'string' && value.length <= 512 && value.trim() ? value : null;
  const safeName = (id,registry,attr) => sourceText(registry && field(registry,'name')) || sourceText(field(attr,'friendly_name')) || id;
  for (let index = 0; index < ids.length; index++) {
    const id = field(ids,String(index)); if (seen.has(id)) continue; seen.add(id);
    const current = currentEntity(states,entities,devices,id); if (!current) continue;
    const source = field(states,id), attr = field(source,'attributes') || {}, registry = field(entities,id), domain = id.split('.')[0];
    const name = safeName(id,registry,attr);
    if (domain === 'media_player') {
      const title = sourceText(field(attr,'media_title'));
      const rawState = field(source,'state'), key = `roomSheet.state.${rawState}`;
      const fallback = (roomSheetCaptions[localeInfo(hass).resolved] || roomSheetCaptions.en)[key] || roomSheetCaptions.en[key] || rawState;
      out.media.push({ entityId:id,name,value:[localize(hass,key,{},fallback),title].filter(Boolean).join(' · ') });
      continue;
    }
    const sensor = domain === 'sensor' && field(attr,'device_class') === 'temperature', climate = domain === 'climate';
    if (!sensor && !climate) continue;
    if (['unknown','unavailable'].includes(current.value)) continue;
    const raw = sensor ? field(source,'state') : field(attr,'current_temperature');
    const number = typeof raw === 'number' ? raw : typeof raw === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(number)) continue;
    let unit = climate ? sourceText(field(attr,'temperature_unit')) || field(attr,'unit_of_measurement') : field(attr,'unit_of_measurement');
    if (climate && !sourceText(unit)) {
      const config = field(hass,'config'), system = plain(config) ? field(config,'unit_system') : undefined;
      unit = plain(system) ? field(system,'temperature') : undefined;
    }
    if (!sourceText(unit)) continue;
    // Restrict the shared formatter to owned scalar source data. Arbitrary
    // source attributes/getters and HA action/formatter callbacks stay outside.
    const precision = registry && field(registry,'display_precision');
    const formatted = formatEntityValue({ locale:field(hass,'locale'),language:field(hass,'language'),
      states:{[id]:{state:typeof raw === 'string' ? raw : String(number),attributes:{unit_of_measurement:unit}}},
      entities:{[id]:Number.isInteger(precision) && precision >= 0 && precision <= 100 ? {display_precision:precision} : {}},devices:{} },id);
    out.temperatures.push({ entityId:id,name,value:formatted });
  }
  return out;
}
