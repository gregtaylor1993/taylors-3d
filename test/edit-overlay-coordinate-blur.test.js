// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const fixtures = [];
const saved = () => ({ id: 'located', entity: 'binary_sensor.smoke', type: 'smoke', clear_rule: 'state',
  location_mode: 'coordinates', x: 8, y: -2, z: 1.5, floor_id: 'ground', extension: { retain: ['été', false] } });
const pointer = (node, type) => node.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));

function setup() {
  const card = document.createElement('div'), host = document.createElement('div');
  host.attachShadow({ mode: 'open' }).append(card); document.body.append(host);
  const room = { id: 'room:lounge', area_id: 'lounge', floor_id: 'ground', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], doors: [] };
  Object.assign(card, {
    _stage: card, _config: { layout_key: 'coordinate-blur', group_by: 'entity' },
    _layout: { version: 1, floors: [], rooms: [room], pins: {}, hidden: [], alert_bindings: [saved()] },
    _roomList: [{ room, floorId: 'ground' }], _floors: [{ id: 'ground', name: 'Ground', elevation: 0, height: 3 }],
    _hass: { user: { id: 'admin', is_admin: true, is_active: true }, connection: { connected: true }, auth: {},
      states: { 'binary_sensor.smoke': { state: 'on', attributes: { friendly_name: 'Hall smoke', device_class: 'smoke' } } },
      entities: {}, devices: {}, areas: { lounge: { area_id: 'lounge', name: 'Lounge', floor_id: 'ground' } }, floors: {},
      callService: vi.fn(), callWS: vi.fn() },
    _view: { model: null, setOverlay: vi.fn(), setControlsEnabled: vi.fn(), setStems: vi.fn(),
      highlightModelNode: vi.fn(), setPivotMarker: vi.fn() },
    _built: {}, _store: { backend: 'browser' }, _markers: [], _positions: new Map(), _applyMarkerSelection: vi.fn(),
    _history: new EditHistory(), _editing: true, _loading: false,
  });
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  const edit = new EditMode(card); card._edit = edit; edit.refreshOverlay = vi.fn(); card.append(edit.panel); edit.render();
  card._commit = vi.fn((layout) => { card._layout = layout; card._history.record(snapshot(), 'Alert location'); edit.updateHistoryState(); });
  card.commitFeatureLayout = vi.fn((patch) => card._commit({ ...card._layout, ...patch }));
  fixtures.push({ edit, host });
  const field = (name) => edit.panel.querySelector(`[data-field="ovr-alert-${name}"]`);
  const button = (name) => edit.panel.querySelector(`[data-act="ovr-${name}-alert"]`);
  edit.panel.querySelector('[data-act="tab"][data-id="overlays"]').click();
  edit.panel.querySelector('[data-act="ovr-edit-alert"][data-id="located"]').click();
  const before = structuredClone(card._layout), history = card._history.size, readings = structuredClone(card._hass.states);
  const noWrites = () => {
    expect(card._layout).toEqual(before); expect(card._history.size).toBe(history);
    expect(card._commit).not.toHaveBeenCalled(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  };
  const type = (name, value) => {
    const node = field(name); expect(node).toBeTruthy(); node.focus(); node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true })); return node;
  };
  return { card, host, edit, editor: edit._overlayEditor, field, button, type, before, history, readings, noWrites };
}

afterEach(() => { fixtures.splice(0).forEach(({ edit, host }) => { edit.dispose(); host.remove(); }); vi.restoreAllMocks(); });

describe('actual Overlay and EditMode coordinate change during focus transfer', () => {
  it.each([['x', '1.20', 'y'], ['y', '-.750', 'z'], ['z', '.400', 'floor']])(
    'keeps dirty %s (%s) and the next %s target connected through change before focus moves', (axis, value, nextName) => {
      const ctx = setup(), input = ctx.type(axis, value), next = ctx.field(nextName), save = ctx.button('save');
      pointer(next, 'pointerdown');
      // Chrome emits the dirty field's change while processing the next
      // pointer target's focus. jsdom requires that event to be explicit.
      input.dispatchEvent(new Event('change', { bubbles: true }));
      expect(ctx.field(axis)).toBe(input); expect(ctx.field(nextName)).toBe(next); expect(ctx.button('save')).toBe(save);
      expect(input.isConnected).toBe(true); expect(next.isConnected).toBe(true); expect(save.isConnected).toBe(true);
      next.focus(); pointer(next, 'pointerup');
      expect(ctx.host.shadowRoot.activeElement).toBe(next);
      expect(ctx.editor.draftAlert[axis]).toBe(value); expect(input.value).toBe(value);
      ctx.edit.onStates(); expect(ctx.field(nextName)).toBe(next); expect(ctx.host.shadowRoot.activeElement).toBe(next);
      ctx.noWrites(); expect(ctx.card._hass.states).toEqual(ctx.readings);
    });

  it('accepts one deliberate Save when the last dirty coordinate changes after Save pointerdown', () => {
    const ctx = setup();
    for (const [axis, value] of [['x', '1.20'], ['y', '-.75']]) {
      ctx.type(axis, value).dispatchEvent(new Event('change', { bubbles: true }));
    }
    const input = ctx.type('z', '.4'), save = ctx.button('save');
    pointer(save, 'pointerdown'); input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.button('save')).toBe(save); expect(save.isConnected).toBe(true); ctx.noWrites();
    save.focus(); pointer(save, 'pointerup'); save.click();
    expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.card.commitFeatureLayout).toHaveBeenCalledOnce();
    expect(ctx.card._history.size).toBe(ctx.history + 1);
    expect(ctx.card._layout.alert_bindings).toEqual([{ ...saved(), x: 1.2, y: -.75, z: .4 }]);
    expect(ctx.card._hass.states).toEqual(ctx.readings);
    expect(ctx.card._hass.callService).not.toHaveBeenCalled(); expect(ctx.card._hass.callWS).not.toHaveBeenCalled();
  });

  it('records a change-only raw coordinate and refreshes its warning without replacing another target', () => {
    const ctx = setup(), input = ctx.field('x'), next = ctx.field('y'); input.focus(); input.value = 'garbage';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.field('x')).toBe(input); expect(ctx.field('y')).toBe(next); expect(ctx.editor.draftAlert.x).toBe('garbage');
    expect(ctx.edit.panel.querySelector('[data-ovr-location-warning]').textContent).toContain('finite source coordinates');
    ctx.noWrites();
  });

  it('keeps the captured Cancel usable when coordinate change occurs during its pointer press', () => {
    const ctx = setup(), input = ctx.type('x', '2.50'), cancel = ctx.button('cancel');
    pointer(cancel, 'pointerdown'); input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.button('cancel')).toBe(cancel); expect(cancel.isConnected).toBe(true);
    cancel.focus(); pointer(cancel, 'pointerup'); cancel.click();
    expect(ctx.editor.draftAlert).toBeNull(); ctx.noWrites();
  });

  it.each(['', '0x10'])('rejects invalid raw coordinate %j, then clears the old error in place when corrected', (value) => {
    const ctx = setup(), input = ctx.type('x', value); input.dispatchEvent(new Event('change', { bubbles: true }));
    ctx.button('save').click(); ctx.noWrites();
    expect(ctx.edit.panel.querySelector('.taylors3d-overlay-editor > p[role="alert"]')).not.toBeNull();
    const corrected = ctx.type('x', '1.20'), next = ctx.field('y'), save = ctx.button('save');
    corrected.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.field('x')).toBe(corrected); expect(ctx.field('y')).toBe(next); expect(ctx.button('save')).toBe(save);
    expect(ctx.editor.message).toBeNull();
    expect(ctx.edit.panel.querySelector('.taylors3d-overlay-editor > p[role="alert"]')).toBeNull();
    expect(ctx.edit.panel.querySelector('[data-ovr-location-warning]').textContent).toBe('');
    expect(ctx.editor.draftAlert.x).toBe('1.20'); ctx.noWrites();
  });

  it.each(['role', 'source'])('retains the existing held Save fence across %s loss/recovery after coordinate change', (kind) => {
    const ctx = setup(), input = ctx.type('x', '1.20'), save = ctx.button('save'), state = ctx.card._hass.states['binary_sensor.smoke'];
    pointer(save, 'pointerdown'); input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.button('save')).toBe(save); expect(save.isConnected).toBe(true);
    if (kind === 'role') ctx.card._hass.user.is_admin = false;
    else ctx.card._hass.states['binary_sensor.smoke'] = { ...state, state: 'unavailable' };
    ctx.edit.onStates(); expect(save.disabled).toBe(true);
    if (kind === 'role') ctx.card._hass.user.is_admin = true;
    else ctx.card._hass.states['binary_sensor.smoke'] = state;
    ctx.edit.onStates(); expect(save.disabled).toBe(false);
    pointer(save, 'pointerup'); save.click(); ctx.noWrites();
    const fresh = ctx.button('save'); pointer(fresh, 'pointerdown'); pointer(fresh, 'pointerup'); fresh.click();
    expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.card._history.size).toBe(ctx.history + 1);
    expect(ctx.card._layout.alert_bindings).toEqual([{ ...saved(), x: 1.2 }]);
    expect(ctx.card._hass.callService).not.toHaveBeenCalled(); expect(ctx.card._hass.callWS).not.toHaveBeenCalled();
  });

  it('still rebuilds the necessary location controls for an explicit Room mode change', () => {
    const ctx = setup(), input = ctx.type('x', '1.20'); input.dispatchEvent(new Event('change', { bubbles: true }));
    const location = ctx.field('location'); location.value = 'room'; location.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.field('x')).toBeNull(); expect(input.isConnected).toBe(false);
    expect(ctx.field('room')).not.toBeNull(); expect(ctx.editor.draftAlert.location_mode).toBe('room'); ctx.noWrites();
  });
});
