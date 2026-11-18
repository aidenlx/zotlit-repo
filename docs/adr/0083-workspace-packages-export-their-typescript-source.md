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
