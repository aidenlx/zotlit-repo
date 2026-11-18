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

## Update: pages, handlers and Node-free values (2026-11-19)

The first version of this decision left the setting pages that name several features and the `obsidian://` handlers in the app, as one host feature. They now have owners, and each feature has a value for a host without Node.

- **Two values per feature.** A feature package exports a Node-free value (`src/obsidian/feature.ts`, `defineFeature`) and a desktop value (`src/desktop/feature.ts`, `extendFeature(base, parts)`). A host lists one of them. `extendFeature` keeps the base's parts first, concatenates a slot both fill, merges handles and menus; `handlesOf(base)` reads the extended feature's handles. Chosen over listing two values side by side: the host keeps one entry per feature, so `defineHost`'s missing-port check, registration order and handle lookup see one feature, and a host cannot list the desktop half without its base.
- **Every page has an owner.** A page that shows rows of several features belongs to one of them and holds slots; the owner exports the slot ids as a constant so a filler's program reads their declaration. The Zotero and Advanced pages belong to the platform (`plugin-shell/src/obsidian/setting-pages/`).
- **Every `obsidian://` action has an owner.** Each is a `protocolHandler` of the feature it acts on; the shared checks, outcomes and notices live in `@zotlit/plugin-services/obsidian/protocol/`. A handler may read the registration's Scope.

Consequences:

- The app holds no page and no handler. A Node-free host (`apps/obsidian/src/__fixtures__/mobile-host/`) composes the platform and every Obsidian value over 18 stub ports; `tsconfig.mobile.json` and `scripts/check-mobile-host.ts` check it in `typecheck`. The check proves the composition's ports and that its program reads no desktop file; it does not prove the absence of Node globals, because liquidjs's and undici's typings load `@types/node` into every program.
- Service ties now break base-first inside a feature: AnnotationRepository builds before ExcerptPreparation/ExcerptDisplays, GraphCitations before AnnotationPopover (independent groups).
