# Taylor's 3D — UI polish

Version 0.4.0 is the development UI-polish candidate. It builds on the saved
0.3.0 custom-button version and contains all six agreed improvements. This task
has not published or installed a new HACS release. Use a matching tested build
when evaluating it; the feature log records the exact validation checkpoint.

## Design direction

The current design follows Taylor's later request for minimal black-and-white
glass across the app. The house remains the main feature: dark charcoal or light
surfaces, monochrome selected controls, system typography, subtle floating glass
and solid editing panels. The same style applies to House and standard layouts.
Real light colours, warnings and deliberate custom button colours remain useful
information. See the [glass appearance guide](GLASS-APPEARANCE-GUIDE.md).
The earlier Phase 22 palette used amber lights and teal navigation; the results
under Testing below describe that historical palette and do not validate this
later glass-style source. Colour never substitutes for actual device state.

Room and device controls overlay the house: opening or resizing them does not
shrink the drawing or change its camera view. On a phone they become a
resizable bottom sheet with scrolling controls. Editing uses five clear groups; the narrow version uses
a section selector to preserve useful editing space. Motion answers a user action
and respects reduced-motion preferences. No decoration adds a new 3D renderer.

To see this House layout in Home Assistant, open the card's visual settings and choose
**Appearance → Card layout → House with navigation and room panels**, then
**Appearance → Card colours → Dark glass**, **Light glass** or **Home Assistant colours**. New HA cards start in House.
Existing cards keep the standard layout until you choose House. The standalone
browser demo starts in standard view without HA's visual-settings editor.
See [Choose the layout](HOUSE-VIEW-GUIDE.md#choose-the-layout) for the
steps. This setting changes the presentation without replacing your house or links.

## What has changed

| Improvement | What it does | Why it helps |
|---|---|---|
| Room panels | Summary, Controls and Details sizes; drag and keyboard sizing; current readings and saved favourites | You can read a room quickly or open its complete controls while keeping the house visible |
| Visual builder | Local pictured icons, friendly source search, safe Duplicate and deliberately linked starter buttons | You can recognise choices and reuse a button without memorising every entity or icon name |
| Simpler setup | Five sections with Advanced; real upload, explicit room/floor links, controls and final Save | Related tools are easier to find, and setup progress follows what you have actually configured |
| Favourites | An optional four/five-button dock, More and an exact entity-state visibility condition | Frequent actions stay close, with room for other saved buttons |
| Visual consistency | Paired palettes, readable headings/captions, 44px targets, visible keyboard focus and reduced motion | The same controls remain usable on a phone, desktop or wall panel |
| Feedback | Unsaved/saving/saved/failure and connection messages; an action request is separate from device confirmation | You can tell whether a setting was kept, a request was sent, or something needs attention |

## Using the new controls

A bar is a named group of buttons, such as Evening or Garden. In **Edit →
Controls → Buttons and bars**, choose Add bar and give it a name. Select Bottom
bar, Left menu or one exact Room panel, then add a button. Choose its label, pictured icon,
colour and action. Search by friendly name or exact ID. The advanced icon-name
field still accepts a supported `mdi:` name.

Use the drag handle to reorder bars/buttons or move a button between bars.
Up/Down and Move to provide keyboard alternatives. **Duplicate** creates a new
button with its own ID, keeps its chosen action/condition and starts unpinned.
You can then change its label or source. Duplicating a button does not duplicate
the underlying Home Assistant scene, script or automation.

Left-menu bars appear under **Quick actions** over the house. Open the menu when
you need it, then close it or press Escape. Opening it does not resize the house.
The same saved action checks apply in every location. Use Save to keep a changed
placement; moving a button does not run it. Save/Cancel stays at the top of the
button editor while you scroll.

The starter buttons need your existing routines. **Movie** and **Bedtime** ask
you to select a scene. **Return vacuum** asks for an existing script; you can
separately choose the exact vacuum whose `cleaning` state controls visibility.
Create those routines in Home Assistant's visual editor first, then link them.
Editing, dragging and previewing a button send no device command.

Enable the optional compact dock, choose four or five places and deliberately
pin your favourites. **More** exposes the other saved buttons. Long names wrap
on narrow cards to keep their labels readable. Existing ordinary bars retain
their saved layout.

An optional **state condition** shows a button when one exact entity reports the
state you selected. Friendly state choices help you select the rule; Advanced
retains the exact Home Assistant state text. For example, Return vacuum can appear while that vacuum is
cleaning. A known false condition hides it. A missing, unavailable or unknown
condition source leaves it visible and disabled with a reason, so you can repair
the exact link. Imported unsupported conditions need a deliberate replacement.

Save keeps the layout; Cancel discards the current feature draft. Undo/Redo
restores layout edits. It cannot reverse an action already sent to your house.
You can save up to eight bars and twelve buttons per bar. The builder links
existing routines; full automation rules remain in Home Assistant's own editor.

## Setup and rooms

Open the card's **Edit** mode as an administrator. Choose **Continue setup**:

1. **Upload house:** choose your `.glb` with the existing uploader. You can choose
   to use drawn rooms instead.
2. **Link floors/rooms:** select the actual Home Assistant floors and areas for
   your model, or Draw/Pick the room outlines. At least one current linked room
   is required. If HA has no areas, the guide links to its area settings.
3. **Add devices/controls:** use the actual device/object tools or Buttons and
   bars. Add controls later is an explicit choice when you are not ready.
4. **Save:** finish open feature drafts with Save or Cancel, then use the final
   Save. Setup closes after a current successful response from the active storage
   backend. A failed save keeps the current work available for retry.

Uploads and individual feature Saves use their existing persistence workflows.
The final step completes setup and saves the current layout; it is not a single
undo for every earlier upload or Save. **Edit existing** returns to ordinary
editing. Continue setup resumes progress from your current real links and
controls. **Edit → Data** says where that layout is stored. The companion
integration shares it across users/devices; fallback storage belongs to one HA
user or browser. A successful save confirms that current backend's response.

When you leave an unfinished settings page, choose **Save and continue**,
**Discard changes** or **Stay here**. Invalid settings or a failed save keep the
page open for repair. Replacing an existing uploaded house asks you to review
the selected file first, because Undo cannot restore overwritten model bytes.
Keep a model backup before replacing it. Initial house uploads stay simple.

Five sections replace the long row of feature tabs:

| Section | Where to find your tools |
|---|---|
| House | Rooms and Model |
| Devices | Devices and available model Objects; Advanced: Cameras, Tracking, Security and Mower |
| Controls | Buttons and bars, Views and Scenes |
| Appearance | House (house settings) and Furniture; Advanced: Overlays, Environment and Idle |
| Data | Storage information, import/export and dashboard backup |

On a narrow card, choose the section from the dropdown. Advanced remains inside
the editing body so opening it keeps useful space for the controls.

With the right-side/House control layout on a narrow card, tap a room and use
**Summary**, **Controls** or **Details**. Drag the handle between sizes, or focus
it and use arrows/Home/End. Summary shows current room information; Controls
keeps frequent controls close; Details retains every original device row and
All controls link. Scroll inside Details for the full list. A wide card keeps
the complete overlay room panel. Changing size sends no device action and does
not change the house viewport. The popup scrolls inside the available height.

## What the messages mean

| Message | Meaning and next step |
|---|---|
| Unsaved changes | A feature draft has changed. Choose its Save or Cancel |
| Saving layout… | The current layout save is waiting for a response |
| Layout saved | The current storage backend returned a successful save response; Edit → Data says whether it is shared, user or browser storage |
| Could not save the layout | Your current changes remain available; check the connection and retry |
| Home Assistant is disconnected | The connection is unavailable and device commands are disabled |
| Action requested | Home Assistant accepted the request; check the device's actual current reading |
| Could not request… | The request failed; check that source and connection before trying again |

Scene **Activate** uses the same request/failure feedback and the actual Home
Assistant readings. **Preview** and **Stop** change the drawing's lighting, so
you can inspect a look before deliberately activating the scene.
After replacing the house model, move the pointer again or click **Preview** to
start a fresh preview. An old stationary hover does not start it automatically.

Messages for connection, saving and actions can appear together. An old reply
after you changed account, house, room, source or connection cannot become a
success for your new selection. Dismissible messages have a labelled close
button; active unsaved work remains visible. Notices sit below the house and
controls, keeping the picture's position steady when a new message appears
during furniture dragging or editing.

## Testing and limits

See the [7 October usability review](UI-REVIEW.md) for the current overlay,
left-menu and settings-safeguard checks. The Phase 22 results below describe
the earlier candidate and remain qualified historical evidence.

Use the browser preview first to learn the menus, dragging and setup. It uses
simulated Home Assistant readings and replies. It is useful for interface
testing; your actual Home Assistant is where you verify shared storage, the real
model, integrations and device responses.

**Source** means the editable JavaScript/Python files. A **bundle** is the one
built JavaScript file Home Assistant loads. An **installation ZIP** packages the
integration and that bundle. The final bundle and ZIP must match the tested
source; copying a previous ZIP will not include these new controls.

Unit tests are small automatic code checks. Browser checks open the actual card
and exercise its interface with simulated data; your house still needs its own test.

The earlier `787c366e` checkpoint passed **6,610/6,610** unit tests in **207 files**,
with zero unhandled errors, full lint, build and bundle freshness passing.
That checkpoint's visual source/bundle check passed **10,564/10,564** checks across
**1,728 actual views**,
including four languages, three colour modes, 1400px/320px, reduced motion,
compact More open/closed and save/action/connection states. It measured caption
contrast at least 5.23:1, 44px targets, a 240px phone scene and an editing body at
least 291px. The supplied light/dark palettes and representative HA colours were
checked; personal HA colour overrides can need separate checking. Native HA
icons/camera cards use simulated boundaries in these fixtures. Current grouped/
guided-editor checks passed **96/96**, room sheets **84/84**, and save/action/scene
feedback **88/88**, on source and bundle. Standard room-sheet selected controls
measured 16.10:1 light and 13.83:1 dark. All 218 recorded inputs and both frontend
copies matched before and after the three current UI checks. The current frontend
checksum is
`787c366e017a567a5c158b56755bfbcfe35f259ca4336b5166f841a97a2e17d8`.

These checks follow the feedback/gesture repairs: notices now appear below the
body, and pressing Edit from an open room keeps the button steady through the
click. Earlier `823dab50` and `93e66660` successes remain historical checkpoints.
The complete local browser coverage passed **36/36 programs**: 16 ran on this
final build, and 20 retained earlier successful checks where the relevant app
code was independently verified unchanged. The built-card model check passed
313 checks and Scene checks passed 161. These are simulated interface checks.

The independently audited installation package is
**`taylors3d-phase22-ui-polish-local-candidate.zip`**. Its 20 files match the tested
integration and frontend, and its MIT licence is included. Package checksums and
earlier checkpoint facts are in the [feature log](../REQUIREMENTS_AND_FEATURES.md).
Use this local ZIP for the 0.4 test; the published HACS checkpoint remains 0.1.

On your Home Assistant testing dashboard:

1. Back up the dashboard/layout and install the matching testing package using
   the [local ZIP instructions](../README.md#local-04-testing-package). Its files
   go directly inside `/config/custom_components/taylors3d/`, with no second
   nested `taylors3d` folder. Keep the previous install package for returning.
   Restart HA, then hard refresh
   the browser: **Ctrl+Shift+R** on Windows/Linux or **Cmd+Shift+R** on Mac. This
   reloads the card file so you see the newly installed version.
2. Add a separate test card. In its visual settings, set **Layout name** to a new
   name such as `polish-test`. This name is the storage key: cards with the same
   name share one plan. Upload the real house, select its exact floors/rooms and
   complete Save. Reload and confirm those links.
   The new program version is used by every Taylor card in that HA instance;
   `polish-test` separates saved plan edits, not program versions.
3. Open a room on desktop and phone. Try each size, the drag handle, keyboard
   controls and Details scrolling. Check current readings against HA.
4. Add a bar with pictured icons and your actual scenes/scripts/views. Test drag,
   Duplicate, Cancel, Save/reload, Undo/Redo and export/import.
5. Pin favourites and open More. Test a known true/false condition, then a missing
   or unavailable source. Confirm the exact label/reason and repair path.
6. Deliberately press one safe real-device command. Compare the requested message,
   HA's current reading and the physical device. Simply opening/editing panels
   should leave devices alone.
7. Try dark/light/your HA theme, touch use and reduced motion on the wall panel.
   Record issues in the feature log before marking household acceptance complete.

Actual-house acceptance, Linux HA compatibility, current GitHub CI, public
publication and installation remain separate from local simulated browser checks.
