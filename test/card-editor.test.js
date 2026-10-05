// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';

// stand-in for HA's ha-form
class FakeForm extends HTMLElement {}

describe('card editor', () => {
  let mod;
  beforeAll(async () => {
    customElements.define('ha-form', FakeForm);
    mod = await import('../src/card-editor.js');
  });

  it('drops empty values and defaults', () => {
    expect(mod.cleanConfig({ type: 'custom:taylors3d-card', height: '520px', view: 'top', model: '', floor: undefined, wall_height: 1.2 }))
      .toEqual({ type: 'custom:taylors3d-card', view: 'top', wall_height: 1.2 });
  });

  it('offers room_labels name / size / none (size is the default)', () => {
    const field = mod.SCHEMA.flatMap((x) => x.schema || [x]).find((x) => x.name === 'room_labels');
    expect(field.selector.select.options.map((o) => o.value).sort()).toEqual(['name', 'none', 'size']);
    expect(mod.cleanConfig({ room_labels: 'size' })).toEqual({});
    expect(mod.cleanConfig({ room_labels: 'none' })).toEqual({ room_labels: 'none' });
  });

  it('offers zoom_to center / cursor (center is the default)', () => {
    const field = mod.SCHEMA.flatMap((x) => x.schema || [x]).find((x) => x.name === 'zoom_to');
    expect(field.selector.select.options.map((o) => o.value)).toEqual(['center', 'cursor']);
    expect(mod.cleanConfig({ zoom_to: 'center' })).toEqual({});
    expect(mod.cleanConfig({ zoom_to: 'cursor' })).toEqual({ zoom_to: 'cursor' });
  });

  it('edits the initial named view through the native card form without changing its camera or other overrides', () => {
    const el = document.createElement('taylors3d-card-editor');
    const config = { type: 'custom:taylors3d-card', view_id: 'front-door',
      views: { 'front-door': { label: 'Front door', camera: { position: [1, 2, 3], target: [0, 0, 0] }, extra: true } } };
    el.setConfig(config);
    const form = el.querySelector('ha-form');
    const field = mod.SCHEMA.flatMap((item) => item.schema || [item]).find((item) => item.name === 'view_id');
    expect(field?.selector).toEqual({ text: {} });
    expect(form.data.view_id).toBe('front-door');
    expect(form.computeHelper({ name: 'view_id' })).toContain('Edit → Views');
    let got;
    el.addEventListener('config-changed', (event) => { got = event.detail.config; });
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, view_id: 'garden' } } }));
    expect(got).toEqual({ ...config, view_id: 'garden' });
    expect(config.view_id).toBe('front-door');
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, view_id: '' } } }));
    expect(got.view_id).toBeUndefined();
    expect(got.views).toEqual(config.views);
  });

  it('allows a fully transparent URL model while preserving a large authored placement', () => {
    const fields = mod.SCHEMA.flatMap((item) => item.schema || [item]).flatMap((item) => item.schema || [item]);
    expect(fields.find((item) => item.name === 'model_opacity').selector.number.min).toBe(0);
    const el = document.createElement('taylors3d-card-editor');
    el.setConfig({ type: 'custom:taylors3d-card', model: '/local/house.glb', model_position: [120.25, 18, -75.5] });
    const form = el.querySelector('ha-form');
    let got;
    el.addEventListener('config-changed', (event) => { got = event.detail.config; });
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, model_opacity: 0 } } }));
    expect(got.model_opacity).toBe(0);
    expect(got.model_position).toEqual([120.25, 18, -75.5]);
  });

  it('labels URL model placement as east/north/up and saves that exact axis order', () => {
    const el = document.createElement('taylors3d-card-editor');
    el.setConfig({ type: 'custom:taylors3d-card', model: '/local/house.glb', model_position: [1, 2, 3] });
    const form = el.querySelector('ha-form');
    expect(['x', 'y', 'z'].map((axis) => form.computeLabel({ name: `model_position_${axis}` })))
      .toEqual(['Model east position', 'Model north position', 'Model up position']);
    let got;
    el.addEventListener('config-changed', (event) => { got = event.detail.config; });
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: {
      ...form.data, model_position_x: 10, model_position_y: 20, model_position_z: 30,
    } } }));
    expect(got.model_position).toEqual([10, 20, 30]);
  });

  it('offers lights auto / off (auto is the default)', () => {
    const field = mod.SCHEMA.flatMap((x) => x.schema || [x]).find((x) => x.name === 'lights');
    expect(field.selector.select.options.map((o) => o.value)).toEqual(['auto', 'off']);
    expect(mod.cleanConfig({ lights: 'auto' })).toEqual({});
    expect(mod.cleanConfig({ lights: 'off' })).toEqual({ lights: 'off' });
  });

  it('offers merge as a boolean (true is the default)', () => {
    const field = mod.SCHEMA.flatMap((x) => x.schema || [x]).find((x) => x.name === 'merge');
    expect(field.selector).toEqual({ boolean: {} });
    expect(mod.cleanConfig({ merge: true })).toEqual({});
    expect(mod.cleanConfig({ merge: false })).toEqual({ merge: false });
  });

  it('offers the right-hand panel and converts visual model positions into the existing format', () => {
    const fields = mod.SCHEMA.flatMap((field) => field.schema || [field]);
    const panel = fields.find((field) => field.name === 'control_panel');
    expect(panel.selector.select.options.map((option) => option.value)).toEqual(['right', 'popup']);
    expect(mod.cleanConfig({ control_panel: 'right' })).toEqual({});
    expect(mod.cleanConfig({ control_panel: 'popup', automation_panel: 'kitchen-wall', model: '/local/home.glb',
      model_position_x: '1.25', model_position_y: 2, model_position_z: -3 }))
      .toEqual({ control_panel: 'popup', automation_panel: 'kitchen-wall', model: '/local/home.glb', model_position: [1.25, 2, -3] });
    expect(mod.cleanConfig({ model_position_x: 0, model_position_y: 0, model_position_z: 0 })).toEqual({});
  });

  it('renders ha-form with defaults and emits cleaned config', () => {
    const el = document.createElement('taylors3d-card-editor');
    document.body.append(el);
    el.setConfig({ type: 'custom:taylors3d-card', view: 'top' });
    el.hass = { states: {} };
    const form = el.querySelector('ha-form');
    expect(form.data).toMatchObject({ view: 'top', height: '520px', layout_key: 'default' });
    expect(form.schema).toBe(mod.SCHEMA);
    expect(form.hass).toEqual({ states: {} });
    expect(form.computeLabel({ name: 'wall_height' })).toBe('Cut-away wall height');

    let got;
    el.addEventListener('config-changed', (e) => { got = e.detail.config; });
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, height: '600px', view: '3d' } } }));
    expect(got).toEqual({ type: 'custom:taylors3d-card', height: '600px' });
  });

  it('lets a visual edit hide navigation and preserves unrelated YAML options', () => {
    const el = document.createElement('taylors3d-card-editor');
    el.setConfig({
      type: 'custom:taylors3d-card', model: '/local/home.glb',
      views: { garden: { label: 'Garden', hidden: false } }, custom_future_option: 'keep me',
    });
    const form = el.querySelector('ha-form');
    expect(form.data).toMatchObject({ show_bubble_bar: true, mini_map: true, mini_map_size: 180, mini_map_position: 'top-right', device_tap_action: 'popup' });
    expect(form.data.bubble_bar_controls).toEqual(['mode', 'reset', 'section', 'daynight', 'minimap', 'edit']);

    let got, event;
    el.addEventListener('config-changed', (e) => { got = e.detail.config; event = e; });
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: {
      ...form.data, show_bubble_bar: false, mini_map: false, mini_map_position: 'top-left',
      mini_map_size: 220, device_tap_action: 'toggle', bubble_bar_controls: ['edit', 'reset'],
    } } }));
    expect(got).toEqual({
      type: 'custom:taylors3d-card', model: '/local/home.glb',
      views: { garden: { label: 'Garden', hidden: false } }, custom_future_option: 'keep me',
      show_bubble_bar: false, mini_map: false, mini_map_position: 'top-left',
      mini_map_size: 220, device_tap_action: 'toggle', bubble_bar_controls: ['edit', 'reset'],
    });
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(form.computeHelper({ name: 'device_tap_action' })).toContain('All controls opens Home Assistant');
  });

  it('clamps mini-map size before emitting it and updates the displayed field', () => {
    const el = document.createElement('taylors3d-card-editor');
    el.setConfig({ type: 'custom:taylors3d-card' });
    const form = el.querySelector('ha-form');
    let got;
    el.addEventListener('config-changed', (e) => { got = e.detail.config; });
    for (const [input, expected] of [[30, 120], [500, 260], ['215', 215]]) {
      form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, mini_map_size: input } } }));
      expect(got.mini_map_size).toBe(expected);
      expect(form.data.mini_map_size).toBe(expected);
    }
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, mini_map_size: 'broken' } } }));
    expect(got).toEqual({ type: 'custom:taylors3d-card' });
    expect(form.data.mini_map_size).toBe(180);
  });

  it('filters unsupported bubble controls without changing their order or the caller’s array', () => {
    const controls = ['edit', 'unexpected', 'reset', 'edit'];
    expect(mod.cleanConfig({ bubble_bar_controls: controls })).toEqual({ bubble_bar_controls: ['edit', 'reset'] });
    expect(controls).toEqual(['edit', 'unexpected', 'reset', 'edit']);
    expect(mod.cleanConfig({ bubble_bar_controls: [] })).toEqual({ bubble_bar_controls: [] });
    expect(mod.cleanConfig({ bubble_bar_controls: ['mode', 'reset', 'section', 'daynight', 'minimap', 'edit'] })).toEqual({});
    expect(mod.cleanConfig({ mini_map_position: 'bottom', device_tap_action: 'delete', mini_map: 'false' })).toEqual({});
  });

  it('moves selected buttons through the visual editor and keeps other card options', () => {
    const el = document.createElement('taylors3d-card-editor');
    document.body.append(el);
    const original = {
      type: 'custom:taylors3d-card', model: '/local/home.glb', mini_map_size: 220,
      views: { front: { label: 'Front door' } }, bubble_bar_controls: ['minimap', 'reset', 'edit'],
    };
    el.setConfig(original);
    const order = () => [...el.querySelectorAll('.bubble-control-order li')].map((row) => row.dataset.control);
    const button = (id, direction) => el.querySelector(`[data-control="${id}"] .${direction}`);
    expect(order()).toEqual(['minimap', 'reset', 'edit']);
    expect(button('minimap', 'up').disabled).toBe(true);
    expect(button('edit', 'down').disabled).toBe(true);

    const changes = [];
    el.addEventListener('config-changed', (e) => changes.push(e.detail.config));
    button('minimap', 'up').click();
    button('edit', 'down').click();
    expect(changes).toHaveLength(0);
    button('edit', 'up').click();
    expect(changes).toEqual([{ ...original, bubble_bar_controls: ['minimap', 'edit', 'reset'] }]);
    expect(order()).toEqual(['minimap', 'edit', 'reset']);
    expect(document.activeElement).toBe(button('edit', 'up'));
    expect(el.querySelector('ha-form').data.bubble_bar_controls).toEqual(['minimap', 'edit', 'reset']);
    expect(button('minimap', 'up').disabled).toBe(true);
    expect(button('reset', 'down').disabled).toBe(true);
    expect(button('edit', 'up').getAttribute('aria-label')).toBe('Move Edit layout (admins) up');
    expect(button('edit', 'up').style.minHeight).toBe('44px');
    expect(original.bubble_bar_controls).toEqual(['minimap', 'reset', 'edit']);
  });

  it('omits the default order again when a visual move is reversed', () => {
    const el = document.createElement('taylors3d-card-editor');
    el.setConfig({ type: 'custom:taylors3d-card', height: '600px' });
    let got;
    el.addEventListener('config-changed', (e) => { got = e.detail.config; });
    el.querySelector('[data-control="mode"] .down').click();
    expect(got.bubble_bar_controls).toEqual(['reset', 'mode', 'section', 'daynight', 'minimap', 'edit']);
    el.querySelector('[data-control="mode"] .up').click();
    expect(got).toEqual({ type: 'custom:taylors3d-card', height: '600px' });
    expect(el.querySelector('ha-form').data.bubble_bar_controls).toEqual(['mode', 'reset', 'section', 'daynight', 'minimap', 'edit']);
  });

  it('rebuilds the order after selection changes and hides it when the bar is off', () => {
    const el = document.createElement('taylors3d-card-editor');
    el.setConfig({ type: 'custom:taylors3d-card', bubble_bar_controls: ['reset', 'minimap'] });
    const form = el.querySelector('ha-form');
    const section = el.querySelector('.bubble-control-order');
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, bubble_bar_controls: ['edit'] } } }));
    el.hass = { states: {} };
    expect(section.querySelectorAll('li')).toHaveLength(1);
    expect(section.querySelector('li').dataset.control).toBe('edit');
    expect([...section.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, show_bubble_bar: false } } }));
    expect(section.hidden).toBe(true);
    el.setConfig({ type: 'custom:taylors3d-card', bubble_bar_controls: [] });
    expect(section.hidden).toBe(false);
    expect(section.querySelectorAll('li')).toHaveLength(0);
    expect(section.textContent).toContain('Select buttons');
  });

  it('keeps ordering button identity and keyboard focus during live Home Assistant updates', () => {
    const el = document.createElement('taylors3d-card-editor');
    document.body.append(el);
    el.setConfig({ type: 'custom:taylors3d-card', bubble_bar_controls: ['reset', 'minimap'] });
    const button = el.querySelector('[data-control="minimap"] .up');
    button.focus();
    el.hass = { states: { 'light.lounge': { state: 'on' } } };
    expect(el.querySelector('[data-control="minimap"] .up')).toBe(button);
    expect(document.activeElement).toBe(button);
    el.setConfig({ type: 'custom:taylors3d-card', height: '600px', bubble_bar_controls: ['reset', 'minimap'] });
    expect(el.querySelector('[data-control="minimap"] .up')).toBe(button);
    expect(document.activeElement).toBe(button);
  });
});
