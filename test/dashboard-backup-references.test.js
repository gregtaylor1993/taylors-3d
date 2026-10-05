import { describe, expect, it, vi } from 'vitest';
import { BACKUP_REFERENCE_LIMITS, collectDashboardReferences, inspectDashboardReferences, resolveDashboardReferences } from '../src/dashboard-backup-references.js';

const preview = (layout = {}, config = {}, other = []) => ({ dashboard: { views: [{ cards: [{ type: 'custom:taylors3d-card', layout_key: 'home', ...config }, ...other] }] },
  layouts: { home: { backend: 'shared', metadata: {}, layout: { version: 1, ...layout } } } });
const environment = () => ({ states: {}, entities: {}, devices: {}, areas: {}, floors: {} });
const saved = {
  rooms: [{ id: 'r', area_id: 'area_gone', floor_id: 'floor_gone' }],
  model: { rooms: { exact_mesh: { area: 'model_area' } }, levels: { level: { floor: 'model_floor' } } },
  room_actions: { version: 1, rooms: [{ room_id: 'r', actions: [{ id: 's', entity: 'scene.gone' }, { id: 'p', entity: 'script.gone' }] }] },
  house_summary: { weather_entity: 'weather.gone', person_entities: ['person.gone'], alarm_entity: 'alarm_control_panel.gone' },
  presence_bindings: [{ entity: 'binary_sensor.gone', room_source: { entity: 'sensor.room' }, identity_entity: 'person.identity' }],
  vehicle_bindings: [{ entity: 'event.gone', position: { floorId: 'event_floor' } }],
  vacuum_bindings: [{ entity: 'vacuum.gone', position_source: { entity: 'sensor.gps', floorId: 'gps_floor', source: 'gps', latitude_attr: 'real.latitude' } }],
  scene_previews: { items: [{ id: 'scene', scene_entity: 'scene.preview', lights: [{ entity: 'light.target', state: 'on' }] }] },
  camera_coverage: { 'camera.gone': { enabled: true }, 'object:camera_mesh': { enabled: true } },
  room_overlays: { mode: 'energy', bindings: { r: { entities: ['sensor.energy', { entity: 'sensor.temperature' }] }, other: ['sensor.direct'] } },
  alert_bindings: [{ entity: 'binary_sensor.leak', area_id: 'leak_area', floorId: 'leak_floor' }],
  security_bindings: [{ entity: 'lock.gone', target: { type: 'plan', position: { floorId: 'security_floor', x: 1, y: 2, z: 0 } } }],
  furniture: { version: 1, instances: [{ id: 'sofa', floor_id: 'furniture_floor', pack_id: 'raw', asset_sha256: 'raw', item_id: 'raw' }] },
  views: { preset: { floors: ['preset_floor'], camera: { position: [1, 2, 3] } } },
};
describe('static current-environment backup references', () => {
  it('reads exact known Taylor links including new actions, source frames, header, model, preset, furniture and overlays', () => {
    const raw = preview(saved), before = structuredClone(raw), report = inspectDashboardReferences(raw, environment());
    for (const id of ['scene.gone', 'script.gone', 'area_gone', 'floor_gone', 'model_area', 'model_floor', 'weather.gone', 'person.gone',
      'alarm_control_panel.gone', 'binary_sensor.gone', 'sensor.room', 'person.identity', 'event.gone', 'event_floor', 'vacuum.gone', 'sensor.gps',
      'gps_floor', 'scene.preview', 'light.target', 'camera.gone', 'sensor.energy', 'sensor.temperature', 'sensor.direct', 'binary_sensor.leak',
      'leak_area', 'leak_floor', 'lock.gone', 'security_floor', 'furniture_floor', 'preset_floor']) {
      expect(report.references.find((r) => r.id === id), id).toMatchObject({ status: 'missing' });
    }
    expect(report.references.some((r) => r.id === 'object:camera_mesh')).toBe(false); expect(raw).toEqual(before);
    expect(report.coverage).toBe('known_fields'); expect(report.needsReview).toBe(true);
  });
  it('recognizes explicit standard Lovelace entity/area/floor selectors and action targets while opaque third-party data remains uninspected', () => {
    const raw = preview({}, {}, [{ type: 'vertical-stack', cards: [{ type: 'entities', entities: ['new_domain2.actual', { entity: 'scene.named' }] },
      { type: 'area', area: 'exact_area', tap_action: { action: 'perform-action', perform_action: 'light.turn_on', target: { entity_id: ['light.real'], area_id: 'area_action', floor_id: ['floor_action'] } } }] },
      { type: 'custom:unknown', entity: 'sensor.not_checked', nested: { entity_id: 'light.not_checked' } },
      { type: 'entity', entity: 'light.visible', visibility: [{ condition: 'or', conditions: [{ condition: 'state', entity: 'binary_sensor.visible', state: 'on' }] }] },
      { type: 'entities', entities: [{ type: 'custom:unknown-row', entity: 'sensor.not_checked' }], card_mod: { style: 'sensor.not_checked' } },
      { type: 'markdown', content: '{{ states("sensor.not_checked") }}' }]);
    const h = environment(); h.states['new_domain2.actual'] = { state: 'ready', attributes: {} };
    const report = inspectDashboardReferences(raw, h);
    expect(report.references.find((r) => r.id === 'new_domain2.actual')).toMatchObject({ status: 'present' });
    for (const id of ['scene.named', 'exact_area', 'light.real', 'area_action', 'floor_action', 'light.visible', 'binary_sensor.visible']) expect(report.references.some((r) => r.id === id)).toBe(true);
    expect(report.references.some((r) => r.id.endsWith('not_checked'))).toBe(false); expect(report.coverage).toBe('partial');
    expect(report.uninspected.map((r) => r.code)).toContain('unknown_card'); expect(report.uninspected.map((r) => r.code)).toContain('opaque_config');
  });
  it('distinguishes loaded missing IDs, registered entities without states, unknown scene timestamps, unavailable/restored readings and hidden eligibility', () => {
    const raw = preview({ room_actions: { version: 1, rooms: [{ room_id: 'r', actions: [{ entity: 'scene.never_activated' }] }] } }, {},
      [{ type: 'entities', entities: ['sensor.offline', 'sensor.registered', 'sensor.hidden', 'sensor.restored', 'sensor.missing'] }]);
    const h = environment(); h.states = { 'scene.never_activated': { state: 'unknown' }, 'sensor.offline': { state: 'unavailable' },
      'sensor.hidden': { state: 'ready' }, 'sensor.restored': { state: 'ready', attributes: { restored: true } } };
    h.entities = { 'sensor.registered': {}, 'sensor.hidden': { hidden_by: 'user', entity_category: 'diagnostic', disabled_by: 'integration' } };
    const report = inspectDashboardReferences(raw, h), at = (id) => report.references.find((r) => r.id === id);
    expect(at('sensor.missing')).toMatchObject({ status: 'missing' }); expect(at('sensor.registered')).toMatchObject({ status: 'present', reading: 'no_state' });
    expect(at('sensor.offline')).toMatchObject({ status: 'present', reading: 'unavailable' }); expect(at('sensor.restored')).toMatchObject({ status: 'present', reading: 'restored' });
    expect(at('sensor.hidden')).toMatchObject({ status: 'present', hidden: true, disabled: true, category: 'diagnostic' });
    expect(at('scene.never_activated')).toMatchObject({ status: 'present', reading: 'unknown' }); expect(report.counts.unavailable).toBe(3);
  });
  it('does not call absent or not-loaded registries empty, or infer missing entities from states alone', () => {
    const graph = collectDashboardReferences(preview({ rooms: [{ area_id: 'kitchen', floor_id: 'upstairs' }] }, { house_summary: { weather_entity: 'weather.now' } }));
    const report = resolveDashboardReferences(graph, { states: {} });
    expect(report.references.every((r) => r.status === 'waiting')).toBe(true); expect(report.counts.missing).toBe(0); expect(report.coverage).toBe('partial');
    expect(report.registry).toMatchObject({ entities: 'not_loaded', areas: 'not_loaded', floors: 'not_loaded' });
  });
  it('counts unknown sensor readings as unverified while preserving legitimate never-activated scenes', () => {
    const h = environment(); h.states = { 'sensor.unknown': { state: 'unknown' }, 'scene.unknown': { state: 'unknown' } };
    const report = inspectDashboardReferences(preview({}, {}, [{ type: 'entities', entities: ['sensor.unknown', 'scene.unknown'] }]), h);
    expect(report.counts.unavailable).toBe(1); expect(report.counts.missing).toBe(0);
  });
  it('preserves standalone saved plan floors and discloses the absent HA floor link instead of declaring a valid plan floor deleted', () => {
    const report = inspectDashboardReferences(preview({ floors: [{ id: 'custom_plan', name: 'Saved plan only' }], rooms: [{ floor_id: 'custom_plan' }] }), environment());
    expect(report.references.filter((r) => r.kind === 'floor').every((r) => r.status === 'layout_only' && r.layoutFloor)).toBe(true);
    expect(report.counts.missing).toBe(0); expect(report.counts.layoutOnly).toBe(2); expect(report.needsReview).toBe(true);
  });
  it('rechecks same-ID in-place registry/state changes against an extracted graph without rescanning or rewriting the archive', () => {
    const raw = preview({ rooms: [{ area_id: 'area', floor_id: 'floor' }] }, { house_summary: { weather_entity: 'weather.current2' } }), graph = collectDashboardReferences(raw);
    const h = environment(); const before = structuredClone(raw); let report = resolveDashboardReferences(graph, h);
    expect(report.counts.missing).toBe(3);
    h.states['weather.current2'] = { state: 'unavailable' }; h.entities['weather.current2'] = { hidden: true }; h.areas.area = {}; h.floors.floor = {};
    report = resolveDashboardReferences(graph, h); expect(report.counts.missing).toBe(0); expect(report.counts.unavailable).toBe(1); expect(report.counts.eligibility).toBe(1);
    delete h.states['weather.current2']; delete h.entities['weather.current2']; delete h.areas.area; delete h.floors.floor;
    expect(resolveDashboardReferences(graph, h).counts.missing).toBe(3); expect(raw).toEqual(before);
  });
  it('invokes no archive/current getters, toJSON hooks, formatters or network functions and discloses unsafe branches', () => {
    const getter = vi.fn(() => 'sensor.false'), hook = vi.fn(), raw = preview({}, {}, [{ type: 'entities', entities: ['sensor.accessor'] }]);
    Object.defineProperty(raw.layouts.home.layout, 'house_summary', { enumerable: true, get: getter });
    raw.dashboard.toJSON = hook; const h = environment(); Object.defineProperty(h.states, 'sensor.accessor', { enumerable: true, get: getter });
    h.formatEntityName = hook; h.callWS = hook; h.callService = hook;
    const report = inspectDashboardReferences(raw, h); expect(getter).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled();
    expect(report.coverage).toBe('partial'); expect(report.references.find((r) => r.id === 'sensor.accessor').status).toBe('waiting');
    expect(report.uninspected.map((r) => r.code)).toContain('unsafe'); expect(report.uninspected.map((r) => r.code)).toContain('registry_unsafe');
  });
  it('bounds depth, nodes and reference counts and reports the uninspected remainder without claiming all checked', () => {
    const raw = preview({}, {}, Array.from({ length: BACKUP_REFERENCE_LIMITS.references + 20 }, (_, i) => ({ type: 'entity', entity: 'sensor.exact_' + i })));
    const report = inspectDashboardReferences(raw, environment()); expect(report.references.length).toBe(BACKUP_REFERENCE_LIMITS.references);
    expect(report.coverage).toBe('partial'); expect(report.uninspected.some((r) => r.code === 'limit')).toBe(true);
    const cyclic = preview(); cyclic.layouts.home.layout.future = cyclic;
    expect(inspectDashboardReferences(cyclic, environment()).uninspected.some((r) => r.code === 'unsafe')).toBe(true);
    let deep = {}; const nested = deep; for (let i = 0; i < 60; i++) { deep.next = {}; deep = deep.next; }
    expect(inspectDashboardReferences(preview({ future: nested }), environment()).uninspected.some((r) => r.code === 'limit')).toBe(true);
  });
  it('reports unknown Taylor fields and strategy dashboards uninspected rather than parsing generic entity-like strings', () => {
    const raw = preview({ future_feature: { entity: 'sensor.do_not_guess' } }, { future_entity: 'sensor.do_not_guess' });
    expect(inspectDashboardReferences(raw, environment()).references).toEqual([]);
    expect(inspectDashboardReferences(raw, environment()).coverage).toBe('partial');
    raw.dashboard = { strategy: { type: 'custom:unknown', entity: 'sensor.do_not_guess' } };
    expect(inspectDashboardReferences(raw, environment()).uninspected.some((r) => r.code === 'dashboard_not_inspected')).toBe(true);
  });
});
