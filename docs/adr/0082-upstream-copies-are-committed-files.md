---
status: accepted
---

# Upstream copies are committed files, and the repository has no submodule

## Context

The repository had three git submodules:

- `packages/zotero-types/zotero-schema` (`zotero/zotero-schema`). The package reads only `schema.json`, and its generated `src/*.ts` is committed.
- `packages/pdfjs-dist` (`zotero-plugin-dev/zotero-pdfjs-types`). These are the type definitions of Zotero's pdf.js fork. The npm package `zotero-types` declares them as a GitHub dependency, and pnpm's `blockExoticSubdeps` refuses that for a transitive dependency. The override `zotero-types>pdfjs-dist: link:packages/pdfjs-dist` points it at the folder. Only `apps/zotero` reads them.
- `video` (`aidenlx/zotlit-video`). This is the private, opt-in video workbench, with `update = none`.

A plain clone did not give a working tree: `@zotlit/zotero-types` failed typecheck without `schema.json`. Each linked worktree cloned all three submodules again, and the bootstrap had a local-clone redirect only to make that fast. Removal had to deinit them first, or `git worktree remove` asked for `--force`. CI needed `submodules: recursive`. The docs deploy needed a separate checkout of the schema.

Commit `fbce37433` committed `packages/pdfjs-dist` once, and commit `676074aaf` made it a submodule again. The community directory scanner runs ESLint with type information over the whole repository. Without a `tsconfig.json`, each of the 105 declaration files gives the error "was not found by the project service".

## Decision

- **Upstream copies are committed files.** `packages/zotero-types/zotero-schema/schema.json` and `packages/pdfjs-dist/types/` are byte-identical to their pinned upstream commits. A `provenance.json` next to each copy records the repository, the commit and the copied paths.
- **One script refreshes them.** `node packages/scripts/scripts/vendor-upstream.ts <zotero-schema|pdfjs-dist> [ref]` resolves the ref to a commit through the GitHub API, downloads that commit's archive, replaces the copied paths and writes `provenance.json`. A refresh is a reviewed diff.
- **`packages/pdfjs-dist/tsconfig.json` covers `types/`.** The scanner parses the files, and its error-level rules report 0 errors there. oxlint, oxfmt and knip skip the folder.
- **`video/` is a nested clone that git ignores.** `mise run video:clone` creates it. The `pnpm-workspace.yaml` entry stays. The lockfile keeps an empty `video` importer, so a frozen install passes with and without the clone. The parent no longer records the workbench commit.

## Consequences

- `git clone` plus `pnpm install` gives a complete workspace. A worktree needs no submodule step on creation or removal.
- The scanner, if it lints this tree, reports about 2,500 warnings and 0 errors for `packages/pdfjs-dist`. Warnings do not block a release.
- An upstream update is a manual refresh, not a gitlink bump.
- Removing a worktree deletes its `video/` clone with the folder. Commit and push video work first, as with the deinit before.
- If the workbench gains dependencies, its lockfile importer must be regenerated with the clone present.

## Considered options

- **Keep the submodules.** This keeps the costs in the context.
- **Override `pdfjs-dist` with an upstream tarball.** pnpm accepts that source only for a direct dependency. For a transitive dependency, `blockExoticSubdeps` refuses it.
- **Move the pdf.js types to a path that the scanner ignores.** No ignore pattern of the scanner fits a type package. Renaming the files to `.d.mts` would break their relative imports.
