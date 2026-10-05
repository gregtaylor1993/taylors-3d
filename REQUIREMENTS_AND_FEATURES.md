# Taylor's 3D — requirements and features

This is Taylor's ideas and progress log. It records what we want the app to do, what the current base already provides, and how we will know each new feature works.

Created: 4 October 2026. Starting point: version `0.1.0`, base commit `055e30f2e46062a01dd83b4bbec4b793c477f75a`.

The aim is a realistic, useful Home Assistant house dashboard that is comfortable to use on a wall panel. Taylor should be able to configure it visually, see what is happening at home, and reach the relevant controls by tapping a room or device.

## How we track work

Every idea has a permanent number, such as **F01**, so we can discuss it without losing track of it when its title changes.

| Status | Meaning |
|---|---|
| Planned | Recorded, but implementation has not started. |
| Needs input | A decision, device entity, model detail or hardware test is needed. |
| In progress | We are implementing the feature. |
| Testing | Implemented, with checks still to complete. |
| Done | Meets its completion checklist, with evidence recorded. |

Taylor chose the first group: **bubble bar, room/device popups and 2D mini-map**. F18–F21 have a first implementation and are **Testing**, including checks against the actual Home Assistant/wall panel still to do. The next pass adds right-hand controls, editing history, targeted camera automations and room measurements/alerts. Other requested additions remain visible below. Existing foundations do not mean the complete requested feature is finished.

For each implementation, update its status, record the changed behavior, link its commit or pull request, and record the checks performed. Keep unfinished parts visible instead of marking a whole feature Done early.

## Feature overview

| ID | Feature | Existing foundation | Status |
|---|---|---|---|
| F01 | Named camera presets and automation-triggered flights | Named saved 3D/top views and smooth camera moves | Testing |
| F02 | Complete visual configuration | Visual card editor and in-card edit tabs; new overlay/screen controls | In progress |
| F03 | General undo and redo | General session history and grouped gestures | Testing |
| F04 | Full dashboard backup and restore | Layout JSON import/export | Needs input |
| F05 | Temperature, power and energy views | Sensor readings, conversion, floor overlays and visual bindings | Testing |
| F06 | Security doors/windows and animated doors | Contact/lock markers and room door points | Planned |
| F07 | Camera coverage cones and live-feed popups | Camera markers and HA more-info | Planned |
| F08 | Presence: people/devices in rooms | Motion/occupancy markers | Planned |
| F09 | Alert pulses at the affected location | Located, labelled smoke/leak/unlocked/custom alerts | Testing |
| F10 | Actual sun plus rain, clouds and snow | Automatic sun/day/night and moon already exist | Planned |
| F11 | Hue colour/brightness lighting the rooms | Real coloured lamps and a bounded light pool | Planned |
| F12 | Scene previews | HA device controls; no scene preview | Planned |
| F13 | Ambient idle rotation and night dimming | Automatic night lighting; no idle rotation | Planned |
| F14 | Camera-aware cut-away and glass/faded walls | Side Section, opacity and authored glass | Planned |
| F15 | Furniture packs and drag-and-drop placement | Furniture inside GLB models and layer visibility | Planned |
| F16 | Baked shadows for wall panels | Realtime shadows and model material textures | Planned |
| F17 | Deeper HA floors/areas/entity integration | Registries, filtering, area/floor mappings | Planned |
| F18 | Room selection and room control panels | Edit-mode room/model picking | Testing |
| F19 | Bottom bubble navigation bar | Top toolbar and view chips | Testing |
| F20 | Rich device control popups | HA more-info and supported object popups | Testing |
| F21 | Persistent 2D mini-map | Full-card Top view | Testing |
| F22 | Cars appearing on the drive | EV charger status; no vehicle detection/model | Planned |
| F23 | Robot vacuums moving while running | Vacuum markers and reusable mower tracking math | Planned |
| F24 | Horizontal split floors and vertical layers | Individual floors, All and section views | Planned |
| F25 | Translations, preview, screenshots and bundle checks | English service strings, mock HA, screenshots and source/bundle gates | In progress |

## Proposed build order

The phases group related work so each step can be used and tested before the next one. They are not delivery dates or a commitment to build everything at once.

| Phase | Work | Why this order helps |
|---|---|---|
| 0 — reliable base | Review B01–B03, test the base in Taylor's HA and inspect the actual GLB | Gives us a dependable starting point and confirms the real data/model. |
| 1 — daily navigation | F19 bubble bar, F18 room panels, F20 device popups, F21 mini-map | Makes the dashboard easy to use on the wall panel. |
| 2 — safe editing | F02 visual configuration, F03 undo/redo, F04 backups | Makes larger future changes easier to configure and recover. |
| 3 — automatic views | F01 presets and automation triggers | Reuses saved views and the new navigation. |
| 4 — useful overlays | F05 energy/temperature, F06–F09 security/presence/alerts, F07 cameras | Builds on mapped rooms, entities and popups. |
| 5 — living house | F10–F13 sun/weather/lighting/scenes/idle, F22 cars, F23 vacuums | Adds animation once real device data and tablet limits are understood. |
| 6 — model presentation | F14 cut-away, F15 furniture, F16 baked shadows, F24 split floors | Adds the more demanding model and rendering work. |
| Throughout | F17 HA integration and F25 accessibility/translations/demo/tests | Each feature should work well with HA and remain testable. |

Taylor confirmed Phase 1 first on 4 October 2026. The 5 October pass also develops safe editing, automation and measurement foundations alongside right-hand controls. The remaining phase order can change as we learn from the actual house and devices.

## Detailed requirements

### F01 — camera presets and automation-triggered flights

**Want:** save views named Front door, Garden and Top-down, then jump to them manually or through HA automations. A doorbell ring should fly the selected wall panel to the front-door view.

**Already present:** named views, saved 3D camera position/target, separate Top camera position/zoom, and smooth transitions. The missing part is automation control and targeting the intended display.

**Complete when:** presets can be created, renamed, reordered, saved and selected visually; they survive reload; an automation selects a named preset on a chosen panel/card; the correct floor and 3D/Top mode are selected; touch interrupts the camera flight. Invalid preset/target requests have a clear result. Provide a simple HA automation example. Agree whether the view should return automatically after a doorbell event and how competing alerts are handled.

**Current implementation:** `taylors3d.select_view` targets one registered open card by shared layout plus browser-local screen name and/or card ID. No match or duplicate targets fail clearly. Saved camera mode reaches the resolved preset. Optional `return_after` restores the exact earlier camera; omitted/zero stays at the selected preset. New requests supersede the earlier return; touch/manual navigation cancels it. Authenticated non-admin panels use an integration-owned subscription. See the [controls guide](docs/FEATURES-GUIDE.md). Actual doorbell/panel testing remains.

### F02 — complete configuration without YAML

**Want:** configure everything through the card rather than having to write YAML.

**Already present:** a visual Lovelace editor and the card's Rooms, Devices, Objects, Mower, Views, Model and Data tabs. Some advanced settings are still not exposed in a unified visual workflow.

**Complete when:** every supported setting has a labelled visual control, sensible defaults and validation. Entity pickers can be filtered by the feature and area. A user can set up rooms, models, views, bindings and new overlays without entering YAML. Existing configurations remain usable. The normal viewing interface stays simple, and editing respects HA administrator permissions.

### F03 — undo and redo

**Want:** undo mistakes and redo an edit without starting over.

**Already present:** undoing the last point while drawing a room. There is no general editing history.

**Complete when:** room geometry, device/furniture movement, bindings, view changes and visual settings can be undone and redone. One drag or slider gesture counts as one edit. A new edit after Undo clears the redo branch. Buttons and keyboard shortcuts work, and save failures are visible. Undo changes the dashboard's configuration; it must not reverse real device actions or live sensor updates. Define history limits and behavior after import/reload before implementation.

**Current implementation:** defensive session snapshots, 100 edits / 8 MiB, grouped drags and pointer/keyboard sliders, Undo/Redo buttons and shortcuts, redo-branch clearing, and normal persistence/error state. Reload/key changes reset history; importing editable layout JSON is one edit. Replacing/deleting GLB bytes resets history because the server currently stores one model file; asset recovery belongs to F04. Furniture edits become covered when F15 exists. Live HA states/actions are excluded. Actual household editing and external Lovelace settings persistence still need verification.

### F04 — full dashboard backup and restore

**Want:** export and import the complete setup so the layout can be backed up and restored.

**Already present:** layout JSON export/import, including views, bindings and model metadata. It does not include GLB bytes, every Lovelace card option or an entire HA dashboard.

**Pending scope question:** Taylor's 3D settings/layout/model assets, the entire HA dashboard including other cards, or both. Work depending on this decision has not started.

**Complete when:** the agreed backup scope includes card settings, layout, views/presets, entity/area mappings, furniture and required model/assets. A restore preview shows what will change and which entities/areas/assets are missing. Restoring into a fresh setup reproduces the saved result, and the existing setup can be recovered if an import is rejected. Backup format/version and migration are documented.

**Scope decision:** confirm whether “full dashboard” means the whole Taylor's 3D setup, an HA dashboard containing this card and other cards, or both. Do not quietly label a layout-only JSON file as a full backup.

### F05 — temperature, power and energy overlays

**Want:** colour rooms by temperature or consumption so a cold bedroom or a high-power tumble dryer stands out immediately.

**Already present:** temperature/power sensor labels and warm/cool climate-object state. Room outlines and area mappings can support a room overlay.

**Complete when:** the user chooses an overlay and its sensor bindings visually; rooms/devices update with HA values; a legend shows the scale and units; missing/unavailable readings have an explicit appearance. Temperature aggregation is configurable, and room power totals avoid counting the same circuit/device twice. Keep instantaneous power (W/kW) separate from accumulated energy (Wh/kWh and a chosen period). Labels make the information understandable without relying only on colour.

**Needs:** actual temperature/power/energy entities and confirmed room outlines. A model supporting outlines does not prove Taylor's house model already contains them.

**Current implementation:** visual Overlays tab, explicit room sensors/aggregation, C/F/K and W/kW or Wh/kWh conversion, matching energy periods, fixed/automatic scale, accessible legend/readings and grey missing data. Multi-meter sums require separate-load confirmation or explicit non-overlapping circuit groups. Partial/conflicting data withholds a combined total. Resolved floor visibility/elevation works for drawn rooms and tagged GLBs. Actual house data and panel performance remain to test.

### F06 — security doors, windows and door animation

**Want:** a security mode in which open doors/windows glow red, with model doors visibly opening and closing.

**Already present:** door/window/contact/lock marker icons and active-state handling. Existing room door points describe positions, not necessarily hinged 3D doors.

**Complete when:** door/window/lock entities can be bound to model parts or plan locations; open/unlocked states and unavailable data are clear; close/lock states clear the highlight. Door motion uses the correct hinge, direction and limits without moving the wall or frame. A binary contact uses configured open/closed poses rather than claiming to know the exact angle.

**Needs:** inspect Taylor's actual GLB for independently movable door parts and hinge/pivot geometry. Those pivots have not been verified.

### F07 — camera cones and live feeds

**Want:** show each Ring camera's coverage cone, and tap a camera to open its live feed.

**Already present:** camera markers can open HA more-info; image/camera sources can supply mower-map overlays. Dedicated camera coverage and stream popups are new work.

**Complete when:** coverage position, direction and field of view can be set visually; cones can be shown/hidden; tapping the camera opens the available HA stream in a usable popup. Clearly show offline, unavailable or unsupported streams. Coverage is a configured approximation, not a guarantee of detection. Closing a feed releases streaming resources.

**Needs:** inspect the actual Ring `camera` entities and the stream capabilities exposed by Taylor's HA setup. Do not assume every camera supplies a live stream.

### F08 — presence and “who's where”

**Want:** show people or devices as dots in rooms, using phone tracking or Hue motion sensors.

**Already present:** motion/occupancy/presence sensor markers. People and device trackers are not currently a room-location layer.

**Complete when:** supported room-presence sources can be mapped to rooms; dots/occupancy update and expire appropriately; home/away and room presence are distinguishable; unavailable or conflicting inputs have a sensible result. Identity is shown only when the data identifies a person/device. Motion can show activity/occupancy without claiming which person triggered it.

**Needs:** phone home/away tracking alone does not locate a person in a room. Confirm room-level data sources, timeouts and how motion should be combined with named people/devices.

### F09 — alert pulses

**Want:** smoke, leaks or an unlocked door pulse at their 3D location.

**Already present:** these entities can appear as generic active markers, but there is no alert-pulse system.

**Complete when:** alert entities, trigger states and locations are configurable; each alert has a clear icon/label; the highlight follows current state and clears according to the chosen rule. Multiple alerts can coexist. Unavailable data is distinguished from a cleared alert. Reduced-motion mode uses a static highlight rather than a pulse. Doorbell/security alerts can optionally select a preset through F01.

**Needs:** Taylor does not currently expect the FireAngel setup to provide HA data. Check the exact hardware/entities rather than declaring the whole brand unsupported; available Zigbee smoke/leak entities can be mapped when present.

**Current implementation:** visual smoke/leak/unlocked/custom-state binding with room/device positions, trigger/clear rules and optional browser-session latch. Multiple labelled rings follow live data; missing/unavailable states remain distinct. Acknowledge clears a latch only once the source stops triggering; reloading starts fresh. Reduced motion gives a static highlight; editing/detaching stops animations. Camera action can be added to the same HA automation using F01; real alarm/panel validation remains.

### F10 — actual sun and weather

**Want:** sun/shadows follow the real time, with rain, clouds or snow outside.

**Already present:** Auto reads `sun.sun`, uses model north for sun/shadow direction, darkens through dusk and includes sun/moon visuals. Without sun data it falls back to Day. Weather effects are not implemented.

**Complete when:** existing sun behavior is verified with Taylor's HA location and model orientation; a selected weather entity drives rain/cloud/snow conditions outdoors. Effects have intensity/quality controls, sensible unavailable fallback and a lightweight/off setting for the wall panel. Indoor rooms are not filled with weather particles. Animations stop when the card is not visible or connected.

### F11 — lights that light the room

**Want:** Hue brightness and colour illuminate the room's walls and floor, with the useful lights prioritized within the realtime budget.

**Already present:** bound model lamps glow and use real point/spot lights with HA colour/brightness. The pool is 8 point lights plus 4 spot lights, with up to 4 shadow slots. Lit, visible fixtures are prioritized; other fixtures can retain glow. This is a light budget, not a limit of twelve rooms.

**Complete when:** Taylor's model lights and Hue entities are bound correctly; colour/brightness changes visibly affect nearby surfaces; off lights release their lighting slots; invisible rooms do not consume unnecessary slots. A low-power mode remains available. Materials, exposure and shadows are checked on the actual tablet/model rather than promising the same appearance on every device.

### F12 — scene previews

**Want:** preview Movie or Bedtime before actually activating the scene.

**Already present:** device controls, but no scene-preview system.

**Complete when:** hover or a touch Preview action temporarily changes only the local visual appearance; leaving/cancelling restores the live appearance. Preview makes no HA service calls. A separate intentional Activate action applies the actual scene. Scene mappings are visible and editable; missing target state data is reported rather than guessed.

**Needs:** a scene entity may not expose all its intended device states. Confirm how preview states will be supplied, and provide a touch equivalent to hover.

### F13 — ambient idle mode

**Want:** slowly rotate the house when the wall panel is untouched, and dim it at night.

**Already present:** automatic scene darkening, but no idle rotation.

**Complete when:** idle delay, speed, night dimming and quiet hours are configurable; touch, editing or an alert stops idle motion immediately; the camera returns predictably to its normal state. Reduced-motion and low-power settings can disable rotation. Dimming the card is supported without claiming to change the physical tablet backlight.

**Needs:** physical screen/backlight control, if wanted, depends on the actual wall-panel integration.

### F14 — cut-away and glass/faded walls

**Want:** expose the inside of the realistic GLB by cutting/fading walls nearest the camera, rather than hiding an entire floor.

**Already present:** a vertical Side Section clipping plane, storey clipping for some models, global opacity and authored glass materials. Automatic camera-side wall fading is new work.

**Complete when:** the user can choose normal, cut-away and faded/glass-wall presentation; suitable tagged walls fade/cut according to the camera without losing useful floors or interior objects. Picking and device popups still select the visible target. Fade state resets when disabled; authored transparent glass still behaves correctly. Keep a manual section fallback for models without usable wall separation.

**Needs:** inspect wall geometry/tags and the mesh-merging rules. The intended appearance can be inspired by other projects; implement it for this GLB renderer without depending on another project's generated geometry.

### F15 — furniture packs and drag-and-drop furniture

**Want:** choose furniture from reusable packs and drop it into rooms.

**Already present:** furniture can be authored into a GLB and hidden by layer. There is no in-card furniture library.

**Complete when:** local/imported licensed assets can be browsed, placed, moved, rotated, scaled and removed visually; dimensions fit the model's metre-based coordinates; placements survive reload and join undo/redo and full backups. Assets are counted against agreed tablet/performance limits.

**Scope:** no signed shop, payment system or dependency on another project's commercial pack service is required. Preserve asset licences and attribution.

### F16 — baked shadows

**Want:** soft, inexpensive shadows that look good on the wall panel without relying on many realtime lights.

**Already present:** realtime shadows and authored model textures/materials. No in-card shadow-baking workflow exists.

**Complete when:** a documented baked-shadow/ambient-occlusion model workflow renders correctly; the user can select a low-power presentation that preserves useful depth while reducing realtime shadows. Explain that baked shading is fixed and cannot move with a changing light or furniture item. Define whether baking happens in a modelling tool or is eventually offered in-app before implementation.

### F17 — tight Home Assistant integration

**Want:** floors, areas, devices and entity pickers follow HA's setup and respect useful registry metadata.

**Already present:** reads HA floors/areas/devices/entities, area inheritance, hidden/config/diagnostic filtering and names; devices appear by area. Sensor values currently use a fixed one-decimal display.

**Complete when:** feature-specific pickers filter sensibly by domain, class, area and capabilities; display precision/units follow the available HA metadata; renamed, moved and removed entities/areas are handled visibly without corrupting the layout. Distinguish registry updates from explicitly chosen model-room bindings so a HA area change does not silently invent house geometry.

### F18 — room selection and room panels

**First delivery:** stationary room-floor taps open an area panel with its grouped devices and readings, including devices represented by GLB objects. Navigation drags and device taps are kept separate. Registry/layout changes close an old panel so it cannot retain stale room membership. Configurable room-level shortcuts remain future work.

**Want:** tap a room in normal viewing mode and open a useful room panel, like the described Lounge panel.

**Already present:** room outlines, model picking and edit-mode room selection. A normal-mode room control panel is new work.

**Complete when:** tapping a room selects the correct room/floor and opens its panel; the panel lists that area's relevant devices, readings and available controls; room-level actions are configurable. A device tap reaches its own controls rather than also opening the room. Closing the panel restores navigation, and missing/empty rooms have an understandable result.

### F19 — bottom bubble bar

**First delivery:** a bottom bar reserves space below the house; saved views, modes and common controls have clear active states and keyboard focus. Narrow panels use two rows with sideways scrolling. The visual card editor selects/reorders buttons with Up/Down controls; availability follows model capabilities and admin permissions.

Navigation-only configuration changes preserve the selected viewing mode, temporary map visibility and the shared layout storage connection. Changing the layout key loads that key's own layout; an older delayed response cannot replace it.

**Want:** a bubble-style bar at the bottom for views and useful controls.

**Already present:** top toolbar/view chips for floors/views, 3D/Top, reset, section, day/night and Edit.

**Complete when:** touch-friendly bottom bubbles cover agreed views/modes and shortcuts; the active choice is obvious; order/visibility can be configured visually. Works on narrow panels, avoids covering the selected room/device, and coexists with popups and the mini-map. Labels, keyboard focus and theme colours remain readable.

### F20 — device cards with all applicable options

**First delivery:** taps open grouped-entity panels with live readings, explicit supported on/off and light-brightness controls, unavailable/unknown states and command errors. **All controls** opens HA's native entity UI for complete camera/climate/cover/vacuum/etc. options. Long-press retains more-info; the visual editor can restore quick-toggle taps. Specialized in-card camera feeds and richer domain shortcuts remain under their own planned features.

**Want:** tapping a device opens a card with every useful option that device supports.

**Already present:** device taps toggle some devices or open HA more-info; supported model objects have contextual popups.

**Complete when:** popups offer controls supported by the selected entity, such as light brightness/colour, climate settings, locks/covers, camera feeds and vacuum actions. Unsupported controls are not advertised. Current state, errors and unavailable devices are visible. HA's standard more-info remains a fallback. Choose whether quick-toggle or popup is the default tap action, with a usable touch gesture for the other action.

### F21 — 2D mini-map

**First delivery:** lightweight north-up SVG room outlines, a floor selector, live device/model-object dots and camera focus/direction. Taps focus the main camera. The visual editor saves visibility, size and top corner; close/map buttons temporarily hide/show it. Editing hides it. Live updates preserve keyboard focus. Future alert/presence features will add their own map indicators.

**Want:** a small 2D overview alongside the 3D house.

**Already present:** a full-card, north-up orthographic Top view.

**Complete when:** the mini-map can stay visible in 3D, shows the selected floor and relevant room/device/alert positions, indicates the main camera's focus/orientation, and supports tap-to-focus. Its size/location/visibility are configurable, and interactions do not accidentally orbit the main view. Check the extra rendering cost on the wall panel.

### F22 — cars on the drive

**Want:** show cars while they are parked on the drive, using camera vehicle detections. Taylor confirmed this meaning on 4 October 2026.

**Already present:** EV charger state objects, but no vehicle detection or parked-car display.

**Complete when:** an available HA detection entity/event is mapped to a driveway zone and parked-car model position; arrival makes it appear and departure/expiry clears it. Stale or unavailable detections do not leave a car present forever. If the goal is named household cars, identify a suitable presence/identity source rather than assuming generic vehicle detection identifies the owner.

**Needs:** the actual camera/detection integration, driveway zone, number/positions of displayed cars and the clearing rule. Named household-car identity is optional future scope. The card will consume supplied detection data; a raw camera feed is not already a vehicle detector.

### F23 — robot vacuum movement

**Want:** robot vacuum models move around the appropriate floor while cleaning.

**Already present:** vacuum icons/states and mower GPS/XY/map-image tracking with calibration. Vacuum live-location support is not implemented.

**Complete when:** a vacuum with location/map data can be bound, calibrated to house coordinates, shown on the correct floor and updated while cleaning; docking, idle and unavailable states are clear. Multiple vacuums are distinguishable. Without actual coordinates, a stationary status marker is available; decorative movement, if chosen, is labelled simulated rather than presented as live location.

**Needs:** vacuum make/integration, coordinates or map access, floor mapping and calibration data.

### F24 — split-floor views

**Want:** two ways to separate floors: a horizontal flat split into different floor views, and a vertical stack of separated layers.

**Already present:** single floor/storey views, an All view and a side section. Simultaneous split and separated-layer views are new work.

**Complete when:** horizontal panels can display selected floors at the same time; vertical layers can be spaced apart with a configurable gap. Devices, rooms, people/vacuums and alerts remain aligned with their floor. Selecting a floor focuses the right panel/layer and opens the right controls. Returning to the normal house restores its geometry/camera state. Total rendering/light cost remains bounded across views.

**Needs:** confirm horizontal split means side-by-side panels rather than a geometric horizontal slice. Confirm the desired number of floors/panels, camera linking and vertical gap controls.

### F25 — polish, translations, preview and reliable bundles

**Want:** translations, a usable mock-HA preview, screenshot tooling and CI that detects stale bundles.

**Already present:** English integration strings, a mock HA demo, browser screenshots, 514 JavaScript tests in the inspected base and GitHub workflows. Card UI strings are mostly hard-coded English. Bundles are generated/ignored by Git rather than committed, and CI rebuilds them.

**Complete when:** new and existing card UI can be translated with sensible fallback; preview scenarios cover the new features without needing real household devices; screenshots can be recreated; relevant automated checks protect behavior. Release assets contain the current source's bundle, and the integration's frontend copy matches the generated `dist` file. Define the stale-bundle check around build/release contents rather than demanding a Git diff of ignored files. Keep local development instructions clear for Windows as well as macOS/Linux.

**Current implementation:** new right-panel/preset/overlay browser suites and screenshots, English service translations, and `npm run check:bundle`. That command recompiles current source in memory and checks both distributed copies; CI and release packaging fail if either copy is missing or stale. Full card UI translation work remains.

## Baseline work to resolve

### B01 — distant terrain camera range

**Status:** Done (verification). An earlier local browser check reported a terrain corner at depth 243.35 m outside a 199.28 m far rendering limit with a camera 130 m away. This did **not** reproduce in either GitHub attempt, the Phase 1 local model check, or the final complete CI suite: those passed with a 286.82 m far limit. Rendering logic was unchanged during the rename and Phase 1. The cause of the earlier sample remains unproven; no confirmed rendering defect required a fix.

**Complete when:** the distant terrain remains visible within the intended rendering limits and the existing model checks pass, with no regression in depth precision, sky, model framing or saved views. Record the diagnosis and fix separately from feature work.

### B02 — GitHub CI and HACS validation

**Status:** Done. The final integration, card and HACS checks pass. Earlier failures, diagnoses and fixes are recorded below.

- [Base CI run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37236933008).
- [Base HACS validation run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37236933000).

The GitHub CI installation, lint, JavaScript unit tests, build and Python integration tests passed. The model browser check failed on both attempts with a 30-second navigation timeout while opening the model-camera fixture (`scripts/lib/demo-browser.mjs:54`, called by `scripts/model-check.mjs:1831`). The cause beyond that timeout remains unproven; B01 was not the GitHub failure.

HACS failed only because the repository had no valid topics. The other seven checks passed, including licence, HACS configuration and integration manifest. Add appropriate repository topics, then revalidate. Make the browser check load reliably without removing meaningful coverage.

**Update:** repository topics were added; [HACS validation now passes](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37237996681). The shared browser helper now waits for the document and actual card readiness instead of global network silence. Model fixtures get time to parse; each existing model test retains its specific readiness/assertions. Legacy object-toggle checks explicitly select Quick toggle; default popups are tested separately. New navigation checks run in CI. The final complete CI result is recorded below.

**Phase 1 follow-up:** [the first feature CI run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37239514063) passed Python integration tests, all 571 JavaScript tests, lint and build, but failed the mini-map camera-focus check. A real pointer reproduction confirmed that tapping the map immediately after dragging could leave camera inertia pulling away from the selected room. Mini-map navigation now stops that previous motion while preserving the current visible camera, then starts its focus movement. The browser helper waits for actual camera stability, and an immediate drag-to-map regression retains the original position tolerance. The later verification results are recorded below.

The same browser checks exposed an initially-Top card restoring an unframed, zero-distance perspective camera when switching to 3D. That invalid snapshot is now ignored, so the 3D button uses normal house framing. Both fixes support the selected navigation features; the other planned features remain unimplemented.

**Model fixture follow-up:** [the navigation-correction CI run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37240222216) passed the complete editor/navigation suites and all model checks except the magnetic-drag fixture's lamp lookup, on both attempts. The lamp and model raycast worked; the reserved scene viewport projected a device marker over that small lamp, leaving no exposed pixel at the fixture's old camera angle. The fixture now uses a closer angle that exposes the real lamp, and requires an actual in-bounds canvas hit. Real wall/lamp dragging, attachment, realignment, fallback, Alt-drag and detach assertions remain intact. Focused verification and the final complete CI result are recorded below.

**Final navigation follow-up:** [the next CI run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37241187536) found that the new room-test helper could choose a ceiling lamp's upward face or nearby device hit area instead of a room floor. The helper now requires the matching room's upward floor and excludes actual mouse-priority device hits; app selection logic was already correct. The complete local navigation suite passes with that stricter choice. Visual review also found light button backgrounds with pale text in a partial dark theme; popup buttons now fall back to the theme's card background. Actual enabled-button contrast is 16.10:1 in light and 13.03:1 in dark, above the 4.5:1 check. Screenshot examples were refreshed. The final complete CI result is recorded below.

**Final result:** code commit `9de9626d6abd8b47988476572e00113340d38b77` passes [complete GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37241578811) and [HACS validation](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37241578888). Both CI jobs succeeded: Python integration tests; all 571 JavaScript tests in 33 files; lint; build; and the complete demo, editor, navigation and model browser checks. The model suite passed on its first attempt. F18–F21 stay Testing until the actual Home Assistant, house model and wall panel checks below are completed.

Local build, lint and all 514 JavaScript tests passed before upload. The full HA Python harness was not run locally; it passed in GitHub.

**Complete when:** diagnosed failures are resolved or precisely documented, and the required integration/card/HACS checks succeed. Do not silence a meaningful check merely to get a green result.

### B03 — actual Home Assistant and model validation

**Status:** Needs input. The base was uploaded to GitHub; this does not confirm that it is installed in Taylor's actual HA. No Taylor house GLB or household entity list was supplied during the code audit.

**Complete when:** the base loads in Taylor's HA, saves a shared layout, uploads the actual GLB, and works beside the original integration. Confirm room outlines/tags, floor alignment, model north and available entities before relying on them for new features. A GitHub release containing the integration zip is needed for the HACS release-download route.

## Decisions and information to gather

| Decision/input | Why we need it | Current position |
|---|---|---|
| First feature group | Sets the implementation order | Confirmed: bubble bar, room/device popups and 2D mini-map. |
| Vehicle meaning | Determines generic detection versus named household car presence | Confirmed: show cars parked on the drive using detections. |
| Full backup scope | Whole HA dashboard versus complete Taylor's 3D card/setup | Awaiting scope agreement before F04. |
| Split-floor meaning | Side-by-side panels versus a horizontal cut through the building | Working interpretation: separate horizontal floor panels plus vertical layers. |
| Actual GLB and model tags | Door pivots, separated walls, room outlines and floors | Not verified against Taylor's model. |
| Wall panel/browser | Sets realistic animation, lighting and split-view limits | Not recorded yet. |
| HA entities/integrations | Presets, Ring feeds/detections, Hue, temperature/power, presence, smoke/leaks and vacuums | Use actual available entities; do not assume model names imply data availability. |
| Optional hardware controls | Physical screen dimming, camera streams and vacuum locations | Confirm integration capabilities when the feature is started. |

We will ask for the relevant details when starting that feature, instead of requiring every device detail before recording the ideas.

## Completion and progress record

A feature is Done only after its agreed behavior works, it persists where appropriate, missing data behaves clearly, and the relevant checks pass. Check touch use on the target panel, HA permissions, theme readability and reduced-motion/performance settings where the feature needs them. Keep the existing integration and storage namespaces separate from the original project.

| Date | Item | Progress / evidence | Commit or PR |
|---|---|---|---|
| 2026-10-04 | Base | Independent renamed base uploaded to `main`; local build/lint/514 JS tests passed; online checks need B02 | `055e30f` |
| 2026-10-04 | Requirements | Taylor's complete initial feature list recorded; foundations and pending inputs checked against the code | `a2c49d0` |
| 2026-10-04 | Phase 1 | First bubble bar, room/device panels and mini-map implemented. 571 JS unit tests and lint pass. Existing editor browser checks and the complete new navigation browser suite pass, covering real clicks, correct service payloads, grouped rooms, map floors, keyboard focus, narrow layouts and GLB overlays. Shared-storage/key-change regressions pass. Actual HA/panel testing remains. | `f42fded` |
| 2026-10-04 | Navigation correction | Fixed immediate drag-to-mini-map drift and initially-Top to 3D framing. Complete navigation browser suite passes, including real active-pan regressions in both modes, unchanged destination tolerances and all GLB overlay checks. GitHub follow-up CI and actual HA/panel validation remain. | `6e90252` |
| 2026-10-04 | Model fixture correction | Exposed the lamp with a closer fixture camera and required a real uncovered canvas pixel. All 15 focused magnetic checks pass, with unchanged tolerances and zero browser errors. App code and navigation controls are unchanged by this correction. Included in the final successful full CI. | `ec2f581` |
| 2026-10-04 | Popup and room-test polish | Fixed theme background fallback and confirmed enabled-button contrast in both themes. The complete navigation suite, stricter GLB room taps and all 20 popup unit tests pass. Screenshots updated. | `9de9626` |
| 2026-10-04 | Automated validation | Complete GitHub CI and HACS validation pass. Full model suite passed on the first attempt. Manual installation zip matches the generated frontend. Actual household validation remains B03. | `9de9626` |
| 2026-10-05 | Phase 2 | Right-hand panels, individually addressed camera actions with acknowledgements/optional return, grouped Undo/Redo, and visual measurement/alert bindings implemented. All 668 JS tests, lint, build and source/bundle freshness gate pass. Final local navigation, full editor, 22 history and 23 overlay browser checks pass. Fixes retain named-view floors, scope keyboard Undo to the focused card and keep unrelated HA updates from redrawing the house. GitHub integration/full-suite validation is pending; actual HA/house/panel checks remain. | This change |

### Phase 1: Taylor's Home Assistant check

After installing a build containing Phase 1:

1. Open Taylor's 3D and confirm the bottom buttons and mini-map appear.
2. Change floor and 3D/Top view. Confirm the map shows the correct floor and tap it to focus a room.
3. Tap a room's floor. Confirm its panel shows the area's actual devices and readings. Rooms need outlines and area links.
4. Tap a light/device. Simply opening its panel should not change it. Press On/off or brightness intentionally; verify the actual device responds.
5. Use All controls for a camera, cover, climate or vacuum; confirm HA offers its supported controls. Check an unavailable device is shown clearly.
6. Orbit/drag the house. No device should change and no room panel should open from the drag.
7. In the dashboard card's visual editor, change button order/visibility, map size/corner and device-tap behavior. Save, reload and confirm those settings persist.
8. Enter the card's layout Edit mode: the map hides, room/device editing still works, and Done restores normal navigation.
9. Try the wall panel in its real light/dark theme, including narrow layout and touch use. Record any issue here before marking F18–F21 Done.

### Phase 2: camera actions, editing and overlays

The right-side controls, saved-camera action, Undo/Redo and room/alert overlays are implemented. Read [the controls guide](docs/FEATURES-GUIDE.md) for the steps and the meaning of each setting. Automated checks use the supplied example houses and mock Home Assistant; household acceptance remains separate.

**Validation details:** the original complete local model run passed its geometry, lighting, alignment, view, export and editor assertions, but found one real regression: ten unrelated HA state updates caused ten unnecessary model frames. The fix invalidates status layers only for changed visible data; the original strict model idle assertion remains in place. The new overlay browser checks also require zero extra frames/shadow work with overlays off and with unchanged configured readings. An earlier navigation stability timeout did not reproduce in the final complete navigation run, with its original timeout and camera tolerances unchanged; its cause remains unconfirmed. Bounded diagnostics were added for a repeat. Final online CI must exercise the Python services and the full freshly built browser suites before this update is considered automatically verified.

**Local performance result:** the final overlay browser suite passes all 23 checks. With overlays off, ten unrelated HA updates leave model frames at 10, shadow passes at 8 and shadow-light work at 13. With an enabled, unchanged temperature reading, frames stay at 11 with the same shadow counters. Final navigation, all 22 history/visual-editor checks and the complete existing editing browser suite pass, with no browser errors. The package's frontend matches the current source build (`0e433a7b44e600a034de11b62c71f853b7b814573e59259fee8f93e43d7ecdc6`). Python service execution and the final complete model rerun still require online CI.

1. On a wide screen, open a room and device panel. Confirm the house and mini-map remain usable beside it. On the wall panel, check scrolling, closing, touch targets and the bottom bar.
2. Give each browser a unique screen name in Edit → Views. Save Front door, Garden and Top-down views. Reload and confirm the screen name and views survive.
3. Run the Select camera preset action for just one screen. Confirm the other screens stay unchanged. Check an incorrect screen/preset gives an action error rather than reporting success.
4. Try a 30-second return, then touch the screen during another return. Confirm the first returns to its previous position and the second leaves your manual view alone.
5. Move a device, draw/change a room, save a view and change an overlay. Undo and Redo each change, then reload to confirm the restored layout was saved. Typing in a text box must keep normal text Undo.
6. In Edit → Overlays, connect one real temperature sensor and one power sensor to their rooms. Change the real readings and confirm the colours and labelled units follow them. Confirm unavailable readings look different from zero.
7. For an energy view, confirm the selected sensors use the same period. For several meters, identify separate loads and avoid counting both a total and its parts.
8. Use a harmless test entity for an alert. Check its assigned location, active pulse, unavailable state and clear/acknowledge behavior. Try reduced motion: it should remain a steady marker.
9. Keep your GLB backed up separately. Replacing/deleting its server file resets Undo history; full model-asset backup is still F04.

Record actual HA version, browser/panel and entity IDs when these checks are completed. Do not mark F01/F03/F05/F09 Done based only on the mock preview.

The earlier local full-model regression run was stopped after its initial rendering/visibility/terrain/section/sky/merge checks passed, because its loaded script still expected the old default tap behavior. Those assertions now explicitly select Quick toggle. That local run remained partial; the final GitHub CI subsequently completed and passed the entire model suite.

When starting work, add a row here and update the feature status above. When it is completed, record exactly what was tested and any unfinished part that remains.
