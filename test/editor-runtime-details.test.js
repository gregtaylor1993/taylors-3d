// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraEditor } from '../src/camera-editor.js';
import { ModelRenderingEditor } from '../src/model-rendering-editor.js';
import { SecurityEditor } from '../src/security-editor.js';
import { TrackingEditor } from '../src/tracking-editor.js';
import { OverlayEditor } from '../src/overlay-editor.js';
import details, { editorDetailEntries } from '../src/translations/editor-runtime-details.js';
import { editorOwnedMessage, editorDetailText, renderEditorDetails, updateEditorDetails } from '../src/editor-runtime-details.js';

const editors = [];
const camera = { enabled: true, heading: 90, fov: 70, range: 8, color: '#123456', opacity: .14, show_rays: true, extension: { raw: '<kept>' } };
const fixture = () => {
  const connection = new EventTarget(); connection.connected = true;
  const card = { _config: { layout_key: 'exact' }, _layout: { camera_coverage: { 'camera.exact': structuredClone(camera) },
    model_rendering: { shadows: 'realtime', lamps: 'inherit', extension: { raw: '<kept>' } },
    security_bindings: [{ id: 'exact_security', kind: 'lock', entity: 'lock.exact', label: 'Security <literal> été', enabled: true,
      target: { type: 'plan', roomId: 'room_exact' }, extension: { raw: '<kept>' } }],
    presence_bindings: [{ id: 'exact_presence', kind: 'room_activity', entity: 'binary_sensor.motion', signal: 'motion', label: 'Presence <literal> été',
      roomId: 'room_exact', active_states: ['on'], clear_states: ['off'], enabled: true, extension: { raw: '<kept>' } }],
    room_overlays: { mode: 'temperature', unit: '°C', min: 16, max: 28, scale: 'fixed', bindings: { room_exact: { entities: [{ entity: 'sensor.exact' }] } } },
    alert_bindings: [{ id: 'exact_alert', entity: 'binary_sensor.smoke', type: 'smoke', location_mode: 'coordinates', x: 1.25, y: -2.5, z: .4, floor_id: 'floor_exact',
      label: 'Alert <literal> été', extension: { raw: '<kept>' }, clear_rule: 'latched' }] },
  isConnected: true, _editing: true, _loading: false,
  _roomList: [{ name: 'Room <literal> été', floorId: 'floor_exact', room: { id: 'room_exact', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] } }],
  _hass: { locale: { language: 'en' }, connection, auth: {}, user: { id: 'admin', is_active: true, is_admin: true },
    states: { 'camera.exact': { state: 'unknown', attributes: { friendly_name: 'Camera <literal> été' } },
      'lock.exact': { state: 'unlocked', attributes: { friendly_name: 'Lock <literal> été' } },
      'binary_sensor.motion': { state: 'on', attributes: { friendly_name: 'Motion <literal> été', device_class: 'motion' } },
      'sensor.exact': { state: '18.125', attributes: { friendly_name: 'Temperature', device_class: 'temperature', unit_of_measurement: '°C' } },
      'binary_sensor.smoke': { state: 'on', attributes: { friendly_name: 'Smoke <literal> été', device_class: 'smoke' } } },
    areas: {}, entities: {}, devices: {}, callService: vi.fn(), callWS: vi.fn() },
  _view: {}, cameraAnchors: () => [{ id: 'anchor_exact', entity: 'camera.exact', label: 'Anchor <literal> été', shown: true,
    position: { x: 1.25, y: -2.5, z: .3, elevation: 0, floorId: 'floor_exact' } }], _floors: [{ id: 'floor_exact', name: 'Floor <literal> été', elevation: 0 }] };
  card.securityEditorAvailable = () => card._hass.connection.connected && card._hass.user.is_admin && !card._loading;
  card.commitFeatureLayout = vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; }); return card;
};
function mount(scope) {
  const card = fixture(), host = document.createElement('div'); document.body.append(host);
  if (scope === 'tracking') card._edit = { tab: 'tracking', _generation: 1 };
  if (scope === 'overlay') { card._edit = { tab: 'overlays', panel: host }; card._commit = vi.fn((next) => { card._layout = next; }); }
  const Editor = { camera: CameraEditor, shading: ModelRenderingEditor, security: SecurityEditor, tracking: TrackingEditor, overlay: OverlayEditor }[scope];
  const editor = new Editor(card, () => { host.innerHTML = editor.render(); editor.updatePreviews(host); }); editors.push(editor);
  host.addEventListener('input', (event) => editor.onInput?.(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => { const button = event.target.closest('[data-act]'); if (button && !button.disabled) {
    if (scope === 'security') editor.handleClick(event); else editor.onClick(button.dataset.act, button);
  } });
  host.innerHTML = editor.render(); editor.updatePreviews(host);
  if (scope === 'security' || scope === 'tracking') host.querySelector(`[data-act="${scope === 'security' ? 'sec' : 'trk'}-edit"]`).click();
  if (scope === 'overlay') host.querySelector('[data-act="ovr-edit-alert"]').click();
  const locale = (language) => { card._hass.locale.language = language; editor.updatePreviews(host); };
  return { card, editor, host, locale };
}
afterEach(() => { for (const editor of editors.splice(0)) { if (editor instanceof OverlayEditor) editor.reset(); else editor.dispose(); } document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('owned runtime editor details', () => {
  it('has unique identical real keys and exact placeholders in four languages', () => {
    const keys = Object.keys(details.en); expect(keys.length).toBeGreaterThan(60);
    expect(new Set(editorDetailEntries.map((entry) => entry.key)).size).toBe(keys.length);
    for (const language of ['de', 'fr', 'es']) {
      expect(Object.keys(details[language])).toEqual(keys);
      for (const key of keys) {
        expect(details[language][key].trim()).not.toBe('');
        expect([...details[language][key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()).toEqual([...details.en[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort());
      }
    }
  });
  it('requires exact code and original message, leaving external/imported diagnostics literal', () => {
    const hass = { locale: { language: 'fr' } }, owned = 'Coverage opacity must be between 0 and 1.';
    expect(editorOwnedMessage(hass, { code: 'opacity', message: owned })).toBe('L’opacité de couverture doit être comprise entre 0 et 1.');
    expect(editorOwnedMessage(hass, { code: 'external', message: owned })).toBe(owned);
    expect(editorOwnedMessage(hass, { code: 'opacity', message: '<external> été' })).toBe('<external> été');
    const getter = vi.fn(() => owned); expect(editorOwnedMessage(hass, { code: 'opacity', get message() { return getter(); } })).toBe(''); expect(getter).not.toHaveBeenCalled();
    expect(editorDetailText(hass, 'camera.heading', { heading: '90 <literal>' })).toBe('90 <literal>° dans le sens horaire depuis le nord');
    expect(editorDetailText(hass, 'camera.heading', { get heading() { return getter(); } })).toBe(''); expect(getter).not.toHaveBeenCalled();
    expect(editorOwnedMessage(hass, new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('external diagnostic'); } }))).toBe('');
  });
  it('uses a bounded indexed caption walk and excludes raw names even when they match owned English words', () => {
    const root = document.createElement('div'); root.innerHTML = renderEditorDetails('<div class="taylors3d-overlay-editor"><div class="sub">Room measurements</div><label>Room <select data-field="ovr-room"><option value="raw_room">Room measurements</option></select></label><p data-user-text>Room measurements</p></div>', { locale: { language: 'en' } });
    const select = root.querySelector('select'), option = select.options[0], user = root.querySelector('[data-user-text]'), queries = vi.spyOn(root, 'querySelectorAll');
    updateEditorDetails(root, { locale: { language: 'fr' } }); expect(queries).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.sub').textContent).toBe('Mesures des pièces'); expect(select.closest('label').textContent).toContain('Pièce');
    expect(option.textContent).toBe('Room measurements'); expect(user.textContent).toBe('Room measurements'); expect(select.options[0]).toBe(option);
  });

  it.each([
    ['en', 'These choices do not bake new shadows', 'This filters choices only.', 'Currently applied:'],
    ['de-DE', 'Diese Optionen berechnen keine gebackenen Schatten', 'Dies filtert nur die Auswahl.', 'Aktuell angewendet:'],
    ['fr-FR', 'Ces options ne précalculent pas les ombres', 'Cela filtre uniquement les choix.', 'Actuellement appliqué :'],
    ['es-ES', 'Estas opciones no precalculan sombras', 'Esto solo filtra las opciones.', 'Aplicado actualmente:'],
  ])('updates real camera and shading owned help/current-source in %s', (language, shadingHelp, cameraHelp, current) => {
    const a = mount('camera'), b = mount('shading'); a.locale(language); b.locale(language);
    expect(a.host.querySelector('[data-editor-detail="camera.filterHelp"]').textContent).toContain(cameraHelp);
    expect(b.host.querySelector('[data-editor-detail="shading.intro"]').textContent).toContain(shadingHelp);
    expect(b.host.querySelector('[data-model-rendering-status]').textContent).toContain(current);
    expect(a.host.textContent).toContain('Camera <literal> été'); expect(a.host.textContent).toContain('Anchor <literal> été');
    expect(a.host.textContent).toContain('unknown'); expect(a.host.querySelector('literal')).toBeNull();
    for (const { card } of [a, b]) { expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled(); }
  });
  it.each(['camera', 'shading'])('preserves the focused %s control, draft, option identity and held Save through four languages', (scope) => {
    const { card, editor, host, locale } = mount(scope);
    const field = scope === 'camera' ? 'cov-range' : 'model-rendering-preset', action = scope === 'camera' ? 'cov-save' : 'model-rendering-save';
    const control = host.querySelector(`[data-field="${field}"]`); control.value = scope === 'camera' ? '12.5' : 'shadows-only';
    control.dispatchEvent(new Event(scope === 'camera' ? 'input' : 'change', { bubbles: true })); control.focus();
    const draft = JSON.stringify(editor.draft), saved = JSON.stringify(card._layout), readings = JSON.stringify(card._hass.states), options = control.options ? [...control.options] : [];
    const save = host.querySelector(`[data-act="${action}"]`), help = host.querySelector('[data-editor-detail]');
    for (const language of ['de', 'fr', 'es', 'en']) {
      locale(language); expect(document.activeElement).toBe(control); expect(host.querySelector(`[data-field="${field}"]`)).toBe(control);
      expect(host.querySelector(`[data-act="${action}"]`)).toBe(save); expect(host.querySelector('[data-editor-detail]')).toBe(help);
      expect(control.options ? [...control.options] : []).toEqual(options); expect(JSON.stringify(editor.draft)).toBe(draft);
    }
    save.focus(); save.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); locale('fr');
    expect(document.activeElement).toBe(save); expect(save.disabled).toBe(false); expect(JSON.stringify(card._layout)).toBe(saved); expect(JSON.stringify(card._hass.states)).toBe(readings);
    save.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); save.click(); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
    if (scope === 'camera') expect(card._layout.camera_coverage['camera.exact']).toEqual({ ...camera, range: 12.5 });
    else expect(card._layout.model_rendering).toEqual({ shadows: 'realtime', lamps: 'off', extension: { raw: '<kept>' } });
  });
  it('keeps an invalid raw camera draft and localizes only its owned validation display', () => {
    const { card, editor, host, locale } = mount('camera'), input = host.querySelector('[data-field="cov-opacity"]');
    input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
    const draft = JSON.stringify(editor.draft), messages = editor._evaluation().diagnostics;
    locale('fr'); expect(host.querySelector('[data-cov-preview]').textContent).toContain('L’opacité de couverture doit être comprise entre 0 et 1.');
    expect(editor._evaluation().diagnostics).toEqual(messages); expect(document.activeElement).toBe(input); expect(JSON.stringify(editor.draft)).toBe(draft);
    host.querySelector('[data-act="cov-save"]').click(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Choisissez des paramètres valides ; rien n’a été enregistré.');
    editor.message = '<external> été'; editor.updatePreviews(host); expect(host.textContent).toContain('<external> été'); expect(host.querySelector('external')).toBeNull();
  });
  it('cannot apply a dirty shading choice after current model/settings or permission changes', () => {
    const { card, editor, host, locale } = mount('shading'), control = host.querySelector('[data-field="model-rendering-preset"]');
    control.value = 'authored'; control.dispatchEvent(new Event('change', { bubbles: true }));
    const draft = JSON.stringify(editor.draft), save = host.querySelector('[data-act="model-rendering-save"]'); save.focus();
    card._config.model = 'literal-replacement.glb'; card._hass.user.is_admin = false; locale('fr');
    expect(host.textContent).toContain('Seul un administrateur peut enregistrer les paramètres du plan.'); expect(host.textContent).toContain('Votre choix est conservé.');
    expect(host.querySelector('[data-act="model-rendering-save"]')).toBe(save); expect(save.disabled).toBe(true);
    expect(JSON.stringify(editor.draft)).toBe(draft); save.click(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('translates loaded-model evidence while preserving exact GLB names, slots, UV attributes and numbers', () => {
    const { card, host, locale } = mount('shading');
    const material = { isMaterial: true, uuid: 'raw_material', name: 'Material <literal>', aoMap: { isTexture: true, channel: 0 } };
    const mesh = { isMesh: true, uuid: 'raw_mesh', name: 'Mesh <literal>', material, geometry: { attributes: { position: { count: 3 } } } };
    card._view.model = { root: { isObject3D: true, traverse: (visit) => visit(mesh) } }; locale('fr');
    const report = host.querySelector('[data-model-rendering-report]'); expect(report.textContent).toContain('Modèle chargé : 1 maillages · 1 matériaux distincts.');
    expect(report.textContent).toContain('Mesh <literal> · Material <literal>: aoMap nécessite uv.');
    expect(report.textContent).toContain('aoMap'); expect(report.textContent).toContain('uv'); expect(report.querySelector('literal')).toBeNull();
    expect(material.name).toBe('Material <literal>'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each([
    ['en', 'Unlocking never means a door is open.', 'Editing changes this layout only;', 'Unlocked reported'],
    ['de', 'Entriegelt bedeutet niemals offen.', 'Die Bearbeitung ändert nur dieses Layout;', 'Entriegelt gemeldet'],
    ['fr', 'Déverrouillé ne signifie jamais que la porte est ouverte.', 'L’édition modifie uniquement ce plan ;', 'Déverrouillé signalé'],
    ['es', 'Desbloquear nunca significa que la puerta esté abierta.', 'Editar solo cambia este diseño;', 'Desbloqueado comunicado'],
  ])('renders actual Security/Tracking guidance and evidence in %s while retaining literal source readings', (language, securityHelp, trackingHelp, evidence) => {
    const a = mount('security'), b = mount('tracking'); a.locale(language); b.locale(language);
    expect(a.host.querySelector('[data-editor-detail="security.intro"]').textContent).toContain(securityHelp);
    expect(b.host.querySelector('[data-editor-detail="tracking.intro"]').textContent).toContain(trackingHelp);
    expect(a.host.querySelector('[data-security-preview]').textContent).toContain(evidence);
    expect(a.host.textContent).toContain('Lock <literal> été'); expect(b.host.textContent).toContain('Presence <literal> été');
    expect(b.host.textContent).toContain('binary_sensor.motion'); expect(b.host.textContent).toContain('on');
    for (const { card, host } of [a, b]) { expect(host.querySelector('literal')).toBeNull(); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); }
  });
  it.each(['security', 'tracking'])('updates %s help without replacing an unfinished native field or accepting a stale Save', (scope) => {
    const { card, host, editor, locale } = mount(scope), prefix = scope === 'security' ? 'sec' : 'trk';
    const input = host.querySelector(`[data-field="${prefix}-label"]`), save = host.querySelector(`[data-act="${prefix}-save"]`);
    input.value = 'New <literal> été'; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
    const draft = JSON.stringify(editor.draft), original = JSON.stringify(card._layout), nativeOptions = [...host.querySelector(`[data-field="${prefix}-entity"]`).options];
    for (const language of ['de', 'fr', 'es', 'en']) {
      locale(language); expect(host.querySelector(`[data-field="${prefix}-label"]`)).toBe(input); expect(document.activeElement).toBe(input);
      expect([...host.querySelector(`[data-field="${prefix}-entity"]`).options]).toEqual(nativeOptions); expect(JSON.stringify(editor.draft)).toBe(draft);
    }
    save.focus(); save.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    card._hass.user.is_admin = false; locale('de'); card._hass.user.is_admin = true; locale('fr'); save.click();
    expect(JSON.stringify(card._layout)).toBe(original); expect(JSON.stringify(editor.draft)).toBe(draft); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it.each([
    ['en', 'Colour rooms by', 'Temperature', 'Save alert', 'These views display sensor readings;', '18.125 °C'],
    ['de', 'Räume einfärben nach', 'Temperatur', 'Alarm speichern', 'Diese Ansichten zeigen Sensorwerte', '18,125 °C'],
    ['fr', 'Colorer les pièces selon', 'Température', 'Enregistrer l’alerte', 'Ces vues affichent les capteurs', '18,125 °C'],
    ['es', 'Colorear habitaciones según', 'Temperatura', 'Guardar alerta', 'Estas vistas muestran lecturas', '18,125 °C'],
  ])('updates actual Overlay captions and guidance in %s while HA names, raw units, states and coordinates remain literal', (language, field, choice, button, help, formatted) => {
    const { card, editor, host, locale } = mount('overlay'); const original = JSON.stringify(card._layout), readings = JSON.stringify(card._hass.states);
    locale(language);
    const mode = host.querySelector('[data-field="ovr-mode"]'); expect(mode.closest('label').textContent).toContain(field); expect(mode.selectedOptions[0].textContent).toBe(choice);
    expect(host.querySelector('[data-act="ovr-save-alert"]').textContent).toBe(button); expect(host.querySelector('[data-editor-detail="overlay.intro"]').textContent).toContain(help);
    expect(host.querySelector('[data-ovr-source-name]').textContent).toBe('Temperature'); expect(host.querySelector('[data-ovr-source-reading]').textContent).toBe(formatted);
    expect(host.querySelector('[data-ovr-preview="measure"]').textContent).toContain('18.13 °C'); expect(host.querySelector('[data-ovr-preview="alert"]').textContent).toContain('on');
    expect(editor.draftAlert.x).toBe(1.25); expect(editor.draftAlert.floor_id).toBe('floor_exact'); expect(host.querySelector('literal')).toBeNull();
    expect(JSON.stringify(card._layout)).toBe(original); expect(JSON.stringify(card._hass.states)).toBe(readings);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('keeps the unfinished Overlay native decimal, raw source options and held eligible Save through all locales', () => {
    const { card, editor, host, locale } = mount('overlay'), x = host.querySelector('[data-field="ovr-alert-x"]'), save = host.querySelector('[data-act="ovr-save-alert"]');
    x.value = '1.20'; x.dispatchEvent(new Event('input', { bubbles: true })); x.focus();
    const draft = JSON.stringify(editor.draftAlert), saved = JSON.stringify(card._layout), select = host.querySelector('[data-field="ovr-alert-entity"]'), options = [...select.options];
    for (const language of ['de', 'fr', 'es', 'en']) { locale(language); expect(document.activeElement).toBe(x); expect(host.querySelector('[data-field="ovr-alert-x"]')).toBe(x);
      expect(x.value).toBe('1.20'); expect([...select.options]).toEqual(options); expect(JSON.stringify(editor.draftAlert)).toBe(draft); }
    save.focus(); save.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); locale('fr');
    expect(document.activeElement).toBe(save); expect(host.querySelector('[data-act="ovr-save-alert"]')).toBe(save); expect(save.disabled).toBe(false); expect(JSON.stringify(card._layout)).toBe(saved);
    save.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); save.click(); expect(card.commitFeatureLayout).toHaveBeenCalledOnce();
    expect(card._layout.alert_bindings[0]).toMatchObject({ x: 1.2, y: -2.5, entity: 'binary_sensor.smoke', floor_id: 'floor_exact', extension: { raw: '<kept>' } });
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('keeps duplicate disabled Overlay warning options distinct through locale changes', () => {
    const { card, editor, host, locale } = mount('overlay');
    const rows = [['', 'Choose a sensor'], ['sensor.duplicate', 'Warning A <literal>', false], ['sensor.duplicate', 'Warning B <literal>', false]];
    vi.spyOn(editor, '_alertEntityChoices').mockReturnValue(rows); editor.updatePreviews(host);
    const select = host.querySelector('[data-field="ovr-alert-entity"]'), duplicates = [...select.options].filter((option) => option.value === 'sensor.duplicate');
    expect(duplicates.length).toBe(2); locale('de'); locale('fr');
    expect([...select.options].filter((option) => option.value === 'sensor.duplicate')).toEqual(duplicates);
    expect(duplicates.map((option) => [option.textContent, option.disabled])).toEqual([['Warning A <literal>', true], ['Warning B <literal>', true]]);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('keeps stale Overlay Save fenced through role loss/recovery and locale changes, with a fresh gesture still possible', () => {
    const { card, editor, host, locale } = mount('overlay'), x = host.querySelector('[data-field="ovr-alert-x"]');
    x.value = '1.20'; x.dispatchEvent(new Event('input', { bubbles: true })); const save = host.querySelector('[data-act="ovr-save-alert"]');
    save.focus(); save.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    card._hass.user.is_admin = false; locale('de'); card._hass.user.is_admin = true; locale('fr'); save.click(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Cet appui sur Enregistrer appartient à un ancien contexte'); expect(editor.draftAlert.x).toBe('1.20');
    const fresh = host.querySelector('[data-act="ovr-save-alert"]'); fresh.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fresh.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); fresh.click(); expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each([
    ['en', 'Saved room raw_<room> is missing.', 'Source binary_sensor.missing_<literal> is missing.', 'Observation source: Maximum reading age must be a positive finite number of seconds.'],
    ['de', 'Gespeicherter Raum raw_<room> fehlt.', 'Quelle binary_sensor.missing_<literal> fehlt.', 'Beobachtungsquelle: Das Höchstalter muss eine positive endliche Sekundenzahl sein.'],
    ['fr', 'La pièce enregistrée raw_<room> manque.', 'Source binary_sensor.missing_<literal> manque.', 'Source d’observation : L’ancienneté maximale doit être un nombre positif et fini de secondes.'],
    ['es', 'Falta la habitación guardada raw_<room>.', 'Falta Origen binary_sensor.missing_<literal>.', 'Fuente de observación: La antigüedad máxima debe ser un número positivo finito de segundos.'],
  ])('localizes only current owned Tracking reference and age displays in %s, preserving exact validator output and raw links', (language, missingRoom, source, freshness) => {
    const { card, editor, host, locale } = mount('tracking');
    editor.draft.roomId = 'raw_<room>'; editor.draft.entity = 'binary_sensor.missing_<literal>';
    editor.draft.freshness = { timestamp_mode: 'last_updated', max_age_seconds: 0 };
    const raw = JSON.stringify(editor.draft), saved = JSON.stringify(card._layout), reference = editor._referenceIssues(), validation = editor._validation();
    expect(reference).toContain('Saved room raw_<room> is missing.'); expect(reference).toContain('Source binary_sensor.missing_<literal> is missing.');
    locale(language); const preview = host.querySelector('[data-trk-preview]');
    expect(preview.textContent).toContain(missingRoom); expect(preview.textContent).toContain(source); expect(preview.textContent).toContain(freshness);
    expect(editor._referenceIssues()).toEqual(reference); expect(editor._validation()).toEqual(validation);
    expect(JSON.stringify(editor.draft)).toBe(raw); expect(JSON.stringify(card._layout)).toBe(saved); expect(preview.querySelector('room,literal')).toBeNull();
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each(['camera', 'tracking'])('retains distinct duplicate native %s warning options in order through language changes', (scope) => {
    const { card, editor, host, locale } = mount(scope), cameraScope = scope === 'camera';
    const choices = [{ value: cameraScope ? 'camera.exact' : 'binary_sensor.motion', entity: cameraScope ? 'camera.exact' : undefined, label: 'Current <literal>', selectable: true },
      { value: 'raw_duplicate', label: 'Warning A <literal>', selectable: false }, { value: 'raw_duplicate', label: 'Warning B <literal>', selectable: false }];
    if (cameraScope) vi.spyOn(editor, 'choices', 'get').mockReturnValue(choices); else vi.spyOn(editor, '_choices').mockReturnValue(choices);
    editor.updatePreviews(host); const field = cameraScope ? 'cov-camera' : 'trk-entity', select = host.querySelector(`[data-field="${field}"]`);
    const original = [...select.options], warnings = original.filter((option) => option.value === 'raw_duplicate'); select.focus();
    for (const language of ['de', 'fr', 'es', 'en']) { locale(language); expect([...select.options]).toEqual(original); expect(document.activeElement).toBe(select); }
    expect(warnings).toHaveLength(2); expect(warnings.map((option) => option.disabled)).toEqual(cameraScope ? [false, false] : [true, true]);
    expect(warnings[0].textContent).toContain('Warning A <literal>'); expect(warnings[1].textContent).toContain('Warning B <literal>');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it('updates indexed Overlay colour captions and accessible source removal text without changing colours, names or native inputs', () => {
    const { card, editor, host, locale } = mount('overlay'); card._layout.room_overlays.palette = ['#102030', '#405060'];
    host.innerHTML = editor.render(); editor.updatePreviews(host); const colour = host.querySelector('[data-field="ovr-palette-stop"]'), remove = host.querySelector('[data-act="ovr-remove-colour"]'); colour.focus();
    const original = JSON.stringify(card._layout); locale('fr');
    expect(colour.closest('label').textContent).toContain('Couleur 1'); expect(remove.textContent).toBe('Supprimer la couleur 1');
    expect(host.querySelector('[data-act="ovr-remove-source"]').getAttribute('aria-label')).toBe('Supprimer Temperature');
    expect(document.activeElement).toBe(colour); expect(colour.value).toBe('#102030'); expect(host.querySelector('[data-act="ovr-remove-colour"]')).toBe(remove);
    expect(JSON.stringify(card._layout)).toBe(original); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each([
    ['de', 'Fehlend Raum: raw_<room>'], ['fr', 'pièce manquant : raw_<room>'], ['es', 'Falta habitación: raw_<room>'],
  ])('keeps raw Security target IDs while translating only the missing-choice warning in %s', (language, expected) => {
    const { card, editor, host, locale } = mount('security'); editor.draft.target.roomId = 'raw_<room>'; editor.relinking = true; host.innerHTML = editor.render(); editor.updatePreviews(host);
    const select = host.querySelector('[data-field="sec-plan-room"]'), option = select.selectedOptions[0]; select.focus(); const raw = JSON.stringify(editor.draft), saved = JSON.stringify(card._layout);
    locale(language); expect(select.selectedOptions[0]).toBe(option); expect(option.value).toBe('raw_<room>'); expect(option.textContent).toBe(expected); expect(option.disabled).toBe(true);
    expect(document.activeElement).toBe(select); expect(JSON.stringify(editor.draft)).toBe(raw); expect(JSON.stringify(card._layout)).toBe(saved); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each([
    ['de', 'Nicht unterstützter gespeicherter Typ: future<type>', 'Gespeicherte Zuordnung 2', 'Unbekannter Typ'],
    ['fr', 'Type enregistré non pris en charge : future<type>', 'Lien enregistré 2', 'Type inconnu'],
    ['es', 'Tipo guardado no compatible: future<type>', 'Vínculo guardado 2', 'Tipo desconocido'],
  ])('translates authored missing-row and unsupported-type prefixes in %s while preserving raw unknown data and native options', (language, warning, savedCaption, unknownCaption) => {
    const { card, editor, host, locale } = mount('tracking'); editor.draft.kind = 'future<type>'; card._layout.presence_bindings.push({});
    host.innerHTML = editor.render(); editor.updatePreviews(host); const select = host.querySelector('[data-field="trk-kind"]'), option = select.selectedOptions[0], saved = JSON.stringify(card._layout), raw = JSON.stringify(editor.draft);
    expect(option.value).toBe('future<type>'); expect(option.textContent).toBe('Unsupported saved type: future<type>'); select.focus(); locale(language);
    expect(select.selectedOptions[0]).toBe(option); expect(option.value).toBe('future<type>'); expect(option.textContent).toBe(warning);
    expect(host.textContent).toContain(savedCaption); expect(host.textContent).toContain(unknownCaption); expect(host.textContent).toContain('Presence <literal> été'); expect(host.querySelector('type,literal')).toBeNull();
    expect(document.activeElement).toBe(select); expect(JSON.stringify(editor.draft)).toBe(raw); expect(JSON.stringify(card._layout)).toBe(saved); expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
});
