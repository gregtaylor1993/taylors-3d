# Home Assistant rooms, devices and readings

Taylor's 3D uses the names and connections you set up in Home Assistant.
A **floor** is a building level, an **area** is a room, a **device** groups
physical equipment, and an **entity** is one reading or control belonging to it.
For example, one thermostat device can have temperature and battery entities.

## Choosing an entity

The Objects, Mower and Overlays tabs, room shortcuts, Scenes, Environment and
House settings can filter suggestions by area. **All areas**
shows the eligible choices; **Unassigned** means the entity has no area of its
own and does not inherit one from its device. Changing this filter only changes
the list you see. It does not move a device or change a saved connection.

Suggestions use Home Assistant's current names. Hidden, disabled and diagnostic
entities are excluded from ordinary suggestions. The editor also respects a
disabled device and, where appropriate, the entity's type and current reading.
A camera is not offered as a temperature sensor, for example.

An already saved missing or filtered entity stays visible as a warning. Its ID
and any extra saved settings remain in your layout until you choose a
replacement or remove it. This protects your work when you temporarily disable
an integration or rename its entities. Check warnings before relying on a
combined temperature or power reading: preserving a source does not prove it
is suitable for your current setup.

These warnings follow your Home Assistant language. The app translates words
such as “Missing entity”, but keeps your device name and its exact entity ID.
An ID is the saved address of a reading; changing its display name does not
automatically change that address or reconnect an old link.

## Fixing a missing floor

A room, pin or mower with an explicit floor link does not silently move to
Ground when that floor disappears. The saved link stays intact and its
unresolvable position is kept out of the drawing.

Open **Edit → Rooms**, select the saved outline and deliberately choose the
replacement floor. Every saved outline remains selectable even if its Home
Assistant area also has a room in the uploaded model. Its outline is retained.
For a mower, use **Edit → Mower → Floor**. A missing mower floor stops its
position, trail and map overlay until you repair the connection.

In **Edit → Views**, a missing saved floor remains a checked warning choice.
Changing another floor preserves it. Uncheck the missing choice to remove it
deliberately; Undo can restore that edit.

## Reading values and testing controls

Individual values use Home Assistant's reported display precision and number
format. A sensor requesting one decimal place can show `19.9 °C` instead of
`19.87654 °C`. An **Aggregate preview** is a separate calculated value: it
combines the selected readings, converts their units and rounds the result.
The editor explains that distinction and warns about missing saved sources.

Opening an editor, changing a list filter or reading a popup sends no device
command. **Objects → Test** is a deliberate real device action. It checks the
current connection, entity, visibility and available service immediately before
calling Home Assistant. A missing, disabled, hidden, diagnostic or unavailable
binding cannot be tested through an old queued button.

Ordinary sensor updates refresh the reading without replacing the input you
are currently typing into. Your Home Assistant installation, model and wall
panel still need their own practical checks; simulated tests cannot confirm
your household's entity names or geometry.
