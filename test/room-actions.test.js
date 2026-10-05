import { describe, expect, it, vi } from 'vitest';
import { readRoomActions, replaceRoomActions, roomActionsFor, roomActionAvailability } from '../src/room-actions.js';

const room = { id: 'm:user-room', floor_id: 'ground', area_id: 'office' };
const settings = () => ({ version: 1, future: 'root-extra', rooms: [{ room_id: room.id, future: 'room-extra',
  actions: [{ id: 'movie', entity: 'scene.actual_movie', label: 'My movie <literal>', future: 'action-extra' }] },
{ room_id: 'another-room', actions: [{ id: 'run', entity: 'script.actual_script' }], other: { kept: true } }] });
const hass = () => ({ user: { id: 'current', is_active: true }, connection: { connected: true },
  services: { scene: { turn_on: {} }, script: { turn_on: {} } }, callService: vi.fn(),
  entities: {}, devices: {}, states: { 'scene.actual_movie': { state: 'unknown', attributes: { friendly_name: 'Current scene' } },
    'script.actual_script': { state: 'off', attributes: {} } } });

describe('explicit room shortcuts', () => {
  it('reads a current exact room and an activatable unknown scene without any command or config mutation', () => {
    const h = hass(), raw = settings(), before = structuredClone(raw);
    const result = roomActionsFor({ hass: h, settings: raw, roomId: room.id, rooms: [room] });
    expect(result.actions).toEqual([{ id: 'movie', label: 'My movie <literal>', entityId: 'scene.actual_movie', domain: 'scene', service: 'turn_on', available: true, issue: '' }]);
    expect(raw).toEqual(before); expect(h.callService).not.toHaveBeenCalled();
  });
  it.each([[], [room, { ...room }]])('does not substitute a missing or duplicate current room', (rooms) => {
    expect(roomActionsFor({ hass: hass(), settings: settings(), roomId: room.id, rooms }).actions).toEqual([]);
  });
  it('retains invalid/duplicate action data but cannot advertise a runnable substitute', () => {
    const raw = settings(); raw.rooms[0].actions.push({ ...raw.rooms[0].actions[0] }, { id: 'unlock', entity: 'lock.front_door', service: 'unlock' });
    const result = roomActionsFor({ hass: hass(), settings: raw, roomId: room.id, rooms: [room] });
    expect(result.actions).toEqual([]); expect(result.diagnostics).toHaveLength(3); expect(raw.rooms[0].actions).toHaveLength(3);
  });
  it.each(['restored', 'unavailable', 'hidden', 'disconnected', 'service'])('withholds an action after current %s evidence', (kind) => {
    const h = hass();
    if (kind === 'restored') h.states['scene.actual_movie'].attributes.restored = true;
    if (kind === 'unavailable') h.states['scene.actual_movie'].state = 'unavailable';
    if (kind === 'hidden') h.entities['scene.actual_movie'] = { hidden_by: 'user' };
    if (kind === 'disconnected') h.connection.connected = false;
    if (kind === 'service') delete h.services.scene.turn_on;
    expect(roomActionsFor({ hass: h, settings: settings(), roomId: room.id, rooms: [room] }).actions[0].available).toBe(false);
    expect(h.callService).not.toHaveBeenCalled();
  });
  it('keeps locale and ordinary scene activation readings outside held action ownership but includes source loss', () => {
    const h = hass(), options = { hass: h, settings: settings(), roomId: room.id, rooms: [room] };
    const before = roomActionsFor(options).contextKey;
    h.locale = { language: 'de' }; h.states['scene.actual_movie'].state = '2026-10-05T12:00:00Z';
    expect(roomActionsFor(options).contextKey).toBe(before);
    h.states['scene.actual_movie'].state = 'unavailable'; expect(roomActionsFor(options).contextKey).not.toBe(before);
  });
  it('requires actual current script state and advertised service', () => {
    const h = hass(); expect(roomActionAvailability(h, 'script.actual_script').available).toBe(true);
    h.states['script.actual_script'].attributes.restored = true; expect(roomActionAvailability(h, 'script.actual_script').available).toBe(false);
    expect(roomActionAvailability(h, 'script.missing').available).toBe(false); expect(roomActionAvailability(h, 'light.lamp').available).toBe(false);
  });
  it('makes an exact selected-room edit and preserves unrelated/future raw data and source references', () => {
    const raw = settings(), old = structuredClone(raw), actions = [{ ...raw.rooms[0].actions[0], label: 'Changed' }];
    const next = replaceRoomActions(raw, room.id, actions);
    expect(raw).toEqual(old); expect(next.future).toBe('root-extra'); expect(next.rooms[0].future).toBe('room-extra');
    expect(next.rooms[0].actions[0].future).toBe('action-extra'); expect(next.rooms[1]).toBe(raw.rooms[1]);
    expect(next.rooms[0].actions[0].label).toBe('Changed');
  });
  it('refuses unknown envelope/duplicates/limits without silently repairing imported data', () => {
    const raw = settings(); raw.rooms.push({ ...raw.rooms[0] }); expect(readRoomActions(raw).valid).toBe(false);
    expect(replaceRoomActions(raw, room.id, [])).toBeNull();
    expect(readRoomActions({ version: 2, rooms: [], future: true }).valid).toBe(false);
    expect(replaceRoomActions(undefined, room.id, Array.from({ length: 13 }, () => ({})))).toBeNull();
  });
  it('never invokes imported getters or custom JSON hooks', () => {
    const getter = vi.fn(), hook = vi.fn();
    const raw = settings(); Object.defineProperty(raw, 'getter', { enumerable: true, get: getter });
    expect(readRoomActions(raw).valid).toBe(false); expect(getter).not.toHaveBeenCalled();
    const custom = { ...settings(), toJSON: hook }; expect(readRoomActions(custom).valid).toBe(false); expect(hook).not.toHaveBeenCalled();
  });
  it.each([
    [{ id: 'invalid id', entity: 'scene.actual_movie' }],
    [{ id: 'unlock', entity: 'lock.front_door' }],
    [{ id: 'movie', entity: 'scene.actual_movie', service: 'delete' }],
    [{ id: 'movie', entity: 'scene.actual_movie', label: 'x'.repeat(161) }],
    [{ id: 'movie', entity: 'scene.actual_movie' }, { id: 'movie', entity: 'script.actual_script' }],
  ])('refuses an invalid explicit replacement while leaving the original settings intact', (actions) => {
    const raw = settings(), before = structuredClone(raw);
    expect(replaceRoomActions(raw, room.id, actions)).toBeNull(); expect(raw).toEqual(before);
  });
  it('refuses an accessor in a replacement before copying it', () => {
    const getter = vi.fn(() => 'scene.actual_movie'), action = { id: 'movie' };
    Object.defineProperty(action, 'entity', { enumerable: true, get: getter });
    expect(replaceRoomActions(settings(), room.id, [action])).toBeNull(); expect(getter).not.toHaveBeenCalled();
  });
  it('can retain a valid exact missing reference for a deliberate label repair', () => {
    const raw = settings(); raw.rooms[0].actions[0].entity = 'scene.saved_missing';
    const next = replaceRoomActions(raw, room.id, [{ ...raw.rooms[0].actions[0], label: 'My saved action' }]);
    expect(next.rooms[0].actions[0]).toEqual({ ...raw.rooms[0].actions[0], label: 'My saved action' });
    expect(roomActionsFor({ hass: hass(), settings: next, roomId: room.id, rooms: [room] }).actions[0].available).toBe(false);
  });
});
