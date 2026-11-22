# @zotlit/obsidian

ZotLit's desktop Obsidian host. Feature code lives in packages; this app composes it and owns Worker entries, settings migrations, build configuration, and integration tests across features. The root package map identifies feature owners.

## Host wiring

- `src/features.ts` orders feature registrations and startup hooks; `src/host.ts` sets the page/menu order and composes settings with `withHost` from `src/services/settings/`.
- `src/zt-main.ts` uses `shellEntry` to import `src/zt-body.ts` once the layout is ready. Keep the static entry free of Effect and feature code. `src/link-actions.ts` lists early `obsidian://` actions; its typecheck keeps entry and body registrations aligned.
- `src/zt-body.ts` starts the host through `shellStart`, with the Electron preflight and installer notice. For lifecycle or registration changes, read [plugin-shell](../../packages/plugin-shell/AGENTS.md).
- `src/capabilities.ts` wires ZoteroReads and citation parsing to the Worker entries in `src/services/zotero-reads/` and `src/services/citation-parse/`. For RPC changes, read [zotero-reads](../../packages/zotero-reads/AGENTS.md).
- `src/services/citations/`, `notes/`, and `template-workbench/` hold tests across feature packages. Change production behavior in the owning package.
- `src/__fixtures__/mobile-host/` composes a Node-free host over stub ports. `tsconfig.mobile.json`, `scripts/check-mobile-host.ts`, and `src/mobile-host.test.ts` check that boundary.

Packages do not import this app. Features register their service and settings types through declaration merging. Use `/obsidian-services` for services/features and `/obsidian-settings` for settings pages. Settings are flat dot-notation keys in `PluginSettings` from `@zotlit/plugin-services/obsidian/settings/service.ts`; `src/services/settings/schema.ts` composes the feature slices.

## Commands

Use the root build/test/lint commands. App-specific operations:

- `pnpm --filter @zotlit/obsidian dev` watches the development build.
- `I18N_DEV_SERVER=true pnpm --filter @zotlit/obsidian dev` serves Language Packs locally on port 9092 (or set a port number). Development versions have no Resource Release, so non-English development needs this server; otherwise the bundled English pack remains active.
- `pnpm --filter @zotlit/obsidian analyze` writes `bundle-stats.html`; `ANALYZE=json` produces `bundle-stats.json`.

The production build writes `dist/package/`, then the publish shell builds `dist/main.js` and `dist/styles.css`. The development build writes `dist-dev/` directly. The owners are `vite.config.ts` and `@zotlit/scripts/shell/host-build`; product metadata is in `packages/scripts/lib/shell/plugins.ts`.

## UI and runtime

Preact provides the UI runtime through React compatibility aliases. For UI changes, run `/obsidian-css`; for rendered behavior, use `/obsidian-debug`. The latter uses the host desktop; `pnpm e2e` uses a Run Container. See [the e2e guide](../../packages/e2e/AGENTS.md) for selection and host admission.

For view integration, read [ADR 0082](docs/adr/0082-obsidian-views-read-effect-services-through-view-atoms.md) and `packages/obsidian-kit/src/view-atoms.ts`. Feature-local models and gestures belong with their feature. The PDF Annotation Marks and Creation Toolbar use vanilla DOM; the Mark Popup has one Preact root on Obsidian's popover ([ADR 0042](docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md), [ADR 0065](docs/adr/0065-the-mark-popup-is-one-preact-root-on-obsidians-popover.md)).

Effect imports resolve through `effectEntry` in `packages/plugin-kernel/scripts/effect-entry.ts`. Renderer entries use Chromium scheduling and the plugin logger; Workers use `effect-worker.ts` without the renderer logger. `effectEntryCheck` checks the built entry. The optional `pnpm e2e:performance` checks timing budgets on the reference MacBook; ordinary E2E checks correctness and reports timings.

For logging setup, read `packages/plugin-services/src/obsidian/log/service.ts` and `packages/plugin-kernel/src/effect-log.ts`.

## Messages and CLI

Messages come from `@zotlit/plugin-messages/messages.ts`. Turbo generates the facade and Language Packs; use `pnpm --filter @zotlit/plugin-messages generate:language-packs` when bypassing Turbo. Run `/i18n-ui-text` for wording and `/inlang-i18n` for format/runtime mechanics.

For a `zotlit:*` command, read `packages/obsidian-kit/src/cli-command.ts` and `cli-params.ts`; `packages/query-views/src/desktop/item-query/decode.ts` shows parameter decoding. CLI guide sources live beside their handlers.

For a CLI schema or downloadable resource, read `packages/template-workbench/src/core/cli/schema.ts`, [ADR 0019](../../docs/adr/0019-runtime-assets-ship-on-a-parallel-resource-release.md), and `packages/scripts/lib/shell/templates/.github/workflows/plugin-release.yml` for the pinned Resource Release contract.

## Tests and private APIs

Run `pnpm exec vitest run path/to/file.test.ts` from this app for a single file, or `pnpm exec vitest` for watch mode. Direct runs need generated dependencies; use Turbo first. Workspace packages are read from source, without a package build.

`vitest.config.ts` resolves `obsidian` to the mock in `packages/obsidian-kit/src/__mocks__/obsidian.ts` and `@effect/vitest` through the plugin's Effect wrapper. The wrapper supplies the browser scheduler and plugin logger as well as TestClock/TestConsole. Capture plugin logs with `captureLogRecords` or `forwardLogRecords` from `packages/plugin-kernel/src/__fixtures__/log-capture.ts`; a local `Logger.layer` only sees the Effect it is supplied to.

Private Obsidian API declarations live in `packages/obsidian-kit/src/typings/obsidian-ex.d.ts`; update the mock separately. A mock used by message calls needs `getLanguage()` returning the fixture locale. Obsidian's global `sleep` is absent in Node; use `delay` from `@std/async` for a timed wait, or `yieldToMain` from `@zotlit/plugin-kernel/yield-to-main.ts` for a macrotask yield without timer clamping.
