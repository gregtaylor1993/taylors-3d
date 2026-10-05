// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chainState } from '../src/objects/logic.js';
import { ObjectPopup } from '../src/objects/popup.js';
import '../src/taylors3d-card.js';

const cleanup = [], settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function fixture() {
  const entity = 'light.current', obj = { id: 'current-tag', type: 'light' }, binding = { entity };
  const connection = Object.assign(new EventTarget(), { connected: true });
  const h = { language: 'en', locale: { language: 'en' }, auth: {}, connection,
    user: { id: 'viewer', is_admin: false, is_active: true, permissions: { control: 'all' } }, callService: vi.fn(),
    services: { light: { toggle: {}, turn_on: {} } }, entities: {}, devices: {},
    states: { [entity]: { entity_id: entity, state: 'on', attributes: { brightness: 128, color_mode: 'rgb', supported_color_modes: ['rgb'], rgb_color: [255, 59, 48] } } } };
  const stage = document.createElement('div'); document.body.append(stage); const onAction = vi.fn();
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 });
  const popup = new ObjectPopup(stage, { onAction, project: () => [100, 100], resolve: () => ({ obj, states: h.states, chain: chainState(obj, binding, {}, h.states), hass: h }) });
  popup.open(obj, [0, 0, 0]); cleanup.push(() => { popup.close(); stage.remove(); });
  const control = () => popup.el.querySelector('[data-rgb="10,132,255"]');
  const observe = () => popup.observeContexts?.(h);
  return { popup, h, obj, binding, entity, onAction, control, observe };
}
const changes = {
  connection: (f) => { f.h.connection.connected = false; return () => { f.h.connection.connected = true; }; },
  account: (f) => { f.h.user.id = 'other'; return () => { f.h.user.id = 'viewer'; }; },
  active: (f) => { f.h.user.is_active = false; return () => { f.h.user.is_active = true; }; },
  role: (f) => { f.h.user.is_admin = true; return () => { f.h.user.is_admin = false; }; },
  permissions: (f) => { f.h.user.permissions.control = 'none'; return () => { f.h.user.permissions.control = 'all'; }; },
  auth: (f) => { const old = f.h.auth; f.h.auth = {}; return () => { f.h.auth = old; }; },
  service: (f) => { delete f.h.services.light.turn_on; return () => { f.h.services.light.turn_on = {}; }; },
  source: (f) => { f.h.states[f.entity].state = 'unavailable'; return () => { f.h.states[f.entity].state = 'on'; }; },
  binding: (f) => { f.binding.entity = null; return () => { f.binding.entity = f.entity; }; },
  callback: (f) => { const old = f.h.callService; f.h.callService = vi.fn(); return () => { f.h.callService = old; }; },
};
function press(button, type) {
  button.focus(); button.dispatchEvent(type === 'pointer' ? new MouseEvent('pointerdown', { bubbles: true, button: 0 }) : new KeyboardEvent('keydown', { bubbles: true, key: type }));
}
function release(button, type) {
  button.dispatchEvent(type === 'pointer' ? new MouseEvent('pointerup', { bubbles: true, button: 0 }) : new KeyboardEvent('keyup', { bubbles: true, key: type })); button.click();
}
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });

describe('legacy object control observed session ownership', () => {
  it.each(Object.keys(changes).flatMap((reason) => ['pointer', ' ', 'Enter'].map((input) => [reason, input])))('rejects held %s loss/recovery through a %s gesture before a coalesced refresh', (reason, input) => {
    const f = fixture(), button = f.control(); press(button, input);
    const restore = changes[reason](f); f.observe(); restore(); f.observe(); release(button, input);
    expect(f.onAction).not.toHaveBeenCalled(); press(button, input); release(button, input);
    expect(f.onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: f.entity, rgb_color: [10, 132, 255] });
  });
  it.each(Object.keys(changes))('cancels an unfinished brightness release after observed %s loss/recovery', (reason) => {
    const f = fixture(), slider = f.popup.el.querySelector('input'); slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    const restore = changes[reason](f); f.observe(); restore(); f.observe(); slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.onAction).not.toHaveBeenCalled(); slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: f.entity, brightness: 200 });
  });
  it('retains a current viewer gesture through locale and ordinary HA reading updates', () => {
    const f = fixture(), button = f.control(); press(button, ' ');
    f.h.language = 'de'; f.h.locale.language = 'de'; f.h.states[f.entity] = { ...f.h.states[f.entity], attributes: { ...f.h.states[f.entity].attributes, brightness: 100 } }; f.observe(); f.popup.update();
    expect(f.control()).toBe(button); release(button, ' '); expect(f.onAction).toHaveBeenCalledTimes(1);
  });
  it('poisons a held command on a websocket disconnect event even when the connected flag recovers first', () => {
    const f = fixture(), button = f.control(); press(button, 'Enter'); f.h.connection.dispatchEvent(new Event('disconnected'));
    f.h.connection.connected = true; f.observe(); release(button, 'Enter'); expect(f.onAction).not.toHaveBeenCalled();
  });
  it('allows a fresh pointer gesture after the old pointer was released outside the popup', () => {
    const f = fixture(), button = f.control(); press(button, 'pointer'); const restore = changes.connection(f); f.observe(); restore(); f.observe();
    window.dispatchEvent(new MouseEvent('pointerup', { button: 0 })); expect(f.onAction).not.toHaveBeenCalled(); press(button, 'pointer'); release(button, 'pointer');
    expect(f.onAction).toHaveBeenCalledTimes(1);
  });
  it('removes its exact disconnect subscription when closing the popup', () => {
    const f = fixture(), remove = vi.spyOn(f.h.connection, 'removeEventListener');
    f.popup.close(); expect(remove).toHaveBeenCalledExactlyOnceWith('disconnected', f.popup._onDisconnected);
    f.h.connection.dispatchEvent(new Event('disconnected')); expect(f.onAction).not.toHaveBeenCalled();
  });
  it.each(['account', 'connection', 'source', 'service', 'permissions'])('ignores late pending errors owned by an observed old %s context and retains fresh commands', async (reason) => {
    const f = fixture(); let reject; f.onAction.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })); f.control().click();
    const restore = changes[reason](f); f.observe(); restore(); f.observe(); f.popup.update(); reject(new Error('Old <img>session error')); await settle();
    expect(f.popup.el.textContent).not.toContain('Old <img>session error'); expect(f.popup.el.querySelector('img')).toBeNull(); expect(f.onAction).toHaveBeenCalledTimes(1);
    f.control().click(); expect(f.onAction).toHaveBeenCalledTimes(2);
  });
  it('keeps a fresh pending command when an old session result settles afterward', async () => {
    const f = fixture(); let rejectOld, finishNew;
    f.onAction.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; })).mockReturnValueOnce(new Promise((resolve) => { finishNew = resolve; }));
    f.control().click(); const restore = changes.connection(f); f.observe(); restore(); f.observe(); f.popup.update(); f.control().click();
    expect(f.onAction).toHaveBeenCalledTimes(2); rejectOld(new Error('Old operation failure')); await settle();
    expect(f.control().disabled).toBe(true); expect(f.popup._pending.has(f.entity)).toBe(true); expect(f.popup.el.textContent).toContain('Sending command…');
    expect(f.popup.el.textContent).not.toContain('Old operation failure'); finishNew(); await settle(); expect(f.control().disabled).toBe(false);
  });
  it.each(['connection', 'source', 'role'])('uses the actual Root synchronous setter bridge to reject recovered old %s gestures', (reason) => {
    const f = fixture(), card = document.createElement('taylors3d-card'); card._hass = f.h; card._layout = {}; card._loading = true;
    for (const method of ['_schedule', '_observeSecuritySession', '_observeAlertMapContext', '_syncSecurity', '_syncFurniture', '_syncHouseShell', '_syncScenePreviews', '_syncAmbient']) vi.spyOn(card, method).mockImplementation(() => {});
    card._popup = f.popup; f.popup.resolve = () => ({ obj: f.obj, chain: chainState(f.obj, f.binding, {}, card._hass.states), states: card._hass.states, hass: card._hass });
    const button = f.control(); press(button, 'Enter'); const restore = changes[reason](f); card.hass = f.h; restore(); card.hass = f.h; release(button, 'Enter');
    expect(f.onAction).not.toHaveBeenCalled(); press(button, 'Enter'); release(button, 'Enter'); expect(f.onAction).toHaveBeenCalledTimes(1);
    card._popup = null; card._ambientController.dispose(); card._scenePreviewController.dispose(); vi.restoreAllMocks();
  });
});
