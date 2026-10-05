// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityAreaFilter } from '../src/entity-area-filter.js';
import { ScenePreviewEditor } from '../src/scene-preview-editor.js';
import { RoomActionsEditor } from '../src/room-actions-editor.js';
import { WeatherEditor } from '../src/weather-editor.js';
import { HouseSummaryEditor } from '../src/house-summary-editor.js';

const fixtures = [];
const specifications = [
  { name: 'Scenes', Editor: ScenePreviewEditor, prefix: 'scene-preview-', selector: 'new-light', domain: 'light', source: 'scene-entity', sourceDomain: 'scene', rawKey: 'scene_previews', raw: { enabled: true, items: [{ id: 'evening', scene_entity: 'scene.lounge', label: 'Evening', lights: [{ entity: 'light.lounge', state: 'on' }] }] } },
  { name: 'Room shortcuts', Editor: RoomActionsEditor, prefix: 'room-actions-', selector: 'new-source', domain: 'scene', source: 'source', sourceDomain: 'scene', rawKey: 'room_actions', raw: { version: 1, rooms: [{ room_id: 'room:one', actions: [{ id: 'evening', entity: 'scene.lounge', label: 'Evening' }] }] } },
  { name: 'Environment', Editor: WeatherEditor, prefix: 'env-weather-', selector: 'entity', domain: 'weather', source: 'entity', sourceDomain: 'weather', rawKey: 'weather', raw: { enabled: false, entity: 'weather.lounge', intensity: 0.6, quality: 'off', effects: [] } },
  { name: 'House', Editor: HouseSummaryEditor, prefix: 'house-summary-', selector: 'new-person', domain: 'person', source: 'weather_entity', sourceDomain: 'weather', rawKey: 'house_summary', raw: { title: 'A home', weather_entity: 'weather.lounge', person_entities: ['person.lounge'] } },
];
function setup(specification) {
  const host = document.createElement('div'); document.body.append(host);
  const states = {}, entities = {};
  for (const domain of ['scene', 'script', 'light', 'weather', 'person']) for (const room of ['lounge', 'garden', 'unassigned', 'hidden', 'diagnostic']) {
    const id = `${domain}.${room}`;
    states[id] = { entity_id: id, state: domain === 'scene' ? 'unknown' : domain === 'script' ? 'off' : domain === 'weather' ? 'sunny' : domain === 'person' ? 'home' : 'on',
      attributes: { friendly_name: `${domain} ${room}`, supported_color_modes: ['onoff'], color_mode: 'onoff' } };
    entities[id] = { entity_id: id, device_id: room === 'lounge' ? 'shared' : null, area_id: room === 'garden' ? 'garden' : null,
      hidden_by: room === 'hidden' ? 'user' : null, entity_category: room === 'diagnostic' ? 'diagnostic' : null };
  }
  const card = { isConnected: true, _editing: true, _loading: false, _edit: { tab: specification.name === 'Room shortcuts' ? 'rooms' : 'settings', _generation: 1 },
    _config: { layout_key: 'home' }, _layout: { [specification.rawKey]: structuredClone(specification.raw) },
    _view: { model: null }, _floors: [{ id: 'ground', elevation: 0 }], _roomList: [{ floorId: 'ground', room: { id: 'room:one', floor_id: 'ground', polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] } }],
    _hass: { states, entities, devices: { shared: { id: 'shared', area_id: 'lounge' } }, areas: { lounge: { area_id: 'lounge', name: 'Lounge' }, garden: { area_id: 'garden', name: 'Garden' } }, floors: {},
      user: { id: 'owner', is_admin: true, is_active: true }, connection: { connected: true }, auth: {}, services: { scene: { turn_on: {} }, script: { turn_on: {} } },
      callService: vi.fn(), callWS: vi.fn() }, commitFeatureLayout: vi.fn(), previewSceneLights: vi.fn() };
  card._edit.panel = host;
  const editor = new specification.Editor(card, () => render());
  const render = () => { host.innerHTML = editor.render(); editor.updatePreviews(host); };
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  const field = (name) => host.querySelector(`[data-field="${specification.prefix}${name}"]`);
  const change = (name, value) => { const node = field(name); expect(node).toBeTruthy(); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); return node; };
  render();
  if (specification.name === 'Scenes') change('binding', '0');
  if (specification.name === 'Room shortcuts') change('room', 'room:one');
  const before = structuredClone(card._layout);
  fixtures.push({ editor, host }); return { card, editor, host, field, change, before };
}
const values = (node) => [...node.options].map((option) => option.value);
afterEach(() => { fixtures.splice(0).forEach(({ editor, host }) => { editor.dispose(); host.remove(); }); });

describe.each(specifications)('$name actual area picker', (specification) => {
  it('filters by exact HA area, follows inherited device areas and retains saved choices', () => {
    const { field, change, card, before } = setup(specification);
    change('area-filter', 'area:garden');
    expect(values(field(specification.selector))).toContain(`${specification.domain}.garden`);
    if (specification.selector !== specification.source) expect(values(field(specification.selector))).not.toContain(`${specification.domain}.lounge`);
    expect(values(field(specification.source))).toContain(`${specification.sourceDomain}.lounge`);
    expect([...field(specification.source).options].find((option) => option.value === `${specification.sourceDomain}.lounge`).disabled).toBe(false);
    change('area-filter', 'area:lounge'); expect(values(field(specification.selector))).toContain(`${specification.domain}.lounge`);
    expect(values(field(specification.selector))).not.toContain(`${specification.domain}.garden`);
    expect(card._layout).toEqual(before); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps unassigned separate from hidden and diagnostic choices', () => {
    const { field, change } = setup(specification); change('area-filter', 'unassigned');
    expect(values(field(specification.selector))).toContain(`${specification.domain}.unassigned`);
    expect(values(field(specification.selector))).not.toContain(`${specification.domain}.hidden`);
    expect(values(field(specification.selector))).not.toContain(`${specification.domain}.diagnostic`);
    expect(values(field(specification.selector))).not.toContain(`${specification.domain}.garden`);
  });
  it('updates names and translations without replacing the focused filter or saved draft', () => {
    const { card, editor, host, field, change, before } = setup(specification);
    const filter = change('area-filter', 'area:garden'), option = [...filter.options].find((item) => item.value === 'area:garden'); filter.focus();
    const draft = JSON.stringify(editor.draft);
    card._hass.areas.garden.name = 'Garden <outside>'; card._hass.language = 'de'; editor.updatePreviews(host);
    expect(field('area-filter')).toBe(filter); expect(document.activeElement).toBe(filter);
    expect([...filter.options].find((item) => item.value === 'area:garden')).toBe(option); expect(option.textContent).toBe('Garden <outside>');
    expect(host.querySelector('[data-entity-area-label]').textContent).toBe('Geräte nach Home-Assistant-Bereich filtern');
    expect(JSON.stringify(editor.draft)).toBe(draft); expect(card._layout).toEqual(before); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('keeps a deleted selected filter explicit and offers no guessed replacement', () => {
    const { card, editor, host, field, change } = setup(specification); change('area-filter', 'area:garden'); delete card._hass.areas.garden; editor.updatePreviews(host);
    const filter = field('area-filter'); expect(filter.value).toBe('area:garden'); expect(filter.selectedOptions[0].disabled).toBe(true);
    expect(values(field(specification.selector))).not.toContain(`${specification.domain}.garden`);
    change('area-filter', 'all'); expect(values(field(specification.selector))).toContain(`${specification.domain}.garden`);
  });
  it('retains typed drafts and their original field when browsing another area', () => {
    const { card, editor, field, change, before } = setup(specification);
    const name = specification.name === 'Environment' ? 'intensity' : specification.name === 'House' ? 'title' : 'label';
    const node = change(name, specification.name === 'Environment' ? '0.35' : 'My unfinished edit');
    node.focus(); const draft = JSON.stringify(editor.draft); expect(editor.dirty).toBe(true);
    change('area-filter', 'area:garden'); expect(field(name)).toBe(node); expect(document.activeElement).toBe(node);
    expect(JSON.stringify(editor.draft)).toBe(draft); expect(editor.dirty).toBe(true); expect(editor.stale === true).toBe(false);
    expect(card._layout).toEqual(before); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('rejects a forged current entity outside the filter without changing the saved source', () => {
    const { card, editor, field, change, before } = setup(specification); change('area-filter', 'area:garden');
    const draft = JSON.stringify(editor.draft), node = field(specification.source), option = document.createElement('option');
    option.value = `${specification.sourceDomain}.unassigned`; node.append(option); node.value = option.value; node.dispatchEvent(new Event('change', { bubbles: true }));
    expect(JSON.stringify(editor.draft)).toBe(draft); expect(card._layout).toEqual(before); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
});

describe('area filter data boundaries', () => {
  it('clears a pending room-source choice without poisoning a separately typed shortcut label', () => {
    const { editor, change, field } = setup(specifications[1]); change('label', 'My unfinished label'); change('new-source', 'script.garden');
    expect(editor.newSource).toBe('script.garden'); expect(editor.stale).toBe(false);
    change('area-filter', 'area:lounge'); expect(editor.newSource).toBe(''); expect(editor.stale).toBe(false);
    expect(field('label').value).toBe('My unfinished label'); expect(editor.dirty).toBe(true);
  });
  it('does not execute registry accessors or coerce area labels', () => {
    const read = vi.fn(() => { throw Error('must not run'); }), filter = new EntityAreaFilter();
    const hass = { entities: {}, devices: {}, areas: { normal: { name: { toString: read } } } };
    Object.defineProperty(hass.areas, 'hostile', { enumerable: true, get: read });
    expect(filter.options(hass).map((option) => option.label)).toContain('normal'); expect(read).not.toHaveBeenCalled();
    expect(filter.set(hass, 'area:hostile')).toBe(false); expect(filter.value).toBe('all');
  });
  it('does not call incomplete registries unassigned or accept a forged filter', () => {
    const filter = new EntityAreaFilter(), hass = { areas: { garden: { name: 'Garden' } } };
    expect(filter.options(hass).find((option) => option.value === 'unassigned').disabled).toBe(true);
    expect(filter.set(hass, 'unassigned')).toBe(false); expect(filter.set(hass, 'area:invented')).toBe(false);
    expect(filter.choices(hass, [{ value: 'light.one', areaId: null }])).toHaveLength(1);
  });
  it.each(['de', 'fr', 'es'])('renders %s with literal area names and no network action', (language) => {
    const filter = new EntityAreaFilter(); const html = filter.render({ language, entities: {}, devices: {}, areas: { exact: { name: '<Kitchen>' } } }, 'example-area-filter');
    expect(html).toContain('&lt;Kitchen&gt;'); expect(html).not.toContain('Filter devices by Home Assistant area'); expect(filter.value).toBe('all');
  });
});
