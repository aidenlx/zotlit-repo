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
