// Visual editor for the card options (Lovelace "Show visual editor"), built on HA's ha-form.
// Rooms, devices, mower and model are edited on the card itself (its Edit button).
import { ImportedSourceControls } from './imported-source-controls.js';
import { localize, localeInfo } from './localization.js';
import { TAYLORS3D_THEME_PALETTES } from './taylors3d-theme.js';
import { HouseNavigationEditor } from './house-navigation-editor.js';

// This editor deliberately retains its light DOM/native HA form boundary. Every
// selector is scoped to our element; colours do not change the HA dialog or dashboard.
const paletteDeclarations = (palette) => ['background', 'surface', 'raised', 'text', 'muted', 'divider']
  .map((key) => `--taylors3d-editor-${key}:${palette[key]};`).join('\n');
const EDITOR_STYLE = `
taylors3d-card-editor {
  --taylors3d-editor-background:var(--primary-background-color,#f4f4f5);
  --taylors3d-editor-surface:var(--ha-card-background,var(--card-background-color,#fff));
  --taylors3d-editor-raised:var(--secondary-background-color,#ededee);
  --taylors3d-editor-text:var(--primary-text-color,#171719);
  --taylors3d-editor-muted:var(--secondary-text-color,#58585e);
  --taylors3d-editor-divider:var(--divider-color,#d3d3d6);
  display:block; box-sizing:border-box; padding:20px; border-radius:24px;
  background:var(--taylors3d-editor-background); color:var(--taylors3d-editor-text);
  font:400 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
taylors3d-card-editor[data-taylors3d-editor-scheme="dark"] {
  ${paletteDeclarations(TAYLORS3D_THEME_PALETTES.dark)}
  color-scheme:dark;
}
taylors3d-card-editor[data-taylors3d-editor-scheme="light"] {
  ${paletteDeclarations(TAYLORS3D_THEME_PALETTES.light)}
  color-scheme:light;
}
taylors3d-card-editor:is([data-taylors3d-editor-scheme="dark"],[data-taylors3d-editor-scheme="light"]) {
  --primary-text-color:var(--taylors3d-editor-text);
  --secondary-text-color:var(--taylors3d-editor-muted);
  --primary-color:var(--taylors3d-editor-text);
  --text-primary-color:var(--taylors3d-editor-background);
  --card-background-color:var(--taylors3d-editor-surface);
  --ha-card-background:var(--taylors3d-editor-surface);
  --secondary-background-color:var(--taylors3d-editor-raised);
  --divider-color:var(--taylors3d-editor-divider);
  --mdc-theme-primary:var(--taylors3d-editor-text);
  --mdc-theme-on-primary:var(--taylors3d-editor-background);
  --mdc-theme-surface:var(--taylors3d-editor-surface);
  --mdc-theme-on-surface:var(--taylors3d-editor-text);
  --mdc-text-field-fill-color:var(--taylors3d-editor-raised);
  --mdc-text-field-ink-color:var(--taylors3d-editor-text);
  --mdc-text-field-label-ink-color:var(--taylors3d-editor-muted);
}
taylors3d-card-editor ha-form { display:block; font:inherit; }
taylors3d-card-editor :is(.bubble-control-order,.imported-source-controls,.house-navigation-order) {
  box-sizing:border-box; padding:16px; border:1px solid var(--taylors3d-editor-divider);
  border-radius:20px; background:var(--taylors3d-editor-surface);
}
taylors3d-card-editor :is(.bubble-control-order,.imported-source-controls,.house-navigation-order) h3 {
  color:var(--taylors3d-editor-text); font-size:15px; font-weight:600;
}
taylors3d-card-editor :is(.bubble-control-order,.imported-source-controls,.house-navigation-order) :is(p,span,summary) {
  overflow-wrap:anywhere;
}
taylors3d-card-editor :is(.bubble-control-order,.imported-source-controls,.house-navigation-order) button {
  box-sizing:border-box; min-height:44px; min-width:44px; max-width:100%;
  border:1px solid var(--taylors3d-editor-text); border-radius:14px;
  padding:10px 14px; font:inherit; font-size:13px; font-weight:600; line-height:1.35;
  color:var(--taylors3d-editor-background); background:var(--taylors3d-editor-text);
  white-space:normal; overflow-wrap:anywhere; cursor:pointer;
}
taylors3d-card-editor :is(.bubble-control-order,.imported-source-controls,.house-navigation-order) button:disabled {
  opacity:1; color:var(--taylors3d-editor-muted); background:var(--taylors3d-editor-raised);
  border-color:var(--taylors3d-editor-divider); border-style:dashed; cursor:default;
}
taylors3d-card-editor :is(button,summary):focus-visible {
  outline:3px solid var(--taylors3d-editor-text); outline-offset:3px;
}
taylors3d-card-editor .imported-source-controls pre {
  padding:12px; border-radius:12px; color:var(--taylors3d-editor-text);
  background:var(--taylors3d-editor-raised); border:1px solid var(--taylors3d-editor-divider);
}
taylors3d-card-editor .house-nav-options{list-style:none;margin:12px 0;padding:0}
taylors3d-card-editor .house-nav-options li{display:grid;grid-template-columns:minmax(0,1fr) auto 44px 44px;gap:6px;align-items:center;margin:6px 0}
taylors3d-card-editor .house-nav-options button{padding:8px;min-width:44px}
taylors3d-card-editor .house-navigation-order[hidden]{display:none}
taylors3d-card-editor .house-navigation-order p{color:var(--taylors3d-editor-muted);font-size:13px}
@media (max-width:480px) {
  taylors3d-card-editor { padding:12px; }
  taylors3d-card-editor :is(.bubble-control-order,.imported-source-controls) { padding:12px; }
}
@media (forced-colors:active) {
  taylors3d-card-editor :is(button,summary):focus-visible { outline-color:Highlight; }
  taylors3d-card-editor :is(.bubble-control-order,.imported-source-controls) button {
    color:ButtonText; background:ButtonFace; border-color:ButtonText;
  }
  taylors3d-card-editor :is(.bubble-control-order,.imported-source-controls) button:disabled { color:GrayText; }
}
`;

const BUBBLE_CONTROLS = ['mode', 'reset', 'section', 'daynight', 'minimap', 'edit'];
const DEFAULTS = {
  layout_key: 'default', height: '520px', group_by: 'device', wall_height: 1.0, view: '3d', room_labels: 'size', zoom_to: 'center',
  occlusion: true, lights: 'auto', merge: true, sky_bodies: true,
  show_bubble_bar: true, bubble_bar_controls: BUBBLE_CONTROLS, mini_map: true, mini_map_size: 180,
  mini_map_position: 'top-right', device_tap_action: 'popup', control_panel: 'right',
  layout_style: 'original', house_colour_scheme: 'ha', marker_display: 'all',
};

export const SCHEMA = [
  { name: 'height', selector: { text: {} } },
  {
    type: 'expandable', name: '', title: 'Appearance', schema: [
      { name: 'layout_style', selector: { select: { mode: 'dropdown', options: [
        { value: 'original', label: 'Standard card' }, { value: 'house', label: 'House with navigation and room panels' },
      ] } } },
      { name: 'house_colour_scheme', selector: { select: { mode: 'dropdown', options: [
        { value: 'ha', label: 'Home Assistant colours' }, { value: 'dark', label: 'Dark glass' }, { value: 'light', label: 'Light glass' },
      ] } } },
      { name: 'marker_display', selector: { select: { mode: 'dropdown', options: [
        { value: 'rooms', label: 'Rooms' }, { value: 'important', label: 'Important activity' }, { value: 'all', label: 'All devices' },
      ] } } },
    ],
  },
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
      { name: 'control_panel', selector: { select: { mode: 'dropdown', options: [
        { value: 'right', label: 'Overlay panel' }, { value: 'popup', label: 'Popup beside the device' },
      ] } } },
    ],
  },
  {
    type: 'grid', name: '', schema: [
      { name: 'view', selector: { select: { mode: 'dropdown', options: [{ value: '3d', label: '3D' }, { value: 'top', label: 'Top (north up)' }] } } },
      { name: 'view_id', selector: { text: {} } },
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
    type: 'expandable', name: '', title: 'Automation target', schema: [
      { name: 'automation_panel', selector: { text: {} } },
      { name: 'automation_card_id', selector: { text: {} } },
    ],
  },
  {
    type: 'expandable', name: '', title: 'Model from a URL (instead of uploading in the card)', schema: [
      { name: 'model', selector: { text: {} } },
      {
        type: 'grid', name: '', schema: [
          { name: 'model_position_x', selector: { number: { step: 0.01, mode: 'box', unit_of_measurement: 'm' } } },
          { name: 'model_position_y', selector: { number: { step: 0.01, mode: 'box', unit_of_measurement: 'm' } } },
          { name: 'model_position_z', selector: { number: { step: 0.01, mode: 'box', unit_of_measurement: 'm' } } },
          { name: 'model_rotation', selector: { number: { min: -180, max: 180, step: 0.5, mode: 'box', unit_of_measurement: '°' } } },
          { name: 'model_scale', selector: { number: { min: 0.0001, step: 0.0001, mode: 'box' } } },
          { name: 'model_opacity', selector: { number: { min: 0, max: 1, step: 0.05, mode: 'slider' } } },
        ],
      },
    ],
  },
];

const TITLE_KEYS = new Map([
  ['Appearance', 'house'], ['Navigation and device controls', 'navigation'],
  ['Automation target', 'automation'], ['Model from a URL (instead of uploading in the card)', 'model'],
]);
const translatedSchemas = new Map();
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };

// Reuse one schema for each bundled language. Ordinary hass reading updates
// do not allocate new schema/select options or replace native form controls.
function schemaFor(hass) {
  const language = localeInfo(hass).resolved;
  if (language === 'en') return SCHEMA;
  if (!translatedSchemas.has(language)) {
    const translate = (fields) => fields.map((field) => {
      const out = { ...field };
      if (TITLE_KEYS.has(field.title)) out.title = localize(hass, `settings.title.${TITLE_KEYS.get(field.title)}`, {}, field.title);
      if (field.schema) out.schema = translate(field.schema);
      if (field.selector?.select) out.selector = { ...field.selector, select: { ...field.selector.select,
        options: field.selector.select.options.map((option) => ({ ...option,
          label: localize(hass, `settings.option.${field.name}.${option.value}`, {}, option.label) })) } };
      return out;
    });
    translatedSchemas.set(language, translate(SCHEMA));
  }
  return translatedSchemas.get(language);
}

const LABELS = {
  height: 'Card height',
  layout_style: 'Card layout',
  house_colour_scheme: 'Card colours',
  marker_display: 'Show on house',
  view: 'Start view',
  view_id: 'Starting named view (exact ID)',
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
  control_panel: 'Room and device controls',
  automation_panel: 'Panel name',
  automation_card_id: 'Card name (optional)',
  model_position_x: 'Model east position',
  model_position_y: 'Model north position',
  model_position_z: 'Model up position',
};

const HELPERS = {
  height: 'CSS height, e.g. 520px or 60vh',
  view_id: 'Use the exact view ID shown in Edit → Views, such as front-door or garden. Leave empty to use the start floor or the first available view. This chooses the opening view; its saved camera is edited under Views. Press Save in Home Assistant’s card editor to apply card settings.',
  layout_style: 'House adds a header and navigation. Room controls float over the house; phones use a bottom sheet. Opening controls keeps the house size unchanged. Existing cards keep their standard layout until you choose House.',
  house_colour_scheme: 'Dark glass and Light glass apply to both layouts. Home Assistant colours follow your dashboard theme. Only this card and its settings change. Choose weather, people and alarm sources in Edit → Appearance → House.',
  marker_display: 'Rooms shows a room summary; choose a room for its devices. Important keeps active devices and alerts. All devices shows every visible device.',
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
  control_panel: 'Controls overlay the house. Opening a panel keeps the drawing size and camera unchanged; scroll inside it for more controls.',
  automation_panel: "A name such as kitchen-wall. Use the same panel name in the Taylor's 3D Select camera preset action. Give different screens different names.",
  automation_card_id: "Use a unique name if this panel has more than one Taylor's 3D card.",
};

// Drop empty values and defaults so the YAML stays short.
export function cleanConfig(config) {
  const out = {};
  const positionFields = ['model_position_x', 'model_position_y', 'model_position_z'];
  if (positionFields.some((key) => key in config)) {
    config = { ...config, model_position: positionFields.map((key, i) => {
      const value = config[key] ?? config.model_position?.[i] ?? 0;
      return Number.isFinite(Number(value)) ? Number(value) : 0;
    }) };
    for (const key of positionFields) delete config[key];
    if (config.model_position.every((value) => value === 0)) delete config.model_position;
  }
  for (const [k, value] of Object.entries(config)) {
    let v = value;
    if (v === undefined || v === null || v === '') continue;
    if (k === 'mini_map_size') {
      const size = Number(v);
      v = Number.isFinite(size) ? Math.round(Math.min(260, Math.max(120, size))) : DEFAULTS.mini_map_size;
    }
    if (k === 'mini_map_position' && !['top-right', 'top-left'].includes(v)) v = DEFAULTS.mini_map_position;
    if (k === 'device_tap_action' && !['popup', 'toggle'].includes(v)) v = DEFAULTS.device_tap_action;
    if (k === 'control_panel' && !['right', 'popup'].includes(v)) v = DEFAULTS.control_panel;
    if (k === 'layout_style' && !['original', 'house'].includes(v)) v = DEFAULTS.layout_style;
    if (k === 'house_colour_scheme' && !['ha', 'dark', 'light'].includes(v)) v = DEFAULTS.house_colour_scheme;
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
  connectedCallback() { if (this._config) this._render(); }
  disconnectedCallback() { this._sourceControls?.suspend(); }

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
    if (key === this._controlOrderKey) { this._updateControlOrderLabels(data); return; }
    this._controlOrder.hidden = !data.show_bubble_bar;
    const title = document.createElement('h3');
    this._orderTitle = title;
    title.style.cssText = 'margin: 0 0 8px; font-size: 15px; font-weight: 500;';
    const hint = document.createElement('p');
    this._orderHint = hint;
    hint.style.cssText = 'margin: 0 0 8px; color: var(--secondary-text-color); font-size: 13px;';
    const list = document.createElement('ol');
    list.setAttribute('role', 'list');
    list.style.cssText = 'list-style: none; margin: 0; padding: 0;';
    data.bubble_bar_controls.forEach((id, index, controls) => {
      const row = document.createElement('li');
      row.dataset.control = id;
      row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin: 4px 0;';
      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${id}`;
      label.style.cssText = 'flex: 1; min-width: 0;';
      row.append(label);
      for (const [direction, text, delta] of [['up', 'Up', -1], ['down', 'Down', 1]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = direction;
        button.textContent = text;
        button.disabled = direction === 'up' ? index === 0 : index === controls.length - 1;
        button.style.cssText = 'min-width: 58px; min-height: 44px;';
        button.addEventListener('click', () => this._moveBubbleControl(id, delta));
        row.append(button);
      }
      list.append(row);
    });
    this._controlOrder.replaceChildren(title, hint, list);
    this._controlOrderKey = key;
    this._updateControlOrderLabels(data);
  }

  _updateControlOrderLabels(data) {
    const t = (key, fallback, params = {}) => localize(this._hass, `settings.${key}`, params, fallback);
    this._controlOrder.setAttribute('aria-label', t('order.aria', 'Bubble bar button order'));
    text(this._orderTitle, t('order.title', 'Button order'));
    text(this._orderHint, data.bubble_bar_controls.length
      ? t('order.hint', 'Use Up and Down to arrange the buttons on your bottom bar.')
      : t('order.empty', 'Select buttons under Navigation and device controls to arrange them here.'));
    const options = SCHEMA.flatMap((field) => field.schema || [field])
      .find((field) => field.name === 'bubble_bar_controls').selector.select.options;
    for (const [index, id] of data.bubble_bar_controls.entries()) {
      const row = this._controlOrder.querySelector(`[data-control="${id}"]`);
      const label = t(`option.bubble_bar_controls.${id}`, options.find((option) => option.value === id)?.label || id);
      text(row.querySelector('span'), `${index + 1}. ${label}`);
      for (const [direction, fallback] of [['up', 'Up'], ['down', 'Down']]) {
        const button = row.querySelector(`.${direction}`);
        text(button, t(`order.${direction}`, fallback));
        button.setAttribute('aria-label', t(direction === 'up' ? 'order.moveUp' : 'order.moveDown',
          `Move {label} ${direction}`, { label }));
      }
    }
  }

  _render() {
    if (!customElements.get('ha-form')) {
      text(this, localize(this._hass, 'settings.noForm', {}, 'Edit this card in YAML (the visual editor needs a newer Home Assistant).'));
      return;
    }
    if (!this._form) {
      this.textContent = '';
      const style = document.createElement('style');
      style.dataset.taylors3dEditorStyle = '';
      style.textContent = EDITOR_STYLE;
      this.append(style);
      this._form = document.createElement('ha-form');
      this._form.computeLabel = (s) => localize(this._hass, `settings.label.${s.name}`, {}, LABELS[s.name] || s.name);
      this._form.computeHelper = (s) => localize(this._hass, `settings.helper.${s.name}`, {}, HELPERS[s.name] || '');
      this._form.addEventListener('value-changed', (e) => {
        e.stopPropagation();
        this._updateConfig(e.detail.value);
      });
      this._controlOrder = document.createElement('section');
      this._controlOrder.className = 'bubble-control-order';
      this._controlOrder.setAttribute('aria-label', 'Bubble bar button order');
      this._controlOrder.style.cssText = 'margin: 20px 0 0; color: var(--primary-text-color);';
      const hint = document.createElement('p');
      this._setupHint = hint;
      hint.style.cssText = 'margin: 16px 0 0; color: var(--secondary-text-color); font-size: 13px;';
      this.append(this._form, this._controlOrder, hint);
      this._houseNavigationEditor = new HouseNavigationEditor(this, { getConfig: () => this._config, getHass: () => this._hass,
        onChange: (config) => {
          this._config = config; this._render();
          this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
        } });
      this._sourceControls = new ImportedSourceControls(this, { getConfig: () => this._config, getHass: () => this._hass,
        onChange: (config) => {
          // Exact deletions must not clean or adopt unrelated imported settings.
          this._config = config; this._render();
          this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
        } });
      this.append(this._sourceControls.el);
    }
    this._form.hass = this._hass;
    this._form.schema = schemaFor(this._hass);
    const data = { ...DEFAULTS, ...cleanConfig(this._config) };
    this.setAttribute('data-taylors3d-editor-scheme', data.house_colour_scheme);
    this._form.data = { ...data, bubble_bar_controls: [...data.bubble_bar_controls],
      model_position_x: data.model_position?.[0] ?? 0, model_position_y: data.model_position?.[1] ?? 0,
      model_position_z: data.model_position?.[2] ?? 0 };
    this._renderControlOrder(data);
    this._houseNavigationEditor.update();
    text(this._setupHint, localize(this._hass, 'settings.setup', {},
      'Rooms, devices, the mower and the 3D model are set up on the card itself: save, then use its Edit button.'));
    this._sourceControls.update();
  }
}

if (!customElements.get('taylors3d-card-editor')) customElements.define('taylors3d-card-editor', Taylors3dCardEditor);
