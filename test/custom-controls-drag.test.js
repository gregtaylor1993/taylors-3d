// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomControlsDrag } from '../src/custom-controls-drag.js';
import { moveCustomBar, moveCustomButton } from '../src/custom-controls.js';

const owners = [];
const button = (id) => ({ id, label: id, icon: 'mdi:movie', color: 'amber', action: { type: 'scene', entity: 'scene.movie' }, extra: { keep: id } });
function pointer(node, type, { x = 10, y = 10, id = 1, ...extra } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0, isPrimary: true, ...extra }); node.dispatchEvent(event); return event;
}
function setup() {
  const root = document.createElement('section'); root.dataset.taylors3dUi = 'custom-controls-editor'; document.body.append(root);
  root.innerHTML = `<div data-cc-bars><article data-cc-bar-row="bottom"><button data-cc-drag="bar" data-cc-bar="bottom">Drag bottom</button>
    <div><div data-cc-button-row="one"><button data-cc-drag="button" data-cc-bar="bottom" data-cc-button="one">Drag one</button><input></div>
    <div data-cc-button-row="two"><button data-cc-drag="button" data-cc-bar="bottom" data-cc-button="two">Drag two</button></div></div></article>
    <article data-cc-bar-row="room"><button data-cc-drag="bar" data-cc-bar="room">Drag room</button><div><div data-cc-button-row="three"><button data-cc-drag="button" data-cc-bar="room" data-cc-button="three">Drag three</button></div></div></article></div>`;
  for (const row of root.querySelectorAll('[data-cc-bar-row],[data-cc-button-row]')) row.getBoundingClientRect = () => ({ top: 50, height: 100 });
  const initial = { version: 1, bars: [{ id: 'bottom', label: 'Bottom', placement: 'bottom', style: 'pills', buttons: [button('one'), button('two')], barExtra: true },
    { id: 'room', label: 'Room', placement: 'room', room_id: 'model:lounge', style: 'tiles', buttons: [button('three')] }], extra: ['kept'] };
  let draft = initial, context = { account: 'admin', key: 'home' }, allowed = true, target;
  const hit = vi.fn(() => target); Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  const moved = vi.fn((item, destination) => { draft = item.kind === 'bar' ? moveCustomBar(draft, item.barId, destination.beforeId)
    : moveCustomButton(draft, item.barId, item.buttonId, destination.toBarId, destination.beforeId); });
  const status = vi.fn(), drag = new CustomControlsDrag(root, { getContext: () => context, sameContext: (a, b) => a === b, canDrag: () => allowed, onMove: moved, onStatus: status });
  owners.push(drag);
  const handle = (kind, barId, buttonId) => [...root.querySelectorAll('[data-cc-drag]')].find((node) => node.dataset.ccDrag === kind && node.dataset.ccBar === barId && (!buttonId || node.dataset.ccButton === buttonId));
  const row = (id) => [...root.querySelectorAll('[data-cc-button-row]')].find((node) => node.dataset.ccButtonRow === id);
  return { root, drag, status, moved, handle, row, initial, draft: () => draft, hit, pointAt: (node) => { target = node; },
    replaceContext: () => { context = { account: 'other', key: 'home' }; }, block: () => { allowed = false; } };
}
afterEach(() => { owners.splice(0).forEach((drag) => drag.dispose()); document.body.replaceChildren(); delete document.elementFromPoint; vi.restoreAllMocks(); });

describe('native pointer custom control reorder', () => {
  it.each(['mouse', 'touch'])('uses an explicit %s handle, preserves scope/extras and only changes the draft on release', (pointerType) => {
    const h = setup(), handle = h.handle('button', 'bottom', 'one'), parentMove = vi.fn(); h.root.parentNode.addEventListener('pointermove', parentMove);
    h.pointAt(h.row('three')); const down = pointer(handle, 'pointerdown', { pointerType }); expect(down.defaultPrevented).toBe(true); expect(h.drag.active).toBe(true);
    pointer(window, 'pointermove', { y: 60, pointerType }); expect(h.moved).not.toHaveBeenCalled(); expect(h.draft()).toBe(h.initial);
    const up = pointer(window, 'pointerup', { y: 60, pointerType }); expect(up.defaultPrevented).toBe(true); expect(h.drag.active).toBe(false); expect(h.moved).toHaveBeenCalledOnce();
    expect(h.draft().bars[0].buttons.map((row) => row.id)).toEqual(['two']); expect(h.draft().bars[1].buttons.map((row) => row.id)).toEqual(['one', 'three']);
    expect(h.draft().bars[1].buttons[0].extra).toEqual({ keep: 'one' }); expect(h.draft().extra).toEqual(['kept']); expect(h.initial.bars[0].buttons).toHaveLength(2);
    expect(parentMove).not.toHaveBeenCalled(); expect(h.status.mock.calls.map(([value]) => value)).toEqual([true, false]);
  });
  it('reorders a whole room bar without changing its exact room or placement', () => {
    const h = setup(); h.pointAt(h.root.querySelector('[data-cc-bar-row=bottom]')); pointer(h.handle('bar', 'room'), 'pointerdown'); pointer(window, 'pointerup', { y: 60 });
    expect(h.draft().bars.map((bar) => bar.id)).toEqual(['room', 'bottom']); expect(h.draft().bars[0]).toMatchObject({ placement: 'room', room_id: 'model:lounge' });
  });
  it('handles the final up coordinates, button-after insertion, and empty-bar drop', () => {
    const h = setup(); h.pointAt(h.row('two')); pointer(h.handle('button', 'bottom', 'one'), 'pointerdown'); pointer(window, 'pointerup', { y: 140 });
    expect(h.draft().bars[0].buttons.map((row) => row.id)).toEqual(['two', 'one']);
    h.pointAt(h.root.querySelector('[data-cc-bar-row=room]')); pointer(h.handle('button', 'bottom', 'two'), 'pointerdown'); pointer(window, 'pointerup', { y: 120 });
    expect(h.draft().bars[1].buttons.map((row) => row.id)).toEqual(['three', 'two']);
  });
  it('does not begin from fields, outside handles, right clicks, secondary pointers or invalid coordinates', () => {
    const h = setup(); expect(pointer(h.root.querySelector('input'), 'pointerdown').defaultPrevented).toBe(false);
    const handle = h.handle('bar', 'bottom');
    for (const data of [{ button: 2 }, { isPrimary: false }, { id: -1 }, { id: '1' }, { x: NaN }, { y: Infinity }]) {
      expect(pointer(handle, 'pointerdown', data).defaultPrevented).toBe(false); expect(h.drag.active).toBe(false);
    }
    h.block(); pointer(handle, 'pointerdown'); expect(h.drag.active).toBe(false); expect(h.moved).not.toHaveBeenCalled();
  });
  it.each(['Escape', 'pointercancel', 'blur', 'context', 'blocked', 'detached', 'capture'])('cancels %s safely and ignores the delayed release', (reason) => {
    const h = setup(), handle = h.handle('button', 'bottom', 'one'); h.pointAt(h.row('three')); pointer(handle, 'pointerdown'); pointer(window, 'pointermove', { y: 60 });
    if (reason === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    if (reason === 'pointercancel') pointer(window, 'pointercancel'); if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'context') { h.replaceContext(); h.drag.update(); } if (reason === 'blocked') { h.block(); h.drag.update(); }
    if (reason === 'detached') { handle.remove(); h.drag.update(); } if (reason === 'capture') pointer(handle, 'lostpointercapture');
    expect(h.drag.active).toBe(false); pointer(window, 'pointerup', { y: 60 }); expect(h.moved).not.toHaveBeenCalled(); expect(h.draft()).toBe(h.initial);
    expect(h.root.querySelector('[data-cc-drop]')).toBeNull();
  });
  it('ignores another pointer and an outside drop; a tap does not reorder', () => {
    const h = setup(); h.pointAt(h.row('three')); pointer(h.handle('button', 'bottom', 'one'), 'pointerdown');
    expect(pointer(window, 'pointermove', { id: 2, y: 60 }).defaultPrevented).toBe(false); pointer(window, 'pointerup', { id: 2 }); expect(h.drag.active).toBe(true);
    h.pointAt(document.body); pointer(window, 'pointerup', { y: 60 }); expect(h.moved).not.toHaveBeenCalled();
    pointer(h.handle('button', 'bottom', 'one'), 'pointerdown'); pointer(window, 'pointerup'); expect(h.moved).not.toHaveBeenCalled();
  });
  it('consumes handle clicks and cleans native listeners/capture when disposed during a drag', () => {
    const h = setup(), handle = h.handle('bar', 'bottom'); handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn();
    const later = vi.fn(); h.root.addEventListener('click', later); const click = new MouseEvent('click', { bubbles: true, cancelable: true }); handle.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true); expect(later).not.toHaveBeenCalled(); pointer(handle, 'pointerdown'); expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    h.drag.dispose(); expect(handle.releasePointerCapture).toHaveBeenCalledWith(1); pointer(window, 'pointerup', { y: 70 }); pointer(handle, 'pointerdown');
    expect(h.drag.active).toBe(false); expect(h.moved).not.toHaveBeenCalled(); expect(h.root.querySelector('[data-cc-dragging]')).toBeNull();
  });
});
