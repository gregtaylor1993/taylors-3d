// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';
import { houseSearchItems } from '../src/house-search-data.js';

const cards = [];
const state = (name, value = 'off') => ({ state: value, attributes: { friendly_name: name } });
function fixture() {
  const card = new (customElements.get('taylors3d-card'))(); cards.push(card);
  Object.defineProperty(card, 'isConnected', { value: true, configurable: true });
  card._config = { layout_key: 'test', layout_style: 'house', device_tap_action: 'toggle' };
  card._layout = {}; card._view = { model: null };
  card._hass = { connection: { connected: true }, user: { id: 'me', is_active: true, is_admin: true },
    states: { 'light.lounge': state('Lounge lamp'), 'scene.bedtime': state('Bedtime', 'unknown') },
    entities: { 'light.lounge': { area_id: 'lounge' } }, areas: { lounge: { name: 'Lounge', floor_id: 'ground' } },
    floors: { ground: { name: 'Ground floor' } }, callService: vi.fn(), services: {} };
  card._floors = [{ id: 'ground', name: 'Ground floor', elevation: 0 }];
  card._roomList = [{ floorId: 'ground', name: 'Lounge', room: { id: 'lounge-room', area_id: 'lounge', polygon: [[0, 0], [4, 0], [4, 4]] } }];
  card._views = [{ id: 'front', label: 'Front door' }];
  card._edit = { _hasObjects: () => false, revealTab: vi.fn(() => true) };
  card._popup = { close: vi.fn() };
  card._devicePopup = { update: vi.fn(), showMarker: vi.fn(), showRoom: vi.fn() };
  card._suspendAmbient = vi.fn(); card._stopScenePreview = vi.fn(); card._syncMiniMap = vi.fn();
  card._syncMarkerOverview = vi.fn(); card._setView = vi.fn(); card._toggleEdit = vi.fn(() => { card._editing = true; });
  return card;
}
afterEach(() => { for (const card of cards.splice(0)) {
  card._ambientController.dispose(); card._scenePreviewController.dispose(); card._presetEvents.disconnect(); card._feedback?.dispose();
} });

describe('search index and card destinations', () => {
  it('includes real friendly names, areas, saved views and admin settings', () => {
    const card = fixture(), items = card._searchContext().items;
    expect(items.find((item) => item.id === 'device:light.lounge')).toMatchObject({ label: 'Lounge lamp', subtitle: 'Lounge · Ground floor' });
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining(['room:lounge-room', 'scene:scene.bedtime', 'view:front', 'setting:controls']));
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('excludes hidden, disabled and diagnostic entities, duplicate/stale rooms and hidden views', () => {
    const card = fixture();
    for (const [id, registry] of Object.entries({ hidden: { hidden_by: 'user' }, disabled: { disabled_by: 'user' }, diagnostic: { entity_category: 'diagnostic' } })) {
      card._hass.states[`sensor.${id}`] = state(id); card._hass.entities[`sensor.${id}`] = registry;
    }
    card._views.push({ id: 'hidden', label: 'Hidden', hidden: true }); card._roomList.push(card._roomList[0]);
    const ids = card._searchContext().items.map((item) => item.id);
    expect(ids).not.toContain('room:lounge-room'); expect(ids).not.toContain('view:hidden');
    for (const id of ['hidden', 'disabled', 'diagnostic']) expect(ids).not.toContain(`device:sensor.${id}`);
  });
  it('indexes the visible kind and editor group names in the current language', () => {
    const card = fixture();
    expect(card._searchContext().items.find((item) => item.id === 'setting:house').keywords).toEqual(expect.arrayContaining(['Appearance', 'Settings']));
    expect(card._searchContext().items.find((item) => item.id === 'device:light.lounge').keywords).toContain('Devices');
    card._hass.language = 'de';
    expect(card._searchContext().items.find((item) => item.id === 'setting:house').keywords).toContain('Einstellungen');
  });
  it.each(['device:light.lounge', 'scene:scene.bedtime'])('opens %s controls without using the configured Toggle tap', (id) => {
    const card = fixture(), item = card._searchContext().items.find((entry) => entry.id === id);
    expect(card._selectSearchResult(item)).toBe(true);
    expect(card._devicePopup.showMarker).toHaveBeenCalledWith(expect.objectContaining({ entityId: item.target }));
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('opens the current room with actual marker membership and leaves the camera alone', () => {
    const card = fixture(), item = card._searchContext().items.find((entry) => entry.kind === 'room');
    expect(card._selectSearchResult(item)).toBe(true);
    expect(card._devicePopup.showRoom).toHaveBeenCalledWith(expect.objectContaining({ id: 'lounge-room' }), expect.any(Array), undefined);
    expect(card._setView).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('uses existing view and editor routes only after choosing a result', () => {
    const card = fixture();
    card._selectSearchResult(card._searchContext().items.find((entry) => entry.kind === 'view'));
    expect(card._setView).toHaveBeenCalledWith('front');
    card._selectSearchResult(card._searchContext().items.find((entry) => entry.id === 'setting:controls'));
    expect(card._edit.revealTab).toHaveBeenCalledWith('controls'); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('rejects a result removed or hidden since the search opened', () => {
    const card = fixture(), item = card._searchContext().items.find((entry) => entry.id === 'device:light.lounge');
    card._hass.entities['light.lounge'].hidden_by = 'user';
    expect(card._selectSearchResult(item)).toBe(false); expect(card._devicePopup.showMarker).not.toHaveBeenCalled();
  });
  it('distinguishes identically named HA entities with their actual source IDs', () => {
    const card = fixture(); card._hass.states['sensor.lounge_power'] = state('Lounge lamp');
    const items = card._searchContext().items;
    expect(items.find((item) => item.id === 'device:light.lounge').subtitle).toContain('light.lounge');
    expect(items.find((item) => item.id === 'device:sensor.lounge_power').subtitle).toContain('sensor.lounge_power');
  });
  it('keeps the visible search trigger truthful through disconnect, recovery and loading', () => {
    const card = fixture(); card._searchButton = document.createElement('button');
    card._syncSearch(); expect(card._searchButton.disabled).toBe(false);
    card._hass.connection.connected = false; card._syncSearch(); expect(card._searchButton.disabled).toBe(true);
    card._hass.connection.connected = true; card._syncSearch(); expect(card._searchButton.disabled).toBe(false);
    card._customControlsModelLoad = {}; card._syncSearch(); expect(card._searchButton.disabled).toBe(true);
  });
  it.each(['disconnect', 'inactive', 'editing', 'loading', 'model loading'])('suspends all search destinations during %s', (reason) => {
    const card = fixture(), before = card._searchContext(), item = before.items[0];
    if (reason === 'disconnect') card._hass.connection.connected = false;
    if (reason === 'inactive') card._hass.user.is_active = false;
    if (reason === 'editing') card._editing = true;
    if (reason === 'loading') card._loading = true;
    if (reason === 'model loading') card._customControlsModelLoad = {};
    expect(card._searchContext()).toMatchObject({ suspended: true, items: [] });
    expect(card._searchContext().contextKey).not.toBe(before.contextKey);
    expect(card._selectSearchResult(item)).toBe(false); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps read-only users away from settings and invalidates old admin results', () => {
    const card = fixture(), context = card._searchContext(), item = context.items.find((entry) => entry.kind === 'setting');
    card._hass.user.is_admin = false;
    expect(card._searchContext().items.some((entry) => entry.kind === 'setting')).toBe(false);
    expect(card._searchContext().contextKey).not.toBe(context.contextKey);
    expect(card._selectSearchResult(item)).toBe(false); expect(card._toggleEdit).not.toHaveBeenCalled();
  });
  it('does not invent a room or expose a House-only setting for standard layout', () => {
    const items = houseSearchItems({ hass: { user: { is_admin: true } }, rooms: [{ room: { id: 'missing', area_id: 'unknown' } }], layoutStyle: 'original' });
    expect(items.some((item) => item.kind === 'room' || item.id === 'setting:house' || item.id === 'setting:objects')).toBe(false);
  });
});
