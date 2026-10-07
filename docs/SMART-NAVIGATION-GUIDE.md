# A clearer house, menus and search

These improvements build on the dark/light glass design. They change how you
find rooms and controls; selecting a room or search result does not operate a
device. Use the device's explicit control when you want to change it.

## Choose what appears on the house

The **Show on house** dropdown offers three choices:

- **Rooms:** room names and current light/media summaries. Choose a room to
  open its controls and reveal its device markers. On crowded views, **Rooms**
  opens a compact room list so labels do not overlap. Devices without a usable
  room assignment remain available as markers.
- **Important activity:** active lights and switched devices, playing media,
  moving covers or cleaning/returning vacuums and mowers, plus current
  motion/occupancy/presence readings and alerts.
- **All devices:** the original full marker display.

Alert markers remain available in the cleaner modes. This does not override
your floor/view filters, hidden entities or model visibility. Actual light
effects, model parts, cameras and automations retain their existing behaviour.
Summaries use the linked Home Assistant entities, so a light group still counts
as one entity rather than a count of its physical bulbs.

The dropdown changes this open card's display. To save its starting choice, use
the card's Home Assistant visual editor → **Appearance → Show on house**.
New cards start in Rooms; previously saved cards retain All devices until you
choose a different default. Editing reveals the ordinary placement markers.

## Personalise the House menu

In the card's Home Assistant visual editor, use **House menu** to move sections
up/down or hide sections you do not use. House stays first and Settings remains
reachable. Settings still requires an administrator account.

On a narrow card, the first three or four sections stay visible and **More**
opens the rest over the house. You can close More with Escape or an outside tap.
The house does not resize. A wide card keeps the side menu.

Your existing custom buttons still belong under **Edit → Controls → Buttons
and bars**, with bottom, left and room placements, favourites and their own
More control. Menu ordering does not alter those saved actions.

## Search without hunting through menus

Choose **Search** or press **Ctrl+K / ⌘K** while using the card. Search friendly
names or exact entity IDs across rooms, devices, scenes, saved views and in-card
settings. Results are grouped so a long device list does not bury the settings.
Identically named entities show their IDs to help you tell them apart.
You can also search a group name such as **Settings** or **Appearance**.

Choose a room/device/scene to open its controls, a saved view to navigate there,
or a setting to open its existing editor page. Search never turns a device on or
runs a scene. It respects the current account and hidden/disabled/diagnostic
entity flags. Non-admin users do not see settings results. Search closes when
its Home Assistant session becomes unavailable and can be opened after recovery.

Use the arrow keys and Enter to choose a result, or Escape to close. The close
button and scrollable results are also available on touchscreens.

## Try it before using it every day

Use a separate test dashboard with your actual model and entities. Compare all
three marker modes, open a room, use More on the phone, and search for a device
and a setting. Confirm that opening overlays preserves the house picture. Then
operate one harmless light and check its real response. Save a menu/default
change, reload the dashboard, and verify it remains as chosen.

Local automated checks use simulated Home Assistant data. They verify the card's
behaviour and appearance, not physical devices or wall-panel performance.
Recent activity and a separate Glass effects switch remain future ideas.
