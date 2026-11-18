# @zotlit/template-workbench

The Template Workbench in Obsidian: the Template Workbench View with its Preview and Fields Panel, the Template Data Explorer, the Template Workbench CLI and its guide, and the Local Bridge with Customize, which opens a Profile in the web Workbench or in the view. The desktop plugin composes it. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`, "Templates" and "Agent CLI").

`@zotlit/workbench` is the Workbench core that the web Workbench and this package share (documents, language, rendering, the headless UI); this package is its Obsidian host. It builds on `@zotlit/notes` for the Profiles, the Templates and template data, and fills the notes' `TemplateWorkbenchLauncher` port (`desktop/view/open.ts`). It tests Profile Matches through the notes' `ItemMatchQuery` port, which the host fills. No other package imports this one.

## Units

- `editor/` — the Obsidian host of the headless Workbench UI, which the View, the Data Explorer and the host's Query View share: the host (`host.tsx`), the theme, the Match pane, the editor extensions, hovers and completion, the Item and Annotation choice, the action runner (`actions.ts`) and the workspace's layout turn (`layout-turn.ts`).
- `data-explorer/` — the Template Data Explorer, which the View embeds as its Fields Panel.
- `view/` — the Template Workbench View, its Preview, its Match data and its opens.
- `cli/` — the Template Workbench CLI: commands, the contract envelope, checks, inspection and the guide (`desktop/cli/guide.ts`).
- `local-bridge/` — the Local Bridge server to the web Workbench, and Customize with its device preference.

A unit imports the units listed before it, and `view/` and `local-bridge/` import each other's types only.

## Layers

Each layer has one folder of `src/` and one lint boundary (`oxlint.config.ts`); a layer imports the layers below it: core ← obsidian ← desktop.

- `core/` — host-free: the contract schemas and vocabulary of the CLI, the Item choice data, the Local Bridge's origins, sessions and support checks.
- `obsidian/` — loads on Obsidian Mobile: the editor unit, the Match data and the citations of the Preview, and the view pieces that read no template data.
- `desktop/` — Node and Electron: the CLI, the Local Bridge server, the Data Explorer and the View, which read template data that links files on disk.
- `__fixtures__/` — test support, one folder or file per unit.

## Module resolution

The package exports its TypeScript source as `@zotlit/template-workbench/<layer>/<unit>/<file>.ts`. Inside the package, import a file of the same folder by a relative path and any other file through the `#` subpath (`#obsidian/editor/host.tsx`), with its extension. Each unit imports its own stylesheet; the host's bundler collects them.

## Tests

`pnpm exec vitest run src/<layer>/<unit>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`. The Match test of a real Item over the host's ZotLit Query service stays in the app (`apps/obsidian/src/services/template-workbench/match-data.test.ts`).

## Feature

`src/desktop/feature.ts` exports `templateWorkbench`, the package's contribution to a host: its service groups, registrations, settings slices, setting tab entries and start-up hook (`packages/plugin-shell/AGENTS.md` → A feature). Add a service, a registration or a settings page there. It fills the notes' `TemplateWorkbenchLauncher` port.
