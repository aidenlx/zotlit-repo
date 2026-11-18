# pdfjs-dist

Type definitions of Zotero's fork of pdf.js, copied from
[`zotero-plugin-dev/zotero-pdfjs-types`](https://github.com/zotero-plugin-dev/zotero-pdfjs-types).
`provenance.json` records the upstream commit of the files in `types/`.

The npm package `zotero-types` declares `pdfjs-dist` as a GitHub dependency,
which pnpm's `blockExoticSubdeps` refuses for a transitive dependency. The
`zotero-types>pdfjs-dist` override in `pnpm-workspace.yaml` points it at this
folder. Only `apps/zotero` reads these types.

- Edit nothing under `types/`: the refresh replaces it.
- Refresh from the repository root, then check the Companion types:

  ```sh
  node packages/scripts/scripts/vendor-upstream.ts pdfjs-dist [ref]
  turbo run typecheck --filter=@zotlit/zotero
  ```

  `[ref]` is an upstream commit, branch or tag; the default is the upstream
  default branch.

- oxlint, oxfmt and knip skip this folder. `tsconfig.json` puts every file in
  `types/` in a TypeScript project, so the Obsidian community directory
  scanner, which lints the whole repository with type information, parses
  them instead of reporting each one as an error.
