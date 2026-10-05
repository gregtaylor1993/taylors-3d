# House layout for Taylor's 3D

This layout follows the supplied desktop and phone design references. Its dedicated
browser checks pass with both drawn rooms and a loaded 3D model. The project guide
identifies which installation package has completed the wider regression checks;
use that package until a newer checkpoint is listed there.

## Choose the layout

1. Edit your Home Assistant dashboard and open this card's visual settings.
2. Under **House appearance**, choose **House with navigation and room panels**.
3. Choose **Dark graphite**, **Light**, or **Home Assistant colours**.
4. Save the card settings.

New cards start with the dark House layout. Existing cards keep their standard
layout until you choose House. The selector changes how the card looks; it does
not replace your house model, floor links or devices.

On a wide card the menu runs down the left and room/device controls open on the
right. A narrow card uses a scrolling bottom menu and a room sheet above it.
The card reserves space for these controls and keeps at least 240 pixels of
house-view height, expanding the card if needed. This also works when a narrow
card sits inside a wide browser window.

## Use your real sources

As an administrator, choose **Settings** in the House menu. The card opens
**Edit → House**. Set an optional house title, choose a weather entity, add the
people you want counted, and choose an alarm entity. Save once when ready;
Cancel, Undo and Redo let you recover your earlier choices.

A blank title follows Home Assistant's location name. Unselected status sources
stay out of the header. A source you selected that later becomes unavailable is
labelled clearly. Weather uses the temperature and units reported by that entity;
people counts use the selected people's actual home state. An alarm's reported
state does not prove that every door is safe or locked.

The **Lights**, **Security**, **Media** and **Climate** menus show eligible current
Home Assistant entities. Hidden, disabled and diagnostic entities stay out of
everyday controls. Unavailable entities remain readable with their commands
disabled. **Cars** uses the vehicle sources you explicitly set in **Edit →
Tracking**; a car-like entity name or ordinary motion sensor is not evidence of a
parked vehicle. An empty category explains that no source is configured.

## Room and device controls

Tap a room floor or a device to open its existing controls. Light brightness and
colour controls appear when that light supports them. **All controls** opens Home
Assistant's own entity panel; camera rows can open their live view. Reading a
panel does not send a device command. You must deliberately press a command or
change a control to act on the device.

Floor/view chips and the bubble bar continue to operate the same house view.
The 2D mini-map and the model use the same saved room coordinates. Header, menu
and room controls use CSS and ordinary interface elements, so they do not add a
second 3D renderer or increase the realtime light cap.

## Verify on your own dashboard

Check both a phone-sized card and your wall panel. Try a room, a light, a camera,
an unavailable entity and a saved floor view. Confirm that controls remain visible,
that changing an actual device updates Home Assistant, and that missing readings
are labelled honestly. Test keyboard Tab and Escape if you use a keyboard.
Automated simulated checks do not replace this household verification.
