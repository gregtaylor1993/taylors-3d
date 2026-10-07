// Presentation only: this editor never invokes a category or a Home Assistant action.
import { resolveHouseNavigationItems, HOUSE_NAVIGATION_ITEMS } from './house-navigation.js';
import { localize } from './localization.js';

const known = new Set(HOUSE_NAVIGATION_ITEMS.map((item) => item.id));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
export class HouseNavigationEditor {
  constructor(parent, { getConfig, getHass, onChange }) {
    this.getConfig = getConfig; this.getHass = getHass; this.onChange = onChange;
    this.element = parent.ownerDocument.createElement('section'); this.element.className = 'house-navigation-order';
    this.element.style.marginTop = '20px'; parent.append(this.element); this.update();
  }
  t(key, fallback, params = {}) { return localize(this.getHass(), `settings.nav.${key}`, params, fallback); }
  change(id, action) {
    const config = this.getConfig(), raw = config.house_navigation;
    if (raw !== undefined && !object(raw) && action !== 'reset') return;
    const next = object(raw) ? { ...raw } : {};
    const items = resolveHouseNavigationItems(raw, this.getHass());
    const unknownOrder = Array.isArray(next.order) ? next.order.filter((value) => !known.has(value)) : [];
    const unknownHidden = Array.isArray(next.hidden) ? next.hidden.filter((value) => !known.has(value)) : [];
    if (action === 'reset') {
      if (unknownOrder.length) next.order = unknownOrder; else delete next.order;
      if (unknownHidden.length) next.hidden = unknownHidden; else delete next.hidden;
    } else if (action === 'show') {
      if (['house', 'settings'].includes(id)) return;
      const item = items.find((item) => item.id === id); if (!item) return;
      const hidden = Array.isArray(next.hidden) ? next.hidden.filter((value) => value !== id) : [];
      if (!item.hidden) hidden.push(id); next.hidden = hidden;
    } else {
      const index = items.findIndex((item) => item.id === id), target = index + (action === 'up' ? -1 : 1);
      if (index < 1 || target < 1 || target >= items.length) return;
      [items[index], items[target]] = [items[target], items[index]];
      next.order = [...items.map((item) => item.id), ...unknownOrder];
    }
    // Do not normalize any unrelated imported configuration during an ordering edit.
    const updated = { ...config }; if (Object.keys(next).length) updated.house_navigation = next; else delete updated.house_navigation;
    this.onChange(updated); this.update();
    const row = [...this.element.querySelectorAll('[data-house-nav-option]')].find((row) => row.dataset.houseNavOption === id);
    const target = row?.querySelector(`[data-nav-edit-action="${action}"]:not(:disabled)`)
      || row?.querySelector('button:not(:disabled)') || this.element.querySelector('[data-nav-reset]');
    target?.focus();
  }
  update() {
    const config = this.getConfig(), raw = config.house_navigation, hass = this.getHass();
    const items = resolveHouseNavigationItems(raw, hass), invalid = raw !== undefined && !object(raw);
    this.element.hidden = config.layout_style !== 'house';
    const key = JSON.stringify([items.map(({ id, label, hidden }) => [id, label, hidden]), invalid, hass?.locale?.language, hass?.language]);
    if (key === this._key) return; this._key = key;
    const document = this.element.ownerDocument, title = document.createElement('h3'), hint = document.createElement('p');
    title.textContent = this.t('title', 'House menu');
    hint.textContent = this.t('hint', 'Choose and order your house sections. The first three or four fit on a phone; the rest are under More. House stays first and Settings remains available. Custom action bars are separate: Edit → Controls → Buttons and bars.');
    this.element.setAttribute('aria-label', title.textContent);
    const list = document.createElement('ol'); list.className = 'house-nav-options';
    items.forEach((item, index) => {
      const row = document.createElement('li'); row.dataset.houseNavOption = item.id;
      const label = document.createElement('span'); label.textContent = item.label; row.append(label);
      const show = document.createElement('button'); show.type = 'button'; show.dataset.navEditAction = 'show';
      show.textContent = item.hidden ? this.t('hidden', 'Hidden') : this.t('shown', 'Shown');
      show.setAttribute('aria-pressed', String(!item.hidden));
      show.setAttribute('aria-label', this.t('show', 'Show {label}', { label: item.label }));
      show.disabled = invalid || ['house', 'settings'].includes(item.id); show.addEventListener('click', () => this.change(item.id, 'show'));
      row.append(show);
      for (const [action, symbol] of [['up', '↑'], ['down', '↓']]) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.navEditAction = action;
        button.textContent = symbol; button.setAttribute('aria-label', this.t(action, action === 'up' ? 'Move {label} up' : 'Move {label} down', { label: item.label }));
        button.disabled = invalid || index === 0 || action === 'up' && index === 1 || action === 'down' && index === items.length - 1;
        button.addEventListener('click', () => this.change(item.id, action)); row.append(button);
      }
      list.append(row);
    });
    const reset = document.createElement('button'); reset.type = 'button'; reset.dataset.navReset = '';
    reset.textContent = this.t('reset', 'Reset house menu'); reset.addEventListener('click', () => this.change(null, 'reset'));
    const note = document.createElement('p'); note.textContent = invalid
      ? this.t('invalid', 'This imported menu setting is unsupported. Reset house menu to use the built-in sections; other card settings are kept.')
      : this.t('save', 'Save in Home Assistant’s card editor to keep these changes.');
    this.element.replaceChildren(title, hint, list, reset, note);
  }
}
