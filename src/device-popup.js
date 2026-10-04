// Room and marker controls. Opening a popup only reads Home Assistant state.
// Integration: new DevicePopup(stage, { onAction(domain, service, data), onMoreInfo(entityId) });
// Call update(hass) with each HA update, then showMarker(marker, [clientX, clientY]) or
// showRoom(room, markers, [clientX, clientY]). Positions are optional client-screen coordinates.
// Stage capture handlers must skip composedPath().includes(popup.el), and the outside
// pointer event popup.closedBy, so closing a popup cannot also select a room/device.

const QUICK_TOGGLE = new Set(['light', 'switch', 'fan', 'input_boolean']);
const DIMMABLE_MODES = new Set(['brightness', 'color_temp', 'hs', 'rgb', 'rgbw', 'rgbww', 'xy', 'white']);
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
  .taylors3d-device-popup button { font: inherit; border-radius: 10px; cursor: pointer; min-height: 40px;
    border: 1px solid var(--divider-color, #ddd); background: var(--secondary-background-color, #f5f5f5);
    color: var(--primary-text-color, #212121); padding: 6px 10px; }
  .taylors3d-device-popup button:focus-visible, .taylors3d-device-popup input:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  .taylors3d-device-popup button:disabled { opacity: .5; cursor: default; }
  .taylors3d-device-popup .t3d-popup-close { min-width: 40px; font-size: 20px; }
  .taylors3d-device-popup .t3d-entity { border-top: 1px solid var(--divider-color, #ddd); padding: 10px 0; }
  .taylors3d-device-popup .t3d-entity-name { font-weight: 600; overflow-wrap: anywhere; }
  .taylors3d-device-popup .t3d-entity-value { margin: 4px 0 8px; color: var(--secondary-text-color, #727272); }
  .taylors3d-device-popup .t3d-entity-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .taylors3d-device-popup .t3d-brightness { display: block; margin: 10px 0 2px; }
  .taylors3d-device-popup .t3d-brightness input { display: block; width: 100%; margin-top: 6px;
    accent-color: var(--primary-color, #03a9f4); }
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

const available = (s) => !!s && s.state !== 'unavailable' && s.state !== 'unknown';
const serviceExists = (hass, domain, service) => !hass.services || !!(hass.services[domain] && hass.services[domain][service]);

// State is authoritative: controls never pretend a command succeeded before HA reports it.
export function entityControl(hass, entityId) {
  const state = (hass.states || {})[entityId];
  const attr = (state && state.attributes) || {};
  const domain = entityId.split('.')[0];
  const name = attr.friendly_name || entityId;
  const value = !state ? 'Unavailable' : state.state === 'unavailable' ? 'Unavailable' : state.state === 'unknown' ? 'Unknown'
    : `${state.state}${attr.unit_of_measurement ? ` ${attr.unit_of_measurement}` : ''}`;
  const modes = attr.supported_color_modes;
  const dimmable = Array.isArray(modes) ? modes.some((m) => DIMMABLE_MODES.has(m)) : Number.isFinite(attr.brightness);
  return {
    entityId, name, value, available: available(state),
    toggle: QUICK_TOGGLE.has(domain) && serviceExists(hass, domain, 'toggle'),
    dimmable: domain === 'light' && dimmable && serviceExists(hass, 'light', 'turn_on') && serviceExists(hass, 'light', 'turn_off'),
    on: !!state && state.state === 'on',
    brightness: state && state.state === 'on' ? Math.round((Number.isFinite(attr.brightness) ? attr.brightness : 255) / 255 * 100) : 0,
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
  constructor(root, { onAction, onMoreInfo } = {}) {
    this.root = root;
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

  showMarker(marker, position) {
    this._show({ kind: 'marker', marker, title: marker.name || marker.entityId || 'Device' }, position);
  }

  showRoom(room, markers, position) {
    const area = this.hass.areas && this.hass.areas[room.area_id];
    this._show({ kind: 'room', room, markers, title: (area && area.name) || room.name || 'Room' }, position);
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
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', selection.title);
    el.setAttribute('aria-modal', 'false');
    const style = element('style');
    style.textContent = STYLE;
    const head = element('div', 't3d-popup-head');
    const close = button('×', 'close');
    close.className = 't3d-popup-close';
    close.setAttribute('aria-label', 'Close controls');
    head.append(element('h3', '', selection.title), close);
    this._body = element('div', 't3d-popup-body');
    el.append(style, head, this._body);
    // Keep popup interactions out of orbiting, room selection and marker gestures.
    for (const type of STOP_EVENTS) el.addEventListener(type, (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => { this._onKey(e); e.stopPropagation(); });
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('input', (e) => this._sliderInput(e));
    el.addEventListener('change', (e) => this._sliderChange(e));
    el.addEventListener('focusout', (e) => { if (e.target.type === 'range') { e.target.dataset.editing = ''; this._refreshRows(); } });
    this.el = el;
    this.root.append(el);
    window.addEventListener('pointerdown', this._onOutside, true);
    window.addEventListener('keydown', this._onKey);
    this._refreshRows();
    this.reposition();
    close.focus({ preventScroll: true });
  }

  update(hass) {
    this.hass = hass || { states: {} };
    this._refreshRows();
  }

  _entityIds() {
    const s = this._selection;
    const ids = s.kind === 'room' ? roomEntityIds(s.room, s.markers) : markerEntityIds(s.marker);
    // Registry-hidden and diagnostic entities are never included in a room's controls.
    return ids.filter((id) => {
      const reg = this.hass.entities && this.hass.entities[id];
      return !reg || (!reg.hidden && !reg.entity_category);
    });
  }

  _refreshRows() {
    if (!this.el) return;
    const ids = this._entityIds();
    const keep = new Set(ids);
    for (const [id, row] of this._rows) {
      if (!keep.has(id)) { row.el.remove(); this._rows.delete(id); }
    }
    if (!ids.length) {
      if (!this._empty) {
        this._empty = element('p', '', 'No devices are assigned to this room.');
        this._body.append(this._empty);
      }
    } else if (this._empty) { this._empty.remove(); this._empty = null; }
    for (const id of ids) {
      const control = entityControl(this.hass, id);
      let row = this._rows.get(id);
      const key = `${control.toggle}:${control.dimmable}`;
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
      if (row.toggle) {
        row.toggle.textContent = control.on ? 'Turn off' : 'Turn on';
        row.toggle.setAttribute('aria-label', `${control.name}: ${control.on ? 'turn off' : 'turn on'}`);
        row.toggle.disabled = !control.available || busy;
      }
      if (row.slider) {
        row.slider.disabled = !control.available || busy;
        if (!row.slider.dataset.editing) {
          row.slider.value = String(Math.min(100, Math.max(0, control.brightness)));
          row.brightness.textContent = `Brightness: ${row.slider.value}%`;
        }
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
    if (toggle) actions.append(toggle);
    actions.append(info);
    el.append(name, value, actions);
    let slider = null, brightness = null;
    if (control.dimmable) {
      const label = element('label', 't3d-brightness');
      brightness = element('span');
      slider = element('input');
      slider.type = 'range';
      slider.min = '0'; slider.max = '100'; slider.step = '1';
      slider.dataset.entity = id;
      slider.setAttribute('aria-label', `${control.name}: brightness`);
      label.append(brightness, slider);
      el.append(label);
    }
    const error = element('p', 't3d-entity-error');
    error.setAttribute('role', 'alert');
    const status = element('p', 't3d-entity-status');
    status.setAttribute('role', 'status');
    el.append(error, status);
    return { el, key, name, value, info, toggle, slider, brightness, error, status };
  }

  _click(e) {
    const b = e.target.closest && e.target.closest('button[data-action]');
    if (!b || b.disabled) return;
    const id = b.dataset.entity;
    if (b.dataset.action === 'close') this.close();
    else if (b.dataset.action === 'more-info') { this.close(); this.onMoreInfo(id); }
    else if (b.dataset.action === 'toggle') {
      const c = entityControl(this.hass, id);
      if (c.toggle && c.available) this._run(id, id.split('.')[0], 'toggle', { entity_id: id });
    }
  }

  _sliderInput(e) {
    const slider = e.target;
    if (slider.type !== 'range' || slider.disabled) return;
    slider.dataset.editing = 'true';
    const row = this._rows.get(slider.dataset.entity);
    if (row) row.brightness.textContent = `Brightness: ${slider.value}%`;
  }

  _sliderChange(e) {
    const slider = e.target;
    if (slider.type !== 'range' || slider.disabled) return;
    const id = slider.dataset.entity;
    const c = entityControl(this.hass, id);
    if (!c.dimmable || !c.available) return;
    const percent = Math.min(100, Math.max(0, Number(slider.value)));
    slider.dataset.editing = '';
    if (!Number.isFinite(percent)) return;
    this._run(id, 'light', percent === 0 ? 'turn_off' : 'turn_on',
      percent === 0 ? { entity_id: id } : { entity_id: id, brightness: Math.round(percent * 255 / 100) });
  }

  async _run(id, domain, service, data) {
    if (this._pending.has(id)) return;
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
    window.removeEventListener('pointerdown', this._onOutside, true);
    window.removeEventListener('keydown', this._onKey);
    if (this.el) this.el.remove();
    this.el = null;
    this._body = null;
    this._empty = null;
    this._selection = null;
    this._rows.clear();
    this._pending.clear();
    this._errors.clear();
    if (hadPopup && restoreFocus && this._opener && this._opener.isConnected && typeof this._opener.focus === 'function') {
      this._opener.focus({ preventScroll: true });
    }
    this._opener = null;
  }

  dispose() { this.close({ restoreFocus: false }); }
}
