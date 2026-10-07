// A room panel has one set of real controls. This controller changes only its
// presentation; resizing a sheet cannot call a Home Assistant service or save.
import { localize, localeInfo } from './localization.js';
import captions from './translations/room-sheet.js';

const text = (hass, key, params = {}) => localize(hass, `roomSheet.${key}`, params,
  (captions[localeInfo(hass).resolved] || captions.en)[`roomSheet.${key}`] || captions.en[`roomSheet.${key}`] || key);
export const ROOM_SHEET_MODES = Object.freeze(['summary', 'controls', 'details']);
export const ROOM_SHEET_LIMITS = Object.freeze({ narrowBelow: 740, controls: 320, details: 560, dragThreshold: 6 });
const px = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e6;

export function roomSheetHeights(baseHeight = 520, availableHeight) {
  const height = px(baseHeight) && baseHeight > 0 ? baseHeight : 520;
  const available = px(availableHeight) ? availableHeight : height;
  const maximum = Math.max(0, available - 16);
  return { summary: Math.min(200, maximum), controls: Math.min(maximum, Math.max(240, Math.min(ROOM_SHEET_LIMITS.controls, available * .48))),
    details: Math.min(maximum, Math.max(360, Math.min(ROOM_SHEET_LIMITS.details, available * .92))) };
}

function sameContext(a, b) {
  return !!a && !!b && b.ready === true && a.ready === true && a.key === b.key && a.auth === b.auth
    && a.connection === b.connection && a.callService === b.callService && a.user === b.user;
}

export class RoomSheet {
  constructor(popup, { getContext, getHass, onChange } = {}) {
    this.popup = popup; this.getContext = getContext; this.getHass = getHass || (() => ({})); this.onChange = onChange || (() => {});
    this.mode = 'controls'; this.narrow = false; this.heights = roomSheetHeights(); this.disposed = false;
    this.intents = new Map(); this.drag = null; this.suppressHandleClick = false;
    this.element = document.createElement('div'); this.element.className = 't3d-room-sheet-tools'; this.element.hidden = true;
    this.handle = document.createElement('button'); this.handle.type = 'button'; this.handle.className = 't3d-room-sheet-handle';
    this.handle.dataset.roomSheetHandle = '';
    const grip = document.createElement('span'); grip.setAttribute('aria-hidden', 'true'); this.handle.append(grip);
    this.modes = document.createElement('div'); this.modes.className = 't3d-room-sheet-modes'; this.modes.setAttribute('role', 'group');
    this.buttons = new Map();
    for (const mode of ROOM_SHEET_MODES) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.roomSheetMode = mode;
      this.buttons.set(mode, button); this.modes.append(button);
    }
    this.element.append(this.handle, this.modes);
    this.listeners = [
      ['pointerdown', (event) => this._press(event)], ['pointermove', (event) => this._move(event)],
      ['pointerup', (event) => this._release(event)], ['pointercancel', (event) => this._cancel(event)],
      ['lostpointercapture', (event) => this._cancel(event)], ['keydown', (event) => this._key(event)],
      ['keyup', (event) => this._keyRelease(event)], ['focusout', (event) => this._blur(event)], ['click', (event) => this._click(event)],
    ];
    for (const [name, listener] of this.listeners) this.element.addEventListener(name, listener);
    this.window = popup.ownerDocument.defaultView;
    this.outsideRelease = (event) => {
      for (const [target, intent] of this.intents) if (intent.pointerId === event.pointerId && intent.held) {
        intent.held = false;
        // Window listeners see the card host as target across a shadow root.
        // Its composed path retains the actual owned room-sheet controls.
        const inside = event.composedPath?.().includes(this.element) || this.element.contains(event.target);
        if (!inside || !sameContext(intent.context,this.context())) intent.poisoned = true;
        if (intent.consumed && !intent.poisoned) this.intents.delete(target);
      }
    };
    this.window?.addEventListener('pointerup',this.outsideRelease,true);
    this.window?.addEventListener('pointercancel',this.outsideRelease,true);
    this.paint();
  }
  context() {
    try { return this.getContext?.() || null; } catch { return null; }
  }
  observe() {
    if (this.disposed) return;
    const context = this.context();
    for (const intent of this.intents.values()) if (!sameContext(intent.context, context)) intent.poisoned = true;
    if (this.drag && !sameContext(this.drag.context, context)) this._cancelDrag();
    this.paint();
  }
  updateGeometry({ width, baseHeight, availableHeight } = {}) {
    if (this.disposed || !px(width) || !px(baseHeight)) return;
    const narrow = width > 0 && width < ROOM_SHEET_LIMITS.narrowBelow, heights = roomSheetHeights(baseHeight, availableHeight);
    const changed = narrow !== this.narrow || this.heights[this.mode] !== heights[this.mode];
    if (changed) { this._cancelDrag(); for (const intent of this.intents.values()) intent.poisoned = true; }
    this.narrow = narrow; this.heights = heights;
    this.popup.toggleAttribute('data-room-sheet-short', narrow && heights.details < 360);
    this.paint();
    // Root already owns this resize. Do not request another frame here.
  }
  setMode(mode, { context = this.context() } = {}) {
    if (this.disposed || !this.narrow || !ROOM_SHEET_MODES.includes(mode) || !sameContext(context, this.context())) return false;
    if (this.mode === mode) return true;
    this.mode = mode; this.paint(); this.onChange(mode); return true;
  }
  paint() {
    if (this.disposed) return;
    const hass = this.getHass(), ready = this.context()?.ready === true;
    this.element.hidden = !this.narrow;
    this.popup.dataset.roomSheet = this.narrow ? this.mode : 'desktop';
    if (this.narrow) this.popup.style.setProperty('--taylors3d-room-sheet-height', `${this.heights[this.mode]}px`);
    else this.popup.style.removeProperty('--taylors3d-room-sheet-height');
    this.handle.setAttribute('aria-label', text(hass, 'drag'));
    this.handle.title = text(hass, 'drag'); this.handle.disabled = !ready;
    this.handle.setAttribute('aria-expanded', String(this.mode === 'details'));
    this.modes.setAttribute('aria-label', text(hass, 'size'));
    for (const [mode, button] of this.buttons) {
      button.textContent = text(hass, mode); button.disabled = !ready;
      button.setAttribute('aria-pressed', String(this.mode === mode));
    }
  }
  _target(event) {
    const target = event.target?.closest?.('button');
    return target && this.element.contains(target) ? target : null;
  }
  _press(event) {
    const target = this._target(event); if (!target || target.disabled || !this.narrow || event.button !== 0 || event.isPrimary === false) return;
    const previous = this.intents.get(target); if (previous?.held) return;
    const context = this.context();
    this.intents.set(target, { context, held: true, poisoned: context?.ready !== true, consumed: false, pointerId: event.pointerId });
    if (target !== this.handle || context?.ready !== true) return;
    event.preventDefault();
    this.drag = { pointerId: event.pointerId, context, startY: event.clientY, height: this.heights[this.mode], current: this.heights[this.mode], moved: false };
    this.suppressHandleClick = false;
    try { this.handle.setPointerCapture(event.pointerId); } catch { /* Detached/test surfaces cannot capture. */ }
  }
  _move(event) {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointerId) return;
    if (!sameContext(drag.context, this.context())) { this._cancelDrag(); return; }
    const delta = drag.startY - event.clientY;
    if (!Number.isFinite(delta)) { this._cancelDrag(); return; }
    drag.moved ||= Math.abs(delta) >= ROOM_SHEET_LIMITS.dragThreshold;
    if (!drag.moved) return;
    event.preventDefault();
    drag.current = Math.max(this.heights.summary, Math.min(this.heights.details, drag.height + delta));
    this.popup.dataset.roomSheetDragging = '';
    this.popup.style.setProperty('--taylors3d-room-sheet-height', `${drag.current}px`);
    // The panel remains bottom-anchored during a temporary drag preview. Root
    // observes the final sheet once at the snap, never per move. The drawing
    // rectangle stays unchanged throughout the gesture.
  }
  _release(event) {
    const target = this._target(event), intent = this.intents.get(target);
    if (intent?.pointerId === event.pointerId) { intent.held = false; if (!sameContext(intent.context, this.context())) intent.poisoned = true; }
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null; this.popup.removeAttribute('data-room-sheet-dragging');
    if (drag.moved) {
      this.suppressHandleClick = true;
      if (intent) intent.consumed = true;
      const mode = ROOM_SHEET_MODES.reduce((best, next) => Math.abs(this.heights[next] - drag.current) < Math.abs(this.heights[best] - drag.current) ? next : best);
      this.setMode(mode, { context: drag.context });
    }
    this.paint();
    try { if (this.handle.hasPointerCapture(event.pointerId)) this.handle.releasePointerCapture(event.pointerId); } catch { /* Closing a panel may already release capture. */ }
  }
  _cancelDrag() {
    const drag = this.drag; this.drag = null;
    if (drag) { const intent = this.intents.get(this.handle); if (intent) { intent.poisoned = true; intent.held = false; } this.suppressHandleClick = true; }
    this.popup.removeAttribute('data-room-sheet-dragging');
    this.paint();
    if (drag) try { if (this.handle.hasPointerCapture(drag.pointerId)) this.handle.releasePointerCapture(drag.pointerId); } catch { /* Already detached. */ }
  }
  _cancel(event) {
    const intent = this.intents.get(this._target(event)); if (intent) { intent.poisoned = true; intent.held = false; }
    if (this.drag?.pointerId === event.pointerId) this._cancelDrag();
  }
  _key(event) {
    const target = this._target(event); if (!target || target.disabled || !this.narrow) return;
    if (target === this.handle && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); if (event.repeat) return;
      const index = ROOM_SHEET_MODES.indexOf(this.mode), mode = event.key === 'Home' ? 'summary' : event.key === 'End' ? 'details'
        : ROOM_SHEET_MODES[Math.max(0, Math.min(2, index + (event.key === 'ArrowUp' ? 1 : -1)))];
      this.setMode(mode); return;
    }
    if (![' ', 'Enter'].includes(event.key)) return;
    const previous = this.intents.get(target);
    if (event.repeat || previous?.held) { event.preventDefault(); return; }
    const context = this.context(); this.intents.set(target, { context, held: true, poisoned: context?.ready !== true, consumed: false, key: event.key });
  }
  _keyRelease(event) {
    const intent = this.intents.get(this._target(event)); if (!intent || intent.key !== event.key) return;
    intent.held = false; if (!sameContext(intent.context, this.context())) intent.poisoned = true;
    if (intent.consumed && !intent.poisoned) this.intents.delete(this._target(event));
  }
  _blur(event) {
    const intent = this.intents.get(this._target(event)); if (intent?.held) { intent.poisoned = true; intent.held = false; }
    if (event.target === this.handle && this.drag) this._cancelDrag();
  }
  _click(event) {
    const target = this._target(event); if (!target || target.disabled || !this.narrow) return;
    event.stopPropagation();
    if (target === this.handle && this.suppressHandleClick) { this.suppressHandleClick = false; return; }
    const intent = this.intents.get(target), context = this.context();
    if (intent && (intent.poisoned || intent.consumed || !sameContext(intent.context, context))) return;
    if (intent) { intent.consumed = true; if (!intent.held) this.intents.delete(target); }
    const mode = target === this.handle ? ROOM_SHEET_MODES[Math.min(2, ROOM_SHEET_MODES.indexOf(this.mode) + 1)] : target.dataset.roomSheetMode;
    this.setMode(mode, { context });
  }
  dispose() {
    if (this.disposed) return;
    this._cancelDrag(); this.disposed = true;
    for (const [name, listener] of this.listeners) this.element.removeEventListener(name, listener);
    this.window?.removeEventListener('pointerup',this.outsideRelease,true);
    this.window?.removeEventListener('pointercancel',this.outsideRelease,true);
    this.intents.clear(); this.element.remove(); this.popup.removeAttribute('data-room-sheet');
    this.popup.style.removeProperty('--taylors3d-room-sheet-height');
    this.popup.removeAttribute('data-room-sheet-short');
  }
}
