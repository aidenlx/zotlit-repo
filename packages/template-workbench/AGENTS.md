# @zotlit/template-workbench

The Template Workbench in Obsidian: the Template Workbench View with its Preview and Fields Panel, the Template Data Explorer, the Template Workbench CLI and its guide, and Customize, which opens a Profile in the view. The desktop plugin composes it. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`, "Templates" and "Agent CLI").

The package holds the Workbench core too (the Profile document, the editor language support and rendering in `core/`, and the Workbench UI in `obsidian/workbench-ui/`); [`README.md`](README.md) describes the core's units in detail. It builds on `@zotlit/notes` for the Profiles, the Templates and template data, and fills the notes' `TemplateWorkbenchLauncher` port (`desktop/view/open.ts`). It tests Profile Matches through the notes' `ItemMatchQuery` port, which the host fills. `@zotlit/query-views` imports the core's filter fields, expression language and Match editor for the Query View's Filter and Formula pages; no other package imports this one.

## Units

The Workbench core, host-free, in `core/`:

- `language/` — the editor support for Liquid, Eta and JSON-e: grammars (`eta.grammar` and its generated parser), highlighting, completion, hovers, Signature Hints, pairing, and the Filter Expression completion that the Match editor and the Query View share.
- `data-tree/` — the tree model of the Template Data Explorer: the display tree of template data, its tree state, list items and snippets.
- `filter-fields/` — the conditions a filter offers over a Query Dataset, which the Profile Match and the Query View's Filter both offer.
- `document/` — the Profile document: the document controller and its slices, the manifest patches, the note regions and the document atoms.
- `render/` — rendering a Profile against an Item Snapshot, and the render diagnostics, failure attribution and reports.
- `lint/` — the package's own oxlint plugin (`no-controller-source-slice`), which `oxlint.config.ts` loads.

The Obsidian layer: the component tree and the host and surfaces around it:

- `workbench-ui/` — the Workbench UI: the components with their own `zt:` classes (`look.ts` shares class blocks, `workbench.css` the stylesheet), the Workbench model and the Render Scheduler, the host adapter contract (`host.tsx`), the native menu (`menu.ts`) and chooser (`suggester.ts`), and the Match editor's look hook (`match.look.ts`). Its text comes from the plugin's Message facade (`@zotlit/plugin-messages/messages.ts`).
- `editor/` — the Obsidian host of the Workbench UI, which the View, the Data Explorer and the host's Query View share: the host (`host.tsx`), the Match pane, the editor extensions, hovers and completion, the Item and Annotation choice, the action runner (`actions.ts`) and the workspace's layout turn (`layout-turn.ts`).
- `data-explorer/` — the Template Data Explorer, which the View embeds as its Fields Panel.
- `view/` — the Template Workbench View, its Preview, its Match data, its opens, and the Customize flow (`desktop/view/customize.ts`).
- `cli/` — the Template Workbench CLI: commands, the contract envelope, checks, inspection and the guide (`desktop/cli/guide.ts`).

A unit's source imports the units listed before it; a test may also read the Workbench UI's test host.

## Layers

Each layer has one folder of `src/` and one lint boundary (`oxlint.config.ts`); a layer imports the layers below it: core ← obsidian ← desktop.

- `core/` — host-free: the Workbench core, the contract schemas and vocabulary of the CLI, and the Item choice data.
- `obsidian/` — loads on Obsidian Mobile: the Workbench UI, the editor unit, the Match data and the citations of the Preview, and the view pieces that read no template data.
- `desktop/` — Node and Electron: the CLI, the Data Explorer and the View, which read template data that links files on disk.
- `__fixtures__/` — test support, one folder or file per unit.

## Module resolution

The package exports its TypeScript source as `@zotlit/template-workbench/<layer>/<unit>/<file>.ts`. Inside the package, import a file of the same folder by a relative path and any other file through the `#` subpath (`#obsidian/editor/host.tsx`), with its extension. Each unit imports its own stylesheet; the host's bundler collects them.

## Tests

`pnpm exec vitest run src/<layer>/<unit>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`. The Match test of a real Item over the host's ZotLit Query service stays in the app (`apps/obsidian/src/services/template-workbench/match-data.test.ts`).

## Feature

`src/obsidian/feature.ts` exports `templateWorkbench`, the part of the package's contribution that loads on every Obsidian: the service groups, registrations, settings slices, setting rows and `obsidian://` handlers whose code is in `core/` and `obsidian/`. `src/desktop/feature.ts` extends it (`extendFeature`) with the desktop parts, and a desktop host lists that value (`packages/plugin-shell/AGENTS.md` → A feature). Add a service, a registration, a settings page or a link to the value of the layer its code is in. It fills the notes' `TemplateWorkbenchLauncher` port.
