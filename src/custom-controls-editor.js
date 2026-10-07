// Visual draft builder. Only Save writes shared layout; previews never dispatch actions.
import { CUSTOM_CONTROL_LIMITS, CUSTOM_CONTROL_COLORS, CUSTOM_CONTROL_ACTIONS, readCustomControls,
  customControlAvailability, customControlVisibility, replaceCustomBars, moveCustomBar, moveCustomButton } from './custom-controls.js';
import { CUSTOM_CONTROL_ICONS, searchCustomControlIcons } from './custom-controls-icons.js';
import { CustomControlsDrag } from './custom-controls-drag.js';
import { entityChoices } from './entity-metadata.js';
import { inspectSourceValue } from './imported-source-controls.js';
import { syncEditorOptions } from './editor-extra-localization.js';
import { localeInfo, localize } from './localization.js';
import messages from './translations/custom-controls.js';

const prefix = 'custom-controls-', UNREADABLE = Symbol('unreadable');
const field = (value, key) => {
  try { const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : null;
    return descriptor ? Object.hasOwn(descriptor, 'value') ? descriptor.value : UNREADABLE : undefined;
  } catch { return UNREADABLE; }
};
const stamp = (value) => { try { return inspectSourceValue(clone(value, true)).signature ?? 'unreadable'; } catch { return 'unreadable'; } };
// Valid source data may be frozen or contain inert non-enumerable extensions.
// Copy descriptors without executing getters or dropping those extensions.
const clone = (value, enumerate = false) => {
  let nodes = 0; const seen = new Set();
  const visit = (entry, depth) => {
    if (++nodes > 10000 || depth > 24) throw Error('unreadable');
    if (entry === null || entry === undefined || ['string', 'boolean'].includes(typeof entry) || typeof entry === 'number' && Number.isFinite(entry)) return entry;
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry) && ![Object.prototype, null].includes(Object.getPrototypeOf(entry)) || seen.has(entry)) throw Error('unreadable');
    seen.add(entry); const out = Array.isArray(entry) ? [] : Object.create(Object.getPrototypeOf(entry));
    for (const key of Reflect.ownKeys(entry)) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (typeof key !== 'string' || !descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('unreadable');
      Object.defineProperty(out, key, { value: visit(descriptor.value, depth + 1), enumerable: enumerate && !(Array.isArray(entry) && key === 'length') || descriptor.enumerable,
        configurable: !(Array.isArray(entry) && key === 'length'), writable: true });
    }
    seen.delete(entry); return out;
  };
  return visit(value, 0);
};
const updated = (value, patch) => {
  const next = clone(value);
  for (const [key, entry] of Object.entries(patch)) Object.defineProperty(next, key, { value: entry, enumerable: true, configurable: true, writable: true });
  return next;
};
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const option = (id, label, selected, disabled = false) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</option>`;
const domains = { scene: ['scene'], script: ['script'], automation: ['automation'], toggle: ['light', 'switch', 'fan', 'input_boolean'] };

export class CustomControlsEditor {
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.disposed = false; this._epoch = 0; this._loaded = false;
    this.dirty = false; this.stale = false; this._root = null; this._intents = new WeakMap(); this._pressed = new Map();
    this._handlers = new Map([['pointerdown', (event) => this._press(event)], ['pointerup', (event) => this._release(event)],
      ['pointercancel', (event) => this._release(event, true)], ['keydown', (event) => this._keyDown(event)],
      ['keyup', (event) => this._release(event)], ['focusout', (event) => this._cancelFocus(event)],
      ['toggle', (event) => { if (event.target.matches?.('.cc-icon-picker') && event.target.open) this.updatePreviews(this._root); }]]);
  }
  get hass() { return this.card._hass || {}; }
  get effective() { return Object.hasOwn(this.card._layout || {}, 'custom_controls') ? field(this.card._layout, 'custom_controls') : field(this.card._config, 'custom_controls'); }
  get canEdit() {
    const user = this.hass.user;
    return !this.disposed && this.card.isConnected === true && this.hass.connection?.connected === true
      && typeof user?.id === 'string' && !!user.id.trim() && user.is_admin === true
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true) && this.card._loading !== true && !this.card._customControlsModelLoad
      && this.card._editing === true && this.card._edit?.tab === 'controls';
  }
  _t(key, params = {}) {
    const name = `controls.editor.${key}`, language = localeInfo(this.hass).resolved;
    return localize(this.hass, name, params, messages[language]?.[name] ?? messages.en[name] ?? key);
  }
  _views() { try { return Array.isArray(this.card._views) ? clone(this.card._views) : []; } catch { return []; } }
  _rooms() {
    let list, floors;
    try { list = clone(this.card._roomList); floors = clone(this.card._floors); } catch { return []; }
    if (!Array.isArray(list) || !Array.isArray(floors)) return [];
    return list.flatMap((entry) => {
      const room = entry?.room, id = room?.id, floorId = entry?.floorId ?? room?.floor_id ?? room?.floorId;
      const matches = floors.filter((floor) => floor?.id === floorId), floor = matches[0];
      if (typeof id !== 'string' || !id || list.filter((row) => row?.room?.id === id).length !== 1
        || matches.length !== 1 || floor.stale || !Number.isFinite(floor.elevation)
        || room.floor_id !== undefined && room.floor_id !== floorId || room.floorId !== undefined && room.floorId !== floorId) return [];
      return [{ ...room, name: entry.name || room.name || id, floor_id: floorId, elevation: floor.elevation }];
    });
  }
  _availability(action) { return customControlAvailability({ hass: this.hass, action, views: this._views(), rooms: this._rooms() }); }
  _bars() { return this._editable && Array.isArray(this.draft?.bars) ? this.draft.bars : []; }
  _bar(id) { return this._bars().find((bar) => bar.id === id); }
  _button(barId, id) { return this._bar(barId)?.buttons.find((button) => button.id === id); }
  _context() {
    const config = this.card._config || {}, layout = this.card._layout || {}, user = this.hass.user, actions = [];
    for (const settings of [this.effective, this.draft]) {
      // Core reads own values only; imported accessors are never evaluated here.
      for (const bar of readCustomControls(settings).bars) for (const button of bar.buttons) {
        actions.push(button.action); if (button.visibility) actions.push({ type: 'more-info', entity: button.visibility.entity });
      }
    }
    // Include a partial new source after editing, even while the draft is not yet valid.
    if (this._editable) for (const bar of this._bars()) for (const button of bar.buttons) {
      actions.push(button.action); if (button.visibility) actions.push({ type: 'more-info', entity: button.visibility.entity });
    }
    return { connection: this.hass.connection, auth: this.hass.auth, root: this.card._view?.model?.root,
      pending: this.card._customControlsModelLoad?.promise,
      key: JSON.stringify([config.layout_key, config.model, config.model_position, config.model_rotation, config.model_scale,
        this.card._edit?._generation, this.card.isConnected, this.card._editing, this.card._edit?.tab, this.card._loading, !!this.card._customControlsModelLoad,
        user?.id, user?.is_admin, user?.is_active, user?.permissions, this.hass.connection?.connected,
        Object.hasOwn(layout, 'custom_controls') ? 'layout' : Object.hasOwn(config, 'custom_controls') ? 'config' : 'default',
        this._rooms().map((room) => [room.id, room.floor_id, room.area_id, room.elevation, room.polygon, room.outline]),
        this._views().map((view) => ['id', 'rules', 'camera', 'cameraFrame', 'camera_topFrame', 'floors', 'cut', 'source',
          'hidden', 'section', 'modelSection', 'camera_top', 'camera_mode', 'zoom_to'].map((key) => field(view, key))),
        actions.map((action) => { const result = this._availability(action);
          const id = field(action, 'entity'), registry = field(field(this.hass, 'entities'), id), source = field(field(this.hass, 'states'), id);
          return [action, result.available, result.issueCode, result.domain, result.service,
            ['entity_id', 'device_id', 'area_id', 'disabled_by', 'hidden_by', 'entity_category'].map((key) => stamp(field(registry, key))),
            stamp(field(source, 'entity_id')), stamp(field(field(source, 'attributes'), 'restored'))]; })].map((value) => stamp(value))),
      layout: stamp(layout), value: stamp(this.effective) };
  }
  _same(a, b) { return !!a && !!b && ['connection', 'auth', 'root', 'pending', 'key', 'layout', 'value'].every((key) => a[key] === b[key]); }
  _load() {
    const readable = inspectSourceValue(this.effective).readable, parsed = readCustomControls(this.effective);
    this.draft = readable ? this.effective === undefined ? { version: 1, bars: [] } : parsed.valid ? clone(this.effective) : this.effective : null;
    this._editable = readable && parsed.valid; this.baseDraft = stamp(this.draft); this.dirty = false; this.stale = false;
    this.message = null; this.moveTargets = new Map(); this.searches = new Map(); this.duplicateOrigins = new Map(); this._loaded = true; this._epoch++; this.base = this._context();
  }
  _ensure() {
    if (!this._loaded) this._load();
    if (!this._same(this.base, this._context())) { if (this.dirty) this.stale = true; else this._load(); }
  }
  observe() {
    if (this.disposed || !this._loaded) return;
    this._ensure(); this.drag?.update();
    const context = this._context();
    for (const intent of this._pressed.values()) if (!this._same(intent.context, context) || intent.draft !== stamp(this.draft) || !this._native(intent.node)) intent.valid = false;
  }
  _mark() { this.dirty = stamp(this.draft) !== this.baseDraft; this.message = null; this.base = this._context(); }
  _blocked() { return !this.canEdit || this.stale || !this._editable; }
  _issues() {
    const issues = [];
    if (!this.canEdit) issues.push('session'); if (this.stale) issues.push('stale');
    if (!this._editable) issues.push('unsupported'); else {
      const parsed = readCustomControls(this.draft); if (!parsed.valid) issues.push('invalid');
      if (parsed.diagnostics.some((entry) => entry.code === 'pinned')) issues.push('pinLimit');
      if (parsed.diagnostics.some((entry) => entry.code === 'condition')) issues.push('conditionRule');
    }
    if (this._editable) {
      const before = readCustomControls(this.effective).bars;
      for (const bar of this._bars()) {
        const saved = before.find((old) => old.id === bar.id);
        if (bar.placement === 'room' && (!saved || saved.placement !== bar.placement || saved.room_id !== bar.room_id)
          && !this._rooms().some((room) => room.id === bar.room_id)) issues.push('sourceLost');
        for (const button of bar.buttons) {
          const old = before.flatMap((row) => row.buttons).find((row) => row.id === button.id || row.id === this.duplicateOrigins.get(button.id));
          if ((!old || stamp(old.action) !== stamp(button.action)) && !this._availability(button.action).available) issues.push('sourceLost');
          if (button.visibility && (!old || stamp(old.visibility) !== stamp(button.visibility))
            && ['invalid', 'missing', 'unknown'].includes(customControlVisibility({ hass: this.hass, visibility: button.visibility }).conditionStatus)) issues.push('conditionLost');
        }
      }
    }
    if (this.message) issues.push(this.message); return [...new Set(issues)];
  }
  _native(node) { return !!node && this._root?.contains(node) && node.isConnected && node.dataset.ccEpoch === String(this._epoch); }
  _validRow(node) { return !node?.dataset.ccBar || !!this._bar(node.dataset.ccBar) && (!node.dataset.ccButton || !!this._button(node.dataset.ccBar, node.dataset.ccButton)); }
  _attrs(barId, buttonId) { return `data-cc-epoch="${this._epoch}" ${barId ? `data-cc-bar="${esc(barId)}"` : ''} ${buttonId ? `data-cc-button="${esc(buttonId)}"` : ''}`; }
  _caption(key, tag = 'span') { return `<${tag} data-cc-text="${esc(key)}">${esc(this._t(key))}</${tag}>`; }
  _control(kind, caption, value, { bar, button, select, maxlength, type = 'text' } = {}) {
    const attrs = `${this._attrs(bar, button)} data-field="${prefix}${kind}"`;
    const input = select === undefined ? `<input ${attrs} type="${type}" ${maxlength ? `maxlength="${maxlength}"` : ''} value="${esc(value)}">` : `<select ${attrs}>${select}</select>`;
    return `<label>${this._caption(caption)}${input}</label>`;
  }
  _action(kind, caption, bar, button) { return `<button type="button" data-act="${prefix}${kind}" data-cc-text="${caption}" ${this._attrs(bar, button)}>${esc(this._t(caption))}</button>`; }
  _handle(kind, bar, button) { return `<button type="button" data-cc-drag="${kind}" data-cc-aria="${kind === 'bar' ? 'dragBar' : 'dragButton'}" aria-label="${esc(this._t(kind === 'bar' ? 'dragBar' : 'dragButton'))}" ${this._attrs(bar, button)}>⠿</button>`; }
  _choices(action) {
    if (action?.type === 'view') return this._views().map((view) => ({ value: view.id, label: `${view.label || view.name || view.id} (${view.id})`, selectable: this._availability({ type: 'view', view_id: view.id }).available }));
    const safeHass = { states: {}, entities: {}, devices: {}, locale: this.hass.locale, language: this.hass.language };
    for (const key of ['states', 'entities', 'devices']) {
      const values = field(this.hass, key); if (!values || typeof values !== 'object') continue;
      for (const id of Object.keys(values)) {
        const value = field(values, id); if (!inspectSourceValue(value).readable) continue;
        try { safeHass[key][id] = clone(value); } catch { /* Unsafe HA rows are not source choices. */ }
      }
    }
    return entityChoices(safeHass, { domains: domains[action?.type] || [], selected: typeof action?.entity === 'string' ? action.entity : undefined,
      capability: (entry) => this._availability({ ...action, entity: entry.entityId }).available });
  }
  _sourceOptions(action, query = '') {
    const selected = action?.type === 'view' ? action.view_id : action?.entity, words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const rows = this._choices(action).filter((row) => row.value === selected || words.every((word) => `${row.label} ${row.value}`.toLocaleLowerCase().includes(word)));
    if (selected && !rows.some((entry) => entry.value === selected)) rows.push({ value: selected, label: selected, selectable: false });
    return option('', this._t('choose'), selected || '') + rows.map((row) => option(row.value,
      row.selectable ? `${row.label}${row.label.includes(row.value) ? '' : ` (${row.value})`}` : this._t('missing', { name: row.label, id: row.value }), selected, !row.selectable)).join('');
  }
  _visibilityChoices(selected) { return this._choices({ type: 'more-info', entity: selected }).filter((row) => row.selectable || row.value === selected); }
  _visibilityOptions(selected, query = '') {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean), rows = this._visibilityChoices(selected)
      .filter((row) => row.value === selected || words.every((word) => `${row.label} ${row.value}`.toLocaleLowerCase().includes(word)));
    if (selected && !rows.some((entry) => entry.value === selected)) rows.push({ value: selected, label: selected, selectable: false });
    return option('', this._t('choose'), selected || '') + rows.map((row) => option(row.value,
      row.selectable ? `${row.label} (${row.value})` : this._t('missing', { name: row.label, id: row.value }), selected, !row.selectable)).join('');
  }
  _search(id, kind) { return this.searches?.get(`${id}:${kind}`) || ''; }
  _iconsHtml(bar, button) {
    const results = searchCustomControlIcons(this._search(button.id, 'icon'));
    return results.map((entry) => `<button type="button" data-act="${prefix}choose-icon" data-cc-icon="${entry.icon}" ${this._attrs(bar.id, button.id)}
      aria-label="${esc(entry.icon)}" title="${esc(entry.icon)}" aria-pressed="${button.icon === entry.icon}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${entry.path}"></path></svg><span>${esc(entry.name)}</span></button>`).join('')
      || this._caption('noIcons', 'p');
  }
  _iconPicker(bar, button) {
    return `<details class="cc-picker cc-icon-picker"><summary>${this._caption('chooseIcon')} <ha-icon icon="${esc(button.icon)}" aria-hidden="true"></ha-icon><span data-cc-icon-name="${button.id}">${esc(button.icon)}</span></summary>
      ${this._control('icon-search', 'searchIcons', this._search(button.id, 'icon'), { bar: bar.id, button: button.id, type: 'search' })}
      <div class="cc-icon-grid" data-cc-icon-grid="${button.id}"></div>
      ${this._control('icon', 'icon', button.icon, { bar: bar.id, button: button.id, maxlength: CUSTOM_CONTROL_LIMITS.icon })}${this._caption('iconHint', 'p')}</details>`;
  }
  _roomOptions(selected) {
    const rooms = this._rooms(); return option('', this._t('choose'), selected || '')
      + rooms.map((room) => option(room.id, `${room.name || room.id} (${room.id})`, selected)).join('')
      + (selected && !rooms.some((room) => room.id === selected) ? option(selected, this._t('missing', { name: selected, id: selected }), selected, true) : '');
  }
  _namedOptions(values, selected) { return values.map((value) => option(value, this._t(value), selected)).join(''); }
  _moveOptions(barId, buttonId) {
    const selected = this.moveTargets.get(buttonId) || '';
    return option('', this._t('choose'), selected) + this._bars().filter((bar) => bar.id !== barId)
      .map((bar) => option(bar.id, `${bar.label} (${bar.id})`, selected, bar.buttons.length >= CUSTOM_CONTROL_LIMITS.buttonsPerBar)).join('');
  }
  _buttonHtml(bar, button) {
    const opts = { bar: bar.id, button: button.id }, action = button.action;
    return `<div data-cc-button-row="${esc(button.id)}" class="cc-button-row">
      <div class="cc-row-heading">${this._handle('button', bar.id, button.id)}<span data-cc-preview-name="${esc(button.id)}">${esc(button.label)}</span></div>
      <div class="cc-fields">${this._control('button-label', 'buttonName', button.label, { ...opts, maxlength: CUSTOM_CONTROL_LIMITS.label })}
      ${this._control('color', 'color', button.color, { ...opts, select: this._namedOptions(CUSTOM_CONTROL_COLORS, button.color) })}
      ${this._control('action', 'action', action.type, { ...opts, select: this._namedOptions(CUSTOM_CONTROL_ACTIONS, action.type) })}
      ${this._control('source-search', 'searchSources', this._search(button.id, 'source'), { ...opts, type: 'search' })}
      ${this._control('source', action.type === 'view' ? 'viewSource' : 'source', '', { ...opts, select: this._sourceOptions(action, this._search(button.id, 'source')) })}</div>
      ${this._iconPicker(bar, button)}${action.type === 'automation' ? `<label class="cc-check"><input type="checkbox" data-field="${prefix}skip" ${this._attrs(bar.id, button.id)} ${action.skip_conditions === true ? 'checked' : ''}>${this._caption('skip')}</label>${this._caption('conditions', 'p')}` : ''}
      ${bar.dock ? `<label class="cc-check"><input type="checkbox" data-field="${prefix}pinned" ${this._attrs(bar.id, button.id)} ${button.pinned === true ? 'checked' : ''}>${this._caption('pin')}</label>` : ''}
      ${button.starter === 'return-vacuum' && action.type === 'script' ? this._caption('returnHint', 'p') : ''}
      <details class="cc-picker"><summary>${this._caption('visibility')}</summary>
      <label class="cc-check"><input type="checkbox" data-field="${prefix}conditional" ${this._attrs(bar.id, button.id)} ${button.visibility ? 'checked' : ''}>${this._caption('conditional')}</label>
      ${button.visibility ? `<div class="cc-fields">${this._control('condition-search', 'searchSources', this._search(button.id, 'condition'), { ...opts, type: 'search' })}
      ${this._control('condition-source', 'conditionSource', '', { ...opts, select: this._visibilityOptions(button.visibility.entity, this._search(button.id, 'condition')) })}
      ${this._control('condition-state', 'conditionState', button.visibility.state, { ...opts, maxlength: 256 })}</div>${this._caption('conditionHint', 'p')}` : ''}</details>
      <p data-cc-source-status="${esc(button.id)}" role="status"></p>
      <div class="cc-actions">${this._action('button-up', 'up', bar.id, button.id)}${this._action('button-down', 'down', bar.id, button.id)}${this._action('duplicate', 'duplicate', bar.id, button.id)}${this._action('remove-button', 'removeButton', bar.id, button.id)}</div>
      <div class="cc-move">${this._control('move-to', 'moveTo', '', { ...opts, select: this._moveOptions(bar.id, button.id) })}${this._action('move', 'move', bar.id, button.id)}</div></div>`;
  }
  _barHtml(bar) {
    return `<article data-cc-bar-row="${esc(bar.id)}" class="cc-bar">
      <div class="cc-row-heading">${this._handle('bar', bar.id)}<strong data-cc-bar-name="${esc(bar.id)}">${esc(bar.label)}</strong></div>
      <div class="cc-fields">${this._control('bar-label', 'barName', bar.label, { bar: bar.id, maxlength: CUSTOM_CONTROL_LIMITS.label })}
      ${this._control('placement', 'placement', bar.placement, { bar: bar.id, select: this._namedOptions(['bottom', 'room'], bar.placement) })}
      ${bar.placement === 'room' ? this._control('room', 'roomSource', bar.room_id, { bar: bar.id, select: this._roomOptions(bar.room_id) }) : ''}
      ${this._control('style', 'style', bar.style, { bar: bar.id, select: this._namedOptions(['pills', 'tiles'], bar.style) })}</div>
      <label class="cc-check"><input type="checkbox" data-field="${prefix}compact" ${this._attrs(bar.id)} ${bar.dock ? 'checked' : ''}>${this._caption('compact')}</label>
      ${bar.dock ? this._control('dock-limit', 'dockLimit', bar.dock.limit, { bar: bar.id, select: [4, 5].map((value) => option(value, value, bar.dock.limit)).join('') }) + this._caption('dockHint', 'p') : ''}
      ${this._caption('preview', 'p')}<div class="cc-preview" data-cc-preview="${esc(bar.id)}" data-cc-style="${bar.style}"></div>
      <div class="cc-actions">${this._action('bar-up', 'up', bar.id)}${this._action('bar-down', 'down', bar.id)}${this._action('remove-bar', 'removeBar', bar.id)}</div>
      <div data-cc-button-list>${bar.buttons.map((button) => this._buttonHtml(bar, button)).join('') || this._caption('emptyBar', 'p')}</div>
      ${this._action('add-button', 'addButton', bar.id)}<details class="cc-picker"><summary>${this._caption('templates')}</summary>
      <div class="cc-actions">${this._action('template-movie', 'movie', bar.id)}${this._action('template-bedtime', 'bedtime', bar.id)}${this._action('template-return-vacuum', 'returnVacuum', bar.id)}</div>${this._caption('templateHint', 'p')}</details></article>`;
  }
  _status() { return `${this._caption(this.dirty ? 'draft' : 'saved', 'p')}${this._issues().map((key) => `<p role="status">${esc(this._t(key))}</p>`).join('')}`; }
  render() {
    if (this.disposed) return ''; this._ensure();
    return `<section data-custom-controls-editor data-cc-epoch="${this._epoch}" data-taylors3d-ui="custom-controls-editor" class="box"><style>
      [data-custom-controls-editor]{--cc-surface:var(--taylors3d-ui-surface,var(--card-background-color,#1d2731));--cc-raised:var(--taylors3d-ui-raised,var(--secondary-background-color,var(--card-background-color,#253340)));--cc-text:var(--taylors3d-ui-text,var(--primary-text-color,#f2f5f7));--cc-muted:var(--taylors3d-ui-muted,var(--secondary-text-color,#bcc7cf));--cc-line:var(--taylors3d-ui-divider,var(--divider-color,#34414e));color:var(--cc-text);min-width:0}
      [data-custom-controls-editor] :is(input,select,button){font:inherit;color:var(--cc-text);box-sizing:border-box;min-height:44px;max-width:100%;border:1px solid var(--cc-line);border-radius:10px;background:var(--cc-raised);padding:9px 11px}
      [data-custom-controls-editor] :is(input,select){width:100%;min-width:0}[data-custom-controls-editor] input[type=checkbox]{width:22px;flex:0 0 22px;accent-color:#ffc767}
      [data-custom-controls-editor] button{cursor:pointer}[data-custom-controls-editor] label{display:flex;flex-direction:column;gap:6px;min-width:0}
      [data-custom-controls-editor] p{font-size:13px;color:var(--cc-muted);overflow-wrap:anywhere;line-height:1.45}
      [data-custom-controls-editor] .cc-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:12px;margin:12px 0}
      [data-custom-controls-editor] .cc-bar{border:1px solid var(--cc-line);border-radius:16px;padding:14px;margin:16px 0;background:var(--cc-surface)}
      [data-custom-controls-editor] .cc-button-row{padding:14px 0;border-top:1px solid var(--cc-line);min-width:0}
      [data-custom-controls-editor] .cc-row-heading{display:flex;gap:10px;align-items:center;overflow-wrap:anywhere}
      [data-custom-controls-editor][data-taylors3d-ui] .cc-row-heading>button[type=button][data-cc-drag]{touch-action:none;min-width:44px;font-size:25px;cursor:grab;color:var(--cc-text)}
      [data-custom-controls-editor] [data-cc-dragging]{cursor:grabbing;outline:2px solid #ffc767}
      [data-custom-controls-editor] [data-cc-drop]{outline:2px solid #51d4c4;outline-offset:2px}
      [data-custom-controls-editor] .cc-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
      [data-custom-controls-editor] .cc-move{display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin:12px 0}[data-custom-controls-editor] .cc-move label{flex:1;min-width:min(100%,160px)}
      [data-custom-controls-editor] .cc-check{flex-direction:row;align-items:center;gap:10px}
      [data-custom-controls-editor] .cc-picker{border:1px solid var(--cc-line);border-radius:12px;padding:0 12px;margin:12px 0;min-width:0}
      [data-custom-controls-editor] .cc-picker>summary{min-height:44px;display:flex;align-items:center;gap:8px;cursor:pointer;overflow-wrap:anywhere}
      [data-custom-controls-editor] .cc-picker[open]{padding-bottom:12px}[data-custom-controls-editor] .cc-picker>summary ha-icon{flex:0 0 24px}
      [data-custom-controls-editor] .cc-icon-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(86px,100%),1fr));gap:8px;max-height:300px;overflow:auto;overscroll-behavior:contain;padding:6px 3px;margin:8px 0}
      [data-custom-controls-editor] .cc-icon-grid>button{display:flex;flex-direction:column;align-items:center;gap:5px;min-height:72px;padding:8px 4px;font-size:11px;overflow-wrap:anywhere;line-height:1.25}
      [data-custom-controls-editor] .cc-icon-grid>button[aria-pressed=true]{border-color:var(--taylors3d-ui-teal,#51d4c4);box-shadow:inset 0 0 0 1px currentColor}
      [data-custom-controls-editor] .cc-icon-grid svg{width:24px;height:24px;fill:currentColor;flex:0 0 24px}
      [data-custom-controls-editor] .cc-preview{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
      [data-custom-controls-editor] .cc-preview>span{display:inline-flex;align-items:center;gap:8px;min-height:44px;box-sizing:border-box;padding:10px 14px;border:1px solid var(--cc-line);border-radius:999px;overflow-wrap:anywhere;max-width:100%;background:var(--cc-raised);color:var(--cc-text)}
      [data-custom-controls-editor] .cc-preview[data-cc-style=tiles]>span{border-radius:12px;flex:1 0 min(120px,100%)}
      [data-custom-controls-editor] .cc-preview>[data-color=amber]{background:#ffc767;color:#35250c;border-color:#ffc767}[data-custom-controls-editor] .cc-preview>[data-color=teal]{background:#51d4c4;color:#07352f;border-color:#51d4c4}
      [data-custom-controls-editor] .cc-preview>[data-color=blue]{background:#9cc8ff;color:#142e50;border-color:#9cc8ff}[data-custom-controls-editor] .cc-preview>[data-color=purple]{background:#d4b5ff;color:#352052;border-color:#d4b5ff}[data-custom-controls-editor] .cc-preview>[data-color=red]{background:#ffb4ab;color:#541f1b;border-color:#ffb4ab}
      [data-custom-controls-editor] :focus-visible{outline:2px solid var(--primary-color,#51d4c4);outline-offset:3px}[data-custom-controls-editor] :disabled{opacity:.55;cursor:default}
      [data-custom-controls-editor][data-taylors3d-ui] .cc-actions>button[type=button][data-act=custom-controls-save]{background:var(--taylors3d-ui-amber,#ffc767);color:var(--taylors3d-ui-on-amber,#35250c);border-color:var(--taylors3d-ui-amber,#ffc767);font-weight:600}
      [data-custom-controls-editor][data-taylors3d-ui] :is(button[data-act],button[data-cc-drag],input[data-field],select[data-field])[data-cc-epoch]:disabled{opacity:1;border-style:dashed;cursor:default;background:var(--cc-raised);color:var(--cc-muted)}
      @media(forced-colors:active){[data-custom-controls-editor] .cc-preview>[data-color]{background:Canvas;color:CanvasText;border-color:CanvasText}[data-custom-controls-editor][data-taylors3d-ui] .cc-actions>button[type=button][data-act=custom-controls-save]{background:ButtonFace;color:ButtonText;border-color:ButtonText}}
      </style>${this._caption('title', 'h3')}${this._caption('description', 'p')}${this._caption('dragHint', 'p')}
      <div data-cc-bars>${this._bars().map((bar) => this._barHtml(bar)).join('') || (this._editable ? this._caption('empty', 'p') : '')}</div>
      ${this._action('add-bar', 'addBar')}<p data-cc-drag-status role="status" aria-live="polite"></p>
      <div data-cc-status aria-live="polite">${this._status()}</div><div class="cc-actions">${this._action('save', 'save')}${this._action('cancel', 'cancel')}${!this._editable ? this._action('replace', 'replace') : ''}</div>
      ${!this._editable ? this._caption('replaceHint', 'p') : ''}${this._caption('limit', 'p')}</section>`;
  }
  _allowed(kind, node) {
    if (kind === 'cancel') return !this.disposed;
    if (!this.canEdit || this.stale) return false;
    if (kind === 'replace') return !this._editable;
    if (kind === 'save') return this.dirty && !this._issues().length;
    if (this._blocked() || !this._validRow(node)) return false;
    const bar = this._bar(node?.dataset.ccBar), button = this._button(bar?.id, node?.dataset.ccButton), bars = this._bars();
    if (kind === 'add-bar') return bars.length < CUSTOM_CONTROL_LIMITS.bars;
    if (kind === 'add-button') return !!bar && bar.buttons.length < CUSTOM_CONTROL_LIMITS.buttonsPerBar && bars.reduce((total, row) => total + row.buttons.length, 0) < CUSTOM_CONTROL_LIMITS.total;
    if (kind.startsWith('template-')) return ['template-movie', 'template-bedtime', 'template-return-vacuum'].includes(kind) && this._allowed('add-button', node);
    if (kind === 'duplicate') return !!button && readCustomControls(this.draft).valid && this._allowed('add-button', node);
    if (kind === 'choose-icon') return !!button && CUSTOM_CONTROL_ICONS.some((entry) => entry.icon === node.dataset.ccIcon);
    if (kind === 'remove-bar') return !!bar;
    if (kind === 'remove-button') return !!button;
    if (kind === 'move') { const to = this._bar(this.moveTargets.get(button?.id)); return !!button && !!to && to !== bar && !!moveCustomButton(this.draft, bar.id, button.id, to.id); }
    if (!readCustomControls(this.draft).valid) return false;
    if (kind === 'bar-up') return bars.indexOf(bar) > 0;
    if (kind === 'bar-down') return !!bar && bars.indexOf(bar) < bars.length - 1;
    if (kind === 'button-up') return !!button && bar.buttons.indexOf(button) > 0;
    if (kind === 'button-down') return !!button && bar.buttons.indexOf(button) < bar.buttons.length - 1;
    return false;
  }
  _bind(root) {
    if (root === this._root) return; this._unbind(); this._root = root;
    for (const [name, handler] of this._handlers) root.addEventListener(name, handler, true);
    this.drag = new CustomControlsDrag(root, { getContext: () => ({ context: this._context(), draft: stamp(this.draft), epoch: this._epoch }),
      sameContext: (a, b) => !!a && !!b && this._same(a.context, b.context) && a.draft === b.draft && a.epoch === b.epoch,
      canDrag: (item) => !this._blocked() && readCustomControls(this.draft).valid && this._native(item.handle)
        && !!this._bar(item.barId) && (item.kind === 'bar' || !!this._button(item.barId, item.buttonId)),
      onMove: (item, destination) => this._moveDraft(item, destination),
      onStatus: (active) => { const status = this._root?.querySelector('[data-cc-drag-status]'); if (status) status.textContent = active ? this._t('dragging') : ''; } });
  }
  _unbind() {
    this.drag?.dispose(); this.drag = null;
    if (this._root) for (const [name, handler] of this._handlers) this._root.removeEventListener(name, handler, true);
    this._root = null; this._pressed.clear();
  }
  updatePreviews(panel) {
    if (this.disposed) return; this.observe();
    const root = panel?.matches?.('[data-custom-controls-editor]') ? panel : panel?.querySelector?.('[data-custom-controls-editor]'); if (!root) return;
    this._bind(root); if (root.dataset.ccEpoch !== String(this._epoch)) { this._requestRender(); return; }
    for (const node of root.querySelectorAll('[data-cc-text]')) { const text = this._t(node.dataset.ccText); if (node.textContent !== text) node.textContent = text; }
    for (const node of root.querySelectorAll('[data-cc-aria]')) node.setAttribute('aria-label', this._t(node.dataset.ccAria));
    const status = root.querySelector('[data-cc-status]'), html = this._status(); if (status.innerHTML !== html) status.innerHTML = html;
    for (const control of root.querySelectorAll('[data-field]')) {
      const kind = control.dataset.field.slice(prefix.length), bar = this._bar(control.dataset.ccBar), button = this._button(bar?.id, control.dataset.ccButton);
      control.disabled = this._blocked();
      if (control.tagName !== 'SELECT') continue;
      const choices = kind === 'source' ? this._sourceOptions(button.action, this._search(button.id, 'source'))
        : kind === 'condition-source' ? this._visibilityOptions(button.visibility?.entity, this._search(button.id, 'condition'))
        : kind === 'dock-limit' ? [4, 5].map((value) => option(value, value, Number(control.value))).join('') : kind === 'room' ? this._roomOptions(bar.room_id)
        : kind === 'move-to' ? this._moveOptions(bar.id, button.id) : this._namedOptions(kind === 'action' ? CUSTOM_CONTROL_ACTIONS
          : kind === 'color' ? CUSTOM_CONTROL_COLORS : kind === 'placement' ? ['bottom', 'room'] : ['pills', 'tiles'], control.value);
      syncEditorOptions(control, choices, control.value);
    }
    for (const node of root.querySelectorAll('button[data-act]')) node.disabled = !this._allowed(node.dataset.act.slice(prefix.length), node);
    for (const handle of root.querySelectorAll('[data-cc-drag]')) handle.disabled = this._blocked() || !readCustomControls(this.draft).valid;
    for (const bar of this._bars()) for (const button of bar.buttons) {
      const grid = [...root.querySelectorAll('[data-cc-icon-grid]')].find((node) => node.dataset.ccIconGrid === button.id);
      if (grid && grid.closest('details')?.open) {
        const signature = JSON.stringify([this._search(button.id, 'icon'), button.icon, this._epoch, this._blocked(), localeInfo(this.hass).resolved]);
        if (grid.dataset.ccSignature !== signature) {
          const focus = grid.getRootNode().activeElement, selected = grid.contains(focus) ? focus.dataset.ccIcon : null;
          grid.innerHTML = this._iconsHtml(bar, button); grid.dataset.ccSignature = signature;
          for (const node of grid.querySelectorAll('button')) node.disabled = this._blocked();
          if (selected) [...grid.querySelectorAll('button')].find((node) => node.dataset.ccIcon === selected)?.focus({ preventScroll: true });
        }
        const caption = grid.parentElement.querySelector('[data-cc-icon-name]'); if (caption) caption.textContent = button.icon;
        grid.parentElement.querySelector('summary ha-icon')?.setAttribute('icon', /^mdi:[a-z0-9-]+$/.test(button.icon) ? button.icon : 'mdi:gesture-tap-button');
      }
    }
    for (const bar of this._bars()) {
      const name = [...root.querySelectorAll('[data-cc-bar-name]')].find((node) => node.dataset.ccBarName === bar.id); if (name) name.textContent = bar.label;
      const preview = [...root.querySelectorAll('[data-cc-preview]')].find((node) => node.dataset.ccPreview === bar.id);
      if (preview) {
        preview.dataset.ccStyle = bar.style;
        const existing = new Map([...preview.children].map((node) => [node.dataset.ccPreviewButton, node]));
        bar.buttons.forEach((button, index) => {
          const node = existing.get(button.id) || root.ownerDocument.createElement('span'); existing.delete(button.id);
          node.dataset.ccPreviewButton = button.id; node.dataset.color = button.color;
          // MDI custom element uses only a validated icon string. No action listener or ID resolver.
          if (!node.firstChild) { node.append(root.ownerDocument.createElement('ha-icon'), root.ownerDocument.createElement('span')); }
          node.firstChild.setAttribute('icon', /^mdi:[a-z0-9-]+$/.test(button.icon) ? button.icon : 'mdi:gesture-tap-button');
          node.lastChild.textContent = button.label; if (preview.children[index] !== node) preview.insertBefore(node, preview.children[index] || null);
          const caption = [...root.querySelectorAll('[data-cc-preview-name]')].find((entry) => entry.dataset.ccPreviewName === button.id); if (caption) caption.textContent = button.label;
          const source = [...root.querySelectorAll('[data-cc-source-status]')].find((entry) => entry.dataset.ccSourceStatus === button.id);
          if (source) source.textContent = this._availability(button.action).available ? '' : this._t('sourceLost');
        });
        for (const node of existing.values()) node.remove();
      }
    }
    const dragging = root.querySelector('[data-cc-drag-status]'); if (dragging) dragging.textContent = this.drag?.active ? this._t('dragging') : '';
  }
  _newId(kind) { const ids = new Set(kind === 'bar' ? this._bars().map((bar) => bar.id) : this._bars().flatMap((bar) => bar.buttons.map((button) => button.id))); let number = 1; while (ids.has(`${kind}_${number}`)) number++; return `${kind}_${number}`; }
  _mutateBar(id, change) {
    this.draft = updated(this.draft, { bars: this._bars().map((bar) => bar.id === id ? change(bar) : bar) }); this._mark();
  }
  onInput(name, element) { return ['bar-label', 'button-label', 'icon', 'icon-search', 'source-search', 'condition-search', 'condition-state'].some((kind) => name === `${prefix}${kind}`) ? this.onChange(name, element) : false; }
  onChange(name, element) {
    if (!name?.startsWith(prefix)) return false; this._ensure();
    if (!this._native(element) || this._blocked() || !this._validRow(element)) return true;
    const kind = name.slice(prefix.length), barId = element.dataset.ccBar, buttonId = element.dataset.ccButton;
    const bar = this._bar(barId), button = this._button(barId, buttonId); if (!bar) return true;
    if (['icon-search', 'source-search', 'condition-search'].includes(kind) && button) {
      this.searches.set(`${button.id}:${kind.split('-')[0]}`, element.value); this.updatePreviews(this._root); return true;
    }
    if (kind === 'move-to') { if (element.value === '' || this._bars().some((row) => row.id === element.value && row.id !== barId && row.buttons.length < CUSTOM_CONTROL_LIMITS.buttonsPerBar)) this.moveTargets.set(buttonId, element.value); this.updatePreviews(this._root); return true; }
    let redraw = false;
    if (['bar-label', 'placement', 'style', 'room', 'compact', 'dock-limit'].includes(kind)) {
      if (kind === 'placement' && !['bottom', 'room'].includes(element.value) || kind === 'style' && !['pills', 'tiles'].includes(element.value)
        || kind === 'room' && !this._rooms().some((room) => room.id === element.value)) return true;
      this._mutateBar(barId, (row) => {
        if (kind === 'compact') { const next = clone(row); if (element.checked) next.dock = { limit: 5 }; else delete next.dock; return next; }
        if (kind === 'dock-limit') return [4, 5].includes(Number(element.value)) && row.dock ? updated(row, { dock: updated(row.dock, { limit: Number(element.value) }) }) : row;
        const next = updated(row, { [kind === 'bar-label' ? 'label' : kind === 'room' ? 'room_id' : kind]: element.value });
        if (kind === 'placement') { if (next.placement === 'room' && typeof next.room_id !== 'string') next.room_id = ''; else if (next.placement === 'bottom') delete next.room_id; }
        return next;
      }); redraw = ['placement', 'compact'].includes(kind);
    } else {
      if (!button) return true; let next = clone(button);
      if (kind === 'button-label') next.label = element.value;
      else if (kind === 'icon') next.icon = element.value;
      else if (kind === 'color' && CUSTOM_CONTROL_COLORS.includes(element.value)) next.color = element.value;
      else if (kind === 'action' && CUSTOM_CONTROL_ACTIONS.includes(element.value)) {
        next.action = updated(button.action, { type: element.value, ...(element.value === 'view' ? { view_id: '' } : { entity: '' }), ...(element.value === 'automation' ? { skip_conditions: false } : {}) });
        if (element.value === 'view') delete next.action.entity; else delete next.action.view_id;
        if (element.value !== 'automation') delete next.action.skip_conditions; redraw = true;
      } else if (kind === 'source' && this._choices(button.action).some((row) => row.value === element.value && row.selectable)) next.action = updated(button.action, { [button.action.type === 'view' ? 'view_id' : 'entity']: element.value });
      else if (kind === 'skip' && button.action.type === 'automation') next.action = updated(button.action, { skip_conditions: element.checked === true });
      else if (kind === 'pinned' && bar.dock) next.pinned = element.checked === true;
      else if (kind === 'conditional') { if (element.checked) next.visibility = { type: 'state', entity: '', state: button.starter === 'return-vacuum' ? 'cleaning' : 'on' }; else delete next.visibility; redraw = true; }
      else if (kind === 'condition-source' && button.visibility && this._visibilityChoices(button.visibility.entity).some((row) => row.value === element.value && row.selectable)) next.visibility = updated(button.visibility, { entity: element.value });
      else if (kind === 'condition-state' && button.visibility) next.visibility = updated(button.visibility, { state: element.value });
      else return true;
      this._mutateBar(barId, (row) => updated(row, { buttons: row.buttons.map((entry) => entry.id === buttonId ? next : entry) }));
    }
    if (redraw) { this._epoch++; this._requestRender(); } else this.updatePreviews(this._root); return true;
  }
  _apply(next) { if (!next || stamp(next) === stamp(this.draft)) return false; this.draft = next; this._mark(); this._epoch++; this._requestRender(); return true; }
  _moveDraft(item, destination) {
    this._ensure(); if (this._blocked()) return false;
    return this._apply(item.kind === 'bar' ? moveCustomBar(this.draft, item.barId, destination.beforeId)
      : moveCustomButton(this.draft, item.barId, item.buttonId, destination.toBarId, destination.beforeId));
  }
  onClick(name, element) {
    if (!name?.startsWith(prefix)) return false; this._ensure(); const kind = name.slice(prefix.length);
    if (!this._native(element) || !this._allowed(kind, element)) return true;
    const intent = this._intents.get(element);
    if (intent && (!intent.valid || intent.consumed || !intent.released || !this._same(intent.context, this._context()) || intent.draft !== stamp(this.draft))) return true;
    if (intent) intent.consumed = true;
    if (kind === 'cancel') { this.reset(); this.onRender(); return true; }
    if (kind === 'save') { const draft = clone(this.draft); this.card.commitFeatureLayout({ custom_controls: draft }); this.reset(); this.onRender(); return true; }
    if (kind === 'replace') { this.draft = { version: 1, bars: [] }; this._editable = true; this._mark(); this._epoch++; this._requestRender(); return true; }
    const barId = element.dataset.ccBar, buttonId = element.dataset.ccButton, bar = this._bar(barId), bars = this._bars(); let next;
    if (kind === 'choose-icon') {
      this._mutateBar(barId, (row) => updated(row, { buttons: row.buttons.map((button) => button.id === buttonId ? updated(button, { icon: element.dataset.ccIcon }) : button) }));
      const input = this._root.querySelector(`[data-field="${prefix}icon"][data-cc-button="${buttonId}"]`); if (input) input.value = element.dataset.ccIcon;
      this.updatePreviews(this._root); return true;
    }
    if (kind === 'add-bar') {
      const id = this._newId('bar'); next = updated(this.draft, { bars: [...bars, { id, label: this._t('newBar', { number: id.slice(4) }), placement: 'bottom', style: 'pills', buttons: [] }] });
    } else if (kind === 'add-button') {
      const id = this._newId('button'); next = updated(this.draft, { bars: bars.map((row) => row.id === barId ? updated(row, { buttons: [...row.buttons,
        { id, label: this._t('newButton', { number: id.slice(7) }), icon: 'mdi:gesture-tap-button', color: 'theme', action: { type: 'more-info', entity: '' } }] }) : row) });
    } else if (kind.startsWith('template-')) {
      const starter = kind.slice(9), id = this._newId('button'), template = starter === 'movie' ? { label: this._t('movie'), icon: 'mdi:movie', color: 'amber', type: 'scene' }
        : starter === 'bedtime' ? { label: this._t('bedtime'), icon: 'mdi:weather-night', color: 'purple', type: 'scene' }
          : { label: this._t('returnVacuum'), icon: 'mdi:robot-vacuum', color: 'teal', type: 'script' };
      next = updated(this.draft, { bars: bars.map((row) => row.id === barId ? updated(row, { buttons: [...row.buttons,
        { id, label: template.label, icon: template.icon, color: template.color, starter, action: { type: template.type, entity: '' } }] }) : row) });
    } else if (kind === 'duplicate') {
      const id = this._newId('button'), duplicate = updated(this._button(barId, buttonId), { id, pinned: false });
      this.duplicateOrigins.set(id, this.duplicateOrigins.get(buttonId) || buttonId);
      const position = bar.buttons.findIndex((row) => row.id === buttonId) + 1, buttons = [...bar.buttons]; buttons.splice(position, 0, duplicate);
      next = updated(this.draft, { bars: bars.map((row) => row.id === barId ? updated(row, { buttons }) : row) });
    } else if (kind === 'remove-bar') next = updated(this.draft, { bars: bars.filter((row) => row.id !== barId) });
    else if (kind === 'remove-button') next = updated(this.draft, { bars: bars.map((row) => row.id === barId ? updated(row, { buttons: row.buttons.filter((entry) => entry.id !== buttonId) }) : row) });
    else if (kind === 'move') next = moveCustomButton(this.draft, barId, buttonId, this.moveTargets.get(buttonId));
    else if (kind.startsWith('bar-')) { const index = bars.indexOf(bar); next = moveCustomBar(this.draft, barId, kind === 'bar-up' ? bars[index - 1].id : bars[index + 2]?.id ?? null); }
    else { const index = bar.buttons.findIndex((row) => row.id === buttonId); next = moveCustomButton(this.draft, barId, buttonId, barId, kind === 'button-up' ? bar.buttons[index - 1].id : bar.buttons[index + 2]?.id ?? null); }
    // Partial unsaved new buttons are intentionally editable until an exact source is selected.
    if (kind === 'add-bar' && readCustomControls(this.draft).valid) next = replaceCustomBars(this.draft, next.bars);
    this._apply(next); return true;
  }
  _requestRender() { if (!this.disposed && this.card._editing && this.card._edit?.tab === 'controls' && this._root?.isConnected) this.onRender(); }
  _press(event) {
    const node = event.target.closest?.(`button[data-act^="${prefix}"]`); if (!node) return;
    this.observe(); const keyboard = event.type === 'keydown'; if (keyboard && event.repeat) return;
    const intent = { node, context: this._context(), draft: stamp(this.draft), valid: this._native(node) && this._allowed(node.dataset.act.slice(prefix.length), node), released: false, consumed: false };
    this._intents.set(node, intent); this._pressed.set(keyboard ? `key:${event.key}` : `pointer:${event.pointerId}`, intent);
  }
  _keyDown(event) { if (['Enter', ' '].includes(event.key) && event.target.closest?.(`button[data-act^="${prefix}"]`)) { event.preventDefault(); this._press(event); } }
  _release(event, cancelled = false) {
    const keyboard = event.type === 'keyup'; if (keyboard && !['Enter', ' '].includes(event.key)) return;
    const key = keyboard ? `key:${event.key}` : `pointer:${event.pointerId}`, intent = this._pressed.get(key); if (!intent) return;
    this.observe(); this._pressed.delete(key); intent.released = true;
    if (cancelled || event.target.closest?.(`button[data-act^="${prefix}"]`) !== intent.node) intent.valid = false;
    if (keyboard) { event.preventDefault(); if (intent.valid) intent.node.click(); }
  }
  _cancelFocus(event) { const intent = this._intents.get(event.target); if (intent && !intent.consumed) intent.valid = false; }
  reset() { this._unbind(); this._loaded = false; this._editable = false; this.draft = null; this.dirty = false; this.stale = false; this._epoch++; this._intents = new WeakMap(); this.moveTargets = new Map(); this.searches = new Map(); this.duplicateOrigins = new Map(); }
  dispose() { this.reset(); this.disposed = true; }
}
