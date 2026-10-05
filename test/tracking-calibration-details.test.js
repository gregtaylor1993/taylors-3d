// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingCalibration } from '../src/tracking-calibration.js';
import { TrackingEditor } from '../src/tracking-editor.js';
import details, { calibrationDetailEntries } from '../src/translations/tracking-calibration-details.js';
import { calibrationDetailText, calibrationOwnedMessage, updateCalibrationDetails } from '../src/tracking-calibration-localization.js';

const epoch = Date.parse('2026-10-05T10:00:00Z');
const source = { entity: 'sensor.raw_position', source: 'xy', x_attr: 'actual.x', y_attr: 'actual.y', floorId: 'raw_floor', units: 'm',
  calibration: [{ src: [10.125, -20.5], plan: [1.125, -2.5] }, { src: [11.125, -20.5], plan: [2.125, -2.5] }], extension: { literal: '<raw>' } };
const state = (value, attributes = {}) => ({ state: value, attributes: { friendly_name: 'Source <literal> été', actual: { x: 10.125, y: -20.5 }, ...attributes } });
const controllers = [];
function setup(overrides = {}) {
  const hass = { locale: { language: 'en' }, states: { 'sensor.raw_position': state('1.25'), 'vacuum.raw_robot': state('cleaning') }, entities: {}, callService: vi.fn(), callWS: vi.fn() };
  const options = { source: structuredClone(source), hass, floors: [{ id: 'raw_floor', name: 'Floor <literal> été', elevation: 0 }], contextKey: 'raw_context', imported: true,
    now: () => epoch, onChange: vi.fn(), onPlanPick: vi.fn(), onPreview: vi.fn(), ...overrides };
  const controller = new TrackingCalibration(options); controllers.push(controller);
  const host = document.createElement('div'); document.body.append(host); host.innerHTML = controller.renderHTML(); controller.updatePreviews(host);
  const locale = (language) => { hass.locale.language = language; controller.updatePreviews(host); };
  return { hass, options, controller, host, locale };
}
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('authored nested Tracking calibration text', () => {
  it('has unique four-language keys with equal exact placeholder names', () => {
    const keys = Object.keys(details.en); expect(keys.length).toBeGreaterThan(50); expect(new Set(calibrationDetailEntries.map((entry) => entry.key)).size).toBe(keys.length);
    for (const language of ['de', 'fr', 'es']) { expect(Object.keys(details[language])).toEqual(keys);
      for (const key of keys) { expect(details[language][key].trim()).not.toBe(''); expect([...details[language][key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()).toEqual([...details.en[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()); }
    }
  });
  it('uses explicit captions and exact authored messages, preserving external prose and never evaluating parameter accessors', () => {
    const hass = { locale: { language: 'fr' } }, getter = vi.fn();
    expect(calibrationOwnedMessage(hass, '<external> exact English')).toBe('<external> exact English');
    expect(calibrationOwnedMessage(hass, { code: 'external', message: 'Calibration must be a list of source and plan points.' })).toBe('Calibration must be a list of source and plan points.');
    expect(calibrationOwnedMessage(hass, { code: 'calibration', message: 'Calibration must be a list of source and plan points.' })).toBe('Le calibrage doit être une liste de points source et de plan.');
    expect(calibrationDetailText(hass, 'fitError', { get residual() { getter(); return 0; } })).toBe(''); expect(getter).not.toHaveBeenCalled();
    expect(calibrationDetailText(hass, 'captured', { raw: '10 <literal>', floor: 'raw_<floor>' })).toBe('10 <literal> capturé. Choisissez le point correspondant sur raw_<floor>.');
    const root = document.createElement('div'); root.innerHTML = '<section data-tracking-calibration><label>Position source<select data-field="trk-cal-entity"><option value="raw_user">Capture current source point</option></select></label><p data-user>Vacuum coordinate calibration</p></section>';
    const option = root.querySelector('option'); updateCalibrationDetails(root, hass); expect(root.querySelector('label').textContent).toContain('Source de position');
    expect(root.querySelector('[data-user]').textContent).toBe('Vacuum coordinate calibration'); expect(root.querySelector('option')).toBe(option); expect(option.textContent).toBe('Capture current source point');
  });
  it.each([
    ['en', 'Vacuum coordinate calibration', 'Capture current source point', 'Source units', 'Metres', 'Position reading', 'Raw X/Y', 'Current Home Assistant state; measurement age is unverified.'],
    ['de-DE', 'Koordinatenkalibrierung des Staubsaugers', 'Aktuellen Quellpunkt erfassen', 'Quelleinheiten', 'Meter', 'Positionswert', 'Rohes X/Y', 'Aktueller Home-Assistant-Zustand; Messwertalter unbestätigt.'],
    ['fr-FR', 'Calibrage des coordonnées d’aspirateur', 'Capturer le point source actuel', 'Unités source', 'Mètres', 'Valeur de position', 'X/Y bruts', 'État actuel Home Assistant ; ancienneté non vérifiée.'],
    ['es-ES', 'Calibración de coordenadas del aspirador', 'Capturar punto actual de origen', 'Unidades de origen', 'Metros', 'Lectura de posición', 'X/Y originales', 'Estado actual de Home Assistant; antigüedad de medición sin verificar.'],
  ])('updates real nested captions/status in %s, keeping source names, numbers, units, model data and actions literal', (language, title, capture, units, unit, reading, raw, age) => {
    const { hass, controller, options, host, locale } = setup(), before = JSON.stringify(controller.getSource()), readings = JSON.stringify(hass.states);
    locale(language); expect(host.querySelector('h4').textContent).toBe(title); expect(host.querySelector('[data-cal-capture]').textContent).toBe(capture);
    const selector = host.querySelector('[data-field="trk-cal-units"]'); expect(selector.closest('label').textContent).toContain(units); expect(selector.selectedOptions[0].textContent).toBe(unit); expect(selector.value).toBe('m');
    expect(host.querySelector('[data-cal-status]').textContent).toContain(reading); expect(host.querySelector('[data-cal-status]').textContent).toContain(`${raw}: 10.125, -20.5`); expect(host.querySelector('[data-cal-status]').textContent).toContain(age);
    expect(host.textContent).toContain('Source <literal> été'); expect(host.textContent).toContain('sensor.raw_position'); expect(host.textContent).toContain('Floor <literal> été'); expect(host.querySelector('literal')).toBeNull();
    expect(JSON.stringify(controller.getSource())).toBe(before); expect(JSON.stringify(hass.states)).toBe(readings); expect(options.onChange).not.toHaveBeenCalled(); expect(options.onPlanPick).not.toHaveBeenCalled(); expect(hass.callService).not.toHaveBeenCalled(); expect(hass.callWS).not.toHaveBeenCalled();
  });
  it('keeps focused incomplete real plan edits, all native options and capture control identities while changing every language', () => {
    const { hass, controller, options, host, locale } = setup(), field = host.querySelector('[data-field="trk-cal-plan-x"]');
    field.value = ''; controller.onChange('trk-cal-plan-x', field); field.focus();
    const sourceBefore = JSON.stringify(controller.getSource()), draft = [...controller.planEdits], report = controller.report(), controls = [...host.querySelectorAll('input,select,button')];
    const optionsBefore = [...host.querySelectorAll('option')], capture = host.querySelector('[data-cal-capture]');
    expect(options.onChange).toHaveBeenCalledOnce(); options.onChange.mockClear(); options.onPreview.mockClear();
    for (const language of ['de', 'fr', 'es', 'en']) { locale(language); expect(document.activeElement).toBe(field); expect(field.value).toBe('');
      expect([...host.querySelectorAll('input,select,button')]).toEqual(controls); expect([...host.querySelectorAll('option')]).toEqual(optionsBefore); expect(host.querySelector('[data-cal-capture]')).toBe(capture);
      expect([...controller.planEdits]).toEqual(draft); expect(controller.report()).toEqual(report); expect(JSON.stringify(controller.getSource())).toBe(sourceBefore);
    }
    expect(options.onPreview).not.toHaveBeenCalled(); expect(options.onChange).not.toHaveBeenCalled(); expect(options.onPlanPick).not.toHaveBeenCalled(); expect(hass.callService).not.toHaveBeenCalled();
  });
  it('keeps unknown saved unit and missing floor options selected and distinct, translating only warning prose', () => {
    const { host, controller, locale } = setup({ source: { ...source, units: 'raw_<unit>', floorId: 'raw_<floor>' } });
    const units = host.querySelector('[data-field="trk-cal-units"]'), floor = host.querySelector('[data-field="trk-cal-floorId"]'), u = units.selectedOptions[0], f = floor.selectedOptions[0], raw = JSON.stringify(controller.getSource()); units.focus();
    locale('fr'); expect(units.selectedOptions[0]).toBe(u); expect(floor.selectedOptions[0]).toBe(f); expect(u.disabled).toBe(true); expect(f.disabled).toBe(true);
    expect(u.value).toBe('raw_<unit>'); expect(f.value).toBe('raw_<floor>'); expect(u.textContent).toBe('Unité enregistrée non prise en charge : raw_<unit>'); expect(f.textContent).toBe('Étage manquant : raw_<floor>');
    expect(document.activeElement).toBe(units); expect(JSON.stringify(controller.getSource())).toBe(raw); expect(host.querySelector('unit,floor')).toBeNull();
  });
  it('changes owned capture guidance and pending point captions in place without accepting or recapturing coordinates', () => {
    const { hass, controller, options, host, locale } = setup(); const pending = controller.captureSourcePoint(); expect(pending.raw).toEqual([10.125, -20.5]);
    host.innerHTML = controller.renderHTML(); controller.updatePreviews(host); const field = host.querySelector('[data-field="trk-cal-pending-x"]'); field.value = '7.25'; field.focus();
    const token = controller.pending.token, captured = JSON.stringify(controller.pending), sourceBefore = JSON.stringify(controller.getSource()); options.onChange.mockClear(); options.onPlanPick.mockClear();
    for (const language of ['de', 'fr', 'es']) { locale(language); expect(document.activeElement).toBe(field); expect(field.value).toBe('7.25'); expect(controller.pending.token).toBe(token); expect(JSON.stringify(controller.pending)).toBe(captured); }
    expect(host.querySelector('[data-cal-pending]').textContent).toContain('Capturado 10.125, -20.5. Elija el punto correspondiente en raw_floor.');
    expect(host.querySelector('[data-cal-status]').textContent).toContain('Punto de origen capturado.'); expect(JSON.stringify(controller.getSource())).toBe(sourceBefore); expect(options.onChange).not.toHaveBeenCalled(); expect(options.onPlanPick).not.toHaveBeenCalled(); expect(hass.callService).not.toHaveBeenCalled();
    controller.update({ contextKey: 'replacement_context' }); locale('fr'); expect(controller.pending).toBeNull(); expect(controller.acceptPlanPoint([7.25, 8.5], 'raw_floor', token)).toBe(false); expect(controller.getSource()).toEqual(source);
  });
  it('uses the actual parent Tracking editor with locale changes and incomplete nested coordinates, preventing Save until deliberate valid edits', () => {
    const { hass, options } = setup(); hass.connection = { connected: true }; hass.auth = {}; hass.user = { id: 'raw_admin', is_active: true, is_admin: true };
    const saved = { id: 'raw_robot', entity: 'vacuum.raw_robot', kind: 'xy', position: { x: 0, y: 0, z: 0, floorId: 'raw_floor' }, position_source: structuredClone(source) };
    const card = { _hass: hass, _layout: { vacuum_bindings: [saved] }, _config: { layout_key: 'raw_layout' }, _floors: options.floors, _roomList: [], isConnected: true, _editing: true, _loading: false,
      _edit: { tab: 'tracking' }, _view: { model: { root: { uuid: 'raw_model' } } }, commitFeatureLayout: vi.fn() };
    const host = document.createElement('div'); document.body.append(host); const editor = new TrackingEditor(card, () => { host.innerHTML = editor.render(); editor.updatePreviews(host); }); controllers.push(editor);
    editor.section = 'vacuums'; host.innerHTML = editor.render(); editor.onClick('trk-edit', { dataset: { index: '0' } });
    const field = host.querySelector('[data-field="trk-cal-plan-x"]'); field.value = ''; editor.onInput('trk-cal-plan-x', field); field.focus();
    const before = JSON.stringify(card._layout), draft = JSON.stringify(editor.draft), rawOptions = [...host.querySelectorAll('option')];
    for (const language of ['de', 'fr', 'es', 'en']) { hass.locale.language = language; editor.updatePreviews(host); expect(document.activeElement).toBe(field); expect(field.value).toBe(''); expect(JSON.stringify(editor.draft)).toBe(draft); expect([...host.querySelectorAll('option')]).toEqual(rawOptions); }
    editor.onClick('trk-save', host.querySelector('[data-act="trk-save"]')); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(JSON.stringify(card._layout)).toBe(before); expect(hass.callService).not.toHaveBeenCalled(); expect(hass.callWS).not.toHaveBeenCalled();
  });
});
