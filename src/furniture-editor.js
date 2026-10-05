// Future draft editor. Parent owns actual library/auth requests, rendering,
// history and drag hit-testing. No imported item edits the original house model.
import { editorExtraNotice, readEditorExtraNotice, editorExtraText, editorExtraCaption, updateEditorExtraCaptions, syncEditorOptions, editorExtraDiagnostic } from './editor-extra-localization.js';
import { FURNITURE_PLACEMENT_LIMITS, readFurniturePlacement, resolveFurnitureAsset, resolveFurniturePlacement } from './furniture-placement.js';
import { furnitureRuntimeMessage, furnitureRuntimeNotice, readFurnitureRuntimeNotice } from './furniture-runtime-localization.js';
const prefix = 'furniture-';
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const tag = (value) => Array.isArray(value) ? ['array', Array.from(value, tag)] : plain(value)
  ? ['object', Object.entries(value).map(([key, entry]) => [key, tag(entry)])] : [typeof value, typeof value === 'number' && !Number.isFinite(value) ? String(value) : value];
const stamp = (value) => { try { return JSON.stringify(tag(value)); } catch { return 'invalid-unserializable'; } };
const number = (value) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : '';
const optionalDefaults = { z: 0, rotation_degrees: 0, scale: 1 };
const rowFields = new Set(['id', 'pack_id', 'item_id', 'floor_id', 'x', 'y', 'z', 'rotation_degrees', 'scale']);

/** FurnitureEditor(card,onRender) fragment for Edit Model/Furniture.
 * furnitureCatalogue(): synchronous {status,catalogue,message?}, a client result
 * {ok,catalogue,diagnostics}, or an actual version-1 catalogue. Never fetch on render.
 * furniturePreviewDraft(raw|null) is optional; parent must resolve current assets.
 * furnitureLibrary.importPack(File) is an explicit clean-admin action, not Save.
 * draftPlacementHandles() returns source coordinates plus an opaque token.
 * moveDraftInstance(id,{x,y,z?,floor_id?,token}) requires that captured token;
 * a third token argument is also accepted. Continuous moves retain it until the
 * selected identity/floor/source/session changes. Parent cancels on tab/history.
 */
export class FurnitureEditor {
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.disposed = false; this._loaded = false;
    this.draft = null; this.dirty = false; this.stale = false; this.selectedIndex = -1; this.repairIndex = -1;
    this._epoch = 0; this._changed = new Set(); this._previewOwned = false; this._previewKey = null; this._importPending = false;
    this.newPack = ''; this.newItem = ''; this.newFloor = ''; this.file = null; this.message = null;
    this._actionRoot = null; this._actionIntents = new WeakMap(); this._pressed = new Map();
    this._actionHandlers = new Map([['pointerdown', (event) => this._press(event)], ['pointerup', (event) => this._release(event)],
      ['pointercancel', (event) => this._cancelPress(event)], ['keydown', (event) => this._key(event)],
      ['keyup', (event) => this._release(event)], ['focusout', (event) => this._cancelPress(event)]]);
  }
  get message() { return readFurnitureRuntimeNotice(this.card._hass, readEditorExtraNotice(this.card._hass, this._message)); }
  set message(value) { this._message = value; }
  _notice(key, parameters = {}) { return editorExtraNotice(key, parameters); }
  _t(key, parameters = {}) { return editorExtraText(this.card._hass, key, parameters); }
  _caption(key) { return editorExtraCaption(this.card._hass, key); }
  _diagnostic(value) { return editorExtraDiagnostic(this.card._hass, value); }
  get effective() { return this.card._layout?.furniture; }
  _layoutReady() { return !this.card._loading && plain(this.card._layout); }
  get canEdit() {
    const hass = this.card._hass, user = hass?.user;
    return !this.disposed && this._layoutReady() && this.card.isConnected === true && hass?.connection?.connected === true
      && typeof user?.id === 'string' && user.id.trim().length > 0 && user.is_admin === true
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true)
      && this.card._editing === true && ['model', 'furniture'].includes(this.card._edit?.tab);
  }
  _library() {
    if (typeof this.card.furnitureCatalogue !== 'function') return { status: 'unavailable', message: this._t('furniture.noLibrary') };
    try {
      const result = this.card.furnitureCatalogue();
      if (result?.then) return { status: 'loading', message: this._t('furniture.loadingLibrary') };
      const catalogue = result?.version === 1 ? result : result?.catalogue;
      if ((result?.status === 'ready' || result?.ok === true || result?.version === 1) && catalogue?.version === 1 && Array.isArray(catalogue.packs))
        return { status: 'ready', catalogue };
      return { status: ['loading', 'error', 'unavailable'].includes(result?.status) ? result.status : result?.ok === false ? 'error' : 'unavailable',
        message: furnitureRuntimeMessage(this.card._hass, result) || furnitureRuntimeMessage(this.card._hass, result?.diagnostics?.[0]) || this._t('furniture.missingLibrary') };
    } catch { return { status: 'error', message: this._t('furniture.libraryError') }; }
  }
  _floors() { return Array.isArray(this.card._floors) ? this.card._floors : []; }
  _floor(id) {
    const matches = this._floors().filter((floor) => floor?.id === id);
    const floor = matches[0];
    return typeof id === 'string' && id.trim() && matches.length === 1 && typeof floor?.elevation === 'number' && Number.isFinite(floor.elevation)
      && Math.abs(floor.elevation) <= FURNITURE_PLACEMENT_LIMITS.floorElevation
      && (!Object.hasOwn(floor, 'stale') || floor.stale === false) ? floor : null;
  }
  _context() {
    const config = this.card._config || {}, layout = this.card._layout || {}, hass = this.card._hass, user = hass?.user, library = this._library();
    return { root: this.card._view?.model?.root ?? null, connection: hass?.connection, auth: hass?.auth,
      key: stamp([config.layout_key, config.model ? config.model : layout.model, config.model_position, config.model_rotation, config.model_scale,
        this.card._modelAlign?.(), layout.floors, this._floors().map((floor) => [floor?.id, floor?.elevation, floor?.stale]),
        user?.id, user?.is_admin, !!user && Object.hasOwn(user, 'is_active'), user?.is_active,
        user?.permissions,
        this.card.isConnected, hass?.connection?.connected, this.card._editing, this.card._edit?.tab,
        this._layoutReady()]), value: stamp(this.effective),
      catalogue: stamp([library.status, library.catalogue?.packs?.map((pack) => [pack?.pack_id,
        Array.isArray(pack?.items) ? pack.items.map((item) => [item?.id, item?.pack_id, item?.sha256, item?.unit, item?.anchor]) : pack?.items])]) };
  }
  _same(a, b, catalogue = true) { return !!a && !!b && a.root === b.root && a.connection === b.connection && a.auth === b.auth
    && a.key === b.key && a.value === b.value && (!catalogue || a.catalogue === b.catalogue); }
  _button(event) { const button = event.target?.closest?.('button[data-act]'); return button?.dataset.act?.startsWith(prefix) ? button : null; }
  _live(element) { return !!element?.isConnected && !!this._actionRoot?.contains(element); }
  _actionStamp(button) { return { context: this._context(), epoch: this._epoch, action: button.dataset.act,
    intent: this._intent(), choices: stamp([this.newPack, this.newItem, this.newFloor]), file: this.file }; }
  _sameAction(previous, button) { const next = this._actionStamp(button); return this._live(button) && !button.disabled
    && (button.dataset.act === `${prefix}cancel` || this.canEdit && !this.stale) && this._same(previous.context, next.context)
    && previous.epoch === next.epoch && previous.action === next.action && previous.intent === next.intent
    && previous.choices === next.choices && previous.file === next.file; }
  _revalidatePresses() { for (const [button, intent] of this._pressed) if (!intent.poisoned && !this._sameAction(intent.stamp, button)) intent.poisoned = true; }
  _unbind() {
    for (const [button, intent] of this._pressed) { intent.poisoned = true; this._actionIntents.set(button, intent); }
    this._pressed.clear();
    if (this._actionRoot) for (const [type, handler] of this._actionHandlers) this._actionRoot.removeEventListener(type, handler, true);
    this._actionRoot = null; this._container = null;
  }
  _bind(root) { if (this._actionRoot === root) return; this._unbind(); this._actionRoot = root;
    for (const [type, handler] of this._actionHandlers) root.addEventListener(type, handler, true); }
  _press(event) {
    const button = this._button(event); if (!button || !this._live(button) || event.button !== undefined && event.button !== 0 || event.isPrimary === false) return;
    this._ensure(); const intent = { stamp: this._actionStamp(button), poisoned: button.disabled || !this.canEdit && button.dataset.act !== `${prefix}cancel`,
      consumed: false, held: true, kind: event.type === 'keydown' ? 'keyboard' : 'pointer', key: event.key, pointerId: event.pointerId };
    this._actionIntents.set(button, intent); this._pressed.set(button, intent);
  }
  _key(event) {
    if (!['Enter', ' '].includes(event.key)) return; const button = this._button(event); if (!button) return;
    const existing = this._actionIntents.get(button);
    if (event.repeat || existing?.held && existing.kind === 'keyboard') {
      if (!existing) { this._press(event); const intent = this._actionIntents.get(button); if (intent) intent.poisoned = true; }
      this._revalidatePresses(); return;
    }
    this._press(event);
  }
  _release(event) {
    const button = this._button(event), intent = this._actionIntents.get(button);
    if (!intent || event.type === 'keyup' && (intent.kind !== 'keyboard' || intent.key !== event.key)
      || event.type === 'pointerup' && (intent.kind !== 'pointer' || intent.pointerId !== undefined && event.pointerId !== intent.pointerId)) return;
    this._revalidatePresses(); intent.held = false;
  }
  _cancelPress(event) { const intent = this._actionIntents.get(this._button(event)); if (intent?.held) { intent.poisoned = true; intent.held = false; } }
  _consume(button) {
    // A current accessibility click needs no pointer/key prelude. A cancelled,
    // detached or already consumed native gesture cannot use that fallback.
    if (!button) return true; if (!this._live(button) || button.disabled) return false;
    this._revalidatePresses(); const intent = this._actionIntents.get(button); if (!intent) return true;
    if (intent.poisoned || intent.consumed || !this._sameAction(intent.stamp, button)) { intent.poisoned = true; return false; }
    intent.consumed = true; return true;
  }
  _clearPreview() {
    if (this._previewOwned) { try { this.card.furniturePreviewDraft?.(null); } catch { /* Draft cleanup cannot save or alter layout. */ } }
    this._previewOwned = false; this._previewKey = null;
  }
  _load() {
    this._clearPreview(); this.base = this._context(); this._epoch++;
    try { this.draft = this.effective === undefined ? { version: 1, instances: [] } : clone(this.effective); }
    catch { this.draft = null; }
    this.dirty = false; this.stale = false; this._changed.clear(); this.selectedIndex = this._rows().length ? 0 : -1;
    this.repairIndex = -1; this.message = null; this._loaded = true; this._importPending = false;
    this.newPack = ''; this.newItem = ''; this.newFloor = ''; this.file = null;
  }
  _ensure() {
    const context = this._context();
    // A successful import can append the published catalogue before its promise
    // resolves. It cannot change the captured source/session/layout intent.
    if (!this._loaded || !this.dirty && !this._same(this.base, context, !this._importPending)) this._load();
    else if (this.dirty && !this._same(this.base, context)) { this.stale = true; this._clearPreview(); }
    if (!this.canEdit) this._clearPreview();
  }
  _rows() { return Array.isArray(this.draft?.instances) ? this.draft.instances : []; }
  _report() { return resolveFurniturePlacement(this.draft, { floors: this._floors(), catalogue: this._library().catalogue }); }
  _blocked() { return !this.canEdit || this.stale || this._importPending || !plain(this.draft); }
  _editable() { return !this._blocked() && plain(this._rows()[this.selectedIndex])
    && (this._report().rows[this.selectedIndex]?.ready || this.repairIndex === this.selectedIndex); }
  _evaluation() {
    const report = this._report(), issues = readFurniturePlacement(this.draft).diagnostics.map((entry) => this._diagnostic(entry));
    if (!this._layoutReady()) issues.push(this._t('furniture.waitLayout'));
    if (!this.canEdit) issues.push(this._t('furniture.admin'));
    if (this.stale) issues.push(this._t('furniture.stale'));
    if (this._importPending) issues.push(this._t('furniture.waitImport'));
    for (const index of this._changed) if (this._rows()[index] && !report.rows[index]?.ready)
      issues.push(this._t('furniture.changed', { number: index + 1 }));
    return { report, issues: [...new Set(issues)] };
  }
  _mark(index) {
    if (index !== undefined) this._changed.add(index);
    this.dirty = stamp(this.draft) !== this.base.value; this.message = null; this._syncPreview();
  }
  _syncPreview() {
    if (!this.dirty || this._blocked() || !this._report().valid || typeof this.card.furniturePreviewDraft !== 'function') { this._clearPreview(); return; }
    const key = stamp(this.draft);
    if (key === this._previewKey) return;
    try { this.card.furniturePreviewDraft(clone(this.draft)); this._previewOwned = true; this._previewKey = key; }
    catch { this.message = this._notice('furniture.previewUnavailable'); this._clearPreview(); }
  }
  _choices() {
    const catalogue = this._library().catalogue;
    if (!Array.isArray(catalogue?.packs) || catalogue.packs.length > FURNITURE_PLACEMENT_LIMITS.packs) return [];
    return catalogue.packs.flatMap((pack) => Array.isArray(pack?.items) && pack.items.length <= 32 ? pack.items.map((item) => {
      const reference = { pack_id: pack.pack_id, item_id: item?.id, asset_sha256: item?.sha256 }, result = resolveFurnitureAsset(catalogue, reference);
      return result.ready ? { ...reference, pack, item } : null;
    }).filter(Boolean) : []);
  }
  _newChoice() { return this._choices().find((entry) => entry.pack_id === this.newPack && entry.item_id === this.newItem); }
  _newId() { let index = 1; while (this._rows().some((row) => row?.id === `furniture_${index}`)) index++; return `furniture_${index}`; }
  _intent(index = this.selectedIndex) { return `${this._epoch}:${index}:${stamp(this._rows()[index])}`; }
  _options(choices, selected, placeholder = this._t('furniture.choose')) {
    return `${choices.some(([value]) => value === selected) ? '' : `<option value="" selected disabled>${esc(selected ? this._t('furniture.unavailableChoice', { value: selected }) : placeholder)}</option>`}
      ${choices.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('')}`;
  }
  _packChoices() { const unique = new Map(); for (const entry of this._choices()) unique.set(entry.pack_id, entry.pack.manifest?.name || entry.pack_id); return [...unique]; }
  _floorChoices() { return this._floors().filter((floor) => this._floor(floor?.id) === floor).map((floor) => [floor.id, floor.name || floor.id]); }
  _select(field, label, choices, selected, disabled, intent = '') {
    return `<label>${label}<select data-field="${prefix}${field}" data-furniture-intent="${esc(intent)}" ${disabled ? 'disabled' : ''}>${this._options(choices, selected)}</select></label>`;
  }
  _formHtml() {
    const row = this._rows()[this.selectedIndex], intent = this._intent(), disabled = !this._editable();
    if (row === undefined) return `<p>${this._caption('furniture.selectHint')}</p>`;
    const value = (key) => plain(row) && Object.hasOwn(row, key) ? row[key] : optionalDefaults[key];
    const input = (key, label, attributes = '') => `<label>${label}<input data-field="${prefix}${key}" data-furniture-intent="${esc(intent)}" ${attributes}
      value="${esc(['string', 'number'].includes(typeof value(key)) ? value(key) : '')}" ${disabled ? 'disabled' : ''}></label>`;
    return `${input('id', this._caption('furniture.id'), 'maxlength="64"')}
      ${this._select('pack_id', this._caption('furniture.exactPack'), this._packChoices(), row?.pack_id, disabled, intent)}
      ${this._select('item_id', this._caption('furniture.exactItem'), this._choices().filter((entry) => entry.pack_id === row?.pack_id).map((entry) => [entry.item_id, entry.item.name || entry.item_id]), row?.item_id, disabled, intent)}
      <details><summary>${this._caption('furniture.identity')}</summary><p>${this._caption('furniture.hash')} <span data-furniture-asset>${esc(row?.asset_sha256 || this._t('furniture.chooseItem'))}</span></p></details>
      ${this._select('floor_id', this._caption('furniture.exactFloor'), this._floorChoices(), row?.floor_id, disabled, intent)}
      ${input('x', this._caption('furniture.x'), 'type="number" min="-1000" max="1000" step="any"')}
      ${input('y', this._caption('furniture.y'), 'type="number" min="-1000" max="1000" step="any"')}
      ${input('z', this._caption('furniture.z'), 'type="number" min="-1000" max="1000" step="any"')}
      ${input('rotation_degrees', this._caption('furniture.rotation'), 'type="number" step="any"')}
      ${input('scale', this._caption('furniture.scale'), 'type="number" min="0.05" max="10" step="any"')}`;
  }
  _statusHtml() {
    const library = this._library(), { report, issues } = this._evaluation();
    const warnings = report.diagnostics.filter((entry) => ['floor_unavailable', 'catalogue_unavailable', 'pack_unavailable', 'item_unavailable'].includes(entry.code));
    return `<p>${esc(this._t('furniture.library', { status: this._t(`furniture.${library.status}`), message: library.message || '' }))}</p>${library.status === 'ready' && !library.catalogue.packs.length ? `<p>${this._caption('furniture.noPacks')}</p>` : ''}
      ${this._importPending ? `<p>${this._caption('furniture.importing')}</p>` : ''}${this.dirty ? `<p>${this._caption('furniture.unsaved')}</p>` : ''}
      ${typeof this.card.furniturePreviewDraft !== 'function' ? `<p>${this._caption('furniture.noPreview')}</p>` : `<p>${this._caption('furniture.previewHelp')}</p>`}
      ${this.message ? `<p role="status">${esc(this.message)}</p>` : ''}${issues.length ? `<ul role="status">${issues.map((message) => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}
      ${warnings.length ? `<ul>${warnings.map((entry) => `<li>${esc(this._t('furniture.warning', { number: entry.index + 1, message: this._diagnostic(entry) }))}</li>`).join('')}</ul>` : ''}`;
  }
  render() {
    if (this.disposed) return ''; this._ensure(); const choices = this._choices(), blocked = this._blocked();
    return `<section data-furniture-editor data-taylors3d-ui="furniture-editor"><style>
      [data-furniture-editor]{min-width:0;color:var(--taylors3d-ui-text,var(--primary-text-color,#212121));margin-bottom:20px}
      [data-furniture-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0;overflow-wrap:anywhere}
      [data-furniture-editor] input,[data-furniture-editor] select,[data-furniture-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--taylors3d-ui-text,var(--primary-text-color,#212121));background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#fff)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-furniture-editor] input,[data-furniture-editor] select{width:100%;min-width:0}[data-furniture-editor] p,[data-furniture-editor] li{overflow-wrap:anywhere}
      [data-furniture-editor] :focus-visible{outline:3px solid var(--taylors3d-ui-text,var(--primary-text-color,#212121));outline-offset:2px}[data-furniture-editor] :disabled{opacity:.6;cursor:default}
      [data-furniture-editor] .furniture-actions{display:flex;gap:8px;flex-wrap:wrap}[data-furniture-editor] button{cursor:pointer;min-width:44px}
      </style><h3>${this._caption('furniture.title')}</h3><p>${this._caption('furniture.intro')}</p>
      <label>${this._caption('furniture.zip')}<input type="file" accept=".zip,application/zip" data-field="${prefix}import-file" ${!this.canEdit || this.dirty || this._importPending || typeof this.card.furnitureLibrary?.importPack !== 'function' ? 'disabled' : ''}></label>
      <button type="button" data-act="${prefix}import" ${!this._canImport() ? 'disabled' : ''}>${this._caption('furniture.import')}</button>
      <h4>${this._caption('furniture.addTitle')}</h4>
      ${this._select('new-pack', this._caption('furniture.pack'), this._packChoices(), this.newPack, blocked || !choices.length)}
      ${this._select('new-item', this._caption('furniture.item'), choices.filter((entry) => entry.pack_id === this.newPack).map((entry) => [entry.item_id, entry.item.name || entry.item_id]), this.newItem, blocked || !this.newPack)}
      ${this._select('new-floor', this._caption('furniture.placeFloor'), this._floorChoices(), this.newFloor, blocked)}
      <p>${this._caption('furniture.newHint')}</p>
      <button type="button" data-act="${prefix}add" ${blocked || !this._newChoice() || !this._floor(this.newFloor) || this._rows().length >= 128 ? 'disabled' : ''}>${this._caption('furniture.add')}</button>
      <h4>${this._caption('furniture.instances')}</h4><select data-field="${prefix}selected" data-editor-extra-aria="furniture.instanceAria" aria-label="${esc(this._t('furniture.instanceAria'))}" ${!this._rows().length ? 'disabled' : ''}>${this._rows().map((row, index) => `<option value="${index}" ${index === this.selectedIndex ? 'selected' : ''}>${esc(row?.id || this._t('furniture.malformedInstance', { number: index + 1 }))}</option>`).join('')}</select>
      <div data-furniture-form>${this._formHtml()}</div><div class="furniture-actions">
      <button type="button" data-act="${prefix}copy" data-furniture-intent="${esc(this._intent())}" ${blocked || this._rows().length >= 128 || !this._report().rows[this.selectedIndex]?.ready ? 'disabled' : ''}>${this._caption('furniture.copy')}</button>
      <button type="button" data-act="${prefix}remove" data-furniture-intent="${esc(this._intent())}" ${blocked || this.selectedIndex < 0 ? 'disabled' : ''}>${this._caption('furniture.remove')}</button>
      <button type="button" data-act="${prefix}repair-instance" data-furniture-intent="${esc(this._intent())}" ${blocked || this.selectedIndex < 0 ? 'disabled' : ''}>${this._caption('furniture.repair')}</button></div>
      <div data-furniture-status aria-live="polite">${this._statusHtml()}</div><div class="furniture-actions">
      <button type="button" data-act="${prefix}save" ${!this.dirty || this._evaluation().issues.length ? 'disabled' : ''}>${this._caption('furniture.save')}</button><button type="button" data-act="${prefix}cancel">${this._caption('common.cancel')}</button>
      <button type="button" data-act="${prefix}repair-settings" ${!this.canEdit || this.stale || this._importPending ? 'disabled' : ''}>${this._caption('furniture.repairSettings')}</button></div></section>`;
  }
  updatePreviews(container) {
    if (this.disposed) return; const epoch = this._epoch; this._ensure(); this._syncPreview();
    const root = container?.matches?.('[data-furniture-editor]') ? container : container?.querySelector?.('[data-furniture-editor]'); if (!root) return;
    updateEditorExtraCaptions(root, this.card._hass);
    this._bind(root);
    this._container = container;
    if (epoch !== this._epoch && !this.dirty) { this.onRender(); return; }
    const status = root.querySelector('[data-furniture-status]'), html = this._statusHtml(); if (status.innerHTML !== html) status.innerHTML = html;
    const disabled = !this._editable(), intent = this._intent();
    for (const control of root.querySelectorAll('[data-furniture-form] input,[data-furniture-form] select')) {
      control.disabled = disabled; control.dataset.furnitureIntent = intent;
      const key = control.dataset.field.slice(prefix.length), row = this._rows()[this.selectedIndex];
      const value = plain(row) && Object.hasOwn(row, key) ? row[key] : optionalDefaults[key];
      if (control !== control.getRootNode().activeElement && ['string', 'number'].includes(typeof value)) control.value = String(value);
    }
    const selectedRow = this._rows()[this.selectedIndex], choices = this._choices();
    const selections = [
      ['new-pack', this._packChoices(), this.newPack],
      ['new-item', choices.filter((entry) => entry.pack_id === this.newPack).map((entry) => [entry.item_id, entry.item.name || entry.item_id]), this.newItem],
      ['new-floor', this._floorChoices(), this.newFloor],
      ['pack_id', this._packChoices(), selectedRow?.pack_id],
      ['item_id', choices.filter((entry) => entry.pack_id === selectedRow?.pack_id).map((entry) => [entry.item_id, entry.item.name || entry.item_id]), selectedRow?.item_id],
      ['floor_id', this._floorChoices(), selectedRow?.floor_id],
    ];
    for (const [field, values, selected] of selections) {
      const select = root.querySelector(`[data-field="${prefix}${field}"]`);
      // An unavailable raw reference is displayed by the explicit disabled placeholder.
      if (select) syncEditorOptions(select, this._options(values, selected),
        typeof selected === 'string' && values.some(([value]) => value === selected) ? selected : '');
    }
    const instanceSelect = root.querySelector(`[data-field="${prefix}selected"]`);
    syncEditorOptions(instanceSelect, this._rows().map((row, index) => `<option value="${index}">${esc(row?.id || this._t('furniture.malformedInstance', { number: index + 1 }))}</option>`).join(''), String(this.selectedIndex));
    const asset = root.querySelector('[data-furniture-asset]');
    if (asset) asset.textContent = selectedRow?.asset_sha256 || this._t('furniture.chooseItem');
    for (const key of ['copy', 'remove', 'repair-instance']) {
      const button = root.querySelector(`[data-act="${prefix}${key}"]`); button.dataset.furnitureIntent = intent;
      button.disabled = this._blocked() || this.selectedIndex < 0 || key === 'copy' && (this._rows().length >= 128 || !this._report().rows[this.selectedIndex]?.ready);
    }
    root.querySelector(`[data-act="${prefix}repair-settings"]`).disabled = !this.canEdit || this.stale || this._importPending;
    root.querySelector(`[data-field="${prefix}import-file"]`).disabled = !this.canEdit || this.stale || this.dirty || this._importPending || typeof this.card.furnitureLibrary?.importPack !== 'function';
    for (const key of ['new-pack', 'new-item', 'new-floor']) root.querySelector(`[data-field="${prefix}${key}"]`).disabled = this._blocked()
      || key === 'new-pack' && !this._choices().length || key === 'new-item' && !this.newPack;
    const save = root.querySelector(`[data-act="${prefix}save"]`); save.disabled = !this.dirty || this._evaluation().issues.length > 0;
    const add = root.querySelector(`[data-act="${prefix}add"]`); add.disabled = this._blocked() || !this._newChoice() || !this._floor(this.newFloor) || this._rows().length >= 128;
    root.querySelector(`[data-act="${prefix}import"]`).disabled = !this._canImport();
    this._revalidatePresses();
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith(prefix) || !element) return false; this._ensure(); const key = field.slice(prefix.length);
    if (key === 'selected') { const index = Number(element.value); if (Number.isInteger(index) && index >= 0 && index < this._rows().length) {
      this.selectedIndex = index; this.repairIndex = -1; this._epoch++; this.onRender(); } return true; }
    if (key === 'import-file') { if (this.canEdit && !this.dirty && !this._importPending) this.file = element.files?.[0] || null; this.updatePreviews(element.closest('[data-furniture-editor]')); return true; }
    if (this._blocked()) return true;
    if (key.startsWith('new-')) {
      if (key === 'new-pack') { this.newPack = element.value; this.newItem = ''; }
      if (key === 'new-item') this.newItem = element.value;
      if (key === 'new-floor') this.newFloor = element.value;
      this.onRender(); return true;
    }
    if (!rowFields.has(key) || !this._editable() || element.dataset.furnitureIntent !== this._intent()) return true;
    const row = this._rows()[this.selectedIndex];
    if (['id', 'pack_id', 'item_id', 'floor_id'].includes(key)) {
      if (key === 'item_id') {
        const choice = this._choices().find((entry) => entry.pack_id === row.pack_id && entry.item_id === element.value);
        if (!choice) return true; row.item_id = choice.item_id; row.asset_sha256 = choice.asset_sha256;
      } else row[key] = element.value;
      this.repairIndex = this.selectedIndex; this._epoch++;
    } else { row[key] = number(element.value); this.repairIndex = this.selectedIndex; }
    this._mark(this.selectedIndex);
    if (['pack_id', 'item_id', 'floor_id'].includes(key)) this.onRender(); else this.updatePreviews(element.closest('[data-furniture-editor]'));
    return true;
  }
  onInput(field, element) { return this.onChange(field, element); }
  onClick(action, element) {
    if (this.disposed || !action?.startsWith(prefix)) return false; this._ensure(); const kind = action.slice(prefix.length);
    if (element && (!this._consume(element) || element.dataset.act !== action)) return true;
    if (kind === 'cancel') { this.reset(); this.onRender(); return true; }
    if (kind === 'import') { this._import(); return true; }
    if (kind === 'save') {
      const { issues } = this._evaluation();
      if (!this.dirty || issues.length || typeof this.card.commitFeatureLayout !== 'function') { this.message = issues[0] || this._notice('furniture.change'); this.onRender(); return true; }
      this._clearPreview(); this.card.commitFeatureLayout({ furniture: clone(this.draft) }, this._t('furniture.title')); this.reset(); this.onRender(); return true;
    }
    if (kind === 'repair-settings' && this.canEdit && !this.stale && !this._importPending) {
      this.draft = { ...(plain(this.draft) ? this.draft : {}), version: 1, instances: Array.isArray(this.draft?.instances) ? this.draft.instances : [] };
      this._mark(); this.onRender(); return true;
    }
    if (this._blocked()) return true;
    if (kind === 'add') {
      const choice = this._newChoice(); if (!choice || !this._floor(this.newFloor) || this._rows().length >= 128 || !Array.isArray(this.draft.instances)) return true;
      this.draft.instances.push({ id: this._newId(), pack_id: choice.pack_id, item_id: choice.item_id, asset_sha256: choice.asset_sha256,
        floor_id: this.newFloor, x: 0, y: 0, z: 0, rotation_degrees: 0, scale: 1 }); this.selectedIndex = this._rows().length - 1; this._epoch++; this._mark(this.selectedIndex); this.onRender(); return true;
    }
    if (!['copy', 'remove', 'repair-instance'].includes(kind) || element?.dataset?.furnitureIntent !== this._intent() || this.selectedIndex < 0) return true;
    const row = this._rows()[this.selectedIndex];
    if (kind === 'copy' && this._rows().length < 128 && this._report().rows[this.selectedIndex]?.ready) {
      this.draft.instances.push({ ...clone(row), id: this._newId() }); this.selectedIndex = this._rows().length - 1; this._epoch++; this._mark(this.selectedIndex);
    } else if (kind === 'remove') {
      const removed = this.selectedIndex; this.draft.instances.splice(removed, 1);
      this._changed = new Set([...this._changed].filter((index) => index !== removed).map((index) => index > removed ? index - 1 : index));
      this.selectedIndex = Math.min(removed, this._rows().length - 1); this._epoch++; this._mark();
    } else if (kind === 'repair-instance') {
      if (!plain(row)) { this.draft.instances[this.selectedIndex] = { id: this._newId(), pack_id: '', item_id: '', asset_sha256: '', floor_id: '', x: '', y: '' }; this._mark(this.selectedIndex); }
      this.repairIndex = this.selectedIndex; this._epoch++;
    }
    this.onRender(); return true;
  }
  _canImport() { return this.canEdit && !this.stale && !this.dirty && !this._importPending && this.file instanceof File && typeof this.card.furnitureLibrary?.importPack === 'function'; }
  async _import() {
    if (!this._canImport()) return;
    const context = this._context(), epoch = this._epoch, file = this.file; this._importPending = true; this.message = null; this.onRender();
    try {
      const result = await this.card.furnitureLibrary.importPack(file);
      if (this.disposed || epoch !== this._epoch || !this.canEdit || !this._same(context, this._context(), false)) return;
      this.base.catalogue = this._context().catalogue;
      this.message = result?.ok === true
        ? this._notice('furniture.imported') : result?.diagnostics?.[0]?.message
          ? furnitureRuntimeNotice(result.diagnostics[0]) : this._notice('furniture.importFailed');
      this.file = null;
    } catch {
      if (!this.disposed && epoch === this._epoch && this.canEdit && this._same(context, this._context(), false)) this.message = this._notice('furniture.importError');
    } finally {
      if (!this.disposed && epoch === this._epoch) { this._importPending = false; this.onRender(); }
    }
  }
  draftPlacementHandles() {
    if (this.disposed) return []; this._ensure(); if (this._blocked()) return [];
    return this._report().rows.filter((row) => row.ready).map(({ index, instance }) => ({ id: instance.id, floor_id: instance.floor_id,
      x: instance.x, y: instance.y, z: instance.z, token: `${this._epoch}:${index}:${stamp([instance.id, instance.pack_id, instance.item_id, instance.asset_sha256, instance.floor_id])}` }));
  }
  moveDraftInstance(id, patch, token = patch?.token) {
    if (this.disposed || !plain(patch)) return false; this._ensure(); if (this._blocked()) return false;
    const handles = this.draftPlacementHandles().filter((handle) => handle.id === id), handle = handles[0];
    if (handles.length !== 1 || typeof token !== 'string' || token !== handle.token || !Object.hasOwn(patch, 'x') || !Object.hasOwn(patch, 'y')) return false;
    const index = this._rows().findIndex((row) => row?.id === id), original = this._rows()[index];
    const next = { ...original, x: patch.x, y: patch.y, ...(Object.hasOwn(patch, 'z') ? { z: patch.z } : {}), ...(Object.hasOwn(patch, 'floor_id') ? { floor_id: patch.floor_id } : {}) };
    if (!readFurniturePlacement({ version: 1, instances: [next] }).valid || !this._floor(next.floor_id)) return false;
    this.draft.instances[index] = next; const floorChanged = next.floor_id !== original.floor_id;
    if (floorChanged) this._epoch++; this._mark(index);
    if (floorChanged) this.onRender(); else this.updatePreviews(this._container);
    return true;
  }
  reset() { this._clearPreview(); this._unbind(); this._epoch++; this.draft = null; this._loaded = false; this.dirty = false; this.stale = false;
    this.selectedIndex = -1; this.repairIndex = -1; this._changed.clear(); this.file = null; this._importPending = false; this.message = null; }
  cancel() { this.reset(); }
  dispose() { this.reset(); this.disposed = true; }
}
