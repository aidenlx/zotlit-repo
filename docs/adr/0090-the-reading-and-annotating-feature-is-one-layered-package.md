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
