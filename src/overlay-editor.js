// Visual room measurements and alert bindings. Saving changes configuration, never device state.
import { aggregateMeasurements, alertState, buildAlerts, resolveAlertLocation, measurementPeriod, STATUS_PALETTES } from './status-overlays.js';
import { entityChoices, entityMetadata, formatEntityValue } from './entity-metadata.js';
import { editorDetailText, editorDetailSpan, updateEditorDetails, renderEditorDetails, editorOwnedMessage } from './editor-runtime-details.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const copy = (value) => JSON.parse(JSON.stringify(value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const locationKeys = ['location_mode', 'roomId', 'room_id', 'position_key', 'markerId', 'x', 'y', 'z', 'floorId', 'floor_id'];
const locationValue = (value) => JSON.stringify(Object.fromEntries(locationKeys.filter((key) => Object.hasOwn(value || {}, key)).map((key) => [key, value[key]])));
const coordinate = (value) => typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && finite(Number(value)) ? Number(value) : value;
const periods = [['hour', 'This hour'], ['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['lifetime', 'Lifetime total']];
const units = { temperature: ['°C', '°F', 'K'], power: ['W', 'kW'], energy: ['kWh', 'Wh'] };
const option = (value, label, selected, selectable = true) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''} ${selectable ? '' : 'disabled'}>${esc(label)}</option>`;
const optionsHtml = (value, choices) => choices.map(([id, label, selectable]) => option(id, label, value, selectable)).join('');
const selector = (field, value, choices, attrs = '') => `<select data-field="${field}" ${attrs}>${optionsHtml(value, choices)}</select>`;
const periodSelector = (field, value, attrs = '') => selector(field, measurementPeriod(value) || '', [['', 'Choose the measured period'], ...periods], attrs);
const roomName = (entry, hass) => entry.name || entry.room?.name || entry.room?.label || hass.areas?.[entry.room?.area_id]?.name || entry.room?.id;

function storedReading(metadata) {
  const attributes = metadata.state?.attributes;
  return attributes && Object.hasOwn(attributes, 'restored') && attributes.restored !== false;
}
function sourceChoices(hass, domains, capability, filters) {
  return entityChoices(hass, { ...filters, domains, availableOnly: true,
    capability: (metadata) => !storedReading(metadata) && capability(metadata),
  }).map((choice) => storedReading(choice)
    ? { ...choice, label: `${choice.name} (${editorDetailText(hass, 'overlay.storedReading')})`, selectable: false }
    : choice);
}
function measurementChoices(hass, mode, filters = {}) {
  const allowed = units[mode] || [];
  return sourceChoices(hass, ['sensor'], (metadata) => allowed.includes(metadata.unit) || metadata.deviceClass === mode, filters);
}
function alertChoices(hass, type, filters = {}) {
  const domains = type === 'unlocked' ? ['lock'] : type === 'smoke' || type === 'leak' ? ['binary_sensor']
    : ['sensor', 'binary_sensor', 'lock', 'alarm_control_panel', 'input_boolean'];
  return sourceChoices(hass, domains, (metadata) => type !== 'smoke' && type !== 'leak'
    || metadata.deviceClass === (type === 'leak' ? 'moisture' : 'smoke'), filters);
}
/** Native picker tuples retain explicitly selected unavailable links as disabled warning options. */
export function measurementSensors(hass = {}, mode, filters = {}) {
  return measurementChoices(hass, mode, filters).map(({ value, label, selectable }) => [value, label, selectable]);
}
export function alertSensors(hass = {}, type, filters = {}) {
  return alertChoices(hass, type, filters).map(({ value, label, selectable }) => [value, label, selectable]);
}

function defaults(mode = 'temperature') {
  return { unit: units[mode]?.[0], min: mode === 'temperature' ? 16 : 0, max: mode === 'temperature' ? 28 : mode === 'power' ? 3000 : 20,
    palette: mode === 'temperature' ? 'temperature' : 'usage' };
}

function convert(value, mode, from, to) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  if (mode === 'temperature') {
    const c = from === '°F' ? (value - 32) * 5 / 9 : from === 'K' ? value - 273.15 : value;
    return to === '°F' ? c * 9 / 5 + 32 : to === 'K' ? c + 273.15 : c;
  }
  return value * (from?.startsWith('k') ? 1000 : 1) / (to?.startsWith('k') ? 1000 : 1);
}
function displayRange(mode, unit) {
  const base = defaults(mode);
  return { min: convert(base.min, mode, base.unit, unit || base.unit), max: convert(base.max, mode, base.unit, unit || base.unit) };
}

export class OverlayEditor {
  _text(id, params) { return editorDetailText(this.hass, `overlay.${id}`, params); }
  _help(id, params) { return editorDetailSpan(this.hass, `overlay.${id}`, params); }
  _message(value) { return editorOwnedMessage(this.hass, value); }
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.roomId = null; this.draftAlert = null; this.message = null;
    this.areaFilter = 'all'; this._savedAlertLink = null;
    this._locationEdited = false; this._savedLocation = null; this._nativeRoot = null;
    this._intents = new WeakMap(); this._pressed = new Map();
    this._permissionDisabled = new WeakMap();
    this._nativeHandlers = new Map([
      ['input', (event) => this._locationInput(event)],
      ['pointerdown', (event) => this._press(event)], ['keydown', (event) => this._press(event)],
      ['pointerup', () => this._pollIntents()], ['keyup', () => this._pollIntents()],
      ['pointercancel', (event) => this._cancelPress(event)], ['focusout', (event) => this._cancelPress(event)],
    ]);
  }
  reset() { this._bindNative(null); this.roomId = null; this.draftAlert = null; this.message = null; this.areaFilter = 'all'; this._savedAlertLink = null; this._locationEdited = false; this._savedLocation = null; }
  get hass() { return this.card._hass || {}; }
  get rooms() { return (this.card._roomList || []).filter((entry) => entry.room?.id).map((entry) => ({ ...entry, name: roomName(entry, this.hass) })); }
  get config() {
    const value = this.card._layout?.room_overlays ?? this.card._config?.room_overlays;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { mode: 'off', bindings: {} };
  }
  get alerts() {
    return this._alertRows().map(({ binding }) => binding);
  }
  _rawAlerts() {
    const value = this.card._layout?.alert_bindings ?? this.card._config?.alert_bindings;
    return Array.isArray(value) ? value : [];
  }
  _alertRows() {
    let ordinal = 0;
    return this._rawAlerts().flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return [];
      ordinal++;
      return [{ raw, index, binding: { ...raw, id: raw.id || raw.entity || `imported_alert_${ordinal}` } }];
    });
  }
  get room() { return this.rooms.find((room) => room.room.id === this.roomId) || this.rooms[0]; }
  get binding() { return this.config.bindings?.[this.room?.room.id] || {}; }
  get sources() {
    const value = Array.isArray(this.binding) ? this.binding : this.binding.entities;
    return (Array.isArray(value) ? value : []).filter((source) => typeof source === 'string' || source && typeof source === 'object' && typeof source.entity === 'string')
      .map((source) => typeof source === 'string' ? { entity: source } : source);
  }

  get pickerFilter() {
    return this.areaFilter === 'unassigned' ? { areaId: null }
      : this.areaFilter.startsWith('area:') ? { areaId: this.areaFilter.slice(5) } : {};
  }
  _areaChoices() {
    const areas = Object.entries(this.hass.areas || {}).map(([id, area]) => [`area:${id}`, area.name || id])
      .sort((a, b) => a[1].localeCompare(b[1]));
    const choices = [['all', 'All areas'], ['unassigned', 'Unassigned'], ...areas];
    if (!choices.some(([id]) => id === this.areaFilter)) choices.push([this.areaFilter, this._text('missingArea', { id: this.areaFilter.slice(5) }), false]);
    return choices;
  }
  _sourceInfo(entity, type, alert = false) {
    const metadata = entityMetadata(this.hass, entity);
    const choices = alert ? alertChoices(this.hass, type, { ...this.pickerFilter, selected: entity })
      : measurementChoices(this.hass, type, { ...this.pickerFilter, selected: entity });
    const choice = choices.find((entry) => entry.value === entity);
    return { name: metadata.name, warning: choice && !choice.selectable ? choice.label : '',
      reading: storedReading(metadata) ? this._text('storedReading') : formatEntityValue(this.hass, entity) };
  }
  _addSourceChoices(selected = '') {
    return [['', 'Choose a sensor'], ...measurementSensors(this.hass, this.config.mode, { ...this.pickerFilter, selected })
      .filter(([entity]) => !this.sources.some((source) => source.entity === entity))];
  }
  _alertEntityChoices() {
    const draft = this.draftAlert;
    return [['', 'Choose a sensor'], ...alertSensors(this.hass, draft?.type, { ...this.pickerFilter, selected: draft?.entity })];
  }

  _canEdit() {
    const user = this.hass.user;
    if (user && (user.is_admin !== true || Object.hasOwn(user, 'is_active') && user.is_active !== true || typeof user.id !== 'string' || !user.id.trim())) return false;
    if (this.hass.connected === false || this.hass.connection?.connected === false || this.card._loading) return false;
    if (typeof this.card.editAllowed === 'function') return this.card.editAllowed() === true;
    if (typeof this.card.editAllowed === 'boolean') return this.card.editAllowed;
    return !!user && this.hass.connection?.connected === true;
  }
  _locationMode() {
    const value = this.draftAlert || {};
    if (Object.hasOwn(value, 'location_mode')) return ['room', 'marker', 'coordinates'].includes(value.location_mode) ? value.location_mode : 'saved';
    return value.x !== undefined || value.y !== undefined ? 'coordinates' : value.position_key !== undefined || value.markerId !== undefined ? 'marker' : 'legacy';
  }
  _floors() { return (Array.isArray(this.card._floors) ? this.card._floors : []).map((floor) => ({ ...floor, elevation: finite(floor.elevation) ? this.card._view?.floorElevation?.(floor.id) ?? floor.elevation : floor.elevation })); }
  _canAddAlert() {
    const floors = this._floors();
    return !!this.rooms.length || floors.some((floor) => typeof floor.id === 'string' && !!floor.id.trim()
      && floors.filter((entry) => entry.id === floor.id).length === 1 && finite(floor.elevation) && !floor.stale);
  }
  _anchors() {
    const value = this.card.trackingAnchors?.();
    if (Array.isArray(value)) return value.filter((anchor) => typeof anchor?.id === 'string' && !!anchor.id.trim());
    return (this.card._markers || []).flatMap((marker) => {
      const position = this.card._positions?.get?.(marker.id);
      return position ? [{ id: marker.id, label: marker.name || marker.id, position }] : [];
    });
  }
  _positions() {
    const positions = new Map(), ids = new Set();
    for (const marker of this.card._markers || []) {
      const position = this.card._positions?.get?.(marker.id);
      if (!position) continue;
      for (const entity of [marker.entityId, ...(marker.entities || []).map((item) => item.eid || item)]) if (typeof entity === 'string') positions.set(entity, position);
    }
    for (const anchor of this._anchors()) { positions.set(anchor.id, ids.has(anchor.id) ? null : { ...anchor.position, shown: anchor.shown !== false && anchor.position?.shown !== false }); ids.add(anchor.id); }
    return positions;
  }
  _roomChoices() {
    const selected = this.draftAlert?.roomId ?? this.draftAlert?.room_id ?? '';
    const rows = [['', 'Choose an exact room'], ...this.rooms.map((entry) => [entry.room.id, this.rooms.filter((room) => room.room.id === entry.room.id).length === 1 ? entry.name : this._text('ambiguousRoom', { name: entry.name }), this.rooms.filter((room) => room.room.id === entry.room.id).length === 1])];
    if (selected && !rows.some(([id]) => id === selected)) rows.push([selected, this._text('missingRoom', { id: selected }), false]);
    return rows;
  }
  _floorChoices() {
    const selected = this.draftAlert?.floorId ?? this.draftAlert?.floor_id ?? '', floors = this._floors();
    const rows = [['', this._locationMode() === 'marker' ? 'Use this marker’s exact source floor' : 'Choose an exact source floor'], ...floors.map((floor) => {
      const valid = floors.filter((entry) => entry.id === floor.id).length === 1 && finite(floor.elevation) && !floor.stale;
      return [floor.id, valid ? floor.name || floor.id : this._text('invalidFloor', { name: floor.name || floor.id }), valid];
    })];
    if (selected && !rows.some(([id]) => id === selected)) rows.push([selected, this._text('missingFloor', { id: selected }), false]);
    return rows;
  }
  _anchorChoices() {
    const selected = this.draftAlert?.position_key ?? this.draftAlert?.markerId ?? '', anchors = this._anchors(), positions = this._positions();
    const rows = [['', 'Choose an exact marker'], ...anchors.map((anchor) => {
      const valid = anchors.filter((entry) => entry.id === anchor.id).length === 1 && !!resolveAlertLocation({ location_mode: 'marker', position_key: anchor.id }, { floors: this._floors(), positions }).location;
      return [anchor.id, valid ? anchor.label || anchor.id : this._text('invalidMarker', { name: anchor.label || anchor.id }), valid];
    })];
    if (selected && !rows.some(([id]) => id === selected)) rows.push([selected, this._text('missingMarker', { id: selected }), false]);
    return rows;
  }
  _rawAlert() {
    const value = { ...this.draftAlert };
    if (this._locationEdited && value.location_mode === 'coordinates') for (const key of ['x', 'y', 'z']) value[key] = coordinate(value[key]);
    return value;
  }
  _locationEvaluation(display = false) {
    if (!this.draftAlert) return { location: null, diagnostics: [] };
    return buildAlerts({ bindings: [{ ...this._rawAlert(), enabled: true }], states: this.hass.states,
      rooms: this.card._roomList || [], floors: this._floors(), positions: this._positions() }, display ? this.hass : undefined).alerts[0] || { location: null, diagnostics: [] };
  }
  _setLocation(mode) {
    const draft = this.draftAlert, room = draft.roomId ?? draft.room_id ?? '', marker = draft.position_key ?? draft.markerId ?? '';
    const floor = draft.floorId !== undefined && draft.floor_id !== undefined && draft.floorId !== draft.floor_id ? '' : draft.floorId ?? draft.floor_id ?? '';
    const coords = { x: draft.x ?? '', y: draft.y ?? '', z: draft.z ?? '' };
    for (const key of locationKeys) delete draft[key];
    draft.location_mode = mode;
    if (mode === 'room') draft.roomId = room;
    else if (mode === 'marker') { draft.position_key = marker; if (floor) draft.floor_id = floor; }
    else { Object.assign(draft, coords); draft.floor_id = floor; }
    this._locationEdited = true;
  }
  _intentStamp() {
    const draft = this.draftAlert, current = this.alerts.find((alert) => alert.id === this._savedAlertLink?.id);
    const sourceValid = !this._locationEdited || alertChoices(this.hass, draft?.type).some((choice) => choice.value === draft?.entity && choice.selectable);
    return { connection: this.hass.connection, root: this.card._view?.model?.root,
      key: JSON.stringify([this.card._config?.layout_key ?? 'default', this.hass.user?.id, this.hass.user?.is_admin, this.hass.user?.is_active,
        this._canEdit(), sourceValid, this._locationEvaluation().location !== null, draft, current && locationValue(current)]) };
  }
  _pollIntents() {
    if (!this._pressed.size) return;
    const current = this._intentStamp();
    for (const [button, intent] of this._pressed) {
      if (!button.isConnected || !this._nativeRoot?.contains(button)) { intent.poisoned = true; this._pressed.delete(button); }
      else if (current.connection !== intent.stamp.connection || current.root !== intent.stamp.root || current.key !== intent.stamp.key) intent.poisoned = true;
    }
  }
  _press(event) {
    const button = event.target?.closest?.('[data-act="ovr-save-alert"]');
    if (!button || !this._nativeRoot?.contains(button) || button.disabled || event.type === 'pointerdown' && event.button > 0
      || event.type === 'keydown' && (![' ', 'Enter'].includes(event.key) || event.repeat)) return;
    const intent = { stamp: this._intentStamp(), poisoned: !this._canEdit() };
    this._intents.set(button, intent); this._pressed.set(button, intent);
  }
  _cancelPress(event) { const intent = this._intents.get(event.target); if (intent) intent.poisoned = true; }
  _bindNative(container) {
    if (this._nativeRoot === container) return;
    if (this._nativeRoot) for (const [name, handler] of this._nativeHandlers) this._nativeRoot.removeEventListener(name, handler, true);
    this._pressed.clear(); this._intents = new WeakMap(); this._nativeRoot = container || null;
    if (container) for (const [name, handler] of this._nativeHandlers) container.addEventListener(name, handler, true);
  }
  _locationInput(event) {
    const field = event.target?.dataset?.field;
    if (!this.draftAlert || !this._canEdit() || !['ovr-alert-x', 'ovr-alert-y', 'ovr-alert-z'].includes(field)) return;
    this.draftAlert[field.slice(-1)] = event.target.value; this.draftAlert.location_mode = 'coordinates'; this._locationEdited = true;
    this.message = null; this.updatePreviews(this._nativeRoot);
  }

  _commit(patch) {
    if (!this._canEdit()) { this._error('Only a current administrator can save overlay settings.'); return; }
    this.message = null;
    if (this.card.commitFeatureLayout) this.card.commitFeatureLayout(patch);
    else this.card._commit({ ...this.card._layout, ...patch });
    this.onRender();
  }
  _config(patch) { this._commit({ room_overlays: { ...this.config, ...patch } }); }
  _binding(patch) {
    if (!this.room) return;
    const binding = Array.isArray(this.binding) ? { entities: this.sources } : this.binding;
    this._config({ bindings: { ...this.config.bindings, [this.room.room.id]: { aggregation: this.config.mode === 'temperature' ? 'mean' : 'sum', ...binding, ...patch } } });
  }
  _source(entity, patch) { this._binding({ entities: this.sources.map((source) => source.entity === entity ? { ...source, ...patch } : source) }); }
  _error(message) { this.message = message; this.onRender(); }

  _measurementPreview() {
    const cfg = this.config, mode = cfg.mode || 'off';
    if (!this.room || mode === 'off') return '';
    const metric = aggregateMeasurements(this.binding, this.hass.states, this.hass.entities, { mode, unit: cfg.unit || units[mode]?.[0], period: cfg.period }, this.hass);
    return `<section class="box" aria-live="polite"><h3>Aggregate preview</h3><p>${esc(metric.value === null ? this._text('noValid') : `${Number(metric.value.toFixed(2))} ${metric.unit}`)} · ${esc(metric.status)}</p>
      <p class="hint">${esc(this._text('aggregateHelp'))}</p>
      <p class="hint">${esc(this._text('available', { valid: metric.valid, requested: metric.requested }))}</p>${metric.diagnostics.length ? `<ul>${metric.diagnostics.map((issue) => `<li>${esc(this._message(issue))}${issue.entity ? ` (${esc(issue.entity)})` : ''}${issue.choices?.length ? `: ${issue.choices.map(esc).join(', ')}` : ''}</li>`).join('')}</ul>` : ''}</section>`;
  }

  _alertPreview() {
    const draft = this.draftAlert;
    if (!draft) return '';
    if (storedReading(entityMetadata(this.hass, draft.entity))) return `<p role="status">${esc(this._text('stored'))}</p>`;
    const result = alertState(draft, this.hass.states?.[draft.entity], { latched: !!this.card._alertLatches?.[draft.id] }, this.hass);
    const preview = this._locationEvaluation(true);
    return `<p role="status">${esc(this._text('preview'))} ${esc(this._message(result.message))}${this.hass.states?.[draft.entity] ? ` (${esc(this._text('sensor'))} ${esc(this.hass.states[draft.entity].state)})` : ''}</p>
      ${(preview.diagnostics || []).map((issue) => `<p class="note warn">${esc(this._message(issue))}</p>`).join('')}`;
  }

  _locationHtml() {
    const draft = this.draftAlert, mode = this._locationMode();
    const choices = [['room', 'Room'], ['marker', 'Exact marker'], ['coordinates', 'Fixed source coordinates']];
    if (mode === 'legacy') choices.unshift(['legacy', 'Existing sensor / room placement (unchanged)']);
    if (mode === 'saved') choices.unshift(['saved', `Unsupported saved location mode: ${String(draft.location_mode)}`, false]);
    const input = (axis, label) => `<label>${label}<input inputmode="decimal" data-ovr-location-setting data-field="ovr-alert-${axis}" value="${esc(draft[axis] ?? '')}" placeholder="Enter metres"></label>`;
    return `<section><label>Alert location ${selector('ovr-alert-location', mode, choices)}</label>
      ${Object.hasOwn(draft, 'location_mode') ? '' : `<p class="hint">${this._help('legacyHelp')}</p>`}
      ${mode === 'legacy' || mode === 'room' ? `<label>Room ${selector('ovr-alert-room', draft.roomId ?? draft.room_id ?? '', this._roomChoices())}</label>` : ''}
      ${mode === 'marker' ? `<label>Exact current marker ${selector('ovr-alert-position-key', draft.position_key ?? draft.markerId ?? '', this._anchorChoices())}</label><label>Optional source floor override ${selector('ovr-alert-floor', draft.floorId ?? draft.floor_id ?? '', this._floorChoices())}</label><p class="hint">${this._help('markerHelp')}</p>` : ''}
      ${mode === 'coordinates' ? `${input('x', 'X, metres east')}${input('y', 'Y, metres north')}${input('z', 'Z, metres above the source floor')}<label>Exact source floor ${selector('ovr-alert-floor', draft.floorId ?? draft.floor_id ?? '', this._floorChoices())}</label><p class="hint">${this._help('coordinatesHelp')}</p>` : ''}
      <div data-ovr-location-warning role="status">${this._locationEvaluation(true).diagnostics.map((issue) => `<p class="note warn">${esc(this._message(issue))}</p>`).join('')}</div></section>`;
  }

  updatePreviews(container) {
    if (!container) return;
    this._bindNative(container); this._pollIntents();
    for (const [name, html] of [['measure', this._measurementPreview()], ['alert', this._alertPreview()]]) {
      const target = container.querySelector(`[data-ovr-preview="${name}"]`);
      if (target && target.innerHTML !== html) target.innerHTML = html;
    }
    const updateText = (target, value) => { if (target && target.textContent !== value) target.textContent = value; };
    for (const row of container.querySelectorAll('[data-ovr-source]')) {
      const info = this._sourceInfo(row.dataset.ovrSource, this.config.mode);
      updateText(row.querySelector('[data-ovr-source-name]'), info.name);
      updateText(row.querySelector('[data-ovr-source-warning]'), info.warning);
      updateText(row.querySelector('[data-ovr-source-reading]'), info.reading);
      const remove = row.querySelector('[data-act="ovr-remove-source"]');
      const removeLabel = this._text('removeSource', { name: info.name });
      if (remove && remove.getAttribute('aria-label') !== removeLabel) remove.setAttribute('aria-label', removeLabel);
    }
    for (const row of container.querySelectorAll('[data-ovr-saved-alert]')) {
      const binding = this.alerts.find((alert) => alert.id === row.dataset.ovrSavedAlert);
      if (binding) {
        updateText(row.querySelector('[data-ovr-saved-alert-warning]'), this._sourceInfo(binding.entity, binding.type, true).warning);
        const name = binding.label || entityMetadata(this.hass, binding.entity).name || binding.id;
        updateText(row.querySelector('[data-ovr-saved-alert-name]'), name);
        const remove = row.querySelector('[data-act="ovr-delete-alert"]');
        if (remove && remove.getAttribute('aria-label') !== `Delete alert ${name}`) remove.setAttribute('aria-label', `Delete alert ${name}`);
      }
    }
    if (this.draftAlert) updateText(container.querySelector('[data-ovr-alert-warning]'), this.draftAlert.entity ? this._sourceInfo(this.draftAlert.entity, this.draftAlert.type, true).warning : '');
    const updateOptions = (field, choices, value) => {
      const select = container.querySelector(`[data-field="${field}"]`);
      if (!select) return;
      const selected = value ?? select.value, existing = new Map(), keep = new Set();
      // Retain each native option by raw value, including duplicate warning rows.
      for (const option of select.options) { const queue = existing.get(option.value) || []; queue.push(option); existing.set(option.value, queue); }
      choices.forEach(([id, label, selectable], index) => {
        const option = existing.get(id)?.shift() || select.ownerDocument.createElement('option');
        option.value = id; if (option.textContent !== label) option.textContent = label; option.disabled = selectable === false;
        if (select.options[index] !== option) select.insertBefore(option, select.options[index] || null); keep.add(option);
      });
      for (const option of [...select.options]) if (!keep.has(option)) option.remove();
      if (select.value !== selected) select.value = selected;
    };
    const add = container.querySelector('[data-field="ovr-add-source"]');
    updateOptions('ovr-add-source', this._addSourceChoices(add?.value));
    updateOptions('ovr-picker-area', this._areaChoices(), this.areaFilter);
    if (this.draftAlert) updateOptions('ovr-alert-entity', this._alertEntityChoices(), this.draftAlert.entity);
    if (this.draftAlert) {
      updateOptions('ovr-alert-room', this._roomChoices(), this.draftAlert.roomId ?? this.draftAlert.room_id ?? '');
      updateOptions('ovr-alert-position-key', this._anchorChoices(), this.draftAlert.position_key ?? this.draftAlert.markerId ?? '');
      updateOptions('ovr-alert-floor', this._floorChoices(), this.draftAlert.floorId ?? this.draftAlert.floor_id ?? '');
      const warning = container.querySelector('[data-ovr-location-warning]');
      const html = this._locationEvaluation(true).diagnostics.map((issue) => `<p class="note warn">${esc(this._message(issue))}</p>`).join('');
      if (warning && warning.innerHTML !== html) warning.innerHTML = html;
    }
    const allowed = this._canEdit(), sourceValid = !this._locationEdited || alertChoices(this.hass, this.draftAlert?.type).some((choice) => choice.value === this.draftAlert?.entity && choice.selectable);
    for (const control of container.querySelectorAll('[data-field^="ovr-"], [data-act^="ovr-"]')) {
      if (['ovr-picker-area', 'ovr-room', 'ovr-cancel-alert', 'ovr-edit-alert', 'ovr-ack-alert'].includes(control.dataset.field || control.dataset.act)) continue;
      if (!allowed) { if (!this._permissionDisabled.has(control)) this._permissionDisabled.set(control, control.disabled); control.disabled = true; }
      else if (this._permissionDisabled.has(control)) { control.disabled = this._permissionDisabled.get(control); this._permissionDisabled.delete(control); }
      if (control.dataset.act === 'ovr-save-alert') control.disabled = !allowed || !sourceValid;
    }
    updateEditorDetails(container, this.hass);
  }

  render() {
    this._bindNative(this.card._edit?.panel || this._nativeRoot);
    const cfg = this.config, mode = cfg.mode || 'off', room = this.room;
    const enabled = mode !== 'off', unit = cfg.unit || units[mode]?.[0];
    const base = { ...defaults(mode), ...displayRange(mode, unit) };
    const aggregation = this.binding.aggregation || (mode === 'temperature' ? 'mean' : 'sum');
    const row = (source) => {
      const entity = source.entity, attrs = this.hass.states?.[entity]?.attributes || {}, info = this._sourceInfo(entity, mode);
      const sourcePeriod = source.period || attrs.meter_period || attrs.period;
      return `<section class="box" data-ovr-source="${esc(entity)}"><div class="row"><strong data-ovr-source-name>${esc(info.name)}</strong>
        <button data-act="ovr-remove-source" data-id="${esc(entity)}" aria-label="${esc(this._text('removeSource', { name: info.name }))}">Remove</button></div>
        <p class="hint">Entity: <code>${esc(entity)}</code></p>
        <p class="note warn" data-ovr-source-warning role="status">${esc(info.warning)}</p>
        <p class="hint">Reported source: <span data-ovr-source-reading>${esc(info.reading)}</span></p>
        <label class="check"><input type="checkbox" data-field="ovr-source-enabled" data-id="${esc(entity)}" ${source.enabled !== false ? 'checked' : ''}> Include this reading</label>
        ${mode === 'energy' ? `<label>Period measured by this sensor ${periodSelector('ovr-source-period', sourcePeriod, `data-id="${esc(entity)}"`)}</label>` : ''}
        ${mode === 'power' || mode === 'energy' ? `<label>Shared circuit name (optional)<input data-field="ovr-source-group" data-id="${esc(entity)}" value="${esc(source.group || '')}" placeholder="e.g. downstairs circuit"></label>
          <label>Meter role ${selector('ovr-source-role', source.role || '', [['', 'One reading'], ['total', 'Whole circuit total'], ['part', 'Part of the circuit']], `data-id="${esc(entity)}"`)}</label>
          <label class="check"><input type="checkbox" data-field="ovr-source-independent" data-id="${esc(entity)}" ${source.independent ? 'checked' : ''}> Separate channel on this device</label>` : ''}</section>`;
    };
    const diagnostics = `<div data-ovr-preview="measure">${this._measurementPreview()}</div>`;
    return renderEditorDetails(`<div class="taylors3d-overlay-editor"><style>
      .taylors3d-overlay-editor button,.taylors3d-overlay-editor select,.taylors3d-overlay-editor input:not([type=checkbox]) { min-height:44px; box-sizing:border-box; }
      .taylors3d-overlay-editor .check { min-height:44px; display:flex; align-items:center; gap:8px; }
      .taylors3d-overlay-editor button,.taylors3d-overlay-editor select,.taylors3d-overlay-editor input { color:var(--primary-text-color,#222); background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#fff))); border-color:var(--divider-color,rgba(127,127,127,.4)); }
      .taylors3d-overlay-editor .row { flex-wrap:wrap; }
      .taylors3d-overlay-editor summary { min-height:44px; display:flex; align-items:center; }
      .taylors3d-overlay-editor [data-ovr-source-warning]:empty,.taylors3d-overlay-editor [data-ovr-alert-warning]:empty,.taylors3d-overlay-editor [data-ovr-saved-alert-warning]:empty { display:none; }
      .taylors3d-overlay-editor select,.taylors3d-overlay-editor input { max-width:100%; }
      .taylors3d-overlay-editor code { overflow-wrap:anywhere; }
    </style>
      ${this.message ? `<p class="note warn" role="alert">${esc(this._message(this.message))}</p>` : ''}
      <p class="hint">${this._help('intro')}</p>
      <label>Filter sensor choices by area ${selector('ovr-picker-area', this.areaFilter, this._areaChoices())}</label>
      <p class="hint">${this._help('filterHelp')}</p>
      <div class="sub">Room measurements</div>
      <label>Colour rooms by ${selector('ovr-mode', mode, [['off', 'Off'], ['temperature', 'Temperature'], ['power', 'Power now'], ['energy', 'Energy used']])}</label>
      ${enabled ? `<label>Display unit ${selector('ovr-unit', unit, (units[mode] || []).map((value) => [value, value]))}</label>
        ${mode === 'energy' ? `<label>Energy period ${periodSelector('ovr-period', cfg.period)}</label><p class="hint">${this._help('periodHelp')}</p>` : ''}
        <label>Colour scale ${selector('ovr-scale', cfg.scale || 'fixed', [['fixed', 'Fixed range'], ['auto', 'Fit current room readings']])}</label>
        ${cfg.scale === 'auto' ? '' : `<div class="row"><label>Minimum<input type="number" step="any" data-field="ovr-min" value="${esc(cfg.min ?? base.min)}"></label><label>Maximum<input type="number" step="any" data-field="ovr-max" value="${esc(cfg.max ?? base.max)}"></label></div>`}
        <label>Colours ${selector('ovr-palette', Array.isArray(cfg.palette) ? 'custom' : cfg.palette || base.palette, [...Object.keys(STATUS_PALETTES).map((value) => [value, value === 'usage' ? 'Usage' : value === 'violet' ? 'Violet' : 'Temperature']), ['custom', 'Choose your own colours']])}</label>
        ${Array.isArray(cfg.palette) ? `<p class="hint">${this._help('colourHelp')}</p>${cfg.palette.map((color, index) => `<div class="row"><label>${this._help('colour', { index: index + 1 })}<input type="color" data-field="ovr-palette-stop" data-index="${index}" value="${/^#[\da-f]{6}$/i.test(color) ? color : '#8d9199'}"></label><button data-act="ovr-remove-colour" data-index="${index}" ${cfg.palette.length <= 2 ? 'disabled' : ''}>${this._help('removeColour', { index: index + 1 })}</button></div>`).join('')}<button data-act="ovr-add-colour" ${cfg.palette.length >= 8 ? 'disabled' : ''}>Add colour</button>` : ''}
        ${room ? `<label>Room ${selector('ovr-room', room.room.id, this.rooms.map((entry) => [entry.room.id, entry.name]))}</label>
          <label>Combine room readings ${selector('ovr-aggregation', aggregation, mode === 'temperature' ? [['mean', 'Average temperature'], ['min', 'Lowest temperature'], ['max', 'Highest temperature'], ['median', 'Middle temperature']] : [['sum', 'Add separate loads'], ['mean', 'Average'], ['min', 'Lowest'], ['max', 'Highest']])}</label>
          ${mode !== 'temperature' ? `<label class="check"><input type="checkbox" data-field="ovr-independent-meters" ${this.binding.independent_meters ? 'checked' : ''}> These sensors measure separate loads</label><p class="hint">${this._help('circuitHelp')}</p>` : ''}
          ${this.sources.map(row).join('')}<label>Add a ${mode} sensor ${selector('ovr-add-source', '', this._addSourceChoices())}</label>${diagnostics}`
    : `<p class="note warn">${this._help('drawRooms')}</p>`}` : ''}
      <div class="sub">Location alerts</div><p class="hint">${this._help('locationHelp')}</p>
      ${this._alertsHtml()}
    </div>`, this.hass);
  }

  _alertsHtml() {
    const draft = this.draftAlert;
    const alerts = Array.isArray(this.alerts) ? this.alerts : [];
    const list = alerts.map((binding) => `<div data-ovr-saved-alert="${esc(binding.id)}"><div class="row"><button data-act="ovr-edit-alert" data-id="${esc(binding.id)}" data-ovr-saved-alert-name>${esc(binding.label || entityMetadata(this.hass, binding.entity).name || binding.id)}</button>
      <button data-act="ovr-delete-alert" data-id="${esc(binding.id)}" aria-label="Delete alert ${esc(binding.label || binding.entity || binding.id)}">Delete</button>
      ${this.card._alertLatches?.[binding.id] ? `<button data-act="ovr-ack-alert" data-id="${esc(binding.id)}">Acknowledge</button>` : ''}</div>
      <p class="hint">Entity: <code>${esc(binding.entity)}</code></p>
      <p class="note warn" data-ovr-saved-alert-warning role="status">${esc(this._sourceInfo(binding.entity, binding.type, true).warning)}</p></div>`).join('');
    if (!draft) return `${list}<button data-act="ovr-add-alert" ${this._canAddAlert() ? '' : 'disabled'}>Add an alert</button>`;
    const chips = (field, values) => (values || []).map((value) => `<button data-act="ovr-remove-${field}" data-state="${esc(value)}" aria-label="Remove ${esc(value)} ${field} state">${esc(value)} ×</button>`).join('');
    return `${list}<section class="box"><h3>${alerts.some((alert) => alert.id === draft.id) ? 'Edit alert' : 'New alert'}</h3>
      <label>Alert type ${selector('ovr-alert-type', draft.type, [['smoke', 'Smoke detected'], ['leak', 'Leak detected'], ['unlocked', 'Door unlocked'], ['custom', 'Custom sensor state']])}</label>
      <label>Sensor ${selector('ovr-alert-entity', draft.entity, this._alertEntityChoices())}</label>
      <p class="note warn" data-ovr-alert-warning role="status">${esc(draft.entity ? this._sourceInfo(draft.entity, draft.type, true).warning : '')}</p>
      ${this._locationHtml()}
      <label>Label (optional)<input data-field="ovr-alert-label" value="${esc(draft.label || '')}"></label>
      <label class="check"><input type="checkbox" data-field="ovr-alert-enabled" ${draft.enabled !== false ? 'checked' : ''}> Show this alert</label>
      <label>Clearing rule ${selector('ovr-alert-rule', draft.clear_rule || 'state', [['state', 'Follow confirmed sensor state'], ['latched', 'Keep until acknowledged']])}</label>
      ${draft.type === 'custom' ? `<label>Add a trigger state<input data-field="ovr-alert-trigger" placeholder="e.g. warning"></label><div class="row">${chips('trigger', draft.trigger_states)}</div>
        <label>Add a clear state (optional)<input data-field="ovr-alert-clear" placeholder="e.g. normal"></label><div class="row">${chips('clear', draft.clear_states)}</div>` : ''}
      <p class="hint">${esc(this._text(draft.type === 'custom' ? 'customTrigger' : draft.type === 'unlocked' ? 'lockTrigger' : 'binaryTrigger'))} ${esc(this._text('noConfirmedClear'))}</p>
      ${draft.clear_rule === 'latched' ? `<p class="hint">${this._help('latchedHelp')}</p>` : ''}
      <div data-ovr-preview="alert">${this._alertPreview()}</div>
      <div class="row"><button data-act="ovr-save-alert">Save alert</button><button data-act="ovr-cancel-alert">Cancel</button></div></section>`;
  }

  onChange(field, element) {
    if (!field?.startsWith('ovr-')) return false;
    if (!['ovr-picker-area', 'ovr-room'].includes(field) && !this._canEdit()) return true;
    const value = element.value, entity = element.dataset.id, cfg = this.config, mode = cfg.mode || 'off';
    if (field === 'ovr-picker-area') {
      if (!this._areaChoices().some(([id, _label, selectable]) => id === value && selectable !== false)) this._error('Choose a current area, All areas or Unassigned.');
      else { this.areaFilter = value; this.message = null; this.onRender(); }
    }
    else if (field === 'ovr-room') { this.roomId = value; this.message = null; this.onRender(); }
    else if (field === 'ovr-mode') this._config(value === 'off' ? { mode: value } : { mode: value, ...defaults(value), scale: 'fixed' });
    else if (field === 'ovr-unit') {
      if (!units[mode]?.includes(value)) this._error('Choose a supported display unit.');
      else this._config({ unit: value, min: convert(cfg.min ?? displayRange(mode, cfg.unit).min, mode, cfg.unit || defaults(mode).unit, value), max: convert(cfg.max ?? displayRange(mode, cfg.unit).max, mode, cfg.unit || defaults(mode).unit, value) });
    } else if (field === 'ovr-min' || field === 'ovr-max') {
      const number = value.trim() ? Number(value) : NaN;
      const min = field === 'ovr-min' ? number : cfg.min ?? displayRange(mode, cfg.unit).min;
      const max = field === 'ovr-max' ? number : cfg.max ?? displayRange(mode, cfg.unit).max;
      if (!Number.isFinite(number) || max <= min) this._error('Choose a finite minimum and a maximum greater than the minimum.');
      else this._config({ [field.slice(4)]: number });
    } else if (field === 'ovr-period') this._config({ period: measurementPeriod(value) || '' });
    else if (field === 'ovr-scale') this._config({ scale: value });
    else if (field === 'ovr-palette') {
      if (Object.hasOwn(STATUS_PALETTES, value)) this._config({ palette: value });
      else if (value === 'custom') this._config({ palette: [...STATUS_PALETTES[mode === 'temperature' ? 'temperature' : 'usage']] });
    } else if (field === 'ovr-palette-stop') {
      const index = Number(element.dataset.index);
      if (Array.isArray(cfg.palette) && Number.isInteger(index) && index >= 0 && index < cfg.palette.length && /^#[\da-f]{6}$/i.test(value)) this._config({ palette: cfg.palette.map((color, i) => i === index ? value : color) });
    }
    else if (field === 'ovr-aggregation') this._binding({ aggregation: value });
    else if (field === 'ovr-independent-meters') this._binding({ independent_meters: element.checked });
    else if (field === 'ovr-add-source') {
      if (!measurementSensors(this.hass, mode, this.pickerFilter).some(([entity, _label, selectable]) => entity === value && selectable)) this._error('Choose a current eligible sensor for this measurement.');
      else if (this.sources.some((source) => source.entity === value)) this._error('This sensor is already selected for this room.');
      else this._binding({ entities: [...this.sources, { entity: value }] });
    } else if (field === 'ovr-source-period') this._source(entity, { period: measurementPeriod(value) || '' });
    else if (field === 'ovr-source-group') this._source(entity, { group: value.trim() });
    else if (field === 'ovr-source-role') this._source(entity, { role: value || undefined });
    else if (field === 'ovr-source-independent') this._source(entity, { independent: element.checked });
    else if (field === 'ovr-source-enabled') this._source(entity, { enabled: element.checked });
    else if (field.startsWith('ovr-alert-') && this.draftAlert) {
      const draft = this.draftAlert;
      if (field === 'ovr-alert-type') {
        draft.type = value; draft.entity = ''; draft.clear_rule = 'state'; delete draft.trigger_states; delete draft.clear_states;
        if (value === 'custom') draft.trigger_states = [];
      } else if (field === 'ovr-alert-entity') draft.entity = value;
      else if (field === 'ovr-alert-location') { if (['room', 'marker', 'coordinates'].includes(value)) this._setLocation(value); }
      else if (field === 'ovr-alert-room') { this._setLocation('room'); draft.roomId = value; }
      else if (field === 'ovr-alert-position-key') { if (draft.location_mode !== 'marker') this._setLocation('marker'); draft.position_key = value; delete draft.markerId; this._locationEdited = true; }
      else if (field === 'ovr-alert-floor') { delete draft.floorId; if (value === '' && this._locationMode() === 'marker') delete draft.floor_id; else draft.floor_id = value; draft.location_mode = this._locationMode(); this._locationEdited = true; }
      else if (['ovr-alert-x', 'ovr-alert-y', 'ovr-alert-z'].includes(field)) {
        draft[field.slice(-1)] = value; draft.location_mode = 'coordinates'; this._locationEdited = true;
        // A dirty field changes while the browser transfers focus to its next
        // target. Keep that target connected throughout the native gesture.
        this.message = null;
        this._nativeRoot?.querySelector('.taylors3d-overlay-editor > p[role="alert"]')?.remove();
        this.updatePreviews(this._nativeRoot);
        return true;
      }
      else if (field === 'ovr-alert-label') draft.label = value.trim();
      else if (field === 'ovr-alert-enabled') draft.enabled = element.checked;
      else if (field === 'ovr-alert-rule') draft.clear_rule = value;
      else if ((field === 'ovr-alert-trigger' || field === 'ovr-alert-clear') && value.trim()) {
        const key = field.endsWith('trigger') ? 'trigger_states' : 'clear_states';
        draft[key] = [...new Set([...(draft[key] || []), value.trim()])];
      }
      this.message = null; this.onRender();
    }
    return true;
  }

  onClick(action, button) {
    if (!action?.startsWith('ovr-')) return false;
    if (!['ovr-edit-alert', 'ovr-cancel-alert', 'ovr-ack-alert'].includes(action) && !this._canEdit()) { this._error('Only a current administrator can save overlay settings.'); return true; }
    const id = button.dataset.id;
    if (action === 'ovr-add-colour' && Array.isArray(this.config.palette) && this.config.palette.length < 8) this._config({ palette: [...this.config.palette, this.config.palette.at(-1)] });
    else if (action === 'ovr-remove-colour' && Array.isArray(this.config.palette) && this.config.palette.length > 2) this._config({ palette: this.config.palette.filter((_, index) => index !== Number(button.dataset.index)) });
    else if (action === 'ovr-remove-source') this._binding({ entities: this.sources.filter((source) => source.entity !== id) });
    else if (action === 'ovr-add-alert') {
      if (!this._canAddAlert()) { this._error('Link a valid floor or room before adding an alert.'); return true; }
      let n = 1; while (this.alerts.some((alert) => alert.id === `alert_${n}`)) n++;
      this._savedAlertLink = null;
      this._locationEdited = false; this._savedLocation = null;
      this.draftAlert = { id: `alert_${n}`, entity: '', type: 'smoke', ...(this.room ? { roomId: this.room.room.id } : {}), clear_rule: 'state' }; this.message = null; this.onRender();
    } else if (action === 'ovr-edit-alert') {
      const row = this._alertRows().find((entry) => entry.binding.id === id), binding = row?.binding;
      if (binding) {
        this._savedAlertLink = { id: binding.id, entity: binding.entity, type: binding.type, raw: copy(row.raw), rawKey: JSON.stringify(row.raw) };
        this.draftAlert = copy(binding); this._locationEdited = false; this._savedLocation = locationValue(binding);
      }
      this.onRender();
    }
    else if (action === 'ovr-ack-alert') { this.card.acknowledgeAlert?.(id); this.onRender(); }
    else if (action === 'ovr-delete-alert') {
      const rows = this._alertRows().filter((entry) => entry.binding.id === id);
      if (rows.length !== 1) { this._error('This saved alert ID is missing or ambiguous. Repair it deliberately before removing it.'); return true; }
      if (this.draftAlert?.id === id) { this.draftAlert = null; this._savedAlertLink = null; }
      this._commit({ alert_bindings: this._rawAlerts().filter((_entry, index) => index !== rows[0].index) });
    }
    else if (action === 'ovr-cancel-alert') { this.draftAlert = null; this._savedAlertLink = null; this._locationEdited = false; this._savedLocation = null; this.message = null; this.onRender(); }
    else if ((action === 'ovr-remove-trigger' || action === 'ovr-remove-clear') && this.draftAlert) {
      const key = action.endsWith('trigger') ? 'trigger_states' : 'clear_states';
      const states = (this.draftAlert[key] || []).filter((state) => state !== button.dataset.state);
      if (!states.length && key === 'clear_states') delete this.draftAlert[key]; else this.draftAlert[key] = states;
      this.onRender();
    } else if (action === 'ovr-save-alert' && this.draftAlert) {
      this._pollIntents();
      const intent = this._intents.get(button);
      if (intent?.poisoned) { this._error('This Save press belongs to an earlier source or permission context. Review the draft and press Save again deliberately.'); return true; }
      const draft = this._rawAlert();
      const original = this._savedAlertLink;
      const currentRows = this._alertRows().filter((entry) => entry.binding.id === original?.id), currentRow = currentRows.length === 1 ? currentRows[0] : null;
      const current = currentRow?.binding;
      const retained = original && current && current.entity === original.entity && current.type === original.type
        && draft.entity === original.entity && draft.type === original.type;
      const preserveLocation = retained && !this._locationEdited && this._savedLocation === locationValue(current) && this._savedLocation === locationValue(draft);
      const location = this._locationEvaluation();
      if ((!retained || this._locationEdited) && !alertSensors(this.hass, draft.type, this._locationEdited && retained ? {} : this.pickerFilter).some(([entity, _label, selectable]) => entity === draft.entity && selectable)) this._error('Choose a current eligible entity for this alert type.');
      else if (original && (!currentRow || original.rawKey !== JSON.stringify(currentRow.raw))) this._error('This saved alert changed or was removed while the draft was open. Cancel and reopen its current settings before saving.');
      else if (alertState({ ...draft, enabled: true }, this.hass.states?.[draft.entity]).status === 'invalid') this._error('Choose at least one trigger state for a custom alert.');
      else if (!preserveLocation && !location.location) this._error(location.diagnostics[0]?.message || 'Choose a room with a valid outline and linked floor.');
      else if ((draft.clear_states || []).some((clear) => (draft.trigger_states || []).some((trigger) => clear.toLowerCase() === trigger.toLowerCase()))) this._error('A state cannot both trigger and clear the same alert.');
      else {
        const binding = copy(draft);
        if (original && binding.entity === original.raw.entity) {
          if (Object.hasOwn(original.raw, 'id')) binding.id = original.raw.id; else delete binding.id;
        }
        const bindings = currentRow ? this._rawAlerts().map((entry, index) => index === currentRow.index ? binding : entry) : [...this._rawAlerts(), binding];
        this.draftAlert = null; this._savedAlertLink = null;
        this._commit({ alert_bindings: bindings });
      }
    }
    return true;
  }
}
