# Taylor's 3D — final design review

**7 October 2026 · local development review**

The dark and light glass design gives the app a consistent identity. Taylor
subsequently approved the three recommended improvements below. They are now
implemented in source, making rooms and controls easier to find while keeping
the house clear. The [feature log](../REQUIREMENTS_AND_FEATURES.md) tracks final
combined verification and Git delivery; the earlier package receipt at the end
records only the small fixes.

## What is already working well

- The house stays the main feature. Room and device panels open over it without
  shrinking the picture or changing the camera.
- Buttons, floating bars, popups and settings share the same dark/light styling.
  Settings use more solid backgrounds so longer forms remain readable.
- Custom buttons can live at the bottom, on the left or inside a room panel.
  Favourites and a **More** button already help keep custom bars manageable.
- Guided setup, grouped settings, Save/Cancel and undo/redo already exist.
- Light colours and alert colours still carry useful information. Connection,
  saving and action-request messages distinguish what the app actually knows.
- Reduced motion and solid surfaces for unsupported blur are already supported.

## Small fixes completed in this review

1. Remove a duplicate divider from the device popup for a cleaner panel edge.
2. Put the toolbar's keyboard focus outline inside the control so that scrolling
   containers cannot clip it. This shows which button the keyboard will operate.
3. Keep keyboard focus in the custom bar when the currently focused action is
   removed while the same card session remains open.

These are focused polish and accessibility fixes. They do not add device actions
or change the saved layout. Verification is recorded below.

## Approved recommendations — implemented in source

Taylor asked to make these changes, test them and push. The
[navigation guide](SMART-NAVIGATION-GUIDE.md) gives the steps for using them.
Actual Home Assistant and wall-panel acceptance remain open.

### 1. A cleaner room-first view

**Show on house** now offers **Rooms**, **Important activity** and **All devices**.
Rooms shows actual light/media summaries and reveals the selected room's devices.
When labels would overlap, a compact **Rooms** chooser gives each room its own
readable row. Alerts and devices without a usable room remain accessible within
the existing visibility rules. These choices do not change actual lighting or
device behaviour.

The toolbar choice is temporary. Save a starting choice in the Home Assistant
card editor under **Appearance → Show on house**. New cards start in Rooms;
existing cards keep All devices. See [the display policy](../src/marker-overview.js)
and [room chooser](../src/room-overview-chooser.js).

### 2. Simpler mobile navigation and a menu that fits your home

The visual card editor's **House menu** can hide and reorder built-in sections.
The first three or four fit on a phone; **More** opens the rest over the house.
House stays first, and Settings remains reachable with its existing administrator
permission. Wide cards keep the left rail. Keyboard focus, Escape and a dismiss-only
outside tap make the menu usable without accidentally operating a device.

Existing custom action bars keep their builder under **Edit → Controls → Buttons
and bars**. Menu changes preserve unknown imported options and do not alter
saved custom actions. See [navigation](../src/house-navigation.js) and
[its visual editor](../src/house-navigation-editor.js).

### 3. One search for rooms, devices, views and settings

**Search**, or **Ctrl+K / ⌘K** while using the card, finds current rooms, devices,
scenes, saved views and in-card settings. Results use friendly names, searchable
entity IDs and clear groups. Devices with identical names show their IDs so the
correct source can be chosen.

Choosing a room/device/scene opens its controls; a view or setting uses its
existing destination. Search never switches a device or activates a scene.
It rechecks the current session and destination, honours hidden/diagnostic
entity flags and only offers settings to administrators. See
[search](../src/global-search.js) and [its current destinations](../src/house-search-data.js).

## Useful later additions — also proposed

- **Recent activity:** an optional drawer showing real Home Assistant events and
  their times, with a link to the relevant room. Current feedback tracks the
  latest request, not a household event history:
  [feedback channels](../src/ui-feedback.js#L4) and
  [latest action](../src/ui-feedback.js#L126).
- **Glass effects: Automatic / Reduced / Solid:** a visible in-app choice for
  wall panels or personal preference. Operating-system reduced transparency and
  unsupported-blur fallbacks already exist; the extra app setting does not.
  See [current comfort options](GLASS-APPEARANCE-GUIDE.md#comfort-and-older-browsers)
  and [reduced-transparency styling](../src/taylors3d-theme.js#L351).

## What this review can and cannot confirm

Local browser previews and automated checks use a sample house and simulated
Home Assistant data. They can check appearance, focus, sizing and interaction,
but cannot prove that Taylor's actual model, devices or tablet work correctly.
Real Home Assistant and wall-panel acceptance are still required.

Try the candidate on a separate test dashboard after backing up the current setup:

1. Load the actual house and check dark and light appearance on the wall panel.
2. Open rooms and devices; confirm the house stays the same size and every popup
   can scroll and close without an accidental device action.
3. Try bottom/left shortcuts, favourites and More with touch, then keyboard focus.
   Compare all three Show on house choices, select a room from a crowded overview,
   and search for a device, view and setting. Save a menu/default change and reload.
4. Operate one harmless light; compare the request message with its actual state.
5. Save a small layout edit, reload and verify it persists; exercise backup/restore
   in the test setup before relying on it for the main dashboard.
6. Leave the panel idle, wake it, and check responsiveness during normal use.

## Earlier small-fix verification

This receipt predates the approved room/menu/search implementation above. Its
counts and hashes are retained for that exact earlier checkpoint and do not
certify the later combined source.

The four relevant unit-test files passed **350/350** checks (115 custom-control
tests, including 15 new regression cases, and 235 theme/popup/navigation tests).
Build, project lint and source/bundle freshness passed. The finished built-card
glass check passed **768/768** assertions across 134 scenarios, with no browser
errors and no runtime changes during the check. The full unit suite and broader
visual matrix were not repeated for these three small fixes.

Manual browser review covered the sample house, popup and settings, plus phone
dark/light layouts. Selected and unselected toolbar buttons retain a complete
keyboard outline. The popup now has a single divider under its heading. Screenshots
are saved alongside the workspace as `final-design-review-desktop.jpg`,
`final-design-review-phone.jpg` and `final-design-review-phone-light.jpg`.

Both frontend copies match SHA-256
`0ee830fdb29a901d2ea7ea75f85b3a2bdef62f69ce470d0e5a4370671f214c5f`.
The local `taylors3d-final-design-review-local-candidate.zip` contains 20 members,
each compared with the tested integration and LICENSE; ZIP SHA-256:
`994e21a57f9367bae72e2375cacee28d4d58c5e759dc5cf14ea2f4f4ebfa8307`.
The older Phase 24 ZIP is preserved and does not contain these three fixes.
This review made no commit, push, release or Home Assistant installation.
