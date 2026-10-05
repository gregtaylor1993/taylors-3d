// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chainState } from '../src/objects/logic.js';
import { ObjectPopup, popupRows } from '../src/objects/popup.js';
import dictionary from '../src/translations/object-popup.js';

const cleanup = [];
const settle = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
function fixture(type = 'light') {
  const entity = type === 'light' ? 'light.raw_source' : 'lawn_mower.raw_source';
  const obj = { id: 'Raw/model/<tag>', label: 'Brightness <b>Raw</b>', type: type === 'lawn_mower' ? 'mower' : type };
  const states = { [entity]: { entity_id: entity, state: 'on', attributes: {
    friendly_name: 'Sending command…', brightness: 128, supported_color_modes: ['rgb', 'color_temp'], color_mode: 'rgb',
    rgb_color: [255, 59, 48], min_color_temp_kelvin: 3200, max_color_temp_kelvin: 6500 } } };
  const hass = { states, entities: {}, devices: {}, language: 'en', locale: { language: 'en' }, connected: true,
    connection: { connected: true }, services: { light: { toggle: {}, turn_on: {} }, lawn_mower: { start_mowing: {}, dock: {} } } };
  const stage = document.createElement('div'); document.body.append(stage);
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 });
  const onAction = vi.fn(), resolve = () => ({ obj, chain: chainState(obj, { entity }, {}, states), states, groups: {}, hass });
  const popup = new ObjectPopup(stage, { onAction, project: () => [100, 100], resolve }); popup.open(obj, [0, 0, 0]);
  cleanup.push(() => { popup.close(); stage.remove(); });
  const locale = (value) => { hass.language = value; hass.locale.language = value; popup.update(); };
  return { popup, hass, obj, states, entity, onAction, locale, resolve };
}
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });

describe('current object popup captions', () => {
  it('provides complete four-language typed caption dictionaries with exact placeholder parity', () => {
    const keys = Object.keys(dictionary.en), params = (value) => [...value.matchAll(/\{([A-Za-z_]+)\}/g)].map((match) => match[1]).sort();
    expect(keys).toHaveLength(34);
    for (const language of ['en', 'de', 'fr', 'es']) {
      expect(Object.isFrozen(dictionary[language])).toBe(true); expect(Object.keys(dictionary[language])).toEqual(keys);
      for (const key of keys) { expect(dictionary[language][key].trim()).not.toBe(''); expect(params(dictionary[language][key])).toEqual(params(dictionary.en[key])); }
    }
  });
  it.each([['de', 'Helligkeit', 'Blau einstellen', 'Objektsteuerung schließen'], ['fr', 'Luminosité', 'Choisir le bleu', 'Fermer les commandes de l’objet'],
    ['es', 'Brillo', 'Elegir azul', 'Cerrar controles del objeto']])('updates %s controls in place while retaining a native unfinished brightness gesture', async (language, brightness, blueText, closeAria) => {
    const { popup, locale, onAction, states, entity } = fixture(), slider = popup.el.querySelector('input'), blue = popup.el.querySelector('[data-rgb="10,132,255"]');
    const rows = [...popup.el.querySelectorAll('.fp-pop-row')], buttons = [...popup.el.querySelectorAll('button')], key = popup._key, before = JSON.stringify(states);
    slider.focus(); slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true })); locale(language);
    expect(popup.el.querySelector('input')).toBe(slider); expect(document.activeElement).toBe(slider); expect(slider.value).toBe('200');
    expect([...popup.el.querySelectorAll('.fp-pop-row')]).toEqual(rows); expect([...popup.el.querySelectorAll('button')]).toEqual(buttons); expect(popup._key).toBe(key);
    expect(popup.el.querySelector('.brightness .fp-pop-label').textContent).toBe(brightness); expect(blue.title).toBe(blueText); expect(blue.getAttribute('aria-label')).toBe(blueText);
    expect(popup.el.querySelector('.fp-pop-x').getAttribute('aria-label')).toBe(closeAria); expect(slider.getAttribute('aria-label')).toContain(entity);
    expect(popup.el.querySelector('.fp-pop-title').textContent).toBe('Brightness <b>Raw</b>'); expect(popup.el.querySelector('b')).toBeNull(); expect(JSON.stringify(states)).toBe(before);
    expect(onAction).not.toHaveBeenCalled(); slider.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: entity, brightness: 200 }); expect(states[entity].attributes.brightness).toBe(128);
  });
  it.each(['de', 'fr', 'es'])('translates current pending and failure wrappers in %s while preserving raw server error data', async (language) => {
    const { popup, locale, onAction } = fixture(); let reject;
    onAction.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const blue = popup.el.querySelector('[data-rgb="10,132,255"]'); blue.click(); locale(language);
    expect(popup.el.textContent).toContain(dictionary[language]['objectPopup.sending']); expect(onAction).toHaveBeenCalledTimes(1);
    reject(new Error('Raw server <img>error_été: 403')); await settle();
    const alert = popup.el.querySelector('[role="alert"]'); expect(alert.textContent).toContain('Raw server <img>error_été: 403');
    expect(alert.textContent).toContain(dictionary[language]['objectPopup.commandFailed'].split('{error}')[0]); expect(popup.el.querySelector('img')).toBeNull();
    locale('en'); expect(alert.textContent).toBe('Command failed: Raw server <img>error_été: 403'); expect(onAction).toHaveBeenCalledTimes(1);
  });
  it('translates a missing error detail fallback without auto-retrying or replacing its live status node', async () => {
    const { popup, locale, onAction } = fixture(); onAction.mockRejectedValueOnce({});
    popup.el.querySelector('[data-rgb="10,132,255"]').click(); await settle();
    const status = popup.el.querySelector('.color [role="alert"]'); expect(status.textContent).toBe('Command failed: Please try again.');
    locale('fr'); expect(popup.el.querySelector('.color [role="alert"]')).toBe(status);
    expect(status.textContent).toBe('Échec de la commande : Veuillez réessayer.'); expect(onAction).toHaveBeenCalledTimes(1);
  });
  it('updates absent reading and white-swatch captions while retaining actual bounds and RGB selection', () => {
    const { popup, states, entity, locale, onAction } = fixture();
    delete states[entity].attributes.brightness; delete states[entity].attributes.rgb_color; popup.update();
    const reading = popup.el.querySelector('.brightness .fp-pop-reading'), color = popup.el.querySelector('.color .fp-pop-reading'), white = popup.el.querySelector('[data-act="white"]');
    locale('de'); expect(popup.el.querySelector('.brightness .fp-pop-reading')).toBe(reading); expect(reading.textContent).toBe('Helligkeit: nicht gemeldet');
    expect(popup.el.querySelector('.color .fp-pop-reading')).toBe(color); expect(color.textContent).toBe('Aktuelle Farbe: nicht gemeldet');
    expect(white.title).toBe('Wärmstes unterstütztes Weiß'); expect(white.dataset.kelvin).toBe('3200'); expect(onAction).not.toHaveBeenCalled();
    white.click(); expect(onAction).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: entity, color_temp_kelvin: 3200 });
  });
  it('translates relay reason suffixes without translating their current HA name or unknown chain reasons', () => {
    const { obj, hass, states, entity } = fixture(); obj.group = 'relay'; states['switch.raw_relay'] = { state: 'off', attributes: { friendly_name: 'State <b>Relay</b>' } };
    const groups = { relay: { entity: 'switch.raw_relay' } }, chain = chainState(obj, { entity }, groups, states);
    hass.language = 'es'; hass.locale.language = 'es';
    const rows = popupRows(obj, chain, states, groups, hass);
    expect(rows.find((row) => row.kind === 'chain').label).toBe('State <b>Relay</b>'); expect(rows.find((row) => row.kind === 'reason').label).toBe('State <b>Relay</b> está apagado');
    states['switch.raw_relay'].state = 'on';
    const unknown = { ...chainState(obj, { entity }, groups, states), lit: false, reason: 'Raw external chain reason <b>off</b>' };
    expect(popupRows(obj, unknown, states, groups, hass).find((row) => row.kind === 'reason').label).toBe(unknown.reason);
  });
  it.each([['de', 'Starten', 'Zur Station'], ['fr', 'Démarrer', 'Retour à la station'], ['es', 'Iniciar', 'Volver a la base']])('updates %s mower controls without changing action names or sending a passive command', (language, startLabel, dockLabel) => {
    const { popup, locale, onAction, entity } = fixture('lawn_mower'), start = popup.el.querySelector('[data-act="start"]'), dock = popup.el.querySelector('[data-act="dock"]');
    start.focus(); locale(language); expect(popup.el.querySelector('[data-act="start"]')).toBe(start); expect(document.activeElement).toBe(start);
    expect(start.textContent).toBe(startLabel); expect(dock.textContent).toBe(dockLabel); expect(onAction).not.toHaveBeenCalled(); dock.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('lawn_mower', 'dock', { entity_id: entity });
  });
  it('localizes an unavailable full-HA row while retaining the exact state-only output', () => {
    const { obj, hass, states, entity } = fixture(); states[entity].state = 'unavailable'; const chain = chainState(obj, { entity }, {}, states);
    hass.language = 'de'; hass.locale.language = 'de';
    expect(popupRows(obj, chain, states, {}, hass)).toEqual([{ kind: 'state', label: 'Zustand', value: 'nicht verfügbar' }]);
    expect(popupRows(obj, chain, states)).toEqual([{ kind: 'state', label: 'State', value: 'unavailable' }]);
  });
  it('keeps HA-formatted readings authoritative and uses English for unsupported locales', () => {
    const { obj, hass, states, entity } = fixture(); obj.ui = { popup: ['state'] }; hass.formatEntityState = vi.fn(() => 'Raw HA display <b>on</b>');
    hass.language = 'fr'; hass.locale.language = 'fr';
    expect(popupRows(obj, chainState(obj, { entity }, {}, states), states, {}, hass)).toEqual([{ kind: 'state', entity, label: 'État', value: 'Raw HA display <b>on</b>' }]);
    hass.language = 'ja'; hass.locale.language = 'ja'; expect(popupRows(obj, chainState(obj, { entity }, {}, states), states, {}, hass)[0].label).toBe('State');
  });
});
