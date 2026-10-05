// Explicit observation bindings. Drafts and previews never change HA devices or saved layout.
import { entityChoices, entityMetadata, formatEntityValue } from './entity-metadata.js';
import { readDetection, readFreshness } from './tracked-source.js';
import { TrackingCalibration } from './tracking-calibration.js';
import { TRACKING_LIMITS } from './tracked-entities.js';
import { localize } from './localization.js';
import { renderAdvancedCaptions, updateAdvancedCaptions } from './translations/advanced-settings.js';
import { editorDetailText, editorDetailSpan, updateEditorDetails, editorOwnedMessage } from './editor-runtime-details.js';

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
  vacuums: [['static', 'Status at a fixed room or dock'], ['room', 'Reported room, exact position unknown'], ['xy', 'Measured coordinates with an explicit plan frame']],
};
const locationKinds = [['room', 'Selected room'], ['position', 'Fixed plan position'], ['anchor', 'Existing object or marker']];
const timestampKinds = [['state', 'Entity state contains the event time'], ['attribute', 'An attribute contains the event time'], ['last_changed', 'Explicit pulse when the state changes'], ['last_updated', 'Explicit event when state or attributes change']];
const freshnessKinds = [['state', 'Entity state is the actual timestamp'], ['attribute', 'An attribute is the actual timestamp'], ['last_updated', 'Home Assistant last state or attribute update'], ['last_changed', 'Home Assistant last state change']];
const freshnessFormats = [['iso', 'ISO date/time with Z or a timezone offset'], ['seconds', 'Unix seconds'], ['milliseconds', 'Unix milliseconds']];
function freshnessIssues(rule) {
  if (rule === undefined) return [];
  if (!plain(rule)) return ['Saved freshness settings must be an object; repair the rule deliberately.'];
  if (rule.timestamp_mode === undefined && rule.max_age_seconds === undefined) return [];
  const issues = [];
  if (!freshnessKinds.some(([mode]) => mode === rule.timestamp_mode)) issues.push('Choose the actual source timestamp before setting a maximum age.');
  if (rule.timestamp_mode === 'attribute' && (!text(rule.timestamp_attr) || !rule.timestamp_attr.split('.').every((part) => part.trim()))) issues.push('Enter the actual timestamp attribute path.');
  if (rule.timestamp_format !== undefined && !freshnessFormats.some(([format]) => format === rule.timestamp_format)) issues.push('Choose ISO with a timezone, Unix seconds or Unix milliseconds.');
  if (['last_updated', 'last_changed'].includes(rule.timestamp_mode) && rule.timestamp_format && rule.timestamp_format !== 'iso') issues.push('Home Assistant last-updated and last-changed timestamps use ISO with a timezone.');
  const age = number(rule.max_age_seconds);
  if (age === null || age <= 0 || !Number.isFinite(age * 1000)) issues.push('Maximum reading age must be a positive finite number of seconds.');
  return issues;
}
const freshnessMode = (rule) => rule === undefined || plain(rule) && rule.timestamp_mode === undefined && rule.max_age_seconds === undefined ? 'current'
  : plain(rule) && (rule.timestamp_mode === '' || freshnessKinds.some(([kind]) => kind === rule.timestamp_mode)) ? 'timestamp' : 'saved';
const homeAway = new Set(['home', 'not_home', 'away', 'unknown', 'unavailable']);
const input = (field, label, value, extra = '') => `<label>${esc(label)}<input data-trk-setting data-field="trk-${field}" value="${esc(value)}" ${extra}></label>`;
const option = (value, label, selected, disabled = false, detail) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}${detail ? ` data-editor-detail="${esc(detail.key)}" data-editor-detail-params="${esc(JSON.stringify(detail.params))}"` : ''}>${esc(label)}</option>`;
const select = (field, label, value, choices, extra = '') => `<label>${esc(label)}<select data-trk-setting data-field="trk-${field}" ${extra}>${choices.map(([id, name, detail]) => option(id, name, value, false, detail?.key ? detail : undefined)).join('')}</select></label>`;
const check = (field, label, value) => `<label class="trk-check"><input type="checkbox" data-trk-setting data-field="trk-${field}" ${value ? 'checked' : ''}>${esc(label)}</label>`;
const button = (action, label, extra = '') => `<button type="button" data-act="trk-${action}" ${extra}>${esc(label)}</button>`;
const syncOptions = (control, rows, selected) => {
  if (!control) return;
  const existing = new Map(), keep = new Set();
  for (const entry of control.options) { const queue = existing.get(entry.value) || []; queue.push(entry); existing.set(entry.value, queue); }
  rows.forEach(([value, label, disabled], index) => {
    const entry = existing.get(value)?.shift() || control.ownerDocument.createElement('option');
    entry.value = value; if (entry.textContent !== label) entry.textContent = label; entry.disabled = disabled;
    if (control.options[index] !== entry) control.insertBefore(entry, control.options[index] || null); keep.add(entry);
  });
  for (const entry of [...control.options]) if (!keep.has(entry)) entry.remove();
  if (control.value !== (selected || '')) control.value = selected || '';
};

/** Domain restrictions are about available observation sources, not inferred capabilities. */
export function trackingEntities(hass = {}, section = 'presence', kind = 'room_activity', selected = '', filters = {}) {
  const domains = section === 'vacuums' ? ['vacuum'] : section === 'vehicles'
    ? kind === 'event' ? ['event', 'sensor', 'binary_sensor', 'input_datetime'] : kind === 'count' ? ['sensor', 'counter', 'input_number'] : ['binary_sensor', 'sensor', 'input_boolean']
    : kind === 'room_activity' ? ['binary_sensor', 'input_boolean', 'sensor'] : ['sensor', 'select', 'input_select', 'device_tracker', 'person'];
  return entityChoices(hass, { ...filters, domains, selected });
}

/**
 * Parent contract follows OverlayEditor: render(), onChange/onInput(), onClick(),
 * updatePreviews(container), reset()/cancel()/dispose(). Only explicit Save/Clear calls
 * card.commitFeatureLayout({ presence_bindings | vehicle_bindings | vacuum_bindings }).
 * Optional card.trackingAnchors() returns genuine {id,label,position:{x,y,z,floorId}}.
 * room_source maps exact reported strings to room IDs. The coordinate widget owns only
 * position_source drafts; imported GPS and known-unit mappings retain their exact fields.
 * pendingPlanPick is pure; the parent passes an unsnapped [east,north], floor and token
 * to acceptPlanPoint(). calibrationOverlay() supplies draft numbered points only.
 */
export class TrackingEditor {
  _captions(html) { return renderAdvancedCaptions(html, 'tracking', (key, fallback) => localize(this.hass, key, {}, fallback)); }
  _translateCaptions(root) { updateAdvancedCaptions(root, 'tracking', (key, fallback) => localize(this.hass, key, {}, fallback)); updateEditorDetails(root, this.hass); }
  _text(id, params) { return editorDetailText(this.hass, id.includes('.') ? id : `tracking.${id}`, params); }
  _help(id) { return editorDetailSpan(this.hass, id.includes('.') ? id : `tracking.${id}`); }
  _message(value) {
    const reference = typeof value === 'string' && this._referenceMessages?.get(value);
    if (reference) return this._text(reference.key, reference.params);
    if (value === `Measured-position smoothing must be between 0 and ${TRACKING_LIMITS.interpolation} milliseconds.`) return this._text('smoothing', { maximum: TRACKING_LIMITS.interpolation });
    return editorOwnedMessage(this.hass, value);
  }
  _sourceLabel(label) { return this._text(({ Source: 'sourceLabel', Identity: 'identityLabel', 'Room source': 'roomSourceLabel', 'Position source': 'positionSourceLabel' })[label]) || label; }
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.section = 'presence'; this.draft = null;
    this.message = null; this.relinking = false; this.maps = []; this.locationMode = 'room'; this.disposed = false;
    this.calibration = null; this.calibrationPreview = null; this.pickRevision = 0; this.calibrationGeneration = 0; this.publicPlanPick = null;
    this.areaFilter = 'all'; this.styleEdits = new Set();
    this.stale = false; this._epoch = 0; this._root = null; this._observed = null; this._draftContext = null;
    this._pressed = new Map(); this._intents = new WeakMap(); this._fields = new WeakMap();
    this._handlers = new Map([['pointerdown', (event) => this._press(event)], ['pointerup', (event) => this._release(event)],
      ['pointercancel', (event) => this._cancelPress(event)], ['keydown', (event) => this._key(event)], ['keyup', (event) => this._release(event)],
      ['focusout', (event) => this._cancelPress(event)], ['focusin', (event) => { if (event.target?.dataset?.field?.startsWith('trk-')) { this.observe(); this._fields.set(event.target, { epoch: this._epoch, draft: this.draft }); } }]]);
  }
  get hass() { return this.card._hass || {}; }
  get canEdit() { const user = this.hass.user; return !this.disposed && this.card.isConnected === true && this.card._editing === true
    && this.card._edit?.tab === 'tracking' && !!this.card._layout && !this.card._loading && this.hass.connection?.connected === true
    && typeof user?.id === 'string' && !!user.id.trim() && user.is_admin === true && (!Object.hasOwn(user, 'is_active') || user.is_active === true); }
  _majorContext() {
    const hass = this.hass;
    return { layout: this.card._layout, config: this.card._config, root: this.card._view?.model?.root, user: hass.user, connection: hass.connection,
      auth: hass.auth, connectionAuth: hass.connection?.options?.auth,
      frame: this._calibrationContext().contextKey,
      flags: JSON.stringify([hass.user?.id, hass.user?.is_admin, hass.user?.is_active, hass.user?.permissions,
        this.card.isConnected, this.card._editing, this.card._edit?.tab, this.card._loading, hass.connection?.connected]) };
  }
  _context() {
    return { ...this._majorContext(), sources: JSON.stringify(this._sourceReferences().map(([, entity]) => {
      const metadata = entityMetadata(this.hass, entity), rule = entity === this.draft?.position_source?.entity ? this.draft.position_source.freshness : this.draft?.freshness;
      return [entity, metadata.hasState, metadata.available, metadata.hidden, metadata.disabled, metadata.category, metadata.state?.attributes?.restored,
        readFreshness(metadata.state, rule, Date.now()).status];
    })) };
  }
  _same(a, b) { return !!a && !!b && Object.keys(a).every((key) => a[key] === b[key]); }
  // Root calls this on every HA setter, before a recovered microtask can hide an
  // observed role/connection/source loss. It never requests a parent redraw.
  observe() {
    if (this.disposed) return false;
    const context = this._context();
    if (this._observed && !this._same(this._observed, context)) { this._epoch++; for (const intent of this._pressed.values()) intent.poisoned = true; }
    this._observed = context;
    if (this.draft && this._draftContext && !this._same(this._draftContext, this._majorContext())) this.stale = true;
    this.calibration?.update(this._calibrationContext());
    if (this._readOnly()) this.calibration?.cancelPlanPick();
    this._revalidatePresses(); return this.canEdit && !this.stale;
  }
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
  reset() {
    this._unbind(); this._epoch++; this.stale = false; this._draftContext = null; this._observed = null;
    this._clearCalibration();
    this.draft = null; this.maps = []; this.message = null; this.relinking = false; this.previewContainer = null; this.editingIndex = null;
    this.areaFilter = 'all'; this.styleEdits.clear();
  }
  cancel() { this.reset(); }
  dispose() { this.reset(); this.disposed = true; }

  get pendingPlanPick() { return this.publicPlanPick; }
  _calibrationContext() {
    const floors = this.floors.map((floor) => ({ ...floor, elevation: this.card._view?.floorElevation?.(floor.id) ?? floor.elevation }));
    const model = this.card._layout?.model || {}, config = this.card._config || {};
    const alignment = this.card._modelAlign?.() ?? (config.model
      ? [config.model_position, config.model_rotation, config.model_scale] : [model.position, model.rotation, model.scale]);
    return { hass: this.hass, floors, contextKey: JSON.stringify([
      this.card._config?.layout_key, this.card._view?.model?.root?.uuid ?? null,
      alignment,
      floors.map((floor) => [floor.id, floor.elevation]),
    ]) };
  }
  _refreshCalibrationOverlay() { this.card._edit?.refreshOverlay?.(); }
  _clearCalibration() {
    const hadPreview = !!this.calibrationPreview, revision = this.pickRevision;
    this.clearingCalibration = true;
    const calibration = this.calibration; this.calibration = null;
    calibration?.dispose(); this.calibrationPreview = null; this.publicPlanPick = null;
    if (hadPreview && revision === this.pickRevision) this._refreshCalibrationOverlay();
    this.clearingCalibration = false;
  }
  _ensureCalibration() {
    if (this.clearingCalibration || this.disposed || this.section !== 'vacuums' || this.draft?.kind !== 'xy') return null;
    if (!this.calibration) {
      const generation = ++this.calibrationGeneration;
      this.calibration = new TrackingCalibration({ source: this.draft.position_source || { source: 'xy' },
        imported: this.editingIndex !== null, ...this._calibrationContext(),
        onChange: (source) => { if (this.draft) this.draft.position_source = source; },
        onPlanPick: (pick) => {
          this.pickRevision++;
          this.publicPlanPick = pick ? Object.freeze({ ...pick, token: `tracking-${generation}-${pick.token}` }) : null;
          this.card._edit?.beginTrackingPlanPick?.(this.publicPlanPick);
        },
        onPreview: (preview) => { this.calibrationPreview = preview; },
      });
    }
    this.calibration.update(this._calibrationContext());
    if (this._readOnly()) this.calibration.cancelPlanPick();
    return this.calibration;
  }
  acceptPlanPoint(point, floorId, token) {
    if (this.disposed) return false;
    this.observe();
    const calibration = this._ensureCalibration();
    if (!calibration || this._readOnly() || token !== this.publicPlanPick?.token) return false;
    const accepted = calibration.acceptPlanPoint(point, floorId, calibration.pending?.token);
    this.onRender(); return accepted;
  }
  cancelPlanPick() {
    if (this.disposed) return;
    this.calibration?.cancelPlanPick();
    if (this.previewContainer) this.calibration?.updatePreviews(this.previewContainer);
  }
  calibrationOverlay() {
    const calibration = this._ensureCalibration();
    if (!calibration || this._readOnly()) return null;
    const preview = this.calibrationPreview;
    return { floorId: calibration.source.floorId,
      points: list(calibration.source.calibration).flatMap((entry, index) => !calibration.planEdits.has(index) && Array.isArray(entry?.plan) && entry.plan.length === 2 && entry.plan.every(finite)
        ? [{ index, label: String(index + 1), x: entry.plan[0], y: entry.plan[1] }] : []),
      mapped: preview?.mapped ?? null, status: preview?.status ?? 'invalid' };
  }

  _pickerFilters() { return this.areaFilter === 'unassigned' ? { areaId: null } : this.areaFilter.startsWith('area:') ? { areaId: this.areaFilter.slice(5) } : {}; }
  _choices(selected = this.draft?.entity, filtered = true) { return trackingEntities(this.hass, this.section, this.draft?.kind, selected, filtered ? this._pickerFilters() : {}); }
  _areaChoices() {
    const areas = Object.entries(this.hass.areas || {}).filter(([id]) => id).map(([id, area]) => [`area:${id}`, area?.name || id]);
    const choices = [['all', 'All areas'], ['unassigned', 'Unassigned'], ...areas];
    if (!choices.some(([value]) => value === this.areaFilter)) choices.push([this.areaFilter, editorDetailText(this.hass, 'camera.missingFilter', { id: this.areaFilter.slice(5) })]);
    return choices;
  }
  _filterHtml() {
    return `<label>Filter entity choices by current area<select data-field="trk-area-filter">${this._areaChoices().map(([value, label]) => option(value, label, this.areaFilter)).join('')}</select></label><p class="trk-hint">${this._help('filterHelp')}</p>`;
  }
  _entitySelect(field, label, selected, choices) {
    return `<label>${esc(label)}<select data-trk-setting data-field="trk-${field}">${option('', 'Choose an actual entity', selected)}${choices.map((choice) => option(choice.value, `${choice.label} · ${choice.value}`, selected, !choice.selectable)).join('')}</select></label>`;
  }
  _roomSelect(field, label, selected, extra = '') {
    const choices = [['', 'Choose a room with an outline'], ...this.rooms.map((room) => [room.id, `${room.name} · ${this._floorName(room.floorId)}`])];
    if (selected && !this.rooms.some((room) => room.id === selected)) choices.push([selected, this._text('missingRoom', { id: selected })]);
    return select(field, label, selected, choices, extra);
  }
  _floorSelect(field, label, selected) {
    const choices = [['', 'Choose the actual floor'], ...this.floors.map((floor) => [floor.id, floor.name || floor.id])];
    if (selected && !this.floors.some((floor) => floor.id === selected)) choices.push([selected, this._text('missingFloor', { id: selected })]);
    return select(field, label, selected, choices);
  }
  _floorName(id) { return this.floors.find((floor) => floor.id === id)?.name || id || this._text('floorNone'); }
  _validFloor(id) { const floors = this.floors.filter((floor) => floor.id === id); return floors.length === 1 && finite(floors[0].elevation); }
  _validRoom(id) { const rooms = this.rooms.filter((room) => room.id === id); return rooms.length === 1 && rooms[0].valid && this._validFloor(rooms[0].floorId); }
  _sourceReferences() {
    const draft = this.draft;
    if (!draft) return [];
    return [['Source', draft.entity], ['Identity', draft.identity_entity], ['Room source', draft.room_source?.entity], ['Position source', draft.position_source?.entity]].filter(([, entity]) => entity);
  }
  _referenceIssues() {
    this._referenceMessages = new Map();
    if (!this.draft) return [];
    const issues = [];
    const reference = (message, key, params) => { issues.push(message); this._referenceMessages.set(message, { key: `tracking.reference.${key}`, params }); };
    for (const [label, entity] of this._sourceReferences()) {
      const metadata = entityMetadata(this.hass, entity);
      if (!metadata.hasState || metadata.hidden || metadata.disabled || metadata.category) reference(`${label} ${entity} is ${metadata.missing ? 'missing' : !metadata.hasState ? 'without a current state' : metadata.disabled ? 'disabled' : metadata.hidden ? 'hidden' : 'a configuration or diagnostic entity'}.`,
        metadata.missing ? 'missing' : !metadata.hasState ? 'noState' : metadata.disabled ? 'disabled' : metadata.hidden ? 'hidden' : 'category', { label: this._sourceLabel(label), entity });
    }
    const draft = this.draft;
    const rooms = [draft.roomId, ...this.maps.map((row) => row.roomId)].filter(Boolean);
    for (const id of new Set(rooms)) if (!this.rooms.some((room) => room.id === id)) reference(`Saved room ${id} is missing.`, 'room', { id });
    for (const id of new Set([draft.position?.floorId, draft.position_source?.floorId].filter(Boolean))) if (!this.floors.some((floor) => floor.id === id)) reference(`Saved floor ${id} is missing.`, 'floor', { id });
    if (draft.position_key && !this.anchors.some((anchor) => anchor.id === draft.position_key)) reference(`Saved anchor ${draft.position_key} is missing.`, 'anchor', { id: draft.position_key });
    return issues;
  }
  _readOnly() { return !this.canEdit || this.stale || !this.relinking && this._referenceIssues().length > 0; }

  _start(binding, index = null) {
    this._clearCalibration();
    this.draft = copy(binding); this.message = null; this.relinking = false;
    this.stale = false; this._epoch++; this._draftContext = this._majorContext(); this._observed = null;
    this.styleEdits.clear();
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
    this.observe(); if (!this.canEdit || this.stale) return false;
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
      if (draft.position_key && !this.anchors.some((anchor) => anchor.id === draft.position_key)) choices.push([draft.position_key, this._text('missingAnchor', { id: draft.position_key })]);
      return select('anchor', 'Use this object or marker position', draft.position_key, choices);
    }
    const position = draft.position || {};
    return `<p class="trk-hint">${this._help('fixedHelp')}</p>${this._floorSelect('floor', 'Floor', position.floorId)}
      ${input('x', 'X — metres east', position.x, 'type="number" step="any"')}${input('y', 'Y — metres north', position.y, 'type="number" step="any"')}${input('z', 'Height above floor, metres', position.z ?? 0, 'type="number" step="any"')}`;
  }
  _roomMapping() {
    const source = this.draft.room_source || {};
    const choices = entityChoices(this.hass, { ...this._pickerFilters(), domains: ['sensor', 'select', 'input_select', 'device_tracker', 'person'], selected: source.entity });
    return `<section><h4>Exact reported room names</h4>${this._entitySelect('room-source', 'Room location source', source.entity, choices)}
      ${input('room-attribute', 'Room attribute (leave blank to use the entity state)', source.attribute)}
      <p class="trk-hint">${this._help('roomHelp')}</p>
      ${this.maps.map((row, index) => `<div class="trk-map">${input('map-value', 'Reported room value', row.value, `data-index="${index}"`)}${this._roomSelect('map-room', 'Actual room', row.roomId, `data-index="${index}"`)}${button('remove-map', 'Remove mapping', `data-index="${index}" data-trk-setting`)}</div>`).join('')}
      ${button('add-map', 'Add room mapping', 'data-trk-setting')}</section>`;
  }
  _identity() {
    const draft = this.draft;
    if (this.section === 'presence') return this._entitySelect('identity', 'Person or device associated with this room source (optional)', draft.identity_entity, entityChoices(this.hass, { ...this._pickerFilters(), domains: ['person', 'device_tracker'], selected: draft.identity_entity }));
    return `<section><h4>Confirmed vehicle identity (optional)</h4><p class="trk-hint">${this._help('identityHelp')}</p>
      ${this._entitySelect('identity', 'Source that reports the real vehicle identifier', draft.identity_entity, entityChoices(this.hass, { ...this._pickerFilters(), domains: ['sensor', 'device_tracker', 'event'], selected: draft.identity_entity }))}
      ${draft.identity_entity ? `${input('identity-attribute', 'Identifier attribute (blank uses state)', draft.identity_attribute)}${input('identity-value', 'Exact confirmed identifier to match', draft.identity_value)}` : ''}</section>`;
  }
  _eventFields() {
    const draft = this.draft;
    return `<section><h4>When does “seen recently” end?</h4><p class="trk-hint">${this._help('eventHelp')}</p>
      ${select('timestamp-mode', 'Event time source', draft.timestamp_mode, [['', 'Choose how this source reports time'], ...timestampKinds])}
      ${draft.timestamp_mode === 'attribute' ? input('timestamp-attr', 'Timestamp attribute path', draft.timestamp_attr) : ''}
      ${['state', 'attribute'].includes(draft.timestamp_mode) ? select('timestamp-format', 'Timestamp format', draft.timestamp_format || 'iso', [['iso', 'ISO date/time'], ['seconds', 'Unix seconds'], ['milliseconds', 'Unix milliseconds']]) : ''}
      ${input('expires', 'Show as seen recently for this many seconds', draft.expires_seconds, 'type="number" min="1" max="86400" step="1"')}
      <p class="trk-hint">${this._help('eventFilterHelp')}</p>
      ${input('event-types', 'Vehicle event types to accept, separated by commas (optional for a vehicle-only source)', words(draft.event_types).join(', '))}
      ${input('event-type-attr', 'Event type attribute path', draft.event_type_attr || 'event_type')}${input('event-id-attr', 'Event identifier attribute path (optional)', draft.event_id_attr)}</section>`;
  }
  _xyFields() {
    return `<fieldset data-trk-cal-fieldset ${this._readOnly() ? 'disabled' : ''}>${this._ensureCalibration().renderHTML()}</fieldset>
      ${this._freshnessFields('position')}
      <p class="trk-hint">${this._help('positionHelp')}</p>`;
  }

  _freshnessRule(target) { return target === 'position' ? this.draft?.position_source?.freshness : this.draft?.freshness; }
  _freshnessPreview(target) {
    const entity = target === 'position' ? this.draft?.position_source?.entity : this.draft?.entity;
    const metadata = entityMetadata(this.hass, entity), rule = this._freshnessRule(target);
    if (metadata.state?.attributes?.restored === true) return `<p>${esc(this._text('common.stored'))}</p>`;
    if (!metadata.available || metadata.hidden || metadata.category) return `<p>${esc(this._text('common.noReading'))}</p>`;
    const reading = readFreshness(metadata.state, rule, Date.now());
    if (reading.status === 'current') return `<p>${esc(this._text('unverified'))}</p>`;
    const observed = typeof reading.observedAt === 'number' && Number.isFinite(reading.observedAt) && Math.abs(reading.observedAt) <= 8640000000000000
      ? new Date(reading.observedAt).toISOString() : null;
    return `<p>${esc(this._text('common.ageCheck', { status: reading.status }))}${observed ? esc(this._text('timestamp', { timestamp: observed })) : ''}</p>
      ${reading.status === 'ready' && !reading.verified ? `<p>${esc(this._text('noMaxAge'))}</p>` : ''}
      ${reading.diagnostics.map((issue) => `<p>${esc(this._message(issue))}</p>`).join('')}`;
  }
  _freshnessFields(target) {
    const label = target === 'position' ? 'Measured position' : this.section === 'vacuums' ? 'Vacuum status' : this.section === 'vehicles' ? 'Vehicle source' : 'Observation source', rule = this._freshnessRule(target), mode = freshnessMode(rule);
    const choices = [['current', 'Current HA state — no age limit'], ['timestamp', 'Actual timestamp — check reading age']];
    if (mode === 'saved') choices.unshift(['saved', 'Saved rule — choose a deliberate repair']);
    let fields = select(`freshness-${target}-mode`, `${label} freshness`, mode, choices);
    if (mode === 'timestamp') {
      const formats = [...freshnessFormats];
      if (rule.timestamp_format !== undefined && !formats.some(([id]) => id === rule.timestamp_format)) formats.unshift([rule.timestamp_format, `Unsupported saved format: ${String(rule.timestamp_format)}`]);
      fields += `${select(`freshness-${target}-timestamp-mode`, 'Which timestamp does this source really report?', rule.timestamp_mode, [['', 'Choose the actual timestamp'], ...freshnessKinds])}
        ${rule.timestamp_mode === 'attribute' ? input(`freshness-${target}-attribute`, 'Timestamp attribute path', rule.timestamp_attr) : ''}
        ${select(`freshness-${target}-format`, 'Actual timestamp format', rule.timestamp_format ?? 'iso', formats)}
        ${input(`freshness-${target}-age`, 'Maximum reading age, seconds', rule.max_age_seconds, 'type="number" min="0" step="any"')}`;
    }
    return `<section data-trk-freshness="${target}"><h4>${label} reading age</h4>${fields}
      <p class="trk-hint">${this._help('ageHelp')}</p>
      ${mode === 'saved' ? `<p class="trk-note">${this._help('savedRule')}</p><pre>${esc(JSON.stringify(rule))}</pre>` : ''}
      ${plain(rule) && Object.keys(rule).some((key) => !['timestamp_mode', 'timestamp_attr', 'timestamp_format', 'max_age_seconds'].includes(key)) ? `<p class="trk-hint">${this._help('ruleExtras')}</p>` : ''}
      <div data-trk-freshness-preview="${target}" aria-live="polite">${this._freshnessPreview(target)}</div></section>`;
  }
  _changeFreshness(field, element, inputOnly = false) {
    const match = field.match(/^trk-freshness-(status|position)-(mode|timestamp-mode|format|attribute|age)$/);
    if (!match || !this.draft || match[1] === 'position' && (this.section !== 'vacuums' || this.draft.kind !== 'xy')) return false;
    if (this._readOnly()) return true;
    const [, target, setting] = match, previous = this._freshnessRule(target), revision = this.pickRevision;
    let rule = plain(previous) ? copy(previous) : undefined;
    if (setting === 'mode') {
      if (element.value === 'current') rule = undefined;
      else if (element.value === 'timestamp') rule = { ...(rule || {}),
        timestamp_mode: freshnessKinds.some(([mode]) => mode === rule?.timestamp_mode) ? rule.timestamp_mode : '',
        timestamp_format: rule?.timestamp_format ?? 'iso', max_age_seconds: rule?.max_age_seconds ?? '' };
      else return true;
    } else {
      if (!rule || freshnessMode(rule) !== 'timestamp') return true;
      const key = { 'timestamp-mode': 'timestamp_mode', format: 'timestamp_format', attribute: 'timestamp_attr', age: 'max_age_seconds' }[setting];
      rule[key] = setting === 'age' ? number(element.value) ?? element.value : element.value;
    }
    if (target === 'position') this._ensureCalibration().setFreshness(rule);
    else if (rule === undefined) delete this.draft.freshness; else this.draft.freshness = rule;
    this._observed = this._context(); this._revalidatePresses();
    this.message = null;
    if (revision === this.pickRevision && target === 'position') this._refreshCalibrationOverlay();
    if (!inputOnly && ['mode', 'timestamp-mode'].includes(setting)) { this.previewContainer = null; this.onRender(); }
    else if (this.previewContainer) this.updatePreviews(this.previewContainer);
    return true;
  }

  _raw() {
    const draft = copy(this.draft);
    for (const field of ['size', 'heading', 'interpolate_ms']) if (this.styleEdits.has(field)) {
      if (draft[field] === '') delete draft[field]; else draft[field] = number(draft[field]);
    }
    if (this.styleEdits.has('color') && draft.color === '') delete draft.color;
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
    if (!this.canEdit) issues.push(localize(this.hass, 'edit.tracking.calibration.permissionBlocked', {}, 'A current connected administrator must open Tracking to save changes.'));
    if (this.stale) issues.push(localize(this.hass, 'edit.tracking.calibration.staleDraft', {}, 'The account, layout or model context changed. Cancel and reopen this binding before editing.'));
    if (!kinds[this.section].some(([kind]) => kind === draft.kind)) issues.push('This saved tracking type is unsupported. Clear it and create an explicit binding.');
    if (this.bindings.some((binding, index) => index !== this.editingIndex && binding?.id === draft.id)) issues.push('Saved binding IDs must be unique. Clear the duplicate binding before editing it.');
    this._validEntity(draft.entity, this._choices(draft.entity, false), 'Choose an actual source entity for this tracking type.', issues);
    if (this._readOnly()) issues.push('Saved references are read-only. Restore them, deliberately Relink, or Clear this binding.');
    issues.push(...freshnessIssues(draft.freshness).map((message) => `${this.section === 'vacuums' ? 'Vacuum status' : 'Observation source'}: ${message}`));
    if (this.section === 'vacuums') {
      if (draft.kind === 'xy') issues.push(...freshnessIssues(draft.position_source?.freshness).map((message) => `Measured position: ${message}`));
    }
    if (this.styleEdits.has('color') && draft.color !== undefined && (typeof draft.color !== 'string' || !/^#[\da-f]{6}$/i.test(draft.color))) issues.push('Choose a six-digit marker colour, or leave it blank for the display default.');
    if (this.styleEdits.has('size') && draft.size !== undefined && (!finite(draft.size) || draft.size < .1 || draft.size > 5)) issues.push('Marker size must be between 0.1 and 5.');
    if (this.styleEdits.has('heading') && draft.heading !== undefined && !finite(draft.heading)) issues.push('Marker heading must be a finite number of degrees.');
    if (this.styleEdits.has('interpolate_ms') && draft.interpolate_ms !== undefined && (!finite(draft.interpolate_ms) || draft.interpolate_ms < 0 || draft.interpolate_ms > TRACKING_LIMITS.interpolation)) issues.push(`Measured-position smoothing must be between 0 and ${TRACKING_LIMITS.interpolation} milliseconds.`);
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
      const source = draft.position_source || {};
      this._validEntity(source.entity, entityChoices(this.hass, { domains: ['sensor', 'device_tracker', 'vacuum'], selected: source.entity }), 'Choose the real position source.', issues);
      const calibration = this._ensureCalibration(), report = calibration.report();
      const sourceEdited = ['entity', 'source', 'x_attr', 'y_attr', 'latitude_attr', 'longitude_attr'].some((key) => source[key] !== calibration.initial[key]);
      if ((source.source || 'xy') === 'xy' && sourceEdited && (!text(source.x_attr) || !text(source.y_attr) || source.x_attr === source.y_attr)) issues.push('An edited X/Y source needs distinct actual coordinate attribute paths.');
      if (source.source === 'gps' && sourceEdited) {
        const latitude = source.latitude_attr ?? 'latitude', longitude = source.longitude_attr ?? 'longitude';
        if (!text(latitude) || !text(longitude) || latitude === longitude) issues.push(localize(this.hass, 'edit.tracking.calibration.gpsEditedPathsRequired', {}, 'An edited GPS source needs distinct actual latitude/longitude attribute paths.'));
      }
      if (report.status !== 'ready') issues.push(...report.diagnostics.map((issue) => issue.message));
      if (this.pendingPlanPick) issues.push('Match or cancel the captured source point before saving this binding.');
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
      const reading = this._ensureCalibration().evidence();
      if (reading.status !== 'ready') issues.push(...reading.diagnostics.map((issue) => issue.message));
    }
    const unavailable = !entityMetadata(this.hass, draft.entity).available;
    const meaning = this._text(this.section === 'presence' ? draft.kind === 'room_activity' ? 'anonymous' : 'roomMeaning'
      : this.section === 'vehicles' ? draft.kind === 'event' ? 'eventMeaning' : 'occupiedMeaning'
        : draft.kind === 'xy' ? 'xyMeaning' : draft.kind === 'room' ? 'reportedRoom' : 'stationary');
    return `<p>${esc(meaning)}</p><p>${esc(this._text(state?.attributes?.restored === true ? 'storedSource' : 'source'))}: ${esc(draft.entity ? formatEntityValue(this.hass, draft.entity) : this._text('chooseSource'))}${state ? ` · ${esc(draft.entity)}` : ''}</p>
      <p class="trk-hint">${esc(this._text(restored.length ? 'waiting' : draft.freshness ? 'savedFreshness' : 'noGuessedAge'))}</p>
      ${restored.length && draft.freshness ? `<p class="trk-hint">${esc(this._text('savedFreshness'))}</p>` : ''}
      ${restored.map(([label, entity]) => `<p class="trk-note">${esc(this._text('restored', { label: this._sourceLabel(label), entity }))}</p>`).join('')}
      ${unavailable && draft.entity ? `<p class="trk-note">${esc(this._text('unavailable'))}</p>` : ''}
      ${this.message ? `<p class="trk-note" role="status">${esc(this._message(this.message))}</p>` : ''}
      ${issues.length ? `<ul>${[...new Set(issues)].map((issue) => `<li>${esc(this._message(issue))}</li>`).join('')}</ul>` : `<p>${esc(this._text(restored.length ? 'canWait' : 'ready'))}</p>`}`;
  }
  updatePreviews(container) {
    if (this.disposed || !container) return;
    const captionRoot = container.matches?.('[data-trk-editor]') ? container : container.querySelector('[data-trk-editor]');
    this.observe(); if (captionRoot) this._bind(captionRoot);
    this._translateCaptions(captionRoot);
    if (!this.draft) return;
    this.previewContainer = container;
    const before = this.calibrationPreview, revision = this.pickRevision, calibration = this._ensureCalibration();
    calibration?.updatePreviews(container);
    syncOptions(container.querySelector('[data-field="trk-area-filter"]'), this._areaChoices().map(([value, label]) => [value, label, false]), this.areaFilter);
    const pickerRows = (entries) => [['', 'Choose an actual entity', false], ...entries.map((entry) => [entry.value, `${entry.label} · ${entry.value}`, !entry.selectable])];
    syncOptions(container.querySelector('[data-field="trk-entity"]'), pickerRows(this._choices()), this.draft.entity);
    syncOptions(container.querySelector('[data-field="trk-room-source"]'), pickerRows(entityChoices(this.hass, { ...this._pickerFilters(), domains: ['sensor', 'select', 'input_select', 'device_tracker', 'person'], selected: this.draft.room_source?.entity })), this.draft.room_source?.entity);
    syncOptions(container.querySelector('[data-field="trk-identity"]'), pickerRows(entityChoices(this.hass, { ...this._pickerFilters(), domains: this.section === 'presence' ? ['person', 'device_tracker'] : ['sensor', 'device_tracker', 'event'], selected: this.draft.identity_entity })), this.draft.identity_entity);
    const positionPicker = container.querySelector('[data-field="trk-cal-entity"]');
    if (positionPicker && calibration) {
      const selected = calibration.source.entity || '', rows = [['', 'Choose the actual position source', false], ...entityChoices(this.hass, { ...this._pickerFilters(), domains: ['sensor', 'device_tracker', 'vacuum'], selected }).map((item) => [item.value, `${item.label} · ${item.value}`, !item.selectable])];
      syncOptions(positionPicker, rows, selected);
    }
    for (const target of container.querySelectorAll('[data-trk-freshness-preview]')) {
      const html = this._freshnessPreview(target.dataset.trkFreshnessPreview);
      if (target.innerHTML !== html) target.innerHTML = html;
    }
    const fieldset = container.querySelector('[data-trk-cal-fieldset]');
    if (fieldset) fieldset.disabled = this._readOnly();
    const target = container.querySelector('[data-trk-preview]'), html = this._preview();
    if (target && target.innerHTML !== html) target.innerHTML = html;
    const root = container.matches?.('[data-trk-editor]') ? container : container.querySelector('[data-trk-editor]');
    for (const control of root?.querySelectorAll('[data-trk-setting]') || []) control.disabled = this._readOnly();
    const relink = root?.querySelector('[data-act="trk-relink"]');
    if (relink) relink.hidden = this._referenceIssues().length === 0;
    if (before !== this.calibrationPreview && revision === this.pickRevision) this._refreshCalibrationOverlay();
    this._translateCaptions(root);
  }

  render() {
    if (this.disposed) return '';
    const draft = this.draft;
    const saved = this.bindings.map((binding, index) => `<li><span>${binding?.label || binding?.entity ? esc(binding.label || binding.entity) : editorDetailSpan(this.hass, 'common.savedBinding', { index: index + 1 })}${binding?.enabled === false ? this._help('common.disabled') : ''}<small>${binding?.kind ? esc(binding.kind) : this._help('common.unknownType')}</small></span>${button('edit', 'Edit', `data-index="${index}"`)}${button('clear', 'Clear saved binding', `data-index="${index}"`)}</li>`).join('');
    let fields = '';
    if (draft) {
      const typeChoices = kinds[this.section].some(([kind]) => kind === draft.kind) ? kinds[this.section] : [[draft.kind, this._text('unsupportedType', { value: String(draft.kind) }), { key: 'tracking.unsupportedType', params: { value: String(draft.kind) } }], ...kinds[this.section]];
      fields = `${select('kind', 'Observation type', draft.kind, typeChoices)}${input('label', 'Display label (optional)', draft.label)}${check('enabled', 'Show this binding', draft.enabled !== false)}
        ${this._filterHtml()}${this._entitySelect('entity', this.section === 'vacuums' ? 'Vacuum status entity' : 'Observation source', draft.entity, this._choices())}
        <section><h4>Marker appearance</h4>${input('color', 'Marker colour (blank uses the display default)', draft.color ?? '', 'placeholder="#aabbcc"')}
        ${input('size', 'Marker size, 0.1 to 5', draft.size ?? '', 'type="number" min="0.1" max="5" step="any" placeholder="1"')}
        ${input('heading', 'Marker heading, degrees clockwise from north', draft.heading ?? '', 'inputmode="decimal"')}
        <p class="trk-hint">${this._help('appearanceHelp')}</p>
        ${this.section === 'vehicles' || this.section === 'presence' && draft.kind === 'room_activity' ? check('show-inactive', 'Keep inactive markers visible with their actual status label', draft.show_inactive === true) : ''}
        ${this.section === 'vacuums' && draft.kind === 'xy' ? `${input('interpolate-ms', 'Smooth consecutive measured positions, milliseconds', draft.interpolate_ms ?? '', `type="number" min="0" max="${TRACKING_LIMITS.interpolation}" step="any" placeholder="0"`)}<p class="trk-hint">${this._help('smoothingHelp')}</p>` : ''}</section>`;
      fields += this._freshnessFields('status');
      if (this.section === 'presence' && draft.kind === 'room_activity') fields += `${select('signal', 'What this sensor reports', draft.signal, [['motion', 'Motion — activity, not identity'], ['occupancy', 'Occupancy — anonymous']])}${input('active', 'Active source states, separated by commas', words(draft.active_states).join(', '))}${input('clear', 'Clear source states, separated by commas', words(draft.clear_states).join(', '))}`;
      if (this.section === 'presence' && draft.kind === 'room_location' || this.section === 'vacuums' && draft.kind === 'room') fields += this._roomMapping();
      if (this.section === 'presence' && draft.kind === 'room_location') fields += this._identity();
      if (this.section === 'vehicles') {
        fields += check('vehicle-confirmed', 'This source reports vehicles here, not general motion', draft.vehicle_source_confirmed === true);
        if (draft.kind === 'occupancy') fields += `${input('active', 'Occupied source states, separated by commas', words(draft.active_states).join(', '))}${input('clear', 'Empty source states, separated by commas', words(draft.clear_states).join(', '))}`;
        if (draft.kind === 'count') fields += `<p class="trk-hint">${this._help('countHelp')}</p>`;
        if (draft.kind === 'event') fields += this._eventFields();
        fields += this._identity();
      }
      if (this.section === 'vacuums' && draft.kind === 'xy') fields += this._xyFields();
      if (!(this.section === 'presence' && draft.kind === 'room_location')) fields += `<section><h4>${this.section === 'vacuums' && draft.kind !== 'static' ? 'Fallback display location' : 'Display location'}</h4>${select('location-mode', 'How to choose the display location', this.locationMode, locationKinds)}${this._location()}</section>`;
      if (this._readOnly()) fields = fields.replace(/data-trk-setting/g, 'data-trk-setting disabled');
    }
    return this._captions(`<section data-trk-editor data-taylors3d-ui="tracking-editor"><style>
      [data-trk-editor]{color:var(--primary-text-color,#212121)}[data-trk-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0}
      [data-trk-editor] input,[data-trk-editor] select,[data-trk-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-trk-editor] input:not([type=checkbox]),[data-trk-editor] select{width:100%}[data-trk-editor] .trk-check{flex-direction:row;align-items:center}[data-trk-editor] .trk-check input{min-width:22px;flex-shrink:0}
      [data-trk-editor] button{cursor:pointer;min-width:44px}[data-trk-editor] button:disabled,[data-trk-editor] input:disabled,[data-trk-editor] select:disabled{opacity:.6;cursor:default}
      [data-trk-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-trk-editor] nav,[data-trk-editor] .trk-actions{display:flex;gap:7px;flex-wrap:wrap}
      [data-trk-editor] [aria-pressed=true]{border:2px solid var(--primary-color,#03a9f4)}[data-trk-editor] li{overflow-wrap:anywhere}[data-trk-editor] .trk-saved{padding:0;list-style:none}
      [data-trk-editor] .trk-saved li{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:8px 0}[data-trk-editor] .trk-saved span{flex:1;min-width:110px}[data-trk-editor] small{display:block}
      [data-trk-editor] .trk-hint{color:var(--secondary-text-color,#666)}[data-trk-editor] .trk-note{border-left:3px solid var(--primary-color,#03a9f4);padding-left:9px}[data-trk-editor] section{margin-top:14px}[data-trk-editor] h4{margin:14px 0 7px}
      [data-trk-cal-fieldset]{min-width:0;padding:0;border:0;margin:0}[data-trk-freshness] pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}
      </style><h3>Tracking</h3><p class="trk-hint">${this._help('intro')}</p>
      <nav aria-label="Tracking types">${Object.entries(sections).map(([id, [label]]) => button('section', label, `data-section="${id}" aria-pressed="${id === this.section}"`)).join('')}</nav>
      <ul class="trk-saved">${saved}</ul>${!draft ? button('add', `Add ${this.section === 'presence' ? 'presence binding' : this.section === 'vehicles' ? 'vehicle binding' : 'vacuum binding'}`) : ''}
      ${draft ? `<section><h4>Unsaved binding</h4>${fields}<div data-trk-preview aria-live="polite">${this._preview()}</div>
      <div class="trk-actions">${button('save', 'Save', `data-trk-setting ${this._readOnly() ? 'disabled' : ''}`)}${button('cancel', 'Cancel')}${button('relink', 'Relink deliberately', this._referenceIssues().length ? '' : 'hidden')}${this.editingIndex !== null ? button('clear-draft', 'Clear saved binding') : ''}</div></section>` : ''}</section>`);
  }

  _calibrationField(field, element, inputOnly = false) {
    const calibration = this._ensureCalibration(), revision = this.pickRevision;
    if (!calibration || this._readOnly()) return true;
    if (field === 'trk-cal-entity' && element.value && !entityChoices(this.hass, { domains: ['sensor', 'device_tracker', 'vacuum'], selected: element.value }).some((choice) => choice.value === element.value && choice.selectable)) return true;
    calibration.onChange(field, element); this.message = null;
    this._observed = this._context(); this._revalidatePresses();
    if (revision === this.pickRevision) this._refreshCalibrationOverlay();
    if (!inputOnly && ['trk-cal-frame', 'trk-cal-source', 'trk-cal-units', 'trk-cal-entity', 'trk-cal-x_attr', 'trk-cal-y_attr', 'trk-cal-latitude_attr', 'trk-cal-longitude_attr', 'trk-cal-floorId'].includes(field)) { this.previewContainer = null; this.onRender(); }
    else if (this.previewContainer) this.updatePreviews(this.previewContainer);
    return true;
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith('trk-')) return false;
    this.observe(); if (!this._fieldCurrent(element)) return true;
    if (field === 'trk-area-filter') {
      if (['all', 'unassigned'].includes(element.value) || element.value.startsWith('area:') && Object.hasOwn(this.hass.areas || {}, element.value.slice(5))) this.areaFilter = element.value;
      this.previewContainer = null; this.onRender(); return true;
    }
    if (!this.draft || this._readOnly()) return true;
    if (field.startsWith('trk-freshness-')) return this._changeFreshness(field, element);
    if (field.startsWith('trk-cal-')) return this._calibrationField(field, element);
    const draft = this.draft, value = element.value, name = field.slice(4), structural = new Set(['kind', 'location-mode', 'identity', 'timestamp-mode']);
    if (name === 'kind') {
      if (!kinds[this.section].some(([kind]) => kind === value)) return true;
      this._clearCalibration();
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
    else if (['color', 'size', 'heading', 'interpolate-ms', 'show-inactive'].includes(name)) {
      const key = name.replace('-', '_');
      if (key === 'interpolate_ms' && (this.section !== 'vacuums' || draft.kind !== 'xy') || key === 'show_inactive' && !(this.section === 'vehicles' || this.section === 'presence' && draft.kind === 'room_activity')) return true;
      draft[key] = key === 'show_inactive' ? element.checked : value; this.styleEdits.add(key);
    }
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
    else return false;
    this.message = null;
    this._observed = this._context(); this._revalidatePresses();
    if (structural.has(name)) { this.previewContainer = null; this.onRender(); }
    else if (this.previewContainer) this.updatePreviews(this.previewContainer);
    return true;
  }
  onInput(field, element) {
    if (this.disposed || !field?.startsWith('trk-')) return false;
    this.observe(); if (!this._fieldCurrent(element)) return true;
    if (field?.startsWith('trk-freshness-')) return ['INPUT', 'TEXTAREA'].includes(element.tagName) && this._changeFreshness(field, element, true);
    if (field?.startsWith('trk-cal-')) return ['INPUT', 'TEXTAREA'].includes(element.tagName) && this._calibrationField(field, element, true);
    return !['trk-kind', 'trk-location-mode', 'trk-identity', 'trk-timestamp-mode'].includes(field) && this.onChange(field, element);
  }
  onClick(action, element = {}) {
    if (this.disposed || !action?.startsWith('trk-')) return false;
    this.observe();
    if (element.nodeType === 1 && (element.dataset.act !== action || !this._consume(element))) return true;
    if (action === 'trk-cancel') { this.reset(); this.onRender(); return true; }
    if (!this.canEdit || this.stale) return true;
    if (action.startsWith('trk-cal-')) {
      const calibration = this._ensureCalibration(), revision = this.pickRevision;
      if (calibration && !this._readOnly()) {
        calibration.onClick(action, element);
        if (revision === this.pickRevision) this._refreshCalibrationOverlay();
        this.onRender();
      }
      return true;
    }
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
  _fieldCurrent(element) {
    if (element?.nodeType !== 1) return true;
    const context = this._fields.get(element);
    return this._live(element) && !!context && context.epoch === this._epoch && context.draft === this.draft;
  }
  _live(element) { return element?.isConnected === true && !!this._root?.contains(element); }
  _button(event) { const button = event.target?.closest?.('button[data-act]'); return button?.dataset.act?.startsWith('trk-') ? button : null; }
  _stamp(button) { return { context: this._context(), epoch: this._epoch, action: button.dataset.act, section: this.section,
    draft: JSON.stringify([this.draft, this.maps, this.locationMode]), pending: this.pendingPlanPick?.token,
    reading: button.dataset.act === 'trk-cal-capture' ? JSON.stringify(this.calibration?.evidence()) : null }; }
  _matches(stamp, button) { const next = this._stamp(button); return this._live(button) && !button.disabled
    && (button.dataset.act === 'trk-cancel' || this.canEdit && !this.stale) && this._same(stamp.context, next.context)
    && ['epoch', 'action', 'section', 'draft', 'pending', 'reading'].every((key) => stamp[key] === next[key]); }
  _revalidatePresses() { for (const [button, intent] of this._pressed) if (!this._matches(intent.stamp, button)) intent.poisoned = true; }
  _unbind() {
    for (const intent of this._pressed.values()) intent.poisoned = true; this._pressed.clear();
    if (this._root) for (const [type, handler] of this._handlers) this._root.removeEventListener(type, handler, true); this._root = null;
  }
  _bind(root) {
    if (this._root === root) return; this._unbind(); this._root = root;
    for (const input of root.querySelectorAll('[data-field^="trk-"]')) this._fields.set(input, { epoch: this._epoch, draft: this.draft });
    for (const [type, handler] of this._handlers) root.addEventListener(type, handler, true);
  }
  _press(event) {
    const button = this._button(event); if (!button || !this._live(button) || event.button !== undefined && event.button !== 0 || event.isPrimary === false) return;
    // A fresh Cancel only discards this local draft. It remains available after
    // a context loss; existing stamps still reject an interrupted old gesture.
    this.observe(); const intent = { stamp: this._stamp(button), poisoned: button.disabled || (button.dataset.act !== 'trk-cancel' && (!this.canEdit || this.stale)),
      consumed: false, held: true, kind: event.type === 'keydown' ? 'keyboard' : 'pointer', key: event.key, pointerId: event.pointerId };
    this._intents.set(button, intent); this._pressed.set(button, intent);
  }
  _key(event) {
    if (!['Enter', ' '].includes(event.key)) return; const button = this._button(event); if (!button) return;
    const intent = this._intents.get(button);
    if (event.repeat || intent?.held && intent.kind === 'keyboard') { if (!intent) { this._press(event); this._intents.get(button).poisoned = true; } this._revalidatePresses(); return; }
    this._press(event);
  }
  _release(event) {
    const button = this._button(event), intent = this._intents.get(button);
    if (!intent || event.type === 'keyup' && (intent.kind !== 'keyboard' || intent.key !== event.key)
      || event.type === 'pointerup' && (intent.kind !== 'pointer' || intent.pointerId !== undefined && intent.pointerId !== event.pointerId)) return;
    this.observe(); intent.held = false;
  }
  _cancelPress(event) { const intent = this._intents.get(this._button(event)); if (intent?.held) { intent.poisoned = true; intent.held = false; } }
  _consume(button) {
    if (!this._live(button) || button.disabled) return false; this._revalidatePresses(); const intent = this._intents.get(button);
    if (!intent) return true;
    if (intent.poisoned || intent.consumed || !this._matches(intent.stamp, button)) { intent.poisoned = true; return false; }
    intent.consumed = true; return true;
  }
}
