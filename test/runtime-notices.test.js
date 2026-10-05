// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedRuntimeError, ownedRuntimeDetails, runtimeNoticeText } from '../src/runtime-notices.js';
import { editorExtraNotice, readEditorExtraNotice } from '../src/editor-extra-localization.js';
import { resolvePreset } from '../src/preset-events.js';
import '../src/taylors3d-card.js';

const examples = {
  en: ['Could not load model', 'No visible preset', 'Panel name must', 'Open Edit → Model'],
  de: ['konnte nicht geladen werden', 'Keine sichtbare Ansicht', 'Der Panelname darf', 'Öffne Bearbeiten → Modell'],
  fr: ['Impossible de charger le modèle', 'Aucune vue visible', 'Le nom du panneau doit', 'Ouvrez Modifier → Modèle'],
  es: ['No se pudo cargar el modelo', 'Ninguna vista visible', 'El nombre del panel debe', 'Abre Editar → Modelo'],
};
const cards = [];
function cardFixture(language = 'en') {
  const card = document.createElement('taylors3d-card'); cards.push(card);
  card._hass = { language, callService: vi.fn(), callWS: vi.fn(async () => ({})) };
  card._notice = document.createElement('p'); return card;
}
afterEach(() => { for (const card of cards.splice(0)) { card._scenePreviewController.dispose(); card._presetEvents.disconnect(); } vi.restoreAllMocks(); });

describe('owned runtime notice translations', () => {
  it.each(Object.keys(examples))('uses current %s text for the actual model-load notice without changing the original loader result or filename', async (language) => {
    const card = cardFixture(language), name = '/local/User_Model_été_<name>.glb', result = `Could not load model ${name}`;
    card._config = { model: name }; card._view = { model: null, setModel: vi.fn(async () => result), setDaylight: vi.fn() };
    card._objects = { setModel: vi.fn() }; card._stage = document.createElement('div');
    for (const method of ['_syncModelRendering', '_suspendAmbient', '_stopScenePreview', '_updateObjects', '_refreshAttached', '_syncToolbar', '_schedule', '_syncWallPresentation']) card[method] = vi.fn();
    expect(await card._loadModel()).toBe(result); expect(card._modelError).toBe(result);
    expect(card._notice.textContent).toContain(examples[language][0]); expect(card._notice.textContent).toContain(name);
    expect(card._notice.querySelector('name')).toBeNull();
    const node = card._notice; card._hass.language = 'de'; card._syncToolbarLabels();
    expect(card._notice).toBe(node); expect(card._notice.textContent).toBe(`Modell ${name} konnte nicht geladen werden`);
    expect(card._view.setModel).toHaveBeenCalledTimes(1); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each(Object.keys(examples))('translates an owned preset error in %s while keeping exact request names and English websocket responses', async (language) => {
    const card = cardFixture(language), name = "User_Preset_été_'<name>";
    card._config = { layout_key: 'user-layout', automation_card_id: 'user-card' }; card._views = [];
    card._currentPresetCamera = vi.fn(() => null); card._presetEvents._hass = card._hass;
    await card._presetEvents._handle({ data: { layout_key: 'user-layout', card_id: 'user-card', request_id: 'test-request', target_id: 'test-target', preset: name } });
    expect(card._notice.textContent).toContain(examples[language][1]); expect(card._notice.textContent).toContain(name);
    expect(card._hass.callWS).toHaveBeenCalledWith(expect.objectContaining({ status: 'invalid_preset', message: resolvePreset([], name).message }));
    const node = card._notice; card._hass.language = 'fr'; card._syncToolbarLabels();
    expect(card._notice).toBe(node); expect(card._notice.textContent).toBe(`Aucune vue visible ne porte l’identifiant ou le nom '${name}'`);
    expect(card._hass.callWS).toHaveBeenCalledTimes(1); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each(Object.keys(examples))('keeps original panel/wall Error.message and translates owned failures in %s without saving or retrying', async (language) => {
    const card = cardFixture(language);
    let panelError; try { card.setPanelName('x'.repeat(129)); } catch (error) { panelError = error; }
    expect(panelError.message).toBe('Panel name must be at most 128 characters');
    expect(runtimeNoticeText(card._hass, panelError)).toContain(examples[language][2]);
    let wallError; try { await card.prepareWallSelection(); } catch (error) { wallError = error; }
    expect(wallError.message).toBe('Open Edit → Model as an administrator in 3D, then cancel unfinished changes before preparing exact wall meshes.');
    expect(runtimeNoticeText(card._hass, wallError)).toContain(examples[language][3]);
    const notice = editorExtraNotice('wall.prepareFailed', { error: wallError });
    expect(readEditorExtraNotice(card._hass, notice)).toContain(examples[language][3]);
    card._hass.language = 'es'; expect(readEditorExtraNotice(card._hass, notice)).toContain(examples.es[3]);
    expect(card._hass.callWS).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('keeps identical external English errors literal, including nested error bodies', () => {
    const hass = { language: 'de' }, english = 'The model could not provide separate original wall meshes.';
    const external = new Error(english), owned = ownedRuntimeError('wallUnavailable');
    expect(owned.message).toBe(external.message); expect(ownedRuntimeDetails(external)).toBeNull();
    expect(runtimeNoticeText(hass, external)).toBe(english); expect(runtimeNoticeText(hass, owned)).not.toBe(english);
    expect(readEditorExtraNotice(hass, editorExtraNotice('wall.prepareFailed', { error: external.message }))).toContain(english);
    const card = cardFixture('de'); card._presetEvents._onError(external);
    expect(card._notice.textContent).toBe(english); card._hass.language = 'fr'; card._syncToolbarLabels();
    expect(card._notice.textContent).toBe(english);
  });

  it('keeps unknown raw model errors literal instead of identifying them as our model-load failure', async () => {
    const card = cardFixture('es'), result = 'External loader response: User_Model_été';
    card._config = { model: '/local/user.glb' }; card._view = { model: null, setModel: vi.fn(async () => result), setDaylight: vi.fn() };
    card._objects = { setModel: vi.fn() }; card._stage = document.createElement('div');
    for (const method of ['_syncModelRendering', '_suspendAmbient', '_stopScenePreview', '_updateObjects', '_refreshAttached', '_syncToolbar', '_schedule', '_syncWallPresentation']) card[method] = vi.fn();
    expect(await card._loadModel()).toBe(result); expect(card._modelErrorNotice).toBeNull(); expect(card._notice.textContent).toBe(result);
  });
});
