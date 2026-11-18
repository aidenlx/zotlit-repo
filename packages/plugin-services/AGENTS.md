# @zotlit/plugin-services

The platform services that the features of every ZotLit Obsidian plugin (desktop, Reader, Mobile) stand on: the plugin settings, logging, the Language Pack, the Zotero preferences, the Local Server and the Zotero Local API, the database actions, the Held Read client (`QueryClients`), Library Scope, the item search (`ItemLookup`), the Note Index, the Use Ledger, the Managed Binaries and the Chinese Segmenter, and the attachment resolver and Attachment Import. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`).

A feature (reader and annotations, citations, notes and templates, the library and query views) and its UI stay in the host app until their own package exists. This package imports no feature.

## Layers

Each layer has one folder of `src/` and one lint boundary (`oxlint.config.ts`). A file sits in the layer of what it needs from its host; a layer imports the layers below it: core ← obsidian ← desktop.

- `core/` — host-free: no Node built-in, `obsidian`, `electron`, Obsidian kit, or client and desktop layer of ZoteroReads. A Web Worker loads it (the Chinese Segmenter's OPFS read, the Managed Binary store). It holds the settings mechanism (`settings/slice.ts`, `settings/schema.ts`) and the settings slices of this package, the tags of the services a desktop host builds (`zotero-pref/service.ts`, `local-server/service.ts`), the Held Read client, and pure helpers.
- `obsidian/` — loads on Obsidian Mobile: the Obsidian API, the Obsidian kit and the ZoteroReads client, and no Node or Electron. The services and their atoms, notices, CLI commands and menus.
- `desktop/` — the desktop host's services over Node: the Zotero preferences read from `prefs.js` (`zotero-pref/layer.ts`), the Local Server's listener (`local-server/layer.ts`), and Attachment Import. Only a desktop host imports it.
- `__fixtures__/` — test support for this package and its consumers. `platform-settings.ts` and `view-atoms.ts` hold this package's own slices and view services only, so only this package's tests import them.

## Settings

The settings are one flat key→value map, built from slices. A slice (`settingsSlice` in `core/settings/slice.ts`) holds the keys one owner keeps, their schemas and their defaults, and lives beside its owner. The type of every key comes from `SettingsRegistry` (`core/settings/schema.ts`): this package registers its own slices there, and a host registers the slices of its features by declaration merging (`apps/obsidian/src/typings/settings.d.ts`). The host composes the same slices into the `SettingsDefinition` that it gives `PluginSettings`, with the migrations of its `data.json` history (`apps/obsidian/src/services/settings/`). A feature adds a key to its own slice; it never adds one here.

## Module resolution

The package exports its TypeScript source as `@zotlit/plugin-services/<layer>/<service>/<file>.ts`. Inside the package, import a file of the same folder by a relative path and any other file through the `#` subpath (`#core/settings/schema.ts`), with its extension.

## Tests

`pnpm exec vitest run src/<layer>/<service>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`. A suite that needs the settings store takes `platformSettings` from `src/__fixtures__/platform-settings.ts`; a fixture that a host's tests also use takes the definition from its caller. `pnpm --filter @zotlit/plugin-services bench` runs the benchmarks.
