// Future EditMode fragment. All settings remain drafts until Save; this editor
// never moves a camera, dims a picture, starts a timer or sends a HA action.
import { AMBIENT_IDLE_DEFAULTS, readAmbientIdle, readAmbientDim } from './ambient-idle.js';
import { readSunState } from './weather.js';
import { nightFactor } from './objects/logic.js';

const prefix = 'ambient-idle-';
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const own = (value, key) => plain(value) && Object.hasOwn(value, key);
const modes = [['sun', 'Actual sun'], ['quiet_hours', 'Quiet hours'], ['sun_or_quiet_hours', 'Actual sun or quiet hours']];
const known = new Set(['enabled', 'idle_seconds', 'rotate', 'rotation_degrees_per_second', 'dim']);
const dimKnown = new Set(['enabled', 'brightness', 'when', 'start', 'end']);
const extras = (value, fields) => plain(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => !fields.has(key))) : {};
const number = (value) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : '';

/** AmbientIdleEditor(card,onRender,{now?}) exposes the normal EditMode fragment
 * methods: render, onClick, onChange, onInput, updatePreviews, reset, cancel and
 * dispose. Native ambient-idle-* fields should survive HA state updates. Save
 * alone calls card.commitFeatureLayout({ambient_idle}); root owns history and
 * every actual idle camera/CSS/lifecycle effect. No draft presentation preview.
 */
export class AmbientIdleEditor {
  constructor(card, onRender = () => {}, { now = () => Date.now() } = {}) {
    this.card = card; this.onRender = onRender; this.now = now;
    this.draft = null; this.dirty = false; this.disposed = false; this._loaded = false;
    this.message = null; this.stale = false;
  }
  get effective() { return this.card._layout?.ambient_idle ?? this.card._config?.ambient_idle; }
  _context() {
    const config = this.card._config || {}, layout = this.card._layout || {}, user = this.card._hass?.user;
    return { root: this.card._view?.model?.root ?? null,
      key: JSON.stringify([config.layout_key, config.model ? config.model : layout.model ?? null,
        config.model_position, config.model_rotation, config.model_scale, layout.floors, layout.rooms,
        this.card._modelAlign?.() ?? null, user?.id ?? null, user?.is_admin === true]),
      value: JSON.stringify(this.effective) };
  }
  _load() {
    this.base = this._context();
    this.draft = this.effective === undefined ? {} : clone(this.effective);
    this.dirty = false; this.stale = false; this.message = null; this._loaded = true;
  }
  _sameContext(context) { return this.base?.root === context.root && this.base?.key === context.key && this.base?.value === context.value; }
  _ensure() {
    const context = this._context();
    if (!this._loaded || !this.dirty && !this._sameContext(context)) this._load();
    else if (this.dirty && !this._sameContext(context)) this.stale = true;
  }
  _readOnly() { return this.card._hass?.user?.is_admin !== true; }
  _contextIssue() {
    return this.stale ? 'The saved settings, model or user changed while you were editing. Your draft is kept. Cancel to load the latest settings before saving.' : null;
  }
  _evaluation() {
    const policy = readAmbientIdle(this.draft), issues = policy.diagnostics.map((diagnostic) => diagnostic.message);
    if (this._readOnly()) issues.push('Only an administrator can save idle settings.');
    const context = this._contextIssue(); if (context) issues.push(context);
    return { policy, issues };
  }
  _raw(field) {
    const [section, key] = field.split('.');
    if (!key) return own(this.draft, section) ? this.draft[section] : AMBIENT_IDLE_DEFAULTS[section];
    return own(this.draft?.[section], key) ? this.draft[section][key] : AMBIENT_IDLE_DEFAULTS[section][key];
  }
  _fieldValue(field) {
    const value = this._raw(field);
    if (field === 'dim.brightness') return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 1000000) / 10000) : '';
    return ['string', 'number'].includes(typeof value) ? String(value) : '';
  }
  _sourceReport() {
    const sun = readSunState(this.card._hass), policy = readAmbientIdle(this.draft);
    const reading = readAmbientDim(this.draft, {
      sun: sun.status === 'ready' ? { status: 'ready', nightFactor: nightFactor(sun.elevation) } : { status: sun.status },
      wallTime: this.now(), timeZone: this.card._hass?.config?.time_zone,
    });
    return { sun, policy, reading };
  }
  _statusHtml() {
    const { policy, issues } = this._evaluation(), saved = readAmbientIdle(this.effective);
    const { sun, reading } = this._sourceReport(), zone = this.card._hass?.config?.time_zone;
    const source = policy.dim.when;
    const sunText = sun.status === 'ready' ? `Current sun elevation: ${sun.elevation}°.` : 'No usable current sun reading. Sun-based dimming waits for Home Assistant’s sun.sun.';
    const quietText = reading.quietHours.status === 'ready'
      ? `Quiet hours are ${reading.quietHours.active ? 'active' : 'inactive'} at the current Home Assistant local time.`
      : 'Quiet-hours dimming needs Home Assistant’s valid time zone and the current clock.';
    return `<p>Currently saved: <strong>${saved.valid ? saved.enabled ? 'Idle mode enabled' : 'Idle mode off' : 'Invalid settings; idle effects disabled'}</strong>.</p>
      ${this.dirty ? '<p>Unsaved settings. Save to apply them; Cancel keeps the saved settings.</p>' : ''}
      <p class="ambient-idle-hint">Editing these settings does not rotate or dim the house. Dimming changes this card’s picture, not your tablet backlight or real lights.</p>
      ${policy.enabled && policy.dim.enabled ? `<p>${source !== 'quiet_hours' ? esc(sunText) : ''}</p>${source !== 'sun' ? `<p>Home Assistant time zone: ${esc(zone || 'not reported')}. ${esc(quietText)}</p>` : ''}
      <p>Conditions checked now: ${reading.factor > 0 ? `picture brightness would be ${Math.round(reading.brightness * 100)}% after the idle delay` : 'no currently trusted dim condition is active'}. This is a reading check, not a live preview.</p>
      ${reading.diagnostics.length ? `<ul>${reading.diagnostics.map((diagnostic) => `<li>${esc(diagnostic.message)}</li>`).join('')}</ul>` : ''}` : ''}
      ${this.message ? `<p role="status">${esc(this.message)}</p>` : ''}
      ${issues.length ? `<ul role="status">${issues.map((message) => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}`;
  }
  updatePreviews(container) {
    if (this.disposed || !container) return;
    this._ensure();
    const root = container.matches?.('[data-ambient-idle-editor]') ? container : container.querySelector('[data-ambient-idle-editor]');
    if (!root) return;
    const status = root.querySelector('[data-ambient-idle-status]'), html = this._statusHtml();
    if (status && status.innerHTML !== html) status.innerHTML = html;
    const disabled = this._readOnly() || !!this._contextIssue() || !plain(this.draft);
    for (const control of root.querySelectorAll('[data-field]')) {
      control.disabled = disabled;
      const field = control.dataset.field.slice(prefix.length), raw = this._raw(field);
      if (control.type === 'checkbox') { control.checked = raw === true; control.indeterminate = typeof raw !== 'boolean'; }
      else if (!this.dirty) {
        if (control.tagName === 'SELECT') this._updateModes(control, raw);
        else control.value = this._fieldValue(field);
      }
    }
    const save = root.querySelector(`[data-act="${prefix}save"]`);
    if (save) save.disabled = !this.dirty || this._evaluation().issues.length > 0;
    const repair = root.querySelector(`[data-act="${prefix}repair"]`);
    if (repair) repair.disabled = this._readOnly() || !!this._contextIssue();
  }
  _updateModes(select, raw) {
    for (const option of [...select.options]) if (!modes.some(([value]) => value === option.value)) option.remove();
    if (!modes.some(([value]) => value === raw)) {
      const option = document.createElement('option'); option.value = ''; option.disabled = true;
      option.textContent = 'Unsupported saved condition — choose a replacement'; select.prepend(option); select.value = '';
    } else select.value = raw;
  }
  render() {
    if (this.disposed) return '';
    this._ensure();
    const disabled = this._readOnly() || this._contextIssue() || !plain(this.draft) ? 'disabled' : '';
    const checkbox = (field, label) => `<label class="ambient-idle-check"><input type="checkbox" data-field="${prefix}${field}" ${this._raw(field) === true ? 'checked' : ''} ${disabled}>${label}</label>`;
    const input = (field, label, attributes) => `<label>${label}<input data-field="${prefix}${field}" ${attributes} value="${esc(this._fieldValue(field))}" ${disabled}></label>`;
    const condition = this._raw('dim.when'), extra = modes.some(([value]) => value === condition) ? '' : '<option value="" disabled selected>Unsupported saved condition — choose a replacement</option>';
    return `<section data-ambient-idle-editor data-taylors3d-ui="ambient-idle-editor"><style>
      [data-ambient-idle-editor]{color:var(--primary-text-color,#212121);margin-bottom:20px}
      [data-ambient-idle-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0;overflow-wrap:anywhere}
      [data-ambient-idle-editor] input,[data-ambient-idle-editor] select,[data-ambient-idle-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-ambient-idle-editor] input:not([type=checkbox]),[data-ambient-idle-editor] select{width:100%;min-width:0}
      [data-ambient-idle-editor] .ambient-idle-check{flex-direction:row;align-items:center;min-height:44px;cursor:pointer}[data-ambient-idle-editor] input[type=checkbox]{flex:0 0 44px;width:44px;min-height:44px;margin:0 4px 0 0}
      [data-ambient-idle-editor] button{cursor:pointer}[data-ambient-idle-editor] :disabled{opacity:.6;cursor:default}
      [data-ambient-idle-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}
      [data-ambient-idle-editor] .ambient-idle-actions{display:flex;gap:7px;flex-wrap:wrap}[data-ambient-idle-editor] .ambient-idle-hint{color:var(--secondary-text-color,#666)}
      [data-ambient-idle-editor] p,[data-ambient-idle-editor] li{overflow-wrap:anywhere}
      </style><h3>Ambient idle</h3><p>Choose what the house picture does when nobody is touching the card.</p>
      ${checkbox('enabled', 'Enable ambient idle')}${input('idle_seconds', 'Wait before idle mode, seconds', 'type="number" min="1" max="86400" step="1"')}
      ${checkbox('rotate', 'Slowly rotate the house')}${input('rotation_degrees_per_second', 'Rotation speed, degrees per second', 'type="number" min="0" max="6" step="0.1"')}
      <p class="ambient-idle-hint">Rotation is a display effect. It must pause for touch, controls, alerts, scene previews and automatic view changes. Reduced-motion and inactive views must stay still; it does not promise a particular tablet frame rate or battery saving.</p>
      ${checkbox('dim.enabled', 'Dim the card picture while idle')}${input('dim.brightness', 'Dimmed picture brightness, percent', 'type="number" min="10" max="100" step="1"')}
      <label>When to dim<select data-field="${prefix}dim.when" ${disabled}>${extra}${modes.map(([value, label]) => `<option value="${value}" ${condition === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      ${input('dim.start', 'Quiet hours start, 24-hour HH:mm', 'type="text" inputmode="numeric" placeholder="22:00"')}${input('dim.end', 'Quiet hours end, 24-hour HH:mm', 'type="text" inputmode="numeric" placeholder="07:00"')}
      <p class="ambient-idle-hint">Quiet hours use Home Assistant’s time zone, not a guessed browser zone. A range can cross midnight. Start and end must differ. Actual sun uses sun.sun; manual Day/Night and the theme are separate.</p>
      <div data-ambient-idle-status aria-live="polite">${this._statusHtml()}</div>
      <div class="ambient-idle-actions"><button type="button" data-act="${prefix}save" ${!this.dirty || this._evaluation().issues.length ? 'disabled' : ''}>Save idle settings</button><button type="button" data-act="${prefix}cancel">Cancel</button><button type="button" data-act="${prefix}repair" ${this._readOnly() || this._contextIssue() ? 'disabled' : ''}>Use default idle settings</button></div></section>`;
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith(prefix) || !element) return false;
    this._ensure();
    if (this._readOnly() || this._contextIssue() || !plain(this.draft)) return true;
    const path = field.slice(prefix.length), [section, key] = path.split('.');
    if (!['enabled', 'idle_seconds', 'rotate', 'rotation_degrees_per_second', 'dim.enabled', 'dim.brightness', 'dim.when', 'dim.start', 'dim.end'].includes(path)) return false;
    if (key && own(this.draft, section) && !plain(this.draft[section])) { this.message = 'The saved dimming settings need deliberate repair. Use default idle settings, or Cancel to keep them.'; this.updatePreviews(element.closest?.('[data-ambient-idle-editor]')); return true; }
    let value = element.value;
    if (['enabled', 'rotate', 'dim.enabled'].includes(path)) value = element.checked === true;
    else if (['idle_seconds', 'rotation_degrees_per_second', 'dim.brightness'].includes(path)) {
      value = number(value); if (path === 'dim.brightness' && typeof value === 'number') value /= 100;
    }
    if (key) this.draft[section] = { ...(this.draft[section] || {}), [key]: value };
    else this.draft[section] = value;
    this.dirty = JSON.stringify(this.draft) !== this.base.value; this.message = null;
    this.updatePreviews(element.closest?.('[data-ambient-idle-editor]')); return true;
  }
  onInput(field, element) { return this.onChange(field, element); }
  onClick(action) {
    if (this.disposed || !action?.startsWith(prefix)) return false;
    this._ensure();
    if (action === `${prefix}cancel`) { this.reset(); this.onRender(); return true; }
    if (action === `${prefix}repair`) {
      if (this._readOnly() || this._contextIssue()) return true;
      this.draft = { ...extras(this.draft, known), ...clone(AMBIENT_IDLE_DEFAULTS), dim: { ...extras(this.draft?.dim, dimKnown), ...AMBIENT_IDLE_DEFAULTS.dim } };
      this.dirty = JSON.stringify(this.draft) !== this.base.value; this.message = null; this.onRender(); return true;
    }
    if (action !== `${prefix}save`) return false;
    const { issues } = this._evaluation();
    if (!this.dirty || issues.length || typeof this.card.commitFeatureLayout !== 'function') {
      this.message = issues[0] || 'Change an idle setting before saving.'; this.onRender(); return true;
    }
    this.card.commitFeatureLayout({ ambient_idle: clone(this.draft) }); this.reset(); this.onRender(); return true;
  }
  reset() { this.draft = null; this._loaded = false; this.dirty = false; this.stale = false; this.message = null; }
  cancel() { this.reset(); }
  dispose() { this.reset(); this.disposed = true; }
}
