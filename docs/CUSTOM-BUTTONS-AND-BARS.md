# Custom buttons and bars

This is the `0.3.0` development feature. It is not included in the tested `0.2.0`
ZIP or the existing HACS release.

The builder works inside Taylor's 3D. A bar is a named group of buttons, such as
Evening or Garden. It can appear below the house or in one room's control panel.
A button has its own name, icon, colour and selected action.
Bottom bars follow the card's existing Show bubble bar setting. Enable it when
you want bottom controls visible. Room bars appear in the selected room's panel.

## What is already available in 0.2.0

- The existing bubble bar lets you choose built-in controls and reorder them
  using Up and Down. Saved camera views appear there too.
- Edit → Rooms → Room shortcuts adds named buttons for existing scenes and scripts.
- Devices and furniture can be dragged within the house.

The new builder adds custom bars, richer buttons and drag-and-drop ordering.

## How to use it

1. Open Edit → Buttons and bars, then choose Add bar.
2. Name the bar and choose Bottom bar or Room panel. For a room panel,
   choose the exact room.
3. Add a button. Choose its label, MDI icon, colour and action.
4. Drag the handle to move a bar or button. Up/Down and Move to offer keyboard
   alternatives. Choose Save to keep the arrangement.
5. Leave Edit and deliberately press a button to run its action.

For example, Movie can run your saved scene; Return vacuum can run an existing
script; Front door can select your saved camera view. A Run automation button
links to an automation already created in Home Assistant. It checks that
automation's conditions unless you deliberately choose Skip conditions.

A scene applies a saved setup. A script runs a saved sequence of actions.
An automation starts a sequence when a trigger happens and can check conditions.
This builder links to these existing items. Create automation triggers,
conditions and actions in Home Assistant's own visual automation editor, then
choose that automation for your button. A script is usually the easiest way to
make a reusable button routine. Pressing an automation button runs its actions;
it does not recreate an event such as a doorbell ring. An automation can be run
manually even when its automatic triggers are switched off.

Choose **Toggle entity** for lights, switches, fans and input booleans whose
integration advertises a toggle action. Choose **More info** to open Home
Assistant's full controls for an entity. Other device commands can be placed in
a Home Assistant script and linked with **Script**.

You can save up to eight bars and twelve buttons per bar. Names can be eighty
characters long. MDI icons use names such as `mdi:movie` or `mdi:door`.

Save and Undo change the layout, not actions already sent to devices. Dragging,
editing, importing and previewing buttons send no device commands. Missing or
unavailable saved sources stay visible with a reason and cannot run.

## Test the candidate

Check adding and dragging two bars, moving a button between them, Cancel,
Save/reload and Undo/Redo. Then check one scene, script, automation, saved view,
device toggle and All controls. Compare real actions with Home Assistant.
Repeat on a phone and wall panel, and export/import the layout to confirm the
buttons remain. Actual-house acceptance is separate from automated browser tests.
