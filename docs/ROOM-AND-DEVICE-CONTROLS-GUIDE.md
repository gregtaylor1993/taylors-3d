# Room and device controls

This guide describes the combined local test candidate. It has not yet replaced
the published HACS release. Browser and actual household checks are recorded
separately in the requirements log.

## Open a room or device

Choose the **House** appearance in Home Assistant's visual card editor, then save
that card. Tap a room in the house. On a wide screen its controls appear to the
right; a narrow screen uses a sheet above the bottom menu. Close the panel to
return to the full house picture.

The room needs an explicit room/floor assignment. Its list uses the Home
Assistant area linked to that room. An empty list means there are no eligible
devices in that linked area; the card does not invent devices from the picture.
Tap an individual device to open its own panel.

## Add room shortcuts

As a Home Assistant administrator, open the Taylor card's **Edit → Rooms** tab.
In **Room shortcuts**, choose the exact room, then a current scene or script.
Choose **Add selected shortcut**, type its button label and use **Move up** or
**Move down** to arrange the buttons. Choose **Save room shortcuts** when ready.

A **scene** applies a saved Home Assistant setup, such as a lighting combination.
A **script** runs actions you have already created in Home Assistant. This editor
links to those existing items; it does not create them or run them while editing.
The buttons run only when deliberately pressed in the viewing panel.

Saving the list counts as one layout edit, so **Undo** can reverse it and **Redo**
can restore it. **Cancel** discards the unsaved list. Undo changes the saved
buttons; it does not reverse an action already sent to a real device.

A missing saved scene or script keeps its exact identifier and shows a warning.
Choose a replacement explicitly. An unsupported imported list is preserved until
you deliberately choose to replace it and save.

Use **Filter devices by Home Assistant area** to shorten the source list.
**All areas** shows the full eligible list; **No assigned area** shows devices
without an area. Saved choices remain visible so filtering cannot replace them.

If an old saved room is no longer in the house, select its exact saved entry and
choose **Remove this saved room**, then **Save room shortcuts**. This deliberately
removes that room's shortcut list, including its extra imported settings. It does
not remove a Home Assistant area or a room from the model. Cancel and Undo work
as they do for other layout edits.

## Direct device controls

The popup offers controls that the actual entity and Home Assistant currently
support. Depending on the device, these include:

- Lights: on/off, brightness and supported colour settings.
- Media players: playback, track changes, volume and mute.
- Thermostats: a reported single target temperature and supported operating modes.
- Blinds/covers: open, close, stop and supported position settings.
- Locks: lock and unlock when the device does not require a code.
- Vacuums: supported start, pause, stop, return to dock and fan speed.

**All controls** opens Home Assistant's own device screen for other options, such
as temperature ranges or a lock code. A camera uses Home Assistant's available
viewer; an actual working stream still depends on its integration.

Typing a value keeps your unfinished draft. A separate actual reading shows what
Home Assistant reports. A request being sent is not proof that the physical
device has reached the requested state; wait for its reported update. Errors
remain visible rather than changing the displayed reading optimistically.

## Alerts on the mini-map

The mini-map shows an alert at the original plan position on its assigned floor.
Tapping its symbol opens Home Assistant's details. It does not acknowledge the
alarm, move the main camera or send a device command. A confirmed clear removes
the symbol; unavailable or stored readings stay labelled uncertain. A previously
latched alarm keeps its existing acknowledgement rule.

## Check with your own house

Try one room shortcut and one device at a time. Confirm the selected room/floor,
the exact device, the action Home Assistant receives and the later reported
result. Also test a disconnected or unavailable source. This verifies your actual
integrations, which simulated browser tests cannot certify.
