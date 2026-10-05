// @vitest-environment jsdom
// Actual native card editor/config-changed route, not live HA dashboard persistence.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const editors = [];
beforeAll(async () => {
  if (!customElements.get('ha-form')) customElements.define('ha-form', class extends HTMLElement {});
  await import('../src/card-editor.js');
});
afterEach(() => { editors.splice(0).forEach((editor) => editor.remove()); vi.restoreAllMocks(); });
const current = () => ({ user: { id: 'admin', is_active: true, is_admin: true }, connection: { connected: true },
  auth: {}, states: {}, callService: vi.fn(), callWS: vi.fn() });
const imported = () => ({ type: 'custom:taylors3d-card', layout_key: 'exact_uploaded', view_id: 'front',
  model: '/local/My_House.glb', model_position: [120.25, 18, -75.5], model_rotation: 45, model_scale: 0.01, model_opacity: 0,
  model_floors: { authored_ground: 'exact_floor' }, model_rendering: { shadows: 'off', vendor: { kept: true } },
  views: { front: { label: 'My_Front', camera: { position: [1, 2, 3], target: [0, 0, 0] }, cut: null, extension: '<literal>' },
    garden: { label: 'My_Garden', hidden: false, future: { kept: true } } }, unknown: { nullable: null, empty: '', flag: false }, height: '520px' });
function setup(config = imported(), hass = current()) {
  const editor = document.createElement('taylors3d-card-editor'); editors.push(editor); document.body.append(editor);
  const changed = vi.fn(); editor.addEventListener('config-changed', changed); editor.setConfig(config); editor.hass = hass;
  const button = (action, key) => [...editor.querySelectorAll(`[data-source-action="${action}"]`)].find((node) => key === undefined || node.dataset.viewKey === key);
  return { editor, config, hass, changed, button };
}
function begin(button, kind) {
  if (kind === 'pointer') button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  else button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: kind }));
}
function release(button, kind) {
  if (kind === 'pointer') button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  else button.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: kind }));
  button.click();
}

describe('Imported settings in the actual visual card editor', () => {
  it('inspects literal source/unknown view fields without requests, actions or changes', () => {
    const f = setup(), before = JSON.stringify(f.config);
    expect(f.editor.querySelector('[data-imported-source-controls]')).toBeTruthy();
    expect(f.editor.querySelector('[data-source-inspection="model"]').textContent).toContain('120.25');
    expect(f.editor.querySelector('[data-source-inspection="model"]').textContent).toContain('"model_opacity": 0');
    expect(f.editor.querySelector('[data-view-key="front"] [data-source-inspection="view"]').textContent).toContain('"extension": "<literal>"');
    expect(f.editor.querySelector('literal')).toBeNull(); expect(f.editor.textContent).toContain('Press Save');
    expect(f.editor.querySelector('ha-form').data.view_id).toBe('front');
    expect(f.changed).not.toHaveBeenCalled(); expect(f.hass.callService).not.toHaveBeenCalled(); expect(f.hass.callWS).not.toHaveBeenCalled();
    expect(JSON.stringify(f.config)).toBe(before);
  });

  it('Use uploaded model removes only exact URL/alignment/floor keys and emits once without cleaning other imports', () => {
    const f = setup(), expected = { ...f.config }; for (const key of ['model', 'model_position', 'model_rotation', 'model_scale', 'model_opacity', 'model_floors']) delete expected[key];
    const button = f.button('uploaded-model'); expect(button).toBeTruthy(); button.click(); button.click();
    expect(f.changed).toHaveBeenCalledOnce(); expect(f.changed.mock.calls[0][0].detail.config).toEqual(expected);
    expect(f.changed.mock.calls[0][0].bubbles).toBe(true); expect(f.changed.mock.calls[0][0].composed).toBe(true);
    expect(f.config.model).toBe('/local/My_House.glb'); expect(f.config.model_opacity).toBe(0);
    expect(f.editor.querySelector('ha-form').data.model_position_x).toBe(0);
    expect(f.hass.callService).not.toHaveBeenCalled(); expect(f.hass.callWS).not.toHaveBeenCalled();
  });

  it('automatic floor mapping clears only model_floors and preserves URL model/options and shared assets', () => {
    const f = setup(), expected = { ...f.config }; delete expected.model_floors;
    expect(f.button('automatic-floors')).toBeTruthy(); f.button('automatic-floors').click();
    expect(f.changed).toHaveBeenCalledOnce(); expect(f.changed.mock.calls[0][0].detail.config).toEqual(expected);
    expect(f.config.model_floors).toEqual({ authored_ground: 'exact_floor' });
  });

  it('clears one exact view override, keeping all other entries and unknown values without normalization', () => {
    const f = setup(), expected = { ...f.config, views: { garden: f.config.views.garden } };
    expect(f.button('shared-view', 'front')).toBeTruthy(); f.button('shared-view', 'front').click();
    expect(f.changed.mock.calls[0][0].detail.config).toEqual(expected); expect(f.changed).toHaveBeenCalledOnce();
    expect(f.config.views.front.extension).toBe('<literal>'); expect(f.editor.querySelector('ha-form').data.view_id).toBe('front');
    expect(f.button('shared-view', 'garden')).toBeTruthy();
  });

  it.each([null, [], 'malformed', 0].map((views) => ({ views })))('shows malformed imported views=$views and clears that property only when chosen', ({ views }) => {
    const f = setup({ ...imported(), views }), expected = { ...f.config }; delete expected.views;
    expect(f.editor.textContent).toContain('not a view-ID object'); expect(f.changed).not.toHaveBeenCalled();
    expect(f.button('clear-views')).toBeTruthy(); f.button('clear-views').click();
    expect(f.changed.mock.calls[0][0].detail.config).toEqual(expected);
  });

  it('keeps the same focused form and source button across unrelated readings and equivalent config display', () => {
    const f = setup(), button = f.button('shared-view', 'front'), form = f.editor.querySelector('ha-form'); button.focus(); begin(button, 'pointer');
    f.hass.states['sensor.unrelated'] = { state: '20' }; f.editor.hass = { ...f.hass, states: { ...f.hass.states } };
    expect(f.button('shared-view', 'front')).toBe(button); expect(document.activeElement).toBe(button); expect(f.editor.querySelector('ha-form')).toBe(form);
    expect(f.changed).not.toHaveBeenCalled(); release(button, 'pointer'); expect(f.changed).toHaveBeenCalledOnce();
  });

  it.each(['pointer', ' ', 'Enter'])('blocks held %s through admin/session loss and recovery, then accepts a fresh gesture', (kind) => {
    const f = setup(), button = f.button('shared-view', 'front'); expect(button).toBeTruthy(); begin(button, kind);
    f.hass.user.is_admin = false; f.editor.hass = f.hass; expect(button.disabled).toBe(true);
    f.hass.user.is_admin = true; f.editor.hass = f.hass; release(button, kind); expect(f.changed).not.toHaveBeenCalled();
    begin(button, kind); release(button, kind); expect(f.changed).toHaveBeenCalledOnce();
  });

  it.each(['connection', 'active', 'id', 'auth', 'permissions'])('observes %s revocation/replacement before recovery', (reason) => {
    const f = setup(), button = f.button('uploaded-model'); expect(button).toBeTruthy(); begin(button, 'pointer');
    const old = { connected: true, active: true, id: f.hass.user.id, auth: f.hass.auth, permissions: f.hass.user.permissions };
    if (reason === 'connection') f.hass.connection.connected = false;
    if (reason === 'active') f.hass.user.is_active = false;
    if (reason === 'id') f.hass.user.id = 'new-user';
    if (reason === 'auth') f.hass.auth = {};
    if (reason === 'permissions') f.hass.user.permissions = { changed: true };
    f.editor.hass = f.hass;
    f.hass.connection.connected = old.connected; f.hass.user.is_active = old.active; f.hass.user.id = old.id; f.hass.auth = old.auth;
    if (old.permissions === undefined) delete f.hass.user.permissions; else f.hass.user.permissions = old.permissions;
    f.editor.hass = f.hass; release(button, 'pointer'); expect(f.changed).not.toHaveBeenCalled();
    begin(button, 'pointer'); release(button, 'pointer'); expect(f.changed).toHaveBeenCalledOnce();
  });

  it('cannot delete a new override when the same view ID is reused after the old press', () => {
    const f = setup(), button = f.button('shared-view', 'front'); expect(button).toBeTruthy(); begin(button, 'pointer');
    const replacement = { ...f.config, views: { ...f.config.views, front: { label: 'Replacement', camera: { position: [9, 9, 9], target: [1, 1, 1] } } } };
    f.editor.setConfig(replacement); release(button, 'pointer'); expect(f.changed).not.toHaveBeenCalled();
    begin(f.button('shared-view', 'front'), 'pointer'); release(f.button('shared-view', 'front'), 'pointer'); expect(f.changed).toHaveBeenCalledOnce();
    expect(f.changed.mock.calls[0][0].detail.config.views).toEqual({ garden: f.config.views.garden });
  });

  it.each([' ', 'Enter'])('does not revive held %s after observed URL/layout-source change and return', (kind) => {
    const f = setup(), button = f.button('uploaded-model'); begin(button, kind);
    f.editor.setConfig({ ...f.config, model: '/local/Other_House.glb', layout_key: 'other_layout' });
    f.editor.setConfig(f.config); release(button, kind); expect(f.changed).not.toHaveBeenCalled();
    begin(button, kind); release(button, kind); expect(f.changed).toHaveBeenCalledOnce();
    expect(f.changed.mock.calls[0][0].detail.config.layout_key).toBe('exact_uploaded');
  });

  it('rejects a cancelled pointer and same-object view mutation through recovery', () => {
    const f = setup(), button = f.button('shared-view', 'front'); begin(button, 'pointer');
    button.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true, button: 0 })); release(button, 'pointer'); expect(f.changed).not.toHaveBeenCalled();
    begin(button, 'pointer'); const original = f.config.views.front.label; f.config.views.front.label = 'Different'; f.editor.setConfig(f.config);
    f.config.views.front.label = original; f.editor.setConfig(f.config); release(button, 'pointer'); expect(f.changed).not.toHaveBeenCalled();
    begin(button, 'pointer'); release(button, 'pointer'); expect(f.changed).toHaveBeenCalledOnce();
  });

  it('does not create partial controls or clear a valid oversized view map', () => {
    const views = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`view_${index}`, { label: `Exact_${index}` }]));
    const f = setup({ ...imported(), views });
    expect(f.editor.querySelectorAll('[data-source-action="shared-view"]')).toHaveLength(0);
    expect(f.button('clear-views')).toBeUndefined(); expect(f.editor.textContent).toContain('no partial view list is shown');
    expect(f.changed).not.toHaveBeenCalled(); expect(f.config.views).toBe(views);
  });

  it('blocks detached old controls, repeated held Enter and queued changes after reconnect', () => {
    const f = setup(), button = f.button('shared-view', 'front'); expect(button).toBeTruthy(); begin(button, 'Enter'); button.click(); button.click();
    expect(f.changed).toHaveBeenCalledOnce(); button.click(); expect(f.changed).toHaveBeenCalledOnce();
    const garden = f.button('shared-view', 'garden'); begin(garden, 'pointer'); f.editor.remove(); document.body.append(f.editor); release(garden, 'pointer');
    expect(f.changed).toHaveBeenCalledOnce(); f.button('shared-view', 'garden').click(); expect(f.changed).toHaveBeenCalledOnce();
    begin(f.button('shared-view', 'garden'), 'pointer'); release(f.button('shared-view', 'garden'), 'pointer'); expect(f.changed).toHaveBeenCalledTimes(2);
  });

  it.each([{ id: 'reader', is_admin: false }, { id: ' ', is_admin: true }, { id: 'admin', is_admin: true, is_active: false }])('allows raw inspection but no new clearing for %j', (user) => {
    const hass = current(); hass.user = user; const f = setup(imported(), hass);
    for (const button of f.editor.querySelectorAll('[data-source-action]')) { expect(button.disabled).toBe(true); button.click(); }
    expect(f.changed).not.toHaveBeenCalled(); expect(f.editor.querySelector('[data-source-inspection="model"]').textContent).toContain('/local/My_House.glb');
  });
});
