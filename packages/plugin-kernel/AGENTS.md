# @zotlit/plugin-kernel

The host-free base of the Obsidian plugin: code that imports no `obsidian`, `electron` or `node:*`. It holds the Effect wrappers and helpers (`effect*.ts`, the log, bridge, stream, scope and clock helpers), the browser scheduler, pure utilities and the shared constants. Every ZotLit Obsidian plugin (desktop, Reader, Mobile) runs it.

## Boundary

Lint holds the boundary: the engine rules of `packages/config/oxlint.base.ts` refuse a host module, and this package imports nothing of `@zotlit/obsidian-kit`, `@zotlit/obsidian-desktop` or the app. Code that needs the Obsidian API goes to `@zotlit/obsidian-kit`. Take a host capability as a value or a service tag.

## Module resolution

The package exports its TypeScript source as `@zotlit/plugin-kernel/<file>.ts`. Inside the package, import a file through the `#` subpath (`#effect-log.ts`) or a relative path, with its extension.

## Effect entry

`scripts/effect-entry.ts` (`@zotlit/plugin-kernel/vite`) is the `effectEntry` Vite plugin: for plugin code, it resolves `effect`, `effect/Effect` and `@effect/vitest` to the wrappers in `src/`. A consumer passes the source folders it scopes (`scopes`); code outside them gets the real package. Import Effect from `effect`, never from a wrapper.

## Tests

`pnpm exec vitest run src/<file>.test.ts` runs one file. Build constants (`__DOCS_SITE_URL__` and the feature flags) are declared in `src/typings/build-env.d.ts` and defined in `vitest.config.ts`; the app's Vite config defines them for the bundle.
