// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';

const cards = [];
function fixture() {
  const card = document.createElement('taylors3d-card'); cards.push(card);
  const room = { id: 'm:office', area_id: 'office', floor_id: 'ground' };
  card._config = {}; card._loading = false; card._editing = false;
  card._roomList = [{ room }];
  card._layout = { room_actions: { version: 1, rooms: [{ room_id: room.id, actions: [{ id: 'movie', entity: 'scene.real_movie', label: 'User_Movie' }] }] } };
  card._hass = { user: { id: 'viewer', is_active: true }, connection: { connected: true }, entities: {}, devices: {},
    states: { 'scene.real_movie': { state: 'unknown', attributes: {} } }, services: { scene: { turn_on: {} } }, callService: vi.fn().mockResolvedValue(undefined) };
  card._devicePopup = { isOpen: true, _selection: { kind: 'room', room } };
  return { card, room };
}
afterEach(() => { cards.length = 0; });

describe('root room shortcut command boundary', () => {
  it('submits one deliberately addressed current shortcut using the official scene service', async () => {
    const { card, room } = fixture(); await card._runRoomShortcut(room.id, 'movie');
    expect(card._hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.real_movie' });
  });
  it.each(['closed', 'different-room', 'device-panel', 'editing', 'loading', 'removed-room'])('rejects stale %s room ownership', async (kind) => {
    const { card, room } = fixture();
    if (kind === 'closed') card._devicePopup.isOpen = false;
    if (kind === 'different-room') card._devicePopup._selection.room = { id: 'other' };
    if (kind === 'device-panel') card._devicePopup._selection.kind = 'marker';
    if (kind === 'editing') card._editing = true;
    if (kind === 'loading') card._loading = true;
    if (kind === 'removed-room') card._roomList = [];
    await expect(card._runRoomShortcut(room.id, 'movie')).rejects.toThrow(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('rechecks current source and authenticated connection after the panel opened', async () => {
    const { card, room } = fixture(); expect(card._roomShortcutData(room.id).actions[0].available).toBe(true);
    card._hass.states['scene.real_movie'].state = 'unavailable';
    await expect(card._runRoomShortcut(room.id, 'movie')).rejects.toThrow();
    card._hass.states['scene.real_movie'].state = 'unknown'; card._hass.connection.connected = false;
    await expect(card._runRoomShortcut(room.id, 'movie')).rejects.toThrow(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps explicit shared invalid/null data from falling back to a different card source', async () => {
    const { card, room } = fixture(); card._config.room_actions = card._layout.room_actions; card._layout.room_actions = null;
    expect(card._roomShortcutData(room.id).actions).toEqual([]);
    await expect(card._runRoomShortcut(room.id, 'movie')).rejects.toThrow(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['layout', 'config'])('does not evaluate an own %s shortcut accessor before inspection', async (owner) => {
    const { card, room } = fixture();
    if (owner === 'config') delete card._layout.room_actions;
    const getter = vi.fn(() => { throw new Error('Imported accessor must not execute'); });
    Object.defineProperty(card[`_${owner}`], 'room_actions', { enumerable: true, get: getter });
    expect(card._roomShortcutData(room.id).actions).toEqual([]);
    await expect(card._runRoomShortcut(room.id, 'movie')).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
