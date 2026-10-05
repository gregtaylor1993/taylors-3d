// Draft-only floor display settings. Root owns the renderer and history; this
// fragment never moves geometry, changes coordinates or sends a HA action.
import { FLOOR_PRESENTATION_DEFAULTS, FLOOR_PRESENTATION_LIMITS, readFloorPresentation } from './floor-presentation.js';

const prefix = 'floor-presentation-';
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => plain(value) && Object.hasOwn(value, key);
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
// Preserve distinctions such as a present malformed undefined setting versus an
// absent setting. These stamps are internal; saved extensions remain unchanged.
const stamp = (value) => JSON.stringify(tag(value));
const tag = (value) => Array.isArray(value) ? ['array', Array.from(value, tag)] : plain(value)
  ? ['object', Object.entries(value).map(([key, entry]) => [key, tag(entry)])]
  : [typeof value, typeof value === 'number' && !Number.isFinite(value) ? String(value) : value];
const number = (value) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : '';
const modes = [['assembled', 'Normal (assembled)'], ['horizontal', 'Side by side'], ['vertical', 'Stacked layers']];
const axes = [['east', 'East'], ['north', 'North']];
const fields = new Set(['mode', 'gap_m', 'axis', 'base_elevation_m', 'floors']);
const exactId = (id) => readFloorPresentation({ floors: [id] }).valid;
const valueLabel = (value) => typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined';

/** Model-tab fragment: FloorPresentationEditor(card,onRender). Native fields use
 * floor-presentation-*; rows carry exact value/index intent to reject stale DOM
 * events. Only Save calls commitFeatureLayout(patch,'Floor presentation').
 * updatePreviews updates diagnostics, not geometry. No live draft preview.
 * Parent calls cancel/reset on tab/history changes and dispose on true teardown.
 */
export class FloorPresentationEditor {
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.disposed = false;
    this._loaded = false; this.draft = null; this.dirty = false; this.stale = false; this.message = null;
  }
  get effective() { return this.card._layout?.floor_presentation ?? this.card._config?.floor_presentation; }
  get canEdit() {
    const hass = this.card._hass, user = hass?.user;
    return !this.disposed && this.card.isConnected === true && hass?.connection?.connected === true
      && typeof user?.id === 'string' && user.id.trim().length > 0 && user.is_admin === true
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true)
      && (this.card._editing === undefined || this.card._editing === true && this.card._edit?.tab === 'model');
  }
  _floors() { return Array.isArray(this.card._floors) ? this.card._floors : []; }
  _context() {
    const config = this.card._config || {}, layout = this.card._layout || {}, hass = this.card._hass, user = hass?.user;
    return { root: this.card._view?.model?.root ?? null, connection: hass?.connection, auth: hass?.auth,
      key: stamp([config.layout_key, config.model ? config.model : layout.model, config.model_position, config.model_rotation,
        config.model_scale, this.card._modelAlign?.(), this.card._mb?.levels, layout.floors, layout.rooms,
        this._floors().map((floor) => [floor?.id, floor?.elevation, floor?.stale]),
        user?.id, user?.is_admin, !!user && Object.hasOwn(user, 'is_active'), user?.is_active,
        this.card.isConnected, hass?.connection?.connected, this.card._editing, this.card._edit?.tab]),
      value: stamp(this.effective) };
  }
  _same(context) { return this.base?.root === context.root && this.base?.connection === context.connection
    && this.base?.auth === context.auth && this.base?.key === context.key && this.base?.value === context.value; }
  _load() {
    this.base = this._context(); this.draft = this.effective === undefined ? {} : clone(this.effective);
    this.dirty = false; this.stale = false; this.message = null; this._loaded = true;
  }
  _ensure() {
    const context = this._context();
    if (!this._loaded || !this.dirty && !this._same(context)) this._load();
    else if (this.dirty && !this._same(context)) this.stale = true;
  }
  _blocked() { return !this.canEdit || this.stale || !plain(this.draft); }
  _raw(field) { return own(this.draft, field) ? this.draft[field] : FLOOR_PRESENTATION_DEFAULTS[field]; }
  _value(field) { const value = this._raw(field); return ['string', 'number'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value)) ? String(value) : ''; }
  _mark() { this.dirty = stamp(this.draft) !== this.base.value; this.message = null; }
  _automatic() { return this._floors().slice().sort((a, b) => {
    const elevationA = typeof a?.elevation === 'number' && Number.isFinite(a.elevation) ? a.elevation : Infinity;
    const elevationB = typeof b?.elevation === 'number' && Number.isFinite(b.elevation) ? b.elevation : Infinity;
    const idA = String(a?.id), idB = String(b?.id);
    return elevationA - elevationB || (idA < idB ? -1 : idA > idB ? 1 : 0);
  }).map((floor) => floor?.id); }
  _rows() { return own(this.draft, 'floors') ? Array.isArray(this.draft.floors) ? Array.from(this.draft.floors) : [] : this._automatic(); }
  _floor(id) {
    if (!exactId(id)) return null;
    const matches = this._floors().filter((floor) => floor?.id === id);
    const floor = matches[0];
    return matches.length === 1 && typeof floor?.elevation === 'number' && Number.isFinite(floor.elevation)
      && Math.abs(floor.elevation) <= FLOOR_PRESENTATION_LIMITS.maxWorldCoordinate
      && (!Object.hasOwn(floor, 'stale') || floor.stale === false) ? floor : null;
  }
  _rowMessage(id) {
    if (!exactId(id)) return 'Malformed saved floor ID — replace or remove it deliberately.';
    const matches = this._floors().filter((floor) => floor?.id === id);
    if (!matches.length) return 'Saved floor is missing — its exact ID is kept.';
    if (matches.length !== 1) return 'This floor ID is ambiguous in the current floors.';
    return this._floor(id) ? `Saved elevation: ${matches[0].elevation} metres.` : 'Current floor elevation is invalid or stale.';
  }
  _choices() { return this._floors().filter((floor) => this._floor(floor?.id) === floor).map((floor) => [floor.id, floor.name || floor.id]); }
  _evaluation() {
    const policy = readFloorPresentation(this.draft), issues = policy.diagnostics.map((entry) => entry.message);
    if (!this.canEdit) issues.push('A connected, current active administrator account is required to edit or save floor settings.');
    if (this.stale) issues.push('The saved settings, model, alignment, floors or session changed. Your draft is kept. Cancel before saving.');
    if (policy.valid && policy.mode !== 'assembled') {
      const ids = this._rows();
      if (!ids.length) issues.push('Choose at least one current floor before separating floors.');
      if (ids.length > FLOOR_PRESENTATION_LIMITS.maxFloors) issues.push(`Choose at most ${FLOOR_PRESENTATION_LIMITS.maxFloors} floors for separation.`);
      for (const id of ids) if (!this._floor(id)) issues.push(`Floor ${valueLabel(id)} has no unique current elevation. Replace or remove it, or choose Normal (assembled).`);
    }
    return { policy, issues: [...new Set(issues)] };
  }
  _reportHtml() {
    let report;
    try { report = this.card.floorPresentationReport?.(); } catch { report = null; }
    const diagnostics = Array.isArray(report?.diagnostics) ? report.diagnostics : [];
    const known = modes.find(([id]) => id === report?.mode);
    return `<p>${known ? `Current renderer report: ${esc(known[1])}${report.valid === false ? ' (requested separation is not ready)' : ''}.` : 'Renderer checks are not connected in this standalone editor.'}</p>
      <p class="floor-presentation-hint">A model needs separate saved level groups with explicitly confirmed floor links. A drawn plan needs real room outlines. These geometry checks are warnings to inspect; saving a valid request does not prove the model can be separated.</p>
      ${diagnostics.length ? `<ul>${diagnostics.map((entry) => `<li>${esc(entry?.message || 'A geometry check needs attention.')} ${typeof entry?.floor_id === 'string' ? `(floor ${esc(entry.floor_id)})` : ''}</li>`).join('')}</ul>` : ''}`;
  }
  _statusHtml() {
    const saved = readFloorPresentation(this.effective), { issues } = this._evaluation();
    return `<p>Currently saved: <strong>${saved.valid ? modes.find(([id]) => id === saved.mode)?.[1] : 'Invalid settings; normal display is used'}</strong>.</p>
      ${this.dirty ? '<p>Unsaved floor settings. Save to apply them; Cancel keeps the saved settings.</p>' : ''}
      ${this.message ? `<p role="status">${esc(this.message)}</p>` : ''}
      ${issues.length ? `<ul role="status">${issues.map((message) => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}`;
  }
  _options(choices, raw, placeholder = 'Choose a value') {
    return `${choices.some(([id]) => id === raw) ? '' : `<option value="" disabled selected>${esc(raw === undefined ? placeholder : `Saved value unavailable: ${valueLabel(raw)}`)}</option>`}
      ${choices.map(([id, label]) => `<option value="${esc(id)}" ${id === raw ? 'selected' : ''}>${esc(label)}</option>`).join('')}`;
  }
  _floorsHtml() {
    const rows = this._rows(), blocked = this._blocked(), malformed = own(this.draft, 'floors') && !Array.isArray(this.draft.floors);
    const disabled = blocked ? 'disabled' : '';
    const action = (kind, id, index) => `${prefix}${kind}:${index}:${encodeURIComponent(stamp(id))}`;
    return `<p>${own(this.draft, 'floors') ? malformed ? 'The saved floor choices are malformed. Reset the floor choices deliberately, or Cancel to keep them.' : 'Explicit floor order is saved with these settings.' : 'Using all current floors in elevation order. Changing the list creates an explicit saved order.'}</p>
      <ol class="floor-presentation-list">${rows.map((id, index) => {
    const floor = this._floor(id), choices = this._choices().filter(([choice]) => choice === id || !rows.includes(choice));
    return `<li data-floor-presentation-row="${index}"><strong data-floor-presentation-floor-label>${esc(floor?.name || valueLabel(id))}</strong>
          <span class="floor-presentation-id">Exact ID: ${esc(valueLabel(id))}</span><p>${esc(this._rowMessage(id))}</p>
          <label>Replace this floor<select data-field="${prefix}floor" data-floor-index="${index}" data-floor-key="${esc(stamp(id))}" ${disabled}>${this._options(choices, id, 'Choose a current floor')}</select></label>
          <div class="floor-presentation-actions"><button type="button" data-act="${esc(action('up', id, index))}" ${blocked || index === 0 ? 'disabled' : ''} aria-label="Move ${esc(valueLabel(id))} up">Up</button>
          <button type="button" data-act="${esc(action('down', id, index))}" ${blocked || index === rows.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(valueLabel(id))} down">Down</button>
          <button type="button" data-act="${esc(action('remove', id, index))}" ${disabled} aria-label="Remove ${esc(valueLabel(id))} from display choices">Remove</button></div></li>`;
  }).join('')}</ol>
      <label>Add a current floor<select data-field="${prefix}add-floor" ${blocked || malformed || !this._choices().some(([id]) => !rows.includes(id)) ? 'disabled' : ''}><option value="">Choose a floor to add</option>${this._choices().filter(([id]) => !rows.includes(id)).map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('')}</select></label>
      <div class="floor-presentation-actions"><button type="button" data-act="${prefix}all-floors" ${disabled}>Use all current floors</button><button type="button" data-act="${prefix}clear-floors" ${disabled}>Clear floor choices</button></div>`;
  }
  render() {
    if (this.disposed) return '';
    this._ensure(); const disabled = this._blocked() ? 'disabled' : '';
    const input = (field, label, attributes) => `<label>${label}<input data-field="${prefix}${field}" ${attributes} value="${esc(this._value(field))}" ${disabled}></label>`;
    return `<section data-floor-presentation-editor data-taylors3d-ui="floor-presentation-editor"><style>
      [data-floor-presentation-editor]{color:var(--primary-text-color,#212121);margin-bottom:20px;min-width:0}
      [data-floor-presentation-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0;overflow-wrap:anywhere}
      [data-floor-presentation-editor] input,[data-floor-presentation-editor] select,[data-floor-presentation-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-floor-presentation-editor] input,[data-floor-presentation-editor] select{width:100%;min-width:0}
      [data-floor-presentation-editor] button{cursor:pointer}[data-floor-presentation-editor] :disabled{opacity:.6;cursor:default}
      [data-floor-presentation-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}
      [data-floor-presentation-editor] .floor-presentation-actions{display:flex;gap:7px;flex-wrap:wrap}
      [data-floor-presentation-editor] .floor-presentation-list{padding-left:24px}[data-floor-presentation-editor] li{margin:14px 0}
      [data-floor-presentation-editor] p,[data-floor-presentation-editor] li,[data-floor-presentation-editor] strong{overflow-wrap:anywhere}
      [data-floor-presentation-editor] .floor-presentation-id{display:block;overflow-wrap:anywhere}
      [data-floor-presentation-editor] .floor-presentation-hint{color:var(--secondary-text-color,#666)}
      </style><h3>Floor presentation</h3><p>Choose a display arrangement for the floors. Real floor coordinates stay unchanged.</p>
      <label>Floor view<select data-field="${prefix}mode" ${disabled}>${this._options(modes, this._raw('mode'))}</select></label>
      ${input('gap_m', 'Additional spacing, metres', 'type="number" min="0" max="100" step="any"')}
      <label>Side-by-side direction<select data-field="${prefix}axis" ${disabled}>${this._options(axes, this._raw('axis'))}</select></label>
      ${input('base_elevation_m', 'Side-by-side display height, metres', 'type="number" min="-1000" max="1000" step="any"')}
      <p class="floor-presentation-hint">Side by side puts the chosen floors at one display height and spreads their measured footprints East or North. Stacked layers keep their saved elevations and add space between layers. Normal restores the assembled display. At most four floors can be separated.</p>
      <h4>Floors and order</h4><div data-floor-presentation-floors>${this._floorsHtml()}</div>
      <div data-floor-presentation-status aria-live="polite">${this._statusHtml()}</div>
      <div class="floor-presentation-actions"><button type="button" data-act="${prefix}save" ${!this.dirty || this._evaluation().issues.length ? 'disabled' : ''}>Save floor view</button><button type="button" data-act="${prefix}cancel">Cancel</button><button type="button" data-act="${prefix}repair" ${!this.canEdit || this.stale ? 'disabled' : ''}>Use normal default settings</button></div>
      <h4>Current geometry checks</h4><div data-floor-presentation-report>${this._reportHtml()}</div></section>`;
  }
  _refreshFloors(target) {
    if (!target) return;
    const rows = this._rows(), key = stamp([own(this.draft, 'floors'), this.draft?.floors, rows]);
    // Only deliberate list/order changes replace rows. Actual HA diagnostics or
    // names update inside the same native selects, retaining focus and identity.
    if (target._floorRowsKey !== key) { target.innerHTML = this._floorsHtml(); target._floorRowsKey = key; }
    const blocked = this._blocked(), malformed = own(this.draft, 'floors') && !Array.isArray(this.draft.floors);
    const syncOptions = (control, html) => { if (control && control._floorOptionsHtml !== html) {
      control.innerHTML = html; control._floorOptionsHtml = html;
    } };
    for (const row of target.querySelectorAll('[data-floor-presentation-row]')) {
      const index = Number(row.dataset.floorPresentationRow), id = rows[index], floor = this._floor(id);
      row.querySelector('[data-floor-presentation-floor-label]').textContent = floor?.name || valueLabel(id);
      row.querySelector('p').textContent = this._rowMessage(id);
      const select = row.querySelector('select');
      select.disabled = blocked;
      syncOptions(select, this._options(this._choices().filter(([choice]) => choice === id || !rows.includes(choice)), id, 'Choose a current floor'));
      for (const button of row.querySelectorAll('button')) button.disabled = blocked
        || button.dataset.act.startsWith(`${prefix}up:`) && index === 0
        || button.dataset.act.startsWith(`${prefix}down:`) && index === rows.length - 1;
    }
    const add = target.querySelector(`[data-field="${prefix}add-floor"]`), choices = this._choices().filter(([id]) => !rows.includes(id));
    if (add) {
      add.disabled = blocked || malformed || !choices.length;
      syncOptions(add, `<option value="">Choose a floor to add</option>${choices.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('')}`);
    }
    for (const button of target.querySelectorAll(`[data-act="${prefix}all-floors"],[data-act="${prefix}clear-floors"]`)) button.disabled = blocked;
  }
  updatePreviews(container) {
    if (this.disposed || !container) return;
    this._ensure();
    const root = container.matches?.('[data-floor-presentation-editor]') ? container : container.querySelector('[data-floor-presentation-editor]');
    if (!root) return;
    for (const [selector, html] of [['[data-floor-presentation-status]', this._statusHtml()], ['[data-floor-presentation-report]', this._reportHtml()]]) {
      const target = root.querySelector(selector); if (target && target.innerHTML !== html) target.innerHTML = html;
    }
    this._refreshFloors(root.querySelector('[data-floor-presentation-floors]'));
    for (const field of ['mode', 'axis', 'gap_m', 'base_elevation_m']) {
      const control = root.querySelector(`[data-field="${prefix}${field}"]`); if (!control) continue;
      control.disabled = this._blocked();
      if (!this.dirty) {
        if (control.tagName === 'SELECT') { const html = this._options(field === 'mode' ? modes : axes, this._raw(field)); if (control.innerHTML !== html) control.innerHTML = html; }
        else control.value = this._value(field);
      }
    }
    const save = root.querySelector(`[data-act="${prefix}save"]`); if (save) save.disabled = !this.dirty || this._evaluation().issues.length > 0;
    const repair = root.querySelector(`[data-act="${prefix}repair"]`); if (repair) repair.disabled = !this.canEdit || this.stale;
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith(prefix) || !element) return false;
    this._ensure(); if (this._blocked()) return true;
    const key = field.slice(prefix.length);
    if (['mode', 'axis', 'gap_m', 'base_elevation_m'].includes(key)) {
      this.draft[key] = ['gap_m', 'base_elevation_m'].includes(key) ? number(element.value) : element.value;
      this._mark(); this.updatePreviews(element.closest?.('[data-floor-presentation-editor]')); return true;
    }
    if (key !== 'floor' && key !== 'add-floor') return false;
    if (!this._floor(element.value)) return true;
    const rows = this._rows();
    if (key === 'floor') {
      const index = Number(element.dataset?.floorIndex);
      if (!Number.isInteger(index) || index < 0 || index >= rows.length || element.dataset?.floorKey !== stamp(rows[index])) return true;
      if (rows.some((id, position) => id === element.value && position !== index)) return true;
      rows[index] = element.value;
    } else {
      if (own(this.draft, 'floors') && !Array.isArray(this.draft.floors) || rows.includes(element.value)) return true;
      rows.push(element.value);
    }
    this.draft.floors = rows; this._mark(); this.onRender(); return true;
  }
  onInput(field, element) { return this.onChange(field, element); }
  onClick(action) {
    if (this.disposed || !action?.startsWith(prefix)) return false;
    this._ensure(); const key = action.slice(prefix.length);
    if (key === 'cancel') { this.reset(); this.onRender(); return true; }
    if (key === 'repair') {
      if (!this.canEdit || this.stale) return true;
      const extensions = plain(this.draft) ? Object.fromEntries(Object.entries(this.draft).filter(([field]) => !fields.has(field))) : {};
      this.draft = { ...extensions, mode: 'assembled', gap_m: 2, axis: 'east', base_elevation_m: 0 };
      this._mark(); this.onRender(); return true;
    }
    if (key === 'save') {
      const { issues } = this._evaluation();
      if (!this.dirty || issues.length || typeof this.card.commitFeatureLayout !== 'function') {
        this.message = issues[0] || 'Choose a different setting before saving.'; this.onRender(); return true;
      }
      this.card.commitFeatureLayout({ floor_presentation: clone(this.draft) }, 'Floor presentation');
      this.reset(); this.onRender(); return true;
    }
    if (this._blocked()) return true;
    if (key === 'all-floors' || key === 'clear-floors') {
      if (key === 'all-floors') delete this.draft.floors; else this.draft.floors = [];
      this._mark(); this.onRender(); return true;
    }
    const match = /^(up|down|remove):(\d+):(.+)$/.exec(key);
    if (!match) return false;
    const index = Number(match[2]), rows = this._rows(); let intent;
    try { intent = decodeURIComponent(match[3]); } catch { return true; }
    if (index >= rows.length || stamp(rows[index]) !== intent) return true;
    if (match[1] === 'remove') rows.splice(index, 1);
    else {
      const target = index + (match[1] === 'up' ? -1 : 1); if (target < 0 || target >= rows.length) return true;
      [rows[index], rows[target]] = [rows[target], rows[index]];
    }
    this.draft.floors = rows; this._mark(); this.onRender(); return true;
  }
  reset() { this._loaded = false; this.draft = null; this.dirty = false; this.stale = false; this.message = null; }
  cancel() { this.reset(); }
  dispose() { this.reset(); this.disposed = true; }
}
