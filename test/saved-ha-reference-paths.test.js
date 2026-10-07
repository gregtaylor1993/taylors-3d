import { describe, expect, it, vi } from 'vitest';
import { enumerateSavedHaReferences, SAVED_HA_REFERENCE_LIMITS } from '../src/saved-ha-reference-paths.js';
describe('shared exact saved-reference paths', () => {
  it.each(['future-rule', undefined, 'State'])('leaves unsupported visibility type %s opaque and reports incomplete inspection', (type) => {
    const visibility = { type, entity: 'vacuum.future_literal', state: 'cleaning', opaque: { keep: true } };
    const controls = { version: 1, bars: [{ buttons: [{ action: { type: 'script', entity: 'script.actual' }, visibility }] }] };
    const before = structuredClone(controls), graph = enumerateSavedHaReferences({ layout: { custom_controls: controls } });
    expect(graph.references.map((row) => row.id)).toEqual(['script.actual']); expect(graph.complete).toBe(false);
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({ code: 'reference_shape', path: 'layout.custom_controls.bars.0.buttons.0.visibility.type' }));
    expect(controls).toEqual(before);
  });
  it('never invokes a visibility discriminator accessor or reads an opaque future entity accessor', () => {
    const typeGetter = vi.fn(() => 'state'), entityGetter = vi.fn(() => 'vacuum.future_literal'), visibility = {};
    Object.defineProperty(visibility, 'type', { enumerable: true, get: typeGetter });
    Object.defineProperty(visibility, 'entity', { enumerable: true, get: entityGetter });
    const controls = { version: 1, bars: [{ buttons: [{ visibility }] }] };
    const first = enumerateSavedHaReferences({ layout: { custom_controls: controls } });
    expect(first.references).toEqual([]); expect(first.diagnostics).toContainEqual(expect.objectContaining({ code: 'reference_accessor', path: 'layout.custom_controls.bars.0.buttons.0.visibility.type' }));
    expect(typeGetter).not.toHaveBeenCalled(); expect(entityGetter).not.toHaveBeenCalled();
    const future = { version: 1, bars: [{ buttons: [{ visibility: { type: 'future-rule' } }] }] };
    Object.defineProperty(future.bars[0].buttons[0].visibility, 'entity', { enumerable: true, get: entityGetter });
    expect(enumerateSavedHaReferences({ layout: { custom_controls: future } }).references).toEqual([]); expect(entityGetter).not.toHaveBeenCalled();
  });
  it('includes an exact visibility source while dock, pins, matching states and labels stay inert', () => {
    const controls = { version: 1, bars: [{ id: 'daily', label: 'scene.label', placement: 'bottom', style: 'pills', dock: { limit: 4 },
      buttons: [{ id: 'return', label: 'sensor.label', icon: 'mdi:robot-vacuum', color: 'teal', pinned: true,
        action: { type: 'script', entity: 'script.return_robot' }, visibility: { type: 'state', entity: 'vacuum.exact', state: 'scene.literal_state' } }] }] };
    const before = structuredClone(controls), graph = enumerateSavedHaReferences({ layout: { custom_controls: controls } });
    expect(graph.references.map((row) => [row.kind, row.id]).sort((a, b) => a[1].localeCompare(b[1]))).toEqual([['entity', 'script.return_robot'], ['entity', 'vacuum.exact']]);
    expect(graph.references.find((row) => row.id === 'vacuum.exact').segments).toEqual(['layout', 'custom_controls', 'bars', 0, 'buttons', 0, 'visibility', 'entity']);
    expect(graph.complete).toBe(true); expect(graph.diagnostics).toEqual([]); expect(controls).toEqual(before);
  });
  it('does not invoke visibility accessors or revive a shadowed fallback condition', () => {
    const getter = vi.fn(() => 'vacuum.gone'), visibility = { type: 'state', state: 'cleaning' };
    Object.defineProperty(visibility, 'entity', { enumerable: true, get: getter });
    const controls = { version: 1, bars: [{ buttons: [{ visibility, action: { type: 'script', entity: 'script.actual' } }] }] };
    const graph = enumerateSavedHaReferences({ layout: { custom_controls: controls } });
    expect(getter).not.toHaveBeenCalled(); expect(graph.references.map((row) => row.id)).toEqual(['script.actual']);
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({ code: 'reference_accessor', path: 'layout.custom_controls.bars.0.buttons.0.visibility.entity' }));
    const fallback = { custom_controls: { version: 1, bars: [{ buttons: [{ visibility: { entity: 'vacuum.inactive' } }] }] } };
    expect(enumerateSavedHaReferences({ layout: { custom_controls: null }, config: fallback }).references).toEqual([]);
  });
  it('discovers only known custom button entity and exact room links, leaving camera IDs and labels literal', () => {
    const controls = { version: 1, bars: [{ id: 'evening', label: 'scene.label', placement: 'room', room_id: 'exact-room', style: 'pills',
      buttons: [{ id: 'movie', label: 'script.label', icon: 'mdi:movie', color: 'amber', action: { type: 'scene', entity: 'scene.actual' } },
        { id: 'door', label: 'Door', icon: 'mdi:door', color: 'teal', action: { type: 'view', view_id: 'sensor.camera_view_name' } },
        { id: 'routine', label: 'Routine', icon: 'mdi:play', color: 'theme', action: { type: 'automation', entity: 'automation.actual', skip_conditions: false } }] }] };
    const before = structuredClone(controls), graph = enumerateSavedHaReferences({ layout: { custom_controls: controls } });
    expect(graph.references.map((row) => [row.kind, row.id])).toEqual([['room', 'exact-room'], ['entity', 'scene.actual'], ['entity', 'automation.actual']]);
    expect(graph.complete).toBe(true); expect(controls).toEqual(before);
    expect(graph.references[1].segments).toEqual(['layout', 'custom_controls', 'bars', 0, 'buttons', 0, 'action', 'entity']);
  });
  it('retains own custom-controls authority and rejects future action interpretations without invoking accessors', () => {
    const fallback = { custom_controls: { version: 1, bars: [{ room_id: 'fallback-room', buttons: [{ action: { type: 'scene', entity: 'scene.fallback' } }] }] } };
    for (const value of [null, undefined, { version: 2, bars: [{ room_id: 'future-room' }] }]) {
      expect(enumerateSavedHaReferences({ layout: { custom_controls: value }, config: fallback }).references).toEqual([]);
    }
    const getter = vi.fn(() => fallback.custom_controls), layout = {};
    Object.defineProperty(layout, 'custom_controls', { enumerable: true, get: getter });
    const unreadable = enumerateSavedHaReferences({ layout, config: fallback });
    expect(getter).not.toHaveBeenCalled(); expect(unreadable.references).toEqual([]); expect(unreadable.complete).toBe(false);
    const future = enumerateSavedHaReferences({ layout: { custom_controls: { version: 1, bars: [{ buttons: [{ action: { type: 'future-action', entity: 'scene.opaque' } }] }] } } });
    expect(future.references).toEqual([]); expect(future.diagnostics).toContainEqual(expect.objectContaining({ code: 'reference_shape' }));
  });
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
