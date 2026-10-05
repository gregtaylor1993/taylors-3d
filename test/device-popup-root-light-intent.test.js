// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevicePopup } from '../src/device-popup.js';
import '../src/taylors3d-card.js';

const entity = 'light.current', cleanup = [];
const settle = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
const values = { brightness: '37', color: '#102030', kelvin: '4500' };
const data = { brightness: { brightness: 94 }, color: { rgb_color: [16, 32, 48] }, kelvin: { color_temp_kelvin: 4500 } };
const input = (node, kind) => { node.value = values[kind]; node.dispatchEvent(new Event('input', { bubbles: true })); };
const change = (node) => node.dispatchEvent(new Event('change', { bubbles: true }));

function fixture() {
  const card = document.createElement('taylors3d-card');
  // Connect before configuration so the real lifecycle waits for rendering.
  // The popup then lives in this actual card's shadow root.
  document.body.append(card);
  const connection = Object.assign(new EventTarget(), { connected: true });
  const h = { language: 'en', locale: { language: 'en' }, connection, auth: {}, callService: vi.fn(),
    user: { id: 'viewer', is_active: true, is_admin: false, permissions: { control: 'all' } },
    services: { light: { toggle: {}, turn_on: {}, turn_off: {} } }, entities: {}, devices: {},
    states: { [entity]: { entity_id: entity, state: 'on', attributes: { friendly_name: 'User_Lamp_été',
      supported_color_modes: ['rgb', 'color_temp'], color_mode: 'rgb', brightness: 128, rgb_color: [12, 34, 56],
      color_temp_kelvin: 3200, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6400 } } } };
  // Exercise the real Standard-card setter, while holding its scheduled paint.
  // A connected real popup keeps ordinary DOM event/focus behavior; rendering
  // and unrelated graphics/subsystems are outside this bounded regression.
  const stage = document.createElement('div'); card.shadowRoot.append(stage);
  const onAction = vi.fn().mockResolvedValue(undefined), popup = new DevicePopup(stage, { onAction });
  card._config = { layout_style: 'standard' }; card._hass = h; card._layout = {}; card._loading = true;
  for (const method of ['_schedule', '_observeSecuritySession', '_observeAlertMapContext', '_syncSecurity',
    '_syncFurniture', '_syncHouseShell', '_syncScenePreviews', '_syncAmbient']) vi.spyOn(card, method).mockImplementation(() => {});
  card._devicePopup = popup; popup.update(h); popup.showMarker({ entityId: entity, name: 'User_Device_été' });
  const update = vi.spyOn(popup, 'update');
  cleanup.push(() => { card._devicePopup = null; popup.dispose(); stage.remove(); card.remove(); card._ambientController.dispose(); card._scenePreviewController.dispose(); });
  return { card, h, popup, onAction, update,
    field: (kind) => popup.el.querySelector(`input[data-light-control="${kind}"]`),
    observe: () => { card.hass = h; }, repaint: () => popup.update(h) };
}
afterEach(() => { for (const finish of cleanup.splice(0)) finish(); vi.restoreAllMocks(); });
const losses = {
  service: (f) => { delete f.h.services.light.turn_on; return () => { f.h.services.light.turn_on = {}; }; },
  connection: (f) => { f.h.connection.connected = false; return () => { f.h.connection.connected = true; }; },
  source: (f) => { f.h.states[entity].state = 'unavailable'; return () => { f.h.states[entity].state = 'on'; }; },
  active: (f) => { f.h.user.is_active = false; return () => { f.h.user.is_active = true; }; },
  permissions: (f) => { f.h.user.permissions.control = 'none'; return () => { f.h.user.permissions.control = 'all'; }; },
  binding: (f) => { f.h.entities[entity] = { device_id: 'different-device' }; return () => { f.h.entities[entity] = {}; }; },
  identity: (f) => { f.h.states[entity].entity_id = 'light.other'; return () => { f.h.states[entity].entity_id = entity; }; },
};

describe('actual Standard Root observes unfinished light command ownership before its next paint', () => {
  it.each(Object.keys(values).flatMap((kind) => Object.keys(losses).map((reason) => [kind, reason])))(
    'rejects an old %s release after same-frame %s loss/recovery and accepts one fresh input', async (kind, reason) => {
    const f = fixture(), node = f.field(kind), original = JSON.stringify(f.h.states);
    expect(f.card._houseLayoutEnabled()).toBe(false); node.focus(); input(node, kind);
    const restore = losses[reason](f); f.observe(); restore(); f.observe();
    expect(f.update).not.toHaveBeenCalled(); expect(f.field(kind)).toBe(node); expect(node.isConnected).toBe(true);
    change(node); expect(f.onAction).not.toHaveBeenCalled();
    const current = f.field(kind); input(current, kind); change(current); await settle();
    expect(f.onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: entity, ...data[kind] });
    expect(JSON.stringify(f.h.states)).toBe(original);
  });
  it.each(Object.keys(values))('keeps the exact focused %s draft through locale and actual reading changes', async (kind) => {
    const f = fixture(), node = f.field(kind); node.focus(); input(node, kind);
    for (const language of ['de', 'fr', 'es', 'en']) {
      f.h.language = language; f.h.locale.language = language;
      f.h.states[entity] = { ...f.h.states[entity], attributes: { ...f.h.states[entity].attributes,
        brightness: 64, rgb_color: [100, 110, 120], color_temp_kelvin: 3300 } };
      f.observe(); f.repaint();
      expect(f.field(kind)).toBe(node); expect(f.card.shadowRoot.activeElement).toBe(node); expect(node.value).toBe(values[kind]);
      expect(f.onAction).not.toHaveBeenCalled(); expect(f.popup.el.textContent).toContain('User_Lamp_été');
    }
    change(node); await settle(); expect(f.onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: entity, ...data[kind] });
    expect(f.h.states[entity].attributes.rgb_color).toEqual([100, 110, 120]);
  });
  it.each(Object.keys(values))('rejects a held native-key %s draft across service loss without reviving on release', async (kind) => {
    const f = fixture(), node = f.field(kind); node.focus();
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); input(node, kind);
    const restore = losses.service(f); f.observe(); restore(); f.observe();
    // A final input produced by the interrupted held key is still the old gesture.
    input(node, kind); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })); change(node);
    expect(f.onAction).not.toHaveBeenCalled();
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); input(node, kind);
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })); change(node); await settle();
    expect(f.onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: entity, ...data[kind] });
  });
  it('keeps a legitimate native colour-dialog intent when opening the dialog blurs its field', async () => {
    const f = fixture(), node = f.field('color'); node.focus();
    const press = new Event('pointerdown', { bubbles: true }); Object.assign(press, { button: 0, isPrimary: true, pointerId: 1 }); node.dispatchEvent(press);
    input(node, 'color'); node.blur(); node.value = values.color; change(node); await settle();
    expect(f.onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: entity, ...data.color });
  });
  it('suppresses an old command error after observed service loss and preserves a newer pending owner', async () => {
    const f = fixture(); let rejectOld, finishNew;
    f.onAction.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockReturnValueOnce(new Promise((resolve) => { finishNew = resolve; }));
    input(f.field('color'), 'color'); change(f.field('color')); expect(f.onAction).toHaveBeenCalledTimes(1);
    const restore = losses.service(f); f.observe(); restore(); f.observe(); f.repaint();
    input(f.field('color'), 'color'); change(f.field('color')); expect(f.onAction).toHaveBeenCalledTimes(2);
    rejectOld(new Error('Old_User_Error_été')); await settle();
    expect(f.popup.el.textContent).not.toContain('Old_User_Error_été'); expect(f.field('color').disabled).toBe(true);
    expect(f.popup._pending.has(entity)).toBe(true); finishNew(); await settle(); expect(f.field('color').disabled).toBe(false);
  });
  it('does not submit a current source that reports another light entity under the selected ID', () => {
    const f = fixture(); f.h.states[entity].entity_id = 'light.other'; f.observe();
    input(f.field('color'), 'color'); change(f.field('color')); expect(f.onAction).not.toHaveBeenCalled();
  });
  it.each(['toggle', 'color-swatch'].flatMap((action) => ['pointer', ' ', 'Enter'].map((gesture) => [action, gesture])))(
    'does not revive a held %s button after actual Root service loss/recovery (%s)', async (action, gesture) => {
      const f = fixture(), node = f.popup.el.querySelector(`[data-action="${action}"]`), service = action === 'toggle' ? 'toggle' : 'turn_on';
      const press = () => {
        if (gesture === 'pointer') { const event = new Event('pointerdown', { bubbles: true }); Object.assign(event, { button: 0, isPrimary: true, pointerId: 1 }); node.dispatchEvent(event); }
        else node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: gesture }));
      };
      const release = () => {
        if (gesture === 'pointer') { const event = new Event('pointerup', { bubbles: true }); Object.assign(event, { button: 0, isPrimary: true, pointerId: 1 }); node.dispatchEvent(event); }
        else node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: gesture }));
        node.click();
      };
      node.focus(); press(); delete f.h.services.light[service]; f.observe(); f.h.services.light[service] = {}; f.observe();
      expect(f.update).not.toHaveBeenCalled(); release(); expect(f.onAction).not.toHaveBeenCalled();
      press(); release(); await settle();
      expect(f.onAction).toHaveBeenCalledExactlyOnceWith('light', service, { entity_id: entity, ...(action === 'color-swatch' ? { rgb_color: [255, 59, 48] } : {}) });
      expect(f.h.states[entity].attributes.rgb_color).toEqual([12, 34, 56]);
    });
  it.each(Object.keys(values).flatMap((kind) => [['Tab', 'service', 'pointer'], ['Arrow+Tab', 'connection', 'keyboard']]
    .map(([navigation, loss, fresh]) => [kind, navigation, loss, fresh])))(
    'accepts a fresh %s adjustment after %s navigation, %s recovery and a new %s gesture', async (kind, navigation, loss, fresh) => {
      const f = fixture(), node = f.field(kind), next = f.popup.el.querySelector('[data-action="more-info"]'), original = JSON.stringify(f.h.states);
      node.focus();
      if (navigation === 'Arrow+Tab') node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      input(node, kind); node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      // jsdom has no native Tab default: move actual shadow-root focus, then
      // deliver keyup to its new owner, as the browser does during navigation.
      next.focus(); next.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
      expect(f.card.shadowRoot.activeElement).toBe(next);
      const restore = losses[loss](f); f.observe(); restore(); f.observe(); expect(f.update).not.toHaveBeenCalled();
      node.value = values[kind]; change(node); expect(f.onAction).not.toHaveBeenCalled();
      node.focus(); expect(f.field(kind)).toBe(node); expect(f.card.shadowRoot.activeElement).toBe(node);
      if (fresh === 'pointer') {
        const event = new Event('pointerdown', { bubbles: true }); Object.assign(event, { button: 0, isPrimary: true, pointerId: 2 }); node.dispatchEvent(event);
      } else node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      input(node, kind);
      if (fresh === 'pointer') {
        const event = new Event('pointerup', { bubbles: true }); Object.assign(event, { button: 0, isPrimary: true, pointerId: 2 }); node.dispatchEvent(event);
      } else node.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
      change(node); await settle();
      expect(f.onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: entity, ...data[kind] });
      expect(JSON.stringify(f.h.states)).toBe(original);
    });
  it.each([' ', 'Enter'])('preserves a valid native colour-dialog %s activation when its field blurs', async (key) => {
    const f = fixture(), node = f.field('color'); node.focus();
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); input(node, 'color'); node.blur();
    node.value = values.color; change(node); await settle();
    expect(f.onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: entity, ...data.color });
  });
});
