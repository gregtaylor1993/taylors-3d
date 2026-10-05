// Pure opt-in idle policy and lifecycle. Root owns the camera, CSS and its existing
// RAF. This module creates no timer, observer, DOM object, renderer or HA action.
export const AMBIENT_IDLE_LIMITS = Object.freeze({ idleSeconds: Object.freeze([1, 86400]), degreesPerSecond: Object.freeze([0, 6]), brightness: Object.freeze([0.1, 1]), frameDeltaMs: 50 });
export const AMBIENT_IDLE_DEFAULTS = Object.freeze({ enabled: false, idle_seconds: 120, rotate: true,
  rotation_degrees_per_second: 0.5, dim: Object.freeze({ enabled: false, brightness: 0.65,
    when: 'sun', start: '22:00', end: '07:00' }) });

const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const range = (value, limits) => finite(value) && value >= limits[0] && value <= limits[1];
const own = (value, key) => Object.hasOwn(value, key);
const issue = (code, message) => ({ code, message });
const time = (value) => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const normalized = new WeakMap();
const unique = (diagnostics) => [...new Map(diagnostics.map((entry) => [entry.code, entry])).values()];
// Only deterministic time conversion is cached, never HA/source/policy evidence.
// Bound both caches across cards/zones. Every key contains the exact supplied HA
// zone; no environment-local zone or current clock is read anywhere in this core.
const zoneFormatters = new Map(), localMinutes = new Map();
const cachePut = (cache, key, value, limit) => { cache.set(key, value); if (cache.size > limit) cache.delete(cache.keys().next().value); return value; };

function localMinute(wallTime, timeZone) {
  const key = JSON.stringify([timeZone, Math.floor(wallTime / 60000)]), cached = localMinutes.get(key);
  if (cached && wallTime >= cached.from && wallTime < cached.until) return cached;
  let formatter = zoneFormatters.get(timeZone);
  if (formatter === undefined) {
    try { formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
    catch { formatter = null; }
    cachePut(zoneFormatters, timeZone, formatter, 8);
  }
  if (!formatter) return { minute: null, code: 'time_zone' };
  try {
    const parts = formatter.formatToParts(new Date(wallTime));
    const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
    const hour = part('hour'), minute = part('minute'), second = part('second');
    if (!range(hour, [0, 23]) || !range(minute, [0, 59]) || !range(second, [0, 59])) return { minute: null, code: 'clock' };
    // Most current zones align local/epoch minutes. Explicit bounds also handle
    // historical second-based offsets without reusing across a local boundary.
    const from = Math.floor(wallTime / 1000) * 1000 - second * 1000;
    return cachePut(localMinutes, key, { minute: hour * 60 + minute, from, until: from + 60000 }, 16);
  } catch { return { minute: null, code: 'clock' }; }
}

/** Known fields normalize, unknown fields survive, and input is never mutated.
 * A malformed present value produces diagnostics and disables runtime effects.
 * Omitted dim.when defaults to actual sun; quiet hours are half-open [start,end).
 */
export function readAmbientIdle(value) {
  const result = { ...AMBIENT_IDLE_DEFAULTS, dim: { ...AMBIENT_IDLE_DEFAULTS.dim }, valid: true, diagnostics: [] };
  if (value === undefined) { normalized.set(result, []); return result; }
  if (!plain(value)) {
    result.valid = false; result.diagnostics = [issue('settings', 'Ambient idle settings must be an object.')];
    normalized.set(result, result.diagnostics.slice()); return result;
  }
  const out = { ...value, ...result };
  for (const field of ['enabled', 'rotate']) {
    if (!own(value, field)) continue;
    if (typeof value[field] === 'boolean') out[field] = value[field];
    else out.diagnostics.push(issue(field, `${field === 'enabled' ? 'Ambient idle' : 'Idle rotation'} must be explicitly enabled or disabled.`));
  }
  for (const [field, limits, label] of [
    ['idle_seconds', AMBIENT_IDLE_LIMITS.idleSeconds, 'Idle delay'],
    ['rotation_degrees_per_second', AMBIENT_IDLE_LIMITS.degreesPerSecond, 'Rotation speed'],
  ]) {
    if (!own(value, field)) continue;
    if (range(value[field], limits)) out[field] = value[field];
    else out.diagnostics.push(issue(field, `${label} must be a finite number from ${limits[0]} to ${limits[1]}.`));
  }
  if (own(value, 'dim')) {
    if (!plain(value.dim)) out.diagnostics.push(issue('dim', 'Idle dimming settings must be an object.'));
    else {
      const raw = value.dim;
      out.dim = { ...raw, ...result.dim };
      if (own(raw, 'enabled')) {
        if (typeof raw.enabled === 'boolean') out.dim.enabled = raw.enabled;
        else out.diagnostics.push(issue('dim.enabled', 'Idle dimming must be explicitly enabled or disabled.'));
      }
      if (own(raw, 'brightness')) {
        if (range(raw.brightness, AMBIENT_IDLE_LIMITS.brightness)) out.dim.brightness = raw.brightness;
        else out.diagnostics.push(issue('dim.brightness', 'Card brightness must be a finite number from 0.1 to 1.'));
      }
      if (own(raw, 'when')) {
        if (['sun', 'quiet_hours', 'sun_or_quiet_hours'].includes(raw.when)) out.dim.when = raw.when;
        else out.diagnostics.push(issue('dim.when', 'Choose actual sun, quiet hours or either condition.'));
      }
      for (const field of ['start', 'end']) {
        if (!own(raw, field)) continue;
        if (time(raw[field])) out.dim[field] = raw[field];
        else out.diagnostics.push(issue(`dim.${field}`, 'Quiet hours need exact 24-hour HH:mm times.'));
      }
      if (out.dim.start === out.dim.end) out.diagnostics.push(issue('dim.hours', 'Quiet hours must have different start and end times.'));
    }
  }
  // A normalized invalid policy must not become valid when the root passes it
  // back to this core: its original malformed known fields were already replaced.
  out.diagnostics = unique([...out.diagnostics, ...(normalized.get(value) || [])]);
  out.valid = out.diagnostics.length === 0;
  normalized.set(out, out.diagnostics.slice());
  return out;
}

function quietHours(policy, wallTime, timeZone) {
  const fail = (code, message) => ({ status: 'invalid', active: false, minute: null, diagnostics: [issue(code, message)] });
  if (!finite(wallTime) || Math.abs(wallTime) > 8640000000000000) return fail('clock', 'Quiet hours need an explicit valid current wall-clock timestamp.');
  if (typeof timeZone !== 'string' || !timeZone || timeZone !== timeZone.trim() || /^[+-]/.test(timeZone)) {
    return fail('time_zone', 'Quiet hours need Home Assistant’s explicit IANA time zone.');
  }
  const reading = localMinute(wallTime, timeZone);
  if (reading.code === 'time_zone') return fail('time_zone', 'Home Assistant’s time zone is invalid. No substitute time zone was chosen.');
  if (reading.code) return fail('clock', 'Home Assistant’s local quiet-hours time could not be read.');
  const local = reading.minute, start = minutes(policy.dim.start), end = minutes(policy.dim.end);
  const active = start < end ? local >= start && local < end : local >= start || local < end;
  return { status: 'ready', active, minute: local, diagnostics: [] };
}

/** Sources are explicit: root passes readSunState readiness + nightFactor(actual
 * elevation), epoch wallTime and hass.config.time_zone. This never reads hass or
 * guesses night from a manual sky/theme. Missing OR sources remain independently
 * unknown; a trusted quiet-hours condition can still dim while sun is unavailable.
 * CSS brightness affects this card's picture, never a physical screen backlight.
 */
export function readAmbientDim(value, { sun, wallTime, timeZone } = {}) {
  const policy = readAmbientIdle(value);
  const result = { brightness: 1, factor: 0, reason: 'off', sun: { status: 'unused', factor: 0 },
    quietHours: { status: 'unused', active: false, minute: null }, valid: policy.valid, diagnostics: policy.diagnostics.slice() };
  if (!policy.valid) return { ...result, reason: 'invalid' };
  if (!policy.enabled || !policy.dim.enabled) return result;
  if (policy.dim.when !== 'quiet_hours') {
    if (sun?.status === 'ready' && range(sun.nightFactor, [0, 1])) result.sun = { status: 'ready', factor: sun.nightFactor };
    else {
      result.sun = { status: 'unavailable', factor: 0 };
      result.diagnostics.push(issue('sun', 'Wait for an actual current sun reading before dimming by night.'));
    }
  }
  if (policy.dim.when !== 'sun') {
    const reading = quietHours(policy, wallTime, timeZone);
    result.quietHours = { status: reading.status, active: reading.active, minute: reading.minute };
    result.diagnostics.push(...reading.diagnostics);
  }
  const sunFactor = result.sun.factor, quietFactor = Number(result.quietHours.active);
  result.factor = Math.max(sunFactor, quietFactor);
  result.brightness = 1 - (1 - policy.dim.brightness) * result.factor;
  result.reason = quietFactor ? sunFactor > 0 ? 'sun_or_quiet_hours' : 'quiet_hours' : sunFactor > 0 ? 'sun' : 'day';
  result.valid = result.diagnostics.length === 0;
  return result;
}

const policyKey = (policy) => JSON.stringify([policy.valid, policy.enabled, policy.idle_seconds, policy.rotate,
  policy.rotation_degrees_per_second, policy.dim.enabled, policy.dim.brightness, policy.dim.when, policy.dim.start, policy.dim.end]);

/** getContext(): {policy,eligible,generation,reducedMotion?,sun?,wallTime?,timeZone?}
 * generation is a stable root-owned model/layout/view identity, never a new object
 * per HA update. Root derives eligible from every visibility/editor/popup/alert/
 * gesture/flight/section guard. tick(now) uses its existing RAF performance.now().
 * activity(now) is synchronous BEFORE a real user gesture; HA updates only call
 * revalidate(now). Root callbacks own exact raw camera capture/restore:
 * onBegin({token,generation,now,policy}) may return false to reject the session;
 * onAdvance({token,generation,now,deltaSeconds,degrees}) returns camera-changed bool;
 * onEnd({token,generation,now,reason,restore}) returns camera-changed bool. Root must
 * still verify token/generation before restoring; restore:false discards old-model
 * baseline. onDim({brightness,factor,reason,token,generation,diagnostics}) is CSS-only.
 * tick returns cameraChanged separately from dimChanged: CSS must not dirty WebGL.
 */
export class AmbientIdleController {
  constructor({ getContext, onBegin = () => true, onAdvance = () => false, onEnd = () => false, onDim = () => {} } = {}) {
    this._getContext = getContext; this._onBegin = onBegin; this._onAdvance = onAdvance; this._onEnd = onEnd; this._onDim = onDim;
    this._lastTime = null; this._armedAt = null; this._lastFrame = null; this._session = null; this._context = null;
    this._brightness = 1; this._disposed = false; this._serial = 0; this._revision = 0; this._status = 'waiting'; this._diagnostics = []; this._callbackDepth = 0;
  }
  get active() { return this._session ? { ...this._session } : null; }
  get state() {
    return { status: this._status, active: !!this._session, token: this._session?.token || null,
      generation: this._context?.generation, idleAt: this._armedAt,
      deadline: this._armedAt === null || !this._context?.eligible ? null : this._armedAt + this._context.policy.idle_seconds * 1000,
      brightness: this._brightness, diagnostics: this._diagnostics.slice() };
  }
  _result(revision, changes) { return { changed: this._revision !== revision, ...changes, ...this.state }; }
  _invoke(callback, reading) {
    this._callbackDepth++;
    try { return callback(reading); } finally { this._callbackDepth--; }
  }
  _clock(now, changes) {
    if (finite(now) && now >= 0 && (this._lastTime === null || now >= this._lastTime)) { this._lastTime = now; return true; }
    this._end(this._lastTime ?? 0, 'clock', true, changes); this._dim(1, { reason: 'clock' }, changes);
    this._armedAt = null; this._status = 'invalid'; this._diagnostics = [issue('monotonic_clock', 'Idle mode needs a nondecreasing finite performance timestamp.')];
    return false;
  }
  _end(now, reason, restore, changes) {
    const session = this._session;
    if (!session) return;
    this._session = null; this._lastFrame = null; this._revision++;
    // Even disposal/bad-clock paths must consult the current generation before
    // asking root to restore. Root still checks its own token/current model too.
    try { restore = restore && this._getContext?.()?.generation === session.generation; } catch { restore = false; }
    try { changes.cameraChanged = this._invoke(this._onEnd, { ...session, now, reason, restore }) === true || changes.cameraChanged; }
    catch { this._diagnostics.push(issue('end', 'Idle camera restoration could not be completed.')); }
  }
  _dim(brightness, reading, changes) {
    if (brightness === this._brightness) return;
    this._brightness = brightness; changes.dimChanged = true; this._revision++;
    try { this._invoke(this._onDim, { ...reading, brightness, token: this._session?.token || null, generation: this._context?.generation, diagnostics: reading.diagnostics || [] }); }
    catch { this._diagnostics.push(issue('dim', 'Idle card dimming could not be applied.')); }
  }
  _sync(now, changes) {
    let raw;
    try { raw = this._getContext?.(); } catch { raw = null; }
    const policy = readAmbientIdle(raw?.policy), generationValid = raw?.generation !== undefined && raw?.generation !== null;
    const eligible = plain(raw) && raw.eligible === true && raw.reducedMotion !== true && generationValid && policy.valid && policy.enabled
      && (policy.rotate && policy.rotation_degrees_per_second > 0 || policy.dim.enabled);
    const context = { ...raw, policy, eligible, key: policyKey(policy) }, previous = this._context;
    const generationChanged = previous && previous.generation !== context.generation;
    const changed = !previous || generationChanged || previous.key !== context.key || previous.eligible !== eligible;
    this._context = context; this._diagnostics = policy.diagnostics.slice();
    if (!plain(raw) || !generationValid) this._diagnostics.push(issue('context', 'Idle mode needs an explicit stable root context generation.'));
    if (changed) {
      this._end(now, generationChanged ? 'generation' : !eligible ? 'blocked' : 'policy', !generationChanged, changes);
      this._dim(1, { reason: 'reset' }, changes); this._armedAt = eligible ? now : null; this._revision++;
    }
    if (!eligible) {
      this._end(now, 'blocked', true, changes); this._dim(1, { reason: 'blocked' }, changes); this._armedAt = null;
      this._status = !policy.valid || !plain(raw) || !generationValid ? 'invalid' : !policy.enabled ? 'disabled' : 'blocked';
    } else {
      if (this._armedAt === null) this._armedAt = now;
      this._status = this._session ? 'idle' : 'waiting';
      if (this._session) this._applyDim(changes);
    }
    return context;
  }
  _applyDim(changes) {
    const reading = readAmbientDim(this._context.policy, this._context);
    this._diagnostics.push(...reading.diagnostics);
    this._dim(reading.brightness, reading, changes);
  }
  revalidate(now) {
    const revision = this._revision, changes = { cameraChanged: false, dimChanged: false };
    if (!this._disposed && this._clock(now, changes)) this._sync(now, changes);
    return this._result(revision, changes);
  }
  activity(now) {
    const revision = this._revision, changes = { cameraChanged: false, dimChanged: false };
    if (!this._disposed && this._clock(now, changes)) {
      const context = this._sync(now, changes);
      this._end(now, 'activity', true, changes); this._dim(1, { reason: 'activity' }, changes);
      this._armedAt = context.eligible ? now : null; this._status = context.eligible ? 'waiting' : this._status;
    }
    return this._result(revision, changes);
  }
  suspend(now, reason = 'suspended') {
    const revision = this._revision, changes = { cameraChanged: false, dimChanged: false };
    if (!this._disposed && this._clock(now, changes)) {
      this._sync(now, changes); this._end(now, reason, true, changes); this._dim(1, { reason }, changes);
      this._armedAt = null; this._status = 'blocked';
    }
    return this._result(revision, changes);
  }
  tick(now) {
    const revision = this._revision, changes = { cameraChanged: false, dimChanged: false };
    if (this._disposed || this._callbackDepth || !this._clock(now, changes)) return this._result(revision, changes);
    const context = this._sync(now, changes);
    if (!context.eligible) return this._result(revision, changes);
    if (!this._session && now - this._armedAt >= context.policy.idle_seconds * 1000) {
      const session = { token: Object.freeze({ id: ++this._serial }), generation: context.generation };
      this._session = session; this._lastFrame = now; this._revision++;
      let accepted = false;
      try { accepted = this._invoke(this._onBegin, { ...session, now, policy: context.policy }) !== false; }
      catch { this._diagnostics.push(issue('begin', 'Idle camera mode could not begin.')); }
      if (!accepted && this._session === session) { this._end(now, 'rejected', true, changes); this._armedAt = now; }
      if (this._session === session) { this._status = 'idle'; this._applyDim(changes); }
    }
    const session = this._session;
    if (session) {
      const deltaSeconds = Math.min(AMBIENT_IDLE_LIMITS.frameDeltaMs, Math.max(0, now - this._lastFrame)) / 1000;
      this._lastFrame = now;
      if (context.policy.rotate && context.policy.rotation_degrees_per_second > 0 && deltaSeconds > 0) {
        try {
          changes.cameraChanged = this._invoke(this._onAdvance, { ...session, now, deltaSeconds,
            degrees: context.policy.rotation_degrees_per_second * deltaSeconds }) === true || changes.cameraChanged;
        } catch {
          this._end(now, 'advance', true, changes); this._dim(1, { reason: 'advance' }, changes); this._armedAt = now; this._status = 'waiting';
          this._diagnostics.push(issue('advance', 'Idle camera movement could not be completed.'));
        }
      }
    }
    return this._result(revision, changes);
  }
  dispose(now = this._lastTime ?? 0) {
    if (this._disposed) return;
    this._disposed = true;
    const changes = { cameraChanged: false, dimChanged: false };
    this._end(finite(now) ? now : this._lastTime ?? 0, 'disposed', true, changes);
    this._dim(1, { reason: 'disposed' }, changes); this._armedAt = null; this._status = 'disposed';
  }
}
