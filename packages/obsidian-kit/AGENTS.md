# @zotlit/obsidian-kit

The Obsidian layer of the plugin's base: code over the `obsidian` API and nothing of Node or Electron, so it loads on Obsidian Mobile. It holds the capability tags (`obsidian-*.ts`), the CLI helpers, the shared Preact components (`components/`, with the wrappers of Obsidian's controls in `components/obsidian/`), view atoms and view runners, notices and toasts, menus and popovers.

## Boundary

The package is the Obsidian zone (`zotlit.layer` in `package.json`, [ADR 0117](../../docs/adr/0117-runtime-zones-are-checked-by-the-module-graph.md)). The runtime check (`pnpm run lint:runtime-zones`) fails on reach to Electron or to a desktop-zone file such as `@zotlit/obsidian-desktop`, and lint refuses Node built-in imports and the Node globals. The `src/worker/` folder is the Worker zone: the CLI diagnostics factory (`worker/cli-diagnostic.ts`), which the Item Query job reads in the ZoteroReads Worker. Desktop-only code goes to `@zotlit/obsidian-desktop`. A member of the Obsidian API that exists only on desktop is a service tag here, which only a desktop Layer supplies: `VaultDisk` (`obsidian-vault-disk.ts`) holds the vault's folder on disk, the full path of a vault file and the reconcile of a file written to disk, and the plugin shell's `desktopPlatform` supplies it. Lint refuses a `FileSystemAdapter` import everywhere except the `src/desktop/` layers of the packages on the plugin-code lint rules (their `__fixtures__` included), `@zotlit/obsidian-desktop`, `packages/e2e` and test files; a `__fixtures__` file outside `src/desktop/` is refused. The package imports `@zotlit/plugin-kernel` and no service or view of the app. `ViewServiceRegistry` (`view-atoms.ts`) is open: a host lists its view services by declaration merging.

## Test support

- `src/__mocks__/obsidian.ts` is the Vitest stand-in for `obsidian`, and `vitest.setup.js` adds the Obsidian globals. A consumer's Vitest config takes both from `@zotlit/obsidian-kit/vitest` (`obsidianMock`, `obsidianSetupFile`). Extend the mock when code touches a new `obsidian` export.
- `src/__fixtures__/` holds the in-memory capability sources (`obsidian-<tag>.ts`), the keymap, notifier and view fixtures.
- `src/typings/` declares Obsidian's private APIs that the plugin reads (`obsidian-ex.d.ts`, `codemirror-ex.d.ts`); a consumer's tsconfig includes these files.

## Styles

Components draw with `zt:` utilities. `src/theme.css` owns the Tailwind theme: the layer order, the `zt` prefix, the `@theme` tokens, the utilities and the `.zt-root` preflight. A host's stylesheet imports it and names each package's `src/` in an `@source` line, so Tailwind sees its classes; a package stylesheet that needs the theme takes it with `@reference "@zotlit/obsidian-kit/theme.css"`.
