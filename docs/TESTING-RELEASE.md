# Taylor's 3D 0.4.0-beta.1 — testing release

**Published:** [v0.4.0-beta.1](https://github.com/gregtaylor1993/taylors-3d/releases/tag/v0.4.0-beta.1)
has both `taylors3d.zip` and `taylors3d-card.js` assets. All release unit tests,
version checks, build and bundle checks passed. GitHub initially returned
HTTP 500 during publication; an unchanged retry succeeded. The downloaded
published ZIP matches the verified manual package exactly. Use HACS below or
download the install ZIP directly from the release.

This package includes the current 0.4 UI: dark/light glass styling, room and
device controls that overlay the house, custom bottom/left/room bars, guided
settings, room-first display, configurable House navigation with phone More,
and search across rooms, devices, scenes, views and settings.

## Before installing

Export your current layout/dashboard and keep your previous installation package.
The new integration/card program replaces the version used by every Taylor's 3D
card on this Home Assistant instance. A separate dashboard isolates your test
layout, not the installed program version.

This is a testing prerelease. The preceding implementation passed 6,813 local
JavaScript tests and focused browser checks. Build, lint and bundle freshness are
rechecked for this package; the release workflow also runs the complete unit
suite before publishing its assets. The broader GitHub browser suite is not fully
green: some checks expect the old UI; dragging, very short mobile panels and
Tracking editor flows still need verification. This package does not claim
physical-device or wall-panel acceptance.

## Install with HACS

1. Add `https://github.com/gregtaylor1993/taylors-3d` as a custom repository of
   type **Integration**, if it is not already listed.
2. Open Taylor's 3D in HACS and choose **Download** or **Redownload**. Use the
   version selector to choose **v0.4.0-beta.1** explicitly. Do not choose v0.1.0
   when you want this new UI. Depending on your HACS version, the selector may
   be labelled **Need a different version?** or require **Show beta versions**.
3. Restart Home Assistant, then hard refresh your browser (Ctrl+Shift+R on
   Windows/Linux or Cmd+Shift+R on Mac). Clear the companion app cache if needed.
4. For a first installation, use **Settings → Devices & services → Add
   integration → Taylor's 3D**.
5. Add Taylor's 3D to a separate test dashboard. In its visual card settings,
   set **Layout name** to `taylors-beta-test`, choose the House layout and
   Dark glass or Light glass, and save. Existing cards retain their settings.

## Manual ZIP installation

Use the release asset named **taylors3d.zip**, or the equivalent supplied
**taylors3d-v0.4.0-beta.1.zip**. GitHub's Source code ZIP is not the install
package. Extract the testing ZIP's contents directly into
`/config/custom_components/taylors3d/`. The resulting folder must directly contain
`__init__.py`, `manifest.json` and `frontend/taylors3d-card.js`; do not create a
second nested taylors3d folder. Then restart and follow steps 3–5 above.

The integration loads the dashboard card automatically; no separate JavaScript
resource is required. The card logs **taylors3d-card 0.4.0-beta.1** in the browser
console, which helps identify an old cached bundle.

## First household checks

Upload your GLB in the card's Edit mode, link its floors/rooms, and save. Try
Rooms/Important activity/All devices, More, Search and a room popup. Verify that
opening controls leaves the house size and camera unchanged. Operate one harmless
light deliberately and confirm its real response. Save a menu/default change,
reload, and confirm it remains. Test dragging and short phone panels carefully;
they are part of the outstanding broader browser checks.

The [navigation guide](SMART-NAVIGATION-GUIDE.md) and
[UI guide](UI-POLISH.md) explain the controls in more detail.
