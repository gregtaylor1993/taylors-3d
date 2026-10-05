// taylors3d-card: Home Assistant Lovelace card showing a 3D floorplan with auto-placed devices.

import { Color } from 'three';
import { FloorplanView } from './view.js';
import { EditMode } from './edit-mode.js';
import './card-editor.js';
import { LayoutStore } from './storage.js';
import { buildMarkers, registrySignature, iconFor, isActive, displayValue, areaName } from './registry.js';
import { mergeFloors, roomFloorId, markerPositions, lightGlow, roomLabel } from './layout.js';
import {
  resolveLevels, resolveRoomAreas, modelRooms, combineRooms, levelFloorOverrides, bindingDiff, snapshotDiff, levelsFromFloorMap,
  measuredElevations, transformPoint,
} from './bindings.js';
import { threeAdapter } from './manifest.js';
import {
  nodeIndex, resolveViews, resolveVisibility, primaryLevel, defaultFloors, levelOrders, isOverview, floorLevels, deviceState,
  defaultViewId, viewCut, orderViews, unmatchedSelectors, sectionPlane, sectionCamera, zoomToFor, roomAt, exteriorShown, cameraToCard, topCameraToCard,
} from './views.js';
import { readSource, mowerTransform, overlayUrl } from './mower.js';
import { findBlob, stepTrack, headingMinStep, pixelToPlan, readImagePixels, imagePixels } from './mower-image.js';
import { ObjectLayer } from './objects/layer.js';
import { bindObjects, effectiveGroups, nightFactor, sunVector, sunStrength, clampSunDir, screenByDistance, attachedPosition, floorAtHeight } from './objects/logic.js';
import { moonPosition } from './sky.js';
import { ObjectPopup, objectAction, actionTarget, toggleCall } from './objects/popup.js';
import { DevicePopup } from './device-popup.js';
import { roomActionsFor } from './room-actions.js';
import { MiniMap } from './minimap.js';
import { bubbleControls, roomAtPlan, focusCamera } from './navigation.js';
import { EditHistory } from './history.js';
import { PresetEventController } from './preset-events.js';
import { StatusOverlays, buildRoomOverlays, buildAlerts } from './status-overlays.js';
import { CameraCoverageLayer } from './camera-coverage.js';
import { entityMetadata } from './entity-metadata.js';
import { buildTrackedEntities, TrackedEntitiesLayer } from './tracked-entities.js';
import { readSunState, readHaLocation, readWeather, WeatherLayer } from './weather.js';
import { SecurityLayer } from './security.js';
import { buildPlanSecurity, PlanSecurityLayer } from './security-plan.js';
import { readModelRendering } from './model-rendering.js';
import { ScenePreviewController } from './scene-preview.js';
import { ScenePreviewBar } from './scene-preview-bar.js';
import { AmbientIdleController } from './ambient-idle.js';
import { wallKeepSelectors } from './wall-presentation.js';
import { readFloorPresentation } from './floor-presentation.js';
import { HouseShell } from './house-shell.js';
import { FurnitureCoordinator } from './furniture-coordinator.js';
import { FurnitureLayer } from './furniture-rendering.js';
import { localizeHouseNavigationItems } from './house-navigation.js';
import { localize, localeKey } from './localization.js';
import { ownedRuntimeError, ownedRuntimeDetails, runtimeNoticeText } from './runtime-notices.js';
import { buildHouseCategory, ownedHouseCategoryPresentation } from './house-categories.js';
import { houseBaseHeight } from './house-card-size.js';
import { floorPresentationContext } from './floor-presentation-context.js';
import { displayPlanPosition, displayFloorFootprint, displayLocatedRecords, displayCameraAnchors,
  translateFloorCamera } from './floor-presentation-adapters.js';

const VERSION = '0.2.0';
const NONE = Object.freeze({}); // stable stand-in for a missing layout.objects / groups (binding cache key)
const TAP_TOGGLE = new Set(['light', 'switch', 'fan', 'input_boolean']);
const LONG_PRESS_MS = 500;
const MOON_EVERY_MS = 60000;
const DAY_SUN = [200, 40]; // manual Day: sun azimuth / elevation (deg)
const NIGHT_MOON = [160, 35]; // manual Night: moon azimuth / elevation
const CLICK_SLOP_PX = 5;
const OBJECT_HIT_PX = { touch: 52, mouse: 30 };
const TRAIL_STEP_M = 0.15;
const TRAIL_MAX = 3000;
const MOWER_Z = 0.15;
const MODEL_API = '/api/taylors3d/model';
const nodeShown = (n) => { for (let x = n; x; x = x.parent) if (!x.visible) return false; return true; };

const STYLE = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; position: relative; container-type: inline-size;
    background: var(--ha-card-background, var(--card-background-color, #fff));
    border-radius: var(--ha-card-border-radius, 12px); color: var(--primary-text-color); }
  .stage { position: relative; width: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
  .stage canvas { display: block; }
  .scene { position: absolute; inset: 0 var(--taylors3d-controls-width, 0px) var(--taylors3d-bar-height, 0px) 0; }
  @container (min-width: 740px) {
    .stage.controls-open { --taylors3d-controls-width: 332px; }
  }
  .toolbar { position: absolute; bottom: 8px; left: 8px; right: 8px; display: flex; flex-direction: column;
    gap: 6px; padding: 6px; align-items: stretch; z-index: 2; box-sizing: border-box;
    border-radius: 28px; border: 1px solid var(--divider-color, rgba(0,0,0,.12));
    background: var(--ha-card-background, var(--card-background-color, #fff));
    box-shadow: 0 3px 14px rgba(0,0,0,.15); touch-action: manipulation; }
  .toolbar[hidden] { display: none; }
  .scene-presets { min-width: 0; max-width: 100%; }
  .scene-presets:has(> [hidden]) { display: none; }
  .chips { display: flex; flex-wrap: nowrap; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: thin; }
  .chips:empty { display: none; }
  .bubble-actions { display: flex; gap: 6px; align-items: center; overflow-x: auto; scrollbar-width: thin; }
  .toolbar button, .toolbar .seg { flex: none; }
  .toolbar button { min-height: 44px; min-width: 44px; }
  .toolbar button:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -3px; }
  .toolbar [hidden] { display: none !important; }
  @container (min-width: 800px) {
    .toolbar { flex-direction: row; flex-wrap: wrap; align-items: center; }
    .scene-presets { flex-basis: 100%; }
    .chips { flex: 1; }
    .bubble-actions { flex: none; }
  }
  .spacer { flex: 1; }
  button.chip, .seg button { font: inherit; font-size: 13px; line-height: 1; cursor: pointer;
    padding: 7px 12px; border-radius: 16px; border: 1px solid var(--divider-color, rgba(0,0,0,.12));
    background: var(--card-background-color, #fff); color: var(--primary-text-color); }
  button.chip.on, .seg button.on { background: var(--primary-color); border-color: var(--primary-color);
    color: var(--text-primary-color, #fff); }
  .seg { display: flex; }
  .seg button:first-child { border-radius: 16px 0 0 16px; }
  .seg button:last-child { border-radius: 0 16px 16px 0; border-left: none; }
  .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    text-align: center; padding: 24px; color: var(--secondary-text-color); pointer-events: none; }
  .empty[hidden], .notice[hidden] { display: none; }
  .notice { position: absolute; left: 8px; bottom: calc(var(--taylors3d-bar-height, 0px) + 8px); right: 8px; padding: 6px 10px; border-radius: 6px; font-size: 12px;
    background: var(--card-background-color, #fff); color: var(--error-color, #db4437);
    border: 1px solid var(--divider-color, rgba(0,0,0,.12)); pointer-events: none; }
  .status-legend { position: absolute; z-index: 15; left: 8px; bottom: calc(var(--taylors3d-bar-height, 0px) + 8px);
    max-width: calc(100% - var(--taylors3d-controls-width, 0px) - 16px); box-sizing: border-box; padding: 8px 10px;
    border-radius: 10px; background: var(--ha-card-background, var(--card-background-color, #fff));
    color: var(--primary-text-color, #212121); border: 1px solid var(--divider-color, #ddd); font-size: 12px;
    pointer-events: none; }
  .status-legend[hidden] { display: none; }
  .status-legend .scale { height: 7px; border-radius: 4px; margin: 6px 0; }
  .taylors3d-tracked-label { display: inline-flex; align-items: center; gap: 4px; }

  .fp-room-label { font-size: 11px; letter-spacing: .02em; color: var(--secondary-text-color, #727272);
    white-space: nowrap; pointer-events: none; opacity: .9; }
  .fp-room-label.outdoor { font-style: italic; }
  /* the marker box is just the dot (CSS2D centres the box on the 3D point); the value hangs below it */
  .fp-marker { position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: auto;
    cursor: pointer; transform-origin: center; }
  .fp-dot { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: var(--card-background-color, #fff); color: var(--secondary-text-color, #727272);
    border: 1.5px solid var(--divider-color, rgba(0,0,0,.15)); box-shadow: 0 1px 4px rgba(0,0,0,.25);
    transition: background .2s, color .2s, transform .1s; --mdc-icon-size: 17px; }
  .fp-marker:hover .fp-dot { transform: scale(1.12); }
  .fp-marker.active .fp-dot { background: var(--primary-color); border-color: var(--primary-color);
    color: var(--text-primary-color, #fff); }
  .fp-marker.active.light .fp-dot { background: var(--fp-light, var(--state-light-active-color, #ffb74d));
    border-color: var(--fp-light, var(--state-light-active-color, #ffb74d)); color: #fff; }
  .fp-marker.unavailable .fp-dot { opacity: .45; border-style: dashed; }
  .fp-marker.fp-occluded { opacity: .25; pointer-events: none; }
  .editing .fp-marker.fp-occluded { opacity: .5; pointer-events: auto; }
  .fp-val { position: absolute; top: calc(100% + 2px); left: 50%; transform: translateX(-50%);
    font-size: 10.5px; font-weight: 500; padding: 1px 5px; border-radius: 8px; white-space: nowrap;
    background: var(--card-background-color, #fff); color: var(--primary-text-color);
    box-shadow: 0 1px 3px rgba(0,0,0,.2); }
  .fp-val:empty { display: none; }
  .fp-popup { position: absolute; left: 0; top: 0; z-index: 30; min-width: 190px; max-width: 260px; padding: 8px 10px 10px;
    box-sizing: border-box; overflow: auto;
    border-radius: 12px; background: var(--card-background-color, #fff); color: var(--primary-text-color);
    border: 1px solid var(--divider-color, rgba(0,0,0,.12)); box-shadow: 0 4px 16px rgba(0,0,0,.28); font-size: 13px;
    touch-action: manipulation; user-select: none; -webkit-user-select: none; }
  .fp-pop-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .fp-pop-title { flex: 1; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fp-pop-x { border: none; background: none; color: var(--secondary-text-color); font-size: 18px; line-height: 1;
    cursor: pointer; padding: 2px 4px; }
  .fp-pop-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
  .fp-pop-label { flex: 1; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fp-pop-row.chain { border-top: 1px solid var(--divider-color, rgba(0,0,0,.12)); margin-top: 4px; padding-top: 4px; }
  .fp-pop-row.chain .fp-pop-label { color: var(--primary-text-color); }
  .fp-pop-row.reason { font-size: 12px; color: var(--secondary-text-color); font-style: italic; min-height: 0; padding-top: 4px; }
  .fp-pop-row.brightness .fp-pop-label { flex: none; }
  .fp-pop-row.brightness input { flex: 1; min-width: 0; accent-color: var(--primary-color); }
  .fp-pop-row.brightness.off input { opacity: .5; }
  .fp-pop-row.color { flex-wrap: wrap; gap: 6px; padding: 4px 0; }
  .fp-swatch { width: 22px; height: 22px; border-radius: 50%; padding: 0; cursor: pointer;
    border: 1.5px solid var(--divider-color, rgba(0,0,0,.15)); }
  .fp-swatch.on { outline: 2px solid var(--primary-color); outline-offset: 1px; }
  .fp-swatch.white { background: #ffd9a8; }
  .fp-switch { width: 36px; height: 20px; border-radius: 10px; border: none; padding: 2px; cursor: pointer; flex: none;
    background: var(--switch-unchecked-track-color, rgba(127,127,127,.45)); display: flex; transition: background .15s; }
  .fp-switch span { width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3);
    transition: transform .15s; }
  .fp-switch.on { background: var(--primary-color); }
  .fp-switch.on span { transform: translateX(16px); }
  .fp-pop-value { font-weight: 500; }
  .fp-pop-btns { display: flex; gap: 6px; }
  .fp-pop-btns button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 12px; cursor: pointer;
    border: 1px solid var(--divider-color, rgba(0,0,0,.12)); background: var(--card-background-color, #fff); color: var(--primary-text-color); }
  .body { display: flex; }
  .body .stage { flex: 1; min-width: 0; }
  .panel { display: none; width: 300px; flex: none; box-sizing: border-box; flex-direction: column; max-height: var(--fp-height);
    border-left: 1px solid var(--divider-color, rgba(0,0,0,.12)); font-size: 13px; }
  .editing .panel { display: flex; }
  /* narrow cards (e.g. a sections-view column): plan on top, panel below */
  @container (max-width: 640px) {
    .body.editing { flex-direction: column; }
    .body.editing .stage { flex: none; width: 100%; }
    .editing .panel { width: auto; max-height: 420px; border-left: none; border-top: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
  }
  .tabs { display: flex; flex-wrap: wrap; flex: none; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
  .panel .tabs button { flex: 1 0 64px; min-width: 64px; min-height: 44px; box-sizing: border-box; white-space: nowrap;
    border-radius: 0; font: inherit; padding: 10px 4px; background: none; border: none; cursor: pointer;
    color: var(--secondary-text-color); border-bottom: 2px solid transparent; }
  .panel .tabs button.on { color: var(--primary-color); border-bottom-color: var(--primary-color); }
  .tab-body { flex: 1; overflow: auto; padding: 4px 12px 12px; }
  .foot { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 11px;
    color: var(--secondary-text-color); border-top: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
  .panel h3 { margin: 4px 0 6px; font-size: 14px; font-weight: 500; }
  .panel .sub { margin: 14px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--secondary-text-color); }
  .panel .hint, .panel .dim { color: var(--secondary-text-color); }
  .panel .hint { font-size: 12px; line-height: 1.4; }
  .panel p { margin: 6px 0; }
  .panel .box { border: 1px solid var(--divider-color, rgba(0,0,0,.12)); border-radius: 8px; padding: 8px 10px;
    margin: 8px 0; }
  .panel label { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; font-size: 12px;
    color: var(--secondary-text-color); }
  .panel label.check { flex-direction: row; align-items: center; gap: 6px; color: var(--primary-text-color); }
  .panel select, .panel input[type=number] { font: inherit; padding: 5px 6px; border-radius: 6px;
    border: 1px solid var(--divider-color, rgba(0,0,0,.2)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); min-width: 0; }
  .panel button, .panel label.button { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color, rgba(0,0,0,.2)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); display: inline-block; margin: 0; }
  .panel button:disabled { opacity: .45; cursor: default; }
  .panel button.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .panel button.danger { color: var(--error-color, #db4437); }
  .panel button.link { border: none; background: none; padding: 0 2px; color: var(--primary-color); }
  .panel .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .panel ul { list-style: none; margin: 0; padding: 0; }
  .panel ul.list li { display: flex; align-items: center; gap: 6px; padding: 4px 0;
    border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.06)); }
  .panel ul.list li.sel .name { color: var(--primary-color); font-weight: 500; }
  .panel .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel .pill { font-size: 10.5px; padding: 1px 7px; border-radius: 9px; }
  .panel .pill.ok { background: rgba(76,175,80,.16); color: var(--success-color, #43a047); }
  .panel tr.sel td { background: rgba(3,169,244,.12); }
  .stage.picking .fp-marker, .stage.picking .fp-handle { pointer-events: none; opacity: .45; }
  .panel details.report { margin: 6px 0; font-size: 12px; }
  .panel details.report summary { cursor: pointer; color: var(--secondary-text-color); }
  .panel details.report ul, .panel .msg { user-select: text; -webkit-user-select: text; cursor: text; }
  .panel .pill.missing { background: rgba(255,152,0,.16); color: var(--warning-color, #ef8a00); }
  .panel table.floors { width: 100%; border-collapse: collapse; font-size: 12px; }
  .panel table.floors th { font-weight: normal; color: var(--secondary-text-color); text-align: left; font-size: 11px; }
  .panel table.floors td { padding: 2px 3px 2px 0; }
  .panel table.floors input { width: 64px; }
  .panel .note { padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.4; }
  .panel .note.ok { background: rgba(76,175,80,.12); }
  .panel .note.warn { background: rgba(255,152,0,.14); }
  .panel .msg { margin: 8px 0; padding: 6px 10px; border-radius: 6px; background: rgba(76,175,80,.12); font-size: 12px; }
  .panel .msg.warn { background: rgba(255,152,0,.14); }
  .panel .msg.error { background: rgba(219,68,55,.14); color: var(--error-color, #db4437); }
  button.edit { font: inherit; font-size: 13px; line-height: 1; cursor: pointer; padding: 6px 10px; border-radius: 16px;
    border: 1px solid var(--divider-color, rgba(0,0,0,.12)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); display: flex; align-items: center; gap: 4px; --mdc-icon-size: 16px; }
  button.edit[hidden], button.daynight[hidden], button.section[hidden] { display: none; }
  button.section.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  button.reset, button.section { font: inherit; line-height: 1; cursor: pointer; padding: 5px 8px; border-radius: 16px; display: flex;
    align-items: center; border: 1px solid var(--divider-color, rgba(0,0,0,.12)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); --mdc-icon-size: 17px; }
  button.daynight { font: inherit; font-size: 15px; line-height: 1; cursor: pointer; padding: 5px 10px; border-radius: 16px;
    border: 1px solid var(--divider-color, rgba(0,0,0,.12)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); display: flex; align-items: center; --mdc-icon-size: 17px; }
  .editing button.edit { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }

  .fp-handle { box-sizing: border-box; width: 13px; height: 13px; border-radius: 50%; pointer-events: auto; cursor: grab;
    background: var(--card-background-color, #fff); border: 2px solid var(--primary-color, #03a9f4); touch-action: none; }
  .fp-handle.mid { width: 9px; height: 9px; opacity: .75; border-width: 1.5px; }
  .fp-handle.door { width: 11px; height: 11px; border-radius: 2px; background: var(--primary-color, #03a9f4);
    pointer-events: none; }
  .fp-handle.draw { pointer-events: none; width: 9px; height: 9px; }
  .fp-handle.draw.first { width: 15px; height: 15px; background: var(--primary-color, #03a9f4); }
  .fp-handle.draw.calibration { width: 24px; height: 24px; display: grid; place-items: center; font-size: 12px;
    font-weight: 600; color: var(--primary-text-color, #222); background: var(--card-background-color, #fff); }
  .fp-handle.cursor { pointer-events: none; width: 7px; height: 7px; border: none; background: var(--primary-color, #03a9f4); }
  .fp-handle.cursor.vertex { width: 15px; height: 15px; background: none; border: 2px solid var(--primary-color, #03a9f4); }
  .fp-handle.cursor.align { width: 9px; height: 9px; }
  .editing .fp-marker { cursor: grab; }
  .stage.drawing { cursor: crosshair; }
  .stage.drawing .fp-marker { pointer-events: none; opacity: .4; }
  .stage.drawing .fp-handle { pointer-events: none; }
  .stage.moving { cursor: move; }
  .stage.moving .fp-marker, .stage.moving .fp-handle { pointer-events: none; }
  .panel input[type=range] { width: 100%; margin: 0; accent-color: var(--primary-color); }
  .panel label .lab { display: flex; justify-content: space-between; }
  .panel label .val { color: var(--primary-text-color); }
  .panel label.button.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .panel label.button.disabled { opacity: .6; pointer-events: none; }
  .panel .bad { color: var(--error-color, #db4437); }
  .panel code { font-size: 11px; }
  .panel .tabs button { padding: 10px 2px; font-size: 12.5px; }
  .panel input:not([type]), .panel input[list] { font: inherit; padding: 5px 6px; border-radius: 6px;
    border: 1px solid var(--divider-color, rgba(0,0,0,.2)); background: var(--card-background-color, #fff);
    color: var(--primary-text-color); min-width: 0; }
  .panel .row label { flex: 1; }
  .fp-marker.selected .fp-dot { outline: 3px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  .has-model .fp-dot { width: 22px; height: 22px; --mdc-icon-size: 14px;
    background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent); }
  .fp-marker.fp-faded { opacity: .3; }
  .compact .fp-dot { width: 21px; height: 21px; --mdc-icon-size: 13px; border-width: 1px; }
  .compact .fp-val { font-size: 9.5px; padding: 0 4px; }
  .stage.picking-views { cursor: pointer; }
  .panel details.advanced { margin: 12px 0 4px; }
  .panel details.advanced summary { cursor: pointer; color: var(--secondary-text-color); font-size: 12px; }
  .panel .floor-links { display: flex; flex-wrap: wrap; gap: 0 12px; }
  .panel .floor-links label.check { margin: 3px 0; }
  .panel ul.vtree li { display: flex; align-items: center; gap: 4px; padding: 1px 0 1px calc(var(--d, 0) * 14px);
    border-radius: 4px; min-height: 26px; }
  .panel ul.vtree li .name { font-size: 12.5px; }
  .panel ul.vtree li.off .name, .panel ul.vtree li.off .state { opacity: .45; }
  .panel ul.vtree li.lvl > .name { font-weight: 500; }
  .panel ul.vtree li.picked { background: rgba(3,169,244,.12); }
  .panel ul.vtree .state { --mdc-icon-size: 15px; color: var(--secondary-text-color); display: flex; }
  .panel ul.vtree button.eye { padding: 2px 5px; display: flex; align-items: center; --mdc-icon-size: 16px; line-height: 1; }
  .panel ul.vtree button.eye.shown { color: var(--primary-color); border-color: var(--primary-color); }
  .panel ul.vtree button.eye.hidden { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437); }
  .panel ul.vtree button.eye.default { opacity: .7; }
  .panel ul.otree { list-style: none; margin: 4px 0; padding: 0; }
  .panel ul.otree li.room { display: flex; align-items: center; gap: 4px; padding: 2px 0 2px calc(var(--d, 0) * 14px); font-size: 12.5px; }
  .panel ul.otree li.lvl { font-weight: 500; }
  .panel ul.otree li.obj { padding: 4px 6px; margin: 2px 0 2px 28px; border-radius: 6px; border: 1px solid var(--divider-color); }
  .panel ul.otree li.obj.sel { background: rgba(3,169,244,.12); border-color: var(--primary-color); }
  .panel ul.otree li.obj.hid .name { opacity: .5; }
  .panel ul.otree li.obj .orow { display: flex; align-items: center; gap: 6px; --mdc-icon-size: 16px; margin-bottom: 3px; }
  .panel ul.otree li.obj .orow .name { flex: 1; font-size: 12.5px; }
  .panel ul.otree li.obj .orow label.check { margin: 0; font-size: 12px; }
  .panel ul.otree li.obj input[type=text], .panel ul.otree li.obj input:not([type]) { width: 100%; box-sizing: border-box; }
  .panel ul.otree .badge { font-size: 9.5px; padding: 0 4px; border-radius: 4px; background: var(--secondary-background-color, rgba(127,127,127,.2)); color: var(--secondary-text-color); }
  .panel ul.otree .badge.warn { background: none; color: var(--error-color, #db4437); border: 1px solid currentColor; }
  .panel ul.otree li.flash { animation: fp-flash 1.2s ease-out; }
  .panel ul.vtree li.flash { animation: fp-flash 1.2s ease-out; }
  @keyframes fp-flash { 0%, 40% { background: color-mix(in srgb, var(--primary-color, #03a9f4) 35%, transparent); } 100% { background: transparent; } }
  .panel ul.vtree li.part .state { color: var(--primary-color); }
  .panel ul.vtree button.expand { font-size: 12px; color: var(--secondary-text-color); padding: 0 4px; }
  .panel ul.vtree .yaml { font-size: 9.5px; padding: 0 4px; border-radius: 4px; letter-spacing: .04em;
    border: 1px solid var(--divider-color, rgba(0,0,0,.2)); color: var(--secondary-text-color); }
  .panel ul.vtree li.gone .name { text-decoration: line-through; opacity: .6; }
  .fp-pickmenu { position: absolute; z-index: 5; display: flex; flex-direction: column; gap: 2px; padding: 6px; min-width: 170px;
    box-sizing: border-box; border-radius: 8px; font-size: 12.5px; color: var(--primary-text-color);
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color, rgba(0,0,0,.12));
    box-shadow: 0 4px 16px rgba(0,0,0,.28); }
  .fp-pickmenu .title { padding: 2px 6px 4px; font-size: 11px; color: var(--secondary-text-color);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
  .fp-pickmenu button { font: inherit; text-align: left; padding: 6px 8px; border: none; border-radius: 5px; cursor: pointer;
    background: none; color: inherit; }
  .fp-pickmenu button:hover { background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, transparent); }
`;

function cssColor(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  const c = new Color();
  try {
    // drop alpha from rgba() so three.js can parse it
    c.setStyle((v || fallback).replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)'));
  } catch (e) {
    c.setStyle(fallback);
  }
  return c;
}

const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function readSkyMode() {
  try {
    const v = localStorage.getItem('taylors3d.sky');
    if (v === 'auto' || v === 'day' || v === 'night') return v;
  } catch (e) { /* storage blocked */ }
  return 'auto';
}

function readPanelName() {
  try {
    const name = (localStorage.getItem('taylors3d.panel') || '').trim();
    return name.length <= 128 ? name : '';
  } catch { return ''; }
}

class Taylors3dCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._layout = null;
    this._layoutReady = new Promise((r) => { this._layoutLoaded = r; }); // resolves once the stored layout has loaded (or failed)
    this._built = {};
    this._markers = [];
    this._markerEls = new Map();
    this._floor = null;
    this._views = [];
    this._viewId = null;
    this._viewState = null;
    this._viewStates = new Map();
    this._index = null;
    this._mode = '3d';
    this._daylight = true;
    this._skyMode = readSkyMode();
    this._skyLast = null;
    this._section = false; // side section toggle
    this._sectionPreview = null; // Views tab slider: plane shown while dragging
    this._objects = null; // ObjectLayer: model lamps and the real light pool
    this._bindings = new Map(); // object id -> binding (objects/logic.js bindObjects)
    this._boundEntities = new Set(); // entities bound to a model object: no marker of their own
    this._mowerObjectBound = false;
    this._groups = {}; // layout.groups whose controller exists in HA (objects/logic.js effectiveGroups)
    this._bindKey = null;
    this._miniMapVisible = true;
    this._history = new EditHistory();
    this._lightPreview = null;
    this._lightPreviewOwner = null;
    this._scenePreviewStatus = null;
    this._scenePreviewController = new ScenePreviewController({
      getContext: () => this._scenePreviewContext(),
      onPreview: (overrides, metadata) => this.previewSceneLights(overrides, metadata),
      onStatus: (status) => { this._scenePreviewStatus = status; this._scenePreviewBar?.update(); },
    });
    this._ambientPointers = new Set();
    this._ambientKeys = new Set();
    this._ambientWakeEvents = new WeakSet();
    this._ambientWindowActive = true;
    this._ambientController = new AmbientIdleController({
      getContext: () => this._ambientContext(),
      onBegin: (reading) => {
        if (!reading.policy.rotate || reading.policy.rotation_degrees_per_second === 0) return true;
        const view = this._view;
        if (!view?.beginAmbientCamera?.({ ...reading, speed: reading.policy.rotation_degrees_per_second })) return false;
        this._ambientCameraOwner = { view, token: reading.token, generation: reading.generation };
        return true;
      },
      onAdvance: (reading) => {
        const owner = this._ambientCameraOwner;
        return !!(owner?.view === this._view && owner.token === reading.token && owner.generation === reading.generation
          && owner.view.advanceAmbientCamera(reading));
      },
      onEnd: (reading) => {
        const owner = this._ambientCameraOwner;
        if (!owner || owner.token !== reading.token) return false;
        this._ambientCameraOwner = null;
        return owner.view.endAmbientCamera({ ...reading,
          restore: reading.restore && owner.view === this._view && owner.generation === this._ambientGeneration() });
      },
      onDim: (reading) => this._applyAmbientDim(reading.brightness),
    });
    this._wallInteractionSerial = 0;
    this._wallLifecycleGeneration = 0;
    this._onAmbientInput = (event) => {
      if (['pointerdown', 'wheel', 'keydown'].includes(event.type)) this._wallInteractionSerial++;
      this._ambientActivity(event);
    };
    this._onAmbientRelease = (event) => {
      const held = event.type === 'keyup' ? this._ambientKeys : this._ambientPointers;
      const id = event.type === 'keyup' ? event.code || event.key : event.pointerId;
      if (!held.delete(id)) return;
      this._ambientActivity();
    };
    this._onAmbientBlur = () => {
      this._ambientWindowActive = false;
      this._ambientControlsGesture = false;
      this._ambientPointers.clear(); this._ambientKeys.clear();
      this._suspendAmbient('window focus lost');
    };
    this._onAmbientFocus = () => { this._ambientWindowActive = true; this._syncAmbient(); };
    this._onAmbientPreference = () => { this._syncAmbient(); this._syncWallPresentation(); };
    this._onAmbientCameraInteraction = (phase) => {
      if (phase === 'start') this._wallInteractionSerial++;
      this._ambientControlsGesture = phase === 'start';
      this._ambientActivity();
    };
    this._trackingMemory = { presence: {}, vehicles: {}, vacuums: {} };
    this._trackingSourceKeys = new Map();
    this._trackingData = { records: [], diagnostics: [], miniMap: [], nextExpiry: null };
    this._trackingTimer = null;
    this._trackingDeadline = null;
    this._trackingGeneration = 0;
    this._securitySessionGeneration = 0;
    this._securityPlanData = { records: [], diagnostics: [], miniMap: [], nextExpiry: null };
    this._onTrackingVisibility = () => {
      this._syncSecurity(true);
      if (document.hidden) this._clearTrackingTimer();
      else if (this.isConnected) { this._syncTracking(true); this._syncMiniMap(); }
    };
    this._weatherInView = true; // Older browsers without IntersectionObserver retain the normal card lifecycle.
    this._onWeatherVisibility = () => {
      this._syncWeatherVisibility();
      this._syncAmbient();
      if (this.isConnected && !document.hidden) { this._syncWeather(); this._applySky(false); }
    };
    this._panelName = readPanelName();
    this._presetEvents = new PresetEventController({
      getTarget: () => ({ layout_key: this._config?.layout_key, panel: this._panelName || this._config?.automation_panel,
        card_id: this._config?.automation_card_id }),
      getViews: () => this._views,
      getCurrent: () => this._currentPresetCamera(),
      onSelect: (view, options) => this._selectPreset(view, options),
      onError: (error) => { this._presetError = error; this._showNotice(); },
    });
    this._onPanelName = (event) => {
      if (event.type === 'storage' && event.key !== null && event.key !== 'taylors3d.panel') return;
      this._panelName = readPanelName();
      if (this.isConnected) this._presetEvents.setHass(this._hass);
    };
  }

  static getStubConfig() {
    return { layout_style: 'house', house_colour_scheme: 'dark' };
  }

  // sections view: span the whole section by default
  getGridOptions() {
    return { columns: 'full', min_columns: 6, rows: 'auto' };
  }

  static getConfigElement() {
    return document.createElement('taylors3d-card-editor');
  }

  setConfig(config) {
    const previous = this._config;
    if (previous) this._edit?._dashboardBackupEditor?.reset();
    if (previous) this._suspendAmbient('card settings changed');
    if (previous) this.finishWallSelectionPreparation({ reload: false });
    if (previous) this._wallLifecycleGeneration++;
    this._config = { layout_key: 'default', height: '520px', group_by: 'device', wall_height: 1.0, view: '3d',
      show_bubble_bar: true, mini_map: true, mini_map_size: 180, mini_map_position: 'top-right', device_tap_action: 'popup',
      control_panel: 'right', layout_style: 'original', house_colour_scheme: 'ha', ...config };
    this._syncScenePreviews();
    if (!previous || previous.mini_map !== this._config.mini_map) this._miniMapVisible = this._config.mini_map !== false;
    if (!previous || previous.view !== this._config.view) this._mode = this._config.view === 'top' ? 'top' : '3d';
    const keyChanged = previous && previous.layout_key !== this._config.layout_key;
    if (!this._store || keyChanged) this._store = new LayoutStore(this._config.layout_key);
    if (keyChanged) {
      this._edit?.cancelHistoryGestures?.();
      this._history.reset();
      this._presetEvents.interrupt();
      this._alertLatches = {};
      this._statusRefs = null;
      this._cameraCoveragePreview = null;
      this._resetTracking();
      this._resetSecurity();
      this._layoutLoaded(); // release any obsolete model request waiting for the old key
      this._layoutReady = new Promise((resolve) => { this._layoutLoaded = resolve; });
      this._layout = null;
      this._loading = false;
      this._syncWeatherVisibility();
      this._built = {};
      this._fitted = false;
      this._viewId = null;
      this._saveSeq = (this._saveSeq || 0) + 1;
      this._endGesture();
      if (this._popup) this._popup.close();
      if (this._devicePopup) this._devicePopup.close();
      if (this._hass) this._load();
    }
    this._syncFurniture();
    if (this._stage) {
      this._stage.style.height = this._config.height;
      this._body.style.setProperty('--fp-height', this._config.height);
    }
    if (this.isConnected && !this._view) this.connectedCallback();
    else if (this._view) {
      if (this._view.mode !== this._mode) this._setMode(this._mode);
      this._view.setOcclusion(this._config.occlusion !== false);
      if (this._view.model) this._applySky(true); // sky_bodies
      this._applyZoomTo();
      this._loadModel();
      this._updateObjects(); // lights: auto | off
      this._configureMiniMap();
      this._devicePopup.setPlacement(this._houseLayoutEnabled() ? 'right' : this._config.control_panel);
      this._syncToolbar();
      this._schedule();
    }
    if (previous && !keyChanged && this._layout && !this._historyReplaying) this._recordHistory('Card settings');
    if (this.isConnected) this._presetEvents.setHass(this._hass);
  }

  // model: from YAML (model: url) if set, else the one uploaded to the integration (layout.model)
  _loadModel(reload = false) {
    if (!this._wallPreparation) this._wallRestoreMergePending = false;
    this._syncModelRendering();
    const c = this._config;
    let opts = null;
    if (c.model) {
      opts = {
        url: String(c.model),
        position: Array.isArray(c.model_position) ? c.model_position.map(Number) : [0, 0, 0],
        rotation: Number(c.model_rotation) || 0, scale: Number(c.model_scale) || 1,
        opacity: c.model_opacity === undefined ? 1 : Number(c.model_opacity),
      };
    } else {
      const m = this._layout && this._layout.model;
      if (m && m.version && this._hass && this._hass.fetchWithAuth) {
        const url = `${MODEL_API}/${encodeURIComponent(c.layout_key)}?v=${m.version}`;
        opts = {
          id: m.version, name: m.name,
          data: async () => {
            const r = await this._hass.fetchWithAuth(url);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
          },
          position: m.position || [0, 0, 0], rotation: m.rotation || 0, scale: m.scale || 1, opacity: m.opacity ?? 1,
        };
      }
    }
    if (opts) {
      opts.merge = c.merge !== false && !this._wallPreparation;
      // node: rules in the layout must be known before merging: wait for it when it has not loaded yet
      opts.keep = () => (this._layout ? this._mergeKeepSelectors() : this._layoutReady.then(() => this._mergeKeepSelectors()));
      opts.onMerged = () => this._modelMerged();
      opts.reload = reload;
    }
    const prevModel = this._view.model;
    const modelSource = opts && (opts.id || opts.url);
    const requestedModel = modelSource && opts.merge === false ? modelSource + '#nomerge' : modelSource;
    if (reload || (requestedModel || null) !== (prevModel?.id || null)) {
      this._suspendAmbient('model loading');
      this._stopScenePreview('model loading');
    }
    const requestedView = this._view;
    return requestedView.setModel(opts).then((err) => {
      if (this._view !== requestedView) return err;
      if (this._view.model !== prevModel) this._stopScenePreview('model changed');
      if (this._view.model !== prevModel && this._section) this._dropSection();
      if (this._view.model !== prevModel) { this._endGesture(); this._popup.close(); this._devicePopup.close(); }
      this._objects.setModel(this._view.model);
      // bind now: lamps light and bound markers hide without waiting for the next hass push
      if (this._hass && this._layout && this._floors && this._syncBindings()) {
        this._buildMarkers();
        this._refreshStates();
      }
      this._updateObjects();
      this._refreshAttached(); // the model (re)placed: attached markers follow their objects
      this._modelError = err;
      const modelLabel = String(opts?.name || opts?.url || 'model');
      this._modelErrorNotice = err === `Could not load model ${modelLabel}` ? ownedRuntimeError('modelLoad', { label: modelLabel }) : null;
      this._showNotice();
      // a new model resets the views; the first view applied frames it (see _resolveViewList)
      this._stage.classList.toggle('has-model', !!this._view.model);
      if (this._view.model) this._applySky(true);
      else { this._daylight = true; this._view.setDaylight(true); } // no model: the toggle is hidden, so always day
      this._syncToolbar();
      this._schedule(); // the manifest arrived: rebuild
      if (this._editing) this._edit.onModelLoaded(this._view.model !== prevModel);
      this._syncWallPresentation();
      return err;
    });
  }

  // The model was merged after it was shown (the layout came later): index the merged tree, re-apply the view.
  _modelMerged() {
    const vw = this._view;
    if (!vw.model) return;
    if (this._index && this._built.viewManifest === vw.model.manifest) {
      this._index = nodeIndex(threeAdapter(vw.model.root), vw.model.manifest);
      this._viewStates = new Map();
      const cur = this.currentView();
      this._viewState = cur ? this._stateFor(cur) : null;
      if (!this._floorOnly) this._applyViewVisibility();
      this._applyMarkerStates();
    }
    if (this._editing) this._edit.render();
    this._schedule();
  }

  // Layout node: rules that match nothing and were not known when the model was merged (an imported or
  // later-loaded layout may target merged parts): load the model once more, merging around them.
  _checkMergeKeep() {
    const vw = this._view, ms = vw.mergeStats;
    if (!vw.model || !ms || !ms.enabled || !ms.merged || !this._index) return;
    const known = new Set(ms.keep);
    const fresh = this._mergeKeepSelectors().filter((x) => x.startsWith('node:') && !known.has(x));
    if (!fresh.length || !unmatchedSelectors(this._index, fresh.map((x) => ({ hide: x }))).length) return;
    const signature = JSON.stringify([vw.model.id, [...new Set(fresh)].sort()]);
    if (this._mergeReloadFor === signature) return;
    this._mergeReloadFor = signature;
    this._loadModel(true);
  }

  // View rule selectors from the layout and the card YAML: their node: matches are not merged away.
  _mergeKeepSelectors() {
    const out = [];
    const add = (views) => {
      if (!views || typeof views !== 'object') return;
      for (const v of Object.values(views)) {
        for (const r of (v && Array.isArray(v.rules) ? v.rules : [])) {
          const sel = r && (r.show ?? r.hide);
          if (typeof sel === 'string') out.push(sel);
        }
      }
    };
    add(this._layout && this._layout.views);
    add(this._config.views);
    out.push(...wallKeepSelectors(this._layout?.wall_presentation ?? this._config?.wall_presentation));
    return [...new Set(out)];
  }

  _modelAlign() {
    const c = this._config;
    if (c.model) {
      return {
        position: Array.isArray(c.model_position) ? c.model_position.map(Number) : [0, 0, 0],
        rotation: Number(c.model_rotation) || 0, scale: Number(c.model_scale) || 1,
      };
    }
    const m = (this._layout && this._layout.model) || {};
    return { position: m.position || [0, 0, 0], rotation: m.rotation || 0, scale: m.scale || 1 };
  }

  // Saved level/room bindings (layout.model; YAML model_floors for URL models) resolved
  // against the loaded model and the current HA floors and areas.
  modelBindings() {
    const manifest = this._view && this._view.modelManifest();
    if (!manifest || !this._hass) return null;
    // cached per input identity: per hass state update nothing here changes
    const inputs = [manifest, this._layout && this._layout.model, this._layout && this._layout.floors, this._hass.floors, this._hass.areas, this._config];
    const c = this._mbCache;
    if (c && c.inputs.every((x, i) => x === inputs[i])) return c.value;
    const value = this._computeBindings(manifest);
    this._mbCache = { inputs, value };
    return value;
  }

  _computeBindings(manifest) {
    const saved = (this._layout && this._layout.model) || {};
    const savedLevels = { ...(this._config.model ? levelsFromFloorMap(this._config.model_floors) : {}), ...(saved.levels || {}) };
    const haFloors = mergeFloors(this._hass, this._layout || {}); // HA floors plus layout-only floors
    return {
      manifest,
      levels: resolveLevels(manifest.levels, haFloors, savedLevels),
      rooms: resolveRoomAreas(manifest.rooms, Object.keys(this._hass.areas || {}), saved.rooms || {}),
      diff: bindingDiff(manifest, saved),
      notice: snapshotDiff(manifest, saved.known),
    };
  }

  _allRooms() {
    return combineRooms((this._layout && this._layout.rooms) || [], this._modelRooms || []);
  }

  getCardSize() {
    return Math.ceil(parseInt(this._config?.height, 10) / 50) || 10;
  }

  set hass(hass) {
    if (this._hass && (this._hass.connection !== hass?.connection || this._hass.user?.id !== hass?.user?.id
      || this._hass.auth !== hass?.auth)) {
      // A native input draft belongs to the account/connection that opened it.
      // Closing synchronously prevents its late change event acting as a new user.
      this._devicePopup?.close({ restoreFocus: false });
      this._popup?.close();
      this._suspendAmbient('Home Assistant session changed');
      this.finishWallSelectionPreparation({ reload: false });
      this._wallLifecycleGeneration++;
    }
    if (this._hass?.connection && this._hass.connection !== hass?.connection) {
      // Reconnecting to HA is not a new observation. Keep each unchanged source's
      // accepted event/deadline, but replace cached readings and the old timer.
      this._clearTrackingTimer();
      this._trackingInputKey = null;
    }
    this._hass = hass;
    this._devicePopup?.observeContexts?.(hass);
    this._popup?.observeContexts?.(hass);
    // Observe even same-object disconnect/role loss before a later recovered
    // setter can make an old native backup gesture appear current again.
    this._edit?._dashboardBackupEditor?.onStates();
    // A disconnected session or unavailable alert source can recover before
    // the scheduled update. Observe the loss now so an old input/Save cannot revive.
    if (this._edit?._modelPositionScope) this._edit._modelPositionAllowed();
    if (this._edit?._mowerImageScope) this._edit._mowerImageAllowed();
    this._edit?._trackingEditor?.observe?.();
    this._edit?._roomActionsEditor?.observe?.();
    this._edit?._overlayEditor?._pollIntents();
    this._observeSecuritySession();
    this._observeAlertMapContext();
    this._edit?._securityEditor?.observe();
    this._syncSecurity();
    this._syncFurniture();
    if (this._houseLayoutEnabled()) {
      if (!this._houseSessionActive()) this._devicePopup?.close({ restoreFocus: false });
      this._devicePopup?.update(hass);
    }
    this._syncHouseShell();
    if (this._wallPreparation && !this._wallPreparationCurrent(this._wallPreparation)) {
      // Observe permission loss before invalidating the frame: cleanup must still
      // remember that its temporary unmerged model needs the configured merge.
      this.finishWallSelectionPreparation({ reload: false });
      this._wallLifecycleGeneration++;
    }
    if (this._wallRestoreMergePending && this.isConnected && this._view && this._wallSessionActive()) this._loadModel();
    this._syncScenePreviews();
    this._syncAmbient();
    if (this.isConnected) this._presetEvents.setHass(hass);
    if (this._view && this._view.model && this._skyMode === 'auto') this._applySky(false);
    if (!this._layout && !this._loading) this._load();
    this._schedule();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    if (!this._config) return; // setConfig renders once it arrives
    this._ambientPointers.clear(); this._ambientKeys.clear();
    this._ambientControlsGesture = false;
    this._ambientWindowActive = typeof document.hasFocus !== 'function' || document.hasFocus();
    if (!this._view) this._render();
    else if (this._editing) this._edit.attach();
    this._view.start();
    if (this._wallRestoreMergePending && this._wallSessionActive()) this._loadModel();
    this._panelName = readPanelName();
    window.addEventListener('taylors3d-panel-change', this._onPanelName);
    window.addEventListener('storage', this._onPanelName);
    document.addEventListener('visibilitychange', this._onTrackingVisibility);
    document.addEventListener('visibilitychange', this._onWeatherVisibility);
    window.addEventListener('pointerup', this._onAmbientRelease, true);
    window.addEventListener('pointercancel', this._onAmbientRelease, true);
    window.addEventListener('keyup', this._onAmbientRelease, true);
    window.addEventListener('blur', this._onAmbientBlur);
    window.addEventListener('focus', this._onAmbientFocus);
    this._watchAmbientPreference();
    this._watchWeatherVisibility();
    this._syncWeather();
    this._trackingInputKey = null;
    this._presetEvents.setHass(this._hass);
    clearInterval(this._skyTimer);
    this._skyTimer = setInterval(() => this._applySky(false), MOON_EVERY_MS); // the moon moves without hass updates
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this._stage);
    this._ro.observe(this._scene);
    this._ro.observe(this._toolbar);
    this._houseObserved = new Set();
    this._syncHouseShell();
    this._schedule();
    this._syncFurniture();
    this._syncAmbient();
  }

  disconnectedCallback() {
    this._edit?._dashboardBackupEditor?.setActive(false);
    this._edit?._furnitureDrag?.cancel();
    this._furnitureCoordinator?.clearPreview();
    this._syncFurniture();
    this._houseShell?.setData({ enabled: false });
    this._houseObserved?.clear();
    this._suspendAmbient('disconnected');
    this.finishWallSelectionPreparation({ reload: false });
    this._wallLifecycleGeneration++;
    this._syncWallPresentation();
    this._ambientPointers.clear(); this._ambientKeys.clear();
    this._ambientControlsGesture = false;
    window.removeEventListener('pointerup', this._onAmbientRelease, true);
    window.removeEventListener('pointercancel', this._onAmbientRelease, true);
    window.removeEventListener('keyup', this._onAmbientRelease, true);
    window.removeEventListener('blur', this._onAmbientBlur);
    window.removeEventListener('focus', this._onAmbientFocus);
    this._unwatchAmbientPreference();
    this._stopScenePreview('disconnected');
    window.removeEventListener('taylors3d-panel-change', this._onPanelName);
    window.removeEventListener('storage', this._onPanelName);
    document.removeEventListener('visibilitychange', this._onTrackingVisibility);
    document.removeEventListener('visibilitychange', this._onWeatherVisibility);
    this._weatherObserver?.disconnect();
    this._weatherObserver = null;
    this._weatherLayer?.setVisible(false);
    this._clearTrackingTimer();
    this._trackingLayer?.setVisible(false);
    this._securityLayer?.setVisible(false);
    this._planSecurityLayer?.setVisible(false);
    this._edit?._securityEditor?.observe();
    this._refreshSecurityMotion();
    this._presetEvents.disconnect();
    if (this._view) this._view.stop();
    this._endGesture();
    if (this._popup) this._popup.close(); // window listeners
    if (this._devicePopup) this._devicePopup.close();
    if (this._editing && this._edit) this._edit.detach(); // window listeners (keys, pick menu)
    if (this._ro) this._ro.disconnect();
    clearInterval(this._skyTimer);
    this._skyTimer = null;
    this._setCameraTimer(0);
    this._setImageTimer(0);
  }

  async _load() {
    this._suspendAmbient('layout loading');
    this._stopScenePreview('layout loading');
    this._edit?.cancelHistoryGestures?.();
    this._resetTracking();
    this._resetSecurity();
    const store = this._store;
    this._loading = true;
    this._syncFurniture();
    this._syncWeatherVisibility();
    try {
      const layout = await store.load(this._hass);
      if (store !== this._store) return; // a late old-key response cannot replace the new layout
      this._layout = layout;
      this.resetHistory();
    } finally {
      if (store === this._store) {
        this._loading = false;
        this._syncFurniture();
        this._layoutLoaded();
      }
    }
    this._schedule();
  }

  _render() {
    this._edit?._dashboardBackupEditor?.dispose();
    this._edit?._furnitureDrag?.cancel();
    this._furnitureCoordinator?.clearPreview();
    this._furnitureLayer?.dispose();
    this._furnitureLayer = null;
    this._suspendAmbient('renderer replaced');
    this.finishWallSelectionPreparation({ reload: false });
    this._wallRestoreMergePending = false; // The replacement View loads the configured merge mode.
    this._view?.setWallPresentation?.(undefined, { enabled: false });
    this._unwatchAmbientPreference();
    this._unbindAmbientInput();
    this._scenePreviewBar?.dispose();
    this._stopScenePreview('renderer replaced');
    this._securityLayer?.dispose();
    this._securityLayer = null;
    this._securityInputKey = null;
    this._securityModel = null;
    this._planSecurityLayer?.dispose();
    this._planSecurityLayer = null;
    this._securityPlanScene = null;
    this._securityPlanData = { records: [], diagnostics: [], miniMap: [], nextExpiry: null };
    this._weatherObserver?.disconnect();
    this._weatherObserver = null;
    this._weatherLayer?.dispose();
    this._weatherLayer = null;
    this._weatherScene = null;
    this._weatherView = null;
    const root = this.shadowRoot;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="body">
          <div class="stage">
            <div class="scene"></div>
            <nav class="toolbar" data-taylors3d-ui aria-label="House views and controls">
              <div class="chips"></div>
              <div class="bubble-actions">
                <div class="seg" data-bubble="mode" role="group" aria-label="Viewing mode"><button data-mode="3d">3D</button><button data-mode="top">Top</button></div>
                <button class="reset" data-bubble="reset" title="Reset view" aria-label="Reset view"><ha-icon icon="mdi:crosshairs-gps"></ha-icon></button>
                <button class="section" data-bubble="section" hidden title="Side section" aria-label="Side section"><ha-icon icon="mdi:box-cutter"></ha-icon></button>
                <button class="daynight" data-bubble="daynight" hidden title="Day / night: auto" aria-label="Day / night: auto"><ha-icon icon="mdi:theme-light-dark"></ha-icon></button>
                <button class="minimap-toggle reset" data-bubble="minimap" title="Show or hide mini-map" aria-label="Show or hide mini-map"><ha-icon icon="mdi:map-outline"></ha-icon></button>
                <button class="edit" data-bubble="edit" hidden title="Edit floorplan"><ha-icon icon="mdi:pencil"></ha-icon><span>Edit</span></button>
              </div>
              <div class="scene-presets"></div>
            </nav>
            <div class="empty" hidden></div>
            <div class="notice" hidden></div>
            <div class="status-legend" data-taylors3d-ui role="status" aria-live="polite" hidden><strong></strong><div class="scale"></div><span></span></div>
          </div>
        </div>
      </ha-card>`;
    this._stage = root.querySelector('.stage');
    this._stage.tabIndex = -1; // Return keyboard focus when a tracked label disappears.
    this._scene = root.querySelector('.scene');
    this._toolbar = root.querySelector('.toolbar');
    this._stage.style.height = this._config.height;
    root.querySelector('.body').style.setProperty('--fp-height', this._config.height);
    this._chips = root.querySelector('.chips');
    this._empty = root.querySelector('.empty');
    this._notice = root.querySelector('.notice');
    this._statusLegend = root.querySelector('.status-legend');
    root.querySelector('.seg').addEventListener('click', (e) => {
      const mode = e.target.dataset && e.target.dataset.mode;
      if (mode) this._setMode(mode);
    });
    this._chips.addEventListener('click', (e) => {
      const id = e.target.dataset && e.target.dataset.view;
      if (id) this._setView(id);
    });
    root.querySelector('button.reset').addEventListener('click', () => this._resetCamera());
    this._sectionBtn = root.querySelector('button.section');
    this._sectionBtn.addEventListener('click', () => this.setSection(!this._section));
    this._body = root.querySelector('.body');
    this._editBtn = root.querySelector('button.edit');
    this._dayBtn = root.querySelector('button.daynight');
    this._dayBtn.addEventListener('click', () => {
      this._skyMode = { auto: 'day', day: 'night', night: 'auto' }[this._skyMode];
      try { localStorage.setItem('taylors3d.sky', this._skyMode); } catch (e) { /* private mode */ }
      this._applySky(true);
      this._syncToolbar();
    });
    this._editBtn.addEventListener('click', () => this._toggleEdit());
    this._miniMapBtn = root.querySelector('button.minimap-toggle');
    this._miniMapBtn.addEventListener('click', () => {
      this._miniMapVisible = !this._miniMapVisible;
      this._syncMiniMap();
      this._syncToolbar();
    });
    this._view = new FloorplanView(this._scene);
    this._syncModelRendering();
    this._ensureWeatherLayer();
    this._statusOverlays = new StatusOverlays(this._view.scene, { onInvalidate: () => { this._view.dirty = true; } });
    this._cameraCoverage = new CameraCoverageLayer(this._view.scene, { onInvalidate: () => { this._view.dirty = true; } });
    this._trackingLayer?.dispose();
    this._trackingLayer = new TrackedEntitiesLayer(this._view.scene, {
      onInvalidate: () => { this._view.dirty = true; }, onSelect: (id) => this._showTrackedEntity(id),
      returnFocus: () => this._stage,
    });
    this._reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this._watchAmbientPreference();
    this._view.onFrame = (now) => this._animateFeatures(now);
    this._view.onCameraInteraction = this._onAmbientCameraInteraction;
    this._objects = new ObjectLayer(this._view);
    this._view.onObjectsInvalidate = () => { this._updateObjects(); this._syncFurniture(); }; // view, section or placement changed
    this._popup = new ObjectPopup(this._stage, {
      onAction: (domain, service, data) => this._hass && this._hass.callService(domain, service, data),
      project: (w) => this._view.projectWorld(w),
      anchor: (id) => this._objects.displayAnchorOf ? this._objects.displayAnchorOf(id) : this._objects.anchorOf(id),
      resolve: (id) => {
        const o = this._objects.objectAt(id);
        if (!o || !this._hass || (o.binding && o.binding.hidden)) return null;
        return { obj: o.obj, chain: o.chain, states: this._hass.states, groups: this._groups, hass: this._hass };
      },
    });
    this._devicePopup = new DevicePopup(this._stage, {
      onAction: (domain, service, data) => this._hass.callService(domain, service, data),
      getRoomActions: (room) => this._roomShortcutData(room?.id),
      onRoomAction: (roomId, actionId) => this._runRoomShortcut(roomId, actionId),
      onMoreInfo: (entityId) => this._moreInfo(entityId),
      placement: this._houseLayoutEnabled() ? 'right' : this._config.control_panel,
      onVisibilityChange: (open, placement) => {
        if (open) this._suspendAmbient('device controls opened');
        if (open) this._stopScenePreview('device controls opened');
        this._stage.classList.toggle('controls-open', open && placement === 'right');
        if (!open) this._houseSelection = 'house';
        this._syncHouseShell();
        requestAnimationFrame(() => this.isConnected && this._resize());
      },
    });
    this._configureMiniMap();
    this._view.onRender = () => {
      this._trackingLayer?.arrangeScreenLabels(this._scene.getBoundingClientRect());
      this._popup.position();
      this._miniMap.updateCamera({ camera: this._view.getCamera(), topCamera: this._view.getTopCamera(), mode: this._mode });
    };
    this._view.setOcclusion(this._config.occlusion !== false);
    this._view.setMode(this._mode);
    this._loadModel();
    this._edit = new EditMode(this);
    this._body.append(this._edit.panel);
    this._scenePreviewBar = new ScenePreviewBar(root.querySelector('.scene-presets'), {
      controller: this._scenePreviewController,
      getContext: () => ({ hass: this._hass, settings: this._scenePreviewSettings(),
        suspended: !this._scenePreviewAvailable(false), contextKey: this._scenePreviewKey(), status: this._scenePreviewStatus }),
    });
    const canvas = this._view.renderer.domElement;
    this._bindAmbientInput();
    this._stage.addEventListener('pointerdown', (e) => {
      this._scenePreviewInteraction(e);
      this._presetEvents.interrupt();
      if (!this._editing && this._view._tween) this._view.stopCameraMotion();
      if (this._editing && e.target === canvas) this._edit.canvasDownCapture(e);
    }, true);
    this._stage.addEventListener('pointerup', (event) => this._edit?._furnitureDrag?.up(event), true);
    this._stage.addEventListener('pointercancel', (event) => this._edit?._furnitureDrag?.up(event, true), true);
    this._stage.addEventListener('click', (event) => this._edit?._furnitureDrag?.consumeClick(event), true);
    this._body.addEventListener('pointerdown', (event) => this._scenePreviewInteraction(event), true);
    this._body.addEventListener('keydown', (event) => this._scenePreviewInteraction(event), true);
    canvas.addEventListener('pointerdown', (e) => this._editing && this._edit.canvasDown(e));
    canvas.addEventListener('pointerdown', (e) => this._roomDown(e));
    canvas.addEventListener('pointermove', (e) => this._editing && this._edit.canvasMove(e));
    canvas.addEventListener('pointerup', (e) => this._editing && this._edit.canvasUp(e));
    // model objects: tap / hold, hit-tested on screen before markers and the canvas (capture phase)
    this._stage.addEventListener('pointerdown', (e) => this._objectDown(e, canvas), true);
    this._syncToolbar();
  }

  _toggleEdit() {
    this._suspendAmbient('editing changed');
    this._stopScenePreview('editing changed');
    this._presetEvents.interrupt();
    this._view.stopCameraMotion();
    this._endGesture();
    this._popup.close();
    this._devicePopup.close();
    this._editing = !this._editing;
    this._syncWeatherVisibility();
    this._body.classList.toggle('editing', this._editing);
    if (this._editing) {
      if (!this._view.model && this._floor === 'all') this._setFloor(this._floors[0].id);
      this._edit.enter();
    } else {
      this._edit.exit();
      if (this._floorOnly) { // back to the view the chips show (camera kept)
        this._floorOnly = null;
        this._applyViewVisibility();
        this._applyMarkerStates();
      }
    }
    this._built.rooms = undefined; // model look: outlines and labels only while editing
    this._schedule();
    this._syncToolbar();
    // the panel changes the canvas size: resize once the layout has settled; the camera stays
    requestAnimationFrame(() => this._resize());
  }

  // Apply an edited layout: rebuild the plan and save it.
  _commit(layout) {
    this._suspendAmbient('layout edit');
    if (!this._history.current && this._layout) this.resetHistory();
    this._layout = layout;
    // Observe every saved source change before the coalesced redraw. A held
    // security label must not regain its old authority after replace/recover.
    this._syncSecurity();
    this.finishWallSelectionPreparation(); // Reload around the newly saved exact wall paths.
    if (!this._historyReplaying) this._recordHistory('Layout edit');
    const seq = (this._saveSeq = (this._saveSeq || 0) + 1);
    this._edit?.setSaveState('saving');
    this._store.save(this._hass, layout).then((ok) => {
      if (seq === this._saveSeq) this._edit?.setSaveState(ok ? 'saved' : 'failed');
    });
    this._schedule();
  }

  resetHistory() {
    this._edit?._dashboardBackupEditor?.reset();
    this._markerRenderKey = null;
    this._history.reset(this._layout && this._config ? { layout: this._layout, config: this._config } : null);
    this._edit?.updateHistoryState?.();
  }

  commitFeatureLayout(patch) { this._commit({ ...this._layout, ...patch }); }

  furnitureEditorAvailable() {
    const user = this._hass?.user;
    return this.isConnected === true && this._hass?.connection?.connected === true
      && typeof user?.id === 'string' && !!user.id.trim() && user.is_admin === true
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true)
      && this._editing === true && this._edit?.tab === 'furniture' && !!this._layout && !this._loading;
  }

  furnitureImportAvailable() {
    const editor = this._edit?._furnitureEditor;
    return this.furnitureEditorAvailable() && !!editor && !editor.dirty && !editor.stale;
  }

  _ensureFurnitureCoordinator() {
    if (!this._furnitureCoordinator) this._furnitureCoordinator = new FurnitureCoordinator(this, {
      onChange: () => { if (this._furnitureCoordinator) { this._syncFurniture(); this._schedule(); } },
    });
    return this._furnitureCoordinator;
  }

  get furnitureLibrary() { return this._ensureFurnitureCoordinator(); }
  furnitureCatalogue() { return this._ensureFurnitureCoordinator().catalogueSnapshot(); }
  furnitureRefresh() { return this._ensureFurnitureCoordinator().refresh(); }
  async furnitureExportPack(packId) {
    const coordinator = this._ensureFurnitureCoordinator(), generation = coordinator.generation;
    if (!this.furnitureEditorAvailable()) return false;
    const result = await coordinator.client.archive(packId);
    coordinator.sync();
    if (!result.ok || generation !== coordinator.generation || !this.furnitureEditorAvailable()) return false;
    const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/zip' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `taylors3d-furniture-${packId}.zip`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 250);
    return true;
  }
  furniturePreviewDraft(raw) {
    const coordinator = this._ensureFurnitureCoordinator();
    this._furniturePreviewSource = raw === null ? null : this._furnitureSourceContext();
    const accepted = coordinator.previewDraft(raw);
    if (raw !== null && !accepted) { this._furniturePreviewSource = null; throw new Error('The current furniture draft cannot be previewed.'); }
    this._syncFurniture();
    return accepted;
  }
  furnitureRenderingReport() { return this._furnitureLayer?.report() ?? { valid: true, ready: true, pending: 0, rows: [], diagnostics: [] }; }

  _furnitureSourceContext() {
    let key;
    try { key = JSON.stringify([this._config?.model || this._layout?.model, this._modelAlign(),
      (this._floors || []).map((floor) => [floor.id, floor.elevation, floor.stale, this._view?.floorElevation?.(floor.id)])]); }
    catch { return null; }
    return { view: this._view, root: this._view?.model?.root, layout: this._layout, key };
  }

  _syncFurniture() {
    if (this._syncingFurniture) return;
    // An ordinary card with no furniture never fetches or allocates a layer.
    if (!this._furnitureCoordinator && this._layout?.furniture === undefined && this._edit?.tab !== 'furniture') return;
    this._syncingFurniture = true;
    try {
      const coordinator = this._ensureFurnitureCoordinator(); coordinator.sync();
      const view = this._view, catalogue = coordinator.catalogueSnapshot();
      if (coordinator.preview !== null) {
        const captured = this._furniturePreviewSource, current = this._furnitureSourceContext();
        if (!captured || !current || !['view', 'root', 'layout', 'key'].every((field) => captured[field] === current[field])) {
          this._furniturePreviewSource = null; coordinator.clearPreview();
        }
      }
      const raw = coordinator.preview ?? this._layout?.furniture;
      // Saved references need one lazy read in each current session. Errors wait
      // for the deliberate Refresh button; ordinary HA state updates never retry.
      if (catalogue.status === 'unavailable' && Array.isArray(this._layout?.furniture?.instances)
        && this._layout.furniture.instances.length && coordinator.sync()
        && this._furnitureAttemptGeneration !== coordinator.generation) {
        this._furnitureAttemptGeneration = coordinator.generation;
        coordinator.refresh();
      }
      if (view && !this._furnitureLayer && raw !== undefined) this._furnitureLayer = new FurnitureLayer(view, {
        library: coordinator.client, onInvalidate: () => {
          if (this._view === view) { view.dirty = true; this._schedule(); }
        },
      });
      const floors = (this._floors || []).map((floor) => ({ ...floor, elevation: view?.floorElevation?.(floor.id) ?? floor.elevation }));
      this._furnitureLayer?.setData({ raw, floors, catalogue: catalogue.catalogue,
        enabled: this.isConnected === true && !this._loading && !!this._layout && catalogue.status === 'ready',
        contextKey: coordinator.generation });
      this._edit?._furnitureDrag?.update();
    } finally { this._syncingFurniture = false; }
  }

  _wallSourceKey() {
    return JSON.stringify([this._config?.layout_key, this._config?.model || this._layout?.model?.version || null,
      this._modelAlign()]);
  }

  _wallPreparationModelCurrent(preparation) {
    return !!(preparation && preparation.view === this._view && preparation.source === this._wallSourceKey()
      && preparation.generation === this._wallLifecycleGeneration);
  }

  _wallPreparationFrameCurrent(preparation) {
    return this._wallPreparationModelCurrent(preparation)
      && preparation.connection === this._hass?.connection && preparation.userId === this._hass?.user?.id;
  }

  _wallSessionActive() {
    const user = this._hass?.user;
    return !!(user && typeof user.id === 'string' && user.id.trim()
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true) && this._hass?.connection?.connected === true);
  }

  _wallPreparationCurrent(preparation) {
    return this._wallPreparationFrameCurrent(preparation) && this._wallSessionActive() && this._hass?.user?.is_admin === true;
  }

  _wallSelectionCamera() {
    const view = this._view;
    const position = view?.camera?.position?.toArray(), target = view?.controls?.target?.toArray();
    return position?.length === 3 && target?.length === 3 && [...position, ...target].every(Number.isFinite)
      ? { position, target } : null;
  }

  _restoreWallSelectionCamera(preparation) {
    if (this.isConnected && preparation.camera && this._wallPreparationFrameCurrent(preparation) && this._wallSessionActive()
      && preparation.viewId === this._viewId && preparation.mode === this._mode
      && preparation.interaction === this._wallInteractionSerial) this._view.setCamera(preparation.camera);
  }

  /** Deliberate editor-only read/reload. Configured merging and saved layout stay
   * untouched; exact original mesh paths can then be chosen and retained on Save.
   */
  async prepareWallSelection() {
    const editor = this._edit?._wallPresentationEditor;
    if (!this.isConnected || !this._editing || this._edit?.tab !== 'model'
      || this._hass?.user?.is_admin !== true || !this._wallSessionActive() || !this._layout || !this._view?.model
      || this._loading || this._mode !== '3d' || editor?.dirty || this._edit?._modelRenderingEditor?.dirty
      || this._edit?._floorPresentationEditor?.dirty || editor?.pendingSurfacePick) {
      throw ownedRuntimeError('wallSession');
    }
    const current = this._view.wallPresentationCandidates?.();
    if (current?.prepared) return { prepared: true, report: current };
    if (this._wallPreparation) throw ownedRuntimeError('wallPending');
    this._suspendAmbient('wall selection preparation');
    this._stopScenePreview('wall selection preparation');
    this._view.stopCameraMotion();
    const preparation = { view: this._view, source: this._wallSourceKey(),
      generation: this._wallLifecycleGeneration,
      connection: this._hass.connection, userId: this._hass.user.id,
      camera: this._wallSelectionCamera(), viewId: this._viewId, mode: this._mode,
      interaction: this._wallInteractionSerial };
    this._wallPreparation = preparation;
    this._wallRestoreMergePending = false;
    try {
      const error = await this._loadModel(true);
      if (this._wallPreparation !== preparation || !this._wallPreparationCurrent(preparation)
        || !this.isConnected || !this._editing || this._edit?.tab !== 'model'
        || this._hass?.user?.is_admin !== true || this._hass?.connection?.connected !== true) {
        throw ownedRuntimeError('wallChanged');
      }
      const report = this._view.wallPresentationCandidates?.();
      if (error || !report?.prepared) throw error ? this._modelErrorNotice || new Error(error) : ownedRuntimeError('wallUnavailable');
      this._restoreWallSelectionCamera(preparation);
      return { prepared: true, report };
    } catch (error) {
      if (this._wallPreparation === preparation) this.finishWallSelectionPreparation();
      throw error;
    }
  }

  finishWallSelectionPreparation({ reload = true } = {}) {
    const preparation = this._wallPreparation;
    if (!preparation) return false;
    this._wallPreparation = null;
    // Cleanup belongs to this model, even if the authenticated identity vanished.
    // Camera restoration and accepting a pick still require the exact session.
    const current = this._wallPreparationModelCurrent(preparation);
    this._wallRestoreMergePending = !!(current && this._config?.merge !== false);
    if (!reload || !current || !this.isConnected || !this._view || !this._wallSessionActive()) return true;
    const restoration = { ...preparation, camera: this._wallSelectionCamera(), viewId: this._viewId,
      mode: this._mode, interaction: this._wallInteractionSerial };
    this._loadModel().then(() => this._restoreWallSelectionCamera(restoration)).catch((error) => {
      if (!this._wallPreparationFrameCurrent(restoration) || !this._wallSessionActive()) return;
      this._modelError = String(error?.message || error);
      this._modelErrorNotice = ownedRuntimeDetails(error) ? error : null;
      this._showNotice();
    });
    return true;
  }

  // Coverage uses actual placed cameras. Bound model anchors take precedence over a
  // grouped device marker; a duplicate model binding remains an explicit choice.
  cameraAnchors() {
    if (!this._hass || !this._view) return [];
    const anchors = [], modelEntities = new Set();
    for (const anchor of this._objects?.anchors() || []) {
      const object = this._objects.objectAt(anchor.id);
      if (!object) continue;
      const entity = object.binding?.entity || actionTarget(object.obj, object.binding, this._groups, this._hass.states);
      if (typeof entity !== 'string' || !entity.startsWith('camera.')) continue;
      // A hidden model binding still owns its physical placement; never relocate its
      // saved entity-wide cone onto a surviving grouped-device marker.
      modelEntities.add(entity);
      const metadata = entityMetadata(this._hass, entity);
      if (!metadata.hasState || metadata.hidden || metadata.disabled) continue;
      if (this._mb?.levels?.[object.obj.level]?.stale) continue;
      const floorId = this._sourceObjectFloor(object, anchor.world);
      if (!floorId) continue;
      const elevation = this._view.floorElevation(floorId);
      const displayWorld = this._displayFeatureWorld(anchor.world, floorId);
      const shown = !object.binding?.hidden && nodeShown(object.obj.node) && !!displayWorld && !this._view._cutAway?.(displayWorld);
      anchors.push({ id: `object:${anchor.id}`, entity, label: object.obj.label || metadata.name,
        position: { x: anchor.world.x, y: -anchor.world.z, z: anchor.world.y - elevation, elevation, floorId }, shown });
    }
    for (const marker of this._markers || []) {
      const position = this._positions?.get(marker.id);
      if (!position) continue;
      const shown = this._view._markerStates?.get(marker.id)?.shown !== false
        && this._view.markerObjects?.get(marker.id)?.obj?.visible !== false;
      const entities = new Set([marker.entityId, ...(marker.entities || []).map((candidate) => candidate.eid || candidate)]);
      for (const entity of entities) {
        if (typeof entity !== 'string' || !entity.startsWith('camera.') || modelEntities.has(entity)) continue;
        const metadata = entityMetadata(this._hass, entity);
        if (!metadata.hasState || metadata.hidden || metadata.disabled) continue;
        anchors.push({ id: `${marker.id}:${entity}`, entity, label: metadata.name,
          position: { ...position, elevation: this._view.floorElevation(position.floorId) }, shown });
      }
    }
    return anchors;
  }

  previewCameraCoverage(bindings = null) {
    this._cameraCoveragePreview = bindings;
    this._syncCameraCoverage();
  }

  _syncCameraCoverage() {
    if (!this._cameraCoverage || !this._layout || !this._hass) return;
    this._cameraCoverage.setData({ anchors: displayCameraAnchors(this.cameraAnchors(), this._floorPresentationReportValue, this._floors || []),
      bindings: this._cameraCoveragePreview ?? this._layout.camera_coverage ?? this._config.camera_coverage ?? NONE,
      visibleFloors: this._navigationFloors() });
    this._cameraCoverage.setVisible(!this._editing || this._edit?.tab === 'cameras');
  }

  // Only original GLB/registry placements are anchors. Tracking symbols never
  // become inputs to other tracking symbols, and IDs match the saved picker keys.
  trackingAnchors() {
    if (!this._view) return [];
    const anchors = [], floors = this._floors || [];
    const validFloor = (id) => floors.some((floor) => floor.id === id);
    for (const anchor of this._objects?.anchors() || []) {
      const object = this._objects.objectAt(anchor.id);
      if (!object || object.binding?.hidden || this._mb?.levels?.[object.obj.level]?.stale) continue;
      const entity = object.binding?.entity;
      const metadata = entity ? entityMetadata(this._hass, entity) : null;
      if (metadata?.hidden || metadata?.disabled) continue;
      const floorId = this._sourceObjectFloor(object, anchor.world);
      if (!validFloor(floorId)) continue;
      const elevation = this._view.floorElevation(floorId);
      const displayWorld = this._displayFeatureWorld(anchor.world, floorId);
      const shown = nodeShown(object.obj.node) && !!displayWorld && !this._view._cutAway?.(displayWorld);
      anchors.push({ id: `object:${anchor.id}`, label: object.obj.label || metadata?.name || anchor.id,
        position: { x: anchor.world.x, y: -anchor.world.z, z: anchor.world.y - elevation, floorId, elevation, shown }, shown });
    }
    for (const marker of this._markers || []) {
      const position = this._positions?.get(marker.id);
      if (!position || !validFloor(position.floorId) || this._layout?.hidden?.includes(marker.id)) continue;
      const metadata = entityMetadata(this._hass, marker.entityId);
      if (metadata.hidden || metadata.disabled) continue;
      const elevation = this._view.floorElevation(position.floorId);
      const displayWorld = this._displayFeatureWorld({ x: position.x, y: elevation + (position.z ?? 0), z: -position.y }, position.floorId);
      const shown = !!displayWorld && this._view._markerStates?.get(marker.id)?.shown !== false
        && this._view.markerObjects?.get(marker.id)?.obj?.visible !== false
        && !this._view._cutAway?.(displayWorld);
      anchors.push({ id: marker.id, label: marker.name || metadata.name,
        position: { ...position, elevation, shown }, shown });
    }
    return anchors;
  }

  // Weather uses the same plan-metre outlines and floor elevations as the card.
  // Indoor masks include hidden rooms: hiding a room must not put rain inside it.
  weatherFootprints() {
    const indoors = [], outdoors = [], floors = this._floors || [];
    const visibleRooms = new Set(this._navigationRooms().map((entry) => entry.room.id));
    const visibleFloors = this._navigationFloors();
    const elevation = (id) => floors.filter((floor) => floor.id === id).length === 1
      ? this._view?.floorElevation(id) : null;
    const modelIds = new Set();
    for (const entry of this._roomList || []) {
      const room = entry.room;
      if (room.modelId) modelIds.add(room.modelId);
      // Preserve a broken explicit floor link instead of silently borrowing the first floor.
      const floorId = room.floor_id ?? entry.floorId;
      const footprint = { id: room.id, floorId, elevation: elevation(floorId), polygon: room.polygon,
        outdoor: room.outdoor === true, shown: entry.shown !== false && visibleRooms.has(room.id) };
      (footprint.outdoor ? outdoors : indoors).push(footprint);
    }
    // modelRooms omits hidden or stale level links for placement. Their indoor
    // outlines still protect the house; a stale/unknown link fails the mask closed.
    for (const room of this._mb?.manifest?.rooms || []) {
      if (room.kind !== 'room' || modelIds.has(room.id)) continue;
      const assignment = this._mb.levels?.[room.level];
      const floorId = assignment && !assignment.stale ? assignment.floor : null;
      const polygon = Array.isArray(room.outline)
        ? room.outline.map((point) => Array.isArray(point) ? transformPoint(point, this._modelAlign()) : point) : null;
      indoors.push({ id: `m:${room.id}`, floorId, elevation: elevation(floorId), polygon, outdoor: false });
    }
    return { outdoors, indoors, visibleFloors: visibleFloors === 'all' ? undefined : visibleFloors };
  }

  weatherDiagnostics() {
    return { weather: this._weatherReading, diagnostics: this._weatherLayer?.diagnostics || [],
      sun: readSunState(this._hass), location: readHaLocation(this._hass) };
  }

  _ensureWeatherLayer() {
    const view = this._view;
    if (!view?.scene || this._weatherScene === view.scene && this._weatherView === view) return;
    this._weatherLayer?.dispose();
    this._weatherScene = view.scene;
    this._weatherView = view;
    this._weatherRefs = null;
    this._weatherLayer = new WeatherLayer(view.scene, {
      onInvalidate: () => { if (this._view === view) view.dirty = true; },
    });
    if (this.isConnected) this._watchWeatherVisibility();
  }

  _watchWeatherVisibility() {
    if (!this._scene || !this._view || !this.isConnected) return;
    if (this._weatherObserver && this._weatherObservedScene === this._scene && this._weatherObservedView === this._view) return;
    this._weatherObserver?.disconnect();
    this._weatherObserver = null;
    this._weatherInView = typeof IntersectionObserver !== 'function';
    this._weatherObservedScene = this._scene;
    this._weatherObservedView = this._view;
    if (typeof IntersectionObserver === 'function') {
      const view = this._view, target = this._scene;
      const observer = new IntersectionObserver((entries) => {
        if (this._weatherObserver !== observer || this._view !== view || !this.isConnected) return;
        const entry = entries.find((candidate) => candidate.target === target);
        if (!entry) return;
        this._weatherInView = entry.isIntersecting === true;
        this._syncAmbient();
        this._syncWeatherVisibility();
      });
      this._weatherObserver = observer;
      observer.observe(target);
    }
    this._syncWeatherVisibility();
  }

  _syncWeatherVisibility() {
    this._syncWallPresentation();
    this._syncSecurity();
    if (!this.isConnected || document.hidden || this._weatherInView === false || this._loading) this._stopScenePreview('view unavailable');
    this._scenePreviewBar?.update();
    this._weatherLayer?.setVisible(!!(this.isConnected && !document.hidden && this._weatherInView !== false
      && !this._loading && this._layout && !this._editing && !this._section && !this._view?.sectionClip));
  }

  _syncWeather() {
    this._ensureWeatherLayer();
    this._syncWeatherVisibility(); // Hidden updates cannot request animation or a replacement scene frame.
    if (!this._weatherLayer || !this._hass || !this._layout || !this._config || !this._roomList || this._loading) return;
    const config = this._layout.weather ?? this._config.weather ?? NONE;
    const metadata = entityMetadata(this._hass, config?.entity);
    const refs = [config, metadata.state, metadata.hidden, metadata.disabled, metadata.category,
      this._roomList, this._floors, this._viewState, this._floorOnly, this._floor, this._section, this._mode, this._mb,
      this._layout.model, this._config.model_position, this._config.model_rotation, this._config.model_scale, this._floorPresentationRevision,
      !!this._reducedMotion?.matches];
    if (this._weatherRefs && this._weatherRefs.every((value, index) => value === refs[index])) return;
    this._weatherRefs = refs;
    this._weatherReading = readWeather(this._hass, config);
    const footprints = this.weatherFootprints();
    if (this._floorPresentationReportValue?.valid && this._floorPresentationReportValue.mode !== 'assembled') {
      footprints.outdoors = footprints.outdoors.map((footprint) => displayFloorFootprint(footprint, this._floorPresentationReportValue, this._floors)).filter(Boolean);
      // Missing indoor ownership must fail the weather mask closed.
      footprints.indoors = footprints.indoors.map((footprint) => displayFloorFootprint(footprint, this._floorPresentationReportValue, this._floors) ?? { ...footprint, polygon: null });
    }
    this._weatherLayer.setData({ weather: this._weatherReading, ...footprints,
      reducedMotion: !!this._reducedMotion?.matches });
  }

  _animateFeatures(now) {
    const options = { reducedMotion: !!this._reducedMotion?.matches };
    const alerts = this._statusOverlays?.update(now, options) || false;
    const tracking = this._trackingLayer?.update(now, options) || false;
    const weather = this._weatherLayer?.update(now, options) || false;
    const security = this._securityLayer?.update(now, options) || false;
    if (this._refreshSecurityMotion()) this._syncMiniMap();
    const ambient = this._ambientController.tick(now).cameraChanged;
    return alerts || tracking || weather || security || ambient; // Evaluate every animation before combining render requests.
  }

  securityBindings() { return this._layout?.security_bindings ?? this._config?.security_bindings ?? []; }

  _securitySessionActive() {
    const user = this._hass?.user;
    return this.isConnected === true && this._hass?.connection?.connected === true
      && typeof user?.id === 'string' && !!user.id.trim()
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true);
  }

  securityEditorAvailable() {
    return this._securitySessionActive() && this._hass.user.is_admin === true && !this._loading
      && !!this._layout && this._editing === true && this._edit?.tab === 'security';
  }

  _observeSecuritySession() {
    const scope = [this._hass?.connection, this._hass?.auth, this._hass?.user?.id, this._hass?.user?.is_admin,
      this._hass?.user?.is_active, this._hass?.connection?.connected, this.isConnected,
      // Map nodes need a new identity when the deliberately chosen source/target
      // or its layout/model/view context changes. A held old node must not open
      // a replacement source under the same binding ID. Current readings alone
      // keep the identity and keyboard focus stable.
      JSON.stringify(this.securityBindings()), this._config?.layout_key, this._view?.model?.root?.uuid,
      this._editing, this._mode, this._viewId, this._floorOnly, this._floorPresentationRevision, this._loading];
    if (!this._securitySessionScope || scope.some((value, index) => value !== this._securitySessionScope[index])) {
      this._securitySessionScope = scope; this._securitySessionGeneration++;
      this._securityInputKey = null;
      if (this._securityPopup) this._devicePopup?.close({ restoreFocus: false });
      this._securityPopup = null;
    }
  }

  _securityContextKey() {
    return JSON.stringify([this._securitySessionGeneration, this._config?.layout_key, this._view?.model?.root?.uuid,
      this._view?.mode || this._mode, this._floor, this._floorOnly, this._viewState?.id, this._editing,
      this._floorPresentationRevision, this._loading]);
  }

  securityPlanPositions() {
    const positions = new Map();
    for (const anchor of this.trackingAnchors()) positions.set(anchor.id, positions.has(anchor.id) ? null : anchor.position);
    return positions;
  }

  _syncPlanSecurity(bindings, now, planes) {
    if (Array.isArray(bindings) && !bindings.some((binding) => binding?.target !== undefined)) {
      this._securityPlanData = { records: [], diagnostics: [], miniMap: [], nextExpiry: null };
      this._planSecurityLayer?.setData({ records: [], selectable: false, contextKey: this._securityContextKey() });
      if (this._securityPopup) this._devicePopup?.close({ restoreFocus: false }); this._securityPopup = null;
      return;
    }
    const view = this._view, visibleRooms = new Set(this._navigationRooms().map((entry) => entry.room.id));
    const rooms = (this._roomList || []).map((entry) => ({ ...entry, shown: visibleRooms.has(entry.room.id) }));
    const floors = (this._floors || []).map((floor) => ({ ...floor, elevation: view.floorElevation?.(floor.id) ?? floor.elevation }));
    this._securityPlanData = buildPlanSecurity({ hass: this._hass, bindings, rooms, floors, positions: this.securityPlanPositions(),
      visibleFloors: this._navigationFloors(), now });
    if (this._securityPlanScene !== view.scene) {
      this._planSecurityLayer?.dispose(); this._planSecurityLayer = null; this._securityPlanScene = view.scene;
    }
    if (!this._planSecurityLayer && this._securityPlanData.records.length && view.scene?.isObject3D) this._planSecurityLayer = new PlanSecurityLayer(view.scene, {
      onInvalidate: () => { if (this._view === view) view.dirty = true; },
      onSelect: (id) => this._showPlanSecurityEntity(id), returnFocus: () => this._stage?.focus(),
    });
    const visible = !!(this._securitySessionActive() && !document.hidden && this._weatherInView !== false && !this._loading && !this._editing);
    this._planSecurityLayer?.setVisible(visible);
    this._planSecurityLayer?.setData({ records: displayLocatedRecords(this._securityPlanData.records, this._floorPresentationReportValue, this._floors || []),
      selectable: visible, contextKey: this._securityContextKey() });
    this._planSecurityLayer?.setClippingPlanes(planes);
    if (this._securityPopup && !this._currentPlanSecurityRecord(this._securityPopup.id, this._securityPopup)) {
      this._devicePopup?.close({ restoreFocus: false }); this._securityPopup = null;
    }
  }

  _currentPlanSecurityRecord(id, expected = {}) {
    const record = this._securityPlanData.records.find((record) => record.id === id);
    if (!this._securitySessionActive() || this._editing || this._loading || document.hidden || !record?.shown || !record.location
      || !this._planSecurityLayer?.group.visible || !this._planSecurityLayer.parts.has(id) || expected.entity && expected.entity !== record.entity
      || expected.generation !== undefined && expected.generation !== this._securitySessionGeneration) return null;
    const point = this._planSecurityLayer.parts.get(id).group.position;
    if ([this._view.modelClip, this._view.sectionClip].some((plane) => plane?.isPlane && plane.distanceToPoint(point) < 0)) return null;
    const metadata = entityMetadata(this._hass, record.entity);
    return metadata.hasState && !metadata.hidden && !metadata.disabled && !metadata.category ? record : null;
  }

  _showPlanSecurityEntity(id, expected) {
    this._syncSecurity(); const record = this._currentPlanSecurityRecord(id, expected);
    if (!record || !this._devicePopup) return false;
    this._popup?.close(); this._devicePopup.update(this._hass);
    this._securityPopup = { id, entity: record.entity, generation: this._securitySessionGeneration };
    this._devicePopup.showMarker({ id: `security:${id}`, entityId: record.entity, name: record.name, entities: [{ eid: record.entity }] },
      this._view.screenPoint(record.location.x, record.location.y, record.location.z, record.location.floorId));
    return true;
  }

  securityMotionWriters() {
    return new Set([...(this._objects?.parts?.values() || [])].filter((part) => typeof part.type?.place === 'function')
      .map((part) => part.obj?.node).filter((node) => node?.isObject3D));
  }

  _resetSecurity() {
    this._securityLayer?.setModel(null);
    this._refreshSecurityMotion();
    this._securityModel = null; this._securityInputKey = null;
    this._planSecurityLayer?.setData({ records: [], selectable: false, contextKey: this._securityContextKey() });
    this._securityPlanData = { records: [], diagnostics: [], miniMap: [], nextExpiry: null };
    if (this._securityPopup) this._devicePopup?.close({ restoreFocus: false }); this._securityPopup = null;
  }

  _refreshSecurityMotion() {
    const layer = this._securityLayer, view = this._view;
    if (!layer || !view?.modelMotionChanged) return false;
    const { changedMotionTargets } = layer.takeMotionChanges();
    if (!changedMotionTargets.size && !layer.moving && !this._securityMoving) return false;
    const result = view.modelMotionChanged(changedMotionTargets, { moving: layer.moving });
    this._securityMoving = layer.moving;
    if (result.changed) {
      this._refreshAttached();
      this._syncCameraCoverage();
      this._syncTracking(true);
    }
    return result.changed;
  }

  _syncSecurity(force = false) {
    const view = this._view;
    this._observeSecuritySession();
    if (!view || !this._layout || !this._hass || !this._config || !this._securitySessionActive()) {
      this._securityLayer?.setData({ bindings: [] }); this._securityLayer?.setVisible(false);
      this._planSecurityLayer?.setVisible(false); this._planSecurityLayer?.setData({ records: [], selectable: false, contextKey: this._securityContextKey() });
      this._securityPlanData = { records: [], diagnostics: [], miniMap: [], nextExpiry: null };
      this._refreshSecurityMotion(); return false;
    }
    if (!this._securityLayer) this._securityLayer = new SecurityLayer({ onInvalidate: () => { if (this._view === view) view.dirty = true; } });
    const layer = this._securityLayer;
    view.securityLayer = layer; // The view releases helpers and restores poses before authored model resources.
    layer.setVisible(!!(!document.hidden && this._weatherInView !== false && !this._loading && !this._editing));
    const writers = this.securityMotionWriters(), writerKey = [...writers].map((node) => node.uuid).sort().join('|');
    if (writerKey !== this._securityWriterKey || this._securityModel !== view.model) {
      this._securityWriterKey = writerKey; this._securityWriters = writers;
      this._securityInputKey = null;
    }
    layer.setModel(view.model, { motionWriters: this._securityWriters });
    this._securityModel = view.model;
    const planes = [view.modelClip, view.sectionClip].filter((plane) => plane?.isPlane);
    layer.setClippingPlanes(planes);
    const shownObjectIds = new Set((view.model?.manifest?.objects || []).filter((object) => {
      const saved = this._layout.objects?.[object.id], bound = this._objects?.objectAt(object.id);
      return nodeShown(object.node) && !saved?.hidden && !bound?.binding?.hidden && !this._mb?.levels?.[object.level]?.stale;
    }).map((object) => object.id));
    const bindings = this.securityBindings();
    const evidence = (Array.isArray(bindings) ? bindings : []).map((binding) => {
      const metadata = entityMetadata(this._hass, binding?.entity);
      return [binding?.entity, metadata.state, metadata.deviceClass, metadata.hidden, metadata.disabled, metadata.category];
    });
    const now = this._now(), key = JSON.stringify([bindings, evidence, [...shownObjectIds].sort(), writerKey,
      !!this._reducedMotion?.matches, this._loading, !!this._editing, this.isConnected, document.hidden,
      planes.map((plane) => [...plane.normal.toArray(), plane.constant])]);
    if (force || key !== this._securityInputKey || layer.nextExpiry !== null && layer.nextExpiry <= now) {
      this._securityInputKey = key;
      layer.setData({ hass: this._hass, bindings, shownObjectIds, now, animationNow: performance.now(), reducedMotion: !!this._reducedMotion?.matches });
    }
    this._syncPlanSecurity(bindings, now, planes);
    const changed = this._refreshSecurityMotion();
    this._setTrackingTimer(this._trackingData.nextExpiry);
    return changed;
  }

  _clearTrackingTimer() {
    clearTimeout(this._trackingTimer);
    this._trackingTimer = null;
    this._trackingDeadline = null;
    this._trackingGeneration++;
  }

  _resetTracking() {
    this._clearTrackingTimer();
    this._trackingInputKey = null;
    this._trackingSourceKeys = new Map();
    this._trackingMemory = { presence: {}, vehicles: {}, vacuums: {} };
    this._trackingData = { records: [], diagnostics: [], miniMap: [], nextExpiry: null };
    this._trackingLayer?.setData({ records: [] });
  }

  _setTrackingTimer(deadline) {
    const deadlines = [deadline, this._securityLayer?.nextExpiry, this._securityPlanData?.nextExpiry].filter(Number.isFinite);
    deadline = deadlines.length ? Math.min(...deadlines) : null;
    if (!this.isConnected || document.hidden || !Number.isFinite(deadline) || deadline <= this._now()) {
      if (this._trackingTimer !== null) this._clearTrackingTimer();
      return;
    }
    if (this._trackingTimer !== null && this._trackingDeadline === deadline) return;
    this._clearTrackingTimer();
    const generation = this._trackingGeneration;
    this._trackingDeadline = deadline;
    this._trackingTimer = setTimeout(() => {
      if (generation !== this._trackingGeneration || !this.isConnected) return;
      this._trackingTimer = null;
      this._trackingDeadline = null;
      this._syncSecurity(true);
      this._syncTracking(true);
      this._syncMiniMap();
    }, Math.min(2147483647, Math.max(1, deadline - this._now())));
  }

  _syncTracking(force = false) {
    if (!this._trackingLayer || !this._layout || !this._hass || !this._view || this._loading) return;
    const fields = ['presence_bindings', 'vehicle_bindings', 'vacuum_bindings'];
    const config = Object.fromEntries(fields.map((key) => [key, this._layout[key] ?? this._config?.[key] ?? []]));
    const visibleRooms = new Set(this._navigationRooms().map((entry) => entry.room.id));
    const rooms = (this._roomList || []).map((entry) => ({ ...entry, shown: visibleRooms.has(entry.room.id) && entry.shown !== false }));
    const floors = (this._floors || []).map((floor) => ({ ...floor, elevation: this._view.floorElevation(floor.id) }));
    const positions = new Map();
    for (const anchor of this.trackingAnchors()) positions.set(anchor.id, positions.has(anchor.id) ? null : anchor.position);
    const visibleFloors = this._navigationFloors();
    const entities = new Set();
    for (const bindings of Object.values(config)) for (const binding of Array.isArray(bindings) ? bindings : []) {
      for (const entity of [binding?.entity, binding?.identity_entity, binding?.room_source?.entity, binding?.position_source?.entity]) {
        if (typeof entity === 'string') entities.add(entity);
      }
    }
    const observations = [...entities].sort().map((entity) => {
      const metadata = entityMetadata(this._hass, entity);
      return [entity, metadata.state, metadata.name, metadata.deviceClass, metadata.hidden, metadata.disabled, metadata.category, metadata.registered];
    });
    const clip = this._view.sectionClip;
    const inputKey = JSON.stringify([config, observations, rooms, floors, [...positions], visibleFloors,
      clip && [clip.normal.x, clip.normal.y, clip.normal.z, clip.constant]]);
    const now = this._now();
    if (force || inputKey !== this._trackingInputKey || this._trackingData.nextExpiry !== null && this._trackingData.nextExpiry <= now) {
      // Event memory follows the exact source, not its label, placement or TTL. A
      // repeated observation cannot be extended by changing the display settings.
      const sourceKeys = new Map(), memory = {};
      for (const binding of Array.isArray(config.vehicle_bindings) ? config.vehicle_bindings : []) {
        if (!binding || typeof binding.id !== 'string') continue;
        const key = JSON.stringify([binding.entity, binding.kind, binding.timestamp_mode, binding.timestamp_attr,
          binding.timestamp_format, binding.event_types, binding.event_type_attr, binding.event_id_attr]);
        sourceKeys.set(binding.id, key);
        if (this._trackingSourceKeys.get(binding.id) === key) memory[binding.id] = this._trackingMemory.vehicles[binding.id];
      }
      this._trackingSourceKeys = sourceKeys;
      const data = buildTrackedEntities({ hass: this._hass, rooms, floors, positions, visibleFloors, now,
        memory: { ...this._trackingMemory, vehicles: memory }, ...config });
      for (const record of data.records) if (record.shown && record.location) {
        const p = record.location;
        const displayWorld = this._displayFeatureWorld({ x: p.x, y: p.elevation + p.z, z: -p.y }, p.floorId);
        if (!displayWorld || this._view._cutAway?.(displayWorld)) record.shown = false;
      }
      const byId = new Map(data.records.map((record) => [record.id, record]));
      data.miniMap = data.miniMap.filter((marker) => byId.get(marker.id)?.shown).map((marker) => {
        const record = byId.get(marker.id);
        return { ...marker, color: record.color, kind: record.kind, positionStatus: record.positionStatus };
      });
      this._trackingMemory = { ...data.memory, vehicles: { ...memory, ...data.memory.vehicles } };
      this._trackingData = data;
      this._trackingInputKey = inputKey;
    }
    const snap = this._trackingPresentationRevision !== this._floorPresentationRevision;
    this._trackingPresentationRevision = this._floorPresentationRevision;
    this._trackingLayer.setData({ records: displayLocatedRecords(this._trackingData.records, this._floorPresentationReportValue, this._floors || []), now: performance.now(),
      reducedMotion: !!this._reducedMotion?.matches || snap, selectable: !this._editing });
    this._trackingLayer.setVisible(this.isConnected && (!this._editing || this._edit?.tab === 'tracking'));
    this._setTrackingTimer(this._trackingData.nextExpiry);
  }

  _showTrackedEntity(id) {
    const record = this._trackingData.records.find((candidate) => candidate.id === id);
    if (this._editing || !record?.shown || !record.location || !this._devicePopup || !this._hass) return false;
    const entity = record.kind === 'presence' && record.identity ? record.identity : record.entity;
    const metadata = entityMetadata(this._hass, entity);
    if (!metadata.hasState || metadata.hidden || metadata.disabled || metadata.category) return false;
    const entities = [...new Set([entity, record.entity])].filter((eid) => {
      const item = entityMetadata(this._hass, eid);
      return item.hasState && !item.hidden && !item.disabled && !item.category;
    }).map((eid) => ({ eid }));
    this._popup?.close();
    this._devicePopup.update(this._hass);
    const p = record.location;
    this._devicePopup.showMarker({ id, entityId: entity, name: record.label, entities },
      this._view.screenPoint(p.x, p.y, p.z, p.floorId));
    return true;
  }

  setPanelName(value) {
    const name = String(value || '').trim();
    if (name.length > 128) throw ownedRuntimeError('panelLength');
    try {
      if (name) localStorage.setItem('taylors3d.panel', name);
      else localStorage.removeItem('taylors3d.panel');
    } catch { throw ownedRuntimeError('panelStorage'); }
    this._panelName = name;
    this._presetError = null;
    this._showNotice();
    if (this.isConnected) this._presetEvents.setHass(this._hass);
    window.dispatchEvent(new Event('taylors3d-panel-change'));
  }

  acknowledgeAlert(id) {
    this._acknowledgedAlerts = new Set([id]);
    this._statusRefs = null;
    this._syncStatus();
    this._syncAmbient();
  }

  _showNotice() {
    if (!this._notice) return;
    const caption = [this._modelErrorNotice || this._modelError, this._presetError].filter(Boolean)
      .map((notice) => runtimeNoticeText(this._hass, notice)).join(' · ');
    if (this._notice.textContent !== caption) this._notice.textContent = caption;
    this._notice.hidden = !caption;
  }

  _syncStatus() {
    if (!this._statusOverlays || !this._hass || !this._layout || !this._roomList) return;
    this._observeAlertMapContext();
    const layout = this._layout;
    const config = layout.room_overlays ?? this._config.room_overlays ?? NONE;
    const bindings = layout.alert_bindings ?? this._config.alert_bindings ?? null;
    // HA normally replaces states, but also observe current alert readings when
    // a retained object changes. This never changes a focused marker's identity.
    const readings = JSON.stringify((Array.isArray(bindings) ? bindings : []).map((binding) => {
      const state = this._hass.states?.[binding?.entity];
      return [binding?.entity, state?.state, state?.attributes?.restored, state?.attributes?.friendly_name];
    }));
    const refs = [config, bindings, this._hass.states, this._hass.entities, this._roomList, this._floors,
      this._positions, this._viewState, this._floorOnly, this._section, this._editing, layout.model, this._floorPresentationRevision,
      this._alertMapGeneration, this._alertMapLocationKey, readings, localeKey(this._hass)];
    if (this._statusRefs && refs.every((value, i) => value === this._statusRefs[i])) return;
    this._statusRefs = refs;
    const floors = this._floors.map((floor) => ({ ...floor, elevation: this._view.floorElevation(floor.id) }));
    const rooms = this._navigationRooms();
    const visibleFloors = this._navigationFloors();
    const positions = new Map();
    for (const marker of this._markers) {
      const position = this._positions?.get(marker.id);
      if (!position) continue;
      for (const entity of [marker.entityId, ...(marker.entities || []).map((candidate) => candidate.eid || candidate)]) {
        if (typeof entity === 'string') positions.set(entity, position);
      }
    }
    for (const anchor of this._objects ? this._objects.anchors() : []) {
      const object = this._objects.objectAt(anchor.id);
      if (!object || object.binding?.hidden || !nodeShown(object.obj.node)) continue;
      const entity = actionTarget(object.obj, object.binding, this._groups, this._hass.states);
      const floorId = this._sourceObjectFloor(object, anchor.world);
      if (entity && floorId) positions.set(entity, { x: anchor.world.x, y: -anchor.world.z,
        z: anchor.world.y - this._view.floorElevation(floorId), floorId });
    }
    // Explicit alert markers use the same exact SOURCE IDs as the editor.
    // Never choose a survivor when two current anchors claim the same ID.
    const anchorIds = new Set();
    for (const anchor of this.trackingAnchors()) {
      if (typeof anchor?.id !== 'string' || !anchor.id.trim()) continue;
      positions.set(anchor.id, anchorIds.has(anchor.id) ? null : { ...anchor.position, shown: anchor.shown !== false && anchor.position?.shown !== false });
      anchorIds.add(anchor.id);
    }
    this._roomOverlayData = buildRoomOverlays({ rooms, floors, states: this._hass.states,
      entities: this._hass.entities, visibleFloors, config, hass: this._hass });
    this._alertData = buildAlerts({ rooms, floors, states: this._hass.states, positions, visibleFloors, bindings,
      previousLatches: this._alertLatches || {}, acknowledged: this._acknowledgedAlerts || [], hass: this._hass });
    this._acknowledgedAlerts = null;
    this._alertLatches = this._alertData.nextLatches;
    const overlayRooms = this._floorPresentationReportValue?.valid && this._floorPresentationReportValue.mode !== 'assembled'
      ? this._roomOverlayData.rooms.map((room) => displayFloorFootprint(room, this._floorPresentationReportValue, this._floors)).filter(Boolean)
      : this._roomOverlayData.rooms;
    this._statusOverlays.setData({ rooms: overlayRooms,
      alerts: displayLocatedRecords(this._alertData.alerts, this._floorPresentationReportValue, this._floors || []) });
    if (this._statusOverlays.group.visible === this._editing) {
      this._statusOverlays.group.visible = !this._editing;
      this._view.dirty = true;
    }
    const legend = this._roomOverlayData.legend;
    this._statusLegend.hidden = this._editing || !legend;
    if (legend) {
      this._statusLegend.querySelector('strong').textContent = legend.title;
      const stats = this._roomOverlayData.stats;
      this._statusLegend.querySelector('span').textContent = legend.label + (stats.totalReason ? ' ' + stats.totalReason : '');
      const scale = this._statusLegend.querySelector('.scale');
      scale.style.background = legend.stops.length ? `linear-gradient(to right, ${legend.stops.map((stop) => stop.color).join(',')})` : '';
      scale.hidden = !legend.stops.length;
    }
  }

  _observeAlertMapContext() {
    const bindings = this._layout?.alert_bindings ?? this._config?.alert_bindings ?? [];
    const sources = (Array.isArray(bindings) ? bindings : []).map((binding) => {
      const metadata = entityMetadata(this._hass, binding?.entity);
      return [binding?.entity, metadata.hasState, metadata.hidden, metadata.disabled, metadata.category];
    });
    const markerKeys = new Set((Array.isArray(bindings) ? bindings : []).filter((binding) => binding?.location_mode === 'marker')
      .flatMap((binding) => [binding.position_key, binding.markerId]).filter((id) => typeof id === 'string' && id));
    const anchors = markerKeys.size ? this.trackingAnchors().filter((anchor) => markerKeys.has(anchor?.id)) : [];
    this._alertMapLocationKey = JSON.stringify(anchors.map((anchor) => [anchor.id, anchor.position, anchor.shown]));
    const anchorEligibility = anchors.map((anchor) => {
      const point = anchor.position;
      return [anchor.id, point?.floorId, point?.floor_id, anchor.shown, point?.shown, point?.visible,
        !!point && [point.x, point.y, point.z ?? .12].every(Number.isFinite)
          && Math.abs(point.x) <= 1e6 && Math.abs(point.y) <= 1e6 && Math.abs(point.z ?? .12) <= 1000];
    });
    const scope = [this._hass?.connection, this._hass?.auth, this._hass?.user?.id, this._hass?.user?.is_admin,
      this._hass?.user?.is_active, this._hass?.connection?.connected, this.isConnected,
      JSON.stringify(this._hass?.user?.permissions), JSON.stringify(bindings), JSON.stringify(sources), JSON.stringify(anchorEligibility),
      JSON.stringify((this._floors || []).map((floor) => [floor?.id, floor?.elevation, floor?.stale, floor?.shown])),
      JSON.stringify((this._roomList || []).map((entry) => {
        const room = entry?.room || entry;
        return [room?.id, entry?.floorId, room?.floor_id, room?.floorId, room?.polygon || room?.outline,
          entry?.shown, room?.shown, room?.hidden];
      })), this._config?.layout_key, this._view?.model?.root?.uuid, this._editing, this._mode, this._viewId,
      this._floorOnly, this._section, this._floorPresentationRevision, this._loading, document.hidden, this._weatherInView];
    if (!this._alertMapScope || scope.some((value, index) => value !== this._alertMapScope[index])) {
      // Observe losses before the scheduled map update; recovery must not revive
      // an old held pointer/keyboard intent under a reused binding ID.
      this._alertMapScope = scope;
      this._alertMapGeneration = (this._alertMapGeneration || 0) + 1;
      this._statusRefs = null;
    }
  }

  _alertMapMarkers() {
    if (!this._securitySessionActive() || this._editing || this._loading || document.hidden || this._weatherInView === false) return [];
    const bindings = this._layout?.alert_bindings ?? this._config?.alert_bindings ?? [], counts = new Map();
    for (const binding of Array.isArray(bindings) ? bindings : []) {
      const id = typeof binding?.id === 'string' && binding.id ? binding.id : binding?.entity;
      if (typeof id === 'string') counts.set(id, (counts.get(id) || 0) + 1);
    }
    return (this._alertData?.alerts || []).filter((record) => {
      const point = record.location, floors = (this._floors || []).filter((floor) => floor?.id === point?.floorId);
      return counts.get(record.id) === 1 && record.shown === true && point && (record.active || record.status !== 'clear')
        && typeof record.entity === 'string' && /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(record.entity) && floors.length === 1
        && !floors[0].stale && floors[0].shown !== false && Number.isFinite(floors[0].elevation)
        && [point.x, point.y, point.z].every(Number.isFinite)
        && Math.abs(point.x) <= 1e6 && Math.abs(point.y) <= 1e6 && Math.abs(point.z) <= 1000;
    }).map((record) => {
      const metadata = entityMetadata(this._hass, record.entity);
      return { ...record, id: `alert:${record.id}:${this._alertMapGeneration}`,
        bindingId: record.id, generation: this._alertMapGeneration, location: { ...record.location },
        selectable: metadata.hasState && !metadata.hidden && !metadata.disabled && !metadata.category };
    });
  }

  _showMapAlert(id, expected = {}) {
    // Re-read the current source and deliberate binding before opening native
    // details. An alert click never focuses, acknowledges or changes a device.
    this._syncStatus();
    const record = this._alertMapMarkers().find((candidate) => candidate.id === id);
    if (!record?.selectable || this._miniMap?.el.hidden !== false || this._miniMap.scene?.floorId !== record.location.floorId
      || expected.entityId !== record.entity || expected.bindingId !== record.bindingId
      || expected.generation !== record.generation || expected.floorId !== record.location.floorId) return false;
    this._moreInfo(record.entity);
    return true;
  }

  _recordHistory(label) {
    this._history.record({ layout: this._layout, config: this._config }, label);
    this._edit?.updateHistoryState?.();
  }

  beginHistory(label) { this._history.begin(label); }
  endHistory() { this._history.end(); this._edit?.updateHistoryState?.(); }
  undoEdit() { this._restoreHistory(this._history.undo()); }
  redoEdit() { this._restoreHistory(this._history.redo()); }

  _restoreHistory(snapshot) {
    if (!snapshot) return;
    this._edit?._dashboardBackupEditor?.reset();
    this._edit?._furnitureDrag?.cancel();
    this._edit?._furnitureEditor?.reset();
    this._furnitureCoordinator?.clearPreview();
    this._suspendAmbient('history changed');
    this.finishWallSelectionPreparation({ reload: false });
    this._stopScenePreview('history changed');
    this._markerRenderKey = null;
    this._edit?._cameraEditor?.reset();
    this._edit?._trackingEditor?.reset();
    this._edit?._modelRenderingEditor?.reset();
    this._edit?._scenePreviewEditor?.reset();
    this._edit?._ambientIdleEditor?.reset();
    this._edit?._wallPresentationEditor?.reset();
    this._edit?._floorPresentationEditor?.reset();
    this._edit?._houseSummaryEditor?.reset();
    this._cameraCoveragePreview = null;
    this._historyReplaying = true;
    try {
      const configChanged = JSON.stringify(snapshot.config) !== JSON.stringify(this._config);
      this.setConfig(snapshot.config);
      this._commit(snapshot.layout);
      if (configChanged) this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: snapshot.config }, bubbles: true, composed: true,
      }));
    } finally {
      this._historyReplaying = false;
      this._edit?.afterUpdate?.();
      this._edit?.updateHistoryState?.();
    }
  }

  _applyMarkerSelection(id) {
    for (const [mid, el] of this._markerEls) el.classList.toggle('selected', mid === id);
  }

  _houseLayoutEnabled() { return this._config?.layout_style === 'house'; }

  _houseSessionActive() {
    const user = this._hass?.user;
    return this.isConnected === true && this._hass?.connection?.connected === true
      && typeof user?.id === 'string' && !!user.id.trim()
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true);
  }

  houseSummaryEditorAvailable() {
    return this._houseLayoutEnabled() && this._houseSessionActive() && this._hass.user.is_admin === true
      && this._editing === true && this._edit?.tab === 'house' && !!this._layout && !this._loading;
  }

  _syncHouseShell() {
    if (!this._stage) return;
    const enabled = this._houseLayoutEnabled() && this.isConnected === true;
    if (!enabled && !this._houseShell) return;
    if (!this._houseShell) this._houseShell = new HouseShell(this, {
      onSelect: (action) => this._selectHouseNavigation(action),
      onNeedsResize: () => { if (this.isConnected && this._view) this._resize(); },
    });
    const placement = enabled ? 'right' : this._config.control_panel;
    if (this._devicePopup && this._devicePopup.placement !== (placement === 'right' ? 'right' : 'popup'))
      this._devicePopup.setPlacement(placement);
    this._houseShell.setData({ enabled, scheme: this._config.house_colour_scheme || 'ha',
      summaryRaw: this._layout?.house_summary ?? this._config.house_summary, selected: this._houseSelection || 'house', editing: !!this._editing,
      navItems: localizeHouseNavigationItems(this._hass).map((item) => item.id === 'settings'
        ? { ...item, disabled: this._hass?.user?.is_admin !== true || !this._layout || !!this._loading } : item),
    });
    if (!this._ro || !this._houseObserved) return;
    const current = new Set(enabled ? [this._houseShell.header?.element, this._houseShell.navigation?.element, this._devicePopup?.el].filter(Boolean) : []);
    for (const node of this._houseObserved) if (!current.has(node)) this._ro.unobserve(node);
    for (const node of current) if (!this._houseObserved.has(node)) this._ro.observe(node);
    this._houseObserved = current;
  }

  _selectHouseNavigation(action) {
    if (!this._houseLayoutEnabled() || !this._houseSessionActive() || this._editing || this._loading || !action) return;
    if (action.type === 'control' && action.id === '3d') {
      this._devicePopup.close(); this._popup.close(); this._setMode('3d'); this._houseSelection = 'house';
    } else if (action.type === 'category' && action.id === 'settings') {
      if (this._hass.user.is_admin !== true || !this._layout) return;
      this._toggleEdit();
      this._edit.panel.querySelector('[data-act="tab"][data-id="house"]')?.click();
    } else if (action.type === 'category') {
      const category = buildHouseCategory({ hass: this._hass, layout: this._layout, id: action.id });
      if (!category) return;
      this._stopScenePreview('house category opened'); this._popup.close(); this._devicePopup.update(this._hass);
      this._devicePopup.showCategory({ ...category, ...ownedHouseCategoryPresentation(category),
        resolve: (hass) => {
          const current = buildHouseCategory({ hass, layout: this._layout, id: category.id });
          return current ? { ...current, ...ownedHouseCategoryPresentation(current) }
            : { entityIds: [], emptyText: 'Connect to Home Assistant to read this category.', emptyTextKey: 'house.categories.connect' };
        },
      });
      this._houseSelection = category.id;
    } else return;
    this._syncHouseShell();
  }

  _resize() {
    const r = this._stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (this._houseShell?.enabled) this._houseShell.measure({ baseHeight: houseBaseHeight(this._stage) });
    else {
      const barHeight = this._toolbar.hidden ? 0 : this._toolbar.getBoundingClientRect().height + 16;
      this._stage.style.setProperty('--taylors3d-bar-height', `${barHeight}px`);
    }
    const scene = this._scene.getBoundingClientRect();
    this._view.resize(scene.width, scene.height);
    if (this._miniMap && this._config.mini_map_position !== 'top-left') {
      this._miniMap.el.style.right = 'calc(var(--taylors3d-controls-width, 0px) + 12px)';
    }
    this._devicePopup.reposition();
    if (!this._fitted && this._roomList) this._initialCamera();
  }

  _schedule() {
    if (this._pending) return;
    this._pending = true;
    queueMicrotask(() => {
      this._pending = false;
      if (this._view && this._hass && this._layout) this._update();
    });
  }

  // Rebuild only what changed. Edits replace just the layout parts they touch, so identity
  // comparisons per part keep e.g. overlay slider changes from rebuilding the whole scene.
  _update() {
    this._syncHouseShell();
    this._syncModelRendering();
    this._syncScenePreviews();
    const h = this._hass;
    const b = this._built;
    const l = this._layout;
    let structure = false, markers = false, mower = false;

    if (h.themes !== b.themes || !b.theme) {
      b.themes = h.themes;
      this._applyTheme();
      structure = true;
    }
    const mb = this.modelBindings();
    this._mb = mb;
    const viewsChanged = this._resolveViewList(mb);
    if (viewsChanged) this._checkMergeKeep();
    const viewsOnly = viewsChanged === 'views'; // only layout.views / view_order: no scene or marker rebuild
    let viewRefreshed = false;
    const mkIn = [mb, this._config, l.model];
    if (!b.modelKeyIn || mkIn.some((x, i) => x !== b.modelKeyIn[i])) {
      b.modelKeyIn = mkIn;
      b.modelKeyNow = mb ? JSON.stringify([mb.levels, mb.rooms, this._modelAlign()]) : '';
    }
    const modelKey = b.modelKeyNow;
    if (structure || (viewsChanged && !viewsOnly) || l.rooms !== b.rooms || l.floors !== b.lfloors || h.floors !== b.floors || h.areas !== b.areas
      || (mb && mb.manifest) !== b.manifest || modelKey !== b.modelKey) {
      b.manifest = mb && mb.manifest;
      b.modelKey = modelKey;
      this._buildStructure(mb, !!viewsChanged);
      markers = true;
    } else if (viewsOnly) {
      this._refreshViews();
      viewRefreshed = true;
    }
    const sig = registrySignature(h);
    // The first five signature fields own membership/placement. Language,
    // number formatting and translation metadata only change current captions.
    const membershipChanged = !b.sig || sig.slice(0, 5).some((value, index) => value !== b.sig[index]);
    const presentationChanged = !!b.sig && sig.slice(5).some((value, index) => value !== b.sig[index + 5]);
    const m = l.mower || null;
    const mowerKey = m ? `${m.entity}|${m.floor_id}` : '';
    if (this._syncBindings() || markers || membershipChanged || l.pins !== b.pins || l.hidden !== b.hidden || mowerKey !== b.mowerKey) {
      b.pins = l.pins;
      b.hidden = l.hidden;
      b.mowerKey = mowerKey;
      this._buildMarkers();
      markers = true;
    } else if (presentationChanged) this._refreshMarkerNames();
    b.sig = sig;
    if (l.model !== b.model) {
      b.model = l.model;
      this._loadModel();
    }
    if (m !== b.mower) {
      b.mower = m;
      this._mowerFn = m && m.entity ? mowerTransform(m) : null;
      mower = true;
    }
    if (h.states !== b.states || markers || mower || presentationChanged) {
      b.states = h.states;
      this._refreshStates();
      this._refreshMower(mower);
    }
    this._updateObjects();
    this._popup.update();
    this._devicePopup.update(h);
    this._syncMiniMap();
    this._syncStatus();
    this._syncAmbient();
    this._syncWallPresentation();
    this._syncFurniture();
    if ((markers || viewRefreshed) && this._editing) this._edit.afterUpdate();
    else if (this._editing) this._edit.onStates();
  }

  _mowerFloor() {
    const m = this._layout.mower;
    return m?.floor_id || this._floors[0]?.id || null;
  }

  // Live mower: move its marker, extend the trail, refresh the map overlay.
  _refreshMower(configChanged) {
    const cfg = this._layout.mower;
    const floorId = this._mowerFloor();
    if (!cfg || !cfg.entity || !this._floors.some((floor) => floor.id === floorId)) {
      this._trail = [];
      this._mowerLive = null;
      this._mowerHeadFrom = null;
      this._objects?.setMowerPose(null);
      if (this._mowerMarkerId && this._positions?.has(this._mowerMarkerId)) {
        this._positions.delete(this._mowerMarkerId);
        this._buildMarkers();
      }
      this._refreshAttached();
      this._view.setTrail(null);
      this._view.setMapOverlay(null);
      this._setCameraTimer(0);
      this._setImageTimer(0);
      return;
    }
    let reading = null, p;
    if (cfg.source === 'image') p = this._imageMowerPos(cfg);
    else {
      this._setImageTimer(0);
      this._imageBlob = null;
      this._imageResult = null;
      reading = readSource(this._hass.states[cfg.entity], cfg);
      p = reading && this._mowerFn ? this._mowerFn(reading) : null;
    }
    this._mowerLive = p ? { x: p[0], y: p[1], floorId, reading } : (reading ? { reading } : null);
    this._poseMowerObject(p, floorId);
    this._refreshAttached(); // markers attached to the mower ride along
    const id = this._mowerMarkerId;
    if (p && id) {
      const pos = { x: p[0], y: p[1], z: MOWER_Z, floorId, auto: false, live: true };
      const prev = this._positions.get(id);
      this._positions.set(id, pos);
      if (!this._view.markerObjects.has(id)) {
        this._buildMarkers();
        this._refreshStates();
      } else if (!prev || prev.x !== pos.x || prev.y !== pos.y || prev.floorId !== floorId) {
        this._view.moveMarker(id, pos.x, pos.y, pos.z, floorId); // only when it actually moved
      }
    }
    if (configChanged) this._trail = [];
    if (cfg.trail !== false) {
      const t = (this._trail = this._trail || []);
      const last = t[t.length - 1];
      if (p && (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= TRAIL_STEP_M)) {
        t.push(p);
        if (t.length > TRAIL_MAX) t.splice(0, t.length - TRAIL_MAX);
        this._view.setTrail(t, floorId);
      } else if (configChanged) {
        this._view.setTrail(t, floorId);
      }
    } else {
      this._view.setTrail(null);
    }
    this._refreshMapOverlay();
  }

  // ---------- mower position from the live map image ----------
  // The last detected icon pixel mapped through the current overlay alignment; schedules detection
  // when the image changes (image entities) and every refresh interval (cameras, and as a fallback).
  _imageMowerPos(cfg) {
    const ic = cfg.image || {};
    const entity = ic.entity || (cfg.overlay && cfg.overlay.entity);
    const st = entity && this._hass.states[entity];
    const ready = !!(st && ic.color && cfg.overlay);
    this._setImageTimer(ready ? Math.max(2, Number(cfg.overlay.refresh) || 10) : 0);
    if (!ready) {
      this._imageBlob = null;
      this._imageResult = !st ? { error: entity ? `Map image ${entity} not found.` : 'Set the map overlay first.' } : null;
      return null;
    }
    const key = [entity, st.last_updated, st.state, ic.color.join(','), ic.tolerance, ic.min_pixels].join('|');
    if (key !== this._imageKey) {
      this._imageKey = key;
      this._detectMower();
    }
    const b = this._imageBlob;
    if (!b) return null;
    const q = pixelToPlan(b.px, b.py, b.imgW, b.imgH, cfg.overlay);
    return [q.x, q.y];
  }

  _setImageTimer(seconds) {
    if (!this.isConnected) seconds = 0;
    if (this._imageTimerSec === seconds) return;
    clearInterval(this._imageTimer);
    this._imageTimerSec = seconds;
    this._imageTimer = seconds ? setInterval(() => this._detectMower(), seconds * 1000) : null;
  }

  // Read the map image, find the icon colour, store the pixel. Async (fetch + createImageBitmap),
  // one run at a time; skipped while disconnected or the tab is hidden.
  async _detectMower() {
    if (!this.isConnected || !this._hass || !this._layout) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (this._imageBusy) { this._imageAgain = true; return; }
    const cfg = this._layout.mower;
    const ic = (cfg && cfg.source === 'image' && cfg.image) || null;
    const entity = ic && (ic.entity || (cfg.overlay && cfg.overlay.entity));
    if (!ic || !ic.color || !entity) return;
    // the overlay just loaded this picture (< 1 s ago): read it instead of downloading it again
    const plane = this._view && this._view.mapPlane, ov = plane && plane.userData.loaded;
    const fresh = ov && ov.url === plane.userData.url && cfg.overlay && cfg.overlay.entity === entity && Date.now() - ov.at < 1000 ? ov.image : null;
    const url = fresh ? null : overlayUrl(this._hass, entity, Date.now());
    if (!fresh && !url) return;
    this._imageBusy = true;
    let result;
    try {
      const img = fresh
        ? imagePixels(fresh, fresh.naturalWidth || fresh.width, fresh.naturalHeight || fresh.height)
        : await readImagePixels(url);
      const k = img.imgW / img.width; // sampled canvas -> image pixels
      const old = this._imageBlob;
      const sameColor = !!old && String(old.color) === String(ic.color);
      const track = sameColor ? { px: old.px / k, py: old.py / k, count: old.count == null ? null : old.count / (k * k), misses: old.misses || 0 } : null;
      const b = findBlob(img.data, img.width, img.height, ic.color, ic.tolerance ?? 40, { minPixels: ic.min_pixels ?? 4, prev: track });
      const step = stepTrack(track, b);
      if (step.found) {
        this._imageBlob = { px: b.px * k, py: b.py * k, count: b.count * k * k, misses: 0, imgW: img.imgW, imgH: img.imgH, sampleW: img.width, color: ic.color };
        result = { count: b.count };
      } else {
        result = { missing: true };
        if (!sameColor) this._imageBlob = null; // a stale position of another colour would mislead
        else this._imageBlob = { ...old, misses: step.track.misses }; // last known position, count kept
      }
    } catch (e) {
      console.warn('taylors3d: could not read the mower map image', e);
      result = { error: "Can't read the map image." };
    } finally {
      this._imageBusy = false;
    }
    const now = this._layout && this._layout.mower;
    if (!now || now.source !== 'image') return;
    this._imageResult = result;
    if (this._view) this._refreshMower(false);
    if (this._editing && this._edit) this._edit.onStates();
    if (this._imageAgain) {
      this._imageAgain = false;
      this._detectMower();
    }
  }

  // A bound mower object follows the live position; heading from the last real movement (> 5 cm;
  // image source: > max(0.25 m, 3 map pixels), so detection noise never turns it).
  _poseMowerObject(p, floorId) {
    const layer = this._objects;
    if (!layer || !layer.mowerBound()) { this._mowerHeadFrom = null; layer && layer.setMowerPose(null); return; }
    if (!p) return;
    const from = this._mowerHeadFrom;
    if (!from) this._mowerHeadFrom = [p[0], p[1]];
    else if (Math.hypot(p[0] - from[0], p[1] - from[1]) > this._headingStep()) {
      this._mowerHeading = Math.atan2(p[1] - from[1], p[0] - from[0]);
      this._mowerHeadFrom = [p[0], p[1]];
    }
    layer.setMowerPose({ x: p[0], y: p[1], floorId, heading: this._mowerHeading });
  }

  _headingStep() {
    const m = this._layout && this._layout.mower, b = this._imageBlob;
    return headingMinStep(m && m.source, m && m.overlay && m.overlay.width, b && b.sampleW);
  }

  clearTrail() {
    this._trail = [];
    this._view.setTrail(null);
  }

  _refreshMapOverlay() {
    const cfg = this._layout.mower;
    const o = cfg && cfg.overlay;
    const st = o && o.entity && this._hass.states[o.entity];
    if (!st || !this._floors.some((floor) => floor.id === this._mowerFloor())) {
      this._view.setMapOverlay(null);
      this._setCameraTimer(0);
      return;
    }
    const camera = o.entity.startsWith('camera.');
    this._setCameraTimer(camera ? Math.max(1, Number(o.refresh) || 10) : 0);
    // image entities change their state when the picture changes; cameras are polled
    const bust = camera ? this._cameraTick || 1 : st.last_updated || st.state;
    this._view.setMapOverlay({
      url: overlayUrl(this._hass, o.entity, bust),
      x: o.x, y: o.y, rotation: o.rotation, width: o.width, opacity: o.opacity,
      floorId: this._mowerFloor(),
    });
  }

  _setCameraTimer(seconds) {
    if (this._cameraTimerSec === seconds) return;
    clearInterval(this._cameraTimer);
    this._cameraTimerSec = seconds;
    this._cameraTimer = seconds && this.isConnected ? setInterval(() => {
      this._cameraTick = Date.now();
      this._refreshMapOverlay();
    }, seconds * 1000) : null;
  }

  _applyTheme() {
    const bg = cssColor(this, '--card-background-color', '#ffffff');
    const text = cssColor(this, '--primary-text-color', '#212121');
    const dark = this._hass.themes && typeof this._hass.themes.darkMode === 'boolean'
      ? this._hass.themes.darkMode : luminance(bg) < 0.4;
    const mix = (a, c, t) => a.clone().lerp(c, t);
    this._built.theme = {
      dark,
      floor: mix(bg, text, dark ? 0.09 : 0.05),
      outdoor: mix(bg, new Color('#5a9e4b'), dark ? 0.22 : 0.3),
      wall: mix(bg, text, dark ? 0.42 : 0.3),
      edge: mix(bg, text, dark ? 0.3 : 0.22),
      primary: cssColor(this, '--primary-color', '#03a9f4'),
    };
    this._view.setTheme(this._built.theme);
  }

  _buildStructure(mb, viewsChanged = false) {
    this._devicePopup.close(); // room membership/geometry may have changed
    const h = this._hass, b = this._built;
    b.rooms = this._layout.rooms;
    b.lfloors = this._layout.floors;
    b.floors = h.floors;
    b.areas = h.areas;
    const align = this._modelAlign();
    // a level bound to an HA floor gives that floor its elevation and height (user overrides win);
    // untagged levels use their measured geometry
    let overrides = [];
    if (mb) {
      const meas = measuredElevations(mb.manifest.levels);
      const levels = mb.manifest.levels.map((lv) => (meas[lv.id] ? { ...lv, elevation: meas[lv.id].elevation, height: lv.height ?? meas[lv.id].height } : lv));
      overrides = levelFloorOverrides(levels, mb.levels, align);
    }
    this._floors = mergeFloors(h, { ...this._layout, floors: [...overrides, ...(this._layout.floors || [])] });
    this._modelRooms = mb ? modelRooms(mb.manifest.rooms, mb.levels, mb.rooms, align) : [];
    // every model room / zone outline in card plan, for roomless markers (pins) by position
    this._zones = mb ? mb.manifest.rooms.filter((r) => Array.isArray(r.outline) && r.outline.length > 2)
      .map((r) => ({ id: r.id, level: r.level, polygon: r.outline.map((p) => transformPoint(p, align)) })) : [];
    if (mb) {
      this._view.setModelLevels(mb.levels);
      const levelOrder = levelOrders(mb.manifest.levels);
      const levelFloor = {};
      for (const [id, a] of Object.entries(mb.levels || {})) if (a && a.floor && !a.stale) levelFloor[id] = a.floor;
      this._levels = { levelOrder, levelFloor, floorLevel: floorLevels(levelFloor, levelOrder) };
    } else {
      this._levels = null;
    }
    const roomLevel = new Map(mb ? mb.manifest.rooms.map((r) => [r.id, r.level]) : []);
    this._roomList = this._allRooms().map((room) => {
      const floorId = roomFloorId(room, h, this._floors);
      return {
        room, floorId,
        name: room.name || (room.area_id ? areaName(h, room.area_id) : room.label || ''),
        levelId: room.modelId ? roomLevel.get(room.modelId) : this._levels ? this._levels.floorLevel[floorId] : undefined,
      };
    });

    const fresh = !!this._viewFresh;
    this._viewFresh = false;
    this._pickView();
    if (viewsChanged) this._floorOnly = null;
    const cur = this.currentView();
    this._viewState = cur ? this._stateFor(cur) : null;
    this._applyZoomTo();
    this._pushStructure();
    if (!this._floorOnly) this._applyViewVisibility();
    this._empty.hidden = this._roomList.length > 0 || !!this._editing;
    this._empty.textContent = localize(this._hass, 'plan.empty');
    this._syncToolbar();
    // frame once per load / model; later rebuilds (edits, registry changes) keep the user's camera
    if (fresh) {
      this._fitted = false;
      this._initialCamera();
    }
  }

  // The active view: kept while it exists, else the configured / first one. Resets the per-view states.
  _pickView() {
    this._viewStates = new Map();
    if (!this._views.some((v) => v.id === this._viewId && !v.hidden)) {
      const withRooms = this._floors.find((f) => this._roomList.some((r) => r.floorId === f.id)) || this._floors[0];
      this._viewId = defaultViewId(this._views, {
        viewId: this._config.view_id, floor: this._config.floor, fallback: this._view.model ? null : withRooms.id,
      }, (v) => this._stateFor(v).floors);
      this._floorOnly = null;
    }
  }

  // View settings changed (rules, labels, cameras, floors, cut, order): re-resolve visibility and
  // marker states only; the scene, rooms and markers stay.
  _refreshViews() {
    this._pickView();
    this._floorOnly = null;
    const cur = this.currentView();
    this._viewState = cur ? this._stateFor(cur) : null;
    this._applyZoomTo();
    if (this._labelKeyNow() !== this._labelKey) this._pushStructure();
    this._applyViewVisibility();
    this._applyMarkerStates();
    this._syncToolbar();
  }

  // Rooms, walls and labels into the view. Labels with a model: edit mode, or storey views for
  // rooms on the view's primary level.
  _pushStructure() {
    const hasModel = !!this._view.model;
    const st = this._viewState;
    const mode = this._config.room_labels || 'size';
    this._labelKey = this._labelKeyNow();
    const labelled = (r) => !hasModel || !!this._editing || (!!st && !st.overview && !!st.primary && r.levelId === st.primary);
    const rooms = (this._roomList || []).map((r) => ({
      room: r.room, floorId: r.floorId, label: labelled(r) ? roomLabel(r.name, r.room.polygon, mode) : '',
    }));
    this._view.setStructure(this._floors, rooms, {
      wallHeight: Number(this._config.wall_height) || 1.0,
      walls: !hasModel, fills: !hasModel, outlines: !hasModel || !!this._editing, labels: true,
    });
    this._stage.classList.toggle('has-model', hasModel);
  }

  _labelKeyNow() {
    const st = this._viewState;
    if (!this._view.model || this._editing) return '*';
    return st && !st.overview && st.primary ? 'p:' + st.primary : '';
  }

  // Views from the model (or HA floors without one) merged with layout + YAML overrides.
  // Returns true when they changed. A new model resets the node index and re-frames.
  _resolveViewList(mb) {
    const l = this._layout, b = this._built;
    // same inputs (by identity) as last time: nothing to resolve (the usual per-state-update case)
    const inputs = [mb, l.views, l.view_order, l.floors, l.model, this._hass.floors, this._config];
    if (b.viewInputs && inputs.every((x, i) => x === b.viewInputs[i])) return false;
    b.viewInputs = inputs;
    const manifest = mb ? mb.manifest : null;
    const haFloors = mergeFloors(this._hass, manifest ? { floors: [] } : l);
    const savedLevels = { ...(this._config.model ? levelsFromFloorMap(this._config.model_floors) : {}), ...((l.model && l.model.levels) || {}) };
    const key = JSON.stringify([haFloors.map((f) => [f.id, f.name]), this._config.views || null, savedLevels, mb ? mb.levels : null]);
    const vkey = JSON.stringify([l.views || null, l.view_order || null]);
    if (manifest === b.viewManifest && key === b.viewKey && vkey === b.viewsKey) return false;
    const onlyViews = manifest === b.viewManifest && key === b.viewKey && !!this._floors;
    if (manifest !== b.viewManifest) {
      this._index = manifest && this._view.model ? nodeIndex(threeAdapter(this._view.model.root), manifest) : null;
      this._viewFresh = true;
    }
    b.viewManifest = manifest;
    b.viewKey = key;
    b.viewsKey = vkey;
    this._views = orderViews(resolveViews({ manifest, haFloors, layoutViews: l.views, yamlViews: this._config.views, savedLevels }), l.view_order);
    return onlyViews ? 'views' : true;
  }

  // Per view: effective node visibility, primary storey, linked HA floors (cached until the next rebuild).
  _stateFor(v) {
    let st = this._viewStates.get(v.id);
    if (st) return st;
    const allIds = (this._floors || []).map((f) => f.id);
    const mb = this._mb;
    if (!mb || !this._index || !this._levels) {
      const allFloors = v.id === 'all' && !Array.isArray(v.floors);
      st = { effective: null, primary: null, floors: Array.isArray(v.floors) ? [...v.floors] : allFloors ? allIds : [], allFloors, overview: allFloors };
    } else {
      const effective = resolveVisibility(this._index, v.rules);
      const primary = primaryLevel(this._index, effective, mb.manifest.levels);
      const allFloors = !Array.isArray(v.floors) && v.id === 'all' && v.source !== 'model';
      const floors = Array.isArray(v.floors) ? [...v.floors] : allFloors ? allIds : defaultFloors(primary, this._levels.levelFloor);
      st = { effective, primary, floors, allFloors, overview: isOverview(this._index, effective, mb.manifest.levels) };
    }
    this._viewStates.set(v.id, st);
    return st;
  }

  currentView() {
    return this._views.find((v) => v.id === this._viewId) || null;
  }

  // Zoom pivot of the active view (view zoom_to > card zoom_to > centre).
  _applyZoomTo() {
    if (this._view) this._view.setZoomTo(zoomToFor(this.currentView(), this._config));
  }

  viewIndex() {
    return this._index || null;
  }

  // Floors, model node visibility and cut for the active view.
  _applyViewVisibility() {
    const vw = this._view, v = this.currentView(), section = this._sectionActive();
    const st = section ? this._sectionState() : this._viewState;
    if (section) this._applySectionPlane();
    else if (vw.sectionClip) vw.setSection(null);
    this._syncFloorPresentation();
    if (!v || !st) {
      this._floor = 'all';
      vw.setVisibleFloors('all');
      vw.applyModelVisibility(null, null);
      vw.setCut(undefined);
      this._syncWeatherVisibility();
      return;
    }
    const visible = st.allFloors || (!st.floors.length && v.id === 'all') ? 'all' : st.floors;
    this._floor = visible === 'all' ? 'all' : st.floors[0] || 'all';
    vw.setVisibleFloors(visible);
    if (this._index && vw.model && st.effective) {
      vw.applyModelVisibility(this._index, st.effective);
      if (section) { vw.setCut(null); this._syncWeatherVisibility(); return; }
      const floors = st.floors.map((id) => this._floors.find((f) => f.id === id)).filter(Boolean);
      vw.setCut(viewCut(v, { tagged: vw.isTagged(), floors }));
    } else {
      vw.applyModelVisibility(null, null);
      vw.setCut(undefined);
    }
    this._syncWeatherVisibility();
  }

  // Devices follow the view's visible rooms / linked floors (model only; without one the floor rules apply).
  _applyMarkerStates() {
    const vw = this._view, mb = this._mb, L = this._levels;
    const st = this._sectionActive() ? this._sectionState() : this._viewState;
    if (!mb || !this._index || !vw.model || !st || !st.effective || !L || this._floorOnly || !this._positions) {
      vw.setMarkerStates(null);
      return;
    }
    const roomByArea = new Map();
    for (const r of this._modelRooms || []) if (r.area_id && !roomByArea.has(r.area_id)) roomByArea.set(r.area_id, r.modelId);
    const roomLevel = new Map(mb.manifest.rooms.map((r) => [r.id, r.level]));
    const visibleRooms = new Set();
    this._index.nodes.forEach((n, i) => {
      if (st.effective[i] && n.tag && (n.tag.kind === 'room' || n.tag.kind === 'zone')) visibleRooms.add(n.tag.id);
    });
    const ctx = {
      levelOrder: L.levelOrder, primaryOrder: st.primary ? L.levelOrder[st.primary] ?? null : null,
      visibleRooms, viewFloors: new Set(st.floors), overview: st.overview,
    };
    const byId = new Map(this._markers.map((m) => [m.id, m]));
    const states = new Map();
    const outdoor = exteriorShown(this._index, st.effective, mb.manifest.levels);
    for (const [id, p] of this._positions) {
      const m = byId.get(id);
      // the live mower is outdoors: shown wherever an exterior level shows
      if (p.live && outdoor !== null) { states.set(id, { shown: outdoor, faded: false }); continue; }
      // pins (and the mower without exterior levels) are roomless: the room / zone under them, else their HA floor
      const roomId = !m ? null : p.auto === false || p.live
        ? roomAt([p.x, p.y], p.floorId, this._zones, L.levelFloor, visibleRooms) : roomByArea.get(m.areaId) || null;
      states.set(id, deviceState({
        roomId, roomLevelId: roomId ? roomLevel.get(roomId) : undefined, markerFloorId: p.floorId, floorLevelId: L.floorLevel[p.floorId],
      }, ctx));
    }
    vw.setMarkerStates(states);
  }

  // A view's cameras in card world (model cameras follow the model alignment).
  viewCamera(v) {
    const camera = cameraToCard(v, this._view.model ? (p) => this._view.modelPointToWorld(p) : null);
    if (!this._floorPresentationActive()) return camera;
    const floorId = this._cameraFloorForView(v);
    return floorId ? translateFloorCamera(camera, this._floorPresentationReportValue, floorId, this._floors) : null;
  }

  viewTopCamera(v) {
    const camera = topCameraToCard(v, this._view.model ? this._modelAlign() : null);
    if (!this._floorPresentationActive()) return camera;
    const floorId = this._cameraFloorForView(v);
    return floorId ? translateFloorCamera(camera, this._floorPresentationReportValue, floorId, this._floors, { top: true }) : null;
  }

  _cameraFloorForView(v = this.currentView()) {
    if (typeof this._floorOnly === 'string' && this._floorOnly !== 'all') return this._floorOnly;
    const floors = v ? this._stateFor(v)?.floors : null;
    return Array.isArray(floors) && floors.length === 1 ? floors[0] : null;
  }

  // Chip switch. The camera moves only for a view with its own camera (no model: frame the floor, as before).
  _setView(id, { instant = false } = {}) {
    this._suspendAmbient('view changed');
    if (!this._selectingPreset) { this._presetEvents.interrupt(); this._view.stopCameraMotion(); }
    const v = this._views.find((x) => x.id === id);
    if (!v) return;
    this._stopScenePreview('view changed');
    const wasSection = this._section;
    this._popup.close();
    this._devicePopup.close();
    this._section = false;
    this._sectionPreview = null;
    this._viewId = id;
    this._floorOnly = null;
    this._viewState = this._stateFor(v);
    this._applyViewVisibility();
    if (this._labelKeyNow() !== this._labelKey) this._pushStructure();
    this._applyMarkerStates();
    this._applyZoomTo();
    if (this._mode === 'top') {
      // top view: its own camera when saved, else keep the current one (no model: frame the floor)
      const topCamera = v.camera_top ? this.viewTopCamera(v) : null;
      if (topCamera) this._view.setTopCamera(topCamera, { instant });
      else if (!this._view.model || this._floorPresentationActive()) this._view.fit({ instant });
    } else {
      const camera = v.camera ? this.viewCamera(v) : null;
      if (camera) this._view.setCamera(camera, { instant });
      else if (!this._view.model || wasSection || this._floorPresentationActive()) this._view.fit({ instant });
    }
    this._syncToolbar();
    if (this._editing) this._edit.onViewChanged();
  }

  _selectPreset(view, { mode, source, restore } = {}) {
    if (!this._view || !this._layout || this._loading || this._editing || !this._views.some((v) => v.id === view.id)) return false;
    this._suspendAmbient('camera preset');
    this._selectingPreset = true;
    try {
      this._view.stopCameraMotion();
      if (mode && mode !== this._mode) this._setMode(mode);
      this._setView(view.id);
      if (source === 'return' && restore) {
        if (mode === 'top' && restore.topCamera) this._view.setTopCamera(restore.topCamera);
        else if (restore.camera) this._view.setCamera(restore.camera);
      }
      this._presetError = null;
      this._showNotice();
      return true;
    } finally { this._selectingPreset = false; }
  }

  // First view after load / model change: its saved camera, else frame it.
  _initialCamera() {
    if (this._view.size.w <= 1) return; // _resize retries once the card has a size
    this._suspendAmbient('initial camera');
    this._fitted = true;
    const v = this.currentView();
    const camera = v?.camera && this._mode === '3d' ? this.viewCamera(v) : null;
    if (camera) this._view.setCamera(camera, { instant: true });
    else {
      this._view.fit({ instant: true });
      const topCamera = v?.camera_top && this._mode === 'top' ? this.viewTopCamera(v) : null;
      if (topCamera) this._view.setTopCamera(topCamera, { instant: true });
    }
  }

  // Reset view: the view's saved camera (3D incl. its rotation centre; top: camera_top), else frame it.
  _resetCamera() {
    this._suspendAmbient('camera reset');
    this._stopScenePreview('camera reset');
    if (!this._selectingPreset) this._presetEvents.interrupt();
    if (this._section) this.setSection(false, { camera: false });
    const v = this.currentView();
    if (this._mode === 'top') {
      const camera = v?.camera_top ? this.viewTopCamera(v) : null;
      if (camera) this._view.setTopCamera(camera);
      else this._view.fit();
    } else this._view.resetCamera(this.viewCamera(v));
  }

  // ---------- side section ----------
  _sectionActive() {
    if (this._section && (!this._mb || !this._index || !this._view.model)) this._dropSection(); // model gone: fully off
    return this._section && this._mode === '3d' && !this._floorOnly;
  }

  // Section off without touching visibility or camera (callers re-apply what they need).
  _dropSection() {
    this._section = false;
    this._sectionPreview = null;
    if (this._view.sectionClip) this._view.setSection(null);
    if (this._sectionBtn) this._sectionBtn.classList.remove('on');
  }

  // "Show all" while the section is on: every node, all floors, overview device rules.
  _sectionState() {
    const effective = this._index.nodes.map(() => true);
    return {
      effective, primary: primaryLevel(this._index, effective, this._mb.manifest.levels),
      floors: (this._floors || []).map((f) => f.id), allFloors: true, overview: true,
    };
  }

  // A view's cut plane in card world (the active view: the Views tab preview while sliding wins).
  sectionPlaneNow(v = this.currentView()) {
    const box = this._view.sectionBox();
    if (!box || !v) return null;
    if (this._sectionPreview && v.id === this._viewId) return this._sectionPreview;
    return sectionPlane(v, box, (p) => this._view.modelPlaneToWorld(p));
  }

  _applySectionPlane() {
    const plane = this.sectionPlaneNow();
    this._view.setSection(plane);
  }

  // Section off and back at the view's camera at once (before saving or re-centring the camera).
  leaveSection() {
    if (!this._section) return false;
    this.setSection(false, { camera: false });
    const v = this.currentView();
    if (v && v.camera) this._view.setCamera(this.viewCamera(v), { instant: true });
    else this._view.fit({ instant: true });
    return true;
  }

  // Toggle the side section. Off returns to the view's visibility and (camera: true) its camera.
  setSection(on, { camera = true } = {}) {
    this._suspendAmbient('section changed');
    this._stopScenePreview('section changed');
    if (this._popup) this._popup.close();
    if (this._devicePopup) this._devicePopup.close();
    if (on) {
      if (this._mode !== '3d' || !this._view.model || !this._index) return;
      const was = this._section;
      this._section = true;
      this._applyViewVisibility();
      this._applyMarkerStates();
      const plane = this.sectionPlaneNow(), box = this._view.sectionBox();
      if (!was && plane && box) this._view.setCamera(sectionCamera(plane, box));
    } else {
      if (!this._section) return;
      this._section = false;
      this._sectionPreview = null;
      this._applyViewVisibility();
      this._applyMarkerStates();
      if (camera) this._resetCamera();
    }
    this._syncToolbar();
  }

  // Views tab: show this plane while the slider moves (turns the section on); null drops the preview.
  // aim: also move the camera to look at the new cut.
  previewSection(id, plane, { aim = false } = {}) {
    if (id !== this._viewId || this._mode !== '3d') return;
    this._sectionPreview = plane || null;
    if (!plane) { if (this._section) this._applySectionPlane(); return; }
    if (!this._section) { this.setSection(true); return; }
    this._view.setSection(plane);
    const box = this._view.sectionBox();
    if (aim && box) this._view.setCamera(sectionCamera(plane, box));
  }

  // Merge a patch into layout.views[id] and save (rules replace the stored list).
  saveViewPatch(id, patch) {
    if ('section' in patch && id === this._viewId) this._sectionPreview = null; // the saved plane takes over
    const l = this._layout;
    const views = l.views || {};
    this._commit({ ...l, views: { ...views, [id]: { ...(views[id] || {}), ...patch } } });
  }

  // Object bindings, recomputed only when the model, layout.objects / groups or the existence of
  // a candidate entity changed. True when the set of bound entities (= hidden markers) changed.
  _syncBindings() {
    const model = this._objects && this._objects.model;
    const objs = model ? model.manifest.objects : [];
    const l = this._layout || {}, lo = l.objects || NONE, groups = l.groups || NONE, states = this._hass.states;
    const eligibility = (entity) => {
      const metadata = entityMetadata(this._hass, entity);
      return [entity || null, metadata.hasState, metadata.hidden, metadata.disabled, metadata.category];
    };
    const exists = JSON.stringify([
      objs.map((o) => eligibility(lo[o.id] && lo[o.id].entity !== undefined ? lo[o.id].entity : (o.suggest || {}).entity)),
      Object.values(groups).map((g) => eligibility(g?.entity)),
    ]);
    const key = [model, lo, groups, exists];
    if (this._bindKey && key.every((x, i) => x === this._bindKey[i])) return false;
    this._bindKey = key;
    this._bindings = bindObjects(objs, lo, states, this._hass);
    this._groups = effectiveGroups(groups, states, this._hass);
    this._objects.setBindings(this._bindings, this._groups);
    const bound = new Set();
    for (const b of this._bindings.values()) if (b.entity && !b.hidden) bound.add(b.entity);
    // the mower marker depends on whether the mower object is bound (its entity may stay bound by the dock)
    const mower = this._objects.mowerBound();
    const changed = bound.size !== this._boundEntities.size || [...bound].some((e) => !this._boundEntities.has(e)) || mower !== this._mowerObjectBound;
    this._boundEntities = bound;
    this._mowerObjectBound = mower;
    return changed;
  }

  // Shared saved presentation takes precedence over the card's fallback settings.
  _ambientGeneration() {
    const config = this._config || {}, layout = this._layout || {}, view = this._view;
    const refs = [view, view?.camera, view?.controls, view?.model?.root, layout.rooms, layout.floors,
      layout.model, layout.views, this._viewState, this._viewId, this._mode, this._floor, this._floorOnly,
      config.layout_key, config.model, config.model_rotation, config.model_scale,
      ...(Array.isArray(config.model_position) ? config.model_position : [config.model_position]),
      layout.model?.rotation, layout.model?.scale,
      ...(Array.isArray(layout.model?.position) ? layout.model.position : [layout.model?.position]),
      this._hass?.connection, this._hass?.user?.id];
    if (!this._ambientGenerationRefs || refs.some((value, index) => value !== this._ambientGenerationRefs[index])
      || refs.length !== this._ambientGenerationRefs.length) {
      this._ambientGenerationRefs = refs;
      this._ambientGenerationToken = Object.freeze({});
    }
    return this._ambientGenerationToken;
  }

  _ambientContext() {
    const view = this._view, active = this.shadowRoot?.activeElement || document.activeElement;
    const labelFocused = !!(active && view?.labelRenderer?.domElement?.contains(active));
    const settled = !view?._camMovedAt || performance.now() - view._camMovedAt >= 150;
    const sun = readSunState(this._hass);
    return { policy: this._layout?.ambient_idle ?? this._config?.ambient_idle,
      generation: this._ambientGeneration(), reducedMotion: !!this._reducedMotion?.matches,
      eligible: !!(this.isConnected && !document.hidden && this._weatherInView !== false && this._ambientWindowActive
        && this._hass?.connection?.connected === true && this._hass?.user?.id && this._layout && this._config
        && view?.size?.w > 1 && view?.size?.h > 1 && (view.model || this._roomList?.length)
        && !this._loading && !this._editing && !this._section && !view.sectionClip
        && this._mode === '3d' && view.mode === '3d' && view.controls?.enabled !== false && settled
        && !view._tween && !view._modelMotionMoving && !this._gesture && !this._ambientControlsGesture && !labelFocused
        && !this._ambientPointers.size && !this._ambientKeys.size && !this._lightPreview
        && !this._popup?.isOpen && !this._devicePopup?.isOpen && !(this._alertData?.stats?.active > 0)),
      sun: sun.status === 'ready' ? { status: 'ready', nightFactor: nightFactor(sun.elevation) } : { status: sun.status },
      wallTime: Date.now(), timeZone: this._hass?.config?.time_zone };
  }

  _syncAmbient() {
    const reading = this._ambientController?.revalidate(performance.now());
    if (reading?.cameraChanged && this._view) this._view.dirty = true;
    return reading;
  }

  _suspendAmbient(reason) {
    const reading = this._ambientController?.suspend(performance.now(), reason);
    if (reading?.cameraChanged && this._view) this._view.dirty = true;
    return reading;
  }

  _ambientActivity(event) {
    if (event?.type === 'pointerdown') this._ambientPointers.add(event.pointerId);
    if (event?.type === 'keydown') this._ambientKeys.add(event.code || event.key);
    const reading = this._ambientController.activity(performance.now());
    if (reading.cameraChanged && this._view) {
      this._view.dirty = true;
      // A rotating surface moved under this tap. Wake before OrbitControls, but
      // do not apply a device/room action at the old projected coordinate.
      if (event?.type === 'pointerdown') this._ambientWakeEvents.add(event);
    }
    return reading;
  }

  _bindAmbientInput() {
    if (!this._body || this._ambientInputBody === this._body) return;
    this._unbindAmbientInput();
    this._ambientInputBody = this._body;
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'focusin']) this._body.addEventListener(type, this._onAmbientInput, true);
    this._body.addEventListener('wheel', this._onAmbientInput, { capture: true, passive: true });
  }

  _unbindAmbientInput() {
    if (!this._ambientInputBody) return;
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'focusin', 'wheel']) this._ambientInputBody.removeEventListener(type, this._onAmbientInput, true);
    this._ambientInputBody = null;
  }

  _watchAmbientPreference() {
    if (!this.isConnected || !this._reducedMotion || this._ambientPreference?.media === this._reducedMotion) return;
    this._unwatchAmbientPreference();
    const media = this._reducedMotion;
    if (media.addEventListener) { media.addEventListener('change', this._onAmbientPreference); this._ambientPreference = { media }; }
    else if (media.addListener) { media.addListener(this._onAmbientPreference); this._ambientPreference = { media, legacy: true }; }
  }

  _unwatchAmbientPreference() {
    const watch = this._ambientPreference;
    if (watch?.legacy) watch.media.removeListener(this._onAmbientPreference);
    else watch?.media.removeEventListener('change', this._onAmbientPreference);
    this._ambientPreference = null;
  }

  _applyAmbientDim(brightness) {
    const owned = this._ambientDimStyle;
    if (owned && (brightness === 1 || owned.node !== this._scene)) {
      if (owned.value) owned.node.style.setProperty('filter', owned.value, owned.priority);
      else owned.node.style.removeProperty('filter');
      this._ambientDimStyle = null;
    }
    if (brightness === 1 || !this._scene) return;
    if (!this._ambientDimStyle) this._ambientDimStyle = { node: this._scene,
      value: this._scene.style.getPropertyValue('filter'), priority: this._scene.style.getPropertyPriority('filter') };
    const base = this._ambientDimStyle.value;
    const value = `${base && base !== 'none' ? base + ' ' : ''}brightness(${brightness})`;
    if (this._scene.style.getPropertyValue('filter') !== value) this._scene.style.setProperty('filter', value, this._ambientDimStyle.priority);
  }

  _currentPresetCamera() {
    // PresetEventController captures its return position before selecting the
    // destination. Restore idle first without interrupting that request.
    this._suspendAmbient('automation camera capture');
    return { id: this._viewId, mode: this._mode, camera: this._view?.getCamera(), topCamera: this._view?.getTopCamera() };
  }

  _scenePreviewSettings() { return this._layout?.scene_previews ?? this._config?.scene_previews; }

  _scenePreviewAvailable(draft) {
    return !!(this.isConnected && !document.hidden && this._weatherInView !== false && !this._loading
      && this._layout && this._view && this._hass?.connection?.connected === true
      && (draft ? this._editing && this._edit?.tab === 'scenes' && this._hass?.user?.is_admin === true
        : !this._editing && this._config?.show_bubble_bar !== false));
  }

  // A semantic context stamp: unrelated HA updates leave a preview intact.
  // Changing the house, displayed view or access context cancels it immediately.
  _scenePreviewKey() {
    return JSON.stringify([this._config?.layout_key, this._config?.model || this._layout?.model,
      this._config?.model_position, this._config?.model_rotation, this._config?.model_scale,
      this._view?.model?.root?.uuid, this._viewId, this._floorOnly, this._mode, this._section,
      !!this._editing, this._editing ? this._edit?.tab : null, this.isConnected, document.hidden,
      this._weatherInView !== false, !!this._loading, this._config?.show_bubble_bar !== false]);
  }

  _scenePreviewContext() {
    return { hass: this._hass, bindings: this._scenePreviewAvailable(false) ? this._scenePreviewSettings() : undefined,
      contextKey: this._scenePreviewKey(), canEdit: this._hass?.user?.is_admin === true };
  }

  _syncScenePreviews() {
    if (this._syncingScenePreviews) return;
    this._syncingScenePreviews = true;
    try {
      this._scenePreviewController?.revalidate();
      this._edit?._scenePreviewEditor?.controller?.revalidate();
      if (this._lightPreview && !this._scenePreviewAvailable(this._lightPreviewDraft)) this._stopScenePreview('view unavailable');
      this._scenePreviewBar?.update();
    } finally { this._syncingScenePreviews = false; }
  }

  previewSceneLights(overrides, metadata = {}) {
    if (overrides instanceof Map) this._suspendAmbient('scene preview');
    if (!metadata.token) return false;
    if (overrides instanceof Map) {
      if (!this._scenePreviewAvailable(metadata.draft === true)) {
        const controller = metadata.draft ? this._edit?._scenePreviewEditor?.controller : this._scenePreviewController;
        controller?.stop(metadata.token, 'view unavailable');
        return false;
      }
      // Claim the new owner first: a previous controller's late clear must not
      // replace these lights or briefly restore real-state shadow assignments.
      this._lightPreview = overrides;
      this._lightPreviewOwner = metadata.token;
      this._lightPreviewDraft = metadata.draft === true;
      const other = metadata.draft ? this._scenePreviewController : this._edit?._scenePreviewEditor?.controller;
      other?.stop(undefined, 'another preview started');
    } else if (overrides === null && this._lightPreviewOwner === metadata.token) {
      this._lightPreview = null;
      this._lightPreviewOwner = null;
      this._lightPreviewDraft = false;
    } else return false;
    this._updateObjects();
    if (this._view && this._hass && this._positions) this._refreshStates();
    return true;
  }

  _stopScenePreview(reason = 'stopped') {
    this._scenePreviewController?.stop(undefined, reason);
    this._edit?._scenePreviewEditor?.controller?.stop(undefined, reason);
  }

  _scenePreviewInteraction(event) {
    if (event.type === 'keydown' && event.key !== 'Escape'
      && !['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const own = event.composedPath().some((element) => element?.hasAttribute?.('data-scene-preview-bar')
      || element?.hasAttribute?.('data-scene-preview-editor'));
    if (event.type === 'keydown' && event.key === 'Escape' || !own) this._stopScenePreview('interaction');
  }

  _syncModelRendering() {
    const policy = readModelRendering(this._layout?.model_rendering ?? this._config?.model_rendering);
    this._view?.setModelRendering?.(policy);
    return policy;
  }

  wallMaterialWriters() {
    return new Set([...(this._objects?.parts?.values() || [])].map((part) => part.part?.glow).filter((node) => node?.isMesh));
  }

  floorPresentationReport() {
    if (this._floorPresentationReportValue) return this._floorPresentationReportValue;
    const policy = readFloorPresentation(this._layout?.floor_presentation ?? this._config?.floor_presentation);
    return { mode: 'assembled', requestedMode: policy.mode, valid: policy.valid, rows: [], diagnostics: policy.diagnostics };
  }

  _syncFloorPresentation() {
    const view = this._view, raw = this._layout?.floor_presentation ?? this._config?.floor_presentation;
    if (this._syncingFloorPresentation || !view?.setFloorPresentation) return;
    // The unchanged default adds no geometry scan, coordinate copy or render work.
    if (raw === undefined && !this._floorPresentationInputs) return;
    const user = this._hass?.user;
    const activeUser = typeof user?.id === 'string' && !!user.id.trim()
      && (!Object.hasOwn(user, 'is_active') || user.is_active === true);
    const enabled = !!(this.isConnected && activeUser && this._hass?.connection?.connected === true
      && this._layout && this._config && !this._loading && !this._editing && !this._section && !view.sectionClip);
    const writers = new Set([...this.securityMotionWriters(), ...[...(this._securityLayer?.parts?.values() || [])].map((part) => part.target).filter(Boolean)]);
    const writerKey = [...writers].map((node) => node.uuid).sort().join('|');
    const inputs = [view, raw, view.model?.root, view.model?.manifest, this._mb?.levels, this._floors,
      this._roomList, enabled, writerKey, this._config?.layout_key];
    if (this._floorPresentationInputs?.every((value, index) => value === inputs[index])) return;
    this._syncingFloorPresentation = true;
    try {
      const policy = readFloorPresentation(raw);
      const floors = (this._floors || []).map((floor) => ({ ...floor, elevation: view.floorElevation(floor.id) }));
      const context = policy.valid && policy.mode !== 'assembled' ? floorPresentationContext({
        modelRoot: view.model?.root, manifest: view.model?.manifest, bindings: this._mb?.levels,
        floors, rooms: this._roomList,
      }) : { valid: true, targets: [], backgroundNodes: [], bounds: [], diagnostics: [] };
      const result = view.setFloorPresentation(raw, { floors, ...context, transformWriters: writers, enabled: enabled && context.valid });
      const report = view.floorPresentationReport();
      const suspended = !enabled && policy.mode !== 'assembled';
      this._floorPresentationReportValue = { ...report, valid: report.valid && context.valid,
        diagnostics: [...context.diagnostics, ...report.diagnostics,
          ...(suspended ? [{ code: 'presentation_suspended', message: this._editing
            ? 'Editing uses the assembled house coordinates. The saved floor view returns after editing.'
            : this._section || view.sectionClip ? 'Section temporarily uses the assembled house; the saved floor view returns when Section closes.'
              : 'The saved floor view waits for the current loaded Home Assistant session.' }] : [])] };
      this._floorPresentationInputs = inputs;
      const previous = this._floorPresentationAppliedReport;
      const priorRevision = this._floorPresentationView === view ? this._floorPresentationRevision ?? 0 : 0;
      const changed = result.changed || priorRevision !== view.floorPresentationRevision;
      this._floorPresentationView = view;
      this._floorPresentationRevision = view.floorPresentationRevision;
      this._floorPresentationAppliedReport = this._floorPresentationReportValue;
      if (changed) {
        // The synchronous display adapter does not change the camera. Cancel
        // motion only after it proves a real visual change; equal/default or
        // rejected settings must leave live presets and previews untouched.
        this._suspendAmbient('floor presentation changed');
        this._stopScenePreview('floor presentation changed');
        this._presetEvents?.interrupt();
        view.stopCameraMotion?.();
        const cameraFrame = view.captureCameraFrame?.();
        this._floorPresentationCameraTransition(previous, this._floorPresentationReportValue, cameraFrame);
        this._objects?.refreshFloorPresentation?.();
        this._statusRefs = null; this._weatherRefs = null; this._trackingInputKey = null;
      }
    } finally { this._syncingFloorPresentation = false; }
  }

  _displayFeaturePosition(position) {
    return displayPlanPosition(position, this._floorPresentationReportValue, this._floors || []);
  }

  _floorPresentationActive() {
    return this._floorPresentationReportValue?.valid === true
      && ['horizontal', 'vertical'].includes(this._floorPresentationReportValue.mode);
  }

  _floorCameraLife() {
    return [this._view, this._view?.model?.root, this._config?.layout_key, this._hass?.connection,
      this._hass?.user?.id, JSON.stringify(this._config?.model || this._layout?.model || null), JSON.stringify(this._modelAlign())];
  }

  _floorCameraScope() { return [this._mode, this._viewId, this._floorOnly]; }

  _floorPresentationCameraTransition(previous, next, before) {
    const view = this._view;
    if (!view?.captureCameraFrame || !view?.restoreCameraFrame) return;
    const wasActive = previous?.valid === true && previous.mode !== 'assembled';
    const active = next?.valid === true && next.mode !== 'assembled';
    if (!wasActive && !active) return;
    const session = this._floorCameraSession, life = this._floorCameraLife(), scope = this._floorCameraScope();
    const sameLife = session?.life.every((value, index) => value === life[index]);
    const sameScope = sameLife && session.scope.every((value, index) => value === scope[index]);
    const samePose = sameScope && before && session.applied && before.zoom === session.applied.zoom
      && ['position', 'target', 'quaternion', 'up'].every((field) => before[field].every((value, index) => value === session.applied[field][index]));
    let source = samePose ? session.source : !wasActive ? before : null;
    const floorId = this._cameraFloorForView();
    if (wasActive && sameLife && !source && before && floorId) {
      const camera = translateFloorCamera(before, previous, floorId, this._floors, { toSource: true });
      if (camera) source = { ...before, position: camera.position, target: camera.target };
    }
    if (!active) {
      this._floorCameraSession = null;
      // A changed house/account never restores an earlier house's camera.
      if (!sameLife) return;
      if (!source || !view.restoreCameraFrame(source)) view.fit({ instant: true });
      return;
    }
    let placed = false;
    if (source && floorId) {
      const camera = translateFloorCamera(source, next, floorId, this._floors);
      if (camera) placed = view.restoreCameraFrame({ ...source, position: camera.position, target: camera.target });
    }
    if (!placed) view.fit({ instant: true });
    this._floorCameraSession = { source, life, scope, applied: view.captureCameraFrame() };
  }

  _sourceObjectFloor(object, world) {
    // A live mower may be measured on another floor than its authored GLB
    // parent. Its explicit current floor owns both source and display anchors.
    if (object.part && Object.hasOwn(object.part, 'displayFloorId')) {
      const id = object.part.displayFloorId, floors = (this._floors || []).filter((floor) => floor.id === id);
      return typeof id === 'string' && id.trim() && floors.length === 1 && Number.isFinite(floors[0].elevation) ? id : null;
    }
    if (this._floorPresentationActive()) return this._view.floorForModelNode?.(object.obj.node) ?? null;
    return this._levels?.levelFloor?.[object.obj.level]
      || floorAtHeight((this._floors || []).map((floor) => ({ ...floor, elevation: this._view.floorElevation(floor.id) })), world.y);
  }

  _miniMapSourceCamera(snapshot, floorId) {
    if (!this._floorPresentationActive()) return snapshot;
    return { ...snapshot,
      camera: translateFloorCamera(snapshot.camera, this._floorPresentationReportValue, floorId, this._floors, { toSource: true }),
      topCamera: translateFloorCamera(snapshot.topCamera, this._floorPresentationReportValue, floorId, this._floors, { toSource: true, top: true }) };
  }

  _displayFeatureWorld(world, floorId) {
    if (!world) return null;
    if (!this._floorPresentationReportValue?.valid || this._floorPresentationReportValue.mode === 'assembled') return world;
    const displayed = this._displayFeaturePosition({ x: world.x, y: -world.z, z: 0, elevation: world.y, floorId });
    return displayed ? { x: displayed.x, y: displayed.elevation, z: -displayed.y } : null;
  }

  _syncWallPresentation() {
    this._syncFloorPresentation();
    const view = this._view;
    if (!view?.setWallPresentation) return;
    const index = this._built?.viewManifest === view.model?.manifest ? this._index : undefined;
    view.setWallPresentation(this._layout?.wall_presentation ?? this._config?.wall_presentation, {
      index, floors: this._floors || [], materialWriters: this.wallMaterialWriters(),
      enabled: !!(this.isConnected && !document.hidden && this._weatherInView !== false
        && this._layout && this._config && view.model && !this._loading && !this._editing && this._mode === '3d'),
      reducedMotion: !!this._reducedMotion?.matches,
    });
  }

  _updateObjects() {
    const layer = this._objects;
    if (!layer || !layer.model || !this._hass || !this._config) return;
    const policy = this._syncModelRendering();
    layer.update(this._hass.states, { visibleLevel: this._levelShown(),
      lightsOn: this._config.lights !== 'off' && policy.lamps !== 'off', lightPreview: this._lightPreview });
  }

  _levelShown() {
    const levels = (this._objects.model && this._objects.model.manifest.levels) || [];
    return (id) => { const lv = levels.find((x) => x.id === id); return !lv || nodeShown(lv.node); };
  }

  // Object taps: view mode; in edit mode only on the Objects tab.
  _objectTapsOn() {
    return !this._editing || (this._edit && this._edit.tab === 'objects');
  }

  // The nearest tappable object (visible, bound, not hidden, level shown) within radius px of a client point.
  _objectHit(x, y, radius, all = false) {
    const layer = this._objects;
    if (!layer || !layer.model || !this._hass) return null;
    const groups = this._groups || {};
    const levelShown = this._levelShown();
    const pts = [];
    for (const a of layer.displayAnchors ? layer.displayAnchors() : layer.anchors()) {
      const o = layer.objectAt(a.id);
      const b = o && o.binding;
      if (!all && (!b || b.hidden || (!b.missing && !actionTarget(o.obj, b, groups)))) continue;
      if (!levelShown(o.obj.level) || !nodeShown(o.obj.node)) continue;
      const p = this._view.projectWorld(a.world);
      if (p) pts.push({ id: a.id, x: p[0], y: p[1], world: a.world, node: o.obj.node });
    }
    // nearest first; one hidden behind visible model geometry (a lamp behind a facade wall) is skipped
    const byId = new Map(pts.map((p) => [p.id, p]));
    for (const id of screenByDistance(pts, x, y, radius)) {
      const p = byId.get(id);
      if (!this._view.pointHidden(p.world, p.node)) return id;
    }
    return null;
  }

  // Tap = moved < 5 px; hold 500 ms (not moved) = hold action. Orbit still starts from the canvas.
  _objectDown(e, canvas) {
    if (this._editing && this._edit?.tab === 'furniture') return;
    if (this._ambientWakeEvents.has(e)) return;
    if (this._editing && this._edit?._wallSurfacePick?.()) return;
    if (this._gesture) { this._endGesture(); return; } // a second finger: pinch / orbit, no tap
    const path = e.composedPath();
    if (this._popup.closedBy === e || this._devicePopup.closedBy === e) { // a dismissing tap never activates a device
      if (e.target !== canvas && !path.some((n) => n.classList && n.classList.contains('toolbar'))) e.stopPropagation();
      return;
    }
    if (!this._objectTapsOn() || e.button !== 0 || !e.isPrimary) return;
    if ((this._popup.el && path.includes(this._popup.el)) || (this._devicePopup.el && path.includes(this._devicePopup.el))
      || path.some((n) => n.dataset && n.dataset.taylors3dUi !== undefined)) return;
    const id = this._objectHit(e.clientX, e.clientY, e.pointerType === 'touch' ? OBJECT_HIT_PX.touch : OBJECT_HIT_PX.mouse, this._editing);
    if (!id) return; // markers and the model as before
    if (e.target !== canvas) e.stopPropagation(); // the object wins over a marker under the finger
    const g = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, long: false };
    // edit mode (Objects tab): a tap selects the object's row; no hold action
    if (!this._editing) {
      g.timer = setTimeout(() => {
        g.long = true;
        g.timer = null;
        this._runObjectAction(id, 'hold');
      }, LONG_PRESS_MS);
    }
    g.move = (ev) => {
      if (ev.pointerId === g.pointerId && Math.hypot(ev.clientX - g.x, ev.clientY - g.y) >= CLICK_SLOP_PX) this._endGesture();
    };
    g.up = (ev) => {
      if (ev.pointerId !== g.pointerId) return;
      const tap = !g.long && Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < CLICK_SLOP_PX;
      this._endGesture();
      if (tap) {
        if (this._editing) this._edit.selectObject(id);
        else this._runObjectAction(id, 'tap');
      }
    };
    g.cancel = () => this._endGesture();
    g.menu = (ev) => ev.preventDefault(); // a touch hold opens no context menu
    window.addEventListener('pointermove', g.move, true);
    window.addEventListener('pointerup', g.up, true);
    window.addEventListener('pointercancel', g.cancel, true);
    window.addEventListener('contextmenu', g.menu, true);
    this._gesture = g;
  }

  _endGesture() {
    const g = this._gesture;
    if (!g) return;
    this._gesture = null;
    clearTimeout(g.timer);
    window.removeEventListener('pointermove', g.move, true);
    window.removeEventListener('pointerup', g.up, true);
    window.removeEventListener('pointercancel', g.cancel, true);
    // the contextmenu of a touch hold follows the pointerup
    setTimeout(() => window.removeEventListener('contextmenu', g.menu, true), 400);
  }

  // Objects tab "Test": the tap toggle (own entity, else the group controller). False when nothing can be toggled.
  testObject(id) {
    const o = this._objects && this._objects.objectAt(id);
    if (!o || !this._hass) return false;
    const target = actionTarget(o.obj, o.binding, this._groups || {}, this._hass.states);
    const call = this._objectToggleCall(target);
    if (!call) return false;
    this._hass.callService(...call);
    return true;
  }

  _objectToggleCall(target) {
    if (!target || !this.isConnected || this._loading || this._hass?.connection?.connected === false || typeof this._hass?.callService !== 'function') return null;
    const metadata = entityMetadata(this._hass, target);
    if (!metadata.available || metadata.hidden || metadata.disabled || metadata.category) return null;
    const call = toggleCall(target);
    return this._hass.services?.[call[0]]?.[call[1]] ? call : null;
  }

  // toggle: own entity, else the group controller; nothing usable (missing / unavailable): the popup says so.
  _runObjectAction(id, which) {
    if (!this._layout) return;
    const o = this._objects.objectAt(id);
    if (!o || !this._hass) return;
    const action = objectAction(o.obj, which);
    if (action === 'none') return;
    // Opening a bound camera must retain that camera even when its stream is unavailable.
    // Falling back to a group light here would silently open the wrong device's controls.
    const cameraTap = which === 'tap' && this._config.device_tap_action !== 'toggle'
      && typeof o.binding?.entity === 'string' && o.binding.entity.startsWith('camera.');
    const target = cameraTap ? o.binding.entity : actionTarget(o.obj, o.binding, this._groups || {}, this._hass.states);
    const st = target && this._hass.states[target];
    const usable = st && st.state !== 'unavailable' && st.state !== 'unknown';
    if (which === 'tap' && this._config.device_tap_action !== 'toggle' && target) {
      this._popup.close();
      const a = (this._objects.displayAnchors ? this._objects.displayAnchors() : this._objects.anchors()).find((x) => x.id === id);
      this._devicePopup.update(this._hass);
      this._devicePopup.showMarker({ name: o.obj.label || o.obj.id, entityId: target,
        entities: (o.chain && o.chain.entities || [target]).map((eid) => ({ eid })) }, a && this._view.projectWorld(a.world));
      return;
    }
    this._devicePopup.close();
    if (action === 'popup' || !usable) {
      const a = (this._objects.displayAnchors ? this._objects.displayAnchors() : this._objects.anchors()).find((x) => x.id === id);
      if (a) this._popup.open(o.obj, a.world);
    } else if (action === 'toggle') {
      const call = this._objectToggleCall(target);
      if (call) this._hass.callService(...call);
    }
    else this._moreInfo(target);
  }

  _refreshMarkerNames() {
    const current = new Map(buildMarkers(this._hass, this._layout, { group_by: this._config.group_by })
      .map((marker) => [marker.id, marker]));
    // Keep the current objects captured by native marker gestures, their source
    // IDs, placement and DOM nodes. Only genuine HA-derived names change.
    for (const marker of this._markers) {
      const next = current.get(marker.id);
      if (next?.entityId === marker.entityId) marker.name = next.name;
      else if (marker.id === this._mowerMarkerId) marker.name = entityMetadata(this._hass, marker.entityId).name;
    }
  }

  _buildMarkers() {
    // Room/device membership belongs to its selected snapshot. House categories
    // re-resolve current membership for every update and action instead.
    if (!this._devicePopup.isCategoryOpen) this._devicePopup.close();
    const h = this._hass;
    // a device bound to a model object has no marker: the object is the control (glow sprite too).
    // With group_by: device the marker stands for the device's primary entity, so a bound primary
    // light hides the whole device marker (its other entities, e.g. a power sensor, included).
    const bound = this._boundEntities;
    this._markers = buildMarkers(h, this._layout, { group_by: this._config.group_by }).filter((m) => !bound.has(m.entityId));
    this._positions = markerPositions(this._markers, { ...this._layout, rooms: this._allRooms() }, h, this._floors, (pin, fid) => this._attachAt(pin, fid));

    // the mower's device marker follows the live position instead of being auto placed
    const cfg = this._layout.mower;
    this._mowerMarkerId = null;
    const mowerObject = !!(this._objects && this._objects.mowerBound());
    if (cfg && cfg.entity) {
      const reg = h.entities && h.entities[cfg.entity];
      const devId = reg && reg.device_id;
      let mm = this._markers.find((m) => (devId ? m.deviceId === devId : m.entityId === cfg.entity));
      if (mowerObject) {
        // the mower model replaces the mower marker
        if (mm) { this._markers = this._markers.filter((m) => m !== mm); this._positions.delete(mm.id); }
        mm = null;
      } else if (!mm) {
        mm = { id: 'mower:' + cfg.entity, entityId: cfg.entity, domain: cfg.entity.split('.')[0],
          name: entityMetadata(h, cfg.entity).name, entities: [], secondaryId: null };
        this._markers.push(mm);
      }
      if (mm) {
        this._mowerMarkerId = mm.id;
        const live = this._mowerLive;
        if (live && live.floorId) this._positions.set(mm.id, { x: live.x, y: live.y, z: MOWER_Z, floorId: live.floorId, auto: false, live: true });
        else this._positions.delete(mm.id);
      }
    }

    // New state-only entities still belong in the editor/metadata list. If they have
    // no plan position, their arrival must not recreate every visible marker.
    const renderKey = JSON.stringify(this._markers.filter((marker) => this._positions.has(marker.id)).map((marker) => {
      const p = this._positions.get(marker.id);
      // Names belong to DOM captions/accessibility, not marker geometry or lights.
      return [marker.id, marker.entityId, marker.domain, marker.deviceClass, marker.areaId,
        marker.secondaryId, (marker.entities || []).map((entity) => entity.eid || entity), p, this._view.floorElevation(p.floorId)];
    }));
    if (this._markerRenderKey === renderKey) { this._applyMarkerStates(); return; }
    this._markerRenderKey = renderKey;
    this._markerEls.clear();
    const list = [];
    for (const m of this._markers) {
      const p = this._positions.get(m.id);
      if (!p) continue;
      const element = this._markerElement(m);
      this._markerEls.set(m.id, element);
      list.push({ id: m.id, element, ...p });
    }
    this._view.setMarkers(list);
    this._applyMarkerStates();
  }

  // Plan position of a marker attached to a model object (its anchor + offset), null when the object is not there.
  _attachAt(pin, floorId) {
    const a = this._objects && this._objects.anchorOf(pin.attach);
    return a ? attachedPosition(a, pin.offset, this._view.floorElevation(floorId)) : null;
  }

  // Attached markers follow their object (mower pose, model placement): move the ones that moved.
  _refreshAttached() {
    const pins = (this._layout && this._layout.pins) || {};
    if (!this._positions || !this._view) return;
    for (const [id, pos] of this._positions) {
      const pin = pins[id];
      if (!pin || !pin.attach) continue;
      const at = this._attachAt(pin, pos.floorId);
      if (!at) {
        if (!pos.attached) continue;
        // the object vanished: back to the pin's stored (fallback) position
        const z = pin.z ?? 1.2;
        this._positions.set(id, { x: pin.x, y: pin.y, z, floorId: pos.floorId, auto: false });
        this._view.moveMarker(id, pin.x, pin.y, z, pos.floorId);
        continue;
      }
      if (pos.attached && Math.abs(at.x - pos.x) < 1e-6 && Math.abs(at.y - pos.y) < 1e-6 && Math.abs(at.z - pos.z) < 1e-6) continue;
      this._positions.set(id, { ...pos, x: at.x, y: at.y, z: at.z, attached: pin.attach });
      this._view.moveMarker(id, at.x, at.y, at.z, pos.floorId);
    }
  }

  _markerElement(m) {
    const el = document.createElement('div');
    el.className = 'fp-marker ' + m.domain;
    el.innerHTML = '<div class="fp-dot"><ha-icon></ha-icon></div><div class="fp-val"></div>';
    el.title = m.name;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', localize(this._hass, 'marker.openControls', { name: m.name }, 'Open {name} controls'));
    el.addEventListener('keydown', (e) => {
      if (!this._editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); this._tap(m); }
    });
    let start = null, timer = null, long = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
      if (this._editing) {
        this._edit.markerDown(m, e);
        return;
      }
      if (e.button !== 0) return;
      e.stopPropagation();
      start = [e.clientX, e.clientY];
      long = false;
      timer = setTimeout(() => { long = true; this._moreInfo(m.entityId); }, LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', (e) => {
      if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) >= CLICK_SLOP_PX) cancel();
    });
    el.addEventListener('pointerup', (e) => {
      const wasClick = start && !long && timer && Math.hypot(e.clientX - start[0], e.clientY - start[1]) < CLICK_SLOP_PX;
      cancel();
      start = null;
      if (wasClick) this._tap(m);
    });
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  _refreshStates() {
    const h = this._hass;
    const glows = [];
    for (const m of this._markers) {
      const el = this._markerEls.get(m.id);
      if (!el) continue;
      const st = h.states[m.entityId];
      const g = m.domain === 'light' ? lightGlow(st) : null;
      el.classList.toggle('active', m.domain === 'light' ? !!g : isActive(st));
      el.classList.toggle('unavailable', !st || st.state === 'unavailable');
      const icon = el.querySelector('ha-icon');
      const ic = m.id === this._mowerMarkerId ? 'mdi:robot-mower' : iconFor(h, m.entityId);
      if (icon.getAttribute('icon') !== ic) icon.setAttribute('icon', ic);
      const own = displayValue(h, m.entityId);
      el.querySelector('.fp-val').textContent = own || (m.secondaryId ? displayValue(h, m.secondaryId) : '');
      const name = entityMetadata(h, m.entityId).name;
      el.title = m.name + (name && name !== m.name ? ' – ' + name : '');
      el.setAttribute('aria-label', localize(this._hass, 'marker.openControls', { name: m.name }, 'Open {name} controls'));

      if (m.domain === 'light') {
        el.style.setProperty('--fp-light', g ? `rgb(${g.rgb.join(',')})` : '');
        const p = this._positions.get(m.id);
        const preview = this._lightPreview?.get(m.entityId)?.appearance;
        const drawnGlow = preview ? preview.output > 0 ? { rgb: preview.color, strength: 0.25 + 0.75 * preview.level } : null : g;
        if (drawnGlow && p) glows.push({ id: m.id, x: p.x, y: p.y, floorId: p.floorId, ...drawnGlow });
      }
    }
    this._view.setGlows(glows);
  }

  _tap(m) {
    if (!this._layout) return;
    // A retained marker's event listener can predate a name-only registry update.
    // Resolve its current metadata and reject a queued click for a removed marker.
    m = (this._markers || []).find((current) => current.id === m.id);
    if (!m) return;
    this._stopScenePreview('device selected');
    if (this._config.device_tap_action !== 'toggle') {
      this._popup.close();
      const p = this._positions.get(m.id);
      this._devicePopup.update(this._hass);
      this._devicePopup.showMarker(m, p && this._view.screenPoint(p.x, p.y, p.z || 0, p.floorId));
    } else if (TAP_TOGGLE.has(m.domain)) {
      this._hass.callService(m.domain, 'toggle', { entity_id: m.entityId });
    } else {
      this._moreInfo(m.entityId);
    }
  }

  _moreInfo(entityId) {
    this._suspendAmbient('device details opened');
    this._stopScenePreview('device details opened');
    this._popup.close();
    this._devicePopup.close();
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  _navigationFloors() {
    if (this._floorOnly) return [this._floor];
    const state = this._sectionActive() ? this._sectionState() : this._viewState;
    return !state || state.allFloors ? 'all' : state.floors;
  }

  _navigationRooms() {
    if (!this._layout) return [];
    const floors = this._navigationFloors();
    const state = this._sectionActive() ? this._sectionState() : this._viewState;
    let modelRooms = null;
    if (state && state.effective && this._index) {
      modelRooms = new Set();
      this._index.nodes.forEach((node, i) => {
        if (state.effective[i] && node.tag && ['room', 'zone'].includes(node.tag.kind)) modelRooms.add(node.tag.id);
      });
    }
    return (this._roomList || []).filter((r) => (floors === 'all' || floors.includes(r.floorId))
      && (!modelRooms || !r.room.modelId || modelRooms.has(r.room.modelId)));
  }

  // A stationary tap on room geometry opens controls; orbiting and device taps do not.
  _roomDown(e) {
    if (this._ambientWakeEvents.has(e)) return;
    if (!this._layout || this._editing || this._gesture || e.button !== 0 || !e.isPrimary || this._devicePopup.closedBy === e || this._popup.closedBy === e) return;
    const g = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    g.move = (ev) => { if (ev.pointerId === g.pointerId && Math.hypot(ev.clientX - g.x, ev.clientY - g.y) >= CLICK_SLOP_PX) this._endGesture(); };
    g.up = (ev) => {
      if (ev.pointerId !== g.pointerId) return;
      const tap = Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < CLICK_SLOP_PX;
      this._endGesture();
      if (tap) this._openRoomAt(ev.clientX, ev.clientY);
    };
    g.cancel = () => this._endGesture();
    g.menu = () => {};
    window.addEventListener('pointermove', g.move, true);
    window.addEventListener('pointerup', g.up, true);
    window.addEventListener('pointercancel', g.cancel, true);
    this._gesture = g;
  }

  _roomShortcutData(roomId) {
    const descriptor = (source) => {
      try { return Object.getOwnPropertyDescriptor(source || {}, 'room_actions'); }
      catch { return {}; }
    };
    const saved = descriptor(this._layout) ?? descriptor(this._config);
    // Imported settings are data: an accessor cannot run before the strict reader
    // inspects them. Own shared null/undefined still take precedence over a card.
    const settings = saved === undefined ? undefined
      : Object.hasOwn(saved, 'value') ? saved.value : Symbol('unreadable room shortcuts');
    return roomActionsFor({ hass: this._hass, settings, roomId,
      rooms: (this._roomList || []).map((entry) => entry.room) });
  }

  _runRoomShortcut(roomId, actionId) {
    const selection = this._devicePopup?._selection;
    if (!this._devicePopup?.isOpen || selection?.kind !== 'room' || selection.room?.id !== roomId || this._editing || this._loading)
      return Promise.reject(new Error('Reopen the current room controls and choose the shortcut deliberately.'));
    const current = this._roomShortcutData(roomId).actions.find((action) => action.id === actionId);
    if (!current?.available) return Promise.reject(new Error(current?.issue || 'This room shortcut is no longer available.'));
    return this._hass.callService(current.domain, current.service, { entity_id: current.entityId });
  }

  _openRoomAt(x, y) {
    const rooms = this._navigationRooms();
    const hit = this._view.pickModel(x, y);
    let selected = hit && ['room', 'zone'].includes(hit.kind) ? rooms.find((r) => r.room.modelId === hit.id) : null;
    if (!selected && hit) {
      if (!hit.hit.up) return; // a facade wall is not a room's floor
      const [px, height, pz] = hit.hit.point;
      if (this._floorPresentationActive()) {
        const fid = this._view.floorForModelNode?.(hit.hit.object);
        if (!fid) return;
        const source = this._view.displayWorldToSource([px, height, pz], fid);
        if (!source.ok) return;
        selected = roomAtPlan(rooms, [source.point[0], -source.point[2]], fid);
      } else {
        const fid = floorAtHeight((this._floors || []).map((f) => ({ id: f.id, elevation: this._view.floorElevation(f.id) })), height);
        selected = roomAtPlan(rooms, [px, -pz], fid);
      }
    } else if (!selected && !this._view.model) {
      const floors = (this._floors || []).slice().sort((a, b) => this._floorPresentationActive()
        ? this._view.displayFloorElevation(b.id) - this._view.displayFloorElevation(a.id) : b.elevation - a.elevation);
      for (const f of floors) {
        const point = this._floorPresentationActive() ? this._view.displayPlanPoint(x, y, f.id)
          : this._view.planPoint(x, y, this._view.floorElevation(f.id));
        if (point) selected = roomAtPlan(rooms, point, f.id);
        if (selected) break;
      }
    }
    if (!selected) return;
    this._stopScenePreview('room selected');
    this._selectedRoomId = selected.room.id;
    this._popup.close();
    this._devicePopup.update(this._hass);
    // Include devices represented by bound model objects as well as standalone markers.
    this._devicePopup.showRoom({ ...selected.room, name: selected.name },
      buildMarkers(this._hass, this._layout, { group_by: this._config.group_by }), [x, y]);
    this._syncMiniMap();
  }

  _focusPlan(point) {
    this._suspendAmbient('map selected');
    this._presetEvents.interrupt();
    if (this._editing || !this._view) return;
    this._stopScenePreview('map selected');
    this._view.stopCameraMotion();
    this._popup.close();
    this._devicePopup.close();
    if (point.floorId && this._floor !== point.floorId) this._setFloor(point.floorId);
    const displayed = this._displayFeaturePosition({ ...point, elevation: this._view.floorElevation(point.floorId) });
    if (!displayed) return;
    if (this._mode === 'top') {
      const c = this._view.getTopCamera();
      if (c) this._view.setTopCamera({ ...c, center: [displayed.x, displayed.y] });
    } else {
      const c = focusCamera(this._view.getCamera(), displayed);
      if (c) this._view.setCamera(c);
    }
    this._selectedRoomId = point.roomId || null;
    this._syncMiniMap();
  }

  _configureMiniMap() {
    if (!this._stage) return;
    const size = Math.max(120, Math.min(260, Number(this._config.mini_map_size) || 180));
    const corner = this._config.mini_map_position === 'top-left' ? 'top-left' : 'top-right';
    const key = `${corner}|${size}`;
    if (this._miniMapKey !== key || !this._miniMap) {
      if (this._miniMap) this._miniMap.dispose();
      this._miniMap = new MiniMap(this._stage, {
        size, corner, returnFocus: () => this._miniMapBtn, onFocus: (point) => {
          // Security validates the original source intent before its own focus
          // transition. Other map targets retain the existing focus callback.
          if (!/^security:([a-z0-9_-]+):(\d+)$/.test(point.markerId || '')) this._focusPlan(point);
        },
        cameraForFloor: (snapshot, floorId) => this._miniMapSourceCamera(snapshot, floorId),
        onMarker: (id, point) => {
          const security = /^security:([a-z0-9_-]+):(\d+)$/.exec(id);
          if (security) {
            this._syncSecurity();
            const record = this._currentPlanSecurityRecord(security[1], { entity: point.entityId, generation: Number(security[2]) });
            if (!record) return;
            this._focusPlan(point);
            this._showPlanSecurityEntity(record.id, { entity: record.entity, generation: this._securitySessionGeneration });
          }
          else if (point.alert) this._showMapAlert(id, point);
          else if (point.tracked) this._showTrackedEntity(id);
        },
        onVisibilityChange: (visible) => { this._miniMapVisible = visible; this._syncToolbar(); },
      });
      this._miniMapKey = key;
    }
    this._syncMiniMap();
  }

  _syncMiniMap() {
    // The normal HA update already reaches this hook, including locale-only
    // changes. Relabel controls without scheduling another render or resize.
    this._syncToolbarLabels();
    this._syncFloorPresentation();
    this._syncSecurity();
    this._syncTracking();
    this._syncWeather();
    if (!this._miniMap || !this._view) return;
    this._syncStatus();
    this._syncCameraCoverage();
    const markers = [...this._markers], positions = new Map(this._positions || []);
    // Bound GLB lamps replace ordinary markers, but still belong on the overview.
    for (const anchor of this._objects ? this._objects.anchors() : []) {
      const object = this._objects.objectAt(anchor.id);
      if (!object || !object.binding || object.binding.hidden || !nodeShown(object.obj.node)) continue;
      const entity = actionTarget(object.obj, object.binding, this._groups, this._hass && this._hass.states);
      if (!entity) continue;
      const floorId = this._sourceObjectFloor(object, anchor.world);
      if (!floorId) continue;
      const id = `object:${anchor.id}`;
      markers.push({ id, entityId: entity, name: entityMetadata(this._hass, entity).name || object.obj.label || object.obj.id });
      positions.set(id, { x: anchor.world.x, y: -anchor.world.z, floorId });
    }
    this._miniMap.setVisible(this._miniMapVisible);
    this._miniMap.update({ rooms: this._navigationRooms(), floors: this._floors || [], visibleFloors: this._navigationFloors(),
      positions, markers, markerStates: this._view._markerStates, states: this._hass && this._hass.states, hass: this._hass,
      trackedMarkers: [...this._trackingData.miniMap, ...this._securityPlanData.miniMap.map((marker) => ({ ...marker,
        id: `${marker.id}:${this._securitySessionGeneration}` }))],
      alertMarkers: this._alertMapMarkers(),
      camera: this._view.getCamera(), topCamera: this._view.getTopCamera(), mode: this._mode, editing: this._editing,
      selectedRoomId: this._selectedRoomId });
  }

  // One HA floor (edit mode): the view linked to just that floor, else that floor on its own
  // with the model's level rules. Frames the floor.
  _setFloor(id) {
    this._suspendAmbient('floor changed');
    this._stopScenePreview('floor changed');
    const vis = this._views.filter((v) => !v.hidden);
    // a storey view linked to just that floor wins over an overview (Exterior) linked to it
    const only = (v) => { const f = this._stateFor(v).floors; return f.length === 1 && f[0] === id; };
    const match = id === 'all' ? vis.find((v) => v.id === 'all')
      : vis.find((v) => only(v) && !this._stateFor(v).overview) || vis.find(only);
    if (match) {
      this._setView(match.id);
      if (this._view.model && !match.camera) this._view.fit();
      return;
    }
    if (this._section) this._dropSection();
    this._floorOnly = id;
    this._floor = id;
    this._view.setVisibleFloor(id);
    this._view.applyModelVisibility(null, null);
    this._view.setCut(undefined);
    this._view.setMarkerStates(null);
    this._view.fit();
    this._syncToolbar();
  }

  _setMode(mode) {
    this._suspendAmbient('mode changed');
    this._stopScenePreview('mode changed');
    if (!this._selectingPreset) this._presetEvents.interrupt();
    this._popup.close();
    this._devicePopup.close();
    if (mode !== '3d' && this._section) this.setSection(false, { camera: false });
    this._mode = mode;
    this._view.setMode(mode);
    const v = this.currentView(), own = v && !this._floorOnly ? v : null;
    if (mode === 'top' && own && own.camera_top) this._view.setTopCamera(this.viewTopCamera(own), { instant: true });
    // back in 3D: the view's saved camera, else the camera before Top (setMode framed it otherwise)
    else if (mode === '3d') {
      const cam = (own && own.camera && this.viewCamera(own)) || this._view.lastCamera3d;
      if (cam) this._view.setCamera(cam, { instant: true });
    }
    this._syncToolbar();
    if (this._editing && this._edit.tab === 'views') this._edit.render();
  }

  _paintDayBtn() {
    const icon = { auto: 'mdi:theme-light-dark', day: 'mdi:white-balance-sunny', night: 'mdi:weather-night' }[this._skyMode];
    const el = this._dayBtn.querySelector('ha-icon');
    if (el && el.getAttribute('icon') !== icon) el.setAttribute('icon', icon);
    this._dayBtn.title = localize(this._hass, 'toolbar.dayNight', { mode: localize(this._hass, `toolbar.sky.${this._skyMode}`, {}, this._skyMode) });
  }

  _syncToolbarLabels() {
    this._showNotice();
    if (this._empty) {
      const caption = localize(this._hass, 'plan.empty');
      if (this._empty.textContent !== caption) this._empty.textContent = caption;
    }
    if (!this._toolbar) return;
    const key = JSON.stringify([localeKey(this._hass), !!this._editing, this._skyMode]);
    if (this._toolbarTextNode === this._toolbar && this._toolbarTextKey === key) return;
    this._toolbarTextNode = this._toolbar; this._toolbarTextKey = key;
    this._toolbar.setAttribute('aria-label', localize(this._hass, 'toolbar.aria'));
    this._toolbar.querySelector('.seg')?.setAttribute('aria-label', localize(this._hass, 'toolbar.mode.aria'));
    for (const button of this._toolbar.querySelectorAll('[data-mode]')) button.textContent = localize(this._hass, `toolbar.mode.${button.dataset.mode}`);
    for (const [id, message] of [['reset', 'toolbar.reset'], ['section', 'toolbar.section'], ['minimap', 'toolbar.miniMapToggle'], ['edit', 'toolbar.edit']]) {
      const button = this._toolbar.querySelector(`[data-bubble="${id}"]`);
      if (button) { button.title = localize(this._hass, message); button.setAttribute('aria-label', button.title); }
    }
    const editText = this._editBtn?.querySelector('span');
    if (editText) editText.textContent = localize(this._hass, this._editing ? 'common.done' : 'common.edit');
    if (this._dayBtn) { this._paintDayBtn(); this._dayBtn.setAttribute('aria-label', this._dayBtn.title); }
  }

  // Auto reads sun.sun; setSky only when night moved > 0.01 or the sun > 1 degree since the last call.
  // Sun / moon sprites: with the sun change, else the moon at most every 60 s (option sky_bodies).
  _applySky(force) {
    const v = this._view;
    if (!v || !v.model) return;
    const north = v.model.north || 0, rot = this._modelAlign().rotation || 0;
    let sky = { night: 0, sunDir: null }, sunBody = null, auto = false;
    if (this._skyMode === 'night') sky = { night: 1, sunDir: null };
    else if (this._skyMode === 'day') sunBody = { dir: sunVector(...DAY_SUN, north, rot) };
    else {
      auto = true;
      const reading = readSunState(this._hass);
      const { elevation: el, azimuth: az } = reading;
      if (reading.status === 'ready') {
        const dir = sunVector(az, el, north, rot);
        sky = { night: nightFactor(el), sunDir: clampSunDir(dir), sun: sunStrength(el) };
        sunBody = { dir };
      }
    }
    const l = this._skyLast;
    const same = !force && l && Math.abs(l.night - sky.night) <= 0.01 && Math.abs((l.sun ?? 1) - (sky.sun ?? 1)) <= 0.01 && !!l.sunDir === !!sky.sunDir
      && (!sky.sunDir || Math.acos(Math.max(-1, Math.min(1, l.sunDir[0] * sky.sunDir[0] + l.sunDir[1] * sky.sunDir[1] + l.sunDir[2] * sky.sunDir[2]))) <= Math.PI / 180);
    const now = this._now();
    const location = auto ? readHaLocation(this._hass) : null;
    const locationKey = location ? JSON.stringify([location.status, location.latitude, location.longitude]) : null;
    const locationChanged = auto && locationKey !== this._skyLocationKey;
    if (same && !locationChanged && !(auto && now - (this._moonAt ?? -Infinity) >= MOON_EVERY_MS)) return;
    if (!same) {
      this._skyLast = sky;
      this._daylight = sky.night < 0.5;
      v.setSky(sky);
    }
    let moonBody = null;
    if (this._skyMode === 'night') moonBody = { dir: sunVector(...NIGHT_MOON, north, rot), phase: 0.4, illumination: 0.8 };
    else if (auto) {
      const m = location.status === 'ready' ? moonPosition(now, location.latitude, location.longitude) : null;
      if (m) moonBody = { dir: sunVector(m.azimuth, m.elevation, north, rot), phase: m.phase, illumination: m.illumination, latitude: location.latitude };
    }
    this._skyLocationKey = locationKey;
    this._moonAt = now;
    v.setSkyBodies({ sun: sunBody, moon: moonBody, north: sunVector(0, 0, north, rot), on: this._config.sky_bodies !== false });
  }

  // Current time; tests set window.__demoNow (Date or ms).
  _now() {
    const t = typeof window !== 'undefined' ? window.__demoNow : undefined;
    if (t !== undefined && t !== null) return t instanceof Date ? t.getTime() : Number(t);
    return Date.now();
  }

  _syncToolbar() {
    this._syncToolbarLabels();
    const hasModel = !!(this._view && this._view.model);
    // without a model: one chip per floor plus All (not while editing), shown with 2+ floors
    const views = this._views.filter((v) => !v.hidden && (hasModel || !this._editing || v.id !== 'all'));
    const show = hasModel ? views.length > 1 : this._views.filter((v) => !v.hidden && v.id !== 'all').length > 1;
    const chips = new Map([...this._chips.children].map((button) => [button.dataset.view, button]));
    const desired = [];
    if (show) {
      for (const v of views) {
        const btn = chips.get(v.id) || document.createElement('button');
        btn.className = 'chip' + (v.id === this._viewId && !this._floorOnly ? ' on' : '');
        btn.dataset.view = v.id;
        btn.dataset.taylors3dTone = 'floor';
        btn.setAttribute('aria-pressed', String(v.id === this._viewId && !this._floorOnly));
        btn.textContent = v.label;
        desired.push(btn);
      }
    }
    for (const button of chips.values()) if (!desired.includes(button)) button.remove();
    let nextChip = this._chips.firstElementChild;
    for (const button of desired) { if (button !== nextChip) this._chips.insertBefore(button, nextChip); nextChip = button.nextElementSibling; }
    for (const btn of this.shadowRoot.querySelectorAll('.seg button')) {
      btn.classList.toggle('on', btn.dataset.mode === this._mode);
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === this._mode));
    }
    this._dayBtn.hidden = !(this._view && this._view.model);
    if (this._section && (!this._mb || !this._index || !hasModel)) this._dropSection();
    if (this._sectionBtn) {
      this._sectionBtn.hidden = !(this._view && this._view.model && this._mode === '3d');
      this._sectionBtn.classList.toggle('on', !!this._section);
    }
    this._paintDayBtn();
    this._dayBtn.setAttribute('aria-label', this._dayBtn.title);
    this._editBtn.hidden = !(this._hass && this._hass.user && this._hass.user.is_admin);
    this._editBtn.querySelector('span').textContent = localize(this._hass, this._editing ? 'common.done' : 'common.edit');
    this._miniMapBtn.setAttribute('aria-pressed', String(this._miniMapVisible));
    this._miniMapBtn.classList.toggle('on', this._miniMapVisible);
    this._miniMapBtn.disabled = !!this._editing || !(this._roomList && this._roomList.length);
    const controls = bubbleControls(this._config);
    const actions = this._toolbar.querySelector('.bubble-actions');
    for (const control of actions.querySelectorAll('[data-bubble]')) {
      const id = control.dataset.bubble;
      let available = true;
      if (id === 'edit') available = !!(this._hass && this._hass.user && this._hass.user.is_admin);
      if (id === 'section') available = hasModel && this._mode === '3d';
      if (id === 'daynight') available = hasModel;
      control.hidden = !(available && (controls.includes(id) || (id === 'edit' && this._editing)));
    }
    // Reordering an already correctly placed native button would blur it.
    const ordered = [...actions.children].filter((node) => !controls.includes(node.dataset.bubble))
      .concat(controls.map((id) => actions.querySelector(`[data-bubble="${id}"]`)));
    let nextAction = actions.firstElementChild;
    for (const node of ordered) { if (node !== nextAction) actions.insertBefore(node, nextAction); nextAction = node.nextElementSibling; }
    this._toolbar.hidden = this._config.show_bubble_bar === false && !this._editing;
    this._syncScenePreviews();
    this._syncMiniMap();
    this._syncHouseShell();
    requestAnimationFrame(() => this.isConnected && this._resize());
    if (this._empty && this._editing) this._empty.hidden = true;
  }
}

if (!customElements.get('taylors3d-card')) {
  customElements.define('taylors3d-card', Taylors3dCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'taylors3d-card',
    name: "Taylor's 3D",
    description: '3D floorplan with automatically placed devices',
    preview: false,
  });
  console.info(`%c taylors3d-card ${VERSION} `, 'background:#03a9f4;color:#fff;border-radius:3px');
}
