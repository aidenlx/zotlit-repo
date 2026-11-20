# @zotlit/obsidian

The Obsidian plugin. Its shared base lives in packages, which the app imports by name:

- `@zotlit/plugin-kernel` — host-free helpers: the Effect wrappers, log, bridge, stream and scope helpers, pure utilities, shared constants (`constants.ts`).
- `@zotlit/obsidian-kit` — code over the `obsidian` API that loads on Obsidian Mobile: the capability tags (`obsidian-*.ts`), shared components (`components/`), view atoms and runners, notices, the Obsidian test mock.
- `@zotlit/obsidian-desktop` — code that needs `node:*` or `electron`.
- `@zotlit/plugin-messages` — the generated Message facade.
- `@zotlit/plugin-services` — the platform services the features stand on: settings, logging, the Language Pack, the Zotero preferences, the Local Server and Zotero Local API, the Held Read client, Library Scope, item search, the Note Index, the Use Ledger, Managed Binaries, attachments.
- `@zotlit/plugin-shell` — the plugin shell: the plugin class, the lifecycle, the runtime, start-up failure handling, the setting tab shell, and the platform services as the `platform` and `desktopPlatform` features. It derives the Layer graph, the settings definition, the tab and the registrations from the features ([its AGENTS.md](../../packages/plugin-shell/AGENTS.md)).
- `@zotlit/annotations` — reading and annotating: the Annotation Repository and the annotation model, the surfaces in the ZotLit PDF Reader (Annotation Marks, the Mark Popup, the Creation Toolbar), Excerpt Images, the Annotation View's cards and Annotations Layout, Reader Sessions and Open Targets.
- `@zotlit/citations` — citations: the Citation Index and citation parsing, the Citation Suggester, the Document Citation Text, citekey navigation, the Citation and Annotation Popovers, Graph Citations, the References Sidebar and the Cited By Sidebar, the Citation Presentation, and the Pandoc Engine with Pandoc export. The app keeps the citation parse Worker entry (`src/services/citation-parse/worker.ts`) and the tests that read the notes feature's Profiles (`src/services/citations/`).
- `@zotlit/notes` — the notes: Literature Notes and the Note Feature, the note import, the Profiles with their dialogs and picker, Profile selection, the Templates with template data and the template conversion, and the batch runs. It fills the ports of `@zotlit/annotations` and `@zotlit/citations`. `@zotlit/query-views` fills its `ItemMatchQuery` port; the app keeps the tests that run Profile selection over ZotLit Query (`src/services/notes/`).
- `@zotlit/template-workbench` — the Template Workbench: its View and the Obsidian host of the Workbench editor, the Template Data Explorer, the Template Workbench CLI, and the Local Bridge with Customize. It fills the notes' `TemplateWorkbenchLauncher` port. The app keeps the tests that run the Match tab over ZotLit Query (`src/services/template-workbench/`).
- `@zotlit/query-views` — ZotLit Query in Obsidian: the Item Query adapter (`QueryService`, the `zotlit:query` CLI), the Query View, the sidebar Annotation View, the Annotation Suggester and the PDF view's note button.
- `@zotlit/library-view` — the Library View, the Welcome View, the Release check and the quick switcher.
- `@zotlit/zotero-reads` — ZoteroReads: its contract, the Worker's handlers, the renderer's client, and the desktop database source. The app keeps the host side: the Worker entry (`src/services/zotero-reads/worker.ts`) and the client's wiring to settings (`worker-client.ts`).

The app is the first host: it declares what differs per host, and the shell does the rest. It holds:

- `src/features.ts` — the feature list, in the order registrations and start-up hooks run.
- `src/host.ts` — the host declaration: the setting tab's page order, the file and folder menu order, and the settings history (`withHost`, the `data.json` migrations in `src/services/settings/`).
- `src/capabilities.ts` — the Worker-backed capabilities (ZoteroReads, citation parsing) over the Worker entries.
- `src/zt-main.ts` — the plugin class: `shellPlugin(host)` with the Electron preflight and the installer notice.
- `src/__fixtures__/mobile-host/` — a Node-free host: the platform and every feature's Obsidian value over stub ports. `tsconfig.mobile.json` type-checks it without the desktop files, `scripts/check-mobile-host.ts` fails when its program reads a desktop file (both run in `typecheck`), and `src/mobile-host.test.ts` builds its services.
- The build config and the host tests that run several packages together.

No package imports the app; each service and settings slice registers itself in the open registries (`ViewServiceRegistry`, `SettingsRegistry`, `SettingTabServiceRegistry`, `SettingTabSlots`) by declaration merging. To add a service or a feature, run `/obsidian-services`; to add a setting or a settings page, run `/obsidian-settings`.

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/obsidian dev` — Vite watch build.
- `I18N_DEV_SERVER=true pnpm --filter @zotlit/obsidian dev` — the Language Pack source for a dev build in any non-English locale: serves the generated Language Pack JSONs at `http://127.0.0.1:9092` (or pass a port number) and points the dev build's pack download URL there. A dev build's manifest carries a Dev Build version (`2.2.0-beta.1.dev`, from `deriveDevVersion` in `@zotlit/scripts/shell/host-build`) that has no Resource Release, so without this server the pack download fails and the build stays on the bundled English pack.
- `pnpm --filter @zotlit/plugin-messages generate:language-packs` — regenerate the typed message facade and bundled English pack. Only needed when bypassing turbo; turbo `typecheck`/`test` depend on it.
- Production build (`turbo run build`): Vite writes the bundle package (its name is in `PUBLISHED_PLUGINS`, `packages/scripts/lib/shell/plugins.ts`) into `dist/package/` (unminified ES module, `styles.css`, `resources/`), then `scripts/build.mjs` of the publish repository's shell (`packages/scripts/lib/shell/templates/`) builds `dist/main.js` and `dist/styles.css` from it. A development build writes `dist-dev/main.js` directly.
- `pnpm --filter @zotlit/obsidian analyze` — production build with an interactive bundle-size report at `bundle-stats.html`. Set `ANALYZE=json` for a machine-readable `bundle-stats.json` instead.

## UI stack

Preact provides the UI runtime through `@preact/preset-vite` and its React compatibility aliases. Keep React imports and `@types/react`/`@types/react-dom` for the wider ecosystem.

Read `packages/annotations/src/obsidian/annot-view/store.ts` for view state, `packages/annotations/src/desktop/annot-view/menus.ts` and `actions.tsx` for menus, and `packages/obsidian-kit/src/menu.ts` for anchoring.

Drag to reorder: a flat list uses `packages/query-views/src/obsidian/query-view/reorder.tsx`; a Match tree or a Template Workbench list uses `packages/workbench/src/ui/reorder.ts`.

The Annotation Marks and the Creation Toolbar inside the ZotLit PDF Reader are vanilla DOM ([ADR 0042](docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md)). The Mark Popup is one Preact root on Obsidian's popover, rendered synchronously by its host ([ADR 0065](docs/adr/0065-the-mark-popup-is-one-preact-root-on-obsidians-popover.md)).

## Note feature

`packages/notes/src/desktop/note-feature/` is the `NoteFeature` Effect service (`service.ts`) over Effect functions that yield the services they read: `write-pipeline.ts` (the writes) and `creation-planning.ts` (Profile selection and creation plans). `context.ts` builds the resolvers a template render calls (`buildNoteResolvers` over `NoteResolverServices`); `operations.ts` holds `NoteFeatureHandle`, the shape callers outside Effect get from `handle.ts`. Read these before editing. Batch runners fetch shared context (item tags, note path) once and thread it through the stages, so per-item ops take already-fetched data instead of re-reading.

## Setting tab

Run `/obsidian-settings` for the declarative 1.13 `getSettingDefinitions()` API (controls, sub-pages, migration); build the tab from those definitions alone. The tab shell lives in `@zotlit/plugin-shell/obsidian/setting-tab/`, and the page order in `src/host.ts`; each page lives with the feature that owns its subject, which contributes it through its `settingTab.entries`; a page that shows rows of several features holds slots (`ctx.slot`) that the other features fill through `settingTab.slots`. Every row runs through `@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts`.

Project-specific: settings live in `PluginSettings` (`@zotlit/plugin-services/obsidian/settings/service.ts`) under flat dot-notation keys, not `plugin.settings`; the tab bridges `control` keys through `getControlValue`/`setControlValue` and the features' control codecs. A key lives in the settings slice of the feature that owns it (such as `packages/notes/src/core/note-import/settings.ts`); each slice registers itself in `SettingsRegistry`, the feature lists it in its `settings`, and `src/services/settings/schema.ts` composes them from the features (`settingsDefinitionOf`).

## Logging

Log through Effect, filed under a category with `withLogCategory` from `packages/plugin-kernel/src/effect-log.ts`. Every renderer Effect run entry point writes Effect's records to LogTape, where `layerLogging` (`packages/plugin-services/src/obsidian/log/service.ts`) owns the sinks and levels. `getLogger` from `packages/plugin-kernel/src/log.ts` is the legacy LogTape logger.

## UI text (JSON Language Packs)

Import as `import * as m from "@zotlit/plugin-messages/messages.ts"`. `packages/plugin-messages/generated/` is gitignored and regenerated on build; regenerate manually only when bypassing turbo (see Commands). CLI guide sources live beside their handlers.

When extending `packages/obsidian-kit/src/__mocks__/obsidian.ts` for code that calls `m.*` indirectly, add a `getLanguage()` stub returning your fixture locale.

Run `/i18n-ui-text` for wording style; `/inlang-i18n` for JSON format and runtime mechanics.

## CSS

**Tailwind-first.** Run `/obsidian-css` before you write a class list or a stylesheet rule.

## CLI commands

When adding or changing a `zotlit:*` command, register its Effect handler with `registerCliCommand` (`packages/obsidian-kit/src/cli-command.ts`) and decode its parameters with one Effect Schema through `packages/obsidian-kit/src/cli-params.ts`; `packages/query-views/src/desktop/item-query/decode.ts` is the pattern. The adapter's header states how Obsidian turns the caller's tokens into `CliData`.

## CLI schemas and resources

When adding or changing a CLI schema or downloadable resource, inspect `packages/template-workbench/src/core/cli/schema.ts`, [ADR 0019](../../docs/adr/0019-runtime-assets-ship-on-a-parallel-resource-release.md), and the publish repository's workflow template `packages/scripts/lib/shell/templates/.github/workflows/release.yml`. They own the version-pinned Resource Release pattern.

## Effect

Import Effect from `effect`. The `effectEntry` Vite plugin (`packages/plugin-kernel/scripts/effect-entry.ts`) resolves `effect` and `effect/Effect`, imported from plugin code, to the wrappers in `packages/plugin-kernel/src`, so the runtime entry points default to Chromium scheduling in the renderer and workers. Worker bundles resolve them to `packages/plugin-kernel/src/effect-worker.ts` and carry no LogTape; renderer entry points log through LogTape. `effectEntryCheck` fails a build whose entry chunk misses its wrapper, `no-restricted-imports` bans the wrapper paths, and `pnpm e2e:worker` checks real worker responsiveness.

## Views

A view reads Effect services through view atoms (`packages/obsidian-kit/src/view-atoms.ts`). Before you create or migrate a view, read [ADR 0082](docs/adr/0082-obsidian-views-read-effect-services-through-view-atoms.md): its pattern catalogue names the reference for each piece, and its pitfalls list what broke the first migrations.

## Workers

A new worker runs on `effect/rpc`; follow `packages/zotero-reads/src/{contract/rpc,worker/serve,worker/worker-launch,client/worker-host,worker/in-process}.ts` and the entry `src/services/zotero-reads/worker.ts`.

## Debugging

Run `/obsidian-debug` to build, reload, and screenshot the running Obsidian instance.

## Testing

Verify rendered surfaces in the running app through `/obsidian-debug`.

Vitest runs in Node with `"obsidian"` resolved to the mock in `packages/obsidian-kit/src/__mocks__/obsidian.ts` via `resolve.alias` (`obsidianMock` from `@zotlit/obsidian-kit/vitest`). Extend the mock when touching new `obsidian` exports; keep the surface minimal.

- `pnpm exec vitest run path/to/file.test.ts` — single file.
- `pnpm exec vitest` — watch mode.

App-local `tsc` and `vitest` read workspace packages (`@zotlit/db`, `@zotlit/templates`, …) from their source, so a change in `packages/*` reaches them with no build. They do need the generated files: run `pnpm exec turbo run generate:language-packs generate:message-types` once before a direct run.

Write an Effect case with `it.effect` from `@effect/vitest`; vitest.config.ts resolves it through `effectEntry` to `packages/plugin-kernel/src/effect-vitest.ts`, which adds the plugin's runtime services (browser scheduler, LogTape logger) to `@effect/vitest`'s TestClock and TestConsole. Provide a `Logger.layer` to capture logs (`packages/plugin-services/src/obsidian/use-ledger/service.test.ts`).

`sleep` is an Obsidian global that doesn't exist in Node. Use `delay` from `@std/async` instead.

For a macrotask yield between chunks of synchronous work (not a timed wait), use `yieldToMain` from `@zotlit/plugin-kernel/yield-to-main.ts` instead of `sleep(0)`/`delay(0)`: it runs as a `MessageChannel` message task, so it isn't clamped/throttled in hidden or occluded windows the way timer-based yields are, and it works identically under Node (Vitest) with no mock needed.

## Extended Obsidian APIs

Declare private Obsidian runtime APIs in `packages/obsidian-kit/src/typings/obsidian-ex.d.ts` with `declare module "obsidian" { ... }`. Limit to surface the plugin actually touches; update the Vitest mock separately.
