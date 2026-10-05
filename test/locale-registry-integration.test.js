// @vitest-environment jsdom
// Real root hass setter/scheduled update/registry signature, actual marker and
// popup/editor DOM. Only WebGL and unrelated feature stages are substituted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';
import { DevicePopup } from '../src/device-popup.js';
import { EditMode } from '../src/edit-mode.js';

const fixtures = [];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const input = (node) => node.dispatchEvent(new Event('input', { bubbles: true }));

async function fixture() {
  const card = document.createElement('taylors3d-card');
  // The connected callback has no config yet, so it cannot create WebGL.
  document.body.append(card);
  const stage = document.createElement('div'), scene = document.createElement('div');
  stage.append(scene); card.shadowRoot.append(stage);
  stage.getBoundingClientRect = () => ({ width: 700, height: 500, left: 0, top: 0 });
  card._stage = stage; card._scene = scene;
  card._config = { layout_style: 'original', layout_key: 'locale-root-proof', group_by: 'device' };
  card._layout = { version: 1, floors: [{ id: 'ground', elevation: 0, height: 3 }],
    rooms: [{ id: 'office', area_id: 'office', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], doors: [] }],
    pins: {}, hidden: [], model: {}, mower: null, objects: {}, groups: {}, views: {} };
  card._loading = false; card._editing = false; card._floor = 'ground'; card._mode = 'top';
  card._floors = [{ id: 'ground', name: 'User_Floor', elevation: 0, height: 3 }];
  card._roomList = [{ room: card._layout.rooms[0], name: 'User_Room', floorId: 'ground' }];
  card._store = { backend: 'browser', save: vi.fn().mockResolvedValue(true) };
  const h = { user: { id: 'current', is_admin: true, is_active: true }, connection: { connected: true },
    language: 'en', locale: { language: 'en', number_format: 'language' }, themes: {},
    states: { 'light.current': { entity_id: 'light.current', state: 'on', attributes: { friendly_name: 'User_Lamp',
      brightness: 128, supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: [12, 34, 56] } },
    'sensor.secondary': { entity_id: 'sensor.secondary', state: '12.345', attributes: { friendly_name: 'User_Temperature',
      device_class: 'temperature', unit_of_measurement: '°C' } } },
    entities: { 'light.current': { entity_id: 'light.current', device_id: 'device' },
      'sensor.secondary': { entity_id: 'sensor.secondary', device_id: 'device' } },
    devices: { device: { id: 'device', name: 'User_Device', area_id: 'office' } },
    areas: { office: { area_id: 'office', name: 'User_Room', floor_id: 'ground' } }, floors: {},
    services: { light: { turn_on: {}, turn_off: {}, toggle: {} } }, callService: vi.fn().mockResolvedValue(undefined),
    formatEntityState(state) { return `HA:${this.locale.language}:${this.locale.number_format}:${state.state}`; },
    formatEntityName(state) { return (this.translationMetadata?.prefix || '') + state.attributes.friendly_name; },
  };
  card._hass = h;
  card._view = { model: null, modelManifest: () => null, floorElevation: () => 0,
    markerObjects: new Map(), setMarkers: vi.fn((rows) => scene.replaceChildren(...rows.map((row) => row.element))),
    setMarkerStates: vi.fn(), setGlows: vi.fn(), setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(),
    setControlsEnabled: vi.fn(), stop: vi.fn(), highlightModelNode: vi.fn() };
  card._popup = { close: vi.fn(), update: vi.fn() };
  card._devicePopup = new DevicePopup(stage, { onAction: h.callService });
  // Leave actual _schedule/_update/_buildMarkers/_refreshStates and signature
  // comparisons intact. No root predicate or popup close decision is mocked.
  for (const method of ['_syncHouseShell', '_syncModelRendering', '_syncScenePreviews', '_syncAmbient', '_suspendAmbient',
    '_observeSecuritySession', '_syncSecurity', '_syncFurniture', '_syncMiniMap', '_syncStatus', '_syncWallPresentation',
    '_updateObjects', '_refreshMower', '_checkMergeKeep', '_loadModel', '_syncWeatherVisibility', '_refreshSecurityMotion'])
    vi.spyOn(card, method).mockImplementation(() => {});
  vi.spyOn(card, '_resolveViewList').mockReturnValue(false); vi.spyOn(card, '_syncBindings').mockReturnValue(false);
  card._presetEvents.setHass = vi.fn();
  card._built = { themes: h.themes, theme: {}, manifest: null, rooms: card._layout.rooms, lfloors: card._layout.floors,
    floors: h.floors, areas: h.areas, modelKey: '', model: card._layout.model, mower: null };
  const build = vi.spyOn(card, '_buildMarkers'), update = vi.spyOn(card, '_update');
  fixtures.push(card); card.hass = h; await settle();
  expect(build).toHaveBeenCalledOnce(); expect(update).toHaveBeenCalledOnce(); build.mockClear(); update.mockClear();
  return { card, stage, h, build, update };
}
afterEach(() => {
  for (const card of fixtures.splice(0)) {
    card._edit?.dispose(); card._edit = null; card._editing = false;
    card._devicePopup.dispose(); card._ambientController.dispose(); card._scenePreviewController.dispose();
    card._view = null; card.remove();
  }
  vi.restoreAllMocks();
});

describe('Actual root locale-only registry updates', () => {
  it('creates the translated marker caption with literal user punctuation and no markup or identifier changes', async () => {
    const { card, h } = await fixture(); card._hass = { ...h, language: 'fr', locale: { ...h.locale, language: 'fr' } };
    const name = 'User_{name}_été <literal>', marker = { id: 'entity:light.current', entityId: 'light.current', domain: 'light', name };
    const node = card._markerElement(marker);
    expect(node.getAttribute('aria-label')).toBe('Ouvrir les commandes de User_{name}_été <literal>');
    expect(node.title).toBe(name); expect(node.querySelector('literal')).toBeNull(); expect(marker.name).toBe(name);
    expect(marker.id).toBe('entity:light.current'); expect(h.callService).not.toHaveBeenCalled();
  });

  it.each([
    ['de', 'Bedienelemente für User_Device öffnen'],
    ['fr', 'Ouvrir les commandes de User_Device'],
    ['es', 'Abrir controles de User_Device'],
  ])('refreshes the %s marker accessibility caption on the retained focused native node', async (language, caption) => {
    const { card, h, build } = await fixture(), marker = card._markers.find((row) => row.id === 'device:device');
    const node = card._markerEls.get(marker.id); expect(node.getAttribute('aria-label')).toBe('Open User_Device controls'); node.focus();
    card.hass = { ...h, language, locale: { ...h.locale, language } }; await settle();
    expect(card._markerEls.get(marker.id)).toBe(node); expect(card.shadowRoot.activeElement).toBe(node);
    expect(node.getAttribute('aria-label')).toBe(caption); expect(marker.name).toBe('User_Device');
    expect(marker.id).toBe('device:device'); expect(marker.entityId).toBe('light.current'); expect(build).not.toHaveBeenCalled();
    expect(h.callService).not.toHaveBeenCalled(); expect(card._store.save).not.toHaveBeenCalled();
  });

  it('keeps an opened device and exact focused unfinished colour through the scheduled hass setter', async () => {
    const { card, h, build, update } = await fixture();
    const marker = card._markers.find((row) => row.id === 'device:device'), markerElement = card._markerEls.get(marker.id);
    card._devicePopup.update(h); card._devicePopup.showMarker(marker);
    const popup = card._devicePopup.el, field = popup.querySelector('[data-light-control="color"]');
    field.focus(); field.value = '#abcdef'; input(field); const context = field.dataset.context;
    card.hass = { ...h, language: 'fr', locale: { ...h.locale, language: 'fr' } }; await settle();
    expect(card._devicePopup.isOpen).toBe(true); expect(card._devicePopup.el).toBe(popup);
    expect(popup.querySelector('[data-light-control="color"]')).toBe(field); expect(card.shadowRoot.activeElement).toBe(field);
    expect(field.value).toBe('#abcdef'); expect(field.dataset.context).toBe(context);
    expect(popup.querySelector('[data-action="more-info"]').textContent).toBe('Toutes les commandes');
    expect(card._markerEls.get(marker.id)).toBe(markerElement);
    expect(markerElement.querySelector('.fp-val').textContent).toBe('HA:fr:language:12.345');
    expect(update).toHaveBeenCalledOnce(); expect(build).not.toHaveBeenCalled();
    expect(h.callService).not.toHaveBeenCalled(); expect(card._store.save).not.toHaveBeenCalled();
    field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.callService).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.current', rgb_color: [171, 205, 239] });
  });

  it('keeps a real room snapshot and native All-controls focus while translating current readings', async () => {
    const { card, h, build } = await fixture();
    card._devicePopup.update(h); card._devicePopup.showRoom({ ...card._layout.rooms[0], name: 'User_Room' }, card._markers);
    const popup = card._devicePopup.el, control = popup.querySelector('[data-action="more-info"][data-entity="sensor.secondary"]'); control.focus();
    card.hass = { ...h, language: 'de', locale: { ...h.locale, language: 'de' } }; await settle();
    expect(card._devicePopup.isOpen).toBe(true); expect(card._devicePopup.el).toBe(popup); expect(card.shadowRoot.activeElement).toBe(control);
    expect(control.textContent).toBe('Alle Bedienelemente'); expect(popup.querySelector('h3').textContent).toBe('User_Room');
    expect(popup.querySelector('.t3d-entity[data-entity="sensor.secondary"] .t3d-entity-value').textContent).toBe('HA:de:language:12.345');
    expect(build).not.toHaveBeenCalled();
    expect(h.callService).not.toHaveBeenCalled();
  });

  it('retains actual Data file/export nodes and native focus instead of calling afterUpdate/render', async () => {
    const { card, h, build } = await fixture();
    const edit = card._edit = new EditMode(card); card._editing = true; edit.tab = 'data'; edit.render(); card._stage.append(edit.panel); edit.attach();
    const file = edit.panel.querySelector('input[data-field="import"]'), button = edit.panel.querySelector('[data-single-layout-text="export"]');
    button.focus(); const afterUpdate = vi.spyOn(edit, 'afterUpdate'), render = vi.spyOn(edit, 'render');
    card.hass = { ...h, language: 'es', locale: { ...h.locale, language: 'es' } }; await settle();
    expect(edit.panel.querySelector('input[data-field="import"]')).toBe(file); expect(edit.panel.querySelector('[data-single-layout-text="export"]')).toBe(button);
    expect(card.shadowRoot.activeElement).toBe(button); expect(file.parentElement.textContent).toContain('Importar JSON');
    expect(edit.panel.querySelector('[data-act="tab"][data-id="data"]').textContent).toBe('Datos');
    expect(build).not.toHaveBeenCalled(); expect(afterUpdate).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled();
    expect(h.callService).not.toHaveBeenCalled(); expect(card._store.save).not.toHaveBeenCalled();
  });

  it('retains focused native history controls and literal labels through locale updates', async () => {
    const { card, h, build } = await fixture();
    card._history = { canUndo: true, canRedo: false, undoLabel: 'User_Edit_été' };
    const edit = card._edit = new EditMode(card); card._editing = true; edit.tab = 'data'; edit.render(); card._stage.append(edit.panel); edit.attach();
    const button = edit.panel.querySelector('[data-act="history-undo"]'); button.focus();
    card.hass = { ...h, language: 'fr', locale: { ...h.locale, language: 'fr' } }; await settle();
    expect(edit.panel.querySelector('[data-act="history-undo"]')).toBe(button);
    expect(card.shadowRoot.activeElement).toBe(button); expect(button.textContent).toBe('Annuler'); expect(button.title).toBe('Annuler : User_Edit_été');
    expect(build).not.toHaveBeenCalled();
    expect(h.callService).not.toHaveBeenCalled();
  });

  it('refreshes current native number formatting and translated entity names without rebuilding geometry', async () => {
    const { card, h, build } = await fixture(), element = card._markerEls.get('device:device');
    card.hass = { ...h, locale: { ...h.locale, number_format: 'decimal_comma' }, translationMetadata: { prefix: 'HA_TRANSLATED:' } }; await settle();
    expect(card._markerEls.get('device:device')).toBe(element);
    expect(element.querySelector('.fp-val').textContent).toBe('HA:en:decimal_comma:12.345');
    expect(element.title).toContain('HA_TRANSLATED:User_Lamp');
    expect(build).not.toHaveBeenCalled();
    expect(h.states['light.current'].attributes.friendly_name).toBe('User_Lamp'); expect(h.callService).not.toHaveBeenCalled();
  });

  it.each(['membership', 'name', 'class', 'registry'])('still rebuilds and closes old room/device snapshots on real %s changes', async (kind) => {
    const { card, h, build } = await fixture(); card._devicePopup.update(h); card._devicePopup.showMarker(card._markers[0]);
    let next = h;
    if (kind === 'membership') next = { ...h, states: { ...h.states, 'switch.added': { state: 'off', attributes: {} } } };
    if (kind === 'name') next = { ...h, states: { ...h.states, 'light.current': { ...h.states['light.current'], attributes: { ...h.states['light.current'].attributes, friendly_name: 'Changed source name' } } } };
    if (kind === 'class') next = { ...h, states: { ...h.states, 'sensor.secondary': { ...h.states['sensor.secondary'], attributes: { ...h.states['sensor.secondary'].attributes, device_class: 'humidity' } } } };
    if (kind === 'registry') next = { ...h, entities: { ...h.entities, 'light.current': { ...h.entities['light.current'], hidden_by: 'user' } } };
    card.hass = next; await settle(); expect(build).toHaveBeenCalledOnce(); expect(card._devicePopup.isOpen).toBe(false);
    expect(h.callService).not.toHaveBeenCalled();
  });
});
