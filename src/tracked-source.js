// Pure readers for measured tracking data. No timers, requests, storage or guessed locations.
// Coordinate cfg: source, x_attr/y_attr (dot paths), units, plan_meters, calibration, north_up.
// Timestamp cfg: timestamp_mode, timestamp_attr, timestamp_format, max_age_seconds.
// Detection cfg: kind, active_states/clear_states, timestamp options, expires_seconds,
// event_types/event_type_attr/event_id_attr and optional nested freshness. Times are UTC ms.

const EARTH = 6378137;
const UNITS = Object.freeze({ m: 1, cm: .01, mm: .001 });
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const diagnostic = (code, message) => ({ code, message });
const number = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())) return null;
  const n = Number(v.trim()); return Number.isFinite(n) ? n : null;
};
const pair = (v) => {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const p = v.map(number); return p.every((n) => n !== null) ? p : null;
};
const attr = (state, path) => {
  if (typeof path !== 'string' || !path || path.split('.').some((part) => !part)) return undefined;
  let value = state?.attributes;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
};
const availability = (state) => {
  if (!plain(state)) return { status: 'missing', diagnostics: [diagnostic('missing', 'Entity is not available in Home Assistant.')] };
  if (state.state === 'unknown' || state.state === 'unavailable' || state.attributes?.restored === true)
    return { status: 'unavailable', diagnostics: [diagnostic('unavailable', 'A current reading is not available.')] };
  if (typeof state.state !== 'string' || !state.state.trim())
    return { status: 'invalid', diagnostics: [diagnostic('state', 'Entity state is not valid.')] };
  return null;
};
const gps = (p) => p && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

// Read raw evidence, including before calibration exists. compileCalibration establishes
// whether that evidence can safely be placed on the plan; raw XY is never implicitly metres.
export function readCoordinate(state, cfg = {}) {
  cfg = plain(cfg) ? cfg : {};
  const kind = cfg.source || 'xy';
  const base = { kind, raw: null, diagnostics: [] };
  const unavailable = availability(state);
  if (unavailable) return { ...base, ...unavailable };
  if (!['xy', 'gps'].includes(kind)) return { ...base, status: 'invalid', diagnostics: [diagnostic('source', 'Choose XY or GPS coordinates.')] };
  const raw = kind === 'xy'
    ? pair([attr(state, cfg.x_attr || 'x'), attr(state, cfg.y_attr || 'y')])
    : pair([attr(state, cfg.latitude_attr || 'latitude'), attr(state, cfg.longitude_attr || 'longitude')]);
  if (!raw || (kind === 'gps' && !gps(raw))) return { ...base, status: 'invalid', diagnostics: [diagnostic('coordinate', kind === 'gps'
    ? 'GPS must contain a latitude from -90 to 90 and longitude from -180 to 180.' : 'Both coordinate attributes must be finite numbers.')] };
  return { ...base, status: 'ready', raw };
}

const invalidCalibration = (code, message) => ({ status: 'invalid', method: null, residual: null, transform: null,
  diagnostics: [diagnostic(code, message)] });

export function compileCalibration(cfg = {}) {
  cfg = plain(cfg) ? cfg : {};
  const kind = cfg.source || 'xy', scale = UNITS[cfg.units];
  if (!['xy', 'gps'].includes(kind)) return invalidCalibration('source', 'Choose XY or GPS coordinates.');
  if (kind === 'xy' && cfg.units !== undefined && !Object.hasOwn(UNITS, cfg.units)) return invalidCalibration('units', 'Choose metres, centimetres or millimetres.');
  if (cfg.calibration !== undefined && !Array.isArray(cfg.calibration)) return invalidCalibration('calibration', 'Calibration must be a list of source and plan points.');
  const points = (cfg.calibration || []).map((p) => ({ src: pair(p?.src), plan: pair(p?.plan) }));
  if (points.some((p) => !p.src || !p.plan || (kind === 'gps' && !gps(p.src)))) return invalidCalibration('calibration', 'Every calibration point needs valid source and plan coordinates.');
  if (!points.length && (kind !== 'xy' || cfg.plan_meters !== true || scale === undefined))
    return invalidCalibration('frame', 'Declare plan coordinates and units, or add calibration points.');
  if (points.length === 1 && ((kind === 'xy' && scale === undefined) || (kind === 'gps' && cfg.north_up !== true)))
    return invalidCalibration('frame', 'One point needs known XY units or an explicitly north-up GPS plan.');

  const origin = points[0]?.src;
  const project = (raw) => {
    const p = pair(raw);
    if (!p || (kind === 'gps' && !gps(p))) return null;
    if (kind === 'xy') return p.map((n) => n * (scale ?? 1));
    const longitude = ((p[1] - origin[1] + 540) % 360) - 180;
    return [longitude * Math.PI / 180 * EARTH * Math.cos(origin[0] * Math.PI / 180),
      (p[0] - origin[0]) * Math.PI / 180 * EARTH];
  };
  const samples = points.map((p) => ({ src: project(p.src), plan: p.plan }));
  if (samples.some((p) => !p.src.every(Number.isFinite))) return invalidCalibration('range', 'Calibration exceeds the supported coordinate range.');
  let method, apply;
  if (!samples.length) { method = 'identity'; apply = (p) => p; }
  else if (samples.length === 1) {
    method = 'translation'; const p = samples[0];
    apply = ([u, v]) => [u - p.src[0] + p.plan[0], v - p.src[1] + p.plan[1]];
  } else {
    const srcCenter = [0, 1].map((axis) => samples.reduce((sum, p) => sum + p.src[axis] / samples.length, 0));
    const dstCenter = [0, 1].map((axis) => samples.reduce((sum, p) => sum + p.plan[axis] / samples.length, 0));
    const extent = Math.max(...samples.map((p) => Math.hypot(p.src[0] - srcCenter[0], p.src[1] - srcCenter[1])));
    if (!Number.isFinite(extent) || extent <= 1e-9) return invalidCalibration('degenerate', 'Calibration source points need a measurable separation.');
    const normalized = samples.map((p) => ({ s: p.src.map((n, axis) => (n - srcCenter[axis]) / extent),
      d: p.plan.map((n, axis) => n - dstCenter[axis]) }));
    for (let i = 0; i < normalized.length; i++) for (let j = i + 1; j < normalized.length; j++) {
      if (Math.hypot(normalized[i].s[0] - normalized[j].s[0], normalized[i].s[1] - normalized[j].s[1]) < 1e-8)
        return invalidCalibration('duplicate', 'Calibration source points must be distinct.');
    }
    let a, b, c, d;
    if (samples.length === 2) {
      method = 'similarity';
      const [p, q] = normalized, u = q.s[0] - p.s[0], v = q.s[1] - p.s[1];
      const x = q.d[0] - p.d[0], y = q.d[1] - p.d[1], den = u * u + v * v;
      a = d = (x * u + y * v) / den; c = (y * u - x * v) / den; b = -c;
    } else {
      method = 'affine';
      let uu = 0, uv = 0, vv = 0, ux = 0, vx = 0, uy = 0, vy = 0;
      for (const p of normalized) {
        uu += p.s[0] ** 2; uv += p.s[0] * p.s[1]; vv += p.s[1] ** 2;
        ux += p.s[0] * p.d[0]; vx += p.s[1] * p.d[0]; uy += p.s[0] * p.d[1]; vy += p.s[1] * p.d[1];
      }
      const det = uu * vv - uv * uv, trace = uu + vv;
      if (!Number.isFinite(det) || det <= trace * trace * 1e-10) return invalidCalibration('condition', 'Spread calibration points across the map; a line or near-line cannot establish an affine fit.');
      a = (ux * vv - vx * uv) / det; b = (vx * uu - ux * uv) / det;
      c = (uy * vv - vy * uv) / det; d = (vy * uu - uy * uv) / det;
    }
    const norm = a * a + b * b + c * c + d * d;
    if (![a, b, c, d, norm].every(Number.isFinite) || norm <= 1e-18 || Math.abs(a * d - b * c) <= norm * 1e-10)
      return invalidCalibration('collapsed', 'Calibration plan points must establish a noncollapsed two-dimensional map.');
    apply = ([u, v]) => {
      const x = (u - srcCenter[0]) / extent, y = (v - srcCenter[1]) / extent;
      return [a * x + b * y + dstCenter[0], c * x + d * y + dstCenter[1]];
    };
  }
  const transform = (reading) => {
    if (!reading || (reading.status !== undefined && reading.status !== 'ready') || (reading.kind && reading.kind !== kind)) return null;
    const projected = project(Array.isArray(reading) ? reading : reading.raw);
    if (!projected) return null;
    const result = apply(projected); return result.every(Number.isFinite) ? result : null;
  };
  const errors = samples.map((p) => {
    const fitted = apply(p.src); return Math.hypot(fitted[0] - p.plan[0], fitted[1] - p.plan[1]);
  });
  const residual = errors.length ? Math.hypot(...errors) / Math.sqrt(errors.length) : 0;
  if (!Number.isFinite(residual)) return invalidCalibration('range', 'Calibration exceeds the supported numeric range.');
  return { status: 'ready', method, residual, transform, diagnostics: [] };
}

function timestamp(state, cfg) {
  const mode = cfg.timestamp_mode;
  const value = mode === 'state' ? state?.state : mode === 'attribute' ? attr(state, cfg.timestamp_attr)
    : mode === 'last_updated' || mode === 'last_changed' ? state?.[mode] : undefined;
  if (!['state', 'attribute', 'last_updated', 'last_changed'].includes(mode)) return null;
  const format = cfg.timestamp_format || 'iso';
  if (format === 'seconds' || format === 'milliseconds') {
    const n = number(value); if (n === null) return null;
    const ms = n * (format === 'seconds' ? 1000 : 1); return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }
  // Require a time zone rather than accepting browser-local or permissive Date.parse strings.
  if (format !== 'iso' || typeof value !== 'string') return null;
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.parse(value); return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

// Unchanged sustained HA states are current, not a heartbeat. Timestamp-based age checks
// are used only when explicitly configured. A browser update never becomes observedAt.
export function readFreshness(state, cfg = {}, nowMs) {
  const validConfig = plain(cfg) && [Object.prototype, null].includes(Object.getPrototypeOf(cfg));
  const base = { basis: validConfig && cfg.timestamp_mode || 'current', observedAt: null, expiresAt: null, nextExpiry: null, verified: false, diagnostics: [] };
  if (!validConfig) return { ...base, status: 'invalid', diagnostics: [diagnostic('freshness', 'Source freshness settings must be an object with explicit timestamp options.')] };
  const unavailable = availability(state);
  if (unavailable) return { ...base, ...unavailable };
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || nowMs < 0) return { ...base, status: 'invalid', diagnostics: [diagnostic('time', 'A valid current UTC time is required.')] };
  if (!cfg.timestamp_mode) {
    if (cfg.max_age_seconds !== undefined) return { ...base, status: 'invalid', diagnostics: [diagnostic('timestamp', 'Choose the measurement timestamp or heartbeat before setting a maximum age.')] };
    return { ...base, status: 'current' };
  }
  const observedAt = timestamp(state, cfg), maxAge = number(cfg.max_age_seconds);
  if (observedAt === null || observedAt > nowMs) return { ...base, status: 'invalid', diagnostics: [diagnostic('timestamp', 'The source needs a valid timestamp that is not in the future.')] };
  if (cfg.max_age_seconds !== undefined && (maxAge === null || maxAge <= 0)) return { ...base, observedAt, status: 'invalid', diagnostics: [diagnostic('age', 'Maximum age must be a positive number of seconds.')] };
  const expiresAt = maxAge === null ? null : observedAt + maxAge * 1000;
  if (expiresAt !== null && !Number.isFinite(expiresAt)) return { ...base, observedAt, status: 'invalid', diagnostics: [diagnostic('age', 'Maximum age exceeds the supported time range.')] };
  return { ...base, observedAt, expiresAt, verified: expiresAt !== null, nextExpiry: expiresAt !== null && expiresAt > nowMs ? expiresAt : null,
    status: expiresAt !== null && expiresAt <= nowMs ? 'stale' : 'ready',
    diagnostics: expiresAt !== null && expiresAt <= nowMs ? [diagnostic('stale', 'The source reading has expired.')] : [] };
}

// Event memory is session-only and returned immutably. Absolute timestamps ensure that
// reloads, duplicate snapshots and out-of-order events cannot renew the same detection.
export function readDetection(state, cfg = {}, nowMs, previous = {}) {
  cfg = plain(cfg) ? cfg : {};
  const memory = plain(previous) ? { ...previous } : {};
  const kind = cfg.kind || 'occupancy';
  const base = { kind, active: false, count: null, eventKey: null, observedAt: null, expiresAt: null, nextExpiry: null, memory, diagnostics: [] };
  const unavailable = availability(state);
  if (unavailable) return { ...base, ...unavailable };
  if (!['occupancy', 'count', 'event'].includes(kind)) return { ...base, status: 'invalid', diagnostics: [diagnostic('kind', 'Choose occupancy, count or an expiring detection event.')] };
  const freshness = readFreshness(state, cfg.freshness, nowMs);
  if (!['current', 'ready'].includes(freshness.status)) return { ...base, ...freshness, kind, memory };
  if (kind !== 'event') {
    if (kind === 'count') {
      const count = number(cfg.count_attr ? attr(state, cfg.count_attr) : state.state);
      if (count === null || !Number.isSafeInteger(count) || count < 0) return { ...base, status: 'invalid', diagnostics: [diagnostic('count', 'Vehicle count must be a nonnegative whole number.')] };
      return { ...base, status: 'ready', active: count > 0, count, observedAt: freshness.observedAt, expiresAt: freshness.expiresAt, nextExpiry: freshness.nextExpiry };
    }
    const active = cfg.active_states || ['on'], clear = cfg.clear_states || ['off'];
    const valid = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.trim());
    if (!valid(active) || !valid(clear) || active.some((s) => clear.includes(s))) return { ...base, status: 'invalid', diagnostics: [diagnostic('states', 'Choose separate active and clear states.')] };
    if (![...active, ...clear].includes(state.state)) return { ...base, status: 'invalid', diagnostics: [diagnostic('state', 'The source does not report a configured active or clear state.')] };
    return { ...base, status: 'ready', active: active.includes(state.state), observedAt: freshness.observedAt, expiresAt: freshness.expiresAt, nextExpiry: freshness.nextExpiry };
  }
  const ttl = number(cfg.expires_seconds);
  if (ttl === null || ttl <= 0) return { ...base, status: 'invalid', diagnostics: [diagnostic('expiry', 'Detection events require a positive expiry in seconds.')] };
  const clock = readFreshness(state, { timestamp_mode: cfg.timestamp_mode || 'state', timestamp_attr: cfg.timestamp_attr,
    timestamp_format: cfg.timestamp_format, max_age_seconds: ttl }, nowMs);
  if (!['ready', 'stale'].includes(clock.status)) return { ...base, ...clock, kind, memory };
  const types = cfg.event_types;
  if (types !== undefined && (!Array.isArray(types) || !types.length || !types.every((v) => typeof v === 'string' && v.trim())))
    return { ...base, status: 'invalid', diagnostics: [diagnostic('event_type', 'Choose the accepted event types.')] };
  const eventType = attr(state, cfg.event_type_attr || 'event_type');
  const accepted = types === undefined || types.includes(eventType);
  const eventId = cfg.event_id_attr ? attr(state, cfg.event_id_attr) : null;
  if (cfg.event_id_attr && ((typeof eventId !== 'string' && typeof eventId !== 'number') || !String(eventId).trim()
    || (typeof eventId === 'number' && !Number.isFinite(eventId))))
    return { ...base, status: 'invalid', diagnostics: [diagnostic('event_id', 'The configured event identifier is missing.')] };
  const eventKey = JSON.stringify([clock.observedAt, eventId === null ? null : String(eventId)]);
  const priorAt = typeof memory.observedAt === 'number' && Number.isFinite(memory.observedAt) ? memory.observedAt : null;
  let nextMemory = memory;
  // Different metadata attached to an existing timestamp cannot reset its original deadline.
  if (accepted && (priorAt === null || clock.observedAt > priorAt)) nextMemory = { eventKey, observedAt: clock.observedAt, expiresAt: clock.expiresAt };
  const observedAt = nextMemory.observedAt ?? null, expiresAt = nextMemory.expiresAt ?? null;
  const active = typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > nowMs;
  const deadlines = [active ? expiresAt : null, freshness.nextExpiry].filter((value) => typeof value === 'number' && Number.isFinite(value) && value > nowMs);
  return { ...base, status: active ? 'ready' : 'clear', active, eventKey: nextMemory.eventKey ?? null, observedAt, expiresAt,
    nextExpiry: deadlines.length ? Math.min(...deadlines) : null, memory: nextMemory,
    diagnostics: clock.status === 'stale' && !active ? clock.diagnostics : [] };
}
