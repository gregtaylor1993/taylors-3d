import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_EVENT, PRESET_RESULT, PRESET_SUBSCRIBE, PresetEventController, presetTargetMatches, resolvePreset } from '../src/preset-events.js';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const views = [
  { id: 'all', label: 'All' },
  { id: 'door', label: 'Front door', camera_mode: '3d' },
  { id: 'garden', label: 'Garden', camera_mode: 'top' },
  { id: 'hidden', label: 'Hidden', hidden: true },
];
const request = (overrides = {}) => ({
  request_id: 'request-1', target_id: 'connection-1', layout_key: 'house', card_id: 'wall-tablet', preset: 'Front door', ...overrides,
});

function harness(options = {}) {
  const state = {
    target: { layout_key: 'house', card_id: 'wall-tablet', panel: 'hallway' },
    views,
    current: { id: 'all', mode: 'top', camera: { center: [2, 3], zoom: 4 } },
  };
  const unsubscribe = vi.fn(async () => {});
  let callback;
  const connection = {
    subscribeMessage: vi.fn(async (cb) => { callback = cb; return unsubscribe; }),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  };
  const hass = { connection, callWS: vi.fn(async () => ({})) };
  const onSelect = vi.fn(() => true), onError = vi.fn();
  const controller = new PresetEventController({
    getTarget: () => state.target, getViews: () => state.views, getCurrent: () => state.current,
    onSelect, onError, ...options,
  });
  const emit = async (data) => { callback({ event_type: PRESET_EVENT, data }); await flush(); };
  return { state, controller, connection, hass, unsubscribe, onSelect, onError, emit };
}

describe('preset addressing and resolution', () => {
  it('requires a matching layout and every supplied panel/card address', () => {
    const target = { layout_key: 'house', panel: 'hallway', card_id: 'wall-tablet' };
    expect(presetTargetMatches(request(), target)).toBe(true);
    expect(presetTargetMatches(request({ card_id: undefined, panel: 'hallway' }), target)).toBe(true);
    for (const bad of [
      { layout_key: 'other' }, { panel: 'kitchen' }, { card_id: 'phone' },
      { card_id: undefined, panel: undefined },
    ]) expect(presetTargetMatches(request(bad), target)).toBe(false);
  });

  it('resolves IDs before unique exact names and rejects hidden/ambiguous/missing views', () => {
    expect(resolvePreset(views, 'door').view).toBe(views[1]);
    expect(resolvePreset(views, 'Front door').view).toBe(views[1]);
    expect(resolvePreset(views, 'front door').status).toBe('invalid_preset');
    expect(resolvePreset(views, 'hidden').status).toBe('invalid_preset');
    expect(resolvePreset([...views, { id: 'duplicate', label: 'Front door' }], 'Front door').status).toBe('ambiguous_preset');
    expect(resolvePreset([...views, { id: 'duplicate', label: 'door' }], 'door').view).toBe(views[1]);
  });
});

describe('PresetEventController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('subscribes once on the HA connection and confirms a selected preset', async () => {
    const h = harness();
    h.controller.setHass(h.hass);
    h.controller.setHass({ ...h.hass });
    await flush();
    expect(h.connection.subscribeMessage).toHaveBeenCalledTimes(1);
    expect(h.connection.subscribeMessage).toHaveBeenCalledWith(expect.any(Function), { type: PRESET_SUBSCRIBE, ...h.state.target });
    await h.emit(request());
    expect(h.onSelect).toHaveBeenCalledWith(views[1], { mode: '3d', source: 'automation' });
    expect(h.hass.callWS).toHaveBeenCalledWith({
      type: PRESET_RESULT, request_id: 'request-1', target_id: 'connection-1', layout_key: 'house', panel: 'hallway', card_id: 'wall-tablet',
      status: 'selected', view_id: 'door', mode: '3d',
    });
    await vi.advanceTimersByTimeAsync(86400000);
    expect(h.onSelect).toHaveBeenCalledTimes(1); // default is no automatic return
    h.controller.disconnect();
    await flush();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores other cards/layouts and duplicate deliveries', async () => {
    const h = harness();
    h.controller.setHass(h.hass); await flush();
    await h.emit(request({ card_id: 'phone' }));
    await h.emit(request({ layout_key: 'other' }));
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.hass.callWS).not.toHaveBeenCalled();
    await h.emit(request()); await h.emit(request());
    expect(h.onSelect).toHaveBeenCalledTimes(1);
    h.controller.disconnect();
  });

  it('reports unknown/ambiguous names and does not move a camera', async () => {
    const h = harness();
    h.controller.setHass(h.hass); await flush();
    await h.emit(request({ preset: 'Missing' }));
    h.state.views = [...views, { id: 'second-door', label: 'Front door' }];
    await h.emit(request({ request_id: 'request-2' }));
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.hass.callWS.mock.calls.map(([data]) => data.status)).toEqual(['invalid_preset', 'ambiguous_preset']);
    expect(h.onError).toHaveBeenCalledTimes(2);
    h.controller.disconnect();
  });

  it('uses a requested mode before the saved mode and confirms loading/editing refusal', async () => {
    const h = harness();
    h.controller.setHass(h.hass); await flush();
    await h.emit(request({ mode: 'top' }));
    expect(h.onSelect).toHaveBeenLastCalledWith(views[1], { mode: 'top', source: 'automation' });
    h.onSelect.mockReturnValueOnce(false);
    await h.emit(request({ request_id: 'request-2' }));
    expect(h.hass.callWS).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'not_ready' }));
    h.controller.disconnect();
  });

  it('reports a selection failure to HA as well as the card', async () => {
    const h = harness({ onSelect: () => { throw new Error('Camera cannot be selected'); } });
    h.controller.setHass(h.hass); await flush();
    await h.emit(request());
    expect(h.hass.callWS).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', message: 'Camera cannot be selected' }));
    expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Camera cannot be selected' }));
    h.controller.disconnect();
  });

  it('reports a lost acknowledgement connection once without retrying another result', async () => {
    const h = harness();
    h.onSelect.mockReturnValue(false);
    h.hass.callWS.mockRejectedValue(new Error('Connection lost'));
    h.controller.setHass(h.hass); await flush();
    await h.emit(request());
    expect(h.hass.callWS).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Connection lost' }));
    h.controller.disconnect();
  });

  it('returns to the previous view/mode and passes its exact camera state to the card', async () => {
    const h = harness();
    h.controller.setHass(h.hass); await flush();
    await h.emit(request({ return_after: 5 }));
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.onSelect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.onSelect).toHaveBeenLastCalledWith(views[0], { mode: 'top', source: 'return', restore: h.state.current });
    h.controller.disconnect();
  });

  it.each(['touch', 'new request', 'layout change', 'card change', 'disconnect', 'removed view'])(
    'cancels or ignores optional return after %s', async (reason) => {
      const h = harness();
      h.controller.setHass(h.hass); await flush();
      await h.emit(request({ return_after: 5 }));
      if (reason === 'touch') h.controller.interrupt();
      if (reason === 'new request') await h.emit(request({ request_id: 'request-2', preset: 'garden' }));
      if (reason === 'layout change') h.state.target = { ...h.state.target, layout_key: 'other' };
      if (reason === 'card change') h.state.target = { ...h.state.target, card_id: 'phone' };
      if (reason === 'disconnect') h.controller.disconnect();
      if (reason === 'removed view') h.state.views = views.slice(1);
      await vi.advanceTimersByTimeAsync(6000);
      expect(h.onSelect.mock.calls.every(([, options]) => options.source === 'automation')).toBe(true);
      h.controller.disconnect();
    },
  );

  it('cleans up a subscription which resolves after disconnect and ignores its stale callback', async () => {
    let complete, callback;
    const h = harness();
    h.connection.subscribeMessage.mockImplementation((cb) => {
      callback = cb;
      return new Promise((resolve) => { complete = resolve; });
    });
    h.controller.setHass(h.hass); await flush();
    h.controller.disconnect();
    complete(h.unsubscribe); await flush();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    callback({ data: request() }); await flush();
    expect(h.onSelect).not.toHaveBeenCalled();
  });

  it('changes connection without leaking subscriptions and uses the latest hass object to confirm', async () => {
    const h = harness(), next = harness();
    h.controller.setHass(h.hass); await flush();
    h.controller.setHass(next.hass); await flush();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(next.connection.subscribeMessage).toHaveBeenCalledTimes(1);
    await next.emit(request());
    expect(next.hass.callWS).toHaveBeenCalledTimes(1);
    expect(h.hass.callWS).not.toHaveBeenCalled();
    h.controller.disconnect(); await flush();
    expect(next.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('retries a failed subscription on HA ready without duplicating a healthy reconnect subscription', async () => {
    const h = harness();
    h.connection.subscribeMessage.mockRejectedValueOnce(new Error('Offline'));
    h.controller.setHass(h.hass); await flush();
    expect(h.onError).toHaveBeenCalledTimes(1);
    const ready = h.connection.addEventListener.mock.calls.find(([event]) => event === 'ready')[1];
    ready(); await flush(); ready(); await flush();
    expect(h.connection.subscribeMessage).toHaveBeenCalledTimes(2);
    h.controller.disconnect();
    expect(h.connection.removeEventListener).toHaveBeenCalledWith('ready', ready);
  });

  it('does not subscribe an unaddressed card and registers after address is configured', async () => {
    const h = harness();
    h.state.target = { layout_key: 'house' };
    h.controller.setHass(h.hass); await flush();
    expect(h.connection.subscribeMessage).not.toHaveBeenCalled();
    h.state.target = { layout_key: 'house', panel: 'hallway' };
    h.controller.setHass(h.hass); await flush();
    expect(h.connection.subscribeMessage).toHaveBeenCalledWith(expect.any(Function), {
      type: PRESET_SUBSCRIBE, layout_key: 'house', panel: 'hallway',
    });
    h.controller.disconnect();
  });

  it('re-registers a changed layout or card address on the same connection and cleans the old target', async () => {
    const h = harness();
    h.controller.setHass(h.hass); await flush();
    h.state.target = { layout_key: 'other', panel: 'bedroom', card_id: 'second-tablet' };
    h.controller.setHass(h.hass); await flush();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.connection.subscribeMessage).toHaveBeenLastCalledWith(expect.any(Function), { type: PRESET_SUBSCRIBE, ...h.state.target });
    await h.emit(request());
    expect(h.onSelect).not.toHaveBeenCalled();
    h.controller.disconnect();
  });

  it('does not schedule a return for a selection interrupted while its handler was pending', async () => {
    let finish;
    const h = harness({ onSelect: () => new Promise((resolve) => { finish = resolve; }) });
    h.controller.setHass(h.hass); await flush();
    await h.emit(request({ return_after: 5 }));
    h.controller.interrupt(); finish(true); await flush();
    expect(h.hass.callWS).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'not_ready' }));
    await vi.advanceTimersByTimeAsync(6000);
    h.controller.disconnect();
  });
});
