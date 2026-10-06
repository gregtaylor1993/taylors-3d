import { localeInfo, localize } from './localization.js';
import captions from './translations/custom-controls.js';

const COLORS = new Set(['theme', 'amber', 'teal', 'blue', 'purple', 'red']);
const ACTIONS = new Set(['view', 'scene', 'script', 'automation', 'toggle', 'more-info']);
const ISSUES = new Set(['settings', 'version', 'limit', 'bar', 'button', 'action', 'duplicate_bar', 'duplicate_button', 'context', 'session', 'room', 'view', 'source', 'service']);
const INVALID = Symbol('unreadable');
let nextView = 0;
const field = (value, key) => {
  try {
    const descriptor = value && Object.getOwnPropertyDescriptor(value, key);
    return descriptor ? Object.hasOwn(descriptor, 'value') ? descriptor.value : INVALID : undefined;
  } catch { return INVALID; }
};
const plain = (value) => {
  try { return !!value && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
  catch { return false; }
};
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const labelText = (value) => typeof value === 'string' && value.length <= 80;
const text = (value, maximum) => typeof value === 'string' && value.length <= maximum && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const reference = (value) => text(value, 256) && value.length > 0;
const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
const setAttribute = (node, name, value) => {
  if (value === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
  else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value);
};
const setHidden = (node, value) => { if (node.hidden !== value) node.hidden = value; };

// Read only known data properties. Saved strings never become HTML, CSS or handlers.
function snapshot(raw) {
  const rawBars = field(raw, 'bars');
  const contextKey = field(raw, 'contextKey');
  const suspended = field(raw, 'suspended');
  if (!plain(raw) || !Array.isArray(rawBars) || field(rawBars, 'length') > 8
    || typeof contextKey !== 'string' || suspended === INVALID || suspended !== undefined && typeof suspended !== 'boolean') return null;
  const bars = [], barIds = new Set(), buttonIds = new Set();
  for (let index = 0; index < field(rawBars, 'length'); index++) {
    const rawBar = field(rawBars, String(index));
    const bar = Object.fromEntries(['id', 'label', 'style', 'placement', 'room_id'].map((key) => [key, field(rawBar, key)]));
    const buttons = field(rawBar, 'buttons');
    if (!plain(rawBar) || !id(bar.id) || barIds.has(bar.id) || !labelText(bar.label)
      || !['pills', 'tiles'].includes(bar.style) || !['bottom', 'room'].includes(bar.placement)
      || bar.placement === 'room' && !reference(bar.room_id)
      || !Array.isArray(buttons) || field(buttons, 'length') > 12) return null;
    barIds.add(bar.id);
    bar.buttons = [];
    for (let buttonIndex = 0; buttonIndex < field(buttons, 'length'); buttonIndex++) {
      const rawButton = field(buttons, String(buttonIndex));
      const button = Object.fromEntries(['id', 'label', 'icon', 'color', 'available', 'issue', 'issueCode', 'active'].map((key) => [key, field(rawButton, key)]));
      const action = field(rawButton, 'action');
      const type = field(action, 'type'), entity = field(action, 'entity'), view = field(action, 'view_id'), skip = field(action, 'skip_conditions');
      if (!plain(rawButton) || !id(button.id) || buttonIds.has(button.id) || !labelText(button.label)
        || !text(button.icon, 68) || !/^mdi:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(button.icon)
        || !COLORS.has(button.color) || typeof button.available !== 'boolean' || !text(button.issue, 2048)
        || button.issueCode !== undefined && !ISSUES.has(button.issueCode)
        || button.active !== undefined && typeof button.active !== 'boolean'
        || !plain(action) || !ACTIONS.has(type)
        || type === 'view' && !reference(view)
        || type !== 'view' && (typeof entity !== 'string' || !/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(entity))
        || skip !== undefined && (type !== 'automation' || typeof skip !== 'boolean')) return null;
      buttonIds.add(button.id);
      button.actionKey = JSON.stringify([type, entity, view, skip]);
      bar.buttons.push(button);
    }
    if (bar.buttons.length) bars.push(bar);
  }
  return { bars, contextKey, suspended: !!suspended, hass: field(raw, 'hass') };
}

export const CUSTOM_CONTROLS_VIEW_CSS = `
[data-custom-controls-view] { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; color: var(--taylors3d-ui-text, var(--primary-text-color, #f2f5f7)); font-family: inherit; }
[data-custom-controls-view][hidden], [data-custom-controls-view] [hidden] { display: none !important; }
[data-custom-controls-view] .custom-controls-bars { display: grid; gap: 12px; max-height: min(40vh, 320px); overflow: auto; overscroll-behavior: contain; min-width: 0; }
[data-custom-controls-view] .custom-controls-bar { min-width: 0; }
[data-custom-controls-view] .custom-controls-heading { margin: 0 0 6px; font-size: 12px; font-weight: 650; line-height: 1.4; overflow-wrap: anywhere; text-align: start; }
[data-custom-controls-view] .custom-controls-buttons { display: flex; flex-wrap: wrap; align-items: start; gap: 8px; min-width: 0; }
[data-custom-controls-view] [data-style="tiles"] .custom-controls-buttons { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(112px, 100%), 1fr)); }
[data-custom-controls-view] .custom-controls-item { min-width: 0; max-width: 100%; }
[data-custom-controls-view][data-taylors3d-ui] .custom-controls-item > button[data-custom-controls-button-id][data-color] { box-sizing: border-box; display: flex; align-items: center; justify-content: start; gap: 8px; min-height: 44px; min-width: 44px; max-width: 100%; padding: 10px 14px; border: 1px solid var(--taylors3d-ui-divider, var(--divider-color, #35424e)); border-radius: 24px; background: var(--taylors3d-ui-raised, var(--secondary-background-color, #253340)); color: var(--taylors3d-ui-text, var(--primary-text-color, #f2f5f7)); font: inherit; font-size: 13px; line-height: 1.4; text-align: start; cursor: pointer; touch-action: manipulation; }
[data-custom-controls-view][data-taylors3d-ui] [data-style="tiles"] .custom-controls-item > button[data-custom-controls-button-id][data-color] { width: 100%; border-radius: 14px; flex-direction: column; align-items: start; min-height: 76px; }
[data-custom-controls-view][data-taylors3d-ui] .custom-controls-item > button[data-custom-controls-button-id][data-color="amber"] { background: #ffc767; color: #35250c; border-color: #ffc767; }
[data-custom-controls-view][data-taylors3d-ui] .custom-controls-item > button[data-custom-controls-button-id][data-color="teal"] { background: #51d4c4; color: #07352f; border-color: #51d4c4; }
[data-custom-controls-view][data-taylors3d-ui] .custom-controls-item > button[data-custom-controls-button-id][data-color="blue"] { background: #9cc8ff; color: #142e50; border-color: #9cc8ff; }
[data-custom-controls-view][data-taylors3d-ui] .custom-controls-item > button[data-custom-controls-button-id][data-color="purple"] { background: #d4b5ff; color: #352052; border-color: #d4b5ff; }
[data-custom-controls-view][data-taylors3d-ui] .custom-controls-item > button[data-custom-controls-button-id][data-color="red"] { background: #ffb4ab; color: #541f1b; border-color: #ffb4ab; }
[data-custom-controls-view] .custom-controls-item > button[data-custom-controls-button-id][aria-pressed="true"] { box-shadow: inset 0 0 0 2px currentColor; }
[data-custom-controls-view] .custom-controls-item > button[data-custom-controls-button-id]:focus-visible { outline: 3px solid var(--primary-color, #51d4c4); outline-offset: 3px; }
[data-custom-controls-view][data-taylors3d-ui] .custom-controls-item > button[data-custom-controls-button-id][data-color]:disabled { cursor: default; opacity: 1; border-style: dashed; }
[data-custom-controls-view] .custom-controls-label, [data-custom-controls-view] .custom-controls-status { overflow-wrap: anywhere; min-width: 0; }
[data-custom-controls-view] ha-icon { flex: 0 0 20px; width: 20px; height: 20px; --mdc-icon-size: 20px; }
[data-custom-controls-view] .custom-controls-status { margin: 4px 2px 0; max-width: 240px; font-size: 12px; line-height: 1.4; color: var(--taylors3d-ui-muted, var(--secondary-text-color, #bec8d2)); }
@media (forced-colors: active) { [data-custom-controls-view][data-taylors3d-ui] .custom-controls-item > button[data-custom-controls-button-id][data-color] { background: ButtonFace; color: ButtonText; border-color: ButtonText; } [data-custom-controls-view] .custom-controls-item > button[data-custom-controls-button-id]:focus-visible { outline-color: Highlight; } }
`;

export class CustomControlsView {
  constructor(parent, { getContext, onAction } = {}) {
    this._parent = parent;
    this._document = parent.ownerDocument;
    this._getContext = getContext;
    this._onAction = onAction;
    this._bars = new Map();
    this._rows = new Map();
    this._gestures = new Map();
    this._listeners = [];
    this._disposed = false;
    this._sequence = 0;
    this._viewId = ++nextView;
    this.el = this._document.createElement('div');
    this.el.dataset.taylors3dUi = 'custom-controls';
    this.el.dataset.customControlsView = '';
    this.el.setAttribute('role', 'group');
    const style = this._document.createElement('style');
    style.textContent = CUSTOM_CONTROLS_VIEW_CSS;
    this._list = this._document.createElement('div');
    this._list.className = 'custom-controls-bars';
    this.el.append(style, this._list);
    parent.append(this.el);
    this._listen(this.el, 'pointerdown', (event) => this._press(event));
    this._listen(this.el, 'pointermove', (event) => this._move(event, true));
    this._listen(this.el, 'keydown', (event) => this._key(event));
    this._listen(this.el, 'click', (event) => this._click(event));
    for (const type of ['pointerup', 'pointercancel', 'keyup']) this._listen(this.el, type, (event) => this._release(event));
    this._listen(this.el, 'focusout', (event) => {
      const row = this._eventRow(event);
      if (row && !row.button.contains(event.relatedTarget)) this._cancel(row);
    });
    this._listen(this.el, 'wheel', (event) => event.stopPropagation(), { passive: true });
    for (const type of ['pointerup', 'pointercancel', 'keyup']) this._listen(this._document, type, (event) => this._release(event), true);
    this._listen(this._document, 'pointermove', (event) => this._move(event), true);
    this._listen(this._document, 'visibilitychange', () => { if (this._document.hidden) this._cancelAll(); });
    this._listen(this._document.defaultView, 'blur', () => this._cancelAll());
    this.update();
  }

  _listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    this._listeners.push([target, type, callback, options]);
  }

  _caption(key, params = {}, fallback = '') {
    const language = localeInfo(this._context?.hass).resolved;
    return localize(this._context?.hass, key, params, captions[language]?.[key] ?? captions.en[key] ?? fallback);
  }

  _read() {
    try { return snapshot(this._getContext?.()); } catch { return null; }
  }

  update() {
    if (this._disposed) return;
    const context = this._read();
    this._context = context;
    const focused = this.el.getRootNode().activeElement;
    const bars = context?.bars ?? [];
    const keepBars = new Set(), keepRows = new Set();
    for (const [barIndex, bar] of bars.entries()) {
      keepBars.add(bar.id);
      let section = this._bars.get(bar.id);
      if (!section) {
        const el = this._document.createElement('section');
        el.className = 'custom-controls-bar';
        el.dataset.customControlsBarId = bar.id;
        const heading = this._document.createElement('h3');
        heading.className = 'custom-controls-heading';
        heading.id = `custom-controls-${this._viewId}-bar-${bar.id}`;
        const body = this._document.createElement('div');
        body.className = 'custom-controls-buttons';
        el.setAttribute('aria-labelledby', heading.id);
        el.append(heading, body);
        section = { el, heading, body };
        this._bars.set(bar.id, section);
      }
      setText(section.heading, bar.label || bar.id);
      setAttribute(section.el, 'data-style', bar.style);
      for (const [buttonIndex, button] of bar.buttons.entries()) {
        keepRows.add(button.id);
        let row = this._rows.get(button.id);
        if (!row) {
          const el = this._document.createElement('div');
          el.className = 'custom-controls-item';
          const native = this._document.createElement('button');
          native.type = 'button';
          native.dataset.customControlsButtonId = button.id;
          const icon = this._document.createElement('ha-icon');
          icon.setAttribute('aria-hidden', 'true');
          const label = this._document.createElement('span');
          label.className = 'custom-controls-label';
          const status = this._document.createElement('p');
          status.className = 'custom-controls-status';
          status.id = `custom-controls-${this._viewId}-status-${button.id}`;
          status.setAttribute('role', 'status');
          status.setAttribute('aria-live', 'polite');
          native.append(icon, label);
          el.append(native, status);
          row = { el, button: native, icon, label, status, intent: 0, pending: null, message: null };
          this._rows.set(button.id, row);
        }
        const stamp = JSON.stringify([context.contextKey, context.suspended, barIndex, buttonIndex, bar.id, bar.style, bar.placement, bar.room_id, button.actionKey, button.available, button.issueCode ?? button.issue]);
        if (row.stamp !== stamp) {
          row.stamp = stamp;
          row.intent = ++this._sequence;
          row.pending = null;
          row.message = null;
          this._cancel(row);
        }
        row.data = button;
        row.barId = bar.id;
        row.section = section;
        this._renderRow(row);
      }
      this._order(section.body, bar.buttons.map((button) => this._rows.get(button.id).el));
    }
    for (const [key, row] of this._rows) if (!keepRows.has(key)) {
      this._cancel(row);
      row.el.remove();
      this._rows.delete(key);
      this._gestures.delete(row);
    }
    for (const [key, section] of this._bars) if (!keepBars.has(key)) { section.el.remove(); this._bars.delete(key); }
    this._order(this._list, bars.map((bar) => this._bars.get(bar.id).el));
    setAttribute(this.el, 'aria-label', this._caption('controls.runtime.aria', {}, 'Custom controls'));
    setHidden(this.el, bars.length === 0 || !!context?.suspended);
    if (focused && this.el.contains(focused) && !focused.disabled && focused !== this.el.getRootNode().activeElement) focused.focus({ preventScroll: true });
  }

  _order(parent, nodes) {
    for (let index = 0; index < nodes.length; index++) if (parent.children[index] !== nodes[index]) parent.insertBefore(nodes[index], parent.children[index] ?? null);
  }

  _renderRow(row) {
    const data = row.data;
    const label = data.label || data.id;
    const reason = this._context?.suspended ? this._caption('controls.runtime.suspended', {}, 'Controls are unavailable while editing or loading.')
      : !data.available ? data.issueCode ? this._caption(`controls.issue.${data.issueCode}`, {}, data.issue) : data.issue || this._caption('controls.runtime.unavailable', {}, 'Unavailable') : '';
    const message = reason || (row.pending ? this._caption('controls.runtime.busy', { label }, 'Running {label}…')
      : row.message ? this._caption(`controls.runtime.${row.message}`, { label }, row.message === 'failed' ? 'Could not run {label}.' : 'Action requested for {label}.') : '');
    setText(row.label, label);
    setAttribute(row.icon, 'icon', data.icon);
    setAttribute(row.button, 'data-color', data.color);
    setAttribute(row.button, 'aria-pressed', typeof data.active === 'boolean' ? data.active : null);
    setAttribute(row.button, 'aria-busy', row.pending ? 'true' : null);
    setAttribute(row.button, 'aria-describedby', message ? row.status.id : null);
    setAttribute(row.button, 'title', reason ? `${label}: ${reason}` : label);
    const disabled = !data.available || !!this._context?.suspended || !!row.pending || typeof this._onAction !== 'function';
    if (row.button.disabled !== disabled) row.button.disabled = disabled;
    setText(row.status, message);
    setHidden(row.status, !message);
  }

  _eventRow(event) {
    // Document capture retargets shadow events to the card host. The composed
    // path retains the exact native button, so a real release remains paired.
    const target = event.composedPath?.().find((node) => node?.nodeType === 1 && node.matches('button[data-custom-controls-button-id]')) ?? event.target;
    const native = target?.closest?.('button[data-custom-controls-button-id]');
    if (!native) return null;
    const row = this._rows.get(native.getAttribute('data-custom-controls-button-id'));
    return row?.button === native && row.el.parentNode === row.section.body && native.parentNode === row.el
      && row.section.el.parentNode === this._list && this._list.parentNode === this.el ? row : null;
  }

  _current(row) {
    if (this._disposed || !this._context || this._context.suspended || !this.el.isConnected || this.el.parentNode !== this._parent
      || this.el.hidden || this._document.hidden || row.button.disabled || !row.data.available || row.pending) return false;
    let ancestor = this.el;
    while (ancestor) {
      if (ancestor.hidden) return false;
      ancestor = ancestor.parentElement ?? ancestor.getRootNode()?.host;
    }
    return this._rows.get(row.data.id) === row && row.el.parentNode === row.section.body;
  }

  _cancel(row) { const gesture = this._gestures.get(row); if (gesture) gesture.poisoned = true; }
  _cancelAll() { for (const row of this._gestures.keys()) this._cancel(row); }

  _press(event) {
    event.stopPropagation();
    this.update();
    const row = this._eventRow(event);
    if (!row) return;
    const valid = event.button === 0 && event.isPrimary !== false && this._current(row);
    this._gestures.set(row, { source: 'pointer', pointerId: event.pointerId, intent: row.intent, held: true, poisoned: !valid, consumed: false, x: event.clientX ?? 0, y: event.clientY ?? 0 });
  }

  _move(event, owned = false) {
    if (owned) event.stopPropagation();
    for (const [row, gesture] of this._gestures) if (gesture.source === 'pointer' && gesture.pointerId === event.pointerId && gesture.held
      && Math.hypot((event.clientX ?? 0) - gesture.x, (event.clientY ?? 0) - gesture.y) > 8) this._cancel(row);
  }

  _key(event) {
    if (event.key === 'Escape') { this._cancelAll(); return; }
    event.stopPropagation();
    this.update();
    const row = this._eventRow(event);
    if (!row) return;
    if (['Enter', ' '].includes(event.key)) {
      const held = this._gestures.get(row);
      if (event.repeat || held?.source === 'key' && held.held && held.key === event.key) { event.preventDefault(); return; }
      this._gestures.set(row, { source: 'key', key: event.key, intent: row.intent, held: true, poisoned: !this._current(row), consumed: false });
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) && this._current(row)) {
      const rows = [...row.section.body.children].map((el) => [...this._rows.values()].find((candidate) => candidate.el === el)).filter((candidate) => candidate && this._current(candidate));
      const index = rows.indexOf(row);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + rows.length) % rows.length;
      event.preventDefault();
      rows[next]?.button.focus();
    }
  }

  _release(event) {
    if (this._disposed) return;
    const eventRow = this._eventRow(event);
    for (const [row, gesture] of this._gestures) {
      if (!gesture.held) continue;
      const pointer = gesture.source === 'pointer' && event.type.startsWith('pointer') && event.pointerId === gesture.pointerId;
      const keyboard = gesture.source === 'key' && event.type === 'keyup' && ['Enter', ' '].includes(event.key);
      if (!pointer && !keyboard) continue;
      if (eventRow) event.stopPropagation();
      if (eventRow !== row || event.type === 'pointercancel' || keyboard && event.key !== gesture.key
        || pointer && (event.button !== 0 || Math.hypot((event.clientX ?? 0) - gesture.x, (event.clientY ?? 0) - gesture.y) > 8)) gesture.poisoned = true;
      gesture.held = false;
      if (gesture.consumed && !gesture.poisoned) this._gestures.delete(row);
    }
  }

  _click(event) {
    event.stopPropagation();
    this.update();
    const row = this._eventRow(event);
    if (!row || !this._current(row)) return;
    const gesture = this._gestures.get(row);
    if (gesture ? gesture.poisoned || gesture.consumed || gesture.intent !== row.intent
      || gesture.source === 'pointer' && gesture.held || gesture.source === 'key' && gesture.key === ' ' && gesture.held : event.detail > 0) return;
    if (gesture) {
      gesture.consumed = true;
      // A completed pointer/Space press must not block a later independent
      // assistive activation. Held and cancelled records keep their fences.
      if (!gesture.held) this._gestures.delete(row);
    }
    const token = { intent: row.intent };
    row.pending = token;
    row.message = null;
    this._renderRow(row);
    let result;
    try { result = this._onAction(row.barId, row.data.id); }
    catch { result = Promise.reject(new Error('action failed')); }
    Promise.resolve(result).then((value) => this._settle(row, token, value !== false && field(value, 'ok') !== false), () => this._settle(row, token, false));
  }

  _settle(row, token, success) {
    if (this._disposed) return;
    this.update();
    if (this._rows.get(row.data.id) !== row || row.pending !== token || row.intent !== token.intent) return;
    row.pending = null;
    row.message = this.el.isConnected && this.el.parentNode === this._parent && !this.el.hidden ? success ? 'requested' : 'failed' : null;
    this._renderRow(row);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const [target, type, callback, options] of this._listeners) target.removeEventListener(type, callback, options);
    this._listeners.length = 0;
    this._cancelAll();
    this._gestures.clear();
    this._rows.clear();
    this._bars.clear();
    this.el.remove();
  }
}
