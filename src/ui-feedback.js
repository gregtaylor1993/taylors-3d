import { localeInfo } from './localization.js';
import captions from './translations/ui-feedback.js';

const SAVE_STATES = new Set(['idle', 'unsaved', 'saving', 'saved', 'failed']);
const KINDS = ['connection', 'save', 'action'];
const property = (value, key) => {
  try {
    const descriptor = value && Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
};
const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
const setAttribute = (node, name, value) => {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
};
const setHidden = (node, value) => { if (node.hidden !== value) node.hidden = value; };

/** Three independent feedback channels, with no device commands or timers.
 * Root must change contextKey when the account, layout/model, selected source,
 * service, or connection identity changes. Ordinary readings/locale keep it.
 * Save/action terminal results require the exact token returned when started.
 * A service Promise resolving means requested, never physical-device completion.
 */
export class FeedbackController {
  constructor({ onChange } = {}) {
    this.onChange = onChange;
    this._contextKey = undefined;
    this._initialized = false;
    this._connected = false;
    this._loading = false;
    this._generation = 0;
    this._sequence = 0;
    this._connection = 'idle';
    this._save = 'idle';
    this._dirty = false;
    this._action = null;
    this._saveToken = null;
    this._actionToken = null;
    this._disposed = false;
    this._lastSignature = JSON.stringify(this.snapshot());
  }

  snapshot() {
    return Object.freeze({
      contextGeneration: this._generation,
      operationSequence: this._sequence,
      connection: Object.freeze({ status: this._connection, dismissible: this._connection === 'reconnected' }),
      save: Object.freeze({ status: this._dirty ? 'unsaved' : this._save,
        persistedStatus: this._save, dirty: this._dirty,
        dismissible: !this._dirty && ['saved', 'failed'].includes(this._save) }),
      action: this._action ? Object.freeze({ ...this._action, dismissible: this._action.status !== 'pending' }) : null,
    });
  }

  _emit() {
    const snapshot = this.snapshot(), signature = JSON.stringify(snapshot);
    if (signature === this._lastSignature) return false;
    this._lastSignature = signature;
    if (!this._disposed && typeof this.onChange === 'function') this.onChange(snapshot);
    return true;
  }

  setContext(raw) {
    if (this._disposed) return false;
    const contextKey = property(raw, 'contextKey');
    const connected = contextKey !== undefined && contextKey !== null && property(raw, 'connected') === true;
    const loading = property(raw, 'loading') === true;
    const changed = !this._initialized || !Object.is(contextKey, this._contextKey);
    const availabilityChanged = this._initialized && (connected !== this._connected || loading !== this._loading);
    if (!changed && !availabilityChanged) return false;
    const wasDisconnected = this._initialized && !this._connected;
    if (changed || availabilityChanged) {
      this._generation++;
      this._saveToken = null;
      this._actionToken = null;
      this._action = null;
    }
    if (changed) { this._save = 'idle'; this._dirty = false; }
    else if (this._save === 'saving') this._save = 'idle';
    this._initialized = true;
    this._contextKey = contextKey;
    this._connected = connected;
    this._loading = loading;
    this._connection = !connected ? 'offline' : loading ? 'loading' : wasDisconnected ? 'reconnected' : 'idle';
    return this._emit();
  }

  setDirty(dirty) {
    if (this._disposed || typeof dirty !== 'boolean' || dirty === this._dirty) return false;
    this._dirty = dirty;
    return this._emit();
  }

  setSaveState(status, token) {
    if (this._disposed || !SAVE_STATES.has(status)) return false;
    if (status === 'unsaved') return this.setDirty(true);
    if (status === 'saved' || status === 'failed') {
      if (!token || token !== this._saveToken || token.generation !== this._generation) return false;
      this._saveToken = null;
      this._save = status;
      this._emit();
      return true;
    }
    if (status === 'saving') {
      if (!this._initialized || this._contextKey === undefined || this._contextKey === null || this._loading) return null;
      this._saveToken = Object.freeze({ kind: 'save', generation: this._generation, sequence: ++this._sequence });
      this._save = 'saving';
      this._emit();
      return this._saveToken;
    }
    this._saveToken = null;
    this._save = 'idle';
    return this._emit();
  }

  beginAction(raw) {
    if (this._disposed || !this._initialized || !this._connected || this._loading) return null;
    const id = property(raw, 'id'), label = property(raw, 'label');
    if (typeof id !== 'string' || !id || id.length > 256 || typeof label !== 'string' || !label.trim() || label.length > 160) return null;
    this._actionToken = Object.freeze({ kind: 'action', generation: this._generation,
      sequence: ++this._sequence, sourceKey: property(raw, 'sourceKey') });
    this._action = { id, label, status: 'pending' };
    this._emit();
    return this._actionToken;
  }

  _finishAction(token, status) {
    if (this._disposed || !token || token !== this._actionToken || token.generation !== this._generation
      || !this._action || !this._connected || this._loading) return false;
    this._actionToken = null;
    this._action = { ...this._action, status };
    this._emit();
    return true;
  }

  actionRequested(token) { return this._finishAction(token, 'requested'); }
  actionFailed(token) { return this._finishAction(token, 'failed'); }

  cancelAction(token) {
    if (this._disposed || !token || token !== this._actionToken || token.generation !== this._generation) return false;
    this._actionToken = null;
    this._action = null;
    return this._emit();
  }

  dismiss(kind) {
    if (this._disposed) return false;
    if (kind === 'connection' && this._connection === 'reconnected') this._connection = 'idle';
    else if (kind === 'save' && !this._dirty && ['saved', 'failed'].includes(this._save)) this._save = 'idle';
    else if (kind === 'action' && this._action && this._action.status !== 'pending') this._action = null;
    else return false;
    return this._emit();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._generation++;
    this._saveToken = null;
    this._actionToken = null;
    this._action = null;
    this.onChange = null;
  }
}

const STYLE = `
  [data-ui-feedback] { box-sizing: border-box; min-width: 0; max-width: 100%; display: grid; gap: 6px;
    font: inherit; font-size: 13px; color: var(--taylors3d-ui-text, var(--primary-text-color, #212121)); }
  [data-ui-feedback][hidden], [data-ui-feedback] [hidden] { display: none !important; }
  [data-ui-feedback] .ui-feedback-row { display: flex; align-items: center; gap: 8px; min-width: 0;
    min-height: 44px; padding: 0 4px 0 12px; border-radius: 12px;
    border: 1px solid var(--taylors3d-ui-border, var(--divider-color, #ddd));
    background: var(--taylors3d-ui-surface, var(--ha-card-background, var(--card-background-color, #fff))); }
  [data-ui-feedback] .ui-feedback-content { flex: 1; min-width: 0; padding: 8px 0; overflow-wrap: anywhere; }
  [data-ui-feedback] .ui-feedback-message { display: block; color: inherit; font-weight: 600; }
  [data-ui-feedback] .ui-feedback-detail { display: block; margin-top: 3px;
    color: var(--taylors3d-ui-muted, var(--secondary-text-color, #606060)); }
  [data-ui-feedback][data-taylors3d-ui] [data-feedback-kind] button.ui-feedback-dismiss[data-feedback-dismiss] { box-sizing: border-box; flex: none;
    min-width: 44px; min-height: 44px; width: 44px; padding: 0; border: 1px solid transparent;
    border-radius: 10px; background: transparent; color: inherit; font: inherit; font-size: 20px; cursor: pointer; }
  [data-ui-feedback] button.ui-feedback-dismiss:focus-visible { outline: 2px solid currentColor; outline-offset: -4px; }
  @media (forced-colors: active) {
    [data-ui-feedback] .ui-feedback-row { color: CanvasText; background: Canvas; border-color: CanvasText; }
    [data-ui-feedback] .ui-feedback-detail { color: CanvasText; }
    [data-ui-feedback][data-taylors3d-ui] [data-feedback-kind] button.ui-feedback-dismiss[data-feedback-dismiss] { color: ButtonText; background: ButtonFace; }
  }
`;

/** Stable text-only live-status nodes; root owns placement and measurement.
 * No automatic expiry: important status persists until replaced/dismissed.
 */
export class FeedbackView {
  constructor(parent, { onDismiss } = {}) {
    this.onDismiss = onDismiss;
    this._disposed = false;
    this.rows = new Map();
    this._intents = new WeakMap();
    this.el = document.createElement('section');
    this.el.dataset.uiFeedback = '';
    this.el.dataset.taylors3dUi = 'feedback';
    this.el.hidden = true;
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.el.append(style);
    for (const kind of KINDS) {
      const row = document.createElement('div');
      row.className = 'ui-feedback-row';
      row.dataset.feedbackKind = kind;
      row.hidden = true;
      const content = document.createElement('div');
      content.className = 'ui-feedback-content';
      content.setAttribute('role', 'status');
      content.setAttribute('aria-live', 'polite');
      content.setAttribute('aria-atomic', 'true');
      const message = document.createElement('span');
      message.className = 'ui-feedback-message';
      const detail = document.createElement('span');
      detail.className = 'ui-feedback-detail';
      detail.hidden = true;
      content.append(message, detail);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'ui-feedback-dismiss';
      dismiss.dataset.feedbackDismiss = kind;
      dismiss.textContent = '×';
      dismiss.hidden = true;
      row.append(content, dismiss);
      this.el.append(row);
      this.rows.set(kind, { row, message, detail, dismiss, identity: '' });
    }
    this._button = (event) => {
      const button = event.composedPath().find((node) => node?.dataset?.feedbackDismiss);
      return button && !button.hidden && !button.parentElement.hidden && this.el.contains(button) ? button : null;
    };
    this._start = (event) => {
      if (this._disposed || event.type === 'keydown' && (event.repeat || !['Enter', ' '].includes(event.key))) return;
      const button = this._button(event), refs = button && this.rows.get(button.dataset.feedbackDismiss);
      if (refs) this._intents.set(button, { identity: refs.identity, held: true, poisoned: false });
    };
    this._end = (event) => {
      if (event.type === 'keyup' && !['Enter', ' '].includes(event.key)) return;
      const button = this._button(event), intent = button && this._intents.get(button);
      if (intent) { intent.held = false; if (event.type === 'pointercancel') intent.poisoned = true; }
    };
    this._click = (event) => {
      const button = this._button(event);
      if (!button || this._disposed) return;
      const refs = this.rows.get(button.dataset.feedbackDismiss), intent = this._intents.get(button);
      if (intent && (intent.poisoned || intent.identity !== refs.identity)) return;
      event.stopPropagation();
      if (typeof this.onDismiss === 'function') this.onDismiss(button.dataset.feedbackDismiss);
      if (!intent?.held) this._intents.delete(button);
    };
    this.el.addEventListener('pointerdown', this._start);
    this.el.addEventListener('keydown', this._start);
    for (const name of ['pointerup', 'pointercancel', 'keyup']) this.el.addEventListener(name, this._end);
    this.el.addEventListener('click', this._click);
    parent.append(this.el);
  }

  _text(hass, key, params = {}) {
    const locale = localeInfo(hass).resolved;
    const message = captions[locale]?.[key] || captions.en[key] || '';
    return message.replace(/\{([a-z]+)\}/g, (_match, name) => typeof params[name] === 'string' ? params[name] : '');
  }

  update(snapshot, hass) {
    if (this._disposed) return false;
    setAttribute(this.el, 'aria-label', this._text(hass, 'feedback.aria'));
    let visible = false;
    for (const kind of KINDS) {
      const current = property(snapshot, kind), status = property(current, 'status');
      const states = kind === 'connection' ? ['loading', 'offline', 'reconnected']
        : kind === 'save' ? ['unsaved', 'saving', 'saved', 'failed'] : ['pending', 'requested', 'failed'];
      const label = property(current, 'label');
      const valid = states.includes(status) && (kind !== 'action' || typeof label === 'string' && label.length <= 160);
      const refs = this.rows.get(kind);
      const identity = JSON.stringify([property(snapshot, 'contextGeneration'), property(snapshot, 'operationSequence'), kind,
        status, label, property(current, 'persistedStatus'), property(current, 'dismissible')]);
      if (refs.identity !== identity) {
        const intent = this._intents.get(refs.dismiss);
        if (intent) intent.poisoned = true;
        refs.identity = identity;
      }
      setHidden(refs.row, !valid);
      if (!valid) { setText(refs.message, ''); setText(refs.detail, ''); setHidden(refs.detail, true); setHidden(refs.dismiss, true); continue; }
      visible = true;
      const caption = this._text(hass, `feedback.${kind}.${status}`, { label });
      setText(refs.message, caption);
      setAttribute(refs.row, 'data-status', status);
      const persisted = property(current, 'persistedStatus');
      const detail = kind === 'save' && status === 'unsaved' && ['saving', 'failed'].includes(persisted)
        ? this._text(hass, persisted === 'saving' ? 'feedback.save.previousSaving' : 'feedback.save.previousFailed') : '';
      setText(refs.detail, detail);
      setHidden(refs.detail, !detail);
      const dismissible = property(current, 'dismissible') === true
        && (kind === 'connection' && status === 'reconnected' || kind === 'save' && ['saved', 'failed'].includes(status)
          || kind === 'action' && ['requested', 'failed'].includes(status));
      setHidden(refs.dismiss, !dismissible);
      setAttribute(refs.dismiss, 'aria-label', this._text(hass, 'feedback.dismiss', { message: caption }));
    }
    setHidden(this.el, !visible);
    return visible;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.el.removeEventListener('pointerdown', this._start);
    this.el.removeEventListener('keydown', this._start);
    for (const name of ['pointerup', 'pointercancel', 'keyup']) this.el.removeEventListener(name, this._end);
    this.el.removeEventListener('click', this._click);
    this.el.remove();
    this.onDismiss = null;
    this.rows.clear();
  }
}
