import { localeInfo } from './localization.js';
import captions from './translations/global-search.js';

const KINDS = ['room', 'device', 'view', 'scene', 'setting'];
const LIMIT = 12;
let nextSearch = 0;
const field = (value, key) => { try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; } };
const text = (value, max = 512) => typeof value === 'string' && value.length <= max && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const normalize = (value) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
const identity = (item) => JSON.stringify([item.id, item.kind, item.target]);

export function globalSearchText(hass, key, params = {}) {
  const message = captions[localeInfo(hass).resolved]?.[key] ?? captions.en[key] ?? '';
  return message.replace(/\{(\w+)\}/g, (_, name) => typeof params[name] === 'number' || typeof params[name] === 'string' ? String(params[name]) : '');
}

function readContext(raw) {
  const contextKey = field(raw, 'contextKey'), hass = field(raw, 'hass'), items = field(raw, 'items'), suspended = field(raw, 'suspended');
  if (!text(contextKey, 8192) || !contextKey || !hass || typeof hass !== 'object' || !Array.isArray(items) || items.length > 10000
    || suspended !== undefined && typeof suspended !== 'boolean') return null;
  const valid = [], seen = new Set(), duplicates = new Set();
  for (let index = 0; index < items.length; index++) {
    const source = field(items, String(index));
    const item = Object.fromEntries(['id', 'kind', 'label', 'subtitle', 'keywords', 'target'].map((key) => [key, field(source, key)]));
    if (text(item.id) && item.id) { if (seen.has(item.id)) duplicates.add(item.id); seen.add(item.id); }
    if (!text(item.id) || !item.id || !KINDS.includes(item.kind) || !text(item.label) || !item.label.trim()
      || !text(item.target, 2048) || !item.target || item.subtitle !== undefined && !text(item.subtitle, 1024)
      || item.keywords !== undefined && (!Array.isArray(item.keywords) || item.keywords.length > 32)) continue;
    const keywords = [];
    if (item.keywords) for (let n = 0; n < item.keywords.length; n++) keywords.push(field(item.keywords, String(n)));
    if (keywords.some((word) => !text(word))) continue;
    valid.push({ ...item, subtitle: item.subtitle || '', keywords });
  }
  return { contextKey, hass, suspended: !!suspended, items: valid.filter((item) => !duplicates.has(item.id)) };
}

export const GLOBAL_SEARCH_CSS = `
[data-global-search]{position:absolute;inset:8px;z-index:80;box-sizing:border-box;display:flex;justify-content:center;align-items:flex-start;min-width:0;padding:8px;background:rgb(0 0 0 / 18%);border-radius:20px;color:var(--taylors3d-ui-text,var(--primary-text-color,#212121));font-family:var(--taylors3d-ui-font,inherit);touch-action:manipulation}
[data-global-search] *{box-sizing:border-box}
[data-global-search] .search-dialog{display:flex;flex-direction:column;width:min(560px,100%);max-height:100%;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;touch-action:pan-y;padding:16px;border:1px solid var(--taylors3d-ui-divider,var(--divider-color,#888));border-radius:20px;background:var(--taylors3d-ui-surface,var(--ha-card-background,var(--card-background-color,#fff)));box-shadow:var(--taylors3d-ui-shadow,0 12px 36px #0003)}
[data-global-search] .search-head{display:flex;align-items:center;gap:12px;flex:none;min-width:0;position:sticky;top:0;z-index:1;background:var(--taylors3d-ui-surface,var(--ha-card-background,var(--card-background-color,#fff)))}
[data-global-search] h2{flex:1;margin:0;font-size:20px;line-height:1.3;font-weight:650;overflow-wrap:anywhere}
[data-global-search] button,[data-global-search] input{font:inherit;font-size:14px;min-height:44px;min-width:44px;color:inherit;border:1px solid var(--taylors3d-ui-divider,var(--divider-color,#888));border-radius:12px;background:var(--taylors3d-ui-raised,var(--secondary-background-color,#eee))}
[data-global-search] button{cursor:pointer;padding:10px 12px;touch-action:manipulation}
[data-global-search] .search-close{flex:none;font-size:22px;line-height:1;padding:8px;width:44px}
[data-global-search] input{flex:none;width:100%;min-width:0;padding:10px 12px;margin-top:12px;border-color:var(--taylors3d-ui-border,var(--divider-color,#888))}
[data-global-search] input::placeholder{color:var(--taylors3d-ui-muted,var(--secondary-text-color,#666));opacity:1}
[data-global-search] .search-hint,[data-global-search] .search-status{flex:none;font-size:12px;line-height:1.4;color:var(--taylors3d-ui-muted,var(--secondary-text-color,#666));overflow-wrap:anywhere;margin:8px 0}
[data-global-search] .search-results{min-height:52px;overflow:auto;overscroll-behavior:contain;touch-action:pan-y;scroll-padding:4px;padding:4px;display:grid;gap:12px}
[data-global-search] .search-group{display:grid;gap:4px;min-width:0}
[data-global-search] h3{font-size:12px;font-weight:650;margin:4px 8px;color:var(--taylors3d-ui-muted,var(--secondary-text-color,#666))}
[data-global-search] .search-result{display:flex;flex-direction:column;align-items:flex-start;gap:3px;width:100%;min-width:0;text-align:start;background:transparent;border-color:transparent;overflow-wrap:anywhere}
[data-global-search] .search-result-label{font-weight:600}
[data-global-search] .search-result-detail{font-size:12px;color:var(--taylors3d-ui-muted,var(--secondary-text-color,#666));line-height:1.35}
[data-global-search] .search-result[aria-selected=true]{background:var(--taylors3d-ui-teal-soft,var(--secondary-background-color,#eee));border-color:var(--taylors3d-ui-border,var(--divider-color,#888))}
[data-global-search] :is(button,input):focus-visible{outline:3px solid var(--taylors3d-ui-focus,var(--primary-text-color,#212121));outline-offset:-3px}
@media(forced-colors:active){[data-global-search] .search-dialog,[data-global-search] button,[data-global-search] input{color:CanvasText;background:Canvas;border-color:CanvasText}[data-global-search] .search-result[aria-selected=true]{background:Highlight;color:HighlightText}[data-global-search] .search-result[aria-selected=true] .search-result-detail{color:HighlightText}}
`;

/** An owned overlay only; root supplies current destinations and opens controls.
 * getContext() => {contextKey,hass,suspended?,items:[{id,kind,label,target,subtitle?,keywords?}]}
 * kind: room | device | view | setting | scene. IDs must be unique. target is a
 * stable destination identity, not executable data. onSelect(currentItem) never
 * receives an item retained from an old account/layout/model/session.
 * No document shortcut, service call, storage write, timer or scene resize.
 */
export class GlobalSearch {
  constructor(parent, { getContext, onSelect, onOpenChange } = {}) {
    this.parent = parent; this.getContext = getContext; this.onSelect = onSelect; this.onOpenChange = onOpenChange;
    this.document = parent.ownerDocument; this.el = null; this._version = 0; this._disposed = false;
    this._id = `taylors3d-search-${++nextSearch}`; this._shown = new Map(); this._active = null;
  }
  get isOpen() { return !!this.el; }
  _read() { try { return readContext(this.getContext?.()); } catch { return null; } }
  _text(key, params) { return globalSearchText(this._context?.hass, key, params); }
  _node(tag, className, caption) {
    const node = this.document.createElement(tag); if (className) node.className = className;
    if (caption !== undefined) node.textContent = caption; return node;
  }
  open(opener) {
    if (this._disposed || !this.parent.isConnected) return false;
    const context = this._read(); if (!context || context.suspended || typeof this.onSelect !== 'function') return false;
    if (this.el) { this.update(); this.input?.focus({ preventScroll: true }); return this.isOpen; }
    this._context = context; this._openContext = context.contextKey; this._version++;
    this._opener = opener || this.parent.getRootNode().activeElement;
    const el = this._node('div'); el.dataset.globalSearch = ''; el.dataset.taylors3dUi = 'global-search';
    const style = this._node('style'); style.textContent = GLOBAL_SEARCH_CSS;
    const dialog = this._node('section', 'search-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'false');
    dialog.setAttribute('aria-labelledby', `${this._id}-title`);
    const head = this._node('div', 'search-head'); this.title = this._node('h2'); this.title.id = `${this._id}-title`;
    this.closeButton = this._node('button', 'search-close', '×'); this.closeButton.type = 'button'; head.append(this.title, this.closeButton);
    this.input = this._node('input'); this.input.type = 'search'; this.input.autocomplete = 'off'; this.input.maxLength = 256;
    this.input.setAttribute('role', 'combobox'); this.input.setAttribute('aria-autocomplete', 'list'); this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-controls', `${this._id}-results`);
    this.hint = this._node('p', 'search-hint'); this.hint.id = `${this._id}-hint`; this.input.setAttribute('aria-describedby', this.hint.id);
    this.status = this._node('p', 'search-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.results = this._node('div', 'search-results'); this.results.id = `${this._id}-results`; this.results.setAttribute('role', 'listbox');
    dialog.append(head, this.input, this.hint, this.status, this.results); el.append(style, dialog); this.el = el; this.parent.append(el);
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'click', 'dblclick', 'wheel', 'touchstart', 'touchmove', 'contextmenu']) {
      el.addEventListener(type, (event) => event.stopPropagation());
    }
    el.addEventListener('keydown', (event) => this._key(event));
    el.addEventListener('keyup', (event) => event.stopPropagation());
    el.addEventListener('pointerdown', (event) => this._press(event));
    el.addEventListener('pointermove', (event) => { if (this.el === el && this._gesture && Math.hypot(event.clientX - this._gesture.x, event.clientY - this._gesture.y) > 6) this._gesture.cancelled = true; });
    el.addEventListener('pointercancel', () => { if (this.el === el && this._gesture) this._gesture.cancelled = true; });
    el.addEventListener('pointerup', (event) => { if (this.el === el && this._gesture) this._gesture.released = event.pointerId === this._gesture.pointerId && event.target.closest?.('[data-search-id]') === this._gesture.button; });
    el.addEventListener('click', (event) => this._click(event));
    el.addEventListener('focusin', (event) => {
      const row = this._shown.get(event.target.dataset?.searchId);
      if (this.el === el && row?.button === event.target) this._setActive(row.item.id);
    });
    this.input.addEventListener('input', () => { this._active = null; this.update(); });
    this.update(); if (this.el) this.onOpenChange?.(true);
    if (this.el) this.input.focus({ preventScroll: true }); return this.isOpen;
  }
  update() {
    if (!this.el || this._disposed) return;
    const context = this._read();
    if (!context || context.suspended || context.contextKey !== this._openContext || !this.parent.isConnected) { this.close({ restoreFocus: false }); return; }
    this._context = context;
    this.title.textContent = this._text('title'); this.closeButton.setAttribute('aria-label', this._text('close')); this.closeButton.title = this._text('close');
    this.input.setAttribute('aria-label', this._text('label')); this.input.placeholder = this._text('placeholder'); this.hint.textContent = this._text('hint');
    this.results.setAttribute('aria-label', this._text('title'));
    const terms = normalize(this.input.value.trim()).split(/\s+/u).filter(Boolean);
    const matches = context.items.filter((item) => {
      const search = normalize([item.label, item.subtitle, item.target, ...item.keywords].join(' '));
      return terms.every((term) => search.includes(term));
    });
    const grouped = KINDS.map((kind) => ({ kind, items: matches.filter((item) => item.kind === kind).slice(0, LIMIT) }));
    const rows = grouped.flatMap((group) => group.items), signature = JSON.stringify([localeInfo(context.hass).key, rows]);
    this.status.textContent = !context.items.length ? this._text('empty') : !matches.length ? this._text('noMatch')
      : this._text(rows.length < matches.length ? 'limited' : matches.length === 1 ? 'countOne' : 'count', { count: matches.length, shown: rows.length });
    if (signature === this._rendered) return;
    const focused = this.el.getRootNode().activeElement, focusedId = focused?.dataset?.searchId;
    const previousIdentity = this._shown.get(focusedId)?.identity;
    this._rendered = signature; this._gesture = null; this._shown.clear(); this.results.replaceChildren();
    for (const group of grouped) {
      if (!group.items.length) continue;
      const section = this._node('div', 'search-group'); section.setAttribute('role', 'group');
      const heading = this._node('h3', '', this._text(group.kind)); heading.id = `${this._id}-${group.kind}`; section.setAttribute('aria-labelledby', heading.id); section.append(heading);
      for (const item of group.items) {
        const button = this._node('button', 'search-result'); button.type = 'button'; button.dataset.searchId = item.id; button.id = `${this._id}-result-${this._shown.size}`;
        button.setAttribute('role', 'option'); button.append(this._node('span', 'search-result-label', item.label));
        if (item.subtitle) button.append(this._node('span', 'search-result-detail', item.subtitle));
        this._shown.set(item.id, { item, button, identity: identity(item) }); section.append(button);
      }
      this.results.append(section);
    }
    this._setActive(this._shown.has(this._active) ? this._active : rows[0]?.id);
    if (focusedId && focused && !focused.isConnected) {
      const row = this._shown.get(focusedId); (row?.identity === previousIdentity ? row.button : this.input).focus({ preventScroll: true });
    }
  }
  _setActive(id, scroll = false) {
    this._active = this._shown.has(id) ? id : null;
    for (const [key, row] of this._shown) row.button.setAttribute('aria-selected', String(key === this._active));
    const row = this._shown.get(this._active);
    if (row) { this.input.setAttribute('aria-activedescendant', row.button.id); if (scroll) row.button.scrollIntoView?.({ block: 'nearest' }); }
    else this.input.removeAttribute('aria-activedescendant');
  }
  _key(event) {
    event.stopPropagation(); if (!this.el || event.currentTarget !== this.el || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key === 'Tab') {
      const nodes = [this.closeButton, this.input, ...[...this._shown.values()].map((row) => row.button)];
      const current = this.el.getRootNode().activeElement, index = nodes.indexOf(current);
      if (event.shiftKey && index === 0 || !event.shiftKey && index === nodes.length - 1) { event.preventDefault(); nodes[event.shiftKey ? nodes.length - 1 : 0].focus(); }
      return;
    }
    if (event.target === this.closeButton) return;
    const ids = [...this._shown.keys()], id = event.target.dataset?.searchId || this._active, index = ids.indexOf(id);
    if (['ArrowDown', 'ArrowUp'].includes(event.key) || event.target !== this.input && ['Home', 'End'].includes(event.key)) {
      event.preventDefault(); if (!ids.length) return;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length;
      this._setActive(ids[next], true); if (event.target !== this.input) this._shown.get(ids[next]).button.focus({ preventScroll: true });
    } else if (event.key === 'Enter' || event.key === ' ' && event.target !== this.input) {
      event.preventDefault(); if (!event.repeat) this._activate(this._shown.get(id));
    }
  }
  _press(event) {
    if (!this.el || event.currentTarget !== this.el) return;
    const button = event.target.closest?.('[data-search-id]'), row = this._shown.get(button?.dataset.searchId);
    this._gesture = row && row.button === button && (event.button === undefined || event.button === 0) && event.isPrimary !== false
      ? { button, identity: row.identity, contextKey: this._openContext, pointerId: event.pointerId, x: event.clientX, y: event.clientY, released: false, cancelled: false } : null;
  }
  _click(event) {
    if (!this.el || event.currentTarget !== this.el) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target === this.el || this.closeButton.contains(event.target)) { this.close(); return; }
    const button = event.target.closest?.('[data-search-id]'), row = this._shown.get(button?.dataset.searchId);
    if (!row || row.button !== button || !this.el.contains(button)) return;
    const gesture = this._gesture; this._gesture = null;
    if (gesture ? gesture.cancelled || !gesture.released || gesture.button !== button || gesture.identity !== row.identity || gesture.contextKey !== this._openContext : event.detail > 0) return;
    this._activate(row);
  }
  _activate(row) {
    if (!this.el || !row || this._shown.get(row.item.id) !== row) return false;
    const context = this._read();
    if (!context || context.suspended || context.contextKey !== this._openContext) { this.close({ restoreFocus: false }); return false; }
    const current = context.items.find((item) => item.id === row.item.id);
    if (!current || identity(current) !== row.identity) { this.update(); if (this.el) this.status.textContent = this._text('missing'); return false; }
    const opener = this._opener, contextKey = context.contextKey;
    this.close({ restoreFocus: false }); const version = this._version;
    const fresh = this._read(), selected = fresh?.items.find((item) => item.id === current.id);
    if (!fresh || fresh.suspended || fresh.contextKey !== contextKey || !selected || identity(selected) !== row.identity) return false;
    const failed = () => {
      if (this._version === version && this._read()?.contextKey === contextKey && this.open(opener)) this.status.textContent = this._text('failed');
    };
    try { const result = this.onSelect(selected); if (result?.then) Promise.resolve(result).catch(failed); }
    catch { failed(); return false; }
    return true;
  }
  close({ restoreFocus = true } = {}) {
    if (!this.el) return;
    const focused = this.el.getRootNode().activeElement, ownedFocus = focused && this.el.contains(focused);
    const current = this._read(), opener = this._opener;
    const restore = restoreFocus && ownedFocus && current && !current.suspended && current.contextKey === this._openContext;
    this.el.remove(); this.el = null; this._rendered = null; this._gesture = null; this._shown.clear(); this._active = null; this._version++;
    this.onOpenChange?.(false);
    if (restore && opener?.isConnected && !opener.disabled && !opener.closest?.('[hidden],[inert]')) opener.focus?.({ preventScroll: true });
  }
  dispose() { this.close({ restoreFocus: false }); this._disposed = true; this.getContext = null; this.onSelect = null; this.onOpenChange = null; }
}
