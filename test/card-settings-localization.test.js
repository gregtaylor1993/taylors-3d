// @vitest-environment jsdom
// Real card editor/fragment DOM; ha-form persistence in Home Assistant remains unproven.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import catalogues from '../src/translations/card-settings.js';
import { inspectSourceValue } from '../src/imported-source-controls.js';

let editorModule;
const editors = [];
beforeAll(async () => {
  if (!customElements.get('ha-form')) customElements.define('ha-form', class extends HTMLElement {});
  editorModule = await import('../src/card-editor.js');
});
afterEach(() => { editors.splice(0).forEach((editor) => editor.remove()); vi.restoreAllMocks(); });
const source = () => ({ type: 'custom:taylors3d-card', model: '/local/User_House_été.glb', model_position: [1, 2, 3], model_opacity: 0,
  model_floors: { exact_mesh: 'User_Floor_été' }, view_id: 'User_View_été', views: {
    'User_View_été': { label: 'User_Label_été', camera: { position: [1, 2, 3], target: [0, 0, 0] }, extra: '<literal>' },
    other: { label: 'Other literal label', extension: null } }, unknown: { preserved: [false, null, 'été'] } });
function setup(language = 'en', config = source()) {
  const editor = document.createElement('taylors3d-card-editor'); editors.push(editor); document.body.append(editor);
  const hass = { language, locale: { language }, user: { id: 'admin', is_active: true, is_admin: true }, connection: { connected: true }, auth: {},
    states: {}, callService: vi.fn(), callWS: vi.fn() };
  const changed = vi.fn(); editor.addEventListener('config-changed', changed); editor.setConfig(config); editor.hass = hass;
  return { editor, hass, config, changed, form: editor.querySelector('ha-form') };
}
const fields = (schema) => schema.flatMap((item) => item.schema ? fields(item.schema) : [item]);
const button = (editor, kind, key) => [...editor.querySelectorAll(`[data-source-action="${kind}"]`)].find((node) => key === undefined || node.dataset.viewKey === key);
function language(f, value) { f.hass.locale.language = value; f.hass.language = value; f.editor.hass = f.hass; }
function begin(node, kind = 'pointer') {
  node.dispatchEvent(kind === 'pointer' ? new MouseEvent('pointerdown', { bubbles: true, button: 0 }) : new KeyboardEvent('keydown', { bubbles: true, key: kind }));
}
function release(node, kind = 'pointer') {
  node.dispatchEvent(kind === 'pointer' ? new MouseEvent('pointerup', { bubbles: true, button: 0 }) : new KeyboardEvent('keyup', { bubbles: true, key: kind })); node.click();
}

describe('owned native card settings translations', () => {
  it('has immutable English/German/French/Spanish key and parameter parity', () => {
    const keys = Object.keys(catalogues.en); expect(keys.length).toBeGreaterThan(80);
    const parameters = (value) => [...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
    for (const locale of ['en', 'de', 'fr', 'es']) {
      expect(Object.isFrozen(catalogues[locale])).toBe(true); expect(Object.keys(catalogues[locale]).sort()).toEqual([...keys].sort());
      for (const key of keys) { expect(typeof catalogues[locale][key]).toBe('string'); expect(parameters(catalogues[locale][key])).toEqual(parameters(catalogues.en[key])); }
    }
  });

  it.each([
    { locale: 'de-DE', height: 'Kartenhöhe', east: 'Modellposition Ost', north: 'Modellposition Nord', up: 'Modellposition Höhe', house: 'Darstellung', popup: 'Gerätesteuerung öffnen' },
    { locale: 'fr-FR', height: 'Hauteur de la carte', east: 'Position est du modèle', north: 'Position nord du modèle', up: 'Position en hauteur du modèle', house: 'Apparence', popup: 'Ouvrir les commandes de l’appareil' },
    { locale: 'es-ES', height: 'Altura de la tarjeta', east: 'Posición este del modelo', north: 'Posición norte del modelo', up: 'Posición vertical del modelo', house: 'Aspecto', popup: 'Abrir controles del dispositivo' },
  ])('translates $locale labels and choices without translating IDs or changing axis order', ({ locale, height, east, north, up, house, popup }) => {
    const f = setup(locale), schema = fields(f.form.schema);
    expect(f.form.computeLabel({ name: 'height' })).toBe(height);
    expect(['x', 'y', 'z'].map((axis) => f.form.computeLabel({ name: `model_position_${axis}` }))).toEqual([east, north, up]);
    expect(f.form.schema.find((row) => row.title)?.title).toBe(house);
    expect(schema.find((row) => row.name === 'device_tap_action').selector.select.options[0]).toEqual({ value: 'popup', label: popup });
    expect(f.form.data.view_id).toBe('User_View_été'); expect(f.form.data.model).toBe('/local/User_House_été.glb'); expect(f.form.data.model_opacity).toBe(0);
    expect(f.form.data.views).toEqual(f.config.views); expect(f.changed).not.toHaveBeenCalled();
    expect(f.hass.callService).not.toHaveBeenCalled(); expect(f.hass.callWS).not.toHaveBeenCalled();
  });

  it('keeps English exactly compatible and falls back to the same English schema', () => {
    const f = setup(); expect(f.form.schema).toBe(editorModule.SCHEMA);
    expect(f.form.computeLabel({ name: 'view_id' })).toBe('Starting named view (exact ID)');
    expect(f.form.computeHelper({ name: 'height' })).toBe('CSS height, e.g. 520px or 60vh');
    expect(f.editor.querySelector('.bubble-control-order h3').textContent).toBe('Button order');
    language(f, 'it-IT'); expect(f.form.schema).toBe(editorModule.SCHEMA); expect(f.form.computeLabel({ name: 'model_position_y' })).toBe('Model north position');
  });

  it.each(['en', 'de', 'fr', 'es'])('names glass schemes in %s while preserving the existing saved values', (locale) => {
    const f = setup(locale), schema = fields(f.form.schema);
    expect(f.form.computeLabel({ name: 'house_colour_scheme' })).toBe(catalogues[locale]['settings.label.house_colour_scheme']);
    const options = schema.find((row) => row.name === 'house_colour_scheme').selector.select.options;
    expect(options.map((option) => option.value)).toEqual(['ha', 'dark', 'light']);
    for (const option of options) expect(option.label).toBe(catalogues[locale][`settings.option.house_colour_scheme.${option.value}`]);
    expect(f.changed).not.toHaveBeenCalled(); expect(f.config.model).toBe('/local/User_House_été.glb');
  });

  it('covers every owned nonempty helper with the exact English text and translated counterparts', () => {
    const f = setup(), helpers = fields(f.form.schema).map((item) => item.name).filter((name) => f.form.computeHelper({ name }));
    expect(helpers.length).toBe(23);
    expect(helpers).toContain('marker_display');
    for (const name of helpers) {
      const key = `settings.helper.${name}`;
      expect(catalogues.en[key]).toBe(f.form.computeHelper({ name }));
      for (const locale of ['de', 'fr', 'es']) expect(catalogues[locale][key]).toBeTruthy();
    }
  });

  it.each(['de', 'fr', 'es'])('translates the longer %s setup helpers while retaining examples, native focus and proposed config', (locale) => {
    const f = setup(), node = button(f.editor, 'shared-view', 'User_View_été'), schema = f.form.schema;
    const names = ['view_id', 'layout_style', 'house_colour_scheme', 'merge', 'sky_bodies', 'bubble_bar_controls',
      'device_tap_action', 'control_panel', 'automation_panel', 'automation_card_id'];
    const before = Object.fromEntries(names.map((name) => [name, f.form.computeHelper({ name })]));
    node.focus(); begin(node); language(f, locale);
    for (const name of names) { expect(f.form.computeHelper({ name })).not.toBe(before[name]);
      expect(f.form.computeHelper({ name })).toBe(catalogues[locale][`settings.helper.${name}`]); }
    expect(f.form.computeHelper({ name: 'view_id' })).toContain('front-door'); expect(f.form.computeHelper({ name: 'view_id' })).toContain('garden');
    expect(f.form.computeHelper({ name: 'automation_panel' })).toContain('kitchen-wall'); expect(f.form.computeHelper({ name: 'automation_panel' })).toContain("Taylor's 3D");
    expect(f.form.computeHelper({ name: 'model' })).toContain('/local/house.glb');
    const translated = f.form.schema; f.editor.hass = { ...f.hass, states: { 'sensor.unrelated': { state: '42' } } };
    expect(f.form.schema).toBe(translated); expect(document.activeElement).toBe(node); expect(f.changed).not.toHaveBeenCalled();
    language(f, 'en'); expect(f.form.schema).toBe(schema); expect(document.activeElement).toBe(node);
    release(node); expect(f.changed).toHaveBeenCalledOnce(); expect(f.changed.mock.calls[0][0].detail.config).toEqual({ ...f.config, views: { other: f.config.views.other } });
    expect(f.hass.callService).not.toHaveBeenCalled(); expect(f.hass.callWS).not.toHaveBeenCalled();
  });

  it('reuses translated schema and focused order nodes through ordinary readings and locale switches', () => {
    const f = setup('de'), schema = f.form.schema, node = f.editor.querySelector('[data-control="reset"] .up'), label = node.previousElementSibling;
    node.focus(); f.editor.hass = { ...f.hass, states: { 'sensor.unrelated': { state: '4' } } };
    expect(f.form.schema).toBe(schema); expect(document.activeElement).toBe(node);
    language(f, 'fr'); expect(f.editor.querySelector('[data-control="reset"] .up')).toBe(node); expect(document.activeElement).toBe(node);
    expect(node.textContent).toBe('Monter'); expect(node.getAttribute('aria-label')).toBe('Monter Réinitialiser la vue');
    expect(label.textContent).toBe('2. Réinitialiser la vue'); language(f, 'de'); expect(f.form.schema).toBe(schema);
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('updates source captions in place, retains raw text and allows the same deliberate intent through locale change', () => {
    const f = setup(), node = button(f.editor, 'shared-view', 'User_View_été'), summary = node.parentElement.querySelector('summary');
    const raw = node.parentElement.querySelector('pre').textContent; node.focus(); begin(node); language(f, 'de');
    expect(button(f.editor, 'shared-view', 'User_View_été')).toBe(node); expect(document.activeElement).toBe(node);
    expect(summary.textContent).toBe('Importierte Ansicht: User_View_été'); expect(node.textContent).toBe('Gemeinsame Layout-Einstellungen verwenden');
    expect(node.parentElement.querySelector('pre').textContent).toBe(raw); expect(raw).toContain('User_Label_été'); expect(raw).toContain('<literal>');
    release(node); expect(f.changed).toHaveBeenCalledOnce();
    expect(f.changed.mock.calls[0][0].detail.config).toEqual({ ...f.config, views: { other: f.config.views.other } });
    expect(f.editor.querySelector('[role="status"]').textContent).toContain('Speichern');
    expect(f.hass.callService).not.toHaveBeenCalled(); expect(f.hass.callWS).not.toHaveBeenCalled();
  });

  it.each(['pointer', ' ', 'Enter'])('still rejects held %s after observed permission loss/recovery and language change', (kind) => {
    const f = setup(), node = button(f.editor, 'uploaded-model'); node.focus(); begin(node, kind);
    f.hass.user.is_admin = false; f.editor.hass = f.hass; language(f, 'es'); f.hass.user.is_admin = true; f.editor.hass = f.hass;
    expect(button(f.editor, 'uploaded-model')).toBe(node); release(node, kind); expect(f.changed).not.toHaveBeenCalled();
    begin(node, kind); release(node, kind); expect(f.changed).toHaveBeenCalledOnce();
    const config = f.changed.mock.calls[0][0].detail.config; expect(config.view_id).toBe('User_View_été'); expect(config.views).toEqual(f.config.views);
    expect(config.unknown).toEqual(f.config.unknown); expect(config.model).toBeUndefined();
  });

  it('localizes malformed-list repair while retaining its exact raw import until an explicit action', () => {
    const f = setup('fr', { ...source(), views: ['User_View_été', { unknown: null }] }), node = button(f.editor, 'clear-views');
    expect(node.textContent).toBe('Effacer les vues importées mal formées'); expect(node.parentElement.querySelector('pre').textContent).toContain('User_View_été');
    expect(f.changed).not.toHaveBeenCalled(); node.click(); expect(f.changed).toHaveBeenCalledOnce();
    expect(f.changed.mock.calls[0][0].detail.config.unknown).toEqual(f.config.unknown);
  });

  it.each(['model', 'floors', 'view', 'malformed'])('translates only the unreadable %s display, keeping inspection unchanged and clearing unavailable', (kind) => {
    const config = source();
    if (kind === 'model') config.model_opacity = Infinity;
    if (kind === 'floors') config.model_floors = { exact_mesh: Infinity };
    if (kind === 'view') config.views['User_View_été'].extra = Infinity;
    if (kind === 'malformed') config.views = [Infinity];
    const f = setup('en', config), inspection = kind === 'malformed' ? 'views' : kind;
    const node = f.editor.querySelector(`[data-source-inspection="${inspection}"]`), action = node.parentElement.querySelector('button');
    const pure = inspectSourceValue(Infinity), undefinedValue = inspectSourceValue(undefined); action.focus(); language(f, 'de');
    expect(f.editor.querySelector(`[data-source-inspection="${inspection}"]`)).toBe(node);
    expect(node.textContent).toBe('Dieser Wert kann hier nicht vollständig geprüft werden. Er bleibt unverändert; Entfernen ist nicht möglich.');
    expect(action.disabled).toBe(true); action.click(); expect(f.changed).not.toHaveBeenCalled();
    expect(inspectSourceValue(Infinity)).toEqual(pure); expect(pure.text).toBe('This value cannot be fully inspected here. It is kept unchanged; clearing is unavailable.');
    expect(inspectSourceValue(undefined)).toEqual(undefinedValue); expect(undefinedValue.text).toBe('"[present undefined]"');
    expect(f.hass.callService).not.toHaveBeenCalled(); expect(f.hass.callWS).not.toHaveBeenCalled();
  });

  it('keeps C1 native form emissions, zero opacity and east/north/up coordinates exact in a translated form', () => {
    const f = setup('es'); f.form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...f.form.data,
      view_id: 'User_Garden_été', model_position_x: 10, model_position_y: 20, model_position_z: 30, model_opacity: 0 } } }));
    expect(f.changed).toHaveBeenCalledOnce(); const config = f.changed.mock.calls[0][0].detail.config;
    expect(config.model_position).toEqual([10, 20, 30]); expect(config.model_opacity).toBe(0); expect(config.view_id).toBe('User_Garden_été');
    expect(config.views).toEqual(f.config.views); expect(config.unknown).toEqual(f.config.unknown);
  });
});
