# @zotlit/plugin-services

The platform services for ZotLit features and the shared services used by ZotLit Reader: the plugin settings, logging, the Language Pack, the Zotero preferences, the Local Server and the Zotero Local API, the database actions, the Held Read client (`QueryClients`), Library Scope, the item search (`ItemLookup`), the Note Index, the Use Ledger, the Managed Binaries and the Chinese Segmenter, and the attachment resolver and Attachment Import. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`).

This package imports no feature: the features (`@zotlit/annotations`, `@zotlit/citations`, `@zotlit/notes`, `@zotlit/template-workbench`, `@zotlit/query-views`, `@zotlit/library-view`) build on it.

It also holds the setting tab's seam to Effect (`obsidian/setting-tab/effect-tab.ts`, `context.ts`), which every owner's settings rows run through, and the rows of its own services beside them (for example `desktop/database/settings-rows.ts`). `SettingTabServiceRegistry` in `effect-tab.ts` is open: each row's file adds the services it reads by declaration merging.

## Layers

Each layer has one folder of `src/` and one lint boundary (`oxlint.config.ts`). A file sits in the layer of what it needs from its host; a layer imports the layers below it: core ← obsidian ← desktop.

- `core/` — host-free: no Node built-in, `obsidian`, `electron`, Obsidian kit, or client and desktop layer of ZoteroReads. A Web Worker loads it (the Chinese Segmenter's read of its Pack Entry, `chinese-segmenter/pack-reader.ts`). It holds the settings mechanism (`settings/slice.ts`, `settings/schema.ts`) and the settings slices of this package, the tags of the services a desktop host builds (`zotero-pref/service.ts`, `local-server/service.ts`), the Held Read client, and pure helpers.
- `obsidian/` — loads on Obsidian Mobile: the Obsidian API, the Obsidian kit and the ZoteroReads client, and no Node or Electron. The services and their atoms, notices, CLI commands and menus.
- `desktop/` — the desktop host's services over Node: the Zotero preferences read from `prefs.js` (`zotero-pref/layer.ts`), the Local Server's listener (`local-server/layer.ts`), and Attachment Import. Only a desktop host imports it.
- `__fixtures__/` — test support for this package and its consumers. `platform-settings.ts`, `view-atoms.ts` and `setting-tab.ts` hold this package's own slices, view services and tab only, so only this package's tests import them. `setting-tab-harness.ts` binds the tab helpers to the unimplemented services of a program, and `setting-tab-services.ts` holds the platform's part of them; each package's own `__fixtures__/setting-tab.ts` binds the two.

## Settings

The settings are one flat key→value map, built from slices. A slice (`settingsSlice` in `core/settings/slice.ts`) holds the keys one owner keeps, their schemas and their defaults, and lives beside its owner. The type of every key comes from `SettingsRegistry` (`core/settings/schema.ts`): its base holds the log slice, which every host keeps, and each other slice, this package's and each feature's, registers itself by declaration merging in its own file. A key exists only in a program that holds its slice, so a module that reads a key and imports nothing from its slice imports it as a type: `import type {} from "#core/attachment-import/settings.ts";`. The host composes the same slices into the `SettingsDefinition` that it gives `PluginSettings`, with the migrations of its `data.json` history (`apps/obsidian/src/services/settings/`). A feature adds a key to its own slice; it never adds one here.

## Tests

From this package directory, `pnpm exec vitest run src/<layer>/<service>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`. A suite that needs the settings store takes `platformSettings` from `src/__fixtures__/platform-settings.ts`; a fixture that a host's tests also use takes the definition from its caller. `pnpm --filter @zotlit/plugin-services bench` runs the benchmarks.
