// Exact HA control contracts, read-only until the popup accepts a deliberate
// native gesture. Flags/payloads verified against installed Home Assistant
// components/{media_player,climate,cover,lock,vacuum}/{const.py,services.py}.
// HA server permissions remain authoritative; user permissions are never guessed.
import { entityMetadata } from './entity-metadata.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const number = (value) => finite(value) ? value : typeof value === 'string' && value.trim() !== ''
  && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const enumValues = (value, allowed) => Array.isArray(value) && value.length > 0 && value.length <= 64
  && value.every((item) => typeof item === 'string' && item.trim() && item.length <= 128 && (!allowed || allowed.includes(item)))
  && new Set(value).size === value.length ? [...value] : [];
const STATES = Object.freeze({ media_player: ['off','on','idle','playing','paused','standby','buffering'],
  climate: ['off','heat','cool','heat_cool','auto','dry','fan_only'], cover: ['closed','closing','open','opening'],
  lock: ['jammed','opening','locking','open','unlocking','locked','unlocked'],
  vacuum: ['cleaning','docked','idle','paused','returning','error'] });

/** Stable authentication identities plus actual reported permission semantics.
 * The language and normal current readings are deliberately absent.
 */
export function deviceAuthContext(hass) {
  if (hass?.connection?.connected !== true || hass.connected === false || typeof hass.callService !== 'function'
    || typeof hass.user?.id !== 'string' || !hass.user.id.trim() || hass.user.is_active === false) return null;
  let semantic;
  try { semantic = JSON.stringify([hass.user.id,hass.user.is_active,hass.user.is_admin,hass.user.permissions]); }
  catch { return null; }
  return { connection: hass.connection, auth: hass.auth, callService: hass.callService, userId: hass.user.id, semantic };
}
export const sameDeviceAuth = (before, after) => !!before && !!after && before.connection === after.connection
  && before.auth === after.auth && before.callService === after.callService && before.userId === after.userId && before.semantic === after.semantic;

export function readDeviceControls(hass, entityId) {
  const metadata = entityMetadata(hass,entityId), domain = metadata.domain, state = metadata.state, attr = state?.attributes;
  const attributes = plain(attr) ? attr : {};
  const source = !!state && (state.entity_id === undefined || state.entity_id === entityId)
    && STATES[domain]?.includes(state.state) && plain(attr) && (!Object.hasOwn(attributes,'restored') || attributes.restored === false);
  const available = !!source && metadata.available && !metadata.hidden && !metadata.category && !!deviceAuthContext(hass);
  const features = metadata.supportedFeatures;
  const has = (mask) => (BigInt(features) & BigInt(mask)) === BigInt(mask);
  const services = (service) => plain(hass?.services?.[domain]?.[service]);
  const controls = [];
  const add = (id, service, flag, extras = {}) => {
    if ((flag === null || has(flag)) && services(service)) controls.push({ id, domain, service, type:'button',
      labelKey:`deviceControls.${id}`, available, ...extras });
  };
  if (domain === 'media_player') {
    for (const [id,service,flag] of [['play','media_play',16384],['pause','media_pause',1],['stop','media_stop',4096],
      ['previous','media_previous_track',16],['next','media_next_track',32]]) add(id,service,flag);
    if (typeof attributes.is_volume_muted === 'boolean') add('mute','volume_mute',8,{ labelKey:`deviceControls.${attributes.is_volume_muted ? 'unmute' : 'mute'}`,
      parameter:'is_volume_muted', fixedValue:!attributes.is_volume_muted });
    add('volume','volume_set',4,{type:'number',parameter:'volume_level',min:0,max:100,step:'any',unit:'%',
      value:finite(attributes.volume_level) && attributes.volume_level >= 0 && attributes.volume_level <= 1 ? attributes.volume_level * 100 : null});
  } else if (domain === 'climate') {
    const unit = hass?.config?.unit_system?.temperature, min = attributes.min_temp, max = attributes.max_temp, step = attributes.target_temp_step;
    // Bounds/unit come only from this actual HA source. A range thermostat uses
    // HA All controls; a single-target editor never invents a paired range.
    if (state?.state !== 'heat_cool' && finite(min) && finite(max) && min < max && ['°C','°F','K'].includes(unit)) add('temperature','set_temperature',1,
      {type:'number',parameter:'temperature',min,max,step:finite(step) && step > 0 ? step : 'any',unit,
        value:finite(attributes.temperature) && attributes.temperature >= min && attributes.temperature <= max ? attributes.temperature : null});
    const options = enumValues(attributes.hvac_modes,STATES.climate);
    if (options.length) add('hvac-mode','set_hvac_mode',null,{type:'select',parameter:'hvac_mode',options,
      value:options.includes(state?.state) ? state.state : null});
  } else if (domain === 'cover') {
    for (const [id,service,flag] of [['open','open_cover',1],['close','close_cover',2],['stop','stop_cover',8]]) add(id,service,flag);
    add('position','set_cover_position',4,{type:'number',parameter:'position',min:0,max:100,step:1,unit:'%',
      value:Number.isInteger(attributes.current_position) && attributes.current_position >= 0 && attributes.current_position <= 100 ? attributes.current_position : null});
  } else if (domain === 'lock') {
    // HA lock/unlock have no feature-bit requirement. Code-required devices
    // remain available through All controls; this inline view never guesses a PIN.
    if (attributes.code_format === undefined || attributes.code_format === null || attributes.code_format === '') {
      add('lock','lock',null); add('unlock','unlock',null);
    }
  } else if (domain === 'vacuum') {
    for (const [id,service,flag] of [['start','start',8192],['pause','pause',4],['stop','stop',8],['dock','return_to_base',16]]) add(id,service,flag);
    const options = enumValues(attributes.fan_speed_list);
    if (options.length) add('fan-speed','set_fan_speed',32,{type:'select',parameter:'fan_speed',options,
      value:options.includes(attributes.fan_speed) ? attributes.fan_speed : null});
  }
  const sourceKey = JSON.stringify([entityId,metadata.deviceId,metadata.areaId,metadata.disabled,metadata.hidden,metadata.category,!!source,
    controls.map(({id,service,type,parameter,min,max,step,unit,options,fixedValue,available}) => [id,service,type,parameter,min,max,step,unit,options,fixedValue,available])]);
  const readings = source && domain === 'media_player' ? ['media_title','media_artist'].map((key) => attributes[key])
    .filter((value) => typeof value === 'string' && value.trim() && value.length <= 512) : [];
  return {entityId,domain,available,controls,sourceKey,readings};
}

/** Re-read exact current capability/service/source and validate the submitted
 * native value. Never accept a caller-supplied service or arbitrary payload.
 */
export function deviceCommand(hass,entityId,controlId,value) {
  const source = readDeviceControls(hass,entityId), control = source.controls.find((item) => item.id === controlId);
  if (!source.available || !control?.available) return null;
  const data = {entity_id:entityId};
  if (control.type === 'number') {
    const current = number(value);
    if (current === null || current < control.min || current > control.max) return null;
    if (finite(control.step) && Math.abs((current-control.min)/control.step - Math.round((current-control.min)/control.step)) > 1e-7) return null;
    data[control.parameter] = control.id === 'volume' ? current/100 : current;
  } else if (control.type === 'select') {
    if (!control.options.includes(value)) return null;
    data[control.parameter] = value;
  } else if (control.parameter) data[control.parameter] = control.fixedValue;
  return {domain:control.domain,service:control.service,data};
}
