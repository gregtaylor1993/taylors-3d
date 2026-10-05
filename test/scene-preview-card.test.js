// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ScenePreviewController } from '../src/scene-preview.js';
import { ScenePreviewEditor } from '../src/scene-preview-editor.js';

describe('scene previews in the actual card', () => {
  beforeAll(async () => { await import('../src/taylors3d-card.js'); });
  const reading = (state = 'off', rgb = [255, 0, 0]) => ({ entity_id: 'light.room', state,
    attributes: { brightness: 255, rgb_color: rgb, color_mode: 'rgb', supported_color_modes: ['rgb'] } });
  const binding = { id: 'movie', label: 'Movie', scene_entity: 'scene.movie',
    lights: [{ entity: 'light.room', state: 'on', brightness: 128, color: { mode: 'rgb', rgb: [0, 0, 255] } }] };
  function fixture() {
    const card = document.createElement('taylors3d-card');
    card.setConfig({});
    // Exercise root methods without creating an unrelated WebGL renderer in jsdom.
    Object.defineProperty(card, 'isConnected', { configurable: true, value: true });
    card._layout = { scene_previews: { enabled: true, items: [structuredClone(binding)] } };
    card._hass = { connection: new EventTarget(), user: { id: 'current', is_admin: true },
      services: { scene: { turn_on: {} } }, callService: vi.fn(async () => {}),
      states: { 'light.room': reading(), 'scene.movie': { entity_id: 'scene.movie', state: 'unknown', attributes: {} } } };
    card._hass.connection.connected = true;
    card._view = { model: { root: { uuid: 'house' } }, setModelRendering: vi.fn(), setGlows: vi.fn() };
    card._objects = { model: { manifest: { levels: [] } }, update: vi.fn() };
    card._positions = new Map([['room', { x: 1, y: 2, floorId: 'ground' }]]);
    card._markers = [{ id: 'room', entityId: 'light.room', domain: 'light', name: 'Room lamp' }];
    const marker = document.createElement('div'); marker.innerHTML = '<ha-icon></ha-icon><span class="fp-val"></span>';
    card._markerEls.set('room', marker);
    return { card, marker };
  }

  it('previews the model and floor glow while marker readings and HA states stay actual', () => {
    const { card, marker } = fixture(), actual = card._hass.states;
    const result = card._scenePreviewController.preview('movie');
    expect(result.ok).toBe(true);
    expect(card._objects.update).toHaveBeenLastCalledWith(actual, expect.objectContaining({ lightPreview: card._lightPreview }));
    expect(card._view.setGlows).toHaveBeenLastCalledWith([expect.objectContaining({ rgb: [0, 0, 255] })]);
    expect(marker.classList.contains('active')).toBe(false);
    expect(marker.style.getPropertyValue('--fp-light')).toBe('');
    expect(card._hass.states).toBe(actual);
    expect(actual['light.room'].state).toBe('off');
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('Stop restores the newest actual reading, including changes made during a preview', () => {
    const { card, marker } = fixture();
    card._scenePreviewController.preview('movie');
    card._hass.states = { ...card._hass.states, 'light.room': reading('on', [0, 255, 0]) };
    card._syncScenePreviews();
    const active = card._lightPreview;
    expect(active).toBeInstanceOf(Map);
    card._scenePreviewController.stop();
    expect(card._lightPreview).toBeNull();
    expect(card._objects.update).toHaveBeenLastCalledWith(card._hass.states, expect.objectContaining({ lightPreview: null }));
    expect(card._view.setGlows).toHaveBeenLastCalledWith([expect.objectContaining({ rgb: [0, 255, 0] })]);
    expect(marker.classList.contains('active')).toBe(true);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('unrelated current HA readings retain the same token and make no root renderer writes', () => {
    const { card } = fixture();
    card._scenePreviewController.preview('movie');
    const token = card._lightPreviewOwner;
    card._objects.update.mockClear(); card._view.setGlows.mockClear();
    card._hass = { ...card._hass, states: { ...card._hass.states, 'sensor.temperature': { state: '22' } } };
    card._syncScenePreviews();
    expect(card._lightPreviewOwner).toBe(token);
    expect(card._objects.update).not.toHaveBeenCalled();
    expect(card._view.setGlows).not.toHaveBeenCalled();
  });

  it.each(['layout', 'model', 'view', 'floor', 'mode', 'hidden bar', 'offscreen', 'loading', 'disconnect', 'editing', 'scene mapping'])('cancels the preview when its %s context changes', (kind) => {
    const { card } = fixture();
    card._scenePreviewController.preview('movie');
    const changes = {
      layout: () => { card._config.layout_key = 'other'; }, model: () => { card._view.model.root.uuid = 'other'; },
      view: () => { card._viewId = 'garden'; }, floor: () => { card._floorOnly = 'first'; }, mode: () => { card._mode = 'top'; },
      'hidden bar': () => { card._config.show_bubble_bar = false; }, offscreen: () => { card._weatherInView = false; },
      loading: () => { card._loading = true; }, disconnect: () => { card._hass.connection.connected = false; },
      editing: () => { card._editing = true; },
      'scene mapping': () => { card._layout.scene_previews.items[0].lights[0].brightness = 64; },
    };
    changes[kind](); card._syncScenePreviews();
    expect(card._lightPreview).toBeNull(); expect(card._scenePreviewController.active).toBeNull();
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('a stale old clear cannot overwrite the newly claimed preview owner', () => {
    const { card } = fixture();
    card._scenePreviewController.preview('movie');
    const old = card._lightPreviewOwner;
    card._editing = true; card._edit = { tab: 'scenes' };
    const draft = new ScenePreviewController({ getContext: () => ({ hass: card._hass,
      bindings: card._scenePreviewSettings(), contextKey: 'draft', canEdit: true }),
    onPreview: (map, metadata) => card.previewSceneLights(map, metadata) });
    card._edit._scenePreviewEditor = { controller: draft };
    card._objects.update.mockClear();
    const result = draft.previewDraft(structuredClone(binding));
    expect(result.ok).toBe(true); expect(card._scenePreviewController.active).toBeNull();
    expect(card._lightPreviewOwner).toBe(result.token);
    expect(card._objects.update).toHaveBeenCalledTimes(1);
    expect(card.previewSceneLights(null, { token: old })).toBe(false);
    expect(card._lightPreviewOwner).toBe(result.token);
    draft.stop(); expect(card._lightPreview).toBeNull();
  });

  it('separate activation removes preview and sends exactly one current scene action', async () => {
    const { card } = fixture();
    card._scenePreviewController.preview('movie');
    const result = await card._scenePreviewController.activate('movie', { expectedSceneEntity: 'scene.movie' });
    expect(result.ok).toBe(true); expect(card._lightPreview).toBeNull();
    expect(card._hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.movie' });
    expect(card._hass.states['light.room'].state).toBe('off');
  });

  it.each([['forced reload', true, '/same.glb', true], ['new source', false, '/new.glb', true],
    ['same source', false, '/same.glb', false]])('handles a pending %s before the old model is disposed', (_name, reload, source, stopped) => {
    const { card } = fixture();
    card._config.model = source;
    card._view.model.id = '/same.glb';
    card._view.setModel = vi.fn(() => new Promise(() => {}));
    card._scenePreviewController.preview('movie');
    card._loadModel(reload);
    expect(card._lightPreview === null).toBe(stopped);
    expect(card._scenePreviewController.active === null).toBe(stopped);
    expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('own preview controls retain the visual; real controls and Escape stop it', () => {
    const { card } = fixture(), own = document.createElement('div');
    own.dataset.scenePreviewBar = '';
    card._scenePreviewController.preview('movie');
    card._scenePreviewInteraction({ type: 'pointerdown', composedPath: () => [own] });
    expect(card._lightPreview).toBeInstanceOf(Map);
    card._scenePreviewInteraction({ type: 'pointerdown', composedPath: () => [] });
    expect(card._lightPreview).toBeNull();
    card._scenePreviewController.preview('movie');
    card._scenePreviewInteraction({ type: 'keydown', key: 'Escape', composedPath: () => [own] });
    expect(card._lightPreview).toBeNull(); expect(card._hass.callService).not.toHaveBeenCalled();
  });

  it('direct Undo and Redo reset unsaved scene drafts to their exact saved history state', () => {
    const { card } = fixture();
    Object.defineProperty(card, 'isConnected', { configurable: true, value: false });
    card._view = null; card._schedule = vi.fn();
    card._store = { save: vi.fn(async () => true) };
    card.resetHistory();
    const editor = new ScenePreviewEditor(card, vi.fn());
    card._edit = { _scenePreviewEditor: editor, afterUpdate: () => editor.render(),
      updateHistoryState: vi.fn(), setSaveState: vi.fn() };
    // Use actual connected native controls so stale detached events cannot edit.
    const host = document.createElement('div'); document.body.append(host);
    const editLabel = (value) => {
      host.innerHTML = editor.render();
      const input = host.querySelector('[data-field="scene-preview-label"]');
      input.value = value; editor.onInput('scene-preview-label', input);
      expect(editor.dirty).toBe(true);
    };
    editLabel('Cinema'); editor.onClick('scene-preview-save');
    expect(card._layout.scene_previews.items[0].label).toBe('Cinema');
    editLabel('Unsaved draft'); card.undoEdit();
    expect(card._layout.scene_previews.items[0].label).toBe('Movie');
    expect(editor.draft.items[0].label).toBe('Movie'); expect(editor.dirty).toBe(false);
    editLabel('Another draft'); card.redoEdit();
    expect(card._layout.scene_previews.items[0].label).toBe('Cinema');
    expect(editor.draft.items[0].label).toBe('Cinema'); expect(editor.dirty).toBe(false);
    expect(card._hass.callService).not.toHaveBeenCalled();
    expect(card._store.save).toHaveBeenCalledTimes(3);
    editor.dispose(); host.remove();
  });
});
