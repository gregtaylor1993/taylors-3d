// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FurnitureEditor } from '../src/furniture-editor.js';

const PACK = 'a'.repeat(64), HASH = 'b'.repeat(64), MISSING_PACK = 'c'.repeat(64);
const editors = [];
const unavailable = {
  en: 'Saved choice unavailable: ',
  de: 'Gespeicherte Auswahl nicht verfügbar: ',
  fr: 'Choix enregistré indisponible : ',
  es: 'Elección guardada no disponible: ',
};
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const instance = (patch = {}) => ({ id: 'chair_1', pack_id: PACK, item_id: 'chair',
  asset_sha256: HASH, floor_id: 'ground', x: 2.5, y: -3.25, z: .5, rotation_degrees: 90,
  scale: 1, extension: { retained: [null, false, 'été'] }, ...patch });
const cases = [
  { label: 'floor', field: 'floor_id', missing: 'user_missing_floor', patch: { floor_id: 'user_missing_floor' } },
  { label: 'pack', field: 'pack_id', missing: MISSING_PACK, patch: { pack_id: MISSING_PACK } },
  { label: 'item', field: 'item_id', missing: 'user_missing_chair', patch: { item_id: 'user_missing_chair' } },
];

function setup(patch = {}) {
  const saved = freeze({ version: 1, instances: [instance(patch)], extension: { kept: true } });
  const card = {
    isConnected: true, _editing: true, _edit: { tab: 'furniture' },
    _config: { layout_key: 'furniture-missing-choice-regression' },
    _layout: { furniture: saved, model: { url: '/api/taylors3d/model/local-test.glb' } },
    _floors: [{ id: 'ground', name: 'User_Ground_été', elevation: 0 },
      { id: 'upper', name: 'User_Upper_été', elevation: 4 }],
    _view: { model: { root: { uuid: 'original-house-root', position: { x: 0, y: 0, z: 0 } } } },
    _modelAlign: () => ({ position: [0, 0, 0], rotation: 0, scale: 1 }),
    _hass: { user: { id: 'taylor', is_admin: true, is_active: true }, auth: {},
      connection: { connected: true }, states: {}, language: 'en', locale: { language: 'en' },
      callService: vi.fn(), callWS: vi.fn() },
    _store: { save: vi.fn() },
    furnitureCatalogue: vi.fn(() => ({ status: 'ready', catalogue: { version: 1, packs: [{
      pack_id: PACK, manifest: { name: 'User_<b>Pack_été', author: 'Author', license: { id: 'MIT', file: 'LICENSE.txt' } },
      items: [{ id: 'chair', name: 'User_<b>Chair_été', pack_id: PACK, sha256: HASH, unit: 'm', anchor: [0, .25, 0] }],
    }] } })),
    furniturePreviewDraft: vi.fn(),
    commitFeatureLayout: vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; }),
  };
  const host = document.createElement('div'); document.body.append(host);
  let editor;
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  editor = new FurnitureEditor(card, render); editors.push(editor);
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => {
    const node = event.target.closest('[data-act]'); editor.onClick(node?.dataset.act, node);
  });
  render();
  const field = (name) => host.querySelector('[data-field="furniture-' + name + '"]');
  const button = (name) => host.querySelector('[data-act="furniture-' + name + '"]');
  const change = (name, value, eventType = 'input') => {
    const node = field(name); node.value = value; node.dispatchEvent(new Event(eventType, { bubbles: true }));
  };
  const localize = (language) => {
    card._hass = { ...card._hass, language, locale: { ...card._hass.locale, language } };
    editor.updatePreviews(host);
  };
  return { card, saved, editor, host, render, field, button, change, localize };
}

function expectPlaceholder(select, rawId, language = 'en') {
  expect(select.value).toBe('');
  expect(select.selectedOptions).toHaveLength(1);
  expect(select.selectedIndex).toBe(0);
  expect(select.selectedOptions[0].disabled).toBe(true);
  expect(select.selectedOptions[0].textContent).toBe(unavailable[language] + rawId);
}

function expectNoWrites(env) {
  expect(env.card._layout.furniture).toBe(env.saved);
  expect(env.card.commitFeatureLayout).not.toHaveBeenCalled();
  expect(env.card._store.save).not.toHaveBeenCalled();
  expect(env.card._hass.callService).not.toHaveBeenCalled();
  expect(env.card._hass.callWS).not.toHaveBeenCalled();
  expect(env.card.furniturePreviewDraft.mock.calls.every(([value]) => value === null)).toBe(true);
}

afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); });

describe.each(cases)('actual FurnitureEditor visible missing $label choice', (scenario) => {
  it('keeps one selected disabled warning after render/update without rewriting the imported reference', () => {
    const env = setup(scenario.patch);
    expect(env.editor.draft).toEqual(env.saved);
    expect(env.button('save').disabled).toBe(true);
    expectNoWrites(env);
    expectPlaceholder(env.field(scenario.field), scenario.missing);
    const select = env.field(scenario.field), options = [...select.options];
    env.editor.updatePreviews(env.host);
    expect(env.field(scenario.field)).toBe(select);
    expect([...select.options].every((option, index) => option === options[index])).toBe(true);
    expectPlaceholder(select, scenario.missing);
    expect(env.editor.draft.instances[0][scenario.field]).toBe(scenario.missing);
    expectNoWrites(env);
  });

  it.each(['input', 'select'])('preserves the exact focused native %s, blank numeric draft and warning through all four locales', (focused) => {
    const env = setup(scenario.patch);
    env.button('repair-instance').click();
    const input = env.field('x'); input.focus(); env.change('x', '');
    const select = env.field(scenario.field), node = focused === 'input' ? input : select;
    expect(node.disabled).toBe(false); node.focus();
    const options = [...select.options], rawDraft = structuredClone(env.editor.draft), root = env.host.firstElementChild;
    const generation = env.editor._epoch;
    for (const language of ['de', 'fr', 'es', 'en']) {
      env.localize(language);
      expect(env.host.firstElementChild).toBe(root);
      expect(env.field('x')).toBe(input); expect(env.field(scenario.field)).toBe(select);
      expect(document.activeElement).toBe(node); expect(input.value).toBe('');
      expect(select.options).toHaveLength(options.length);
      expect([...select.options].every((option, index) => option === options[index])).toBe(true);
      expect(env.editor.draft).toEqual(rawDraft); expect(env.editor._epoch).toBe(generation);
      expect(env.editor.draft.instances[0][scenario.field]).toBe(scenario.missing);
      expect(env.editor.stale).toBe(false); expect(env.button('save').disabled).toBe(true);
      expectNoWrites(env);
      expectPlaceholder(select, scenario.missing, language);
    }
  });
});

it('keeps actual current pack/item/floor selections through locale updates with no automatic save', () => {
  const env = setup(), floor = env.field('floor_id'), options = [...floor.options];
  floor.focus();
  for (const language of ['de', 'fr', 'es', 'en']) {
    env.localize(language);
    expect(env.field('floor_id')).toBe(floor); expect(document.activeElement).toBe(floor);
    expect(floor.value).toBe('ground'); expect(floor.selectedOptions[0].textContent).toBe('User_Ground_été');
    expect(floor.selectedOptions[0].disabled).toBe(false);
    expect([...floor.options].every((option, index) => option === options[index])).toBe(true);
    expect(env.field('pack_id').value).toBe(PACK); expect(env.field('item_id').value).toBe('chair');
    expect(env.editor.draft).toEqual(env.saved); expectNoWrites(env);
  }
});

it('repairs the raw missing floor only after a deliberate native choice and explicit Save', () => {
  const env = setup({ floor_id: 'user_missing_floor' }), original = structuredClone(env.saved);
  env.button('repair-instance').click(); env.change('floor_id', 'upper', 'change');
  expect(env.card._layout.furniture).toBe(env.saved);
  expect(env.editor.draft.instances[0]).toEqual({ ...original.instances[0], floor_id: 'upper' });
  expect(env.card.commitFeatureLayout).not.toHaveBeenCalled();
  expect(env.button('save').disabled).toBe(false); env.button('save').click();
  expect(env.card.commitFeatureLayout).toHaveBeenCalledExactlyOnceWith({
    furniture: { ...original, instances: [{ ...original.instances[0], floor_id: 'upper' }] },
  }, 'Furniture');
  expect(env.saved).toEqual(original);
  expect(env.card._hass.callService).not.toHaveBeenCalled();
  expect(env.card._hass.callWS).not.toHaveBeenCalled();
  expect(env.card._store.save).not.toHaveBeenCalled();
});
