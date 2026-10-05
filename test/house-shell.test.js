// @vitest-environment jsdom
// Bounds below are explicit DOM measurement fixtures, not a claim of Chrome
// pixel/CSS rendering. Root's later native suite verifies actual layout pixels.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseShell } from '../src/house-shell.js';
import { DevicePopup } from '../src/device-popup.js';
import { HOUSE_NAVIGATION_ITEMS } from '../src/house-navigation.js';
import { TAYLORS3D_THEME_CSS } from '../src/taylors3d-theme.js';

const disposables = [];
const state = (id, value, attributes = {}) => ({ entity_id: id, state: value, attributes });
const bounds = (width, height, left = 0, top = 0) => ({ width, height, left, top, right: left + width, bottom: top + height, x: left, y: top });
function setup({ width = 1280, height = 720, summaryHeight = 86, toolbarHeight = 76, navigationHeight = 76, initialAttributes = {}, initialStyles = {}, onSelect = vi.fn() } = {}) {
  const card = document.createElement('taylors3d-shell-fixture'); card.attachShadow({ mode: 'open' }); document.body.append(card);
  card.shadowRoot.innerHTML = '<ha-card><div class="stage"><div class="scene"></div><nav class="toolbar"><button>Top</button></nav></div></ha-card>';
  card._stage = card.shadowRoot.querySelector('.stage'); card._scene = card.shadowRoot.querySelector('.scene'); card._toolbar = card.shadowRoot.querySelector('.toolbar');
  for (const [name, value] of Object.entries(initialAttributes)) card.setAttribute(name, value);
  for (const [name, [value, priority = '']] of Object.entries(initialStyles)) card._stage.style.setProperty(name, value, priority);
  card._hass = { user: { id: 'taylor', is_active: true, is_admin: false }, connection: { connected: true }, auth: {},
    config: { location_name: 'Actual HA home' }, states: {
      'weather.local': state('weather.local', 'sunny', { friendly_name: 'Local weather', temperature: 18, temperature_unit: '°C' }),
      'person.one': state('person.one', 'home'), 'alarm_control_panel.house': state('alarm_control_panel.house', 'disarmed'),
      'light.kitchen': state('light.kitchen', 'on', { brightness: 128, color_mode: 'rgb', supported_color_modes: ['rgb'], rgb_color: [255, 0, 0] }),
    }, entities: {}, devices: {}, callService: vi.fn(), callWS: vi.fn() };
  card._view = { resize: vi.fn(), setCamera: vi.fn(), camera: { position: { x: 7, y: 8, z: 9 } }, scene: { children: [] } };
  const sizes = { width, height, summaryHeight, toolbarHeight, navigationHeight };
  card._stage.getBoundingClientRect = () => bounds(sizes.width, sizes.height);
  card._scene.getBoundingClientRect = () => bounds(sizes.width, sizes.height);
  card._toolbar.getBoundingClientRect = () => bounds(sizes.width - 16, sizes.toolbarHeight);
  const onNeedsResize = vi.fn(), shell = new HouseShell(card, { onSelect, onNeedsResize }); disposables.push(shell);
  const update = (data = {}) => { const result = shell.setData({ enabled: true, scheme: 'dark', ...data });
    if (shell.header) shell.header.element.getBoundingClientRect = () => bounds(sizes.width, sizes.summaryHeight);
    if (shell.navigation) shell.navigation.element.getBoundingClientRect = () => bounds(sizes.width, sizes.navigationHeight);
    return result; };
  const measure = (baseHeight = sizes.height) => shell.measure({ baseHeight });
  const navButton = (id) => shell.navigation.element.querySelector(`[data-house-navigation-id="${id}"]`);
  const popup = ({ w = 316, h = 500, real = false } = {}) => {
    const controller = real ? new DevicePopup(card._stage, { onAction: vi.fn(), onMoreInfo: vi.fn(), placement: 'right' }) : { el: document.createElement('aside') };
    if (real) { controller.update(card._hass); controller.showMarker({ entityId: 'light.kitchen' }); disposables.push(controller); }
    else { controller.el.className = 'taylors3d-device-popup'; card._stage.append(controller.el); }
    controller.el.getBoundingClientRect = () => bounds(w, h); card._devicePopup = controller; return controller;
  };
  return { card, shell, sizes, update, measure, onNeedsResize, onSelect, navButton, popup };
}
const flush = () => Promise.resolve();
afterEach(() => { disposables.splice(0).forEach((value) => value.dispose()); document.body.replaceChildren(); });

describe('actual header/navigation composition and source authority', () => {
  it('starts dormant without DOM nodes, theme, requests or renderer changes', () => {
    const { card, shell } = setup(); expect(shell.enabled).toBe(false); expect(shell.header).toBeNull();
    expect(card.shadowRoot.querySelector('[data-house-navigation]')).toBeNull(); expect(card.getAttribute('data-taylors3d-theme')).toBeNull();
    shell.setData({ enabled: false }); expect(card._stage.style.minHeight).toBe('');
    expect(card._view.resize).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('shows only real HA title and eligible lamp counts by default, never chooses people/weather/alarm', () => {
    const { shell, update, card } = setup(); update();
    expect(shell.header.title.textContent).toBe('Actual HA home'); expect(shell.header.rows.get('lights').textContent).toBe('1 light on');
    for (const key of ['weather', 'people', 'alarm']) expect(shell.header.rows.get(key).hidden).toBe(true);
    expect(shell.navigation.items.children).toHaveLength(7); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('uses configured exact sources without changing their actual HA states or issuing calls', () => {
    const { card, shell, update } = setup(); const before = structuredClone(card._hass.states);
    update({ summaryRaw: { title: 'My configured title', weather_entity: 'weather.local', person_entities: ['person.one'], alarm_entity: 'alarm_control_panel.house' } });
    expect(shell.header.title.textContent).toBe('My configured title'); expect(shell.header.rows.get('weather').textContent).toContain('18 °C');
    expect(shell.header.rows.get('people').textContent).toBe('1 of 1 selected people home'); expect(shell.header.rows.get('alarm').textContent).toBe('Disarmed');
    expect(card._hass.states).toEqual(before); expect(card._hass.callWS).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('preserves missing configured source warnings instead of inventing household readings', () => {
    const { shell, update } = setup(); update({ summaryRaw: { weather_entity: 'weather.missing', person_entities: ['person.missing'], alarm_entity: 'alarm_control_panel.missing' } });
    expect(shell.header.rows.get('weather').textContent).toBe('Weather unavailable'); expect(shell.header.rows.get('weather').hidden).toBe(false);
    expect(shell.header.rows.get('people').textContent).toContain('1 unknown'); expect(shell.header.rows.get('alarm').textContent).toBe('Alarm unavailable');
  });
  it.each([false, null, 'true'])('does not use cached summary readings when current connection is %j', (connected) => {
    const { card, shell, update, navButton, onSelect } = setup(); card._hass.connection.connected = connected;
    update({ summaryRaw: { weather_entity: 'weather.local', person_entities: ['person.one'] } });
    expect(shell.header.rows.get('weather').textContent).toBe('Weather unavailable'); expect(shell.header.rows.get('lights').textContent).toBe('Light status unavailable');
    expect(navButton('settings').disabled).toBe(true); navButton('settings').click(); expect(onSelect).not.toHaveBeenCalled();
  });
  it('keeps real native header/nav/button nodes and focus stable through ordinary state updates', () => {
    const { card, shell, update, navButton } = setup(); update(); const header = shell.header.element, nav = shell.navigation.element, button = navButton('lights'); button.focus();
    card._hass = { ...card._hass, states: { ...card._hass.states, 'light.kitchen': state('light.kitchen', 'off') } };
    update({ selected: 'lights' }); expect(shell.header.element).toBe(header); expect(shell.navigation.element).toBe(nav); expect(navButton('lights')).toBe(button);
    expect(card.shadowRoot.activeElement).toBe(button); expect(button.getAttribute('aria-current')).toBe('true'); expect(shell.header.rows.get('lights').textContent).toBe('0 lights on');
  });
  it('forwards exact current local descriptors to root once and leaves Settings implementation to it', () => {
    const { update, navButton, onSelect, card } = setup(); update(); navButton('settings').click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ type: 'category', id: 'settings' }, { id: 'settings', label: 'Settings', icon: 'mdi:cog' });
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._view.setCamera).not.toHaveBeenCalled();
  });
  it('offers an HA route only when explicitly supplied and validated, without navigating or replacing it', () => {
    const { update, navButton, onSelect } = setup(); const route = { id: 'dashboard', label: 'My dashboard', icon: 'mdi:view-dashboard', action: { type: 'route', path: '/lovelace/my-view' } };
    update({ navItems: [route] }); navButton('dashboard').click(); expect(onSelect.mock.calls[0][0]).toEqual(route.action);
    expect(update({ navItems: [{ ...route, action: { type: 'route', path: '//outside.example' } }] }).valid).toBe(false); expect(navButton('dashboard')).toBeNull();
  });
  it('does not fall back to invented defaults for explicitly malformed navigation', () => {
    const { update, shell } = setup(); expect(update({ navItems: null }).valid).toBe(false); expect(shell.navigation.items.children).toHaveLength(0);
  });
  it('does not repair a malformed disabled flag merely because the current session is offline', () => {
    const { card, shell, update } = setup(); card._hass.connection.connected = false;
    const result = update({ navItems: [{ ...HOUSE_NAVIGATION_ITEMS[0], disabled: 'false' }] });
    expect(result.valid).toBe(false); expect(shell.navigation.items.children).toHaveLength(0);
  });
  it('passes malicious accessor items to safe validation instead of throwing while suspending them', () => {
    const { card, update } = setup(); card._hass.connection.connected = false;
    const item = { ...HOUSE_NAVIGATION_ITEMS[0], get label() { throw new Error('Private accessor'); } };
    expect(() => update({ navItems: [item] })).not.toThrow();
  });
});

describe('measured scene, desktop rail, mobile sheet and editor', () => {
  it('reserves an actual wide right popup and rail without modifying a camera, scene object or renderer', () => {
    const { update, measure, popup, card, shell } = setup(); update(); const controller = popup(); const originalCamera = structuredClone(card._view.camera);
    controller.el.style.left = '134px'; controller.el.style.top = '225px'; const plan = measure();
    expect(plan).toMatchObject({ mode: 'rail', stageHeight: 720, summaryReserve: 86, railReserve: 88, controlsReserve: 332,
      scene: { x: 88, y: 86, width: 860, height: 542 } });
    expect(shell.navigation.element.dataset.houseNavigationLayout).toBe('rail'); expect(controller.el.dataset.houseControlsLayout).toBe('right');
    expect(controller.el.style.left).toBe(''); expect(controller.el.style.top).toBe(''); expect(card._stage.style.getPropertyValue('--taylors3d-controls-width')).toBe('332px');
    expect(card._view.camera).toEqual(originalCamera); expect(card._view.scene.children).toEqual([]); expect(card._view.resize).not.toHaveBeenCalled();
  });
  it('uses actual narrow stage width inside a wide browser, reserves both bottom rows, and expands min-height to preserve 240px scene', () => {
    const { update, measure, popup, card, shell } = setup({ width: 320, height: 520, summaryHeight: 112, toolbarHeight: 120 });
    expect(window.innerWidth).toBeGreaterThan(320); update(); popup({ h: 450 }); const plan = measure();
    expect(plan).toMatchObject({ mode: 'bottom', navigationReserve: 92, toolbarReserve: 136, sheetReserve: 336,
      stageHeight: 916, scene: { x: 0, y: 112, width: 320, height: 240 } });
    expect(card._stage.style.minHeight).toBe('916px'); expect(shell.navigation.element.dataset.houseNavigationLayout).toBe('bottom');
    expect(card._devicePopup.el.dataset.houseControlsLayout).toBe('sheet'); expect(card._stage.style.getPropertyValue('--taylors3d-navigation-height')).toBe('92px');
  });
  it.each([739, 740, 959, 960])('uses exact stage breakpoint %i and actual selected controls dimensions', (width) => {
    const { update, measure, popup } = setup({ width, height: 520 }); update(); popup({ w: 280, h: 250 }); const plan = measure();
    expect(plan.mode).toBe(width >= 960 ? 'rail' : 'bottom'); expect(plan.sheetReserve > 0).toBe(width < 740); expect(plan.controlsReserve > 0).toBe(width >= 740);
    expect(plan.scene.x + plan.scene.width + plan.controlsReserve).toBe(width); expect(plan.scene.y + plan.scene.height + plan.toolbarReserve + plan.navigationReserve + plan.sheetReserve).toBe(plan.stageHeight);
  });
  it('shrinks a closed mobile sheet to the configured base height, not the old expanded measured DOM height', () => {
    const { update, measure, popup, card, sizes } = setup({ width: 390, height: 600, summaryHeight: 80, toolbarHeight: 80, navigationHeight: 64 }); update(); const controller = popup({ h: 320 });
    const open = measure(600); sizes.height = open.stageHeight; controller.el.remove(); controller.el = null;
    const closed = measure(600); expect(open.stageHeight).toBeGreaterThan(600); expect(closed.stageHeight).toBe(600); expect(closed.sheetReserve).toBe(0);
    expect(card._stage.style.minHeight).toBe('600px');
  });
  it('hides owned header/nav/sheet reserves in edit mode while retaining theme and existing editor controls', () => {
    const { update, measure, popup, card, shell } = setup({ width: 1200, height: 520, toolbarHeight: 80 }); update(); popup();
    const panel = document.createElement('section'); panel.className = 'panel'; const editorButton = document.createElement('button'); editorButton.textContent = 'Save'; panel.append(editorButton); card._stage.append(panel); editorButton.focus();
    update({ editing: true }); const plan = measure();
    expect(plan).toMatchObject({ mode: 'editor', summaryReserve: 0, railReserve: 0, navigationReserve: 0, controlsReserve: 0, sheetReserve: 0,
      scene: { x: 0, y: 0, width: 1200, height: 424 } });
    expect(shell.header.element.hidden).toBe(true); expect(shell.navigation.element.hidden).toBe(true); expect(card.getAttribute('data-taylors3d-theme')).toBe('house');
    expect(card.shadowRoot.activeElement).toBe(editorButton); expect(panel.isConnected).toBe(true);
  });
  it('includes no phantom toolbar, header, nav or popup heights for truly hidden elements', () => {
    const { update, measure, popup, card, shell } = setup({ width: 600, height: 520 }); update(); const controller = popup();
    card._toolbar.hidden = true; shell.header.element.hidden = true; shell.navigation.element.hidden = true; controller.el.hidden = true;
    expect(measure()).toMatchObject({ summaryReserve: 0, navigationReserve: 0, toolbarReserve: 0, sheetReserve: 0,
      scene: { x: 0, y: 0, width: 600, height: 520 } });
  });
  it('accepts an actual DevicePopup without rebuilding its focused controls or opening any services', () => {
    const { update, measure, popup, card } = setup({ width: 320, height: 520 }); update(); const controller = popup({ real: true, w: 304, h: 300 });
    const button = controller.el.querySelector('[data-action="more-info"]'); button.focus(); measure();
    expect(controller.el.querySelector('[data-action="more-info"]')).toBe(button); expect(card.shadowRoot.activeElement).toBe(button);
    expect(controller.onAction).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('leaves the generic ObjectPopup pointer position and placement untouched', () => {
    const { update, measure, card } = setup(); const objectPopup = document.createElement('aside'); objectPopup.className = 'fp-popup'; objectPopup.style.left = '77px'; objectPopup.style.top = '88px';
    card._stage.append(objectPopup); card._popup = { el: objectPopup }; update(); const plan = measure();
    expect(plan.controlsReserve).toBe(0); expect(objectPopup.style.left).toBe('77px'); expect(objectPopup.style.top).toBe('88px'); expect(objectPopup.hasAttribute('data-taylors3d-controls')).toBe(false);
  });
  it.each([undefined, null, '520', NaN, -1, Infinity])('rejects non-configured/invalid base height %j without writing min-height', (baseHeight) => {
    const { update, shell, card } = setup(); update(); const result = shell.measure({ baseHeight }); expect(result.valid).toBe(false); expect(card._stage.style.minHeight).toBe('');
  });
  it('returns a hidden zero scene for an unmeasurable-width card and rejects its navigation callback', () => {
    const { update, measure, navButton, onSelect } = setup({ width: 0 }); update(); expect(measure()).toMatchObject({ mode: 'hidden', scene: { width: 0, height: 0 } });
    navButton('lights').click(); expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('owned style restoration, lifecycle and resize coalescing', () => {
  it('restores original host/stage/popup attributes and exact inline values/priorities on disable', () => {
    const { update, measure, shell, popup, card } = setup({ initialAttributes: { 'data-taylors3d-theme': 'original', 'data-taylors3d-scheme': 'custom' },
      initialStyles: { 'min-height': ['430px', 'important'], '--taylors3d-bar-height': ['71px', 'important'], '--primary-color': ['red'] } });
    card._stage.setAttribute('data-taylors3d-shell', 'prior'); const controller = popup(); controller.el.style.left = '32px'; controller.el.style.top = '43px';
    controller.el.setAttribute('data-taylors3d-controls', 'prior'); update(); measure(); shell.setData({ enabled: false });
    expect(card.getAttribute('data-taylors3d-theme')).toBe('original'); expect(card.getAttribute('data-taylors3d-scheme')).toBe('custom');
    expect(card._stage.getAttribute('data-taylors3d-shell')).toBe('prior'); expect(card._stage.hasAttribute('data-taylors3d-shell-mode')).toBe(false);
    expect(card._stage.style.minHeight).toBe('430px'); expect(card._stage.style.getPropertyPriority('min-height')).toBe('important');
    expect(card._stage.style.getPropertyValue('--taylors3d-bar-height')).toBe('71px'); expect(card._stage.style.getPropertyPriority('--taylors3d-bar-height')).toBe('important');
    expect(card._stage.style.getPropertyValue('--primary-color')).toBe('red'); expect(controller.el.style.left).toBe('32px'); expect(controller.el.style.top).toBe('43px');
    expect(controller.el.getAttribute('data-taylors3d-controls')).toBe('prior'); expect(controller.el.hasAttribute('data-house-controls-layout')).toBe(false);
    expect(card.shadowRoot.querySelector('[data-house-navigation]')).toBeNull(); expect(card.shadowRoot.querySelector('[data-taylors3d-house-shell-style]')).toBeNull();
  });
  it('retains header/nav nodes across disable/re-enable, rejecting stale inactive controls while off', () => {
    const { shell, update, navButton, onSelect } = setup(); update(); const header = shell.header.element, nav = shell.navigation.element, button = navButton('settings');
    shell.setData({ enabled: false }); button.click(); expect(onSelect).not.toHaveBeenCalled(); update();
    expect(shell.header.element).toBe(header); expect(shell.navigation.element).toBe(nav); navButton('settings').click(); expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('preserves unrelated inline writes and a later foreign write to a formerly owned property/attribute', () => {
    const { update, measure, shell, card } = setup(); update(); measure(); card._stage.style.setProperty('--unrelated', 'kept');
    card._stage.style.minHeight = '987px'; card.setAttribute('data-taylors3d-theme', 'foreign'); shell.setData({ enabled: false });
    expect(card._stage.style.getPropertyValue('--unrelated')).toBe('kept'); expect(card._stage.style.minHeight).toBe('987px'); expect(card.getAttribute('data-taylors3d-theme')).toBe('foreign');
  });
  it('restores a replaced popup immediately without losing focused controls in the replacement', () => {
    const { update, measure, popup } = setup(); update(); const first = popup(); first.el.style.left = '123px'; measure(); const old = first.el;
    old.remove(); const second = popup(); measure(); expect(old.style.left).toBe('123px'); expect(old.hasAttribute('data-taylors3d-controls')).toBe(false);
    expect(second.el.dataset.taylors3dControls).toBe('adaptive');
  });
  it('coalesces changed presentation+measurement requests and skips equal updates or same-text readings', async () => {
    const { update, measure, onNeedsResize, card } = setup(); update(); measure(); update(); measure(); await flush(); expect(onNeedsResize).toHaveBeenCalledTimes(1);
    update(); measure(); card._hass.states['sensor.new'] = state('sensor.new', '12'); update(); measure(); await flush(); expect(onNeedsResize).toHaveBeenCalledTimes(1);
    card._hass.states['light.kitchen'] = state('light.kitchen', 'off'); update(); await flush(); expect(onNeedsResize).toHaveBeenCalledTimes(2);
  });
  it('requests one legacy resize on repeated disable calls, instead of cancelling the first request', async () => {
    const { update, shell, onNeedsResize } = setup(); update(); await flush(); onNeedsResize.mockClear();
    shell.setData({ enabled: false }); shell.setData({ enabled: false }); await flush(); expect(onNeedsResize).toHaveBeenCalledTimes(1);
  });
  it('leaves no queued callback, components, styles or listeners after final disposal', async () => {
    const { update, measure, shell, onNeedsResize, navButton, onSelect, card } = setup(); update(); measure(); const old = navButton('settings');
    shell.dispose(); shell.dispose(); old.click(); await flush(); expect(onNeedsResize).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
    expect(card.shadowRoot.querySelector('[data-taylors3d-house-shell-style]')).toBeNull(); expect(card._stage.style.minHeight).toBe('');
    expect(shell.setData({ enabled: true }).valid).toBe(false); expect(shell.measure({ baseHeight: 600 }).mode).toBe('disposed');
  });
  it.each(['ha', 'dark', 'light'])('sets only the requested %s palette without overriding HA colour variables', (scheme) => {
    const { update, card } = setup(); card.style.setProperty('--primary-color', '#123456'); update({ scheme });
    expect(card.getAttribute('data-taylors3d-scheme')).toBe(scheme === 'ha' ? null : scheme); expect(card.style.getPropertyValue('--primary-color')).toBe('#123456');
  });
  it.each([{ enabled: 'true' }, { scheme: 'unknown' }, { editing: 'true' }])('rejects malformed explicit shell policy %j and restores dormant geometry', (policy) => {
    const { update, measure, shell, card } = setup(); update(); measure(); expect(shell.setData({ enabled: true, ...policy }).valid).toBe(false);
    expect(shell.enabled).toBe(false); expect(card._stage.style.minHeight).toBe('');
  });
  it('injects only the scoped house theme into this card shadow tree, not global document styles', () => {
    const { update, card, shell } = setup(); update(); expect(shell.style.textContent).toBe(TAYLORS3D_THEME_CSS);
    expect(shell.style.parentNode).toBe(card.shadowRoot); expect(document.head.querySelector('[data-taylors3d-house-shell-style]')).toBeNull();
  });
  it('restores and deactivates an old stage when the current card temporarily has no stage', () => {
    const { update, measure, shell, card, navButton, onSelect } = setup(); update(); measure(); const old = card._stage, button = navButton('settings');
    card._stage = null; expect(shell.setData({ enabled: true }).valid).toBe(false); expect(shell.enabled).toBe(false);
    expect(old.style.minHeight).toBe(''); expect(card.hasAttribute('data-taylors3d-theme')).toBe(false); button.click(); expect(onSelect).not.toHaveBeenCalled();
  });
  it('supports a plain light-DOM host without appending a second element to the document itself', () => {
    const card = document.createElement('div'); document.body.append(card); card._stage = document.createElement('div'); card.append(card._stage);
    const shell = new HouseShell(card); disposables.push(shell); expect(() => shell.setData({ enabled: true })).not.toThrow();
    expect(shell.style.parentNode).toBe(card._stage);
  });
});

describe('navigation held intent through actual shell context changes', () => {
  it.each(['connection', 'user', 'permissions', 'editing', 'off'])('poisons a held Settings press when %s changes and allows a new gesture afterwards', (kind) => {
    const { card, update, shell, navButton, onSelect } = setup(); update(); const old = navButton('settings'); old.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    if (kind === 'connection') { card._hass.connection.connected = false; update(); card._hass.connection.connected = true; update(); }
    if (kind === 'user') { card._hass.user.id = 'another'; update(); }
    if (kind === 'permissions') { card._hass.user.permissions = { entities: {} }; update(); }
    if (kind === 'editing') { update({ editing: true }); update({ editing: false }); }
    if (kind === 'off') { shell.setData({ enabled: false }); update(); }
    old.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); old.click(); expect(onSelect).not.toHaveBeenCalled();
    const fresh = navButton('settings'); fresh.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); fresh.click(); expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('retains one intentional keyboard selection through unrelated current HA state updates', () => {
    const { card, update, navButton, onSelect } = setup(); update(); const control = navButton('lights'); control.focus();
    control.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' })); card._hass.states['sensor.new'] = state('sensor.new', '5'); update();
    control.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' })); control.click(); expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('retains every supplied narrow category, including Settings, rather than replacing extras with fake More actions', () => {
    const { update, measure, shell } = setup({ width: 320 }); const items = [...HOUSE_NAVIGATION_ITEMS, { id: 'extra', label: 'Extra room tools', icon: 'mdi:tools', action: { type: 'category', id: 'extra' } }];
    update({ navItems: items }); measure(); expect(shell.navigation.items.children).toHaveLength(8);
    expect([...shell.navigation.items.children].map((button) => button.textContent)).toContain('Settings'); expect(shell.navigation.items.textContent).not.toContain('More');
  });
});
