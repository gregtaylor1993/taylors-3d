// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse, walk, generate } from 'css-tree';
import { HouseNavigation, HOUSE_NAVIGATION_ITEMS, HOUSE_NAVIGATION_CSS, isHouseNavigationPath, resolveHouseNavigationItems } from '../src/house-navigation.js';

const instances = [];
const item = (id = 'lights', patch = {}) => ({ id, label: `Actual ${id} controls`, icon: 'mdi:lightbulb', action: { type: 'category', id }, ...patch });
function fixture(items = HOUSE_NAVIGATION_ITEMS, { selected = null, callback = vi.fn(), shadow = false } = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const parent = shadow ? host.attachShadow({ mode: 'open' }) : host;
  const nav = new HouseNavigation(parent, { onSelect: callback }); instances.push({ host, nav });
  const result = nav.update({ selected, items });
  const button = (id) => [...nav.items.children].find((control) => control.dataset.houseNavigationId === id);
  return { host, parent, nav, callback, button, result };
}
function pointer(button, type, values = {}) {
  button.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { button: 0, pointerId: 7, ...values }));
}
function key(button, type, value, repeat = false) {
  const event = new KeyboardEvent(type, { key: value, repeat, bubbles: true, cancelable: true }); button.dispatchEvent(event); return event;
}
function press(button) { pointer(button, 'pointerdown'); pointer(button, 'pointerup'); button.click(); }
afterEach(() => { for (const { host, nav } of instances.splice(0)) { nav.dispose(); host.remove(); } });

describe('explicit local navigation, without inferred routes or household data', () => {
  it('exports deeply immutable seven local defaults, with existing HA icon elements and no actions on construction/update', () => {
    const f = fixture();
    expect(HOUSE_NAVIGATION_ITEMS.map((entry) => entry.id)).toEqual(['house', 'lights', 'security', 'media', 'climate', 'cars', 'settings']);
    expect(HOUSE_NAVIGATION_ITEMS[0].action).toEqual({ type: 'control', id: '3d' });
    expect(Object.isFrozen(HOUSE_NAVIGATION_ITEMS)).toBe(true);
    for (const entry of HOUSE_NAVIGATION_ITEMS) { expect(Object.isFrozen(entry)).toBe(true); expect(Object.isFrozen(entry.action)).toBe(true); }
    expect(f.nav.items.children).toHaveLength(7); expect(f.callback).not.toHaveBeenCalled();
    expect(f.nav.element.tagName).toBe('NAV'); expect(f.nav.element.getAttribute('aria-label')).toBe('House navigation');
    expect(f.nav.element.dataset.taylors3dUi).toBe('house-navigation'); expect(f.nav.element.hasAttribute('data-taylors3d-nav-rail')).toBe(true);
    for (const button of f.nav.items.children) {
      expect(button.type).toBe('button'); expect(button.textContent.trim()).not.toBe(''); expect(button.getAttribute('aria-label')).toBe(button.textContent);
      expect(button.querySelector('ha-icon').getAttribute('aria-hidden')).toBe('true'); expect(button.hasAttribute('aria-current')).toBe(false);
    }
    f.nav.update(); expect(f.callback).not.toHaveBeenCalled();
  });
  it('forwards the exact latest descriptor once, including icon/label click targets, without changing root selection', () => {
    const first = item(), f = fixture([first], { selected: 'lights' });
    const latest = item('lights', { label: 'My connected lights' }); f.nav.update({ items: [latest] });
    f.button('lights').querySelector('ha-icon').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(f.callback).toHaveBeenCalledExactlyOnceWith(latest.action, { id: 'lights', label: latest.label, icon: latest.icon });
    expect(f.callback.mock.calls[0][0]).toBe(latest.action); expect(f.nav.selected).toBe('lights');
  });
  it('does not claim a new selected category before root supplies it', () => {
    const f = fixture(HOUSE_NAVIGATION_ITEMS, { selected: 'house' }); f.button('climate').click();
    expect(f.button('house').getAttribute('aria-current')).toBe('true'); expect(f.button('climate').hasAttribute('aria-current')).toBe(false);
    f.nav.update({ selected: 'climate' }); expect(f.button('house').hasAttribute('aria-current')).toBe(false);
    expect(f.button('climate').getAttribute('aria-pressed')).toBe('true'); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('renders labels as text rather than HTML or generated readings', () => {
    const label = '<img src=x onerror="alert(1)">'; const f = fixture([item('lights', { label })]);
    expect(f.button('lights').textContent).toBe(label); expect(f.button('lights').getAttribute('aria-label')).toBe(label);
    expect(f.nav.element.querySelector('img')).toBeNull(); expect(f.callback).not.toHaveBeenCalled();
  });
  it('disables supplied options if no owner callback is connected', () => {
    const host = document.createElement('div'); document.body.append(host);
    const nav = new HouseNavigation(host); instances.push({ host, nav });
    expect(nav.items.children).toHaveLength(7); expect([...nav.items.children].every((button) => button.disabled)).toBe(true);
    expect(() => nav.items.firstChild.click()).not.toThrow(); expect(nav.onSelect).toBeUndefined();
  });
  it('forwards a deliberate explicit HA destination but never navigates, fetches or calls services', () => {
    const action = { type: 'route', path: '/lovelace/security?view=doors#front' };
    const f = fixture([item('security', { action })], { selected: 'security' }); const initial = location.href;
    const fetch = vi.spyOn(globalThis, 'fetch');
    try { f.button('security').click(); expect(f.callback).toHaveBeenCalledExactlyOnceWith(action, expect.objectContaining({ id: 'security' }));
      expect(location.href).toBe(initial); expect(fetch).not.toHaveBeenCalled(); expect(f.button('security').getAttribute('aria-current')).toBe('page');
    } finally { fetch.mockRestore(); }
  });
});

describe('bounded definitions and explicit same-origin destinations', () => {
  it.each(['/lovelace/house', '/dashboard-house/0', '/config', '/', '/lovelace/a?room=front%20door#camera'])('accepts an explicit root-relative path %s', (path) => {
    expect(isHouseNavigationPath(path)).toBe(true);
  });
  it.each(['https://example.com/a', '//example.com/a', '/\\example.com/a', 'javascript:alert(1)', 'data:text/html,x', 'config/devices', '',
    '/%2f%2fevil', '/%5cevil', '/config\n', '/config%0a', '/a/../config', '/%2e%2e/config', '/invalid%xy', '/my room', '/a' + 'x'.repeat(512), null, 4])(
    'rejects an unsafe, normalized or absent route %s', (path) => { expect(isHouseNavigationPath(path)).toBe(false); });
  it.each([
    { id: '' }, { id: 'a'.repeat(65) }, { id: 'room/one' }, { label: ' ' }, { label: 'a'.repeat(129) }, { label: 'a\u0000b' },
    { icon: 'https://example.com/icon' }, { icon: 'mdi:lightbulb" onclick=x' }, { disabled: 'false' }, { hidden: 0 },
    { action: () => {} }, { action: { type: 'service', id: 'turn_on' } }, { action: { type: 'control', id: '' } },
    { action: { type: 'category', id: 'lights', invented: true } }, { action: { type: 'route', path: '//external' } },
  ])('excludes malformed known fields or fabricated action shape %#', (patch) => {
    const f = fixture([item('bad', patch), item('good')]); expect(f.result.valid).toBe(false);
    expect(f.nav.items.children).toHaveLength(1); expect(f.button('good')).toBeDefined(); f.button('good').click(); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('rejects duplicate IDs rather than selecting whichever item comes first', () => {
    const f = fixture([item(), item('lights', { action: { type: 'control', id: 'top' } }), item('security')]);
    expect(f.result.diagnostics.some((entry) => entry.code === 'duplicate')).toBe(true); expect(f.button('lights')).toBeUndefined();
    expect(f.nav.items.children).toHaveLength(1); f.button('security').click(); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('also excludes an ambiguous ID when one duplicate contains an invalid action', () => {
    const f = fixture([item(), item('lights', { action: { type: 'invented' } }), item('security')]);
    expect(f.result.valid).toBe(false); expect(f.button('lights')).toBeUndefined(); expect(f.button('security').disabled).toBe(false);
  });
  it.each([null, {}, Array.from({ length: 33 }, (_, index) => item(`room_${index}`))])('does not silently truncate an invalid/oversized list %#', (items) => {
    const f = fixture(items); expect(f.result.valid).toBe(false); expect(f.nav.element.hidden).toBe(true); expect(f.nav.items.children).toHaveLength(0);
  });
  it('tolerates malformed accessors without executing a supplied action', () => {
    const bad = item(); Object.defineProperty(bad, 'action', { get() { throw new Error('Malformed import'); } });
    const f = fixture([bad]); expect(f.result.valid).toBe(false); expect(f.callback).not.toHaveBeenCalled();
  });
});

describe('keyed native buttons, focus and available options', () => {
  it.each([false, true])('retains native focus and button identity during ordinary root updates (shadow=%s)', (shadow) => {
    const f = fixture(HOUSE_NAVIGATION_ITEMS, { selected: 'house', shadow }); const lights = f.button('lights'); lights.focus();
    f.nav.update({ selected: 'lights', items: HOUSE_NAVIGATION_ITEMS.map((entry) => ({ ...entry, action: { ...entry.action } })) });
    expect(f.button('lights')).toBe(lights); expect(f.parent.getRootNode().activeElement === lights || f.parent.activeElement === lights).toBe(true);
    expect(lights.getAttribute('aria-current')).toBe('true'); expect(f.callback).not.toHaveBeenCalled();
  });
  it('updates captions/icons in the same focused button without rebuilding its children', () => {
    const f = fixture([item()]), button = f.button('lights'), icon = button.firstChild, label = button.lastChild; button.focus();
    f.nav.update({ items: [item('lights', { label: 'Kitchen lights', icon: 'mdi:led-strip-variant' })] });
    expect(f.button('lights')).toBe(button); expect(button.firstChild).toBe(icon); expect(button.lastChild).toBe(label);
    expect(document.activeElement).toBe(button); expect(icon.getAttribute('icon')).toBe('mdi:led-strip-variant'); expect(label.textContent).toBe('Kitchen lights');
  });
  it('reorders the same native buttons while retaining focused current selection', () => {
    const a = item('a'), b = item('b'), c = item('c'), f = fixture([a, b, c]); const original = f.button('b'); original.focus();
    f.nav.update({ items: [c, b, a] }); expect([...f.nav.items.children].map((button) => button.dataset.houseNavigationId)).toEqual(['c', 'b', 'a']);
    expect(f.button('b')).toBe(original); expect(document.activeElement).toBe(original);
  });
  it('retains hidden/disabled nodes, omits hidden current state, and restores only through explicit update', () => {
    const f = fixture([item()], { selected: 'lights' }), original = f.button('lights');
    f.nav.update({ items: [item('lights', { hidden: true, disabled: true })] });
    expect(f.button('lights')).toBe(original); expect(original.hidden).toBe(true); expect(original.disabled).toBe(true);
    expect(original.hasAttribute('aria-current')).toBe(false); expect(f.nav.element.hidden).toBe(true); original.click(); expect(f.callback).not.toHaveBeenCalled();
    f.nav.update({ items: [item()] }); expect(f.button('lights')).toBe(original); expect(original.hidden).toBe(false); expect(original.disabled).toBe(false);
    expect(original.getAttribute('aria-current')).toBe('true'); original.click(); expect(f.callback).toHaveBeenCalledOnce();
  });
  it.each(['hidden', 'disabled'])('moves focus to a reachable native option if the focused item becomes %s without selecting it', (kind) => {
    const f = fixture([item('a'), item('b')]), original = f.button('a'); original.focus();
    f.nav.update({ items: [item('a', { [kind]: true }), item('b')] });
    expect(f.button('a')).toBe(original); expect(document.activeElement).toBe(f.button('b')); expect(f.callback).not.toHaveBeenCalled();
  });
  it('keeps all 32 explicit choices in both layout hooks and sends the last exact action', () => {
    const items = Array.from({ length: 32 }, (_, index) => item(`category_${index}`)), f = fixture(items);
    expect(f.nav.element.dataset.houseNavigationLayout).toBe('bottom'); expect(f.nav.items.children).toHaveLength(32);
    f.nav.element.dataset.houseNavigationLayout = 'rail'; f.nav.update(); expect(f.nav.items.children).toHaveLength(32);
    expect(f.nav.element.textContent).not.toContain('More'); f.button('category_31').click(); expect(f.callback.mock.calls[0][0]).toBe(items[31].action);
  });
  it('arrow/Home/End navigation focuses only available native options without selecting or acting', () => {
    const f = fixture([item('a'), item('hidden', { hidden: true }), item('disabled', { disabled: true }), item('b'), item('c')]);
    f.button('a').focus(); expect(key(f.button('a'), 'keydown', 'ArrowRight').defaultPrevented).toBe(true); expect(document.activeElement).toBe(f.button('b'));
    key(f.button('b'), 'keydown', 'End'); expect(document.activeElement).toBe(f.button('c')); key(f.button('c'), 'keydown', 'Home'); expect(document.activeElement).toBe(f.button('a'));
    key(f.button('a'), 'keydown', 'ArrowUp'); expect(document.activeElement).toBe(f.button('c')); expect(f.callback).not.toHaveBeenCalled();
  });
});

describe('native intent remains tied to a current exact item', () => {
  it.each(['pointer', 'Enter', ' '])('calls once for %s intent followed by the native button click; no extra down/up action', (kind) => {
    const f = fixture([item()]), button = f.button('lights');
    if (kind === 'pointer') { pointer(button, 'pointerdown'); pointer(button, 'pointerup'); }
    else { key(button, 'keydown', kind); if (kind === ' ') key(button, 'keyup', kind); }
    expect(f.callback).not.toHaveBeenCalled(); button.click(); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('prevents held Enter repeat activation, then permits a genuinely new keyboard press', () => {
    const f = fixture([item()]), button = f.button('lights'); key(button, 'keydown', 'Enter'); button.click();
    expect(key(button, 'keydown', 'Enter', true).defaultPrevented).toBe(true); button.click(); expect(f.callback).toHaveBeenCalledOnce();
    key(button, 'keyup', 'Enter'); key(button, 'keydown', 'Enter'); button.click(); expect(f.callback).toHaveBeenCalledTimes(2);
  });
  it.each(['action', 'disabled', 'hidden', 'detached'])('rejects an old pointer release after observed %s change and recovery, retaining the button', (kind) => {
    const raw = item(), f = fixture([raw]), button = f.button('lights'); pointer(button, 'pointerdown');
    if (kind === 'action') f.nav.update({ items: [item('lights', { action: { type: 'category', id: 'other' } })] });
    if (kind === 'disabled' || kind === 'hidden') f.nav.update({ items: [item('lights', { [kind]: true })] });
    if (kind === 'detached') { f.host.remove(); f.nav.update(); document.body.append(f.host); }
    f.nav.update({ items: [raw] }); expect(f.button('lights')).toBe(button); pointer(button, 'pointerup'); button.click(); expect(f.callback).not.toHaveBeenCalled();
    press(button); expect(f.callback).toHaveBeenCalledExactlyOnceWith(raw.action, expect.objectContaining({ id: 'lights' }));
  });
  it.each(['Enter', ' '])('rejects held %s after a control changes and returns, then permits fresh native intent', (value) => {
    const raw = item(), f = fixture([raw]), button = f.button('lights'); key(button, 'keydown', value);
    f.nav.update({ items: [item('lights', { disabled: true })] }); f.nav.update({ items: [raw] }); key(button, 'keyup', value); button.click();
    expect(f.callback).not.toHaveBeenCalled(); key(button, 'keydown', value); key(button, 'keyup', value); button.click(); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('retains valid held intent across unrelated cloned definitions and sends the latest exact descriptor', () => {
    const f = fixture([item()]), button = f.button('lights'); pointer(button, 'pointerdown'); const latest = item('lights', { label: 'Current lights' });
    f.nav.update({ items: [latest] }); pointer(button, 'pointerup'); button.click(); expect(f.callback.mock.calls[0][0]).toBe(latest.action);
  });
  it('rejects cancellation and delayed click; a new deliberate pointer gesture works', () => {
    const f = fixture([item()]), button = f.button('lights'); pointer(button, 'pointerdown'); pointer(button, 'pointercancel'); pointer(button, 'pointerup');
    button.click(); expect(f.callback).not.toHaveBeenCalled(); press(button); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('does not revive an old removed item when a different button has the same ID, even if the old node is reinserted', () => {
    const f = fixture([item()]), old = f.button('lights'); pointer(old, 'pointerdown'); f.nav.update({ items: [] }); f.nav.update({ items: [item()] });
    const current = f.button('lights'); expect(current).not.toBe(old); f.nav.items.append(old); pointer(old, 'pointerup'); old.click(); expect(f.callback).not.toHaveBeenCalled();
    current.click(); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('does not act on detached controls, substituted buttons, or a moved navigation root', () => {
    const f = fixture([item()]), button = f.button('lights'); button.remove(); button.click(); expect(f.callback).not.toHaveBeenCalled();
    const forged = button.cloneNode(true); f.nav.items.append(forged); forged.click(); expect(f.callback).not.toHaveBeenCalled();
    f.nav.items.append(button); document.body.append(f.nav.element); button.click(); expect(f.callback).not.toHaveBeenCalled();
  });
  it('revalidates in-place descriptor mutation and permanently rejects its observed stale release', () => {
    const raw = item(), f = fixture([raw]), button = f.button('lights'); pointer(button, 'pointerdown'); raw.action.id = 'security'; button.click();
    raw.action.id = 'lights'; f.nav.update(); pointer(button, 'pointerup'); button.click(); expect(f.callback).not.toHaveBeenCalled(); press(button); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('isolates click/pointer/wheel gestures from the scene without preventing native scroll', () => {
    const f = fixture([item()]), bubble = vi.fn(); for (const type of ['click', 'pointerdown', 'pointerup', 'wheel']) f.host.addEventListener(type, bubble);
    press(f.button('lights')); const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true }); f.button('lights').dispatchEvent(wheel);
    expect(bubble).not.toHaveBeenCalled(); expect(wheel.defaultPrevented).toBe(false); expect(f.callback).toHaveBeenCalledOnce();
  });
  it('removes listeners/nodes on idempotent disposal; old callbacks cannot be revived', () => {
    const f = fixture([item()]), button = f.button('lights'), element = f.nav.element; f.nav.dispose(); f.nav.dispose(); f.host.append(element);
    press(button); expect(f.callback).not.toHaveBeenCalled(); expect(f.nav.update().valid).toBe(false); expect(f.nav._gestures.size).toBe(0);
    expect(f.nav.onSelect).toBeNull(); expect(f.nav._rawItems).toEqual([]);
  });
});

describe('scoped responsive/accessibility CSS contract (not a browser geometry proof)', () => {
  it('parses scoped CSS with explicit card-owned orientation, 44px controls, horizontal scroll and system-colour focus', () => {
    const ast = parse(HOUSE_NAVIGATION_CSS), selectors = [];
    walk(ast, { visit: 'Rule', enter(node) { selectors.push(generate(node.prelude)); } });
    expect(selectors.every((selector) => selector.startsWith('[data-house-navigation]'))).toBe(true);
    expect(HOUSE_NAVIGATION_CSS).toContain('min-width:44px'); expect(HOUSE_NAVIGATION_CSS).toContain('min-height:44px');
    expect(HOUSE_NAVIGATION_CSS).toContain('overflow-x:auto'); expect(HOUSE_NAVIGATION_CSS).toContain('data-house-navigation-layout="rail"');
    expect(HOUSE_NAVIGATION_CSS).toContain('button:focus-visible'); expect(HOUSE_NAVIGATION_CSS).toContain('forced-colors:active');
    expect(HOUSE_NAVIGATION_CSS).toContain('[hidden]{display:none!important}');
    expect(HOUSE_NAVIGATION_CSS).not.toMatch(/url\(|@import|@media\s*\([^)]*width|[;{]\s*content:/);
    expect(HOUSE_NAVIGATION_CSS).toContain('[data-house-navigation-overflow]{position:absolute');
  });
});

describe('compact House menu and saved ordering', () => {
  it('reads known sections without executing or mutating imported extras, and always retains House and Settings', () => {
    const raw = { order: ['cars', 'future', 'lights', 'cars'], hidden: ['house', 'settings', 'security'], future: { action: 'never' } };
    const original = JSON.stringify(raw), items = resolveHouseNavigationItems(raw, { language: 'en' });
    expect(items.map((item) => item.id)).toEqual(['house', 'cars', 'lights', 'security', 'media', 'climate', 'settings']);
    expect(items.filter((item) => item.hidden).map((item) => item.id)).toEqual(['security']);
    expect(JSON.stringify(raw)).toBe(original);
  });
  it.each([320, 390])('keeps 3/4 favourite sections and a labelled More at %spx, preserving every category', (width) => {
    const f = fixture(); f.nav.setLayout('bottom', width);
    expect(f.nav.items.querySelectorAll('[data-house-navigation-id]')).toHaveLength(width < 390 ? 3 : 4);
    expect(f.nav.more.textContent).toBe('More'); expect(f.nav.overflow.hidden).toBe(true);
    const house = f.nav.items.querySelector('[data-house-navigation-id="house"]');
    expect(house.textContent).toBe('House'); expect(house.getAttribute('aria-label')).toBe('House / 3D');
    expect(f.nav.element.querySelectorAll('[data-house-navigation-id]')).toHaveLength(7);
    f.nav.more.click(); expect(f.nav.overflow.hidden).toBe(false);
    const settings = f.nav.overflow.querySelector('[data-house-navigation-id="settings"]'); settings.click();
    expect(f.callback).toHaveBeenCalledExactlyOnceWith({ type: 'category', id: 'settings' }, expect.objectContaining({ id: 'settings' }));
    expect(f.nav.overflow.hidden).toBe(true); expect(document.activeElement).toBe(f.nav.more);
  });
  it('retains an open menu and its focused button on ordinary readings, and closes with Escape or a new layout', () => {
    const f = fixture(); f.nav.setLayout('bottom', 320); f.nav.more.click();
    const focused = document.activeElement;
    f.nav.update({ items: HOUSE_NAVIGATION_ITEMS.map((item) => ({ ...item })) }); f.nav.setLayout('bottom', 320);
    expect(f.nav._open).toBe(true); expect(document.activeElement).toBe(focused);
    key(focused, 'keydown', 'Escape'); expect(f.nav._open).toBe(false); expect(document.activeElement).toBe(f.nav.more);
    f.nav.more.click(); f.nav.setLayout('rail', 1200); expect(f.nav._open).toBe(false);
    expect(f.nav.items.querySelectorAll('[data-house-navigation-id]')).toHaveLength(7); expect(f.nav.more.hidden).toBe(true);
  });
  it('dismisses an outside tap over the house without forwarding its pointer or click to a device', () => {
    const f = fixture(); const device = document.createElement('button'); f.host.append(device);
    const action = vi.fn(); device.addEventListener('pointerdown', action); device.addEventListener('click', action);
    f.nav.setLayout('bottom', 320); f.nav.more.click(); pointer(device, 'pointerdown'); device.click();
    expect(f.nav._open).toBe(false); expect(action).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(f.nav.more);
    pointer(device, 'pointerdown'); device.click(); expect(action).toHaveBeenCalledTimes(2);
  });
  it('does not let a closed overflow or old held gesture act after a resize', () => {
    const f = fixture(); f.nav.setLayout('bottom', 320);
    const climate = f.nav.overflow.querySelector('[data-house-navigation-id="climate"]'); climate.click(); expect(f.callback).not.toHaveBeenCalled();
    f.nav.more.click(); pointer(climate, 'pointerdown'); f.nav.setLayout('rail', 1200); pointer(climate, 'pointerup'); climate.click();
    expect(f.callback).not.toHaveBeenCalled();
    press(climate); expect(f.callback).toHaveBeenCalledOnce();
  });
});
