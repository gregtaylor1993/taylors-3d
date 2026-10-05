// Standalone future EditMode fragment. Only Save commits shared display settings.
// No material writes, camera movement, renderer, timers or Home Assistant actions.
import { WALL_PRESENTATION_DEFAULTS, WALL_PRESENTATION_LIMITS, exactWallSelector, readWallPresentation, wallTargetReport } from './wall-presentation.js';

const prefix = 'wall-presentation-';
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const own = (value, key) => plain(value) && Object.hasOwn(value, key);
const number = (value) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : '';
const modes = [['normal', 'Normal'], ['fade', 'Fade'], ['cutaway', 'Cut-away'], ['glass', 'Glass look']];
const scopes = [['camera_side', 'Camera side'], ['all_selected', 'All selected walls']];
const globalFields = new Set(['enabled', 'mode', 'scope', 'opacity', 'transition_ms', 'cut_height_m']);
const extras = (value, fields) => plain(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => !fields.has(key))) : {};
let tokenNumber = 0;

/** WallPresentationEditor(card,onRender,{onBeginPick?,onCancelPick?}) exposes the
 * usual render/onClick/onChange/onInput/updatePreviews/reset/cancel/dispose API.
 * pendingSurfacePick is a pure getter; receiveSurfacePick takes the exact token,
 * selector, label, node-local face, floor_id and modelRoot from an actual mesh hit.
 * View owns candidates/report and root owns the optional clean-only preparatory
 * reload. Native wall-presentation-* fields must survive ordinary HA updates.
 * This standalone fragment is not yet connected to EditMode or a live renderer.
 */
export class WallPresentationEditor {
  constructor(card, onRender = () => {}, { onBeginPick, onCancelPick, onCancelPrepare } = {}) {
    this.card = card; this.onRender = onRender;
    this.onBeginPick = onBeginPick; this.onCancelPick = onCancelPick; this.onCancelPrepare = onCancelPrepare;
    this.draft = null; this.dirty = false; this.stale = false; this.disposed = false;
    this._loaded = false; this._pending = null; this._epoch = 0; this._changedTargets = new Map();
    this.selectedIndex = -1; this.repairIndex = -1; this.preparing = false; this.message = null;
  }
  get effective() { return this.card._layout?.wall_presentation ?? this.card._config?.wall_presentation; }
  get modelRoot() { return this.card._view?.model?.root ?? null; }
  get pendingSurfacePick() { return this._pending ? { token: this._pending.token, modelRoot: this._pending.modelRoot,
    contextKey: this._pending.context.key, selector: this._pending.selector, floor_id: this._pending.floor_id } : null; }
  _context() {
    const config = this.card._config || {}, layout = this.card._layout || {}, user = this.card._hass?.user;
    return { root: this.modelRoot, key: JSON.stringify([config.layout_key,
      config.model ? config.model : layout.model ?? null, config.model_position, config.model_rotation,
      config.model_scale, this.card._modelAlign?.() ?? null, layout.floors,
      this._floors().map((floor) => [floor?.id, floor?.name, floor?.elevation]),
      user?.id ?? null, user?.is_admin === true, !!user && Object.hasOwn(user, 'is_active'), user?.is_active ?? null]), value: JSON.stringify(this.effective) };
  }
  _same(a, b, ignoreRoot = false) { return !!a && !!b && (ignoreRoot || a.root === b.root) && a.key === b.key && a.value === b.value; }
  _load() {
    this._cancelPending(); this.base = this._context();
    this.draft = this.effective === undefined ? {} : clone(this.effective);
    this.dirty = false; this.stale = false; this.message = null; this.repairIndex = -1;
    this._changedTargets.clear(); this.selectedIndex = this._rows().length ? 0 : -1; this._loaded = true;
  }
  _ensure() {
    const context = this._context();
    if (!this._loaded || !this.dirty && !this._same(this.base, context)) this._load();
    else if (this.dirty && !this._same(this.base, context)) { this.stale = true; this._cancelPending(); }
    if (this._pending && (!this._same(this._pending.context, context)
      || this._pending.index !== this.selectedIndex || this._readOnly()
      || !this._candidates().prepared
      || !this._pending.allowRelink && !this._candidate(this._pending.selector))) this._cancelPending();
  }
  get canEdit() {
    const user = this.card._hass?.user;
    return !this.disposed && user?.is_admin === true && typeof user.id === 'string' && user.id.trim().length > 0
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true);
  }
  _readOnly() { return !this.canEdit; }
  _blocked() { return this._readOnly() || this.stale || this.preparing || !plain(this.draft); }
  _rows() { return Array.isArray(this.draft?.walls) ? this.draft.walls : []; }
  _floors() { return Array.isArray(this.card._floors) ? this.card._floors : Array.isArray(this.card._layout?.floors) ? this.card._layout.floors : []; }
  _floor(id) {
    const matches = this._floors().filter((floor) => floor?.id === id);
    return matches.length === 1 && typeof matches[0].elevation === 'number' && Number.isFinite(matches[0].elevation) ? matches[0] : null;
  }
  _candidates() {
    try {
      const report = this.card._view?.wallPresentationCandidates?.();
      return { rows: Array.isArray(report?.rows) ? report.rows : [], prepared: report?.prepared === true,
        diagnostics: Array.isArray(report?.diagnostics) ? report.diagnostics : [], available: !!report };
    } catch { return { rows: [], prepared: false, diagnostics: [{ message: 'Wall choices could not be read from this model.' }], available: false }; }
  }
  _candidate(selector, report = this._candidates()) {
    const matches = report.rows.filter((row) => row?.selector === selector);
    if (matches.length !== 1 || matches[0].selectable !== true || !exactWallSelector(selector)) return null;
    const candidate = matches[0];
    // Recheck the actual current mesh: a stale UI choice must not authorize a
    // group, merged part or replaced root, even when an old candidate says yes.
    const current = wallTargetReport({ scope: 'all_selected', walls: [{ id: 'candidate', selector }] }, {
      index: { nodes: [{ path: selector.slice(5), node: candidate.node }] }, modelRoot: this.modelRoot,
    }).rows[0];
    return current?.ready ? candidate : null;
  }
  _meshChoices(report, row) {
    // Configured exact walls may remain separate while unrelated geometry is
    // merged. Their labels/floors stay editable; new choices still need the
    // explicit preparation step before a selector or face can be recorded.
    return report.rows.map((entry) => [entry.selector, entry.label || entry.selector,
      (report.prepared || entry.selector === row?.selector) && !!this._candidate(entry.selector, report)]);
  }
  _missing(row) { return !!row?.selector && (!this._candidate(row.selector) || row.floor_id !== undefined && !this._floor(row.floor_id)); }
  _editableRow(row, index = this.selectedIndex) {
    return !this._blocked() && plain(row) && (!this._missing(row) || this.repairIndex === index);
  }
  _raw(field) { return own(this.draft, field) ? this.draft[field] : WALL_PRESENTATION_DEFAULTS[field]; }
  _value(field) {
    const raw = this._raw(field);
    if (field === 'opacity') return typeof raw === 'number' && Number.isFinite(raw) ? String(Math.round(raw * 1000000) / 10000) : '';
    return ['number', 'string'].includes(typeof raw) ? String(raw) : '';
  }
  _mark() { this.dirty = JSON.stringify(this.draft) !== this.base.value; this.message = null; }
  _evaluation() {
    const policy = readWallPresentation(this.draft), issues = policy.diagnostics.map((entry) => entry.message);
    if (this._readOnly()) issues.push('A current active administrator account is required to edit or save wall settings.');
    if (this.stale) issues.push('The saved settings, model, alignment, floors or user changed. Your draft is kept. Cancel before saving.');
    if (this.preparing) issues.push('Wait for the separate wall meshes to finish loading.');
    if (this._pending) issues.push('Choose the wall face or cancel surface selection before saving.');
    for (const [index, selector] of this._changedTargets) {
      const row = this._rows()[index];
      if (row?.selector === selector && row.enabled !== false && !this._candidate(selector))
        issues.push('A newly selected wall mesh is no longer available. Relink it, disable it, or Cancel.');
    }
    return { policy, issues: [...new Set(issues)] };
  }
  _reportHtml() {
    const candidates = this._candidates();
    let report;
    try { report = this.card._view?.wallPresentationReport?.(); } catch { report = null; }
    return `<p>${this.modelRoot ? `${candidates.rows.filter((row) => this._candidate(row.selector, candidates)).length} exact selectable mesh choices in the loaded model.` : 'No model is loaded. Wall effects need separately selectable wall meshes.'}</p>
      ${!candidates.available ? '<p>Wall selection is not connected in this standalone draft.</p>' : !candidates.prepared ? '<p>Original wall meshes need preparation before choosing them. A merged mesh can contain floors or furniture and cannot safely be treated as one wall.</p>' : ''}
      ${[...candidates.diagnostics, ...(Array.isArray(report?.diagnostics) ? report.diagnostics : [])].length ? `<ul>${[...candidates.diagnostics, ...(Array.isArray(report?.diagnostics) ? report.diagnostics : [])].map((entry) => `<li>${esc(entry.message)}</li>`).join('')}</ul>` : ''}`;
  }
  _statusHtml() {
    const saved = readWallPresentation(this.effective), { issues } = this._evaluation();
    return `<p>Currently saved: <strong>${saved.valid ? !saved.enabled || saved.mode === 'normal' ? 'Normal appearance' : modes.find(([value]) => value === saved.mode)?.[1] : 'Invalid settings; wall effects disabled'}</strong>.</p>
      ${this.dirty ? '<p>Unsaved wall settings. Save to apply them.</p>' : ''}
      ${this._pending ? '<p>Choose a face on the actual wall mesh. Surface selection is a draft; it sends no device action.</p>' : ''}
      ${this.preparing ? '<p>Preparing separate meshes…</p>' : ''}
      ${this.message ? `<p role="status">${esc(this.message)}</p>` : ''}
      ${issues.length ? `<ul role="status">${issues.map((message) => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}`;
  }
  _rowStatus(row) {
    if (!plain(row)) return 'This saved wall row is malformed. Remove it deliberately, then add a new choice.';
    const missing = this._missing(row), candidate = this._candidate(row.selector);
    const face = readWallPresentation({ scope: 'camera_side', walls: [row] }).walls[0]?.face;
    return `${missing ? 'Saved mesh or floor is unavailable. Its reference is kept; Relink or Remove is deliberate.' : candidate ? 'Exact current rigid mesh selected.' : 'Choose one exact mesh.'} ${face ? 'A mesh-local face is saved. The chosen normal defines the camera side.' : 'No usable wall face is saved. Camera-side mode needs an actual face selection.'}`;
  }
  _selectHtml(field, values, raw, disabled, attributes = '') {
    const extra = values.some(([value]) => value === raw) ? '' : `<option value="" disabled selected>${esc(raw === undefined || raw === '' ? 'Choose a value' : `Saved value unavailable: ${String(raw)}`)}</option>`;
    return `<select data-field="${prefix}${field}" ${attributes} ${disabled}>${extra}${values.map(([value, label, enabled = true]) => `<option value="${esc(value)}" ${value === raw ? 'selected' : ''} ${enabled ? '' : 'disabled'}>${esc(label)}</option>`).join('')}</select>`;
  }
  _wallHtml() {
    const rows = this._rows(), index = this.selectedIndex, row = rows[index], blocked = this._blocked();
    const wallList = rows.map((entry, position) => [String(position), `${entry?.label || entry?.id || `Wall ${position + 1}`}${entry?.enabled === false ? ' (disabled)' : ''}`]);
    const selected = rows.length ? `<label>Saved wall${this._selectHtml('selected', wallList, String(index), blocked ? 'disabled' : '')}</label>` : '<p>No wall meshes are saved. Add only meshes you deliberately identify as walls.</p>';
    const common = `<div class="wall-presentation-actions"><button type="button" data-act="${prefix}add" ${blocked || own(this.draft, 'walls') && !Array.isArray(this.draft.walls) || rows.length >= WALL_PRESENTATION_LIMITS.maxWalls ? 'disabled' : ''}>Add wall</button></div>`;
    if (!rows.length) return selected + common;
    const attributes = `data-wall-index="${index}" data-wall-id="${esc(row?.id)}"`, editable = this._editableRow(row), disabled = editable ? '' : 'disabled';
    const candidates = this._candidates();
    const choices = this._meshChoices(candidates, row);
    const targetDisabled = blocked || !plain(row) || row.selector && this.repairIndex !== index ? 'disabled' : '';
    const floors = this._floors().filter((floor) => this._floor(floor?.id)).map((floor) => [floor.id, floor.name || floor.id]);
    return `${selected}${common}<h4>Selected wall</h4><p data-wall-presentation-row-status>${esc(this._rowStatus(row))}</p>
      <p class="wall-presentation-path" data-wall-presentation-path>Saved exact mesh: ${esc(row?.selector || 'not selected')}</p>
      <label>Wall label<input type="text" maxlength="128" data-field="${prefix}wall.label" ${attributes} value="${esc(row?.label)}" ${disabled}></label>
      <label>Saved wall ID<input type="text" maxlength="64" data-field="${prefix}wall.id" ${attributes} value="${esc(row?.id)}" ${disabled}></label>
      <label class="wall-presentation-check"><input type="checkbox" data-field="${prefix}wall.enabled" ${attributes} ${row?.enabled !== false ? 'checked' : ''} ${blocked || !plain(row) ? 'disabled' : ''}>Enable this wall</label>
      <label>Exact wall mesh${this._selectHtml('wall.selector', choices, row?.selector, targetDisabled, attributes)}</label>
      <label>Explicit floor for this wall${this._selectHtml('wall.floor_id', [['', 'No floor chosen'], ...floors], row?.floor_id ?? '', disabled, attributes)}</label>
      <p class="wall-presentation-hint">The floor is required for Cut-away. Mesh selection does not guess a floor or a wall from its name. Relinking a mesh clears the previous face and floor.</p>
      <div class="wall-presentation-actions"><button type="button" data-act="${prefix}pick" ${blocked || !plain(row) || this._missing(row) && this.repairIndex !== index || !this._candidates().prepared || typeof this.onBeginPick !== 'function' ? 'disabled' : ''}>Choose wall face</button>
      <button type="button" data-act="${prefix}cancel-pick" ${!this._pending ? 'disabled' : ''}>Cancel surface selection</button>
      <button type="button" data-act="${prefix}relink" ${blocked || !plain(row) ? 'disabled' : ''}>Relink wall</button><button type="button" data-act="${prefix}remove" ${blocked ? 'disabled' : ''}>Remove wall</button></div>
      ${typeof this.onBeginPick !== 'function' ? '<p>Canvas surface selection is not connected yet. Static All selected walls can use an exact mesh choice; Camera side needs a captured face.</p>' : ''}`;
  }
  render() {
    if (this.disposed) return '';
    this._ensure(); const disabled = this._blocked() ? 'disabled' : '';
    const input = (field, label, attributes) => `<label>${label}<input data-field="${prefix}${field}" ${attributes} value="${esc(this._value(field))}" ${disabled}></label>`;
    return `<section data-wall-presentation-editor data-taylors3d-ui="wall-presentation-editor"><style>
      [data-wall-presentation-editor]{color:var(--primary-text-color,#212121);margin-bottom:20px}
      [data-wall-presentation-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0;overflow-wrap:anywhere}
      [data-wall-presentation-editor] input,[data-wall-presentation-editor] select,[data-wall-presentation-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-wall-presentation-editor] input:not([type=checkbox]),[data-wall-presentation-editor] select{width:100%;min-width:0}
      [data-wall-presentation-editor] .wall-presentation-check{flex-direction:row;align-items:center;min-height:44px}[data-wall-presentation-editor] input[type=checkbox]{flex:0 0 44px;width:44px;min-height:44px;margin:0 4px 0 0}
      [data-wall-presentation-editor] .wall-presentation-actions{display:flex;gap:7px;flex-wrap:wrap}[data-wall-presentation-editor] button{cursor:pointer}[data-wall-presentation-editor] :disabled{opacity:.6;cursor:default}
      [data-wall-presentation-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}
      [data-wall-presentation-editor] p,[data-wall-presentation-editor] li{overflow-wrap:anywhere}[data-wall-presentation-editor] .wall-presentation-hint{color:var(--secondary-text-color,#666)}
      </style><h3>Wall presentation</h3><p>See into a model by changing only the exact wall meshes you choose. Settings stay drafts until Save.</p>
      <label class="wall-presentation-check"><input type="checkbox" data-field="${prefix}enabled" ${this._raw('enabled') === true ? 'checked' : ''} ${disabled}>Enable wall presentation</label>
      <label>Appearance${this._selectHtml('mode', modes, this._raw('mode'), disabled)}</label>
      <label>Which selected walls change${this._selectHtml('scope', scopes, this._raw('scope'), disabled)}</label>
      ${input('opacity', 'Fade or glass opacity, percent', 'type="number" min="0" max="100" step="1"')}
      ${input('transition_ms', 'Fade transition, milliseconds', 'type="number" min="0" max="1000" step="1"')}
      ${input('cut_height_m', 'Cut-away height above the chosen floor, metres', 'type="number" min="0" max="1000" step="0.1"')}
      <p class="wall-presentation-hint">Normal restores the authored appearance. Fade and Glass look use transparency; Glass look does not add physical glass or refraction. Cut-away removes the selected wall above an explicit floor height. Camera side uses your selected face normal; All selected walls is static. Reduced motion must use immediate changes.</p>
      <div data-wall-presentation-status aria-live="polite">${this._statusHtml()}</div>
      <div class="wall-presentation-actions"><button type="button" data-act="${prefix}save" ${!this.dirty || this._evaluation().issues.length ? 'disabled' : ''}>Save wall settings</button><button type="button" data-act="${prefix}cancel">Cancel</button>
      <button type="button" data-act="${prefix}repair" ${this._readOnly() || this.stale || this.preparing ? 'disabled' : ''}>Use default display values (keep wall rows)</button>
      ${own(this.draft, 'walls') && !Array.isArray(this.draft.walls) ? `<button type="button" data-act="${prefix}repair-list" ${this._blocked() ? 'disabled' : ''}>Clear invalid wall list</button>` : ''}</div>
      <h4>Wall meshes</h4><div data-wall-presentation-walls data-wall-form-key="${esc(this._formKey())}">${this._wallHtml()}</div>
      <div data-wall-presentation-report>${this._reportHtml()}</div>
      <button type="button" data-act="${prefix}prepare" ${this._readOnly() || this.stale || this.preparing || this.dirty || !!this._pending || typeof this.card.prepareWallSelection !== 'function' ? 'disabled' : ''}>Prepare separate wall meshes</button>
      <p class="wall-presentation-hint">Preparation is an explicit model reload, not Save. Cancel unsaved changes first. ${typeof this.card.prepareWallSelection !== 'function' ? 'The preparation action is not connected yet.' : 'It must preserve the original mesh paths before model merging.'}</p>
      </section>`;
  }
  _syncSelect(select, choices, raw) {
    const html = this._selectHtml('', choices, raw, '');
    const options = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</select>'));
    if (select.innerHTML !== options) select.innerHTML = options;
    select.value = choices.some(([value]) => value === raw) ? raw : '';
  }
  _formKey() { return JSON.stringify([this._rows().length, this.selectedIndex, this._rows()[this.selectedIndex]?.id]); }
  updatePreviews(container) {
    if (this.disposed || !container) return;
    this._ensure(); const root = container.matches?.('[data-wall-presentation-editor]') ? container : container.querySelector('[data-wall-presentation-editor]');
    if (!root) return;
    const walls = root.querySelector('[data-wall-presentation-walls]');
    if (walls && !this.dirty && walls.dataset.wallFormKey !== this._formKey()) {
      walls.innerHTML = this._wallHtml(); walls.dataset.wallFormKey = this._formKey();
    }
    for (const [selector, html] of [['[data-wall-presentation-status]', this._statusHtml()], ['[data-wall-presentation-report]', this._reportHtml()]]) {
      const target = root.querySelector(selector); if (target && target.innerHTML !== html) target.innerHTML = html;
    }
    const row = this._rows()[this.selectedIndex], editable = this._editableRow(row), blocked = this._blocked();
    const rowStatus = root.querySelector('[data-wall-presentation-row-status]'); if (rowStatus) rowStatus.textContent = this._rowStatus(row);
    const path = root.querySelector('[data-wall-presentation-path]'); if (path) path.textContent = `Saved exact mesh: ${row?.selector || 'not selected'}`;
    for (const control of root.querySelectorAll('[data-field]')) {
      const field = control.dataset.field.slice(prefix.length);
      control.disabled = blocked;
      if (field.startsWith('wall.')) {
        const key = field.slice(5); control.disabled = key === 'enabled' ? blocked || !plain(row) : !editable;
        if (key === 'selector') {
          control.disabled = blocked || !plain(row) || !!row.selector && this.repairIndex !== this.selectedIndex;
          const candidates = this._candidates();
          this._syncSelect(control, this._meshChoices(candidates, row), row?.selector);
        } else if (key === 'floor_id') this._syncSelect(control, [['', 'No floor chosen'], ...this._floors().filter((floor) => this._floor(floor?.id)).map((floor) => [floor.id, floor.name || floor.id])], row?.floor_id ?? '');
        else if (control.type === 'checkbox') { control.checked = !own(row, key) || row[key] === true; control.indeterminate = own(row, key) && typeof row[key] !== 'boolean'; }
        else if (!this.dirty) control.value = String(row?.[key] ?? '');
      } else if (field === 'selected') {
        control.disabled = blocked;
        this._syncSelect(control, this._rows().map((entry, index) => [String(index), `${entry?.label || entry?.id || `Wall ${index + 1}`}${entry?.enabled === false ? ' (disabled)' : ''}`]), String(this.selectedIndex));
      }
      else if (control.type === 'checkbox') { control.checked = this._raw(field) === true; control.indeterminate = typeof this._raw(field) !== 'boolean'; }
      else if (!this.dirty) {
        if (field === 'mode' || field === 'scope') this._syncSelect(control, field === 'mode' ? modes : scopes, this._raw(field));
        else control.value = this._value(field);
      }
    }
    const set = (action, value) => { const button = root.querySelector(`[data-act="${prefix}${action}"]`); if (button) button.disabled = value; };
    set('save', !this.dirty || this._evaluation().issues.length > 0);
    set('add', blocked || own(this.draft, 'walls') && !Array.isArray(this.draft.walls) || this._rows().length >= WALL_PRESENTATION_LIMITS.maxWalls);
    set('pick', blocked || !plain(row) || this._missing(row) && this.repairIndex !== this.selectedIndex || !this._candidates().prepared || typeof this.onBeginPick !== 'function');
    set('cancel-pick', !this._pending); set('relink', blocked || !plain(row)); set('remove', blocked);
    set('prepare', this._readOnly() || this.stale || this.preparing || this.dirty || !!this._pending || typeof this.card.prepareWallSelection !== 'function');
    set('repair', this._readOnly() || this.stale || this.preparing);
  }
  _eventRow(element) {
    const row = this._rows()[this.selectedIndex];
    return element?.dataset?.wallIndex === String(this.selectedIndex) && element.dataset.wallId === String(row?.id ?? '') ? row : null;
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith(prefix) || !element) return false;
    this._ensure(); const name = field.slice(prefix.length);
    if (this._blocked()) return true;
    if (name === 'selected') {
      const index = Number(element.value);
      if (Number.isInteger(index) && index >= 0 && index < this._rows().length) { this._cancelPending(); this.selectedIndex = index; this.repairIndex = -1; this.onRender(); }
      return true;
    }
    if (globalFields.has(name)) {
      this._cancelPending(); let value = element.value;
      if (name === 'enabled') value = element.checked === true;
      else if (['opacity', 'transition_ms', 'cut_height_m'].includes(name)) { value = number(value); if (name === 'opacity' && typeof value === 'number') value /= 100; }
      this.draft[name] = value; this._mark(); this.updatePreviews(element.closest?.('[data-wall-presentation-editor]')); return true;
    }
    if (!name.startsWith('wall.')) return false;
    const row = this._eventRow(element), key = name.slice(5);
    if (!plain(row) || !['label', 'id', 'enabled', 'selector', 'floor_id'].includes(key)) return true;
    if (key !== 'enabled' && !this._editableRow(row)) return true;
    this._cancelPending();
    if (key === 'selector') {
      if (!this._candidates().prepared || row.selector && this.repairIndex !== this.selectedIndex || !this._candidate(element.value)) return true;
      if (row.selector !== element.value) { row.selector = element.value; delete row.face; delete row.floor_id; }
      this._changedTargets.set(this.selectedIndex, row.selector); this.repairIndex = -1; this._mark(); this.onRender(); return true;
    }
    if (key === 'floor_id') {
      if (element.value && !this._floor(element.value)) return true;
      if (element.value) row.floor_id = element.value; else delete row.floor_id;
    } else row[key] = key === 'enabled' ? element.checked === true : element.value;
    this._mark();
    // ID changes are a deliberate identity edit; replace only the event stamp,
    // never the focused native input itself.
    if (key === 'id') for (const control of element.closest?.('[data-wall-presentation-editor]')?.querySelectorAll('[data-wall-index]') || []) control.dataset.wallId = String(row.id);
    this.updatePreviews(element.closest?.('[data-wall-presentation-editor]')); return true;
  }
  onInput(field, element) { return this.onChange(field, element); }
  _cancelPending() {
    const pending = this._pending; this._pending = null;
    if (pending) this.onCancelPick?.(pending.token);
  }
  cancelSurfacePick() { this._cancelPending(); }
  syncSurfacePick() { if (!this.disposed) this._ensure(); return this.pendingSurfacePick; }
  _beginPick() {
    const row = this._rows()[this.selectedIndex], candidates = this._candidates();
    if (this._blocked() || !plain(row) || this._missing(row) && this.repairIndex !== this.selectedIndex || !candidates.prepared || typeof this.onBeginPick !== 'function') { this.message = 'Surface selection needs a current separately selectable model and the connected canvas picker. Relink an unavailable wall deliberately.'; return; }
    this._cancelPending(); const token = `wall-surface-${++tokenNumber}`;
    this._pending = { token, index: this.selectedIndex, id: row.id, selector: row.selector,
      floor_id: row.floor_id, modelRoot: this.modelRoot, context: this._context(), allowRelink: !row.selector || this.repairIndex === this.selectedIndex };
    try { if (this.onBeginPick(this.pendingSurfacePick) === false) { this._cancelPending(); this.message = 'The canvas could not begin wall selection.'; } }
    catch { this._cancelPending(); this.message = 'The canvas could not begin wall selection.'; }
  }
  receiveSurfacePick({ token, selector, label, face, floor_id, modelRoot } = {}) {
    if (this.disposed) return false;
    this._ensure(); const pending = this._pending, row = this._rows()[this.selectedIndex];
    if (!pending || !this._candidates().prepared || token !== pending.token || modelRoot !== pending.modelRoot || modelRoot !== this.modelRoot
      || !this._same(pending.context, this._context()) || this._blocked() || !plain(row) || row.id !== pending.id) return false;
    const candidate = this._candidate(selector);
    if (!pending.allowRelink && selector !== pending.selector) { this.message = 'Choose the saved wall mesh, or Cancel and Relink to choose a different mesh.'; return false; }
    if (!candidate || floor_id !== undefined && !this._floor(floor_id)) { this.message = 'Choose a current exact rigid wall mesh and an existing floor. The previous draft is kept.'; return false; }
    const proposed = { ...row, selector, face: clone(face) };
    if (floor_id !== undefined) proposed.floor_id = floor_id;
    else if (selector !== row.selector) delete proposed.floor_id;
    if (!proposed.label && typeof label === 'string') proposed.label = label;
    const parsed = readWallPresentation({ mode: this._raw('mode'), scope: 'camera_side', walls: [proposed] });
    if (!parsed.valid || !parsed.walls[0]?.face) { this.message = parsed.diagnostics[0]?.message || 'Choose an actual finite mesh-local triangle face.'; return false; }
    // Preserve face extensions on a recapture of the same mesh. A deliberate
    // replacement clears the previous mesh's face, including its old context.
    if (selector === row.selector && plain(row.face)) proposed.face = { ...clone(row.face), ...proposed.face };
    proposed.face = { ...proposed.face, ...parsed.walls[0].face };
    this.draft.walls[this.selectedIndex] = proposed;
    this._changedTargets.set(this.selectedIndex, selector); this.repairIndex = -1;
    this._cancelPending(); this._mark(); this.onRender(); return true;
  }
  async _prepare() {
    if (this._readOnly() || this.stale || this.preparing || this.dirty || this._pending || typeof this.card.prepareWallSelection !== 'function') {
      this.message = 'Cancel unsaved changes and surface selection before preparing separate meshes.'; this.onRender(); return;
    }
    const context = this._context(), epoch = this._epoch; this._preparationOwned = true; this.preparing = true; this.message = null; this.onRender();
    try {
      await this.card.prepareWallSelection();
      if (this.disposed || epoch !== this._epoch || this.dirty || !this._same(context, this._context(), true)) return;
      this._load(); this.message = this._candidates().prepared ? 'Separate mesh choices are ready. Choose only the wall meshes you intend to change.' : 'Separate wall meshes are still unavailable; no wall choice was invented.';
    } catch (error) {
      if (!this.disposed && epoch === this._epoch && this._same(context, this._context(), true))
        this.message = `Separate wall meshes could not be prepared. ${typeof error?.message === 'string' && error.message ? error.message : 'The saved settings were kept.'}`;
    } finally {
      if (!this.disposed && epoch === this._epoch) { this.preparing = false; this.onRender(); }
    }
  }
  onClick(action) {
    if (this.disposed || !action?.startsWith(prefix)) return false;
    this._ensure(); const name = action.slice(prefix.length);
    if (name === 'cancel') { this.reset(); this.onRender(); return true; }
    if (name === 'cancel-pick') { this._cancelPending(); this.onRender(); return true; }
    if (name === 'prepare') { this.preparingPromise = this._prepare(); return true; }
    if (name === 'repair') {
      if (this._readOnly() || this.stale || this.preparing) return true;
      this._cancelPending(); const walls = own(this.draft, 'walls') ? clone(this.draft.walls) : [];
      this.draft = { ...extras(this.draft, globalFields), ...clone(WALL_PRESENTATION_DEFAULTS), walls };
      this._mark(); this.onRender(); return true;
    }
    if (this._blocked()) return true;
    if (name === 'repair-list') { if (own(this.draft, 'walls') && !Array.isArray(this.draft.walls)) { this.draft.walls = []; this.selectedIndex = -1; this._mark(); this.onRender(); } return true; }
    if (name === 'add') {
      if (own(this.draft, 'walls') && !Array.isArray(this.draft.walls) || this._rows().length >= WALL_PRESENTATION_LIMITS.maxWalls) return true;
      this._cancelPending(); const rows = this._rows(); let count = 1; while (rows.some((row) => row?.id === `wall-${count}`)) count++;
      this.draft.walls = [...rows, { id: `wall-${count}`, label: '', enabled: true, selector: '' }];
      this.selectedIndex = this.draft.walls.length - 1; this.repairIndex = this.selectedIndex; this._mark(); this.onRender(); return true;
    }
    if (name === 'remove') {
      if (this.selectedIndex >= 0 && this.selectedIndex < this._rows().length) {
        this._cancelPending(); const removed = this.selectedIndex;
        this.draft.walls.splice(removed, 1);
        this._changedTargets = new Map([...this._changedTargets].filter(([index]) => index !== removed)
          .map(([index, selector]) => [index > removed ? index - 1 : index, selector]));
        this.selectedIndex = this._rows().length ? Math.min(this.selectedIndex, this._rows().length - 1) : -1;
        this.repairIndex = -1; this._mark(); this.onRender();
      }
      return true;
    }
    if (name === 'relink') { if (plain(this._rows()[this.selectedIndex])) { this._cancelPending(); this.repairIndex = this.selectedIndex; this.message = 'Choose an exact replacement mesh or repair the explicit floor. A different mesh clears the old face.'; this.onRender(); } return true; }
    if (name === 'pick') { this._beginPick(); this.onRender(); return true; }
    if (name !== 'save') return false;
    const { issues } = this._evaluation();
    if (!this.dirty || issues.length || typeof this.card.commitFeatureLayout !== 'function') { this.message = issues[0] || 'Change a wall setting before saving.'; this.onRender(); return true; }
    this.card.commitFeatureLayout({ wall_presentation: clone(this.draft) }); this.reset(); this.onRender(); return true;
  }
  reset() {
    this._cancelPending(); this._epoch++;
    if (this._preparationOwned) { this._preparationOwned = false; this.onCancelPrepare?.(); }
    this.draft = null; this._loaded = false; this.dirty = false;
    this.stale = false; this.preparing = false; this.message = null; this.repairIndex = -1;
    this.selectedIndex = -1; this._changedTargets.clear();
  }
  cancel() { this.reset(); }
  dispose() { this.reset(); this.disposed = true; }
}
