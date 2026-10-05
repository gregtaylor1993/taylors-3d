// A north-up SVG plan. It shares the card's rooms and live positions; no second 3D renderer.
import { centroid, signedArea } from './placement.js';
import { isActive } from './registry.js';

const NS = 'http://www.w3.org/2000/svg';
const WIDTH = 200, HEIGHT = 150;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const point = (p) => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]);
const round = (v) => Math.round(v * 1000) / 1000;
const items = (v) => v instanceof Map ? [...v.entries()] : v && typeof v === 'object' ? Object.entries(v) : [];
const valueAt = (v, k) => v instanceof Map ? v.get(k) : v && v[k];
const safeColour = (v) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
const unavailable = new Set(['unknown', 'unavailable', 'missing', 'stale', 'invalid', 'ambiguous', 'unplaced']);
const SYMBOLS = {
  'mdi:account': 'M 0 -2 A 2 2 0 1 0 0 -6 A 2 2 0 1 0 0 -2 M -3 4 V 2 A 3 3 0 0 1 3 2 V 4 Z',
  'mdi:motion-sensor': 'M -4 0 A 4 4 0 0 1 4 0 M -2 0 A 2 2 0 0 1 2 0 M 0 0 V 4 M -2 4 H 2',
  'mdi:car': 'M -4 3 V -1 L -2 -4 H 2 L 4 -1 V 3 Z M -4 -1 H 4 M -2 3 V 4 M 2 3 V 4',
  'mdi:robot-vacuum': 'M 0 -4 A 4 4 0 1 0 0 4 A 4 4 0 1 0 0 -4 M -2 -1 H 2 M 0 4 V 6 M -1 5 H 1',
};

// Preserve equal scale on both axes. Plan north (+y) is screen up (-y).
export function miniMapTransform(points, { width = WIDTH, height = HEIGHT, padding = 14 } = {}) {
  const valid = (Array.isArray(points) ? points : []).filter(point);
  if (!valid.length) return null;
  width = finite(width) && width > 2 ? width : WIDTH;
  height = finite(height) && height > 2 ? height : HEIGHT;
  padding = finite(padding) ? Math.max(0, Math.min(padding, Math.min(width, height) / 2 - 1)) : 14;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of valid) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const center = [minX / 2 + maxX / 2, minY / 2 + maxY / 2];
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  if (!finite(scale) || scale <= 0) return null;
  return {
    width, height, center, scale, bounds: { minX, minY, maxX, maxY },
    toSvg: ([x, y]) => [width / 2 + (x - center[0]) * scale, height / 2 - (y - center[1]) * scale],
    toPlan: ([x, y]) => [center[0] + (x - width / 2) / scale, center[1] - (y - height / 2) / scale],
  };
}

// getCamera() uses Three.js coordinates (x, height, -north); getTopCamera() already uses plan metres.
export function miniMapCamera({ camera, topCamera, mode } = {}) {
  if (mode === 'top') return topCamera && point(topCamera.center) ? { focus: topCamera.center.slice(0, 2), direction: null } : null;
  const vector = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);
  if (!camera || !vector(camera.target) || !vector(camera.position)) return null;
  const focus = [camera.target[0], -camera.target[2]];
  const dx = camera.target[0] - camera.position[0], dy = camera.position[2] - camera.target[2];
  const distance = Math.hypot(dx, dy);
  return { focus, direction: distance > 1e-9 ? [dx / distance, dy / distance] : null };
}

// Accept the card's resolved _roomList [{ room, floorId, name }] and _positions Map directly.
// Each mini-map displays one floor; the selector disambiguates overlapping storeys in All views.
export function miniMapScene(data = {}, { floorId } = {}) {
  const visible = data.visibleFloors ?? 'all';
  const visibleIds = visible === 'all' ? null : new Set(visible instanceof Set || Array.isArray(visible) ? visible : [visible]);
  const rooms = [];
  for (const entry of Array.isArray(data.rooms) ? data.rooms : []) {
    const room = entry && (entry.room || entry);
    if (!room || typeof room.id !== 'string' || !room.id) continue;
    const polygon = room.polygon || room.outline;
    if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every(point) || !finite(signedArea(polygon)) || Math.abs(signedArea(polygon)) < 1e-9) continue;
    const id = entry.floorId || room.floor_id || room.floorId || 'ground';
    if (entry.shown === false || entry.visible === false || room.hidden === true || room.shown === false || (visibleIds && !visibleIds.has(id))) continue;
    rooms.push({ id: room.id, floorId: id, name: entry.name || room.name || room.label || room.id,
      areaId: room.area_id || null, polygon: polygon.map((p) => p.slice(0, 2)), outdoor: !!room.outdoor,
      selected: room.id === data.selectedRoomId, center: centroid(polygon) });
  }
  const roomFloors = new Set(rooms.map((r) => r.floorId));
  const provided = Array.isArray(data.floors) ? data.floors.filter((f) => f && roomFloors.has(f.id)) : [];
  const floors = provided.map((f) => ({ id: f.id, name: f.name || f.id, elevation: finite(f.elevation) ? f.elevation : 0 }));
  for (const id of roomFloors) if (!floors.some((f) => f.id === id)) floors.push({ id, name: id, elevation: 0 });
  floors.sort((a, b) => a.elevation - b.elevation);
  const chosen = floors.some((f) => f.id === floorId) ? floorId : floors[0]?.id || null;
  const shownRooms = rooms.filter((r) => r.floorId === chosen);
  const markerById = new Map((Array.isArray(data.markers) ? data.markers : []).filter(Boolean).map((m) => [m.id, m]));
  const markers = [];
  // Builders already resolve evidence, expiry and identity. The map never guesses from motion
  // or cleaning state; it shows only their explicitly placed, visible observation records.
  const candidates = Array.isArray(data.trackedMarkers) ? data.trackedMarkers : [];
  const counts = new Map();
  for (const m of candidates) if (typeof m?.id === 'string') counts.set(m.id, (counts.get(m.id) || 0) + 1);
  const tracked = candidates.filter((m) => m && typeof m.id === 'string' && m.id && counts.get(m.id) === 1
    && typeof m.entityId === 'string' && m.entityId.includes('.') && m.shown !== false && m.position?.shown !== false
    && finite(m.position?.x) && finite(m.position?.y) && Math.abs(m.position.x) <= 1e6 && Math.abs(m.position.y) <= 1e6
    && m.position.floorId === chosen);
  const trackedIds = new Set(tracked.map((m) => m.id));
  const trackedEntities = new Set(tracked.map((m) => m.entityId));
  for (const [id, pos] of items(data.positions)) {
    if (!pos || !finite(pos.x) || !finite(pos.y) || pos.floorId !== chosen || pos.shown === false) continue;
    const visibility = valueAt(data.markerStates, id);
    if (visibility?.shown === false) continue;
    const marker = markerById.get(id) || {};
    // An exact source dot is replaced by its dedicated symbol. A grouped device containing
    // other entities remains available, and separate explicit tracking bindings remain separate.
    const related = [marker.entityId, marker.secondaryId, ...(Array.isArray(marker.entities) ? marker.entities.map((e) => typeof e === 'string' ? e : e?.eid) : [])].filter(Boolean);
    if (trackedIds.has(id) || trackedEntities.has(marker.entityId) && related.every((entity) => entity === marker.entityId)) continue;
    const state = marker.entityId && data.states ? data.states[marker.entityId] : null;
    markers.push({ id, entityId: marker.entityId || null, x: pos.x, y: pos.y, floorId: chosen, name: marker.name || id,
      active: marker.active ?? isActive(state), unavailable: state?.state === 'unknown' || state?.state === 'unavailable',
      state: state?.state || '', faded: !!visibility?.faded });
  }
  for (const marker of tracked) markers.push({ id: marker.id, entityId: marker.entityId, x: marker.position.x, y: marker.position.y,
    floorId: chosen, name: marker.name || marker.label || marker.id, active: marker.active === true,
    unavailable: unavailable.has(marker.status) || unavailable.has(marker.positionStatus), state: '',
    status: typeof marker.status === 'string' ? marker.status : '', positionStatus: typeof marker.positionStatus === 'string' ? marker.positionStatus : '',
    tracked: true, icon: Object.hasOwn(SYMBOLS, marker.icon) ? marker.icon : null,
    color: safeColour(marker.color) ? marker.color : null, faded: false });
  const transform = miniMapTransform([...shownRooms.flatMap((r) => r.polygon), ...markers.map((m) => [m.x, m.y])]);
  return { rooms: shownRooms, markers, floors, floorId: chosen, transform, camera: miniMapCamera(data) };
}

const STYLE = `
.taylors3d-minimap { position:absolute; z-index:14; width:var(--taylors3d-minimap-size,180px); max-width:calc(100% - 24px);
  overflow:hidden; border:1px solid var(--divider-color,#d6d6d6); border-radius:12px;
  background:var(--ha-card-background,var(--card-background-color,#fff)); color:var(--primary-text-color,#222);
  box-shadow:0 2px 8px #0002; font:inherit; user-select:none; }
.taylors3d-minimap[hidden] { display:none; }
.taylors3d-minimap .map-header { display:flex; align-items:center; gap:5px; padding:5px 7px 1px; min-height:25px; }
.taylors3d-minimap .map-title { font-size:11px; font-weight:600; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.taylors3d-minimap .map-floor { min-width:0; max-width:110px; font:inherit; font-size:11px; color:inherit;
  background:var(--ha-card-background,var(--card-background-color,#fff)); border:1px solid var(--divider-color,#d6d6d6); border-radius:4px; }
.taylors3d-minimap .map-close { display:grid; place-items:center; flex-shrink:0; width:27px; height:27px; padding:0; border:0;
  border-radius:6px; background:transparent; color:inherit; font-size:19px; line-height:1; cursor:pointer; }
.taylors3d-minimap svg { display:block; width:100%; height:auto; touch-action:none; }
.taylors3d-minimap .map-ground { fill:transparent; cursor:crosshair; }
.taylors3d-minimap .map-room { fill:color-mix(in srgb,var(--primary-text-color,#222) 7%,var(--card-background-color,#fff));
  stroke:var(--secondary-text-color,#737373); stroke-width:1.2; stroke-linejoin:round; cursor:pointer; }
.taylors3d-minimap .map-room.outdoor { fill:color-mix(in srgb,var(--success-color,#43a047) 15%,var(--card-background-color,#fff)); stroke-dasharray:3 2; }
.taylors3d-minimap .map-room.selected,.taylors3d-minimap .map-room:hover { fill:color-mix(in srgb,var(--primary-color,#03a9f4) 20%,var(--card-background-color,#fff)); stroke:var(--primary-color,#03a9f4); }
.taylors3d-minimap .map-marker { cursor:pointer; }
.taylors3d-minimap .map-marker .dot { fill:var(--secondary-text-color,#737373); stroke:var(--card-background-color,#fff); stroke-width:1.2; }
.taylors3d-minimap .map-marker.active .dot { fill:var(--state-light-active-color,var(--primary-color,#03a9f4)); }
.taylors3d-minimap .map-marker.unavailable .dot { fill:var(--disabled-text-color,#aaa); }
.taylors3d-minimap .map-marker.faded { opacity:.45; }
.taylors3d-minimap .map-marker .symbol { visibility:hidden; }
.taylors3d-minimap .map-marker.tracked .dot { fill:var(--ha-card-background,var(--card-background-color,#fff));
  stroke:var(--taylors3d-map-marker-color,var(--primary-color,#03a9f4)); }
.taylors3d-minimap .map-marker.tracked .symbol { visibility:visible; fill:none;
  stroke:var(--taylors3d-map-marker-color,var(--primary-color,#03a9f4)); stroke-width:1.2; stroke-linecap:round; stroke-linejoin:round; pointer-events:none; }
.taylors3d-minimap .map-marker.tracked.unavailable .dot,.taylors3d-minimap .map-marker.tracked.unavailable .symbol {
  stroke:var(--disabled-text-color,#aaa); }
.taylors3d-minimap .map-hit { fill:transparent; }
.taylors3d-minimap .map-camera { pointer-events:none; color:var(--primary-color,#03a9f4); }
.taylors3d-minimap .map-camera circle { fill:var(--card-background-color,#fff); stroke:currentColor; stroke-width:1.7; }
.taylors3d-minimap .map-camera path { fill:currentColor; }
.taylors3d-minimap .map-north { fill:var(--secondary-text-color,#737373); font-size:9px; pointer-events:none; }
.taylors3d-minimap :is(button,select,[role=button]):focus-visible { outline:2px solid var(--primary-color,#03a9f4); outline-offset:2px; }
.taylors3d-minimap .map-room:focus-visible { stroke:var(--primary-color,#03a9f4); stroke-width:2.5; }
.taylors3d-minimap .map-marker:focus-visible .map-hit { stroke:var(--primary-color,#03a9f4); stroke-width:1.5; }
`;

function svgElement(doc, tag, attributes = {}) {
  const el = doc.createElementNS(NS, tag);
  svgAttributes(el, attributes);
  return el;
}

function svgAttributes(el, attributes) {
  for (const [key, value] of Object.entries(attributes)) {
    const text = String(value);
    if (el.getAttribute(key) !== text) el.setAttribute(key, text);
  }
}

// State, position and selection updates keep each keyboard target's actual SVG node.
function keyedSvg(layer, values, keyAttribute, create, update) {
  const existing = new Map([...layer.children].map((el) => [el.getAttribute(keyAttribute), el]));
  const desired = values.map((value) => {
    const el = existing.get(String(value.id)) || create(value);
    update(el, value);
    return el;
  });
  const retained = new Set(desired);
  for (const el of [...layer.children]) if (!retained.has(el)) el.remove();
  let next = layer.firstElementChild;
  for (const el of desired) {
    if (el !== next) layer.insertBefore(el, next);
    next = el.nextElementSibling;
  }
}

export class MiniMap {
  constructor(stage, { onFocus, onRoom, onMarker, onVisibilityChange, returnFocus, corner = 'top-right', size = 180, visible = true } = {}) {
    this.callbacks = { onFocus, onRoom, onMarker, onVisibilityChange };
    this.stage = stage;
    this.returnFocus = returnFocus;
    this.visible = visible !== false;
    this.disposed = false;
    this._listeners = [];
    const doc = stage.ownerDocument;
    this.el = doc.createElement('div');
    this.el.className = 'taylors3d-minimap';
    this.el.dataset.taylors3dUi = 'minimap';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Floor mini-map');
    this.el.style.setProperty('--taylors3d-minimap-size', `${finite(size) ? Math.max(120, Math.min(260, size)) : 180}px`);
    const location = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(corner) ? corner : 'top-right';
    this.el.style[location.startsWith('top') ? 'top' : 'bottom'] = location.startsWith('bottom') ? '72px' : '12px';
    this.el.style[location.endsWith('left') ? 'left' : 'right'] = '12px';
    const style = doc.createElement('style'); style.textContent = STYLE; this.el.append(style);
    const header = doc.createElement('div'); header.className = 'map-header';
    this.title = doc.createElement('span'); this.title.className = 'map-title'; this.title.textContent = 'Mini-map';
    this.select = doc.createElement('select'); this.select.className = 'map-floor'; this.select.setAttribute('aria-label', 'Mini-map floor');
    const close = doc.createElement('button'); close.type = 'button'; close.className = 'map-close';
    close.dataset.mapClose = ''; close.textContent = '×'; close.setAttribute('aria-label', 'Hide mini-map');
    header.append(this.title, this.select, close); this.el.append(header);
    this.svg = svgElement(doc, 'svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'group', 'aria-label': 'North-up floor plan' });
    this.ground = svgElement(doc, 'rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, class: 'map-ground', role: 'button', tabindex: 0, 'aria-label': 'Focus the centre of this floor' });
    this.roomLayer = svgElement(doc, 'g'); this.markerLayer = svgElement(doc, 'g');
    this.cameraLayer = svgElement(doc, 'g', { class: 'map-camera', 'aria-hidden': 'true' });
    this.focusRing = svgElement(doc, 'circle', { cx: 0, cy: 0, r: 4 });
    this.focusArrow = svgElement(doc, 'path', { d: 'M -4 -6 L 0 -14 L 4 -6 Z' });
    this.cameraLayer.append(this.focusRing, this.focusArrow);
    const north = svgElement(doc, 'text', { class: 'map-north', x: WIDTH - 13, y: 11, 'text-anchor': 'middle', 'aria-hidden': 'true' }); north.textContent = 'N ↑';
    this.svg.append(this.ground, this.roomLayer, this.markerLayer, this.cameraLayer, north); this.el.append(this.svg);
    stage.append(this.el);
    const listen = (el, type, handler, options) => { el.addEventListener(type, handler, options); this._listeners.push(() => el.removeEventListener(type, handler, options)); };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick', 'wheel', 'contextmenu']) listen(this.el, type, (e) => e.stopPropagation());
    listen(this.el, 'click', (e) => { e.stopPropagation(); this._activate(e); });
    listen(this.el, 'keydown', (e) => {
      e.stopPropagation();
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('svg [role="button"]')) { e.preventDefault(); this._activate(e, true); }
    });
    listen(this.select, 'change', (e) => { e.stopPropagation(); this._selectedFloor = this.select.value; this.update(this._data || {}); });
    this.update({});
  }

  update(data = {}) {
    if (this.disposed) return;
    const focused = this._focusedElement();
    this._data = data;
    this.scene = miniMapScene(data, { floorId: this._selectedFloor });
    this._selectedFloor = this.scene.floorId;
    const floor = this.scene.floors.find((f) => f.id === this.scene.floorId);
    this.svg.setAttribute('aria-label', `North-up floor plan${floor ? `, ${floor.name}` : ''}`);
    this.title.textContent = this.scene.floors.length > 1 ? 'Mini-map' : floor?.name || 'Mini-map';
    const optionsKey = JSON.stringify(this.scene.floors.map((f) => [f.id, f.name]));
    if (optionsKey !== this._optionsKey) {
      this.select.replaceChildren();
      for (const f of this.scene.floors) { const option = this.el.ownerDocument.createElement('option'); option.value = f.id; option.textContent = f.name; this.select.append(option); }
      this._optionsKey = optionsKey;
    }
    this.select.hidden = this.scene.floors.length < 2;
    this.select.value = this.scene.floorId || '';
    this._syncVisibility();
    const transform = this.scene.transform;
    if (!transform) {
      this.roomLayer.replaceChildren(); this.markerLayer.replaceChildren(); this._roomsKey = this._markersKey = null;
      this.cameraLayer.setAttribute('visibility', 'hidden'); this._restoreFocus(focused); return;
    }
    const frameKey = [transform.center, transform.scale];
    const roomsKey = JSON.stringify([frameKey, this.scene.rooms]);
    if (roomsKey !== this._roomsKey) {
      keyedSvg(this.roomLayer, this.scene.rooms, 'data-room', () => svgElement(this.el.ownerDocument, 'polygon'), (el, r) => svgAttributes(el, {
        points: r.polygon.map((p) => transform.toSvg(p).map(round).join(',')).join(' '),
        class: `map-room${r.outdoor ? ' outdoor' : ''}${r.selected ? ' selected' : ''}`, 'data-room': r.id,
        role: 'button', tabindex: 0, 'aria-label': `Focus ${r.name}`, 'aria-pressed': String(r.selected),
      }));
      this._roomsKey = roomsKey;
    }
    const markersKey = JSON.stringify([frameKey, this.scene.markers]);
    if (markersKey !== this._markersKey) {
      keyedSvg(this.markerLayer, this.scene.markers, 'data-marker', () => {
        const g = svgElement(this.el.ownerDocument, 'g');
        g.append(svgElement(this.el.ownerDocument, 'circle', { r: 9, class: 'map-hit' }), svgElement(this.el.ownerDocument, 'circle', { r: 3, class: 'dot' }), svgElement(this.el.ownerDocument, 'path', { class: 'symbol', 'aria-hidden': 'true' }));
        return g;
      }, (g, m) => {
        const [x, y] = transform.toSvg([m.x, m.y]);
        svgAttributes(g, { class: `map-marker${m.tracked ? ' tracked' : ''}${m.active ? ' active' : ''}${m.unavailable ? ' unavailable' : ''}${m.faded ? ' faded' : ''}`,
          transform: `translate(${round(x)} ${round(y)})`, 'data-marker': m.id, role: 'button', tabindex: 0,
          'aria-label': `Focus ${m.name}${m.state ? `, ${m.state}` : ''}${m.tracked && m.status ? `; ${m.status}` : ''}${m.positionStatus ? `; position ${m.positionStatus.replaceAll('_', ' ')}` : ''}` });
        svgAttributes(g.querySelector('.dot'), { r: m.tracked ? 7 : 3 });
        svgAttributes(g.querySelector('.symbol'), { d: m.icon ? SYMBOLS[m.icon] : '' });
        if (m.color) g.style.setProperty('--taylors3d-map-marker-color', m.color);
        else g.style.removeProperty('--taylors3d-map-marker-color');
      });
      this._markersKey = markersKey;
    }
    this.updateCamera(data);
    this._restoreFocus(focused);
  }

  // Called by the main render loop. Only the small camera indicator changes, never room or device DOM.
  updateCamera(snapshot = {}) {
    if (this.disposed) return;
    this._camera = miniMapCamera(snapshot);
    const transform = this.scene?.transform;
    if (!transform || !this._camera) { this.cameraLayer.setAttribute('visibility', 'hidden'); return; }
    const raw = transform.toSvg(this._camera.focus);
    const [x, y] = [Math.max(6, Math.min(WIDTH - 6, raw[0])), Math.max(6, Math.min(HEIGHT - 6, raw[1]))];
    const direction = this._camera.direction;
    const angle = direction ? Math.atan2(direction[0], direction[1]) * 180 / Math.PI : 0;
    const key = [round(x), round(y), round(angle), !!direction].join(',');
    if (key !== this._cameraKey) {
      this.cameraLayer.setAttribute('transform', `translate(${round(x)} ${round(y)}) rotate(${round(angle)})`);
      this.focusArrow.setAttribute('visibility', direction ? 'visible' : 'hidden');
      this._cameraKey = key;
    }
    this.cameraLayer.setAttribute('visibility', 'visible');
  }

  _activate(event, keyboard = false) {
    if (this.disposed || this.el.hidden) return;
    if (event.target.closest?.('[data-map-close]')) { this.setVisible(false); return; }
    if (!this.scene?.transform || !event.target.closest?.('svg')) return;
    const roomId = event.target.closest?.('[data-room]')?.getAttribute('data-room');
    const markerId = event.target.closest?.('[data-marker]')?.getAttribute('data-marker');
    const room = this.scene.rooms.find((r) => r.id === roomId);
    const marker = this.scene.markers.find((m) => m.id === markerId);
    let p = marker ? [marker.x, marker.y] : room ? room.center : this.scene.transform.center;
    if (!marker && !room && !keyboard) {
      const box = this.svg.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) p = this.scene.transform.toPlan([(event.clientX - box.left) / box.width * WIDTH, (event.clientY - box.top) / box.height * HEIGHT]);
    }
    const focus = { x: p[0], y: p[1], floorId: this.scene.floorId };
    if (room) focus.roomId = room.id;
    if (marker) focus.markerId = marker.id;
    this.callbacks.onFocus?.(focus);
    if (room) this.callbacks.onRoom?.(room.id, focus);
    if (marker) this.callbacks.onMarker?.(marker.id, { ...focus, entityId: marker.entityId, name: marker.name, icon: marker.icon || null, tracked: marker.tracked === true });
  }

  _syncVisibility() { this.el.hidden = !this.visible || !!this._data?.editing || !this.scene?.rooms.length; }

  _focusedElement() {
    const active = this.el.getRootNode().activeElement || this.el.ownerDocument.activeElement;
    return active && this.el.contains(active) ? active : null;
  }

  _focusOutside() {
    const requested = typeof this.returnFocus === 'function' ? this.returnFocus() : this.returnFocus;
    const target = requested?.isConnected && !requested.hidden ? requested : this.stage;
    const tabindex = target.getAttribute('tabindex');
    if (target === this.stage && tabindex === null) target.setAttribute('tabindex', '-1');
    target.focus?.({ preventScroll: true });
    // Keep the fallback stage focusable: removing tabindex here immediately blurs it in Chrome.
  }

  _restoreFocus(focused) {
    if (!focused) return;
    if (this.el.hidden || this.disposed) { this._focusOutside(); return; }
    const target = this.el.contains(focused) && !focused.hidden ? focused : this.ground;
    if (this._focusedElement() !== target) target.focus?.({ preventScroll: true });
  }

  setVisible(visible) {
    if (this.disposed) return;
    const focused = this._focusedElement();
    const next = !!visible, changed = next !== this.visible;
    this.visible = next;
    this._syncVisibility();
    this._restoreFocus(focused);
    if (changed) this.callbacks.onVisibilityChange?.(next);
  }

  dispose() {
    if (this.disposed) return;
    const focused = this._focusedElement();
    this.disposed = true;
    this._restoreFocus(focused);
    for (const remove of this._listeners.splice(0)) remove();
    this.callbacks = {};
    this._data = this.scene = null;
    this.el.remove();
  }
}
