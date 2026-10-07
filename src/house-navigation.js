// Future photo-inspired navigation. No routes, HA services or household data are
// inferred here. Root owns selection, panel content and the measured card layout.
import { localize } from './localization.js';

export const HOUSE_NAVIGATION_LIMITS = Object.freeze({ items: 32, id: 64, label: 128, path: 512 });
const definition = (id, label, icon, action) => Object.freeze({ id, label, icon, action: Object.freeze(action) });
export const HOUSE_NAVIGATION_ITEMS = Object.freeze([
  definition('house', 'House / 3D', 'mdi:cube-outline', { type: 'control', id: '3d' }),
  definition('lights', 'Lights', 'mdi:lightbulb', { type: 'category', id: 'lights' }),
  definition('security', 'Security', 'mdi:shield-home', { type: 'category', id: 'security' }),
  definition('media', 'Media', 'mdi:cast', { type: 'category', id: 'media' }),
  definition('climate', 'Climate', 'mdi:thermometer', { type: 'category', id: 'climate' }),
  definition('cars', 'Cars', 'mdi:car', { type: 'category', id: 'cars' }),
  definition('settings', 'Settings', 'mdi:cog', { type: 'category', id: 'settings' }),
]);
// Translate only card-owned defaults. Supplied navigation labels are user data.
export function localizeHouseNavigationItems(hass) {
  return HOUSE_NAVIGATION_ITEMS.map((item) => ({ ...item, label: localize(hass, `house.nav.${item.id}`, {}, item.label) }));
}
/** Read known presentation options only. Imported extras are never actions. */
export function resolveHouseNavigationItems(raw, hass) {
  const defaults = localizeHouseNavigationItems(hass);
  const options = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const known = new Map(defaults.map((item) => [item.id, item]));
  const order = Array.isArray(options.order) ? options.order.filter((id) => known.has(id)) : [];
  const ids = [...new Set(['house', ...order.filter((id) => id !== 'house'), ...known.keys()])];
  const hidden = new Set(Array.isArray(options.hidden) ? options.hidden : []);
  return ids.map((id) => ({ ...known.get(id), hidden: !['house', 'settings'].includes(id) && hidden.has(id) }));
}
const plain = (value) => !!value && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const validText = (value, maximum) => typeof value === 'string' && value.trim().length > 0
  && value.length <= maximum && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Explicit root-relative HA destinations only; this does not navigate anywhere. */
export function isHouseNavigationPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > HOUSE_NAVIGATION_LIMITS.path
    || /[\s\\]/u.test(path) || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path)) return false;
  try {
    // A fixed origin checks the path shape without depending on window size,
    // deployment host, SSR location or a default Home Assistant dashboard URL.
    const url = new URL(path, 'https://taylors3d.invalid');
    decodeURIComponent(path); // Reject malformed percent escapes.
    return url.origin === 'https://taylors3d.invalid' && url.pathname.startsWith('/') && !url.pathname.startsWith('//')
      && url.pathname + url.search + url.hash === path;
  } catch { return false; }
}
function actionKey(action) {
  if (!plain(action)) return null;
  const keys = Object.keys(action);
  if (['category', 'control'].includes(action.type) && validId(action.id)
    && keys.length === 2 && keys.includes('type') && keys.includes('id')) return JSON.stringify([action.type, action.id]);
  if (action.type === 'route' && isHouseNavigationPath(action.path)
    && keys.length === 2 && keys.includes('type') && keys.includes('path')) return JSON.stringify(['route', action.path]);
  return null;
}
function readItem(raw) {
  try {
    if (!plain(raw) || !validId(raw.id) || !validText(raw.label, HOUSE_NAVIGATION_LIMITS.label)
      || typeof raw.icon !== 'string' || !/^mdi:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.icon) || raw.icon.length > 68
      || ['hidden', 'disabled'].some((key) => Object.hasOwn(raw, key) && typeof raw[key] !== 'boolean')) return null;
    const key = actionKey(raw.action);
    return key === null ? null : { raw, id: raw.id, label: raw.label, icon: raw.icon, action: raw.action,
      key, hidden: raw.hidden === true, disabled: raw.disabled === true };
  } catch { return null; }
}

// Root calls setLayout with its actual card width. Compact navigation exposes
// overflow in a temporary menu; its absolute surface claims no scene rectangle.
let navigationSequence = 0;
export const HOUSE_NAVIGATION_CSS = `
[data-house-navigation][data-taylors3d-nav-rail][data-house-navigation-layout]{display:block;box-sizing:border-box;min-width:0;max-width:100%;background:var(--taylors3d-ui-surface,var(--ha-card-background,var(--card-background-color,#fff)));color:var(--taylors3d-ui-text,var(--primary-text-color,#212121));border:1px solid var(--taylors3d-ui-divider,var(--divider-color,#888));border-radius:18px;padding:8px;font:inherit}
[data-house-navigation] [data-house-navigation-items]{display:flex;flex-direction:row;gap:8px;max-width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior:contain;scroll-padding:6px;padding:6px;scrollbar-width:thin}
[data-house-navigation] button{box-sizing:border-box;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-width:44px;min-height:44px;max-width:168px;padding:9px 12px;font:inherit;font-size:12px;line-height:1.3;color:var(--taylors3d-ui-text,var(--primary-text-color,#212121));background:var(--taylors3d-ui-raised,var(--secondary-background-color,var(--ha-card-background,var(--card-background-color,#fff))));border:1px solid var(--taylors3d-ui-border,var(--divider-color,#888));border-radius:12px;cursor:pointer}
[data-house-navigation] [data-house-navigation-label]{overflow-wrap:anywhere}
[data-house-navigation] ha-icon{width:22px;height:22px;--mdc-icon-size:22px;pointer-events:none}
[data-house-navigation] button[aria-pressed="true"]{background:var(--taylors3d-ui-teal,var(--ha-card-background,var(--card-background-color,#fff)));color:var(--taylors3d-ui-on-teal,var(--primary-text-color,#212121));border-color:var(--taylors3d-ui-teal,var(--primary-text-color,#212121))}
[data-house-navigation] button:focus-visible,[data-house-navigation]:focus-visible{outline:3px solid var(--taylors3d-ui-focus,var(--primary-text-color,#212121));outline-offset:2px}
[data-house-navigation] button:disabled{opacity:.6;cursor:default}
[data-house-navigation][data-house-navigation-layout="rail"] [data-house-navigation-items]{flex-direction:column;overflow-x:hidden;overflow-y:auto;padding:4px 0}
[data-house-navigation][data-house-navigation-layout="rail"] button{width:100%;max-width:100%;padding-inline:4px;min-height:56px}
[data-house-navigation][hidden],[data-house-navigation] [hidden]{display:none!important}
[data-house-navigation][data-house-navigation-compact] [data-house-navigation-items]{display:grid;grid-template-columns:repeat(var(--house-navigation-columns,4),minmax(0,1fr));gap:4px;overflow:visible;padding:4px}
[data-house-navigation][data-house-navigation-compact] [data-house-navigation-items]>button{width:100%;max-width:none;min-width:44px;padding:8px 2px;font-size:11px}
[data-house-navigation] [data-house-navigation-overflow]{position:absolute;bottom:calc(100% + 8px);left:0;right:0;z-index:2;max-height:min(300px,60vh);overflow-y:auto;box-sizing:border-box;padding:10px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;background:var(--taylors3d-ui-surface,var(--card-background-color,#fff));border:1px solid var(--taylors3d-ui-border,var(--divider-color,#888));border-radius:18px;box-shadow:0 12px 36px #0004}
[data-house-navigation] [data-house-navigation-overflow]>button{width:100%;max-width:none;min-height:52px}
@media(forced-colors:active){[data-house-navigation] button{color:ButtonText;background:ButtonFace;border-color:ButtonText}[data-house-navigation] button[aria-pressed="true"]{color:HighlightText;background:Highlight;border-color:Highlight}[data-house-navigation] button:focus-visible,[data-house-navigation]:focus-visible{outline-color:Highlight}}
`;

/** update({selected:null|string,items:[{id,label,icon,action,hidden?,disabled?}]})
 * Actions are exactly {type:'category'|'control',id} or {type:'route',path}.
 * Only onSelect(action,{id,label,icon}) runs, once per deliberate native click.
 * Selection changes only when root updates it. Detached/stale controls cannot act.
 * Call setLayout('rail'|'bottom', width) from actual card size;
 * root owns positioning/reserved space and real category/route implementation.
 */
export class HouseNavigation {
  constructor(parent, { onSelect } = {}) {
    this.parent = parent; this.onSelect = onSelect; this._rows = new Map(); this._gestures = new Map();
    this._rawItems = HOUSE_NAVIGATION_ITEMS; this.selected = null; this._nextIntent = 0; this._disposed = false;
    const document = parent.ownerDocument;
    this.element = document.createElement('nav'); this.element.dataset.houseNavigation = '';
    this.element.dataset.taylors3dNavRail = ''; this.element.dataset.taylors3dUi = 'house-navigation';
    this.element.dataset.houseNavigationLayout = 'bottom'; this.element.setAttribute('aria-label', 'House navigation'); this.element.tabIndex = -1;
    const style = document.createElement('style'); style.textContent = HOUSE_NAVIGATION_CSS;
    this.items = document.createElement('div'); this.items.dataset.houseNavigationItems = '';
    this.overflow = document.createElement('div'); this.overflow.dataset.houseNavigationOverflow = ''; this.overflow.hidden = true;
    this.overflow.id = `taylors3d-house-menu-${++navigationSequence}`;
    this.overflow.setAttribute('role', 'group');
    this.more = document.createElement('button'); this.more.type = 'button'; this.more.dataset.houseNavigationMore = '';
    this.more.setAttribute('aria-expanded', 'false'); this.more.hidden = true;
    this.more.setAttribute('aria-controls', this.overflow.id);
    const moreIcon = document.createElement('ha-icon'); moreIcon.setAttribute('icon', 'mdi:dots-horizontal'); moreIcon.setAttribute('aria-hidden', 'true');
    this.moreLabel = document.createElement('span'); this.more.append(moreIcon, this.moreLabel);
    this.element.append(style, this.items, this.overflow); parent.append(this.element);
    this._outside = (event) => {
      if (event.type === 'pointerdown') this._dismissClick = false;
      const path = event.composedPath?.() || [];
      if (path.includes(this.element)) return;
      const insideStage = path.includes(this.parent);
      if (this._dismissClick && event.type === 'click') {
        this._dismissClick = false;
        if (insideStage) { event.preventDefault(); event.stopImmediatePropagation(); }
        return;
      }
      if (!this._open) return;
      this.closeMore(insideStage);
      if (insideStage) {
        this._dismissClick = event.type === 'pointerdown';
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    document.addEventListener('pointerdown', this._outside, true); document.addEventListener('click', this._outside, true);
    this._handlers = new Map([
      ['pointerdown', (event) => this._press(event)], ['pointerup', (event) => this._release(event)],
      ['pointercancel', (event) => this._cancel(event)], ['keydown', (event) => this._key(event)],
      ['keyup', (event) => this._release(event)], ['focusout', (event) => {
        this._cancel(event, true);
        if (event.relatedTarget && !this.element.contains(event.relatedTarget)) this.closeMore(false);
      }],
      ['click', (event) => this._click(event)], ['wheel', (event) => event.stopPropagation()],
    ]);
    for (const [type, handler] of this._handlers) this.element.addEventListener(type, handler);
    this.update();
  }
  _button(event) { return event.target?.closest?.('button[data-house-navigation-id]'); }
  _live(button) {
    return !this._disposed && this.parent.isConnected && this.element.isConnected && this.element.parentNode === this.parent
      && (button?.parentNode === this.items || button?.parentNode === this.overflow && this._open)
      && this.items.parentNode === this.element;
  }
  setLayout(mode, width = 390) {
    const rail = mode === 'rail', limit = width < 390 ? 3 : 4;
    const changed = this._compact !== !rail || this._limit !== limit;
    this.element.dataset.houseNavigationLayout = rail ? 'rail' : 'bottom';
    this._compact = !rail; this._limit = limit;
    this.element.toggleAttribute('data-house-navigation-compact', !rail);
    if (changed) {
      const hidden = this.element.hidden;
      this.closeMore(false); this.update(); this.element.hidden = hidden;
    }
  }
  closeMore(restoreFocus = true) {
    if (!this._open) return;
    this._open = false; this.overflow.hidden = true; this.more.setAttribute('aria-expanded', 'false');
    if (this.element.style.zIndex === '40') {
      if (this._beforeMoreZ?.value) this.element.style.setProperty('z-index', this._beforeMoreZ.value, this._beforeMoreZ.priority);
      else this.element.style.removeProperty('z-index');
    }
    for (const [button, gesture] of this._gestures) if (button.parentNode === this.overflow) gesture.poisoned = true;
    if (restoreFocus && !this.more.hidden && this.more.isConnected) this.more.focus();
  }
  _toggleMore() {
    if (this.more.hidden || !this.element.isConnected || this._disposed) return;
    if (this._open) { this.closeMore(); return; }
    this._open = true; this.overflow.hidden = false; this.more.setAttribute('aria-expanded', 'true');
    this._beforeMoreZ = { value: this.element.style.getPropertyValue('z-index'), priority: this.element.style.getPropertyPriority('z-index') };
    this.element.style.setProperty('z-index', '40');
    [...this.overflow.children].find((button) => this._current(button))?.focus();
  }
  _current(button) {
    if (!this._live(button) || !Array.isArray(this._rawItems) || this._rawItems.length > HOUSE_NAVIGATION_LIMITS.items) return null;
    const row = this._rows.get(button.dataset.houseNavigationId);
    if (!row || row.button !== button || button.hidden || button.disabled || typeof this.onSelect !== 'function') return null;
    const matches = this._rawItems.filter((item) => { try { return item?.id === row.item.id; } catch { return false; } });
    const item = matches.length === 1 ? readItem(matches[0]) : null;
    return item && item.raw === row.item.raw && item.key === row.item.key && !item.hidden && !item.disabled ? row : null;
  }
  update({ selected = this.selected, items = this._rawItems, hass = this._hass } = {}) {
    if (this._disposed) return { valid: false, diagnostics: [{ code: 'disposed', message: 'Navigation has been disposed.' }] };
    this._hass = hass;
    this.moreLabel.textContent = localize(hass, 'settings.nav.more', {}, 'More');
    this.more.setAttribute('aria-label', this.moreLabel.textContent);
    this.overflow.setAttribute('aria-label', localize(hass, 'settings.nav.moreSections', {}, 'More house sections'));
    const aria = localize(hass, 'house.nav.aria', {}, 'House navigation');
    if (this.element.getAttribute('aria-label') !== aria) this.element.setAttribute('aria-label', aria);
    this.selected = validId(selected) ? selected : null; this._rawItems = items;
    const diagnostics = [], next = new Map(), duplicates = new Set(), seenIds = new Set();
    if (!Array.isArray(items) || items.length > HOUSE_NAVIGATION_LIMITS.items) diagnostics.push({ code: 'items', message: 'Provide at most 32 explicit navigation items.' });
    else for (const [index, raw] of items.entries()) {
      const item = readItem(raw);
      let id; try { id = raw?.id; } catch { /* Invalid accessor is reported below. */ }
      if (validId(id)) {
        if (seenIds.has(id)) { duplicates.add(id); diagnostics.push({ code: 'duplicate', index, message: 'Navigation IDs must be unique.' }); }
        else seenIds.add(id);
      }
      if (!item) { diagnostics.push({ code: 'item', index, message: 'This navigation item or action is invalid.' }); continue; }
      if (!next.has(item.id)) next.set(item.id, item);
    }
    for (const id of duplicates) next.delete(id);
    const focused = this.element.getRootNode().activeElement;
    for (const [id, row] of this._rows) if (!next.has(id)) { this._gestures.delete(row.button); row.button.remove(); this._rows.delete(id); }
    let visibleIndex = 0;
    const primary = [], overflow = [];
    for (const item of next.values()) {
      let row = this._rows.get(item.id);
      if (!row) {
        const button = this.parent.ownerDocument.createElement('button'); button.type = 'button'; button.dataset.houseNavigationId = item.id;
        const icon = this.parent.ownerDocument.createElement('ha-icon'); icon.setAttribute('aria-hidden', 'true');
        const label = this.parent.ownerDocument.createElement('span'); label.dataset.houseNavigationLabel = '';
        button.append(icon, label); row = { button, icon, label, intent: ++this._nextIntent }; this._rows.set(item.id, row);
      } else if (row.item.key !== item.key || row.item.hidden !== item.hidden || row.item.disabled !== item.disabled) row.intent = ++this._nextIntent;
      row.item = item;
      const label = this._compact && item.id === 'house' && item.action.type === 'control' && item.action.id === '3d'
        && item.label === localize(hass, 'house.nav.house', {}, 'House / 3D')
        ? localize(hass, 'settings.nav.houseShort', {}, 'House') : item.label;
      if (row.label.textContent !== label) row.label.textContent = label;
      row.icon.setAttribute('icon', item.icon); row.button.setAttribute('aria-label', item.label); row.button.title = item.label;
      row.button.hidden = item.hidden; row.button.disabled = item.disabled || typeof this.onSelect !== 'function';
      row.button.dataset.houseNavigationAction = item.action.type;
      const active = this.selected === item.id && !item.hidden;
      row.button.setAttribute('aria-pressed', String(active));
      if (active) row.button.setAttribute('aria-current', item.action.type === 'route' ? 'page' : 'true'); else row.button.removeAttribute('aria-current');
      const inOverflow = this._compact && !item.hidden && visibleIndex++ >= this._limit;
      (inOverflow ? overflow : primary).push(row.button);
    }
    const arrange = (parent, buttons) => buttons.forEach((button, index) => {
      if (parent.children[index] !== button) parent.insertBefore(button, parent.children[index] || null);
    });
    this.more.hidden = overflow.length === 0;
    if (this.more.hidden) { this.closeMore(false); this.more.remove(); }
    else primary.push(this.more);
    arrange(this.items, primary); arrange(this.overflow, overflow);
    this.element.style.setProperty('--house-navigation-columns', String(Math.min(this._limit || 4, visibleIndex) + (overflow.length ? 1 : 0)));
    this.more.setAttribute('aria-pressed', String(overflow.some((button) => button.dataset.houseNavigationId === this.selected)));
    this.element.hidden = ![...next.values()].some((item) => !item.hidden);
    for (const [button, gesture] of this._gestures) {
      const row = this._current(button);
      if (!row || row.intent !== gesture.intent) gesture.poisoned = true;
    }
    if (focused && this.element.contains(focused) && !focused.hidden && !focused.disabled && (focused.parentNode !== this.overflow || this._open) && this.parent.isConnected
      && this.element.getRootNode().activeElement !== focused) focused.focus();
    else if (focused?.dataset?.houseNavigationId && (!this.element.contains(focused) || focused.hidden || focused.disabled || focused.parentNode === this.overflow && !this._open)
      && !this.element.hidden && this.parent.isConnected) {
      const available = [...this.items.children].find((button) => this._current(button));
      (available || this.element).focus();
    }
    return { valid: diagnostics.length === 0, diagnostics };
  }
  _press(event) {
    event.stopPropagation(); const button = this._button(event), row = this._current(button);
    if (!row || event.button !== undefined && event.button !== 0) return;
    this._gestures.set(button, { intent: row.intent, poisoned: false, consumed: false, held: true,
      key: event.key, pointerId: event.pointerId });
  }
  _release(event) {
    event.stopPropagation(); const button = this._button(event), gesture = this._gestures.get(button);
    if (!gesture || gesture.key !== undefined && event.key !== gesture.key
      || gesture.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
    gesture.held = false;
    if (gesture.consumed && !gesture.poisoned) this._gestures.delete(button);
  }
  _cancel(event, heldOnly = false) {
    const gesture = this._gestures.get(this._button(event));
    if (gesture && (!heldOnly || gesture.held)) gesture.poisoned = true;
    if (!heldOnly) event.stopPropagation();
  }
  _key(event) {
    if (event.key === 'Escape' && this._open) { event.preventDefault(); event.stopPropagation(); this.closeMore(); return; }
    if (['Enter', ' '].includes(event.key)) {
      if (event.repeat) { event.stopPropagation(); event.preventDefault(); return; }
      this._press(event); return; // The browser's native button click is the action.
    }
    const button = event.target?.closest?.('button'), group = button?.parentNode === this.overflow ? this.overflow : this.items;
    const visible = [...group.children].filter((node) => node === this.more && !node.hidden || this._current(node));
    const index = visible.indexOf(button), delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    if (index < 0 || !delta && !['Home', 'End'].includes(event.key)) return;
    event.stopPropagation(); event.preventDefault();
    const target = visible[event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (index + delta + visible.length) % visible.length];
    target.focus(); target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  _click(event) {
    event.stopPropagation(); const button = this._button(event), row = this._current(button), gesture = this._gestures.get(button);
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target?.closest?.('[data-house-navigation-more]') === this.more) { this._toggleMore(); return; }
    if (!row) { if (gesture) gesture.poisoned = true; return; }
    if (gesture && (gesture.poisoned || gesture.consumed || gesture.intent !== row.intent)) return;
    if (gesture) { gesture.consumed = true; if (!gesture.held) this._gestures.delete(button); }
    const action = row.item.action, details = { id: row.item.id, label: row.item.label, icon: row.item.icon };
    if (button.parentNode === this.overflow) this.closeMore();
    this.onSelect(action, details);
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const [type, handler] of this._handlers) this.element.removeEventListener(type, handler);
    this.parent.ownerDocument.removeEventListener('pointerdown', this._outside, true); this.parent.ownerDocument.removeEventListener('click', this._outside, true);
    this._gestures.clear(); this._rows.clear(); this._rawItems = []; this.onSelect = null; this.element.remove();
  }
}
