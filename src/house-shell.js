// Future stage composition. Root retains camera/render/resize observation,
// popup lifecycle and actual category actions; this module creates no timer/RAF.
import { HouseHeader } from './house-header.js';
import { buildHouseSummary } from './house-summary.js';
import { HouseNavigation, localizeHouseNavigationItems, HOUSE_NAVIGATION_LIMITS } from './house-navigation.js';
import { planHouseShell, HOUSE_SHELL_LIMITS } from './house-shell-layout.js';
import { TAYLORS3D_THEME_CSS } from './taylors3d-theme.js';

const schemes = new Set(['ha', 'dark', 'light']);
const stamp = (value) => { try { return JSON.stringify(value); } catch { return 'invalid'; } };
const pixels = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e6;
const sameAttribute = (node, key, value) => node.getAttribute(key) === value;

/** HouseShell(card,{onSelect,onNeedsResize}). card supplies actual _stage,
 * _toolbar and _scene DOM nodes; _devicePopup.el is the current DevicePopup only.
 * setData({enabled,scheme,summaryRaw,selected,navItems,editing}) reads current HA
 * summary sources. measure({baseHeight}) requires the configured finite height,
 * not this module's previously expanded stage height. Root calls before its View
 * resize, and observes header/nav/toolbar/popup changes through onNeedsResize.
 * Six --taylors3d-* reserves plus min-height belong to this shell while enabled.
 * Off/dispose restores prior attributes/styles, preserving a later foreign write.
 * No renderer, camera, controls placement method or HA service is called here.
 */
export class HouseShell {
  constructor(card, { onSelect, onNeedsResize } = {}) {
    this.card = card; this.onSelect = onSelect; this.onNeedsResize = onNeedsResize;
    this.enabled = false; this.editing = false; this.disposed = false; this.scheme = 'ha';
    this._attributes = new Map(); this._styles = new Map(); this._generation = 0; this._resizeQueued = false;
    this._lastPresentation = null; this._lastPlan = null; this._sessionKey = null; this._stage = null; this._popup = null;
    this.header = null; this.navigation = null; this.style = null; this._miniMap = null;
  }
  _session() {
    const hass = this.card._hass, user = hass?.user;
    return { ready: this.card.isConnected === true && hass?.connection?.connected === true
      && typeof user?.id === 'string' && !!user.id.trim() && (!Object.hasOwn(user, 'is_active') || user.is_active === true),
      connection: hass?.connection, auth: hass?.auth, key: stamp([user?.id, user?.is_admin, user?.is_active, user?.permissions,
        this.card.isConnected, hass?.connection?.connected]) };
  }
  _sameSession(a, b) { return !!a && !!b && a.connection === b.connection && a.auth === b.auth && a.key === b.key; }
  _suspendedItems(items) {
    if (!Array.isArray(items) || items.length > HOUSE_NAVIGATION_LIMITS.items) return items;
    return items.map((item) => {
      try {
        if (!item || typeof item !== 'object' || ['hidden', 'disabled'].some((key) => Object.hasOwn(item, key) && typeof item[key] !== 'boolean')) return item;
        return { ...item, disabled: true };
      } catch { return null; } // Let the navigation reader diagnose the invalid item.
    });
  }
  _attribute(node, key, value) {
    let records = this._attributes.get(node); if (!records) this._attributes.set(node, records = new Map());
    if (!records.has(key)) records.set(key, { had: node.hasAttribute(key), value: node.getAttribute(key), last: value });
    records.get(key).last = value;
    if (!sameAttribute(node, key, value)) { if (value === null) node.removeAttribute(key); else node.setAttribute(key, value); }
  }
  _property(node, key, value) {
    let records = this._styles.get(node); if (!records) this._styles.set(node, records = new Map());
    if (!records.has(key)) records.set(key, { value: node.style.getPropertyValue(key), priority: node.style.getPropertyPriority(key), last: value });
    if (node.style.getPropertyValue(key) !== value || node.style.getPropertyPriority(key)) {
      if (value === '') node.style.removeProperty(key); else node.style.setProperty(key, value);
    }
    // Chromium may serialise fractional CSS pixels to fewer decimals. Record
    // the actual owned CSSOM value so normalisation is not mistaken for a
    // foreign edit when leaving House mode.
    records.get(key).last = node.style.getPropertyValue(key);
  }
  _restore(node) {
    for (const [key, record] of this._attributes.get(node) || []) if (sameAttribute(node, key, record.last)) {
      if (record.had) node.setAttribute(key, record.value); else node.removeAttribute(key);
    }
    for (const [key, record] of this._styles.get(node) || []) if (node.style.getPropertyValue(key) === record.last && !node.style.getPropertyPriority(key)) {
      if (record.value) node.style.setProperty(key, record.value, record.priority); else node.style.removeProperty(key);
    }
    this._attributes.delete(node); this._styles.delete(node);
  }
  _restoreAll() { for (const node of new Set([...this._attributes.keys(), ...this._styles.keys()])) this._restore(node); }
  _ensureNodes() {
    const stage = this.card._stage;
    if (!stage?.ownerDocument || !this.card?.setAttribute) return false;
    if (this._stage && this._stage !== stage) { this._disable(); this.header?.dispose(); this.navigation?.dispose(); this.header = null; this.navigation = null; this.style = null; }
    this._stage = stage;
    if (!this.header) {
      this.header = new HouseHeader(stage);
      this.navigation = new HouseNavigation(stage, { onSelect: (action, item) => {
        const size = this._dimensions(this._stage);
        if (this.enabled && !this.editing && !this.disposed && this._session().ready && size.width > 0 && size.height > 0) this.onSelect?.(action, item);
      } });
      this.style = stage.ownerDocument.createElement('style'); this.style.dataset.taylors3dHouseShellStyle = ''; this.style.textContent = TAYLORS3D_THEME_CSS;
    }
    const tree = stage.getRootNode(), styleRoot = this.card.shadowRoot || (tree?.host ? tree : stage);
    if (!this.style.isConnected) (styleRoot?.append ? styleRoot : stage).append(this.style);
    if (this.header.element.parentNode !== stage) stage.append(this.header.element);
    if (this.navigation.element.parentNode !== stage) stage.append(this.navigation.element);
    return true;
  }
  _requestResize() {
    if (this.disposed || this._resizeQueued || typeof this.onNeedsResize !== 'function') return;
    this._resizeQueued = true; const generation = this._generation;
    queueMicrotask(() => {
      if (generation !== this._generation || this.disposed) return;
      this._resizeQueued = false; this.onNeedsResize();
    });
  }
  _disable() {
    this._generation++; this._resizeQueued = false; this.enabled = false;
    if (this.navigation) {
      this.navigation.update({ items: this._suspendedItems(this._navItems) }); this.navigation.element.hidden = true;
    }
    this._restoreAll(); this.header?.element.remove(); this.navigation?.element.remove(); this.style?.remove();
    this._popup = null; this._miniMap = null; this._lastPlan = null; this._lastPresentation = null; this._sessionKey = null;
  }
  setData({ enabled = false, scheme = 'ha', summaryRaw, selected = 'house', navItems = localizeHouseNavigationItems(this.card._hass), editing = false } = {}) {
    if (this.disposed) return { valid: false, diagnostics: [{ code: 'disposed', message: 'House layout has been disposed.' }] };
    const diagnostics = [];
    if (typeof enabled !== 'boolean' || typeof editing !== 'boolean') diagnostics.push({ code: 'flags', message: 'House layout needs explicit enabled/editing booleans.' });
    if (!schemes.has(scheme)) diagnostics.push({ code: 'scheme', message: 'Use Home Assistant, dark or light colours.' });
    if (enabled !== true || diagnostics.length) { if (this.enabled) { this._disable(); this._requestResize(); } return { valid: !diagnostics.length, diagnostics }; }
    if (!this._ensureNodes()) { if (this.enabled) { this._disable(); this._requestResize(); }
      return { valid: false, diagnostics: [{ code: 'stage', message: 'House layout needs the actual card stage and host.' }] }; }
    this.enabled = true; this.editing = editing; this.scheme = scheme;
    this._attribute(this.card, 'data-taylors3d-theme', 'house'); this._attribute(this.card, 'data-taylors3d-scheme', scheme === 'ha' ? null : scheme);
    this._attribute(this._stage, 'data-taylors3d-shell', 'adaptive');
    this.header.update(buildHouseSummary(this.card._hass, summaryRaw), this.card._hass);
    this.header.element.hidden = editing;
    const session = this._session(), suspended = editing || !session.ready || typeof this.onSelect !== 'function';
    const disabledItems = () => this._suspendedItems(navItems);
    // An observed account/session change permanently interrupts a held gesture,
    // even if the same categories are immediately available for the new user.
    if (this._sessionKey && !this._sameSession(this._sessionKey, session)) this.navigation.update({ selected, items: disabledItems(), hass: this.card._hass });
    const navResult = this.navigation.update({ selected, items: suspended ? disabledItems() : navItems, hass: this.card._hass }); this._sessionKey = session; this._navItems = navItems;
    this.navigation.element.hidden = editing || this.navigation.element.hidden;
    const key = stamp([editing, scheme, this.header.element.textContent,
      [...this.navigation.items.children].filter((node) => !node.hidden).map((node) => node.textContent)]);
    if (key !== this._lastPresentation) { this._lastPresentation = key; this._requestResize(); }
    return { valid: navResult.valid, diagnostics: navResult.diagnostics };
  }
  _dimensions(node) {
    if (!node?.isConnected || node.hidden || node.closest('[hidden]') || node.ownerDocument.defaultView?.getComputedStyle(node).display === 'none') return { width: 0, height: 0 };
    const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height };
  }
  _currentPopup() {
    const node = Object.hasOwn(this.card, '_devicePopup') ? this.card._devicePopup?.el : this._stage?.querySelector('.taylors3d-device-popup');
    return node?.classList?.contains('taylors3d-device-popup') && this._stage?.contains(node) ? node : null;
  }
  measure({ baseHeight } = {}) {
    if (this.disposed) return { valid: false, mode: 'disposed', scene: null, diagnostics: [] };
    if (!this.enabled) {
      const stage = this.card._stage?.getBoundingClientRect(), scene = this.card._scene?.getBoundingClientRect();
      return { valid: !!stage && !!scene, mode: 'disabled', scene: stage && scene ? { x: scene.left - stage.left, y: scene.top - stage.top, width: scene.width, height: scene.height } : null, diagnostics: [] };
    }
    const width = this._stage.getBoundingClientRect().width;
    if (!pixels(width) || !pixels(baseHeight)) return { valid: false, mode: 'hidden', scene: null,
      diagnostics: [{ code: 'measurements', message: 'House layout needs actual finite stage width and configured base height in pixels.' }] };
    const mode = this.editing ? 'editor' : width >= HOUSE_SHELL_LIMITS.railAt ? 'rail' : 'bottom';
    this._attribute(this._stage, 'data-taylors3d-shell-mode', mode);
    this._attribute(this._stage, 'data-taylors3d-shell-size', width < HOUSE_SHELL_LIMITS.sheetBelow ? 'compact' : 'comfortable');
    this.navigation.setLayout(mode === 'rail' ? 'rail' : 'bottom', width);
    const popup = this._currentPopup(); if (this._popup && this._popup !== popup) this._restore(this._popup); this._popup = popup;
    if (popup) { this._attribute(popup, 'data-taylors3d-controls', 'adaptive');
      this._attribute(popup, 'data-house-controls-layout', this.editing ? 'hidden' : width < HOUSE_SHELL_LIMITS.sheetBelow ? 'sheet' : 'right');
      this._property(popup, 'left', ''); this._property(popup, 'top', ''); }
    let controlSize = this.editing ? { width: 0, height: 0 } : this._dimensions(popup);
    let controlsOpen = controlSize.width > 0 && controlSize.height > 0;
    // Horizontal reserves alter wrapping. Apply these before measuring the real
    // toolbar/header, then finish the complete vertical plan in this same call.
    const horizontal = planHouseShell({ width, height: baseHeight, controlsWidth: controlSize.width, controlsHeight: controlSize.height, controlsOpen, editing: this.editing });
    if (!horizontal.valid) return horizontal;
    this._property(this._stage, '--taylors3d-rail-width', `${horizontal.railReserve}px`);
    this._property(this._stage, '--taylors3d-controls-width', `${horizontal.controlsReserve}px`);
    const readings = { width, height: baseHeight, summaryHeight: this._dimensions(this.header.element).height,
      toolbarHeight: this._dimensions(this.card._toolbar).height, navigationHeight: this._dimensions(this.navigation.element).height,
      editing: this.editing };
    const withoutControls = planHouseShell(readings); if (!withoutControls.valid) return withoutControls;
    // Use configured stage space after actual header/dock wrapping, never the
    // previously expanded stage height. Update a closed controller as well so
    // reopening after a phone/desktop resize cannot reuse old wide geometry.
    this.card._devicePopup?.updateRoomSheetGeometry?.({ width, baseHeight,
      availableHeight:withoutControls.scene.height });
    controlSize = this.editing ? { width: 0, height: 0 } : this._dimensions(popup);
    controlsOpen = controlSize.width > 0 && controlSize.height > 0;
    const plan = planHouseShell({ ...readings,controlsWidth:controlSize.width,controlsHeight:controlSize.height,controlsOpen });
    if (!plan.valid) return plan;
    this._attribute(this._stage, 'data-taylors3d-shell-mode', plan.mode);
    for (const [property, field] of Object.entries({ 'summary-height': 'summaryReserve', 'navigation-height': 'navigationReserve', 'bar-height': 'toolbarReserve', 'sheet-height': 'sheetReserve' }))
      this._property(this._stage, `--taylors3d-${property}`, `${plan[field]}px`);
    this._property(this._stage, 'min-height', `${plan.stageHeight}px`);
    const miniMap = this.card._miniMap?.el;
    const currentMiniMap = miniMap?.classList?.contains('taylors3d-minimap') && this._stage.contains(miniMap) ? miniMap : null;
    if (this._miniMap && this._miniMap !== currentMiniMap) this._restore(this._miniMap);
    this._miniMap = currentMiniMap;
    if (currentMiniMap) {
      this._property(currentMiniMap, 'top', 'calc(var(--taylors3d-summary-height, 0px) + 12px)');
      if (this.card._config?.mini_map_position === 'top-left')
        this._property(currentMiniMap, 'left', 'calc(var(--taylors3d-rail-width, 0px) + 12px)');
      else this._property(currentMiniMap, 'right', 'calc(var(--taylors3d-controls-width, 0px) + 12px)');
    }
    const key = stamp(plan); if (key !== this._lastPlan) { this._lastPlan = key; this._requestResize(); }
    return plan;
  }
  dispose() {
    if (this.disposed) return; this._disable(); this.header?.dispose(); this.navigation?.dispose(); this.disposed = true;
    this.header = null; this.navigation = null; this.style = null;
  }
}
