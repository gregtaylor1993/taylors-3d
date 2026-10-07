# Taylor's 3D — glass appearance

Taylor's 3D now uses one calm visual style throughout the card: rounded controls,
clear labels, black-and-white navigation and subtle glass on floating panels.
The house stays the main feature. You can choose a dark or light version.

Frosted glass means a slightly transparent surface that softly blurs the picture
behind it. We use it on floating controls and popups so they feel part of the
house view. Settings use solid surfaces because labels and fields need to be
easy to read while you make changes.

## Choose your colours

1. Edit your Home Assistant dashboard and open the Taylor's 3D card's visual editor.
2. Open **Appearance → Card colours**.
3. Choose **Dark glass**, **Light glass** or **Home Assistant colours**.
4. Press Home Assistant's **Save** to keep the card settings.

**Dark glass** uses deep charcoal backgrounds and bright selected controls.
**Light glass** uses white and pale grey backgrounds with dark selected controls.
**Home Assistant colours** follows your dashboard's colours while retaining the
same Taylor's 3D shapes and spacing. Only this card and its settings change;
other dashboard cards and Home Assistant's surrounding menus keep their own style.

The colours work in both layouts. **Appearance → Card layout** chooses
**House with navigation and room panels** or **Standard card**. House adds its
header and navigation; Standard keeps the simpler presentation. Changing the
appearance does not replace your model, move devices or run a house action.

## What should look consistent

- The bottom banner, floor/view buttons, mini-map and custom bars share the same
  typography, spacing and rounded controls.
- Room/device popups float over the drawing. Opening or resizing one keeps the
  house's size and camera unchanged; scroll inside the popup for more controls.
- Custom left-menu bars also overlay the house. Their first outside tap closes
  the menu; it does not accidentally activate what was behind it.
- Settings, the button builder and save/review messages use clear solid surfaces.
- Buttons have comfortable touch targets and visible outlines when reached with
  the keyboard. A selected view looks different from an unselected view.
- The newer room chooser, phone House **More** menu and **Search** use the same
  surfaces and readable controls. They keep the drawing size unchanged; their
  controls are explained in the [navigation guide](SMART-NAVIGATION-GUIDE.md).

The design remains informative. Actual light colours and brightness still show
in the house. Warnings and alerts retain their meaningful colours. If you chose
a colour for a custom button, that choice stays saved and visible. Neutral
buttons use the common black-and-white palette. A colour alone never proves
that a real device has responded; its Home Assistant reading remains the source.

## Comfort and older browsers

The app respects the reduced-motion preference supplied by your operating
system/browser, removing interface transitions where supported. Its existing
idle-motion safeguards continue to apply.

If your browser exposes **Reduce transparency**, floating glass becomes solid.
When background blur is unsupported, the card also uses solid surfaces. The
controls remain available in either case. These are device/browser preferences;
there is no extra Reduce transparency switch in Taylor's 3D.

Native Home Assistant selectors and entity panels retain their normal behaviour.
The card editor passes local colour variables to its form; the app does not
replace Home Assistant's own controls or apply a theme to your entire dashboard.

## Your saved setup stays compatible

Only the visible names changed from Dark graphite and Light to Dark glass and
Light glass. The saved values are still `house_colour_scheme: dark`, `light`
or `ha`; `layout_style: house` and `original` also remain unchanged. Existing
models, linked rooms/devices, custom buttons and automation targets keep their
saved meaning. No manual YAML rename is required for these appearance options.

## Try it on your own screens

Use a build/package verified for this appearance change. Older installation
packages and test receipts describe earlier checkpoints; they do not include
this style merely because they have the same development version number.

On your phone and wall panel, try both colour choices. Open a room, a device,
the custom left menu and settings. Check that the house stays the same size,
long labels remain readable and the popup scrolls. Try keyboard Tab and Escape
if you use a keyboard. Check that your coloured custom buttons and actual light
colours remain distinguishable. If available, turn on your device's reduced
motion/transparency preferences and check that the controls remain usable.

For the newer room/menu/search features, compare **Rooms**, **Important activity**
and **All devices**. Open a crowded view's Rooms chooser and the phone's House
More menu. Search for a device and an in-card setting, then save a menu/default
choice in the HA visual card editor and check it after reloading.

Browser previews use simulated Home Assistant readings. Your actual Home
Assistant verifies native controls, your model, shared storage and physical
device responses. A successful local visual check does not prove that a real
lamp or camera worked.

## Final design review follow-up — 7 October 2026

The later [final review](FINAL-DESIGN-REVIEW.md) includes three small popup and
keyboard-focus fixes, with their own historical build/package receipt. Taylor
then approved room-first display, a customisable House menu with phone More,
and Search. Those features are implemented in source; see the
[feature log](../REQUIREMENTS_AND_FEATURES.md) for their combined checks and
Git delivery at the current checkpoint.
The Phase 24 checks and ZIP below predate both follow-ups. Recent activity and
an explicit Glass effects switch remain future ideas.

## Preceding verified local candidate — 7 October 2026

The final local build passed **6,662/6,662 unit tests** in 207 files, project
lint, build and source/bundle freshness checks. A run overlapping several
browser programs reached test time limits; the unchanged full suite passed
with four workers and the same time limits. The earlier failure log is retained.

The glass browser check passed **1,535/1,535 assertions** across 268 scenarios
against both source and built card. It checks House and Standard, desktop and
phone widths, both popup placements, custom bars, both settings editors, focus,
44px targets, reduced motion/transparency and unchanged scene/camera on overlays.
All 138 recorded runtime files stayed unchanged during that audit.

The broader built-card visual matrix passed **5,282/5,282 assertions** across
864 views: English, German, French and Spanish; dark/light/HA colours;
1400px/320px; ordinary/reduced motion; editor, room, More and feedback states.
Minimum measured caption contrast was **5.76:1**. That matrix caught a dark-HA
Remove model caption with low contrast; the corrected fallback now passes.

The local preview uses a generated sample house and simulated devices. Desktop
dark/light and phone dark were checked in Chrome with no browser errors. The
preview opens the existing Exterior view and has no connection to Taylor's HA.

Both frontend copies have SHA-256
`3117402b3d6704a7283d835a7294e9578d242f0b9676a2168871f221d94d347c`.
The 20-member `taylors3d-phase24-glass-local-candidate.zip` was compared byte for
byte with the current integration and LICENSE. ZIP SHA-256:
`3def56fa0855034c6be95c1974e14022b11e38d55b7302b03a28906c02478d28`.

At that checkpoint this was a **local, uncommitted test candidate**. No push, tag,
HACS release or installation was performed by that work. Real HA selector internals, physical devices,
Taylor's model, wall-panel performance and current GitHub CI still need their
own acceptance checks. The new browser check is included in future GitHub CI;
run it locally with `npm run check:glass-theme` when Chrome is configured.
