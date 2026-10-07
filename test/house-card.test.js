// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';
import { cleanConfig, SCHEMA } from '../src/card-editor.js';
import { DevicePopup } from '../src/device-popup.js';
import { houseBaseHeight } from '../src/house-card-size.js';

const fixtures = [];
function fixture() {
  const card = new (customElements.get('taylors3d-card'))();
  Object.defineProperty(card, 'isConnected', { value: true, configurable: true });
  const stage = document.createElement('div'); document.body.append(stage);
  stage.style.height = '520px'; stage.getBoundingClientRect = () => ({ width: 1280, height: 520, left: 0, top: 0 });
  const scene = document.createElement('div'), toolbar = document.createElement('nav'); stage.append(scene, toolbar);
  card._stage = stage; card._scene = scene; card._toolbar = toolbar;
  card._config = { layout_style: 'house', house_colour_scheme: 'dark', control_panel: 'popup' };
  card._layout = {}; card._loading = false; card._editing = false;
  card._hass = { connection: { connected: true }, user: { id: 'current', is_admin: true }, states: {
    'light.lounge': { entity_id: 'light.lounge', state: 'on', attributes: { friendly_name: 'Real lounge lamp' } },
    'light.offline': { entity_id: 'light.offline', state: 'unavailable', attributes: { friendly_name: 'Offline lamp' } },
  }, entities: {}, services: { light: { toggle: {} } }, callService: vi.fn() };
  card._resize = vi.fn(); card._stopScenePreview = vi.fn(); card._popup = { close: vi.fn() };
  card._setMode = vi.fn(); card._toggleEdit = vi.fn();
  card._devicePopup = new DevicePopup(stage, { placement: 'popup', onAction: card._hass.callService, onMoreInfo: vi.fn() });
  card._ro = { observe: vi.fn(), unobserve: vi.fn() }; card._houseObserved = new Set();
  fixtures.push({ card, stage }); return { card, stage };
}
afterEach(() => {
  for (const { card, stage } of fixtures.splice(0)) {
    card._devicePopup.dispose(); card._houseShell?.dispose(); stage.remove();
    card._ambientController.dispose(); card._scenePreviewController.dispose(); card._presetEvents.disconnect();
  }
  vi.restoreAllMocks();
});

describe('House layout card integration', () => {
  it('starts new cards in the requested dark house layout while keeping old saved defaults small', () => {
    expect(customElements.get('taylors3d-card').getStubConfig()).toEqual({ layout_style: 'house', house_colour_scheme: 'dark', marker_display: 'rooms' });
    expect(cleanConfig({ layout_style: 'original', house_colour_scheme: 'ha' })).toEqual({});
    expect(cleanConfig({ layout_style: 'house', house_colour_scheme: 'light' })).toEqual({ layout_style: 'house', house_colour_scheme: 'light' });
    expect(cleanConfig({ layout_style: '<invalid>', house_colour_scheme: 4 })).toEqual({});
    const fields = SCHEMA.flatMap((field) => field.schema || [field]);
    expect(fields.find((field) => field.name === 'layout_style').selector.select.options.map((option) => option.value)).toEqual(['original', 'house']);
  });
  it('keeps a standard card outside the new shell', () => {
    const { card } = fixture(); card._config.layout_style = 'original';
    card._syncHouseShell();
    expect(card._houseShell).toBeUndefined(); expect(card._ro.observe).not.toHaveBeenCalled();
  });
  it.each(['dark', 'light', 'ha'])('uses %s appearance in standard layout without creating House controls or device requests', (scheme) => {
    const { card, stage } = fixture();
    card._config.layout_style = 'original'; card._config.house_colour_scheme = scheme;
    const initialHeight = stage.style.height;
    card._syncHouseShell();
    expect(card.getAttribute('data-taylors3d-theme')).toBe('glass');
    expect(card.getAttribute('data-taylors3d-scheme')).toBe(scheme === 'ha' ? null : scheme);
    expect(card._houseShell).toBeUndefined(); expect(stage.style.height).toBe(initialHeight);
    expect(card._resize).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each([true, false])('keeps destructive-action fallback readable when Home Assistant reports darkMode=%s', (darkMode) => {
    const { card } = fixture(); card._config.house_colour_scheme = 'ha';
    card._hass.themes = { darkMode }; card._syncHouseShell();
    expect(card.style.getPropertyValue('--taylors3d-ui-ha-danger')).toBe(darkMode ? '#ffb4a9' : '#a32620');
    card._hass.themes = { darkMode: !darkMode }; card._syncHouseShell();
    expect(card.style.getPropertyValue('--taylors3d-ui-ha-danger')).toBe(darkMode ? '#a32620' : '#ffb4a9');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each([['#1c1c1e', '#ffb4a9'], ['#ffffff', '#a32620']])('reads the inherited %s surface when Home Assistant has no mode flag', (background, danger) => {
    const { card } = fixture(); card._config.house_colour_scheme = 'ha';
    card.style.setProperty('--card-background-color', background); card._syncHouseShell();
    expect(card.style.getPropertyValue('--taylors3d-ui-ha-danger')).toBe(danger);
    expect(card.style.getPropertyValue('--card-background-color')).toBe(background);
  });
  it('retains the chosen appearance when changing layout and clears an explicit scheme when HA colours are selected', () => {
    const { card } = fixture();
    card._syncHouseShell();
    expect(card.getAttribute('data-taylors3d-theme')).toBe('house');
    card._config.layout_style = 'original'; card._syncHouseShell();
    expect(card.getAttribute('data-taylors3d-theme')).toBe('glass');
    expect(card.getAttribute('data-taylors3d-scheme')).toBe('dark');
    card._config.house_colour_scheme = 'ha'; card._syncHouseShell();
    expect(card.hasAttribute('data-taylors3d-scheme')).toBe(false);
    card._config.layout_style = 'house'; card._config.house_colour_scheme = 'light'; card._syncHouseShell();
    expect(card.getAttribute('data-taylors3d-theme')).toBe('house');
    expect(card.getAttribute('data-taylors3d-scheme')).toBe('light');
  });
  it('creates stable header/navigation and observes a new popup exactly once', () => {
    const { card } = fixture(); card._syncHouseShell();
    const header = card._houseShell.header.element, nav = card._houseShell.navigation.element;
    expect(card._devicePopup.placement).toBe('right');
    expect(card._ro.observe.mock.calls.map(([node]) => node)).toEqual([header, nav]);
    card._selectHouseNavigation({ type: 'category', id: 'lights' }); card._syncHouseShell();
    const popup = card._devicePopup.el;
    expect(card._ro.observe.mock.calls.filter(([node]) => node === popup)).toHaveLength(1);
    card._devicePopup.close(); card._syncHouseShell();
    expect(card._ro.unobserve).toHaveBeenCalledWith(popup);
    expect(card._houseShell.header.element).toBe(header); expect(card._houseShell.navigation.element).toBe(nav);
  });
  it('opening real category controls only reads states and leaves unavailable lamps disabled', () => {
    const { card } = fixture(); card._selectHouseNavigation({ type: 'category', id: 'lights' });
    expect(card._devicePopup.el.textContent).toContain('Real lounge lamp');
    expect(card._devicePopup.el.textContent).toContain('Offline lamp');
    expect(card._devicePopup.el.querySelector('[data-action="toggle"][data-entity="light.offline"]').disabled).toBe(true);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._setMode).not.toHaveBeenCalled();
    expect(card._houseSelection).toBe('lights');
  });
  it('rechecks current registry membership before a held category control can send a command', () => {
    const { card } = fixture(); card._selectHouseNavigation({ type: 'category', id: 'lights' });
    const button = card._devicePopup.el.querySelector('[data-action="toggle"][data-entity="light.lounge"]');
    card._hass.entities = { 'light.lounge': { entity_id: 'light.lounge', hidden: true } };
    button.click();
    expect(card._hass.callService).not.toHaveBeenCalled();
    card._devicePopup.update(card._hass); expect(card._devicePopup.el.textContent).not.toContain('Real lounge lamp');
  });
  it('keeps a dynamically resolved category through marker rebuilds while closing a room snapshot', () => {
    const { card } = fixture(); card._floors = []; card._view = { setMarkers: vi.fn(), floorElevation: () => 0 };
    card._applyMarkerStates = vi.fn(); card._selectHouseNavigation({ type: 'category', id: 'lights' });
    const original = card._devicePopup.el; card._hass.entities = { 'light.lounge': { hidden: true } };
    card._buildMarkers(); card._devicePopup.update(card._hass);
    expect(card._devicePopup.el).toBe(original); expect(original.textContent).not.toContain('Real lounge lamp');
    card._devicePopup.showRoom({ id: 'room', name: 'Current room', area_id: 'room-area' }, []);
    card._buildMarkers(); expect(card._devicePopup.isOpen).toBe(false);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('blocks old category controls when the current connection is lost', () => {
    const { card } = fixture(); card._selectHouseNavigation({ type: 'category', id: 'lights' });
    const button = card._devicePopup.el.querySelector('[data-action="toggle"][data-entity="light.lounge"]');
    card._hass.connection.connected = false; button.click();
    card._selectHouseNavigation({ type: 'control', id: '3d' });
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._setMode).not.toHaveBeenCalled();
  });
  it('updates a live empty category explanation when its actual source or bounds change', () => {
    const { card } = fixture(); card._selectHouseNavigation({ type: 'category', id: 'lights' });
    card._hass.states = Object.fromEntries(Array.from({ length: 513 }, (_, index) =>
      [`light.current_${index}`, { state: 'on', attributes: {} }]));
    card._devicePopup.update(card._hass);
    expect(card._devicePopup.el.textContent).toContain('More than 512 current lights entities');
    card._hass.states = {}; card._devicePopup.update(card._hass);
    expect(card._devicePopup.el.textContent).toContain('No current visible lights');
    expect(card._devicePopup.el.textContent).not.toContain('More than 512');
    card._hass.connection.connected = false; card._devicePopup.update(card._hass);
    expect(card._devicePopup.el.textContent).toContain('Connect to Home Assistant');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['connection', 'account'])('cancels an unfinished lamp adjustment across a ready %s replacement, then accepts a fresh action', (kind) => {
    const { card } = fixture();
    card._hass.states['light.lounge'].attributes = { brightness: 128, color_mode: 'brightness', supported_color_modes: ['brightness'] };
    card._hass.services.light.turn_on = {}; card._hass.services.light.turn_off = {};
    card._selectHouseNavigation({ type: 'category', id: 'lights' });
    const old = card._devicePopup.el.querySelector('[data-light-control="brightness"]');
    old.value = '35'; old.dispatchEvent(new Event('input', { bubbles: true }));
    card._syncScenePreviews = vi.fn(); card._syncAmbient = vi.fn(); card._schedule = vi.fn();
    card._suspendAmbient = vi.fn(); card._presetEvents.setHass = vi.fn();
    const next = { ...card._hass,
      ...(kind === 'connection' ? { connection: { connected: true } } : { user: { id: 'another-current-user', is_admin: true } }),
    };
    card.hass = next; old.dispatchEvent(new Event('change', { bubbles: true }));
    expect(next.callService).not.toHaveBeenCalled(); expect(card._devicePopup.isOpen).toBe(false);
    card._selectHouseNavigation({ type: 'category', id: 'lights' });
    const fresh = card._devicePopup.el.querySelector('[data-light-control="brightness"]');
    fresh.value = '40'; fresh.dispatchEvent(new Event('input', { bubbles: true })); fresh.dispatchEvent(new Event('change', { bubbles: true }));
    expect(next.callService).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.lounge', brightness: 102 });
  });
  it('returns to the existing 3D action and closes the category without changing a device', () => {
    const { card } = fixture(); card._selectHouseNavigation({ type: 'category', id: 'lights' });
    card._selectHouseNavigation({ type: 'control', id: '3d' });
    expect(card._setMode).toHaveBeenCalledExactlyOnceWith('3d'); expect(card._devicePopup.isOpen).toBe(false);
    expect(card._houseSelection).toBe('house'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'https://outside.invalid', '__proto__'])('does not invent a panel or route for %s', (id) => {
    const { card } = fixture(); card._selectHouseNavigation({ type: 'category', id });
    expect(card._devicePopup.isOpen).toBe(false); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('uses the native House tab action only for the current admin', () => {
    const { card } = fixture(); const panel = document.createElement('div');
    panel.innerHTML = '<button data-act="tab" data-id="house">House</button>';
    const select = vi.fn(); panel.firstChild.addEventListener('click', select); card._edit = { panel, tab: 'rooms' };
    card._selectHouseNavigation({ type: 'category', id: 'settings' });
    expect(card._toggleEdit).toHaveBeenCalledOnce(); expect(select).toHaveBeenCalledOnce();
    card._hass.user.is_admin = false; card._selectHouseNavigation({ type: 'category', id: 'settings' });
    expect(card._toggleEdit).toHaveBeenCalledOnce(); expect(select).toHaveBeenCalledOnce();
  });
  it.each(['not-editing', 'wrong-tab', 'not-admin', 'disconnected', 'loading', 'standard'])('rejects House summary writes in %s', (reason) => {
    const { card } = fixture(); card._editing = true; card._edit = { tab: 'house' };
    if (reason === 'not-editing') card._editing = false;
    if (reason === 'wrong-tab') card._edit.tab = 'model';
    if (reason === 'not-admin') card._hass.user.is_admin = false;
    if (reason === 'disconnected') card._hass.connection.connected = false;
    if (reason === 'loading') card._loading = true;
    if (reason === 'standard') card._config.layout_style = 'original';
    expect(card.houseSummaryEditorAvailable()).toBe(false);
  });
  it('permits House summary drafts in the current admin House tab only', () => {
    const { card } = fixture(); card._editing = true; card._edit = { tab: 'house' };
    expect(card.houseSummaryEditorAvailable()).toBe(true);
  });
  it('removes owned layout and observers and restores popup placement when switched off', () => {
    const { card, stage } = fixture(); card.setAttribute('data-taylors3d-theme', 'earlier');
    stage.style.setProperty('--taylors3d-bar-height', '22px', 'important');
    card._syncHouseShell(); card._config.layout_style = 'original'; card._syncHouseShell();
    expect(card.getAttribute('data-taylors3d-theme')).toBe('glass');
    expect(stage.style.getPropertyValue('--taylors3d-bar-height')).toBe('22px');
    expect(stage.style.getPropertyPriority('--taylors3d-bar-height')).toBe('important');
    expect(card._devicePopup.placement).toBe('popup'); expect(card._houseObserved.size).toBe(0);
  });
  it.each(['top-left', 'top-right'])('reserves header/navigation space for the %s mini-map and restores its exact styles', (corner) => {
    const { card, stage } = fixture(); card._config.mini_map_position = corner;
    const map = document.createElement('div'); map.className = 'taylors3d-minimap';
    map.style.cssText = 'top:12px;left:12px;right:19px!important'; stage.append(map); card._miniMap = { el: map };
    const before = map.style.cssText; card._syncHouseShell(); card._houseShell.measure({ baseHeight: 520 });
    expect(map.style.top).not.toBe('12px');
    expect(map.style[corner === 'top-left' ? 'left' : 'right']).toContain('calc(');
    card._config.layout_style = 'original'; card._syncHouseShell();
    expect(map.style.cssText).toBe(before);
  });
  it('drops an old mini-map from its ownership journal after replacement', () => {
    const { card, stage } = fixture(); const first = document.createElement('div'), second = document.createElement('div');
    first.className = second.className = 'taylors3d-minimap'; first.style.top = second.style.top = '12px';
    stage.append(first, second); card._miniMap = { el: first }; card._syncHouseShell(); card._houseShell.measure({ baseHeight: 520 });
    card._miniMap = { el: second }; card._houseShell.measure({ baseHeight: 520 });
    expect(first.style.top).toBe('12px'); expect(card._houseShell._styles.has(first)).toBe(false);
    card._houseShell.dispose(); expect(second.style.top).toBe('12px');
  });
});

describe('configured House stage height', () => {
  it.each(['', 'important'])('measures before expansion and restores the exact original priority %s', (priority) => {
    const stage = document.createElement('div'); stage.style.setProperty('min-height', '810px', priority);
    stage.getBoundingClientRect = () => ({ height: stage.style.getPropertyValue('min-height') === '0px' ? 520 : 810 });
    expect(houseBaseHeight(stage)).toBe(520);
    expect(stage.style.getPropertyValue('min-height')).toBe('810px'); expect(stage.style.getPropertyPriority('min-height')).toBe(priority);
  });
  it('restores a missing inline minimum and does not leak it on measurement error', () => {
    const stage = document.createElement('div'); stage.getBoundingClientRect = () => { throw new Error('Read failed'); };
    expect(() => houseBaseHeight(stage)).toThrow('Read failed'); expect(stage.style.getPropertyValue('min-height')).toBe('');
  });
  it.each([NaN, Infinity, '520', -1, 1e7])('does not accept a malformed measurement %s', (height) => {
    const stage = document.createElement('div'); stage.getBoundingClientRect = () => ({ height });
    expect(houseBaseHeight(stage)).toBe(0);
  });
});
