// @vitest-environment jsdom
// Real card hass setter, real microtask update and real EditMode/native DOM.
// Only WebGL and unrelated feature work are replaced; ownership predicates run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';
import { EditMode } from '../src/edit-mode.js';
import { DevicePopup } from '../src/device-popup.js';

const cards = [];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
async function fixture(tab = 'model') {
  const card = document.createElement('taylors3d-card'); document.body.append(card); cards.push(card);
  const stage = document.createElement('div'), scene = document.createElement('div'); stage.append(scene); card.shadowRoot.append(stage);
  stage.getBoundingClientRect = () => ({ width: 700, height: 500, left: 0, top: 0 }); card._stage = stage; card._scene = scene;
  card._config = { layout_key: 'model-position-setter-proof', layout_style: 'original', group_by: 'device' };
  card._layout = { version: 1, floors: [{ id: 'ground', elevation: 0, height: 3 }], rooms: [], pins: {}, hidden: [], mower: null,
    objects: {}, groups: {}, views: {}, model: { version: 1, name: 'Owned upload', position: [120.25, -75.5, 18], opacity: .6, scale: 1 },
    alert_bindings: [{ id: 'leak', entity: 'binary_sensor.leak', type: 'leak', label: 'Original alert', location_mode: 'coordinates',
      x: 1, y: 2, z: .12, floorId: 'ground', clear_rule: 'state' }] };
  card._loading = false; card._editing = false; card._floor = 'ground'; card._mode = '3d'; card._floors = card._layout.floors; card._roomList = [];
  card._store = { backend: 'shared', save: vi.fn().mockResolvedValue(true) };
  const h = { user: { id: 'current-user', is_admin: true, is_active: true }, auth: {}, connection: { connected: true },
    language: 'en', locale: { language: 'en', number_format: 'language' }, themes: {},
    states: { 'binary_sensor.leak': { entity_id: 'binary_sensor.leak', state: 'off', attributes: { friendly_name: 'Exact source', device_class: 'moisture' } } },
    entities: { 'binary_sensor.leak': { entity_id: 'binary_sensor.leak', device_id: null } }, devices: {}, areas: {}, floors: {},
    callService: vi.fn(), callWS: vi.fn() };
  card._hass = h;
  card._view = { model: null, modelManifest: () => null, floorElevation: () => 0, markerObjects: new Map(),
    setMarkers: vi.fn((rows) => scene.replaceChildren(...rows.map((row) => row.element))), setMarkerStates: vi.fn(), setGlows: vi.fn(),
    setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(), setControlsEnabled: vi.fn(), stop: vi.fn(), highlightModelNode: vi.fn() };
  card._popup = { close: vi.fn(), update: vi.fn() }; card._devicePopup = new DevicePopup(stage, { onAction: h.callService });
  for (const method of ['_syncHouseShell', '_syncModelRendering', '_syncScenePreviews', '_syncAmbient', '_suspendAmbient', '_observeSecuritySession',
    '_syncSecurity', '_syncFurniture', '_syncMiniMap', '_syncStatus', '_syncWallPresentation', '_updateObjects', '_refreshMower',
    '_checkMergeKeep', '_loadModel', '_syncWeatherVisibility', '_refreshSecurityMotion']) vi.spyOn(card, method).mockImplementation(() => {});
  vi.spyOn(card, '_resolveViewList').mockReturnValue(false); vi.spyOn(card, '_syncBindings').mockReturnValue(false); card._presetEvents.setHass = vi.fn();
  card._built = { themes: h.themes, theme: {}, manifest: null, rooms: card._layout.rooms, lfloors: card._layout.floors,
    floors: h.floors, areas: h.areas, modelKey: '', model: card._layout.model, mower: null };
  const update = vi.spyOn(card, '_update'); card.hass = h; await settle(); update.mockClear();
  const edit = card._edit = new EditMode(card); card._editing = true; edit.tab = tab; edit.render(); stage.append(edit.panel); edit.attach();
  const field = (name) => edit.panel.querySelector(`[data-field="${name}"]`);
  return { card, edit, h, update, field };
}
afterEach(() => {
  for (const card of cards.splice(0)) { card._edit?.dispose(); card._edit = null; card._editing = false; card._devicePopup.dispose();
    card._ambientController.dispose(); card._scenePreviewController.dispose(); card._view = null; card.remove(); }
  vi.restoreAllMocks();
});

describe('Actual root setter observes native model/alert context losses before a coalesced recovery', () => {
  it.each(['role', 'active', 'connection'])('poisons an unfinished exact model position after transient %s loss', async (loss) => {
    const { card, h, update, field } = await fixture(), input = field('md-position-x'); input.focus(); input.value = '200';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (loss === 'connection') h.connection.connected = false;
    card.hass = loss === 'role' ? { ...h, user: { ...h.user, is_admin: false } }
      : loss === 'active' ? { ...h, user: { ...h.user, is_active: false } } : { ...h };
    if (loss === 'connection') h.connection.connected = true;
    card.hass = { ...h }; await settle();
    expect(update).toHaveBeenCalledOnce();
    // A genuine context-driven teardown may replace the field. In that case
    // the old native event must stay detached, rather than requiring DOM reuse.
    const retained = field('md-position-x') === input;
    if (!retained) expect(input.isConnected).toBe(false);
    input.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(card._layout.model.position).toEqual([120.25, -75.5, 18]); expect(card._store.save).not.toHaveBeenCalled(); expect(h.callService).not.toHaveBeenCalled();
    if (retained) expect(input.disabled).toBe(true);
  });

  it('keeps genuine unrelated HA updates editable without replacing or normalising the native field', async () => {
    const { card, h, field } = await fixture(), input = field('md-position-x'); input.focus(); input.value = '1.20';
    card.hass = { ...h, states: { ...h.states, 'binary_sensor.leak': { ...h.states['binary_sensor.leak'], state: 'on' } } }; await settle();
    expect(field('md-position-x')).toBe(input); expect(card.shadowRoot.activeElement).toBe(input); expect(input.disabled).toBe(false); expect(input.value).toBe('1.20');
    input.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(card._layout.model.position).toEqual([1.2, -75.5, 18]); expect(card._store.save).toHaveBeenCalledOnce(); expect(h.callService).not.toHaveBeenCalled();
  });

  it.each(['role', 'source'])('cancels held native Alert Save after transient %s loss and permits only a fresh press', async (loss) => {
    const { card, edit, h, update, field } = await fixture('overlays');
    edit.panel.querySelector('[data-act="ovr-edit-alert"][data-id="leak"]').click();
    const location = field('ovr-alert-location'); location.value = 'coordinates'; location.dispatchEvent(new Event('change', { bubbles: true }));
    const label = field('ovr-alert-label'); label.value = 'Deliberate changed label'; label.dispatchEvent(new Event('change', { bubbles: true }));
    const save = edit.panel.querySelector('[data-act="ovr-save-alert"]'); save.focus(); update.mockClear();
    save.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    card.hass = loss === 'role' ? { ...h, user: { ...h.user, is_admin: false } }
      : { ...h, states: { ...h.states, 'binary_sensor.leak': { ...h.states['binary_sensor.leak'], state: 'unavailable' } } };
    card.hass = { ...h }; await settle();
    expect(update).toHaveBeenCalledOnce();
    if (edit.panel.querySelector('[data-act="ovr-save-alert"]') !== save) expect(save.isConnected).toBe(false);
    save.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); save.click(); await settle();
    expect(card._layout.alert_bindings[0].label).toBe('Original alert'); expect(card._store.save).not.toHaveBeenCalled(); expect(h.callService).not.toHaveBeenCalled();
    const fresh = edit.panel.querySelector('[data-act="ovr-save-alert"]'); fresh.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    fresh.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); fresh.click(); await settle();
    expect(card._layout.alert_bindings[0].label).toBe('Deliberate changed label'); expect(card._store.save).toHaveBeenCalledOnce(); expect(h.callService).not.toHaveBeenCalled();
  });
});
