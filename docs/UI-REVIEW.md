# Taylor's 3D usability review — 7 October 2026

The house is the main view. Room/device controls and optional custom left actions
overlay it; opening them must not shrink the drawing or change its camera. The
existing charcoal, amber and teal design remains, with light and HA themes.

## Prioritised findings and fixes

| Priority | Finding | Implemented change |
|---|---|---|
| High | Opening a room reserved house width/height | Overlay panels in both House and standard layouts; capped panel height and internal scrolling; unchanged scene, canvas, stage and camera |
| High | Custom actions had no left-menu placement | Bottom bar, Left menu and exact Room panel placements; collapsible Quick actions, Escape, keyboard controls and current-source checks |
| High | Leaving a settings section could silently discard a draft | Save and continue, Discard changes or Stay here; invalid/failed saves keep the editor open |
| High | Replacing an uploaded model overwrote bytes before review | Review old/new filenames before replacing; explain backup and Undo limitations; initial uploads stay simple |
| Medium | Save/Cancel could be far below many button forms | One sticky action row in the button editor |
| Medium | Button conditions required technical state text | Friendly current/known state choices, current-rule explanation and Advanced exact state |
| Medium | Empty new names and outdated menu directions confused users | Validate new/changed names without deleting imported data; update grouped menu guidance |

## How to use it

Choose **Edit → Controls → Buttons and bars**. Add or edit a bar, choose **Bottom
bar**, **Left menu** or **Room panel**, then choose its name, appearance and
buttons. You can move, duplicate and reorder buttons. Save keeps these layout
changes; editing a button does not run its action. The optional favourites dock
keeps four or five pinned buttons visible, with other buttons under More.

On the house, open **Quick actions** for left-menu bars. Close it or press Escape
when finished. Room popups close the custom menu to keep the interface clear.
Idle rotation pauses while this menu is open. Room controls scroll within their
panel; the house keeps its original viewport and camera.

In-card **Appearance → House** edits title and household status sources. Home
Assistant's visual card editor still selects House/standard layout, colours and
navigation display. This boundary is explained in the settings themselves.

Buttons link existing Home Assistant scenes, scripts and automations. Creating
the underlying automation rules still happens in Home Assistant's own editor.
Successful request feedback does not claim the physical device responded.

## Verification

The final frozen source passed **6,643/6,643 tests in 207 files**, build, lint and
bundle freshness. Both frontend copies have SHA-256
`ab416be0cd92c4002b814a801ce0bc4c296a2458cc05ddd58aa644dcc5310bd6`.

| Final native browser check | Result | What it verified |
|---|---|---|
| Room sheets, built card | 149/149 | House/standard overlays, unchanged viewport and camera, actual widths 739/740/959/960/320, short-card scrolling and reachable controls |
| House with an actual simulated GLB, built card | 84/84 | House geometry, room/device panels, navigation, native interaction and cleanup |
| Custom left actions, built card | 23/23 | Desktop/phone favourites, More, exact action routing, outside dismissal, keyboard controls, saved placement and sticky Save/Cancel |
| Feedback, source and built card | 88/88 | Real save/action reply ownership, failures, connection recovery, drafts and unchanged renderer |

These **344 checks** ran on the final `ab416be0` build with zero browser errors
and all owned browser/fixture handles closed. Editor/setup/house-file review
also passed 118/118 source-and-bundle checks on the preceding `6a87e874` build.
That editor code is unchanged; the later source change corrected Cars guidance
in four languages. The final full test suite includes that wording update.

The installable local candidate is
**`taylors3d-phase23-ui-review-local-candidate.zip`**, **870,296 bytes** and
**20 files**. Every member matches the integration source or the unchanged root
MIT LICENSE; its frontend matches the final hash above. ZIP SHA-256:
`7782f16da255c8e4a3f9f840aed7fadc2e12cd937487302b32bc8219132a7e7e`.
The earlier Phase 22 ZIP remains available for returning to that checkpoint.

Browser checks use the real card and simulated Home Assistant data. Earlier
Phase 22 visual matrices and feature receipts remain earlier evidence; this
review does not claim an exhaustive new matrix or physical device tests. Linux
Home Assistant compatibility, actual household acceptance and current GitHub CI
remain separate checks. No new release was published or installed.

The new review includes a full changed-file list below. Build output is listed
separately because generated files are not included in the source Git diff.

## Real Home Assistant acceptance

Back up your dashboard and original model. Use a separate `polish-test` layout.
Installing a new Taylor's 3D integration build updates all its cards on that HA
instance; a separate layout isolates edits, not the installed program version.

Test your actual model, shared saving after refresh/restart, light and scene
responses, live camera feeds and unavailable-device messages. Try desktop,
phone and the actual wall tablet: open a room, scroll its controls, close it,
and confirm the house stays the same size. Try moving one existing action
between bottom and left bars, then Save, refresh and check it again.

This review does not push, publish, tag or install a version.

## Files changed in this review

Source, tests and documentation: 59 files.

- `CLAUDE.md`
- `docs/HOUSE-VIEW-GUIDE.md`
- `docs/UI-POLISH.md`
- `docs/UI-REVIEW.md`
- `README.md`
- `REQUIREMENTS_AND_FEATURES.md`
- `scripts/custom-controls-polish-check.mjs`
- `scripts/editor-navigation-check.mjs`
- `scripts/floor-panels-check.mjs`
- `scripts/house-check.mjs`
- `scripts/model-check.mjs`
- `scripts/room-sheet-check.mjs`
- `scripts/security-check.mjs`
- `scripts/tracking-check.mjs`
- `src/card-editor.js`
- `src/custom-controls-editor.js`
- `src/custom-controls-view.js`
- `src/custom-controls.js`
- `src/device-popup.js`
- `src/edit-mode.js`
- `src/editor-navigation.js`
- `src/house-categories.js`
- `src/house-shell-layout.js`
- `src/house-shell.js`
- `src/room-sheet.js`
- `src/taylors3d-card.js`
- `src/taylors3d-theme.js`
- `src/tracking-editor.js`
- `src/translations/card-settings.js`
- `src/translations/custom-controls.js`
- `src/translations/de.js`
- `src/translations/editor-navigation.js`
- `src/translations/en.js`
- `src/translations/es.js`
- `src/translations/fr.js`
- `test/ambient-idle-card.test.js`
- `test/card-setup-and-sheet.test.js`
- `test/custom-controls-card.test.js`
- `test/custom-controls-editor.test.js`
- `test/custom-controls-view.test.js`
- `test/custom-controls.test.js`
- `test/device-popup-owned-category.test.js`
- `test/edit-ambient-idle.test.js`
- `test/edit-environment.test.js`
- `test/edit-floor-presentation.test.js`
- `test/edit-furniture-integration.test.js`
- `test/edit-house-summary.test.js`
- `test/edit-model-rendering.test.js`
- `test/edit-scene-preview.test.js`
- `test/edit-security.test.js`
- `test/edit-tracking.test.js`
- `test/edit-wall-presentation.test.js`
- `test/editor-navigation.test.js`
- `test/floor-panels-settings.test.js`
- `test/house-categories.test.js`
- `test/house-shell-layout.test.js`
- `test/house-shell.test.js`
- `test/room-sheet.test.js`
- `test/tracking-editor.test.js`

Generated build output:

- `dist/taylors3d-card.js`
- `custom_components/taylors3d/frontend/taylors3d-card.js`
- `dist/demo.js` (browser-demo helper; not in the integration ZIP)
