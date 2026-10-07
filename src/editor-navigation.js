// Small editor sections and an actionable setup guide. No rendering engine,
// inferred entity links, automatic device commands or independent save route.
import { localeInfo, localize } from './localization.js';
import messages from './translations/editor-navigation.js';
import { readCustomControls, customControlAvailability } from './custom-controls.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const tabs = [['rooms', 'Rooms'], ['devices', 'Devices'], ['objects', 'Objects'], ['overlays', 'Overlays'], ['cameras', 'Cameras'], ['tracking', 'Tracking'], ['security', 'Security'], ['environment', 'Environment'], ['scenes', 'Scenes'], ['idle', 'Idle'], ['mower', 'Mower'], ['views', 'Views'], ['controls', 'Buttons and bars'], ['model', 'Model'], ['furniture', 'Furniture'], ['house', 'House'], ['data', 'Data']];
export const EDITOR_GROUPS = Object.freeze([
  { id: 'house', tabs: ['rooms', 'model'], advanced: [] },
  { id: 'devices', tabs: ['devices', 'objects'], advanced: ['cameras', 'tracking', 'security', 'mower'] },
  { id: 'controls', tabs: ['controls', 'views', 'scenes'], advanced: [] },
  { id: 'appearance', tabs: ['house', 'furniture'], advanced: ['overlays', 'environment', 'idle'] },
  { id: 'data', tabs: ['data'], advanced: [] },
].map((group) => Object.freeze({ ...group, tabs: Object.freeze(group.tabs), advanced: Object.freeze(group.advanced) })));
export const editorGroupForTab = (tab) => EDITOR_GROUPS.find((group) => [...group.tabs, ...group.advanced].includes(tab)) || null;
export const editorTabs = ({ hasObjects = false, houseStyle = false } = {}) => tabs.filter(([id]) => (id !== 'objects' || hasObjects) && (id !== 'house' || houseStyle));
const own = (value, key) => {
  try { const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : null; return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined; } catch { return undefined; }
};

export function setupProgress(card) {
  const layout = card._layout || {}, hass = card._hass || {}, floors = Array.isArray(card._floors) ? card._floors : [];
  const floorValid = (id) => floors.filter((floor) => floor?.id === id && !floor.stale && Number.isFinite(floor.elevation)).length === 1;
  const areaValid = (id) => typeof id === 'string' && !!id && !!own(hass.areas, id);
  const rooms = Array.isArray(card._roomList) ? card._roomList : [];
  const bindings = card.modelBindings?.(), modelRooms = new Map();
  for (const source of Array.isArray(bindings?.manifest?.rooms) ? bindings.manifest.rooms : []) {
    if (source && typeof source.id === 'string') modelRooms.set(source.id, modelRooms.has(source.id) ? null : source);
  }
  const deliberateModelLinks = (room, floor) => {
    if (room.fromModel !== true) return true;
    const source = modelRooms.get(room.modelId), area = own(bindings?.rooms, room.modelId), level = source && own(bindings?.levels, source.level);
    return !!source && area?.auto === false && !area.stale && area.area === room.area_id
      && level?.auto === false && !level.stale && level.floor === floor && level.show !== 'hidden';
  };
  const linked = rooms.filter((entry) => {
    const room = entry?.room, floor = entry?.floorId ?? room?.floor_id;
    return room && typeof room.id === 'string' && !!room.id && !room.stale && areaValid(room.area_id) && floorValid(floor)
      && deliberateModelLinks(room, floor)
      && Array.isArray(room.polygon) && room.polygon.length >= 3 && room.polygon.every((point) => Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite));
  });
  // Do not substitute raw saved outlines for the actual resolved room list.
  // It is the same current floor/area evidence that device placement uses.
  const controls = readCustomControls(Object.hasOwn(layout, 'custom_controls') ? own(layout, 'custom_controls') : own(card._config, 'custom_controls'));
  const buttonCount = controls.bars.reduce((count, bar) => count + (bar.placement === 'room' && !linked.some((entry) => entry.room.id === bar.room_id) ? 0
    : bar.buttons.filter((button) => customControlAvailability({ hass, action: button.action, views: card._views || [] }).available).length), 0);
  const placed = card._positions instanceof Map ? [...card._positions.keys()].filter((id) => (card._markers || []).some((marker) => marker.id === id)).length : 0;
  const bound = card._bindings instanceof Map ? [...card._bindings.values()].filter((binding) => binding?.entity && !binding.missing && !binding.filtered && !!own(hass.states, binding.entity)).length : 0;
  return { modelReady: !!card._view?.model && card._loading !== true && !card._customControlsModelLoad,
    modelConfigured: !!(card._config?.model || layout.model?.version), roomCount: linked.length, roomsReady: linked.length > 0,
    controlsReady: buttonCount + placed + bound > 0, buttonCount, placed, bound, hasAreas: Object.keys(hass.areas || {}).length > 0 };
}

export const EDITOR_NAVIGATION_STYLES = `
  .panel .editor-nav { flex:none; min-width:0; padding:10px 12px 8px; border-bottom:1px solid var(--divider-color,rgba(127,127,127,.25)); }
  .panel .editor-nav-heading { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:4px 8px; }
  .panel .editor-nav-heading h3 { font-size:16px; font-weight:600; margin:0; color:var(--primary-text-color); }
  .panel .editor-nav-heading .editor-group-picker { display:none; box-sizing:border-box; min-height:44px; min-width:0; flex:1; font:inherit; color:var(--primary-text-color); }
  .panel .editor-nav button { min-height:44px; white-space:normal; overflow-wrap:anywhere; }
  .panel .editor-groups { display:flex; gap:4px; flex-wrap:wrap; margin-top:8px; }
  .panel .editor-groups button { flex:1 1 72px; min-width:0; padding:8px 6px; border-radius:12px; font-weight:500; }
  .panel .editor-groups button[aria-pressed="true"] { color:var(--text-primary-color,#fff); background:var(--primary-color,#007d75); border-color:var(--primary-color,#007d75); }
  .panel :is(.editor-nav,.editor-advanced) .tabs { display:flex; flex-wrap:wrap; border-bottom:none; margin-top:5px; }
  .panel :is(.editor-nav,.editor-advanced) .tabs [hidden] { display:none !important; }
  .panel :is(.editor-nav,.editor-advanced) .tabs button { flex:1 1 88px; min-width:0; border-radius:8px; padding:7px 8px; line-height:1.35; }
  .panel :is(.editor-nav,.editor-advanced) .tabs button.on { background:var(--secondary-background-color,rgba(127,127,127,.08)); color:var(--primary-text-color); border-bottom-color:var(--primary-color); }
  .panel .editor-advanced { margin:0 0 10px; }
  .panel .editor-advanced summary { min-height:44px; display:flex; align-items:center; cursor:pointer; color:var(--primary-text-color); }
  .panel .editor-advanced summary::before { content:'▸'; margin-right:8px; }
  .panel .editor-advanced[open] summary::before { content:'▾'; }
  .panel .editor-advanced[hidden] { display:none; }
  .panel .editor-setup { border-bottom:1px solid var(--divider-color,rgba(127,127,127,.25)); padding:8px 0 12px; margin-bottom:12px; }
  .panel .editor-setup h3 { font-size:16px; font-weight:600; }
  .panel .editor-setup-steps { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px; margin:8px 0; }
  .panel .editor-setup-steps button { display:flex; flex-direction:column; align-items:center; gap:3px; min-height:58px; padding:5px 3px; min-width:0; font-size:11px; line-height:1.25; overflow-wrap:anywhere; border-radius:10px; }
  .panel .editor-setup-steps button[aria-current="step"] { border:2px solid var(--primary-color); color:var(--primary-text-color); }
  .panel .editor-setup-steps .step-number { display:flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:var(--secondary-background-color,rgba(127,127,127,.1)); font-size:12px; font-weight:600; }
  .panel .editor-setup .row { flex-wrap:wrap; }
  .panel .editor-setup a { display:inline-flex; align-items:center; min-height:44px; color:var(--primary-text-color); text-decoration:underline; }
  .panel :is(.editor-nav,.editor-advanced) :is(button,summary):focus-visible, .panel .editor-setup :is(button,a):focus-visible { outline:3px solid var(--primary-color); outline-offset:2px; }
  .panel .editor-setup button:disabled { opacity:1; color:var(--secondary-text-color); border-style:dashed; }
  .panel [data-setup-upload] { box-sizing:border-box; min-height:44px; display:inline-flex; align-items:center; cursor:pointer; }
  .panel [data-setup-upload]:focus-visible { outline:3px solid var(--primary-color); outline-offset:2px; }
  @container (max-width:640px) {
    .panel .editor-nav-heading h3, .panel .editor-groups { display:none; }
    .panel .editor-nav-heading .editor-group-picker { display:block; }
    .panel .editor-nav-heading > button { flex:1; min-width:0; }
  }
`;

export class EditorNavigation {
  constructor(edit) {
    this.edit = edit; this.group = 'house'; this.advanced = new Set(); this.wizard = false; this.step = 0;
    this.skippedModel = false; this.skippedControls = false; this.saveBusy = false; this.notice = ''; this._epoch = 0; this._context = null;
    this._held = new WeakMap(); this._poisoned = new WeakSet();
  }
  get card() { return this.edit.card; }
  text(key, params = {}) { const language = localeInfo(this.edit.hass).resolved, name = `edit.navigation.${key}`;
    return localize(this.edit.hass, name, params, messages[language]?.[name] ?? messages.en[name] ?? key); }
  t(key, params) { return esc(this.text(key, params)); }
  canEdit() {
    const card = this.card, user = card._hass?.user;
    return card.isConnected === true && card._editing === true && card._loading !== true && !card._customControlsModelLoad && !!card._layout && card._hass?.connection?.connected === true
      && typeof user?.id === 'string' && !!user.id.trim() && user.is_admin === true && (!Object.hasOwn(user, 'is_active') || user.is_active === true);
  }
  context() {
    const card = this.card, hass = card._hass || {}, user = hass.user;
    return [card._config?.layout_key, card._config, card._view, card._view?.model?.root, card._config?.model, card._layout?.model?.version,
      hass.connection, hass.connection?.connected, hass.auth, user?.id, user?.is_admin, user?.is_active, user?.permissions,
      hass.areas, hass.floors, card._editing, card.isConnected, card._loading, !!card._customControlsModelLoad, this.edit._generation];
  }
  observe() {
    const context = this.context();
    if (this._context && context.some((value, index) => value !== this._context[index])) { this._epoch++; this.saveBusy = false; }
    this._context = context;
  }
  cancel() { this._epoch++; this._context = null; this._saveAttempt = null; this.saveBusy = false; this.wizard = false; this.notice = ''; if (this.edit.tab === 'setup') this.edit.tab = 'rooms'; }
  enter() {
    this.observe();
    const card = this.card, layout = card._layout || {}, empty = !card._config?.model && !layout.model?.version
      && !(layout.rooms || []).length && !readCustomControls(own(layout, 'custom_controls')).bars.length;
    if (empty && !own(own(layout, 'ui_setup'), 'complete') && this.canEdit()) this.start();
  }
  reveal(tab) { const group = editorGroupForTab(tab); if (!group) return false; this.group = group.id; if (group.advanced.includes(tab)) this.advanced.add(group.id); return true; }
  start() {
    if (!this.canEdit()) return false;
    if (this.draftsOpen()) { this.notice = 'drafts'; this.edit.message = { text: this.text('drafts'), warn: true }; this.edit.render(); return false; }
    this.wizard = true; this.notice = ''; this.observe();
    const progress = setupProgress(this.card); this.step = !progress.modelReady && !this.skippedModel ? 0 : !progress.roomsReady ? 1 : !progress.controlsReady && !this.skippedControls ? 2 : 3;
    this.chooseStep(this.step); return true;
  }
  chooseStep(step) {
    if (!this.canEdit() || !Number.isInteger(step) || step < 0 || step > 3 || this.saveBusy) return false;
    if (step !== this.step && this.draftsOpen()) { this.notice = 'drafts'; this.edit.render(); return false; }
    this.wizard = true; this.step = step; this.notice = '';
    const tab = step === 0 ? 'model' : step === 1 ? this.card._view?.model && this.card.modelBindings()?.manifest?.rooms?.length ? 'model' : 'rooms' : step === 2 ? 'controls' : 'setup';
    if (tab === 'setup') { this.edit.revealTab('controls', { guided: true }); this.edit.tab = 'setup'; this.edit.render(); }
    else this.edit.revealTab(tab, { guided: true });
    return true;
  }
  draftsOpen() {
    return ['_customControlsEditor', '_roomActionsEditor', '_cameraEditor', '_trackingEditor', '_weatherEditor', '_securityEditor', '_modelRenderingEditor',
      '_scenePreviewEditor', '_ambientIdleEditor', '_houseSummaryEditor', '_wallPresentationEditor', '_floorPresentationEditor', '_furnitureEditor']
      .some((name) => this.edit[name]?.dirty === true);
  }
  snapshot() {
    const progress = setupProgress(this.card);
    return { ...progress, step: this.step, wizard: this.wizard, saveBusy: this.saveBusy, canEdit: this.canEdit(), draftsOpen: this.draftsOpen(),
      canFinish: this.canEdit() && (progress.modelReady || this.skippedModel) && progress.roomsReady && (progress.controlsReady || this.skippedControls) && !this.draftsOpen() && !this.saveBusy };
  }
  token() { this.observe(); return { epoch: this._epoch, context: this.context(), layout: this.card._layout, next: null }; }
  current(token) {
    this.observe(); const state = this.snapshot();
    return !!token && this.canEdit() && this.wizard && this.step === 3 && this._epoch === token.epoch
      && token.context.every((value, index) => value === this.context()[index]) && [token.layout, token.next].includes(this.card._layout)
      && (state.modelReady || this.skippedModel) && state.roomsReady && (state.controlsReady || this.skippedControls) && !state.draftsOpen;
  }
  press(button) { if (!button?.dataset?.act?.startsWith('setup-') && !button?.dataset?.act?.startsWith('editor-')) return;
    this.observe(); this._held.set(button, { epoch: this._epoch, context: this.context(), layout: this.card._layout }); this._poisoned.delete(button); }
  cancelPress(button) { if (button && this._held.has(button)) this._poisoned.add(button); }
  allowed(button) {
    this.observe(); const held = this._held.get(button);
    if (this._poisoned.has(button)) return false;
    if (held && (held.layout !== this.card._layout || held.epoch !== this._epoch || held.context.some((value, index) => value !== this.context()[index]))) { this._poisoned.add(button); return false; }
    this._held.delete(button); return true;
  }
  async save() {
    if (!this.snapshot().canFinish || typeof this.card.completeSetup !== 'function') return false;
    const token = this.token(), previous = own(this.card._layout, 'ui_setup');
    const extras = previous && [Object.prototype, null].includes(Object.getPrototypeOf(previous)) ? Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(previous))
      .filter(([, descriptor]) => Object.hasOwn(descriptor, 'value')).map(([key, descriptor]) => [key, descriptor.value])) : {};
    const next = { ...this.card._layout, ui_setup: { ...extras, version: 1, complete: true, mode: setupProgress(this.card).modelReady ? 'model' : 'drawn',
      controls: setupProgress(this.card).controlsReady ? 'configured' : 'later' } };
    token.next = next; this._saveAttempt = token; this.saveBusy = true; this.notice = ''; this.edit.render();
    let ok = false; try { ok = await this.card.completeSetup(next, token); } catch { /* The actual current context owns the visible error. */ }
    if (!this.current(token)) {
      if (this._saveAttempt === token) { this._saveAttempt = null; this.saveBusy = false; if (this.wizard) { this.notice = 'changed'; this.edit.render(); } }
      return false;
    }
    this._saveAttempt = null; this.saveBusy = false; this.notice = ok ? '' : 'failed'; this.edit.render(); return ok;
  }
  onClick(button) {
    const action = button.dataset.act;
    if (!action.startsWith('editor-') && !action.startsWith('setup-')) return false;
    if (!this.allowed(button)) return true;
    if (action === 'editor-group') {
      this.selectGroup(button.dataset.id); return true;
    }
    if (action === 'setup-edit-existing') { this.wizard = false; this.notice = ''; if (this.edit.tab === 'setup') this.edit.revealTab('rooms'); else this.edit.render(); return true; }
    if (!this.canEdit()) return true;
    if (action === 'setup-start') this.start();
    else if (action === 'setup-step') this.chooseStep(Number(button.dataset.id));
    else if (action === 'setup-back') this.chooseStep(this.step - 1);
    else if (action === 'setup-next') {
      const state = this.snapshot(), ready = this.step === 0 ? state.modelReady || this.skippedModel : this.step === 1 ? state.roomsReady : state.controlsReady || this.skippedControls;
      if (ready && !state.draftsOpen) this.chooseStep(this.step + 1);
    } else if (action === 'setup-draw-instead') { this.skippedModel = true; this.chooseStep(1); }
    else if (action === 'setup-controls-later') { this.skippedControls = true; this.chooseStep(3); }
    else if (action === 'setup-save') void this.save();
    else if (action === 'setup-tab') {
      if (button.dataset.id !== this.edit.tab && this.draftsOpen()) { this.notice = 'drafts'; this.edit.render(); }
      else this.edit.revealTab(button.dataset.id, { guided: true });
    }
    return true;
  }
  selectGroup(id) {
    const group = EDITOR_GROUPS.find((entry) => entry.id === id), available = editorTabs({ hasObjects: this.edit._hasObjects(), houseStyle: this.card._config?.layout_style === 'house' });
    const tab = group?.tabs.find((value) => available.some(([entry]) => entry === value)) || group?.advanced.find((value) => available.some(([entry]) => entry === value));
    return tab ? this.edit.revealTab(tab) : false;
  }
  onChange(field, element) { if (field !== 'editor-group') return false; this.selectGroup(element.value); return true; }
  tabButtons(available, group, advanced) {
    return available.map(([id, label]) => {
      const owner = editorGroupForTab(id), special = owner.advanced.includes(id);
      if (special !== advanced) return '';
      return `<button data-act="tab" data-id="${id}" ${owner.id === group.id ? '' : 'hidden'} aria-pressed="${this.edit.tab === id}" class="${this.edit.tab === id ? 'on' : ''}">${esc(localize(this.edit.hass, `edit.tabs.${id}`, {}, label))}</button>`;
    }).join('');
  }
  renderTabs(available) {
    this.reveal(this.edit.tab); const group = EDITOR_GROUPS.find((entry) => entry.id === this.group) || EDITOR_GROUPS[0];
    return `<style>${EDITOR_NAVIGATION_STYLES}</style><div class="editor-nav" data-editor-navigation>
      <div class="editor-nav-heading"><h3 data-editor-text="title">${this.t('title')}</h3><select class="editor-group-picker" data-field="editor-group" aria-label="${this.t('groups')}">${EDITOR_GROUPS.map((entry) => `<option value="${entry.id}" data-editor-option="${entry.id}" ${group.id === entry.id ? 'selected' : ''}>${this.t(entry.id)}</option>`).join('')}</select><button data-act="setup-start" ${this.canEdit() && !this.saveBusy ? '' : 'disabled'} data-editor-text="continue">${this.t('continue')}</button></div>
      <div class="editor-groups" role="group" aria-label="${this.t('groups')}">${EDITOR_GROUPS.map((entry) => `<button data-act="editor-group" data-id="${entry.id}" aria-pressed="${group.id === entry.id}" data-editor-text="${entry.id}">${this.t(entry.id)}</button>`).join('')}</div>
      <div class="tabs editor-basic-tabs">${this.tabButtons(available, group, false)}</div></div>`;
  }
  renderAdvanced(available) {
    const group = EDITOR_GROUPS.find((entry) => entry.id === this.group) || EDITOR_GROUPS[0];
    return `<details class="editor-advanced" data-editor-advanced data-group="${group.id}" ${this.advanced.has(group.id) ? 'open' : ''} ${group.advanced.length ? '' : 'hidden'}><summary data-editor-text="advanced">${this.t('advanced')}</summary><div class="tabs editor-advanced-tabs">${this.tabButtons(available, group, true)}</div></details>`;
  }
  renderGuide() {
    if (!this.wizard) return '';
    const state = this.snapshot(), ready = [state.modelReady || this.skippedModel, state.roomsReady, state.controlsReady || this.skippedControls, false], names = ['model', 'rooms', 'buttons', 'save'];
    const stepBody = [
      `<p>${this.t('modelHelp')}</p>${state.modelReady ? `<p>${this.t('modelReady')}</p>` : state.modelConfigured ? `<p role="status">${this.t('modelWaiting')}</p>` : ''}<button data-act="setup-draw-instead">${this.t('drawInstead')}</button>`,
      `<p>${this.t('roomsHelp')}</p><p data-setup-room-count>${this.t('roomCount', { count: state.roomCount })}</p>${!state.hasAreas ? `<p>${this.t('noAreas')}</p><a href="/config/areas/dashboard" target="_top">${this.t('openAreas')}</a>` : ''}<div class="row"><button data-act="setup-tab" data-id="rooms">${this.t('drawRooms')}</button>${state.modelReady ? `<button data-act="setup-tab" data-id="model">${this.t('modelLinks')}</button>` : ''}</div>`,
      `<p>${this.t('controlsHelp')}</p>${state.controlsReady ? `<p>${this.t('controlsReady')}</p>` : ''}<div class="row">${[['devices', 'Devices'], ...(this.edit._hasObjects() ? [['objects', 'Objects']] : []), ['controls', 'Buttons and bars']].map(([id, label]) => `<button data-act="setup-tab" data-id="${id}">${esc(localize(this.edit.hass, `edit.tabs.${id}`, {}, label))}</button>`).join('')}<button data-act="setup-controls-later">${this.t('later')}</button></div>`,
      `<p>${this.t('saveHelp')}</p><ul><li>${this.t('model')}: ${this.t(ready[0] ? 'done' : 'needed')}</li><li>${this.t('rooms')}: ${this.t(ready[1] ? 'done' : 'needed')}</li><li>${this.t('buttons')}: ${this.t(ready[2] ? 'done' : 'needed')}</li></ul>${state.draftsOpen ? `<p role="status">${this.t('drafts')}</p>` : ''}<button class="primary" data-act="setup-save" ${state.canFinish ? '' : 'disabled'}>${this.t(this.saveBusy ? 'saving' : 'save')}</button>`,
    ][this.step];
    return `<section class="editor-setup" data-editor-setup><h3>${this.t('setup')}</h3><p data-setup-step>${this.t('step', { number: this.step + 1 })}</p>
      <div class="editor-setup-steps" role="group" aria-label="${this.t('setup')}">${names.map((name, index) => `<button data-act="setup-step" data-id="${index}" ${this.saveBusy ? 'disabled' : ''} ${index === this.step ? 'aria-current="step"' : ''} aria-label="${this.t(name)} · ${this.t(ready[index] ? 'done' : 'needed')}"><span class="step-number" aria-hidden="true">${ready[index] ? '✓' : index + 1}</span><span>${this.t(name)}</span></button>`).join('')}</div>
      ${!state.canEdit ? `<p role="status">${this.t('session')}</p>` : ''}${this.notice ? `<p role="alert">${this.t(this.notice)}</p>` : ''}${stepBody}
      <div class="row">${this.step > 0 ? `<button data-act="setup-back" ${this.saveBusy ? 'disabled' : ''}>${this.t('back')}</button>` : ''}${this.step < 3 ? `<button class="primary" data-act="setup-next" ${ready[this.step] && !state.draftsOpen && state.canEdit ? '' : 'disabled'}>${this.t('next')}</button>` : ''}<button data-act="setup-edit-existing" ${this.saveBusy ? 'disabled' : ''}>${this.t('editExisting')}</button></div></section>`;
  }
  update(root) {
    this.observe();
    for (const node of root.querySelectorAll('[data-editor-text]')) node.textContent = this.text(node.dataset.editorText);
    for (const node of root.querySelectorAll('[data-editor-option]')) node.textContent = this.text(node.dataset.editorOption);
    const start = root.querySelector('[data-act="setup-start"]'); if (start) start.disabled = !this.canEdit() || this.saveBusy;
    const group = root.querySelector('[data-editor-navigation]'); if (group) group.querySelector('.editor-groups')?.setAttribute('aria-label', this.text('groups'));
    group?.querySelector('[data-field="editor-group"]')?.setAttribute('aria-label', this.text('groups'));
    // Guidance is display-only and lives outside feature editors. Updating it
    // keeps their real input/file nodes, focus and drafts connected.
    const old = root.querySelector('[data-editor-setup]');
    if (old && this.wizard) {
      const html = this.renderGuide();
      if (old !== this._guideNode) { this._guideNode = old; this._guideMarkup = html; }
      else if (html !== this._guideMarkup) {
        const active = root.getRootNode().activeElement, focus = old.contains(active) ? [active.dataset.act, active.dataset.id || ''] : null;
        const template = document.createElement('template'); template.innerHTML = html; const next = template.content.firstElementChild;
        old.replaceWith(next); this._guideNode = next; this._guideMarkup = html;
        if (focus) [...next.querySelectorAll('[data-act]')].find((node) => node.dataset.act === focus[0] && (node.dataset.id || '') === focus[1] && !node.disabled)?.focus({ preventScroll: true });
      }
    }
  }
}
