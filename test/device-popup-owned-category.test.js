// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevicePopup } from '../src/device-popup.js';
import { buildHouseCategory, ownedHouseCategoryPresentation } from '../src/house-categories.js';
import '../src/taylors3d-card.js';

// Independent complete category examples. No expected caption is obtained
// from the app's translation dictionary or from the presentation adapter.
const expected = {
  en: { titles: ['Lights', 'Security', 'Media', 'Climate', 'Cars'], empty: [
    'No current visible lights are available.', 'No current visible security entities are available.',
    'No current visible media players are available.', 'No current visible climate, weather, temperature or humidity entities are available.',
    'No current vehicle sources are selected. Choose your sources in Edit → Tracking.'],
  unreadable: 'Current Home Assistant entities could not be read. Refresh the connection and try again.',
  limit: 'More than 512 current lights entities are selected. Reduce the list to open this category.',
  vehicles: 'Vehicle settings need review in Edit → Tracking.', connect: 'Connect to Home Assistant to read this category.' },
  de: { titles: ['Lichter', 'Sicherheit', 'Medien', 'Klima', 'Autos'], empty: [
    'Derzeit sind keine sichtbaren Lichter verfügbar.', 'Derzeit sind keine sichtbaren Sicherheitsentitäten verfügbar.',
    'Derzeit sind keine sichtbaren Medienplayer verfügbar.', 'Derzeit sind keine sichtbaren Klima-, Wetter-, Temperatur- oder Luftfeuchtigkeitsentitäten verfügbar.',
    'Derzeit sind keine Fahrzeugquellen ausgewählt. Wähle deine Quellen unter Bearbeiten → Ortung.'],
  unreadable: 'Aktuelle Home Assistant-Entitäten konnten nicht gelesen werden. Aktualisiere die Verbindung und versuche es erneut.',
  limit: 'Mehr als 512 aktuelle Lichtentitäten sind ausgewählt. Verkleinere die Liste, um diese Kategorie zu öffnen.',
  vehicles: 'Prüfe die Fahrzeugeinstellungen unter Bearbeiten → Ortung.', connect: 'Verbinde dich mit Home Assistant, um diese Kategorie zu lesen.' },
  fr: { titles: ['Lumières', 'Sécurité', 'Médias', 'Climat', 'Voitures'], empty: [
    'Aucune lumière visible n’est actuellement disponible.', 'Aucune entité de sécurité visible n’est actuellement disponible.',
    'Aucun lecteur multimédia visible n’est actuellement disponible.', 'Aucune entité visible de climat, de météo, de température ou d’humidité n’est actuellement disponible.',
    'Aucune source de véhicule n’est actuellement sélectionnée. Choisissez vos sources dans Modifier → Suivi.'],
  unreadable: 'Les entités Home Assistant actuelles n’ont pas pu être lues. Actualisez la connexion et réessayez.',
  limit: 'Plus de 512 entités de lumière actuelles sont sélectionnées. Réduisez la liste pour ouvrir cette catégorie.',
  vehicles: 'Vérifiez les paramètres des véhicules dans Modifier → Suivi.', connect: 'Connectez-vous à Home Assistant pour lire cette catégorie.' },
  es: { titles: ['Luces', 'Seguridad', 'Multimedia', 'Clima', 'Coches'], empty: [
    'No hay luces visibles disponibles actualmente.', 'No hay entidades de seguridad visibles disponibles actualmente.',
    'No hay reproductores multimedia visibles disponibles actualmente.', 'No hay entidades visibles de clima, tiempo, temperatura o humedad disponibles actualmente.',
    'No hay fuentes de vehículos seleccionadas actualmente. Elige tus fuentes en Editar → Seguimiento.'],
  unreadable: 'No se pudieron leer las entidades actuales de Home Assistant. Actualiza la conexión y vuelve a intentarlo.',
  limit: 'Se han seleccionado más de 512 entidades de luz actuales. Reduce la lista para abrir esta categoría.',
  vehicles: 'Revisa los ajustes de los vehículos en Editar → Seguimiento.', connect: 'Conéctate a Home Assistant para leer esta categoría.' },
};
const ids = ['lights', 'security', 'media', 'climate', 'cars'], cleanup = [];
function fixture(language = 'en') {
  const card = document.createElement('taylors3d-card'); document.body.append(card);
  const stage = document.createElement('div'); card.shadowRoot.append(stage);
  const h = { language, locale: { language }, connection: { connected: true }, auth: {},
    user: { id: 'current-user', is_active: true, is_admin: false }, states: {}, entities: {}, devices: {}, callService: vi.fn() };
  const onAction = vi.fn(), popup = new DevicePopup(stage, { onAction }); popup.update(h);
  card._config = { layout_style: 'house' }; card._hass = h; card._layout = {}; card._loading = false;
  card._devicePopup = popup; card._popup = { close: vi.fn() };
  vi.spyOn(card, '_stopScenePreview').mockImplementation(() => {}); vi.spyOn(card, '_syncHouseShell').mockImplementation(() => {});
  cleanup.push(() => { card._devicePopup = null; popup.dispose(); stage.remove(); card.remove(); card._ambientController.dispose(); card._scenePreviewController.dispose(); });
  return { card, h, popup, onAction, select: (id) => card._selectHouseNavigation({ type: 'category', id }) };
}
afterEach(() => { for (const finish of cleanup.splice(0)) finish(); vi.restoreAllMocks(); });

describe('explicit ownership of actual Root category captions', () => {
  it.each(Object.keys(expected).flatMap((language) => ids.map((id, index) => [language, id, index])))(
    'translates actual Root %s %s title and empty guidance without changing its English data API', (language, id, index) => {
    const f = fixture(language), raw = buildHouseCategory({ hass: f.h, layout: f.card._layout, id });
    expect(Object.keys(raw)).toEqual(['id', 'title', 'entityIds', 'emptyText']);
    expect(raw.title).toBe(expected.en.titles[index]); expect(raw.emptyText).toBe(expected.en.empty[index]);
    f.select(id); expect(f.popup.el.querySelector('h3').textContent).toBe(expected[language].titles[index]);
    expect(f.popup.el.getAttribute('aria-label')).toBe(expected[language].titles[index]);
    expect(f.popup._empty.textContent).toBe(expected[language].empty[index]);
    expect(f.popup._selection.id).toBe(id); expect(f.onAction).not.toHaveBeenCalled(); expect(f.h.callService).not.toHaveBeenCalled();
  });
  it.each(ids)('retains actual %s category nodes/focus and literal HA rows through all four languages', (id) => {
    const f = fixture(); f.h.states['light.user'] = { entity_id: 'light.user', state: 'on', attributes: { friendly_name: 'User_Lamp_été', supported_color_modes: ['onoff'] } };
    f.select(id); const title = f.popup.el.querySelector('h3'), close = f.popup.el.querySelector('[data-action="close"]'); close.focus();
    for (const language of Object.keys(expected)) {
      f.h.language = language; f.h.locale.language = language; f.popup.update(f.h);
      expect(f.popup.el.querySelector('h3')).toBe(title); expect(f.popup.el.querySelector('[data-action="close"]')).toBe(close);
      expect(f.card.shadowRoot.activeElement).toBe(close); expect(title.textContent).toBe(expected[language].titles[ids.indexOf(id)]);
      if (id === 'lights') expect(f.popup.el.querySelector('.t3d-entity-name').textContent).toBe('User_Lamp_été');
      expect(f.h.states['light.user'].attributes.friendly_name).toBe('User_Lamp_été'); expect(f.onAction).not.toHaveBeenCalled();
    }
  });
  it.each(Object.keys(expected))('translates current %s diagnostics from the actual resolver rather than a stale empty caption', (language) => {
    const f = fixture(language); f.select('lights'); const title = f.popup.el.querySelector('h3');
    f.h.states = null; f.popup.update(f.h); expect(f.popup._empty.textContent).toBe(expected[language].unreadable);
    f.h.states = Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`light.current_${index}`, { state: 'off', attributes: {} }]));
    f.popup.update(f.h); expect(f.popup._empty.textContent).toBe(expected[language].limit); expect(f.popup.el.querySelector('h3')).toBe(title);
    f.h.connection.connected = false; f.popup.update(f.h); expect(f.popup._empty.textContent).toBe(expected[language].connect);
    f.h.connection.connected = true; f.h.states = {}; f.card._layout = { vehicle_bindings: 'literal_invalid_data' }; f.select('cars');
    expect(f.popup._empty.textContent).toBe(expected[language].vehicles); expect(f.card._layout.vehicle_bindings).toBe('literal_invalid_data');
    expect(f.onAction).not.toHaveBeenCalled();
  });
  it.each(Object.keys(expected))('keeps externally supplied English category captions literal in %s', (language) => {
    const f = fixture(language); f.popup.showCategory({ id: 'lights', title: 'Lights', entityIds: [], emptyText: expected.en.empty[0] });
    expect(f.popup.el.querySelector('h3').textContent).toBe('Lights'); expect(f.popup._empty.textContent).toBe(expected.en.empty[0]);
    f.popup.update({ ...f.h, language: 'fr', locale: { language: 'fr' } });
    expect(f.popup.el.querySelector('h3').textContent).toBe('Lights'); expect(f.popup._empty.textContent).toBe(expected.en.empty[0]);
    expect(f.onAction).not.toHaveBeenCalled();
  });
  it('does not confer own provenance on a copied public category object', () => {
    const f = fixture(), raw = buildHouseCategory({ hass: f.h, id: 'lights' });
    expect(ownedHouseCategoryPresentation(raw)).toMatchObject({ titleKey: 'house.nav.lights', emptyTextKey: 'house.categories.lightsEmpty' });
    expect(ownedHouseCategoryPresentation({ ...raw })).toBeUndefined(); expect(ownedHouseCategoryPresentation(null)).toBeUndefined();
    expect(JSON.parse(JSON.stringify(raw))).toEqual(raw);
  });
  it('returns to literal resolver text when the current resolver supplies no ownership key', () => {
    const f = fixture('de'); let owned = true;
    f.popup.showCategory({ id: 'lights', title: 'Lights', titleKey: 'house.nav.lights', entityIds: [], emptyText: expected.en.empty[0],
      emptyTextKey: 'house.categories.lightsEmpty', resolve: () => owned
        ? { entityIds: [], emptyText: expected.en.empty[0], emptyTextKey: 'house.categories.lightsEmpty' }
        : { entityIds: [], emptyText: 'User_Literal_Lights_été' } });
    expect(f.popup._empty.textContent).toBe(expected.de.empty[0]); owned = false; f.popup.update(f.h);
    expect(f.popup._empty.textContent).toBe('User_Literal_Lights_été');
  });
});
