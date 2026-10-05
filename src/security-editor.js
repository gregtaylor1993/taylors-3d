// Opt-in security drafts. Read-only model validation never attaches helpers or moves nodes.
// Save is one layout commit; no preview renderer, service, websocket or sensor mutation.
import * as THREE from 'three';
import { entityChoices, entityMetadata } from './entity-metadata.js';
import { readTag } from './manifest.js';
import { normaliseSecurityBinding, readSecurityContact, SECURITY_LIMITS } from './security.js';

const plain = (v) => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const copy = (v) => JSON.parse(JSON.stringify(v));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nameOf = (n) => n.userData?.name || n.name || '';
const within = (n, ancestor) => { for (let node = n; node; node = node.parent) if (node === ancestor) return true; return false; };
const related = (a, b) => within(a, b) || within(b, a);
const kinds = [['door', 'Door'], ['window', 'Window'], ['opening', 'Opening']];
const contactClasses = new Set(['door', 'window', 'opening', 'garage_door']);
const listText = (v) => Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '';
const number = (v) => typeof v === 'number' ? v : typeof v === 'string' && v.trim() && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()) ? Number(v) : NaN;
const button = (action, label, attrs = '') => `<button type="button" data-act="sec-${action}" ${attrs}>${esc(label)}</button>`;
const option = (choice, selected) => `<option value="${esc(choice.value)}" ${choice.value === selected ? 'selected' : ''} ${choice.selectable === false ? 'disabled' : ''}>${esc(choice.label)}</option>`;

/** Real contact choices; unavailable contacts are configurable, unrelated classes are not.
 * An unclassified binary sensor remains a choice requiring deliberate source confirmation.
 * Selected missing/filtered values remain disabled warning choices with their exact ID.
 */
export function securityEntities(hass = {}, selected = []) {
  return entityChoices(hass, { domains: ['binary_sensor'], selected,
    capability: (m) => !m.deviceClass || contactClasses.has(m.deviceClass) });
}

function objectIndex(model) {
  const index = new Map(), root = model?.root;
  if (!root?.isObject3D) return index;
  const add = (id, node, label = id) => {
    if (typeof id !== 'string' || !node?.isObject3D || !within(node, root)) return;
    const entry = index.get(id) || { value: id, label, nodes: [] };
    if (!entry.nodes.includes(node)) entry.nodes.push(node); index.set(id, entry);
  };
  root.traverse((node) => {
    if (node.userData.helper) return;
    const tag = readTag(nameOf(node), node.userData);
    if (tag?.kind === 'object') add(tag.id, node, tag.label || tag.id);
  });
  for (const object of model.manifest?.objects || []) add(object.id, object.node, object.label || object.id);
  return index;
}

function rigidIssue(node) {
  if (!node?.parent) return 'Choose a real moving part inside the loaded model.';
  let unsupported = false;
  node.traverse((n) => {
    if (!n.userData.helper && (n.isSkinnedMesh || n.isBone || Object.keys(n.geometry?.morphAttributes || {}).length || n.morphTargetInfluences?.length || n.matrixWorldAutoUpdate === false)) unsupported = true;
  });
  if (unsupported) return 'This part is skinned, deforming or has an externally managed world transform. Choose a rigid part.';
  const matrix = node.matrixAutoUpdate ? new THREE.Matrix4().compose(node.position, node.quaternion, node.scale) : node.matrix.clone();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); matrix.decompose(p, q, s);
  if (![...matrix.elements, ...p.toArray(), ...q.toArray(), ...s.toArray()].every(Number.isFinite) || s.toArray().some((v) => v === 0)) return 'The moving part needs a finite, noncollapsed authored transform.';
  const composed = new THREE.Matrix4().compose(p, q, s);
  if (matrix.elements.some((v, i) => Math.abs(v - composed.elements[i]) > 1e-8 * Math.max(1, Math.abs(v)))) return 'The moving part has a sheared transform that cannot be represented by a hinge.';
  return null;
}

function targetAt(node, path) {
  if (!node || typeof path !== 'string') return null;
  if (path === '.') return node;
  for (const segment of path.split('/')) {
    if (!segment || segment === '.' || segment === '..') return null;
    const matches = node.children.filter((n) => !n.userData.helper && nameOf(n) === segment);
    if (matches.length !== 1) return null;
    node = matches[0];
  }
  return node;
}

function outlineMeshes(object) {
  const meshes = [];
  object?.traverse((node) => {
    if (node.isMesh && !node.userData.helper && !node.isSkinnedMesh && !Object.keys(node.geometry?.morphAttributes || {}).length && !node.morphTargetInfluences?.length) meshes.push(node);
  });
  return meshes;
}

/** Parent owns Edit → Security and preserves native controls on HA-only updates.
 * Optional securityBindings() returns effective saved array; securityMotionWriters() returns
 * external transform writer nodes. Otherwise use layout/config, _view.model and ObjectLayer.
 * root.editAllowed() or boolean controls administration; fallback requires actual HA admin.
 * reset/dispose never call onRender. No draft scene motion: preview is read-only evidence.
 */
export class SecurityEditor {
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.disposed = false; this.reset();
  }
  get hass() { return this.card._hass || {}; }
  get effective() { return typeof this.card.securityBindings === 'function' ? this.card.securityBindings() : this.card._layout?.security_bindings ?? this.card._config?.security_bindings ?? []; }
  get bindings() { return Array.isArray(this.effective) ? this.effective : []; }
  get model() { return this.card._view?.model || null; }
  get objectChoices() {
    const out = [...objectIndex(this.model).values()].map((entry) => ({ ...entry, selectable: entry.nodes.length === 1,
      label: entry.nodes.length === 1 ? `${entry.label} · ${entry.value}` : `Ambiguous tagged object: ${entry.value}` }));
    const selected = this.draft?.object_id;
    if (typeof selected === 'string' && selected && !out.some((c) => c.value === selected)) out.push({ value: selected, label: `Missing tagged object: ${selected}`, selectable: false, nodes: [] });
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }
  get entityChoices() { return securityEntities(this.hass, this.draft?.entity ? [this.draft.entity] : []); }
  _admin() {
    if (this.hass.user?.is_admin === false) return false;
    if (typeof this.card.editAllowed === 'function') return this.card.editAllowed() === true;
    if (typeof this.card.editAllowed === 'boolean') return this.card.editAllowed;
    return this.hass.user?.is_admin === true;
  }
  _context() { return JSON.stringify([this.card._config?.layout_key ?? 'default', this.model?.root?.uuid ?? null]); }
  _object(id = this.draft?.object_id) { const entry = objectIndex(this.model).get(id); return entry?.nodes.length === 1 ? entry.nodes[0] : null; }
  _writers() {
    const supplied = this.card.securityMotionWriters?.();
    if (supplied instanceof Set || Array.isArray(supplied)) return [...supplied].filter((n) => n?.isObject3D);
    return [...(this.card._objects?.parts?.values?.() || [])].filter((p) => p.type?.place).map((p) => p.obj?.node).filter(Boolean);
  }
  get targetChoices() {
    const object = this._object(), out = [];
    const visit = (node, path) => {
      if (node.userData.helper) return;
      const problem = rigidIssue(node), conflict = this._writers().some((writer) => related(writer, node));
      out.push({ value: path, node, selectable: !problem && !conflict,
        label: `${path === '.' ? 'Whole tagged object (includes its children)' : path}${problem ? ' · unsupported rigid transform' : conflict ? ' · another transform writer' : ''}` });
      const counts = new Map(); for (const child of node.children) if (!child.userData.helper) counts.set(nameOf(child), (counts.get(nameOf(child)) || 0) + 1);
      for (const child of node.children) {
        const name = nameOf(child);
        if (child.userData.helper || !name || name.includes('/') || name === '.' || name === '..' || counts.get(name) !== 1) continue;
        visit(child, path === '.' ? name : `${path}/${name}`);
      }
    };
    if (object) visit(object, '.');
    const selected = this.draft?.motion?.target;
    if (typeof selected === 'string' && selected && !out.some((c) => c.value === selected)) out.push({ value: selected, label: `Missing or ambiguous moving part: ${selected}`, selectable: false });
    return out;
  }
  _referenceIssues() {
    if (!this.draft) return [];
    const issues = [];
    if (this.badImported) issues.push('This saved binding is malformed. Repair deliberately or clear it.');
    if (this.draft.entity) {
      const choice = this.entityChoices.find((c) => c.value === this.draft.entity);
      if (!choice?.selectable) issues.push('The saved contact is missing, hidden, disabled or is not an opening contact. Restore it or Repair links deliberately.');
    }
    if (this.draft.object_id && !this.objectChoices.some((c) => c.value === this.draft.object_id && c.selectable)) issues.push('The saved tagged object is missing or ambiguous. Restore it or Repair links deliberately.');
    if (this.draft.motion !== undefined) {
      if (!plain(this.draft.motion)) issues.push('Saved motion settings are malformed. Remove motion deliberately or clear the binding.');
      else if (this.draft.motion.target && !this.targetChoices.some((c) => c.value === this.draft.motion.target && c.selectable)) issues.push('The saved moving part is missing, ambiguous, deforming or already controlled. Repair its exact path deliberately.');
    }
    return issues;
  }
  _readOnly() { return !this._admin() || !this.relinking && this._referenceIssues().length > 0; }
  _currentIssue() {
    if (!this.draft) return null;
    if (this.contextKey !== this._context()) return 'The layout or loaded model changed. Cancel and reopen this draft before saving.';
    if (this.editingIndex !== null && JSON.stringify(this.bindings[this.editingIndex]) !== this.baseValue) return 'This saved binding changed while you were editing. Cancel and reopen it before saving.';
    return null;
  }
  _newBinding() {
    let id = 1; while (this.bindings.some((b) => b?.id === `security_${id}`)) id++;
    return { id: `security_${id}`, label: '', entity: '', object_id: '', kind: 'door', open_states: [], closed_states: [], enabled: true };
  }
  _start(value, index = null) {
    this.reset(); this.editingIndex = index; this.baseValue = JSON.stringify(value); this.contextKey = this._context();
    this.badImported = !plain(value); this.draft = plain(value) ? copy(value) : this._newBinding(); this.onRender();
  }
  _raw() {
    const raw = copy(this.draft);
    for (const key of ['open_states', 'closed_states']) if (this.edited.has(key)) raw[key] = String(raw[key]).split(',').map((s) => s.trim()).filter(Boolean);
    if (plain(raw.highlight) && this.edited.has('highlight.opacity')) raw.highlight.opacity = number(raw.highlight.opacity);
    if (plain(raw.motion)) {
      for (const key of ['pivot', 'axis']) if (Array.isArray(raw.motion[key])) raw.motion[key] = raw.motion[key].map((v, i) => this.edited.has(`motion.${key}.${i}`) ? number(v) : v);
      for (const key of ['closed_degrees', 'open_degrees', 'duration_ms']) if (this.edited.has(`motion.${key}`)) raw.motion[key] = number(raw.motion[key]);
    }
    return raw;
  }
  _validation() {
    if (!this.draft) return [];
    const raw = this._raw(), issues = normaliseSecurityBinding(raw).diagnostics.map((d) => d.message);
    issues.push(...this._referenceIssues());
    if (!this._admin()) issues.push('Only an administrator can save layout settings.');
    const current = this._currentIssue(); if (current) issues.push(current);
    if (!Array.isArray(this.effective)) issues.push('The saved security list is malformed. Clear it deliberately before adding a binding.');
    if (this.bindings.length >= SECURITY_LIMITS.maxBindings && this.editingIndex === null) issues.push('The security binding limit has been reached.');
    if (this.bindings.some((b, i) => i !== this.editingIndex && b?.id === raw.id)) issues.push('Binding IDs must be unique. Clear the duplicate deliberately.');
    if (this.bindings.some((b, i) => i !== this.editingIndex && b?.enabled !== false && b?.object_id === raw.object_id)) issues.push('This tagged object already has a security binding. Edit or clear that binding deliberately.');
    const metadata = entityMetadata(this.hass, raw.entity);
    if (!this.entityChoices.some((c) => c.value === raw.entity && c.selectable)) issues.push('Choose a real opening contact entity deliberately.');
    if (!metadata.deviceClass && raw.contact_source_confirmed !== true) issues.push('Confirm that this unclassified binary sensor is a real opening contact.');
    const object = this._object(raw.object_id);
    if (!object) issues.push('Choose one exact tagged model object from the loaded model.');
    if (object) {
      const meshes = outlineMeshes(object);
      if (!meshes.length || meshes.length > SECURITY_LIMITS.maxMeshes || meshes.some((mesh) => !mesh.geometry?.isBufferGeometry
        || !Number.isSafeInteger(mesh.geometry.attributes.position?.count) || mesh.geometry.attributes.position.count < 3 || mesh.geometry.attributes.position.count > SECURITY_LIMITS.maxVertices))
        issues.push('This object needs bounded rigid mesh geometry for a security outline.');
      const bindings = this.editingIndex === null ? [...this.bindings, raw] : this.bindings.map((b, i) => i === this.editingIndex ? raw : b);
      const count = bindings.filter((b) => b?.enabled !== false).reduce((sum, b) => sum + outlineMeshes(this._object(b?.object_id)).length, 0);
      if (count > SECURITY_LIMITS.maxTotalMeshes) issues.push('The security outline mesh budget has been reached. Clear or disable another binding deliberately.');
    }
    if (raw.motion !== undefined) {
      const target = plain(raw.motion) ? targetAt(object, raw.motion.target) : null;
      if (!target) issues.push('Choose one exact, uniquely addressable moving-part path.');
      else {
        const problem = rigidIssue(target); if (problem) issues.push(problem);
        if (this._writers().some((writer) => related(writer, target))) issues.push('Another layer already controls this moving transform. Choose an unshared rigid part.');
        for (const [index, b] of this.bindings.entries()) {
          if (index === this.editingIndex || b?.enabled === false || !plain(b?.motion)) continue;
          const other = targetAt(this._object(b.object_id), b.motion.target);
          if (other && related(other, target)) issues.push('Another security binding writes this target or its parent/child. Choose separate rigid parts.');
        }
      }
    }
    return [...new Set(issues)];
  }
  _previewHtml() {
    if (!this.draft) return '';
    const issues = this._validation(), raw = this._raw(), reading = readSecurityContact(this.hass, raw);
    const evidence = reading.open === true ? 'Open contact reported' : reading.open === false ? 'Closed contact reported' : 'Opening state is unknown; the authored neutral pose is shown';
    return `<h4>Read-only draft check</h4><p>${esc(raw.entity ? entityMetadata(this.hass, raw.entity).name : 'No contact selected')} · ${esc(evidence)}</p>
      <p class="sec-hint">No door moves and nothing is saved while you edit. Configured angles are visual offsets from the original model, not measured opening angles.</p>
      <div aria-live="polite">${this.message ? `<p role="status">${esc(this.message)}</p>` : ''}${[...new Set([...issues, ...reading.diagnostics.map((d) => d.message)])].length ? `<ul>${[...new Set([...issues, ...reading.diagnostics.map((d) => d.message)])].map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  _syncChoices(select, choices, selected, placeholder) {
    if (!select) return;
    const desired = [{ value: '', label: placeholder, selectable: true }, ...choices], existing = new Map([...select.options].map((o) => [o.value, o])), keep = new Set();
    desired.forEach((choice, index) => {
      const node = existing.get(choice.value) || document.createElement('option');
      if (node.value !== choice.value) node.value = choice.value; if (node.textContent !== choice.label) node.textContent = choice.label;
      node.disabled = choice.selectable === false;
      if (select.options[index] !== node) select.insertBefore(node, select.options[index] || null); keep.add(node);
    });
    for (const node of [...select.options]) if (!keep.has(node)) node.remove();
    if (select.value !== selected) select.value = selected || '';
  }
  updatePreviews(container) {
    if (this.disposed || !this.draft || !container) return;
    const root = container.matches?.('[data-security-editor]') ? container : container.querySelector('[data-security-editor]'); if (!root) return;
    const target = root.querySelector('[data-security-preview]'), html = this._previewHtml(); if (target && target.innerHTML !== html) target.innerHTML = html;
    const readOnly = this._readOnly(), contextChanged = !!this._currentIssue();
    for (const control of root.querySelectorAll('[data-sec-setting]')) control.disabled = readOnly || contextChanged;
    for (const field of ['entity', 'object', 'target']) {
      const select = root.querySelector(`[data-field="sec-${field}"]`);
      this._syncChoices(select, field === 'entity' ? this.entityChoices : field === 'object' ? this.objectChoices : this.targetChoices,
        field === 'entity' ? this.draft.entity : field === 'object' ? this.draft.object_id : this.draft.motion?.target, field === 'entity' ? 'Choose an opening contact' : field === 'object' ? 'Choose a tagged object' : 'Choose an exact moving part');
    }
    const repair = root.querySelector('[data-act="sec-repair"]'); if (repair) { repair.hidden = !this._referenceIssues().length; repair.disabled = !this._admin() || contextChanged; }
    for (const control of root.querySelectorAll('[data-sec-admin]')) control.disabled = !this._admin() || contextChanged && ['sec-repair', 'sec-clear-draft'].includes(control.dataset.act);
  }
  afterUpdate(container) { this.updatePreviews(container); }
  render() {
    if (this.disposed) return '';
    const admin = this._admin(), saved = this.bindings.map((b, i) => `<li><span>${esc(b?.label || b?.entity || `Saved binding ${i + 1}`)}<small>${esc(b?.object_id || 'No tagged object')} · ${esc(b?.kind || 'Unsupported kind')}${b?.enabled === false ? ' · disabled' : ''}</small></span>${button('edit', 'Edit', `data-index="${i}"`)}${button('clear', 'Clear saved binding', `data-index="${i}" data-sec-admin ${admin ? '' : 'disabled'}`)}</li>`).join('');
    const d = this.draft, disabled = this._readOnly() || this._currentIssue() ? 'disabled' : '', h = plain(d?.highlight) ? d.highlight : {}, m = plain(d?.motion) ? d.motion : {};
    const field = (name, label, value, attrs = '') => `<label>${esc(label)}<input data-field="sec-${name}" data-sec-setting value="${esc(value ?? '')}" ${attrs} ${disabled}></label>`;
    const check = (name, label, checked) => `<label class="sec-check"><input type="checkbox" data-field="sec-${name}" data-sec-setting ${checked ? 'checked' : ''} ${disabled}>${esc(label)}</label>`;
    const typeChoices = d && !kinds.some(([value]) => value === d.kind) ? [[String(d.kind ?? ''), `Unsupported saved kind: ${String(d.kind)}`], ...kinds] : kinds;
    return `<section data-security-editor data-taylors3d-ui="security-editor"><style>
      [data-security-editor]{color:var(--primary-text-color,#222)}[data-security-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0}[data-security-editor] input,[data-security-editor] select,[data-security-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#222);background:var(--card-background-color,#f5f5f5);border:1px solid var(--divider-color,#999);border-radius:8px;padding:8px}[data-security-editor] input:not([type=checkbox]),[data-security-editor] select{width:100%}[data-security-editor] .sec-check{flex-direction:row;align-items:center;gap:10px}[data-security-editor] .sec-check input{min-width:22px}[data-security-editor] .sec-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}[data-security-editor] li{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0;overflow-wrap:anywhere}[data-security-editor] li span{flex:1;min-width:100px}[data-security-editor] small{display:block}[data-security-editor] .sec-hint{color:var(--secondary-text-color,#666);line-height:1.5}[data-security-editor] .sec-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}[data-security-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-security-editor] :disabled{opacity:.6}[data-security-editor] fieldset{margin:12px 0;border:1px solid var(--divider-color,#999);border-radius:10px;min-width:0}
      </style><h3>Door and window security</h3><p class="sec-hint">Add a real opening contact to an exact tagged model object. Highlighting is optional. A moving door needs a separate rigid leaf and an explicitly supplied hinge.</p>
      ${!admin ? '<p role="status">Only an administrator can save layout settings.</p>' : ''}${!Array.isArray(this.effective) ? '<p>Saved security settings are malformed and preserved.</p>' + button('clear-all', 'Clear malformed security settings', `data-sec-admin ${admin ? '' : 'disabled'}`) : ''}
      <ul>${saved || '<li>No security bindings saved.</li>'}</ul>${button('add', 'Add security binding', `data-sec-admin ${admin ? '' : 'disabled'}`)}
      ${d ? `<fieldset><legend>${this.editingIndex === null ? 'New security binding' : 'Edit security binding'}</legend>
        ${field('label', 'Label', d.label)}${check('enabled', 'Enable security highlight and configured motion', d.enabled !== false)}
        <label>Opening kind<select data-field="sec-kind" data-sec-setting ${disabled}>${typeChoices.map(([value, label]) => option({ value, label }, d.kind)).join('')}</select></label>
        <label>Contact entity<select data-field="sec-entity" data-sec-setting ${disabled}>${option({ value: '', label: 'Choose an opening contact' }, d.entity)}${this.entityChoices.map((c) => option(c, d.entity)).join('')}</select></label>
        ${check('confirmed', 'I confirm this unclassified binary sensor is a real opening contact', d.contact_source_confirmed === true)}
        <label>Tagged model object<select data-field="sec-object" data-sec-setting ${disabled}>${option({ value: '', label: 'Choose a tagged object' }, d.object_id)}${this.objectChoices.map((c) => option(c, d.object_id)).join('')}</select></label>
        ${field('open-states', 'Exact open states, separated by commas', listText(d.open_states))}${field('closed-states', 'Exact closed states, separated by commas', listText(d.closed_states))}
        ${button('contact-preset', 'Use HA contact states: on = open, off = closed', `data-sec-setting ${disabled}`)}
        <fieldset><legend>Owned outline</legend>${field('open-color', 'Open colour (#rrggbb)', h.open === undefined ? '#ef5350' : h.open, 'maxlength="7"')}${field('unknown-color', 'Unknown colour (#rrggbb)', h.unknown === undefined ? '#8d9199' : h.unknown, 'maxlength="7"')}${check('show-closed', 'Also outline a closed contact', h.closed !== undefined && h.closed !== null)}${h.closed !== undefined && h.closed !== null ? field('closed-color', 'Closed colour (#rrggbb)', h.closed, 'maxlength="7"') : ''}${field('opacity', 'Outline opacity, 0 to 1', h.opacity === undefined ? 1 : h.opacity, 'type="number" inputmode="decimal" min="0" max="1" step="0.05"')}</fieldset>
        ${check('motion', 'Animate an explicitly configured rigid moving part', d.motion !== undefined)}
        ${d.motion !== undefined ? `<fieldset><legend>Explicit hinge</legend><p class="sec-hint">Pivot and axis use the moving part’s parent-local model coordinates. Angles are signed offsets from the authored pose. We do not guess a hinge, axis or angle. The whole-object choice moves its frame and children too.</p>
          <label>Exact moving part<select data-field="sec-target" data-sec-setting ${disabled}>${option({ value: '', label: 'Choose an exact moving part' }, m.target)}${this.targetChoices.map((c) => option(c, m.target)).join('')}</select></label>
          ${['pivot', 'axis'].map((key) => `<div class="sec-grid">${['X', 'Y', 'Z'].map((axis, i) => field(`${key}-${i}`, `${key === 'pivot' ? 'Pivot' : 'Axis'} ${axis}`, m[key]?.[i], 'type="number" inputmode="decimal" step="any"')).join('')}</div>`).join('')}
          ${field('closed-degrees', 'Closed offset, degrees', m.closed_degrees, 'type="number" inputmode="decimal" step="any"')}${field('open-degrees', 'Open offset, degrees', m.open_degrees, 'type="number" inputmode="decimal" step="any"')}${field('duration', 'Motion duration, milliseconds (0 = snap)', m.duration_ms, 'type="number" min="0" max="5000" step="1"')}</fieldset>` : ''}
        ${d.freshness !== undefined ? '<p class="sec-hint">Saved source-freshness settings are preserved. This form does not change their timestamp rules.</p>' : ''}
        <div data-security-preview>${this._previewHtml()}</div><p class="sec-hint">Save makes one undoable layout change. Cancel or leaving this tab discards the draft.</p>
        <div class="sec-actions">${button('save', 'Save', `data-sec-setting ${disabled}`)}${button('cancel', 'Cancel')}${button('repair', 'Repair links deliberately', `data-sec-admin ${this._referenceIssues().length ? '' : 'hidden'} ${admin ? '' : 'disabled'}`)}${this.editingIndex !== null ? button('clear-draft', 'Clear saved binding', `data-sec-admin ${admin ? '' : 'disabled'}`) : ''}</div></fieldset>` : ''}</section>`;
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith('sec-')) return false;
    if (!this.draft || this._readOnly() || this._currentIssue()) return true;
    const name = field.slice(4), value = element.value; let redraw = false;
    if (['label', 'kind'].includes(name)) { this.draft[name] = value; this.edited.add(name); }
    else if (name === 'entity') { if (value && !this.entityChoices.some((c) => c.value === value && c.selectable)) return true; this.draft.entity = value; this.edited.add('entity'); }
    else if (name === 'object') { if (value && !this.objectChoices.some((c) => c.value === value && c.selectable)) return true; this.draft.object_id = value; this.edited.add('object_id'); redraw = true; }
    else if (name === 'target') { if (!plain(this.draft.motion) || value && !this.targetChoices.some((c) => c.value === value && c.selectable)) return true; this.draft.motion.target = value; this.edited.add('motion.target'); }
    else if (name === 'enabled') { this.draft.enabled = element.checked === true; this.edited.add('enabled'); }
    else if (name === 'confirmed') { this.draft.contact_source_confirmed = element.checked === true; this.edited.add('contact_source_confirmed'); }
    else if (name === 'open-states' || name === 'closed-states') { const key = name.replace('-', '_'); this.draft[key] = value; this.edited.add(key); }
    else if (name === 'motion') {
      if (!element.checked) delete this.draft.motion;
      else if (!plain(this.draft.motion)) this.draft.motion = { target: '', pivot: ['', '', ''], axis: ['', '', ''], closed_degrees: '', open_degrees: '', duration_ms: '' };
      this.edited.add('motion'); redraw = true;
    } else if (['open-color', 'unknown-color', 'closed-color', 'opacity', 'show-closed'].includes(name)) {
      if (!plain(this.draft.highlight)) this.draft.highlight = {};
      if (name === 'show-closed') { this.draft.highlight.closed = element.checked ? this.draft.highlight.closed || '#66bb6a' : null; redraw = true; }
      else { const key = name === 'opacity' ? name : name.split('-')[0]; this.draft.highlight[key] = value; this.edited.add(`highlight.${key}`); }
    } else if (/^(pivot|axis)-[012]$/.test(name) && plain(this.draft.motion)) {
      const [key, index] = name.split('-'); if (!Array.isArray(this.draft.motion[key])) this.draft.motion[key] = ['', '', ''];
      this.draft.motion[key][Number(index)] = value; this.edited.add(`motion.${key}.${index}`);
    } else if (['closed-degrees', 'open-degrees', 'duration'].includes(name) && plain(this.draft.motion)) {
      const key = name === 'duration' ? 'duration_ms' : name.replace('-', '_'); this.draft.motion[key] = value; this.edited.add(`motion.${key}`);
    } else return false;
    this.dirty = true; this.message = null;
    if (redraw) this.onRender(); else this.updatePreviews(element.closest?.('[data-security-editor]'));
    return true;
  }
  onInput(field, element) { return ['INPUT', 'TEXTAREA'].includes(element?.tagName) && element.type !== 'checkbox' && this.onChange(field, element); }
  _commit(bindings) { this.card.commitFeatureLayout({ security_bindings: bindings }); this.reset(); this.onRender(); }
  onClick(action, element = {}) {
    if (this.disposed || !action?.startsWith('sec-')) return false;
    const index = Number(element.dataset?.index);
    if (action === 'sec-cancel') { this.cancel(); return true; }
    if (action === 'sec-edit') { if (Number.isInteger(index) && index >= 0 && index < this.bindings.length) this._start(this.bindings[index], index); return true; }
    if (!this._admin()) return true;
    if (action === 'sec-add') this._start(this._newBinding());
    else if (action === 'sec-clear' && Number.isInteger(index) && index >= 0 && index < this.bindings.length) this._commit(this.bindings.filter((_, i) => i !== index));
    else if (action === 'sec-clear-all' && !Array.isArray(this.effective)) this._commit([]);
    else if (action === 'sec-clear-draft' && this.draft && this.editingIndex !== null && !this._currentIssue()) this._commit(this.bindings.filter((_, i) => i !== this.editingIndex));
    else if (action === 'sec-repair' && this.draft && !this._currentIssue()) {
      if (this.badImported) { this.draft = this._newBinding(); this.badImported = false; }
      this.relinking = true; this.message = 'Choose each replacement deliberately. Nothing has been saved or guessed.'; this.onRender();
    } else if (action === 'sec-contact-preset' && this.draft && !this._readOnly() && !this._currentIssue()) {
      this.draft.open_states = ['on']; this.draft.closed_states = ['off']; this.edited.delete('open_states'); this.edited.delete('closed_states'); this.dirty = true; this.message = null; this.onRender();
    } else if (action === 'sec-save' && this.draft) {
      const issues = this._validation();
      if (issues.length || this._readOnly()) { this.message = 'Choose valid settings before saving; nothing has been saved.'; this.updatePreviews(element.closest?.('[data-security-editor]')); }
      else {
        const raw = this._raw(); this._commit(this.editingIndex === null ? [...this.bindings, raw] : this.bindings.map((b, i) => i === this.editingIndex ? raw : b));
      }
    } else return false;
    return true;
  }
  handleChange(event) { return this.onChange(event.target?.dataset?.field, event.target); }
  handleClick(event) { const b = event.target?.closest?.('[data-act]'); return !!b && !b.disabled && this.onClick(b.dataset.act, b); }
  cancel() { this.reset(); if (!this.disposed) this.onRender(); }
  reset() { this.draft = null; this.editingIndex = null; this.baseValue = null; this.contextKey = null; this.badImported = false; this.dirty = false; this.relinking = false; this.message = null; this.edited = new Set(); }
  dispose() { this.reset(); this.disposed = true; }
}
