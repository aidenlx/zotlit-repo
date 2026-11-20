---
status: accepted
---

# The publish repository is a thin generated shell over a bundle package

## Context

The source moved to `aidenlx/zotlit-repo` (trunk `next`). `aidenlx/zotlit` keeps what users and the Obsidian community directory reach: the plugin releases (`x.y.z`), the Resource Releases (`res-x.y.z`, ADR 0019), the Companion releases (`zt-x.y.z`) and the rolling `zotero-release` update channel, the directory entry, the old issues and the discussions. Installed Companions read their `update_url` from `aidenlx/zotlit`, so that repository cannot change.

The directory builds and reviews a plugin from the repository its entry names. Its official action (`obsidianmd/obsidian-workflows`, read at 8167caed39664214d82c86fdfa32e06d8d55f61d, v1.2.3) picks pnpm by `pnpm-lock.yaml` but does not install pnpm, runs the first of the root `build`, `build:plugin` and `compile` scripts with `npm run`, expects a root `main.js`, lints with type-aware rules when a root `tsconfig.json` exists, passes no environment variable to the build, attests `main.js` and `styles.css`, and creates a draft release with `main.js`, `manifest.json` and `styles.css`.

A plain one-stage Vite build of the source and a rebuild of a published package cannot give the same `main.js`: a minifier over one pre-bundled module emits other helpers, names and order than over two thousand source modules. The release `main.js` must be the one the publish repository builds.

## Decision

- **Two repository constants.** `packages/config/repositories.ts` names the source repository (`SOURCE_REPOSITORY`, also root `package.json#repository`) and the publish repository (`RELEASE_REPOSITORY`). Every release URL reads `RELEASE_REPOSITORY`: the Companion's `update_url` and XPI links, the plugin's Resource Release URLs, the Welcome View's GitHub and bug-report links, the docs site's release data, stars and Giscus, and the `gh release` steps of `release.yml` (`GH_REPO`). Links to source files and to new issues use the source repository; links to an existing issue or discussion of `aidenlx/zotlit` keep their URL.
- **One bundle package per plugin.** A host app's production build writes `dist/package/`, the npm package `@zotlit/obsidian-plugin` at the plugin version: `main.js` as one unminified ES module, `styles.css`, `resources/` (the Resource Release files), `main.d.ts`, the license files. Every workspace and third-party module is inlined; only the modules Obsidian provides (`obsidian`, `electron`, `@electron/remote`, `@codemirror/*`, `@lezer/*`, Node builtins) stay imports. Build-time values (`DOCS_SITE_URL`, the feature flags, the Pandoc and jieba pins) are fixed when the package is built.
- **The release main.js is the shell's.** The same build then runs the shell's `scripts/build.mjs` (Vite 8 over the package, CommonJS, minified, `strictExecutionOrder`) to write `dist/main.js`. The shell pins that Vite version and overrides Rolldown to the version Vite runs in the workspace.
- **A generated shell.** `packages/scripts/lib/shell/` writes the publish repository's tree for a plugin and version: `manifest.json`, `versions.json`, `README.md`, `LICENSE`, `NOTICE`, `package.json` (one dependency, the bundle package at the exact version; `build` script; `packageManager`), `pnpm-workspace.yaml` (`minimumReleaseAgeExclude` for the bundle package, the Rolldown override), `pnpm-lock.yaml`, `tsconfig.json`, `src/main.ts` (re-exports the plugin class), `scripts/build.mjs`, `.github/workflows/plugin-release.yml`, `giscus.json`, `.gitignore`. Per-plugin facts live in `PUBLISHED_PLUGINS`.
- **The shell's workflow** runs on a version tag: checkout, `pnpm/action-setup`, `setup-node` 24, the official action pinned to 8167caed with `mode: release` and `strict: true`, then the Resource Release from the package's `resources/`, an anonymous download check, attestation of the resources, and publishing the draft (pre-release for a beta).
- **A local check in the release gate.** `pnpm release:check-shell` packs the bundle package, generates the shell under `.scratch/`, installs it with the tarball in place of the registry version, builds it, and fails unless `main.js` and `styles.css` match the app's build byte for byte and the shell passes the scanner's ESLint config and the manifest rule. `pnpm verify --release` runs it after `pnpm review`, which stays the strict review of the source.

## Considered

- **Third-party packages as dependencies of the bundle package.** Rejected for correctness. An external `effect` resolves before the `effectEntry` plugin can send plugin code to the kernel's wrappers, and the build then fails its `effectEntryCheck`. An external rule runs before the Preact aliases, so the package would import `react` and `react-dom`. Packages inlined in the bundle and the external ones would load two copies of Effect. The shell would also have to repeat the app's `define`, resolve conditions and aliases. A workspace build could not resolve the externals the way the shell does, because pnpm does not expose a workspace package's dependencies to the app's folder. And the registry install would resolve transitive versions anew, so the released `main.js` could hold code the End-to-end Run never ran.
- **Committing a built `main.js` to the publish repository.** Rejected: the directory rebuilds from source and compares.
- **The shell holding the host source.** Kept as the fallback if the directory reviews a thin shell badly: the same package and script, plus the host layer's source.

## Consequences

- The production build takes a few seconds more and writes `dist/package/` and `dist/shell/`. The development build and the End-to-end Run (`build:dev`) do not change; the release build's two stages are proved by the byte comparison, not by an End-to-end Run.
- A release publishes the bundle package to npm before it pushes the shell commit and tag; the lockfile is then resolved from the registry (`pnpm install --lockfile-only` in the generated shell).
- Adding the Reader or Mobile plugin is one entry in `PUBLISHED_PLUGINS`, a host app that writes its own `dist/package/`, and a publish repository.
- `giscus.json` lives in the shell templates; the source repository has none.

## Update: a product registry (2026-11-20)

ZotLit Reader is the second published plugin. A plugin is one entry in each of two registries, not one entry in `PUBLISHED_PLUGINS` alone:

- **`PUBLISHED_PLUGINS`** (`packages/scripts/lib/shell/plugins.ts`) names what the shell needs per plugin: the host app, the bundle package (`@zotlit/obsidian-plugin`, `@zotlit/reader-plugin`), the publish repository (`aidenlx/zotlit`, `aidenlx/zotlit-reader`), the `versions.json` and the README the shell shows, and whether the repository hosts the Giscus discussions. `pnpm release:check-shell` and the manifest check run for each entry.
- **`PRODUCTS`** (`packages/scripts/lib/release/lines.ts`) names what a release publishes: the app, the tag prefix in the source repository (none for ZotLit, `zt-` for the Companion, `reader-` for the Reader), the plugin entry, and a `publish` switch. The release plan skips a product whose switch is off, so a new plugin can land before its outward steps are done. `release.yml` has one publish job per product.

Consequences:

- Adding a plugin is an entry in both registries, a publish job in `release.yml`, a host app that writes its own `dist/package/`, and a publish repository whose `main` holds the shell's workflow before the first tag (CONTRIBUTING.md "First release of a new plugin").
- Each publish repository tags the bare version on its shell commit; the source repository tells the plugins apart by the tag prefix.
