# @zotlit/resources

The Resource Pack (plugin id `zotlit-resources`): the third Obsidian plugin. A researcher installs it from the community plugin browser, and ZotLit reads its Pack Entries from the installed `main.js`. The pack works installed and turned off; turned on, it loads as an empty plugin.

The container format, its writer and its reader are in `@zotlit/resource-pack` (`packages/resource-pack/AGENTS.md`). This app holds the content of the pack and its build.

## Files

- `package.json` — the version and the manifest fields (`obsidian`), and `packEntries`: the pin of each Pack Entry, the version of its upstream package and the SHA-256 of its binary. `pnpm check:bundle` reads the same pins.
- `scripts/pack.ts` — `buildResourcePack`: takes each binary from its installed upstream package (`jieba-wasm` for `chinese-segmenter`), refuses a package of another version or bytes of another hash than the pin, and writes the licence text and the source link of each binary into the pack.
- `scripts/build.ts` — the build: `main.js` and `manifest.json`. `node scripts/build.ts --help` has its options.
- `scripts/container.electron.test.ts` — runs the Pack container cases of `@zotlit/resource-pack` in an Electron renderer.
- `versions.json`, `README.md` — what the publish repository `aidenlx/zotlit-resources` shows (`PUBLISHED_PLUGINS.resources`, `packages/scripts/lib/shell/plugins.ts`).

## Build

- `turbo run build --filter=@zotlit/resources` — the production build into `dist/`.
- `pnpm --filter @zotlit/resources build:dev` — a development build into `dist-dev/`, copied into this worktree's Development Vault at `.obsidian/plugins/zotlit-resources/`; prefix `ZT_VAULT_CASE=<case>` for a Vault Case vault.
- `main.js` ships byte for byte: each offset in its index counts bytes from the start of the file. Keep every later step a plain copy.

## Update a binary

Update the upstream package in the catalog, then set the entry's `version` and `sha256` in `packEntries` to the new package's. The build prints the hash of the installed binary when it differs from the pin.

## Tests

`pnpm exec vitest run scripts/pack.test.ts` runs one file. `pnpm check:bundle` checks the built pack: its size budget, that `main.js` is valid JavaScript, and that each entry reads back as its pin after the text changes Obsidian makes on install.
