import { describe, expect, it, vi } from 'vitest';
import { buildMarkerOverview, markerActivity, markerDisplayMode, roomOverviewAnchor } from '../src/marker-overview.js';
import { pointInPolygon } from '../src/placement.js';

const room = (id = 'lounge', floorId = 'ground', polygon = [[0, 0], [4, 0], [4, 4], [0, 4]]) =>
  ({ room: { id, area_id: id, polygon }, name: id, floorId });
const marker = (id = 'light.lamp', areaId = 'lounge', extras = []) =>
  ({ id: `entity:${id}`, entityId: id, areaId, entities: [id, ...extras] });
const fixture = () => ({ mode: 'rooms', rooms: [room()], markers: [marker()], positions: new Map([['entity:light.lamp', { x: 2, y: 2, floorId: 'ground', auto: true }]]),
  hass: { user: { id: 'user' }, connection: { connected: true }, entities: {}, devices: {}, states: { 'light.lamp': { state: 'on', attributes: {} } } } });

describe('room-first overview uses exact current sources', () => {
  it('preserves original display by default and falls back from unsupported modes', () => {
    expect(markerDisplayMode(undefined)).toBe('all'); expect(markerDisplayMode('future')).toBe('all');
    const input = fixture(); delete input.mode;
    const out = buildMarkerOverview(input); expect(out.rooms).toEqual([]); expect(out.markers.get('entity:light.lamp').keep).toBe(true);
  });
  it('replaces a room’s markers with one truthful room summary and exposes a selected room', () => {
    const input = fixture(), out = buildMarkerOverview(input);
    expect(out.rooms).toMatchObject([{ roomId: 'lounge', x: 2, y: 2, summary: 'Lights on: 1' }]);
    expect(out.markers.get('entity:light.lamp')).toMatchObject({ roomId: 'lounge', keep: false });
    expect(buildMarkerOverview({ ...input, selectedRoomId: 'lounge' }).markers.get('entity:light.lamp').keep).toBe(true);
    expect(buildMarkerOverview({ ...input, selectedRoomId: 'old-room' }).selectedRoomId).toBeNull();
  });
  it('shows off and unknown light counts honestly rather than using old active state', () => {
    const input = fixture(); input.hass.states['light.lamp'].state = 'off';
    expect(buildMarkerOverview(input).rooms[0].summary).toBe('Lights on: 0');
    input.hass.states['light.lamp'].state = 'unavailable';
    expect(buildMarkerOverview(input).rooms[0].summary).toBe('Lights on: 0 · 1 unknown');
    input.hass.connection.connected = false;
    expect(buildMarkerOverview(input).rooms[0].summary).toBe('Waiting for Home Assistant');
  });
  it('counts grouped lights as entities, deduplicates sources and includes explicitly supplied bound devices', () => {
    const input = fixture(); input.hass.states['light.group'] = { state: 'on', attributes: { entity_id: ['light.a', 'light.b'] } };
    input.summaryMarkers = [...input.markers, marker('light.group'), marker('light.group')];
    const out = buildMarkerOverview(input);
    expect(out.rooms[0].summary).toBe('Lights on: 2'); expect(out.rooms[0].detail).toContain('groups');
  });
  it('does not invent a temperature or copy a thermostat target into the summary', () => {
    const input = fixture(); input.markers = [marker('climate.lounge')];
    input.hass.states['climate.lounge'] = { state: 'heat', attributes: { temperature: 25 } };
    expect(buildMarkerOverview(input).rooms[0].summary).toBe('Open room');
  });
  it('uses actual source position for pins, keeping outdoor/unassigned markers accessible', () => {
    const input = fixture(); input.positions.set('entity:light.lamp', { x: 9, y: 9, floorId: 'ground', auto: false });
    const out = buildMarkerOverview(input);
    expect(out.markers.get('entity:light.lamp')).toMatchObject({ roomId: null, keep: true });
    expect(out.rooms[0].summary).toBe('Open room');
  });
  it('does not assign a different floor or ambiguously linked area', () => {
    const input = fixture(); input.positions.set('entity:light.lamp', { x: 2, y: 2, floorId: 'upper', auto: true });
    expect(buildMarkerOverview(input).markers.get('entity:light.lamp')).toMatchObject({ roomId: null, keep: true });
    input.positions.clear(); input.rooms.push({ ...room('other'), room: { ...room('other').room, area_id: 'lounge' } });
    expect(buildMarkerOverview(input).markers.get('entity:light.lamp').keep).toBe(true);
  });
  it('does not hide devices when their room has no usable outline or has duplicate identifiers', () => {
    const input = fixture(); input.rooms[0].room.polygon = [];
    expect(buildMarkerOverview(input).rooms).toEqual([]); expect(buildMarkerOverview(input).markers.get('entity:light.lamp').keep).toBe(true);
    input.rooms = [room(), room()]; expect(buildMarkerOverview(input).rooms).toEqual([]);
    expect(buildMarkerOverview(input).markers.get('entity:light.lamp').keep).toBe(true);
  });
  it('does not create summaries for hidden rooms', () => {
    const input = fixture(); input.rooms[0].shown = false;
    expect(buildMarkerOverview(input).rooms).toEqual([]);
  });
  it('distinguishes a linked lower-floor device from a truly unassigned device in an overview', () => {
    const input = fixture(); input.allRooms = input.rooms; input.rooms = [room('office','upper')];
    input.allRooms = [...input.allRooms,...input.rooms];
    const out = buildMarkerOverview(input);
    expect(out.markers.get('entity:light.lamp')).toMatchObject({roomId:'lounge',keep:false});
    expect(out.rooms.map((entry) => entry.roomId)).toEqual(['office']);
    input.markers.push(marker('camera.unassigned','missing'));expect(buildMarkerOverview(input).markers.get('entity:camera.unassigned').keep).toBe(true);
  });
  it('prefers the smallest actual containing room over a surrounding garden outline', () => {
    const input = fixture(); input.rooms.unshift(room('garden', 'ground', [[-5,-5],[20,-5],[20,20],[-5,20]]));
    expect(buildMarkerOverview(input).markers.get('entity:light.lamp').roomId).toBe('lounge');
  });
  it('reveals all existing markers during editing without producing room summary chips', () => {
    const input = fixture();
    for (const mode of ['rooms', 'important']) {
      const out = buildMarkerOverview({ ...input, mode, editing: true });
      expect(out.rooms).toEqual([]); expect(out.markers.get('entity:light.lamp').keep).toBe(true);
    }
  });
  it('uses translated captions and treats names as source text', () => {
    const input = fixture(); input.hass.language = 'fr'; input.rooms[0].name = '<img src=x onerror=alert(1)>';
    const out = buildMarkerOverview(input); expect(out.rooms[0].summary).toContain('Lumières allumées');
    expect(out.rooms[0].name).toBe(input.rooms[0].name);
  });
  it('leaves all supplied source objects and service callbacks unchanged', () => {
    const input = fixture(), before = structuredClone(input); input.hass.callService = vi.fn();
    buildMarkerOverview(input); expect(input.hass.callService).not.toHaveBeenCalled(); delete input.hass.callService; expect(input).toEqual(before);
  });
});

describe('important marker evidence and alert retention', () => {
  it.each([
    ['light.lamp','on',{},false,true], ['switch.plug','on',{},false,true], ['fan.extractor','on',{},false,true],
    ['media_player.music','playing',{},false,true], ['cover.blind','opening',{},false,true], ['vacuum.robot','returning',{},false,true],
    ['lawn_mower.robot','mowing',{},false,true], ['binary_sensor.motion','on',{device_class:'motion'},false,true],
    ['binary_sensor.smoke','on',{device_class:'smoke'},true,false], ['binary_sensor.leak','on',{device_class:'moisture'},true,false],
    ['binary_sensor.window','on',{device_class:'window'},true,false], ['lock.front','unlocked',{},true,false],
    ['alarm_control_panel.home','triggered',{},true,false], ['climate.lounge','auto',{},false,false],
    ['sensor.watts','3000',{device_class:'power'},false,false], ['camera.front','streaming',{},false,false],
    ['light.lamp','off',{},false,false], ['binary_sensor.smoke','unavailable',{device_class:'smoke'},false,false],
  ])('%s %s has explicit alert/activity status', (id, state, attributes, alert, active) => {
    const input = fixture(); input.hass.states = { [id]: { state, attributes } };
    const source = marker(id); expect(markerActivity(input.hass, source)).toEqual({ alert, active });
    expect(buildMarkerOverview({ ...input, mode:'important', markers:[source] }).markers.get(source.id).keep).toBe(alert || active);
  });
  it('retains active configured latched alerts even when their primary state becomes unavailable', () => {
    const input = fixture(); input.markers = [marker('sensor.custom')]; input.hass.states['sensor.custom'] = { state: 'unavailable', attributes: {} };
    for (const mode of ['rooms','important']) expect(buildMarkerOverview({ ...input, mode, alerts: [{ entity:'sensor.custom', active:true }] })
      .markers.get('entity:sensor.custom')).toMatchObject({ keep:true, alert:true });
  });
  it('recognises safety evidence in secondary entities of a grouped device', () => {
    const input = fixture(), source = marker('light.lamp','lounge',['binary_sensor.leak']);
    input.hass.states['binary_sensor.leak'] = { state:'on',attributes:{device_class:'moisture'} };
    expect(buildMarkerOverview({ ...input, markers:[source] }).markers.get(source.id)).toMatchObject({ keep:true, alert:true });
  });
  it('does not treat restored or disconnected cached readings as current activity', () => {
    const input = fixture(); input.hass.states['light.lamp'].attributes.restored = true;
    expect(markerActivity(input.hass,input.markers[0]).active).toBe(false);
    input.hass.states['light.lamp'].attributes.restored = false; input.hass.connection.connected = false;
    expect(markerActivity(input.hass,input.markers[0]).active).toBe(false);
  });
});

describe('actual outline anchors', () => {
  it('places a label inside a concave outline even when its centroid is outside', () => {
    const polygon = [[0,0],[6,0],[6,1],[1,1],[1,6],[0,6]], anchor = roomOverviewAnchor(polygon);
    expect(anchor).not.toBeNull(); expect(pointInPolygon(anchor,polygon)).toBe(true);
  });
  it.each([null, [], [[0,0],[1,1],[2,2]], [[0,0],[Infinity,0],[0,1]], [[0,'0'],[1,0],[0,1]]])('rejects unusable outlines', (polygon) => {
    expect(roomOverviewAnchor(polygon)).toBeNull();
  });
});
