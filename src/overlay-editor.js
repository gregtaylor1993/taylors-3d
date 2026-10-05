// Visual room measurements and alert bindings. Saving changes configuration, never device state.
import { aggregateMeasurements, alertState, buildAlerts, measurementPeriod, STATUS_PALETTES } from './status-overlays.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const copy = (value) => JSON.parse(JSON.stringify(value));
const periods = [['hour', 'This hour'], ['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['lifetime', 'Lifetime total']];
const units = { temperature: ['°C', '°F', 'K'], power: ['W', 'kW'], energy: ['kWh', 'Wh'] };
const option = (value, label, selected) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
const selector = (field, value, choices, attrs = '') => `<select data-field="${field}" ${attrs}>${choices.map(([id, label]) => option(id, label, value)).join('')}</select>`;
const periodSelector = (field, value, attrs = '') => selector(field, measurementPeriod(value) || '', [['', 'Choose the measured period'], ...periods], attrs);
const roomName = (entry, hass) => entry.name || entry.room?.name || entry.room?.label || hass.areas?.[entry.room?.area_id]?.name || entry.room?.id;

export function measurementSensors(hass = {}, mode) {
  const allowed = units[mode] || [];
  return Object.entries(hass.states || {}).filter(([entity, state]) => {
    const registration = hass.entities?.[entity];
    return entity.startsWith('sensor.') && !registration?.hidden && !registration?.entity_category
      && (allowed.includes(state.attributes?.unit_of_measurement) || state.attributes?.device_class === mode);
  }).map(([entity, state]) => [entity, state.attributes?.friendly_name || entity]).sort((a, b) => a[1].localeCompare(b[1]));
}

export function alertSensors(hass = {}, type) {
  return Object.entries(hass.states || {}).filter(([entity, state]) => {
    const registration = hass.entities?.[entity];
    if (registration?.hidden || registration?.entity_category) return false;
    if (type === 'unlocked') return entity.startsWith('lock.');
    if (type === 'smoke' || type === 'leak') return entity.startsWith('binary_sensor.') && state.attributes?.device_class === (type === 'leak' ? 'moisture' : 'smoke');
    return ['sensor', 'binary_sensor', 'lock', 'alarm_control_panel', 'input_boolean'].includes(entity.split('.')[0]);
  }).map(([entity, state]) => [entity, state.attributes?.friendly_name || entity]).sort((a, b) => a[1].localeCompare(b[1]));
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
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.roomId = null; this.draftAlert = null; this.message = null;
  }
  reset() { this.roomId = null; this.draftAlert = null; this.message = null; }
  get hass() { return this.card._hass || {}; }
  get rooms() { return (this.card._roomList || []).filter((entry) => entry.room?.id).map((entry) => ({ ...entry, name: roomName(entry, this.hass) })); }
  get config() {
    const value = this.card._layout?.room_overlays ?? this.card._config?.room_overlays;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { mode: 'off', bindings: {} };
  }
  get alerts() {
    const value = this.card._layout?.alert_bindings ?? this.card._config?.alert_bindings;
    return (Array.isArray(value) ? value : []).filter((binding) => binding && typeof binding === 'object')
      .map((binding, index) => ({ ...binding, id: binding.id || binding.entity || `imported_alert_${index + 1}` }));
  }
  get room() { return this.rooms.find((room) => room.room.id === this.roomId) || this.rooms[0]; }
  get binding() { return this.config.bindings?.[this.room?.room.id] || {}; }
  get sources() {
    const value = Array.isArray(this.binding) ? this.binding : this.binding.entities;
    return (Array.isArray(value) ? value : []).filter((source) => typeof source === 'string' || source && typeof source === 'object' && typeof source.entity === 'string')
      .map((source) => typeof source === 'string' ? { entity: source } : source);
  }

  _commit(patch) {
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
    const metric = aggregateMeasurements(this.binding, this.hass.states, this.hass.entities, { mode, unit: cfg.unit || units[mode]?.[0], period: cfg.period });
    return `<section class="box" aria-live="polite"><h3>Reading preview</h3><p>${esc(metric.value === null ? 'No valid reading' : `${Number(metric.value.toFixed(2))} ${metric.unit}`)} · ${esc(metric.status)}</p>
      <p class="hint">${metric.valid} of ${metric.requested} selected readings available.</p>${metric.diagnostics.length ? `<ul>${metric.diagnostics.map((issue) => `<li>${esc(issue.message)}${issue.entity ? ` (${esc(issue.entity)})` : ''}${issue.choices?.length ? `: ${issue.choices.map(esc).join(', ')}` : ''}</li>`).join('')}</ul>` : ''}</section>`;
  }

  _alertPreview() {
    const draft = this.draftAlert;
    if (!draft) return '';
    const result = alertState(draft, this.hass.states?.[draft.entity], { latched: !!this.card._alertLatches?.[draft.id] });
    const preview = buildAlerts({ bindings: [draft], states: this.hass.states, rooms: this.card._roomList || [], floors: this.card._floors || [], previousLatches: this.card._alertLatches });
    return `<p role="status">Preview: ${esc(result.message)}${this.hass.states?.[draft.entity] ? ` (sensor: ${esc(this.hass.states[draft.entity].state)})` : ''}</p>
      ${(preview.alerts[0]?.diagnostics || []).map((issue) => `<p class="note warn">${esc(issue.message)}</p>`).join('')}`;
  }

  updatePreviews(container) {
    for (const [name, html] of [['measure', this._measurementPreview()], ['alert', this._alertPreview()]]) {
      const target = container.querySelector(`[data-ovr-preview="${name}"]`);
      if (target && target.innerHTML !== html) target.innerHTML = html;
    }
  }

  render() {
    const cfg = this.config, mode = cfg.mode || 'off', room = this.room;
    const enabled = mode !== 'off', unit = cfg.unit || units[mode]?.[0];
    const base = { ...defaults(mode), ...displayRange(mode, unit) };
    const choices = measurementSensors(this.hass, mode);
    const aggregation = this.binding.aggregation || (mode === 'temperature' ? 'mean' : 'sum');
    const row = (source) => {
      const entity = source.entity, attrs = this.hass.states?.[entity]?.attributes || {};
      const sourcePeriod = source.period || attrs.meter_period || attrs.period;
      return `<section class="box"><div class="row"><strong>${esc(attrs.friendly_name || entity)}</strong>
        <button data-act="ovr-remove-source" data-id="${esc(entity)}" aria-label="Remove ${esc(attrs.friendly_name || entity)}">Remove</button></div>
        <label class="check"><input type="checkbox" data-field="ovr-source-enabled" data-id="${esc(entity)}" ${source.enabled !== false ? 'checked' : ''}> Include this reading</label>
        ${mode === 'energy' ? `<label>Period measured by this sensor ${periodSelector('ovr-source-period', sourcePeriod, `data-id="${esc(entity)}"`)}</label>` : ''}
        ${mode === 'power' || mode === 'energy' ? `<label>Shared circuit name (optional)<input data-field="ovr-source-group" data-id="${esc(entity)}" value="${esc(source.group || '')}" placeholder="e.g. downstairs circuit"></label>
          <label>Meter role ${selector('ovr-source-role', source.role || '', [['', 'One reading'], ['total', 'Whole circuit total'], ['part', 'Part of the circuit']], `data-id="${esc(entity)}"`)}</label>
          <label class="check"><input type="checkbox" data-field="ovr-source-independent" data-id="${esc(entity)}" ${source.independent ? 'checked' : ''}> Separate channel on this device</label>` : ''}</section>`;
    };
    const diagnostics = `<div data-ovr-preview="measure">${this._measurementPreview()}</div>`;
    return `<div class="taylors3d-overlay-editor"><style>
      .taylors3d-overlay-editor button,.taylors3d-overlay-editor select,.taylors3d-overlay-editor input:not([type=checkbox]) { min-height:44px; box-sizing:border-box; }
      .taylors3d-overlay-editor .check { min-height:44px; display:flex; align-items:center; gap:8px; }
      .taylors3d-overlay-editor button,.taylors3d-overlay-editor select,.taylors3d-overlay-editor input { color:var(--primary-text-color,#222); background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#fff))); border-color:var(--divider-color,rgba(127,127,127,.4)); }
      .taylors3d-overlay-editor .row { flex-wrap:wrap; }
      .taylors3d-overlay-editor summary { min-height:44px; display:flex; align-items:center; }
    </style>
      ${this.message ? `<p class="note warn" role="alert">${esc(this.message)}</p>` : ''}
      <p class="hint">Saved visual overlay settings are used for this shared layout. These views display sensor readings; they do not control your devices.</p>
      <div class="sub">Room measurements</div>
      <label>Colour rooms by ${selector('ovr-mode', mode, [['off', 'Off'], ['temperature', 'Temperature'], ['power', 'Power now'], ['energy', 'Energy used']])}</label>
      ${enabled ? `<label>Display unit ${selector('ovr-unit', unit, (units[mode] || []).map((value) => [value, value]))}</label>
        ${mode === 'energy' ? `<label>Energy period ${periodSelector('ovr-period', cfg.period)}</label><p class="hint">Choose what each meter measures. A lifetime total is not today's usage.</p>` : ''}
        <label>Colour scale ${selector('ovr-scale', cfg.scale || 'fixed', [['fixed', 'Fixed range'], ['auto', 'Fit current room readings']])}</label>
        ${cfg.scale === 'auto' ? '' : `<div class="row"><label>Minimum<input type="number" step="any" data-field="ovr-min" value="${esc(cfg.min ?? base.min)}"></label><label>Maximum<input type="number" step="any" data-field="ovr-max" value="${esc(cfg.max ?? base.max)}"></label></div>`}
        <label>Colours ${selector('ovr-palette', Array.isArray(cfg.palette) ? 'custom' : cfg.palette || base.palette, [...Object.keys(STATUS_PALETTES).map((value) => [value, value === 'usage' ? 'Usage' : value === 'violet' ? 'Violet' : 'Temperature']), ['custom', 'Choose your own colours']])}</label>
        ${Array.isArray(cfg.palette) ? `<p class="hint">Colours run from the minimum to the maximum, in this order.</p>${cfg.palette.map((color, index) => `<div class="row"><label>Colour ${index + 1}<input type="color" data-field="ovr-palette-stop" data-index="${index}" value="${/^#[\da-f]{6}$/i.test(color) ? color : '#8d9199'}"></label><button data-act="ovr-remove-colour" data-index="${index}" ${cfg.palette.length <= 2 ? 'disabled' : ''}>Remove colour ${index + 1}</button></div>`).join('')}<button data-act="ovr-add-colour" ${cfg.palette.length >= 8 ? 'disabled' : ''}>Add colour</button>` : ''}
        ${room ? `<label>Room ${selector('ovr-room', room.room.id, this.rooms.map((entry) => [entry.room.id, entry.name]))}</label>
          <label>Combine room readings ${selector('ovr-aggregation', aggregation, mode === 'temperature' ? [['mean', 'Average temperature'], ['min', 'Lowest temperature'], ['max', 'Highest temperature'], ['median', 'Middle temperature']] : [['sum', 'Add separate loads'], ['mean', 'Average'], ['min', 'Lowest'], ['max', 'Highest']])}</label>
          ${mode !== 'temperature' ? `<label class="check"><input type="checkbox" data-field="ovr-independent-meters" ${this.binding.independent_meters ? 'checked' : ''}> These sensors measure separate loads</label><p class="hint">Avoid choosing both a circuit total and its component meters. Use a shared circuit name and Total / Part roles for overlapping meters.</p>` : ''}
          ${this.sources.map(row).join('')}<label>Add a ${mode} sensor ${selector('ovr-add-source', '', [['', 'Choose a sensor'], ...choices.filter(([entity]) => !this.sources.some((source) => source.entity === entity))])}</label>${diagnostics}`
    : '<p class="note warn">Draw or link rooms first, so sensor readings have somewhere to appear.</p>'}` : ''}
      <div class="sub">Location alerts</div><p class="hint">Smoke, leaks and unlocked doors appear at their sensor location or the chosen room's centre. Unknown or unavailable readings remain labelled.</p>
      ${this._alertsHtml()}
    </div>`;
  }

  _alertsHtml() {
    const draft = this.draftAlert;
    const alerts = Array.isArray(this.alerts) ? this.alerts : [];
    const list = alerts.map((binding) => `<div class="row"><button data-act="ovr-edit-alert" data-id="${esc(binding.id)}">${esc(binding.label || this.hass.states?.[binding.entity]?.attributes?.friendly_name || binding.entity || binding.id)}</button>
      <button data-act="ovr-delete-alert" data-id="${esc(binding.id)}" aria-label="Delete alert ${esc(binding.label || binding.entity || binding.id)}">Delete</button>
      ${this.card._alertLatches?.[binding.id] ? `<button data-act="ovr-ack-alert" data-id="${esc(binding.id)}">Acknowledge</button>` : ''}</div>`).join('');
    if (!draft) return `${list}<button data-act="ovr-add-alert" ${this.rooms.length ? '' : 'disabled'}>Add an alert</button>`;
    const entities = alertSensors(this.hass, draft.type);
    if (draft.entity && !entities.some(([entity]) => entity === draft.entity)) entities.push([draft.entity, draft.entity + ' (check sensor choice)']);
    const chips = (field, values) => (values || []).map((value) => `<button data-act="ovr-remove-${field}" data-state="${esc(value)}" aria-label="Remove ${esc(value)} ${field} state">${esc(value)} ×</button>`).join('');
    return `${list}<section class="box"><h3>${alerts.some((alert) => alert.id === draft.id) ? 'Edit alert' : 'New alert'}</h3>
      <label>Alert type ${selector('ovr-alert-type', draft.type, [['smoke', 'Smoke detected'], ['leak', 'Leak detected'], ['unlocked', 'Door unlocked'], ['custom', 'Custom sensor state']])}</label>
      <label>Sensor ${selector('ovr-alert-entity', draft.entity, [['', 'Choose a sensor'], ...entities])}</label>
      <label>Room ${selector('ovr-alert-room', draft.roomId, this.rooms.map((entry) => [entry.room.id, entry.name]))}</label>
      <label>Label (optional)<input data-field="ovr-alert-label" value="${esc(draft.label || '')}"></label>
      <label class="check"><input type="checkbox" data-field="ovr-alert-enabled" ${draft.enabled !== false ? 'checked' : ''}> Show this alert</label>
      <label>Clearing rule ${selector('ovr-alert-rule', draft.clear_rule || 'state', [['state', 'Follow confirmed sensor state'], ['latched', 'Keep until acknowledged']])}</label>
      ${draft.type === 'custom' ? `<label>Add a trigger state<input data-field="ovr-alert-trigger" placeholder="e.g. warning"></label><div class="row">${chips('trigger', draft.trigger_states)}</div>
        <label>Add a clear state (optional)<input data-field="ovr-alert-clear" placeholder="e.g. normal"></label><div class="row">${chips('clear', draft.clear_states)}</div>` : ''}
      <p class="hint">${draft.type === 'custom' ? 'Triggers when the sensor reports a chosen trigger state. With no clear states chosen, it clears when the state leaves those triggers.' : draft.type === 'unlocked' ? 'Triggers when unlocked. Clears only when the lock reports locked.' : 'Triggers when the sensor reports on. Clears when it reports off.'} Missing or unavailable readings do not claim a confirmed clear state.</p>
      ${draft.clear_rule === 'latched' ? '<p class="hint">Keep this alert until acknowledged in this browser session, after its sensor stops triggering. Reloading starts fresh. An active trigger remains visible.</p>' : ''}
      <div data-ovr-preview="alert">${this._alertPreview()}</div>
      <div class="row"><button data-act="ovr-save-alert">Save alert</button><button data-act="ovr-cancel-alert">Cancel</button></div></section>`;
  }

  onChange(field, element) {
    if (!field?.startsWith('ovr-')) return false;
    const value = element.value, entity = element.dataset.id, cfg = this.config, mode = cfg.mode || 'off';
    if (field === 'ovr-room') { this.roomId = value; this.message = null; this.onRender(); }
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
      if (!measurementSensors(this.hass, mode).some(([entity]) => entity === value)) this._error('Choose a sensor for this measurement.');
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
      else if (field === 'ovr-alert-room') draft.roomId = value;
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
    const id = button.dataset.id;
    if (action === 'ovr-add-colour' && Array.isArray(this.config.palette) && this.config.palette.length < 8) this._config({ palette: [...this.config.palette, this.config.palette.at(-1)] });
    else if (action === 'ovr-remove-colour' && Array.isArray(this.config.palette) && this.config.palette.length > 2) this._config({ palette: this.config.palette.filter((_, index) => index !== Number(button.dataset.index)) });
    else if (action === 'ovr-remove-source') this._binding({ entities: this.sources.filter((source) => source.entity !== id) });
    else if (action === 'ovr-add-alert') {
      if (!this.room) { this._error('Draw or link a room before adding an alert.'); return true; }
      let n = 1; while (this.alerts.some((alert) => alert.id === `alert_${n}`)) n++;
      this.draftAlert = { id: `alert_${n}`, entity: '', type: 'smoke', roomId: this.room.room.id, clear_rule: 'state' }; this.message = null; this.onRender();
    } else if (action === 'ovr-edit-alert') { const binding = this.alerts.find((alert) => alert.id === id); if (binding) this.draftAlert = { ...copy(binding), roomId: binding.roomId || binding.room_id || this.room?.room.id }; this.onRender(); }
    else if (action === 'ovr-ack-alert') { this.card.acknowledgeAlert?.(id); this.onRender(); }
    else if (action === 'ovr-delete-alert') { if (this.draftAlert?.id === id) this.draftAlert = null; this._commit({ alert_bindings: this.alerts.filter((alert) => alert.id !== id) }); }
    else if (action === 'ovr-cancel-alert') { this.draftAlert = null; this.message = null; this.onRender(); }
    else if ((action === 'ovr-remove-trigger' || action === 'ovr-remove-clear') && this.draftAlert) {
      const key = action.endsWith('trigger') ? 'trigger_states' : 'clear_states';
      const states = (this.draftAlert[key] || []).filter((state) => state !== button.dataset.state);
      if (!states.length && key === 'clear_states') delete this.draftAlert[key]; else this.draftAlert[key] = states;
      this.onRender();
    } else if (action === 'ovr-save-alert' && this.draftAlert) {
      const draft = this.draftAlert;
      if (!this.rooms.some((room) => room.room.id === draft.roomId)) this._error('Choose a room with an outline.');
      else if (!alertSensors(this.hass, draft.type).some(([entity]) => entity === draft.entity)) this._error('Choose an available entity for this alert type.');
      else if (alertState({ ...draft, enabled: true }, this.hass.states?.[draft.entity]).status === 'invalid') this._error('Choose at least one trigger state for a custom alert.');
      else if (!buildAlerts({ bindings: [{ ...draft, enabled: true }], states: this.hass.states, rooms: this.card._roomList || [], floors: this.card._floors || [] }).alerts[0]?.location) this._error('Choose a room with a valid outline and linked floor.');
      else if ((draft.clear_states || []).some((clear) => (draft.trigger_states || []).some((trigger) => clear.toLowerCase() === trigger.toLowerCase()))) this._error('A state cannot both trigger and clear the same alert.');
      else {
        const binding = copy(draft); this.draftAlert = null;
        this._commit({ alert_bindings: [...this.alerts.filter((alert) => alert.id !== binding.id), binding] });
      }
    }
    return true;
  }
}
