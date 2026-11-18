# @zotlit/plugin-shell

The plugin shell: the plugin class a host extends, its lifecycle, the runtime, start-up failure handling, the setting tab shell, and the platform services as a feature. A host (`apps/obsidian`) gives the shell a list of features and a host declaration; the shell derives the Layer graph, the settings definition, the setting tab and the registrations from them.

## Layout

- `src/core/` — no Obsidian, no Node: the build order of service groups (`graph.ts`), the start-up failure that names a layer (`startup-failure.ts`), and the interrupted start-up release key (`release-key.ts`).
- `src/obsidian/` — Obsidian, no Node (lint bans `@effect/platform-node` here):
  - `feature.ts` — `defineFeature`, `serviceGroup`, `registration`, `protocolHandler`, and the `Feature` value.
  - `compose.ts` — `defineHost` (with the type check of missing services), `settingsDefinitionOf`, `featureServices`, `pluginGraph`, `serviceOrder`.
  - `base.ts` — the shell base every group reads without naming it (`ShellBase`): settings, logging, the Obsidian capability tags, `PluginHost`, `LanguagePack`, `GraphBuilt`.
  - `runtime.ts`, `plugin.ts`, `lifecycle.ts`, `startup-notice.ts` — the runtime, the plugin class (`shellPlugin(host)`), and unload.
  - `setting-tab/` — the tab shell (`tab.ts`), its layer (`layer.ts`) and the declarative control store (`controls.ts`).
  - `platform.ts` — the `platform` feature: the services every host needs (settings slices, Item Lookup, Library Scope, the Zotero Local API, the note index), and the Zotero and Advanced pages (`setting-pages/`), whose slots the features fill.
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

## Tests

`packages/annotations/src/desktop/reader-host.test.ts` is the second host: the platform, the annotations and stub capabilities. `apps/obsidian/src/mobile-host.test.ts` is the third: the platform and every feature's Obsidian value over stub ports (`apps/obsidian/src/__fixtures__/mobile-host/`). Both build through `featureServices`, the same path the plugin graph uses.
