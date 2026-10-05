// Draft-only exact room scene/script shortcuts. Save uses the existing layout history.
import { ROOM_ACTION_LIMITS, readRoomActions, roomActionAvailability, replaceRoomActions } from './room-actions.js';
import { entityChoices, entityMetadata } from './entity-metadata.js';
import { EntityAreaFilter } from './entity-area-filter.js';
import { inspectSourceValue } from './imported-source-controls.js';
import { localeInfo, localize } from './localization.js';
import messages from './translations/room-actions-editor.js';

const prefix = 'room-actions-', UNREADABLE = Symbol('unreadable');
const field = (value, key) => {
  try { const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : null;
    return descriptor ? Object.hasOwn(descriptor, 'value') ? descriptor.value : UNREADABLE : undefined;
  } catch { return UNREADABLE; }
};
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const stamp = (value) => inspectSourceValue(value).signature ?? 'unreadable';
const clone = (value) => structuredClone(value);
const exactSource = (id) => typeof id === 'string' && /^(scene|script)\.[a-z0-9_]+$/.test(id);
const actionId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);

/** Parent calls observe synchronously on HA updates, delegates native fields/actions,
 * and calls updatePreviews after rendering. No preview, timer or device command. */
export class RoomActionsEditor {
  constructor(card, onRender = () => {}) {
    this.areaFilter = new EntityAreaFilter();
    this.card = card; this.onRender = onRender; this.roomId = ''; this.newSource = ''; this.disposed = false;
    this._loaded = false; this._epoch = 0; this.dirty = false; this.stale = false;
    this._root = null; this._intents = new WeakMap(); this._pressed = new Map();
    this._handlers = new Map([['pointerdown', (event) => this._press(event)], ['pointerup', (event) => this._release(event)],
      ['pointercancel', (event) => this._release(event, true)], ['keydown', (event) => this._keyDown(event)],
      ['keyup', (event) => this._release(event)], ['focusout', (event) => this._cancelFocus(event)]]);
  }
  get hass() { return this.card._hass || {}; }
  get effective() {
    return Object.hasOwn(this.card._layout || {}, 'room_actions') ? field(this.card._layout, 'room_actions') : field(this.card._config, 'room_actions');
  }
  _t(key, params = {}) {
    const name = `roomActionsEditor.${key}`, fallback = (messages[localeInfo(this.hass).resolved] || messages.en)[name] || messages.en[name];
    return localize(this.hass, name, params, fallback);
  }
  get canEdit() {
    const user = this.hass.user;
    return !this.disposed && this.card.isConnected === true && this.hass.connection?.connected === true
      && typeof user?.id === 'string' && !!user.id.trim() && user.is_admin === true
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true) && this.card._loading !== true
      && this.card._editing === true && this.card._edit?.tab === 'rooms';
  }
  _rooms() { return Array.isArray(this.card._roomList) ? this.card._roomList : []; }
  _roomCurrent(id) {
    const matches = this._rooms().filter((entry) => entry?.room?.id === id);
    if (matches.length !== 1) return false;
    const entry = matches[0], room = entry.room, floorId = entry.floorId ?? room.floor_id ?? room.floorId;
    if (typeof floorId !== 'string' || !floorId || room.floor_id !== undefined && room.floor_id !== floorId
      || room.floorId !== undefined && room.floorId !== floorId) return false;
    const floors = (this.card._floors || []).filter((floor) => floor?.id === floorId);
    return floors.length === 1 && !floors[0].stale && Number.isFinite(floors[0].elevation);
  }
  _context() {
    const config = this.card._config || {}, layout = this.card._layout || {}, user = this.hass.user;
    const ids = new Set();
    if (exactSource(this.newSource)) ids.add(this.newSource);
    for (const settings of [this.effective, this.draft]) {
      const parsed = readRoomActions(settings);
      for (const row of parsed.rooms) for (const action of row.actions) if (exactSource(field(action, 'entity'))) ids.add(field(action, 'entity'));
    }
    return { connection: this.hass.connection, auth: this.hass.auth, root: this.card._view?.model?.root,
      key: stamp([config.layout_key, config.model, layout.model, config.model_position, config.model_rotation, config.model_scale,
        this.card._edit?._generation, this.card.isConnected, this.card._editing, this.card._edit?.tab, this.card._loading,
        user?.id, user?.is_admin, user?.is_active, user?.permissions, this.hass.connection?.connected,
        Object.hasOwn(layout, 'room_actions') ? 'layout' : Object.hasOwn(config, 'room_actions') ? 'config' : 'default',
        this._rooms().map((entry) => [entry?.room?.id, entry?.floorId, entry?.room?.floor_id, entry?.room?.floorId,
          entry?.room?.area_id, entry?.room?.polygon || entry?.room?.outline]),
        (this.card._floors || []).map((floor) => [floor?.id, floor?.elevation, floor?.stale]),
        [...ids].sort().map((id) => [id, roomActionAvailability(this.hass, id).available])]), value: stamp(this.effective) };
  }
  _same(a, b) { return !!a && !!b && a.connection === b.connection && a.auth === b.auth && a.root === b.root && a.key === b.key && a.value === b.value; }
  _load() {
    const inspection = inspectSourceValue(this.effective);
    this.readable = inspection.readable;
    this.draft = inspection.readable ? this.effective === undefined ? { version: 1, rooms: [] } : clone(this.effective) : null;
    this.baseDraft = stamp(this.draft); this.dirty = false; this.stale = false; this._loaded = true; this.newSource = ''; this.validationMessage = null;
    this._epoch++; this.base = this._context();
  }
  _ensure() {
    if (!this._loaded) this._load();
    const context = this._context();
    if (!this._same(this.base, context)) {
      if (this.dirty) this.stale = true; else this._load();
    }
  }
  observe() { if (this.disposed || !this._loaded) return; this._ensure(); this._pollPresses(); }
  _row() { return readRoomActions(this.draft).rooms.find((room) => room.room_id === this.roomId); }
  _actions() { return this._row()?.actions || []; }
  _removedRooms() {
    const remaining = new Set(readRoomActions(this.draft).rooms.map((row) => row.room_id));
    return readRoomActions(this.effective).rooms.filter((row) => !remaining.has(row.room_id));
  }
  _pendingRemoval(id = this.roomId) { return this._removedRooms().some((row) => row.room_id === id); }
  _roomSelectable(id) { return this._roomCurrent(id) || readRoomActions(this.draft).rooms.some((row) => row.room_id === id) || this._pendingRemoval(id); }
  _knownActions(actions = this._actions()) {
    const ids = actions.map((action) => field(action, 'id'));
    return actions.every((action) => plain(action) && actionId(action.id) && ids.filter((id) => id === action.id).length === 1
      && exactSource(action.entity) && (action.label === undefined || typeof action.label === 'string' && action.label.length <= ROOM_ACTION_LIMITS.label)
      && (action.service === undefined || action.service === 'turn_on'));
  }
  _blocked() { return !this.canEdit || this.stale || !readRoomActions(this.draft).valid || !this._roomCurrent(this.roomId) || !this._knownActions(); }
  _mark() { this.dirty = stamp(this.draft) !== this.baseDraft; this.base = this._context(); }
  _setActions(actions) {
    const next = replaceRoomActions(this.draft, this.roomId, actions);
    if (!next) { this.validationMessage = actions.some((action) => typeof action?.label !== 'string' && action?.label !== undefined || action?.label?.length > ROOM_ACTION_LIMITS.label)
      ? 'labelLimit' : 'limit'; return false; }
    this.validationMessage = null; this.draft = next; this._mark(); return true;
  }
  _choices(selected) {
    return this.areaFilter.choices(this.hass, entityChoices(this.hass, { domains: ['scene', 'script'], selected,
      capability: (metadata) => roomActionAvailability(this.hass, metadata.entityId).available }));
  }
  _options(selected = '', saved = false) {
    return `<option value="" ${!selected ? 'selected' : ''}>${esc(this._t('chooseSource'))}</option>`
      + this._choices(saved && exactSource(selected) ? selected : undefined).map((entry) => `<option value="${esc(entry.value)}" ${entry.value === selected ? 'selected' : ''} ${entry.selectable ? '' : 'disabled'}>${esc(entry.selectable ? entry.name : this._t('sourceWarning', { name: entry.name, entity: entry.value }))}</option>`).join('');
  }
  _roomOptions() {
    const ids = new Set(), options = [{ id: '', label: this._t('chooseRoom'), disabled: false }];
    for (const entry of this._rooms()) {
      const id = entry?.room?.id; if (typeof id !== 'string' || !id || ids.has(id)) continue; ids.add(id);
      const floorId = entry.floorId ?? entry.room.floor_id ?? entry.room.floorId;
      const floor = (this.card._floors || []).find((floor) => floor?.id === floorId);
      options.push({ id, label: `${entry.name || entry.room.name || id} · ${floor?.name || floorId || id} (${id})`, disabled: !this._roomSelectable(id) });
    }
    for (const row of readRoomActions(this.draft).rooms) if (!ids.has(row.room_id)) {
      ids.add(row.room_id); options.push({ id: row.room_id, label: this._t('missingRoom', { id: row.room_id }), disabled: false });
    }
    if (this.roomId && !ids.has(this.roomId)) options.push({ id: this.roomId,
      label: this._t(this._pendingRemoval() ? 'pendingRemoval' : 'missingRoom', { id: this.roomId }), disabled: !this._pendingRemoval() });
    return options.map((entry) => `<option value="${esc(entry.id)}" ${entry.id === this.roomId ? 'selected' : ''} ${entry.disabled ? 'disabled' : ''}>${esc(entry.label)}</option>`).join('');
  }
  _changedRooms() {
    const before = readRoomActions(this.effective).rooms;
    return readRoomActions(this.draft).rooms.filter((row) => stamp(row) !== stamp(before.find((saved) => saved.room_id === row.room_id)));
  }
  _issues() {
    const issues = [];
    if (this.validationMessage) issues.push(this._t(this.validationMessage));
    if (!this.canEdit) issues.push(this._t('session'));
    if (this.stale) issues.push(this._t('stale'));
    if (!this.readable) issues.push(this._t('unreadable'));
    else if (!readRoomActions(this.draft).valid) issues.push(this._t('unsupported'));
    if (readRoomActions(this.draft).valid) {
      for (const row of this._changedRooms()) {
        if (!this._roomCurrent(row.room_id)) issues.push(this._t('roomLost'));
        if (!this._knownActions(row.actions)) issues.push(row.actions.some((action) => typeof action?.label !== 'string' && action?.label !== undefined || action?.label?.length > ROOM_ACTION_LIMITS.label)
          ? this._t('labelLimit') : this._t('malformedActions'));
        const previous = readRoomActions(this.effective).rooms.find((saved) => saved.room_id === row.room_id)?.actions || [];
        for (const action of row.actions) if (!previous.some((old) => old.id === action.id && old.entity === action.entity)
          && !roomActionAvailability(this.hass, action.entity).available) issues.push(this._t('ineligibleSource'));
      }
    }
    return [...new Set(issues)];
  }
  _status() {
    return `${this._caption('p', this.dirty ? 'draft' : 'saved')}${this._issues().map((issue) => `<p role="status">${esc(issue)}</p>`).join('')}
      ${!this.roomId ? this._caption('p', 'noSelection') : !this._roomCurrent(this.roomId) && !this._pendingRemoval() ? this._caption('p', this._row() ? 'reviewOnly' : 'invalidRoom') : ''}
      ${this._removedRooms().length ? `<p>${esc(this._t('removedRooms', { ids: this._removedRooms().map((row) => row.room_id).join(', ') }))}</p>` : ''}
      ${readRoomActions(this.draft).valid && !this._knownActions() ? this._caption('p', 'malformedActions') : ''}`;
  }
  _caption(tag, key) { return `<${tag} data-ra-text="${key}">${esc(this._t(key))}</${tag}>`; }
  _button(kind, key, index) { return `<button type="button" data-act="${prefix}${kind}" data-ra-epoch="${this._epoch}" ${index === undefined ? '' : `data-ra-index="${index}" data-ra-id="${esc(this._actions()[index]?.id)}"`}>${esc(this._t(key))}</button>`; }
  render() {
    if (this.disposed) return ''; this._ensure();
    const known = readRoomActions(this.draft).valid && this._knownActions(), actions = this._actions();
    return `<section data-room-actions-editor data-ra-epoch="${this._epoch}" data-taylors3d-ui="room-actions-editor" class="box"><style>
      [data-room-actions-editor] :is(input,select,button){box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color);background:var(--secondary-background-color,var(--card-background-color));border:1px solid var(--divider-color);border-radius:8px;padding:8px}
      [data-room-actions-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0}[data-room-actions-editor] :is(input,select){width:100%;min-width:0}
      [data-room-actions-editor] p{overflow-wrap:anywhere}[data-room-actions-editor] .ra-buttons{display:flex;gap:7px;flex-wrap:wrap}[data-room-actions-editor] [data-ra-row]{border-bottom:1px solid var(--divider-color);padding-bottom:12px}
      [data-room-actions-editor] :focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}[data-room-actions-editor] :disabled{opacity:.6}
      </style>${this._caption('h3', 'title')}${this._caption('p', 'description')}
      <label>${this._caption('span', 'room')}<select data-field="${prefix}room" data-ra-epoch="${this._epoch}">${this._roomOptions()}</select></label>
      ${this.areaFilter.render(this.hass, `${prefix}area-filter`).replace('<select ', `<select data-ra-epoch="${this._epoch}" `)}
      <div data-ra-list>${known ? actions.map((action, index) => `<div data-ra-row="${index}">
        <label>${this._caption('span', 'source')}<select data-field="${prefix}source" data-ra-index="${index}" data-ra-id="${esc(action.id)}" data-ra-epoch="${this._epoch}">${this._options(action.entity, true)}</select></label>
        <label>${this._caption('span', 'label')}<input data-field="${prefix}label" data-ra-index="${index}" data-ra-id="${esc(action.id)}" data-ra-epoch="${this._epoch}" maxlength="${ROOM_ACTION_LIMITS.label}" value="${esc(action.label || '')}"></label>
        <p data-ra-source-status="${index}"></p><div class="ra-buttons">${this._button('up', 'up', index)}${this._button('down', 'down', index)}${this._button('remove', 'remove', index)}</div></div>`).join('') : ''}
        ${known && this.roomId && !actions.length ? this._caption('p', 'noActions') : ''}</div>
      <label>${this._caption('span', 'newSource')}<select data-field="${prefix}new-source" data-ra-epoch="${this._epoch}">${this._options(this.newSource)}</select></label>
      <div class="ra-buttons">${this._button('add', 'add')}${this._button('replace-actions', 'replaceActions')}${this._button('remove-room', 'removeRoom')}</div>
      <div data-ra-status aria-live="polite">${this._status()}</div><div class="ra-buttons">${this._button('save', 'save')}${this._button('cancel', 'cancel')}${this._button('replace-settings', 'replaceSettings')}</div>
      ${this._caption('p', 'removalHint')}${this._caption('p', 'replacementHint')}${this._caption('p', 'limit')}</section>`;
  }
  _syncOptions(select, html) {
    if (select.innerHTML === html) return;
    const template = select.ownerDocument.createElement('select'); template.innerHTML = html;
    const rows = new Map([...select.options].map((option) => [option.value, option]));
    const desired = [...template.options].map((wanted) => {
      const existing = rows.get(wanted.value) || wanted; existing.textContent = wanted.textContent; existing.disabled = wanted.disabled; existing.selected = wanted.selected; return existing;
    });
    const selected = template.value;
    for (const option of [...select.options]) if (!desired.includes(option)) option.remove();
    desired.forEach((option, index) => { if (select.options[index] !== option) select.insertBefore(option, select.options[index] || null); }); select.value = selected;
  }
  _allowed(kind, index) {
    if (kind === 'cancel') return true;
    if (kind === 'replace-settings') return this.canEdit && !this.stale && this.readable && !readRoomActions(this.draft).valid;
    if (kind === 'replace-actions') return this.canEdit && !this.stale && readRoomActions(this.draft).valid && this._roomCurrent(this.roomId) && !this._knownActions();
    if (kind === 'remove-room') return this.canEdit && !this.stale && this.readable && readRoomActions(this.draft).valid && !!this._row();
    if (kind === 'save') return this.dirty && !this._issues().length && !!this.roomId && (this._roomCurrent(this.roomId) || this._pendingRemoval());
    if (this._blocked()) return false;
    if (kind === 'add') return this._actions().length < ROOM_ACTION_LIMITS.perRoom && this._choices().some((entry) => entry.value === this.newSource && entry.selectable)
      && !!replaceRoomActions(this.draft, this.roomId, [...this._actions(), { id: this._newId(), entity: this.newSource }]);
    return Number.isInteger(index) && index >= 0 && index < this._actions().length
      && (kind === 'remove' || kind === 'up' && index > 0 || kind === 'down' && index < this._actions().length - 1);
  }
  updatePreviews(container) {
    if (this.disposed) return; this.observe();
    const root = container?.matches?.('[data-room-actions-editor]') ? container : container?.querySelector?.('[data-room-actions-editor]'); if (!root) return;
    this._bind(root); if (root.dataset.raEpoch !== String(this._epoch)) { this._requestRender(); return; }
    this.areaFilter.update(this.hass, root, `${prefix}area-filter`);
    for (const node of root.querySelectorAll('[data-ra-text]')) node.textContent = this._t(node.dataset.raText);
    root.querySelector('[data-ra-status]').innerHTML = this._status();
    for (const select of root.querySelectorAll('select')) {
      const kind = select.dataset.field.slice(prefix.length), index = Number(select.dataset.raIndex);
      if (kind === 'area-filter') continue;
      this._syncOptions(select, kind === 'room' ? this._roomOptions() : this._options(kind === 'source' ? this._actions()[index]?.entity : this.newSource, kind === 'source'));
    }
    for (const node of root.querySelectorAll('input,select')) node.disabled = [`${prefix}room`, `${prefix}area-filter`].includes(node.dataset.field) ? !this.canEdit || this.stale : this._blocked();
    for (const node of root.querySelectorAll('[data-ra-source-status]')) {
      const entity = this._actions()[Number(node.dataset.raSourceStatus)]?.entity, metadata = entityMetadata(this.hass, entity);
      node.textContent = roomActionAvailability(this.hass, entity).available ? '' : this._t(metadata.hasState ? 'ineligibleSource' : 'missingSource');
    }
    for (const button of root.querySelectorAll('button[data-act]')) { const kind = button.dataset.act.slice(prefix.length);
      button.textContent = this._t(({ 'replace-settings': 'replaceSettings', 'replace-actions': 'replaceActions', 'remove-room': 'removeRoom' })[kind] || kind);
      button.disabled = !this._allowed(kind, Number(button.dataset.raIndex));
    }
    this._pollPresses();
  }
  _newId() { let index = 1; const ids = new Set(this._actions().map((action) => action.id)); while (ids.has(`shortcut_${index}`)) index++; return `shortcut_${index}`; }
  _native(node) { return !!node && this._root?.contains(node) && node.isConnected && node.dataset.raEpoch === String(this._epoch); }
  _rowNative(node) { const index = Number(node.dataset.raIndex); return Number.isInteger(index) && this._actions()[index]?.id === node.dataset.raId ? index : -1; }
  onChange(name, node) {
    if (!name?.startsWith(prefix)) return false; this._ensure(); if (!this._native(node) || !this.canEdit || this.stale) return true;
    const kind = name.slice(prefix.length);
    if (kind === 'area-filter') {
      if (this.areaFilter.set(this.hass, node.value)) { this.newSource = ''; this.base = this._context(); this.updatePreviews(this._root); }
      return true;
    }
    if (kind === 'room') {
      if (node.value && !this._roomSelectable(node.value)) return true;
      this.roomId = node.value; this.newSource = ''; this._epoch++; this._requestRender(); return true;
    }
    if (this._blocked()) return true;
    if (kind === 'new-source') { if (node.value === '' || this._choices().some((entry) => entry.value === node.value && entry.selectable)) { this.newSource = node.value; this.base = this._context(); } }
    else {
      const index = this._rowNative(node); if (index < 0) return true;
      const actions = this._actions().map((action) => ({ ...action }));
      if (kind === 'source' && this._choices(actions[index].entity).some((entry) => entry.value === node.value && entry.selectable)) actions[index].entity = node.value;
      else if (kind === 'label') actions[index].label = node.value;
      else return true;
      this._setActions(actions);
    }
    this.updatePreviews(this._root); return true;
  }
  onInput(name, node) { return name === `${prefix}label` ? this.onChange(name, node) : false; }
  onClick(name, node) {
    if (!name?.startsWith(prefix)) return false; this._ensure();
    const kind = name.slice(prefix.length), index = node ? Number(node.dataset.raIndex) : -1;
    if (!this._native(node) || !this._allowed(kind, index)) return true;
    const intent = this._intents.get(node);
    if (intent && (!intent.valid || intent.consumed || !intent.released || !this._same(intent.context, this._context()) || intent.draft !== stamp(this.draft))) return true;
    if (intent) intent.consumed = true;
    if (kind === 'cancel') { const root = this._root; this.reset(); this._requestRender(root); return true; }
    if (kind === 'save') {
      const root = this._root; this.card._edit.commit({ ...this.card._layout, room_actions: clone(this.draft) }); this.reset(); this._requestRender(root); return true;
    }
    if (kind === 'replace-settings') { this.draft = { ...(plain(this.draft) ? this.draft : {}), version: 1, rooms: [] }; this._mark(); }
    else if (kind === 'remove-room') {
      // An explicit whole-row removal may target a saved room whose live geometry
      // or sources are gone. Keep every other raw row and collection field intact.
      this.draft = { ...this.draft, rooms: this.draft.rooms.filter((row) => row.room_id !== this.roomId) };
      this.validationMessage = null; this.newSource = ''; this._mark();
    }
    else if (kind === 'replace-actions') this._setActions([]);
    else if (kind === 'add') { this._setActions([...this._actions(), { id: this._newId(), entity: this.newSource, label: '' }]); this.newSource = ''; }
    else {
      if (this._rowNative(node) !== index) return true;
      const actions = this._actions().map((action) => ({ ...action }));
      if (kind === 'remove') actions.splice(index, 1);
      else { const other = index + (kind === 'up' ? -1 : 1); [actions[index], actions[other]] = [actions[other], actions[index]]; }
      this._setActions(actions);
    }
    this._epoch++; this._requestRender(); return true;
  }
  _requestRender(root = this._root) {
    if (!this.disposed && this.card._editing === true && this.card._edit?.tab === 'rooms'
      && root?.isConnected && this.card._edit.panel?.contains(root)) this.onRender();
  }
  _bind(root) { if (this._root === root) return; this._unbind(); this._root = root; for (const [name, handler] of this._handlers) root.addEventListener(name, handler, true); }
  _unbind() { if (this._root) for (const [name, handler] of this._handlers) this._root.removeEventListener(name, handler, true); this._root = null; this._pressed.clear(); }
  _press(event) {
    const node = event.target.closest?.('button[data-act^="room-actions-"]'); if (!node) return;
    this.observe(); const keyboard = event.type === 'keydown', key = keyboard ? `key:${event.key}` : `pointer:${event.pointerId ?? 0}`;
    if (keyboard && event.repeat) return;
    const intent = { node, context: this._context(), draft: stamp(this.draft), valid: this._native(node) && !node.disabled,
      epoch: this._epoch, released: false, consumed: false };
    this._intents.set(node, intent); this._pressed.set(key, intent);
  }
  _keyDown(event) { if (event.key === 'Enter' || event.key === ' ') { if (event.target.closest?.('button[data-act^="room-actions-"]')) { event.preventDefault(); this._press(event); } } }
  _release(event, cancelled = false) {
    const keyboard = event.type === 'keyup'; if (keyboard && event.key !== 'Enter' && event.key !== ' ') return;
    const key = keyboard ? `key:${event.key}` : `pointer:${event.pointerId ?? 0}`, intent = this._pressed.get(key);
    if (!intent) return; if (keyboard) event.preventDefault(); this.observe(); this._pressed.delete(key);
    intent.released = true; if (cancelled || event.target.closest?.('button[data-act^="room-actions-"]') !== intent.node) intent.valid = false;
    if (keyboard && intent.valid) intent.node.click();
  }
  _cancelFocus(event) { const intent = this._intents.get(event.target); if (intent && !intent.consumed) intent.valid = false; }
  _pollPresses() {
    const context = this._context();
    for (const node of this._root?.querySelectorAll('button[data-act]') || []) {
      const intent = this._intents.get(node); if (intent && (intent.epoch !== this._epoch || !this._same(intent.context, context)
        || intent.draft !== stamp(this.draft) || !this._native(node) || !this._allowed(node.dataset.act.slice(prefix.length), Number(node.dataset.raIndex)))) intent.valid = false;
    }
    for (const intent of this._pressed.values()) if (!this._native(intent.node)) intent.valid = false;
  }
  reset() { this._unbind(); this._loaded = false; this.draft = null; this.roomId = ''; this.newSource = ''; this.dirty = false; this.stale = false; this._epoch++; this._intents = new WeakMap(); }
  cancel() { this.reset(); }
  dispose() { this.reset(); this.disposed = true; }
}
