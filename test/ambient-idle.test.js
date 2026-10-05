import { describe, expect, it, vi } from 'vitest';
import { AMBIENT_IDLE_DEFAULTS, AMBIENT_IDLE_LIMITS, AmbientIdleController, readAmbientDim, readAmbientIdle } from '../src/ambient-idle.js';

const enabled = (patch = {}) => ({ enabled: true, idle_seconds: 1, ...patch });
const dimPolicy = (when = 'sun', patch = {}) => enabled({ dim: { enabled: true, brightness: 0.65, when, ...patch } });
const clock = (iso) => Date.parse(iso);
const codes = (result) => result.diagnostics.map((entry) => entry.code);
const fixture = (patch = {}, callbacks = {}) => {
  let context = { policy: enabled(), eligible: true, generation: 'house:1', ...patch };
  const begin = vi.fn(() => true), advance = vi.fn(() => true), end = vi.fn(() => true), dim = vi.fn();
  const controller = new AmbientIdleController({ getContext: () => context, onBegin: begin, onAdvance: advance, onEnd: end, onDim: dim, ...callbacks });
  return { controller, begin, advance, end, dim, get context() { return context; }, set context(value) { context = value; } };
};
const start = (f) => { f.controller.tick(0); f.controller.tick(1000); expect(f.controller.state.status).toBe('idle'); };

describe('strict opt-in ambient policy', () => {
  it('has disabled finite defaults and preserves unknown fields without editing raw imports', () => {
    expect(readAmbientIdle(undefined)).toEqual({ ...AMBIENT_IDLE_DEFAULTS, dim: { ...AMBIENT_IDLE_DEFAULTS.dim }, valid: true, diagnostics: [] });
    const extra = Object.freeze({ future: 'retained' }), raw = Object.freeze({ enabled: true, extra, dim: Object.freeze({ enabled: true, future: extra }) });
    const policy = readAmbientIdle(raw);
    expect(policy).toMatchObject({ enabled: true, extra, dim: { enabled: true, future: extra, when: 'sun', brightness: 0.65 }, valid: true });
    expect(policy.dim).not.toBe(raw.dim); expect(raw.dim).toEqual({ enabled: true, future: extra });
  });
  it.each([null, true, false, [], 0, 'enabled', new Date()])('diagnoses a present non-object policy %j', (raw) => {
    const policy = readAmbientIdle(raw); expect(policy.enabled).toBe(false); expect(codes(policy)).toEqual(['settings']);
  });
  it.each([['enabled', 'true'], ['rotate', 1], ['idle_seconds', '120'], ['idle_seconds', 0], ['idle_seconds', 86401],
    ['idle_seconds', NaN], ['idle_seconds', Infinity], ['rotation_degrees_per_second', -1], ['rotation_degrees_per_second', 6.01],
    ['rotation_degrees_per_second', '0.5'], ['dim', null], ['dim', []], ['dim', false]])('rejects explicit %s=%j', (field, value) => {
    const policy = readAmbientIdle(enabled({ [field]: value })); expect(policy.valid).toBe(false); expect(codes(policy)).toContain(field);
    const f = fixture({ policy }); f.controller.tick(0); f.controller.tick(100000); expect(f.begin).not.toHaveBeenCalled();
  });
  it.each([['enabled', undefined], ['brightness', 0], ['brightness', 1.01], ['brightness', '0.65'], ['when', 'night'],
    ['start', '7:00'], ['start', '24:00'], ['end', '07:60'], ['end', null]])('diagnoses dim.%s=%j', (field, value) => {
    expect(codes(readAmbientIdle(dimPolicy('sun', { [field]: value })))).toContain(`dim.${field}`);
  });
  it('accepts exact endpoints, rejects equal quiet times, and ignores inherited options', () => {
    expect(readAmbientIdle(enabled({ idle_seconds: 86400, rotation_degrees_per_second: 0, dim: { brightness: 0.1 } })).valid).toBe(true);
    expect(codes(readAmbientIdle(dimPolicy('quiet_hours', { start: '00:00', end: '00:00' })))).toEqual(['dim.hours']);
    const raw = Object.create({ enabled: true }); raw.rotate = false;
    expect(readAmbientIdle(raw)).toMatchObject({ enabled: false, valid: false });
    expect(AMBIENT_IDLE_LIMITS.frameDeltaMs).toBe(50);
  });
  it('retains invalidity when passing a normalized malformed policy back to the controller', () => {
    const policy = readAmbientIdle(enabled({ idle_seconds: undefined }));
    expect(readAmbientIdle(policy).valid).toBe(false);
    const f = fixture({ policy }); f.controller.tick(0); f.controller.tick(100000);
    expect(f.controller.state.status).toBe('invalid'); expect(f.begin).not.toHaveBeenCalled();
    for (const raw of [null, [], 'bad']) expect(readAmbientIdle(readAmbientIdle(raw)).valid).toBe(false);
  });
});

describe('honest dim sources and Home Assistant quiet hours', () => {
  it('does nothing by default without querying any environmental source', () => {
    expect(readAmbientDim(undefined)).toMatchObject({ brightness: 1, factor: 0, reason: 'off', valid: true, diagnostics: [] });
    expect(readAmbientDim(enabled())).toMatchObject({ brightness: 1, reason: 'off', valid: true });
  });
  it('uses ready actual night factor progressively and never a manual sky value', () => {
    expect(readAmbientDim(dimPolicy(), { sun: { status: 'ready', nightFactor: 1 } })).toMatchObject({ brightness: 0.65, factor: 1, reason: 'sun', valid: true });
    expect(readAmbientDim(dimPolicy(), { sun: { status: 'ready', nightFactor: 0.5 } }).brightness).toBeCloseTo(0.825);
    expect(readAmbientDim(dimPolicy(), { sun: { status: 'ready', nightFactor: 0 } })).toMatchObject({ brightness: 1, reason: 'day' });
    expect(readAmbientDim(dimPolicy(), { sky: { night: 1 } })).toMatchObject({ brightness: 1, valid: false });
  });
  it.each([undefined, { status: 'unavailable', nightFactor: 1 }, { status: 'restored', nightFactor: 1 }, { status: 'ready', nightFactor: '1' },
    { status: 'ready', nightFactor: NaN }, { status: 'ready', nightFactor: -1 }, { status: 'ready', nightFactor: 2 }])('does not infer night from %j', (sun) => {
    expect(readAmbientDim(dimPolicy(), { sun })).toMatchObject({ brightness: 1, factor: 0, valid: false, sun: { status: 'unavailable' } });
  });
  it('uses the explicit HA zone, exact half-open endpoints and midnight wrapping', () => {
    const policy = dimPolicy('quiet_hours');
    for (const [iso, active] of [['2026-01-01T21:59:59Z', false], ['2026-01-01T22:00:00Z', true],
      ['2026-01-02T06:59:59Z', true], ['2026-01-02T07:00:00Z', false]]) {
      expect(readAmbientDim(policy, { wallTime: clock(iso), timeZone: 'Europe/London' })).toMatchObject({ valid: true, quietHours: { active }, brightness: active ? 0.65 : 1 });
    }
    // London is UTC+1 in July. Server/browser timezone cannot change this answer.
    expect(readAmbientDim(policy, { wallTime: clock('2026-07-01T21:00:00Z'), timeZone: 'Europe/London' }).quietHours).toMatchObject({ active: true, minute: 1320 });
    expect(readAmbientDim(policy, { wallTime: clock('2026-07-01T21:00:00Z'), timeZone: 'UTC' }).quietHours.active).toBe(false);
  });
  it('handles a non-wrapping interval and repeated DST hour as actual local time', () => {
    const policy = dimPolicy('quiet_hours', { start: '01:15', end: '01:45' });
    for (const iso of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
      expect(readAmbientDim(policy, { wallTime: clock(iso), timeZone: 'Europe/London' }).quietHours.active).toBe(true);
    }
    expect(readAmbientDim(policy, { wallTime: clock('2026-10-25T01:45:00Z'), timeZone: 'Europe/London' }).quietHours.active).toBe(false);
  });
  it.each([undefined, '', 'not-a-zone', '+01:00', ' Europe/London '])('refuses missing/malformed time zone %j with no fallback', (timeZone) => {
    const reading = readAmbientDim(dimPolicy('quiet_hours'), { wallTime: clock('2026-01-01T23:00:00Z'), timeZone });
    expect(reading).toMatchObject({ brightness: 1, valid: false }); expect(codes(reading)).toEqual(['time_zone']);
  });
  it.each([undefined, Infinity, NaN, '2026-01-01T23:00:00Z', 8640000000000001])('refuses missing/malformed explicit wall clock %j', (wallTime) => {
    expect(codes(readAmbientDim(dimPolicy('quiet_hours'), { wallTime, timeZone: 'UTC' }))).toEqual(['clock']);
  });
  it('lets either independently trustworthy OR condition apply without inventing its missing partner', () => {
    const policy = dimPolicy('sun_or_quiet_hours');
    const quietOnly = readAmbientDim(policy, { sun: { status: 'unavailable' }, wallTime: clock('2026-01-01T23:00:00Z'), timeZone: 'UTC' });
    expect(quietOnly).toMatchObject({ brightness: 0.65, factor: 1, reason: 'quiet_hours', valid: false }); expect(codes(quietOnly)).toEqual(['sun']);
    const sunOnly = readAmbientDim(policy, { sun: { status: 'ready', nightFactor: 0.5 } });
    expect(sunOnly).toMatchObject({ brightness: 0.825, factor: 0.5, reason: 'sun', valid: false }); expect(codes(sunOnly)).toEqual(['clock']);
  });
  it('constructs and formats once for repeated 60Hz reads of one exact HA zone/minute', () => {
    const NativeFormatter = Intl.DateTimeFormat, format = vi.spyOn(NativeFormatter.prototype, 'formatToParts');
    const construct = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args) { return new NativeFormatter(...args); });
    try {
      const epoch = clock('2026-09-23T22:00:00Z'), policy = dimPolicy('quiet_hours'), zone = 'Pacific/Chatham';
      for (let frame = 0; frame < 3600; frame++) expect(readAmbientDim(policy, { wallTime: epoch + frame * 1000 / 60, timeZone: zone }).valid).toBe(true);
      expect(construct).toHaveBeenCalledTimes(1); expect(format).toHaveBeenCalledTimes(1);
      readAmbientDim(policy, { wallTime: epoch + 60000, timeZone: zone });
      expect(construct).toHaveBeenCalledTimes(1); expect(format).toHaveBeenCalledTimes(2);
      expect(construct.mock.calls[0][1].timeZone).toBe(zone);
    } finally { construct.mockRestore(); format.mockRestore(); }
  });
  it('evaluates fresh policy bounds and sun evidence even when the local minute is cached', () => {
    const epoch = clock('2026-09-24T12:30:00Z'), source = { wallTime: epoch, timeZone: 'UTC', sun: { status: 'ready', nightFactor: 0.5 } };
    expect(readAmbientDim(dimPolicy('quiet_hours', { start: '12:00', end: '13:00' }), source)).toMatchObject({ brightness: 0.65, quietHours: { active: true } });
    expect(readAmbientDim(dimPolicy('quiet_hours', { start: '13:00', end: '14:00' }), source)).toMatchObject({ brightness: 1, quietHours: { active: false } });
    expect(readAmbientDim(dimPolicy('sun_or_quiet_hours', { start: '13:00', end: '14:00', brightness: 0.5 }), source).brightness).toBe(0.75);
    expect(readAmbientDim(dimPolicy('sun_or_quiet_hours', { start: '13:00', end: '14:00', brightness: 0.5 }), { ...source, sun: { status: 'ready', nightFactor: 1 } }).brightness).toBe(0.5);
    expect(readAmbientDim(dimPolicy('quiet_hours', { start: '12:00', end: '13:00' }), { ...source, timeZone: 'America/New_York' }).quietHours.active).toBe(false);
  });
  it('does not reuse a cached minute across exact quiet endpoint or DST offset transition', () => {
    const policy = dimPolicy('quiet_hours', { start: '01:00', end: '01:30' }), timeZone = 'Europe/London';
    expect(readAmbientDim(policy, { wallTime: clock('2026-10-25T00:59:59.999Z'), timeZone }).quietHours).toMatchObject({ active: false, minute: 119 });
    expect(readAmbientDim(policy, { wallTime: clock('2026-10-25T01:00:00.000Z'), timeZone }).quietHours).toMatchObject({ active: true, minute: 60 });
    expect(readAmbientDim(policy, { wallTime: clock('2026-10-25T01:30:00.000Z'), timeZone }).quietHours.active).toBe(false);
  });
  it('bounds minute and zone caches rather than retaining arbitrary historical sources forever', () => {
    const NativeFormatter = Intl.DateTimeFormat, format = vi.spyOn(NativeFormatter.prototype, 'formatToParts');
    const construct = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args) { return new NativeFormatter(...args); });
    try {
      const epoch = clock('2026-09-26T12:30:00Z'), policy = dimPolicy('quiet_hours');
      for (let minute = 0; minute < 18; minute++) readAmbientDim(policy, { wallTime: epoch + minute * 60000, timeZone: 'UTC' });
      const reads = format.mock.calls.length;
      readAmbientDim(policy, { wallTime: epoch, timeZone: 'UTC' }); expect(format).toHaveBeenCalledTimes(reads + 1);
      const before = construct.mock.calls.length;
      for (let zone = 0; zone < 10; zone++) readAmbientDim(policy, { wallTime: epoch, timeZone: `invalid-zone-${zone}` });
      expect(construct).toHaveBeenCalledTimes(before + 10);
      readAmbientDim(policy, { wallTime: epoch, timeZone: 'invalid-zone-9' }); expect(construct).toHaveBeenCalledTimes(before + 10);
      readAmbientDim(policy, { wallTime: epoch, timeZone: 'invalid-zone-0' }); expect(construct).toHaveBeenCalledTimes(before + 11);
    } finally { construct.mockRestore(); format.mockRestore(); }
  });
});

describe('pure monotonic lifecycle driven by the existing RAF', () => {
  it('does no callbacks under default disabled policy or missing eligibility/generation', () => {
    for (const patch of [{ policy: undefined }, { eligible: undefined }, { generation: undefined }, { reducedMotion: true }, { policy: enabled({ rotate: false }) }]) {
      const f = fixture(patch); f.controller.tick(0); f.controller.tick(999999);
      expect(f.begin).not.toHaveBeenCalled(); expect(f.advance).not.toHaveBeenCalled(); expect(f.dim).not.toHaveBeenCalled();
    }
  });
  it('arms once, enters only on RAF after the exact delay and uses a root-owned token', () => {
    const f = fixture(); f.controller.tick(0); expect(f.controller.state).toMatchObject({ status: 'waiting', idleAt: 0, deadline: 1000 });
    f.controller.tick(999); expect(f.begin).not.toHaveBeenCalled();
    f.controller.revalidate(1000); expect(f.begin).not.toHaveBeenCalled();
    const result = f.controller.tick(1000); expect(result).toMatchObject({ status: 'idle', changed: true, cameraChanged: false });
    const token = f.controller.active.token; expect(Object.isFrozen(token)).toBe(true);
    expect(f.begin.mock.calls[0][0]).toMatchObject({ token, generation: 'house:1', now: 1000 });
    f.controller.tick(1010); expect(f.advance.mock.calls[0][0]).toMatchObject({ token, degrees: 0.005, deltaSeconds: 0.01 });
  });
  it('gives equal rotation at 30 and 60fps without a second loop or timestamp source', () => {
    const totals = [30, 60].map((fps) => {
      const f = fixture(); start(f);
      for (let frame = 1; frame <= fps; frame++) f.controller.tick(1000 + frame * 1000 / fps);
      return f.advance.mock.calls.reduce((sum, [reading]) => sum + reading.degrees, 0);
    });
    expect(totals[0]).toBeCloseTo(0.5); expect(totals[1]).toBeCloseTo(0.5);
  });
  it('caps a long frame gap and never catches up a hidden/blocked interval', () => {
    const f = fixture(); start(f); f.controller.tick(100000);
    expect(f.advance.mock.lastCall[0]).toMatchObject({ deltaSeconds: 0.05, degrees: 0.025 });
    f.context = { ...f.context, eligible: false }; f.controller.revalidate(100001);
    f.controller.tick(200000); expect(f.end).toHaveBeenCalledTimes(1);
    f.context = { ...f.context, eligible: true }; f.controller.tick(200001);
    expect(f.controller.state).toMatchObject({ status: 'waiting', idleAt: 200001, deadline: 201001 });
    f.controller.tick(201001); expect(f.begin).toHaveBeenCalledTimes(2); expect(f.advance).toHaveBeenCalledTimes(1);
  });
  it('ordinary source object replacements and unrelated HA updates never reset idle or camera', () => {
    const f = fixture(); f.controller.tick(0);
    for (const now of [100, 300, 999]) {
      f.context = { ...f.context, policy: { ...enabled(), future: now }, hass: { sensor: now } };
      f.controller.revalidate(now); expect(f.controller.state.deadline).toBe(1000);
    }
    f.controller.tick(1000); const token = f.controller.active.token;
    f.context = { ...f.context, hass: { sensor: 'new' } }; f.controller.revalidate(1001);
    expect(f.controller.active.token).toBe(token); expect(f.end).not.toHaveBeenCalled();
  });
  it('restores synchronously before activity returns and re-arms only from genuine interaction', () => {
    const order = [], f = fixture({}, { onEnd: (reading) => { order.push(reading.reason); return true; } }); start(f);
    const result = f.controller.activity(1002); order.push('gesture');
    expect(order).toEqual(['activity', 'gesture']); expect(result).toMatchObject({ cameraChanged: true, status: 'waiting', deadline: 2002 });
    f.controller.tick(2001); expect(f.begin).toHaveBeenCalledTimes(1); f.controller.tick(2002); expect(f.begin).toHaveBeenCalledTimes(2);
  });
  it('discards the old generation rather than restoring its camera into a newly loaded model', () => {
    const f = fixture(); start(f); const old = f.controller.active.token;
    f.context = { ...f.context, generation: 'house:2' }; f.controller.revalidate(1010);
    expect(f.end.mock.lastCall[0]).toMatchObject({ token: old, generation: 'house:1', reason: 'generation', restore: false });
    expect(f.controller.state.deadline).toBe(2010); f.controller.tick(2010);
    expect(f.controller.active.token).not.toBe(old); expect(f.controller.active.generation).toBe('house:2');
  });
  it('disabling or changing known policy ends once; equal policy and unknown fields do not', () => {
    const f = fixture(); start(f);
    f.context = { ...f.context, policy: enabled({ rotation_degrees_per_second: 1 }) }; f.controller.revalidate(1001);
    expect(f.end).toHaveBeenCalledTimes(1); expect(f.end.mock.lastCall[0].reason).toBe('policy');
    f.controller.tick(2001); f.context = { ...f.context, policy: enabled({ rotation_degrees_per_second: 1, future: true }) }; f.controller.revalidate(2002);
    expect(f.end).toHaveBeenCalledTimes(1);
    f.context = { ...f.context, policy: { enabled: false } }; f.controller.revalidate(2003); f.controller.tick(5000);
    expect(f.end).toHaveBeenCalledTimes(2); expect(f.controller.state.status).toBe('disabled');
  });
  it('reduced motion blocks and re-arms fully after preferences recover', () => {
    const f = fixture(); start(f); f.context = { ...f.context, reducedMotion: true }; f.controller.revalidate(1001);
    expect(f.end).toHaveBeenCalledTimes(1); expect(f.controller.state.status).toBe('blocked');
    f.context = { ...f.context, reducedMotion: false }; f.controller.tick(2000); expect(f.controller.state.deadline).toBe(3000);
  });
  it('CSS dim changes do not request camera/WebGL frames and update only when brightness changes', () => {
    const f = fixture({ policy: dimPolicy('sun', { brightness: 0.65 }), sun: { status: 'ready', nightFactor: 1 } });
    f.context.policy.rotate = false; start(f);
    expect(f.dim).toHaveBeenCalledTimes(1); expect(f.controller.tick(1010)).toMatchObject({ cameraChanged: false, dimChanged: false });
    f.context = { ...f.context, sun: { status: 'ready', nightFactor: 0.5 } };
    expect(f.controller.revalidate(1020)).toMatchObject({ cameraChanged: false, dimChanged: true, brightness: 0.825 });
    f.controller.revalidate(1030); expect(f.dim).toHaveBeenCalledTimes(2); expect(f.advance).not.toHaveBeenCalled();
    f.context = { ...f.context, eligible: false }; f.controller.revalidate(1040);
    expect(f.dim.mock.lastCall[0].brightness).toBe(1); expect(f.dim).toHaveBeenCalledTimes(3);
  });
  it('does not reset an active idle session when sun evidence disappears; safely removes only dimming', () => {
    const f = fixture({ policy: dimPolicy(), sun: { status: 'ready', nightFactor: 1 } }); start(f); const token = f.controller.active.token;
    f.context = { ...f.context, sun: { status: 'unavailable', nightFactor: 1 } }; f.controller.revalidate(1001);
    expect(f.controller.active.token).toBe(token); expect(f.controller.state.brightness).toBe(1); expect(codes(f.controller.state)).toContain('sun');
    expect(f.end).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -1, '1001', 999])('safely stops on malformed/backward monotonic time %j', (now) => {
    const f = fixture(); start(f); expect(f.controller.tick(now)).toMatchObject({ status: 'invalid', active: false });
    expect(f.end).toHaveBeenCalledTimes(1); expect(f.advance).not.toHaveBeenCalled();
    f.controller.tick(1002); expect(f.controller.state.deadline).toBe(2002);
  });
  it('explicit suspend restores once and the next eligible tick starts a new full wait', () => {
    const f = fixture(); start(f); f.controller.suspend(1001, 'popup'); f.controller.suspend(1002, 'popup');
    expect(f.end).toHaveBeenCalledTimes(1); expect(f.end.mock.lastCall[0].reason).toBe('popup');
    f.controller.tick(1003); expect(f.controller.state.deadline).toBe(2003);
  });
  it('callback rejection/exception does not spin or leave an active camera', () => {
    const f = fixture({}, { onBegin: () => false }); f.controller.tick(0); f.controller.tick(1000);
    expect(f.controller.state).toMatchObject({ active: false, deadline: 2000 });
    const broken = fixture({}, { onAdvance: () => { throw new Error('camera unavailable'); } }); start(broken); broken.controller.tick(1001);
    expect(broken.controller.state).toMatchObject({ active: false, deadline: 2001, status: 'waiting' }); expect(codes(broken.controller.state)).toContain('advance');
  });
  it('cannot resurrect a session from reentrant begin/end/disposal callbacks', () => {
    let controller;
    const f = fixture({}, { onBegin: () => { controller.activity(1000); return true; }, onEnd: () => { controller.revalidate(1000); return true; } });
    controller = f.controller; controller.tick(0); controller.tick(1000); expect(controller.active).toBeNull();
    const disposed = fixture({}, { onEnd: () => { disposed.controller.tick(9999); return true; } }); start(disposed);
    disposed.controller.dispose(1001); disposed.controller.tick(10000); disposed.controller.activity(10001); disposed.controller.dispose();
    expect(disposed.controller.state.status).toBe('disposed'); expect(disposed.controller.active).toBeNull(); expect(disposed.begin).toHaveBeenCalledTimes(1);
  });
  it('an end callback cannot start a second session before the outer cancellation re-arms', () => {
    let controller;
    const f = fixture({}, { onEnd: () => { controller.tick(1001); return true; } }); controller = f.controller; start(f);
    controller.activity(1001);
    expect(controller.active).toBeNull(); expect(f.begin).toHaveBeenCalledTimes(1); expect(controller.state.deadline).toBe(2001);
  });
  it('bad clock and disposal discard a camera when the root generation already changed', () => {
    for (const action of ['clock', 'dispose']) {
      const f = fixture(); start(f); f.context = { ...f.context, generation: 'other-model' };
      if (action === 'clock') f.controller.tick(NaN); else f.controller.dispose(1001);
      expect(f.end.mock.lastCall[0]).toMatchObject({ generation: 'house:1', restore: false });
    }
  });
  it('starts no timers, observer, HA action or camera snapshots', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout'), interval = vi.spyOn(globalThis, 'setInterval');
    try {
      const service = vi.fn(), f = fixture({ hass: { callService: service, states: {} } }); start(f); f.controller.tick(1016); f.controller.dispose();
      expect(timeout).not.toHaveBeenCalled(); expect(interval).not.toHaveBeenCalled(); expect(service).not.toHaveBeenCalled();
      expect(f.controller.active).toBeNull(); expect(Object.keys(f.controller.state)).not.toContain('camera');
    } finally { timeout.mockRestore(); interval.mockRestore(); }
  });
});
