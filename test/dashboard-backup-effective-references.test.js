import { describe, expect, it, vi } from 'vitest';
import { collectDashboardReferences, resolveDashboardReferences } from '../src/dashboard-backup-references.js';

const card = (config = {}) => ({ type: 'custom:taylors3d-card', layout_key: 'home', ...config });
const archive = (layout = {}, cards = [card()], otherLayouts = {}) => ({
  dashboard: { views: [{ cards }] },
  layouts: { home: { backend: 'shared', layout: { version: 1, ...layout } }, ...otherLayouts },
});
const environment = (ids = []) => ({
  states: Object.fromEntries(ids.map((id) => [id, { state: id.startsWith('scene.') ? 'unknown' : 'reported', attributes: {} }])),
  entities: {}, devices: {}, areas: {}, floors: {}, callWS: vi.fn(), callService: vi.fn(), formatEntityName: vi.fn(),
});
const shortcuts = (entity) => ({ version: 1, rooms: [{ room_id: 'exact-room', actions: [{ id: 'action', entity }] }] });
const entityIds = (graph) => graph.references.filter((reference) => reference.kind === 'entity').map((reference) => reference.id);

describe('effective Taylor references in a full dashboard backup', () => {
  it('keeps a future visibility rule raw and marks its reference inspection partial instead of interpreting its entity', () => {
    const raw = archive({ custom_controls: { version: 1, bars: [{ id: 'daily', label: 'Daily', placement: 'bottom', style: 'pills', dock: { limit: 4 },
      buttons: [{ id: 'return', label: 'Return', icon: 'mdi:robot-vacuum', color: 'teal', pinned: true, action: { type: 'script', entity: 'script.actual' },
        visibility: { type: 'future-rule', entity: 'vacuum.future_literal', state: 'cleaning', opaque: { preserve: true } } }] }] } });
    const before = structuredClone(raw), restored = JSON.parse(JSON.stringify(raw)), graph = collectDashboardReferences(restored);
    expect(entityIds(graph)).toEqual(['script.actual']);
    expect(graph.uninspected).toContainEqual(expect.objectContaining({ path: '/preview/layouts/home/layout/custom_controls/bars/0/buttons/0/visibility/type' }));
    expect(resolveDashboardReferences(graph, environment(['script.actual'])).coverage).toBe('partial');
    expect(restored).toEqual(before); expect(raw).toEqual(before);
  });
  it('round-trips compact docks and explicit condition sources in full raw archives with exact repair paths', () => {
    const controls = (entity) => ({ version: 1, bars: [{ id: 'daily', label: 'scene.literal_label', placement: 'bottom', style: 'pills', dock: { limit: 5 },
      buttons: [{ id: 'return', label: 'Return vacuum', icon: 'mdi:robot-vacuum', color: 'teal', pinned: true,
        action: { type: 'script', entity: 'script.return_robot' }, visibility: { type: 'state', entity, state: 'cleaning' } }] }] });
    const raw = archive({ custom_controls: controls('vacuum.exact') }, [card({ custom_controls: controls('vacuum.inactive') })]);
    const before = structuredClone(raw), restored = JSON.parse(JSON.stringify(raw)), graph = collectDashboardReferences(restored), hass = environment(['script.return_robot']);
    expect(entityIds(graph).sort()).toEqual(['script.return_robot', 'vacuum.exact']); expect(graph.uninspected).toEqual([]);
    expect(graph.references.find((row) => row.id === 'vacuum.exact').path).toBe('/preview/layouts/home/layout/custom_controls/bars/0/buttons/0/visibility/entity');
    expect(resolveDashboardReferences(graph, hass).references.find((row) => row.id === 'vacuum.exact').status).toBe('missing');
    hass.states['vacuum.exact'] = { state: 'cleaning', attributes: {} };
    expect(resolveDashboardReferences(graph, hass).references.find((row) => row.id === 'vacuum.exact').status).toBe('present');
    expect(restored).toEqual(before); expect(raw).toEqual(before); expect(hass.callService).not.toHaveBeenCalled(); expect(hass.callWS).not.toHaveBeenCalled();
    // Backups preserve outside HA identifiers; the normal editor performs any deliberate repair.
    expect(restored.dashboard.views[0].cards[0].custom_controls.bars[0].buttons[0].visibility.entity).toBe('vacuum.inactive');
  });
  it('checks saved custom buttons, preserves their raw archive, and never revives an inactive fallback', () => {
    const controls = (entity) => ({ version: 1, bars: [{ id: 'evening', label: 'sensor.literal', placement: 'bottom', style: 'pills',
      buttons: [{ id: 'movie', label: 'Movie', icon: 'mdi:movie', color: 'amber', action: { type: 'scene', entity } },
        { id: 'view', label: 'Front', icon: 'mdi:door', color: 'theme', action: { type: 'view', view_id: 'sensor.local_view_id' } }] }] });
    const raw = archive({ custom_controls: controls('scene.current') }, [card({ custom_controls: controls('scene.inactive') })]), before = structuredClone(raw);
    const graph = collectDashboardReferences(raw), hass = environment(['scene.current']);
    expect(entityIds(graph)).toEqual(['scene.current']);
    expect(graph.uninspected).toEqual([]); expect(resolveDashboardReferences(graph, hass).counts.missing).toBe(0);
    expect(raw).toEqual(before); expect(hass.callService).not.toHaveBeenCalled(); expect(hass.callWS).not.toHaveBeenCalled();
    expect(entityIds(collectDashboardReferences(archive({ custom_controls: null }, [card({ custom_controls: controls('scene.inactive') })])))).toEqual([]);
    delete hass.states['scene.current'];
    expect(resolveDashboardReferences(graph, hass).references.find((row) => row.id === 'scene.current').status).toBe('missing');
  });
  it('does not flag shadowed weather or room shortcuts as required by the copied dashboard', () => {
    const raw = archive({ weather: { entity: 'weather.shared' }, room_actions: { version: 1, rooms: [] } },
      [card({ weather: { entity: 'weather.old_card' }, room_actions: shortcuts('scene.old_card') })]);
    const graph = collectDashboardReferences(raw), hass = environment(['weather.shared']), report = resolveDashboardReferences(graph, hass);
    expect(entityIds(graph)).toEqual(['weather.shared']);
    expect(report.counts.missing).toBe(0);
    expect(report.coverage).toBe('known_fields');
    expect(hass.callWS).not.toHaveBeenCalled(); expect(hass.callService).not.toHaveBeenCalled(); expect(hass.formatEntityName).not.toHaveBeenCalled();
  });

  it('checks the distinct effective fallbacks of multiple cards sharing one layout', () => {
    const raw = archive({ weather: null, house_summary: null }, [
      { type: 'vertical-stack', cards: [card({ weather: { entity: 'weather.first' }, house_summary: { alarm_entity: 'alarm_control_panel.first' } })] },
      card({ weather: { entity: 'weather.second' }, house_summary: { person_entities: ['person.second'] } }),
    ]);
    const graph = collectDashboardReferences(raw);
    expect(entityIds(graph).sort()).toEqual(['alarm_control_panel.first', 'person.second', 'weather.first', 'weather.second']);
    expect(graph.references.find((reference) => reference.id === 'weather.first').path)
      .toBe('/preview/dashboard/views/0/cards/0/cards/0/weather/entity');
    expect(graph.references.find((reference) => reference.id === 'weather.second').path)
      .toBe('/preview/dashboard/views/0/cards/1/weather/entity');
  });

  it('deduplicates shared paths without restoring a different fallback from any card', () => {
    const raw = archive({ weather: { entity: 'weather.shared' }, house_summary: { person_entities: ['person.shared'] } }, [
      card({ weather: { entity: 'weather.first_card' }, house_summary: { person_entities: ['person.first_card'] } }),
      card({ weather: { entity: 'weather.second_card' }, house_summary: { person_entities: ['person.second_card'] } }),
    ]);
    const graph = collectDashboardReferences(raw);
    expect(entityIds(graph).sort()).toEqual(['person.shared', 'weather.shared']);
    expect(graph.references.find((reference) => reference.id === 'weather.shared').path).toBe('/preview/layouts/home/layout/weather/entity');
  });

  it.each([null, undefined])('keeps an own shared room-actions value %s authoritative over card shortcuts', (roomActions) => {
    const graph = collectDashboardReferences(archive({ room_actions: roomActions }, [card({ room_actions: shortcuts('scene.inactive_card') })]));
    expect(entityIds(graph)).not.toContain('scene.inactive_card');
    if (roomActions === null) expect(graph.uninspected).toContainEqual({ code: 'unknown_config', path: '/preview/layouts/home/layout/room_actions' });
  });

  it.each(['weather', 'room_actions'])('discloses an own shared %s accessor without reviving the card fallback or calling it', (feature) => {
    const raw = archive({}, [card({ weather: { entity: 'weather.inactive' }, room_actions: shortcuts('scene.inactive') })]);
    const getter = vi.fn(() => { throw new Error('Saved archive data must never execute an accessor.'); });
    Object.defineProperty(raw.layouts.home.layout, feature, { enumerable: true, get: getter });
    const graph = collectDashboardReferences(raw), inactiveId = feature === 'weather' ? 'weather.inactive' : 'scene.inactive';
    expect(entityIds(graph)).not.toContain(inactiveId);
    expect(graph.uninspected).toContainEqual({ code: 'unsafe', path: `/preview/layouts/home/layout/${feature}` });
    expect(getter).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(raw.layouts.home.layout, feature).get).toBe(getter);
  });

  it('uses the same effective precedence for header, scene previews and security sources', () => {
    const raw = archive({
      house_summary: { weather_entity: 'weather.shared_header' },
      scene_previews: { items: [{ id: 'shared', scene_entity: 'scene.shared', lights: [{ entity: 'light.shared' }] }] },
      security_bindings: [{ entity: 'binary_sensor.shared' }],
    }, [card({
      house_summary: { weather_entity: 'weather.inactive_header' },
      scene_previews: { items: [{ id: 'inactive', scene_entity: 'scene.inactive', lights: [{ entity: 'light.inactive' }] }] },
      security_bindings: [{ entity: 'binary_sensor.inactive' }],
    })]);
    expect(entityIds(collectDashboardReferences(raw)).sort()).toEqual(['binary_sensor.shared', 'light.shared', 'scene.shared', 'weather.shared_header']);
  });

  it('keeps standalone archived layout links visible and distinguishes saved plan floors from missing HA floors', () => {
    // A stored layout remains archived data even when no Taylor card currently uses it.
    const raw = archive({}, [card()], { 'saved/layout~only': { layout: { version: 1,
      floors: [{ id: 'plan-only', name: 'Saved plan floor' }],
      weather: { entity: 'weather.saved_layout' },
      security_bindings: [{ entity: 'lock.saved_layout', target: { type: 'plan', position: { floorId: 'plan-only', x: 0, y: 0, z: 0 } } }],
    } } });
    const graph = collectDashboardReferences(raw), report = resolveDashboardReferences(graph, environment());
    expect(entityIds(graph).sort()).toEqual(['lock.saved_layout', 'weather.saved_layout']);
    expect(graph.references.find((reference) => reference.id === 'weather.saved_layout').path)
      .toBe('/preview/layouts/saved~1layout~0only/layout/weather/entity');
    expect(report.references.filter((reference) => reference.kind === 'floor')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plan-only', status: 'layout_only', layoutFloor: true }),
    ]));
    expect(report.references.some((reference) => reference.id === 'plan-only' && reference.status === 'missing')).toBe(false);
  });

  it('preserves the raw archive and inactive settings while its cached graph follows current exact source IDs', () => {
    const raw = archive({ weather: { entity: 'weather.actual', retained: 'shared extra' }, room_actions: { version: 1, rooms: [], extra: 'kept' } },
      [card({ weather: { entity: 'weather.inactive', extra: 'card extra' }, room_actions: shortcuts('scene.inactive') })]);
    const before = structuredClone(raw), serialized = JSON.stringify(raw), graph = collectDashboardReferences(raw), hass = environment(['weather.actual']);
    expect(entityIds(graph)).toEqual(['weather.actual']);
    expect(resolveDashboardReferences(graph, hass).counts.missing).toBe(0);
    delete hass.states['weather.actual'];
    expect(resolveDashboardReferences(graph, hass).references.find((reference) => reference.id === 'weather.actual').status).toBe('missing');
    expect(raw).toEqual(before); expect(JSON.stringify(raw)).toBe(serialized);
    expect(raw.dashboard.views[0].cards[0].room_actions.rooms[0].actions[0].entity).toBe('scene.inactive');
  });
});
