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

### Shared Workbench controls

Reuse the Workbench's native control classes for buttons, previews, and item selection. Draw sticky headings on the pane's own background so they cover the content beneath. Use Obsidian's input variables for the pane box and let a host-provided wrapper own them when one exists. Put in-editor chrome in the interface font. A full-width child controls alignment and wrapping inside Obsidian's unlayered button box. Overlay changing labels in one grid cell to hold button width. Use a native button for the empty state's library action so it remains visible against the pane. Keep the selected Item control in the body where Obsidian hides the native view header.

### Host data and native overlays

Keep the host adapter for data and leaf-specific capabilities. It supplies the Render Scheduler, preference ports, public links, and any leaf-scoped Fields action. Use registered Shared Partials where the vault supplies them and scan the draft otherwise. The Preview can reveal the engine setting when its host provides that action. Anchor completion and hover to the editor window. When a Query View popover covers native suggestions, render choices inside its field. Use a separate hidden name for a labelled container.

Show context menus at the pointer and control menus below the anchor, which also gives keyboard activation a position. Omit the icon column when the menu names no icons. Open a native chooser in the anchor's window even if another window last held focus. Return focus to the anchor when the chooser closes. View-owned fibers control ranked search and an interrupt closes the chooser. Merge ranked results with the fixed groups without duplicating IDs. Resolve outdated searches through the latest answer. Enter during a pending search selects the first result of the typed query when it arrives, and a click on outdated rows cannot select from them.

The shared test host uses memory preferences and test-controlled render and data ports. Choosers and notices still go through the Obsidian mock. Test scopes dispose the chooser observation, editor, and registry, and a test starts with a fresh notice and menu history.

Each editor has one Workbench model. The document controller remains the authority for template text. The model owns the view state, preview selections, panel state, and one Render Scheduler. Retain a visited tab or row only while its identity still occupies the same key, so replacing an entry cannot inherit its editor state.

Share one CodeMirror decoration and portal implementation for Annotation and Shared Partial call boxes. Reset the portal nodes when the document or slice changes. Keep missing-call status on the box because an unlayered Obsidian button can override its own text color. Use reader-facing labels for note actions and offer guide links beside the available editing controls. Resolve help paths against the selected docs site and use the host's community link for the Problems action.

### Desktop launch routing

All desktop launch surfaces call the same Workbench open operation. Reuse the Workbench window that holds the document. When opening from that window, use the requested replacement, tab, or split. Move an existing matching main-window Workbench leaf into a Workbench window, or create a new window. Serialize launches because Obsidian can skip a leaf state change while its previous change is still applying. Set the leaf's own view state through the leaf. Keep the launch as the Notes feature's port so tests can exercise the shared routing.

A Template Document opens itself. A Literature Note opens its Profile with its Item selected and separately supplies the note to Update. Customize defaults to the active Literature Note's Item and uses a Sample Item when no such note is active. Resolve a saved Profile through the registry and vault. The built-in Default can open before its file exists, and Customize materializes a document before editing. The desktop file menu provides the same launch route outside the Workbench. Its entries are redundant inside the Workbench's own pane menu. A note embed in Preview shows a placeholder.

Treat the leaf as the owner of asynchronous actions and log scheduler transitions under that leaf. Read Citation Styles on visit and join an in-flight read. Reuse an open Item or Annotation chooser, cancel it on close, and discard a late read for an earlier selection. The pane menu exposes frequently used view actions even if the header is hidden and groups infrequent actions separately. Obsidian prepends header actions, so register Help, Preview, and Fields in that order. Offer Basic and Source only for a Profile.

Desktop view tests use a shared device preference store and native leaf edges. Substitute only the independently tested creation and renderer ports to show what the view passed to each. A later Item selection interrupts the earlier data read. Closing the leaf cancels pending reads, prompts, and selection commands even when another component launched them.
