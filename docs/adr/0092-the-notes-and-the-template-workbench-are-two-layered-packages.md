---
status: accepted
---

# The notes and the Template Workbench are two layered packages

## Context

The plugin base (ADR 0087), ZoteroReads (ADR 0088), the platform services (ADR 0089), the annotation feature (ADR 0090) and the citations (ADR 0091) are layered packages. The notes and templates group still lived in `apps/obsidian`: the Note Feature, the note import, the Profiles and Profile selection, the Template service, the batch runs and their modal, the Local Bridge, the Template Workbench CLI and View, and the Template Data Explorer. These units formed most of the one folder-level value cycle of the app (19 units). They reached into units that stay in the app: Profile selection and the Workbench's Match tab ran ZotLit Query through Item Query's `QueryService`; the Profiles read the Profile dialogs and their frame from `setting-tab/` and the Profile picker from `quick-switch/`; the Workbench View read the settings atoms of the host, the Welcome View's community link and the Query View's diagnostic text. The two template views imported each other (11 imports one way, 7 the other).

## Decision

- **Two packages with a one-way edge.** `@zotlit/notes` holds the Literature Notes, the note import, the Profiles with their dialogs and picker, Profile selection, the Templates with template data, and the batch runs. `@zotlit/template-workbench` holds the Template Workbench View, the Template Data Explorer, the Template Workbench CLI and the Local Bridge with Customize. The Workbench imports the notes; the notes import no part of the Workbench. The two parts were already one-way but for five imports: two were files that belong to the Templates (template data, the template sync), one was an error class that belongs to the Profiles, and two opened a document in the Workbench View.
- **The names follow the glossary.** "Template Workbench" names the workflow and its Obsidian surfaces; `@zotlit/workbench` stays the Workbench core that the web Workbench and Obsidian share, and the new package is its Obsidian host. The notes package is named by the glossary's "Notes" section; `@zotlit/templates` stays the rendering engine.
- **Each package has three layer folders**, as the features before them: `core/` host-free, `obsidian/` mobile-safe, `desktop/` Node and Electron, held by lint. Two cuts let the Profiles and the Template service load on Obsidian Mobile: vault paths join through `@zotlit/plugin-kernel/vault-path.ts` (Node's `path.posix` algorithm, now with `join`), and `layerProfile` takes the Profile document revision as a parameter that the desktop host fills with its SHA-256. The Note Feature and the note import stay in `desktop/`: they read Excerpt Images and Attachment Import, which need Node.
- **Edges to units that stay in the app are cut, not followed.**
  - Profile Matches: a port of the notes, `ItemMatchQuery`, that tests many Items against many filters and names the custom fields. The host fills it from its `QueryService` (`apps/obsidian/src/services/item-query/item-matches.ts`, which holds the Item Query request that the port's answer reads).
  - The Template Workbench View: a port of the notes, `TemplateWorkbenchLauncher`, that the Citation Template's command and the Add Profile dialog open a document through. The Workbench fills it with its one open.
  - The Profile dialogs, the Create, Import, Share and destination modals, and the Profile picker belong to the Profiles and move with them. Their generic frame (title, footer, fields, two columns) moves down to `@zotlit/obsidian-kit/dialog-frame.ts`; the note preview stays with the dialogs.
  - The diagnostic text of ZotLit Query (`readerText`) moves down to `@zotlit/obsidian-kit/reader-diagnostic.ts`, typed by `@zotlit/item-query`'s `Diagnostic`. The community link moves to `@zotlit/obsidian-kit/docs-url.ts`.
  - The settings atoms of the template folder and the default bindings move to the slices' owners (`template/atoms.ts`, `profile/atoms.ts`).
- **The 11-import back-edge between the two template views is resolved by a lower unit.** The Obsidian host of the headless Workbench UI (host, theme, Match pane, popups, completion, Item and Annotation choice, the action runner and the layout turn) is the `editor/` unit, which the View, the Data Explorer and the host's Query View import. The Data Explorer imports only `editor/`; the View imports both.
- **Port layers live with their owner.** The notes package fills the ports of the annotations and citations (`AnnotationNoteActions`, `CitationTemplate`, `CitekeyNoteActions`, `ProfileStyles`): each layer reads only the notes' services and the port's tag, and the host only composes it.
- **Host composition stays in the app**: the PDF view's note button (`views/pdf-note/`, which reads the Query View's Literature Notes), the Annotation Suggester (`views/annotation-suggest/`, an Item Query consumer), the citations' host tests, and the tests that run Profile selection or the Match tab over the host's ZotLit Query service (`src/services/notes/`, `src/services/template-workbench/`).
- **Each unit registers itself**: the service tags in `ViewServiceRegistry`, the Profile, template and note import slices in `SettingsRegistry`, the `zotlit:open-template-workbench` event in `obsidian`'s `Workspace`.

## Considered options

- **One package for notes and the Template Workbench.** Rejected: the two parts were already one-way once three misplaced files went home, and the Workbench View, the CLI and the Local Bridge are a separate work area from note creation.
- **Pass `QueryService` into the notes.** Rejected: the notes would name Item Query's request and outcome shapes, which belong to the last group of the app.
- **Move the citations' host tests into the notes package.** Rejected: they run both feature packages over the host's composed settings and its `happy-dom-native-response` project, which is host composition.
- **A JavaScript SHA-256 for the Profile revision.** Rejected for this step: the parameter moves the Profiles to `obsidian/` with no new code in the bundle.

## Consequences

- The largest folder-level value cycle of the app drops from 19 units to the units that remain in it; the moved units leave it, and no source file of either package imports a unit of the app.
- One build-time edge to the app remains: the Template Data Explorer's stylesheet reads the app's `zt-main.css` through `@reference`, for the Tailwind theme. It goes away when the theme moves into a base package.
- A host composes the notes' slices into its settings definition, provides `ItemMatchQuery`, `TemplateWorkbenchLauncher` and the Profile revision, and passes both packages' source to `effectEntry` and to Tailwind `@source`.
- A further cut that moves the Note Feature to `obsidian/` splits the tags of Attachment Import and Excerpt Preparation from their desktop layers.

The Profile revision is the SHA-256 of the exact source bytes represented by
the document string. The editor sends the revision it loaded. The file writer
computes the current revision the same way before it replaces the document.

## Liquid editor parser

The CodeMirror dependency patch exports the bare Liquid tag language so the Workbench can parse template syntax without loading the HTML overlay. The Workbench configures the grammar for standalone Liquid expressions and uses it for embedded template ranges. Keep the pure annotations on the default overlaid language factory so a bundle that imports only the tag language can drop the unused overlay.

The database resolves a batch Collection key within its Library so the caller can distinguish a stale link from an empty Collection. Walk descendants with a recursive query that skips trashed Collections at every level. Include live standalone Notes filed in scope and Child Notes of live Items filed there. Filtering trashed Items before the child lookup excludes their Notes as well. A whole-Library Note scope also includes live Notes outside Collections.

Explicit Note import can look up a Note identity and title by its own item ID even when Zotero has trashed it. Put the trash status beside the identity so the batch can classify it before materializing HTML. Deduplicate and sort these references by item ID so the manifest stays stable. Child Note reads return live notes in the requested parent order.

Resolve Zotero's Related panel with forward `dc:relation` rows alone. Zotero writes reciprocal rows, so reading inverse links would add unintended matches. Resolve returned keys in the source Item's Library, and skip URIs that do not identify an Item. [Zotero Related Items lookup](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L6099)

Profile selection and the Template Workbench's Match tab use the same Item Match port. Query Views fills it through Item Query, which tests the requested filters in one Items query over the Libraries that own the Items and returns per-Item outcomes by Indexed Key.

Enforce inward imports and host capabilities in each Notes layer. The portable Obsidian feature supplies Templates, citation styles, and settings. The desktop feature adds Note Feature writes, Note Import, template migration, Profile dialogs, and Companion links. Wire creation planning after the Item Match Query port. Share the Annotation insertion port between Annotation View and ZotLit Reader. The Library View and Citation Suggester use bound Note Feature calls. [Notes layers](../../packages/notes/oxlint.config.ts) · [Desktop Notes feature](../../packages/notes/src/desktop/feature.ts)

Use the Obsidian runtime stand-in and apply the Effect entry checks to Notes and its source dependencies in Vitest. Run the view dependencies through Vite so `@effect/atom-react` receives the same React-to-Preact alias as view code. Use offline engine metadata in this configuration and let tests of concrete engine metadata supply their own values. [Notes Vitest configuration](../../packages/notes/vitest.config.ts)

Build Notes test settings from the slices Notes reads. Tests choose the migrations they need because the installed host owns migration of its settings history. Supply empty service tags to complete the tab, view, and dialog test contexts. Merge implemented services last so each test supplies just the members it exercises. An unexpected call fails at the stub. Use a Profile Reader fake in consumer tests and a vault-backed registry for registry behavior. CLI draft tests read through Node's file system. [Notes fixtures](../../packages/notes/src/__fixtures__)

Declare bundled raw templates as text in Notes. Shared stylesheet declarations live in Obsidian Kit. [Notes asset types](../../packages/notes/src/typings/assets.d.ts) · [Obsidian Kit asset types](../../packages/obsidian-kit/src/typings/assets.d.ts)

## Amendment (2026-11-21): one Template Workbench package

[ADR 0100](0100-the-web-template-workbench-is-retired.md) retired the web Workbench, so the Workbench core has one host. `@zotlit/workbench` is folded into `@zotlit/template-workbench`: the core is its host-free units under `src/core/`, and the "names follow the glossary" bullet above no longer names a separate core package.

The Workbench test host supplies the view services the package reads and
accepts additional services from app tests. Setting row tests stub only the
services the package's rows can read. Test query fakes provide both real Item
Match results and the field vocabulary. Preserve the write boundary in the
view fixture: a started write completes and its rejection reaches the note
operation.

Lint enforces the direction of imports: desktop can use Node and Electron,
Obsidian loads on desktop and mobile, and core loads on any host. The base
Feature carries the host-independent Workbench contributions. Its desktop
extension adds Customize, the view, the standalone Explorer, Profile settings
and Workbench links, and fills the launch port from Notes. The Citation
Template and the Profile dialogs use that port. A refused link reports the
failure, while an ignored link or a successful open needs no notice.

The Workbench state, scheduler, and hooks use Effect Atom APIs, so the
TypeScript configuration allows those unstable imports. The library
configuration excludes core fixture helpers from its typecheck inputs.

## Testing editor parsing

The Workbench editor can yield after its initial parse budget, leaving a partial token tree until an idle callback. Tests that assert token classes or hover behavior first finish that parse so their assertions read the final tree under load.
