// Opt-in security drafts. Read-only model validation never attaches helpers or moves nodes.
// Save is one layout commit; no preview renderer, service, websocket or sensor mutation.
import * as THREE from 'three';
import { entityChoices, entityMetadata } from './entity-metadata.js';
import { readTag } from './manifest.js';
import { normaliseSecurityBinding, readSecurityContact, SECURITY_LIMITS } from './security.js';
import { buildPlanSecurity } from './security-plan.js';
import { readFreshness } from './tracked-source.js';
import { localize } from './localization.js';
import { renderAdvancedCaptions, updateAdvancedCaptions } from './translations/advanced-settings.js';
import { editorDetailText, editorDetailSpan, updateEditorDetails, editorOwnedMessage } from './editor-runtime-details.js';

const plain = (v) => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const copy = (v) => JSON.parse(JSON.stringify(v));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nameOf = (n) => n.userData?.name || n.name || '';
const within = (n, ancestor) => { for (let node = n; node; node = node.parent) if (node === ancestor) return true; return false; };
const related = (a, b) => within(a, b) || within(b, a);
const kinds = [['door', 'Door'], ['window', 'Window'], ['opening', 'Opening'], ['lock', 'Lock']];
const contactClasses = new Set(['door', 'window', 'opening', 'garage_door']);
const listText = (v) => Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '';
const number = (v) => typeof v === 'number' ? v : typeof v === 'string' && v.trim() && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()) ? Number(v) : NaN;
const button = (action, label, attrs = '') => `<button type="button" data-act="sec-${action}" ${attrs}>${esc(label)}</button>`;
const option = (choice, selected) => `<option value="${esc(choice.value)}" ${choice.value === selected ? 'selected' : ''} ${choice.selectable === false ? 'disabled' : ''}${choice.detail ? ` data-editor-detail="${esc(choice.detail.key)}" data-editor-detail-params="${esc(JSON.stringify(choice.detail.params))}"` : ''}>${esc(choice.label)}</option>`;

/** Real contact choices; unavailable contacts are configurable, unrelated classes are not.
 * An unclassified binary sensor remains a choice requiring deliberate source confirmation.
 * Selected missing/filtered values remain disabled warning choices with their exact ID.
 */
export function securityEntities(hass = {}, selected = [], { kind = 'door', ...filters } = {}) {
  return entityChoices(hass, { ...filters, domains: [kind === 'lock' ? 'lock' : 'binary_sensor'], selected,
    capability: (m) => kind === 'lock' || !m.deviceClass || contactClasses.has(m.deviceClass) });
}
const ageModes = [['state', 'Entity state is the timestamp'], ['attribute', 'An attribute reports the timestamp'], ['last_updated', 'HA last state or attribute update'], ['last_changed', 'HA last state change']];
const ageFormats = [['iso', 'ISO date/time with timezone'], ['seconds', 'Unix seconds'], ['milliseconds', 'Unix milliseconds']];
const freshnessMode = (rule) => rule === undefined || plain(rule) && rule.timestamp_mode === undefined && rule.max_age_seconds === undefined ? 'current'
  : plain(rule) && (rule.timestamp_mode === '' || ageModes.some(([mode]) => mode === rule.timestamp_mode)) ? 'timestamp' : 'saved';
function freshnessIssues(rule) {
  if (rule === undefined) return [];
  if (!plain(rule)) return ['Saved reading-age settings are malformed; choose a deliberate replacement.'];
  if (freshnessMode(rule) === 'current') return [];
  const issues = [];
  if (!ageModes.some(([mode]) => mode === rule.timestamp_mode)) issues.push('Choose the timestamp the source actually reports.');
  if (rule.timestamp_mode === 'attribute' && (typeof rule.timestamp_attr !== 'string' || !rule.timestamp_attr.trim())) issues.push('Enter the actual timestamp attribute path.');
  if (rule.timestamp_format !== undefined && !ageFormats.some(([format]) => format === rule.timestamp_format)) issues.push('Choose a supported timestamp format.');
  if (['last_updated', 'last_changed'].includes(rule.timestamp_mode) && rule.timestamp_format !== undefined && rule.timestamp_format !== 'iso') issues.push('HA last-updated and last-changed timestamps use ISO dates with a timezone.');
  if (rule.max_age_seconds !== undefined && (!(typeof rule.max_age_seconds === 'number' || typeof rule.max_age_seconds === 'string') || !Number.isFinite(number(rule.max_age_seconds)) || number(rule.max_age_seconds) <= 0)) issues.push('Maximum reading age must be a positive number of seconds.');
  return issues;
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
  _captions(html) { return renderAdvancedCaptions(html, 'security', (key, fallback) => localize(this.hass, key, {}, fallback)); }
  _translateCaptions(root) { updateAdvancedCaptions(root, 'security', (key, fallback) => localize(this.hass, key, {}, fallback)); updateEditorDetails(root, this.hass); }
  _text(id, params) { return editorDetailText(this.hass, id.includes('.') ? id : `security.${id}`, params); }
  _help(id) { return editorDetailSpan(this.hass, id.includes('.') ? id : `security.${id}`); }
  _message(value) { return editorOwnedMessage(this.hass, value); }
  constructor(card, onRender = () => {}) {
    this.card = card; this.onRender = onRender; this.disposed = false; this._actionRoot = null; this._actionIntents = new WeakMap(); this._heldActions = new Map(); this.reset();
  }
  get hass() { return this.card._hass || {}; }
  get effective() { return typeof this.card.securityBindings === 'function' ? this.card.securityBindings() : this.card._layout?.security_bindings ?? this.card._config?.security_bindings ?? []; }
  get bindings() { return Array.isArray(this.effective) ? this.effective : []; }
  get model() { return this.card._view?.model || null; }
  get objectChoices() {
    const out = [...objectIndex(this.model).values()].map((entry) => ({ ...entry, selectable: entry.nodes.length === 1,
      label: entry.nodes.length === 1 ? `${entry.label} · ${entry.value}` : this._text('security.label.ambiguousTagged', { id: entry.value }) }));
    const selected = this.draft?.object_id;
    if (typeof selected === 'string' && selected && !out.some((c) => c.value === selected)) out.push({ value: selected, label: this._text('security.label.missingTagged', { id: selected }), selectable: false, nodes: [] });
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }
  _entityChoices(filtered = true) {
    const area = filtered && this.areaFilter === 'unassigned' ? { areaId: null } : filtered && this.areaFilter.startsWith('area:') ? { areaId: this.areaFilter.slice(5) } : {};
    return securityEntities(this.hass, this.draft?.entity ? [this.draft.entity] : [], { kind: this.draft?.kind, ...area });
  }
  get entityChoices() { return this._entityChoices(); }
  _areaChoices() {
    const choices = [['all', 'All areas'], ['unassigned', 'Unassigned'], ...Object.entries(this.hass.areas || {}).map(([id, area]) => [`area:${id}`, area.name || id]).sort((a, b) => a[1].localeCompare(b[1]))];
    if (!choices.some(([id]) => id === this.areaFilter)) choices.push([this.areaFilter, this._text('security.label.missingArea', { id: this.areaFilter.slice(5) }), false]);
    return choices.map(([value, label, selectable]) => ({ value, label, selectable }));
  }
  get roomChoices() {
    const choices = (this.card._roomList || []).map((entry) => ({ value: (entry.room || entry).id, label: entry.name || (entry.room || entry).name || (entry.room || entry).id, selectable: true }));
    return this._savedChoice(choices, this.draft?.target?.roomId, 'room');
  }
  get anchorChoices() { return this._savedChoice((this.card.trackingAnchors?.() || []).map((anchor) => ({ value: anchor.id, label: anchor.label || anchor.id, selectable: true })), this.draft?.target?.position_key, 'marker anchor'); }
  get floorChoices() { return this._savedChoice((this.card._floors || []).map((floor) => ({ value: floor.id, label: floor.name || floor.id, selectable: !floor.stale })), this.draft?.target?.position?.floorId ?? this.draft?.target?.floorId, 'floor'); }
  _savedChoice(choices, selected, kind) {
    const counts = new Map(); for (const choice of choices) counts.set(choice.value, (counts.get(choice.value) || 0) + 1);
    choices = choices.filter((choice, index) => choices.findIndex((other) => other.value === choice.value) === index).map((choice) => counts.get(choice.value) > 1 ? { ...choice, selectable: false, label: this._text('security.label.ambiguousChoice', { kind: this._text(`security.label.kind.${kind}`), id: choice.value }) } : choice);
    if (typeof selected === 'string' && selected && !choices.some((choice) => choice.value === selected)) choices.push({ value: selected, label: this._text('security.label.missingChoice', { kind: this._text(`security.label.kind.${kind}`), id: selected }), selectable: false });
    return choices;
  }
  _admin() {
    if (!plain(this.card._layout) || this.card._loading || this.hass.connection?.connected === false || this.hass.user?.is_active === false || this.hass.user?.is_admin === false) return false;
    if (typeof this.card.securityEditorAvailable === 'function') return this.card.securityEditorAvailable() === true;
    if (typeof this.card.editAllowed === 'function') return this.card.editAllowed() === true;
    if (typeof this.card.editAllowed === 'boolean') return this.card.editAllowed;
    return this.hass.user?.is_admin === true;
  }
  _context() { return JSON.stringify([this.card._config?.layout_key ?? 'default', this.model?.root?.uuid ?? null]); }
  _scope() { return { connection: this.hass.connection, auth: this.hass.auth, userId: this.hass.user?.id, layout: this.card._layout, key: this._context() }; }
  _sameScope(scope) { const current = this._scope(); return !!scope && Object.keys(current).every((key) => current[key] === scope[key]); }
  observe() {
    if (this.draft && (!this._admin() || !this._sameScope(this.draftScope))) this.stale = true;
    for (const [button, intent] of this._heldActions) if (!this._admin() || !this._sameScope(intent.scope) || intent.key !== this._actionKey(button)) intent.poisoned = true;
  }
  _actionKey(button) { return JSON.stringify([button?.dataset?.act, button?.dataset?.index, this._context(), this.effective, this.draft]); }
  _bindActionRoot(root) {
    if (root === this._actionRoot) return;
    this._unbindActionRoot(); this._actionRoot = root; if (!root) return;
    const press = (event) => {
      const button = event.target?.closest?.('[data-act^="sec-"]'); if (!button || !root.contains(button)) return;
      if (event.type === 'keydown' && ![' ', 'Enter'].includes(event.key)) return;
      if (event.repeat) { event.preventDefault(); return; }
      if (event.button !== undefined && event.button !== 0) return;
      this.observe(); const intent = { scope: this._scope(), key: this._actionKey(button), poisoned: !this._admin() || button.disabled, used: false };
      this._actionIntents.set(button, intent); this._heldActions.set(button, intent);
    };
    const cancel = (event) => { const button = event.target?.closest?.('[data-act^="sec-"]'), intent = this._actionIntents.get(button); if (intent) intent.poisoned = true; };
    this._actionListeners = [['pointerdown', press], ['keydown', press], ['pointercancel', cancel], ['focusout', cancel]];
    for (const [name, handler] of this._actionListeners) root.addEventListener(name, handler);
  }
  _unbindActionRoot() {
    for (const intent of this._heldActions.values()) intent.poisoned = true;
    this._heldActions.clear();
    for (const [name, handler] of this._actionListeners || []) this._actionRoot?.removeEventListener(name, handler);
    this._actionRoot = null; this._actionListeners = [];
  }
  _acceptedAction(element) {
    this.observe(); if (element?.tagName && (!this._actionRoot?.contains(element) || element.disabled)) return false;
    const intent = this._actionIntents.get(element); if (!intent) return true;
    if (intent.poisoned || intent.used || !this._sameScope(intent.scope) || intent.key !== this._actionKey(element)) return false;
    intent.used = true; return true;
  }
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
        label: `${path === '.' ? this._text('security.label.wholeObject') : path}${problem ? this._text('security.label.rigidWarning') : conflict ? this._text('security.label.writerWarning') : ''}` });
      const counts = new Map(); for (const child of node.children) if (!child.userData.helper) counts.set(nameOf(child), (counts.get(nameOf(child)) || 0) + 1);
      for (const child of node.children) {
        const name = nameOf(child);
        if (child.userData.helper || !name || name.includes('/') || name === '.' || name === '..' || counts.get(name) !== 1) continue;
        visit(child, path === '.' ? name : `${path}/${name}`);
      }
    };
    if (object) visit(object, '.');
    const selected = this.draft?.motion?.target;
    if (typeof selected === 'string' && selected && !out.some((c) => c.value === selected)) out.push({ value: selected, label: this._text('security.label.missingPart', { id: selected }), selectable: false });
    return out;
  }
  _referenceIssues() {
    if (!this.draft) return [];
    const issues = [];
    if (this.badImported) issues.push('This saved binding is malformed. Repair deliberately or clear it.');
    if (this.draft.entity) {
      const choice = this._entityChoices(false).find((c) => c.value === this.draft.entity);
      if (!choice?.selectable) issues.push('The saved security source is missing, hidden, disabled or has the wrong kind. Restore it or Repair links deliberately.');
    }
    if (this.draft.object_id && !this.objectChoices.some((c) => c.value === this.draft.object_id && c.selectable)) issues.push('The saved tagged object is missing or ambiguous. Restore it or Repair links deliberately.');
    if (this.draft.motion !== undefined) {
      if (!plain(this.draft.motion)) issues.push('Saved motion settings are malformed. Remove motion deliberately or clear the binding.');
      else if (this.draft.motion.target && !this.targetChoices.some((c) => c.value === this.draft.motion.target && c.selectable)) issues.push('The saved moving part is missing, ambiguous, deforming or already controlled. Repair its exact path deliberately.');
    }
    if (this.draft.target !== undefined) {
      const target = this.draft.target;
      for (const [key, choices, label] of [['roomId', this.roomChoices, 'room'], ['position_key', this.anchorChoices, 'marker anchor']]) {
        if (target?.[key] && !choices.some((choice) => choice.value === target[key] && choice.selectable)) issues.push(`The exact saved ${label} is missing or ambiguous. Repair it deliberately; no substitute is selected.`);
      }
      if (target?.position?.floorId && !this.floorChoices.some((choice) => choice.value === target.position.floorId && choice.selectable)) issues.push('The exact saved source floor is missing. Repair it deliberately.');
      if (target?.floorId && !(this.card._floors || []).some((floor) => floor.id === target.floorId && !floor.stale)) issues.push('The saved target floor constraint is missing. Repair or clear it deliberately.');
    }
    return issues;
  }
  _readOnly() { return !this._admin() || !this.relinking && this._referenceIssues().length > 0; }
  _currentIssue() {
    if (!this.draft) return null;
    this.observe();
    if (this.stale) return 'The session or loaded layout changed. Cancel and reopen this draft before saving.';
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
    this.draftScope = this._scope(); this.badImported = !plain(value); this.draft = plain(value) ? copy(value) : this._newBinding(); this.onRender();
  }
  _raw() {
    const raw = copy(this.draft);
    for (const key of ['open_states', 'closed_states']) if (this.edited.has(key)) raw[key] = String(raw[key]).split(',').map((s) => s.trim()).filter(Boolean);
    if (plain(raw.highlight) && this.edited.has('highlight.opacity')) raw.highlight.opacity = number(raw.highlight.opacity);
    if (plain(raw.motion)) {
      for (const key of ['pivot', 'axis']) if (Array.isArray(raw.motion[key])) raw.motion[key] = raw.motion[key].map((v, i) => this.edited.has(`motion.${key}.${i}`) ? number(v) : v);
      for (const key of ['closed_degrees', 'open_degrees', 'duration_ms']) if (this.edited.has(`motion.${key}`)) raw.motion[key] = number(raw.motion[key]);
    }
    if (plain(raw.target)) {
      if (plain(raw.target.position)) for (const key of ['x', 'y', 'z']) if (this.edited.has(`target.position.${key}`)) raw.target.position[key] = number(raw.target.position[key]);
      if (this.edited.has('target.z')) raw.target.z = number(raw.target.z);
    }
    if (plain(raw.freshness) && this.edited.has('freshness.max_age_seconds')) raw.freshness.max_age_seconds = number(raw.freshness.max_age_seconds);
    return raw;
  }
  _planData(raw = this._raw()) {
    const positions = new Map();
    for (const anchor of this.card.trackingAnchors?.() || []) positions.set(anchor.id, positions.has(anchor.id) ? null : anchor.position);
    return buildPlanSecurity({ hass: this.hass, bindings: [raw], floors: this.card._floors || [], rooms: this.card._roomList || [], positions });
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
    if (raw.target === undefined && this.bindings.some((b, i) => i !== this.editingIndex && b?.enabled !== false && b?.object_id === raw.object_id)) issues.push('This tagged object already has a security binding. Edit or clear that binding deliberately.');
    const metadata = entityMetadata(this.hass, raw.entity);
    if (!this._entityChoices(false).some((c) => c.value === raw.entity && c.selectable)) issues.push(raw.kind === 'lock' ? 'Choose an actual lock entity deliberately.' : 'Choose a real opening contact entity deliberately.');
    if (raw.kind !== 'lock' && !metadata.deviceClass && raw.contact_source_confirmed !== true) issues.push('Confirm that this unclassified binary sensor is a real opening contact.');
    issues.push(...freshnessIssues(raw.freshness));
    const object = raw.target === undefined ? this._object(raw.object_id) : null;
    if (raw.target === undefined && !object) issues.push('Choose one exact tagged model object from the loaded model.');
    if (raw.target !== undefined) issues.push(...this._planData(raw).diagnostics.filter((d) => ['missing_anchor', 'missing_room', 'missing_floor', 'position'].includes(d.code)).map((d) => d.message));
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
    const evidence = this._text(raw.kind === 'lock' ? ({ locked: 'locked', unlocked: 'unlocked', locking: 'locking', unlocking: 'unlocking', jammed: 'jammed' }[reading.status] || 'unknownLock')
      : reading.open === true ? 'open' : reading.open === false ? 'closed' : 'unknownOpening');
    const displayedIssues = [...new Set([...issues.map((issue) => this._message(issue)), ...reading.diagnostics.map((issue) => this._message(issue))])];
    return `<h4>Read-only draft check</h4><p>${esc(raw.entity ? entityMetadata(this.hass, raw.entity).name : this._text('noContact'))} · ${esc(evidence)}</p>
      <p class="sec-hint">${this._help('previewHelp')}</p>
      <div aria-live="polite">${this.message ? `<p role="status">${esc(this._message(this.message))}</p>` : ''}${displayedIssues.length ? `<ul>${displayedIssues.map((message) => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}</div>`;
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
    if (this.disposed || !container) return;
    const root = container.matches?.('[data-security-editor]') ? container : container.querySelector('[data-security-editor]'); if (!root) return;
    this._translateCaptions(root);
    this._bindActionRoot(root); this.observe();
    for (const control of root.querySelectorAll('[data-sec-admin]')) control.disabled = !this._admin();
    if (!this.draft) return;
    const target = root.querySelector('[data-security-preview]'), html = this._previewHtml(); if (target && target.innerHTML !== html) target.innerHTML = html;
    const readOnly = this._readOnly(), contextChanged = !!this._currentIssue();
    for (const control of root.querySelectorAll('[data-sec-setting]')) control.disabled = readOnly || contextChanged;
    for (const field of ['entity', 'object', 'target']) {
      const select = root.querySelector(`[data-field="sec-${field}"]`);
      this._syncChoices(select, field === 'entity' ? this.entityChoices : field === 'object' ? this.objectChoices : this.targetChoices,
        field === 'entity' ? this.draft.entity : field === 'object' ? this.draft.object_id : this.draft.motion?.target, field === 'entity' ? 'Choose an opening contact' : field === 'object' ? 'Choose a tagged object' : 'Choose an exact moving part');
    }
    for (const [field, choices, selected, placeholder] of [['picker-area', this._areaChoices(), this.areaFilter, 'All areas'], ['plan-room', this.roomChoices, this.draft.target?.roomId, 'Choose an exact room'], ['plan-anchor', this.anchorChoices, this.draft.target?.position_key, 'Choose an exact marker'], ['plan-floor', this.floorChoices, this.draft.target?.position?.floorId, 'Choose an exact floor'], ['plan-floor-constraint', this.floorChoices, this.draft.target?.floorId, 'Use the chosen source’s actual floor']]) this._syncChoices(root.querySelector(`[data-field="sec-${field}"]`), choices, selected, placeholder);
    const age = root.querySelector('[data-security-age-preview]'); if (age) { const html = this._freshnessPreview(); if (age.innerHTML !== html) age.innerHTML = html; }
    const repair = root.querySelector('[data-act="sec-repair"]'); if (repair) { repair.hidden = !this._referenceIssues().length; repair.disabled = !this._admin() || contextChanged; }
    for (const control of root.querySelectorAll('[data-sec-admin]')) control.disabled = !this._admin() || contextChanged && ['sec-repair', 'sec-clear-draft'].includes(control.dataset.act);
    this._translateCaptions(root);
  }
  afterUpdate(container) { this.updatePreviews(container); }
  _freshnessPreview() {
    const metadata = entityMetadata(this.hass, this.draft?.entity), rule = this.draft?.freshness;
    if (metadata.state?.attributes?.restored === true) return `<p>${esc(this._text('common.storedHA'))}</p>`;
    if (!metadata.available || metadata.hidden || metadata.disabled || metadata.category) return `<p>${esc(this._text('common.noReading'))}</p>`;
    const reading = readFreshness(metadata.state, rule, Date.now());
    return reading.status === 'current' ? `<p>${esc(this._text('common.unverified'))}</p>`
      : `<p>${esc(this._text('common.ageCheck', { status: reading.status }))}</p>${reading.diagnostics.map((diagnostic) => `<p>${esc(this._message(diagnostic))}</p>`).join('')}`;
  }
  _freshnessFields(field, select) {
    const rule = this.draft.freshness, mode = freshnessMode(rule), choices = [['current', 'Current HA state — no age limit'], ['timestamp', 'Actual timestamp — check reading age']];
    if (mode === 'saved') choices.unshift(['saved', 'Saved rule — choose a deliberate replacement']);
    return `<fieldset><legend>Source reading age</legend>${select('freshness-mode', 'Reading age policy', mode, choices)}
      ${mode === 'timestamp' ? `${select('freshness-timestamp-mode', 'Which timestamp does this source really report?', rule.timestamp_mode, [['', 'Choose the actual timestamp'], ...ageModes])}
        ${rule.timestamp_mode === 'attribute' ? field('freshness-attribute', 'Actual timestamp attribute path', rule.timestamp_attr) : ''}
        ${select('freshness-format', 'Actual timestamp format', rule.timestamp_format ?? 'iso', ageFormats)}${field('freshness-age', 'Maximum reading age, seconds (optional)', rule.max_age_seconds, 'type="number" min="0" step="any"')}` : ''}
      <p class="sec-hint">${this._help('ageHelp')}</p>
      ${mode === 'saved' ? `<p>${this._help('common.savedAge')}</p><pre>${esc(JSON.stringify(rule))}</pre>` : ''}
      <div data-security-age-preview aria-live="polite">${this._freshnessPreview()}</div></fieldset>`;
  }
  _planFields(field, select) {
    const target = plain(this.draft.target) ? this.draft.target : {}, mode = target.position !== undefined ? 'position' : target.roomId !== undefined ? 'room' : target.position_key !== undefined ? 'anchor' : '';
    return `<fieldset><legend>Explicit plan location</legend>${select('plan-source', 'Place the indicator using', mode, [['', 'Choose a location source'], ['room', 'Exact drawn or tagged room'], ['anchor', 'Exact existing marker anchor'], ['position', 'Fixed plan metres']])}
      ${mode === 'room' ? `${select('plan-room', 'Exact room', target.roomId, [['', 'Choose an exact room'], ...this.roomChoices.map((choice) => [choice.value, choice.label, choice.selectable])])}${field('plan-room-z', 'Height above room floor, metres', target.z ?? .12, 'type="number" step="any"')}` : ''}
      ${mode === 'anchor' ? select('plan-anchor', 'Exact marker anchor', target.position_key, [['', 'Choose an exact marker'], ...this.anchorChoices.map((choice) => [choice.value, choice.label, choice.selectable])]) : ''}
      ${['room', 'anchor'].includes(mode) ? select('plan-floor-constraint', 'Optional exact source floor constraint', target.floorId, [['', 'Use the chosen source’s actual floor'], ...this.floorChoices.map((choice) => [choice.value, choice.label, choice.selectable])]) : ''}
      ${mode === 'position' ? `${select('plan-floor', 'Exact source floor', target.position?.floorId, [['', 'Choose an exact floor'], ...this.floorChoices.map((choice) => [choice.value, choice.label, choice.selectable])])}<div class="sec-grid">${['x', 'y', 'z'].map((key) => field(`plan-${key}`, `${key.toUpperCase()} metres${key === 'y' ? ' north' : key === 'x' ? ' east' : ' above floor'}`, target.position?.[key], 'type="number" step="any"')).join('')}</div>` : ''}
      <p class="sec-hint">${this._help('planHelp')}</p></fieldset>`;
  }
  render() {
    if (this.disposed) return '';
    this.observe();
    const admin = this._admin(), saved = this.bindings.map((b, i) => `<li><span>${b?.label || b?.entity ? esc(b.label || b.entity) : editorDetailSpan(this.hass, 'common.savedBinding', { index: i + 1 })}<small>${b?.target ? `${this._help('plan')} ${esc(b.target.roomId || b.target.position_key || b.target.position?.floorId) || this._help('unplaced')}` : b?.object_id ? esc(b.object_id) : this._help('noTagged')} · ${b?.kind ? esc(b.kind) : this._help('unsupportedKindEmpty')}${b?.enabled === false ? this._help('common.disabled') : ''}</small></span>${button('edit', 'Edit', `data-index="${i}"`)}${button('clear', 'Clear saved binding', `data-index="${i}" data-sec-admin ${admin ? '' : 'disabled'}`)}</li>`).join('');
    const d = this.draft, disabled = this._readOnly() || this._currentIssue() ? 'disabled' : '', h = plain(d?.highlight) ? d.highlight : {}, m = plain(d?.motion) ? d.motion : {};
    const field = (name, label, value, attrs = '') => `<label>${esc(label)}<input data-field="sec-${name}" data-sec-setting value="${esc(value ?? '')}" ${attrs} ${disabled}></label>`;
    const check = (name, label, checked) => `<label class="sec-check"><input type="checkbox" data-field="sec-${name}" data-sec-setting ${checked ? 'checked' : ''} ${disabled}>${esc(label)}</label>`;
    const select = (name, label, selected, choices) => {
      if (selected !== undefined && selected !== null && !choices.some(([value]) => value === selected)) choices = [[selected, this._text('unsupportedValue', { value: String(selected) }), false, { key: 'security.unsupportedValue', params: { value: String(selected) } }], ...choices];
      return `<label>${esc(label)}<select data-field="sec-${name}" data-sec-setting ${disabled}>${choices.map(([value, label, selectable, detail]) => option({ value, label, selectable, detail }, selected ?? '')).join('')}</select></label>`;
    };
    const typeChoices = d && !kinds.some(([value]) => value === d.kind) ? [[String(d.kind ?? ''), this._text('unsupportedKind', { value: String(d.kind) }), true, { key: 'security.unsupportedKind', params: { value: String(d.kind) } }], ...kinds] : kinds;
    return this._captions(`<section data-security-editor data-taylors3d-ui="security-editor"><style>
      [data-security-editor]{color:var(--primary-text-color,#222)}[data-security-editor] label{display:flex;flex-direction:column;gap:5px;margin:10px 0}[data-security-editor] input,[data-security-editor] select,[data-security-editor] button{box-sizing:border-box;min-height:44px;max-width:100%;font:inherit;color:var(--primary-text-color,#222);background:var(--card-background-color,#f5f5f5);border:1px solid var(--divider-color,#999);border-radius:8px;padding:8px}[data-security-editor] input:not([type=checkbox]),[data-security-editor] select{width:100%}[data-security-editor] .sec-check{flex-direction:row;align-items:center;gap:10px}[data-security-editor] .sec-check input{min-width:22px}[data-security-editor] .sec-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}[data-security-editor] li{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0;overflow-wrap:anywhere}[data-security-editor] li span{flex:1;min-width:100px}[data-security-editor] small{display:block}[data-security-editor] .sec-hint{color:var(--secondary-text-color,#666);line-height:1.5}[data-security-editor] .sec-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}[data-security-editor] :focus-visible{outline:3px solid var(--primary-color,#03a9f4);outline-offset:2px}[data-security-editor] :disabled{opacity:.6}[data-security-editor] fieldset{margin:12px 0;border:1px solid var(--divider-color,#999);border-radius:10px;min-width:0}
      </style><h3>Door, window and lock security</h3><p class="sec-hint">${this._help('intro')}</p>
      ${!admin ? `<p role="status">${this._help('common.admin')}</p>` : ''}${!Array.isArray(this.effective) ? `<p>${this._help('malformedList')}</p>` + button('clear-all', 'Clear malformed security settings', `data-sec-admin ${admin ? '' : 'disabled'}`) : ''}
      <ul>${saved || `<li>${this._help('noBindings')}</li>`}</ul>${button('add', 'Add security binding', `data-sec-admin ${admin ? '' : 'disabled'}`)}
      ${d ? `<fieldset><legend>${this.editingIndex === null ? 'New security binding' : 'Edit security binding'}</legend>
        ${field('label', 'Label', d.label)}${check('enabled', 'Enable security highlight and configured motion', d.enabled !== false)}
        ${select('kind', 'Security kind', d.kind, typeChoices)}
        ${select('picker-area', 'Filter source choices by area', this.areaFilter, this._areaChoices().map((choice) => [choice.value, choice.label, choice.selectable]))}
        <label>${d.kind === 'lock' ? 'Lock entity' : 'Contact entity'}<select data-field="sec-entity" data-sec-setting ${disabled}>${option({ value: '', label: d.kind === 'lock' ? 'Choose an actual lock' : 'Choose an opening contact' }, d.entity)}${this.entityChoices.map((c) => option(c, d.entity)).join('')}</select></label>
        ${d.kind !== 'lock' ? check('confirmed', 'I confirm this unclassified binary sensor is a real opening contact', d.contact_source_confirmed === true) : `<p class="sec-hint">${this._help('lockHelp')}</p>`}
        ${select('target-type', 'Security target', d.target === undefined ? 'model' : 'plan', [['model', 'Exact tagged model object'], ['plan', 'Explicit plan indicator']])}
        ${d.target === undefined ? `<label>Tagged model object<select data-field="sec-object" data-sec-setting ${disabled}>${option({ value: '', label: 'Choose a tagged object' }, d.object_id)}${this.objectChoices.map((c) => option(c, d.object_id)).join('')}</select></label>` : this._planFields(field, select)}
        ${d.kind !== 'lock' ? `${field('open-states', 'Exact open states, separated by commas', listText(d.open_states))}${field('closed-states', 'Exact closed states, separated by commas', listText(d.closed_states))}${button('contact-preset', 'Use HA contact states: on = open, off = closed', `data-sec-setting ${disabled}`)}` : ''}
        <fieldset><legend>Security highlight</legend>${field('open-color', 'Open/unlocked colour (#rrggbb)', h.open === undefined ? '#ef5350' : h.open, 'maxlength="7"')}${field('unknown-color', 'Unknown colour (#rrggbb)', h.unknown === undefined ? '#8d9199' : h.unknown, 'maxlength="7"')}${check('show-closed', 'Also highlight a closed/locked source', h.closed !== undefined && h.closed !== null)}${h.closed !== undefined && h.closed !== null ? field('closed-color', 'Closed/locked colour (#rrggbb)', h.closed, 'maxlength="7"') : ''}${field('opacity', 'Highlight opacity, 0 to 1', h.opacity === undefined ? 1 : h.opacity, 'type="number" inputmode="decimal" min="0" max="1" step="0.05"')}</fieldset>
        ${d.kind !== 'lock' && d.target === undefined ? check('motion', 'Animate an explicitly configured rigid moving part', d.motion !== undefined) : ''}
        ${d.motion !== undefined && d.kind !== 'lock' && d.target === undefined ? `<fieldset><legend>Explicit hinge</legend><p class="sec-hint">${this._help('hingeHelp')}</p>
          <label>Exact moving part<select data-field="sec-target" data-sec-setting ${disabled}>${option({ value: '', label: 'Choose an exact moving part' }, m.target)}${this.targetChoices.map((c) => option(c, m.target)).join('')}</select></label>
          ${['pivot', 'axis'].map((key) => `<div class="sec-grid">${['X', 'Y', 'Z'].map((axis, i) => field(`${key}-${i}`, `${key === 'pivot' ? 'Pivot' : 'Axis'} ${axis}`, m[key]?.[i], 'type="number" inputmode="decimal" step="any"')).join('')}</div>`).join('')}
          ${field('closed-degrees', 'Closed offset, degrees', m.closed_degrees, 'type="number" inputmode="decimal" step="any"')}${field('open-degrees', 'Open offset, degrees', m.open_degrees, 'type="number" inputmode="decimal" step="any"')}${field('duration', 'Motion duration, milliseconds (0 = snap)', m.duration_ms, 'type="number" min="0" max="5000" step="1"')}</fieldset>` : ''}
        ${this._freshnessFields(field, select)}
        <div data-security-preview>${this._previewHtml()}</div><p class="sec-hint">${this._help('saveHelp')}</p>
        <div class="sec-actions">${button('save', 'Save', `data-sec-setting ${disabled}`)}${button('cancel', 'Cancel')}${button('repair', 'Repair links deliberately', `data-sec-admin ${this._referenceIssues().length ? '' : 'hidden'} ${admin ? '' : 'disabled'}`)}${this.editingIndex !== null ? button('clear-draft', 'Clear saved binding', `data-sec-admin ${admin ? '' : 'disabled'}`) : ''}</div></fieldset>` : ''}</section>`);
  }
  onChange(field, element) {
    if (this.disposed || !field?.startsWith('sec-')) return false;
    if (!this.draft || this._readOnly() || this._currentIssue()) return true;
    const name = field.slice(4), value = element.value; let redraw = false;
    if (name === 'picker-area') {
      if (!this._areaChoices().some((choice) => choice.value === value && choice.selectable !== false)) return true;
      this.areaFilter = value; this.onRender(); return true;
    }
    if (name === 'label') { this.draft.label = value; this.edited.add(name); }
    else if (name === 'kind') {
      if (!kinds.some(([kind]) => kind === value)) return true;
      this.draft.kind = value;
      if (value === 'lock') { delete this.draft.motion; delete this.draft.open_states; delete this.draft.closed_states; delete this.draft.contact_source_confirmed; }
      else { this.draft.open_states ??= []; this.draft.closed_states ??= []; }
      if (this.draft.entity && !this._entityChoices(false).some((choice) => choice.value === this.draft.entity && choice.selectable)) this.draft.entity = '';
      this.edited.add(name); redraw = true;
    }
    else if (name === 'entity') { if (value && !this.entityChoices.some((c) => c.value === value && c.selectable)) return true; this.draft.entity = value; this.edited.add('entity'); }
    else if (name === 'object') { if (value && !this.objectChoices.some((c) => c.value === value && c.selectable)) return true; this.draft.object_id = value; this.edited.add('object_id'); redraw = true; }
    else if (name === 'target') { if (!plain(this.draft.motion) || value && !this.targetChoices.some((c) => c.value === value && c.selectable)) return true; this.draft.motion.target = value; this.edited.add('motion.target'); }
    else if (name === 'enabled') { this.draft.enabled = element.checked === true; this.edited.add('enabled'); }
    else if (name === 'confirmed') { this.draft.contact_source_confirmed = element.checked === true; this.edited.add('contact_source_confirmed'); }
    else if (name === 'open-states' || name === 'closed-states') { const key = name.replace('-', '_'); this.draft[key] = value; this.edited.add(key); }
    else if (name === 'target-type') {
      if (value === 'plan') { delete this.draft.object_id; delete this.draft.motion; this.draft.target = { type: 'plan' }; }
      else if (value === 'model') { delete this.draft.target; this.draft.object_id = ''; }
      else return true;
      redraw = true;
    } else if (name === 'plan-source' && plain(this.draft.target)) {
      if (!['room', 'anchor', 'position'].includes(value)) return true;
      for (const key of ['position', 'roomId', 'position_key', 'floorId', 'z']) delete this.draft.target[key];
      if (value === 'room') this.draft.target.roomId = '';
      else if (value === 'anchor') this.draft.target.position_key = '';
      else this.draft.target.position = { x: '', y: '', z: '', floorId: '' };
      redraw = true;
    } else if (['plan-room', 'plan-anchor', 'plan-floor', 'plan-floor-constraint'].includes(name) && plain(this.draft.target)) {
      const choices = name === 'plan-room' ? this.roomChoices : name === 'plan-anchor' ? this.anchorChoices : this.floorChoices;
      if (value && !choices.some((choice) => choice.value === value && choice.selectable)) return true;
      if (name === 'plan-room') this.draft.target.roomId = value;
      else if (name === 'plan-anchor') this.draft.target.position_key = value;
      else if (name === 'plan-floor-constraint') { if (value) this.draft.target.floorId = value; else delete this.draft.target.floorId; }
      else if (plain(this.draft.target.position)) this.draft.target.position.floorId = value;
    } else if (/^plan-[xyz]$/.test(name) && plain(this.draft.target?.position)) {
      const key = name.slice(5); this.draft.target.position[key] = value; this.edited.add(`target.position.${key}`);
    } else if (name === 'plan-room-z' && plain(this.draft.target)) { this.draft.target.z = value; this.edited.add('target.z'); }
    else if (name.startsWith('freshness-')) {
      const setting = name.slice(10), previous = this.draft.freshness;
      if (setting === 'mode') {
        if (value === 'current') delete this.draft.freshness;
        else if (value === 'timestamp') this.draft.freshness = { ...(plain(previous) ? previous : {}), timestamp_mode: ageModes.some(([id]) => id === previous?.timestamp_mode) ? previous.timestamp_mode : '', timestamp_format: previous?.timestamp_format ?? 'iso' };
        else return true;
        redraw = true;
      } else if (plain(previous)) {
        const key = { 'timestamp-mode': 'timestamp_mode', attribute: 'timestamp_attr', format: 'timestamp_format', age: 'max_age_seconds' }[setting];
        if (!key) return true;
        if (setting === 'age' && !value.trim()) { delete previous.max_age_seconds; this.edited.delete('freshness.max_age_seconds'); }
        else { previous[key] = value; this.edited.add(`freshness.${key}`); }
        if (setting === 'timestamp-mode') redraw = true;
      } else return true;
    } else if (name === 'motion') {
      if (this.draft.kind === 'lock' || this.draft.target !== undefined) return true;
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
    if (!this._admin() || !this._acceptedAction(element)) return true;
    if (action === 'sec-add') this._start(this._newBinding());
    else if (action === 'sec-clear' && Number.isInteger(index) && index >= 0 && index < this.bindings.length) this._commit(this.bindings.filter((_, i) => i !== index));
    else if (action === 'sec-clear-all' && !Array.isArray(this.effective)) this._commit([]);
    else if (action === 'sec-clear-draft' && this.draft && this.editingIndex !== null && !this._currentIssue()) this._commit(this.bindings.filter((_, i) => i !== this.editingIndex));
    else if (action === 'sec-repair' && this.draft && !this._currentIssue()) {
      if (this.badImported) { this.draft = this._newBinding(); this.badImported = false; }
      this.relinking = true; this.message = 'Choose each replacement deliberately. Nothing has been saved or guessed.'; this.onRender();
    } else if (action === 'sec-contact-preset' && this.draft && this.draft.kind !== 'lock' && !this._readOnly() && !this._currentIssue()) {
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
  handleClick(event) {
    const b = event.target?.closest?.('[data-act]'), root = b?.closest?.('[data-security-editor]');
    if (!b || b.disabled || !root?.isConnected) return false;
    if (!this._actionRoot) this._bindActionRoot(root);
    return this.onClick(b.dataset.act, b);
  }
  cancel() { this.reset(); if (!this.disposed) this.onRender(); }
  reset() { this._unbindActionRoot(); this.draft = null; this.editingIndex = null; this.baseValue = null; this.contextKey = null; this.draftScope = null; this.stale = false; this.badImported = false; this.dirty = false; this.relinking = false; this.message = null; this.edited = new Set(); this.areaFilter = 'all'; }
  dispose() { this.reset(); this.disposed = true; }
}
