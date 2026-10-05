// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FurnitureEditor } from '../src/furniture-editor.js';

const PACK = 'a'.repeat(64), HASH = 'b'.repeat(64), OTHER = 'c'.repeat(64);
const editors = [];
const instance = (extra = {}) => ({ id: 'chair_1', pack_id: PACK, item_id: 'chair', asset_sha256: HASH,
  floor_id: 'ground', x: 2.5, y: -3.25, z: 0.5, rotation_degrees: 90, scale: 1, ...extra });
const furniture = (instances = [instance()], extra = {}) => ({ version: 1, instances, ...extra });
const catalogue = () => ({ version: 1, packs: [{ pack_id: PACK, manifest: { name: 'Local chairs', author: 'Author', license: { id: 'MIT', file: 'LICENSE.txt' } },
  items: [{ id: 'chair', name: 'Oak chair', pack_id: PACK, sha256: HASH, unit: 'm', anchor: [0, 0.25, 0], metadata: { credit: 'Author' } },
    { id: 'table', name: 'Round table', pack_id: PACK, sha256: OTHER, unit: 'm', anchor: [0, 0, 0] }] }] });
const floors = () => [{ id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'upper', name: 'First floor', elevation: 4 }];
function setup({ raw, library = { status: 'ready', catalogue: catalogue() }, preview = true, importPack, card: overrides = {} } = {}) {
  const card = { isConnected: true, _editing: true, _edit: { tab: 'model' }, _config: { layout_key: 'house' },
    _layout: { ...(raw === undefined ? {} : { furniture: raw }), model: { url: '/api/taylors3d/model/house.glb' } },
    _floors: floors(), _view: { model: { root: { uuid: 'house-root', position: { x: 0, y: 0, z: 0 } } } },
    _modelAlign: () => ({ position: [0, 0, 0], rotation: 0, scale: 1 }),
    _hass: { user: { id: 'taylor', is_admin: true, is_active: true }, connection: { connected: true }, auth: {}, states: {},
      callService: vi.fn(), callWS: vi.fn() },
    furnitureCatalogue: vi.fn(() => library),
    commitFeatureLayout: vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; }),
    ...overrides,
  };
  if (preview) card.furniturePreviewDraft = vi.fn();
  if (importPack) card.furnitureLibrary = { importPack };
  const host = document.createElement('div'); document.body.append(host);
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  const editor = new FurnitureEditor(card, render); editors.push(editor);
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const element = event.target.closest('[data-act]'); editor.onClick(element?.dataset.act, element); });
  render();
  const field = (name) => host.querySelector(`[data-field="furniture-${name}"]`);
  const button = (name) => host.querySelector(`[data-act="furniture-${name}"]`);
  const change = (name, value, type = 'input') => { const element = field(name); element.value = value;
    element.dispatchEvent(new Event(type, { bubbles: true })); return element; };
  const click = (name) => button(name).click();
  const add = () => { change('new-pack', PACK, 'change'); change('new-item', 'chair', 'change'); change('new-floor', 'ground', 'change'); click('add'); };
  const chooseFile = () => { const file = new File(['local zip'], 'chairs.zip', { type: 'application/zip' });
    Object.defineProperty(field('import-file'), 'files', { configurable: true, value: [file] });
    field('import-file').dispatchEvent(new Event('change', { bubbles: true })); return file; };
  return { card, editor, host, render, field, button, change, click, add, chooseFile, library };
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); });

describe('furniture visual draft and actual library choices', () => {
  it('opens an empty layout without guessing an item, a floor, a preview or an action', () => {
    const { card, editor, host, field, button, click } = setup({ preview: false });
    expect(editor.draft).toEqual({ version: 1, instances: [] });
    expect(field('new-pack').value).toBe(''); expect(field('new-item').value).toBe(''); expect(field('new-floor').value).toBe('');
    expect(host.textContent).toContain('Placement preview is not connected yet'); expect(button('add').disabled).toBe(true);
    expect(host.textContent).toContain('Declared metres do not prove'); click('cancel');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('adds only the deliberately selected published item and exact floor at its labelled plan origin', () => {
    const { card, editor, add, change, click } = setup(); add();
    expect(editor.draft.instances).toEqual([instance({ id: 'furniture_1', x: 0, y: 0, z: 0, rotation_degrees: 0 })]);
    expect(card._layout.furniture).toBeUndefined(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    change('x', '7.123'); change('y', '-2.375'); change('z', '0.125'); change('rotation_degrees', '-45'); change('scale', '0.75');
    click('save'); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledExactlyOnceWith({ furniture: furniture([instance({ id: 'furniture_1', x: 7.123, y: -2.375,
      z: 0.125, rotation_degrees: -45, scale: 0.75 })]) }, 'Furniture');
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('preserves instance and top-level extensions and keeps the original house unchanged', () => {
    const saved = furniture([instance({ extras: { material: 'original', credit: ['author'] } })], { future: { retained: [1, 2] } });
    const before = structuredClone(saved), { card, change, click } = setup({ raw: saved }); const house = card._view.model.root;
    change('x', '9'); expect(saved).toEqual(before); expect(house.position).toEqual({ x: 0, y: 0, z: 0 });
    click('save'); expect(card._layout.furniture).toEqual({ ...before, instances: [{ ...before.instances[0], x: 9 }] });
    expect(card._view.model.root).toBe(house); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('Cancel restores exact saved values and clears only its transient preview', () => {
    const saved = furniture([instance({ extra: { kept: true } })]), { card, editor, change, click, field } = setup({ raw: saved });
    expect(card.furniturePreviewDraft).not.toHaveBeenCalled(); change('x', '13.75');
    expect(card.furniturePreviewDraft).toHaveBeenLastCalledWith(furniture([instance({ x: 13.75, extra: { kept: true } })]));
    click('cancel'); expect(field('x').value).toBe('2.5'); expect(editor.dirty).toBe(false);
    expect(card._layout.furniture).toEqual(saved); expect(card.furniturePreviewDraft).toHaveBeenLastCalledWith(null);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('copies the actual item and extensions with a new instance ID at the same explicit coordinates', () => {
    const { card, editor, click } = setup({ raw: furniture([instance({ extra: { keep: 1 } })]) }); click('copy');
    expect(editor.draft.instances[1]).toEqual(instance({ id: 'furniture_1', extra: { keep: 1 } }));
    click('save'); expect(card._layout.furniture.instances).toHaveLength(2);
  });
  it('keeps Copy and Remove current after a focused coordinate edit', () => {
    const { editor, change, click } = setup({ raw: furniture() }); change('x', '8'); click('copy');
    expect(editor.draft.instances).toHaveLength(2); expect(editor.draft.instances[1].x).toBe(8); click('remove');
    expect(editor.draft.instances).toEqual([instance({ x: 8 })]);
  });
  it('does not exceed the explicit 128-instance budget through Copy', () => {
    const saved = furniture(Array.from({ length: 128 }, (_, index) => instance({ id: `chair_${index}` })));
    const { editor, button } = setup({ raw: saved }); expect(button('copy').disabled).toBe(true);
    editor.onClick('furniture-copy', button('copy')); expect(editor.draft.instances).toHaveLength(128);
  });
  it('allows a temporary blank number to be repaired without disabling the focused native field', () => {
    const { field, change, button, card, click } = setup({ raw: furniture() }); const input = field('x'); input.focus();
    change('x', ''); expect(field('x')).toBe(input); expect(document.activeElement).toBe(input); expect(input.disabled).toBe(false);
    expect(button('save').disabled).toBe(true); change('x', '6.5'); expect(button('save').disabled).toBe(false); click('save');
    expect(card._layout.furniture.instances[0].x).toBe(6.5);
  });
  it.each(['x', 'y', 'z', 'rotation_degrees', 'scale'])('keeps focused %s and its draft through ordinary HA updates without extra preview allocation', (name) => {
    const { card, editor, field, change, host } = setup({ raw: furniture() }); const input = field(name); input.focus(); change(name, name === 'scale' ? '1.25' : '8.125');
    const calls = card.furniturePreviewDraft.mock.calls.length;
    card._hass = { ...card._hass, states: { 'sensor.temperature': { state: '15' } } }; editor.updatePreviews(host);
    expect(field(name)).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe(name === 'scale' ? '1.25' : '8.125');
    expect(card.furniturePreviewDraft).toHaveBeenCalledTimes(calls);
  });
  it('does not create defaults for malformed present numbers or silently fix version/unknown fields', () => {
    const saved = furniture([instance({ x: '2', scale: null })], { version: '1', extra: 4 });
    const { editor, field, button, click } = setup({ raw: saved });
    expect(field('x').disabled).toBe(true); expect(button('save').disabled).toBe(true); click('repair-settings');
    expect(editor.draft.version).toBe(1); expect(editor.draft.extra).toBe(4); expect(editor.draft.instances[0].x).toBe('2');
    click('repair-instance'); expect(field('x').disabled).toBe(false); expect(field('scale').value).toBe('');
  });
  it('marks deliberate replacement of a non-object instance as a draft, then requires real references and coordinates', () => {
    const { editor, click, button } = setup({ raw: furniture([null]) }); click('repair-instance');
    expect(editor.dirty).toBe(true); expect(editor.draft.instances[0]).toMatchObject({ x: '', y: '', pack_id: '', floor_id: '' });
    expect(button('save').disabled).toBe(true);
  });
  it('keeps the current item/hash until explicit item selection and never reuses a same-named catalogue item', () => {
    const { editor, change, click, card } = setup({ raw: furniture() }); change('item_id', 'table', 'change');
    expect(editor.draft.instances[0]).toMatchObject({ item_id: 'table', asset_sha256: OTHER }); click('save');
    expect(card._layout.furniture.instances[0].asset_sha256).toBe(OTHER);
  });
  it('labels unavailable saved links read-only and permits deliberate removal while preserving unrelated extras', () => {
    const missing = instance({ id: 'missing', floor_id: 'deleted', extra: { keep: true } });
    const { editor, field, host, click, change, card } = setup({ raw: furniture([missing, instance()]) });
    expect(field('x').disabled).toBe(true); expect(host.textContent).toContain('Saved choice unavailable: deleted');
    expect(editor.draft.instances[0]).toEqual(missing); click('remove'); change('x', '4'); click('save');
    expect(card._layout.furniture.instances).toEqual([instance({ x: 4 })]);
  });
  it('preserves untouched missing records while a current record is explicitly changed', () => {
    const missing = instance({ id: 'missing', floor_id: 'deleted', extra: { kept: 1 } });
    const { change, click, card } = setup({ raw: furniture([missing, instance()], { extension: 'same' }) });
    change('selected', '1', 'change'); change('x', '4'); click('save');
    expect(card._layout.furniture).toEqual(furniture([missing, instance({ x: 4 })], { extension: 'same' }));
  });
  it('relinks a missing floor only after Repair, to the exact current floor', () => {
    const { change, click, field, card } = setup({ raw: furniture([instance({ floor_id: 'deleted', future: 5 })]) });
    expect(field('floor_id').disabled).toBe(true); click('repair-instance'); change('floor_id', 'upper', 'change'); click('save');
    expect(card._layout.furniture.instances[0]).toEqual(instance({ floor_id: 'upper', future: 5 }));
  });
  it.each([{ status: 'loading' }, { status: 'error', message: 'The ZIP could not be read.' }, { status: 'unavailable' }])('shows actual %j catalogue state without fake choices', (library) => {
    const { host, button, field } = setup({ library }); expect(host.textContent).toContain(`Library: ${library.status}`);
    expect(field('new-pack').querySelectorAll('option')).toHaveLength(1); expect(button('add').disabled).toBe(true);
  });
  it('handles malformed catalogue members as unavailable, without throwing from its context key', () => {
    expect(() => setup({ library: { status: 'ready', catalogue: { version: 1, packs: [null, { pack_id: PACK, items: {} }] } } })).not.toThrow();
  });
  it('does not use promise-valued catalogue reads as an invented ready library', () => {
    const { host, button } = setup({ card: { furnitureCatalogue: vi.fn(() => Promise.resolve(catalogue())) } });
    expect(host.textContent).toContain('loading'); expect(button('add').disabled).toBe(true);
  });
  it('reports a missing getter or thrown library error and keeps the saved record', () => {
    const { card, host, editor, render } = setup({ raw: furniture(), card: { furnitureCatalogue: undefined } });
    expect(host.textContent).toContain('not connected yet'); expect(editor.draft).toEqual(furniture());
    card.furnitureCatalogue = () => { throw new Error('private detail'); }; render(); expect(host.textContent).toContain('could not be read');
    expect(host.textContent).not.toContain('private detail');
  });
});

describe('placement draft intent and lifecycle guards', () => {
  const changes = [
    ['source', (card) => { card._layout.model = { url: '/another.glb' }; }],
    ['falsey YAML source', (card) => { card._config.model = ''; card._layout.model = { url: '/replacement.glb' }; }],
    ['root', (card) => { card._view.model.root = { uuid: 'replacement' }; }],
    ['alignment', (card) => { card._modelAlign = () => ({ position: [1, 0, 0], rotation: 0, scale: 1 }); }],
    ['floor elevation', (card) => { card._floors[0].elevation = 1; }],
    ['floor missing', (card) => { card._floors.splice(0, 1); }],
    ['user', (card) => { card._hass.user = { ...card._hass.user, id: 'another' }; }],
    ['admin revocation', (card) => { card._hass.user.is_admin = false; }],
    ['inactive user', (card) => { card._hass.user.is_active = false; }],
    ['connection', (card) => { card._hass.connection.connected = false; }],
    ['new session', (card) => { card._hass.auth = {}; }],
    ['tab exit', (card) => { card._edit.tab = 'rooms'; }],
    ['card detached', (card) => { card.isConnected = false; }],
    ['saved history', (card) => { card._layout.furniture = furniture([instance({ x: 25 })]); }],
    ['catalogue membership', (card) => { const current = catalogue(); current.packs[0].items[0].sha256 = OTHER;
      card.furnitureCatalogue = () => ({ status: 'ready', catalogue: current }); }],
  ];
  it.each(changes)('latches a dirty %s change, clears preview and forbids old Save/drag', (name, changeContext) => {
    const { card, editor, change, host, button } = setup({ raw: furniture() }); change('x', '7'); const handle = editor.draftPlacementHandles()[0];
    changeContext(card); editor.updatePreviews(host); expect(editor.stale).toBe(true); expect(editor.draft.instances[0].x).toBe(7);
    expect(button('save').disabled).toBe(true); expect(card.furniturePreviewDraft).toHaveBeenLastCalledWith(null);
    expect(editor.moveDraftInstance(handle.id, { x: 8, y: 9 }, handle.token)).toBe(false);
    editor.onClick('furniture-save', button('save')); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each([['is_active', 'true'], ['is_active', 1], ['is_active', null], ['is_admin', 'true'], ['id', ''], ['id', '   ']])('rejects present invalid user %s=%j', (key, value) => {
    const { card, editor, host, button } = setup({ raw: furniture() }); card._hass.user[key] = value; editor.updatePreviews(host);
    expect(editor.canEdit).toBe(false); expect(button('copy').disabled).toBe(true);
  });
  it('keeps a revoked and recovered dirty draft poisoned until Cancel, then accepts a new deliberate edit', () => {
    const { card, editor, change, host, click } = setup({ raw: furniture() }); change('x', '5');
    card._hass.connection.connected = false; editor.updatePreviews(host); card._hass.connection.connected = true; editor.updatePreviews(host);
    expect(editor.stale).toBe(true); click('cancel'); change('x', '6'); click('save'); expect(card._layout.furniture.instances[0].x).toBe(6);
  });
  it('accepts missing is_active for older HA user data, without relaxing explicit invalid flags', () => {
    const { card, editor, host } = setup(); delete card._hass.user.is_active; editor.updatePreviews(host); expect(editor.canEdit).toBe(true);
  });
  it('accepts equivalent catalogue clones and friendly-name updates without invalidating exact membership', () => {
    const { card, editor, field, change, host, library } = setup({ raw: furniture() }); const input = field('x'); input.focus(); change('x', '5');
    library.catalogue = structuredClone(library.catalogue); library.catalogue.packs[0].manifest.name = 'Renamed display name';
    card._floors[0].name = 'Downstairs'; editor.updatePreviews(host);
    expect(editor.stale).toBe(false); expect(field('x')).toBe(input); expect(document.activeElement).toBe(input);
  });
  it('uses required opaque source handle tokens, permits continuous measured plan moves and never commits them', () => {
    const { card, editor } = setup({ raw: furniture() }); const handle = editor.draftPlacementHandles()[0];
    expect(editor.moveDraftInstance(handle.id, { x: 4, y: 5 })).toBe(false);
    expect(editor.moveDraftInstance(handle.id, { x: 4.125, y: 5.375, z: 0.75 }, handle.token)).toBe(true);
    expect(editor.moveDraftInstance(handle.id, { x: 4.5, y: 6 }, handle.token)).toBe(true);
    expect(editor.draftPlacementHandles()[0]).toMatchObject({ id: 'chair_1', floor_id: 'ground', x: 4.5, y: 6, z: 0.75, token: handle.token });
    expect(card._layout.furniture.instances[0].x).toBe(2.5); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each([{ x: '', y: 0 }, { x: 1001, y: 0 }, { x: NaN, y: 0 }, { x: 1, y: true }, { x: 0, y: 0, z: Infinity },
    { x: 0, y: 0, floor_id: 'missing' }, { y: 0 }])('rejects invalid native drag patch %j without guessing a coordinate/floor', (patch) => {
    const { editor } = setup({ raw: furniture() }); const handle = editor.draftPlacementHandles()[0];
    expect(editor.moveDraftInstance(handle.id, patch, handle.token)).toBe(false); expect(editor.draft).toEqual(furniture());
  });
  it('invalidates old handles after a deliberate floor change or instance relink', () => {
    const { editor, change } = setup({ raw: furniture() }); const first = editor.draftPlacementHandles()[0];
    expect(editor.moveDraftInstance(first.id, { x: 2, y: 3, floor_id: 'upper' }, first.token)).toBe(true);
    expect(editor.moveDraftInstance(first.id, { x: 8, y: 9 }, first.token)).toBe(false);
    const upper = editor.draftPlacementHandles()[0]; change('item_id', 'table', 'change');
    expect(editor.moveDraftInstance(upper.id, { x: 8, y: 9 }, upper.token)).toBe(false);
  });
  it('rejects detached old row controls after switching the selected instance', () => {
    const { editor, field, change } = setup({ raw: furniture([instance(), instance({ id: 'second', x: 10 })]) });
    const old = field('x'); change('selected', '1', 'change'); old.value = '99'; editor.onChange('furniture-x', old);
    expect(editor.draft.instances[0].x).toBe(2.5); expect(editor.draft.instances[1].x).toBe(10);
  });
  it.each(['pointer', 'Space', 'Enter'])('poisons a held %s Copy through observed clean permission loss/recovery, then permits a fresh press', (kind) => {
    const { card, editor, button, host } = setup({ raw: furniture() }); const old = button('copy');
    const press = (element) => element.dispatchEvent(kind === 'pointer' ? new MouseEvent('pointerdown', { bubbles: true, button: 0 })
      : new KeyboardEvent('keydown', { bubbles: true, key: kind === 'Space' ? ' ' : 'Enter' }));
    const release = (element) => element.dispatchEvent(kind === 'pointer' ? new MouseEvent('pointerup', { bubbles: true, button: 0 })
      : new KeyboardEvent('keyup', { bubbles: true, key: kind === 'Space' ? ' ' : 'Enter' }));
    press(old); card._hass.user.is_admin = false; editor.updatePreviews(host); card._hass.user.is_admin = true; editor.updatePreviews(host);
    release(old); editor.onClick('furniture-copy', old); expect(editor.draft.instances).toHaveLength(1);
    const current = button('copy'); press(current); release(current); current.click(); expect(editor.draft.instances).toHaveLength(2);
  });
  it('rejects a queued Copy click after pointercancel, then allows a new deliberate gesture', () => {
    const { editor, button } = setup({ raw: furniture() }); const control = button('copy');
    control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    control.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true })); control.click(); expect(editor.draft.instances).toHaveLength(1);
    control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); control.click(); expect(editor.draft.instances).toHaveLength(2);
  });
  it('allows an accessibility-only current button click but rejects detached buttons after replacement', () => {
    const { editor, button, render } = setup({ raw: furniture() }); const old = button('copy'); render();
    editor.onClick('furniture-copy', old); expect(editor.draft.instances).toHaveLength(1);
    button('copy').click(); expect(editor.draft.instances).toHaveLength(2);
  });
  it.each(['reset', 'cancel', 'dispose'])('%s clears owned preview and poisons old drag tokens with no saved change', (method) => {
    const { card, editor, change } = setup({ raw: furniture() }); change('x', '5'); const handle = editor.draftPlacementHandles()[0];
    editor[method](); expect(card.furniturePreviewDraft).toHaveBeenLastCalledWith(null);
    expect(editor.moveDraftInstance(handle.id, { x: 99, y: 99 }, handle.token)).toBe(false);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); if (method === 'dispose') expect(editor.render()).toBe('');
  });
  it('loads exact Undo/Redo restored layout only after explicit history reset', () => {
    const { card, editor, change, click, render, field } = setup({ raw: furniture() }); const before = structuredClone(card._layout.furniture);
    change('x', '7'); click('save'); const after = structuredClone(card._layout.furniture);
    card._layout.furniture = before; editor.reset(); render(); expect(field('x').value).toBe('2.5');
    card._layout.furniture = after; editor.reset(); render(); expect(field('x').value).toBe('7');
  });
});

describe('loaded layout is required for furniture edits and imports', () => {
  it.each([undefined, null, [], 'loading', false, 3, new Date(0)].map((value) => ({ value })))('blocks an absent or non-layout source $value despite an old model, floors and catalogue', ({ value: _layout }) => {
    const importPack = vi.fn(), { card, editor, host, field, button, chooseFile } = setup({ importPack, card: { _layout } });
    expect(editor.canEdit).toBe(false); expect(field('new-pack').disabled).toBe(true);
    expect(field('import-file').disabled).toBe(true); expect(host.textContent).toContain('Wait for the current layout to finish loading');
    // The handler must still reject an old queued action if its DOM is stale.
    editor.newPack = PACK; editor.newItem = 'chair'; editor.newFloor = 'ground'; chooseFile();
    editor.onClick('furniture-add'); editor.onClick('furniture-import');
    expect(editor.draft.instances).toEqual([]); expect(button('save').disabled).toBe(true);
    expect(importPack).not.toHaveBeenCalled(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card.furniturePreviewDraft).not.toHaveBeenCalled(); expect(card._layout).toBe(_layout);
  });
  it('blocks Add and ZIP import while the plain current layout is still loading', () => {
    const importPack = vi.fn(), { card, editor, field, button, chooseFile } = setup({ importPack, card: { _loading: true } });
    expect(editor.canEdit).toBe(false); expect(field('new-floor').disabled).toBe(true); expect(field('import-file').disabled).toBe(true);
    editor.newPack = PACK; editor.newItem = 'chair'; editor.newFloor = 'ground'; chooseFile();
    editor.onClick('furniture-add'); editor.onClick('furniture-import');
    expect(editor.draft.instances).toEqual([]); expect(button('save').disabled).toBe(true);
    expect(importPack).not.toHaveBeenCalled(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('rechecks loading synchronously before Save without requiring a prior UI refresh', () => {
    const saved = furniture(), { card, editor, change, button } = setup({ raw: saved }); change('x', '7');
    const save = button('save'); expect(save.disabled).toBe(false); card._loading = true;
    editor.onClick('furniture-save', save);
    expect(card._layout.furniture).toEqual(saved); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(editor.draft.instances[0].x).toBe(7); expect(card.furniturePreviewDraft).toHaveBeenLastCalledWith(null);
  });
  it('retains a dirty draft but latches an observed loading interval through recovery until Cancel', () => {
    const { card, editor, change, host, button, click } = setup({ raw: furniture() }); change('x', '7');
    const handle = editor.draftPlacementHandles()[0]; card._loading = true; editor.updatePreviews(host);
    expect(editor.canEdit).toBe(false); expect(editor.stale).toBe(true); expect(editor.draft.instances[0].x).toBe(7);
    expect(editor.draftPlacementHandles()).toEqual([]); expect(button('save').disabled).toBe(true);
    expect(card.furniturePreviewDraft).toHaveBeenLastCalledWith(null);
    card._loading = false; editor.updatePreviews(host); expect(editor.stale).toBe(true);
    expect(editor.moveDraftInstance(handle.id, { x: 9, y: 10 }, handle.token)).toBe(false);
    editor.onClick('furniture-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('cancel'); change('x', '8'); click('save'); expect(card._layout.furniture.instances[0].x).toBe(8);
  });
  it('never saves an old house draft into a new layout key while its layout is absent, then explicitly reloads the new source', () => {
    const { card, editor, change, host, button, click, field } = setup({ raw: furniture() }); change('x', '7');
    const oldSave = button('save'); card._config.layout_key = 'another-house'; card._loading = true; card._layout = null;
    editor.updatePreviews(host); expect(editor.canEdit).toBe(false); expect(editor.draft.instances[0].x).toBe(7);
    editor.onClick('furniture-save', oldSave); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._layout).toBeNull();
    card._layout = { furniture: furniture([instance({ x: 12 })]) }; card._loading = false; editor.updatePreviews(host);
    expect(button('save').disabled).toBe(true); click('cancel'); expect(field('x').value).toBe('12');
    change('x', '13'); click('save'); expect(card._layout.furniture.instances[0].x).toBe(13);
  });
  it.each(['pointer', 'Space', 'Enter'])('rejects a held %s Add after loading and recovery, then accepts a fresh explicit choice', (kind) => {
    const { card, editor, change, button, host, add } = setup();
    change('new-pack', PACK, 'change'); change('new-item', 'chair', 'change'); change('new-floor', 'ground', 'change');
    const old = button('add'), press = (element) => element.dispatchEvent(kind === 'pointer'
      ? new MouseEvent('pointerdown', { bubbles: true, button: 0 }) : new KeyboardEvent('keydown', { bubbles: true, key: kind === 'Space' ? ' ' : 'Enter' }));
    press(old); card._loading = true; editor.updatePreviews(host); card._loading = false; editor.updatePreviews(host);
    old.dispatchEvent(kind === 'pointer' ? new MouseEvent('pointerup', { bubbles: true, button: 0 })
      : new KeyboardEvent('keyup', { bubbles: true, key: kind === 'Space' ? ' ' : 'Enter' }));
    editor.onClick('furniture-add', old); expect(editor.draft.instances).toEqual([]);
    add(); expect(editor.draft.instances).toEqual([instance({ id: 'furniture_1', x: 0, y: 0, z: 0, rotation_degrees: 0 })]);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('rejects a held Import across loading recovery and requires selecting the file again', () => {
    const importPack = vi.fn().mockResolvedValue({ ok: true }), { card, editor, chooseFile, button, host } = setup({ importPack });
    chooseFile(); const old = button('import'); old.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    card._loading = true; editor.updatePreviews(host); card._loading = false; editor.updatePreviews(host);
    old.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); editor.onClick('furniture-import', old);
    expect(importPack).not.toHaveBeenCalled(); expect(editor.file).toBeNull();
    const currentFile = chooseFile(); button('import').click(); expect(importPack).toHaveBeenCalledExactlyOnceWith(currentFile);
  });
  it('discards a late import completion if the current layout entered loading and recovered', async () => {
    let finish; const importPack = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { card, editor, chooseFile, click, host } = setup({ importPack }); chooseFile(); click('import');
    card._loading = true; editor.updatePreviews(host); card._loading = false; editor.updatePreviews(host);
    finish({ ok: true }); await Promise.resolve(); await Promise.resolve();
    expect(String(editor.message)).not.toContain('accepted'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('allows a fully loaded plain layout without a GLB, and accepts the older undefined loading flag', () => {
    const { card, editor, add, click } = setup({ card: { _layout: Object.create(null), _view: null } });
    expect(card._loading).toBeUndefined(); expect(editor.canEdit).toBe(true); add(); click('save');
    expect(card._layout.furniture.instances).toHaveLength(1); expect(card.commitFeatureLayout).toHaveBeenCalledTimes(1);
  });
});

describe('explicit local ZIP request seam', () => {
  it('imports only the chosen File after a deliberate action and does not add furniture or save', async () => {
    const importPack = vi.fn().mockResolvedValue({ ok: true }), { card, chooseFile, click, host } = setup({ importPack });
    const file = chooseFile(); expect(importPack).not.toHaveBeenCalled(); click('import'); await vi.waitFor(() => expect(host.textContent).toContain('ZIP import accepted'));
    expect(importPack).toHaveBeenCalledExactlyOnceWith(file); expect(card._layout.furniture).toBeUndefined(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('accepts a newly cached published catalogue after an explicit successful import', async () => {
    let finish; const importPack = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const library = { status: 'ready', catalogue: { version: 1, packs: [] } }, { chooseFile, click, host, field } = setup({ importPack, library });
    chooseFile(); click('import'); library.catalogue = catalogue(); finish({ ok: true });
    await vi.waitFor(() => expect(host.textContent).toContain('ZIP import accepted')); expect(field('new-pack').querySelector(`option[value="${PACK}"]`)).not.toBeNull();
  });
  it('blocks import while a placement draft is dirty and never auto-imports when selecting a file', () => {
    const importPack = vi.fn(), { chooseFile, change, button, editor } = setup({ raw: furniture(), importPack }); chooseFile(); change('x', '7');
    expect(button('import').disabled).toBe(true); editor.onClick('furniture-import', button('import')); expect(importPack).not.toHaveBeenCalled();
  });
  it.each(['source', 'user', 'connection', 'tab', 'dispose'])('discards a late ZIP completion after %s changes', async (kind) => {
    let finish; const importPack = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { card, editor, chooseFile, click, host } = setup({ importPack }); chooseFile(); click('import');
    if (kind === 'source') card._layout.model = { url: '/new.glb' };
    if (kind === 'user') card._hass.user.id = 'another';
    if (kind === 'connection') card._hass.connection.connected = false;
    if (kind === 'tab') card._edit.tab = 'rooms';
    if (kind === 'dispose') editor.dispose(); else editor.updatePreviews(host);
    finish({ ok: true }); await Promise.resolve(); await Promise.resolve();
    expect(String(editor.message)).not.toContain('accepted'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each([{ ok: false, diagnostics: [{ message: 'Unsupported embedded GLB.' }] }, new Error('secret response')])('shows an import failure without making it a saved layout edit', async (result) => {
    const importPack = vi.fn(() => result instanceof Error ? Promise.reject(result) : Promise.resolve(result));
    const { card, chooseFile, click, host } = setup({ importPack }); chooseFile(); click('import');
    await vi.waitFor(() => expect(host.textContent).toContain(result instanceof Error ? 'ZIP import failed' : 'Unsupported embedded GLB'));
    expect(host.textContent).not.toContain('secret response'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
});
