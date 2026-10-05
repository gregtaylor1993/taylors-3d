// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraFeedController } from '../src/camera-feed.js';
import { ScenePreviewBar } from '../src/scene-preview-bar.js';
import { ScenePreviewController } from '../src/scene-preview.js';
import captions, { sceneDiagnosticKeys } from '../src/translations/live-camera-scenes.js';

const cleanups = [];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const word = (language, key) => captions[language][`live.${key}`];
const template = (language, key, label) => word(language, key).replace('{label}', label);
const setLanguage = (hass, language) => { hass.locale = { ...(hass.locale || {}), language }; };

class LocalizedNativeCamera extends HTMLElement {
  constructor() { super(); this.starts = 0; this.stops = 0; }
  connectedCallback() { this.starts++; }
  disconnectedCallback() { this.stops++; }
}
customElements.define('test-localized-native-camera', LocalizedNativeCamera);

function cameraFixture(language = 'en', { state = 'idle', name = '<img> Caméra • A', capabilities, helpers } = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const hass = { locale: { language }, connection: { connected: true }, connected: true,
    states: { 'camera.front': { entity_id: 'camera.front', state, attributes: { friendly_name: name } } },
    callService: vi.fn(), callWS: vi.fn().mockImplementation(() => capabilities?.promise ?? Promise.resolve({ frontend_stream_types: ['hls'] })) };
  const create = vi.fn(() => document.createElement('test-localized-native-camera'));
  window.loadCardHelpers = vi.fn(() => helpers?.promise ?? Promise.resolve({ createCardElement: create }));
  const moreInfo = vi.fn(), controller = new CameraFeedController(host, { onMoreInfo: moreInfo });
  const action = (name) => controller.el.querySelector(`[data-action="${name}"]`);
  const status = () => controller.el.querySelector('.t3d-camera-status').textContent;
  cleanups.push(() => { controller.dispose(); host.remove(); delete window.loadCardHelpers; });
  return { controller, host, hass, create, moreInfo, action, status };
}

function sceneFixture(language = 'en', { label = '<img> Bedtime • A', lights, controller: overrideController } = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const settings = { enabled: true, items: [{ id: 'bedtime', label, scene_entity: 'scene.bedtime', lights: lights ?? [
    { entity: 'light.main', state: 'on', brightness: 200, color: { mode: 'rgb', rgb: [0, 0, 255] } },
  ] }] };
  const hass = { locale: { language }, connection: { connected: true }, user: { id: 'current-user', is_admin: true },
    services: { scene: { turn_on: {} } }, callService: vi.fn(async () => ({})), entities: {}, devices: {}, states: {
      'scene.bedtime': { entity_id: 'scene.bedtime', state: 'unknown', attributes: { friendly_name: 'Morning' } },
      'light.main': { entity_id: 'light.main', state: 'on', attributes: { color_mode: 'rgb', supported_color_modes: ['rgb'], brightness: 128, rgb_color: [255, 0, 0] } },
    } };
  const context = { hass, settings, contextKey: 'house:ground:3d', suspended: false }, preview = vi.fn();
  let bar;
  const controller = overrideController || new ScenePreviewController({
    getContext: () => ({ hass: context.hass, bindings: context.settings, contextKey: context.contextKey }), onPreview: preview,
    onStatus: (status) => { context.status = status; bar?.update(); },
  });
  bar = new ScenePreviewBar(host, { controller, getContext: () => context });
  const button = (action) => action === 'stop' ? bar.stopButton : host.querySelector(`[data-scene-action="${action}"]`);
  const pointer = (action, type) => button(action).dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerType: 'mouse', button: 0 }));
  const key = (action, type, value = 'Enter') => button(action).dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: value }));
  cleanups.push(() => { bar.dispose(); controller.dispose?.(); host.remove(); });
  return { host, hass, context, settings, preview, controller, bar, button, pointer, key, label };
}
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

describe('complete owned live-camera and saved-scene captions', () => {
  it('supplies identical keys and placeholders in all four languages without translating entity/state identifiers', () => {
    const keys = Object.keys(captions.en);
    expect(keys.length).toBeGreaterThan(80);
    for (const language of ['en', 'de', 'fr', 'es']) {
      expect(Object.keys(captions[language])).toEqual(keys);
      for (const key of keys) {
        expect(captions[language][key]).toBeTypeOf('string'); expect(captions[language][key].trim()).not.toBe('');
        expect(captions[language][key].match(/\{[a-z]+\}/g) || []).toEqual(captions.en[key].match(/\{[a-z]+\}/g) || []);
      }
      expect(word(language, 'scenes.diagnostic.sceneState')).toContain('unknown');
      expect(word(language, 'scenes.diagnostic.targetState')).toContain('on');
      expect(word(language, 'scenes.diagnostic.targetState')).toContain('off');
    }
    expect(new Set(sceneDiagnosticKeys.map(({ key }) => key)).size).toBe(sceneDiagnosticKeys.length);
  });
  it.each(['en', 'de', 'fr', 'es'])('shows %s camera captions with the same authenticated native card and literal camera name', async (language) => {
    const f = cameraFixture(language), original = structuredClone(f.hass.states);
    await f.controller.open('camera.front', f.hass);
    expect(f.action('close-camera').textContent).toBe(word(language, 'camera.close'));
    expect(f.action('retry-camera').textContent).toBe(word(language, 'camera.retry'));
    expect(f.action('camera-more-info').textContent).toBe(word(language, 'camera.controls'));
    expect(f.action('camera-more-info').getAttribute('aria-label')).toBe(word(language, 'camera.controlsAria'));
    expect(f.controller.el.getAttribute('aria-label')).toBe(word(language, 'camera.aria'));
    expect(f.controller.el.querySelector('.t3d-camera-help').textContent).toBe(word(language, 'camera.help'));
    expect(f.status()).toBe(word(language, 'camera.stream'));
    expect(f.controller.el.querySelector('.t3d-camera-title').textContent).toBe('<img> Caméra • A');
    expect(f.host.querySelector('img')).toBeNull(); expect(f.hass.states).toEqual(original);
    expect(f.hass.callService).not.toHaveBeenCalled(); expect(f.moreInfo).not.toHaveBeenCalled();
    expect(f.create).toHaveBeenCalledExactlyOnceWith({ type: 'picture-entity', entity: 'camera.front', camera_view: 'live', show_name: false,
      show_state: false, fit_mode: 'contain', tap_action: { action: 'none' } });
  });
  it.each(['de', 'fr', 'es'])('updates %s camera captions in place while preserving native playback and focused buttons', async (language) => {
    const f = cameraFixture(); await f.controller.open('camera.front', f.hass);
    const native = f.controller.nativeCard, section = f.controller.el, close = f.action('close-camera'), info = f.action('camera-more-info');
    info.focus(); setLanguage(f.hass, language); f.controller.update(f.hass);
    expect(f.controller.nativeCard).toBe(native); expect(f.controller.el).toBe(section);
    expect(f.action('close-camera')).toBe(close); expect(f.action('camera-more-info')).toBe(info);
    expect(document.activeElement).toBe(info); expect(native.starts).toBe(1); expect(native.stops).toBe(0);
    expect(info.textContent).toBe(word(language, 'camera.controls')); expect(f.status()).toBe(word(language, 'camera.stream'));
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.hass.callWS).toHaveBeenCalledTimes(1);
    expect(f.hass.callService).not.toHaveBeenCalled();
    f.action('close-camera').click(); expect(native.stops).toBe(1); expect(f.controller.isOpen).toBe(false);
  });
  it('keeps a pending camera request owned and renders its later result in the latest language', async () => {
    const capabilities = deferred(), f = cameraFixture('en', { capabilities });
    const opening = f.controller.open('camera.front', f.hass), section = f.controller.el, close = f.action('close-camera');
    close.focus(); setLanguage(f.hass, 'fr'); f.controller.update(f.hass);
    expect(f.controller.el).toBe(section); expect(f.action('close-camera')).toBe(close); expect(document.activeElement).toBe(close);
    expect(f.status()).toBe(word('fr', 'camera.opening')); expect(f.hass.callWS).toHaveBeenCalledTimes(1);
    capabilities.resolve({ frontend_stream_types: ['hls'] }); expect(await opening).toBe(true);
    expect(f.status()).toBe(word('fr', 'camera.stream')); expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('refreshes blocked/error camera reasons in place after a language change without retrying or leaking source errors', async () => {
    const f = cameraFixture('de', { state: 'unknown' });
    await f.controller.open('camera.front', f.hass); const section = f.controller.el, close = f.action('close-camera'); close.focus();
    expect(f.status()).toBe(word('de', 'camera.unknown')); setLanguage(f.hass, 'es'); f.controller.update(f.hass);
    expect(f.status()).toBe(word('es', 'camera.unknown')); expect(f.controller.el).toBe(section); expect(document.activeElement).toBe(close);
    expect(f.hass.callWS).not.toHaveBeenCalled();
    f.hass.states['camera.front'].state = 'idle'; f.controller.update(f.hass);
    expect(f.status()).toBe(word('es', 'camera.available')); expect(f.hass.callWS).not.toHaveBeenCalled();
    f.hass.callWS.mockRejectedValueOnce({ code: 'forbidden', message: 'raw-secret-error' });
    await f.controller.retry(); expect(f.status()).toBe(word('es', 'camera.denied'));
    const errorSection = f.controller.el; f.action('close-camera').focus(); setLanguage(f.hass, 'fr'); f.controller.update(f.hass);
    expect(f.controller.el).toBe(errorSection); expect(f.status()).toBe(word('fr', 'camera.denied'));
    expect(f.host.textContent).not.toContain('raw-secret-error'); expect(f.hass.callWS).toHaveBeenCalledTimes(1);
  });
  it('cannot revive a closed pending camera after locale changes', async () => {
    const capabilities = deferred(), f = cameraFixture('en', { capabilities });
    const opening = f.controller.open('camera.front', f.hass); setLanguage(f.hass, 'de'); f.controller.update(f.hass); f.controller.close();
    capabilities.resolve({ frontend_stream_types: ['hls'] }); expect(await opening).toBe(false);
    expect(f.controller.nativeCard).toBeNull(); expect(f.host.children).toHaveLength(0); expect(f.create).not.toHaveBeenCalled();
  });
  it.each(['en', 'de', 'fr', 'es'])('shows %s scene UI while preserving literal saved labels and source states', (language) => {
    const f = sceneFixture(language), settings = structuredClone(f.settings), states = structuredClone(f.hass.states);
    expect(f.bar.el.getAttribute('aria-label')).toBe(word(language, 'scenes.aria'));
    expect(f.bar.heading.textContent).toBe(word(language, 'scenes.title')); expect(f.bar.note.textContent).toBe(word(language, 'scenes.help'));
    expect(f.bar.stopButton.textContent).toBe(word(language, 'scenes.stop'));
    expect(f.button('preview').textContent).toBe(template(language, 'scenes.preview', f.label));
    expect(f.button('activate').textContent).toBe(word(language, 'scenes.activate'));
    expect(f.button('activate').getAttribute('aria-label')).toBe(template(language, 'scenes.activateAria', f.label));
    expect(f.host.querySelector('img')).toBeNull(); expect(f.settings).toEqual(settings); expect(f.hass.states).toEqual(states);
    expect(f.hass.states['scene.bedtime'].state).toBe('unknown'); expect(f.hass.callService).not.toHaveBeenCalled();
  });
});

describe('scene language is presentation while source/session guards remain authoritative', () => {
  it.each(['pointer', 'Enter', ' '])('retains a %s-held current scene action and exact focused button across locale changes', async (method) => {
    const f = sceneFixture(), activate = f.button('activate'); activate.focus();
    if (method === 'pointer') f.pointer('activate', 'pointerdown'); else f.key('activate', 'keydown', method);
    setLanguage(f.hass, 'de'); f.bar.update(); setLanguage(f.hass, 'fr'); f.bar.update();
    expect(f.button('activate')).toBe(activate); expect(document.activeElement).toBe(activate);
    expect(activate.textContent).toBe(word('fr', 'scenes.activate')); expect(f.hass.callService).not.toHaveBeenCalled();
    if (method === 'pointer') f.pointer('activate', 'pointerup'); else f.key('activate', 'keyup', method);
    activate.click(); await flush();
    expect(f.hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.bedtime' });
    expect(f.bar.status.textContent).toBe(template('fr', 'scenes.activated', f.label));
    expect(f.hass.states['scene.bedtime'].state).toBe('unknown');
  });
  it('keeps a pinned preview, exact native buttons and raw HA light readings through locale and unrelated readings', () => {
    const f = sceneFixture(), preview = f.button('preview'), stop = f.bar.stopButton, original = f.hass.states;
    preview.click(); const active = f.controller.active.token; stop.focus();
    setLanguage(f.hass, 'es'); f.hass.states['sensor.other'] = { state: '2', attributes: {} }; f.bar.update();
    expect(f.controller.active.token).toBe(active); expect(f.button('preview')).toBe(preview); expect(f.bar.stopButton).toBe(stop);
    expect(document.activeElement).toBe(stop); expect(f.bar.status.textContent).toBe(template('es', 'scenes.previewingPinned', f.label));
    expect(f.hass.states).toBe(original); expect(f.hass.states['light.main'].attributes.rgb_color).toEqual([255, 0, 0]);
    expect(f.hass.callService).not.toHaveBeenCalled(); stop.click(); expect(f.controller.active).toBeNull();
    expect(f.bar.status.textContent).toBe(word('es', 'scenes.choose'));
  });
  it('uses the current locale for pending and accepted scene action text without restarting the request', async () => {
    const pending = deferred(), f = sceneFixture(); f.hass.callService.mockReturnValue(pending.promise);
    const activate = f.button('activate'); activate.click(); expect(f.hass.callService).toHaveBeenCalledTimes(1);
    const preview = f.button('preview'); setLanguage(f.hass, 'de'); f.bar.update();
    expect(f.button('activate')).toBe(activate); expect(f.button('preview')).toBe(preview);
    expect(f.bar.status.textContent).toBe(template('de', 'scenes.activating', f.label)); expect(activate.disabled).toBe(true);
    pending.resolve(); await flush(); expect(f.bar.status.textContent).toBe(template('de', 'scenes.activated', f.label));
    setLanguage(f.hass, 'es'); f.bar.update(); expect(f.bar.status.textContent).toBe(template('es', 'scenes.activated', f.label));
    expect(f.hass.callService).toHaveBeenCalledTimes(1); expect(activate.disabled).toBe(false);
  });
  it('renders owned source and target diagnostics in the current language without changing semantic eligibility', () => {
    const f = sceneFixture('de', { lights: [] }), preview = f.button('preview'), activate = f.button('activate'); preview.focus();
    expect(preview.disabled).toBe(true); expect(activate.disabled).toBe(false);
    expect(preview.title).toBe(word('de', 'scenes.diagnostic.lights'));
    setLanguage(f.hass, 'fr'); f.bar.update(); expect(preview.title).toBe(word('fr', 'scenes.diagnostic.lights'));
    expect(f.button('preview')).toBe(preview); expect(preview.disabled).toBe(true); expect(activate.disabled).toBe(false);
    f.hass.states['scene.bedtime'].attributes.restored = true; f.bar.update();
    expect(activate.disabled).toBe(true); expect(activate.title).toBe(word('fr', 'scenes.diagnostic.unavailable'));
    expect(f.settings.items[0].scene_entity).toBe('scene.bedtime'); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it.each(['connection', 'source', 'account'])('locale updates cannot restore a poisoned held scene action after %s loss and recovery', async (kind) => {
    const f = sceneFixture(), activate = f.button('activate'); f.pointer('activate', 'pointerdown');
    const original = f.hass.states['scene.bedtime'];
    if (kind === 'connection') f.hass.connection.connected = false;
    if (kind === 'source') delete f.hass.states['scene.bedtime'];
    if (kind === 'account') f.hass.user.id = 'different-user';
    setLanguage(f.hass, 'de'); f.bar.update();
    if (kind === 'connection') f.hass.connection.connected = true;
    if (kind === 'source') f.hass.states['scene.bedtime'] = original;
    if (kind === 'account') f.hass.user.id = 'current-user';
    setLanguage(f.hass, 'fr'); f.bar.update(); f.pointer('activate', 'pointerup'); activate.click(); await flush();
    expect(f.hass.callService).not.toHaveBeenCalled(); expect(f.button('activate')).toBe(activate);
    f.pointer('activate', 'pointerdown'); f.pointer('activate', 'pointerup'); activate.click(); await flush();
    expect(f.hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.bedtime' });
  });
  it('keeps actual HA error text literal even when it exactly matches an owned English fallback', async () => {
    const f = sceneFixture('de'), external = 'The scene action failed.';
    f.hass.callService.mockRejectedValueOnce(new Error(external)); f.button('activate').click(); await flush();
    expect(f.bar.status.textContent).toBe(external); setLanguage(f.hass, 'fr'); f.bar.update(); expect(f.bar.status.textContent).toBe(external);
    expect(f.hass.callService).toHaveBeenCalledTimes(1); expect(f.hass.states['scene.bedtime'].state).toBe('unknown');
  });
  it('leaves unknown or changed diagnostic messages literal while re-rendering genuine owned diagnostics after locale changes', () => {
    const foreign = '<img> external diagnostic', result = { ok: false, diagnostics: [{ code: 'brightness', message: foreign }] };
    const controller = { preview: vi.fn(() => result), revalidate: vi.fn(), stop: vi.fn() }, f = sceneFixture('de', { controller });
    f.button('preview').click(); expect(f.bar.status.textContent).toBe(foreign); expect(f.host.querySelector('img')).toBeNull();
    setLanguage(f.hass, 'es'); f.bar.update(); expect(f.bar.status.textContent).toBe(foreign);
    const d = sceneDiagnosticKeys.find((entry) => entry.code === 'brightness'); result.diagnostics = [{ code: d.code, message: d.message }];
    f.button('preview').click(); expect(f.bar.status.textContent).toBe(captions.es[d.key]);
    setLanguage(f.hass, 'fr'); f.bar.update(); expect(f.bar.status.textContent).toBe(captions.fr[d.key]);
    result.diagnostics = [{ code: 'external-provider', message: d.message }]; f.button('preview').click();
    expect(f.bar.status.textContent).toBe(d.message); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('discards a late scene acknowledgement after a session change even when language has changed', async () => {
    const pending = deferred(), f = sceneFixture(); f.hass.callService.mockReturnValue(pending.promise);
    f.button('activate').click(); f.context.hass = { ...f.hass, user: { id: 'new-user', is_admin: true }, locale: { language: 'es' } }; f.bar.update();
    pending.resolve(); await flush(); expect(f.bar.status.textContent).toBe(word('es', 'scenes.choose'));
    expect(f.hass.callService).toHaveBeenCalledTimes(1); expect(f.controller.active).toBeNull();
  });
  it('falls back to readable English for an unsupported language without changing IDs or labels', async () => {
    const camera = cameraFixture('it-IT'); await camera.controller.open('camera.front', camera.hass);
    expect(camera.action('close-camera').textContent).toBe(word('en', 'camera.close'));
    const f = sceneFixture('it-IT'); expect(f.button('preview').textContent).toBe(template('en', 'scenes.preview', f.label));
    expect(f.button('preview').dataset.sceneId).toBe('bedtime'); expect(f.hass.callService).not.toHaveBeenCalled();
  });
});
