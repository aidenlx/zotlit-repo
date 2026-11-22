# Opening an Attachment in Obsidian's reader carries the key, not the path

The Companion offers "Open PDF in Obsidian" on an item row, an attachment row, and the Reader page menu. Obsidian can host a file that lives outside the vault: `Vault.getFileByPath` falls through to the external file manager when the path carries a `file:` prefix, and the built-in `obsidian://open?file=file:<abs>` reaches that fall-through, both verified live on 1.14.2. ZotLit uses neither. It sends its own action, `obsidian://zotlit/open-attachment?item=<id>&source-id=<hash>`, carrying the Zotero id alone, and resolves the path on the Obsidian side through `attachmentAbsPath()`. A Public URI Link is a permanent, embeddable artifact, so an absolute path written into one is a device-local fact in a contract that promises to outlive the device. The built-in form also carries no Source Id, which is the sole targeting gate: a link that names a path reaches whichever vault answers, not the configured install. Resolution stays in one place as a result, beside the resolver that already runs it in the other direction.

## Considered Options

- **The built-in `obsidian://open?file=file:<abs>`** (rejected): fewer moving parts and demonstrably working, but it bakes a device-local path into a permanent link and drops the Source Id gate that aims an action at one install.
- **A ZotLit action carrying a path** (rejected): keeps the gate, keeps the staleness, and still leaves Zotero resolving paths that `@zotlit/db` already knows how to resolve.
- **A ZotLit action carrying the Zotero id** (chosen): the payload stays valid wherever the link travels, and one side owns path resolution.

## Consequences

- `open-attachment` is a frozen contract from its first release, per ADR 0006. It takes one numeric `item`, which may name a regular item or an attachment, and Obsidian branches on which it finds. `PROTOCOL_VERSION` does not move, because the URL transport carries no version.
- The `file:` prefix is undocumented. It is read from the 1.14.2 bundle and confirmed live on that version alone, so an Obsidian upgrade is a place this can break silently; the feature fails to a notice rather than to a wrong file.
- An Attachment already inside the vault opens by its vault-relative path. `Vault.fileMap` is keyed that way, so the `file:` spelling would miss it and build a second representation of one file, and the PDF annotation editor binds per path.
- The two readers disagree on what qualifies, and the glossary says so: a Zotero-Openable Attachment is any file the path names, an Obsidian-Openable Attachment is a PDF. One seam carries both rules.

## Attachment lookup and picker

Read the Item and its Attachments from one ZoteroReads Snapshot so a database swap cannot mix an Item ID from one database with rows from another. Reuse the resolver for the Literature Note actions and the open-attachment protocol. Resolve stored and linked paths using the active Zotero preferences. Use Zotero's media type for PDF filtering, with the filename extension as a fallback when the type is absent. The resolver constructs a path. The reader checks whether the file can be opened at use time.

Use a vault-relative path for files inside the vault and prefix a normalized external path with `file:`. Include a separator in the containment check so a sibling directory with the same prefix stays outside. On case-insensitive platforms compare case-folded paths and return the original normalized spelling, which the vault's file map needs. Split the label at either path separator because synced rows can come from another operating system.

Resolve the file through the Vault immediately before opening it. Report a missing file to the caller so it can show a notice or use a Zotero fallback. Append the encoded Attachment key to the original subpath so the reader can distinguish Attachments that share a file and preserve the host's page and annotation parameters. Run any follow-up only after the reader reports an open. At the Promise boundary, use an empty result for a failed database lookup and `undefined` for unload so cancellation does not trigger an empty-attachment notice.

Keep one shared picker for both readers. Open one Attachment directly and defer an empty list to the caller's handler. For several Attachments, use a menu anchored to the invoking control when an event is available and a Suggest modal otherwise. Accept keyboard events from Obsidian's menu and React events from the views. Take a button's bounds and owner document before an asynchronous refresh because the event's current target becomes null after dispatch. Let modifiers select a pane unless the caller supplies a fixed pane. [Resolver](../../../../packages/annotations/src/core/attachment-open/resolve.ts) · [Literature Note lookup](../../../../packages/annotations/src/obsidian/attachment-open/literature-note.ts) · [Picker](../../../../packages/annotations/src/desktop/attachment-open/open-attachments.ts)

In tests, compute the expected path from the seeded Item, data directory, and vault directory. Run the real ZoteroReads adapter over the seeded database. Close both the fixture scope and its bridge to exercise plugin unload at the Promise boundary. [Lookup tests](../../../../packages/annotations/src/obsidian/attachment-open/literature-note.test.ts)

Resolve the numeric protocol target through `AttachmentsAt` because the same field can name an Item or an Attachment. When the explicit protocol pane is present, use it for the open even if the picker selection uses a modifier. The file-menu test clears the event's current target after dispatch and uses the real picker to verify placement from the captured bounds. [Protocol handler](../../../../packages/annotations/src/desktop/attachment-open/link.ts) · [File-menu tests](../../../../packages/annotations/src/desktop/attachment-open/menu.test.ts)

The Attachment suggester overrides Obsidian's single-line clipping so users can compare the full filenames of similarly named Attachments. [Annotation View stylesheet](../../../../packages/annotations/src/desktop/annot-view/style.css)

Read the Attachment picker's options when the user opens it, using the current header Attachment state. [Attachment picker action](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

The header opens Obsidian's native Attachment suggester. The menu presents the action, and the suggester presents the current Item's Attachment names and Annotation counts. Its stylesheet permits wrapping so similar filenames can be distinguished. [Suggester](../../../../packages/annotations/src/obsidian/annot-view/attachment-suggester.ts)
