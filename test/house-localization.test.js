// @vitest-environment jsdom
// Real shadow-root nodes and native events; no renderer/browser-pixel claim.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';
import { HouseNavigation, HOUSE_NAVIGATION_ITEMS, localizeHouseNavigationItems } from '../src/house-navigation.js';
import { HouseHeader } from '../src/house-header.js';
import { HouseShell } from '../src/house-shell.js';
import { buildHouseSummary } from '../src/house-summary.js';
import { localize } from '../src/localization.js';

const cleanups = [];
afterEach(() => { cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); vi.restoreAllMocks(); });
const state = (entity_id, value, attributes = {}) => ({ entity_id, state: value, attributes });
const settings = { title: "Taylor's 3D — User_Title", weather_entity: 'weather.exact', person_entities: ['person.exact'], alarm_entity: 'alarm_control_panel.exact', vendor: { unchanged: 'Räume' } };
function current(language = 'en') {
  return { locale: { language }, language: 'en', user: { id: 'current-user', is_active: true }, connection: { connected: true },
    config: { location_name: 'Actual_User_Address' }, entities: {}, devices: {}, states: {
      'light.exact': state('light.exact', 'on', { friendly_name: 'User_Lamp_Name' }),
      'light.offline': state('light.offline', 'unavailable'),
      'weather.exact': state('weather.exact', 'sunny', { friendly_name: 'User_Weather_Name', temperature: -2.5, temperature_unit: '°C' }),
      'person.exact': state('person.exact', 'home', { friendly_name: 'User_Person_Name' }),
      'alarm_control_panel.exact': state('alarm_control_panel.exact', 'disarmed'),
    }, callService: vi.fn(), callWS: vi.fn() };
}
function parent() {
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
  cleanups.push(() => host.remove()); return { host, root };
}
function pointer(button, type) { button.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { button: 0, pointerId: 5 })); }
function start(button, kind) { if (kind === 'pointer') pointer(button, 'pointerdown'); else button.dispatchEvent(new KeyboardEvent('keydown', { key: kind, bubbles: true })); }
function finish(button, kind) { if (kind === 'pointer') pointer(button, 'pointerup'); else button.dispatchEvent(new KeyboardEvent('keyup', { key: kind, bubbles: true })); button.click(); }
function shellFixture(hass = current()) {
  const { host, root } = parent(); root.innerHTML = '<div class="stage"><div class="scene"></div><nav class="toolbar"></nav></div>';
  host._stage = root.querySelector('.stage'); host._scene = root.querySelector('.scene'); host._toolbar = root.querySelector('.toolbar'); host._hass = hass;
  host._stage.getBoundingClientRect = () => ({ width: 1000, height: 520 });
  const onSelect = vi.fn(), onNeedsResize = vi.fn(), shell = new HouseShell(host, { onSelect, onNeedsResize }); cleanups.push(() => shell.dispose());
  const update = (extra = {}) => shell.setData({ enabled: true, summaryRaw: settings, ...extra });
  return { host, root, shell, onSelect, onNeedsResize, update, button: (id) => shell.navigation.element.querySelector(`[data-house-navigation-id="${id}"]`) };
}

describe('House built-ins and locale-owned captions', () => {
  it.each(['de-DE', 'fr-CA', 'es-MX', 'it-IT'])('localizes only built-in labels for %s and retains exact icons/actions/IDs', (language) => {
    const before = JSON.stringify(HOUSE_NAVIGATION_ITEMS), items = localizeHouseNavigationItems({ language });
    for (const [index, item] of items.entries()) {
      const original = HOUSE_NAVIGATION_ITEMS[index];
      expect(item.id).toBe(original.id); expect(item.icon).toBe(original.icon); expect(item.action).toBe(original.action);
      expect(item.label).toBe(localize({ language }, `house.nav.${item.id}`));
      expect(item).not.toBe(original);
    }
    items[0].label = 'Only returned copy'; expect(JSON.stringify(HOUSE_NAVIGATION_ITEMS)).toBe(before);
    expect(HOUSE_NAVIGATION_ITEMS[0].label).toBe('House / 3D');
  });

  it('does not translate custom navigation labels, routes or exact item IDs', () => {
    const { root } = parent(), onSelect = vi.fn(), nav = new HouseNavigation(root, { onSelect }); cleanups.push(() => nav.dispose());
    const custom = { id: 'lights', label: '<User_Light_Name> Lights', icon: 'mdi:lightbulb', action: { type: 'route', path: '/dashboard-user/Actual_View_ID' } };
    const before = JSON.stringify(custom); nav.update({ hass: current('de'), items: [custom] });
    const button = nav.items.firstChild; expect(button.textContent).toBe(custom.label); expect(button.getAttribute('aria-label')).toBe(custom.label);
    expect(nav.element.getAttribute('aria-label')).toBe('Hausnavigation'); expect(nav.element.querySelector('user_light_name')).toBeNull();
    button.click(); expect(onSelect).toHaveBeenCalledExactlyOnceWith(custom.action, { id: custom.id, label: custom.label, icon: custom.icon });
    expect(JSON.stringify(custom)).toBe(before);
  });

  it.each(['de', 'fr', 'es'])('%s localizes counts/captions without changing raw readings, names, native formatting or stored settings', (language) => {
    const hass = current(language), before = JSON.stringify({ states: hass.states, settings });
    hass.formatEntityState = function (source) { expect(this).toBe(hass); return `HA:${source.state}`; };
    hass.formatEntityAttributeValue = function (source, attribute) { expect(this).toBe(hass); expect(source).toBe(hass.states['weather.exact']); expect(attribute).toBe('temperature'); return 'HA:-2,50 °C'; };
    const summary = buildHouseSummary(hass, settings);
    expect(summary.title.text).toBe(settings.title); expect(summary.weather.name).toBe('User_Weather_Name');
    expect(summary.weather.label).toBe('HA:sunny · HA:-2,50 °C'); expect(summary.weather.temperature).toBe(-2.5); expect(summary.weather.unit).toBe('°C');
    expect(summary.people.rows[0]).toMatchObject({ entity: 'person.exact', name: 'User_Person_Name', label: 'HA:home' });
    expect(summary.people.label).toBe(localize(hass, 'house.summary.peopleHome', { home: 1, count: 1 }));
    expect(summary.alarm.label).toBe('HA:disarmed');
    expect(summary.lights.label).toBe(`${localize(hass, 'house.summary.lightsOn', { count: 1 })} · ${localize(hass, 'house.summary.unknown', { count: 1 })}`);
    expect(summary.lights.rows[0].entity).toBe('light.exact'); expect(summary.lights.rows[0].name).toBe('User_Lamp_Name');
    expect(summary.session.label).toBe(localize(hass, 'house.header.connected'));
    expect(JSON.stringify({ states: hass.states, settings })).toBe(before); expect(hass.callService).not.toHaveBeenCalled(); expect(hass.callWS).not.toHaveBeenCalled();
  });

  it('uses French zero grammar for actual counts and English grammar for an unsupported language', () => {
    const hass = current('fr'); hass.states['light.exact'].state = 'off';
    expect(buildHouseSummary(hass, settings).lights.label).toBe('0 lumière allumée · 1 au statut inconnu');
    hass.locale.language = 'ar'; expect(buildHouseSummary(hass, settings).lights.label).toBe('0 lights on · 1 unknown');
    expect(buildHouseSummary(hass, settings).people.label).toBe('1 of 1 selected person home');
  });

  it.each(['de', 'fr', 'es'])('%s keeps explicitly missing selections visible as unavailable instead of guessing replacement entities', (language) => {
    const hass = current(language); hass.connection.connected = false;
    const { root } = parent(), header = new HouseHeader(root); cleanups.push(() => header.dispose());
    header.update(buildHouseSummary(hass, settings), hass);
    expect(header.meta.textContent).toBe(localize(hass, 'house.header.waiting'));
    for (const [key, node] of header.rows) {
      expect(node.dataset.status).toBe('unavailable'); expect(node.hidden).toBe(false);
      expect(node.textContent).toBe(localize(hass, `house.header.${key}Unavailable`));
    }
    expect(header.title.textContent).toBe(settings.title); expect(hass.callService).not.toHaveBeenCalled();
  });
});

describe('House locale changes preserve current native controls', () => {
  it('passes current in-place HA locale through Shell without replacing focused controls or summary nodes', async () => {
    const hass = current(), f = shellFixture(hass); f.update(); await Promise.resolve();
    const button = f.button('lights'), header = f.shell.header.element, rows = [...f.shell.header.rows.values()], nav = f.shell.navigation.element;
    button.focus(); const before = JSON.stringify({ states: hass.states, settings }); f.onNeedsResize.mockClear();
    hass.locale.language = 'fr-CA'; f.update();
    expect(f.button('lights')).toBe(button); expect(f.root.activeElement).toBe(button); expect(f.shell.header.element).toBe(header);
    expect([...f.shell.header.rows.values()]).toEqual(rows); expect(f.shell.navigation.element).toBe(nav);
    expect(button.textContent).toBe('Lumières'); expect(button.getAttribute('aria-label')).toBe('Lumières');
    expect(nav.getAttribute('aria-label')).toBe('Navigation de la maison');
    expect(header.getAttribute('aria-label')).toBe(`Résumé de la maison pour ${settings.title}`);
    expect(f.shell.header.rows.get('lights').title).toContain('ampoules physiques');
    expect(f.shell.header.rows.get('people').getAttribute('aria-label')).toBe('Personnes sélectionnées : 1 sur 1 personne sélectionnée à la maison');
    expect(JSON.stringify({ states: hass.states, settings })).toBe(before); expect(f.onSelect).not.toHaveBeenCalled(); expect(hass.callService).not.toHaveBeenCalled();
    await Promise.resolve(); expect(f.onNeedsResize).toHaveBeenCalledOnce();
    f.onNeedsResize.mockClear(); f.update(); await Promise.resolve(); expect(f.onNeedsResize).not.toHaveBeenCalled();
  });

  it.each(['pointer', ' ', 'Enter'])('a language-only update preserves one deliberate %s selection without acting during update', (kind) => {
    const hass = current(), f = shellFixture(hass); f.update(); const button = f.button('lights'); button.focus(); start(button, kind);
    hass.locale.language = 'es'; f.update(); expect(f.onSelect).not.toHaveBeenCalled(); expect(f.button('lights')).toBe(button); expect(f.root.activeElement).toBe(button);
    finish(button, kind); expect(f.onSelect).toHaveBeenCalledExactlyOnceWith(HOUSE_NAVIGATION_ITEMS[1].action, expect.objectContaining({ id: 'lights', label: 'Luces' }));
    expect(hass.callService).not.toHaveBeenCalled(); expect(hass.callWS).not.toHaveBeenCalled();
  });

  it.each(['pointer', ' ', 'Enter'])('a held %s stays poisoned through session loss, language change and recovery', (kind) => {
    const hass = current(), f = shellFixture(hass); f.update(); const button = f.button('lights'); start(button, kind);
    hass.connection.connected = false; hass.locale.language = 'de'; f.update();
    hass.connection.connected = true; f.update(); finish(button, kind); expect(f.onSelect).not.toHaveBeenCalled();
    start(button, kind); finish(button, kind); expect(f.onSelect).toHaveBeenCalledOnce(); expect(f.onSelect.mock.calls[0][0]).toEqual({ type: 'category', id: 'lights' });
    expect(hass.callService).not.toHaveBeenCalled();
  });

  it('preserves explicitly supplied navigation labels through Shell language changes', () => {
    const hass = current('de'), f = shellFixture(hass), custom = { ...HOUSE_NAVIGATION_ITEMS[1], label: 'My_Custom_Lights' };
    f.update({ navItems: [custom] }); const button = f.button('lights');
    hass.locale.language = 'fr'; f.update({ navItems: [custom] }); expect(f.button('lights')).toBe(button); expect(button.textContent).toBe('My_Custom_Lights');
  });

  it('the actual card sync requests localized built-ins while preserving source configuration and selecting only explicit actions', () => {
    const card = new (customElements.get('taylors3d-card'))(); Object.defineProperty(card, 'isConnected', { value: true, configurable: true });
    const { root } = parent(); card._stage = document.createElement('div'); root.append(card._stage);
    card._stage.getBoundingClientRect = () => ({ width: 1000, height: 520 });
    card._scene = document.createElement('div'); card._toolbar = document.createElement('nav'); card._stage.append(card._scene, card._toolbar);
    card._hass = current('de'); card._config = { layout_style: 'house', house_summary: settings, user_label: 'My_User_Label' }; card._layout = { rooms: [{ id: 'Room_ID', name: 'My_Room_Name' }] };
    card._selectHouseNavigation = vi.fn(); card._resize = vi.fn(); const before = JSON.stringify({ config: card._config, layout: card._layout, states: card._hass.states });
    cleanups.push(() => { card._houseShell?.dispose(); card._ambientController.dispose(); card._scenePreviewController.dispose(); card._presetEvents.disconnect(); });
    card._syncHouseShell(); const button = card._houseShell.navigation.items.children[1]; button.focus();
    expect(button.textContent).toBe('Lichter'); card._hass.locale.language = 'es'; card._syncHouseShell();
    expect(card._houseShell.navigation.items.children[1]).toBe(button); expect(root.activeElement).toBe(button); expect(button.textContent).toBe('Luces');
    expect(card._selectHouseNavigation).not.toHaveBeenCalled(); button.click(); expect(card._selectHouseNavigation).toHaveBeenCalledExactlyOnceWith({ type: 'category', id: 'lights' });
    expect(JSON.stringify({ config: card._config, layout: card._layout, states: card._hass.states })).toBe(before); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
