# @zotlit/plugin-kernel

The host-free base of the Obsidian plugin: code that imports no `obsidian`, `electron` or `node:*`. It holds the Effect wrappers and helpers (`effect*.ts`, the log, bridge, stream, scope and clock helpers), the browser scheduler, pure utilities and the shared constants. Every ZotLit Obsidian plugin (desktop, Reader, Mobile) runs it. `src/worker/` is the Worker zone: the clock, log category, log port and in-process RPC helpers, the Resource Release URL (`release-url.ts`), which the ZoteroReads Worker also runs and which use no DOM name, and `fills.ts`: `fillMissing` installs `Error.captureStackTrace` (a no-op where it is missing, as on Safari before 17.2), `Error.isError`, `Map.groupBy`, `Array.prototype.toSorted`, `Array.prototype.toReversed`, `Symbol.dispose`, `Symbol.asyncDispose`, `SuppressedError`, `DisposableStack`, `AsyncDisposableStack`, `RegExp.escape` only where the runtime lacks them, and calls the root's `temporal` loader only where `Temporal` is missing (the Mobile floor of #292). A Worker root calls it before it loads the rest. `temporal-piece.ts` is the entry of that piece: `temporal-polyfill/global`, which installs the global only where it is missing; an app builds it as a text of its own.

## Boundary

The package is the host-free zone (`zotlit.layer` in `package.json`) and `src/worker/` is the Worker zone ([ADR 0117](../../docs/adr/0117-runtime-zones-are-checked-by-the-module-graph.md)). A new file goes in `src/worker/` when the ZoteroReads Worker runs it, and at the top of `src/` otherwise. The runtime check (`pnpm run lint:runtime-zones`) fails on reach to `obsidian`, Electron or a file of the Obsidian or desktop zone, and lint refuses Node built-in imports and the Node globals. The package imports nothing of `@zotlit/obsidian-kit`, `@zotlit/obsidian-desktop` or the app. Code that needs the Obsidian API goes to `@zotlit/obsidian-kit`. Take a host capability as a value or a service tag.

## Effect entry

`scripts/effect-entry.ts` (`@zotlit/plugin-kernel/vite`) is the `effectEntry` Vite plugin: for plugin code, it resolves `effect`, `effect/Effect` and `@effect/vitest` to the wrappers in `src/`. A consumer passes the source folders it scopes (`scopes`); code outside them gets the real package. Import Effect from `effect`, never from a wrapper.

## Tests

From this package directory, `pnpm exec vitest run src/<file>.test.ts` runs one file. Build constants (`__DOCS_SITE_URL__` and the feature flags) are declared in `src/typings/build-env.d.ts` and defined in `vitest.config.ts`; the app's Vite config defines them for the bundle.
