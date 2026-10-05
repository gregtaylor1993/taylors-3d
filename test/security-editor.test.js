// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SecurityEditor, securityEntities } from '../src/security-editor.js';
import { buildManifest, threeAdapter } from '../src/manifest.js';
import { EditHistory } from '../src/history.js';

const st = (value = 'on', name = 'Front door', device_class = 'door', extra = {}) => ({ state: value, attributes: { friendly_name: name, device_class, ...extra } });
const saved = (extra = {}) => ({ id: 'front', label: 'Front door', kind: 'door', entity: 'binary_sensor.front', object_id: 'front', open_states: ['on'], closed_states: ['off'], enabled: true, ...extra });
const hinge = (extra = {}) => ({ target: 'leaf', pivot: [0, 0, 0], axis: [0, 1, 0], closed_degrees: 0, open_degrees: -80, duration_ms: 350, ...extra });
function modelFixture() {
  const root = new THREE.Group(), level = new THREE.Group(), front = new THREE.Group(), leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, .1), new THREE.MeshStandardMaterial()), window = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), new THREE.MeshStandardMaterial());
  level.userData.fp = { kind: 'level', id: 'ground' }; front.userData.fp = { kind: 'object', id: 'front', type: 'door', label: 'Front door model' };
  leaf.name = 'leaf'; leaf.position.set(.5, 1, 0); front.add(leaf); window.userData.fp = { kind: 'object', id: 'window', type: 'window', label: 'Kitchen window' };
  root.add(level); level.add(front, window); root.updateMatrixWorld(true);
  return { root, level, front, leaf, window, manifest: buildManifest(threeAdapter(root)) };
}
function setup({ layout = {}, config = {}, admin = true, editAllowed, states = {}, entities = {}, model = modelFixture() } = {}) {
  const card = { _config: { layout_key: 'one', ...config }, _layout: { pins: { lamp: { x: 1, y: 2 } }, ...layout }, _view: { model },
    _hass: { user: { is_admin: admin }, states: { 'binary_sensor.front': st(), 'binary_sensor.window': st('off', 'Kitchen window', 'window'), 'binary_sensor.unclassified': st('on', 'Custom contact', null), 'binary_sensor.motion': st('on', 'Motion', 'motion'), ...states }, entities, callService: vi.fn(), callWS: vi.fn() },
    _history: new EditHistory(), previewSecurity: vi.fn(), editAllowed };
  card._history.reset({ layout: card._layout, config: card._config });
  card.commitFeatureLayout = vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; card._history.record({ layout: card._layout, config: card._config }, 'Edit security'); });
  const host = document.createElement('div'); document.body.append(host); const rendered = vi.fn();
  const editor = new SecurityEditor(card, () => { rendered(); host.innerHTML = editor.render(); editor.afterUpdate(host); });
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target)); host.addEventListener('click', (event) => editor.handleClick(event));
  host.innerHTML = editor.render();
  const input = (name) => host.querySelector(`[data-field="sec-${name}"]`);
  const change = (name, value, type = 'change') => {
    const control = input(name); expect(control, name).toBeTruthy();
    if (control.type === 'checkbox') control.checked = value; else control.value = value;
    control.dispatchEvent(new Event(type, { bubbles: true }));
  };
  const click = (action, index) => {
    const controls = [...host.querySelectorAll(`[data-act="sec-${action}"]`)]; const control = controls.find((c) => index === undefined || Number(c.dataset.index) === index); expect(control, action).toBeTruthy(); control.click();
  };
  const choose = () => { click('add'); change('entity', 'binary_sensor.front'); change('object', 'front'); click('contact-preset'); };
  const noActions = () => { expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled(); expect(card.previewSecurity).not.toHaveBeenCalled(); };
  return { card, editor, host, model, input, change, click, choose, noActions, rendered };
}
function configureMotion(ctx) {
  ctx.change('motion', true); ctx.change('target', 'leaf');
  for (const [key, values] of [['pivot', ['0', '0', '0']], ['axis', ['0', '1', '0']]]) for (const [i, value] of values.entries()) ctx.change(`${key}-${i}`, value);
  ctx.change('closed-degrees', '0'); ctx.change('open-degrees', '-80'); ctx.change('duration', '350');
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('security draft form and saving', () => {
  it('starts opt-in with no saved changes, no auto-selected entity/object or inferred hinge', () => {
    const ctx = setup(); expect(ctx.host.textContent).toContain('No security bindings saved'); ctx.click('add');
    expect(ctx.input('entity').value).toBe(''); expect(ctx.input('object').value).toBe(''); expect(ctx.input('open-states').value).toBe(''); expect(ctx.input('closed-states').value).toBe('');
    ctx.change('motion', true); for (const name of ['target', 'pivot-0', 'axis-1', 'open-degrees', 'duration']) expect(ctx.input(name).value).toBe('');
    ctx.click('save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toContain('nothing has been saved'); ctx.noActions();
  });
  it('saves one deliberate standard contact binding with a single undoable commit', () => {
    const ctx = setup(); ctx.choose(); ctx.change('label', 'Front entrance'); ctx.click('save');
    expect(ctx.card._layout.security_bindings).toEqual([{ id: 'security_1', label: 'Front entrance', kind: 'door', entity: 'binary_sensor.front', object_id: 'front', open_states: ['on'], closed_states: ['off'], enabled: true }]);
    expect(ctx.card.commitFeatureLayout).toHaveBeenCalledTimes(1); expect(ctx.card._layout.pins).toEqual({ lamp: { x: 1, y: 2 } });
    expect(ctx.card._history.undo().layout.security_bindings).toBeUndefined(); expect(ctx.editor.draft).toBeNull(); ctx.noActions();
  });
  it('saves explicitly typed contact states, outline styles and real signed hinge settings', () => {
    const ctx = setup(); ctx.choose(); ctx.change('open-states', 'open, ajar'); ctx.change('closed-states', 'closed');
    ctx.change('open-color', '#112233'); ctx.change('unknown-color', '#998877'); ctx.change('opacity', '.4'); ctx.change('show-closed', true); ctx.change('closed-color', '#336699'); configureMotion(ctx); ctx.click('save');
    expect(ctx.card._layout.security_bindings[0]).toMatchObject({ open_states: ['open', 'ajar'], closed_states: ['closed'], highlight: { open: '#112233', unknown: '#998877', opacity: .4, closed: '#336699' }, motion: hinge() }); ctx.noActions();
  });
  it('requires nonoverlapping known states and rejects blank/zero axes and invalid angles without a commit', () => {
    const ctx = setup(); ctx.choose(); ctx.change('closed-states', 'on'); ctx.click('save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    ctx.click('contact-preset'); configureMotion(ctx); ctx.change('axis-1', '0'); ctx.click('save'); expect(ctx.host.textContent).toContain('nonzero');
    ctx.change('axis-1', '1'); ctx.change('pivot-0', ''); ctx.click('save'); expect(ctx.host.textContent).toContain('finite parent-local');
    ctx.change('pivot-0', '0'); ctx.change('open-degrees', '361'); ctx.click('save'); expect(ctx.host.textContent).toContain('-360 and 360'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noActions();
  });
  it('preserves all unsupported extra settings during a label-only edit', () => {
    const binding = saved({ future: { nested: ['preserve', 3] }, freshness: { timestamp_mode: 'attribute', timestamp_attr: 'sample', max_age_seconds: 30, futureRule: 'keep' },
      highlight: { mode: 'outline', open: '#123456', unknown: '#abcdef', opacity: .3, closed: null, futurePaint: { alpha: true } }, motion: hinge({ futureMotion: { b: 2 } }) });
    const ctx = setup({ layout: { security_bindings: [binding] } }); ctx.click('edit', 0); ctx.change('label', 'Renamed door'); ctx.click('save');
    expect(ctx.card._layout.security_bindings[0]).toEqual({ ...binding, label: 'Renamed door' }); expect(binding.label).toBe('Front door'); ctx.noActions();
  });
  it('preserves comma-containing state strings when their fields were not edited', () => {
    const binding = saved({ open_states: ['a,b'], closed_states: ['closed'] }); const ctx = setup({ layout: { security_bindings: [binding] } });
    ctx.click('edit', 0); ctx.change('label', 'Keep exotic state'); ctx.click('save'); expect(ctx.card._layout.security_bindings[0].open_states).toEqual(['a,b']); ctx.noActions();
  });
  it('uses the layout array before config fallback and preserves unrelated saved bindings', () => {
    const fallback = [saved(), saved({ id: 'window', object_id: 'window', entity: 'binary_sensor.window', kind: 'window' })];
    const ctx = setup({ config: { security_bindings: fallback } }); ctx.click('edit', 0); ctx.change('label', 'Copied config'); ctx.click('save');
    expect(ctx.card._layout.security_bindings).toEqual([{ ...fallback[0], label: 'Copied config' }, fallback[1]]); expect(ctx.card._config.security_bindings).toBe(fallback);
    ctx.card._layout.security_bindings = []; expect(ctx.editor.bindings).toEqual([]); ctx.noActions();
  });
  it('accepts a root securityBindings helper without changing its source and retains siblings added during a draft', () => {
    const ctx = setup({ layout: { security_bindings: [saved()] } }); ctx.card.securityBindings = () => ctx.card._layout.security_bindings;
    ctx.click('edit', 0); ctx.change('label', 'Updated'); const sibling = saved({ id: 'window', object_id: 'window', entity: 'binary_sensor.window' }); ctx.card._layout.security_bindings.push(sibling);
    ctx.click('save'); expect(ctx.card._layout.security_bindings).toEqual([saved({ label: 'Updated' }), sibling]); ctx.noActions();
  });
  it('discards cancel/reset/dispose drafts without save or render reentry from reset', () => {
    const ctx = setup({ layout: { security_bindings: [saved()] } }); ctx.click('edit', 0); ctx.change('label', 'Never saved'); ctx.click('cancel');
    expect(ctx.editor.draft).toBeNull(); expect(ctx.card._layout.security_bindings[0].label).toBe('Front door'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    ctx.click('edit', 0); ctx.rendered.mockClear(); ctx.editor.reset(); expect(ctx.rendered).not.toHaveBeenCalled(); expect(ctx.editor.draft).toBeNull();
    ctx.editor.dispose(); ctx.editor.dispose(); expect(ctx.rendered).not.toHaveBeenCalled(); expect(ctx.editor.render()).toBe(''); expect(ctx.editor.onClick('sec-add')).toBe(false); expect(ctx.editor.onChange('sec-label', { value: 'bad' })).toBe(false); ctx.noActions();
  });
});

describe('contact choices, missing references and deliberate repair', () => {
  it('filters hidden/disabled/diagnostic and noncontact classes while preserving missing selected IDs', () => {
    const ctx = setup({ states: { 'binary_sensor.hidden': st(), 'binary_sensor.disabled': st(), 'binary_sensor.diagnostic': st(), 'lock.front': st() },
      entities: { 'binary_sensor.hidden': { hidden_by: 'user' }, 'binary_sensor.disabled': { disabled_by: 'user' }, 'binary_sensor.diagnostic': { entity_category: 'diagnostic' } } });
    const choices = securityEntities(ctx.card._hass, ['binary_sensor.removed']);
    expect(choices.filter((c) => c.selectable).map((c) => c.value)).toEqual(['binary_sensor.unclassified', 'binary_sensor.front', 'binary_sensor.window']);
    expect(choices.find((c) => c.value === 'binary_sensor.removed')).toMatchObject({ selectable: false, selected: true }); ctx.noActions();
  });
  it('requires deliberate confirmation for an unclassified source and does not accept motion as a door', () => {
    const ctx = setup(); ctx.choose(); ctx.change('entity', 'binary_sensor.unclassified'); ctx.click('save'); expect(ctx.host.textContent).toContain('Confirm that this unclassified');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.change('confirmed', true); ctx.click('save'); expect(ctx.card._layout.security_bindings[0].contact_source_confirmed).toBe(true);
    ctx.click('edit', 0); ctx.editor.onChange('sec-entity', { value: 'binary_sensor.motion' }); expect(ctx.editor.draft.entity).toBe('binary_sensor.unclassified'); ctx.noActions();
  });
  it('retains an exact missing entity selected/read-only until deliberate repair, then saves only the chosen replacement', () => {
    const binding = saved({ entity: 'binary_sensor.removed', extra: 9 }); const ctx = setup({ layout: { security_bindings: [binding] } }); ctx.click('edit', 0);
    expect(ctx.input('entity').value).toBe('binary_sensor.removed'); expect(ctx.input('entity').selectedOptions[0].disabled).toBe(true); expect(ctx.input('label').disabled).toBe(true);
    ctx.editor.onChange('sec-entity', { value: 'binary_sensor.front' }); ctx.editor.onClick('sec-save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.editor.draft.entity).toBe('binary_sensor.removed');
    ctx.click('repair'); ctx.change('entity', 'binary_sensor.front'); ctx.click('save'); expect(ctx.card._layout.security_bindings[0]).toEqual({ ...binding, entity: 'binary_sensor.front' }); ctx.noActions();
  });
  it('preserves missing model IDs and exact leaf paths without choosing a similar name', () => {
    const binding = saved({ object_id: 'deleted-door', motion: hinge({ target: 'deleted-leaf' }) }); const ctx = setup({ layout: { security_bindings: [binding] } }); ctx.click('edit', 0);
    expect(ctx.input('object').value).toBe('deleted-door'); expect(ctx.input('target').value).toBe('deleted-leaf'); ctx.click('repair'); ctx.change('object', 'front');
    expect(ctx.input('target').value).toBe('deleted-leaf'); ctx.click('save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    ctx.change('target', 'leaf'); ctx.click('save'); expect(ctx.card._layout.security_bindings[0]).toEqual({ ...binding, object_id: 'front', motion: hinge() }); ctx.noActions();
  });
  it('unavailable/unknown/restored readings show honest warnings but remain configurable', () => {
    for (const state of [st('unavailable'), st('unknown'), st('on', 'Front', 'door', { restored: true })]) {
      const ctx = setup({ states: { 'binary_sensor.front': state }, layout: { security_bindings: [saved()] } }); ctx.click('edit', 0);
      expect(ctx.input('label').disabled).toBe(false); expect(ctx.host.textContent).toContain('Opening state is unknown'); ctx.change('label', 'Offline contact'); ctx.click('save'); expect(ctx.card.commitFeatureLayout).toHaveBeenCalledOnce(); ctx.noActions();
    }
  });
  it('keeps hidden/registered-no-state saved references read-only and permits explicit clear only', () => {
    for (const opts of [{ entities: { 'binary_sensor.front': { hidden: true } } }, { states: { 'binary_sensor.front': undefined }, entities: { 'binary_sensor.front': {} } }]) {
      const ctx = setup({ ...opts, layout: { security_bindings: [saved(), saved({ id: 'window', object_id: 'window', entity: 'binary_sensor.window' })] } }); ctx.click('edit', 0);
      expect(ctx.input('label').disabled).toBe(true); ctx.click('clear-draft'); expect(ctx.card._layout.security_bindings).toHaveLength(1); expect(ctx.card._layout.security_bindings[0].id).toBe('window'); ctx.noActions();
    }
  });
  it('preserves malformed saved entries and arrays until an explicit clear/repair action', () => {
    const ctx = setup({ layout: { security_bindings: [null, saved({ id: 'window', object_id: 'window', entity: 'binary_sensor.window' })] } }); ctx.click('edit', 0);
    expect(ctx.host.textContent).toContain('saved binding is malformed'); expect(ctx.card._layout.security_bindings[0]).toBeNull(); ctx.click('clear-draft'); expect(ctx.card._layout.security_bindings[0].id).toBe('window');
    const bad = setup({ layout: { security_bindings: 'old-malformed-json' } }); expect(bad.host.textContent).toContain('malformed and preserved'); expect(bad.card.commitFeatureLayout).not.toHaveBeenCalled();
    bad.click('clear-all'); expect(bad.card._layout.security_bindings).toEqual([]); ctx.noActions(); bad.noActions();
  });
});

describe('exact model validation and concurrent/focused lifecycle', () => {
  it('rejects raw duplicate tagged IDs omitted by the manifest, and untagged plain names', () => {
    const model = modelFixture(); const duplicate = model.front.clone(); model.level.add(duplicate); model.manifest = buildManifest(threeAdapter(model.root));
    const ctx = setup({ model, layout: { security_bindings: [saved()] } }); ctx.click('edit', 0); expect(ctx.input('object').selectedOptions[0].textContent).toContain('Ambiguous'); expect(ctx.input('label').disabled).toBe(true);
    delete duplicate.userData.fp; model.level.remove(duplicate); delete model.front.userData.fp; model.front.name = 'front'; model.manifest = buildManifest(threeAdapter(model.root));
    ctx.editor.updatePreviews(ctx.host); expect(ctx.input('object').selectedOptions[0].textContent).toContain('Missing tagged object'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noActions();
  });
  it('rejects ambiguous child paths, skinned/deforming leaf targets, and external transform writers', () => {
    const ctx = setup({ layout: { security_bindings: [saved({ motion: hinge() })] } }); const duplicate = ctx.model.leaf.clone(); ctx.model.front.add(duplicate); ctx.click('edit', 0);
    expect(ctx.input('target').selectedOptions[0].disabled).toBe(true); expect(ctx.input('label').disabled).toBe(true); ctx.click('cancel'); ctx.model.front.remove(duplicate);
    ctx.model.leaf.isSkinnedMesh = true; ctx.click('edit', 0); expect(ctx.input('target').selectedOptions[0].disabled).toBe(true); ctx.click('cancel'); ctx.model.leaf.isSkinnedMesh = false;
    ctx.card.securityMotionWriters = () => new Set([ctx.model.front]); ctx.click('edit', 0); expect(ctx.input('target').selectedOptions[0].textContent).toContain('another transform writer'); ctx.noActions();
  });
  it('validates rigid authored transforms without mutating matrices, hierarchy, material or creating previews', () => {
    const ctx = setup(); const node = ctx.model.leaf, p = node.position.clone(), q = node.quaternion.clone(), m = node.matrix.clone(), material = node.material, parent = node.parent;
    ctx.choose(); configureMotion(ctx); ctx.editor.updatePreviews(ctx.host); ctx.click('save'); expect(ctx.card.commitFeatureLayout).toHaveBeenCalledOnce();
    expect(node.position.equals(p)).toBe(true); expect(node.quaternion.equals(q)).toBe(true); expect(node.matrix.equals(m)).toBe(true); expect(node.material).toBe(material); expect(node.parent).toBe(parent); expect(node.children).toEqual([]); ctx.noActions();
  });
  it.each(['empty', 'oversized'])('rejects %s outline geometry before saving a binding the runtime cannot draw', (kind) => {
    const ctx = setup(); if (kind === 'empty') ctx.model.leaf.geometry = new THREE.BufferGeometry(); else ctx.model.leaf.geometry.attributes.position.count = 100001;
    ctx.choose(); ctx.click('save'); expect(ctx.host.textContent).toContain('bounded rigid mesh geometry'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noActions();
  });
  it('ignores a stale moving-part event after motion was deliberately removed', () => {
    const ctx = setup({ layout: { security_bindings: [saved({ motion: hinge() })] } }); ctx.click('edit', 0); ctx.change('motion', false);
    expect(() => ctx.editor.onChange('sec-target', { value: 'leaf' })).not.toThrow(); expect(ctx.editor.draft.motion).toBeUndefined(); ctx.click('save'); expect(ctx.card._layout.security_bindings[0].motion).toBeUndefined(); ctx.noActions();
  });
  it('rejects a duplicate object binding or nested security writer rather than choosing one', () => {
    const ctx = setup({ layout: { security_bindings: [saved()] } }); ctx.choose(); ctx.click('save'); expect(ctx.host.textContent).toContain('already has a security binding'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    const model = modelFixture(); model.leaf.userData.fp = { kind: 'object', id: 'nested', type: 'door' }; model.manifest = buildManifest(threeAdapter(model.root));
    const nested = setup({ model, layout: { security_bindings: [saved({ motion: hinge({ target: '.' }) })] } }); nested.click('add'); nested.change('entity', 'binary_sensor.front'); nested.change('object', 'nested'); nested.click('contact-preset'); nested.change('motion', true); nested.change('target', '.');
    for (const [key, values] of [['pivot', ['0', '0', '0']], ['axis', ['0', '1', '0']]]) for (const [i, value] of values.entries()) nested.change(`${key}-${i}`, value);
    nested.change('closed-degrees', '0'); nested.change('open-degrees', '80'); nested.change('duration', '200'); nested.click('save'); expect(nested.host.textContent).toContain('parent/child'); expect(nested.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noActions(); nested.noActions();
  });
  it('updates status/choice names while keeping a focused draft native field and selection intact', () => {
    const ctx = setup({ layout: { security_bindings: [saved()] } }); ctx.click('edit', 0); const label = ctx.input('label'), entity = ctx.input('entity');
    label.focus(); label.value = 'Unfinished label'; label.setSelectionRange(2, 6); label.dispatchEvent(new Event('input', { bubbles: true })); ctx.rendered.mockClear();
    ctx.card._hass = { ...ctx.card._hass, states: { ...ctx.card._hass.states, 'binary_sensor.front': st('off', 'Changed live name') } }; ctx.editor.afterUpdate(ctx.host);
    expect(ctx.input('label')).toBe(label); expect(ctx.input('entity')).toBe(entity); expect(document.activeElement).toBe(label); expect(label.value).toBe('Unfinished label'); expect(label.selectionStart).toBe(2); expect(label.selectionEnd).toBe(6);
    expect(entity.value).toBe('binary_sensor.front'); expect(entity.selectedOptions[0].textContent).toContain('Changed live name'); expect(ctx.host.textContent).toContain('Closed contact reported'); expect(ctx.rendered).not.toHaveBeenCalled(); ctx.noActions();
  });
  it('preserves focused native entity selects when new unrelated entities arrive', () => {
    const ctx = setup({ layout: { security_bindings: [saved()] } }); ctx.click('edit', 0); const entity = ctx.input('entity'); entity.focus();
    ctx.card._hass.states['binary_sensor.new_window'] = st('off', 'New window', 'window'); ctx.editor.updatePreviews(ctx.host);
    expect(ctx.input('entity')).toBe(entity); expect(document.activeElement).toBe(entity); expect(entity.value).toBe('binary_sensor.front'); ctx.noActions();
  });
  it.each(['key', 'model', 'saved'])('blocks a stale draft after %s changes without overwriting new context', (kind) => {
    const ctx = setup({ layout: { security_bindings: [saved()] } }); ctx.click('edit', 0); ctx.change('label', 'Stale draft');
    if (kind === 'key') ctx.card._config.layout_key = 'other'; if (kind === 'model') ctx.card._view.model = modelFixture(); if (kind === 'saved') ctx.card._layout.security_bindings[0] = saved({ label: 'Changed remotely' });
    ctx.editor.updatePreviews(ctx.host); ctx.editor.onClick('sec-save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.host.textContent).toMatch(/changed|reopen/); ctx.noActions();
  });
  it('enforces read-only admin guards on direct delegated Save/Clear/Add/Repair handlers', () => {
    for (const opts of [{ admin: false }, { editAllowed: false }, { editAllowed: () => false }]) {
      const ctx = setup({ ...opts, layout: { security_bindings: [saved()] } }); ctx.click('edit', 0); expect(ctx.input('label').disabled).toBe(true);
      for (const action of ['sec-save', 'sec-clear', 'sec-add', 'sec-repair', 'sec-clear-draft']) ctx.editor.onClick(action, { dataset: { index: '0' } });
      ctx.editor.onChange('sec-label', { value: 'Forbidden' }); expect(ctx.editor.draft.label).toBe('Front door'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); ctx.noActions();
    }
    const ctx = setup({ editAllowed: () => true }); ctx.choose(); ctx.click('save'); expect(ctx.card.commitFeatureLayout).toHaveBeenCalledOnce(); ctx.noActions();
  });
  it('escapes labels and attribute values while using native labelled controls and 44px targets', () => {
    const ctx = setup({ layout: { security_bindings: [saved({ label: '<img src=x onerror=alert(1)>"' })] } }); ctx.click('edit', 0);
    expect(ctx.host.querySelector('img')).toBeNull(); expect(ctx.host.querySelector('[data-security-editor]').dataset.taylors3dUi).toBe('security-editor');
    expect(ctx.host.querySelector('style').textContent).toContain('min-height:44px'); expect(ctx.input('label').closest('label')).toBeTruthy(); ctx.noActions();
  });
});
