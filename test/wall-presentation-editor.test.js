// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WallPresentationEditor } from '../src/wall-presentation-editor.js';
import { readWallPresentation, wallTargetReport } from '../src/wall-presentation.js';
import { FloorplanView } from '../src/view.js';

const instances = [];
const face = { space: 'node-local', point: [0.125, 1.5, -.25], normal: [0, 0, 2] };
const wall = (extra = {}) => ({ id: 'wall-1', label: 'Front wall', enabled: true, selector: 'node:House/Wall', face: structuredClone(face), floor_id: 'ground', ...extra });
const settings = (extra = {}) => ({ enabled: true, mode: 'fade', scope: 'camera_side', walls: [wall()], ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function setup({ layout = {}, config = {}, admin = true, missingApi = false, picker = true, prepared = true } = {}) {
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, .1), new THREE.MeshStandardMaterial({ color: '#e0d7ca' }));
  const second = new THREE.Mesh(new THREE.BoxGeometry(2, 3, .1), mesh.material); root.add(mesh, second);
  const candidates = { prepared, rows: [
    { selector: 'node:House/Wall', label: 'Wall', node: mesh, selectable: true },
    { selector: 'node:House/OtherWall', label: 'Other wall', node: second, selectable: true },
  ], diagnostics: [] };
  const card = { _config: { layout_key: 'house', ...config }, _layout: { floors: [{ id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'upper', name: 'First floor', elevation: 3 }], ...layout },
    _view: { model: { root } }, _hass: { user: { id: 'taylor', is_admin: admin }, states: {}, callService: vi.fn(), callWS: vi.fn() },
    _modelAlign: () => ({ x: 0, y: 0, scale: 1 }),
    commitFeatureLayout: vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; }),
  };
  if (!missingApi) {
    card._view.wallPresentationCandidates = () => candidates;
    card._view.wallPresentationReport = () => wallTargetReport(card._layout.wall_presentation ?? card._config.wall_presentation, {
      index: { nodes: candidates.rows.map((row) => ({ node: row.node, path: row.selector.slice(5) })) }, floors: card._layout.floors, modelRoot: card._view.model?.root,
    });
  }
  const host = document.createElement('div'); document.body.append(host);
  const begin = vi.fn(), cancel = vi.fn();
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  const editor = new WallPresentationEditor(card, render, picker ? { onBeginPick: begin, onCancelPick: cancel } : {});
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => editor.onClick(event.target.closest('[data-act]')?.dataset.act));
  render(); instances.push(editor);
  const field = (name) => host.querySelector(`[data-field="wall-presentation-${name}"]`);
  const button = (name) => host.querySelector(`[data-act="wall-presentation-${name}"]`);
  const change = (name, value, type = 'input') => {
    const control = field(name); if (control.type === 'checkbox') control.checked = value; else control.value = value;
    control.dispatchEvent(new Event(type, { bubbles: true })); return control;
  };
  const click = (name) => button(name).click();
  const pick = (extra = {}) => editor.receiveSurfacePick({ token: editor.pendingSurfacePick?.token, selector: 'node:House/Wall', label: 'Wall', face: structuredClone(face), floor_id: 'ground', modelRoot: card._view.model?.root, ...extra });
  return { card, host, editor, root, mesh, second, candidates, begin, cancel, field, button, change, click, pick, render };
}

afterEach(() => { instances.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); });

describe('standalone exact-wall presentation drafts', () => {
  it('opens with unchanged defaults and honest missing integration seams', () => {
    const { card, host, field, button, click } = setup({ missingApi: true, picker: false });
    expect(field('enabled').checked).toBe(false); expect(field('mode').value).toBe('normal');
    expect(field('scope').value).toBe('camera_side'); expect(field('opacity').value).toBe('20');
    expect(field('transition_ms').value).toBe('250'); expect(field('cut_height_m').value).toBe('1.2');
    expect(button('save').disabled).toBe(true); expect(button('prepare').disabled).toBe(true);
    expect(host.textContent).toContain('Wall selection is not connected'); click('cancel');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it.each(['normal', 'fade', 'cutaway', 'glass'])('saves an explicit %s display choice once without touching model materials or HA', (mode) => {
    const { card, mesh, change, click } = setup({ layout: { wall_presentation: settings() } });
    const before = { opacity: mesh.material.opacity, transparent: mesh.material.transparent, geometry: mesh.geometry };
    change('mode', mode, 'change'); change('opacity', '35'); click('save'); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(card._layout.wall_presentation).toMatchObject({ mode, opacity: .35 });
    expect(mesh.material.opacity).toBe(before.opacity); expect(mesh.material.transparent).toBe(before.transparent); expect(mesh.geometry).toBe(before.geometry);
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('uses shared settings before YAML and preserves all untouched extension fields', () => {
    const saved = settings({ future: { edition: 'v2' }, walls: [wall({ future: 42, face: { ...face, authored: 'keep' } }), wall({ id: 'wall-2', selector: 'node:House/OtherWall', label: 'Back', extension: [1, 2] })] });
    const yaml = settings({ mode: 'glass', origin: 'YAML' });
    const { card, change, click } = setup({ layout: { wall_presentation: saved }, config: { wall_presentation: yaml } });
    change('wall.label', 'My front wall'); click('save');
    expect(card._layout.wall_presentation).toEqual({ ...saved, walls: [{ ...saved.walls[0], label: 'My front wall' }, saved.walls[1]] });
    expect(saved.walls[0].label).toBe('Front wall'); expect(card._config.wall_presentation).toEqual(yaml);
  });
  it('inherits YAML until a deliberate Save and Cancel does not normalize imported values', () => {
    const saved = settings({ future: true, opacity: .231, walls: [wall({ face: { ...face, normal: [0, 0, 5] } })] });
    const { card, field, change, click } = setup({ config: { wall_presentation: saved } });
    expect(field('opacity').value).toBe('23.1'); change('transition_ms', '40'); click('cancel');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._config.wall_presentation).toEqual(saved);
    change('wall.label', 'Edited'); click('save'); expect(card._layout.wall_presentation.walls[0].face.normal).toEqual([0, 0, 5]);
  });
  it('edits a retained exact wall using real View readiness while unrelated model geometry is merged', () => {
    const saved = settings({ future: true, walls: [wall({ future: { keep: 1 } })] });
    const { card, mesh, root, candidates, field, button, host, change, click, render } = setup({ layout: { wall_presentation: saved } });
    const view = { model: { root }, mergeStats: { enabled: true, merged: 7 },
      _wallNodeIndex: () => ({ nodes: candidates.rows.map((row) => ({ path: row.selector.slice(5), node: row.node })) }) };
    card._view.wallPresentationCandidates = () => FloorplanView.prototype.wallPresentationCandidates.call(view);
    render(); const report = card._view.wallPresentationCandidates();
    expect(report.prepared).toBe(false); expect(report.rows.find((row) => row.node === mesh).selectable).toBe(true);
    expect(field('wall.label').disabled).toBe(false); expect(field('wall.floor_id').disabled).toBe(false);
    expect(host.querySelector('[data-wall-presentation-row-status]').textContent).toContain('Exact current rigid mesh');
    expect(button('pick').disabled).toBe(true);
    change('wall.label', 'My retained wall'); change('wall.floor_id', 'upper', 'change'); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
    expect(card._layout.wall_presentation).toEqual({ ...saved, walls: [{ ...saved.walls[0], label: 'My retained wall', floor_id: 'upper' }] });
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('requires prepared geometry for a new static mesh choice as well as canvas capture', () => {
    const { editor, begin, field, button, click, change } = setup({ prepared: false });
    change('scope', 'all_selected', 'change'); click('add');
    const selector = field('wall.selector');
    expect(selector.querySelector('option[value="node:House/Wall"]').disabled).toBe(true);
    editor.onChange('wall-presentation-wall.selector', { value: 'node:House/Wall', dataset: { wallIndex: '0', wallId: editor.draft.walls[0].id } });
    expect(editor.draft.walls[0].selector).toBe('');
    click('pick'); expect(begin).not.toHaveBeenCalled(); expect(editor.pendingSurfacePick).toBeNull(); expect(button('save').disabled).toBe(true);
  });
  it.each(['missing', 'ambiguous', 'merged'])('keeps a genuinely %s saved mesh readonly despite allowing retained rigid mesh edits', (kind) => {
    const saved = settings({ walls: [wall({ future: { keep: 1 } })] });
    const { card, candidates, mesh, second, editor, field, change, click, render } = setup({ layout: { wall_presentation: saved }, prepared: false });
    if (kind === 'missing') candidates.rows.shift();
    if (kind === 'ambiguous') candidates.rows.push({ ...candidates.rows[0], node: second });
    if (kind === 'merged') mesh.userData.merged = 2;
    render(); expect(field('wall.label').disabled).toBe(true); expect(field('wall.floor_id').disabled).toBe(true);
    change('wall.label', 'Accidental replacement'); expect(editor.draft.walls[0].label).toBe(saved.walls[0].label);
    change('opacity', '33'); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(card._layout.wall_presentation.walls).toEqual(saved.walls);
  });
  it('cancels an old surface capture if the geometry is no longer prepared without changing its root', () => {
    const { editor, candidates, click, pick, begin, host } = setup({ layout: { wall_presentation: settings() } });
    click('pick'); const previous = editor.pendingSurfacePick;
    candidates.prepared = false; editor.updatePreviews(host);
    expect(editor.pendingSurfacePick).toBeNull(); expect(pick({ token: previous.token })).toBe(false);
    expect(editor.draft.walls[0].face).toEqual(face);
    candidates.prepared = true; editor.updatePreviews(host); click('pick');
    expect(editor.pendingSurfacePick.token).not.toBe(previous.token); expect(begin).toHaveBeenCalledTimes(2); expect(pick()).toBe(true);
  });
  it('adds a unique explicit row, freezes an actual surface payload, and leaves all operations draft-only until Save', () => {
    const { card, editor, begin, cancel, click, pick } = setup();
    click('add'); click('pick'); const pending = editor.pendingSurfacePick;
    expect(pending.token).toMatch(/^wall-surface-/); expect(begin).toHaveBeenCalledWith(pending);
    expect(pick()).toBe(true); expect(cancel).toHaveBeenCalledExactlyOnceWith(pending.token);
    expect(editor.draft.walls[0]).toMatchObject({ id: 'wall-1', label: 'Wall', selector: 'node:House/Wall', floor_id: 'ground', face: { ...face, normal: [0, 0, 1] } });
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
    click('save'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(editor.pendingSurfacePick).toBeNull();
  });
  it('allows a static exact mesh without a face and never expands groups, room selectors or wildcards', () => {
    const { card, editor, change, click, field } = setup({ picker: false });
    click('add'); change('scope', 'all_selected', 'change'); change('wall.selector', 'node:House/Wall', 'change');
    expect(field('wall.selector').value).toBe('node:House/Wall'); expect(editor.draft.walls[0].face).toBeUndefined();
    click('save'); expect(card._layout.wall_presentation.walls[0].selector).toBe('node:House/Wall'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
  });
  it.each(['node:House/*', 'room:kitchen', 'object:wall', 'node:House/Group', 'node:House/Merged', 'node:House/Instanced', 'node:House/Skinned', 'node:House/Morph', 'node:House/Shader'])('rejects an unsafe candidate %s even if a stale candidate advertises selectable', (selector) => {
    const { root, mesh, candidates, editor, click, pick } = setup();
    let node = mesh;
    if (selector.endsWith('Group')) { node = new THREE.Group(); root.add(node); }
    if (selector.endsWith('Merged')) mesh.userData.merged = 2;
    if (selector.endsWith('Instanced')) mesh.isInstancedMesh = true;
    if (selector.endsWith('Skinned')) mesh.isSkinnedMesh = true;
    if (selector.endsWith('Morph')) mesh.geometry.morphAttributes.position = [mesh.geometry.attributes.position];
    if (selector.endsWith('Shader')) mesh.material = new THREE.ShaderMaterial();
    candidates.rows.push({ selector, label: 'Unsafe', node, selectable: true });
    click('add'); click('pick'); expect(pick({ selector })).toBe(false);
    expect(editor.draft.walls[0].selector).toBe(''); expect(editor.pendingSurfacePick).not.toBeNull();
  });
  it('accepts a literal escaped star as an exact mesh name, not a wildcard', () => {
    const { mesh, candidates, click, pick, card } = setup();
    const selector = 'node:House/Wall\\*literal'; candidates.rows.push({ selector, label: 'Wall*literal', node: mesh, selectable: true });
    click('add'); click('pick'); expect(pick({ selector })).toBe(true); click('save');
    expect(card._layout.wall_presentation.walls[0].selector).toBe(selector);
  });
  it.each([undefined, { space: 'world', point: [0, 1, 2], normal: [1, 0, 0] }, { ...face, point: [true, 0, 0] }, { ...face, normal: [0, 0, 0] }, { ...face, normal: [Infinity, 0, 0] }])('rejects missing/malformed face %j and never invents a camera-side plane', (badFace) => {
    const { editor, click, pick, button } = setup(); click('add'); click('pick');
    expect(pick({ face: badFace })).toBe(false); expect(editor.draft.walls[0].face).toBeUndefined(); expect(button('save').disabled).toBe(true);
  });
  it('requires a deliberate existing floor for cut-away and rejects guessed or malformed floor elevation', () => {
    const { card, editor, change, click, pick, button } = setup(); click('add'); change('mode', 'cutaway', 'change'); click('pick');
    expect(pick({ floor_id: undefined })).toBe(false); expect(pick({ floor_id: 'Ground floor' })).toBe(false);
    card._layout.floors[0].elevation = '0'; editor.updatePreviews(document.body);
    expect(editor.pendingSurfacePick).toBeNull(); expect(button('save').disabled).toBe(true);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('does not assign a candidate floor implicitly during static selection', () => {
    const { candidates, editor, change, click, button } = setup(); candidates.rows[0].floor_id = 'ground';
    change('scope', 'all_selected', 'change'); change('mode', 'cutaway', 'change'); click('add'); change('wall.selector', 'node:House/Wall', 'change');
    expect(editor.draft.walls[0].floor_id).toBeUndefined(); expect(button('save').disabled).toBe(true);
    change('wall.floor_id', 'ground', 'change'); expect(button('save').disabled).toBe(false);
  });
  it('keeps missing exact references readonly until explicit Relink, Disable or Remove', () => {
    const saved = settings({ walls: [wall({ selector: 'node:Old/Wall', floor_id: 'old-floor', future: { keep: 1 } })] });
    const { card, host, field, button, change, click } = setup({ layout: { wall_presentation: saved } });
    expect(field('wall.selector').disabled).toBe(true); expect(field('wall.label').disabled).toBe(true); expect(field('wall.floor_id').disabled).toBe(true);
    expect(button('pick').disabled).toBe(true); expect(field('wall.enabled').disabled).toBe(false); expect(host.textContent).toContain('reference is kept');
    change('wall.enabled', false, 'change'); click('save');
    expect(card._layout.wall_presentation.walls[0]).toEqual({ ...saved.walls[0], enabled: false });
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
  });
  it('deliberately relinks a missing mesh, clears its old face/floor and preserves unrelated raw extensions', () => {
    const saved = settings({ walls: [wall({ selector: 'node:Old/Wall', future: 42 })] });
    const { card, editor, field, button, change, click } = setup({ layout: { wall_presentation: saved } });
    click('relink'); expect(field('wall.selector').disabled).toBe(false); change('wall.selector', 'node:House/OtherWall', 'change');
    expect(editor.draft.walls[0]).toEqual({ id: 'wall-1', label: 'Front wall', enabled: true, selector: 'node:House/OtherWall', future: 42 });
    expect(button('save').disabled).toBe(true); change('scope', 'all_selected', 'change'); click('save');
    expect(card._layout.wall_presentation.walls[0].future).toBe(42);
  });
  it('rejects accidentally selecting a different wall through recapture without explicit Relink', () => {
    const { editor, click, pick } = setup({ layout: { wall_presentation: settings() } });
    click('pick'); expect(pick({ selector: 'node:House/OtherWall' })).toBe(false);
    expect(editor.draft.walls[0].selector).toBe('node:House/Wall'); click('cancel-pick'); click('relink'); click('pick');
    expect(pick({ selector: 'node:House/OtherWall' })).toBe(true);
  });
  it('recaptures the same wall without losing face extension fields', () => {
    const { editor, click, pick } = setup({ layout: { wall_presentation: settings({ walls: [wall({ face: { ...face, future: 'authored context' } })] }) } });
    click('pick'); expect(pick({ face: { ...face, point: [.314, .159, .265] } })).toBe(true);
    expect(editor.draft.walls[0].face).toEqual({ ...face, point: [.314, .159, .265], normal: [0, 0, 1], future: 'authored context' });
  });
  it('preserves missing runtime references when changing valid global settings and reports them without pretending effects apply', () => {
    const saved = settings({ walls: [wall({ selector: 'node:Removed/Wall' })] });
    const { card, host, change, button, click } = setup({ layout: { wall_presentation: saved } });
    expect(host.textContent).toContain('saved wall mesh is missing'); change('opacity', '10'); expect(button('save').disabled).toBe(false); click('save');
    expect(card._layout.wall_presentation.walls[0]).toEqual(saved.walls[0]);
  });
  it.each([null, [], 'fade', 3])('preserves malformed policy %j until explicit defaults are chosen', (raw) => {
    const { card, field, click, button } = setup({ config: { wall_presentation: raw } });
    expect(field('mode').disabled).toBe(true); expect(button('save').disabled).toBe(true); click('cancel');
    expect(card._config.wall_presentation).toEqual(raw); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('repair'); click('save'); expect(card._layout.wall_presentation).toMatchObject({ enabled: false, mode: 'normal', walls: [] });
  });
  it('repairs global defaults without deleting malformed or missing saved rows', () => {
    const saved = settings({ mode: 'unknown', future: { keep: true }, walls: [null, wall({ selector: 'node:Old/Wall', face: { ...face, extension: 42 } })] });
    const { editor, button, click, card } = setup({ config: { wall_presentation: saved } });
    click('repair'); expect(editor.draft.walls).toEqual(saved.walls); expect(editor.draft.future).toEqual(saved.future); expect(button('save').disabled).toBe(true);
    click('remove'); expect(editor.draft.walls).toEqual([saved.walls[1]]); click('save');
    expect(card._layout.wall_presentation.walls[0]).toEqual(saved.walls[1]);
  });
  it('requires explicit clearing of a malformed wall list rather than silently changing it to an empty array', () => {
    const { editor, click, button, card } = setup({ config: { wall_presentation: { walls: 'future data', future: 7 } } });
    click('repair'); expect(editor.draft.walls).toBe('future data'); expect(button('add').disabled).toBe(true); expect(button('save').disabled).toBe(true);
    click('repair-list'); click('save'); expect(card._layout.wall_presentation).toMatchObject({ walls: [], future: 7 });
  });
  it.each([['opacity', ''], ['opacity', '-1'], ['opacity', '101'], ['transition_ms', '1001'], ['cut_height_m', '-.1']])('blocks invalid %s=%s without coercing a blank to zero', (name, value) => {
    const { editor, button, change, click, card } = setup({ layout: { wall_presentation: settings() } });
    change(name, value); expect(button('save').disabled).toBe(true); expect(readWallPresentation(editor.draft).valid).toBe(false);
    if (value === '') expect(editor.draft.opacity).toBe(''); click('save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('shows malformed checkbox imports as indeterminate and preserves them until deliberate repair', () => {
    const saved = settings({ enabled: 'yes', walls: [wall({ enabled: null })] });
    const { field, change, click, card } = setup({ layout: { wall_presentation: saved } });
    expect(field('enabled').indeterminate).toBe(true); expect(field('wall.enabled').indeterminate).toBe(true);
    change('enabled', false, 'change'); change('wall.enabled', false, 'change'); click('save');
    expect(card._layout.wall_presentation.enabled).toBe(false); expect(card._layout.wall_presentation.walls[0].enabled).toBe(false);
  });
  it('rejects duplicate IDs/targets and generates an unused ID without rewriting existing rows', () => {
    const saved = settings({ walls: [wall(), wall({ selector: 'node:House/OtherWall' })] });
    const { editor, click, button } = setup({ layout: { wall_presentation: saved } });
    click('add'); expect(editor.draft.walls[2].id).toBe('wall-2'); expect(button('save').disabled).toBe(true);
    expect(editor.draft.walls.slice(0, 2)).toEqual(saved.walls);
  });
  it.each(['settings', 'key', 'root', 'uploaded-source', 'alignment', 'floors', 'user', 'permission'])('latches a dirty %s context change through recovery, preserving native input focus and raw draft', (kind) => {
    const { card, editor, host, field, button, change, click, root } = setup({ layout: { model: { name: 'old.glb' }, wall_presentation: settings() }, config: { model: '' } });
    const input = change('opacity', '33'); input.focus();
    const original = { layout: card._layout, config: card._config, user: card._hass.user, align: card._modelAlign };
    if (kind === 'settings') card._layout = { ...card._layout, wall_presentation: settings({ opacity: .5 }) };
    if (kind === 'key') card._config = { ...card._config, layout_key: 'other' };
    if (kind === 'root') card._view.model = { root: new THREE.Group() };
    if (kind === 'uploaded-source') card._layout = { ...card._layout, model: { name: 'new.glb' } };
    if (kind === 'alignment') card._modelAlign = () => ({ scale: 2 });
    if (kind === 'floors') card._layout = { ...card._layout, floors: [...card._layout.floors, { id: 'new', elevation: 6 }] };
    if (kind === 'user') card._hass.user = { id: 'other', is_admin: true };
    if (kind === 'permission') card._hass.user = { id: 'taylor', is_admin: false };
    editor.updatePreviews(host); expect(editor.stale).toBe(true); expect(field('opacity')).toBe(input); expect(input.value).toBe('33');
    expect(editor.draft.opacity).toBe(.33); expect(button('save').disabled).toBe(true);
    card._layout = original.layout; card._config = original.config; card._hass.user = original.user; card._modelAlign = original.align; card._view.model = { root };
    editor.updatePreviews(host); expect(editor.stale).toBe(true); editor.onClick('wall-presentation-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('cancel'); expect(editor.stale).toBe(false); change('opacity', '33'); click('save'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
  });
  it('keeps focused native numeric, label and button nodes through unrelated HA updates and updated diagnostics', () => {
    const { editor, card, host, field, button, change, candidates } = setup({ layout: { wall_presentation: settings() } });
    const input = change('wall.label', 'My wall'); input.focus();
    card._hass = { ...card._hass, states: { 'sensor.temperature': { state: '12' } } }; candidates.diagnostics = [{ message: 'Current model note' }];
    editor.updatePreviews(host); expect(field('wall.label')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('My wall');
    const save = button('save'); save.focus(); editor.updatePreviews(host); expect(button('save')).toBe(save); expect(document.activeElement).toBe(save);
    const numeric = change('transition_ms', '123'); numeric.focus(); editor.updatePreviews(host); expect(field('transition_ms')).toBe(numeric); expect(document.activeElement).toBe(numeric);
    expect(host.textContent).toContain('Current model note'); expect(editor.stale).toBe(false);
  });
  it('refreshes a clean saved exact-path caption after a shared policy update without replacing its native label input', () => {
    const { card, editor, host, field } = setup({ layout: { wall_presentation: settings() } });
    const input = field('wall.label'); input.focus();
    card._layout.wall_presentation = settings({ walls: [wall({ selector: 'node:House/OtherWall', label: 'Other wall' })] });
    editor.updatePreviews(host);
    expect(field('wall.label')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('Other wall');
    expect(host.querySelector('.wall-presentation-path').textContent).toContain('node:House/OtherWall');
  });
  it('rejects a queued native field event belonging to a previously selected wall', () => {
    const { editor, field, change } = setup({ layout: { wall_presentation: settings({ walls: [wall(), wall({ id: 'wall-2', selector: 'node:House/OtherWall', label: 'Back' })] }) } });
    const old = field('wall.label'); change('selected', '1', 'change');
    old.value = 'Wrong destination'; editor.onInput('wall-presentation-wall.label', old);
    expect(editor.draft.walls[0].label).toBe('Front wall'); expect(editor.draft.walls[1].label).toBe('Back');
  });
  it('cancels an old surface token on selection, context loss and disposal, and never accepts an old replacement response', () => {
    const { editor, click, pick, cancel, change } = setup({ layout: { wall_presentation: settings({ walls: [wall(), wall({ id: 'wall-2', selector: 'node:House/OtherWall' })] }) } });
    click('pick'); const old = editor.pendingSurfacePick; change('selected', '1', 'change'); expect(cancel).toHaveBeenCalledExactlyOnceWith(old.token);
    click('pick'); const current = editor.pendingSurfacePick; expect(pick({ token: old.token })).toBe(false); expect(editor.pendingSurfacePick.token).toBe(current.token);
    editor.dispose(); expect(cancel).toHaveBeenCalledTimes(2); expect(editor.pendingSurfacePick).toBeNull(); expect(pick({ token: current.token })).toBe(false);
    expect(editor.render()).toBe(''); editor.dispose(); expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('cancels pending capture when an existing exact mesh is merged or moves to an old model root', () => {
    const { editor, click, mesh, host, cancel } = setup({ layout: { wall_presentation: settings() } }); click('pick');
    mesh.userData.merged = 2; editor.updatePreviews(host); expect(editor.pendingSurfacePick).toBeNull(); expect(cancel).toHaveBeenCalledOnce();
    mesh.userData.merged = 0; click('relink'); click('pick'); mesh.removeFromParent();
    expect(editor.receiveSurfacePick({ ...editor.pendingSurfacePick, selector: 'node:House/Wall', face, floor_id: 'ground' })).toBe(false);
    expect(editor.draft.walls[0]).toEqual(wall());
  });
  it('blocks a newly selected target that disappears before Save, but deliberate Disable preserves its exact reference', () => {
    const { card, editor, click, pick, candidates, host, button, change } = setup(); click('add'); click('pick'); expect(pick()).toBe(true);
    candidates.rows[0].selectable = false; editor.updatePreviews(host); expect(button('save').disabled).toBe(true);
    change('wall.enabled', false, 'change'); click('save'); expect(card._layout.wall_presentation.walls[0].selector).toBe('node:House/Wall'); expect(card._layout.wall_presentation.walls[0].enabled).toBe(false);
  });
  it('keeps new-target guards when removing a different row shifts its index', () => {
    const { editor, change, click, pick, candidates, host, button } = setup({ layout: { wall_presentation: settings() } });
    click('add'); click('pick'); expect(pick({ selector: 'node:House/OtherWall' })).toBe(true); change('selected', '0', 'change'); click('remove');
    candidates.rows[1].selectable = false; editor.updatePreviews(host); expect(button('save').disabled).toBe(true);
  });
  it.each([false, undefined, 'true'])('blocks edit/capture/save for admin=%j without actions', (admin) => {
    const { editor, card, host, click, button } = setup({ layout: { wall_presentation: settings() } });
    card._hass.user.is_admin = admin; editor.updatePreviews(host);
    expect(button('add').disabled).toBe(true); editor.onChange('wall-presentation-opacity', { value: '10' });
    editor.onClick('wall-presentation-pick'); editor.onClick('wall-presentation-save'); click('cancel');
    expect(editor.pendingSurfacePick).toBeNull(); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each([
    ['inactive', { is_active: false }], ['malformed activity', { is_active: 'true' }], ['null activity', { is_active: null }],
    ['missing ID', { id: undefined }], ['blank ID', { id: '' }], ['whitespace ID', { id: '  ' }], ['nontext ID', { id: 42 }],
  ])('makes the actual form readonly for an %s user and blocks delegated Save', (_name, profile) => {
    const { card, editor, host, field, button } = setup({ layout: { wall_presentation: settings() } });
    card._hass.user = { ...card._hass.user, ...profile }; editor.updatePreviews(host);
    expect(field('opacity').disabled).toBe(true); expect(button('prepare').disabled).toBe(true);
    editor.onChange('wall-presentation-opacity', { value: '37' }); editor.onClick('wall-presentation-save');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(editor.pendingSurfacePick).toBeNull();
  });
  it('latches present-null activity revocation even when the original compatible profile omitted activity', () => {
    const { editor, card, change, host, button, click } = setup({ layout: { wall_presentation: settings() } });
    change('opacity', '37'); expect(Object.hasOwn(card._hass.user, 'is_active')).toBe(false);
    card._hass.user.is_active = null; editor.updatePreviews(host); expect(editor.stale).toBe(true);
    delete card._hass.user.is_active; editor.updatePreviews(host); expect(editor.stale).toBe(true); expect(button('save').disabled).toBe(true);
    click('cancel'); change('opacity', '37'); click('save'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
  });
  it('handles a refused or thrown begin-pick callback without leaving a phantom pending state', () => {
    const { editor, begin, cancel, click } = setup(); click('add'); begin.mockReturnValueOnce(false); click('pick'); expect(editor.pendingSurfacePick).toBeNull();
    begin.mockImplementationOnce(() => { throw new Error('No scene'); }); click('pick'); expect(editor.pendingSurfacePick).toBeNull(); expect(cancel).toHaveBeenCalledTimes(2);
  });
});

describe('explicit preparation and lifecycle', () => {
  it('prepares only when clean, permits its own new root, then rereads actual candidates without a layout commit', async () => {
    const { card, editor, candidates, host, click, render, root, mesh } = setup({ prepared: false });
    const wait = deferred(); card.prepareWallSelection = vi.fn(() => wait.promise); render(); click('prepare'); expect(editor.preparing).toBe(true);
    const replacement = new THREE.Group(); replacement.add(mesh); card._view.model = { root: replacement }; candidates.prepared = true;
    wait.resolve({ prepared: true }); await editor.preparingPromise;
    expect(root.children).not.toContain(mesh); expect(editor.preparing).toBe(false); expect(host.textContent).toContain('Separate mesh choices are ready');
    expect(card.prepareWallSelection).toHaveBeenCalledOnce(); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('does not claim meshes are ready from a truthy preparer result if current candidates are still merged/unprepared', async () => {
    const { card, editor, host, click, render } = setup({ prepared: false }); card.prepareWallSelection = vi.fn(async () => ({ prepared: true })); render();
    click('prepare'); await editor.preparingPromise; expect(host.textContent).toContain('still unavailable'); expect(editor._candidates().prepared).toBe(false);
  });
  it('rejects preparation while dirty or waiting for a face, even through direct delegation', () => {
    const { card, editor, click, change, render } = setup({ layout: { wall_presentation: settings() } }); card.prepareWallSelection = vi.fn(); render();
    change('opacity', '30'); editor.onClick('wall-presentation-prepare'); expect(card.prepareWallSelection).not.toHaveBeenCalled();
    click('cancel'); click('pick'); editor.onClick('wall-presentation-prepare'); expect(card.prepareWallSelection).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'dispose', 'source', 'user'])('ignores late preparation after %s without mutating current settings', async (kind) => {
    const { card, editor, candidates, click, render, host } = setup({ prepared: false }); const wait = deferred(); card.prepareWallSelection = vi.fn(() => wait.promise); render(); click('prepare');
    if (kind === 'cancel') click('cancel'); if (kind === 'dispose') editor.dispose();
    if (kind === 'source') card._config.model = '/local/other.glb'; if (kind === 'user') card._hass.user = { id: 'other', is_admin: true };
    candidates.prepared = true; wait.resolve({ prepared: true }); await editor.preparingPromise;
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(editor.message).toBeNull(); expect(host.textContent).not.toContain('Separate mesh choices are ready');
  });
  it('reports a preparatory error and leaves raw saved settings intact', async () => {
    const saved = settings({ future: true }); const { card, editor, host, click, render } = setup({ config: { wall_presentation: saved }, prepared: false });
    card.prepareWallSelection = vi.fn(async () => { throw new Error('404'); }); render(); click('prepare'); await editor.preparingPromise;
    expect(editor.preparing).toBe(false); expect(host.textContent).toContain('could not be prepared'); expect(card._config.wall_presentation).toEqual(saved);
  });
  it('shows the actual readable preflight reason when the parent rejects a dirty shading draft', async () => {
    const { card, editor, host, click, render } = setup({ prepared: false });
    card.prepareWallSelection = vi.fn(async () => { throw new Error('Cancel unfinished Model shading changes before preparing exact wall meshes.'); });
    render(); click('prepare'); await editor.preparingPromise;
    expect(host.textContent).toContain('Cancel unfinished Model shading changes'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('escapes raw labels, paths and diagnostics and includes theme-aware 44px/focus styles', () => {
    const { host, candidates, editor } = setup({ layout: { wall_presentation: settings({ walls: [wall({ label: '<img src=x onerror=bad>' })] }) } });
    candidates.diagnostics = [{ message: '<script>bad()</script>' }]; editor.updatePreviews(host);
    expect(host.querySelector('img,script')).toBeNull(); expect(host.textContent).toContain('<script>bad()</script>');
    expect(host.querySelector('style').textContent).toContain('min-height:44px'); expect(host.querySelector('style').textContent).toContain('--ha-card-background');
    expect(host.querySelector('style').textContent).toContain(':focus-visible'); expect(host.querySelector('[data-taylors3d-ui]')).not.toBeNull();
  });
});
