# Zotero paths are Device Overrides, not synced settings

The Zotero profile directory and data directory are absolute machine-specific paths, yet they lived in the synced plugin settings, so vault sync propagated one machine's paths onto every other device. We store them exclusively per device — per vault × device via Obsidian's vault-scoped localStorage — where an unset value means auto-detect and a set value is a **Device Override** of automatic Zotero detection. `ZoteroPrefService` (the sole resolver of the Zotero location) owns these two values: it loads, persists, and re-resolves from them, and exposes getters/setters that the setting tabs and the Welcome View locate action call directly. The two keys are removed from the settings schema entirely — they are not settings.

## Considered Options

- **Layered override** (synced base value, per-device override wins): rejected. It adds a third per-device state ("inherit" vs "explicitly auto-detect" vs explicit path), a two-layer settings UI, and keeps one machine's paths in synced data where they are stale on every other machine — while auto-detection already serves as the shared default a base layer would provide.
- **Keep the keys in the settings schema, route their persistence to device storage** (rejected): the settings service would carry a synced/device partition, a snapshot merge, and a move-and-strip migration that adopts any stale synced value into local storage — real complexity added to the settings service for two values that are not settings. Consumers stay unmodified, but the two paths' true owner (`ZoteroPrefService`) still had to read them back out of settings.
- **Standalone per-device store owned by `ZoteroPrefService`, no migration** (chosen): the paths leave the settings schema; `ZoteroPrefService` owns their storage and drops its settings dependency. Shipping in the 2.0.0 beta (greenfield), there is no production data to migrate, so no migration is written.

## Consequences

- The settings service stays purely about synced settings — no device partition, no `app`/localStorage dependency.
- `ZoteroPrefService` gains the vault-scoped `app` (localStorage) dependency and drops its `settings` dependency, which it only ever used to read these two keys.
- A beta tester who had set a custom Zotero path before this change re-selects it once after updating (its old synced value is ignored). The fresh-device notice guides that: when the resolved database file is absent, the database layer emits a `db-file-missing` signal that a Welcome-View subscriber renders as a notice whose action opens the Welcome View's locate step.
- Reversing to synced storage would require reintroducing the two keys to the schema; the per-device values do not sync.
- Zotero connection health is a per-device condition, so the fresh-device condition is detected and signalled by the database layer — not the synced-state-driven release service — while a Welcome-View subscriber renders the notice.

Store a sparse record in Obsidian's vault-local storage on each device.
Null selects auto-detection, and clearing both paths removes the record.
The desktop folder picker seeds its initial path and passes the selected
directory to the row. The row explains that the value stays on this device.
[Path storage](../../packages/plugin-services/src/obsidian/zotero-pref/device-paths.ts) · [Folder picker](../../packages/plugin-services/src/desktop/setting-tab/device-override.ts)

## Profile discovery and preference lifetime

The desktop host reads `prefs.js` at startup and after a profile override
changes. The startup bound covers external reads, including the Linux
directory lookup. Consumers see the settled profile when it loads within
that bound. After the bound, consumers can start with fallback paths and
receive the completed read later. An unreadable profile publishes degraded
state with empty preferences. Only the current read can publish a result.
Closing the service cancels its reads and ends the state stream, while a
consumer that still holds the service can read its last snapshot. Closing
the settings row cancels its profile-list read.

Persist and publish a Device Override as one uninterruptible operation.
A profile change also starts a preference reload. A data directory change
publishes a new resolved path without rereading the profile. Resolve the
data directory from the override, the enabled profile preference, or
the user's `Zotero` directory in that order. Use the profile and data
directory file URLs to derive the same source identity as the Companion.
Read `extensions.json` afresh for each Companion installation check so a new
installation is visible. A missing or malformed list reports no active
Companion. [Preference layer](../../packages/plugin-services/src/desktop/zotero-pref/layer.ts)

Use the platform's Gecko layout to locate `profiles.ini`. Electron supplies
the application-data base. Use both vendor and application names on
Windows, and only the application name on macOS. On Linux, use lowercase
names and give an existing legacy directory priority. Determine whether
that directory exists through asynchronous filesystem I/O.
[Gecko directory provider](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_1_0esr_RELEASE/toolkit/xre/nsXREDirProvider.cpp)

Read INI sections with a `Path` in file order and use the first one marked
`Default=1`, or the last profile when none is marked. This skips the
trailing `[General]` section Zotero writes. Resolve relative paths against
the profiles root. Read only well-formed `user_pref` entries with a string,
number, or boolean value. Use Zotero's default HTTP port for missing or
invalid settings. A value of `-1` selects automatic allocation, whose
runtime port is absent from the profile.
[Zotero profile selection](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/profile.js#L45-L70)

## Location settings rows

Show the automatic choice first and the folder dialog last. Use a value
outside the set of real paths for each choice. Restore the selected
value before opening the dialog and update the override only after a
folder is selected. If a chosen profile does not appear in `profiles.ini`,
add its path as an option. Show the effective `prefs.js` and data directory
paths, including when auto-detection supplies them.

A queued profile read can finish before the renderer handles it. Observe
changes to the preferences and read the current service snapshot when the
row handles each change, so a newer override remains selected. The test
queues the completed read for one profile and then selects another before
the row paints. Observe both preference reads and data directory overrides
when displaying resolved paths. Place the Companion's live-update rows
directly after the setup row.
[Location settings](../../packages/plugin-services/src/desktop/database/settings-rows.ts)
