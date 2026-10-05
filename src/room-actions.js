// Explicit room shortcuts. Reading this module never sends a device command.
import { entityMetadata } from './entity-metadata.js';
import { sceneActivationAvailability } from './scene-preview.js';
import { inspectSourceValue } from './imported-source-controls.js';
import { localeInfo, localize } from './localization.js';
import messages from './translations/status-overlays.js';

const text = (hass,key) => localize(hass,`roomActions.${key}`,{},
  (messages[localeInfo(hass).resolved] || messages.en)[`roomActions.${key}`] || messages.en[`roomActions.${key}`] || '');

export const ROOM_ACTION_LIMITS = Object.freeze({ rooms: 128, perRoom: 12, total: 512, label: 160 });
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const data = (value, key) => {
  if (!value || typeof value !== 'object') return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
};
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const roomId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const entityId = (value) => typeof value === 'string' && /^(scene|script)\.[a-z0-9_]+$/.test(value);
const issue = (code, message) => ({ code, message });

/** Strict known collection envelope; imported unknown fields remain in raw data. */
export function readRoomActions(value, hass) {
  if (value === undefined) return { valid: true, rooms: [], diagnostics: [] };
  const diagnostics = [];
  if (!inspectSourceValue(value).readable || !plain(value) || data(value, 'version') !== 1 || !Array.isArray(data(value, 'rooms'))) {
    return { valid: false, rooms: [], diagnostics: [issue('settings', text(hass,'settings'))] };
  }
  const rows = data(value, 'rooms');
  if (rows.length > ROOM_ACTION_LIMITS.rooms) return { valid: false, rooms: [], diagnostics: [issue('limit', text(hass,'roomsLimit'))] };
  let total = 0;
  for (const row of rows) {
    if (!plain(row) || !roomId(data(row, 'room_id')) || !Array.isArray(data(row, 'actions')) || data(row, 'actions').length > ROOM_ACTION_LIMITS.perRoom) {
      diagnostics.push(issue('room', text(hass,'room'))); continue;
    }
    total += data(row, 'actions').length;
  }
  if (total > ROOM_ACTION_LIMITS.total) diagnostics.push(issue('limit', text(hass,'actionsLimit')));
  const ids = rows.map((row) => data(row, 'room_id'));
  if (new Set(ids).size !== ids.length) diagnostics.push(issue('duplicate_room', text(hass,'duplicateRoom')));
  return { valid: diagnostics.length === 0, rooms: diagnostics.length ? [] : rows, diagnostics };
}

export function roomActionAvailability(hass, entity) {
  if (!entityId(entity)) return { available: false, issue: text(hass,'entity') };
  const domain = entity.split('.')[0];
  if (domain === 'scene') {
    const result = sceneActivationAvailability(hass, entity);
    return { available: result.available, issue: result.diagnostics.map((item) => {
      const code = data(item,'code');
      // Translate known source-reader codes; keep readable future diagnostics.
      // Do not inspect a diagnostic getter or guess from its English wording.
      return typeof code === 'string' && own(messages.en,`roomActions.scene.${code}`) ? text(hass,`scene.${code}`)
        : typeof data(item,'message') === 'string' ? data(item,'message') : '';
    }).join(' ') };
  }
  const metadata = entityMetadata(hass, entity), state = metadata.state, attributes = state?.attributes;
  const available = hass?.connection?.connected === true && typeof hass?.user?.id === 'string' && !!hass.user.id.trim()
    && hass.user.is_active !== false && typeof hass.callService === 'function' && !!hass.services?.script?.turn_on
    && !metadata.hidden && !metadata.disabled && !metadata.category && plain(state)
    && ['on', 'off'].includes(state.state) && (state.entity_id === undefined || state.entity_id === entity)
    && (attributes === undefined || plain(attributes) && (!own(attributes, 'restored') || attributes.restored === false));
  return { available, issue: available ? '' : text(hass,'scriptUnavailable') };
}

/** rooms are current canonical room objects; duplicate/missing IDs never select a substitute. */
export function roomActionsFor({ hass, settings, roomId: selected, rooms = [] } = {}) {
  const parsed = readRoomActions(settings,hass), diagnostics = [...parsed.diagnostics];
  const matches = Array.isArray(rooms) ? rooms.filter((room) => room?.id === selected) : [];
  if (matches.length !== 1) diagnostics.push(issue('current_room', text(hass,'currentRoom')));
  const row = parsed.rooms.find((entry) => data(entry, 'room_id') === selected);
  const actions = [];
  if (!diagnostics.length && row) {
    const raw = data(row, 'actions'), ids = raw.map((entry) => data(entry, 'id'));
    for (const entry of raw) {
      const actionId = data(entry, 'id'), entity = data(entry, 'entity'), label = data(entry, 'label');
      const valid = plain(entry) && id(actionId) && ids.filter((value) => value === actionId).length === 1 && entityId(entity)
        && (label === undefined || typeof label === 'string' && label.length <= ROOM_ACTION_LIMITS.label)
        && (data(entry, 'service') === undefined || data(entry, 'service') === 'turn_on');
      if (!valid) { diagnostics.push(issue('action', text(hass,'action'))); continue; }
      const status = roomActionAvailability(hass, entity);
      actions.push({ id: actionId, label: label?.trim() ? label : entityMetadata(hass, entity).name || entity,
        entityId: entity, domain: entity.split('.')[0], service: 'turn_on', ...status });
    }
  }
  // Availability belongs to the current source; ordinary language/name/readings
  // cannot reinterpret an existing held gesture. The popup also fences identities.
  const contextKey = JSON.stringify([selected, matches.map((room) => [room.id, room.floor_id, room.area_id]),
    parsed.valid, row, hass?.connection?.connected, hass?.user?.id, hass?.user?.is_active, hass?.user?.permissions,
    actions.map((action) => [action.id, action.entityId, action.available])]);
  return { actions, contextKey, diagnostics };
}

/** One explicit selected-room edit; preserve every other raw room and extra field. */
export function replaceRoomActions(settings, selected, actions) {
  const parsed = readRoomActions(settings);
  if (!parsed.valid || !roomId(selected) || !Array.isArray(actions) || actions.length > ROOM_ACTION_LIMITS.perRoom) return null;
  // Validate the complete deliberate draft before copying anything. In particular,
  // importing an accessor must never execute it through an object spread.
  if (!inspectSourceValue(actions).readable) return null;
  const ids = actions.map((action) => data(action, 'id'));
  if (actions.some((action) => !plain(action) || !id(data(action, 'id'))
    || ids.filter((value) => value === data(action, 'id')).length !== 1
    || !entityId(data(action, 'entity'))
    || data(action, 'label') !== undefined && (typeof data(action, 'label') !== 'string' || data(action, 'label').length > ROOM_ACTION_LIMITS.label)
    || data(action, 'service') !== undefined && data(action, 'service') !== 'turn_on')) return null;
  const previous = parsed.rooms.find((room) => data(room, 'room_id') === selected);
  const row = { ...previous, room_id: selected, actions: actions.map((action) => ({ ...action })) };
  const rows = previous ? parsed.rooms.map((room) => room === previous ? row : room) : [...parsed.rooms, row];
  const result = { ...(settings || {}), version: 1, rooms: rows };
  return readRoomActions(result).valid ? result : null;
}
