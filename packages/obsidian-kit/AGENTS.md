# @zotlit/obsidian-kit

The Obsidian layer of the plugin's base: code over the `obsidian` API and nothing of Node or Electron, so it loads on Obsidian Mobile. It holds the capability tags (`obsidian-*.ts`), the CLI helpers, the shared Preact components (`components/`, with the wrappers of Obsidian's controls in `components/obsidian/`), view atoms and view runners, notices and toasts, menus and popovers.

## Boundary

Lint refuses `node:*`, `electron` and `@zotlit/obsidian-desktop`. The package imports `@zotlit/plugin-kernel` and no service or view of the app. `ViewServiceRegistry` (`view-atoms.ts`) is open: a host lists its view services by declaration merging.

## Module resolution

The package exports its TypeScript source as `@zotlit/obsidian-kit/<file>.ts`. Inside the package, import a file through the `#` subpath (`#notice.ts`) or a relative path, with its extension.

## Test support

- `src/__mocks__/obsidian.ts` is the Vitest stand-in for `obsidian`, and `vitest.setup.js` adds the Obsidian globals. A consumer's Vitest config takes both from `@zotlit/obsidian-kit/vitest` (`obsidianMock`, `obsidianSetupFile`). Extend the mock when code touches a new `obsidian` export.
- `src/__fixtures__/` holds the in-memory capability sources (`obsidian-<tag>.ts`), the keymap, notifier and view fixtures.
- `src/typings/` declares Obsidian's private APIs that the plugin reads (`obsidian-ex.d.ts`, `codemirror-ex.d.ts`); a consumer's tsconfig includes these files.

## Styles

Components draw with `zt:` utilities. The app's `src/zt-main.css` names this package's `src/` in an `@source` line, so Tailwind sees its classes.
