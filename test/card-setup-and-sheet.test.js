// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HouseShell } from '../src/house-shell.js';
import '../src/taylors3d-card.js';

const prototype = customElements.get('taylors3d-card').prototype;
const mounted = [];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setupSave() {
  const next = { version: 1, rooms: [], future: { retained: true } }, token = { next };
  let allowed = true;
  const card = { _layout: { version: 1, rooms: [] }, _editing: true, _history: { current: {} },
    _hass: { user: { id: 'admin' }, connection: {} }, _store: { save: vi.fn(async () => true) },
    _suspendAmbient: vi.fn(), _syncCustomControls: vi.fn(), _syncSecurity: vi.fn(), finishWallSelectionPreparation: vi.fn(),
    _recordHistory: vi.fn(), _schedule: vi.fn(), _toggleEdit: vi.fn(),
    _edit: { setSaveState: vi.fn(), setupSaveCurrent: vi.fn((seen) => allowed && seen === token) },
    _commit: prototype._commit, completeSetup: prototype.completeSetup };
  return { card, next, token, revoke: () => { allowed = false; } };
}
const bounds = (width, height) => ({ width, height, x: 0, y: 0, left: 0, top: 0, right: width, bottom: height });
function sheet({ width = 320, height = 340, minimum = '120px', priority = 'important' } = {}) {
  const card = document.createElement('taylors3d-resize-fixture'); card.attachShadow({ mode: 'open' }); document.body.append(card);
  card.shadowRoot.innerHTML = '<ha-card><div class="stage"><div class="scene"></div><nav class="toolbar"></nav><div class="taylors3d-device-popup"></div></div></ha-card>';
  card._stage = card.shadowRoot.querySelector('.stage'); card._scene = card.shadowRoot.querySelector('.scene'); card._toolbar = card.shadowRoot.querySelector('.toolbar');
  card._stage.style.height = `${height}px`; if (minimum) card._stage.style.setProperty('min-height', minimum, priority);
  const sizes = { width, height, sheet: 300, toolbar: 40 };
  const stage = card._stage;
  stage.getBoundingClientRect = () => bounds(sizes.width, Math.max(sizes.height, parseFloat(stage.style.minHeight) || 0));
  card._scene.getBoundingClientRect = () => bounds(sizes.width, Math.max(0, stage.getBoundingClientRect().height
    - (parseFloat(stage.style.getPropertyValue('--taylors3d-bar-height')) || 0)
    - (stage.hasAttribute('data-taylors3d-standard-sheet') ? parseFloat(stage.style.getPropertyValue('--taylors3d-standard-sheet-height')) || 0 : 0)));
  card._toolbar.getBoundingClientRect = () => bounds(sizes.width, sizes.toolbar);
  const popup = card.shadowRoot.querySelector('.taylors3d-device-popup'); popup.dataset.roomSheet = 'half';
  popup.getBoundingClientRect = () => bounds(sizes.width - 16, popup.hidden ? 0 : sizes.sheet);
  card._devicePopup = { el: popup, isOpen: true, placement: 'right', updateRoomSheetGeometry: vi.fn(), reposition: vi.fn() };
  card._view = { resize: vi.fn() }; card._config = {}; card._fitted = true; card._editing = false;
  card._hass = { user: { id: 'admin', is_active: true }, connection: { connected: true }, auth: {}, states: {}, config: {}, callService: vi.fn() };
  card._resize = prototype._resize;
  if (prototype._restoreStandardSheetMinimum) card._restoreStandardSheetMinimum = prototype._restoreStandardSheetMinimum;
  const shell = new HouseShell(card, { onSelect: vi.fn() }); card._houseShell = shell;
  mounted.push({ dispose() { shell.dispose(); card.remove(); } });
  const house = () => { shell.setData({ enabled: true, scheme: 'dark' }); shell.header.element.getBoundingClientRect = () => bounds(sizes.width, 44);
    shell.navigation.element.getBoundingClientRect = () => bounds(sizes.width, 44); };
  return { card, stage, popup, sizes, shell, house, close() { card._devicePopup.isOpen = false; popup.hidden = true; card._resize(); } };
}
afterEach(() => { for (const item of mounted.splice(0)) item.dispose(); vi.restoreAllMocks(); });

describe('root setup Save and finish authority', () => {
  it('dispatches the current exact layout once and leaves Edit only after actual owned persistence succeeds', async () => {
    const f = setupSave(), run = deferred(); f.card._store.save.mockReturnValue(run.promise);
    const finish = f.card.completeSetup(f.next, f.token);
    expect(f.card._store.save).toHaveBeenCalledExactlyOnceWith(f.card._hass, f.next); expect(f.card._toggleEdit).not.toHaveBeenCalled();
    run.resolve(true); expect(await finish).toBe(true); expect(f.card._layout).toBe(f.next); expect(f.card._toggleEdit).toHaveBeenCalledOnce();
  });
  it.each(['false', 'rejected', 'thrown'])('does not leave Edit or claim finished after %s persistence', async (result) => {
    const f = setupSave();
    if (result === 'false') f.card._store.save.mockResolvedValue(false);
    if (result === 'rejected') f.card._store.save.mockRejectedValue(new Error('simulated'));
    if (result === 'thrown') f.card._store.save.mockImplementation(() => { throw new Error('simulated'); });
    expect(await f.card.completeSetup(f.next, f.token)).toBe(false); expect(f.card._toggleEdit).not.toHaveBeenCalled();
    expect(f.card._editing).toBe(true); expect(f.card._edit.setSaveState).toHaveBeenLastCalledWith('failed');
  });
  it.each(['token', 'layout', 'inactive', 'stale'])('sends no setup write for initial invalid %s authority', async (invalid) => {
    const f = setupSave(); let next = f.next, token = f.token;
    if (invalid === 'token') token = { next };
    if (invalid === 'layout') next = { ...next };
    if (invalid === 'inactive') f.card._editing = false;
    if (invalid === 'stale') f.revoke();
    expect(await f.card.completeSetup(next, token)).toBe(false); expect(f.card._store.save).not.toHaveBeenCalled(); expect(f.card._toggleEdit).not.toHaveBeenCalled();
  });
  it.each(['store', 'editor', 'layout', 'exit', 'context-revoked'])('ignores a late successful setup Save after %s replacement', async (changed) => {
    const f = setupSave(), run = deferred(); f.card._store.save.mockReturnValue(run.promise);
    const finish = f.card.completeSetup(f.next, f.token);
    if (changed === 'store') f.card._store = { save: vi.fn() };
    if (changed === 'editor') f.card._edit = { setupSaveCurrent: () => true };
    if (changed === 'layout') f.card._layout = { ...f.next };
    if (changed === 'exit') f.card._editing = false;
    if (changed === 'context-revoked') f.revoke();
    run.resolve(true); expect(await finish).toBe(false); expect(f.card._toggleEdit).not.toHaveBeenCalled();
  });
});

describe('root standard room overlay preserves drawing geometry', () => {
  it('restores the exact authored minimum and priority when a standard sheet closes', () => {
    const f = sheet(); f.card._resize(); expect(f.stage.style.minHeight).toBe('120px');
    expect(f.stage.style.getPropertyPriority('min-height')).toBe('important');
    const opened = f.card._scene.getBoundingClientRect(); f.close(); expect(f.card._scene.getBoundingClientRect()).toEqual(opened);
    expect(f.stage.style.minHeight).toBe('120px'); expect(f.stage.style.getPropertyPriority('min-height')).toBe('important');
    expect(f.stage.hasAttribute('data-taylors3d-standard-sheet')).toBe(false);
  });
  it('uses the configured base height when reopening or repeatedly resizing a tall sheet', () => {
    const f = sheet(); f.card._resize(); const expanded = f.stage.style.minHeight; f.card._resize(); f.card._resize();
    expect(f.stage.style.minHeight).toBe(expanded); expect(f.card._devicePopup.updateRoomSheetGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ baseHeight: 340 }));
    f.close(); f.card._devicePopup.isOpen = true; f.popup.hidden = false; f.card._resize(); expect(f.stage.style.minHeight).toBe(expanded);
  });
  it('restores the temporary minimum on a desktop transition even while the panel remains open', () => {
    const f = sheet(); f.card._resize(); f.sizes.width = 1200; f.popup.dataset.roomSheet = 'desktop'; f.card._resize();
    expect(f.stage.style.minHeight).toBe('120px'); expect(f.stage.hasAttribute('data-taylors3d-standard-sheet')).toBe(false);
  });
  it('preserves a later foreign minimum value on close', () => {
    const f = sheet(); f.card._resize(); f.stage.style.setProperty('min-height', '777px', 'important'); f.close();
    expect(f.stage.style.minHeight).toBe('777px'); expect(f.stage.style.getPropertyPriority('min-height')).toBe('important');
  });
  it('preserves a foreign priority change even when its numeric minimum equals the prior owned value', () => {
    const f = sheet(); f.card._resize(); const owned = f.stage.style.minHeight;
    f.stage.style.setProperty('min-height', owned, 'important'); f.close();
    expect(f.stage.style.minHeight).toBe(owned); expect(f.stage.style.getPropertyPriority('min-height')).toBe('important');
  });
  it('releases standard ownership before House measures, and style-off restores the original authored baseline', () => {
    const f = sheet(); f.card._resize(); f.house(); f.card._resize();
    expect(f.card._standardSheetMinimum).toBeFalsy(); expect(f.stage.hasAttribute('data-taylors3d-standard-sheet')).toBe(false);
    f.card._devicePopup.isOpen = false; f.popup.hidden = true; f.shell.setData({ enabled: false }); f.card._resize();
    expect(f.stage.style.minHeight).toBe('120px'); expect(f.stage.style.getPropertyPriority('min-height')).toBe('important');
  });
  it('does not reuse the prior stage minimum record for a replacement stage', () => {
    const f = sheet(); f.card._resize(); const old = f.stage;
    const replacement = document.createElement('div'); replacement.style.height = '340px'; f.card.shadowRoot.append(replacement);
    replacement.getBoundingClientRect = () => bounds(320, Math.max(340, parseFloat(replacement.style.minHeight) || 0));
    f.card._stage = replacement; f.card._resize(); f.card._devicePopup.isOpen = false; f.popup.hidden = true; f.card._resize();
    expect(replacement.style.minHeight).toBe(''); expect(old.style.minHeight).toBe('120px');
  });
});
