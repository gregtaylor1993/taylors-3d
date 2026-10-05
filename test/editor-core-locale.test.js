// @vitest-environment jsdom
// The real root hass setter, EditMode, native controls and exact-position fence run.
// WebGL and unrelated visual stages are replaced; saved data and actions are real.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/taylors3d-card.js';
import { EditMode } from '../src/edit-mode.js';
import dictionary from '../src/translations/editor-core.js';

const fixtures = [];
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
async function fixture(tab = 'model') {
  const card = document.createElement('taylors3d-card'); document.body.append(card); fixtures.push(card);
  const stage = document.createElement('div'), scene = document.createElement('div'); stage.append(scene); card.shadowRoot.append(stage);
  stage.getBoundingClientRect = () => ({ width: 700, height: 500, left: 0, top: 0 }); card._stage = stage; card._scene = scene;
  card._config = { layout_key: 'core-caption-proof', layout_style: 'original', group_by: 'device' };
  card._layout = { version: 1, floors: [{ id: 'ground', elevation: 0, height: 3 }],
    rooms: [{ id: 'owned-room', area_id: 'office', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], doors: [[1, 0]] }],
    pins: {}, hidden: [], objects: { lamp: { entity: 'light.current' } }, groups: {}, views: {},
    model: { version: 1, name: 'Loading model…', position: [120.25, -75.5, 18], opacity: .6, scale: 1,
      known: { levels: ['ground'], rooms: ['office'] } },
    mower: { entity: 'sensor.mower_position', source: 'xy', x_attr: 'map_x', y_attr: 'map_y', floor_id: 'ground' } };
  card._loading = false; card._editing = false; card._floor = 'ground'; card._mode = '3d';
  card._floors = [{ id: 'ground', name: 'Floors', elevation: 0, height: 3 }];
  card._roomList = [{ room: card._layout.rooms[0], name: 'Doors', floorId: 'ground' }];
  card._store = { backend: 'shared', save: vi.fn().mockResolvedValue(true) };
  const h = { user: { id: 'current-user', is_admin: true, is_active: true }, auth: {}, connection: { connected: true },
    language: 'en', locale: { language: 'en', number_format: 'language' }, themes: {},
    states: { 'light.current': { entity_id: 'light.current', state: 'on', attributes: { friendly_name: 'Hide' } },
      'sensor.mower_position': { entity_id: 'sensor.mower_position', state: '1', attributes: { friendly_name: 'Source', map_x: 1.2345, map_y: -2.3456 } } },
    entities: { 'light.current': { entity_id: 'light.current', device_id: 'exact-device' }, 'sensor.mower_position': { entity_id: 'sensor.mower_position' } },
    devices: { 'exact-device': { id: 'exact-device', name: 'Hide', area_id: 'office' } },
    areas: { office: { area_id: 'office', name: 'Doors', floor_id: 'ground' } }, floors: {}, callService: vi.fn(), callWS: vi.fn() };
  card._hass = h;
  const manifest = { levels: [{ id: 'ground', label: 'Floors', role: 'storey', order: 0 }],
    rooms: [{ id: 'office', label: 'Doors', kind: 'room', level: 'ground', outline: [[0, 0], [3, 0], [3, 2]] }],
    objects: [{ id: 'lamp', label: 'Test', type: 'light', level: 'ground', room: 'office' }],
    errors: ['Unknown server error <strong>Doors</strong>'], warnings: ['Raw diagnostic: Hide'] };
  card._view = { model: {}, modelManifest: () => manifest, floorElevation: () => 0, markerObjects: new Map(),
    setMarkers: vi.fn((rows) => scene.replaceChildren(...rows.map((row) => row.element))), setMarkerStates: vi.fn(), setGlows: vi.fn(),
    setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(), setControlsEnabled: vi.fn(), stop: vi.fn(),
    highlightModelNode: vi.fn(), setSky: vi.fn(), setSkyBodies: vi.fn(), isTagged: () => true, sectionBox: () => null };
  card._popup = { close: vi.fn(), update: vi.fn() }; card._devicePopup = { close: vi.fn(), update: vi.fn(), dispose: vi.fn() };
  for (const method of ['_syncHouseShell', '_syncModelRendering', '_syncScenePreviews', '_syncAmbient', '_suspendAmbient', '_observeSecuritySession',
    '_syncSecurity', '_syncFurniture', '_syncMiniMap', '_syncStatus', '_syncWallPresentation', '_updateObjects', '_refreshMower',
    '_checkMergeKeep', '_loadModel', '_syncWeatherVisibility', '_refreshSecurityMotion']) vi.spyOn(card, method).mockImplementation(() => {});
  vi.spyOn(card, '_resolveViewList').mockReturnValue(false); vi.spyOn(card, '_syncBindings').mockReturnValue(false); card._presetEvents.setHass = vi.fn();
  vi.spyOn(card, 'viewIndex').mockReturnValue(null);
  card._views = [{ id: 'user-id', label: 'Hide', source: 'added', floors: ['ground'] }, { id: 'other-id', label: 'Camera', hidden: true, source: 'added', floors: [] }];
  card._viewId = 'user-id'; vi.spyOn(card, '_stateFor').mockReturnValue({ floors: ['ground'], effective: null });
  card._built = { themes: h.themes, theme: {}, manifest, rooms: card._layout.rooms, lfloors: card._layout.floors,
    floors: h.floors, areas: h.areas, modelKey: '', model: card._layout.model, mower: card._layout.mower };
  const bindings = card.modelBindings(); card._built.modelKey = JSON.stringify([bindings.levels, bindings.rooms, card._modelAlign()]);
  card.hass = h; await settle();
  const edit = card._edit = new EditMode(card); card._editing = true; edit.tab = tab; edit.objExpanded.add('ground/office');
  if (tab === 'rooms') edit.selectedRoom = 'owned-room';
  if (tab === 'devices') { edit.selectedMarker = 'device:exact-device'; card._positions = new Map([['device:exact-device', { x: 1, y: 2, z: 0, floorId: 'ground' }]]); }
  edit.render(); stage.append(edit.panel); edit.attach();
  const language = async (value) => { card.hass = { ...h, language: value, locale: { ...h.locale, language: value } }; await settle(); };
  const field = (name) => edit.panel.querySelector(`[data-field="${name}"]`);
  return { card, edit, h, language, field, manifest };
}
afterEach(() => {
  for (const card of fixtures.splice(0)) { card._edit?.dispose(); card._edit = null; card._editing = false;
    card._ambientController.dispose(); card._scenePreviewController.dispose(); card._view = null; card.remove(); }
  vi.restoreAllMocks();
});

describe('core editor caption contracts', () => {
  it('provides four complete typed catalogues with identical parameters and exact brand spelling', () => {
    const keys = Object.keys(dictionary.en); expect(keys.length).toBeGreaterThan(250);
    for (const language of ['en', 'de', 'fr', 'es']) {
      expect(Object.keys(dictionary[language])).toEqual(keys); expect(Object.isFrozen(dictionary[language])).toBe(true);
      for (const key of keys) {
        expect(dictionary[language][key]).toBeTruthy();
        const parameters = (value) => [...value.matchAll(/\{([A-Za-z_]+)\}/g)].map((match) => match[1]).sort();
        expect(parameters(dictionary[language][key]), `${language}:${key}`).toEqual(parameters(dictionary.en[key]));
        expect(dictionary[language][key]).not.toContain('Taylor’s');
      }
    }
  });
  it.each(['de', 'fr', 'es'])('keeps focused exact coordinates, a selected GLB and raw model diagnostics during %s updates', async (lang) => {
    const { card, edit, language, field } = await fixture();
    const input = field('md-position-x'), upload = field('model-file'), file = new File(['model'], 'Upload.glb');
    Object.defineProperty(upload, 'files', { value: [file] }); input.focus(); input.value = '1.20';
    const report = edit.panel.querySelector('details.report'), summary = report.querySelector('summary'); report.open = true;
    const layout = card._layout, model = layout.model, version = edit._modelPositionScope.id, history = card._history.size;
    await language(lang);
    expect(field('md-position-x')).toBe(input); expect(card.shadowRoot.activeElement).toBe(input); expect(input.value).toBe('1.20');
    expect(input.disabled).toBe(false); expect(edit._modelPositionScope.id).toBe(version);
    expect(field('model-file')).toBe(upload); expect(upload.files[0]).toBe(file); expect(report.open).toBe(true); expect(report.querySelector('summary')).toBe(summary);
    expect(edit.panel.querySelector('[data-act="model-fit"]').textContent).toBe(dictionary[lang]['editorCore.frameModel']);
    expect(input.closest('label').textContent).toContain(dictionary[lang]['editorCore.east']);
    expect(edit.panel.querySelector('.box h3').textContent).toBe('Loading model…');
    expect(report.textContent).toContain('Unknown server error <strong>Doors</strong>'); expect(report.querySelector('strong')).toBeNull();
    expect(card._layout).toBe(layout); expect(card._layout.model).toBe(model); expect(card._history.size).toBe(history); expect(card._store.save).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each([
    ['rooms', 'room-area', 'addDoor'], ['devices', 'marker-z', 'hideDevice'], ['objects', 'obj-entity', 'hideObject'], ['mower', 'mower-xattr', 'addPoint'], ['views', 'screen-name', 'addView'],
  ])('retains the native %s field and literal HA/model labels while translating owned instructions', async (tab, name, key) => {
    const { card, edit, language, field } = await fixture(tab), input = field(name);
    expect(input).toBeTruthy(); input.focus(); if (input.tagName !== 'SELECT') input.value = 'Unfinished Doors <draft>';
    const value = input.value, nodes = [...edit.panel.querySelectorAll('input,select,button')], layout = card._layout, history = card._history.size;
    await language('de');
    expect(field(name)).toBe(input); expect(card.shadowRoot.activeElement).toBe(input); expect(input.value).toBe(value);
    expect([...edit.panel.querySelectorAll('input,select,button')]).toEqual(nodes);
    if (tab !== 'views') expect(edit.panel.textContent).toContain('Doors');
    if (tab !== 'devices') expect(edit.panel.textContent).toContain('Floors');
    expect(edit.panel.textContent).toContain(dictionary.de[`editorCore.${key}`]);
    expect(card._layout).toBe(layout); expect(card._history.size).toBe(history); expect(card._store.save).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
    if (tab === 'objects') expect(edit.panel.querySelector('li.obj .name').textContent).toBe('Test');
    if (tab === 'views') { expect(field('vw-label').value).toBe('Hide'); expect(field('vw-view').options[1].value).toBe('other-id'); expect(field('vw-view').options[1].textContent).toBe('Camera (ausgeblendet)'); }
  });
  it('keeps a held screen-name save valid across a locale update and translates its owned notice', async () => {
    const { card, edit, language, field } = await fixture('views'), name = field('screen-name'); name.value = 'my exact panel';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const button = edit.panel.querySelector('[data-act="save-screen-name"]'); button.focus(); button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    const save = vi.spyOn(card, 'setPanelName'); await language('fr');
    expect(edit.panel.querySelector('[data-act="save-screen-name"]')).toBe(button); expect(card.shadowRoot.activeElement).toBe(button);
    expect(save).not.toHaveBeenCalled(); button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })); button.click(); await settle();
    expect(save).toHaveBeenCalledExactlyOnceWith('my exact panel'); expect(card._panelName).toBe('my exact panel');
    expect(edit.message).toEqual({ text: 'Screen name saved on this browser.' }); expect(edit.panel.querySelector('.msg').textContent).toBe(dictionary.fr['editorCore.screenSavedNotice']);
    expect(card._store.save).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps the original panel error text while translating its private owned error in place', async () => {
    const { card, edit, language, field } = await fixture('views');
    field('screen-name').value = 'x'.repeat(129); edit.panel.querySelector('[data-act="save-screen-name"]').click();
    expect(edit.message.text).toBe('Panel name must be at most 128 characters');
    const warning = edit.panel.querySelector('.msg'); await language('fr');
    expect(edit.panel.querySelector('.msg')).toBe(warning);
    expect(warning.textContent).toBe('Le nom du panneau doit comporter au maximum 128 caractères');
    await language('es'); expect(warning.textContent).toBe('El nombre del panel debe tener como máximo 128 caracteres');
    expect(edit.message.text).toBe('Panel name must be at most 128 characters'); expect(card._panelName).not.toBe('x'.repeat(129));
    expect(card._store.save).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps an externally supplied same-wording panel error literal across languages', async () => {
    const { card, edit, language, field } = await fixture('views');
    vi.spyOn(card, 'setPanelName').mockImplementation(() => { throw new Error('Panel name must be at most 128 characters'); });
    field('screen-name').value = 'raw_user_name'; edit.panel.querySelector('[data-act="save-screen-name"]').click();
    await language('de'); expect(edit.panel.querySelector('.msg').textContent).toBe('Panel name must be at most 128 characters');
    expect(card._store.save).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('translates retained missing IDs and preserves the raw Data paths plus unknown diagnostics', async () => {
    const { card, edit, language } = await fixture('data'); card._layout.rooms[0].area_id = 'missing_exact_area'; edit.render();
    const data = edit.panel.querySelector('[data-single-layout-data]'), list = data.querySelector('ul'), code = list.querySelector('code');
    const path = code.textContent, layout = card._layout;
    await language('es');
    expect(edit.panel.querySelector('[data-single-layout-data]')).toBe(data); expect(data.querySelector('code')).toBe(code); expect(code.textContent).toBe(path);
    expect(data.textContent).toContain('missing_exact_area'); expect(data.textContent).toContain('falta'); expect(data.textContent).toContain("Taylor's 3D");
    const unknown = { code: 'external_new_code', kind: 'entity', id: 'light.current', message: 'Unknown external text <b>must remain literal</b>' };
    const template = document.createElement('template'); template.innerHTML = edit._coreIssueCaption(unknown);
    expect(template.content.textContent).toBe(unknown.message); expect(template.content.querySelector('b')).toBeNull(); expect(card._layout).toBe(layout); expect(card._store.save).not.toHaveBeenCalled();
  });
  it('updates owned Data warnings rendered in a non-English language, while keeping same-code external messages literal', async () => {
    const { card, edit, language } = await fixture('data');
    await language('es'); card._layout.rooms[0].area_id = 'raw_missing_Area'; edit.render();
    const data = edit.panel.querySelector('[data-single-layout-data]'), warning = data.querySelector('ul li'), code = warning.querySelector('code');
    expect(warning.textContent).toMatch(/[Ff]alta/);
    await language('de');
    expect(edit.panel.querySelector('[data-single-layout-data]')).toBe(data); expect(data.querySelector('ul li')).toBe(warning);
    expect(warning.querySelector('code')).toBe(code); expect(code.textContent).toBe('layout.rooms.0.area_id');
    expect(warning.textContent).toContain('fehlt'); expect(warning.textContent).toContain('raw_missing_Area');
    const external = { code: 'missing_area', kind: 'area', id: 'raw_missing_Area', message: 'External custom warning <b>falta</b>' };
    const template = document.createElement('template'); template.innerHTML = edit._coreIssueCaption(external);
    expect(template.content.textContent).toBe(external.message); expect(template.content.querySelector('b')).toBeNull();
    expect(card._store.save).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('translates an open Views menu in place, keeping raw picked names and unknown errors literal', async () => {
    const { edit, language } = await fixture('views'); edit.vwPick = { sel: 'node:User/Hide' }; edit._openMenu({ clientX: 50, clientY: 30 }, 'Hide');
    const menu = edit.menu, button = menu.querySelector('[data-act="vw-hide-here"]');
    edit.message = { text: 'Unknown server error: Camera <script>raw</script>', error: true }; edit.render(); await language('de');
    expect(edit.menu).toBe(menu); expect(menu.querySelector('[data-act="vw-hide-here"]')).toBe(button);
    expect(button.textContent).toBe(dictionary.de['editorCore.hideHere']); expect(menu.querySelector('.title').textContent).toBe('Hide');
    expect(menu.querySelector('.title').title).toBe('node:User/Hide'); expect(edit.panel.querySelector('.msg').textContent).toBe(edit.message.text); expect(edit.panel.querySelector('script')).toBeNull();
  });
  it('falls back to English for an unsupported locale without changing native fields', async () => {
    const { edit, language, field } = await fixture('model'), input = field('md-position-x'); await language('pt');
    expect(field('md-position-x')).toBe(input); expect(edit.panel.querySelector('[data-act="model-fit"]').textContent).toBe('Frame model');
  });
});
