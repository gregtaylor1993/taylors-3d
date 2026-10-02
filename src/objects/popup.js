// Object popup: a small panel next to a model object with its controls (toggle, brightness,
// colour, the group chain) and read-only values. popupRows() is the pure part (unit-tested).
import { typeOf } from './types.js';

export const ACTIONS = new Set(['toggle', 'more-info', 'popup', 'none']);
const KINDS = new Set(['toggle', 'brightness', 'color', 'state', 'battery', 'power', 'energy', 'temperature', 'mode', 'start_dock']);
const COLOR_MODES = new Set(['hs', 'rgb', 'xy', 'rgbw', 'rgbww']);
const TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean']);
export const SWATCHES = [
  [255, 59, 48], [255, 149, 0], [255, 214, 10], [52, 199, 89], [48, 213, 200], [10, 132, 255], [175, 82, 222], [255, 55, 145],
];
const LABELS = {
  toggle: 'Power', brightness: 'Brightness', color: 'Colour', state: 'State', battery: 'Battery', power: 'Power',
  energy: 'Energy', temperature: 'Temperature', mode: 'Mode', start_dock: 'Mower',
};

const domainOf = (e) => String(e).split('.')[0];
const bad = (s) => !s || s.state === 'unavailable' || s.state === 'unknown';
const nameOf = (states, e) => (states[e] && states[e].attributes && states[e].attributes.friendly_name) || e;
const withUnit = (v, u) => (u ? `${v} ${u}` : String(v));

// The tap / hold action of an object: fp.ui overrides the type default.
export function objectAction(obj, which) {
  const ui = (obj && obj.ui) || {};
  const own = ui[which];
  return ACTIONS.has(own) ? own : typeOf(obj && obj.type).defaults[which];
}

// The entity a toggle / more-info acts on: the object's own entity, else its group controller.
export function actionTarget(obj, binding, groups = {}) {
  if (binding && binding.hidden) return null;
  if (binding && binding.entity) return binding.entity;
  const g = obj && obj.group && groups[obj.group];
  return (g && g.entity) || null;
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
  if (!chain || chain.unavailable || !chain.entities || !chain.entities.length) return unavailable;
  const g = obj.group && groups[obj.group];
  const ctrl = (g && g.entity && chain.entities.includes(g.entity) && g.entity) || null;
  const main = chain.entities.find((e) => e !== ctrl) || ctrl;
  const light = chain.entities.find((e) => e.startsWith('light.')) || null;
  const ls = light ? states[light] : null;
  const modes = ls && Array.isArray(ls.attributes.supported_color_modes) ? ls.attributes.supported_color_modes : null;
  const ui = obj.ui && Array.isArray(obj.ui.popup) ? obj.ui.popup : typeOf(obj.type).defaults.popup;
  const want = [];
  for (const k of ui) {
    const kind = k === 'start' || k === 'dock' ? 'start_dock' : k;
    if (KINDS.has(kind) && !want.includes(kind)) want.push(kind);
  }
  const rows = [];
  for (const kind of want) {
    const label = LABELS[kind];
    if (kind === 'toggle') rows.push({ kind, entity: main, label, value: states[main].state === 'on' });
    else if (kind === 'brightness') {
      if (!ls || (modes && modes.every((m) => m === 'onoff'))) continue;
      const b = ls.attributes.brightness;
      rows.push({ kind, entity: light, label, value: ls.state === 'on' && typeof b === 'number' ? b : ls.state === 'on' ? 255 : 0 });
    } else if (kind === 'color') {
      if (!modes || !modes.some((m) => COLOR_MODES.has(m))) continue;
      rows.push({ kind, entity: light, label, value: Array.isArray(ls.attributes.rgb_color) ? ls.attributes.rgb_color.slice(0, 3) : null });
    } else if (kind === 'start_dock') {
      if (domainOf(main) === 'lawn_mower') rows.push({ kind, entity: main, label, value: states[main].state });
    } else {
      const value = readValue(kind, main, states[main]);
      if (value !== null && value !== undefined) rows.push({ kind, entity: main, label, value });
    }
  }
  if (ctrl && ctrl !== main) rows.push({ kind: 'chain', entity: ctrl, label: nameOf(states, ctrl), value: !bad(states[ctrl]) && states[ctrl].state === 'on' });
  if (!chain.lit && chain.reason) {
    let text = chain.reason;
    for (const e of chain.entities) if (text.startsWith(e + ' ')) text = nameOf(states, e) + text.slice(e.length);
    rows.push({ kind: 'reason', label: text });
  }
  return rows;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STOP = ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'click', 'dblclick', 'contextmenu',
  'mousedown', 'mouseup', 'touchstart', 'touchend', 'touchmove', 'wheel', 'keydown'];

/**
 * The DOM popup. root: the stage (position: relative). opts:
 *   onAction(domain, service, data), project(world: Vector3) -> [clientX, clientY] | null,
 *   resolve(id) -> { obj, chain, states, groups } | null (current data for the open object).
 */
export class ObjectPopup {
  constructor(root, { onAction, project, resolve } = {}) {
    this.root = root;
    this.onAction = onAction || (() => {});
    this.project = project || (() => null);
    this.resolve = resolve || (() => null);
    this.el = null;
    this._id = null;
    this._anchor = null;
    this._key = null;
    this._sliding = false;
    this._onOutside = (e) => { if (this.el && !e.composedPath().includes(this.el)) this.close(); };
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
    el.innerHTML = `<div class="fp-pop-head"><span class="fp-pop-title"></span><button class="fp-pop-x" title="Close">×</button></div><div class="fp-pop-rows"></div>`;
    el.querySelector('.fp-pop-title').textContent = obj.label || obj.id;
    for (const t of STOP) el.addEventListener(t, (e) => e.stopPropagation()); // no HA long-press / orbit / marker
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); }); // window never sees it (stopped)
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('change', (e) => this._change(e));
    el.addEventListener('pointerdown', (e) => { if (e.target.type === 'range') this._sliding = true; });
    el.addEventListener('pointerup', () => { this._sliding = false; });
    el.querySelector('.fp-pop-x').addEventListener('click', () => this.close());
    this.el = el;
    this.root.append(el);
    window.addEventListener('pointerdown', this._onOutside, true);
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
    if (!this.el) return;
    const rows = this._rows();
    if (!rows) { this.close(); return; }
    const key = rows.map((r) => `${r.kind}:${r.entity || ''}`).join('|');
    const box = this.el.querySelector('.fp-pop-rows');
    if (key !== this._key) {
      this._key = key;
      box.innerHTML = rows.map((r) => this._rowHtml(r)).join('');
    }
    rows.forEach((r, i) => {
      const row = box.children[i];
      if (!row) return;
      row.dataset.entity = r.entity || '';
      if (r.kind === 'toggle' || r.kind === 'chain') {
        const b = row.querySelector('.fp-switch');
        b.classList.toggle('on', !!r.value);
        b.setAttribute('aria-checked', String(!!r.value));
        if (r.kind === 'chain') row.querySelector('.fp-pop-label').textContent = r.label;
      } else if (r.kind === 'brightness') {
        const input = row.querySelector('input');
        if (!this._sliding) input.value = String(Math.max(1, r.value));
        row.classList.toggle('off', !r.value);
      } else if (r.kind === 'color') {
        const v = r.value ? r.value.join(',') : '';
        for (const s of row.querySelectorAll('.fp-swatch')) s.classList.toggle('on', !!v && s.dataset.rgb === v);
      } else if (r.kind === 'reason') {
        row.textContent = r.label;
      } else if (r.kind !== 'start_dock') {
        row.querySelector('.fp-pop-value').textContent = r.value;
      }
    });
  }

  _rowHtml(r) {
    const label = `<span class="fp-pop-label">${esc(r.label)}</span>`;
    switch (r.kind) {
      case 'toggle': case 'chain':
        return `<div class="fp-pop-row ${r.kind}">${label}<button class="fp-switch" role="switch" data-act="toggle"><span></span></button></div>`;
      case 'brightness':
        return `<div class="fp-pop-row brightness">${label}<input type="range" min="1" max="255" step="1"></div>`;
      case 'color':
        return `<div class="fp-pop-row color">${SWATCHES.map((c) => `<button class="fp-swatch" data-act="rgb" data-rgb="${c.join(',')}" style="background:rgb(${c.join(',')})"></button>`).join('')}`
          + '<button class="fp-swatch white" data-act="white" title="Warm white"></button></div>';
      case 'start_dock':
        return `<div class="fp-pop-row start_dock">${label}<span class="fp-pop-btns"><button data-act="start">Start</button><button data-act="dock">Dock</button></span></div>`;
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
    if (!b || !entity) return;
    const act = b.dataset.act;
    if (act === 'toggle') this.onAction(...toggleCall(entity));
    else if (act === 'rgb') this.onAction('light', 'turn_on', { entity_id: entity, rgb_color: b.dataset.rgb.split(',').map(Number) });
    else if (act === 'white') this.onAction('light', 'turn_on', { entity_id: entity, color_temp_kelvin: 2700 });
    else if (act === 'start') this.onAction('lawn_mower', 'start_mowing', { entity_id: entity });
    else if (act === 'dock') this.onAction('lawn_mower', 'dock', { entity_id: entity });
  }

  // brightness: one call when the slider is released ('change'), not per 'input' step
  _change(e) {
    if (e.target.type !== 'range') return;
    this._sliding = false;
    const row = e.target.closest('.fp-pop-row');
    const entity = row && row.dataset.entity;
    if (entity) this.onAction('light', 'turn_on', { entity_id: entity, brightness: Math.round(Number(e.target.value)) });
  }

  // Next to the object's anchor (called after every render), kept inside the stage.
  position() {
    if (!this.el) return;
    const p = this._anchor ? this.project(this._anchor) : null;
    if (!p) { this.el.style.visibility = 'hidden'; return; }
    const r = this.root.getBoundingClientRect();
    const w = this.el.offsetWidth, h = this.el.offsetHeight, gap = 18, pad = 8;
    const ax = p[0] - r.left, ay = p[1] - r.top;
    let x = ax + gap;
    if (x + w > r.width - pad) x = ax - gap - w; // no room on the right: left of the object
    x = Math.max(pad, Math.min(x, r.width - w - pad));
    const y = Math.max(pad, Math.min(ay - h / 2, r.height - h - pad));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.el.style.visibility = '';
  }

  close() {
    if (!this.el) return;
    window.removeEventListener('pointerdown', this._onOutside, true);
    window.removeEventListener('keydown', this._onKey);
    this.el.remove();
    this.el = null;
    this._id = null;
    this._anchor = null;
    this._key = null;
    this._sliding = false;
  }
}
