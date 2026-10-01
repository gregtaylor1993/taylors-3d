// floorplan3d-card: Home Assistant Lovelace card showing a 3D floorplan with auto-placed devices.

import { Color } from 'three';
import { FloorplanView } from './view.js';
import { EditMode } from './edit-mode.js';
import './card-editor.js';
import { LayoutStore } from './storage.js';
import { buildMarkers, registrySignature, iconFor, isActive, displayValue, areaName } from './registry.js';
import { mergeFloors, roomFloorId, markerPositions, lightGlow, modelFloorMap } from './layout.js';
import { readSource, mowerTransform, overlayUrl } from './mower.js';

const VERSION = '0.1.4';
const TAP_TOGGLE = new Set(['light', 'switch', 'fan', 'input_boolean']);
const LONG_PRESS_MS = 500;
const CLICK_SLOP_PX = 5;
const TRAIL_STEP_M = 0.15;
const TRAIL_MAX = 3000;
const MOWER_Z = 0.15;
const MODEL_API = '/api/floorplan3d/model';

const STYLE = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; position: relative; container-type: inline-size;
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
  .empty[hidden], .notice[hidden] { display: none; }
  .notice { position: absolute; left: 8px; bottom: 8px; right: 8px; padding: 6px 10px; border-radius: 6px; font-size: 12px;
    background: var(--card-background-color, #fff); color: var(--error-color, #db4437);
    border: 1px solid var(--divider-color, rgba(0,0,0,.12)); pointer-events: none; }

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
  .body { display: flex; }
  .body .stage { flex: 1; min-width: 0; }
  .panel { display: none; width: 300px; flex: none; box-sizing: border-box; flex-direction: column; max-height: var(--fp-height);
    border-left: 1px solid var(--divider-color, rgba(0,0,0,.12)); font-size: 13px; }
  .editing .panel { display: flex; }
  /* narrow cards (e.g. a sections-view column): plan on top, panel below */
  @container (max-width: 640px) {
    .body.editing { flex-direction: column; }
    .body.editing .stage { flex: none; width: 100%; }
    .editing .panel { width: auto; max-height: 420px; border-left: none; border-top: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
  }
  .tabs { display: flex; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
  .panel .tabs button { flex: 1; border-radius: 0; font: inherit; padding: 10px 4px; background: none; border: none; cursor: pointer;
    color: var(--secondary-text-color); border-bottom: 2px solid transparent; }
  .panel .tabs button.on { color: var(--primary-color); border-bottom-color: var(--primary-color); }
  .tab-body { flex: 1; overflow: auto; padding: 4px 12px 12px; }
  .foot { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 11px;
    color: var(--secondary-text-color); border-top: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
  .panel h3 { margin: 4px 0 6px; font-size: 14px; font-weight: 500; }
  .panel .sub { margin: 14px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--secondary-text-color); }
  .panel .hint, .panel .dim { color: var(--secondary-text-color); }
  .panel .hint { font-size: 12px; line-height: 1.4; }
  .panel p { margin: 6px 0; }
  .panel .box { border: 1px solid var(--divider-color, rgba(0,0,0,.12)); border-radius: 8px; padding: 8px 10px;
    margin: 8px 0; }
  .panel label { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; font-size: 12px;
    color: var(--secondary-text-color); }
  .panel label.check { flex-direction: row; align-items: center; gap: 6px; color: var(--primary-text-color); }
  .panel select, .panel input[type=number] { font: inherit; padding: 5px 6px; border-radius: 6px;
    border: 1px solid var(--divider-color, rgba(0,0,0,.2)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); min-width: 0; }
  .panel button, .panel label.button { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color, rgba(0,0,0,.2)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); display: inline-block; margin: 0; }
  .panel button:disabled { opacity: .45; cursor: default; }
  .panel button.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .panel button.danger { color: var(--error-color, #db4437); }
  .panel button.link { border: none; background: none; padding: 0 2px; color: var(--primary-color); }
  .panel .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .panel ul { list-style: none; margin: 0; padding: 0; }
  .panel ul.list li { display: flex; align-items: center; gap: 6px; padding: 4px 0;
    border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.06)); }
  .panel ul.list li.sel .name { color: var(--primary-color); font-weight: 500; }
  .panel .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel .pill { font-size: 10.5px; padding: 1px 7px; border-radius: 9px; }
  .panel .pill.ok { background: rgba(76,175,80,.16); color: var(--success-color, #43a047); }
  .panel .pill.missing { background: rgba(255,152,0,.16); color: var(--warning-color, #ef8a00); }
  .panel table.floors { width: 100%; border-collapse: collapse; font-size: 12px; }
  .panel table.floors th { font-weight: normal; color: var(--secondary-text-color); text-align: left; font-size: 11px; }
  .panel table.floors td { padding: 2px 3px 2px 0; }
  .panel table.floors input { width: 64px; }
  .panel .note { padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.4; }
  .panel .note.ok { background: rgba(76,175,80,.12); }
  .panel .note.warn { background: rgba(255,152,0,.14); }
  .panel .msg { margin: 8px 0; padding: 6px 10px; border-radius: 6px; background: rgba(76,175,80,.12); font-size: 12px; }
  .panel .msg.error { background: rgba(219,68,55,.14); color: var(--error-color, #db4437); }
  button.edit { font: inherit; font-size: 13px; line-height: 1; cursor: pointer; padding: 6px 10px; border-radius: 16px;
    border: 1px solid var(--divider-color, rgba(0,0,0,.12)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); display: flex; align-items: center; gap: 4px; --mdc-icon-size: 16px; }
  button.edit[hidden] { display: none; }
  .editing button.edit { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }

  .fp-handle { box-sizing: border-box; width: 13px; height: 13px; border-radius: 50%; pointer-events: auto; cursor: grab;
    background: var(--card-background-color, #fff); border: 2px solid var(--primary-color, #03a9f4); touch-action: none; }
  .fp-handle.mid { width: 9px; height: 9px; opacity: .75; border-width: 1.5px; }
  .fp-handle.door { width: 11px; height: 11px; border-radius: 2px; background: var(--primary-color, #03a9f4);
    pointer-events: none; }
  .fp-handle.draw { pointer-events: none; width: 9px; height: 9px; }
  .fp-handle.draw.first { width: 15px; height: 15px; background: var(--primary-color, #03a9f4); }
  .fp-handle.cursor { pointer-events: none; width: 7px; height: 7px; border: none; background: var(--primary-color, #03a9f4); }
  .fp-handle.cursor.vertex { width: 15px; height: 15px; background: none; border: 2px solid var(--primary-color, #03a9f4); }
  .fp-handle.cursor.align { width: 9px; height: 9px; }
  .editing .fp-marker { cursor: grab; }
  .stage.drawing { cursor: crosshair; }
  .stage.drawing .fp-marker { pointer-events: none; opacity: .4; }
  .stage.drawing .fp-handle { pointer-events: none; }
  .stage.moving { cursor: move; }
  .stage.moving .fp-marker, .stage.moving .fp-handle { pointer-events: none; }
  .panel input[type=range] { width: 100%; margin: 0; accent-color: var(--primary-color); }
  .panel label .lab { display: flex; justify-content: space-between; }
  .panel label .val { color: var(--primary-text-color); }
  .panel label.button.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .panel label.button.disabled { opacity: .6; pointer-events: none; }
  .panel .bad { color: var(--error-color, #db4437); }
  .panel code { font-size: 11px; }
  .panel .tabs button { padding: 10px 2px; font-size: 12.5px; }
  .panel input:not([type]), .panel input[list] { font: inherit; padding: 5px 6px; border-radius: 6px;
    border: 1px solid var(--divider-color, rgba(0,0,0,.2)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); min-width: 0; }
  .panel .row label { flex: 1; }
  .fp-marker.selected .fp-dot { outline: 3px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
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
    return {};
  }

  // sections view: span the whole section by default
  getGridOptions() {
    return { columns: 'full', min_columns: 6, rows: 'auto' };
  }

  static getConfigElement() {
    return document.createElement('floorplan3d-card-editor');
  }

  setConfig(config) {
    this._config = { layout_key: 'default', height: '520px', group_by: 'device', wall_height: 1.0, view: '3d', ...config };
    this._mode = this._config.view === 'top' ? 'top' : '3d';
    this._store = new LayoutStore(this._config.layout_key);
    if (this._stage) {
      this._stage.style.height = this._config.height;
      this._body.style.setProperty('--fp-height', this._config.height);
    }
    if (this.isConnected && !this._view) this.connectedCallback();
    else if (this._view) this._loadModel();
  }

  // model: from YAML (model: url) if set, else the one uploaded to the integration (layout.model)
  _loadModel() {
    const c = this._config;
    let opts = null;
    if (c.model) {
      opts = {
        url: String(c.model),
        position: Array.isArray(c.model_position) ? c.model_position.map(Number) : [0, 0, 0],
        rotation: Number(c.model_rotation) || 0, scale: Number(c.model_scale) || 1,
        opacity: c.model_opacity === undefined ? 1 : Number(c.model_opacity),
      };
    } else {
      const m = this._layout && this._layout.model;
      if (m && m.version && this._hass && this._hass.fetchWithAuth) {
        const url = `${MODEL_API}/${encodeURIComponent(c.layout_key)}?v=${m.version}`;
        opts = {
          id: m.version, name: m.name,
          data: async () => {
            const r = await this._hass.fetchWithAuth(url);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
          },
          position: m.position || [0, 0, 0], rotation: m.rotation || 0, scale: m.scale || 1, opacity: m.opacity ?? 1,
        };
      }
    }
    const firstLoad = opts && !this._view.model;
    this._applyModelFloorMap();
    this._view.setModel(opts).then((err) => {
      this._notice.textContent = err || '';
      this._notice.hidden = !err;
      this._applyModelFloorMap();
      // nothing drawn yet: show the model instead of an empty plan
      if (!err && firstLoad && this._view.model && !(this._layout && this._layout.rooms && this._layout.rooms.length)) this._view.fit();
      if (this._editing) this._edit.onModelLoaded();
    });
  }

  // group -> floor assignment: saved choices (layout.model.floor_map or YAML model_floors),
  // else automatic
  modelFloorAssignment() {
    const groups = this._view.modelFloorGroups();
    if (!groups || !this._floors) return null;
    const saved = this._config.model ? this._config.model_floors : this._layout && this._layout.model && this._layout.model.floor_map;
    return modelFloorMap(groups, this._floors, saved || {});
  }

  _applyModelFloorMap() {
    const map = this.modelFloorAssignment();
    if (map) this._view.setModelFloorMap(map);
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
    this._setCameraTimer(0);
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
        <div class="body">
          <div class="stage">
            <div class="toolbar">
              <div class="chips"></div>
              <div class="seg"><button data-mode="3d">3D</button><button data-mode="top">Top</button></div>
              <button class="edit" hidden title="Edit floorplan"><ha-icon icon="mdi:pencil"></ha-icon><span>Edit</span></button>
            </div>
            <div class="empty" hidden></div>
            <div class="notice" hidden></div>
          </div>
        </div>
      </ha-card>`;
    this._stage = root.querySelector('.stage');
    this._stage.style.height = this._config.height;
    root.querySelector('.body').style.setProperty('--fp-height', this._config.height);
    this._chips = root.querySelector('.chips');
    this._empty = root.querySelector('.empty');
    this._notice = root.querySelector('.notice');
    root.querySelector('.seg').addEventListener('click', (e) => {
      const mode = e.target.dataset && e.target.dataset.mode;
      if (mode) this._setMode(mode);
    });
    this._chips.addEventListener('click', (e) => {
      const id = e.target.dataset && e.target.dataset.floor;
      if (id) this._setFloor(id);
    });
    this._body = root.querySelector('.body');
    this._editBtn = root.querySelector('button.edit');
    this._editBtn.addEventListener('click', () => this._toggleEdit());
    this._view = new FloorplanView(this._stage);
    this._view.setMode(this._mode);
    this._loadModel();
    this._edit = new EditMode(this);
    this._body.append(this._edit.panel);
    const canvas = this._view.renderer.domElement;
    this._stage.addEventListener('pointerdown', (e) => {
      if (this._editing && e.target === canvas) this._edit.canvasDownCapture(e);
    }, true);
    canvas.addEventListener('pointerdown', (e) => this._editing && this._edit.canvasDown(e));
    canvas.addEventListener('pointermove', (e) => this._editing && this._edit.canvasMove(e));
    canvas.addEventListener('pointerup', (e) => this._editing && this._edit.canvasUp(e));
    this._syncToolbar();
  }

  _toggleEdit() {
    this._editing = !this._editing;
    this._body.classList.toggle('editing', this._editing);
    if (this._editing) {
      if (this._floor === 'all') this._setFloor(this._floors[0].id);
      this._edit.enter();
    } else {
      this._edit.exit();
    }
    this._syncToolbar();
    // the panel changes the canvas size: reframe once the layout has settled
    requestAnimationFrame(() => {
      this._resize();
      this._view.fit();
    });
  }

  // Apply an edited layout: rebuild the plan and save it.
  _commit(layout) {
    this._layout = layout;
    const seq = (this._saveSeq = (this._saveSeq || 0) + 1);
    this._edit.setSaveState('saving');
    this._store.save(this._hass, layout).then((ok) => {
      if (seq === this._saveSeq) this._edit.setSaveState(ok ? 'saved' : 'failed');
    });
    this._schedule();
  }

  _applyMarkerSelection(id) {
    for (const [mid, el] of this._markerEls) el.classList.toggle('selected', mid === id);
  }

  _resize() {
    const r = this._stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this._view.resize(r.width, r.height);
    if (!this._fitted && this._built.rooms) {
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

  // Rebuild only what changed. Edits replace just the layout parts they touch, so identity
  // comparisons per part keep e.g. overlay slider changes from rebuilding the whole scene.
  _update() {
    const h = this._hass;
    const b = this._built;
    const l = this._layout;
    let structure = false, markers = false, mower = false;

    if (h.themes !== b.themes || !b.theme) {
      b.themes = h.themes;
      this._applyTheme();
      structure = true;
    }
    if (structure || l.rooms !== b.rooms || l.floors !== b.lfloors || h.floors !== b.floors || h.areas !== b.areas) {
      this._buildStructure();
      markers = true;
    }
    const sig = registrySignature(h);
    const m = l.mower || null;
    const mowerKey = m ? `${m.entity}|${m.floor_id}` : '';
    if (markers || !b.sig || sig.some((x, i) => x !== b.sig[i]) || l.pins !== b.pins || l.hidden !== b.hidden || mowerKey !== b.mowerKey) {
      b.sig = sig;
      b.pins = l.pins;
      b.hidden = l.hidden;
      b.mowerKey = mowerKey;
      this._buildMarkers();
      markers = true;
    }
    if (l.model !== b.model) {
      b.model = l.model;
      this._loadModel();
    } else if (markers) {
      this._applyModelFloorMap(); // floors may have changed
    }
    if (m !== b.mower) {
      b.mower = m;
      this._mowerFn = m && m.entity ? mowerTransform(m) : null;
      mower = true;
    }
    if (h.states !== b.states || markers || mower) {
      b.states = h.states;
      this._refreshStates();
      this._refreshMower(mower);
    }
    if (markers && this._editing) this._edit.afterUpdate();
    else if (this._editing) this._edit.onStates();
  }

  _mowerFloor() {
    const m = this._layout.mower;
    return m && this._floors.some((f) => f.id === m.floor_id) ? m.floor_id : this._floors[0].id;
  }

  // Live mower: move its marker, extend the trail, refresh the map overlay.
  _refreshMower(configChanged) {
    const cfg = this._layout.mower;
    if (!cfg || !cfg.entity) {
      this._trail = [];
      this._mowerLive = null;
      this._view.setTrail(null);
      this._view.setMapOverlay(null);
      this._setCameraTimer(0);
      return;
    }
    const floorId = this._mowerFloor();
    const reading = readSource(this._hass.states[cfg.entity], cfg);
    const p = reading && this._mowerFn ? this._mowerFn(reading) : null;
    this._mowerLive = p ? { x: p[0], y: p[1], floorId, reading } : (reading ? { reading } : null);
    const id = this._mowerMarkerId;
    if (p && id) {
      const pos = { x: p[0], y: p[1], z: MOWER_Z, floorId, auto: false, live: true };
      this._positions.set(id, pos);
      if (!this._view.markerObjects.has(id)) {
        this._buildMarkers();
        this._refreshStates();
      } else {
        this._view.moveMarker(id, pos.x, pos.y, pos.z, floorId);
      }
    }
    if (configChanged) this._trail = [];
    if (cfg.trail !== false) {
      const t = (this._trail = this._trail || []);
      const last = t[t.length - 1];
      if (p && (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= TRAIL_STEP_M)) {
        t.push(p);
        if (t.length > TRAIL_MAX) t.splice(0, t.length - TRAIL_MAX);
        this._view.setTrail(t, floorId);
      } else if (configChanged) {
        this._view.setTrail(t, floorId);
      }
    } else {
      this._view.setTrail(null);
    }
    this._refreshMapOverlay();
  }

  clearTrail() {
    this._trail = [];
    this._view.setTrail(null);
  }

  _refreshMapOverlay() {
    const cfg = this._layout.mower;
    const o = cfg && cfg.overlay;
    const st = o && o.entity && this._hass.states[o.entity];
    if (!st) {
      this._view.setMapOverlay(null);
      this._setCameraTimer(0);
      return;
    }
    const camera = o.entity.startsWith('camera.');
    this._setCameraTimer(camera ? Math.max(1, Number(o.refresh) || 10) : 0);
    // image entities change their state when the picture changes; cameras are polled
    const bust = camera ? this._cameraTick || 1 : st.last_updated || st.state;
    this._view.setMapOverlay({
      url: overlayUrl(this._hass, o.entity, bust),
      x: o.x, y: o.y, rotation: o.rotation, width: o.width, opacity: o.opacity,
      floorId: this._mowerFloor(),
    });
  }

  _setCameraTimer(seconds) {
    if (this._cameraTimerSec === seconds) return;
    clearInterval(this._cameraTimer);
    this._cameraTimerSec = seconds;
    this._cameraTimer = seconds && this.isConnected ? setInterval(() => {
      this._cameraTick = Date.now();
      this._refreshMapOverlay();
    }, seconds * 1000) : null;
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
      primary: cssColor(this, '--primary-color', '#03a9f4'),
    };
    this._view.setTheme(this._built.theme);
  }

  _buildStructure() {
    const h = this._hass, b = this._built;
    b.rooms = this._layout.rooms;
    b.lfloors = this._layout.floors;
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
    this._empty.hidden = rooms.length > 0 || !!this._editing;
    this._empty.textContent = 'No rooms drawn yet. Open edit mode to draw rooms for your areas.';
    this._syncToolbar();
    // frame once; later rebuilds (edits, registry changes) keep the user's camera
    if (!this._fitted && this._view.size.w > 1) {
      this._fitted = true;
      this._view.fit();
    }
  }

  _buildMarkers() {
    const h = this._hass;
    this._markers = buildMarkers(h, this._layout, { group_by: this._config.group_by });
    this._positions = markerPositions(this._markers, this._layout, h, this._floors);

    // the mower's device marker follows the live position instead of being auto placed
    const cfg = this._layout.mower;
    this._mowerMarkerId = null;
    if (cfg && cfg.entity) {
      const reg = h.entities && h.entities[cfg.entity];
      const devId = reg && reg.device_id;
      let mm = this._markers.find((m) => (devId ? m.deviceId === devId : m.entityId === cfg.entity));
      if (!mm) {
        const st = h.states[cfg.entity];
        mm = { id: 'mower:' + cfg.entity, entityId: cfg.entity, domain: cfg.entity.split('.')[0],
          name: (st && st.attributes.friendly_name) || cfg.entity, entities: [], secondaryId: null };
        this._markers.push(mm);
      }
      this._mowerMarkerId = mm.id;
      const live = this._mowerLive;
      if (live && live.floorId) this._positions.set(mm.id, { x: live.x, y: live.y, z: MOWER_Z, floorId: live.floorId, auto: false, live: true });
      else this._positions.delete(mm.id);
    }

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
      if (this._editing) {
        this._edit.markerDown(m, e);
        return;
      }
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
      const ic = m.id === this._mowerMarkerId ? 'mdi:robot-mower' : iconFor(h, m.entityId);
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
      // editing works on one floor at a time
      const chips = [...floors.map((f) => [f.id, f.name]), ...(this._editing ? [] : [['all', 'All']])];
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
    this._editBtn.hidden = !(this._hass && this._hass.user && this._hass.user.is_admin);
    this._editBtn.querySelector('span').textContent = this._editing ? 'Done' : 'Edit';
    if (this._empty && this._editing) this._empty.hidden = true;
  }
}

if (!customElements.get('floorplan3d-card')) {
  customElements.define('floorplan3d-card', Floorplan3dCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'floorplan3d-card',
    name: 'Floorplan 3D',
    description: '3D floorplan with automatically placed devices',
    preview: false,
  });
  console.info(`%c floorplan3d-card ${VERSION} `, 'background:#03a9f4;color:#fff;border-radius:3px');
}
