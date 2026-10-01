# Model builder guide (floorplan3d-card)

Instructions for whoever builds the house model. Hand this whole file to the model builder
session. The model describes **what exists**; Home Assistant decides **what it is connected to**
(floors, areas, entities, actions). Do not put Home Assistant ids in the model unless asked:
suggestions are fine, the user assigns everything in the card and re-exports never break that.

Full design: [specs/2026-10-01-model-contract-design.md](superpowers/specs/2026-10-01-model-contract-design.md).

## Deliverable

One file: **`house.glb`** (binary glTF 2.0), under ~20 MB. No separate layout JSON is needed:
room outlines live inside the model.

## Coordinates

- Metres. glTF Y is up.
- Plan axes: **x = east, y = north**; in the glTF scene plan point (x, y) at height h is
  **(x, h, -y)**. "North" may be the house's own axis; the real compass angle is set in the card.
- Origin (0, 0, 0): south-west outer corner of the house, at ground floor finished floor level.

## Tagging: `fp` on nodes

Tag nodes with a small JSON object in glTF node `extras.fp`.
In Three.js set `node.userData.fp = { … }` before exporting: `GLTFExporter` writes `userData`
into `extras` automatically. (Blender: custom properties on the object, "Include custom
properties" in the glTF exporter.)

Every tag has:
- `kind`: `level` | `room` | `zone` | `object`
- `id`: lowercase `a-z 0-9 _ -`, max 64, **unique per kind and stable forever**. The card binds
  everything to ids. When you re-export, a lamp that moved keeps its id. Never give an old id to
  a different thing; for a new thing use a new id.
- `label` (optional): human name.

If your tool cannot write extras, name the node `fp:<kind>:<id>` (levels, rooms, zones) or
`fp:<type>:<id>` (objects), for example `fp:level:ground`, `fp:light:terrace_ceiling_1`.

## Structure

```
scene
├─ basement        fp {kind: level, id: basement, role: basement, order: -1, elevation: -2.6, height: 2.4}
│   ├─ storage     fp {kind: room, id: storage, outline: [...]}
│   └─ …
├─ ground          fp {kind: level, id: ground, role: storey, order: 0, elevation: 0, height: 2.89}
│   ├─ kitchen     fp {kind: room, id: kitchen, outline: [...], doors: [...]}
│   │   ├─ floor slab, cabinets …            (scenery)
│   │   └─ ceiling_light_1   fp {kind: object, type: light, id: kitchen_ceiling_1, …}
│   ├─ living_room …
│   ├─ walls, windows, stairs                 (scenery of the level)
│   └─ front_door  fp {kind: object, type: door, id: front_door, …}
├─ first           fp {kind: level, id: first, role: storey, order: 1, elevation: 3.25, height: 2.5}
├─ attic           fp {kind: level, id: attic, role: storey, order: 2, …}
├─ exterior        fp {kind: level, id: exterior, role: exterior}
│   ├─ terrace     fp {kind: zone, id: terrace, outline: [...]}
│   │   ├─ terrace_ceiling_1  fp {kind: object, type: light, …}
│   │   └─ terrace_ground_1   fp {kind: object, type: light, hints: {beam: up}}
│   ├─ garden      fp {kind: zone, id: garden, outline: [...]}
│   │   ├─ charging_station   fp {kind: object, type: dock, id: mower_dock}
│   │   └─ mower              fp {kind: object, type: mower, id: mower}
│   ├─ driveway    fp {kind: zone, id: driveway, outline: [...]}
│   ├─ gate        fp {kind: object, type: gate, id: driveway_gate, hints: {...}}
│   ├─ facade_lamp_1 … fp {kind: object, type: light, id: facade_1, hints: {beam: down}}
│   └─ fence, lawn, road, terrain              (scenery)
└─ roof            fp {kind: level, id: roof, role: roof}
```

Rules:
1. **Levels are top-level** (or children of one wrapper node). Every other node is inside
   exactly one level.
2. **One level per storey**, including basements. Fill `order` bottom-up (basement -1, ground 0,
   first 1 …), `elevation` (top of that storey's floor slab) and `height` (clear ceiling height).
3. **Exterior is its own level** (`role: exterior`): garden, terrace, drive, fence, lawn, road,
   outdoor lamps, gate, charging station, mower. The user chooses in the card whether it shows
   with the ground floor, always, on its own HA floor, or not at all.
4. **Roof is its own level** (`role: roof`). The card hides it while a single floor is shown.
5. **Rooms (indoor) and zones (outdoor) are groups** inside their level, holding their own floor
   slab and furniture. Give each an `outline`: the inner floor polygon in plan metres
   `[[x, y], …]`, corners in order, no repeated closing point; neighbouring rooms share exact
   corner coordinates. Optional `doors`: points on the outline at the middle of each opening.
   One room per real room; a stair hall is a room too.
6. **Nothing larger than the plot inside a storey level.** World ground planes, roads and
   terrain go in `exterior` (or leave a world ground plane out entirely; the card has its own
   background).
7. Walls, windows, stairs, slabs can be untagged scenery of their level.
8. Walls stay at full storey height; each storey's ceiling/slab belongs to the storey above, so hiding the upper level opens the view into the rooms.
9. No lights, cameras, helpers, grids or text in the export. Lamps are objects (below), not
   three.js lights.

## Objects

Tag anything that should react to Home Assistant or be controllable:

```json
{ "kind": "object", "id": "terrace_ceiling_1", "type": "light",
  "label": "Terrace ceiling lamp 1",
  "group": "terrace_lights",
  "glow": "lamp_glass",
  "anchor": [0, -0.05, 0],
  "hints": { "beam": "down", "range": 4 },
  "suggest": { "domain": "light", "area": "terrace" },
  "ui": { "tap": { "action": "toggle" }, "hold": { "action": "popup" },
          "popup": ["toggle", "brightness", "color"] } }
```

- `type`: one of the types below. Unknown types still work as `generic`.
- `glow`: name of the child mesh that should light up or change colour (the bulb, glass, LED);
  give that mesh its own material. Without `glow` the whole object is used.
- `anchor`: local point where the light comes from / the label and popup attach (default: centre).
- `group`: lamps of one circuit (all facade lamps) share a group. In Home Assistant the group
  gets its main switch and each lamp can additionally get its own controller; a lamp is lit only
  when every controller in its chain is on (main AND its own). You only set the group name; the
  wiring is done in the card, so rewiring never needs a re-export.
- `suggest`: optional hints for automatic binding: `domain`, `area`, or an exact `entity` if you
  know it. The user can change all of it.
- `ui`: optional default controls (see Actions). The user can change all of it.
- Model each object at its real place and size, pivot at the natural centre (doors and gates:
  see `hinge`). Keep the moving part as its own node (door leaf, gate wing, blind slat pack).

### Types and hints

| type | use for | hints |
|---|---|---|
| `light` | any lamp or bulb, RGB or white | `beam`: point (default) / spot / up / down; `range` m; `angle` deg (spot) |
| `light_strip` | LED strips, light coves | — |
| `mower` | robot lawn mower body | `front`: +x / -x / +z / -z (which local axis is the nose) |
| `vacuum` | robot vacuum | `front` |
| `dock` | mower / vacuum charging station | `led`: name of the LED mesh |
| `ev_charger` | car charger | — |
| `door` | doors | `opens`: swing / slide; `hinge`: [x, y, z] local hinge point; `axis`: y; `travel`: degrees (swing) or metres (slide) |
| `window` | windows | `opens`: swing / tilt / slide; `hinge`; `axis`; `travel` |
| `gate` | gates | `opens`: swing / slide; `hinge`; `travel` |
| `garage_door` | garage doors | `opens`: roll / tilt / slide; `travel` m |
| `cover` | blinds, shutters, awnings | `direction`: down / up / out; `travel` m |
| `fan` | fans, hoods | `axis`: local spin axis |
| `climate` | radiators, AC units, heat pumps | — |
| `screen` | TV, monitors (the screen surface is `glow`) | — |
| `sprinkler` | irrigation heads | `direction`, `reach` m |
| `camera` | security cameras | `fov` deg, `range` m |
| `display` | a spot that shows a value (thermometer, meter) | `format`, e.g. `"{state} {unit}"` |
| `generic` | anything else | — |

New types are added in the card over time; using a type the card doesn't know yet is fine, it
behaves as `generic` until the type exists.

### Actions (optional `ui`)

Same shapes as Home Assistant dashboard actions:
- `{ "action": "toggle" }`
- `{ "action": "more-info" }`
- `{ "action": "popup" }`: the card's popup next to the object
- `{ "action": "perform-action", "perform_action": "light.turn_on", "data": { "brightness_pct": 100 } }`
- `{ "action": "navigate", "navigation_path": "/lovelace/garden" }`
- `{ "action": "none" }`

Popup rows: `toggle`, `brightness`, `color`, `color_temp`, `speed`, `cover_controls`,
`mower_controls`, `vacuum_controls`, `battery`, `state`, `attributes`, `attribute:<name>`.

## Re-exporting

- Keep every `id`. Moving, resizing or remodelling an object is fine.
- New object: new id. It appears in the card as unassigned.
- Removed object: its assignment is kept in the card in case the id comes back.
- Do not rename levels or rooms casually; if you must, tell the user (they reassign once).

## Checklist before handing over

- [ ] One `.glb`, metres, Y up, origin at the south-west house corner, north = -Z.
- [ ] Top-level levels only: storeys (with `order`, `elevation`, `height`), `exterior`, `roof`.
- [ ] Every room and outdoor zone tagged, with `outline` (and `doors`).
- [ ] Every lamp, the charging station, mower, gate, garage door, blinds … tagged as objects with
      stable ids, glow mesh named where it matters, moving parts as separate nodes with `hinge`.
- [ ] No mesh larger than the plot inside a storey; no world ground plane in storeys.
- [ ] No lights / cameras / helpers in the export. Under ~20 MB, textures ≤ 2048 px.
- [ ] `node tools/check-model.mjs house.glb` reports OK (run it in the floorplan3d-card repository).

## Example (Three.js)

```js
const ground = new THREE.Group();
ground.name = 'ground';
ground.userData.fp = { kind: 'level', id: 'ground', role: 'storey', order: 0, elevation: 0, height: 2.89 };

const kitchen = new THREE.Group();
kitchen.name = 'kitchen';
kitchen.userData.fp = { kind: 'room', id: 'kitchen', label: 'Kitchen',
  outline: [[7.47, 0.42], [10.12, 0.42], [10.12, 4.17], [7.47, 4.17]], doors: [[7.47, 2.295]],
  suggest: { area: 'kitchen' } };
ground.add(kitchen);

const lamp = buildCeilingLamp();              // a Group with a child mesh named "lamp_glass"
lamp.name = 'kitchen_ceiling_1';
lamp.position.set(8.8, 2.85, -2.3);           // plan (8.8, 2.3) at 2.85 m
lamp.userData.fp = { kind: 'object', id: 'kitchen_ceiling_1', type: 'light', glow: 'lamp_glass',
  hints: { beam: 'down', range: 4 }, suggest: { domain: 'light', area: 'kitchen' } };
kitchen.add(lamp);

const exterior = new THREE.Group();
exterior.name = 'exterior';
exterior.userData.fp = { kind: 'level', id: 'exterior', role: 'exterior' };
const dock = buildDock();
dock.userData.fp = { kind: 'object', id: 'mower_dock', type: 'dock', hints: { led: 'dock_led' },
  suggest: { domain: 'lawn_mower' } };
exterior.add(dock);
```
