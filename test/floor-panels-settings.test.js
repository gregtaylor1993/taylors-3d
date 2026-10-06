// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOOR_PRESENTATION_DEFAULTS, readFloorPresentation, compileFloorPresentation } from '../src/floor-presentation.js';
import { FloorPresentationEditor } from '../src/floor-presentation-editor.js';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';
import messages from '../src/translations/editor-presentation-scenes.js';

const owned = [];
const floors = () => [{ id: 'ground', name: 'Ground floor', elevation: 0 }, { id: 'first', name: 'First floor', elevation: 3 }];
const policy = (extra = {}) => ({ mode: 'horizontal', floors: ['ground', 'first'], gap_m: 2, axis: 'east', base_elevation_m: 0, ...extra });
const evidence = () => ({ floors: floors(), bounds: [{ floor_id: 'ground', min: [-3, 0, -4], max: [5, 2.7, 4] },
  { floor_id: 'first', min: [-2, 3, -3], max: [4, 5.7, 3] }], model: { present: true, supported: true } });

function fixture({ raw, config = {}, full = false, language = 'en' } = {}) {
  const card = { isConnected: true, _editing: true, _config: { layout_key: 'test-house', ...config },
    _layout: { rooms: [], pins: {}, floors: floors(), ...(raw === undefined ? {} : { floor_presentation: structuredClone(raw) }) },
    _floors: floors(), _roomList: [], _floor: 'ground', _mode: 'top', _built: {}, _markers: [], _positions: new Map(),
    _store: { backend: 'browser' }, _stage: document.createElement('div'), _history: new EditHistory(),
    _hass: { locale: { language }, user: { id: 'test-admin', is_admin: true, is_active: true }, connection: { connected: true },
      states: {}, entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn(), callWS: vi.fn() },
    _applyMarkerSelection: vi.fn(), modelBindings: () => null, _modelAlign: () => ({ scale: 1 }), finishWallSelectionPreparation: vi.fn(),
    floorPresentationReport: () => ({ mode: 'assembled', panels: false, valid: true, diagnostics: [] }),
    _view: { model: null, floorElevation: (id) => card._floors.find((floor) => floor.id === id)?.elevation,
      setOverlay: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn(), setControlsEnabled: vi.fn(), highlightModelNode: vi.fn(),
      setFloorPresentation: vi.fn(), setCamera: vi.fn(), planPoint: () => [1, 1], pickModel: () => null, pixelsPerMetre: () => 10 } };
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  let editor, edit, host;
  const render = () => {
    if (full) edit.render();
    else { host.innerHTML = editor.render(); editor.updatePreviews(host); }
  };
  card._commit = vi.fn((value, label) => { card._layout = value; card._history.record(snapshot(), label); edit?.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch, label) => card._commit({ ...card._layout, ...patch }, label));
  card.undoEdit = vi.fn(() => { const state = card._history.undo(); if (state) card._layout = state.layout; render(); });
  card.redoEdit = vi.fn(() => { const state = card._history.redo(); if (state) card._layout = state.layout; render(); });
  if (full) {
    edit = new EditMode(card); card._edit = edit; edit.render(); card._stage.append(edit.panel); document.body.append(card._stage); edit.attach();
    edit.panel.querySelector('[data-act="tab"][data-id="model"]').click(); host = edit.panel; editor = edit._floorPresentationEditor;
  } else {
    card._edit = { tab: 'model' }; host = document.createElement('div'); document.body.append(host);
    editor = new FloorPresentationEditor(card, render);
    host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
    host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
    host.addEventListener('click', (event) => { const button = event.target.closest('[data-act]'); if (button && !button.disabled) editor.onClick(button.dataset.act); });
    render();
  }
  owned.push({ editor: edit || editor, host: full ? card._stage : host });
  const field = (key) => host.querySelector(`[data-field="floor-presentation-${key}"]`);
  const button = (key) => host.querySelector(`[data-act="floor-presentation-${key}"]`);
  const change = (key, value, type = 'input') => {
    const node = field(key); expect(node).not.toBeNull(); node.value = value; node.dispatchEvent(new Event(type, { bubbles: true })); return node;
  };
  const toggle = () => { const node = field('panels'); expect(node).not.toBeNull(); node.click(); return node; };
  const refresh = () => { if (full) { edit.onStates(); edit.afterUpdate(); } else editor.updatePreviews(host); };
  return { card, editor, edit, host, field, button, change, toggle, refresh, render };
}

afterEach(() => { for (const { editor, host } of owned.splice(0)) { editor.dispose(); host.remove(); } document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('separate floor panels require exact saved intent and current geometry', () => {
  it('keeps existing cards and all absent settings on one camera', () => {
    expect(FLOOR_PRESENTATION_DEFAULTS.panels).toBe(false);
    expect(readFloorPresentation(undefined)).toMatchObject({ panels: false, valid: true });
    expect(compileFloorPresentation(policy(), evidence())).toMatchObject({ mode: 'horizontal', panels: false, valid: true });
  });
  it.each([true, false])('accepts the exact boolean %j without mutating imported settings', (panels) => {
    const raw = Object.freeze({ ...policy({ panels }), extra: Object.freeze({ future: 'kept' }) });
    const result = readFloorPresentation(raw); expect(result).toMatchObject({ panels, valid: true });
    expect(readFloorPresentation(result)).toBe(result); expect(raw.extra.future).toBe('kept');
  });
  it.each([undefined, null, '', 'true', 'false', 0, 1, [], {}, NaN, Infinity])('fails closed for a present malformed panels value %j', (panels) => {
    const raw = policy({ panels }), normalized = readFloorPresentation(raw), compiled = compileFloorPresentation(raw, evidence());
    expect(normalized).toMatchObject({ panels: false, valid: false });
    expect(normalized.diagnostics.map((entry) => entry.code)).toContain('invalid_panels');
    expect(compiled).toMatchObject({ mode: 'assembled', panels: false, valid: false, rows: [] });
    expect(Object.hasOwn(raw, 'panels')).toBe(true); expect(raw.panels).toBe(panels);
  });
  it.each(['assembled', 'horizontal', 'vertical'])('activates panels only for a valid horizontal request, preserving %s preferences', (mode) => {
    const raw = policy({ panels: true, mode }), before = structuredClone(raw);
    expect(readFloorPresentation(raw).panels).toBe(true);
    expect(compileFloorPresentation(raw, evidence())).toMatchObject({ mode, valid: true, panels: mode === 'horizontal' });
    expect(raw).toEqual(before);
  });
  it('cannot open separate panels when a requested floor or model ownership is missing', () => {
    const raw = policy({ panels: true });
    for (const current of [{ ...evidence(), bounds: [] }, { ...evidence(), model: { present: true, supported: false } },
      { ...evidence(), floors: floors().slice(0, 1) }]) {
      expect(compileFloorPresentation(raw, current)).toMatchObject({ mode: 'assembled', panels: false, valid: false, rows: [] });
    }
  });
  it('uses the same canonical display positions in both one-camera and separate-panel views', () => {
    for (const axis of ['east', 'north']) {
      const original = compileFloorPresentation(policy({ axis }), evidence()), panes = compileFloorPresentation(policy({ axis, panels: true }), evidence());
      expect(panes.rows).toEqual(original.rows); expect(panes.rows[1].offset.some((value) => value !== 0)).toBe(true);
    }
  });
});

describe('floor panel settings are normal saved layout edits', () => {
  it('shows a labelled checkbox below the floor arrangement and explains inactive modes', () => {
    const ctx = fixture(); const input = ctx.field('panels');
    expect(input).not.toBeNull(); expect(input.type).toBe('checkbox'); expect(input.checked).toBe(false); expect(input.disabled).toBe(true);
    expect(input.closest('label').textContent).toContain('Separate floor panels');
    expect(ctx.host.textContent).toContain('Choose Side by side to use separate floor panels');
    ctx.change('mode', 'horizontal', 'change'); expect(ctx.field('panels')).toBe(input); expect(input.disabled).toBe(false);
    expect(ctx.host.textContent).toContain('Each chosen floor has its own panel');
    expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._view.setFloorPresentation).not.toHaveBeenCalled();
  });
  it('saves a deliberate checkbox change once with the existing history label and no device action', () => {
    const original = policy({ panels: false, extra: { future: [1, 'kept'] } }); const ctx = fixture({ raw: original });
    ctx.toggle(); expect(ctx.editor.draft.panels).toBe(true); expect(ctx.card._layout.floor_presentation).toEqual(original);
    ctx.button('save').click(); ctx.button('save').click();
    expect(ctx.card.commitFeatureLayout).toHaveBeenCalledExactlyOnceWith({ floor_presentation: { ...original, panels: true } }, 'Floor presentation');
    expect(ctx.card._history.size).toBe(1); expect(ctx.card._view.setFloorPresentation).not.toHaveBeenCalled();
    expect(ctx.card._hass.callService).not.toHaveBeenCalled(); expect(ctx.card._hass.callWS).not.toHaveBeenCalled();
  });
  it('Cancel discards checkbox changes and preserves the exact YAML fallback', () => {
    const yaml = policy({ panels: true, extra: { future: 'yes' } }); const ctx = fixture({ config: { floor_presentation: yaml } });
    ctx.toggle(); expect(ctx.editor.draft.panels).toBe(false); ctx.button('cancel').click();
    expect(ctx.field('panels').checked).toBe(true); expect(ctx.card._layout).not.toHaveProperty('floor_presentation');
    expect(ctx.card._config.floor_presentation).toEqual(yaml); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each(['assembled', 'vertical'])('keeps an imported true preference inactive in %s until horizontal is chosen', (mode) => {
    const raw = policy({ panels: true, mode, extra: { untouched: true } }); const ctx = fixture({ raw });
    expect(ctx.field('panels').checked).toBe(true); expect(ctx.field('panels').disabled).toBe(true);
    // A disabled control event must not silently erase the imported preference.
    ctx.editor.onChange('floor-presentation-panels', { type: 'checkbox', checked: false });
    expect(ctx.editor.draft.panels).toBe(true); expect(ctx.editor.dirty).toBe(false);
    ctx.change('gap_m', '3.125'); ctx.button('save').click(); expect(ctx.card._layout.floor_presentation).toEqual({ ...raw, gap_m: 3.125 });
    ctx.change('mode', 'horizontal', 'change'); expect(ctx.field('panels').checked).toBe(true); expect(ctx.field('panels').disabled).toBe(false);
    ctx.button('save').click(); expect(ctx.card._layout.floor_presentation).toEqual({ ...raw, mode: 'horizontal', gap_m: 3.125 });
  });
  it('preserves malformed imported settings until an explicit checkbox repair', () => {
    const raw = policy({ panels: 'yes', extra: { future: 'kept' } }); const ctx = fixture({ raw });
    expect(ctx.host.textContent).toContain('Separate floor panels must be true or false');
    ctx.change('gap_m', '3'); expect(ctx.button('save').disabled).toBe(true); expect(ctx.editor.draft.panels).toBe('yes');
    ctx.button('cancel').click(); expect(ctx.card._layout.floor_presentation).toEqual(raw);
    ctx.toggle(); ctx.button('save').click(); expect(ctx.card._layout.floor_presentation).toEqual({ ...raw, panels: true });
  });
  it('explicit defaults remove malformed panels while retaining unknown imported extensions', () => {
    const ctx = fixture({ raw: policy({ panels: { unsupported: true }, extra: { saved: 'kept' } }) });
    ctx.button('repair').click(); expect(readFloorPresentation(ctx.editor.draft)).toMatchObject({ panels: false, valid: true });
    ctx.button('save').click(); expect(ctx.card._layout.floor_presentation.extra).toEqual({ saved: 'kept' });
    expect(compileFloorPresentation(ctx.card._layout.floor_presentation, evidence()).panels).toBe(false);
  });
  it('retains the focused checkbox, its draft and translated label across current HA pushes', () => {
    const ctx = fixture({ raw: policy() }); const checkbox = ctx.toggle(); checkbox.focus();
    ctx.card._hass = { ...ctx.card._hass, locale: { language: 'de' }, states: { 'sensor.example': { state: '12' } } }; ctx.refresh();
    expect(ctx.field('panels')).toBe(checkbox); expect(document.activeElement).toBe(checkbox); expect(checkbox.checked).toBe(true);
    expect(checkbox.closest('label').textContent).toContain('Separate Etagenbereiche'); expect(ctx.editor.stale).toBe(false);
    expect(ctx.card._layout.floor_presentation).not.toHaveProperty('panels'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each(['account', 'connection', 'settings'])('latches a dirty panels draft across %s changes and recovery', (reason) => {
    const ctx = fixture({ raw: policy() }); ctx.toggle(); const connection = ctx.card._hass.connection, saved = ctx.card._layout.floor_presentation;
    if (reason === 'account') ctx.card._hass.user.id = 'different-admin';
    if (reason === 'connection') ctx.card._hass.connection = { connected: true };
    if (reason === 'settings') ctx.card._layout.floor_presentation = policy({ panels: false });
    ctx.refresh(); ctx.card._hass.user.id = 'test-admin'; ctx.card._hass.connection = connection; ctx.card._layout.floor_presentation = saved; ctx.refresh();
    expect(ctx.field('panels').checked).toBe(true); expect(ctx.field('panels').disabled).toBe(true); expect(ctx.button('save').disabled).toBe(true);
    ctx.editor.onClick('floor-presentation-save'); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled();
    ctx.button('cancel').click(); expect(ctx.field('panels').checked).toBe(false); expect(ctx.editor.stale).toBe(false);
  });
  it('uses the actual Model editor routes and restores checkbox intent through Undo and Redo', () => {
    const original = policy({ panels: false, extra: { saved: 'kept' } }); const ctx = fixture({ raw: original, full: true });
    const checkbox = ctx.toggle(); checkbox.focus(); ctx.refresh(); expect(ctx.field('panels')).toBe(checkbox); expect(document.activeElement).toBe(checkbox);
    ctx.button('save').click(); expect(ctx.card._history.size).toBe(1); expect(ctx.card._layout.floor_presentation).toEqual({ ...original, panels: true });
    ctx.edit.panel.querySelector('[data-act="history-undo"]').click(); expect(ctx.card._layout.floor_presentation).toEqual(original); expect(ctx.field('panels').checked).toBe(false);
    ctx.edit.panel.querySelector('[data-act="history-redo"]').click(); expect(ctx.card._layout.floor_presentation).toEqual({ ...original, panels: true }); expect(ctx.field('panels').checked).toBe(true);
    expect(ctx.card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(ctx.card._hass.callService).not.toHaveBeenCalled(); expect(ctx.card._hass.callWS).not.toHaveBeenCalled();
  });
  it('clears an actual Model-tab draft when leaving without Save', () => {
    const ctx = fixture({ raw: policy(), full: true }); ctx.toggle();
    ctx.edit.panel.querySelector('[data-act="tab"][data-id="rooms"]').click();
    ctx.edit.panel.querySelector('[data-act="tab"][data-id="model"]').click();
    expect(ctx.field('panels').checked).toBe(false); expect(ctx.card.commitFeatureLayout).not.toHaveBeenCalled(); expect(ctx.card._history.size).toBe(0);
  });
  it.each(['en', 'de', 'fr', 'es'])('provides usable %s captions and localized malformed-setting warnings', (language) => {
    const ctx = fixture({ raw: policy({ panels: 'bad' }), language });
    for (const key of ['panels', 'panelsHelp', 'panelsInactive', 'invalidPanels']) {
      expect(messages[language][`editorExtras.floor.${key}`]).toBeTypeOf('string');
      expect(messages[language][`editorExtras.floor.${key}`].trim()).not.toBe('');
    }
    expect(ctx.field('panels').closest('label').textContent).toContain(messages[language]['editorExtras.floor.panels']);
    expect(ctx.host.textContent).toContain(messages[language]['editorExtras.floor.invalidPanels']);
    expect(ctx.editor.draft.panels).toBe('bad'); expect(ctx.button('save').disabled).toBe(true);
  });
});
