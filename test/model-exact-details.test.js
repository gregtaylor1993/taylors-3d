// @vitest-environment jsdom
// Preserve deliberate exact-position detail state across real editor redraws.
// Actual EditMode events/render/afterUpdate and EditHistory run. Storage/WebGL
// are fixture boundaries. Native Tab event ordering is proved separately.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMode } from '../src/edit-mode.js';
import { EditHistory } from '../src/history.js';

const fixtures = [];
function setup() {
  const host = document.createElement('div'), card = document.createElement('div');
  host.attachShadow({ mode: 'open' }).append(card); document.body.append(host);
  const root = {}, source = { version: 7, name: 'Owned.glb', position: [0, 0, 0], opacity: .6, scale: 1, pins_migrated: true,
    extension: { exact: ['été', false, null] } };
  Object.assign(card, {
    _stage: card, _config: { layout_key: 'exact-details-proof' }, _built: {}, _editing: true, _loading: false,
    _layout: { version: 1, floors: [], rooms: [], pins: {}, hidden: [], objects: {}, groups: {}, views: {}, model: source },
    _floors: [], _roomList: [], _markers: [], _positions: new Map(), _store: { backend: 'shared', save: vi.fn() },
    _hass: { user: { id: 'admin', is_admin: true, is_active: true }, auth: {}, connection: { connected: true },
      states: {}, entities: {}, devices: {}, areas: {}, floors: {}, callService: vi.fn(), callWS: vi.fn() },
    _view: { model: { root }, setControlsEnabled: vi.fn(), setPivotMarker: vi.fn(), setOverlay: vi.fn() },
    _applyMarkerSelection: vi.fn(), modelBindings: () => null, _history: new EditHistory(),
  });
  const snapshot = () => ({ layout: card._layout, config: card._config }); card._history.reset(snapshot());
  card._commit = vi.fn((layout) => {
    card._layout = layout; card._store.save(card._hass, layout); card._history.record(snapshot(), 'Model alignment');
  });
  const edit = card._edit = new EditMode(card); edit.tab = 'model';
  // No plan geometry is needed to exercise native editor state and rendering.
  edit.refreshOverlay = vi.fn(); card.append(edit.panel); edit.render();
  fixtures.push({ edit, host });
  const field = (axis) => edit.panel.querySelector(`[data-field="md-position-${axis}"]`);
  const details = () => field('x').closest('details');
  const noActions = () => {
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  };
  return { host, card, edit, source, root, field, details, noActions };
}
afterEach(() => { fixtures.splice(0).forEach(({ edit, host }) => { edit.dispose(); host.remove(); }); vi.restoreAllMocks(); });

describe('actual model exact-position details through editor updates', () => {
  it.each([true, false])('preserves deliberate open=%s through complete unfocused redraws without saving', (open) => {
    const ctx = setup(); expect(ctx.details().open).toBe(false);
    ctx.details().open = true; ctx.details().open = open;
    const before = structuredClone(ctx.card._layout), old = ctx.details();
    ctx.edit.panel.querySelector('[data-act="model-fit"]').focus();
    ctx.edit.afterUpdate();
    expect(ctx.details()).not.toBe(old); expect(ctx.details().open).toBe(open);
    ctx.edit.afterUpdate(); expect(ctx.details().open).toBe(open);
    expect(ctx.card._layout).toEqual(before); expect(ctx.card._history.size).toBe(0);
    expect(ctx.card._commit).not.toHaveBeenCalled(); expect(ctx.card._store.save).not.toHaveBeenCalled(); ctx.noActions();
  });

  it('saves sequential exact XYZ changes across blurred afterUpdate redraws without closing the fields or clamping', () => {
    const ctx = setup(); ctx.details().open = true;
    const expected = [0, 0, 0];
    for (const [index, axis, raw] of [[0, 'x', '120.25'], [1, 'y', '-75.5'], [2, 'z', '18']]) {
      const input = ctx.field(axis); expect(ctx.details().open).toBe(true);
      input.focus(); input.value = raw; input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(ctx.host.shadowRoot.activeElement).toBe(input);
      expect(ctx.card._layout.model.position).toEqual(expected);
      // jsdom has no native dirty-field change on Tab. The actual delegated
      // change handler runs explicitly; afterUpdate runs with focus outside
      // the numeric subtree, the redraw state this regression exercises.
      input.dispatchEvent(new Event('change', { bubbles: true })); input.blur(); ctx.edit.afterUpdate();
      expected[index] = Number(raw);
      expect(ctx.card._layout.model.position).toEqual(expected); expect(ctx.details().open).toBe(true);
      expect(ctx.field(axis).value).toBe(raw); expect(ctx.field(axis).disabled).toBe(false);
      expect(ctx.card._commit).toHaveBeenCalledTimes(index + 1);
      expect(ctx.card._store.save).toHaveBeenCalledTimes(index + 1); expect(ctx.card._history.size).toBe(index + 1);
      expect(ctx.card._layout.model).toEqual({ ...ctx.source, position: expected }); expect(ctx.card._view.model.root).toBe(ctx.root);
      ctx.noActions();
    }
    expect(ctx.card._layout.model.position).toEqual([120.25, -75.5, 18]);
    expect(ctx.card._history.undo().layout.model.position).toEqual([120.25, -75.5, 0]);
    expect(ctx.card._history.redo().layout.model.position).toEqual([120.25, -75.5, 18]);
    ctx.noActions();
  });

  it('continues retaining a focused unfinished numeric field through afterUpdate without saving or normalising its text', () => {
    const ctx = setup(); ctx.details().open = true;
    const input = ctx.field('x'), details = ctx.details(), scope = ctx.edit._modelPositionScope;
    input.focus(); input.value = '1.20'; input.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.edit.afterUpdate();
    expect(ctx.field('x')).toBe(input); expect(ctx.details()).toBe(details); expect(ctx.details().open).toBe(true);
    expect(ctx.host.shadowRoot.activeElement).toBe(input); expect(input.value).toBe('1.20'); expect(input.disabled).toBe(false);
    expect(ctx.edit._modelPositionScope).toBe(scope); expect(ctx.card._layout.model).toBe(ctx.source);
    expect(ctx.card._history.size).toBe(0); expect(ctx.card._commit).not.toHaveBeenCalled(); expect(ctx.card._store.save).not.toHaveBeenCalled(); ctx.noActions();
  });
});

// Proposed extra cases: actual native ordering is gated on the parent-owned
// post-fix passive trace. jsdom requires explicit dirty-field change/focus.
describe('exact coordinate own-commit retention during native focus transfer', () => {
  const changeWhileBlurred = (ctx, axis, raw) => {
    const input = ctx.field(axis); input.focus(); input.value = raw;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.blur();
    expect(ctx.host.shadowRoot.activeElement).toBeNull();
    input.dispatchEvent(new Event('change', { bubbles: true })); return input;
  };
  it.each([['x', '120.25', 'y'], ['y', '-75.5', 'z'], ['z', '18', 'rotation']])(
    'keeps the actual %s (%s) -> %s native target through its own blurred commit', (axis, raw, nextAxis) => {
      const ctx = setup(); ctx.details().open = true;
      const next = nextAxis === 'rotation' ? ctx.edit.panel.querySelector('[data-field="md-rotation"]') : ctx.field(nextAxis);
      const details = ctx.details(), scope = ctx.edit._modelPositionScope;
      const input = changeWhileBlurred(ctx, axis, raw); ctx.edit.afterUpdate();
      const current = nextAxis === 'rotation' ? ctx.edit.panel.querySelector('[data-field="md-rotation"]') : ctx.field(nextAxis);
      // Assert the original intended native focus target survived before
      // supplying jsdom's otherwise missing default focus transfer.
      expect(current).toBe(next); expect(next.isConnected).toBe(true); expect(ctx.field(axis)).toBe(input);
      expect(ctx.details()).toBe(details); expect(details.open).toBe(true); expect(ctx.edit._modelPositionScope).toBe(scope);
      next.focus(); expect(ctx.host.shadowRoot.activeElement).toBe(next);
      const expected = [0, 0, 0]; expected['xyz'.indexOf(axis)] = Number(raw);
      expect(ctx.card._layout.model).toEqual({ ...ctx.source, position: expected });
      const companions = {
        x: [['x', '120.25', '-50', '120.25', '120.25'], ['y', '0', '-50', '50', '0'], ['z', '0', '-5', '5', '0']],
        y: [['x', '0', '-50', '50', '0'], ['y', '-75.5', '-75.5', '50', '-75.5'], ['z', '0', '-5', '5', '0']],
        z: [['x', '0', '-50', '50', '0'], ['y', '0', '-50', '50', '0'], ['z', '18', '-5', '18', '18']],
      };
      for (const [companion, value, min, max, caption] of companions[axis]) {
        const range = ctx.edit.panel.querySelector(`[data-field="md-${companion}"]`);
        expect(range.value).toBe(value); expect(range.min).toBe(min); expect(range.max).toBe(max);
        expect(ctx.edit.panel.querySelector(`[data-val="${companion}"]`).textContent).toBe(caption);
      }
      expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.card._store.save).toHaveBeenCalledOnce();
      expect(ctx.card._history.size).toBe(1); expect(ctx.card._view.model.root).toBe(ctx.root); ctx.noActions();
    });

  it('consumes own-commit retention once, then allows the next ordinary unfocused full redraw', () => {
    const ctx = setup(); ctx.details().open = true; const original = ctx.field('y');
    changeWhileBlurred(ctx, 'x', '120.25'); ctx.edit.afterUpdate();
    expect(ctx.field('y')).toBe(original); expect(original.isConnected).toBe(true);
    ctx.edit.panel.querySelector('[data-act="model-fit"]').focus(); ctx.edit.afterUpdate();
    expect(ctx.field('y')).not.toBe(original); expect(original.isConnected).toBe(false); expect(ctx.details().open).toBe(true);
    expect(ctx.card._layout.model.position).toEqual([120.25, 0, 0]); expect(ctx.card._commit).toHaveBeenCalledOnce();
    expect(ctx.card._store.save).toHaveBeenCalledOnce(); expect(ctx.card._history.size).toBe(1); ctx.noActions();
  });

  it.each(['role', 'connection', 'model', 'source'])(
    'discards pending own-commit retention after observed %s loss/recovery and rejects the old next field', (loss) => {
      const ctx = setup(); ctx.details().open = true;
      const oldNext = ctx.field('y'); changeWhileBlurred(ctx, 'x', '120.25');
      const layout = ctx.card._layout, config = ctx.card._config;
      if (loss === 'role') ctx.card._hass.user.is_admin = false;
      else if (loss === 'connection') ctx.card._hass.connection.connected = false;
      else if (loss === 'model') ctx.card._layout = { ...layout, model: { ...layout.model, version: 8 } };
      else ctx.card._config = { ...config, model: '/local/replaced.glb' };
      // This is the existing synchronous ownership observer used by Root.
      expect(ctx.edit._modelPositionAllowed()).toBe(false);
      if (loss === 'role') ctx.card._hass.user.is_admin = true;
      else if (loss === 'connection') ctx.card._hass.connection.connected = true;
      else if (loss === 'model') ctx.card._layout = layout;
      else ctx.card._config = config;
      ctx.edit.afterUpdate();
      expect(ctx.field('y')).not.toBe(oldNext); expect(oldNext.isConnected).toBe(false);
      oldNext.value = '99'; oldNext.dispatchEvent(new Event('change', { bubbles: true }));
      expect(ctx.card._layout).toBe(layout); expect(ctx.card._layout.model.position).toEqual([120.25, 0, 0]);
      expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.card._store.save).toHaveBeenCalledOnce();
      expect(ctx.card._history.size).toBe(1); ctx.noActions();
      const fresh = ctx.field('y'); expect(fresh.disabled).toBe(false);
      changeWhileBlurred(ctx, 'y', '-75.5'); ctx.edit.afterUpdate();
      expect(ctx.card._layout.model).toEqual({ ...ctx.source, position: [120.25, -75.5, 0] });
      expect(ctx.card._commit).toHaveBeenCalledTimes(2); expect(ctx.card._store.save).toHaveBeenCalledTimes(2);
      expect(ctx.card._history.size).toBe(2); ctx.noActions();
    });

  it('keeps a coalesced unrelated unfocused HA update on the ordinary full-render path', () => {
    const ctx = setup(); ctx.details().open = true; const next = ctx.field('y');
    changeWhileBlurred(ctx, 'x', '120.25');
    ctx.card._hass = { ...ctx.card._hass, states: { 'sensor.unrelated': { state: '1', attributes: {} } } };
    ctx.edit.afterUpdate();
    expect(ctx.field('y')).not.toBe(next); expect(next.isConnected).toBe(false); expect(ctx.details().open).toBe(true);
    expect(ctx.card._layout.model.position).toEqual([120.25, 0, 0]); expect(ctx.card._commit).toHaveBeenCalledOnce();
    expect(ctx.card._store.save).toHaveBeenCalledOnce(); expect(ctx.card._history.size).toBe(1); ctx.noActions();
  });
  it('preserves the actual active range and caption during an own-coordinate companion refresh', () => {
    const ctx = setup(); ctx.details().open = true;
    const range = ctx.edit.panel.querySelector('[data-field="md-x"]'), caption = ctx.edit.panel.querySelector('[data-val="x"]');
    changeWhileBlurred(ctx, 'x', '120.25'); range.focus();
    expect(ctx.host.shadowRoot.activeElement).toBe(range); ctx.edit.afterUpdate();
    expect(ctx.edit.panel.querySelector('[data-field="md-x"]')).toBe(range);
    expect(ctx.host.shadowRoot.activeElement).toBe(range);
    expect(range.value).toBe('0'); expect(range.min).toBe('-50'); expect(range.max).toBe('50'); expect(caption.textContent).toBe('0');
    expect(ctx.field('x').value).toBe('120.25'); expect(ctx.card._layout.model.position).toEqual([120.25, 0, 0]);
    expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.card._store.save).toHaveBeenCalledOnce();
    expect(ctx.card._history.size).toBe(1); ctx.noActions();
  });

  it('preserves a held native range until its existing release redraw updates saved companions', () => {
    const ctx = setup(); ctx.details().open = true; ctx.edit.attach();
    const input = ctx.field('x'), next = ctx.field('y'); input.focus(); input.value = '120.25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const range = ctx.edit.panel.querySelector('[data-field="md-x"]'), caption = ctx.edit.panel.querySelector('[data-val="x"]');
    range.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    input.blur(); input.dispatchEvent(new Event('change', { bubbles: true })); ctx.edit.afterUpdate();
    expect(ctx.edit.panel.querySelector('[data-field="md-x"]')).toBe(range); expect(ctx.field('y')).toBe(next);
    expect(range.value).toBe('0'); expect(range.min).toBe('-50'); expect(range.max).toBe('50'); expect(caption.textContent).toBe('0');
    expect(ctx.card._layout.model.position).toEqual([120.25, 0, 0]); range.focus();
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    const released = ctx.edit.panel.querySelector('[data-field="md-x"]');
    expect(released).not.toBe(range); expect(released.value).toBe('120.25'); expect(released.min).toBe('-50'); expect(released.max).toBe('120.25');
    expect(ctx.edit.panel.querySelector('[data-val="x"]').textContent).toBe('120.25'); expect(ctx.host.shadowRoot.activeElement).toBe(released);
    expect(ctx.details().open).toBe(true); expect(ctx.card._commit).toHaveBeenCalledOnce(); expect(ctx.card._store.save).toHaveBeenCalledOnce();
    expect(ctx.card._history.size).toBe(1); ctx.noActions();
  });
});
