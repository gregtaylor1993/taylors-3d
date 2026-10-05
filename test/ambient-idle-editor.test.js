// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmbientIdleEditor } from '../src/ambient-idle-editor.js';

const editors = [];
const sun = (elevation = -12, attributes = {}) => ({ entity_id: 'sun.sun', state: elevation >= 0 ? 'above_horizon' : 'below_horizon', attributes: { elevation, azimuth: 180, ...attributes } });
function setup({ layout = {}, config = {}, admin = true, timeZone = 'Europe/London', currentSun = sun(), now = Date.parse('2026-10-05T23:00:00Z') } = {}) {
  const card = { _layout: layout, _config: { layout_key: 'house', ...config }, _view: { model: null },
    _hass: { user: { id: 'taylor', is_admin: admin }, config: { time_zone: timeZone }, states: currentSun ? { 'sun.sun': currentSun } : {},
      callService: vi.fn(), callWS: vi.fn() },
    commitFeatureLayout: vi.fn((patch) => { card._layout = { ...card._layout, ...patch }; }),
  };
  const host = document.createElement('div'); document.body.append(host);
  const editor = new AmbientIdleEditor(card, () => { host.innerHTML = editor.render(); editor.updatePreviews(host); }, { now: () => now }); editors.push(editor);
  host.addEventListener('input', (event) => editor.onInput(event.target.dataset.field, event.target));
  host.addEventListener('change', (event) => editor.onChange(event.target.dataset.field, event.target));
  host.addEventListener('click', (event) => editor.onClick(event.target.closest('[data-act]')?.dataset.act));
  host.innerHTML = editor.render(); editor.updatePreviews(host);
  const field = (name) => host.querySelector(`[data-field="ambient-idle-${name}"]`);
  const change = (name, value, type = 'input') => { const control = field(name); if (control.type === 'checkbox') control.checked = value; else control.value = value;
    control.dispatchEvent(new Event(type, { bubbles: true })); return control; };
  const button = (action) => host.querySelector(`[data-act="ambient-idle-${action}"]`);
  const click = (action) => button(action).click();
  return { card, editor, host, field, change, button, click };
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('ambient idle settings stay explicit drafts', () => {
  it('opens disabled defaults without timers, display effects, storage or HA actions', () => {
    const timer = vi.spyOn(globalThis, 'setTimeout'), frame = vi.spyOn(globalThis, 'requestAnimationFrame');
    const { card, host, field } = setup();
    expect(field('enabled').checked).toBe(false); expect(field('idle_seconds').value).toBe('120');
    expect(field('rotation_degrees_per_second').value).toBe('0.5'); expect(field('dim.brightness').value).toBe('65');
    expect(host.textContent).toContain('not your tablet backlight or real lights');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled(); expect(frame).not.toHaveBeenCalled();
  });
  it('saves intentional native changes once, with percentage converted to the saved fraction', () => {
    const { card, change, click, host } = setup();
    change('enabled', true, 'change'); change('idle_seconds', '90'); change('rotation_degrees_per_second', '0.8');
    change('dim.enabled', true, 'change'); change('dim.brightness', '55'); change('dim.when', 'quiet_hours', 'change');
    change('dim.start', '21:30'); change('dim.end', '06:45'); expect(host.textContent).toContain('Unsaved settings');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); click('save'); click('save');
    expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); expect(card._layout.ambient_idle).toEqual({
      enabled: true, idle_seconds: 90, rotation_degrees_per_second: 0.8,
      dim: { enabled: true, brightness: 0.55, when: 'quiet_hours', start: '21:30', end: '06:45' },
    });
    expect(card._hass.callService).not.toHaveBeenCalled(); expect(card._hass.callWS).not.toHaveBeenCalled();
  });
  it('uses shared layout before YAML and preserves every untouched field', () => {
    const saved = { enabled: false, future: { nested: ['retain', 2] }, dim: { enabled: false, future: { author: '<Taylor>' }, brightness: 0.623456 } };
    const config = { ambient_idle: { enabled: true, idle_seconds: 8 } };
    const { card, change, click, field } = setup({ layout: { ambient_idle: saved }, config });
    expect(field('enabled').checked).toBe(false); change('idle_seconds', '75'); click('save');
    expect(card._layout.ambient_idle).toEqual({ ...saved, idle_seconds: 75 });
    expect(card._config.ambient_idle).toEqual(config.ambient_idle); expect(saved.idle_seconds).toBeUndefined();
  });
  it('inherits YAML without rewriting omitted values or changing it on Cancel', () => {
    const saved = { enabled: true, idle_seconds: 50, extension: { note: 'YAML' } };
    const { card, change, click, field } = setup({ config: { ambient_idle: saved } });
    change('idle_seconds', '100'); click('cancel'); expect(field('idle_seconds').value).toBe('50');
    expect(card._layout.ambient_idle).toBeUndefined(); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    change('rotate', false, 'change'); click('save'); expect(card._layout.ambient_idle).toEqual({ ...saved, rotate: false });
  });
  it.each([
    ['idle_seconds', ''], ['idle_seconds', '0'], ['idle_seconds', '86401'],
    ['rotation_degrees_per_second', '-0.1'], ['rotation_degrees_per_second', '6.01'],
    ['dim.brightness', '9'], ['dim.brightness', '101'], ['dim.brightness', ''],
    ['dim.start', '7:00'], ['dim.start', '24:00'], ['dim.end', '07:00:00'], ['dim.end', ' 07:00'],
  ])('blocks malformed %s = %j without silently replacing it', (name, value) => {
    const { card, editor, change, button } = setup(); change('enabled', true, 'change'); change(name, value);
    expect(button('save').disabled).toBe(true); editor.onClick('ambient-idle-save');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(editor.dirty).toBe(true);
  });
  it('allows zero rotation speed and explicit different quiet times, but rejects equal times', () => {
    const { card, change, button, click } = setup(); change('enabled', true, 'change'); change('rotation_degrees_per_second', '0');
    change('dim.start', '07:00'); expect(button('save').disabled).toBe(true);
    change('dim.end', '08:00'); expect(button('save').disabled).toBe(false); click('save');
    expect(card._layout.ambient_idle.rotation_degrees_per_second).toBe(0);
  });
  it.each([null, [], 'enabled'])('keeps malformed imported %j until deliberate defaults or Cancel', (saved) => {
    const { card, field, click } = setup({ config: { ambient_idle: saved } });
    expect(field('enabled').disabled).toBe(true); click('cancel'); expect(card._config.ambient_idle).toEqual(saved);
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); click('repair'); expect(field('enabled').disabled).toBe(false);
    click('save'); expect(card._layout.ambient_idle.enabled).toBe(false); expect(card._layout.ambient_idle.dim.brightness).toBe(0.65);
  });
  it('preserves malformed booleans, numbers and future settings during unrelated edits', () => {
    const saved = { enabled: 'true', rotate: 0, idle_seconds: '12', future: { value: 3 }, dim: { enabled: true, brightness: '0.6', when: 'moon', future: 'keep' } };
    const { card, editor, field, change, click, button } = setup({ layout: { ambient_idle: saved } });
    expect(field('enabled').indeterminate).toBe(true); expect(field('dim.when').value).toBe('');
    change('rotation_degrees_per_second', '1'); expect(editor.draft).toMatchObject(saved); expect(button('save').disabled).toBe(true);
    click('repair'); click('save'); expect(card._layout.ambient_idle.future).toEqual(saved.future); expect(card._layout.ambient_idle.dim.future).toBe('keep');
    expect(card._layout.ambient_idle.enabled).toBe(false); expect(saved.enabled).toBe('true');
  });
  it('does not overwrite a malformed dim object when another field is edited', () => {
    const { editor, change, button } = setup({ layout: { ambient_idle: { enabled: false, dim: ['retain'] } } });
    change('idle_seconds', '30'); change('dim.enabled', true, 'change');
    expect(editor.draft.dim).toEqual(['retain']); expect(button('save').disabled).toBe(true);
  });
  it.each(['settings', 'key', 'model', 'source', 'floor', 'user', 'role'])('retains a dirty choice and blocks Save after %s changes, including recovery', (kind) => {
    const { card, editor, host, change, field, button, click } = setup({ config: { model: '' }, layout: { model: { id: 'original' }, floors: [{ id: 'ground' }] } });
    change('idle_seconds', '37'); const control = field('idle_seconds'); control.focus(); const prior = { ...card._config };
    if (kind === 'settings') card._layout.ambient_idle = { enabled: true };
    if (kind === 'key') card._config.layout_key = 'other';
    if (kind === 'model') card._view.model = { root: {} };
    if (kind === 'source') card._layout.model = { id: 'replacement' };
    if (kind === 'floor') card._layout.floors = [{ id: 'first' }];
    if (kind === 'user') card._hass.user.id = 'another';
    if (kind === 'role') card._hass.user.is_admin = false;
    editor.updatePreviews(host); expect(field('idle_seconds')).toBe(control); expect(control.value).toBe('37');
    expect(button('save').disabled).toBe(true); expect(host.textContent).toContain('Your draft is kept');
    if (kind === 'role') card._hass.user.is_admin = true;
    if (kind === 'key') card._config = prior;
    editor.updatePreviews(host); editor.onClick('ambient-idle-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
    click('cancel'); expect(field('idle_seconds').disabled).toBe(false); expect(editor.dirty).toBe(false);
  });
  it('refreshes clean shared settings in place without losing native focus', () => {
    const { card, host, editor, field } = setup(); const input = field('idle_seconds'); input.focus();
    card._layout.ambient_idle = { enabled: true, idle_seconds: 42, dim: { when: 'quiet_hours' } }; editor.updatePreviews(host);
    expect(field('idle_seconds')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('42');
    expect(field('enabled').checked).toBe(true); expect(field('dim.when').value).toBe('quiet_hours'); expect(editor.dirty).toBe(false);
  });
  it('keeps a partial focused time and numeric draft across unrelated HA updates', () => {
    const { card, editor, host, change, field } = setup(); const input = change('dim.start', '22:'); input.focus();
    card._hass = { ...card._hass, states: { ...card._hass.states, 'sensor.other': { state: '3' } } }; editor.updatePreviews(host);
    expect(field('dim.start')).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('22:');
    expect(editor.draft.dim.start).toBe('22:'); expect(editor.stale).toBe(false); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it.each([false, undefined, 'true'])('rejects direct Save when administrator permission is %j', (admin) => {
    const { card, editor, change, host, button } = setup(); change('idle_seconds', '40'); card._hass.user.is_admin = admin;
    editor.updatePreviews(host); expect(button('save').disabled).toBe(true); editor.onClick('ambient-idle-save'); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
  it('Cancel/reset/dispose discard drafts and never start a presentation preview', () => {
    const { card, editor, change, click, field } = setup(); change('enabled', true, 'change'); click('cancel'); expect(field('enabled').checked).toBe(false);
    change('idle_seconds', '30'); editor.reset(); expect(editor.dirty).toBe(false); expect(editor.render()).toContain('value="120"');
    editor.dispose(); expect(editor.render()).toBe(''); expect(editor.onClick('ambient-idle-save')).toBe(false);
    expect(editor.onInput('ambient-idle-enabled', { checked: true })).toBe(false); expect(card.commitFeatureLayout).not.toHaveBeenCalled();
  });
});

describe('idle settings show actual source checks without applying them', () => {
  const dimmed = { enabled: true, dim: { enabled: true, brightness: 0.5, when: 'sun' } };
  it('uses only actual sun elevation; manual theme and sky cannot supply it', () => {
    const { card, host, editor } = setup({ layout: { ambient_idle: dimmed } });
    expect(host.textContent).toContain('Current sun elevation: -12°'); expect(host.textContent).toContain('picture brightness would be 50%');
    card._hass.states['sun.sun'] = sun(30); editor.updatePreviews(host); expect(host.textContent).toContain('no currently trusted dim condition');
    card._day = false; card._hass.themes = { darkMode: true }; delete card._hass.states['sun.sun']; editor.updatePreviews(host);
    expect(host.textContent).toContain('No usable current sun reading'); expect(host.textContent).toContain('no currently trusted dim condition');
    expect(card.commitFeatureLayout).not.toHaveBeenCalled(); expect(card._hass.callService).not.toHaveBeenCalled();
  });
  it.each([true, 'true', null, 0])('does not describe restored flag %j as current sun evidence', (restored) => {
    const { host } = setup({ layout: { ambient_idle: dimmed }, currentSun: sun(-12, { restored }) });
    expect(host.textContent).toContain('No usable current sun reading'); expect(host.textContent).not.toContain('picture brightness would be 50%');
  });
  it('checks quiet hours using HA time zone even without sun, latitude or longitude', () => {
    const { host } = setup({ currentSun: null, layout: { ambient_idle: { ...dimmed, dim: { ...dimmed.dim, when: 'quiet_hours' } } } });
    expect(host.textContent).toContain('Home Assistant time zone: Europe/London'); expect(host.textContent).toContain('Quiet hours are active');
    expect(host.textContent).toContain('picture brightness would be 50%'); expect(host.textContent).not.toContain('No usable current sun');
  });
  it.each([undefined, 'not/a-zone'])('does not guess a browser zone when HA time zone is %j', (zone) => {
    const { card, editor, host, change, button, click } = setup({ currentSun: null, layout: { ambient_idle: { ...dimmed, dim: { ...dimmed.dim, when: 'quiet_hours' } } } });
    card._hass.config.time_zone = zone; editor.updatePreviews(host); expect(host.textContent).toContain('no currently trusted dim condition');
    expect(host.textContent).toContain('Quiet-hours dimming needs'); change('idle_seconds', '300'); expect(button('save').disabled).toBe(false);
    click('save'); expect(card.commitFeatureLayout).toHaveBeenCalledOnce(); // Settings remain valid while evidence is temporarily unavailable.
  });
  it('labels independent quiet-hours evidence honestly while unavailable sun contributes no factor', () => {
    const { host } = setup({ currentSun: null, layout: { ambient_idle: { ...dimmed, dim: { ...dimmed.dim, when: 'sun_or_quiet_hours' } } } });
    expect(host.textContent).toContain('No usable current sun'); expect(host.textContent).toContain('Quiet hours are active');
    expect(host.textContent).toContain('picture brightness would be 50%'); expect(host.textContent).toContain('Wait for an actual current sun reading');
  });
  it('escapes imported text and uses theme-aware 44px controls without replacing focused nodes', () => {
    const { card, editor, host, field } = setup({ layout: { ambient_idle: dimmed } }); card._hass.config.time_zone = '<img src=x onerror=alert(1)>';
    editor.updatePreviews(host); expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('style').textContent).toContain('min-height:44px');
    expect(host.querySelector('style').textContent).toContain('--ha-card-background');
    const input = field('idle_seconds'); input.focus(); editor.updatePreviews(host); expect(document.activeElement).toBe(input);
  });
});
