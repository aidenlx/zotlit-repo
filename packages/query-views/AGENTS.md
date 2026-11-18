# @zotlit/query-views

ZotLit Query in Obsidian and the views that show its results: the Item Query adapter over `@zotlit/item-query` (`QueryService`, the Query Job runs, the `zotlit:query` CLI contract and its decode), the Query View with its layouts, cards and Query Files, the sidebar Annotation View that shows the annotation cards in a Query View, the Annotation Suggester, and the PDF view's note button. The desktop plugin composes it. The terms are defined in the Item Query glossary (`packages/item-query/GLOSSARY.md`) and the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`, "Query views" and "Annotation view").

`@zotlit/item-query` is the query engine and imports nothing of Obsidian; this package is its Obsidian host, as `@zotlit/template-workbench` is the host of `@zotlit/workbench`.

The package fills ports of the features it shows:

- `ItemMatchQuery` of `@zotlit/notes`: `desktop/item-query/item-matches.ts` tests Profile Matches through `QueryService`.

It imports `@zotlit/annotations` for the annotation cards and Annotations Layout, `@zotlit/notes` for Literature Notes and note creation, and `@zotlit/template-workbench` for the Template Workbench CLI envelope and the Data Explorer. No feature package imports this one; `@zotlit/library-view` builds on it.

## Layers

Each layer has one folder of `src/` and one lint boundary (`oxlint.config.ts`). A file sits in the layer of what it needs from its host; a layer imports the layers below it: core ← obsidian ← desktop.

- `core/` — host-free: the Query View's plans, Query File blocks and the Annotation Suggester's trigger rules, the CLI contract shapes.
- `obsidian/` — loads on Obsidian Mobile: the Query View's block writes, card focus, reorder and the private Obsidian embed hooks.
- `desktop/` — Node and Electron: `QueryService` and the CLI, which read the Zotero database through `@zotlit/zotero-reads` and the Template Workbench CLI envelope; the Query View, the Annotation View, the Annotation Suggester and the note button, which open attachments and create notes through the desktop layers of `@zotlit/annotations` and `@zotlit/notes`.
- `__fixtures__/` — test support, one folder or file per unit. `view-atoms.ts` holds this package's view services; `@zotlit/library-view`'s tests read it and `__fixtures__/query-view/host.ts` too.

Each unit registers itself: `QueryService` adds itself to `ViewServiceRegistry` (`desktop/item-query/service.ts`), and `desktop/item-query/worker-protocol.ts` adds the Item Query requests to the ZoteroReads Worker contract.

## Module resolution

The package exports its TypeScript source as `@zotlit/query-views/<layer>/<unit>/<file>.ts`. Inside the package, import a file of the same folder by a relative path and any other file through the `#` subpath (`#desktop/item-query/service.ts`), with its extension.

## Tests

`pnpm exec vitest run src/<layer>/<unit>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest` and `@chenglou/pretext` resolved to `__mocks__/pretext.ts`. `pnpm bench` runs the Query View benchmarks (`vitest.bench.config.ts`); `desktop/query-view/mixed-query.bench.ts` reads a local Zotero database.
