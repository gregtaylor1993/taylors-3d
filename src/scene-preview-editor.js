// Future scene-preview editor. Drafts describe local light appearance, never a
// Home Assistant scene definition. Only the separate Activate action calls HA.
import { editorExtraNotice, readEditorExtraNotice, editorExtraText, editorExtraCaption, updateEditorExtraCaptions, editorExtraDiagnostic } from './editor-extra-localization.js';
import { entityChoices, entityMetadata, formatEntityValue } from './entity-metadata.js';
import { EntityAreaFilter } from './entity-area-filter.js';
import { lightCapabilities } from './light-state.js';
import { readScenePreviews, validateScenePreview, captureLightSnapshot, sceneActivationAvailability, ScenePreviewController } from './scene-preview.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = (value) => JSON.parse(JSON.stringify(value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const number = (value) => typeof value === 'string' && value.trim() ? Number(value) : NaN;
const prefix = 'scene-preview-';
const defaults = () => ({ enabled: false, items: [] });
const rgbHex = (value) => Array.isArray(value) && value.length === 3 && value.every((channel) => finite(channel) && channel >= 0 && channel <= 255)
  ? '#' + value.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('') : '#ffffff';
const hexRgb = (value) => /^#[a-f0-9]{6}$/i.test(value) ? [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)) : null;
const option = (value, label, selected, disabled = false) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</option>`;

/** Future root integration:
 * - render/onChange/onInput/onClick/updatePreviews/reset/cancel/dispose, like other editors.
 * - Keep focused scene-preview-* inputs during state/registry updates; call updatePreviews.
 * - Save calls commitFeatureLayout({scene_previews: object}) exactly once.
 * - previewSceneLights(Map|null, metadata) is a rendering-only card callback. It
 *   must not replace HA states, object action chains or device control readings.
 * - Optional {controller} shares root's saved-preview controller. Otherwise this
 *   fragment owns one; getContext uses current effective settings and actual user.
 * - Tab leave/history/layout/model/permission/connection changes cancel draft
 *   previews. No hover handler activates, captures or previews an editor draft.
 */
export class ScenePreviewEditor {
  constructor(card, onRender = () => {}, { controller } = {}) {
    this.areaFilter = new EntityAreaFilter();
    this.card = card; this.onRender = onRender; this.draft = null; this.selectedIndex = -1;
    this.dirty = false; this.disposed = false; this.message = null; this.previewToken = null;
    this.activationPending = false; this._generation = 0; this._modelIds = new WeakMap(); this._modelSeq = 0;
    this._activationIntents = new WeakMap(); this._activationPressed = new Map(); this._activationRoot = null;
    this._activationHandlers = new Map([
      ['pointerdown', (event) => this._activationPress(event)], ['pointerup', (event) => this._activationRelease(event)],
      ['pointercancel', (event) => this._activationCancel(event)], ['keydown', (event) => this._activationKey(event)],
      ['keyup', (event) => this._activationRelease(event)], ['focusout', (event) => this._activationBlur(event)],
    ]);
    this.ownsController = !controller;
    this.controller = controller || new ScenePreviewController({
      getContext: () => ({ hass: this.hass, bindings: this.effective, contextKey: this._contextKey(), canEdit: this._canPreviewDraft() }),
      requestService: typeof this.card._requestSceneService === 'function'
        ? (...args) => this.card._requestSceneService(...args) : undefined,
      onPreview: (overrides, metadata) => this.card.previewSceneLights?.(overrides, metadata),
      onStatus: (status) => {
        this.previewStatus = status;
        if (status.status !== 'previewing' && status.status !== 'activating') this.previewToken = null;
        if (!this._syncing) this.updatePreviews(this.container);
      },
    });
  }
  _messages(value) { return (value?.diagnostics || []).map((diagnostic) => this._diagnostic(diagnostic)); }
  _button(action, key, attributes = '') { return `<button type="button" data-act="${prefix}${action}" ${attributes}>${this._caption(key)}</button>`; }
  get hass() { return this.card._hass || {}; }
  get message() { return readEditorExtraNotice(this.card._hass, this._message); }
  set message(value) { this._message = value; }
  _notice(key, parameters = {}) { return editorExtraNotice(key, parameters); }
  _t(key, parameters = {}) { return editorExtraText(this.card._hass, key, parameters); }
  _caption(key) { return editorExtraCaption(this.card._hass, key); }
  _diagnostic(value) { return editorExtraDiagnostic(this.card._hass, value); }
  get effective() { return this.card._layout?.scene_previews ?? this.card._config?.scene_previews; }
  get items() { return Array.isArray(this.draft?.items) ? this.draft.items : []; }
  get selected() { return this.items[this.selectedIndex]; }
  _modelKey() {
    const root = this.card._view?.model?.root;
    if (root && typeof root === 'object' && !this._modelIds.has(root)) this._modelIds.set(root, ++this._modelSeq);
    const configured = this.card._config?.model;
    return [configured ? configured : this.card._layout?.model ?? null, root ? this._modelIds.get(root) : null,
      this.card._modelAlign?.() ?? null];
  }
  _contextKey() {
    const layout = this.card._layout || {};
    return JSON.stringify([this.card._config?.layout_key, this._modelKey(),
      layout.rooms, layout.floors, layout.objects, layout.groups, layout.pins, layout.hidden, this.hass.user?.id ?? null]);
  }
  _readOnly() { return this.hass.user?.is_admin !== true || typeof this.hass.user?.id !== 'string' || !this.hass.user.id || this.hass.user.is_active === false; }
  _canPreviewDraft() { return !this._readOnly() && (this.card._scenePreviewAvailable?.(true) ?? true); }
  _load() {
    this._stopOwned();
    const raw = this.effective;
    this.badImported = raw !== undefined && !plain(raw);
    this.draft = plain(raw) ? { ...defaults(), ...clone(raw) } : defaults();
    this.baseValue = JSON.stringify(raw); this.baseContext = this._contextKey(); this.baseUser = this.hass.user;
    this.baseConnection = this.hass.connection;
    if (this.selectedIndex >= this.items.length || this.selectedIndex < 0) this.selectedIndex = this.items.length ? 0 : -1;
    this.dirty = false; this.message = null; this.previewStatus = null; this.activationPending = false;
    this._generation++;
  }
  _ensure() {
    // Keep a changed external context visible until Cancel. Reloading several
    // row values silently under a focused field could change the user's target.
    if (!this.draft) this._load();
    if (this._contextIssue() || this._readOnly() || this.hass.connected === false || this.hass.connection?.connected === false) this._stopOwned();
  }
  _contextIssue() {
    if (this.baseContext !== this._contextKey() || this.baseValue !== JSON.stringify(this.effective)
      || this.baseConnection !== this.hass.connection || this.baseUser?.id !== this.hass.user?.id) {
      return this._t('scene.context');
    }
    return null;
  }
  _referenceIssue(entity, domain) {
    const metadata = entityMetadata(this.hass, entity);
    if (typeof entity !== 'string' || !entity.startsWith(`${domain}.`)) return this._t('scene.chooseEntity', { domain });
    if (!metadata.hasState || metadata.hidden || metadata.disabled || metadata.category) return this._t('scene.badLink', { entity });
    return null;
  }
  _itemChanged(item) {
    const original = plain(this.effective) && Array.isArray(this.effective.items) ? this.effective.items.find((saved) => saved?.id === item?.id) : null;
    return JSON.stringify(original) !== JSON.stringify(item);
  }
  _saveIssues() {
    const issues = this._messages(readScenePreviews(this.draft));
    if (this.badImported) issues.push(this._t('scene.badImport'));
    if (this._readOnly()) issues.push(this._t('scene.admin'));
    if (this.hass.connection?.connected !== true) issues.push(this._t('scene.waitConnection'));
    if (this._contextIssue()) issues.push(this._contextIssue());
    for (const item of this.items.filter((value) => this._itemChanged(value))) {
      const ref = this._referenceIssue(item?.scene_entity, 'scene'); if (ref) issues.push(ref);
      if (this.items.filter((other) => other?.id === item?.id).length > 1) issues.push(this._t('scene.duplicateId'));
      if (item?.scene_entity && this.items.filter((other) => other?.scene_entity === item.scene_entity).length > 1) issues.push(this._t('scene.duplicateScene'));
      // Empty mappings can still activate a saved scene. They cannot pretend to
      // preview its non-light devices. Only deliberately changed targets need
      // current capabilities; untouched saved entries are retained verbatim.
      const checked = validateScenePreview(this.hass, item);
      issues.push(...checked.diagnostics.filter((diagnostic) => !(diagnostic.code === 'lights' && Array.isArray(item?.lights) && !item.lights.length)).map((diagnostic) => this._diagnostic(diagnostic)));
    }
    return [...new Set(issues)];
  }
  _draftValidation() { return this.selected ? validateScenePreview(this.hass, this.selected) : { valid: false, diagnostics: [] }; }
  _savedSelected() {
    const current = readScenePreviews(this.effective);
    const matching = current.items.filter((item) => item?.id === this.selected?.id);
    return current.enabled && matching.length === 1 && matching[0].scene_entity === this.selected?.scene_entity ? matching[0] : null;
  }
  _activationIssues() {
    const saved = this._savedSelected();
    if (!saved) return [this._t('scene.saveBeforeActivate')];
    if (this._contextIssue()) return [this._contextIssue()];
    return this._messages(sceneActivationAvailability(this.hass, saved.scene_entity));
  }
  _activationButton(event) {
    const button = event.target?.closest?.(`[data-act="${prefix}activate"]`);
    return button && this._activationRoot?.contains(button) ? button : null;
  }
  _activationLive(button) {
    return !this.disposed && !!this._activationRoot?.isConnected && !!button?.isConnected && this._activationRoot.contains(button);
  }
  _activationStamp() {
    const saved = this._savedSelected(), issues = this._activationIssues(), hass = this.hass;
    return { generation: this._generation, id: this.selected?.id, entity: saved?.scene_entity,
      connection: hass.connection, callService: hass.callService,
      contextKey: JSON.stringify([this._contextKey(), this.card._scenePreviewKey?.()]),
      available: !this.activationPending && !issues.length,
      semantic: JSON.stringify([this.effective, this.selected?.scene_entity, hass.user?.id, hass.user?.is_active,
        hass.user?.is_admin, hass.user?.permissions, hass.services?.scene?.turn_on,
        this.card._scenePreviewAvailable?.(true), issues]) };
  }
  _sameActivationStamp(stamp, next = this._activationStamp()) {
    return next.available && stamp.generation === next.generation && stamp.id === next.id && stamp.entity === next.entity
      && stamp.connection === next.connection && stamp.callService === next.callService
      && stamp.contextKey === next.contextKey && stamp.semantic === next.semantic;
  }
  _revalidateActivationPresses() {
    for (const [button, intent] of this._activationPressed) {
      if (!intent.poisoned && (!this._activationLive(button) || !this._sameActivationStamp(intent.stamp))) intent.poisoned = true;
    }
  }
  _unbindActivationRoot() {
    for (const [button, intent] of this._activationPressed) {
      // Retain cancellation weakly on the old node. A delayed click after
      // reset/detach must not be mistaken for an accessibility-only action.
      intent.poisoned = true; this._activationIntents.set(button, intent);
    }
    this._activationPressed.clear();
    if (this._activationRoot) for (const [type, handler] of this._activationHandlers) this._activationRoot.removeEventListener(type, handler, true);
    this._activationRoot = null;
  }
  _bindActivationRoot(root) {
    if (this._activationRoot === root) return;
    this._unbindActivationRoot(); this._activationRoot = root;
    for (const [type, handler] of this._activationHandlers) root.addEventListener(type, handler, true);
  }
  _activationPress(event) {
    const button = this._activationButton(event);
    if (!button || !this._activationLive(button) || event.button !== undefined && event.button !== 0 || event.isPrimary === false) return;
    this._ensure();
    const stamp = this._activationStamp();
    const intent = { stamp, poisoned: !stamp.available || button.disabled, consumed: false, held: true,
      kind: event.type === 'keydown' ? 'keyboard' : 'pointer', key: event.key, pointerId: event.pointerId };
    this._activationIntents.set(button, intent); this._activationPressed.set(button, intent);
  }
  _activationKey(event) {
    if (!['Enter', ' '].includes(event.key)) return;
    const button = this._activationButton(event); if (!button) return;
    const intent = this._activationIntents.get(button);
    if (event.repeat || intent?.held && intent.kind === 'keyboard') {
      // Enter may generate native clicks on every repeated keydown. A held key
      // is one intent, including when this form was attached mid-keypress.
      if (!intent) {
        const cancelled = { stamp: this._activationStamp(), poisoned: true, consumed: false, held: true, kind: 'keyboard', key: event.key };
        this._activationIntents.set(button, cancelled); this._activationPressed.set(button, cancelled);
      }
      this._revalidateActivationPresses(); return;
    }
    this._activationPress(event);
  }
  _activationRelease(event) {
    const button = this._activationButton(event), intent = this._activationIntents.get(button);
    if (!intent || event.type === 'keyup' && (intent.kind !== 'keyboard' || intent.key !== event.key)
      || event.type === 'pointerup' && (intent.kind !== 'pointer' || intent.pointerId !== undefined && event.pointerId !== intent.pointerId)) return;
    this._revalidateActivationPresses(); intent.held = false;
  }
  _activationCancel(event) {
    const intent = this._activationIntents.get(this._activationButton(event)); if (intent) { intent.poisoned = true; intent.held = false; }
  }
  _activationBlur(event) {
    const intent = this._activationIntents.get(this._activationButton(event)); if (intent?.held) { intent.poisoned = true; intent.held = false; }
  }
  _consumeActivationIntent(button) {
    // Assistive technology and explicit .click() calls can have no preceding
    // pointer/key event. Permit that path unless this exact node has an old,
    // interrupted/consumed gesture. A fresh press deliberately replaces it.
    if (!button) return true;
    if (!this._activationLive(button) || button.dataset.binding !== this.selected?.id) return false;
    this._revalidateActivationPresses(); const intent = this._activationIntents.get(button);
    if (!intent) return !button.disabled;
    if (intent.poisoned || intent.consumed || !this._sameActivationStamp(intent.stamp)) { intent.poisoned = true; return false; }
    intent.consumed = true; return true;
  }
  _previewIssues() {
    const issues = this._messages(this._draftValidation());
    if (this.selected) issues.push(...this._messages(sceneActivationAvailability(this.hass, this.selected.scene_entity)));
    if (!readScenePreviews(this.effective).enabled || this.draft.enabled !== true) issues.push(this._t('scene.saveEnabled'));
    if (!this.selected) issues.push(this._t('scene.choosePreview'));
    if (this._readOnly()) issues.push(this._t('scene.draftAdmin'));
    if (this.card._scenePreviewAvailable?.(true) === false) issues.push(this._t('scene.showEditor'));
    if (this._contextIssue()) issues.push(this._contextIssue());
    if (this.ownsController && typeof this.card.previewSceneLights !== 'function') issues.push(this._t('scene.noRenderer'));
    return [...new Set(issues)];
  }
  _stopOwned() {
    if (this.previewToken !== null) this.controller.stop(this.previewToken);
    this.previewToken = null;
  }
  _changed() { this._stopOwned(); this.dirty = true; this.message = null; this.previewStatus = null; }
  _choices(domain, selected = '') {
    return this.areaFilter.choices(this.hass, entityChoices(this.hass, { domains: [domain], selected,
      ...(domain === 'light' ? { capability: (metadata) => lightCapabilities(metadata.state).valid } : {}) })).map((choice) => {
      // A stateless scene can legitimately report unknown before it reports an
      // activation time. Generic sensor metadata calls that unavailable.
      const restored = choice.state?.attributes?.restored;
      return domain === 'scene' && choice.selectable && choice.state?.state === 'unknown' && (restored === undefined || restored === false)
        ? { ...choice, label: `${choice.name} (${this._t('scene.noTime')})` } : choice;
    });
  }
  _entityOptions(domain, selected = '') {
    return option('', this._t('scene.chooseSource', { domain }), selected) + this._choices(domain, selected).map((entry) => option(entry.value, entry.label, selected, !entry.selectable)).join('');
  }
  _selectOptions() {
    return option('', this._t('scene.chooseSaved'), String(this.selectedIndex)) + this.items.map((item, index) => option(String(index),
      plain(item) ? item.label || item.scene_entity || this._t('scene.defaultPreview', { number: index + 1 }) : this._t('scene.malformedPreview', { number: index + 1 }), String(this.selectedIndex))).join('');
  }
  _colorOptions(caps, mode = '') {
    const choices = [{ value: '', label: this._t('scene.chooseColor') },
      ...(caps.rgb ? [{ value: 'rgb', label: this._t('scene.rgb') }] : []),
      ...(caps.colorTemperature ? [{ value: 'kelvin', label: this._t('scene.kelvin') }] : [])];
    if (mode && !choices.some((choice) => choice.value === mode)) choices.unshift({ value: mode, label: this._t('scene.savedMode', { mode }), disabled: true });
    return choices.map((choice) => option(choice.value, choice.label, mode, choice.disabled)).join('');
  }
  _kelvinHint(caps) {
    return caps.colorTemperature ? this._t('scene.kelvinReading', { min: caps.minKelvin, max: caps.maxKelvin }) : this._t('scene.noKelvin');
  }
  _rgbHint(target) {
    const rgb = target?.color?.rgb;
    return Array.isArray(rgb) && rgb.length === 3 && rgb.every((channel) => finite(channel) && channel >= 0 && channel <= 255)
      ? this._t('scene.chosenColor')
      : this._t('scene.noRgb');
  }
  _targetHtml(target, index) {
    const binding = this.selected?.id ?? '', attrs = `data-binding="${esc(binding)}" data-target="${index}" data-entity="${esc(target?.entity ?? '')}"`;
    if (!plain(target)) return `<section class="scene-preview-light"><p>${esc(this._t('scene.badTarget', { number: index + 1 }))}</p>${this._button('remove-light', 'scene.removeTarget', attrs)}</section>`;
    const metadata = entityMetadata(this.hass, target.entity), caps = lightCapabilities(metadata.state);
    const reference = this._referenceIssue(target.entity, 'light');
    const blocked = this._readOnly() || this._contextIssue() || reference || !caps.valid;
    const disabled = blocked ? 'disabled' : '', mode = target.color?.mode ?? '';
    return `<section class="scene-preview-light"><h4>${esc(metadata.name || target.entity || this._t('scene.defaultLight', { number: index + 1 }))}</h4>
      <p data-scene-preview-reading="${index}" class="scene-preview-hint"></p>
      <label>${this._caption('scene.lightSource')}<select data-field="${prefix}light-entity" ${attrs} ${this._readOnly() || this._contextIssue() ? 'disabled' : ''}>${this._entityOptions('light', target.entity)}</select></label>
      <label>${this._caption('scene.visualState')}<select data-field="${prefix}light-state" ${attrs} ${disabled}>${option('', this._t('scene.onOff'), target.state)}${option('on', this._t('scene.on'), target.state)}${option('off', this._t('scene.off'), target.state)}</select></label>
      <label>${this._caption('scene.brightness')}<input type="number" inputmode="decimal" min="0" max="255" step="1" data-field="${prefix}light-brightness" ${attrs} value="${esc(target.brightness ?? '')}" ${blocked || !caps.brightness ? 'disabled' : ''}></label>
      <label>${this._caption('scene.colorType')}<select data-field="${prefix}light-color-mode" ${attrs} ${blocked || !caps.rgb && !caps.colorTemperature ? 'disabled' : ''}>${this._colorOptions(caps, mode)}</select></label>
      <p class="scene-preview-hint" data-scene-preview-capabilities="${index}">${caps.rgb || caps.colorTemperature ? this._t('scene.supportedColor') : this._t('scene.fixedColor')}</p>
      ${mode === 'rgb' ? `<label>${this._caption('scene.chooseRgb')}<input type="color" data-field="${prefix}light-rgb" ${attrs} value="${rgbHex(target.color?.rgb)}" ${blocked || !caps.rgb ? 'disabled' : ''}></label>${this._button('use-rgb', 'scene.useRgb', `${attrs} ${blocked || !caps.rgb ? 'disabled' : ''}`)}<p class="scene-preview-hint" data-scene-preview-rgb-hint="${index}" ${attrs}>${esc(this._rgbHint(target))}</p>` : ''}
      ${mode === 'kelvin' ? `<label>${this._caption('scene.temperature')}<input type="number" inputmode="decimal" step="1" ${caps.minKelvin === null ? '' : `min="${caps.minKelvin}" max="${caps.maxKelvin}"`} data-field="${prefix}light-kelvin" ${attrs} value="${esc(target.color?.kelvin ?? '')}" ${blocked || !caps.colorTemperature ? 'disabled' : ''}></label><p class="scene-preview-hint" data-scene-preview-kelvin-limits="${index}">${esc(this._kelvinHint(caps))}</p>` : ''}
      ${this._button('remove-light', 'scene.removeLight', `${attrs} ${this._readOnly() || this._contextIssue() ? 'disabled' : ''}`)}</section>`;
  }
  _statusHtml() {
    const preview = this._previewIssues(), activation = this._activationIssues();
    const captured = this.selected?.captured_at;
    let capturedLabel = captured;
    if (finite(captured) && Math.abs(captured) <= 8.64e15) capturedLabel = new Date(captured).toISOString();
    return `<p><strong>${this.previewToken !== null ? this._t('scene.active') : this._t('scene.stopped')}</strong></p>
      ${captured !== undefined ? `<p>${esc(this._t('scene.snapshot', { time: capturedLabel }))}</p>` : ''}
      ${this.message ? `<p role="status">${esc(this.message)}</p>` : ''}
      ${this.previewStatus?.error ? `<p role="alert">${esc(this.previewStatus.error)}</p>` : ''}
      ${preview.length ? `<p class="scene-preview-hint">${this._caption('scene.previewLabel')} ${preview.map(esc).join(' ')}</p>` : ''}
      ${activation.length ? `<p class="scene-preview-hint">${this._caption('scene.activationLabel')} ${activation.map(esc).join(' ')}</p>` : ''}
      ${this._saveIssues().length ? `<ul>${this._saveIssues().map((message) => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}`;
  }
  render() {
    if (this.disposed) return '';
    this._ensure();
    const blocked = this._readOnly() || this._contextIssue(), disabled = blocked ? 'disabled' : '', selected = this.selected;
    return `<section data-scene-preview-editor data-taylors3d-ui="scene-preview-editor"><style>
      [data-scene-preview-editor]{color:var(--primary-text-color,#212121)}[data-scene-preview-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0}
      [data-scene-preview-editor] input,[data-scene-preview-editor] select,[data-scene-preview-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-scene-preview-editor] input:not([type=checkbox]),[data-scene-preview-editor] select{width:100%}[data-scene-preview-editor] input[type=color]{padding:4px;min-width:60px}
      [data-scene-preview-editor] .scene-preview-check{flex-direction:row;align-items:center}[data-scene-preview-editor] .scene-preview-check input{min-width:22px;flex-shrink:0}
      [data-scene-preview-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-scene-preview-editor] .scene-preview-actions{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}
      [data-scene-preview-editor] .scene-preview-light{border-top:1px solid var(--divider-color,#888);padding:8px 0}[data-scene-preview-editor] .scene-preview-hint{color:var(--secondary-text-color,#666)}[data-scene-preview-editor] p,[data-scene-preview-editor] li{overflow-wrap:anywhere}
      [data-scene-preview-editor] button{cursor:pointer}[data-scene-preview-editor] :disabled{opacity:.6;cursor:default}
      </style><h3>${this._caption('scene.title')}</h3><p>${this._caption('scene.intro')}</p>
      <label class="scene-preview-check"><input type="checkbox" data-field="${prefix}enabled" ${this.draft.enabled === true ? 'checked' : ''} ${disabled}> ${this._caption('scene.enable')}</label>
      <label>${this._caption('scene.saved')}<select data-field="${prefix}binding">${this._selectOptions()}</select></label>
      ${this.areaFilter.render(this.hass, `${prefix}area-filter`)}
      <div class="scene-preview-actions">${this._button('add', 'scene.add', disabled)}${this._button('remove', 'scene.remove', `${disabled} ${selected ? '' : 'disabled'}`)}${this._button('repair', 'scene.newList', `${this.badImported || !Array.isArray(this.draft.items) ? '' : 'hidden'} ${disabled}`)}</div>
      ${plain(selected) ? `<label>${this._caption('scene.label')}<input type="text" data-field="${prefix}label" data-binding="${esc(selected.id)}" value="${esc(selected.label ?? '')}" ${disabled}></label>
      <label>${this._caption('scene.entity')}<select data-field="${prefix}scene-entity" data-binding="${esc(selected.id)}" ${disabled}>${this._entityOptions('scene', selected.scene_entity)}</select></label>
      <p class="scene-preview-hint">${this._caption('scene.actionHelp')}</p>
      ${Array.isArray(selected.lights) ? selected.lights.map((target, index) => this._targetHtml(target, index)).join('') : `<p>${this._caption('scene.badLightList')}</p>`}
      <label>${this._caption('scene.newLight')}<select data-field="${prefix}new-light" ${disabled}>${this._entityOptions('light', '')}</select></label>
      <div class="scene-preview-actions">${this._button('add-light', 'scene.addLight', `${disabled} data-binding="${esc(selected.id)}"`)}${this._button('capture', 'scene.capture', `${disabled} data-binding="${esc(selected.id)}"`)}</div>
      <p class="scene-preview-hint">${this._caption('scene.captureHelp')}</p>
      <div class="scene-preview-actions">${this._button('preview', 'scene.preview', `${this._previewIssues().length ? 'disabled' : ''} data-binding="${esc(selected.id)}"`)}${this._button('stop', 'scene.stop', this.previewToken === null ? 'disabled' : '')}${this._button('activate', 'scene.activate', `${this.activationPending || this._activationIssues().length ? 'disabled' : ''} data-binding="${esc(selected.id)}"`)}</div>` : ''}
      <div data-scene-preview-status aria-live="polite">${this._statusHtml()}</div>
      <div class="scene-preview-actions">${this._button('save', 'scene.save', `${!this.dirty || this._saveIssues().length ? 'disabled' : ''}`)}${this._button('cancel', 'common.cancel')}</div></section>`;
  }
  _syncSelect(select, options) {
    if (!select) return;
    const current = select.value;
    const host = document.createElement('select'); host.innerHTML = options;
    const desired = [...host.options], existing = new Map([...select.options].map((option) => [option.value, option])), keep = new Set();
    for (const [index, option] of desired.entries()) {
      const live = existing.get(option.value) || document.createElement('option'); live.value = option.value;
      if (live.textContent !== option.textContent) live.textContent = option.textContent;
      live.disabled = option.disabled;
      if (select.options[index] !== live) select.insertBefore(live, select.options[index] || null);
      keep.add(live);
    }
    for (const option of [...select.options]) if (!keep.has(option)) option.remove();
    select.value = current;
  }
  updatePreviews(container) {
    if (this.disposed || !container || this._syncing) return;
    this._syncing = true;
    try {
      this._ensure(); this.controller.revalidate();
      if (this.previewToken !== this.controller.active?.token) this.previewToken = null;
      const root = container.matches?.('[data-scene-preview-editor]') ? container : container.querySelector('[data-scene-preview-editor]');
      if (!root) return; this.container = root;
      this._bindActivationRoot(root); this._revalidateActivationPresses();
      updateEditorExtraCaptions(root, this.card._hass);
      this.areaFilter.update(this.hass, root, `${prefix}area-filter`);
      const status = root.querySelector('[data-scene-preview-status]'), html = this._statusHtml();
      if (status && status.innerHTML !== html) status.innerHTML = html;
      const blocked = this._readOnly() || !!this._contextIssue() || this.hass.connection?.connected !== true;
      for (const input of root.querySelectorAll('[data-field]')) {
        if (input.dataset.field === `${prefix}binding`) continue;
        const index = Number(input.dataset.target), target = Number.isInteger(index) ? this.selected?.lights?.[index] : null;
        if (input.dataset.target !== undefined && plain(target)) {
          const caps = lightCapabilities(entityMetadata(this.hass, target.entity).state), missing = !!this._referenceIssue(target.entity, 'light');
          const capability = input.dataset.field.endsWith('brightness') ? caps.brightness : input.dataset.field.endsWith('rgb') ? caps.rgb : input.dataset.field.endsWith('kelvin') ? caps.colorTemperature : input.dataset.field.endsWith('color-mode') ? caps.rgb || caps.colorTemperature : true;
          input.disabled = blocked || input.dataset.field !== `${prefix}light-entity` && (missing || !caps.valid || !capability);
          if (input.dataset.field.endsWith('kelvin')) {
            if (caps.colorTemperature) { input.min = caps.minKelvin; input.max = caps.maxKelvin; }
            else { input.removeAttribute('min'); input.removeAttribute('max'); }
          }
          if (input.dataset.field.endsWith('color-mode')) this._syncSelect(input, this._colorOptions(caps, target.color?.mode));
        } else input.disabled = blocked;
      }
      this._syncSelect(root.querySelector(`[data-field="${prefix}scene-entity"]`), this._entityOptions('scene', this.selected?.scene_entity));
      this._syncSelect(root.querySelector(`[data-field="${prefix}new-light"]`), this._entityOptions('light', ''));
      for (const input of root.querySelectorAll(`[data-field="${prefix}light-state"]`)) { const target = this._target(input); if (target) this._syncSelect(input, option('', this._t('scene.onOff'), target.state) + option('on', this._t('scene.on'), target.state) + option('off', this._t('scene.off'), target.state)); }
      for (const input of root.querySelectorAll(`[data-field="${prefix}light-entity"]`)) this._syncSelect(input, this._entityOptions('light', this.selected?.lights?.[Number(input.dataset.target)]?.entity));
      for (const reading of root.querySelectorAll('[data-scene-preview-reading]')) {
        const target = this.selected?.lights?.[Number(reading.dataset.scenePreviewReading)], metadata = entityMetadata(this.hass, target?.entity);
        const text = this._t('scene.actualReading', { value: formatEntityValue(this.hass, target?.entity), warning: this._referenceIssue(target?.entity, 'light') || this._messages(lightCapabilities(metadata.state)).join(' ') });
        if (reading.textContent !== text) reading.textContent = text;
      }
      for (const note of root.querySelectorAll('[data-scene-preview-kelvin-limits],[data-scene-preview-capabilities]')) {
        const target = this.selected?.lights?.[Number(note.dataset.scenePreviewKelvinLimits ?? note.dataset.scenePreviewCapabilities)];
        const caps = lightCapabilities(entityMetadata(this.hass, target?.entity).state);
        const text = note.dataset.scenePreviewKelvinLimits !== undefined ? this._kelvinHint(caps)
          : caps.rgb || caps.colorTemperature ? this._t('scene.supportedColor') : this._t('scene.fixedColor');
        if (note.textContent !== text) note.textContent = text;
      }
      for (const note of root.querySelectorAll('[data-scene-preview-rgb-hint]')) {
        const target = this._target(note); if (!target || target.color?.mode !== 'rgb') continue;
        const text = this._rgbHint(target); if (note.textContent !== text) note.textContent = text;
      }
      for (const control of root.querySelectorAll(`[data-act="${prefix}use-rgb"]`)) {
        const target = this._target(control), caps = lightCapabilities(entityMetadata(this.hass, target?.entity).state);
        control.disabled = blocked || !!this._referenceIssue(target?.entity, 'light') || !caps.valid || !caps.rgb;
      }
      for (const action of ['add', 'remove', 'repair', 'add-light', 'capture']) {
        const control = root.querySelector(`[data-act="${prefix}${action}"]`); if (control) control.disabled = blocked || action === 'remove' && !this.selected;
      }
      for (const control of root.querySelectorAll(`[data-act="${prefix}remove-light"]`)) control.disabled = blocked;
      const save = root.querySelector(`[data-act="${prefix}save"]`); if (save) save.disabled = !this.dirty || this._saveIssues().length > 0;
      const preview = root.querySelector(`[data-act="${prefix}preview"]`); if (preview) preview.disabled = this._previewIssues().length > 0;
      const stop = root.querySelector(`[data-act="${prefix}stop"]`); if (stop) stop.disabled = this.previewToken === null;
      const activate = root.querySelector(`[data-act="${prefix}activate"]`); if (activate) activate.disabled = this.activationPending || this._activationIssues().length > 0;
    } finally { this._syncing = false; }
  }
  _target(element) {
    const index = Number(element?.dataset?.target), target = this.selected?.lights?.[index];
    return Number.isInteger(index) && index >= 0 && plain(target) && element.dataset.binding === this.selected?.id && element.dataset.entity === target.entity ? target : null;
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith(prefix) || !element) return false;
    this._ensure(); const name = field.slice(prefix.length);
    if (name === 'area-filter') {
      if (element.isConnected !== false && this.areaFilter.set(this.hass, element.value)) this.updatePreviews(element.closest('[data-scene-preview-editor]'));
      return true;
    }
    if (name === 'binding') {
      if (element.value === '') { this._stopOwned(); this.selectedIndex = -1; this.message = null; this.onRender(); return true; }
      const index = number(element.value); if (Number.isInteger(index) && index >= 0 && index < this.items.length) {
        this._stopOwned(); this.selectedIndex = index; this.message = null; this.onRender();
      } return true;
    }
    if (this._readOnly() || this._contextIssue() || this.hass.connection?.connected !== true) return true;
    if (element.isConnected === false || element.dataset?.binding !== undefined && element.dataset.binding !== this.selected?.id) return true;
    if (name === 'new-light') return true;
    if (name === 'enabled') this.draft.enabled = element.checked === true;
    else if (!plain(this.selected)) return true;
    else if (name === 'label') this.selected.label = element.value;
    else if (name === 'scene-entity') {
      if (!this._choices('scene', this.selected.scene_entity).some((choice) => choice.value === element.value && choice.selectable)) return true;
      this.selected.scene_entity = element.value;
    } else {
      const target = this._target(element); if (!target) return true;
      const caps = lightCapabilities(entityMetadata(this.hass, target.entity).state);
      if (name === 'light-entity') {
        if (!this._choices('light').some((choice) => choice.value === element.value && choice.selectable)) return true;
        target.entity = element.value; this._changed(); this.onRender(); return true;
      }
      if (this._referenceIssue(target.entity, 'light') || !caps.valid) return true;
      if (name === 'light-state' && ['on', 'off'].includes(element.value)) target.state = element.value;
      else if (name === 'light-brightness' && caps.brightness) {
        if (element.value === '') delete target.brightness; else target.brightness = number(element.value);
      } else if (name === 'light-color-mode' && (element.value === '' || element.value === 'rgb' && caps.rgb || element.value === 'kelvin' && caps.colorTemperature)) {
        const extension = plain(target.color) ? { ...target.color } : {}; delete extension.rgb; delete extension.kelvin;
        if (!element.value) delete target.color;
        else target.color = { ...extension, mode: element.value, ...(element.value === 'rgb' ? { rgb: [] } : { kelvin: '' }) };
        this._changed(); this.onRender(); return true;
      } else if (name === 'light-rgb' && caps.rgb && target.color?.mode === 'rgb') {
        const rgb = hexRgb(element.value); if (!rgb) return true; target.color = { ...target.color, rgb };
      } else if (name === 'light-kelvin' && caps.colorTemperature && target.color?.mode === 'kelvin') target.color = { ...target.color, kelvin: element.value === '' ? '' : number(element.value) };
      else return false;
    }
    this._changed(); this.updatePreviews(element.closest('[data-scene-preview-editor]')); return true;
  }
  onInput(field, element) {
    if (field === `${prefix}label` || field === `${prefix}light-brightness` || field === `${prefix}light-rgb` || field === `${prefix}light-kelvin`) return this.onChange(field, element);
    return !!field?.startsWith(prefix);
  }
  async _activate() {
    if (this.activationPending || this._activationIssues().length) return;
    const generation = this._generation, id = this.selected.id, expectedSceneEntity = this.selected.scene_entity;
    this._stopOwned();
    if (generation !== this._generation || this._contextIssue()) return;
    this.activationPending = true;
    this.updatePreviews(this.container);
    try {
      const result = await this.controller.activate(id, { expectedSceneEntity });
      if (generation === this._generation && id === this.selected?.id && result.current !== false && !this._contextIssue()) this.message = result.ok ? this._notice('scene.accepted') : result.error || this._messages(result).join(' ') || this._notice('scene.unavailable');
    } catch (error) {
      if (generation === this._generation) this.message = error?.message || this._notice('scene.failed');
    } finally {
      if (generation === this._generation) { this.activationPending = false; this.updatePreviews(this.container); }
    }
  }
  onClick(action, element) {
    if (this.disposed || !action?.startsWith(prefix)) return false;
    this._ensure(); const name = action.slice(prefix.length);
    if (element?.isConnected === false || element?.dataset?.binding !== undefined && element.dataset.binding !== this.selected?.id) return true;
    if (name === 'cancel') { this.reset(); this.onRender(); return true; }
    if (name === 'stop') { this.controller.stop(); this.previewToken = null; this.updatePreviews(this.container); return true; }
    if (name === 'activate') { if (this._consumeActivationIntent(element)) void this._activate(); return true; }
    if (this._readOnly() || this._contextIssue() || this.hass.connection?.connected !== true) return true;
    if (name === 'preview') {
      if (this._previewIssues().length) { this.message = this._previewIssues().join(' '); this.updatePreviews(this.container); return true; }
      const result = this.controller.previewDraft(clone(this.selected)); this.previewToken = result.ok ? result.token : null;
      this.message = result.ok ? null : this._messages(result).join(' '); this.updatePreviews(this.container); return true;
    }
    if (name === 'save') {
      if (!this.dirty || this._saveIssues().length || typeof this.card.commitFeatureLayout !== 'function') { this.message = this._saveIssues()[0] || this._notice('scene.noChanges'); this.updatePreviews(this.container); return true; }
      this._stopOwned(); this.card.commitFeatureLayout({ scene_previews: clone(this.draft) }); this.reset(); this.onRender(); return true;
    }
    if (name === 'repair') {
      this.draft = { ...(plain(this.effective) ? clone(this.effective) : {}), ...defaults() }; this.badImported = false; this.selectedIndex = -1;
    } else if (name === 'add') {
      if (!Array.isArray(this.draft.items)) return true;
      let suffix = 1; while (this.items.some((item) => item?.id === `preview-${suffix}`)) suffix++;
      this.items.push({ id: `preview-${suffix}`, label: '', scene_entity: '', lights: [] }); this.selectedIndex = this.items.length - 1;
    } else if (name === 'remove') {
      if (this.selectedIndex < 0) return true; this.items.splice(this.selectedIndex, 1); this.selectedIndex = this.items.length ? Math.min(this.selectedIndex, this.items.length - 1) : -1;
    } else if (name === 'add-light') {
      const source = element?.closest('[data-scene-preview-editor]')?.querySelector(`[data-field="${prefix}new-light"]`)?.value;
      if (!source || !Array.isArray(this.selected?.lights) || this.selected.lights.some((target) => target?.entity === source)
        || !this._choices('light').some((choice) => choice.value === source && choice.selectable)) return true;
      this.selected.lights.push({ entity: source, state: '' });
    } else if (name === 'remove-light') {
      const index = Number(element?.dataset?.target);
      if (!Number.isInteger(index) || index < 0 || !Array.isArray(this.selected?.lights) || element.dataset.binding !== this.selected.id) return true;
      this.selected.lights.splice(index, 1);
    } else if (name === 'use-rgb') {
      const target = this._target(element), caps = lightCapabilities(entityMetadata(this.hass, target?.entity).state);
      const input = element?.closest('.scene-preview-light')?.querySelector(`[data-field="${prefix}light-rgb"]`);
      const rgb = hexRgb(input?.value);
      if (!target || this._referenceIssue(target.entity, 'light') || !caps.rgb || !caps.valid || target.color?.mode !== 'rgb' || !rgb) return true;
      target.color = { ...target.color, rgb };
    } else if (name === 'capture') {
      if (!Array.isArray(this.selected?.lights) || !this.selected.lights.length) return true;
      const result = captureLightSnapshot(this.hass, this.selected.lights.map((target) => target?.entity), { now: Date.now() });
      if (!result.valid) { this.message = this._messages(result).join(' '); this.updatePreviews(this.container); return true; }
      const old = new Map(this.selected.lights.map((target) => [target.entity, target]));
      this.selected.lights = result.lights.map((target) => {
        const preserved = { ...old.get(target.entity) }; delete preserved.state; delete preserved.brightness; delete preserved.color;
        const extension = plain(old.get(target.entity)?.color) ? { ...old.get(target.entity).color } : {};
        delete extension.mode; delete extension.rgb; delete extension.kelvin;
        return { ...preserved, ...target, ...(target.color ? { color: { ...extension, ...target.color } } : {}) };
      });
      this.selected.captured_at = result.captured_at;
    } else return false;
    this._changed(); this.onRender(); return true;
  }
  reset() {
    this._unbindActivationRoot(); this.container = null;
    this._stopOwned(); this.draft = null; this.dirty = false; this.message = null; this.previewStatus = null;
    this.activationPending = false; this._generation++;
  }
  cancel() { this.reset(); }
  dispose() { this.disposed = true; this.reset(); if (this.ownsController) this.controller.dispose?.(); }
}
