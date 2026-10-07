// Edit mode: side panel (Rooms / Devices / Mower / Views / Model / Data) and the pointer interactions on
// the plan (drawing rooms, dragging corners, adding doors, dragging markers to pin them, hiding model
// parts per view).

import * as E from './editor.js';
import { roomFloorId, LEVEL_SPACING } from './layout.js';
import { pointInPolygon, signedArea } from './placement.js';
import { localize, localeKey, localeInfo } from './localization.js';
import coreCaptions, { markCoreCaptions, updateCoreCaptions } from './translations/editor-core.js';
import { ownedRuntimeDetails, runtimeNoticeText } from './runtime-notices.js';
import { buildMarkers, areaName } from './registry.js';
import { readSource, calibrationError, overlayUrl } from './mower.js';
import { readImagePixels, planToPixel, medianColor } from './mower-image.js';
import { ruleState, setRuleState, nextEyeState, viewTree, pickSelector, nextViewId, unmatchedSelectors, legacyShowRules,
  SECTION_DIRS, sectionDir, sectionPos, sectionAt, sectionRange, zoomToFor } from './views.js';
import { levelsFromFloorMap } from './bindings.js';
import { outlineLoops, pickLoop, rasterGrid, outlineFromGrid } from './outline.js';
import { snapPin, attachOffset, floorAtHeight } from './objects/logic.js';
import { actionTarget } from './objects/popup.js';
import { historyShortcut, isNativeEditing } from './history.js';
import { OverlayEditor } from './overlay-editor.js';
import { CameraEditor } from './camera-editor.js';
import { RoomActionsEditor } from './room-actions-editor.js';
import { CustomControlsEditor } from './custom-controls-editor.js';
import { TrackingEditor } from './tracking-editor.js';
import { WeatherEditor } from './weather-editor.js';
import { SecurityEditor } from './security-editor.js';
import { ModelRenderingEditor } from './model-rendering-editor.js';
import { ScenePreviewEditor } from './scene-preview-editor.js';
import { AmbientIdleEditor } from './ambient-idle-editor.js';
import { WallPresentationEditor } from './wall-presentation-editor.js';
import { FloorPresentationEditor } from './floor-presentation-editor.js';
import { HouseSummaryEditor } from './house-summary-editor.js';
import { FurnitureEditor } from './furniture-editor.js';
import { FurnitureDrag } from './furniture-drag.js';
import { DashboardBackupEditor } from './dashboard-backup-editor.js';
import { entityChoices, registryIssues } from './entity-metadata.js';
import { EditorNavigation, editorTabs } from './editor-navigation.js';

const DENSE_TRIS = 150000;

const CLICK_SLOP_PX = 5;
const SNAP_PX = 10; // snap radius never smaller than this many screen pixels
const DRAFT_SAVES = [['_roomActionsEditor', 'room-actions-save'], ['_customControlsEditor', 'custom-controls-save'],
  ['_cameraEditor', 'cov-save'], ['_trackingEditor', 'trk-save'], ['_weatherEditor', 'env-weather-save'],
  ['_securityEditor', 'sec-save'], ['_modelRenderingEditor', 'model-rendering-save'], ['_scenePreviewEditor', 'scene-preview-save'],
  ['_ambientIdleEditor', 'ambient-idle-save'], ['_houseSummaryEditor', 'house-summary-save'],
  ['_wallPresentationEditor', 'wall-presentation-save'], ['_floorPresentationEditor', 'floor-presentation-save'], ['_furnitureEditor', 'furniture-save']];
const activeEditors = new Set(); // window shortcuts belong to the focused card
const coreNotices = new WeakMap(); // Display metadata never changes the saved/action message contract.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Clipboard API needs a secure context (HA over plain http has none): fall back to a hidden textarea.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
const fmt = (v) => (Math.round(v * 100) / 100).toString();

export class EditMode {
  constructor(card) {
    this.card = card;
    this._generation = 0;
    this._overlayEditor = new OverlayEditor(card, () => this.render());
    this._cameraEditor = new CameraEditor(card, () => this.render());
    this._roomActionsEditor = new RoomActionsEditor(card, () => this.render());
    this._customControlsEditor = new CustomControlsEditor(card, () => this.render());
    this._trackingEditor = new TrackingEditor(card, () => this.render());
    this._weatherEditor = new WeatherEditor(card, () => this.render());
    this._securityEditor = new SecurityEditor(card, () => this.render());
    this._modelRenderingEditor = new ModelRenderingEditor(card, () => this.render());
    this._scenePreviewEditor = new ScenePreviewEditor(card, () => this.render());
    this._ambientIdleEditor = new AmbientIdleEditor(card, () => this.render());
    this._floorPresentationEditor = new FloorPresentationEditor(card, () => this.render());
    this._houseSummaryEditor = new HouseSummaryEditor(card, () => this.render());
    this._dashboardBackupEditor = new DashboardBackupEditor(card, () => this.render());
    this._furnitureEditor = new FurnitureEditor(card, () => this.render());
    this._furnitureDrag = new FurnitureDrag(card, { editor: this._furnitureEditor,
      getLayer: () => card._furnitureLayer,
      onSelect: (id) => {
        const index = this._furnitureEditor.draft?.instances?.findIndex((row) => row?.id === id);
        if (index >= 0 && index !== this._furnitureEditor.selectedIndex) {
          this._furnitureEditor.selectedIndex = index;
          this.render();
        }
      } });
    this._wallPresentationEditor = new WallPresentationEditor(card, () => this.render(), {
      onBeginPick: (pick) => this.beginWallSurfacePick(pick),
      onCancelPick: () => this.beginWallSurfacePick(null),
      onCancelPrepare: () => card.finishWallSelectionPreparation?.(),
    });
    this.tab = 'rooms';
    this._navigation = new EditorNavigation(this);
    this.selectedRoom = null;
    this.selectedMarker = null;
    this.drawing = null; // { areaId, floorId, points, cursor }
    this.picking = null; // { areaId, busy, poly, floorId, note }
    this._outlineCache = new Map();
    this._outlineModel = null;
    this.doorMode = false;
    this.calibrating = null; // { src } waiting for a click on the plan
    this.colorPick = false; // waiting for a click on the mower icon in the map overlay
    this.overlayMove = false;
    this.drag = null;
    this.confirmDelete = false;
    this.saveState = '';
    this.message = null; // { text, error }
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.panel.addEventListener('click', (e) => this._onPanelClick(e));
    this.panel.addEventListener('change', (e) => this._onPanelChange(e));
    this.panel.addEventListener('input', (e) => this._onPanelInput(e));
    this.panel.addEventListener('toggle', (event) => {
      if (!event.target.matches?.('[data-editor-advanced]')) return;
      const group = event.target.dataset.group;
      if (event.target.open) this._navigation.advanced.add(group); else this._navigation.advanced.delete(group);
    }, true);
    // rebuilding the panel under a dragged slider would drop the drag: hold renders until release
    this.panel.addEventListener('pointerdown', (e) => {
      this._navigation.press(e.target.closest?.('[data-act]'));
      if (e.target.type === 'range') { this._sliderKeyboard = false; this._beginSlider(); }
    });
    this._onSliderRelease = () => this._endSlider();
    const sliderKey = (e) => e.target.type === 'range' && /^(Arrow(Left|Right|Up|Down)|Page(Up|Down)|Home|End)$/.test(e.key);
    this.panel.addEventListener('keydown', (e) => {
      if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) this._navigation.press(e.target.closest?.('[data-act]'));
      if (e.key === 'Escape') this._navigation.cancelPress(e.target.closest?.('[data-act]'));
      const upload = e.target.closest?.('[data-setup-upload]');
      if (upload && !e.repeat && (e.key === ' ' || e.key === 'Enter') && upload.getAttribute('aria-disabled') !== 'true') {
        e.preventDefault(); upload.querySelector('input[type="file"]')?.click();
      }
      if (sliderKey(e) && !e.ctrlKey && !e.metaKey && !e.altKey) { this._sliderKeyboard = true; this._beginSlider(); }
    });
    this.panel.addEventListener('keyup', (e) => { if (sliderKey(e)) this._endSlider(); });
    this.panel.addEventListener('pointercancel', (e) => this._navigation.cancelPress(e.target.closest?.('[data-act]')));
    this.panel.addEventListener('change', (e) => { if (e.target.type === 'range' && !this._sliderKeyboard) this._endSlider(); });
    this.panel.addEventListener('focusout', (e) => { this._navigation.cancelPress(e.target.closest?.('[data-act]')); if (e.target.type === 'range') this._endSlider(); });
    this._onKey = (e) => this._onKeyDown(e);
    this._onWinMove = (e) => this._dragMove(e);
    this._onWinUp = (e) => this._dragEnd(e);
    this._handles = new Map();
    this.vwSel = null; // a hidden view chosen in the Views tab (visible views follow the chips)
    this.vwPick = null; // { sel, idx } last part clicked in 3D on the Views tab
    this.vwExpanded = new Set(); // room/zone rows showing their objects
    this.objExpanded = new Set(); // Objects tab: room rows showing their objects (collapsed by default)
    this.objSel = null; // Objects tab: object picked in 3D / its row
    this.menu = null;
    this._onMenuAway = (e) => { if (this.menu && !e.composedPath().includes(this.menu)) this._closeMenu(); };
  }

  get layout() { return this.card._layout; }
  get hass() { return this.card._hass; }
  get view() { return this.card._view; }
  get floors() { return this.card._floors || []; }

  // The floor that "Place", drawing and the door tool work on: the floor shown on its own, the view's
  // single linked floor, else (overview, several or no linked floors) the HA floor of the view's
  // primary level, else the first floor.
  activeFloor() {
    const c = this.card, has = (id) => !!id && this.floors.some((f) => f.id === id);
    if (c._floorOnly && has(c._floor)) return c._floor;
    const st = c._viewState;
    if (st && !st.allFloors && st.floors.length === 1 && has(st.floors[0])) return st.floors[0];
    const prim = st && st.primary && c._levels ? c._levels.levelFloor[st.primary] : null;
    if (has(prim)) return prim;
    if (!st && has(c._floor)) return c._floor;
    return this.floors[0].id;
  }

  floorOf(room) {
    return roomFloorId(room, this.hass, this.floors);
  }

  room(id) {
    return (this.layout.rooms || []).find((r) => r.id === id) || null;
  }

  snapRadius() {
    return Math.max(E.SNAP_RADIUS, SNAP_PX / Math.max(this.view.pixelsPerMetre(), 1e-6));
  }

  enter() {
    this.attach();
    this.view.setStems(true);
    this._navigation.enter();
    this.render();
    this.refreshOverlay();
    this._syncStageClasses();
  }

  // card detached while editing / attached again: window listeners off / on (state kept)
  detach() {
    this._pendingLeave = null; this._pendingReplacement = null;
    this._navigation.cancel();
    this._backupDetached = true;
    this._dashboardBackupEditor.setActive(false);
    this._furnitureDrag.cancel();
    this._cameraEditor.cancel();
    this._roomActionsEditor.reset();
    this._customControlsEditor.reset();
    this._trackingEditor.cancel();
    this._weatherEditor.reset();
    this._securityEditor.reset();
    this._modelRenderingEditor.reset();
    this._scenePreviewEditor.reset();
    this._ambientIdleEditor.reset();
    this._houseSummaryEditor.reset();
    this._wallPresentationEditor.reset(); this._floorPresentationEditor.reset();
    activeEditors.delete(this);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('pointerup', this._onSliderRelease);
    window.removeEventListener('pointercancel', this._onSliderRelease);
    this._endSlider();
    this._endWindowDrag();
    this._closeMenu();
    this._furnitureEditor.reset();
  }

  // Permanent editor replacement only. Detach/reattach keeps the editor usable.
  dispose() {
    this.detach();
    this._dashboardBackupEditor.dispose();
    this._furnitureDrag.dispose(); this._furnitureEditor.dispose();
    this._cameraEditor.dispose();
    this._roomActionsEditor.dispose();
    this._customControlsEditor.dispose();
    this._trackingEditor.dispose();
    this._weatherEditor.dispose();
    this._securityEditor.dispose();
    this._modelRenderingEditor.dispose();
    this._scenePreviewEditor.dispose();
    this._ambientIdleEditor.dispose();
    this._houseSummaryEditor.dispose();
    this._wallPresentationEditor.dispose(); this._floorPresentationEditor.dispose();
  }

  attach() {
    this._backupDetached = false;
    this._dashboardBackupEditor.setActive(this.card._editing === true && this.tab === 'data');
    activeEditors.add(this);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('pointerup', this._onSliderRelease);
    window.addEventListener('pointercancel', this._onSliderRelease);
  }

  exit() {
    this.detach();
    this.drawing = null;
    this.picking = null;
    this.doorMode = false;
    this.calibrating = null;
    this.colorPick = false;
    this.overlayMove = false;
    this.selectedRoom = null;
    this.selectedMarker = null;
    this.modelPick = null;
    this.vwPick = null;
    this.vwSel = null;
    this.pivoting = false;
    this._closeMenu();
    this.view.highlightModelNode(null);
    this.view.setStems(false);
    this.view.setOverlay({});
    this._syncStageClasses();
    this.card._applyMarkerSelection(null);
  }

  // called by the card after every rebuild
  afterUpdate() {
    try { return this._afterUpdate(); } finally { this.card._syncFeedback?.(); }
  }

  _afterUpdate() {
    this._navigation.update(this.panel);
    const positionCommit = this._modelPositionCommit;
    this._modelPositionCommit = null;
    this._syncOwnedLabels();
    this._roomActionsEditor.observe();
    this._customControlsEditor.observe();
    this._dashboardBackupEditor.onStates();
    this._furnitureDrag.update();
    if (this.tab === 'house' && this.card._config?.layout_style !== 'house') {
      this._houseSummaryEditor.reset(); this.tab = 'rooms';
    }
    if (this.selectedRoom && !this.room(this.selectedRoom)) this.selectedRoom = null;
    this.card._applyMarkerSelection(this.selectedMarker);
    this.refreshOverlay();
    const active = this.panel.getRootNode().activeElement;
    if (this.tab === 'controls') {
      this._customControlsEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'rooms' && this.panel.contains(active) && active?.closest?.('[data-room-actions-editor]')) {
      this._roomActionsEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'mower' && this.panel.contains(active) && active?.dataset?.field === 'mower-img-min-pixels') {
      this._syncMowerImageFields();
      return;
    }
    if (this.tab === 'cameras' && this.panel.contains(active) && active?.dataset?.field?.startsWith('cov-')) {
      this._cameraEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'tracking' && this.panel.contains(active) && active?.dataset?.field?.startsWith('trk-')) {
      this._trackingEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'overlays' && this.panel.contains(active)
      && (active?.dataset?.field?.startsWith('ovr-') || active?.dataset?.act?.startsWith('ovr-'))) {
      this._overlayEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'environment' && this.panel.contains(active) && active?.dataset?.field?.startsWith('env-weather-')) {
      this._weatherEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'security' && this.panel.contains(active) && (active?.dataset?.field?.startsWith('sec-') || active?.dataset?.act?.startsWith('sec-'))) {
      this._securityEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'model' && this.panel.contains(active)
      && (active?.dataset?.field?.startsWith('floor-presentation-') || active?.dataset?.act?.startsWith('floor-presentation-'))) {
      this._floorPresentationEditor.updatePreviews(this.panel);
      this._modelRenderingEditor.updatePreviews(this.panel);
      this._wallPresentationEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'model' && this.panel.contains(active)
      && (active?.dataset?.field?.startsWith('wall-presentation-') || active?.dataset?.act?.startsWith('wall-presentation-'))) {
      this._wallPresentationEditor.updatePreviews(this.panel); this._floorPresentationEditor.updatePreviews(this.panel);
      this._modelRenderingEditor.updatePreviews(this.panel);
      this._syncStageClasses();
      return;
    }
    if (this.tab === 'model' && this.panel.contains(active) && active?.dataset?.field?.startsWith('model-rendering-')) {
      this._modelRenderingEditor.updatePreviews(this.panel);
      this._wallPresentationEditor.updatePreviews(this.panel); this._floorPresentationEditor.updatePreviews(this.panel);
      return;
    }
    const retainPositionCommit = this.tab === 'model' && !this._sliding && positionCommit
      && positionCommit.scope === this._modelPositionScope && positionCommit.layout === this.layout
      && positionCommit.hass === this.hass && this._modelPositionAllowed(positionCommit.element);
    if (this.tab === 'model' && (this.panel.contains(active) && active?.dataset?.field?.startsWith('md-position-') || retainPositionCommit)) {
      // Exact numeric values are committed on change. Preserve the typed text
      // while HA readings arrive, including an unfinished decimal or blank.
      this._modelRenderingEditor.updatePreviews(this.panel);
      this._wallPresentationEditor.updatePreviews(this.panel); this._floorPresentationEditor.updatePreviews(this.panel);
      this._syncModelPositionFields(retainPositionCommit);
      return;
    }
    if (this.tab === 'scenes' && this.panel.contains(active)
      && (active?.dataset?.field?.startsWith('scene-preview-') || active?.dataset?.act?.startsWith('scene-preview-'))) {
      this._scenePreviewEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'idle' && this.panel.contains(active)
      && (active?.dataset?.field?.startsWith('ambient-idle-') || active?.dataset?.act?.startsWith('ambient-idle-'))) {
      this._ambientIdleEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'furniture' && this.panel.contains(active)
      && (active?.dataset?.field?.startsWith('furniture-') || active?.dataset?.act?.startsWith('furniture-'))) {
      this._furnitureEditor.updatePreviews(this.panel);
      return;
    }
    if (this.tab === 'house' && this.panel.contains(active)
      && (active?.dataset?.field?.startsWith('house-summary-') || active?.dataset?.act?.startsWith('house-summary-'))) {
      this._houseSummaryEditor.updatePreviews(this.panel);
      return;
    }
    if (this._sliding) this._renderHeld = true;
    else this.render();
  }

  commit(layout) {
    this.card._commit(layout);
  }

  setSaveState(s) {
    this.saveState = s;
    this._navigation.update(this.panel);
    const el = this.panel.querySelector('.save-state');
    if (el) el.textContent = this._saveText();
    else this.render();
    // Root owns the exact save token; this notification only refreshes drafts.
    this.card._syncFeedback?.();
  }

  _beginSlider() {
    if (this._sliding) return;
    this._sliding = true;
    this.card.beginHistory?.('Adjust slider');
    this.updateHistoryState();
  }

  _endSlider() {
    if (!this._sliding) return;
    this._sliding = false;
    this._sliderKeyboard = false;
    this.card.endHistory?.();
    this.updateHistoryState();
    if (this._renderHeld) { this._renderHeld = false; this.render(); }
  }

  _historyBusy() {
    return !!(this.drag || this._sliding || this.drawing || this.picking || this.pivoting || this.uploading);
  }

  // Key changes/reloads discard transient tools before another layout can receive their results.
  cancelHistoryGestures() {
    this._pendingLeave = null; this._pendingReplacement = null;
    this._navigation.cancel();
    this._assetRequest = null;
    this._dashboardBackupEditor.reset();
    this._roomActionsEditor.reset();
    this._customControlsEditor.reset();
    this._furnitureDrag.cancel(); this._furnitureEditor.reset();
    this._generation++;
    // A cancelled drag can leave a transient pose while saved positions are unchanged.
    // Force the next rebuild to restore those saved marker positions.
    this.card._markerRenderKey = null;
    this._sliding = false; this._sliderKeyboard = false; this._renderHeld = false;
    this._endWindowDrag(false);
    this.card._history?.cancel();
    this.drawing = null; this.picking = null; this.calibrating = null;
    this.doorMode = false; this.colorPick = false; this.overlayMove = false; this.pivoting = false;
    this.selectedRoom = null; this.selectedMarker = null; this.vwPick = null; this.vwSel = null; this.modelPick = null;
    this.uploading = null; this._panelNameDraft = null; this._overlayEditor.reset(); this._cameraEditor.reset(); this._trackingEditor.reset(); this._weatherEditor.reset(); this._securityEditor.reset();
    this._modelRenderingEditor.reset();
    this._scenePreviewEditor.reset();
    this._ambientIdleEditor.reset();
    this._houseSummaryEditor.reset();
    this._wallPresentationEditor.reset(); this._floorPresentationEditor.reset();
    this._closeMenu();
    this.view?.setOverlay?.({}); this.view?.highlightModelNode?.(null);
    this.card._applyMarkerSelection?.(null);
    if (this.card._stage && this.view?.setPivotMarker) this._syncStageClasses();
    this.updateHistoryState();
  }

  _sameContext(generation, key) { return this._generation === generation && this.card._config.layout_key === key; }

  // Update button state without rebuilding a focused input or a slider under the pointer.
  updateHistoryState() {
    const history = this.card._history;
    for (const action of ['undo', 'redo']) {
      const button = this.panel.querySelector(`[data-act="history-${action}"]`);
      if (!button) continue;
      button.disabled = this._historyBusy() || !history?.[action === 'undo' ? 'canUndo' : 'canRedo'];
      const label = history?.[action === 'undo' ? 'undoLabel' : 'redoLabel'];
      button.textContent = localize(this.hass, `history.${action}`);
      button.title = label ? localize(this.hass, `history.${action}Named`, { label }) : localize(this.hass, `history.${action}`);
      button.setAttribute('aria-label', button.title);
    }
  }

  _runHistory(action) {
    if (this._historyBusy()) return false;
    const history = this.card._history;
    const method = action === 'undo' ? 'undoEdit' : 'redoEdit';
    if (!history?.[action === 'undo' ? 'canUndo' : 'canRedo'] || typeof this.card[method] !== 'function') return false;
    this._dashboardBackupEditor.reset();
    this._roomActionsEditor.reset();
    this._customControlsEditor.reset();
    this._furnitureDrag.cancel(); this._furnitureEditor.reset();
    this.message = null;
    this.confirmDelete = false;
    this._trackingEditor.reset();
    this._weatherEditor.reset();
    this._securityEditor.reset();
    this._modelRenderingEditor.reset();
    this._scenePreviewEditor.reset();
    this._ambientIdleEditor.reset();
    this._houseSummaryEditor.reset();
    this._wallPresentationEditor.reset(); this._floorPresentationEditor.reset();
    this.card[method]();
    this.updateHistoryState();
    return true;
  }

  // ---------- plan pointer events (from the card's canvas listeners) ----------
  beginWallSurfacePick(pick) {
    this._wallPickContext = pick ? { token: pick.token, generation: this._generation,
      key: this.card._config?.layout_key, modelRoot: this.view?.model?.root,
      view: JSON.stringify([this.card._mode, this.card._floor, this.card._floorOnly, this.card._viewId]) } : null;
    this._down = null;
    if (pick) {
      if (!this.card._editing || this.tab !== 'model' || !this._wallPresentationEditor.canEdit
        || pick.modelRoot !== this.view?.model?.root || typeof this.view?.captureWallSurfacePick !== 'function') {
        this._wallPickContext = null; return false;
      }
      this._endWindowDrag(false); this.card._history?.cancel();
      this.drawing = this.picking = this.calibrating = null;
      this.doorMode = this.colorPick = this.overlayMove = this.pivoting = false;
      this.selectedRoom = this.selectedMarker = this.modelPick = null;
      this.card._applyMarkerSelection?.(null); this.view.highlightModelNode?.(null);
      this.refreshOverlay();
    } else this._syncStageClasses();
    return true;
  }

  _wallSurfacePick() {
    if (!this._wallPresentationEditor?.pendingSurfacePick) return null;
    const pick = this._wallPresentationEditor?.syncSurfacePick();
    if (!pick) return null;
    const context = this._wallPickContext, shown = this.card._navigationFloors?.();
    if (!this.card._editing || this.tab !== 'model' || !this._wallPresentationEditor.canEdit
      || !context || context.token !== pick.token || context.generation !== this._generation
      || context.key !== this.card._config?.layout_key || context.modelRoot !== this.view?.model?.root
      || context.view !== JSON.stringify([this.card._mode, this.card._floor, this.card._floorOnly, this.card._viewId])
      || pick.floor_id !== undefined && (!this.floors.some((floor) => floor.id === pick.floor_id && Number.isFinite(this.view.floorElevation(floor.id)))
        || Array.isArray(shown) && !shown.includes(pick.floor_id))) {
      this._wallPresentationEditor.cancelSurfacePick(); this._wallPickContext = null;
      return null;
    }
    return pick;
  }

  beginTrackingPlanPick(pick) {
    this._trackingPickCursor = null;
    this._trackingPickContext = pick ? { token: pick.token, generation: this._generation,
      key: this.card._config?.layout_key, model: this.view?.model, alignment: JSON.stringify(this.card._modelAlign?.() ?? null) } : null;
    if (pick) {
      if (!this.floors.some((floor) => floor.id === pick.floorId && Number.isFinite(this.view.floorElevation(floor.id)))) {
        this._trackingEditor.cancelPlanPick?.(); return false;
      }
      this.selectedRoom = this.selectedMarker = null;
      this.card._applyMarkerSelection?.(null);
      if (this.card._floor !== pick.floorId) this.card._setFloor(pick.floorId);
      if (this.card._mode !== 'top') this.card._setMode('top');
    }
    this.refreshOverlay();
    return true;
  }

  _trackingPlanPick() {
    const pick = this.tab === 'tracking' && this._trackingEditor.pendingPlanPick;
    if (!pick) return null;
    const context = this._trackingPickContext, shown = this.card._navigationFloors?.();
    if (!context || context.token !== pick.token || context.generation !== this._generation
      || context.key !== this.card._config?.layout_key || context.model !== this.view?.model
      || context.alignment !== JSON.stringify(this.card._modelAlign?.() ?? null)
      || !this.floors.some((floor) => floor.id === pick.floorId && Number.isFinite(this.view.floorElevation(floor.id)))
      || Array.isArray(shown) && !shown.includes(pick.floorId)) {
      this._trackingEditor.cancelPlanPick?.(); this._trackingPickContext = this._trackingPickCursor = null;
      return null;
    }
    return pick;
  }

  canvasDown(e) {
    if (this.tab === 'furniture') return;
    this._down = e.button === 0 ? [e.clientX, e.clientY] : null;
    this._wallPointerToken = e.button === 0 ? this._wallSurfacePick()?.token ?? null : null;
  }

  canvasMove(e) {
    if (this.tab === 'furniture') return;
    const trackingPick = this._trackingPlanPick();
    if (trackingPick) {
      const point = this._planPoint(e, trackingPick.floorId);
      this._trackingPickCursor = point?.length >= 2 && point.every(Number.isFinite) ? point.slice(0, 2) : null;
      this.refreshOverlay(); return;
    }
    if (!this.drawing) return;
    const p = this._planPoint(e, this.drawing.floorId);
    if (!p) return;
    this.drawing.cursor = this._snapDraw(p);
    this.refreshOverlay();
  }

  canvasUp(e) {
    if (this._furnitureDrag.up(e) || this.tab === 'furniture') { this._down = null; return; }
    const d = this._down;
    this._down = null;
    const wallToken = this._wallPointerToken; this._wallPointerToken = null;
    if (wallToken && this._wallSurfacePick()?.token !== wallToken) return;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) >= CLICK_SLOP_PX) return;
    this._click(e);
  }

  _planPoint(e, floorId, z = 0) {
    if (floorId && !this.floors.some((floor) => floor.id === floorId)) return null;
    return this.view.planPoint(e.clientX, e.clientY, this.view.floorElevation(floorId) + z);
  }

  _click(e) {
    const wallPick = this._wallSurfacePick();
    if (wallPick) {
      const hit = this.view.captureWallSurfacePick?.(e.clientX, e.clientY);
      if (hit) this._wallPresentationEditor.receiveSurfacePick({ ...hit, token: wallPick.token, floor_id: wallPick.floor_id });
      else this._wallPresentationEditor.message = 'Choose an exposed face on one exact, separately selectable wall mesh.';
      this._wallPresentationEditor.updatePreviews(this.panel); this._floorPresentationEditor.updatePreviews(this.panel); this._syncStageClasses(); return;
    }
    const trackingPick = this._trackingPlanPick();
    if (trackingPick) {
      const point = this._planPoint(e, trackingPick.floorId);
      if (point?.length >= 2 && point.every(Number.isFinite)) this._trackingEditor.acceptPlanPoint(point.slice(0, 2), trackingPick.floorId, trackingPick.token);
      this.refreshOverlay(); return;
    }
    if (this.tab === 'data' || this.tab === 'controls' || this.tab === 'tracking' || this.tab === 'scenes' || this.tab === 'idle' || this.tab === 'house' || this.tab === 'furniture') return; // Source/appearance edits never fall through into room selection.
    if (this.pivoting) {
      this._setPivot(e);
      return;
    }
    if (this.colorPick) {
      const p = this._planPoint(e, this.card._mowerFloor());
      if (!p) return;
      this.colorPick = false;
      this._syncStageClasses();
      this._pickMowerColor(p[0], p[1]);
      return;
    }
    if (this.calibrating) {
      const p = this._planPoint(e, this.card._mowerFloor());
      if (!p) return;
      const plan = E.snapPoint(p, { radius: 0 }).point;
      const { src } = this.calibrating;
      this.calibrating = null;
      this.setMower({ calibration: [...(this.mower().calibration || []), { src, plan }] });
      return;
    }
    if (this.picking && !this.drawing) {
      this._pickRoom(e);
      return;
    }
    if (this.tab === 'objects' && this.view.model && !this.drawing) return; // object taps: the card's gesture
    if (this.tab === 'views' && this.view.model && !this.drawing) {
      this._pickView(e);
      return;
    }
    if (this.tab === 'model' && this.view.model && !this.drawing) {
      const owner = this.view.pickModel(e.clientX, e.clientY);
      this.modelPick = owner ? (owner.kind === 'untagged' ? { kind: 'untagged', path: owner.path } : { kind: owner.kind, id: owner.id }) : null;
      this.view.highlightModelNode(owner ? owner.node : null);
      this.render();
      const row = this.panel.querySelector('tr.sel');
      if (row) row.scrollIntoView({ block: 'nearest' });
      return;
    }
    const fid = this.drawing ? this.drawing.floorId : this.activeFloor();
    const p = this._planPoint(e, fid);
    if (!p) return;
    if (this.drawing) {
      this._addDrawPoint(p);
      return;
    }
    const sel = this.room(this.selectedRoom);
    if (this.doorMode && sel) {
      const next = E.addDoor(sel, p, Math.max(0.6, this.snapRadius()));
      if (next !== sel) {
        this.doorMode = false;
        this.commit(E.upsertRoom(this.layout, next));
      }
      return;
    }
    // pick the smallest room under the click, so a room wins over the garden around it
    const hits = (this.layout.rooms || [])
      .filter((r) => this.floorOf(r) === fid && r.polygon && pointInPolygon(p, r.polygon))
      .sort((a, b) => Math.abs(signedArea(a.polygon)) - Math.abs(signedArea(b.polygon)));
    this.selectRoom(hits.length ? hits[0].id : null);
  }

  // ---------- pick a room's outline from the model ----------
  startPicking(areaId) {
    this.selectedRoom = null;
    this.selectedMarker = null;
    this.card._applyMarkerSelection(null);
    this.picking = { areaId, busy: false, poly: null };
    this.tab = 'rooms';
    this.message = null;
    this.refreshOverlay();
    this.render();
  }

  cancelPicking() {
    this.picking = null;
    this.refreshOverlay();
    this.render();
  }

  _pickRoom(e) {
    const pk = this.picking;
    if (pk.busy) return;
    const owner = this.view.pickModel(e.clientX, e.clientY);
    if (!owner) {
      this.message = this._coreNotice('pickFloorNotice', {}, { warn: true });
      this.render();
      return;
    }
    if (owner.kind === 'room' || owner.kind === 'zone') {
      const cur = this.layout.model || {};
      this.picking = null;
      this.message = this._coreNotice('linkedNotice', { name: owner.label || owner.id, area: areaName(this.hass, pk.areaId) });
      this.setModelProps({ rooms: { ...(cur.rooms || {}), [owner.id]: { ...(cur.rooms || {})[owner.id], area: pk.areaId } } });
      this.refreshOverlay();
      return;
    }
    if (owner.hit.up === false) {
      this.message = this._coreNotice('pickFloorNotice', {}, { warn: true });
      this.render();
      return;
    }
    pk.busy = true;
    pk.poly = null;
    this.message = this._coreNotice('tracing');
    this.render();
    const mesh = owner.hit.object, hit = owner.hit.point;
    setTimeout(() => {
      if (this.picking !== pk) return;
      pk.busy = false;
      try {
        const r = this._traceOutline(mesh, hit);
        pk.poly = r.poly;
        pk.floorId = this.activeFloor();
        this.message = r.note === "Used the floor piece's bounding rectangle — reshape it if needed" ? this._coreNotice('traceRectangleNotice', {}, { warn: true }) : r.note ? { text: r.note, warn: true } : null;
      } catch (err) {
        this.message = this._coreNotice('traceError', { error: err.message }, { error: true });
      }
      this.refreshOverlay();
      this.render();
    }, 0);
  }

  // all loops (or the raster grid for dense meshes) are cached per floor piece and height; each click then
  // only picks a loop. Fallback: the mesh's bounding rectangle.
  _traceOutline(mesh, hit) {
    const model = this.view.model;
    // loops are in card world: a new model or a new alignment invalidates them
    const placed = JSON.stringify(this.card._modelAlign());
    if (this._outlineModel !== model || this._outlineAlign !== placed) {
      this._outlineCache.clear();
      this._outlineModel = model;
      this._outlineAlign = placed;
    }
    const b = Math.round(hit[1] / 0.05);
    const key = (n) => mesh.uuid + ':' + n;
    let entry = null;
    for (const n of [b, b - 1, b + 1]) { entry = this._outlineCache.get(key(n)); if (entry) break; }
    if (!entry) {
      const tris = this.view.meshTriangles(mesh);
      entry = tris.length / 9 > DENSE_TRIS ? { grid: rasterGrid(tris, hit[1]) } : { loops: outlineLoops(tris, hit[1]) };
      this._outlineCache.set(key(b), entry);
    }
    const poly = entry.grid ? outlineFromGrid(entry.grid, hit) : entry.loops ? pickLoop(entry.loops, [hit[0], -hit[2]]) : null;
    return poly ? { poly } : { poly: this.view.meshPlanRect(mesh), note: "Used the floor piece's bounding rectangle — reshape it if needed" };
  }

  usePickedOutline() {
    const pk = this.picking;
    if (!pk || !pk.poly) return;
    const room = { id: E.newRoomId(this.layout), area_id: pk.areaId, polygon: pk.poly, doors: [], outdoor: false, floor_id: pk.floorId || this.activeFloor() };
    this.picking = null;
    this.selectedRoom = room.id;
    this.commit(E.upsertRoom(this.layout, room));
  }

  selectRoom(id) {
    if (['data', 'controls'].includes(this.tab) && id) return;
    this.selectedRoom = id;
    this.selectedMarker = null;
    this.doorMode = false;
    this.confirmDelete = false;
    if (id) this.tab = 'rooms';
    this.card._applyMarkerSelection(null);
    this.refreshOverlay();
    this.render();
  }

  selectMarker(id) {
    if (['data', 'controls'].includes(this.tab) && id) return;
    this.selectedMarker = id;
    this.selectedRoom = null;
    this.doorMode = false;
    if (id) this.tab = 'devices';
    this.card._applyMarkerSelection(id);
    this.refreshOverlay();
    this.render();
  }

  // ---------- drawing ----------
  startDrawing(areaId) {
    const area = this.hass.areas && this.hass.areas[areaId];
    // the floor shown on its own (or the view's only floor), else the area's floor, else the active floor
    const st = this.card._viewState;
    const single = this.card._floorOnly || (st && !st.allFloors && st.floors.length === 1 ? st.floors[0] : null);
    let floorId = single && this.floors.some((f) => f.id === single) ? single : null;
    if (!floorId) floorId = area && this.floors.some((f) => f.id === area.floor_id) ? area.floor_id : this.activeFloor();
    if (floorId !== this.card._floor) this.card._setFloor(floorId);
    if (this.card._mode !== 'top') this.card._setMode('top');
    this.selectedRoom = null;
    this.selectedMarker = null;
    this.card._applyMarkerSelection(null);
    this.drawing = { areaId, floorId, points: [], cursor: null };
    this.tab = 'rooms';
    this._syncStageClasses();
    this.refreshOverlay();
    this.render();
  }

  _snapDraw(p) {
    const vertices = [
      ...E.floorVertices(this.layout.rooms || [], (r) => this.floorOf(r), this.drawing.floorId),
      ...this.drawing.points,
    ];
    return E.snapPoint(p, { vertices, radius: this.snapRadius() });
  }

  _addDrawPoint(p) {
    const d = this.drawing;
    const s = this._snapDraw(p).point;
    const first = d.points[0];
    if (d.points.length >= 3 && Math.hypot(s[0] - first[0], s[1] - first[1]) <= this.snapRadius()) {
      this.finishDrawing();
      return;
    }
    d.points.push(s);
    this.refreshOverlay();
    this.render();
  }

  finishDrawing() {
    const d = this.drawing;
    if (!d) return;
    const polygon = E.cleanPolygon(d.points);
    if (polygon.length < 3) return;
    const area = this.hass.areas && this.hass.areas[d.areaId];
    const room = { id: E.newRoomId(this.layout), area_id: d.areaId, polygon, doors: [], outdoor: false };
    // only store the floor when it differs from the area's, so HA floor changes follow through
    if (!area || area.floor_id !== d.floorId) room.floor_id = d.floorId;
    this.drawing = null;
    this._syncStageClasses();
    this.selectedRoom = room.id;
    this.commit(E.upsertRoom(this.layout, room));
  }

  cancelDrawing() {
    this.drawing = null;
    this._syncStageClasses();
    this.refreshOverlay();
    this.render();
  }

  _ownsHistoryShortcut(e) {
    const path = e.composedPath?.() || [e.target];
    const owner = [...activeEditors].find((edit) => path.includes(edit.panel) || path.includes(edit.card));
    if (owner) return owner === this;
    // A view-only card also owns its focused controls; another card's editor must not claim them.
    if (path.some((node) => node?.localName === 'taylors3d-card')) return path.includes(this.card);
    const focusPath = [];
    for (let focus = document.activeElement; focus; focus = focus.shadowRoot?.activeElement) focusPath.push(focus);
    const focused = [...activeEditors].find((edit) => focusPath.some((node) => node === edit.card || node === edit.panel || edit.panel.contains(node)));
    if (focused) return focused === this;
    if (focusPath.some((node) => node?.localName === 'taylors3d-card')) return focusPath.includes(this.card);
    // Preserve the body shortcut for a single editor, without guessing between multiple open editors.
    return activeEditors.size === 1 && activeEditors.has(this);
  }

  _onKeyDown(e) {
    const action = historyShortcut(e);
    if (action) {
      if (this._ownsHistoryShortcut(e) && this._runHistory(action)) e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && this._trackingPlanPick() && this._ownsHistoryShortcut(e)) {
      this._trackingEditor.cancelPlanPick(); this._trackingPickContext = this._trackingPickCursor = null;
      this.refreshOverlay(); this.render(); e.preventDefault(); return;
    }
    if (e.key === 'Escape' && this._wallSurfacePick() && this._ownsHistoryShortcut(e)) {
      this._wallPresentationEditor.cancelSurfacePick(); this._wallPickContext = null;
      this._syncStageClasses(); this._wallPresentationEditor.updatePreviews(this.panel); this._floorPresentationEditor.updatePreviews(this.panel); e.preventDefault(); return;
    }
    if (e.key === 'Escape' && this.tab === 'scenes' && this._scenePreviewEditor.previewToken !== null && this._ownsHistoryShortcut(e)) {
      this._scenePreviewEditor.onClick('scene-preview-stop'); e.preventDefault(); return;
    }
    if (isNativeEditing(e)) return;
    if (this.menu && e.key === 'Escape') {
      this._closeMenu();
      e.preventDefault();
      return;
    }
    if (this.pivoting) {
      if (e.key !== 'Escape') return;
      this.cancelPivot();
      e.preventDefault();
    } else if (this.picking && !this.drawing) {
      if (e.key !== 'Escape') return;
      this.cancelPicking();
      e.preventDefault();
    } else if (this.drawing) {
      if (e.key === 'Enter') this.finishDrawing();
      else if (e.key === 'Escape') this.cancelDrawing();
      else if (e.key === 'Backspace') {
        this.drawing.points.pop();
        this.refreshOverlay();
        this.render();
      } else return;
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (this.colorPick) this.colorPick = false;
      else if (this.doorMode) this.doorMode = false;
      else if (this.selectedRoom) this.selectedRoom = null;
      else if (this.selectedMarker) this.selectMarker(null);
      this._syncStageClasses();
      this.refreshOverlay();
      this.render();
    }
  }

  _syncStageClasses() {
    const wallPick = !!this._wallSurfacePick();
    this.card._stage.classList.toggle('drawing', !!this.drawing || !!this.picking || this.doorMode || !!this.calibrating || this.colorPick || !!this.pivoting || !!this._trackingPlanPick() || wallPick);
    this.card._stage.classList.toggle('wall-picking', wallPick);
    this.view.setPivotMarker(!!this.card._editing && this.tab === 'views');
    this.card._stage.classList.toggle('moving', this.overlayMove);
    const picking = !!this.card._editing && (this.tab === 'model' || this.tab === 'views') && !!this.view.model;
    this.card._stage.classList.toggle('picking', picking);
    this.card._stage.classList.toggle('picking-views', picking && this.tab === 'views');
    this.updateHistoryState();
  }

  // Overlay move tool: grab the pointer before OrbitControls sees it (capture phase on the stage).
  canvasDownCapture(e) {
    if (this.tab === 'furniture') { this._furnitureDrag.down(e); return; }
    const o = this.mower().overlay;
    if (!this.overlayMove || !o || e.button !== 0) return;
    e.stopPropagation();
    const fid = this.card._mowerFloor();
    const start = this._planPoint(e, fid);
    if (!start) return;
    this._startWindowDrag({ kind: 'overlay', start: [e.clientX, e.clientY], plan: start, origin: [o.x || 0, o.y || 0], floorId: fid, moved: false });
  }

  // ---------- mower ----------
  mower() {
    return this.layout.mower || {};
  }

  setMower(patch) {
    const cur = this.layout.mower || { entity: '', source: 'gps', x_attr: 'x', y_attr: 'y', floor_id: this.floors[0].id, calibration: [], overlay: null, trail: true };
    this.commit({ ...this.layout, mower: { ...cur, ...patch } });
    this.render();
  }

  setOverlay(patch, rerender = true) {
    const m = this.mower();
    const cur = m.overlay || { entity: '', x: 0, y: 0, rotation: 0, width: 20, opacity: 0.6, refresh: 10 };
    const overlay = { ...cur, ...patch };
    this.card._commit({ ...this.layout, mower: { ...m, overlay } });
    if (rerender) this.render();
  }

  // live values in the Mower tab, without re-rendering the panel
  onStates() {
    try { return this._onStates(); } finally { this.card._syncFeedback?.(); }
  }

  _onStates() {
    this._navigation.update(this.panel);
    this._syncOwnedLabels();
    this._roomActionsEditor.observe();
    this._customControlsEditor.observe();
    if (this.tab === 'controls') { this._customControlsEditor.updatePreviews(this.panel); return; }
    if (this.tab === 'rooms') this._roomActionsEditor.updatePreviews(this.panel);
    this._dashboardBackupEditor.onStates();
    if (this.tab === 'data') return;
    this._furnitureDrag.update();
    if (this.tab === 'furniture') { this._furnitureEditor.updatePreviews(this.panel); return; }
    if (this.tab === 'house') { this._houseSummaryEditor.updatePreviews(this.panel); return; }
    if (this.tab === 'idle') { this._ambientIdleEditor.updatePreviews(this.panel); return; }
    if (this.tab === 'scenes') { this._scenePreviewEditor.updatePreviews(this.panel); return; }
    if (this.tab === 'model') { this._modelRenderingEditor.updatePreviews(this.panel); this._wallPresentationEditor.updatePreviews(this.panel); this._floorPresentationEditor.updatePreviews(this.panel); this._syncModelPositionFields(); this._syncStageClasses(); return; }
    if (this.tab === 'security') { this._securityEditor.updatePreviews(this.panel); return; }
    if (this.tab === 'tracking') { this._trackingEditor.updatePreviews(this.panel); return; }
    if (this.tab === 'environment') { this._weatherEditor.updatePreviews(this.panel); return; }
    if (this.tab === 'cameras') { this._cameraEditor.updatePreviews(this.panel); return; }
    if (this.tab === 'overlays') { this._overlayEditor.updatePreviews(this.panel); return; }
    if (this.tab !== 'mower') return;
    this._syncMowerImageFields();
    const el = this.panel.querySelector('.mower-live');
    if (el) el.innerHTML = this._mowerLiveHtml();
  }

  _mowerLiveHtml() {
    const m = this.mower();
    if (m.floor_id && !this.floors.some((floor) => floor.id === m.floor_id)) return `${this._coreCaption('mowerMissingFloor')}<b>${esc(m.floor_id)}</b>${this._coreCaption('mowerRepairFloor')}`;
    const st = m.entity && this.hass.states[m.entity];
    if (!m.entity) return this._coreCaption(m.source === 'image' ? 'pickMowerImageEntity' : 'pickMowerEntity');
    if (!st) return this._coreCaption('missingMowerEntity', { id: m.entity });
    if (m.source === 'image') return this._mowerImageHtml();
    const r = readSource(st, m);
    if (!r) return m.source === 'xy'
      ? this._coreCaption('mowerNoXY', { x: m.x_attr || 'x', y: m.y_attr || 'y', id: m.entity })
      : this._coreCaption('mowerNoGps', { id: m.entity, state: st.state });
    const live = this.card._mowerLive;
    const raw = r.raw.map((v) => (m.source === 'xy' ? fmt(v) : v.toFixed(6))).join(', ');
    const plan = live && live.floorId ? this._coreCaption('mowerOnPlan', { x: fmt(live.x), y: fmt(live.y) }) : this._coreCaption('mowerCalibrate');
    return `${this._coreCaption('mowerReading', { value: raw })}<br>${plan}`;
  }

  _mowerImageHtml() {
    const m = this.mower();
    const ic = m.image || {};
    if (!m.overlay || !m.overlay.entity) return this._coreCaption('mowerAddOverlay');
    if (!ic.color) return this._coreCaption('mowerPickColour');
    const r = this.card._imageResult;
    const live = this.card._mowerLive;
    if (r && r.error) return `<span style="color: var(--error-color, #db4437)">${esc(r.error)}</span>`;
    if (r && r.missing) return this._coreCaption(live && live.floorId ? 'mowerLastSeen' : 'mowerNotFound', { x: fmt(live?.x), y: fmt(live?.y) });
    if (r && live && live.floorId) return this._coreCaption('mowerFound', { x: fmt(live.x), y: fmt(live.y), count: r.count });
    return this._coreCaption('mowerLooking');
  }

  // Colour under a plan point in the map image: median of the 5x5 pixels around it.
  async _pickMowerColor(x, y) {
    const m = this.mower();
    const o = m.overlay;
    const ic = m.image || {};
    const entity = ic.entity || (o && o.entity);
    const url = entity && overlayUrl(this.hass, entity, Date.now());
    if (!url || !o) { this.message = this._coreNotice('overlayFirst', {}, { error: true }); this.render(); return; }
    try {
      const img = await readImagePixels(url);
      const q = planToPixel(x, y, img.imgW, img.imgH, o);
      const k = img.width / img.imgW;
      const px = Math.floor(q.px * k), py = Math.floor(q.py * k);
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) {
        this.message = this._coreNotice('outsideImage', {}, { error: true });
        this.render();
        return;
      }
      const color = medianColor(img.data, img.width, img.height, px, py);
      this.message = null;
      // start tracking at the clicked icon (not the largest blob of its colour)
      this.card._imageBlob = { px: q.px, py: q.py, count: null, misses: 0, imgW: img.imgW, imgH: img.imgH, sampleW: img.width, color };
      this.setMower({ image: { tolerance: 40, min_pixels: 4, ...ic, color } });
    } catch (e) {
      console.warn('taylors3d: could not read the mower map image', e);
      this.message = this._coreNotice('imageError', {}, { error: true });
      this.render();
    }
  }

  // ---------- overlay ----------
  _handle(key, cls) {
    let el = this._handles.get(key);
    if (!el) {
      el = document.createElement('div');
      this._handles.set(key, el);
    }
    el.className = 'fp-handle ' + cls;
    return el;
  }

  refreshOverlay(preview) {
    if (!this.view) return;
    this._syncStageClasses();
    const color = this.card._built.theme ? this.card._built.theme.primary : 0x03a9f4;
    const lines = [], fills = [], handles = [];
    const used = new Set();
    const handle = (key, cls, x, y, floorId, setup) => {
      const el = this._handle(key, cls);
      used.add(key);
      el.onpointerdown = setup ? (e) => setup(e, el) : null;
      el.oncontextmenu = null;
      handles.push({ element: el, x, y, floorId });
      return el;
    };

    const room = preview || this.room(this.selectedRoom);
    if (room && room.polygon && this.floors.some((floor) => floor.id === this.floorOf(room))) {
      const fid = this.floorOf(room);
      fills.push({ points: room.polygon, floorId: fid, color, opacity: 0.16 });
      lines.push({ points: room.polygon, closed: true, floorId: fid, color });
      room.polygon.forEach(([x, y], i) => {
        const el = handle('v' + i, 'vertex', x, y, fid, (e, h) => this._vertexDown(e, room.id, i, h));
        el.title = this._coreText('cornerTitle');
        el.dataset.coreTitle = 'cornerTitle';
        el.oncontextmenu = (e) => {
          e.preventDefault();
          const r = this.room(room.id);
          if (r) this.commit(E.upsertRoom(this.layout, E.removeVertex(r, i)));
        };
      });
      if (!this.drag) {
        room.polygon.forEach((a, i) => {
          const b = room.polygon[(i + 1) % room.polygon.length];
          const el = handle('m' + i, 'mid', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, fid, (e, h) => this._midDown(e, room.id, i, h));
          el.title = this._coreText('midpointTitle');
          el.dataset.coreTitle = 'midpointTitle';
        });
      }
      (room.doors || []).forEach(([x, y], i) => handle('d' + i, 'door', x, y, fid));
    }

    const pk = this.picking;
    if (pk && pk.poly) {
      const fid = pk.floorId || this.activeFloor();
      fills.push({ points: pk.poly, floorId: fid, color, opacity: 0.25 });
      lines.push({ points: pk.poly, closed: true, floorId: fid, color });
    }

    const d = this.drawing;
    if (d) {
      const pts = d.cursor ? [...d.points, d.cursor.point] : d.points;
      lines.push({ points: pts, closed: false, floorId: d.floorId, color });
      d.points.forEach(([x, y], i) => handle('p' + i, i === 0 && d.points.length >= 3 ? 'draw first' : 'draw', x, y, d.floorId));
      if (d.cursor) handle('cursor', 'cursor ' + d.cursor.kind, d.cursor.point[0], d.cursor.point[1], d.floorId);
    }

    if (this.tab === 'tracking') {
      const calibration = this._trackingEditor.calibrationOverlay?.();
      if (calibration?.floorId && this.floors.some((floor) => floor.id === calibration.floorId)) {
        const points = (calibration.points || []).filter((point) => [point.x, point.y].every(Number.isFinite));
        if (points.length > 1) lines.push({ points: points.map((point) => [point.x, point.y]), closed: false, floorId: calibration.floorId, color });
        for (const point of points) if ([point.x, point.y].every(Number.isFinite)) {
          const element = handle('trk-cal-' + point.index, 'draw calibration', point.x, point.y, calibration.floorId);
          element.textContent = point.label || String(point.index + 1); element.title = this._coreText('calibrationPointTitle', { label: element.textContent });
          element.setAttribute('aria-label', element.title); element.style.pointerEvents = 'none';
        }
        if (Array.isArray(calibration.mapped) && calibration.mapped.every(Number.isFinite)) handle('trk-mapped', 'cursor', calibration.mapped[0], calibration.mapped[1], calibration.floorId);
      }
      const trackingPick = this._trackingPlanPick();
      if (trackingPick && this._trackingPickCursor) handle('trk-cursor', 'cursor', ...this._trackingPickCursor, trackingPick.floorId);
    }

    for (const k of [...this._handles.keys()]) if (!used.has(k)) this._handles.delete(k);
    this.view.setOverlay({ lines, fills, handles });
  }

  // ---------- drags (corners, midpoints, markers) ----------
  _startWindowDrag(drag) {
    if (this.drag) this._endWindowDrag();
    this.card.beginHistory?.(drag.kind === 'overlay' ? 'Move map' : drag.kind === 'marker' ? 'Move device' : 'Edit room shape');
    this.drag = drag;
    this.updateHistoryState();
    this.view.setControlsEnabled(false);
    window.addEventListener('pointermove', this._onWinMove);
    window.addEventListener('pointerup', this._onWinUp);
    window.addEventListener('pointercancel', this._onWinUp);
  }

  _endWindowDrag(finishHistory = true) {
    const d = this.drag;
    if (d && d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    if (d && d.kind === 'marker' && d.attach !== undefined && this.view) this.view.highlightModelNode(null);
    window.removeEventListener('pointermove', this._onWinMove);
    window.removeEventListener('pointerup', this._onWinUp);
    window.removeEventListener('pointercancel', this._onWinUp);
    if (this.view) this.view.setControlsEnabled(true);
    this.drag = null;
    if (d && finishHistory) this.card.endHistory?.();
    this.updateHistoryState();
  }

  _vertexDown(e, roomId, index) {
    if (e.button !== 0) return;
    if (this.tab === 'data' || this.tab === 'controls' || this.tab === 'idle' || this.tab === 'house' || this.tab === 'furniture' || this._wallSurfacePick()) return;
    e.stopPropagation();
    e.preventDefault();
    this._startWindowDrag({ kind: 'vertex', roomId, index, start: [e.clientX, e.clientY], moved: false });
  }

  _midDown(e, roomId, edge) {
    if (e.button !== 0) return;
    if (this.tab === 'data' || this.tab === 'controls' || this.tab === 'idle' || this.tab === 'house' || this.tab === 'furniture' || this._wallSurfacePick()) return;
    e.stopPropagation();
    e.preventDefault();
    this._startWindowDrag({ kind: 'mid', roomId, edge, start: [e.clientX, e.clientY], moved: false });
  }

  markerDown(m, e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (this.tab === 'data' || this.tab === 'controls' || this.tab === 'tracking' || this.tab === 'scenes' || this.tab === 'idle' || this.tab === 'house' || this.tab === 'furniture' || this.drawing || this.doorMode || this.calibrating || this.colorPick || this._trackingPlanPick() || this._wallSurfacePick()) return;
    if (m.id === this.card._mowerMarkerId) {
      this.selectMarker(m.id); // positioned live, nothing to drag
      return;
    }
    const pos = this.card._positions && this.card._positions.get(m.id);
    this.selectMarker(m.id);
    if (!pos) return;
    this._startWindowDrag({ kind: 'marker', id: m.id, pos: { ...pos }, start: [e.clientX, e.clientY], moved: false });
  }

  _dragMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) < CLICK_SLOP_PX) return;
    d.moved = true;
    if (d.kind === 'overlay') {
      const p = this._planPoint(e, d.floorId);
      if (!p) return;
      const r = (v) => Math.round(v * 100) / 100;
      this.setOverlay({ x: r(d.origin[0] + p[0] - d.plan[0]), y: r(d.origin[1] + p[1] - d.plan[1]) }, false);
      return;
    }
    if (d.kind === 'marker') {
      d.last = { clientX: e.clientX, clientY: e.clientY };
      if (!e.altKey && this.view.model) {
        // magnetic: raycast at most once per frame, on the latest pointer position
        if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; this._magnet(d); });
        return;
      }
      if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
      this._setDragTarget(d, null);
      this._freeMarker(d, e);
      return;
    }
    let room = this.room(d.roomId);
    if (!room) return;
    if (d.kind === 'mid') {
      // first move of a midpoint handle inserts the corner, then it is a normal corner drag
      const a = room.polygon[d.edge], b = room.polygon[(d.edge + 1) % room.polygon.length];
      d.base = E.insertVertex(room, d.edge, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      d.kind = 'vertex';
      d.index = d.edge + 1;
    }
    room = d.base || room;
    const fid = this.floorOf(room);
    const p = this._planPoint(e, fid);
    if (!p) return;
    const otherRooms = (this.layout.rooms || []).filter((r) => r.id !== room.id);
    const others = E.floorVertices(otherRooms, (r) => this.floorOf(r), fid)
      .concat(room.polygon.filter((_, i) => i !== d.index));
    const s = E.snapPoint(p, { vertices: others, radius: this.snapRadius() }).point;
    d.preview = E.moveVertex(room, d.index, s);
    this.refreshOverlay(d.preview);
  }

  // Free drag (Alt, no model, nothing under the cursor): the plan point at the current height.
  _freeMarker(d, e) {
    d.snapped = false;
    const p = this._planPoint(e, d.pos.floorId, d.pos.z);
    if (!p) return;
    d.pos.x = p[0];
    d.pos.y = p[1];
    this.view.moveMarker(d.id, p[0], p[1], d.pos.z, d.pos.floorId);
  }

  // Magnetic drag: stick to the model surface under the pointer (5 cm off it); over a model object
  // highlight it, the drop attaches. Floor = the HA floor of the hit's level (else the current one).
  _magnet(d) {
    if (this.drag !== d || !d.last) return;
    const hit = this.view.surfaceAt(d.last.clientX, d.last.clientY);
    if (!hit) { // empty sky: keep the last snapped spot (a far plane hit would fling the marker away)
      this._setDragTarget(d, null);
      return;
    }
    const owner = hit.owner;
    const level = owner ? (owner.kind === 'level' ? owner.id : owner.level) : null;
    const lf = (this.card._levels && this.card._levels.levelFloor) || {};
    // the HA floor bound to the hit's level, else the floor the hit stands on, else the current one
    const floorId = (level && lf[level] && this.floors.some((f) => f.id === lf[level]) ? lf[level] : null)
      || floorAtHeight(this.floors.map((f) => ({ id: f.id, elevation: this.view.floorElevation(f.id) })), hit.point.y)
      || d.pos.floorId;
    const pin = snapPin(hit, this.view.floorElevation(floorId), floorId);
    d.pos = { ...d.pos, x: pin.x, y: pin.y, z: pin.z, floorId };
    d.snapped = true;
    const layer = this.card._objects;
    const obj = owner && owner.kind === 'object' && layer && layer.objectAt(owner.id) ? owner : null;
    this._setDragTarget(d, obj);
    this.view.moveMarker(d.id, pin.x, pin.y, pin.z, floorId);
  }

  _setDragTarget(d, owner) {
    const id = owner ? owner.id : null;
    if ((d.attach || null) === id) return;
    d.attach = id;
    this.view.highlightModelNode(owner ? owner.node : null);
  }

  _dragEnd() {
    const d = this.drag;
    if (d && d.kind === 'marker' && d.raf) { // the last move is still waiting for its frame
      cancelAnimationFrame(d.raf);
      d.raf = 0;
      this._magnet(d);
    }
    this._endWindowDrag(false);
    try {
      if (!d || !d.moved) {
        if (d && d.kind !== 'marker') this.refreshOverlay();
        return;
      }
      if (d.kind === 'overlay') {
        this.render();
      } else if (d.kind === 'marker') {
        const at = { x: d.pos.x, y: d.pos.y, z: d.pos.z, floor_id: d.pos.floorId };
        const anchor = d.attach && this.card._objects && this.card._objects.anchorOf(d.attach);
        if (anchor) {
          const offset = attachOffset(anchor, d.pos, this.view.floorElevation(d.pos.floorId));
          this.commit(E.attachPin(this.layout, d.id, d.attach, offset, at));
        } else {
          this.commit(E.setPin(this.layout, d.id, { ...at, on_model: this._onModel(d.id) }, { grid: !d.snapped }));
        }
      } else if (d.preview) {
        this.commit(E.upsertRoom(this.layout, d.preview));
      } else {
        this.refreshOverlay();
      }
    } finally {
      if (d) this.card.endHistory?.();
      this.updateHistoryState();
    }
  }

  // ---------- panel ----------
  _coreText(key, params = {}, language = localeInfo(this.hass).resolved) {
    const full = `editorCore.${key}`, fallback = coreCaptions[language]?.[full] ?? coreCaptions.en[full] ?? '';
    return language === 'en' ? fallback.replace(/\{([A-Za-z_]+)\}/g, (match, id) => ['string', 'number', 'boolean'].includes(typeof params[id]) ? String(params[id]) : match)
      : localize(this.hass, full, params, fallback);
  }
  _coreCaption(key, params = {}, tag = 'span') {
    return `<${tag} data-core-caption="${key}" data-core-params="${esc(JSON.stringify(params))}">${esc(this._coreText(key, params))}</${tag}>`;
  }
  _coreOption(key, params, attributes) {
    return `<option data-core-caption="${key}" data-core-params="${esc(JSON.stringify(params || {}))}" ${attributes}>${esc(this._coreText(key, params))}</option>`;
  }
  _coreAttribute(key, params = {}, attribute = 'title') {
    return `data-core-${attribute}="${key}" data-core-params="${esc(JSON.stringify(params))}" ${attribute}="${esc(this._coreText(key, params))}"`;
  }
  _coreNotice(key, params = {}, flags = {}) {
    return this._coreNoticeParts([{ key, params }], flags);
  }
  _coreNoticeParts(parts, flags = {}) {
    const notice = { text: parts.map((part) => part.key ? this._coreText(part.key, part.params, 'en') : part.literal || '').join(''), ...flags };
    coreNotices.set(notice, { source: notice.text, parts }); return notice;
  }
  _coreErrorNotice(error) {
    const notice = { text: error.message, error: true };
    if (ownedRuntimeDetails(error)) coreNotices.set(notice, { source: notice.text, runtimeError: error });
    return notice;
  }
  _messageText() {
    const caption = this.message && coreNotices.get(this.message);
    if (caption?.source === this.message?.text && caption.runtimeError) return runtimeNoticeText(this.hass, caption.runtimeError);
    return caption?.source === this.message?.text ? caption.parts.map((part) => part.key ? this._coreText(part.key, part.params) : part.literal || '').join('') : this.message?.text;
  }
  _coreFilterReason(reason) {
    const key = { 'filtered entity': 'filtered', missing: 'filterMissing', hidden: 'filterHidden', disabled: 'filterDisabled', diagnostic: 'filterDiagnostic', config: 'filterConfig' }[reason];
    return key ? this._coreCaption(key) : esc(reason);
  }
  _coreAutoFloorOption(binding, attributes) {
    const name = binding.floor ? (this.floors.find((floor) => floor.id === binding.floor) || {}).name || binding.floor : '';
    return this._coreOption(binding.auto ? binding.floor ? 'autoName' : 'autoNoFloor' : 'auto', { name }, attributes);
  }
  _coreIssueCaption(issue, owned = false) {
    // The Data screen supplies only freshly computed registryIssues here. Its
    // structured codes stay stable in every language; external diagnostics
    // must retain their own wording even if they happen to reuse a known code.
    if (!owned) return esc(issue.message);
    const known = ['area', 'floor', 'entity', 'device', 'room', 'anchor'];
    if (known.includes(issue.kind) && issue.code === `missing_${issue.kind}`) return this._coreCaption(`saved${issue.kind[0].toUpperCase()}${issue.kind.slice(1)}Issue`, { id: issue.id });
    if (issue.code === 'entity_no_state' && issue.kind === 'entity') return this._coreCaption('entityNoStateIssue', { id: issue.id });
    return esc(issue.message);
  }
  _saveText() {
    const key = { saving: 'edit.saving', saved: 'edit.saved', failed: 'edit.saveFailed' }[this.saveState];
    return key ? localize(this.hass, key) : '';
  }

  _syncOwnedLabels(force = false) {
    const key = localeKey(this.hass);
    if (!force && this._ownedLabelsKey === key) return;
    this._ownedLabelsKey = key;
    for (const button of this.panel.querySelectorAll('.tabs [data-act="tab"]')) button.textContent = localize(this.hass, `edit.tabs.${button.dataset.id}`, {}, button.textContent);
    this.panel.querySelector('.history-controls')?.setAttribute('aria-label', localize(this.hass, 'history.aria'));
    this.updateHistoryState();
    this._navigation.update(this.panel);
    const state = this.panel.querySelector('.save-state'), backend = this.panel.querySelector('.storage-backend');
    if (state) state.textContent = this._saveText();
    if (backend) backend.textContent = this._backendLabel();
    // Only caption spans change; the native file input and typed feature fields
    // keep their actual nodes and unfinished intent when HA changes language.
    for (const node of this.panel.querySelectorAll('[data-single-layout-text]')) node.textContent = localize(this.hass, `edit.singleLayout.${node.dataset.singleLayoutText}`);
    updateCoreCaptions(this.panel, (caption, params) => this._coreText(caption, params));
    updateCoreCaptions(this.menu, (caption, params) => this._coreText(caption, params));
    for (const element of this._handles.values()) if (element.dataset.coreTitle) element.title = this._coreText(element.dataset.coreTitle);
    const message = this.panel.querySelector('.tab-body > .msg');
    if (message && this.message && message.textContent !== this._messageText()) message.textContent = this._messageText();
  }

  render() {
    // One feedback boundary also covers stable-subtree/slider early returns.
    // It runs only after the constructed editor has finished its own update.
    try { return this._render(); } finally { this.card._syncFeedback?.(); }
  }

  _render() {
    this._navigation.observe();
    this._reviewCurrent();
    this._dashboardBackupEditor.setActive(!this._backupDetached && this.card._editing === true && this.tab === 'data');
    if (this.tab === 'house' && this.card._config?.layout_style !== 'house') {
      this._houseSummaryEditor.reset(); this.tab = 'rooms';
    }
    // Keep the whole backup subtree connected during Data redraws. Native file
    // selections, summary focus and a valid held press cannot be reconstructed
    // by serializing HTML or briefly removing/reinserting the same element.
    if (this.tab === 'data' && this._renderedTab === 'data' && this.panel.querySelector('[data-dashboard-backup-editor]')) {
      const active = this.panel.getRootNode().activeElement;
      const tabBody = this.panel.querySelector('.tab-body');
      let message = tabBody.querySelector(':scope > .msg');
      if (this.message) {
        if (!message) { message = document.createElement('div'); tabBody.prepend(message); }
        message.className = `msg ${this.message.error ? 'error' : this.message.warn ? 'warn' : ''}`;
        message.textContent = this._messageText();
      } else message?.remove();
      const old = this.panel.querySelector('[data-single-layout-data]');
      const template = document.createElement('template'); template.innerHTML = this._singleLayoutData();
      old?.replaceWith(template.content.firstElementChild);
      markCoreCaptions(this.panel.querySelector('[data-single-layout-data]'), 'data');
      this._syncOwnedLabels(true);
      this._dashboardBackupEditor.updatePreviews(this.panel);
      this.updateHistoryState();
      this.panel.querySelector('.save-state').textContent = this._saveText();
      this.panel.querySelector('.foot span:last-child').textContent = this._backendLabel();
      if (active?.dataset?.act?.startsWith('history-') && active.disabled) {
        this.panel.querySelector('.history-controls button:not(:disabled)')?.focus({ preventScroll: true });
      }
      return;
    }
    if (this._sliding) { this._renderHeld = true; this.updateHistoryState(); return; }
    // a rebuild must not move the panel under the user: keep scroll position and the focused control
    const oldBody = this.panel.querySelector('.tab-body');
    const scroll = oldBody && this._renderedTab === this.tab ? oldBody.scrollTop : 0;
    const active = this.panel.contains(this.panel.getRootNode().activeElement) ? this.panel.getRootNode().activeElement : null;
    const focusKey = active && active.dataset && active.dataset.field ? [active.dataset.field, active.dataset.id || ''] : null;
    const sceneFocus = active?.dataset?.field?.startsWith('scene-preview-') ? [active.dataset.binding || '', active.dataset.target || ''] : null;
    const historyFocus = active?.dataset?.act?.startsWith('history-') ? active.dataset.act : null;
    const navigationFocus = active?.closest?.('[data-editor-navigation], [data-editor-advanced], [data-editor-setup]')
      ? [active.dataset.act || '', active.dataset.id || '', active.matches?.('summary') === true] : null;
    const report = this.panel.querySelector('details.report');
    if (report) this._reportOpen = report.open;
    const adv = this.panel.querySelector('details.advanced');
    if (adv) this._advancedOpen = adv.open;
    this._renderedTab = this.tab;
    const hasObjects = this._hasObjects();
    if (this.tab === 'objects' && !hasObjects) this.tab = 'devices';
    const tabs = editorTabs({ hasObjects, houseStyle: this.card._config?.layout_style === 'house' });
    const body = {
      rooms: () => this._roomsTab(), devices: () => this._devicesTab(), objects: () => this._objectsTab(), mower: () => this._mowerTab(), views: () => this._viewsTab(),
      model: () => this._modelTab(), data: () => this._dataTab(),
      overlays: () => this._overlayEditor.render(),
      cameras: () => this._cameraEditor.render(),
      tracking: () => this._trackingEditor.render(),
      environment: () => this._weatherEditor.render(),
      security: () => this._securityEditor.render(),
      scenes: () => this._scenePreviewEditor.render(),
      controls: () => this._customControlsEditor.render(),
      idle: () => this._ambientIdleEditor.render(),
      house: () => `<p class="hint" data-editor-text="houseSettingsHelp">${this._navigation.t('houseSettingsHelp')}</p>${this._houseSummaryEditor.render()}`,
      furniture: () => `<p><button data-act="library-refresh">${this._coreCaption('libraryRefresh')}</button></p>${this._furnitureEditor.render()}${this._furnitureLibraryDetails()}`,
      setup: () => '',
    }[this.tab]();
    const msg = this.message ? `<div class="msg ${this.message.error ? 'error' : this.message.warn ? 'warn' : ''}">${esc(this._messageText())}</div>` : '';
    this.panel.innerHTML = `
      ${this._navigation.renderTabs(tabs)}
      ${this._leavePrompt()}
      <div class="row history-controls" role="group" aria-label="${esc(localize(this.hass, 'history.aria'))}" style="padding: 4px 12px">
        <button data-act="history-undo" style="min-height: 44px" disabled>${esc(localize(this.hass, 'history.undo'))}</button>
        <button data-act="history-redo" style="min-height: 44px" disabled>${esc(localize(this.hass, 'history.redo'))}</button>
        <span class="dim" style="font-size: 11px">Ctrl / ⌘ Z</span>
      </div>
      <div class="tab-body">${msg}${this._navigation.renderGuide()}${this._navigation.renderAdvanced(tabs)}${body}</div>
      <div class="foot"><span class="save-state">${this._saveText()}</span><span class="storage-backend">${esc(this._backendLabel())}</span></div>`;
    markCoreCaptions(this.panel, this.tab);
    this._syncOwnedLabels(true);
    this.updateHistoryState();
    if (this.tab === 'tracking') this._trackingEditor.updatePreviews(this.panel);
    if (this.tab === 'environment') this._weatherEditor.updatePreviews(this.panel);
    if (this.tab === 'security') this._securityEditor.updatePreviews(this.panel);
    if (this.tab === 'model') { this._modelRenderingEditor.updatePreviews(this.panel); this._wallPresentationEditor.updatePreviews(this.panel); this._floorPresentationEditor.updatePreviews(this.panel); this._syncModelPositionFields(); this._syncStageClasses(); }
    if (this.tab === 'scenes') this._scenePreviewEditor.updatePreviews(this.panel);
    if (this.tab === 'controls') this._customControlsEditor.updatePreviews(this.panel);
    if (this.tab === 'idle') this._ambientIdleEditor.updatePreviews(this.panel);
    if (this.tab === 'house') this._houseSummaryEditor.updatePreviews(this.panel);
    if (this.tab === 'furniture') this._furnitureEditor.updatePreviews(this.panel);
    if (this.tab === 'data') this._dashboardBackupEditor.updatePreviews(this.panel);
    if (this.tab === 'rooms') this._roomActionsEditor.updatePreviews(this.panel);
    const newBody = this.panel.querySelector('.tab-body');
    if (newBody && scroll) newBody.scrollTop = scroll;
    if (focusKey) {
      const el = [...this.panel.querySelectorAll('[data-field]')]
        .find((x) => x.dataset.field === focusKey[0] && (x.dataset.id || '') === focusKey[1]
          && (!sceneFocus || (x.dataset.binding || '') === sceneFocus[0] && (x.dataset.target || '') === sceneFocus[1]));
      if (el) el.focus({ preventScroll: true });
    } else if (historyFocus) {
      const button = this.panel.querySelector(`[data-act="${historyFocus}"]`);
      const target = button.disabled ? this.panel.querySelector('.history-controls button:not(:disabled)') : button;
      target?.focus({ preventScroll: true });
    } else if (navigationFocus) {
      const target = navigationFocus[2] ? this.panel.querySelector('[data-editor-advanced] summary')
        : [...this.panel.querySelectorAll('[data-editor-navigation] [data-act], [data-editor-advanced] [data-act], [data-editor-setup] [data-act]')]
          .find((node) => node.dataset.act === navigationFocus[0] && (node.dataset.id || '') === navigationFocus[1] && !node.hidden);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }

  // Normal tab selection still runs all existing tool/draft cleanup. This also
  // gives grouped navigation and browser regression helpers one stable entry.
  revealTab(tab, { guided = false } = {}) {
    if (!editorTabs({ hasObjects: this._hasObjects(), houseStyle: this.card._config?.layout_style === 'house' }).some(([id]) => id === tab)) return false;
    if (tab !== this.tab && !this._requestLeave({ type: 'tab', tab, guided })) return false;
    if (!guided) this._navigation.wizard = false;
    this._navigation.reveal(tab);
    const target = this.panel.querySelector(`[data-act="tab"][data-id="${tab}"]`);
    if (target) this._onPanelClick({ target });
    return !!target;
  }

  setupSnapshot() { return this._navigation.snapshot(); }
  setupSaveCurrent(token) { return this._navigation.current(token); }
  observeSetupContext() { this._navigation.update(this.panel); }

  _dirtyEditors() { return DRAFT_SAVES.filter(([name]) => this[name]?.dirty === true); }
  _reviewContext() { this._navigation.observe(); return [this._generation, this.tab, this._navigation._epoch, ...this._navigation.context(), this.layout]; }
  _sameReviewContext(context, allowLayout = false) { const current = this._reviewContext(); return context?.every((value, index) => allowLayout && index === current.length - 1 || value === current[index]); }
  _reviewCurrent() {
    if (this._pendingLeave && !this._sameReviewContext(this._pendingLeave.context, this._savingLeaveFeature === true)) this._pendingLeave = null;
    if (this._pendingReplacement && !this._sameReviewContext(this._pendingReplacement.context)) this._pendingReplacement = null;
  }
  _requestLeave(target) {
    this._reviewCurrent();
    if (!this._dirtyEditors().length && !this._pendingLeave?.retry) return true;
    if (this._pendingLeave?.busy) return false;
    this._pendingLeave = { ...target, retry: this._pendingLeave?.retry, context: this._reviewContext() };
    this._syncLeavePrompt();
    this.panel.querySelector('[data-act="draft-leave-stay"]')?.focus({ preventScroll: true });
    const picker = this.panel.querySelector('[data-field="editor-group"]'); if (picker) picker.value = this._navigation.group;
    return false;
  }
  requestClose() { return this._requestLeave({ type: 'close' }); }
  _leavePrompt() {
    const pending = this._pendingLeave; if (!pending) return '';
    const t = (key) => this._navigation.t(key);
    return `<section class="editor-leave-review" data-editor-leave role="region" aria-label="${t('leaveTitle')}">
      <strong>${t('leaveTitle')}</strong><p role="status">${t(pending.notice || 'leaveHelp')}</p><div class="row">
      <button data-act="draft-leave-save" ${pending.busy ? 'disabled' : ''}>${t(pending.busy ? 'leaveSaving' : 'leaveSave')}</button>
      <button data-act="draft-leave-discard" ${pending.busy ? 'disabled' : ''}>${t('leaveDiscard')}</button>
      <button data-act="draft-leave-stay" ${pending.busy ? 'disabled' : ''}>${t('leaveStay')}</button></div></section>`;
  }
  _syncLeavePrompt() {
    const old = this.panel.querySelector('[data-editor-leave]'), html = this._leavePrompt();
    if (!html) { old?.remove(); this._leaveNode = null; this._leaveMarkup = ''; return; }
    if (old && old !== this._leaveNode) { this._leaveNode = old; this._leaveMarkup = html; return; }
    if (old && html === this._leaveMarkup) return;
    const template = document.createElement('template'); template.innerHTML = html;
    const next = template.content.firstElementChild;
    if (old) old.replaceWith(next);
    else this.panel.querySelector('[data-editor-navigation]')?.after(next);
    this._leaveNode = next; this._leaveMarkup = html;
  }
  async _resolveLeave(action) {
    const pending = this._pendingLeave;
    if (!pending || pending.busy || !this._sameReviewContext(pending.context)) { this._reviewCurrent(); this._syncLeavePrompt(); return; }
    if (action === 'draft-leave-stay') { this._pendingLeave = null; this._syncLeavePrompt(); return; }
    if (action === 'draft-leave-save') {
      const editors = this._dirtyEditors();
      if (editors.some(([, save]) => !this.panel.querySelector(`[data-act="${save}"]`) || this.panel.querySelector(`[data-act="${save}"]`).disabled)) {
        pending.notice = 'leaveInvalid'; this._syncLeavePrompt(); return;
      }
      pending.busy = true; this._syncLeavePrompt();
      const requests = [];
      for (const [name, save] of editors) {
        const button = this.panel.querySelector(`[data-act="${save}"]`);
        if (!button || button.disabled || this._pendingLeave !== pending || !this._sameReviewContext(pending.context)) break;
        this._savingLeaveFeature = true;
        try { button.click(); } finally { this._savingLeaveFeature = false; }
        if (!this._sameReviewContext(pending.context, true)) break;
        pending.context = this._reviewContext();
        if (this.card._pendingLayoutSave) requests.push(this.card._pendingLayoutSave);
        if (this[name]?.dirty) break;
      }
      if (pending.retry && !editors.length && typeof this.card._commit === 'function') {
        this._savingLeaveFeature = true;
        let request; try { request = this.card._commit(this.layout); } finally { this._savingLeaveFeature = false; }
        if (this._sameReviewContext(pending.context, true)) pending.context = this._reviewContext();
        if (request?.then) requests.push(request);
      }
      // The final layout contains earlier feature Saves. Root owns only the
      // newest save reply; an older superseded reply deliberately returns false.
      const saved = await Promise.all(requests.slice(-1).map((request) => Promise.resolve(request).then((ok) => ok === true, () => false)));
      if (this._pendingLeave !== pending || !this._sameReviewContext(pending.context)) { this._reviewCurrent(); this._syncLeavePrompt(); return; }
      pending.busy = false;
      if (this._dirtyEditors().length || saved.some((ok) => !ok)) {
        pending.retry = !this._dirtyEditors().length && saved.some((ok) => !ok);
        pending.notice = pending.retry ? 'leaveFailed' : 'leaveInvalid'; this._syncLeavePrompt(); return;
      }
    } else if (action === 'draft-leave-discard') {
      for (const [name] of this._dirtyEditors()) { const editor = this[name]; if (typeof editor.cancel === 'function') editor.cancel(); else editor.reset(); }
    } else return;
    this._pendingLeave = null; this._syncLeavePrompt();
    if (pending.type === 'close') this.card._toggleEdit?.();
    else this.revealTab(pending.tab, { guided: pending.guided });
  }

  _backendLabel() {
    return localize(this.hass, `edit.storage.${this.card._store.backend}`);
  }

  _areas() {
    const areas = Object.values(this.hass.areas || {});
    return areas.sort((a, b) => a.name.localeCompare(b.name));
  }

  _roomsTab() {
    const d = this.drawing;
    if (d) {
      return `<section class="box">
        <h3>${this._coreCaption('drawing', { name: areaName(this.hass, d.areaId) })}</h3>
        <p class="hint">Click the corners on the plan. Points snap to 5 cm and to existing corners, so shared walls line up.
        Click the first point or press Enter to finish, Backspace removes the last point, Esc cancels.</p>
        <p>${this._coreCaption(d.points.length === 1 ? 'pointsOne' : 'pointsMany', { count: d.points.length })}</p>
        <div class="row"><button data-act="finish" ${d.points.length < 3 ? 'disabled' : ''} class="primary">Finish</button>
        <button data-act="undo-point" ${d.points.length ? '' : 'disabled'}>Undo point</button>
        <button data-act="cancel-draw">Cancel</button></div></section>`;
    }
    const pk = this.picking;
    if (pk) {
      return `<section class="box">
        <h3>${this._coreCaption('picking', { name: areaName(this.hass, pk.areaId) })}</h3>
        ${pk.busy ? `<p class="hint">${this._coreCaption('tracing')}</p>` : pk.poly
    ? `<p>${this._coreCaption('corners', { count: pk.poly.length })}</p><div class="row"><button data-act="pick-use" class="primary">Use this outline</button>
        <button data-act="pick-draw">Draw instead</button></div>`
    : "<p class=\"hint\">Click on this room's floor in the model.</p>"}
        <div class="row"><button data-act="pick-cancel">Cancel</button></div></section>`;
    }
    const sel = this.room(this.selectedRoom);
    const rooms = this.layout.rooms || [];
    const areas = this._areas();
    let out = '';
    if (sel) {
      const areaOpts = areas.map((a) => `<option value="${esc(a.area_id)}" ${a.area_id === sel.area_id ? 'selected' : ''}>${esc(a.name)}</option>`);
      if (sel.area_id && !areas.some((a) => a.area_id === sel.area_id)) areaOpts.unshift(this._coreOption('missingArea', { id: sel.area_id }, `selected value="${esc(sel.area_id)}"`));
      const fid = this.floorOf(sel);
      const missingFloor = fid && !this.floors.some((floor) => floor.id === fid);
      const floorOpts = (missingFloor ? this._coreOption('missingFloor', { id: fid }, `selected value="${esc(fid)}"`) : '')
        + this.floors.map((f) => `<option value="${esc(f.id)}" ${f.id === fid ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
      const doors = (sel.doors || []).map((p, i) => `<li>${this._coreCaption('doorNumber', { count: i + 1 })} <span class="dim">(${fmt(p[0])}, ${fmt(p[1])})</span> <button class="link" data-act="del-door" data-i="${i}">Remove</button></li>`).join('');
      out += `<section class="box">
        <h3>${esc(areaName(this.hass, sel.area_id))}</h3>
        <label>Area <select data-field="room-area">${areaOpts.join('')}</select></label>
        <label>Floor <select data-field="room-floor">${floorOpts}</select></label>
        ${missingFloor ? '<p class="note warn">This saved room has no current floor location. Choose its replacement deliberately; its outline is retained.</p>' : ''}
        <label class="check"><input type="checkbox" data-field="room-outdoor" ${sel.outdoor ? 'checked' : ''}> Outdoor (no walls)</label>
        <div class="sub">${this._coreCaption('doors')}</div>
        <ul class="plain">${doors || `<li class="dim">${this._coreCaption('noDoors')}</li>`}</ul>
        <button data-act="door-mode" class="${this.doorMode ? 'primary' : ''}">${this._coreCaption(this.doorMode ? 'clickWall' : 'addDoor')}</button>
        <p class="hint">Drag corners to reshape. Drag an edge midpoint to add a corner, right-click a corner to delete it.</p>
        <div class="row">
          <button data-act="delete-room" class="danger">${this._coreCaption(this.confirmDelete ? 'reallyDelete' : 'deleteRoom')}</button>
          <button data-act="deselect">Done</button>
        </div></section>`;
    }

    const byFloor = new Map(this.floors.map((f) => [f.id, []]));
    byFloor.set('', []);
    for (const a of areas) (byFloor.get(a.floor_id) || byFloor.get('')).push(a);
    for (const [fid, list] of byFloor) {
      if (!list.length) continue;
      const fname = fid ? esc(this.floors.find((f) => f.id === fid).name) : this._coreCaption('noFloor');
      out += `<div class="sub">${fname}</div><ul class="list">`;
      for (const a of list) {
        const mr = (this.card._modelRooms || []).find((x) => x.area_id === a.area_id);
        // A model link must not hide existing saved outlines, including a
        // stale second outline whose explicit floor needs deliberate repair.
        const saved = rooms.filter((x) => x.area_id === a.area_id);
        const selects = saved.map((r) => `<button data-act="select-room" data-id="${esc(r.id)}">${this._coreCaption('select')}${saved.length > 1 ? ` ${esc(r.name || r.id)}` : ''}</button>`).join('');
        out += `<li class="${saved.some((r) => r.id === this.selectedRoom) ? 'sel' : ''}"><span class="name">${esc(a.name)}</span>
          <span class="pill ${mr || saved.length ? 'ok' : 'missing'}">${this._coreCaption(mr ? 'modelBadge' : saved.length ? 'drawn' : 'missing')}</span>
          ${mr ? `<button data-act="tab" data-id="model">${this._coreCaption('model')}</button>` : ''}${selects}
          ${!mr && !saved.length ? `${this.view.model ? `<button data-act="pick" data-id="${esc(a.area_id)}">Pick</button>` : ''}<button data-act="draw" data-id="${esc(a.area_id)}">Draw</button>` : ''}</li>`;
      }
      out += '</ul>';
    }
    const orphans = rooms.filter((r) => !(this.hass.areas || {})[r.area_id]);
    if (orphans.length) {
      out += `<div class="sub">${this._coreCaption('roomOrphans')}</div><ul class="list">`;
      for (const r of orphans) out += `<li><span class="name">${esc(r.area_id || r.id)}</span><button data-act="select-room" data-id="${esc(r.id)}">${this._coreCaption('select')}</button></li>`;
      out += '</ul>';
    }
    if (!areas.length) out += '<p class="hint">No areas in Home Assistant yet. Create areas under Settings → Areas.</p>';

    out += this._roomActionsEditor.render();
    // floor heights come from the model when there is one; the table is for model-less layouts
    if (this.view.model) return out;
    const stored = new Set((this.layout.floors || []).map((f) => f.id));
    const haFloors = new Set(Object.keys(this.hass.floors || {}));
    out += `<details class="advanced" ${this._advancedOpen ? 'open' : ''}><summary>${this._coreCaption('advanced')}</summary>
      <div class="sub">${this._coreCaption('floors')}</div><table class="floors"><tr><th></th><th>${this._coreCaption('elevation')}</th><th>${this._coreCaption('floorHeight')}</th><th></th></tr>`;
    for (const f of this.floors) {
      out += `<tr><td>${esc(f.name)}</td>
        <td><input type="number" step="0.05" data-field="floor-elevation" data-id="${esc(f.id)}" value="${fmt(f.elevation)}"></td>
        <td><input type="number" step="0.05" min="0.5" data-field="floor-height" data-id="${esc(f.id)}" value="${fmt(f.height)}"></td>
        <td>${!haFloors.has(f.id) && stored.has(f.id) ? `<button class="link" data-act="del-floor" data-id="${esc(f.id)}">Remove</button>` : ''}</td></tr>`;
    }
    out += `</table><p class="hint">Floors come from Home Assistant (Settings → Areas → Floors). Add one here only for a level HA doesn't have.</p>
      <button data-act="add-floor">Add floor</button></details>`;
    return out;
  }

  _allMarkers() {
    return buildMarkers(this.hass, { ...this.layout, hidden: [] }, { group_by: this.card._config.group_by });
  }

  _devicesTab() {
    const all = this._allMarkers();
    const byId = new Map(all.map((m) => [m.id, m]));
    const hidden = this.layout.hidden || [];
    let out = '';
    const m = this.selectedMarker && byId.get(this.selectedMarker);
    if (m) {
      const pos = this.card._positions && this.card._positions.get(m.id);
      const pin = (this.layout.pins || {})[m.id];
      const pinned = !!pin;
      const attached = pin && pin.attach;
      const target = attached && this.card._objects && this.card._objects.objectAt(attached);
      if (m.id === this.card._mowerMarkerId) {
        return out + `<section class="box"><h3>${esc(m.name)}</h3><p class="dim">${esc(m.entityId)}</p>
          <p>Follows the live mower position. Set it up in the Mower tab.</p>
          <div class="row"><button data-act="deselect-marker">Done</button></div></section>`;
      }
      out += `<section class="box"><h3>${esc(m.name)}</h3>
        <p class="dim">${esc(m.entityId)}${m.areaId ? ' · ' + esc(areaName(this.hass, m.areaId)) : ''}</p>
        <p>${attached ? this._coreCaption(target ? 'attached' : 'attachedMissing', { name: (target && target.obj.label) || attached }) : this._coreCaption(pinned ? 'pinned' : 'autoPlaced')}</p>
        ${pos ? `<label>Height above floor (m) <input type="number" step="0.05" min="0" data-field="marker-z" value="${fmt(pos.z)}"></label>` : ''}
        <div class="row">
          ${attached ? '<button data-act="detach">Detach</button>' : ''}
          ${pinned ? '<button data-act="unpin">Return to auto placement</button>' : ''}
          <button data-act="hide">Hide</button>
          <button data-act="deselect-marker">Done</button>
        </div></section>`;
    }
    out += `<p class="hint">${this._coreCaption(this.view.model ? 'dragModelMarker' : 'dragMarker')}</p>`;

    const unplaced = all.filter((x) => !hidden.includes(x.id) && !hidden.includes(x.entityId) && !(this.card._positions || new Map()).has(x.id));
    out += `<div class="sub">${this._coreCaption('unplaced', { count: unplaced.length })}</div>`;
    if (unplaced.length) {
      out += '<ul class="list">';
      for (const x of unplaced) {
        out += `<li><span class="name">${esc(x.name)}<span class="dim"> · ${x.areaId ? esc(areaName(this.hass, x.areaId)) : this._coreCaption('noArea')}</span></span>
          <button data-act="place" data-id="${esc(x.id)}">Place</button></li>`;
      }
      out += '</ul>';
    } else out += '<p class="dim">Every device is on the plan.</p>';

    out += `<div class="sub">${this._coreCaption('hiddenCount', { count: hidden.length })}</div>`;
    if (hidden.length) {
      out += '<ul class="list">';
      for (const id of hidden) {
        const x = byId.get(id) || all.find((y) => y.entityId === id);
        out += `<li><span class="name">${esc(x ? x.name : id)}</span><button data-act="unhide" data-id="${esc(id)}">Unhide</button></li>`;
      }
      out += '</ul>';
    } else out += '<p class="dim">Nothing hidden.</p>';
    return out;
  }

  _hasObjects() {
    const mb = this.view.model && this.card.modelBindings();
    return !!(mb && mb.manifest.objects && mb.manifest.objects.length);
  }

  // Objects tab: model objects by level -> room (rooms collapsed), each with its entity binding.
  _objectsTab() {
    const mb = this.card.modelBindings();
    const objs = (mb && mb.manifest.objects) || [];
    const states = this.hass.states;
    const bindings = this.card._bindings || new Map();
    const DOMAINS = {
      light: ['light', 'switch'], light_strip: ['light', 'switch'], mower: ['lawn_mower'], dock: ['lawn_mower', 'binary_sensor'],
      ev_charger: ['sensor', 'switch', 'binary_sensor'], climate: ['climate'],
    };
    const ICONS = {
      light: 'mdi:lightbulb', light_strip: 'mdi:led-strip-variant', mower: 'mdi:robot-mower', dock: 'mdi:home-lightning-bolt',
      ev_charger: 'mdi:ev-station', climate: 'mdi:thermostat',
    };
    const listFor = (type) => {
      const d = DOMAINS[type];
      const selected = objs.filter((o) => (DOMAINS[o.type] ? o.type : 'other') === type)
        .map((o) => this.layout.objects?.[o.id]?.entity || bindings.get(o.id)?.requestedEntity || bindings.get(o.id)?.entity).filter(Boolean);
      return entityChoices(this.hass, { domains: d, selected, ...this._objectPickerFilter() });
    };
    const types = [...new Set(objs.map((o) => (DOMAINS[o.type] ? o.type : 'other')))];
    const datalists = types.map((t) => `<datalist id="fp-obj-${t}">${listFor(t).map((x) => `<option value="${esc(x.value)}">${esc(x.label)}${x.area?.name ? ' · ' + esc(x.area.name) : ''}</option>`).join('')}</datalist>`).join('');
    const lo = this.layout.objects || {};
    const rowHtml = (o) => {
      const b = bindings.get(o.id) || {};
      const t = DOMAINS[o.type] ? o.type : 'other';
      const saved = lo[o.id] || {};
      const explicit = saved.entity !== undefined;
      const sug = (o.suggest || {}).entity;
      let badge = '', value = '', ph = 'auto: none', phKey = 'autoNone', phParams = {};
      if (explicit) {
        value = saved.entity === null ? 'none' : saved.entity;
        if (b.missing) badge = `<span class="badge warn">${this._coreCaption('entityMissing')}</span>`;
      } else if (b.entity) { badge = `<span class="badge">${this._coreCaption('auto')}</span>`; ph = b.entity; phKey = null; } else if (sug) {
        badge = `<span class="badge warn">${this._coreCaption('entityMissing')}</span>`;
        ph = `auto: ${sug}`;
        phKey = 'autoEntity'; phParams = { id: sug };
      }
      if (b.filtered) badge = `<span class="badge warn">${this._coreFilterReason(b.filterReason || 'filtered entity')}</span>`;
      const sel = this.objSel === o.id;
      // Test only where a tap could toggle something (not hidden, own entity or a known group controller)
      const target = !b.hidden && actionTarget(o, b, this.card._groups || {}, states);
      const testable = !!target && (this.card._objectToggleCall ? !!this.card._objectToggleCall(target) : !b.filtered && !b.missing);
      return `<li class="obj${sel ? ' sel' : ''}${b.hidden ? ' hid' : ''}" data-obj="${esc(o.id)}">
        <div class="orow"><ha-icon icon="${ICONS[t] || 'mdi:cube-outline'}"></ha-icon><span class="name">${esc(o.label || o.id)}</span>${badge}
          ${testable ? `<button data-act="obj-test" data-id="${esc(o.id)}" title="Toggle it like a tap in the view">Test</button>` : ''}
          <label class="check"><input type="checkbox" data-field="obj-hidden" data-id="${esc(o.id)}" ${b.hidden ? 'checked' : ''}> Hide</label></div>
        <input list="fp-obj-${t}" data-field="obj-entity" data-id="${esc(o.id)}" value="${esc(value)}" ${phKey ? this._coreAttribute(phKey, phParams, 'placeholder') : `placeholder="${esc(ph)}"`} title="Empty: automatic; type none to leave it unbound">
        ${o.group ? `<div class="dim">${this._coreCaption('group', { id: o.group })}</div>` : ''}</li>`;
    };
    const levelOf = new Map(mb.manifest.levels.map((l) => [l.id, l]));
    const roomOf = new Map(mb.manifest.rooms.map((r) => [r.id, r]));
    const order = [...new Set([...mb.manifest.levels.map((l) => l.id), ...objs.map((o) => o.level)])];
    const areaOptions = [['all', 'All areas'], ['unassigned', 'Unassigned'], ...this._areas().map((area) => [`area:${area.area_id}`, area.name])];
    if (this._objectPickerArea && !areaOptions.some(([id]) => id === this._objectPickerArea)) areaOptions.push([this._objectPickerArea, 'Missing selected area', 'missingSelectedArea']);
    let out = datalists + `<label>Filter suggestions by area <select data-field="obj-picker-area">${areaOptions.map(([id, label, key]) => key ? this._coreOption(key, {}, `value="${esc(id)}" selected`) : `<option value="${esc(id)}" ${id === (this._objectPickerArea || 'all') ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`
      + '<p class="hint">Bind each model object to a Home Assistant entity. Empty means automatic; "none" leaves it unbound. Click an object in the plan to find its row.</p>';
    out += '<ul class="otree">';
    for (const lid of order) {
      const inLevel = objs.filter((o) => o.level === lid);
      if (!inLevel.length) continue;
      const lv = levelOf.get(lid);
      out += `<li class="room lvl"><span class="name">${lv ? esc(lv.label) : lid ? esc(lid) : this._coreCaption('noLevel')}</span></li>`;
      const roomIds = [...new Set(inLevel.map((o) => o.room || ''))];
      for (const rid of roomIds) {
        const list = inLevel.filter((o) => (o.room || '') === rid);
        const key = `${lid}/${rid}`;
        const open = this.objExpanded.has(key) || list.some((o) => o.id === this.objSel);
        const r = roomOf.get(rid);
        out += `<li class="room" style="--d:1"><button class="link expand" data-act="obj-expand" data-key="${esc(key)}">${open ? '\u25be' : '\u25b8'}</button>
          <span class="name">${r ? esc(r.label) : rid ? esc(rid) : this._coreCaption('noRoom')}</span><span class="dim">${list.length}</span></li>`;
        if (open) out += list.map(rowHtml).join('');
      }
    }
    out += '</ul>';
    const groups = [...new Set(objs.map((o) => o.group).filter(Boolean))].sort();
    if (groups.length) {
      const lg = this.layout.groups || {};
      const gl = entityChoices(this.hass, { domains: ['light', 'switch'], selected: groups.map((id) => lg[id]?.entity).filter(Boolean), ...this._objectPickerFilter() });
      out += `<div class="sub">${this._coreCaption('groups')}</div><p class="hint">A group controller must be on too: a fixture is lit only while its own entity and the controller are both on.</p>
        <datalist id="fp-grp-ents">${gl.map((x) => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('')}</datalist>`;
      out += groups.map((g) => {
        const e = (lg[g] && lg[g].entity) || '';
        const binding = this.card._groups?.[g];
        const missing = binding?.filtered ? ` <span class="badge warn">${this._coreFilterReason(binding.filterReason || 'filtered entity')}</span>`
          : e && !states[e] ? ` <span class="badge warn">${this._coreCaption('entityMissing')}</span>` : '';
        return `<label class="grp" data-grp="${esc(g)}">${esc(g)}${missing} <input list="fp-grp-ents" data-field="grp-entity" data-id="${esc(g)}"
        value="${esc(e)}" placeholder="no controller" title="Empty or none: no controller"></label>`;
      }).join('');
    }
    return out;
  }

  // A click on an object in 3D (Objects tab): open its room, select and show its row.
  selectObject(id) {
    const mb = this.card.modelBindings();
    const o = mb && mb.manifest.objects.find((x) => x.id === id);
    if (!o) return;
    this.objSel = id;
    this.objExpanded.add(`${o.level}/${o.room || ''}`);
    this.render();
    const row = [...this.panel.querySelectorAll('li.obj')].find((x) => x.dataset.obj === id);
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
      row.classList.add('flash');
    }
  }

  _mowerTab() {
    const m = this.mower();
    const posIds = this._mowerChoices(['device_tracker', 'sensor', 'lawn_mower', 'vacuum'], [m.entity]);
    const picIds = this._mowerChoices(['image', 'camera'], [m.image?.entity, m.overlay?.entity]);
    const datalist = (id, list) => `<datalist id="${id}">${list.map((choice) => `<option value="${esc(choice.value)}" ${choice.selectable ? '' : 'disabled'}>${esc(choice.label)}</option>`).join('')}</datalist>`;
    const floorId = m.floor_id || this.card._mowerFloor();
    const missingFloor = floorId && !this.floors.some((floor) => floor.id === floorId);
    const floorOpts = (missingFloor ? this._coreOption('missingFloor', { id: floorId }, `selected value="${esc(floorId)}"`) : '')
      + this.floors.map((f) => `<option value="${esc(f.id)}" ${f.id === floorId ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    const areaOptions = [['all', 'All areas'], ['unassigned', 'Unassigned'], ...this._areas().map((area) => [`area:${area.area_id}`, area.name])];
    if (this._mowerPickerArea && !areaOptions.some(([id]) => id === this._mowerPickerArea)) areaOptions.push([this._mowerPickerArea, 'Missing selected area', 'missingSelectedArea']);
    const warnings = [...posIds, ...picIds].filter((choice) => choice.selected && (!choice.selectable || !choice.available));
    const cal = m.calibration || [];
    const err = calibrationError(cal, m.source === 'xy' ? 'xy' : 'gps');
    let out = `<label>Filter suggestions by area <select data-field="mower-picker-area">${areaOptions.map(([id, label, key]) => key ? this._coreOption(key, {}, `value="${esc(id)}" selected`) : `<option value="${esc(id)}" ${id === (this._mowerPickerArea || 'all') ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
      ${warnings.map((choice) => `<p class="note warn" data-mower-link-warning>${this._coreCaption('savedMowerLink', { id: choice.value, label: choice.label })}</p>`).join('')}
      <div class="sub">${this._coreCaption('position')}</div>
      <label>Entity <input list="fp-pos-ents" data-field="mower-entity" value="${esc(m.entity || '')}" placeholder="device_tracker.mower_position"></label>
      ${datalist('fp-pos-ents', posIds)}
      <label>Source <select data-field="mower-source">
        <option value="gps" ${m.source !== 'xy' && m.source !== 'image' ? 'selected' : ''}>GPS (latitude / longitude)</option>
        <option value="xy" ${m.source === 'xy' ? 'selected' : ''}>Map x / y attributes</option>
        <option value="image" ${m.source === 'image' ? 'selected' : ''}>Live map image (mower icon colour)</option></select></label>
      ${m.source === 'xy' ? `<div class="row"><label>x attribute <input data-field="mower-xattr" value="${esc(m.x_attr || 'x')}"></label>
        <label>y attribute <input data-field="mower-yattr" value="${esc(m.y_attr || 'y')}"></label></div>` : ''}
      <label>Floor <select data-field="mower-floor">${floorOpts}</select></label>
      ${missingFloor ? '<p class="note warn">The saved floor is missing. Choose its replacement deliberately before placing the mower.</p>' : ''}
      <label class="check"><input type="checkbox" data-field="mower-trail" ${m.trail !== false ? 'checked' : ''}> Show trail (this session)</label>
      <p class="hint mower-live">${this._mowerLiveHtml()}</p>`;
    if (!m.entity) return out;

    if (m.source !== 'image') out += this._calibrationHtml(m, cal, err);
    else if (this.card._trail && this.card._trail.length) out += '<div class="row"><button data-act="trail-clear">Clear trail</button></div>';
    out += this._overlayHtml(m, picIds, datalist);
    if (m.source === 'image') out += this._mowerImageSection(m);
    out += '<div class="row"><button data-act="mower-remove" class="danger">Remove mower</button></div>';
    return out;
  }

  _objectPickerFilter() {
    const area = this._objectPickerArea;
    return area === 'unassigned' ? { areaId: null } : typeof area === 'string' && area.startsWith('area:') ? { areaId: area.slice(5) } : {};
  }

  _objectLinkAllowed(value, previous, type) {
    if (!value || value.toLowerCase() === 'none' || value === previous) return true;
    const domains = { light: ['light', 'switch'], light_strip: ['light', 'switch'], mower: ['lawn_mower'], dock: ['lawn_mower', 'binary_sensor'],
      ev_charger: ['sensor', 'switch', 'binary_sensor'], climate: ['climate'], group: ['light', 'switch'] }[type];
    if (entityChoices(this.hass, { domains, ...this._objectPickerFilter() }).some((choice) => choice.value === value && choice.selectable)) return true;
    this.message = this._coreNotice('objectLinkNotice', {}, { error: true });
    this.render(); return false;
  }

  _mowerChoices(domains, selected = [], useArea = true) {
    const area = useArea && this._mowerPickerArea;
    const filter = area === 'unassigned' ? { areaId: null } : typeof area === 'string' && area.startsWith('area:') ? { areaId: area.slice(5) } : {};
    return entityChoices(this.hass, { domains, selected: selected.filter(Boolean), ...filter });
  }

  _mowerLinkAllowed(value, previous, domains) {
    if (!value || value === previous) return true;
    if (this._mowerChoices(domains).some((choice) => choice.value === value && choice.selectable)) return true;
    this.message = this._coreNotice('mowerLinkNotice', {}, { error: true });
    this.render();
    return false;
  }

  _mowerImageSection(m) {
    const ic = m.image || {};
    const o = m.overlay;
    this._mowerImageScope = { id: (this._mowerImageScope?.id || 0) + 1, owner: this._mowerImageOwner(), poisoned: false };
    let out = `<div class="sub">${this._coreCaption('mowerIcon')}</div>`;
    out += `<label>Image entity <input list="fp-pic-ents" data-field="mower-img-entity" value="${esc(ic.entity || '')}" ${o && o.entity ? `placeholder="${esc(o.entity)}"` : this._coreAttribute('sameOverlay', {}, 'placeholder')}></label>`;
    if (this.colorPick) {
      out += `<section class="box"><p>Click the mower icon on the map overlay. Esc cancels.</p>
        <div class="row"><button data-act="img-pick-cancel">Cancel</button></div></section>`;
    }
    const sw = ic.color ? `<span class="swatch" style="display:inline-block;width:18px;height:18px;border-radius:4px;vertical-align:middle;border:1px solid var(--divider-color);background:rgb(${ic.color.map(Number).join(',')})"></span> rgb(${ic.color.join(', ')})` : '';
    out += `<div class="row"><button data-act="img-pick" class="${ic.color || this.colorPick ? '' : 'primary'}" ${this.colorPick || !(o && o.entity) ? 'disabled' : ''}>Pick mower colour</button> ${sw}</div>`;
    if (ic.color) {
      const tol = ic.tolerance ?? 40;
      out += `<label><span class="lab">${this._coreCaption('colourTolerance')}<span class="val" data-val="img-tolerance">${tol}</span></span>
        <input type="range" data-field="mower-img-tolerance" min="0" max="255" step="1" value="${tol}"></label>`;
    }
    out += `<label><span data-mower-image-text="minimumPixels">${esc(localize(this.hass, 'mower.minimumPixels'))}</span><input type="number" min="0" step="1" style="min-height:44px"
      data-field="mower-img-min-pixels" data-mower-image-scope="${this._mowerImageScope.id}" value="${esc(ic.min_pixels ?? 4)}"
      ${this._mowerImageAllowed() ? '' : 'disabled'}></label>
      <p class="hint" data-mower-image-text="minimumPixelsHint">${esc(localize(this.hass, 'mower.minimumPixelsHint'))}</p>
      <p data-mower-image-warning data-mower-image-text="minimumPixelsStale" ${this._mowerImageAllowed() ? 'hidden' : ''}>${esc(localize(this.hass, 'mower.minimumPixelsStale'))}</p>`;
    out += `<p class="hint">Align the map overlay with the plan first: the alignment maps image pixels to the plan, so no
      calibration points are needed. Then pick the colour of the mower icon on the map.</p>`;
    return out;
  }

  _mowerImageOwner() {
    const card = this.card, hass = this.hass, mower = this.mower();
    return [this._generation, card._config.layout_key, card._view?.model?.root,
      hass.connection, hass.auth, hass.connection?.options?.auth,
      JSON.stringify([hass.user?.id, hass.user?.is_admin, hass.user?.is_active, card.isConnected,
        card._editing, card._loading, hass.connection?.connected, mower.source, mower.image, mower.overlay])];
  }

  _mowerImageAllowed(element = null) {
    const scope = this._mowerImageScope, current = this._mowerImageOwner();
    const allowed = !!scope && !scope.poisoned && scope.owner.every((value, index) => value === current[index])
      && this.hass.user?.is_admin === true && this.hass.user?.is_active !== false
      && this.card.isConnected !== false && this.card._editing !== false && !this.card._loading
      && this.hass.connection?.connected === true;
    if (scope && !allowed) scope.poisoned = true;
    return allowed && (!element || this.panel.contains(element) && element.dataset.mowerImageScope === String(scope.id));
  }

  _syncMowerImageFields() {
    if (!this._mowerImageScope) return;
    const allowed = this._mowerImageAllowed();
    for (const field of this.panel.querySelectorAll('[data-mower-image-scope]')) field.disabled = !allowed;
    const warning = this.panel.querySelector('[data-mower-image-warning]');
    if (warning) warning.hidden = allowed;
    for (const caption of this.panel.querySelectorAll('[data-mower-image-text]')) {
      const value = localize(this.hass, `mower.${caption.dataset.mowerImageText}`);
      if (caption.textContent !== value) caption.textContent = value;
    }
  }

  _calibrationHtml(m, cal, err) {
    const fitKey = ['', 'fitShift', 'fitScale', 'fitAffine'][Math.min(cal.length, 3)];
    let out = `<div class="sub">${this._coreCaption('calibrationStart')}${this._coreCaption(cal.length === 1 ? 'pointsOne' : 'pointsMany', { count: cal.length })}${cal.length ? ': ' + this._coreCaption(fitKey) : ''})</div>`;
    if (this.calibrating) {
      out += `<section class="box"><p>Click on the plan where the mower is right now.</p>
        <div class="row"><button data-act="cal-cancel">Cancel</button></div></section>`;
    }
    out += '<ul class="plain">' + cal.map((c, i) => `<li>${i + 1}. (${c.src.map((v) => (m.source === 'xy' ? fmt(v) : v.toFixed(6))).join(', ')}) → (${fmt(c.plan[0])}, ${fmt(c.plan[1])})
      <button class="link" data-act="cal-del" data-i="${i}">Remove</button></li>`).join('') + '</ul>';
    if (cal.length >= 3) out += `<p class="dim">${this._coreCaption('fitError', { value: fmt(err) })}</p>`;
    out += `<div class="row"><button data-act="cal-add" class="${this.calibrating ? '' : 'primary'}" ${this.calibrating ? 'disabled' : ''}>Add point</button>
      ${this.card._trail && this.card._trail.length ? '<button data-act="trail-clear">Clear trail</button>' : ''}</div>
      <p class="hint">"Add point" takes the current reading, then you click where the mower really is. One point aligns
      a GPS track north-up, two fix rotation and scale, three or more also correct skew. Spread points far apart.</p>`;
    return out;
  }

  _overlayHtml(m, picIds, datalist) {
    let out = '';
    const o = m.overlay;
    out += `<div class="sub">${this._coreCaption('mapOverlay')}</div>
      <label>Image or camera entity <input list="fp-pic-ents" data-field="ov-entity" value="${esc((o && o.entity) || '')}" placeholder="image.mower_map"></label>
      ${datalist('fp-pic-ents', picIds)}`;
    if (o && o.entity) {
      const slider = (f, label, min, max, step, v) => `<label><span class="lab">${['x', 'y'].includes(f) ? label : this._coreCaption(f)}<span class="val" data-val="${f}">${fmt(v)}</span></span>
        <input type="range" data-field="ov-${f}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
      out += slider('x', 'x (m)', -100, 100, 0.05, o.x ?? 0)
        + slider('y', 'y (m)', -100, 100, 0.05, o.y ?? 0)
        + slider('rotation', 'Rotation (°)', -180, 180, 0.5, o.rotation ?? 0)
        + slider('width', 'Width (m)', 1, 200, 0.1, o.width ?? 20)
        + slider('opacity', 'Opacity', 0, 1, 0.05, o.opacity ?? 0.6)
        + (o.entity.startsWith('camera.') ? slider('refresh', 'Refresh every (s)', 1, 120, 1, o.refresh ?? 10) : '');
      out += `<div class="row"><button data-act="ov-move" class="${this.overlayMove ? 'primary' : ''}">${this._coreCaption(this.overlayMove ? 'dragMap' : 'moveMap')}</button>
        <button data-act="ov-remove">Remove overlay</button></div>`;
    }
    return out;
  }

  // ---------- views ----------
  // The view the Views tab edits: a hidden view picked in its select, else the active chip.
  _vwView() {
    const vs = this.card._views || [];
    // (kept while the view is visible: a hide is committed before the view list catches up)
    const v = this.vwSel && vs.find((x) => x.id === this.vwSel);
    if (v && v.hidden) return v;
    return this.card.currentView();
  }

  // the card switched views (chip or select)
  onViewChanged() {
    if (this.tab === 'data') this._dashboardBackupEditor.onStates();
    this._furnitureDrag.update();
    this.vwSel = null;
    this._closeMenu();
    if (this.tab === 'views') this.render();
    if (this.tab === 'idle') this._ambientIdleEditor.updatePreviews(this.panel);
    if (this.tab === 'house') this._houseSummaryEditor.updatePreviews(this.panel);
    if (this.tab === 'furniture') this._furnitureEditor.updatePreviews(this.panel);
    if (this.tab === 'model') { this._wallSurfacePick(); this._wallPresentationEditor.updatePreviews(this.panel); this._floorPresentationEditor.updatePreviews(this.panel); this._syncStageClasses(); }
    if (this.tab === 'tracking') {
      this._trackingPlanPick(); // Cancel a capture as soon as its floor is no longer displayed.
      this.refreshOverlay();
      this._syncStageClasses();
      this._trackingEditor.updatePreviews(this.panel);
    }
  }

  _furnitureLibraryDetails() {
    const catalogue = this.card.furnitureCatalogue?.();
    if (catalogue?.status !== 'ready' || !Array.isArray(catalogue.catalogue?.packs)) return '';
    return `<details data-furniture-licences><summary>${this._coreCaption('packLicences')}</summary>
      <p>${this._coreCaption('packLicenceHelp')}</p>
      ${catalogue.catalogue.packs.map((pack) => `<section class="box"><h4>${esc(pack.manifest?.name || pack.pack_id)}</h4>
        <p>${this._coreCaption('packAuthor')}${pack.manifest?.author ? esc(pack.manifest.author) : this._coreCaption('notSupplied')}${this._coreCaption('declaredLicence')}${pack.manifest?.license?.id ? esc(pack.manifest.license.id) : this._coreCaption('notSupplied')}.</p>
        <p>${this._coreCaption('licenceFile')}${pack.manifest?.license?.file ? esc(pack.manifest.license.file) : this._coreCaption('notSupplied')}.</p>
        <button data-act="library-export" data-pack="${esc(pack.pack_id)}">${this._coreCaption('downloadPack')}</button></section>`).join('')}</details>`;
  }

  _layoutRules(id) {
    const v = (this.layout.views || {})[id];
    return v && Array.isArray(v.rules) ? v.rules : [];
  }

  _setRule(id, sel, state) {
    this.card.saveViewPatch(id, { rules: setRuleState(this._layoutRules(id), sel, state) });
  }

  // Tree rows for the loaded model, with the manifest's labels (cached per node index).
  _tree() {
    const idx = this.card.viewIndex();
    const mb = this.card._mb;
    if (!idx || !mb) return null;
    if (this._treeCache && this._treeCache.idx === idx) return this._treeCache.tree;
    const labels = {};
    for (const l of mb.manifest.levels) labels['level:' + l.id] = l.label;
    for (const r of mb.manifest.rooms) labels[r.kind + ':' + r.id] = r.label;
    for (const o of mb.manifest.objects || []) if (o.label) labels['object:' + o.id] = o.label;
    const tree = viewTree(idx, labels);
    const rowOf = new Map(); // node position -> selector of the row listing it
    for (const r of [...tree.tree, ...tree.groups]) for (const i of r.nodes) if (!rowOf.has(i)) rowOf.set(i, r.sel);
    tree.rowOf = rowOf;
    this._treeCache = { idx, tree };
    return tree;
  }

  _viewsTab() {
    const card = this.card;
    const screen = `<section class="box"><label>Screen name (this browser)<input data-field="screen-name" maxlength="128" style="min-height:44px" value="${esc(this._panelNameDraft ?? card._panelName ?? '')}" ${card._config.automation_panel ? `placeholder="${esc(card._config.automation_panel)}"` : this._coreAttribute('screenExample', {}, 'placeholder')}></label>
      <button data-act="save-screen-name" style="min-height:44px">Save screen name</button><p class="hint">Give each wall panel/browser a different name, e.g. kitchen-wall. This is saved only on this browser; your layout remains shared. Leave blank to use the card's screen name.</p></section>`;
    const views = card._views || [];
    const v = this._vwView();
    if (!v) return screen + '<p class="hint">No views yet.</p>';
    const st = card._stateFor(v);
    const lv = (this.layout.views || {})[v.id] || {};
    const i = views.indexOf(v);
    const visible = views.filter((x) => !x.hidden).length;
    const opts = views.map((x) => x.hidden ? this._coreOption('hiddenView', { name: x.label }, `value="${esc(x.id)}" ${x.id === v.id ? 'selected' : ''}`) : `<option value="${esc(x.id)}" ${x.id === v.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    const hideLabel = v.source === 'added' ? 'deleteView' : v.hidden ? 'unhideView' : 'hideView';
    const top = card._mode === 'top';
    let out = screen + `<p class="hint">Each view is a button on the card. Choose what it shows: click a part of the model, or use the eyes below.</p>
      <label>View <select data-field="vw-view">${opts}</select></label>
      <p class="hint">${this._coreCaption('viewId')}<code data-view-id>${esc(v.id)}</code>${this._coreCaption('viewIdHelp')}</p>
      <label>Label <input data-field="vw-label" value="${esc(v.label)}"></label>
      <div class="row"><button data-act="vw-add">Add view</button>
        <button data-act="vw-hide" ${!v.hidden && v.source !== 'added' && visible <= 1 ? 'disabled' : ''} class="${v.source === 'added' ? 'danger' : ''}">${this._coreCaption(hideLabel)}</button>
        <button data-act="vw-up" ${i <= 0 ? 'disabled' : ''} title="Move left">Up</button>
        <button data-act="vw-down" ${i < 0 || i >= views.length - 1 ? 'disabled' : ''} title="Move right">Down</button></div>
      <div class="sub">${this._coreCaption('linkedFloors')}</div>
      <div class="floor-links">${this.floors.map((f) => `<label class="check"><input type="checkbox" data-field="vw-floor" data-id="${esc(f.id)}" ${st.floors.includes(f.id) ? 'checked' : ''}> ${esc(f.name)}</label>`).join('')}</div>
      ${st.floors.filter((id) => !this.floors.some((floor) => floor.id === id)).map((id) => `<label class="check note warn" data-missing-view-floor><input type="checkbox" checked data-field="vw-floor" data-id="${esc(id)}"> ${this._coreCaption('missingViewFloor', { id })}</label>`).join('')}
      <p class="hint">Devices on linked floors show in this view. None checked: the view belongs to no floor (e.g. a garden view).</p>
      <div class="sub">${this._coreCaption(top ? 'cameraTop' : 'camera')}</div>
      <p class="hint">${this._coreCaption(top ? (v.camera_top ? 'savedTop' : 'currentTop') : v.camera ? 'savedCamera' : 'framedCamera')}</p>
      <div class="row"><button data-act="vw-save-cam" ${v.hidden ? 'disabled' : ''}>Save current view as start</button>
        <button data-act="vw-reset-cam" ${(top ? lv.camera_top : lv.camera) ? '' : 'disabled'}>Reset camera</button></div>
      <div class="row">${this.pivoting ? '<button data-act="vw-pivot-cancel">Cancel</button>'
    : `<button data-act="vw-pivot" ${v.hidden || v.id !== card._viewId ? 'disabled' : ''} title="Click a point: the camera rotates and zooms around it">Set rotation centre</button>`}</div>
      ${this.pivoting ? '<p class="hint">Click where the rotation centre should be (Esc cancels).</p>' : ''}
      <label>Zoom towards <select data-field="vw-zoom-to">${[['', 'cardDefault'], ['center', 'centre'], ['cursor', 'cursor']]
    .map(([val, key]) => this._coreOption(key, { value: zoomToFor(null, card._config) }, `value="${val}" ${(lv.zoom_to || '') === val ? 'selected' : ''}`)).join('')}</select></label>`;
    out += this._sectionHtml(v, lv);
    if (this.view.model && !this.view.isTagged()) {
      out += `<label class="check"><input type="checkbox" data-field="vw-cut" ${(v.cut ?? v.id !== 'all') ? 'checked' : ''}> Cut at storey height</label>`;
    }
    const idx = card.viewIndex();
    const tree = this._tree();
    const rules = this._layoutRules(v.id);
    if (idx && tree && this.view.model) {
      const eff = st.effective;
      // fully shown = the node and everything below it visible (nodes are in pre-order)
      const full = new Array(idx.nodes.length);
      for (let k = idx.nodes.length - 1; k >= 0; k--) full[k] = !eff || (!!eff[k] && idx.nodes[k].children.every((c) => full[c]));
      const yamlRules = ((card._config.views || {})[v.id] || {}).rules;
      const yamlSels = new Set((Array.isArray(yamlRules) ? yamlRules : []).map((r) => r && (r.show ?? r.hide)));
      const eyeTitle = { default: 'eyeDefault', shown: 'eyeShown', hidden: 'eyeHidden' };
      const eyeIcon = { default: 'mdi:eye-outline', shown: 'mdi:eye', hidden: 'mdi:eye-off' };
      const row = (r, cls = '') => {
        const on = eff ? r.nodes.some((n) => eff[n]) : true;
        const part = on && !r.nodes.every((n) => full[n]);
        const state = ruleState(rules, r.sel);
        const picked = this.vwPick && this.vwPick.sel === r.sel ? ' picked' : '';
        const vis = part ? ['partlyTitle', 'mdi:circle-half-full'] : on ? ['visibleTitle', 'mdi:cube-outline'] : ['hiddenTitle', 'mdi:cube-off-outline'];
        const open = this.vwExpanded.has(r.sel);
        const toggle = r.children && !r.sel.startsWith('level:')
          ? `<button class="link expand" data-act="vw-expand" data-sel="${esc(r.sel)}" ${this._coreAttribute(open ? 'hideObjects' : 'showObjects', { count: r.children })}>${open ? '\u25be' : '\u25b8'}</button>` : '';
        return `<li data-sel="${esc(r.sel)}" class="${cls}${on ? '' : ' off'}${part ? ' part' : ''}${picked}" style="--d:${r.depth}" title="${esc(r.path || r.sel)}">
          <span class="state" ${this._coreAttribute(vis[0])}><ha-icon icon="${vis[1]}"></ha-icon></span>
          <span class="name">${esc(r.label)}${part ? ` <span class="dim">${this._coreCaption('partly')}</span>` : ''}</span>${toggle}
          ${yamlSels.has(r.sel) ? `<span class="yaml" ${this._coreAttribute('overrideTitle')}>${this._coreCaption('cardOverride')}</span>` : ''}
          <button class="eye ${state}" data-act="vw-eye" data-sel="${esc(r.sel)}" ${this._coreAttribute(eyeTitle[state])}><ha-icon icon="${eyeIcon[state]}"></ha-icon></button></li>`;
      };
      const shownRows = tree.tree.filter((r) => !r.parent || r.parent.startsWith('level:') || this.vwExpanded.has(r.parent));
      out += `<div class="sub">${this._coreCaption('model')}</div>`;
      out += tree.tree.length ? '<ul class="vtree">' + shownRows.map((r) => row(r, r.sel.startsWith('level:') ? 'lvl' : '')).join('') + '</ul>'
        : '<p class="dim">No tagged levels or rooms.</p>';
      if (tree.layers.length) out += `<div class="sub">${this._coreCaption('layers')}</div><ul class="vtree">` + tree.layers.map((r) => row(r)).join('') + '</ul>';
      if (tree.groups.length) out += `<div class="sub">${this._coreCaption('modelGroups')}</div><ul class="vtree">` + tree.groups.map((r) => row(r)).join('') + '</ul>';
      const gone = unmatchedSelectors(idx, rules);
      if (gone.length) {
        out += `<div class="sub">${this._coreCaption('notInModel')}</div><ul class="vtree">` + gone.map((s) => `<li class="gone" data-sel="${esc(s)}"><span class="name">${esc(s)}</span>
          <button class="link" data-act="vw-rm" data-sel="${esc(s)}">Remove</button></li>`).join('') + '</ul>';
      }
    } else if (!this.view.model) {
      out += '<p class="hint">Upload a model (Model tab) to choose which parts each view shows.</p>';
    }
    out += `<div class="row"><button data-act="vw-reset" class="danger" ${rules.length || lv.camera || lv.camera_top ? '' : 'disabled'}>Reset this view</button></div>`;
    return out;
  }

  // "Side section" block: direction + position of the cut (layout.views[id].section, card world).
  _sectionHtml(v, lv) {
    const box = this.view.model && this.view.sectionBox();
    if (!box) return '';
    const plane = this.card.sectionPlaneNow(v);
    if (!plane) return '';
    const dir = sectionDir(plane.normal);
    const [lo, hi] = this._sectionRange(dir.normal, box);
    const pos = Math.min(hi, Math.max(lo, sectionPos(plane)));
    const opts = SECTION_DIRS.map((d) => this._coreOption(`keep${d.id[0].toUpperCase()}${d.id.slice(1)}`, {}, `value="${d.id}" ${d.id === dir.id ? 'selected' : ''}`)).join('');
    const src = lv.section ? 'sectionSaved' : v.modelSection ? 'sectionModel' : 'sectionDefault';
    return `<div class="sub">${this._coreCaption('section')}</div>
      <p class="hint">${this._coreCaption('sectionHelp')}${this._coreCaption(src)}</p>
      <label>Direction <select data-field="vw-sec-dir">${opts}</select></label>
      <label><span class="lab">${this._coreCaption(dir.normal[0] ? 'sectionEast' : 'sectionNorth')}<span class="val" data-val="vw-sec-pos">${fmt(pos)}</span></span>
        <input type="range" data-field="vw-sec-pos" min="${lo}" max="${hi}" step="0.05" value="${pos}"></label>
      <div class="row"><button data-act="vw-sec-reset" ${lv.section ? '' : 'disabled'}>Reset section</button></div>`;
  }

  // slider range: the model box along the axis, on the 0.05 m grid
  _sectionRange(normal, box) {
    const [a, b] = sectionRange(normal, box);
    return [Math.floor(a / 0.05) * 0.05, Math.ceil(b / 0.05) * 0.05].map((x) => Math.round(x * 100) / 100);
  }

  _sectionFromPanel(v, pos) {
    const sel = this.panel.querySelector('[data-field="vw-sec-dir"]');
    const dir = SECTION_DIRS.find((d) => d.id === (sel && sel.value)) || SECTION_DIRS[0];
    return sectionAt(dir.normal, Math.round(pos * 100) / 100);
  }

  _nodePos(idx, node) {
    if (!this._posCache || this._posCache.idx !== idx) this._posCache = { idx, map: new Map(idx.nodes.map((n, i) => [n.node, i])) };
    const p = this._posCache.map.get(node);
    return p === undefined ? -1 : p;
  }

  cancelPivot() {
    this.pivoting = false;
    this._syncStageClasses();
    this.render();
  }

  // "Set rotation centre": the clicked model point (else the view's floor plane) becomes the
  // controls target; saved with the camera (3D) or as the top-view centre (top).
  _setPivot(e) {
    const card = this.card, v = card.currentView();
    card.leaveSection();
    const point = this.view.pivotPoint(e.clientX, e.clientY, this.view.floorElevation(card._floor));
    if (!point || !v) {
      this.message = this._coreNotice('pickPivotNotice', {}, { warn: true });
      this.render();
      return;
    }
    this.pivoting = false;
    this._syncStageClasses();
    if (card._mode === 'top') {
      const cur = this.view.getTopCamera();
      const camera_top = { center: [Math.round(point[0] * 100) / 100 + 0, Math.round(-point[2] * 100) / 100 + 0], zoom: cur.zoom };
      this.view.setTopCamera(camera_top);
      this.message = this._coreNotice('topCentreNotice', { name: v.label });
      card.saveViewPatch(v.id, { camera_top, camera_mode: card._mode });
    } else {
      const camera = this.view.setPivot(point);
      this.message = this._coreNotice('pivotNotice', { name: v.label });
      card.saveViewPatch(v.id, { camera, camera_mode: card._mode });
    }
    this.render();
  }

  // Click on the model (Views tab): highlight the part and offer hide/show.
  _pickView(e) {
    const idx = this.card.viewIndex();
    const owner = idx ? this.view.pickModel(e.clientX, e.clientY) : null;
    const p = owner && owner.hit ? pickSelector(idx, this._nodePos(idx, owner.hit.object), owner.kind === 'untagged' ? null : owner) : null;
    this._closeMenu();
    if (!p) {
      this.vwPick = null;
      this.view.highlightModelNode(null);
      this.message = this._coreNotice('pickModelNotice', {}, { warn: true });
      this.render();
      return;
    }
    this.vwPick = { sel: p.sel, idx: p.idx };
    this.message = null;
    this.view.highlightModelNode(idx.nodes[p.idx].node);
    const tree = this._tree();
    const r = tree && [...tree.tree, ...tree.layers, ...tree.groups].find((x) => x.sel === p.sel);
    this._openMenu(e, r ? r.label : idx.nodes[p.idx].name || p.sel);
    this.render();
  }

  _openMenu(e, title) {
    const stage = this.card._stage;
    const m = document.createElement('div');
    m.className = 'fp-pickmenu';
    m.innerHTML = `<div class="title" title="${esc(this.vwPick.sel)}">${esc(title)}</div>
      <button data-act="vw-hide-here">${this._coreCaption('hideHere')}</button>
      <button data-act="vw-show-here">${this._coreCaption('showHere')}</button>
      <button data-act="vw-hide-all">${this._coreCaption('hideAll')}</button>
      <button data-act="vw-reveal">${this._coreCaption('revealTree')}</button>`;
    m.addEventListener('click', (ev) => this._onMenuClick(ev));
    stage.append(m);
    const r = stage.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    const x = Math.max(4, Math.min(e.clientX - r.left + 8, r.width - w - 4));
    const y = Math.max(4, Math.min(e.clientY - r.top + 8, r.height - h - 4));
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    this.menu = m;
    window.addEventListener('pointerdown', this._onMenuAway, true);
  }

  _closeMenu() {
    if (!this.menu) return;
    window.removeEventListener('pointerdown', this._onMenuAway, true);
    this.menu.remove();
    this.menu = null;
  }

  _onMenuClick(e) {
    const btn = e.target.closest('[data-act]');
    const pick = this.vwPick;
    if (!btn || !pick) return;
    const cur = this.card.currentView();
    this._closeMenu();
    switch (btn.dataset.act) {
      case 'vw-hide-here':
      case 'vw-show-here':
        if (!cur) return;
        this.vwPick = null;
        this.view.highlightModelNode(null);
        this._setRule(cur.id, pick.sel, btn.dataset.act === 'vw-hide-here' ? 'hidden' : 'shown');
        return;
      case 'vw-hide-all': {
        const views = { ...(this.layout.views || {}) };
        for (const v of this.card._views) {
          if (v.hidden) continue;
          views[v.id] = { ...(views[v.id] || {}), rules: setRuleState(this._layoutRules(v.id), pick.sel, 'hidden') };
        }
        this.vwPick = null;
        this.view.highlightModelNode(null);
        this.commit({ ...this.layout, views });
        return;
      }
      case 'vw-reveal': this._reveal(pick); return;
      default:
    }
  }

  // Scroll the tree row of a picked part (or of its nearest listed ancestor) into view and flash it.
  _reveal(pick) {
    this.tab = 'views';
    const tree = this._tree();
    const r = tree && tree.tree.find((x) => x.sel === pick.sel);
    if (r && r.parent && !r.parent.startsWith('level:')) this.vwExpanded.add(r.parent);
    this.render();
    const idx = this.card.viewIndex();
    let sel = pick.sel;
    const rows = () => [...this.panel.querySelectorAll('ul.vtree li[data-sel]')];
    if (!rows().some((li) => li.dataset.sel === sel) && tree && idx) {
      const shown = new Set(rows().map((li) => li.dataset.sel));
      for (let p = pick.idx; p >= 0; p = idx.nodes[p].parent) if (shown.has(tree.rowOf.get(p))) { sel = tree.rowOf.get(p); break; }
    }
    const li = rows().find((x) => x.dataset.sel === sel);
    if (!li) return;
    li.scrollIntoView({ block: 'nearest' });
    li.classList.remove('flash');
    void li.offsetWidth; // restart the animation
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 1300);
  }

  // Panel buttons of the Views tab. Returns true when handled.
  _viewsClick(act, btn) {
    const card = this.card;
    const v = this._vwView();
    if (!v) return false;
    const after = (fn) => queueMicrotask(fn); // runs after the commit's rebuild (queued first)
    switch (act) {
      case 'vw-add': {
        const { id, n } = nextViewId([...card._views.map((x) => x.id), ...Object.keys(this.layout.views || {})]);
        // a copy of the current view: all its rules (model / generated base + saved), so it looks the same
        const camera = card._mode === 'top' ? { camera_top: this.view.getTopCamera() } : { camera: this.view.getCamera() };
        const section = v.section || v.modelSection ? card.sectionPlaneNow?.(v) || v.section : null;
        const views = { ...(this.layout.views || {}), [id]: { added: true, label: `View ${n}`, rules: (v.rules || []).map((r) => ({ ...r })),
          floors: Array.isArray(v.floors) ? [...v.floors] : null,
          ...(section ? { section: { normal: [...section.normal], constant: section.constant } } : {}), camera_mode: card._mode, ...camera } };
        this.vwSel = null;
        this.commit({ ...this.layout, views });
        after(() => card._setView(id));
        return true;
      }
      case 'vw-hide': {
        if (v.source === 'added') {
          const views = { ...(this.layout.views || {}) };
          delete views[v.id];
          const order = this.layout.view_order;
          this.vwSel = null;
          this.commit({ ...this.layout, views, ...(Array.isArray(order) ? { view_order: order.filter((x) => x !== v.id) } : {}) });
        } else if (v.hidden) {
          this.vwSel = null;
          card.saveViewPatch(v.id, { hidden: false });
          after(() => card._setView(v.id));
        } else {
          this.vwSel = v.id; // keep editing it, so it can be unhidden
          card.saveViewPatch(v.id, { hidden: true });
        }
        return true;
      }
      case 'vw-up':
      case 'vw-down': {
        const ids = card._views.map((x) => x.id);
        const i = ids.indexOf(v.id), j = i + (act === 'vw-up' ? -1 : 1);
        if (i < 0 || j < 0 || j >= ids.length) return true;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        this.commit({ ...this.layout, view_order: ids });
        return true;
      }
      case 'vw-save-cam':
        card.leaveSection();
        if (card._mode === 'top') {
          this.message = this._coreNotice('savedTopNotice', { name: v.label });
          card.saveViewPatch(v.id, { camera_top: this.view.getTopCamera(), camera_mode: card._mode });
        } else {
          this.message = this._coreNotice('savedCameraNotice', { name: v.label });
          card.saveViewPatch(v.id, { camera: this.view.getCamera(), camera_mode: card._mode });
        }
        this.render();
        return true;
      case 'vw-pivot':
        card.leaveSection();
        this.pivoting = true;
        this._syncStageClasses();
        this.render();
        return true;
      case 'vw-pivot-cancel':
        this.cancelPivot();
        return true;
      case 'vw-expand': {
        const sel = btn.dataset.sel;
        if (this.vwExpanded.has(sel)) this.vwExpanded.delete(sel);
        else this.vwExpanded.add(sel);
        this.render();
        return true;
      }
      case 'vw-sec-reset':
        card.saveViewPatch(v.id, { section: null });
        return true;
      case 'vw-reset-cam':
      case 'vw-reset':
        card.saveViewPatch(v.id, act === 'vw-reset' ? { rules: [], camera: null, camera_top: null, camera_mode: null }
          : card._mode === 'top' ? { camera_top: null } : { camera: null });
        if (v.id === card._viewId) after(() => card._resetCamera());
        return true;
      case 'vw-eye': {
        const sel = btn.dataset.sel;
        this._setRule(v.id, sel, nextEyeState(ruleState(this._layoutRules(v.id), sel)));
        return true;
      }
      case 'vw-rm':
        this._setRule(v.id, btn.dataset.sel, 'default');
        return true;
      default:
        return false;
    }
  }

  _viewsChange(f, el) {
    const card = this.card;
    if (f === 'vw-view') {
      const v = card._views.find((x) => x.id === el.value);
      if (!v) return;
      this.vwPick = null;
      this.view.highlightModelNode(null);
      if (v.hidden) { this.vwSel = v.id; this.render(); return; }
      this.vwSel = null;
      if (v.id === card._viewId) this.render();
      else card._setView(v.id);
      return;
    }
    const v = this._vwView();
    if (!v) return;
    if (f === 'vw-sec-pos') card.saveViewPatch(v.id, { section: this._sectionFromPanel(v, Number(el.value)) });
    else if (f === 'vw-sec-dir') {
      // a new axis: start in the middle of the model along it
      const box = this.view.sectionBox();
      const dir = SECTION_DIRS.find((d) => d.id === el.value);
      if (!box || !dir) return;
      const [lo, hi] = this._sectionRange(dir.normal, box);
      const old = card.sectionPlaneNow(v);
      const same = old && !!sectionDir(old.normal).normal[0] === !!dir.normal[0];
      const section = sectionAt(dir.normal, same ? sectionPos(old) : Math.round(((lo + hi) / 2) * 20) / 20);
      card.previewSection(v.id, section, { aim: true });
      card.saveViewPatch(v.id, { section }); // drops the preview: the saved plane takes over
    } else if (f === 'vw-label') card.saveViewPatch(v.id, { label: el.value.trim() || undefined });
    else if (f === 'vw-cut') card.saveViewPatch(v.id, { cut: el.checked });
    else if (f === 'vw-zoom-to') card.saveViewPatch(v.id, { zoom_to: el.value || undefined });
    else if (f === 'vw-floor') {
      const cur = card._stateFor(v).floors;
      const changed = el.dataset.id;
      if (!cur.includes(changed) && !this.floors.some((floor) => floor.id === changed)) return;
      const floors = cur.filter((id) => id !== changed);
      if (el.checked) floors.push(changed);
      card.saveViewPatch(v.id, { floors });
    }
  }

  // ---------- model ----------
  onModelLoaded(changed = true) {
    this._dashboardBackupEditor.onStates();
    if (!changed) return; // same model re-placed (alignment, opacity): the panel is already current
    if (this._freshModel) { // a newly uploaded model: everything in it counts as seen
      this._freshModel = false;
      this._snapshotKnown();
      return;
    }
    if (this.tab === 'model') this.render();
  }

  // Remember which levels/rooms the user has been shown, so the regeneration notice only reports changes.
  _snapshotKnown() {
    const man = this.card.modelBindings();
    if (!man) return;
    this.setModelProps({ known: { levels: man.manifest.levels.map((l) => l.id), rooms: man.manifest.rooms.map((r) => r.id) } });
  }

  // A pin placed while a model is loaded sits on the model and follows its alignment.
  _onModel(id) {
    const pin = (this.layout.pins || {})[id];
    return !!this.view.model || !!(pin && pin.on_model);
  }

  setModelProps(patch, rerender = true) {
    const cur = this.layout.model || {};
    let layout = { ...this.layout, model: { ...cur, ...patch } };
    // alignment change of an uploaded model (YAML alignment overrides win): pins on the model follow it
    if (!this.card._config.model && ('position' in patch || 'rotation' in patch || 'scale' in patch)) {
      const align = (m) => ({ position: m.position || [0, 0, 0], rotation: m.rotation || 0, scale: m.scale || 1 });
      // first alignment change with a model loaded: v0.2.x pins on floors bound to a model level follow it from now on
      if (this.view.model && !cur.pins_migrated) {
        const mb = this.card.modelBindings();
        const bound = mb ? Object.values(mb.levels || {}).map((a) => a && a.floor).filter(Boolean) : [];
        layout = E.migrateLegacyPins(layout, bound);
      }
      layout = E.realignPins(layout, align(cur), align(layout.model));
    }
    this.card._commit(layout);
    if (rerender) this.render();
  }

  _modelPositionOwner() {
    const card = this.card, hass = this.hass, model = this.layout.model;
    return [this._generation, card._config, card._config.layout_key, card._view?.model?.root,
      hass.connection, hass.auth, hass.connection?.options?.auth,
      JSON.stringify([hass.user?.id, hass.user?.is_admin, hass.user?.is_active,
        card.isConnected, card._editing, card._loading, hass.connection?.connected, card._config.model,
        model?.version, model?.name, model?.size, model?.uploaded])];
  }

  _modelPositionAllowed(element = null) {
    const scope = this._modelPositionScope, owner = this._modelPositionOwner();
    const allowed = !!scope && !scope.poisoned && scope.owner.every((value, index) => value === owner[index])
      && this.hass.user?.is_admin === true && this.hass.user?.is_active !== false && !this.card._loading
      && this.card.isConnected !== false && this.card._editing !== false && !this.card._config.model
      && (!this.hass.connection || this.hass.connection.connected === true) && !!this.layout.model;
    if (scope && !allowed) { scope.poisoned = true; this._modelPositionCommit = null; }
    return allowed && (!element || this.panel.contains(element) && element.dataset.modelPositionScope === String(scope.id));
  }

  _syncModelPositionFields(syncCompanions = false) {
    if (!this._modelPositionScope) return;
    const allowed = this._modelPositionAllowed(), active = this.panel.getRootNode().activeElement;
    for (const field of this.panel.querySelectorAll('[data-model-position-scope]')) {
      field.disabled = !allowed;
      if (allowed && field !== active) {
        const value = (this.layout.model.position || [0, 0, 0])['xyz'.indexOf(field.dataset.field.slice(-1))];
        if (field.value !== String(value)) field.value = value;
      }
    }
    if (syncCompanions && allowed && !this._sliding) {
      for (const [index, axis, min, max] of [[0, 'x', -50, 50], [1, 'y', -50, 50], [2, 'z', -5, 5]]) {
        const range = this.panel.querySelector(`[data-field="md-${axis}"]`);
        if (!range || range === active) continue;
        const value = (this.layout.model.position || [0, 0, 0])[index];
        range.min = String(Math.min(min, Number.isFinite(value) ? value : min));
        range.max = String(Math.max(max, Number.isFinite(value) ? value : max));
        range.value = String(value);
        const caption = this.panel.querySelector(`[data-val="${axis}"]`);
        if (caption) caption.textContent = fmt(value);
      }
    }
    const warning = this.panel.querySelector('[data-model-position-warning]');
    if (warning) warning.hidden = allowed;
  }

  _modelApi() {
    return `/api/taylors3d/model/${encodeURIComponent(this.card._config.layout_key)}`;
  }

  _assetContext() {
    this._navigation.observe();
    const card = this.card, hass = this.hass, user = hass.user;
    return [this._generation, this._navigation._epoch, card._config, card._config?.layout_key, card._config?.model, this.layout?.model?.version,
      this.view?.model?.root, hass.connection, hass.connection?.connected, hass.auth, user?.id, user?.is_admin, user?.is_active,
      card._editing, card.isConnected, card._loading];
  }

  _assetRequestCurrent(request) {
    const current = this._assetContext();
    return this._assetRequest === request && this._navigation.canEdit()
      && request.context.every((value, index) => value === current[index]);
  }

  async _uploadModel(file, approvedReplacement = null) {
    if (!this._navigation.canEdit() || this.uploading) return;
    if (!/\.glb$/i.test(file.name)) {
      this.message = this._coreNotice('glbNotice', {}, { error: true });
      this.render();
      return;
    }
    if (this.layout.model?.version && !approvedReplacement) {
      this._pendingReplacement = { file, context: this._reviewContext(), previous: this.layout.model.name || 'house.glb' };
      this.render(); this.panel.querySelector('[data-act="model-replace-cancel"]')?.focus({ preventScroll: true }); return;
    }
    if (approvedReplacement && (approvedReplacement.file !== file || !this._sameReviewContext(approvedReplacement.context))) return;
    const request = { context: this._assetContext() }; this._assetRequest = request;
    this.uploading = file.name;
    this.message = null;
    this.render();
    try {
      const body = new FormData();
      body.append('file', file, file.name);
      const r = await this.hass.fetchWithAuth(this._modelApi(), { method: 'POST', body });
      const j = await r.json().catch(() => ({}));
      if (!this._assetRequestCurrent(request)) return;
      if (!r.ok) throw new Error(j.message || 'Upload failed (HTTP ' + r.status + ')');
      const cur = this.layout.model || { position: [0, 0, 0], rotation: 0, scale: 1, opacity: 1 };
      this._freshModel = true;
      this.message = this._coreNotice('uploadedNotice', { name: j.name, size: (j.size / 1048576).toFixed(1) });
      this.commit({ ...this.layout, model: { ...cur, version: j.version, name: j.name, size: j.size, uploaded: new Date().toISOString() } });
      this.card.resetHistory?.(); // replaced GLB bytes cannot be restored by a configuration snapshot
    } catch (err) {
      if (!this._assetRequestCurrent(request)) return;
      this._freshModel = false;
      this.message = { text: err.message, error: true };
    } finally {
      if (this._assetRequest === request) { this._assetRequest = null; this.uploading = null; this.render(); }
    }
  }

  async _removeModel() {
    if (!this._navigation.canEdit() || this.uploading) return;
    const request = { context: this._assetContext() }; this._assetRequest = request;
    try {
      const r = await this.hass.fetchWithAuth(this._modelApi(), { method: 'DELETE' });
      if (!this._assetRequestCurrent(request)) return;
      if (!r.ok && r.status !== 404) throw new Error('Delete failed (HTTP ' + r.status + ')');
      this.confirmModelDelete = false;
      this.commit({ ...this.layout, model: null });
      this.card.resetHistory?.(); // deleting an asset is outside configuration undo
    } catch (err) {
      if (!this._assetRequestCurrent(request)) return;
      this.message = { text: err.message, error: true };
    }
    if (this._assetRequest === request) { this._assetRequest = null; this.render(); }
  }

  _modelTab() {
    const c = this.card._config;
    // Display settings work independently of the model upload/storage route.
    const rendering = this._navigation.wizard && this._navigation.step < 2 ? ''
      : this._modelRenderingEditor.render() + this._wallPresentationEditor.render() + this._floorPresentationEditor.render();
    if (c.model) {
      return rendering + `<p class="note warn">${this._coreCaption('urlModel')}<b>${esc(c.model)}</b>${this._coreCaption('urlModelHelp')}</p>`
        + this._modelBindingsHtml();
    }
    if (this.card._store.backend !== 'shared') {
      return rendering + `<p class="note warn">${this._coreCaption('integrationNeeded')}<code>/local/house.glb</code>${this._coreCaption('integrationUrl')}</p>`;
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(c.layout_key)) {
      return rendering + `<p class="note warn">${this._coreCaption('layoutKeyHelp', { id: c.layout_key })}</p>`;
    }
    const m = this.layout.model;
    const replacement = this._pendingReplacement;
    let out = rendering + `<p class="hint">${this._coreCaption('modelIntro')}<code>fp</code>${this._coreCaption('modelTagHelp')}<a href="https://github.com/gregtaylor1993/taylors-3d/blob/main/docs/model-builder-guide.md" target="_blank" rel="noopener">docs/model-builder-guide.md</a>${this._coreCaption('modelIntroEnd')}</p>
      <div class="row"><label class="button ${this.uploading ? 'disabled' : 'primary'}" data-setup-upload tabindex="${this.uploading ? '-1' : '0'}" role="button" aria-disabled="${!!this.uploading}">${this._coreCaption(this.uploading ? 'uploading' : m ? 'replaceModel' : 'uploadModel', { name: this.uploading })}
      <input type="file" accept=".glb,model/gltf-binary" data-field="model-file" hidden ${this.uploading ? 'disabled' : ''}></label></div>`;
    if (replacement) out += `<section class="editor-leave-review" data-model-replacement role="region" aria-label="${this._navigation.t('replaceTitle')}">
      <strong>${this._navigation.t('replaceTitle')}</strong><p>${this._navigation.t('replaceFiles', { old: replacement.previous, next: replacement.file.name })}</p>
      <p>${this._navigation.t('replaceHelp')}</p><div class="row"><button data-act="model-replace-confirm">${this._navigation.t('replaceConfirm')}</button>
      <button data-act="model-replace-cancel">${this._navigation.t('replaceCancel')}</button></div></section>`;
    if (!m) return out;

    this._modelPositionScope = { id: (this._modelPositionScope?.id || 0) + 1,
      owner: this._modelPositionOwner(), poisoned: false };

    const floorInfo = this._modelBindingsHtml();
    const [x, y, z] = m.position || [0, 0, 0];
    const slider = (f, _label, min, max, step, v) => `<label><span class="lab">${this._coreCaption({ x: 'east', y: 'north', z: 'up' }[f] || f)}<span class="val" data-val="${f}">${fmt(v)}</span></span>
      <input type="range" data-field="md-${f}" min="${Math.min(min, Number.isFinite(v) ? v : min)}" max="${Math.max(max, Number.isFinite(v) ? v : max)}" step="${step}" value="${v}"></label>`;
    out += `<section class="box"><h3>${esc(m.name || 'house.glb')}</h3>
      <p class="dim">${m.size ? (m.size / 1048576).toFixed(1) + ' MB' : ''}${m.uploaded ? ' · ' + esc(new Date(m.uploaded).toLocaleString()) : ''}</p>
      </section>${floorInfo}
      <div class="row"><button data-act="model-fit">Frame model</button></div>
      <div class="sub">${this._coreCaption('alignment')}</div>`
      + slider('x', 'East (m)', -50, 50, 0.05, x)
      + slider('y', 'North (m)', -50, 50, 0.05, y)
      + slider('z', 'Up (m)', -5, 5, 0.05, z)
      + `<details class="advanced" ${this._advancedOpen ? 'open' : ''}><summary>${this._coreCaption('exactPosition')}</summary>
        <p class="hint">Metres in the original house coordinates. These values do not include separated-floor display spacing.</p>
        ${[['x', 'east', x], ['y', 'north', y], ['z', 'up', z]].map(([axis, key, value]) => `<label>${this._coreCaption(key)}<input type="number" step="any" style="min-height:44px" data-field="md-position-${axis}" data-model-position-scope="${this._modelPositionScope.id}" value="${esc(value)}"></label>`).join('')}
        <p class="note warn" data-model-position-warning hidden>${this._coreCaption('positionStale')}</p></details>`
      + slider('rotation', 'Rotation (°)', -180, 180, 0.5, m.rotation || 0)
      + slider('opacity', 'Opacity', 0, 1, 0.05, m.opacity ?? 1)
      + `<label>Scale <input type="number" step="any" min="0.0001" data-field="md-scale" value="${m.scale || 1}"></label>
      <p class="hint">Scale 0.01 for a model made in centimetres, 0.001 for millimetres.</p>
      <p class="hint">${this._navigation.t('modelBackupHelp')}</p>
      <div class="row"><button data-act="model-delete" class="danger">${this._coreCaption(this.confirmModelDelete ? 'reallyRemove' : 'removeModel')}</button></div>
      ${this.confirmModelDelete ? `<p role="status">${this._navigation.t('removeHelp')}</p>` : ''}`;
    return out;
  }

  // Levels -> HA floors, rooms/zones -> HA areas, plus what changed since the last upload.
  _modelBindingsHtml() {
    const mb = this.card.modelBindings();
    if (!mb) return '<p class="dim">Loading model…</p>';
    const { manifest, levels, rooms, diff, notice } = mb;
    if (!(this.layout.model && this.layout.model.known) && !this._snapPending) { // first look at this model: nothing is "new" yet
      this._snapPending = true;
      Promise.resolve().then(() => { this._snapPending = false; if (!(this.layout.model && this.layout.model.known)) this._snapshotKnown(); });
    }
    const s = (n, w) => this._coreCaption(`${w}${n === 1 ? 'One' : 'Many'}`, { count: n });
    const objCount = manifest.objects.length;
    let out = `<div class="sub">${this._coreCaption('inModel')}</div><p class="hint">${s(manifest.levels.length, 'level')},
      ${s(manifest.rooms.filter((r) => r.kind === 'room').length, 'room')}, ${s(manifest.rooms.filter((r) => r.kind === 'zone').length, 'zone')},
      ${s(objCount, 'object')}${objCount ? this._coreCaption('modelObjectsLater') : ''}${this._coreCaption('modelFindHelp')}</p>`;
    const ms = this.view.mergeStats;
    if (ms && ms.before) {
      const a = ms.after, b = ms.before;
      out += ms.enabled && a.meshes !== b.meshes
        ? `<p class="dim" data-info="merge-stats">${this._coreCaption('mergeChanged', { before: b.calls, after: a.calls, beforeMeshes: b.meshes, afterMeshes: a.meshes })}</p>`
        : `<p class="dim" data-info="merge-stats">${this._coreCaption(ms.enabled ? 'mergeCount' : 'mergeOff', { calls: b.calls, meshes: b.meshes })}</p>`;
    }
    if (manifest.errors.length || manifest.warnings.length) {
      out += `<details class="report" ${this._reportOpen ? 'open' : ''}><summary>${this._coreCaption('reportCounts', { errors: manifest.errors.length, warnings: manifest.warnings.length })}</summary>
        <button class="link" data-act="md-copy-report">Copy to clipboard</button><ul class="plain">`
        + manifest.errors.map((e) => `<li class="bad">${esc(e)}</li>`).join('')
        + manifest.warnings.map((w) => `<li class="dim">${esc(w)}</li>`).join('') + '</ul></details>';
    }
    const added = notice.levels.added.length + notice.rooms.added.length;
    const missing = notice.levels.missing.length + notice.rooms.missing.length;
    if (added || missing) {
      out += `<p class="note warn">${this._coreCaption('modelChanges', { added, missing })} <button class="link" data-act="md-ack">OK</button></p>`;
    }
    const sel = (k, id) => (this.modelPick && this.modelPick.kind !== 'untagged' && this.modelPick.id === id && k.includes(this.modelPick.kind) ? 'sel' : '');

    if (manifest.levels.length) {
      // which HA floor a level belongs to (devices, linked floors, elevations); what each view shows is set in Views
      const opts = (v, a) => [
        ['auto', '', 'auto'],
        ...this.floors.map((f) => [`floor:${f.id}`, f.name]),
        ...(a.stale && a.floor && !this.floors.some((f) => f.id === a.floor) ? [[`floor:${a.floor}`, '', 'missingFloor']] : []),
        ['none', '', 'noFloorLower'],
      ].map(([val, label, key]) => key === 'auto' ? this._coreAutoFloorOption(a, `value="auto" ${val === v ? 'selected' : ''}`)
        : key ? this._coreOption(key, { id: a.floor }, `value="${esc(val)}" ${val === v ? 'selected' : ''}`) : `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(label)}</option>`).join('');
      out += `<div class="sub">${this._coreCaption('levelFloors')}</div><table class="floors">` + manifest.levels.map((l) => {
        const a = levels[l.id];
        const v = a.auto ? 'auto' : a.floor ? `floor:${a.floor}` : 'none';
        return `<tr data-pick="level:${esc(l.id)}" class="${sel(['level'], l.id)}"><td title="${esc(l.role)}">${esc(l.label)}</td>
          <td><select data-field="md-level" data-id="${esc(l.id)}">${opts(v, a)}</select></td>
          <td class="dim">${a.stale ? `<span class="bad">${this._coreCaption('floorGone')}</span>` : a.auto ? this._coreCaption('auto') : ''}</td></tr>`;
      }).join('') + '</table>';
    }

    if (manifest.rooms.length) {
      const areas = Object.values(this.hass.areas || {}).sort((a, b) => a.name.localeCompare(b.name));
      const opts = (v, auto) => this._coreOption(auto && v ? 'autoName' : 'auto', { name: (this.hass.areas[v] || {}).name || v }, `value="auto" ${auto ? 'selected' : ''}`)
        + this._coreOption('noAreaOption', {}, `value="" ${!auto && !v ? 'selected' : ''}`)
        + (v && !this.hass.areas?.[v] ? this._coreOption('missingModelArea', { id: v }, `value="${esc(v)}" ${!auto ? 'selected' : ''}`) : '')
        + areas.map((a) => `<option value="${esc(a.area_id)}" ${!auto && a.area_id === v ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
      out += `<div class="sub">${this._coreCaption('roomsZones')}</div><table class="floors">` + manifest.rooms.map((r) => {
        const a = rooms[r.id];
        const note = a.stale ? `<span class="bad">${this._coreCaption('areaGone')}</span>` : !levels[r.level] || !levels[r.level].floor
          ? this._coreCaption('unfloored') : r.outlineFallback ? this._coreCaption('noOutline') : a.auto ? this._coreCaption('auto') : '';
        return `<tr data-pick="${r.kind}:${esc(r.id)}" class="${sel(['room', 'zone'], r.id)}"><td title="${esc(r.kind)} in ${esc(r.level || '?')}">${esc(r.label)}</td>
          <td><select data-field="md-room" data-id="${esc(r.id)}">${opts(a.area, a.auto)}</select></td><td class="dim">${note}</td></tr>`;
      }).join('') + '</table>'
        + `<p class="hint">${this._coreCaption('modelRoomsHelp')}<a href="/config/areas/dashboard" target="_top">${this._coreCaption('createAreas')}</a>.</p>`;
    }

    const gone = [...diff.levels.missing.map((id) => ['levels', id]), ...diff.rooms.missing.map((id) => ['rooms', id])];
    if (gone.length) {
      out += `<div class="sub">${this._coreCaption('gone')}</div><ul class="plain">` + gone.map(([k, id]) =>
        `<li><code>${esc(id)}</code> <button class="link" data-act="md-forget" data-kind="${k}" data-id="${esc(id)}">Forget</button></li>`).join('') + '</ul>';
    }
    if (this.modelPick && this.modelPick.kind === 'untagged') {
      out += `<p class="note warn">${this._coreCaption('untaggedHelp', { path: this.modelPick.path })}</p>`;
    }
    return out;
  }

  _dataTab() {
    return `${this._singleLayoutData()}<div data-dashboard-backup-slot>${this._dashboardBackupEditor.render()}</div>`;
  }

  _singleLayoutData() {
    const b = this.card._store.backend;
    const info = {
      shared: ['ok', 'storageShared'],
      user: ['warn', 'storageUser'],
      browser: ['warn', 'storageBrowser'],
    }[b] || ['warn', 'storageLoading'];
    const modelConfigured = !!(this.card._config.model || this.layout.model?.version);
    const resolvedReady = !this.card._loading && (!modelConfigured || !!this.view.model);
    const issues = registryIssues(this.hass, this.layout, this.card._config, {
      ready: resolvedReady, rooms: this.card._roomList, floors: this.card._floors,
      anchors: resolvedReady && Array.isArray(this.card._roomList) ? this.card.trackingAnchors?.() : undefined,
    });
    const report = `<div class="sub">${this._coreCaption('savedLinks')}</div>${issues.length
      ? `<p class="note warn">${this._coreCaption('linksAttention', { count: issues.length })}</p><ul class="plain">${issues.map((issue) => `<li>${this._coreIssueCaption(issue, true)}<br><code>${esc(issue.path)}</code></li>`).join('')}</ul><p class="hint">${this._coreCaption('linksRepairHelp')}</p>`
      : `<p class="hint">${this._coreCaption('linksValid')}</p>`}`;
    return `<section data-single-layout-data><div class="sub">${this._coreCaption('storage')}</div><p class="note ${info[0]}">${this._coreCaption(info[1])}</p>${report}
      <div class="sub" data-single-layout-text="title">${esc(localize(this.hass, 'edit.singleLayout.title'))}</div>
      <p class="hint" data-single-layout-text="help">${esc(localize(this.hass, 'edit.singleLayout.help'))}</p>
      <div class="row"><button data-act="export" data-single-layout-text="export">${esc(localize(this.hass, 'edit.singleLayout.export'))}</button>
      <label class="button"><span data-single-layout-text="import">${esc(localize(this.hass, 'edit.singleLayout.import'))}</span><input type="file" accept="application/json,.json" data-field="import" hidden></label></div></section>`;
  }

  _onPanelClick(e) {
    try { return this._applyPanelClick(e); } finally { this.card._syncFeedback?.(); }
  }

  _applyPanelClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    if (/^(draft-leave-|model-replace-)/.test(btn.dataset.act) && !this._navigation.allowed(btn)) return;
    if (btn.dataset.act.startsWith('draft-leave-')) { void this._resolveLeave(btn.dataset.act); return; }
    if (btn.dataset.act === 'model-replace-cancel') { this._pendingReplacement = null; this.render(); return; }
    if (btn.dataset.act === 'model-replace-confirm') {
      const pending = this._pendingReplacement;
      if (!pending || !this._sameReviewContext(pending.context) || !this._navigation.canEdit()) { this._pendingReplacement = null; this.render(); return; }
      this._pendingReplacement = null; void this._uploadModel(pending.file, pending); return;
    }
    if (this._navigation.onClick(btn)) return;
    const id = btn.dataset.id;
    if (this._dashboardBackupEditor.onClick(btn.dataset.act, btn)) return;
    if (this._roomActionsEditor.onClick(btn.dataset.act, btn)) return;
    if (this._customControlsEditor.onClick(btn.dataset.act, btn)) return;
    if (this._overlayEditor.onClick(btn.dataset.act, btn)) return;
    if (this._cameraEditor.onClick(btn.dataset.act, btn)) return;
    if (this._trackingEditor.onClick(btn.dataset.act, btn)) return;
    if (this._weatherEditor.onClick(btn.dataset.act, btn)) return;
    if (this._securityEditor.onClick(btn.dataset.act, btn)) return;
    if (this._modelRenderingEditor.onClick(btn.dataset.act, btn)) return;
    if (this._scenePreviewEditor.onClick(btn.dataset.act, btn)) return;
    if (this._ambientIdleEditor.onClick(btn.dataset.act, btn)) return;
    if (this._houseSummaryEditor.onClick(btn.dataset.act, btn)) return;
    if (this._furnitureEditor.onClick(btn.dataset.act, btn)) return;
    if (btn.dataset.act === 'library-refresh') { this.card.furnitureRefresh?.(); return; }
    if (btn.dataset.act === 'library-export') { this.card.furnitureExportPack?.(btn.dataset.pack); return; }
    if (this._wallPresentationEditor.onClick(btn.dataset.act, btn)) return;
    if (this._floorPresentationEditor.onClick(btn.dataset.act, btn)) return;
    const sel = this.room(this.selectedRoom);
    this.message = null;
    // Views tab actions commit; the rebuild after the commit renders the panel once
    if (btn.dataset.act.startsWith('vw-') && this._viewsClick(btn.dataset.act, btn)) return;
    switch (btn.dataset.act) {
      case 'save-screen-name': {
        try {
          const value = this.panel.querySelector('[data-field="screen-name"]')?.value || '';
          this.card.setPanelName(value);
          this._panelNameDraft = null;
          this.message = this._coreNotice(value.trim() ? 'screenSavedNotice' : 'screenDefaultNotice');
        } catch (error) { this.message = this._coreErrorNotice(error); }
        this.render(); return;
      }
      case 'history-undo': this._runHistory('undo'); return;
      case 'history-redo': this._runHistory('redo'); return;
      case 'tab':
        if (id !== this.tab && !this._requestLeave({ type: 'tab', tab: id })) return;
        this._navigation.reveal(id);
        if (this.tab === 'rooms' && id !== 'rooms') this._roomActionsEditor.reset();
        if (this.tab === 'controls' && id !== 'controls') this._customControlsEditor.reset();
        if (id === 'house' && this.card._config?.layout_style !== 'house') return;
        if (id !== this.tab) {
          this.card._endGesture?.();
          this._furnitureDrag.cancel();
          if (this.tab === 'furniture') this._furnitureEditor.reset();
          if (this.tab === 'cameras') this._cameraEditor.cancel();
          if (this.tab === 'tracking') this._trackingEditor.cancel();
          if (this.tab === 'environment') this._weatherEditor.reset();
          if (this.tab === 'security') this._securityEditor.reset();
          if (this.tab === 'model') { this._modelRenderingEditor.reset(); this._wallPresentationEditor.reset(); this._floorPresentationEditor.reset(); }
          if (this.tab === 'scenes') this._scenePreviewEditor.reset();
          if (this.tab === 'idle') this._ambientIdleEditor.reset();
          if (this.tab === 'house') this._houseSummaryEditor.reset();
          if (this.tab === 'data') this._dashboardBackupEditor.setActive(false);
          this.picking = null;
          this.pivoting = false;
          this.modelPick = null;
          this.vwPick = null;
          this._closeMenu();
          this.view.highlightModelNode(null);
        }
        if (id !== 'objects') this.objSel = null;
        if (id === 'data' || id === 'controls' || id === 'scenes' || id === 'idle' || id === 'house' || id === 'furniture') {
          // Source/display settings must not leave a room tool or pinned
          // marker gesture active behind the form.
          this.drawing = this.calibrating = null;
          this.doorMode = this.colorPick = this.overlayMove = false;
          this.selectedRoom = this.selectedMarker = null;
          this.card._applyMarkerSelection(null);
        }
        this.tab = id;
        if (id === 'data' || id === 'controls' || id === 'idle' || id === 'house' || id === 'furniture') {
          // A late release from an old room/device drag must not pin anything
          // after entering this settings-only tab. Remove old edit handles too.
          this._endWindowDrag(false);
          this.card._history?.cancel();
          this.card._markerRenderKey = null;
          this.refreshOverlay();
        }
        this.card._syncCameraCoverage?.();
        this.card._syncTracking?.();
        this.card._syncWeather?.();
        this.card._syncSecurity?.();
        this.card._syncFurniture?.();
        if (id === 'furniture') this.card.furnitureRefresh?.();
        this._syncStageClasses();
        break;
      case 'obj-expand':
        if (this.objExpanded.has(btn.dataset.key)) this.objExpanded.delete(btn.dataset.key);
        else this.objExpanded.add(btn.dataset.key);
        this.render();
        return;
      case 'obj-test':
        if (!this.card.testObject(id)) this.message = this._coreNotice('nothingToggleNotice', {}, { warn: true });
        this.render();
        return;
      case 'md-ack': this._snapshotKnown(); return;
      case 'md-copy-report': {
        const mb = this.card.modelBindings();
        if (!mb) return;
        const { errors, warnings } = mb.manifest;
        const text = [...errors.map((t) => `Error: ${t}`), ...warnings.map((t) => `Warning: ${t}`)].join('\n');
        copyText(text).then((ok) => {
          this.message = ok ? this._coreNotice('copiedNotice', { count: errors.length + warnings.length })
            : this._coreNotice('clipboardNotice', {}, { error: true });
          this.render();
        });
        return;
      }
      case 'md-forget': {
        const m = this.layout.model || {};
        const k = btn.dataset.kind;
        const next = { ...(m[k] || {}) };
        delete next[id];
        this.setModelProps({ [k]: next });
        return;
      }
      case 'draw': this.startDrawing(id); return;
      case 'pick': this.startPicking(id); return;
      case 'pick-cancel': this.cancelPicking(); return;
      case 'pick-use': this.usePickedOutline(); return;
      case 'pick-draw': { const a = this.picking && this.picking.areaId; this.picking = null; if (a) this.startDrawing(a); return; }
      case 'finish': this.finishDrawing(); return;
      case 'undo-point': this.drawing.points.pop(); this.refreshOverlay(); break;
      case 'cancel-draw': this.cancelDrawing(); return;
      case 'select-room': {
        const r = this.room(id);
        const fid = r && this.floorOf(r);
        if (fid && this.card._floor !== fid) this.card._setFloor(fid);
        this.selectRoom(id);
        return;
      }
      case 'deselect': this.selectRoom(null); return;
      case 'door-mode': this.doorMode = !this.doorMode; this._syncStageClasses(); break;
      case 'del-door': if (sel) this.commit(E.upsertRoom(this.layout, E.removeDoor(sel, Number(btn.dataset.i)))); return;
      case 'delete-room':
        if (!this.confirmDelete) { this.confirmDelete = true; break; }
        this.confirmDelete = false;
        this.selectedRoom = null;
        this.commit(E.deleteRoom(this.layout, sel.id));
        return;
      case 'add-floor': {
        const top = this.floors[this.floors.length - 1];
        const fid = E.newFloorId(this.layout, this.floors);
        this.commit(E.upsertFloor(this.layout, { id: fid, name: 'Floor ' + (this.floors.length + 1), elevation: top ? top.elevation + 3 : 0, height: 2.7 }));
        return;
      }
      case 'del-floor': this.commit(E.deleteFloor(this.layout, id)); return;
      case 'unpin': this.commit(E.clearPin(this.layout, this.selectedMarker)); return;
      case 'detach': { // keep where it is now, as a normal pin on the model
        const pos = this.card._positions && this.card._positions.get(this.selectedMarker);
        const pin = (this.layout.pins || {})[this.selectedMarker];
        const at = pos ? { x: pos.x, y: pos.y, z: pos.z, floor_id: pos.floorId } : pin;
        if (at) this.commit(E.setPin(this.layout, this.selectedMarker, { ...at, on_model: true }, { grid: false }));
        return;
      }
      case 'hide': {
        const mid = this.selectedMarker;
        this.selectMarker(null);
        this.commit(E.hide(this.layout, mid));
        return;
      }
      case 'deselect-marker': this.selectMarker(null); return;
      case 'unhide': this.commit(E.unhide(this.layout, id)); return;
      case 'place': {
        const fid = this.activeFloor();
        const t = this.view.controls.target;
        this.selectedMarker = id;
        this.commit(E.setPin(this.layout, id, { x: t.x, y: -t.z, z: 1.2, floor_id: fid, on_model: this._onModel(id) }));
        return;
      }
      case 'export': this._export(); return;
      case 'cal-add': {
        const m = this.mower();
        const r = readSource(this.hass.states[m.entity], m);
        if (!r) { this.message = this._coreNotice('mowerReadingNotice', {}, { error: true }); break; }
        this.calibrating = { src: r.raw };
        this.overlayMove = false;
        if (this.card._floor !== this.card._mowerFloor()) this.card._setFloor(this.card._mowerFloor());
        break;
      }
      case 'cal-cancel': this.calibrating = null; break;
      case 'img-pick':
        this.colorPick = true;
        this.calibrating = null;
        this.overlayMove = false;
        if (this.card._floor !== this.card._mowerFloor()) this.card._setFloor(this.card._mowerFloor());
        break;
      case 'img-pick-cancel': this.colorPick = false; break;
      case 'cal-del': this.setMower({ calibration: (this.mower().calibration || []).filter((_, i) => i !== Number(btn.dataset.i)) }); return;
      case 'trail-clear': this.card.clearTrail(); break;
      case 'ov-move': this.overlayMove = !this.overlayMove; this.calibrating = null; this.colorPick = false; break;
      case 'ov-remove': this.overlayMove = false; this.setMower({ overlay: null }); return;
      case 'model-fit': this.view.fit({ model: true }); return;
      case 'model-delete':
        if (!this.confirmModelDelete) { this.confirmModelDelete = true; break; }
        this._removeModel();
        return;
      case 'mower-remove': this.calibrating = null; this.colorPick = false; this.overlayMove = false; this.commit({ ...this.layout, mower: null }); this.render(); return;
      default: return;
    }
    this._syncStageClasses();
    this.render();
  }

  _onPanelChange(e) {
    try { return this._applyPanelChange(e); } finally { this.card._syncFeedback?.(); }
  }

  _applyPanelChange(e) {
    if (this._navigation.onChange(e.target.dataset.field, e.target)) return;
    const el = e.target;
    const f = el.dataset.field;
    if (this._dashboardBackupEditor.onChange(f, el)) return;
    if (this._roomActionsEditor.onChange(f, el)) return;
    if (this._customControlsEditor.onChange(f, el)) return;
    if (this._overlayEditor.onChange(f, el)) return;
    if (this._cameraEditor.onChange(f, el)) return;
    if (this._trackingEditor.onChange(f, el)) return;
    if (this._weatherEditor.onChange(f, el)) return;
    if (this._securityEditor.onChange(f, el)) return;
    if (this._modelRenderingEditor.onChange(f, el)) return;
    if (this._scenePreviewEditor.onChange(f, el)) return;
    if (this._ambientIdleEditor.onChange(f, el)) return;
    if (this._houseSummaryEditor.onChange(f, el)) return;
    if (this._furnitureEditor.onChange(f, el)) return;
    if (this._wallPresentationEditor.onChange(f, el)) return;
    if (this._floorPresentationEditor.onChange(f, el)) return;
    const sel = this.room(this.selectedRoom);
    if (f && f.startsWith('vw-')) this._viewsChange(f, el);
    else if (f === 'room-area' && sel) this.commit(E.upsertRoom(this.layout, { ...sel, area_id: el.value }));
    else if (f === 'room-outdoor' && sel) this.commit(E.upsertRoom(this.layout, { ...sel, outdoor: el.checked }));
    else if (f === 'room-floor' && sel) {
      if (!this.floors.some((floor) => floor.id === el.value)) return;
      const area = this.hass.areas && this.hass.areas[sel.area_id];
      const next = { ...sel, floor_id: el.value };
      if (area && area.floor_id === el.value) delete next.floor_id;
      this.card._setFloor(el.value);
      this.commit(E.upsertRoom(this.layout, next));
    } else if (f === 'floor-elevation' || f === 'floor-height') {
      const v = Number(el.value);
      if (!Number.isFinite(v)) return;
      const floor = this.floors.find((x) => x.id === el.dataset.id);
      const stored = (this.layout.floors || []).some((x) => x.id === floor.id);
      const patch = { id: floor.id, [f === 'floor-elevation' ? 'elevation' : 'height']: v };
      if (!stored) Object.assign(patch, { name: floor.name });
      this.commit(E.upsertFloor(this.layout, patch));
    } else if (f === 'marker-z') {
      const v = Number(el.value);
      const pos = this.card._positions.get(this.selectedMarker);
      if (!Number.isFinite(v) || !pos) return;
      const pin = (this.layout.pins || {})[this.selectedMarker];
      if (pin && pin.attach && Array.isArray(pin.offset)) {
        // attached: raise / lower the offset; object missing: keep the attach, only the fallback height changes
        const o = pin.offset;
        const off = pos.attached ? [o[0], o[1] + v - pos.z, o[2]] : o;
        this.commit(E.attachPin(this.layout, this.selectedMarker, pin.attach, off, { x: pin.x, y: pin.y, z: pos.attached ? pin.z + v - pos.z : v, floor_id: pin.floor_id }));
        return;
      }
      this.commit(E.setPin(this.layout, this.selectedMarker, { x: pos.x, y: pos.y, z: v, floor_id: pos.floorId, on_model: this._onModel(this.selectedMarker) }, { grid: !pin }));
    } else if (f === 'obj-picker-area') {
      if (el.value !== 'all' && el.value !== 'unassigned' && !(el.value.startsWith('area:') && this.hass.areas?.[el.value.slice(5)])) return;
      this._objectPickerArea = el.value; this.render();
    } else if (f === 'obj-entity') {
      const v = el.value.trim();
      const object = this.card.modelBindings()?.manifest?.objects?.find((entry) => entry.id === el.dataset.id);
      if (!object) return;
      const previous = this.layout.objects?.[object.id]?.entity ?? this.card._bindings?.get(object.id)?.requestedEntity ?? this.card._bindings?.get(object.id)?.entity;
      if (!this._objectLinkAllowed(v, previous, object.type)) return;
      this.commit(E.setObject(this.layout, el.dataset.id, { entity: v === '' ? undefined : v.toLowerCase() === 'none' ? null : v }));
      this.render();
    } else if (f === 'obj-hidden') {
      this.commit(E.setObject(this.layout, el.dataset.id, { hidden: el.checked }));
      this.render();
    } else if (f === 'grp-entity') {
      const value = el.value.trim();
      if (!this.card.modelBindings()?.manifest?.objects?.some((object) => object.group === el.dataset.id)) return;
      if (!this._objectLinkAllowed(value, this.layout.groups?.[el.dataset.id]?.entity, 'group')) return;
      this.commit(E.setGroup(this.layout, el.dataset.id, { entity: value }));
      this.render();
    } else if (f === 'mower-picker-area') {
      if (el.value !== 'all' && el.value !== 'unassigned' && !(el.value.startsWith('area:') && this.hass.areas?.[el.value.slice(5)])) return;
      this._mowerPickerArea = el.value;
      this.render();
    } else if (f === 'mower-entity') {
      const value = el.value.trim();
      if (!this._mowerLinkAllowed(value, this.mower().entity, ['device_tracker', 'sensor', 'lawn_mower', 'vacuum'])) return;
      this.setMower({ entity: value });
    } else if (f === 'mower-source') {
      // readings of the other kind cannot be mixed into the same calibration
      this.setMower({ source: el.value, calibration: [] });
    } else if (f === 'mower-img-entity') {
      const ic = { ...(this.mower().image || {}) };
      const v = el.value.trim();
      if (!this._mowerLinkAllowed(v, ic.entity, ['image', 'camera'])) return;
      if (v) ic.entity = v;
      else delete ic.entity;
      this.setMower({ image: ic });
    } else if (f === 'mower-img-tolerance') {
      this.setMower({ image: { ...(this.mower().image || {}), tolerance: Math.max(0, Math.min(255, Number(el.value) || 0)) } });
    } else if (f === 'mower-img-min-pixels') {
      if (!el.value.trim() || !this._mowerImageAllowed(el)) { this._syncMowerImageFields(); return; }
      const value = Number(el.value);
      if (!Number.isSafeInteger(value) || value < 0) return;
      this.setMower({ image: { ...(this.mower().image || {}), min_pixels: value } });
    } else if (f === 'mower-xattr' || f === 'mower-yattr') {
      this.setMower({ [f === 'mower-xattr' ? 'x_attr' : 'y_attr']: el.value.trim() || (f === 'mower-xattr' ? 'x' : 'y') });
    } else if (f === 'mower-floor') {
      if (!this.floors.some((floor) => floor.id === el.value)) return;
      this.card._setFloor(el.value);
      this.setMower({ floor_id: el.value });
    } else if (f === 'mower-trail') {
      this.setMower({ trail: el.checked });
    } else if (f === 'ov-entity') {
      const v = el.value.trim();
      if (!this._mowerLinkAllowed(v, this.mower().overlay?.entity, ['image', 'camera'])) return;
      if (!v) this.setMower({ overlay: null });
      else {
        // first time: centre the map on the current view
        const t = this.view.controls.target;
        const first = !this.mower().overlay;
        this.setOverlay(first ? { entity: v, x: Math.round(t.x * 10) / 10, y: Math.round(-t.z * 10) / 10 } : { entity: v });
      }
    } else if (f === 'model-file') {
      const file = el.files && el.files[0];
      el.value = '';
      if (file) this._uploadModel(file);
    } else if (f === 'md-level') {
      const v = el.value;
      const m = this.layout.model || {};
      const levels = { ...(m.levels || {}) };
      const id = el.dataset.id;
      if (v === 'auto') delete levels[id]; // back to automatic
      else if (v.startsWith('floor:')) levels[id] = { floor: v.slice(6) };
      else if (v === 'none') levels[id] = { floor: null };
      else return;
      // a legacy show mode on this level becomes view rules before the binding drops it
      const c = this.card._config;
      const saved = { ...(c.model ? levelsFromFloorMap(c.model_floors) : {}), ...(m.levels || {}) };
      const mb = this.card._mb;
      const views = mb ? legacyShowRules(this.layout.views, this.card._views, id, saved, mb.manifest.levels) : this.layout.views;
      this.commit({ ...this.layout, model: { ...m, levels }, ...(views !== this.layout.views ? { views } : {}) });
      this.render();
    } else if (f === 'md-room') {
      const m = this.layout.model || {};
      const rooms = { ...(m.rooms || {}) };
      if (el.value === 'auto') delete rooms[el.dataset.id];
      else rooms[el.dataset.id] = { area: el.value || null };
      this.setModelProps({ rooms });
    } else if (['md-position-x', 'md-position-y', 'md-position-z'].includes(f)) {
      if (!el.value.trim() || !this._modelPositionAllowed(el)) { this._syncModelPositionFields(); return; }
      const value = Number(el.value);
      if (!Number.isFinite(value) || !this.layout.model) return;
      const position = [...(this.layout.model.position || [0, 0, 0])];
      position['xyz'.indexOf(f.slice(-1))] = value;
      this.setModelProps({ position }, false);
      this._modelPositionCommit = { scope: this._modelPositionScope, element: el, layout: this.layout, hass: this.hass };
    } else if (f === 'md-scale') {
      const v = Number(el.value);
      if (Number.isFinite(v) && v > 0) this.setModelProps({ scale: v }, false);
    } else if (f === 'import') {
      const file = el.files && el.files[0];
      el.value = ''; // picking the same file again must fire change again
      const generation = this._generation, key = this.card._config.layout_key;
      if (file) file.text().then((text) => { if (this._sameContext(generation, key)) this._import(text); })
        .catch((error) => { if (this._sameContext(generation, key)) { this.message = { text: error.message, error: true }; this.render(); } });
    }
  }

  // sliders update the overlay live, without re-rendering the panel under the pointer
  _onPanelInput(e) {
    try { return this._applyPanelInput(e); } finally { this.card._syncFeedback?.(); }
  }

  _applyPanelInput(e) {
    const el = e.target;
    if (el.type === 'range') this._beginSlider();
    const f = el.dataset.field;
    if (this._dashboardBackupEditor.onInput(f, el)) return;
    if (this._roomActionsEditor.onInput(f, el)) return;
    if (this._customControlsEditor.onInput(f, el)) return;
    if (this._trackingEditor.onInput(f, el)) return;
    if (this._weatherEditor.onInput(f, el)) return;
    if (this._securityEditor.onInput(f, el)) return;
    if (this._modelRenderingEditor.onInput(f, el)) return;
    if (this._scenePreviewEditor.onInput(f, el)) return;
    if (this._ambientIdleEditor.onInput(f, el)) return;
    if (this._houseSummaryEditor.onInput(f, el)) return;
    if (this._furnitureEditor.onInput(f, el)) return;
    if (this._wallPresentationEditor.onInput(f, el)) return;
    if (this._floorPresentationEditor.onInput(f, el)) return;
    if (f?.startsWith('cov-') && this._cameraEditor.onChange(f, el)) return;
    if (f === 'screen-name') { this._panelNameDraft = el.value; return; }
    if (f === 'vw-sec-pos') {
      const v = this._vwView();
      const label = this.panel.querySelector('[data-val="vw-sec-pos"]');
      if (label) label.textContent = fmt(Number(el.value));
      if (v) this.card.previewSection(v.id, this._sectionFromPanel(v, Number(el.value)));
      return;
    }
    if (f && f.startsWith('md-') && el.type === 'range') {
      const key = f.slice(3);
      const v = Number(el.value);
      const label = this.panel.querySelector(`[data-val="${key}"]`);
      if (label) label.textContent = fmt(v);
      const m = this.layout.model;
      if (!m) return;
      if (key === 'x' || key === 'y' || key === 'z') {
        const pos = [...(m.position || [0, 0, 0])];
        pos['xyz'.indexOf(key)] = v;
        this.setModelProps({ position: pos }, false);
      } else this.setModelProps({ [key]: v }, false);
      return;
    }
    if (f === 'mower-img-tolerance') {
      const label = this.panel.querySelector('[data-val="img-tolerance"]');
      if (label) label.textContent = el.value;
      return;
    }
    if (!f || !f.startsWith('ov-') || el.type !== 'range') return;
    const key = f.slice(3);
    const v = Number(el.value);
    const label = this.panel.querySelector(`[data-val="${key}"]`);
    if (label) label.textContent = fmt(v);
    this.setOverlay({ [key]: v }, false);
  }

  _import(text) {
    try {
      const raw = JSON.parse(text);
      const parsed = E.parseImport(text);
      const haFloors = Object.values(this.hass.floors || {}).map((f) => ({ id: f.floor_id, elevation: (f.level ?? 0) * LEVEL_SPACING }));
      const fit = E.fitImport(parsed, haFloors, Object.keys(this.hass.areas || {}));
      const { floorMap, unknownAreas } = fit;
      // the uploaded model, the mower setup and view settings missing from the file: keep ours
      const l = E.mergeImport(fit.layout, raw, this.layout);
      this.selectedRoom = null;
      this.selectedMarker = null;
      const parts = [{ key: 'importedNotice', params: { rooms: l.rooms.length, pins: Object.keys(l.pins).length } }];
      const mapped = Object.entries(floorMap);
      if (mapped.length) {
        const name = (id) => (this.hass.floors[id] && this.hass.floors[id].name) || id;
        parts.push({ literal: ' ' }, { key: 'mappedFloorsNotice', params: { mapping: mapped.map(([a, b]) => `${a} → ${name(b)}`).join(', ') } });
      }
      if (unknownAreas.length) {
        parts.push({ literal: ' ' }, { key: unknownAreas.length === 1 ? 'unknownAreaNotice' : 'unknownAreasNotice', params: { count: unknownAreas.length, ids: unknownAreas.join(', ') } });
      }
      this.message = this._coreNoticeParts(parts, { error: false, warn: unknownAreas.length > 0 });
      this.commit(l);
    } catch (err) {
      this.message = { text: err.message, error: true };
      this.render();
    }
  }

  _export() {
    const blob = new Blob([JSON.stringify(this.layout, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `taylors3d-${this.card._config.layout_key}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
