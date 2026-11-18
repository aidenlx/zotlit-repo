# @zotlit/notes

The notes in Obsidian: Literature Notes and their creation, update and switch of Profile (`NoteFeature`), the note import of Zotero notes and annotations, Literature Note Profiles with their dialogs and Profile selection, the Templates (the Template service, template data, the template conversion), and batch runs with their modal. The desktop plugin composes it. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`, "Notes", "Templates" and "Note content").

The package imports `@zotlit/annotations` and `@zotlit/citations` for the ports they declare, and fills them:

- `AnnotationNoteActions` of `@zotlit/annotations`: `desktop/note-feature/view-actions.ts`.
- `CitationTemplate` and `CitekeyNoteActions` of `@zotlit/citations`: `desktop/note-feature/citation-template.ts` and `citekey-actions.ts`.
- `ProfileStyles` of `@zotlit/citations`: `obsidian/profile/profile-styles.ts`.

A capability of a unit outside the package comes in as a port that the host fills:

- `ItemMatchQuery` (`core/profile-selection/item-matches.ts`) tests Profile Matches through ZotLit Query; `@zotlit/query-views` fills it (`desktop/item-query/item-matches.ts`).
- `TemplateWorkbenchLauncher` (`obsidian/template/workbench-launcher.ts`) opens a Template Document in the Template Workbench View; `@zotlit/template-workbench` fills it (`desktop/view/open.ts`).
- `layerProfile` takes the Profile document revision (`ProfileRevision`, a hash of the source) as a parameter; the desktop host passes `@zotlit/obsidian-desktop/profile-revision.ts`.

No feature package imports this one; `@zotlit/template-workbench` builds on it.

## Layers

Each layer has one folder of `src/` and one lint boundary (`oxlint.config.ts`). A file sits in the layer of what it needs from its host; a layer imports the layers below it: core ← obsidian ← desktop.

- `core/` — host-free: no Node built-in, `obsidian`, `electron`, Obsidian kit, or client and desktop layers of the other plugin packages. The note filename and frontmatter rules, the note import's Markdown conversion and marks, the template defaults, errors and paths, the template and note import settings slices, and the Item Match port.
- `obsidian/` — loads on Obsidian Mobile: the Obsidian API, the kit, the client and Obsidian layers of the other plugin packages, and no Node or Electron. The Profile service, its bindings, atoms and settings slice, the Profile picker and the Profile modals that need no note preview, Profile selection, the Template service and its atoms, the template workbench recovery and launch port, and the batch run.
- `desktop/` — Node and Electron: the Note Feature and the note import, which read Excerpt Images and Attachment Import; template data and the annotation render, which link files on disk; the template conversion; the Profile dialogs, which read the system file dialog; and the batch modal, which shows the Note Feature's results.
- `__fixtures__/` — test support, one folder or file per unit. `settings.ts`, `view-atoms.ts` and `service-stubs.ts` hold this package's own slices, view services and service stubs; the Template Workbench's tests read them too.

Each unit registers itself: a service tag adds itself to `ViewServiceRegistry`, each settings slice (`core/template/settings.ts`, `core/note-import/settings.ts`, `obsidian/profile/settings.ts`) adds its keys to `SettingsRegistry`, and `obsidian/template/workbench-recovery.ts` declares the `zotlit:open-template-workbench` workspace event it raises. The host composes the slices into its settings definition.

## Module resolution

The package exports its TypeScript source as `@zotlit/notes/<layer>/<unit>/<file>.ts`. Inside the package, import a file of the same folder by a relative path and any other file through the `#` subpath (`#obsidian/profile/service.ts`), with its extension.

## Tests

`pnpm exec vitest run src/<layer>/<unit>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`. A test that runs Profile selection over the host's ZotLit Query service, or the citations over the host's settings, stays in the app (`apps/obsidian/src/services/notes/`, `src/services/citations/`).

## Feature

`src/desktop/feature.ts` exports `notes`, the package's contribution to a host: its service groups, registrations, settings slices, setting tab entries and start-up hook (`packages/plugin-shell/AGENTS.md` → A feature). Add a service, a registration or a settings page there. It fills the `AnnotationNoteActions` and `CitekeyNoteActions` ports, and registers the Citation Suggester, which reads the notes. The template workbench fills its `TemplateWorkbenchLauncher` port, the query views its `ItemMatchQuery` port, and the library view its `TemplateMigrationPrompt` port.
