---
status: accepted
---

# The web Template Workbench is retired

Supersedes [ADR 0033](0033-web-workbench-is-public-and-standalone.md), [ADR 0042](0042-a-workbench-connection-starts-in-obsidian.md) and [ADR 0046](0046-customize-is-a-chooser-between-the-web-workbench-and-the-profile-editor.md). Amends [ADR 0032](0032-web-workbench-edits-one-source-document.md).

## Context

One Workbench UI had two hosts: the web Template Workbench at `/workbench` on the docs site, and the Template Workbench View in Obsidian. The second host cost more than its page:

- a Local Bridge on the Local Server, with Connection codes, a session credential, its own wire schemas and client, and a mock of it in the Fixture;
- a Customize chooser between the two hosts, with a launch sheet and a device preference;
- a `WEB_WORKBENCH_ENABLED` build flag, which every Vitest config of the plugin defined and which the setting tab, the commands and the `obsidian://zotlit/import-profile` link read;
- a React and a Preact run of every UI suite of `@zotlit/workbench`;
- render paths for a dependency bundle and a Resolved CSL Style that only the Local Bridge supplied;
- a message contract (`WorkbenchMessages`) that two message runtimes compile.

The flag was off in every release ([ADR 0046](0046-customize-is-a-chooser-between-the-web-workbench-and-the-profile-editor.md)), so no reader used the web page through Obsidian. The Template Workbench View covers the workflow: it opens every Template Document kind, runs Eta and JavaScript fields, saves to the vault, and shows the Preview and the Fields Panel beside the editor.

## Decision

- **The web host is gone.** The `/workbench` route, its editor bundle, its design spec and the `zotlit-design/workbench-chrome` lint rule are removed from `apps/docs`, with the route's sitemap, prerender, locale and OG card entries.
- **The Local Bridge is gone.** Its client and schemas (`@zotlit/workbench/bridge`), its server in `@zotlit/template-workbench`, the `server.workbench` setting and its row, the Local Server's route-mount seam and its hosted-services slot, the Fixture's mock bridge (`pnpm fixture bridge`), and the `WEB_WORKBENCH_ENABLED` build flag are removed. The `obsidian://zotlit/import-profile` link, the web page's clipboard handoff, goes with them; no release handled it.
- **Customize opens the Template Workbench View.** Every Customize entry point (the Profiles page, the Default Profile row, a duplicated Profile) opens the Profile in the View directly. There is no chooser and no device preference; a stored `zotlit-profile-customization` value is no longer read.
- **The Workbench core has one host.** The document controller, the language support, rendering and the Workbench UI serve the Template Workbench View, the Template Data Explorer and the Query View's Filter. The editing model of [ADR 0032](0032-web-workbench-edits-one-source-document.md) and the Item Snapshot of [ADR 0043](0043-an-item-snapshot-carries-only-allow-listed-fields.md) stay in force for the View.
- **`@zotlit/workbench` is folded into `@zotlit/template-workbench`.** First the parts other packages read move to their owners: the Item Snapshot to `@zotlit/zotero-reads`, the template data helpers to `@zotlit/db/template-data`, the render diagnostics, failure readers and preview data to `@zotlit/notes`, and the fiber helpers to `@zotlit/plugin-kernel`. Then the core becomes host-free units of the one package, in `src/core/`: `language/`, `data-tree/` (the Data Explorer's tree model), `filter-fields/` (the filter conditions over a Query Dataset), `document/`, `render/` and `lint/`. Its barrels keep only what a reader imports, and `@zotlit/query-views` reads the core as `@zotlit/template-workbench/core/<unit>/<file>.ts`. The document controller loses its `web` runtime: it always reports the vault's `bundled-partial` problem and no longer refuses Eta or JavaScript, and the messages of those refusals go. The core keeps `renderProfile`, which only the core's own tests call.
- **The Workbench UI is a unit of the Obsidian layer.** It is `src/obsidian/workbench-ui/`. Its components draw with their own `zt:` classes and reach Obsidian's controls through the `@zotlit/obsidian-kit` wrappers (the rendered property list and the Match's value pills keep Obsidian's Properties classes, so they read as a note's Properties); it opens Obsidian's `Menu`, `SuggestModal`, tooltips and notices directly; and it reads its text from the plugin's Language Pack (`@zotlit/plugin-messages/messages.ts`). The theme class map, the overlay members of the host adapter and the host's message supply are gone. The host adapter (`host.tsx`) keeps the data ports — `render`, `matchData`, `insertTarget`, `persistence`, the clipboard, the community and docs links, the Markdown view and the editor popups — and the Obsidian host (`src/obsidian/editor/host.tsx`) supplies them.
- **The Workbench UI's tests pin pure logic.** Its suites keep the cases of the model, the Render Scheduler, the problem and panel rules and the chooser, and run in the package's one Node Vitest run, as [policies/testing-strategy.md](../../policies/testing-strategy.md) assigns; the End-to-end Run proves what a reader sees.

## Consequences

- A reader edits templates in Obsidian only. The docs describe the Template Workbench View and no web page.
- The plugin's settings drop `server.workbench`; a `data.json` that still holds it loads, and the key is dropped as an unknown key.
- The Local Server hosts Live Update alone; its toggle and its port rows stay.
- A future web surface starts from a new decision, not from this code.
- The Template Workbench is one package, and the core follows the plugin code's lint rules with no backlog. Two settings make room for it: the package's Effect language service allows `effect/reactivity` and `@effect/atom-react`, on which the Workbench's atoms, Render Scheduler and hooks are built, and the engine host pattern (`hostModulePattern` in `packages/config/oxlint.base.ts`) lets through a host-free entry named `obsidian` of a workspace package (`!@zotlit/*/obsidian`), such as `@zotlit/templates/obsidian`.
- `pnpm --filter @zotlit/template-workbench generate:eta` generates the core's Eta parser. The Workbench messages compile with the plugin's other messages.
