# Imported notes are mirrors, not literature notes

> **Amended by [ADR 0079](0079-the-literature-note-body-is-the-users-and-rendering-has-no-side-effects.md).** Imported Notes are created only by command (import child notes, import all notes, batch import). Rendering a Literature Note never imports a Child Note: `noteLink` links an existing Imported Note, or else opens the Child Note in Zotero.

Zotero Items can have Child Notes (rich-text notes attached to a library item). When ZotLit imports a Child Note into the vault, the resulting Obsidian file is an **Imported Note** — a managed mirror identified by `zotero-note-key` in frontmatter — **not** a Literature Note.

The two note kinds are kept disjoint: `zotero-key` (Literature Notes) and `zotero-note-key` (Imported Notes) never appear on the same file. The Note Index maintains separate maps for each. `isLiteratureNote()` only checks `zotero-key`, so imported notes never pollute Literature Note lookups, citation resolution, or the update/overwrite flows.

We considered unifying them — a single `zotero-key` field covering both items and child notes, with a discriminator. We rejected this because:

- **Different update contracts.** Literature Notes use managed-region overwrite (preserve user content outside `%%zt-managed%%`). Imported Notes use whole-body overwrite (the file is a clean mirror of the Zotero note; explicit re-import signals intent to replace everything).
- **Different Zotero sources.** A Literature Note's source is a Zotero Item (article, book, etc.). An Imported Note's source is a Child Note (rich-text HTML). They have different schemas, different queries, and different template data shapes.
- **Index pollution.** If both shared `zotero-key`, every feature that looks up "the literature note for this item" would need to filter out imported notes. The disjoint keys make the wrong lookup a type error, not a runtime bug.

The trade-off: two parallel identity paths through the Note Index, two sets of frontmatter conventions, and protocol actions that must know which kind of note they're targeting. This complexity is justified by the clean separation it buys.

## Consequences

- `NoteIndex` has three maps (`#notesByItemKey`, `#notesByCitekey`, `#notesByNoteKey`), not two.
- `zt.notes` in the Literature Note template context is link-only (`{ key, title, noteLink() }`), not inline content — the imported note is a separate file, not embedded text.
- Re-import is always explicit (protocol action or command); auto-materialization during Literature Note create/update is skip-if-exists only.

## Managed identity fields

Imported notes use a separate Zotero note key so the Literature Note index does not treat a mirror as its parent Item's Literature Note. Store the Child Note's modification time at second resolution for batch re-import to skip unchanged notes. The update flow writes system identity fields from the Item, and expressions cannot target them. The default Literature Note Profile applies when the note has no Profile id. Vault property selection also excludes Obsidian's system keys and the per-document citation style.

## Import routing and execution

Collect Standalone Notes and Child Notes in one planning Snapshot. Use the requested Library and its Collection subtree when present, and list available Libraries in canonical order for a Library Scope run. Report missing targets before classification. Report an empty scope as nothing to import, and report missing explicit IDs separately.

Child Note mode opens a hierarchy in the modal and drops parents with no children. Note mode opens a flat confirmation for two or more notes. A single note takes the same direct path from either a scope or an explicit ID. Ask for overwrite confirmation before that path replaces a mirror, since the request can arrive from outside Obsidian. A missing modification stamp makes an existing mirror eligible for overwrite.

Stream references and Library metadata through a classification Snapshot. Count slices as they arrive and interrupt the stream on Cancel. Defer full note bodies until writes begin. Use a fresh Snapshot for the body read and the write it supplies. A modal run shares that Snapshot across its writes and holds it until they settle. Bound admission so Cancel can stop queued tasks while admitted writes finish and report their outcomes. Skip a note that disappears after classification. Show unavailable Libraries in confirmation before a partial batch writes. [Batch import runner](../../packages/notes/src/desktop/note-import/batch-import.ts)

The modal owns its run summary. Report single-write and preflight outcomes through the caller's notice path. A declined confirmation or interrupted command ends without a notice. Register the commands in the host Scope so unload interrupts them. The command callback handles a typed failure after the Notifier reports it. Let a defect reach the host.

Start file-menu Child Note import through the same command runner as the registered command, including its confirmation and notices. [Desktop Notes feature](../../packages/notes/src/desktop/feature.ts)

Headless tests substitute the DOM manifest and drive the real classification and executor. Read fixture answers at call time so tests can change them between phases. Preserve the typed Profile refusal when a write fixture rejects and pass other fixture rejections as defects. Tests exercise interruption after one streamed slice, completion of an admitted write after Stop, and the typed database-unavailable result of a SQLite read failure. [Batch import tests](../../packages/notes/src/desktop/note-import/batch-import.test.ts)

## Write boundary

Share one 16-permit semaphore across prepared and direct writes. Hold the permit throughout each write to cap the importer's load on the vault, even when several batches are active. A prepared import fixes its Profile and path before confirmation. Execute it with fresh caller-held reads and skip when its source or Profile changes. A direct import uses the explicit target when it still exists, then looks in the Note Index. Only a create needs the configured import folder. Reserve UTF-8 filename bytes for an underscore, a six-character random suffix, and `.md`. Report a collision found during minting as a typed refusal and skip if the path becomes occupied before create.

Prepare image links and convert the note with rows from the caller's Snapshot. Keep conversion failures typed with their original cause, including a throw from the Citation Template or Annotation Section. Write the finished mirror and flush its queued copies in one uninterruptible section, so interruption alone cannot strand links to pending copies. Overwrite through the live text boundary with the complete prepared text. The replacement callback only returns that text, so a callback throw would be a defect. [Note Import write service](../../packages/notes/src/desktop/note-import/service.ts)

Service tests drive the real importer over in-process reads and a memory host. Substitute conversion and rendering to check the Profile and Library inputs and the per-note attachment batch. The parser fixture includes any rendered callouts in the text it returns. Supply the Turndown constructor name that the production host provides. Use the real attachment decision when checking that blocked sources produce file links and no vault embeds. Disk image tests map a memory vault to temporary directories and register published files so their links can resolve. [Note Import service tests](../../packages/notes/src/desktop/note-import/service.test.ts)
