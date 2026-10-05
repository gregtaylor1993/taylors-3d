// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ModelRenderingEditor } from '../src/model-rendering-editor.js';

describe('saved model presentation and actual light data', () => {
  beforeAll(async () => { await import('../src/taylors3d-card.js'); });

  function fixture(config = {}, layout = {}) {
    const card = document.createElement('taylors3d-card');
    card.setConfig({ type: 'custom:taylors3d-card', ...config });
    card._layout = layout;
    card._hass = { states: { 'light.room': { state: 'on', attributes: { brightness: 255 } } }, callService: vi.fn() };
    card._view = { setModelRendering: vi.fn() };
    card._objects = { model: { manifest: { levels: [] } }, update: vi.fn() };
    return card;
  }

  it('keeps normal illumination as the default and passes the actual unchanged state', () => {
    const card = fixture();
    const states = card._hass.states;
    card._updateObjects();
    expect(card._view.setModelRendering).toHaveBeenCalledWith(expect.objectContaining({ shadows: 'realtime', lamps: 'inherit' }));
    expect(card._objects.update).toHaveBeenCalledWith(states, expect.objectContaining({ lightsOn: true }));
    expect(card._hass.states).toBe(states);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('uses shared saved settings before card settings without changing either document', () => {
    const shared = { shadows: 'off', lamps: 'inherit', future: { custom: true } };
    const card = fixture({ model_rendering: { shadows: 'realtime', lamps: 'off' } }, { model_rendering: shared });
    const before = JSON.stringify([card._config, card._layout]);
    card._updateObjects();
    expect(card._view.setModelRendering).toHaveBeenCalledWith(expect.objectContaining({ shadows: 'off', lamps: 'inherit' }));
    expect(card._objects.update.mock.calls[0][1].lightsOn).toBe(true);
    expect(JSON.stringify([card._config, card._layout])).toBe(before);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it.each([
    ['auto', 'inherit', true], ['off', 'inherit', false], ['auto', 'off', false], ['off', 'off', false],
  ])('respects existing lamps=%s and saved presentation lamps=%s', (lights, lamps, expected) => {
    const card = fixture({ lights }, { model_rendering: { shadows: 'off', lamps } });
    const source = card._hass.states['light.room'];
    card._updateObjects();
    expect(card._objects.update.mock.calls[0][1].lightsOn).toBe(expected);
    expect(card._hass.states['light.room']).toBe(source);
    expect(source.state).toBe('on');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('returns to the card fallback when shared presentation is removed', () => {
    const card = fixture({ model_rendering: { shadows: 'realtime', lamps: 'inherit' } }, { model_rendering: { shadows: 'off', lamps: 'off' } });
    card._updateObjects();
    expect(card._objects.update.mock.calls[0][1].lightsOn).toBe(false);
    card._layout = {};
    card._updateObjects();
    expect(card._objects.update.mock.calls[1][1].lightsOn).toBe(true);
    expect(card._view.setModelRendering).toHaveBeenLastCalledWith(expect.objectContaining({ shadows: 'realtime', lamps: 'inherit' }));
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('keeps a malformed present shared setting visible as a diagnostic rather than using another scope', () => {
    const card = fixture({ model_rendering: { shadows: 'off', lamps: 'off' } }, { model_rendering: false });
    const result = card._syncModelRendering();
    expect(result.valid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result).toMatchObject({ shadows: 'realtime', lamps: 'inherit' });
    expect(card._layout.model_rendering).toBe(false);
  });

  it('discards unsaved shading drafts on direct Undo and Redo and restores the saved policy', () => {
    const normal = { shadows: 'realtime', lamps: 'inherit' };
    const card = fixture({}, { model_rendering: normal });
    card._hass.user = { is_admin: true };
    card._view = null;
    card._schedule = vi.fn();
    card._store = { save: vi.fn(async () => true) };
    card.resetHistory();
    const editor = new ModelRenderingEditor(card, vi.fn());
    card._edit = { _modelRenderingEditor: editor, afterUpdate: () => editor.render(), updateHistoryState: vi.fn(), setSaveState: vi.fn() };
    const choose = (value) => {
      editor.render();
      editor.onChange('model-rendering-preset', { value, closest: () => null });
      expect(editor.dirty).toBe(true);
    };
    choose('no-shadows'); editor.onClick('model-rendering-save');
    expect(card._layout.model_rendering).toEqual({ shadows: 'off', lamps: 'inherit' });
    choose('authored'); card.undoEdit();
    expect(card._layout.model_rendering).toEqual(normal);
    expect(editor.draft).toEqual(normal);
    expect(editor.dirty).toBe(false);
    expect(editor._contextIssue()).toBeNull();
    choose('authored'); card.redoEdit();
    expect(card._layout.model_rendering).toEqual({ shadows: 'off', lamps: 'inherit' });
    expect(editor.draft).toEqual(card._layout.model_rendering);
    expect(editor.dirty).toBe(false);
    expect(card._hass.callService).not.toHaveBeenCalled();
    expect(card._store.save).toHaveBeenCalledTimes(3);
  });
});
