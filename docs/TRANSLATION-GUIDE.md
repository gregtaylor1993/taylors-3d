# Card languages

Home Assistant's selected language chooses the card's words. The bundled languages
are English, German, French and Spanish. Other languages use English. This changes
labels only; it does not rename your rooms, devices, entities, model objects or files.

The local combined candidate translates the card's common controls, visual
settings, layout editor, dashboard-backup steps, device and object panels,
current-reference reports and feature-editor guidance. These include cameras,
security, tracking and calibration, weather, House settings, scenes, idle mode,
walls, floor presentation, furniture, model shading and overlays. Messages written
by Taylor's 3D use identified translation keys. Your names, IDs and readings stay
as supplied; errors returned by another system remain literal so their original
meaning is retained. A feature being listed here does not certify every possible
external error or Home Assistant-provided control. The integration's separate
settings screens have their own translation files under
`custom_components/taylors3d/translations/`.
The integration setup and camera-preset action now also have English, German,
French and Spanish files. A local check exercised Home Assistant's installed
translation loader with all four. That checks the text files; it does not prove
that the complete integration starts or that a real panel receives an action.

## What the code means

A **translation key** is a stable name for a sentence. For example,
`marker.openControls` means “Open {name} controls”. The English dictionary supplies
the sentence; the other dictionaries supply their versions. `{name}` is a place
for the user's actual name. It stays literal, even when it contains punctuation.

`src/localization.js` finds the sentence. The common dictionaries live in
`src/translations/en.js`, `de.js`, `fr.js` and `es.js`. Card setup messages live in
`card-settings.js`; the explicitly identified advanced captions live in
`advanced-settings.js`. Small feature dictionaries include `mower-options.js`,
`tracking-calibration.js`, `device-controls.js`, `room-actions-editor.js`,
`entity-area-filter.js`, `dashboard-backup-references.js`, `saved-ha-references.js`
and `status-overlays.js`. Weather and House editor messages live in
`editor-environment-house.js`; normal camera and scene controls use
`live-camera-scenes.js`. The remaining layout-editor captions use `editor-core.js`,
`editor-runtime-details.js` and `editor-presentation-scenes.js`. Backup steps use
`dashboard-backup-wizard.js`; object controls use `object-popup.js`; calibration
details use `tracking-calibration-details.js`. Furniture messages and card runtime
notices have their own dictionaries in `furniture-runtime.js` and
`runtime-notices.js`.

When adding a feature, give its visible words a key and keep a readable English
fallback. Keep keys equal across the languages you supply. Insert translated text
with `textContent`, or escape it when building an HTML template. Never translate
entity IDs, saved option values, URLs, user text or an imported raw configuration.
Those are data that the rest of the program needs to identify exactly.

## Why the controls keep their places

A focused field contains a draft that may not have been saved yet. Changing its
caption should preserve the field itself. Replacing the whole editor could lose
typed text or confuse a button press already in progress. The card therefore
updates owned captions in place and keeps real data and actions separate.

Language changes are presentation changes. A real device being removed is a
different event: its old controls must be closed or disabled. Tests exercise both
paths so that translating the interface does not revive an old device action.

## Checking a change

Run `npm test -- --maxWorkers=1` for the code tests and `npm run lint` for common
code mistakes. After `npm run build`, `npm run check:localization` opens the real
source and built card in a test browser with explicitly simulated Home Assistant
data. It checks labels, keyboard actions, focused fields and a narrow phone layout.
The test computer needs Chrome or a configured `CHROME_PATH`.

`npm run check:area-filter` checks the four area-filtered editors in the actual
source and built card. It first checks that both distributed bundles match the
source. A missing or stale file fails before the browser opens.

`npm run check:runtime-localization` separately checks the actual model-object
popup and nested tracking calibration with simulated Home Assistant data. It
checks language changes while fields are focused and distinguishes a new valid
interaction from an interrupted older one. These browser scripts are prepared
for this local candidate; use the feature log for their latest recorded result.

That simulated browser check does not prove Home Assistant has saved your dashboard.
Verify that separately in your actual installation, using your own rooms and devices.
