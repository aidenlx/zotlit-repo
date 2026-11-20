# @zotlit/reader

ZotLit Reader (plugin id `zotlit-reader`): a second Obsidian plugin host on `@zotlit/plugin-shell`. It opens vault PDFs in the ZotLit PDF Reader and works without ZotLit and without Zotero. The terms are in `GLOSSARY.md`.

The app is a thin host: it composes feature values and holds no feature code. The reader lives in `@zotlit/reader-feature`, the engine and the view in `@zotlit/pdf-reader`.

## Files

- `src/features.ts` — the feature list, in start-up order: `readerBase`, then `reader`.
- `src/base.ts` — `readerBase`: the log settings slice and a Node-free `FileSystem` group. It stands in for a Zotero-free platform part of the shell.
- `src/host.ts` — `defineHost`: the features, the settings, the setting tab order, the file and folder menu order.
- `src/main.ts` — the plugin class, `shellPlugin(host)`.
- `src/services/settings/` — the settings definition composed from the features (`schema.ts`) and the settings options (`layer.ts`). The plugin has no `data.json` history, so it has no migration.
- `src/e2e.ts` — the type of `plugin.services` for the End-to-end Run.
- `src/main.css` — the Tailwind theme over the plugin packages this host bundles.
- `versions.json`, `README.md` — what the publish repository `aidenlx/zotlit-reader` shows (`PUBLISHED_PLUGINS.reader`, `packages/scripts/lib/shell/plugins.ts`).

## Build

- `turbo run build --filter=@zotlit/reader` — the production build: the bundle package `@zotlit/reader-plugin` in `dist/package/`, then `dist/main.js`, `dist/styles.css` and `dist/manifest.json` through the publish repository's build script. The host build is `obsidianBuildPlugin` from `@zotlit/scripts/shell/host-build`, as for ZotLit.
- `pnpm --filter @zotlit/reader build:dev` — a development build into `dist-dev/`, copied into this worktree's Development Vault; prefix `ZT_VAULT_CASE=<case>` for a Vault Case vault.
- The build resolves with browser conditions, so the built `main.js` requires only `obsidian`. Check it with `rg -o 'require\("[^"]+"\)' dist/main.js | sort -u`.
- The Messages come from `@zotlit/plugin-messages` (ZotLit's generated folder), which turbo generates before the build. The Reader compiles no Messages itself.

## Type check

`tsconfig.app.json` checks the app with `types: []`: the host is Node-free.

## Tests

`pnpm exec vitest run src/host.test.ts` builds the Reader's services from its features over the shell base, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest` and `@zotlit/pdfjs/viewer` to `__mocks__/pdfjs-viewer.ts`.
