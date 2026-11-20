# @zotlit/reader

ZotLit Reader (plugin id `zotlit-reader`): a second Obsidian plugin host on `@zotlit/plugin-shell`. It opens vault PDFs in the ZotLit PDF Reader and works without ZotLit and without Zotero. The terms are in `GLOSSARY.md`.

The app is a thin host: it composes feature values and holds no feature code. The reader lives in `@zotlit/reader-feature`, the engine and the view in `@zotlit/pdf-reader`.

## Files

- `src/features.ts` — the feature list, in start-up order: `platformBase` (the Zotero-free platform part of the shell), a `FileSystem` group over the vault adapter (`@zotlit/obsidian-kit/vault-file-system.ts`), then `reader`.
- `src/host.ts` — `defineHost`: the features, the settings, the Language Pack identity (`languagePack`: the `@zotlit/reader-messages` catalog and runtime, namespace `zotlit-reader`, repository `__PLUGIN_REPOSITORY__`), the setting tab order (the Reader page of `reader`, then the Advanced page of `platformBase`), the file and folder menu order.
- `build-defines.ts`, `src/env.d.ts` — the build constants for Vite and Vitest, and their declarations. `__PLUGIN_REPOSITORY__` is `PUBLISHED_PLUGINS.reader.repository`: the Reader downloads its Language Packs from that repository's Resource Release `res-<version>`.
- `src/main.ts` — the plugin class, `shellPlugin(host)`, and the type of `plugin.api`: the `ReaderApi` the `reader` feature gives through the handshake.
- `src/services/settings/` — the settings definition composed from the features (`schema.ts`), with the type check that it equals the Reader's `SettingsRegistry`, and the settings options (`layer.ts`). The plugin has no `data.json` history, so it has no migration.
- `src/e2e.ts` — the type of `plugin.services` for the End-to-end Run.
- `src/main.css` — the Tailwind theme over the plugin packages this host bundles.
- `versions.json`, `README.md` — what the publish repository `aidenlx/zotlit-reader` shows (`PUBLISHED_PLUGINS.reader`, `packages/scripts/lib/shell/plugins.ts`).

## Build

- `turbo run build --filter=@zotlit/reader` — the production build: the bundle package `@zotlit/reader-plugin` in `dist/package/`, then `dist/main.js`, `dist/styles.css` and `dist/manifest.json` through the publish repository's build script. The host build is `obsidianBuildPlugin` from `@zotlit/scripts/shell/host-build`, as for ZotLit. The build stages the Reader's Language Packs other than English (`zh-CN.json`) in `dist/package/resources/` for the Resource Release; English is in `main.js`.
- `pnpm --filter @zotlit/reader build:dev` — a development build into `dist-dev/`, copied into this worktree's Development Vault; prefix `ZT_VAULT_CASE=<case>` for a Vault Case vault.
- The build resolves with browser conditions, so the built `main.js` requires only `obsidian`. Check it with `rg -o 'require\("[^"]+"\)' dist/main.js | sort -u`.
- The Messages come from `@zotlit/reader-messages`, the Reader's subset (`packages/reader-messages/AGENTS.md`). The build compiles that folder at build start, and both the build and Vitest resolve `@zotlit/plugin-messages/*` to it. A Message outside the subset fails the build with `IMPORT_IS_UNDEFINED`.

## Type check

`tsconfig.app.json` checks the app with `types: []`: the host is Node-free. `oxlint.config.ts` bans Node, Electron, the desktop layers and the Zotero packages (`@zotlit/plugin-shell/obsidian/platform.ts` included) in the app's imports.

## Tests

`pnpm exec vitest run src/host.test.ts` builds the Reader's services from its features over the shell base and reads the rows of its setting tab; `src/reader.integration.test.ts` runs the `reader` feature's start-up over the real settings service and checks the takeover, its notice, `data.json`, the Reader page and the handshake (accept, refuse with its log line, `READY_EVENT` once, `onClose` before the PDFs go back); with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest` and `@zotlit/pdfjs/viewer` to `__mocks__/pdfjs-viewer.ts`.
