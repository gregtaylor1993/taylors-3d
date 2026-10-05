// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecurityEditor } from '../src/security-editor.js';
import { TrackingEditor } from '../src/tracking-editor.js';
import { CameraEditor } from '../src/camera-editor.js';
import { ModelRenderingEditor } from '../src/model-rendering-editor.js';
import advanced, { advancedCaptionEntries, renderAdvancedCaptions, updateAdvancedCaptions } from '../src/translations/advanced-settings.js';
import { localize } from '../src/localization.js';

const editors = [];
const state = (value, friendly_name, extra = {}) => ({ state: value, attributes: { friendly_name, ...extra } });
const security = { id: 'exact_security', label: 'Save', kind: 'lock', entity: 'lock.actual', enabled: true,
  target: { type: 'plan', position: { x: 1.25, y: -2.5, z: .4, floorId: 'floor_exact' } },
  extension: { source: '<literal>', keep: [null, 3] } };
const activity = { id: 'exact_presence', label: 'Save', kind: 'room_activity', entity: 'binary_sensor.motion',
  signal: 'motion', enabled: true, roomId: 'room_exact', active_states: ['on'], clear_states: ['off'],
  extension: { exact: '<literal>', retained: null } };
const coverage = { enabled: true, heading: 90, fov: 70, range: 8, color: '#123456', opacity: .14,
  show_rays: true, segments: 24, extension: { keep: null } };
function fixture(language = 'en') {
  const connection = new EventTarget(); connection.connected = true;
  const card = { isConnected: true, _editing: true, _loading: false, _config: { layout_key: 'exact-layout' },
    _layout: { security_bindings: [structuredClone(security)], presence_bindings: [structuredClone(activity)],
      camera_coverage: { 'camera.actual': structuredClone(coverage) }, model_rendering: { shadows: 'realtime', lamps: 'inherit', extension: { exact: 3 } } },
    _view: { model: null }, _floors: [{ id: 'floor_exact', name: 'All areas', elevation: 0 }],
    _roomList: [{ name: 'Door, window and lock security', floorId: 'floor_exact',
      room: { id: 'room_exact', area_id: 'area_exact', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] } }],
    _hass: { connection, auth: {}, user: { id: 'actual-admin', is_active: true, is_admin: true }, language, locale: { language },
      states: { 'lock.actual': state('unlocked', 'Lock'), 'binary_sensor.motion': state('on', 'Marker appearance', { device_class: 'motion' }),
        'camera.actual': state('idle', 'Camera coverage'), 'sensor.unrelated': state('12.345', '<HA reading>') },
      entities: { 'lock.actual': { area_id: 'area_exact' }, 'binary_sensor.motion': { area_id: 'area_exact' }, 'camera.actual': { area_id: 'area_exact' } },
      areas: { area_exact: { name: 'All areas', floor_id: 'floor_exact' } }, devices: {},
      callService: vi.fn(), callWS: vi.fn(), formatEntityState: () => '<HA exact reading>' },
    securityEditorAvailable: () => card._hass.connection.connected && card._hass.user.is_admin && !card._loading,
    cameraAnchors: () => [{ id: 'actual-anchor', entity: 'camera.actual', label: 'Save <literal>', shown: true,
      position: { x: 2, y: 3, z: 1.2, floorId: 'floor_exact', elevation: 0 } }],
    trackingAnchors: () => [{ id: 'exact_marker', label: 'Camera coverage', position: { x: 1, y: 2, z: 0, floorId: 'floor_exact' } }],
  };
  card.commitFeatureLayout = vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; });
  return card;
}
function setup(scope, language = 'en') {
  const card = fixture(language), host = document.createElement('div'); document.body.append(host);
  // The standalone host models the actual active tracking tab; native tracking
  // controls correctly reject a host that is outside its owning editor.
  if (scope === 'tracking') card._edit = { tab: 'tracking', _generation: 1 };
  const classes = { security: SecurityEditor, tracking: TrackingEditor, camera: CameraEditor, shading: ModelRenderingEditor };
  const editor = new classes[scope](card, () => { host.innerHTML = editor.render(); editor.updatePreviews(host); }); editors.push(editor);
  host.addEventListener('change', (event) => { editor.onChange(event.target.dataset.field, event.target); editor.updatePreviews(host); });
  host.addEventListener('input', (event) => editor.onInput?.(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const button = event.target.closest('[data-act]'); if (!button || button.disabled) return;
    if (scope === 'security' || scope === 'camera') editor.handleClick(event); else editor.onClick(button.dataset.act, button); });
  host.innerHTML = editor.render(); editor.updatePreviews(host);
  if (scope === 'security' || scope === 'tracking') host.querySelector(`[data-act="${scope === 'security' ? 'sec' : 'trk'}-edit"]`).click();
  const locale = (language) => { card._hass.locale.language = language; card._hass.language = language; editor.updatePreviews(host); };
  return { card, editor, host, locale };
}
afterEach(() => { for (const editor of editors.splice(0)) editor.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('advanced static editor captions', () => {
  it('has identical stable keys and nonempty real text in all four bundled dictionaries', () => {
    const keys = Object.keys(advanced.en); expect(keys.length).toBeGreaterThan(200);
    expect(new Set(advancedCaptionEntries.map((entry) => entry.key)).size).toBe(advancedCaptionEntries.length);
    for (const language of ['de', 'fr', 'es']) {
      expect(Object.keys(advanced[language])).toEqual(keys);
      expect(Object.values(advanced[language]).every((value) => typeof value === 'string' && value.trim())).toBe(true);
    }
    expect(localize({ locale: { language: 'de-DE' } }, 'advanced.security.kind.lock')).toBe('Schloss');
    expect(localize({ locale: { language: 'fr-FR' } }, 'advanced.camera.title')).toBe('Couverture de la caméra');
    expect(localize({ locale: { language: 'es' } }, 'advanced.tracking.section.vehicles')).toBe('Vehículos en la entrada');
  });

  it.each([
    ['security', 'Sécurité des portes, fenêtres et serrures'], ['tracking', 'Suivi'],
    ['camera', 'Couverture de la caméra'], ['shading', 'Ombrage du modèle'],
  ])('renders %s in the current locale without changing saved inputs or readings', (scope, title) => {
    const { host, card } = setup(scope, 'fr-FR');
    expect(host.querySelector('h3').textContent).toBe(title);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
    expect(card._hass.states['lock.actual'].state).toBe('unlocked');
    expect(card._hass.states['camera.actual'].attributes.friendly_name).toBe('Camera coverage');
  });

  it.each([
    ['security', 'sec-label', 'sec-save', 'Label', 'Beschriftung'],
    ['tracking', 'trk-label', 'trk-save', 'Display label (optional)', 'Anzeigebeschriftung (optional)'],
    ['camera', 'cov-range', 'cov-save', 'Approximate range, metres', 'Ungefähre Reichweite, Meter'],
  ])('keeps the actual unfinished %s field, caption and button across locale changes', (scope, field, action, english, german) => {
    const { host, editor, card, locale } = setup(scope), input = host.querySelector(`[data-field="${field}"]`), button = host.querySelector(`[data-act="${action}"]`);
    const label = input.closest('label').querySelector('[data-advanced-caption]'); expect(label.textContent).toBe(english);
    input.focus(); input.value = scope === 'camera' ? '12.5' : '<User literal> Save'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const value = input.value, draft = JSON.stringify(editor.draft), saved = JSON.stringify(card._layout), readings = JSON.stringify(card._hass.states);
    locale('de-DE');
    expect(host.querySelector(`[data-field="${field}"]`)).toBe(input); expect(document.activeElement).toBe(input);
    expect(input.closest('label').querySelector('[data-advanced-caption]')).toBe(label); expect(label.textContent).toBe(german);
    expect(host.querySelector(`[data-act="${action}"]`)).toBe(button); expect(button.textContent).toBe('Speichern'); expect(input.value).toBe(value);
    locale('es'); locale('en'); expect(label.textContent).toBe(english);
    expect(JSON.stringify(editor.draft)).toBe(draft); expect(JSON.stringify(card._layout)).toBe(saved); expect(JSON.stringify(card._hass.states)).toBe(readings);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('keeps a dirty native shading select, exact option values and Save identity while relabeling all four choices', () => {
    const { host, card, editor, locale } = setup('shading');
    const select = host.querySelector('[data-field="model-rendering-preset"]'), button = host.querySelector('[data-act="model-rendering-save"]');
    select.value = 'shadows-only'; select.dispatchEvent(new Event('change', { bubbles: true })); select.focus();
    const options = [...select.options], draft = JSON.stringify(editor.draft); locale('fr');
    expect(document.activeElement).toBe(select); expect([...select.options]).toEqual(options);
    expect(select.value).toBe('shadows-only'); expect(select.selectedOptions[0].textContent).toBe('Ombres en temps réel (lampes éteintes)');
    expect(host.querySelector('[data-act="model-rendering-save"]')).toBe(button); expect(button.textContent).toBe('Enregistrer l’ombrage');
    expect(JSON.stringify(editor.draft)).toBe(draft); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    button.click(); expect(card.commitFeatureLayout).toHaveBeenCalledExactlyOnceWith({ model_rendering: { shadows: 'realtime', lamps: 'off', extension: { exact: 3 } } });
  });

  it('keeps invalid imported shading raw while relabeling its rebuilt read-only option', () => {
    const { host, card, editor, locale } = setup('shading');
    const imported = { shadows: 'future-policy', lamps: 'inherit', extension: { exact: '<unchanged>' } };
    card._layout.model_rendering = imported; editor.reset(); host.innerHTML = editor.render(); editor.updatePreviews(host);
    const select = host.querySelector('[data-field="model-rendering-preset"]'); select.focus(); locale('fr');
    expect(document.activeElement).toBe(select); expect(select.value).toBe('invalid'); expect(select.selectedOptions[0].disabled).toBe(true);
    expect(select.selectedOptions[0].textContent).toBe('Paramètres enregistrés invalides — choisir un remplacement');
    locale('de'); expect(select.selectedOptions[0].textContent).toBe('Ungültige gespeicherte Einstellungen — Ersatz wählen');
    expect(card._layout.model_rendering).toBe(imported); expect(editor.draft).toEqual(imported);
    expect(host.querySelector('[data-act="model-rendering-save"]').disabled).toBe(true); expect(host.querySelector('unchanged')).toBeNull();
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each(['security', 'tracking', 'camera'])('translates only built-in %s options even when HA names equal English captions', (scope) => {
    const { host, locale } = setup(scope); locale('de');
    const area = host.querySelector(`[data-field="${scope === 'security' ? 'sec-picker-area' : scope === 'tracking' ? 'trk-area-filter' : 'cov-area-filter'}"]`);
    expect(area.querySelector('option[value="all"]').textContent).toBe('Alle Bereiche');
    expect(area.querySelector('option[value="area:area_exact"]').textContent).toBe('All areas');
    const entity = host.querySelector(`[data-field="${scope === 'security' ? 'sec-entity' : scope === 'tracking' ? 'trk-entity' : 'cov-camera'}"]`);
    const selected = entity.selectedOptions[0];
    expect(selected.textContent).toContain(scope === 'security' ? 'Lock' : scope === 'tracking' ? 'Marker appearance' : 'Camera coverage');
    expect(selected.hasAttribute('data-advanced-option')).toBe(false); expect(host.querySelector('literal')).toBeNull();
  });

  it('keeps the real security Save held intent through localization and submits the original source exactly once', () => {
    const { host, card, locale } = setup('security'), input = host.querySelector('[data-field="sec-label"]');
    input.value = 'User exact'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const save = host.querySelector('[data-act="sec-save"]'); save.focus(); save.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    locale('fr'); expect(document.activeElement).toBe(save); save.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); save.click();
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(card._layout.security_bindings).toEqual([{ ...security, label: 'User exact' }]);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('cannot revive a poisoned security Save when permission and locale recover', () => {
    const { host, card, locale } = setup('security'), input = host.querySelector('[data-field="sec-label"]');
    input.value = 'User exact'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const save = host.querySelector('[data-act="sec-save"]'); save.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    card._hass.user.is_admin = false; locale('de'); card._hass.user.is_admin = true; locale('fr'); save.click();
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._layout.security_bindings[0]).toEqual(security);
  });

  it('preserves malformed saved options, raw validation and HA readings while translating owned diagnostics', () => {
    const { host, editor, card, locale } = setup('tracking'); editor.draft.kind = 'future<type>'; editor.draft.extension = { retained: null };
    host.innerHTML = editor.render(); editor.updatePreviews(host); const raw = JSON.stringify(editor.draft), before = host.querySelector('[data-trk-preview]').textContent;
    const kind = host.querySelector('[data-field="trk-kind"]'), unsupported = kind.selectedOptions[0];
    expect(unsupported.textContent).toBe('Unsupported saved type: future<type>');
    const rawValidation = structuredClone(editor._validation());
    expect([...host.querySelectorAll('[data-trk-preview] li')].map((node) => node.textContent)).toEqual([
      'This saved tracking type is unsupported. Clear it and create an explicit binding.',
      'Choose an actual source entity for this tracking type.',
    ]);
    locale('es'); expect(host.querySelector('[data-field="trk-kind"]')).toBe(kind);
    expect(kind.selectedOptions[0]).toBe(unsupported); expect(kind.value).toBe('future<type>');
    expect(unsupported.textContent).toBe('Tipo guardado no compatible: future<type>');
    expect([...host.querySelectorAll('[data-trk-preview] li')].map((node) => node.textContent)).toEqual([
      'Este tipo de seguimiento guardado no es compatible. Elimínelo y cree un vínculo explícito.',
      'Elija una entidad real de origen para este tipo de seguimiento.',
    ]);
    expect(editor._validation()).toEqual(rawValidation);
    expect(before).toContain('<HA exact reading>'); expect(host.querySelector('[data-trk-preview]').textContent).toContain('<HA exact reading>');
    expect(host.querySelector('[data-trk-preview]').textContent).toContain('Los nombres de habitación deben comunicarse por la fuente elegida.');
    expect(JSON.stringify(editor.draft)).toBe(raw); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(host.querySelector('type')).toBeNull();
  });

  it('falls back to unchanged English captions and never evaluates or injects translated text as HTML', () => {
    const root = document.createElement('div'); root.innerHTML = renderAdvancedCaptions('<h3>Camera coverage</h3><label>Camera<select data-field="cov-camera"><option value="camera.real">Camera coverage</option></select></label>', 'camera', (key, fallback) => localize({ locale: { language: 'it-IT' } }, key, {}, fallback));
    const select = root.querySelector('select'); expect(root.querySelector('h3').textContent).toBe('Camera coverage');
    updateAdvancedCaptions(root, 'camera', () => '<img src=x onerror=alert(1)>');
    expect(root.querySelector('img')).toBeNull(); expect(root.querySelector('h3').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector('select')).toBe(select); expect(select.options[0].textContent).toBe('Camera coverage');
  });
});
