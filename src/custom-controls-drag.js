// One native draft gesture. No HA actions, history writes, timers or renderer work.
const consume = (event) => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Owned editor handles only; the editor revalidates the complete context on drop. */
export class CustomControlsDrag {
  constructor(root, { getContext, sameContext, canDrag, onMove, onStatus } = {}) {
    this.root = root; this.getContext = getContext; this.sameContext = sameContext;
    this.canDrag = canDrag; this.onMove = onMove; this.onStatus = onStatus;
    this.window = root.ownerDocument.defaultView; this.document = root.ownerDocument; this.disposed = false;
    this._down = (event) => this.down(event);
    this._click = (event) => { if (event.target.closest?.('[data-cc-drag]') && this.root.contains(event.target)) consume(event); };
    this.handlers = new Map([['pointermove', (event) => this.move(event)], ['pointerup', (event) => this.up(event)],
      ['pointercancel', (event) => this.up(event, true)], ['blur', () => this.cancel()],
      ['keydown', (event) => { if (event.key === 'Escape' && this.active) { consume(event); this.cancel(); } }]]);
    this._visibility = () => { if (this.document.hidden) this.cancel(); };
    this._captureLost = (event) => { if (this.gesture?.pointerId === event.pointerId) this.cancel(); };
    root.addEventListener('pointerdown', this._down, true); root.addEventListener('click', this._click, true);
    root.addEventListener('lostpointercapture', this._captureLost, true);
  }
  get active() { return !!this.gesture; }
  _listen(enabled) {
    const method = enabled ? 'addEventListener' : 'removeEventListener';
    for (const [name, handler] of this.handlers) this.window[method](name, handler, true);
    this.document[method]('visibilitychange', this._visibility, true);
  }
  _current() {
    return !this.disposed && this.root.isConnected && !this.document.hidden && this.gesture?.handle.isConnected
      && this.canDrag?.(this.gesture) === true && this.sameContext?.(this.gesture.context, this.getContext?.()) === true;
  }
  update() { if (this.active && !this._current()) this.cancel(); return this.active; }
  down(event) {
    const handle = event.target.closest?.('[data-cc-drag]');
    if (!handle || !this.root.contains(handle) || this.disposed || this.active || handle.disabled
      || event.isPrimary === false || event.button !== undefined && event.button !== 0
      || !Number.isSafeInteger(event.pointerId) || event.pointerId < 0 || !finite(event.clientX) || !finite(event.clientY)) return false;
    const item = { kind: handle.dataset.ccDrag, barId: handle.dataset.ccBar, buttonId: handle.dataset.ccButton,
      handle, pointerId: event.pointerId, start: [event.clientX, event.clientY], context: this.getContext?.(), moved: false };
    if (!item.context || !['bar', 'button'].includes(item.kind) || this.canDrag?.(item) !== true) return false;
    this.gesture = item; this._listen(true); handle.dataset.ccDragging = 'true';
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* Window listeners still own this pointer. */ }
    this.onStatus?.(true); consume(event); return true;
  }
  _hit(event) {
    // Pointer capture targets the handle, so hit-test the actual shadow/document surface.
    const surface = this.root.getRootNode(); let target;
    try { target = surface.elementFromPoint?.(event.clientX, event.clientY) || this.document.elementFromPoint?.(event.clientX, event.clientY); } catch { return null; }
    while (target?.shadowRoot?.elementFromPoint) {
      const inner = target.shadowRoot.elementFromPoint(event.clientX, event.clientY); if (!inner || inner === target) break; target = inner;
    }
    // Synthetic DOM environments may have no hit-test; native browsers never use this fallback.
    if (!surface.elementFromPoint && !this.document.elementFromPoint) target = event.target;
    return target && this.root.contains(target) ? target : null;
  }
  _destination(event) {
    const target = this._hit(event), bar = target?.closest?.('[data-cc-bar-row]'); if (!bar) return null;
    const barId = bar.dataset.ccBarRow;
    if (this.gesture.kind === 'bar') {
      const rect = bar.getBoundingClientRect(), after = event.clientY > rect.top + rect.height / 2;
      return { toBarId: barId, after, beforeId: after ? bar.nextElementSibling?.dataset.ccBarRow || null : barId };
    }
    const button = target.closest('[data-cc-button-row]');
    if (button && button.closest('[data-cc-bar-row]') === bar) {
      const rect = button.getBoundingClientRect(), after = event.clientY > rect.top + rect.height / 2;
      return { toBarId: barId, beforeId: after ? button.nextElementSibling?.dataset.ccButtonRow || null : button.dataset.ccButtonRow };
    }
    return { toBarId: barId, beforeId: null };
  }
  _clearMark() { if (this.mark) delete this.mark.dataset.ccDrop; this.mark = null; }
  move(event) {
    if (!this.active || event.pointerId !== this.gesture.pointerId) return false;
    consume(event); if (!this.update()) return true;
    if (!finite(event.clientX) || !finite(event.clientY)) return true;
    if (!this.gesture.moved && Math.hypot(event.clientX - this.gesture.start[0], event.clientY - this.gesture.start[1]) < 5) return true;
    this.gesture.moved = true; this.gesture.destination = this._destination(event); this._clearMark();
    if (this.gesture.destination) {
      this.mark = [...this.root.querySelectorAll('[data-cc-bar-row]')].find((bar) => bar.dataset.ccBarRow === this.gesture.destination.toBarId);
      if (this.mark) this.mark.dataset.ccDrop = 'true';
    }
    return true;
  }
  _finish() {
    const gesture = this.gesture; if (!gesture) return null;
    this.gesture = null; this._listen(false); this._clearMark(); delete gesture.handle.dataset.ccDragging;
    try { gesture.handle.releasePointerCapture?.(gesture.pointerId); } catch { /* Detached handle needs no capture. */ }
    this.onStatus?.(false); return gesture;
  }
  up(event, cancelled = false) {
    if (!this.active || event.pointerId !== this.gesture.pointerId) return false;
    consume(event); const current = !cancelled && this._current();
    if (current) this.move(event);
    const gesture = this._finish();
    if (current && gesture?.moved && gesture.destination && this.sameContext?.(gesture.context, this.getContext?.()) === true
      && this.canDrag?.(gesture) === true) this.onMove?.(gesture, gesture.destination);
    return true;
  }
  cancel() { this._finish(); }
  dispose() {
    this.cancel(); this.disposed = true;
    this.root.removeEventListener('pointerdown', this._down, true); this.root.removeEventListener('click', this._click, true);
    this.root.removeEventListener('lostpointercapture', this._captureLost, true);
  }
}
