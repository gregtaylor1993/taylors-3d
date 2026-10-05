// Static plan security helpers. Inputs/mini-map records stay in canonical SOURCE metres.
// Root applies its existing floor-display adapter once before passing records to the layer.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { centroid, pointInPolygon, signedArea } from './placement.js';
import { normaliseSecurityBinding, readSecurityState, securityHighlight, SECURITY_LIMITS } from './security.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value) => typeof value === 'string' && value.trim() === value && !!value && value.length <= 256;
const at = (source, key) => source instanceof Map ? source.get(key) : plain(source) && Object.hasOwn(source, key) ? source[key] : undefined;
const issue = (code, message, id) => ({ code, message, ...(id ? { id } : {}) });
const hidden = (value) => value?.shown === false || value?.visible === false || value?.hidden === true;
const safe = (value, bound = SECURITY_LIMITS.maxCoordinate) => finite(value) && Math.abs(value) <= bound;
const messages = Object.freeze({ open: 'Open', closed: 'Closed', unlocked: 'Unlocked', locked: 'Locked', locking: 'Locking — final state not confirmed',
  unlocking: 'Unlocking — final state not confirmed', jammed: 'Lock jammed — state uncertain', missing: 'Source missing', unavailable: 'Source unavailable',
  stale: 'Reading stale', unknown: 'State unknown', invalid: 'Reading or settings invalid', hidden: 'Source hidden', disabled: 'Source disabled', contact_class: 'Source is not an opening contact' });
function icon(kind, active) {
  if (kind === 'lock') return active === true ? 'mdi:lock-open-variant-outline' : 'mdi:lock-outline';
  if (kind === 'window') return active === true ? 'mdi:window-open-variant' : 'mdi:window-closed-variant';
  return active === true ? 'mdi:door-open' : 'mdi:door-closed';
}
function uniqueMap(values, key) {
  const map = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const id = key(value); if (!text(id)) continue;
    map.set(id, map.has(id) ? null : value);
  }
  return map;
}
function roomPoint(entry) {
  const room = entry?.room || entry, polygon = room?.polygon || room?.outline;
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > SECURITY_LIMITS.maxRoomPoints
    || !polygon.every((p) => Array.isArray(p) && p.length >= 2 && safe(p[0]) && safe(p[1])) || Math.abs(signedArea(polygon)) <= 1e-9) return null;
  const center = centroid(polygon);
  if (center.every(finite) && pointInPolygon(center, polygon)) return center;
  // Concave outlines need an actual interior point; never put the symbol outside the room.
  try {
    const triangles = THREE.ShapeUtils.triangulateShape(polygon.map(([x, y]) => new THREE.Vector2(x, y)), []);
    return triangles.map((indices) => indices.map((index) => polygon[index])).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))
      .map((triangle) => centroid(triangle)).find((point) => point.every(finite) && pointInPolygon(point, polygon)) || null;
  } catch { return null; }
}
function locate(target, ctx, id) {
  let source, shown = true;
  if (target.position !== undefined) source = target.position;
  else if (target.position_key !== undefined) {
    source = at(ctx.positions, target.position_key);
    if (!plain(source)) return { diagnostics: [issue('missing_anchor', 'The exact saved marker anchor is missing; choose it again deliberately.', id)] };
    shown = !hidden(source);
  } else {
    const entry = ctx.rooms.get(target.roomId), room = entry?.room || entry, point = entry && roomPoint(entry);
    if (!entry || !point) return { diagnostics: [issue('missing_room', 'The exact room needs a valid current outline; no other room is substituted.', id)] };
    source = { x: point[0], y: point[1], z: target.z ?? .12, floorId: entry.floorId ?? room.floor_id ?? room.floorId };
    shown = !hidden(entry) && !hidden(room);
  }
  const floorId = source.floorId ?? source.floor_id, floor = ctx.floors.get(floorId);
  if (!text(floorId) || !floor || floor.stale === true || !safe(floor.elevation) || target.floorId !== undefined && target.floorId !== floorId)
    return { diagnostics: [issue('missing_floor', 'The target needs one exact existing source floor; missing or duplicate floors are not replaced.', id)] };
  if (!safe(source.x) || !safe(source.y) || !safe(source.z, SECURITY_LIMITS.maxHeight) || !safe(floor.elevation + source.z))
    return { diagnostics: [issue('position', 'The selected target must supply finite bounded source metres and an explicit height.', id)] };
  return { location: { x: source.x, y: source.y, z: source.z, floorId, elevation: floor.elevation },
    roomId: target.roomId || null, shown: shown && !hidden(floor) && (!ctx.visible || ctx.visible.has(floorId)), diagnostics: [] };
}

/** Raw saved bindings → canonical source records. No display offsets, timers or HA actions.
 * rooms accept root _roomList entries {room:{id,polygon,floor_id},floorId,name,shown};
 * floors are exact {id,elevation,shown?}; positions is the source Map/object of current
 * marker anchors {x,y,z,floorId,shown?}. An optional target.floorId constrains a room/key.
 * Returns records, diagnostics, nextExpiry, miniMap and stats; root owns expiry scheduling.
 */
export function buildPlanSecurity({ hass = {}, bindings = [], rooms = [], floors = [], positions = {}, visibleFloors = 'all', now = Date.now() } = {}) {
  const result = { records: [], diagnostics: [], nextExpiry: null, miniMap: [], stats: { active: 0, clear: 0, uncertain: 0, unplaced: 0, hidden: 0 } };
  if (!Array.isArray(bindings) || bindings.length > SECURITY_LIMITS.maxBindings || !finite(now)) {
    result.diagnostics.push(issue('bindings', 'Supply at most 256 security bindings and a finite current time.')); return result;
  }
  const values = bindings.map((raw) => ({ raw, config: normaliseSecurityBinding(raw) })), ids = new Map();
  for (const { config } of values) if (typeof config.id === 'string' && /^[a-z0-9_-]{1,64}$/.test(config.id)) ids.set(config.id, (ids.get(config.id) || 0) + 1);
  const ctx = { rooms: uniqueMap(rooms, (entry) => (entry?.room || entry)?.id), floors: uniqueMap(floors, (floor) => floor?.id), positions,
    visible: visibleFloors === 'all' || visibleFloors === undefined ? null : new Set(visibleFloors instanceof Set || Array.isArray(visibleFloors) ? visibleFloors : [visibleFloors]) };
  for (const { raw, config } of values) {
    if (config.targetType !== 'plan') continue;
    result.diagnostics.push(...config.diagnostics);
    if (!config.valid || !config.enabled) continue;
    if (ids.get(config.id) !== 1) { result.diagnostics.push(issue('duplicate_binding', 'Security IDs must be unique across model and plan targets.', config.id)); continue; }
    const reading = readSecurityState(hass, raw, { now }), resolved = locate(config.target, ctx, config.id);
    result.diagnostics.push(...reading.diagnostics, ...resolved.diagnostics);
    const name = typeof config.label === 'string' && config.label.trim() ? config.label : reading.metadata.name;
    const message = messages[reading.status] || 'State uncertain';
    // Missing/offline saved sources may show a neutral explanation at their explicit target.
    // Registry-hidden/disabled/diagnostic sources cannot become a visible active indicator.
    const eligible = !reading.metadata.hidden && !reading.metadata.disabled && !reading.metadata.category;
    const record = { id: config.id, entity: config.entity, kind: config.kind, name, label: `${name}: ${message}`, message,
      status: reading.status, active: reading.active, open: reading.open, locked: reading.locked, verified: reading.verified,
      color: securityHighlight(reading), opacity: config.highlight.opacity, icon: icon(config.kind, reading.active),
      location: resolved.location || null, roomId: resolved.roomId || null, shown: !!resolved.location && resolved.shown && eligible,
      nextExpiry: reading.nextExpiry, target: config.target, diagnostics: [...reading.diagnostics, ...resolved.diagnostics] };
    result.records.push(record);
    if (finite(reading.nextExpiry) && reading.nextExpiry > now) result.nextExpiry = result.nextExpiry === null ? reading.nextExpiry : Math.min(result.nextExpiry, reading.nextExpiry);
    result.stats[reading.active === true ? 'active' : reading.active === false ? 'clear' : 'uncertain']++;
    if (!record.location) result.stats.unplaced++; else if (!record.shown) result.stats.hidden++;
  }
  result.miniMap = result.records.filter((record) => record.shown && record.location).map((record) => ({
    id: `security:${record.id}`, entityId: record.entity, name: record.label, icon: record.icon, active: record.active === true, status: record.status,
    kind: 'security', color: record.color, position: { ...record.location } }));
  return result;
}

const helper = (object) => { object.userData.helper = true; object.raycast = () => {}; object.castShadow = false; object.receiveShadow = false; return object; };
function glyphGeometry(kind) {
  const rectangle = [[-.16, -.22], [.16, -.22], [.16, .22], [-.16, .22], [-.16, -.22]], points = [];
  const segment = (a, b) => points.push(a[0], 0, -a[1], b[0], 0, -b[1]);
  for (let i = 1; i < rectangle.length; i++) segment(rectangle[i - 1], rectangle[i]);
  if (kind === 'window') { segment([0, -.22], [0, .22]); segment([-.16, 0], [.16, 0]); }
  else if (kind === 'lock') {
    segment([-.1, .22], [-.1, .32]); segment([-.1, .32], [.1, .32]); segment([.1, .32], [.1, .22]); segment([0, -.04], [0, .06]);
  } else { segment([.1, -.03], [.1, .03]); }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
}
function validRecord(record) {
  const p = record?.location;
  return text(record?.id) && text(record?.entity) && ['door', 'window', 'opening', 'lock'].includes(record.kind) && plain(p)
    && text(p.floorId) && safe(p.x) && safe(p.y) && safe(p.z, SECURITY_LIMITS.maxHeight) && safe(p.elevation) && safe(p.elevation + p.z)
    && (record.color === null || typeof record.color === 'string' && /^#[a-f\d]{6}$/i.test(record.color))
    && finite(record.opacity) && record.opacity >= 0 && record.opacity <= 1;
}
// Identity describes the deliberately chosen source/target, not its changing live value.
function intentKey(record) {
  const target = record?.target, position = target?.position;
  return JSON.stringify([record?.entity, record?.kind, record?.location?.floorId, target?.type, target?.roomId,
    target?.position_key, target?.floorId, target?.z, position?.x, position?.y, position?.z, position?.floorId]);
}
const lostSource = new Set(['missing', 'unavailable', 'stale', 'unknown', 'invalid', 'hidden', 'disabled', 'contact_class']);

/** Owned static helper adapter. Records must already use the root's DISPLAY adapter once.
 * No animations/renderer/light/textures/timers/services. Geometry is shared only inside
 * this layer; semantic updates preserve its materials, glyphs and focused label nodes.
 * Optional onSelect(bindingId) opens root-owned actual controls; no command is sent here.
 * setData contextKey must change with the root's current session/layout/model/view scope;
 * selectable/visibility loss and changed sources poison a held gesture through recovery.
 */
export class PlanSecurityLayer {
  constructor(parent, { onInvalidate, document: doc = globalThis.document, onSelect, returnFocus } = {}) {
    this.group = helper(new THREE.Group()); this.group.name = 'taylors3d-plan-security'; parent.add(this.group);
    this.parts = new Map(); this.geometries = new Map(); this.doc = doc; this.onInvalidate = onInvalidate;
    this.onSelect = typeof onSelect === 'function' ? onSelect : null; this.returnFocus = returnFocus;
    this.disposed = false; this.selectable = true; this.contextKey = undefined; this._planes = []; this._planeKey = '[]';
    this.ringGeometry = new THREE.RingGeometry(.27, .31, 32); this.ringGeometry.rotateX(-Math.PI / 2);
  }
  get moving() { return false; }
  update() { return false; }
  _geometry(kind) {
    const shape = kind === 'opening' ? 'door' : kind;
    if (!this.geometries.has(shape)) this.geometries.set(shape, glyphGeometry(shape)); return this.geometries.get(shape);
  }
  _label(id) {
    if (!this.doc?.createElement) return null;
    const element = this.doc.createElement('div'), body = this.doc.createElement(this.onSelect ? 'button' : 'span');
    element.dataset.taylors3dUi = 'plan-security'; element.className = 'taylors3d-plan-security-label'; element.dataset.securityId = id;
    body.textContent = ''; body.style.cssText = 'box-sizing:border-box;display:inline-block;min-width:44px;min-height:44px;max-width:200px;padding:6px 9px;border:1px solid var(--divider-color,#888);border-radius:9px;background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color,#212121);font:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    element.style.pointerEvents = this.onSelect ? 'auto' : 'none';
    const listeners = [];
    if (this.onSelect) {
      body.type = 'button'; body.dataset.securityId = id;
      const current = () => { const part = this.parts.get(id); return part?.body === body ? part : null; };
      const poison = () => { const part = current(); if (part?.gesture) part.gesture.poisoned = true; };
      const capture = () => {
        const part = current(); if (!this._canSelect(part)) return;
        part.gesture = { contextKey: this.contextKey, key: intentKey(part.record), status: part.record.status, poisoned: false, used: false };
      };
      const listen = (name, handler) => { body.addEventListener(name, handler); listeners.push([name, handler]); };
      listen('pointerdown', (event) => { event.stopPropagation(); if (event.button === undefined || event.button === 0) capture(); else poison(); });
      listen('pointercancel', (event) => { event.stopPropagation(); poison(); });
      listen('blur', poison);
      listen('click', (event) => {
        event.stopPropagation(); const part = current(); if (!this._canSelect(part)) return;
        this._observeGesture(part);
        if (part.gesture?.poisoned || part.gesture?.used) return;
        if (part.gesture) part.gesture.used = true;
        this.onSelect(id);
      });
      listen('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { poison(); event.preventDefault(); this.returnFocus?.(); }
        else if (event.key === ' ' || event.key === 'Enter') {
          if (event.repeat) event.preventDefault(); else capture();
        }
      });
      listen('keyup', (event) => event.stopPropagation());
    }
    element.append(body); const label = helper(new CSS2DObject(element)); label.center.set(.5, 1.25); label.renderOrder = 1001;
    return { label, body, clearLabelListeners: () => { for (const [name, handler] of listeners) body.removeEventListener(name, handler); } };
  }
  _create(record) {
    const group = helper(new THREE.Group()), ringMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      lineMaterial = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
    const ring = helper(new THREE.Mesh(this.ringGeometry, ringMaterial)), glyph = helper(new THREE.LineSegments(this._geometry(record.kind), lineMaterial));
    ring.renderOrder = 7; glyph.renderOrder = 8; group.add(ring, glyph);
    const label = this._label(record.id); if (label) { label.label.position.y = .06; group.add(label.label); }
    group.visible = false; this.group.add(group); return { group, ring, glyph, ringMaterial, lineMaterial, ...label, record: null, gesture: null, key: '', shown: false };
  }
  _canSelect(part) {
    return !!part && !this.disposed && this.selectable && this.group.visible && part.group.visible && !part.body?.disabled;
  }
  _observeGesture(part) {
    const gesture = part.gesture; if (!gesture || gesture.poisoned) return;
    if (!this._canSelect(part) || gesture.contextKey !== this.contextKey || gesture.key !== intentKey(part.record)
      || lostSource.has(part.record?.status) && gesture.status !== part.record.status) gesture.poisoned = true;
  }
  _visible(part) {
    const clipped = this._planes.some((plane) => plane.distanceToPoint(part.group.position) < 0);
    const visible = this.group.visible && part.shown && !clipped;
    const changed = part.group.visible !== visible; part.group.visible = visible;
    if (part.label) { part.label.visible = visible; part.label.element.hidden = !visible; }
    if (part.body?.tagName === 'BUTTON') part.body.disabled = !visible || !this.selectable;
    this._observeGesture(part);
    return changed;
  }
  setData({ records = [], selectable = true, contextKey } = {}) {
    if (this.disposed) return false;
    const keep = new Set(), ids = new Map(), values = Array.isArray(records) && records.length <= SECURITY_LIMITS.maxBindings ? records : [];
    for (const record of values) if (text(record?.id)) ids.set(record.id, (ids.get(record.id) || 0) + 1);
    let changed = false; this.selectable = selectable === true; this.contextKey = contextKey;
    for (const record of values) {
      if (!validRecord(record) || ids.get(record.id) !== 1) continue;
      keep.add(record.id); let part = this.parts.get(record.id);
      if (!part) { part = this._create(record); this.parts.set(record.id, part); }
      part.record = record;
      const p = record.location, shown = record.shown === true && record.color !== null && record.opacity > 0;
      const key = JSON.stringify([record.kind, p.x, p.y, p.z, p.elevation, p.floorId, record.color, record.opacity, record.label || record.name || record.id, shown]);
      if (part.key !== key) {
        const wasVisible = part.group.visible && part.shown;
        part.key = key; part.group.position.set(p.x, p.elevation + p.z, -p.y); part.glyph.geometry = this._geometry(record.kind);
        if (record.color) { part.ringMaterial.color.set(record.color); part.lineMaterial.color.set(record.color); }
        part.ringMaterial.opacity = record.opacity * .7; part.lineMaterial.opacity = record.opacity;
        part.ringMaterial.clippingPlanes = this._planes; part.lineMaterial.clippingPlanes = this._planes;
        part.shown = shown;
        if (part.body) {
          const label = record.label || record.name || record.id; part.body.textContent = label; part.body.title = label;
          part.body.setAttribute('aria-label', label);
        }
        changed = this._visible(part) || wasVisible || part.group.visible || changed;
      } else this._visible(part);
    }
    for (const [id, part] of this.parts) if (!keep.has(id)) { changed = part.group.visible || changed; this._remove(part); this.parts.delete(id); }
    if (changed && this.group.visible) this.onInvalidate?.(); return changed && this.group.visible;
  }
  setVisible(value) {
    if (this.disposed || typeof value !== 'boolean' || value === this.group.visible) return false;
    const wasVisible = [...this.parts.values()].some((part) => part.group.visible);
    this.group.visible = value; for (const part of this.parts.values()) this._visible(part);
    const changed = wasVisible || [...this.parts.values()].some((part) => part.group.visible);
    if (changed) this.onInvalidate?.(); return changed;
  }
  setClippingPlanes(planes = []) {
    if (this.disposed) return false;
    if (!Array.isArray(planes) || planes.some((p) => !p?.isPlane || ![...p.normal.toArray(), p.constant].every(finite))) throw new TypeError('Plan security needs finite Three.js clipping planes.');
    const key = JSON.stringify(planes.map((p) => [...p.normal.toArray(), p.constant]));
    if (key === this._planeKey) return false; this._planeKey = key; this._planes = planes.map((p) => p.clone());
    let changed = false;
    for (const part of this.parts.values()) {
      part.ringMaterial.clippingPlanes = this._planes; part.lineMaterial.clippingPlanes = this._planes;
      part.ringMaterial.needsUpdate = true; part.lineMaterial.needsUpdate = true;
      changed = this._visible(part) || part.group.visible || changed;
    }
    if (changed && this.group.visible) this.onInvalidate?.(); return changed && this.group.visible;
  }
  _remove(part) {
    if (part.gesture) part.gesture.poisoned = true;
    part.clearLabelListeners?.();
    if (part.label) { part.label.element.remove(); part.label.removeFromParent(); }
    part.group.removeFromParent(); part.ringMaterial.dispose(); part.lineMaterial.dispose();
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const part of this.parts.values()) this._remove(part); this.parts.clear();
    for (const geometry of this.geometries.values()) geometry.dispose(); this.geometries.clear();
    this.ringGeometry.dispose(); this.group.removeFromParent();
  }
}
