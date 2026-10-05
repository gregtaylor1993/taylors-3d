// Future Settings fragment; not registered/imported by the card yet. Editing
// selected header sources never changes HA readings or sends device commands.
import { entityChoices, entityMetadata } from './entity-metadata.js';
import { HOUSE_SUMMARY_LIMITS, readHouseSummary } from './house-summary.js';

const prefix = 'house-summary-';
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const tag = (value) => Array.isArray(value) ? ['array', Array.from(value, tag)] : plain(value)
  ? ['object', Object.entries(value).map(([key, entry]) => [key, tag(entry)])] : [typeof value, typeof value === 'number' && !Number.isFinite(value) ? String(value) : value];
const stamp = (value) => { try { return JSON.stringify(tag(value)); } catch { return 'invalid-unserializable'; } };
const rawLabel = (value) => typeof value === 'string' ? value : (() => { try { return JSON.stringify(value) ?? 'undefined'; } catch { return 'Unreadable imported value'; } })();
const domains = { weather_entity: 'weather', alarm_entity: 'alarm_control_panel', person: 'person' };
const exact = (id, domain) => typeof id === 'string' && id.length <= HOUSE_SUMMARY_LIMITS.entity && new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(id);

/** HouseSummaryEditor(card,onRender), future Edit Settings fragment.
 * render/onClick(action,element)/onInput/onChange/updatePreviews/reset/cancel/
 * dispose. Parent forwards the actual native action node for gesture checking,
 * calls updatePreviews after rendering and cancel/reset on history/tab changes.
 * Optional houseSummaryEditorAvailable() explicitly gates a future Settings
 * panel. Otherwise _editing:true/_edit.tab:'settings' is required; omitted
 * _editing supports standalone fragments, as the existing floor editor does.
 * Empty explicit title/weather/alarm values OMIT that property. Present malformed
 * imports remain unchanged until an explicit repair. No live/header preview.
 */
export class HouseSummaryEditor {
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.disposed = false; this._loaded = false;
    this.draft = null; this.dirty = false; this.stale = false; this.message = null; this.newPerson = ''; this._epoch = 0;
    this._root = null; this._intents = new WeakMap(); this._pressed = new Map();
    this._handlers = new Map([['pointerdown', (event) => this._press(event)], ['pointerup', (event) => this._release(event)],
      ['pointercancel', (event) => this._cancelPress(event)], ['keydown', (event) => this._key(event)],
      ['keyup', (event) => this._release(event)], ['focusout', (event) => this._cancelPress(event)]]);
  }
  get effective() { return this.card._layout?.house_summary ?? this.card._config?.house_summary; }
  _panelAvailable() {
    if (typeof this.card.houseSummaryEditorAvailable === 'function') { try { return this.card.houseSummaryEditorAvailable() === true; } catch { return false; } }
    return this.card._editing === undefined || this.card._editing === true && this.card._edit?.tab === 'settings';
  }
  get canEdit() {
    const hass = this.card._hass, user = hass?.user;
    return !this.disposed && this.card.isConnected === true && hass?.connection?.connected === true
      && typeof user?.id === 'string' && !!user.id.trim() && user.is_admin === true
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true) && this._panelAvailable();
  }
  _context() {
    const config = this.card._config || {}, layout = this.card._layout || {}, hass = this.card._hass, user = hass?.user;
    return { root: this.card._view?.model?.root ?? null, connection: hass?.connection, auth: hass?.auth,
      key: stamp([config.layout_key, config.model ? config.model : layout.model, config.model_position, config.model_rotation, config.model_scale,
        this.card._modelAlign?.(), this.card._mb?.levels, layout.floors, layout.rooms,
        Array.isArray(this.card._floors) ? this.card._floors.map((floor) => [floor?.id, floor?.elevation, floor?.stale]) : this.card._floors,
        layout.house_summary != null ? 'layout' : config.house_summary != null ? 'config' : 'default',
        user?.id, user?.is_admin, !!user && Object.hasOwn(user, 'is_active'), user?.is_active, user?.permissions,
        this.card.isConnected, hass?.connection?.connected, this.card._editing, this.card._edit?.tab, this._panelAvailable()]), value: stamp(this.effective) };
  }
  _same(a, b) { return !!a && !!b && a.root === b.root && a.connection === b.connection && a.auth === b.auth && a.key === b.key && a.value === b.value; }
  _load() {
    this.base = this._context(); this._epoch++;
    try { this.draft = this.effective === undefined ? {} : clone(this.effective); } catch { this.draft = null; }
    this._baseDraftStamp = stamp(this.draft);
    this.dirty = false; this.stale = false; this.message = null; this.newPerson = ''; this._loaded = true;
  }
  _ensure() {
    const context = this._context();
    if (!this._loaded || !this.dirty && !this._same(this.base, context)) this._load();
    else if (this.dirty && !this._same(this.base, context)) this.stale = true;
  }
  _blocked() { return !this.canEdit || this.stale || !plain(this.draft); }
  _mark() { this.dirty = stamp(this.draft) !== this._baseDraftStamp; this.message = null; }
  _people() { return Array.isArray(this.draft?.person_entities) ? this.draft.person_entities : []; }
  _peopleMalformed() { return plain(this.draft) && Object.hasOwn(this.draft, 'person_entities') && !Array.isArray(this.draft.person_entities); }
  _choices(domain, selected) {
    return entityChoices(this.card._hass, { domains: [domain], selected,
      capability: (metadata) => exact(metadata.entityId, domain) && (metadata.state?.entity_id === undefined || metadata.state.entity_id === metadata.entityId)
        && (metadata.state?.attributes === undefined || plain(metadata.state.attributes))
        && (!Object.hasOwn(metadata.state?.attributes || {}, 'restored') || metadata.state.attributes.restored === false) });
  }
  _selectable(id, domain) { return this._choices(domain).some((entry) => entry.value === id && entry.selectable); }
  _sourceMessage(id, domain) {
    if (!exact(id, domain)) return 'Malformed saved ID; replace or remove it explicitly.';
    const metadata = entityMetadata(this.card._hass, id);
    if (metadata.missing || !metadata.hasState) return 'No current entity state. The saved ID is kept.';
    if (metadata.disabled || metadata.hidden || metadata.category) return 'Hidden, disabled or administrative entity. The saved ID is kept.';
    if (metadata.state?.attributes?.restored !== undefined && metadata.state.attributes.restored !== false) return 'Waiting for a current reading; a stored/restored flag is present.';
    if (!this._selectable(id, domain)) return 'Current source is malformed or outside this picker. The saved ID is kept.';
    if (!metadata.available) return 'This entity currently reports unknown/unavailable. Configuration does not make it a current reading.';
    return `Selected source: ${metadata.name}. This editor does not preview or change its state.`;
  }
  _evaluation() {
    const issues = readHouseSummary(this.draft).diagnostics.map((entry) => entry.message);
    if (!this.canEdit) issues.push('A connected current active administrator in Settings is required.');
    if (this.stale) issues.push('The saved settings, model, layout, alignment or session changed. Your draft is kept. Cancel before Save.');
    return [...new Set(issues)];
  }
  _token(index) { return `${this._epoch}:${index}:${stamp(this._people()[index])}`; }
  _options(domain, selected, allowNone = false) {
    const choices = this._choices(domain, typeof selected === 'string' ? selected : undefined), missing = selected !== undefined && !choices.some((entry) => entry.value === selected);
    return `${missing ? `<option value="" selected disabled>Saved value needs repair: ${esc(rawLabel(selected))}</option>` : ''}
      ${allowNone ? `<option value="" ${selected === undefined ? 'selected' : ''}>Do not show this source</option>` : selected === undefined ? '<option value="" selected disabled>Choose an actual person entity</option>' : ''}
      ${choices.map((entry) => `<option value="${esc(entry.value)}" ${entry.value === selected ? 'selected' : ''} ${entry.selectable ? '' : 'disabled'}>${esc(entry.label)}</option>`).join('')}`;
  }
  _fieldHtml(field, label) {
    return `<label>${label}<select data-field="${prefix}${field}" data-house-summary-epoch="${this._epoch}" ${this._blocked() ? 'disabled' : ''}>
      ${this._options(domains[field], this.draft?.[field], true)}</select></label><p data-house-summary-source="${field}">${Object.hasOwn(this.draft || {}, field) ? esc(this._sourceMessage(this.draft[field], domains[field])) : 'No source selected.'}</p>`;
  }
  _syncOptions(select, domain, selected, allowNone = false) {
    // Keep the native select and existing keyed options, including its focus.
    // Update source warnings when HA changes; never choose a replacement ID.
    const template = select.ownerDocument.createElement('select'); template.innerHTML = this._options(domain, selected, allowNone);
    const existing = new Map(), seen = new Map(), selectedIndex = template.selectedIndex;
    for (const option of select.options) { const index = seen.get(option.value) || 0; seen.set(option.value, index + 1); existing.set(`${option.value}:${index}`, option); }
    seen.clear();
    for (const [index, wanted] of [...template.options].entries()) {
      const ordinal = seen.get(wanted.value) || 0; seen.set(wanted.value, ordinal + 1); const key = `${wanted.value}:${ordinal}`;
      const option = existing.get(key) || wanted; existing.delete(key);
      if (option.textContent !== wanted.textContent) option.textContent = wanted.textContent;
      option.disabled = wanted.disabled; if (select.options[index] !== option) select.insertBefore(option, select.options[index] || null);
    }
    for (const option of existing.values()) option.remove(); select.selectedIndex = selectedIndex;
  }
  _peopleHtml() {
    const blocked = this._blocked(), malformed = plain(this.draft) && Object.hasOwn(this.draft, 'person_entities') && !Array.isArray(this.draft.person_entities);
    if (malformed) return '<p>Saved people list is malformed. Use Clear people deliberately, then choose actual person entities.</p>';
    const people = this._people();
    return `${!people.length ? '<p>No people selected. This does not infer who lives here.</p>' : ''}
      ${Array.from(people).slice(0, 64).map((id, index) => `<div data-house-summary-person="${index}"><label>Person ${index + 1}<select data-field="${prefix}person" data-house-summary-index="${index}" data-house-summary-token="${esc(this._token(index))}" ${blocked ? 'disabled' : ''}>${this._options('person', id)}</select></label>
        <p data-house-summary-person-status="${index}">${esc(this._sourceMessage(id, 'person'))}</p><button type="button" data-act="${prefix}remove-person" data-house-summary-index="${index}" data-house-summary-token="${esc(this._token(index))}" ${blocked ? 'disabled' : ''}>Remove this person</button></div>`).join('')}
      ${people.length > 64 ? '<p>Additional imported entries are retained. Clear people explicitly to replace this oversized list.</p>' : ''}`;
  }
  _statusHtml() {
    const issues = this._evaluation();
    return `${this.dirty ? '<p>Unsaved header settings. Save once to apply; Cancel keeps the saved settings.</p>' : '<p>Changing these fields does not change Home Assistant readings.</p>'}
      ${this.message ? `<p role="status">${esc(this.message)}</p>` : ''}${issues.length ? `<ul role="status">${issues.map((message) => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}`;
  }
  _titleIssue() { return plain(this.draft) && Object.hasOwn(this.draft, 'title') && typeof this.draft.title !== 'string'
    ? `Imported title needs explicit repair: ${rawLabel(this.draft.title)}.` : ''; }
  render() {
    if (this.disposed) return ''; this._ensure(); const blocked = this._blocked(), people = this._people();
    const title = typeof this.draft?.title === 'string' ? this.draft.title : '';
    return `<section data-house-summary-editor data-taylors3d-ui="house-summary-editor"><style>
      [data-house-summary-editor]{min-width:0;margin:0 0 20px;color:var(--primary-text-color,#212121)}
      [data-house-summary-editor] label{display:flex;flex-direction:column;gap:5px;margin:12px 0;overflow-wrap:anywhere}
      [data-house-summary-editor] input,[data-house-summary-editor] select,[data-house-summary-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#fff)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-house-summary-editor] input,[data-house-summary-editor] select{width:100%;min-width:0}[data-house-summary-editor] p,[data-house-summary-editor] li{overflow-wrap:anywhere}
      [data-house-summary-editor] button{cursor:pointer;min-width:44px}[data-house-summary-editor] :disabled{opacity:.6;cursor:default}
      [data-house-summary-editor] :focus-visible{outline:3px solid var(--primary-text-color,#212121);outline-offset:2px}
      [data-house-summary-editor] .house-summary-actions{display:flex;gap:8px;flex-wrap:wrap}[data-house-summary-person]{padding:0 0 12px;border-bottom:1px solid var(--divider-color,#888)}
      </style><h3>House summary</h3><p>Choose the real sources shown in your house header. No address, person, weather or alarm is chosen automatically.</p>
      <label>Title<input data-field="${prefix}title" data-house-summary-epoch="${this._epoch}" maxlength="${HOUSE_SUMMARY_LIMITS.title}" value="${esc(title)}" ${blocked ? 'disabled' : ''}></label>
      <p>Leave Title empty to use Home Assistant’s configured home name when available, or Taylor's 3D. An empty title removes this override.</p>
      <p data-house-summary-title-status>${esc(this._titleIssue())}</p>
      ${this._fieldHtml('weather_entity', 'Weather source')}${this._fieldHtml('alarm_entity', 'Alarm source')}
      <h4>Selected people</h4><p>Choose up to 12 actual person entities. Their Home/Away values do not identify which room they are in. Motion sensors do not name a person.</p>
      ${this._peopleHtml()}<label>Add a person<select data-field="${prefix}new-person" data-house-summary-epoch="${this._epoch}" ${blocked || people.length >= 12 ? 'disabled' : ''}>${this._options('person', this.newPerson || undefined)}</select></label>
      <div class="house-summary-actions"><button type="button" data-act="${prefix}add-person" ${blocked || this._peopleMalformed() || people.length >= 12 || !this._selectable(this.newPerson, 'person') || people.includes(this.newPerson) ? 'disabled' : ''}>Add selected person</button>
      <button type="button" data-act="${prefix}clear-people" ${blocked ? 'disabled' : ''}>Clear people</button></div>
      <div data-house-summary-status aria-live="polite">${this._statusHtml()}</div><div class="house-summary-actions">
      <button type="button" data-act="${prefix}save" ${!this.dirty || this._evaluation().length ? 'disabled' : ''}>Save house summary</button><button type="button" data-act="${prefix}cancel">Cancel</button>
      <button type="button" data-act="${prefix}repair-settings" ${!this.canEdit || this.stale ? 'disabled' : ''}>Repair settings structure</button></div></section>`;
  }
  updatePreviews(container) {
    if (this.disposed) return; const epoch = this._epoch; this._ensure();
    const root = container?.matches?.('[data-house-summary-editor]') ? container : container?.querySelector?.('[data-house-summary-editor]'); if (!root) return;
    this._bind(root); if (epoch !== this._epoch && !this.dirty) { this.onRender(); return; }
    const status = root.querySelector('[data-house-summary-status]'), html = this._statusHtml(); if (status.innerHTML !== html) status.innerHTML = html;
    root.querySelector('[data-house-summary-title-status]').textContent = this._titleIssue();
    const blocked = this._blocked();
    for (const element of root.querySelectorAll('input,select')) {
      element.disabled = blocked || element.dataset.field === `${prefix}new-person` && this._people().length >= 12;
      if (element.dataset.houseSummaryEpoch !== undefined) element.dataset.houseSummaryEpoch = String(this._epoch);
      if (element.dataset.houseSummaryIndex !== undefined) element.dataset.houseSummaryToken = this._token(Number(element.dataset.houseSummaryIndex));
      const field = element.dataset.field.slice(prefix.length);
      if (field === 'weather_entity' || field === 'alarm_entity') this._syncOptions(element, domains[field], this.draft?.[field], true);
      else if (field === 'person') this._syncOptions(element, 'person', this._people()[Number(element.dataset.houseSummaryIndex)]);
      else if (field === 'new-person') this._syncOptions(element, 'person', this.newPerson || undefined);
    }
    for (const field of ['weather_entity', 'alarm_entity']) root.querySelector(`[data-house-summary-source="${field}"]`).textContent
      = Object.hasOwn(this.draft || {}, field) ? this._sourceMessage(this.draft[field], domains[field]) : 'No source selected.';
    for (const element of root.querySelectorAll('[data-house-summary-person-status]')) element.textContent = this._sourceMessage(this._people()[Number(element.dataset.houseSummaryPersonStatus)], 'person');
    for (const button of root.querySelectorAll('button[data-act]')) {
      const kind = button.dataset.act.slice(prefix.length);
      button.disabled = kind === 'cancel' ? false : kind === 'repair-settings' ? !this.canEdit || this.stale : blocked
        || kind === 'save' && (!this.dirty || this._evaluation().length > 0)
        || kind === 'add-person' && (this._peopleMalformed() || this._people().length >= 12 || !this._selectable(this.newPerson, 'person') || this._people().includes(this.newPerson));
      if (button.dataset.houseSummaryIndex !== undefined) button.dataset.houseSummaryToken = this._token(Number(button.dataset.houseSummaryIndex));
    }
    this._revalidatePresses();
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith(prefix) || !element) return false; this._ensure(); const key = field.slice(prefix.length);
    if (this._blocked() || element.dataset.houseSummaryEpoch !== undefined && element.dataset.houseSummaryEpoch !== String(this._epoch)) return true;
    if (key === 'title') { if (typeof element.value !== 'string') return true;
      if (!element.value.trim()) delete this.draft.title; else this.draft.title = element.value; }
    else if (key === 'weather_entity' || key === 'alarm_entity') {
      if (element.value === '') delete this.draft[key]; else if (this._selectable(element.value, domains[key])) this.draft[key] = element.value; else return true;
    } else if (key === 'new-person') { this.newPerson = this._selectable(element.value, 'person') ? element.value : ''; this.updatePreviews(element.closest('[data-house-summary-editor]')); return true; }
    else if (key === 'person') {
      const index = Number(element.dataset.houseSummaryIndex);
      if (!Number.isInteger(index) || index < 0 || index >= this._people().length || element.dataset.houseSummaryToken !== this._token(index) || !this._selectable(element.value, 'person')) return true;
      this.draft.person_entities[index] = element.value;
    } else return false;
    this._mark(); this.updatePreviews(element.closest('[data-house-summary-editor]')); return true;
  }
  onInput(field, element) { return this.onChange(field, element); }
  onClick(action, element) {
    if (this.disposed || !action?.startsWith(prefix)) return false; this._ensure(); const kind = action.slice(prefix.length);
    if (element && (element.dataset.act !== action || !this._consume(element))) return true;
    if (kind === 'cancel') { this.reset(); this.onRender(); return true; }
    if (kind === 'repair-settings' && this.canEdit && !this.stale) { this.draft = { ...(plain(this.draft) ? this.draft : {}) }; this._mark(); this.onRender(); return true; }
    if (this._blocked()) return true;
    if (kind === 'save') {
      const issues = this._evaluation(); if (!this.dirty || issues.length || typeof this.card.commitFeatureLayout !== 'function') { this.message = issues[0] || 'Make a deliberate valid change before Save.'; this.onRender(); return true; }
      this.card.commitFeatureLayout({ house_summary: clone(this.draft) }, 'House summary'); this.reset(); this.onRender(); return true;
    }
    if (kind === 'add-person') {
      if (!this._selectable(this.newPerson, 'person') || this._people().includes(this.newPerson) || this._people().length >= 12
        || Object.hasOwn(this.draft, 'person_entities') && !Array.isArray(this.draft.person_entities)) return true;
      this.draft.person_entities = [...this._people(), this.newPerson]; this.newPerson = ''; this._epoch++; this._mark(); this.onRender(); return true;
    }
    if (kind === 'clear-people') { this.draft.person_entities = []; this._epoch++; this._mark(); this.onRender(); return true; }
    if (kind === 'remove-person') {
      const index = Number(element?.dataset.houseSummaryIndex);
      if (!Number.isInteger(index) || index < 0 || index >= this._people().length || element.dataset.houseSummaryToken !== this._token(index)) return true;
      this.draft.person_entities.splice(index, 1); this._epoch++; this._mark(); this.onRender(); return true;
    }
    return false;
  }
  _button(event) { const button = event.target?.closest?.('button[data-act]'); return button?.dataset.act?.startsWith(prefix) ? button : null; }
  _live(element) { return !!element?.isConnected && !!this._root?.contains(element); }
  _actionStamp(button) { return { context: this._context(), epoch: this._epoch, action: button.dataset.act,
    draft: stamp(this.draft), newPerson: this.newPerson, token: button.dataset.houseSummaryToken }; }
  _sameAction(previous, button) { const next = this._actionStamp(button); return this._live(button) && !button.disabled
    && (button.dataset.act === `${prefix}cancel` || this.canEdit && !this.stale) && this._same(previous.context, next.context)
    && previous.epoch === next.epoch && previous.action === next.action && previous.draft === next.draft
    && previous.newPerson === next.newPerson && previous.token === next.token; }
  _revalidatePresses() { for (const [button, intent] of this._pressed) if (!intent.poisoned && !this._sameAction(intent.stamp, button)) intent.poisoned = true; }
  _unbind() {
    for (const [button, intent] of this._pressed) { intent.poisoned = true; this._intents.set(button, intent); }
    this._pressed.clear(); if (this._root) for (const [type, handler] of this._handlers) this._root.removeEventListener(type, handler, true); this._root = null;
  }
  _bind(root) { if (this._root === root) return; this._unbind(); this._root = root; for (const [type, handler] of this._handlers) root.addEventListener(type, handler, true); }
  _press(event) {
    const button = this._button(event); if (!button || !this._live(button) || event.button !== undefined && event.button !== 0 || event.isPrimary === false) return;
    this._ensure(); const intent = { stamp: this._actionStamp(button), poisoned: button.disabled || !this.canEdit && button.dataset.act !== `${prefix}cancel`,
      consumed: false, held: true, kind: event.type === 'keydown' ? 'keyboard' : 'pointer', key: event.key, pointerId: event.pointerId };
    this._intents.set(button, intent); this._pressed.set(button, intent);
  }
  _key(event) {
    if (!['Enter', ' '].includes(event.key)) return; const button = this._button(event); if (!button) return;
    const existing = this._intents.get(button);
    if (event.repeat || existing?.held && existing.kind === 'keyboard') { if (!existing) { this._press(event); const intent = this._intents.get(button); if (intent) intent.poisoned = true; } this._revalidatePresses(); return; }
    this._press(event);
  }
  _release(event) {
    const button = this._button(event), intent = this._intents.get(button);
    if (!intent || event.type === 'keyup' && (intent.kind !== 'keyboard' || intent.key !== event.key)
      || event.type === 'pointerup' && (intent.kind !== 'pointer' || intent.pointerId !== undefined && event.pointerId !== intent.pointerId)) return;
    this._revalidatePresses(); intent.held = false;
  }
  _cancelPress(event) { const intent = this._intents.get(this._button(event)); if (intent?.held) { intent.poisoned = true; intent.held = false; } }
  _consume(button) {
    if (!this._live(button) || button.disabled) return false; this._revalidatePresses(); const intent = this._intents.get(button); if (!intent) return true;
    if (intent.poisoned || intent.consumed || !this._sameAction(intent.stamp, button)) { intent.poisoned = true; return false; }
    intent.consumed = true; return true;
  }
  reset() { this._unbind(); this._epoch++; this._loaded = false; this.draft = null; this.dirty = false; this.stale = false; this.message = null; this.newPerson = ''; }
  cancel() { this.reset(); }
  dispose() { this.reset(); this.disposed = true; }
}
