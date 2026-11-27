---
status: accepted
---

# The reading and annotating feature is one layered package

## Context

The plugin base (ADR 0087), ZoteroReads (ADR 0088) and the platform services (ADR 0089) are packages. The first feature to follow is reading and annotating, because ZotLit Reader is built from it and the desktop plugin keeps it. Its code lived in `apps/obsidian`: the PDF reader surfaces, the Annotation Repository, Excerpt Images, Reader Sessions, the Annotation Popover, Open Targets and the Annotation View. It imported other features: the menu events named every feature's menus, the cards and the Mark Popup read the notes feature (`AnnotationNoteActions`) and the template errors, the Annotation View hosted the Query View, the image command read Item Query's diagnostics, and an Open Target read the citation index's Zotero-Openable Attachment.

## Decision

- **One package, `@zotlit/annotations`, with three layer folders**, as the platform services: `core/` host-free, `obsidian/` mobile-safe, `desktop/` Node and Electron. Lint (`no-restricted-imports`, `import/no-nodejs-modules`) holds each boundary. The Annotation Repository and the annotation model sit in `obsidian/`, so they load on Obsidian Mobile; the excerpt cache key (SHA-256 through Node's crypto), the excerpt renderer's layer, the Excerpt Image display, note excerpts, Open Targets and the card actions (Electron's clipboard) sit in `desktop/`.
- **The name is `@zotlit/annotations`.** Every term of the glossary's "Annotation view" section names an Annotation or the reading of one. "Reader" names three things already (the Zotero Reader, Obsidian's PDF reader, ZotLit Reader) and `@zotlit/pdf-reader` is planned for a dedicated viewer.
- **Service and view of one feature are one unit.** The PDF reader surfaces read the cards' primitives (card controls, comment parts, tag editor, editor sheet), so both are in the package; no file cycle joins them.
- **Edges to other features are cut, not followed.**
  - The menu events become a mechanism in the Obsidian kit (`menu-events.ts`: `menuEvent`, `menuSections`, `raiseMenu`, an open `ZotLitMenuEvents`). The feature that raises a menu names its sections and adds its event by declaration merging.
  - The notes capability is a port of the package, `AnnotationNoteActions`, with its request and outcome types. The notes feature provides the layer, and folds an inert Citation Template into the port's answer.
  - The annotation image command gives its own diagnostics, with the codes and hints of the Item Query commands.
  - The Zotero-Openable Attachment shape moves down to `@zotlit/plugin-services/core/attachment-resolver/zotero-openable.ts`.
  - The view opener of Open Targets (`views/open-target.ts`) moves with Open Targets.
- **The host keeps the sidebar Annotation View.** It is a Query View over the Annotations Layout, with the Query View's filter editor and Query File (`apps/obsidian/src/views/annot-view/`), so it stays with the query views; the package owns the cards and the Annotations Layout that the Query View hosts. The PDF view's reader that brings the sidebar forward (`pdf-reader.ts`) is host composition beside it. The Annotation Popover stays with the citations: it opens the Citation Popover.
- **Each unit registers itself**: the service tags in `ViewServiceRegistry`, the reader slice in `SettingsRegistry`, the PDF.js loader in `obsidian`'s module declaration.

## Considered options

- **Move the sidebar Annotation View and pass the Query View in.** Rejected: the view, its filter editor and its saved Query File are the Query View's; a factory port would carry the Query View's whole host contract.
- **A host-free cache key (a JavaScript SHA-256).** Rejected for this step: it adds a hash to the bundle to move a layer that no mobile host needs yet. The tag of the excerpt service splits from its layer instead, so the repository reads no Node.
- **Several packages (repository, reader, view).** Rejected: the reader surfaces and the cards share primitives both ways; layer folders give the boundaries with one set of configuration.

## Consequences

- The largest folder-level value cycle loses the group's units that moved.
- A host composes `readerSettings` into its settings definition, imports the cards' stylesheet where it registers the view, and provides `AnnotationNoteActions`.
- A test fixture that a host's tests also use takes the host's unread view services as a parameter (`__fixtures__/annot-view/host.ts`).

## Palette, comment conversion, and highlight mappings

- Swatches follow Zotero's reader order so the color numbers agree across both readers. Use lowercase hex for writes because the Zotero annotation API checks it. Compare stored colors without regard to case to recognize values from the database and importers. Use their palette names when available and show the raw hex for an unrecognized color. Fill the offered swatches from recent colors first, then from the canonical palette. [Pinned Zotero palette](https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/common/defines.js#L2-L11)
- The Zotero comment editor stores text with a small set of inline formats. The kernel's comment converter uses the standard bold and italic rules and preserves subscript and superscript as HTML. It converts line feeds to breaks before Turndown can collapse the whitespace. Reuse one converter per batch. It leaves punctuation unescaped to match the note converter and Obsidian's HTML conversion. The note-import rules depend on the note prepass and its callout marker, so the comment converter uses its own rules. [Pinned Zotero comment editor](https://github.com/zotero/zotero/blob/9.0.3/reader/src/common/components/common/editor.js#L4)
- Keep incomplete custom highlight mapping input in settings so the editor can display the draft. Note Import uses the HTML highlight while the draft value is invalid.

## Reader Session ownership

Use one Reader Session per reader and let a surface follow one session at a time. Identify the Attachment, optional parent Item, and selected Annotations by Indexed Key. A standalone Attachment can hold Annotations without a parent Item. Clear the previous selection before announcing a change of target because the selection belongs to the old Attachment. The owner reports the selection it actually holds. An external surface can request a selection, but the session publishes it only when the reader reports it. Register selection surfaces such as the Annotation View's card list so their own gestures can update selection without starting a click-away. Card navigation in the ZotLit PDF Reader uses a quiet Mark Landing. [Reader Session](../../packages/annotations/src/core/reader-session/session.ts) · [Follow Mode](../../apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md) · [Card Selection](../../apps/obsidian/docs/adr/0061-the-annotation-view-owns-its-card-selection.md)

The Zotero Reader Session adapter has test callers only. It translates the Companion's numeric IDs to Indexed Keys. Retain the previous target during resolution, abort a superseded read or a read from a disposed session, and retry the last push on refresh. A completed resolution without a match clears the target and selection. Zotero owns selection in its reader, so the adapter publishes only selection that Zotero pushes. [Zotero adapter](../../packages/annotations/src/core/reader-session/zotero.ts)

The Annotation test config loads the Obsidian runtime stand-in and the plugin's build constants. Bundle dependencies that need Vite's Preact alias so an external React copy cannot create a second component runtime. Tests provide the package's settings and view-service registrations. Install fail-fast stand-ins for unread services before the case's own implementations so a missing dependency fails where it is used. Keep host-free, mobile and desktop lint boundaries. Allow the IndexedDB store and its browser trial to import the yield guard because its requests and accounting must stay in one active transaction. Annotation View timers use the owning window so the same controls work in pop-outs.

### Reader gesture proof

Send an unrelated drop through CodeMirror's DOM handler. Send a tagged
drop through Obsidian's public editor-drop event so core focus handling
does not activate the drop target. A callout stays in its own block
even when the drop splits a line. Wait for Annotation Cards to render
after the read snapshot arrives. To start a real Mark drag, use
Chromium's drag detection with DevTools interception. This produces
the browser's drag data without starting an operating system drag.
The payload contains a quote for other editors and the ZotLit tag.

Reopen the bound PDF view in the same leaf when a test needs a new
binding. Another tab can show the same file. Register layout restoration
before opening a test tab so a failed open also restores the layout.
Keep covered windows rendering for pointer hit tests. Use the native
DOM menu to test text selection inside an open Mark Popup. Scope the
Excerpt Image change listener to the gesture so cleanup removes it on
every exit.

[Annotation drag](../../packages/e2e/src/annotation-drag.ts) ·
[Mark drag](../../packages/e2e/src/reader-annotation-drag.ts) ·
[Reader gestures](../../packages/e2e/src/reader-gestures.ts)

Send paired Reader chords through the view's native Scope
because DOM dispatch alone does not run its Keymap. Allow
for client-pixel rounding when checking a dragged PDF
position. Compare the Sort Index with the page, offset,
and top order Zotero reads. Use a color edit when the
test must observe the changed value in the Zotero Reader,
Obsidian overlay, and Annotation Card, since a Mark
does not paint comment text.

[Paired Reader cases](../../packages/e2e/src/paired-mark-handles.e2e.ts)

For a highlight handle gesture, wait for the text layer
even if the overlay has already drawn. Confirm the handle
is the top hit at its center and stable before one drag.
Read the stored edit once Zotero's open Reader has settled.
Check its range, overlay, and Annotation Card quote.

[Paired range cases](../../packages/e2e/src/paired-mark-handles.e2e.ts)

The desktop build opts in to the Annotation Suggester and its trigger
setting through ANNOTATION_SUGGESTER_ENABLED. Leave the feature off
by default while the search and inserted form are redesigned.
