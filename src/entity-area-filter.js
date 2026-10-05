// A local picker preference, never saved configuration or a Home Assistant action.
import { localize, localeInfo } from './localization.js';
import messages from './translations/entity-area-filter.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const ownValue = (source, name) => {
  try { const descriptor = Object.getOwnPropertyDescriptor(source || {}, name); return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined; }
  catch { return undefined; }
};
const dictionary = (source) => {
  try { return source && typeof source === 'object' && !Array.isArray(source) && [Object.prototype, null].includes(Object.getPrototypeOf(source)); }
  catch { return false; }
};
const text = (value) => typeof value === 'string' && value.trim() && value.length <= 256;

export class EntityAreaFilter {
  constructor() { this.value = 'all'; }
  _t(hass, key, params = {}) {
    const name = `entityAreaFilter.${key}`;
    return localize(hass, name, params, messages[localeInfo(hass).resolved]?.[name] || messages.en[name]);
  }
  options(hass) {
    const areas = ownValue(hass, 'areas'), ready = dictionary(areas) && dictionary(ownValue(hass, 'entities')) && dictionary(ownValue(hass, 'devices'));
    const options = [{ value: 'all', label: this._t(hass, 'all') }, { value: 'unassigned', label: this._t(hass, 'unassigned'), disabled: !ready }];
    if (dictionary(areas)) for (const id of Object.keys(areas).slice(0, 1024)) {
      if (!text(id)) continue;
      const area = ownValue(areas, id), name = ownValue(area, 'name');
      if (!dictionary(area) || ownValue(area, 'area_id') !== undefined && ownValue(area, 'area_id') !== id) continue;
      options.push({ value: `area:${id}`, label: text(name) ? name : id, disabled: !ready });
    }
    const ordered = [...options.slice(0, 2), ...options.slice(2).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))];
    if (!ordered.some((option) => option.value === this.value)) ordered.push({ value: this.value, label: this._t(hass, 'missing', { id: this.value.slice(5) }), disabled: true });
    return ordered;
  }
  set(hass, value) {
    if (!this.options(hass).some((option) => option.value === value && !option.disabled)) return false;
    this.value = value; return true;
  }
  choices(hass, choices) {
    if (this.value === 'all') return choices;
    const current = this.options(hass).some((option) => option.value === this.value && !option.disabled);
    const areaId = this.value === 'unassigned' ? null : this.value.slice(5);
    return choices.filter((choice) => choice.selected || current && choice.areaId === areaId);
  }
  render(hass, field) {
    return `<label data-entity-area-filter="${esc(field)}"><span data-entity-area-label>${esc(this._t(hass, 'label'))}</span><select data-field="${esc(field)}">${this.options(hass).map((option) => `<option value="${esc(option.value)}" ${option.value === this.value ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${esc(option.label)}</option>`).join('')}</select><small data-entity-area-hint>${esc(this._t(hass, 'hint'))}</small></label>`;
  }
  update(hass, root, field) {
    const label = [...(root?.querySelectorAll('[data-entity-area-filter]') || [])].find((node) => node.dataset.entityAreaFilter === field);
    if (!label) return;
    label.querySelector('[data-entity-area-label]').textContent = this._t(hass, 'label');
    label.querySelector('[data-entity-area-hint]').textContent = this._t(hass, 'hint');
    const select = label.querySelector('select'), existing = new Map([...select.options].map((option) => [option.value, option])), keep = new Set();
    this.options(hass).forEach((choice, index) => {
      const option = existing.get(choice.value) || select.ownerDocument.createElement('option');
      option.value = choice.value; option.textContent = choice.label; option.disabled = !!choice.disabled;
      if (select.options[index] !== option) select.insertBefore(option, select.options[index] || null);
      keep.add(option);
    });
    for (const option of [...select.options]) if (!keep.has(option)) option.remove();
    select.value = this.value;
  }
}
