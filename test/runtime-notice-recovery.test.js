// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WallPresentationEditor } from '../src/wall-presentation-editor.js';
import { ownedRuntimeError } from '../src/runtime-notices.js';
import '../src/taylors3d-card.js';

const cards = [], settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const fallback = {
  en: 'Separate wall meshes could not be prepared. The saved settings were kept.',
  de: 'Getrennte Wandflächen konnten nicht vorbereitet werden. Gespeicherte Einstellungen wurden behalten.',
  fr: 'Impossible de préparer les maillages distincts. Les paramètres enregistrés ont été conservés.',
  es: 'No se pudieron preparar las mallas separadas. Los ajustes guardados se conservaron.',
};
function wallFixture(error) {
  const card = { _hass: { language: 'fr', user: { id: 'current-admin', is_admin: true }, callService: vi.fn(), callWS: vi.fn() },
    _layout: { floors: [], wall_presentation: { enabled: false, walls: [] } }, _config: {}, _floors: [], _view: { model: { root: {} } },
    prepareWallSelection: vi.fn(async () => { throw error; }), commitFeatureLayout: vi.fn() };
  const editor = new WallPresentationEditor(card); return { card, editor };
}
function rootFixture(error) {
  const card = document.createElement('taylors3d-card'); cards.push(card);
  Object.defineProperty(card, 'isConnected', { configurable: true, value: true });
  card._config = { layout_key: 'notice-recovery', model: '/local/notice-proof.glb', merge: true };
  card._layout = { version: 1, floors: [{ id: 'ground', elevation: 0 }] };
  card._hass = { language: 'fr', user: { id: 'current-admin', is_admin: true, is_active: true }, connection: { connected: true },
    states: {}, callService: vi.fn(), callWS: vi.fn() };
  card._view = { model: { root: {} }, camera: { position: { toArray: () => [1, 2, 3] } }, controls: { target: { toArray: () => [0, 0, 0] } }, setCamera: vi.fn() };
  card._viewId = 'all'; card._mode = '3d'; card._notice = document.createElement('p');
  card._store = { save: vi.fn() }; card._loadModel = vi.fn(async () => { throw error; });
  card._wallPreparation = { view: card._view, source: card._wallSourceKey(), generation: card._wallLifecycleGeneration,
    connection: card._hass.connection, userId: card._hass.user.id };
  return card;
}
afterEach(() => {
  for (const card of cards.splice(0)) { card._ambientController.dispose(); card._scenePreviewController.dispose(); card._presetEvents.disconnect(); }
  vi.restoreAllMocks();
});

describe('retained wall and model error ownership', () => {
  it.each(Object.keys(fallback))('keeps an empty actual wall-preparation error wholly current when switching from French to %s', async (language) => {
    const { card, editor } = wallFixture({}), saved = card._layout, raw = JSON.stringify(saved);
    await editor._prepare(); expect(editor.message).toBe(fallback.fr);
    card._hass.language = language; expect(editor.message).toBe(fallback[language]);
    expect(card.prepareWallSelection).toHaveBeenCalledTimes(1); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
    expect(card._layout).toBe(saved); expect(JSON.stringify(saved)).toBe(raw); expect(editor.preparing).toBe(false);
  });
  it.each([null, new Error(''), { message: '' }])('preserves the exact English fallback for a blank failure %j without retrying', async (error) => {
    const { card, editor } = wallFixture(error); card._hass.language = 'en'; await editor._prepare();
    expect(editor.message).toBe(fallback.en); expect(card.prepareWallSelection).toHaveBeenCalledTimes(1); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('keeps a nonempty external preparation error literal while translating only the owned wrapper', async () => {
    const external = 'Raw server <b>model_été</b>: Could not load model user.glb', { card, editor } = wallFixture(new Error(external));
    await editor._prepare(); expect(editor.message).toBe(`Impossible de préparer les maillages distincts. ${external}`);
    card._hass.language = 'es'; expect(editor.message).toBe(`No se pudieron preparar las mallas separadas. ${external}`);
    expect(card.prepareWallSelection).toHaveBeenCalledTimes(1); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('shows the actual restoration failure fallback for an unbranded empty Error and clears any previous branded model notice', async () => {
    const error = new Error(''), card = rootFixture(error);
    card._modelErrorNotice = ownedRuntimeError('modelLoad', { label: 'Old_Model.glb' });
    expect(card.finishWallSelectionPreparation()).toBe(true); await settle();
    expect(card._modelError).toBe('Error'); expect(card._modelErrorNotice).toBeNull();
    expect(card._notice.textContent).toBe('Error'); expect(card._notice.hidden).toBe(false);
    card._hass.language = 'de'; card._showNotice(); expect(card._notice.textContent).toBe('Error');
    expect(card._loadModel).toHaveBeenCalledTimes(1); expect(card._view.setCamera).not.toHaveBeenCalled();
    expect(card._store.save).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('retains privately branded restoration failures for translation and preserves their original English message', async () => {
    const label = 'Raw_<b>Model_été.glb', error = ownedRuntimeError('modelLoad', { label }), card = rootFixture(error);
    expect(card.finishWallSelectionPreparation()).toBe(true); await settle();
    expect(card._modelErrorNotice).toBe(error); expect(card._modelError).toBe(`Could not load model ${label}`);
    expect(card._notice.textContent).toBe(`Impossible de charger le modèle ${label}`); expect(card._notice.querySelector('b')).toBeNull();
    const notice = card._notice; card._hass.language = 'de'; card._showNotice();
    expect(card._notice).toBe(notice); expect(card._notice.textContent).toBe(`Modell ${label} konnte nicht geladen werden`);
    expect(error.message).toBe(`Could not load model ${label}`); expect(card._loadModel).toHaveBeenCalledTimes(1); expect(card._store.save).not.toHaveBeenCalled();
  });
  it.each(['model-frame', 'session'])('suppresses a late restoration error when the current %s guard changes', async (kind) => {
    const card = rootFixture(new Error('Old context error')); card._notice.textContent = 'Current independent notice';
    expect(card.finishWallSelectionPreparation()).toBe(true);
    if (kind === 'model-frame') card._wallLifecycleGeneration++; else card._hass.connection.connected = false;
    await settle(); expect(card._notice.textContent).toBe('Current independent notice'); expect(card._modelError).toBeUndefined();
    expect(card._loadModel).toHaveBeenCalledTimes(1); expect(card._store.save).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
