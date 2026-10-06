# Separating floors in Taylor's 3D

Floor presentation rearranges the picture of your house. Your real floor heights,
room outlines, device locations and saved Home Assistant settings keep their
original coordinates. This matters because you can return to the assembled house
without having to move every light or sensor back into place.

The Phase 20 local candidate adds optional separate pictures for horizontal floors.
These floor panels share camera movement and the existing renderer. Its complete
local checks and 20-member installation ZIP are recorded in the
[Phase 20 checkpoint](../REQUIREMENTS_AND_FEATURES.md#phase-20-020-local-checkpoint).
The frozen Phase 19 candidate and evidence remain historical. Actual Home Assistant,
your house model and wall-panel validation remain separate.

With the panel option off, Side by side shows measured floor footprints together
in one picture. Stacked layers add space between the existing storeys in one
picture. The normal assembled house remains the default.

## Choose an arrangement

1. Open **Edit → Model → Floor presentation** with your administrator account.
2. Choose **Normal (assembled)**, **Side by side** or **Stacked layers**.
3. Choose up to four current floors. Use **Up** and **Down** to set their order.
   When the saved policy has no explicit floor list, current floors are ordered by
   their original elevation and exact ID. A saved empty list is an explicit empty
   choice, rather than a request to guess floors.
4. Set **Additional spacing, metres**. Side by side uses each measured footprint
   plus this gap. Stacked layers add this gap between successive layers while
   keeping the real height differences.
5. For Side by side, choose East or North and the display height. These settings
   change only the picture.
6. For Side by side, optionally turn on **Separate floor panels**. This gives each
   selected floor its own picture. The option applies to the horizontal arrangement;
   it is retained without applying panels in Normal or Stacked layers.
7. Select **Save floor view**. Editing uses the assembled house so picking and
   placing new objects still use the real model coordinates.
8. With a GLB, open **Edit → Views**, choose **All** or your intended overview in
   the **View** list, and tick the current floors you want under **Linked HA
   floors**. Keep those model storeys visible in that view's model tree. Floor
   links save as you change their checkboxes.
9. Leave Edit and choose that **All** or overview view. Panels show the floors
   chosen for separation that the current view also allows. Without a GLB, the
   standard All view allows all current floors by default. A single-floor view
   restricts the panels accordingly.

**Cancel** discards an unfinished draft. Save is one step in the existing Undo/Redo
history. Opening settings, changing a draft or cancelling sends no device commands.
The draft survives ordinary sensor updates. If the house, floor links, saved
settings or account change, cancel and reopen before saving it.

## Use the separate floor panels

There are two floor choices. **Floor presentation** chooses which floors to
separate. **Edit → Views → Linked HA floors** chooses which Home Assistant floors
a particular view allows. Separate panels respect both choices.

With a GLB, the buttons come from the model's `fp.views` tags or its generated
storey views. Without a saved floor assignment, a model view normally follows the
Home Assistant floor linked to its highest visible storey. A button named All
therefore does not automatically allow every Home Assistant floor. If it shows
only one panel, check its Linked HA floors and the model tree in Edit → Views;
adding panels does not replace the model's existing show/hide rules.

Up to four selected floors have their own framed pictures. When the house drawing
is wide enough, the panels form columns. A narrow drawing, including a phone,
stacks the pictures vertically. The layout follows the available card space, so
opening room/device controls or resizing the card can change it.

Rotation, pan and zoom are linked: moving the house in one panel moves the other
panels in the same way. Each picture stays framed around its own floor. This local
version uses shared controls; independent movement for each panel is a possible later choice.

Tap a panel's floor-name header to make that floor active for the mini-map. Tap a
mini-map location to focus the selected floor there. A room or device tap uses that
panel's floor and opens its normal controls. The view button and the panel headers
are different controls: the view chooses which floors are allowed; a header
chooses the floor the mini-map follows.

Panel views need clear floor ownership. An item with an unknown or conflicting
floor is not copied into every panel. Repair its explicit floor link instead.
Known room overlays, alerts, camera coverage and tracked actors remain with their
own floor; their real readings and saved locations stay unchanged.

## Link model storeys deliberately

For a GLB, each storey must be a distinct, current model group linked explicitly
to a Home Assistant floor. Confirm those links in the existing Model level controls.
Automatic name/height suggestions are not sufficient to move geometry safely.

Every visible model mesh must belong to one unambiguous storey group, or to a
separate group explicitly assigned to no floor. That lets a driveway or other
background stay in its original place. A roof shared across storeys, one mesh
containing several floors, nested floor groups or a missing link produces a
diagnostic and leaves the house assembled. The card does not split your GLB mesh
or infer room/floor ownership from its name.

Ordinary rigid door hinges inside a floor remain supported. Skinned or animated
floor geometry and competing writers of the floor group's transform are not
supported by this presentation. The original model file is preserved.

Without a GLB, drawn room outlines provide the footprints. Each chosen floor needs
usable source room polygons and a unique finite elevation. Repair missing floor
IDs or outlines instead of matching them by a similar name.

## What follows each floor

Room drawing, light positions, device labels and popups use the displayed floor.
Temperature/energy overlays, alerts, camera cones, weather masks and configured
presence/vehicle/vacuum symbols receive display copies of their real positions.
Their source readings and calibration are preserved. A measured mower uses its
reported current floor, even when its original GLB parent belongs to another one.

The mini-map stays a north-up plan of the selected original floor. In separate
panels it follows the active floor-name header and that panel's camera. Its camera
indicator converts the displayed view back to that floor; tapping a room focuses
its displayed position using the linked controls. A saved camera for one exact
floor moves with that floor.
An overview is framed around the displayed arrangement instead of receiving an
arbitrary single-floor offset.

Returning to Normal restores an untouched camera at full precision, including
its zoom/framing limits. Deliberate movement on a single floor is converted back
to source coordinates. An overview moved after a scope change has no unique
single-floor conversion, so it is fitted to the assembled house.

**Section** temporarily assembles the house for its cut and resumes the saved
arrangement when closed. Loading another house, losing the active connection or
editing also suspends the presentation. These suspensions do not rewrite the
saved policy. Unknown imported fields and unavailable references are kept for
deliberate repair.

## Rendering and verification

All floors share the existing renderer, scene and fixed light pool. Separate panels
draw different parts of that scene into different rectangles of the same canvas;
they do not add another renderer or increase the light budget. Each panel has its
own camera framing and floor labels, while controls remain linked. Rendering more
pictures still costs work, so check performance on the actual wall panel. The
default assembled setting leaves existing camera animations, previews and idle
behavior running.
Unchanged Home Assistant readings do not repeat the floor transformation.

Source-model export has a guarded internal clone operation that removes owned
display offsets without moving the live house. This is a runtime foundation;
there is no new GLB export button in this feature. The existing layout JSON backup
continues to store canonical layout data and the saved display policy.

Phase 20 passes the complete local unit run, lint/build/bundle matching and all
30 declared native scripts on unchanged runtime source. The local ZIP's 20 entries
and frontend bytes are verified. These browser scenarios use simulated HA; they
do not prove that your actual GLB has the required groups or that the real wall
panel performs well. Actual installation, Linux HA/current CI and public release
remain separate. Earlier Phase 19 records retain their own historical results.

## Check your own Home Assistant

1. Keep a layout backup, confirm the model's explicit storey links, and try two
   floors with Side by side. Confirm the spacing follows their actual footprints.
   Turn on Separate floor panels and save. With a GLB, use Edit → Views to select
   All or your overview and link the intended HA floors. Leave Edit, choose that
   view, and confirm each allowed selected floor has a panel.
2. Tap each floor-name header and check the mini-map changes to that floor. Tap a
   map location and check that panel focuses there while camera movement remains
   linked. Tap a room and a bound device in each panel; check the correct controls.
3. Check lights, an alert and any configured camera/tracked entity. Confirm each
   stays on its own floor, and the displayed scene still reflects actual readings.
4. Rotate, pan and zoom, then resize the card and open room/device controls. Check
   all panels remain usable, correctly framed and linked. Try Stacked layers,
   then Normal; check room/device positions and your current camera. Try a close
   zoom as well as an overview.
5. Open Edit and Section, then close them. Confirm they use the assembled house
   and the saved arrangement returns. Try Save, Cancel, Undo and Redo.
6. Test two to four selected floors on a wide card and a narrow phone view, on the
   wall panel at its actual size and in both themes. Record missing
   links, clipping, slow frames or unreachable controls in the feature log before
   marking household validation complete.
