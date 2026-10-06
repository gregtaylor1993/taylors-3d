// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, walk, generate } from 'css-tree';
import { CustomControlsView, CUSTOM_CONTROLS_VIEW_CSS } from '../src/custom-controls-view.js';

const instances = [];
let visibility;
const buttonData = (id = 'movie', patch = {}) => ({ id, label: id === 'movie' ? 'Movie' : id, icon: 'mdi:movie', color: 'amber', action: { type: 'scene', entity: 'scene.movie' }, available: true, issue: '', ...patch });
const barData = (id = 'evening', buttons = [buttonData()], patch = {}) => ({ id, label: 'Evening', style: 'pills', placement: 'bottom', buttons, ...patch });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function fixture(bars = [barData()], { callback = vi.fn(), shadow = false } = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const parent = shadow ? host.attachShadow({ mode: 'open' }) : host;
  const context = { bars, diagnostics: [], contextKey: 'session/layout/model/room', suspended: false, hass: { locale: { language: 'en' } } };
  const getContext = vi.fn(() => context);
  const view = new CustomControlsView(parent, { getContext, onAction: callback });
  instances.push({ view, host });
  const button = (id = 'movie') => view.el.querySelector(`button[data-custom-controls-button-id="${id}"]`);
  const status = (id = 'movie') => button(id)?.parentNode.querySelector('[role="status"]');
  return { host, parent, view, context, getContext, callback, button, status };
}
function pointer(target, type, values = {}) {
  const event = Object.assign(new Event(type, { bubbles: true, cancelable: true, composed: true }), { button: 0, pointerId: 7, clientX: 20, clientY: 20, isPrimary: true, ...values });
  target.dispatchEvent(event);
  return event;
}
function key(target, type, value, repeat = false) {
  const event = new KeyboardEvent(type, { key: value, repeat, bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(event);
  return event;
}
function click(target, detail = 0) { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail })); }
function press(target, values = {}) { pointer(target, 'pointerdown', values); pointer(target, 'pointerup', values); click(target, 1); }
beforeEach(() => { visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); });
afterEach(() => { for (const { view, host } of instances.splice(0)) { view.dispose(); host.remove(); } vi.restoreAllMocks(); });

describe('safe resolved controls and native accessibility', () => {
  it('shows only supplied bars and safe text, with exact owner IDs and no action on render', () => {
    const label = '<img src=x onerror="alert(1)">';
    const f = fixture([barData('evening', [buttonData('movie', { label })])]);
    expect(f.view.el.dataset.taylors3dUi).toBe('custom-controls');
    expect(f.view.el.getAttribute('aria-label')).toBe('Custom controls');
    expect(f.view.el.querySelector('h3').textContent).toBe('Evening');
    expect(f.button().type).toBe('button');
    expect(f.button().textContent).toBe(label);
    expect(f.view.el.querySelector('img')).toBeNull();
    expect(f.button().querySelector('ha-icon').getAttribute('icon')).toBe('mdi:movie');
    expect(f.button().querySelector('ha-icon').getAttribute('aria-hidden')).toBe('true');
    expect(f.button().hasAttribute('aria-pressed')).toBe(false);
    f.view.update();
    expect(f.callback).not.toHaveBeenCalled();
  });
  it('forwards only current exact bar/button IDs for label and icon clicks', async () => {
    const f = fixture();
    click(f.button().querySelector('ha-icon'));
    expect(f.callback).toHaveBeenCalledExactlyOnceWith('evening', 'movie');
    await flush();
    click(f.button().querySelector('span'));
    expect(f.callback).toHaveBeenCalledTimes(2);
    expect(f.callback.mock.calls[1]).toEqual(['evening', 'movie']);
  });
  it('uses a readable, labelled, disabled unavailable button without dropping it', () => {
    const f = fixture([barData('evening', [buttonData('movie', { available: false, issue: 'The saved camera view is missing.', issueCode: 'view' })])]);
    expect(f.button().disabled).toBe(true);
    expect(f.status().hidden).toBe(false);
    expect(f.status().textContent).toContain('saved view');
    expect(f.button().getAttribute('aria-describedby')).toBe(f.status().id);
    expect(f.button().title).toContain('Movie:');
    f.button().click();
    expect(f.callback).not.toHaveBeenCalled();
  });
  it('retains unknown plain availability wording as safe text', () => {
    const issue = '<script>private failure</script>';
    const f = fixture([barData('evening', [buttonData('movie', { available: false, issue })])]);
    expect(f.status().textContent).toBe(issue);
    expect(f.status().querySelector('script')).toBeNull();
  });
  it.each([{ bars: [] }, { bars: [barData('empty', [])] }])('hides an empty host without introducing default controls %#', ({ bars }) => {
    const f = fixture(bars);
    expect(f.view.el.hidden).toBe(true);
    expect(f.view.el.querySelectorAll('button')).toHaveLength(0);
    expect(f.callback).not.toHaveBeenCalled();
  });
  it('disables controls when no owner action callback is connected', () => {
    const f = fixture(undefined, { callback: null });
    expect(f.button().disabled).toBe(true);
    expect(() => click(f.button())).not.toThrow();
  });
  it('renders frozen settings without changing any raw source data', () => {
    const action = Object.freeze({ type: 'view', view_id: 'Front door' });
    const source = Object.freeze([Object.freeze(barData('evening', Object.freeze([Object.freeze(buttonData('movie', { action }))])))]);
    const f = fixture(source);
    f.view.update();
    expect(source[0].buttons[0].action).toBe(action);
    expect(Object.keys(source[0].buttons[0])).not.toContain('actionKey');
    expect(f.button().disabled).toBe(false);
  });
  it.each(['Movie\nNight', 'Movie\tNight', 'Movie\u0000Night'])('retains a core-valid imported label %j as literal text without hiding unrelated controls', (label) => {
    const f = fixture([barData('evening', [buttonData('movie', { label }), buttonData('other')], { label })]);
    expect(f.view.el.hidden).toBe(false); expect(f.button().textContent).toBe(label);
    expect(f.view.el.querySelector('h3').textContent).toBe(label); expect(f.button('other').disabled).toBe(false);
    expect(f.callback).not.toHaveBeenCalled();
  });
  it.each([
    { icon: 'https://example.com/image' }, { icon: 'mdi:movie" onclick=x' }, { color: 'url(private)' },
    { color: '#ffc767' }, { id: 'bad/id' }, { label: 'x'.repeat(81) }, { available: 'true' }, { issue: '\u0000' },
    { action: { type: 'invented', entity: 'scene.movie' } }, { action: { type: 'scene', entity: 'bad' } },
    { action: { type: 'view', view_id: '' } }, { action: { type: 'scene', entity: 'scene.movie', skip_conditions: true } },
  ])('fails closed for malformed resolved fields %#', (patch) => {
    const f = fixture([barData('evening', [buttonData('movie', patch)])]);
    expect(f.view.el.hidden).toBe(true);
    expect(f.button()).toBeNull();
    expect(f.callback).not.toHaveBeenCalled();
  });
  it('rejects duplicate bar IDs and globally duplicated button IDs without choosing a winner', () => {
    const f = fixture([barData(), barData()]);
    expect(f.view.el.hidden).toBe(true);
    f.context.bars = [barData(), barData('other')]; f.view.update();
    expect(f.view.el.hidden).toBe(true);
    expect(f.view.el.querySelectorAll('button')).toHaveLength(0);
  });
  it('never executes imported getters, even on array entries and action fields', () => {
    const getter = vi.fn(() => 'scene');
    const action = {};
    Object.defineProperty(action, 'type', { get: getter });
    const f = fixture([barData('evening', [buttonData('movie', { action })])]);
    expect(f.view.el.hidden).toBe(true);
    const bars = [];
    Object.defineProperty(bars, '0', { get: getter });
    f.context.bars = bars; f.view.update();
    expect(f.view.el.hidden).toBe(true);
    Object.defineProperty(f.context, 'bars', { get: getter }); f.view.update();
    expect(getter).not.toHaveBeenCalled();
  });
  it('accepts the exact maximum 96 buttons and rejects oversized lists instead of truncating', () => {
    const bars = Array.from({ length: 8 }, (_, index) => barData(`bar_${index}`, Array.from({ length: 12 }, (_, n) => buttonData(`button_${index}_${n}`))));
    const f = fixture(bars);
    expect(f.view.el.querySelectorAll('button')).toHaveLength(96);
    f.context.bars = [...bars, barData('overflow', [])]; f.view.update();
    expect(f.view.el.hidden).toBe(true);
    f.context.bars = [barData('large', Array.from({ length: 13 }, (_, n) => buttonData(`large_${n}`)))]; f.view.update();
    expect(f.view.el.hidden).toBe(true);
  });
  it('handles a throwing owner context safely and recovers only with current valid data', () => {
    const f = fixture();
    f.getContext.mockImplementationOnce(() => { throw new Error('unloaded'); });
    expect(() => f.view.update()).not.toThrow();
    expect(f.view.el.hidden).toBe(true);
    f.view.update();
    expect(f.view.el.hidden).toBe(false);
    expect(f.callback).not.toHaveBeenCalled();
  });
});

describe('keyed DOM, focus and ordinary readings', () => {
  it.each([false, true])('keeps keyboard focus and native node identity during readings/locale updates (shadow=%s)', (shadow) => {
    const f = fixture(undefined, { shadow });
    const original = f.button(); original.focus();
    f.context.hass = { locale: { language: 'de' }, states: { 'light.lounge': { state: 'on' } } };
    f.context.bars = [barData('evening', [buttonData('movie', { label: 'My movie', active: true, color: 'teal' })])];
    f.view.update();
    expect(f.button()).toBe(original);
    expect(f.parent.getRootNode().activeElement).toBe(original);
    expect(original.textContent).toBe('My movie');
    expect(original.getAttribute('aria-pressed')).toBe('true');
    expect(f.view.el.getAttribute('aria-label')).not.toBe('Custom controls');
    expect(f.callback).not.toHaveBeenCalled();
  });
  it('makes zero DOM writes for repeated equal data, without requesting size/frame work', () => {
    const f = fixture();
    const observer = new MutationObserver(() => {});
    observer.observe(f.view.el, { subtree: true, childList: true, attributes: true, characterData: true });
    const sizing = vi.spyOn(f.view.el, 'getBoundingClientRect');
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    const timer = vi.spyOn(globalThis, 'setTimeout');
    f.view.update(); f.view.update(); f.view.update();
    expect(observer.takeRecords()).toHaveLength(0);
    expect(sizing).not.toHaveBeenCalled(); expect(frame).not.toHaveBeenCalled(); expect(timer).not.toHaveBeenCalled();
    observer.disconnect();
  });
  it('keeps the focused node when buttons move between bars while changing its owner IDs', () => {
    const f = fixture([barData('one', [buttonData('movie'), buttonData('other')]), barData('two', [buttonData('third')])]);
    const original = f.button(); original.focus();
    f.context.bars = [barData('two', [buttonData('third'), buttonData('movie')]), barData('one', [buttonData('other')])];
    f.view.update();
    expect(f.button()).toBe(original); expect(document.activeElement).toBe(original);
    click(original);
    expect(f.callback).toHaveBeenCalledExactlyOnceWith('two', 'movie');
  });
  it('does not cancel a held action just because readings, labels, colours or language change', () => {
    const f = fixture(); pointer(f.button(), 'pointerdown');
    f.context.hass.locale.language = 'fr';
    f.context.bars[0].buttons[0] = buttonData('movie', { label: 'Actual Movie', color: 'purple', active: true });
    f.view.update(); pointer(f.button(), 'pointerup'); click(f.button(), 1);
    expect(f.callback).toHaveBeenCalledExactlyOnceWith('evening', 'movie');
    expect(f.button().getAttribute('aria-pressed')).toBe('true');
  });
  it('uses native arrows and Home/End to reach available buttons without running anything', () => {
    const f = fixture([barData('evening', [buttonData('first'), buttonData('missing', { available: false, issue: 'Missing' }), buttonData('last')])]);
    f.button('first').focus(); key(f.button('first'), 'keydown', 'ArrowRight');
    expect(document.activeElement).toBe(f.button('last'));
    key(f.button('last'), 'keydown', 'Home'); expect(document.activeElement).toBe(f.button('first'));
    key(f.button('first'), 'keydown', 'End'); expect(document.activeElement).toBe(f.button('last'));
    expect(f.callback).not.toHaveBeenCalled();
  });
});

describe('fresh native mouse, touch and keyboard intent', () => {
  it.each(['pointer', 'Enter', ' '])('pairs native %s events across the real card shadow boundary', (input) => {
    const f = fixture(undefined, { shadow: true });
    if (input === 'pointer') press(f.button());
    else { key(f.button(), 'keydown', input); if (input === ' ') key(f.button(), 'keyup', input); click(f.button()); }
    expect(f.callback).toHaveBeenCalledExactlyOnceWith('evening', 'movie');
  });
  it.each(['mouse', 'touch', 'pen'])('runs exactly once for a complete %s press and preserves actual active state', (pointerType) => {
    const f = fixture([barData('evening', [buttonData('movie', { active: false })])]);
    press(f.button(), { pointerType });
    expect(f.callback).toHaveBeenCalledExactlyOnceWith('evening', 'movie');
    expect(f.button().getAttribute('aria-pressed')).toBe('false');
    click(f.button(), 1); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('does not run on press, release, hover or focus alone', () => {
    const f = fixture(); f.button().focus();
    pointer(f.button(), 'pointerenter'); pointer(f.button(), 'pointerdown'); pointer(f.button(), 'pointerup');
    expect(f.callback).not.toHaveBeenCalled();
  });
  it('rejects an orphan mouse click but accepts a native assistive click', () => {
    const f = fixture(); click(f.button(), 1); expect(f.callback).not.toHaveBeenCalled();
    f.button().click(); expect(f.callback).toHaveBeenCalledOnce();
  });
  it.each(['pointer', 'Space'])('accepts a new assistive activation after a completed %s press while still rejecting an orphan mouse click', async (input) => {
    const f = fixture();
    if (input === 'pointer') press(f.button());
    else { key(f.button(), 'keydown', ' '); key(f.button(), 'keyup', ' '); click(f.button()); }
    await flush(); expect(f.callback).toHaveBeenCalledOnce();
    f.button().click(); expect(f.callback).toHaveBeenCalledTimes(2);
    await flush(); click(f.button(), 1); expect(f.callback).toHaveBeenCalledTimes(2);
  });
  it.each([{ button: 1 }, { button: 2 }, { isPrimary: false }])('rejects non-primary pointer input %#', (values) => {
    const f = fixture(); press(f.button(), values); expect(f.callback).not.toHaveBeenCalled();
    press(f.button()); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('rejects a scrolling drag and a release outside the owning row', () => {
    const f = fixture(); pointer(f.button(), 'pointerdown'); pointer(f.button(), 'pointermove', { clientX: 50 });
    pointer(f.button(), 'pointerup', { clientX: 50 }); click(f.button(), 1);
    expect(f.callback).not.toHaveBeenCalled();
    pointer(f.button(), 'pointerdown'); pointer(document.body, 'pointerup'); click(f.button(), 1);
    expect(f.callback).not.toHaveBeenCalled(); press(f.button()); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('remembers movement outside the bar even if the pointer returns to its original point', () => {
    const f = fixture(), foreignMove = vi.fn(); document.body.addEventListener('pointermove', foreignMove);
    pointer(f.button(), 'pointerdown'); pointer(document.body, 'pointermove', { clientX: 100 });
    pointer(f.button(), 'pointerup'); click(f.button(), 1);
    expect(f.callback).not.toHaveBeenCalled(); expect(foreignMove).toHaveBeenCalledOnce();
    document.body.removeEventListener('pointermove', foreignMove);
  });
  it('keeps a cancelled touch poisoned through an unpaired click until a fresh press', () => {
    const f = fixture(); pointer(f.button(), 'pointerdown', { pointerType: 'touch' }); pointer(f.button(), 'pointercancel');
    click(f.button()); expect(f.callback).not.toHaveBeenCalled();
    press(f.button()); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('never accepts a foreign row release for a held button', () => {
    const f = fixture([barData('evening', [buttonData(), buttonData('other')])]);
    pointer(f.button(), 'pointerdown'); pointer(f.button('other'), 'pointerup'); click(f.button(), 1);
    expect(f.callback).not.toHaveBeenCalled();
  });
  it('requires the corresponding pointer ID before allowing a click', () => {
    const f = fixture(); pointer(f.button(), 'pointerdown', { pointerId: 9 }); pointer(f.button(), 'pointerup', { pointerId: 7 }); click(f.button(), 1);
    expect(f.callback).not.toHaveBeenCalled(); pointer(f.button(), 'pointerup', { pointerId: 9 }); click(f.button(), 1);
    expect(f.callback).toHaveBeenCalledOnce();
  });
  it('handles native Enter timing once, blocks repeats and allows a new key press', async () => {
    const f = fixture(); key(f.button(), 'keydown', 'Enter'); click(f.button());
    await flush();
    expect(key(f.button(), 'keydown', 'Enter', true).defaultPrevented).toBe(true);
    click(f.button()); expect(f.callback).toHaveBeenCalledOnce();
    key(f.button(), 'keyup', 'Enter'); key(f.button(), 'keydown', 'Enter'); click(f.button());
    expect(f.callback).toHaveBeenCalledTimes(2);
  });
  it('handles native Space only after release and rejects the wrong key release', () => {
    const f = fixture(); key(f.button(), 'keydown', ' '); click(f.button()); expect(f.callback).not.toHaveBeenCalled();
    key(f.button(), 'keyup', 'Enter'); click(f.button()); expect(f.callback).not.toHaveBeenCalled();
    key(f.button(), 'keydown', ' '); key(f.button(), 'keyup', ' '); click(f.button()); expect(f.callback).toHaveBeenCalledOnce();
  });
  it.each(['escape', 'blur', 'focusout', 'visibility'])('cancels held input after %s and requires a fresh press', (change) => {
    const f = fixture(); f.button().focus(); pointer(f.button(), 'pointerdown');
    if (change === 'escape') key(f.button(), 'keydown', 'Escape');
    if (change === 'blur') window.dispatchEvent(new Event('blur'));
    if (change === 'focusout') f.button().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    if (change === 'visibility') { visibility.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); visibility.mockReturnValue(false); }
    pointer(f.button(), 'pointerup'); click(f.button(), 1); expect(f.callback).not.toHaveBeenCalled();
    press(f.button()); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('stops owned UI gestures reaching parent 3D controls while Escape remains available to the popup', () => {
    const f = fixture(); const events = vi.fn();
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'keydown', 'keyup', 'click', 'wheel']) f.host.addEventListener(type, events);
    pointer(f.button(), 'pointerdown'); pointer(f.button(), 'pointermove'); pointer(f.button(), 'pointerup');
    key(f.button(), 'keydown', ' '); key(f.button(), 'keyup', ' '); click(f.button());
    f.button().dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    expect(events).not.toHaveBeenCalled();
    key(f.button(), 'keydown', 'Escape'); expect(events).toHaveBeenCalledOnce();
  });
});

describe('session, source, room and layout fences', () => {
  it.each(['context', 'action', 'room', 'style', 'order'])('rejects a held press after a %s change even with the same button ID', (change) => {
    const f = fixture([barData('evening', [buttonData(), buttonData('other')])]);
    pointer(f.button(), 'pointerdown');
    if (change === 'context') f.context.contextKey = 'another/model/user';
    if (change === 'action') f.context.bars[0].buttons[0].action = { type: 'script', entity: 'script.bedtime' };
    if (change === 'room') { f.context.bars[0].placement = 'room'; f.context.bars[0].room_id = 'Lounge'; }
    if (change === 'style') f.context.bars[0].style = 'tiles';
    if (change === 'order') f.context.bars[0].buttons.reverse();
    f.view.update(); pointer(f.button(), 'pointerup'); click(f.button(), 1);
    expect(f.callback).not.toHaveBeenCalled(); press(f.button()); expect(f.callback).toHaveBeenCalledOnce();
  });
  it.each(['disabled', 'suspended', 'context'])('does not resurrect held input after %s changes away and back', (change) => {
    const f = fixture(); const originalKey = f.context.contextKey; pointer(f.button(), 'pointerdown');
    if (change === 'disabled') { f.context.bars[0].buttons[0].available = false; f.context.bars[0].buttons[0].issue = 'Unavailable'; }
    if (change === 'suspended') f.context.suspended = true;
    if (change === 'context') f.context.contextKey = 'other';
    f.view.update();
    f.context.suspended = false; f.context.contextKey = originalKey; f.context.bars[0].buttons[0].available = true; f.context.bars[0].buttons[0].issue = '';
    f.view.update(); pointer(f.button(), 'pointerup'); click(f.button());
    expect(f.callback).not.toHaveBeenCalled(); press(f.button()); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('checks current owner context at click time even if the owner has not rendered again', () => {
    const f = fixture(); pointer(f.button(), 'pointerdown'); pointer(f.button(), 'pointerup');
    f.context.contextKey = 'changed-without-update'; click(f.button(), 1);
    expect(f.callback).not.toHaveBeenCalled(); press(f.button()); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('cannot run a stale detached button after remove/re-add of the same IDs', () => {
    const f = fixture(); const old = f.button(); pointer(old, 'pointerdown');
    f.context.bars = []; f.view.update(); f.context.bars = [barData()]; f.view.update();
    expect(f.button()).not.toBe(old); pointer(old, 'pointerup'); click(old);
    expect(f.callback).not.toHaveBeenCalled(); press(f.button()); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('rejects cloned or reparented nodes even when their data attributes match', () => {
    const f = fixture(); const cloned = f.button().cloneNode(true); f.button().parentNode.append(cloned); click(cloned);
    expect(f.callback).not.toHaveBeenCalled();
    const original = f.button(); f.view.el.append(original); click(original);
    expect(f.callback).not.toHaveBeenCalled();
  });
  it('does not run while its parent is hidden, disconnected or foreign', () => {
    const f = fixture(); f.host.hidden = true; click(f.button()); expect(f.callback).not.toHaveBeenCalled();
    f.host.hidden = false; f.host.remove(); click(f.button()); expect(f.callback).not.toHaveBeenCalled();
    document.body.append(f.host); document.body.append(f.view.el); click(f.button()); expect(f.callback).not.toHaveBeenCalled();
  });
  it('keeps suspended controls hidden and does not run actions while rendering/editing/loading', () => {
    const f = fixture(); f.context.suspended = true; f.view.update();
    expect(f.view.el.hidden).toBe(true); expect(f.button().disabled).toBe(true); click(f.button());
    expect(f.callback).not.toHaveBeenCalled();
  });
});

describe('truthful waiting status and obsolete async results', () => {
  it('reports request progress and completion without changing the real HA reading', async () => {
    const request = deferred(), f = fixture([barData('evening', [buttonData('movie', { active: false })])], { callback: vi.fn(() => request.promise) });
    press(f.button()); expect(f.button().disabled).toBe(true); expect(f.button().getAttribute('aria-busy')).toBe('true');
    expect(f.status().textContent).toBe('Running Movie…'); expect(f.button().getAttribute('aria-pressed')).toBe('false');
    request.resolve(undefined); await flush();
    expect(f.button().disabled).toBe(false); expect(f.button().hasAttribute('aria-busy')).toBe(false);
    expect(f.status().textContent).toBe('Action requested for Movie.'); expect(f.button().getAttribute('aria-pressed')).toBe('false');
  });
  it.each([false, { ok: false, error: '<secret>' }, 'throw'])('reports a safe failure for owner rejection %#', async (result) => {
    const f = fixture(undefined, { callback: vi.fn(() => { if (result === 'throw') throw new Error('private token'); return result; }) });
    press(f.button()); await flush();
    expect(f.status().textContent).toBe('Could not run Movie.'); expect(f.button().disabled).toBe(false);
    expect(f.view.el.textContent).not.toContain('private token'); expect(f.view.el.textContent).not.toContain('<secret>');
  });
  it('keeps other controls available while one request is pending', () => {
    const request = deferred(), f = fixture([barData('evening', [buttonData(), buttonData('other')])], { callback: vi.fn(() => request.promise) });
    press(f.button()); expect(f.button().disabled).toBe(true); expect(f.button('other').disabled).toBe(false);
    press(f.button('other')); expect(f.callback).toHaveBeenCalledTimes(2);
  });
  it.each(['context', 'action', 'move', 'remove', 'detach', 'dispose'])('ignores a late async failure after %s changes', async (change) => {
    const request = deferred(), f = fixture(undefined, { callback: vi.fn(() => request.promise) });
    const original = f.button(); press(original);
    if (change === 'context') f.context.contextKey = 'next-account';
    if (change === 'action') f.context.bars[0].buttons[0].action = { type: 'view', view_id: 'garden' };
    if (change === 'move') f.context.bars = [barData('moved', [buttonData()])];
    if (change === 'remove') { f.context.bars = []; f.view.update(); f.context.bars = [barData()]; }
    if (change === 'detach') f.host.remove();
    if (change === 'dispose') f.view.dispose();
    f.view.update(); request.reject(new Error('old private error')); await flush();
    expect(f.view.el.textContent).not.toContain('Could not run'); expect(f.view.el.textContent).not.toContain('old private error');
    if (change !== 'dispose') expect(f.button().hasAttribute('aria-busy')).toBe(false);
  });
  it('does not let an obsolete promise clear a newer request on the same stable node', async () => {
    const first = deferred(), second = deferred();
    const f = fixture(undefined, { callback: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
    press(f.button()); f.context.contextKey = 'next-layout'; f.view.update(); press(f.button());
    first.reject(new Error('obsolete')); await flush(); expect(f.button().getAttribute('aria-busy')).toBe('true');
    expect(f.status().textContent).toBe('Running Movie…');
    second.resolve({}); await flush(); expect(f.status().textContent).toBe('Action requested for Movie.');
    expect(f.button().hasAttribute('aria-busy')).toBe(false);
  });
  it('uses the current language for pending/completed messages while preserving the saved name', async () => {
    const request = deferred(), f = fixture(undefined, { callback: vi.fn(() => request.promise) });
    press(f.button()); f.context.hass.locale.language = 'es'; f.view.update();
    expect(f.status().textContent).not.toBe('Running Movie…'); expect(f.status().textContent).toContain('Movie');
    request.resolve({}); await flush(); expect(f.status().textContent).not.toBe('Action requested for Movie.'); expect(f.status().textContent).toContain('Movie');
  });
  it('does not call HA, fetch, navigation or timers directly, including during async completion', async () => {
    const callService = vi.fn(), fetch = vi.spyOn(globalThis, 'fetch'), timer = vi.spyOn(globalThis, 'setTimeout');
    const f = fixture(); f.context.hass.callService = callService;
    const initial = location.href; press(f.button()); await flush();
    expect(f.callback).toHaveBeenCalledOnce(); expect(callService).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(timer).not.toHaveBeenCalled(); expect(location.href).toBe(initial);
  });
  it('removes all owned listeners/content and ignores late events, leaving foreign parent content intact', async () => {
    const documentRemove = vi.spyOn(document, 'removeEventListener'), windowRemove = vi.spyOn(window, 'removeEventListener');
    const request = deferred(), f = fixture(undefined, { callback: vi.fn(() => request.promise) });
    const foreign = document.createElement('p'); foreign.textContent = 'Other card UI'; f.host.append(foreign);
    const button = f.button(); press(button); f.view.dispose(); f.view.dispose();
    expect(documentRemove.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['pointerup', 'pointercancel', 'keyup', 'visibilitychange']));
    expect(windowRemove.mock.calls.map(([type]) => type)).toContain('blur');
    expect(f.host.children).toHaveLength(1); expect(f.host.firstChild).toBe(foreign);
    press(button); key(button, 'keydown', 'Enter'); click(button); f.view.update(); request.resolve({}); await flush();
    expect(f.callback).toHaveBeenCalledOnce(); expect(f.view.el.isConnected).toBe(false);
  });
});

describe('small-screen and palette CSS contract', () => {
  it('defines native wrapping/scrolling, a >=44px target and no animation or renderer sizing code', () => {
    const ast = parse(CUSTOM_CONTROLS_VIEW_CSS), declarations = [];
    walk(ast, { visit: 'Declaration', enter(node) { declarations.push([node.property, generate(node.value)]); } });
    expect(declarations).toContainEqual(['min-height', '44px']); expect(declarations).toContainEqual(['min-width', '44px']);
    expect(declarations).toContainEqual(['flex-wrap', 'wrap']); expect(declarations).toContainEqual(['max-width', '100%']);
    expect(declarations).toContainEqual(['overflow', 'auto']); expect(declarations).toContainEqual(['overflow-wrap', 'anywhere']);
    expect(declarations.some(([property]) => ['animation', 'transition'].includes(property))).toBe(false);
    expect(CUSTOM_CONTROLS_VIEW_CSS).toContain('forced-colors: active'); expect(CUSTOM_CONTROLS_VIEW_CSS).toContain(':focus-visible');
  });
  it('has >=4.5:1 text contrast for every fixed palette pairing', () => {
    const luminance = (hex) => {
      const channels = hex.match(/[a-f0-9]{2}/gi).map((channel) => parseInt(channel, 16) / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const pairings = [];
    walk(parse(CUSTOM_CONTROLS_VIEW_CSS), { visit: 'Rule', enter(node) {
      if (!generate(node.prelude).includes('[data-color=')) return;
      const declarations = new Map([...node.block.children].filter((child) => child.type === 'Declaration').map((child) => [child.property, generate(child.value)]));
      pairings.push([declarations.get('background').slice(1), declarations.get('color').slice(1)]);
    } });
    expect(pairings).toHaveLength(5);
    for (const [background, foreground] of pairings) {
      expect((luminance(background) + .05) / (luminance(foreground) + .05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
