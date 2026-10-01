// floorplan3d-card: Home Assistant Lovelace card showing a 3D floorplan with auto-placed devices.

import { Color } from 'three';
import { FloorplanView } from './view.js';
import { LayoutStore } from './storage.js';
import { buildMarkers, registrySignature, iconFor, isActive, displayValue, areaName } from './registry.js';
import { mergeFloors, roomFloorId, markerPositions, lightGlow } from './layout.js';

const VERSION = '0.1.0';
const TAP_TOGGLE = new Set(['light', 'switch', 'fan', 'input_boolean']);
const LONG_PRESS_MS = 500;
const CLICK_SLOP_PX = 5;

const STYLE = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; position: relative;
    background: var(--ha-card-background, var(--card-background-color, #fff));
    border-radius: var(--ha-card-border-radius, 12px); color: var(--primary-text-color); }
  .stage { position: relative; width: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
  .stage canvas { display: block; }
  .toolbar { position: absolute; top: 8px; left: 8px; right: 8px; display: flex; gap: 8px;
    align-items: flex-start; z-index: 2; pointer-events: none; }
  .toolbar > * { pointer-events: auto; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
  .spacer { flex: 1; }
  button.chip, .seg button { font: inherit; font-size: 13px; line-height: 1; cursor: pointer;
    padding: 7px 12px; border-radius: 16px; border: 1px solid var(--divider-color, rgba(0,0,0,.12));
    background: var(--card-background-color, #fff); color: var(--primary-text-color); }
  button.chip.on, .seg button.on { background: var(--primary-color); border-color: var(--primary-color);
    color: var(--text-primary-color, #fff); }
  .seg { display: flex; }
  .seg button:first-child { border-radius: 16px 0 0 16px; }
  .seg button:last-child { border-radius: 0 16px 16px 0; border-left: none; }
  .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    text-align: center; padding: 24px; color: var(--secondary-text-color); pointer-events: none; }
  .empty[hidden] { display: none; }

  .fp-room-label { font-size: 11px; letter-spacing: .02em; color: var(--secondary-text-color, #727272);
    white-space: nowrap; pointer-events: none; opacity: .9; }
  .fp-room-label.outdoor { font-style: italic; }
  .fp-marker { display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: auto;
    cursor: pointer; transform-origin: center; }
  .fp-dot { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: var(--card-background-color, #fff); color: var(--secondary-text-color, #727272);
    border: 1.5px solid var(--divider-color, rgba(0,0,0,.15)); box-shadow: 0 1px 4px rgba(0,0,0,.25);
    transition: background .2s, color .2s, transform .1s; --mdc-icon-size: 17px; }
  .fp-marker:hover .fp-dot { transform: scale(1.12); }
  .fp-marker.active .fp-dot { background: var(--primary-color); border-color: var(--primary-color);
    color: var(--text-primary-color, #fff); }
  .fp-marker.active.light .fp-dot { background: var(--fp-light, var(--state-light-active-color, #ffb74d));
    border-color: var(--fp-light, var(--state-light-active-color, #ffb74d)); color: #fff; }
  .fp-marker.unavailable .fp-dot { opacity: .45; border-style: dashed; }
  .fp-val { font-size: 10.5px; font-weight: 500; padding: 1px 5px; border-radius: 8px; white-space: nowrap;
    background: var(--card-background-color, #fff); color: var(--primary-text-color);
    box-shadow: 0 1px 3px rgba(0,0,0,.2); }
  .fp-val:empty { display: none; }
  .compact .fp-dot { width: 21px; height: 21px; --mdc-icon-size: 13px; border-width: 1px; }
  .compact .fp-val { font-size: 9.5px; padding: 0 4px; }
`;

function cssColor(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  const c = new Color();
  try {
    // drop alpha from rgba() so three.js can parse it
    c.setStyle((v || fallback).replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)'));
  } catch (e) {
    c.setStyle(fallback);
  }
  return c;
}

const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

class Floorplan3dCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._layout = null;
    this._built = {};
    this._markers = [];
    this._markerEls = new Map();
    this._floor = null;
    this._mode = '3d';
  }

  static getStubConfig() {
    return { layout_key: 'default', height: '520px' };
  }

  setConfig(config) {
    this._config = { layout_key: 'default', height: '520px', group_by: 'device', wall_height: 1.0, view: '3d', ...config };
    this._mode = this._config.view === 'top' ? 'top' : '3d';
    this._store = new LayoutStore(this._config.layout_key);
    if (this._stage) this._stage.style.height = this._config.height;
    if (this.isConnected && !this._view) this.connectedCallback();
  }

  getCardSize() {
    return Math.ceil(parseInt(this._config?.height, 10) / 50) || 10;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._layout && !this._loading) this._load();
    this._schedule();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    if (!this._config) return; // setConfig renders once it arrives
    if (!this._view) this._render();
    this._view.start();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this._stage);
    this._schedule();
  }

  disconnectedCallback() {
    if (this._view) this._view.stop();
    if (this._ro) this._ro.disconnect();
  }

  async _load() {
    this._loading = true;
    try {
      this._layout = await this._store.load(this._hass);
    } finally {
      this._loading = false;
    }
    this._schedule();
  }

  _render() {
    const root = this.shadowRoot;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="stage">
          <div class="toolbar">
            <div class="chips"></div>
            <div class="seg"><button data-mode="3d">3D</button><button data-mode="top">Top</button></div>
          </div>
          <div class="empty" hidden></div>
        </div>
      </ha-card>`;
    this._stage = root.querySelector('.stage');
    this._stage.style.height = this._config.height;
    this._chips = root.querySelector('.chips');
    this._empty = root.querySelector('.empty');
    root.querySelector('.seg').addEventListener('click', (e) => {
      const mode = e.target.dataset && e.target.dataset.mode;
      if (mode) this._setMode(mode);
    });
    this._chips.addEventListener('click', (e) => {
      const id = e.target.dataset && e.target.dataset.floor;
      if (id) this._setFloor(id);
    });
    this._view = new FloorplanView(this._stage);
    this._view.setMode(this._mode);
    this._syncToolbar();
  }

  _resize() {
    const r = this._stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this._view.resize(r.width, r.height);
    if (!this._fitted && this._built.layout) {
      this._fitted = true;
      this._view.fit();
    }
  }

  _schedule() {
    if (this._pending) return;
    this._pending = true;
    queueMicrotask(() => {
      this._pending = false;
      if (this._view && this._hass && this._layout) this._update();
    });
  }

  _update() {
    const h = this._hass;
    const b = this._built;
    let structure = false, markers = false;

    if (h.themes !== b.themes || !b.theme) {
      b.themes = h.themes;
      this._applyTheme();
      structure = true;
    }
    if (structure || this._layout !== b.layout || h.floors !== b.floors || h.areas !== b.areas) {
      this._buildStructure();
      markers = true;
    }
    const sig = registrySignature(h);
    if (markers || !b.sig || sig.some((x, i) => x !== b.sig[i])) {
      b.sig = sig;
      this._buildMarkers();
    }
    if (h.states !== b.states || markers) {
      b.states = h.states;
      this._refreshStates();
    }
  }

  _applyTheme() {
    const bg = cssColor(this, '--card-background-color', '#ffffff');
    const text = cssColor(this, '--primary-text-color', '#212121');
    const dark = this._hass.themes && typeof this._hass.themes.darkMode === 'boolean'
      ? this._hass.themes.darkMode : luminance(bg) < 0.4;
    const mix = (a, c, t) => a.clone().lerp(c, t);
    this._built.theme = {
      dark,
      floor: mix(bg, text, dark ? 0.09 : 0.05),
      outdoor: mix(bg, new Color('#5a9e4b'), dark ? 0.22 : 0.3),
      wall: mix(bg, text, dark ? 0.42 : 0.3),
      edge: mix(bg, text, dark ? 0.3 : 0.22),
    };
    this._view.setTheme(this._built.theme);
  }

  _buildStructure() {
    const h = this._hass, b = this._built;
    b.layout = this._layout;
    b.floors = h.floors;
    b.areas = h.areas;
    this._floors = mergeFloors(h, this._layout);
    const rooms = (this._layout.rooms || []).map((room) => ({
      room,
      floorId: roomFloorId(room, h, this._floors),
      label: room.name || (room.area_id ? areaName(h, room.area_id) : ''),
    }));
    this._view.setStructure(this._floors, rooms, { wallHeight: Number(this._config.wall_height) || 1.0 });

    const withRooms = this._floors.filter((f) => rooms.some((r) => r.floorId === f.id));
    if (!this._floor || (this._floor !== 'all' && !this._floors.some((f) => f.id === this._floor))) {
      const wanted = this._config.floor;
      this._floor = wanted && (wanted === 'all' || this._floors.some((f) => f.id === wanted))
        ? wanted : (withRooms[0] || this._floors[0]).id;
    }
    this._view.setVisibleFloor(this._floor);
    this._empty.hidden = rooms.length > 0;
    this._empty.textContent = 'No rooms drawn yet. Open edit mode to draw rooms for your areas.';
    this._syncToolbar();
    if (this._view.size.w > 1) {
      this._fitted = true;
      this._view.fit();
    }
  }

  _buildMarkers() {
    const h = this._hass;
    this._markers = buildMarkers(h, this._layout, { group_by: this._config.group_by });
    this._positions = markerPositions(this._markers, this._layout, h, this._floors);
    this._markerEls.clear();
    const list = [];
    for (const m of this._markers) {
      const p = this._positions.get(m.id);
      if (!p) continue;
      const element = this._markerElement(m);
      this._markerEls.set(m.id, element);
      list.push({ id: m.id, element, ...p });
    }
    this._view.setMarkers(list);
  }

  _markerElement(m) {
    const el = document.createElement('div');
    el.className = 'fp-marker ' + m.domain;
    el.innerHTML = '<div class="fp-dot"><ha-icon></ha-icon></div><div class="fp-val"></div>';
    el.title = m.name;
    let start = null, timer = null, long = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      start = [e.clientX, e.clientY];
      long = false;
      timer = setTimeout(() => { long = true; this._moreInfo(m.entityId); }, LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', (e) => {
      if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) >= CLICK_SLOP_PX) cancel();
    });
    el.addEventListener('pointerup', (e) => {
      const wasClick = start && !long && timer && Math.hypot(e.clientX - start[0], e.clientY - start[1]) < CLICK_SLOP_PX;
      cancel();
      start = null;
      if (wasClick) this._tap(m);
    });
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  _refreshStates() {
    const h = this._hass;
    const glows = [];
    for (const m of this._markers) {
      const el = this._markerEls.get(m.id);
      if (!el) continue;
      const st = h.states[m.entityId];
      el.classList.toggle('active', isActive(st));
      el.classList.toggle('unavailable', !st || st.state === 'unavailable');
      const icon = el.querySelector('ha-icon');
      const ic = iconFor(h, m.entityId);
      if (icon.getAttribute('icon') !== ic) icon.setAttribute('icon', ic);
      const own = displayValue(h, m.entityId);
      el.querySelector('.fp-val').textContent = own || (m.secondaryId ? displayValue(h, m.secondaryId) : '');
      const name = st && st.attributes.friendly_name;
      el.title = m.name + (name && name !== m.name ? ' – ' + name : '');

      if (m.domain === 'light') {
        const g = lightGlow(st);
        el.style.setProperty('--fp-light', g && st.attributes.rgb_color ? `rgb(${g.rgb.join(',')})` : '');
        const p = this._positions.get(m.id);
        if (g && p) glows.push({ id: m.id, x: p.x, y: p.y, floorId: p.floorId, ...g });
      }
    }
    this._view.setGlows(glows);
  }

  _tap(m) {
    if (TAP_TOGGLE.has(m.domain)) {
      this._hass.callService(m.domain, 'toggle', { entity_id: m.entityId });
    } else {
      this._moreInfo(m.entityId);
    }
  }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  _setFloor(id) {
    this._floor = id;
    this._view.setVisibleFloor(id);
    this._view.fit();
    this._syncToolbar();
  }

  _setMode(mode) {
    this._mode = mode;
    this._view.setMode(mode);
    this._syncToolbar();
  }

  _syncToolbar() {
    const floors = this._floors || [];
    if (floors.length > 1) {
      const chips = [...floors.map((f) => [f.id, f.name]), ['all', 'All']];
      this._chips.innerHTML = '';
      for (const [id, name] of chips) {
        const btn = document.createElement('button');
        btn.className = 'chip' + (id === this._floor ? ' on' : '');
        btn.dataset.floor = id;
        btn.textContent = name;
        this._chips.append(btn);
      }
    } else {
      this._chips.innerHTML = '';
    }
    for (const btn of this.shadowRoot.querySelectorAll('.seg button')) btn.classList.toggle('on', btn.dataset.mode === this._mode);
  }
}

if (!customElements.get('floorplan3d-card')) {
  customElements.define('floorplan3d-card', Floorplan3dCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'floorplan3d-card',
    name: 'Floorplan 3D',
    description: '3D floorplan with automatically placed devices',
  });
  console.info(`%c floorplan3d-card ${VERSION} `, 'background:#03a9f4;color:#fff;border-radius:3px');
}
