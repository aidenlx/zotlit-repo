# @zotlit/library-view

The Library View and the views that start from it: the Library View with its rows, row menu and search, the Welcome View with its onboarding steps, the Release check with its update and migration notices, and the quick switcher. The desktop plugin composes it. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`, "Library view", "Recency" and "Releases and onboarding").

The Library View is a Query View: the package builds on `@zotlit/query-views` for its layout, the Query Job runs and Query Files, and on `@zotlit/annotations` and `@zotlit/notes` for attachment opens and note creation. No package imports this one.

## Layers

Each layer has one folder of `src/` and one lint boundary (`oxlint.config.ts`). A file sits in the layer of what it needs from its host; a layer imports the layers below it: core ← obsidian ← desktop.

- `core/` — host-free: the Library View's, the Welcome View's and the Release check's settings slices and their pure rules.
- `obsidian/` — loads on Obsidian Mobile: the Release service and its notices, the Library View's storage and search state, the Welcome View's settings atom.
- `desktop/` — Node and Electron: the Library View and the quick switcher, which run Query Jobs through the desktop layer of `@zotlit/query-views` and open attachments and notes through the desktop layers of `@zotlit/annotations` and `@zotlit/notes`; the Welcome View, which reads the Zotero data folder and the template migration on disk.
- `__fixtures__/` — test support, one folder or file per unit. `settings.ts` and `view-atoms.ts` hold this package's slices and view services.

Each unit registers itself: the settings slices (`core/library/settings.ts`, `core/welcome/settings.ts`, `core/release/settings.ts`) add their keys to `SettingsRegistry`, `Release` (`obsidian/release/service.ts`) and `QueryClients` (`desktop/welcome/connection.ts`) add themselves to `ViewServiceRegistry`, and `desktop/library/row-menu.ts` declares the `zotlit:item-menu` menu event. The host composes the slices into its settings definition.

## Module resolution

The package exports its TypeScript source as `@zotlit/library-view/<layer>/<unit>/<file>.ts`. Inside the package, import a file of the same folder by a relative path and any other file through the `#` subpath (`#desktop/library/view.tsx`), with its extension. The brand logo comes from `assets/logo/` through the `@brand/*` path.

## Tests

`pnpm exec vitest run src/<layer>/<unit>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`.

## Feature

`src/desktop/feature.ts` exports `libraryView`, the package's contribution to a host: its service groups, registrations, settings slices, setting tab entries and start-up hook (`packages/plugin-shell/AGENTS.md` → A feature). Add a service, a registration or a settings page there. It fills the obsidian kit's `ShowInLibrary` port and the notes' `TemplateMigrationPrompt` port.
