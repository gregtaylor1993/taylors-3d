// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScenePreviewController } from '../src/scene-preview.js';
import { ScenePreviewBar } from '../src/scene-preview-bar.js';

const rgb = (patch = {}) => ({ entity_id: 'light.main', state: 'on', attributes: {
  color_mode: 'rgb', supported_color_modes: ['rgb'], brightness: 128, rgb_color: [255, 0, 0] }, ...patch });
const item = (id = 'movie', patch = {}) => ({ id, label: id === 'movie' ? 'Movie' : 'Reading', scene_entity: `scene.${id}`,
  lights: [{ entity: 'light.main', state: 'on', brightness: 200, color: { mode: 'rgb', rgb: [0, 0, 255] } }], ...patch });
const instances = [];
function fixture({ settings, hass: patch } = {}) {
  const connection = Object.assign(new EventTarget(), { connected: true });
  const hass = { user: { id: 'taylor', is_admin: true }, connection, services: { scene: { turn_on: {} } }, callService: vi.fn(async () => ({})),
    states: { 'scene.movie': { entity_id: 'scene.movie', state: 'unknown', attributes: { friendly_name: 'Actual Movie scene' } },
      'scene.reading': { entity_id: 'scene.reading', state: 'unknown', attributes: {} }, 'light.main': rgb() }, entities: {}, devices: {}, ...patch };
  const context = { hass, settings: settings || { enabled: true, items: [item(), item('reading')] }, contextKey: 'house:ground:3d', suspended: false };
  const host = document.createElement('div'); document.body.append(host);
  const preview = vi.fn(); let bar;
  const controller = new ScenePreviewController({ getContext: () => ({ hass: context.hass, bindings: context.settings, contextKey: context.contextKey }),
    onPreview: preview, onStatus: (status) => { context.status = status; bar?.update(); } });
  bar = new ScenePreviewBar(host, { controller, getContext: () => context }); instances.push({ bar, controller, host });
  const button = (action, id = 'movie') => action === 'stop' ? bar.stopButton : [...host.querySelectorAll(`[data-scene-action="${action}"]`)].find((node) => node.dataset.sceneId === id);
  const pointer = (action, type, pointerType = 'mouse', detail = {}) => {
    const event = Object.assign(new Event(type, { bubbles: !['pointerenter', 'pointerleave'].includes(type) }), { pointerType, button: 0, buttons: 0, ...detail });
    (typeof action === 'string' ? button(action) : action).dispatchEvent(event);
  };
  const key = (action, type, value = 'Enter', repeat = false) => button(action).dispatchEvent(new KeyboardEvent(type, { key: value, repeat, bubbles: true }));
  const hover = (action = 'preview') => { pointer(action, 'pointerenter'); pointer(action, 'pointermove', 'mouse', { movementX: 1, movementY: 0 }); };
  return { context, hass, host, bar, controller, preview, button, pointer, key, hover };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { for (const { bar, controller, host } of instances.splice(0)) { bar.dispose(); controller.dispose(); host.remove(); } });

describe('saved visual previews are separate from real scene actions', () => {
  it.each([
    ['en', 'Request for Movie accepted. Check the current readings.'],
    ['de', 'Anfrage für Movie angenommen. Prüfe die aktuellen Werte.'],
    ['fr', 'Demande pour Movie acceptée. Vérifiez les valeurs actuelles.'],
    ['es', 'Solicitud para Movie aceptada. Comprueba las lecturas actuales.'],
  ])('reports an accepted request in %s without claiming a scene result', async (language, message) => {
    const f = fixture({ hass: { language } }); f.button('activate').click(); await tick();
    expect(f.bar.status.textContent).toBe(message);
    expect(f.hass.states['scene.movie'].state).toBe('unknown');
    expect(f.hass.states['light.main'].attributes.rgb_color).toEqual([255, 0, 0]);
  });
  it('shows exact saved labels and accessible distinct actions without any command or state mutation', () => {
    const f = fixture(), state = f.hass.states['light.main'];
    expect(f.host.querySelector('[data-scene-preview-bar]')).toBe(f.bar.el);
    expect(f.button('preview').textContent).toBe('Preview Movie'); expect(f.button('activate').getAttribute('aria-label')).toContain('Home Assistant');
    expect(f.button('preview').getAttribute('aria-label')).toContain('model only'); expect(f.bar.status.getAttribute('aria-live')).toBe('polite');
    expect(f.bar.stopButton.disabled).toBe(true); expect(f.hass.states['light.main']).toBe(state); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('retains all choices and keyboard focus in a long saved list, with an exact last-scene action', async () => {
    const items = Array.from({ length: 24 }, (_, index) => item(`view_${index}`, { label: `Saved room view ${index}` }));
    const states = { 'light.main': rgb() };
    for (const entry of items) states[entry.scene_entity] = { entity_id: entry.scene_entity, state: 'unknown', attributes: {} };
    const f = fixture({ settings: { enabled: true, items }, hass: { states } });
    const preview = f.button('preview', 'view_23'), activate = f.button('activate', 'view_23');
    preview.focus();
    f.context.hass = { ...f.context.hass, states: { ...states, 'sensor.other': { state: '2', attributes: {} } } };
    f.bar.update();
    expect(f.bar.items.children).toHaveLength(24); expect(document.activeElement).toBe(preview);
    expect(f.button('preview', 'view_23')).toBe(preview); expect(f.button('activate', 'view_23')).toBe(activate);
    preview.click(); expect(f.controller.active.itemId).toBe('view_23'); expect(f.hass.callService).not.toHaveBeenCalled();
    activate.focus(); activate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); activate.click(); await tick();
    expect(f.hass.callService).toHaveBeenCalledExactlyOnceWith('scene', 'turn_on', { entity_id: 'scene.view_23' });
    expect(f.controller.active).toBeNull(); expect(f.hass.states['light.main'].state).toBe('on');
  });
  it('does not create an active bar for disabled or malformed settings', () => {
    for (const settings of [{ enabled: false, items: [item()] }, { enabled: 'true', items: [item()] }, { enabled: true, items: null }]) {
      const f = fixture({ settings }); expect(f.bar.el.hidden).toBe(true); expect(f.hass.callService).not.toHaveBeenCalled();
    }
  });
  it('mouse entry/exit previews and clears only renderer light targets, keeping the latest real HA state intact', () => {
    const f = fixture(), original = f.hass.states['light.main']; f.hover();
    expect(f.controller.active.itemId).toBe('movie'); expect(f.preview.mock.calls[0][0].get('light.main').appearance.color).toEqual([0, 0, 255]);
    const latest = rgb({ attributes: { color_mode: 'rgb', supported_color_modes: ['rgb'], brightness: 40, rgb_color: [0, 255, 0] } });
    f.hass.states = { ...f.hass.states, 'light.main': latest }; f.bar.update(); f.pointer('preview', 'pointerleave');
    expect(f.controller.active).toBeNull(); expect(f.preview.mock.calls.at(-1)[0]).toBeNull(); expect(f.hass.states['light.main']).toBe(latest);
    expect(original.attributes.rgb_color).toEqual([255, 0, 0]); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('focus and touch entry never activate or silently preview; explicit touch click pins until Stop', () => {
    const f = fixture(); f.button('preview').focus(); f.pointer('preview', 'pointerenter', 'touch');
    f.pointer('preview', 'pointermove', 'touch', { movementX: 1, movementY: 0 });
    expect(f.preview).not.toHaveBeenCalled(); expect(f.hass.callService).not.toHaveBeenCalled();
    f.pointer('preview', 'pointerdown', 'touch'); f.button('preview').click(); f.pointer('preview', 'pointerleave', 'touch');
    expect(f.controller.active.itemId).toBe('movie'); expect(f.bar.stopButton.disabled).toBe(false); expect(f.bar.status.textContent).toContain('Press Stop preview');
    f.bar.stopButton.click(); expect(f.controller.active).toBeNull(); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('old mouseleave cannot cancel a newer preview token', () => {
    const f = fixture(), first = f.button('preview'), second = f.button('preview', 'reading');
    f.hover(first); const old = f.controller.active.token;
    f.hover(second); const current = f.controller.active.token;
    expect(current).not.toBe(old); f.pointer(first, 'pointerleave');
    expect(f.controller.active.token).toBe(current); expect(f.preview.mock.calls.map(([map]) => map === null)).toEqual([false, false]);
    f.pointer(second, 'pointerleave'); expect(f.controller.active).toBeNull(); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('a pinned preview survives other hover until an explicit new preview or Stop', () => {
    const f = fixture(); f.button('preview').click(); const current = f.controller.active.token;
    f.hover(f.button('preview', 'reading')); f.pointer('preview', 'pointerleave');
    expect(f.controller.active.token).toBe(current);
    f.button('preview', 'reading').click(); expect(f.controller.active.itemId).toBe('reading'); f.bar.stopButton.click();
    expect(f.controller.active).toBeNull(); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('keyboard Preview pins and Escape stops without a device action', () => {
    const f = fixture(); f.key('preview', 'keydown'); f.button('preview').click(); f.key('preview', 'keyup');
    expect(f.controller.active.itemId).toBe('movie'); f.key('preview', 'keydown', 'Escape'); expect(f.controller.active).toBeNull();
    expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('requires real unheld mouse movement rather than stationary boundary entry or malformed motion', () => {
    const f = fixture(); f.pointer('preview', 'pointerenter');
    for (const detail of [
      { movementX: 0, movementY: 0 }, { movementX: NaN, movementY: 1 },
      { movementX: 1, movementY: Infinity }, { movementX: '1', movementY: 0 },
      { movementX: 1, movementY: 0, buttons: 1 }, {},
    ]) f.pointer('preview', 'pointermove', 'mouse', detail);
    expect(f.controller.active).toBeNull(); expect(f.preview).not.toHaveBeenCalled();
    f.pointer('preview', 'pointermove', 'mouse', { movementX: 0, movementY: -1 });
    expect(f.controller.active.itemId).toBe('movie'); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('keeps a stationary recovered context clear until a new genuine mouse move', () => {
    const f = fixture(); f.hover(); const token = f.controller.active.token;
    f.context.contextKey = 'house:new-model:3d'; f.bar.update();
    expect(f.controller.active).toBeNull();
    f.pointer('preview', 'pointerenter'); f.pointer('preview', 'pointermove', 'mouse', { movementX: 0, movementY: 0 });
    expect(f.controller.active).toBeNull();
    f.pointer('preview', 'pointermove', 'mouse', { movementX: 1, movementY: 0 });
    expect(f.controller.active.itemId).toBe('movie'); expect(f.controller.active.token).not.toBe(token);
    expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('does not revive a disposed preview when replacement DOM enters under the stationary mouse', () => {
    const f = fixture(); f.hover(); const old = f.controller.active.token;
    f.bar.dispose(); f.context.contextKey = 'house:replacement:3d';
    const bar = new ScenePreviewBar(f.host, { controller: f.controller, getContext: () => f.context });
    instances.push({ bar, controller: f.controller, host: f.host });
    const button = bar.el.querySelector('[data-scene-action="preview"][data-scene-id="movie"]');
    f.pointer(button, 'pointerenter'); f.pointer(button, 'pointermove', 'mouse', { movementX: 0, movementY: 0 });
    expect(f.controller.active).toBeNull();
    f.pointer(button, 'pointermove', 'mouse', { movementX: -1, movementY: 0 });
    expect(f.controller.active.itemId).toBe('movie'); expect(f.controller.active.token).not.toBe(old);
    expect(f.hass.callService).not.toHaveBeenCalled();
    f.pointer(button, 'pointerleave'); expect(f.controller.active).toBeNull();
  });
  it('retains one current hover token and override across repeated genuine movement and unrelated readings', () => {
    const f = fixture(); f.hover(); const token = f.controller.active.token;
    for (let index = 0; index < 4; index++) f.pointer('preview', 'pointermove', 'mouse', { movementX: 1, movementY: 0 });
    f.hass.states['sensor.unrelated'] = { state: '7', attributes: {} }; f.bar.update();
    f.pointer('preview', 'pointermove', 'mouse', { movementX: 0, movementY: 1 });
    expect(f.controller.active.token).toBe(token); expect(f.preview).toHaveBeenCalledOnce();
    expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('regular users can activate an unknown scene even when its visual light preview is incomplete', async () => {
    const f = fixture({ settings: { enabled: true, items: [item('movie', { lights: [] })] }, hass: { user: { id: 'ordinary-user', is_admin: false } } });
    expect(f.button('preview').disabled).toBe(true); expect(f.button('activate').disabled).toBe(false);
    f.button('activate').click(); await tick();
    expect(f.hass.callService).toHaveBeenCalledOnce(); expect(f.hass.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' });
    expect(f.hass.states['scene.movie'].state).toBe('unknown'); expect(f.hass.states['light.main'].attributes.rgb_color).toEqual([255, 0, 0]);
    expect(f.bar.status.textContent).toContain('Request for Movie accepted. Check the current readings.');
  });
  it.each(['unavailable', 'restored', 'removed', 'hidden', 'device-disabled'])('disables a %s scene from actual evidence without guessing another source', (kind) => {
    const f = fixture();
    if (kind === 'unavailable') f.hass.states['scene.movie'].state = 'unavailable';
    if (kind === 'restored') f.hass.states['scene.movie'].attributes.restored = true;
    if (kind === 'removed') delete f.hass.states['scene.movie'];
    if (kind === 'hidden') f.hass.entities['scene.movie'] = { hidden_by: 'user' };
    if (kind === 'device-disabled') { f.hass.entities['scene.movie'] = { device_id: 'hub' }; f.hass.devices.hub = { disabled_by: 'user' }; }
    f.bar.update(); f.button('activate').click(); f.button('preview').click();
    expect(f.button('activate').disabled).toBe(true); expect(f.button('preview').disabled).toBe(true); expect(f.hass.callService).not.toHaveBeenCalled();
    expect(f.controller.active).toBeNull();
  });
  it.each(['id', 'scene'])('never acts on an ambiguous duplicate %s mapping', (kind) => {
    const duplicate = kind === 'id' ? item('movie', { scene_entity: 'scene.reading' }) : item('other', { scene_entity: 'scene.movie' });
    const f = fixture({ settings: { enabled: true, items: [item(), duplicate] } });
    for (const button of f.host.querySelectorAll('button[data-scene-id]')) { expect(button.disabled).toBe(true); button.click(); }
    expect(f.preview).not.toHaveBeenCalled(); expect(f.hass.callService).not.toHaveBeenCalled();
  });
});

describe('deliberate actions remain tied to the pressed current scene', () => {
  it.each(['connection', 'user', 'service', 'mapping', 'context', 'source', 'metadata', 'permission'])('poisons a pressed action after %s revocation and recovery until a new deliberate gesture', async (kind) => {
    const f = fixture(), button = f.button('activate'); f.pointer('activate', 'pointerdown');
    let restore;
    if (kind === 'connection') { f.hass.connection.connected = false; restore = () => { f.hass.connection.connected = true; }; }
    if (kind === 'user') { f.hass.user.id = 'different'; restore = () => { f.hass.user.id = 'taylor'; }; }
    if (kind === 'service') { delete f.hass.services.scene.turn_on; restore = () => { f.hass.services.scene.turn_on = {}; }; }
    if (kind === 'mapping') { f.context.settings.items[0].scene_entity = 'scene.reading'; restore = () => { f.context.settings.items[0].scene_entity = 'scene.movie'; }; }
    if (kind === 'context') { f.context.contextKey = 'other-floor'; restore = () => { f.context.contextKey = 'house:ground:3d'; }; }
    if (kind === 'source') { f.hass.states['scene.movie'].state = 'unavailable'; restore = () => { f.hass.states['scene.movie'].state = 'unknown'; }; }
    if (kind === 'metadata') { f.hass.entities['scene.movie'] = { hidden: true }; restore = () => { delete f.hass.entities['scene.movie']; }; }
    if (kind === 'permission') { f.hass.user.is_active = false; restore = () => { f.hass.user.is_active = true; }; }
    f.bar.update(); restore(); f.bar.update(); expect(f.button('activate')).toBe(button);
    f.pointer('activate', 'pointerup'); button.click(); await tick(); expect(f.hass.callService).not.toHaveBeenCalled();
    f.pointer('activate', 'pointerdown'); f.pointer('activate', 'pointerup'); button.click(); await tick();
    expect(f.hass.callService).toHaveBeenCalledOnce(); expect(f.hass.callService.mock.calls[0][2]).toEqual({ entity_id: 'scene.movie' });
  });
  it('checks the exact intended entity at final click even without an intervening update', async () => {
    const f = fixture(); f.pointer('activate', 'pointerdown');
    f.context.settings.items[0].scene_entity = 'scene.reading'; f.context.settings.items.pop(); f.button('activate').click(); await tick();
    expect(f.hass.callService).not.toHaveBeenCalled();
    f.pointer('activate', 'pointerdown'); f.pointer('activate', 'pointerup'); f.button('activate').click(); await tick();
    expect(f.hass.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.reading' });
  });
  it('does not allow cancelled pointer gestures to revive, while a fresh keyboard gesture is deliberate', async () => {
    const f = fixture(); f.pointer('activate', 'pointerdown'); f.pointer('activate', 'pointercancel'); f.button('activate').click();
    await tick(); expect(f.hass.callService).not.toHaveBeenCalled();
    f.key('activate', 'keydown', ' '); f.key('activate', 'keyup', ' '); f.button('activate').click(); await tick(); expect(f.hass.callService).toHaveBeenCalledOnce();
  });
  it('keeps a stale Space gesture cancelled across source recovery and key release', async () => {
    const f = fixture(); f.key('activate', 'keydown', ' ');
    f.hass.states['scene.movie'].state = 'unavailable'; f.bar.update(); f.hass.states['scene.movie'].state = 'unknown'; f.bar.update();
    f.key('activate', 'keyup', ' '); f.button('activate').click(); await tick(); expect(f.hass.callService).not.toHaveBeenCalled();
    f.key('activate', 'keydown', ' '); f.key('activate', 'keyup', ' '); f.button('activate').click(); await tick(); expect(f.hass.callService).toHaveBeenCalledOnce();
  });
  it('held Enter repeat never duplicates a completed action; the next key press is a new deliberate action', async () => {
    const f = fixture(); f.key('activate', 'keydown'); f.button('activate').click(); await tick();
    f.key('activate', 'keydown', 'Enter', true); f.button('activate').click(); await tick(); expect(f.hass.callService).toHaveBeenCalledOnce();
    f.key('activate', 'keyup'); f.key('activate', 'keydown'); f.button('activate').click(); await tick(); expect(f.hass.callService).toHaveBeenCalledTimes(2);
  });
  it('shows pending action feedback and sends exactly once until acknowledgement', async () => {
    const f = fixture(); let finish; f.hass.callService.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    f.button('activate').click(); expect(f.bar.status.textContent).toContain('Requesting Movie'); expect(f.button('activate').disabled).toBe(true);
    f.button('activate').click(); expect(f.hass.callService).toHaveBeenCalledOnce(); finish(); await tick();
    expect(f.button('activate').disabled).toBe(false); expect(f.bar.status.textContent).toContain('Request for Movie accepted. Check the current readings.');
  });
  it('shows actual service failures as text and never fabricates a light or scene state', async () => {
    const f = fixture(), original = f.hass.states; f.hass.callService.mockRejectedValue(new Error('<img src=x onerror=alert(1)> denied'));
    f.button('activate').click(); await tick(); expect(f.bar.status.textContent).toContain('denied'); expect(f.bar.status.querySelector('img')).toBeNull();
    expect(f.hass.states).toBe(original); expect(f.hass.callService).toHaveBeenCalledOnce();
  });
});

describe('stable accessible DOM and owned lifecycle', () => {
  it('retains the exact focused buttons across cloned unrelated HA readings and live names', () => {
    const f = fixture(), button = f.button('preview'); button.focus();
    f.hass.states = JSON.parse(JSON.stringify(f.hass.states)); f.hass.states['sensor.other'] = { state: '123', attributes: {} }; f.bar.update();
    expect(f.button('preview')).toBe(button); expect(document.activeElement).toBe(button);
    f.context.settings.items[0].label = 'New name'; f.bar.update(); expect(f.button('preview')).toBe(button); expect(document.activeElement).toBe(button);
    expect(button.textContent).toBe('Preview New name'); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('writes imported labels as literal text without HTML or selector interpolation', () => {
    const f = fixture({ settings: { enabled: true, items: [item('movie', { label: '<img src=x onerror=alert(1)>' })] } });
    expect(f.button('preview').textContent).toContain('<img'); expect(f.host.querySelector('img')).toBeNull(); expect(f.button('preview').disabled).toBe(false);
  });
  it('suspends its current preview and stale press, never resuming either automatically', async () => {
    const f = fixture(); f.button('preview').click(); f.pointer('activate', 'pointerdown');
    f.context.suspended = true; f.bar.update(); expect(f.bar.el.hidden).toBe(true); expect(f.controller.active).toBeNull();
    f.context.suspended = false; f.bar.update(); f.button('activate').click(); await tick();
    expect(f.controller.active).toBeNull(); expect(f.hass.callService).not.toHaveBeenCalled();
  });
  it('disconnect and disposal stop only the owned token and leave no actionable detached buttons', async () => {
    const f = fixture(), button = f.button('activate'); f.button('preview').click(); f.host.remove(); f.bar.update();
    expect(f.controller.active).toBeNull(); button.click(); await tick(); expect(f.hass.callService).not.toHaveBeenCalled();
    document.body.append(f.host); f.bar.update(); f.button('preview').click(); f.controller.preview('reading'); const current = f.controller.active.token;
    f.bar.dispose(); expect(f.controller.active.token).toBe(current); expect(f.host.children.length).toBe(0); button.click(); await tick();
    expect(f.hass.callService).not.toHaveBeenCalled(); expect(f.controller.preview('movie').ok).toBe(true);
  });
  it('ignores a late acknowledgement after disposal and never revives its DOM or preview', async () => {
    const f = fixture(); let finish; f.hass.callService.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    f.button('activate').click(); f.bar.dispose(); finish(); await tick(); expect(f.host.children.length).toBe(0); expect(f.controller.active).toBeNull();
    expect(f.hass.callService).toHaveBeenCalledOnce();
  });
  it('keeps pointer/key/click interactions out of the surrounding orbit and room handlers', async () => {
    const f = fixture(), pointer = vi.fn(), key = vi.fn(), click = vi.fn();
    f.host.addEventListener('pointerdown', pointer); f.host.addEventListener('keydown', key); f.host.addEventListener('click', click);
    f.pointer('activate', 'pointerdown'); f.pointer('activate', 'pointerup'); f.button('activate').click(); await tick();
    f.key('preview', 'keydown'); expect(pointer).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
  });
});
