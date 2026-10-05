// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenePreviewController, validateScenePreview } from '../src/scene-preview.js';
import { ScenePreviewBar } from '../src/scene-preview-bar.js';

let createMockHass, demoScenePreviews;
beforeAll(async () => {
  // The fixture exercises mock HA evidence/actions, not browser canvas drawing.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, beginPath() {}, arc() {}, fill() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,demo');
  ({ createMockHass, demoScenePreviews } = await import('../demo/mock-hass.js'));
});
beforeEach(() => { vi.useFakeTimers(); window.__serviceCalls = []; window.__demoMowerPaused = true; });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); document.body.innerHTML = ''; delete window.__setDemoSun; });
afterAll(() => { vi.restoreAllMocks(); delete window.__serviceCalls; delete window.__demoMowerPaused; });
function fixture(scenes = true) {
  let current;
  const onChange = vi.fn((hass) => { current = hass; });
  current = createMockHass({ onChange, scenes });
  return { get hass() { return current; }, onChange };
}

describe('honest opt-in simulated HA scenes', () => {
  it('does not add scene sources, advertisements or layout settings to the normal demo', async () => {
    const f = fixture(false), before = JSON.stringify(f.hass.states);
    expect(Object.keys(f.hass.states).filter((id) => id.startsWith('scene.'))).toEqual([]);
    expect(f.hass.services.scene).toBeUndefined();
    expect((await f.hass.callWS({ type: 'taylors3d/layout/get' })).layout.scene_previews).toBeUndefined();
    expect(window.__serviceCalls).toEqual([]); expect(JSON.stringify(f.hass.states)).toBe(before); expect(f.onChange).not.toHaveBeenCalled();
  });
  it('keeps an authenticated user, established event connection and existing services stable through updates', async () => {
    const f = fixture(), { user, connection, services } = f.hass, disconnected = vi.fn();
    expect(user).toMatchObject({ id: 'taylors3d-demo-user', is_admin: true, is_active: true }); expect(connection.connected).toBe(true);
    connection.addEventListener('disconnected', disconnected);
    await f.hass.callService('switch', 'toggle', { entity_id: 'switch.demo_facade' });
    expect(f.hass.states['switch.demo_facade'].state).toBe('off');
    window.__setDemoSun(35, 160);
    expect(f.hass.user).toBe(user); expect(f.hass.connection).toBe(connection); expect(f.hass.services).toBe(services);
    for (const domain of ['light', 'switch', 'fan', 'input_boolean', 'homeassistant']) expect(services[domain]).toHaveProperty('toggle');
    expect(services.light).toHaveProperty('turn_on'); expect(services.light).toHaveProperty('turn_off');
    expect(services.lawn_mower).toHaveProperty('start_mowing'); expect(services.lawn_mower).toHaveProperty('dock');
    connection.dispatchEvent(new Event('disconnected')); expect(disconnected).toHaveBeenCalledOnce();
    connection.removeEventListener('disconnected', disconnected);
  });
  it('preserves the action function through unrelated pushes and uses current state on later calls', async () => {
    const f = fixture(), callService = f.hass.callService;
    window.__setDemoSun(35, 160); expect(f.hass.callService).toBe(callService);
    await callService('switch', 'toggle', { entity_id: 'switch.demo_facade' });
    expect(f.hass.callService).toBe(callService); expect(f.hass.states['switch.demo_facade'].state).toBe('off');
    await callService('switch', 'toggle', { entity_id: 'switch.demo_facade' });
    expect(f.hass.callService).toBe(callService); expect(f.hass.states['switch.demo_facade'].state).toBe('on');
    await callService('scene', 'turn_on', { entity_id: 'scene.bedtime' });
    expect(f.hass.callService).toBe(callService); expect(f.hass.states['light.demo_hall'].attributes.brightness).toBe(20);
  });
  it('keeps an actual bar press valid across an unrelated simulated HA update and sends its one intended scene action', async () => {
    const f = fixture(), settings = demoScenePreviews(), host = document.createElement('div'); document.body.append(host);
    let bar, status;
    const controller = new ScenePreviewController({ getContext: () => ({ hass: f.hass, bindings: settings, contextKey: 'demo' }),
      onStatus: (value) => { status = value; bar?.update(); } });
    bar = new ScenePreviewBar(host, { controller, getContext: () => ({ hass: f.hass, settings, contextKey: 'demo', suspended: false, status }) });
    const originalPush = f.onChange.getMockImplementation(); f.onChange.mockImplementation((hass) => { originalPush(hass); bar.update(); });
    try {
      const button = host.querySelector('[data-scene-action="activate"][data-scene-id="movie"]');
      button.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'mouse', button: 0 }));
      expect(window.__serviceCalls).toEqual([]); window.__setDemoSun(35, 160);
      expect(host.querySelector('[data-scene-action="activate"][data-scene-id="movie"]')).toBe(button);
      expect(button.disabled).toBe(false);
      button.dispatchEvent(Object.assign(new Event('pointerup', { bubbles: true }), { pointerType: 'mouse', button: 0 })); button.click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(window.__serviceCalls).toEqual([['scene', 'turn_on', { entity_id: 'scene.movie' }]]);
      expect(f.hass.states['scene.movie'].state).not.toBe('unknown'); expect(bar.status.textContent).toContain('Activated Movie (simulated)');
    } finally { bar.dispose(); controller.dispose(); host.remove(); }
  });
  it('offers two explicit independent current-capability mappings, labelled as simulated', () => {
    const f = fixture(), settings = demoScenePreviews(), another = demoScenePreviews();
    expect(settings.enabled).toBe(true); expect(settings.items.map((item) => item.scene_entity)).toEqual(['scene.movie', 'scene.bedtime']);
    for (const item of settings.items) {
      expect(item.label).toContain('(simulated)'); expect(f.hass.entities[item.scene_entity].entity_id).toBe(item.scene_entity);
      expect(f.hass.states[item.scene_entity].state).toBe('unknown'); expect(validateScenePreview(f.hass, item).diagnostics).toEqual([]);
    }
    settings.items[0].lights[0].color.rgb[0] = 1;
    expect(another.items[0].lights[0].color.rgb[0]).toBe(255); expect(window.__serviceCalls).toEqual([]);
  });
  it('real controller Preview and Stop change no simulated light reading, scene time or service', () => {
    const f = fixture(), before = JSON.stringify(f.hass.states), draws = vi.fn(), settings = demoScenePreviews();
    const controller = new ScenePreviewController({ getContext: () => ({ hass: f.hass, bindings: settings, contextKey: 'demo' }), onPreview: draws });
    const started = controller.preview('movie'); expect(started.ok).toBe(true); expect(draws.mock.calls[0][0]).toBeInstanceOf(Map);
    window.__setDemoSun(35, 160); // stable mock HA update must not masquerade as reconnect
    expect(controller.revalidate().token).toBe(started.token);
    const withoutSun = { ...f.hass.states }; delete withoutSun['sun.sun']; expect(JSON.stringify(withoutSun)).toBe(before);
    controller.stop(started.token); expect(draws.mock.calls.at(-1)[0]).toBeNull();
    expect(f.hass.states['scene.movie'].state).toBe('unknown'); expect(window.__serviceCalls).toEqual([]); controller.dispose();
  });
  it('one deliberate Activate timestamps only the selected scene and applies its exact fake lights in one report', async () => {
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    const f = fixture(), settings = demoScenePreviews(), binding = settings.items[0], before = f.hass.states;
    const controller = new ScenePreviewController({ getContext: () => ({ hass: f.hass, bindings: settings, contextKey: 'demo' }) });
    expect((await controller.activate('movie', { expectedSceneEntity: 'scene.movie' })).ok).toBe(true);
    expect(window.__serviceCalls).toEqual([['scene', 'turn_on', { entity_id: 'scene.movie' }]]); expect(f.onChange).toHaveBeenCalledOnce();
    expect(f.hass.states['scene.movie'].state).toBe('2026-10-05T12:00:00.000Z'); expect(f.hass.states['scene.bedtime']).toBe(before['scene.bedtime']);
    const changed = new Set([binding.scene_entity, ...binding.lights.map((target) => target.entity)]);
    for (const [entity, source] of Object.entries(before)) if (!changed.has(entity)) expect(f.hass.states[entity]).toBe(source);
    for (const target of binding.lights) {
      const actual = f.hass.states[target.entity]; expect(actual.state).toBe(target.state);
      if (target.state === 'on') { expect(actual.attributes.brightness).toBe(target.brightness); if (target.color) expect(actual.attributes.rgb_color).toEqual(target.color.rgb); }
      else expect(actual.attributes.brightness).toBeUndefined();
    }
    expect(before['light.demo_living'].attributes.brightness).toBe(200); controller.dispose();
  });
  it('Bedtime remains its own explicit mock scene; changing an exported preview does not rewrite its definition', async () => {
    const f = fixture(), modified = demoScenePreviews(); modified.items[1].lights[2].brightness = 255;
    await f.hass.callService('scene', 'turn_on', { entity_id: 'scene.bedtime' });
    expect(f.hass.states['light.floor_lamp'].attributes.brightness).toBe(35); expect(f.hass.states['light.demo_living'].state).toBe('off');
    expect(f.hass.states['light.demo_hall'].attributes.brightness).toBe(20); expect(f.hass.states['light.bedroom'].attributes.brightness).toBe(20);
    expect(f.hass.states['scene.movie'].state).toBe('unknown'); expect(window.__serviceCalls).toHaveLength(1);
  });
  it('unknown/non-turn_on/disabled scene actions cannot change any mock light', async () => {
    for (const [enabled, service, entity] of [[true, 'turn_on', 'scene.missing'], [true, 'toggle', 'scene.movie'], [false, 'turn_on', 'scene.movie']]) {
      const f = fixture(enabled), before = f.hass.states;
      await f.hass.callService('scene', service, { entity_id: entity }); expect(f.hass.states).toBe(before); expect(f.onChange).not.toHaveBeenCalled();
    }
  });
  it('ordinary light toggles cannot claim that either scene was activated', async () => {
    const f = fixture(); await f.hass.callService('light', 'toggle', { entity_id: 'light.demo_living' });
    expect(f.hass.states['light.demo_living'].state).toBe('off'); expect(f.hass.states['scene.movie'].state).toBe('unknown');
    expect(f.hass.states['scene.bedtime'].state).toBe('unknown'); expect(window.__serviceCalls).toHaveLength(1);
  });
  it('mower ticks do not activate scenes or replace the connection/user', () => {
    const f = fixture(), { connection, user } = f.hass; window.__demoMowerPaused = false;
    vi.advanceTimersByTime(1000);
    expect(f.onChange).toHaveBeenCalledTimes(2); expect(f.hass.connection).toBe(connection); expect(f.hass.user).toBe(user);
    expect(f.hass.states['scene.movie'].state).toBe('unknown'); expect(window.__serviceCalls).toEqual([]);
  });
});

describe('demo URL opt-in', () => {
  it.each(['', '?scenes=0', '?scenes=yes', '?scenes=1'])('enables simulated scene UI only for the exact option %s', async (query) => {
    vi.resetModules(); history.replaceState(null, '', `/demo/index.html${query}`);
    document.body.innerHTML = '<main><taylors3d-card></taylors3d-card></main><div id="log"></div>';
    const card = document.querySelector('taylors3d-card'); card.setConfig = vi.fn();
    await import('../demo/demo.js');
    const enabled = query === '?scenes=1', config = card.setConfig.mock.calls[0][0];
    expect(!!config.scene_previews).toBe(enabled); expect(!!document.querySelector('[data-scene-simulation]')).toBe(enabled);
    expect(!!card.hass.states['scene.movie']).toBe(enabled);
    if (enabled) { expect(config.scene_previews.enabled).toBe(true); expect(document.querySelector('[data-scene-simulation]').textContent).toContain('no real devices'); }
    expect(window.__serviceCalls).toEqual([]);
  });
});
