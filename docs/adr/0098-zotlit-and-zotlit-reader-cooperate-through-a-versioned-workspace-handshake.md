---
status: amended by ADR-0101
---

# ZotLit and ZotLit Reader cooperate through a versioned workspace handshake

## Context

The PDF reader left ZotLit: ZotLit Reader (`zotlit-reader`) ships the ZotLit PDF Reader, its takeover, embeds, hover previews and canvas cards, and works with no ZotLit and no Zotero. ZotLit keeps the Zotero features (the ReaderExtension with Annotation Marks, the Creation Toolbar and the tools, the Annotation Anchor patch, File Link Capture, Excerpt Images) and must add them to the Reader's view when both plugins are installed. Each plugin bundles its own Effect and Preact copy, loads in either order, can be turned off at any time, and ships on its own version line. Without the Reader, ZotLit opens PDFs in Obsidian's own PDF view.

## Decision

- **One contract package.** `@zotlit/reader-api` holds the constants (`READER_API`, `READER_CSS_PARTS`), the `ReaderApi` and `ConnectRequest` members, the structural types they name, and two helpers: `connectReader` for the client and `answerConnect` for the Reader. Both plugins build against it and bundle their own copy of the helpers. Its source imports only types of `obsidian`: no Effect, Node, Electron, Zotero or ZotLit module.
- **A two-event workspace handshake.** The Reader listens for `zotlit-reader:connect` on `app.workspace` and triggers `zotlit-reader:ready` once at load. The client listens for `ready` and triggers `connect` with `{ client, major, minor, accept, refuse }` at its load and on each `ready`. The Reader answers in the same call. So the order of load does not matter, and a Reader turned on later reaches a client that is already running.
- **Plain values cross.** Functions, promises, plain objects, DOM nodes and Obsidian objects. A failure is a rejected promise whose error has a `reason` string. No class identity, no Effect value, no shared singleton.
- **Semantic versions with N and N-1.** Major for a member that goes or changes meaning, or a CSS part renamed or removed; minor for an addition. The Reader answers from a map of each supported major to an adapter of its current implementation, and keeps N and N-1 for one release after a major change. The client accepts when the major matches and the minor is at least the one it asked for. Current: major 1, minor 2 (minor 1 adds the `onRefuse` option of `answerConnect`; minor 2 adds the `root` part); parts `root`, `scroller` and `toolbar`.
- **A mismatch tells one side.** The Reader refuses with the majors it supports and its version, writes one log line and shows no notice. ZotLit shows the notice once per vault per state, absent, off or incompatible, and names the plugin to update from the supported majors.
- **Only the handshake is stable.** The Reader also sets the same object as `plugin.api`, for tests and the settings status row; only the handshake is documented as stable.
- **No Zotero type in the contract.** The annotation backend stays Zotero, inside ZotLit. A later backend attaches through the same `addExtension`.

## Considered

- **ZotLit bundles the reader.** Rejected: two copies of pdf.js in a vault with both plugins, and ZotLit's `main.js` grows past its 5.0 MB budget.
- **`app.plugins.plugins["zotlit-reader"].api` alone.** Rejected as the stable path: it depends on load order and on a private Obsidian member, gives no version check, and finds no Reader that is turned on later.
- **A shared runtime package (one Effect, one registry) between the plugins.** Rejected: two bundles cannot share module identity, and a global registry couples the versions of both plugins.
- **A disabled companion pack for the heavy parts.** Studied and not chosen for the reader: it adds a second install and a second version line for each user of the reader. _(Revised by [ADR 0101](0101-managed-binaries-ship-in-the-resource-pack.md): the Resource Pack is such a pack for the Managed Binaries, which only some users need. pdf.js stays in ZotLit Reader's bundle.)_

## Consequences

- ZotLit holds a `ReaderConnection` state (connected, absent, incompatible) and falls back to Obsidian's PDF view in the other two states.
- The Reader calls the `onClose` listeners before it disposes its readers, so ZotLit drops the API and its patches first.
- A contract probe, a third test plugin with no Zotero code, proves the contract apart from ZotLit, including a refused major.
- A change of the contract is a change of `@zotlit/reader-api` and of both plugins in one tree; a release of one plugin keeps working with the other plugin's last release through N-1.

The Obsidian feature composes the Annotation Repository, capability notices, Reader editor and settings. Its desktop extension adds Excerpt Images, the Target Opener and Attachment commands. Each Reader binding has a child scope and reaches Effect from PDF callbacks through the bridge. Install listeners before processing the layout. Run binding retirement in the service scope so an in-flight write can finish without blocking the caller. Excerpt services start before the editor and use a late-bound port for Reader borrowing. The port answers detached before acquisition and after the editor withdraws its bindings. [Binding service](../../packages/annotations/src/obsidian/pdf-annotation-editor/service.ts)

Bind pages already painted at plugin reload because they may send no new render event. A page reset during zoom, rotation or recycling can discard the overlay. Rebuild it from records already held. A hidden tab can bind before the document opens. Key Structured Characters to the active document proxy because a vault modification or pop-out migration can replace it while the view stays. Keep unresolved file bindings distinct from pending ones: a pending database lookup can populate a view in place when the database becomes readable.

The Reader's drag-out gesture delegates note insertion to the same Annotation actions as an Annotation View card.

Snapshot the file path when creating a Reader binding so a later file replacement retires it. Get external paths from the external file and vault paths from the adapter. Prefer an Attachment explicitly identified by the open over path resolution, including when two Attachments share the file. A pending lookup can take the resolver's later answer. Once a file resolves or is unknown, retain that answer for its binding. Paint pages already open and rebuild their data-driven overlays on page render. Revalidate on Reader leaf activation.

Expose Reader Sessions through the editor's session stream so the Annotation View sees a later binding without reopening. The editor fixture runs the actual layer with typed substitutes at its external service boundaries, including a no-op drag insertion.
