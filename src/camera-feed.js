// Embed HA's native camera card; HA owns authentication, stream selection and playback.
// Connect the container before open(entityId, hass). update(hass) keeps the same card.
// close()/dispose() REMOVE it so native disconnectedCallback releases its resources.
// Ancestor capture handlers must skip [data-taylors3d-ui]. Escape intentionally bubbles
// to the containing device popup. onMoreInfo(entityId) runs after the feed is removed.
import { entityMetadata } from './entity-metadata.js';
import { localize, localeInfo } from './localization.js';
import liveCaptions from './translations/live-camera-scenes.js';

const STOP_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click',
  'dblclick', 'mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend',
  'touchcancel', 'wheel', 'contextmenu'];
const STREAM_TYPES = new Set(['hls', 'web_rtc']);
const UNSUPPORTED = new Set(['unknown_command', 'unknown_type', 'unsupported_command']);
const DENIED = new Set(['unauthorized', 'unauthorized_connection', 'not_allowed', 'forbidden',
  'authentication_required', 'access_denied', '401', '403']);

const STYLE = `
  .taylors3d-camera-feed { margin-top: 12px; border-top: 1px solid var(--divider-color, #ddd);
    padding-top: 10px; color: var(--primary-text-color, #212121); font: inherit; }
  .taylors3d-camera-feed .t3d-camera-title { font-weight: 600; overflow-wrap: anywhere; }
  .taylors3d-camera-feed .t3d-camera-status { margin: 6px 0; }
  .taylors3d-camera-feed .t3d-camera-help { margin: 6px 0 10px; font-size: 12px;
    color: var(--secondary-text-color, #727272); }
  .taylors3d-camera-feed .t3d-camera-viewport { width: 100%; overflow: hidden; border-radius: 10px; }
  .taylors3d-camera-feed .t3d-camera-viewport > * { display: block; width: 100%; }
  .taylors3d-camera-feed .t3d-camera-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .taylors3d-camera-feed button { font: inherit; min-height: 44px; padding: 6px 10px;
    border-radius: 10px; border: 1px solid var(--divider-color, #ddd); cursor: pointer;
    background: var(--secondary-background-color, var(--ha-card-background, var(--card-background-color, #f5f5f5)));
    color: var(--primary-text-color, #212121); }
  .taylors3d-camera-feed button:disabled { opacity: .5; cursor: default; }
  .taylors3d-camera-feed button:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  .taylors3d-camera-feed [hidden] { display: none; }
`;

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(text, action) {
  const el = element('button', '', text);
  el.type = 'button';
  el.dataset.action = action;
  return el;
}

const errorCode = (error) => String(error?.code ?? error?.error?.code ?? '').toLowerCase();

export class CameraFeedController {
  constructor(root, { onMoreInfo } = {}) {
    if (!root || typeof root.append !== 'function') throw new TypeError('Camera container is required.');
    this.root = root;
    this.onMoreInfo = onMoreInfo;
    this.hass = null;
    this.el = null;
    this._card = null;
    this._entityId = null;
    this._status = 'closed';
    this._statusKey = null;
    this._session = 0;
    this._disposed = false;
    this._capabilities = null;
    this._connection = null;
    this._observer = null;
    this._blockedByState = false;
    this._stop = (event) => event.stopPropagation();
    this._click = (event) => {
      // A close action removes the section and its listeners during this dispatch.
      // Stop here too so that same click cannot escape after listener cleanup.
      event.stopPropagation();
      const target = event.target.closest?.('button[data-action]');
      if (!target || target.disabled || !this.el?.contains(target)) return;
      if (target.dataset.action === 'close-camera') this.close();
      else if (target.dataset.action === 'retry-camera') this.retry();
      else if (target.dataset.action === 'camera-more-info') this._moreInfo();
    };
  }

  get isOpen() { return !!this.el; }
  get entityId() { return this._entityId; }
  get status() { return this._status; }
  get nativeCard() { return this._card; }

  _text(key) {
    const full = `live.camera.${key}`, language = localeInfo(this.hass).resolved;
    return localize(this.hass, full, {}, liveCaptions[language]?.[full] ?? liveCaptions.en[full] ?? '');
  }
  _refreshCaptions() {
    if (!this.el) return;
    this.el.setAttribute('aria-label', this._text('aria'));
    this._title.textContent = this.hass?.states?.[this._entityId]?.attributes?.friendly_name || this._entityId || this._text('title');
    this._help.textContent = this._text('help');
    this._closeButton.textContent = this._text('close');
    this._retryButton.textContent = this._text('retry');
    this._infoButton.textContent = this._text('controls');
    this._infoButton.setAttribute('aria-label', this._text('controlsAria'));
    if (this._statusKey) this._statusEl.textContent = this._text(this._statusKey);
  }

  async open(entityId, hass = this.hass) {
    if (this._disposed) return false;
    this.close();
    this.hass = hass;
    this._entityId = entityId;
    this._connection = hass?.connection || null;
    const session = this._session;
    this._createUI();
    const problem = this._problem();
    if (problem) {
      this._block(problem);
      return false;
    }
    this._setStatus('loading', 'opening');
    try {
      const [capabilities, helpers] = await Promise.all([
        this._fetchCapabilities(hass, entityId), this._loadHelpers(),
      ]);
      if (!this._current(session)) return false;
      const nextProblem = this._problem();
      if (nextProblem) { this._block(nextProblem); return false; }
      if (!helpers || typeof helpers.createCardElement !== 'function') throw new Error('camera_helpers');
      const card = await helpers.createCardElement({
        type: 'picture-entity', entity: entityId, camera_view: 'live', show_name: false,
        show_state: false, fit_mode: 'contain', tap_action: { action: 'none' },
      });
      if (!this._current(session)) { card?.remove?.(); return false; }
      const finalProblem = this._problem();
      if (finalProblem) { card?.remove?.(); this._block(finalProblem); return false; }
      if (!card || card.nodeType !== 1 || card.localName === 'hui-error-card') throw new Error('camera_card');
      this._capabilities = capabilities;
      this._card = card;
      card.hass = this.hass;
      this._viewport.append(card);
      this._setReadyStatus();
      return true;
    } catch (error) {
      if (!this._current(session)) return false;
      this._removeCard();
      const code = errorCode(error);
      const messageKey = DENIED.has(code) ? 'denied'
        : code === 'not_found' || code === 'entity_not_found' ? 'missing'
          : error?.message === 'camera_helpers' ? 'helpers' : 'openFailed';
      this._blockedByState = false;
      this._setStatus('error', messageKey);
      return false;
    }
  }

  update(hass) {
    this.hass = hass;
    if (!this.isOpen) return;
    this._refreshCaptions();
    const problem = this._problem();
    if (problem) { this._block(problem); return; }
    if ((hass?.connection || null) !== this._connection && (this._status === 'ready' || this._status === 'loading')) {
      this.open(this._entityId, hass);
      return;
    }
    if (this._card) {
      this._card.hass = hass;
      this._setReadyStatus();
    } else if (this._blockedByState) {
      this._setStatus('error', 'available');
    } else {
      this._refreshButtons();
    }
  }

  retry() { return this.isOpen ? this.open(this._entityId, this.hass) : Promise.resolve(false); }

  _current(session) { return !this._disposed && this.isOpen && this._session === session; }

  _problem() {
    if (typeof this._entityId !== 'string' || !/^camera\.[^\s.]+$/.test(this._entityId)) {
      return { status: 'error', messageKey: 'choose' };
    }
    if (!this.el?.isConnected) return { status: 'error', messageKey: 'detached' };
    if (!this.hass || this.hass.connected === false || this.hass.connection?.connected === false) {
      return { status: 'disconnected', messageKey: 'disconnected' };
    }
    const state = this.hass.states?.[this._entityId];
    if (!state) return { status: 'unavailable', messageKey: 'missing' };
    if (entityMetadata(this.hass, this._entityId).disabled) return { status: 'unavailable', messageKey: 'disabled' };
    if (['unavailable', 'unknown', 'off'].includes(state.state)) {
      const messageKey = state.state === 'unknown' ? 'unknown' : state.state === 'off' ? 'off' : 'unavailable';
      return { status: 'unavailable', messageKey };
    }
    return null;
  }

  async _fetchCapabilities(hass, entityId) {
    // Empty stream types still allow native HA's MJPEG fallback. Do not build proxy URLs
    // or infer whether a camera integration supplies a current feed or a recording.
    if (typeof hass.callWS !== 'function') return null;
    try {
      return await hass.callWS({ type: 'camera/capabilities', entity_id: entityId });
    } catch (error) {
      if (UNSUPPORTED.has(errorCode(error))) return null;
      throw error;
    }
  }

  async _loadHelpers() {
    if (typeof window.loadCardHelpers !== 'function') throw new Error('camera_helpers');
    return window.loadCardHelpers();
  }

  _createUI() {
    this.el = element('section', 'taylors3d-camera-feed');
    this.el.dataset.taylors3dUi = 'camera-feed';
    this.el.dataset.entity = typeof this._entityId === 'string' ? this._entityId : '';
    const style = element('style', '', STYLE);
    this._title = element('div', 't3d-camera-title');
    this._statusEl = element('p', 't3d-camera-status');
    this._statusEl.setAttribute('role', 'status');
    this._statusEl.setAttribute('aria-live', 'polite');
    this._viewport = element('div', 't3d-camera-viewport');
    this._help = element('p', 't3d-camera-help');
    const actions = element('div', 't3d-camera-actions');
    this._closeButton = button('', 'close-camera');
    this._retryButton = button('', 'retry-camera');
    this._infoButton = button('', 'camera-more-info');
    actions.append(this._closeButton, this._retryButton, this._infoButton);
    this.el.append(style, this._title, this._statusEl, this._viewport, this._help, actions);
    this._refreshCaptions();
    this.el.addEventListener('click', this._click);
    for (const name of STOP_EVENTS) this.el.addEventListener(name, this._stop);
    this.root.append(this.el);
    this._closeButton.focus({ preventScroll: true });
    // Watch the owning shadow tree AND document so removing either the section or its
    // card's shadow host releases playback and invalidates any outstanding async work.
    this._observer = new MutationObserver(() => {
      if (this.isOpen && !this.el.isConnected) this.close();
    });
    this._observer.observe(this.root.ownerDocument, { childList: true, subtree: true });
    const tree = this.root.getRootNode();
    if (tree !== this.root.ownerDocument) this._observer.observe(tree, { childList: true, subtree: true });
  }

  _setStatus(status, messageKey) {
    this._status = status;
    this._statusKey = messageKey;
    if (!this.el) return;
    this.el.dataset.status = status;
    this.el.setAttribute('aria-busy', String(status === 'loading'));
    this._statusEl.textContent = this._text(messageKey);
    this._viewport.hidden = !this._card;
    this._refreshButtons();
  }

  _setReadyStatus() {
    const advertisedStream = this._capabilities?.frontend_stream_types?.some?.((type) => STREAM_TYPES.has(type));
    this._blockedByState = false;
    this._setStatus('ready', advertisedStream ? 'stream' : 'preview');
  }

  _refreshButtons() {
    if (!this.el) return;
    this._retryButton.hidden = this._status === 'ready' || this._status === 'loading';
    this._retryButton.disabled = !!this._problem();
    this._infoButton.disabled = typeof this.onMoreInfo !== 'function' || typeof this._entityId !== 'string'
      || !/^camera\.[^\s.]+$/.test(this._entityId);
  }

  _block(problem) {
    if (this._card || this._status === 'loading') this._session++;
    this._removeCard();
    this._blockedByState = true;
    this._setStatus(problem.status, problem.messageKey);
  }

  _removeCard() {
    this._card?.remove();
    this._card = null;
    this._capabilities = null;
  }

  async _moreInfo() {
    const entityId = this._entityId;
    this.close();
    const session = this._session;
    try {
      await this.onMoreInfo(entityId);
    } catch (_error) {
      if (this._disposed || this.isOpen || this._session !== session || !this.root.isConnected) return;
      this._entityId = entityId;
      this._createUI();
      this._setStatus('error', 'controlsFailed');
    }
  }

  close() {
    this._session++;
    this._observer?.disconnect();
    this._observer = null;
    this._removeCard();
    if (this.el) {
      this.el.removeEventListener('click', this._click);
      for (const name of STOP_EVENTS) this.el.removeEventListener(name, this._stop);
      this.el.remove();
    }
    this.el = null;
    this._title = this._statusEl = this._viewport = this._help = null;
    this._closeButton = this._retryButton = this._infoButton = null;
    this._entityId = null;
    this._status = 'closed';
    this._statusKey = null;
    this._connection = null;
    this._blockedByState = false;
  }

  dispose() { this.close(); this._disposed = true; this.hass = null; }
}
