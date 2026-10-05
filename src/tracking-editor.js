// Explicit observation bindings. Drafts and previews never change HA devices or saved layout.
import { entityChoices, entityMetadata, formatEntityValue } from './entity-metadata.js';
import { compileCalibration, readCoordinate, readDetection } from './tracked-source.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const copy = (value) => JSON.parse(JSON.stringify(value));
const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => plain(value) && Object.hasOwn(value, key);
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' ? value.trim() : '';
const number = (value) => (typeof value === 'number' || typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null;
const words = (value) => [...new Set((Array.isArray(value) ? value : String(value ?? '').split(',')).map(text).filter(Boolean))];
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const validOutline = (value) => {
  if (!Array.isArray(value) || value.length < 3 || value.some((point) => !Array.isArray(point) || !finite(point[0]) || !finite(point[1]))) return false;
  return Math.abs(value.reduce((area, point, index) => { const next = value[(index + 1) % value.length]; return area + point[0] * next[1] - next[0] * point[1]; }, 0)) > 1e-9;
};
const sections = { presence: ['Presence', 'presence_bindings'], vehicles: ['Driveway vehicles', 'vehicle_bindings'], vacuums: ['Robot vacuums', 'vacuum_bindings'] };
const kinds = {
  presence: [['room_activity', 'Anonymous room activity'], ['room_location', 'Reported room location']],
  vehicles: [['occupancy', 'Vehicle stays while occupied'], ['count', 'Reported vehicle count'], ['event', 'Vehicle seen recently — expires']],
  vacuums: [['static', 'Status at a fixed room or dock'], ['room', 'Reported room, exact position unknown'], ['xy', 'Measured X/Y position in plan metres']],
};
const locationKinds = [['room', 'Selected room'], ['position', 'Fixed plan position'], ['anchor', 'Existing object or marker']];
const timestampKinds = [['state', 'Entity state contains the event time'], ['attribute', 'An attribute contains the event time'], ['last_changed', 'Explicit pulse when the state changes'], ['last_updated', 'Explicit event when state or attributes change']];
const homeAway = new Set(['home', 'not_home', 'away', 'unknown', 'unavailable']);
const input = (field, label, value, extra = '') => `<label>${esc(label)}<input data-trk-setting data-field="trk-${field}" value="${esc(value)}" ${extra}></label>`;
const option = (value, label, selected, disabled = false) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</option>`;
const select = (field, label, value, choices, extra = '') => `<label>${esc(label)}<select data-trk-setting data-field="trk-${field}" ${extra}>${choices.map(([id, name]) => option(id, name, value)).join('')}</select></label>`;
const check = (field, label, value) => `<label class="trk-check"><input type="checkbox" data-trk-setting data-field="trk-${field}" ${value ? 'checked' : ''}>${esc(label)}</label>`;
const button = (action, label, extra = '') => `<button type="button" data-act="trk-${action}" ${extra}>${esc(label)}</button>`;

/** Domain restrictions are about available observation sources, not inferred capabilities. */
export function trackingEntities(hass = {}, section = 'presence', kind = 'room_activity', selected = '') {
  const domains = section === 'vacuums' ? ['vacuum'] : section === 'vehicles'
    ? kind === 'event' ? ['event', 'sensor', 'binary_sensor', 'input_datetime'] : kind === 'count' ? ['sensor', 'counter', 'input_number'] : ['binary_sensor', 'sensor', 'input_boolean']
    : kind === 'room_activity' ? ['binary_sensor', 'input_boolean', 'sensor'] : ['sensor', 'select', 'input_select', 'device_tracker', 'person'];
  return entityChoices(hass, { domains, selected });
}

/**
 * Parent contract follows OverlayEditor: render(), onChange/onInput(), onClick(),
 * updatePreviews(container), reset()/cancel()/dispose(). Only explicit Save/Clear calls
 * card.commitFeatureLayout({ presence_bindings | vehicle_bindings | vacuum_bindings }).
 * Optional card.trackingAnchors() returns genuine {id,label,position:{x,y,z,floorId}}.
 * room_source maps exact reported strings to room IDs. position_source v1 is explicitly
 * declared, direct plan-metre XY; imported calibrated/GPS sources stay read-only.
 */
export class TrackingEditor {
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.section = 'presence'; this.draft = null;
    this.message = null; this.relinking = false; this.maps = []; this.locationMode = 'room'; this.disposed = false;
  }
  get hass() { return this.card._hass || {}; }
  get floors() { return list(this.card._floors).filter((floor) => typeof floor?.id === 'string'); }
  get rooms() {
    return list(this.card._roomList).filter((entry) => entry?.room?.id).map((entry) => ({
      id: entry.room.id, floorId: entry.floorId ?? entry.room.floor_id, valid: validOutline(entry.room.polygon || entry.room.outline),
      name: entry.name || entry.room.name || entry.room.label || this.hass.areas?.[entry.room.area_id]?.name || entry.room.id,
    }));
  }
  get anchors() {
    return list(this.card.trackingAnchors?.()).filter((anchor) => typeof anchor?.id === 'string' && plain(anchor.position));
  }
  get bindings() {
    const key = sections[this.section][1];
    return list(this.card._layout?.[key] ?? this.card._config?.[key]);
  }
  reset() { this.draft = null; this.maps = []; this.message = null; this.relinking = false; this.previewContainer = null; this.editingIndex = null; }
  cancel() { this.reset(); }
  dispose() { this.reset(); this.disposed = true; }

  _choices(selected = this.draft?.entity) { return trackingEntities(this.hass, this.section, this.draft?.kind, selected); }
  _entitySelect(field, label, selected, choices) {
    return `<label>${esc(label)}<select data-trk-setting data-field="trk-${field}">${option('', 'Choose an actual entity', selected)}${choices.map((choice) => option(choice.value, `${choice.label} · ${choice.value}`, selected, !choice.selectable)).join('')}</select></label>`;
  }
  _roomSelect(field, label, selected, extra = '') {
    const choices = [['', 'Choose a room with an outline'], ...this.rooms.map((room) => [room.id, `${room.name} · ${this._floorName(room.floorId)}`])];
    if (selected && !this.rooms.some((room) => room.id === selected)) choices.push([selected, `Missing room: ${selected}`]);
    return select(field, label, selected, choices, extra);
  }
  _floorSelect(field, label, selected) {
    const choices = [['', 'Choose the actual floor'], ...this.floors.map((floor) => [floor.id, floor.name || floor.id])];
    if (selected && !this.floors.some((floor) => floor.id === selected)) choices.push([selected, `Missing floor: ${selected}`]);
    return select(field, label, selected, choices);
  }
  _floorName(id) { return this.floors.find((floor) => floor.id === id)?.name || id || 'Floor not selected'; }
  _validFloor(id) { const floors = this.floors.filter((floor) => floor.id === id); return floors.length === 1 && finite(floors[0].elevation); }
  _validRoom(id) { const rooms = this.rooms.filter((room) => room.id === id); return rooms.length === 1 && rooms[0].valid && this._validFloor(rooms[0].floorId); }
  _sourceReferences() {
    const draft = this.draft;
    if (!draft) return [];
    return [['Source', draft.entity], ['Identity', draft.identity_entity], ['Room source', draft.room_source?.entity], ['Position source', draft.position_source?.entity]].filter(([, entity]) => entity);
  }
  _referenceIssues() {
    if (!this.draft) return [];
    const issues = [];
    for (const [label, entity] of this._sourceReferences()) {
      const metadata = entityMetadata(this.hass, entity);
      if (!metadata.hasState || metadata.hidden || metadata.disabled || metadata.category) issues.push(`${label} ${entity} is ${metadata.missing ? 'missing' : !metadata.hasState ? 'without a current state' : metadata.disabled ? 'disabled' : metadata.hidden ? 'hidden' : 'a configuration or diagnostic entity'}.`);
    }
    const draft = this.draft;
    const rooms = [draft.roomId, ...this.maps.map((row) => row.roomId)].filter(Boolean);
    for (const id of new Set(rooms)) if (!this.rooms.some((room) => room.id === id)) issues.push(`Saved room ${id} is missing.`);
    for (const id of new Set([draft.position?.floorId, draft.position_source?.floorId].filter(Boolean))) if (!this.floors.some((floor) => floor.id === id)) issues.push(`Saved floor ${id} is missing.`);
    if (draft.position_key && !this.anchors.some((anchor) => anchor.id === draft.position_key)) issues.push(`Saved anchor ${draft.position_key} is missing.`);
    const source = draft.position_source;
    if (this.section === 'vacuums' && draft.kind === 'xy' && source && (source.source && source.source !== 'xy' || source.units && source.units !== 'm' || source.calibration?.length)) issues.push('This saved coordinate source uses calibration or different units. It is preserved; deliberately relink to direct plan metres, or edit it with a calibration tool.');
    return issues;
  }
  _readOnly() { return !this.relinking && this._referenceIssues().length > 0; }

  _start(binding, index = null) {
    this.draft = copy(binding); this.message = null; this.relinking = false;
    this.editingIndex = index;
    if (!text(this.draft.id)) {
      let next = 1; while (this.bindings.some((item) => item?.id === `${this.section}_${next}`)) next++;
      this.draft.id = `${this.section}_${next}`;
    }
    this.locationMode = this.draft.position_key ? 'anchor' : this.draft.position ? 'position' : 'room';
    const source = this.draft.room_source;
    this.maps = plain(source?.room_map) ? Object.entries(source.room_map).flatMap(([value, roomId]) => list(roomId).length ? roomId.map((id) => ({ value, roomId: id })) : [{ value, roomId }]) : [];
    this.onRender();
  }
  _new() {
    const prefix = this.section === 'vehicles' ? 'vehicle' : this.section === 'vacuums' ? 'vacuum' : 'presence';
    let next = 1; while (this.bindings.some((binding) => binding?.id === `${prefix}_${next}`)) next++;
    const kind = kinds[this.section][0][0];
    this._start({ id: `${prefix}_${next}`, kind, entity: '', label: '', enabled: true,
      ...(this.section !== 'vacuums' ? { active_states: ['on'], clear_states: ['off'] } : {}),
      ...(this.section === 'presence' ? { signal: 'motion' } : {}) });
  }
  _commit(bindings) {
    const patch = { [sections[this.section][1]]: bindings };
    if (this.card.commitFeatureLayout) this.card.commitFeatureLayout(patch);
    else this.card._commit({ ...this.card._layout, ...patch });
    this.reset(); this.onRender();
  }
  _location() {
    const draft = this.draft;
    if (this.locationMode === 'room') return this._roomSelect('room', 'Display in this room', draft.roomId);
    if (this.locationMode === 'anchor') {
      const choices = [['', 'Choose an existing mapped object'], ...this.anchors.map((anchor) => [anchor.id, `${anchor.label || anchor.id} · ${this._floorName(anchor.position.floorId ?? anchor.position.floor_id)}`])];
      if (draft.position_key && !this.anchors.some((anchor) => anchor.id === draft.position_key)) choices.push([draft.position_key, `Missing anchor: ${draft.position_key}`]);
      return select('anchor', 'Use this object or marker position', draft.position_key, choices);
    }
    const position = draft.position || {};
    return `<p class="trk-hint">Plan metres: X is east, Y is north; height is above the selected floor. This is a fixed display location, not a measured moving position.</p>${this._floorSelect('floor', 'Floor', position.floorId)}
      ${input('x', 'X — metres east', position.x, 'type="number" step="any"')}${input('y', 'Y — metres north', position.y, 'type="number" step="any"')}${input('z', 'Height above floor, metres', position.z ?? 0, 'type="number" step="any"')}`;
  }
  _roomMapping() {
    const source = this.draft.room_source || {};
    const choices = entityChoices(this.hass, { domains: ['sensor', 'select', 'input_select', 'device_tracker', 'person'], selected: source.entity });
    return `<section><h4>Exact reported room names</h4>${this._entitySelect('room-source', 'Room location source', source.entity, choices)}
      ${input('room-attribute', 'Room attribute (leave blank to use the entity state)', source.attribute)}
      <p class="trk-hint">Map a value that really reports a room. Home/away and a sensor’s registered area do not say which room a person or vacuum is in. Values match exactly.</p>
      ${this.maps.map((row, index) => `<div class="trk-map">${input('map-value', 'Reported room value', row.value, `data-index="${index}"`)}${this._roomSelect('map-room', 'Actual room', row.roomId, `data-index="${index}"`)}${button('remove-map', 'Remove mapping', `data-index="${index}" data-trk-setting`)}</div>`).join('')}
      ${button('add-map', 'Add room mapping', 'data-trk-setting')}</section>`;
  }
  _identity() {
    const draft = this.draft;
    if (this.section === 'presence') return this._entitySelect('identity', 'Person or device associated with this room source (optional)', draft.identity_entity, entityChoices(this.hass, { domains: ['person', 'device_tracker'], selected: draft.identity_entity }));
    return `<section><h4>Confirmed vehicle identity (optional)</h4><p class="trk-hint">Leave this blank for an anonymous vehicle. A camera name or the label above is not evidence of which car was seen.</p>
      ${this._entitySelect('identity', 'Source that reports the real vehicle identifier', draft.identity_entity, entityChoices(this.hass, { domains: ['sensor', 'device_tracker', 'event'], selected: draft.identity_entity }))}
      ${draft.identity_entity ? `${input('identity-attribute', 'Identifier attribute (blank uses state)', draft.identity_attribute)}${input('identity-value', 'Exact confirmed identifier to match', draft.identity_value)}` : ''}</section>`;
  }
  _eventFields() {
    const draft = this.draft;
    return `<section><h4>When does “seen recently” end?</h4><p class="trk-hint">A sighting is not proof that a car remains parked. Expiry uses the source’s event time; repeated dashboard updates do not extend it.</p>
      ${select('timestamp-mode', 'Event time source', draft.timestamp_mode, [['', 'Choose how this source reports time'], ...timestampKinds])}
      ${draft.timestamp_mode === 'attribute' ? input('timestamp-attr', 'Timestamp attribute path', draft.timestamp_attr) : ''}
      ${['state', 'attribute'].includes(draft.timestamp_mode) ? select('timestamp-format', 'Timestamp format', draft.timestamp_format || 'iso', [['iso', 'ISO date/time'], ['seconds', 'Unix seconds'], ['milliseconds', 'Unix milliseconds']]) : ''}
      ${input('expires', 'Show as seen recently for this many seconds', draft.expires_seconds, 'type="number" min="1" max="86400" step="1"')}
      <p class="trk-hint">If this source reports several event types, accept only its vehicle sightings below. Leave the filter blank only when the chosen source is dedicated to vehicle sightings.</p>
      ${input('event-types', 'Vehicle event types to accept, separated by commas (optional for a vehicle-only source)', words(draft.event_types).join(', '))}
      ${input('event-type-attr', 'Event type attribute path', draft.event_type_attr || 'event_type')}${input('event-id-attr', 'Event identifier attribute path (optional)', draft.event_id_attr)}</section>`;
  }
  _xyFields() {
    const source = this.draft.position_source || {};
    return `<section><h4>Measured coordinates</h4><p class="trk-hint">These must be real coordinates reported by the integration. This first editor supports values already aligned to this plan in metres. Pixel maps, GPS and coordinates needing rotation/scale need calibration first.</p>
      ${this._entitySelect('position-source', 'Position source (separate from vacuum status)', source.entity, entityChoices(this.hass, { domains: ['sensor', 'device_tracker', 'vacuum'], selected: source.entity }))}
      ${input('x-attr', 'X attribute path — metres east', source.x_attr)}${input('y-attr', 'Y attribute path — metres north', source.y_attr)}
      ${this._floorSelect('position-floor', 'Floor reported by these coordinates', source.floorId)}
      ${check('plan-metres', 'I confirm these X/Y values already use this plan’s metre coordinates', source.plan_meters === true && source.units === 'm')}
      <p class="trk-hint">If no valid measured position is reported, the vacuum remains at the fixed display location below and says its moving location is not reported. No cleaning route is invented.</p></section>`;
  }

  _raw() {
    const draft = copy(this.draft);
    draft.label = text(draft.label); draft.enabled = draft.enabled !== false;
    if (this.section === 'presence' && draft.kind === 'room_activity' || this.section === 'vehicles' && draft.kind === 'occupancy') {
      draft.active_states = words(draft.active_states); draft.clear_states = words(draft.clear_states);
    }
    if (this.section === 'vehicles' && draft.kind === 'event') {
      draft.expires_seconds = number(draft.expires_seconds); draft.event_types = words(draft.event_types);
      if (!draft.event_types.length) delete draft.event_types;
      draft.event_type_attr = text(draft.event_type_attr) || 'event_type';
      draft.timestamp_format = draft.timestamp_format || 'iso';
      for (const key of ['timestamp_attr', 'event_id_attr']) if (!text(draft[key])) delete draft[key]; else draft[key] = text(draft[key]);
    }
    if (this.section === 'presence' && draft.kind === 'room_location' || this.section === 'vacuums' && draft.kind === 'room') {
      const source = draft.room_source || {};
      draft.room_source = { ...source, entity: source.entity || draft.entity, room_map: Object.fromEntries(this.maps.map((row) => [row.value, row.roomId])) };
      if (!text(source.attribute)) delete draft.room_source.attribute; else draft.room_source.attribute = text(source.attribute);
    }
    if (this.section === 'vacuums' && draft.kind === 'xy') {
      draft.position_source = { ...draft.position_source, source: 'xy', units: 'm', plan_meters: draft.position_source?.plan_meters === true };
    }
    if (this.section === 'presence' && draft.kind === 'room_location') { delete draft.position; delete draft.position_key; delete draft.roomId; }
    else if (this.locationMode === 'room') { delete draft.position; delete draft.position_key; }
    else if (this.locationMode === 'anchor') { delete draft.position; delete draft.roomId; }
    else {
      delete draft.position_key; delete draft.roomId;
      draft.position = { ...draft.position, x: number(draft.position?.x), y: number(draft.position?.y), z: number(draft.position?.z ?? 0) };
    }
    if (!draft.identity_entity) { delete draft.identity_entity; delete draft.identity_attribute; delete draft.identity_value; }
    return draft;
  }
  _validEntity(entity, choices, message, issues) { if (!choices.some((choice) => choice.value === entity && choice.selectable)) issues.push(message); }
  _validation() {
    if (!this.draft) return [];
    const draft = this._raw(), issues = [];
    if (!kinds[this.section].some(([kind]) => kind === draft.kind)) issues.push('This saved tracking type is unsupported. Clear it and create an explicit binding.');
    if (this.bindings.some((binding, index) => index !== this.editingIndex && binding?.id === draft.id)) issues.push('Saved binding IDs must be unique. Clear the duplicate binding before editing it.');
    this._validEntity(draft.entity, this._choices(draft.entity), 'Choose an actual source entity for this tracking type.', issues);
    if (this._readOnly()) issues.push('Saved references are read-only. Restore them, deliberately Relink, or Clear this binding.');
    if (this.section === 'presence' && draft.kind === 'room_location') { /* Only reported room mappings locate people. */ }
    else if (this.locationMode === 'room') {
      const room = this.rooms.find((entry) => entry.id === draft.roomId);
      if (!room || !this._validRoom(draft.roomId)) issues.push('Choose a room with an outline and a valid floor.');
    } else if (this.locationMode === 'anchor') {
      const anchor = this.anchors.find((entry) => entry.id === draft.position_key), position = anchor?.position;
      if (!position || !finite(position.x) || !finite(position.y) || position.z !== undefined && !finite(position.z) || !this._validFloor(position.floorId ?? position.floor_id)) issues.push('Choose a genuinely mapped object or marker on a valid floor.');
      if (this.anchors.filter((entry) => entry.id === draft.position_key).length > 1) issues.push('Anchor IDs must be unique. Repair this mapping before saving.');
    } else if (!draft.position || [draft.position.x, draft.position.y].some((value) => value === null || Math.abs(value) > 100000) || draft.position.z === null || Math.abs(draft.position.z) > 1000 || !this._validFloor(draft.position.floorId)) issues.push('Enter finite X/Y/height values in metres and choose an actual floor. Blank coordinates are not zero.');
    if (this.section === 'presence' && draft.kind === 'room_activity' || this.section === 'vehicles' && draft.kind === 'occupancy') {
      if (!draft.active_states.length || !draft.clear_states.length) issues.push('Choose explicit active and clear source states.');
      if (draft.active_states.some((value) => draft.clear_states.includes(value))) issues.push('A state cannot be both active and clear.');
    }
    if (this.section === 'presence' && draft.kind === 'room_activity') {
      if (!['motion', 'occupancy'].includes(draft.signal)) issues.push('Choose whether this sensor reports motion or occupancy.');
      if (draft.identity_entity) issues.push('Room activity is anonymous. Motion cannot identify a person.');
    }
    if (this.section === 'presence' && draft.kind === 'room_location' || this.section === 'vacuums' && draft.kind === 'room') {
      const source = draft.room_source;
      this._validEntity(source.entity, entityChoices(this.hass, { domains: ['sensor', 'select', 'input_select', 'device_tracker', 'person'], selected: source.entity }), 'Choose a room location source.', issues);
      if (!this.maps.length) issues.push('Add at least one exact reported room mapping.');
      const seen = new Set();
      for (const row of this.maps) {
        if (!text(row.value) || typeof row.value !== 'string' || homeAway.has(row.value.toLowerCase()) || !this._validRoom(row.roomId)) issues.push('Each mapping needs a real reported room value and an existing room; home/away is not a room location.');
        if (seen.has(row.value)) issues.push('A reported value must map to exactly one room. Remove duplicate or conflicting mappings.');
        seen.add(row.value);
      }
    }
    if (draft.identity_entity) {
      const domains = this.section === 'presence' ? ['person', 'device_tracker'] : ['sensor', 'device_tracker', 'event'];
      this._validEntity(draft.identity_entity, entityChoices(this.hass, { domains, selected: draft.identity_entity }), 'Choose an actual identity source or leave identity blank.', issues);
      if (this.section === 'vehicles' && !text(draft.identity_value)) issues.push('Enter the exact confirmed vehicle identifier, or leave identity blank for an anonymous vehicle.');
    }
    if (this.section === 'vehicles') {
      if (!draft.vehicle_source_confirmed) issues.push('Confirm that this source actually reports vehicles here, rather than general motion.');
      if (entityMetadata(this.hass, draft.entity).deviceClass === 'motion') issues.push('A general motion sensor cannot prove that a vehicle is parked or was identified. Choose a vehicle-specific source.');
      if (draft.kind === 'event') {
        if (!timestampKinds.some(([kind]) => kind === draft.timestamp_mode)) issues.push('Choose the actual event time source.');
        if (draft.timestamp_mode === 'attribute' && !text(draft.timestamp_attr)) issues.push('Enter the event timestamp attribute path.');
        if (!['iso', 'seconds', 'milliseconds'].includes(draft.timestamp_format)) issues.push('Choose the timestamp format.');
        if (draft.expires_seconds === null || draft.expires_seconds < 1 || draft.expires_seconds > 86400) issues.push('Choose a sighting expiry from 1 to 86400 seconds.');
      }
    }
    if (this.section === 'vacuums' && draft.kind === 'xy') {
      const source = draft.position_source;
      this._validEntity(source.entity, entityChoices(this.hass, { domains: ['sensor', 'device_tracker', 'vacuum'], selected: source.entity }), 'Choose the real position source.', issues);
      if (!text(source.x_attr) || !text(source.y_attr) || source.x_attr === source.y_attr) issues.push('Choose distinct X and Y attribute paths.');
      if (!this._validFloor(source.floorId)) issues.push('Choose the floor for measured coordinates.');
      if (!source.plan_meters) issues.push('Confirm that coordinates already use this plan’s metre frame. Cleaning status alone does not report position.');
      if (source.calibration?.length || this.draft.position_source?.source && this.draft.position_source.source !== 'xy' || this.draft.position_source?.units && this.draft.position_source.units !== 'm') issues.push('Relink to an explicit direct plan-metre source before using this editor to save calibrated coordinates.');
      const calibration = compileCalibration(source);
      if (calibration.status !== 'ready') issues.push(...calibration.diagnostics.map((issue) => issue.message));
    }
    return [...new Set(issues)];
  }

  _preview() {
    if (!this.draft) return '';
    const draft = this.draft, issues = [...this._referenceIssues(), ...this._validation()];
    const state = this.hass.states?.[draft.entity];
    const restored = this._sourceReferences().filter(([, entity]) => this.hass.states?.[entity]?.attributes?.restored === true);
    if (this.section === 'vehicles' && draft.entity) {
      const reading = readDetection(state, this._raw(), Date.now());
      if (reading.status !== 'active' && reading.status !== 'clear' && reading.status !== 'ready') issues.push(...reading.diagnostics.map((issue) => issue.message));
    }
    if (this.section === 'vacuums' && draft.kind === 'xy' && draft.position_source?.entity) {
      const reading = readCoordinate(this.hass.states?.[draft.position_source.entity], draft.position_source);
      if (reading.status !== 'ready') issues.push(...reading.diagnostics.map((issue) => issue.message));
    }
    const unavailable = !entityMetadata(this.hass, draft.entity).available;
    const meaning = this.section === 'presence' ? draft.kind === 'room_activity' ? 'Anonymous room activity only. No person identity or exact position is inferred.' : 'Room names must be reported by the selected source. A room display dot is symbolic.'
      : this.section === 'vehicles' ? draft.kind === 'event' ? 'Seen recently, with an explicit source-time expiry. This does not mean the vehicle remains parked.' : 'Vehicle occupancy uses current observations. A sustained occupied state remains occupied until the source clears it.'
        : draft.kind === 'xy' ? 'Moves only when valid measured plan coordinates are reported. No artificial route.' : draft.kind === 'room' ? 'Reported room only; exact position is unknown.' : 'Stationary status at your chosen room or dock. Moving location is not reported.';
    return `<p>${esc(meaning)}</p><p>${state?.attributes?.restored === true ? 'Stored source reading' : 'Source reading'}: ${esc(draft.entity ? formatEntityValue(this.hass, draft.entity) : 'Choose a source')}${state ? ` · ${esc(draft.entity)}` : ''}</p>
      <p class="trk-hint">${restored.length ? 'Waiting for current data. Stored readings are not used as current observations.' : draft.freshness ? 'Saved explicit freshness rules are preserved.' : 'Current HA state; no heartbeat or freshness is guessed from the last-change time.'}</p>
      ${restored.length && draft.freshness ? '<p class="trk-hint">Saved explicit freshness rules are preserved.</p>' : ''}
      ${restored.map(([label, entity]) => `<p class="trk-note">${esc(label)} ${esc(entity)} is a stored/restored reading. Waiting for a current Home Assistant update.</p>`).join('')}
      ${unavailable && draft.entity ? '<p class="trk-note">This source is missing, unknown or unavailable. It does not provide a current observation.</p>' : ''}
      ${this.message ? `<p class="trk-note" role="status">${esc(this.message)}</p>` : ''}
      ${issues.length ? `<ul>${[...new Set(issues)].map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul>` : `<p>${restored.length ? 'This configuration can be saved while waiting for current readings.' : 'Ready to save this explicit source and display location.'}</p>`}`;
  }
  updatePreviews(container) {
    if (this.disposed || !container || !this.draft) return;
    this.previewContainer = container;
    const target = container.querySelector('[data-trk-preview]'), html = this._preview();
    if (target && target.innerHTML !== html) target.innerHTML = html;
    const root = container.matches?.('[data-trk-editor]') ? container : container.querySelector('[data-trk-editor]');
    for (const control of root?.querySelectorAll('[data-trk-setting]') || []) control.disabled = this._readOnly();
    const relink = root?.querySelector('[data-act="trk-relink"]');
    if (relink) relink.hidden = this._referenceIssues().length === 0;
  }

  render() {
    if (this.disposed) return '';
    const draft = this.draft;
    const saved = this.bindings.map((binding, index) => `<li><span>${esc(binding?.label || binding?.entity || `Saved binding ${index + 1}`)}${binding?.enabled === false ? ' · disabled' : ''}<small>${esc(binding?.kind || 'Unknown type')}</small></span>${button('edit', 'Edit', `data-index="${index}"`)}${button('clear', 'Clear saved binding', `data-index="${index}"`)}</li>`).join('');
    let fields = '';
    if (draft) {
      const typeChoices = kinds[this.section].some(([kind]) => kind === draft.kind) ? kinds[this.section] : [[draft.kind, `Unsupported saved type: ${draft.kind}`], ...kinds[this.section]];
      fields = `${select('kind', 'Observation type', draft.kind, typeChoices)}${input('label', 'Display label (optional)', draft.label)}${check('enabled', 'Show this binding', draft.enabled !== false)}
        ${this._entitySelect('entity', this.section === 'vacuums' ? 'Vacuum status entity' : 'Observation source', draft.entity, this._choices())}`;
      if (this.section === 'presence' && draft.kind === 'room_activity') fields += `${select('signal', 'What this sensor reports', draft.signal, [['motion', 'Motion — activity, not identity'], ['occupancy', 'Occupancy — anonymous']])}${input('active', 'Active source states, separated by commas', words(draft.active_states).join(', '))}${input('clear', 'Clear source states, separated by commas', words(draft.clear_states).join(', '))}`;
      if (this.section === 'presence' && draft.kind === 'room_location' || this.section === 'vacuums' && draft.kind === 'room') fields += this._roomMapping();
      if (this.section === 'presence' && draft.kind === 'room_location') fields += this._identity();
      if (this.section === 'vehicles') {
        fields += check('vehicle-confirmed', 'This source reports vehicles here, not general motion', draft.vehicle_source_confirmed === true);
        if (draft.kind === 'occupancy') fields += `${input('active', 'Occupied source states, separated by commas', words(draft.active_states).join(', '))}${input('clear', 'Empty source states, separated by commas', words(draft.clear_states).join(', '))}`;
        if (draft.kind === 'count') fields += '<p class="trk-hint">The source state must be a whole, non-negative vehicle count. It is shown at one chosen location; no individual parking bays are guessed.</p>';
        if (draft.kind === 'event') fields += this._eventFields();
        fields += this._identity();
      }
      if (this.section === 'vacuums' && draft.kind === 'xy') fields += this._xyFields();
      if (!(this.section === 'presence' && draft.kind === 'room_location')) fields += `<section><h4>${this.section === 'vacuums' && draft.kind !== 'static' ? 'Fallback display location' : 'Display location'}</h4>${select('location-mode', 'How to choose the display location', this.locationMode, locationKinds)}${this._location()}</section>`;
      if (this._readOnly()) fields = fields.replace(/data-trk-setting/g, 'data-trk-setting disabled');
    }
    return `<section data-trk-editor data-taylors3d-ui="tracking-editor"><style>
      [data-trk-editor]{color:var(--primary-text-color,#212121)}[data-trk-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0}
      [data-trk-editor] input,[data-trk-editor] select,[data-trk-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-trk-editor] input:not([type=checkbox]),[data-trk-editor] select{width:100%}[data-trk-editor] .trk-check{flex-direction:row;align-items:center}[data-trk-editor] .trk-check input{min-width:22px;flex-shrink:0}
      [data-trk-editor] button{cursor:pointer}[data-trk-editor] button:disabled,[data-trk-editor] input:disabled,[data-trk-editor] select:disabled{opacity:.6;cursor:default}
      [data-trk-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-trk-editor] nav,[data-trk-editor] .trk-actions{display:flex;gap:7px;flex-wrap:wrap}
      [data-trk-editor] [aria-pressed=true]{border:2px solid var(--primary-color,#03a9f4)}[data-trk-editor] li{overflow-wrap:anywhere}[data-trk-editor] .trk-saved{padding:0;list-style:none}
      [data-trk-editor] .trk-saved li{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:8px 0}[data-trk-editor] .trk-saved span{flex:1;min-width:110px}[data-trk-editor] small{display:block}
      [data-trk-editor] .trk-hint{color:var(--secondary-text-color,#666)}[data-trk-editor] .trk-note{border-left:3px solid var(--primary-color,#03a9f4);padding-left:9px}[data-trk-editor] section{margin-top:14px}[data-trk-editor] h4{margin:14px 0 7px}
      </style><h3>Tracking</h3><p class="trk-hint">Choose what your real Home Assistant sources report. Editing changes this layout only; it never starts a vacuum or controls devices.</p>
      <nav aria-label="Tracking types">${Object.entries(sections).map(([id, [label]]) => button('section', label, `data-section="${id}" aria-pressed="${id === this.section}"`)).join('')}</nav>
      <ul class="trk-saved">${saved}</ul>${!draft ? button('add', `Add ${this.section === 'presence' ? 'presence binding' : this.section === 'vehicles' ? 'vehicle binding' : 'vacuum binding'}`) : ''}
      ${draft ? `<section><h4>Unsaved binding</h4>${fields}<div data-trk-preview aria-live="polite">${this._preview()}</div>
      <div class="trk-actions">${button('save', 'Save', `data-trk-setting ${this._readOnly() ? 'disabled' : ''}`)}${button('cancel', 'Cancel')}${button('relink', 'Relink deliberately', this._referenceIssues().length ? '' : 'hidden')}${this.editingIndex !== null ? button('clear-draft', 'Clear saved binding') : ''}</div></section>` : ''}</section>`;
  }

  onChange(field, element) {
    if (this.disposed || !field?.startsWith('trk-')) return false;
    if (!this.draft || this._readOnly()) return true;
    const draft = this.draft, value = element.value, name = field.slice(4), structural = new Set(['kind', 'location-mode', 'identity', 'timestamp-mode']);
    if (name === 'kind') {
      if (!kinds[this.section].some(([kind]) => kind === value)) return true;
      draft.kind = value;
      for (const key of ['room_source', 'position_source', 'identity_entity', 'identity_attribute', 'identity_value', 'timestamp_mode', 'timestamp_attr', 'event_types', 'expires_seconds']) delete draft[key];
      this.maps = [];
      if (this.section === 'presence') draft.signal = 'motion';
    } else if (name === 'entity') {
      if (value && !this._choices(value).some((choice) => choice.value === value && choice.selectable)) return true;
      if (this.section === 'vehicles' && value !== draft.entity) { draft.vehicle_source_confirmed = false; structural.add('entity'); }
      draft.entity = value;
      if (this.section === 'presence' && draft.kind === 'room_location' && !draft.room_source?.entity) draft.room_source = { ...draft.room_source, entity: value };
    } else if (name === 'label') draft.label = value;
    else if (name === 'enabled') draft.enabled = element.checked;
    else if (name === 'signal') draft.signal = value;
    else if (name === 'active') draft.active_states = words(value);
    else if (name === 'clear') draft.clear_states = words(value);
    else if (name === 'vehicle-confirmed') draft.vehicle_source_confirmed = element.checked;
    else if (name === 'location-mode') {
      if (!locationKinds.some(([kind]) => kind === value)) return true;
      this.locationMode = value; delete draft.roomId; delete draft.position; delete draft.position_key;
      if (value === 'position') draft.position = { x: '', y: '', z: 0, floorId: '' };
    } else if (name === 'room') draft.roomId = value;
    else if (name === 'anchor') draft.position_key = value;
    else if (['x', 'y', 'z', 'floor'].includes(name)) draft.position = { ...draft.position, [name === 'floor' ? 'floorId' : name]: value };
    else if (name === 'room-source' || name === 'room-attribute') draft.room_source = { ...draft.room_source, [name === 'room-source' ? 'entity' : 'attribute']: value };
    else if (name === 'map-value' || name === 'map-room') {
      const row = this.maps[Number(element.dataset.index)]; if (row) row[name === 'map-value' ? 'value' : 'roomId'] = value;
    } else if (name === 'identity') {
      draft.identity_entity = value; delete draft.identity_attribute; delete draft.identity_value;
    } else if (name === 'identity-value' || name === 'identity-attribute') draft[name.replace('-', '_')] = value;
    else if (name === 'timestamp-mode') draft.timestamp_mode = value;
    else if (name === 'timestamp-format') draft.timestamp_format = value;
    else if (name === 'timestamp-attr') draft.timestamp_attr = value;
    else if (name === 'expires') draft.expires_seconds = value;
    else if (name === 'event-types') draft.event_types = words(value);
    else if (name === 'event-type-attr') draft.event_type_attr = value;
    else if (name === 'event-id-attr') draft.event_id_attr = value;
    else if (['position-source', 'x-attr', 'y-attr', 'position-floor', 'plan-metres'].includes(name)) {
      const key = { 'position-source': 'entity', 'x-attr': 'x_attr', 'y-attr': 'y_attr', 'position-floor': 'floorId', 'plan-metres': 'plan_meters' }[name];
      draft.position_source = { ...draft.position_source, source: 'xy', units: 'm', [key]: name === 'plan-metres' ? element.checked : value };
    } else return false;
    this.message = null;
    if (structural.has(name)) { this.previewContainer = null; this.onRender(); }
    else if (this.previewContainer) this.updatePreviews(this.previewContainer);
    return true;
  }
  onInput(field, element) {
    return !['trk-kind', 'trk-location-mode', 'trk-identity', 'trk-timestamp-mode'].includes(field) && this.onChange(field, element);
  }
  onClick(action, element = {}) {
    if (this.disposed || !action?.startsWith('trk-')) return false;
    const index = Number(element.dataset?.index);
    if (action === 'trk-section') {
      if (own(sections, element.dataset?.section)) { this.reset(); this.section = element.dataset.section; this.onRender(); }
    } else if (action === 'trk-add') this._new();
    else if (action === 'trk-edit') { const binding = this.bindings[index]; if (plain(binding)) this._start(binding, index); }
    else if (action === 'trk-clear') this._commit(this.bindings.filter((_, i) => i !== index));
    else if (action === 'trk-clear-draft' && this.draft) this._commit(this.bindings.filter((_, i) => i !== this.editingIndex));
    else if (action === 'trk-cancel') { this.reset(); this.onRender(); }
    else if (action === 'trk-relink' && this.draft) {
      this.relinking = true; this.message = 'Choose each replacement deliberately. No saved source, room or anchor has been guessed.';
      if (this.section === 'vacuums' && this.draft.kind === 'xy') this.draft.position_source = { entity: '', source: 'xy', units: 'm', plan_meters: false, x_attr: '', y_attr: '', floorId: '' };
      this.onRender();
    } else if (action === 'trk-add-map' && this.draft && !this._readOnly()) { this.maps.push({ value: '', roomId: '' }); this.onRender(); }
    else if (action === 'trk-remove-map' && this.draft && !this._readOnly()) { this.maps.splice(index, 1); this.onRender(); }
    else if (action === 'trk-save' && this.draft && !this._readOnly()) {
      const issues = this._validation();
      if (issues.length) { this.message = issues[0]; this.onRender(); }
      else {
        const saved = this._raw();
        this._commit(this.editingIndex === null ? [...this.bindings, saved] : this.bindings.map((binding, i) => i === this.editingIndex ? saved : binding));
      }
    }
    return true;
  }
}
