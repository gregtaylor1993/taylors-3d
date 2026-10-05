// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { entityChoices, formatEntityValue } from '../src/entity-metadata.js';
import captions from '../src/translations/entity-choice-captions.js';
import { localize } from '../src/localization.js';
import '../src/taylors3d-card.js';

const examples = {
  en: ['Missing entity', 'Hidden', 'Outside current filter', 'Unknown', 'Unavailable'],
  de: ['Entität fehlt', 'Ausgeblendet', 'Außerhalb des aktuellen Filters', 'Unbekannt', 'Nicht verfügbar'],
  fr: ['Entité manquante', 'Masquée', 'Hors du filtre actuel', 'Inconnu', 'Indisponible'],
  es: ['Falta la entidad', 'Oculta', 'Fuera del filtro actual', 'Desconocido', 'No disponible'],
};
function fixture(language) {
  return { locale: { language }, entities: { 'light.user_hidden': { hidden: true } },
    states: { 'light.user_hidden': { state: 'off', attributes: { friendly_name: 'Hidden_User_été' } },
      'sensor.user_exact': { state: '7', attributes: { friendly_name: 'User_sensor_été', unit_of_measurement: 'W' } },
      'sensor.user_unknown': { state: 'unknown', attributes: {} } } };
}
describe('entity choice display captions', () => {
  it.each(Object.keys(examples))('translates owned warnings in %s while preserving exact names, IDs, values and eligibility', (language) => {
    const hass = fixture(language), original = structuredClone(hass), calls = vi.fn(); hass.callService = calls;
    const choices = entityChoices(hass, { domains: ['light'], selected: ['light.user_missing', 'light.user_hidden', 'sensor.user_exact'] });
    expect(choices.find((choice) => choice.value === 'light.user_missing')).toMatchObject({
      label: `light.user_missing (${examples[language][0]})`, missing: true, selected: true, selectable: false,
    });
    expect(choices.find((choice) => choice.value === 'light.user_hidden')).toMatchObject({
      label: `Hidden_User_été (${examples[language][1]})`, hidden: true, selected: true, selectable: false,
    });
    expect(choices.find((choice) => choice.value === 'sensor.user_exact')).toMatchObject({
      label: `User_sensor_été (${examples[language][2]})`, selected: true, selectable: false,
    });
    expect(formatEntityValue(hass, 'sensor.user_unknown')).toBe(examples[language][3]);
    expect(formatEntityValue(hass, 'sensor.user_missing')).toBe(examples[language][4]);
    expect(hass.states).toEqual(original.states); expect(hass.entities).toEqual(original.entities); expect(calls).not.toHaveBeenCalled();
  });

  it('keeps unknown external categories literal instead of translating arbitrary source text', () => {
    const hass = fixture('de'); hass.entities['sensor.user_exact'] = { entity_category: 'User_Category_été' };
    expect(entityChoices(hass, { selected: ['sensor.user_exact'] }).find((choice) => choice.value === 'sensor.user_exact').label)
      .toBe('User_sensor_été (User_Category_été)');
  });

  it('keeps the HA formatter authoritative over the app fallback', () => {
    const hass = fixture('de'); hass.localize = vi.fn(() => 'User_HA_text_été');
    expect(formatEntityValue(hass, 'sensor.user_unknown')).toBe('User_HA_text_été');
    expect(hass.localize).toHaveBeenCalledWith('state.default.unknown');
  });

  it('refreshes the same empty-plan node on an in-place language update', () => {
    const card = document.createElement('taylors3d-card'), empty = document.createElement('p');
    card._empty = empty; card._hass = fixture('en'); card._syncToolbarLabels();
    expect(empty.textContent).toBe('No rooms drawn yet. Open edit mode to draw rooms for your areas.');
    card._hass.locale.language = 'fr'; card._syncToolbarLabels();
    expect(card._empty).toBe(empty); expect(empty.textContent).toBe('Aucune pièce dessinée. Ouvrez le mode édition pour dessiner les pièces de vos zones.');
    expect(card._layout).toBeFalsy(); card._scenePreviewController.dispose(); card._presetEvents.disconnect();
  });

  it('registers the same ten keys for all four languages and retains English fallback', () => {
    for (const language of Object.keys(captions)) {
      expect(Object.keys(captions[language]).sort()).toEqual(Object.keys(captions.en).sort());
      for (const key of Object.keys(captions.en)) expect(localize({ language }, key)).toBe(captions[language][key]);
    }
    expect(localize({ language: 'ja' }, 'entityChoice.missing')).toBe('Missing entity');
  });
});
