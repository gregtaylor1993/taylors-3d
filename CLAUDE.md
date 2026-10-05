# Taylor's 3D — Home Assistant 3D floorplan

Custom Lovelace card (Three.js) for a home floorplan. Goal: map HA areas to rooms
once, then every device assigned to an area shows up on the plan automatically, positioned
by device type, with mouse-drag for exact placement. Plus Sunseeker robot mower live
position and map overlay.

## Stack
- Vanilla custom element (no Lit), Three.js 0.169, esbuild bundle -> `dist/taylors3d-card.js`
- OrbitControls, CSS2DRenderer (markers/labels as DOM, so `<ha-icon>` works), GLTFLoader
- Companion integration `custom_components/taylors3d/` for shared server-side storage
- Respect HA theme CSS vars (--card-background-color, --primary-color, --primary-text-color,
  --divider-color, --state-light-active-color). Light and dark themes must both look right.

## Already written (src/)
- `placement.js` — polygon geometry, type rules (domain/device_class -> anchor + height),
  `autoPlace(room, markers, roomHeight)`. Anchors: center (ceiling grid), wall, corner, door.
- `registry.js` — builds markers from `hass.entities` / `hass.devices` / `hass.areas` /
  `hass.floors` (live, available to non-admin users, no websocket calls needed). Groups
  entities per device, picks primary entity by domain priority, skips config/diagnostic and
  hidden entities. Icons, active state, value display.
- `mower.js` — read position from entity (gps: latitude/longitude attrs or "lat,lon" state;
  xy: configurable attributes), calibration: 1 pt translate, 2 pts similarity, 3+ pts
  least-squares affine. `overlayUrl()` for image./camera. entities via entity_picture.
- `storage.js` — LayoutStore: companion integration WS -> `frontend/set_user_data` -> localStorage.
- `device-popup.js` — room/device panels; explicit quick controls and HA All controls fallback.
- `light-state.js` — strict finite current light appearance and independently reported modern capabilities. Use HA-derived RGB; never guess XY gamut or Kelvin bounds. Fixed legacy/non-colour display fallback is explicit. Model lamps, floor glows and panel readings share this reader. Controls revalidate current membership/source/capabilities/services/connection; input alone sends nothing.
- `model-rendering.js` / `model-rendering-editor.js` — saved visual-only model shadow/lamp policy; shared layout precedes card config. Default behavior is unchanged. Shadow-off blocks both sun/pool requests through load/movement/theme/sky changes; re-enable seeds current maps once. Preserve actual light controls and authored materials. Read-only material/AO/unlit/UV counts cannot prove a bake. Save/Cancel/Undo follow existing layout history; focused drafts survive HA updates.
- `scene-preview.js` / `scene-preview-rendering.js` — opt-in explicit visual light targets and current-light capture; never infer a scene definition or modify hass.states. A private compiled Map drives only light/light_strip rendering in the existing fixed pool. Public chains/results/parts, markers, source readers and device panels stay actual. Stop restores latest actual HA readings; real relays and unmapped lights still gate. Only deliberate controller.activate sends one current scene.turn_on; unknown scene timestamps are legitimate. Revalidate exact source, metadata, capabilities, user, service and connection.
- `scene-preview-editor.js` / `scene-preview-bar.js` — admin draft editor in Scenes and saved preview controls in the bubble bar. Stable native controls, explicit Save/Cancel/Undo, no actions on hover/draft/Preview/Stop. Activate is independent of incomplete visual targets and uses only the saved scene link. Reject stale gestures through recovery. Root token ownership ignores old clear callbacks; hide/offscreen/disconnect/view/model/history/real device interaction clear overrides, with no new timer or renderer.
- `ambient-idle.js` / `ambient-idle-editor.js` — opt-in pure idle policy/controller and Edit → Idle drafts. Existing View RAF alone ticks it; rotation uses one bounded OrbitControls update, raw camera ownership and restoration before capture-phase interaction. First rotating-surface tap wakes only. Automation captures its return camera after restoration without interrupting the request. Genuine visibility/editor/popup/preview/alert/motion/held-gesture guards rearm the full delay; unrelated HA readings preserve it. Dim-only is scene CSS, preserving prior filter/priority, never a WebGL dirty request or physical backlight action. Actual strict sun and bounded cached HA-zone local-time readings are separate from manual sky/theme. Shared settings precede card config; unknown imports and focused drafts survive.
- `minimap.js` — north-up SVG mini-map sharing room outlines and live marker/model-object positions.
- `wall-presentation.js` / `wall-presentation-rendering.js` — opt-in exact wall meshes with normal/fade/cutaway/glass appearance; deliberate node-local picked faces and resolved floor elevations. Owned per-mesh material copies preserve authored shared maps and exact baseline references, compose global Section/floor clipping and current ghost opacity, and release before source teardown. Camera-side hysteresis freezes during ambient orbit only; reduced motion snaps appearance. Per-face picking and occlusion follow current fade/cut, while shadows refresh only semantic cut changes when authored clipShadows requires it. Undefined/disabled/equal data adds no rendering work.
- `wall-presentation-editor.js` — Edit → Model wall drafts. Clean active-admin preparation temporarily reads separate original GLB meshes without saving a merge option. Save commits once and restores configured merging around exact saved paths. Picked-side tokens, source/session/permission changes and held gesture cancellation prevent late captures or commits; retained exact meshes can be edited even when unrelated geometry is merged. Preserve imported extras; repair malformed settings deliberately.
- `floor-presentation.js` / `floor-presentation-rendering.js` — explicit reversible side-by-side/stacked floor display in the existing renderer, at most four selected floors. Prove current disjoint rigid level groups and explicit background ownership; no name/height guessing, reparenting or source mutation. Failed ownership returns assembled. Measured SOURCE footprints drive spacing; rigid child hinges do not repack it. Restore still-owned transforms before merge/teardown. Source export is a read-only guarded hierarchy clone, not a product export button.
- `floor-presentation-context.js` / `floor-presentation-adapters.js` — exact confirmed saved level links and source room bounds; display-only copies for external feature layers. Rooms, bindings, calibration, object anchorOf/anchors and mini-map remain SOURCE; projectWorld/model hits are DISPLAY. Use displayAnchorOf/displayAnchors for physical popup/light positions and displayPlanPoint for canonical picking. A measured mower's explicit current floor overrides its authored parent. Source/raw camera frames include original framing limits; ambiguous changed overviews fit rather than restoring an old single-floor camera.
- `floor-presentation-editor.js` — admin Model-tab drafts, one Save/history step, explicit current floor order/repair and focused native controls. No live draft transformation or HA command. Editing and Section temporarily assemble while retaining the saved policy. Equal/default/rejected presentation does not cancel running presets, previews or camera motion. Theme/design drafts remain separately staged until their own verification.
- `navigation.js` — bubble control ordering, room picking and camera focus math.
- `history.js` — bounded session snapshots; root `_commit` records editable layout, EditMode groups gestures.
- `preset-events.js` — authenticated integration-owned camera subscription, acknowledgements and optional return.
- `status-overlays.js` — explicit room measurements/units/meters and located alerts; existing Three.js renderer. `setData()` returns whether visible data changed and invalidates only then. Unrelated HA updates must leave an idle model unrendered; identical data keeps an active pulse's phase.
- `overlay-editor.js` — visual room sensor/alert bindings in Edit → Overlays.
- `entity-metadata.js` — HA names, area/floor/device inheritance, picker filtering, native precision/units and read-only saved-reference diagnostics. Renamed IDs are never guessed from names.
- `camera-feed.js` — native muted HA picture-entity card; removes the actual player element on close/unavailability/disconnect. Generation-guards late async helpers and capabilities. Opening never calls a service.
- `camera-coverage.js` — opt-in approximate static camera sectors in the existing scene, explicit heading/FOV/range in plan metres; nonpickable helpers, stable data does not invalidate idle rendering.
- `camera-editor.js` — Edit → Cameras drafts, preview/Save/Cancel/Clear, exact mount selection and missing-selection preservation. Undo, context changes and leaving the tab clear preview.
- `tracked-source.js` — strict measured coordinate/calibration and timestamp/detection readers. Current HA occupancy is distinct from fixed-expiry events; malformed/restored readings do not become live evidence.
- `tracked-entities.js` — explicit room observations, parked/sighted vehicles and per-vacuum measured/static positions. Owned geometry and labels reuse the existing scene; no fabricated identity or route. Optional interpolation joins measured samples only. Semantic unchanged data does not invalidate idle rendering.
- `tracking-editor.js` — Edit → Tracking drafts and deliberate missing-link repair. Additive presence/vehicle/vacuum arrays save through root `_commit`; imported fields remain preserved. Status and coordinate freshness rules are independent and explicit.
- `tracking-calibration.js` — freezes real source readings, maps unsnapped source/plan pairs, previews methods/residuals and preserves imported GPS/units. Capture tokens/context prevent an old point entering another binding/model/floor. EditMode owns actual plan clicks, scoped Escape and read-only draft handles; no commit until Save.
- `security.js` / `security-editor.js` — exact contact evidence, owned bounded outlines and optional explicit rigid parent-local hinge offsets. No inferred angles or device actions. Unknown/stale readings restore authored pose with uncertain outline; no closed claim. Reject duplicate/nested/external transform writers. Root passes actual clips/visibility and drains movement through `view.modelMotionChanged()` so attached anchors, picking, occlusion and existing shadows update. Release helpers before authored model teardown.
- `weather.js` / `weather-editor.js` — opt-in current HA conditions with bounded decorative outdoor particles in the existing scene; complete indoor polygons on every floor mask precipitation. Invalid masks fail closed. Static/reduced-motion/hidden/Edit/Section/offscreen states stop animation; no new timer/light/renderer. Strict actual sun angles and numeric HA location replace coercion of absent data; manual Day/Night remain.
- Root tracking and security share one nearest absolute expiry timer. Tracking uses exact static `trackingAnchors()` keys, source-scoped event memory and shared scene/mini-map entity panel routing. Disconnect/tab hiding clear timers; resume reevaluates actual absolute source time. Evaluate alert, tracking, weather and security animation updates independently before combining their render request.

Review these, fix bugs, add unit tests (vitest) for placement + mower math.

## Coordinates
Plan metres: x = east, y = north, z = height above floor. Three.js world:
`(x, floorElevation + z, -y)` so north is up in top view. Wall box rotation.y = atan2(dy, dx).
Floor shape: ShapeGeometry rotated -90° about X.

## Layout data (stored, not in YAML)
```json
{ "version": 1,
  "floors": [{ "id": "ground", "name": "Ground floor", "elevation": 0, "height": 2.7 }],
  "rooms": [{ "id": "r1", "area_id": "kitchen", "floor_id": "ground", "polygon": [[0,0],[4,0],[4,3],[0,3]],
              "doors": [[2,0]], "outdoor": false }],
  "pins": { "device:abc123": { "x": 1.2, "y": 0.4, "z": 2.6, "floor_id": "ground" } },
  "hidden": ["device:xyz"],
  "mower": { "entity": "device_tracker.mower_position", "source": "gps", "x_attr": "x", "y_attr": "y",
             "floor_id": "ground", "calibration": [{ "src": [45.0, 10.0], "plan": [10, -5] }],
             "overlay": { "entity": "image.mower_map", "x": 0, "y": 0, "rotation": 0, "width": 30,
                          "opacity": 0.6, "refresh": 10 }, "trail": true } }
```
Floors auto-sync from HA floors (`hass.floors`, elevation = level * 3). Room floor defaults to
the area's floor_id.

## Card YAML (minimal)
```yaml
type: custom:taylors3d-card
layout_key: default      # storage key
height: 520px
group_by: device         # device | entity
wall_height: 1.0         # cut-away display height
model: /local/house.glb   # optional underlay from the existing Three.js design
model_position: [0, 0, 0]
model_rotation: 0
model_scale: 1
```

## Behaviour
View mode:
- Bottom bubble bar: floor/view chips, 3D / Top, reset, section, day/night, mini-map and Edit (admins only).
  Visual card editor chooses button visibility/order, map size/corner and device tap behavior.
- Marker/model-object tap: open device controls; explicit supported toggles/light brightness and
  All controls opens HA more-info. `device_tap_action: toggle` retains the original quick-toggle mode.
  Long-press (500 ms): more-info (`hass-more-info` event, bubbles + composed).
- Tap a room floor in view mode: show the linked area's devices/readings, including bound GLB devices.
- SVG mini-map: selected floor, devices and camera focus, click-to-focus; hidden during editing.
  The scene has its own container above the reserved bottom bar. Capture-phase object gestures
  must ignore `[data-taylors3d-ui]` and both popup elements, including their outside-dismiss events.
- Room/device controls default to a right-hand panel. Wide containers reserve 332px beside the scene;
  narrow containers keep the panel above the bubble bar. `control_panel: popup` uses the earlier popup.
- `taylors3d.select_view` targets one registered open card. Browser-local `taylors3d.panel` (Edit → Views)
  overrides shared `automation_panel`; `automation_card_id` distinguishes cards on one screen.
  Saved `camera_mode` must survive resolveViews. Any pointer/manual navigation interrupts flight/return.
- Overlays use saved `layout.room_overlays` / `layout.alert_bindings`, falling back to matching card options.
  `_syncStatus` uses resolved room/floor visibility and actual elevation. `view.onFrame` animates pulses;
  respect reduced motion and stop the render loop when disconnected. Never conflate W and Wh.
- Undo/Redo changes layout/config snapshots, never hass state or services. Reload/key/GLB replacement
  resets history. Cancel transient edit gestures and ignore async old-context upload/import results.
- Explicit deleted model area/floor IDs remain manual/stale until deliberately relinked/cleared or the exact ID returns. No stale-floor placement/elevation overrides; stale areas keep polygons without area devices. GLB named-view geometry rules remain independent from HA assignments.
- Lights: shared validated current colour/brightness for floor glows and model illumination. Zero/invalid/restored/unavailable output stays dark. Model lights rank useful current output inside the existing fixed 8-point/4-spot/4-shadow pool. Semantic unchanged readings must not write materials, redraw or rebuild lighting slots.
- Marker shows secondary sensor value (e.g. temperature) when the device has one.

Edit mode (side panel, tabs Rooms / Devices / Mower / Data):
- Rooms: list every HA area with status (room drawn / missing) and a Draw button. Draw =
  click corners on the plan, snap 0.05 m and to existing vertices within 0.25 m (shared walls),
  close by clicking first point or Enter, Esc cancels. Select room -> drag vertex handles,
  change area, outdoor toggle, set door (click near an edge), delete. Floor management.
- Devices: drag any marker -> becomes pinned (saved). Selected marker: height input,
  "Return to auto placement", Hide. List devices whose area has no room yet. Unhide list.
- Mower: pick entity, source gps/xy, attribute names, floor. Calibration: "Add point" takes
  current reading, then click where the mower really is. Overlay: image/camera entity,
  sliders x / y / rotation / width / opacity + drag-to-move tool; camera refreshes every N s.
  Live marker (mdi:robot-mower) + session trail line.
- Data: export / import layout JSON, show which storage backend is active (warn if not shared).
- Click vs orbit: pointer move < 5 px counts as a click. Disable OrbitControls while dragging.
- Render loop only while connected; render when controls change or state dirty.
- Rebuild markers only when registry objects change identity; per-hass-update just refresh states.
- Remove CSS2D elements from the DOM on dispose (removing the object does not remove the element).

## Sunseeker
Integration: HACS "Sunseeker robotic mower" (github.com/Sdahl1234/Sunseeker-lawn-mower).
Wireless models expose a Map image entity, a Live map camera entity, a Work region sensor and
a Mower position (GPS derived from map coordinates). Inspect the real entities in your HA
(Developer tools -> States) and adapt attribute names. Optional local alternative:
iiseppi/sunseeker_local_control (MQTT).

## Companion integration
`custom_components/taylors3d/`: manifest.json, `__init__.py` with `async_setup` (enabled by
`taylors3d:` in configuration.yaml), `homeassistant.helpers.storage.Store` (key
`taylors3d.layouts`), websocket commands `taylors3d/layout/get` {key} and
`taylors3d/layout/set` {key, layout} (set requires admin).

## Repo / delivery
- GitHub (`origin`) is the main remote; HACS installs it as an Integration from release
  `taylors3d.zip` (integration with the card bundled; it registers the card via
  add_extra_js_url). Manual: copy `custom_components/taylors3d/` after `npm run build`.
- CI: `.github/workflows/ci.yml` (lint, vitest, build, source/bundle freshness, headless checks including navigation/calibration/security/weather, pytest);
  `release.yml` on `v*` tags builds the zip and creates the release.
- Add `npm run deploy` that scp's dist + integration to the HA host (host from .env, not committed).
- `demo/index.html` with a mock `hass` object (few areas, floors, lights, sensors, a fake mower
  moving in a circle) for testing without HA. Verify with a headless browser screenshot.

## Order of work
1. Scaffold (package.json, esbuild, vitest, eslint), tests for existing modules.
2. Card: scene, floors, rooms, walls, markers, glow, view mode. Demo page.
3. Edit mode: room drawing/editing, marker drag + pins, storage.
4. Companion integration.
5. Mower: live position, calibration, overlay.
6. GLB underlay import; export helper for the existing Three.js house design
   (GLTFExporter snippet to run in its browser console).
7. README with install + usage, in English.
