---
status: accepted
---

# Workspace packages export their TypeScript source

## Context

Every internal package (`packages/*`) built `dist/*.mjs` with tsdown, and its `exports` pointed at `dist`; `ui` and `workbench` also had a `development` condition that pointed at `src`. `typecheck`, `test` and `lint` depended on `^build` in Turbo. So a new worktree had to build every package before its first check, a type check of an app read a package's last build, and a missing export (`TS2305`) usually meant a stale `dist`. Four of the five lint tasks were uncached.

No internal package is published to npm. The three apps (`apps/obsidian`, `apps/zotero`, `apps/docs`) bundle with Vite, and Node runs the repository scripts (the Fixture, the generators, the release, the lint plugins) as TypeScript by stripping its types.

## Decision

- **One resolution for every consumer.** Each package's `exports` entries are its `src/**/*.ts` files, with no export conditions. tsc, Vite, Vitest, oxlint, knip and Node resolve the same file. This is Turborepo's Just-in-Time package.
- **Node can load all package source.** Relative and alias imports name their file (`./client.ts`); the `import/extensions` lint rule keeps it so. The base tsconfig sets `allowImportingTsExtensions`, `erasableSyntaxOnly` and `noEmit`. Package-internal aliases are `#` subpath imports in `package.json#imports`, never TypeScript `paths`, because a consumer type-checks the package source under its own tsconfig. Source that Node reaches uses no bundler-only import (`?raw`).
- **Only the apps build.** A package keeps a script only for an artifact that is not TypeScript resolution, as a `generate:*` Turbo task with declared `inputs` and `outputs` (item-query's `generate:schema`, db's `generate:contract`).
- **Turbo graph.** `typecheck*`, `test` and the app builds depend on `transit`, so their hash covers the source of every package they depend on; generated files are explicit edges. Every gate task is cacheable; `//#lint:format-versions` stays uncached because it reads git tags and HEAD.

## Consequences

- A fresh clone type-checks, lints and tests after `pnpm install` with no build task. A second gate run on an unchanged tree comes from the Turbo cache.
- An error in package source shows in each consumer's type check, under that consumer's `lib` and `types`. A consumer whose environment differs (the Zotero sandbox, the docs program with Cloudflare Workers types) adds the libs that the source needs, or the shared code keeps to the common subset.
- An app bundler now compiles package dependencies that tsdown used to bundle and tree-shake. A dependency asset that a library build inlines (the `jieba-wasm` binary in the ZoteroReads worker) needs an explicit opt-out in the app's Vite config.
- A later step bundles one npm package per plugin from the app build, if publishing is needed.

## Configuration inputs for source consumers

A feature package type-checks its desktop and Obsidian layers in one
program. The program includes Node types for desktop code. Layer lint
enforces the host boundary. Consumers also include the ambient
declarations of dependencies that read build constants or raw assets.
The Library View resolves canonical logo assets from the shared logo
directory for its icon and Welcome lockup. An isolated consumer program
can explicitly include settings or preference modules that register host
types through module augmentation. The host's composition imports those
modules when it builds the complete application.

The plugin's generated Message facade and the Workbench message contract
are shared inputs of the feature packages and their tests. Turbo resolves
these generators before checking programs that consume their source.
The Workbench's generator gives tests its English messages. The Companion
generates Fluent files and a TypeScript message declaration from the
`zotero` namespace of the root catalogs. The End-to-end Run also reads
the generated Query Schema and the Reader probe's generated assets.

The committed Template Contract generator reads the `zt` declarations
and Zotero Types. The docs reference page uses its generated IR. The
generated Query Schema supplies the docs query reference and is also a
release resource. The docs reference generator requires a description
for every registry entry. Scenario database tests in DB and Item Query
include the pristine Fixture template in their cache inputs. The kernel
brand tests include the canonical logo assets they read.

The docs build hashes the shared skill source files it packages into
downloadable archives. It also hashes the build-time analytics token,
Cloudflare environment, and media origin so the cache keeps the distinct
outputs separate. Cache restoration includes the Wrangler deploy pointer
beside the bundle because deployment uses it to find the built Worker.
The docs type check reads the generated Query Schema and Workbench
message contract.

The repository ignores Inlang outputs before the first build creates
its managed ignore file. The docs app also ignores generated Paraglide
files. This keeps Git status and Turbo's input hashes consistent on
fresh and previously built worktrees.

Register a new ZotLit-owned persisted format at version 1 with a top-level
decimal integer literal. Keep upstream schema pins and Fixture copies with
their owners. Zotero's minimum compatible version and CLI, bridge, and
wire protocol versions follow compatibility or exchange contracts.

The format check compares Git objects from HEAD and the latest release.
Read a moved file under its release path using the NUL-separated rename
records. Leave this task uncached because its tag and HEAD inputs are
outside Turbo's workspace file hash.
[Format check](../../packages/scripts/scripts/check-format-versions.ts)
