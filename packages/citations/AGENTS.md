# @zotlit/citations

Citations in Obsidian: citation parsing and the Citation Index, the Citation Suggester, the Document Citation Text in the editor and the reading view (citekeys and wikilink citations), citekey navigation, the Citation and Annotation Popovers, Graph Citations, the References Sidebar and the Cited By Sidebar, the Citation Presentation, and the Pandoc Engine with Pandoc export. The desktop plugin composes it. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`, "Citation insertion", "Index and identity" and "Integration processes").

The package imports no other feature except `@zotlit/annotations`, whose Annotations the Annotation Popover draws. A capability of the notes feature comes in as a port that the host fills:

- `CitationTemplate` (`obsidian/citation-suggest/register.ts`) renders the citation text the Citation Suggester inserts; `packages/notes/src/desktop/note-feature/citation-template.ts` fills it.
- `CitekeyNoteActions` (`obsidian/citekey-editor/note-actions.ts`) picks and creates the literature note a citekey opens; `packages/notes/src/desktop/note-feature/citekey-actions.ts` fills it.
- `ProfileStyles` (`obsidian/pandoc/profile-styles.ts`) reads the Profile a note selects and the Citation and References Style it binds, and the vault's style; `packages/notes/src/obsidian/profile/profile-styles.ts` fills it.

The host keeps the citation parse Worker entry (`apps/obsidian/src/services/citation-parse/worker.ts`) and passes its bundle to `layerCitationParse`, and the tests that read the notes feature's Profiles (`src/services/citations/`).

## Layers

Each layer is one folder of `src/` and one runtime zone ([ADR 0117](../../docs/adr/0117-runtime-zones-are-checked-by-the-module-graph.md)). A new file goes in the folder of what it needs from its host: `core/` is the host-free zone (the DOM, no host module), `obsidian/` the Obsidian zone (the `obsidian` module; it loads on Obsidian Mobile), and `desktop/` the desktop zone (Node and Electron). A layer reaches the layers below it: core ← obsidian ← desktop. The runtime check (`pnpm run lint:runtime-zones`) follows each import, type-only imports included, and fails on reach to a higher zone or to test support. Lint refuses Node built-in imports and the Node globals outside `desktop/`.

- `core/` — host-free: no Node built-in, `obsidian`, `electron`, Obsidian kit, or client and desktop layers of ZoteroReads and the platform services. The note scan, annotation links and the store of the Citation Index, the citation parse protocol with its Worker host and clients, the citation slice of the settings, the Pandoc AST and contract, the CSL style parser, and the Lua filter with its defaults.
- `obsidian/` — loads on Obsidian Mobile: the Obsidian API, the kit, the ZoteroReads client and the platform services' Obsidian layer, and no Node or Electron. The Citation Index, citation parsing, the Citation Suggester, the Document Citation Text, the editor and reading-view surfaces, navigation, the Pandoc Engine and the bibliography render tag, and the Cited By view.
- `desktop/` — Node and Electron: the CSL styles on disk (`pandoc/styles.ts`), the bibliography render layer, the Pandoc integration and export, the Citation Presentation picker, the References view, and the popover layers, which read Excerpt Images and open Zotero.
- `__fixtures__/` — test support, one folder or file per unit. `settings.ts`, `profiles.ts` and `view-atoms.ts` hold this package's own slices, a Profile double and view services.

Each unit registers itself: a service tag adds itself to `ViewServiceRegistry`, the citation slice (`core/citation-index/settings.ts`) adds its keys to `SettingsRegistry`, and a file that raises a menu adds its event to `ZotLitMenuEvents` (`@zotlit/obsidian-kit/menu-events.ts`). The host composes the citation slice into its settings definition.

## Build integration

The build-only `@zotlit/citations/vite` entry (`scripts/lua-filter.ts`) serves the Lua filter variants.

## Tests

From this package directory, `pnpm exec vitest run src/<layer>/<unit>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`.

`pnpm --filter @zotlit/citations test:lua-filter` drives a native Pandoc (3.1.1 or newer) over fixture Markdown to check both `zotlit-cite.lua` variants. It needs `pandoc` on PATH; set `PANDOC_BIN` to check another Pandoc version. The `test` task of this package runs it too, and skips it where no `pandoc` is on PATH.

## Feature

`src/obsidian/feature.ts` exports `citations`, the part of the package's contribution that loads on every Obsidian: the service groups, registrations, settings slices, setting rows and `obsidian://` handlers whose code is in `core/` and `obsidian/`. `src/desktop/feature.ts` extends it (`extendFeature`) with the desktop parts, and a desktop host lists that value (`packages/plugin-shell/AGENTS.md` → A feature). Add a service, a registration, a settings page or a link to the value of the layer its code is in. The notes feature fills its `CitekeyNoteActions` port.
