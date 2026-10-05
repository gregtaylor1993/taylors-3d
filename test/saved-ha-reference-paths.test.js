import { describe, expect, it, vi } from 'vitest';
import { enumerateSavedHaReferences, SAVED_HA_REFERENCE_LIMITS } from '../src/saved-ha-reference-paths.js';
describe('shared exact saved-reference paths', () => {
  it('uses actual shared nullish precedence while own room-actions remains authoritative', () => {
    const config = { weather: { entity: 'weather.card' }, house_summary: { alarm_entity: 'alarm_control_panel.card' },
      scene_previews: { items: [{ scene_entity: 'scene.card', lights: [{ entity: 'light.card' }] }] },
      security_bindings: [{ entity: 'binary_sensor.card', target: { type: 'plan', roomId: 'room', position_key: 'object:exact', floorId: 'floor', position: { floorId: 'floor2' } } }],
      room_actions: { version: 1, rooms: [{ room_id: 'r', actions: [{ entity: 'scene.card_action' }] }] } };
    const result = enumerateSavedHaReferences({ layout: { weather: null, house_summary: undefined, room_actions: null }, config });
    expect(result.references.map((r) => r.id)).toEqual(expect.arrayContaining(['weather.card', 'alarm_control_panel.card', 'scene.card', 'light.card', 'binary_sensor.card', 'room', 'object:exact', 'floor', 'floor2']));
    expect(result.references.some((r) => r.id === 'scene.card_action')).toBe(false); expect(result.complete).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'reference_shape', path: 'layout.room_actions' }));
    expect(result.references.find((r) => r.id === 'light.card').segments).toEqual(['config', 'scene_previews', 'items', 0, 'lights', 0, 'entity']);
    expect(enumerateSavedHaReferences({ layout: { room_actions: undefined }, config }).references.some((r) => r.id === 'scene.card_action')).toBe(false);
    expect(enumerateSavedHaReferences({ layout: { room_actions: undefined } }).complete).toBe(true);
  });
  it('does not fall through malformed/unsafe shared values or call getters, hooks, or infer labels as entity IDs', () => {
    const getter = vi.fn(() => null), layout = { weather: false, room_actions: { version: 2, rooms: [{ room_id: 'future-room', actions: [{ entity: 'scene.future' }] }] } };
    Object.defineProperty(layout, 'house_summary', { enumerable: true, get: getter });
    const result = enumerateSavedHaReferences({ layout, config: { weather: { entity: 'weather.not_effective' }, house_summary: { weather_entity: 'weather.not_effective' } } });
    expect(getter).not.toHaveBeenCalled(); expect(result.references).toEqual([]); expect(result.complete).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['reference_shape', 'reference_accessor', 'reference_version']));
    const source = { room_actions: { version: 1, rooms: [{ room_id: 'r', actions: [{ id: 'sensor.label', label: 'scene.label', entity: 'scene.actual' }] }] } };
    const before = structuredClone(source), graph = enumerateSavedHaReferences({ layout: source });
    expect(graph.references.map((r) => r.id)).toEqual(['r', 'scene.actual']); expect(source).toEqual(before); expect(graph.complete).toBe(true);
  });
  it('caps traversal, references and diagnostics and explicitly discloses the remaining scope', () => {
    const layout = { room_actions: { version: 1, rooms: [{ room_id: 'r', actions: Array.from({ length: 10000 }, (_, i) => ({ entity: 'scene.exact_' + i, future: i })) }] } };
    const result = enumerateSavedHaReferences({ layout }); expect(result.references.length).toBeLessThanOrEqual(SAVED_HA_REFERENCE_LIMITS.references);
    expect(result.diagnostics.length).toBeLessThanOrEqual(SAVED_HA_REFERENCE_LIMITS.diagnostics); expect(result.complete).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'reference_limit' && d.path === 'saved')).toBe(true);
    expect(enumerateSavedHaReferences({ layout: false }).complete).toBe(false);
  });
});
