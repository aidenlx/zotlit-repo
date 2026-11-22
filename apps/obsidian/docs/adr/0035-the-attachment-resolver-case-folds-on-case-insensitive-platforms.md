# The attachment resolver case-folds on macOS and Windows after separator normalisation

The attachment resolver maps the absolute path of an open Obsidian PDF view to a Zotero Attachment through a plugin-held index that runs `attachmentAbsPath()` across the attachment table, keyed by a normalised path. One pure function in `@zotlit/db` produces that key: separators to `/`, `path.normalize`, no trailing separator, and on `win32` and `darwin` a case fold. The Obsidian side goes through the same function after the `file:` prefix is stripped and `getFullPath()` is applied. Zotero stores a `linked_file` path as it was typed, and Obsidian derives its path from the vault base path, so the same file can arrive in two casings on a case-insensitive volume. A lookup that misses draws nothing and says nothing; a false match would need two files that differ only by case, which those volumes cannot hold.

## Considered Options

- **Exact match after separator normalisation** (rejected): silent misses on the platforms that make up most installs, with no signal to the user that the overlay is empty for a reason.
- **Case fold everywhere** (rejected): a Linux volume can hold both casings as distinct files, so the fold could bind an overlay to the wrong Attachment there.
- **Fold only where the filesystem folds** (chosen): the rule mirrors the platform's own identity rule.

## Consequences

- The first lookup or an explicit warm starts the index. Once requested, a database refresh or a resolved Zotero path change starts its replacement immediately. The index stays in memory.
- Two Attachments that resolve to one key collide; the resolver prefers the personal library, then the lowest `itemID`, and logs a warning.
- A case-sensitive macOS volume (APFS with case sensitivity enabled) is treated like the default and could, in principle, fold two distinct files; that configuration is rare enough to accept until reported.

The database parses Attachment paths before the host resolves them. Modes 0, 1, and 4 use an item storage directory and filename. Mode 2 can hold an absolute path or an `attachments:` path relative to the device's base directory. Mode 3 carries a URL. An invalid Zotero key makes the row unresolvable. A storage filename must be a single segment because the host joins it to a storage directory. Check both separator conventions, a leading drive prefix, and a parent segment. The stored rows can come from another platform, and a colon elsewhere in a POSIX filename is valid. [Zotero attachment path implementation](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L2637-L2730)

Normalise both sides of a lookup before comparing them. Collapse separator runs the way Obsidian does for `file:` links, resolve dot segments, and trim the trailing separator while keeping a lone root separator. Use the unfolded path when a consumer needs the real casing. Comparison keys use the platform fold documented above.

## Held path and key indexes

Read the rows and database identity from the same ZoteroReads snapshot.
Collect the streamed slices, then resolve paths using the current Zotero
preferences. A preference change invalidates the in-flight build. Keep the
previous index visible during a replacement or failed build. When a later
lookup retries a failed build, use the Held Read cooldown. Keep reads
synchronous so a caller can use the current answer from a DOM gesture.

Before the first build, return pending. Once an index exists, a miss is
unresolved. The indexed barrier waits for a build and starts none.
Publish a change when the first or replacement index lands, without replay.
A caller that gets pending can subscribe and look up again. A bounded wait
can return before a failed or delayed first build completes. A released
resolver returns pending without starting work.

Store every resolvable Attachment on the Indexed Key side, including the
losers of a path collision. Prefer an opener's explicit Attachment only
when it names the same normalized path, so an earlier opener's key cannot
rename another file. Report discarded keys in collision logs. A standalone
Attachment has no parent Item. A link-only row or a base-relative row without
a preference has no file lookup result. A key lookup checks the Zotero
record and does not verify disk existence. A Zotero reader link uses the
bare Attachment key and takes the Group ID separately.

Compute PDF eligibility with the row and path so the index and open gesture
share the result. When there is a content type, require PDF. Otherwise fall
back to the PDF extension without regard to case. A stored web snapshot can
resolve to a file without becoming an Obsidian-Openable Attachment.

Use the desktop Fixture's rows as the starting oracle for tests, with
explicit differences for base-directory and standalone cases. Build the
real resolver over an in-process database. Leave database reads controllable
so tests can hold or fail a build and verify recovery. Give each preference
update a fresh record, since the change stream uses its identity. Test
collisions with personal and group rows that make input order and lowest ID
alone give different answers.
[Attachment Resolver](../../../../packages/plugin-services/src/obsidian/attachment-resolver/service.ts) · [Resolver fixture](../../../../packages/plugin-services/src/obsidian/attachment-resolver/__fixtures__.ts) · [Resolver tests](../../../../packages/plugin-services/src/obsidian/attachment-resolver/service.test.ts) · [PDF eligibility](../../../../packages/plugin-services/src/core/attachment-resolver/pdf-attachment.ts)
