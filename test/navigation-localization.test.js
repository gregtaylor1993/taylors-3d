// @vitest-environment jsdom
// Native shadow-root controls; this does not claim browser geometry or live HA proof.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevicePopup } from '../src/device-popup.js';
import { MiniMap } from '../src/minimap.js';
import { buildRoomSummary } from '../src/room-summary.js';
import { EditMode } from '../src/edit-mode.js';
import { localize } from '../src/localization.js';
import '../src/taylors3d-card.js';

const cleanups = [];
afterEach(() => { cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); vi.restoreAllMocks(); });
const state = (value, attributes = {}) => ({ state: value, attributes });
function current(language = 'en') {
  return { locale: { language }, user: { id: 'current', is_admin: true, is_active: true }, connection: { connected: true },
    entities: {}, devices: {}, areas: { office: { name: 'My_Office' } }, services: { light: { turn_on: {}, turn_off: {}, toggle: {} } },
    states: { 'light.user_lamp': state('on', { friendly_name: 'My_Lamp', brightness: 128, color_mode: 'rgb', rgb_color: [12, 34, 56],
      supported_color_modes: ['rgb', 'color_temp'], min_color_temp_kelvin: 2100, max_color_temp_kelvin: 6400 }),
    'sensor.user_power': state('12.34', { friendly_name: 'My_Power' }), 'media_player.user': state('playing') },
    formatEntityState: (source) => `HA:${source.state}`, callService: vi.fn().mockResolvedValue(undefined), callWS: vi.fn() };
}
function surface() {
  const host = document.createElement('div'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
  const stage = document.createElement('div'); root.append(stage);
  stage.getBoundingClientRect = () => ({ width: 700, height: 500, top: 0, left: 0 });
  cleanups.push(() => host.remove()); return { host, root, stage };
}
function popupFixture() {
  const f = surface(), hass = current(), popup = new DevicePopup(f.stage, { onAction: hass.callService });
  cleanups.push(() => popup.dispose()); popup.update(hass);
  popup.showMarker({ name: 'My_Device', entityId: 'light.user_lamp', entities: [{ eid: 'sensor.user_power' }] });
  return { ...f, hass, popup, row: () => popup.el.querySelector('[data-entity="light.user_lamp"].t3d-entity') };
}
const dispatch = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));

describe('Popup language updates retain native intent', () => {
  it.each(['de', 'fr', 'es'])('%s changes owned captions in place without changing names, readings or commands', (language) => {
    const f = popupFixture(), row = f.row(), input = row.querySelector('[data-light-control="color"]');
    input.focus(); input.value = '#abcdef'; dispatch(input, 'input');
    const context = input.dataset.context, before = JSON.stringify(f.hass.states); f.hass.locale.language = language; f.popup.update(f.hass);
    expect(f.row()).toBe(row); expect(f.row().querySelector('[data-light-control="color"]')).toBe(input); expect(f.root.activeElement).toBe(input);
    expect(input.value).toBe('#abcdef'); expect(input.dataset.context).toBe(context);
    expect(row.querySelector('[data-action="more-info"]').textContent).toBe(localize(f.hass, 'common.controls'));
    expect(f.popup.el.querySelector('h3').textContent).toBe('My_Device'); expect(row.querySelector('.t3d-entity-name').textContent).toBe('My_Lamp');
    expect(f.popup.el.querySelector('[data-entity="sensor.user_power"].t3d-entity .t3d-entity-value').textContent).toBe('HA:12.34');
    expect(row.querySelector('legend').textContent).toBe(localize(f.hass, 'popup.colour'));
    expect(row.querySelector('.t3d-colour-picker span').textContent).toBe(localize(f.hass, 'popup.chooseColour'));
    expect(row.querySelector('[data-color-name="Red"]').dataset.colorName).toBe('Red');
    expect(row.querySelector('[data-color-name="Red"]').title).toBe(localize(f.hass, 'popup.swatch.red'));
    expect(row.querySelectorAll('.t3d-light-reading')[1].textContent).toBe(localize(f.hass, 'popup.choice', { value: '#abcdef' }));
    expect(f.hass.callService).not.toHaveBeenCalled(); expect(JSON.stringify(f.hass.states)).toBe(before);
    dispatch(input, 'change'); expect(f.hass.callService).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.user_lamp', rgb_color: [171, 205, 239] });
  });

  it.each(['brightness', 'kelvin'])('keeps a deliberate %s range release through locale change', (kind) => {
    const f = popupFixture(), input = f.row().querySelector(`[data-light-control="${kind}"]`); input.focus(); input.value = kind === 'brightness' ? '40' : '4200'; dispatch(input, 'input');
    f.hass.locale.language = 'fr'; f.popup.update(f.hass); expect(f.root.activeElement).toBe(input); expect(f.hass.callService).not.toHaveBeenCalled();
    dispatch(input, 'change'); expect(f.hass.callService).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', kind === 'brightness'
      ? { entity_id: 'light.user_lamp', brightness: 102 } : { entity_id: 'light.user_lamp', color_temp_kelvin: 4200 });
  });

  it.each(['connection', 'service', 'cancel'])('language change cannot revive a cancelled %s gesture', (kind) => {
    const f = popupFixture(), input = f.row().querySelector('[data-light-control="color"]'); input.value = '#abcdef'; dispatch(input, 'input');
    if (kind === 'cancel') dispatch(input, 'pointercancel');
    else if (kind === 'connection') f.hass.connection.connected = false;
    else delete f.hass.services.light.turn_on;
    f.hass.locale.language = 'de'; f.popup.update(f.hass); f.hass.connection.connected = true; f.hass.services.light.turn_on = {}; f.popup.update(f.hass);
    dispatch(input, 'change'); expect(f.hass.callService).not.toHaveBeenCalled();
    const fresh = f.row().querySelector('[data-light-control="color"]'); fresh.value = '#102030'; dispatch(fresh, 'input'); dispatch(fresh, 'change');
    expect(f.hass.callService).toHaveBeenCalledExactlyOnceWith('light', 'turn_on', { entity_id: 'light.user_lamp', rgb_color: [16, 32, 48] });
  });

  it('localizes pending and failure captions without translating returned HA errors', async () => {
    const f = popupFixture(); let reject; f.hass.callService.mockImplementation(() => new Promise((_resolve, no) => { reject = no; }));
    f.row().querySelector('[data-action="toggle"]').click(); f.hass.locale.language = 'es'; f.popup.update(f.hass);
    expect(f.row().querySelector('.t3d-entity-status').textContent).toBe(localize(f.hass, 'popup.sending'));
    reject(new Error('<My_HA_Error>')); await Promise.resolve(); await Promise.resolve();
    expect(f.row().querySelector('.t3d-entity-error').textContent).toBe(localize(f.hass, 'popup.commandFailed', { message: '<My_HA_Error>' }));
    f.hass.locale.language = 'fr'; f.popup.update(f.hass); expect(f.row().querySelector('.t3d-entity-error').textContent).toBe(localize(f.hass, 'popup.commandFailed', { message: '<My_HA_Error>' }));
    expect(f.popup.el.querySelector('my_ha_error')).toBeNull();
  });

  it.each(['de', 'fr', 'es'])('%s labels missing light evidence honestly while preserving a literal room name', (language) => {
    const f = popupFixture(); f.hass.locale.language = language; f.hass.states['light.user_lamp'].attributes.restored = true; f.popup.update(f.hass);
    expect(f.row().querySelector('.t3d-entity-value').textContent).toBe(localize(f.hass, 'popup.lightWaiting'));
    expect(f.row().querySelector('[data-action="toggle"]').disabled).toBe(true);
    f.popup.showRoom({ id: 'exact_room', name: 'My_Room_Name' }, []);
    expect(f.popup.el.querySelector('h3').textContent).toBe('My_Room_Name');
    expect(f.popup.el.querySelector('.t3d-popup-kind').textContent).toBe(localize(f.hass, 'popup.kind.room'));
    expect(f.popup.el.querySelector('.t3d-popup-body').textContent).toBe(localize(f.hass, 'popup.emptyRoom'));
    expect(f.hass.callService).not.toHaveBeenCalled();
  });
});

describe('Room and mini-map language changes', () => {
  it.each(['de', 'fr', 'es', 'it'])('%s uses resolved-language room plurals without changing actual membership/counts', (language) => {
    const hass = current(language); hass.states['light.user_lamp'].state = 'off'; const ids = ['light.user_lamp', 'media_player.user'];
    expect(buildRoomSummary({ hass, entityIds: ids }).text).toBe(`${localize(hass, 'room.lightsOn', { count: 0 })} · ${localize(hass, 'room.mediaPlaying', { count: 1 })}`);
    expect(buildRoomSummary({ hass, entityIds: ids }).lights).toMatchObject({ on: 0, total: 1 }); expect(hass.callService).not.toHaveBeenCalled();
  });
  it('localizes unknown counts, group caveats and unavailable-session diagnostics from actual evidence', () => {
    const hass = current('fr'); hass.states['light.user_lamp'].attributes.entity_id = ['light.child'];
    hass.states['light.user_lamp'].state = 'unavailable'; hass.states['media_player.user'].state = 'unknown';
    const entityIds = ['light.user_lamp', 'media_player.user'], summary = buildRoomSummary({ hass, entityIds });
    expect(summary.lights).toEqual({ on: 0, total: 1, unknown: 1, groupsIncluded: true });
    expect(summary.text).toContain(localize(hass, 'room.lightsUnknown', { count: 1 }));
    expect(summary.text).toContain(localize(hass, 'room.mediaUnknown', { count: 1 }));
    expect(summary.text).toContain(localize(hass, 'room.groupsIncluded'));
    hass.connection.connected = false; expect(buildRoomSummary({ hass, entityIds }).text).toBe(localize(hass, 'room.waiting'));
  });
  it('refreshes keyed map captions while preserving focused room and exact geometry/selection callbacks', () => {
    const f = surface(), hass = current(), onFocus = vi.fn(), map = new MiniMap(f.stage, { onFocus }); cleanups.push(() => map.dispose());
    const data = { hass, floors: [{ id: 'ground', name: 'My_Ground', elevation: 0 }, { id: 'upper', name: 'My_Upper', elevation: 3 }], visibleFloors: 'all',
      rooms: [{ floorId: 'ground', name: 'My_Room', room: { id: 'room_exact', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] } }],
      markers: [{ id: 'lamp_exact', entityId: 'light.user_lamp', name: 'My_Lamp' }], positions: new Map([['lamp_exact', { x: 2, y: 1, floorId: 'ground' }]]), states: hass.states };
    map.update(data); const room = map.roomLayer.firstChild, marker = map.markerLayer.firstChild, points = room.getAttribute('points'), transform = marker.getAttribute('transform'), select = map.select;
    room.focus(); hass.locale.language = 'es'; map.update(data);
    expect(map.roomLayer.firstChild).toBe(room); expect(map.markerLayer.firstChild).toBe(marker); expect(f.root.activeElement).toBe(room); expect(map.select).toBe(select);
    expect(room.getAttribute('points')).toBe(points); expect(marker.getAttribute('transform')).toBe(transform);
    expect(room.getAttribute('aria-label')).toBe('Enfocar My_Room'); expect(map.el.getAttribute('aria-label')).toBe('Minimapa de plantas');
    expect(map.svg.getAttribute('aria-label')).toBe('Plano con el norte arriba, My_Ground');
    expect(marker.getAttribute('aria-label')).toBe('Enfocar My_Lamp, on');
    expect(map.closeButton.getAttribute('aria-label')).toBe('Ocultar minimapa'); expect(select.getAttribute('aria-label')).toBe('Planta del minimapa');
    expect(select.options[0].textContent).toBe('My_Ground'); expect(onFocus).not.toHaveBeenCalled();
    room.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); expect(onFocus).toHaveBeenCalledExactlyOnceWith({ x: 2, y: 1.5, floorId: 'ground', roomId: 'room_exact' });
  });
});

describe('Common toolbar and editor captions', () => {
  it('localizes the actual stable bubble controls and user-named view chips', () => {
    const card = new (customElements.get('taylors3d-card'))(); card.shadowRoot.innerHTML = '<nav class="toolbar"><div class="chips"></div><div class="bubble-actions"><div class="seg" data-bubble="mode"><button data-mode="3d">3D</button><button data-mode="top">Top</button></div><button data-bubble="reset"></button><button class="section" data-bubble="section"></button><button class="day" data-bubble="daynight"><ha-icon></ha-icon></button><button class="minimap-toggle" data-bubble="minimap"></button><button class="edit" data-bubble="edit"><span></span></button></div></nav>';
    document.body.append(card); cleanups.push(() => { card._ambientController.dispose(); card._scenePreviewController.dispose(); card._view = null; card.remove(); });
    card._config = {}; card._hass = current(); card._toolbar = card.shadowRoot.querySelector('nav'); card._chips = card.shadowRoot.querySelector('.chips'); card._dayBtn = card.shadowRoot.querySelector('.day'); card._sectionBtn = card.shadowRoot.querySelector('.section'); card._miniMapBtn = card.shadowRoot.querySelector('.minimap-toggle'); card._editBtn = card.shadowRoot.querySelector('.edit');
    card._view = { model: {}, getCamera: () => ({}), getTopCamera: () => ({}) }; card._views = [{ id: 'exact_1', label: 'My_View_One' }, { id: 'exact_2', label: 'My_View_Two' }]; card._mode = 'top'; card._skyMode = 'auto'; card._roomList = [{}];
    card._syncScenePreviews = vi.fn(); card._syncMiniMap = vi.fn(); card._syncHouseShell = vi.fn(); card._resize = vi.fn();
    card._syncToolbar(); const chip = card._chips.firstChild; chip.focus(); card._hass.locale.language = 'de'; card._syncToolbar();
    expect(card._chips.firstChild).toBe(chip); expect(card.shadowRoot.activeElement).toBe(chip); expect(chip.textContent).toBe('My_View_One');
    expect(card.shadowRoot.querySelector('[data-mode="top"]').textContent).toBe(localize(card._hass, 'toolbar.mode.top'));
    expect(card._miniMapBtn.getAttribute('aria-label')).toBe(localize(card._hass, 'toolbar.miniMapToggle')); expect(card._dayBtn.title).toBe(localize(card._hass, 'toolbar.dayNight', { mode: localize(card._hass, 'toolbar.sky.auto') }));
    const mapButton = card._miniMapBtn, modeButton = card.shadowRoot.querySelector('[data-mode="top"]'); mapButton.focus();
    card._hass.locale.language = 'fr'; card._syncToolbarLabels();
    expect(card.shadowRoot.activeElement).toBe(mapButton); expect(card._miniMapBtn).toBe(mapButton); expect(card.shadowRoot.querySelector('[data-mode="top"]')).toBe(modeButton);
    expect(modeButton.dataset.mode).toBe('top'); expect(mapButton.dataset.bubble).toBe('minimap'); expect(card._miniMapBtn.getAttribute('aria-label')).toBe(localize(card._hass, 'toolbar.miniMapToggle'));
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('updates actual editor tabs/history/footer in place around a focused typed field', () => {
    const f = surface(), hass = current(), card = { isConnected: true, _editing: true, _config: { layout_style: 'house', layout_key: 'exact' }, _layout: { rooms: [], pins: {} }, _built: {}, _floor: 'ground', _mode: 'top', _floors: [], _roomList: [], _markers: [], _positions: new Map(), _stage: f.stage, _store: { backend: 'browser' }, _hass: hass,
      _history: { canUndo: true, canRedo: false, undoLabel: 'My_User_Edit' }, _applyMarkerSelection: vi.fn(), modelBindings: () => null,
      _view: { model: null, floorElevation: () => 0, setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(), setControlsEnabled: vi.fn() } };
    const edit = new EditMode(card); card._edit = edit; card.houseSummaryEditorAvailable = () => edit.tab === 'house'; cleanups.push(() => edit.dispose()); edit.tab = 'house'; edit.render(); f.stage.append(edit.panel); edit.attach();
    const input = edit.panel.querySelector('[data-field="house-summary-title"]'); input.focus(); input.value = 'My_Unfinished_Name'; dispatch(input, 'input');
    const tab = edit.panel.querySelector('[data-id="rooms"][data-act="tab"]'), undo = edit.panel.querySelector('[data-act="history-undo"]'); hass.locale.language = 'fr'; edit.onStates();
    expect(edit.panel.querySelector('[data-field="house-summary-title"]')).toBe(input); expect(f.root.activeElement).toBe(input); expect(input.value).toBe('My_Unfinished_Name');
    expect(edit.panel.querySelector('[data-id="rooms"][data-act="tab"]')).toBe(tab); expect(tab.textContent).toBe('Pièces'); expect(undo.title).toBe(localize(hass, 'history.undoNamed', { label: 'My_User_Edit' }));
    expect(edit.panel.querySelector('.foot').textContent).toContain(localize(hass, 'edit.storage.browser')); expect(hass.callService).not.toHaveBeenCalled();
    edit.tab = 'data'; edit.render(); expect(edit.panel.textContent).toContain(localize(hass, 'edit.singleLayout.title'));
    const file = edit.panel.querySelector('[data-field="import"]'); hass.locale.language = 'es'; edit.onStates(); expect(edit.panel.querySelector('[data-field="import"]')).toBe(file);
    expect(file.parentElement.textContent).toBe(localize(hass, 'edit.singleLayout.import'));
  });
});
