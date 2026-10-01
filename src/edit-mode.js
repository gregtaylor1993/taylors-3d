// Edit mode: side panel (Rooms / Devices / Mower / Data) and the pointer interactions on the
// plan (drawing rooms, dragging corners, adding doors, dragging markers to pin them).

import * as E from './editor.js';
import { roomFloorId } from './layout.js';
import { pointInPolygon, signedArea } from './placement.js';
import { buildMarkers, areaName } from './registry.js';
import { readSource, calibrationError } from './mower.js';

const CLICK_SLOP_PX = 5;
const SNAP_PX = 10; // snap radius never smaller than this many screen pixels

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (Math.round(v * 100) / 100).toString();

export class EditMode {
  constructor(card) {
    this.card = card;
    this.tab = 'rooms';
    this.selectedRoom = null;
    this.selectedMarker = null;
    this.drawing = null; // { areaId, floorId, points, cursor }
    this.doorMode = false;
    this.calibrating = null; // { src } waiting for a click on the plan
    this.overlayMove = false;
    this.drag = null;
    this.confirmDelete = false;
    this.saveState = '';
    this.message = null; // { text, error }
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.panel.addEventListener('click', (e) => this._onPanelClick(e));
    this.panel.addEventListener('change', (e) => this._onPanelChange(e));
    this.panel.addEventListener('input', (e) => this._onPanelInput(e));
    this._onKey = (e) => this._onKeyDown(e);
    this._onWinMove = (e) => this._dragMove(e);
    this._onWinUp = (e) => this._dragEnd(e);
    this._handles = new Map();
  }

  get layout() { return this.card._layout; }
  get hass() { return this.card._hass; }
  get view() { return this.card._view; }
  get floors() { return this.card._floors || []; }

  activeFloor() {
    const f = this.card._floor;
    return !f || f === 'all' ? this.floors[0].id : f;
  }

  floorOf(room) {
    return roomFloorId(room, this.hass, this.floors);
  }

  room(id) {
    return (this.layout.rooms || []).find((r) => r.id === id) || null;
  }

  snapRadius() {
    return Math.max(E.SNAP_RADIUS, SNAP_PX / Math.max(this.view.pixelsPerMetre(), 1e-6));
  }

  enter() {
    window.addEventListener('keydown', this._onKey);
    this.render();
    this.refreshOverlay();
  }

  exit() {
    window.removeEventListener('keydown', this._onKey);
    this._endWindowDrag();
    this.drawing = null;
    this.doorMode = false;
    this.calibrating = null;
    this.overlayMove = false;
    this.selectedRoom = null;
    this.selectedMarker = null;
    this.view.setOverlay({});
    this._syncStageClasses();
    this.card._applyMarkerSelection(null);
  }

  // called by the card after every rebuild
  afterUpdate() {
    if (this.selectedRoom && !this.room(this.selectedRoom)) this.selectedRoom = null;
    this.card._applyMarkerSelection(this.selectedMarker);
    this.refreshOverlay();
    this.render();
  }

  commit(layout) {
    this.card._commit(layout);
  }

  setSaveState(s) {
    this.saveState = s;
    const el = this.panel.querySelector('.save-state');
    if (el) el.textContent = this._saveText();
    else this.render();
  }

  // ---------- plan pointer events (from the card's canvas listeners) ----------
  canvasDown(e) {
    this._down = e.button === 0 ? [e.clientX, e.clientY] : null;
  }

  canvasMove(e) {
    if (!this.drawing) return;
    const p = this._planPoint(e, this.drawing.floorId);
    if (!p) return;
    this.drawing.cursor = this._snapDraw(p);
    this.refreshOverlay();
  }

  canvasUp(e) {
    const d = this._down;
    this._down = null;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) >= CLICK_SLOP_PX) return;
    this._click(e);
  }

  _planPoint(e, floorId, z = 0) {
    return this.view.planPoint(e.clientX, e.clientY, this.view.floorElevation(floorId) + z);
  }

  _click(e) {
    if (this.calibrating) {
      const p = this._planPoint(e, this.card._mowerFloor());
      if (!p) return;
      const plan = E.snapPoint(p, { radius: 0 }).point;
      const { src } = this.calibrating;
      this.calibrating = null;
      this.setMower({ calibration: [...(this.mower().calibration || []), { src, plan }] });
      return;
    }
    const fid = this.drawing ? this.drawing.floorId : this.activeFloor();
    const p = this._planPoint(e, fid);
    if (!p) return;
    if (this.drawing) {
      this._addDrawPoint(p);
      return;
    }
    const sel = this.room(this.selectedRoom);
    if (this.doorMode && sel) {
      const next = E.addDoor(sel, p, Math.max(0.6, this.snapRadius()));
      if (next !== sel) {
        this.doorMode = false;
        this.commit(E.upsertRoom(this.layout, next));
      }
      return;
    }
    // pick the smallest room under the click, so a room wins over the garden around it
    const hits = (this.layout.rooms || [])
      .filter((r) => this.floorOf(r) === fid && r.polygon && pointInPolygon(p, r.polygon))
      .sort((a, b) => Math.abs(signedArea(a.polygon)) - Math.abs(signedArea(b.polygon)));
    this.selectRoom(hits.length ? hits[0].id : null);
  }

  selectRoom(id) {
    this.selectedRoom = id;
    this.selectedMarker = null;
    this.doorMode = false;
    this.confirmDelete = false;
    if (id) this.tab = 'rooms';
    this.card._applyMarkerSelection(null);
    this.refreshOverlay();
    this.render();
  }

  selectMarker(id) {
    this.selectedMarker = id;
    this.selectedRoom = null;
    this.doorMode = false;
    if (id) this.tab = 'devices';
    this.card._applyMarkerSelection(id);
    this.refreshOverlay();
    this.render();
  }

  // ---------- drawing ----------
  startDrawing(areaId) {
    const area = this.hass.areas && this.hass.areas[areaId];
    let floorId = this.card._floor;
    if (!floorId || floorId === 'all') {
      floorId = area && this.floors.some((f) => f.id === area.floor_id) ? area.floor_id : this.floors[0].id;
    }
    if (floorId !== this.card._floor) this.card._setFloor(floorId);
    if (this.card._mode !== 'top') this.card._setMode('top');
    this.selectedRoom = null;
    this.selectedMarker = null;
    this.card._applyMarkerSelection(null);
    this.drawing = { areaId, floorId, points: [], cursor: null };
    this.tab = 'rooms';
    this._syncStageClasses();
    this.refreshOverlay();
    this.render();
  }

  _snapDraw(p) {
    const vertices = [
      ...E.floorVertices(this.layout.rooms || [], (r) => this.floorOf(r), this.drawing.floorId),
      ...this.drawing.points,
    ];
    return E.snapPoint(p, { vertices, radius: this.snapRadius() });
  }

  _addDrawPoint(p) {
    const d = this.drawing;
    const s = this._snapDraw(p).point;
    const first = d.points[0];
    if (d.points.length >= 3 && Math.hypot(s[0] - first[0], s[1] - first[1]) <= this.snapRadius()) {
      this.finishDrawing();
      return;
    }
    d.points.push(s);
    this.refreshOverlay();
    this.render();
  }

  finishDrawing() {
    const d = this.drawing;
    if (!d) return;
    const polygon = E.cleanPolygon(d.points);
    if (polygon.length < 3) return;
    const area = this.hass.areas && this.hass.areas[d.areaId];
    const room = { id: E.newRoomId(this.layout), area_id: d.areaId, polygon, doors: [], outdoor: false };
    // only store the floor when it differs from the area's, so HA floor changes follow through
    if (!area || area.floor_id !== d.floorId) room.floor_id = d.floorId;
    this.drawing = null;
    this._syncStageClasses();
    this.selectedRoom = room.id;
    this.commit(E.upsertRoom(this.layout, room));
  }

  cancelDrawing() {
    this.drawing = null;
    this._syncStageClasses();
    this.refreshOverlay();
    this.render();
  }

  _onKeyDown(e) {
    const target = e.composedPath()[0];
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (this.drawing) {
      if (e.key === 'Enter') this.finishDrawing();
      else if (e.key === 'Escape') this.cancelDrawing();
      else if (e.key === 'Backspace') {
        this.drawing.points.pop();
        this.refreshOverlay();
        this.render();
      } else return;
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (this.doorMode) this.doorMode = false;
      else if (this.selectedRoom) this.selectedRoom = null;
      else if (this.selectedMarker) this.selectMarker(null);
      this._syncStageClasses();
      this.refreshOverlay();
      this.render();
    }
  }

  _syncStageClasses() {
    this.card._stage.classList.toggle('drawing', !!this.drawing || this.doorMode || !!this.calibrating);
    this.card._stage.classList.toggle('moving', this.overlayMove);
  }

  // Overlay move tool: grab the pointer before OrbitControls sees it (capture phase on the stage).
  canvasDownCapture(e) {
    const o = this.mower().overlay;
    if (!this.overlayMove || !o || e.button !== 0) return;
    e.stopPropagation();
    const fid = this.card._mowerFloor();
    const start = this._planPoint(e, fid);
    if (!start) return;
    this._startWindowDrag({ kind: 'overlay', start: [e.clientX, e.clientY], plan: start, origin: [o.x || 0, o.y || 0], floorId: fid, moved: false });
  }

  // ---------- mower ----------
  mower() {
    return this.layout.mower || {};
  }

  setMower(patch) {
    const cur = this.layout.mower || { entity: '', source: 'gps', x_attr: 'x', y_attr: 'y', floor_id: this.floors[0].id, calibration: [], overlay: null, trail: true };
    this.commit({ ...this.layout, mower: { ...cur, ...patch } });
    this.render();
  }

  setOverlay(patch, rerender = true) {
    const m = this.mower();
    const cur = m.overlay || { entity: '', x: 0, y: 0, rotation: 0, width: 20, opacity: 0.6, refresh: 10 };
    const overlay = { ...cur, ...patch };
    this.card._commit({ ...this.layout, mower: { ...m, overlay } });
    if (rerender) this.render();
  }

  // live values in the Mower tab, without re-rendering the panel
  onStates() {
    if (this.tab !== 'mower') return;
    const el = this.panel.querySelector('.mower-live');
    if (el) el.innerHTML = this._mowerLiveHtml();
  }

  _mowerLiveHtml() {
    const m = this.mower();
    const st = m.entity && this.hass.states[m.entity];
    if (!m.entity) return 'Pick the entity that reports the mower position.';
    if (!st) return `Entity <b>${esc(m.entity)}</b> not found.`;
    const r = readSource(st, m);
    if (!r) return m.source === 'xy'
      ? `No numeric <b>${esc(m.x_attr || 'x')}</b> / <b>${esc(m.y_attr || 'y')}</b> attributes on ${esc(m.entity)}.`
      : `No latitude/longitude on ${esc(m.entity)} (state: ${esc(st.state)}).`;
    const live = this.card._mowerLive;
    const raw = r.raw.map((v) => (m.source === 'xy' ? fmt(v) : v.toFixed(6))).join(', ');
    const plan = live && live.floorId ? `on plan (${fmt(live.x)}, ${fmt(live.y)})` : 'not on the plan yet: add a calibration point';
    return `Reading ${raw}<br>${plan}`;
  }

  // ---------- overlay ----------
  _handle(key, cls) {
    let el = this._handles.get(key);
    if (!el) {
      el = document.createElement('div');
      this._handles.set(key, el);
    }
    el.className = 'fp-handle ' + cls;
    return el;
  }

  refreshOverlay(preview) {
    if (!this.view) return;
    this._syncStageClasses();
    const color = this.card._built.theme ? this.card._built.theme.primary : 0x03a9f4;
    const lines = [], fills = [], handles = [];
    const used = new Set();
    const handle = (key, cls, x, y, floorId, setup) => {
      const el = this._handle(key, cls);
      used.add(key);
      el.onpointerdown = setup ? (e) => setup(e, el) : null;
      el.oncontextmenu = null;
      handles.push({ element: el, x, y, floorId });
      return el;
    };

    const room = preview || this.room(this.selectedRoom);
    if (room && room.polygon) {
      const fid = this.floorOf(room);
      fills.push({ points: room.polygon, floorId: fid, color, opacity: 0.16 });
      lines.push({ points: room.polygon, closed: true, floorId: fid, color });
      room.polygon.forEach(([x, y], i) => {
        const el = handle('v' + i, 'vertex', x, y, fid, (e, h) => this._vertexDown(e, room.id, i, h));
        el.title = 'Drag to move, right-click to delete';
        el.oncontextmenu = (e) => {
          e.preventDefault();
          const r = this.room(room.id);
          if (r) this.commit(E.upsertRoom(this.layout, E.removeVertex(r, i)));
        };
      });
      if (!this.drag) {
        room.polygon.forEach((a, i) => {
          const b = room.polygon[(i + 1) % room.polygon.length];
          const el = handle('m' + i, 'mid', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, fid, (e, h) => this._midDown(e, room.id, i, h));
          el.title = 'Drag to add a corner';
        });
      }
      (room.doors || []).forEach(([x, y], i) => handle('d' + i, 'door', x, y, fid));
    }

    const d = this.drawing;
    if (d) {
      const pts = d.cursor ? [...d.points, d.cursor.point] : d.points;
      lines.push({ points: pts, closed: false, floorId: d.floorId, color });
      d.points.forEach(([x, y], i) => handle('p' + i, i === 0 && d.points.length >= 3 ? 'draw first' : 'draw', x, y, d.floorId));
      if (d.cursor) handle('cursor', 'cursor ' + d.cursor.kind, d.cursor.point[0], d.cursor.point[1], d.floorId);
    }

    for (const k of [...this._handles.keys()]) if (!used.has(k)) this._handles.delete(k);
    this.view.setOverlay({ lines, fills, handles });
  }

  // ---------- drags (corners, midpoints, markers) ----------
  _startWindowDrag(drag) {
    this.drag = drag;
    this.view.setControlsEnabled(false);
    window.addEventListener('pointermove', this._onWinMove);
    window.addEventListener('pointerup', this._onWinUp);
    window.addEventListener('pointercancel', this._onWinUp);
  }

  _endWindowDrag() {
    window.removeEventListener('pointermove', this._onWinMove);
    window.removeEventListener('pointerup', this._onWinUp);
    window.removeEventListener('pointercancel', this._onWinUp);
    if (this.view) this.view.setControlsEnabled(true);
    this.drag = null;
  }

  _vertexDown(e, roomId, index) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    this._startWindowDrag({ kind: 'vertex', roomId, index, start: [e.clientX, e.clientY], moved: false });
  }

  _midDown(e, roomId, edge) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    this._startWindowDrag({ kind: 'mid', roomId, edge, start: [e.clientX, e.clientY], moved: false });
  }

  markerDown(m, e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (this.drawing || this.doorMode || this.calibrating) return;
    if (m.id === this.card._mowerMarkerId) {
      this.selectMarker(m.id); // positioned live, nothing to drag
      return;
    }
    const pos = this.card._positions && this.card._positions.get(m.id);
    this.selectMarker(m.id);
    if (!pos) return;
    this._startWindowDrag({ kind: 'marker', id: m.id, pos: { ...pos }, start: [e.clientX, e.clientY], moved: false });
  }

  _dragMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) < CLICK_SLOP_PX) return;
    d.moved = true;
    if (d.kind === 'overlay') {
      const p = this._planPoint(e, d.floorId);
      if (!p) return;
      const r = (v) => Math.round(v * 100) / 100;
      this.setOverlay({ x: r(d.origin[0] + p[0] - d.plan[0]), y: r(d.origin[1] + p[1] - d.plan[1]) }, false);
      return;
    }
    if (d.kind === 'marker') {
      const p = this._planPoint(e, d.pos.floorId, d.pos.z);
      if (!p) return;
      d.pos.x = p[0];
      d.pos.y = p[1];
      this.view.moveMarker(d.id, p[0], p[1], d.pos.z, d.pos.floorId);
      return;
    }
    let room = this.room(d.roomId);
    if (!room) return;
    if (d.kind === 'mid') {
      // first move of a midpoint handle inserts the corner, then it is a normal corner drag
      const a = room.polygon[d.edge], b = room.polygon[(d.edge + 1) % room.polygon.length];
      d.base = E.insertVertex(room, d.edge, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      d.kind = 'vertex';
      d.index = d.edge + 1;
    }
    room = d.base || room;
    const fid = this.floorOf(room);
    const p = this._planPoint(e, fid);
    if (!p) return;
    const otherRooms = (this.layout.rooms || []).filter((r) => r.id !== room.id);
    const others = E.floorVertices(otherRooms, (r) => this.floorOf(r), fid)
      .concat(room.polygon.filter((_, i) => i !== d.index));
    const s = E.snapPoint(p, { vertices: others, radius: this.snapRadius() }).point;
    d.preview = E.moveVertex(room, d.index, s);
    this.refreshOverlay(d.preview);
  }

  _dragEnd() {
    const d = this.drag;
    this._endWindowDrag();
    if (!d || !d.moved) {
      if (d && d.kind !== 'marker') this.refreshOverlay();
      return;
    }
    if (d.kind === 'overlay') {
      this.render();
    } else if (d.kind === 'marker') {
      this.commit(E.setPin(this.layout, d.id, { x: d.pos.x, y: d.pos.y, z: d.pos.z, floor_id: d.pos.floorId }));
    } else if (d.preview) {
      this.commit(E.upsertRoom(this.layout, d.preview));
    } else {
      this.refreshOverlay();
    }
  }

  // ---------- panel ----------
  _saveText() {
    return { saving: 'Saving…', saved: 'Saved', failed: 'Save failed' }[this.saveState] || '';
  }

  render() {
    const tabs = [['rooms', 'Rooms'], ['devices', 'Devices'], ['mower', 'Mower'], ['data', 'Data']];
    const body = { rooms: () => this._roomsTab(), devices: () => this._devicesTab(), mower: () => this._mowerTab(), data: () => this._dataTab() }[this.tab]();
    const msg = this.message ? `<div class="msg ${this.message.error ? 'error' : ''}">${esc(this.message.text)}</div>` : '';
    this.panel.innerHTML = `
      <div class="tabs">${tabs.map(([id, label]) => `<button data-act="tab" data-id="${id}" class="${this.tab === id ? 'on' : ''}">${label}</button>`).join('')}</div>
      <div class="tab-body">${msg}${body}</div>
      <div class="foot"><span class="save-state">${this._saveText()}</span><span>${esc(this._backendLabel())}</span></div>`;
  }

  _backendLabel() {
    return { shared: 'Shared storage', user: 'Per-user storage', browser: 'Browser storage' }[this.card._store.backend] || '';
  }

  _areas() {
    const areas = Object.values(this.hass.areas || {});
    return areas.sort((a, b) => a.name.localeCompare(b.name));
  }

  _roomsTab() {
    const d = this.drawing;
    if (d) {
      return `<section class="box">
        <h3>Drawing: ${esc(areaName(this.hass, d.areaId))}</h3>
        <p class="hint">Click the corners on the plan. Points snap to 5 cm and to existing corners, so shared walls line up.
        Click the first point or press Enter to finish, Backspace removes the last point, Esc cancels.</p>
        <p>${d.points.length} point${d.points.length === 1 ? '' : 's'}</p>
        <div class="row"><button data-act="finish" ${d.points.length < 3 ? 'disabled' : ''} class="primary">Finish</button>
        <button data-act="undo-point" ${d.points.length ? '' : 'disabled'}>Undo point</button>
        <button data-act="cancel-draw">Cancel</button></div></section>`;
    }
    const sel = this.room(this.selectedRoom);
    const rooms = this.layout.rooms || [];
    const areas = this._areas();
    let out = '';
    if (sel) {
      const areaOpts = areas.map((a) => `<option value="${esc(a.area_id)}" ${a.area_id === sel.area_id ? 'selected' : ''}>${esc(a.name)}</option>`);
      if (sel.area_id && !areas.some((a) => a.area_id === sel.area_id)) areaOpts.unshift(`<option selected value="${esc(sel.area_id)}">${esc(sel.area_id)} (missing)</option>`);
      const fid = this.floorOf(sel);
      const floorOpts = this.floors.map((f) => `<option value="${esc(f.id)}" ${f.id === fid ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
      const doors = (sel.doors || []).map((p, i) => `<li>Door ${i + 1} <span class="dim">(${fmt(p[0])}, ${fmt(p[1])})</span> <button class="link" data-act="del-door" data-i="${i}">Remove</button></li>`).join('');
      out += `<section class="box">
        <h3>${esc(areaName(this.hass, sel.area_id))}</h3>
        <label>Area <select data-field="room-area">${areaOpts.join('')}</select></label>
        <label>Floor <select data-field="room-floor">${floorOpts}</select></label>
        <label class="check"><input type="checkbox" data-field="room-outdoor" ${sel.outdoor ? 'checked' : ''}> Outdoor (no walls)</label>
        <div class="sub">Doors</div>
        <ul class="plain">${doors || '<li class="dim">No doors</li>'}</ul>
        <button data-act="door-mode" class="${this.doorMode ? 'primary' : ''}">${this.doorMode ? 'Click a wall on the plan…' : 'Add door'}</button>
        <p class="hint">Drag corners to reshape. Drag an edge midpoint to add a corner, right-click a corner to delete it.</p>
        <div class="row">
          <button data-act="delete-room" class="danger">${this.confirmDelete ? 'Really delete?' : 'Delete room'}</button>
          <button data-act="deselect">Done</button>
        </div></section>`;
    }

    const byFloor = new Map(this.floors.map((f) => [f.id, []]));
    byFloor.set('', []);
    for (const a of areas) (byFloor.get(a.floor_id) || byFloor.get('')).push(a);
    for (const [fid, list] of byFloor) {
      if (!list.length) continue;
      const fname = fid ? this.floors.find((f) => f.id === fid).name : 'No floor';
      out += `<div class="sub">${esc(fname)}</div><ul class="list">`;
      for (const a of list) {
        const r = rooms.find((x) => x.area_id === a.area_id);
        out += `<li class="${r && r.id === this.selectedRoom ? 'sel' : ''}"><span class="name">${esc(a.name)}</span>
          <span class="pill ${r ? 'ok' : 'missing'}">${r ? 'drawn' : 'missing'}</span>
          ${r ? `<button data-act="select-room" data-id="${esc(r.id)}">Select</button>` : `<button data-act="draw" data-id="${esc(a.area_id)}">Draw</button>`}</li>`;
      }
      out += '</ul>';
    }
    const orphans = rooms.filter((r) => !(this.hass.areas || {})[r.area_id]);
    if (orphans.length) {
      out += '<div class="sub">Rooms without an HA area</div><ul class="list">';
      for (const r of orphans) out += `<li><span class="name">${esc(r.area_id || r.id)}</span><button data-act="select-room" data-id="${esc(r.id)}">Select</button></li>`;
      out += '</ul>';
    }
    if (!areas.length) out += '<p class="hint">No areas in Home Assistant yet. Create areas under Settings → Areas.</p>';

    const stored = new Set((this.layout.floors || []).map((f) => f.id));
    const haFloors = new Set(Object.keys(this.hass.floors || {}));
    out += '<div class="sub">Floors</div><table class="floors"><tr><th></th><th>Elevation m</th><th>Height m</th><th></th></tr>';
    for (const f of this.floors) {
      out += `<tr><td>${esc(f.name)}</td>
        <td><input type="number" step="0.05" data-field="floor-elevation" data-id="${esc(f.id)}" value="${fmt(f.elevation)}"></td>
        <td><input type="number" step="0.05" min="0.5" data-field="floor-height" data-id="${esc(f.id)}" value="${fmt(f.height)}"></td>
        <td>${!haFloors.has(f.id) && stored.has(f.id) ? `<button class="link" data-act="del-floor" data-id="${esc(f.id)}">Remove</button>` : ''}</td></tr>`;
    }
    out += `</table><p class="hint">Floors come from Home Assistant (Settings → Areas → Floors). Add one here only for a level HA doesn't have.</p>
      <button data-act="add-floor">Add floor</button>`;
    return out;
  }

  _allMarkers() {
    return buildMarkers(this.hass, { ...this.layout, hidden: [] }, { group_by: this.card._config.group_by });
  }

  _devicesTab() {
    const all = this._allMarkers();
    const byId = new Map(all.map((m) => [m.id, m]));
    const hidden = this.layout.hidden || [];
    let out = '';
    const m = this.selectedMarker && byId.get(this.selectedMarker);
    if (m) {
      const pos = this.card._positions && this.card._positions.get(m.id);
      const pinned = !!(this.layout.pins || {})[m.id];
      if (m.id === this.card._mowerMarkerId) {
        return out + `<section class="box"><h3>${esc(m.name)}</h3><p class="dim">${esc(m.entityId)}</p>
          <p>Follows the live mower position. Set it up in the Mower tab.</p>
          <div class="row"><button data-act="deselect-marker">Done</button></div></section>`;
      }
      out += `<section class="box"><h3>${esc(m.name)}</h3>
        <p class="dim">${esc(m.entityId)}${m.areaId ? ' · ' + esc(areaName(this.hass, m.areaId)) : ''}</p>
        <p>${pinned ? 'Pinned' : 'Auto placed'}</p>
        ${pos ? `<label>Height above floor (m) <input type="number" step="0.05" min="0" data-field="marker-z" value="${fmt(pos.z)}"></label>` : ''}
        <div class="row">
          ${pinned ? '<button data-act="unpin">Return to auto placement</button>' : ''}
          <button data-act="hide">Hide</button>
          <button data-act="deselect-marker">Done</button>
        </div></section>`;
    }
    out += '<p class="hint">Drag any marker on the plan to pin it there. Click a marker to select it.</p>';

    const unplaced = all.filter((x) => !hidden.includes(x.id) && !hidden.includes(x.entityId) && !(this.card._positions || new Map()).has(x.id));
    out += `<div class="sub">Devices without a room (${unplaced.length})</div>`;
    if (unplaced.length) {
      out += '<ul class="list">';
      for (const x of unplaced) {
        out += `<li><span class="name">${esc(x.name)}<span class="dim"> · ${x.areaId ? esc(areaName(this.hass, x.areaId)) : 'no area'}</span></span>
          <button data-act="place" data-id="${esc(x.id)}">Place</button></li>`;
      }
      out += '</ul>';
    } else out += '<p class="dim">Every device is on the plan.</p>';

    out += `<div class="sub">Hidden (${hidden.length})</div>`;
    if (hidden.length) {
      out += '<ul class="list">';
      for (const id of hidden) {
        const x = byId.get(id) || all.find((y) => y.entityId === id);
        out += `<li><span class="name">${esc(x ? x.name : id)}</span><button data-act="unhide" data-id="${esc(id)}">Unhide</button></li>`;
      }
      out += '</ul>';
    } else out += '<p class="dim">Nothing hidden.</p>';
    return out;
  }

  _mowerTab() {
    const m = this.mower();
    const states = this.hass.states;
    const ids = Object.keys(states).sort();
    const posIds = ids.filter((id) => /^(device_tracker|sensor|lawn_mower|vacuum)\./.test(id));
    const picIds = ids.filter((id) => /^(image|camera)\./.test(id));
    const datalist = (id, list) => `<datalist id="${id}">${list.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
    const floorOpts = this.floors.map((f) => `<option value="${esc(f.id)}" ${f.id === this.card._mowerFloor() ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    const cal = m.calibration || [];
    const err = calibrationError(cal, m.source === 'xy' ? 'xy' : 'gps');
    const fitName = ['', 'shift only', 'shift, rotate, scale', 'affine (least squares)'][Math.min(cal.length, 3)];
    let out = `<div class="sub">Position</div>
      <label>Entity <input list="fp-pos-ents" data-field="mower-entity" value="${esc(m.entity || '')}" placeholder="device_tracker.mower_position"></label>
      ${datalist('fp-pos-ents', posIds)}
      <label>Source <select data-field="mower-source">
        <option value="gps" ${m.source !== 'xy' ? 'selected' : ''}>GPS (latitude / longitude)</option>
        <option value="xy" ${m.source === 'xy' ? 'selected' : ''}>Map x / y attributes</option></select></label>
      ${m.source === 'xy' ? `<div class="row"><label>x attribute <input data-field="mower-xattr" value="${esc(m.x_attr || 'x')}"></label>
        <label>y attribute <input data-field="mower-yattr" value="${esc(m.y_attr || 'y')}"></label></div>` : ''}
      <label>Floor <select data-field="mower-floor">${floorOpts}</select></label>
      <label class="check"><input type="checkbox" data-field="mower-trail" ${m.trail !== false ? 'checked' : ''}> Show trail (this session)</label>
      <p class="hint mower-live">${this._mowerLiveHtml()}</p>`;
    if (!m.entity) return out;

    out += `<div class="sub">Calibration (${cal.length} point${cal.length === 1 ? '' : 's'}${cal.length ? ': ' + fitName : ''})</div>`;
    if (this.calibrating) {
      out += `<section class="box"><p>Click on the plan where the mower is right now.</p>
        <div class="row"><button data-act="cal-cancel">Cancel</button></div></section>`;
    }
    out += '<ul class="plain">' + cal.map((c, i) => `<li>${i + 1}. (${c.src.map((v) => (m.source === 'xy' ? fmt(v) : v.toFixed(6))).join(', ')}) → (${fmt(c.plan[0])}, ${fmt(c.plan[1])})
      <button class="link" data-act="cal-del" data-i="${i}">Remove</button></li>`).join('') + '</ul>';
    if (cal.length >= 3) out += `<p class="dim">Fit error ${fmt(err)} m</p>`;
    out += `<div class="row"><button data-act="cal-add" class="${this.calibrating ? '' : 'primary'}" ${this.calibrating ? 'disabled' : ''}>Add point</button>
      ${this.card._trail && this.card._trail.length ? '<button data-act="trail-clear">Clear trail</button>' : ''}</div>
      <p class="hint">"Add point" takes the current reading, then you click where the mower really is. One point aligns
      a GPS track north-up, two fix rotation and scale, three or more also correct skew. Spread points far apart.</p>`;

    const o = m.overlay;
    out += `<div class="sub">Map overlay</div>
      <label>Image or camera entity <input list="fp-pic-ents" data-field="ov-entity" value="${esc((o && o.entity) || '')}" placeholder="image.mower_map"></label>
      ${datalist('fp-pic-ents', picIds)}`;
    if (o && o.entity) {
      const slider = (f, label, min, max, step, v) => `<label>${label} <span class="val" data-val="${f}">${fmt(v)}</span>
        <input type="range" data-field="ov-${f}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
      out += slider('x', 'x (m)', -100, 100, 0.05, o.x ?? 0)
        + slider('y', 'y (m)', -100, 100, 0.05, o.y ?? 0)
        + slider('rotation', 'Rotation (°)', -180, 180, 0.5, o.rotation ?? 0)
        + slider('width', 'Width (m)', 1, 200, 0.1, o.width ?? 20)
        + slider('opacity', 'Opacity', 0, 1, 0.05, o.opacity ?? 0.6)
        + (o.entity.startsWith('camera.') ? slider('refresh', 'Refresh every (s)', 1, 120, 1, o.refresh ?? 10) : '');
      out += `<div class="row"><button data-act="ov-move" class="${this.overlayMove ? 'primary' : ''}">${this.overlayMove ? 'Drag the map on the plan…' : 'Move with mouse'}</button>
        <button data-act="ov-remove">Remove overlay</button></div>`;
    }
    out += '<div class="row"><button data-act="mower-remove" class="danger">Remove mower</button></div>';
    return out;
  }

  _dataTab() {
    const b = this.card._store.backend;
    const info = {
      shared: ['ok', 'Shared: stored by the floorplan3d integration, every user and device sees the same layout.'],
      user: ['warn', 'Per user: stored in your HA user data. Other users will not see this layout. Install the floorplan3d integration to share it.'],
      browser: ['warn', 'This browser only: other browsers and devices will not see this layout. Install the floorplan3d integration to share it.'],
    }[b] || ['warn', 'Storage not loaded yet.'];
    return `<div class="sub">Storage</div><p class="note ${info[0]}">${esc(info[1])}</p>
      <div class="sub">Export / import</div>
      <p class="hint">The layout is plain JSON (rooms in metres, x east, y north). Importing replaces the current layout.</p>
      <div class="row"><button data-act="export">Export JSON</button>
      <label class="button">Import JSON<input type="file" accept="application/json,.json" data-field="import" hidden></label></div>`;
  }

  _onPanelClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;
    const sel = this.room(this.selectedRoom);
    this.message = null;
    switch (btn.dataset.act) {
      case 'tab': this.tab = id; break;
      case 'draw': this.startDrawing(id); return;
      case 'finish': this.finishDrawing(); return;
      case 'undo-point': this.drawing.points.pop(); this.refreshOverlay(); break;
      case 'cancel-draw': this.cancelDrawing(); return;
      case 'select-room': {
        const r = this.room(id);
        const fid = r && this.floorOf(r);
        if (fid && this.card._floor !== fid) this.card._setFloor(fid);
        this.selectRoom(id);
        return;
      }
      case 'deselect': this.selectRoom(null); return;
      case 'door-mode': this.doorMode = !this.doorMode; this._syncStageClasses(); break;
      case 'del-door': if (sel) this.commit(E.upsertRoom(this.layout, E.removeDoor(sel, Number(btn.dataset.i)))); return;
      case 'delete-room':
        if (!this.confirmDelete) { this.confirmDelete = true; break; }
        this.confirmDelete = false;
        this.selectedRoom = null;
        this.commit(E.deleteRoom(this.layout, sel.id));
        return;
      case 'add-floor': {
        const top = this.floors[this.floors.length - 1];
        const fid = E.newFloorId(this.layout, this.floors);
        this.commit(E.upsertFloor(this.layout, { id: fid, name: 'Floor ' + (this.floors.length + 1), elevation: top ? top.elevation + 3 : 0, height: 2.7 }));
        return;
      }
      case 'del-floor': this.commit(E.deleteFloor(this.layout, id)); return;
      case 'unpin': this.commit(E.clearPin(this.layout, this.selectedMarker)); return;
      case 'hide': {
        const mid = this.selectedMarker;
        this.selectMarker(null);
        this.commit(E.hide(this.layout, mid));
        return;
      }
      case 'deselect-marker': this.selectMarker(null); return;
      case 'unhide': this.commit(E.unhide(this.layout, id)); return;
      case 'place': {
        const fid = this.activeFloor();
        const t = this.view.controls.target;
        this.selectedMarker = id;
        this.commit(E.setPin(this.layout, id, { x: t.x, y: -t.z, z: 1.2, floor_id: fid }));
        return;
      }
      case 'export': this._export(); return;
      case 'cal-add': {
        const m = this.mower();
        const r = readSource(this.hass.states[m.entity], m);
        if (!r) { this.message = { text: 'No position reading from the mower entity right now.', error: true }; break; }
        this.calibrating = { src: r.raw };
        this.overlayMove = false;
        if (this.card._floor !== this.card._mowerFloor()) this.card._setFloor(this.card._mowerFloor());
        break;
      }
      case 'cal-cancel': this.calibrating = null; break;
      case 'cal-del': this.setMower({ calibration: (this.mower().calibration || []).filter((_, i) => i !== Number(btn.dataset.i)) }); return;
      case 'trail-clear': this.card.clearTrail(); break;
      case 'ov-move': this.overlayMove = !this.overlayMove; this.calibrating = null; break;
      case 'ov-remove': this.overlayMove = false; this.setMower({ overlay: null }); return;
      case 'mower-remove': this.calibrating = null; this.overlayMove = false; this.commit({ ...this.layout, mower: null }); this.render(); return;
      default: return;
    }
    this._syncStageClasses();
    this.render();
  }

  _onPanelChange(e) {
    const el = e.target;
    const f = el.dataset.field;
    const sel = this.room(this.selectedRoom);
    if (f === 'room-area' && sel) this.commit(E.upsertRoom(this.layout, { ...sel, area_id: el.value }));
    else if (f === 'room-outdoor' && sel) this.commit(E.upsertRoom(this.layout, { ...sel, outdoor: el.checked }));
    else if (f === 'room-floor' && sel) {
      const area = this.hass.areas && this.hass.areas[sel.area_id];
      const next = { ...sel, floor_id: el.value };
      if (area && area.floor_id === el.value) delete next.floor_id;
      this.card._setFloor(el.value);
      this.commit(E.upsertRoom(this.layout, next));
    } else if (f === 'floor-elevation' || f === 'floor-height') {
      const v = Number(el.value);
      if (!Number.isFinite(v)) return;
      const floor = this.floors.find((x) => x.id === el.dataset.id);
      const stored = (this.layout.floors || []).some((x) => x.id === floor.id);
      const patch = { id: floor.id, [f === 'floor-elevation' ? 'elevation' : 'height']: v };
      if (!stored) Object.assign(patch, { name: floor.name });
      this.commit(E.upsertFloor(this.layout, patch));
    } else if (f === 'marker-z') {
      const v = Number(el.value);
      const pos = this.card._positions.get(this.selectedMarker);
      if (!Number.isFinite(v) || !pos) return;
      this.commit(E.setPin(this.layout, this.selectedMarker, { x: pos.x, y: pos.y, z: v, floor_id: pos.floorId }));
    } else if (f === 'mower-entity') {
      this.setMower({ entity: el.value.trim() });
    } else if (f === 'mower-source') {
      // readings of the other kind cannot be mixed into the same calibration
      this.setMower({ source: el.value, calibration: [] });
    } else if (f === 'mower-xattr' || f === 'mower-yattr') {
      this.setMower({ [f === 'mower-xattr' ? 'x_attr' : 'y_attr']: el.value.trim() || (f === 'mower-xattr' ? 'x' : 'y') });
    } else if (f === 'mower-floor') {
      this.card._setFloor(el.value);
      this.setMower({ floor_id: el.value });
    } else if (f === 'mower-trail') {
      this.setMower({ trail: el.checked });
    } else if (f === 'ov-entity') {
      const v = el.value.trim();
      if (!v) this.setMower({ overlay: null });
      else {
        // first time: centre the map on the current view
        const t = this.view.controls.target;
        const first = !this.mower().overlay;
        this.setOverlay(first ? { entity: v, x: Math.round(t.x * 10) / 10, y: Math.round(-t.z * 10) / 10 } : { entity: v });
      }
    } else if (f === 'import') {
      const file = el.files && el.files[0];
      el.value = ''; // picking the same file again must fire change again
      if (file) file.text().then((text) => this._import(text));
    }
  }

  // sliders update the overlay live, without re-rendering the panel under the pointer
  _onPanelInput(e) {
    const el = e.target;
    const f = el.dataset.field;
    if (!f || !f.startsWith('ov-') || el.type !== 'range') return;
    const key = f.slice(3);
    const v = Number(el.value);
    const label = this.panel.querySelector(`[data-val="${key}"]`);
    if (label) label.textContent = fmt(v);
    this.setOverlay({ [key]: v }, false);
  }

  _import(text) {
    try {
      const l = E.parseImport(text);
      this.selectedRoom = null;
      this.selectedMarker = null;
      this.message = { text: `Imported ${l.rooms.length} rooms, ${Object.keys(l.pins).length} pins.` };
      this.commit(l);
    } catch (err) {
      this.message = { text: err.message, error: true };
      this.render();
    }
  }

  _export() {
    const blob = new Blob([JSON.stringify(this.layout, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `floorplan3d-${this.card._config.layout_key}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
