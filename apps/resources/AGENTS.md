# @zotlit/resources

The Resource Pack (plugin id `zotlit-resources`): the third Obsidian plugin. A researcher installs it from the community plugin browser, and ZotLit reads its Pack Entries from the installed `main.js`. The pack works installed and turned off; turned on, it loads as an empty plugin.

The container format, its writer and its reader are in `@zotlit/resource-pack` (`packages/resource-pack/AGENTS.md`). This app holds the content of the pack and its build.

## Navigation

- `package.json` — the version and the manifest fields (`obsidian`), and `packEntries`: the pin of each Pack Entry, the version of its upstream package and the SHA-256 of its binary. `pnpm check:bundle` reads the same pins.
- `scripts/pack.ts` — `buildResourcePack`: takes each binary from its installed upstream package (`jieba-wasm` for `chinese-segmenter`, `pandoc-wasm` for `pandoc-engine`), refuses a package of another version or bytes of another hash than the pin, and writes the licence text and the source link of each binary into the pack. It gives the writer `node:zlib` gzip at level 9, the smallest that Node writes.
- `licences/pandoc-COPYING.txt` — the GNU General Public License, version 2: `COPYING.md` of the Pandoc source at the pinned release, byte for byte. `pandoc-wasm` ships Pandoc's licence statement without this text, so the pack takes it from here.
- `scripts/build.ts` — the build: `main.js` and `manifest.json`, and for production the bundle package `dist/package/` (`@zotlit/resources-plugin`: `main.js`, `package.json`, `README.md`, `LICENSE`, `NOTICE`). `node scripts/build.ts --help` has its options.
- `scripts/container.electron.test.ts` — runs the Pack container cases of `@zotlit/resource-pack` in an Electron renderer.
- `versions.json`, `README.md` — what the publish repository `aidenlx/zotlit-resources` shows (`PUBLISHED_PLUGINS.resources`, `packages/scripts/lib/shell/plugins.ts`).

## Build

- `pnpm exec turbo run build --filter=@zotlit/resources` — the production build: the pack writer's `main.js` goes into `dist/package/`, and the publish repository's own build script (`packages/scripts/lib/shell/templates/scripts/build-container.mjs`) copies it into `dist/`.
- `pnpm --filter @zotlit/resources build:dev` — a development build into `dist-dev/`, copied into this worktree's Development Vault at `.obsidian/plugins/zotlit-resources/`; prefix `ZT_VAULT_CASE=<case>` for a Vault Case vault.
- `main.js` ships byte for byte: each offset in its index counts bytes from the start of the file. Keep every later step a plain copy.

## Release

The pack is the product `resources` (`PRODUCTS`, `packages/scripts/lib/release/lines.ts`): source tag `resources-<version>`, npm bundle package `@zotlit/resources-plugin`, publish repository `aidenlx/zotlit-resources`. `CONTRIBUTING.md` "Releasing" has the procedure.

- **Version line.** `version` in `package.json` is the pack's own line, apart from ZotLit's. The version picks the release line: a pre-release version is a beta. The line follows the ZotLit release that builds the pack: `pnpm release --obsidian <v> --resources <v>` takes both versions on one line and refuses two.
- **Compatibility integer.** `PACK_COMPAT` in `packages/resource-pack/src/format.ts` changes only when the container format or the meaning of an entry changes. A new version of a binary with the same interface keeps the integer, and so does a new pack version.
- **Shell.** The generated publish repository's `scripts/build.mjs` comes from `packages/scripts/lib/shell/templates/scripts/build-container.mjs` (mapped by `packages/scripts/lib/shell/profiles.ts`). It copies `main.js` from the bundle package, and the shell holds that script alone: it has no bundler and no source file. `pnpm release:check-shell --plugin resources` proves that the copy equals `dist/main.js` byte for byte. `pnpm release:publish resources --dry-run` prints the commands of a release.

## Update a binary

Update the upstream package in the catalog, then set the entry's `version` and `sha256` in `packEntries` to the new package's. The version of `pandoc-engine` is the Pandoc release that `pandoc-wasm/pandoc-version.txt` states; the README names it too. The build prints the hash of the installed binary when it differs from the pin.

When you update `jieba-wasm`, also set `JIEBA_WASM_VERSION` in `packages/item-lookup/src/segmenter.ts` to the new version. A test checks it against the installed package.

## Tests

`pnpm exec vitest run scripts/pack.test.ts` runs one file. `pnpm check:bundle` checks the built pack: its size budget, that `main.js` is valid JavaScript, and that each entry reads back as its pin after the text changes Obsidian makes on install.
