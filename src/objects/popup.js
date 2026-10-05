// Object popup: a small panel next to a model object with its controls (toggle, brightness,
// colour, the group chain) and read-only values. popupRows() is the pure part (unit-tested).
import { typeOf } from './types.js';
import { lightCapabilities, readLightAppearance } from '../light-state.js';
import { entityMetadata } from '../entity-metadata.js';

export const ACTIONS = new Set(['toggle', 'more-info', 'popup', 'none']);
const KINDS = new Set(['toggle', 'brightness', 'color', 'state', 'battery', 'power', 'energy', 'temperature', 'mode', 'start_dock']);
const SOURCE_ERRORS = new Set(['missing', 'state', 'attributes', 'domain', 'restored', 'unavailable', 'unknown']);
const TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean']);
export const SWATCHES = [
  [255, 59, 48], [255, 149, 0], [255, 214, 10], [52, 199, 89], [48, 213, 200], [10, 132, 255], [175, 82, 222], [255, 55, 145],
];
const LABELS = {
  toggle: 'On / off', brightness: 'Brightness', color: 'Colour', state: 'State', battery: 'Battery', power: 'Power',
  energy: 'Energy', temperature: 'Temperature', mode: 'Mode', start_dock: 'Mower',
};
const COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink'];
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

const domainOf = (e) => String(e).split('.')[0];
const bad = (s, e = '') => !s || s.state === 'unavailable' || s.state === 'unknown'
  || (s.attributes && Object.hasOwn(s.attributes, 'restored') && s.attributes.restored !== false)
  || (e.startsWith('light.') && readLightAppearance(s).diagnostics.some((d) => SOURCE_ERRORS.has(d.code)));
const nameOf = (states, e) => (states[e] && states[e].attributes && states[e].attributes.friendly_name) || e;
const withUnit = (v, u) => (u ? `${v} ${u}` : String(v));

// The tap / hold action of an object: fp.ui overrides the type default.
export function objectAction(obj, which) {
  const ui = (obj && obj.ui) || {};
  const own = ui[which];
  return ACTIONS.has(own) ? own : typeOf(obj && obj.type).defaults[which];
}

// The entity a toggle / more-info acts on: the object's own entity, else its group controller.
// With states: an unavailable own entity (a bulb behind an off relay) falls back to a usable controller.
export function actionTarget(obj, binding, groups = {}, states = null) {
  if (binding && binding.hidden) return null;
  const g = obj && obj.group && groups[obj.group];
  const ctrl = (g && g.entity) || null;
  const own = (binding && binding.entity) || null;
  if (own && states && bad(states[own]) && ctrl && !bad(states[ctrl])) return ctrl;
  return own || ctrl;
}

// [domain, service, data] toggling an entity (domains without their own toggle use homeassistant.toggle).
export function toggleCall(entity) {
  const d = domainOf(entity);
  return TOGGLE_DOMAINS.has(d) ? [d, 'toggle', { entity_id: entity }] : ['homeassistant', 'toggle', { entity_id: entity }];
}

function readValue(kind, e, s) {
  const a = s.attributes || {};
  const unit = a.unit_of_measurement;
  switch (kind) {
    case 'state': return withUnit(s.state, unit);
    case 'battery': {
      const v = a.battery_level ?? a.battery;
      if (v !== undefined && v !== null) return `${v} %`;
      return a.device_class === 'battery' ? withUnit(s.state, unit) : null;
    }
    case 'power': {
      if (unit === 'W' || unit === 'kW') return withUnit(s.state, unit);
      const v = a.current_power_w ?? a.power;
      return v !== undefined && v !== null ? `${v} W` : null;
    }
    case 'energy': {
      if (unit === 'kWh' || unit === 'Wh') return withUnit(s.state, unit);
      const v = a.energy ?? a.total_energy_kwh;
      return v !== undefined && v !== null ? `${v} kWh` : null;
    }
    case 'temperature': {
      const v = a.current_temperature;
      if (v !== undefined && v !== null) return a.temperature_unit ? `${v} ${a.temperature_unit}` : `${v}°`;
      return unit === '°C' || unit === '°F' ? withUnit(s.state, unit) : null;
    }
    case 'mode': return domainOf(e) === 'climate' ? s.state : a.mode ?? a.preset_mode ?? null;
    default: return null;
  }
}

/**
 * Popup rows for an object: fp.ui.popup or the type default, plus the group chain.
 * groups (layout.groups) tells the controller apart from the object's own entity.
 * Unavailable / unbound: a single state row "unavailable".
 */
export function popupRows(obj, chain, states = {}, groups = {}) {
  const unavailable = [{ kind: 'state', label: 'State', value: 'unavailable' }];
  if (!chain || !chain.entities || !chain.entities.some((e) => !bad(states[e], e))) return unavailable;
  const g = obj.group && groups[obj.group];
  const ctrl = (g && g.entity && chain.entities.includes(g.entity) && g.entity) || null;
  const own = chain.entities.find((e) => e !== ctrl) || null;
  const ownBad = !!own && bad(states[own], own);
  // an unavailable own entity: only the (usable) controller row and the reason
  const main = ownBad ? null : own || ctrl;
  const light = chain.entities.find((e) => e.startsWith('light.') && !bad(states[e], e)) || null;
  const ls = light ? states[light] : null;
  const caps = lightCapabilities(ls), appearance = readLightAppearance(ls);
  const min = finite(caps.minKelvin) ? Math.ceil(caps.minKelvin) : null;
  const max = finite(caps.maxKelvin) ? Math.floor(caps.maxKelvin) : null;
  const whiteKelvin = caps.valid && caps.colorTemperature && min > 0 && min <= max ? min : null;
  const ui = obj.ui && Array.isArray(obj.ui.popup) ? obj.ui.popup : typeOf(obj.type).defaults.popup;
  const want = [];
  for (const k of ui) {
    const kind = k === 'start' || k === 'dock' ? 'start_dock' : k;
    if (KINDS.has(kind) && !want.includes(kind)) want.push(kind);
  }
  const rows = [];
  for (const kind of main ? want : []) {
    const label = LABELS[kind];
    if (kind === 'toggle') rows.push({ kind, entity: main, label, value: states[main].state === 'on' });
    else if (kind === 'brightness') {
      if (!caps.valid || !caps.brightness) continue;
      const b = ls.attributes?.brightness;
      rows.push({ kind, entity: light, label, value: ls.state === 'off' ? 0 : finite(b) && b >= 0 && b <= 255 ? b : null });
    } else if (kind === 'color') {
      if (!caps.valid || (!caps.rgb && whiteKelvin === null)) continue;
      rows.push({ kind, entity: light, label, rgb: caps.rgb, whiteKelvin, value: appearance.colorKnown ? appearance.color : null });
    } else if (kind === 'start_dock') {
      if (domainOf(main) === 'lawn_mower') rows.push({ kind, entity: main, label, value: states[main].state });
    } else {
      const value = readValue(kind, main, states[main]);
      if (value !== null && value !== undefined) rows.push({ kind, entity: main, label, value });
    }
  }
  if (ctrl && ctrl !== main) rows.push({ kind: 'chain', entity: ctrl, label: nameOf(states, ctrl), value: !bad(states[ctrl]) && states[ctrl].state === 'on' });
  let reason = null;
  if (ctrl && !bad(states[ctrl]) && states[ctrl].state !== 'on') reason = `${nameOf(states, ctrl)} is off`;
  else if (ownBad) reason = `${nameOf(states, own)} is unavailable`;
  else if (!chain.lit && chain.reason) {
    reason = chain.reason;
    for (const e of chain.entities) if (reason.startsWith(e + ' ')) reason = nameOf(states, e) + reason.slice(e.length);
  }
  if (reason) rows.push({ kind: 'reason', label: reason });
  return rows;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STOP = ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'click', 'dblclick', 'contextmenu',
  'mousedown', 'mouseup', 'touchstart', 'touchend', 'touchmove', 'wheel', 'keydown'];

/**
 * The DOM popup. root: the stage (position: relative). opts:
 *   onAction(domain, service, data), project(world: Vector3) -> [clientX, clientY] | null,
 *   resolve(id) -> { obj, chain, states, groups, hass? } | null (current data for the open object).
 * hass supplies current registry, connection and service guards. State-only callers remain supported.
 */
export class ObjectPopup {
  constructor(root, { onAction, project, resolve, anchor } = {}) {
    this.root = root;
    this.anchorOf = anchor || null; // (id) -> world Vector3, re-read on every reposition
    this.onAction = onAction || (() => {});
    this.project = project || (() => null);
    this.resolve = resolve || (() => null);
    this.el = null;
    this._id = null;
    this._anchor = null;
    this._key = null;
    this._sliding = false;
    this._pending = new Set();
    this._errors = new Map();
    this._session = 0;
    this.closedBy = null; // the outside pointerdown that closed the popup (that gesture must not act)
    this._onOutside = (e) => {
      if (!this.el || e.composedPath().includes(this.el)) return;
      this.closedBy = e;
      this.close();
    };
    this._onRelease = () => { this._sliding = false; };
    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
  }

  get isOpen() { return !!this.el; }
  get objectId() { return this._id; }

  open(obj, anchorWorld) {
    this.close();
    this._id = obj.id;
    this._anchor = anchorWorld && anchorWorld.clone ? anchorWorld.clone() : anchorWorld;
    const el = document.createElement('div');
    el.className = 'fp-popup';
    el.innerHTML = `<style>
      .fp-popup button, .fp-popup input[type=range] { min-height: 44px; }
      .fp-popup .fp-swatch { min-width: 44px; }
      .fp-popup .fp-pop-row.brightness { flex-wrap: wrap; }
      .fp-popup .fp-pop-reading, .fp-popup .fp-pop-status { flex-basis: 100%; font-size: 12px; overflow-wrap: anywhere; }
      .fp-popup button:disabled, .fp-popup input:disabled { opacity: .5; cursor: default; }
      .fp-popup button:focus-visible, .fp-popup input:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
    </style><div class="fp-pop-head"><span class="fp-pop-title"></span><button class="fp-pop-x" title="Close" aria-label="Close object controls">×</button></div><div class="fp-pop-rows"></div>`;
    el.querySelector('.fp-pop-title').textContent = obj.label || obj.id;
    for (const t of STOP) el.addEventListener(t, (e) => e.stopPropagation()); // no HA long-press / orbit / marker
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); }); // window never sees it (stopped)
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('change', (e) => this._change(e));
    el.addEventListener('pointerdown', (e) => { if (e.target.type === 'range') this._sliding = true; });
    el.addEventListener('pointercancel', (e) => { if (e.target.type === 'range') { this._sliding = false; e.target.dataset.editing = ''; delete e.target.dataset.gesture; e.target.dataset.cancelled = 'true'; this.update(); } });
    el.addEventListener('input', (e) => { if (e.target.type === 'range' && !e.target.disabled) { this._sliding = true; e.target.dataset.editing = 'true'; e.target.dataset.gesture = 'true'; delete e.target.dataset.cancelled; } });
    el.addEventListener('focusout', (e) => { if (e.target.type === 'range') { this._sliding = false; e.target.dataset.editing = ''; this.update(); } });
    el.querySelector('.fp-pop-x').addEventListener('click', () => this.close());
    this.el = el;
    this.root.append(el);
    window.addEventListener('pointerdown', this._onOutside, true);
    window.addEventListener('pointerup', this._onRelease, true); // a slider released outside the popup
    window.addEventListener('pointercancel', this._onRelease, true);
    window.addEventListener('keydown', this._onKey);
    this.update();
    this.position();
  }

  _rows() {
    const r = this._id ? this.resolve(this._id) : null;
    if (!r) return null;
    return popupRows(r.obj, r.chain, r.states || {}, r.groups || {});
  }

  // Re-read the object's rows; same row layout: values only (a slider being dragged keeps its value).
  update() {
    if (!this.el || this._updating) return;
    // Chrome blurs removed inputs synchronously. Their handler must not inspect
    // the old rows after the new layout key has been selected but before mounting.
    this._updating = true;
    try { this._updateNow(); }
    finally { this._updating = false; }
  }

  _updateNow() {
    if (!this.el) return;
    const rows = this._rows();
    if (!rows) { this.close(); return; }
    const key = rows.map((r) => `${r.kind}:${r.entity || ''}:${r.kind === 'color' ? `${r.rgb}:${r.whiteKelvin !== null}` : ''}`).join('|');
    const box = this.el.querySelector('.fp-pop-rows');
    if (key !== this._key) {
      this._key = key;
      box.innerHTML = rows.map((r) => this._rowHtml(r)).join('');
    }
    rows.forEach((r, i) => {
      const row = box.children[i];
      if (!row) return;
      row.dataset.entity = r.entity || '';
      for (const button of row.querySelectorAll('[data-act]')) {
        button.disabled = !this._allowed(r, button.dataset.act) || this._pending.has(r.entity);
        button.setAttribute('aria-label', r.kind === 'color' ? button.title : `${r.label}: ${r.entity || ''}`);
      }
      const status = row.querySelector('.fp-pop-status');
      if (status) {
        status.textContent = this._errors.get(r.entity) || (this._pending.has(r.entity) ? 'Sending command…' : '');
        status.hidden = !status.textContent;
        status.setAttribute('role', this._errors.has(r.entity) ? 'alert' : 'status');
      }
      if (r.kind === 'toggle' || r.kind === 'chain') {
        const b = row.querySelector('.fp-switch');
        b.classList.toggle('on', !!r.value);
        b.setAttribute('aria-checked', String(!!r.value));
        if (r.kind === 'chain') row.querySelector('.fp-pop-label').textContent = r.label;
      } else if (r.kind === 'brightness') {
        const input = row.querySelector('input');
        input.disabled = !this._allowed(r, 'brightness') || this._pending.has(r.entity);
        if (input.disabled) {
          if (input.dataset.editing === 'true' || input.dataset.gesture === 'true' || this._sliding) input.dataset.cancelled = 'true';
          input.dataset.editing = '';
          delete input.dataset.gesture;
        }
        if ((!this._sliding && input.dataset.editing !== 'true') || input.disabled) input.value = String(Math.max(1, r.value ?? 1));
        row.querySelector('.fp-pop-reading').textContent = r.value === null ? 'Brightness: not reported' : `Brightness: ${Math.round(r.value / 255 * 100)}%`;
        row.classList.toggle('off', r.value === 0);
      } else if (r.kind === 'color') {
        const v = r.value ? r.value.join(',') : '';
        for (const s of row.querySelectorAll('.fp-swatch')) {
          const selected = !!v && s.dataset.rgb === v;
          s.classList.toggle('on', selected); s.setAttribute('aria-pressed', String(selected));
          if (s.dataset.act === 'white') s.dataset.kelvin = String(r.whiteKelvin);
        }
        row.querySelector('.fp-pop-reading').textContent = v ? `Current colour: rgb(${v})` : 'Current colour: not reported';
      } else if (r.kind === 'reason') {
        row.textContent = r.label;
      } else if (r.kind !== 'start_dock') {
        row.querySelector('.fp-pop-value').textContent = r.value;
      }
    });
  }

  _rowHtml(r) {
    const label = `<span class="fp-pop-label">${esc(r.label)}</span>`;
    const status = '<span class="fp-pop-status" hidden></span>';
    switch (r.kind) {
      case 'toggle': case 'chain':
        return `<div class="fp-pop-row ${r.kind}">${label}<button class="fp-switch" role="switch" data-act="toggle"><span></span></button>${status}</div>`;
      case 'brightness':
        return `<div class="fp-pop-row brightness">${label}<input type="range" min="1" max="255" step="1" aria-label="${esc(r.entity)}: brightness"><span class="fp-pop-reading"></span>${status}</div>`;
      case 'color':
        return `<div class="fp-pop-row color">${r.rgb ? SWATCHES.map((c, i) => `<button class="fp-swatch" data-act="rgb" data-rgb="${c.join(',')}" title="Set ${COLOR_NAMES[i].toLowerCase()}" style="background:rgb(${c.join(',')})"></button>`).join('') : ''}`
          + (r.whiteKelvin !== null ? '<button class="fp-swatch white" data-act="white" title="Warmest supported white"></button>' : '')
          + `<span class="fp-pop-reading"></span>${status}</div>`;
      case 'start_dock':
        return `<div class="fp-pop-row start_dock">${label}<span class="fp-pop-btns"><button data-act="start">Start</button><button data-act="dock">Dock</button></span>${status}</div>`;
      case 'reason':
        return `<div class="fp-pop-row reason">${esc(r.label)}</div>`;
      default:
        return `<div class="fp-pop-row value">${label}<span class="fp-pop-value"></span></div>`;
    }
  }

  _click(e) {
    const b = e.target.closest && e.target.closest('[data-act]');
    const row = b && b.closest('.fp-pop-row');
    const entity = row && row.dataset.entity;
    if (!b || b.disabled || !entity || !this.el?.contains(b)) return;
    const act = b.dataset.act;
    const current = this._currentRow(row);
    if (!current || !this._allowed(current, act)) { this.update(); return; }
    if (act === 'toggle') this._run(entity, ...toggleCall(entity));
    else if (act === 'rgb') {
      const rgb = b.dataset.rgb.split(',').map(Number);
      if (rgb.length === 3 && rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) this._run(entity, 'light', 'turn_on', { entity_id: entity, rgb_color: rgb });
    } else if (act === 'white' && Number(b.dataset.kelvin) === current.whiteKelvin)
      this._run(entity, 'light', 'turn_on', { entity_id: entity, color_temp_kelvin: current.whiteKelvin });
    else if (act === 'start') this._run(entity, 'lawn_mower', 'start_mowing', { entity_id: entity });
    else if (act === 'dock') this._run(entity, 'lawn_mower', 'dock', { entity_id: entity });
  }

  // brightness: one call when the slider is released ('change'), not per 'input' step
  _change(e) {
    if (e.target.type !== 'range' || e.target.disabled || !this.el?.contains(e.target)) return;
    this._sliding = false;
    e.target.dataset.editing = '';
    delete e.target.dataset.gesture;
    const row = e.target.closest('.fp-pop-row');
    const current = this._currentRow(row), value = Number(e.target.value);
    if (current && e.target.dataset.cancelled !== 'true' && this._allowed(current, 'brightness') && e.target.value !== '' && Number.isInteger(value) && value >= 1 && value <= 255)
      this._run(current.entity, 'light', 'turn_on', { entity_id: current.entity, brightness: value });
    else this.update();
  }

  _currentRow(row) {
    if (!row || !this.el?.contains(row)) return null;
    const rows = this._rows();
    return rows?.find((r) => r.entity === row.dataset.entity && row.classList.contains(r.kind)) || null;
  }

  _allowed(row, action) {
    const r = this._id ? this.resolve(this._id) : null;
    const state = r?.states?.[row.entity];
    if (!r || !row.entity || bad(state, row.entity) || this._pending.has(row.entity)) return false;
    let call = null;
    if (action === 'toggle' && ['toggle', 'chain'].includes(row.kind)) call = toggleCall(row.entity);
    else if ((action === 'brightness' && row.kind === 'brightness') || (action === 'rgb' && row.kind === 'color' && row.rgb)
      || (action === 'white' && row.kind === 'color' && row.whiteKelvin !== null)) call = ['light', 'turn_on'];
    else if (action === 'start' && row.kind === 'start_dock') call = ['lawn_mower', 'start_mowing'];
    else if (action === 'dock' && row.kind === 'start_dock') call = ['lawn_mower', 'dock'];
    if (!call) return false;
    if (!r.hass) return true;
    const m = entityMetadata(r.hass, row.entity), h = r.hass;
    return m.available && !m.hidden && !m.category && h.connected !== false && h.connection?.connected !== false
      && (!h.services || !!h.services[call[0]]?.[call[1]]);
  }

  async _run(entity, domain, service, data) {
    if (!this.el || this._pending.has(entity)) return;
    const session = this._session;
    this._pending.add(entity); this._errors.delete(entity); this.update();
    try { await this.onAction(domain, service, data); }
    catch (error) { if (this._session === session) this._errors.set(entity, `Command failed: ${error?.message || 'Please try again.'}`); }
    finally { if (this._session === session) { this._pending.delete(entity); this.update(); } }
  }

  // Next to the object's anchor (called after every render), kept inside the stage; hidden while
  // the anchor is off-screen or behind the camera.
  position() {
    if (!this.el) return;
    const world = (this.anchorOf && this.anchorOf(this._id)) || this._anchor;
    const p = world ? this.project(world) : null;
    const r = this.root.getBoundingClientRect();
    const ax = p ? p[0] - r.left : 0, ay = p ? p[1] - r.top : 0;
    if (!p || ax < 0 || ay < 0 || ax > r.width || ay > r.height) { this.el.style.visibility = 'hidden'; return; }
    this.el.style.maxHeight = `${Math.max(60, r.height - 16)}px`;
    const w = this.el.offsetWidth, h = this.el.offsetHeight, gap = 18, pad = 8;
    let x = ax + gap;
    if (x + w > r.width - pad) x = ax - gap - w; // no room on the right: left of the object
    x = Math.max(pad, Math.min(x, r.width - w - pad));
    const y = Math.max(pad, Math.min(ay - h / 2, r.height - h - pad));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.el.style.visibility = '';
  }

  close() {
    this._session++;
    this._pending.clear(); this._errors.clear();
    if (!this.el) return;
    window.removeEventListener('pointerdown', this._onOutside, true);
    window.removeEventListener('pointerup', this._onRelease, true);
    window.removeEventListener('pointercancel', this._onRelease, true);
    window.removeEventListener('keydown', this._onKey);
    this.el.remove();
    this.el = null;
    this._id = null;
    this._anchor = null;
    this._key = null;
    this._sliding = false;
  }
}
