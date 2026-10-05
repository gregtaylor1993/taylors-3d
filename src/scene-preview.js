// Explicit visual snapshots, never an inferred HA scene definition. The only HA
// action in this module is the separately requested controller.activate().
// Scenes are stateless; unknown is legitimate before a first activation:
// https://developers.home-assistant.io/docs/core/entity/scene/
// https://www.home-assistant.io/integrations/scene/
import { entityMetadata } from './entity-metadata.js';
import { lightCapabilities, readLightAppearance } from './light-state.js';

const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const range = (v, min, max) => finite(v) && v >= min && v <= max;
const entityId = (v, domain) => typeof v === 'string' && new RegExp(`^${domain}\\.[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$`).test(v);
const itemId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const issue = (code, message, detail = {}) => ({ code, message, ...detail });
const signature = (v) => { try { return JSON.stringify(v); } catch { return null; } };
const copy = (v) => JSON.parse(JSON.stringify(v));
const uniqueIssues = (diagnostics) => [...new Map(diagnostics.map((diagnostic) => [signature([diagnostic.code, diagnostic.itemId, diagnostic.entity, diagnostic.targetIndex]), diagnostic])).values()];

// Known fields are normalized; unknown fields and raw item contents are retained.
// No input is mutated. Validation of live light targets is deliberately separate
// from scene activation: missing preview readings cannot block a valid HA scene.
export function readScenePreviews(value) {
  const result = { enabled: false, items: [], valid: true, diagnostics: [] };
  if (value === undefined) return result;
  if (!plain(value)) return { ...result, valid: false, diagnostics: [issue('settings', 'Scene preview settings must be an object.')] };
  const out = { ...value, ...result };
  if (Object.hasOwn(value, 'enabled')) {
    if (typeof value.enabled === 'boolean') out.enabled = value.enabled;
    else out.diagnostics.push(issue('enabled', 'Scene previews must be explicitly enabled or disabled.'));
  }
  if (Object.hasOwn(value, 'items')) {
    if (Array.isArray(value.items)) out.items = value.items.slice();
    else out.diagnostics.push(issue('items', 'Scene preview items must be an array.'));
  }
  out.valid = out.diagnostics.length === 0;
  return out;
}

function sessionIssues(hass, admin = false) {
  const diagnostics = [];
  if (!hass?.connection || hass.connection.connected !== true) diagnostics.push(issue('connection', 'Wait for an established Home Assistant connection.'));
  if (typeof hass?.user?.id !== 'string' || !hass.user.id.trim() || hass.user.is_active === false) diagnostics.push(issue('authentication', 'A current authenticated Home Assistant user is required.'));
  if (admin && hass?.user?.is_admin !== true) diagnostics.push(issue('administrator', 'Only an administrator can capture or preview an editing draft.'));
  return diagnostics;
}

function sourceIssues(hass, id, domain) {
  if (!entityId(id, domain)) return [issue('entity', `Choose an exact ${domain} entity ID.`, { entity: id })];
  const metadata = entityMetadata(hass, id), diagnostics = [], state = metadata.state;
  if (metadata.hidden || metadata.disabled || metadata.category) diagnostics.push(issue('metadata', 'The selected entity is hidden, disabled or an administrative/diagnostic entity.', { entity: id }));
  if (!plain(state) || typeof state.state !== 'string' || !state.state) diagnostics.push(issue('source', 'The selected entity has no usable current state.', { entity: id }));
  else {
    if (state.entity_id !== undefined && state.entity_id !== id) diagnostics.push(issue('source_entity', 'The current state belongs to a different entity.', { entity: id }));
    if (state.attributes !== undefined && !plain(state.attributes)) diagnostics.push(issue('attributes', 'The current entity attributes are malformed.', { entity: id }));
    else {
      const attributes = state.attributes || {};
      if (Object.hasOwn(attributes, 'restored') && typeof attributes.restored !== 'boolean') diagnostics.push(issue('restored', 'The restored-state flag is malformed.', { entity: id }));
      else if (attributes.restored === true || state.state === 'unavailable') diagnostics.push(issue('unavailable', 'Wait for a current available entity reading.', { entity: id }));
    }
    // A scene timestamp does not describe its constituent devices or prove that
    // its lights still match it. Unknown scenes remain deliberately activatable.
    if (domain === 'scene' && state.state !== 'unknown' && state.state !== 'unavailable' && !Number.isFinite(Date.parse(state.state))) diagnostics.push(issue('scene_state', 'The scene must report unknown or its last activation timestamp.', { entity: id }));
    if (domain === 'light' && state.state !== 'on' && state.state !== 'off' && state.state !== 'unavailable') diagnostics.push(issue('light_state', 'Wait for a current on/off light reading.', { entity: id }));
  }
  return diagnostics;
}

// Official frontend activateScene uses this exact service and entity target:
// https://github.com/home-assistant/frontend/blob/dev/src/data/scene.ts
export function sceneActivationAvailability(hass, sceneEntity) {
  const diagnostics = [...sessionIssues(hass), ...sourceIssues(hass, sceneEntity, 'scene')];
  if (!hass?.services?.scene?.turn_on || typeof hass?.callService !== 'function') diagnostics.push(issue('service', 'Home Assistant does not currently advertise the scene activation action.'));
  return { available: diagnostics.length === 0, entity: sceneEntity, diagnostics };
}

function bindingIssues(binding) {
  if (!plain(binding)) return [issue('binding', 'A scene preview item must be an object.')];
  const diagnostics = [];
  if (!itemId(binding.id)) diagnostics.push(issue('id', 'Scene preview IDs need 1–128 letters, digits, underscores or hyphens.'));
  if (!entityId(binding.scene_entity, 'scene')) diagnostics.push(issue('scene_entity', 'Choose an exact scene entity ID.'));
  if (Object.hasOwn(binding, 'label') && (typeof binding.label !== 'string' || binding.label.length > 256)) diagnostics.push(issue('label', 'The scene label must be text no longer than 256 characters.'));
  return diagnostics.map((diagnostic) => ({ ...diagnostic, itemId: binding.id }));
}

function targetAppearance(target, cap) {
  const attributes = {};
  if (target.state === 'on') {
    if (cap.brightness) attributes.brightness = target.brightness;
    if (target.color?.mode === 'rgb') Object.assign(attributes, { color_mode: 'rgb', supported_color_modes: ['rgb'], rgb_color: target.color.rgb.slice() });
    else if (target.color?.mode === 'kelvin') Object.assign(attributes, { color_mode: 'color_temp', supported_color_modes: ['color_temp'], color_temp_kelvin: target.color.kelvin });
    else Object.assign(attributes, { color_mode: cap.brightness ? 'brightness' : 'onoff', supported_color_modes: [cap.brightness ? 'brightness' : 'onoff'] });
  }
  // This tiny hypothetical state exists only to reuse the finite appearance math.
  // It never enters hass.states, a real device panel, HA actions or source readers.
  const appearance = readLightAppearance({ entity_id: target.entity, state: target.state, attributes });
  appearance.status = 'preview';
  appearance.colorSource = target.state === 'off' ? 'preview-off' : target.color ? `preview-${target.color.mode}` : 'display-fallback';
  appearance.diagnostics = target.state === 'on' && !target.color
    ? [issue('display_fallback', 'This non-colour fixture uses a fixed display appearance, not a scene colour reading.')] : [];
  appearance.key = signature(['preview', target.state, appearance.level, appearance.color, appearance.colorSource]);
  return appearance;
}

function targetIssues(hass, target, index) {
  if (!plain(target)) return [issue('target', 'Each visual light target must be an object.', { targetIndex: index })];
  const detail = { entity: target.entity, targetIndex: index }, diagnostics = sourceIssues(hass, target.entity, 'light');
  if (target.state !== 'on' && target.state !== 'off') diagnostics.push(issue('target_state', 'Choose an explicit desired on or off state.'));
  const cap = lightCapabilities(hass?.states?.[target.entity]);
  if (!cap.valid) diagnostics.push(...cap.diagnostics.map((diagnostic) => issue(`capability_${diagnostic.code}`, diagnostic.message)));
  if (Object.hasOwn(target, 'brightness')) {
    if (!range(target.brightness, 0, 255)) diagnostics.push(issue('brightness', 'Preview brightness must be a finite number from 0 to 255.'));
    else if (!cap.brightness) diagnostics.push(issue('brightness_capability', 'This light does not report brightness support.'));
  } else if (target.state === 'on' && cap.brightness) diagnostics.push(issue('brightness_missing', 'Choose explicit preview brightness or capture a current reading.'));
  if (Object.hasOwn(target, 'color')) {
    const color = target.color;
    if (!plain(color) || !['rgb', 'kelvin'].includes(color.mode)) diagnostics.push(issue('color', 'Preview colour must explicitly use RGB or Kelvin.'));
    else if (color.mode === 'rgb') {
      if (!Array.isArray(color.rgb) || color.rgb.length !== 3 || !color.rgb.every((v) => range(v, 0, 255))) diagnostics.push(issue('rgb', 'RGB needs three finite channels from 0 to 255.'));
      if (!cap.rgb) diagnostics.push(issue('rgb_capability', 'This light does not report colour support.'));
    } else {
      if (!cap.colorTemperature) diagnostics.push(issue('kelvin_capability', 'This light does not report valid Kelvin controls.'));
      else if (!range(color.kelvin, cap.minKelvin, cap.maxKelvin)) diagnostics.push(issue('kelvin', 'Preview Kelvin must stay within this light’s current reported bounds.'));
    }
  } else if (target.state === 'on' && (cap.rgb || cap.colorTemperature)) diagnostics.push(issue('color_missing', 'Choose explicit preview colour or capture a current reading.'));
  return diagnostics.map((diagnostic) => ({ ...diagnostic, ...detail }));
}

// All-or-nothing visual validation. Unknown imported fields remain untouched.
// Connection/authentication/service gating belongs to the controller, not this
// pure shape/capability/source check used for honest editor diagnostics.
export function validateScenePreview(hass, binding) {
  const diagnostics = [...bindingIssues(binding)];
  if (plain(binding)) diagnostics.push(...sourceIssues(hass, binding.scene_entity, 'scene'));
  const overrides = new Map(), seen = new Set(), targets = plain(binding) && Array.isArray(binding.lights) ? binding.lights : [];
  if (!targets.length) diagnostics.push(issue('lights', 'Choose at least one explicit visual light target.'));
  for (const [index, target] of targets.entries()) {
    const problems = targetIssues(hass, target, index); diagnostics.push(...problems);
    if (plain(target) && seen.has(target.entity)) diagnostics.push(issue('duplicate_light', 'A light may appear only once in a scene preview.', { entity: target.entity, targetIndex: index }));
    if (plain(target)) seen.add(target.entity);
    if (!problems.length) {
      const appearance = targetAppearance(target, lightCapabilities(hass.states[target.entity]));
      overrides.set(target.entity, { desiredOn: target.state === 'on', appearance, key: appearance.key });
    }
  }
  if (diagnostics.length) overrides.clear();
  const key = diagnostics.length ? null : signature([binding.id, binding.scene_entity, [...overrides].sort(([a], [b]) => a.localeCompare(b)).map(([entity, override]) => [entity, override.key])]);
  return { valid: diagnostics.length === 0, diagnostics, overrides, key };
}

// Capture only selected CURRENT reports. Off lights yield only an off target;
// stale off colour, unsupported modes and missing XY→RGB conversions are not copied.
// This does not read a scene definition or call scene.create / any other HA action.
export function captureLightSnapshot(hass, entityIds, { now = Date.now(), canEdit = true } = {}) {
  const diagnostics = sessionIssues(hass, true), lights = [];
  if (canEdit !== true) diagnostics.push(issue('edit_permission', 'Editing is not currently allowed.'));
  if (!finite(now) || now < 0) diagnostics.push(issue('capture_time', 'The snapshot needs a finite capture time.'));
  if (!Array.isArray(entityIds) || !entityIds.length || new Set(entityIds).size !== entityIds.length) diagnostics.push(issue('selection', 'Select a non-empty list of distinct exact light IDs.'));
  for (const entity of Array.isArray(entityIds) ? entityIds : []) {
    const problems = sourceIssues(hass, entity, 'light'), state = hass?.states?.[entity], cap = lightCapabilities(state), appearance = readLightAppearance(state);
    if (!cap.valid) problems.push(...cap.diagnostics.map((diagnostic) => issue(`capability_${diagnostic.code}`, diagnostic.message, { entity })));
    if (problems.length) { diagnostics.push(...problems); continue; }
    const target = { entity, state: state.state };
    if (state.state === 'on') {
      if (cap.brightness) {
        if (!appearance.brightnessKnown || !range(state.attributes?.brightness, 0, 255)) problems.push(issue('snapshot_brightness', 'The light does not report a usable current brightness.', { entity }));
        else target.brightness = state.attributes.brightness;
      }
      if (cap.rgb || cap.colorTemperature) {
        const a = state.attributes || {};
        if (a.color_mode === 'color_temp' && cap.colorTemperature && range(a.color_temp_kelvin, cap.minKelvin, cap.maxKelvin)) target.color = { mode: 'kelvin', kelvin: a.color_temp_kelvin };
        else if (cap.rgb && appearance.colorKnown && Array.isArray(a.rgb_color) && a.rgb_color.length === 3 && a.rgb_color.every((v) => range(v, 0, 255))) target.color = { mode: 'rgb', rgb: a.rgb_color.slice() };
        else problems.push(issue('snapshot_color', 'The light does not report a usable colour snapshot in its supported RGB/Kelvin modes.', { entity }));
      }
      if (['invalid', 'unknown', 'unavailable', 'missing', 'unsupported'].includes(appearance.status)) problems.push(issue('snapshot_appearance', 'Wait for a trustworthy current light appearance before capture.', { entity }));
    }
    if (problems.length) diagnostics.push(...problems); else lights.push(target);
  }
  return { valid: diagnostics.length === 0, lights: diagnostics.length ? [] : lights, captured_at: finite(now) && now >= 0 ? now : null,
    kind: 'current-light-snapshot', diagnostics };
}

/** Renderer-only lifecycle. getContext returns {hass,bindings,contextKey,canEdit?}.
 * contextKey must be a stable layout/model generation value/reference, not a new
 * array on every call. Root calls revalidate on states/context/visibility changes;
 * stop/dispose clears overrides so its renderer reapplies LATEST real HA states.
 * No original real-state snapshot is retained or restored. HA enforces service
 * permissions on the one deliberate scene.turn_on call. No automatic retry.
 */
export class ScenePreviewController {
  constructor({ getContext, onPreview = () => {}, onStatus = () => {} } = {}) {
    this.getContext = typeof getContext === 'function' ? getContext : () => ({});
    this.onPreview = onPreview; this.onStatus = onStatus;
    this._generation = 0; this._active = null; this._pending = null; this._disposed = false;
    this._onDisconnected = () => this.stop(undefined, 'disconnected');
  }
  get active() { return this._active ? { token: this._active.token, itemId: this._active.binding.id, sceneEntity: this._active.binding.scene_entity, draft: this._active.draft } : null; }
  _context() { const value = this.getContext(); return plain(value) ? value : {}; }
  _stamp(context) { return { key: context.contextKey, connection: context.hass?.connection, user: context.hass?.user?.id, bindings: signature(context.bindings) }; }
  _same(stamp, context) {
    return stamp.key === context.contextKey && stamp.connection === context.hass?.connection && stamp.user === context.hass?.user?.id
      && stamp.bindings === signature(context.bindings) && context.hass?.connection?.connected === true;
  }
  _activationCurrent(pending) {
    if (this._disposed) return false;
    const context = this._context(), resolved = this._resolve(context, pending.id, null);
    return this._same(pending.stamp, context) && !resolved.diagnostics.length && resolved.binding?.scene_entity === pending.entity
      && sceneActivationAvailability(context.hass, pending.entity).available;
  }
  _resolve(context, id, draft) {
    const settings = readScenePreviews(context.bindings), diagnostics = settings.diagnostics.slice();
    if (!settings.enabled) diagnostics.push(issue('disabled', 'Scene previews are not enabled.'));
    const matches = draft ? [draft] : settings.items.filter((item) => plain(item) && item.id === id);
    if (matches.length !== 1) diagnostics.push(issue('mapping', 'Choose one exact current saved scene preview ID.'));
    const binding = matches.length === 1 ? matches[0] : null;
    diagnostics.push(...bindingIssues(binding));
    if (draft && settings.items.filter((item) => plain(item) && item.id === id).length > 1) diagnostics.push(issue('duplicate_id', 'The editing scene ID has ambiguous saved mappings.'));
    if (binding && settings.items.filter((item) => plain(item) && item.scene_entity === binding.scene_entity && (!draft || item.id !== binding.id)).length > (draft ? 0 : 1)) diagnostics.push(issue('duplicate_scene', 'The selected scene has ambiguous duplicate preview mappings.'));
    return { binding, diagnostics };
  }
  _invalid(diagnostics, binding) {
    diagnostics = uniqueIssues(diagnostics);
    this.stop(undefined, 'invalid');
    this.onStatus({ status: 'invalid', itemId: binding?.id, sceneEntity: binding?.scene_entity, diagnostics });
    return { ok: false, token: null, diagnostics };
  }
  preview(id) { return this._start(id, null); }
  previewDraft(binding) { return this._start(binding?.id, binding); }
  _start(id, draft) {
    if (this._disposed) return { ok: false, token: null, diagnostics: [issue('disposed', 'The scene preview controller is closed.')] };
    const context = this._context(), resolved = this._resolve(context, id, draft), binding = resolved.binding;
    const diagnostics = [...resolved.diagnostics, ...sessionIssues(context.hass, !!draft)];
    if (draft && Object.hasOwn(context, 'canEdit') && context.canEdit !== true) diagnostics.push(issue('edit_permission', 'Editing is not currently allowed.'));
    if (binding) diagnostics.push(...sceneActivationAvailability(context.hass, binding.scene_entity).diagnostics);
    const checked = validateScenePreview(context.hass, binding); diagnostics.push(...checked.diagnostics);
    if (diagnostics.length) return this._invalid(diagnostics, binding);
    if (this._active && this._same(this._active.stamp, context) && this._active.draft === !!draft && this._active.key === checked.key) return { ok: true, token: this._active.token, diagnostics: [] };
    // Replace an old preview directly. A transient clear would unnecessarily
    // evaluate real-state lamp budgets/shadows before applying the new override.
    this._active?.stamp.connection?.removeEventListener?.('disconnected', this._onDisconnected);
    const token = Object.freeze({ generation: ++this._generation });
    this._active = { token, binding: copy(binding), draft: !!draft, stamp: this._stamp(context), key: checked.key };
    context.hass.connection.addEventListener?.('disconnected', this._onDisconnected);
    this.onPreview(checked.overrides, { ...this.active });
    this.onStatus({ status: 'previewing', itemId: binding.id, sceneEntity: binding.scene_entity, diagnostics: [] });
    return { ok: true, token, diagnostics: [] };
  }
  stop(token, reason = 'stopped') {
    if (!this._active || token && token !== this._active.token) return false;
    const active = this._active; this._active = null;
    active.stamp.connection?.removeEventListener?.('disconnected', this._onDisconnected);
    this.onPreview(null, { token: active.token, itemId: active.binding.id, sceneEntity: active.binding.scene_entity, draft: active.draft, reason });
    this.onStatus({ status: 'stopped', itemId: active.binding.id, sceneEntity: active.binding.scene_entity, reason, diagnostics: [] });
    return true;
  }
  revalidate() {
    if (!this._active) return { ok: false, token: null, diagnostics: [] };
    const active = this._active, context = this._context();
    if (!this._same(active.stamp, context)) return this._invalid([issue('context', 'The preview context or connection changed.')], active.binding);
    const resolved = this._resolve(context, active.binding.id, active.draft ? active.binding : null);
    const checked = validateScenePreview(context.hass, resolved.binding), diagnostics = [...resolved.diagnostics, ...sessionIssues(context.hass, active.draft), ...checked.diagnostics,
      ...sceneActivationAvailability(context.hass, active.binding.scene_entity).diagnostics];
    if (active.draft && Object.hasOwn(context, 'canEdit') && context.canEdit !== true) diagnostics.push(issue('edit_permission', 'Editing is not currently allowed.'));
    if (diagnostics.length) return this._invalid(diagnostics, active.binding);
    // Explicit targets do not inherit changing real brightness/colour. An equal
    // source refresh leaves the renderer override and its token untouched.
    return { ok: true, token: active.token, diagnostics: [] };
  }
  async activate(id, { expectedSceneEntity } = {}) {
    if (this._disposed) return { ok: false, status: 'invalid', diagnostics: [issue('disposed', 'The scene preview controller is closed.')] };
    if (this._pending) return { ok: false, status: 'pending', diagnostics: [issue('pending', 'Wait for the current scene action to finish.')] };
    let context = this._context(), resolved = this._resolve(context, id, null), binding = resolved.binding;
    let diagnostics = resolved.diagnostics.concat(binding ? sceneActivationAvailability(context.hass, binding.scene_entity).diagnostics : []);
    if (binding && expectedSceneEntity !== undefined && expectedSceneEntity !== binding.scene_entity) diagnostics.push(issue('target_changed', 'The selected saved scene target changed.'));
    if (diagnostics.length) { this.onStatus({ status: 'invalid', itemId: id, sceneEntity: binding?.scene_entity, diagnostics }); return { ok: false, status: 'invalid', diagnostics }; }
    const stamp = this._stamp(context), entity = binding.scene_entity;
    this.stop(undefined, 'activate');
    // Preview removal callbacks can synchronously change root context. Re-read
    // immediately before the one service call; never call a replaced scene target.
    context = this._context(); resolved = this._resolve(context, id, null); binding = resolved.binding;
    diagnostics = resolved.diagnostics.concat(sceneActivationAvailability(context.hass, entity).diagnostics);
    if (!this._same(stamp, context) || binding?.scene_entity !== entity) diagnostics.push(issue('context', 'The scene action context changed before activation.'));
    if (diagnostics.length) return { ok: false, status: 'invalid', diagnostics };
    const pending = { stamp, id, entity }; this._pending = pending;
    try {
      this.onStatus({ status: 'activating', itemId: id, sceneEntity: entity, diagnostics: [] });
      context = this._context(); resolved = this._resolve(context, id, null);
      diagnostics = resolved.diagnostics.concat(sceneActivationAvailability(context.hass, entity).diagnostics);
      if (!this._same(stamp, context) || resolved.binding?.scene_entity !== entity) diagnostics.push(issue('context', 'The scene action context changed before sending.'));
      if (this._disposed || diagnostics.length) return { ok: false, status: 'invalid', diagnostics };
      await context.hass.callService('scene', 'turn_on', { entity_id: entity });
      const current = this._activationCurrent(pending);
      if (current) this.onStatus({ status: 'activated', itemId: id, sceneEntity: entity, diagnostics: [] });
      return { ok: true, status: 'activated', current, diagnostics: [] };
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message : String(error), current = this._activationCurrent(pending);
      if (current) this.onStatus({ status: 'error', itemId: id, sceneEntity: entity, error: message, diagnostics: [] });
      return { ok: false, status: 'error', current, error: message, diagnostics: [] };
    } finally { if (this._pending === pending) this._pending = null; }
  }
  dispose() { this._disposed = true; this.stop(undefined, 'disposed'); }
}
