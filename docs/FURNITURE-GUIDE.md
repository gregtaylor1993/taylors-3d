# Furniture in Taylor's 3D

This guide describes furniture in the combined local `0.2.0` test candidate.
It has not replaced the verified Phase 12 manual installation package or the
published HACS `v0.1.0` release. See [Requirements and features](../REQUIREMENTS_AND_FEATURES.md)
for the verified package and current check results.

Furniture comes from a local ZIP containing one or more static `.glb` models,
names, placement anchors and the author's licence files. The original ZIP is
kept so its models and credits can be downloaded together later. Furniture is
drawn separately from your house: placing a chair does not rewrite the house GLB.

## Add an item

1. Open the card's **Edit** controls and choose **Furniture**.
2. Select your local furniture ZIP and press **Import selected ZIP**.
3. Wait for the published library to refresh. Choose a **Pack**, **Item** and
   the exact **floor** where it belongs.
4. Press **Add selected item to draft**. The item starts at that floor's plan
   origin, `(0, 0)`. This is a known starting position, not a guessed room.
5. Set its position using the labelled fields, or drag the visible item in the
   house view. **Top** is often convenient for placing furniture on the floor.
6. Press **Save furniture** when satisfied, or **Cancel** to keep the saved layout.

X and Y are the saved plan coordinates in metres. Z is height above the chosen
floor. Rotation turns the item anticlockwise; scale changes its size uniformly.
These are the card's plan axes. Their compass direction depends on how your
house model was aligned. Declaring metre units does not measure an author's GLB
or prove that a downloaded chair is physically the right size.

Moving an item previews a draft. It does not save on every pointer movement.
Save creates one ordinary **Undo** step; **Redo** reapplies it. Leaving the
Furniture tab or replacing its model/layout clears the temporary preview.

## Floors, visibility and connections

Each item belongs to one explicit floor. Hidden floors do not show or select their
items. A Section cut uses the same renderer's clipping plane. Edit mode uses the
assembled house coordinates; your saved horizontal or vertical floor display
returns after editing. Furniture follows the display separation without changing
its saved position.

An unavailable pack, item, hash or floor is kept in the saved data and labelled
for repair. The card does not silently substitute another chair or floor.
Use **Repair or relink selected instance** to make a deliberate correction.
**Refresh library** retries a failed catalogue read; normal sensor updates do
not repeatedly import or download packs.

Imports require the current connected administrator and a clean draft. Ordinary
connected viewers can load the saved items. If the account, connection, source
or layout changes during an action, its old result is discarded. A ZIP import
may already have reached the server before a connection is lost; refreshing the
library shows what was actually stored.

## Keep the models and credits together

Open **Published packs and licences**, then choose **Download original licensed
ZIP**. The download contains the original pack bytes, including its licence
files. **Single-layout JSON** stores placement references; it does not contain
pack ZIPs or model bytes. Keep the original licensed packs beside that layout
backup. In the combined candidate, [Full dashboard backup](DASHBOARD-BACKUP-GUIDE.md)
also includes the selected dashboard, its Taylor layouts, available uploaded
models and original licensed pack ZIPs. External card resources and model URLs
remain dependencies; their files are not downloaded. Review any missing items
before relying on the ZIP. This workflow is not in the installed releases named
above.

The first pack format supports embedded static GLBs. Animation, skinning,
external model/texture URLs, embedded lights/cameras and decoder-dependent
compression need additional support and are rejected. A model rejection explains
which part failed. Pack and rendering budgets keep resource use bounded, but
their maximum does not guarantee smooth performance on every wall panel.

## Pack format

If you have your own compatible GLB and its licence file, the included pack
maker can build the ZIP for you. From the project folder, run this in PowerShell:

```powershell
python .\tools\create-furniture-pack.py --glb ".\chair.glb" --license ".\LICENSE.txt" --output ".\my-chair.zip" --pack-id my-chair-pack --pack-name "My chair pack" --item-id chair --item-name Chair --author Taylor --license-id MIT --unit m
```

On macOS or Linux, use `python3 tools/create-furniture-pack.py` and forward
slashes in the file paths. Replace the example filenames, author and licence
with your actual details. `--unit m` declares that the model uses metres; the
tool does not resize it. An optional `--anchor X Y Z` sets its placement anchor.

The tool checks the model and completed ZIP before writing a new file. It keeps
the original model and licence bytes and refuses to overwrite an existing ZIP.
Choose a new output filename when making another version. If a write is
interrupted, check the new file before importing it; an incomplete ZIP is rejected.

The ZIP contains these files at its root, with relative portable paths:

```text
pack.json
LICENSE.txt
assets/chair.glb
```

An example `pack.json` for your own model is:

```json
{
  "version": 1,
  "id": "taylor-furniture",
  "name": "Taylor's furniture",
  "author": "Taylor",
  "license": { "id": "MIT", "file": "LICENSE.txt" },
  "items": [
    {
      "id": "chair",
      "name": "Chair",
      "file": "assets/chair.glb",
      "unit": "m",
      "anchor": [0, 0, 0]
    }
  ]
}
```

Use the actual author and licence of your model; this example does not grant a
licence to someone else's asset. The anchor is the point inside the GLB that
meets your saved placement position, usually the centre at floor level. Preserve
any separate item licences when items have different authors or terms.

## Check it on your own house

Add one small item first. Check its physical size, floor, position and visibility
in both 3D and Top, then try Save, Cancel, Undo, Redo and a dashboard reload.
Test the wall panel as well as the desktop. The automated fixture uses an
original simulated textured table and simulated HA transport; it cannot prove
your particular house model, permissions or hardware performance.
