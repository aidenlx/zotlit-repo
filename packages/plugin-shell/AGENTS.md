# @zotlit/plugin-shell

The plugin shell: the plugin class a host extends, its lifecycle, the runtime, start-up failure handling, the setting tab shell, and the platform services as a feature. A host (`apps/obsidian`) gives the shell a list of features and a host declaration; the shell derives the Layer graph, the settings definition, the setting tab and the registrations from them.

## Layout

- `src/core/` — no Obsidian, no Node: the build order of service groups (`graph.ts`), the start-up failure that names a layer (`startup-failure.ts`), and the interrupted start-up release key (`release-key.ts`).
- `src/obsidian/` — Obsidian, no Node (lint bans `@effect/platform-node` here):
  - `feature.ts` — `defineFeature`, `serviceGroup`, `registration`, `protocolHandler`, and the `Feature` value.
  - `compose.ts` — `defineHost` (with the type check of missing services; a host declaration requires `languagePack`, the Language Pack identity: catalog, runtime, storage namespace, publish repository), `settingsDefinitionOf`, `featureServices`, `pluginGraph`, `serviceOrder`.
  - `base.ts` — the shell base every group reads without naming it (`ShellBase`): settings, logging, the Obsidian capability tags, `PluginHost`, `LanguagePack`, `GraphBuilt`.
  - `entry.ts` — `shellEntry(load, when)`, the plugin class Obsidian loads: it imports no Effect and no feature code, and starts the body that `load` gives inside `onload` (`"onload"`) or once the layout is ready (`"layout-ready"`).
  - `runtime.ts`, `plugin.ts`, `lifecycle.ts`, `late-release.ts`, `startup-notice.ts` — the runtime, the body's start and unload (`shellStart(host, { preflight })`) with the class of a host that starts inside `onload` (`shellPlugin(host)`), the unload-aware base class, and the late-release warning.
  - `setting-tab/` — the tab shell (`tab.ts`), its layer (`layer.ts`) and the declarative control store (`controls.ts`).
  - `platform-base.ts` — the `platformBase` feature, Zotero-free, which every host composes: the log settings slice, the Language Pack notices, the Advanced page (`setting-pages/advanced.ts`) with the logging rows and the Language Pack reset, the log level codec and the Language Pack rebuild stream. A host without `platform` fills `FileSystem` itself (the Reader: `@zotlit/obsidian-kit/vault-file-system.ts`).
  - `platform.ts` — the `platform` feature, `extendFeature(platformBase, …)` for a ZotLit host: the Zotero services (settings slices, Item Lookup, Library Scope, the Zotero Local API, the note index), the Zotero page (`setting-pages/zotero.ts`) and the Local Server group in the Advanced page's `advanced.local-server` slot. The pages' slots are what the features fill.
  - `protocol.ts` — the registration of every feature's `obsidian://` handlers. The checks every link shares (parsing, source id, database ready, item) and the shared outcomes and notices live in `@zotlit/plugin-services/obsidian/protocol/`.
- `src/desktop/platform.ts` — the `desktopPlatform` feature: the Node-backed capabilities (file system, Zotero preferences, Zotero HTTP, the local server, attachment import).

## A feature

A feature package exports a Node-free value from `src/obsidian/feature.ts`, made with `defineFeature`, and a desktop value from `src/desktop/feature.ts`, made with `extendFeature(obsidianValue, parts)`. Each value holds the parts whose code is in its layer; an `obsidian/feature.ts` imports no `desktop/` file. A host lists one value per feature: the desktop host the desktop value, a Node-free host the Obsidian value. `extendFeature` puts the base's parts first, concatenates a slot both fill, merges the handles (`handlesOf(base)` reads the extended feature's handles) and the menus, and throws on a setting entry both give. A feature's parts:

- `services` — one `serviceGroup(name, { provides, requires }, layer)` per layer. `requires` lists every tag the layer reads that the shell base does not give; a read you leave out fails the type check, and the error names it under `"~unlisted"`.
- `registrations` — layers that provide nothing: commands, CLI handlers, notices.
- `settings` — the settings slices the feature owns.
- `settingTab` — `entries` (pages or top-level items by id), `slots` (rows for a slot another feature's page holds), `rebuild` streams, and `controls` codecs.
- `protocol` — `obsidian://` handlers, one `protocolHandler(action, handle)` per action, owned by the feature the action acts on. A handler shows its own notice and returns its outcome; it may read the registration's `Scope.Scope` for work that outlives its run.
- `handles` — the values the debug surface and the End-to-end Run read. Another feature's start-up hook reads them through `ctx.handlesOf(feature)`.
- `onload` — registers what is not a layer yet (views, editor suggests, ribbon icons), and answers the feature's file menu and folder menu segments by id.

A cross-feature port is a tag: the reading feature owns the tag and lists it in `requires`; the feature that can fill it provides a group for it. The host declaration fails to type-check while any port is left open, and its error lists each one under `missingServices`.

## The order things start

- Service groups build in the topological order of their tags (`core/graph.ts`), with ties in host feature order and declaration order. `serviceOrder(features)` prints it.
- Registrations, handles and start-up hooks run in host feature order, and in declaration order inside each feature.
- The file menu, the folder menu and the setting tab follow the host's lists, not feature order.
- The body of a `"layout-ready"` host (desktop ZotLit) starts once Obsidian's layout is ready on a start of the app, and inside `onload` when the plugin is turned on while the app runs. The body of an `"onload"` host (the Reader) starts inside `onload`.

## Settings registry

`@zotlit/plugin-services/core/settings/schema.ts` holds the slice of `platformBase` in `SettingsRegistry`; each other slice adds itself beside its owner by declaration merging. A host checks its composed settings against the registry of its own program (`Equals<ComposedSettings<typeof features>, Settings>`), so a slice of a feature the host does not compose fails the check when its module enters the host's program. A module that reads a key and imports nothing from its slice imports the slice as a type (`import type {} from "<slice>"`), so the key exists in every program that reads it.

## Tests

`packages/annotations/src/desktop/reader-host.test.ts` is the second host: the platform, the annotations and stub capabilities. `apps/obsidian/src/mobile-host.test.ts` is the third: the platform and every feature's Obsidian value over stub ports (`apps/obsidian/src/__fixtures__/mobile-host/`). Both build through `featureServices`, the same path the plugin graph uses. `src/obsidian/platform-base.test.ts` builds `platformBase` and a `FileSystem` group with no Zotero service; `apps/reader/src/host.test.ts` is the Reader on it.
