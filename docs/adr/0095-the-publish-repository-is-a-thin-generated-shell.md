---
status: accepted
---

# The publish repository is a thin generated shell over a bundle package

## Context

The source moved to `aidenlx/zotlit-repo` (trunk `next`). `aidenlx/zotlit` keeps what users and the Obsidian community directory reach: the plugin releases (`x.y.z`), the Resource Releases (`res-x.y.z`, ADR 0019), the Companion releases (`zt-x.y.z`) and the rolling `zotero-release` update channel, the directory entry, the old issues and the discussions. Installed Companions read their `update_url` from `aidenlx/zotlit`, so that repository cannot change.

The directory builds and reviews a plugin from the repository its entry names. Its official action (`obsidianmd/obsidian-workflows`, read at 8167caed39664214d82c86fdfa32e06d8d55f61d, v1.2.3) picks pnpm by `pnpm-lock.yaml` but does not install pnpm, runs the first of the root `build`, `build:plugin` and `compile` scripts with `npm run`, expects a root `main.js`, lints with type-aware rules when a root `tsconfig.json` exists, passes no environment variable to the build, attests `main.js` and `styles.css`, and creates a draft release with `main.js`, `manifest.json` and `styles.css`.

A plain one-stage Vite build of the source and a rebuild of a published package cannot give the same `main.js`: a minifier over one pre-bundled module emits other helpers, names and order than over two thousand source modules. The release `main.js` must be the one the publish repository builds.

## Decision

- **Two repository constants.** `packages/config/src/worker/repositories.ts` names the source repository (`SOURCE_REPOSITORY`, also root `package.json#repository`) and the publish repository (`RELEASE_REPOSITORY`). Every release URL reads `RELEASE_REPOSITORY`: the Companion's `update_url` and XPI links, the plugin's Resource Release URLs, the Welcome View's GitHub link, the docs site's release data, stars and Giscus, and the `gh release` steps of `release.yml` (`GH_REPO`). Links to source files and to new issues use the source repository; links to an existing issue or discussion of `aidenlx/zotlit` keep their URL. The bundle package names the source repository in its npm metadata for provenance. The publish repository also hosts the Companion's rolling update manifest and issues from before the move.
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

- Adding a plugin is an entry in both registries, a publish job in `release.yml`, a host app that writes its own `dist/package/`, and a publish repository with a first commit on `main`; the first publish fast-forwards that `main`, while it has no files, to the shell, which holds the first beta until the first stable release (CONTRIBUTING.md "First release of a new plugin").
- Each publish repository tags the bare version on its shell commit; the source repository tells the plugins apart by the tag prefix.

## Publication from the generated workflow

The generated plugin workflow starts on tags that begin with a digit.
Resource and Companion release prefixes stay outside that trigger.
The tag and the generated manifest name the same version. The shell
sets up pnpm from its package manager field before calling the pinned
Obsidian release action. The action uses the lockfile to select pnpm
for install. This template pins the `v1.2.3` action commit.

The action builds and checks the plugin, attests the build, and drafts
the release. A resource upload can replace a partial upload on retry
while the plugin release remains a draft. The workflow checks that
each resource is anonymously available at the URL the plugin will
use, compares its bytes with the packaged resource, and attests the
resources before publishing the draft. A beta release stays outside
Latest and leaves the default branch's last stable manifest in place.

The desktop production build writes an unminified ES module bundle package and the final stylesheet. The publish shell builds the CommonJS plugin from that package and minifies JavaScript. A development build writes CommonJS directly. Development maps use an absolute base because Obsidian evaluates the plugin under a synthetic URL. That path depends on the checkout, so the development build stays uncached. Set Rolldown's strict execution order in both host and worker builds. Without it, the Effect re-export paths could load before their initialization.

The shell check runs from each generated shell's root and uses the type-aware branch of the directory scanner configuration, which the scanner selects for a repository with a root TypeScript configuration. Use the scanner rules and warning conversion from `src/lint.ts` at `8167caed39664214d82c86fdfa32e06d8d55f61d` and share the ignore list with source review. The generated build must match the packed plugin build before it passes scanner review.

### Publish shell inputs and reproducibility

Keep the app and publish shell on the same build entry and pin the Vite and Rolldown versions because both affect `main.js` bytes. Externalize the modules Obsidian supplies. Keep strict execution order when lowering the bundle to CommonJS. The shell transforms the finished module with no environment inputs. Preserve the JavaScript templates' JSDoc type annotations because the TypeScript host imports those templates directly.

The bundle manifest's repository points to the source repository that publishes to npm, because provenance checks that field. The shell README resolves source-relative images against that repository. A newly created publish repository can carry its first beta manifest on the default branch until a stable release exists. The official action selects pnpm from its lockfile but needs an explicit setup step using the version in the package manifest. The container shell pins the same Obsidian action at `8167caed39664214d82c86fdfa32e06d8d55f61d` (v1.2.3). The action prepares a draft after checking and attesting the build. The final step publishes it only after the version tag and manifest agree.

The local shell check uses a tarball override, while publication locks the real registry version. Scope a temporary registry override to the bundle package for a dry run and remove its tarball URL from the lockfile. The generated shell installs from the public registry. Exempt the bundle package from the minimum release age because the shell builds immediately after its publish.

The Dev Build manifest derives a prerelease identifier only from the app version. Use the next patch with a dev suffix for a stable version and append a dev identifier for an existing prerelease. The result sorts after the source release and before the next release, and the task cache can reuse it. The Development Vault setup provides the plugin directory that receives the app build.

The standalone shell generator replaces the destination tree. Use a published bundle version for a registry lock, a local bundle tarball for a package that has not reached npm, or `--no-lock` to inspect the shell tree without dependency resolution.

Run the shell check after the release guideline review. Build the host
bundle package, pack it as a local tarball, and generate the shell with
its lockfile pointing at that tarball. Install and build the shell as the
Obsidian release action does. Compare its main.js and, for a host plugin,
styles.css to the host's files byte for byte. Run the community ESLint
config from the shell root, including manifest validation. The Resource
Pack compares main.js alone.
[Shell check](../../packages/scripts/scripts/check-shell.ts)

Replace Effect platform-node's eager HTTP loader at build time and
require the replacement to match. The shell's lazy built-in pass
then loads HTTP and HTTPS when first used, deferring their TLS and
crypto dependencies. Pick the synchronous fflate path so importing
the plugin does not start its Node worker support.

## Published plugin profiles

One profile per plugin kind supplies the app path, output files, package entry points, README text, release substitutions and bundle checks. All publish shells and bundle packages use the shared legal files. A bundled plugin builds an ES module and stylesheet through a generated entry and may fetch per-version assets from its Resource Release. The Resource Pack's app creates its CommonJS container. Its shell ships the same bytes and does not load that module.
