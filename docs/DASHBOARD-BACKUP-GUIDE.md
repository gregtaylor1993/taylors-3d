# Back up or copy a complete dashboard

This workflow is in the local combined test candidate. It is not yet in the
published HACS download. Linux Home Assistant compatibility and your own
installation still need checking before release.

A dashboard is the whole Home Assistant page, including its views and other
cards. A Taylor layout is the saved rooms, device links and visual settings for
one Taylor card. **Single-layout JSON** backs up that layout only. **Full
dashboard backup** also includes the selected dashboard, the Taylor layouts it
references, available uploaded house models and original licensed furniture packs.

Open the card's **Edit → Data** screen with an administrator account. Opening
this screen does not copy files or create a dashboard.

## Make a backup

1. Press **Refresh dashboard list**, then choose the dashboard. The default
   option means Home Assistant's actual default dashboard.
2. Press **Read whole dashboard** to examine its saved configuration. The preview
   is text; it does not run the other cards.
3. Press **Create full dashboard ZIP**. This reads the latest saved dashboard
   again, so the export uses its current contents.
4. Review any missing items, then press **Download ZIP**. Keep this ZIP somewhere
   you can find it later.

Shared layouts are preferred. If the setup uses account-only or browser-only
layouts, deliberately select the matching inclusion box. The browser option
reads only exact Taylor keys referenced by the chosen dashboard. It cannot read
another browser's saved layout.

External card resources and external model URLs are recorded as dependencies;
their remote files are not downloaded. A backup marked incomplete stays clearly
labelled. Approving an incomplete download does not repair missing files or a
missing layout.

## Restore as a separate new dashboard

1. Choose your **Backup ZIP** and press **Inspect ZIP**. This checks the archive
   and shows its contents without copying files or creating a dashboard.
2. Review the archive details and the separate **Current Home Assistant** report.
   Enter a new copy name using lowercase letters, numbers and hyphens, then tick
   the review box.
3. Press **Prepare copy**. This copies available assets and prepares new Taylor
   layout keys. It has not created a dashboard. Layout saves may still be waiting
   to reach disk.
4. Press **Create new dashboard**. This deliberately creates a new Home Assistant
   dashboard and saves the prepared configuration there.
5. Open the new dashboard, install any declared external cards separately, and
   check its rooms, devices, models and furniture before relying on it.

The copy gets new dashboard and layout identities. Your original entity IDs,
area IDs, names and other-card settings are retained. The workflow does not
rename your actual Home Assistant devices or overwrite an existing dashboard.

**Archive completeness** means the backed-up files and layouts are present. It
does not mean your current Home Assistant has the same devices. The separate
report shows missing known entity, area and floor IDs, unavailable readings, and
registries that have not loaded yet. Custom settings that the checker does not
understand are marked uninspected. A saved plan floor can also belong only to the
layout; it is not automatically a Home Assistant floor.

The checker follows each card's effective shared settings. An old card setting
that a shared layout overrides is retained in the backup, but is not reported
as a dependency the active card needs. Standalone archived layouts are checked
as saved data too. The report cannot inspect arbitrary third-party card code.

The report updates when current Home Assistant information changes, without
discarding your selected file, copy name or review choice. It never chooses new
device IDs for you. Repair any missing links deliberately in the copied layout.

If a connection fails while copying or creating, some new files or a dashboard
may already exist. The screen reports what needs review; it does not retry or
delete those items automatically. **Cancel and clear** clears the screen, not
files already copied. Review the reported new address before making another copy.

Changes to the account, permissions, card source or connection cancel unfinished
actions. Reopen Data and read or inspect the backup again with the current account.
