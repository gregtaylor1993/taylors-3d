// Saved custom controls and current action descriptors. This module never calls HA.
import { entityMetadata } from './entity-metadata.js';
import { roomActionAvailability } from './room-actions.js';
import { inspectSourceValue } from './imported-source-controls.js';
import { localize } from './localization.js';

export const CUSTOM_CONTROL_COLORS = Object.freeze(['theme', 'amber', 'teal', 'blue', 'purple', 'red']);
export const CUSTOM_CONTROL_ACTIONS = Object.freeze(['view', 'scene', 'script', 'automation', 'toggle', 'more-info']);
export const CUSTOM_CONTROL_LIMITS = Object.freeze({ bars: 8, buttonsPerBar: 12, total: 96, id: 64, label: 80, icon: 68, roomId: 256 });
const TOGGLE_DOMAINS = ['light', 'switch', 'fan', 'input_boolean'];
const INVALID = Symbol('unreadable');
const own = (value, key) => Object.hasOwn(value, key);
const plain = (value) => {
  try { return !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
  catch { return false; }
};
const field = (value, key) => {
  if (!value || typeof value !== 'object') return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor ? own(descriptor, 'value') ? descriptor.value : INVALID : undefined; }
  catch { return INVALID; }
};
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const controlCharacters = (value) => [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const reference = (value) => typeof value === 'string' && value.length > 0 && value.length <= CUSTOM_CONTROL_LIMITS.roomId && !controlCharacters(value);
const label = (value) => typeof value === 'string' && value.length <= CUSTOM_CONTROL_LIMITS.label;
const entityIdentifier = (value) => typeof value === 'string' && /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value);
const icon = (value) => typeof value === 'string' && value.length <= CUSTOM_CONTROL_LIMITS.icon && /^mdi:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

// Include non-enumerable fields and array properties in the accessor boundary.
// The existing inspector then supplies the shared depth/size/JSON limits.
function readable(value) {
  let nodes = 0;
  const seen = new Set();
  const visit = (entry, depth) => {
    if (++nodes > 10000 || depth > 24) return false;
    if (entry === null || entry === undefined || ['string', 'boolean'].includes(typeof entry)) return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if ((Array.isArray(entry) ? Object.getPrototypeOf(entry) !== Array.prototype : !plain(entry)) || seen.has(entry)) return false;
    seen.add(entry);
    for (const key of Reflect.ownKeys(entry)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor || !own(descriptor, 'value') || !visit(descriptor.value, depth + 1)) return false;
    }
    seen.delete(entry);
    return true;
  };
  try { return visit(value, 0) && inspectSourceValue(value).readable; } catch { return false; }
}

const captions = {
  settings: 'These saved buttons and bars need review. Replace them explicitly to start again.',
  version: 'This version of the saved buttons and bars is not supported.',
  limit: 'Use at most 8 bars, 12 buttons per bar and 96 buttons altogether.',
  bar: 'Each bar needs a valid ID, label, placement, style and button list.',
  button: 'Each button needs a valid ID, label, MDI icon and palette colour.',
  action: 'Choose a supported action and its exact saved view or entity ID.',
  duplicate_bar: 'Every bar must have a different ID.',
  duplicate_button: 'Every button must have a different ID across all bars.',
  context: 'Wait until editing and loading have finished before using this button.',
  session: 'Wait for a current authenticated Home Assistant connection.',
  room: 'The exact saved room is missing or ambiguous. Review this bar’s room link.',
  view: 'The exact saved view is missing, hidden or ambiguous. Review this button’s view link.',
  source: 'The selected entity has no usable current reading or is hidden, disabled or diagnostic.',
  service: 'Home Assistant does not currently advertise this action for the selected entity.',
  condition: 'Choose an exact entity and state for this button’s visibility rule.',
  condition_missing: 'The visibility source is missing or unavailable. Review this button’s rule.',
  condition_unknown: 'The visibility source has no known current state. This button stays unavailable.',
  condition_false: 'The selected visibility state does not currently match.',
  pinned: 'Choose no more favourites than this bar’s four or five visible places.',
};
const message = (hass, code) => localize(hass, `controls.issue.${code}`, {}, captions[code]);
const diagnostic = (hass, code, detail = {}) => ({ code, message: message(hass, code), ...detail });
const unavailable = (hass, code) => ({ available: false, issue: message(hass, code), issueCode: code });

function validAction(action) {
  if (!plain(action) || !readable(action)) return false;
  const type = field(action, 'type');
  if (!CUSTOM_CONTROL_ACTIONS.includes(type)) return false;
  if (own(action, 'skip_conditions') && (type !== 'automation' || typeof field(action, 'skip_conditions') !== 'boolean')) return false;
  if (type === 'view') return reference(field(action, 'view_id'));
  const entity = field(action, 'entity');
  if (!entityIdentifier(entity)) return false;
  const domain = entity.split('.')[0];
  return type === 'more-info' || type === 'toggle' && TOGGLE_DOMAINS.includes(domain)
    || ['scene', 'script', 'automation'].includes(type) && domain === type;
}

const validVisibility = (value) => plain(value) && readable(value) && field(value, 'type') === 'state'
  && entityIdentifier(field(value, 'entity')) && reference(field(value, 'state'))
  && !['unknown', 'unavailable'].includes(field(value, 'state'));

/** Explicit state comparisons only. Missing evidence is never treated as false. */
export function customControlVisibility({ hass, visibility } = {}) {
  if (visibility === undefined) return { visible: true, conditionStatus: 'none' };
  if (!validVisibility(visibility)) return { visible: true, conditionStatus: 'invalid', ...unavailable(hass, 'condition') };
  const source = currentSource(hass, field(visibility, 'entity'));
  if (!source) return { visible: true, conditionStatus: 'missing', ...unavailable(hass, 'condition_missing') };
  if (source.state === 'unknown') return { visible: true, conditionStatus: 'unknown', ...unavailable(hass, 'condition_unknown') };
  return source.state === field(visibility, 'state') ? { visible: true, conditionStatus: 'matched' }
    : { visible: false, conditionStatus: 'false', ...unavailable(hass, 'condition_false') };
}

/** Validate the whole known envelope, retaining the original raw rows and extras. */
export function readCustomControls(settings, hass) {
  if (settings === undefined) return { valid: true, bars: [], diagnostics: [] };
  if (!plain(settings) || !readable(settings)) return { valid: false, bars: [], diagnostics: [diagnostic(hass, 'settings')] };
  if (field(settings, 'version') !== 1) return { valid: false, bars: [], diagnostics: [diagnostic(hass, 'version')] };
  const bars = field(settings, 'bars');
  if (!Array.isArray(bars)) return { valid: false, bars: [], diagnostics: [diagnostic(hass, 'settings')] };
  if (bars.length > CUSTOM_CONTROL_LIMITS.bars) return { valid: false, bars: [], diagnostics: [diagnostic(hass, 'limit')] };
  const diagnostics = [], barIds = new Set(), buttonIds = new Set();
  let total = 0;
  for (const bar of bars) {
    const barId = field(bar, 'id'), buttons = field(bar, 'buttons'), placement = field(bar, 'placement');
    const detail = identifier(barId) ? { barId } : {};
    if (!plain(bar) || !identifier(barId) || !label(field(bar, 'label')) || !['bottom', 'room'].includes(placement)
      || placement === 'room' && !reference(field(bar, 'room_id')) || !['pills', 'tiles'].includes(field(bar, 'style')) || !Array.isArray(buttons)) {
      diagnostics.push(diagnostic(hass, 'bar', detail)); continue;
    }
    if (barIds.has(barId)) diagnostics.push(diagnostic(hass, 'duplicate_bar', detail));
    barIds.add(barId);
    const dock = field(bar, 'dock');
    if (own(bar, 'dock') && (!plain(dock) || ![4, 5].includes(field(dock, 'limit')))) diagnostics.push(diagnostic(hass, 'bar', detail));
    if (plain(dock) && buttons.filter((button) => field(button, 'pinned') === true).length > field(dock, 'limit')) diagnostics.push(diagnostic(hass, 'pinned', detail));
    total += buttons.length;
    if (buttons.length > CUSTOM_CONTROL_LIMITS.buttonsPerBar) diagnostics.push(diagnostic(hass, 'limit', detail));
    for (const button of buttons) {
      const buttonId = field(button, 'id'), buttonDetail = { ...detail, ...(identifier(buttonId) ? { buttonId } : {}) };
      if (!plain(button) || !identifier(buttonId) || !label(field(button, 'label')) || !icon(field(button, 'icon')) || !CUSTOM_CONTROL_COLORS.includes(field(button, 'color'))) {
        diagnostics.push(diagnostic(hass, 'button', buttonDetail)); continue;
      }
      if (buttonIds.has(buttonId)) diagnostics.push(diagnostic(hass, 'duplicate_button', buttonDetail));
      buttonIds.add(buttonId);
      if (!validAction(field(button, 'action'))) diagnostics.push(diagnostic(hass, 'action', buttonDetail));
      if (own(button, 'pinned') && typeof field(button, 'pinned') !== 'boolean') diagnostics.push(diagnostic(hass, 'button', buttonDetail));
      if (own(button, 'visibility') && !validVisibility(field(button, 'visibility'))) diagnostics.push(diagnostic(hass, 'condition', buttonDetail));
    }
  }
  if (total > CUSTOM_CONTROL_LIMITS.total) diagnostics.push(diagnostic(hass, 'limit'));
  return { valid: diagnostics.length === 0, bars: diagnostics.length ? [] : bars, diagnostics };
}

function session(hass) {
  const user = field(hass, 'user'), connection = field(hass, 'connection'), auth = field(hass, 'auth'), callService = field(hass, 'callService');
  const id = field(user, 'id'), active = field(user, 'is_active'), admin = field(user, 'is_admin'), permissions = field(user, 'permissions');
  let connected = false;
  // Native HA Connection is a trusted API and may use a prototype getter.
  // Raw configuration, user fields and entity attributes remain data-only.
  try { connected = connection?.connected === true; } catch { /* disconnected */ }
  const valid = plain(user) && typeof id === 'string' && !!id.trim() && id.length <= 255 && !controlCharacters(id)
    && (active === undefined || active === true) && (admin === undefined || typeof admin === 'boolean') && readable(permissions)
    && connected && field(hass, 'connected') !== false;
  return { valid, connected, connection, auth, callService, user: { id, is_active: active, is_admin: admin, permissions } };
}

function currentService(hass, domain, service) {
  const services = field(hass, 'services'), row = field(services, domain), advertised = field(row, service);
  return plain(services) && plain(row) && plain(advertised) && readable(advertised) ? advertised : null;
}

function currentSource(hass, entity) {
  const states = field(hass, 'states'), registry = field(hass, 'entities'), devices = field(hass, 'devices');
  const state = field(states, entity), entry = field(registry, entity);
  if (!plain(states) || !plain(state) || !readable(state) || entry !== undefined && (!plain(entry) || !readable(entry))
    || registry !== undefined && !plain(registry)) return null;
  const deviceId = field(entry, 'device_id'), device = typeof deviceId === 'string' && deviceId ? field(devices, deviceId) : undefined;
  if (devices !== undefined && !plain(devices) || device !== undefined && (!plain(device) || !readable(device))) return null;
  for (const key of ['hidden', 'disabled']) {
    if (field(entry, key) !== undefined && typeof field(entry, key) !== 'boolean') return null;
  }
  for (const [row, keys] of [[entry, ['device_id', 'area_id', 'entity_category', 'hidden_by', 'disabled_by']],
    [device, ['area_id', 'parent_device_id', 'disabled_by']]]) {
    if (keys.some((key) => { const value = field(row, key); return value !== undefined && value !== null && typeof value !== 'string'; })) return null;
  }
  const projection = { states: { [entity]: state }, entities: entry === undefined ? {} : { [entity]: entry },
    devices: device === undefined ? {} : { [deviceId]: device } };
  const metadata = entityMetadata(projection, entity), attributes = field(state, 'attributes'), stateValue = field(state, 'state');
  if (metadata.hidden || metadata.disabled || metadata.category || typeof stateValue !== 'string' || !stateValue
    || field(state, 'entity_id') !== undefined && field(state, 'entity_id') !== entity
    || attributes !== undefined && !plain(attributes) || field(attributes, 'restored') !== undefined && field(attributes, 'restored') !== false
    || stateValue === 'unavailable') return null;
  return { projection, state: stateValue };
}

function exactEntry(rows, id) {
  if (!Array.isArray(rows) || rows.length > 4096) return null;
  const matches = [];
  for (let index = 0; index < rows.length; index++) {
    const row = field(rows, String(index));
    if (!plain(row) || !reference(field(row, 'id'))) return null;
    if (field(row, 'id') === id) matches.push(row);
  }
  return matches.length === 1 && readable(matches[0]) && field(matches[0], 'stale') !== true ? matches[0] : null;
}

/** Describe only supported current actions. Saved arbitrary service data is inert. */
export function customControlAvailability({ hass, action, views = [], rooms: _rooms = [] } = {}) {
  if (!validAction(action)) return unavailable(hass, 'action');
  const current = session(hass);
  if (!current.valid) return unavailable(hass, 'session');
  const type = field(action, 'type');
  if (type === 'view') {
    const viewId = field(action, 'view_id'), view = exactEntry(views, viewId);
    return view && field(view, 'hidden') !== true ? { available: true, issue: '', viewId } : unavailable(hass, 'view');
  }
  const entityId = field(action, 'entity'), domain = entityId.split('.')[0], source = currentSource(hass, entityId);
  if (!source || source.state === 'unknown' && domain !== 'scene') return unavailable(hass, 'source');
  if (['toggle', 'script', 'automation'].includes(type) && !['on', 'off'].includes(source.state)) return unavailable(hass, 'source');
  if (type === 'more-info') return { available: true, issue: '', entityId };
  const service = type === 'toggle' ? 'toggle' : type === 'automation' ? 'trigger' : 'turn_on';
  const advertised = currentService(hass, domain, service);
  if (!advertised || typeof current.callService !== 'function') return unavailable(hass, 'service');
  if (type === 'scene' || type === 'script') {
    const safeHass = { ...source.projection, connection: { connected: true }, user: current.user, callService: current.callService,
      services: { [domain]: { [service]: advertised } } };
    if (!roomActionAvailability(safeHass, entityId).available) return unavailable(hass, 'source');
  }
  const data = { entity_id: entityId };
  if (type === 'automation') data.skip_condition = field(action, 'skip_conditions') === true;
  return { available: true, issue: '', entityId, domain, service, data,
    ...(['toggle', 'script', 'automation'].includes(type) ? { active: source.state === 'on' } : {}) };
}

const identities = new WeakMap();
let nextIdentity = 1;
const identity = (value) => {
  if (!value || !['object', 'function'].includes(typeof value)) return null;
  if (!identities.has(value)) identities.set(value, nextIdentity++);
  return identities.get(value);
};
const viewIdentity = (view) => view && ['id', 'rules', 'camera', 'cameraFrame', 'camera_topFrame', 'floors', 'cut', 'source',
  'hidden', 'section', 'modelSection', 'camera_top', 'camera_mode', 'zoom_to'].map((key) => [key, field(view, key)]);
const sourceIdentity = (hass, entity) => {
  const source = currentSource(hass, entity);
  if (!source) return null;
  const registry = source.projection.entities[entity], deviceId = field(registry, 'device_id'), device = source.projection.devices[deviceId];
  return [['device_id', 'area_id', 'hidden', 'hidden_by', 'disabled', 'disabled_by', 'entity_category'].map((key) => [key, field(registry, key)]),
    ['area_id', 'parent_device_id', 'disabled_by'].map((key) => [key, field(device, key)])];
};

/** Resolve one placement while keeping unusable saved buttons visible. */
export function resolveCustomControls({ hass, settings, views = [], rooms = [], placement = 'bottom', roomId = null,
  editing = false, loading = false, contextKey = '', selectedViewId, selectedRoomId } = {}) {
  const parsed = readCustomControls(settings, hass), diagnostics = [...parsed.diagnostics], current = session(hass);
  const validContext = ['bottom', 'room'].includes(placement) && (roomId === null || reference(roomId)) && (placement !== 'room' || reference(roomId))
    && typeof editing === 'boolean' && typeof loading === 'boolean' && typeof contextKey === 'string';
  if (!validContext) diagnostics.push(diagnostic(hass, 'context'));
  const selectedRoom = placement === 'room' && validContext ? exactEntry(rooms, roomId) : null;
  const bars = !validContext ? [] : parsed.bars.filter((bar) => bar.placement === placement && (placement !== 'room' || bar.room_id === roomId)).map((bar) => {
    const missingRoom = placement === 'room' && !selectedRoom;
    if (missingRoom) diagnostics.push(diagnostic(hass, 'room', { barId: bar.id }));
    return { ...bar, ...(reference(selectedRoomId) && exactEntry(rooms, selectedRoomId) ? { selected: bar.placement === 'room' && bar.room_id === selectedRoomId } : {}), buttons: bar.buttons.map((button) => {
      const status = editing || loading ? unavailable(hass, 'context') : missingRoom ? unavailable(hass, 'room')
        : customControlAvailability({ hass, action: button.action, views, rooms });
      const visibility = customControlVisibility({ hass, visibility: field(button, 'visibility') });
      const active = button.action.type === 'view' && reference(selectedViewId) && exactEntry(views, selectedViewId)
        ? { active: selectedViewId === button.action.view_id } : {};
      return { ...button, ...status, ...active, visible: visibility.visible, conditionStatus: visibility.conditionStatus,
        ...(visibility.available === false && !editing && !loading && !missingRoom ? visibility : {}) };
    }) };
  });
  const linkedViews = bars.flatMap((bar) => bar.buttons.filter((button) => button.action.type === 'view')
    .map((button) => [button.id, viewIdentity(exactEntry(views, button.action.view_id))]));
  const linkedSources = bars.flatMap((bar) => bar.buttons.filter((button) => button.action.type !== 'view')
    .map((button) => [button.id, sourceIdentity(hass, button.action.entity)]));
  const linkedConditions = bars.flatMap((bar) => bar.buttons.filter((button) => own(button, 'visibility'))
    .map((button) => [button.id, sourceIdentity(hass, button.visibility.entity), button.conditionStatus]));
  const safeSettings = parsed.valid ? inspectSourceValue(settings).signature : null;
  const key = JSON.stringify([typeof contextKey === 'string' ? contextKey : null, validContext, safeSettings,
    typeof placement === 'string' ? placement : null, typeof roomId === 'string' ? roomId : null,
    typeof editing === 'boolean' ? editing : null, typeof loading === 'boolean' ? loading : null,
    current.valid, current.connected, identity(current.connection), identity(current.auth), identity(current.callService),
    typeof current.user.id === 'string' ? current.user.id : null, typeof current.user.is_active === 'boolean' ? current.user.is_active : null,
    typeof current.user.is_admin === 'boolean' ? current.user.is_admin : null, readable(current.user.permissions) ? inspectSourceValue(current.user.permissions).signature : null,
    selectedRoom ? [selectedRoom.id, field(selectedRoom, 'floor_id'), field(selectedRoom, 'area_id')] : null, linkedViews, linkedSources, linkedConditions,
    reference(selectedViewId) ? selectedViewId : null, reference(selectedRoomId) ? selectedRoomId : null,
    bars.map((bar) => [bar.id, bar.buttons.map((button) => [button.id, button.available, button.issueCode || null])])]);
  return { bars, diagnostics, contextKey: key };
}

const copyWith = (value, overrides) => {
  const descriptors = value ? Object.getOwnPropertyDescriptors(value) : {};
  for (const descriptor of Object.values(descriptors)) { descriptor.configurable = true; descriptor.writable = true; }
  for (const [key, entry] of Object.entries(overrides)) descriptors[key] = { value: entry, writable: true, configurable: true, enumerable: true };
  return Object.defineProperties({}, descriptors);
};

/** Fresh immutable envelope; imported unknown extra fields remain intact. */
export function replaceCustomBars(settings, bars) {
  if (!readCustomControls(settings).valid || !Array.isArray(bars) || !readable(bars)) return null;
  const next = copyWith(settings, { version: 1, bars: [...bars] });
  return readCustomControls(next).valid ? next : null;
}

export function moveCustomBar(settings, barId, beforeBarId = null) {
  const parsed = readCustomControls(settings);
  if (!parsed.valid || !identifier(barId) || beforeBarId !== null && !identifier(beforeBarId)) return null;
  const moving = parsed.bars.find((bar) => bar.id === barId);
  if (!moving || beforeBarId !== null && !parsed.bars.some((bar) => bar.id === beforeBarId)) return null;
  if (barId === beforeBarId) return replaceCustomBars(settings, parsed.bars);
  const bars = parsed.bars.filter((bar) => bar !== moving), index = beforeBarId === null ? bars.length : bars.findIndex((bar) => bar.id === beforeBarId);
  bars.splice(index, 0, moving);
  return replaceCustomBars(settings, bars);
}

export function moveCustomButton(settings, fromBarId, buttonId, toBarId, beforeButtonId = null) {
  const parsed = readCustomControls(settings);
  if (!parsed.valid || ![fromBarId, buttonId, toBarId].every(identifier) || beforeButtonId !== null && !identifier(beforeButtonId)) return null;
  const from = parsed.bars.find((bar) => bar.id === fromBarId), to = parsed.bars.find((bar) => bar.id === toBarId);
  const moving = from?.buttons.find((button) => button.id === buttonId);
  if (!moving || !to || beforeButtonId !== null && !to.buttons.some((button) => button.id === beforeButtonId)
    || from !== to && to.buttons.length >= CUSTOM_CONTROL_LIMITS.buttonsPerBar) return null;
  if (from === to && buttonId === beforeButtonId) return replaceCustomBars(settings, parsed.bars);
  const target = to.buttons.filter((button) => button !== moving), index = beforeButtonId === null ? target.length : target.findIndex((button) => button.id === beforeButtonId);
  target.splice(index, 0, moving);
  const bars = parsed.bars.map((bar) => bar === to ? copyWith(bar, { buttons: target })
    : bar === from ? copyWith(bar, { buttons: from.buttons.filter((button) => button !== moving) }) : bar);
  return replaceCustomBars(settings, bars);
}

/** Re-read the exact saved bar/button and its current placement immediately before use. */
export function customControlCommand({ hass, settings, views = [], rooms = [], barId, buttonId, placement = 'bottom', roomId = null,
  editing = false, loading = false } = {}) {
  if (!identifier(barId) || !identifier(buttonId)) return unavailable(hass, 'action');
  const resolved = resolveCustomControls({ hass, settings, views, rooms, placement, roomId, editing, loading });
  const button = resolved.bars.find((bar) => bar.id === barId)?.buttons.find((entry) => entry.id === buttonId);
  if (!button) return unavailable(hass, resolved.diagnostics[0]?.code || 'action');
  if (!button.available) return { available: false, issue: button.issue, issueCode: button.issueCode };
  const { viewId, entityId, domain, service, data } = button;
  if (button.action.type === 'view') return { available: true, issue: '', kind: 'view', viewId };
  if (button.action.type === 'more-info') return { available: true, issue: '', kind: 'more-info', entityId };
  return { available: true, issue: '', kind: 'service', domain, service, data, entityId };
}
