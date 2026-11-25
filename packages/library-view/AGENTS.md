# @zotlit/library-view

The Library View and the views that start from it: the Library View with its rows, row menu and search, the Welcome View with its onboarding steps, the Release check with its update and migration notices, and the quick switcher. The desktop plugin composes it. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`, "Library view", "Recency" and "Releases and onboarding").

The Library View is a Query View: the package builds on `@zotlit/query-views` for its layout, the Query Job runs and Query Files, and on `@zotlit/annotations` and `@zotlit/notes` for attachment opens and note creation. No package imports this one.

## Layers

Each layer is one folder of `src/` and one runtime zone ([ADR 0117](../../docs/adr/0117-runtime-zones-are-checked-by-the-module-graph.md)). A new file goes in the folder of what it needs from its host: `core/` is the host-free zone (the DOM, no host module), `obsidian/` the Obsidian zone (the `obsidian` module; it loads on Obsidian Mobile), and `desktop/` the desktop zone (Node and Electron). A layer reaches the layers below it: core ← obsidian ← desktop. The runtime check (`pnpm run lint:runtime-zones`) follows each import, type-only imports included, and fails on reach to a higher zone or to test support. Lint refuses Node built-in imports and the Node globals outside `desktop/`.

- `core/` — host-free: the Library View's, the Welcome View's and the Release check's settings slices and their pure rules.
- `obsidian/` — loads on Obsidian Mobile: the Release service and its notices, the Library View's storage and search state, the Welcome View's settings atom.
- `desktop/` — Node and Electron: the Library View and the quick switcher, which run Query Jobs through the desktop layer of `@zotlit/query-views` and open attachments and notes through the desktop layers of `@zotlit/annotations` and `@zotlit/notes`; the Welcome View, which reads the Zotero data folder and the template migration on disk.
- `__fixtures__/` — test support, one folder or file per unit. `settings.ts` and `view-atoms.ts` hold this package's slices and view services.

Each unit registers itself: the settings slices (`core/library/settings.ts`, `core/welcome/settings.ts`, `core/release/settings.ts`) add their keys to `SettingsRegistry`, `Release` (`obsidian/release/service.ts`) and `QueryClients` (`desktop/welcome/connection.ts`) add themselves to `ViewServiceRegistry`, and `desktop/library/row-menu.ts` declares the `zotlit:item-menu` menu event. The host composes the slices into its settings definition.

## Build integration

The brand logo comes from `assets/logo/` through the `@brand/*` alias.

## Tests

From this package directory, `pnpm exec vitest run src/<layer>/<unit>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`.

## Feature

`src/obsidian/feature.ts` exports `libraryView`, the part of the package's contribution that loads on every Obsidian: the service groups, registrations, settings slices, setting rows and `obsidian://` handlers whose code is in `core/` and `obsidian/`. `src/desktop/feature.ts` extends it (`extendFeature`) with the desktop parts, and a desktop host lists that value (`packages/plugin-shell/AGENTS.md` → A feature). Add a service, a registration, a settings page or a link to the value of the layer its code is in. It fills the obsidian kit's `ShowInLibrary` port and the notes' `TemplateMigrationPrompt` port.
