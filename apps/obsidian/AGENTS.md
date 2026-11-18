# @zotlit/obsidian

The Obsidian plugin. Its shared base lives in packages, which the app imports by name:

- `@zotlit/plugin-kernel` — host-free helpers: the Effect wrappers, log, bridge, stream and scope helpers, pure utilities, shared constants (`constants.ts`).
- `@zotlit/obsidian-kit` — code over the `obsidian` API that loads on Obsidian Mobile: the capability tags (`obsidian-*.ts`), shared components (`components/`), view atoms and runners, notices, the Obsidian test mock.
- `@zotlit/obsidian-desktop` — code that needs `node:*` or `electron`.
- `@zotlit/plugin-messages` — the generated Message facade.
- `@zotlit/plugin-services` — the platform services the features stand on: settings, logging, the Language Pack, the Zotero preferences, the Local Server and Zotero Local API, the Held Read client, Library Scope, item search, the Note Index, the Use Ledger, Managed Binaries, attachments. The app keeps the host composition: the settings it keeps and the migrations of its `data.json` (`src/services/settings/`), the Release check, the `obsidian://` handlers (`src/services/protocol/`), the menu events, and the plugin graph.
- `@zotlit/zotero-reads` — ZoteroReads: its contract, the Worker's handlers, the renderer's client, and the desktop database source. The app keeps the host side: the Worker entry (`src/services/zotero-reads/worker.ts`) and the client's wiring to settings (`worker-client.ts`).

Code that only one unit of the app uses lives in that unit. A base package imports no service or view of the app; the app fills open registries such as `ViewServiceRegistry` by declaration merging (`src/typings/view-services.d.ts`).

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm --filter @zotlit/obsidian dev` — Vite watch build.
- `I18N_DEV_SERVER=true pnpm --filter @zotlit/obsidian dev` — the Language Pack source for a dev build in any non-English locale: serves the generated Language Pack JSONs at `http://127.0.0.1:9092` (or pass a port number) and points the dev build's pack download URL there. A dev build's manifest carries a Dev Build version (`2.2.0-beta.1.dev`, from `scripts/dev-version.ts`) that has no Resource Release, so without this server the pack download fails and the build stays on the bundled English pack.
- `pnpm --filter @zotlit/plugin-messages generate:language-packs` — regenerate the typed message facade and bundled English pack. Only needed when bypassing turbo; turbo `typecheck`/`test` depend on it.
- `pnpm --filter @zotlit/obsidian test:lua-filter` — drive a native Pandoc (3.1.1 or newer) over fixture Markdown to check both `zotlit-cite.lua` variants. Needs `pandoc` on PATH; set `PANDOC_BIN` to check another Pandoc version. `pnpm test` runs it too, and skips it where no `pandoc` is on PATH.
- `pnpm --filter @zotlit/obsidian analyze` — production build with an interactive bundle-size report at `bundle-stats.html`. Set `ANALYZE=json` for a machine-readable `bundle-stats.json` instead.

## UI stack

Preact provides the UI runtime through `@preact/preset-vite` and its React compatibility aliases. Keep React imports and `@types/react`/`@types/react-dom` for the wider ecosystem.

Read `src/views/annot-view/store.ts` for view state, `menus.ts` and `actions.tsx` for menus, and `packages/obsidian-kit/src/menu.ts` for anchoring.

Drag to reorder: a flat list uses `src/views/query-view/reorder.tsx`; a Match tree or a Template Workbench list uses `packages/workbench/src/ui/reorder.ts`.

The Annotation Marks and the Creation Toolbar inside Obsidian's PDF reader are vanilla DOM ([ADR 0042](docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md)). The Mark Popup is one Preact root on Obsidian's popover, rendered synchronously by its host ([ADR 0065](docs/adr/0065-the-mark-popup-is-one-preact-root-on-obsidians-popover.md)).

## Note feature

`src/services/note-feature/` is the `NoteFeature` Effect service (`service.ts`) over Effect functions that yield the services they read: `write-pipeline.ts` (the writes) and `creation-planning.ts` (Profile selection and creation plans). `context.ts` builds the resolvers a template render calls (`buildNoteResolvers` over `NoteResolverServices`); `operations.ts` holds `NoteFeatureHandle`, the shape callers outside Effect get from `handle.ts`. Read these before editing. Batch runners fetch shared context (item tags, note path) once and thread it through the stages, so per-item ops take already-fetched data instead of re-reading.

## Setting tab

Run `/obsidian-settings` for the declarative 1.13 `getSettingDefinitions()` API (controls, sub-pages, migration); build the tab from those definitions alone. Tab lives in `src/setting-tab/index.ts`.

Project-specific: settings live in `PluginSettings` (`@zotlit/plugin-services/obsidian/settings/service.ts`) under flat dot-notation keys, not `plugin.settings`; the tab bridges `control` keys through `getControlValue`/`setControlValue`. A key lives in the settings slice of the feature that owns it (such as `src/services/citation-index/settings.ts`); `src/typings/settings.d.ts` registers each slice, and `src/services/settings/schema.ts` composes them.

## Logging

Log through Effect, filed under a category with `withLogCategory` from `packages/plugin-kernel/src/effect-log.ts`. Every renderer Effect run entry point writes Effect's records to LogTape, where `layerLogging` (`packages/plugin-services/src/obsidian/log/service.ts`) owns the sinks and levels. `getLogger` from `packages/plugin-kernel/src/log.ts` is the legacy LogTape logger.

## UI text (JSON Language Packs)

Import as `import * as m from "@zotlit/plugin-messages/messages.ts"`. `packages/plugin-messages/generated/` is gitignored and regenerated on build; regenerate manually only when bypassing turbo (see Commands). CLI guide sources live beside their handlers.

When extending `packages/obsidian-kit/src/__mocks__/obsidian.ts` for code that calls `m.*` indirectly, add a `getLanguage()` stub returning your fixture locale.

Run `/i18n-ui-text` for wording style; `/inlang-i18n` for JSON format and runtime mechanics.

## CSS

**Tailwind-first.** Run `/obsidian-css` before you write a class list or a stylesheet rule.

## CLI commands

When adding or changing a `zotlit:*` command, register its Effect handler with `registerCliCommand` (`packages/obsidian-kit/src/cli-command.ts`) and decode its parameters with one Effect Schema through `packages/obsidian-kit/src/cli-params.ts`; `src/services/item-query/decode.ts` is the pattern. The adapter's header states how Obsidian turns the caller's tokens into `CliData`.

## CLI schemas and resources

When adding or changing a CLI schema or downloadable resource, inspect `src/services/template-workbench/schema.ts`, [ADR 0019](../../docs/adr/0019-runtime-assets-ship-on-a-parallel-resource-release.md), and `.github/workflows/release.yml` at the repository root. They own the version-pinned Resource Release pattern.

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
