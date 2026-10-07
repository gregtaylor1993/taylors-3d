# Using the new Taylor's 3D controls

The house layout is shared by your Home Assistant users. A screen name belongs to the browser
on one panel. This lets several panels show the same house while an automation selects just
one of them. New features are tested with the mock Home Assistant preview; the feature log
keeps testing on Taylor's real installation visible.

For people/activity, parked vehicles and measured vacuum positions, use **Edit → Devices → Advanced tools → Tracking** and
read [the tracking guide](TRACKING-GUIDE.md). It explains which readings can locate a person or
vacuum, how recent sightings expire and how to preserve or repair a missing source.

For lighter model rendering on a wall panel, open **Edit → House → Model → Model shading**.
The [model shading guide](MODEL-SHADING-GUIDE.md) explains the shadow/lamp choices,
what the material report means, and how to prepare ambient occlusion textures in Blender.

For trying a lighting look, use **Edit → Controls → Scenes** and the [scene preview guide](SCENE-PREVIEW-GUIDE.md).
You choose the lights and desired settings explicitly. A preview changes the house drawing;
**Activate** runs the real saved Home Assistant scene and can also affect its other devices.
The device menus continue to show actual readings during a preview.

For your own furniture, use **Edit → Appearance → Furniture** and the [furniture guide](FURNITURE-GUIDE.md).
Imported ZIPs keep their original models and licences. Movement is a draft until
**Save furniture**; **Cancel**, **Undo** and **Redo** work with placements.

For current entity names, area filters and missing-link repair, use the
[Home Assistant links guide](HOME-ASSISTANT-LINKS-GUIDE.md). Saved missing IDs stay
visible so you can choose their replacements deliberately.

For a wall panel that gently moves when untouched, open **Edit → Appearance → Advanced tools → Idle** and read the
[idle mode guide](AMBIENT-IDLE-GUIDE.md). Rotation and night picture dimming are optional.
An interaction restores the pre-idle camera; the first tap on a rotating surface wakes
the house, and a fresh tap can select a room or device. These effects use no device actions.

## Room and device controls

In the card's visual settings, **Appearance → Card layout** selects the House
layout or Standard card. **Appearance → Card colours** selects Dark glass, Light
glass or Home Assistant colours in either layout. Floating controls use subtle
glass; settings stay solid for easy reading. See the [appearance guide](GLASS-APPEARANCE-GUIDE.md).
A wide House card uses a left menu and overlay controls; a narrow card uses bottom
navigation and a room sheet. Opening room/device controls keeps the house's size
and camera unchanged. The House menu's **Settings** opens **Edit → Appearance →
House** for the title and actual weather, people and alarm sources. See the
[House guide](HOUSE-VIEW-GUIDE.md). Existing cards keep the standard layout until
you select House.

For a clearer view through a GLB house, open **Edit → House → Model → Wall presentation** and
read the [wall guide](WALL-PRESENTATION-GUIDE.md). Select actual wall meshes and the
side you want to fade. Glass is a lightweight transparent look; cut-away removes
the upper section at a chosen height above that wall's floor. Changes apply on Save.

For separate storeys, open **Edit → House → Model → Floor presentation**. Choose **Side by
side** for the horizontal arrangement or **Stacked layers** for a vertical stack.
The Phase 20 local candidate adds **Separate floor panels** in Side by side. Turn it
on, select up to four floors and save. With a GLB, open **Edit → Controls → Views**, choose
**All** or the intended overview in **View**, and check those floors under **Linked
HA floors**. A model's All view can otherwise follow only its highest visible
storey's HA floor; panels preserve that view's floor and model visibility rules.
Leave Edit and choose the configured view. Without a GLB, the standard All view
allows all current floors by default. Wide scenes use columns; phones and other
narrow scenes stack the pictures. Orbit, pan and zoom move all panels together.
Tap a floor-name header to select the mini-map's floor; tap the map to focus that
floor's location. Edit and Section temporarily use the assembled house and retain
your saved setting. The [floor guide](FLOOR-PRESENTATION-GUIDE.md) explains model
links, spacing, the shared renderer/light pool and household checks still to do.
The [Phase 20 checkpoint](../REQUIREMENTS_AND_FEATURES.md#phase-20-020-local-checkpoint)
records passing local checks and the install ZIP. Actual HA/model/panel acceptance
and a public release remain separate.

Tap a room's floor to see its devices and readings on the right. Tap a device to see its own
controls. Opening the panel only reads device states. **Turn on**, **Turn off** or changing
brightness sends a command to the actual device. **All controls** opens Home Assistant's own
full controls, including the options for heating, cameras, blinds and vacuums.
Lights also offer colour and warm/cool white when supported. Input movement previews
the chosen value in the panel; releasing it sends a real command. Readings follow
Home Assistant's actual response. See [the lighting guide](LIGHTING-GUIDE.md) for model
lamps, Kelvin limits and wall-panel checks.
Camera devices can also open a muted camera picture directly in this panel. See the
[camera guide](CAMERAS-GUIDE.md) for grouped devices, coverage settings and troubleshooting.

On wide screens the house shrinks to leave room for the panel and mini-map. Standard
cards use a scrolling overlay on small screens; House cards reserve a bottom sheet
and expand their height when needed. Close controls with **×**, Escape or a tap outside.
Choose a popup beside the device
instead under the card's visual editor → **Navigation and device controls** → **Room and
device controls**.

## Save camera views and use them in an automation

1. On the intended panel, sign in as an administrator and open the card's **Edit → Controls → Views**.
2. Set **Screen name (this browser)** to a unique name, such as `kitchen-wall`, and save it.
   Use a different name on each screen. The name survives a browser reload. Clearing browser
   storage removes it; it takes precedence over the shared card's **Automation target** setting.
3. Move the house camera to the position you want. Create a view named **Front door** and
   save its camera. A saved view remembers whether it was 3D or Top, as well as its floor
   visibility and camera position. Garden and Top-down work the same way.
4. In Home Assistant, create an automation using your doorbell's actual trigger. Add the
   **Taylor's 3D: Select camera preset** action. Enter your layout name, screen name and **Front door**.
5. Keep that dashboard open on the panel. The action confirms which view was selected.

For someone learning YAML, the action alone looks like this:

```yaml
action: taylors3d.select_view
data:
  layout_key: default
  panel: kitchen-wall
  preset: Front door
```

You can add `mode: top` to override a preset's saved mode. Add `return_after: 30` to return
to the previous view and camera after 30 seconds. Without it, the view stays selected.
Touching the panel or choosing another view cancels the return and interrupts the flight.
A newer request replaces the previous return timer.

If one screen has several Taylor's 3D cards, give each card an **Automation target → Card
name**, then also include `card_id` in the action. No matching open card, duplicate targets,
an unknown or ambiguous preset name, or a card being edited produces a clear action error.
Use the saved view ID when two views have the same name. Ordinary authenticated Home Assistant
users can receive these requests; layout editing still requires an administrator.

The service uses Home Assistant's authenticated connection. It does not expose a public
browser control endpoint. Implementation follows the official [service documentation](https://developers.home-assistant.io/docs/dev_101_services/)
and [websocket client subscription API](https://github.com/home-assistant/home-assistant-js-websocket/blob/master/lib/connection.ts).

## Undo and redo layout edits

The edit panel has **Undo** and **Redo** buttons. Ctrl/Cmd+Z undoes an edit; Ctrl/Cmd+Shift+Z
or Ctrl+Y redoes it. Text fields keep their normal text-editing shortcuts.
If several cards are being edited, use the intended card's Undo/Redo button or focus one of
its edit controls before using the keyboard shortcuts. An unfocused shortcut does not guess
between several editors.

A whole drag or held slider adjustment counts as one edit. Drawing, room changes, device
positions, object bindings, saved views and imported layout settings can be recovered.
After Undo, making a new edit starts a new branch and removes the old Redo choices.
Restored layouts are saved normally; a failed save remains visible in the edit panel.

History holds up to 100 edits and 8 MiB in this browser session. Reloading, changing layout
names, or replacing/deleting a GLB starts fresh history. A GLB file operation changes the file
on the server, so a layout snapshot cannot recover its previous bytes. Before changing
assets, use **Edit → Data → Create full dashboard ZIP**, then **Download ZIP** to keep
the available uploaded models and owned furniture packs with the dashboard. Follow
the [backup guide](DASHBOARD-BACKUP-GUIDE.md) to select/read the dashboard and review
missing assets or external dependencies. Actual Linux HA restore remains to test.
Undo never changes live sensor readings or reverses a command sent to a real device.

## Temperature, power, energy and alerts

Open **Edit → Appearance → Advanced tools → Overlays**. Pick a measurement, its display unit and colour scale, then choose
the sensors for each room. Saved visual settings are shared with the layout and take priority
over earlier card configuration for these overlays.

Temperature readings are converted to the chosen Celsius, Fahrenheit or Kelvin unit.
**Power now** means the instantaneous load in W or kW. **Energy** means accumulated usage
in Wh or kWh and needs an explicit matching period, such as Today or This month. These are
different measurements and are never mixed. The overlay has a labelled scale; grey rooms
have no valid reading, with missing/unavailable/invalid readings identified separately.

When summing several meters, confirm that they measure separate loads or describe their
circuit groups. Do not count both a whole-house total and its individual appliances. The
editor explains conflicting selections, and partial readings do not become a complete house
total. Home Assistant does not provide enough information to infer all electrical relationships.

Add a smoke, leak, unlocked-door or custom state alert and choose its room. Its marker appears
at the assigned device position when available, otherwise at the room centre. Active alerts
pulse at that location. Reduced-motion settings keep a steady marker. Unknown/unavailable
data stays visibly different from a clear sensor. **Keep until acknowledged** remembers an
alert in this browser session after its trigger clears; reloading starts fresh. Acknowledgement
cannot suppress a sensor that is still reporting the trigger.

These visuals need actual Home Assistant entities. A named room or model object alone does
not supply temperature, camera detections, smoke readings or device location.

## Missing Home Assistant links

Open **Edit → Data** to check saved links. If a room, floor or device has been deleted or
renamed in Home Assistant, the report identifies the old choice. The layout is kept so you
can choose a replacement deliberately. In **Model**, a missing area or floor remains selected
and clearly labelled; choose an existing one, or **no area / no floor**. Restoring the exact
original ID makes that link work again.

A model room with a missing area keeps its shape but has no automatic area devices. A
missing floor supplies no room placement, camera coverage position or floor-height override.
The GLB's named views still control its physical geometry independently; there is no guessed
new floor or area assignment. A floor you deliberately saved in the layout can remain even
when it is absent from Home Assistant.
