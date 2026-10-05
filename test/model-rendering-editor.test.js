// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ModelRenderingEditor } from '../src/model-rendering-editor.js';

const editors = [];
function setup({ layout = {}, config = {}, root = null, admin = true } = {}) {
  const card = { _layout: layout, _config: { layout_key: 'house', ...config }, _view: { model: root ? { root } : null },
    _hass: { user: { is_admin: admin }, states: {}, callService: vi.fn(), callWS: vi.fn() },
    commitFeatureLayout: vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; }),
  };
  const host = document.createElement('div'); document.body.append(host);
  const editor = new ModelRenderingEditor(card, () => { host.innerHTML = editor.render(); });
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => editor.onClick(event.target.closest('[data-act]')?.dataset.act));
  host.innerHTML = editor.render(); editors.push(editor);
  const select = () => host.querySelector('[data-field="model-rendering-preset"]');
  const choose = (value) => { const element = select(); element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); return element; };
  const click = (action) => host.querySelector(`[data-act="model-rendering-${action}"]`).click();
  return { card, host, editor, select, choose, click };
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); });

describe('draft-only model shading settings', () => {
  it.each([
    ['normal', { shadows: 'realtime', lamps: 'inherit' }],
    ['no-shadows', { shadows: 'off', lamps: 'inherit' }],
    ['authored', { shadows: 'off', lamps: 'off' }],
    ['shadows-only', { shadows: 'realtime', lamps: 'off' }],
  ])('saves %s exactly once and sends no HA actions', (value, expected) => {
    const { card, host, choose, click } = setup();
    expect(host.textContent).toContain('No model is loaded'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    choose(value); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Save to apply it');
    click('save'); click('save'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
    expect(card._layout.model_rendering).toEqual(expected);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('uses layout before config, preserves unknown imported fields and leaves config untouched', () => {
    const saved = { shadows: 'off', lamps: 'inherit', future: { source: ['authored', 2] } };
    const config = { model_rendering: { shadows: 'realtime', lamps: 'inherit', source: 'YAML' } };
    const { card, select, choose, click } = setup({ layout: { model_rendering: saved }, config });
    expect(select().value).toBe('no-shadows'); choose('authored'); click('save');
    expect(card._layout.model_rendering).toEqual({ ...saved, lamps: 'off' });
    expect(saved.lamps).toBe('inherit'); expect(card._config.model_rendering).toEqual(config.model_rendering);
  });
  it('inherits YAML settings and extension fields without rewriting them on open or Cancel', () => {
    const config = { model: '/local/house.glb', model_rendering: { shadows: 'off', lamps: 'inherit', extension: 7 } };
    const { card, choose, click, select } = setup({ config });
    expect(select().value).toBe('no-shadows'); choose('authored'); click('cancel');
    expect(select().value).toBe('no-shadows'); expect(card._layout.model_rendering).toBeUndefined();
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); choose('authored'); click('save');
    expect(card._layout.model_rendering.extension).toBe(7);
  });
  it('recognises the shadows-only combination without rewriting its imported extension fields', () => {
    const saved = { shadows: 'realtime', lamps: 'off', future: true };
    const { card, host, select, choose, click } = setup({ layout: { model_rendering: saved } });
    expect(select().value).toBe('shadows-only'); expect(host.textContent).toContain('Realtime shadows (lamps off)');
    click('cancel'); expect(card._layout.model_rendering).toEqual(saved); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    choose('no-shadows'); click('save'); expect(card._layout.model_rendering).toEqual({ shadows: 'off', lamps: 'inherit', future: true });
  });
  it.each([null, [], 'off', { shadows: 'unknown', lamps: 'inherit', future: { note: 'keep' } }])('preserves malformed explicit settings %j until deliberately repaired', (saved) => {
    // Null layout settings follow the documented ?? precedence, so use config
    // for this explicit malformed null fixture.
    const { card, host, select, choose, click } = setup({ config: { model_rendering: saved } });
    expect(select().value).toBe('invalid'); expect(host.querySelector('[data-act="model-rendering-save"]').disabled).toBe(true);
    expect(card._config.model_rendering).toEqual(saved); click('cancel'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    choose('authored'); click('save');
    expect(card._layout.model_rendering).toMatchObject({ shadows: 'off', lamps: 'off' });
    if (saved?.future) expect(card._layout.model_rendering.future).toEqual(saved.future);
  });
  it.each(['normal', 'no-shadows'])('keeps the existing lights-off setting honest when %s is selected', (preset) => {
    const { card, host, choose, click } = setup({ config: { lights: 'off' } });
    expect(host.textContent).toContain('lights setting is already off'); choose(preset); click('save');
    expect(card._config.lights).toBe('off'); expect(card._layout.model_rendering.lamps).toBe('inherit');
  });
  it.each([false, undefined])('rejects saving when admin permission is %j, even through direct event delegation', (admin) => {
    const { card, host, editor } = setup(); card._hass.user.is_admin = admin; editor.updatePreviews(host);
    expect(host.querySelector('select').disabled).toBe(true);
    editor.onChange('model-rendering-preset', { value: 'authored' }); editor.onClick('model-rendering-save');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._layout.model_rendering).toBeUndefined();
  });
  it.each(['key', 'settings', 'model', 'source'])('blocks a dirty draft after %s context changes, retaining it until Cancel', (kind) => {
    const root = new THREE.Group(); const { card, host, editor, choose, click, select } = setup({ root });
    choose('authored');
    if (kind === 'key') card._config.layout_key = 'another-house';
    if (kind === 'settings') card._layout.model_rendering = { shadows: 'off', lamps: 'inherit' };
    if (kind === 'model') card._view.model = { root: new THREE.Group() };
    if (kind === 'source') card._config.model = '/local/replacement.glb';
    editor.updatePreviews(host); expect(select().value).toBe('authored');
    expect(host.textContent).toContain('Your choice is kept'); expect(host.querySelector('[data-act="model-rendering-save"]').disabled).toBe(true);
    editor.onClick('model-rendering-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('cancel'); expect(select().value).toBe(kind === 'settings' ? 'no-shadows' : 'normal');
  });
  it.each(['', false, 0, null, undefined])('guards an uploaded replacement while falsey YAML model=%j leaves the old rendered root pending', (model) => {
    const root = new THREE.Group();
    const { card, host, editor, choose, click, select } = setup({ root, config: { model }, layout: { model: { version: 'old', name: 'old.glb' } } });
    choose('authored'); const input = select(); input.focus();
    // The upload reference changes before the async GLB request installs a new
    // root. Match the card's truthy model: route, not nullish config presence.
    card._layout = { ...card._layout, model: { version: 'new', name: 'new.glb' } };
    editor.updatePreviews(host);
    expect(select()).toBe(input); expect(select().value).toBe('authored');
    expect(host.querySelector('[data-act="model-rendering-save"]').disabled).toBe(true);
    expect(host.textContent).toContain('Your choice is kept');
    editor.onClick('model-rendering-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('cancel'); expect(select().value).toBe('normal');
    choose('authored'); click('save'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
  });
  it('updates actual material evidence while keeping a focused unsaved choice and unchanged geometry', () => {
    const root = new THREE.Group(), ao = new THREE.Texture(); ao.channel = 1;
    const lit = new THREE.MeshStandardMaterial({ aoMap: ao }); lit.name = '<img src=x onerror=alert(1)>';
    const geometry = new THREE.BoxGeometry(1, 1, 1), mesh = new THREE.Mesh(geometry, lit); mesh.name = 'Floor'; root.add(mesh);
    const { card, host, choose, editor } = setup({ root }); const select = choose('authored'); select.focus();
    const before = mesh.matrix.toArray();
    expect(host.textContent).toContain('Ambient occlusion (AO) textures: 1 materials');
    expect(host.textContent).toContain('aoMap needs uv1'); expect(host.querySelector('img')).toBeNull();
    const unlit = new THREE.MeshBasicMaterial({ map: new THREE.Texture() }); root.add(new THREE.Mesh(geometry, unlit));
    editor.updatePreviews(host);
    expect(host.textContent).toContain('Unlit materials: 1'); expect(host.textContent).toContain('2 meshes');
    expect(host.querySelector('select')).toBe(select); expect(document.activeElement).toBe(select); expect(select.value).toBe('authored');
    expect(mesh.matrix.toArray()).toEqual(before); expect(lit.aoMap).toBe(ao); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('updates a clean focused select when another saved setting arrives without creating a draft', () => {
    const { card, host, editor, select } = setup(); const input = select(); input.focus();
    card._layout.model_rendering = { shadows: 'off', lamps: 'off' }; editor.updatePreviews(host);
    expect(select()).toBe(input); expect(input.value).toBe('authored'); expect(editor.dirty).toBe(false);
    expect(document.activeElement).toBe(input); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('rechecks permission on Save after a supported draft and stops permanently after dispose', () => {
    const { card, choose, editor } = setup(); choose('authored'); card._hass.user.is_admin = false;
    editor.onClick('model-rendering-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    editor.dispose(); card._hass.user.is_admin = true;
    expect(editor.render()).toBe(''); expect(editor.onClick('model-rendering-save')).toBe(false);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
});
