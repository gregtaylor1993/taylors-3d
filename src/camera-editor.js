// Camera coverage settings are layout data. Editing never opens a stream or calls HA services.
import { COVERAGE_LIMITS, normaliseCoverage, coverageSector } from './camera-coverage.js';
import { entityChoices, entityMetadata } from './entity-metadata.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => typeof key === 'string' && Object.hasOwn(value, key);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const copy = (value) => JSON.parse(JSON.stringify(value));
const normalBearing = (value) => ((value % 360) + 360) % 360;
const option = (value, label, selected) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
const numeric = (value) => typeof value === 'string' ? value.trim() === '' ? undefined : Number(value) : value;
const anchorId = (anchor) => anchor?.id ?? anchor?.entity;
const selectedOnly = 'This saved camera or anchor is missing. Its settings are read-only; restore the camera mapping or clear this binding.';

/** New choices omit hidden/config/diagnostic entities; saved choices are retained by the editor. */
export function cameraEntities(hass = {}) {
  return entityChoices(hass, { domains: ['camera'] }).map((entry) => [entry.value, entry.label]);
}

function validPosition(position) {
  if (!plain(position)) return false;
  const floor = position.floorId ?? position.floor_id;
  return finite(position.x) && finite(position.y) && Math.abs(position.x) <= COVERAGE_LIMITS.maxCoordinate && Math.abs(position.y) <= COVERAGE_LIMITS.maxCoordinate
    && (position.z === undefined || finite(position.z) && Math.abs(position.z) <= COVERAGE_LIMITS.maxHeight)
    && (position.elevation === undefined || finite(position.elevation) && Math.abs(position.elevation) <= COVERAGE_LIMITS.maxCoordinate)
    && typeof floor === 'string' && !!floor.trim();
}

/**
 * Root contract: cameraAnchors() supplies real {id,entity,position,shown,label?,heading?}.
 * Saved layout.camera_coverage overrides card options and is a direct binding map.
 * commitFeatureLayout({camera_coverage: map}) records one undoable Save/Clear.
 * Optional previewCameraCoverage(map|null) displays a transient draft in the same scene.
 * Delegation matches OverlayEditor: onChange/onClick and updatePreviews(container).
 */
export class CameraEditor {
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.cameraId = null; this.anchorId = null;
    this.draft = null; this.sourceKey = null; this.dirty = false; this.message = null; this.previewing = false; this.disposed = false; this.previewHtml = new WeakMap();
  }

  get hass() { return this.card._hass || {}; }
  get config() {
    const value = this.card._layout?.camera_coverage ?? this.card._config?.camera_coverage;
    return plain(value) ? value : {};
  }
  get anchors() {
    const value = this.card.cameraAnchors?.();
    return (Array.isArray(value) ? value : []).filter((anchor) => plain(anchor) && typeof anchor.entity === 'string' && anchor.entity.startsWith('camera.'));
  }
  get choices() {
    const selected = Object.keys(this.config).map((key) => this.anchors.find((anchor) => anchorId(anchor) === key)?.entity || (key.startsWith('camera.') ? key : null)).filter(Boolean);
    // A live registry/anchor removal must not silently select a different camera under a draft.
    if (this.cameraId?.startsWith('camera.')) selected.push(this.cameraId);
    const choices = new Map(entityChoices(this.hass, { domains: ['camera'], selected }).map((entry) => [entry.value, { value: entry.value, entity: entry.value, label: entry.label, inherited: entry.filtered }]));
    for (const anchor of this.anchors) {
      const metadata = entityMetadata(this.hass, anchor.entity);
      if ((!metadata.hasState || metadata.hidden || metadata.disabled || metadata.category) && !own(this.config, anchor.entity) && !own(this.config, anchorId(anchor))) continue;
      if (!choices.has(anchor.entity)) choices.set(anchor.entity, { value: anchor.entity, entity: anchor.entity, label: this._cameraLabel(anchor.entity), inherited: true });
    }
    for (const key of Object.keys(this.config)) {
      const anchor = this.anchors.find((entry) => anchorId(entry) === key);
      const entity = anchor?.entity || (key.startsWith('camera.') ? key : null);
      if (entity) {
        if (!choices.has(entity)) choices.set(entity, { value: entity, entity, label: this._cameraLabel(entity), inherited: true });
      } else choices.set(`saved:${key}`, { value: `saved:${key}`, entity: null, label: `Saved anchor: ${key}`, key, inherited: true });
    }
    return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  get selected() { return this.choices.find((entry) => entry.value === this.cameraId) || this.choices[0]; }
  get cameraAnchors() { return this.anchors.filter((entry) => entry.entity === this.selected?.entity); }
  get anchor() { return this.anchorId === null ? this.cameraAnchors[0] : this.cameraAnchors.find((entry) => anchorId(entry) === this.anchorId); }

  _cameraLabel(entity) { return entityMetadata(this.hass, entity).name; }
  _floorLabel(anchor) {
    const id = anchor?.position?.floorId ?? anchor?.position?.floor_id;
    return this.card._floors?.find((floor) => floor.id === id)?.name || id || 'Floor missing';
  }
  _key() {
    if (!this.selected) return null;
    if (this.selected.key) return this.selected.key;
    return this.cameraAnchors.length > 1 ? anchorId(this.anchor) : this.selected.entity;
  }
  _source() {
    const id = anchorId(this.anchor), entity = this.selected?.entity;
    const missingSource = !this.anchor && this.loadedCameraId === this.selected?.value && own(this.config, this.sourceKey) ? this.sourceKey : null;
    const key = this.selected?.key || missingSource || (own(this.config, id) ? id : own(this.config, entity) ? entity : this._key());
    return { key, value: own(this.config, key) ? this.config[key] : {} };
  }
  _load() {
    const selected = this.selected;
    this.cameraId = selected?.value || null;
    const actual = this.anchor;
    if (actual) this.anchorId = anchorId(actual); else if (this.loadedCameraId !== this.cameraId) this.anchorId = null;
    const source = this._source();
    this.sourceKey = source.key; this.draft = plain(source.value) ? copy(source.value) : {};
    this.badImportedSettings = own(this.config, source.key) && !plain(source.value);
    this.authoredHeading = this.draft.heading === undefined && finite(this.anchor?.heading);
    if (this.authoredHeading) this.draft.heading = normalBearing(this.anchor.heading);
    this.baseValue = JSON.stringify(source.value); this.dirty = false; this.loadedCameraId = this.cameraId;
  }
  _ensure() {
    if (!this.draft || this.cameraId !== this.selected?.value || !this.dirty && JSON.stringify(this._source().value) !== this.baseValue) this._load();
  }
  _raw() {
    const raw = { ...this.draft };
    for (const field of ['heading', 'fov', 'range', 'opacity', 'segments']) {
      const value = numeric(raw[field]);
      if (value === undefined) delete raw[field]; else raw[field] = value;
    }
    return raw;
  }
  _readOnly() {
    const selected = this.selected;
    const metadata = entityMetadata(this.hass, selected?.entity);
    return !!selected && (!selected.entity || !metadata.hasState || metadata.hidden || metadata.disabled || !!metadata.category || !!this.anchorId && !this.anchor);
  }
  _evaluation() {
    const settings = normaliseCoverage(this._raw(), { heading: this.anchor?.heading });
    const diagnostics = [...settings.diagnostics];
    if (this.badImportedSettings) diagnostics.push({ code: 'imported', message: 'This saved binding is malformed. Clear it and create a new camera binding.' });
    if (this._readOnly()) {
      const metadata = entityMetadata(this.hass, this.selected?.entity);
      diagnostics.push({ code: 'missing', message: this.anchorId && !this.anchor && metadata.hasState && !metadata.hidden && !metadata.disabled && !metadata.category
        ? 'The selected camera anchor is missing. Saved settings are read-only; restore that object or choose another anchor deliberately.'
        : metadata.disabled ? 'This camera or its device is disabled. Saved settings are read-only; enable it in Home Assistant or clear this binding.'
        : metadata.hidden || metadata.category ? 'This saved camera is hidden or marked as a configuration/diagnostic entity. Settings are read-only; restore the entity or clear this binding.'
          : metadata.registered && !metadata.hasState ? 'This registered camera has no current state. Saved settings are read-only; restore its state or clear this binding.' : selectedOnly });
    }
    if (settings.enabled) {
      const id = anchorId(this.anchor);
      if (!validPosition(this.anchor?.position)) diagnostics.push({ code: 'position', message: 'Place this camera on a mapped floor before enabling coverage. No camera position is guessed.' });
      if (typeof id !== 'string' || !id.trim() || this.anchors.filter((anchor) => anchorId(anchor) === id).length > 1) diagnostics.push({ code: 'anchor', message: 'Camera anchor IDs must be unique. Choose or repair the camera object mapping.' });
    }
    return { settings, diagnostics, valid: diagnostics.length === 0 };
  }
  _serialized(settings) {
    return { enabled: settings.enabled,
      ...(settings.heading !== null ? { heading: settings.heading } : {}),
      ...(settings.fov !== null ? { fov: settings.fov } : {}), ...(settings.range !== null ? { range: settings.range } : {}),
      color: settings.color, opacity: settings.opacity, show_rays: settings.show_rays,
      ...(this.draft.segments !== undefined ? { segments: settings.segments } : {}), ...(this.draft.unit !== undefined ? { unit: 'm' } : {}) };
  }
  _mapWith(value) {
    const key = this._key();
    const map = { ...this.config };
    if (key === null || key === undefined) return map;
    // Moving an inherited binding to a precise anchor removes only its old shared source.
    if (this.sourceKey !== key) delete map[this.sourceKey];
    if (this.cameraAnchors.length === 1 && anchorId(this.anchor) !== key) delete map[anchorId(this.anchor)];
    return { ...map, [key]: value };
  }
  _clearPreview() {
    if (this.previewing) this.card.previewCameraCoverage?.(null);
    this.previewing = false;
  }
  _preview() {
    if (!this.selected || this._readOnly() || this.disposed) { this._clearPreview(); return; }
    const result = this._evaluation();
    if (this.card.previewCameraCoverage) {
      // Invalid draft geometry hides this sector while leaving other saved sectors visible.
      this.card.previewCameraCoverage(this._mapWith(result.valid ? this._serialized(result.settings) : { enabled: false }));
      this.previewing = true;
    }
  }
  _commit(map) {
    this.card.commitFeatureLayout({ camera_coverage: map });
    this._clearPreview(); this.message = null; this.draft = null; this.dirty = false; this.onRender();
  }

  _direction(settings) {
    const known = finite(settings.heading), radians = known ? settings.heading * Math.PI / 180 : 0;
    const sector = coverageSector({ x: 0, y: 0, floorId: 'direction-diagram' }, settings);
    const points = sector ? sector.polygon.map(([x, y]) => `${(x / settings.range * 39).toFixed(2)},${(-y / settings.range * 39).toFixed(2)}`).join(' ') : '';
    const direction = known ? `${Number(settings.heading.toFixed(1))}° clockwise from north` : 'Heading not chosen';
    return `<svg viewBox="-60 -60 120 120" role="img" aria-label="${esc(`Approximate direction diagram: ${direction}`)}" class="cov-compass">
      <circle r="40" fill="none" stroke="currentColor" opacity=".25" stroke-dasharray="3 3"/>
      ${points ? `<polygon points="${points}" fill="${esc(settings.color)}" fill-opacity=".28" stroke="${esc(settings.color)}"/>` : ''}
      ${known ? `<line x1="0" y1="0" x2="${(Math.sin(radians) * 38).toFixed(2)}" y2="${(-Math.cos(radians) * 38).toFixed(2)}" stroke="currentColor" stroke-width="2"/><circle cx="${(Math.sin(radians) * 38).toFixed(2)}" cy="${(-Math.cos(radians) * 38).toFixed(2)}" r="3" fill="currentColor"/>` : ''}
      <circle r="3" fill="currentColor"/><g fill="currentColor" font-size="10" text-anchor="middle"><text y="-47">N</text><text x="51" y="3">E</text><text y="55">S</text><text x="-51" y="3">W</text></g>
    </svg><p class="hint">${esc(direction)}${sector ? ` · ${esc(settings.fov)}° wide · ${esc(settings.range)} m` : ''}</p>`;
  }
  _previewHtml() {
    const { settings, diagnostics } = this._evaluation(), anchor = this.anchor, state = this.hass.states?.[this.selected?.entity];
    const unavailable = state && ['unavailable', 'unknown'].includes(state.state);
    const issues = [...diagnostics];
    if (this.cameraAnchors.length > 1) issues.push({ message: 'This camera has multiple anchors. Settings apply only to the selected object or marker.' });
    if (anchor && (anchor.shown === false || anchor.visible === false)) issues.push({ message: 'This camera anchor is currently hidden. Coverage appears only when its object and floor are visible.' });
    if (unavailable) issues.push({ message: `Camera stream is ${state.state}. The shaded area is still a configured approximation, not proof of working detection.` });
    return `${this._direction(settings)}${anchor ? `<p class="hint">Anchor: ${esc(anchor.label || anchorId(anchor))} · ${esc(this._floorLabel(anchor))}${validPosition(anchor.position) ? ` · ${esc(anchor.position.x)} m east, ${esc(anchor.position.y)} m north` : ''}</p>` : '<p class="hint">No mapped camera position is available.</p>'}
      ${this.authoredHeading ? '<p class="hint">Direction came from this anchor’s explicit plan heading. You can change it here.</p>' : ''}
      <div aria-live="polite">${this.message ? `<p class="cov-note" role="status">${esc(this.message)}</p>` : ''}
      ${issues.length ? `<ul class="cov-warnings">${issues.map((issue) => `<li>${esc(issue.message)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  /** Refresh only status/diagram HTML. HA updates never replace editable controls or focus. */
  updatePreviews(container) {
    if (this.disposed || !this.draft || !container) return;
    const target = container.querySelector('[data-cov-preview]');
    const html = this._previewHtml();
    if (target && this.previewHtml.get(target) !== html) {
      if (target.innerHTML !== html) target.innerHTML = html;
      this.previewHtml.set(target, html);
    }
    const root = container.matches?.('[data-cov-editor]') ? container : container.querySelector('[data-cov-editor]');
    if (!root) return;
    const readOnly = this._readOnly();
    for (const control of root.querySelectorAll('[data-cov-setting], [data-act="cov-save"]')) control.disabled = readOnly;
  }
  afterUpdate(container) { this.updatePreviews(container); }

  render() {
    if (this.disposed) return '';
    this._ensure();
    const selected = this.selected, raw = this.draft || {}, readOnly = this._readOnly();
    const cameras = this.choices, anchors = this.cameraAnchors, heading = numeric(raw.heading);
    const color = typeof raw.color === 'string' ? raw.color : '#03a9f4';
    const saved = own(this.config, this.sourceKey);
    return `<section data-cov-editor data-taylors3d-ui class="cov-editor">
      <style>
        .cov-editor {color:var(--primary-text-color);font-size:13px}.cov-editor h3 {font-size:15px;margin:0 0 10px}.cov-editor label {display:block;margin:12px 0}
        .cov-editor input:not([type=checkbox]),.cov-editor select {box-sizing:border-box;width:100%;min-height:44px;margin-top:5px;padding:9px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}
        .cov-editor input[type=range] {padding:0;accent-color:var(--primary-color)}.cov-editor input[type=checkbox] {width:20px;height:20px;accent-color:var(--primary-color);margin:0}
        .cov-editor .check {display:flex;align-items:center;gap:10px;min-height:44px}.cov-editor .hint {font-size:12px;line-height:1.5;color:var(--secondary-text-color);margin:8px 0}
        .cov-editor .cov-box {padding:13px;border:1px solid var(--divider-color);border-radius:12px;margin:12px 0}.cov-editor .cov-grid {display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .cov-editor .cov-grid label {min-width:0}.cov-editor .cov-compass {display:block;width:150px;height:150px;max-width:100%;margin:8px auto}
        .cov-editor button {min-height:44px;padding:9px 13px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit;cursor:pointer}
        .cov-editor button.primary {background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}.cov-editor .cov-actions {display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
        .cov-editor :disabled {opacity:.55;cursor:default}.cov-editor .cov-note,.cov-editor .cov-warnings {line-height:1.5}.cov-editor .cov-warnings {padding-left:20px}
        .cov-editor input:focus-visible,.cov-editor select:focus-visible,.cov-editor button:focus-visible {outline:2px solid var(--primary-color);outline-offset:2px}
      </style>
      <h3>Camera coverage</h3><p class="hint">Choose a real mapped camera and enter its direction, horizontal field of view and approximate range. This is a visual estimate; walls, lenses and detection settings may change what it actually sees.</p>
      ${cameras.length ? `<label>Camera<select data-field="cov-camera">${cameras.map((entry) => option(entry.value, entry.label, selected?.value)).join('')}</select></label>
      ${anchors.length || this.anchorId ? `<label>Camera object or marker<select data-field="cov-anchor">${this.anchorId && !this.anchor ? option(this.anchorId, `Missing anchor: ${this.anchorId}`, this.anchorId) : ''}${anchors.map((anchor) => option(anchorId(anchor), `${anchor.label || anchorId(anchor)} · ${this._floorLabel(anchor)}`, this.anchorId)).join('')}</select></label>` : '<p class="hint">Map this camera using a device position or a bound model object first.</p>'}
      <div class="cov-box"><label class="check"><input type="checkbox" data-field="cov-enabled" data-cov-setting ${raw.enabled === true ? 'checked' : ''} ${readOnly ? 'disabled' : ''}> Show approximate coverage</label>
        <label>Heading, degrees clockwise from north<input type="number" inputmode="decimal" step="any" data-field="cov-heading" data-cov-setting value="${esc(raw.heading ?? '')}" placeholder="Choose a direction" ${readOnly ? 'disabled' : ''}></label>
        <label>Heading slider — move to choose<input type="range" min="0" max="359" step="1" data-field="cov-heading-slider" data-cov-setting value="${finite(heading) ? normalBearing(heading) : 0}" aria-label="Heading clockwise from north" ${readOnly ? 'disabled' : ''}></label>
        <p class="hint">0° north · 90° east · 180° south · 270° west. A blank heading is not configured.</p>
        <div class="cov-grid"><label>Horizontal field of view, degrees<input type="number" inputmode="decimal" min="${COVERAGE_LIMITS.minFov}" max="${COVERAGE_LIMITS.maxFov}" step="any" data-field="cov-fov" data-cov-setting value="${esc(raw.fov ?? '')}" placeholder="Camera specification" ${readOnly ? 'disabled' : ''}></label>
        <label>Approximate range, metres<input type="number" inputmode="decimal" min="${COVERAGE_LIMITS.minRange}" max="${COVERAGE_LIMITS.maxRange}" step="any" data-field="cov-range" data-cov-setting value="${esc(raw.range ?? '')}" placeholder="Enter reach" ${readOnly ? 'disabled' : ''}></label></div>
        <div class="cov-grid"><label>Coverage colour<input data-field="cov-color" data-cov-setting value="${esc(color)}" placeholder="#03a9f4" maxlength="7" ${readOnly ? 'disabled' : ''}></label>
        <label>Opacity, 0 to 1<input type="number" inputmode="decimal" min="0" max="1" step="0.01" data-field="cov-opacity" data-cov-setting value="${esc(raw.opacity ?? .14)}" ${readOnly ? 'disabled' : ''}></label></div>
        <label class="check"><input type="checkbox" data-field="cov-show-rays" data-cov-setting ${raw.show_rays !== false ? 'checked' : ''} ${readOnly ? 'disabled' : ''}> Show camera boundary rays</label>
      </div><div data-cov-preview>${this._previewHtml()}</div>
      <p class="hint">Changes stay in this draft until Save. Selecting another camera or leaving this tab discards the draft.</p>
      <div class="cov-actions"><button class="primary" data-act="cov-save" ${readOnly ? 'disabled' : ''}>Save</button><button data-act="cov-cancel">Cancel</button><button data-act="cov-clear" ${saved ? '' : 'disabled'}>Clear saved coverage</button></div>` : '<p class="cov-note">No cameras are available. Add a camera integration in Home Assistant, then map its position in this layout.</p>'}
    </section>`;
  }

  onChange(field, element) {
    if (this.disposed || !field?.startsWith('cov-')) return false;
    this._ensure();
    if (field === 'cov-camera' || field === 'cov-anchor') {
      this._clearPreview();
      if (field === 'cov-camera') { this.cameraId = element.value; this.anchorId = null; } else this.anchorId = element.value;
      this.draft = null; this.message = null; this._load(); this.onRender(); return true;
    }
    const fields = { 'cov-enabled': 'enabled', 'cov-heading': 'heading', 'cov-heading-slider': 'heading', 'cov-fov': 'fov', 'cov-range': 'range', 'cov-color': 'color', 'cov-opacity': 'opacity', 'cov-show-rays': 'show_rays' };
    const name = fields[field];
    if (!name) return false;
    if (this._readOnly() || !this.selected) return true;
    this.draft[name] = element.type === 'checkbox' ? element.checked : element.value;
    if (name === 'heading') this.authoredHeading = false;
    this.dirty = true; this.message = null;
    const container = element.closest('[data-cov-editor]');
    if (name === 'heading' && container) {
      const numericInput = container.querySelector('[data-field="cov-heading"]'), slider = container.querySelector('[data-field="cov-heading-slider"]');
      if (field === 'cov-heading-slider' && numericInput) numericInput.value = element.value;
      if (field === 'cov-heading' && slider && finite(numeric(element.value))) slider.value = normalBearing(numeric(element.value));
    }
    this._preview(); this.updatePreviews(container); return true;
  }

  onClick(action, button) {
    if (this.disposed || !action?.startsWith('cov-')) return false;
    this._ensure();
    if (action === 'cov-cancel') { this.cancel(); return true; }
    if (action === 'cov-save') {
      const result = this._evaluation();
      if (result.valid && this.selected) this._commit(this._mapWith(this._serialized(result.settings)));
      else { this.message = 'Choose valid settings before saving; nothing has been saved.'; this.updatePreviews(button?.closest('[data-cov-editor]')); }
      return true;
    }
    if (action === 'cov-clear') {
      if (!own(this.config, this.sourceKey)) return true;
      const map = { ...this.config }; delete map[this.sourceKey];
      const key = this._key(); if (this.anchor && key !== this.sourceKey) delete map[key];
      if (this.anchor && this.cameraAnchors.length === 1) { delete map[anchorId(this.anchor)]; delete map[this.selected?.entity]; }
      this._commit(map); return true;
    }
    return false;
  }
  handleChange(event) { return this.onChange(event.target?.dataset?.field, event.target); }
  onInput(field, element) { return !['cov-camera', 'cov-anchor', 'cov-enabled', 'cov-show-rays'].includes(field) && this.onChange(field, element); }
  handleClick(event) {
    const button = event.target?.closest?.('[data-act]');
    return !!button && !button.disabled && this.onClick(button.dataset.act, button);
  }
  cancel() {
    this._clearPreview(); this.draft = null; this.message = null; this.dirty = false;
    if (!this.disposed) { this._load(); this.onRender(); }
  }
  reset() {
    this._clearPreview(); this.cameraId = null; this.anchorId = null; this.loadedCameraId = null; this.draft = null; this.message = null; this.dirty = false;
  }
  dispose() { this._clearPreview(); this.disposed = true; this.draft = null; }
}
