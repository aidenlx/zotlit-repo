---
status: accepted
---

# The Obsidian host owns its settings migrations

The platform settings service reads a composed definition and the host's migration hooks. Keep the historical input shapes and migration order in the desktop Obsidian host so the platform can serve other hosts without importing their features. Type-check that the composed feature slices and the setting registry expose the same keys. Host-dependent paths can store null and resolve at the consumer, keeping machine-specific defaults out of synced settings. [Settings slices](0089-the-platform-services-are-one-layered-package-and-settings-are-slices.md)

## Versionless settings

Versionless settings came from the old feature defaults merged into one flat object. The migration translates recognized keys into dotted keys, and the settings service later validates each key. Non-record input yields no overrides. A value equal to the migration's default normally drops from the result. Preserve the Literature Note and Template folders even when they equal the old defaults, so users keep their existing vault layout.

The legacy log levels come from Log4js. Translate OFF to null so logging remains disabled. Drop MARK because the current logger has no equivalent. The legacy Eta trim tuple represents leading and trailing modes. Each mode can retain whitespace, trim one newline, or trim all adjacent whitespace. Split the tuple into two settings. Carry the template folder forward and leave embedded sources behind. The old embedded filename used the `it` vocabulary, while the new engine reads vault files using `zt`. The former image import modes `symlink` and `copy` both enable import in the new setting.

The historical defaults were INFO logging, the citation suggester on, citekeys hidden in its list, the `LiteratureNotes` folder, and the local server off at `127.0.0.1:9091`. Eta tag auto-pairing and trim were off. The database watcher was on. The default image excerpt folder was `ZtImgExcerpt`. These values describe the input format and can differ from the current feature defaults.

## Versioned transitions

| Transition | Data and behavior                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 to 2     | Stamp the language on legacy Managed Frontmatter. Convert the three frozen, byte-exact default JavaScript expressions to Liquid. Keep other expressions as JavaScript, even when only their whitespace or quoting differs. The normal validator still requires other fields such as the merge strategy. |
| 2 to 3     | Preserve Citation Key Links for users from before the separate setting. Append the ordinary managed citekey field when the stored field list has no citekey entry.                                                                                                                                      |
| 3 to 4     | Convert the Citation Key Links switch to the citekey editor setting. An absent key uses the old off default.                                                                                                                                                                                            |
| 4 to 5     | Drop the Citation Key Property after resolution moves to Zotero's native citation keys. The managed citekey template output remains available.                                                                                                                                                          |
| 5 to 6     | Carry stored Citekey Indexing into the Pandoc citation source switch.                                                                                                                                                                                                                                   |
| 6 to 7     | Carry the citekey editor setting into the Pandoc navigation switch.                                                                                                                                                                                                                                     |
| 7 to 8     | Widen navigation to all citation surfaces. Materialize the old on default for sparse records. Fresh installs use the later default.                                                                                                                                                                     |
| 8 to 9     | Retire the Default Library. Upgraded users get Selected Libraries with My Library and can widen the scope explicitly. Fresh installs use All Libraries.                                                                                                                                                 |
| 9 to 10    | Move old vault-global Literature Note and import bindings to the default Profile.                                                                                                                                                                                                                       |
| 10 to 11   | Move the stored annotation open choice to Reader settings. Hover is independent of citation settings. Annotation Citations remain a separate source that defaults off.                                                                                                                                  |

## Settings tests

Build fixtures over the real store and host migration list. Scope-owned fixtures borrow the test clock and logger. Plain callers own the managed runtime through the disposable fixture. Seed settings through the update path and write named Profile overrides through its binding API.

The load effect reads a current snapshot once hydration has finished, so a later run can observe edits. The migrator is synchronous and rejects non-plain results, including a Promise. A failed migration save leaves no pending write for flush to retry. Scope close waits for a pending write. Regression tests hold saves so they can exercise an edit from a closing view after unload starts and verify that a superseded save cannot overwrite the latest state.

## Hydration, mutation, and persistence

Treat null as the absence of plugin data and other non-record values as
malformed, including undefined, arrays, and non-plain objects. Keep the
hydration origin for onboarding. Reject an unknown future version with a
warning and use defaults. An omitted hook, a thrown exception, or a
non-record migration result takes the migration fallback. Run cleanup saves
on that path as best effort. Install the settings layer before its consumers
and finish hydration before exposing it.

Store the version and sparse overrides in `data.json`, including explicit
overrides equal to defaults. Null can be an explicit override. The unique
reset symbol removes the key entirely. Derive writable keys from the schema.
For a mutation, validate the complete candidate with Valibot before publishing
it. Mutations keep the candidate values. Disk recovery takes parsed per-key
output before checking cross-field constraints against the complete snapshot.
A whole-schema failure uses defaults without rewriting current-version data.

On a current-version load, retain the raw value of any validation failure
on a known key. Expose a diagnostic and use the default in snapshots. Carry
that raw value through unrelated saves. An update or reset of the key clears
it. Unrecognized keys stay out of the next explicit save. Migration cleanup
persists cleaned values rather than broken values.

Debounce edited settings and serialize writes through the pending fiber.
Register completion observers even for fibers that have finished, since a
synchronous save failure can happen before the fork returns. Keep the write
Scope alive through the close flush. Obsidian unload is synchronous, so leave
a Promise on the shared host object for the next load to await. The settings
fixture uses the host's own definition and runs the real store against the
test clock and logger. The subscription fixture replays the current map and
waits for runnable subscriber work when updating it. [Settings store](../../packages/plugin-services/src/obsidian/settings/service.ts) · [Disk classification](../../packages/plugin-services/src/core/settings/classify.ts) · [Format version registry](../../packages/scripts/lib/format-versions.ts)

The Upgrader Vault Case reproduces the flat v2.1 settings and the
recorded launch version from before Profile bindings. Seed every note
unstamped in the old literature folder. Use the shipped fields plus
one visible user edit. Eject all four Legacy Template slots, both
Citation slots, and the bare annotation Partial, with visible edits
to distinguish user files from shipped originals. Fail the build if a
shipped source no longer contains the text the edit expects. Name the
bare Partial by its own name and derive its source from the annotation
slot. Use Liquid for cite and Eta for cite2 to exercise the
mixed-language fold. The Liquid edit converts, the Eta file remains
and is named in the notice, and the alternate uses its built-in branch.
