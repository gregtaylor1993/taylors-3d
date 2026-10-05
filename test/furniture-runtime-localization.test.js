// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FurnitureCoordinator, FURNITURE_COORDINATOR_MESSAGES } from '../src/furniture-coordinator.js';
import { FurnitureLibraryClient, FURNITURE_LIBRARY_MESSAGES } from '../src/furniture-library.js';
import { FurnitureEditor } from '../src/furniture-editor.js';
import { cloneFurnitureCaptionValue, furnitureCaptionOf } from '../src/furniture-caption-source.js';
import { furnitureRuntimeMessage } from '../src/furniture-runtime-localization.js';
import messages from '../src/translations/furniture-runtime.js';

const owners = [], locales = ['en', 'de', 'fr', 'es'];
const expected = {
  refresh: ['Refresh the furniture library', 'Aktualisieren Sie die Möbelbibliothek', 'Actualisez la bibliothèque de mobilier', 'Actualice la biblioteca de muebles'],
  loading: ['Loading the current furniture catalogue…', 'Aktueller Möbelkatalog wird geladen…', 'Chargement du catalogue actuel de mobilier…', 'Cargando el catálogo actual de muebles…'],
  server: ['Furniture library storage is unavailable.', 'Der Speicher der Möbelbibliothek ist nicht verfügbar.', 'Le stockage de la bibliothèque de mobilier est indisponible.', 'El almacenamiento de la biblioteca de muebles no está disponible.'],
  file: ['Choose one nonempty ZIP file of at most 64 MiB.', 'Wählen Sie eine nicht leere ZIP-Datei mit höchstens 64 MiB.', 'Choisissez un seul fichier ZIP non vide de 64 Mio au maximum.', 'Elija un archivo ZIP no vacío de un máximo de 64 MiB.'],
};
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function setup(language = 'en', raw) {
  const connection = Object.assign(new EventTarget(), { connected: true });
  const card = { isConnected: true, _loading: false, _editing: true, _edit: { tab: 'furniture' },
    _config: { layout_key: 'User_layout_ID' }, _layout: { furniture: raw ?? { version: 1, instances: [], note: 'User_English_Refresh the furniture library' } },
    _floors: [{ id: 'user_floor_ID', name: 'User_<b>Floor', elevation: 0 }],
    _hass: { language, connection, auth: {}, user: { id: 'User_account', is_admin: true, is_active: true },
      fetchWithAuth: vi.fn(), callService: vi.fn(), callWS: vi.fn() },
    furnitureEditorAvailable: () => true, furnitureImportAvailable: () => true,
    furniturePreviewDraft: vi.fn(), commitFeatureLayout: vi.fn() };
  const coordinator = new FurnitureCoordinator(card);
  card.furnitureLibrary = coordinator; card.furnitureCatalogue = () => coordinator.catalogueSnapshot();
  const host = document.createElement('div'); document.body.append(host);
  const editor = new FurnitureEditor(card, () => render());
  function render() { host.innerHTML = editor.render(); editor.updatePreviews(host); }
  function locale(value) { card._hass.language = value; editor.updatePreviews(host); }
  render(); owners.push({ editor, coordinator, host });
  return { card, coordinator, host, editor, render, locale };
}
afterEach(() => { for (const { editor, coordinator, host } of owners.splice(0)) { editor.dispose(); coordinator.dispose(); host.remove(); } vi.restoreAllMocks(); });

describe('owned furniture runtime captions', () => {
  it('covers every exact client and coordinator message in four languages without changing transport text', () => {
    const keys = Object.keys(messages.en); expect(keys).toHaveLength(26);
    for (const language of locales) {
      expect(Object.keys(messages[language])).toEqual(keys);
      for (const value of Object.values(messages[language])) expect(value.trim()).not.toBe('');
    }
    for (const [scope, original] of [['coordinator', FURNITURE_COORDINATOR_MESSAGES], ['library', FURNITURE_LIBRARY_MESSAGES]]) {
      for (const [code, message] of Object.entries(original)) expect(messages.en[`furnitureRuntime.${scope}.${code}`]).toBe(message);
    }
  });
  it.each(locales)('displays actual %s unavailable/loading/server states while transport English stays unchanged', async (language) => {
    const index = locales.indexOf(language), ctx = setup(language), gate = deferred();
    const original = structuredClone(ctx.card._layout), generation = ctx.coordinator.generation;
    expect(ctx.host.textContent).toContain(expected.refresh[index]); expect(ctx.card._hass.fetchWithAuth).not.toHaveBeenCalled();
    ctx.card._hass.fetchWithAuth.mockImplementation(() => gate.promise);
    const pending = ctx.coordinator.refresh(); ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.textContent).toContain(expected.loading[index]);
    expect(ctx.coordinator.catalogueSnapshot().message).toBe(expected.loading[0]);
    await vi.waitFor(() => expect(ctx.card._hass.fetchWithAuth).toHaveBeenCalledTimes(1));
    gate.resolve(new Response('External_private_server_body', { status: 500 }));
    const result = await pending; ctx.editor.updatePreviews(ctx.host);
    expect(ctx.host.textContent).toContain(expected.server[index]);
    expect(result.diagnostics).toEqual([{ code: 'server', message: expected.server[0] }]);
    expect(ctx.coordinator.catalogueSnapshot().message).toBe(expected.server[0]);
    expect(ctx.host.textContent).not.toContain('External_private_server_body');
    expect(ctx.coordinator.generation).toBe(generation); expect(ctx.card._layout).toEqual(original);
    expect(ctx.card._hass.fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(ctx.card._hass.callService).not.toHaveBeenCalled(); expect(ctx.card._hass.callWS).not.toHaveBeenCalled();
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('keeps the native focused control, saved IDs/hashes and partial draft while an actual status re-translates', () => {
    const raw = { version: 1, instances: [{ id: 'user_instance', pack_id: 'a'.repeat(64), item_id: 'user_item',
      asset_sha256: 'b'.repeat(64), floor_id: 'user_floor_ID', x: 1, y: 2, note: 'Furniture library storage is unavailable.' }] };
    const ctx = setup('en', raw), saved = structuredClone(ctx.card._layout), generation = ctx.coordinator.generation;
    ctx.editor.repairIndex = ctx.editor.selectedIndex; ctx.render();
    const input = ctx.host.querySelector('[data-field="furniture-x"]'), floor = ctx.host.querySelector('[data-field="furniture-floor_id"]');
    const option = floor.selectedOptions[0], save = ctx.host.querySelector('[data-act="furniture-save"]');
    // Native number inputs sanitise a trailing decimal in jsdom. A cleared
    // coordinate is a real unfinished draft and must remain blank on refresh.
    input.focus(); input.value = ''; ctx.editor.onInput(input.dataset.field, input);
    const draft = structuredClone(ctx.editor.draft), epoch = ctx.editor._epoch;
    ctx.locale('fr');
    expect(ctx.host.textContent).toContain(expected.refresh[2]);
    expect(ctx.host.querySelector('[data-field="furniture-x"]')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('');
    expect(floor.selectedOptions[0]).toBe(option); expect(option.textContent).toBe('User_<b>Floor');
    expect(ctx.host.querySelector('[data-act="furniture-save"]')).toBe(save);
    expect(ctx.editor.draft).toEqual(draft); expect(ctx.editor._epoch).toBe(epoch); expect(ctx.coordinator.generation).toBe(generation);
    expect(ctx.card._layout).toEqual(saved); expect(ctx.editor.draft.instances[0].note).toBe(expected.server[0]);
    expect(ctx.card._hass.fetchWithAuth).not.toHaveBeenCalled(); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each(locales)('re-translates an actual %s empty-ZIP import failure after it settles without retrying or saving', async (language) => {
    const ctx = setup(language), saved = structuredClone(ctx.card._layout);
    ctx.card._hass.fetchWithAuth.mockResolvedValue(new Response('External_private_failure', { status: 500 }));
    ctx.editor.file = new File([], 'User_English_filename.zip', { type: 'application/zip' });
    await ctx.editor._import(); ctx.render();
    expect(ctx.editor.message).toBe(expected.file[locales.indexOf(language)]);
    ctx.locale('es'); expect(ctx.editor.message).toBe(expected.file[3]); expect(ctx.host.textContent).toContain(expected.file[3]);
    expect(ctx.card._hass.fetchWithAuth).not.toHaveBeenCalled(); expect(ctx.card._layout).toEqual(saved);
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it('retains private provenance through defensive result clones but never marks unrelated identical external text', async () => {
    const hass = { user: { id: 'user', is_active: true, is_admin: true },
      connection: { connected: true }, fetchWithAuth: vi.fn() };
    const client = new FurnitureLibraryClient({ getHass: () => hass });
    try {
      const result = await client.importPack(new File([], 'User_English_filename.zip'));
      const clone = cloneFurnitureCaptionValue(result), diagnostic = clone.diagnostics[0];
      expect(furnitureRuntimeMessage({ language: 'de' }, diagnostic)).toBe(expected.file[1]);
      expect(JSON.stringify(clone)).toBe(JSON.stringify(result)); expect(Object.keys(diagnostic)).toEqual(['code', 'message']);
      const external = { code: 'file', message: expected.file[0] };
      expect(furnitureCaptionOf(external)).toBeNull(); expect(furnitureRuntimeMessage({ language: 'de' }, external)).toBe(expected.file[0]);
      diagnostic.message = 'External_<b>failure_été'; expect(furnitureRuntimeMessage({ language: 'fr' }, diagnostic)).toBe('External_<b>failure_été');
      const getter = vi.fn(() => 'private');
      expect(furnitureRuntimeMessage({ language: 'de' }, Object.defineProperty({}, 'message', { get: getter }))).toBe('');
      expect(getter).not.toHaveBeenCalled();
    } finally { client.dispose(); }
  });
  it('keeps unknown external catalogue and import error text escaped and literal in the actual editor', async () => {
    const ctx = setup('es'), literal = 'External_<b>failure_été';
    ctx.card.furnitureCatalogue = () => ({ status: 'error', message: literal }); ctx.render();
    expect(ctx.host.textContent).toContain(literal); expect(ctx.host.querySelector('b')).toBeNull();
    ctx.card.furnitureLibrary = { importPack: vi.fn(async () => ({ ok: false, diagnostics: [{ code: 'server', message: literal }] })) };
    ctx.editor.file = new File(['x'], 'User_English_filename.zip'); await ctx.editor._import(); ctx.render();
    ctx.locale('de'); expect(ctx.editor.message).toBe(literal); expect(ctx.host.textContent).toContain(literal); expect(ctx.host.querySelector('b')).toBeNull();
    expect(ctx.card.furnitureLibrary.importPack).toHaveBeenCalledTimes(1); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
});
