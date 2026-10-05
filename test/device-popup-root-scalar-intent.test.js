// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevicePopup } from '../src/device-popup.js';
import '../src/taylors3d-card.js';

// Actual Root setters and popup DOM handlers. The browser diagnostic separately
// proves trusted Tab/change/focusout and Close-pointer/change/click ordering.
// jsdom has no native dirty-field blur change, so deliver that proven event order.
const entity = 'media_player.current', room = { id: 'actual-room', area_id: 'room' }, cleanup = [];
const modes = ['house', 'original'];
const settle = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
const key = (node, type, value) => node.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true }));
const change = (node) => node.dispatchEvent(new Event('change', { bubbles: true }));
const pointer = (node, type) => {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { button: 0, isPrimary: true, pointerId: 1 }); node.dispatchEvent(event);
};
const type = (node, value) => {
  node.focus(); const last = value.slice(-1); key(node, 'keydown', last);
  node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); key(node, 'keyup', last);
};
function fixture(mode) {
  const card = document.createElement('taylors3d-card'); document.body.append(card);
  const stage = document.createElement('div'); card.shadowRoot.append(stage);
  const h = { language: 'en', locale: { language: 'en' }, auth: {}, connection: Object.assign(new EventTarget(), { connected: true }),
    user: { id: 'current-user', is_admin: true, is_active: true, permissions: { fixture_control: true } },
    callService: vi.fn().mockResolvedValue(undefined), callWS: vi.fn(), entities: {}, devices: {}, areas: { room: { name: 'User_Room_été' } },
    services: { media_player: { volume_set: {}, media_play: {} } },
    states: { [entity]: { entity_id: entity, state: 'playing', attributes: { friendly_name: 'User_Player_été',
      supported_features: 16384 + 4, volume_level: .5 } } } };
  card._config = { layout_style: mode }; card._hass = h; card._loading = true;
  card._layout = { version: 1, rooms: [], extension: { retained: ['α', false, null] } };
  // Hold only graphics/scheduled paint. House still uses its actual immediate
  // popup update and session check; Original retains its actual deferred behavior.
  for (const method of ['_schedule', '_observeSecuritySession', '_observeAlertMapContext', '_syncSecurity',
    '_syncFurniture', '_syncHouseShell', '_syncScenePreviews', '_syncAmbient']) vi.spyOn(card, method).mockImplementation(() => {});
  const commit = vi.spyOn(card, '_commit');
  const popup = new DevicePopup(stage, { onAction: (domain, service, data) => card._hass.callService(domain, service, data) });
  card._devicePopup = popup; popup.update(h);
  const open = () => popup.showRoom(room, [{ entityId: entity, areaId: 'room' }]); open();
  const field = () => popup.el?.querySelector('[data-device-control="volume"]');
  const baseline = { states: JSON.stringify(h.states), layout: JSON.stringify(card._layout), history: card._history.size };
  cleanup.push(() => { card._devicePopup = null; popup.dispose(); stage.remove(); card.remove();
    card._ambientController.dispose(); card._scenePreviewController.dispose(); });
  return { card, h, popup, field, open, commit, baseline };
}
afterEach(() => { for (const finish of cleanup.splice(0)) finish(); vi.restoreAllMocks(); });
function unchanged(f) {
  expect(JSON.stringify(f.card._hass.states)).toBe(f.baseline.states);
  expect(JSON.stringify(f.card._layout)).toBe(f.baseline.layout);
  expect(f.card._history.size).toBe(f.baseline.history);
  expect(f.commit).not.toHaveBeenCalled(); expect(f.h.callWS).not.toHaveBeenCalled();
}
function pulse(f, reason) {
  const old = f.card._hass;
  if (reason === 'source') f.card.hass = { ...old, states: { ...old.states, [entity]: { ...old.states[entity], state: 'unavailable' } } };
  if (reason === 'permission') f.card.hass = { ...old, user: { ...old.user, permissions: { fixture_control: false } } };
  if (reason === 'service') f.card.hass = { ...old, services: { ...old.services, media_player: {} } };
  if (reason === 'account') f.card.hass = { ...old, user: { ...old.user, id: 'different-user' } };
  if (reason === 'connection') { old.connection.connected = false; f.card.hass = { ...old }; old.connection.connected = true; }
  f.card.hass = { ...old };
}
async function tab(f, node) {
  const next = f.popup.el?.querySelector('[data-action="close"]');
  key(node, 'keydown', 'Tab');
  // Chrome emits the dirty scalar's change before focusout, then keyup belongs
  // to the next focused control. Dispatching blur before change would hide the bug.
  change(node); next?.focus(); if (next) key(next, 'keyup', 'Tab'); await settle();
}

describe('actual Root preserves inline scalar ownership during native navigation and dismissal', () => {
  it.each(modes)('%s clean Tab commits exactly one current command and permits the next fresh focus', async (mode) => {
    const f = fixture(mode), node = f.field(); expect(node.type).toBe('number');
    type(node, '31'); expect(f.h.callService).not.toHaveBeenCalled(); await tab(f, node);
    expect(f.h.callService).toHaveBeenCalledExactlyOnceWith('media_player', 'volume_set', { entity_id: entity, volume_level: .31 });
    expect(f.field()).toBe(node); unchanged(f);
    type(node, '41'); await tab(f, node);
    expect(f.h.callService).toHaveBeenCalledTimes(2);
    expect(f.h.callService).toHaveBeenLastCalledWith('media_player', 'volume_set', { entity_id: entity, volume_level: .41 }); unchanged(f);
  });
  it.each(modes.flatMap((mode) => ['source', 'permission', 'service', 'connection', 'account'].map((reason) => [mode, reason])))(
    '%s Tab cannot revive an unfinished scalar after %s loss/recovery, while a fresh current edit works', async (mode, reason) => {
      const f = fixture(mode), node = f.field(); type(node, '27'); pulse(f, reason);
      const retained = reason !== 'account' && (mode === 'original' || ['source', 'permission'].includes(reason));
      if (retained) { expect(f.field()).toBe(node); expect(node.isConnected).toBe(true); expect(f.card.shadowRoot.activeElement).toBe(node); }
      else expect(node.isConnected).toBe(false);
      expect(f.h.callService).not.toHaveBeenCalled(); await tab(f, node);
      expect(f.h.callService).not.toHaveBeenCalled(); unchanged(f);
      if (!f.popup.isOpen) f.open(); const current = f.field(); expect(current?.isConnected).toBe(true);
      if (retained) expect(current).toBe(node);
      type(current, '41'); await tab(f, current);
      expect(f.h.callService).toHaveBeenCalledExactlyOnceWith('media_player', 'volume_set', { entity_id: entity, volume_level: .41 }); unchanged(f);
    });
  it.each(modes)('%s current left-pointer Close discards the unfinished scalar before its blur change', async (mode) => {
    const f = fixture(mode), node = f.field(); type(node, '31');
    const next = { ...f.card._hass, states: { ...f.card._hass.states, [entity]: { ...f.card._hass.states[entity],
      attributes: { ...f.card._hass.states[entity].attributes, volume_level: .2 } } } };
    f.card.hass = next; if (mode === 'original') f.popup.update(next);
    f.baseline.states = JSON.stringify(next.states);
    expect(f.field()).toBe(node); expect(node.value).toBe('31'); expect(f.card.shadowRoot.activeElement).toBe(node);
    const close = f.popup.el.querySelector('[data-action="close"]'); pointer(close, 'pointerdown');
    change(node); close.focus(); pointer(close, 'pointerup'); close.click(); await settle();
    expect(f.h.callService).not.toHaveBeenCalled(); expect(f.popup.isOpen).toBe(false); unchanged(f);
    f.open(); const fresh = f.field(); expect(fresh).not.toBe(node); expect(fresh.value).toBe('20');
    type(fresh, '37'); await tab(f, fresh);
    expect(f.h.callService).toHaveBeenCalledExactlyOnceWith('media_player', 'volume_set', { entity_id: entity, volume_level: .37 }); unchanged(f);
  });
});
