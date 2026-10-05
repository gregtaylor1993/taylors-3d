// Saved visual previews and separate deliberate HA scene actions. The controller
// owns renderer overrides; this bar never reads or writes a real scene definition.
import { entityMetadata } from './entity-metadata.js';
import { readScenePreviews, sceneActivationAvailability, validateScenePreview } from './scene-preview.js';

const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const signature = (value) => { try { return JSON.stringify(value); } catch { return null; } };
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
const messages = (diagnostics) => [...new Set(diagnostics.map((diagnostic) => diagnostic.message))].join(' ');
const node = (tag, content) => { const element = document.createElement(tag); if (content) element.textContent = content; return element; };
const idValid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
let nextBar = 0;

const CSS = `
[data-scene-preview-bar]{box-sizing:border-box;max-width:100%;padding:10px;border:1px solid var(--divider-color,#888);border-radius:12px;background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color,#212121);font:inherit}
[data-scene-preview-bar][hidden]{display:none}[data-scene-preview-bar] h3,[data-scene-preview-bar] p{margin:0;overflow-wrap:anywhere}
[data-scene-preview-bar] h3{font-size:14px}[data-scene-preview-bar] .scene-preview-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
[data-scene-preview-bar] .scene-preview-note,[data-scene-preview-bar] .scene-preview-reason{font-size:12px;margin-top:5px;color:var(--primary-text-color,#212121)}
[data-scene-preview-bar] .scene-preview-items{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;max-width:100%;max-height:min(30vh,220px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
[data-scene-preview-bar] .scene-preview-row{box-sizing:border-box;max-width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:4px;border:1px solid var(--divider-color,#888);border-radius:10px;padding:4px}
[data-scene-preview-bar] .scene-preview-reason{flex-basis:100%;margin:0 3px}
[data-scene-preview-bar] button{box-sizing:border-box;min-width:44px;min-height:44px;max-width:100%;padding:8px 10px;border:1px solid var(--divider-color,#888);border-radius:8px;background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#fff)));color:var(--primary-text-color,#212121);font:inherit;cursor:pointer;overflow-wrap:anywhere}
[data-scene-preview-bar] button[aria-pressed=true]{border:2px solid var(--primary-color,#03a9f4)}
[data-scene-preview-bar] button:focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}
[data-scene-preview-bar] button:disabled{opacity:.6;cursor:default}[data-scene-preview-bar] [data-scene-preview-status]{font-size:13px;margin-top:7px;overflow-wrap:anywhere}
`;

/** getContext(): {hass,settings,suspended,contextKey?,status?}. The context key
 * should be root's stable layout/model/view generation, never a new array.
 * update preserves keyed buttons and focused controls across unrelated HA data.
 * dispose stops only a token started by this bar and does not dispose controller.
 */
export class ScenePreviewBar {
  constructor(host, { controller, getContext = () => ({}) } = {}) {
    this.host = host; this.controller = controller; this.getContext = getContext;
    this._rows = new Map(); this._pressed = new Map(); this._hover = new Map();
    this._ownedToken = null; this._pinnedToken = null; this._pending = null;
    this._message = null; this._generation = 0; this._disposed = false; this._updating = false;
    this._prefix = `taylors3d-scenes-${++nextBar}`;
    this.el = node('section'); this.el.dataset.scenePreviewBar = ''; this.el.dataset.taylors3dUi = 'scene-preview-bar';
    this.el.setAttribute('aria-label', 'Saved scene light previews'); this.el.tabIndex = -1;
    const style = node('style', CSS), heading = node('div'); heading.className = 'scene-preview-heading';
    this.stopButton = this._button('stop', 'Stop preview'); heading.append(node('h3', 'Scenes'), this.stopButton);
    const note = node('p', 'Preview changes the model lights. Activate runs your saved Home Assistant scene.'); note.className = 'scene-preview-note';
    this.items = node('div'); this.items.className = 'scene-preview-items';
    this.status = node('p'); this.status.dataset.scenePreviewStatus = ''; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.el.append(style, heading, note, this.items, this.status); host.append(this.el);
    this._handlers = new Map([
      ['pointerenter', (event) => this._over(event)], ['pointerleave', (event) => this._out(event)],
      ['pointerdown', (event) => this._press(event)], ['pointerup', (event) => this._release(event)],
      ['pointercancel', (event) => this._cancel(event)], ['keydown', (event) => this._key(event)],
      ['keyup', (event) => this._release(event)], ['focusout', (event) => this._blur(event)],
      ['click', (event) => this._click(event)],
    ]);
    for (const [type, handler] of this._handlers) this.el.addEventListener(type, handler, ['pointerenter', 'pointerleave'].includes(type));
    this.update();
  }

  _button(action, label, id) {
    const button = node('button', label); button.type = 'button'; button.dataset.sceneAction = action;
    if (id !== undefined) button.dataset.sceneId = id;
    return button;
  }
  _context() { const value = this.getContext(); return plain(value) ? value : {}; }
  _live(button) { return !this._disposed && !!this.host.isConnected && !!this.el.isConnected && this.el.contains(button); }
  _buttonFor(event) { const button = event.target?.closest?.('button[data-scene-action]'); return button && this.el.contains(button) ? button : null; }
  _state(id, context = this._context()) {
    const settings = readScenePreviews(context.settings), items = settings.items;
    const matches = items.filter((item) => plain(item) && item.id === id), binding = matches.length === 1 ? matches[0] : null;
    const reasons = settings.diagnostics.map((diagnostic) => diagnostic.message);
    if (context.suspended) reasons.push('Scene previews are paused while this view is unavailable.');
    if (!settings.enabled) reasons.push('Scene previews are not enabled.');
    if (matches.length !== 1 || !idValid(id)) reasons.push('Choose one exact current saved scene preview ID.');
    if (binding && Object.hasOwn(binding, 'label') && (typeof binding.label !== 'string' || binding.label.length > 256)) reasons.push('The saved scene label is invalid.');
    if (binding && items.filter((item) => plain(item) && item.scene_entity === binding.scene_entity).length !== 1) reasons.push('This scene has duplicate saved preview mappings.');
    const available = sceneActivationAvailability(context.hass, binding?.scene_entity);
    const preview = validateScenePreview(context.hass, binding);
    const activationReasons = [...reasons, ...available.diagnostics.map((diagnostic) => diagnostic.message)];
    return { binding, settings, context, activationReasons, previewReasons: [...activationReasons, ...preview.diagnostics.map((diagnostic) => diagnostic.message)],
      canActivate: activationReasons.length === 0, canPreview: activationReasons.length === 0 && preview.valid };
  }
  _stamp(state) {
    const context = state.context, hass = context.hass;
    return { id: state.binding?.id, entity: state.binding?.scene_entity, connection: hass?.connection,
      user: hass?.user?.id, callService: hass?.callService, contextKey: context.contextKey,
      semantic: signature([context.settings, context.suspended === true, hass?.connection?.connected === true,
        hass?.user?.id, hass?.user?.is_active, hass?.user?.is_admin, hass?.user?.permissions, state.activationReasons]) };
  }
  _same(stamp, state) {
    const next = this._stamp(state);
    return state.canActivate && stamp.id === next.id && stamp.entity === next.entity && stamp.connection === next.connection
      && stamp.user === next.user && stamp.callService === next.callService && stamp.contextKey === next.contextKey && stamp.semantic === next.semantic;
  }
  _label(binding, context) {
    return typeof binding?.label === 'string' && binding.label.trim() ? binding.label
      : entityMetadata(context.hass, binding?.scene_entity).name || 'Invalid scene preview';
  }
  _stopOwned() {
    if (this._ownedToken) this.controller?.stop(this._ownedToken);
    this._ownedToken = null; this._pinnedToken = null; this._hover.clear();
  }

  update() {
    if (this._disposed || this._updating) return;
    this._updating = true;
    try {
      let context = this._context();
      if (context.suspended || !this.host.isConnected) this._stopOwned();
      else if (this._ownedToken) this.controller?.revalidate();
      context = this._context();
      const settings = readScenePreviews(context.settings), active = this.controller?.active;
      if (this._ownedToken && active?.token !== this._ownedToken) { this._ownedToken = null; this._pinnedToken = null; }
      for (const [button, gesture] of this._pressed) if (!gesture.poisoned && (!this._live(button) || !this._same(gesture.stamp, this._state(gesture.id, context)))) gesture.poisoned = true;
      this.el.hidden = context.suspended === true || !settings.enabled || !settings.items.length;
      const seen = new Map(), keep = new Set();
      for (const [index, binding] of settings.items.entries()) {
        const id = typeof binding?.id === 'string' ? binding.id : '', base = id ? `id:${id}` : `invalid:${index}`;
        const occurrence = seen.get(base) || 0; seen.set(base, occurrence + 1);
        const key = `${base}:${occurrence}`; keep.add(key);
        let row = this._rows.get(key);
        if (!row) {
          const el = node('div'); el.className = 'scene-preview-row'; el.setAttribute('role', 'group');
          const preview = this._button('preview', '', id), activate = this._button('activate', 'Activate', id), reason = node('p');
          reason.className = 'scene-preview-reason'; reason.id = `${this._prefix}-reason-${++nextBar}`;
          preview.setAttribute('aria-describedby', reason.id); activate.setAttribute('aria-describedby', reason.id);
          el.append(preview, activate, reason); row = { el, preview, activate, reason }; this._rows.set(key, row);
        }
        const state = this._state(id, context), label = this._label(binding, context);
        text(row.preview, `Preview ${label}`); row.preview.setAttribute('aria-label', `Preview ${label} in the model only`);
        row.activate.setAttribute('aria-label', `Activate ${label} in Home Assistant`); row.el.setAttribute('aria-label', label);
        row.preview.disabled = !state.canPreview || !!this._pending; row.activate.disabled = !state.canActivate || !!this._pending;
        row.preview.setAttribute('aria-pressed', String(active?.token === this._ownedToken && active?.itemId === id && !!this._ownedToken));
        const explanation = !state.canActivate ? state.activationReasons[0] : !state.canPreview ? state.previewReasons[0] : '';
        text(row.reason, explanation || ''); row.reason.hidden = !explanation;
        row.preview.title = [...new Set(state.previewReasons)].join(' '); row.activate.title = [...new Set(state.activationReasons)].join(' ');
        if (this.items.children[index] !== row.el) this.items.insertBefore(row.el, this.items.children[index] || null);
      }
      for (const [key, row] of this._rows) if (!keep.has(key)) {
        const focused = row.el.contains(row.el.getRootNode().activeElement);
        this._pressed.delete(row.activate); this._hover.delete(row.preview); row.el.remove(); this._rows.delete(key);
        if (focused && !this.el.hidden) this.el.focus();
      }
      this.stopButton.disabled = !this._ownedToken || active?.token !== this._ownedToken;
      const status = context.status;
      let message = this._pending ? `Activating ${this._pending.label}…` : '';
      if (!message && this._ownedToken && active?.token === this._ownedToken) {
        const binding = settings.items.find((item) => item?.id === active.itemId);
        message = `Previewing ${this._label(binding, context)} in the model only${this._pinnedToken === this._ownedToken ? '. Press Stop preview to finish.' : '.'}`;
      } else if (!message && this._message) message = this._message;
      else if (!message && status?.status === 'error') message = status.error || 'The scene action failed.';
      else if (!message && status?.status === 'invalid') message = messages(status.diagnostics || []);
      text(this.status, message || 'Choose a preview, or activate a saved scene.');
    } finally { this._updating = false; }
  }

  _preview(button, pinned) {
    if (!this._live(button)) return;
    const state = this._state(button.dataset.sceneId);
    if (!state.canPreview || this._pending || !pinned && this._pinnedToken && this.controller?.active?.token === this._pinnedToken) return;
    const result = this.controller?.preview(state.binding.id);
    if (this._disposed) { if (result?.token) this.controller?.stop(result.token); return; }
    if (result?.ok) { this._ownedToken = result.token; this._pinnedToken = pinned ? result.token : null; this._hover.set(button, result.token); this._message = null; }
    else this._message = messages(result?.diagnostics || []) || 'This visual preview is unavailable.';
    this.update();
  }
  _over(event) {
    const button = this._buttonFor(event); if (!button || button.dataset.sceneAction !== 'preview' || button.contains(event.relatedTarget) || event.pointerType !== 'mouse') return;
    this._preview(button, false);
  }
  _out(event) {
    const button = this._buttonFor(event); if (!button || button.dataset.sceneAction !== 'preview' || button.contains(event.relatedTarget)) return;
    const token = this._hover.get(button); this._hover.delete(button);
    if (token && token !== this._pinnedToken) { this.controller?.stop(token); if (token === this._ownedToken) this._ownedToken = null; this.update(); }
  }
  _press(event) {
    event.stopPropagation(); const button = this._buttonFor(event);
    if (!button || button.dataset.sceneAction !== 'activate' || !this._live(button) || event.button !== undefined && event.button !== 0) return;
    const state = this._state(button.dataset.sceneId);
    this._pressed.set(button, { id: button.dataset.sceneId, stamp: this._stamp(state), poisoned: !state.canActivate || !!this._pending, consumed: false, held: true });
  }
  _release(event) {
    event.stopPropagation(); const button = this._buttonFor(event), gesture = this._pressed.get(button);
    if (!gesture) return;
    gesture.held = false;
    if (gesture.consumed && !gesture.poisoned) this._pressed.delete(button);
  }
  _cancel(event) { event.stopPropagation(); const gesture = this._pressed.get(this._buttonFor(event)); if (gesture) gesture.poisoned = true; }
  _blur(event) { const gesture = this._pressed.get(this._buttonFor(event)); if (gesture && gesture.held) gesture.poisoned = true; }
  _key(event) {
    event.stopPropagation();
    if (event.key === 'Escape') { this._stopOwned(); this.update(); return; }
    if (!['Enter', ' '].includes(event.key) || event.repeat) return;
    this._press(event);
  }
  _click(event) {
    event.stopPropagation(); const button = this._buttonFor(event);
    if (!button || !this._live(button) || button.disabled) return;
    if (button.dataset.sceneAction === 'stop') { this._stopOwned(); this._message = null; this.update(); }
    else if (button.dataset.sceneAction === 'preview') this._preview(button, true);
    else if (button.dataset.sceneAction === 'activate') {
      const state = this._state(button.dataset.sceneId), gesture = this._pressed.get(button);
      if (gesture && (gesture.poisoned || gesture.consumed || !this._same(gesture.stamp, state))) { if (gesture) gesture.poisoned = true; return; }
      if (!state.canActivate || this._pending) return;
      if (gesture) { gesture.consumed = true; if (!gesture.held) this._pressed.delete(button); }
      this._activate(state);
    }
  }
  async _activate(state) {
    const generation = this._generation, stamp = this._stamp(state);
    this._pending = { id: state.binding.id, label: this._label(state.binding, state.context), stamp };
    this._message = null; this.update();
    try {
      const result = await this.controller.activate(state.binding.id, { expectedSceneEntity: stamp.entity });
      if (!this._disposed && generation === this._generation && this._same(stamp, this._state(stamp.id)) && result?.current !== false) {
        this._message = result?.ok ? `Activated ${this._pending.label}.` : result?.error || messages(result?.diagnostics || []) || 'The scene action could not be sent.';
      }
    } catch (error) {
      if (!this._disposed && generation === this._generation && this._same(stamp, this._state(stamp.id))) this._message = error?.message || String(error);
    } finally {
      if (!this._disposed && generation === this._generation) { this._pending = null; this.update(); }
    }
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true; this._generation++; this._stopOwned();
    for (const [type, handler] of this._handlers) this.el.removeEventListener(type, handler, ['pointerenter', 'pointerleave'].includes(type));
    this._pressed.clear(); this._hover.clear(); this._rows.clear(); this.el.remove();
  }
}
