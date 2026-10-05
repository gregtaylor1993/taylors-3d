import { describe, expect, it, vi } from 'vitest';
import { registryIssues } from '../src/entity-metadata.js';
import messages from '../src/translations/saved-ha-references.js';
import { localize } from '../src/localization.js';

const examples = {
  en: ['area', 'floor', 'device', 'room', 'anchor', 'has no current state.'],
  de: ['Bereich', 'Stockwerk', 'Gerät', 'Raum', 'Anker', 'hat keinen aktuellen Zustand.'],
  fr: ['zone', 'étage', 'appareil', 'pièce', 'point d’ancrage', 'n’a aucun état actuel.'],
  es: ['área', 'planta', 'dispositivo', 'habitación', 'punto de anclaje', 'no tiene un estado actual.'],
};
const layout = () => ({ rooms: [{ id: 'user_room_été', area_id: 'user_area', floor_id: 'user_floor' }],
  pins: { 'device:user_device': {}, 'entity:sensor.user_missing': {} },
  objects: { user_object: { entity: 'sensor.user_registered', note: 'Saved floor user_floor is missing.' } },
  presence_bindings: [{ roomId: 'user_room', position_key: 'user_anchor' }] });
const hass = (language) => ({ language, states: {}, entities: { 'sensor.user_registered': {} },
  areas: {}, floors: { ground: {} }, devices: {}, callWS: vi.fn(), callService: vi.fn() });
const resolved = { ready: true, rooms: [], anchors: [], floors: [] };

describe('legacy saved reference display captions', () => {
  it.each(Object.keys(examples))('translates %s diagnostics while preserving exact IDs, paths, order and saved data', (language) => {
    const saved = layout(), before = structuredClone(saved), ha = hass(language);
    const english = registryIssues(hass('en'), saved, {}, resolved);
    const issues = registryIssues(ha, saved, {}, resolved);
    expect(issues).toHaveLength(7);
    expect(issues.map(({ message: _message, ...issue }) => issue))
      .toEqual(english.map(({ message: _message, ...issue }) => issue));
    for (const [kind, caption] of ['area', 'floor', 'device', 'room', 'anchor'].map((kind, index) => [kind, examples[language][index]])) {
      const issue = issues.find((item) => item.kind === kind);
      expect(issue.message).toContain(`${caption} ${issue.id}`);
      expect(issue.message).not.toContain('undefined');
    }
    expect(issues.find((issue) => issue.code === 'entity_no_state').message)
      .toBe(`sensor.user_registered ${examples[language][5]}`);
    if (language !== 'en') expect(issues.every((issue) => !issue.message.includes('is missing. Relink'))).toBe(true);
    expect(saved).toEqual(before); expect(ha.callWS).not.toHaveBeenCalled(); expect(ha.callService).not.toHaveBeenCalled();
  });

  it('keeps the established English message and fallback for unsupported languages', () => {
    const issues = registryIssues(hass('it'), layout(), {}, resolved);
    expect(issues[0].message).toBe('Saved area user_area is missing. Relink or clear this choice; its saved layout is preserved.');
    expect(issues.find((issue) => issue.code === 'entity_no_state').message).toBe('sensor.user_registered has no current state.');
  });

  it('registers all added captions in each bundled catalogue with matching placeholders', () => {
    for (const language of Object.keys(examples)) for (const word of ['device', 'legacyMissing', 'legacyNoState']) {
      const key = `savedHaReferences.${word}`, params = { kind: 'Raw_kind_été', id: '<literal_user_id>' };
      expect(localize({ language }, key, params)).toBe(messages[language][key].replace('{kind}', params.kind).replace('{id}', params.id));
      expect([...messages[language][key].matchAll(/\{([A-Za-z_]+)\}/g)].map((match) => match[1]).sort())
        .toEqual([...messages.en[key].matchAll(/\{([A-Za-z_]+)\}/g)].map((match) => match[1]).sort());
    }
  });
});
