# Change settings without YAML

These additions are in the local combined test candidate. They still need the
complete combined checks and actual Home Assistant persistence checks.

The **Scenes**, **Room shortcuts**, **Environment** and **House summary** editors
offer an area filter for their source lists. This uses actual Home Assistant
areas, including an area inherited from a device. It keeps saved choices visible
and changes only the list you are browsing; it does not save or move a device.

There are two visual editors. **Home Assistant's card editor** saves options for
this dashboard card. The card's **Edit** tabs save its Taylor layout. The layout
can be shared across screens; card options belong to the individual card.

## General card options and imported setups

Use Home Assistant's dashboard edit mode, choose the Taylor card, and open its
visual card editor. Under **Appearance → Card layout**, choose House or Standard
card. Under **Appearance → Card colours**, choose **Dark glass**, **Light glass**
or **Home Assistant colours**. These colours apply to both layouts and to this
card's settings, while the rest of your dashboard keeps its own theme. See the
[glass appearance guide](GLASS-APPEARANCE-GUIDE.md).

Choose toolbar options, mini-map size,
starting floor and **Starting named view (exact ID)** there. A view's exact ID is
shown in **Edit → Controls → Views**. Leave the field blank to use the existing starting-view
fallback. Press Home Assistant's **Save** to persist the changed card options.

Imported card settings can take priority over shared layout settings. The source
inspection controls show the exact saved settings and offer deliberate choices:

- **Use uploaded model** removes the card's URL-model and alignment overrides.
  It keeps the uploaded model, furniture, layout, rendering settings and unknown
  settings intact.
- **Use automatic model floor mapping** removes the card's explicit imported
  floor map. Model level assignments remain available in the Model tab.
- **Use shared layout settings** removes the selected named-view override only.
  It keeps the other named-view overrides.

These choices change the draft card configuration. Read the displayed change,
then press Home Assistant's **Save**. They do not modify a model file or change a
device. Very large or malformed imported settings may remain read-only so they
cannot be partially cleared by mistake.

## Model, tracking, cameras and alerts

**Edit → House → Model** includes exact numeric model-position fields and the full
supported opacity range, including zero. Coordinates describe the original house
model, before visual floor separation. Changing one position field keeps the
other coordinates intact. The lighting choices also include realtime shadows
with lamps off; this changes the picture, not the real lights.

The drawn-plan floor measurements already live in **Rooms → Advanced (no model)**.
An uploaded GLB keeps the floor geometry authored in that file; use its Model
level assignments to connect it to Home Assistant floors.

**Tracking** has optional symbol colour, size, direction and supported age rules.
Measured vacuum smoothing works only between actual position samples. It does
not invent a cleaning route. A short camera vehicle sighting and a maintained
"car parked" sensor are different sources; use a maintained source to show a car
while it remains on the drive.

**Cameras** has an optional curve-detail setting and current area filters. The
coverage remains an approximate sector you configure, not a measured camera cone.

**Overlays** gives an alert an explicit location: a room, an exact marker, or
fixed coordinates on a chosen floor. Missing saved locations remain visible for
deliberate repair. A stored Home Assistant reading waits for current evidence;
previously confirmed latched alerts retain their acknowledgement rules.

Use **Save**, **Cancel**, **Undo** and **Redo** in the applicable layout editor.
Typing or previewing a visual setting does not send a device command.

## GPS vacuum positions

In **Tracking**, edit a measured vacuum and open its calibration controls. Choose
**GPS latitude/longitude** only when your integration supplies real GPS readings.
Select the actual latitude and longitude attribute paths, measured in degrees.
Capture at least two different real positions and click their matching places on
the plan. The card fits those pairs; it does not assume which way north faces.

X/Y map coordinates and GPS degrees describe different coordinate systems. When
changing between them, deliberately clear the old calibration pairs and capture
new ones. A saved GPS source remains intact until you choose to edit it. A missing
source is a warning, not a reason to substitute another device automatically.

## Mower map image detection

When the **Mower** tab uses an image source, **Minimum matching pixels** controls
how many pixels must match the chosen icon colour in the sampled map. The default
is four. Increase it if small patches of the same colour are mistaken for the
mower. Zero or one allows a single matching pixel. It changes image detection;
it does not move or command the mower. This setting also joins Undo and Redo.
