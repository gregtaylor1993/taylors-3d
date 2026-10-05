// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScenePreviewController } from '../src/scene-preview.js';
import '../src/taylors3d-card.js';

const fixtures = [];
const item = { id: 'user_scene', label: 'User_scene_été', scene_entity: 'scene.user_exact',
  lights: [{ entity: 'light.user_exact', state: 'on', brightness: 128, color: { mode: 'rgb', rgb: [0, 0, 255] } }] };
function fixture(actualRoot) {
  let resolve, reject;
  const request = new Promise((yes, no) => { resolve = yes; reject = no; });
  const connection = new EventTarget(); connection.connected = true;
  const hass = { connection, auth: {}, locale: { language: 'en' }, user: { id: 'user_current', is_admin: true, is_active: true },
    entities: {}, devices: {}, services: { scene: { turn_on: {} } },
    states: { 'scene.user_exact': { entity_id: 'scene.user_exact', state: 'unknown', attributes: {} },
      'light.user_exact': { entity_id: 'light.user_exact', state: 'off', attributes: { supported_color_modes: ['rgb'],
        color_mode: 'rgb', brightness: 64, rgb_color: [255, 0, 0] } } },
    callService: vi.fn().mockResolvedValue(undefined).mockReturnValueOnce(request) };
  const settings = { enabled: true, items: [structuredClone(item)] };
  let card, controller, observe, context;
  if (actualRoot) {
    card = document.createElement('taylors3d-card'); Object.defineProperty(card, 'isConnected', { value: true, configurable: true });
    card._config = { layout_key: 'user_layout', show_bubble_bar: true }; card._layout = { scene_previews: settings };
    card._hass = hass; card._view = { model: { root: { uuid: 'user_model' } } };
    // Keep the real Root setter and scene synchronization. These unrelated 3D,
    // weather, security and HA-subscription operations do not create a renderer.
    for (const method of ['_observeSecuritySession', '_observeAlertMapContext', '_syncSecurity', '_syncFurniture',
      '_syncHouseShell', '_syncAmbient', '_suspendAmbient', '_schedule', '_applySky', 'finishWallSelectionPreparation']) card[method] = vi.fn();
    card._presetEvents.setHass = vi.fn(); controller = card._scenePreviewController;
    observe = () => { card.hass = hass; };
  } else {
    context = { hass, bindings: settings, contextKey: 'user_context' };
    controller = new ScenePreviewController({ getContext: () => context }); observe = () => controller.revalidate();
  }
  const status = controller.onStatus; controller.onStatus = vi.fn((value) => status(value));
  const original = { auth: hass.auth, callService: hass.callService, state: hass.states[item.scene_entity] };
  const lose = (kind) => {
    if (kind === 'connection') connection.connected = false;
    if (kind === 'account') hass.user.id = 'user_other';
    if (kind === 'role') hass.user.is_admin = false;
    if (kind === 'availability') hass.states[item.scene_entity].state = 'unavailable';
    if (kind === 'source') delete hass.states[item.scene_entity];
    if (kind === 'context') { if (card) card._config.layout_key = 'user_other_layout'; else context.contextKey = 'user_other_context'; }
    if (kind === 'mapping') settings.items[0].scene_entity = 'scene.user_other';
    if (kind === 'active') hass.user.is_active = false;
    if (kind === 'permissions') hass.user.permissions = { entities: { ids: {} } };
    if (kind === 'auth') hass.auth = {};
    if (kind === 'callService') hass.callService = vi.fn();
    hass.locale.language = 'de'; observe();
  };
  const recover = (kind) => {
    if (kind === 'connection') connection.connected = true;
    if (kind === 'account') hass.user.id = 'user_current';
    if (kind === 'role') hass.user.is_admin = true;
    if (kind === 'availability') hass.states[item.scene_entity].state = 'unknown';
    if (kind === 'source') hass.states[item.scene_entity] = original.state;
    if (kind === 'context') { if (card) card._config.layout_key = 'user_layout'; else context.contextKey = 'user_context'; }
    if (kind === 'mapping') settings.items[0].scene_entity = item.scene_entity;
    if (kind === 'active') hass.user.is_active = true;
    if (kind === 'permissions') delete hass.user.permissions;
    if (kind === 'auth') hass.auth = original.auth;
    if (kind === 'callService') hass.callService = original.callService;
    hass.locale.language = 'fr'; observe();
  };
  fixtures.push({ controller, card }); return { hass, settings, controller, resolve, reject, lose, recover, observe };
}
afterEach(() => { fixtures.splice(0).forEach(({ controller, card }) => { controller.dispose(); card?._presetEvents.disconnect(); }); vi.restoreAllMocks(); });

for (const actualRoot of [false, true]) describe(`${actualRoot ? 'actual synchronous Root setter' : 'controller'} pending scene result ownership`, () => {
  for (const completion of ['success', 'error']) it.each(['connection', 'account', 'role', 'availability', 'source', 'context', 'mapping', 'active', 'permissions', 'auth', 'callService'])(
    `does not revive an already-sent pending ${completion} after observed %s loss and recovery without an active preview`, async (kind) => {
      const f = fixture(actualRoot), settings = structuredClone(f.settings), readings = structuredClone(f.hass.states);
      const pending = f.controller.activate(item.id); expect(f.controller.active).toBeNull();
      expect(f.hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: item.scene_entity });
      // Deliberately no await between the actual loss and recovered Root setter:
      // a later coalesced UI update must not erase observed ownership loss.
      f.lose(kind); f.recover(kind);
      if (completion === 'error') f.reject(new Error('User_old_request_error_été')); else f.resolve();
      const result = await pending; expect(result.current).toBe(false);
      expect(f.controller.onStatus.mock.calls.filter(([status]) => ['activated', 'error'].includes(status.status))).toEqual([]);
      expect(f.hass.callService).toHaveBeenCalledTimes(1); expect(f.settings).toEqual(settings); expect(f.hass.states).toEqual(readings);
      // Suppression does not undo a command already sent, or block a fresh action.
      expect(await f.controller.activate(item.id)).toMatchObject({ ok: true, current: true });
      expect(f.hass.callService.mock.calls).toEqual([
        ['scene', 'turn_on', { entity_id: item.scene_entity }], ['scene', 'turn_on', { entity_id: item.scene_entity }],
      ]);
    });

  it('keeps an already-sent current result eligible through language and unrelated reading changes', async () => {
    const f = fixture(actualRoot), pending = f.controller.activate(item.id);
    f.hass.locale.language = 'es'; f.hass.states['sensor.user_unrelated'] = { state: '9', attributes: {} }; f.observe();
    f.hass.locale.language = 'fr'; f.observe(); f.resolve(); expect(await pending).toMatchObject({ ok: true, current: true });
    expect(f.hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: item.scene_entity });
    expect(f.controller.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'activated', sceneEntity: item.scene_entity }));
  });
  it.each(['success', 'error'])('latches a disconnected EventTarget even when connected recovers before the pending %s and no setter runs', async (completion) => {
    const f = fixture(actualRoot), add = vi.spyOn(f.hass.connection, 'addEventListener'), remove = vi.spyOn(f.hass.connection, 'removeEventListener');
    const pending = f.controller.activate(item.id), listener = add.mock.calls.find(([type]) => type === 'disconnected')?.[1];
    expect(listener).toBeTypeOf('function'); expect(f.controller.active).toBeNull();
    f.hass.connection.connected = false; f.hass.connection.dispatchEvent(new Event('disconnected')); f.hass.connection.connected = true;
    if (completion === 'error') f.reject(new Error('User_disconnected_request')); else f.resolve();
    expect((await pending).current).toBe(false); expect(remove).toHaveBeenCalledWith('disconnected', listener);
    expect(f.hass.callService).toHaveBeenCalledTimes(1); expect(await f.controller.activate(item.id)).toMatchObject({ ok: true, current: true });
    expect(add.mock.calls.filter(([type]) => type === 'disconnected')).toHaveLength(2);
    expect(remove.mock.calls.filter(([type]) => type === 'disconnected')).toHaveLength(2);
  });
  it('removes its pending disconnected listener immediately on disposal and suppresses the late result', async () => {
    const f = fixture(actualRoot), add = vi.spyOn(f.hass.connection, 'addEventListener'), remove = vi.spyOn(f.hass.connection, 'removeEventListener');
    const pending = f.controller.activate(item.id), listener = add.mock.calls.find(([type]) => type === 'disconnected')?.[1];
    try { f.controller.dispose(); expect(remove).toHaveBeenCalledWith('disconnected', listener); }
    finally { f.resolve(); expect((await pending).current).toBe(false); }
    expect(f.hass.callService).toHaveBeenCalledTimes(1);
    expect(f.controller.onStatus.mock.calls.some(([value]) => value.status === 'activated')).toBe(false);
  });
});
