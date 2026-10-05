// Display settings are drafts until Save. This editor never alters a GLB,
// creates baked textures, changes current HA states or sends a device command.
import { readModelRendering, modelShadingReport } from './model-rendering.js';
import { localize } from './localization.js';
import { renderAdvancedCaptions, updateAdvancedCaptions } from './translations/advanced-settings.js';
import { editorDetailText, editorDetailSpan, updateEditorDetails, editorOwnedMessage } from './editor-runtime-details.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const plain = (value) => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = (value) => JSON.parse(JSON.stringify(value));
const prefix = 'model-rendering-';
const presets = [
  { id: 'normal', label: 'Normal', shadows: 'realtime', lamps: 'inherit' },
  { id: 'no-shadows', label: 'No realtime shadows', shadows: 'off', lamps: 'inherit' },
  { id: 'authored', label: 'Authored shading (lamps off)', shadows: 'off', lamps: 'off' },
  { id: 'shadows-only', label: 'Realtime shadows (lamps off)', shadows: 'realtime', lamps: 'off' },
];
const presetFor = (value) => {
  const policy = readModelRendering(value);
  return policy.valid ? presets.find((preset) => preset.shadows === policy.shadows && preset.lamps === policy.lamps)?.id ?? 'custom' : 'invalid';
};

/** EditMode fragment: render/onClick/onChange/onInput/updatePreviews/reset/cancel/dispose.
 * Effective source is layout.model_rendering ?? config.model_rendering. Only Save
 * calls commitFeatureLayout. Root applies saved policy; this editor has no live
 * rendering override. Focused model-rendering-* controls must survive HA updates.
 */
export class ModelRenderingEditor {
  _captions(html) { return renderAdvancedCaptions(html, 'shading', (key, fallback) => localize(this.card._hass, key, {}, fallback)); }
  _translateCaptions(root) { updateAdvancedCaptions(root, 'shading', (key, fallback) => localize(this.card._hass, key, {}, fallback)); updateEditorDetails(root, this.card._hass); }
  _text(id, params) { return editorDetailText(this.card._hass, `shading.${id}`, params); }
  _help(id) { return editorDetailSpan(this.card._hass, `shading.${id}`); }
  _message(value) { return editorOwnedMessage(this.card._hass, value); }
  _presetLabel(preset) { return preset ? localize(this.card._hass, `advanced.shading.preset.${preset.id}`, {}, preset.label) : this._text('imported'); }
  constructor(card, onRender = () => {}) {
    this.card = card;
    this.onRender = onRender;
    this.draft = null;
    this.dirty = false;
    this.disposed = false;
    this.message = null;
  }

  get effective() { return this.card._layout?.model_rendering ?? this.card._config?.model_rendering; }
  get modelRoot() { return this.card._view?.model?.root ?? null; }
  _load() {
    const value = this.effective;
    this.imported = value;
    this.draft = plain(value) ? copy(value) : value === undefined ? {} : copy(value);
    this.baseValue = JSON.stringify(value);
    this.baseKey = this.card._config?.layout_key;
    this.baseModelRoot = this.modelRoot;
    this.baseModelSource = this._modelSource();
    this.selection = presetFor(value);
    this.dirty = false;
    this.message = null;
  }
  _modelSource() {
    // Match root _loadModel(): only a truthy YAML URL selects that source. An
    // empty URL must not mask an uploaded replacement awaiting its new root.
    const configured = this.card._config?.model;
    return JSON.stringify(configured ? configured : this.card._layout?.model ?? null);
  }
  _ensure() {
    if (!this._loaded || !this.dirty && (JSON.stringify(this.effective) !== this.baseValue
      || this.baseKey !== this.card._config?.layout_key || this.baseModelRoot !== this.modelRoot || this.baseModelSource !== this._modelSource())) {
      this._load(); this._loaded = true;
    }
  }
  _contextIssue() {
    if (this.baseKey !== this.card._config?.layout_key || this.baseValue !== JSON.stringify(this.effective)
      || this.baseModelRoot !== this.modelRoot || this.baseModelSource !== this._modelSource()) {
      return 'The saved settings or model changed while you were editing. Your choice is kept. Cancel to load the latest settings before saving.';
    }
    return null;
  }
  _readOnly() { return this.card._hass?.user?.is_admin !== true; }
  _evaluation() {
    const policy = readModelRendering(this.draft), issues = policy.diagnostics.map((diagnostic) => diagnostic.message);
    if (this._readOnly()) issues.push('Only an administrator can save layout settings.');
    const context = this._contextIssue(); if (context) issues.push(context);
    return { policy, issues };
  }
  _reportHtml() {
    const report = modelShadingReport(this.modelRoot);
    if (!report.hasModel) return `<p>${esc(this._text('noModel'))}</p>`;
    const counts = report.counts;
    return `<p>${esc(this._text('loaded', { meshes: counts.meshes, materials: counts.materials }))}</p>
      <ul><li>${esc(this._text('ao', { count: counts.aoMaterials }))}</li>
      <li>${esc(this._text('unlit', { count: counts.unlitMaterials }))}</li>
      <li>${esc(this._text('lightMap', { count: counts.lightMapMaterials }))}</li></ul>
      <p>${esc(this._text('coordinates', { channels: report.uvChannels.length ? report.uvChannels.map((channel) => this._text('channel', { attribute: channel.attribute, count: channel.materialUses })).join(' · ') : this._text('none') }))}</p>
      <p class="model-rendering-hint">${esc(this._text('reportHelp'))}</p>
      ${report.missingUV.length ? `<p role="status">${esc(this._text('missingUV', { count: report.missingUV.length }))}</p><ul>${report.missingUV.map((issue) => `<li>${esc(issue.meshName || issue.meshId)} · ${esc(issue.materialName || issue.materialId)}: ${esc(this._text('needs', { slot: issue.slot, attribute: issue.attribute }))}</li>`).join('')}</ul>` : ''}
      ${report.diagnostics.length ? `<ul>${report.diagnostics.map((diagnostic) => `<li>${esc(diagnostic.code === 'missing_uv' && diagnostic.message === `A material's ${diagnostic.slot} requires a complete ${diagnostic.attribute} mesh attribute.` ? this._text('requires', { slot: diagnostic.slot, attribute: diagnostic.attribute }) : this._message(diagnostic))}</li>`).join('')}</ul>` : ''}`;
  }
  _statusHtml() {
    const { policy, issues } = this._evaluation();
    const saved = readModelRendering(this.effective);
    const savedPreset = presets.find((preset) => preset.shadows === saved.shadows && preset.lamps === saved.lamps);
    const current = saved.valid ? savedPreset ? this._presetLabel(savedPreset) : this._text('custom', { shadows: saved.shadows, lamps: saved.lamps }) : this._text('invalidSaved');
    return `<p>${esc(this._text('current'))} <strong>${esc(current)}</strong>.</p>
      ${this.dirty ? `<p>${esc(this._text('unsaved'))} <strong>${esc(this._presetLabel(presets.find((preset) => preset.id === this.selection)))}</strong>. ${esc(this._text('saveApply'))}</p>` : ''}
      <p class="model-rendering-hint">${esc(this._text(policy.lamps === 'off' ? 'lampsOff' : 'lampsInherit'))} ${esc(this._text('unchanged'))}</p>
      ${this.card._config?.lights === 'off' ? `<p class="model-rendering-hint">${esc(this._text('cardLightsOff'))}</p>` : ''}
      ${this.message ? `<p role="status">${esc(this._message(this.message))}</p>` : ''}
      ${issues.length ? `<ul role="status">${issues.map((issue) => `<li>${esc(this._message(issue))}</li>`).join('')}</ul>` : ''}`;
  }

  updatePreviews(container) {
    if (this.disposed || !container) return;
    this._ensure();
    const root = container.matches?.('[data-model-rendering-editor]') ? container : container.querySelector('[data-model-rendering-editor]');
    if (!root) return;
    for (const [selector, html] of [['[data-model-rendering-report]', this._reportHtml()], ['[data-model-rendering-status]', this._statusHtml()]]) {
      const target = root.querySelector(selector); if (target && target.innerHTML !== html) target.innerHTML = html;
    }
    const select = root.querySelector('[data-field="model-rendering-preset"]');
    if (select) {
      select.disabled = this._readOnly() || !!this._contextIssue();
      if (!this.dirty) {
        for (const option of [...select.options]) if (!presets.some((preset) => preset.id === option.value)) option.remove();
        if (!presets.some((preset) => preset.id === this.selection)) {
          const option = document.createElement('option'); option.value = this.selection; option.disabled = true;
          option.textContent = this.selection === 'invalid' ? 'Invalid saved settings — choose a replacement' : 'Imported custom settings — kept unchanged';
          select.prepend(option);
        }
        select.value = this.selection;
      }
    }
    const save = root.querySelector('[data-act="model-rendering-save"]');
    if (save) save.disabled = !this.dirty || !this._evaluation().policy.valid || this._evaluation().issues.length > 0;
    this._translateCaptions(root);
  }
  render() {
    if (this.disposed) return '';
    this._ensure();
    const disabled = this._readOnly() || this._contextIssue() ? 'disabled' : '';
    const extra = presets.some((preset) => preset.id === this.selection) ? '' : `<option value="${esc(this.selection)}" selected disabled>${this.selection === 'invalid' ? 'Invalid saved settings — choose a replacement' : 'Imported custom settings — kept unchanged'}</option>`;
    return this._captions(`<section data-model-rendering-editor data-taylors3d-ui="model-rendering-editor"><style>
      [data-model-rendering-editor]{color:var(--primary-text-color,#212121);margin-bottom:20px}
      [data-model-rendering-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0}
      [data-model-rendering-editor] select,[data-model-rendering-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#212121);background:var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#f5f5f5)));border:1px solid var(--divider-color,#888);border-radius:9px;padding:8px}
      [data-model-rendering-editor] select{width:100%}[data-model-rendering-editor] button{cursor:pointer}[data-model-rendering-editor] :disabled{opacity:.6;cursor:default}
      [data-model-rendering-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-model-rendering-editor] .model-rendering-actions{display:flex;gap:7px;flex-wrap:wrap}
      [data-model-rendering-editor] .model-rendering-hint{color:var(--secondary-text-color,#666)}[data-model-rendering-editor] p,[data-model-rendering-editor] li{overflow-wrap:anywhere}
      </style><h3>Model shading</h3>
      <p class="model-rendering-hint">${this._help('intro')}</p>
      <label>Display choice<select data-field="model-rendering-preset" ${disabled}>${extra}${presets.map((preset) => `<option value="${preset.id}" ${this.selection === preset.id ? 'selected' : ''}>${preset.label}</option>`).join('')}</select></label>
      <p class="model-rendering-hint">${this._help('policyHelp')}</p>
      <div data-model-rendering-status aria-live="polite">${this._statusHtml()}</div>
      <div class="model-rendering-actions"><button type="button" data-act="model-rendering-save" ${!this.dirty || this._evaluation().issues.length ? 'disabled' : ''}>Save shading</button><button type="button" data-act="model-rendering-cancel">Cancel</button></div>
      <h4>What is in this model?</h4><div data-model-rendering-report>${this._reportHtml()}</div></section>`);
  }
  onChange(field, element) {
    if (this.disposed || field !== `${prefix}preset` || !element) return false;
    this._ensure();
    if (this._readOnly() || this._contextIssue()) return true;
    const preset = presets.find((value) => value.id === element.value);
    if (!preset) return true;
    // Replace only the two supported fields. Imported extension fields survive.
    this.draft = { ...(plain(this.draft) ? this.draft : {}), shadows: preset.shadows, lamps: preset.lamps };
    this.selection = preset.id;
    this.dirty = JSON.stringify(this.draft) !== this.baseValue;
    this.message = null;
    this.updatePreviews(element.closest('[data-model-rendering-editor]'));
    return true;
  }
  onInput(field, element) { return this.onChange(field, element); }
  onClick(action) {
    if (this.disposed || !action?.startsWith(prefix)) return false;
    this._ensure();
    if (action === `${prefix}cancel`) { this.reset(); this.onRender(); return true; }
    if (action !== `${prefix}save`) return false;
    const { policy, issues } = this._evaluation();
    if (!this.dirty || !policy.valid || issues.length || typeof this.card.commitFeatureLayout !== 'function') {
      this.message = issues[0] ?? 'Choose a different display setting before saving.'; this.onRender(); return true;
    }
    this.card.commitFeatureLayout({ model_rendering: copy(this.draft) });
    this.reset(); this.onRender(); return true;
  }
  reset() { this.draft = null; this._loaded = false; this.dirty = false; this.message = null; }
  cancel() { this.reset(); }
  dispose() { this.reset(); this.disposed = true; }
}
