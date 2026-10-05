// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ScenePreviewEditor } from '../src/scene-preview-editor.js';
import { AmbientIdleEditor } from '../src/ambient-idle-editor.js';
import { WallPresentationEditor } from '../src/wall-presentation-editor.js';
import { FloorPresentationEditor } from '../src/floor-presentation-editor.js';
import { FurnitureEditor } from '../src/furniture-editor.js';
import messages from '../src/translations/editor-presentation-scenes.js';
import { editorExtraDiagnostic, editorExtraText } from '../src/editor-extra-localization.js';
import { editorDiagnosticKeys } from '../src/translations/editor-presentation-diagnostics.js';

const fixtures = [];
const PACK = 'a'.repeat(64), HASH = 'b'.repeat(64);
const settings = {
  scene: { enabled: true, items: [{ id: 'User_preview_ID', label: 'User_<b>Label_été', scene_entity: 'scene.user_exact',
    lights: [{ entity: 'light.user_exact', state: 'on', brightness: 128, color: { mode: 'rgb', rgb: [10, 20, 30] }, extra: 'User_target_été' }] }], extra: 'User_scene_été' },
  idle: { enabled: true, idle_seconds: 120, rotate: true, rotation_degrees_per_second: .5,
    dim: { enabled: true, brightness: .65, when: 'quiet_hours', start: '22:00', end: '07:00', extra: 'User_dim_été' }, extra: 'User_idle_été' },
  wall: { enabled: true, mode: 'fade', scope: 'all_selected', walls: [{ id: 'wall-1', label: 'User_<b>Wall_été', enabled: true,
    selector: 'node:User_Path/wall', floor_id: 'User_ground_ID', extra: 'User_wall_row_été' }], extra: 'User_wall_été' },
  floor: { mode: 'horizontal', axis: 'east', gap_m: 2, floors: ['User_ground_ID', 'User_upper_ID'], extra: 'User_floor_été' },
  furniture: { version: 1, instances: [{ id: 'user_instance', pack_id: PACK, item_id: 'user_chair', asset_sha256: HASH,
    floor_id: 'User_ground_ID', x: 2, y: -3, z: .5, rotation_degrees: 90, scale: 1, extra: 'User_instance_été' }], extra: 'User_furniture_été' },
};
const definitions = {
  scene: [ScenePreviewEditor, 'scene_previews', 'scene-preview-', 'label', 'User_draft_été', 'light-state'],
  idle: [AmbientIdleEditor, 'ambient_idle', 'ambient-idle-', 'idle_seconds', '121', 'dim.when'],
  wall: [WallPresentationEditor, 'wall_presentation', 'wall-presentation-', 'wall.label', 'User_draft_été', 'mode'],
  floor: [FloorPresentationEditor, 'floor_presentation', 'floor-presentation-', 'gap_m', '3.37', 'mode'],
  furniture: [FurnitureEditor, 'furniture', 'furniture-', 'x', '3.37', 'floor_id'],
};
const titles = {
  en: ['Scene light previews', 'Ambient idle', 'Wall presentation', 'Floor presentation', 'Furniture'],
  de: ['Lichtvorschauen für Szenen', 'Ruhemodus', 'Wandansicht', 'Etagenansicht', 'Möbel'],
  fr: ['Aperçus lumineux de scènes', 'Mode ambiant au repos', 'Présentation des murs', 'Présentation des étages', 'Mobilier'],
  es: ['Previsualizaciones de luces de escenas', 'Modo ambiental en reposo', 'Presentación de paredes', 'Presentación de plantas', 'Muebles'],
};
function fixture(kind, language = 'en', { raw = settings[kind], libraryMessage, importPack } = {}) {
  const [Type, property, prefix, draftField, draftValue, enumField] = definitions[kind];
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 3, .1), new THREE.MeshStandardMaterial()); root.add(mesh);
  const floors = [{ id: 'User_ground_ID', name: 'User_<b>Ground_été', elevation: 0 }, { id: 'User_upper_ID', name: 'User_Upper_été', elevation: 3 }];
  const catalogue = { version: 1, packs: [{ pack_id: PACK, manifest: { name: 'User_<b>Pack_été' },
    items: [{ id: 'user_chair', name: 'User_<b>Chair_été', pack_id: PACK, sha256: HASH, unit: 'm', anchor: [0, 0, 0] }] }] };
  const card = { isConnected: true, _editing: true, _loading: false, _edit: { tab: kind === 'scene' ? 'scenes' : kind === 'idle' ? 'idle' : 'model' },
    _config: { layout_key: 'User_layout_ID' }, _layout: { [property]: structuredClone(raw), floors }, _floors: floors,
    _view: { model: { root }, wallPresentationCandidates: () => ({ prepared: true, rows: [{ selector: 'node:User_Path/wall', label: 'User_<b>Mesh_été', node: mesh, selectable: true }], diagnostics: [] }),
      wallPresentationReport: () => ({ diagnostics: [] }) },
    floorPresentationReport: () => ({ mode: 'horizontal', valid: true, diagnostics: [] }), _modelAlign: () => ({ scale: 1 }),
    _hass: { locale: { language }, connection: { connected: true }, auth: {}, user: { id: 'User_account', is_admin: true, is_active: true },
      entities: {}, devices: {}, areas: {}, config: { time_zone: 'UTC' }, services: { scene: { turn_on: {} } },
      states: { 'scene.user_exact': { entity_id: 'scene.user_exact', state: 'unknown', attributes: { friendly_name: 'User_<b>Scene_été' } },
        'light.user_exact': { entity_id: 'light.user_exact', state: 'on', attributes: { friendly_name: 'User_<b>Light_été', brightness: 128, supported_color_modes: ['rgb'], color_mode: 'rgb', rgb_color: [10, 20, 30] } },
        'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { elevation: 20, azimuth: 90 } } },
      callService: vi.fn(async () => undefined), callWS: vi.fn() },
    previewSceneLights: vi.fn(), furniturePreviewDraft: vi.fn(), furnitureCatalogue: () => libraryMessage ? { status: 'error', message: libraryMessage } : { status: 'ready', catalogue },
    commitFeatureLayout: vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; }) };
  if (importPack) card.furnitureLibrary = { importPack };
  const host = document.createElement('div'); document.body.append(host);
  const editor = new Type(card, () => render(), { now: () => Date.parse('2026-01-01T12:30:00Z') });
  function render() { host.innerHTML = editor.render(); editor.updatePreviews(host); }
  render();
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const button = event.target.closest('[data-act]'); if (button && !button.disabled) editor.onClick(button.dataset.act, button); });
  const field = (name) => host.querySelector(`[data-field="${prefix}${name}"]`), button = (name) => host.querySelector(`[data-act="${prefix}${name}"]`);
  const locale = (value) => { card._hass.locale.language = value; editor.updatePreviews(host); };
  fixtures.push({ editor, host, mesh }); return { kind, card, editor, host, field, button, locale, render, property, draftField, draftValue, enumField };
}
const input = (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); };
const pointer = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));
afterEach(() => { for (const { editor, host, mesh } of fixtures.splice(0)) { editor.dispose(); host.remove(); mesh.geometry.dispose(); mesh.material.dispose(); } vi.restoreAllMocks(); });

describe('five editor fragments: owned localized captions with literal saved data', () => {
  it('provides all four catalogues with identical typed keys and primitive placeholders', () => {
    const keys = Object.keys(messages.en), parameters = (value) => [...value.matchAll(/\{([A-Za-z_]+)\}/g)].map((match) => match[1]).sort();
    expect(keys.length).toBeGreaterThan(380);
    for (const language of ['de', 'fr', 'es']) { expect(Object.keys(messages[language])).toEqual(keys);
      for (const key of keys) { expect(messages[language][key].trim()).not.toBe(''); expect(parameters(messages[language][key])).toEqual(parameters(messages.en[key])); }
    }
    expect(editorExtraText({ language: 'ja' }, 'scene.title')).toBe('Scene light previews');
    expect(editorExtraText({ language: 'invalid locale' }, 'idle.title')).toBe('Ambient idle');
  });
  it.each(['en', 'de', 'fr', 'es'])('renders all five %s editor titles and retains raw user labels, hashes, IDs, and imported extras', (language) => {
    for (const [index, kind] of Object.keys(definitions).entries()) {
      const ctx = fixture(kind, language), saved = structuredClone(ctx.card._layout[ctx.property]);
      expect(ctx.host.querySelector('h3').textContent).toBe(titles[language][index]);
      expect(ctx.editor.draft).toEqual(saved); expect(ctx.host.querySelector('b')).toBeNull();
      if (kind === 'scene') { expect(ctx.field('label').value).toBe('User_<b>Label_été'); expect(ctx.field('scene-entity').selectedOptions[0].textContent).toContain('User_<b>Scene_été'); }
      if (kind === 'wall') expect(ctx.field('wall.label').value).toBe('User_<b>Wall_été');
      if (kind === 'furniture') { expect(ctx.field('pack_id').selectedOptions[0].textContent).toBe('User_<b>Pack_été'); expect(ctx.host.textContent).toContain(HASH); }
      expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._hass.callService).not.toHaveBeenCalled(); expect(ctx.card._hass.callWS).not.toHaveBeenCalled();
    }
  });
  it.each(Object.keys(definitions))('changes %s captions/options in place while retaining the focused draft, native buttons and source identity', (kind) => {
    const ctx = fixture(kind), field = ctx.field(ctx.draftField), select = ctx.field(ctx.enumField), option = select.selectedOptions[0], save = ctx.button('save');
    field.focus(); input(field, ctx.draftValue); const draft = structuredClone(ctx.editor.draft), saved = structuredClone(ctx.card._layout), generation = ctx.editor._generation ?? ctx.editor._epoch;
    ctx.locale('es');
    expect(ctx.field(ctx.draftField)).toBe(field); expect(document.activeElement).toBe(field); expect(field.value).toBe(ctx.draftValue);
    expect(ctx.field(ctx.enumField)).toBe(select); expect(select.selectedOptions[0]).toBe(option); expect(ctx.button('save')).toBe(save);
    expect(ctx.editor.draft).toEqual(draft); expect(ctx.card._layout).toEqual(saved); expect(ctx.editor._generation ?? ctx.editor._epoch).toBe(generation);
    expect(ctx.host.querySelector('h3').textContent).toBe(titles.es[Object.keys(definitions).indexOf(kind)]);
    if (kind === 'scene') expect(option.textContent).toBe('Encendido');
    if (kind === 'idle') expect(option.textContent).toBe('Horario silencioso');
    if (kind === 'wall') expect(option.textContent).toBe('Desvanecer');
    if (kind === 'floor') expect(option.textContent).toBe('Lado a lado');
    if (kind === 'furniture') expect(option.textContent).toBe('User_<b>Ground_été');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._hass.callService).not.toHaveBeenCalled(); expect(ctx.card._hass.callWS).not.toHaveBeenCalled();
  });
  it('keeps a healthy held scene activation eligible through language updates, and activates the exact saved ID once', async () => {
    const ctx = fixture('scene'), activate = ctx.button('activate'); activate.focus(); pointer(activate, 'pointerdown'); ctx.locale('de');
    expect(ctx.button('activate')).toBe(activate); expect(document.activeElement).toBe(activate); expect(activate.textContent).toBe('Gespeicherte Szene aktivieren');
    pointer(activate, 'pointerup'); activate.click(); await Promise.resolve(); await Promise.resolve();
    expect(ctx.card._hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.user_exact' });
    ctx.locale('fr'); expect(ctx.host.textContent).toContain('Activation de scène acceptée par Home Assistant.');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._hass.callWS).not.toHaveBeenCalled();
  });
  it.each(['connection', 'account', 'role', 'source'])('rejects a held scene activation across current %s loss and recovery while retaining localized native controls', (reason) => {
    const ctx = fixture('scene'), activate = ctx.button('activate'), old = ctx.card._hass.states['scene.user_exact']; pointer(activate, 'pointerdown');
    if (reason === 'connection') ctx.card._hass.connection.connected = false;
    if (reason === 'account') ctx.card._hass.user.id = 'User_other';
    if (reason === 'role') ctx.card._hass.user.is_active = false;
    if (reason === 'source') delete ctx.card._hass.states['scene.user_exact'];
    ctx.locale('es');
    if (reason === 'connection') ctx.card._hass.connection.connected = true;
    if (reason === 'account') ctx.card._hass.user.id = 'User_account';
    if (reason === 'role') ctx.card._hass.user.is_active = true;
    if (reason === 'source') ctx.card._hass.states['scene.user_exact'] = old;
    ctx.editor.updatePreviews(ctx.host); pointer(activate, 'pointerup'); activate.click();
    expect(ctx.button('activate')).toBe(activate); expect(ctx.card._hass.callService).not.toHaveBeenCalled(); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('keeps a current held furniture Save eligible through a language update, preserving literal imported fields', () => {
    const ctx = fixture('furniture'); input(ctx.field('x'), '3.37'); const save = ctx.button('save'); pointer(save, 'pointerdown'); ctx.locale('fr'); pointer(save, 'pointerup'); save.click();
    expect(ctx.card.commitFeatureLayout).toHaveBeenCalledTimes(1); expect(ctx.card._layout.furniture.instances[0].x).toBe(3.37);
    expect(ctx.card._layout.furniture.extra).toBe('User_furniture_été'); expect(ctx.card._layout.furniture.instances[0].extra).toBe('User_instance_été');
    expect(ctx.card._hass.callService).not.toHaveBeenCalled(); expect(ctx.card._hass.callWS).not.toHaveBeenCalled();
  });
  it.each(['connection', 'account', 'role', 'catalogue'])('rejects a held furniture Save across current %s loss and recovery during language updates', (reason) => {
    const ctx = fixture('furniture'); input(ctx.field('x'), '3.37'); const save = ctx.button('save'), original = ctx.card.furnitureCatalogue; pointer(save, 'pointerdown');
    if (reason === 'connection') ctx.card._hass.connection.connected = false;
    if (reason === 'account') ctx.card._hass.user.id = 'User_other';
    if (reason === 'role') ctx.card._hass.user.is_admin = false;
    if (reason === 'catalogue') ctx.card.furnitureCatalogue = () => ({ status: 'unavailable', message: 'User_external_error_été' });
    ctx.locale('es');
    if (reason === 'connection') ctx.card._hass.connection.connected = true;
    if (reason === 'account') ctx.card._hass.user.id = 'User_account';
    if (reason === 'role') ctx.card._hass.user.is_admin = true;
    if (reason === 'catalogue') ctx.card.furnitureCatalogue = original;
    ctx.editor.updatePreviews(ctx.host); pointer(save, 'pointerup'); save.click();
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.editor.draft.instances[0].x).toBe(3.37); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it('retains missing floor IDs and deliberately malformed settings while translating only owned warnings', () => {
    const floor = fixture('floor', 'de', { raw: { ...settings.floor, floors: ['User_missing_ID'] } });
    expect(floor.host.textContent).toContain('User_missing_ID'); expect(floor.host.textContent).toContain('Gespeicherte Etage fehlt'); expect(floor.card._layout.floor_presentation.floors).toEqual(['User_missing_ID']);
    const idle = fixture('idle', 'fr', { raw: { ...settings.idle, idle_seconds: 'User_bad_delay_été' } });
    expect(idle.host.textContent).toContain('Le délai de repos doit être un nombre fini'); expect(idle.editor.draft.idle_seconds).toBe('User_bad_delay_été');
    const furniture = fixture('furniture', 'es', { raw: { ...settings.furniture, version: 'User_bad_version_été' } });
    expect(furniture.host.textContent).toContain('Los ajustes necesitan la versión numérica exacta 1.'); expect(furniture.editor.draft.version).toBe('User_bad_version_été');
    for (const ctx of [floor, idle, furniture]) { expect(ctx.button('save').disabled).toBe(true); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); }
  });
  it('retains both ambiguous exact wall choices as disabled native options through locale changes', () => {
    const ctx = fixture('wall'), select = ctx.field('wall.selector');
    ctx.card._view.wallPresentationCandidates = () => ({ prepared: true, rows: [
      { selector: 'node:User_Path/wall', label: 'User_first_ambiguous_mesh', selectable: true },
      { selector: 'node:User_Path/wall', label: 'User_second_ambiguous_mesh', selectable: true },
    ], diagnostics: [] });
    ctx.editor.updatePreviews(ctx.host);
    const options = [...select.options].filter((option) => option.value === 'node:User_Path/wall');
    expect(options).toHaveLength(2); expect(options.every((option) => option.disabled)).toBe(true);
    expect(options.map((option) => option.textContent)).toEqual(['User_first_ambiguous_mesh', 'User_second_ambiguous_mesh']);
    select.focus(); ctx.locale('de');
    expect(ctx.field('wall.selector')).toBe(select); expect([...select.options].filter((option) => option.value === 'node:User_Path/wall')).toEqual(options);
    expect(ctx.editor.draft.walls[0].selector).toBe('node:User_Path/wall'); expect(ctx.card._layout.wall_presentation.walls[0].selector).toBe('node:User_Path/wall');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
  it('translates only exact owned diagnostic code/message pairs, preserving unknown messages and external English text', () => {
    for (const row of editorDiagnosticKeys) {
      expect(editorExtraDiagnostic({ language: 'de' }, row)).toBe(messages.de[row.key]);
      expect(editorExtraDiagnostic({ language: 'de' }, { ...row, code: 'User_unknown_code' })).toBe(row.message);
      expect(editorExtraDiagnostic({ language: 'de' }, { ...row, message: 'User_external_<b>error_été' })).toBe('User_external_<b>error_été');
    }
    const ctx = fixture('furniture', 'de', { libraryMessage: 'Save furniture' });
    expect(ctx.host.textContent).toContain('Save furniture'); expect(ctx.host.querySelector('b')).toBeNull();
    ctx.editor.message = 'Scene activation failed.'; ctx.locale('es'); expect(ctx.host.textContent).toContain('Scene activation failed.');
  });
  it('retains the selected local ZIP and focused native file control through passive language updates without importing it', () => {
    const importPack = vi.fn(async () => ({ ok: true })), ctx = fixture('furniture', 'en', { importPack }), file = new File(['User_zip_bytes'], 'User_furniture_été.zip', { type: 'application/zip' });
    const control = ctx.field('import-file'); Object.defineProperty(control, 'files', { configurable: true, value: [file] });
    control.dispatchEvent(new Event('change', { bubbles: true })); control.focus(); ctx.locale('fr');
    expect(ctx.field('import-file')).toBe(control); expect(document.activeElement).toBe(control); expect(ctx.editor.file).toBe(file); expect(control.files[0].name).toBe('User_furniture_été.zip');
    expect(importPack).not.toHaveBeenCalled(); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._hass.callService).not.toHaveBeenCalled();
  });
});
