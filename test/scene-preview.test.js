import { describe, expect, it, vi } from 'vitest';
import { captureLightSnapshot, readScenePreviews, ScenePreviewController, sceneActivationAvailability, validateScenePreview } from '../src/scene-preview.js';

const rgbState = (state = 'on', attributes = {}) => ({ entity_id: 'light.main', state, attributes: {
  supported_color_modes: ['rgb', 'color_temp'], color_mode: 'rgb', brightness: 128, rgb_color: [255, 0, 0],
  min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, ...attributes } });
const target = (patch = {}) => ({ entity: 'light.main', state: 'on', brightness: 200, color: { mode: 'rgb', rgb: [0, 0, 255] }, ...patch });
const binding = (patch = {}) => ({ id: 'movie', label: 'Movie preview', scene_entity: 'scene.movie', lights: [target()], ...patch });
function connection() {
  const listeners = new Map();
  return { connected: true,
    addEventListener: vi.fn((type, callback) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); }),
    removeEventListener: vi.fn((type, callback) => listeners.get(type)?.delete(callback)),
    fire(type) { for (const callback of [...(listeners.get(type) || [])]) callback(); },
    count(type) { return listeners.get(type)?.size || 0; } };
}
function hassFixture() {
  return { user: { id: 'current-user', is_admin: true }, connection: connection(), services: { scene: { turn_on: {} } }, callService: vi.fn(async () => ({})),
    states: { 'scene.movie': { entity_id: 'scene.movie', state: 'unknown', attributes: { entity_id: ['light.unmapped'] } }, 'light.main': rgbState() },
    entities: {}, devices: {} };
}
const codes = (result) => result.diagnostics.map((diagnostic) => diagnostic.code);
const deep = (v) => JSON.parse(JSON.stringify(v));
function controllerFixture({ admin = true, enabled = true, lights } = {}) {
  const hass = hassFixture(); hass.user.is_admin = admin;
  let context = { hass, bindings: { enabled, items: [binding(lights === undefined ? {} : { lights })] }, contextKey: 'house:model:1', canEdit: admin };
  const previews = vi.fn(), statuses = vi.fn(), controller = new ScenePreviewController({ getContext: () => context, onPreview: previews, onStatus: statuses });
  return { hass, controller, previews, statuses, get context() { return context; }, set context(value) { context = value; } };
}

describe('opt-in explicit scene settings', () => {
  it('defaults disabled, retains unknown fields/items and never writes the input', () => {
    expect(readScenePreviews(undefined)).toEqual({ enabled: false, items: [], valid: true, diagnostics: [] });
    const item = Object.freeze(binding({ extension: { retained: true } })), settings = Object.freeze({ enabled: true, items: Object.freeze([item]), extension: { version: 7 } });
    const result = readScenePreviews(settings);
    expect(result).toMatchObject({ enabled: true, valid: true, extension: { version: 7 } }); expect(result.items).not.toBe(settings.items); expect(result.items[0]).toBe(item);
    expect(settings.items[0].extension.retained).toBe(true);
  });
  it.each([null, false, 'on', 1, []])('rejects malformed settings %j instead of opting in', (value) => {
    const result = readScenePreviews(value); expect(result.enabled).toBe(false); expect(result.valid).toBe(false); expect(codes(result)).toEqual(['settings']);
  });
  it('does not coerce enabled flags or silently discard malformed item arrays', () => {
    expect(readScenePreviews({ enabled: 'true', items: [] })).toMatchObject({ enabled: false, valid: false });
    expect(codes(readScenePreviews({ enabled: true, items: {} }))).toEqual(['items']);
  });
});

describe('exact stateless scene activation availability', () => {
  it.each(['unknown', '2026-10-05T11:30:00.123456+00:00'])('accepts genuine scene state %s for non-admin authenticated users', (state) => {
    const hass = hassFixture(); hass.user.is_admin = false; hass.states['scene.movie'].state = state;
    expect(sceneActivationAvailability(hass, 'scene.movie').available).toBe(true); expect(hass.callService).not.toHaveBeenCalled();
  });
  it.each([true, 'true', undefined, null, 0])('rejects restored/malformed present flags %j', (restored) => {
    const hass = hassFixture(); hass.states['scene.movie'].attributes.restored = restored;
    expect(sceneActivationAvailability(hass, 'scene.movie').available).toBe(false);
  });
  it.each(['unavailable', 'on', 'off', 'not-a-timestamp', ''])('rejects unavailable/malformed scene state %j', (state) => {
    const hass = hassFixture(); hass.states['scene.movie'].state = state;
    expect(sceneActivationAvailability(hass, 'scene.movie').available).toBe(false);
  });
  it.each(['hidden', 'disabled', 'category', 'device'])('honors current %s registry restrictions', (kind) => {
    const hass = hassFixture(); hass.entities['scene.movie'] = kind === 'hidden' ? { hidden_by: 'user' } : kind === 'disabled' ? { disabled_by: 'integration' }
      : kind === 'category' ? { entity_category: 'config' } : { device_id: 'bridge' };
    if (kind === 'device') hass.devices.bridge = { disabled_by: 'user' };
    expect(codes(sceneActivationAvailability(hass, 'scene.movie'))).toContain('metadata');
  });
  it('needs current source, correct domain/entity, user, connection, advertised service and callable action', () => {
    const cases = [
      (hass) => { delete hass.states['scene.movie']; },
      (hass) => { hass.states['scene.movie'].entity_id = 'scene.other'; },
      (hass) => { hass.states['scene.movie'].attributes = []; },
      (hass) => { hass.user.id = ''; },
      (hass) => { hass.user.is_active = false; },
      (hass) => { hass.connection.connected = false; },
      (hass) => { delete hass.services.scene.turn_on; },
      (hass) => { delete hass.callService; },
    ];
    for (const change of cases) { const hass = hassFixture(); change(hass); expect(sceneActivationAvailability(hass, 'scene.movie').available).toBe(false); }
    expect(sceneActivationAvailability(hassFixture(), 'switch.movie').available).toBe(false);
    expect(sceneActivationAvailability(hassFixture(), 'scene._movie').available).toBe(false);
  });
});

describe('pure renderer-only explicit light targets', () => {
  it('compiles a finite RGB preview without changing actual HA state, unknown fields or calling HA', () => {
    const hass = hassFixture(), saved = binding({ extension: { retained: true }, lights: [target({ extension: ['keep'] })] });
    const before = JSON.stringify([hass.states, saved]), state = hass.states['light.main'], rgb = state.attributes.rgb_color;
    const result = validateScenePreview(hass, saved), override = result.overrides.get('light.main');
    expect(result.valid).toBe(true); expect(override.desiredOn).toBe(true); expect(override.appearance).toMatchObject({ status: 'preview', level: 200 / 255, color: [0, 0, 255], colorSource: 'preview-rgb', output: 200 / 255 });
    expect(JSON.stringify([hass.states, saved])).toBe(before); expect(hass.states['light.main']).toBe(state); expect(state.attributes.rgb_color).toBe(rgb); expect(hass.callService).not.toHaveBeenCalled();
  });
  it('validates Kelvin against current exact bounds and returns finite approximate colour', () => {
    const hass = hassFixture(), warm = validateScenePreview(hass, binding({ lights: [target({ color: { mode: 'kelvin', kelvin: 2000 } })] }));
    const cool = validateScenePreview(hass, binding({ lights: [target({ color: { mode: 'kelvin', kelvin: 6500 } })] }));
    expect(warm.valid).toBe(true); expect(cool.valid).toBe(true);
    const a = warm.overrides.get('light.main').appearance, b = cool.overrides.get('light.main').appearance;
    expect(a.color.every(Number.isFinite)).toBe(true); expect(a.color[0] / Math.max(1, a.color[2])).toBeGreaterThan(b.color[0] / Math.max(1, b.color[2]));
    hass.states['light.main'].attributes.max_color_temp_kelvin = 5000;
    expect(validateScenePreview(hass, binding({ lights: [target({ color: { mode: 'kelvin', kelvin: 6500 } })] })).valid).toBe(false);
  });
  it('labels fixed non-colour fixture appearance and never claims a reported scene colour', () => {
    const hass = hassFixture(); hass.states['light.main'] = { entity_id: 'light.main', state: 'off', attributes: { supported_color_modes: ['onoff'] } };
    const result = validateScenePreview(hass, binding({ lights: [{ entity: 'light.main', state: 'on' }] }));
    expect(result.valid).toBe(true); expect(result.overrides.get('light.main').appearance).toMatchObject({ level: 1, colorSource: 'display-fallback', colorKnown: false });
    expect(codes(result.overrides.get('light.main').appearance)).toEqual(['display_fallback']);
  });
  it('uses an explicit off target as zero output, independent of stale off colour/brightness attributes', () => {
    const hass = hassFixture(); hass.states['light.main'] = rgbState('off', { brightness: -100, rgb_color: ['bad'] });
    const result = validateScenePreview(hass, binding({ lights: [{ entity: 'light.main', state: 'off' }] }));
    expect(result.valid).toBe(true); expect(result.overrides.get('light.main')).toMatchObject({ desiredOn: false, appearance: { level: 0, output: 0, color: [0, 0, 0], colorSource: 'preview-off' } });
  });
  it.each([undefined, null, true, '', '100', -1, 256, Infinity, NaN])('does not guess/coerce dimmable brightness %j', (brightness) => {
    const light = target({ brightness }); if (brightness === undefined) delete light.brightness;
    expect(validateScenePreview(hassFixture(), binding({ lights: [light] })).valid).toBe(false);
  });
  it.each([undefined, null, false, { mode: 'xy', xy: [.3, .3] }, { mode: 'rgb', rgb: [255, 0] }, { mode: 'rgb', rgb: [256, 0, 0] }, { mode: 'rgb', rgb: ['0', 0, 0] }, { mode: 'kelvin', kelvin: 1999 }, { mode: 'kelvin', kelvin: Infinity }])('rejects incomplete/unsupported colour %j', (color) => {
    const light = target({ color }); if (color === undefined) delete light.color;
    expect(validateScenePreview(hassFixture(), binding({ lights: [light] })).valid).toBe(false);
  });
  it('accepts HA-converted RGB control targets for native XY devices without guessing a gamut', () => {
    const hass = hassFixture(); hass.states['light.main'] = rgbState('on', { supported_color_modes: ['xy'], color_mode: 'xy', xy_color: [.3, .3] });
    expect(validateScenePreview(hass, binding()).valid).toBe(true);
    delete hass.states['light.main'].attributes.rgb_color;
    // An explicitly selected hypothetical RGB target is still supported. Capture
    // below refuses to invent a snapshot conversion from the missing report.
    expect(validateScenePreview(hass, binding()).valid).toBe(true);
    expect(captureLightSnapshot(hass, ['light.main']).valid).toBe(false);
  });
  it('requires capabilities for supplied appearance fields even on an off target', () => {
    const hass = hassFixture(); hass.states['light.main'].attributes.supported_color_modes = ['brightness'];
    expect(codes(validateScenePreview(hass, binding({ lights: [target({ state: 'off' })] })))).toContain('rgb_capability');
    hass.states['light.main'].attributes.supported_color_modes = ['onoff'];
    expect(codes(validateScenePreview(hass, binding({ lights: [target()] })))).toContain('brightness_capability');
  });
  it('fails closed across duplicate, unknown/missing/restored/hidden/disabled lights and never guesses a renamed ID', () => {
    const cases = [
      (hass, saved) => { saved.lights.push(target()); },
      (hass) => { hass.states['light.main'].state = 'unknown'; },
      (hass) => { hass.states['light.main'].attributes.restored = true; },
      (hass) => { hass.entities['light.main'] = { hidden: true }; },
      (hass) => { hass.entities['light.main'] = { disabled_by: 'user' }; },
      (hass) => { hass.entities['light.main'] = { entity_category: 'diagnostic' }; },
      (hass) => { hass.states['light.renamed'] = { ...hass.states['light.main'], entity_id: 'light.renamed' }; delete hass.states['light.main']; },
    ];
    for (const change of cases) { const hass = hassFixture(), saved = binding(); change(hass, saved); const result = validateScenePreview(hass, saved); expect(result.valid).toBe(false); expect(result.overrides.size).toBe(0); }
  });
  it('does not infer light settings from a scene entity member list or activation timestamp', () => {
    const hass = hassFixture(), result = validateScenePreview(hass, binding({ lights: [] }));
    expect(result.valid).toBe(false); expect(result.overrides.size).toBe(0); expect(codes(result)).toContain('lights');
  });
});

describe('explicit current-light snapshot capture', () => {
  it('captures actual on RGB/off values, labels snapshot provenance, preserves all source references', () => {
    const hass = hassFixture(); hass.states['light.off'] = { ...rgbState('off', { rgb_color: [1, 2, 3], brightness: 12 }), entity_id: 'light.off' };
    const before = JSON.stringify(hass.states), original = hass.states['light.main'].attributes.rgb_color;
    const result = captureLightSnapshot(hass, ['light.main', 'light.off'], { now: 1000 });
    expect(result).toEqual({ valid: true, lights: [{ entity: 'light.main', state: 'on', brightness: 128, color: { mode: 'rgb', rgb: [255, 0, 0] } }, { entity: 'light.off', state: 'off' }],
      captured_at: 1000, kind: 'current-light-snapshot', diagnostics: [] });
    result.lights[0].color.rgb[0] = 0;
    expect(hass.states['light.main'].attributes.rgb_color).toBe(original); expect(JSON.stringify(hass.states)).toBe(before); expect(hass.callService).not.toHaveBeenCalled();
  });
  it('captures current reported Kelvin rather than guessing from an RGB approximation', () => {
    const hass = hassFixture(); hass.states['light.main'] = rgbState('on', { color_mode: 'color_temp', color_temp_kelvin: 2700 });
    expect(captureLightSnapshot(hass, ['light.main']).lights[0].color).toEqual({ mode: 'kelvin', kelvin: 2700 });
  });
  it('allows current off or on/off-only fixtures without inventing brightness/color', () => {
    const hass = hassFixture(); hass.states['light.main'] = { entity_id: 'light.main', state: 'on', attributes: { supported_color_modes: ['onoff'], color_mode: 'onoff' } };
    expect(captureLightSnapshot(hass, ['light.main']).lights).toEqual([{ entity: 'light.main', state: 'on' }]);
  });
  it('refuses partial snapshots when one source is incomplete', () => {
    const hass = hassFixture(); hass.states['light.second'] = { ...rgbState('on', { brightness: undefined }), entity_id: 'light.second' };
    const result = captureLightSnapshot(hass, ['light.main', 'light.second']);
    expect(result.valid).toBe(false); expect(result.lights).toEqual([]); expect(codes(result)).toContain('snapshot_brightness');
  });
  it.each([false, undefined, 'true'])('requires actual admin permission %j for capture', (isAdmin) => {
    const hass = hassFixture(); hass.user.is_admin = isAdmin;
    expect(captureLightSnapshot(hass, ['light.main']).valid).toBe(false);
  });
  it('rejects disconnected/edit-denied/duplicate/invalid-time capture without a service action', () => {
    const hass = hassFixture(); hass.connection.connected = false;
    expect(captureLightSnapshot(hass, ['light.main']).valid).toBe(false); hass.connection.connected = true;
    expect(captureLightSnapshot(hass, ['light.main'], { canEdit: false }).valid).toBe(false);
    expect(captureLightSnapshot(hass, ['light.main', 'light.main']).valid).toBe(false);
    expect(captureLightSnapshot(hass, ['light.main'], { now: Infinity }).valid).toBe(false);
    expect(hass.callService).not.toHaveBeenCalled();
  });
});

describe('preview lifecycle and latest-context restoration', () => {
  it('allows saved read-only preview to a regular user and never calls a service', () => {
    const f = controllerFixture({ admin: false }), result = f.controller.preview('movie');
    expect(result.ok).toBe(true); expect(f.previews).toHaveBeenCalledOnce(); expect(f.previews.mock.calls[0][0]).toBeInstanceOf(Map);
    expect(f.controller.previewDraft(binding()).ok).toBe(false); expect(f.hass.callService).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it('requires enabled, unique current saved mapping IDs and exact scene addresses', () => {
    const f = controllerFixture({ enabled: false }); expect(f.controller.preview('movie').ok).toBe(false);
    f.context.bindings.enabled = true; expect(f.controller.preview('missing').ok).toBe(false);
    f.context.bindings.items.push(binding()); expect(f.controller.preview('movie').ok).toBe(false);
    f.context.bindings.items[1].id = 'duplicate-scene'; expect(f.controller.preview('movie').ok).toBe(false);
    expect(f.hass.callService).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it('preserves equal override/token across cloned states/names/timestamps without extra invalidation', () => {
    const f = controllerFixture(), result = f.controller.preview('movie');
    for (let i = 0; i < 5; i++) { f.hass.states = deep(f.hass.states); f.hass.states['light.main'].attributes.friendly_name = `Name ${i}`; expect(f.controller.revalidate().ok).toBe(true); expect(f.controller.preview('movie').token).toBe(result.token); }
    expect(f.previews).toHaveBeenCalledOnce(); expect(f.hass.connection.count('disconnected')).toBe(1); expect(f.hass.callService).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it('reverts to latest actual readings instead of restoring a captured real-state snapshot', () => {
    const f = controllerFixture(); f.controller.preview('movie');
    f.hass.states['light.main'] = rgbState('off'); expect(f.controller.revalidate().ok).toBe(true);
    const observed = []; f.controller.onPreview = (overrides) => observed.push({ overrides, state: f.context.hass.states['light.main'].state });
    expect(f.controller.stop()).toBe(true); expect(observed).toEqual([{ overrides: null, state: 'off' }]); expect(f.hass.states['light.main'].state).toBe('off'); f.controller.dispose();
  });
  it('keeps replacement preview intact when an obsolete hover/touch token stops', () => {
    const f = controllerFixture(), first = f.controller.preview('movie');
    f.context.bindings.items.push(binding({ id: 'reading', scene_entity: 'scene.reading', lights: [target({ color: { mode: 'rgb', rgb: [0, 255, 0] } })] }));
    f.hass.states['scene.reading'] = { entity_id: 'scene.reading', state: 'unknown', attributes: {} };
    const second = f.controller.preview('reading'); expect(second.ok).toBe(true); expect(second.token).not.toBe(first.token);
    expect(f.previews.mock.calls.map(([value]) => value === null)).toEqual([false, false]);
    expect(f.controller.stop(first.token)).toBe(false); expect(f.controller.active.itemId).toBe('reading');
    expect(f.controller.stop(second.token)).toBe(true); expect(f.hass.connection.count('disconnected')).toBe(0); f.controller.dispose();
  });
  it.each(['key', 'connection', 'user', 'disabled', 'removed', 'hidden', 'source', 'bounds', 'service'])('cancels stale preview on %s change and never revives it automatically', (kind) => {
    const f = controllerFixture(); f.controller.preview('movie');
    if (kind === 'key') f.context.contextKey = 'another-model';
    if (kind === 'connection') f.hass.connection = connection();
    if (kind === 'user') f.hass.user.id = 'another-user';
    if (kind === 'disabled') f.context.bindings.enabled = false;
    if (kind === 'removed') f.context.bindings.items = [];
    if (kind === 'hidden') f.hass.entities['light.main'] = { hidden_by: 'user' };
    if (kind === 'source') f.hass.states['light.main'].attributes.restored = true;
    if (kind === 'bounds') f.hass.states['light.main'].attributes.max_color_temp_kelvin = NaN;
    if (kind === 'service') delete f.hass.services.scene.turn_on;
    expect(f.controller.revalidate().ok).toBe(false); expect(f.controller.active).toBeNull(); expect(f.previews.mock.calls.at(-1)[0]).toBeNull();
    f.hass.connection.connected = true; expect(f.controller.revalidate().ok).toBe(false); expect(f.hass.callService).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it('clears on actual connection disconnection and removes its listener on disposal', () => {
    const f = controllerFixture(); f.controller.preview('movie'); const conn = f.hass.connection;
    conn.connected = false; conn.fire('disconnected'); expect(f.controller.active).toBeNull(); expect(conn.count('disconnected')).toBe(0);
    conn.connected = true; expect(f.controller.active).toBeNull(); f.controller.preview('movie'); f.controller.dispose();
    expect(conn.count('disconnected')).toBe(0); expect(f.controller.preview('movie').ok).toBe(false); expect(f.controller.previewDraft(binding()).ok).toBe(false);
  });
  it('owns draft copies and cancels a draft on revoked admin/edit permissions', () => {
    const f = controllerFixture(), draft = binding({ lights: [target({ brightness: 50 })] });
    const result = f.controller.previewDraft(draft); expect(result.ok).toBe(true); draft.lights[0].brightness = 100;
    expect(f.controller.revalidate().ok).toBe(true); expect(f.previews.mock.calls[0][0].get('light.main').appearance.level).toBe(50 / 255);
    f.context.canEdit = false; expect(f.controller.revalidate().ok).toBe(false); expect(f.controller.active).toBeNull();
    f.context.canEdit = true; f.controller.previewDraft(binding()); f.hass.user.is_admin = false; expect(f.controller.revalidate().ok).toBe(false); f.controller.dispose();
  });
  it('marks disposal final before a renderer-clear callback can re-enter Preview', () => {
    const f = controllerFixture(); f.controller.preview('movie'); const connection = f.hass.connection;
    let nested; f.controller.onPreview = (overrides) => { if (overrides === null) nested = f.controller.preview('movie'); };
    f.controller.dispose(); expect(nested.ok).toBe(false); expect(f.controller.active).toBeNull(); expect(connection.count('disconnected')).toBe(0);
  });
});

describe('explicit activation is independent from preview completeness', () => {
  it('activates one exact saved scene once with missing visual mappings and no invented light services', async () => {
    const f = controllerFixture({ admin: false, lights: [] }); expect(f.controller.preview('movie').ok).toBe(false);
    expect(await f.controller.activate('movie', { expectedSceneEntity: 'scene.movie' })).toMatchObject({ ok: true, status: 'activated', current: true });
    expect(f.hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.movie' }); f.controller.dispose();
  });
  it('clears only renderer preview before activation and does not fabricate resulting HA states', async () => {
    const f = controllerFixture(); f.controller.preview('movie'); const source = f.hass.states['light.main'];
    await f.controller.activate('movie'); expect(f.controller.active).toBeNull(); expect(f.previews.mock.calls.at(-1)[0]).toBeNull();
    expect(f.hass.states['light.main']).toBe(source); expect(source.attributes.rgb_color).toEqual([255, 0, 0]); f.controller.dispose();
  });
  it('revalidates exact scene intent, permission, registry, connection and advertised action at click time', async () => {
    const cases = [
      (f) => { f.context.bindings.enabled = false; },
      (f) => { f.context.bindings.items.push(binding()); },
      (f) => { f.context.bindings.items[0].scene_entity = 'scene.relinked'; f.hass.states['scene.relinked'] = { state: 'unknown', attributes: {} }; },
      (f) => { f.hass.states['scene.movie'].attributes.restored = true; },
      (f) => { f.hass.entities['scene.movie'] = { hidden: true }; },
      (f) => { f.hass.connection.connected = false; },
      (f) => { delete f.hass.services.scene.turn_on; },
      (f) => { f.hass.user.id = ''; },
    ];
    for (const change of cases) { const f = controllerFixture(); change(f); expect((await f.controller.activate('movie', { expectedSceneEntity: 'scene.movie' })).ok).toBe(false); expect(f.hass.callService).not.toHaveBeenCalled(); f.controller.dispose(); }
  });
  it('does not activate an unsaved/relinked editing draft instead of the intended saved scene', async () => {
    const f = controllerFixture(); f.hass.states['scene.draft'] = { state: 'unknown', attributes: {} };
    expect(f.controller.previewDraft(binding({ scene_entity: 'scene.draft' })).ok).toBe(true);
    expect((await f.controller.activate('movie', { expectedSceneEntity: 'scene.draft' })).ok).toBe(false); expect(f.hass.callService).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it('blocks synchronous context changes from preview removal and activating-status callbacks', async () => {
    const removed = controllerFixture(); removed.controller.preview('movie'); removed.controller.onPreview = (map) => { if (!map) removed.context.contextKey = 'different-house'; };
    expect((await removed.controller.activate('movie')).ok).toBe(false); expect(removed.hass.callService).not.toHaveBeenCalled(); removed.controller.dispose();
    const status = controllerFixture(); status.controller.onStatus = (message) => { if (message.status === 'activating') status.hass.connection.connected = false; };
    expect((await status.controller.activate('movie')).ok).toBe(false); expect(status.hass.callService).not.toHaveBeenCalled(); status.controller.dispose();
  });
  it('deduplicates a pending action, reports HA rejection honestly and never retries automatically', async () => {
    const f = controllerFixture(); let reject; f.hass.callService.mockImplementation(() => new Promise((resolve, failure) => { reject = failure; }));
    const first = f.controller.activate('movie'); expect((await f.controller.activate('movie')).status).toBe('pending'); expect(f.hass.callService).toHaveBeenCalledTimes(1);
    reject(new Error('Not authorized by Home Assistant')); const result = await first;
    expect(result).toMatchObject({ ok: false, status: 'error', current: true, error: 'Not authorized by Home Assistant' });
    expect(f.statuses.mock.calls.at(-1)[0]).toMatchObject({ status: 'error', error: 'Not authorized by Home Assistant' });
    expect(f.hass.callService).toHaveBeenCalledTimes(1); f.controller.dispose();
  });
  it.each(['context', 'connection', 'disposed'])('ignores a late successful acknowledgement after %s changes without reviving preview', async (kind) => {
    const f = controllerFixture(); let resolve; f.hass.callService.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const request = f.controller.activate('movie');
    if (kind === 'context') f.context.contextKey = 'other';
    if (kind === 'connection') f.hass.connection = connection();
    if (kind === 'disposed') f.controller.dispose();
    const count = f.statuses.mock.calls.length; resolve({}); expect(await request).toMatchObject({ ok: true, status: 'activated', current: false });
    expect(f.statuses).toHaveBeenCalledTimes(count); expect(f.controller.active).toBeNull(); expect(f.hass.callService).toHaveBeenCalledTimes(1); f.controller.dispose();
  });
  it.each(['source', 'permission', 'service'])('does not update the current UI from a late acknowledgement after %s is revoked', async (kind) => {
    const f = controllerFixture(); let resolve; f.hass.callService.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const request = f.controller.activate('movie');
    if (kind === 'source') f.hass.states['scene.movie'].attributes.restored = true;
    if (kind === 'permission') f.hass.user.is_active = false;
    if (kind === 'service') delete f.hass.services.scene.turn_on;
    const count = f.statuses.mock.calls.length; resolve({}); expect(await request).toMatchObject({ ok: true, current: false });
    expect(f.statuses).toHaveBeenCalledTimes(count); f.controller.dispose();
  });
});
