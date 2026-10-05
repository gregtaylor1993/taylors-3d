// Environment drafts change layout configuration only. No weather animation,
// service call, preview renderer or storage write occurs before an explicit Save.
import { entityChoices, entityMetadata } from './entity-metadata.js';
import { EntityAreaFilter } from './entity-area-filter.js';
import { readWeather, readSunState, readHaLocation, normaliseWeatherFootprints } from './weather.js';
import { localeInfo, localize } from './localization.js';
import messages from './translations/editor-environment-house.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = (value) => JSON.parse(JSON.stringify(value));
const qualities = [['off', 'Off'], ['static', 'Static — no animation'], ['low', 'Low — wall panel'], ['medium', 'Medium']];
const effects = [['rain', 'Rain'], ['clouds', 'Clouds'], ['snow', 'Snow']];
const defaults = () => ({ enabled: false, entity: '', effects: effects.map(([id]) => id), intensity: 0.6, quality: 'low' });
const prefix = 'env-weather-';
const button = (action, label, attributes = '') => `<button type="button" data-act="${prefix}${action}" ${attributes}>${esc(label)}</button>`;
const numeric = (value) => typeof value === 'string' ? value.trim() === '' ? NaN : Number(value) : value;
const readerKeys = new Map(Object.entries(messages.en).filter(([key]) => key.startsWith('environmentHouse.weather.reader.')).map(([key,value]) => [value,key.slice('environmentHouse.weather.'.length)]));
const messageKeys = new Map(Object.values(messages).flatMap((catalogue) => Object.entries(catalogue).filter(([key]) => key.startsWith('environmentHouse.weather.')).map(([key,value]) => [value,key.slice('environmentHouse.weather.'.length)])));
const statusKeys = new Map(['off','setup','unavailable','condition'].map((key) => [messages.en[`environmentHouse.weather.status.${key}`],`status.${key}`]));

/** Parent contract: render/onClick/onChange/onInput/updatePreviews/reset/cancel/dispose.
 * Save uses commitFeatureLayout({weather: object}), with layout.weather ?? config.weather.
 * Optional weatherFootprints() supplies {outdoors,indoors,visibleFloors}; otherwise use
 * actual room outlines and known floors. Root keeps this fragment in Edit → Environment,
 * preserves focused env-weather-* controls during HA updates, and resets after Undo/context changes.
 */
export class WeatherEditor {
  constructor(card, onRender = () => {}) {
    this.areaFilter = new EntityAreaFilter();
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
  _t(key,params = {}) { const id = `environmentHouse.weather.${key}`; return localize(this.hass,id,params,(messages[localeInfo(this.hass).resolved] || messages.en)[id] || messages.en[id] || ''); }
  _caption(key,tag = 'span',params = {},attributes = '') { return `<${tag} data-env-weather-text="${key}" data-env-weather-params="${esc(JSON.stringify(params))}" ${attributes}>${esc(this._t(key,params))}</${tag}>`; }
  _syncLabels(root) { for (const node of root.querySelectorAll('[data-env-weather-text]')) {
    const value = this._t(node.dataset.envWeatherText,JSON.parse(node.dataset.envWeatherParams || '{}'));
    if (node.textContent !== value) node.textContent = value;
  } }
  _diagnostic(entry) {
    // Readers have no locale seam: translate only explicitly known owned prose.
    // Unknown future diagnostics remain readable; imported values are not repaired.
    const message = Object.getOwnPropertyDescriptor(entry || {},'message')?.value;
    return typeof message === 'string' ? readerKeys.has(message) ? this._t(readerKeys.get(message)) : message : '';
  }
  _messageText() { return messageKeys.has(this.message) ? this._t(messageKeys.get(this.message)) : this.message; }
  get effective() { return this.card._layout?.weather ?? this.card._config?.weather ?? {}; }
  get sourceChoices() {
    const selected = typeof this.draft?.entity === 'string' && this.draft.entity ? this.draft.entity : [];
    return this.areaFilter.choices(this.hass, entityChoices(this.hass, { domains: ['weather'], selected,
      capability: (metadata) => typeof metadata.entityId === 'string' && metadata.entityId.length <= 255
        && /^weather\.[a-z0-9_]+$/.test(metadata.entityId) && plain(metadata.state) && typeof metadata.state.state === 'string'
        && (metadata.state.entity_id === undefined || metadata.state.entity_id === metadata.entityId)
        && (metadata.state.attributes === undefined || plain(metadata.state.attributes)) }));
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
      return this._t('context');
    }
    return null;
  }
  _referenceIssue() {
    if (this.badImported) return this._t('malformed');
    const entity = this.draft?.entity;
    if (!entity) return null;
    if (typeof entity !== 'string' || !/^weather\.[a-z0-9_]+$/.test(entity)) return this._t('invalidEntity');
    const metadata = entityMetadata(this.hass, entity);
    if (metadata.disabled) return this._t('disabled');
    if (metadata.hidden || metadata.category) return this._t('hidden');
    if (!metadata.hasState) return this._t('missing');
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
    const issues = readWeather(this.hass, { ...raw, enabled: true }).diagnostics.filter((diagnostic) => diagnostic.code === 'config').map((diagnostic) => this._diagnostic(diagnostic));
    if (typeof raw.enabled !== 'boolean') issues.push(this._t('chooseEnabled'));
    if (raw.enabled && raw.quality !== 'off') {
      if (!raw.entity) issues.push(this._t('chooseSource'));
      else if (!this.sourceChoices.some((choice) => choice.value === raw.entity && choice.selectable)) issues.push(this._t('chooseAvailable'));
    }
    if (this._readOnly()) issues.push(this.hass.user?.is_admin === false ? this._t('admin') : this._referenceIssue());
    if (this._contextIssue()) issues.push(this._contextIssue());
    return { raw, reading, issues: [...new Set(issues)] };
  }

  _previewHtml() {
    const { raw, reading, issues } = this._evaluation();
    const sun = readSunState(this.hass), location = readHaLocation(this.hass);
    const footprintInput = this._footprints() || {};
    const footprints = normaliseWeatherFootprints(footprintInput.outdoors, footprintInput.indoors, footprintInput.visibleFloors);
    const warnings = [...issues, ...reading.diagnostics.map((diagnostic) => this._diagnostic(diagnostic)), ...footprints.diagnostics.map((diagnostic) => this._diagnostic(diagnostic))];
    if (!footprints.outdoors.length && !footprints.diagnostics.length) warnings.push(this._t('noOutdoors'));
    const uniqueWarnings = [...new Set(warnings.filter(Boolean))];
    const sourceName = raw.entity ? entityMetadata(this.hass, raw.entity).name : this._t('noSource');
    const labelKey = reading.status === 'ready' ? `condition.${reading.condition}` : statusKeys.get(reading.label);
    const label = Object.hasOwn(messages.en,`environmentHouse.weather.${labelKey}`) ? this._t(labelKey) : reading.label;
    const weatherStatus = reading.status === 'ready' && reading.cloudCoverage !== null ? this._t('coverage',{label,coverage:reading.cloudCoverage}) : label;
    return `<section class="env-weather-status"><h4>${esc(this._t('preview'))}</h4>
      <p><strong>${esc(sourceName)}</strong><br>${esc(weatherStatus)}</p>
      ${reading.status === 'ready' ? `<p>${esc(this._t('effectStatus',{effects:effects.filter(([id]) => reading.effects[id] > 0).map(([id]) => this._t(id)).join(' · ') || this._t('noEffects'),intensity:raw.intensity}))}</p>` : ''}
      <p class="env-weather-hint">${esc(this._t(`footprint${footprints.outdoors.length === 1 ? 'One' : 'Many'}${footprints.indoors.length === 1 ? 'One' : 'Many'}`,{outdoors:footprints.outdoors.length,indoors:footprints.indoors.length}))}</p>
      <h4>${esc(this._t('sunLocation'))}</h4>
      <p>${esc(this._t('sunSource'))} <strong>sun.sun</strong><br>${esc(sun.status === 'ready' ? this._t('sunAngles',{elevation:sun.elevation,azimuth:sun.azimuth}) : this._t('sunUnavailable'))}</p>
      <p>${location.status === 'ready' ? `${esc(this._t('coordinates',{latitude:location.latitude,longitude:location.longitude}))}${location.timeZone ? `<br>${esc(this._t('timeZone',{value:location.timeZone}))}` : ''}` : esc(this._t('locationUnavailable'))}</p>
      ${[...sun.diagnostics, ...location.diagnostics].length ? `<ul class="env-weather-hint">${[...sun.diagnostics, ...location.diagnostics].map((diagnostic) => `<li>${esc(this._diagnostic(diagnostic))}</li>`).join('')}</ul>` : ''}
      <div aria-live="polite">${this.message ? `<p role="status">${esc(this._messageText())}</p>` : ''}${uniqueWarnings.length ? `<ul>${uniqueWarnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul>` : ''}</div></section>`;
  }

  _syncSourceChoices(select) {
    if (!select) return;
    const selected = typeof this.draft.entity === 'string' ? this.draft.entity : '';
    const choices = [{ value: '', label: this._t('choose'), selectable: true }, ...this.sourceChoices];
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
    this._syncLabels(root);
    const quality = root.querySelector('[data-field="env-weather-quality"]');
    if (quality) for (const option of quality.options) {
      const label = qualities.some(([id]) => id === option.value) ? this._t(option.value) : this._t('unsupportedQuality',{value:String(this.draft.quality)});
      if (option.textContent !== label) option.textContent = label;
    }
    this.areaFilter.update(this.hass, root, `${prefix}area-filter`);
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
    const qualityOptions = qualities.some(([id]) => id === raw.quality) ? qualities.map(([id]) => [id,this._t(id)]) : [[String(raw.quality ?? ''), this._t('unsupportedQuality',{value:String(raw.quality)})], ...qualities.map(([id]) => [id,this._t(id)])];
    return `<section data-env-weather-editor data-taylors3d-ui="weather-editor"><style>
      [data-env-weather-editor]{color:var(--primary-text-color,#212121)}[data-env-weather-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0}
      [data-env-weather-editor] input,[data-env-weather-editor] select,[data-env-weather-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-env-weather-editor] input:not([type=checkbox]),[data-env-weather-editor] select{width:100%}[data-env-weather-editor] .env-weather-check{flex-direction:row;align-items:center}[data-env-weather-editor] .env-weather-check input{min-width:22px;flex-shrink:0}
      [data-env-weather-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-env-weather-editor] .env-weather-actions{display:flex;gap:7px;flex-wrap:wrap}[data-env-weather-editor] button{cursor:pointer}[data-env-weather-editor] :disabled{opacity:.6;cursor:default}
      [data-env-weather-editor] .env-weather-hint{color:var(--secondary-text-color,#666)}[data-env-weather-editor] li{overflow-wrap:anywhere}[data-env-weather-editor] h4{margin:15px 0 6px}
      </style>${this._caption('title','h3')}${this._caption('intro','p',{},'class="env-weather-hint"')}
      <label class="env-weather-check"><input type="checkbox" data-field="env-weather-enabled" data-env-weather-setting ${raw.enabled === true ? 'checked' : ''} ${disabled}> ${this._caption('enabled')}</label>
      ${this.areaFilter.render(this.hass, `${prefix}area-filter`)}
      <label>${this._caption('source')}<select data-field="env-weather-entity" ${sourceDisabled ? 'disabled' : ''}><option value="" ${!raw.entity ? 'selected' : ''}>${esc(this._t('choose'))}</option>${this.sourceChoices.map((choice) => `<option value="${esc(choice.value)}" ${choice.value === raw.entity ? 'selected' : ''} ${choice.selectable ? '' : 'disabled'}>${esc(choice.label)}</option>`).join('')}</select></label>
      <fieldset>${this._caption('effects','legend')}${effects.map(([id]) => `<label class="env-weather-check"><input type="checkbox" data-field="env-weather-effect-${id}" data-env-weather-setting ${Array.isArray(raw.effects) && raw.effects.includes(id) ? 'checked' : ''} ${disabled}> ${this._caption(id)}</label>`).join('')}</fieldset>
      <label>${this._caption('intensity')}<input type="number" inputmode="decimal" min="0" max="1" step="0.05" data-field="env-weather-intensity" data-env-weather-setting value="${esc(raw.intensity ?? '')}" ${disabled}></label>
      ${this._caption('intensityHelp','p',{},'class="env-weather-hint"')}
      <label>${this._caption('quality')}<select data-field="env-weather-quality" data-env-weather-setting ${disabled}>${qualityOptions.map(([id, label]) => `<option value="${esc(id)}" ${id === raw.quality || raw.quality === null && id === '' ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
      ${this._caption('qualityHelp','p',{},'class="env-weather-hint"')}
      ${this._caption('outdoorSetup','h4')}${this._caption('outdoorHelp','p',{},'class="env-weather-hint"')}
      <div data-env-weather-preview>${this._previewHtml()}</div>
      <div class="env-weather-actions">${button('save', this._t('save'), `data-env-weather-text="save" ${readOnly || this._contextIssue() ? 'disabled' : ''}`)}${button('cancel', this._t('cancel'),'data-env-weather-text="cancel"')}${button('relink', this._t('relink'), `data-env-weather-text="relink" ${this._referenceIssue() ? '' : 'hidden'} ${this.hass.user?.is_admin === false ? 'disabled' : ''}`)}${button('clear', this._t('clear'), `data-env-weather-text="clear" ${this.hass.user?.is_admin === false || this.effective?.enabled === false || !Object.keys(plain(this.effective) ? this.effective : {}).length && !this.badImported ? 'disabled' : ''}`)}</div></section>`;
  }

  onChange(field, element) {
    if (this.disposed || !field?.startsWith(prefix) || !element) return false;
    this._ensure();
    const name = field.slice(prefix.length);
    if (name === 'area-filter') {
      if (element.isConnected !== false && this.areaFilter.set(this.hass, element.value)) this.updatePreviews(element.closest('[data-env-weather-editor]'));
      return true;
    }
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
      this.relinking = true; this.message = this._t('relinkMessage');
      this.onRender(); return true;
    }
    if (action === 'env-weather-save') {
      const result = this._evaluation();
      if (result.issues.length) {
        this.message = this._t('invalidSave');
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
