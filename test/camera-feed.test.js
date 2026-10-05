// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraFeedController } from '../src/camera-feed.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const camera = (value = 'idle', name = 'Front door') => ({ state: value, attributes: { friendly_name: name } });
const makeHass = () => ({
  connected: true, connection: { connected: true },
  states: { 'camera.front': camera(), 'camera.garden': camera('idle', 'Garden') },
  callWS: vi.fn().mockResolvedValue({ frontend_stream_types: ['hls', 'web_rtc'] }),
  callService: vi.fn(),
});

// A real custom element models native connected/disconnected cleanup. The tests
// assert DOM removal causes cleanup rather than accepting a CSS-hidden player.
class TestCameraCard extends HTMLElement {
  constructor() { super(); this.starts = 0; this.stops = 0; this.hassUpdates = []; }
  connectedCallback() { this.starts++; }
  disconnectedCallback() { this.stops++; }
  set hass(value) { this.hassUpdates.push(value); this._hass = value; }
  get hass() { return this._hass; }
}
customElements.define('test-t3d-camera-card', TestCameraCard);

describe('CameraFeedController', () => {
  let container, controller, hass, helpers, loadHelpers, moreInfo, created;
  const action = (name) => controller.el.querySelector(`[data-action="${name}"]`);
  const statusText = () => controller.el.querySelector('.t3d-camera-status').textContent;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    hass = makeHass();
    created = [];
    helpers = { createCardElement: vi.fn(() => {
      const card = document.createElement('test-t3d-camera-card');
      created.push(card);
      return card;
    }) };
    loadHelpers = vi.fn().mockResolvedValue(helpers);
    window.loadCardHelpers = loadHelpers;
    moreInfo = vi.fn();
    controller = new CameraFeedController(container, { onMoreInfo: moreInfo });
  });
  afterEach(() => {
    controller.dispose();
    container.remove();
    delete window.loadCardHelpers;
    vi.restoreAllMocks();
  });

  it('uses the public native camera config, capability query and hass without controlling a device', async () => {
    expect(await controller.open('camera.front', hass)).toBe(true);
    expect(hass.callWS).toHaveBeenCalledExactlyOnceWith({ type: 'camera/capabilities', entity_id: 'camera.front' });
    expect(helpers.createCardElement).toHaveBeenCalledExactlyOnceWith({
      type: 'picture-entity', entity: 'camera.front', camera_view: 'live', show_name: false,
      show_state: false, fit_mode: 'contain', tap_action: { action: 'none' },
    });
    expect(controller.nativeCard.hass).toBe(hass);
    expect(controller.nativeCard.starts).toBe(1);
    expect(controller.status).toBe('ready');
    expect(statusText()).toBe('Camera stream · muted');
    expect(hass.callService).not.toHaveBeenCalled();
    expect(moreInfo).not.toHaveBeenCalled();
    expect(controller.el.dataset.taylors3dUi).toBe('camera-feed');
    expect(controller.el.getAttribute('aria-busy')).toBe('false');
    expect(document.activeElement).toBe(action('close-camera'));
  });

  it.each(['idle', 'streaming', 'recording'])('does not call a %s camera Live based on protocol or state', async (state) => {
    hass.states['camera.front'].state = state;
    await controller.open('camera.front', hass);
    expect(statusText()).toBe('Camera stream · muted');
    expect(statusText().toLowerCase()).not.toContain('live');
    expect(controller.el.querySelector('.t3d-camera-help').textContent).toContain('choose your integration’s live-view camera entity');
  });

  it('allows the native MJPEG fallback for an empty frontend stream list', async () => {
    hass.callWS.mockResolvedValue({ frontend_stream_types: [] });
    await controller.open('camera.front', hass);
    expect(controller.nativeCard.isConnected).toBe(true);
    expect(statusText()).toBe('Camera view / preview · muted');
    expect(hass.callWS.mock.calls.map(([request]) => request.type)).toEqual(['camera/capabilities']);
  });

  it('keeps the same native card and gives it each updated hass object', async () => {
    await controller.open('camera.front', hass);
    const native = controller.nativeCard;
    const next = { ...hass, states: { ...hass.states, 'camera.front': camera('recording', 'Doorbell recording') } };
    controller.update(next);
    controller.update({ ...next });
    expect(controller.nativeCard).toBe(native);
    expect(native.hassUpdates).toEqual([hass, next, controller.hass]);
    expect(helpers.createCardElement).toHaveBeenCalledTimes(1);
    expect(hass.callWS).toHaveBeenCalledTimes(1);
    expect(controller.el.querySelector('.t3d-camera-title').textContent).toBe('Doorbell recording');
    expect(statusText()).not.toContain('Live');
  });

  it.each([
    ['light.lamp', () => {}, 'Choose a camera entity.'],
    ['camera.missing', () => {}, 'Camera entity was not found.'],
    ['camera.front', (h) => { h.states['camera.front'].state = 'unavailable'; }, 'Camera is unavailable.'],
    ['camera.front', (h) => { h.states['camera.front'].state = 'unknown'; }, 'Camera state is unknown.'],
    ['camera.front', (h) => { h.states['camera.front'].state = 'off'; }, 'Camera is off.'],
    ['camera.front', (h) => { h.entities = { 'camera.front': { disabled_by: 'user' } }; }, 'Camera is disabled in Home Assistant.'],
    ['camera.front', (h) => { h.connected = false; }, 'Home Assistant is disconnected. Reconnect, then choose Retry.'],
    ['camera.front', (h) => { h.connection.connected = false; }, 'Home Assistant is disconnected. Reconnect, then choose Retry.'],
  ])('does not request or start playback when %s cannot be shown', async (id, change, message) => {
    change(hass);
    expect(await controller.open(id, hass)).toBe(false);
    expect(statusText()).toBe(message);
    expect(controller.nativeCard).toBeNull();
    expect(hass.callWS).not.toHaveBeenCalled();
    expect(loadHelpers).not.toHaveBeenCalled();
    expect(action('retry-camera').disabled).toBe(true);
  });

  it.each(['unauthorized', 'forbidden', 'not_allowed'])('blocks native playback on a %s capability response', async (code) => {
    hass.callWS.mockRejectedValue({ code, message: 'secret-token-in-raw-error' });
    expect(await controller.open('camera.front', hass)).toBe(false);
    expect(statusText()).toBe('Home Assistant did not allow access to this camera.');
    expect(controller.el.textContent).not.toContain('secret-token');
    expect(helpers.createCardElement).not.toHaveBeenCalled();
    expect(action('camera-more-info').disabled).toBe(false);
    expect(action('retry-camera').disabled).toBe(false);
  });

  it('falls back neutrally when an older HA has no camera capabilities command', async () => {
    hass.callWS.mockRejectedValue({ code: 'unknown_command' });
    expect(await controller.open('camera.front', hass)).toBe(true);
    expect(statusText()).toBe('Camera view / preview · muted');
    expect(controller.nativeCard.starts).toBe(1);
  });

  it('allows native camera rendering when a mock has no capability API', async () => {
    delete hass.callWS;
    expect(await controller.open('camera.front', hass)).toBe(true);
    expect(statusText()).toBe('Camera view / preview · muted');
  });

  it('shows an honest capability failure and Retry starts a fresh request', async () => {
    hass.callWS.mockRejectedValueOnce({ code: 'network_error', message: '/api/camera?token=secret' });
    expect(await controller.open('camera.front', hass)).toBe(false);
    expect(statusText()).toContain('Could not open the camera view');
    expect(controller.el.textContent).not.toContain('secret');
    action('retry-camera').click();
    await flush();
    expect(controller.status).toBe('ready');
    expect(hass.callWS).toHaveBeenCalledTimes(2);
    expect(helpers.createCardElement).toHaveBeenCalledTimes(1);
    expect(action('retry-camera').hidden).toBe(true);
  });

  it('handles a missing Lovelace helper and leaves All controls available', async () => {
    delete window.loadCardHelpers;
    expect(await controller.open('camera.front', hass)).toBe(false);
    expect(statusText()).toContain('Home Assistant camera controls are not available here');
    expect(action('camera-more-info').disabled).toBe(false);
    window.loadCardHelpers = loadHelpers;
    expect(await controller.retry()).toBe(true);
  });

  it.each(['throw', 'null', 'error-card'])('handles %s native card creation without leaving a stream attached', async (failure) => {
    helpers.createCardElement.mockImplementation(() => {
      if (failure === 'throw') throw new Error('private internal details');
      return failure === 'null' ? null : document.createElement('hui-error-card');
    });
    expect(await controller.open('camera.front', hass)).toBe(false);
    expect(controller.nativeCard).toBeNull();
    expect(controller.el.querySelector('.t3d-camera-viewport').childElementCount).toBe(0);
    expect(statusText()).toContain('Could not open the camera view');
    expect(controller.el.textContent).not.toContain('private internal details');
  });

  it('a late helper cannot replace a newer camera selection', async () => {
    const old = deferred();
    loadHelpers.mockReturnValueOnce(old.promise);
    const first = controller.open('camera.front', hass);
    expect(await controller.open('camera.garden', hass)).toBe(true);
    const native = controller.nativeCard;
    old.resolve(helpers);
    expect(await first).toBe(false);
    expect(controller.nativeCard).toBe(native);
    expect(controller.entityId).toBe('camera.garden');
    expect(helpers.createCardElement).toHaveBeenCalledTimes(1);
  });

  it('late capability success or failure cannot alter a newer selection', async () => {
    for (const fail of [false, true]) {
      const old = deferred();
      hass.callWS.mockReturnValueOnce(old.promise);
      const first = controller.open('camera.front', hass);
      await controller.open('camera.garden', hass);
      const native = controller.nativeCard;
      if (fail) old.reject({ code: 'unauthorized' });
      else old.resolve({ frontend_stream_types: [] });
      expect(await first).toBe(false);
      expect(controller.entityId).toBe('camera.garden');
      expect(controller.nativeCard).toBe(native);
      expect(controller.status).toBe('ready');
    }
  });

  it('late asynchronous card creation is discarded instead of connecting', async () => {
    const old = deferred();
    helpers.createCardElement.mockReturnValueOnce(old.promise);
    const first = controller.open('camera.front', hass);
    await flush();
    await controller.open('camera.garden', hass);
    const staleCard = document.createElement('test-t3d-camera-card');
    old.resolve(staleCard);
    expect(await first).toBe(false);
    expect(staleCard.starts).toBe(0);
    expect(staleCard.isConnected).toBe(false);
    expect(controller.nativeCard).toBe(created[0]);
    expect(controller.entityId).toBe('camera.garden');
  });

  it.each(['close', 'dispose'])('invalidates pending helper and capabilities work on %s', async (method) => {
    const helper = deferred(), capability = deferred();
    loadHelpers.mockReturnValue(helper.promise);
    hass.callWS.mockReturnValue(capability.promise);
    const opening = controller.open('camera.front', hass);
    controller[method]();
    helper.resolve(helpers);
    capability.resolve({ frontend_stream_types: ['hls'] });
    expect(await opening).toBe(false);
    expect(helpers.createCardElement).not.toHaveBeenCalled();
    expect(controller.isOpen).toBe(false);
    expect(container.childElementCount).toBe(0);
  });

  it('does not revive pending playback after the camera became unavailable', async () => {
    const helper = deferred();
    loadHelpers.mockReturnValueOnce(helper.promise);
    const opening = controller.open('camera.front', hass);
    const unavailable = { ...hass, states: { ...hass.states, 'camera.front': camera('unavailable') } };
    controller.update(unavailable);
    helper.resolve(helpers);
    expect(await opening).toBe(false);
    expect(controller.status).toBe('unavailable');
    expect(controller.nativeCard).toBeNull();
    expect(helpers.createCardElement).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'missing', 'disconnected'])('removes active playback on %s, then requires an explicit retry', async (reason) => {
    await controller.open('camera.front', hass);
    const native = controller.nativeCard;
    const next = { ...hass, states: { ...hass.states } };
    if (reason === 'unavailable') next.states['camera.front'] = camera('unavailable');
    else if (reason === 'missing') delete next.states['camera.front'];
    else next.connected = false;
    controller.update(next);
    expect(native.isConnected).toBe(false);
    expect(native.stops).toBe(1);
    expect(controller.nativeCard).toBeNull();
    expect(action('retry-camera').disabled).toBe(true);
    controller.update(hass);
    expect(controller.nativeCard).toBeNull();
    expect(helpers.createCardElement).toHaveBeenCalledTimes(1);
    expect(action('retry-camera').disabled).toBe(false);
    action('retry-camera').click();
    await flush();
    expect(controller.status).toBe('ready');
    expect(controller.nativeCard).not.toBe(native);
  });

  it('uses the newest hass while helper loading and restarts for a changed connection', async () => {
    const pending = deferred();
    loadHelpers.mockReturnValueOnce(pending.promise);
    const opening = controller.open('camera.front', hass);
    const latest = { ...hass, states: { ...hass.states, 'camera.front': camera('idle', 'Latest name') } };
    controller.update(latest);
    pending.resolve(helpers);
    expect(await opening).toBe(true);
    expect(controller.nativeCard.hass).toBe(latest);
    const old = controller.nativeCard;
    const reconnect = { ...latest, connection: { connected: true } };
    controller.update(reconnect);
    expect(old.isConnected).toBe(false);
    await flush();
    expect(controller.nativeCard.hass).toBe(reconnect);
    expect(hass.callWS).toHaveBeenCalledTimes(2);
  });

  it('switching and closing disconnect actual native cards once and do not hide them for reuse', async () => {
    await controller.open('camera.front', hass);
    const first = controller.nativeCard;
    const switching = controller.open('camera.garden', hass);
    expect(first.isConnected).toBe(false);
    expect(first.stops).toBe(1);
    await switching;
    const second = controller.nativeCard;
    controller.close();
    controller.close();
    expect(second.stops).toBe(1);
    expect(container.childElementCount).toBe(0);
    expect(controller.nativeCard).toBeNull();
    expect(controller.entityId).toBeNull();
    expect(controller.status).toBe('closed');
  });

  it('removing the section also releases the card even if its parent container remains', async () => {
    await controller.open('camera.front', hass);
    const native = controller.nativeCard;
    controller.el.remove();
    await flush();
    expect(container.isConnected).toBe(true);
    expect(controller.isOpen).toBe(false);
    expect(controller.nativeCard).toBeNull();
    expect(native.stops).toBe(1);
  });

  it('removing a shadow host invalidates loading and releases an active feed', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).append(container);
    await controller.open('camera.front', hass);
    const native = controller.nativeCard;
    host.remove();
    await flush();
    expect(controller.isOpen).toBe(false);
    expect(native.stops).toBe(1);
    document.body.append(host);
    const helper = deferred();
    loadHelpers.mockReturnValueOnce(helper.promise);
    const opening = controller.open('camera.front', hass);
    host.remove();
    await flush();
    helper.resolve(helpers);
    expect(await opening).toBe(false);
    expect(controller.isOpen).toBe(false);
  });

  it('a detached container cannot start playback', async () => {
    container.remove();
    expect(await controller.open('camera.front', hass)).toBe(false);
    expect(controller.nativeCard).toBeNull();
    expect(hass.callWS).not.toHaveBeenCalled();
    expect(loadHelpers).not.toHaveBeenCalled();
  });

  it('All controls releases playback before invoking HA with the exact entity', async () => {
    await controller.open('camera.front', hass);
    const native = controller.nativeCard;
    moreInfo.mockImplementation((id) => {
      expect(id).toBe('camera.front');
      expect(native.isConnected).toBe(false);
      expect(native.stops).toBe(1);
      expect(controller.isOpen).toBe(false);
    });
    action('camera-more-info').click();
    await flush();
    expect(moreInfo).toHaveBeenCalledExactlyOnceWith('camera.front');
    expect(hass.callService).not.toHaveBeenCalled();
  });

  it('handles an All controls failure without restarting playback', async () => {
    moreInfo.mockRejectedValue(new Error('raw failure details'));
    await controller.open('camera.front', hass);
    action('camera-more-info').click();
    await flush();
    expect(statusText()).toBe('Could not open All controls. Please try again.');
    expect(controller.nativeCard).toBeNull();
    expect(helpers.createCardElement).toHaveBeenCalledTimes(1);
    expect(controller.el.textContent).not.toContain('raw failure details');
  });

  it('stops camera gestures reaching the plan but lets parent Escape close the panel', async () => {
    await controller.open('camera.front', hass);
    const planGesture = vi.fn(), parentEscape = vi.fn(), capture = vi.fn();
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'click', 'wheel', 'touchstart']) {
      container.addEventListener(name, planGesture);
      controller.nativeCard.dispatchEvent(new Event(name, { bubbles: true, composed: true }));
    }
    container.addEventListener('pointerdown', (event) => {
      if (!event.composedPath().some((node) => node.dataset?.taylors3dUi)) capture();
    }, true);
    controller.nativeCard.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    container.addEventListener('keydown', parentEscape);
    action('close-camera').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(planGesture).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(parentEscape).toHaveBeenCalledTimes(1);
    expect(parentEscape.mock.calls[0][0].key).toBe('Escape');
  });

  it.each(['close-camera', 'camera-more-info'])('the %s click stays isolated even while it removes its own section', async (name) => {
    await controller.open('camera.front', hass);
    const planClick = vi.fn();
    container.addEventListener('click', planClick);
    action(name).click();
    await flush();
    expect(controller.isOpen).toBe(false);
    expect(planClick).not.toHaveBeenCalled();
  });

  it('renders entity names as text, disables absent All controls and cannot reopen after disposal', async () => {
    controller.dispose();
    controller = new CameraFeedController(container);
    hass.states['camera.front'].attributes.friendly_name = '<img src=x onerror=alert(1)>';
    await controller.open('camera.front', hass);
    expect(controller.el.querySelector('.t3d-camera-title').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(controller.el.querySelector('img')).toBeNull();
    expect(action('camera-more-info').disabled).toBe(true);
    controller.dispose();
    controller.dispose();
    expect(await controller.open('camera.front', hass)).toBe(false);
    expect(controller.isOpen).toBe(false);
    expect(container.childElementCount).toBe(0);
  });
});
