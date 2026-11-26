# @zotlit/notes

The notes in Obsidian: Literature Notes and their creation, update and switch of Profile (`NoteFeature`), the note import of Zotero notes and annotations, Literature Note Profiles with their dialogs and Profile selection, the Templates (the Template service, template data, the template conversion), and batch runs with their modal. The desktop plugin composes it. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`, "Notes", "Templates" and "Note content").

The package imports `@zotlit/annotations` and `@zotlit/citations` for the ports they declare, and fills them:

- `AnnotationNoteActions` of `@zotlit/annotations`: `desktop/note-feature/view-actions.ts`.
- `CitationTemplate` and `CitekeyNoteActions` of `@zotlit/citations`: `desktop/note-feature/citation-template.ts` and `citekey-actions.ts`.
- `ProfileStyles` of `@zotlit/citations`: `obsidian/profile/profile-styles.ts`.

A capability of a unit outside the package comes in as a port that the host fills:

- `ItemMatchQuery` (`core/profile-selection/item-matches.ts`) tests Profile Matches through ZotLit Query; `@zotlit/query-views` fills it (`desktop/item-query/item-matches.ts`). Its reader, `obsidian/profile-selection/select.ts`, adds it to `ViewServiceRegistry`, because the registry is an Obsidian kit module.
- `TemplateWorkbenchLauncher` (`obsidian/template/workbench-launcher.ts`) opens a Template Document in the Template Workbench View; `@zotlit/template-workbench` fills it (`desktop/view/open.ts`).
- `layerProfile` takes the Profile document revision (`ProfileRevision`, a hash of the source) as a parameter; the desktop host passes `@zotlit/obsidian-desktop/profile-revision.ts`.

The Template Workbench, Query Views and Library View build on this package. Cross-feature services that notes consumes stay behind the ports above.

## Layers

Each layer is one folder of `src/` and one runtime zone ([ADR 0117](../../docs/adr/0117-runtime-zones-are-checked-by-the-module-graph.md)). A new file goes in the folder of what it needs from its host: `core/` is the host-free zone (the DOM, no host module), `obsidian/` the Obsidian zone (the `obsidian` module; it loads on Obsidian Mobile), and `desktop/` the desktop zone (Node and Electron). A layer reaches the layers below it: core ← obsidian ← desktop. The runtime check (`pnpm run lint:runtime-zones`) follows each import, type-only imports included, and fails on reach to a higher zone or to test support. Lint refuses Node built-in imports and the Node globals outside `desktop/`.

- `core/` — host-free: no Node built-in, `obsidian`, `electron`, Obsidian kit, or client and desktop layers of the other plugin packages. The note filename and frontmatter rules, the note import's Markdown conversion and marks, the template defaults, errors and paths, the render diagnostics and reports and the side-effect-free note resolvers (`core/template/`), the built-in data of the template previews — Sample Items, Sample Annotations, Citation examples and Shared Partial contexts (`core/template-preview/`) — the template and note import settings slices, and the Item Match port.
- `obsidian/` — loads on Obsidian Mobile: the Obsidian API, the kit, the client and Obsidian layers of the other plugin packages, and no Node or Electron. The Profile service, its bindings, atoms and settings slice, the Profile picker and the Profile modals that need no note preview, Profile selection, the Template service and its atoms, the template workbench recovery and launch port, and the batch run.
- `desktop/` — Node and Electron: the Note Feature and the note import, which read Excerpt Images and Attachment Import; template data and the annotation render, which link files on disk; the template conversion; the Profile dialogs, which read the system file dialog; and the batch modal, which shows the Note Feature's results.
- `__fixtures__/` — test support, one folder or file per unit. `settings.ts`, `view-atoms.ts` and `service-stubs.ts` hold this package's own slices, view services and service stubs; the Template Workbench's tests read them too.

Each unit registers itself: a service tag adds itself to `ViewServiceRegistry`, each settings slice (`core/template/settings.ts`, `core/note-import/settings.ts`, `obsidian/profile/settings.ts`) adds its keys to `SettingsRegistry`, and `obsidian/template/workbench-recovery.ts` declares the `zotlit:open-template-workbench` workspace event it raises. The host composes the slices into its settings definition.

## Tests

From this package directory, `pnpm exec vitest run src/<layer>/<unit>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`. A test that runs Profile selection over the host's ZotLit Query service, or the citations over the host's settings, stays in the app (`apps/obsidian/src/services/notes/`, `src/services/citations/`).

## Feature

`src/obsidian/feature.ts` exports `notes`, the part of the package's contribution that loads on every Obsidian: the service groups, registrations, settings slices, setting rows and `obsidian://` handlers whose code is in `core/` and `obsidian/`. `src/desktop/feature.ts` extends it (`extendFeature`) with the desktop parts, and a desktop host lists that value (`packages/plugin-shell/AGENTS.md` → A feature). Add a service, a registration, a settings page or a link to the value of the layer its code is in. It fills the `AnnotationNoteActions` and `CitekeyNoteActions` ports, and registers the Citation Suggester, which reads the notes. The template workbench fills its `TemplateWorkbenchLauncher` port, the query views its `ItemMatchQuery` port, and the library view its `TemplateMigrationPrompt` port.
