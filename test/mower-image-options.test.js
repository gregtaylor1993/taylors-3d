// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';
import { findBlobs } from '../src/mower-image.js';

const editors = [];
function fixture(minPixels = undefined) {
  const image = { entity: 'image.current_map', color: [250, 0, 0], tolerance: 7, future: 'kept' };
  if (minPixels !== undefined) image.min_pixels = minPixels;
  const card = { _config: { layout_key: 'mower-proof' }, isConnected: true, _editing: true, _loading: false,
    _layout: { rooms: [], pins: {}, mower: { source: 'image', image, overlay: { entity: 'image.current_map' }, future: 'mower-kept' } },
    _hass: { user: { id: 'current', is_admin: true }, connection: { connected: true }, states: {}, entities: {}, devices: {}, areas: {}, floors: {} },
    _stage: document.createElement('div'), _store: { backend: 'browser' }, _view: { model: null, setOverlay: vi.fn(),
      setControlsEnabled: vi.fn(), highlightModelNode: vi.fn(), setPivotMarker: vi.fn(), setStems: vi.fn() },
    _applyMarkerSelection: vi.fn() };
  card._history = new EditHistory(); card._history.reset({ layout: card._layout, config: card._config });
  card._commit = vi.fn((layout) => { card._layout = layout; card._history.record({ layout, config: card._config }, 'Change mower image threshold'); });
  const edit = new EditMode(card); card._edit = edit; edit.tab = 'mower'; editors.push(edit);
  vi.spyOn(edit, 'render').mockImplementation(() => {});
  edit.panel.innerHTML = edit._mowerImageSection(card._layout.mower); document.body.append(edit.panel);
  const field = edit.panel.querySelector('[data-field="mower-img-min-pixels"]');
  const change = (value, target = field) => { expect(target).toBeTruthy(); target.value = value; edit._onPanelChange({ target }); };
  return { card, edit, field, change };
}
afterEach(() => { for (const edit of editors.splice(0)) edit.dispose(); document.body.replaceChildren(); });

describe('mower image colour-patch threshold', () => {
  it('shows the default without saving it and preserves an imported exact threshold', () => {
    const first = fixture(); expect(first.field?.value).toBe('4'); expect(first.card._commit).not.toHaveBeenCalled();
    const imported = fixture(23); expect(imported.field?.value).toBe('23'); expect(imported.card._commit).not.toHaveBeenCalled();
  });
  it('makes one undoable edit that changes actual blob rejection and keeps other settings', () => {
    const { card, change } = fixture(); change('3');
    expect(card._commit).toHaveBeenCalledOnce(); expect(card._history.size).toBe(1);
    expect(card._layout.mower.image).toEqual({ entity: 'image.current_map', color: [250, 0, 0], tolerance: 7, future: 'kept', min_pixels: 3 });
    expect(card._layout.mower.future).toBe('mower-kept');
    const pixels = new Uint8Array([250, 0, 0, 255, 250, 0, 0, 255, 250, 0, 0, 255]);
    expect(findBlobs(pixels, 3, 1, [250, 0, 0], 7, card._layout.mower.image.min_pixels)).toHaveLength(1);
    card._layout = card._history.undo().layout;
    expect(findBlobs(pixels, 3, 1, [250, 0, 0], 7, card._layout.mower.image.min_pixels)).toHaveLength(0);
    expect(card._history.redo().layout.mower.image.min_pixels).toBe(3);
  });
  it.each(['', '-1', '1.5', '9007199254740992', 'not-a-number'])('rejects invalid %s without changing the saved setting', (value) => {
    const { card, change } = fixture(17); change(value);
    expect(card._layout.mower.image.min_pixels).toBe(17); expect(card._commit).not.toHaveBeenCalled();
  });
  it('accepts zero deliberately and keeps malformed imported data until a valid replacement', () => {
    const { card, field, change } = fixture('legacy-value');
    expect(card._layout.mower.image.min_pixels).toBe('legacy-value'); expect(card._commit).not.toHaveBeenCalled();
    expect(field?.value).toBe(''); change('0'); expect(card._layout.mower.image.min_pixels).toBe(0);
  });
  it.each(['source', 'role', 'connection'])('rejects the captured old field after observed %s loss and recovery', (kind) => {
    const { card, edit, field, change } = fixture(17);
    const oldEntity = card._layout.mower.image.entity;
    if (kind === 'source') card._layout.mower.image.entity = 'image.other_map';
    if (kind === 'role') card._hass.user.is_admin = false;
    if (kind === 'connection') card._hass.connection.connected = false;
    edit._syncMowerImageFields();
    if (kind === 'source') card._layout.mower.image.entity = oldEntity;
    if (kind === 'role') card._hass.user.is_admin = true;
    if (kind === 'connection') card._hass.connection.connected = true;
    edit._syncMowerImageFields(); change('8', field);
    expect(card._layout.mower.image.min_pixels).toBe(17); expect(card._commit).not.toHaveBeenCalled();
  });
});
