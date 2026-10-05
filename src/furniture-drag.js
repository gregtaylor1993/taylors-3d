// Draft-only furniture dragging. The card owns saved layout/history, the
// catalogue/layer and the existing renderer; this helper owns one native gesture.
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const point = (value) => Array.isArray(value) && value.length === 2 && value.every(finite);
const pointer = (event) => event?.pointerId;
const validPointer = (event) => pointer(event) === undefined || Number.isSafeInteger(pointer(event)) && pointer(event) >= 0;
const stamp = (value) => { try { return JSON.stringify(value); } catch { return null; } };
const consume = (event) => { event?.preventDefault?.(); event?.stopPropagation?.(); event?.stopImmediatePropagation?.(); };

/** FurnitureDrag(card,{editor,getLayer,onSelect?}).
 * down(event) accepts only a real visible furniture hit in Edit -> Furniture.
 * update() must run after source/layout/session/floor/editor updates; cancel()
 * before history or tab/source teardown. up(event) may be forwarded by the card
 * to consume a cancelled gesture's later release after window listeners detach.
 * consumeClick(event) consumes its following native pointer click, never a
 * keyboard/accessibility click. No movement saves, invokes a service or creates
 * a history entry. onSelect(id) is the only selection hook; it may change the
 * editor's selection, after which the current opaque handle is captured again.
 */
export class FurnitureDrag {
  constructor(card, { editor, getLayer, onSelect } = {}) {
    this.card = card; this.editor = editor; this.getLayer = getLayer; this.onSelect = onSelect;
    this.disposed = false; this._gesture = null; this._releaseIntent = null; this._clickIntent = null;
    this._window = card?.ownerDocument?.defaultView || globalThis.window;
    this._document = card?.ownerDocument || this._window?.document;
    this._handlers = new Map([['pointermove', (event) => this.move(event)], ['pointerup', (event) => this.up(event)],
      ['pointercancel', (event) => this.up(event, true)], ['blur', () => this.cancel()],
      ['keydown', (event) => { if (event.key === 'Escape' && this._gesture) { consume(event); this.cancel(); } }]]);
    this._visibility = () => { if (this._document?.hidden) this.cancel(); };
  }
  get active() { return !!this._gesture; }
  get moved() { return !!this._gesture?.moved; }
  _layer() { try { return this.getLayer?.() || null; } catch { return null; } }
  _allowed() {
    const card = this.card, user = card?._hass?.user;
    return !this.disposed && !card?._loading && plain(card?._layout) && card?.isConnected === true
      && card?._editing === true && card?._edit?.tab === 'furniture' && this.editor?.canEdit === true
      && card?._hass?.connection?.connected === true && typeof user?.id === 'string' && user.id.trim() !== ''
      && user.is_admin === true && (!Object.hasOwn(user, 'is_active') || user.is_active === true) && !this._document?.hidden;
  }
  _floor(id) {
    const matches = Array.isArray(this.card?._floors) ? this.card._floors.filter((floor) => floor?.id === id) : [];
    const floor = matches[0];
    return matches.length === 1 && finite(floor?.elevation) && (!Object.hasOwn(floor, 'stale') || floor.stale === false) ? floor : null;
  }
  _handle(id, floorId) {
    try {
      const handles = this.editor?.draftPlacementHandles?.();
      const matches = Array.isArray(handles) ? handles.filter((handle) => handle?.id === id && handle.floor_id === floorId) : [];
      const handle = matches[0];
      return matches.length === 1 && typeof handle?.token === 'string' && handle.token.length > 0
        && [handle.x, handle.y, handle.z].every(finite) && this._floor(floorId) ? handle : null;
    } catch { return null; }
  }
  _shown(layer, id, floorId) {
    try {
      const rows = layer?.report?.()?.rows, matches = Array.isArray(rows) ? rows.filter((row) => row?.id === id) : [];
      return matches.length === 1 && matches[0].ready === true && matches[0].shown === true && matches[0].floorId === floorId;
    } catch { return false; }
  }
  _context(layer, floorId) {
    const card = this.card, view = card?._view, hass = card?._hass, floor = this._floor(floorId), user = hass?.user;
    let alignment; try { alignment = card?._modelAlign?.(); } catch { return null; }
    const key = stamp([card?._config?.layout_key, card?._config?.model || card?._layout?.model,
      card?._config?.model_position, card?._config?.model_rotation, card?._config?.model_scale, alignment,
      view?.mode, view?.visibleFloor, view?._visibleSet ? [...view._visibleSet].sort() : null,
      view?.floorPresentationRevision, view?.floorPresentationActive,
      view?.sectionClip ? [view.sectionClip.normal?.x, view.sectionClip.normal?.y, view.sectionClip.normal?.z, view.sectionClip.constant] : null,
      floor?.id, floor?.elevation, floor?.stale, user?.id, user?.permissions]);
    return key === null ? null : { layer, view, root: view?.model?.root || null, layout: card?._layout,
      connection: hass?.connection, auth: hass?.auth, user, controls: view?.controls, camera: view?.camera, key };
  }
  _same(previous, current) {
    return !!previous && !!current && ['layer', 'view', 'root', 'layout', 'connection', 'auth', 'user', 'controls', 'camera', 'key']
      .every((key) => previous[key] === current[key]);
  }
  _plan(event, floorId) {
    if (!finite(event?.clientX) || !finite(event?.clientY)) return null;
    const view = this.card?._view, floor = this._floor(floorId); if (!view || !floor) return null;
    try {
      // A present display adapter is authoritative; a failed split mapping must
      // never fall back to an assembled plane and save the display offset twice.
      if (typeof view.displayPlanPoint === 'function') {
        const result = view.displayPlanPoint(event.clientX, event.clientY, floorId); return point(result) ? result : null;
      }
      if (view.model || view.floorPresentationActive) return null;
      const result = view.planPoint?.(event.clientX, event.clientY, floor.elevation); return point(result) ? result : null;
    } catch { return null; }
  }
  _listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    for (const [type, handler] of this._handlers) this._window?.[method](type, handler, true);
    this._document?.[method]('visibilitychange', this._visibility, true);
  }
  _current(gesture) {
    if (!this._allowed() || !this._same(gesture.context, this._context(this._layer(), gesture.floorId))
      || !this._shown(gesture.context.layer, gesture.id, gesture.floorId)
      || gesture.context.controls && gesture.context.controls.enabled !== false) return false;
    const handle = this._handle(gesture.id, gesture.floorId);
    return !!handle && handle.token === gesture.token && handle.z === gesture.z
      && handle.x === gesture.lastAnchor[0] && handle.y === gesture.lastAnchor[1];
  }
  update() { if (this._gesture && !this._current(this._gesture)) this.cancel(); return this.active; }
  down(event) {
    if (!this._allowed() || !this._window || !validPointer(event) || event?.isPrimary === false
      || event?.button !== undefined && event.button !== 0 || !finite(event?.clientX) || !finite(event?.clientY)) return false;
    if (this._gesture) { if (pointer(event) === this._gesture.pointerId) { consume(event); return true; } return false; }
    this._releaseIntent = null; this._clickIntent = null;
    const layer = this._layer(); let hit;
    try { hit = layer?.hitTest?.(event.clientX, event.clientY); } catch { return false; }
    if (!hit || !this._shown(layer, hit.id, hit.floorId) || !this._handle(hit.id, hit.floorId) || !this._plan(event, hit.floorId)) return false;
    try { this.onSelect?.(hit.id); } catch { return false; }
    const handle = this._handle(hit.id, hit.floorId), start = this._plan(event, hit.floorId), context = this._context(layer, hit.floorId);
    if (!this._allowed() || !handle || !start || !context || this._layer() !== layer || !this._shown(layer, hit.id, hit.floorId)) return false;
    const controls = context.controls, previousEnabled = controls?.enabled, ownsControls = previousEnabled === true;
    if (ownsControls) controls.enabled = false;
    this._gesture = { id: hit.id, floorId: hit.floorId, token: handle.token, z: handle.z, context,
      pointerId: pointer(event), start: [event.clientX, event.clientY], lastScreen: [event.clientX, event.clientY],
      offset: [start[0] - handle.x, start[1] - handle.y], lastAnchor: [handle.x, handle.y], moved: false,
      ownsControls, previousEnabled };
    this._listen(true); consume(event); return true;
  }
  move(event) {
    const gesture = this._gesture; if (!gesture || !validPointer(event) || pointer(event) !== gesture.pointerId) return false;
    if (!this.update()) return false;
    if (!finite(event.clientX) || !finite(event.clientY)) return false; consume(event);
    gesture.lastScreen = [event.clientX, event.clientY];
    if (!gesture.moved && Math.hypot(event.clientX - gesture.start[0], event.clientY - gesture.start[1]) <= 5) return true;
    const plan = this._plan(event, gesture.floorId); if (!plan) return true;
    const anchor = [plan[0] - gesture.offset[0], plan[1] - gesture.offset[1]];
    // moveDraftInstance can synchronously publish its draft preview. A parent's
    // resulting update must compare against this intended anchor, not our old one.
    const previousAnchor = gesture.lastAnchor; gesture.lastAnchor = anchor;
    let accepted; try { accepted = this.editor.moveDraftInstance(gesture.id,
      { x: anchor[0], y: anchor[1], z: gesture.z }, gesture.token); } catch { accepted = false; }
    if (!accepted) { gesture.lastAnchor = previousAnchor; this.cancel(); return true; }
    gesture.moved = true; return true;
  }
  _finish() {
    const gesture = this._gesture; if (!gesture) return null;
    this._gesture = null; this._listen(false);
    if (gesture.ownsControls && this.card?._view === gesture.context.view && gesture.context.view?.controls === gesture.context.controls
      && gesture.context.controls.enabled === false) gesture.context.controls.enabled = gesture.previousEnabled;
    this._releaseIntent = { pointerId: gesture.pointerId, lastScreen: gesture.lastScreen };
    return gesture;
  }
  up(event, cancelled = false) {
    const intent = this._gesture || this._releaseIntent;
    if (!intent || !validPointer(event) || pointer(event) !== intent.pointerId) return false;
    if (this._gesture && !cancelled) this.move(event);
    this._finish(); consume(event);
    this._clickIntent = { pointerId: intent.pointerId, lastScreen: finite(event.clientX) && finite(event.clientY)
      ? [event.clientX, event.clientY] : intent.lastScreen.slice() };
    this._releaseIntent = null; return true;
  }
  consumeClick(event) {
    const intent = this._clickIntent;
    if (!intent || event?.detail === 0 || pointer(event) !== undefined && pointer(event) !== intent.pointerId
      || !finite(event?.clientX) || !finite(event?.clientY)
      || Math.hypot(event.clientX - intent.lastScreen[0], event.clientY - intent.lastScreen[1]) > 5) return false;
    this._clickIntent = null; consume(event); return true;
  }
  cancel() { this._finish(); }
  dispose() { this.cancel(); this._releaseIntent = null; this._clickIntent = null; this.disposed = true; }
}
