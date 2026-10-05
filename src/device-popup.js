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
  .taylors3d-device-popup button:focus-visible, .taylors3d-device-popup input:focus-visible {
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
  const usable = domain !== 'light' || !!state && ['on', 'off'].includes(state.state)
    && !sourceIssue;
  const lightService = domain === 'light' && serviceExists(hass, 'light', 'turn_on');
  const minKelvin = finite(caps.minKelvin) ? Math.ceil(caps.minKelvin) : null;
  const maxKelvin = finite(caps.maxKelvin) ? Math.floor(caps.maxKelvin) : null;
  const kelvinBounds = minKelvin !== null && maxKelvin !== null && minKelvin > 0 && minKelvin <= maxKelvin;
  const brightness = finite(attr.brightness) && attr.brightness >= 0 && attr.brightness <= 255 ? Math.round(attr.brightness / 255 * 100) : null;
  return {
    entityId, name: metadata.name, value: domain === 'light' && attr.restored === true ? 'Waiting for a current light reading'
      : sourceIssue && ['state', 'attributes', 'domain', 'restored'].includes(sourceIssue.code) ? 'Invalid light reading'
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
  constructor(root, { onAction, onMoreInfo, placement = 'popup', onVisibilityChange } = {}) {
    this.root = root;
    this.placement = placement === 'right' ? 'right' : 'popup';
    this.onVisibilityChange = onVisibilityChange || (() => {});
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
    this._show({ kind: 'marker', marker, title: marker.name || marker.entityId || 'Device' }, position);
    if (marker.entityId?.startsWith('camera.')) this.openCamera(marker.entityId);
  }

  showRoom(room, markers, position) {
    const area = this.hass.areas && this.hass.areas[room.area_id];
    this._show({ kind: 'room', room, markers, title: (area && area.name) || room.name || 'Room' }, position);
  }

  showCategory({ id, title, entityIds, emptyText, resolve }, position) {
    if (typeof id !== 'string' || typeof title !== 'string' || !Array.isArray(entityIds)) return;
    this._show({ kind: 'category', id, title, entityIds: [...entityIds], emptyText, resolve }, position);
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
    close.setAttribute('aria-label', 'Close controls');
    const heading = element('div');
    heading.style.flex = '1';
    heading.append(element('p', 't3d-popup-kind', selection.kind === 'room' ? 'Room controls' : selection.kind === 'category' ? 'House controls' : 'Device controls'),
      element('h3', '', selection.title));
    if (selection.kind === 'room') {
      this._roomSummary = element('p', 't3d-room-summary'); this._roomSummary.hidden = true;
      heading.append(this._roomSummary);
    }
    head.append(heading, close);
    this._body = element('div', 't3d-popup-body');
    el.append(style, head, this._cameraContainer, this._body);
    // Keep popup interactions out of orbiting, room selection and marker gestures.
    for (const type of STOP_EVENTS) el.addEventListener(type, (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => { this._onKey(e); e.stopPropagation(); });
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('input', (e) => this._sliderInput(e));
    el.addEventListener('change', (e) => this._sliderChange(e));
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

  _entityIds() {
    const s = this._selection;
    let ids;
    if (s.kind === 'category') {
      let current;
      try { current = typeof s.resolve === 'function' ? s.resolve(this.hass) : s.entityIds; } catch { current = []; }
      ids = Array.isArray(current) ? current : current?.entityIds;
      s.currentEmptyText = typeof current?.emptyText === 'string' ? current.emptyText : s.emptyText;
      if (!Array.isArray(ids)) ids = [];
      ids = [...new Set(ids.filter((id) => typeof id === 'string' && /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(id)))];
    } else ids = s.kind === 'room' ? roomEntityIds(s.room, s.markers) : markerEntityIds(s.marker);
    // Registry-hidden and diagnostic entities are never included in a room's controls.
    return ids.filter((id) => {
      const metadata = entityMetadata(this.hass, id);
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
    const ids = this._entityIds();
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
        ? this._selection.currentEmptyText || this._selection.emptyText || 'No current entities are available in this category.'
        : 'No devices are assigned to this room.';
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
      row.info.setAttribute('aria-label', `${control.name}: all controls`);
      const busy = this._pending.has(id);
      row.el.setAttribute('aria-busy', String(busy));
      for (const input of row.inputs) {
        const kind = input.dataset.lightControl;
        const context = input.dataset.context || input.dataset.gestureContext;
        if (!control.available || busy || context && context !== inputContext(control, kind)) {
          if (input.dataset.editing === 'true' || context) input.dataset.cancelled = 'true';
          delete input.dataset.gestureContext;
          this._clearInput(input);
        }
        input.disabled = !control.available || busy;
      }
      if (row.camera) {
        row.camera.disabled = !control.available;
        row.camera.setAttribute('aria-label', `${control.name}: camera view`);
      }
      if (row.toggle) {
        row.toggle.textContent = control.on ? 'Turn off' : 'Turn on';
        row.toggle.setAttribute('aria-label', `${control.name}: ${control.on ? 'turn off' : 'turn on'}`);
        row.toggle.disabled = !control.available || busy;
      }
      if (row.slider) {
        row.slider.setAttribute('aria-label', `${control.name}: brightness`);
        if (!row.slider.dataset.editing) {
          row.slider.value = String(control.brightness ?? 0);
          row.brightness.textContent = control.brightness === null ? 'Brightness: not reported' : `Brightness: ${row.slider.value}%`;
        }
      }
      if (row.colorInput) {
        row.colorInput.setAttribute('aria-label', `${control.name}: choose colour`);
        row.colorReading.textContent = control.colorHex ? `Current colour: ${control.colorHex}` : 'Current colour: not reported';
        if (!row.colorInput.dataset.editing) { row.colorInput.value = control.colorHex || '#ffffff'; row.colorChoice.hidden = true; }
        for (const swatch of row.swatches) {
          swatch.disabled = !control.available || busy;
          swatch.setAttribute('aria-label', `${control.name}: set ${swatch.dataset.colorName.toLowerCase()}`);
          swatch.setAttribute('aria-pressed', String(!!control.colorHex && swatch.dataset.hex === control.colorHex));
        }
      }
      if (row.kelvinInput) {
        row.kelvinInput.min = String(control.minKelvin); row.kelvinInput.max = String(control.maxKelvin);
        row.kelvinInput.setAttribute('aria-label', `${control.name}: choose colour temperature in kelvin`);
        if (!row.kelvinInput.dataset.editing) {
          row.kelvinInput.value = String(control.kelvin ?? control.minKelvin);
          row.kelvinText.textContent = control.kelvin === null ? 'Colour temperature: not reported' : `Colour temperature: ${control.kelvin} K`;
        }
        row.kelvinInput.setAttribute('aria-valuetext', control.kelvin === null && !row.kelvinInput.dataset.editing
          ? `Current temperature not reported; choose ${control.minKelvin} to ${control.maxKelvin} kelvin` : `${row.kelvinInput.value} kelvin`);
        row.kelvinBounds.textContent = `Supported range: ${control.minKelvin}–${control.maxKelvin} K`;
      }
      const error = this._errors.get(id);
      row.error.textContent = error || '';
      row.error.hidden = !error;
      row.status.textContent = busy ? 'Sending command…' : '';
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
    const info = button('All controls', 'more-info', id);
    const toggle = control.toggle ? button('', 'toggle', id) : null;
    const camera = control.camera ? button('Camera view', 'camera-view', id) : null;
    if (toggle) actions.append(toggle);
    if (camera) actions.append(camera);
    actions.append(info);
    el.append(name, value, actions);
    const inputs = [], swatches = [];
    const field = (kind, type) => {
      const input = element('input'); input.type = type; input.dataset.entity = id; input.dataset.lightControl = kind;
      inputs.push(input); return input;
    };
    let slider = null, brightness = null, colorInput = null, colorReading = null, colorChoice = null;
    let kelvinInput = null, kelvinText = null, kelvinBounds = null;
    if (control.dimmable) {
      const label = element('label', 't3d-brightness');
      brightness = element('span');
      slider = field('brightness', 'range');
      slider.min = '0'; slider.max = '100'; slider.step = '1';
      slider.dataset.entity = id;
      slider.setAttribute('aria-label', `${control.name}: brightness`);
      label.append(brightness, slider);
      el.append(label);
    }
    if (control.rgb) {
      const colors = element('fieldset', 't3d-colour'); colors.append(element('legend', '', 'Colour'));
      const choices = element('div', 't3d-swatches');
      for (const [name, rgb] of SWATCHES) {
        const swatch = button('', 'color-swatch', id); swatch.dataset.hex = rgbHex(rgb); swatch.dataset.colorName = name;
        swatch.title = name; const dot = element('span', 't3d-swatch-dot'); dot.setAttribute('aria-hidden', 'true');
        dot.style.backgroundColor = swatch.dataset.hex; swatch.append(dot); choices.append(swatch); swatches.push(swatch);
      }
      const label = element('label', 't3d-colour-picker', 'Choose colour'); colorInput = field('color', 'color'); label.append(colorInput);
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
    el.append(error, status);
    return { el, key, name, value, info, toggle, camera, slider, brightness, colorInput, colorReading, colorChoice,
      kelvinInput, kelvinText, kelvinBounds, swatches, inputs, error, status };
  }

  _click(e) {
    e.stopPropagation();
    const b = e.target.closest && e.target.closest('button[data-action]');
    if (!b || b.disabled || !this.el?.contains(b)) return;
    const id = b.dataset.entity;
    if (b.dataset.action === 'close') this.close();
    else if (!this._activeControl(b)) return;
    else if (b.dataset.action === 'more-info') { this.close(); this.onMoreInfo(id); }
    else if (b.dataset.action === 'camera-view') this.openCamera(id);
    else if (b.dataset.action === 'toggle') {
      const c = entityControl(this.hass, id);
      if (c.toggle && c.available) this._run(id, id.split('.')[0], 'toggle', { entity_id: id });
    } else if (b.dataset.action === 'color-swatch') {
      const c = entityControl(this.hass, id), rgb = hexRgb(b.dataset.hex);
      if (c.rgb && c.available && rgb) this._run(id, 'light', 'turn_on', { entity_id: id, rgb_color: rgb });
    }
  }

  _activeControl(target) {
    const row = target && this._rows.get(target.dataset.entity);
    return !!row && !!this.el?.contains(target) && row.el.contains(target) && this._entityIds().includes(target.dataset.entity);
  }

  _clearInput(input) { input.dataset.editing = ''; delete input.dataset.context; }

  _sliderInput(e) {
    const slider = e.target;
    if (!slider.dataset.lightControl || slider.disabled || !this._activeControl(slider)) return;
    const control = entityControl(this.hass, slider.dataset.entity);
    if (!control.available || this._pending.has(slider.dataset.entity)) return;
    delete slider.dataset.cancelled;
    slider.dataset.editing = 'true';
    slider.dataset.context = inputContext(control, slider.dataset.lightControl);
    // A native colour dialog can blur before its final change. Keep its unfinished
    // intent separate from the visible draft, so a later revocation still cancels it.
    slider.dataset.gestureContext = slider.dataset.context;
    const row = this._rows.get(slider.dataset.entity);
    if (slider.dataset.lightControl === 'brightness') row.brightness.textContent = `Brightness: ${slider.value}%`;
    else if (slider.dataset.lightControl === 'kelvin') { row.kelvinText.textContent = `Choose temperature: ${slider.value} K`; slider.setAttribute('aria-valuetext', `${slider.value} kelvin`); }
    else if (slider.dataset.lightControl === 'color') { row.colorChoice.textContent = `Choice: ${slider.value}`; row.colorChoice.hidden = false; }
  }

  _sliderChange(e) {
    const slider = e.target;
    if (!slider.dataset.lightControl || slider.disabled || !this._activeControl(slider)) return;
    const id = slider.dataset.entity;
    const c = entityControl(this.hass, id);
    const kind = slider.dataset.lightControl;
    const context = slider.dataset.context || slider.dataset.gestureContext;
    if (!c.available || this._pending.has(id) || slider.dataset.cancelled === 'true'
      || context && context !== inputContext(c, kind)) {
      if (slider.dataset.editing === 'true' || context) slider.dataset.cancelled = 'true';
      delete slider.dataset.gestureContext;
      this._clearInput(slider); this._refreshRows(); return;
    }
    delete slider.dataset.gestureContext;
    this._clearInput(slider);
    if (kind === 'brightness' && c.dimmable) {
      const percent = Number(slider.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
      this._run(id, 'light', percent === 0 ? 'turn_off' : 'turn_on',
        percent === 0 ? { entity_id: id } : { entity_id: id, brightness: Math.round(percent * 255 / 100) });
    } else if (kind === 'color' && c.rgb) {
      const rgb = hexRgb(slider.value);
      if (rgb) this._run(id, 'light', 'turn_on', { entity_id: id, rgb_color: rgb });
    } else if (kind === 'kelvin' && c.colorTemperature) {
      const kelvin = Number(slider.value);
      if (Number.isInteger(kelvin) && kelvin >= c.minKelvin && kelvin <= c.maxKelvin)
        this._run(id, 'light', 'turn_on', { entity_id: id, color_temp_kelvin: kelvin });
    }
  }

  async _run(id, domain, service, data) {
    if (!this.el || !this._rows.has(id) || this._pending.has(id)) return;
    const session = this._session;
    this._errors.delete(id);
    this._pending.add(id);
    this._refreshRows();
    try {
      await this.onAction(domain, service, data);
    } catch (error) {
      if (session === this._session) {
        const message = error && error.message ? error.message : 'Home Assistant did not accept the command.';
        this._errors.set(id, `Command failed: ${message}`);
      }
    } finally {
      if (session === this._session) {
        this._pending.delete(id);
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
    if (hadPopup && restoreFocus && this._opener && this._opener.isConnected && typeof this._opener.focus === 'function') {
      this._opener.focus({ preventScroll: true });
    }
    this._opener = null;
  }

  dispose() { this.close({ restoreFocus: false }); this._cameraFeed.dispose(); }

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
