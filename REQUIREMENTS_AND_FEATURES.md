# Taylor's 3D — requirements and features

## 7 October 2026: 0.4.0-beta.1 testing package

Taylor requested an installable package of the newest source. Version metadata
now identifies `0.4.0-beta.1` consistently in npm, its lockfile, the integration
manifest and the frontend. Hyphenated release tags are published as GitHub
prereleases so the older stable release is not silently replaced. The
[testing release guide](docs/TESTING-RELEASE.md) covers HACS version selection,
manual ZIP installation and actual household checks.

The beta contains the UI from commit `6a241b8`, with no new device behaviour.
The broader GitHub browser suite for that commit was not fully green. Some
expectations describe the old layout/colours, while dragging, very short mobile
panels and Tracking editor flows remain unverified. These limits are stated in
the testing guide; a published package is not a claim of stable household readiness.

**Package verification:** exact tag `v0.4.0-beta.1` at `21c1462`; release workflow
passed all 6,813 JavaScript tests in 212 files, matching version checks, build and
bundle freshness. The frontend SHA-256 is
`3a83174729d85f3c7920ef82defe650e35e4071e543491d10c1df36e4886cc92`.
The independent manual ZIP has 20 byte-verified files, no enclosing folder, and
SHA-256 `ec89a660826a3ec0a1d430c230a59381ff434bf7ee2e95824cc306aeb1abf4cb`.
GitHub's release-creation endpoint repeatedly returned HTTP 500; the release
workflow therefore failed only at publication. No beta release/assets are
currently available in HACS. Taylor can test with the supplied verified manual
ZIP while publication remains unavailable. Stable v0.1.0 remains unchanged.

## 7 October 2026: approved room overview, House menu and search

Taylor asked to implement the three final-review recommendations, test them and
push the changes. All three are now implemented and locally verified. They remain
**Testing** until real-home acceptance is complete. See the
[plain-language guide](docs/SMART-NAVIGATION-GUIDE.md).

| Feature | Current behaviour | How to use it |
|---|---|---|
| F28 — Cleaner house overview | Rooms shows current light/media summaries and reveals the selected room's devices; a compact Rooms chooser handles crowded views. Important activity and All devices remain available, with alerts retained within existing filters. | Use Show on house; save the starting choice in the HA card editor → Appearance. New cards start in Rooms; existing cards retain All devices. |
| F29 — Personal House menu | Hide/reorder built-in sections; phones show three/four sections and More, while wide cards retain a rail. House stays first and Settings retains its admin permission. | Open House menu in the HA visual card editor. Custom bottom/left/room action bars keep their separate builder. |
| F30 — Search | Search current rooms, devices, scenes, saved views and in-card settings by name or ID; grouped results open controls or the existing destination. | Choose Search or Ctrl+K/⌘K. Selecting a result never switches a device or activates a scene. |

The menu editor preserves unknown imported options. Search rechecks the current
account, session and destination before opening it; non-admin users do not see
settings results. Menus, room controls and search overlay the drawing without
resizing it. Existing model geometry, lighting, automation targets and saved
custom actions retain their meaning.

**Local verification:** all 6,813 JavaScript tests in 212 files pass, along with
lint, build and source/bundle freshness. Native browser checks pass for overview
(27 source + 27 bundle), menu (81 component + 39 actual-card), search (175 across
source/bundle), House regression (545) and built-card glass appearance (776).
These use simulated Home Assistant data, not physical devices.

The final frontend SHA-256 is
`02f6b02ae7aeb43d6698804be5d685727f7a37f8f0860e07a70977d47ca182ab`.
The last change removes two default pixels of horizontal slider margin; eight
new narrow Details-panel browser assertions verify the resulting content fits.
The overview/menu/search receipts and House source half precede this CSS-only
fix; their relevant implementation is unchanged. The House bundle half and all
776 final glass checks use the final build. Earlier failed diagnostics are
retained locally: missing search stubs in partial test fixtures, one stale
helper count, and two superseded pre-glass House colour expectations were
corrected without relaxing geometry, device-action or resource checks.

This delivery includes the earlier usability/glass work and the three new
features. The requested Git destination is the repository's main branch; use
this document's Git history for the delivery revision. Source delivery does not
create a HACS release or install Home Assistant. Actual device/model/wall-panel
acceptance is still required; earlier installation ZIPs do not contain this work.
Recent activity and a separate Automatic/Reduced/Solid Glass effects setting
remain deferred ideas.

## 7 October 2026: final design review

The [final design review](docs/FINAL-DESIGN-REVIEW.md) fixes a duplicate popup
divider, clipped toolbar keyboard outlines and lost focus when a custom action
disappears. Targeted tests (350), built-card appearance checks (768), build,
lint and bundle freshness pass. The matching local package is
`taylors3d-final-design-review-local-candidate.zip`. Real-home testing remains open;
at that checkpoint, the review had not committed, pushed, released or installed anything.

At this checkpoint, a cleaner room-first display, customisable built-in navigation
and one search were proposals. Taylor subsequently approved their implementation;
the newer section above records that work. Recent activity and an explicit Glass
effects setting remain deferred.

The preceding glass-appearance candidate passed 6,662 unit tests, 1,535 focused
source/bundle browser checks and 5,282 broad built-card visual checks. Build,
lint, bundle freshness and exact installation-ZIP comparison also passed.
These use simulated HA; real-home acceptance remains Testing. See the preceding
[glass guide](docs/GLASS-APPEARANCE-GUIDE.md#preceding-verified-local-candidate--7-october-2026)
for exact build/package identity and retained failed diagnostic runs. This work
was local and uncommitted at that checkpoint, with no push, release or installation.

## 7 October 2026: minimal glass appearance

Taylor approved dark frosted glass with a matching light option across the whole
app. The current source shares monochrome navigation, rounded controls, readable
system typography, restrained glass on floating surfaces and solid settings in
both House and standard layouts. Actual light colours, warning/alert colours and
deliberately chosen custom button colours remain. Room controls overlay the house
without changing its size or camera. See the [glass appearance guide](docs/GLASS-APPEARANCE-GUIDE.md)
for selection and household checks. Saved `dark`, `light` and `ha` configuration
values remain compatible; this styles Taylor's 3D rather than the whole HA dashboard.
Earlier validation/package results below are historical and predate this visual
follow-up. Final build verification belongs to the new checkpoint; this section
does not claim a new published, installed or physical-device-tested release.

## 7 October 2026: usability review follow-up

Taylor requested room/device overlays that preserve the house picture, custom
bottom and left-menu actions, clear settings and a complete usability review.
The actionable review covers viewport preservation, optional left actions,
unfinished-draft navigation, model replacement, reachable Save/Cancel and
plain-language button settings. See [the review report](docs/UI-REVIEW.md) for
findings, implementation and current validation. Phase 22 evidence below is
historical and is not a rerun of this follow-up source. At that checkpoint, no
push, release or installation was part of the review. The latest approved
source delivery is recorded at the top of this log.

## Phase 22: 0.4.0 UI polish

**F27 — Testing.** This development version brings the six agreed polish
improvements together. It builds on the tested `0.3.0` custom-controls source.
Earlier packages and results below remain historical checkpoints. This work
was later saved locally as commit `162175b`. At that checkpoint it was not
pushed, published, installed or tested on Taylor's actual Home Assistant. The
7 October follow-up is included in the newer source delivery recorded above.

| Change | What Taylor can do |
|---|---|
| Room panels | Choose Summary, Controls or Details on a phone; drag the handle between sizes or use keyboard controls; keep the house visible |
| Visual button builder | Search pictured icons and friendly names, duplicate a button, and choose an existing scene/script for Movie, Bedtime or Return vacuum starters |
| Easier editing and setup | Use five sections with Advanced tools; Continue setup uses real house upload, explicit floor/room links, controls and a final Save |
| Favourites | Deliberately pin up to four or five buttons per optional dock; use More for other buttons and an exact entity-state condition when wanted |
| Consistent appearance | Use charcoal/amber/teal, paired light colours or HA colours; readable captions, visible keyboard focus and 44px controls |
| Clear feedback | See unsaved, saving, saved, failure and connection messages; an action request stays separate from the device's reported response |

Save/Cancel and Undo/Redo keep their existing layout meaning. Templates link
Taylor's deliberately selected existing routines; they do not create automation
rules. Setup reads current real room/floor links. Missing or unknown sources
remain explained, and an interrupted old interaction cannot apply to a newly
selected house, room, device, account or connection.

See [UI polish: use and test](docs/UI-POLISH.md) for simple steps and the exact
limits. A prior built-card visual checkpoint passed **5,282/5,282** checks across **864 views**:
four languages, dark/light/representative HA colours, 1400px/320px and ordinary/
reduced motion. It includes the actual compact More control and 480 feedback
states. Minimum measured caption contrast was **5.23:1**; phone scene height was
at least **240px** and editing body at least **291px**. Theme unit tests passed
**38/38**, with targeted lint passing. The visual audit used simulated HA data,
zero device calls and zero layout writes. The earlier source visual run passed
the same matrix; the final editor and room-sheet checks below cover source and bundle.

| Historical targeted check (`bd92b166` build) | Recorded result |
|---|---|
| Built-card visual matrix | 5282/5282; 864 views; terminal exit 0; no browser errors |
| Guided/grouped editor | 96/96 source/bundle; terminal exit 0; real native uploader/link/save/retry workflows with simulated transport |
| Room sheets | 80/80 source/bundle; terminal exit 0; native mouse/touch/keyboard sizing and current room controls |
| Built frontend and integration copy | Byte-identical SHA-256 `bd92b16683b0538a80091ca692f2aa3055f3aa0d9d17d243756e012a5586835c` |

The standard room-sheet contrast repair and consistent scene-request feedback
follow this targeted checkpoint. Runtime checkpoint `823dab50` passed **6,595/6,595**
unit tests in **207 files**, with zero unhandled errors, full lint and bundle
freshness passing. Its frontend/integration checksum is
`823dab50f5c6920f7ba00a9a0603ee067921301ab985292b0b1f9704ec4cb7d0`.
On that same recorded runtime, the visual source/bundle matrix passed
**10,564/10,564** across **1,728 views**, the guided/grouped editor passed
**96/96**, room sheets passed **84/84**, and save/action/scene feedback passed
**78/78**. Every one of the 218 recorded runtime/fixture inputs and both frontend
copies matched before and after the three owned UI checks. Standard selected
room controls measured **16.10:1** in light and **13.83:1** in dark; the House
palette remains unchanged. These are completed terminal results using simulated HA.

The stationary Scene-hover lifecycle repair follows this checkpoint. The later
`93e66660` app build passed **6,599/6,599** unit tests in **207 files**, zero
unhandled errors, full lint, build and bundle freshness. Its two frontend copies
match SHA-256
`93e66660cf57cd6617775f91a95fab11246e24837fcf6818c90b5679aebb0de4`.
Its visual source/bundle matrix passed **10,564/10,564** across **1,728
views**, Scene checks **159/159**, and feedback **78/78**. The visual run
retained the same measured 5.23:1 minimum caption contrast, 240px phone scene and
291px editing body; all 218 current inputs and both frontends matched before
and after it. One browser-test setup was corrected after the complete unit run;
the production app and unit-test code stayed unchanged.

Room **84/84** and editor **96/96** receipts remain explicitly tied to the prior
`823dab50` checkpoint. Their relevant implementations are unchanged by the
independent Scene-hover repair; those results were retained rather than repeated
only to acquire the new bundle checksum. Wider browser checks subsequently found
feedback/gesture compatibility repairs. The replacement `787c366e` build now
passes **6,610/6,610** unit tests in **207 files**, zero unhandled errors, full
lint, build and bundle freshness. The two frontend copies match SHA-256
`787c366e017a567a5c158b56755bfbcfe35f259ca4336b5166f841a97a2e17d8`.
Feedback now follows the body so a first Unsaved message keeps the scene steady
during furniture dragging. Invisible/internal feedback changes no longer request
a pointless resize. Pressing the current native Edit button from an open room
preserves it through the click; ordinary outside dismissal remains.

The current source/bundle UI rechecks pass room sheets **84/84**, grouped/guided
editor **96/96**, visual **10,564/10,564** across **1,728 views**, and feedback
**88/88**. The three owned UI runs preserved all 218 recorded inputs and both
frontends before/after, with no unexpected browser errors/routes. Visual checks
retain 5.23:1 minimum caption contrast, 44px targets, a 240px phone scene and at
least 291px of editing body, one original renderer and zero device/layout writes.
The earlier `823dab50`/`93e66660` receipts remain preserved checkpoints.
The complete qualified local browser ledger now passes **36/36 programs**:
**16** ran on the final `787c366e` runtime and **20** are retained prior successful
checkpoints with independently verified unchanged relevant app code. The ledger
contains **15,994 recorded passing assertion lines**, including the final
**313 built-card model checks** and **161 Scene checks**. This records each
program's actual test epoch; it does not claim every program was rerun on the
final bundle. Browser-fixture-only corrections received independent syntax/lint
checks; production and unit-test bytes remained unchanged after the full unit run.

**Exact local installation package:**
`taylors3d-phase22-ui-polish-local-candidate.zip`, **854,183 bytes**, **20 members**.
ZIP SHA-256: `f410405cb403c1e51074874d749a7c3a29d60679b3a8d31f984ce11f614c603b`.
The independent audit passes CRC, every tested-source installation byte, version
and MIT checks. Its frontend matches both tested copies of `787c366e` above.
Against the previous 0.3 package, only the manifest version and built frontend
change; the Python backend remains unchanged. See the [manual test-package
instructions](README.md#local-04-testing-package) before installing it.

Actual HA
installation, the real GLB, device commands, backups and wall-panel acceptance
remain **UNRUN**. A local build does not create a HACS update.

## Phase 21: custom buttons and bars

**F26 — Testing.** Taylor chose a builder inside Taylor's 3D, covering custom
bars and room panels. Add buttons with a name, icon, colour and action; drag bars
into order and move buttons within or between them. Mouse, touch and keyboard
controls must work. Save, Cancel, Undo and Redo apply to layout edits. Editing,
dragging and previews must never run device actions.

The first delivery connects saved camera views and existing Home Assistant
scenes, scripts and automations, plus supported device toggles and All controls.
Create full automation rules in Home Assistant's visual editor, then link them
to a button. This work starts from
the tested 0.2.0 commit `6cd23df` in a separate development checkout. The 0.2.0
testing package and its completed checks remain the previous checkpoint.

See [custom buttons and bars](docs/CUSTOM-BUTTONS-AND-BARS.md) for the user flow.

The `0.3.0` local candidate adds **Edit → Buttons and bars**, up to eight named
bars and twelve buttons per bar, mouse/touch dragging, keyboard alternatives,
draft Save/Cancel and existing Undo/Redo. Bars can appear at the bottom or in one
exact room panel. Buttons link saved views, existing scenes/scripts/automations,
supported toggles and Home Assistant entity controls. Automation conditions are
checked by default. Existing room shortcuts continue alongside the new bars.

Shared storage, single-layout JSON and full dashboard backup preserve the new
field and inert imported extras. Missing links remain labelled and disabled;
edit/drag/preview/import operations send no device actions. Model loads and
changed account/source contexts invalidate unfinished gestures and stale drafts.
English, German, French and Spanish labels follow the existing catalogue.

Local verification: the complete **6,311 JavaScript tests across 201 files
passed**, followed by three additional inherited-array getter regressions.
The final four affected suites passed **249/249**, covering **6,314 distinct
unit tests** in total. The final custom-controls browser proof passed **384/384**
on the source and bundled card. Editor/runtime suites also passed after the
scoped theme repairs. Real-browser
colour probes verified readable runtime and editor text in dark, light and HA
themes, including disabled controls. Build/bundle freshness, native browser
regressions and ZIP integrity are recorded in the separate local validation
receipt. These checks use anonymous simulated HA readings and services.

The candidate is `taylors3d-phase21-custom-controls-local-candidate.zip`.
It is not installed or published. Actual-house testing remains **UNRUN**;
the older HACS release remains `v0.1.0`. No new automation-rule editor is included.

This is Taylor's ideas and progress log. It records what we want the app to do, what the current base already provides, and how we will know each new feature works.

Created: 4 October 2026. Starting point: version `0.1.0`, base commit `055e30f2e46062a01dd83b4bbec4b793c477f75a`.

**First installable release:** [v0.1.0](https://github.com/gregtaylor1993/taylors-3d/releases/tag/v0.1.0) contains verified checkpoint `93ab558`, including the chosen navigation group and later verified features through ambient idle mode. The published HACS zip's frontend matches the tested build byte for byte. Wall, furniture and separated-floor work is recorded separately below. Later historical notes describe their checkpoint dates; this release is now available.

**Current work:** the `0.4.0` source adds the six UI-polish improvements above.
The previous `0.3.0` local candidate added the custom builder.
The combined `0.2.0` candidate and its previous verified packages remain recorded
below as the Phase 20 checkpoint. Published HACS releases and local candidates
remain separate.

**Previous local version: Phase 20, `0.2.0`.** F24 adds optional separate floor
panels with linked camera controls. The local checks and installation ZIP below
cover this version. The frozen Phase 19 source, package and earlier results remain
historical. This has not published a HACS update or validated your actual house.

## Phase 20 0.2.0 local checkpoint

Recorded: **2026-10-06**. This checkpoint records a tested local candidate;
features remain Testing until their Home Assistant and household acceptance checks.

The new floor panels give each selected floor its own picture. The same rendering
engine and fixed light pool draw all the pictures, keeping resource use bounded.
Orbit, pan and zoom move them together. Real room/device positions and calibration
points keep their original coordinates, so returning to the assembled house does
not require moving them back. Exact floor picking, current room/device menus,
mini-map selection, label spacing and camera-side walls are covered by this run.
Automatic sun/time refresh also works while the house is otherwise idle.

| Final local check | Recorded result |
|---|---|
| Complete JavaScript unit run | 6054/6054 tests in 196/196 files; terminal exit 0 |
| Lint | Passed; terminal exit 0 |
| Build | Passed; terminal exit 0 |
| Source/bundle freshness and integration copy | Passed; terminal exit 0; both frontend copies match |
| Complete native browser checks | 30/30 declared scripts across two runs on the same frozen source/build; every terminal exit 0; source/built-card scenarios use simulated HA |
| Tested frontend checksum (SHA-256) | `aea868aafcb9ee885e1caba618326bdc46272c7ad9cc9a73710663691178235a` |
| Local installation package | `taylors3d-phase20-local-candidate.zip`: 20 checked entries, each matching current integration source; packaged frontend matches the tested build |
| Local ZIP checksum (SHA-256) | `9c5db533a83f76e61b36543d676078def7f17133b110b2ef6e3956b3ffb8e241` |

All 30 native scripts, including floor panels, navigation, room/device controls,
editing/history, backup, tracking, security, weather, lighting, model presentation
and translations, ran on the same frozen runtime. Nineteen scripts completed on
5 October before an overnight interruption. The incomplete House check was not
counted; it and the remaining ten scripts were run again/completed on 6 October.
Full local logs and private verification files are retained outside this
repository. Earlier failures and
Phase 19 counts remain recorded below rather than being replaced by these results.

This ZIP is for local evaluation, not a public release. Actual Home Assistant
installation, use beside the original integration, the real GLB/device/panel
checks, Linux Home Assistant compatibility and current-candidate GitHub CI remain
separate. The published HACS release remains **v0.1.0**. For full dashboard backup,
the earlier 157/158 standard-library backend result and Windows symlink skip are
historical; the 83 prepared real-HA cases still have no passing Linux result here.
The browser backup checks use simulated HA. Independent camera movement in each
floor panel remains an optional unanswered preference; this version links movement.

## Combined 0.2.0 local checkpoint

Recorded: **2026-10-05**. Source code freeze: `bb702089c6324d4e99b4c7ae3ba559b555a4f7f2d7de482bd39bc9f411e6c3b2`.
This records the exact tested version; it does not mark every feature Done.

The combined version includes the desktop House menu, right-hand room/device
controls, mobile menu, bubble bar and mini-map. Recent fixes keep a fresh control
action separate from a cancelled earlier action, preserve missing furniture-floor
choices, and retain coordinates when moving between overlay fields. Exact model-position
details stay open after an edit, and pressing Tab can continue to the next position
field. Companion sliders show the saved coordinates. The Tracking Edit button
has a minimum width and height of 44 pixels, making it easier to tap.
These changes help you finish a setting for the device and place you selected
using the current Home Assistant connection. Card labels use English, German,
French and Spanish; your room/device names and actual readings retain their own
values.

| Final local check | Recorded result |
|---|---|
| Complete JavaScript unit run | 5663/5663 tests in 185/185 files; terminal exit 0 |
| Lint | Passed; terminal exit 0 |
| Build | Passed; terminal exit 0 |
| Source/bundle freshness and integration copy | Passed; terminal exit 0; both frontend copies match |
| Selected native browser scripts | 11/11 on the same frozen source; source and built-card scenarios use simulated HA |
| Tested frontend checksum (SHA-256) | `af61a40ddec2529ed9a824363bb23fc6b0edf3cbc4c618fdac7a84a7f08ef9d3` |
| Local installation package | `taylors3d-phase19-local-candidate-r2.zip`: 20 independently checked entries; packaged frontend matches the tested build |

The selected browser scripts are `visual-options-check`, `room-actions-check`,
`security-check`, `localization-check`, `overlays-check`, `edit-check`,
`runtime-localization-check`, `house-check`, `lighting-check`, `panels-check`
and `furniture-check`. Their native source fingerprint is `cfbde2b8ed6109bdf36bbd1a526452b32f9466311d99009ddad92b8bca71abbe`.
Full local logs and the verification ledger are retained separately; they are
not presented as published links in this repository.

Earlier runs remain historical: the first combined run passed 18/29 scripts;
a later whole 29-script run passed 25 and failed 4; a later selected eight-script
run passed 3 and failed 5. Their failures and diagnoses remain preserved.
A subsequent selected 11-script run passed 10 and failed 1. Its remaining visual-options failure prompted further model-position and Tracking touch-target repairs; that run remains historical.
The final eleven-script pass does not mean all 29 scripts were rerun on this version.

The local ZIP is byte-checked, but has not been installed or validated in actual
Home Assistant. This candidate's public push and release/HACS publication are
pending; the existing published HACS release remains **v0.1.0**. Use the named
local package when evaluating this candidate. Local package checks do not
prove the candidate's full GitHub/Linux Home Assistant CI, release installation
or use beside the original integration.

For full dashboard backup (F04), 157 of 158 standard-library backend methods
passed with one Windows symlink skip. The 83 real-HA cases are prepared; Windows
`fcntl` prevented that HA harness from collecting, so it has no passing local
HA result. Record any later Linux result separately before changing that status.
Your actual house model, device integrations, touch use and wall-panel performance
also remain to verify.

**Floor behavior at the historical Phase 19 checkpoint:**

That version separated floor geometry side by side or into stacked layers in
one house view; it did not provide separate floor pictures. The Phase 20 checkpoint
above adds opt-in panels with linked camera movement. Independent movement in each
panel remains an optional unanswered preference.

The aim is a realistic, useful Home Assistant house dashboard that is comfortable to use on a wall panel. Taylor should be able to configure it visually, see what is happening at home, and reach the relevant controls by tapping a room or device.

## How we track work

Every idea has a permanent number, such as **F01**, so we can discuss it without losing track of it when its title changes.

| Status | Meaning |
|---|---|
| Planned | Recorded, but implementation has not started. |
| Needs input | A decision, device entity, model detail or hardware test is needed. |
| In progress | We are implementing the feature. |
| Testing | Implemented, with checks still to complete. |
| Done | Meets its completion checklist, with evidence recorded. |

Taylor chose the first group: **bubble bar, room/device popups and 2D mini-map**. F18–F21 have a first implementation and are **Testing**, including checks against the actual Home Assistant/wall panel still to do. Further deliveries add right-hand controls, editing history, targeted camera automations, room measurements/alerts, physical-camera views and coverage settings. Other requested additions remain visible below. Existing foundations do not mean the complete requested feature is finished.

Taylor's 5 October desktop/phone references add the [visual direction](docs/DESIGN-DIRECTION.md): a large house view, right-hand room/device controls on wide screens, a bottom sheet on phones, rounded theme-aware panels, amber light controls and teal accents. The reference's example readings/devices are not household evidence. Matching this presentation remains part of F18–F21/F25, separately from their already tested behavior.

The **House interface checkpoint** implements that presentation with an optional layout selector, desktop rail, mobile bottom menu, room/device controls and visual House settings. Headers use explicitly selected real weather, people and alarm sources; category menus resolve current eligible entities. Existing saved cards keep their standard layout until House is chosen; new cards default to dark House. Dedicated source and built-card browser checks pass **531/531**, including a loaded tagged GLB, actual room/device taps, a 320-pixel card, opposite House/HA colour schemes, readable labels, current summaries, camera/source/resource retention and a strict zero-error/warning gate. The isolated source also passes **3,683 JavaScript tests**, lint and bundle freshness. Full regression/CI and installation packaging are tracked separately in the project guide. These simulated checks do not prove actual household video, model or panel performance. See the [House guide](docs/HOUSE-VIEW-GUIDE.md).

For each implementation, update its status, record the changed behavior, link its commit or pull request, and record the checks performed. Keep unfinished parts visible instead of marking a whole feature Done early.

## Feature overview

| ID | Feature | Existing foundation | Status |
|---|---|---|---|
| F01 | Named camera presets and automation-triggered flights | Named saved 3D/top views and smooth camera moves | Testing |
| F02 | Complete visual configuration | Five grouped sections and guided upload/link/control/Save setup retain supported advanced tools and imported settings; current local checks pass, actual HA persistence remains | Testing |
| F03 | General undo and redo | General session history and grouped gestures | Testing |
| F04 | Full dashboard backup and restore | Whole-dashboard ZIP workflow passes simulated-HA browser checks; Linux HA compatibility and actual restore remain | Testing |
| F05 | Temperature, power and energy views | Sensor readings, conversion, floor overlays and visual bindings | Testing |
| F06 | Security doors/windows and animated doors | Exact plan locations, distinct lock states and model contacts/hinges pass local checks; real sources/pivots remain | Testing |
| F07 | Camera coverage cones and live-feed popups | Native HA camera viewer, explicit approximate coverage and visual editor | Testing |
| F08 | Presence: people/devices in rooms | Explicit room observations, anonymous activity and verified identity bindings | Testing |
| F09 | Alert pulses at the affected location | Located, labelled smoke/leak/unlocked/custom alerts | Testing |
| F10 | Actual sun plus rain, clouds and snow | Strict sun/location evidence and opt-in bounded outdoor weather | Testing |
| F11 | Hue colour/brightness lighting the rooms | Validated light readings, inline colour/white controls and a bounded pool | Testing |
| F12 | Scene previews | Explicit light targets, current-light capture, editor and saved-bar controls verified; household checks remain | Testing |
| F13 | Ambient idle rotation and night dimming | Optional delay/rotation and sun/quiet-hours picture dimming pass Phase 20 local checks; current CI and household checks remain | Testing |
| F14 | Camera-aware cut-away and glass/faded walls | Exact wall drafts, owned material copies and composed clipping pass Phase 20 local checks; current CI and actual-house checks remain | Testing |
| F15 | Furniture packs and drag-and-drop placement | Furniture placement and the full-dashboard workflow pass local checks; Linux HA, actual restore and household checks remain | Testing |
| F16 | Baked shadows for wall panels | Saved shadow/lighting policy, authored texture diagnostics and external AO guide | Testing |
| F17 | Deeper HA floors/areas/entity integration | Shared metadata, precision, filtered choices and exact missing-link diagnostics pass local checks; current household HA remains | Testing |
| F18 | Room selection and room control panels | Room taps open current controls/readings; phone Summary/Controls/Details and drag/keyboard sizing retain saved shortcuts and device options | Testing |
| F19 | Bottom bubble navigation bar | Saved view buttons, camera controls, map and editing with visual ordering and visibility settings | Testing |
| F20 | Rich device control popups | Supported current light/media/climate/cover/lock/vacuum controls plus Home Assistant's All controls | Testing |
| F21 | Persistent 2D mini-map | North-up floor map, current device/tracked symbols, camera focus and located alerts | Testing |
| F22 | Cars appearing on the drive | Maintained vehicle occupancy/counts and fixed-expiry sighting bindings | Testing |
| F23 | Robot vacuums moving while running | Measured/status actors with visual calibration and separate source-age forms | Testing |
| F24 | Horizontal split floors and vertical layers | Optional responsive floor panels with linked controls pass Phase 20 local checks; side-by-side geometry and stacked layers remain available; real model/panel remains | Testing |
| F25 | Translations, preview, screenshots and bundle checks | Four-language controls, simulated preview/screenshots and bundle matching pass local checks; documented English prose, current CI/release and household gates remain | Testing |
| F26 | Custom buttons, bars and drag-and-drop builder | Inside-card bottom/room bars, pictured icons/friendly source search, duplication/starters, optional explicit favourites/conditions, drafts, ordering and backups; actual HA pending | Testing |
| F27 | UI polish across the card | Six connected changes: room sheets, visual builder, grouped/guided editing, favourites, appearance and truthful feedback; local unit/qualified browser/package checks pass, actual HA/panel and current CI acceptance remain | Testing |
| F28 | Cleaner room-first overview | Rooms/Important activity/All devices, current room summaries, collision-free chooser and retained alerts; combined checks and actual HA/panel acceptance remain | Testing |
| F29 | Customisable built-in House menu | Visual hide/reorder/reset, protected House/Settings, responsive three/four-section dock and More; custom action bars remain separate | Testing |
| F30 | Search across the card | Current rooms/devices/scenes/views and admin settings, friendly names/IDs, grouped results and session ownership; opening results sends no device command | Testing |

## Proposed build order

The phases group related work so each step can be used and tested before the next one. They are not delivery dates or a commitment to build everything at once.

| Phase | Work | Why this order helps |
|---|---|---|
| 0 — reliable base | Review B01–B03, test the base in Taylor's HA and inspect the actual GLB | Gives us a dependable starting point and confirms the real data/model. |
| 1 — daily navigation | F19 bubble bar, F18 room panels, F20 device popups, F21 mini-map | Makes the dashboard easy to use on the wall panel. |
| 2 — safe editing | F02 visual configuration, F03 undo/redo, F04 backups | Makes larger future changes easier to configure and recover. |
| 3 — automatic views | F01 presets and automation triggers | Reuses saved views and the new navigation. |
| 4 — useful overlays | F05 energy/temperature, F06–F09 security/presence/alerts, F07 cameras | Builds on mapped rooms, entities and popups. |
| 5 — living house | F10–F13 sun/weather/lighting/scenes/idle, F22 cars, F23 vacuums | Adds animation once real device data and tablet limits are understood. |
| 6 — model presentation | F14 cut-away, F15 furniture, F16 baked shadows, F24 split floors | Adds the more demanding model and rendering work. |
| Throughout | F17 HA integration and F25 accessibility/translations/demo/tests | Each feature should work well with HA and remain testable. |

Taylor confirmed Phase 1 first on 4 October 2026. The 5 October pass also develops safe editing, automation and measurement foundations alongside right-hand controls. The remaining phase order can change as we learn from the actual house and devices.

## Detailed requirements

### F01 — camera presets and automation-triggered flights

**Want:** save views named Front door, Garden and Top-down, then jump to them manually or through HA automations. A doorbell ring should fly the selected wall panel to the front-door view.

**Already present:** named views, saved 3D camera position/target, separate Top camera position/zoom, and smooth transitions. The missing part is automation control and targeting the intended display.

**Complete when:** presets can be created, renamed, reordered, saved and selected visually; they survive reload; an automation selects a named preset on a chosen panel/card; the correct floor and 3D/Top mode are selected; touch interrupts the camera flight. Invalid preset/target requests have a clear result. Provide a simple HA automation example. Agree whether the view should return automatically after a doorbell event and how competing alerts are handled.

**Current implementation:** `taylors3d.select_view` targets one registered open card by shared layout plus browser-local screen name and/or card ID. No match or duplicate targets fail clearly. Saved camera mode reaches the resolved preset. Optional `return_after` restores the exact earlier camera; omitted/zero stays at the selected preset. New requests supersede the earlier return; touch/manual navigation cancels it. Authenticated non-admin panels use an integration-owned subscription. See the [controls guide](docs/FEATURES-GUIDE.md). Actual doorbell/panel testing remains.

### F02 — complete configuration without YAML

**Want:** configure everything through the card rather than having to write YAML.

**Starting point:** the visual Lovelace editor and the card's Rooms, Devices, Objects, Mower, Views, Model and Data tabs. Some advanced settings were not yet exposed in a unified visual workflow; the local extension below adds those supported controls.

**Combined local candidate:** the visual card editor now exposes the starting named
view and deliberate imported URL/floor/view override removal. Model controls keep
exact position values and zero opacity; lighting includes realtime shadows with
lamps off. Tracking, Cameras, Security and Overlays expose their supported advanced
appearance, age, area-filter and exact-location choices. Existing drawn-plan floor
measurements already live in Rooms → Advanced (no model); GLB floor geometry remains
authored in its file. Combined unit and simulated-HA browser checks now pass at
the Phase 20 checkpoint. Actual HA card-config persistence remains to verify.
See the [visual settings guide](docs/VISUAL-SETTINGS-GUIDE.md).

**Complete when:** every supported setting has a labelled visual control, sensible defaults and validation. Entity pickers can be filtered by the feature and area. A user can set up rooms, models, views, bindings and new overlays without entering YAML. Existing configurations remain usable. The normal viewing interface stays simple, and editing respects HA administrator permissions.

### F03 — undo and redo

**Want:** undo mistakes and redo an edit without starting over.

**Already present:** undoing the last point while drawing a room. There is no general editing history.

**Complete when:** room geometry, device/furniture movement, bindings, view changes and visual settings can be undone and redone. One drag or slider gesture counts as one edit. A new edit after Undo clears the redo branch. Buttons and keyboard shortcuts work, and save failures are visible. Undo changes the dashboard's configuration; it must not reverse real device actions or live sensor updates. Define history limits and behavior after import/reload before implementation.

**Current implementation:** defensive session snapshots, 100 edits / 8 MiB, grouped drags and pointer/keyboard sliders, Undo/Redo buttons and shortcuts, redo-branch clearing, and normal persistence/error state. Reload/key changes reset history; importing editable layout JSON is one edit. Replacing/deleting GLB bytes resets history because the server currently stores one model file; asset recovery belongs to F04. Furniture placement and removal are covered by the local F15 candidate. Live HA states/actions are excluded. Actual household editing and external Lovelace settings persistence still need verification.

### F04 — full dashboard backup and restore

**Want:** export and import the complete setup so the layout can be backed up and restored.

**Starting point:** layout JSON export/import covered views, bindings and model metadata, with no GLB bytes or whole HA dashboard. The separate complete-dashboard workflow below adds available owned assets and other cards.

**Scope:** Taylor requested full dashboards. This covers the selected Home Assistant dashboard, including its other cards, plus the Taylor layouts and owned model/furniture assets it uses. The existing layout-only JSON remains labelled separately.

**Complete when:** the agreed backup scope includes card settings, layout, views/presets, entity/area mappings, furniture and required model/assets. A restore preview shows what will change and which entities/areas/assets are missing. Restoring into a fresh setup reproduces the saved result, and the existing setup can be recovered if an import is rejected. Backup format/version and migration are documented.

**Combined local candidate:** Edit → Data keeps Single-layout JSON separate from
the whole-dashboard ZIP workflow. It reads the selected actual HA dashboard,
preserves other cards and raw settings, and includes available original uploaded
models and licensed pack ZIPs. Inspect is static and read-only; reviewed preparation
copies assets into new Taylor keys; a separate deliberate action creates a new HA
storage dashboard. External resources remain declared dependencies. There is no
shared transaction or automatic retry, deletion or overwrite. Of 158 standard-library
backend test methods, 157 pass and one Windows symlink case is skipped; 83 real-HA cases
are prepared. Local HA testing stopped before collection because Windows lacks
Unix `fcntl`; this is not a passing HA result. Combined client/editor and native
browser checks now pass with simulated HA at the Phase 20 checkpoint. Linux HA
compatibility and an actual complete restore remain to verify. See the
[backup guide](docs/DASHBOARD-BACKUP-GUIDE.md).

### F05 — temperature, power and energy overlays

**Want:** colour rooms by temperature or consumption so a cold bedroom or a high-power tumble dryer stands out immediately.

**Already present:** temperature/power sensor labels and warm/cool climate-object state. Room outlines and area mappings can support a room overlay.

**Complete when:** the user chooses an overlay and its sensor bindings visually; rooms/devices update with HA values; a legend shows the scale and units; missing/unavailable readings have an explicit appearance. Temperature aggregation is configurable, and room power totals avoid counting the same circuit/device twice. Keep instantaneous power (W/kW) separate from accumulated energy (Wh/kWh and a chosen period). Labels make the information understandable without relying only on colour.

**Needs:** actual temperature/power/energy entities and confirmed room outlines. A model supporting outlines does not prove Taylor's house model already contains them.

**Current implementation:** visual Overlays tab, explicit room sensors/aggregation, C/F/K and W/kW or Wh/kWh conversion, matching energy periods, fixed/automatic scale, accessible legend/readings and grey missing data. Multi-meter sums require separate-load confirmation or explicit non-overlapping circuit groups. Partial/conflicting data withholds a combined total. Resolved floor visibility/elevation works for drawn rooms and tagged GLBs. Actual house data and panel performance remain to test.

### F06 — security doors, windows and door animation

**Want:** a security mode in which open doors/windows glow red, with model doors visibly opening and closing.

**Already present:** door/window/contact/lock marker icons and active-state handling. Existing room door points describe positions, not necessarily hinged 3D doors.

**Complete when:** door/window/lock entities can be bound to model parts or plan locations; open/unlocked states and unavailable data are clear; close/lock states clear the highlight. Door motion uses the correct hinge, direction and limits without moving the wall or frame. A binary contact uses configured open/closed poses rather than claiming to know the exact angle.

**Needs:** inspect Taylor's actual GLB for independently movable door parts and hinge/pivot geometry. Those pivots have not been verified.

**Phase 5 implementation:** Edit → Security drafts exact contact/object/state settings and optional rigid target/pivot/axis/angle offsets. Outlines are owned helpers; unknown/restored/stale readings stay uncertain. Source material and hierarchy remain intact; geometry, picking, occlusion, shadows and attached anchors refresh only after actual movement. No inferred hinge or device command. The dedicated browser suite passes 30 checks, and the complete local and GitHub regressions pass. Actual household checks remain. At that checkpoint, F06 stayed In progress because plan security displays and lock-specific bindings were unfinished; the combined extension below now covers them. [Security guide](docs/SECURITY-AND-WEATHER-GUIDE.md).

**Combined local extension:** exact plan room/marker/coordinate locations and lock
sources are now connected to the editor, existing 3D renderer and north-up mini-map.
Unlocked does not mean open; locking, unlocking, jammed and unavailable remain
distinct. Closed/locked indicators clear by default. New plan helpers have no own
render loop, light or shadow pool. All 185 scoped security checks pass, including
actual root/map held-source-change regressions. Combined source/bundle browser
checks now pass with simulated HA at the Phase 20 checkpoint. Actual contact/lock
sources and model hinges still need household checks. This local extension is not
in the published HACS release.

### F07 — camera cones and live feeds

**Want:** show each Ring camera's coverage cone, and tap a camera to open its live feed.

**First delivery:** primary camera taps open Home Assistant's native muted viewer. Grouped light/camera devices and rooms offer a deliberate Camera view action for each camera. Edit → Cameras configures approximate coverage from a real positioned marker/model anchor, with explicit direction, horizontal field of view and range in metres, draft preview, Save/Cancel/Clear and Undo/Redo. Duplicate model mounts require the exact choice; hidden/removed mounts never relocate their saved coverage to another marker. Close/unavailable/disconnect removes the actual native player; late helper/capability responses cannot revive a closed viewer. Streaming format labels do not claim that a recording source is live. [Camera guide](docs/CAMERAS-GUIDE.md).

**Complete when:** coverage position, direction and field of view can be set visually; cones can be shown/hidden; tapping the camera opens the available HA stream in a usable popup. Clearly show offline, unavailable or unsupported streams. Coverage is a configured approximation, not a guarantee of detection. Closing a feed releases streaming resources.

**Needs:** inspect the actual Ring `camera` entities and the stream capabilities exposed by Taylor's HA setup. Do not assume every camera supplies a live stream.

### F08 — presence and “who's where”

**Want:** show people or devices as dots in rooms, using phone tracking or Hue motion sensors.

**Current implementation:** an explicit room-observation layer, anonymous motion/occupancy, optional verified person/device identity, matching/conflicting-observation handling, missing-source diagnostics, 3D/mini-map symbols and the Tracking editor are being verified. Home/away does not create a room location. Actual household sources remain unverified.

**Complete when:** supported room-presence sources can be mapped to rooms; dots/occupancy update and expire appropriately; home/away and room presence are distinguishable; unavailable or conflicting inputs have a sensible result. Identity is shown only when the data identifies a person/device. Motion can show activity/occupancy without claiming which person triggered it.

**Needs:** phone home/away tracking alone does not locate a person in a room. Confirm room-level data sources, timeouts and how motion should be combined with named people/devices.

### F09 — alert pulses

**Want:** smoke, leaks or an unlocked door pulse at their 3D location.

**Already present:** these entities can appear as generic active markers, but there is no alert-pulse system.

**Complete when:** alert entities, trigger states and locations are configurable; each alert has a clear icon/label; the highlight follows current state and clears according to the chosen rule. Multiple alerts can coexist. Unavailable data is distinguished from a cleared alert. Reduced-motion mode uses a static highlight rather than a pulse. Doorbell/security alerts can optionally select a preset through F01.

**Needs:** Taylor does not currently expect the FireAngel setup to provide HA data. Check the exact hardware/entities rather than declaring the whole brand unsupported; available Zigbee smoke/leak entities can be mapped when present.

**Current implementation:** visual smoke/leak/unlocked/custom-state binding with room/device positions, trigger/clear rules and optional browser-session latch. Multiple labelled rings follow live data; missing/unavailable states remain distinct. Acknowledge clears a latch only once the source stops triggering; reloading starts fresh. Reduced motion gives a static highlight; editing/detaching stops animations. Camera action can be added to the same HA automation using F01; real alarm/panel validation remains.

### F10 — actual sun and weather

**Want:** sun/shadows follow the real time, with rain, clouds or snow outside.

**Already present:** Auto reads `sun.sun`, uses model north for sun/shadow direction, darkens through dusk and includes sun/moon visuals. Without valid sun data it falls back to Day.

**Phase 5 implementation:** Edit → Environment chooses current weather, decorative intensity and static/low/medium/off quality. Bounded rain/snow/cloud geometry uses the existing scene; all indoor outlines mask outdoor precipitation, including hidden floors. Invalid masks fail closed. Edit/Section/hidden/offscreen/disconnect and reduced-motion states stop animation. Sun/location readers reject missing/coerced/restored evidence. The dedicated browser suite passes 31 checks, and the complete local and GitHub regressions pass. F10 stays Testing for the actual sun orientation, weather source and wall panel.

**Complete when:** existing sun behavior is verified with Taylor's HA location and model orientation; a selected weather entity drives rain/cloud/snow conditions outdoors. Effects have intensity/quality controls, sensible unavailable fallback and a lightweight/off setting for the wall panel. Indoor rooms are not filled with weather particles. Animations stop when the card is not visible or connected.

### F11 — lights that light the room

**Want:** Hue brightness and colour illuminate the room's walls and floor, with the useful lights prioritized within the realtime budget.

**Already present:** bound model lamps glow and use real point/spot lights with HA colour/brightness. The pool is 8 point lights plus 4 spot lights, with up to 4 shadow slots. Lit, visible fixtures are prioritized; other fixtures can retain glow. This is a light budget, not a limit of twelve rooms.

**Phase 6 implementation:** model lamps, drawn floor glows and both device panels share strict current light readings. Colour and warm/cool white controls appear only with actual supported capabilities and reported Kelvin limits. Explicit commands wait for HA's real response; opening or moving an unfinished control sends no command. Missing/restored/invalid/zero-output readings remain dark. Current emitted output ranks the fixed lighting pool, compatible surviving fixtures retain their slots, and unchanged readings or names add no frames or shadow work. All 1,904 JavaScript tests, 48 Home Assistant Python tests, complete local/GitHub browser regressions and HACS validation pass. GitHub passes 773 browser assertions, including 113 lighting checks using actual rendered floor/wall pixels. The exact-commit manual package matches GitHub's frontend. F11 remains Testing for Taylor's actual Hue entities, house materials and wall panel. [Lighting guide](docs/LIGHTING-GUIDE.md).

**Complete when:** Taylor's model lights and Hue entities are bound correctly; colour/brightness changes visibly affect nearby surfaces; off lights release their lighting slots; invisible rooms do not consume unnecessary slots. A low-power mode remains available. Materials, exposure and shadows are checked on the actual tablet/model rather than promising the same appearance on every device.

### F12 — scene previews

**Want:** preview Movie or Bedtime before actually activating the scene.

**Already present:** device controls, but no scene-preview system.

**Phase 8 implementation:** Edit → Scenes drafts explicit light targets and can
capture the selected lights' current appearance. Saved previews have mouse hover
and touch/keyboard Preview/Stop controls in the bubble bar. A separate Activate
uses the exact saved HA scene. Only the existing model/floor light rendering is
overridden; real states, controls, security, tracking and readings stay actual.
Stop uses the latest actual readings. Default is disabled; the optional demo
labels Movie/Bedtime as simulations. All 2,276 JavaScript tests in 80 files,
48 Home Assistant Python tests, lint/build/bundle checks, HACS validation and
complete local/GitHub browser regressions pass. Both full browser runs pass
985 assertions without browser errors or model retry; the dedicated local scenes
check passes 143 assertions. Native checks verify actual lighting pixels,
separate deliberate activation, history/reload, focused colour captions and the
scrolling narrow list. The current install zip contains this exact committed
Phase 8 build and matches GitHub's frontend byte for byte. Household checks remain.
[Scene preview guide](docs/SCENE-PREVIEW-GUIDE.md).

**Complete when:** hover or a touch Preview action temporarily changes only the local visual appearance; leaving/cancelling restores the live appearance. Preview makes no HA service calls. A separate intentional Activate action applies the actual scene. Scene mappings are visible and editable; missing target state data is reported rather than guessed.

**Chosen approach:** HA scenes do not expose a dependable complete target definition
to this card. Taylor chooses visual light targets explicitly, or captures current
light readings. Those targets describe an approximate lighting look, including
off states and reported RGB/Kelvin/brightness capabilities; they do not claim to
be the real scene definition. Preview and Activate are independent. Actual home
scenes, entity permissions, materials and wall-panel checks remain.

### F13 — ambient idle mode

**Want:** slowly rotate the house when the wall panel is untouched, and dim it at night.

**Already present:** automatic scene darkening, but no idle rotation.

**Phase 9 implementation (verified checkpoint):** Edit → Idle saves opt-in delay,
rotation speed and picture brightness with Save/Cancel/Undo. The existing animation
loop owns rotation and exact camera restoration. A wake tap cannot select a device at
its old rotated position. Device/room panels, editing, previews, actual alerts, camera
flights, hidden/offscreen/disconnected states and reduced motion pause idle effects.
Actual sun or explicit quiet hours in Home Assistant's time zone control visual
dimming; manual Day/Night does not supply that evidence. Dim-only changes scene CSS
and preserves its previous filter, without a renderer or HA action. All 2,508
JavaScript tests in 85 files, full lint/build/bundle matching and 105 dedicated
native source/bundle assertions pass. Actual rendering, exact wake restoration,
hidden-label work, current readings, priority guards, dim-only CSS, native policy
history, focused fields and 320px controls are checked. Final checkpoint `93ab558`
passes complete [GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37270718366):
all 1,090 browser assertions and 48 Home Assistant Python tests, without model
retry. [HACS validation](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37270718303)
passes. The identical production frontend passes the complete local 1,090-check
run, and the final test-only correction passes the dedicated 105-check run.
The earlier 99/105 CI failure is retained: fixture CSS setup had not started a
fresh passive stability observation. The correction preserves every zero-frame
assertion and timeout, and does not change production code. Its diagnostic does
not claim to prove the origin of the old extra frame.
Current `taylors3d.zip` and backup `taylors3d-phase9.zip` contain exact checkpoint
`93ab558`, matching GitHub's frontend byte for byte. Zip SHA256:
`0C7EE048CC21FB0B128CB339C03084A97418F12E1A704CD1D949ABCCE05612F1`.
[Idle mode guide](docs/AMBIENT-IDLE-GUIDE.md). Later wall/furniture/split-floor work
is excluded. Actual house and wall-panel checks remain.

**Complete when:** idle delay, speed, night dimming and quiet hours are configurable; touch, editing or an alert stops idle motion immediately; the camera returns predictably to its normal state. Reduced-motion and low-power settings can disable rotation. Dimming the card is supported without claiming to change the physical tablet backlight.

**Needs:** physical screen/backlight control, if wanted, depends on the actual wall-panel integration.

### F14 — cut-away and glass/faded walls

**Want:** expose the inside of the realistic GLB by cutting/fading walls nearest the camera, rather than hiding an entire floor.

**Already present:** a vertical Side Section clipping plane, storey clipping for some models, global opacity and authored glass materials. Automatic camera-side wall fading is new work.

**Phase 10 implementation (full checkpoint checks passed):** Edit → Model has wall
drafts for normal, fade, glass-like alpha and cut-away presentation. A deliberate
clean administrator action temporarily loads original separate mesh pieces;
clicking a real wall records its exact path and viewed node-local face. Choose
its actual floor, opacity and height above that floor. Save is one layout/history
edit, and restores configured merging around the saved exact paths. Cancel does
not save. Permission/source/model changes cancel old picks and block stale drafts.
Wall-owned material copies preserve authored textures, shared originals and
current global opacity/Section/floor clipping. Picking and occlusion use current
visible faces. Ambient orbit does not change camera-side decisions; reduced
motion applies static changes immediately. The editor does not infer wall tags
or a physical glass/refraction effect. Unit checks pass for these components;
all 2,784 JavaScript tests in 92 files, lint, build and source/bundle matching pass.
Repeated equal viewport sizing now avoids renderer/CSS/projection work while
genuine changes and first sizing still apply; 29 regression checks cover this.
All 141 dedicated native assertions pass (70 source, 70 bundle and a zero-errors
check), with no browser errors or Home Assistant service calls. They cover actual
pixels, camera-side hysteresis, picking, Section/floor clipping, shared textures,
material restoration, permission changes, Save/Undo/Redo and 320px controls.
Two earlier failed runs are retained. Their input fixtures were corrected to
click the actual device anchor and wake inside the card; production code and
strict expectations did not change. Checkpoint `30de3a3` passes all 2,784 JavaScript
tests, 48 Home Assistant Python tests and 1,231 GitHub browser assertions, with
HACS validation passing and no model retry. The unchanged full local regression
also passes all 1,231 assertions. An earlier local Section-readiness timeout
was not reproduced by a passive diagnostic or that unchanged repeat; its cause
remains unconfirmed and the original log is retained. The manual Phase 10 package
matches the pinned checkpoint and GitHub frontend; initial HACS v0.1.0 still points
to the separately verified Phase 9. Actual-house checks remain. See the
[wall guide](docs/WALL-PRESENTATION-GUIDE.md).

**Complete when:** the user can choose normal, cut-away and faded/glass-wall presentation; suitable tagged walls fade/cut according to the camera without losing useful floors or interior objects. Picking and device popups still select the visible target. Fade state resets when disabled; authored transparent glass still behaves correctly. Keep a manual section fallback for models without usable wall separation.

**Needs:** inspect wall geometry/tags and the mesh-merging rules. The intended appearance can be inspired by other projects; implement it for this GLB renderer without depending on another project's generated geometry.

### F15 — furniture packs and drag-and-drop furniture

**Want:** choose furniture from reusable packs and drop it into rooms.

**Starting point:** furniture could be authored into a GLB and hidden by layer. The local checkpoint now adds an in-card furniture library.

**Complete when:** local/imported licensed assets can be browsed, placed, moved, rotated, scaled and removed visually; dimensions fit the model's metre-based coordinates; placements survive reload and join undo/redo and full backups. Assets are counted against agreed tablet/performance limits.

**Scope:** no signed shop, payment system or dependency on another project's commercial pack service is required. Preserve asset licences and attribution.

**Working candidate:** local licensed ZIPs can be imported and browsed, then placed,
dragged in 3D or Top, rotated, scaled, copied, moved to an exact floor or removed.
Save is one history step; Cancel, Undo and Redo retain the original house model.
The separate layer follows floor separation and Section visibility. Original ZIP
downloads retain the supplied models and licences; the included pack maker helps
create a ZIP from an owned compatible GLB and its actual licence.

Native source/bundle checks passed 107/107 after fixing shadow-root decimal input;
the fixture decodes a real embedded texture, exercises native dragging and checks
resource reuse and idle rendering. The final candidate has 4,114 passing JavaScript
tests, lint and source/bundle matching. The final labels also pass 107/107 native
checks; the complete regression includes the restored full House browser suite.
Integration setup/import permissions
passed the separate actual Home Assistant harness, including restart/reload and
setup while HTTP is already running. The exact local checkpoint `5cfcea6` passes
all 1,998 complete browser checks and is preserved as the separate 13-file
`taylors3d-phase13-local-candidate.zip`. Its files match the pinned source. Exact
checkpoint GitHub CI, full dashboard backup and actual house/tablet validation
remain; layout JSON alone does not contain model/pack bytes.

### F16 — baked shadows

**Want:** soft, inexpensive shadows that look good on the wall panel without relying on many realtime lights.

**Already present:** realtime shadows and authored model textures/materials. No in-card shadow-baking workflow exists.

**Phase 7 implementation:** Edit → Model saves Normal, No realtime shadows and
Authored shading (lamps off) through the existing layout/history route. The central
policy blocks sun and lamp shadow work while off, including model movement, light
changes, reloads and theme/sky changes. Re-enable requests current maps once.
Actual light states/controls and authored materials stay intact. The report reads
actual AO/unlit/light-map/UV properties without claiming they prove a complete bake.
All 1,992 JavaScript tests, lint/build/bundle checks and 69 dedicated source/bundle
browser assertions pass. Complete GitHub CI passes all 842 browser assertions and
48 Home Assistant Python tests; HACS validation passes. The complete local browser
regression also passes all 842 assertions. The exact-commit installation zip contains Phase 7 and
matches GitHub's checked frontend byte for byte. Actual house/panel checks remain.
[The model shading guide](docs/MODEL-SHADING-GUIDE.md) explains external Blender
authoring, fixed baked-shadow limitations and model backups. Actual house/panel
checks remain; the card does not create baked textures or rewrite a GLB.

**Complete when:** a documented baked-shadow/ambient-occlusion model workflow renders correctly; the user can select a low-power presentation that preserves useful depth while reducing realtime shadows. Explain that baked shading is fixed and cannot move with a changing light or furniture item. Define whether baking happens in a modelling tool or is eventually offered in-app before implementation.

### F17 — tight Home Assistant integration

**Earlier metadata checkpoint:** Objects, Mower and Overlays have temporary
All/Area/Unassigned filters and current Home Assistant names. Saved missing or
filtered links remain warning choices; new links require current eligibility.
Rooms, pins and mower locations retain exact missing floor IDs instead of
silently moving to Ground. Every saved outline stays selectable even beside a
model room. Views preserve missing floor choices until deliberately unchecked.
Individual object/marker readings use Home Assistant precision; aggregate
previews are labelled separately. Actual Objects Test rechecks current services,
connection and entity eligibility before sending a deliberate command.

The combined furniture/metadata candidate passes all 4,221 JavaScript tests in
126 files, lint, build and bundle freshness. Its source/bundle metadata fixture
passes 101/101 browser assertions and the furniture regression passes 107/107.
Two test setup problems were corrected without weakening their assertions:
the real edit-mode fixture now uses an actual card element, and the furniture
browser helper waits for the current catalogue instead of clicking a replaced
button. Complete browser regression, exact package checks, additional feature
picker filters and actual household checks remain. See the
[Home Assistant links guide](docs/HOME-ASSISTANT-LINKS-GUIDE.md).

**Want:** floors, areas, devices and entity pickers follow HA's setup and respect useful registry metadata.

**Delivered foundation:** one shared metadata helper resolves effective area/floor/device information, HA names, hidden/disabled/category flags, units, precision and filtered choices. Marker membership includes real state-only entities; ordinary reading changes keep marker/coverage objects and idle rendering stable. Sensor/climate readings prefer native HA formatting. Model-object/group and camera pickers use filtered names; missing selected IDs remain visible. Edit → Data reports saved references that need deliberate repair. Explicit deleted model room/floor links retain their ID; geometry is kept without inventing a new area, floor placement or height override. Exact-ID restoration recovers the link. GLB named-view geometry remains independent of HA area/floor assignments.

**Combined local extension:** Data now checks scene previews, room shortcuts,
security locations, weather and House sources against current exact IDs, including
pending registry data and unreadable imported fields. 152 scoped checks pass.
Scenes, Room shortcuts, Environment and House have current area filters; 253
scoped editor checks pass. Combined native metadata/filter/recovery checks now
pass with simulated HA at the Phase 20 checkpoint. Actual household registry and
integration versions still need testing. Entity renames are diagnosed as missing
old IDs; there is no guess based on a similar name.

**Complete when:** feature-specific pickers filter sensibly by domain, class, area and capabilities; display precision/units follow the available HA metadata; renamed, moved and removed entities/areas are handled visibly without corrupting the layout. Distinguish registry updates from explicitly chosen model-room bindings so a HA area change does not silently invent house geometry.

### F18 — room selection and room panels

**First delivery:** stationary room-floor taps open an area panel with its grouped devices and readings, including devices represented by GLB objects. Navigation drags and device taps are kept separate. Registry/layout changes close an old panel so it cannot retain stale room membership. Configurable room-level shortcuts remain future work.

**Want:** tap a room in normal viewing mode and open a useful room panel, like the described Lounge panel.

**Already present:** room outlines, model picking and edit-mode room selection. A normal-mode room control panel is new work.

**Complete when:** tapping a room selects the correct room/floor and opens its panel; the panel lists that area's relevant devices, readings and available controls; room-level actions are configurable. A device tap reaches its own controls rather than also opening the room. Closing the panel restores navigation, and missing/empty rooms have an understandable result.

**Combined local extension:** room panels can display explicitly saved scene and
script shortcuts for that exact room. Opening a panel never runs them. Each press
checks the current room, source and connection again. The visual Rooms-tab editor
adds, names, orders and removes shortcuts with one Save, Undo/Redo and Cancel.
**111 scoped checks** pass, including 48 editor checks. Saved obsolete or empty
room rows can be removed deliberately, releasing the bounded list's capacity;
Cancel and Undo preserve the previous list. Joint browser and actual
Home Assistant checks remain. See the [room controls guide](docs/ROOM-AND-DEVICE-CONTROLS-GUIDE.md).

### F19 — bottom bubble bar

**First delivery:** a bottom bar reserves space below the house; saved views, modes and common controls have clear active states and keyboard focus. Narrow panels use two rows with sideways scrolling. The visual card editor selects/reorders buttons with Up/Down controls; availability follows model capabilities and admin permissions.

Navigation-only configuration changes preserve the selected viewing mode, temporary map visibility and the shared layout storage connection. Changing the layout key loads that key's own layout; an older delayed response cannot replace it.

**Want:** a bubble-style bar at the bottom for views and useful controls.

**Already present:** top toolbar/view chips for floors/views, 3D/Top, reset, section, day/night and Edit.

**Complete when:** touch-friendly bottom bubbles cover agreed views/modes and shortcuts; the active choice is obvious; order/visibility can be configured visually. Works on narrow panels, avoids covering the selected room/device, and coexists with popups and the mini-map. Labels, keyboard focus and theme colours remain readable.

### F20 — device cards with all applicable options

**First delivery:** taps open grouped-entity panels with live readings, explicit supported on/off and light-brightness controls, unavailable/unknown states and command errors. **All controls** opens HA's native entity UI for complete camera/climate/cover/vacuum/etc. options. Long-press retains more-info; the visual editor can restore quick-toggle taps. Specialized in-card camera feeds and richer domain shortcuts remain under their own planned features.

**Want:** tapping a device opens a card with every useful option that device supports.

**Already present:** device taps toggle some devices or open HA more-info; supported model objects have contextual popups.

**Complete when:** popups offer controls supported by the selected entity, such as light brightness/colour, climate settings, locks/covers, camera feeds and vacuum actions. Unsupported controls are not advertised. Current state, errors and unavailable devices are visible. HA's standard more-info remains a fallback. Choose whether quick-toggle or popup is the default tap action, with a usable touch gesture for the other action.

**Combined local extension:** the actual room/device popup now offers advertised
media playback/volume, single-target thermostat temperature/mode, cover controls,
lock/unlock and vacuum controls. Unsupported features, range thermostats and locks
requiring a code use **All controls**. Focused checks pass **158/158**; combined
native checks pass with simulated HA at the Phase 20 checkpoint. Controls retain unfinished typed values
while displaying separately reported readings. Old presses and asynchronous errors
cannot cross a source, account or connection change. This has not been published
or tested against household devices.

### F21 — 2D mini-map

**First delivery:** lightweight north-up SVG room outlines, a floor selector, live device/model-object dots and camera focus/direction. Taps focus the main camera. The visual editor saves visibility, size and top corner; close/map buttons temporarily hide/show it. Editing hides it. Live updates preserve keyboard focus. Tracking adds distinct room-observation, vehicle and vacuum symbols with their actual source controls.

**Combined local extension:** alerts now appear at their exact original plan
positions on the current floor. A confirmed clear removes the symbol; uncertain
readings remain labelled uncertain, and a previously latched alert keeps its
existing acknowledgement rule. An alert tap opens current native entity details
without acknowledging it or sending a device command. **172 scoped checks** pass,
including 26 new alert-map checks. Combined native checks now pass with simulated
HA; actual wall-panel checks remain.

**Want:** a small 2D overview alongside the 3D house.

**Already present:** a full-card, north-up orthographic Top view.

**Complete when:** the mini-map can stay visible in 3D, shows the selected floor and relevant room/device/alert positions, indicates the main camera's focus/orientation, and supports tap-to-focus. Its size/location/visibility are configurable, and interactions do not accidentally orbit the main view. Check the extra rendering cost on the wall panel.

### F22 — cars on the drive

**Want:** show cars while they are parked on the drive, using camera vehicle detections. Taylor confirmed this meaning on 4 October 2026.

**Current implementation:** maintained vehicle occupancy/counts and fixed-expiry timestamped sightings can be bound to explicit driveway locations. The Tracking editor requires a vehicle-specific source; real motion data does not identify a parked car. Exact optional identity matching and scene/mini-map symbols pass local checks with simulated HA readings. Actual driveway detection remains unverified.

**Complete when:** an available HA detection entity/event is mapped to a driveway zone and parked-car model position; arrival makes it appear and departure/expiry clears it. Stale or unavailable detections do not leave a car present forever. If the goal is named household cars, identify a suitable presence/identity source rather than assuming generic vehicle detection identifies the owner.

**Needs:** the actual camera/detection integration, driveway zone, number/positions of displayed cars and the clearing rule. Optional named vehicle identity matching is implemented, but its actual identity source still needs household validation. The card consumes supplied detection data; a raw camera feed is not already a vehicle detector.

### F23 — robot vacuum movement

**Want:** robot vacuum models move around the appropriate floor while cleaning.

**Current implementation:** separate vacuum actors use actual status plus an explicit fixed anchor, exact room observation or validated measured coordinates. Phase 4 evidence handling, floor/section visibility and controls are verified automatically. Phase 5 adds visual X/Y calibration, frozen real source captures and unsnapped plan clicks, imported GPS/unit preservation and independent status/coordinate freshness forms. The complete local and GitHub regressions pass. F23 stays Testing for actual household coordinates, mapping and wall-panel checks.

**Complete when:** a vacuum with location/map data can be bound, calibrated to house coordinates, shown on the correct floor and updated while cleaning; docking, idle and unavailable states are clear. Multiple vacuums are distinguishable. Without actual coordinates, a stationary status marker is available; decorative movement, if chosen, is labelled simulated rather than presented as live location.

**Needs:** vacuum make/integration, coordinates or map access, floor mapping and calibration data.

### F24 — split-floor views

**Want:** two ways to separate floors: a horizontal flat split into different floor views, and a vertical stack of separated layers.

**Original foundation:** single floor/storey views, an All view and a side section.
The checkpoint notes below record the later separated-floor implementations.

**Phase 11 verified implementation:** Edit → Model has Normal, Side by side and
Stacked layers with explicit floor ordering, up to four floors, measured footprint
spacing and Save/Cancel/Undo. It uses the existing single house view and fixed light
pool. That first interpretation of horizontal split spread floor geometry together;
at that checkpoint, separate floor pictures were not implemented.

Current model groups must be explicitly linked to exact floors, with all remaining
geometry explicitly owned as background. Missing, automatic, conflicting or
unsupported links leave the house assembled with diagnostics. Source coordinates,
calibration and mini-map plans remain unchanged; feature layers receive display
copies. Section and Edit temporarily assemble the house. Camera restoration includes
raw precision and framing limits; measured mower floors take precedence over their
authored parent. Failing-first tests caught and fixed those two boundary cases, an
old single-floor camera being reused after an overview change, and unnecessary
camera/preview cancellation for an unchanged default.

The isolated floor checkpoint passed 3,143 JavaScript tests across 101 files,
lint, build and bundle parity. Its dedicated browser run passed all 129 checks
(64 source, 64 built card and the browser-error check). Tests cover actual native
room/device clicks, source export, camera restoration, visual editing/history,
narrow controls and unchanged idle rendering. Theme and furniture drafts are
excluded from this checkpoint. Exact checkpoint `b10da26` passes the complete local
regression and [GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37280500045):
1,360 browser assertions, 48 Home Assistant Python tests, all JavaScript tests and
build checks, with no browser retry. HACS validation passes. The manual installation
zip contains all 11 exact pinned integration/licence files and matches GitHub's
frontend byte for byte. HACS v0.1.0 still contains the older Phase 9 release. The
[floor guide](docs/FLOOR-PRESENTATION-GUIDE.md) explains use and household validation.

The first native run also exposed a real source-coordinate defect: an animated
mower's display offset could be measured as part of the house footprint after a
door animation became active. Source measurement now uses the mover's canonical
saved position and excludes runtime helper geometry; changing an allowed child
animation rechecks ownership without repacking floors. Eighteen failing-first
regressions protect that repair. Four earlier native logs are retained, including
three test-fixture errors corrected without relaxing production behavior or room
selection requirements. Actual household/model and wall-panel checks remain open.

**Phase 20 local implementation — separate floor panels:** the horizontal arrangement now
has an optional **Separate floor panels** setting in **Edit → Model → Floor
presentation**. Save it; with a GLB, open **Edit → Views**, choose All or the
intended overview in **View**, and check the wanted floors under **Linked HA
floors**. Leave Edit and select that view to show up to four allowed selected
floors together. Panels respect existing view floor assignments and model show/hide
rules. A model All view without a saved assignment normally follows its highest
visible storey's HA floor; the non-model All view allows all current floors.
Wide scenes use columns; narrow scenes, including phones, stack the panels
vertically. Each floor has its own
framed picture, while orbit, pan and zoom remain linked across the pictures.
Separate camera controls for each panel are a possible later choice.

Tap a panel's floor-name header to choose the floor shown by the mini-map. A
mini-map focus action moves the linked view to that floor's selected location.
Room/device picking and located feature overlays use the panel's exact floor;
unknown floor ownership must not repeat an item in another panel. All panels
reuse the existing renderer, scene and fixed light pool. Normal, horizontal views
with the option off, and vertical stacked layers keep their existing presentation.
Edit and Section temporarily assemble the house and retain the saved panel setting.

The Phase 20 checkpoint above records the complete local unit/native checks and
the exact installation ZIP for these panels. Room/device menus select their actual
floor, tracked labels keep their panel's screen space, and authored model lights
are temporarily isolated without allocating another light pool. The assembled
house and source positions return when panels are suspended or switched off.
Earlier checkpoint results remain historical. Actual Home Assistant installation,
the real GLB and wall-panel performance remain unverified; no public release is
claimed. See the [floor guide](docs/FLOOR-PRESENTATION-GUIDE.md) for setup and checks.

**Complete when:** horizontal panels can display selected floors at the same time; vertical layers can be spaced apart with a configurable gap. Devices, rooms, people/vacuums and alerts remain aligned with their floor. Selecting a floor focuses the right panel/layer and opens the right controls. Returning to the normal house restores its geometry/camera state. Total rendering/light cost remains bounded across views.

**Needs:** validate Taylor's actual model groups, floor links, devices and wall
panel in Home Assistant. Whether each panel should later have independent camera
controls is an optional preference; this tested local version uses linked controls.

### F25 — polish, translations, preview and reliable bundles

**Want:** translations, a usable mock-HA preview, screenshot tooling and CI that detects stale bundles.

**Starting point:** English integration strings, a mock HA demo, browser screenshots, 514 JavaScript tests and GitHub workflows. Most card UI strings were hard-coded English. Bundles are generated/ignored by Git rather than committed; CI rebuilds them. The later translation extension below covers the current local version.

**Complete when:** new and existing card UI can be translated with sensible fallback; preview scenarios cover the new features without needing real household devices; screenshots can be recreated; relevant automated checks protect behavior. Release assets contain the current source's bundle, and the integration's frontend copy matches the generated `dist` file. Define the stale-bundle check around build/release contents rather than demanding a Git diff of ignored files. Keep local development instructions clear for Windows as well as macOS/Linux.

**Earlier foundation:** right-panel/preset/overlay browser suites and screenshots, English service translations, and `npm run check:bundle`. That command recompiles current source in memory and checks both distributed copies; CI and release packaging fail if either copy is missing or stale. The current translation coverage and limits are recorded below.

**Combined local translation candidate:** bundled messages cover common
controls, card setup and advanced Security/Tracking/Cameras/shading captions in
English, German, French and Spanish. HA locale selects the language; unsupported
languages use English. User names, exact IDs and HA-formatted readings stay intact.
Focused checks cover retained native fields, literal names, unavailable imported
settings and missing-reference recovery. Caption traversal was indexed after three
unchanged Tracking tests exposed a performance problem. Presentation-only registry
changes now retain open controls; actual membership changes still rebuild them.
The complete combined unit regression and native translated-width checks now pass
with simulated HA at the Phase 20 checkpoint. Current-candidate GitHub/Linux checks
and household acceptance remain. Room shortcuts, device controls, GPS calibration, minimum-pixel mower
controls, reference reports and runtime room/alert labels have additional translated
messages. Some detailed explanations and other feature prose remain English. See the [translation guide](docs/TRANSLATION-GUIDE.md). No complete
translation or actual household certification is claimed.

## Baseline work to resolve

### B01 — distant terrain camera range

**Status:** Done (verification). An earlier local browser check reported a terrain corner at depth 243.35 m outside a 199.28 m far rendering limit with a camera 130 m away. This did **not** reproduce in either GitHub attempt, the Phase 1 local model check, or the final complete CI suite: those passed with a 286.82 m far limit. Rendering logic was unchanged during the rename and Phase 1. The cause of the earlier sample remains unproven; no confirmed rendering defect required a fix.

**Complete when:** the distant terrain remains visible within the intended rendering limits and the existing model checks pass, with no regression in depth precision, sky, model framing or saved views. Record the diagnosis and fix separately from feature work.

### B02 — GitHub CI and HACS validation

**Status:** Done. The final integration, card and HACS checks pass. Earlier failures, diagnoses and fixes are recorded below.

- [Base CI run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37236933008).
- [Base HACS validation run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37236933000).

The GitHub CI installation, lint, JavaScript unit tests, build and Python integration tests passed. The model browser check failed on both attempts with a 30-second navigation timeout while opening the model-camera fixture (`scripts/lib/demo-browser.mjs:54`, called by `scripts/model-check.mjs:1831`). The cause beyond that timeout remains unproven; B01 was not the GitHub failure.

HACS failed only because the repository had no valid topics. The other seven checks passed, including licence, HACS configuration and integration manifest. Add appropriate repository topics, then revalidate. Make the browser check load reliably without removing meaningful coverage.

**Update:** repository topics were added; [HACS validation now passes](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37237996681). The shared browser helper now waits for the document and actual card readiness instead of global network silence. Model fixtures get time to parse; each existing model test retains its specific readiness/assertions. Legacy object-toggle checks explicitly select Quick toggle; default popups are tested separately. New navigation checks run in CI. The final complete CI result is recorded below.

**Phase 1 follow-up:** [the first feature CI run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37239514063) passed Python integration tests, all 571 JavaScript tests, lint and build, but failed the mini-map camera-focus check. A real pointer reproduction confirmed that tapping the map immediately after dragging could leave camera inertia pulling away from the selected room. Mini-map navigation now stops that previous motion while preserving the current visible camera, then starts its focus movement. The browser helper waits for actual camera stability, and an immediate drag-to-map regression retains the original position tolerance. The later verification results are recorded below.

The same browser checks exposed an initially-Top card restoring an unframed, zero-distance perspective camera when switching to 3D. That invalid snapshot is now ignored, so the 3D button uses normal house framing. Both fixes support the selected navigation features; the other planned features remain unimplemented.

**Model fixture follow-up:** [the navigation-correction CI run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37240222216) passed the complete editor/navigation suites and all model checks except the magnetic-drag fixture's lamp lookup, on both attempts. The lamp and model raycast worked; the reserved scene viewport projected a device marker over that small lamp, leaving no exposed pixel at the fixture's old camera angle. The fixture now uses a closer angle that exposes the real lamp, and requires an actual in-bounds canvas hit. Real wall/lamp dragging, attachment, realignment, fallback, Alt-drag and detach assertions remain intact. Focused verification and the final complete CI result are recorded below.

**Final navigation follow-up:** [the next CI run](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37241187536) found that the new room-test helper could choose a ceiling lamp's upward face or nearby device hit area instead of a room floor. The helper now requires the matching room's upward floor and excludes actual mouse-priority device hits; app selection logic was already correct. The complete local navigation suite passes with that stricter choice. Visual review also found light button backgrounds with pale text in a partial dark theme; popup buttons now fall back to the theme's card background. Actual enabled-button contrast is 16.10:1 in light and 13.03:1 in dark, above the 4.5:1 check. Screenshot examples were refreshed. The final complete CI result is recorded below.

**Final result:** code commit `9de9626d6abd8b47988476572e00113340d38b77` passes [complete GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37241578811) and [HACS validation](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37241578888). Both CI jobs succeeded: Python integration tests; all 571 JavaScript tests in 33 files; lint; build; and the complete demo, editor, navigation and model browser checks. The model suite passed on its first attempt. F18–F21 stay Testing until the actual Home Assistant, house model and wall panel checks below are completed.

Local build, lint and all 514 JavaScript tests passed before upload. The full HA Python harness was not run locally; it passed in GitHub.

**Complete when:** diagnosed failures are resolved or precisely documented, and the required integration/card/HACS checks succeed. Do not silence a meaningful check merely to get a green result.

### B03 — actual Home Assistant and model validation

**Status:** Needs input. The base was uploaded to GitHub; this does not confirm that it is installed in Taylor's actual HA. No Taylor house GLB or household entity list was supplied during the code audit.

**Complete when:** the base loads in Taylor's HA, saves a shared layout, uploads the actual GLB, and works beside the original integration. Confirm room outlines/tags, floor alignment, model north and available entities before relying on them for new features. A GitHub release containing the integration zip is needed for the HACS release-download route.

## Decisions and information to gather

| Decision/input | Why we need it | Current position |
|---|---|---|
| First feature group | Sets the implementation order | Confirmed: bubble bar, room/device popups and 2D mini-map. |
| Vehicle meaning | Determines generic detection versus named household car presence | Confirmed: show cars parked on the drive using detections. |
| Full backup scope | Whole HA dashboard, its Taylor layouts and owned model/furniture assets | Implemented and locally checked with simulated HA; Linux HA compatibility and actual restore remain. |
| Split-floor controls | Whether each floor panel should later move independently | Phase 20 local checks pass for separate horizontal floor pictures with linked orbit/pan/zoom. Independent controls remain an optional unanswered preference; actual model/panel acceptance remains. |
| Actual GLB and model tags | Door pivots, separated walls, room outlines and floors | Not verified against Taylor's model. |
| Wall panel/browser | Sets realistic animation, lighting and split-view limits | Not recorded yet. |
| HA entities/integrations | Presets, Ring feeds/detections, Hue, temperature/power, presence, smoke/leaks and vacuums | Use actual available entities; do not assume model names imply data availability. |
| Optional hardware controls | Physical screen dimming, camera streams and vacuum locations | Confirm integration capabilities when the feature is started. |

We will ask for the relevant details when starting that feature, instead of requiring every device detail before recording the ideas.

## Completion and progress record

A feature is Done only after its agreed behavior works, it persists where appropriate, missing data behaves clearly, and the relevant checks pass. Check touch use on the target panel, HA permissions, theme readability and reduced-motion/performance settings where the feature needs them. Keep the existing integration and storage namespaces separate from the original project.

| Date | Item | Progress / evidence | Commit or PR |
|---|---|---|---|
| 2026-10-06 | Phase 22 UI polish local candidate | Current 787c366e passes 6610/6610 unit tests in 207 files, lint/build/freshness, visual 10564/10564 source/bundle across 1728 views, editor 96/96, room 84/84 and feedback 88/88. Complete qualified coverage passes 36 programs (16 final runtime +20 verified earlier checkpoints), 15994 recorded passing lines; independently audited 20-member local ZIP matches tested bytes. Historical proof epochs stay preserved; actual HA/current CI remain UNRUN. | Local candidate; no new commit, push, tag or release |
| 2026-10-06 | Phase 20 local checkpoint | Optional linked floor panels, responsive pictures, exact picking/menus/map, label spacing, authored lights and idle sky refresh pass 6054/6054 unit tests in 196/196 files, lint/build/bundle matching and all 30/30 native scripts with unchanged runtime. Exact 20-member local ZIP matches the tested frontend. Actual HA/model/panel, Linux/current CI and public release remain separate; Phase 19 history is preserved. | Local candidate; no public commit or release assigned |
| 2026-10-04 | Base | Independent renamed base uploaded to `main`; local build/lint/514 JS tests passed; online checks need B02 | `055e30f` |
| 2026-10-04 | Requirements | Taylor's complete initial feature list recorded; foundations and pending inputs checked against the code | `a2c49d0` |
| 2026-10-04 | Phase 1 | First bubble bar, room/device panels and mini-map implemented. 571 JS unit tests and lint pass. Existing editor browser checks and the complete new navigation browser suite pass, covering real clicks, correct service payloads, grouped rooms, map floors, keyboard focus, narrow layouts and GLB overlays. Shared-storage/key-change regressions pass. Actual HA/panel testing remains. | `f42fded` |
| 2026-10-04 | Navigation correction | Fixed immediate drag-to-mini-map drift and initially-Top to 3D framing. Complete navigation browser suite passes, including real active-pan regressions in both modes, unchanged destination tolerances and all GLB overlay checks. GitHub follow-up CI and actual HA/panel validation remain. | `6e90252` |
| 2026-10-04 | Model fixture correction | Exposed the lamp with a closer fixture camera and required a real uncovered canvas pixel. All 15 focused magnetic checks pass, with unchanged tolerances and zero browser errors. App code and navigation controls are unchanged by this correction. Included in the final successful full CI. | `ec2f581` |
| 2026-10-04 | Popup and room-test polish | Fixed theme background fallback and confirmed enabled-button contrast in both themes. The complete navigation suite, stricter GLB room taps and all 20 popup unit tests pass. Screenshots updated. | `9de9626` |
| 2026-10-04 | Automated validation | Complete GitHub CI and HACS validation pass. Full model suite passed on the first attempt. Manual installation zip matches the generated frontend. Actual household validation remains B03. | `9de9626` |
| 2026-10-05 | Phase 2 | Right-hand panels, individually addressed camera actions with acknowledgements/optional return, grouped Undo/Redo, and visual measurement/alert bindings implemented. All 668 JS and 48 HA Python tests pass, alongside lint/build/bundle gates and the complete GitHub browser suites. The model suite passes on its first attempt. Fixes retain named-view floors, scope keyboard Undo to the focused card and keep unrelated HA updates from redrawing the house. HACS validation passes; actual HA/house/panel checks remain. | `661e87f` |
| 2026-10-05 | Phase 3 | Native camera views, explicitly configured approximate coverage and its editor, shared entity metadata/precision and missing-link preservation implemented. All 933 JS and 48 HA Python tests, lint/build/bundle gates, complete browser suites and HACS checks pass. The GitHub-built frontend matches the exact-commit manual package; household camera/model/panel checks remain. | `1a3e733` |
| 2026-10-05 | Phase 4 | Explicit presence/activity, parked vehicles, measured/status vacuum symbols, Tracking editor, source panels and mini-map bindings implemented. All 1,214 JS and 48 HA Python tests, lint/build/bundle checks, complete local/GitHub browser suites and HACS validation pass. Exact-commit manual package matches the GitHub frontend. Household checks and visual vacuum calibration remain. | `90c626a` |
| 2026-10-05 | Phase 5 | Visual source/plan calibration, separate freshness controls, exact contacts/rigid hinge motion and bounded outdoor weather implemented. All 1,704 JS and 48 HA Python tests, lint/build/bundle checks, complete local/GitHub browser suites and HACS validation pass. All 659 browser assertions pass, including 71 calibration, 30 security and 31 weather checks. The model suite passes without retry. Exact-commit installation zip matches GitHub's frontend; actual household checks remain. | `ca64019` |
| 2026-10-05 | Phase 6 | Validated light appearances, deliberate RGB/Kelvin controls and current-output lighting selection implemented. All 1,904 JS and 48 HA Python tests, lint/build/bundle checks, complete local/GitHub browser regressions and HACS validation pass. All 773 GitHub browser assertions pass, including 113 lighting checks and the 31-check passive expiry-observation fixture. Exact-commit manual package matches GitHub's frontend. Actual HA/Hue/model/panel checks remain. | `a6599cb` |
| 2026-10-05 | Phase 7 | F16 saved model-shading choices, full sun/lamp shadow suppression, actual material/UV evidence and external AO-authoring guide implemented. All 1,992 JS and 48 HA Python tests, lint/build/bundle matching, complete local/GitHub regressions (842 browser assertions each) and HACS validation pass. Exact-commit manual zip matches GitHub's artifact. Actual house/panel checks remain. | `42c826e` |
| 2026-10-05 | Phase 8 | F12 explicit light previews, current-light capture and separate deliberate scene activation implemented. All 2,276 JS and 48 HA Python tests, lint/build/bundle matching, complete local/GitHub regressions (985 browser assertions each) and HACS validation pass. Dedicated local scenes checks pass 143 assertions. Exact-commit manual zip matches GitHub's artifact; actual household checks remain. | `eac07d6` |
| 2026-10-05 | Combined 0.2.0 local checkpoint | 5663/5663 JS tests in 185/185 files; lint/build/bundle pass; 11/11 selected native scripts. Earlier 25/29 and 3/8 runs remain historical. Linux HA/current-candidate CI, public push/release/install, actual house/device/panel and independent-floor-panel acceptance stay separate. | Source freeze `bb702089c6324d4e99b4c7ae3ba559b555a4f7f2d7de482bd39bc9f411e6c3b2` |

### Phase 1: Taylor's Home Assistant check

After installing a build containing Phase 1:

1. Open Taylor's 3D and confirm the bottom buttons and mini-map appear.
2. Change floor and 3D/Top view. Confirm the map shows the correct floor and tap it to focus a room.
3. Tap a room's floor. Confirm its panel shows the area's actual devices and readings. Rooms need outlines and area links.
4. Tap a light/device. Simply opening its panel should not change it. Press On/off or brightness intentionally; verify the actual device responds.
5. Use All controls for a camera, cover, climate or vacuum; confirm HA offers its supported controls. Check an unavailable device is shown clearly.
6. Orbit/drag the house. No device should change and no room panel should open from the drag.
7. In the dashboard card's visual editor, change button order/visibility, map size/corner and device-tap behavior. Save, reload and confirm those settings persist.
8. Enter the card's layout Edit mode: the map hides, room/device editing still works, and Done restores normal navigation.
9. Try the wall panel in its real light/dark theme, including narrow layout and touch use. Record any issue here before marking F18–F21 Done.

### Phase 2: camera actions, editing and overlays

The right-side controls, saved-camera action, Undo/Redo and room/alert overlays are implemented. Read [the controls guide](docs/FEATURES-GUIDE.md) for the steps and the meaning of each setting. Automated checks use the supplied example houses and mock Home Assistant; household acceptance remains separate.

**Validation details:** the original complete local model run passed its geometry, lighting, alignment, view, export and editor assertions, but found one real regression: ten unrelated HA state updates caused ten unnecessary model frames. The fix invalidates status layers only for changed visible data; the original strict model idle assertion remains in place. The new overlay browser checks also require zero extra frames/shadow work with overlays off and with unchanged configured readings. An earlier navigation stability timeout did not reproduce in the final complete navigation run, with its original timeout and camera tolerances unchanged; its cause remains unconfirmed. Bounded diagnostics were added for a repeat. Final online CI must exercise the Python services and the full freshly built browser suites before this update is considered automatically verified.

**Local performance result:** the final overlay browser suite passes all 23 checks. With overlays off, ten unrelated HA updates leave model frames at 10, shadow passes at 8 and shadow-light work at 13. With an enabled, unchanged temperature reading, frames stay at 11 with the same shadow counters. Final navigation, all 22 history/visual-editor checks and the complete existing editing browser suite pass, with no browser errors. The package's frontend matches the current source build (`0e433a7b44e600a034de11b62c71f853b7b814573e59259fee8f93e43d7ecdc6`). Python service execution and the final complete model rerun still require online CI.

**Final automated result:** code commit `661e87fb43bb3a993592dd49e6969595325bb411` passes [complete GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37246963282) and [HACS validation](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37246963287). All 48 Home Assistant Python tests, all 668 JavaScript tests, lint, build and both source/bundle checks pass. The complete demo, editor, navigation, model, right-panel, camera-action, overlay and history browser suites pass; the model suite succeeds without retry. The downloaded GitHub-built frontend has the same SHA-256 as the local manual-install zip's card. F01/F03/F05/F09/F18–F21 remain Testing for the actual household checks below. Further camera and metadata work is separate from this verified checkpoint.

1. On a wide screen, open a room and device panel. Confirm the house and mini-map remain usable beside it. On the wall panel, check scrolling, closing, touch targets and the bottom bar.
2. Give each browser a unique screen name in Edit → Views. Save Front door, Garden and Top-down views. Reload and confirm the screen name and views survive.
3. Run the Select camera preset action for just one screen. Confirm the other screens stay unchanged. Check an incorrect screen/preset gives an action error rather than reporting success.
4. Try a 30-second return, then touch the screen during another return. Confirm the first returns to its previous position and the second leaves your manual view alone.
5. Move a device, draw/change a room, save a view and change an overlay. Undo and Redo each change, then reload to confirm the restored layout was saved. Typing in a text box must keep normal text Undo.
6. In Edit → Overlays, connect one real temperature sensor and one power sensor to their rooms. Change the real readings and confirm the colours and labelled units follow them. Confirm unavailable readings look different from zero.
7. For an energy view, confirm the selected sensors use the same period. For several meters, identify separate loads and avoid counting both a total and its parts.
8. Use a harmless test entity for an alert. Check its assigned location, active pulse, unavailable state and clear/acknowledge behavior. Try reduced motion: it should remain a steady marker.
9. Keep your GLB backed up separately. Replacing/deleting its server file resets Undo history; full model-asset backup is still F04.

Record actual HA version, browser/panel and entity IDs when these checks are completed. Do not mark F01/F03/F05/F09 Done based only on the mock preview.

### Phase 3: camera pictures, coverage and Home Assistant metadata

Physical-camera views, explicit approximate coverage and the Cameras visual editor are implemented. The shared metadata foundation adds HA formatting/precision, filtered entity choices, state-only marker membership and missing-link diagnostics. [The camera guide](docs/CAMERAS-GUIDE.md) explains the controls; [the controls guide](docs/FEATURES-GUIDE.md#missing-home-assistant-links) explains deliberate repairs.

**Local validation:** all 933 JavaScript tests in 44 files pass, alongside lint. The new native-player fixture tests element removal, permissions, late async replies, grouped/room selection, focused drafts, Save/Undo/Redo, static cone floors, narrow touch controls and zero service calls on viewing. This is a simulated camera picture, not an actual Ring stream. The complete regression run and final built source are being checked separately before recording their final result.

**Performance fix:** adding a new unplaced state-only sensor originally caused one unnecessary GLB frame. Visible marker DOM now stays intact when its contents/positions have not changed; semantic marker-visibility changes still redraw. The original strict overlay checks pass with ten unrelated updates causing zero extra frames, shadows or shadow-light work, both with overlays off and with unchanged configured temperature. Unit regressions retain actual grouping/entity changes, floor-height changes and hides. Cancelling an edit/reloading or replaying history invalidates the pose cache so a temporary dragged position cannot survive an identical saved layout.

**Final automated result:** code commit `1a3e73331b9b97539b4d45347214e2947a130089` passes [complete GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37249212292) and [HACS validation](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37249212277). All 933 JavaScript tests in 44 files, all 48 Home Assistant Python tests, lint, build and source/bundle checks pass. Every demo, editor, navigation, model, panel, preset, overlay, history and camera browser check passes; the model suite succeeds without retry. The downloaded GitHub frontend and the manual zip rebuilt from that exact commit match byte for byte (`fb8082f9e2be1c19536bfbe95dc6dc94dfa653427d734348e8e6a97fd64a5356`). The complete local regression run also passed, but used the preceding build before the final cache-reset/hidden-camera fixes; the exact final source is certified by the complete GitHub run. Further tracking work remains separate from this verified camera checkpoint.

**Household checks still required:**

1. Verify the chosen Ring live-view entity works in Home Assistant's own controls. Tap it in Taylor's 3D, and check that Close view, Escape and leaving the dashboard remove this viewer. Other camera cards/preload settings are independent.
2. Map a real camera position. In Edit → Cameras, configure heading, horizontal viewing angle and approximate range; Save, Cancel, Clear, Undo and Redo. Compare the drawing to the real picture. Coverage does not detect vehicles or people and does not account for obstacles/vertical tilt.
3. If a camera has several mapped model objects, choose the intended mount. Hidden/missing mounts must not relocate a cone to another marker. Check unavailable, missing and disabled states.
4. Check grouped/room cameras and the camera panel on the actual wall-panel browser, including recovery/Retry and reduced motion. Playback is muted; HA handles its native player errors.
5. Compare sensor names, decimals and units with HA. Check devices inheriting an area through their parent and hidden/disabled/diagnostic choices.
6. With a harmless test layout, remove an assigned HA area/floor and inspect Edit → Data / Model. The exact old ID must remain labelled missing; choose a replacement or unassign it. Restoring the exact old ID recovers the link. Keep a backup of the real layout.

F07 remains Testing for these household checks. F17 remains In progress as each later feature adopts the common helper. Presence, parked vehicles and measured vacuum positioning are the next independent implementation; they are not included in this camera checkpoint.

### Phase 4: room observations, driveway vehicles and vacuums

The Tracking editor, explicit observation adapters, per-actor geometry, mini-map symbols and source-specific control panels are connected. [The tracking guide](docs/TRACKING-GUIDE.md) explains sources, locations and the meaning of each observation. This historical checkpoint is preserved in `taylors3d-phase4.zip`; the current manual package contains the separately verified Phase 5 additions.

**Final automated result:** code commit `90c626adbbac25a564218e9a5cefe17fb2d4e921` passes [complete GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37252425200) and [HACS validation](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37252425209). All 1,214 JavaScript tests in 51 files, all 48 Home Assistant Python tests, lint/build/bundle gates and every browser suite pass. The complete final local regression also passes; the model suite passes without retry locally and online. The manual package rebuilt from this exact commit matches the downloaded GitHub frontend byte for byte (`f392743dc587546c756fae4416220f5994f75b911ac9719f635d21719da13be9`). Later calibration, security and weather drafts are excluded from that package.

**Behavior checked:** visual Save/Undo/Redo, focused drafts, every editor tab at 320px, measured versus fixed vacuum positioning, source arrival/departure, fixed sighting expiry without updates, replay protection and disconnect/reconnect cleanup. Real clicks open the exact vehicle/vacuum source controls: bounded screen-label spacing fixes both ordinary-marker and nearby-actor overlap without moving the actual house positions. Light/dark tracking text contrast passes. Regression tests cover restored evidence, diagnostic sources, malformed freshness, missing modes, cancelled interpolation, immutable event deadlines, independent vacuum status/coordinate freshness and registry device-class changes.

**Performance evidence:** in the final local tracking fixture, ten unrelated updates keep frames at 10, shadow passes at 8 and shadow-light work at 13. The same parked actor/geometry remains, with zero tracking timers or HA service calls. Overlay-off and unchanged-temperature regressions also cause zero extra frames/shadows. The complete local and GitHub model runs retain their strict idle, geometry, lighting, occlusion and editing checks.

**Work remaining at this historical checkpoint:** visual vacuum calibration and real presence/detection/coordinate sources, model positions and wall-panel checks. Phase 5 subsequently implements the calibration workflow; the household checks remain in [the tracking guide](docs/TRACKING-GUIDE.md#check-in-your-home-assistant). F08/F22/F23 are now Testing. No release tag has been published yet.

The earlier local full-model regression run was stopped after its initial rendering/visibility/terrain/section/sky/merge checks passed, because its loaded script still expected the old default tap behavior. Those assertions now explicitly select Quick toggle. That local run remained partial; the final GitHub CI subsequently completed and passed the entire model suite.

### Phase 5: calibration, contacts and outdoor weather

Code checkpoint `ca640196fe109a01b3cbb7fa66809de4bf7e7e3c` connects visual vacuum calibration and independent source-age controls, explicit contact highlights/hinges and opt-in current-weather effects. [The tracking guide](docs/TRACKING-GUIDE.md) explains matching source coordinates to the house; [the security/weather guide](docs/SECURITY-AND-WEATHER-GUIDE.md) explains model prerequisites and household checks.

**Verified result:** all 1,704 JavaScript tests in 65 files, all 48 Home Assistant Python tests, lint, build and both source/bundle freshness checks pass. The complete local and [GitHub browser regression](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37256847229) passes all 659 assertions, including 71 calibration checks across source/bundle and drawn-plan/GLB scenarios, 30 security checks, 31 weather checks and every existing suite. The model suite passes without retry locally and online. [HACS validation passes](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37256847036) for the same commit.

**Historical exact package:** `taylors3d-phase5.zip` was built from that committed source snapshot. Its frontend matches the downloaded GitHub artifact byte for byte: `810f10172f0352b903a3976321a9196aae1b7aee5114877b953ec99ab6919236`. The zip SHA256 is `3f0f6efb3585624c026ba38f01601b3acf780684b64b65325aebf0747899f87b`. The current manual package contains the separately verified Phase 7 shading additions. No release tag has been published. Actual household devices, model, streams and panel remain unverified.

**Repairs included:** captured picks cancel immediately after a floor/context change; numbered calibration points remain visible above device badges without moving their coordinates. Untouched malformed imports remain invalid until deliberately repaired, and stale weather drafts cannot overwrite newer card settings. Malformed restored-data flags cannot become live coordinate/contact evidence. Clearing an already-empty mower trail no longer redraws the house. The weather idle fixture starts with its unrelated sensor already registered, so it measures reading updates separately from adding an entity.

### Phase 6: light colour, warm/cool white and room illumination

Model lamps, drawn floor glows and both light panels share the same validated HA light
appearance. Supported RGB and Kelvin controls send deliberate commands and retain real
reported state until Home Assistant responds. Uncertain readings remain dark; the
existing eight-point/four-spot/four-shadow pool prioritizes current output and retains
compatible assignments. [The lighting guide](docs/LIGHTING-GUIDE.md) includes a simulated
surface-lighting screenshot and checks for Taylor's own installation.

**Local result:** all 1,904 JavaScript tests in 67 files, lint, build and bundle matching
pass. The complete browser regression passes all 772 assertions with no browser errors
and no model retry. Its 113 lighting assertions sample actual rendered floor/wall
pixels, native input events, latest capabilities, cancelled gestures, resource reuse,
unchanged readings and drawn-plan markers. Actual Hue/model/tablet validation remains.

**Expiry-test observation repair:** the later log-only Phase 5 CI run read its first
two-second deadline 272 ms after it had already expired. The real timer correctly
pointed to the later event. A passive recorder now captures normal updates before slow
rendering can delay Puppeteer's observation. Real two/four-second clocks, exact
deadlines, unknown/grey/neutral poses and zero service calls remain required. The
revised complete Security suite passes all 31 checks separately, including unchanged
source references and exact restoration of the temporary observer. Production expiry
behavior is unchanged.

**Final online result:** code checkpoint `a6599cb026670705f8980d5f389cf24cd2928331`
passes [complete GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37260397278):
all 1,904 JavaScript and 48 Home Assistant Python tests, lint/build/bundle matching and
all 773 browser assertions, including the final 31 security observations. No browser
errors or model retry. [HACS validation passes](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37260397272).

**Historical exact package:** `taylors3d-phase6.zip` was built from that committed
source snapshot. Its frontend matches GitHub's downloaded artifact byte for byte:
`c6fb8eaedc6da3d8bf472db37847ac1fcce2f28dc2ab38a6645aa5a203a721ba`.
Zip SHA256: `a4dcecb454d7d37af9fef0709e0b93fe948b195fe643e9cbc04121846b179566`.
Phase 5's package was preserved separately. That historical manual package later contained
the independently verified Phase 8 scene-preview additions.
No release tag has been published; actual household validation remains.

### Phase 7: model shading and authored texture diagnostics

Code checkpoint `42c826e563b04082badf42fcd63f865dd1c96319` passes
[complete GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37262618827):
all 1,992 JavaScript tests in 72 files, 48 Home Assistant Python tests, lint, build,
source/bundle freshness and all 842 browser assertions. The 69 shading assertions
sample actual AO/PBR/unlit pixels and check native settings/history, current shadow
maps, unchanged updates, resource reuse and reload. No browser errors or model retry.
[HACS validation passes](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37262618901).
The complete local browser regression also passes all 842 assertions, with no browser
errors or model retry. Actual household checks remain.

The historical manual `taylors3d-phase7.zip` was packaged from that exact source snapshot.
Its frontend matches GitHub's artifact byte for byte:
`2cec6495e4cc99c29d4aaa9df10e86b03da9c8c78747cd65d7a795cca06b401f`.
Zip SHA256: `36ac0adfbdfdd4386b8b709e3f17925a1da847ff961764eb2c4c81d811bc18dd`.
This checkpoint predates the separately verified Phase 8 scene previews.
No release tag has been published; HACS release download remains pending.

### Phase 8: explicit scene-light previews and intentional activation

Code checkpoint `eac07d6b7d317bb4c319d086ce8f3345db70270e` passes
[complete GitHub CI](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37265847024):
all 2,276 JavaScript tests in 80 files, 48 Home Assistant Python tests, lint,
build, source/bundle freshness and all 985 browser assertions. The complete local
regression from the same committed snapshot also passes all 985 assertions with
no browser errors or model retry. The dedicated local scenes run passes 143
assertions, including actual pixels, native controls and current permissions.
[HACS validation passes](https://github.com/gregtaylor1993/taylors-3d/actions/runs/37265846996).

The historical Phase 8 manual `taylors3d.zip`, preserved as `taylors3d-phase8.zip`,
contains that exact build. Its frontend matches GitHub's downloaded artifact:
`c7d3d5ae05a64f0895db81e7fd0c25056a818e9d9e9c1d77cab977ff7692b922`.
Zip SHA256: `c8c935d90f95edbf4d3c27efd47bc7d8c2d894effb26905d837c994b74801904`.
Unfinished Phase 9 idle-mode work is excluded. No release tag has been published;
HACS release download and actual household scene/model/panel checks remain.

When starting work, add a row here and update the feature status above. When it is completed, record exactly what was tested and any unfinished part that remains.
