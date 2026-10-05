// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';

const floors = [{ id: 'ground', name: 'Ground', elevation: 0 }, { id: 'upper', name: 'Upper', elevation: 3 }];
const rooms = floors.map((floor) => ({ floorId: floor.id, name: floor.name,
  room: { id: floor.id, floor_id: floor.id, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] } }));
const binding = { id: 'exact:leak', type: 'leak', entity: 'binary_sensor.leak', location_mode: 'coordinates',
  floor_id: 'upper', x: 1.25, y: 2.75, z: .12 };
const state = (value = 'on', attributes = {}) => ({ state: value, attributes });
const fixtures = [];
function fixture(bindings = [binding]) {
  const card = document.createElement('taylors3d-card'), stage = document.createElement('div'); document.body.append(stage);
  Object.defineProperty(card, 'isConnected', { value: true, configurable: true });
  card._stage = stage; card._config = { layout_key: 'exact-map', mini_map_size: 180 }; card._layout = { alert_bindings: structuredClone(bindings) };
  card._roomList = structuredClone(rooms); card._floors = structuredClone(floors); card._positions = new Map(); card._objects = null;
  card._editing = false; card._loading = false; card._miniMapVisible = true;
  card._hass = { states: { [binding.entity]: state() }, entities: {}, user: { id: 'reader', is_admin: false, is_active: true },
    connection: { connected: true }, auth: {}, callService: vi.fn(), callWS: vi.fn() };
  card._view = { floorElevation: (id) => card._floors.find((floor) => floor.id === id)?.elevation, getCamera: () => null, getTopCamera: () => null };
  card._navigationRooms = () => card._roomList; card._navigationFloors = () => 'all'; card.trackingAnchors = () => [];
  card._statusOverlays = { setData: vi.fn(), group: { visible: true } }; card._statusLegend = document.createElement('div');
  card._popup = { close: vi.fn() }; card._devicePopup = { close: vi.fn() };
  for (const name of ['_syncToolbarLabels', '_syncToolbar', '_syncFloorPresentation', '_syncSecurity', '_syncTracking', '_syncWeather',
    '_syncCameraCoverage', '_syncFurniture', '_syncHouseShell', '_syncScenePreviews', '_syncAmbient', '_suspendAmbient', '_stopScenePreview', '_schedule']) card[name] = vi.fn();
  card._presetEvents.setHass = vi.fn(); card._focusPlan = vi.fn(); card._miniMapSourceCamera = (snapshot) => snapshot;
  const info = vi.fn(); card.addEventListener('hass-more-info', info); card._configureMiniMap();
  const map = card._miniMap; map.select.value = 'upper'; map.select.dispatchEvent(new Event('change', { bubbles: true }));
  const alert = () => map.el.querySelector('.map-marker.alert'); fixtures.push({ card, stage }); return { card, map, alert, info };
}
const pointer = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));
const key = (node, type, value) => node.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true }));
const click = (node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
afterEach(() => { fixtures.splice(0).forEach(({ card, stage }) => {
  card._miniMap?.dispose(); card._ambientController.dispose(); card._scenePreviewController.dispose(); card._presetEvents.disconnect(); stage.remove();
}); vi.restoreAllMocks(); });

describe('current alert producer and mini-map root routing', () => {
  it('renders one SOURCE location, offsets only the 3D copy and opens the exact native info with zero commands', () => {
    const { card, map, alert, info } = fixture(); expect(alert()).toBeTruthy();
    card._floorPresentationReportValue = { valid: true, mode: 'horizontal', rows: [{ floor_id: 'upper', offset: [10, -3, -2] }] };
    card._floorPresentationRevision = 1; card._syncMiniMap();
    const marker = map.scene.markers.find((marker) => marker.alert); expect(marker).toMatchObject({ x: 1.25, y: 2.75, floorId: 'upper' });
    expect(card._statusOverlays.setData.mock.lastCall[0].alerts[0].location).toMatchObject({ x: 11.25, y: 4.75, floorId: 'upper' });
    const node = alert(); pointer(node, 'pointerdown'); pointer(node, 'pointerup'); click(node);
    expect(info).toHaveBeenCalledOnce(); expect(info.mock.lastCall[0].detail.entityId).toBe(binding.entity);
    expect(card._focusPlan).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
    expect(card._trackingTimer).toBeNull(); expect(card._alertLatches['exact:leak']).toBe(false);
  });

  it('withholds confirmed clears but keeps labelled missing/restored data and a real latch', () => {
    const { card, alert } = fixture([{ ...binding, clear_rule: 'latched' }]); expect(alert()).toBeTruthy();
    card._hass.states = { [binding.entity]: state('off', { restored: true }) }; card._syncMiniMap();
    expect(alert().getAttribute('aria-label')).toContain('stored reading'); expect(card._alertLatches[binding.id]).toBe(true);
    card._hass.states = {}; card._syncMiniMap(); expect(alert().getAttribute('aria-label')).toContain('Sensor missing'); expect(alert().getAttribute('aria-disabled')).toBe('true');
    card._hass.states = { [binding.entity]: state('off') }; card._acknowledgedAlerts = [binding.id]; card._syncMiniMap(); expect(alert()).toBeNull();
  });

  it.each(['source', 'connection', 'role', 'hidden', 'floor'])('rejects a held pointer across observed %s loss/recovery before the scheduled map update', (kind) => {
    const { card, alert, info } = fixture(); const old = alert(); expect(old).toBeTruthy(); pointer(old, 'pointerdown');
    const original = card._hass.states[binding.entity];
    if (kind === 'source') delete card._hass.states[binding.entity];
    if (kind === 'connection') card._hass.connection.connected = false;
    if (kind === 'role') card._hass.user.is_admin = true;
    if (kind === 'hidden') card._hass.entities[binding.entity] = { hidden: true };
    if (kind === 'floor') card._floors[1].stale = true;
    card.hass = card._hass;
    if (kind === 'source') card._hass.states[binding.entity] = original;
    if (kind === 'connection') card._hass.connection.connected = true;
    if (kind === 'role') card._hass.user.is_admin = false;
    if (kind === 'hidden') delete card._hass.entities[binding.entity];
    if (kind === 'floor') delete card._floors[1].stale;
    card.hass = card._hass; pointer(old, 'pointerup'); click(old); expect(info).not.toHaveBeenCalled(); expect(card._focusPlan).not.toHaveBeenCalled();
    card._syncMiniMap(); const fresh = alert(); pointer(fresh, 'pointerdown'); pointer(fresh, 'pointerup'); click(fresh); expect(info).toHaveBeenCalledOnce();
  });

  it.each(['Enter', ' '])('keeps a held %s fenced across source recovery while language changes retain fresh focus', (value) => {
    const { card, map, alert, info } = fixture(); const old = alert(); expect(old).toBeTruthy(); key(old, 'keydown', value);
    const original = card._hass.states[binding.entity]; delete card._hass.states[binding.entity]; card.hass = card._hass;
    card._hass.states[binding.entity] = original; card.hass = card._hass; key(old, 'keyup', value); expect(info).not.toHaveBeenCalled();
    card._syncMiniMap(); const fresh = alert(); fresh.focus(); card._hass.locale = { language: 'fr' }; card._syncMiniMap();
    expect(alert()).toBe(fresh); expect(document.activeElement).toBe(fresh); expect(map.scene.markers.find((marker) => marker.alert).entityId).toBe(binding.entity);
    key(fresh, 'keydown', value); key(fresh, 'keyup', value); expect(info).toHaveBeenCalledOnce();
  });

  it('rejects an old binding ID relinked to another source, an ambiguous binding and a removed floor', () => {
    const { card, alert, info } = fixture(); const old = alert(); expect(old).toBeTruthy(); pointer(old, 'pointerdown');
    card._layout.alert_bindings[0].entity = 'binary_sensor.other'; card._hass.states['binary_sensor.other'] = state(); card._syncMiniMap();
    pointer(old, 'pointerup'); click(old); expect(info).not.toHaveBeenCalled();
    card._layout.alert_bindings.push({ ...card._layout.alert_bindings[0], enabled: false }); card._syncMiniMap(); expect(alert()).toBeNull();
    card._layout.alert_bindings.pop(); card._floors = [floors[0]]; card._syncMiniMap(); expect(alert()).toBeNull();
  });

  it('rechecks an in-place confirmed clear immediately before native info and leaves normal idle work unchanged', () => {
    const { card, alert, info } = fixture(); const old = alert(); expect(old).toBeTruthy();
    card._hass.states[binding.entity].state = 'off'; click(old); expect(info).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._view.dirty).toBeUndefined();
  });

  it('rejects a held exact-marker alert after observed anchor loss/recovery and refuses a current duplicate', () => {
    const { card, alert, info } = fixture([{ ...binding, location_mode: 'marker', position_key: 'marker:chosen' }]);
    let anchors = [{ id: 'marker:chosen', position: { x: 2, y: 3, z: .7, floorId: 'upper', shown: true } }];
    card.trackingAnchors = () => anchors; card._statusRefs = null; card._syncMiniMap();
    const old = alert(); expect(old).toBeTruthy(); pointer(old, 'pointerdown');
    const original = anchors; anchors = []; card.hass = card._hass; anchors = original; card.hass = card._hass;
    pointer(old, 'pointerup'); click(old); expect(info).not.toHaveBeenCalled();
    card._syncMiniMap(); const fresh = alert(); expect(fresh).toBeTruthy();
    anchors = [original[0], { ...original[0], position: { ...original[0].position, x: 99 } }];
    click(fresh); expect(info).not.toHaveBeenCalled(); card._syncMiniMap(); expect(alert()).toBeNull();
  });

  it('keeps a focused alert through ordinary reading/name/language changes and skips unchanged status work', () => {
    const { card, alert, info } = fixture(); const original = alert(); original.focus();
    const calls = card._statusOverlays.setData.mock.calls.length; card._syncMiniMap();
    expect(card._statusOverlays.setData).toHaveBeenCalledTimes(calls); expect(alert()).toBe(original);
    card._hass.states[binding.entity].state = 'unknown'; card._hass.states[binding.entity].attributes.friendly_name = 'Renamed leak';
    card._hass.locale = { language: 'de' }; card._syncMiniMap();
    expect(alert()).toBe(original); expect(document.activeElement).toBe(original);
    expect(original.getAttribute('aria-label')).toContain('Renamed leak: Sensor nicht verfügbar');
    pointer(original, 'pointerdown'); pointer(original, 'pointerup'); click(original); expect(info).toHaveBeenCalledOnce();
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._view.dirty).toBeUndefined();
  });
});
