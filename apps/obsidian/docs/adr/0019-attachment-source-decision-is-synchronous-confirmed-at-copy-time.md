# The attachment source decision is synchronous over a roots snapshot; the filesystem check runs at copy time

Attachment Import used to read a raw location from the Zotero database and copy from it without asking where it pointed. Every location is now approved before a copy happens, and the import seam carries the verdict rather than a path: link resolution's raw path parameter becomes an Attachment Source Decision, a discriminated union (`{ approved: true; path; origin; root }` or `{ approved: false; path }`) whose approved branch only the attachment import service can construct. The decision itself stays synchronous — the service holds a standing snapshot of canonical roots (Zotero's storage directory, its annotation cache, the configured base attachment directory, and every Approved Attachment Root), rebuilt at service start, on a settings change — the plugin's own and Zotero's resolved location alike — and at the start of each import operation, and the decision is a string containment check against that snapshot in memory. A prepared batch reads through to that snapshot rather than copying it, so a rebuild reaches the long-lived handle the annot view holds for drag-insert. The authoritative filesystem check runs at copy time: before any bytes move, the source is canonicalized, must be a regular file, and must still sit inside its origin's canonical root.

That split is what lets the render path keep its shape. The attacker in this advisory controls a string in the Zotero database, and that string is judged completely by two synchronous checks — the pure lexical parse in `@zotlit/db` rejects every separator and parent segment, and snapshot containment refuses anything outside a trusted root. The one thing a string cannot express is a symbolic link on disk, and that is exactly what the copy-time confirmation catches.

## Considered Options

- **Filter the queue at flush time** (rejected): the queued copy runs after rendering has already emitted the vault link, so a location that later fails approval leaves a note that already links a file which was never copied.
- **Approve ahead of rendering, asynchronously** (rejected): moving the whole decision — filesystem canonicalization included — in front of rendering makes a rendered link and a copy agree in every case, including the symbolic-link case. Implementation reached the annotation drag-insert path and stopped: a `dragstart` handler must populate its data transfer in the same tick, so it structurally cannot await a decision. The invariant turned out to be priced wrong — the asynchronous part defended only against a symbolic link on the local disk, which the copy-time confirmation catches anyway. The implementation commit for that design was rolled back rather than built on.
- **Decide synchronously against a snapshot, confirm at copy time** (chosen): rendering reads memory only and performs no filesystem access, so every call site keeps its current shape. The decision still has to arrive as its own type, because a path alone cannot tell a caller whether it was approved, and its `origin` discriminant doubles as the copy-strategy selector.

## Consequences

- Rendering performs no filesystem access, and annotation drag-insert keeps deciding inline in its own tick.
- No caller can construct an approved source; the import service is the single enforcement point for Note Import, annotation rendering, Literature Note templates, and the template path helpers.
- A blocked source renders a `file://` link and queues no copy — the same behavior the user already gets with Attachment Import switched off, so no new rendering path is introduced.
- The snapshot keeps each root in two forms. The decision compares against the root as declared, so a Zotero data directory that is itself a symbolic link keeps importing exactly as before; the confirmation compares against the canonical form, so a link planted inside a trusted root cannot carry a file out of it.
- A note can link a file whose copy the confirmation later refuses. That needs an attacker who can already plant a symbolic link inside a trusted root on the local disk, which is outside this advisory's model. The refusal is logged with its origin and reason — never the location — counted in the summary notice, and degrades to a missing embed rather than a wrong copy.
- The set of skipped sources is known when an operation ends, which is what the single summary notice consumes. Nothing prompts, and no operation blocks.
- The Template Data Explorer and the Template Workbench stay side-effect-free by construction: they render through inert resolvers instead of the import seam.
- Reversing this decision means either re-synchronizing the render path back onto a raw location, or making it asynchronous and giving up drag-insert.

## Root identity and user approval

Canonicalize roots using the native filesystem path so different spellings
of the same folder share an approval. Use case-insensitive comparison on
macOS and Windows. Require a source strictly inside its root. Omit absent
or unreadable roots from the snapshot and log unreadable-root reasons.
Refresh each saved approval by canonical path. If its target changes,
exclude both the original path and the new target from that approval.

Keep the approved decision's constructor private and its brand
non-enumerable. Record absence of an applicable root separately from a
source outside the configured roots. At confirmation, keep a missing
source distinct from a refused source. Require a regular file within the
canonical root. Use a Scope-owned descriptor for linked sources so confirming
and reading address the same file. Use the platform's no-follow option
where supported. Use confirmed paths for Zotero-managed sources so those
copies can retain copy-on-write cloning.
[Source policy](../../../../packages/plugin-services/src/desktop/attachment-import/source.ts)

Store Approved Attachment Roots per vault and device, deduplicated in grant
order. Ignore invalid entries and treat malformed records as empty. Remove
the record when the last grant is revoked. Accept grants only from the
Approved Attachment Roots action. Keep that page reachable when import is
disabled so the user can review or revoke grants. Its title names the list.
Use Obsidian's configured attachment location when the import destination
setting is blank. [Approval storage](../../../../packages/plugin-services/src/obsidian/attachment-import/approved-folders.ts) · [Approval page](../../../../packages/plugin-services/src/desktop/attachment-import/approved-folders.ts)

## Copy and skip reporting

Treat a missing source as a skipped input and continue the batch. Compare
destination size and modification time at millisecond precision. Inspect
the destination entry without following links. Refuse an existing symlink.
Create a private temporary file beside the destination with exclusive
creation, preserve timestamps there, and rename it into place only when
complete. This keeps readers from seeing a partial file and avoids metadata
writes through the final path. Finish the copy or clean up its temporary
file before honoring interruption. Preserve reflink for path sources and
fall back to a normal exclusive copy when cloning fails. Read descriptor
sources from the start, and close the destination descriptor before rename.
[Attachment copy](../../../../packages/plugin-services/src/desktop/attachment-import/copy-attachments.ts)

Show one notice when an operation settles with blocked or refused sources.
Its Settings action hides the notice and takes the user to the approval
page for a future import. Keep support diagnostics to the source origin
and refusal reason. Tests exercise the real filesystem and verify that
failure cleans up temporary output. The decision tests use a constructed
snapshot to check host-independent comparison, and a shared device store
models a restart while a fresh store models another vault.
[Skip notice](../../../../packages/plugin-services/src/desktop/attachment-import/notices.ts) · [Attachment Import fixture](../../../../packages/plugin-services/src/desktop/attachment-import/__fixtures__.ts)

## Batch lifetime and refresh

Fail service acquisition if reading the stored approvals fails. Refresh the
roots in sequence on Zotero location changes, while handling enabled plugin
settings updates, and at the start of each enabled import. Approval and
revocation update the roots before returning. An unresolved grant returns
`null`. The approval and root streams deliver the current value, then
updates. Those streams and the skip stream close with the service. A pending
summary is discarded at shutdown.

Resolve a link during rendering and queue its copy only on the first
invocation of the link helper. An excerpt that the template does not use
therefore imports nothing. Let Obsidian choose the link format and fill in
its default display text from the filename. Discard the queue when a drag
does not land because the next drag reuses the prepared batch. Cache the
destination folder by the note's parent directory for the duration of a
batch update. Normalize the imported basename to one path segment using the
note filename normalizer, then check the resolved destination against the
attachment folder before copying.

Flush drains the queue and reports skips since the previous flush. It
creates the destination folder only when at least one copy passes
confirmation. With import disabled, render fallback links without counting
or logging skips. During an enabled import, count blocked sources when
their fallback links render and refused sources when confirmation rejects
them. Deduplicate the parent folders of blocked absolute linked files for
the summary. Each flush that reports a skip restarts the idle window, so a
batch update that flushes per note gives the user one notice when it settles.
[Attachment Import service](../../../../packages/plugin-services/src/desktop/attachment-import/service.ts)

The filesystem tests canonicalize the temporary root before comparing the
declared and confirmed paths because macOS can supply an alias. They also
exercise preference refresh with no change notification and with a
previously prepared batch. The permission case makes the source's parent
unsearchable to exercise an unreadable location.
[Attachment Import service tests](../../../../packages/plugin-services/src/desktop/attachment-import/service.test.ts)
