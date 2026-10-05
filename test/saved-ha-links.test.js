// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registryIssues } from '../src/entity-metadata.js';
import { EditMode } from '../src/edit-mode.js';

const current = (id, state = 'on', attributes = {}) => ({ entity_id: id, state, attributes });
const ha = () => ({ states: {}, entities: {}, areas: {}, floors: {}, devices: {}, callWS: vi.fn(), callService: vi.fn() });
const shortcuts = (entity = 'scene.removed', room = 'model:removed') => ({ version: 1, rooms: [{ room_id: room, actions: [{ id: 'actual', entity, label: 'User label', extra: true }], extra: 'room' }], extra: 'root' });
const scenePreview = (scene = 'scene.removed', light = 'light.removed') => ({ enabled: true, items: [{ id: 'movie', scene_entity: scene, lights: [{ entity: light, state: 'on' }] }] });
const context = () => ({ ready: true, rooms: [], anchors: [], floors: [] });
const edits = [];
function data(layout, config = {}, hass = ha(), resolved = context()) {
  const card = document.createElement('div'); document.body.append(card);
  Object.assign(card, { _layout: { rooms: [], ...layout }, _config: config, _hass: hass, _store: { backend: 'shared' },
    _view: { setControlsEnabled: vi.fn(), setOverlay: vi.fn(), setStems: vi.fn() }, _loading: resolved.ready === false,
    _roomList: resolved.rooms, _floors: resolved.floors, trackingAnchors: () => resolved.anchors, _editing: true, _commit: vi.fn() });
  const edit = new EditMode(card); card._edit = edit; edit.tab = 'data'; card.append(edit.panel); edit.render();
  edits.push({ edit, card }); return { card, edit, report: () => edit.panel.querySelector('[data-single-layout-data]') };
}
afterEach(() => { edits.splice(0).forEach(({ edit, card }) => { edit.dispose(); card.remove(); }); });

describe('saved feature links in the actual Data tab', () => {
  it('reports new exact feature paths rather than claiming all links are present, with no configuration or HA action', () => {
    const layout = { scene_previews: scenePreview(), room_actions: shortcuts(), weather: { entity: 'weather.removed' },
      security_bindings: [{ entity: 'lock.removed', target: { type: 'plan', position_key: 'object:removed' } }],
      house_summary: { weather_entity: 'weather.house', person_entities: ['person.removed'], alarm_entity: 'alarm_control_panel.removed' } };
    const before = structuredClone(layout), hass = ha(), { card, report } = data(layout, {}, hass);
    for (const path of ['layout.scene_previews.items.0.scene_entity', 'layout.scene_previews.items.0.lights.0.entity', 'layout.room_actions.rooms.0.room_id',
      'layout.room_actions.rooms.0.actions.0.entity', 'layout.weather.entity', 'layout.security_bindings.0.entity', 'layout.security_bindings.0.target.position_key',
      'layout.house_summary.weather_entity', 'layout.house_summary.person_entities.0', 'layout.house_summary.alarm_entity']) expect(report().textContent).toContain(path);
    expect(report().textContent).not.toContain('No missing saved links'); expect(card._layout).toEqual({ rooms: [], ...before }); expect(card._commit).not.toHaveBeenCalled();
    expect(hass.callService).not.toHaveBeenCalled(); expect(hass.callWS).not.toHaveBeenCalled();
  });
  it('uses current names as literal text and refreshes only when the exact saved source returns', () => {
    const hass = ha(), { edit, report, card } = data({ weather: { entity: 'weather.actual' } }, {}, hass);
    hass.states['weather.similar'] = current('weather.similar', 'sunny', { friendly_name: 'Same weather name' }); edit.render(); expect(report().textContent).toContain('weather.actual');
    hass.states['weather.actual'] = current('weather.actual', 'unavailable', { friendly_name: '<img src=x onerror=alert(1)>' }); edit.render();
    expect(report().textContent).toContain('<img src=x onerror=alert(1)>'); expect(report().querySelector('img')).toBeNull();
    hass.states['weather.actual'].state = 'sunny'; edit.render(); expect(report().textContent).toContain('No missing saved links');
    expect(card._layout.weather.entity).toBe('weather.actual'); expect(card._commit).not.toHaveBeenCalled(); expect(hass.callService).not.toHaveBeenCalled();
  });
  it('shows pending source/model checks rather than deletion while registries or loaded geometry are absent', () => {
    const hass = { callService: vi.fn(), callWS: vi.fn() }, { report } = data({ room_actions: shortcuts() }, {}, hass, { ready: false });
    expect(report().textContent).toContain('Waiting'); expect(report().textContent).not.toContain('is missing'); expect(report().textContent).not.toContain('No missing saved links');
    expect(hass.callService).not.toHaveBeenCalled(); expect(hass.callWS).not.toHaveBeenCalled();
  });
});

describe('new saved feature reference checks', () => {
  it('keeps legacy report order and appends source and exact plan-target checks', () => {
    const layout = { objects: { legacy: { entity: 'sensor.legacy' } }, scene_previews: scenePreview(), room_actions: shortcuts(),
      security_bindings: [{ entity: 'lock.source', target: { type: 'plan', roomId: 'model:security', floorId: 'f' } },
        { entity: 'binary_sensor.source', target: { type: 'plan', position: { x: 1, y: 2, z: 0, floorId: 'p' } } },
        { entity: 'lock.anchor', target: { type: 'plan', position_key: 'object:door' } }] };
    const issues = registryIssues(ha(), layout, {}, context());
    expect(issues[0]).toMatchObject({ id: 'sensor.legacy', path: 'layout.objects.legacy.entity' });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'room', id: 'model:removed', path: 'layout.room_actions.rooms.0.room_id' }),
      expect.objectContaining({ kind: 'room', id: 'model:security', path: 'layout.security_bindings.0.target.roomId' }),
      expect.objectContaining({ kind: 'floor', id: 'f', path: 'layout.security_bindings.0.target.floorId' }),
      expect.objectContaining({ kind: 'floor', id: 'p', path: 'layout.security_bindings.1.target.position.floorId' }),
      expect.objectContaining({ kind: 'anchor', id: 'object:door', path: 'layout.security_bindings.2.target.position_key' }),
    ]));
  });
  it('accepts actual state-only sources, unknown scene activation time and loaded exact geometry', () => {
    const hass = ha(); hass.states['scene.actual'] = current('scene.actual', 'unknown'); hass.states['light.actual'] = current('light.actual', 'off');
    hass.states['lock.actual'] = current('lock.actual', 'locked'); hass.states['weather.actual'] = current('weather.actual', 'sunny');
    hass.states['person.actual'] = current('person.actual', 'home'); hass.states['alarm_control_panel.actual'] = current('alarm_control_panel.actual', 'disarmed');
    const layout = { scene_previews: scenePreview('scene.actual', 'light.actual'), room_actions: shortcuts('scene.actual', 'model:actual'),
      security_bindings: [{ entity: 'lock.actual', target: { type: 'plan', roomId: 'model:actual', floorId: 'private' } }], weather: { entity: 'weather.actual' },
      house_summary: { weather_entity: 'weather.actual', person_entities: ['person.actual'], alarm_entity: 'alarm_control_panel.actual' } };
    expect(registryIssues(hass, layout, {}, { rooms: [{ room: { id: 'model:actual' } }], floors: [{ id: 'private', elevation: 0 }], anchors: [] })).toEqual([]);
  });
  it.each([
    ['unavailable', (hass) => { hass.states['weather.actual'].state = 'unavailable'; }, 'entity_unavailable'],
    ['unknown', (hass) => { hass.states['weather.actual'].state = 'unknown'; }, 'entity_unknown'],
    ['restored', (hass) => { hass.states['weather.actual'].attributes.restored = true; }, 'entity_restored'],
    ['hidden', (hass) => { hass.entities['weather.actual'] = { hidden_by: 'user' }; }, 'entity_hidden'],
    ['disabled', (hass) => { hass.entities['weather.actual'] = { disabled_by: 'integration' }; }, 'entity_disabled'],
  ])('reports a retained %s source distinctly and clears its warning after current recovery', (_name, change, code) => {
    const hass = ha(), layout = { weather: { entity: 'weather.actual', extra: '<literal>' } }, before = structuredClone(layout);
    hass.states['weather.actual'] = current('weather.actual', 'sunny'); change(hass);
    expect(registryIssues(hass, layout)).toMatchObject([{ code, id: 'weather.actual', path: 'layout.weather.entity' }]);
    hass.states['weather.actual'] = current('weather.actual', 'sunny'); hass.entities = {};
    expect(registryIssues(hass, layout)).toEqual([]); expect(layout).toEqual(before); expect(hass.callService).not.toHaveBeenCalled();
  });
  it('distinguishes registration without state, absent registries and confirmed deletion', () => {
    const layout = { house_summary: { person_entities: ['person.saved'] } };
    expect(registryIssues({}, layout)).toMatchObject([{ code: 'reference_pending', id: 'person.saved' }]);
    expect(registryIssues({ states: {} }, layout)).toMatchObject([{ code: 'reference_pending', id: 'person.saved' }]);
    expect(registryIssues({ entities: { 'person.saved': {} } }, layout)).toMatchObject([{ code: 'entity_no_state', id: 'person.saved' }]);
    expect(registryIssues(ha(), layout)).toMatchObject([{ code: 'missing_entity', id: 'person.saved' }]);
  });
  it('does not certify cached source readings during an explicitly disconnected session', () => {
    const hass = ha(), layout = { weather: { entity: 'weather.actual' } }; hass.connection = { connected: false };
    hass.states['weather.actual'] = current('weather.actual', 'sunny');
    expect(registryIssues(hass, layout)).toMatchObject([{ code: 'reference_pending', id: 'weather.actual' }]);
    hass.connection.connected = true; expect(registryIssues(hass, layout)).toEqual([]); expect(hass.callWS).not.toHaveBeenCalled();
  });
  it('uses each feature’s actual fallback, including authoritative room-shortcut null and own undefined', () => {
    const config = { weather: { entity: 'weather.old' }, house_summary: { person_entities: ['person.old'] }, scene_previews: scenePreview(),
      security_bindings: [{ entity: 'lock.old' }], room_actions: shortcuts('scene.old') };
    const layout = { weather: null, house_summary: {}, scene_previews: { items: [] }, security_bindings: [], room_actions: undefined };
    expect(registryIssues(ha(), layout, config).map((issue) => issue.path)).toEqual(['config.weather.entity']);
    layout.room_actions = null; const issues = registryIssues(ha(), layout, config); expect(issues.some((issue) => issue.path === 'layout.room_actions')).toBe(true);
    expect(issues.some((issue) => issue.id === 'scene.old')).toBe(false); expect(config.room_actions.rooms[0].actions[0].entity).toBe('scene.old');
  });
  it('retains unknown imports and never guesses references from future fields or similar names', () => {
    const layout = { weather: { future: 'weather.not_a_source' }, house_summary: { title: 'person.not_a_source', future: { entity: 'sensor.future' } },
      room_actions: { version: 2, rooms: [{ room_id: 'future-room', actions: [{ entity: 'scene.future' }] }] }, scene_previews: { items: [{ id: 'x', note: 'light.future' }] } };
    const before = structuredClone(layout), issues = registryIssues(ha(), layout, {}, context());
    expect(issues.some((issue) => issue.path === 'layout.room_actions.version')).toBe(true); expect(issues.some((issue) => issue.id?.includes('future'))).toBe(false);
    expect(layout).toEqual(before);
  });
  it('never invokes saved source, nested reference, serialization or prototype hooks', () => {
    const getter = vi.fn(() => 'weather.guessed'), hook = vi.fn(), layout = { weather: {}, house_summary: { person_entities: ['person.old'], toJSON: hook } };
    Object.defineProperty(layout.weather, 'entity', { enumerable: true, get: getter }); Object.defineProperty(layout, 'room_actions', { enumerable: true, get: getter });
    const config = { room_actions: shortcuts('scene.fallback') }; const issues = registryIssues(ha(), layout, config, context());
    expect(getter).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled(); expect(issues.some((issue) => issue.id === 'scene.fallback')).toBe(false);
    expect(issues.some((issue) => issue.path === 'layout.weather.entity')).toBe(true); expect(issues.some((issue) => issue.path === 'layout.room_actions')).toBe(true);
  });
  it('inspects legacy fields without invoking accessors or hooks, while keeping other exact links diagnosable', () => {
    const getter = vi.fn(() => [{ area_id: 'area.guessed' }]), hook = vi.fn(), layout = { model: { toJSON: hook }, weather: { entity: 'weather.actual' },
      objects: { lamp: { entity: 'light.actual' } } };
    Object.defineProperty(layout, 'rooms', { enumerable: true, get: getter }); Object.defineProperty(layout.objects.lamp, 'entity', { enumerable: true, get: getter });
    const issues = registryIssues(ha(), layout);
    expect(getter).not.toHaveBeenCalled(); expect(hook).not.toHaveBeenCalled();
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'reference_accessor', path: 'layout.rooms' }),
      expect.objectContaining({ code: 'reference_accessor', path: 'layout.objects.lamp.entity' }), expect.objectContaining({ id: 'weather.actual' })]));
    expect(issues.some((issue) => issue.id === 'area.guessed')).toBe(false);
  });
  it('does not treat an unreadable legacy shared override as an absent field and guess a card fallback', () => {
    const getter = vi.fn(), layout = { views: { named: {} } }, config = { model: '/local/house.glb', model_floors: { level: 'guessed-floor' },
      views: { named: { floors: ['guessed-view'] } }, room_overlays: { bindings: { room: ['sensor.guessed'] } }, presence_bindings: [{ entity: 'person.guessed' }] };
    for (const field of ['room_overlays', 'presence_bindings', 'model']) Object.defineProperty(layout, field, { enumerable: true, get: getter });
    Object.defineProperty(layout.views.named, 'floors', { enumerable: true, get: getter });
    const issues = registryIssues(ha(), layout, config);
    expect(getter).not.toHaveBeenCalled(); expect(issues.some((issue) => issue.id?.includes('guessed'))).toBe(false);
    expect(issues.filter((issue) => issue.code === 'reference_accessor')).toHaveLength(4);
  });
  it('bounds a large retained report with an explicit remainder notice rather than silently certifying it', () => {
    const layout = { house_summary: { person_entities: Array.from({ length: 5000 }, (_, index) => `person.saved_${index}`) } }, before = structuredClone(layout);
    const issues = registryIssues(ha(), layout);
    expect(issues.length).toBeLessThanOrEqual(4096); expect(issues.some((issue) => issue.code === 'reference_limit')).toBe(true);
    expect(layout).toEqual(before);
  });
  it('reports duplicate current room IDs as ambiguous and does not choose a replacement room', () => {
    const hass = ha(); hass.states['scene.actual'] = current('scene.actual', 'unknown');
    const layout = { room_actions: shortcuts('scene.actual', 'model:exact') }, loaded = { rooms: [{ id: 'model:exact' }, { room: { id: 'model:exact' } }] };
    expect(registryIssues(hass, layout, {}, loaded)).toMatchObject([{ code: 'ambiguous_room', id: 'model:exact' }]);
    expect(layout.room_actions.rooms[0].room_id).toBe('model:exact');
  });
  it.each([['de', 'nicht verfügbar'], ['fr', 'indisponible'], ['es', 'no está disponible'], ['nl', 'is unavailable']])('localizes new %s report text while preserving exact IDs and literal names', (language, words) => {
    const hass = ha(); hass.locale = { language }; hass.states['weather.actual'] = current('weather.actual', 'unavailable', { friendly_name: 'Literal <Weather>' });
    const issue = registryIssues(hass, { weather: { entity: 'weather.actual' } })[0];
    expect(issue.message).toContain(words); expect(issue.message).toContain('weather.actual'); expect(issue.message).toContain('Literal <Weather>');
    expect(issue.id).toBe('weather.actual'); expect(hass.callService).not.toHaveBeenCalled();
  });
  it('checks new room/anchor/floor references only against current loaded caller context', () => {
    const layout = { security_bindings: [{ entity: 'lock.actual', target: { type: 'plan', roomId: 'model:missing', floorId: 'missing' } }], room_actions: shortcuts('scene.actual', 'model:missing') };
    const hass = ha(); hass.states['lock.actual'] = current('lock.actual', 'locked'); hass.states['scene.actual'] = current('scene.actual', 'unknown');
    const pending = registryIssues(hass, layout, {}, { ready: false, rooms: [], floors: [], anchors: [] });
    expect(pending.every((issue) => issue.code === 'reference_pending')).toBe(true); expect(pending).not.toHaveLength(0);
    expect(registryIssues(hass, layout, {}, context()).map((issue) => issue.kind)).toEqual(expect.arrayContaining(['room', 'floor']));
  });
});
