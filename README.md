# Floorplan 3D for Home Assistant

A Lovelace card that shows your home as a 3D floorplan with every device on it. Draw each room
once and link it to a Home Assistant area. After that, every device assigned to the area appears
in the room by itself, placed by type: lights on the ceiling, door sensors by the door, other
sensors on the walls. Drag any of them to its exact spot. Also shows a robot mower's live
position over its map.

![3D view](docs/images/view-3d.png)

- Floors from Home Assistant, a chip per floor plus "All", 3D and north-up top view
- Tap toggles lights, switches, fans and input booleans; other devices (and long-press) open
  the more-info dialog
- Lights that are on cast a glow on the floor in their colour and brightness
- Markers show a value next to the icon (temperature, power, …)
- Edit mode for admins: draw rooms, doors, floors, pin and hide devices, import/export
- One layout shared by every user and device (stored by the companion integration)
- Robot mower: live position, trail, map image or camera overlay, point calibration
- Optional 3D model of the house (.glb) under the plan: floors stack (upper floors hidden, lower ones shown), with a Day / Night button for lighting
- Follows the HA theme, light and dark

## Install

The repository is a Home Assistant integration that also serves the card, so one install
covers both. The integration stores the layout and makes it available to all users.

### HACS

1. HACS → ⋮ → Custom repositories → add `https://github.com/istals/floorplan3d-card`,
   type **Integration**.
2. Search for **Floorplan 3D** in HACS and download it.
3. Restart Home Assistant.
4. Settings → Devices & services → **Add integration** → **Floorplan 3D** → Submit.
5. Reload the browser.

### Manual

1. Download `floorplan3d.zip` from the [latest release](https://github.com/istals/floorplan3d-card/releases)
   and extract it to `/config/custom_components/floorplan3d/`
   (or build it yourself: `npm ci && npm run build`, then copy `custom_components/floorplan3d/`).
2. Restart, then Settings → Devices & services → Add integration → **Floorplan 3D**.

`floorplan3d:` in `configuration.yaml` also works; it is imported as the integration entry.

The card is loaded on every dashboard automatically; you do not need to add a resource.
If you only want the card without the integration, add `floorplan3d-card.js` from the release
as a dashboard resource (Settings → Dashboards → ⋮ → Resources, type JavaScript module). The
layout is then stored per user, or per browser on old HA versions; the Data tab says which.

## Add the card

Dashboard → Edit → Add card → search **Floorplan 3D** (or Manual: `type: custom:floorplan3d-card`).
The options below can be set in the visual editor or in YAML.

| Option | Default | |
|---|---|---|
| `layout_key` | `default` | Name of the stored layout. Use different keys for different plans. |
| `height` | `520px` | Card height. |
| `group_by` | `device` | `device`: one marker per device. `entity`: one per entity. |
| `wall_height` | `1.0` | Height of the cut-away walls in metres. |
| `view` | `3d` | Start in `3d` or `top` view. |
| `floor` | first floor with rooms | Floor id to show first, or `all`. |
| `model` | | URL of a `.glb` model, e.g. `/local/house.glb`. |
| `model_position` | `[0, 0, 0]` | Model offset in plan metres `[east, north, up]`. |
| `model_rotation` | `0` | Model rotation in degrees, counter-clockwise. |
| `model_scale` | `1` | Model scale (e.g. `0.01` for a centimetre model). |
| `model_opacity` | `1` | Model opacity, `0`–`1`. |
| `model_floors` | auto | Which HA floor shows each model storey group, e.g. `{ground: floor1, attic: always}` (`always` / `hidden` allowed). |

## Set up the plan

Click **Edit** on the card (admins only). The panel has five tabs.

![Edit mode](docs/images/edit-rooms.png)

**Rooms.** Every HA area is listed as *drawn* or *missing*. Click **Draw** and click the
corners of the room on the plan. Points snap to 5 cm, to existing corners within 25 cm (so
neighbouring rooms share walls exactly), and line up with nearby corners. Click the first point
or press Enter to finish, Backspace removes the last point, Esc cancels.
Select a room (click it, or **Select** in the list) to:
- drag its corners, drag an edge's middle handle to add a corner, right-click a corner to delete it
- **Add door**, then click on a wall
- change its area or floor, mark it **Outdoor** (terrace, garden: no walls), delete it

Floors come from HA (Settings → Areas → Floors) with elevation = level × 3 m. Adjust elevation
and ceiling height per floor at the bottom of the Rooms tab.

**Devices.** Every device with an area appears in that area's room. Drag a marker to pin it; set
its height above the floor; **Return to auto placement** removes the pin; **Hide** removes it
from the plan. Devices whose area has no room yet, and hidden devices, are listed here.

**Mower.** See below.

**Model.** Upload or replace a 3D model of the house (.glb, up to 100 MB; needs the
integration, see below) and line it up with the plan using the sliders (east, north, up,
rotation, opacity) and scale. For a tagged model the tab lists its levels and rooms/zones:
assign each level to an HA floor (or *always shown*, *only in All*, *hidden*) and each room
or zone to an HA area. Defaults follow level order and the tag's suggested area. Click a part
of the model in the view to find it in the lists. A report shows errors and warnings found
in the model's tags, and a "no longer in the model" list shows assignments whose level or
room was removed by a re-export, with **Forget** to drop them. See
[docs/model-builder-guide.md](docs/model-builder-guide.md).

**Data.** Export and import the layout as JSON, and see where it is stored. *Shared* means the
integration is active and everyone sees the same plan.

Coordinates are metres, x = east, y = north. A layout prepared elsewhere (for example from an
existing house model) can be imported here; see [docs/house-model-spec.md](docs/house-model-spec.md)
for the format.

## Robot mower

Works with any entity that reports a position:
- **GPS**: `latitude` / `longitude` attributes (device trackers), or a `"lat,lon"` state
- **x / y**: map coordinates in two attributes, names configurable

For the Sunseeker integration ([Sdahl1234/Sunseeker-lawn-mower](https://github.com/Sdahl1234/Sunseeker-lawn-mower)),
pick the mower position entity with source GPS and the *Map* image entity (or *Live map* camera)
as overlay. Check the attribute names in Developer tools → States first.

In the **Mower** tab:
1. Pick the position entity, the source and the floor (usually the ground floor).
2. Calibrate: drive or carry the mower to a spot you can find on the plan (a corner of the lawn,
   the charging station), click **Add point**, then click that spot on the plan. One point aligns
   a GPS track north-up, two points also fix rotation and scale, three or more also correct skew.
   Spread the points far apart. The fit error is shown for 3+ points.
3. Overlay: pick the image or camera entity, then line it up with the sliders or
   **Move with mouse**. Cameras refresh every N seconds; images when they change.

The mower's own marker follows the live position and draws a trail for the current session.

## 3D model underlay

![Model](docs/images/model.png)

Upload it on the card: **Edit → Model → Upload .glb**, then align it with the sliders. The file
is stored in `/config/floorplan3d/models/` and only served to logged-in users.

Alternatively put a `.glb` in `/config/www/` and set `model: /local/house.glb` in the card
(files in `www` are readable without login). A YAML `model` takes precedence over an upload.

Tag the model's parts (levels, rooms, zones, objects) so the card can use them: top-level
levels become floors, tagged rooms and zones become the card's rooms, so the model's outlines
replace hand-drawn ones. Format and examples: [docs/model-builder-guide.md](docs/model-builder-guide.md).
Untagged models still load and show whole.

In **Edit → Model** you assign each level to an HA floor (or *always shown*, *only in All*,
*hidden*) and each room to an HA area. Defaults follow level order and the tag's suggested
area, so most of it is automatic; your choices are stored by id and survive re-exports.
Click a part of the model in the view to find it in the lists. Everything is cut at the
selected floor's `wall_height`. Check a model before uploading with
`npm run check-model -- house.glb`.

To export an existing Three.js design: add `window.scene = scene;` to its code, open it in the
browser, paste [tools/export-glb.js](tools/export-glb.js) into the developer console. It drops
lights and helpers, prints size and origin, and downloads `house.glb`.

## Development

```sh
npm ci
npm run demo          # http://localhost:8765/demo/  (mock HA, add ?model=1 for the 3D model)
npm test              # unit tests (vitest)
npm run lint
npm run check         # build + headless Chrome checks of view, edit mode and model
python -m pytest      # integration tests (pip install -r requirements-test.txt first)
npm run deploy        # build and scp the integration to HA (settings in .env, see .env.example)
```

Releases: bump the version in `package.json`, `custom_components/floorplan3d/manifest.json` and
`src/floorplan3d-card.js`, then push a `vX.Y.Z` tag. GitHub Actions builds `floorplan3d.zip`
(the integration with the card inside) for HACS.

Layout: `src/placement.js` (auto placement), `src/registry.js` (HA registries to markers),
`src/layout.js` (floors, walls, positions), `src/view.js` (Three.js), `src/editor.js` (edit
operations), `src/edit-mode.js` (panel and plan interactions), `src/mower.js` (mower math),
`src/storage.js` (layout storage), `custom_components/floorplan3d/` (integration).

## Troubleshooting

- **Card not found** after install: restart HA, then reload the browser (clear cache on mobile app).
- **Data tab says per-user or browser storage**: the Floorplan 3D integration is not added
  (Settings → Devices & services), or HA has not been restarted since installing it.
- **No Edit button**: only admins can edit.
- **A device is missing**: give it an area and draw that area's room, or check *Devices → Hidden*.
  Diagnostic and configuration entities are never shown.
- **Mower not on the plan**: GPS sources need at least one calibration point; the Mower tab shows
  the current reading.
