import { describe, expect, it, vi } from 'vitest';
import { availableLocales, localize, localeInfo, localeKey } from '../src/localization.js';
import en from '../src/translations/en.js';
import de from '../src/translations/de.js';
import fr from '../src/translations/fr.js';
import es from '../src/translations/es.js';

const catalogues = { en, de, fr, es };
const placeholders = (text) => [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();

describe('bundled card locale selection', () => {
  it('advertises the four actual bundled packs and keeps that inventory immutable', () => {
    expect(availableLocales).toEqual(['en', 'de', 'fr', 'es']); expect(Object.isFrozen(availableLocales)).toBe(true);
    expect(() => availableLocales.push('it')).toThrow();
    expect(Object.isFrozen(en)).toBe(true);
  });

  it('uses canonical HA locale first, then HA language, with exact/base/English resolution', () => {
    expect(localeInfo({ locale: { language: 'eN-gB' }, language: 'fr' })).toEqual({ requested: 'en-GB', resolved: 'en', key: 'en-GB|en' });
    expect(localeInfo({ locale: { language: 'zh-Hant-TW' }, language: 'en' })).toEqual({ requested: 'zh-Hant-TW', resolved: 'en', key: 'zh-Hant-TW|en' });
    expect(localeInfo({ language: 'FR-ca' })).toEqual({ requested: 'fr-CA', resolved: 'fr', key: 'fr-CA|fr' });
    expect(localize({ language: 'fr-CA' }, 'common.save')).toBe('Enregistrer');
    expect(localeInfo({ language: 'IT-it' })).toEqual({ requested: 'it-IT', resolved: 'en', key: 'it-IT|en' });
    expect(localize({ language: 'it-IT' }, 'common.save')).toBe('Save');
    expect(localeKey({ language: 'eN-us' })).toBe(localeKey({ language: 'en-US' }));
    expect(localeInfo({ language: 'en-US-u-nu-latn' })).toMatchObject({ requested: 'en-US-u-nu-latn', resolved: 'en' });
  });

  it.each([undefined, null, false, 1, [], {}, '', ' ', ' en ', 'en_US', 'not_a_locale', 'en--GB', 'x'.repeat(129)])(
    'rejects malformed locale tags without preventing a valid HA language fallback (%j)', (language) => {
      expect(localeInfo({ locale: { language }, language: 'de-DE' })).toMatchObject({ requested: 'de-DE', resolved: 'de' });
      expect(localeInfo({ language })).toEqual({ requested: 'en', resolved: 'en', key: 'en|en' });
    });

  it('keeps English defaults for missing/malformed HA objects and does not invoke locale accessors', () => {
    for (const hass of [undefined, null, false, [], 'en', 42]) expect(localeInfo(hass).resolved).toBe('en');
    const getter = vi.fn(() => 'de');
    const hass = { language: 'en-GB' }; Object.defineProperty(hass, 'locale', { get: getter });
    expect(localeInfo(hass).requested).toBe('en-GB'); expect(getter).not.toHaveBeenCalled();
    expect(localeInfo(Object.create({ language: 'de' })).requested).toBe('en');
  });

  it('observes an in-place HA language change without mutating readings/configuration or invoking HA', () => {
    const hass = { locale: { language: 'en-US' }, language: 'en', states: { 'light.hall': { state: 'on' } },
      callService: vi.fn(), callWS: vi.fn(), localize: vi.fn() };
    const originalStates = hass.states, originalLocale = hass.locale, first = localeKey(hass);
    hass.locale.language = 'fr-CA'; const second = localeKey(hass);
    expect(second).not.toBe(first); expect(localize(hass, 'toolbar.reset')).toBe('Réinitialiser la vue');
    expect(hass.states).toBe(originalStates); expect(hass.locale).toBe(originalLocale);
    expect(hass.states['light.hall'].state).toBe('on');
    expect(hass.callService).not.toHaveBeenCalled(); expect(hass.callWS).not.toHaveBeenCalled(); expect(hass.localize).not.toHaveBeenCalled();
  });
});

describe('English messages and plain-text interpolation', () => {
  it('retains actual toolbar, House/editor/history and card-picker wording', () => {
    expect(localize({}, 'toolbar.aria')).toBe('House views and controls');
    expect(localize({}, 'toolbar.mode.top')).toBe('Top'); expect(localize({}, 'toolbar.reset')).toBe('Reset view');
    expect(localize({}, 'house.nav.house')).toBe('House / 3D'); expect(localize({}, 'house.nav.settings')).toBe('Settings');
    expect(localize({}, 'edit.tabs.environment')).toBe('Environment'); expect(localize({}, 'edit.saved')).toBe('Saved');
    expect(localize({}, 'history.undoNamed', { label: 'Bedroom layout' })).toBe('Undo: Bedroom layout');
    expect(localize({}, 'cardPicker.description')).toBe('3D floorplan with automatically placed devices');
  });

  it('preserves original proper names/user labels as supplied and never recursively evaluates inserted text', () => {
    expect(localize({}, 'house.header.aria', { name: "Taylor's 3D" })).toBe("Taylor's 3D house summary");
    expect(localize({}, 'history.undoNamed', { label: '{count} $& ${window.alert(1)}' })).toBe('Undo: {count} $& ${window.alert(1)}');
    expect(localize({}, 'house.header.itemAria', { label: 'Selected people', value: 'Taylor: Garden' })).toBe('Selected people: Taylor: Garden');
  });

  it('returns plain text including HTML-looking content, leaving DOM escaping to the caller', () => {
    const value = '<img src=x onerror=alert(1)> & "garden"';
    expect(localize({}, 'history.undoNamed', { label: value })).toBe(`Undo: ${value}`);
    expect(localize({}, 'missing', {}, value)).toBe(value);
  });

  it('reads only own data parameters, including explicit zero/false, without object conversion/getter calls', () => {
    expect(localize({}, 'missing', { count: 0, enabled: false }, '{count}/{enabled}')).toBe('0/false');
    expect(localize({}, 'history.undoNamed', Object.create({ label: 'Inherited' }), 'Undo')).toBe('Undo');
    const getter = vi.fn(() => 'Getter'), params = {}; Object.defineProperty(params, 'label', { get: getter });
    expect(localize({}, 'history.undoNamed', params, 'Undo')).toBe('Undo'); expect(getter).not.toHaveBeenCalled();
    const toString = vi.fn(() => 'Converted');
    expect(localize({}, 'history.undoNamed', { label: { toString } }, 'Undo')).toBe('Undo'); expect(toString).not.toHaveBeenCalled();
    const nullProto = Object.create(null); nullProto.label = 'Exact label';
    expect(localize({}, 'history.undoNamed', nullProto)).toBe('Undo: Exact label');
  });

  it.each([undefined, null, false, [], 'name', { label: null }, { label: undefined }, { label: Infinity }, { label: NaN }])(
    'uses a readable fallback for missing/invalid required data without leaking placeholders (%j)', (params) => {
      expect(localize({}, 'history.undoNamed', params, 'Undo')).toBe('Undo');
      expect(localize({}, 'history.undoNamed', params)).toBe('');
    });

  it('does not expose missing/internal/prototype keys or coerce an invalid fallback', () => {
    for (const key of ['untranslated.key', '__proto__', 'constructor', 'toString', '', null, 42]) {
      expect(localize({}, key)).toBe(''); expect(localize({}, key, {}, 'Readable fallback')).toBe('Readable fallback');
    }
    const toString = vi.fn(() => 'unsafe'); expect(localize({}, 'missing', {}, { toString })).toBe(''); expect(toString).not.toHaveBeenCalled();
    expect(localize({}, 'missing', {}, 'Missing {name}')).toBe('');
  });

  it('handles throwing parameter proxy descriptors without surfacing a runtime error', () => {
    const params = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('blocked'); } });
    expect(localize({}, 'history.undoNamed', params, 'Undo')).toBe('Undo');
  });
});

describe('count plurals follow the language of the returned catalogue', () => {
  it.each([0, 1, 2, 1.5])('uses English grammar even if the requested locale has different plural rules (%s)', (count) => {
    const expected = `${count} ${count === 1 ? 'light' : 'lights'} on`;
    for (const language of ['en', 'it', 'ar', 'ru', 'pt-PT']) expect(localize({ language }, 'house.summary.lightsOn', { count })).toBe(expected);
  });

  it('keeps explicit room entity/media/unknown counts honest with singular and zero/plural wording', () => {
    expect(localize({}, 'room.lightsOn', { count: 1 })).toBe('1 light entity on');
    expect(localize({}, 'room.lightsOn', { count: 2 })).toBe('2 light entities on');
    expect(localize({}, 'room.mediaPlaying', { count: 0 })).toBe('0 media players playing');
    expect(localize({}, 'room.mediaPlaying', { count: 1 })).toBe('1 media player playing');
    expect(localize({}, 'room.lightsUnknown', { count: 1 })).toBe('1 light reading unknown');
    expect(localize({}, 'room.mediaUnknown', { count: 2 })).toBe('2 media readings unknown');
    expect(localize({}, 'house.summary.peopleHome', { count: 1, home: 0 })).toBe('0 of 1 selected person home');
    expect(localize({}, 'house.summary.peopleHome', { count: 3, home: 2 })).toBe('2 of 3 selected people home');
    expect(localize({}, 'house.summary.peopleHome', { count: 3 }, 'People status unavailable')).toBe('People status unavailable');
  });

  it.each([undefined, null, '1', false, -1, NaN, Infinity, {}, []])('does not invent a count for malformed readings (%j)', (count) => {
    expect(localize({}, 'room.lightsOn', { count }, 'Light count unavailable')).toBe('Light count unavailable');
    expect(localize({}, 'room.lightsOn', { count })).toBe('');
  });

  it('does not coerce an inherited or accessor count into a displayed observation', () => {
    expect(localize({}, 'room.mediaPlaying', Object.create({ count: 1 }))).toBe('');
    const getter = vi.fn(() => 1), params = {}; Object.defineProperty(params, 'count', { get: getter });
    expect(localize({}, 'room.mediaPlaying', params)).toBe(''); expect(getter).not.toHaveBeenCalled();
  });

  it('keeps plural variants immutable and complete, without hiding a supported message behind a missing other form', () => {
    const plurals = Object.values(en).filter((value) => typeof value !== 'string');
    expect(plurals.length).toBeGreaterThan(0);
    for (const variants of plurals) {
      expect(Object.isFrozen(variants)).toBe(true); expect(typeof variants.one).toBe('string'); expect(typeof variants.other).toBe('string');
      expect(variants.one).toContain('{count}'); expect(variants.other).toContain('{count}');
    }
  });
});

describe('complete German, French and Spanish catalogues', () => {
  it.each(Object.entries(catalogues))('%s keeps all 167 English semantic keys and exactly the required placeholders', (_language, catalogue) => {
    expect(Object.keys(en)).toHaveLength(167);
    expect(Object.keys(catalogue)).toEqual(Object.keys(en));
    for (const [key, reference] of Object.entries(en)) {
      const translated = catalogue[key];
      expect(typeof translated, key).toBe(typeof reference);
      if (typeof reference === 'string') {
        expect(translated.trim().length, key).toBeGreaterThan(0);
        expect(placeholders(translated), key).toEqual(placeholders(reference));
        expect(translated, key).not.toMatch(/<[^>]*>/);
      } else {
        expect(Object.keys(translated), key).toEqual(['one', 'other']);
        for (const category of ['one', 'other']) {
          expect(typeof translated[category], `${key}.${category}`).toBe('string');
          expect(placeholders(translated[category]), `${key}.${category}`).toEqual(placeholders(reference[category]));
          expect(translated[category], `${key}.${category}`).not.toMatch(/<[^>]*>/);
        }
      }
    }
  });

  it.each(Object.entries(catalogues))('%s freezes both the catalogue and all plural records', (_language, catalogue) => {
    expect(Object.isFrozen(catalogue)).toBe(true);
    expect(() => { catalogue['common.save'] = 'Changed'; }).toThrow();
    for (const message of Object.values(catalogue).filter((value) => typeof value !== 'string')) {
      expect(Object.isFrozen(message)).toBe(true);
      expect(() => { message.other = 'Changed'; }).toThrow();
    }
  });

  it.each([
    ['de', 'de-AT', 'Speichern', 'Räume'],
    ['fr', 'fr-CA', 'Enregistrer', 'Pièces'],
    ['es', 'es-MX', 'Guardar', 'Habitaciones'],
  ])('uses actual %s text for exact and regional HA locales, including Unicode plain text', (language, regional, save, rooms) => {
    for (const requested of [language, regional]) {
      expect(localeInfo({ language: requested }).resolved).toBe(language);
      expect(localize({ language: requested }, 'common.save')).toBe(save);
      expect(localize({ language: requested }, 'edit.tabs.rooms')).toBe(rooms);
      expect(localize({ language: requested }, 'house.header.waiting')).toContain('Home Assistant');
    }
    const text = Object.values(catalogues[language]).filter((value) => typeof value === 'string').join(' ');
    expect([...text].some((character) => character.codePointAt(0) > 127)).toBe(true);
  });

  it.each(['de', 'fr', 'es'])('%s preserves exact brand, user labels, HA IDs and inert HTML-looking text', (language) => {
    const hass = { language }, label = '<img src=x onerror=alert(1)> light.Taylor_ID {count}';
    expect(localize(hass, 'house.header.aria', { name: "Taylor's 3D" })).toContain("Taylor's 3D");
    expect(localize(hass, 'history.undoNamed', { label })).toBe(catalogues[language]['history.undoNamed'].replace('{label}', label));
    expect(localize(hass, 'house.header.itemAria', { label: 'Taylor_ID', value: 'person.Taylor: Garden' })).toContain('person.Taylor: Garden');
  });

  it.each(['de', 'fr', 'es'])('%s never evaluates accessor parameters, locale getters or object conversions', (language) => {
    const getter = vi.fn(() => 'Used'), convert = vi.fn(() => 'Converted');
    const params = {}; Object.defineProperty(params, 'label', { get: getter });
    expect(localize({ language }, 'history.undoNamed', params, 'Fallback')).toBe('Fallback');
    expect(localize({ language }, 'history.undoNamed', { label: { toString: convert } }, 'Fallback')).toBe('Fallback');
    const hass = { language }; Object.defineProperty(hass, 'locale', { get: getter });
    expect(localize(hass, 'common.save')).toBe(catalogues[language]['common.save']);
    expect(getter).not.toHaveBeenCalled(); expect(convert).not.toHaveBeenCalled();
  });

  it.each(['de', 'fr', 'es'])('%s does not guess absent interpolation fields or malformed counts', (language) => {
    for (const count of [undefined, null, '0', false, -1, NaN, Infinity, {}, []]) {
      expect(localize({ language }, 'house.summary.lightsOn', { count }, 'Unknown count')).toBe('Unknown count');
      expect(localize({ language }, 'house.summary.lightsOn', { count })).toBe('');
    }
    expect(localize({ language }, 'house.summary.peopleHome', { count: 2 }, 'Unknown people')).toBe('Unknown people');
    expect(localize({ language }, 'house.summary.lightsOn', Object.create({ count: 1 }))).toBe('');
    const getter = vi.fn(() => 1), params = {}; Object.defineProperty(params, 'count', { get: getter });
    expect(localize({ language }, 'house.summary.lightsOn', params)).toBe(''); expect(getter).not.toHaveBeenCalled();
  });

  it.each([0, 1, 1.5, 2, 1000000])('uses French plural categories for the actual French message at count %s', (count) => {
    const category = new Intl.PluralRules('fr').select(count) === 'one' ? 'one' : 'other';
    for (const language of ['fr', 'fr-CA']) {
      expect(localize({ language }, 'house.summary.lightsOn', { count })).toBe(fr['house.summary.lightsOn'][category].replace('{count}', String(count)));
    }
    if (count === 0) expect(localize({ language: 'fr' }, 'house.summary.lightsOn', { count })).toBe('0 lumière allumée');
  });

  it.each(['de', 'es'])('%s applies singular only for one, with correct zero, decimal and multiple counts', (language) => {
    for (const count of [0, 1, 1.5, 2]) {
      const expected = catalogues[language]['room.lightsOn'][count === 1 ? 'one' : 'other'].replace('{count}', String(count));
      expect(localize({ language }, 'room.lightsOn', { count })).toBe(expected);
    }
  });

  it('uses the English message language for per-key fallback even when French would use singular zero', async () => {
    vi.resetModules();
    vi.doMock('../src/translations/fr.js', () => ({ default: Object.freeze({ 'common.save': 'Enregistrer' }) }));
    try {
      const partial = await import('../src/localization.js');
      expect(partial.localeInfo({ language: 'fr-CA' }).resolved).toBe('fr');
      expect(partial.localize({ language: 'fr-CA' }, 'common.save')).toBe('Enregistrer');
      expect(partial.localize({ language: 'fr-CA' }, 'house.summary.lightsOn', { count: 0 })).toBe('0 lights on');
      expect(partial.localize({ language: 'fr-CA' }, 'house.summary.lightsOn', { count: 1.5 })).toBe('1.5 lights on');
      expect(partial.localize({ language: 'fr-CA' }, 'house.summary.lightsOn', { count: 1 })).toBe('1 light on');
    } finally {
      vi.doUnmock('../src/translations/fr.js'); vi.resetModules();
    }
  });
});
