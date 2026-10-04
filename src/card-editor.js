// Visual editor for the card options (Lovelace "Show visual editor"), built on HA's ha-form.
// Rooms, devices, mower and model are edited on the card itself (its Edit button).

const BUBBLE_CONTROLS = ['mode', 'reset', 'section', 'daynight', 'minimap', 'edit'];
const DEFAULTS = {
  layout_key: 'default', height: '520px', group_by: 'device', wall_height: 1.0, view: '3d', room_labels: 'size', zoom_to: 'center',
  occlusion: true, lights: 'auto', merge: true, sky_bodies: true,
  show_bubble_bar: true, bubble_bar_controls: BUBBLE_CONTROLS, mini_map: true, mini_map_size: 180,
  mini_map_position: 'top-right', device_tap_action: 'popup',
};

export const SCHEMA = [
  { name: 'height', selector: { text: {} } },
  {
    type: 'expandable', name: '', title: 'Navigation and device controls', schema: [
      { name: 'show_bubble_bar', selector: { boolean: {} } },
      { name: 'bubble_bar_controls', selector: { select: { multiple: true, mode: 'list', options: [
        { value: 'mode', label: '3D / top view' }, { value: 'reset', label: 'Reset view' },
        { value: 'section', label: 'Cut-away section' }, { value: 'daynight', label: 'Day / night' },
        { value: 'minimap', label: 'Mini-map' }, { value: 'edit', label: 'Edit layout (admins)' },
      ] } } },
      { name: 'mini_map', selector: { boolean: {} } },
      { name: 'mini_map_size', selector: { number: { min: 120, max: 260, step: 10, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'mini_map_position', selector: { select: { mode: 'dropdown', options: [
        { value: 'top-right', label: 'Top right' }, { value: 'top-left', label: 'Top left' },
      ] } } },
      { name: 'device_tap_action', selector: { select: { mode: 'dropdown', options: [
        { value: 'popup', label: 'Open device controls' }, { value: 'toggle', label: 'Quick toggle' },
      ] } } },
    ],
  },
  {
    type: 'grid', name: '', schema: [
      { name: 'view', selector: { select: { mode: 'dropdown', options: [{ value: '3d', label: '3D' }, { value: 'top', label: 'Top (north up)' }] } } },
      { name: 'floor', selector: { floor: {} } },
      { name: 'wall_height', selector: { number: { min: 0.2, max: 3, step: 0.05, mode: 'box', unit_of_measurement: 'm' } } },
      { name: 'group_by', selector: { select: { mode: 'dropdown', options: [{ value: 'device', label: 'One marker per device' }, { value: 'entity', label: 'One marker per entity' }] } } },
      { name: 'zoom_to', selector: { select: { mode: 'dropdown', options: [{ value: 'center', label: 'Centre of the view' }, { value: 'cursor', label: 'Mouse cursor' }] } } },
      { name: 'lights', selector: { select: { mode: 'dropdown', options: [{ value: 'auto', label: 'Real lights' }, { value: 'off', label: 'Glow only (weak devices)' }] } } },
      { name: 'room_labels', selector: { select: { mode: 'dropdown', options: [{ value: 'size', label: 'Name and size' }, { value: 'name', label: 'Name only' }, { value: 'none', label: 'None' }] } } },
    ],
  },
  { name: 'occlusion', selector: { boolean: {} } },
  { name: 'merge', selector: { boolean: {} } },
  { name: 'sky_bodies', selector: { boolean: {} } },
  { name: 'layout_key', selector: { text: {} } },
  {
    type: 'expandable', name: '', title: 'Model from a URL (instead of uploading in the card)', schema: [
      { name: 'model', selector: { text: {} } },
      {
        type: 'grid', name: '', schema: [
          { name: 'model_rotation', selector: { number: { min: -180, max: 180, step: 0.5, mode: 'box', unit_of_measurement: '°' } } },
          { name: 'model_scale', selector: { number: { min: 0.0001, step: 0.0001, mode: 'box' } } },
          { name: 'model_opacity', selector: { number: { min: 0.1, max: 1, step: 0.05, mode: 'slider' } } },
        ],
      },
    ],
  },
];

const LABELS = {
  height: 'Card height',
  view: 'Start view',
  floor: 'Start floor',
  wall_height: 'Cut-away wall height',
  occlusion: 'Dim markers behind walls',
  merge: 'Merge model parts (faster)',
  sky_bodies: 'Sun and moon in the sky',
  group_by: 'Markers',
  room_labels: 'Room labels',
  zoom_to: 'Zoom towards',
  lights: 'Model lamps',
  layout_key: 'Layout name',
  model: 'Model URL (.glb)',
  model_rotation: 'Model rotation',
  model_scale: 'Model scale',
  model_opacity: 'Model opacity',
  show_bubble_bar: 'Show bottom bubble bar',
  bubble_bar_controls: 'Buttons on the bubble bar',
  mini_map: 'Show 2D mini-map',
  mini_map_size: 'Mini-map size',
  mini_map_position: 'Mini-map corner',
  device_tap_action: 'When you tap a device',
};

const HELPERS = {
  height: 'CSS height, e.g. 520px or 60vh',
  wall_height: 'Drawn walls only; a model is cut at the top of the storey',
  occlusion: 'With a 3D model: markers hidden by a wall from the current angle are shown faint',
  merge: 'With a 3D model: static parts of a room / layer with the same material are drawn as one (fewer draw calls). Turn off to keep every part separate.',
  sky_bodies: 'With a 3D model: show the sun and the moon (position and phase from your Home Assistant location)',
  floor: 'Empty: the first floor that has rooms',
  zoom_to: 'Centre: zoom and rotate around the view\'s rotation centre (Edit → Views)',
  lights: 'With a 3D model: lamps light the house (auto) or only glow (off)',
  layout_key: 'Cards with the same name share one plan. Letters, digits, - and _.',
  model: 'e.g. /local/house.glb. Leave empty to upload a model on the card (Edit → Model).',
  show_bubble_bar: 'Keep views and common controls together at the bottom of the card.',
  bubble_bar_controls: 'Choose the buttons to show, then use Button order below to arrange them. Your saved views also appear on the bar. Controls appear when available for the current model and your user permissions.',
  mini_map: 'A small north-up plan helps you see which room or floor you are looking at.',
  mini_map_size: 'Width in pixels, from 120 to 260.',
  mini_map_position: 'Place the mini-map in the top right or top left of the 3D view.',
  device_tap_action: 'Open device controls shows a popup first. All controls opens Home Assistant’s own options for that entity. Quick toggle changes supported devices with one tap; hold opens their controls.',
};

// Drop empty values and defaults so the YAML stays short.
export function cleanConfig(config) {
  const out = {};
  for (const [k, value] of Object.entries(config)) {
    let v = value;
    if (v === undefined || v === null || v === '') continue;
    if (k === 'mini_map_size') {
      const size = Number(v);
      v = Number.isFinite(size) ? Math.round(Math.min(260, Math.max(120, size))) : DEFAULTS.mini_map_size;
    }
    if (k === 'mini_map_position' && !['top-right', 'top-left'].includes(v)) v = DEFAULTS.mini_map_position;
    if (k === 'device_tap_action' && !['popup', 'toggle'].includes(v)) v = DEFAULTS.device_tap_action;
    if (['show_bubble_bar', 'mini_map'].includes(k) && typeof v !== 'boolean') v = DEFAULTS[k];
    if (k === 'bubble_bar_controls') {
      v = Array.isArray(v) ? [...new Set(v.filter((id) => BUBBLE_CONTROLS.includes(id)))] : BUBBLE_CONTROLS;
      if (v.length === BUBBLE_CONTROLS.length && v.every((id, i) => id === BUBBLE_CONTROLS[i])) continue;
    }
    if (k !== 'type' && DEFAULTS[k] === v) continue;
    out[k] = v;
  }
  return out;
}

export class Taylors3dCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._render();
  }

  _updateConfig(changes) {
    const config = cleanConfig({ ...this._config, ...changes, type: this._config.type });
    this._config = config;
    this._render();
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  _moveBubbleControl(id, direction) {
    const controls = [...(cleanConfig(this._config).bubble_bar_controls || BUBBLE_CONTROLS)];
    const index = controls.indexOf(id), next = index + direction;
    if (index < 0 || next < 0 || next >= controls.length) return;
    [controls[index], controls[next]] = [controls[next], controls[index]];
    this._updateConfig({ bubble_bar_controls: controls });
    // Rebuilding the list removes the clicked button. Keep keyboard focus on its control.
    const row = this._controlOrder.querySelector(`[data-control="${id}"]`);
    const button = row.querySelector(direction < 0 ? '.up' : '.down');
    (button.disabled ? row.querySelector('button:not(:disabled)') : button)?.focus();
  }

  _renderControlOrder(data) {
    const key = JSON.stringify([data.show_bubble_bar, data.bubble_bar_controls]);
    // HA refreshes hass frequently. Keep the same buttons and keyboard focus until the order changes.
    if (key === this._controlOrderKey) return;
    this._controlOrder.hidden = !data.show_bubble_bar;
    const title = document.createElement('h3');
    title.textContent = 'Button order';
    title.style.cssText = 'margin: 0 0 8px; font-size: 15px; font-weight: 500;';
    const hint = document.createElement('p');
    hint.textContent = data.bubble_bar_controls.length ? 'Use Up and Down to arrange the buttons on your bottom bar.' : 'Select buttons under Navigation and device controls to arrange them here.';
    hint.style.cssText = 'margin: 0 0 8px; color: var(--secondary-text-color); font-size: 13px;';
    const list = document.createElement('ol');
    list.setAttribute('role', 'list');
    list.style.cssText = 'list-style: none; margin: 0; padding: 0;';
    const labels = new Map(SCHEMA.flatMap((field) => field.schema || [field])
      .find((field) => field.name === 'bubble_bar_controls').selector.select.options.map((option) => [option.value, option.label]));
    data.bubble_bar_controls.forEach((id, index, controls) => {
      const row = document.createElement('li');
      row.dataset.control = id;
      row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin: 4px 0;';
      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${labels.get(id)}`;
      label.style.cssText = 'flex: 1; min-width: 0;';
      row.append(label);
      for (const [direction, text, delta] of [['up', 'Up', -1], ['down', 'Down', 1]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = direction;
        button.textContent = text;
        button.setAttribute('aria-label', `Move ${labels.get(id)} ${direction}`);
        button.disabled = direction === 'up' ? index === 0 : index === controls.length - 1;
        button.style.cssText = `min-width: 58px; min-height: 44px; padding: 8px; border-radius: 8px; font: inherit; color: var(--primary-text-color); background: var(--secondary-background-color, var(--card-background-color)); border: 1px solid var(--divider-color); cursor: ${button.disabled ? 'default' : 'pointer'}; opacity: ${button.disabled ? 0.4 : 1};`;
        button.addEventListener('click', () => this._moveBubbleControl(id, delta));
        row.append(button);
      }
      list.append(row);
    });
    this._controlOrder.replaceChildren(title, hint, list);
    this._controlOrderKey = key;
  }

  _render() {
    if (!customElements.get('ha-form')) {
      this.textContent = 'Edit this card in YAML (the visual editor needs a newer Home Assistant).';
      return;
    }
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.computeLabel = (s) => LABELS[s.name] || s.name;
      this._form.computeHelper = (s) => HELPERS[s.name] || '';
      this._form.addEventListener('value-changed', (e) => {
        e.stopPropagation();
        this._updateConfig(e.detail.value);
      });
      this._controlOrder = document.createElement('section');
      this._controlOrder.className = 'bubble-control-order';
      this._controlOrder.setAttribute('aria-label', 'Bubble bar button order');
      this._controlOrder.style.cssText = 'margin: 20px 0 0; color: var(--primary-text-color);';
      const hint = document.createElement('p');
      hint.style.cssText = 'margin: 16px 0 0; color: var(--secondary-text-color); font-size: 13px;';
      hint.textContent = 'Rooms, devices, the mower and the 3D model are set up on the card itself: save, then use its Edit button.';
      this.append(this._form, this._controlOrder, hint);
    }
    this._form.hass = this._hass;
    this._form.schema = SCHEMA;
    const data = { ...DEFAULTS, ...cleanConfig(this._config) };
    this._form.data = { ...data, bubble_bar_controls: [...data.bubble_bar_controls] };
    this._renderControlOrder(data);
  }
}

if (!customElements.get('taylors3d-card-editor')) customElements.define('taylors3d-card-editor', Taylors3dCardEditor);
