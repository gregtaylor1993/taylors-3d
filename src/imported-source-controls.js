// Native Lovelace card-form recovery only. No assets, HA actions or dashboard writes.
import { localize } from './localization.js';
export const URL_MODEL_SOURCE_KEYS = Object.freeze(['model', 'model_position', 'model_rotation', 'model_scale',
  'model_opacity', 'model_floors', 'model_position_x', 'model_position_y', 'model_position_z']);
export const SOURCE_INSPECTION_LIMITS = Object.freeze({ depth: 24, nodes: 10000, characters: 100000, viewRows: 256 });
const INVALID = Symbol('unreadable');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => {
  try { return !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
  catch { return false; }
};
const field = (value, key) => {
  if (!value || typeof value !== 'object') return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor ? own(descriptor, 'value') ? descriptor.value : INVALID : undefined; }
  catch { return INVALID; }
};

// Read own data only. Invalid/cyclic/accessor values are shown honestly and kept;
// clearing is unavailable when the source cannot be inspected completely.
export function inspectSourceValue(value) {
  let nodes = 0;
  const seen = new Set();
  const visit = (entry, depth) => {
    if (++nodes > SOURCE_INSPECTION_LIMITS.nodes || depth > SOURCE_INSPECTION_LIMITS.depth) throw Error('limit');
    if (entry === undefined) return { raw: '[present undefined]', tag: ['undefined'] };
    if (entry === null || ['string', 'boolean'].includes(typeof entry)) return { raw: entry, tag: [typeof entry, entry] };
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw Error('non-JSON number');
      return { raw: entry, tag: ['number', entry] };
    }
    if (!Array.isArray(entry) && !plain(entry) || seen.has(entry)) throw Error('non-JSON value');
    seen.add(entry);
    let raw, tag;
    if (Array.isArray(entry)) {
      raw = []; tag = ['array', []];
      for (let index = 0; index < entry.length; index++) {
        const item = visit(field(entry, String(index)), depth + 1); raw.push(item.raw); tag[1].push(item.tag);
      }
    } else {
      raw = Object.create(null); tag = ['object', []];
      for (const key of Object.keys(entry)) {
        const item = visit(field(entry, key), depth + 1); raw[key] = item.raw; tag[1].push([key, item.tag]);
      }
    }
    seen.delete(entry); return { raw, tag };
  };
  try {
    const result = visit(value, 0), text = JSON.stringify(result.raw, null, 2), signature = JSON.stringify(result.tag);
    if (text.length > SOURCE_INSPECTION_LIMITS.characters || signature.length > SOURCE_INSPECTION_LIMITS.characters * 2) throw Error('limit');
    return { readable: true, text, signature };
  } catch {
    return { readable: false, text: 'This value cannot be fully inspected here. It is kept unchanged; clearing is unavailable.', signature: null };
  }
}

const copy = (value) => {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  // Frozen input is still valid JSON. The proposed output is a fresh editable
  // object; copying values never invokes getters or changes the input object.
  for (const descriptor of Object.values(descriptors)) {
    descriptor.configurable = true;
    if (own(descriptor, 'value')) descriptor.writable = true;
  }
  return Object.defineProperties({}, descriptors);
};

/** Exact deletion, deliberately bypassing normal default/empty-value cleaning. */
export function clearImportedSource(config, action) {
  if (!plain(config) || !plain(action)) return { changed: false, config };
  const out = copy(config), kind = field(action, 'kind'), selectedKey = field(action, 'key');
  if (kind === 'uploaded-model') {
    const keys = URL_MODEL_SOURCE_KEYS.filter((key) => own(config, key));
    if (!keys.length || keys.some((key) => !inspectSourceValue(field(config, key)).readable)) return { changed: false, config };
    for (const key of keys) { if (!Object.getOwnPropertyDescriptor(out, key).configurable) return { changed: false, config }; delete out[key]; }
  } else if (kind === 'automatic-floors') {
    if (!own(config, 'model_floors') || !inspectSourceValue(field(config, 'model_floors')).readable
      || !Object.getOwnPropertyDescriptor(out, 'model_floors').configurable) return { changed: false, config };
    delete out.model_floors;
  } else if (kind === 'shared-view') {
    const views = field(config, 'views');
    if (!plain(views) || typeof selectedKey !== 'string' || !own(views, selectedKey)
      || !inspectSourceValue(field(views, selectedKey)).readable) return { changed: false, config };
    const next = copy(views);
    if (!Object.getOwnPropertyDescriptor(next, selectedKey).configurable || !Object.getOwnPropertyDescriptor(out, 'views').writable) return { changed: false, config };
    delete next[selectedKey]; out.views = next;
  } else if (kind === 'clear-views') {
    if (!own(config, 'views') || plain(field(config, 'views')) || !inspectSourceValue(field(config, 'views')).readable
      || !Object.getOwnPropertyDescriptor(out, 'views').configurable) return { changed: false, config };
    delete out.views;
  } else return { changed: false, config };
  return { changed: true, config: out };
}

const style = `
  .imported-source-controls { color: var(--primary-text-color); margin-top: 20px; }
  .imported-source-controls h3 { font-size: 15px; font-weight: 500; margin: 16px 0 8px; }
  .imported-source-controls p { font-size: 13px; color: var(--secondary-text-color); overflow-wrap: anywhere; }
  .imported-source-controls details { margin: 8px 0 16px; }
  .imported-source-controls summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; overflow-wrap: anywhere; }
  .imported-source-controls pre { white-space: pre-wrap; overflow-wrap: anywhere; overflow: auto; max-height: 240px; font-size: 12px; }
  .imported-source-controls button { min-height: 44px; min-width: 44px; border-radius: 8px; padding: 8px 12px; font: inherit;
    color: var(--primary-text-color); background: var(--secondary-background-color, var(--ha-card-background, var(--card-background-color)));
    border: 1px solid var(--divider-color); cursor: pointer; max-width: 100%; white-space: normal; }
  .imported-source-controls button:disabled { opacity: .5; cursor: default; }
  .imported-source-controls :is(button,summary):focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
`;
const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };

/** Stable fragment. Call update() on setConfig/every observed hass update,
 * suspend() on editor disconnect and dispose() on final teardown. Only onChange
 * emits a proposed native form config; the caller/user must save it in HA.
 */
export class ImportedSourceControls {
  constructor(owner, { getConfig, getHass, onChange } = {}) {
    this.owner = owner; this.getConfig = getConfig; this.getHass = getHass; this.onChange = onChange;
    this._captions = [];
    this.el = element('section'); this.el.className = 'imported-source-controls'; this.el.dataset.importedSourceControls = '';
    this.el.setAttribute('aria-label', 'Imported card settings');
    const css = element('style', style), title = this._caption('h3', 'title', 'Imported source settings');
    const hint = this._caption('p', 'hint', 'Imported card settings can override the shared Model and Views controls. Inspect the current raw values, then choose only the setting you want to clear.');
    this._status = element('p'); this._status.setAttribute('role', 'status');
    const save = this._caption('p', 'save', 'These buttons change this card form only. Press Save in Home Assistant’s card editor to keep the change. No uploaded model, layout or furniture file is deleted.');
    this._model = this._row('URL model settings', 'model', 'Use uploaded model', { kind: 'uploaded-model' });
    const modelHint = this._caption('p', 'modelHint', 'Clears only model, model_position, model_rotation, model_scale, model_opacity, model_floors and visual position fields. All other options, including model_rendering, are kept. If this layout has no uploaded model, upload one later in Edit → Model.');
    this._floors = this._row('Imported model floor map', 'floors', 'Use automatic model floor mapping', { kind: 'automatic-floors' });
    const floorHint = this._caption('p', 'floorHint', 'Removes only imported model_floors. Existing saved Model-tab links remain unchanged.');
    this._views = element('div');
    this.el.append(css, title, hint, this._status, save, this._model.el, modelHint, this._floors.el, floorHint, this._views);
    this._rows = new Map(); this._actions = new WeakMap(); this._intents = new WeakMap(); this._pressed = new Map(); this._generation = 0;
    this._actions.set(this._model.button, this._model.action); this._actions.set(this._floors.button, this._floors.action);
    this._handlers = new Map([['pointerdown', (event) => this._press(event)], ['pointerup', (event) => this._release(event)],
      ['pointercancel', (event) => this._cancel(event)], ['keydown', (event) => this._key(event)], ['keyup', (event) => this._release(event)],
      ['focusout', (event) => this._cancel(event)], ['click', (event) => this._click(event)]]);
    for (const [type, handler] of this._handlers) this.el.addEventListener(type, handler, true);
  }

  _t(key, fallback, params = {}) { return localize(this.getHass?.(), `settings.source.${key}`, params, fallback); }
  _inspectionText(value) { return value.readable ? value.text : this._t('unreadable', value.text); }
  _caption(tag, key, fallback) {
    const node = element(tag, this._t(key, fallback)); this._captions.push({ node, key, fallback }); return node;
  }

  _localizeRow(row) {
    const keys = { 'uploaded-model': ['model', 'uploaded'], 'automatic-floors': ['floors', 'automatic'],
      'shared-view': ['view', 'shared'], 'clear-views': ['malformed', 'clearViews'] };
    const [labelKey, buttonKey] = keys[row.action.kind], params = row.action.key === undefined ? {} : { id: row.action.key };
    text(row.summary, this._t(labelKey, row.action.kind === 'shared-view' ? 'Imported view: {id}' : row.label, params));
    text(row.button, this._t(buttonKey, row.buttonText));
  }

  _row(label, inspection, buttonText, action) {
    const el = element('details'), summary = element('summary', label), pre = element('pre'); pre.dataset.sourceInspection = inspection;
    const button = element('button', buttonText); button.type = 'button'; button.dataset.sourceAction = action.kind;
    if (action.key !== undefined) { el.dataset.viewKey = action.key; button.dataset.viewKey = action.key; }
    el.append(summary, pre, button); return { el, summary, pre, button, action, label, buttonText };
  }
  _snapshot() {
    const hass = this.getHass?.(), user = field(hass, 'user'), config = this.getConfig?.();
    let connected = false;
    try { connected = hass?.connection?.connected === true; } catch { /* unavailable */ }
    const id = field(user, 'id'), active = !!user && (!own(user, 'is_active') || field(user, 'is_active') === true);
    const allowed = !this.disposed && this.owner.isConnected === true && connected && typeof id === 'string' && !!id.trim()
      && id.length <= 255 && ![...id].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      && active && field(user, 'is_admin') === true;
    const source = Object.create(null);
    if (plain(config)) for (const key of [...URL_MODEL_SOURCE_KEYS, 'views', 'layout_key']) if (own(config, key)) source[key] = field(config, key);
    const inspected = inspectSourceValue(source), permission = inspectSourceValue(field(user, 'permissions'));
    return { config, allowed: allowed && plain(config) && inspected.readable && permission.readable,
      key: JSON.stringify([allowed, inspected.signature, id, active, field(user, 'is_admin'), permission.signature]),
      connection: field(hass, 'connection'), auth: field(hass, 'auth'), views: field(config, 'views'), floors: field(config, 'model_floors') };
  }
  _same(a, b) { return !!a && !!b && a.key === b.key && a.connection === b.connection && a.auth === b.auth && a.views === b.views && a.floors === b.floors; }
  _observe() {
    const next = this._snapshot();
    if (!this._same(this._last, next)) {
      this._generation++;
      for (const intent of this._pressed.values()) intent.poisoned = true;
      // Released-but-not-yet-clicked intents remain poisoned too.
      for (const button of this.el.querySelectorAll('[data-source-action]')) {
        const intent = this._intents.get(button); if (intent) intent.poisoned = true;
      }
    }
    this._last = next; return next;
  }

  update() {
    if (this.disposed) return;
    const snapshot = this._observe(), config = snapshot.config;
    this.el.setAttribute('aria-label', this._t('aria', 'Imported card settings'));
    for (const { node, key, fallback } of this._captions) text(node, this._t(key, fallback));
    this._localizeRow(this._model); this._localizeRow(this._floors);
    const known = Object.create(null);
    if (plain(config)) for (const key of URL_MODEL_SOURCE_KEYS) if (own(config, key)) known[key] = field(config, key);
    const model = inspectSourceValue(known), floor = inspectSourceValue(field(config, 'model_floors'));
    text(this._model.pre, Object.keys(known).length ? this._inspectionText(model) : this._t('noModel', 'No imported URL model settings.'));
    this._model.button.disabled = !snapshot.allowed || !Object.keys(known).length || !model.readable;
    text(this._floors.pre, plain(config) && own(config, 'model_floors') ? this._inspectionText(floor) : this._t('noFloors', 'No imported model_floors setting.'));
    this._floors.button.disabled = !snapshot.allowed || !plain(config) || !own(config, 'model_floors') || !floor.readable;
    text(this._status, this._messageKey ? this._t(this._messageKey, this.message) : this.message || (!snapshot.allowed
      ? this._t('readOnly', 'Inspecting is available. Clearing requires the current connected, active Home Assistant admin.')
      : this._t('unsaved', 'Changes are not saved until you press Save in Home Assistant.')));
    const views = field(config, 'views'), rows = [], keep = new Set(), viewKeys = plain(views) ? Object.keys(views) : [];
    const overLimit = viewKeys.length > SOURCE_INSPECTION_LIMITS.viewRows;
    if (plain(views) && !overLimit) for (const key of viewKeys) {
      keep.add(key); let row = this._rows.get(key);
      if (!row) {
        row = this._row(`Imported view: ${key}`, 'view', 'Use shared layout settings', { kind: 'shared-view', key });
        this._rows.set(key, row); this._actions.set(row.button, row.action);
      }
      this._localizeRow(row);
      const value = inspectSourceValue(field(views, key)); text(row.pre, this._inspectionText(value));
      row.button.disabled = !snapshot.allowed || !value.readable;
      rows.push(row.el);
    }
    for (const [key, row] of this._rows) if (!keep.has(key)) { row.el.remove(); this._rows.delete(key); }
    if (overLimit) {
      this._overLimit ||= element('p');
      text(this._overLimit, this._t('limit', 'There are more than {limit} imported view entries. This fragment cannot inspect them completely; they are kept unchanged and no partial view list is shown.', { limit: SOURCE_INSPECTION_LIMITS.viewRows }));
      rows.push(this._overLimit);
    }
    if (!plain(views) && plain(config) && own(config, 'views')) {
      if (!this._malformed) {
        this._malformed = this._row('Imported views is not a view-ID object. Inspect it before clearing.', 'views', 'Clear malformed imported views', { kind: 'clear-views' });
        this._actions.set(this._malformed.button, this._malformed.action);
      }
      this._localizeRow(this._malformed);
      const value = inspectSourceValue(views); text(this._malformed.pre, this._inspectionText(value)); this._malformed.button.disabled = !snapshot.allowed || !value.readable;
      rows.push(this._malformed.el);
    }
    if (!rows.length) {
      this._empty ||= element('p');
      text(this._empty, this._t('empty', 'No imported view overrides. Named view settings can be edited on the card under Edit → Views.'));
      rows.push(this._empty);
    }
    for (const node of [...this._views.children]) if (!rows.includes(node)) node.remove();
    let next = this._views.firstChild;
    for (const node of rows) { if (node !== next) this._views.insertBefore(node, next); next = node.nextSibling; }
  }

  _button(event) { const button = event.target.closest?.('[data-source-action]'); return button && this.el.contains(button) ? button : null; }
  _live(button) { return !!button && !this.disposed && button.isConnected && this.el.contains(button) && this._actions.has(button); }
  _press(event) {
    if (event.type === 'pointerdown' && (event.button !== 0 || event.isPrimary === false)) return;
    const button = this._button(event); if (!button) return;
    const current = this._observe(), intent = { generation: this._generation, snapshot: current, poisoned: button.disabled || !current.allowed,
      kind: event.type === 'keydown' ? 'keyboard' : 'pointer', key: event.key, pointerId: event.pointerId, held: true, consumed: false };
    this._intents.set(button, intent); this._pressed.set(button, intent);
  }
  _key(event) {
    if (![' ', 'Enter'].includes(event.key)) return;
    const button = this._button(event), intent = this._intents.get(button);
    if (event.repeat || intent?.held && intent.kind === 'keyboard') { this._observe(); return; }
    this._press(event);
  }
  _release(event) {
    const button = this._button(event), intent = this._intents.get(button); if (!intent) return;
    if (event.type === 'keyup' && (intent.kind !== 'keyboard' || intent.key !== event.key)
      || event.type === 'pointerup' && (intent.kind !== 'pointer' || intent.pointerId !== undefined && event.pointerId !== intent.pointerId)) return;
    this._observe(); intent.held = false; this._pressed.delete(button);
  }
  _cancel(event) { const button = this._button(event), intent = this._intents.get(button); if (intent?.held) { intent.poisoned = true; intent.held = false; this._pressed.delete(button); } }
  _click(event) {
    const button = this._button(event), snapshot = this._observe();
    if (!this._live(button) || button.disabled || !snapshot.allowed) return;
    const intent = this._intents.get(button);
    if (intent && (intent.poisoned || intent.consumed || intent.generation !== this._generation || !this._same(intent.snapshot, snapshot))) return;
    if (intent) intent.consumed = true;
    const result = clearImportedSource(snapshot.config, this._actions.get(button));
    if (!result.changed) return;
    this.message = 'Card form updated. Press Save in Home Assistant to keep this change.';
    this._messageKey = 'updated';
    this.onChange?.(result.config);
  }
  suspend() {
    this._generation++;
    for (const intent of this._pressed.values()) intent.poisoned = true;
    for (const button of this.el.querySelectorAll('[data-source-action]')) { const intent = this._intents.get(button); if (intent) intent.poisoned = true; button.disabled = true; }
    this._pressed.clear(); this._last = null;
  }
  dispose() { if (this.disposed) return; this.suspend(); this.disposed = true; for (const [type, handler] of this._handlers) this.el.removeEventListener(type, handler, true); this.el.remove(); }
}
