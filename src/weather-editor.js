// Environment drafts change layout configuration only. No weather animation,
// service call, preview renderer or storage write occurs before an explicit Save.
import { entityChoices, entityMetadata } from './entity-metadata.js';
import { readWeather, readSunState, readHaLocation, normaliseWeatherFootprints } from './weather.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = (value) => JSON.parse(JSON.stringify(value));
const qualities = [['off', 'Off'], ['static', 'Static — no animation'], ['low', 'Low — wall panel'], ['medium', 'Medium']];
const effects = [['rain', 'Rain'], ['clouds', 'Clouds'], ['snow', 'Snow']];
const defaults = () => ({ enabled: false, entity: '', effects: effects.map(([id]) => id), intensity: 0.6, quality: 'low' });
const prefix = 'env-weather-';
const button = (action, label, attributes = '') => `<button type="button" data-act="${prefix}${action}" ${attributes}>${esc(label)}</button>`;
const numeric = (value) => typeof value === 'string' ? value.trim() === '' ? NaN : Number(value) : value;

/** Parent contract: render/onClick/onChange/onInput/updatePreviews/reset/cancel/dispose.
 * Save uses commitFeatureLayout({weather: object}), with layout.weather ?? config.weather.
 * Optional weatherFootprints() supplies {outdoors,indoors,visibleFloors}; otherwise use
 * actual room outlines and known floors. Root keeps this fragment in Edit → Environment,
 * preserves focused env-weather-* controls during HA updates, and resets after Undo/context changes.
 */
export class WeatherEditor {
  constructor(card, onRender = () => {}) {
    this.card = card;
    this.onRender = onRender;
    this.draft = null;
    this.intensityEdited = false;
    this.dirty = false;
    this.message = null;
    this.relinking = false;
    this.disposed = false;
  }

  get hass() { return this.card._hass || {}; }
  get effective() { return this.card._layout?.weather ?? this.card._config?.weather ?? {}; }
  get sourceChoices() {
    const selected = typeof this.draft?.entity === 'string' && this.draft.entity ? this.draft.entity : [];
    return entityChoices(this.hass, { domains: ['weather'], selected });
  }
  _load() {
    const source = this.effective;
    this.badImported = !plain(source);
    this.draft = { ...defaults(), ...(plain(source) ? copy(source) : {}) };
    this.intensityEdited = false;
    this.baseValue = JSON.stringify(source);
    this.baseLayoutKey = this.card._config?.layout_key;
    this.dirty = false;
    this.relinking = false;
    this.message = null;
  }
  _ensure() {
    if (!this.draft || !this.dirty && JSON.stringify(this.effective) !== this.baseValue) this._load();
  }
  // HTML inputs provide text. Convert only a value the user deliberately edited;
  // an imported numeric-looking string must not be repaired by another setting.
  _raw() { return { ...this.draft, intensity: this.intensityEdited ? numeric(this.draft.intensity) : this.draft.intensity }; }
  _contextIssue() {
    if (this.card._config?.layout_key !== this.baseLayoutKey || JSON.stringify(this.effective) !== this.baseValue) {
      return 'Saved weather settings changed while you were editing. Your unfinished values are kept. Cancel to load the latest settings before saving.';
    }
    return null;
  }
  _referenceIssue() {
    if (this.badImported) return 'Saved weather settings are malformed. Relink deliberately to replace them.';
    const entity = this.draft?.entity;
    if (!entity) return null;
    if (typeof entity !== 'string' || !/^weather\.[a-z0-9_]+$/.test(entity)) return 'This saved source is not a valid weather entity. Relink deliberately; no replacement is guessed.';
    const metadata = entityMetadata(this.hass, entity);
    if (metadata.disabled) return 'This weather entity or its device is disabled. Its saved settings are read-only; enable it in Home Assistant or relink deliberately.';
    if (metadata.hidden || metadata.category) return 'This weather source is hidden or diagnostic. Its saved settings are read-only; restore it or relink deliberately.';
    if (!metadata.hasState) return 'This saved weather source has no current state. Its settings are read-only; restore it or relink deliberately.';
    return null;
  }
  _readOnly() { return this.hass.user?.is_admin === false || !!this._referenceIssue(); }

  _footprints() {
    if (typeof this.card.weatherFootprints === 'function') return this.card.weatherFootprints();
    const outdoors = [], indoors = [], floors = Array.isArray(this.card._floors) ? this.card._floors : [];
    for (const entry of Array.isArray(this.card._roomList) ? this.card._roomList : []) {
      const room = entry?.room || {}, floorId = entry.floorId ?? room.floor_id;
      const floor = floors.find((value) => value.id === floorId);
      const elevation = floor && typeof this.card._view?.floorElevation === 'function' ? this.card._view.floorElevation(floorId) : floor?.elevation;
      const region = { id: room.id, floorId, elevation, polygon: room.polygon || room.outline, outdoor: room.outdoor === true, shown: entry.shown };
      (room.outdoor === true ? outdoors : indoors).push(region);
    }
    return { outdoors, indoors };
  }
  _evaluation() {
    const raw = this._raw(), reading = readWeather(this.hass, raw);
    // Validate settings even when effects are disabled, while allowing a deliberate
    // Off configuration without a source. Offline/restored readings are warnings.
    const issues = readWeather(this.hass, { ...raw, enabled: true }).diagnostics.filter((diagnostic) => diagnostic.code === 'config').map((diagnostic) => diagnostic.message);
    if (typeof raw.enabled !== 'boolean') issues.push('Choose whether weather effects are enabled.');
    if (raw.enabled && raw.quality !== 'off') {
      if (!raw.entity) issues.push('Choose a weather source before enabling effects.');
      else if (!this.sourceChoices.some((choice) => choice.value === raw.entity && choice.selectable)) issues.push('Choose an available weather entity deliberately; the saved source cannot be replaced automatically.');
    }
    if (this._readOnly()) issues.push(this.hass.user?.is_admin === false ? 'Only an administrator can save layout settings.' : this._referenceIssue());
    if (this._contextIssue()) issues.push(this._contextIssue());
    return { raw, reading, issues: [...new Set(issues)] };
  }

  _previewHtml() {
    const { raw, reading, issues } = this._evaluation();
    const sun = readSunState(this.hass), location = readHaLocation(this.hass);
    const footprintInput = this._footprints() || {};
    const footprints = normaliseWeatherFootprints(footprintInput.outdoors, footprintInput.indoors, footprintInput.visibleFloors);
    const warnings = [...issues, ...reading.diagnostics.map((diagnostic) => diagnostic.message), ...footprints.diagnostics.map((diagnostic) => diagnostic.message)];
    if (!footprints.outdoors.length && !footprints.diagnostics.length) warnings.push('No exposed outdoor region is set up. In Rooms, draw its outline and mark it Outdoor.');
    const uniqueWarnings = [...new Set(warnings.filter(Boolean))];
    const sourceName = raw.entity ? entityMetadata(this.hass, raw.entity).name : 'No weather source selected';
    const weatherStatus = reading.status === 'ready' ? `${reading.label}${reading.cloudCoverage === null ? '' : ` · ${reading.cloudCoverage}% cloud coverage`}` : reading.label;
    return `<section class="env-weather-status"><h4>Read-only draft preview</h4>
      <p><strong>${esc(sourceName)}</strong><br>${esc(weatherStatus)}</p>
      ${reading.status === 'ready' ? `<p>${effects.filter(([id]) => reading.effects[id] > 0).map(([, label]) => esc(label)).join(' · ') || 'No selected effects for this condition'}. Decorative intensity ${esc(raw.intensity)}.</p>` : ''}
      <p class="env-weather-hint">${footprints.outdoors.length} valid outdoor region${footprints.outdoors.length === 1 ? '' : 's'}; ${footprints.indoors.length} indoor outline${footprints.indoors.length === 1 ? '' : 's'} excluded. Drafts do not save or animate the house.</p>
      <h4>Automatic sun and Home Assistant location</h4>
      <p>Sun source: <strong>sun.sun</strong><br>${sun.status === 'ready' ? `Elevation ${esc(sun.elevation)}° · azimuth ${esc(sun.azimuth)}°` : 'Current sun data unavailable'}</p>
      <p>${location.status === 'ready' ? `HA latitude ${esc(location.latitude)}° · longitude ${esc(location.longitude)}°${location.timeZone ? `<br>Time zone: ${esc(location.timeZone)}` : ''}` : 'Set a valid location in Home Assistant to show the actual moon.'}</p>
      ${[...sun.diagnostics, ...location.diagnostics].length ? `<ul class="env-weather-hint">${[...sun.diagnostics, ...location.diagnostics].map((diagnostic) => `<li>${esc(diagnostic.message)}</li>`).join('')}</ul>` : ''}
      <div aria-live="polite">${this.message ? `<p role="status">${esc(this.message)}</p>` : ''}${uniqueWarnings.length ? `<ul>${uniqueWarnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul>` : ''}</div></section>`;
  }

  _syncSourceChoices(select) {
    if (!select) return;
    const selected = typeof this.draft.entity === 'string' ? this.draft.entity : '';
    const choices = [{ value: '', label: 'Choose a weather entity', selectable: true }, ...this.sourceChoices];
    const existing = new Map([...select.options].map((option) => [option.value, option]));
    const keep = new Set();
    for (const choice of choices) {
      const option = existing.get(choice.value) || document.createElement('option');
      option.value = choice.value; option.textContent = choice.label; option.disabled = !choice.selectable;
      select.append(option); keep.add(option);
    }
    for (const option of [...select.options]) if (!keep.has(option)) option.remove();
    select.value = selected;
  }
  updatePreviews(container) {
    if (this.disposed || !container) return;
    this._ensure();
    const root = container.matches?.('[data-env-weather-editor]') ? container : container.querySelector('[data-env-weather-editor]');
    if (!root) return;
    const target = root.querySelector('[data-env-weather-preview]'), html = this._previewHtml();
    if (target && target.innerHTML !== html) target.innerHTML = html;
    const readOnly = this._readOnly(), nonAdmin = this.hass.user?.is_admin === false;
    for (const control of root.querySelectorAll('[data-env-weather-setting], [data-act="env-weather-save"]')) control.disabled = readOnly;
    const save = root.querySelector('[data-act="env-weather-save"]');
    if (save) save.disabled = readOnly || !!this._contextIssue();
    const source = root.querySelector('[data-field="env-weather-entity"]');
    if (source) source.disabled = nonAdmin || readOnly && !this.relinking;
    this._syncSourceChoices(source);
    const relink = root.querySelector('[data-act="env-weather-relink"]');
    if (relink) { relink.hidden = !this._referenceIssue(); relink.disabled = nonAdmin; }
    const clear = root.querySelector('[data-act="env-weather-clear"]');
    if (clear) clear.disabled = nonAdmin || this.effective?.enabled === false || !Object.keys(plain(this.effective) ? this.effective : {}).length && !this.badImported;
  }
  afterUpdate(container) { this.updatePreviews(container); }

  render() {
    if (this.disposed) return '';
    this._ensure();
    const raw = this.draft, readOnly = this._readOnly(), disabled = readOnly ? 'disabled' : '';
    const sourceDisabled = this.hass.user?.is_admin === false || readOnly && !this.relinking;
    const qualityOptions = qualities.some(([id]) => id === raw.quality) ? qualities : [[String(raw.quality ?? ''), `Unsupported saved quality: ${String(raw.quality)}`], ...qualities];
    return `<section data-env-weather-editor data-taylors3d-ui="weather-editor"><style>
      [data-env-weather-editor]{color:var(--primary-text-color,#212121)}[data-env-weather-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0}
      [data-env-weather-editor] input,[data-env-weather-editor] select,[data-env-weather-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-env-weather-editor] input:not([type=checkbox]),[data-env-weather-editor] select{width:100%}[data-env-weather-editor] .env-weather-check{flex-direction:row;align-items:center}[data-env-weather-editor] .env-weather-check input{min-width:22px;flex-shrink:0}
      [data-env-weather-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-env-weather-editor] .env-weather-actions{display:flex;gap:7px;flex-wrap:wrap}[data-env-weather-editor] button{cursor:pointer}[data-env-weather-editor] :disabled{opacity:.6;cursor:default}
      [data-env-weather-editor] .env-weather-hint{color:var(--secondary-text-color,#666)}[data-env-weather-editor] li{overflow-wrap:anywhere}[data-env-weather-editor] h4{margin:15px 0 6px}
      </style><h3>Weather and sun</h3><p class="env-weather-hint">Use current Home Assistant weather outside your house. You choose the source; nothing is guessed from forecasts.</p>
      <label class="env-weather-check"><input type="checkbox" data-field="env-weather-enabled" data-env-weather-setting ${raw.enabled === true ? 'checked' : ''} ${disabled}> Show outdoor weather effects</label>
      <label>Weather source<select data-field="env-weather-entity" ${sourceDisabled ? 'disabled' : ''}><option value="" ${!raw.entity ? 'selected' : ''}>Choose a weather entity</option>${this.sourceChoices.map((choice) => `<option value="${esc(choice.value)}" ${choice.value === raw.entity ? 'selected' : ''} ${choice.selectable ? '' : 'disabled'}>${esc(choice.label)}</option>`).join('')}</select></label>
      <fieldset><legend>Effects to show</legend>${effects.map(([id, label]) => `<label class="env-weather-check"><input type="checkbox" data-field="env-weather-effect-${id}" data-env-weather-setting ${Array.isArray(raw.effects) && raw.effects.includes(id) ? 'checked' : ''} ${disabled}> ${label}</label>`).join('')}</fieldset>
      <label>Decorative intensity, 0 to 1<input type="number" inputmode="decimal" min="0" max="1" step="0.05" data-field="env-weather-intensity" data-env-weather-setting value="${esc(raw.intensity ?? '')}" ${disabled}></label>
      <p class="env-weather-hint">This changes how many decorative particles you see. It is not a measured rain or snow rate.</p>
      <label>Effect quality<select data-field="env-weather-quality" data-env-weather-setting ${disabled}>${qualityOptions.map(([id, label]) => `<option value="${esc(id)}" ${id === raw.quality || raw.quality === null && id === '' ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
      <p class="env-weather-hint">Static keeps a still effect. Low uses fewer particles for wall panels. Reduced-motion preferences stop animation automatically.</p>
      <h4>Outdoor setup</h4><p class="env-weather-hint">In Rooms, draw an outdoor outline and mark it Outdoor. Keep all indoor room outlines complete, including hidden floors. Rain and snow avoid every indoor outline; no building boundary is guessed. This conservative mask can also exclude a balcony above an indoor room. Broken or missing indoor outlines stop the effects until repaired.</p>
      <div data-env-weather-preview>${this._previewHtml()}</div>
      <div class="env-weather-actions">${button('save', 'Save', readOnly || this._contextIssue() ? 'disabled' : '')}${button('cancel', 'Cancel')}${button('relink', 'Relink deliberately', `${this._referenceIssue() ? '' : 'hidden'} ${this.hass.user?.is_admin === false ? 'disabled' : ''}`)}${button('clear', 'Turn weather off', `${this.hass.user?.is_admin === false || this.effective?.enabled === false || !Object.keys(plain(this.effective) ? this.effective : {}).length && !this.badImported ? 'disabled' : ''}`)}</div></section>`;
  }

  onChange(field, element) {
    if (this.disposed || !field?.startsWith(prefix) || !element) return false;
    this._ensure();
    const name = field.slice(prefix.length);
    if (this.hass.user?.is_admin === false || this._readOnly() && !(name === 'entity' && this.relinking)) return true;
    if (name === 'entity') {
      if (element.value && !this.sourceChoices.some((choice) => choice.value === element.value && choice.selectable)) return true;
      this.draft.entity = element.value;
      if (!this._referenceIssue()) this.relinking = false;
    } else if (name === 'enabled') this.draft.enabled = element.checked === true;
    else if (name === 'quality') this.draft.quality = element.value;
    else if (name === 'intensity') { this.draft.intensity = element.value; this.intensityEdited = true; }
    else if (name.startsWith('effect-') && effects.some(([id]) => id === name.slice(7))) {
      const selected = new Set(Array.isArray(this.draft.effects) ? this.draft.effects : []);
      if (element.checked) selected.add(name.slice(7)); else selected.delete(name.slice(7));
      this.draft.effects = effects.map(([id]) => id).filter((id) => selected.has(id));
    } else return false;
    this.dirty = true; this.message = null;
    const container = element.closest?.('[data-env-weather-editor]');
    if (container) this.updatePreviews(container);
    return true;
  }
  onInput(field, element) { return field === 'env-weather-intensity' && this.onChange(field, element); }
  handleChange(event) { return this.onChange(event.target?.dataset?.field, event.target); }
  handleClick(event) {
    const element = event.target?.closest?.('[data-act]');
    return !!element && !element.disabled && this.onClick(element.dataset.act, element);
  }
  _commit(weather) {
    this.card.commitFeatureLayout({ weather });
    this.reset(); this.onRender();
  }
  onClick(action, element = {}) {
    if (this.disposed || !action?.startsWith(prefix)) return false;
    this._ensure();
    if (action === 'env-weather-cancel') { this.cancel(); return true; }
    if (this.hass.user?.is_admin === false) return true;
    if (action === 'env-weather-relink' && this._referenceIssue()) {
      if (this.badImported) { this.draft = defaults(); this.intensityEdited = false; this.badImported = false; this.dirty = true; }
      this.relinking = true; this.message = 'Choose the replacement source deliberately. The saved source has not been changed.';
      this.onRender(); return true;
    }
    if (action === 'env-weather-save') {
      const result = this._evaluation();
      if (result.issues.length) {
        this.message = 'Choose valid settings before saving; nothing has been saved.';
        this.updatePreviews(element.closest?.('[data-env-weather-editor]'));
      } else this._commit(copy(result.raw));
      return true;
    }
    if (action === 'env-weather-clear') {
      if (this.effective?.enabled === false) return true;
      this._commit({ ...(plain(this.effective) ? copy(this.effective) : defaults()), enabled: false });
      return true;
    }
    return false;
  }
  cancel() { this.reset(); if (!this.disposed) this.onRender(); }
  reset() { this.draft = null; this.intensityEdited = false; this.dirty = false; this.relinking = false; this.message = null; this.badImported = false; this.baseValue = null; this.baseLayoutKey = null; }
  dispose() { this.reset(); this.disposed = true; }
}
