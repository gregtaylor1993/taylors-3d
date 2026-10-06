// Room and marker controls. Opening a popup only reads Home Assistant state.
// Integration: new DevicePopup(stage, { onAction(domain, service, data), onMoreInfo(entityId) });
// Call update(hass) with each HA update, then showMarker(marker, [clientX, clientY]) or
// showRoom(room, markers, [clientX, clientY]). Positions are optional client-screen coordinates.
// Stage capture handlers must skip composedPath().includes(popup.el), and the outside
// pointer event popup.closedBy, so closing a popup cannot also select a room/device.
// A primary camera marker opens its native view. Grouped/room camera entities get
// deliberate Camera view buttons. openCamera(entityId) requires a matching visible row.

import { CameraFeedController } from './camera-feed.js';
import { entityMetadata, formatEntityValue } from './entity-metadata.js';
import { lightCapabilities, readLightAppearance } from './light-state.js';
import { buildRoomSummary } from './room-summary.js';
import { localize } from './localization.js';
import { CustomControlsView } from './custom-controls-view.js';
import { readDeviceControls, deviceCommand, deviceAuthContext, sameDeviceAuth } from './device-controls.js';
import deviceControlCaptions from './translations/device-controls.js';

const deviceText = (hass,key,params = {}) => localize(hass,`deviceControls.${key}`,params,deviceControlCaptions.en[`deviceControls.${key}`] || key);

const QUICK_TOGGLE = new Set(['light', 'switch', 'fan', 'input_boolean']);
const LIGHT_SOURCE_ERRORS = new Set(['missing', 'state', 'attributes', 'domain', 'restored', 'unavailable', 'unknown']);
const SWATCHES = [
  ['Red', [255, 59, 48]], ['Orange', [255, 149, 0]], ['Yellow', [255, 214, 10]], ['Green', [52, 199, 89]],
  ['Teal', [48, 213, 200]], ['Blue', [10, 132, 255]], ['Purple', [175, 82, 222]], ['Pink', [255, 55, 145]],
];
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const rgbHex = (rgb) => Array.isArray(rgb) && rgb.length === 3 && rgb.every((v) => finite(v) && v >= 0 && v <= 255)
  ? '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : null;
const hexRgb = (hex) => typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)
  ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;
const inputContext = (control, kind) => JSON.stringify([control.entityId, kind, control.dimmable, control.rgb,
  control.colorTemperature, kind === 'kelvin' ? control.minKelvin : null, kind === 'kelvin' ? control.maxKelvin : null]);
// Older popup hosts may supply their own onAction without HA authentication
// fields. Preserve that API while observing every identity/permission field
// actually supplied by HA. Locale and changing device readings are absent.
const popupAuthContext = (hass) => {
  if (hass?.user && (typeof hass.user.id !== 'string' || !hass.user.id.trim() || hass.user.is_active === false)) return null;
  let semantic;
  try { semantic = JSON.stringify([hass?.user?.id, hass?.user?.is_active, hass?.user?.is_admin, hass?.user?.permissions]); }
  catch { return null; }
  return { connection: hass?.connection, auth: hass?.auth, callService: hass?.callService, userId: hass?.user?.id, semantic };
};
const STOP_EVENTS = ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'click', 'dblclick',
  'contextmenu', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'touchmove', 'wheel'];

const STYLE = `
  .taylors3d-device-popup { position: absolute; z-index: 30; box-sizing: border-box;
    width: 300px; max-width: calc(100% - 16px); max-height: calc(100% - 16px); overflow: auto;
    padding: 12px; border-radius: 16px; background: var(--ha-card-background, var(--card-background-color, #fff));
    color: var(--primary-text-color, #212121); border: 1px solid var(--divider-color, #ddd);
    box-shadow: 0 6px 24px rgba(0,0,0,.25); font: inherit; font-size: 14px;
    touch-action: manipulation; user-select: text; }
  .taylors3d-device-popup .t3d-popup-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .taylors3d-device-popup h3 { margin: 0; flex: 1; font-size: 16px; overflow-wrap: anywhere; }
  .taylors3d-device-popup button { font: inherit; border-radius: 10px; cursor: pointer; min-height: 44px;
    border: 1px solid var(--divider-color, #ddd);
    background: var(--secondary-background-color, var(--ha-card-background, var(--card-background-color, #f5f5f5)));
    color: var(--primary-text-color, #212121); padding: 6px 10px; }
  .taylors3d-device-popup button:focus-visible, .taylors3d-device-popup input:focus-visible, .taylors3d-device-popup select:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  .taylors3d-device-popup button:disabled { opacity: .5; cursor: default; }
  .taylors3d-device-popup .t3d-popup-close { min-width: 44px; font-size: 20px; }
  .taylors3d-device-popup[data-placement="right"] { left: auto; right: 8px; top: 8px;
    bottom: calc(var(--taylors3d-bar-height, 0px) + 8px); width: 316px; max-height: none;
    border-radius: 16px; box-shadow: 0 3px 18px rgba(0,0,0,.16); }
  .taylors3d-device-popup .t3d-popup-kind { margin: 0 0 4px; font-size: 12px;
    color: var(--secondary-text-color, #727272); }
  .taylors3d-device-popup .t3d-entity { border-top: 1px solid var(--divider-color, #ddd); padding: 10px 0; }
  .taylors3d-device-popup .t3d-entity-name { font-weight: 600; overflow-wrap: anywhere; }
  .taylors3d-device-popup .t3d-entity-value { margin: 4px 0 8px; color: var(--secondary-text-color, #727272); }
  .taylors3d-device-popup .t3d-entity-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .taylors3d-device-popup .t3d-brightness { display: block; margin: 10px 0 2px; }
  .taylors3d-device-popup .t3d-brightness input { display: block; width: 100%; margin-top: 6px;
    min-height: 44px; box-sizing: border-box; accent-color: var(--primary-color, #03a9f4); }
  .taylors3d-device-popup .t3d-colour { min-width: 0; border: 0; margin: 12px 0 0; padding: 0; }
  .taylors3d-device-popup .t3d-colour legend { padding: 0; }
  .taylors3d-device-popup .t3d-swatches { display: grid; grid-template-columns: repeat(auto-fit, minmax(44px, 1fr)); gap: 8px; margin: 8px 0; }
  .taylors3d-device-popup .t3d-swatches button { min-width: 44px; padding: 6px; }
  .taylors3d-device-popup .t3d-swatches button[aria-pressed="true"] { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -3px; }
  .taylors3d-device-popup .t3d-swatch-dot { display: block; width: 22px; height: 22px; border-radius: 50%; margin: auto;
    border: 1px solid var(--divider-color, #ddd); }
  .taylors3d-device-popup .t3d-colour-picker { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .taylors3d-device-popup input[type="color"] { min-width: 56px; min-height: 44px; width: 100%; box-sizing: border-box; }
  .taylors3d-device-popup .t3d-light-reading { margin: 6px 0; overflow-wrap: anywhere; }
  .taylors3d-device-popup .t3d-entity-error { color: var(--error-color, #db4437); margin: 6px 0 0; }
  .taylors3d-device-popup .t3d-entity-status { color: var(--secondary-text-color, #727272); margin: 6px 0 0; }
  .taylors3d-device-popup .t3d-inline-buttons,.taylors3d-device-popup .t3d-room-actions-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;margin:10px 0; }
  .taylors3d-device-popup .t3d-inline-buttons button,.taylors3d-device-popup .t3d-room-actions-grid button { min-width:44px;max-width:100%;white-space:normal;overflow-wrap:anywhere; }
  .taylors3d-device-popup .t3d-inline-fields label { display:flex;flex-direction:column;gap:6px;margin:10px 0;min-width:0;overflow-wrap:anywhere; }
  .taylors3d-device-popup .t3d-inline-fields input,.taylors3d-device-popup .t3d-inline-fields select { box-sizing:border-box;width:100%;min-width:44px;max-width:100%;min-height:44px;padding:8px;border:1px solid var(--divider-color,#888);border-radius:8px;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--card-background-color,#fff)); }
  .taylors3d-device-popup .t3d-inline-reading,.taylors3d-device-popup .t3d-inline-hint,.taylors3d-device-popup .t3d-room-action-issue { overflow-wrap:anywhere;margin:6px 0;color:var(--secondary-text-color,#727272); }
  .taylors3d-device-popup .t3d-room-actions h4 { margin:12px 0 6px; }
  .taylors3d-device-popup .t3d-room-action-row { min-width:0; }
  .taylors3d-device-popup .t3d-room-action-row button { width:100%; }
  .taylors3d-device-popup [hidden] { display: none; }
`;

// Grouped device markers hold candidates {eid}; handmade live markers may only have entityId.
export function markerEntityIds(marker) {
  const ids = [marker && marker.entityId, ...((marker && marker.entities) || []).map((e) => typeof e === 'string' ? e : e && e.eid),
    marker && marker.secondaryId];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.includes('.')))];
}

export function roomEntityIds(room, markers) {
  if (!room || !room.area_id) return [];
  return [...new Set((markers || []).filter((m) => m.areaId === room.area_id).flatMap(markerEntityIds))];
}

const serviceExists = (hass, domain, service) => !hass.services || !!(hass.services[domain] && hass.services[domain][service]);

// State is authoritative: controls never pretend a command succeeded before HA reports it.
export function entityControl(hass, entityId) {
  const metadata = entityMetadata(hass, entityId);
  const state = metadata.state;
    const attr = (state && state.attributes) || {};
  const domain = metadata.domain;
  const caps = domain === 'light' ? lightCapabilities(state) : {};
  const appearance = domain === 'light' ? readLightAppearance(state) : null;
  const sourceIssue = appearance?.diagnostics.find((d) => LIGHT_SOURCE_ERRORS.has(d.code));
  // Missing appearance data must not prevent a deliberate supported command. A malformed
  // source (as opposed to its current colour/brightness) cannot authorize any command.
  const usable = domain !== 'light' || !!state && (state.entity_id === undefined || state.entity_id === entityId) && ['on', 'off'].includes(state.state)
    && !sourceIssue;
  const lightService = domain === 'light' && serviceExists(hass, 'light', 'turn_on');
  const minKelvin = finite(caps.minKelvin) ? Math.ceil(caps.minKelvin) : null;
  const maxKelvin = finite(caps.maxKelvin) ? Math.floor(caps.maxKelvin) : null;
  const kelvinBounds = minKelvin !== null && maxKelvin !== null && minKelvin > 0 && minKelvin <= maxKelvin;
  const brightness = finite(attr.brightness) && attr.brightness >= 0 && attr.brightness <= 255 ? Math.round(attr.brightness / 255 * 100) : null;
  return {
    entityId, name: metadata.name, value: domain !== 'light' && attr.restored === true ? deviceText(hass,'waiting')
      : domain === 'light' && attr.restored === true ? localize(hass, 'popup.lightWaiting')
      : sourceIssue && ['state', 'attributes', 'domain', 'restored'].includes(sourceIssue.code) ? localize(hass, 'popup.lightInvalid')
        : formatEntityValue(hass, entityId),
    available: metadata.available && !metadata.hidden && !metadata.category && usable && hass.connected !== false && hass.connection?.connected !== false,
    camera: domain === 'camera',
    toggle: QUICK_TOGGLE.has(domain) && serviceExists(hass, domain, 'toggle'),
    dimmable: lightService && caps.valid === true && caps.brightness === true && serviceExists(hass, 'light', 'turn_off'),
    rgb: lightService && caps.valid === true && caps.rgb === true,
    colorTemperature: lightService && caps.valid === true && caps.colorTemperature === true && kelvinBounds,
    minKelvin, maxKelvin,
    colorHex: appearance?.colorKnown ? rgbHex(appearance.color) : null,
    kelvin: state?.state === 'on' && attr.color_mode === 'color_temp' && Number.isInteger(attr.color_temp_kelvin)
      && kelvinBounds && attr.color_temp_kelvin >= minKelvin && attr.color_temp_kelvin <= maxKelvin ? attr.color_temp_kelvin : null,
    on: !!state && state.state === 'on',
    brightness: state && state.state === 'on' ? brightness : 0,
  };
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(text, action, entityId) {
  const el = element('button', '', text);
  el.type = 'button';
  el.dataset.action = action;
  if (entityId) el.dataset.entity = entityId;
  return el;
}

export class DevicePopup {
  constructor(root, { onAction, onMoreInfo, placement = 'popup', onVisibilityChange, getRoomActions, onRoomAction, getCustomRoomControls, onCustomControl } = {}) {
    this.root = root;
    this.placement = placement === 'right' ? 'right' : 'popup';
    this.onVisibilityChange = onVisibilityChange || (() => {});
    this.getRoomActions = getRoomActions; this.onRoomAction = onRoomAction;
    this.getCustomRoomControls = getCustomRoomControls; this.onCustomControl = onCustomControl;
    this.onAction = onAction || ((domain, service, data) => this.hass.callService(domain, service, data));
    this.onMoreInfo = onMoreInfo || ((entityId) => root.dispatchEvent(new CustomEvent('hass-more-info', {
      detail: { entityId }, bubbles: true, composed: true,
    })));
    this.hass = { states: {} };
    this.el = null;
    this.closedBy = null;
    this._session = 0;
    this._rows = new Map();
    this._pending = new Set();
    this._errors = new Map();
    this._deviceIntents = new Map(); this._fieldIntents = new Map(); this._actionRuns = new Set(); this._extraPending = new Map();
    this._roomRows = new Map(); this._roomPending = new Map(); this._roomErrors = new Map();
    this._cameraContainer = element('div', 't3d-popup-camera');
    this._cameraFeed = new CameraFeedController(this._cameraContainer, {
      onMoreInfo: (entityId) => { this.close(); return this.onMoreInfo(entityId); },
    });
    this._onOutside = (e) => {
      if (!this.el || e.composedPath().includes(this.el)) return;
      this.closedBy = e;
      this.close({ restoreFocus: false });
    };
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.el) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
  }

  get isOpen() { return !!this.el; }
  get isCategoryOpen() { return !!this.el && this._selection?.kind === 'category'; }
  get cameraFeed() { return this._cameraFeed; }

  showMarker(marker, position) {
    this._show({ kind: 'marker', marker, title: marker.name || marker.entityId || localize(this.hass, 'popup.device'),
      titleKey: !marker.name && !marker.entityId ? 'popup.device' : null }, position);
    if (marker.entityId?.startsWith('camera.')) this.openCamera(marker.entityId);
  }

  showRoom(room, markers, position) {
    const area = this.hass.areas && this.hass.areas[room.area_id];
    this._show({ kind: 'room', room, markers, title: (area && area.name) || room.name || localize(this.hass, 'popup.room'),
      titleKey: !(area && area.name) && !room.name ? 'popup.room' : null }, position);
  }

  showCategory({ id, title, titleKey, entityIds, emptyText, emptyTextKey, emptyTextParams, resolve }, position) {
    if (typeof id !== 'string' || typeof title !== 'string' || !Array.isArray(entityIds)) return;
    this._show({ kind: 'category', id, title, titleKey, entityIds: [...entityIds], emptyText, emptyTextKey, emptyTextParams, resolve }, position);
  }

  _show(selection, position) {
    const opener = this.root.getRootNode().activeElement || document.activeElement;
    this.close({ restoreFocus: false });
    this._opener = opener;
    this._selection = selection;
    this.closedBy = null;
    this._session++;
    this._position = position;
    const el = element('div', 'taylors3d-device-popup');
    el.dataset.placement = this.placement;
    el.dataset.taylors3dUi = '';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', selection.title);
    el.setAttribute('aria-modal', 'false');
    const style = element('style');
    style.textContent = STYLE;
    const head = element('div', 't3d-popup-head');
    const close = button('×', 'close');
    close.className = 't3d-popup-close';
    close.setAttribute('aria-label', localize(this.hass, 'common.closeControls'));
    const heading = element('div');
    heading.style.flex = '1';
    heading.append(element('p', 't3d-popup-kind', localize(this.hass, `popup.kind.${selection.kind === 'marker' ? 'device' : selection.kind}`)),
      element('h3', '', selection.title));
    if (selection.kind === 'room') {
      this._roomSummary = element('p', 't3d-room-summary'); this._roomSummary.hidden = true;
      heading.append(this._roomSummary);
    }
    head.append(heading, close);
    this._body = element('div', 't3d-popup-body');
    this._roomActions = element('section','t3d-room-actions'); this._roomActions.hidden = true;
    this._roomActionsTitle = element('h4'); this._roomActionsGrid = element('div','t3d-room-actions-grid');
    this._roomActions.append(this._roomActionsTitle,this._roomActionsGrid);
    this._customControlsHost = element('div', 't3d-custom-room-controls'); this._customControlsHost.hidden = true;
    el.append(style, head, this._cameraContainer, this._roomActions, this._customControlsHost, this._body);
    if (selection.kind === 'room' && this.getCustomRoomControls) {
      this._customControls = new CustomControlsView(this._customControlsHost, {
        getContext: () => this.getCustomRoomControls(this._selection?.room),
        onAction: (barId, buttonId) => this.onCustomControl?.(this._selection?.room?.id, barId, buttonId),
      });
    }
    for (const type of ['pointerdown','keydown']) el.addEventListener(type,(event) => this._devicePress(event),true);
    for (const type of ['pointerup','keyup']) el.addEventListener(type,(event) => this._deviceRelease(event),true);
    for (const type of ['pointercancel','focusout']) el.addEventListener(type,(event) => this._deviceCancel(event),true);
    el.addEventListener('focusin',(event) => this._deviceFocus(event),true);
    // Keep popup interactions out of orbiting, room selection and marker gestures.
    for (const type of STOP_EVENTS) el.addEventListener(type, (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => { this._onKey(e); e.stopPropagation(); });
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('input', (e) => e.target.dataset.deviceControl ? this._deviceInput(e) : this._sliderInput(e));
    el.addEventListener('change', (e) => e.target.dataset.deviceControl ? this._deviceChange(e) : this._sliderChange(e));
    el.addEventListener('focusout', (e) => { if (e.target.dataset.lightControl) { this._clearInput(e.target); this._refreshRows(); } });
    el.addEventListener('pointercancel', (e) => { if (e.target.dataset.lightControl) { e.target.dataset.cancelled = 'true'; this._clearInput(e.target); this._refreshRows(); } });
    this.el = el;
    this.root.append(el);
    this.onVisibilityChange(true, this.placement);
    window.addEventListener('pointerdown', this._onOutside, true);
    window.addEventListener('keydown', this._onKey);
    this._refreshRows();
    this.reposition();
    close.focus({ preventScroll: true });
  }

  update(hass) {
    this.observeContexts(hass);
    this.hass = hass || { states: {} };
    this._refreshRows();
    this._cameraFeed.update(this.hass);
  }

  openCamera(entityId) {
    if (!this.el || !this._rows.has(entityId) || !entityControl(this.hass, entityId).camera) return Promise.resolve(false);
    const opening = this._cameraFeed.open(entityId, this.hass);
    // Keep the chosen camera visible even after browsing a long grouped-device list.
    this.el.scrollTop = 0;
    return opening;
  }

  _entityIds(hass = this.hass) {
    const s = this._selection;
    let ids;
    if (s.kind === 'category') {
      let current;
      try { current = typeof s.resolve === 'function' ? s.resolve(hass) : s.entityIds; } catch { current = []; }
      ids = Array.isArray(current) ? current : current?.entityIds;
      s.currentEmptyText = typeof current?.emptyText === 'string' ? current.emptyText : s.emptyText;
      // Keys express ownership explicitly. Never infer it from an English
      // title/message that an external caller could also supply literally.
      s.currentEmptyTextKey = Array.isArray(current) ? s.emptyTextKey : current?.emptyTextKey;
      s.currentEmptyTextParams = Array.isArray(current) ? s.emptyTextParams : current?.emptyTextParams;
      if (!Array.isArray(ids)) ids = [];
      ids = [...new Set(ids.filter((id) => typeof id === 'string' && /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(id)))];
    } else ids = s.kind === 'room' ? roomEntityIds(s.room, s.markers) : markerEntityIds(s.marker);
    // Registry-hidden and diagnostic entities are never included in a room's controls.
    return ids.filter((id) => {
      const metadata = entityMetadata(hass, id);
      return !metadata.hidden && !metadata.category;
    });
  }

  _refreshRows() {
    if (!this.el || this._refreshingRows) return;
    // Removing a focused control synchronously emits focusout in Chrome. Its
    // handler must not replace the same row while this DOM update is in progress.
    this._refreshingRows = true;
    try { this._refreshRowsNow(); }
    finally { this._refreshingRows = false; }
  }

  _refreshRowsNow() {
    if (!this.el) return;
    // Translate text on existing controls. Locale is deliberately absent from
    // row/input intent keys: a language change is not a different device action.
    this.el.querySelector('.t3d-popup-close').setAttribute('aria-label', localize(this.hass, 'common.closeControls'));
    this.el.querySelector('.t3d-popup-kind').textContent = localize(this.hass, `popup.kind.${this._selection.kind === 'marker' ? 'device' : this._selection.kind}`);
    if (this._selection.titleKey) {
      const title = localize(this.hass, this._selection.titleKey);
      this.el.querySelector('h3').textContent = title; this.el.setAttribute('aria-label', title);
    }
    const ids = this._entityIds();
    this._refreshRoomActions();
    this.updateCustomControls();
    if (this._roomSummary) {
      const house = this.root.getRootNode()?.host?.getAttribute('data-taylors3d-theme') === 'house';
      this._roomSummary.hidden = !house;
      this._roomSummary.textContent = house ? buildRoomSummary({ hass: this.hass, entityIds: ids }).text : '';
    }
    const keep = new Set(ids);
    if (this._cameraFeed.entityId && !keep.has(this._cameraFeed.entityId)) this._cameraFeed.close();
    for (const [id, row] of this._rows) {
      if (!keep.has(id)) { row.el.remove(); this._rows.delete(id); }
    }
    if (!ids.length) {
      if (!this._empty) {
        this._empty = element('p');
        this._body.append(this._empty);
      }
      this._empty.textContent = this._selection.kind === 'category'
        ? this._selection.currentEmptyTextKey
          ? localize(this.hass, this._selection.currentEmptyTextKey, this._selection.currentEmptyTextParams || {})
          : this._selection.currentEmptyText || this._selection.emptyText || localize(this.hass, 'popup.emptyCategory')
        : localize(this.hass, 'popup.emptyRoom');
    } else if (this._empty) { this._empty.remove(); this._empty = null; }
    for (const id of ids) {
      const control = entityControl(this.hass, id);
      let row = this._rows.get(id);
      const key = `${control.toggle}:${control.dimmable}:${control.camera}:${control.rgb}:${control.colorTemperature}`;
      if (!row || row.key !== key) {
        const next = this._makeRow(control, key);
        if (row) row.el.replaceWith(next.el);
        else this._body.append(next.el);
        row = next;
        this._rows.set(id, row);
      }
      row.name.textContent = control.name;
      row.value.textContent = control.value;
      row.info.textContent = localize(this.hass, 'common.controls');
      row.info.setAttribute('aria-label', localize(this.hass, 'popup.entityControls', { name: control.name }));
      const busy = this._pending.has(id);
      row.el.setAttribute('aria-busy', String(busy));
      for (const input of row.inputs) {
        const kind = input.dataset.lightControl;
        const context = input.dataset.context || input.dataset.gestureContext;
        const available = this._deviceState(input, this.hass, true)?.available;
        if (!available || busy || this._fieldIntents.get(input)?.poisoned || context && context !== inputContext(control, kind)) {
          if (input.dataset.editing === 'true' || context) input.dataset.cancelled = 'true';
          delete input.dataset.gestureContext;
          this._clearInput(input);
        }
        input.disabled = !available || busy;
      }
      if (row.camera) {
        row.camera.disabled = !control.available;
        row.camera.textContent = localize(this.hass, 'popup.cameraView');
        row.camera.setAttribute('aria-label', localize(this.hass, 'popup.entityCamera', { name: control.name }));
      }
      if (row.toggle) {
        row.toggle.textContent = localize(this.hass, control.on ? 'popup.turnOff' : 'popup.turnOn');
        row.toggle.setAttribute('aria-label', localize(this.hass, control.on ? 'popup.entityTurnOff' : 'popup.entityTurnOn', { name: control.name }));
        row.toggle.disabled = !this._deviceState(row.toggle, this.hass, true)?.available || busy;
      }
      if (row.slider) {
        row.slider.setAttribute('aria-label', localize(this.hass, 'popup.brightnessAria', { name: control.name }));
        if (!row.slider.dataset.editing) {
          row.slider.value = String(control.brightness ?? 0);
          row.brightness.textContent = control.brightness === null ? localize(this.hass, 'popup.brightnessUnknown') : localize(this.hass, 'popup.brightness', { value: row.slider.value });
        }
        else this._paintInputChoice(row, row.slider);
      }
      if (row.colorInput) {
        row.colorLegend.textContent = localize(this.hass, 'popup.colour');
        row.colorLabel.textContent = localize(this.hass, 'popup.chooseColour');
        row.colorInput.setAttribute('aria-label', localize(this.hass, 'popup.chooseColourAria', { name: control.name }));
        row.colorReading.textContent = control.colorHex ? localize(this.hass, 'popup.currentColour', { value: control.colorHex }) : localize(this.hass, 'popup.colourUnknown');
        if (!row.colorInput.dataset.editing) { row.colorInput.value = control.colorHex || '#ffffff'; row.colorChoice.hidden = true; }
        else this._paintInputChoice(row, row.colorInput);
        for (const swatch of row.swatches) {
          swatch.disabled = !this._deviceState(swatch, this.hass, true)?.available || busy;
          const colour = localize(this.hass, `popup.swatch.${swatch.dataset.colorName.toLowerCase()}`);
          swatch.title = colour;
          swatch.setAttribute('aria-label', localize(this.hass, 'popup.setColourAria', { name: control.name, colour: colour.toLowerCase() }));
          swatch.setAttribute('aria-pressed', String(!!control.colorHex && swatch.dataset.hex === control.colorHex));
        }
      }
      if (row.kelvinInput) {
        row.kelvinInput.min = String(control.minKelvin); row.kelvinInput.max = String(control.maxKelvin);
        row.kelvinInput.setAttribute('aria-label', localize(this.hass, 'popup.kelvinAria', { name: control.name }));
        if (!row.kelvinInput.dataset.editing) {
          row.kelvinInput.value = String(control.kelvin ?? control.minKelvin);
          row.kelvinText.textContent = control.kelvin === null ? localize(this.hass, 'popup.kelvinUnknown') : localize(this.hass, 'popup.kelvin', { value: control.kelvin });
        }
        else this._paintInputChoice(row, row.kelvinInput);
        row.kelvinInput.setAttribute('aria-valuetext', control.kelvin === null && !row.kelvinInput.dataset.editing
          ? localize(this.hass, 'popup.kelvinChooseRange', { min: control.minKelvin, max: control.maxKelvin }) : localize(this.hass, 'popup.kelvinValue', { value: row.kelvinInput.value }));
        row.kelvinBounds.textContent = localize(this.hass, 'popup.supportedKelvin', { min: control.minKelvin, max: control.maxKelvin });
      }
      const error = this._errors.get(id);
      this._refreshDeviceControls(row,id,busy);
      row.error.textContent = error ? localize(this.hass, 'popup.commandFailed', { message: error.message ?? localize(this.hass, 'popup.commandRejected') }) : '';
      row.error.hidden = !error;
      row.status.textContent = busy ? localize(this.hass, 'popup.sending') : '';
      row.status.hidden = !busy;
    }
  }

  _makeRow(control, key) {
    const id = control.entityId;
    const el = element('section', 't3d-entity');
    el.dataset.entity = id;
    const name = element('div', 't3d-entity-name');
    const value = element('div', 't3d-entity-value');
    value.setAttribute('aria-live', 'polite');
    const actions = element('div', 't3d-entity-actions');
    const info = button(localize(this.hass, 'common.controls'), 'more-info', id);
    const toggle = control.toggle ? button('', 'toggle', id) : null;
    const camera = control.camera ? button(localize(this.hass, 'popup.cameraView'), 'camera-view', id) : null;
    if (toggle) actions.append(toggle);
    if (camera) actions.append(camera);
    actions.append(info);
    el.append(name, value, actions);
    const inputs = [], swatches = [];
    const field = (kind, type) => {
      const input = element('input'); input.type = type; input.dataset.entity = id; input.dataset.lightControl = kind;
      inputs.push(input); return input;
    };
    let slider = null, brightness = null, colorInput = null, colorReading = null, colorChoice = null, colorLegend = null, colorLabel = null;
    let kelvinInput = null, kelvinText = null, kelvinBounds = null;
    if (control.dimmable) {
      const label = element('label', 't3d-brightness');
      brightness = element('span');
      slider = field('brightness', 'range');
      slider.min = '0'; slider.max = '100'; slider.step = '1';
      slider.dataset.entity = id;
      slider.setAttribute('aria-label', localize(this.hass, 'popup.brightnessAria', { name: control.name }));
      label.append(brightness, slider);
      el.append(label);
    }
    if (control.rgb) {
      const colors = element('fieldset', 't3d-colour'); colorLegend = element('legend', '', localize(this.hass, 'popup.colour')); colors.append(colorLegend);
      const choices = element('div', 't3d-swatches');
      for (const [name, rgb] of SWATCHES) {
        const swatch = button('', 'color-swatch', id); swatch.dataset.hex = rgbHex(rgb); swatch.dataset.colorName = name;
        swatch.title = name; const dot = element('span', 't3d-swatch-dot'); dot.setAttribute('aria-hidden', 'true');
        dot.style.backgroundColor = swatch.dataset.hex; swatch.append(dot); choices.append(swatch); swatches.push(swatch);
      }
      const label = element('label', 't3d-colour-picker'); colorLabel = element('span', '', localize(this.hass, 'popup.chooseColour'));
      colorInput = field('color', 'color'); label.append(colorLabel, colorInput);
      colorReading = element('p', 't3d-light-reading'); colorChoice = element('p', 't3d-light-reading'); colorChoice.hidden = true;
      colors.append(choices, label, colorReading, colorChoice); el.append(colors);
    }
    if (control.colorTemperature) {
      const label = element('label', 't3d-brightness'); kelvinText = element('span'); kelvinInput = field('kelvin', 'range'); kelvinInput.step = '1';
      kelvinBounds = element('p', 't3d-light-reading'); label.append(kelvinText, kelvinInput); el.append(label, kelvinBounds);
    }
    const error = element('p', 't3d-entity-error');
    error.setAttribute('role', 'alert');
    const status = element('p', 't3d-entity-status');
    status.setAttribute('role', 'status');
    const inline = element('div','t3d-inline-controls'), inlineReading = element('p','t3d-inline-reading');
    const inlineButtons = element('div','t3d-inline-buttons'), inlineFields = element('div','t3d-inline-fields');
    inline.append(inlineReading,inlineButtons,inlineFields); el.append(inline,error,status);
    return { el, key, name, value, info, toggle, camera, slider, brightness, colorInput, colorReading, colorChoice, colorLegend, colorLabel,
      kelvinInput, kelvinText, kelvinBounds, swatches, inputs, error, status,
      inline, inlineReading, inlineButtons, inlineFields, deviceControls:new Map() };
  }

  _refreshDeviceControls(row,id,busy) {
    const current = readDeviceControls(this.hass,id), keep = new Set(current.controls.map((control) => control.id));
    for (const [key,control] of row.deviceControls) if (!keep.has(key)) {
      this._deviceIntents.delete(control.node); this._fieldIntents.delete(control.node); control.el.remove(); row.deviceControls.delete(key);
    }
    row.inline.hidden = !current.controls.length && !current.readings.length;
    row.inlineReading.textContent = current.readings.join(' · '); row.inlineReading.hidden = !current.readings.length;
    for (const definition of current.controls) {
      let control = row.deviceControls.get(definition.id);
      if (!control) {
        if (definition.type === 'button') {
          const node = button('','inline-device',id); node.dataset.deviceControl = definition.id;
          control = {node,el:node}; row.inlineButtons.append(node);
        } else {
          const label = element('label'), caption = element('span'), node = element(definition.type === 'select' ? 'select' : 'input');
          if (definition.type !== 'select') node.type = 'number';
          node.dataset.deviceControl = definition.id; node.dataset.entity = id;
          const hint = element('span','t3d-inline-hint'); label.append(caption,node,hint); row.inlineFields.append(label);
          control = {node,el:label,caption,hint};
        }
        row.deviceControls.set(definition.id,control);
      }
      const {node,caption,hint} = control, text = deviceText(this.hass,definition.labelKey.replace('deviceControls.',''));
      node.disabled = !definition.available || busy;
      node.setAttribute('aria-label',`${entityMetadata(this.hass,id).name}: ${text}`);
      if (definition.type === 'button') node.textContent = text;
      else {
        caption.textContent = text + (definition.unit ? ` (${definition.unit})` : '');
        const draft = this._fieldIntents.get(node);
        if (definition.type === 'select') {
          const options = [null,...definition.options], values = [ '',...definition.options ];
          if (JSON.stringify([...node.options].map((option) => option.value)) !== JSON.stringify(values)) {
            node.replaceChildren(...options.map((value) => { const option = element('option'); option.value = value ?? ''; option.disabled = value === null;
              option.textContent = value ?? deviceText(this.hass,'choose'); return option; }));
          } else node.options[0].textContent = deviceText(this.hass,'choose');
        } else { node.min = String(definition.min); node.max = String(definition.max); node.step = String(definition.step); }
        if (!draft?.editing && node.getRootNode().activeElement !== node) node.value = String(definition.value ?? '');
        hint.textContent = definition.value === null ? deviceText(this.hass,'unknown')
          : deviceText(this.hass,'current',{value:String(definition.value) + (definition.unit ? ` ${definition.unit}` : '')});
        hint.hidden = false;
      }
    }
  }

  // Optional root-owned saved scene/script actions. Root provides only exact
  // current room data and independently revalidates onRoomAction before sending.
  _roomActionData(hass = this.hass) {
    if (this._selection?.kind !== 'room' || typeof this.getRoomActions !== 'function') return {actions:[],contextKey:null};
    if (typeof this._selection.room?.id !== 'string' || !this._selection.room.id.length || this._selection.room.id.length > 256) return {actions:[],contextKey:null};
    let current;
    try { current = this.getRoomActions(this._selection.room); } catch { return {actions:[],contextKey:null}; }
    if (!Array.isArray(current?.actions) || current.actions.length > 12 || typeof current.contextKey !== 'string') return {actions:[],contextKey:null};
    const seen = new Set(), duplicates = new Set(), actions = [];
    for (const item of current.actions) {
      if (typeof item?.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id)) continue;
      if (seen.has(item.id)) duplicates.add(item.id); seen.add(item.id);
      if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 256
        || !['scene','script'].includes(item.domain) || item.service !== 'turn_on'
        || typeof item.entityId !== 'string' || !new RegExp(`^${item.domain}\\.[a-z0-9_]+$`).test(item.entityId)) continue;
      const source = entityMetadata(hass,item.entityId);
      // A scene's unknown last-activation timestamp is legitimate; root has
      // already validated its exact source. It is not an unknown device value.
      const sourceAvailable = item.domain === 'scene' ? source.hasState && !source.disabled && source.state.state !== 'unavailable' : source.available;
      const available = item.available === true && !!deviceAuthContext(hass) && sourceAvailable && !source.hidden && !source.category
        && source.state?.attributes?.restored !== true && !!hass?.services?.[item.domain]?.turn_on && typeof this.onRoomAction === 'function';
      actions.push({...item,available});
    }
    return {contextKey:current.contextKey,actions:actions.filter((item) => !duplicates.has(item.id))};
  }

  _refreshRoomActions() {
    if (!this._roomActions) return;
    const current = this._roomActionData(), keep = new Set(current.actions.map((action) => action.id));
    this._roomActions.hidden = !current.actions.length;
    this._roomActionsTitle.textContent = deviceText(this.hass,'roomActions');
    for (const [id,row] of this._roomRows) if (!keep.has(id)) { this._deviceIntents.delete(row.button); row.el.remove(); this._roomRows.delete(id); }
    for (const [index,action] of current.actions.entries()) {
      let row = this._roomRows.get(action.id);
      if (!row) {
        const el = element('div','t3d-room-action-row'), node = button('','room-shortcut'); node.dataset.roomAction = action.id;
        const issue = element('p','t3d-room-action-issue'), error = element('p','t3d-entity-error'), status = element('p','t3d-entity-status');
        error.setAttribute('role','alert'); status.setAttribute('role','status'); el.append(node,issue,error,status);
        row = {el,button:node,issue,error,status}; this._roomRows.set(action.id,row);
      }
      if (this._roomActionsGrid.children[index] !== row.el) this._roomActionsGrid.insertBefore(row.el,this._roomActionsGrid.children[index] || null);
      row.button.textContent = action.label; row.button.setAttribute('aria-label',action.label);
      const pending = this._roomPending.has(action.id), error = this._roomErrors.get(action.id);
      row.button.disabled = !action.available || pending;
      row.issue.textContent = action.available ? '' : typeof action.issue === 'string' && action.issue ? action.issue : deviceText(this.hass,'unavailable');
      row.issue.hidden = action.available;
      row.error.textContent = error ? localize(this.hass,'popup.commandFailed',{message:error.message}) : ''; row.error.hidden = !error;
      row.status.textContent = pending ? localize(this.hass,'popup.sending') : ''; row.status.hidden = !pending;
    }
  }

  _deviceTarget(event) {
    const target = event.target?.closest?.('[data-device-control],[data-room-action],[data-light-control],[data-action="toggle"],[data-action="color-swatch"]');
    return target && this.el?.contains(target) ? target : null;
  }
  _deviceState(target,hass = this.hass,ignoreBusy = false) {
    if (!this.el || !this.root.isConnected || !target?.isConnected || !this.el.contains(target)) return null;
    const auth = deviceAuthContext(hass);
    if (target.dataset.roomAction) {
      const current = this._roomActionData(hass), action = current.actions.find((item) => item.id === target.dataset.roomAction);
      if (!action) return null;
      return {auth,available:action.available && (ignoreBusy || !this._roomPending.has(action.id)),kind:'room',
        key:JSON.stringify([this._session,this._selection.room.id,current.contextKey,action.id,action.entityId,action.domain,action.service,action.available]),
        contextKey:current.contextKey,action};
    }
    const id = target.dataset.entity, row = this._rows.get(id);
    if (!row?.el.contains(target) || !this._entityIds(hass).includes(id)) return null;
    if (target.dataset.lightControl || ['toggle', 'color-swatch'].includes(target.dataset.action)) {
      const kind = target.dataset.lightControl || target.dataset.action, control = entityControl(hass, id), metadata = entityMetadata(hass, id);
      const supported = kind === 'brightness' ? control.dimmable : kind === 'color' || kind === 'color-swatch' ? control.rgb
        : kind === 'toggle' ? control.toggle : kind === 'kelvin' && control.colorTemperature;
      const currentAuth = popupAuthContext(hass);
      return { auth: currentAuth, available: !!currentAuth && control.available && supported && (ignoreBusy || !this._pending.has(id)), kind: 'quick',
        key: JSON.stringify([this._session, metadata.deviceId, metadata.areaId, metadata.hidden, metadata.category, metadata.disabled,
          inputContext(control, kind), kind === 'toggle' ? control.toggle : kind === 'color-swatch' ? target.dataset.hex : null]), control };
    }
    const current = readDeviceControls(hass,id), control = current.controls.find((item) => item.id === target.dataset.deviceControl);
    if (!control) return null;
    return {auth,available:control.available && (ignoreBusy || !this._pending.has(id)),kind:'entity',
      key:JSON.stringify([this._session,current.sourceKey,control.id]),control};
  }
  _sameDeviceState(before,after) { return !!before && !!after && after.available && before.kind === after.kind
    && before.key === after.key && sameDeviceAuth(before.auth,after.auth); }

  /** Root may call synchronously for every hass assignment, before coalesced
   * redraws. Observe only; a transient loss/recovery permanently poisons old
   * held or unfinished intents and pending error ownership. No DOM/action work.
   */
  observeContexts(hass = this.hass) {
    this.hass = hass || {states:{}};
    this.updateCustomControls();
    if (!this.el) return;
    for (const [target,intent] of this._deviceIntents) if (!this._sameDeviceState(intent.stamp,this._deviceState(target,hass))) intent.poisoned = true;
    for (const [target,intent] of this._fieldIntents) if (!this._sameDeviceState(intent.stamp,this._deviceState(target,hass))) intent.poisoned = true;
    for (const run of this._actionRuns) if (!this._sameDeviceState(run.stamp,this._deviceState(run.target,hass,true))) {
      run.poisoned = true;
      if (run.stamp.kind === 'room') { const id = run.target.dataset.roomAction;
        if (this._roomPending.get(id) === run) this._roomPending.delete(id);
      } else { const id = run.target.dataset.entity;
        if (this._extraPending.get(id) === run) {this._extraPending.delete(id);this._pending.delete(id);}
      }
    }
    for (const [id,error] of this._errors) if (error.stamp && !this._sameDeviceState(error.stamp,this._deviceState(error.target,hass,true))) this._errors.delete(id);
    for (const [id,error] of this._roomErrors) if (!this._sameDeviceState(error.stamp,this._deviceState(error.target,hass,true))) this._roomErrors.delete(id);
  }
  _deviceFocus(event) {
    const target = this._deviceTarget(event);
    if (!target || target.tagName === 'BUTTON') return;
    this._fieldIntents.set(target,{stamp:this._deviceState(target),editing:false,poisoned:false});
  }
  _devicePress(event) {
    const close = event.target?.closest?.('button[data-action="close"]');
    if (event.type === 'pointerdown' && event.button === 0 && event.isPrimary !== false
      && close && close === this.el?.querySelector('button[data-action="close"]') && !close.disabled) {
      // A Close press blurs a dirty number before its click closes the popup.
      // Discard that unsubmitted draft before the browser emits its change.
      const field = this.el.getRootNode().activeElement, draft = this._fieldIntents.get(field);
      if (this.el.contains(field) && field?.dataset.deviceControl && field.type === 'number' && draft?.editing) draft.poisoned = true;
      return;
    }
    const target = this._deviceTarget(event); if (!target) return;
    if (event.type === 'pointerdown' && (event.button !== 0 || event.isPrimary === false)) return;
    if (event.type === 'keydown' && target.tagName === 'BUTTON' && ![' ','Enter'].includes(event.key)) return;
    if (event.type === 'keydown' && event.key === 'Tab' && target.dataset.deviceControl) {
      // Navigation completes the existing scalar draft; it cannot start a new
      // command or revive ownership revoked during the unfinished edit.
      const intent = this._deviceIntents.get(target);
      if (intent) intent.held = false;
      return;
    }
    if (event.type === 'keydown' && event.key === 'Tab' && target.dataset.lightControl) {
      // Tab hands its keyup to the next focused control. End the old gesture
      // now, rather than leaving this field permanently marked as held.
      const intent = this._deviceIntents.get(target), field = this._fieldIntents.get(target);
      if (intent) { intent.held = false; intent.poisoned = true; }
      if (field) field.poisoned = true;
      return;
    }
    const previous = this._deviceIntents.get(target);
    if (event.repeat || previous?.held) return;
    const stamp = this._deviceState(target), intent = {stamp,held:true,poisoned:!stamp?.available,consumed:false,
      type:event.type,key:event.key,pointerId:event.pointerId};
    this._deviceIntents.set(target,intent);
    if (target.tagName !== 'BUTTON') this._fieldIntents.set(target,{stamp,editing:this._fieldIntents.get(target)?.editing || false,poisoned:!stamp?.available});
  }
  _deviceRelease(event) {
    const target = this._deviceTarget(event), intent = this._deviceIntents.get(target); if (!intent) return;
    if (event.type === 'keyup' && (intent.type !== 'keydown' || intent.key !== event.key)
      || event.type === 'pointerup' && (intent.type !== 'pointerdown' || intent.pointerId !== event.pointerId)) return;
    if (!this._sameDeviceState(intent.stamp,this._deviceState(target))) intent.poisoned = true;
    intent.held = false;
  }
  _deviceCancel(event) {
    const target = this._deviceTarget(event); if (!target) return;
    // Opening a native colour dialog may blur its field before the final
    // change. Keep that intent; synchronous source/session observations and
    // explicit pointer cancellation still revoke it when needed.
    const intent = this._deviceIntents.get(target);
    if (target.dataset.lightControl === 'color' && event.type === 'focusout'
      && (!intent || intent.type === 'pointerdown' || intent.type === 'keydown' && [' ', 'Enter'].includes(intent.key))) return;
    if (intent?.held || event.type === 'pointercancel') { if (intent) {intent.held = false;intent.poisoned = true;}
      const field = this._fieldIntents.get(target); if (field) field.poisoned = true; }
    // Native change is emitted before blur. Keep a poisoned draft until that
    // possible late change is rejected; clean non-drafts can follow HA again.
    if (event.type === 'focusout' && !this._fieldIntents.get(target)?.editing) this._fieldIntents.delete(target);
  }
  _acceptDeviceIntent(target) {
    const current = this._deviceState(target), intent = this._deviceIntents.get(target);
    if (!current?.available || intent && (intent.poisoned || intent.consumed || !this._sameDeviceState(intent.stamp,current))) return false;
    if (intent) intent.consumed = true;
    return true;
  }
  _deviceInput(event) {
    const target = this._deviceTarget(event); if (!target || target.tagName === 'BUTTON') return;
    const current = this._deviceState(target), gesture = this._deviceIntents.get(target), draft = this._fieldIntents.get(target);
    if (!current?.available || gesture?.poisoned && gesture.held || draft?.poisoned) return;
    this._fieldIntents.set(target,{stamp:current,editing:true,poisoned:false});
  }
  _deviceChange(event) {
    const target = this._deviceTarget(event); if (!target || target.tagName === 'BUTTON') return;
    const current = this._deviceState(target), draft = this._fieldIntents.get(target), gesture = this._deviceIntents.get(target);
    if (!current?.available || draft?.poisoned || gesture?.poisoned || draft && !this._sameDeviceState(draft.stamp,current)) return;
    const command = deviceCommand(this.hass,target.dataset.entity,target.dataset.deviceControl,target.value);
    this._fieldIntents.delete(target);
    if (command) this._run(target.dataset.entity,command.domain,command.service,command.data,{target,stamp:current});
  }

  async _runRoomAction(target) {
    const stamp = this._deviceState(target);
    if (!stamp?.available || typeof this.onRoomAction !== 'function') return;
    const session = this._session, id = stamp.action.id, roomId = this._selection.room.id;
    const run = {target,stamp,poisoned:false}; this._actionRuns.add(run); this._roomPending.set(id,run); this._roomErrors.delete(id); this._refreshRoomActions();
    try {
      if (!this._sameDeviceState(stamp,this._deviceState(target,this.hass,true))) return;
      const result = await this.onRoomAction(roomId,id);
      if (result === false) throw new Error(deviceText(this.hass,'rejected'));
    } catch (error) {
      if (session === this._session && !run.poisoned && this._sameDeviceState(stamp,this._deviceState(target,this.hass,true)))
        this._roomErrors.set(id,{message:error?.message || deviceText(this.hass,'rejected'),stamp,target});
    } finally {
      this._actionRuns.delete(run);
      if (session === this._session) {
        if (this._roomPending.get(id) === run) this._roomPending.delete(id);
        this._refreshRoomActions();
      }
    }
  }

  _click(e) {
    e.stopPropagation();
    const b = e.target.closest && e.target.closest('button[data-action]');
    if (!b || b.disabled || !this.el?.contains(b)) return;
    if (b.dataset.roomAction) { if (this._acceptDeviceIntent(b)) this._runRoomAction(b); return; }
    if (b.dataset.deviceControl) {
      if (!this._acceptDeviceIntent(b)) return;
      const command = deviceCommand(this.hass,b.dataset.entity,b.dataset.deviceControl);
      if (command) this._run(b.dataset.entity,command.domain,command.service,command.data,{target:b,stamp:this._deviceState(b)});
      return;
    }
    const id = b.dataset.entity;
    if (b.dataset.action === 'close') this.close();
    else if (!this._activeControl(b)) return;
    else if (b.dataset.action === 'more-info') { this.close(); this.onMoreInfo(id); }
    else if (b.dataset.action === 'camera-view') this.openCamera(id);
    else if (b.dataset.action === 'toggle') {
      if (this._acceptDeviceIntent(b)) this._run(id, id.split('.')[0], 'toggle', { entity_id: id }, { target: b, stamp: this._deviceState(b) });
    } else if (b.dataset.action === 'color-swatch') {
      const rgb = hexRgb(b.dataset.hex);
      if (rgb && this._acceptDeviceIntent(b)) this._run(id, 'light', 'turn_on', { entity_id: id, rgb_color: rgb }, { target: b, stamp: this._deviceState(b) });
    }
  }

  _activeControl(target) {
    const row = target && this._rows.get(target.dataset.entity);
    return !!row && !!this.el?.contains(target) && row.el.contains(target) && this._entityIds().includes(target.dataset.entity);
  }

  _clearInput(input) { input.dataset.editing = ''; delete input.dataset.context; }

  _paintInputChoice(row, input) {
    const value = input.value;
    if (input.dataset.lightControl === 'brightness') row.brightness.textContent = localize(this.hass, 'popup.brightness', { value });
    else if (input.dataset.lightControl === 'kelvin') {
      row.kelvinText.textContent = localize(this.hass, 'popup.chooseKelvin', { value });
      input.setAttribute('aria-valuetext', localize(this.hass, 'popup.kelvinValue', { value }));
    } else if (input.dataset.lightControl === 'color') {
      row.colorChoice.textContent = localize(this.hass, 'popup.choice', { value }); row.colorChoice.hidden = false;
    }
  }

  _sliderInput(e) {
    const slider = e.target;
    if (!slider.dataset.lightControl || slider.disabled || !this._activeControl(slider)) return;
    const current = this._deviceState(slider), gesture = this._deviceIntents.get(slider);
    if (!current?.available || gesture?.held && gesture.poisoned) return;
    const control = current.control;
    // A new native input starts a fresh adjustment. An input still belonging
    // to an interrupted held pointer/key above cannot start another intent.
    if (!gesture?.held) this._deviceIntents.delete(slider);
    this._fieldIntents.set(slider, { stamp: current, editing: true, poisoned: false });
    delete slider.dataset.cancelled;
    slider.dataset.editing = 'true';
    slider.dataset.context = inputContext(control, slider.dataset.lightControl);
    // A native colour dialog can blur before its final change. Keep its unfinished
    // intent separate from the visible draft, so a later revocation still cancels it.
    slider.dataset.gestureContext = slider.dataset.context;
    const row = this._rows.get(slider.dataset.entity);
    this._paintInputChoice(row, slider);
  }

  _sliderChange(e) {
    const slider = e.target;
    if (!slider.dataset.lightControl || slider.disabled || !this._activeControl(slider)) return;
    const id = slider.dataset.entity;
    const c = entityControl(this.hass, id);
    const kind = slider.dataset.lightControl;
    const context = slider.dataset.context || slider.dataset.gestureContext;
    const current = this._deviceState(slider), draft = this._fieldIntents.get(slider), gesture = this._deviceIntents.get(slider);
    if (!current?.available || draft?.poisoned || gesture?.poisoned || draft && !this._sameDeviceState(draft.stamp, current)
      || !c.available || this._pending.has(id) || slider.dataset.cancelled === 'true'
      || context && context !== inputContext(c, kind)) {
      if (slider.dataset.editing === 'true' || context) slider.dataset.cancelled = 'true';
      delete slider.dataset.gestureContext;
      this._clearInput(slider); this._refreshRows(); return;
    }
    delete slider.dataset.gestureContext;
    this._fieldIntents.delete(slider); this._deviceIntents.delete(slider);
    this._clearInput(slider);
    const guard = { target: slider, stamp: current };
    if (kind === 'brightness' && c.dimmable) {
      const percent = Number(slider.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
      this._run(id, 'light', percent === 0 ? 'turn_off' : 'turn_on',
        percent === 0 ? { entity_id: id } : { entity_id: id, brightness: Math.round(percent * 255 / 100) }, guard);
    } else if (kind === 'color' && c.rgb) {
      const rgb = hexRgb(slider.value);
      if (rgb) this._run(id, 'light', 'turn_on', { entity_id: id, rgb_color: rgb }, guard);
    } else if (kind === 'kelvin' && c.colorTemperature) {
      const kelvin = Number(slider.value);
      if (Number.isInteger(kelvin) && kelvin >= c.minKelvin && kelvin <= c.maxKelvin)
        this._run(id, 'light', 'turn_on', { entity_id: id, color_temp_kelvin: kelvin }, guard);
    }
  }

  async _run(id, domain, service, data,guard) {
    if (!this.el || !this._rows.has(id) || this._pending.has(id)) return;
    const session = this._session;
    const run = guard ? {...guard,poisoned:false} : null;
    if (run && !this._sameDeviceState(run.stamp,this._deviceState(run.target))) return;
    if (run) {this._actionRuns.add(run);this._extraPending.set(id,run);}
    this._errors.delete(id);
    this._pending.add(id);
    this._refreshRows();
    try {
      if (run && !this._sameDeviceState(run.stamp,this._deviceState(run.target,this.hass,true))) return;
      await this.onAction(domain, service, data);
    } catch (error) {
      if (session === this._session && (!run || !run.poisoned && this._sameDeviceState(run.stamp,this._deviceState(run.target,this.hass,true)))) {
        const message = error && error.message ? error.message : null;
        this._errors.set(id, { message, ...(run ? {stamp:run.stamp,target:run.target} : {}) });
      }
    } finally {
      if (run) this._actionRuns.delete(run);
      if (session === this._session) {
        if (!run || this._extraPending.get(id) === run) {
          if (run) this._extraPending.delete(id);
          this._pending.delete(id);
        }
        this._refreshRows();
      }
    }
  }

  reposition(position = this._position) {
    if (!this.el) return;
    if (this.placement === 'right') return;
    this._position = position;
    const box = this.root.getBoundingClientRect();
    const point = Array.isArray(position) ? position : position && [position.clientX, position.clientY];
    const width = this.el.offsetWidth || Math.min(300, Math.max(0, box.width - 16));
    const height = this.el.offsetHeight || Math.min(300, Math.max(0, box.height - 16));
    const x = point && Number.isFinite(point[0]) ? point[0] - box.left + 12 : box.width - width - 8;
    const y = point && Number.isFinite(point[1]) ? point[1] - box.top + 12 : box.height - height - 8;
    this.el.style.left = `${Math.max(8, Math.min(x, box.width - width - 8))}px`;
    this.el.style.top = `${Math.max(8, Math.min(y, box.height - height - 8))}px`;
  }

  close({ restoreFocus = true } = {}) {
    const hadPopup = !!this.el;
    this._session++;
    this._customControls?.dispose(); this._customControls = null; this._customControlsHost = null;
    this._cameraFeed.close();
    window.removeEventListener('pointerdown', this._onOutside, true);
    window.removeEventListener('keydown', this._onKey);
    if (this.el) this.el.remove();
    this.el = null;
    if (hadPopup) this.onVisibilityChange(false, this.placement);
    this._body = null;
    this._empty = null;
    this._roomSummary = null;
    this._selection = null;
    this._rows.clear();
    this._pending.clear();
    this._errors.clear();
    this._deviceIntents.clear();this._fieldIntents.clear();this._actionRuns.clear();this._extraPending.clear();this._roomRows.clear();this._roomPending.clear();this._roomErrors.clear();
    this._roomActions = null;this._roomActionsTitle = null;this._roomActionsGrid = null;
    if (hadPopup && restoreFocus && this._opener && this._opener.isConnected && typeof this._opener.focus === 'function') {
      this._opener.focus({ preventScroll: true });
    }
    this._opener = null;
  }

  dispose() { this.close({ restoreFocus: false }); this._cameraFeed.dispose(); }

  updateCustomControls() {
    this._customControls?.update();
    if (this._customControlsHost && this._customControls?.el) {
      const hidden = this._customControls.el.hidden === true;
      if (this._customControlsHost.hidden !== hidden) this._customControlsHost.hidden = hidden;
    }
  }

  setPlacement(placement) {
    this.placement = placement === 'right' ? 'right' : 'popup';
    if (!this.el) return;
    this.el.dataset.placement = this.placement;
    this.el.style.left = '';
    this.el.style.top = '';
    this.onVisibilityChange(true, this.placement);
    this.reposition();
  }
}
