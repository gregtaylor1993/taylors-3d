# Separating floors in Taylor's 3D

Floor presentation rearranges the picture of your house. Your real floor heights,
room outlines, device locations and saved Home Assistant settings keep their
original coordinates. This matters because you can return to the assembled house
without having to move every light or sensor back into place.

This implementation uses one house view and its existing renderer. Side by side
shows measured floor footprints together in that view; it does not create several
independent camera panels. Stacked layers add space between the existing storeys.

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
6. Select **Save floor view**, then leave Edit to see it. Editing uses the assembled
   house so picking and placing new objects still use the real model coordinates.

**Cancel** discards an unfinished draft. Save is one step in the existing Undo/Redo
history. Opening settings, changing a draft or cancelling sends no device commands.
The draft survives ordinary sensor updates. If the house, floor links, saved
settings or account change, cancel and reopen before saving it.

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

The mini-map stays a north-up plan of the selected original floor. Its camera
indicator converts the displayed view back to that floor; tapping a room focuses
its displayed position. A saved camera for one exact floor moves with that floor.
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

All floors share the existing renderer and fixed light pool. Separating floors
does not add a second renderer or increase the light budget. The default assembled
setting leaves existing camera animations, previews and idle behavior running.
Unchanged Home Assistant readings do not repeat the floor transformation.

Source-model export has a guarded internal clone operation that removes owned
display offsets without moving the live house. This is a runtime foundation;
there is no new GLB export button in this feature. The existing layout JSON backup
continues to store canonical layout data and the saved display policy.

Automated source/bundle browser checks and exact-commit packaging are being
completed. Simulated test floors are not proof that Taylor's actual GLB has the
required groups or that the real wall panel performs well.

## Check your own Home Assistant

1. Keep a layout backup, confirm the model's explicit storey links, and try two
   floors with Side by side. Confirm the spacing follows their actual footprints.
2. Tap a room and a bound device on each floor. Check the correct controls open
   beside the house and the mini-map focuses the correct displayed location.
3. Check lights, an alert and any configured camera/tracked entity. Confirm each
   stays on its own floor, and the displayed scene still reflects actual readings.
4. Try Stacked layers, then Normal. Check room/device positions and your current
   camera. Try a close zoom as well as an overview.
5. Open Edit and Section, then close them. Confirm they use the assembled house
   and the saved arrangement returns. Try Save, Cancel, Undo and Redo.
6. Test on the wall panel at its actual size and in both themes. Record missing
   links, clipping, slow frames or unreachable controls in the feature log before
   marking household validation complete.
