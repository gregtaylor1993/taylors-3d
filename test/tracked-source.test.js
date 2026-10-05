import { describe, it, expect } from 'vitest';
import { readCoordinate, compileCalibration, readFreshness, readDetection } from '../src/tracked-source.js';

const now = Date.parse('2026-10-05T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const state = (value = 'on', attributes = {}, at = now) => ({ state: value, attributes, last_updated: iso(at), last_changed: iso(at) });
const xy = { source: 'xy', units: 'm', plan_meters: true };
const point = (src, plan) => ({ src, plan });
const close = (actual, expected) => expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 6));
const event = { kind: 'event', expires_seconds: 30, event_types: ['vehicle'] };

describe('measured coordinate evidence', () => {
  it('reads one atomic source and nested attribute paths without converting its raw units', () => {
    const source = state('cleaning', { location: { east: '1.25e3', north: '-.5' } });
    const result = readCoordinate(source, { source: 'xy', x_attr: 'location.east', y_attr: 'location.north', units: 'mm' });
    expect(result).toEqual({ status: 'ready', kind: 'xy', raw: [1250, -.5], diagnostics: [] });
    expect(source.attributes.location.east).toBe('1.25e3');
  });
  it.each([null, undefined, '', ' ', true, false, '0x10', '12 m', [], {}, Infinity, 'Infinity', 'NaN'])('rejects invalid numeric input %j', (x) => {
    expect(readCoordinate(state('cleaning', { x, y: 1 }), xy).status).toBe('invalid');
  });
  it('accepts actual zero and ignores inherited coordinate properties', () => {
    expect(readCoordinate(state('idle', { x: 0, y: '0' }), xy).raw).toEqual([0, 0]);
    expect(readCoordinate(state('idle', Object.create({ x: 1, y: 2 })), xy).raw).toBeNull();
  });
  it.each(['unknown', 'unavailable'])('never uses old attributes from a %s entity', (value) => {
    expect(readCoordinate(state(value, { x: 4, y: 5 }), xy)).toMatchObject({ status: 'unavailable', raw: null });
  });
  it('rejects restored snapshots and missing entities', () => {
    expect(readCoordinate(state('idle', { x: 4, y: 5, restored: true }), xy).status).toBe('unavailable');
    expect(readCoordinate(null, xy).status).toBe('missing');
  });
  it('validates GPS bounds and configurable attributes', () => {
    expect(readCoordinate(state('home', { lat: '-90', lon: 180 }), { source: 'gps', latitude_attr: 'lat', longitude_attr: 'lon' }).raw).toEqual([-90, 180]);
    for (const [latitude, longitude] of [[90.01, 0], [0, 180.01], [-91, -181]])
      expect(readCoordinate(state('home', { latitude, longitude }), { source: 'gps' }).status).toBe('invalid');
    expect(readCoordinate(state('45,10'), { source: 'gps' }).status).toBe('invalid');
  });
});

describe('validated calibration', () => {
  it('requires a declared direct-plan frame, converts known units, and validates every transform input', () => {
    expect(compileCalibration({ source: 'xy' }).status).toBe('invalid');
    expect(compileCalibration({ source: 'xy', units: 'm' }).status).toBe('invalid');
    expect(compileCalibration({ ...xy, units: 'feet' }).status).toBe('invalid');
    const fit = compileCalibration({ ...xy, units: 'mm' });
    expect(fit.method).toBe('identity');
    expect(fit.transform(readCoordinate(state('cleaning', { x: 1250, y: -500 }), { source: 'xy' }))).toEqual([1.25, -.5]);
    expect(fit.transform({ status: 'unavailable', raw: [4, 5] })).toBeNull();
    expect(fit.transform({ kind: 'gps', raw: [4, 5] })).toBeNull();
    expect(fit.transform([true, 1])).toBeNull();
  });
  it('one point translates only with declared XY scale or a north-up GPS plan', () => {
    const calibration = [point([1000, 2000], [5, 6])];
    expect(compileCalibration({ source: 'xy', calibration }).status).toBe('invalid');
    const fit = compileCalibration({ source: 'xy', units: 'mm', calibration });
    expect(fit.method).toBe('translation'); close(fit.transform([2000, 1000]), [6, 5]);
    const gpsCalibration = [point([45, 10], [2, 3])];
    expect(compileCalibration({ source: 'gps', calibration: gpsCalibration }).status).toBe('invalid');
    const gpsFit = compileCalibration({ source: 'gps', calibration: gpsCalibration, north_up: true });
    close(gpsFit.transform([45, 10]), [2, 3]);
    expect(gpsFit.transform([45.0001, 10])[1]).toBeCloseTo(14.131949, 5);
  });
  it('fits similarity to raw units using two measured, separated points', () => {
    const fit = compileCalibration({ source: 'xy', calibration: [point([0, 0], [5, 1]), point([1000, 0], [5, 3])] });
    expect(fit.status).toBe('ready'); expect(fit.method).toBe('similarity');
    close(fit.transform([3000, -2000]), [9, 7]);
    expect(fit.residual).toBeCloseTo(0);
  });
  it('normalizes large source offsets before fitting an affine map', () => {
    const origin = 1e12;
    const map = ([u, v]) => [1.5 * u + .3 * v - 2, -.2 * u + .8 * v + 4];
    const calibration = [[0, 0], [10, 0], [0, 10], [7, 3]].map((p) => point(p.map((v) => v + origin), map(p)));
    const fit = compileCalibration({ source: 'xy', calibration });
    expect(fit.method).toBe('affine'); close(fit.transform([origin + 5, origin + 5]), map([5, 5]));
    expect(fit.residual).toBeLessThan(.0001);
  });
  it('reports the real residual of a noisy affine fit', () => {
    const calibration = [[0, 0], [10, 0], [10, 10], [0, 10]].map((p, i) => point(p, [p[0] + (i % 2 ? .5 : -.5), p[1]]));
    expect(compileCalibration({ source: 'xy', calibration }).residual).toBeGreaterThan(.3);
  });
  it('rejects duplicate points, collinear and near-collinear source sets without a fallback', () => {
    const sets = [
      [point([0, 0], [1, 2]), point([0, 0], [10, 20])],
      [[0, 0], [1, 0], [2, 0]].map((p) => point(p, p)),
      [[0, 0], [1, 0], [2, 1e-8]].map((p) => point(p, p)),
    ];
    for (const calibration of sets) expect(compileCalibration({ source: 'xy', calibration }))
      .toMatchObject({ status: 'invalid', transform: null, residual: null, method: null });
  });
  it('rejects collapsed destination maps and invalid calibration points', () => {
    for (const calibration of [
      [point([0, 0], [1, 1]), point([1, 0], [1, 1])],
      [point([0, 0], [0, 0]), point([1, 0], [1, 0]), point([0, 1], [2, 0])],
      [point([0, 0], [Infinity, 1])], [point([0, true], [1, 2])],
    ]) expect(compileCalibration({ ...xy, calibration }).status).toBe('invalid');
  });
  it('uses local GPS metres across the longitude boundary', () => {
    const fit = compileCalibration({ source: 'gps', north_up: true, calibration: [point([0, 179.9999], [0, 0])] });
    expect(fit.transform([0, -179.9999])[0]).toBeCloseTo(22.263898, 4);
  });
});

describe('explicit source freshness', () => {
  it.each(['malformed', null, [], ['timestamp_mode'], true, false, 10, new Date(0)])('rejects an explicitly malformed freshness setting: %j', (cfg) => {
    const reading = readFreshness(state('on'), cfg, now);
    expect(reading).toMatchObject({ status: 'invalid', verified: false, observedAt: null, expiresAt: null, nextExpiry: null });
    expect(reading.diagnostics).toEqual([expect.objectContaining({ code: 'freshness' })]);
    for (const kind of ['occupancy', 'count', 'event']) {
      const detection = readDetection(state(kind === 'count' ? '1' : 'on'), { kind, freshness: cfg }, now);
      expect(detection).toMatchObject({ status: 'invalid', active: false, nextExpiry: null });
      expect(detection.diagnostics[0].code).toBe('freshness');
    }
  });

  it('preserves absent and empty freshness rules as an unverified current state', () => {
    for (const cfg of [undefined, {}, Object.create(null)]) {
      expect(readFreshness(state('on'), cfg, now)).toMatchObject({ status: 'current', verified: false, nextExpiry: null });
      expect(readDetection(state('on'), { kind: 'occupancy', freshness: cfg }, now)).toMatchObject({ status: 'ready', active: true, nextExpiry: null });
    }
    expect(readDetection(state('on'), { kind: 'occupancy' }, now).active).toBe(true);
  });
  it('unchanged sustained HA states do not imply an expired heartbeat', () => {
    expect(readFreshness(state('on', {}, now - 86400000), {}, now))
      .toMatchObject({ status: 'current', verified: false, observedAt: null, expiresAt: null, nextExpiry: null });
    expect(readFreshness(state(), { max_age_seconds: 10 }, now).status).toBe('invalid');
  });
  it('expires exactly at a configured source deadline without receiving another update', () => {
    const source = state('on', { measured_at: iso(now - 5000) });
    const cfg = { timestamp_mode: 'attribute', timestamp_attr: 'measured_at', max_age_seconds: 10 };
    expect(readFreshness(source, cfg, now)).toMatchObject({ status: 'ready', observedAt: now - 5000, expiresAt: now + 5000, nextExpiry: now + 5000, verified: true });
    expect(readFreshness(source, cfg, now + 5000)).toMatchObject({ status: 'stale', nextExpiry: null });
  });
  it('requires explicit epoch units and refuses future/missing/invalid timestamps', () => {
    expect(readFreshness(state(String(now / 1000)), { timestamp_mode: 'state', timestamp_format: 'seconds', max_age_seconds: 10 }, now).expiresAt).toBe(now + 10000);
    expect(readFreshness(state(String(now)), { timestamp_mode: 'state', timestamp_format: 'milliseconds' }, now).observedAt).toBe(now);
    for (const value of ['0', '2026-10-05T12:00:00', '2026-02-30T12:00:00Z', '2026-10-05T24:00:00Z', iso(now + 1), 'unknown', ''])
      expect(readFreshness(state(value), { timestamp_mode: 'state', max_age_seconds: 10 }, now).status).not.toBe('ready');
    expect(readFreshness(state(), { timestamp_mode: 'last_updated', max_age_seconds: true }, now).status).toBe('invalid');
  });
});

describe('sustained state and immutable detection events', () => {
  it('sustained occupancy and count remain current despite an old state-change time', () => {
    expect(readDetection(state('on', {}, now - 86400000), { kind: 'occupancy' }, now)).toMatchObject({ status: 'ready', active: true, nextExpiry: null });
    expect(readDetection(state('2', {}, now - 86400000), { kind: 'count' }, now)).toMatchObject({ status: 'ready', active: true, count: 2, nextExpiry: null });
    expect(readDetection(state('off'), {}, now).active).toBe(false);
    expect(readDetection(state('0'), { kind: 'count' }, now).active).toBe(false);
  });
  it('configured heartbeat expiry suppresses stale sustained readings', () => {
    const cfg = { kind: 'occupancy', freshness: { timestamp_mode: 'last_updated', max_age_seconds: 5 } };
    expect(readDetection(state('on', {}, now - 5000), cfg, now)).toMatchObject({ status: 'stale', active: false, nextExpiry: null });
  });
  it.each(['', ' ', '-1', '1.2', '1 car', 'Infinity', String(Number.MAX_SAFE_INTEGER + 1)])('rejects non-count state %j', (value) => {
    expect(readDetection(state(value), { kind: 'count' }, now).status).toBe('invalid');
  });
  it('requires distinct explicit states for nonbinary sustained sources', () => {
    expect(readDetection(state('occupied'), { active_states: ['occupied'], clear_states: ['empty'] }, now).active).toBe(true);
    expect(readDetection(state('occupied'), {}, now).status).toBe('invalid');
    expect(readDetection(state('on'), { active_states: ['on'], clear_states: ['on'] }, now).status).toBe('invalid');
  });
  it('absolute event timestamps survive replay and expire with no new state', () => {
    const source = state(iso(now - 10000), { event_type: 'vehicle', id: 'a' });
    const cfg = { ...event, event_id_attr: 'id' };
    const first = readDetection(source, cfg, now);
    expect(first).toMatchObject({ active: true, observedAt: now - 10000, expiresAt: now + 20000, nextExpiry: now + 20000 });
    const memory = Object.freeze(first.memory);
    const replay = readDetection({ ...source, last_updated: iso(now + 10000) }, { ...cfg, expires_seconds: 300 }, now + 10000, memory);
    expect(replay.memory).toEqual(memory); expect(replay.expiresAt).toBe(now + 20000);
    expect(readDetection(source, cfg, now + 20000, memory)).toMatchObject({ status: 'clear', active: false, nextExpiry: null });
    expect(readDetection(source, cfg, now + 20001).active).toBe(false); // fresh browser snapshot also cannot renew it
  });
  it('ignores out-of-order events and changing IDs at the same timestamp', () => {
    const first = readDetection(state(iso(now), { event_type: 'vehicle', id: 'a' }), { ...event, event_id_attr: 'id' }, now);
    const older = readDetection(state(iso(now - 1000), { event_type: 'vehicle', id: 'b' }), { ...event, event_id_attr: 'id' }, now + 1000, first.memory);
    const same = readDetection(state(iso(now), { event_type: 'vehicle', id: 'c' }), { ...event, event_id_attr: 'id' }, now + 1000, first.memory);
    expect(older.memory).toEqual(first.memory); expect(same.memory).toEqual(first.memory);
    const newer = readDetection(state(iso(now + 2000), { event_type: 'vehicle', id: 'd' }), { ...event, event_id_attr: 'id' }, now + 2000, first.memory);
    expect(newer.observedAt).toBe(now + 2000); expect(newer.eventKey).not.toBe(first.eventKey);
  });
  it('filters event types without creating a parked-car claim, and retains only an earlier unexpired accepted event', () => {
    const wrong = state(iso(now), { event_type: 'person' });
    expect(readDetection(wrong, event, now)).toMatchObject({ status: 'clear', active: false, memory: {} });
    const prior = readDetection(state(iso(now - 1000), { event_type: 'vehicle' }), event, now);
    expect(readDetection(wrong, event, now, prior.memory).expiresAt).toBe(prior.expiresAt);
  });
  it('unavailability/restoration hides the detection without mutating or renewing prior memory', () => {
    const prior = readDetection(state(iso(now), { event_type: 'vehicle' }), event, now);
    for (const source of [null, state('unavailable'), state(iso(now), { event_type: 'vehicle', restored: true })]) {
      const result = readDetection(source, event, now + 1, prior.memory);
      expect(result.active).toBe(false); expect(result.nextExpiry).toBeNull(); expect(result.memory).toEqual(prior.memory);
    }
  });
  it('requires a mandatory positive TTL, an actual timestamp and a configured event ID', () => {
    const source = state(iso(now), { event_type: 'vehicle' });
    for (const expires_seconds of [undefined, 0, -1, true, ''])
      expect(readDetection(source, { kind: 'event', expires_seconds }, now).status).toBe('invalid');
    expect(readDetection(state('on'), event, now).status).toBe('invalid');
    expect(readDetection(source, { ...event, event_id_attr: 'id' }, now).status).toBe('invalid');
    expect(readDetection(state(iso(now), { event_type: 'vehicle', id: Infinity }), { ...event, event_id_attr: 'id' }, now).status).toBe('invalid');
  });
});
