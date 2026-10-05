import { describe, expect, it, vi } from 'vitest';
import { buildRoomSummary, ROOM_SUMMARY_LIMITS } from '../src/room-summary.js';

const state = (entityId, value, attributes = {}) => ({ entity_id: entityId, state: value, attributes });
const fixture = () => ({ connection: { connected: true }, user: { id: 'current', is_active: true, is_admin: false },
  states: {}, entities: {}, devices: {}, callService: vi.fn() });
const read = (hass, entityIds) => buildRoomSummary({ hass, entityIds });
function add(hass, entityId, value, attributes = {}) { hass.states[entityId] = state(entityId, value, attributes); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

describe('actual selected room light and media entities', () => {
  it('counts only supplied exact current room membership and literal on/playing readings', () => {
    const hass = fixture();
    add(hass, 'light.on', 'on'); add(hass, 'light.off', 'off'); add(hass, 'light.other_room', 'on');
    add(hass, 'media_player.playing', 'playing'); add(hass, 'media_player.paused', 'paused'); add(hass, 'media_player.other_room', 'playing');
    add(hass, 'switch.named_light', 'on'); add(hass, 'sensor.player_activity', 'playing');
    expect(read(hass, ['light.on', 'light.off', 'media_player.playing', 'media_player.paused', 'switch.named_light', 'sensor.player_activity'])).toEqual({
      available: true, text: '1 light entity on · 1 media player playing',
      lights: { on: 1, total: 2, unknown: 0, groupsIncluded: false }, media: { playing: 1, total: 2, unknown: 0 },
    });
  });

  it('deduplicates source IDs and counts a HA light group once, never its physical member count', () => {
    const hass = fixture(); add(hass, 'light.room_group', 'on', { entity_id: ['light.member_a', 'light.member_b'] });
    add(hass, 'light.member_a', 'on'); add(hass, 'light.member_b', 'on');
    add(hass, 'media_player.tv', 'playing');
    const group = read(hass, ['light.room_group', 'light.room_group', 'media_player.tv', 'media_player.tv']);
    expect(group.lights).toEqual({ on: 1, total: 1, unknown: 0, groupsIncluded: true });
    expect(group.media).toEqual({ playing: 1, total: 1, unknown: 0 });
    expect(group.text).toContain('counts entities, not physical bulbs');
    const explicitMembers = read(hass, ['light.room_group', 'light.member_a', 'light.member_b']);
    expect(explicitMembers.lights.total).toBe(3); expect(explicitMembers.text).toContain('3 light entities');
  });

  it('uses explicit current group platform evidence without name inference', () => {
    const hass = fixture(); add(hass, 'light.registry_group', 'off'); hass.entities['light.registry_group'] = { platform: 'group' };
    add(hass, 'light.named_group', 'on', { friendly_name: 'Group of 12 bulbs', entity_id: 'light.fake' });
    expect(read(hass, ['light.registry_group']).lights.groupsIncluded).toBe(true);
    expect(read(hass, ['light.named_group']).lights.groupsIncluded).toBe(false);
  });

  it('does not invoke accessor member entries or treat sparse group metadata as confirmed group evidence', () => {
    const hass = fixture(), getter = vi.fn(() => { throw new Error('No member callbacks'); });
    const members = []; Object.defineProperty(members, '0', { get: getter });
    add(hass, 'light.one', 'on', { entity_id: members }); add(hass, 'light.sparse', 'on', { entity_id: new Array(2) });
    expect(read(hass, ['light.one', 'light.sparse']).lights).toEqual({ on: 2, total: 2, unknown: 0, groupsIncluded: false });
    expect(getter).not.toHaveBeenCalled();
  });

  it('retains unknown/unavailable current readings explicitly, never treating them as off or paused', () => {
    const hass = fixture();
    for (const domain of ['light', 'media_player']) for (const value of ['unknown', 'unavailable']) add(hass, `${domain}.${value}`, value);
    const result = read(hass, Object.keys(hass.states));
    expect(result.lights).toEqual({ on: 0, total: 2, unknown: 2, groupsIncluded: false });
    expect(result.media).toEqual({ playing: 0, total: 2, unknown: 2 });
    expect(result.text).toContain('2 light readings unknown'); expect(result.text).toContain('2 media readings unknown');
  });

  it('does not infer playing/on from truthy or arbitrary state strings', () => {
    const hass = fixture(); add(hass, 'light.true', 'true'); add(hass, 'light.uppercase', 'ON');
    add(hass, 'media_player.custom', 'movie'); add(hass, 'media_player.uppercase', 'Playing');
    expect(read(hass, Object.keys(hass.states))).toMatchObject({ lights: { on: 0, unknown: 2 }, media: { playing: 0, unknown: 2 } });
  });

  it.each(['paused', 'idle', 'off', 'on', 'standby', 'buffering'])('shows known media state %s as current but not playing', (value) => {
    const hass = fixture(); add(hass, 'media_player.tv', value);
    expect(read(hass, ['media_player.tv']).media).toEqual({ playing: 0, total: 1, unknown: 0 });
  });

  it('uses a clear singular uncertainty note and valid empty current membership', () => {
    const hass = fixture(); add(hass, 'light.one', 'unknown'); add(hass, 'media_player.one', 'unavailable');
    expect(read(hass, Object.keys(hass.states)).text).toContain('1 light reading unknown · 1 media reading unknown');
    expect(read(hass, [])).toEqual({ available: true, text: '0 light entities on · 0 media players playing', lights: { on: 0, total: 0, unknown: 0, groupsIncluded: false }, media: { playing: 0, total: 0, unknown: 0 } });
  });

  it('uses plural entity/player labels for two or more current positive readings', () => {
    const hass = fixture();
    for (const entityId of ['light.one', 'light.two']) add(hass, entityId, 'on');
    for (const entityId of ['media_player.one', 'media_player.two']) add(hass, entityId, 'playing');
    expect(read(hass, Object.keys(hass.states)).text).toBe('2 light entities on · 2 media players playing');
  });

  it.each([{ hidden: true }, { hidden_by: 'user' }, { disabled: true }, { disabled_by: 'integration' },
    { entity_category: 'diagnostic' }, { entity_category: 'config' }, { device_id: 'blocked' }])('rechecks shared metadata exclusions %j', (registry) => {
    const hass = fixture(); add(hass, 'light.excluded', 'on'); add(hass, 'media_player.excluded', 'playing');
    hass.entities['light.excluded'] = registry; hass.entities['media_player.excluded'] = registry; hass.devices.blocked = { disabled_by: 'user' };
    expect(read(hass, ['light.excluded', 'media_player.excluded'])).toMatchObject({ lights: { total: 0 }, media: { total: 0 } });
  });

  it('excludes no-state/restored sources, including registry-only entries', () => {
    const hass = fixture(); hass.entities['light.missing'] = { platform: 'group' }; add(hass, 'light.restored', 'on', { restored: true });
    add(hass, 'media_player.restored', 'playing', { restored: true }); add(hass, 'light.current', 'on', { restored: false });
    expect(read(hass, ['light.missing', 'light.restored', 'media_player.restored', 'light.current'])).toMatchObject({ lights: { on: 1, total: 1, unknown: 0, groupsIncluded: false }, media: { total: 0 } });
  });

  it('replaces source readings and membership rather than caching a room association', () => {
    const hass = fixture(); add(hass, 'light.one', 'on'); add(hass, 'light.two', 'on'); add(hass, 'media_player.tv', 'playing');
    const first = read(hass, ['light.one', 'media_player.tv']);
    hass.states['light.one'] = state('light.one', 'off'); hass.states['media_player.tv'] = state('media_player.tv', 'paused');
    expect(read(hass, ['light.one', 'media_player.tv'])).toMatchObject({ lights: { on: 0 }, media: { playing: 0 } });
    expect(read(hass, ['light.two']).lights).toMatchObject({ on: 1, total: 1 });
    delete hass.states['light.two']; expect(read(hass, ['light.two']).lights.total).toBe(0);
    expect(first).toMatchObject({ lights: { on: 1 }, media: { playing: 1 } });
  });
});

describe('current session, strict inputs and no side effects', () => {
  it.each([undefined, null, [], false, 'room', Object.create({ hass: fixture(), entityIds: [] })])('does not read unusable options %s', (options) => {
    expect(buildRoomSummary(options).available).toBe(false);
  });

  it.each([undefined, { connected: false }, { connected: 'true' }, { connected: null }])('does not claim current counts with connection %s', (connection) => {
    const hass = fixture(); add(hass, 'light.on', 'on'); hass.connection = connection;
    expect(read(hass, ['light.on'])).toMatchObject({ available: false, lights: { on: 0, total: 0 } });
  });

  it.each([undefined, {}, { id: '' }, { id: '   ' }, { id: 3 }, { id: 'one', is_active: false }, { id: 'one', is_active: null },
    { id: 'one', is_active: undefined }, { id: 'one', is_active: 'true' }])('rejects absent/inactive/malformed current user %s', (user) => {
    const hass = fixture(); add(hass, 'light.on', 'on'); hass.user = user;
    expect(read(hass, ['light.on']).available).toBe(false);
  });

  it('supports nonadmin and older actual user shapes plus an actual connection getter', () => {
    class Connection { get connected() { return this.ready; } }
    const hass = fixture(); add(hass, 'light.on', 'on'); hass.user = { id: 'one', is_admin: false }; hass.connection = new Connection(); hass.connection.ready = true;
    expect(read(hass, ['light.on'])).toMatchObject({ available: true, lights: { on: 1 } });
    hass.connection.ready = false; expect(read(hass, ['light.on']).available).toBe(false);
    hass.connection.ready = true; hass.user = { id: 'new-user', is_active: false }; expect(read(hass, ['light.on']).available).toBe(false);
  });

  it.each([undefined, null, false, 'light.one', {}, ['light.one', null], [' light.one'], ['__proto__'], ['light.<bad>']])('rejects malformed supplied membership %s without partial counts', (entityIds) => {
    const hass = fixture(); add(hass, 'light.one', 'on');
    const result = read(hass, entityIds); expect(result.available).toBe(false); expect(result.lights.total).toBe(0); expect(result.text).toContain('Room summary');
  });

  it('rejects sparse/getter membership and does not execute user record/state/registry callbacks', () => {
    const hass = fixture(), getter = vi.fn(() => { throw new Error('No callbacks'); }); add(hass, 'light.good', 'on');
    const sparse = new Array(1); expect(read(hass, sparse).available).toBe(false);
    const ids = []; Object.defineProperty(ids, '0', { get: getter }); expect(read(hass, ids).available).toBe(false);
    hass.states['light.getter'] = { attributes: {} }; Object.defineProperty(hass.states['light.getter'], 'state', { get: getter });
    add(hass, 'light.registry', 'on'); hass.entities['light.registry'] = {}; Object.defineProperty(hass.entities['light.registry'], 'hidden', { get: getter });
    add(hass, 'light.device', 'on'); hass.entities['light.device'] = { device_id: 'bad' }; hass.devices.bad = {}; Object.defineProperty(hass.devices.bad, 'disabled_by', { get: getter });
    expect(read(hass, ['light.good', 'light.getter', 'light.registry', 'light.device']).lights).toMatchObject({ on: 1, total: 1 });
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects malformed/inherited/restored snapshots and mismatched current source identities', () => {
    const hass = fixture(); add(hass, 'light.good', 'on');
    hass.states['light.inherited'] = Object.create({ state: 'on', attributes: {} }); hass.states['light.bad_id'] = state('light.other', 'on');
    hass.states['light.value'] = state('light.value', true); hass.states['light.attributes'] = state('light.attributes', 'on', []);
    add(hass, 'light.restored', 'on', { restored: 'false' });
    expect(read(hass, Object.keys(hass.states)).lights).toMatchObject({ on: 1, total: 1 });
  });

  it.each(['states', 'entities', 'devices'])('rejects a malformed %s dictionary as a whole', (key) => {
    const hass = fixture(); add(hass, 'light.one', 'on'); hass[key] = Object.create({ 'light.other': state('light.other', 'on') });
    expect(read(hass, ['light.one'])).toMatchObject({ available: false, text: expect.stringContaining('could not be read'), lights: { total: 0 } });
  });

  it('accepts legitimate null-prototype dictionaries and no registry when HA supplies state only', () => {
    const hass = fixture(); hass.states = Object.create(null); delete hass.entities; delete hass.devices; add(hass, 'light.one', 'on');
    expect(read(hass, ['light.one'])).toMatchObject({ available: true, lights: { on: 1, total: 1 } });
  });

  it('fails more than 512 supplied IDs as a whole, even when duplicates would deduplicate later', () => {
    const hass = fixture(); add(hass, 'light.one', 'on');
    const valid = Array.from({ length: ROOM_SUMMARY_LIMITS.entities }, () => 'light.one');
    expect(read(hass, valid).lights.total).toBe(1);
    const over = read(hass, [...valid, 'light.one']); expect(over).toMatchObject({ available: false, lights: { total: 0 } });
    expect(over.text).toContain('at most 512'); expect(over.text).toContain('no partial count');
  });

  it('preserves caller arrays/readings and has no clock, DOM, formatters or HA actions', () => {
    const hass = fixture(); add(hass, 'light.one', 'on'); hass.formatEntityName = vi.fn(() => { throw new Error('No formatter'); });
    const ids = freeze(['light.one']); freeze(hass); const before = JSON.stringify({ hass, ids });
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('No clock'); });
    try {
      const result = read(hass, ids); result.lights.on = 99;
      expect(read(hass, ids).lights.on).toBe(1); expect(JSON.stringify({ hass, ids })).toBe(before);
      expect(hass.callService).not.toHaveBeenCalled(); expect(hass.formatEntityName).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
});
