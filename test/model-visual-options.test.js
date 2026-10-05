// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';

const editors = [];
function setup() {
  const card = { _config: { layout_key: 'house' }, _store: { backend: 'shared' }, _stage: document.createElement('div'), _built: {},
    _layout: { rooms: [], pins: {}, model: { position: [120.25, -75.5, 18], opacity: .6, scale: 1, extra: { kept: true } } },
    _hass: { user: { is_admin: true }, states: {}, entities: {}, devices: {}, areas: {}, floors: {},
      callService: vi.fn(), callWS: vi.fn() }, _view: { model: null, setControlsEnabled: vi.fn(), setPivotMarker: vi.fn(), setOverlay: vi.fn() },
    _applyMarkerSelection: vi.fn(), modelBindings: () => null, _commit: vi.fn((value) => { card._layout = value; }) };
  const edit = new EditMode(card); editors.push(edit);
  const host = edit.panel; host.innerHTML = edit._modelTab(); document.body.append(host); edit.tab = 'model';
  const field = (name) => host.querySelector(`[data-field="md-${name}"]`);
  const change = (name, value) => { const input = field(name); expect(input).toBeTruthy(); input.value = value;
    edit._onPanelChange({ target: input }); return input; };
  return { card, edit, host, field, change };
}
afterEach(() => { for (const edit of editors.splice(0)) edit.dispose(); document.body.replaceChildren(); });

describe('uploaded model alignment controls', () => {
  it('displays the actual large placement and accepts one exact coordinate without clamping the others', () => {
    const { card, field, change } = setup();
    expect(field('position-x')?.value).toBe('120.25');
    expect(field('position-y')?.value).toBe('-75.5');
    expect(field('position-z')?.value).toBe('18');
    expect(field('x').value).toBe('120.25');
    expect(field('y').value).toBe('-75.5');
    expect(field('z').value).toBe('18');
    change('position-y', '-80.125');
    expect(card._layout.model.position).toEqual([120.25, -80.125, 18]);
    expect(card._layout.model.extra).toEqual({ kept: true });
    expect(card._commit).toHaveBeenCalledOnce();
    expect(card._hass.callService).not.toHaveBeenCalled();
    expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('does not treat an empty or invalid exact coordinate as zero', () => {
    const { card, change } = setup();
    change('position-x', ''); change('position-z', 'not-a-number');
    expect(card._layout.model.position).toEqual([120.25, -75.5, 18]);
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('permits opacity zero without changing position or model bytes', () => {
    const { card, edit, field } = setup(), opacity = field('opacity');
    expect(opacity.min).toBe('0'); opacity.value = '0';
    edit.panel.innerHTML = ''; edit._onPanelInput({ target: opacity });
    expect(card._layout.model.opacity).toBe(0);
    expect(card._layout.model.position).toEqual([120.25, -75.5, 18]);
  });
  it('cannot apply a retained exact coordinate to a replaced model source', () => {
    const { card, field, change } = setup(), input = field('position-x');
    input.value = '200';
    card._layout = { ...card._layout, model: { ...card._layout.model, version: 'replacement' } };
    change('position-x', '200');
    expect(card._layout.model.position).toEqual([120.25, -75.5, 18]);
    expect(card._commit).not.toHaveBeenCalled();
  });
  it('poisons the retained numeric edit after observed permission loss even if permission returns', () => {
    const { card, edit, field } = setup(), input = field('position-x');
    input.focus(); input.value = '200';
    card._hass.user.is_admin = false; edit.afterUpdate();
    card._hass.user.is_admin = true; edit.afterUpdate();
    // Disabling a focused native field can blur it. A subsequent redraw may
    // offer a fresh field; the captured old field must still be unable to act.
    expect(input.disabled || !input.isConnected).toBe(true);
    input.value = '200'; edit._onPanelChange({ target: input });
    expect(card._layout.model.position).toEqual([120.25, -75.5, 18]);
    expect(card._commit).not.toHaveBeenCalled();
  });
});
