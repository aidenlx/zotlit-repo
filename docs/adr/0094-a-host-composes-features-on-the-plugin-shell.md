---
status: accepted
---

# A host composes features on the plugin shell

## Context

After ADR 0093 every feature lives in a package, but `apps/obsidian` still wrote the composition by hand: the Layer graph and its build strata (`services/plugin-layer.ts`), the handles (`services/plugin-runtime.ts`), the plugin class with every view, menu, suggest and ribbon registration (`zt-main.ts`), and the tab shell with its page order (`setting-tab/index.ts`). A feature that added a service changed three or four host files. ZotLit Reader and ZotLit Mobile would each copy all of it.

## Decision

- **A shell package.** `@zotlit/plugin-shell` owns the plugin class (`shellPlugin(host)`), the lifecycle and the interrupted start-up release, the runtime, start-up failure handling, the setting tab shell, and the platform services as two features (`platform`, `desktopPlatform`). Its `core/` and `obsidian/` layers read no Node.
- **One value per feature.** Each feature package exports one `defineFeature` value: service groups (the tags each layer fills and reads), registrations, settings slices, setting tab entries and slots, rebuild streams, control codecs, protocol handlers, handles, and a start-up hook that answers its menu segments.
- **The shell derives the rest.** The build order comes from the tags (a stable topological sort). The settings definition comes from the slices. The tab places entries by the host's page order. A page that shows rows of several features holds a slot that those features fill.
- **Open ports fail the build.** A group that reads a tag it does not list fails to type-check. A host whose features read a tag that none of them fills fails to type-check, and the error names each tag. A cross-feature function becomes a tag that the reading package owns.
- **The host declares what differs.** The app keeps the feature list, the tab and menu orders, the settings history (`data.json` migrations), the Worker-backed capabilities, the plugin class's preflight, the build config and the host tests.
- **One list of plugin packages.** Vite, Vitest and ESLint read the list from `@zotlit/scripts/plugin-packages`, which follows the host's dependencies. `lint:plugin-packages` checks the two static copies (Tailwind `@source`, the turbo review inputs).

## Consequences

- A new service is one `serviceGroup` in its owner's feature. A new feature is one entry in `features.ts` plus its tab and menu ids in `host.ts`.
- The service start order is now derived from the tags, not the hand-written strata. Registrations run in feature order. Menu rows, tab pages and editor-suggest order stay as the host declares them.
- A second host composes the platform and the features it needs, and supplies the ports they leave open. The annotations test fixture `reader-host.ts` is that composition for a reader, with stubs: ZoteroReads, FileSystem, ZoteroPref, ZoteroHttp, LocalServer, AnnotationNoteActions, AnnotationViewReveal, PdfTargetReader and ShowInLibrary.
- The app still holds the setting pages that name several features and the `obsidian://` handlers, as one host feature, until each moves to an owner.
